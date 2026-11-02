// 賽狗賽狗（saigo）：真賽狗模式的 3D 轉播（three.js）。模擬在 saigo_real.js。
// 場景：夜間照明的橢圓沙地跑道、內欄與機械兔（誘餌）、8 格出發閘箱、主看台、照明塔、終點。
// 狗：沿用 saigo_3d.js 的犬模型，另外穿上枠色的賽犬背心（號碼）與口罩——真實賽狗的裝備。
// 介面與關卡賽的畫面相同：create(container, card, result, opts) → { frame, refresh, setCam, cam, resize, dispose }
(function () {
  "use strict";

  var D = window.PriTestSaigoData;
  var Core = window.PriTestSaigoCore;
  var Real = window.PriTestSaigoReal;
  var M = Core.MODE;
  function V3() { return window.PriTestSaigo3D; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  function sandColor(card) {
    var wet = { firm: 0, good: 0.12, soft: 0.25, heavy: 0.38 }[card.ground] || 0;
    var snow = card.weather === "snow" || card.weather === "blizzard";
    if (snow) return "#e8eef2";
    var c = [0.8, 0.64, 0.42];
    return "rgb(" + c.map(function (v) { return Math.round(v * (1 - wet) * 255); }).join(",") + ")";
  }

  function create(container, card, result, opts) {
    var T = window.THREE, K = V3().kit;
    opts = opts || {};
    var hi = opts.quality !== "low";
    var renderer = new T.WebGLRenderer({ antialias: hi });
    renderer.setPixelRatio(hi ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    renderer.shadowMap.enabled = hi;
    container.appendChild(renderer.domElement);
    renderer.domElement.className = "sg-canvas";
    var fogW = card.weather === "fog" ? [30, 140] : card.weather === "rain" || card.weather === "typhoon" ? [70, 260] : [140, 520];
    var scene = new T.Scene();
    scene.background = new T.Color(0x0d1832);
    scene.fog = new T.Fog(0x0d1832, fogW[0], fogW[1]);
    scene.add(new T.HemisphereLight(0xcfd8ff, 0x223322, 0.75));
    var sun = new T.DirectionalLight(0xfff4e0, 0.85);
    sun.position.set(20, 80, 30); sun.castShadow = hi;
    sun.shadow.mapSize.set(1024, 1024);
    var sc = sun.shadow.camera; sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 200;
    scene.add(sun); scene.add(sun.target);

    var LAP = Real.LAP, Wd = Real.W;
    function XY(ts, x) { var p = Real.trackXY(ts, x); return { x: p.x, z: p.y, h: p.h }; }
    function P(s, x) { return XY(Real.trackPos(card, s), x); }

    // 地面（內場草地＋外圍）
    var ground = new T.Mesh(new T.PlaneGeometry(900, 900), new T.MeshStandardMaterial({ color: card.weather === "snow" || card.weather === "blizzard" ? 0xdfe6ea : 0x2f5a2c, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; scene.add(ground);

    // 沙地跑道（沿跑道每 1 m 一段的帶狀網格）
    (function () {
      var pos = [], idx = [], N = Math.ceil(LAP);
      for (var i = 0; i <= N; i++) {
        var ts = i * LAP / N, a = XY(ts, -0.7), b = XY(ts, Wd + 0.7);
        pos.push(a.x, 0, a.z, b.x, 0, b.z);
        if (i < N) { var k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      var g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      var m = new T.Mesh(g, new T.MeshStandardMaterial({ color: sandColor(card), roughness: 1, side: T.DoubleSide }));
      m.receiveShadow = true; scene.add(m);
    })();
    // 欄杆：內欄（白）、外欄（白）、機械兔的軌道（內欄內側）
    function ring(x, y, r, color) {
      var pts = [];
      for (var i = 0; i < 200; i++) { var p = XY(i * LAP / 200, x); pts.push(new T.Vector3(p.x, y, p.z)); }
      var tube = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts, true), 400, r, 6, true), K.mat(T, color));
      scene.add(tube);
    }
    ring(-0.75, 0.85, 0.05, "#f5f5f5");
    ring(Wd + 0.8, 1.0, 0.06, "#f5f5f5");
    ring(-1.15, 0.25, 0.04, "#9e9e9e");
    var posts = [], posts2 = [];
    for (var pi = 0; pi < LAP; pi += 4) { var pa = XY(pi, -0.75), pb = XY(pi, Wd + 0.8); posts.push([pa.x, pa.z, 1]); posts2.push([pb.x, pb.z, 1]); }
    K.instanced(T, scene, new T.CylinderGeometry(0.04, 0.04, 0.85, 5), K.mat(T, "#eeeeee"), posts, function () { return 0.42; });
    K.instanced(T, scene, new T.CylinderGeometry(0.05, 0.05, 1.0, 5), K.mat(T, "#eeeeee"), posts2, function () { return 0.5; });

    // 終點線與終點柱
    (function () {
      var a = XY(Real.FINISH, -0.7), b = XY(Real.FINISH, Wd + 0.7);
      var line = new T.Mesh(new T.PlaneGeometry(Wd + 1.4, 0.3), K.mat(T, "#ffffff"));
      line.rotation.x = -Math.PI / 2; line.rotation.z = -Math.PI / 2;
      line.position.set((a.x + b.x) / 2, 0.02, (a.z + b.z) / 2); scene.add(line);
      var pole = K.mesh(T, new T.CylinderGeometry(0.12, 0.12, 6, 8), K.mat(T, "#d32f2f"), true); pole.position.set(b.x, 3, b.z - 1.2); scene.add(pole);
      var disk = K.mesh(T, new T.CylinderGeometry(0.9, 0.9, 0.12, 20), K.mat(T, "#ffffff")); disk.rotation.x = Math.PI / 2; disk.position.set(b.x, 6, b.z - 1.2); scene.add(disk);
    })();

    // 出發閘箱（8 格）：每格放在該枠的起跑位置、朝跑道方向；門在比賽開始時往上掀
    var doors = [];
    (function () {
      var box = K.mat(T, "#eceff1"), dark = K.mat(T, "#263238");
      for (var i = 0; i < 8; i++) {
        var c = P(-0.9, Real.trapX(i)), cell = new T.Group();
        cell.position.set(c.x, 0, c.z); cell.rotation.y = -c.h; scene.add(cell);
        [-1, 1].forEach(function (sd) { var wl = K.mesh(T, new T.BoxGeometry(1.8, 1.2, 0.05), box, true); wl.position.set(0, 0.6, 0.47 * sd); cell.add(wl); });
        var roof = K.mesh(T, new T.BoxGeometry(1.8, 0.06, 0.98), box); roof.position.set(0, 1.2, 0); cell.add(roof);
        var back = K.mesh(T, new T.BoxGeometry(0.06, 1.2, 0.95), dark); back.position.set(-0.9, 0.6, 0); cell.add(back);
        var door = new T.Group(); door.position.set(0.9, 1.2, 0); cell.add(door);
        var leaf = new T.Mesh(new T.PlaneGeometry(0.9, 1.15), new T.MeshStandardMaterial({ map: K.numberTex(T, i, false), roughness: 0.8, side: T.DoubleSide }));
        leaf.rotation.y = Math.PI / 2; leaf.position.set(0, -0.58, 0); door.add(leaf);
        doors.push(door);
      }
    })();

    // 主看台（主直道外側）＋觀眾、照明塔
    (function () {
      var zc = -(Real.R + Wd + 13);
      var conc = K.mat(T, "#90a4ae"), roofM = K.mat(T, "#37474f");
      for (var k = 0; k < 4; k++) {
        var tier = K.mesh(T, new T.BoxGeometry(110, 1.2, 3), conc, true); tier.position.set(0, 0.6 + k * 1.2, zc - k * 3); scene.add(tier);
      }
      var roof = K.mesh(T, new T.BoxGeometry(114, 0.4, 16), roofM); roof.position.set(0, 9, zc - 5); scene.add(roof);
      var crowd = [], cols = ["#e53935", "#1e88e5", "#fdd835", "#43a047", "#fafafa", "#8e24aa", "#ff7043"];
      for (var c = 0; c < (hi ? 520 : 220); c++) {
        var row = Math.floor(Math.random() * 4);
        crowd.push([-52 + Math.random() * 104, zc - row * 3 + (Math.random() - 0.5), 1, row]);
      }
      cols.forEach(function (col, ci) {
        var part = crowd.filter(function (q, n) { return n % cols.length === ci; });
        K.instanced(T, scene, new T.BoxGeometry(0.45, 0.9, 0.35), K.mat(T, col), part, function (q) { return 1.65 + q[3] * 1.2; });
      });
      // 大螢幕（內場）
      var board = K.mesh(T, new T.BoxGeometry(16, 7, 0.5), K.mat(T, "#111")); board.position.set(0, 6, Real.R * 0.35); scene.add(board);
      var scr = new T.Mesh(new T.PlaneGeometry(15, 6), new T.MeshBasicMaterial({ color: 0x1565c0 })); scr.position.set(0, 6, Real.R * 0.35 - 0.26); scr.rotation.y = Math.PI; scene.add(scr);
      var lampM = new T.MeshBasicMaterial({ color: 0xfff8e1 });
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) {
        var x = q[0] * (Real.LS / 2 + Real.R + Wd + 8), z = q[1] * (Real.R + Wd + 8);
        var pole = K.mesh(T, new T.CylinderGeometry(0.3, 0.45, 24, 8), K.mat(T, "#78909c"), true); pole.position.set(x, 12, z); scene.add(pole);
        var head = new T.Mesh(new T.BoxGeometry(4, 2.2, 0.6), lampM); head.position.set(x, 24.5, z); head.lookAt(0, 0, 0); scene.add(head);
      });
    })();

    // 機械兔（誘餌）
    var lure = new T.Group();
    (function () {
      var fur = K.mat(T, "#d7ccc8"), arm = K.mat(T, "#616161");
      var body = K.mesh(T, new T.SphereGeometry(0.22, 10, 8), fur, true); body.scale.set(1.4, 1, 1); lure.add(body);
      var head = K.mesh(T, new T.SphereGeometry(0.13, 8, 6), fur); head.position.set(0.28, 0.08, 0); lure.add(head);
      [-1, 1].forEach(function (s) { var ear = K.mesh(T, new T.ConeGeometry(0.04, 0.22, 5), fur); ear.position.set(0.25, 0.28, 0.05 * s); lure.add(ear); });
      var tail = K.mesh(T, new T.SphereGeometry(0.08, 6, 4), K.mat(T, "#ffffff")); tail.position.set(-0.32, 0.05, 0); lure.add(tail);
      var stick = K.mesh(T, new T.BoxGeometry(0.05, 0.05, 0.9), arm); stick.position.set(0, -0.05, 0.45); lure.add(stick);
      scene.add(lure);
    })();

    // 狗：背心（枠色＋號碼）與口罩
    var n = card.dogs.length;
    var dogs = card.dogs.map(function (d, i) {
      var m = K.buildDog(T, d.breed, i);
      var coatM = new T.MeshStandardMaterial({ color: D.GATE_COLORS[i], roughness: 0.8 });
      var coat = K.mesh(T, new T.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), coatM, true);
      coat.scale.set(0.34, 0.24, 0.215); coat.position.set(-0.02, 0.0, 0); m.body.add(coat);
      var numM = new T.MeshStandardMaterial({ map: K.numberTex(T, i, true), transparent: true, roughness: 0.8 });
      [-1, 1].forEach(function (s2) { var num = new T.Mesh(new T.CircleGeometry(0.1, 16), numM); num.position.set(-0.04, 0.03, 0.217 * s2); if (s2 < 0) num.rotation.y = Math.PI; m.body.add(num); });
      var muz = K.mesh(T, new T.CylinderGeometry(0.075, 0.06, 0.2, 6, 1, true), new T.MeshStandardMaterial({ color: 0x212121, wireframe: true }));
      muz.rotation.z = Math.PI / 2; muz.position.set(0.22, -0.03, 0); m.head.add(muz);
      scene.add(m.root);
      var tag = new T.Sprite(new T.SpriteMaterial({ map: K.numberTex(T, i, true), depthTest: false, transparent: true, sizeAttenuation: false }));
      tag.scale.set(0.033, 0.033, 1); tag.renderOrder = 10; scene.add(tag); m.tag = tag;
      var glow = new T.Mesh(new T.TorusGeometry(0.75, 0.06, 6, 24), new T.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.8 }));
      glow.rotation.x = Math.PI / 2; glow.visible = false; scene.add(glow); m.glow = glow;
      return m;
    });

    // 由結果推出的畫面資料（改跑法／喊聲重新模擬後 refresh 重算）
    var finV, skillEv, fx = K.skillFx(T, scene, n);
    function derive() {
      fx.set(K.skillFxEvents(result, n, 1));
      finV = card.dogs.map(function (d, i) {
        var tf = result.times[i];
        if (tf === null) return 0;
        var k = clamp(Math.round(tf / result.dt) - 2, 0, result.frames.length - 1);
        return result.frames[k][i * 4 + 2];
      });
      skillEv = [];
      for (var i = 0; i < n; i++) skillEv.push([]);
      (result.events || []).forEach(function (e) {
        if (e.k === "shoutHeal" && e.d >= 0) skillEv[e.d].push({ t: e.t, c: 0xff80ab });
      });
    }
    derive();

    // 天氣粒子（雨／雪）
    var particles = null, pvel = null;
    if (card.weather === "rain" || card.weather === "typhoon" || card.weather === "snow" || card.weather === "blizzard") {
      var snowy = card.weather === "snow" || card.weather === "blizzard";
      pvel = snowy ? [card.weather === "blizzard" ? 6 : 0, -3, 0] : [card.weather === "typhoon" ? 8 : 0, -22, 0];
      var cnt = hi ? 3000 : 1200, pp = [];
      for (var q = 0; q < cnt; q++) pp.push((Math.random() - 0.5) * 80, Math.random() * 30, (Math.random() - 0.5) * 80);
      var pg = new T.BufferGeometry(); pg.setAttribute("position", new T.Float32BufferAttribute(pp, 3));
      particles = new T.Points(pg, new T.PointsMaterial(snowy ? { color: 0xffffff, size: 0.2 } : { color: 0xc8d6e5, size: 0.08, transparent: true, opacity: 0.7 }));
      scene.add(particles);
    }

    var camera = new T.PerspectiveCamera(50, 1, 0.1, 1500);
    var cam = { mode: "tv", dog: 0, shot: null, pos: new T.Vector3(), tgt: new T.Vector3(), snap: true };
    var lastT = 0, L = card.length;

    function dogPos(i, t, st) {
      var s = st.s, x = st.x, tf = result.times[i];
      if (tf !== null && t > tf) { var dtf = t - tf, v0 = finV[i], stopT = v0 / 3, e = Math.min(dtf, stopT); s = L + v0 * e - 1.5 * e * e; }
      var p = P(s, x);
      return { x: p.x, z: p.z, h: p.h, s: s, off: x };
    }

    var SHOTS = ["side", "heli", "front", "side", "chase", "bend"];
    function pickShot(t, rank, ps) {
      if (t < 3) return { type: "start", until: 3 };
      if (L - ps[rank[0]].s < 70) return { type: "finish", until: Infinity };
      var idx = Math.floor(t / 4.5);
      return { type: SHOTS[idx % SHOTS.length], until: (idx + 1) * 4.5 };
    }
    function updateCamera(t, dt, rank, ps) {
      var pos, tgt, fov = 50, lead = rank[0];
      var pack = (ps[rank[0]].s + ps[rank[1]].s + ps[rank[2]].s) / 3, mid = ps[rank[Math.min(3, n - 1)]].off;
      if (cam.mode === "tv") {
        if (!cam.shot || t >= cam.shot.until || t < lastT - 0.5) { cam.shot = pickShot(t, rank, ps); cam.snap = true; }
        var sh = cam.shot.type;
        if (sh === "start") { var a = P(-7, 4); pos = [a.x, 2.6, a.z]; var b = P(8, 3); tgt = [b.x, 0.6, b.z]; fov = 55; }
        else if (sh === "finish") { var f = XY(Real.FINISH + 1, Wd + 6); pos = [f.x, 3, f.z]; var lp = ps[lead]; tgt = [lp.x, 0.6, lp.z]; fov = 36; }
        else if (sh === "side") { var sd = P(pack + 2, Wd + 14); pos = [sd.x, 4, sd.z]; var c2 = P(pack, mid); tgt = [c2.x, 0.6, c2.z]; fov = 42; }
        else if (sh === "heli") { var hp = P(pack - 20, Wd + 10); pos = [hp.x, 20, hp.z]; var c3 = P(pack + 4, 2); tgt = [c3.x, 0, c3.z]; fov = 50; }
        else if (sh === "front") { var fp = P(ps[lead].s + 13, 2.5); pos = [fp.x, 1.5, fp.z]; var c4 = P(pack - 3, 2); tgt = [c4.x, 0.5, c4.z]; fov = 45; }
        else if (sh === "bend") { pos = [0, 26, 0]; var c5 = P(pack, 2); tgt = [c5.x, 0, c5.z]; fov = 40; }
        else { var me = ps[lead], cp = P(me.s - 7, me.off + 1); pos = [cp.x, 2.6, cp.z]; tgt = [me.x, 0.6, me.z]; fov = 55; }
      } else if (cam.mode === "chase") {
        var i = cam.dog, d = ps[i], S = dogs[i].S, back = P(d.s - (3 + 3 * S), d.off);
        pos = [back.x, 1.0 + 1.4 * S, back.z]; var ah = P(d.s + 6, d.off); tgt = [ah.x, 0.4 * S, ah.z]; fov = 60;
      } else if (cam.mode === "pov") {
        var j = cam.dog, dj = ps[j], Sj = dogs[j].S, hy = dogs[j].body.position.y * Sj + 0.3 * Sj;
        var eye = P(dj.s + 0.55 * Sj, dj.off); pos = [eye.x, hy, eye.z]; var fw = P(dj.s + 12, dj.off); tgt = [fw.x, hy * 0.7, fw.z]; fov = 78;
      } else { pos = [0, 95, -10]; tgt = [0, 0, 0]; fov = 60; }
      var k = cam.snap || cam.mode === "pov" ? 1 : 1 - Math.exp(-dt * (cam.mode === "chase" ? 8 : 3));
      cam.pos.set(cam.pos.x + (pos[0] - cam.pos.x) * k, cam.pos.y + (pos[1] - cam.pos.y) * k, cam.pos.z + (pos[2] - cam.pos.z) * k);
      cam.tgt.set(cam.tgt.x + (tgt[0] - cam.tgt.x) * k, cam.tgt.y + (tgt[1] - cam.tgt.y) * k, cam.tgt.z + (tgt[2] - cam.tgt.z) * k);
      cam.snap = false;
      camera.position.copy(cam.pos); camera.lookAt(cam.tgt);
      if (Math.abs(camera.fov - fov) > 0.1) { camera.fov = fov; camera.updateProjectionMatrix(); }
      sun.position.set(cam.tgt.x + 20, 80, cam.tgt.z + 30); sun.target.position.copy(cam.tgt);
    }

    function frame(t, dt) {
      var st = Real.stateAt(result, Math.max(0, t)), rank = Real.rankAt(result, Math.max(0, t)), ps = [];
      for (var i = 0; i < n; i++) {
        var d = dogs[i], s = st[i] || { s: 0, x: Real.trapX(i), v: 0, mode: M.wait };
        var p = dogPos(i, t, s);
        ps.push(p);
        var v = s.v;
        if (result.times[i] !== null && t > result.times[i]) v = Math.max(0, finV[i] - 3 * (t - result.times[i]));
        if (t < 0) v = 0;
        var mode = s.mode === M.fin ? M.run : s.mode;
        d.root.position.set(p.x, 0, p.z);
        d.root.rotation.set(0, -p.h, 0);
        K.animateDog(d, v, mode, null, t, dt);
        d.root.visible = !(cam.mode === "pov" && cam.dog === i);
        d.tag.visible = cam.mode !== "pov" && !(cam.mode === "chase" && cam.dog === i);
        d.tag.position.set(p.x, d.S * 1.45 + 0.45, p.z);
        // 喊聲成功：腳下亮一圈粉紅（技能的特效在 fx）
        var gl = null;
        skillEv[i].forEach(function (e) { if (t >= e.t && t < e.t + 1.2) gl = e; });
        d.glow.visible = !!gl;
        if (gl) {
          var u = (t - gl.t) / 1.2;
          d.glow.material.color.setHex(gl.c); d.glow.material.opacity = 0.9 * (1 - u);
          d.glow.position.set(p.x, 0.08 + u * 0.6, p.z); d.glow.scale.setScalar((0.7 + u * 0.8) * Math.max(0.7, d.S));
        }
      }
      // 閘門：開跑時掀起
      doors.forEach(function (dr) { dr.rotation.z = t >= 0 ? -Math.min(1.6, t * 6) : 0; });
      // 機械兔：開跑前從後面跑過閘箱，開跑後保持在領先的狗前面約 10 m
      var leadS = ps[rank[0]].s, ls = Math.max(10 + t * 17, leadS + 9);
      if (ls > leadS + 15) ls = leadS + 15;
      if (t < 0) ls = 10 + t * 17;
      var lp = P(ls, -1.15);
      lure.position.set(lp.x, 0.42 + Math.abs(Math.sin(t * 9)) * 0.06, lp.z); lure.rotation.set(0, -lp.h, 0);
      lure.visible = !(result.times[rank[0]] !== null && t > result.times[rank[0]] + 3);
      if (particles) {
        var pa = particles.geometry.attributes.position, arr = pa.array;
        for (var q = 0; q < arr.length; q += 3) {
          arr[q] += pvel[0] * dt; arr[q + 1] += pvel[1] * dt;
          if (arr[q + 1] < 0) arr[q + 1] += 30;
          if (arr[q] > 40) arr[q] -= 80;
        }
        pa.needsUpdate = true;
        particles.position.set(cam.pos.x, 0, cam.pos.z);
      }
      fx.update(t, ps, dogs.map(function (d) { return d.S; }));
      updateCamera(t, dt, rank, ps);
      lastT = t;
      renderer.render(scene, camera);
      return { rank: rank, ps: ps, shot: cam.mode === "tv" && cam.shot ? cam.shot.type : cam.mode };
    }

    function resize() {
      var w = container.clientWidth || 640, h = container.clientHeight || 360;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener("resize", resize);
    return {
      frame: frame, resize: resize, refresh: derive,
      setCam: function (mode, dog) { cam.mode = mode; if (dog !== undefined) cam.dog = dog; cam.snap = true; cam.shot = null; },
      cam: function () { return { mode: cam.mode, dog: cam.dog }; },
      dispose: function () {
        window.removeEventListener("resize", resize);
        scene.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { if (m.map) m.map.dispose(); m.dispose(); }); }
        });
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }

  window.PriTestSaigoReal3D = { create: create };
})();
