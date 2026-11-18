// 射彈宇宙（shedan）：戰鬥規則。只吃「碰撞事件」、回傳「指令」，不碰 matter.js 與 DOM，可以在 Node 直接測試。
// 規則依據 docs/shedan_game_design.md §2～§4。瀏覽器掛在 window.PriTestShedanCombat。
//
// 指令（cmds）給畫面與物理用：
//   {type:"damage", uid, amount, x, y, kind:"hit"|"explode"|"arc"|"burn"|"zone"|"true"}
//   {type:"explode", x, y, radius, depth}     depth 0 = 反應爆炸；1 以上 = 連爆第幾層
//   {type:"kill", uid}  {type:"reaction", uid, id, x, y}  {type:"move", uid, x, y}
//   {type:"arc", from, to}  {type:"mark", uid, el}  {type:"gauge"}
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestShedanData || (typeof require === "function" ? require("./shedan_data.js") : null);
  var K = D.C;

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
    return {
      party: party, hp: hpMax, hpMax: hpMax, enemies: enemies, zones: [],
      active: 0, turnNo: 1,
      shot: { hits: 0, chain: 0, lastHit: {} },
      stats: { damage: 0, maxChain: 0, shots: 0 }
    };
  }

  function byUid(b, uid) {
    for (var i = 0; i < b.enemies.length; i++) if (b.enemies[i].uid === uid) return b.enemies[i];
    return null;
  }
  function alive(b) { return b.enemies.filter(function (e) { return !e.dead; }); }
  function dist(a, x, y) { var dx = a.x - x, dy = a.y - y; return Math.sqrt(dx * dx + dy * dy); }
  function corroded(e) { return !!(e.mark && e.mark.el === "nebula"); }

  // ---------------- 傷害與連爆 ----------------
  // 造成傷害；擊破時排入爆炸佇列（虛空印記則改成全隊量表）。queue 由 resolve() 處理。
  function damage(b, e, amount, kind, depth, cmds, queue) {
    if (e.dead) return;
    var n = Math.max(0, Math.round(amount));
    if (!n) return;
    e.hp -= n;
    b.stats.damage += n;
    cmds.push({ type: "damage", uid: e.uid, amount: n, x: e.x, y: e.y, kind: kind });
    if (e.hp > 0) return;
    e.hp = 0;
    e.dead = true;
    cmds.push({ type: "kill", uid: e.uid });
    if (e.mark && e.mark.el === "void") {
      var g = Math.floor(e.hpMax * K.VOID_GAUGE_RATIO / K.VOID_GAUGE_DIV);
      b.party.forEach(function (p) { p.gauge = Math.min(p.gaugeMax, p.gauge + g); });
      cmds.push({ type: "gauge" });
      return;
    }
    queue.push({ x: e.x, y: e.y, radius: e.r * K.CHAIN_RADIUS_MULT, amount: e.hpMax * K.CHAIN_DMG_RATIO, depth: depth + 1 });
  }

  // 依序處理爆炸佇列（用佇列避免遞迴過深）。el 是爆炸屬性（擊破者／反應的屬性）。
  function resolve(b, queue, el, cmds) {
    while (queue.length) {
      var x = queue.shift();
      if (x.depth > b.shot.chain) b.shot.chain = x.depth;
      cmds.push({ type: "explode", x: x.x, y: x.y, radius: x.radius, depth: x.depth });
      alive(b).forEach(function (e) {
        if (dist(e, x.x, x.y) > x.radius + e.r) return;
        var amt = x.trueDmg ? x.amount : x.amount * elemMult(e.def, el, corroded(e));
        damage(b, e, amt, "explode", x.depth, cmds, queue);
      });
    }
  }

  // 把 range 內的其他敵人往 (x, y) 拉近 ratio 的距離（不重疊）
  function pullToward(b, center, range, ratio, cmds) {
    alive(b).forEach(function (o) {
      if (o === center) return;
      var d = dist(o, center.x, center.y);
      if (d > range || d < 1e-6) return;
      var minD = o.r + center.r + 4;
      var nd = Math.max(minD, d * (1 - ratio));
      if (nd >= d) return;
      o.x = center.x + (o.x - center.x) * nd / d;
      o.y = center.y + (o.y - center.y) * nd / d;
      cmds.push({ type: "move", uid: o.uid, x: o.x, y: o.y });
    });
  }

  function nearestOther(b, e, range) {
    var best = null, bd = range;
    alive(b).forEach(function (o) {
      if (o === e) return;
      var d = dist(o, e.x, e.y);
      if (d <= bd) { bd = d; best = o; }
    });
    return best;
  }

  // ---------------- 一發 ----------------
  function beginShot(b) {
    b.shot = { hits: 0, chain: 0, lastHit: {} };
  }

  // 角色撞到敵人。ev = {enemy: uid, speed, step}
  function onHit(b, ev) {
    var cmds = [];
    var e = byUid(b, ev.enemy);
    if (!e || e.dead) return cmds;
    var last = b.shot.lastHit[e.uid];
    if (last != null && ev.step - last < K.HIT_GAP_STEPS) return cmds;
    b.shot.lastHit[e.uid] = ev.step;

    var p = b.party[b.active];
    var el = p.element;
    b.shot.hits++;
    p.gauge = Math.min(p.gaugeMax, p.gauge + 1);

    // 1) 反應判定（用撞擊前的印記），否則留下／更新印記
    var reaction = e.mark ? D.reactionFor(e.mark.el, el) : null;
    if (reaction) {
      e.mark = null;
      cmds.push({ type: "reaction", uid: e.uid, id: reaction.id, x: e.x, y: e.y });
      if (reaction.id === "superconduct") e.superconduct = true;
    } else {
      e.mark = { el: el, turns: K.MARK_TURNS, atk: p.atk };
      cmds.push({ type: "mark", uid: e.uid, el: el });
      if (el === "comet" && !e.slowUsed) { e.slowUsed = true; e.cd += 1; }
    }

    // 2) 撞擊傷害
    var queue = [];
    var hm = hitMult(b.shot.hits) * (e.superconduct ? 2 : 1);
    var base = p.atk * hm * speedFactor(ev.speed);
    var amount = base * elemMult(e.def, el, corroded(e));
    damage(b, e, amount, "hit", 0, cmds, queue);

    // 3) 印記的附帶效果（沒有反應時）
    if (!reaction && el === "plasma") {
      var t = nearestOther(b, e, K.ARC_RANGE);
      if (t) {
        cmds.push({ type: "arc", from: e.uid, to: t.uid });
        damage(b, t, base * K.ARC_RATIO * elemMult(t.def, el, corroded(t)), "arc", 0, cmds, queue);
      }
    }
    if (!reaction && el === "gravity" && !e.dead) pullToward(b, e, K.GRAVITY_MARK_RANGE, 0.25, cmds);

    // 4) 反應效果
    if (reaction) {
      var R = reaction;
      if (R.kind === "explode") {
        queue.unshift({ x: e.x, y: e.y, radius: R.radius, amount: p.atk * R.mult, depth: 0 });
      } else if (R.kind === "true") {
        damage(b, e, p.atk * R.mult, "true", 0, cmds, queue);
      } else if (R.kind === "zone") {
        b.zones.push({ x: e.x, y: e.y, radius: R.radius, amount: p.atk * R.mult, turns: R.turns, el: el });
      } else if (R.kind === "spread") {
        alive(b).forEach(function (o) {
          if (dist(o, e.x, e.y) <= R.radius + o.r) {
            o.mark = { el: "solar", turns: K.MARK_TURNS, atk: p.atk };
            cmds.push({ type: "mark", uid: o.uid, el: "solar" });
          }
        });
      } else if (R.kind === "collapse") {
        pullToward(b, e, R.pullRadius, 0.6, cmds);
        queue.unshift({ x: e.x, y: e.y, radius: R.radius, amount: p.atk * R.mult, depth: 0 });
      }
    }
    resolve(b, queue, el, cmds);
    return cmds;
  }

  // 一發結束：回傳下一步（hero／enemy／win）
  function endShot(b) {
    b.stats.shots++;
    if (b.shot.chain > b.stats.maxChain) b.stats.maxChain = b.shot.chain;
    b.enemies.forEach(function (e) { e.superconduct = false; });
    if (!alive(b).length) return { next: "win" };
    b.active = (b.active + 1) % b.party.length;
    return { next: b.active === 0 ? "enemy" : "hero" };
  }

  // ---------------- 敵人回合 ----------------
  function enemyTurn(b) {
    var cmds = [], attacks = [];
    var queue = [];
    // 灼燒（恆星印記）
    alive(b).forEach(function (e) {
      if (e.mark && e.mark.el === "solar") damage(b, e, e.mark.atk * K.BURN_RATIO, "burn", 0, cmds, queue);
    });
    resolve(b, queue, "solar", cmds);
    // 電離雲
    b.zones.forEach(function (z) {
      alive(b).forEach(function (e) {
        if (dist(e, z.x, z.y) <= z.radius + e.r) damage(b, e, z.amount * elemMult(e.def, z.el, corroded(e)), "zone", 0, cmds, queue);
      });
      resolve(b, queue, z.el, cmds);
      z.turns--;
    });
    b.zones = b.zones.filter(function (z) { return z.turns > 0; });
    // 倒數與攻擊
    alive(b).forEach(function (e) {
      e.cd -= 1;
      if (e.cd <= 0) {
        b.hp = Math.max(0, b.hp - e.def.atk);
        attacks.push({ uid: e.uid, dmg: e.def.atk });
        e.cd = e.cdMax;
      }
    });
    // 印記持續時間
    b.enemies.forEach(function (e) {
      if (e.mark && --e.mark.turns <= 0) e.mark = null;
    });
    b.turnNo++;
    return { cmds: cmds, attacks: attacks, lose: b.hp <= 0, win: !alive(b).length };
  }

  var api = {
    create: create, beginShot: beginShot, onHit: onHit, endShot: endShot, enemyTurn: enemyTurn,
    hitMult: hitMult, elemMult: elemMult, speedFactor: speedFactor, byUid: byUid, alive: alive
  };
  root.PriTestShedanCombat = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
