// 射彈宇宙（shedan）：戰鬥規則。只吃「事件」、回傳「指令」，不碰 matter.js 與 DOM，可以在 Node 直接測試。
// 規則依據 docs/shedan_game_design.md §2～§4（含 §4.1 射擊特性、§4.2 友情技、§4.3 技能）、§6.1 敵人特性、§7.1 Boss、
// §8（星座、小行星、殘影）、§9～§10.1（套裝與遺物）。
// 角色效果依資料的 kind 分派；遺物與套裝一律讀 b.mods（D.computeMods 的結果），不為單一遺物寫獨立流程。
// 瀏覽器掛在 window.PriTestShedanCombat。
//
// 事件 → 函式：hit→onHit、ally→onAlly、wall→onWall、rock→onRock、debris→onDebris、殘影→onGhost、每子步位置→onPos
// 指令（cmds）給畫面與物理：
//   damage{uid,amount,x,y,kind}  explode{x,y,radius,depth}  kill{uid}  reaction{uid,id,x,y}  mark{uid,el}
//   move{uid,x,y}  arc{from,to}  gauge  heal{amount}  shield{ratio}  laser{x1,y1,x2,y2,el}  bolt{fromX,fromY,uid,el}
//   well{x,y,radius,hole}  wall{x1,y1,x2,y2}  debris{x,y,n,el}  rockBreak{id,x,y}  star{key,x,y}  addStar{x,y}
//   constellation{id,n}  skill{id}  friend{ally,id}  pierceOff  spawn{uid}  shooterVel{mult,rotate,cap}
//   enemySensor{uid,on}  removeWells{owner}  addRock{id,x,y}  teamDamage{amount}  enemyHeal{uid,amount}
//   shieldBreak{uid}  allPartsDown{uid}  miss{uid}  lifePod  relic{id}
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestShedanData || (typeof require === "function" ? require("./shedan_data.js") : null);
  var K = D.C;

  // 規則層認得的類型（資料檢查用）
  var TRAIT_KINDS = ["none", "push", "pierce", "pierceFirst", "spark", "split", "frostTrail", "wallFreeze", "wallArc", "hitArc",
    "wallPull", "hitPull", "wellBoost", "markSpread", "big", "noDecay", "randomMark", "heal", "laser", "gaugeDrain",
    "echoMark", "execute", "markToTrue"];
  var FRIEND_KINDS = ["cross", "beam", "bolts", "blast", "strike", "chain", "net", "zoneAt", "markAll", "meteor", "push",
    "wellAt", "iceWall", "shield", "heal", "voidGate"];
  var SKILL_KINDS = ["hitBlast", "firstHits", "stopBlast", "forceBurn", "chainBoost", "hitSlow", "markAll", "pierce", "slowAll",
    "multiArc", "wallStorm", "capacitor", "redirect", "wellAtLaunch", "killCollapse", "hitVuln", "deflect", "spreadBoost",
    "conceal", "grow", "lightspeed", "refract", "sanctuary", "focus", "devour", "abyssKill", "echo", "execute", "nullify"];
  var ELITE_HP = 2.5;

  // ---------------- 倍率 ----------------
  function hitMult(hits) { return 1 + Math.floor(hits / K.HIT_STEP) * K.HIT_STEP_BONUS; }
  function elemMult(def, el, corroded, weakAdd) {
    if (def.weak.indexOf(el) >= 0) return K.WEAK_MULT + (weakAdd || 0);
    if (!corroded && def.resist.indexOf(el) >= 0) return K.RESIST_MULT;
    return 1;
  }
  function speedFactor(speed) { return Math.max(K.SPEED_FACTOR_MIN, Math.min(1, speed / K.SPEED_MAX)); }
  function M(b, k) { return (b.mods && b.mods[k]) || 0; }
  // 對敵人 e 的屬性倍率（含屬性透鏡、腐蝕）
  function em(b, e, el) { return elemMult(e, el, corroded(b, e), M(b, "weakMultAdd")); }

  // ---------------- 建立戰鬥 ----------------
  var uidSeq = 0;
  var MAX_ENEMIES = 10;          // 召喚／孵化／分裂的上限（§6.1）

  // 一個敵人實體。弱點／抗性複製一份（稜鏡獸、鏡像分身、星蝕使徒會改）
  function makeEnemy(b, def, x, y, extra) {
    var hp = extra && extra.hp != null ? extra.hp : def.hp;
    if (extra && extra.elite) hp = Math.round(hp * ELITE_HP);
    var e = {
      uid: "e" + (++uidSeq), def: def, hp: hp, hpMax: hp, r: def.r || D.SIZE_R[def.size],
      x: x, y: y, cd: def.cd, cdMax: def.cd, mark: null, slowUsed: false, superconduct: false, dead: false,
      weak: def.weak.slice(), resist: def.resist.slice(), trait: def.trait || "", turns: 0,
      hidden: false, shielded: def.trait === "selfShield", owner: null, role: null, partner: null, host: null, elite: null
    };
    if (e.trait === "shiftWeak" && b) e.weak = [D.ELEMENTS[Math.floor(b.rng() * D.ELEMENTS.length)]];
    if (extra) Object.keys(extra).forEach(function (k) { if (k !== "hp") e[k] = extra[k]; });
    if (e.elite === "haste" && e.cdMax) { e.cdMax = Math.max(1, e.cdMax - 1); e.cd = Math.min(e.cd, e.cdMax); }
    return e;
  }

  // opts = {heroes, enemies:[{def,x,y,elite}], field, rng, boss, mods, hp, hpMax, gaugeMinus:{heroId:n}, fullGauge, lifePodUsed}
  function create(opts) {
    var mods = opts.mods || {};
    var party = opts.heroes.map(function (h) {
      // 量表上限：休息的「強化技能」（gaugeMinus，遠征層）＋冷卻劑／技能 3（mods）
      var gm = Math.max(5, h.gauge - ((opts.gaugeMinus && opts.gaugeMinus[h.id]) || 0) - (mods.gaugeMaxMinus || 0));
      return { id: h.id, def: h, element: h.element, atk: h.atk, gauge: 0, gaugeMax: gm };
    });
    var hpMax = opts.hpMax || Math.round(opts.heroes.reduce(function (s, h) { return s + h.hp; }, 0) * (1 + (mods.hpMaxMult || 0)));
    var field = opts.field || {};
    var b = {
      party: party, hp: opts.hp != null ? opts.hp : hpMax, hpMax: hpMax, enemies: [], zones: [], acids: [],
      stars: (field.stars || []).map(function (s) { return { x: s.x, y: s.y }; }),
      rocks: (field.rocks || []).map(function (r, i) { return { id: "r" + i, x: r.x, y: r.y, r: K.ROCK_R, dur: mods.rockFragile ? 1 : K.ROCK_DUR, broken: false }; }),
      wells: (field.wells || []).slice(),
      echoes: [], shield: 0, shieldCharges: 0, armorBreak: false, nullTurns: 0, ghostNext: false,
      rng: opts.rng || Math.random, bossUid: null, rockSeq: (field.rocks || []).length,
      mods: mods, hitCount: {}, shooterPos: null,
      flags: { firstChainDone: false, deflectorUsed: false, emergencyUsed: false, twoStageUsed: false, backupDone: false,
        lifePodUsed: !!opts.lifePodUsed, fireworksTurn: 0, guardRoundUsed: false, holeDone: false },
      active: 0, turnNo: 1,
      shot: newShot(null),
      stats: { damage: 0, maxChain: 0, shots: 0 }
    };
    var wellR = K.WELL_R * (1 + (mods.wellRadius || 0));
    if (opts.boss) {
      var B = D.BOSS_BY_ID[opts.boss], bx = K.FIELD_W / 2, by = 240;
      var body = makeEnemy(b, B.body, bx, by, { role: "body", bossId: B.id });
      b.enemies.push(body);
      b.bossUid = body.uid;
      B.parts.forEach(function (p) {
        var pe = makeEnemy(b, p.def, bx + p.dx, by + p.dy, { role: "part", owner: body.uid, partKey: p.key });
        b.enemies.push(pe);
        if (p.key === "core") b.wells.push({ x: pe.x, y: pe.y, radius: wellR, hole: false, owner: pe.uid });
      });
    }
    opts.enemies.forEach(function (x) { b.enemies.push(makeEnemy(b, x.def, x.x, x.y, x.elite ? { elite: x.elite } : null)); });
    var normals = b.enemies.slice();
    // 成對（雙子球、引力雙星）：依出現順序兩兩配對
    ["linked", "binary"].forEach(function (tr) {
      var list = normals.filter(function (e) { return e.trait === tr; });
      for (var i = 0; i + 1 < list.length; i += 2) { list[i].partner = list[i + 1].uid; list[i + 1].partner = list[i].uid; }
    });
    normals.forEach(function (e) {
      if (e.trait === "parasite") {
        var host = null, bd = Infinity;
        normals.forEach(function (o) { if (o !== e && o.trait !== "parasite" && o.role !== "part") { var d = dist(o, e.x, e.y); if (d < bd) { bd = d; host = o; } } });
        if (host) e.host = host.uid;
      }
      if (e.trait === "serpent") {
        for (var k = 1; k <= 3; k++) {
          var sd = D.SPAWN_DEFS.serpent_body;
          var hpPart = Math.round(sd.hp * (e.def.hp / 1680));
          b.enemies.push(makeEnemy(b, sd, e.x, Math.min(K.FIELD_H - 160, e.y + e.r + k * 46 - 10), { role: "part", owner: e.uid, hp: hpPart }));
        }
      }
      if (e.trait === "ownWell") b.wells.push({ x: e.x, y: e.y, radius: wellR, hole: false, owner: e.uid });
    });
    // 開場（遺物）：不穩定核心 倒數 −1、時間緩衝 倒數 +1、充能電池、共鳴水晶（事件）
    b.enemies.forEach(function (e) {
      if (!e.cdMax) return;
      if (mods.unstable) { e.cdMax = Math.max(1, e.cdMax - 1); e.cd = Math.max(1, e.cd - 1); }
      if (mods.timeBuffer) e.cd += 1;
    });
    party.forEach(function (p) {
      if (mods.startGauge) p.gauge = Math.min(p.gaugeMax, mods.startGauge);
      if (opts.fullGauge) p.gauge = p.gaugeMax;
    });
    return b;
  }
  function newShot(skill) {
    return {
      hits: 0, chain: 0, lastHit: {}, skill: skill, allies: {}, lit: [], hitDmg: {}, frosted: {}, slowed: {}, vuln: {}, slowedBy: {}, acidHit: {},
      pierceFirstUsed: false, hitIndex: 0, ended: false,
      pulled: {}, drill: 0, walls: 0, afterWall: false, friends: 0, unionDone: false, chainGaugeDone: false, kept: {}, ghostAllies: {}, wellsEntered: {}
    };
  }

  function byUid(b, uid) {
    for (var i = 0; i < b.enemies.length; i++) if (b.enemies[i].uid === uid) return b.enemies[i];
    return null;
  }
  function alive(b) { return b.enemies.filter(function (e) { return !e.dead; }); }
  function dist(a, x, y) { var dx = a.x - x, dy = a.y - y; return Math.sqrt(dx * dx + dy * dy); }
  function corroded(b, e) { return b.nullTurns > 0 || !!(e.mark && e.mark.el === "nebula"); }
  function shooter(b) { return b.party[b.active]; }
  function skillKind(b) { return b.shot.skill ? b.shot.skill.kind : null; }
  function trait(p) { return p.def.trait || { kind: "none" }; }
  function randomEl(b, not) {
    var list = D.ELEMENTS.filter(function (x) { return x !== not; });
    return list[Math.floor(b.rng() * list.length)];
  }

  // ---------------- 量表 ----------------
  // 量表上限：溢流儲存可以超出 10
  function gaugeCap(b, p) { return p.gaugeMax + (b.mods.overflow ? 10 : 0); }
  function addGauge(b, p, n) { p.gauge = Math.max(0, Math.min(gaugeCap(b, p), p.gauge + n)); }
  function gaugeAll(b, n, ctx) {
    b.party.forEach(function (p) { addGauge(b, p, n); });
    ctx.cmds.push({ type: "gauge" });
  }

  // ---------------- 傷害與連爆 ----------------
  // 敵人那一側的減傷倍率（§6.1、§7.1、精英護盾）。kind 是傷害種類（hit／explode／...）
  function enemyTakeMult(b, e, kind) {
    var m = 1, cor = corroded(b, e);
    if (kind === "hit" && e.trait === "armored") m *= 0.7;
    if (kind === "hit" && e.trait === "explosionOnly") m *= 0.5;
    if (kind === "hit" && e.trait === "serpent") m *= 2;
    if (e.shielded && !cor) m *= 0.2;
    if (e.elite === "shield" && !cor) m *= 0.5;
    if (e.role === "body" && alive(b).some(function (o) { return o.owner === e.uid && o.partKey === "shieldGen"; })) m *= 0.2;
    if (!cor) {
      var others = alive(b).filter(function (o) { return o !== e; });
      if (others.some(function (o) { return o.trait === "shieldAllies" && dist(o, e.x, e.y) <= 120 + e.r; })) m *= 0.5;
      if (others.some(function (o) { return o.trait === "aura" && dist(o, e.x, e.y) <= 150 + e.r; })) m *= 0.8;
    }
    return m;
  }
  function isProtected(b, e) {
    return alive(b).some(function (o) { return o !== e && o.trait === "protect" && dist(o, e.x, e.y) <= 200 + e.r; });
  }

  // 我方對敵人的傷害倍率（遺物、技能）。只在射擊中有效的放在 shot 區塊
  function outgoingMult(b, e) {
    var a = 1 + M(b, "dmgAll");
    if (!b.shot.ended) {
      if (b.shot.vuln[e.uid]) a *= 1 + b.shot.skill.mult;
      if (skillKind(b) === "execute" && e.hp <= e.hpMax * b.shot.skill.threshold) a *= b.shot.skill.mult;
      if (b.shot.skill) a *= 1 + M(b, "skillShotDmg") + (b.active === 0 ? M(b, "leaderSkill") : 0);   // 技能迴路、指揮官徽章
      if (b.mods.tidalLock && b.shot.pulled[e.uid]) a *= 1.2;                                          // 潮汐鎖定
      if (b.shot.drill) a *= 1 + 0.15 * b.shot.drill;                                                  // 撞擊鑽頭
    }
    return a;
  }

  // ctx = {cmds, queue, el}：el 是這次傷害（與連爆）的屬性
  function damage(b, e, amount, kind, depth, ctx, noLink) {
    if (e.dead) return 0;
    var a = amount * enemyTakeMult(b, e, kind) * outgoingMult(b, e);
    if (e.shielded && kind === "explode") { e.shielded = false; ctx.cmds.push({ type: "shieldBreak", uid: e.uid }); }
    var n = Math.max(0, Math.round(a));
    if (!n) return 0;
    if (e.trait === "absorbLight" && ctx.el === "photon") {
      var h0 = e.hp;
      e.hp = Math.min(e.hpMax, e.hp + n);
      ctx.cmds.push({ type: "enemyHeal", uid: e.uid, amount: e.hp - h0, x: e.x, y: e.y });
      return 0;
    }
    if (e.hp - n < 1 && isProtected(b, e)) n = Math.max(0, e.hp - 1);
    if (!n) return 0;
    e.hp -= n;
    b.stats.damage += n;
    ctx.cmds.push({ type: "damage", uid: e.uid, amount: n, x: e.x, y: e.y, kind: kind });
    if (!noLink && e.trait === "linked" && e.partner) {
      var pt = byUid(b, e.partner);
      if (pt && !pt.dead) damage(b, pt, n * 0.5 / (enemyTakeMult(b, pt, kind) * outgoingMult(b, pt)), kind, depth, ctx, true);
    }
    if (e.hp > 0) return n;
    e.hp = 0;
    e.dead = true;
    ctx.cmds.push({ type: "kill", uid: e.uid });
    onKill(b, e, depth, ctx);
    return n;
  }

  function vanish(b, e, ctx) {
    if (e.dead) return;
    e.dead = true; e.hp = 0;
    ctx.cmds.push({ type: "kill", uid: e.uid, silent: true });
    dropOwned(b, e, ctx);
  }
  function dropOwned(b, e, ctx) {
    if (b.wells.some(function (g) { return g.owner === e.uid; })) {
      b.wells = b.wells.filter(function (g) { return g.owner !== e.uid; });
      ctx.cmds.push({ type: "removeWells", owner: e.uid });
    }
    b.enemies.forEach(function (o) {
      if (!o.dead && (o.owner === e.uid || o.host === e.uid)) vanish(b, o, ctx);
    });
  }

  function onKill(b, e, depth, ctx) {
    var during = !b.shot.ended;
    var sk = during ? b.shot.skill : null;
    if (sk && sk.kind === "abyssKill") gaugeAll(b, sk.gauge, ctx);
    if (sk && sk.kind === "killCollapse") {
      pullToward(b, e, sk.pull, 0.6, ctx.cmds);
      ctx.queue.push({ x: e.x, y: e.y, radius: sk.radius, amount: shooter(b).atk * sk.mult, depth: depth + 1 });
    }
    if (during && b.mods.killGauge) addGauge(b, shooter(b), 1);                      // 擊破充能
    if (b.mods.novaStar && b.rng() < 0.3) { b.stars.push({ x: e.x, y: e.y }); ctx.cmds.push({ type: "addStar", x: e.x, y: e.y }); }   // 新星標記
    dropOwned(b, e, ctx);
    var tr = e.trait, children = [];
    if (tr === "split" || e.elite === "split") {
      var childDef = tr === "split" ? D.SPAWN_DEFS.splitter_shard : e.def;
      [-1, 1].forEach(function (s) {
        var ch = spawnEnemy(b, childDef, e.x + s * e.r, e.y, ctx, { hp: Math.round(e.hpMax * 0.3) });
        if (ch) children.push(ch.uid);
      });
    }
    if (tr === "acidPool") b.acids.push({ x: e.x, y: e.y, radius: 80, turns: 2 });
    if (tr === "drainOnDeath") b.party.forEach(function (p) { p.gauge = Math.max(0, p.gauge - 2); });
    if (tr === "oblivion") b.enemies.forEach(function (o) { o.mark = null; });
    if (e.role === "part" && e.owner) {
      var body = byUid(b, e.owner);
      var parts = b.enemies.filter(function (o) { return o.owner === e.owner; });
      if (body && !body.dead && body.role === "body" && parts.every(function (o) { return o.dead; }) && !body.allPartsDown) {
        body.allPartsDown = true;
        if (parts.some(function (o) { return o.partKey === "core"; })) body.cd += 2;
        ctx.cmds.push({ type: "allPartsDown", uid: body.uid });
        damage(b, body, body.hpMax * 0.1, "true", depth, ctx);
      }
    }
    if (e.mark && e.mark.el === "void") {
      var g = Math.floor(e.hpMax * K.VOID_GAUGE_RATIO / K.VOID_GAUGE_DIV);
      if (sk && sk.kind === "devour") g *= sk.mult;
      gaugeAll(b, g, ctx);
      return;
    }
    // 連爆（§2＋遺物）：引信強化、爆裂 3（半徑）、爆心標定器（第一次 ×2）、誘爆彈頭（小型至少攻 ×1.5）
    var rad = e.r * K.CHAIN_RADIUS_MULT * (tr === "selfDestruct" ? 2 : 1) * (1 + M(b, "chainRadius"));
    if (b.mods.firstChainRadius && !b.flags.firstChainDone) rad *= 2;
    b.flags.firstChainDone = true;
    var amt = e.hpMax * K.CHAIN_DMG_RATIO;
    if (b.mods.warhead && e.def.size === "s") amt = Math.max(amt, shooter(b).atk * 1.5);
    amt *= 1 + M(b, "chainDmg");
    ctx.queue.push({ x: e.x, y: e.y, radius: rad, amount: amt, depth: depth + 1, exclude: children });
  }

  // ---------------- 生成／移動 ----------------
  function findSpot(b, x0, y0, r, spread, self, avoid) {
    var others = alive(b).filter(function (o) { return o !== self; }).map(function (o) { return { x: o.x, y: o.y, r: o.r }; });
    b.rocks.forEach(function (k) { if (!k.broken) others.push({ x: k.x, y: k.y, r: k.r }); });
    (avoid || b.avoid || []).forEach(function (a) { others.push(a); });
    for (var i = 0; i < 20; i++) {
      var x, y;
      if (spread == null) {
        var fx = (b.rng() + i * 0.618034) % 1, fy = (b.rng() + i * 0.381966) % 1;
        x = r + 20 + fx * (K.FIELD_W - 2 * r - 40); y = 100 + fy * 560;
      } else {
        var a = b.rng() * Math.PI * 2 + i * 2.39996, d = spread * (1 + i * 0.12);
        x = x0 + Math.cos(a) * d; y = y0 + Math.sin(a) * d;
      }
      if (x < r + 4 || x > K.FIELD_W - r - 4 || y < r + 60 || y > 720) continue;
      if (others.every(function (o) { var dx = o.x - x, dy = o.y - y; return Math.sqrt(dx * dx + dy * dy) > o.r + r + 8; })) return { x: x, y: y };
    }
    return null;
  }
  function spawnEnemy(b, def, x, y, ctx, extra) {
    if (alive(b).length >= MAX_ENEMIES) return null;
    var r = def.r || D.SIZE_R[def.size];
    var spot = findSpot(b, x, y, r, r * 2 + 10, null);
    if (!spot) return null;
    var e = makeEnemy(b, def, spot.x, spot.y, extra);
    b.enemies.push(e);
    ctx.cmds.push({ type: "spawn", uid: e.uid });
    return e;
  }
  function moveTo(b, e, x, y, ctx) {
    e.x = x; e.y = y;
    ctx.cmds.push({ type: "move", uid: e.uid, x: x, y: y });
  }
  function addRockAt(b, ctx) {
    if (b.rocks.filter(function (k) { return !k.broken; }).length >= 4) return;
    var spot = findSpot(b, 0, 0, K.ROCK_R, null, null);
    if (!spot) return;
    var rk = { id: "r" + (b.rockSeq++), x: spot.x, y: spot.y, r: K.ROCK_R, dur: b.mods.rockFragile ? 1 : K.ROCK_DUR, broken: false };
    b.rocks.push(rk);
    ctx.cmds.push({ type: "addRock", id: rk.id, x: rk.x, y: rk.y });
  }
  function breakRock(b, r, ctx) {
    if (r.broken) return;
    r.broken = true;
    ctx.cmds.push({ type: "rockBreak", id: r.id, x: r.x, y: r.y });
    ctx.cmds.push({ type: "debris", x: r.x, y: r.y, n: 3 + Math.floor(b.rng() * 3) + M(b, "debrisExtra"), el: shooter(b).element });
    if (!b.shot.ended && b.mods.drill) b.shot.drill++;
  }

  // 依序處理爆炸佇列（用佇列避免遞迴過深）
  function resolve(b, ctx) {
    var during = !b.shot.ended;
    var boost = (during && skillKind(b) === "chainBoost" ? b.shot.skill.per : 0) + M(b, "chainDepthBoost");
    while (ctx.queue.length) {
      var x = ctx.queue.shift();
      if (during && x.depth > b.shot.chain) b.shot.chain = x.depth;
      ctx.cmds.push({ type: "explode", x: x.x, y: x.y, radius: x.radius, depth: x.depth });
      var amt0 = x.amount * (1 + boost * x.depth);
      alive(b).forEach(function (e) {
        if (dist(e, x.x, x.y) > x.radius + e.r) return;
        if (x.exclude && x.exclude.indexOf(e.uid) >= 0) return;
        var el = x.el || ctx.el;
        damage(b, e, x.trueDmg ? amt0 : amt0 * em(b, e, el), "explode", x.depth, ctx);
      });
      if (!during) continue;
      // 遺物：連鎖雷管、煙火庫、衝擊波發生器、爆裂碎片
      if (b.mods.chainGauge && b.shot.chain >= 3 && !b.shot.chainGaugeDone) { b.shot.chainGaugeDone = true; gaugeAll(b, 3, ctx); }
      if (b.mods.fireworks && x.depth >= 1 && b.flags.fireworksTurn !== b.turnNo) {
        b.flags.fireworksTurn = b.turnNo;
        for (var f = 0; f < 3; f++) {
          var live = alive(b);
          if (!live.length) break;
          var tg = live[Math.floor(b.rng() * live.length)];
          ctx.cmds.push({ type: "bolt", fromX: x.x, fromY: x.y, uid: tg.uid, el: shooter(b).element });
          damage(b, tg, shooter(b).atk * 0.5 * em(b, tg, shooter(b).element), "friend", 0, ctx);
        }
      }
      if (b.mods.shockwave && b.shooterPos && dist(b.shooterPos, x.x, x.y) <= x.radius) ctx.cmds.push({ type: "shooterVel", mult: 1.15, rotate: 0, cap: K.SPEED_MAX });
      if (b.mods.rockBlast) b.rocks.forEach(function (r) { if (!r.broken && dist(r, x.x, x.y) <= x.radius + r.r) breakRock(b, r, ctx); });
    }
  }

  function newCtx(el) { return { cmds: [], queue: [], el: el }; }

  function pullToward(b, center, range, ratio, cmds) {
    alive(b).forEach(function (o) {
      if (o === center) return;
      var d = dist(o, center.x, center.y);
      if (d > range || d < 1e-6) return;
      var minD = o.r + (center.r || 0) + 4;
      var nd = Math.max(minD, d * (1 - ratio));
      if (nd >= d) return;
      o.x = center.x + (o.x - center.x) * nd / d;
      o.y = center.y + (o.y - center.y) * nd / d;
      if (!b.shot.ended) b.shot.pulled[o.uid] = true;
      cmds.push({ type: "move", uid: o.uid, x: o.x, y: o.y });
    });
  }
  function moveBy(b, e, dx, dy, cmds) {
    e.x = Math.max(e.r, Math.min(K.FIELD_W - e.r, e.x + dx));
    e.y = Math.max(e.r, Math.min(K.FIELD_H - e.r, e.y + dy));
    if (!b.shot.ended) b.shot.pulled[e.uid] = true;
    cmds.push({ type: "move", uid: e.uid, x: e.x, y: e.y });
  }
  function nearestFrom(b, x, y, range, exclude) {
    var best = null, bd = range == null ? Infinity : range;
    alive(b).forEach(function (o) {
      if (exclude && exclude.indexOf(o) >= 0) return;
      var d = dist(o, x, y);
      if (d <= bd) { bd = d; best = o; }
    });
    return best;
  }
  function setMark(b, e, el, atk, ctx, burnMult) {
    e.mark = { el: el, turns: K.MARK_TURNS, atk: atk, burnMult: burnMult || 1 };
    ctx.cmds.push({ type: "mark", uid: e.uid, el: el });
    if (el === "nebula" && e.shielded) { e.shielded = false; ctx.cmds.push({ type: "shieldBreak", uid: e.uid }); }
    if (el === "comet" && !e.slowUsed) { e.slowUsed = true; e.cd += 1; }
  }
  function heal(b, amount, ctx) {
    var before = b.hp;
    b.hp = Math.min(b.hpMax, b.hp + Math.round(amount));
    if (b.hp > before) ctx.cmds.push({ type: "heal", amount: b.hp - before });
  }

  function enemiesOnRay(b, x, y, ux, uy, width, both) {
    return alive(b).filter(function (e) {
      var rx = e.x - x, ry = e.y - y;
      var along = rx * ux + ry * uy;
      if (!both && along < -e.r) return false;
      var perp = Math.abs(rx * uy - ry * ux);
      return perp <= e.r + width / 2;
    });
  }
  function rayEnd(x, y, ux, uy) {
    var t = Infinity;
    if (ux > 1e-6) t = Math.min(t, (K.FIELD_W - x) / ux);
    if (ux < -1e-6) t = Math.min(t, -x / ux);
    if (uy > 1e-6) t = Math.min(t, (K.FIELD_H - y) / uy);
    if (uy < -1e-6) t = Math.min(t, -y / uy);
    return { x: x + ux * t, y: y + uy * t };
  }

  // ---------------- 一發 ----------------
  function canSkill(b) { var p = shooter(b); return p.gauge >= p.gaugeMax; }

  // opts = {skill: bool, x, y, dir}（x, y = 射出點）。回傳 {cmds, launch}
  function beginShot(b, opts) {
    opts = opts || {};
    var p = shooter(b), t = trait(p), m = b.mods;
    var sk = null;
    var ctx = newCtx(p.element);
    if (opts.skill && canSkill(b)) {
      sk = p.def.skill;
      // 溢流儲存：留下超出的部分；二段技能：每場一次回到 50%；技能 5：下一位隊員 +50%
      p.gauge = m.overflow ? p.gauge - p.gaugeMax : 0;
      if (m.twoStage && !b.flags.twoStageUsed) { b.flags.twoStageUsed = true; p.gauge = Math.max(p.gauge, Math.round(p.gaugeMax * 0.5)); }
      if (m.skillRelay) { var nx = b.party[(b.active + 1) % b.party.length]; addGauge(b, nx, Math.round(nx.gaugeMax * 0.5)); }
      ctx.cmds.push({ type: "skill", id: p.id });
    }
    b.shot = newShot(sk);
    if (opts.x != null) b.shooterPos = { x: opts.x, y: opts.y };
    var launch = {
      speedMult: 1 + M(b, "speedMult"), radius: K.HERO_R, pierce: false, pierceFirst: false,
      restitution: Math.min(1, K.REST + M(b, "restitution")), airMult: 1, enemyPull: 0, wellBoost: 1, redirect: false
    };
    if (t.kind === "pierce") launch.pierce = true;
    if (t.kind === "pierceFirst") launch.pierceFirst = true;
    if (t.kind === "big") launch.radius = t.radius;
    if (t.kind === "noDecay") launch.restitution = 1;
    if (t.kind === "wellBoost") launch.wellBoost = t.mult;
    var wellR = 1 + M(b, "wellRadius");
    if (sk) {
      var k = sk.kind;
      if (k === "markAll") alive(b).forEach(function (e) { setMark(b, e, sk.el, p.atk, ctx); });
      else if (k === "slowAll") alive(b).forEach(function (e) { e.cd += sk.n; });
      else if (k === "nullify") b.nullTurns = sk.turns;
      else if (k === "echo") b.ghostNext = true;
      else if (k === "pierce") launch.pierce = true;
      else if (k === "grow") launch.radius = launch.radius * sk.mult;
      else if (k === "lightspeed") { launch.speedMult *= sk.speed; launch.airMult *= sk.air; }
      else if (k === "deflect") { launch.airMult *= sk.air; launch.enemyPull = sk.pull; }
      else if (k === "redirect") launch.redirect = true;
      else if (k === "wellAtLaunch" && opts.x != null) ctx.cmds.push({ type: "well", x: opts.x, y: opts.y, radius: sk.radius * wellR, hole: false, temp: true });
    }
    if (t.kind === "laser" && opts.dir) laser(b, opts.x, opts.y, opts.dir.x, opts.dir.y, t.width, p.atk * t.mult, p.element, ctx);
    // 後援無人機：每場第一發，在射出點發動 1 位隨機隊員的友情技
    if (m.backupDrone && !b.flags.backupDone && opts.x != null) {
      b.flags.backupDone = true;
      var others = b.party.map(function (q, i) { return i; }).filter(function (i) { return i !== b.active; });
      friendSkill(b, others[Math.floor(b.rng() * others.length)], opts.x, opts.y, ctx);
    }
    resolve(b, ctx);
    return { cmds: ctx.cmds, launch: launch };
  }

  function laser(b, x, y, ux, uy, width, amount, el, ctx, both, markEl) {
    var len = Math.sqrt(ux * ux + uy * uy) || 1;
    ux /= len; uy /= len;
    var end = rayEnd(x, y, ux, uy);
    var start = both ? rayEnd(x, y, -ux, -uy) : { x: x, y: y };
    ctx.cmds.push({ type: "laser", x1: start.x, y1: start.y, x2: end.x, y2: end.y, el: el });
    enemiesOnRay(b, x, y, ux, uy, width, both).forEach(function (e) {
      if (damage(b, e, amount * em(b, e, el), "laser", 0, ctx) && markEl && !e.dead) setMark(b, e, markEl, amount, ctx);
    });
  }

  // 角色撞到敵人。ev = {enemy: uid, speed, step, vx, vy}
  function onHit(b, ev) {
    var e = byUid(b, ev.enemy);
    var p = shooter(b), t = trait(p), sk = b.shot.skill, sk_k = sk ? sk.kind : null, m = b.mods;
    var el = p.element;
    var ctx = newCtx(el);
    if (!e || e.dead) return ctx.cmds;
    var last = b.shot.lastHit[e.uid];
    if (last != null && ev.step - last < K.HIT_GAP_STEPS) return ctx.cmds;
    b.shot.lastHit[e.uid] = ev.step;
    if (e.hidden) return ctx.cmds;

    b.shot.hits++;
    b.shot.hitIndex++;
    b.hitCount[e.uid] = (b.hitCount[e.uid] || 0) + 1;
    addGauge(b, p, 1 + (t.kind === "gaugeDrain" ? t.n : 0));
    if (t.kind === "pierceFirst" && !b.shot.pierceFirstUsed) {
      b.shot.pierceFirstUsed = true;
      ctx.cmds.push({ type: "pierceOff" });
    }

    // 1) 印記／反應
    var reaction = null, reactEl = el, trueBonus = 0;
    if (t.kind === "markToTrue" && e.mark) {
      e.mark = null;
      trueBonus = p.atk * t.mult;
      setMark(b, e, el, p.atk, ctx);
    } else {
      reaction = e.mark ? D.reactionFor(e.mark.el, el) : null;
      if (reaction) {
        // 反應 5：不消耗印記（每敵每發一次）；雙印記：反應後留下這一發的印記
        if (m.reactionKeep && !b.shot.kept[e.uid]) b.shot.kept[e.uid] = true;
        else e.mark = null;
        if (m.doubleMark) setMark(b, e, el, p.atk, ctx);
      } else {
        var mEl = t.kind === "randomMark" ? randomEl(b, null) : el;
        var burnMult = sk_k === "forceBurn" ? sk.burnMult : 1;
        if (sk_k === "forceBurn") mEl = "solar";
        setMark(b, e, mEl, p.atk, ctx, burnMult);
        if (t.kind === "markSpread") {
          var range = sk_k === "spreadBoost" ? sk.range : t.range;
          alive(b).forEach(function (o) { if (o !== e && dist(o, e.x, e.y) <= range + o.r) setMark(b, o, mEl, p.atk, ctx, burnMult); });
        }
        if (sk_k === "refract") {
          var rEl = randomEl(b, e.mark.el);
          reaction = D.reactionFor(e.mark.el, rEl);
          if (reaction) { e.mark = null; reactEl = rEl; }
        }
      }
      if (reaction) {
        ctx.cmds.push({ type: "reaction", uid: e.uid, id: reaction.id, x: e.x, y: e.y });
        if (reaction.id === "superconduct") { e.superconduct = true; if (m.superLong) e.superUntil = b.turnNo; }
      }
    }
    if (sk_k === "hitSlow" && !b.shot.slowed[e.uid]) { b.shot.slowed[e.uid] = true; e.cd += sk.n; }
    if (sk_k === "hitVuln") b.shot.vuln[e.uid] = true;

    // 2) 撞擊傷害
    var hm = hitMult(b.shot.hits) * (e.superconduct ? 2 : 1);
    var base = p.atk * hm * speedFactor(ev.speed);
    if (sk_k === "firstHits" && b.shot.hitIndex <= sk.n) base *= sk.mult;
    if (sk_k === "focus" && b.shot.hitIndex === 1) base *= sk.mult;
    if (sk_k === "conceal") base *= sk.mult;
    if (m.heavyDmg && p.def.mass >= 1.3) base *= 1 + m.heavyDmg;                    // 質量增幅器
    if (m.afterWallBoost && b.shot.afterWall) { base *= 1.5; b.shot.afterWall = false; }   // 反彈 5
    var amount = base * em(b, e, el);
    if (t.kind === "execute") amount += (e.hpMax - e.hp) * t.ratio;
    var dealt = damage(b, e, amount, "hit", 0, ctx);
    b.shot.hitDmg[e.uid] = (b.shot.hitDmg[e.uid] || 0) + dealt;
    if (trueBonus) damage(b, e, trueBonus, "true", 0, ctx);
    if (m.elastic) ctx.cmds.push({ type: "shooterVel", mult: 1.015, rotate: 0, cap: K.SPEED_MAX });   // 彈性膜

    // 3) 屬性與特性的附帶效果
    var hit = [e];
    if (!reaction && el === "plasma") {
      var arcs = sk_k === "multiArc" ? sk.n : 1, from = e;
      for (var i = 0; i < arcs; i++) {
        var tg = nearestFrom(b, from.x, from.y, K.ARC_RANGE, hit);
        if (!tg) break;
        ctx.cmds.push({ type: "arc", from: from.uid, to: tg.uid });
        damage(b, tg, base * K.ARC_RATIO * em(b, tg, el), "arc", 0, ctx);
        hit.push(tg); from = tg;
      }
    }
    if (t.kind === "hitArc") {
      var t2 = nearestFrom(b, e.x, e.y, t.range, hit);
      if (t2) { ctx.cmds.push({ type: "arc", from: e.uid, to: t2.uid }); damage(b, t2, p.atk * t.mult * em(b, t2, el), "arc", 0, ctx); }
    }
    if (!reaction && el === "gravity" && !e.dead) pullToward(b, e, K.GRAVITY_MARK_RANGE, 0.25, ctx.cmds);
    if (t.kind === "hitPull" && !e.dead) pullToward(b, e, t.range, t.ratio, ctx.cmds);
    if (t.kind === "push" && !e.dead && (ev.vx || ev.vy)) {
      var vl = Math.sqrt(ev.vx * ev.vx + ev.vy * ev.vy);
      moveBy(b, e, ev.vx / vl * t.dist, ev.vy / vl * t.dist, ctx.cmds);
    }
    if (t.kind === "spark") ctx.queue.push({ x: e.x, y: e.y, radius: t.radius, amount: p.atk * t.mult, depth: 0 });
    if (sk_k === "hitBlast") ctx.queue.push({ x: e.x, y: e.y, radius: sk.radius, amount: p.atk * sk.mult, depth: 0 });
    if (t.kind === "heal") heal(b, b.hpMax * t.ratio, ctx);
    if (sk_k === "sanctuary" && b.shot.hits % sk.per === 0) heal(b, b.hpMax * sk.ratio, ctx);
    if (t.kind === "split") ctx.cmds.push({ type: "debris", x: e.x, y: e.y, n: t.n, el: el });
    if (t.kind === "echoMark") b.echoes.push({ x: e.x, y: e.y, atk: p.atk, el: el, range: t.range, radius: t.radius, mult: t.mult, shot: b.stats.shots });

    onEnemyStruck(b, e, p, sk_k === "conceal", ctx);

    // 4) 反應效果
    if (reaction) applyReaction(b, reaction, e, p, reactEl, ctx);
    ctx.el = reactEl;
    resolve(b, ctx);
    return ctx.cmds;
  }

  function onEnemyStruck(b, e, p, concealed, ctx) {
    var tr = e.trait;
    e.hitThisShot = true;
    if (tr === "slow" && !b.shot.slowedBy[e.uid]) { b.shot.slowedBy[e.uid] = true; ctx.cmds.push({ type: "shooterVel", mult: 0.7, rotate: 0 }); }
    if (concealed) return;
    if (tr === "chill") ctx.cmds.push({ type: "shooterVel", mult: 0.8, rotate: 0 });
    else if (tr === "deflect") ctx.cmds.push({ type: "shooterVel", mult: 1, rotate: (b.rng() * 2 - 1) * Math.PI / 3 });
    else if (tr === "repel") ctx.cmds.push({ type: "shooterVel", mult: 1.5, rotate: 0, cap: K.SPEED_MAX * 1.5 });
    else if (tr === "shock") p.gauge = Math.max(0, p.gauge - 1);
    else if (tr === "echoSpawn") e.echoPending = true;
    else if (tr === "mine" && !e.dead) {
      teamDamage(b, Math.round(b.hpMax * 0.05), ctx, { direct: true });
      damage(b, e, e.hp, "true", 0, ctx);
    }
  }

  // 隊伍受傷（§10.1 守護類遺物）。o = {direct, attacker}
  //   嘲諷信標（攻擊 20% 落空）→ 偏轉護盾（每場第一次無效）→ 護盾／破甲／守護 5／隕鐵外殼 → 緩衝氣墊（上限 25%）
  //   → 反擊裝甲 → 救生艙 → 緊急超頻
  function teamDamage(b, amount, ctx, o) {
    o = o || {};
    var m = b.mods, dmg = amount;
    if (!o.direct) {
      if (o.attacker && m.taunt && b.rng() < 0.2) { ctx.cmds.push({ type: "miss", uid: o.attacker.uid }); return 0; }
      if (m.deflector && !b.flags.deflectorUsed) { b.flags.deflectorUsed = true; ctx.cmds.push({ type: "relic", id: "deflector" }); return 0; }
      if (b.shield > 0) {
        dmg = Math.round(dmg * (1 - b.shield));
        if (b.shieldCharges > 0) b.shieldCharges--; else b.shield = 0;
      }
      if (b.armorBreak) { dmg = Math.round(dmg * 1.2); b.armorBreak = false; }
      if (m.guardRound && !b.flags.guardRoundUsed) { b.flags.guardRoundUsed = true; dmg = Math.round(dmg * 0.6); }
      if (m.meteorArmor) {
        var rocks = b.rocks.filter(function (k) { return !k.broken; }).length;
        dmg = Math.round(dmg * (1 - Math.min(0.2, rocks * 0.05)));
      }
      if (m.cushion) dmg = Math.min(dmg, Math.round(b.hpMax * 0.25));
    }
    b.hp = Math.max(0, b.hp - dmg);
    ctx.cmds.push({ type: "teamDamage", amount: dmg });
    if (o.attacker && m.counter && !o.attacker.dead) {
      var avg = b.party.reduce(function (s, p) { return s + p.atk; }, 0) / b.party.length;
      damage(b, o.attacker, avg, "counter", 0, ctx);
    }
    if (b.hp <= 0 && m.lifePod && !b.flags.lifePodUsed) {
      b.flags.lifePodUsed = true;
      b.hp = Math.round(b.hpMax * 0.3);
      ctx.cmds.push({ type: "lifePod" });
    }
    if (m.emergency && !b.flags.emergencyUsed && b.hp > 0 && b.hp < b.hpMax * 0.3) {
      b.flags.emergencyUsed = true;
      b.party.forEach(function (p) { p.gauge = Math.max(p.gauge, p.gaugeMax); });
      ctx.cmds.push({ type: "gauge" });
      ctx.cmds.push({ type: "relic", id: "emergency_oc" });
    }
    return dmg;
  }

  // 反應效果（§3＋反應類遺物）
  function applyReaction(b, R, e, p, el, ctx) {
    var mult = 1 + M(b, "reactionDmg"), rad = 1 + M(b, "reactRadius");
    if (R.id === "steam") rad += M(b, "steamRadius");
    if (R.id === "resonance") mult *= 1 + M(b, "resonanceDmg");
    if (R.kind === "explode") {
      ctx.queue.unshift({ x: e.x, y: e.y, radius: R.radius * rad, amount: p.atk * R.mult * mult, depth: 0 });
    } else if (R.kind === "true") {
      damage(b, e, p.atk * R.mult * mult * (1 + M(b, "annihilateDmg")), "true", 0, ctx);
    } else if (R.kind === "zone") {
      b.zones.push({ x: e.x, y: e.y, radius: R.radius, amount: p.atk * R.mult * mult, turns: R.turns + M(b, "ionTurns"), el: el });
    } else if (R.kind === "spread") {
      var sr = R.radius * (1 + M(b, "wildfireRadius")), bm = 1 + M(b, "wildfireBurn");
      alive(b).forEach(function (o) { if (dist(o, e.x, e.y) <= sr + o.r) setMark(b, o, "solar", p.atk, ctx, bm); });
    } else if (R.kind === "collapse") {
      pullToward(b, e, R.pullRadius * (1 + M(b, "collapsePull")), 0.6, ctx.cmds);
      ctx.queue.unshift({ x: e.x, y: e.y, radius: R.radius * rad, amount: p.atk * R.mult * mult * (1 + M(b, "collapseDmg")), depth: 0 });
    }
  }

  // 射出者（或殘影）撞到停在場上的隊友 → 隊友的友情技。ev = {ally: index, x, y, ghost}
  function onAlly(b, ev) {
    var a = b.party[ev.ally], m = b.mods;
    var ctx = newCtx(a ? a.element : null);
    if (!a || ev.ally === b.active) return ctx.cmds;
    if (ev.ghost) {
      if (!m.ghostAlly || b.shot.ghostAllies.used) return ctx.cmds;   // 幽靈隊員／殘影 5：殘影每發一次
      b.shot.ghostAllies.used = true;
    } else {
      var used = b.shot.allies[ev.ally] || 0;
      if (used >= (m.friendTwice ? 2 : 1)) return ctx.cmds;          // 友情 5：每位隊友每發 2 次
      b.shot.allies[ev.ally] = used + 1;
    }
    friendSkill(b, ev.ally, ev.x, ev.y, ctx);
    var p = shooter(b);
    if (m.friendGauge) addGauge(b, p, 2);                                                    // 羈絆電路
    if (m.relay) ctx.cmds.push({ type: "shooterVel", mult: 1.2, rotate: 0, cap: K.SPEED_MAX });  // 接力推進
    if (m.tacticalSync && b.shot.skill) addGauge(b, a, 3);                                   // 戰術同步
    b.shot.friends++;
    if (m.union && b.shot.friends >= 3 && !b.shot.unionDone) {                               // 合體訊號
      b.shot.unionDone = true;
      ctx.cmds.push({ type: "relic", id: "union_signal" });
      alive(b).forEach(function (e) { damage(b, e, p.atk * 2 * em(b, e, p.element), "friend", 0, ctx); });
    }
    resolve(b, ctx);
    return ctx.cmds;
  }

  // 友情技本體（§4.2）。編隊通訊器／友情 3 加傷害；同屬性共鳴附加隊友屬性印記
  function friendSkill(b, allyIndex, x, y, ctx) {
    var a = b.party[allyIndex], m = b.mods;
    var F = a.def.friend, el = a.element, atk = a.atk * (1 + M(b, "friendDmg"));
    var markEl = m.friendMark ? el : null;
    ctx.cmds.push({ type: "friend", ally: allyIndex, id: a.id });
    function hurt(e, mult, kind, el2) {
      var n = damage(b, e, atk * mult * em(b, e, el2 || el), kind || "friend", 0, ctx);
      if (n && markEl && !e.dead) setMark(b, e, markEl, a.atk, ctx);
    }
    var k = F.kind;
    if (k === "cross") {
      laser(b, x, y, 1, 0, F.width, atk * F.mult, el, ctx, true, markEl);
      laser(b, x, y, 0, 1, F.width, atk * F.mult, el, ctx, true, markEl);
    } else if (k === "beam") {
      var ux = 1, uy = 0, both = true;
      if (F.aim === "nearest") {
        var n = nearestFrom(b, x, y);
        if (n) { ux = n.x - x; uy = n.y - y; both = false; }
      }
      laser(b, x, y, ux, uy, F.width, atk * F.mult, el, ctx, both, markEl);
    } else if (k === "bolts") {
      var targets = alive(b).sort(function (p1, p2) { return dist(p1, x, y) - dist(p2, x, y); });
      for (var i = 0; i < F.n && targets.length; i++) {
        var tg = targets[i % targets.length];
        if (tg.dead) continue;
        var bel = F.randomEl ? randomEl(b, null) : el;
        ctx.cmds.push({ type: "bolt", fromX: x, fromY: y, uid: tg.uid, el: bel });
        hurt(tg, F.mult, "friend", bel);
      }
    } else if (k === "blast") {
      alive(b).forEach(function (e) {
        if (dist(e, x, y) > F.radius + e.r) return;
        if (F.clearMarks) e.mark = null;
        else if (F.mark || markEl) setMark(b, e, F.mark || markEl, a.atk, ctx);
      });
      ctx.queue.push({ x: x, y: y, radius: F.radius, amount: atk * F.mult, depth: 0, el: el });
    } else if (k === "strike") {
      var s = nearestFrom(b, x, y);
      if (s) { ctx.cmds.push({ type: "bolt", fromX: x, fromY: y, uid: s.uid, el: el }); hurt(s, F.mult); }
    } else if (k === "chain") {
      var from = { x: x, y: y }, done = [];
      for (var j = 0; j < F.n; j++) {
        var c = nearestFrom(b, from.x, from.y, j === 0 ? null : F.range, done);
        if (!c) break;
        ctx.cmds.push({ type: "bolt", fromX: from.x, fromY: from.y, uid: c.uid, el: el });
        hurt(c, F.mult);
        done.push(c); from = c;
      }
    } else if (k === "net") {
      alive(b).forEach(function (e) { if (dist(e, x, y) <= F.range + e.r) hurt(e, F.mult); });
    } else if (k === "zoneAt") {
      b.zones.push({ x: x, y: y, radius: F.radius, amount: atk * F.mult, turns: F.turns, el: el });
    } else if (k === "markAll") {
      alive(b).forEach(function (e) { setMark(b, e, F.el, a.atk, ctx); });
    } else if (k === "meteor") {
      for (var mi = 0; mi < F.n; mi++) {
        var live = alive(b);
        if (!live.length) break;
        var mt = live[Math.floor(b.rng() * live.length)];
        ctx.cmds.push({ type: "bolt", fromX: mt.x, fromY: 0, uid: mt.uid, el: el });
        hurt(mt, F.mult);
      }
    } else if (k === "push") {
      alive(b).forEach(function (e) {
        var d = dist(e, x, y);
        if (d > F.range || d < 1e-6) return;
        moveBy(b, e, (e.x - x) / d * F.dist, (e.y - y) / d * F.dist, ctx.cmds);
        hurt(e, F.mult);
      });
    } else if (k === "wellAt") {
      ctx.cmds.push({ type: "well", x: x, y: y, radius: F.radius * (1 + M(b, "wellRadius")), hole: false, temp: true });
    } else if (k === "iceWall") {
      ctx.cmds.push({ type: "wall", x1: x - F.len / 2, y1: y - F.offset, x2: x + F.len / 2, y2: y - F.offset });
    } else if (k === "shield") {
      b.shield = Math.max(b.shield, F.ratio);
      ctx.cmds.push({ type: "shield", ratio: b.shield });
    } else if (k === "heal") {
      heal(b, b.hpMax * F.ratio, ctx);
    } else if (k === "voidGate") {
      alive(b).forEach(function (e) {
        if (dist(e, x, y) <= F.range + e.r && e.hp <= e.hpMax * F.ratio) damage(b, e, e.hp, "true", 0, ctx);
      });
    }
  }

  // 撞牆。ev = {x, y}
  function onWall(b, ev) {
    var p = shooter(b), t = trait(p), sk = b.shot.skill, m = b.mods;
    var ctx = newCtx(p.element);
    b.shot.walls++;
    if (t.kind === "wallFreeze") {
      alive(b).forEach(function (e) { if (dist(e, ev.x, ev.y) <= t.range + e.r) setMark(b, e, "comet", p.atk, ctx); });
    } else if (t.kind === "wallArc") {
      var n = nearestFrom(b, ev.x, ev.y, t.range);
      if (n) { ctx.cmds.push({ type: "bolt", fromX: ev.x, fromY: ev.y, uid: n.uid, el: p.element }); damage(b, n, p.atk * t.mult * em(b, n, p.element), "arc", 0, ctx); }
    } else if (t.kind === "wallPull") {
      pullToward(b, { x: ev.x, y: ev.y, r: 0 }, t.range, t.ratio, ctx.cmds);
    }
    if (sk && sk.kind === "wallStorm") alive(b).forEach(function (e) { damage(b, e, p.atk * sk.mult * em(b, e, p.element), "arc", 0, ctx); });
    // 反彈類遺物
    if (m.wallHitBonus) b.shot.hits += m.wallHitBonus;
    if (m.afterWallBoost) b.shot.afterWall = true;
    if (m.cornerHunter) {
      var cx = Math.min(ev.x, K.FIELD_W - ev.x), cy = Math.min(ev.y, K.FIELD_H - ev.y);
      if (cx <= 80 && cy <= 80) b.shot.hits += 2;
    }
    if (m.wallAoe) alive(b).forEach(function (e) { if (dist(e, ev.x, ev.y) <= 60 + e.r) damage(b, e, p.atk * 0.3 * em(b, e, p.element), "arc", 0, ctx); });
    if (m.wallResonance && b.shot.walls % 5 === 0) alive(b).forEach(function (e) { damage(b, e, p.atk * 0.5 * em(b, e, p.element), "arc", 0, ctx); });
    if (m.wallHeal) heal(b, b.hpMax * 0.003, ctx);
    resolve(b, ctx);
    return ctx.cmds;
  }

  // 射出者每子步的位置：星點、殘響、酸液、冰霜軌跡。ev = {x, y, r, allies:[{i,x,y}]}
  function onPos(b, ev) {
    var p = shooter(b), t = trait(p), m = b.mods;
    var ctx = newCtx(p.element);
    b.shooterPos = { x: ev.x, y: ev.y };
    var sr = K.STAR_R * (1 + M(b, "starRadius"));
    function tryLight(key, x, y) {
      if (b.shot.lit.some(function (l) { return l.key === key; })) return;
      if (Math.sqrt((x - ev.x) * (x - ev.x) + (y - ev.y) * (y - ev.y)) > sr) return;
      b.shot.lit.push({ key: key, x: x, y: y });
      ctx.cmds.push({ type: "star", key: key, x: x, y: y });
      if (m.starGauge) addGauge(b, p, 1);                     // 星光收集瓶
    }
    b.stars.forEach(function (s, i) { tryLight("s" + i, s.x, s.y); });
    if (m.wellStar) b.wells.forEach(function (g, i) { tryLight("w" + i, g.x, g.y); });           // 視界觀測儀
    if (m.allyStar && ev.allies) ev.allies.forEach(function (a) { tryLight("a" + a.i, a.x, a.y); });   // 共振天線
    if (b.echoes.length) {
      b.echoes = b.echoes.filter(function (c) {
        if (c.shot >= b.stats.shots || dist(c, ev.x, ev.y) > c.range) return true;
        ctx.el = c.el;
        ctx.queue.push({ x: c.x, y: c.y, radius: c.radius, amount: c.atk * c.mult, depth: 0, el: c.el });
        return false;
      });
    }
    b.acids.forEach(function (a, i) {
      if (b.shot.acidHit[i] || dist(a, ev.x, ev.y) > a.radius) return;
      b.shot.acidHit[i] = true;
      ctx.cmds.push({ type: "shooterVel", mult: 0.7, rotate: 0 });
    });
    if (t.kind === "frostTrail") {
      alive(b).forEach(function (e) {
        if (b.shot.frosted[e.uid]) return;
        if (dist(e, ev.x, ev.y) <= e.r + (ev.r || K.HERO_R) + t.range) { b.shot.frosted[e.uid] = true; e.cd += 1; ctx.cmds.push({ type: "mark", uid: e.uid, el: "comet" }); }
      });
    }
    // 彎曲推進器：每發第一次進入某座引力井時速度 ×1.1
    if (m.wellSpeed) b.wells.forEach(function (g, i) {
      if (b.shot.wellsEntered[i] || dist(g, ev.x, ev.y) > (g.radius || K.WELL_R)) return;
      b.shot.wellsEntered[i] = true;
      ctx.cmds.push({ type: "shooterVel", mult: 1.1, rotate: 0, cap: K.SPEED_MAX * 1.2 });
    });
    resolve(b, ctx);
    return ctx.cmds;
  }

  // 小行星被射出者撞到。ev = {rock: id}
  function onRock(b, ev) {
    var ctx = newCtx(shooter(b).element);
    var r = null;
    b.rocks.forEach(function (x) { if (x.id === ev.rock) r = x; });
    if (!r || r.broken) return ctx.cmds;
    var key = "rock:" + r.id, last = b.shot.lastHit[key];
    if (last != null && ev.step - last < K.HIT_GAP_STEPS) return ctx.cmds;
    b.shot.lastHit[key] = ev.step;
    r.dur--;
    if (r.dur <= 0) breakRock(b, r, ctx);
    return ctx.cmds;
  }

  // 碎片撞到敵人：射出者攻 × 0.4（碎片屬性），計 Hit。ev = {enemy, speed, step, debris, el}
  function onDebris(b, ev) {
    var p = shooter(b), el = ev.el || p.element, m = b.mods;
    var ctx = newCtx(el);
    var e = byUid(b, ev.enemy);
    if (!e || e.dead || ev.speed < K.DEBRIS_MIN_SPEED + M(b, "debrisMinSpeed")) return ctx.cmds;
    var key = "d:" + ev.debris + ":" + e.uid, last = b.shot.lastHit[key];
    if (last != null && ev.step - last < K.HIT_GAP_STEPS) return ctx.cmds;
    b.shot.lastHit[key] = ev.step;
    b.shot.hits += 1 + M(b, "debrisHit");
    addGauge(b, p, 1);
    damage(b, e, p.atk * K.DEBRIS_MULT * (1 + M(b, "debrisDmg")) * em(b, e, el), "debris", 0, ctx);
    if (m.debrisMark && !e.dead) setMark(b, e, el, p.atk, ctx);
    resolve(b, ctx);
    return ctx.cmds;
  }

  // 殘影撞到敵人：射出者攻 × 0.5（殘影 3 ＋30%）× 屬性；預設不計 Hit、不留印記。ev = {enemy, step}
  function onGhost(b, ev) {
    var p = shooter(b), ctx = newCtx(p.element), m = b.mods;
    var e = byUid(b, ev.enemy);
    if (!e || e.dead) return ctx.cmds;
    var key = "g:" + e.uid, last = b.shot.lastHit[key];
    if (last != null && ev.step - last < K.HIT_GAP_STEPS) return ctx.cmds;
    b.shot.lastHit[key] = ev.step;
    if (m.ghostHit) b.shot.hits++;
    damage(b, e, p.atk * K.GHOST_MULT * (1 + M(b, "ghostDmg")) * em(b, e, p.element), "ghost", 0, ctx);
    if (e.dead && m.ghostKillGauge) addGauge(b, p, 2);
    if (!e.dead && m.ghostMark) setMark(b, e, p.element, p.atk, ctx);
    resolve(b, ctx);
    return ctx.cmds;
  }

  // 一發結束。stop = {x, y}（停止點）。回傳 {next, cmds}
  function endShot(b, stop) {
    var p = shooter(b), sk = b.shot.skill, m = b.mods;
    var ctx = newCtx(p.element);
    if (sk && sk.kind === "stopBlast" && stop) ctx.queue.push({ x: stop.x, y: stop.y, radius: sk.radius, amount: p.atk * sk.mult, depth: 0 });
    if (sk && sk.kind === "capacitor") {
      Object.keys(b.shot.hitDmg).forEach(function (uid) {
        var e = byUid(b, uid);
        if (e && !e.dead && b.shot.hitDmg[uid] > 0) damage(b, e, b.shot.hitDmg[uid] * sk.ratio, "arc", 0, ctx);
      });
    }
    if (m.anchor && stop) pullToward(b, { x: stop.x, y: stop.y, r: 0 }, 120, 0.25, ctx.cmds);   // 重力錨
    if (m.wallRecorder && b.shot.walls >= 10) {                                                     // 迴旋紀錄器
      ctx.cmds.push({ type: "relic", id: "spin_recorder" });
      alive(b).forEach(function (e) { damage(b, e, p.atk * em(b, e, p.element), "friend", 0, ctx); });
    }
    resolve(b, ctx);
    constellation(b, p, ctx);
    resolve(b, ctx);
    b.stats.shots++;
    if (b.shot.chain > b.stats.maxChain) b.stats.maxChain = b.shot.chain;
    b.shot.ended = true;
    alive(b).forEach(function (e) {
      if (e.trait === "shiftWeak" && e.hitThisShot) e.weak = [D.ELEMENTS[Math.floor(b.rng() * D.ELEMENTS.length)]];
      if (e.trait === "mirror") e.resist = [p.element];
    });
    b.enemies.forEach(function (e) {
      if (e.superUntil == null) e.superconduct = false;   // 超導線圈：持續到下一個敵人回合結束
      e.hitThisShot = false;
    });
    if (isWin(b)) return { next: "win", cmds: ctx.cmds };
    b.active = (b.active + 1) % b.party.length;
    return { next: b.active === 0 ? "enemy" : "hero", cmds: ctx.cmds };
  }

  function isWin(b) {
    if (b.bossUid) { var body = byUid(b, b.bossUid); if (body && body.dead) return true; }
    return !alive(b).length;
  }

  // 星座（§8＋星座類遺物）：點亮 3 → 三角座、4 → 方舟座、5 以上 → 五芒座
  function constellation(b, p, ctx) {
    var m = b.mods;
    var n = b.shot.lit.length + (m.firstShotStar && b.stats.shots === 0 ? 1 : 0);   // 北極星
    if (n < 3) return;
    var id = n >= 5 ? "penta" : n === 4 ? "ark" : "tri";
    ctx.cmds.push({ type: "constellation", id: id, n: n });
    var times = m.constellationDouble ? 2 : 1;                                      // 星座 5
    for (var t = 0; t < times; t++) {
      if (id === "tri") {
        for (var i = 0; i < K.METEOR_N + M(b, "meteorExtra"); i++) {
          var live = alive(b);
          if (!live.length) break;
          var e = live[Math.floor(b.rng() * live.length)];
          ctx.cmds.push({ type: "bolt", fromX: e.x, fromY: 0, uid: e.uid, el: p.element });
          damage(b, e, p.atk * K.METEOR_MULT * em(b, e, p.element), "friend", 0, ctx);
        }
      } else if (id === "ark") {
        b.shield = Math.max(b.shield, K.ARK_SHIELD);
        b.shieldCharges = Math.max(b.shieldCharges, M(b, "arkCharges"));           // 天球儀
        ctx.cmds.push({ type: "shield", ratio: b.shield });
      } else {
        b.party.forEach(function (q) { q.gauge = Math.max(q.gauge, q.gaugeMax); });
        ctx.cmds.push({ type: "gauge" });
      }
    }
    if (m.wishHeal) heal(b, b.hpMax * 0.05, ctx);                                  // 流星許願
    if (m.starBlast) b.shot.lit.forEach(function (l) {                             // 星座爆破
      ctx.queue.push({ x: l.x, y: l.y, radius: 80, amount: p.atk * 0.8, depth: 0 });
    });
  }

  // ---------------- 敵人回合 ----------------
  function enemyTurn(b) {
    var attacks = [], m = b.mods;
    var ctx = newCtx("solar");
    b.flags.guardRoundUsed = false;
    alive(b).forEach(function (e) {
      if (e.mark && e.mark.el === "solar") damage(b, e, e.mark.atk * K.BURN_RATIO * (e.mark.burnMult || 1), "burn", 0, ctx);
    });
    resolve(b, ctx);
    b.zones.forEach(function (z) {
      ctx.el = z.el;
      alive(b).forEach(function (e) {
        if (dist(e, z.x, z.y) <= z.radius + e.r) damage(b, e, z.amount * em(b, e, z.el), "zone", 0, ctx);
      });
      resolve(b, ctx);
      z.turns--;
    });
    b.zones = b.zones.filter(function (z) { return z.turns > 0; });
    if (isWin(b)) return { cmds: ctx.cmds, attacks: attacks, lose: false, win: true };

    // 倒數與攻擊（cdMax 0 = 不攻擊的部位）
    alive(b).forEach(function (e) {
      if (!e.cdMax || b.hp <= 0) return;
      e.cd -= 1;
      if (e.cd > 0) return;
      var dmg = teamDamage(b, e.def.atk, ctx, { attacker: e });
      attacks.push({ uid: e.uid, dmg: dmg });
      e.cd = e.cdMax;
      if (e.trait === "armorBreak") b.armorBreak = true;
      if (e.trait === "selfDestruct") vanish(b, e, ctx);
    });

    // 回合效果（§6.1）
    var list = alive(b);
    list.forEach(function (e) {
      if (e.dead) return;
      e.turns++;
      var tr = e.trait;
      if (tr === "lightning") { var d = teamDamage(b, Math.round(b.hpMax * 0.03), ctx); attacks.push({ uid: e.uid, dmg: d, kind: "lightning" }); }
      else if (tr === "entropy") b.party.forEach(function (p) { p.gauge = Math.max(0, p.gauge - 1); });
      else if (tr === "repair") alive(b).forEach(function (o) {
        if (o === e || dist(o, e.x, e.y) > 150 + o.r) return;
        var h0 = o.hp; o.hp = Math.min(o.hpMax, o.hp + Math.round(o.hpMax * 0.05));
        if (o.hp > h0) ctx.cmds.push({ type: "enemyHeal", uid: o.uid, amount: o.hp - h0, x: o.x, y: o.y });
      });
      else if (tr === "spawn" && e.turns % 2 === 0) spawnEnemy(b, D.ENEMY_BY_ID.spore_drifter, e.x, e.y, ctx);
      else if (tr === "nest") spawnEnemy(b, D.ENEMY_BY_ID.spore_drifter, e.x, e.y, ctx);
      else if (tr === "summon" && e.turns % 3 === 0) spawnEnemy(b, D.ENEMY_BY_ID.sentry_drone, e.x, e.y, ctx);
      else if (tr === "rift" && e.turns % 2 === 0) {
        var pool = D.ENEMIES.filter(function (x) { return x.sector === 1; });
        spawnEnemy(b, pool[Math.floor(b.rng() * pool.length)], e.x, e.y, ctx);
      }
      else if (tr === "devour") {
        var prey = null, bd = Infinity;
        alive(b).forEach(function (o) {
          if (o === e || o.def.size !== "s" || o.role) return;
          var dd = dist(o, e.x, e.y) - e.r - o.r;
          if (dd <= 100 && dd < bd) { bd = dd; prey = o; }
        });
        if (prey) {
          vanish(b, prey, ctx);
          var h1 = e.hp; e.hp = Math.min(e.hpMax, e.hp + Math.round(e.hpMax * 0.2));
          ctx.cmds.push({ type: "enemyHeal", uid: e.uid, amount: e.hp - h1, x: e.x, y: e.y });
        }
      }
      else if (tr === "eclipse") alive(b).forEach(function (o) {
        var cand = D.ELEMENTS.filter(function (x) { return o.resist.indexOf(x) < 0; });
        if (cand.length) o.resist.push(cand[Math.floor(b.rng() * cand.length)]);
      });
      else if (tr === "part_drill") addRockAt(b, ctx);
      if (e.elite === "regen") {
        var h2 = e.hp; e.hp = Math.min(e.hpMax, e.hp + Math.round(e.hpMax * 0.05));
        if (e.hp > h2) ctx.cmds.push({ type: "enemyHeal", uid: e.uid, amount: e.hp - h2, x: e.x, y: e.y });
      }
      if (e.echoPending) {
        e.echoPending = false;
        spawnEnemy(b, D.SPAWN_DEFS.echo_shade, e.x, e.y, ctx, { hp: 1 });
      }
    });

    // 移動（§6.1）
    var pairsDone = {};
    alive(b).forEach(function (e) {
      var tr = e.trait, s;
      if (tr === "hop") { s = findSpot(b, 0, 0, e.r, null, e); if (s) moveTo(b, e, s.x, s.y, ctx); }
      else if (tr === "glide" || tr === "charge") {
        var len = tr === "glide" ? 80 : 120;
        for (var i = 0; i < 6; i++) {
          var a = b.rng() * Math.PI * 2, nx = e.x + Math.cos(a) * len, ny = e.y + Math.sin(a) * len;
          if (spotFree(b, nx, ny, e.r, e)) { moveTo(b, e, nx, ny, ctx); break; }
        }
      }
      else if (tr === "escort") {
        var big = null, bd = Infinity;
        alive(b).forEach(function (o) { if (o !== e && (o.def.size === "l" || o.role === "body")) { var dd = dist(o, e.x, e.y); if (dd < bd) { bd = dd; big = o; } } });
        if (big) rotateAround(b, e, big.x, big.y, Math.PI / 3, ctx);
      }
      else if (tr === "binary" && e.partner && !pairsDone[e.uid]) {
        var pt = byUid(b, e.partner);
        if (pt && !pt.dead) {
          pairsDone[pt.uid] = true;
          var cx = (e.x + pt.x) / 2, cy = (e.y + pt.y) / 2;
          rotateAround(b, e, cx, cy, Math.PI / 3, ctx, pt);
          rotateAround(b, pt, cx, cy, Math.PI / 3, ctx, e);
        }
      }
      if (tr === "phase") { e.hidden = !e.hidden; ctx.cmds.push({ type: "enemySensor", uid: e.uid, on: e.hidden }); }
      if (tr === "randomCd") e.cd = 1 + Math.floor(b.rng() * e.cdMax);
    });
    // 聚合場：全部敵人往中心靠攏 30
    if (m.converge) alive(b).forEach(function (e) {
      var dx = 270 - e.x, dy = 400 - e.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1) return;
      var step = Math.min(30, d), nx = e.x + dx / d * step, ny = e.y + dy / d * step;
      if (spotFree(b, nx, ny, e.r, e)) moveTo(b, e, nx, ny, ctx);
    });

    b.acids.forEach(function (a) { a.turns--; });
    b.acids = b.acids.filter(function (a) { return a.turns > 0; });
    b.enemies.forEach(function (e) {
      if (e.mark && --e.mark.turns <= 0) e.mark = null;
      if (e.superUntil != null && e.superUntil <= b.turnNo) { e.superUntil = null; e.superconduct = false; }
    });
    if (b.nullTurns > 0) b.nullTurns--;
    if (m.regen && b.hp > 0) heal(b, b.hpMax * 0.01, ctx);                        // 再生裝甲
    b.turnNo++;
    // 下一回合開始：小行星牽引、黑洞種子（第 3 回合）
    if (m.rockPull) addRockAt(b, ctx);
    if (m.holeSeed && b.turnNo === 3 && !b.flags.holeDone) {
      b.flags.holeDone = true;
      var best = null, bc = -1;
      alive(b).forEach(function (e) { var c = b.hitCount[e.uid] || 0; if (c > bc) { bc = c; best = e; } });
      if (best) {
        var g = { x: best.x, y: best.y, radius: K.WELL_R, hole: true };
        b.wells.push(g);
        ctx.cmds.push({ type: "well", x: g.x, y: g.y, radius: g.radius, hole: true });
      }
    }
    return { cmds: ctx.cmds, attacks: attacks, lose: b.hp <= 0, win: isWin(b) };
  }

  function spotFree(b, x, y, r, self) {
    if (x < r + 4 || x > K.FIELD_W - r - 4 || y < r + 60 || y > 720) return false;
    var ok = alive(b).every(function (o) { return o === self || dist(o, x, y) > o.r + r + 8; });
    ok = ok && b.rocks.every(function (k) { return k.broken || dist(k, x, y) > k.r + r + 8; });
    return ok && (b.avoid || []).every(function (a) { return dist(a, x, y) > a.r + r + 8; });
  }
  function rotateAround(b, e, cx, cy, ang, ctx, ignore) {
    var dx = e.x - cx, dy = e.y - cy, c = Math.cos(ang), s = Math.sin(ang);
    var nx = cx + dx * c - dy * s, ny = cy + dx * s + dy * c;
    var ok = nx >= e.r + 4 && nx <= K.FIELD_W - e.r - 4 && ny >= e.r + 60 && ny <= 720 &&
      alive(b).every(function (o) { return o === e || o === ignore || dist(o, nx, ny) > o.r + e.r + 8; }) &&
      (b.avoid || []).every(function (a) { return dist(a, nx, ny) > a.r + e.r + 8; });
    if (ok) moveTo(b, e, nx, ny, ctx);
  }

  var api = {
    create: create, canSkill: canSkill, beginShot: beginShot, onHit: onHit, onAlly: onAlly, onWall: onWall, onPos: onPos,
    onRock: onRock, onDebris: onDebris, onGhost: onGhost, endShot: endShot, enemyTurn: enemyTurn, isWin: isWin,
    hitMult: hitMult, elemMult: elemMult, speedFactor: speedFactor, byUid: byUid, alive: alive, spawnEnemy: spawnEnemy,
    teamDamage: teamDamage, gaugeCap: gaugeCap,
    ENEMY_TRAITS: ["", "swarm", "quick", "armored", "hop", "magnet", "chill", "selfDestruct", "repair", "shieldAllies", "linked",
      "deflect", "slow", "spawn", "summon", "aura", "reflect", "split", "shock", "phase", "parasite", "acidPool", "glide", "protect",
      "lightning", "mine", "absorbLight", "nest", "shiftWeak", "escort", "armorBreak", "serpent", "drainOnDeath", "selfShield",
      "charge", "randomCd", "ownWell", "repel", "rift", "mirror", "explosionOnly", "entropy", "binary", "doom", "oblivion",
      "hiddenHp", "echoSpawn", "devour", "eclipse"],
    TRAIT_KINDS: TRAIT_KINDS, FRIEND_KINDS: FRIEND_KINDS, SKILL_KINDS: SKILL_KINDS
  };
  root.PriTestShedanCombat = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
