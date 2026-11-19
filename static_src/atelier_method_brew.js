// 煉金術士（atelier）：調和方式③「熬煮」（翠的工房）。規則依據 docs/atelier_design.md §11.3。純規則，不碰 DOM。
// 每投入一個素材先選火候（加水／小火／大火），溫度落在素材屬性的理想區間時效果最好。
// place(s, mi, heat 0..2, 0, 0)；options 列出 3 種火候。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestAtelierData;

  function clampT(t) { return Math.max(0, Math.min(D.BREW_MAX, t)); }
  function create(recipe, mats, cauldron, ability, opts) {
    opts = opts || {};
    return { method: "brew", recipe: recipe, mats: mats, cauldron: cauldron, ability: ability || {}, size: D.BREW_HEATS.length,
      temp: D.BREW_START, log: [], placed: mats.map(function () { return false; }), history: [], moves: [],
      rules: opts.rules || {}, catalyst: opts.catalyst || null };
  }
  function canPlace(s, mi, x, y) {
    return mi >= 0 && mi < s.mats.length && !s.placed[mi] && y === 0 && x >= 0 && x < D.BREW_HEATS.length && x === Math.floor(x);
  }
  // 投入後的溫度與效率（理想區間內 ×2、差 BREW_NEAR 以內 ×1、更遠 ×0.5）
  function heatResult(temp, m, x) {
    var t = clampT(temp + D.BREW_HEATS[x] + (D.BREW_MAT_HEAT[m.element] || 0)), z = D.BREW_ZONES[m.element];
    var dist = t < z[0] ? z[0] - t : t > z[1] ? t - z[1] : 0;
    return { temp: t, dist: dist, mult: dist === 0 ? 2 : dist <= D.BREW_NEAR ? 1 : 0.5 };
  }
  function place(s, mi, x, y) {
    if (!canPlace(s, mi, x, y)) return { ok: false };
    s.history.push({ temp: s.temp, log: s.log.slice(), placed: s.placed.slice() });
    var r = heatResult(s.temp, s.mats[mi], x);
    s.temp = r.temp;
    s.log.push({ mi: mi, heat: x, temp: r.temp, mult: r.mult });
    s.placed[mi] = true;
    s.moves.push([mi, x, 0, 0]);
    return { ok: true, recipe: s.recipe, cells: 1, matchCells: r.dist === 0 ? 1 : 0, bonusCells: 0, overwritten: 0, temp: r.temp, mult: r.mult };
  }
  function undo(s) {
    var h = s.history.pop();
    if (!h) return false;
    s.temp = h.temp; s.log = h.log; s.placed = h.placed;
    s.moves.pop();
    return true;
  }
  function done(s) { return s.placed.every(Boolean); }
  function evaluate(s, final) {
    var gauges = {}, visible = s.mats.map(function () { return 0; }), byEl = {}, inZone = 0;
    D.ELEMENTS.forEach(function (e) { gauges[e.id] = 0; byEl[e.id] = 0; });
    s.log.forEach(function (l) {
      var m = s.mats[l.mi];
      gauges[m.element] += Math.round(m.shape.length * m.power * l.mult);
      visible[l.mi] = 1; byEl[m.element]++;
      if (l.mult === 2) inZone++;
    });
    var covered = s.log.length, dominant = null, push = 0;
    if (final && covered > 0) {
      D.ELEMENTS.forEach(function (e) { if (!dominant || byEl[e.id] > byEl[dominant]) dominant = e.id; });
      push = Math.round(gauges[dominant] * (byEl[dominant] / covered) * D.FINAL_PUSH_RATE);
      gauges[dominant] += push;
    }
    var mult = s.cauldron.affinityMult && s.cauldron.affinity && s.cauldron.affinity.indexOf(s.recipe.id) >= 0 ? s.cauldron.affinityMult : 1;
    if (mult !== 1) Object.keys(gauges).forEach(function (k) { gauges[k] = Math.round(gauges[k] * mult); });
    var usedMats = s.mats.filter(function (m, i) { return visible[i] > 0; });
    if (!usedMats.length) usedMats = s.mats;
    var avg = usedMats.reduce(function (a, m) { return a + m.quality; }, 0) / usedMats.length;
    var quality = Math.max(1, Math.min(100, Math.round(avg + s.cauldron.qualityPerCell * inZone * 3)));
    var boil = s.temp >= D.BREW_BOIL;
    return { gauges: gauges, visible: visible, covered: covered, dominant: dominant, push: push, quality: quality, mult: mult,
      mix: 0, clash: 0, overheat: boil, boil: boil, temp: s.temp, inZone: inZone, lost: 0 };
  }
  function clone(s) {
    return { method: s.method, recipe: s.recipe, mats: s.mats, cauldron: s.cauldron, ability: s.ability, size: s.size,
      temp: s.temp, log: s.log.slice(), placed: s.placed.slice(), history: [], moves: s.moves.slice(), rules: s.rules, catalyst: s.catalyst };
  }
  function preview(s, mi, x, y, rot) {
    if (!canPlace(s, mi, x, y)) return null;
    var copy = clone(s), before = evaluate(copy, false), info = place(copy, mi, x, y, rot);
    return { before: before, after: evaluate(copy, done(copy)), info: info, cells: [[x, 0]] };
  }
  function options(s, mi) {
    var out = [];
    for (var x = 0; x < D.BREW_HEATS.length; x++) if (canPlace(s, mi, x, 0)) out.push([x, 0, 0]);
    return out;
  }

  var impl = { create: create, canPlace: canPlace, place: place, undo: undo, done: done, evaluate: evaluate, preview: preview,
    options: options, heatResult: heatResult };
  if (typeof module !== "undefined" && module.exports) module.exports = impl;
  else window.PriTestAtelierCore.registerMethod("brew", impl);
})();
