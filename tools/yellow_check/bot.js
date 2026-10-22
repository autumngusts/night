// 黃牌 Yellow Card 的貪婪 AI（balance_check.js／path_check.js 共用）。
// 每張牌都在複製的狀態上試打、評分，挑最好的；不會規劃整回合，所以只當作調整數值的參考。
//   run(seed, seats, opts) → { phase, act, floor, plays: { seat: { cardId: 次數 } } }
//   opts.path：{ seat: pathId }——該英雄的戰利品只拿這條成長方向的卡、升級也優先升這條方向（測試特化路線）
"use strict";

global.window = global;
require("../../static_src/yellow_data.js");
require("../../static_src/yellow_core.js");
var D = global.PriTestYellowData;
var Core = global.PriTestYellowCore;

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// 預計受到的傷害（扣掉護盾）
function incoming(st) {
  var by = {};
  st.enemies.forEach(function (e) {
    Core.effActs(st, e).forEach(function (a) {
      if (a.k !== "atk") return;
      Core.actTargets(st, e, a).forEach(function (s) { by[s] = (by[s] || 0) + Core.enemyHitValue(st, e, a.n, s) * (a.h || 1); });
    });
  });
  var tot = 0;
  Core.alive(st).forEach(function (h) { tot += Math.max(0, (by[h.seat] || 0) - h.blk); });
  return tot;
}

function evalState(st) {
  if (st.phase !== "battle") return st.phase === "lose" ? -1e6 : 1e5;
  var v = 0;
  st.enemies.forEach(function (e) {
    v -= Math.max(0, e.hp - 1.5 * e.st.poison - 1.2 * e.st.burn) + 8 + e.blk * 0.3;
    v += 2 * e.st.vuln + 2 * e.st.weak + 6 * e.st.stun;
  });
  v -= 1.4 * incoming(st);
  Core.heroes(st).forEach(function (h) {
    v += h.down ? -40 : 0.9 * h.hp + 3 * h.str + 0.5 * h.hand.length;
    Object.keys(h.pw).forEach(function (k) { v += 6 * h.pw[k]; });
    v += 1.5 * (h.st.regen || 0) + 3 * (h.sp || 0) + 1.2 * (h.mel || 0) + 0.6 * (h.trap || 0);
  });
  return v;
}

function bestPlay(st, h) {
  var base = evalState(st), best = null;
  h.hand.forEach(function (c) {
    if (!Core.canPlay(st, h, c)) return;
    var d = Core.cardDef(c), vt = Core.validTargets(st, h, c);
    var tgs = d.tgt === "enemy" ? vt.e.map(function (u) { return { e: u }; }) : (d.tgt === "ally" || d.tgt === "down") ? vt.s.map(function (s) { return { s: s }; }) : [null];
    tgs.forEach(function (tg) {
      var s2 = clone(st);
      if (Core.apply(s2, "local", { t: "play", s: h.seat, u: c.u, tg: tg })) return;
      var sc = evalState(s2) - base - d.cost * 0.5;
      if (!best || sc > best.sc) best = { sc: sc, u: c.u, id: c.id, tg: tg };
    });
  });
  return best && best.sc > 0.3 ? best : null;
}

// 營火／寶箱以外的選擇：路線模式只拿該路線的卡，否則拿第一張
function choose(st, h, opts) {
  var pd = h.pend;
  var want = opts && opts.path ? opts.path[h.seat] : null;
  var hd = D.CLASS[h.cls];
  var wantIdx = want ? hd.paths.map(function (p) { return p.id; }).indexOf(want) : -1;
  var isPath = function (id) { return !want || D.CARD[id].path === want; };
  if (pd.k === "card") {
    if (wantIdx >= 0) return pd.opts[wantIdx] ? { id: pd.opts[wantIdx] } : { skip: true };
    return { id: pd.opts[0] };
  }
  if (pd.k === "relic") return { id: pd.opts[0] };
  if (pd.k === "shop") {
    // 先買遺物，再買路線卡，最後有錢就刪一張起始卡；都買不起就離開
    var ri = pd.relics.filter(function (x) { return !x.sold && x.price <= h.gold; })[0];
    if (ri) return { buy: "relic", i: pd.relics.indexOf(ri) };
    var ci = pd.cards.filter(function (x) { return !x.sold && x.price <= h.gold && isPath(x.id); })[0];
    if (ci) return { buy: "card", i: pd.cards.indexOf(ci) };
    if (h.gold >= Core.removePrice(h) && h.deck.length > 8 && !pd.removedOnce) { pd.removedOnce = true; return { kind: "remove" }; }
    return { done: true };
  }
  if (pd.k === "rest") return { kind: h.hp < h.max * 0.7 ? "heal" : "upgrade" };
  if (pd.k === "treasure") {
    if (pd.relic) return { kind: "relic" };
    var t = pd.opts.filter(isPath)[0];
    return t ? { id: t } : { kind: "maxhp" };
  }
  if (pd.k === "upgrade") {
    var up = h.deck.filter(function (x) { return !x.up && D.CARD[x.id].path && isPath(x.id); });
    if (!up.length) up = h.deck.filter(function (x) { return !x.up; });
    return up.length ? { u: up[0].u } : { back: true };
  }
  if (pd.k === "remove") {
    var basic = h.deck.filter(function (x) { return D.CARD[x.id].rar === "basic"; });
    return { u: (basic[0] || h.deck[0]).u };
  }
  return { skip: true };
}

function run(seed, seats, opts) {
  var st = Core.create({ seed: seed, seats: seats });
  var plays = {};
  var guard = 0;
  while (st.phase !== "win" && st.phase !== "lose" && guard++ < 60000) {
    if (st.phase === "map") {
      var hpRatio = Core.heroes(st).reduce(function (a, h) { return a + h.hp / h.max; }, 0) / Core.heroes(st).length;
      var i = st.options.indexOf(hpRatio < 0.5 ? "rest" : "battle");
      if (i < 0) i = st.options.indexOf("treasure");
      if (i < 0) i = 0;
      Core.apply(st, "local", { t: "vote", i: i });
    } else if (st.phase === "battle") {
      var h = Core.alive(st).filter(function (x) { return !x.done; })[0];
      var p = bestPlay(st, h);
      if (p) {
        var pl = plays[h.seat] = plays[h.seat] || {};
        pl[p.id] = (pl[p.id] || 0) + 1;
        Core.apply(st, "local", { t: "play", s: h.seat, u: p.u, tg: p.tg });
      } else Core.apply(st, "local", { t: "end", s: h.seat });
    } else {
      var hh = Core.heroes(st).filter(function (x) { return x.pend; })[0];
      if (!hh) break;
      var err = Core.apply(st, "local", { t: "choose", s: hh.seat, c: choose(st, hh, opts) });
      if (err) Core.apply(st, "local", { t: "choose", s: hh.seat, c: { skip: true, back: true, done: true } });
    }
  }
  return { phase: st.phase, act: st.act, floor: st.floor, plays: plays, st: st };
}

module.exports = { run: run, Core: Core, D: D };
