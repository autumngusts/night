// 鐵拳教育：簡單的自動玩家（core_check.js 與 ui/net 測試共用）。
//   botAction(Core, D, st, seat, { Fight, skill }) 回傳下一個要送的操作（{ t: ... }），沒事做時回傳 end。
//   開打時用 fist_fight.js 的格鬥引擎實際模擬一場（simFight），skill 0〜1＝反應多準（1＝每次都抓準見切）。
"use strict";

function simFight(Fight, D, st, h, skill, seed) {
  var foes = st.bullies.filter(function (b) { return b.x === h.x && b.y === h.y; }).map(function (b) {
    var d = D.ENEMY[b.id];
    return { u: b.u, id: b.id, hp: b.hp, max: b.max, atk: d.atk, boss: !!b.boss, wall: b.wall || 0, stun: !!b.stun };
  });
  var e = Fight.createEngine({ pow: h.pow, talk: h.talk, ult: D.CLASS[h.cls].ult.id, heat: h.heat, hp: h.hp, max: h.max, foes: foes, seed: seed });
  var s = (seed + 99) & 0x7fffffff;
  var rnd = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  var dt = 1 / 60;
  for (var i = 0; i < 60 * 30 && !e.over; i++) {
    e.tick(dt);
    e.events.length = 0;
    if (e.intro > 0 || e.freeze > 0) continue;
    // 每次對手蓄力只決定一次「這次有沒有反應過來」
    e.foes.forEach(function (f) {
      if (f.phase === "wind" && f.react === undefined) f.react = rnd() < skill;
      if (f.phase !== "wind") f.react = undefined;
    });
    var danger = e.foes.filter(function (f) { return f.phase === "wind" && f.timer < 0.16 && f.react; })[0];
    if (danger) e.input("guardOn");
    else e.input("guardOff");
    if (e.me.heat >= D.MAX_HEAT && !e.me.ult && rnd() < 0.05) e.input("ult");
    var windUp = e.foes.filter(function (f) { return f.phase === "wind" && f.timer > 0.35 && f.wall <= 0; })[0];
    if (windUp && windUp.react && !e.me.guard) { e.input("target", e.foes.indexOf(windUp)); e.input("kick"); }
    else if (!e.me.guard && rnd() < 0.5) e.input("punch");
  }
  return e.result();
}

function botAction(Core, D, st, seat, opts) {
  opts = opts || {};
  var h = Core.teacher(st, seat);
  var here = Core.bulliesAt(st, h.x, h.y);
  var boss = Core.boss(st);
  var cls = D.CLASS[h.cls];
  var proof = Core.hasProof(st, h.x, h.y);

  function weakest(list) { return list.slice().sort(function (a, b) { return a.hp - b.hp; })[0]; }
  function stepTo(target) {
    if (h.steps <= 0) return null;
    var best = null;
    D.TILES.forEach(function (t) {
      if (!Core.canMoveTo(h, t.x, t.y, h.steps)) return;
      var d = Core.dist(t, target);
      if (!best || d < best.d || (d === best.d && Core.dist(h, t) < Core.dist(h, best.t))) best = { d: d, t: t };
    });
    return best && best.d < Core.dist(h, target) ? { t: "move", s: seat, x: best.t.x, y: best.t.y } : null;
  }
  function fight() {
    var r = opts.Fight ? simFight(opts.Fight, D, st, h, opts.skill === undefined ? 0.6 : opts.skill, (st.logSeq * 31 + seat) | 0)
      : { hits: [], taken: 0, combo: 0, ult: false, fist: false };
    return { t: "fight", s: seat, r: r };
  }

  if (h.hp <= 3 && h.ap >= 1) {
    var tt = Core.tileAt(h.x, h.y).type;
    if ((tt === "office" || tt === "nurse") && h.hp < h.max) return { t: "rest", s: seat };
  }

  if (h.heat >= D.MAX_HEAT && h.ap >= 2) {
    if (cls.ult.id === "viral" && (st.comp >= 3 || st.evid < 3)) return { t: "ult", s: seat };
    if (cls.ult.id === "speech" && (st.dark >= 6 || (boss && boss.wall > 0))) return { t: "ult", s: seat };
  }

  if (here.length && h.ap >= 1) {
    if (boss && boss.x === h.x && boss.y === h.y && boss.wall > 0 && st.evid > 0) return { t: "expose", s: seat };
    var common = here.filter(function (b) { return !Core.walled(b); });
    var needEvid = st.evid < (boss ? boss.wall / 2 : 4) || st.comp >= 4;
    if (!proof && needEvid && !st.searched[Core.key(h.x, h.y)]) return { t: "search", s: seat };
    if (h.cd === 0 && (cls.skill.id === "glare" || (cls.skill.id === "recorder" && !st.rec[Core.key(h.x, h.y)]))) return { t: "skill", s: seat };
    if (Core.victimsAt(st, h.x, h.y).some(function (v) { return v.hp <= 2; }) && !h.guard) return { t: "guard", s: seat };
    if (common.length) {
      if (h.talk > h.pow || (!proof && st.comp >= 6)) return { t: "talk", s: seat, b: weakest(common).u };
      return fight();
    }
  }

  if (h.ap >= 1 && h.cd === 0 && cls.skill.id === "cctv") {
    var spot = st.bullies.filter(function (b) { return !b.boss && !Core.hasProof(st, b.x, b.y); })[0];
    if (spot) return { t: "skill", s: seat, x: spot.x, y: spot.y };
  }
  if (h.ap >= 1 && h.cd === 0 && cls.skill.id === "counsel" && st.victims.some(function (v) { return Core.dist(v, h) <= 1 && v.hp < v.max; })) return { t: "skill", s: seat };

  if (boss && boss.wall > 0 && st.evid > 0 && h.ap >= 1) {
    var bc = D.TILE.broadcast;
    if (h.x === bc.x && h.y === bc.y) return { t: "expose", s: seat };
    var mvB = Core.dist(h, boss) > Core.dist(h, bc) + 1 ? stepTo(bc) : stepTo(boss);
    if (mvB) return mvB;
  }

  // 往最近的霸凌現場（有學生的優先），權力者壁破了就去打權力者
  var targets = st.victims.length ? st.victims : st.bullies;
  if (boss && boss.wall <= 0) targets = [boss];
  var near = targets.slice().sort(function (a, b) { return Core.dist(h, a) - Core.dist(h, b); })[0];
  if (near && Core.dist(h, near) > 0) {
    if (cls.skill.id === "dash" && h.cd === 0 && h.ap >= 1 && Core.dist(h, near) > h.steps) return { t: "skill", s: seat };
    var mv = stepTo(near);
    if (mv) return mv;
  }
  return { t: "end", s: seat, on: true };
}

module.exports = { botAction: botAction, simFight: simFight };
