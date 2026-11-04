// 末日據點（zombie）：夜晚防守的 3D 畫面（three.js r149，第一次進夜晚才載入 #zm-app[data-three-src]）。
// 只負責畫面與點擊：每一影格拿一份快照（zombie_night.js 的 sim.snap() 格式，單機直接取、連線由房主廣播），
// 位置用平滑內插（快照 0.1〜0.25 秒一份，畫面每秒 60 格也不會一頓一頓）。點擊轉成指令交給 opts.onCmd。
(function () {
  "use strict";

  var D = window.PriTestZombieData;
  var N = window.PriTestZombieNight;
  var loading = null;

  function available() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  }
  function load() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (loading) return loading;
    var app = document.getElementById("zm-app"), src = app && app.getAttribute("data-three-src");
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

  // opts：{ onCmd(c), weather, city, light（探照燈）, tower, quality: "high"|"low" }
  function create(box, opts) {
    var T = window.THREE;
    var W0 = box.clientWidth || 640, H0 = box.clientHeight || 420;
    var renderer = new T.WebGLRenderer({ antialias: opts.quality !== "low", preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.quality === "low" ? 1 : 2));
    renderer.setSize(W0, H0);
    renderer.domElement.className = "zm-canvas";
    box.appendChild(renderer.domElement);
    var scene = new T.Scene();
    var bg = opts.weather === "fog" ? 0x3a4250 : 0x0b1222;
    scene.background = new T.Color(bg);
    scene.fog = new T.Fog(bg, opts.weather === "fog" ? 18 : 50, opts.weather === "fog" ? 60 : 110);
    var cam = new T.PerspectiveCamera(48, W0 / H0, 0.5, 300);
    var camAng = 0, camDist = 54, camH = 36;
    function placeCam() {
      cam.position.set(Math.sin(camAng) * camDist * 0.62, camH * camDist / 46, Math.cos(camAng) * camDist * 0.62 + 2);
      cam.lookAt(0, 0, 0);
    }
    placeCam();

    // 光：月光＋核心的暖光；有發電機就多兩盞探照燈
    scene.add(new T.HemisphereLight(0x8899cc, 0x221a14, 0.55));
    var moon = new T.DirectionalLight(0xaabbff, 0.55);
    moon.position.set(-30, 50, 20);
    scene.add(moon);
    var coreLight = new T.PointLight(0xffb060, 1.2, 30);
    coreLight.position.set(0, 5, 0);
    scene.add(coreLight);
    if (opts.light) {
      [[-1, -1], [1, 1]].forEach(function (p) {
        var sl = new T.SpotLight(0xf6f0d0, 1.4, 70, 0.6, 0.5);
        sl.position.set(p[0] * 11, 9, p[1] * 11);
        sl.target.position.set(-p[0] * 6, 0, -p[1] * 6);
        scene.add(sl); scene.add(sl.target);
      });
    }

    var mat = {};
    function M(color, extra) {
      var key = color + JSON.stringify(extra || {});
      if (!mat[key]) { var o = { color: color }; Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; }); mat[key] = new T.MeshLambertMaterial(o); }
      return mat[key];
    }
    // 地面、柏油路、據點內的水泥地
    var ground = new T.Mesh(new T.PlaneGeometry(240, 240), M(0x232a2a));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    var yard = new T.Mesh(new T.PlaneGeometry(N.H * 2, N.H * 2), M(0x4a4a44));
    yard.rotation.x = -Math.PI / 2; yard.position.y = 0.02;
    scene.add(yard);
    [[0, 1], [1, 0]].forEach(function (d) {
      var road = new T.Mesh(new T.PlaneGeometry(d[0] ? 240 : 8, d[0] ? 8 : 240), M(0x1a1d1f));
      road.rotation.x = -Math.PI / 2; road.position.set(d[1] ? 0 : 0, 0.01, 0);
      road.position.z = d[0] ? 26 : 0; road.position.x = d[1] ? -26 : 0;
      scene.add(road);
    });
    // 周圍的城市（依城市種子固定）：大樓、路燈、廢棄車輛
    var r = N.rng(opts.city === "jp" ? 77 : 33);
    for (var i = 0; i < 46; i++) {
      var a = r() * Math.PI * 2, d = 50 + r() * 50, h = 4 + r() * (opts.city === "jp" ? 14 : 22);
      var b = new T.Mesh(new T.BoxGeometry(5 + r() * 7, h, 5 + r() * 7), M([0x2c3036, 0x343238, 0x2a3330, 0x3a3530][i % 4]));
      b.position.set(Math.cos(a) * d, h / 2, Math.sin(a) * d);
      b.rotation.y = r() * Math.PI;
      scene.add(b);
      if (r() < 0.5) {
        var win = new T.Mesh(new T.BoxGeometry(1, 1, 0.1), new T.MeshBasicMaterial({ color: r() < 0.15 ? 0xffd27a : 0x111418 }));
        win.position.set(b.position.x, h * 0.6, b.position.z);
        win.lookAt(0, h * 0.6, 0);
        win.translateZ(3.6);
        scene.add(win);
      }
    }
    for (var c = 0; c < 9; c++) {
      var ca = r() * Math.PI * 2, cd = 20 + r() * 22;
      var car = new T.Mesh(new T.BoxGeometry(4, 1.4, 1.9), M([0x7a2b2b, 0x2b4a7a, 0xb0b0a8, 0x3a3a3a][c % 4]));
      car.position.set(Math.cos(ca) * cd, 0.7, Math.sin(ca) * cd);
      car.rotation.y = r() * Math.PI;
      scene.add(car);
    }

    // 牆段
    var walls = N.SEGS.map(function (S) {
      var m = new T.Mesh(new T.BoxGeometry(N.SEG_LEN - 0.08, 1, 0.7), M(0x8a8478));
      m.position.set(S.x, 1.1, S.z);
      m.rotation.y = S.tx ? 0 : Math.PI / 2;
      m.userData.seg = N.SEGS.indexOf(S);
      scene.add(m);
      return m;
    });
    // 核心（據點的建築）
    var core = new T.Group();
    var hb = new T.Mesh(new T.BoxGeometry(5.4, 3.2, 5.4), M(0xa69a82));
    hb.position.y = 1.6; core.add(hb);
    var roof = new T.Mesh(new T.ConeGeometry(4.4, 1.8, 4), M(0x6e3b2b));
    roof.position.y = 4.1; roof.rotation.y = Math.PI / 4; core.add(roof);
    var sign = new T.Mesh(new T.BoxGeometry(3.2, 0.7, 0.15), new T.MeshBasicMaterial({ color: opts.city === "jp" ? 0x37a845 : 0x2f7de1 }));
    sign.position.set(0, 2.9, 2.75); core.add(sign);
    scene.add(core);
    // 哨位與守衛
    var posts = N.posts(opts.tower || 0).map(function (p) {
      var g = new T.Group();
      var legH = 2.6;
      [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].forEach(function (q) {
        var leg = new T.Mesh(new T.BoxGeometry(0.15, legH, 0.15), M(0x5b4636));
        leg.position.set(q[0], legH / 2, q[1]); g.add(leg);
      });
      var deck = new T.Mesh(new T.BoxGeometry(1.8, 0.2, 1.8), M(0x6f563f));
      deck.position.y = legH; g.add(deck);
      var guard = person(0x3f6fb5);
      guard.position.y = legH + 0.1; g.add(guard);
      g.position.set(p[0], 0, p[1]);
      g.userData.guard = guard;
      scene.add(g);
      return g;
    });
    function person(color) {
      var g = new T.Group();
      var body = new T.Mesh(new T.CylinderGeometry(0.32, 0.36, 1.1, 8), M(color));
      body.position.y = 0.75; g.add(body);
      var head = new T.Mesh(new T.SphereGeometry(0.26, 10, 8), M(0xe0b896));
      head.position.y = 1.5; g.add(head);
      return g;
    }

    // 殭屍（依 id 重用）
    var zMeshes = {}, TY = N.TYPES;
    function zombieMesh(type) {
      var Z = D.ZOMBIES[type], g = new T.Group();
      var glow = { emissive: Z.color, emissiveIntensity: 0.45 };   // 夜裡也看得清楚
      var body = new T.Mesh(new T.CylinderGeometry(0.34, 0.4, 1.1, 7), M(Z.color, glow));
      body.position.y = 0.78; g.add(body);
      var head = new T.Mesh(new T.SphereGeometry(0.27, 8, 6), M(type === "mutant" ? 0x7a1f1f : 0x9db08a));
      head.position.set(0, 1.5, 0.08); g.add(head);
      var arms = new T.Mesh(new T.BoxGeometry(0.95, 0.14, 0.14), M(Z.color, glow));
      arms.position.set(0, 1.15, 0.38); g.add(arms);
      var eye = new T.Mesh(new T.BoxGeometry(0.3, 0.05, 0.05), new T.MeshBasicMaterial({ color: type === "mutant" ? 0xff3030 : 0xd8f080 }));
      eye.position.set(0, 1.55, 0.3); g.add(eye);
      if (type === "screamer") { var mouth = new T.Mesh(new T.SphereGeometry(0.1, 6, 4), new T.MeshBasicMaterial({ color: 0x220000 })); mouth.position.set(0, 1.4, 0.28); g.add(mouth); }
      var hp = new T.Mesh(new T.PlaneGeometry(0.9, 0.09), new T.MeshBasicMaterial({ color: 0xe04040, depthTest: false }));
      hp.position.y = 2.05; hp.renderOrder = 5; g.add(hp);
      g.userData.hp = hp; g.userData.arms = arms;
      g.scale.setScalar(Z.size * 1.45);
      scene.add(g);
      return g;
    }

    // 特效
    var fxs = [], fires = [], decoys = [];
    var lineMat = { 1: new T.LineBasicMaterial({ color: 0xfff1a0 }), 0: new T.LineBasicMaterial({ color: 0x8890a0, transparent: true, opacity: 0.6 }) };
    function addFx(o) {
      if (o.k === "shot") {
        var geo = new T.BufferGeometry().setFromPoints([new T.Vector3(o.x1, o.y1 || 3, o.z1), new T.Vector3(o.x2, 1.2, o.z2)]);
        var ln = new T.Line(geo, lineMat[o.hit ? 1 : 0]);
        scene.add(ln); fxs.push({ obj: ln, life: 0.12, geo: geo });
      } else if (o.k === "die" || o.k === "scream" || o.k === "melee" || o.k === "corehit" || o.k === "decoy" || o.k === "repair" || o.k === "fire" || o.k === "breach") {
        var color = { die: 0x6b3030, scream: 0xff70b0, melee: 0xffffff, corehit: 0xff4020, decoy: 0x40d0ff, repair: 0x70ff90, fire: 0xff8020, breach: 0xff2020 }[o.k];
        var x = o.x, z = o.z;
        if (o.s !== undefined) { x = N.SEGS[o.s].x; z = N.SEGS[o.s].z; }
        var ring = new T.Mesh(new T.RingGeometry(0.2, 0.45, 20), new T.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.9, side: T.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.15, z);
        scene.add(ring);
        fxs.push({ obj: ring, life: o.k === "scream" ? 1 : 0.6, grow: o.k === "scream" ? 14 : o.k === "melee" ? 2 : 4, max: o.k === "scream" ? 1 : 0.6 });
      }
    }
    var fireMat = new T.MeshBasicMaterial({ color: 0xff6a10, transparent: true, opacity: 0.55 });
    var decoyMat = new T.MeshBasicMaterial({ color: 0x40d0ff, transparent: true, opacity: 0.35, side: T.DoubleSide });
    function syncList(list, arr, make) {
      while (list.length < arr.length) list.push(make());
      for (var i = 0; i < list.length; i++) {
        var on = i < arr.length;
        list[i].visible = on;
        if (on) list[i].position.set(arr[i][0] / 10, 0.1, arr[i][1] / 10);
      }
    }
    // 雨
    var rain = null;
    if (opts.weather === "rain" && opts.quality !== "low") {
      var rg = new T.BufferGeometry(), pts = new Float32Array(900 * 3);
      for (var k = 0; k < 900; k++) { pts[k * 3] = (r() - 0.5) * 90; pts[k * 3 + 1] = r() * 40; pts[k * 3 + 2] = (r() - 0.5) * 90; }
      rg.setAttribute("position", new T.BufferAttribute(pts, 3));
      rain = new T.Points(rg, new T.PointsMaterial({ color: 0x8fb0d0, size: 0.18, transparent: true, opacity: 0.7 }));
      scene.add(rain);
    }
    // 點擊位置的標記
    var marker = new T.Mesh(new T.RingGeometry(0.6, 0.8, 24), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: T.DoubleSide }));
    marker.rotation.x = -Math.PI / 2; marker.visible = false; scene.add(marker);
    var markerLife = 0;

    // ---- 每一影格 ----
    var snap = null, seen = -1, lastT = performance.now(), disposed = false, raf = 0;
    function setSnap(sn) {
      snap = sn;
      if (!sn) return;
      // 特效只放一次（快照可能重複帶到同一個時間點的特效）
      var top = seen;
      (sn.fx || []).forEach(function (o) { if (o.t > seen) { addFx(o); if (o.t > top) top = o.t; } });
      seen = top;
    }
    function frame() {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      var now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      if (snap) {
        var alive = {};
        snap.z.forEach(function (z) {
          var id = z[0], type = TY[z[1]], x = z[2] / 10, zz = z[3] / 10;
          alive[id] = 1;
          var m = zMeshes[id];
          if (!m) { m = zMeshes[id] = zombieMesh(type); m.position.set(x, 0, zz); }
          var k = Math.min(1, dt * 10);
          var px = m.position.x, pz = m.position.z;
          m.position.x += (x - px) * k; m.position.z += (zz - pz) * k;
          var moving = Math.abs(x - px) + Math.abs(zz - pz) > 0.004;
          m.rotation.y = Math.atan2(-m.position.x, -m.position.z);
          m.userData.walk = (m.userData.walk || 0) + dt * (moving ? 7 : 2);
          m.position.y = moving ? Math.abs(Math.sin(m.userData.walk)) * 0.12 : 0;
          m.userData.arms.position.z = 0.38 + (z[5] ? Math.sin(m.userData.walk * 2) * 0.15 : 0);
          m.userData.hp.scale.x = Math.max(0.02, z[4] / 100);
          m.userData.hp.visible = z[4] < 100;
          m.userData.hp.lookAt(cam.position);
        });
        Object.keys(zMeshes).forEach(function (id) { if (!alive[id]) { scene.remove(zMeshes[id]); delete zMeshes[id]; } });
        snap.w.forEach(function (hp, i) {
          var ratio = snap.wm ? hp / snap.wm : 0, m = walls[i];
          m.scale.y = Math.max(0.12, ratio * 2.2);
          m.position.y = m.scale.y / 2;
          m.material = M(ratio <= 0 ? 0x3a1a1a : ratio < 0.35 ? 0xa04a3a : ratio < 0.7 ? 0x9a8a62 : 0x8a8478);
        });
        posts.forEach(function (p, i) {
          var aim = snap.g && snap.g[i], zm = aim && zMeshes[aim];
          if (zm) p.userData.guard.rotation.y = Math.atan2(zm.position.x - p.position.x, zm.position.z - p.position.z);
          p.userData.guard.visible = !snap.g || i < snap.g.length;
        });
        syncList(fires, snap.f || [], function () { var f = new T.Mesh(new T.CircleGeometry(N.FIRE_R, 20), fireMat); f.rotation.x = -Math.PI / 2; scene.add(f); return f; });
        syncList(decoys, snap.d || [], function () { var f = new T.Mesh(new T.RingGeometry(N.DECOY_R - 0.4, N.DECOY_R, 40), decoyMat); f.rotation.x = -Math.PI / 2; scene.add(f); return f; });
        coreLight.intensity = 1 + Math.sin(now / 120) * 0.08 + (snap.c < 40 ? Math.sin(now / 60) * 0.4 : 0);
      }
      fires.forEach(function (f) { if (f.visible) f.scale.setScalar(0.92 + Math.sin(now / 70 + f.position.x) * 0.08); });
      fxs = fxs.filter(function (e) {
        e.life -= dt;
        if (e.grow) { e.obj.scale.setScalar(1 + (e.max - e.life) * e.grow); e.obj.material.opacity = Math.max(0, e.life / e.max); }
        if (e.life <= 0) { scene.remove(e.obj); if (e.geo) e.geo.dispose(); if (e.obj.material && e.grow) e.obj.material.dispose(); return false; }
        return true;
      });
      if (rain) {
        var pa = rain.geometry.attributes.position;
        for (var q = 0; q < pa.count; q++) { var y = pa.getY(q) - dt * 30; pa.setY(q, y < 0 ? 40 : y); }
        pa.needsUpdate = true;
      }
      if (markerLife > 0) { markerLife -= dt; marker.visible = markerLife > 0; marker.scale.setScalar(1 + (0.4 - markerLife)); }
      renderer.render(scene, cam);
    }
    raf = requestAnimationFrame(frame);

    // ---- 點擊：拖曳＝轉視角、點一下＝依工具下指令 ----
    var tool = "shoot", ray = new T.Raycaster(), down = null;
    function groundAt(ev) {
      var rc = renderer.domElement.getBoundingClientRect();
      var v = new T.Vector2(((ev.clientX - rc.left) / rc.width) * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1);
      ray.setFromCamera(v, cam);
      var p = new T.Vector3();
      ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), p);
      return p;
    }
    function tap(ev) {
      var p = groundAt(ev);
      if (!p) return;
      marker.position.set(p.x, 0.12, p.z); markerLife = 0.4;
      var c = null;
      if (tool === "fire" || tool === "decoy") c = { a: tool, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 };
      else if (tool === "repair") c = { a: "repair", seg: N.nearestSeg(p.x, p.z) };
      else {
        // 射擊：用螢幕距離找點下去附近（約 40 px 內）最近的殭屍，遠處的小殭屍也點得到
        var best = null, bd = 42 * 42, rc = renderer.domElement.getBoundingClientRect();
        Object.keys(zMeshes).forEach(function (id) {
          var m = zMeshes[id], v = new T.Vector3(m.position.x, 1 * m.scale.y, m.position.z).project(cam);
          var sx = rc.left + (v.x + 1) / 2 * rc.width, sy = rc.top + (1 - v.y) / 2 * rc.height;
          var dx = sx - ev.clientX, dy = sy - ev.clientY, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = +id; }
        });
        if (best) c = { a: "shoot", id: best };
        else if (Math.abs(N.outside(p.x, p.z)) < 1.4) c = { a: "repair", seg: N.nearestSeg(p.x, p.z) };
      }
      if (c && opts.onCmd) opts.onCmd(c);
    }
    function onDown(ev) { down = { x: ev.clientX, y: ev.clientY, ang: camAng, moved: false }; }
    function onMove(ev) {
      if (!down) return;
      var dx = ev.clientX - down.x;
      if (Math.abs(dx) > 8 || Math.abs(ev.clientY - down.y) > 8) down.moved = true;
      if (down.moved) { camAng = down.ang - dx * 0.008; placeCam(); }
    }
    function onUp(ev) { if (down && !down.moved) tap(ev); down = null; }
    var el = renderer.domElement;
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", function () { down = null; });
    el.addEventListener("wheel", function (ev) { ev.preventDefault(); camDist = Math.max(26, Math.min(70, camDist + ev.deltaY * 0.03)); placeCam(); }, { passive: false });
    function resize() {
      var w = box.clientWidth || W0, h = box.clientHeight || H0;
      renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);

    return {
      setSnap: setSnap,
      setTool: function (t) { tool = t; },
      zoom: function (d) { camDist = Math.max(26, Math.min(70, camDist + d)); placeCam(); },
      rotate: function (d) { camAng += d; placeCam(); },
      // 測試用：把畫面上的點（殭屍 id 或牆段）換成螢幕座標
      screenOf: function (x, z) {
        var v = new T.Vector3(x, 0.8, z).project(cam), rc = renderer.domElement.getBoundingClientRect();
        return { x: rc.left + (v.x + 1) / 2 * rc.width, y: rc.top + (1 - v.y) / 2 * rc.height };
      },
      zombiePos: function (id) { var m = zMeshes[id]; return m ? { x: m.position.x, z: m.position.z } : null; },
      dispose: function () {
        disposed = true; cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }

  window.PriTestZombie3D = { available: available, load: load, create: create };
})();
