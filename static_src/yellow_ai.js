// 黃牌 Yellow Card：AI 隊友（2026-10-23 使用者指定：Hellcard 的 AI 補位，單人也能帶 AI 同伴）。
// 貪婪 AI：每張牌都在複製的狀態上試打、評分，挑最好的；不規劃整回合。tools/yellow_check/bot.js 也用這一份。
//   next(st, seat, opts) → 這位英雄現在該送出的 action（沒有要做的事回傳 null）
//   opts.path：{ seat: pathId }——戰利品只拿這條成長方向（測試特化路線用）
//   opts.tmod：true＝也由 AI 選無盡模式的苦痛修正（只有測試用；遊戲裡由玩家選）
// AI 英雄的 ctrl 是 "ai"；本機模式由這台裝置、連線模式由房主代為送出。
(function (root) {
  "use strict";

  var D = root.PriTestYellowData;
  var Core = root.PriTestYellowCore;
  if (!D || !Core) return;

  var CTRL = "ai";

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

  // me：出牌的英雄 seat（其他還沒結束回合的隊友手上的魔力與手牌才算價值；自己的魔力看出牌成本）
  function evalState(st, me) {
    if (st.phase !== "battle") return st.phase === "lose" ? -1e6 : 1e5;
    var v = 0;
    st.enemies.forEach(function (e) {
      v -= Math.max(0, e.hp - 1.5 * e.st.poison - 1.2 * e.st.burn) + 8 + e.blk * 0.3;
      // 會分裂的敵人：倒下後會生出的小怪先算進去（否則 AI 會覺得打死牠局面變差而一直不出手）
      var sp = D.ENEMY[e.id] && D.ENEMY[e.id].split;
      if (sp) v -= sp.n * (D.ENEMY[sp.id].hp[1] + 8);
      v += 2 * e.st.vuln + 2 * e.st.weak + 6 * e.st.stun;
    });
    v -= 1.4 * incoming(st);
    Core.heroes(st).forEach(function (h) {
      v += h.down ? -40 : 0.9 * h.hp + 3 * h.str + 0.5 * h.hand.length;
      Object.keys(h.pw).forEach(function (k) { v += 6 * h.pw[k]; });
      v += 1.5 * (h.st.regen || 0) + 3 * (h.sp || 0) + 1.2 * (h.mel || 0) + 0.6 * (h.trap || 0);
      // 氣、姿態、延遲效果（下回合才發動，當下的局面看不到）、手上的藥水
      v += 1.0 * (h.chi || 0) + (h.form ? 3 : 0) + 1.5 * (h.flux || 0) + 1.0 * (h.rg || 0);
      (h.later || []).forEach(function (x) {
        x.fx.forEach(function (f) {
          if (f.o === "dmg") v += 0.9 * f.n * (f.h || 1);
          else if (f.o === "dmgAll") v += 0.9 * f.n * Math.max(1, st.enemies.length);
          else if (f.o === "blk" || f.o === "blkAll" || f.o === "heal") v += 0.6 * f.n;
          else if (f.o === "draw" || f.o === "mana") v += 2 * f.n;
          else if (f.o === "lose") v -= 0.9 * f.n;
        });
      });
      h.hand.forEach(function (c) { if (D.CARD[c.id] && D.CARD[c.id].rar === "token") v += 2.5; });
      // 給隊友的魔力與抽牌（頌歌）：隊友還能用時才有價值
      if (me != null && h.seat !== me && !h.down && !h.done) v += 2 * h.mana + 1 * h.hand.length;
    });
    return v;
  }

  // 最好的一張牌與目標；沒有值得打的回傳 null
  function bestPlay(st, h) {
    var base = evalState(st, h.seat), best = null;
    h.hand.forEach(function (c) {
      if (!Core.canPlay(st, h, c)) return;
      var d = Core.cardDef(c), vt = Core.validTargets(st, h, c);
      var tgs = d.tgt === "enemy" ? vt.e.map(function (u) { return { e: u }; }) : (d.tgt === "ally" || d.tgt === "down") ? vt.s.map(function (s) { return { s: s }; }) : [null];
      // 指定範圍卡：範圍圈放在每個可打的敵人身上試試看
      if (d.tgt === "area") {
        var pos = Core.layout(st).e;
        tgs = vt.e.map(function (u) { return { x: pos[u].x, y: pos[u].y }; });
      }
      tgs.forEach(function (tg) {
        var s2 = clone(st);
        if (Core.apply(s2, h.ctrl, { t: "play", s: h.seat, u: c.u, tg: tg })) return;
        var sc = evalState(s2, h.seat) - base - d.cost * 0.5;
        if (!best || sc > best.sc) best = { sc: sc, u: c.u, id: c.id, tg: tg };
      });
    });
    return best && best.sc > 0.3 ? best : null;
  }

  // 戰鬥以外的選擇：路線模式只拿該路線的卡，否則拿第一張
  function choice(st, h, opts) {
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
    if (pd.k === "rest") return { kind: h.hp < h.max * 0.7 ? "heal" : "upgrade" };
    if (pd.k === "altar") {
      // 祭壇：血量充足才付生命；刪卡類只要牌組夠大就接受
      var al = pd.a || "blood";
      if (al === "blood") return pd.relic && h.max > D.ALTAR_HP * 4 ? { kind: "accept" } : { skip: true };
      if (al === "purify" || al === "trade") return h.deck.length > 5 ? { kind: "accept" } : { skip: true };
      if (al === "war") return h.hp > h.max * 0.6 ? { kind: "accept" } : { skip: true };
      return { kind: "accept" };
    }
    if (pd.k === "sanctum") return (h.perk || 0) < D.MAX_PERK ? { kind: "perk" } : pd.opts[0] ? { id: pd.opts[0] } : { skip: true };
    if (pd.k === "upgrade") {
      var up = h.deck.filter(function (x) { return !x.up && D.CARD[x.id].path && isPath(x.id); });
      if (!up.length) up = h.deck.filter(function (x) { return !x.up; });
      return up.length ? { u: up[0].u } : { back: true };
    }
    if (pd.k === "remove" && !pd.back && !h.deck.some(function (x) { return D.CARD[x.id].rar === "token" || D.CARD[x.id].rar === "basic"; })) return { back: true };
    if (pd.k === "remove") {
      // 詛咒優先，再來是基本牌
      var bad = h.deck.filter(function (x) { return D.CARD[x.id].rar === "token"; });
      var basic = h.deck.filter(function (x) { return D.CARD[x.id].rar === "basic"; });
      return { u: (bad[0] || basic[0] || h.deck[0]).u };
    }
    return { skip: true };
  }

  // 目的地：有隊友倒下先救人，血少選營火，否則依偏好順序（血量充足才去菁英）
  function destIndex(h) {
    var pref = h.hp < h.max * 0.5 ? ["shrine", "camp", "spoils", "smithy", "sanctum", "altar", "treasure", "elite"]
      : ["shrine", "spoils", h.hp > h.max * 0.75 ? "elite" : "camp", "sanctum", "treasure", "smithy", "altar", "camp", "elite"];
    var best = 0, bi = 99;
    (h.dests || []).forEach(function (d, i) { var k = pref.indexOf(d); if (k < 0) k = 50; if (k < bi) { bi = k; best = i; } });
    return best;
  }

  // 這位英雄現在該送出的 action（不負責送出）
  function next(st, seat, opts) {
    var h = Core.hero(st, seat);
    if (!h) return null;
    if (st.phase === "map") {
      // 苦痛修正：挑強度最低的
      if (st.tmodPick && opts && opts.tmod) {
        var lo = 0;
        st.tmodPick.forEach(function (m, i) { if (m.pw * m.left < st.tmodPick[lo].pw * st.tmodPick[lo].left) lo = i; });
        return { t: "tmod", i: lo };
      }
      return h.dest ? null : { t: "dest", s: seat, i: destIndex(h) };
    }
    if (st.phase === "battle") {
      if (h.down || h.done) return null;
      var p = bestPlay(st, h);
      return p ? { t: "play", s: seat, u: p.u, tg: p.tg, id: p.id } : { t: "end", s: seat };
    }
    if (h.pend) return { t: "choose", s: seat, c: choice(st, h, opts) };
    return null;
  }

  // 選擇被拒絕時的退路（跳過／返回／離開）
  var FALLBACK = { t: "choose", c: { skip: true, back: true, done: true } };

  root.PriTestYellowAI = { CTRL: CTRL, next: next, evalState: evalState, bestPlay: bestPlay, fallback: function (seat) { return { t: "choose", s: seat, c: FALLBACK.c }; } };
})(typeof window !== "undefined" ? window : this);
