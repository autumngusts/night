// 煉金術士（atelier）：調和方式①「色彩棋盤」（瑠璃的工房；蘇菲範圍的難度）。
// 規則依據 docs/atelier_design.md §4（基本）、§8.6（擅長配方）、§9（進階：混色、互補色、觸媒、過熱、回放）。純規則，不碰 DOM。
// 介面（所有調和方式共用）：create／canPlace／place／undo／evaluate／preview／done（＋本方式的 bestPlacement）
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestAtelierData;
  var CODE = { f: "fire", i: "ice", b: "bolt", w: "wind", s: "spirit" };
  var LETTER = { fire: "f", ice: "i", bolt: "b", wind: "w", spirit: "s" };

  function shapeOps() { return root.PriTestAtelierCore; }
  // §9.1 觸媒改變棋盤：擴張（右、下各加 1 排）、染色（中央 3×3 的一般格變成指定屬性）
  function catalystPattern(pattern, cat) {
    var rows = pattern.slice();
    if (!cat) return rows;
    if (cat.id === "expand") {
      rows = rows.map(function (r) { return r + "."; });
      rows.push(new Array(rows.length + 2).join("."));
    }
    if (cat.id === "tint" && LETTER[cat.el]) {
      var c = Math.floor(rows.length / 2);
      rows = rows.map(function (r, y) {
        return r.split("").map(function (ch, x) {
          return Math.abs(x - c) <= 1 && Math.abs(y - c) <= 1 && ch === "." ? LETTER[cat.el] : ch;
        }).join("");
      });
    }
    return rows;
  }
  // opts（第 3 階段）：{ rules: {mix, complement}, catalyst: {id, el} }
  function create(recipe, mats, cauldron, ability, opts) {
    opts = opts || {};
    var pattern = catalystPattern(cauldron.pattern, opts.catalyst), size = pattern.length, cells = [];
    pattern.forEach(function (row) {
      for (var x = 0; x < row.length; x++) {
        var ch = row[x], low = ch.toLowerCase();
        cells.push({ color: CODE[low] || null, bonus: ch === "*" || (CODE[low] && ch !== low) });
      }
    });
    return { method: "board", recipe: recipe, mats: mats, cauldron: cauldron, ability: ability || {},
      size: size, cells: cells, owner: cells.map(function () { return -1; }),
      placed: mats.map(function () { return false; }), history: [], moves: [],
      rules: opts.rules || {}, catalyst: opts.catalyst || null };
  }
  function footprint(s, mi, x, y, rot) {
    return shapeOps().rotateShape(s.mats[mi].shape, rot).map(function (c) { return [c[0] + x, c[1] + y]; });
  }
  function canPlace(s, mi, x, y, rot) {
    if (mi < 0 || mi >= s.mats.length || s.placed[mi]) return false;
    return footprint(s, mi, x, y, rot).every(function (c) { return c[0] >= 0 && c[1] >= 0 && c[0] < s.size && c[1] < s.size; });
  }
  // 放下素材（可以覆蓋已放的素材，被覆蓋的格子就不再屬於原本的素材）。每一手記在 moves（B8 回放）
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
    s.moves.push([mi, x, y, rot]);
    return info;
  }
  function undo(s) {
    var h = s.history.pop();
    if (!h) return false;
    s.owner = h.owner; s.placed = h.placed;
    s.moves.pop();
    return true;
  }
  function done(s) { return s.placed.every(Boolean); }
  function mixTarget(a, b) {
    for (var i = 0; i < D.MIX_PAIRS.length; i++) {
      var p = D.MIX_PAIRS[i];
      if ((a === p[0] && b === p[1]) || (a === p[1] && b === p[0])) return p[2];
    }
    return null;
  }
  // final＝true 時加上「最後一推」
  function evaluate(s, final) {
    var gauges = {}, penalty = {}, visible = s.mats.map(function () { return 0; }), byEl = {}, covered = 0, clash = 0, mix = 0;
    var rules = s.rules || {}, cat = s.catalyst;
    D.ELEMENTS.forEach(function (e) { gauges[e.id] = 0; byEl[e.id] = 0; penalty[e.id] = 0; });
    s.owner.forEach(function (o, idx) {
      if (o < 0) return;
      var m = s.mats[o], cell = s.cells[idx], match = cell.color === m.element, add = m.power;
      visible[o]++; byEl[m.element]++; covered++;
      if (rules.complement && cell.color && D.COMPLEMENT[m.element] === cell.color) {   // §9.1 互補色抵銷
        clash++; penalty[m.element] += D.COMPLEMENT_PENALTY;
        return;
      }
      if (match) add += m.power + (s.ability.matchBonus || 0);
      if (match && cat && cat.id === "double" && cat.el === m.element) add += m.power;   // 倍化觸媒
      if (cell.bonus) add += match ? D.BONUS_MATCH : D.BONUS;
      gauges[m.element] += add;
    });
    D.ELEMENTS.forEach(function (e) { gauges[e.id] = Math.max(0, gauges[e.id] - penalty[e.id]); });
    if (rules.mix) {                                                                     // §9.1 混色
      s.owner.forEach(function (o, idx) {
        if (o < 0) return;
        var x = idx % s.size, y = Math.floor(idx / s.size);
        [[1, 0], [0, 1]].forEach(function (d) {
          var nx = x + d[0], ny = y + d[1];
          if (nx >= s.size || ny >= s.size) return;
          var o2 = s.owner[ny * s.size + nx];
          if (o2 < 0 || o2 === o) return;
          var tgt = mixTarget(s.mats[o].element, s.mats[o2].element);
          if (tgt) { gauges[tgt] += D.MIX_BONUS; mix += D.MIX_BONUS; }
        });
      });
    }
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
    return { gauges: gauges, visible: visible, covered: covered, dominant: dominant, push: push, quality: quality, mult: mult,
      mix: mix, clash: clash, overheat: covered / (s.size * s.size) >= D.OVERHEAT_RATIO };
  }
  function clone(s) {
    return { method: s.method, recipe: s.recipe, mats: s.mats, cauldron: s.cauldron, ability: s.ability, size: s.size,
      cells: s.cells, owner: s.owner.slice(), placed: s.placed.slice(), history: [], moves: s.moves.slice(),
      rules: s.rules, catalyst: s.catalyst };
  }
  // O7 放置預覽：不改動 session，回傳放下前後的評估
  function preview(s, mi, x, y, rot) {
    if (!canPlace(s, mi, x, y, rot)) return null;
    var copy = clone(s), before = evaluate(copy, false), info = place(copy, mi, x, y, rot);
    return { before: before, after: evaluate(copy, done(copy)), info: info, cells: footprint(s, mi, x, y, rot) };
  }
  // C7 瑠璃出手：所有位置與方向中，量表進度最高的一手（同分取先找到的）
  function bestPlacement(s, mi) {
    var best = null;
    for (var rot = 0; rot < 4; rot++) for (var y = 0; y < s.size; y++) for (var x = 0; x < s.size; x++) {
      var p = preview(s, mi, x, y, rot);
      if (!p) continue;
      var score = p.after.quality / 1000;
      s.recipe.gauges.forEach(function (g) {
        var top = g.steps[g.steps.length - 1].at, v = p.after.gauges[g.el], lv = 0;
        g.steps.forEach(function (st, i) { if (v >= st.at) lv = i + 1; });
        score += lv * 10 + Math.min(v, top) / top;
      });
      if (!best || score > best.score) best = { x: x, y: y, rot: rot, score: score };
    }
    return best;
  }

  var impl = { create: create, footprint: footprint, canPlace: canPlace, place: place, undo: undo, done: done, evaluate: evaluate,
    preview: preview, bestPlacement: bestPlacement, catalystPattern: catalystPattern };
  if (typeof module !== "undefined" && module.exports) module.exports = impl;
  else window.PriTestAtelierCore.registerMethod("board", impl);
})();
