// 射彈宇宙（shedan）：戰鬥規則。只吃「事件」、回傳「指令」，不碰 matter.js 與 DOM，可以在 Node 直接測試。
// 規則依據 docs/shedan_game_design.md §2～§4（含 §4.1 射擊特性、§4.2 友情技、§4.3 技能）、§8（星座、小行星、殘影）。
// 角色效果全部依資料的 kind 分派（shedan_data_heroes.js），不為單一角色寫特例。瀏覽器掛在 window.PriTestShedanCombat。
//
// 事件 → 函式：hit→onHit、ally→onAlly、wall→onWall、rock→onRock、debris→onDebris、殘影→onGhost、每子步位置→onPos
// 指令（cmds）給畫面與物理：
//   damage{uid,amount,x,y,kind}  explode{x,y,radius,depth}  kill{uid}  reaction{uid,id,x,y}  mark{uid,el}
//   move{uid,x,y}  arc{from,to}  gauge  heal{amount}  shield{ratio}  laser{x1,y1,x2,y2,el}  bolt{fromX,fromY,uid,el}
//   well{x,y,radius,hole}  wall{x1,y1,x2,y2}  debris{x,y,n,el}  rockBreak{id,x,y}  star{index}
//   constellation{id,n}  skill{id}  friend{ally,id}  pierceOff
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

  // ---------------- 倍率 ----------------
  function hitMult(hits) { return 1 + Math.floor(hits / K.HIT_STEP) * K.HIT_STEP_BONUS; }
  function elemMult(def, el, corroded) {
    if (def.weak.indexOf(el) >= 0) return K.WEAK_MULT;
    if (!corroded && def.resist.indexOf(el) >= 0) return K.RESIST_MULT;
    return 1;
  }
  function speedFactor(speed) { return Math.max(K.SPEED_FACTOR_MIN, Math.min(1, speed / K.SPEED_MAX)); }

  // ---------------- 建立戰鬥 ----------------
  var uidSeq = 0;
  function create(opts) {
    var party = opts.heroes.map(function (h) {
      return { id: h.id, def: h, element: h.element, atk: h.atk, gauge: 0, gaugeMax: h.gauge };
    });
    var hpMax = opts.heroes.reduce(function (s, h) { return s + h.hp; }, 0);
    var enemies = opts.enemies.map(function (e) {
      return {
        uid: "e" + (++uidSeq), def: e.def, hp: e.def.hp, hpMax: e.def.hp, r: D.SIZE_R[e.def.size],
        x: e.x, y: e.y, cd: e.def.cd, cdMax: e.def.cd, mark: null, slowUsed: false, superconduct: false, dead: false
      };
    });
    var field = opts.field || {};
    return {
      party: party, hp: hpMax, hpMax: hpMax, enemies: enemies, zones: [],
      stars: (field.stars || []).map(function (s) { return { x: s.x, y: s.y }; }),
      rocks: (field.rocks || []).map(function (r, i) { return { id: "r" + i, x: r.x, y: r.y, r: K.ROCK_R, dur: K.ROCK_DUR, broken: false }; }),
      wells: (field.wells || []).slice(),
      echoes: [], shield: 0, nullTurns: 0, ghostNext: false,
      rng: opts.rng || Math.random,
      active: 0, turnNo: 1,
      shot: newShot(null),
      stats: { damage: 0, maxChain: 0, shots: 0 }
    };
  }
  function newShot(skill) {
    return {
      hits: 0, chain: 0, lastHit: {}, skill: skill, allies: {}, lit: [], hitDmg: {}, frosted: {}, slowed: {}, vuln: {},
      pierceFirstUsed: false, hitIndex: 0, ended: false
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

  // ---------------- 傷害與連爆 ----------------
  // ctx = {cmds, queue, el}：el 是連爆時用的屬性
  function damage(b, e, amount, kind, depth, ctx) {
    if (e.dead) return 0;
    var a = amount;
    if (!b.shot.ended) {
      if (b.shot.vuln[e.uid]) a *= 1 + b.shot.skill.mult;
      if (skillKind(b) === "execute" && e.hp <= e.hpMax * b.shot.skill.threshold) a *= b.shot.skill.mult;
    }
    var n = Math.max(0, Math.round(a));
    if (!n) return 0;
    e.hp -= n;
    b.stats.damage += n;
    ctx.cmds.push({ type: "damage", uid: e.uid, amount: n, x: e.x, y: e.y, kind: kind });
    if (e.hp > 0) return n;
    e.hp = 0;
    e.dead = true;
    ctx.cmds.push({ type: "kill", uid: e.uid });
    onKill(b, e, depth, ctx);
    return n;
  }

  function onKill(b, e, depth, ctx) {
    var sk = b.shot.ended ? null : b.shot.skill;
    if (sk && sk.kind === "abyssKill") gaugeAll(b, sk.gauge, ctx);
    if (sk && sk.kind === "killCollapse") {
      pullToward(b, e, sk.pull, 0.6, ctx.cmds);
      ctx.queue.push({ x: e.x, y: e.y, radius: sk.radius, amount: shooter(b).atk * sk.mult, depth: depth + 1 });
    }
    if (e.mark && e.mark.el === "void") {
      var g = Math.floor(e.hpMax * K.VOID_GAUGE_RATIO / K.VOID_GAUGE_DIV);
      if (sk && sk.kind === "devour") g *= sk.mult;
      gaugeAll(b, g, ctx);
      return;
    }
    ctx.queue.push({ x: e.x, y: e.y, radius: e.r * K.CHAIN_RADIUS_MULT, amount: e.hpMax * K.CHAIN_DMG_RATIO, depth: depth + 1 });
  }

  function gaugeAll(b, n, ctx) {
    b.party.forEach(function (p) { p.gauge = Math.min(p.gaugeMax, p.gauge + n); });
    ctx.cmds.push({ type: "gauge" });
  }

  // 依序處理爆炸佇列（用佇列避免遞迴過深）
  function resolve(b, ctx) {
    var boost = !b.shot.ended && skillKind(b) === "chainBoost" ? b.shot.skill.per : 0;
    while (ctx.queue.length) {
      var x = ctx.queue.shift();
      if (!b.shot.ended && x.depth > b.shot.chain) b.shot.chain = x.depth;
      ctx.cmds.push({ type: "explode", x: x.x, y: x.y, radius: x.radius, depth: x.depth });
      var amt0 = x.amount * (1 + boost * x.depth);
      alive(b).forEach(function (e) {
        if (dist(e, x.x, x.y) > x.radius + e.r) return;
        var el = x.el || ctx.el;
        damage(b, e, x.trueDmg ? amt0 : amt0 * elemMult(e.def, el, corroded(b, e)), "explode", x.depth, ctx);
      });
    }
  }

  function newCtx(el) { return { cmds: [], queue: [], el: el }; }

  // 把 range 內的其他敵人往 center 拉近 ratio 的距離（不重疊）
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
      cmds.push({ type: "move", uid: o.uid, x: o.x, y: o.y });
    });
  }
  function moveBy(e, dx, dy, cmds) {
    e.x = Math.max(e.r, Math.min(K.FIELD_W - e.r, e.x + dx));
    e.y = Math.max(e.r, Math.min(K.FIELD_H - e.r, e.y + dy));
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
    if (el === "comet" && !e.slowUsed) { e.slowUsed = true; e.cd += 1; }
  }
  function heal(b, amount, ctx) {
    var before = b.hp;
    b.hp = Math.min(b.hpMax, b.hp + Math.round(amount));
    if (b.hp > before) ctx.cmds.push({ type: "heal", amount: b.hp - before });
  }

  // 直線（射線）上的敵人：從 (x, y) 朝 (ux, uy)，寬 width
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

  // opts = {skill: bool, x, y}（x, y = 射出點）。回傳 {cmds, launch}
  function beginShot(b, opts) {
    opts = opts || {};
    var p = shooter(b), t = trait(p);
    var sk = null;
    var ctx = newCtx(p.element);
    if (opts.skill && canSkill(b)) {
      sk = p.def.skill;
      p.gauge = 0;
      ctx.cmds.push({ type: "skill", id: p.id });
    }
    b.shot = newShot(sk);
    var launch = { speedMult: 1, radius: K.HERO_R, pierce: false, pierceFirst: false, restitution: K.REST, airMult: 1, enemyPull: 0, wellBoost: 1, redirect: false };
    if (t.kind === "pierce") launch.pierce = true;
    if (t.kind === "pierceFirst") launch.pierceFirst = true;
    if (t.kind === "big") launch.radius = t.radius;
    if (t.kind === "noDecay") launch.restitution = 1;
    if (t.kind === "wellBoost") launch.wellBoost = t.mult;
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
      else if (k === "wellAtLaunch" && opts.x != null) ctx.cmds.push({ type: "well", x: opts.x, y: opts.y, radius: sk.radius, hole: false, temp: true });
    }
    // 先導雷射（光束）：射出方向
    if (t.kind === "laser" && opts.dir) laser(b, p, opts.x, opts.y, opts.dir.x, opts.dir.y, t.width, p.atk * t.mult, p.element, ctx);
    resolve(b, ctx);
    return { cmds: ctx.cmds, launch: launch };
  }

  function laser(b, src, x, y, ux, uy, width, amount, el, ctx, both) {
    var len = Math.sqrt(ux * ux + uy * uy) || 1;
    ux /= len; uy /= len;
    var end = rayEnd(x, y, ux, uy);
    var start = both ? rayEnd(x, y, -ux, -uy) : { x: x, y: y };
    ctx.cmds.push({ type: "laser", x1: start.x, y1: start.y, x2: end.x, y2: end.y, el: el });
    enemiesOnRay(b, x, y, ux, uy, width, both).forEach(function (e) {
      damage(b, e, amount * elemMult(e.def, el, corroded(b, e)), "laser", 0, ctx);
    });
  }

  // 角色撞到敵人。ev = {enemy: uid, speed, step, vx, vy}
  function onHit(b, ev) {
    var e = byUid(b, ev.enemy);
    var p = shooter(b), t = trait(p), sk = b.shot.skill, sk_k = sk ? sk.kind : null;
    var el = p.element;
    var ctx = newCtx(el);
    if (!e || e.dead) return ctx.cmds;
    var last = b.shot.lastHit[e.uid];
    if (last != null && ev.step - last < K.HIT_GAP_STEPS) return ctx.cmds;
    b.shot.lastHit[e.uid] = ev.step;

    b.shot.hits++;
    b.shot.hitIndex++;
    p.gauge = Math.min(p.gaugeMax, p.gauge + 1 + (t.kind === "gaugeDrain" ? t.n : 0));
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
        e.mark = null;
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
        if (reaction.id === "superconduct") e.superconduct = true;
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
    var amount = base * elemMult(e.def, el, corroded(b, e));
    if (t.kind === "execute") amount += (e.hpMax - e.hp) * t.ratio;
    var dealt = damage(b, e, amount, "hit", 0, ctx);
    b.shot.hitDmg[e.uid] = (b.shot.hitDmg[e.uid] || 0) + dealt;
    if (trueBonus) damage(b, e, trueBonus, "true", 0, ctx);

    // 3) 屬性與特性的附帶效果
    var hit = [e];
    if (!reaction && el === "plasma") {
      var arcs = sk_k === "multiArc" ? sk.n : 1, from = e;
      for (var i = 0; i < arcs; i++) {
        var tg = nearestFrom(b, from.x, from.y, K.ARC_RANGE, hit);
        if (!tg) break;
        ctx.cmds.push({ type: "arc", from: from.uid, to: tg.uid });
        damage(b, tg, base * K.ARC_RATIO * elemMult(tg.def, el, corroded(b, tg)), "arc", 0, ctx);
        hit.push(tg); from = tg;
      }
    }
    if (t.kind === "hitArc") {
      var t2 = nearestFrom(b, e.x, e.y, t.range, hit);   // 第二近：排除雷漿電弧已打過的目標
      if (t2) { ctx.cmds.push({ type: "arc", from: e.uid, to: t2.uid }); damage(b, t2, p.atk * t.mult * elemMult(t2.def, el, corroded(b, t2)), "arc", 0, ctx); }
    }
    if (!reaction && el === "gravity" && !e.dead) pullToward(b, e, K.GRAVITY_MARK_RANGE, 0.25, ctx.cmds);
    if (t.kind === "hitPull" && !e.dead) pullToward(b, e, t.range, t.ratio, ctx.cmds);
    if (t.kind === "push" && !e.dead && (ev.vx || ev.vy)) {
      var vl = Math.sqrt(ev.vx * ev.vx + ev.vy * ev.vy);
      moveBy(e, ev.vx / vl * t.dist, ev.vy / vl * t.dist, ctx.cmds);
    }
    if (t.kind === "spark") ctx.queue.push({ x: e.x, y: e.y, radius: t.radius, amount: p.atk * t.mult, depth: 0 });
    if (sk_k === "hitBlast") ctx.queue.push({ x: e.x, y: e.y, radius: sk.radius, amount: p.atk * sk.mult, depth: 0 });
    if (t.kind === "heal") heal(b, b.hpMax * t.ratio, ctx);
    if (sk_k === "sanctuary" && b.shot.hits % sk.per === 0) heal(b, b.hpMax * sk.ratio, ctx);
    if (t.kind === "split") ctx.cmds.push({ type: "debris", x: e.x, y: e.y, n: t.n, el: el });
    if (t.kind === "echoMark") b.echoes.push({ x: e.x, y: e.y, atk: p.atk, el: el, range: t.range, radius: t.radius, mult: t.mult, shot: b.stats.shots });

    // 4) 反應效果
    if (reaction) applyReaction(b, reaction, e, p, reactEl, ctx);
    ctx.el = reactEl;
    resolve(b, ctx);
    return ctx.cmds;
  }

  function applyReaction(b, R, e, p, el, ctx) {
    if (R.kind === "explode") {
      ctx.queue.unshift({ x: e.x, y: e.y, radius: R.radius, amount: p.atk * R.mult, depth: 0 });
    } else if (R.kind === "true") {
      damage(b, e, p.atk * R.mult, "true", 0, ctx);
    } else if (R.kind === "zone") {
      b.zones.push({ x: e.x, y: e.y, radius: R.radius, amount: p.atk * R.mult, turns: R.turns, el: el });
    } else if (R.kind === "spread") {
      alive(b).forEach(function (o) { if (dist(o, e.x, e.y) <= R.radius + o.r) setMark(b, o, "solar", p.atk, ctx); });
    } else if (R.kind === "collapse") {
      pullToward(b, e, R.pullRadius, 0.6, ctx.cmds);
      ctx.queue.unshift({ x: e.x, y: e.y, radius: R.radius, amount: p.atk * R.mult, depth: 0 });
    }
  }

  // 射出者撞到停在場上的隊友 → 隊友的友情技。ev = {ally: index, x, y}
  function onAlly(b, ev) {
    var a = b.party[ev.ally];
    var ctx = newCtx(a ? a.element : null);
    if (!a || ev.ally === b.active || b.shot.allies[ev.ally]) return ctx.cmds;
    b.shot.allies[ev.ally] = true;
    var F = a.def.friend, x = ev.x, y = ev.y, el = a.element, atk = a.atk;
    ctx.cmds.push({ type: "friend", ally: ev.ally, id: a.id });
    function hurt(e, mult, kind, el2) { damage(b, e, atk * mult * elemMult(e.def, el2 || el, corroded(b, e)), kind || "friend", 0, ctx); }
    var k = F.kind;
    if (k === "cross") {
      laser(b, a, x, y, 1, 0, F.width, atk * F.mult, el, ctx, true);
      laser(b, a, x, y, 0, 1, F.width, atk * F.mult, el, ctx, true);
    } else if (k === "beam") {
      var ux = 1, uy = 0, both = true;
      if (F.aim === "nearest") {
        var n = nearestFrom(b, x, y);
        if (n) { ux = n.x - x; uy = n.y - y; both = false; }
      }
      laser(b, a, x, y, ux, uy, F.width, atk * F.mult, el, ctx, both);
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
      if (F.mark || F.clearMarks) alive(b).forEach(function (e) {
        if (dist(e, x, y) > F.radius + e.r) return;
        if (F.clearMarks) e.mark = null; else setMark(b, e, F.mark, atk, ctx);
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
      alive(b).forEach(function (e) { setMark(b, e, F.el, atk, ctx); });
    } else if (k === "meteor") {
      for (var m = 0; m < F.n; m++) {
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
        moveBy(e, (e.x - x) / d * F.dist, (e.y - y) / d * F.dist, ctx.cmds);
        hurt(e, F.mult);
      });
    } else if (k === "wellAt") {
      ctx.cmds.push({ type: "well", x: x, y: y, radius: F.radius, hole: false, temp: true });
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
    resolve(b, ctx);
    return ctx.cmds;
  }

  // 撞牆。ev = {x, y}
  function onWall(b, ev) {
    var p = shooter(b), t = trait(p), sk = b.shot.skill;
    var ctx = newCtx(p.element);
    if (t.kind === "wallFreeze") {
      alive(b).forEach(function (e) { if (dist(e, ev.x, ev.y) <= t.range + e.r) setMark(b, e, "comet", p.atk, ctx); });
    } else if (t.kind === "wallArc") {
      var n = nearestFrom(b, ev.x, ev.y, t.range);
      if (n) { ctx.cmds.push({ type: "bolt", fromX: ev.x, fromY: ev.y, uid: n.uid, el: p.element }); damage(b, n, p.atk * t.mult * elemMult(n.def, p.element, corroded(b, n)), "arc", 0, ctx); }
    } else if (t.kind === "wallPull") {
      pullToward(b, { x: ev.x, y: ev.y, r: 0 }, t.range, t.ratio, ctx.cmds);
    }
    if (sk && sk.kind === "wallStorm") {
      alive(b).forEach(function (e) { damage(b, e, p.atk * sk.mult * elemMult(e.def, p.element, corroded(b, e)), "arc", 0, ctx); });
    }
    resolve(b, ctx);
    return ctx.cmds;
  }

  // 射出者每子步的位置：星點、殘響、冰霜軌跡。ev = {x, y, r}
  function onPos(b, ev) {
    var p = shooter(b), t = trait(p);
    var ctx = newCtx(p.element);
    b.stars.forEach(function (s, i) {
      if (b.shot.lit.indexOf(i) >= 0) return;
      if (dist(s, ev.x, ev.y) <= K.STAR_R) { b.shot.lit.push(i); ctx.cmds.push({ type: "star", index: i }); }
    });
    if (b.echoes.length) {
      b.echoes = b.echoes.filter(function (c) {
        if (c.shot >= b.stats.shots || dist(c, ev.x, ev.y) > c.range) return true;
        ctx.el = c.el;
        ctx.queue.push({ x: c.x, y: c.y, radius: c.radius, amount: c.atk * c.mult, depth: 0, el: c.el });
        return false;
      });
    }
    if (t.kind === "frostTrail") {
      alive(b).forEach(function (e) {
        if (b.shot.frosted[e.uid]) return;
        if (dist(e, ev.x, ev.y) <= e.r + (ev.r || K.HERO_R) + t.range) { b.shot.frosted[e.uid] = true; e.cd += 1; ctx.cmds.push({ type: "mark", uid: e.uid, el: "comet" }); }
      });
    }
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
    if (r.dur <= 0) {
      r.broken = true;
      ctx.cmds.push({ type: "rockBreak", id: r.id, x: r.x, y: r.y });
      ctx.cmds.push({ type: "debris", x: r.x, y: r.y, n: 3 + Math.floor(b.rng() * 3), el: shooter(b).element });
    }
    return ctx.cmds;
  }

  // 碎片撞到敵人：射出者攻 × 0.4（碎片屬性），計 Hit。ev = {enemy, speed, step, debris, el}
  function onDebris(b, ev) {
    var p = shooter(b), el = ev.el || p.element;
    var ctx = newCtx(el);
    var e = byUid(b, ev.enemy);
    if (!e || e.dead || ev.speed < K.DEBRIS_MIN_SPEED) return ctx.cmds;
    var key = "d:" + ev.debris + ":" + e.uid, last = b.shot.lastHit[key];
    if (last != null && ev.step - last < K.HIT_GAP_STEPS) return ctx.cmds;
    b.shot.lastHit[key] = ev.step;
    b.shot.hits++;
    p.gauge = Math.min(p.gaugeMax, p.gauge + 1);
    damage(b, e, p.atk * K.DEBRIS_MULT * elemMult(e.def, el, corroded(b, e)), "debris", 0, ctx);
    resolve(b, ctx);
    return ctx.cmds;
  }

  // 殘影撞到敵人：射出者攻 × 0.5 × 屬性倍率；不計 Hit、不留印記。ev = {enemy, step}
  function onGhost(b, ev) {
    var p = shooter(b), ctx = newCtx(p.element);
    var e = byUid(b, ev.enemy);
    if (!e || e.dead) return ctx.cmds;
    var key = "g:" + e.uid, last = b.shot.lastHit[key];
    if (last != null && ev.step - last < K.HIT_GAP_STEPS) return ctx.cmds;
    b.shot.lastHit[key] = ev.step;
    damage(b, e, p.atk * K.GHOST_MULT * elemMult(e.def, p.element, corroded(b, e)), "ghost", 0, ctx);
    resolve(b, ctx);
    return ctx.cmds;
  }

  // 一發結束。stop = {x, y}（停止點）。回傳 {next, cmds}
  function endShot(b, stop) {
    var p = shooter(b), sk = b.shot.skill;
    var ctx = newCtx(p.element);
    if (sk && sk.kind === "stopBlast" && stop) ctx.queue.push({ x: stop.x, y: stop.y, radius: sk.radius, amount: p.atk * sk.mult, depth: 0 });
    if (sk && sk.kind === "capacitor") {
      Object.keys(b.shot.hitDmg).forEach(function (uid) {
        var e = byUid(b, uid);
        if (e && !e.dead && b.shot.hitDmg[uid] > 0) damage(b, e, b.shot.hitDmg[uid] * sk.ratio, "arc", 0, ctx);
      });
    }
    resolve(b, ctx);
    constellation(b, p, ctx);
    resolve(b, ctx);
    b.stats.shots++;
    if (b.shot.chain > b.stats.maxChain) b.stats.maxChain = b.shot.chain;
    b.shot.ended = true;
    b.enemies.forEach(function (e) { e.superconduct = false; });
    if (!alive(b).length) return { next: "win", cmds: ctx.cmds };
    b.active = (b.active + 1) % b.party.length;
    return { next: b.active === 0 ? "enemy" : "hero", cmds: ctx.cmds };
  }

  // 星座（§8）：點亮 3 → 三角座、4 → 方舟座、5 以上 → 五芒座
  function constellation(b, p, ctx) {
    var n = b.shot.lit.length;
    if (n < 3) return;
    var id = n >= 5 ? "penta" : n === 4 ? "ark" : "tri";
    ctx.cmds.push({ type: "constellation", id: id, n: n });
    if (id === "tri") {
      for (var i = 0; i < K.METEOR_N; i++) {
        var live = alive(b);
        if (!live.length) break;
        var e = live[Math.floor(b.rng() * live.length)];
        ctx.cmds.push({ type: "bolt", fromX: e.x, fromY: 0, uid: e.uid, el: p.element });
        damage(b, e, p.atk * K.METEOR_MULT * elemMult(e.def, p.element, corroded(b, e)), "friend", 0, ctx);
      }
    } else if (id === "ark") {
      b.shield = Math.max(b.shield, K.ARK_SHIELD);
      ctx.cmds.push({ type: "shield", ratio: b.shield });
    } else {
      b.party.forEach(function (q) { q.gauge = q.gaugeMax; });
      ctx.cmds.push({ type: "gauge" });
    }
  }

  // ---------------- 敵人回合 ----------------
  function enemyTurn(b) {
    var attacks = [];
    var ctx = newCtx("solar");
    alive(b).forEach(function (e) {
      if (e.mark && e.mark.el === "solar") damage(b, e, e.mark.atk * K.BURN_RATIO * (e.mark.burnMult || 1), "burn", 0, ctx);
    });
    resolve(b, ctx);
    b.zones.forEach(function (z) {
      ctx.el = z.el;
      alive(b).forEach(function (e) {
        if (dist(e, z.x, z.y) <= z.radius + e.r) damage(b, e, z.amount * elemMult(e.def, z.el, corroded(b, e)), "zone", 0, ctx);
      });
      resolve(b, ctx);
      z.turns--;
    });
    b.zones = b.zones.filter(function (z) { return z.turns > 0; });
    alive(b).forEach(function (e) {
      e.cd -= 1;
      if (e.cd <= 0) {
        var dmg = e.def.atk;
        if (b.shield > 0) { dmg = Math.round(dmg * (1 - b.shield)); b.shield = 0; }
        b.hp = Math.max(0, b.hp - dmg);
        attacks.push({ uid: e.uid, dmg: dmg });
        e.cd = e.cdMax;
      }
    });
    b.enemies.forEach(function (e) { if (e.mark && --e.mark.turns <= 0) e.mark = null; });
    if (b.nullTurns > 0) b.nullTurns--;
    b.turnNo++;
    return { cmds: ctx.cmds, attacks: attacks, lose: b.hp <= 0, win: !alive(b).length };
  }

  var api = {
    create: create, canSkill: canSkill, beginShot: beginShot, onHit: onHit, onAlly: onAlly, onWall: onWall, onPos: onPos,
    onRock: onRock, onDebris: onDebris, onGhost: onGhost, endShot: endShot, enemyTurn: enemyTurn,
    hitMult: hitMult, elemMult: elemMult, speedFactor: speedFactor, byUid: byUid, alive: alive,
    TRAIT_KINDS: TRAIT_KINDS, FRIEND_KINDS: FRIEND_KINDS, SKILL_KINDS: SKILL_KINDS
  };
  root.PriTestShedanCombat = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
