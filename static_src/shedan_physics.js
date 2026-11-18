// 射彈宇宙（shedan）：matter.js 物理場地。牆、敵人（靜態圓）、隊員（停住時是感應區、射出時是動態圓）、
// 小行星（靜態圓）、碎片（小型動態圓）、引力井／黑洞、冰牆。把碰撞轉成事件交給 shedan_combat.js；不做任何傷害計算。
// 規則依據 docs/shedan_game_design.md §1.2、§8.1。
// 事件：{type:"hit", enemy, speed, step, vx, vy} {type:"ally", ally, step} {type:"wall", x, y, step}
//       {type:"rock", rock, step} {type:"debris", enemy, speed, step, debris, el} {type:"stop", step}
// 瀏覽器掛在 window.PriTestShedanPhysics；Node 測試時傳入 require 進來的 Matter。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestShedanData || (typeof require === "function" ? require("./shedan_data.js") : null);
  var K = D.C;
  var WALL = 200;                    // 外牆厚度（放在場地外側，避免高速穿牆）
  var DT = 1000 / (60 * K.SUBSTEPS); // 每 frame K.SUBSTEPS 個子步
  var CAT = { wall: 0x1, hero: 0x2, enemy: 0x4, debris: 0x8, rock: 0x10 };

  // 開場隊形（下方約 90 單位留給 HUD）
  var DEFAULT_HERO_POS = [{ x: 120, y: 810 }, { x: 220, y: 835 }, { x: 320, y: 835 }, { x: 420, y: 810 }];

  // 碰撞的彈性取兩者較大值，所以牆、敵人、小行星設 0，讓射出者自己的彈性（0.95／流明 1）生效
  var STATIC_OPTS = { isStatic: true, restitution: 0, friction: 0, frictionStatic: 0 };
  function opts(extra) { var o = {}; for (var k in STATIC_OPTS) o[k] = STATIC_OPTS[k]; for (var j in extra) o[j] = extra[j]; return o; }

  function baseRadius(p) { var t = p.def.trait || {}; return t.kind === "big" ? t.radius : K.HERO_R; }

  function create(o) {
    var M = o.Matter || root.Matter;
    var b = o.battle;
    var field = o.field || {};
    var engine = M.Engine.create({ positionIterations: 8, velocityIterations: 6 });
    engine.gravity.x = 0; engine.gravity.y = 0; engine.gravity.scale = 0;
    var W = K.FIELD_W, H = K.FIELD_H;
    var wf = { category: CAT.wall, mask: 0xFFFF };
    M.Composite.add(engine.world, [
      M.Bodies.rectangle(W / 2, -WALL / 2, W + WALL * 2, WALL, opts({ label: "wall", collisionFilter: wf })),
      M.Bodies.rectangle(W / 2, H + WALL / 2, W + WALL * 2, WALL, opts({ label: "wall", collisionFilter: wf })),
      M.Bodies.rectangle(-WALL / 2, H / 2, WALL, H + WALL * 2, opts({ label: "wall", collisionFilter: wf })),
      M.Bodies.rectangle(W + WALL / 2, H / 2, WALL, H + WALL * 2, opts({ label: "wall", collisionFilter: wf }))
    ]);
    var w = {
      M: M, engine: engine, battle: b, bodies: [], baseR: [], enemyBodies: {}, rockBodies: {},
      wells: (field.wells || []).map(function (x) { return { x: x.x, y: x.y, radius: x.radius || K.WELL_R, hole: !!x.hole }; }),
      tempWells: [], tempWalls: [], debris: [], debrisSeq: 0,
      shooter: null, launch: null, redirected: false,
      stepNo: 0, lowSteps: 0, shotSteps: 0, events: [], lastSpeed: 0
    };

    var pos = o.heroPos || DEFAULT_HERO_POS;
    b.party.forEach(function (p, i) {
      var r = baseRadius(p);
      var body = M.Bodies.circle(pos[i].x, pos[i].y, r, {
        isStatic: true, isSensor: true, restitution: K.REST, friction: 0, frictionStatic: 0, frictionAir: K.AIR,
        label: "hero:" + i, collisionFilter: { category: CAT.hero, mask: CAT.wall | CAT.enemy | CAT.rock | CAT.hero }
      });
      w.bodies.push(body);
      w.baseR.push(r);
      M.Composite.add(engine.world, body);
    });
    b.enemies.forEach(function (e) {
      if (e.dead) return;
      var body = M.Bodies.circle(e.x, e.y, e.r, opts({ label: "enemy:" + e.uid, collisionFilter: { category: CAT.enemy, mask: 0xFFFF } }));
      w.enemyBodies[e.uid] = body;
      M.Composite.add(engine.world, body);
    });
    (field.rocks || b.rocks || []).forEach(function (r, i) {
      var id = r.id || ("r" + i);
      var body = M.Bodies.circle(r.x, r.y, r.r || K.ROCK_R, opts({ label: "rock:" + id, collisionFilter: { category: CAT.rock, mask: 0xFFFF } }));
      w.rockBodies[id] = body;
      M.Composite.add(engine.world, body);
    });

    M.Events.on(engine, "collisionStart", function (ev) {
      ev.pairs.forEach(function (pair) { onPair(w, pair.bodyA, pair.bodyB); });
    });
    return w;
  }

  function onPair(w, A, B) {
    var la = A.label || "", lb = B.label || "";
    // 碎片
    var deb = la.indexOf("debris:") === 0 ? A : lb.indexOf("debris:") === 0 ? B : null;
    if (deb) {
      var other = deb === A ? B : A;
      if ((other.label || "").indexOf("enemy:") === 0) {
        w.events.push({ type: "debris", enemy: other.label.slice(6), speed: deb.plugin.lastSpeed || 0, step: w.stepNo, debris: deb.plugin.id, el: deb.plugin.el });
      }
      return;
    }
    if (w.shooter == null) return;
    var me = w.bodies[w.shooter];
    var o = A === me ? B : B === me ? A : null;
    if (!o) return;
    var label = o.label || "";
    if (label.indexOf("enemy:") === 0) {
      var v = me.velocity;
      w.events.push({ type: "hit", enemy: label.slice(6), speed: w.lastSpeed, step: w.stepNo, vx: v.x, vy: v.y });
    } else if (label.indexOf("hero:") === 0) {
      w.events.push({ type: "ally", ally: +label.slice(5), step: w.stepNo });
    } else if (label.indexOf("rock:") === 0) {
      w.events.push({ type: "rock", rock: label.slice(5), step: w.stepNo });
    } else if (label === "wall") {
      var p = me.position, r = me.circleRadius;
      var x = p.x, y = p.y;
      if (x - r <= 2) x = 0; else if (x + r >= K.FIELD_W - 2) x = K.FIELD_W;
      if (y - r <= 2) y = 0; else if (y + r >= K.FIELD_H - 2) y = K.FIELD_H;
      w.events.push({ type: "wall", x: x, y: y, step: w.stepNo });
    }
  }

  function setRadius(w, body, r) {
    var cur = body.circleRadius;
    if (Math.abs(cur - r) < 1e-6) return;
    w.M.Body.scale(body, r / cur, r / cur);
    body.circleRadius = r;
  }

  function setPierce(w, on) {
    Object.keys(w.enemyBodies).forEach(function (uid) { w.enemyBodies[uid].isSensor = !!on; });
  }

  // 射出隊員 i：速度 (vx, vy) 以 matter.js 單位（每 16.67ms 的位移）；lo = Combat.beginShot 回傳的 launch
  function launch(w, i, vx, vy, lo) {
    var M = w.M, body = w.bodies[i];
    lo = lo || {};
    M.Body.setStatic(body, false);
    body.isSensor = false;
    setRadius(w, body, lo.radius || w.baseR[i]);
    M.Body.setInertia(body, Infinity);
    body.frictionAir = K.AIR * (lo.airMult || 1);
    body.restitution = lo.restitution != null ? lo.restitution : K.REST;
    body.friction = 0;
    var sm = lo.speedMult || 1;
    M.Body.setVelocity(body, { x: vx * sm, y: vy * sm });
    if (lo.pierce || lo.pierceFirst) setPierce(w, true);
    w.shooter = i;
    w.launch = lo;
    w.redirected = false;
    w.lowSteps = 0;
    w.shotSteps = 0;
    w.lastSpeed = speedOf(body);
  }

  function stopShooter(w) {
    var M = w.M, i = w.shooter, body = w.bodies[i];
    M.Body.setVelocity(body, { x: 0, y: 0 });
    M.Body.setStatic(body, true);
    body.isSensor = true;
    setRadius(w, body, w.baseR[i]);
    setPierce(w, false);
    w.tempWells = [];
    w.tempWalls.forEach(function (x) { M.Composite.remove(w.engine.world, x); });
    w.tempWalls = [];
    w.debris.forEach(function (d) { M.Composite.remove(w.engine.world, d); });
    w.debris = [];
    w.shooter = null;
    w.launch = null;
  }

  function allWells(w) { return w.wells.concat(w.tempWells); }

  // 引力井（§8.1）：朝中心、與距離成反比；黑洞中心吞碎片、彈出角色
  function applyWells(w, body, boost, isDebris) {
    var M = w.M, p = body.position, v = body.velocity, vx = v.x, vy = v.y, changed = false, eaten = false;
    allWells(w).forEach(function (g) {
      var dx = g.x - p.x, dy = g.y - p.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d > g.radius || d < 1e-6) return;
      if (g.hole && d < K.HOLE_R) {
        if (isDebris) { eaten = true; return; }
        if (dx * vx + dy * vy > 0) { vx = -vx; vy = -vy; changed = true; }
        return;
      }
      if (d < K.WELL_MIN_D) {
        // 中心附近：不再加速，改成強阻力，讓角色停在井心（否則會來回穿越中心、一直維持高速）
        vx *= 1 - K.WELL_CORE_DRAG; vy *= 1 - K.WELL_CORE_DRAG;
      } else {
        var f = K.WELL_FORCE / d / K.SUBSTEPS * boost;
        vx += dx / d * f; vy += dy / d * f;
        vx *= 1 - K.WELL_DRAG; vy *= 1 - K.WELL_DRAG;   // 井內阻力：避免困在軌道上
      }
      changed = true;
    });
    if (changed) M.Body.setVelocity(body, { x: vx, y: vy });
    return eaten;
  }

  // 偏折（透鏡技能）：被全部敵人微弱吸引
  function applyEnemyPull(w, body, pull) {
    var p = body.position, v = body.velocity, vx = v.x, vy = v.y;
    Object.keys(w.enemyBodies).forEach(function (uid) {
      var e = w.enemyBodies[uid].position, dx = e.x - p.x, dy = e.y - p.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-6) return;
      var f = pull / Math.max(d, K.WELL_MIN_D) / K.SUBSTEPS;
      vx += dx / d * f; vy += dy / d * f;
    });
    w.M.Body.setVelocity(body, { x: vx, y: vy });
  }

  // 前進一個子步，回傳這一步的事件
  function step(w) {
    var M = w.M;
    w.events = [];
    w.stepNo++;
    if (w.shooter != null) {
      var sb = w.bodies[w.shooter];
      applyWells(w, sb, (w.launch && w.launch.wellBoost) || 1, false);
      if (w.launch && w.launch.enemyPull) applyEnemyPull(w, sb, w.launch.enemyPull);
      w.lastSpeed = speedOf(sb);
    }
    var life = K.DEBRIS_LIFE * 60 * K.SUBSTEPS;
    w.debris = w.debris.filter(function (d) {
      d.plugin.age++;
      if (d.plugin.age > life || applyWells(w, d, 1, true)) { M.Composite.remove(w.engine.world, d); return false; }
      d.plugin.lastSpeed = speedOf(d);
      return true;
    });
    M.Engine.update(w.engine, DT);
    if (w.shooter != null) {
      var body = w.bodies[w.shooter];
      clampInside(w, body);
      w.shotSteps++;
      w.lowSteps = speedOf(body) < K.STOP_SPEED ? w.lowSteps + 1 : 0;
      if (w.lowSteps >= K.STOP_STEPS || w.shotSteps >= K.SHOT_MAX_STEPS) {
        stopShooter(w);
        w.events.push({ type: "stop", step: w.stepNo });
      }
    }
    return w.events;
  }

  function speedOf(body) { var v = body.velocity; return Math.sqrt(v.x * v.x + v.y * v.y); }

  // 保險：萬一數值誤差讓角色跑出場地，拉回場內並反轉速度
  function clampInside(w, body) {
    var M = w.M, r = body.circleRadius, p = body.position, v = body.velocity;
    var x = p.x, y = p.y, vx = v.x, vy = v.y, fix = false;
    if (x < r) { x = r; vx = Math.abs(vx); fix = true; }
    if (x > K.FIELD_W - r) { x = K.FIELD_W - r; vx = -Math.abs(vx); fix = true; }
    if (y < r) { y = r; vy = Math.abs(vy); fix = true; }
    if (y > K.FIELD_H - r) { y = K.FIELD_H - r; vy = -Math.abs(vy); fix = true; }
    if (fix) { M.Body.setPosition(body, { x: x, y: y }); M.Body.setVelocity(body, { x: vx, y: vy }); }
  }

  // ---------------- 由規則層指令驅動的操作 ----------------
  function removeEnemy(w, uid) {
    var body = w.enemyBodies[uid];
    if (!body) return;
    w.M.Composite.remove(w.engine.world, body);
    delete w.enemyBodies[uid];
  }
  function moveEnemy(w, uid, x, y) {
    var body = w.enemyBodies[uid];
    if (body) w.M.Body.setPosition(body, { x: x, y: y });
  }
  function breakRock(w, id) {
    var body = w.rockBodies[id];
    if (!body) return;
    w.M.Composite.remove(w.engine.world, body);
    delete w.rockBodies[id];
  }
  // 碎片：n 個，以 DEBRIS_SPEED 朝平均分散＋隨機偏移的方向飛出
  function spawnDebris(w, x, y, n, el) {
    var M = w.M, a0 = Math.random() * Math.PI * 2;
    for (var i = 0; i < n; i++) {
      var a = a0 + i * Math.PI * 2 / n + (Math.random() - 0.5) * 0.6;
      var body = M.Bodies.circle(x + Math.cos(a) * (K.ROCK_R + 4), y + Math.sin(a) * (K.ROCK_R + 4), K.DEBRIS_R, {
        restitution: 0.8, friction: 0, frictionStatic: 0, frictionAir: K.DEBRIS_AIR, label: "debris:" + (++w.debrisSeq),
        collisionFilter: { category: CAT.debris, mask: CAT.wall | CAT.enemy | CAT.rock }
      });
      M.Body.setInertia(body, Infinity);
      M.Body.setVelocity(body, { x: Math.cos(a) * K.DEBRIS_SPEED, y: Math.sin(a) * K.DEBRIS_SPEED });
      body.plugin = { id: w.debrisSeq, el: el, age: 0, lastSpeed: K.DEBRIS_SPEED };
      w.debris.push(body);
      M.Composite.add(w.engine.world, body);
    }
  }
  // 暫時的引力井（環月友情技、事件視界）：到本發結束
  function addWell(w, g, temp) {
    var x = { x: g.x, y: g.y, radius: g.radius || K.WELL_R, hole: !!g.hole };
    if (temp) w.tempWells.push(x); else w.wells.push(x);
  }
  // 暫時的冰牆（雪砂友情技）：到本發結束；碰到時也算撞牆
  function addWall(w, x1, y1, x2, y2) {
    var M = w.M, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, len = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
    var body = M.Bodies.rectangle(cx, cy, len, 12, opts({ label: "wall", angle: Math.atan2(y2 - y1, x2 - x1), collisionFilter: { category: CAT.wall, mask: 0xFFFF } }));
    w.tempWalls.push(body);
    M.Composite.add(w.engine.world, body);
  }
  // 電漿推進（離子技能）：朝 (x, y) 轉向，速度大小不變；每發一次
  function redirect(w, x, y) {
    if (w.shooter == null || w.redirected) return false;
    var body = w.bodies[w.shooter], p = body.position, s = speedOf(body);
    var dx = x - p.x, dy = y - p.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) return false;
    w.M.Body.setVelocity(body, { x: dx / d * s, y: dy / d * s });
    w.redirected = true;
    return true;
  }

  function heroPos(w, i) { var p = w.bodies[i].position; return { x: p.x, y: p.y }; }
  function heroVel(w, i) { var v = w.bodies[i].velocity; return { x: v.x, y: v.y }; }
  function heroRadius(w, i) { return w.bodies[i].circleRadius; }
  function isShooting(w) { return w.shooter != null; }
  function debrisList(w) { return w.debris.map(function (d) { return { x: d.position.x, y: d.position.y, el: d.plugin.el }; }); }

  var api = {
    create: create, launch: launch, step: step, removeEnemy: removeEnemy, moveEnemy: moveEnemy,
    breakRock: breakRock, spawnDebris: spawnDebris, addWell: addWell, addWall: addWall, setPierce: setPierce, redirect: redirect,
    heroPos: heroPos, heroVel: heroVel, heroRadius: heroRadius, isShooting: isShooting, debrisList: debrisList,
    allWells: allWells, DEFAULT_HERO_POS: DEFAULT_HERO_POS
  };
  root.PriTestShedanPhysics = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
