// 煉金術士（atelier）：調和方式④「調色」（雫的工房）。規則依據 docs/atelier_design.md §11.4。純規則，不碰 DOM。
// 每個素材選 1～3 份加進調色盤，調出的顏色越接近目標色（配方兩條量表的代表色 2：1），加成越多。
// place(s, mi, parts 1..3, 0, 0)；options 列出 3 種份數。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestAtelierData;

  function C() { return root.PriTestAtelierCore; }
  function elColor(id) { for (var i = 0; i < D.ELEMENTS.length; i++) if (D.ELEMENTS[i].id === id) return D.ELEMENTS[i].color; return "#808080"; }
  function target(recipe) {
    var a = C().hexToRgb(elColor(recipe.gauges[0].el)), b = C().hexToRgb(elColor((recipe.gauges[1] || recipe.gauges[0]).el));
    return [0, 1, 2].map(function (i) { return Math.round((a[i] * 2 + b[i]) / 3); });
  }
  function rgbOf(m) { return m.rgb && m.rgb.length === 3 ? m.rgb : C().hexToRgb(m.hex); }
  function create(recipe, mats, cauldron, ability, opts) {
    opts = opts || {};
    return { method: "palette", recipe: recipe, mats: mats, cauldron: cauldron, ability: ability || {}, size: D.PALETTE_MAX_PARTS + 1,
      target: target(recipe), parts: mats.map(function () { return 0; }), placed: mats.map(function () { return false; }),
      history: [], moves: [], rules: opts.rules || {}, catalyst: opts.catalyst || null };
  }
  function canPlace(s, mi, x, y) {
    return mi >= 0 && mi < s.mats.length && !s.placed[mi] && y === 0 && x >= 1 && x <= D.PALETTE_MAX_PARTS && x === Math.floor(x);
  }
  function mixOf(s) {
    var sum = [0, 0, 0], n = 0;
    s.mats.forEach(function (m, i) {
      if (!s.parts[i]) return;
      var c = rgbOf(m);
      for (var k = 0; k < 3; k++) sum[k] += c[k] * s.parts[i];
      n += s.parts[i];
    });
    return n ? sum.map(function (v) { return Math.round(v / n); }) : null;
  }
  function dE(s) {
    var mix = mixOf(s);
    return mix ? C().deltaE(C().rgbToLab(mix), C().rgbToLab(s.target)) : null;
  }
  function place(s, mi, x, y) {
    if (!canPlace(s, mi, x, y)) return { ok: false };
    var before = dE(s);
    s.history.push({ parts: s.parts.slice(), placed: s.placed.slice() });
    s.parts[mi] = x; s.placed[mi] = true;
    s.moves.push([mi, x, 0, 0]);
    var after = dE(s);
    return { ok: true, recipe: s.recipe, cells: 1, matchCells: before === null || after < before ? 1 : 0, bonusCells: 0, overwritten: 0, dE: after };
  }
  function undo(s) {
    var h = s.history.pop();
    if (!h) return false;
    s.parts = h.parts; s.placed = h.placed;
    s.moves.pop();
    return true;
  }
  function done(s) { return s.placed.every(Boolean); }
  function evaluate(s, final) {
    var gauges = {}, visible = s.parts.map(function (p) { return p > 0 ? 1 : 0; }), covered = 0;
    D.ELEMENTS.forEach(function (e) { gauges[e.id] = 0; });
    s.mats.forEach(function (m, i) { gauges[m.element] += m.power * s.parts[i]; covered += s.parts[i]; });
    var d = dE(s), gBonus = 0, qBonus = 0;
    if (final && d !== null) {
      gBonus = Math.max(0, Math.round((D.PALETTE_GAUGE_DE - d) / 5));
      qBonus = Math.max(0, Math.round((D.PALETTE_QUALITY_DE - d) / 2));
      var seen = {};
      s.recipe.gauges.forEach(function (g) { if (!seen[g.el]) { seen[g.el] = true; gauges[g.el] += gBonus; } });
    }
    var mult = s.cauldron.affinityMult && s.cauldron.affinity && s.cauldron.affinity.indexOf(s.recipe.id) >= 0 ? s.cauldron.affinityMult : 1;
    if (mult !== 1) Object.keys(gauges).forEach(function (k) { gauges[k] = Math.round(gauges[k] * mult); });
    var usedMats = s.mats.filter(function (m, i) { return visible[i] > 0; });
    if (!usedMats.length) usedMats = s.mats;
    var avg = usedMats.reduce(function (a, m) { return a + m.quality; }, 0) / usedMats.length;
    return { gauges: gauges, visible: visible, covered: covered, dominant: null, push: 0, mult: mult, mix: 0, clash: 0, overheat: false, lost: 0,
      quality: Math.max(1, Math.min(100, Math.round(avg + qBonus))), mixRgb: mixOf(s), target: s.target, dE: d, gaugeBonus: gBonus, qualityBonus: qBonus };
  }
  function clone(s) {
    return { method: s.method, recipe: s.recipe, mats: s.mats, cauldron: s.cauldron, ability: s.ability, size: s.size, target: s.target,
      parts: s.parts.slice(), placed: s.placed.slice(), history: [], moves: s.moves.slice(), rules: s.rules, catalyst: s.catalyst };
  }
  function preview(s, mi, x, y, rot) {
    if (!canPlace(s, mi, x, y)) return null;
    var copy = clone(s), before = evaluate(copy, false), info = place(copy, mi, x, y, rot);
    return { before: before, after: evaluate(copy, done(copy)), info: info, cells: [[x, 0]] };
  }
  function options(s, mi) {
    var out = [];
    for (var x = 1; x <= D.PALETTE_MAX_PARTS; x++) if (canPlace(s, mi, x, 0)) out.push([x, 0, 0]);
    return out;
  }

  var impl = { create: create, canPlace: canPlace, place: place, undo: undo, done: done, evaluate: evaluate, preview: preview,
    options: options, target: target, mixOf: mixOf };
  if (typeof module !== "undefined" && module.exports) module.exports = impl;
  else window.PriTestAtelierCore.registerMethod("palette", impl);
})();
