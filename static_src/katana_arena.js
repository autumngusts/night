// 神前鍛刀對決（katana）對刀場：陀螺式的圓形競技場模擬。純邏輯，不碰 DOM（katana.js 負責畫面）。
//
// 每把刀是一顆在碗形場地中滑行的「陀螺」：
//   碗形重力把刀拉向中央、自身轉速（勢い）推動繞場，攻擊型會追擊、持久型會閃避，再加上隨機晃動讓路線交錯。
//   兩把刀的路線交會且相對速度夠快時「刀刃相接」（鍔迫り合い）：鎖在一起幾秒、持續噴火花並互相削耐久，
//   之後依推力差彈開，各自繼續原本的路徑。
//   耐久歸零＝折斷退場；勢い（轉速）歸零＝力竭退場。剩一把時結束；超過回合上限依剩餘耐久＋勢い判定。
//
// 招式卡：每把刀有手牌（3 張）與等待區（2 格）。隨時可以把手牌放進等待區，到了回合交界才發動
//   （卡片的 wait 表示還要多等幾個回合交界）。覺醒招式（special）每場一次，wait 固定 D.SPECIAL_WAIT。
//
// 以固定步長 DT 模擬；亂數全部來自種子，給定同樣的放牌時間點就會得到同樣結果（測試用 run()）。
// 詳見 docs/katana_game_design.md §7。
(function () {
  "use strict";

  var D = window.PriTestKatanaData;
  var Core = window.PriTestKatanaCore;
  if (!D || !Core) return;

  var R = 100;            // 場地半徑（單位任意，速度以 單位/秒）
  var DT = 1 / 60;
  var ROUND_S = 4;        // 一回合秒數
  var MAX_ROUNDS = 15;
  var HAND = 3;
  var QUEUE = 2;
  var BIND_SPEED = 9;     // 相對法向速度超過此值才會刀刃相接，否則只是擦撞彈開
  var BOWL_K = 0.32;      // 碗形重力 a = −k·r
  var FRICTION = 0.55;    // 速度衰減（1/秒）
  var SPIN_DECAY = 0.011; // 勢い自然衰減（1/秒），約 90 秒耗盡
  var BASE_DECK = ["dash", "dash", "guard", "guard", "spin", "spin", "mikiri", "issen", "iai", "momiji", "kaika", "rakuou", "fubuki"];
  var STYLE_DECK = { attack: ["issen", "dash"], defense: ["mikiri", "guard"], stamina: ["spin", "iai"], balance: ["momiji", "mikiri"] };
  // 打法：[推進力倍率, 勢い衰減倍率, 追擊力]
  var STYLE_PARAM = { attack: [1.3, 1.0, 34], defense: [0.8, 0.9, 14], stamina: [1.0, 0.6, 6], balance: [1.05, 0.85, 24] };
  var COLORS = ["#e2553f", "#3f8fe2", "#e2b23f", "#52b06a", "#a35fd6", "#e27fb6", "#4fc4c4", "#c48a4f", "#9aa0a6", "#d6d65f"];

  var clamp = Core.clamp;

  function cardDef(id) {
    return Core.byId(D.ARENA_CARDS, id) || Core.byId(D.SPECIALS, id);
  }

  // ---------------- 由刀的數據決定打法與特性 ----------------
  function profile(snap) {
    var s = snap.stats;
    var mass = Math.max(0.2, s.mass || 1);
    var style;
    if (mass < 0.75) style = "stamina";
    else if (s.toughness >= s.sharpness + 10 || mass >= 1.6) style = "defense";
    else if (s.sharpness >= s.toughness + 8) style = "attack";
    else style = "balance";
    var traits = [];
    if (snap.edges === 2) traits.push("double");
    if ((snap.sori || 0) >= 20) traits.push("slice");
    if (snap.edges === 2 && (snap.sori || 0) < 5 && (snap.mihaba || 30) <= 32) traits.push("thrust");
    if (mass >= 1.5) traits.push("heavy");
    if (snap.wave) traits.push("wave");
    if (s.hardness >= 61) traits.push("brittle");
    if (s.hardness < 52) traits.push("soft");
    if (snap.crack) traits.push("cracked");
    var sp = STYLE_PARAM[style];
    return {
      style: style,
      traits: traits,
      maxHp: Math.max(1, Math.round(s.integrity)),
      atk: 0.5 + s.sharpness / 100 + Math.max(0, s.hardness - 55) / 40,
      def: 0.6 + s.toughness / 100 + Math.max(0, s.hardness - 50) / 100,
      mass: mass,
      radius: clamp(8 + (snap.length || 70) / 7, 10, 26),
      drive: 30 * sp[0] / Math.pow(mass, 0.35),
      decay: SPIN_DECAY * sp[1] * (1 + (snap.flaws || []).length * 0.08),
      seek: sp[2],
      chip: s.chip || 1
    };
  }

  function has(f, trait) { return f.prof.traits.indexOf(trait) >= 0; }

  // ---------------- 建立 ----------------
  // fighters：[{ id, name, human, snap, hp }]
  function create(opts) {
    var rng = Core.makeRng("arena|" + opts.seed);
    var n = opts.fighters.length;
    var a = {
      seed: String(opts.seed), time: 0, round: 1, over: false, winner: null, ver: 1,
      fighters: [], binds: [], cooldown: {}, ghost: {}, events: [], log: [], hazards: [], timed: [], outOrder: []
    };
    a.rngState = rng;
    opts.fighters.forEach(function (x, i) {
      var prof = profile(x.snap);
      var ang = Math.PI * 2 * i / n + rng() * 0.3;
      var r0 = R * 0.62;
      var deck = BASE_DECK.concat(STYLE_DECK[prof.style]);
      var drng = Core.makeRng("deck|" + opts.seed + "|" + x.id);
      for (var k = deck.length - 1; k > 0; k--) { var j = Math.floor(drng() * (k + 1)); var tmp = deck[k]; deck[k] = deck[j]; deck[j] = tmp; }
      var dir = i % 2 === 0 ? 1 : -1; // 一半順時針、一半逆時針繞場，路線才會交錯
      var f = {
        id: x.id, name: x.name, human: !!x.human, snap: x.snap, prof: prof, color: COLORS[i % COLORS.length],
        x: Math.cos(ang) * r0, y: Math.sin(ang) * r0,
        vx: -Math.sin(ang) * 30 * dir, vy: Math.cos(ang) * 30 * dir,
        dir: dir, rot: rng() * 6.28, spin: 1, hp: Math.max(0, Math.min(prof.maxHp, x.hp === undefined ? prof.maxHp : x.hp)),
        alive: true, out: null, outTime: 0, chips: 0, bends: 0, dealt: 0,
        deck: deck, discard: [], hand: [], queue: [], special: x.snap.special || null, specialUsed: false,
        fx: {}, buffs: [], dots: [], wander: 0.5 + rng(), driveMul: 1, uid: 0
      };
      if (f.hp <= 0) { f.alive = false; f.out = "break"; }
      draw(f, HAND);
      a.fighters.push(f);
    });
    a.fighters.forEach(function (f) { if (!f.alive) a.outOrder.push(f.id); });
    checkEnd(a);
    return a;
  }

  function draw(f, n) {
    while (f.hand.length < n) {
      if (!f.deck.length) {
        if (!f.discard.length) return;
        f.deck = f.discard; f.discard = [];
      }
      f.uid++;
      f.hand.push({ uid: f.id + "-" + f.uid, card: f.deck.shift() });
    }
  }

  function rnd(a) { return a.rngState(); }
  function emit(a, ev) { ev.t = a.time; a.events.push(ev); }
  function byFid(a, id) { for (var i = 0; i < a.fighters.length; i++) if (a.fighters[i].id === id) return a.fighters[i]; return null; }
  function alive(a) { return a.fighters.filter(function (f) { return f.alive; }); }

  function nearestEnemy(a, f) {
    var best = null, bd = 1e9;
    a.fighters.forEach(function (g) {
      if (g === f || !g.alive) return;
      var d = Math.hypot(g.x - f.x, g.y - f.y);
      if (d < bd) { bd = d; best = g; }
    });
    return best;
  }

  // ---------------- 招式卡 ----------------
  // 把手牌（或覺醒招式）放進等待區。回傳錯誤字串或 null
  function queueCard(a, fid, uid) {
    var f = byFid(a, fid);
    if (!f || !f.alive || a.over) return "kt_ar_err_out";
    if (f.queue.length >= QUEUE) return "kt_ar_err_full";
    var card, wait;
    if (uid === "special") {
      if (!f.special || f.specialUsed) return "kt_ar_err_card";
      card = f.special; wait = D.SPECIAL_WAIT; f.specialUsed = true;
    } else {
      var idx = -1;
      f.hand.forEach(function (h, i) { if (h.uid === uid) idx = i; });
      if (idx < 0) return "kt_ar_err_card";
      card = f.hand[idx].card; wait = cardDef(card).wait;
      f.hand.splice(idx, 1);
      f.discard.push(card);
    }
    f.queue.push({ card: card, at: a.round + 1 + wait, special: uid === "special" });
    a.ver++;
    emit(a, { type: "queue", f: f.id, card: card });
    return null;
  }

  // pierce：無視防禦與無敵（童子切・骨喰）
  function hit(a, src, dst, amount, kind, pierce) {
    if (!dst.alive || amount <= 0) return 0;
    pierce = pierce || (src && bany(src, "pierce"));
    if (bany(dst, "invuln") && !pierce) { emit(a, { type: "block", f: dst.id, x: dst.x, y: dst.y }); return 0; }
    if (!pierce) amount *= (dst.fx.guard > 0 ? 0.5 : 1) * bprod(dst, "guard");
    if (kind === "curse") amount = Math.min(amount, dst.hp - 1); // 妖刀的反噬不會讓刀折斷
    if (amount <= 0) return 0;
    amount = Math.min(dst.hp, amount);
    var refl = kind === "reflect" || !src || src === dst ? 0 : bmax(dst, "reflect");
    if (refl) hit(a, dst, src, amount * refl, "reflect");
    dst.hp -= amount;
    if (src) src.dealt += amount;
    if (amount >= 1) emit(a, { type: "hit", f: dst.id, src: src ? src.id : null, n: Math.round(amount), kind: kind || "", x: dst.x, y: dst.y });
    if (dst.hp <= 0.001) knockOut(a, dst, "break");
    return amount;
  }

  function knockOut(a, f, why) {
    if (!f.alive) return;
    f.alive = false; f.out = why; f.outTime = a.time; f.hp = Math.max(0, f.hp);
    a.binds = a.binds.filter(function (b) { return b.a !== f && b.b !== f; });
    a.outOrder.push(f.id);
    a.ver++;
    emit(a, { type: why, f: f.id, x: f.x, y: f.y });
    a.log.push({ t: a.time, type: why, f: f.id });
  }

  function activate(a, f, card) {
    var e = nearestEnemy(a, f);
    var fx = f.fx;
    a.log.push({ t: a.time, type: "card", f: f.id, card: card });
    emit(a, { type: "card", f: f.id, card: card, x: f.x, y: f.y });
    if (card === "dash") {
      if (e) { var d = Math.hypot(e.x - f.x, e.y - f.y) || 1; f.vx += (e.x - f.x) / d * 70; f.vy += (e.y - f.y) / d * 70; }
      fx.dash = 1.5;
    } else if (card === "guard") fx.guard = 3;
    else if (card === "spin") f.spin = Math.min(1, f.spin + 0.25);
    else if (card === "mikiri") fx.mikiri = 4;
    else if (card === "issen") fx.issen = 1.6;
    else if (card === "iai") fx.iaiHold = 1.0;
    else if (card === "momiji") fx.momiji = 4;
    else if (card === "kaika") fx.kaika = 4;
    else if (card === "rakuou") {
      var tg = pickTarget(a, f, "nearest");
      if (tg) {
        tg.dots.push({ kind: "sakura", dps: 4, t: 3, src: f.id });
        tg.fx.slow = Math.max(tg.fx.slow || 0, 3);
        emit(a, { type: "sakura", f: tg.id, x: tg.x, y: tg.y });
      }
    } else if (card === "fubuki") {
      emit(a, { type: "fubuki", f: f.id, x: f.x, y: f.y, r: 75 });
      a.fighters.forEach(function (g) {
        if (g === f || !g.alive || Math.hypot(g.x - f.x, g.y - f.y) > 75 + g.prof.radius) return;
        hit(a, f, g, 6 * f.prof.atk / g.prof.def * dmgMul(f), "fubuki");
        g.fx.slow = Math.max(g.fx.slow || 0, 2.5);
        g.spin -= 0.12;
      });
    }
    else {
      var sp = Core.byId(D.SPECIALS, card);
      if (sp) activateSpecial(a, f, sp);
    }
  }

  // ---------------- 覺醒招式（資料驅動，D.SPECIALS[].fx） ----------------
  function bprod(f, k) { var m = 1; f.buffs.forEach(function (b) { if (b[k] !== undefined) m *= b[k]; }); return m; }
  function bmax(f, k) { var m = 0; f.buffs.forEach(function (b) { if (b[k] > m) m = b[k]; }); return m; }
  function bsum(f, k) { var m = 0; f.buffs.forEach(function (b) { if (b[k]) m += b[k]; }); return m; }
  function bany(f, k) { for (var i = 0; i < f.buffs.length; i++) if (f.buffs[i][k]) return true; return false; }
  function reach(f) { return f.prof.radius * bprod(f, "reach"); }

  function activateSpecial(a, f, sp) {
    var fx = sp.fx || {};
    if (fx.cleanse) f.dots = [];
    if (fx.heal) {
      var add = Math.min(f.prof.maxHp - f.hp, f.prof.maxHp * fx.heal);
      f.hp += add;
      if (add >= 1) emit(a, { type: "heal", f: f.id, n: Math.round(add), x: f.x, y: f.y });
    }
    if (fx.spin) f.spin = Math.min(1, f.spin + fx.spin);
    if (fx.buff) {
      var b = JSON.parse(JSON.stringify(fx.buff));
      b.id = sp.id; b.color = sp.color;
      if (b.hits) b.left = b.hits;
      f.buffs.push(b);
    }
    if (fx.strike) {
      var st = fx.strike;
      for (var k = 0; k < (st.count || 1); k++) a.timed.push({ t: (st.delay || 0) * k, owner: f.id, sp: sp.id });
    }
    if (fx.meteor) {
      var targets = alive(a).filter(function (g) { return g !== f; });
      for (var m = 0; m < fx.meteor.n && targets.length; m++) {
        var g2 = targets[m % targets.length];
        a.hazards.push({ kind: "meteor", owner: f.id, x: g2.x + (rnd(a) - 0.5) * 16, y: g2.y + (rnd(a) - 0.5) * 16, t: 0.7 + m * 0.6, r: fx.meteor.r, dmg: fx.meteor.dmg * f.prof.atk });
      }
    }
  }

  function pickTarget(a, f, how) {
    var best = null;
    a.fighters.forEach(function (g) {
      if (g === f || !g.alive) return;
      if (!best) { best = g; return; }
      if (how === "strongest" && g.hp > best.hp) best = g;
      else if (how === "weakest" && g.hp < best.hp) best = g;
      else if (how === "nearest" && Math.hypot(g.x - f.x, g.y - f.y) < Math.hypot(best.x - f.x, best.y - f.y)) best = g;
    });
    return best;
  }

  function strikeOne(a, f, g, st, sp) {
    hit(a, f, g, st.dmg * f.prof.atk / g.prof.def * dmgMul(f), sp.id, !!st.pierce);
    if (st.stun) g.fx.stun = Math.max(g.fx.stun || 0, st.stun);
    if (st.drain) g.spin -= st.drain;
    if (st.dot) g.dots.push({ kind: st.dot.kind, dps: st.dot.dps, t: st.dot.t, src: f.id });
    if (st.dispel && g.buffs.length) { g.buffs = []; a.ver++; emit(a, { type: "dispel", f: g.id, x: g.x, y: g.y }); }
    if (st.knock) {
      var dx = g.x - f.x, dy = g.y - f.y, d = Math.hypot(dx, dy) || 1;
      g.vx += dx / d * st.knock; g.vy += dy / d * st.knock;
    }
  }

  function doStrike(a, f, sp) {
    if (!f || !f.alive || !sp) return;
    var st = sp.fx.strike;
    if (st.target === "all") {
      emit(a, { type: "strike", f: f.id, x: f.x, y: f.y, r: st.radius || R * 2, color: sp.color });
      a.fighters.forEach(function (g) {
        if (g === f || !g.alive) return;
        if (st.radius && Math.hypot(g.x - f.x, g.y - f.y) > st.radius + g.prof.radius) return;
        strikeOne(a, f, g, st, sp);
      });
      return;
    }
    var tgt = pickTarget(a, f, st.target);
    if (!tgt) return;
    if (st.teleport) {
      var ang = Math.atan2(f.y - tgt.y, f.x - tgt.x), fromX = f.x, fromY = f.y;
      f.x = tgt.x + Math.cos(ang) * (f.prof.radius + tgt.prof.radius + 2);
      f.y = tgt.y + Math.sin(ang) * (f.prof.radius + tgt.prof.radius + 2);
      emit(a, { type: "lightning", f: f.id, x: fromX, y: fromY, x2: tgt.x, y2: tgt.y, color: sp.color });
      pairCool(a, f, tgt, 1.2);
    } else emit(a, { type: "slash", f: f.id, x: tgt.x, y: tgt.y, color: sp.color });
    strikeOne(a, f, tgt, st, sp);
  }

  function dmgMul(f) { return bprod(f, "dmg"); }

  // 碰到對手時觸發的招式（一閃・燕返し・灼燒・出血）。回傳 true 表示不進入鍔迫り合い
  function onContact(a, f, g) {
    var skipBind = false;
    if (f.fx.issen > 0) {
      hit(a, f, g, 22 * f.prof.atk / g.prof.def * dmgMul(f), "issen");
      f.fx.issen = 0; skipBind = true;
      emit(a, { type: "slash", f: f.id, x: (f.x + g.x) / 2, y: (f.y + g.y) / 2 });
    }
    // 覺醒招式的接觸效果
    f.buffs.forEach(function (b) {
      if (b.t <= 0 || b.left === 0) return;
      var oh = b.onHit;
      if (oh) {
        if (oh.dmg) hit(a, f, g, oh.dmg * f.prof.atk / g.prof.def * dmgMul(f), b.id);
        if (oh.dot) g.dots.push({ kind: oh.dot.kind, dps: oh.dot.dps, t: oh.dot.t, src: f.id });
        if (oh.stun) g.fx.stun = Math.max(g.fx.stun || 0, oh.stun);
        if (oh.drain) g.spin -= oh.drain;
        if (oh.knock) { var dx = g.x - f.x, dy = g.y - f.y, d = Math.hypot(dx, dy) || 1; g.vx += dx / d * oh.knock; g.vy += dy / d * oh.knock; }
        if (oh.dmg || oh.knock) emit(a, { type: "slash", f: f.id, x: (f.x + g.x) / 2, y: (f.y + g.y) / 2, color: b.color });
      }
      if (b.ramp) b.dmg = (b.dmg || 1) + b.ramp;
      if (b.noBind) skipBind = true;
      if (b.left) { b.left--; if (!b.left) b.t = 0; }
    });
    return skipBind;
  }

  function pairKey(f, g) { return f.id < g.id ? f.id + "|" + g.id : g.id + "|" + f.id; }
  function pairCool(a, f, g, s) { a.cooldown[pairKey(f, g)] = a.time + s; }
  function cooling(a, f, g) { return (a.cooldown[pairKey(f, g)] || 0) > a.time; }
  function bound(a, f) { for (var i = 0; i < a.binds.length; i++) if (a.binds[i].a === f || a.binds[i].b === f) return a.binds[i]; return null; }
  function effMass(f) { return f.prof.mass * (f.fx.guard > 0 ? 1.5 : 1) * bprod(f, "mass") * (f.fx.iaiHold > 0 ? 4 : 1); }
  function power(f) { return effMass(f) * (0.4 + f.spin) * f.prof.drive * f.driveMul; }

  // ---------------- 碰撞 ----------------
  function collide(a, f, g) {
    var dx = g.x - f.x, dy = g.y - f.y;
    var d = Math.hypot(dx, dy) || 0.001;
    var minD = reach(f) + reach(g);
    if (d >= minD) return;
    // 穿身閃避（霞・蟲・三日月）：本次交會直接穿過，但閃避方仍可斬到對方
    var gk = pairKey(f, g);
    if ((a.ghost[gk] || 0) > a.time) return;
    var ev = Math.max(bmax(f, "evade"), bmax(g, "evade"));
    if (ev && !cooling(a, f, g) && !bound(a, f) && !bound(a, g) && rnd(a) < ev) {
      a.ghost[gk] = a.time + 0.5;
      var ef = bmax(f, "evade") >= bmax(g, "evade") ? f : g, eo = ef === f ? g : f;
      onContact(a, ef, eo);
      emit(a, { type: "evade", f: ef.id, x: ef.x, y: ef.y });
      return;
    }
    var nx = dx / d, ny = dy / d;
    // 位置分離（依質量分配）
    var mf = effMass(f), mg = effMass(g);
    var over = minD - d;
    f.x -= nx * over * mg / (mf + mg); f.y -= ny * over * mg / (mf + mg);
    g.x += nx * over * mf / (mf + mg); g.y += ny * over * mf / (mf + mg);
    if (bound(a, f) || bound(a, g)) return;
    var rel = (f.vx - g.vx) * nx + (f.vy - g.vy) * ny; // 接近為正
    if (rel <= 0) return;
    if (cooling(a, f, g)) { bounce(f, g, nx, ny, rel, 0.6); return; }
    // 看破：無傷化解並反擊，直接彈開
    var mk = f.fx.mikiri > 0 ? [f, g] : (g.fx.mikiri > 0 ? [g, f] : null);
    if (mk) {
      mk[0].fx.mikiri = 0;
      hit(a, mk[0], mk[1], 14 * mk[0].prof.atk / mk[1].prof.def * dmgMul(mk[0]), "mikiri");
      emit(a, { type: "mikiri", f: mk[0].id, x: (f.x + g.x) / 2, y: (f.y + g.y) / 2 });
      bounce(f, g, nx, ny, rel + 40, 1.0);
      pairCool(a, f, g, 0.8);
      return;
    }
    var skipF = onContact(a, f, g), skipG = onContact(a, g, f);
    if (!f.alive || !g.alive) return;
    // 撞擊瞬間的傷（刺突 ×1.5）
    var impF = rel * 0.045 * Math.sqrt(mg / mf) * g.prof.atk / f.prof.def * dmgMul(g) * (has(g, "thrust") ? 1.5 : 1);
    var impG = rel * 0.045 * Math.sqrt(mf / mg) * f.prof.atk / g.prof.def * dmgMul(f) * (has(f, "thrust") ? 1.5 : 1);
    hit(a, g, f, impF, "impact");
    hit(a, f, g, impG, "impact");
    if (!f.alive || !g.alive) return;
    if (skipF || skipG || rel < BIND_SPEED) {
      bounce(f, g, nx, ny, rel, 0.85);
      pairCool(a, f, g, 0.5);
      emit(a, { type: "tick", x: (f.x + g.x) / 2, y: (f.y + g.y) / 2 });
      return;
    }
    // 刀刃相接（鍔迫り合い）
    var dur = 0.8 + 1.0 * Math.min(mf, mg) / Math.max(mf, mg) + rnd(a) * 0.5;
    if (has(f, "slice") || has(g, "slice")) dur *= 0.7;
    dur *= Math.max(bmax(f, "bindLong"), bmax(g, "bindLong"), 1);
    var bind = { a: f, b: g, t: dur, total: dur, nx: nx, ny: ny, sparkT: 0, rel: rel };
    a.binds.push(bind);
    emit(a, { type: "bind", a: f.id, b: g.id, x: (f.x + g.x) / 2, y: (f.y + g.y) / 2 });
    a.log.push({ t: a.time, type: "bind", a: f.id, b: g.id });
    [[f, g], [g, f]].forEach(function (pr) {
      var me = pr[0];
      if (has(me, "cracked") && rnd(a) < 0.05) { emit(a, { type: "crackbreak", f: me.id, x: me.x, y: me.y }); knockOut(a, me, "break"); }
      else if (has(me, "brittle") && rnd(a) < 0.22 * me.prof.chip) { me.chips++; hit(a, pr[1], me, 4, "chip"); emit(a, { type: "chip", f: me.id, x: me.x, y: me.y }); }
    });
  }

  // 依法向量的衝量彈開（restitution e，額外推力 extra）
  function bounce(f, g, nx, ny, rel, e) {
    var mf = effMass(f), mg = effMass(g);
    var j = (1 + e) * rel / (1 / mf + 1 / mg);
    f.vx -= nx * j / mf; f.vy -= ny * j / mf;
    g.vx += nx * j / mg; g.vy += ny * j / mg;
  }

  function stepBind(a, bd) {
    var f = bd.a, g = bd.b;
    if (!f.alive || !g.alive) { bd.t = 0; return; }
    bd.t -= DT;
    // 兩把刀鎖在一起：速度往共同速度收斂、緩慢往較弱的一方推
    var mf = effMass(f), mg = effMass(g);
    var cvx = (f.vx * mf + g.vx * mg) / (mf + mg), cvy = (f.vy * mf + g.vy * mg) / (mf + mg);
    var pf = power(f), pg = power(g);
    var push = 12 * (pf - pg) / (pf + pg);
    var dx = g.x - f.x, dy = g.y - f.y, d = Math.hypot(dx, dy) || 0.001;
    bd.nx = dx / d; bd.ny = dy / d;
    var swirl = 10 * f.dir; // 鍔迫り合い中も二振りが押し合いながら回る
    f.vx = cvx * 0.9 + bd.nx * push - bd.ny * swirl; f.vy = cvy * 0.9 + bd.ny * push + bd.nx * swirl;
    g.vx = cvx * 0.9 + bd.nx * push + bd.ny * swirl; g.vy = cvy * 0.9 + bd.ny * push - bd.nx * swirl;
    // 保持刀刃相抵的距離（以中點為軸）
    var mx = (f.x + g.x) / 2, my = (f.y + g.y) / 2, half = (reach(f) + reach(g)) * 0.48;
    f.x = mx - bd.nx * half; f.y = my - bd.ny * half;
    g.x = mx + bd.nx * half; g.y = my + bd.ny * half;
    // 兩把刀互相削耐久與勢い
    [[f, g], [g, f]].forEach(function (pr) {
      var me = pr[0], op = pr[1];
      var rate = 6.5 * me.prof.atk / op.prof.def * dmgMul(me) * (has(me, "slice") ? 1.2 : 1) * (me.fx.momiji > 0 ? 1.6 : 1) * bprod(me, "bindMul");
      hit(a, me, op, rate * DT, "bind");
      op.spin -= (0.045 + (me.fx.momiji > 0 ? 0.08 : 0) + (has(me, "wave") ? 0.03 : 0) + bsum(me, "bindDrain")) * DT * (pf + pg) / (2 * Math.max(0.1, power(op)));
    });
    bd.sparkT -= DT;
    if (bd.sparkT <= 0) { bd.sparkT = 0.07; emit(a, { type: "spark", x: (f.x + g.x) / 2, y: (f.y + g.y) / 2, momiji: f.fx.momiji > 0 || g.fx.momiji > 0, fire: bany(f, "flame") || bany(g, "flame") }); }
    if (bd.t > 0) return;
    // 彈開：推力強的一方把對方彈得更遠（重擊 ×1.5）
    var j = 55 + 35 * Math.abs(pf - pg) / (pf + pg);
    var kf = (has(g, "heavy") ? 1.5 : 1) * (pg >= pf ? 1.25 : 0.8);
    var kg = (has(f, "heavy") ? 1.5 : 1) * (pf >= pg ? 1.25 : 0.8);
    f.vx -= bd.nx * j * kf * mg / (mf + mg) * 2; f.vy -= bd.ny * j * kf * mg / (mf + mg) * 2;
    g.vx += bd.nx * j * kg * mf / (mf + mg) * 2; g.vy += bd.ny * j * kg * mf / (mf + mg) * 2;
    pairCool(a, f, g, 0.7);
    emit(a, { type: "release", x: (f.x + g.x) / 2, y: (f.y + g.y) / 2 });
    [[f, g], [g, f]].forEach(function (pr) {
      var me = pr[0], op = pr[1];
      // 開花斬：鍔迫り合いが解ける瞬間に斬り広げる
      if (me.fx.kaika > 0 && me.alive && op.alive) {
        me.fx.kaika = 0;
        hit(a, me, op, 12 * me.prof.atk / op.prof.def * dmgMul(me), "kaika");
        op.vx += bd.nx * (me === f ? 90 : -90); op.vy += bd.ny * (me === f ? 90 : -90);
        emit(a, { type: "bloom", f: me.id, x: (f.x + g.x) / 2, y: (f.y + g.y) / 2 });
      }
      if (has(me, "double")) hit(a, me, op, 4 * me.prof.atk / op.prof.def * dmgMul(me), "double");
      if (me.alive && has(me, "soft") && rnd(a) < 0.3) { me.bends++; me.driveMul *= 0.92; emit(a, { type: "bend", f: me.id, x: me.x, y: me.y }); }
    });
  }

  // ---------------- 一步 ----------------
  function step(a) {
    if (a.over) return;
    a.time += DT;
    var newRound = Math.floor(a.time / ROUND_S) + 1;
    if (newRound !== a.round) roundBoundary(a, newRound);
    if (a.over) return;

    a.fighters.forEach(function (f) {
      if (!f.alive) return;
      var fx = f.fx;
      Object.keys(fx).forEach(function (k) { if (fx[k] > 0) fx[k] = Math.max(0, fx[k] - DT); });
      var nb = f.buffs.length;
      f.buffs = f.buffs.filter(function (b) { b.t -= DT; return b.t > 0; });
      if (nb !== f.buffs.length) a.ver++;
      var regen = bsum(f, "regen");
      if (regen) f.hp = Math.min(f.prof.maxHp, f.hp + regen * DT);
      var curse = bsum(f, "curse");
      if (curse) hit(a, null, f, curse * DT, "curse");
      // 居合：納刀停住，時間到時抜き打ちで周囲を薙ぐ
      if (fx.iaiHold > 0) {
        f.vx *= 0.8; f.vy *= 0.8;
        if (fx.iaiHold <= DT) {
          fx.iaiHold = 0;
          emit(a, { type: "iai", f: f.id, x: f.x, y: f.y, r: f.prof.radius * 3.5 });
          a.fighters.forEach(function (g) {
            if (g === f || !g.alive) return;
            var dx = g.x - f.x, dy = g.y - f.y, d = Math.hypot(dx, dy) || 1;
            if (d > f.prof.radius * 3.5 + g.prof.radius) return;
            hit(a, f, g, 16 * f.prof.atk / g.prof.def * dmgMul(f), "iai");
            g.vx += dx / d * 80; g.vy += dy / d * 80;
          });
          f.spin = Math.min(1, f.spin + 0.1);
        }
      }
      // 持續傷害（灼燒・出血）
      f.dots = f.dots.filter(function (dt) {
        dt.t -= DT;
        hit(a, byFid(a, dt.src), f, dt.dps * DT, dt.kind);
        return dt.t > 0 && f.alive;
      });
      if (!f.alive) return;
      if (fx.stun > 0) { f.vx *= 0.85; f.vy *= 0.85; return; }
      if (bound(a, f)) return;

      var r = Math.hypot(f.x, f.y) || 0.001;
      var ux = f.x / r, uy = f.y / r;
      var ax = -BOWL_K * f.x, ay = -BOWL_K * f.y;
      // 勢い推動繞場（切線方向）
      var drive = f.prof.drive * f.driveMul * (0.25 + 0.75 * f.spin) * (fx.dash > 0 ? 1.5 : 1) * (fx.slow > 0 ? 0.55 : 1) * bprod(f, "speed");
      ax += -uy * f.dir * drive; ay += ux * f.dir * drive;
      // 追擊／閃避
      var e = nearestEnemy(a, f);
      if (e && !bany(f, "noSeek")) {
        var ex = e.x - f.x, ey = e.y - f.y, ed = Math.hypot(ex, ey) || 1;
        var seek = f.prof.seek * (0.4 + f.spin);
        ax += ex / ed * seek; ay += ey / ed * seek;
        if (fx.issen > 0) { f.vx = ex / ed * 150; f.vy = ey / ed * 150; }
        // 覺醒招式發動中：把速度導向對手（否則效果時間內常常碰不到人）
        if (f.buffs.length && fx.issen <= 0) { var k = Math.min(1, 2.5 * DT); f.vx += (ex / ed * 75 - f.vx) * k; f.vy += (ey / ed * 75 - f.vy) * k; }
      }
      // 渦紋嵐：把其他刀吸過來
      if (bany(f, "vortex")) {
        a.fighters.forEach(function (g) {
          if (g === f || !g.alive || bound(a, g)) return;
          var dx = f.x - g.x, dy = f.y - g.y, d = Math.hypot(dx, dy) || 1;
          g.vx += dx / d * 60 * DT; g.vy += dy / d * 60 * DT;
        });
      }
      // 勢い越低越晃
      f.wander -= DT;
      if (f.wander <= 0) {
        var wa = rnd(a) * Math.PI * 2, wm = 18 + 30 * (1 - f.spin);
        f.vx += Math.cos(wa) * wm; f.vy += Math.sin(wa) * wm;
        f.wander = 0.7 + rnd(a) * 0.9;
      }
      if (fx.issen <= 0) {
        f.vx += ax * DT; f.vy += ay * DT;
        var fr = Math.exp(-FRICTION * DT);
        f.vx *= fr; f.vy *= fr;
      }
      f.spin -= f.prof.decay * DT;
    });

    a.fighters.forEach(function (f) {
      if (!f.alive) return;
      f.x += f.vx * DT; f.y += f.vy * DT;
      f.rot += (6 + 22 * f.spin) * f.dir * DT;
      // 場地邊緣（注連縄）：反彈並損失勢い
      var r = Math.hypot(f.x, f.y), lim = R - f.prof.radius;
      if (r > lim) {
        var ux = f.x / r, uy = f.y / r, vr = f.vx * ux + f.vy * uy;
        f.x = ux * lim; f.y = uy * lim;
        if (vr > 0) {
          f.vx -= ux * vr * 1.6; f.vy -= uy * vr * 1.6;
          if (vr > 45) { f.spin -= 0.015; hit(a, null, f, 1, "wall"); emit(a, { type: "wall", x: f.x, y: f.y }); }
        }
      }
    });

    for (var i = 0; i < a.fighters.length; i++) {
      for (var j = i + 1; j < a.fighters.length; j++) {
        var f = a.fighters[i], g = a.fighters[j];
        if (f.alive && g.alive) collide(a, f, g);
      }
    }
    a.binds.forEach(function (bd) { stepBind(a, bd); });
    a.binds = a.binds.filter(function (bd) { return bd.t > 0; });

    // 延遲的招式斬擊（音之呼吸的連擊等）
    a.timed = a.timed.filter(function (tm) {
      tm.t -= DT;
      if (tm.t > 0) return true;
      doStrike(a, byFid(a, tm.owner), Core.byId(D.SPECIALS, tm.sp));
      return false;
    });

    // 流星等場上的危險物
    a.hazards = a.hazards.filter(function (hz) {
      hz.t -= DT;
      if (hz.t > 0) return true;
      var owner = byFid(a, hz.owner);
      emit(a, { type: "meteor", x: hz.x, y: hz.y, r: hz.r });
      a.fighters.forEach(function (g) {
        if (!g.alive || g.id === hz.owner) return;
        if (Math.hypot(g.x - hz.x, g.y - hz.y) <= hz.r + g.prof.radius) hit(a, owner, g, hz.dmg / g.prof.def, "meteor");
      });
      return false;
    });

    a.fighters.forEach(function (f) { if (f.alive && f.spin <= 0) { f.spin = 0; knockOut(a, f, "stall"); } });
    checkEnd(a);
  }

  function aiChoose(a, f) {
    if (f.human || !f.alive || f.queue.length >= QUEUE) return;
    var rng = Core.makeRng(a.seed + "|ai|" + f.id + "|" + a.round);
    if (f.special && !f.specialUsed && (f.hp < f.prof.maxHp * 0.7 || a.round >= 2) && rng() < 0.7) { queueCard(a, f.id, "special"); return; }
    if (!f.hand.length || rng() > 0.55) return;
    var pick = f.hand[Math.floor(rng() * f.hand.length)];
    if (f.spin < 0.4) f.hand.forEach(function (h) { if (h.card === "spin") pick = h; });
    queueCard(a, f.id, pick.uid);
  }

  function roundBoundary(a, newRound) {
    a.round = newRound;
    a.ver++;
    if (a.round > MAX_ROUNDS) { finish(a, "time"); return; }
    a.fighters.forEach(function (f) {
      if (!f.alive) return;
      var keep = [];
      f.queue.forEach(function (q) { if (q.at <= a.round) activate(a, f, q.card); else keep.push(q); });
      f.queue = keep;
      draw(f, HAND);
    });
    a.fighters.forEach(function (f) { aiChoose(a, f); });
    emit(a, { type: "round", n: a.round });
  }

  function score(f) { return f.hp / f.prof.maxHp * 0.7 + f.spin * 0.3; }

  function checkEnd(a) {
    if (a.over) return;
    var al = alive(a);
    if (al.length <= 1) finish(a, al.length ? "last" : "double");
  }

  function finish(a, why) {
    if (a.over) return;
    a.over = true;
    a.binds = [];
    var al = alive(a).sort(function (x, y) { return score(y) - score(x); });
    var winner = al[0] || null;
    if (!winner) {
      // 同時退場：最後退場者中剩餘耐久最高的一方
      var last = a.fighters.slice().sort(function (x, y) { return (y.outTime - x.outTime) || (y.hp - x.hp); })[0];
      winner = last;
    }
    a.winner = winner.id;
    a.endReason = why;
    a.ver++;
    emit(a, { type: "end", f: winner.id });
  }

  // 名次：勝者第 1；其餘存活者依分數；退場者依退場時間晚者在前
  function result(a) {
    var order = a.fighters.slice().sort(function (x, y) {
      if (x.id === a.winner) return -1;
      if (y.id === a.winner) return 1;
      if (x.alive !== y.alive) return x.alive ? -1 : 1;
      if (x.alive) return score(y) - score(x);
      return (y.outTime - x.outTime) || (y.hp - x.hp);
    });
    return {
      winner: a.winner, reason: a.endReason || null, rounds: Math.min(a.round, MAX_ROUNDS), time: Math.round(a.time * 10) / 10,
      placing: order.map(function (f) { return f.id; }),
      summary: a.fighters.map(function (f) {
        return { id: f.id, hp: Math.round(f.hp), maxHp: f.prof.maxHp, chips: f.chips, bends: f.bends, alive: f.alive, out: f.out,
          dealt: Math.round(f.dealt), spin: Math.round(f.spin * 100) };
      })
    };
  }

  // 一口氣跑到結束（測試與「快轉」用）。plan：{ [秒數]: [[fid, uid|"special"], ...] } 可選
  function run(a, maxSeconds) {
    var limit = (maxSeconds || (MAX_ROUNDS * ROUND_S + 5)) / DT;
    for (var i = 0; i < limit && !a.over; i++) step(a);
    a.events = [];
    return result(a);
  }

  window.PriTestKatanaArena = {
    R: R, DT: DT, ROUND_S: ROUND_S, MAX_ROUNDS: MAX_ROUNDS, HAND: HAND, QUEUE: QUEUE,
    profile: profile, create: create, bany: bany, step: step, queueCard: queueCard, result: result, run: run, cardDef: cardDef
  };
})();
