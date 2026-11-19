// 煉金術士（atelier）：調和方式①「色彩棋盤」（瑠璃的工房；蘇菲範圍的難度）。
// 規則依據 docs/atelier_design.md §4。純規則，不碰 DOM。
// 介面（所有調和方式共用）：create／canPlace／place／undo／evaluate／preview／done
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestAtelierData;
  var CODE = { f: "fire", i: "ice", b: "bolt", w: "wind", s: "spirit" };

  function shapeOps() { return root.PriTestAtelierCore; }
  function create(recipe, mats, cauldron, ability) {
    var size = cauldron.pattern.length, cells = [];
    cauldron.pattern.forEach(function (row) {
      for (var x = 0; x < row.length; x++) {
        var ch = row[x], low = ch.toLowerCase();
        cells.push({ color: CODE[low] || null, bonus: ch === "*" || (CODE[low] && ch !== low) });
      }
    });
    return { method: "board", recipe: recipe, mats: mats, cauldron: cauldron, ability: ability || {},
      size: size, cells: cells, owner: cells.map(function () { return -1; }),
      placed: mats.map(function () { return false; }), history: [] };
  }
  function footprint(s, mi, x, y, rot) {
    return shapeOps().rotateShape(s.mats[mi].shape, rot).map(function (c) { return [c[0] + x, c[1] + y]; });
  }
  function canPlace(s, mi, x, y, rot) {
    if (mi < 0 || mi >= s.mats.length || s.placed[mi]) return false;
    return footprint(s, mi, x, y, rot).every(function (c) { return c[0] >= 0 && c[1] >= 0 && c[0] < s.size && c[1] < s.size; });
  }
  // 放下素材（可以覆蓋已放的素材，被覆蓋的格子就不再屬於原本的素材）
  function place(s, mi, x, y, rot) {
    if (!canPlace(s, mi, x, y, rot)) return { ok: false };
    var m = s.mats[mi], info = { ok: true, recipe: s.recipe, cells: 0, matchCells: 0, bonusCells: 0, overwritten: 0 };
    s.history.push({ owner: s.owner.slice(), placed: s.placed.slice() });
    footprint(s, mi, x, y, rot).forEach(function (c) {
      var idx = c[1] * s.size + c[0], cell = s.cells[idx];
      if (s.owner[idx] >= 0) info.overwritten++;
      s.owner[idx] = mi;
      info.cells++;
      if (cell.color === m.element) info.matchCells++;
      if (cell.bonus) info.bonusCells++;
    });
    s.placed[mi] = true;
    return info;
  }
  function undo(s) {
    var h = s.history.pop();
    if (!h) return false;
    s.owner = h.owner; s.placed = h.placed;
    return true;
  }
  function done(s) { return s.placed.every(Boolean); }
  // final＝true 時加上「最後一推」
  function evaluate(s, final) {
    var gauges = {}, visible = s.mats.map(function () { return 0; }), byEl = {}, covered = 0;
    D.ELEMENTS.forEach(function (e) { gauges[e.id] = 0; byEl[e.id] = 0; });
    s.owner.forEach(function (o, idx) {
      if (o < 0) return;
      var m = s.mats[o], cell = s.cells[idx], match = cell.color === m.element, add = m.power;
      if (match) add += m.power + (s.ability.matchBonus || 0);
      if (cell.bonus) add += match ? D.BONUS_MATCH : D.BONUS;
      gauges[m.element] += add;
      visible[o]++; byEl[m.element]++; covered++;
    });
    var dominant = null, push = 0;
    if (final && covered > 0) {
      D.ELEMENTS.forEach(function (e) { if (!dominant || byEl[e.id] > byEl[dominant]) dominant = e.id; });
      push = Math.round(gauges[dominant] * (byEl[dominant] / covered) * D.FINAL_PUSH_RATE);
      gauges[dominant] += push;
    }
    // 第 2 階段（C5）：擅長這個配方的釜，量表 ×affinityMult
    var mult = s.cauldron.affinityMult && s.cauldron.affinity && s.cauldron.affinity.indexOf(s.recipe.id) >= 0 ? s.cauldron.affinityMult : 1;
    if (mult !== 1) Object.keys(gauges).forEach(function (k) { gauges[k] = Math.round(gauges[k] * mult); });
    var used = s.mats.filter(function (m, i) { return visible[i] > 0; });
    if (!used.length) used = s.mats;
    var avg = used.reduce(function (a, m) { return a + m.quality; }, 0) / used.length;
    var quality = Math.max(1, Math.min(100, Math.round(avg + s.cauldron.qualityPerCell * covered)));
    return { gauges: gauges, visible: visible, covered: covered, dominant: dominant, push: push, quality: quality, mult: mult };
  }
  // O7 放置預覽：不改動 session，回傳放下前後的評估
  function preview(s, mi, x, y, rot) {
    if (!canPlace(s, mi, x, y, rot)) return null;
    var copy = { method: s.method, recipe: s.recipe, mats: s.mats, cauldron: s.cauldron, ability: s.ability, size: s.size,
      cells: s.cells, owner: s.owner.slice(), placed: s.placed.slice(), history: [] };
    var before = evaluate(copy, false), info = place(copy, mi, x, y, rot);
    return { before: before, after: evaluate(copy, done(copy)), info: info, cells: footprint(s, mi, x, y, rot) };
  }

  var impl = { create: create, footprint: footprint, canPlace: canPlace, place: place, undo: undo, done: done, evaluate: evaluate, preview: preview };
  if (typeof module !== "undefined" && module.exports) module.exports = impl;
  else window.PriTestAtelierCore.registerMethod("board", impl);
})();
