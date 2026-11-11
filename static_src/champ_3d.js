// 冠軍教練（champ）：3D 關鍵會戰重播（three.js r149，第一次用到時才載入 #cc-app[data-three-src]）。
// 只負責「畫」：簡化的 5v5 地圖（三路、河道、野區、防禦塔、主堡、小龍坑、巴龍坑），10 位英雄模型，
// 依 champ_core.js 的 simGame() 產生的 moments（3〜5 幕）逐幕播放：雙方進場 → 技能交火 → 依序擊殺 → 拿下目標／推掉主堡。
// 字幕與擊殺訊息由 champ.js 透過 hooks 顯示。2026-11-11 依使用者需求新增。
(function () {
  "use strict";

  var D = window.PriTestChampData;
  var loading = null;
  var BLUE = 0x3d8bff, RED = 0xff4d5a;
  var MOMENT_SEC = 6.2;

  function available() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  }
  function load() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (loading) return loading;
    var app = document.getElementById("cc-app"), src = app && app.getAttribute("data-three-src");
    loading = new Promise(function (resolve, reject) {
      if (!src) { reject(new Error("no three src")); return; }
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(window.THREE); };
      s.onerror = function () { loading = null; reject(new Error("three.js load failed")); };
      document.head.appendChild(s);
    });
    return loading;
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  // 藍方主堡在左下（-40, 40），紅方在右上（40, -40）
  var BASE = { blue: [-40, 40], red: [40, -40] };
  function locOf(m, aSide) {
    var winSide = m.winner === "A" ? aSide : (aSide === "blue" ? "red" : "blue");
    var loseSide = winSide === "blue" ? "red" : "blue";
    switch (D.MOMENTS[m.type].loc) {
      case "jungle": return loseSide === "blue" ? [-20, 8] : [20, -8];
      case "bot": return [16, 39];
      case "mid": return [0, 0];
      case "dragon": return [22, 22];
      case "baron": return [-22, -22];
      case "base": var b = BASE[m.type === "defend" ? winSide : loseSide]; return [b[0] * 0.82, b[1] * 0.82];
    }
    return [0, 0];
  }

  function labelSprite(T, text, color) {
    var c = document.createElement("canvas"); c.width = 256; c.height = 64;
    var g = c.getContext("2d");
    g.font = "bold 30px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 6; g.strokeStyle = "rgba(0,0,0,0.75)"; g.strokeText(text, 128, 32);
    g.fillStyle = color || "#fff"; g.fillText(text, 128, 32);
    var tex = new T.CanvasTexture(c);
    var sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(6, 1.5, 1); sp.renderOrder = 10;
    return sp;
  }

  function buildMap(T, scene) {
    var g = new T.Group();
    var ground = new T.Mesh(new T.PlaneGeometry(110, 110), new T.MeshLambertMaterial({ color: 0x3e6b3a }));
    ground.rotation.x = -Math.PI / 2; g.add(ground);
    var laneMat = new T.MeshLambertMaterial({ color: 0x9b8a64 });
    function strip(x1, z1, x2, z2, w, mat, y) {
      var dx = x2 - x1, dz = z2 - z1, len = Math.sqrt(dx * dx + dz * dz);
      var holder = new T.Group();
      var pl = new T.Mesh(new T.PlaneGeometry(len, w), mat);
      pl.rotation.x = -Math.PI / 2;
      holder.add(pl);
      holder.position.set((x1 + x2) / 2, y || 0.02, (z1 + z2) / 2);
      holder.rotation.y = -Math.atan2(dz, dx);
      g.add(holder);
    }
    strip(-40, 44, -40, -40, 8, laneMat); strip(-44, -40, 40, -40, 8, laneMat);   // 上路
    strip(-40, 40, 44, 40, 8, laneMat); strip(40, 44, 40, -40, 8, laneMat);       // 下路
    strip(-38, 38, 38, -38, 8, laneMat);                                          // 中路
    strip(-50, -50, 50, 50, 9, new T.MeshLambertMaterial({ color: 0x3f7fb8 }), 0.03); // 河道
    // 目標坑
    [[22, 22, 0xd08040], [-22, -22, 0x9050c0]].forEach(function (pt) {
      var pit = new T.Mesh(new T.CircleGeometry(6, 28), new T.MeshLambertMaterial({ color: pt[2], transparent: true, opacity: 0.45 }));
      pit.rotation.x = -Math.PI / 2; pit.position.set(pt[0], 0.05, pt[1]); g.add(pit);
    });
    // 野區樹木（避開路與河道）
    var treeMat = new T.MeshLambertMaterial({ color: 0x24502a }), trunkMat = new T.MeshLambertMaterial({ color: 0x5a3e28 });
    var seed = 7;
    function sr() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var i = 0; i < 140; i++) {
      var x = sr() * 84 - 42, z = sr() * 84 - 42;
      if (Math.abs(x + 40) < 6 || Math.abs(z + 40) < 6 || Math.abs(x - 40) < 6 || Math.abs(z - 40) < 6) continue;
      if (Math.abs(x + z) < 8 || Math.abs(x - z) < 9) continue;
      var h = 3 + sr() * 3;
      var tr = new T.Mesh(new T.ConeGeometry(1.6 + sr(), h, 7), treeMat);
      tr.position.set(x, h / 2 + 0.8, z); g.add(tr);
      var tk = new T.Mesh(new T.CylinderGeometry(0.3, 0.35, 1, 6), trunkMat);
      tk.position.set(x, 0.5, z); g.add(tk);
    }
    // 防禦塔與主堡
    var towers = { blue: [], red: [] }, nexus = {};
    var TW = [[-40, 15], [-40, -12], [-14, 14], [-24, 24], [-15, 40], [12, 40]];
    ["blue", "red"].forEach(function (side) {
      var col = side === "blue" ? BLUE : RED, sgn = side === "blue" ? 1 : -1;
      TW.forEach(function (p) {
        var t = new T.Group();
        var body = new T.Mesh(new T.CylinderGeometry(1.1, 1.5, 5, 8), new T.MeshLambertMaterial({ color: 0xb8b8c0 }));
        body.position.y = 2.5; t.add(body);
        var top = new T.Mesh(new T.ConeGeometry(1.5, 2, 8), new T.MeshLambertMaterial({ color: col }));
        top.position.y = 6; t.add(top);
        t.position.set(p[0] * sgn, 0, p[1] * sgn); g.add(t); towers[side].push(t);
      });
      var b = BASE[side];
      var plat = new T.Mesh(new T.CylinderGeometry(9, 10, 0.6, 24), new T.MeshLambertMaterial({ color: side === "blue" ? 0x2a3f66 : 0x662a33 }));
      plat.position.set(b[0], 0.3, b[1]); g.add(plat);
      var nx = new T.Mesh(new T.OctahedronGeometry(2.6), new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.3 }));
      nx.position.set(b[0], 4.2, b[1]); g.add(nx); nexus[side] = nx;
    });
    scene.add(g);
    return { group: g, towers: towers, nexus: nexus };
  }

  function buildFigure(T, heroId, teamCol) {
    var h = D.HERO[heroId], f = new T.Group();
    var body = new T.Mesh(new T.CylinderGeometry(0.55, 0.95, 2.1, 10), new T.MeshLambertMaterial({ color: h ? h.color : 0xffffff }));
    body.position.y = 1.35; f.add(body);
    var skirt = new T.Mesh(new T.ConeGeometry(1.1, 1.0, 10), new T.MeshLambertMaterial({ color: teamCol }));
    skirt.position.y = 0.55; f.add(skirt);
    var head = new T.Mesh(new T.SphereGeometry(0.62, 14, 12), new T.MeshLambertMaterial({ color: 0xffe2cc }));
    head.position.y = 2.85; f.add(head);
    var hair = new T.Mesh(new T.SphereGeometry(0.7, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), new T.MeshLambertMaterial({ color: h ? h.color : 0x333333 }));
    hair.position.set(0, 2.95, -0.08); f.add(hair);
    var tail = new T.Mesh(new T.ConeGeometry(0.35, 1.4, 8), hair.material);
    tail.position.set(0, 2.3, -0.55); tail.rotation.x = 0.4; f.add(tail);
    var weapon = new T.Mesh(new T.BoxGeometry(0.18, 0.18, 1.8), new T.MeshLambertMaterial({ color: 0xe8e8f0, emissive: h ? h.color : 0, emissiveIntensity: 0.4 }));
    weapon.position.set(0.85, 1.7, 0.5); f.add(weapon);
    var ring = new T.Mesh(new T.RingGeometry(1.1, 1.4, 24), new T.MeshBasicMaterial({ color: teamCol, transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; f.add(ring);
    var lab = labelSprite(T, h ? D.L(h.name) : "?", teamCol === BLUE ? "#9cc8ff" : "#ffb0b8");
    lab.position.y = 4.4; f.add(lab);
    f.userData = { body: body, ring: ring, label: lab };
    return f;
  }

  function buildMonster(T, kind) {
    var g = new T.Group(), col = kind === "baron" ? 0x8a3ad0 : kind === "herald" ? 0x6040c0 : kind === "elder" ? 0xd0e0ff : 0xe07030;
    var mat = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25, roughness: 0.6 });
    var size = kind === "baron" || kind === "elder" ? 1.6 : 1.1;
    var body = new T.Mesh(new T.SphereGeometry(2 * size, 16, 12), mat);
    body.scale.set(1.3, 0.8, 1); body.position.y = 2 * size; g.add(body);
    var head = new T.Mesh(new T.ConeGeometry(1 * size, 2.6 * size, 10), mat);
    head.rotation.z = -Math.PI / 2; head.position.set(3 * size, 2.6 * size, 0); g.add(head);
    if (kind !== "herald") {
      [-1, 1].forEach(function (s) {
        var w = new T.Mesh(new T.ConeGeometry(1.4 * size, 3.4 * size, 3), mat);
        w.rotation.x = s * 1.1; w.position.set(-0.5, 3.4 * size, s * 1.8 * size); g.add(w);
      });
    }
    return g;
  }

  function create(container, opts) {
    var T = window.THREE;
    opts = opts || {};
    var lowEnd = (navigator.hardwareConcurrency || 4) <= 4 || /Mobi|Android/i.test(navigator.userAgent);
    var renderer = new T.WebGLRenderer({ antialias: !lowEnd });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : 1.75));
    renderer.outputEncoding = T.sRGBEncoding;
    container.appendChild(renderer.domElement);
    var scene = new T.Scene();
    scene.background = new T.Color(0x0e1424);
    scene.fog = new T.Fog(0x0e1424, 60, 130);
    var camera = new T.PerspectiveCamera(48, 16 / 9, 0.5, 300);
    scene.add(new T.HemisphereLight(0xcfe0ff, 0x30402a, 0.75));
    var sun = new T.DirectionalLight(0xffffff, 0.9); sun.position.set(30, 60, 20); scene.add(sun);
    var map = buildMap(T, scene);

    function resize() {
      var w = container.clientWidth || 640, h = Math.round(w * 9 / 16);
      if (h > window.innerHeight * 0.62) h = Math.round(window.innerHeight * 0.62);
      renderer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener("resize", resize);

    var figs = [], fx = [], monster = null, raf = 0, disposed = false;
    var game = null, aSide = "blue", idx = 0, t0 = 0, cur = null, hooks = {};

    function clearMoment() {
      figs.forEach(function (f) { scene.remove(f.obj); });
      fx.forEach(function (e) { scene.remove(e.obj); });
      figs = []; fx = [];
      if (monster) { scene.remove(monster); monster = null; }
      ["blue", "red"].forEach(function (s) { map.nexus[s].visible = true; map.nexus[s].scale.set(1, 1, 1); });
    }
    function setupMoment(m) {
      clearMoment();
      var c = locOf(m, aSide);
      cur = { m: m, c: c, kills: [], done: {}, lastShot: 0, obj: null };
      ["A", "B"].forEach(function (side) {
        var tside = side === "A" ? aSide : (aSide === "blue" ? "red" : "blue");
        var col = tside === "blue" ? BLUE : RED;
        var b = BASE[tside], dx = b[0] - c[0], dz = b[1] - c[1], len = Math.sqrt(dx * dx + dz * dz) || 1;
        dx /= len; dz /= len;
        var picks = side === "A" ? game.pickA : game.pickB;
        D.ROLES.forEach(function (r, k) {
          var obj = buildFigure(T, picks[r], col);
          var px = -dz, pz = dx, spread = (k - 2) * 2.4;
          var sx = c[0] + dx * 15 + px * spread, sz = c[1] + dz * 15 + pz * spread;
          var ex = c[0] + dx * (4 + (k % 2) * 1.6) + px * spread * 0.8, ez = c[1] + dz * (4 + (k % 2) * 1.6) + pz * spread * 0.8;
          obj.position.set(sx, 0, sz);
          scene.add(obj);
          figs.push({ obj: obj, side: side, role: r, sx: sx, sz: sz, ex: ex, ez: ez, dead: false, deadT: 0, col: D.HERO[picks[r]] ? D.HERO[picks[r]].color : 0xffffff });
        });
      });
      if (m.obj && m.obj !== "nexus") {
        monster = buildMonster(T, m.obj);
        monster.position.set(c[0] + 1, 0, c[1] - 1);
        scene.add(monster);
      }
      // 擊殺的時間點
      var n = m.kills.length;
      m.kills.forEach(function (k, i) { cur.kills.push({ k: k, t: 1.7 + (n > 1 ? (2.9 * i) / (n - 1) : 1.4) }); });
      t0 = performance.now();
      if (hooks.onMoment) hooks.onMoment(idx, m);
    }
    function figOf(side, role) { for (var i = 0; i < figs.length; i++) if (figs[i].side === side && figs[i].role === role) return figs[i]; return null; }
    function shoot(a, b, big) {
      var mat = new T.MeshBasicMaterial({ color: a.col, transparent: true, opacity: 0.95 });
      var o = new T.Mesh(new T.SphereGeometry(big ? 0.55 : 0.32, 8, 6), mat);
      o.position.set(a.obj.position.x, 1.8, a.obj.position.z);
      scene.add(o);
      fx.push({ obj: o, kind: "shot", from: [a.obj.position.x, a.obj.position.z], to: b ? [b.obj.position.x, b.obj.position.z] : [cur.c[0], cur.c[1]], t: 0, dur: 0.32 });
    }
    function burst(x, z, color, r) {
      var o = new T.Mesh(new T.RingGeometry(0.4, 0.9, 28), new T.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false }));
      o.rotation.x = -Math.PI / 2; o.position.set(x, 0.2, z);
      scene.add(o);
      fx.push({ obj: o, kind: "ring", t: 0, dur: 0.7, r: r || 5 });
    }
    function shards(x, y, z, color) {
      for (var i = 0; i < 14; i++) {
        var o = new T.Mesh(new T.TetrahedronGeometry(0.5 + Math.random() * 0.5), new T.MeshBasicMaterial({ color: color }));
        o.position.set(x, y, z); scene.add(o);
        var a = Math.random() * Math.PI * 2, s = 6 + Math.random() * 8;
        fx.push({ obj: o, kind: "shard", t: 0, dur: 1.2, v: [Math.cos(a) * s, 6 + Math.random() * 8, Math.sin(a) * s] });
      }
    }

    function frame(now) {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      if (!cur) { renderer.render(scene, camera); return; }
      var t = (now - t0) / 1000, m = cur.m, c = cur.c;
      // 鏡頭：繞著戰場慢慢轉
      var ang = 0.6 + idx * 1.3 + t * 0.12, rad = 30 - ease(t / 2) * 6;
      camera.position.set(c[0] + Math.cos(ang) * rad, 22 - ease(t / 2) * 4, c[1] + Math.sin(ang) * rad);
      camera.lookAt(c[0], 1.5, c[1]);
      // 進場
      var appr = ease(t / 1.3);
      figs.forEach(function (f, i) {
        if (f.dead) {
          f.deadT += 1 / 60;
          f.obj.rotation.z = Math.min(Math.PI / 2, f.deadT * 5) * (f.side === "A" ? 1 : -1);
          f.obj.position.y = -Math.min(1.2, f.deadT * 0.8);
          return;
        }
        var wob = t > 1.3 ? Math.sin(t * 6 + i) * 0.5 : 0;
        f.obj.position.x = lerp(f.sx, f.ex, appr) + wob * 0.4;
        f.obj.position.z = lerp(f.sz, f.ez, appr) + Math.cos(t * 5 + i) * (t > 1.3 ? 0.3 : 0);
        f.obj.position.y = t < 1.3 ? Math.abs(Math.sin(t * 12 + i)) * 0.25 : 0;
        f.obj.lookAt(c[0], 0, c[1]);
      });
      // 交火
      if (t > 1.2 && t < 5.0 && t - cur.lastShot > 0.11) {
        cur.lastShot = t;
        var alive = figs.filter(function (f) { return !f.dead; });
        if (alive.length) {
          var a = alive[Math.floor(Math.random() * alive.length)];
          var targets = alive.filter(function (f) { return f.side !== a.side; });
          var b = targets.length ? targets[Math.floor(Math.random() * targets.length)] : null;
          if (b || monster) shoot(a, b, Math.random() < 0.15);
          if (Math.random() < 0.12) burst(c[0] + (Math.random() - 0.5) * 8, c[1] + (Math.random() - 0.5) * 8, a.col, 4 + Math.random() * 3);
        }
      }
      // 擊殺
      cur.kills.forEach(function (k, i) {
        if (cur.done[i] || t < k.t) return;
        cur.done[i] = true;
        var vs = k.k.side === "A" ? "B" : "A";
        var v = figOf(vs, k.k.victim), killer = figOf(k.k.side, k.k.killer);
        if (killer && v && !killer.dead) shoot(killer, v, true);
        if (v) { v.dead = true; burst(v.obj.position.x, v.obj.position.z, 0xffffff, 3); }
        if (hooks.onKill) hooks.onKill(k.k);
      });
      // 結尾：拿下目標／主堡爆炸
      if (t > 4.9 && !cur.objDone) {
        cur.objDone = true;
        var winSide = m.winner === "A" ? aSide : (aSide === "blue" ? "red" : "blue");
        if (monster) { burst(c[0], c[1], winSide === "blue" ? BLUE : RED, 9); cur.sinkMonster = true; }
        if (m.obj === "nexus") {
          var lose = winSide === "blue" ? "red" : "blue", nx = map.nexus[lose];
          shards(nx.position.x, nx.position.y, nx.position.z, lose === "blue" ? BLUE : RED);
          burst(nx.position.x, nx.position.z, 0xffffff, 14);
          nx.visible = false;
        }
        if (hooks.onObjective) hooks.onObjective(m);
      }
      if (cur.sinkMonster && monster) { monster.position.y -= 0.05; monster.rotation.y += 0.04; }
      // 特效
      fx = fx.filter(function (e) {
        e.t += 1 / 60;
        var k = e.t / e.dur;
        if (e.kind === "shot") {
          e.obj.position.x = lerp(e.from[0], e.to[0], k); e.obj.position.z = lerp(e.from[1], e.to[1], k);
          e.obj.position.y = 1.8 + Math.sin(k * Math.PI) * 1.2;
        } else if (e.kind === "ring") {
          var s = 1 + k * e.r; e.obj.scale.set(s, s, s); e.obj.material.opacity = 0.9 * (1 - k);
        } else if (e.kind === "shard") {
          e.obj.position.x += e.v[0] / 60; e.obj.position.y += e.v[1] / 60; e.obj.position.z += e.v[2] / 60; e.v[1] -= 0.4;
          e.obj.rotation.x += 0.2; e.obj.rotation.y += 0.15;
        }
        if (k >= 1) { scene.remove(e.obj); return false; }
        return true;
      });
      renderer.render(scene, camera);
      if (t > MOMENT_SEC) next();
    }

    function next() {
      if (!game) return;
      idx++;
      if (idx >= game.moments.length) { var cb = hooks.onDone; game = null; cur = null; if (cb) cb(); return; }
      setupMoment(game.moments[idx]);
    }
    function play(g, h) {
      // g：{ moments, pickA, pickB, aSide }
      game = g; hooks = h || {}; aSide = g.aSide; idx = 0;
      setupMoment(g.moments[0]);
    }
    function skip() { if (!game) return; var cb = hooks.onDone; game = null; cur = null; clearMoment(); if (cb) cb(); }
    function dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      clearMoment();
      try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) { /* ignore */ }
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    raf = requestAnimationFrame(frame);
    return { play: play, next: next, skip: skip, dispose: dispose };
  }

  window.PriTestChamp3D = { available: available, load: load, create: create };
})();
