// 射彈宇宙（shedan）：matter.js 物理場地。牆、敵人（靜態圓）、隊員（停住時是感應區、射出時是動態圓）。
// 把碰撞轉成事件交給 shedan_combat.js；不做任何傷害計算。規則依據 docs/shedan_game_design.md §1.2。
// 事件：{type:"hit", enemy:uid, speed, step} {type:"ally", ally:index, step} {type:"stop", step}
// 瀏覽器掛在 window.PriTestShedanPhysics；Node 測試時傳入 require 進來的 Matter。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestShedanData || (typeof require === "function" ? require("./shedan_data.js") : null);
  var K = D.C;
  var WALL = 200;                 // 牆的厚度（放在場地外側，避免高速穿牆）
  var DT = 1000 / (60 * K.SUBSTEPS); // 每 frame K.SUBSTEPS 個子步

  var DEFAULT_HERO_POS = [{ x: 120, y: 860 }, { x: 220, y: 890 }, { x: 320, y: 890 }, { x: 420, y: 860 }];

  function create(opts) {
    var M = opts.Matter || root.Matter;
    var b = opts.battle;
    var engine = M.Engine.create({ positionIterations: 8, velocityIterations: 6 });
    engine.gravity.x = 0;
    engine.gravity.y = 0;
    engine.gravity.scale = 0;
    var W = K.FIELD_W, H = K.FIELD_H;
    var wallOpts = { isStatic: true, restitution: 1, friction: 0, frictionStatic: 0, label: "wall" };
    var walls = [
      M.Bodies.rectangle(W / 2, -WALL / 2, W + WALL * 2, WALL, wallOpts),
      M.Bodies.rectangle(W / 2, H + WALL / 2, W + WALL * 2, WALL, wallOpts),
      M.Bodies.rectangle(-WALL / 2, H / 2, WALL, H + WALL * 2, wallOpts),
      M.Bodies.rectangle(W + WALL / 2, H / 2, WALL, H + WALL * 2, wallOpts)
    ];
    var w = {
      M: M, engine: engine, battle: b, bodies: [], enemyBodies: {}, shooter: null,
      stepNo: 0, lowSteps: 0, shotSteps: 0, events: [], lastSpeed: 0
    };
    M.Composite.add(engine.world, walls);

    var pos = opts.heroPos || DEFAULT_HERO_POS;
    b.party.forEach(function (p, i) {
      var body = M.Bodies.circle(pos[i].x, pos[i].y, K.HERO_R, {
        isStatic: true, isSensor: true, restitution: K.REST, friction: 0, frictionStatic: 0,
        frictionAir: K.AIR, label: "hero:" + i
      });
      w.bodies.push(body);
      M.Composite.add(engine.world, body);
    });
    b.enemies.forEach(function (e) {
      if (e.dead) return;
      var body = M.Bodies.circle(e.x, e.y, e.r, {
        isStatic: true, restitution: 1, friction: 0, frictionStatic: 0, label: "enemy:" + e.uid
      });
      w.enemyBodies[e.uid] = body;
      M.Composite.add(engine.world, body);
    });

    M.Events.on(engine, "collisionStart", function (ev) {
      if (w.shooter == null) return;
      var me = w.bodies[w.shooter];
      ev.pairs.forEach(function (pair) {
        var other = pair.bodyA === me ? pair.bodyB : pair.bodyB === me ? pair.bodyA : null;
        if (!other) return;
        var label = other.label || "";
        if (label.indexOf("enemy:") === 0) {
          w.events.push({ type: "hit", enemy: label.slice(6), speed: w.lastSpeed, step: w.stepNo });
        } else if (label.indexOf("hero:") === 0) {
          w.events.push({ type: "ally", ally: +label.slice(5), step: w.stepNo });
        }
      });
    });
    return w;
  }

  // 射出隊員 i：速度 (vx, vy) 以 matter.js 單位（每 16.67ms 的位移）
  function launch(w, i, vx, vy) {
    var M = w.M, body = w.bodies[i];
    M.Body.setStatic(body, false);
    body.isSensor = false;
    M.Body.setInertia(body, Infinity);
    body.frictionAir = K.AIR;
    body.restitution = K.REST;
    body.friction = 0;
    M.Body.setVelocity(body, { x: vx, y: vy });
    w.shooter = i;
    w.lowSteps = 0;
    w.shotSteps = 0;
    w.lastSpeed = Math.sqrt(vx * vx + vy * vy);
  }

  function stopShooter(w) {
    var M = w.M, body = w.bodies[w.shooter];
    M.Body.setVelocity(body, { x: 0, y: 0 });
    M.Body.setStatic(body, true);
    body.isSensor = true;
    w.shooter = null;
  }

  // 前進一個子步，回傳這一步的事件
  function step(w) {
    var M = w.M;
    w.events = [];
    w.stepNo++;
    if (w.shooter != null) w.lastSpeed = speedOf(w.bodies[w.shooter]);
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
    var M = w.M, r = K.HERO_R, p = body.position, v = body.velocity;
    var x = p.x, y = p.y, vx = v.x, vy = v.y, fix = false;
    if (x < r) { x = r; vx = Math.abs(vx); fix = true; }
    if (x > K.FIELD_W - r) { x = K.FIELD_W - r; vx = -Math.abs(vx); fix = true; }
    if (y < r) { y = r; vy = Math.abs(vy); fix = true; }
    if (y > K.FIELD_H - r) { y = K.FIELD_H - r; vy = -Math.abs(vy); fix = true; }
    if (fix) { M.Body.setPosition(body, { x: x, y: y }); M.Body.setVelocity(body, { x: vx, y: vy }); }
  }

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
  function heroPos(w, i) { var p = w.bodies[i].position; return { x: p.x, y: p.y }; }
  function heroVel(w, i) { var v = w.bodies[i].velocity; return { x: v.x, y: v.y }; }
  function isShooting(w) { return w.shooter != null; }

  var api = {
    create: create, launch: launch, step: step, removeEnemy: removeEnemy, moveEnemy: moveEnemy,
    heroPos: heroPos, heroVel: heroVel, isShooting: isShooting, DEFAULT_HERO_POS: DEFAULT_HERO_POS
  };
  root.PriTestShedanPhysics = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
