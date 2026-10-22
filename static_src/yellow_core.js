// 黃牌 Yellow Card：規則引擎（純邏輯，不碰 DOM；node 也能跑，見 tools/yellow_check/core_check.js）。
// 整局狀態是一個可 JSON 化的物件 st，所有變動都透過 apply(st, ctrl, action)：
//   本機模式 ctrl 一律是 "local"；連線模式由房主代為套用，ctrl＝送出操作的玩家 cid。
//   英雄的 ctrl 欄位決定誰能操作它（hero.ctrl === ctrl）。
//
// 戰場（使用者指定 2026-10-22）：英雄全部站在圓形戰場中心面向外，戰場依人數切成等分的扇形區
// （st.secs[i]＝第 i 區主人的 seat），每區分內圈 near（近距離）與外圈 far（遠距離）。
//   敵人站在誰的扇形區就攻擊誰；那位英雄倒下時改打順時針方向下一位存活的英雄。
//   英雄可以攻擊任何扇形區的敵人，只受射程限制：near＝內圈、far＝外圈、any＝都可以。
//   Boss 站在外圈但體型巨大，任何射程都打得到；不會被擊退或拉近；「近遠效果不同」的卡對 Boss 用外圈效果。
//   近戰敵人在外圈時攻擊會改成「前進」，遠程敵人在內圈時攻擊會改成「後退」——擊退／拉近就是打斷攻擊。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestYellowData;

  // 升級時數值會加成的 op（n 欄位）
  var BOOST_OPS = { dmg: 1, dmgAll: 1, dmgSec: 1, dmgExec: 1, dmgMissing: 1, dmgSpirit: 1, dmgMel: 1, lifesteal: 1, hexDmg: 1,
    blk: 1, blkAlly: 1, blkAll: 1, blkSpirit: 1, heal: 1, healAll: 1, regen: 1, st: 1, stAll: 1, pow: 1, trap: 1, sac: 1, finale: 1 };
  var NO_BOOST_POW = { mana: 1, spiritTurn: 1, melTurn: 1 };
  var NEG_STATUS = ["weak", "vuln", "poison", "burn"];
  var DEBUFF_TYPES = ["weak", "vuln", "poison", "burn", "stun"];
  var MAX_ENEMIES = 14;
  var LOG_MAX = 120;
  var SPIRIT_DMG = 2;

  // ---------------- 亂數（mulberry32，狀態存在 st.seed 才能存檔／同步） ----------------
  function rnd(st) {
    var t = (st.seed = (st.seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rint(st, n) { return Math.floor(rnd(st) * n); }
  function pick(st, arr) { return arr[rint(st, arr.length)]; }
  function shuffle(st, arr) {
    for (var i = arr.length - 1; i > 0; i--) { var j = rint(st, i + 1); var x = arr[i]; arr[i] = arr[j]; arr[j] = x; }
    return arr;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------------- 卡牌 ----------------
  // 升級：有 up 就照 up 覆寫；沒有就把可加成的數值 +30%（至少 +1），都沒有可加成的數值時費用 −1
  function boostList(list) {
    var boosted = false;
    (list || []).forEach(function (f) {
      if (!BOOST_OPS[f.o] || typeof f.n !== "number" || f.s === "stun" || (f.o === "pow" && NO_BOOST_POW[f.p])) return;
      f.n += Math.max(1, Math.ceil(f.n * 0.3));
      boosted = true;
    });
    return boosted;
  }
  function cardDef(c) {
    var base = D.CARD[c.id];
    if (!base) return null;
    if (!c.up) return base;
    var d = clone(base);
    if (base.up) {
      Object.keys(base.up).forEach(function (k) { d[k] = clone(base.up[k]); });
    } else {
      var b1 = boostList(d.fx), b2 = boostList(d.near), b3 = boostList(d.far);
      if (!b1 && !b2 && !b3 && d.cost > 0) d.cost -= 1;
    }
    return d;
  }

  function newCard(st, id) { st.uid += 1; return { u: st.uid, id: id }; }

  // ---------------- 查詢 ----------------
  function heroes(st) { return st.heroes.filter(function (h) { return !!h; }); }
  function alive(st) { return heroes(st).filter(function (h) { return !h.down; }); }
  function hero(st, seat) { return st.heroes[seat] || null; }
  function enemy(st, u) { for (var i = 0; i < st.enemies.length; i++) if (st.enemies[i].u === u) return st.enemies[i]; return null; }
  function sectorCount(st) { return st.secs.length; }
  function secOf(st, seat) { return st.secs.indexOf(seat); }
  function secOwner(st, sec) { return hero(st, st.secs[sec]); }
  function isBoss(e) { var d = D.ENEMY[e.id]; return !!(d && d.boss); }
  // 遺物效果加總（fx 的數值欄位）
  function relicSum(h, key) {
    var n = 0;
    (h.relics || []).forEach(function (id) { var r = D.RELIC[id]; if (r && typeof r.fx[key] === "number") n += r.fx[key]; });
    return n;
  }
  // 「近遠效果不同」的卡要看目標在哪一圈：Boss 算外圈
  function ringOf(e) { return isBoss(e) ? "far" : e.ring; }

  // 某射程打得到的敵人（任何扇形區）
  function inRange(st, rng) {
    return st.enemies.filter(function (e) {
      if (e.hp <= 0) return false;
      if (!rng || rng === "any" || isBoss(e)) return true;
      return e.ring === rng;
    });
  }

  // 敵人實際會做的事（顯示預測與執行共用）：暈眩／近戰在外圈只能前進／遠程在內圈只能後退
  function effActs(st, e) {
    var def = D.ENEMY[e.id];
    if (e.st.stun > 0) return [{ k: "stun" }];
    var acts = e.intent || [];
    var hasAtk = acts.some(function (a) { return a.k === "atk"; });
    if (hasAtk && def.kind === "melee" && e.ring === "far") return acts.filter(function (a) { return a.k !== "atk"; }).concat([{ k: "move", to: "near" }]);
    if (hasAtk && def.kind === "ranged" && e.ring === "near") return acts.filter(function (a) { return a.k !== "atk"; }).concat([{ k: "move", to: "far" }]);
    return acts;
  }

  function adjacentSec(st, a, b) {
    var n = sectorCount(st);
    if (a === b || n <= 3) return true;
    return (a + 1) % n === b || (b + 1) % n === a;
  }

  // 挑釁中的英雄：敵人所在扇形區或相鄰區的挑釁者（自己區優先）
  function taunter(st, e) {
    var list = alive(st).filter(function (h) { return h.taunt; });
    if (!list.length) return null;
    var own = list.filter(function (h) { return secOf(st, h.seat) === e.sec; });
    if (own.length) return own[0];
    var adj = list.filter(function (h) { return adjacentSec(st, secOf(st, h.seat), e.sec); });
    return adj.length ? adj[0] : null;
  }

  // 自己扇形區的英雄；倒下時順時針找下一位存活者
  function laneTarget(st, e) {
    var n = sectorCount(st);
    for (var k = 0; k < n; k++) {
      var h = secOwner(st, (e.sec + k) % n);
      if (h && !h.down) return h;
    }
    return null;
  }

  // 一個 act 會打到哪些英雄（seat 陣列）
  function actTargets(st, e, act) {
    var a = alive(st);
    if (!a.length) return [];
    var tgt = act.tgt || "lane";
    if (tgt === "all") return a.map(function (h) { return h.seat; });
    var tt = taunter(st, e);
    if (tt) return [tt.seat];
    if (tgt === "low") {
      var low = a.slice().sort(function (x, y) { return (x.hp - y.hp) || (x.seat - y.seat); })[0];
      return [low.seat];
    }
    if (tgt === "rand") {
      var p = hero(st, act.pick);
      return [(p && !p.down ? p : a[0]).seat];
    }
    var l = laneTarget(st, e);
    return l ? [l.seat] : [];
  }

  // 人數縮放：Boss 的攻擊在少人時會全部集中在同一人身上，所以傷害依人數打折；
  // 一般敵人每區各一組，人數多時隊友互相支援較容易，血量略增。數值由 tools/yellow_check/balance_check.js 調整
  var BOSS_HP_BY_PARTY = [0, 0.45, 1.2, 2.3, 4.0];
  var BOSS_DMG_BY_PARTY = [0, 0.5, 0.75, 1, 1.15];
  var HP_BY_PARTY = [0, 0.8, 1, 1.2, 1.6];
  // 幕數成長（加入遺物、金幣、商店後隊伍變強，2026-10-22 用 balance_check 補回難度）
  var HP_BY_ACT = [1.05, 1.25, 1.45];
  var DMG_BY_ACT = [1, 1.12, 1.25];
  var BOSS_HP_MULT = 1.2;
  function partySize(st) { return Math.max(1, Math.min(4, heroes(st).length)); }
  function actOf(st) { return Math.min(st.act, HP_BY_ACT.length - 1); }

  function enemyHitValue(st, e, n, seat) {
    var v = (n + (e.str || 0)) * DMG_BY_ACT[actOf(st)];
    if (isBoss(e)) v = v * BOSS_DMG_BY_PARTY[partySize(st)];
    if (e.st.weak > 0) v = v * 0.75;
    var h = hero(st, seat);
    if (h && h.st.vuln > 0) v = v * 1.5;
    return Math.max(0, Math.floor(v));
  }

  // 英雄打出的傷害：力量、鷹眼（打外圈）、指虎（打內圈）、狂戰士的狂熱（生命一半以下）、虛弱、目標易傷
  function heroHitValue(h, n, ring, e) {
    var v = n + (h.str || 0) + (ring === "far" ? (h.pw.far || 0) : 0) + (ring === "near" ? (h.pw.near || 0) : 0) + (h.pw.frenzy && h.hp * 2 <= h.max ? h.pw.frenzy : 0);
    if (h.st.weak > 0) v = v * 0.75;
    if (e && e.st.vuln > 0) v = v * 1.5;
    return Math.max(0, Math.floor(v));
  }

  // ---------------- 紀錄 ----------------
  function log(st, entry) {
    st.logSeq += 1;
    entry.i = st.logSeq;
    entry.r = st.round;
    st.log.push(entry);
    if (st.log.length > LOG_MAX) st.log.splice(0, st.log.length - LOG_MAX);
  }
  function eref(e) { return { k: "e", id: e.id, u: e.u }; }
  function href(h) { return { k: "h", s: h.seat }; }

  // ---------------- 傷害・狀態 ----------------
  function hitEnemy(st, e, amount, ignoreBlock) {
    if (e.hp <= 0) return 0;
    var absorbed = 0;
    if (!ignoreBlock) { absorbed = Math.min(e.blk, amount); e.blk -= absorbed; }
    var dmg = amount - absorbed;
    e.hp = Math.max(0, e.hp - dmg);
    log(st, { t: "dmg", to: eref(e), n: dmg, b: absorbed });
    if (e.hp <= 0) log(st, { t: "kill", to: eref(e) });
    return dmg;
  }

  // 英雄的攻擊：計算數值後打，血月（leech）吸血
  function heroAttack(st, h, e, base) {
    if (!e || e.hp <= 0) return 0;
    var dealt = hitEnemy(st, e, heroHitValue(h, base, ringOf(e), e), false);
    if (dealt > 0 && h.pw.leech) healHero(st, h, h.pw.leech);
    if (e.hp <= 0 && relicSum(h, "killHeal")) healHero(st, h, relicSum(h, "killHeal"));
    return dealt;
  }

  function hitHero(st, h, amount, ignoreBlock) {
    if (h.down) return 0;
    var absorbed = 0;
    if (!ignoreBlock) { absorbed = Math.min(h.blk, amount); h.blk -= absorbed; }
    var dmg = amount - absorbed;
    h.hp = Math.max(0, h.hp - dmg);
    log(st, { t: "dmg", to: href(h), n: dmg, b: absorbed });
    if (h.hp <= 0) { downHero(st, h); if (h.down) return dmg; }
    if (dmg > 0 && h.pw.rage) { h.str += h.pw.rage; log(st, { t: "str", to: href(h), n: h.pw.rage }); }
    return dmg;
  }

  function downHero(st, h) {
    if (relicSum(h, "revive") && !h.revUsed) {
      h.revUsed = true;
      h.hp = Math.max(1, Math.ceil(h.max * 0.25));
      log(st, { t: "relicRevive", to: href(h) });
      return;
    }
    h.down = true; h.hp = 0; h.blk = 0; h.taunt = false; h.done = true;
    h.disc = h.disc.concat(h.hand); h.hand = [];
    log(st, { t: "down", to: href(h) });
    if (!alive(st).length) { st.phase = "lose"; log(st, { t: "lose" }); }
  }

  function healHero(st, h, n) {
    if (h.down || n <= 0) return 0;
    var v = Math.min(n, h.max - h.hp);
    h.hp += v;
    if (v > 0) log(st, { t: "heal", to: href(h), n: v });
    return v;
  }

  function gainBlock(st, h, n) {
    if (h.down || n <= 0) return;
    h.blk += n;
    log(st, { t: "blk", to: href(h), n: n });
  }

  // 對敵人施加狀態；法師／女巫的被動讓燃燒／中毒多 1
  function addStatus(st, e, s, n, h) {
    if (e.hp <= 0 || n <= 0) return;
    if (h && s === "burn" && h.pw.burnPlus) n += h.pw.burnPlus;
    if (h && s === "poison" && h.pw.poisonPlus) n += h.pw.poisonPlus;
    e.st[s] = (e.st[s] || 0) + n;
    log(st, { t: "st", to: eref(e), s: s, n: n });
  }

  // 陷阱（遊俠，2026-10-22 path_check 後改版）：整場戰鬥有效、可疊加，任何敵人進入內圈都會觸發（不會消失），
  // 所以「擊退 → 敵人前進 → 再踩一次」是陷阱路線的核心循環
  function moveEnemy(st, e, ring) {
    if (e.hp <= 0 || isBoss(e) || e.ring === ring) return;
    e.ring = ring;
    log(st, { t: "move", to: eref(e), z: ring });
    if (ring === "near") {
      alive(st).forEach(function (h) {
        if (h.trap > 0 && e.hp > 0) {
          log(st, { t: "trapHit", to: eref(e), s: h.seat });
          hitEnemy(st, e, h.trap, false);
        }
      });
    }
  }

  function removeDead(st) { st.enemies = st.enemies.filter(function (e) { return e.hp > 0; }); }

  // 精靈攻擊：每隻打自己扇形區的一個隨機敵人，沒有就打任意敵人
  function spiritsAttack(st, h) {
    for (var i = 0; i < h.sp; i++) {
      var live = st.enemies.filter(function (e) { return e.hp > 0; });
      if (!live.length) return;
      var own = live.filter(function (e) { return e.sec === secOf(st, h.seat); });
      var e = pick(st, own.length ? own : live);
      log(st, { t: "spirit", to: eref(e), s: h.seat });
      hitEnemy(st, e, SPIRIT_DMG + (h.pw.spirit || 0), false);
    }
  }

  // ---------------- 牌堆 ----------------
  function drawCards(st, h, n) {
    for (var i = 0; i < n; i++) {
      if (!h.draw.length) {
        if (!h.disc.length) return;
        h.draw = shuffle(st, h.disc);
        h.disc = [];
      }
      h.hand.push(h.draw.pop());
    }
  }

  // ---------------- 敵人生成 ----------------
  function spawnEnemy(st, id, sec, ring, hpMult) {
    var def = D.ENEMY[id];
    if (!def || st.enemies.length >= MAX_ENEMIES) return null;
    var hp = Math.round((def.hp[0] + rint(st, def.hp[1] - def.hp[0] + 1)) * (hpMult || 1));
    st.uid += 1;
    var e = { u: st.uid, id: id, hp: hp, max: hp, blk: 0, str: 0, st: { weak: 0, vuln: 0, poison: 0, burn: 0, stun: 0 },
      sec: sec, ring: def.boss ? "far" : (ring || def.spawn || "far"), pi: 0, last: -1, intent: [] };
    st.enemies.push(e);
    return e;
  }

  function chooseIntent(st, e) {
    var def = D.ENEMY[e.id];
    var idx;
    if (def.cyc === "rand" && def.pat.length > 1) {
      do { idx = rint(st, def.pat.length); } while (idx === e.last);
    } else {
      idx = e.pi % def.pat.length;
      e.pi += 1;
    }
    e.last = idx;
    e.intent = clone(def.pat[idx]);
    var a = alive(st);
    e.intent.forEach(function (act) { if (act.tgt === "rand" && a.length) act.pick = pick(st, a).seat; });
  }

  function hpMultFor(st) { return (1 + 0.08 * st.floor) * HP_BY_PARTY[partySize(st)] * HP_BY_ACT[actOf(st)]; }

  function buildEncounter(st, kind) {
    var act = D.ACTS[st.act];
    var n = sectorCount(st);
    var mult = hpMultFor(st);
    if (kind === "boss") {
      spawnEnemy(st, act.boss, rint(st, n), "far", BOSS_HP_BY_PARTY[partySize(st)] * BOSS_HP_MULT);
      for (var s = 0; s < n; s++) spawnEnemy(st, act.minion, s, null, HP_BY_ACT[actOf(st)]);
      return;
    }
    var eliteSec = kind === "elite" ? rint(st, n) : -1;
    for (var q = 0; q < n; q++) {
      if (q === eliteSec) spawnEnemy(st, pick(st, act.elites), q, "far", mult);
      else pick(st, act.packs).forEach(function (id) { spawnEnemy(st, id, q, null, mult); });
    }
  }

  // ---------------- 戰鬥流程 ----------------
  function resetBattleFields(h) {
    h.blk = 0; h.str = 0; h.taunt = false; h.done = false; h.sp = 0; h.mel = 0; h.trap = 0;
    h.st = { weak: 0, vuln: 0, poison: 0, burn: 0, regen: 0 };
    h.pw = {};
  }

  function startBattle(st, kind) {
    st.phase = "battle";
    st.battleKind = kind;
    st.enemies = [];
    st.round = 1;
    heroes(st).forEach(function (h) {
      h.draw = shuffle(st, clone(h.deck)); h.hand = []; h.disc = []; h.exh = [];
      resetBattleFields(h);
      var ps = D.CLASS[h.cls].passive;
      if (ps) { if (ps.p === "spiritStart") h.sp = ps.n; else h.pw[ps.p] = ps.n; }
      // 遺物的能力類效果
      (h.relics || []).forEach(function (id) {
        var pw = D.RELIC[id] && D.RELIC[id].fx.pw;
        if (pw) Object.keys(pw).forEach(function (k) { h.pw[k] = (h.pw[k] || 0) + pw[k]; });
      });
      h.sp = Math.min(D.MAX_SPIRITS, h.sp + relicSum(h, "spiritStart"));
      h.revUsed = false;
    });
    buildEncounter(st, kind);
    log(st, { t: "battle", kind: kind, act: st.act, floor: st.floor });
    st.enemies.forEach(function (e) { chooseIntent(st, e); });
    alive(st).forEach(function (h) { startHeroTurn(st, h); });
    // 遺物的開戰效果（第一回合的護盾、力量、魔力、抽牌；全隊護盾；敵人虛弱）
    alive(st).forEach(function (h) {
      if (relicSum(h, "battleBlk")) gainBlock(st, h, relicSum(h, "battleBlk"));
      if (relicSum(h, "battleStr")) { h.str += relicSum(h, "battleStr"); log(st, { t: "str", to: href(h), n: relicSum(h, "battleStr") }); }
      h.mana = Math.max(0, h.mana + relicSum(h, "firstMana"));
      if (relicSum(h, "firstDraw") > 0) drawCards(st, h, relicSum(h, "firstDraw"));
      if (relicSum(h, "partyBlk")) alive(st).forEach(function (x) { gainBlock(st, x, relicSum(h, "partyBlk")); });
      if (relicSum(h, "enemyWeak")) st.enemies.forEach(function (e) { addStatus(st, e, "weak", relicSum(h, "enemyWeak"), null); });
    });
  }

  function startHeroTurn(st, h) {
    if (h.down) return;
    h.blk = 0;
    h.done = false;
    h.mana = D.MANA + (h.pw.mana || 0) + relicSum(h, "manaTurn");
    if (h.pw.plate) gainBlock(st, h, h.pw.plate);
    if (h.st.regen > 0) { healHero(st, h, h.st.regen); h.st.regen -= 1; }
    if (h.pw.burnAll) st.enemies.forEach(function (e) { addStatus(st, e, "burn", h.pw.burnAll, null); });
    if (h.pw.poisonAll) st.enemies.forEach(function (e) { addStatus(st, e, "poison", h.pw.poisonAll, null); });
    if (h.pw.healAll) alive(st).forEach(function (x) { healHero(st, x, h.pw.healAll); });
    if (h.pw.melTurn) h.mel = Math.min(D.MAX_MELODY, h.mel + h.pw.melTurn);
    if (h.pw.spiritTurn) h.sp = Math.min(D.MAX_SPIRITS, h.sp + h.pw.spiritTurn);
    drawCards(st, h, Math.max(1, D.HAND_SIZE + relicSum(h, "handPlus")));
  }

  // 英雄回合結束：精靈攻擊、紅牌判定、虛無卡消耗、手牌進棄牌堆、自身中毒／燃燒
  function endHeroTurn(st, h) {
    if (h.down) return;
    if (h.sp > 0) spiritsAttack(st, h);
    var yellows = h.hand.filter(function (c) { return c.id === "t_yellow"; });
    if (yellows.length >= 2) {
      log(st, { t: "red", to: href(h) });
      h.hand = h.hand.filter(function (c) { return c.id !== "t_yellow"; });
      h.exh = h.exh.concat(yellows);
      hitHero(st, h, relicSum(h, "redHalf") ? Math.floor(D.RED_CARD_DMG / 2) : D.RED_CARD_DMG, true);
      if (h.down) return;
    }
    var keep = [];
    h.hand.forEach(function (c) { var d = D.CARD[c.id]; if (d && d.ethereal) h.exh.push(c); else keep.push(c); });
    h.disc = h.disc.concat(keep);
    h.hand = [];
    if (h.st.poison > 0) { hitHero(st, h, h.st.poison, true); h.st.poison -= 1; }
    if (!h.down && h.st.burn > 0) { hitHero(st, h, h.st.burn, true); h.st.burn = Math.floor(h.st.burn / 2); }
  }

  function enemyTurn(st, e) {
    if (e.hp <= 0) return;
    e.blk = 0;
    if (e.st.poison > 0) { hitEnemy(st, e, e.st.poison, true); e.st.poison -= 1; }
    if (e.hp > 0 && e.st.burn > 0) { hitEnemy(st, e, e.st.burn, true); e.st.burn = Math.floor(e.st.burn / 2); }
    if (e.hp <= 0) return;
    var acts = effActs(st, e);
    if (e.st.stun > 0) { e.st.stun -= 1; log(st, { t: "stunned", to: eref(e) }); return; }
    acts.forEach(function (act) {
      if (st.phase !== "battle" || e.hp <= 0) return;
      runEnemyAct(st, e, act);
    });
  }

  function runEnemyAct(st, e, act) {
    if (act.k === "atk") {
      actTargets(st, e, act).forEach(function (seat) {
        for (var i = 0; i < (act.h || 1); i++) {
          var h = hero(st, seat);
          if (!h || h.down || e.hp <= 0) return;
          hitHero(st, h, enemyHitValue(st, e, act.n, seat), false);
          if (h.pw.thorns && !h.down) hitEnemy(st, e, h.pw.thorns, false);
        }
      });
    } else if (act.k === "blk") {
      (act.all ? st.enemies : [e]).forEach(function (x) { if (x.hp > 0) { x.blk += act.n; log(st, { t: "blk", to: eref(x), n: act.n }); } });
    } else if (act.k === "buff") {
      (act.all ? st.enemies : [e]).forEach(function (x) { if (x.hp > 0) { x.str += act.str; log(st, { t: "str", to: eref(x), n: act.str }); } });
    } else if (act.k === "heal") {
      (act.all ? st.enemies : [e]).forEach(function (x) {
        var v = Math.min(act.n, x.max - x.hp);
        if (x.hp > 0 && v > 0) { x.hp += v; log(st, { t: "heal", to: eref(x), n: v }); }
      });
    } else if (act.k === "debuff") {
      actTargets(st, e, act).forEach(function (seat) {
        var h = hero(st, seat);
        h.st[act.s] = (h.st[act.s] || 0) + act.n;
        h.fresh = h.fresh || {};
        h.fresh[act.s] = true; // 這個敵人回合才施加的，回合結束時先不遞減
        log(st, { t: "st", to: href(h), s: act.s, n: act.n });
      });
    } else if (act.k === "curse") {
      actTargets(st, e, act).forEach(function (seat) {
        var h = hero(st, seat);
        for (var i = 0; i < act.n; i++) h.disc.push(newCard(st, act.card));
        log(st, { t: "curse", to: href(h), c: act.card, n: act.n });
      });
    } else if (act.k === "yellow") {
      actTargets(st, e, act).forEach(function (seat) {
        var h = hero(st, seat);
        h.draw.splice(rint(st, h.draw.length + 1), 0, newCard(st, "t_yellow"));
        log(st, { t: "yellow", to: href(h) });
      });
    } else if (act.k === "summon") {
      // Boss 召喚的數量依人數縮放（4 人時照資料，人少時減半以下，至少 1 隻）；其他敵人召喚到自己的扇形區
      var cnt = isBoss(e) ? Math.max(1, Math.ceil(act.n * partySize(st) / 4)) : act.n;
      for (var i = 0; i < cnt; i++) {
        var sec = isBoss(e) ? rint(st, sectorCount(st)) : e.sec;
        var m = spawnEnemy(st, act.id, sec, null, hpMultFor(st));
        if (m) { chooseIntent(st, m); log(st, { t: "summon", to: eref(m) }); }
      }
    } else if (act.k === "move") {
      moveEnemy(st, e, act.to);
    }
  }

  function decay(obj) {
    ["weak", "vuln"].forEach(function (s) { if (obj.st[s] > 0 && !(obj.fresh && obj.fresh[s])) obj.st[s] -= 1; });
    obj.fresh = null;
  }

  // 全員按了結束回合：英雄回合結束 → 敵人依序行動 → 狀態遞減 → 新意圖 → 英雄新回合
  function resolveRound(st) {
    alive(st).forEach(function (h) { endHeroTurn(st, h); });
    if (st.phase !== "battle") return;
    removeDead(st);
    if (checkWin(st)) return;
    log(st, { t: "enemyTurn" });
    st.enemies.slice().forEach(function (e) {
      if (st.phase === "battle") enemyTurn(st, e);
    });
    if (st.phase !== "battle") return;
    removeDead(st);
    if (checkWin(st)) return;
    st.enemies.forEach(decay);
    heroes(st).forEach(function (h) { decay(h); h.taunt = false; });
    st.round += 1;
    log(st, { t: "round" });
    st.enemies.forEach(function (e) { chooseIntent(st, e); });
    alive(st).forEach(function (h) { startHeroTurn(st, h); });
  }

  function maybeResolve(st) {
    var a = alive(st);
    if (st.phase === "battle" && a.length && a.every(function (x) { return x.done; })) resolveRound(st);
  }

  function checkWin(st) {
    removeDead(st);
    if (st.phase !== "battle" || st.enemies.length) return false;
    var kind = st.battleKind;
    log(st, { t: "win", kind: kind });
    heroes(st).forEach(function (h) {
      if (h.down) { h.down = false; h.hp = Math.max(1, Math.ceil(h.max * 0.25)); log(st, { t: "revive", to: href(h) }); }
      h.draw = []; h.hand = []; h.disc = []; h.exh = [];
      resetBattleFields(h);
    });
    if (kind === "boss" && st.act >= D.ACTS.length - 1) { st.phase = "win"; return true; }
    st.phase = "reward";
    heroes(st).forEach(function (h) {
      if (relicSum(h, "endHeal")) healHero(st, h, relicSum(h, "endHeal"));
      gainGold(st, h, kind);
      if (kind === "elite") {
        h.max += 5; h.hp += 5;
        var r = randomRelic(st, h, ["common", "uncommon", "uncommon", "rare"]);
        if (r) grantRelic(st, h, r);
      }
      var card = { k: "card", opts: rewardCards(st, h.cls, kind) };
      // Boss：先從三件 Boss 遺物選一件，再選卡
      if (kind === "boss") {
        var opts = [];
        for (var i = 0; i < 3; i++) { var b = randomRelic(st, h, ["boss"], opts); if (b) opts.push(b); }
        if (opts.length) { h.pend = { k: "relic", opts: opts }; h.queue = [card]; return; }
      }
      h.pend = card;
    });
    return true;
  }

  // ---------------- 金幣・遺物 ----------------
  function gainGold(st, h, kind) {
    var g = D.GOLD[kind];
    if (!g) return;
    var n = Math.round((g[0] + rint(st, g[1] - g[0] + 1)) * Math.max(0, 1 + relicSum(h, "goldMult")));
    if (n <= 0) return;
    h.gold += n;
    log(st, { t: "gold", to: href(h), n: n });
  }

  // rars 可以重複列出來加權；不會給已經有的遺物
  function randomRelic(st, h, rars, exclude) {
    var rar = pick(st, rars);
    var ok = function (r) { return h.relics.indexOf(r.id) < 0 && (!exclude || exclude.indexOf(r.id) < 0); };
    var pool = D.RELICS.filter(function (r) { return r.rar === rar && ok(r); });
    if (!pool.length) pool = D.RELICS.filter(function (r) { return (rar === "boss" ? r.rar === "boss" : r.rar !== "boss") && ok(r); });
    return pool.length ? pick(st, pool).id : null;
  }

  function grantRelic(st, h, id) {
    var r = D.RELIC[id];
    if (!r || h.relics.indexOf(id) >= 0) return;
    h.relics.push(id);
    if (r.fx.maxHp) { h.max = Math.max(1, h.max + r.fx.maxHp); h.hp = Math.max(1, Math.min(h.max, h.hp + Math.max(0, r.fx.maxHp))); }
    log(st, { t: "relic", to: href(h), id: id });
  }

  // 個人商店：三條成長方向各一張卡＋兩件遺物（價格見 D.SHOP）
  function makeShop(st, h) {
    var cards = rewardCards(st, h.cls, "shop").map(function (id) { return { id: id, price: D.SHOP.card[D.CARD[id].rar] || 60 }; });
    var relics = [];
    for (var i = 0; i < 2; i++) {
      var id = randomRelic(st, h, ["common", "common", "uncommon", "rare"], relics.map(function (x) { return x.id; }));
      if (id) relics.push({ id: id, price: D.SHOP.relic[D.RELIC[id].rar] });
    }
    return { k: "shop", cards: cards, relics: relics };
  }
  function removePrice(h) { return D.SHOP.remove + D.SHOP.removeStep * (h.removes || 0); }

  // 獎勵：三條成長方向各出一張（稀有度依戰鬥種類擲骰）
  function rewardCards(st, cls, kind) {
    var rareP = kind === "boss" ? 1 : kind === "elite" ? 0.3 : kind === "treasure" ? 0.5 : kind === "shop" ? 0.2 : 0.1;
    return D.CLASS[cls].paths.map(function (p) {
      var pool = D.CARDS.filter(function (c) { return c.cls === cls && c.path === p.id; });
      var r = rnd(st);
      var rar = r < rareP ? "rare" : r < rareP + 0.35 ? "uncommon" : "common";
      var list = pool.filter(function (c) { return c.rar === rar; });
      return pick(st, list.length ? list : pool).id;
    });
  }

  // ---------------- 地圖 ----------------
  function enterFloor(st) {
    var kind = D.FLOORS[st.floor];
    var opts;
    if (kind === "choice") {
      var w = D.NODE_WEIGHTS;
      opts = [];
      while (opts.length < 2) {
        var total = 0, keys = Object.keys(w).filter(function (k) { return opts.indexOf(k) < 0; });
        keys.forEach(function (k) { total += w[k]; });
        var r = rnd(st) * total;
        for (var i = 0; i < keys.length; i++) { r -= w[keys[i]]; if (r <= 0 || i === keys.length - 1) { opts.push(keys[i]); break; } }
      }
    } else opts = [kind];
    st.phase = "map";
    st.options = opts;
    st.votes = {};
  }

  function controllers(st) {
    var out = [];
    heroes(st).forEach(function (h) { if (out.indexOf(h.ctrl) < 0) out.push(h.ctrl); });
    return out;
  }

  function startNode(st, kind) {
    st.node = kind;
    log(st, { t: "node", kind: kind, act: st.act, floor: st.floor });
    if (kind === "rest") {
      st.phase = "rest";
      heroes(st).forEach(function (h) { h.pend = { k: "rest" }; });
    } else if (kind === "treasure") {
      st.phase = "treasure";
      heroes(st).forEach(function (h) {
        gainGold(st, h, "treasure");
        h.pend = { k: "treasure", opts: rewardCards(st, h.cls, "treasure"), relic: randomRelic(st, h, ["common", "uncommon", "rare"]) };
      });
    } else if (kind === "shop") {
      st.phase = "shop";
      heroes(st).forEach(function (h) { h.pend = makeShop(st, h); });
    } else startBattle(st, kind);
  }

  function nextFloor(st) {
    st.floor += 1;
    if (st.floor >= D.FLOORS.length) {
      st.act += 1;
      st.floor = 0;
      heroes(st).forEach(function (h) { h.hp = h.max; });
      log(st, { t: "act", act: st.act });
    }
    enterFloor(st);
  }

  // ---------------- 建立 ----------------
  // seats：長度 4，每格 null 或 { cls（英雄 id）, name, ctrl }；扇形區依 seat 順序切
  function create(opts) {
    var st = {
      v: 2, seed: (opts.seed >>> 0) || ((Math.random() * 4294967296) >>> 0), uid: 0,
      hostCtrl: opts.hostCtrl || "local",
      phase: "map", act: 0, floor: 0, node: null, battleKind: null, options: [], votes: {},
      heroes: [null, null, null, null], secs: [], enemies: [], round: 0, log: [], logSeq: 0
    };
    (opts.seats || []).forEach(function (s, seat) {
      if (!s || !D.CLASS[s.cls] || seat >= D.MAX_SEATS) return;
      var cls = D.CLASS[s.cls];
      var h = {
        seat: seat, cls: s.cls, name: String(s.name || "").slice(0, 16), ctrl: s.ctrl || "local",
        hp: cls.hp, max: cls.hp, mana: 0, down: false, pend: null, queue: [], relics: [], gold: D.SHOP.startGold, removes: 0,
        deck: cls.start.map(function (id) { return newCard(st, id); }),
        draw: [], hand: [], disc: [], exh: []
      };
      resetBattleFields(h);
      st.heroes[seat] = h;
      st.secs.push(seat);
    });
    enterFloor(st);
    return st;
  }

  // ---------------- 出牌 ----------------
  function canPlay(st, h, c) {
    var d = cardDef(c);
    if (!d || d.unplayable) return false;
    return st.phase === "battle" && !h.down && !h.done && h.mana >= d.cost;
  }

  // 合法目標：{ e:[uid...], s:[seat...] }
  function validTargets(st, h, c) {
    var d = cardDef(c);
    var out = { e: [], s: [] };
    if (!d) return out;
    if (d.tgt === "enemy") out.e = inRange(st, d.rng).map(function (e) { return e.u; });
    else if (d.tgt === "ally") out.s = alive(st).map(function (x) { return x.seat; });
    else if (d.tgt === "down") out.s = heroes(st).filter(function (x) { return x.down; }).map(function (x) { return x.seat; });
    return out;
  }

  function play(st, h, u, tg) {
    var idx = -1;
    h.hand.forEach(function (c, i) { if (c.u === u) idx = i; });
    if (idx < 0) return "no_card";
    var c = h.hand[idx];
    var d = cardDef(c);
    if (!canPlay(st, h, c)) return "cannot_play";
    var vt = validTargets(st, h, c);
    var te = null, ts = null;
    if (d.tgt === "enemy") { if (!tg || vt.e.indexOf(tg.e) < 0) return "bad_target"; te = enemy(st, tg.e); }
    if (d.tgt === "ally" || d.tgt === "down") { if (!tg || vt.s.indexOf(tg.s) < 0) return "bad_target"; ts = hero(st, tg.s); }
    if (d.tgt === "self") ts = h;
    h.mana -= d.cost;
    h.hand.splice(idx, 1);
    var ring = te ? ringOf(te) : null;
    log(st, { t: "play", s: h.seat, c: c.id, up: !!c.up, to: te ? eref(te) : ts && ts !== h ? href(ts) : null, ring: d.near || d.far ? ring : null });
    // 近遠效果不同：依出牌當下目標所在的圈套用，再套共通效果
    var list = (ring && d[ring] ? d[ring] : []).concat(d.fx);
    list.forEach(function (f) { if (st.phase === "battle") runFx(st, h, d, f, te, ts); });
    if (d.type === "pow") { /* 能力牌打出後離開牌堆（本場戰鬥） */ }
    else if (d.exhaust) h.exh.push(c);
    else h.disc.push(c);
    checkWin(st);
    return null;
  }

  function finaleAmount(h, f) { var n = f.n * Math.floor(h.mel / (f.per || 1)); h.mel = 0; return n; }

  function runFx(st, h, d, f, te, ts) {
    var area = function () { return inRange(st, f.r || d.rng || "any"); };
    var i, n;
    switch (f.o) {
      case "dmg":
        for (i = 0; i < (f.h || 1); i++) heroAttack(st, h, te, f.n);
        break;
      case "dmgAll":
        for (i = 0; i < (f.h || 1); i++) area().forEach(function (e) { heroAttack(st, h, e, f.n); });
        break;
      case "dmgSec":
        if (te) st.enemies.filter(function (e) { return e.hp > 0 && e.sec === te.sec; }).forEach(function (e) { heroAttack(st, h, e, f.n); });
        break;
      case "dmgBlock": heroAttack(st, h, te, h.blk * f.n); break;
      case "dmgExec": if (te) heroAttack(st, h, te, te.hp * 2 <= te.max ? f.n * 2 : f.n); break;
      case "dmgMissing": heroAttack(st, h, te, f.n + Math.floor((h.max - h.hp) / f.k)); break;
      case "dmgSpirit": heroAttack(st, h, te, f.n * h.sp); break;
      case "dmgMel": heroAttack(st, h, te, f.n * h.mel); break;
      case "hexDmg":
        if (te) heroAttack(st, h, te, f.n * DEBUFF_TYPES.filter(function (s) { return te.st[s] > 0; }).length);
        break;
      case "lifesteal":
        if (te) { n = heroAttack(st, h, te, f.n); if (n > 0) healHero(st, h, n); }
        break;
      case "detonate":
        if (te && te.st.burn > 0) { var b = te.st.burn; te.st.burn = 0; hitEnemy(st, te, b * f.n, false); }
        break;
      case "blk": gainBlock(st, h, f.n); break;
      case "blkAlly": if (ts) gainBlock(st, ts, f.n); break;
      case "blkAll": alive(st).forEach(function (x) { gainBlock(st, x, f.n); }); break;
      case "blkSpirit": gainBlock(st, h, f.n * h.sp); break;
      case "heal": healHero(st, ts || h, f.n); break;
      case "healAll": alive(st).forEach(function (x) { healHero(st, x, f.n); }); break;
      case "regen": if (ts) { ts.st.regen += f.n; log(st, { t: "st", to: href(ts), s: "regen", n: f.n }); } break;
      case "draw": drawCards(st, h, f.n); break;
      case "mana": h.mana += f.n; break;
      case "str": h.str += f.n; log(st, { t: "str", to: href(h), n: f.n }); break;
      case "strAll": alive(st).forEach(function (x) { x.str += f.n; log(st, { t: "str", to: href(x), n: f.n }); }); break;
      case "strAlly": if (ts) { ts.str += f.n; log(st, { t: "str", to: href(ts), n: f.n }); } break;
      case "st": if (te) addStatus(st, te, f.s, f.n, h); break;
      case "stAll": area().forEach(function (e) { addStatus(st, e, f.s, f.n, h); }); break;
      case "poisonX": if (te && te.st.poison > 0) addStatus(st, te, "poison", te.st.poison * (f.n - 1), null); break;
      case "push": if (te) moveEnemy(st, te, "far"); break;
      case "pull": if (te) moveEnemy(st, te, "near"); break;
      case "pushAll": inRange(st, "near").forEach(function (e) { moveEnemy(st, e, "far"); }); break;
      case "pullSec":
        st.enemies.filter(function (e) { return e.hp > 0 && e.ring === "far" && e.sec === secOf(st, h.seat); }).forEach(function (e) { moveEnemy(st, e, "near"); });
        break;
      case "trap": h.trap += f.n; log(st, { t: "trap", to: href(h), n: f.n }); break;
      case "taunt": h.taunt = true; log(st, { t: "taunt", to: href(h) }); break;
      case "lose": hitHero(st, h, f.n, true); break;
      case "revive":
        if (ts && ts.down) {
          ts.down = false; ts.hp = Math.max(1, Math.ceil(ts.max * f.n / 100)); ts.blk = 0;
          ts.st = { weak: 0, vuln: 0, poison: 0, burn: 0, regen: 0 };
          log(st, { t: "revive", to: href(ts) });
          startHeroTurn(st, ts);
        }
        break;
      case "cleanse": if (ts) NEG_STATUS.forEach(function (s) { ts.st[s] = 0; }); break;
      case "cleanseAll": alive(st).forEach(function (x) { NEG_STATUS.forEach(function (s) { x.st[s] = 0; }); }); break;
      case "pow": h.pw[f.p] = (h.pw[f.p] || 0) + f.n; log(st, { t: "pow", to: href(h), p: f.p, n: f.n }); break;
      case "summon":
        n = Math.min(D.MAX_SPIRITS, h.sp + f.n) - h.sp;
        h.sp += n;
        if (n > 0) log(st, { t: "summonSp", to: href(h), n: n });
        break;
      case "spiritsAct": for (i = 0; i < f.n; i++) spiritsAttack(st, h); break;
      case "sac":
        n = h.sp;
        h.sp = 0;
        if (n > 0) log(st, { t: "sac", to: href(h), n: n });
        if (f.k === "blk") gainBlock(st, h, f.n * n);
        else if (f.k === "dmg") heroAttack(st, h, te, f.n * n);
        else if (f.k === "draw") drawCards(st, h, f.n * n);
        else if (f.k === "healAll") alive(st).forEach(function (x) { healHero(st, x, f.n * n); });
        else if (f.k === "dmgAll") inRange(st, "any").forEach(function (e) { heroAttack(st, h, e, f.n * n); });
        break;
      case "mel":
        h.mel = Math.min(D.MAX_MELODY, h.mel + f.n);
        break;
      case "finale":
        n = finaleAmount(h, f);
        log(st, { t: "finale", to: href(h), n: n });
        if (f.k === "blkAll") alive(st).forEach(function (x) { gainBlock(st, x, n); });
        else if (f.k === "healAll") alive(st).forEach(function (x) { healHero(st, x, n); });
        else if (f.k === "strAll") { if (n > 0) alive(st).forEach(function (x) { x.str += n; log(st, { t: "str", to: href(x), n: n }); }); }
        else if (f.k === "dmgAll") { if (n > 0) inRange(st, "any").forEach(function (e) { heroAttack(st, h, e, n); }); }
        else if (f.k === "dmg") { if (n > 0) heroAttack(st, h, te, n); }
        break;
      case "appeal": break;
    }
  }

  // ---------------- 選擇（獎勵／營火／寶箱） ----------------
  // 戰利品除了三選一，也可以改成升級一張卡（使用者指定：基本牌組在過關途中漸漸升級）
  function choose(st, h, c) {
    var p = h.pend;
    if (!p || !c) return "no_pending";
    var err = chooseOne(st, h, p, c);
    if (err) return err;
    if (!h.pend && h.queue && h.queue.length) h.pend = h.queue.shift();
    if (heroes(st).every(function (x) { return !x.pend; })) nextFloor(st);
    return null;
  }

  function chooseOne(st, h, p, c) {
    if (p.k === "relic") {
      if (c.skip) h.pend = null;
      else if (p.opts.indexOf(c.id) >= 0) { grantRelic(st, h, c.id); h.pend = null; }
      else return "bad_choice";
    } else if (p.k === "shop") {
      if (c.done) h.pend = null;
      else if (c.kind === "remove") {
        if (h.gold < removePrice(h) || h.deck.length <= 5) return "no_gold";
        h.pend = { k: "remove", back: "shop", shop: p };
      } else {
        var list = c.buy === "card" ? p.cards : c.buy === "relic" ? p.relics : null;
        var item = list && list[c.i];
        if (!item || item.sold) return "bad_choice";
        if (h.gold < item.price) return "no_gold";
        h.gold -= item.price;
        item.sold = true;
        if (c.buy === "card") { h.deck.push(newCard(st, item.id)); log(st, { t: "buy", to: href(h), c: item.id, n: item.price }); }
        else { log(st, { t: "buyRelic", to: href(h), id: item.id, n: item.price }); grantRelic(st, h, item.id); }
      }
    } else if (p.k === "card") {
      if (c.skip) h.pend = null;
      else if (c.kind === "upgrade") h.pend = { k: "upgrade", back: "card", opts: p.opts };
      else if (p.opts.indexOf(c.id) >= 0) { h.deck.push(newCard(st, c.id)); h.pend = null; }
      else return "bad_choice";
    } else if (p.k === "rest") {
      if (c.kind === "heal") { h.hp = Math.min(h.max, h.hp + Math.ceil(h.max * (30 + relicSum(h, "restHeal")) / 100)); h.pend = null; }
      else if (c.kind === "upgrade") h.pend = { k: "upgrade", back: "rest" };
      else return "bad_choice";
    } else if (p.k === "treasure") {
      if (c.kind === "maxhp") { h.max += 6; h.hp += 6; h.pend = null; }
      else if (c.kind === "relic" && p.relic) { grantRelic(st, h, p.relic); h.pend = null; }
      else if (c.kind === "remove") h.pend = { k: "remove", back: "treasure", opts: p.opts, relic: p.relic };
      else if (c.id && p.opts.indexOf(c.id) >= 0) { h.deck.push(newCard(st, c.id)); h.pend = null; }
      else return "bad_choice";
    } else if (p.k === "upgrade" || p.k === "remove") {
      var back = p.back === "rest" ? { k: "rest" } : p.back === "shop" ? p.shop : { k: p.back, opts: p.opts, relic: p.relic };
      if (c.back) { h.pend = back; return null; }
      var i = -1;
      h.deck.forEach(function (x, j) { if (x.u === c.u) i = j; });
      if (i < 0) return "bad_choice";
      if (p.k === "upgrade") { if (h.deck[i].up) return "bad_choice"; h.deck[i].up = true; h.pend = null; }
      else {
        if (h.deck.length <= 5) return "bad_choice";
        if (p.back === "shop") {
          // 商店刪卡：付錢後回到商店
          if (h.gold < removePrice(h)) return "no_gold";
          h.gold -= removePrice(h);
          h.removes += 1;
          log(st, { t: "removeCard", to: href(h), c: h.deck[i].id });
          h.deck.splice(i, 1);
          h.pend = p.shop;
        } else { h.deck.splice(i, 1); h.pend = null; }
      }
    }
    return null;
  }

  // ---------------- 入口 ----------------
  // action：{ t:"play", s, u, tg } / { t:"end", s, on } / { t:"vote", i, force } / { t:"choose", s, c } / { t:"take", s }
  // 回傳 null（成功）或錯誤代碼字串
  function apply(st, ctrl, a) {
    if (!a || typeof a !== "object") return "bad_action";
    var h = typeof a.s === "number" ? hero(st, a.s) : null;
    var mine = h && h.ctrl === ctrl;
    switch (a.t) {
      case "play":
        if (!mine) return "not_yours";
        var perr = play(st, h, a.u, a.tg);
        // 自傷牌可能讓最後一個還沒結束的英雄倒下：這時也要結算回合
        if (!perr) maybeResolve(st);
        return perr;
      case "end":
        if (!mine || st.phase !== "battle" || h.down) return "not_yours";
        h.done = a.on !== false;
        maybeResolve(st);
        return null;
      case "vote":
        if (st.phase !== "map" || typeof a.i !== "number" || !st.options[a.i]) return "bad_vote";
        if (controllers(st).indexOf(ctrl) < 0) return "not_yours";
        st.votes[ctrl] = a.i;
        var ctrls = controllers(st);
        var forced = a.force && ctrl === st.hostCtrl;
        if (!forced && !ctrls.every(function (k) { return typeof st.votes[k] === "number"; })) return null;
        var tally = st.options.map(function () { return 0; });
        Object.keys(st.votes).forEach(function (k) { if (ctrls.indexOf(k) >= 0) tally[st.votes[k]] += 1; });
        var best = forced ? a.i : 0;
        if (!forced) tally.forEach(function (n, i) { if (n > tally[best]) best = i; });
        startNode(st, st.options[best]);
        return null;
      case "choose":
        if (!mine) return "not_yours";
        return choose(st, h, a.c);
      case "take":
        // 房主接手離線玩家的英雄
        if (!h || ctrl !== st.hostCtrl) return "not_host";
        h.ctrl = ctrl;
        return null;
    }
    return "bad_action";
  }

  root.PriTestYellowCore = {
    create: create, apply: apply,
    cardDef: cardDef, canPlay: canPlay, validTargets: validTargets, inRange: inRange, ringOf: ringOf, isBoss: isBoss,
    effActs: effActs, actTargets: actTargets, enemyHitValue: enemyHitValue, heroHitValue: heroHitValue,
    heroes: heroes, alive: alive, hero: hero, enemy: enemy, controllers: controllers,
    sectorCount: sectorCount, secOf: secOf, secOwner: secOwner, relicSum: relicSum, removePrice: removePrice,
    _rnd: rnd
  };
})();
