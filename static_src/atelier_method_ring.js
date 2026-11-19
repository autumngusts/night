// 煉金術士（atelier）：調和方式②「循環」（茜的工房）。規則依據 docs/atelier_design.md §11.2。純規則，不碰 DOM。
// 8 個節點的屬性環：素材的量（格數×屬性值）從起點順時針倒入，節點滿了流到下一個，環滿後多的量損失。
// place(s, mi, startNode, 0, 0)；options 列出 8 個起點。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestAtelierData;

  // 節點屬性：配方兩條量表的屬性交錯，其餘補上其他屬性（同一個配方永遠相同）
  function nodeElements(recipe) {
    var g = recipe.gauges.map(function (x) { return x.el; }), a = g[0], b = g[1] || g[0];
    var others = D.ELEMENTS.map(function (e) { return e.id; }).filter(function (e) { return g.indexOf(e) < 0; });
    return [a, b, others[0], a, b, others[1], a, others[2] || b];
  }
  function amount(m) { return m.shape.length * m.power; }
  function used(node) { return node.fill.reduce(function (s, f) { return s + f.n; }, 0); }
  function create(recipe, mats, cauldron, ability, opts) {
    opts = opts || {};
    return { method: "ring", recipe: recipe, mats: mats, cauldron: cauldron, ability: ability || {}, size: D.RING_NODES,
      nodes: nodeElements(recipe).map(function (el) { return { el: el, fill: [] }; }), lost: 0,
      placed: mats.map(function () { return false; }), history: [], moves: [], rules: opts.rules || {}, catalyst: opts.catalyst || null };
  }
  function canPlace(s, mi, x, y) {
    return mi >= 0 && mi < s.mats.length && !s.placed[mi] && y === 0 && x >= 0 && x < D.RING_NODES && x === Math.floor(x);
  }
  function snapshot(s) {
    return { nodes: s.nodes.map(function (n) { return { el: n.el, fill: n.fill.map(function (f) { return { mi: f.mi, n: f.n }; }) }; }),
      placed: s.placed.slice(), lost: s.lost };
  }
  function place(s, mi, x, y) {
    if (!canPlace(s, mi, x, y)) return { ok: false };
    s.history.push(snapshot(s));
    var m = s.mats[mi], left = amount(m), info = { ok: true, recipe: s.recipe, cells: 0, matchCells: 0, bonusCells: 0, overwritten: 0, nodes: [] };
    for (var k = 0; k < D.RING_NODES && left > 0; k++) {
      var idx = (x + k) % D.RING_NODES, node = s.nodes[idx], free = D.RING_CAP - used(node);
      if (free <= 0) continue;
      var put = Math.min(free, left);
      node.fill.push({ mi: mi, n: put });
      left -= put; info.cells += put; info.nodes.push(idx);
      if (node.el === m.element) info.matchCells += put;
      if (used(node) >= D.RING_CAP) info.bonusCells++;          // 這一手關閉的節點
    }
    s.lost += left;
    info.overwritten = left;
    s.placed[mi] = true;
    s.moves.push([mi, x, 0, 0]);
    return info;
  }
  function undo(s) {
    var h = s.history.pop();
    if (!h) return false;
    s.nodes = h.nodes; s.placed = h.placed; s.lost = h.lost;
    s.moves.pop();
    return true;
  }
  function done(s) { return s.placed.every(Boolean); }
  function evaluate(s, final) {
    var gauges = {}, visible = s.mats.map(function () { return 0; }), closedBy = {}, covered = 0, closed = 0;
    D.ELEMENTS.forEach(function (e) { gauges[e.id] = 0; closedBy[e.id] = 0; });
    s.nodes.forEach(function (node) {
      node.fill.forEach(function (f) {
        var m = s.mats[f.mi];
        gauges[m.element] += f.n * (m.element === node.el ? D.RING_MATCH_MULT : 1);
        visible[f.mi] += f.n; covered += f.n;
      });
      if (used(node) >= D.RING_CAP) { gauges[node.el] += D.RING_CLOSE_BONUS; closed++; closedBy[node.el]++; }
    });
    var dominant = null, push = 0;
    if (final && closed > 0) {
      D.ELEMENTS.forEach(function (e) { if (!dominant || closedBy[e.id] > closedBy[dominant]) dominant = e.id; });
      push = Math.round(gauges[dominant] * (closedBy[dominant] / closed) * D.FINAL_PUSH_RATE);
      gauges[dominant] += push;
    }
    var mult = s.cauldron.affinityMult && s.cauldron.affinity && s.cauldron.affinity.indexOf(s.recipe.id) >= 0 ? s.cauldron.affinityMult : 1;
    if (mult !== 1) Object.keys(gauges).forEach(function (k) { gauges[k] = Math.round(gauges[k] * mult); });
    var usedMats = s.mats.filter(function (m, i) { return visible[i] > 0; });
    if (!usedMats.length) usedMats = s.mats;
    var fq = s.ability.fireQuality || 0;                            // 茜的能力：火屬性素材品質 +10
    var avg = usedMats.reduce(function (a, m) { return a + Math.min(100, m.quality + (m.element === "fire" ? fq : 0)); }, 0) / usedMats.length;
    var quality = Math.max(1, Math.min(100, Math.round(avg + s.cauldron.qualityPerCell * closed * 2)));
    return { gauges: gauges, visible: visible, covered: covered, dominant: dominant, push: push, quality: quality, mult: mult,
      mix: 0, clash: 0, overheat: false, lost: s.lost, closed: closed };
  }
  function clone(s) {
    var c = snapshot(s);
    return { method: s.method, recipe: s.recipe, mats: s.mats, cauldron: s.cauldron, ability: s.ability, size: s.size,
      nodes: c.nodes, lost: c.lost, placed: c.placed, history: [], moves: s.moves.slice(), rules: s.rules, catalyst: s.catalyst };
  }
  function preview(s, mi, x, y, rot) {
    if (!canPlace(s, mi, x, y)) return null;
    var copy = clone(s), before = evaluate(copy, false), info = place(copy, mi, x, y, rot);
    return { before: before, after: evaluate(copy, done(copy)), info: info, cells: info.nodes.map(function (i) { return [i, 0]; }) };
  }
  function options(s, mi) {
    var out = [];
    for (var x = 0; x < D.RING_NODES; x++) if (canPlace(s, mi, x, 0)) out.push([x, 0, 0]);
    return out;
  }

  var impl = { create: create, canPlace: canPlace, place: place, undo: undo, done: done, evaluate: evaluate, preview: preview,
    options: options, nodeElements: nodeElements, amount: amount };
  if (typeof module !== "undefined" && module.exports) module.exports = impl;
  else window.PriTestAtelierCore.registerMethod("ring", impl);
})();
