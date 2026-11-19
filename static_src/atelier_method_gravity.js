// 煉金術士（atelier）：調和方式⑤「結晶」（黒曜的工房）。規則依據 docs/atelier_design.md §11.5。純規則，不碰 DOM。
// 使用錬金釜的棋盤，但只選欄與方向：素材從上方落下，停在不重疊的最低位置。填滿一排就結晶，加成給這排最多的屬性。
// 量表的計算重用色彩棋盤（PriTestAtelierCore.method("board")）。place(s, mi, x, 任意, rot)。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestAtelierData;

  function C() { return root.PriTestAtelierCore; }
  function B() { return C().method("board"); }
  function create(recipe, mats, cauldron, ability, opts) {
    var s = B().create(recipe, mats, cauldron, ability, opts);
    s.method = "gravity";
    return s;
  }
  function fits(s, cells, x, y) {
    return cells.every(function (c) {
      var cx = c[0] + x, cy = c[1] + y;
      return cx >= 0 && cy >= 0 && cx < s.size && cy < s.size && s.owner[cy * s.size + cx] < 0;
    });
  }
  // 落下後的 y；最上面就放不下時回傳 null
  function dropY(s, mi, x, rot) {
    if (mi < 0 || mi >= s.mats.length || s.placed[mi]) return null;
    var cells = C().rotateShape(s.mats[mi].shape, rot);
    if (!fits(s, cells, x, 0)) return null;
    var y = 0;
    while (fits(s, cells, x, y + 1)) y++;
    return y;
  }
  function canPlace(s, mi, x, y, rot) { return dropY(s, mi, x, rot || 0) !== null; }
  function fullRows(s) {
    var rows = [];
    for (var y = 0; y < s.size; y++) {
      var full = true;
      for (var x = 0; x < s.size; x++) if (s.owner[y * s.size + x] < 0) { full = false; break; }
      if (full) rows.push(y);
    }
    return rows;
  }
  function place(s, mi, x, y, rot) {
    var yy = dropY(s, mi, x, rot || 0);
    if (yy === null) return { ok: false };
    var before = fullRows(s).length, info = B().place(s, mi, x, yy, rot || 0);
    info.dropY = yy;
    info.lines = fullRows(s).length - before;            // 這一手結晶的排數
    info.bonusCells += info.lines;                       // 結晶也算「加成」，讓工房主人的反應說到它
    return info;
  }
  function undo(s) { return B().undo(s); }
  function done(s) { return s.placed.every(Boolean); }
  function evaluate(s, final) {
    var ev = B().evaluate(s, final), rows = fullRows(s), bonus = D.GRAVITY_LINE_BONUS + (s.ability.lineBonus || 0);
    rows.forEach(function (y) {
      var count = {}, best = null;
      for (var x = 0; x < s.size; x++) { var el = s.mats[s.owner[y * s.size + x]].element; count[el] = (count[el] || 0) + 1; }
      D.ELEMENTS.forEach(function (e) { if (count[e.id] && (!best || count[e.id] > count[best])) best = e.id; });
      ev.gauges[best] += bonus;
    });
    ev.lines = rows.length;
    ev.lost = 0;
    return ev;
  }
  function clone(s) {
    return { method: s.method, recipe: s.recipe, mats: s.mats, cauldron: s.cauldron, ability: s.ability, size: s.size,
      cells: s.cells, owner: s.owner.slice(), placed: s.placed.slice(), history: [], moves: s.moves.slice(), rules: s.rules, catalyst: s.catalyst };
  }
  function preview(s, mi, x, y, rot) {
    var yy = dropY(s, mi, x, rot || 0);
    if (yy === null) return null;
    var copy = clone(s), before = evaluate(copy, false), info = place(copy, mi, x, yy, rot);
    return { before: before, after: evaluate(copy, done(copy)), info: info, cells: B().footprint(s, mi, x, yy, rot || 0) };
  }
  function options(s, mi) {
    var out = [];
    for (var rot = 0; rot < 4; rot++) for (var x = 0; x < s.size; x++) if (canPlace(s, mi, x, 0, rot)) out.push([x, 0, rot]);
    return out;
  }

  var impl = { create: create, canPlace: canPlace, place: place, undo: undo, done: done, evaluate: evaluate, preview: preview,
    options: options, dropY: dropY, fullRows: fullRows };
  if (typeof module !== "undefined" && module.exports) module.exports = impl;
  else window.PriTestAtelierCore.registerMethod("gravity", impl);
})();
