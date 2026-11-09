// 深夜居酒屋（izakaya）：3D 店內（three.js r149，第一次進入營業才載入 #iz-app[data-three-src]）。
// 只負責畫面與點擊：每一影格向 opts.getState() 拿狀態（單機是本機狀態、連線是房主廣播的快照）。
// 店內：木地板、吧台 6 席（★2 起多一張 4 人桌）、紅燈籠、暖簾、酒架、吧台內側五個工作站（串燒爐／油鍋／煮物鍋／冷檯／酒檯）。
// 客人是「照片立牌」：簡單的身體＋永遠面向鏡頭的照片（照片一律用 Core.photoOf 取得，每局輪換）。
// 尖峰時顯示耐心條、可上菜的盤子、各工作站的烹調進度環（快焦時閃紅）。點座位／工作站 → opts.onPick。
(function () {
  "use strict";
  var D = window.PriTestIzakayaData;
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
    var app = document.getElementById("iz-app"), src = app && app.getAttribute("data-three-src");
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
  function hash(a, b) { var h = Math.imul(a * 374761393 + b * 668265263, 1274126177); h ^= h >>> 13; return ((Math.imul(h, 1103515245) >>> 0) % 10000) / 10000; }

  // 座位位置：0〜5 吧台、6〜9 四人桌
  var SEATS = [[-2.5, 1.45], [-1.5, 1.45], [-0.5, 1.45], [0.5, 1.45], [1.5, 1.45], [2.5, 1.45], [4.0, 1.4], [5.0, 1.4], [4.0, 2.6], [5.0, 2.6]];
  var STATION_X = { grill: -2.4, fry: -1.2, pot: 0, cold: 1.2, bar: 2.4 };
  var CAT_COLOR = { yakitori: 0x8b4a1c, sashimi: 0xe8584f, nimono: 0xc89a5a, agemono: 0xe0a33a, kobachi: 0x6fae5a, meshi: 0xf4efe2, drink: 0xf2c94c };

  // opts：{ getState(), getUi() → { hiSeat, hiSlot }, onPick(kind, a, b), imgBase, quality }
  function create(box, opts) {
    var T = window.THREE, low = opts.quality === "low";
    var Core = window.PriTestIzakayaCore, Rush = window.PriTestIzakayaRush;
    var W0 = box.clientWidth || 800, H0 = box.clientHeight || 420;
    var renderer = new T.WebGLRenderer({ antialias: !low });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 2));
    renderer.setSize(W0, H0);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !low;
    renderer.domElement.className = "iz-canvas";
    box.appendChild(renderer.domElement);

    var scene = new T.Scene();
    scene.background = new T.Color(0x1a1210);
    scene.fog = new T.Fog(0x1a1210, 12, 26);
    var cam = new T.PerspectiveCamera(40, W0 / H0, 0.1, 100);
    // wide：★2 起多了右側的 4 人桌，鏡頭往右拉遠一點
    var view = { yaw: 0, base: 7.5, wide: false };
    function placeCam() {
      var a = (box.clientWidth || W0) / (box.clientHeight || H0), d = (view.wide ? 8.6 : view.base) * (a < 1 ? 1.45 : a < 1.4 ? 1.15 : 1);
      var cx = view.wide ? 1.3 : 0.6;
      cam.position.set(Math.sin(view.yaw) * d + cx, 4.3, Math.cos(view.yaw) * d + 0.4);
      cam.lookAt(cx, 0.9, 0.6);
    }
    placeCam();

    // ---------------- 光 ----------------
    scene.add(new T.HemisphereLight(0xffe2c0, 0x1a0e08, 0.55));
    var key = new T.DirectionalLight(0xfff0dd, 0.55);
    key.position.set(-4, 8, 6); key.castShadow = !low; key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
    scene.add(key);

    var mats = {};
    function M(c, o) {
      o = o || {};
      var k = c + JSON.stringify(o);
      // 顏色以 sRGB 寫，轉成線性空間（outputEncoding＝sRGB），不然整體會偏白
      if (!mats[k]) mats[k] = new T.MeshStandardMaterial({ color: new T.Color(c).convertSRGBToLinear(), roughness: o.r !== undefined ? o.r : 0.7, metalness: o.m || 0, emissive: new T.Color(o.e || 0).convertSRGBToLinear(), emissiveIntensity: o.ei || 1, transparent: !!o.t, opacity: o.t || 1 });
      return mats[k];
    }
    function box3(w, h, d, m, x, y, z) { var g = new T.Mesh(new T.BoxGeometry(w, h, d), m); g.position.set(x, y, z); g.castShadow = g.receiveShadow = !low; scene.add(g); return g; }
    function cyl(rt, rb, h, m, x, y, z, seg) { var g = new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 16), m); g.position.set(x, y, z); g.castShadow = g.receiveShadow = !low; scene.add(g); return g; }

    // ---------------- 店內 ----------------
    var WOOD = M(0x6b4226), WOOD_D = M(0x3e2414), WOOD_L = M(0x9a6a3c);
    box3(14, 0.1, 9, M(0x5a3a22, { r: 0.85 }), 1, -0.05, 0.5);                      // 地板
    box3(14, 4, 0.2, M(0x2a1c14), 1, 2, -2.3);                                       // 後牆
    box3(0.2, 4, 9, M(0x2f2018), -6, 2, 0.5);                                        // 左牆
    box3(6.6, 0.12, 0.9, WOOD_L, 0, 1.05, 0.6);                                      // 吧台面
    box3(6.6, 1.0, 0.15, WOOD_D, 0, 0.5, 1.0);                                       // 吧台前板
    SEATS.slice(0, 6).forEach(function (p) {                                          // 吧台凳
      cyl(0.22, 0.22, 0.08, M(0x8e1b1b), p[0], 0.72, p[1]);
      cyl(0.04, 0.04, 0.7, M(0x333333, { m: 0.6 }), p[0], 0.35, p[1]);
    });
    var tableParts = [];                                                               // 4 人桌（★2 起顯示）
    tableParts.push(box3(1.8, 0.08, 1.0, WOOD_L, 4.5, 0.75, 2.0), box3(0.12, 0.72, 0.12, WOOD_D, 4.5, 0.36, 2.0));
    SEATS.slice(6).forEach(function (p) { tableParts.push(cyl(0.2, 0.2, 0.08, M(0x8e1b1b), p[0], 0.5, p[1])); });
    // 後方酒架與酒瓶
    [0.9, 1.6, 2.3].forEach(function (y) { box3(5.6, 0.06, 0.35, WOOD, 0, y, -2.05); });
    for (var b = 0; b < 15; b++) {
      var x = -2.5 + (b % 5) * 1.2 + hash(b, 1) * 0.3, y = [0.93, 1.63, 2.33][Math.floor(b / 5)];
      var col = [0x1f5c2e, 0x6b3b1a, 0xd9d2c0, 0x2b2b6b, 0x8a1c1c][Math.floor(hash(b, 2) * 5)];
      cyl(0.08, 0.09, 0.42, M(col, { r: 0.2, t: 0.92 }), x, y + 0.21, -2.05);
      cyl(0.03, 0.05, 0.14, M(col, { r: 0.2 }), x, y + 0.49, -2.05);
    }
    // 工作站
    var stationGroup = {};
    function station(st, build) { var g = new T.Group(); g.position.set(STATION_X[st], 0, -0.55); build(g); scene.add(g); stationGroup[st] = g; }
    function add(g, mesh, x, y, z) { mesh.position.set(x, y, z); mesh.castShadow = !low; g.add(mesh); return mesh; }
    station("grill", function (g) {
      add(g, new T.Mesh(new T.BoxGeometry(1.0, 0.9, 0.5), M(0x222222, { m: 0.4 })), 0, 0.45, 0);
      add(g, new T.Mesh(new T.BoxGeometry(0.9, 0.04, 0.4), M(0x551a0a, { e: 0xff4a10, ei: 1.4 })), 0, 0.92, 0);
    });
    station("fry", function (g) {
      add(g, new T.Mesh(new T.BoxGeometry(0.9, 0.85, 0.5), M(0x7a7f86, { m: 0.7, r: 0.3 })), 0, 0.42, 0);
      add(g, new T.Mesh(new T.CylinderGeometry(0.3, 0.26, 0.18, 24), M(0xb8bcc2, { m: 0.8, r: 0.25 })), 0, 0.93, 0);
      add(g, new T.Mesh(new T.CylinderGeometry(0.27, 0.27, 0.02, 24), M(0xe8c45a, { e: 0x8a6a10, ei: 0.4 })), 0, 0.99, 0);
    });
    var steam = [];
    station("pot", function (g) {
      add(g, new T.Mesh(new T.BoxGeometry(0.9, 0.85, 0.5), M(0x3a3a3a)), 0, 0.42, 0);
      add(g, new T.Mesh(new T.CylinderGeometry(0.34, 0.3, 0.32, 24), M(0x5a5f66, { m: 0.6 })), 0, 1.0, 0);
      for (var i = 0; i < 6; i++) {
        var p = new T.Mesh(new T.SphereGeometry(0.07, 8, 6), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
        g.add(p); steam.push({ m: p, o: i / 6 });
      }
    });
    station("cold", function (g) {
      add(g, new T.Mesh(new T.BoxGeometry(0.9, 0.9, 0.5), M(0xeeeeee, { r: 0.35 })), 0, 0.45, 0);
      add(g, new T.Mesh(new T.BoxGeometry(0.7, 0.03, 0.35), M(0x7fb8c8, { r: 0.1, t: 0.7 })), 0, 0.92, 0);
    });
    station("bar", function (g) {
      add(g, new T.Mesh(new T.BoxGeometry(0.9, 0.9, 0.5), M(0x3e2414)), 0, 0.45, 0);
      add(g, new T.Mesh(new T.BoxGeometry(0.22, 0.5, 0.22), M(0xc0c4c8, { m: 0.8, r: 0.3 })), -0.2, 1.15, 0);
      add(g, new T.Mesh(new T.CylinderGeometry(0.07, 0.06, 0.18, 12), M(0xffd75a, { t: 0.8 })), 0.2, 1.0, 0);
    });
    // 工作站的格子（點擊用）＋進度環
    var slotObjs = [];
    Object.keys(STATION_X).forEach(function (st) {
      var n = Rush.SLOTS[st];
      for (var i = 0; i < n; i++) {
        var gx = STATION_X[st] - (n - 1) * 0.16 + i * 0.32;
        var disc = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.02, 20), M(0x2b2b2b, { r: 0.4 }));
        disc.position.set(gx, 1.13, -0.2); scene.add(disc);
        var food = new T.Mesh(new T.BoxGeometry(0.16, 0.08, 0.16), M(0xffffff));
        food.position.set(gx, 1.2, -0.2); food.visible = false; scene.add(food);
        var ring = new T.Mesh(new T.RingGeometry(0.15, 0.19, 24, 1, 0, Math.PI * 2), new T.MeshBasicMaterial({ color: 0x5dd27a, side: T.DoubleSide, transparent: true }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(gx, 1.15, -0.2); ring.visible = false; scene.add(ring);
        disc.userData.pick = ["slot", st, i];
        slotObjs.push({ st: st, i: i, disc: disc, food: food, ring: ring });
      }
    });
    // 紅燈籠
    var lanterns = [];
    [-2.5, -0.8, 0.8, 2.5].forEach(function (x, i) {
      var g = new T.Group(); g.position.set(x, 2.75, 0.7);
      var body = new T.Mesh(new T.SphereGeometry(0.28, 16, 12), M(0xc0281e, { e: 0xff3a1a, ei: 0.55 }));
      body.scale.set(1, 1.35, 1); g.add(body);
      var cap = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 0.06, 12), M(0x111111)); cap.position.y = 0.4; g.add(cap);
      var cap2 = cap.clone(); cap2.position.y = -0.4; g.add(cap2);
      var rope = new T.Mesh(new T.CylinderGeometry(0.01, 0.01, 0.8, 4), M(0x111111)); rope.position.y = 0.8; g.add(rope);
      var pl = new T.PointLight(0xffb070, low ? 0.6 : 0.9, 6); g.add(pl);
      scene.add(g); lanterns.push({ g: g, i: i });
    });
    // 暖簾（入口）
    var noren = [];
    for (var n = 0; n < 3; n++) {
      var cloth = new T.Mesh(new T.PlaneGeometry(0.55, 1.1), new T.MeshStandardMaterial({ color: 0x1c2a4a, side: T.DoubleSide, roughness: 0.9 }));
      cloth.position.set(6.3 + n * 0.58, 2.6, 3.2); cloth.rotation.y = -0.3; scene.add(cloth); noren.push(cloth);
    }

    // ---------------- 客人（照片立牌）----------------
    var texCache = {}, loader = new T.TextureLoader(), guestGroup = new T.Group(); scene.add(guestGroup);
    var guestKey = "", guestObjs = [];
    function photoTex(photo) {
      if (!photo) return null;
      if (!texCache[photo]) { var t = loader.load(opts.imgBase + photo + ".webp"); t.encoding = T.sRGBEncoding; texCache[photo] = t; }
      return texCache[photo];
    }
    function barTex() {
      var c = document.createElement("canvas"); c.width = 64; c.height = 8;
      var t = new T.CanvasTexture(c); t.userData = { c: c }; return t;
    }
    function makeGuest(seat, gid, photo) {
      var p = SEATS[seat], g = new T.Group(), table = seat >= 6, y0 = table ? 0.55 : 0.78;
      g.position.set(p[0], y0, p[1]);
      var col = new T.Color().setHSL(hash(seat + 3, gid.length) , 0.35, 0.45);
      var bodyM = new T.Mesh(new T.CylinderGeometry(0.17, 0.24, 0.62, 14), new T.MeshStandardMaterial({ color: col, roughness: 0.8 }));
      bodyM.position.y = 0.32; bodyM.castShadow = !low; g.add(bodyM);
      var head = new T.Mesh(new T.PlaneGeometry(0.46, 0.56), new T.MeshBasicMaterial({ map: photoTex(photo), color: photo ? 0xffffff : 0x888888 }));
      head.position.y = 0.94; g.add(head);
      var frame = new T.Mesh(new T.PlaneGeometry(0.5, 0.6), new T.MeshBasicMaterial({ color: 0x2b1a10 }));
      frame.position.set(0, 0.94, -0.005); g.add(frame);
      var bt = barTex();
      var bar = new T.Sprite(new T.SpriteMaterial({ map: bt, depthTest: false })); bar.scale.set(0.5, 0.06, 1); bar.position.y = 1.32; bar.visible = false; g.add(bar);
      var plate = new T.Mesh(new T.CylinderGeometry(0.12, 0.1, 0.03, 16), new T.MeshBasicMaterial({ color: 0xfff3b0 })); plate.position.set(0, 1.45, 0); plate.visible = false; g.add(plate);
      var hit = new T.Mesh(new T.BoxGeometry(0.7, 1.5, 0.7), new T.MeshBasicMaterial({ visible: false })); hit.position.y = 0.6; hit.userData.pick = ["seat", seat]; g.add(hit);
      guestGroup.add(g);
      return { seat: seat, g: g, head: head, frame: frame, bar: bar, bt: bt, plate: plate, hit: hit };
    }
    // 回合制：目前這組坐中間（2 號位），已結帳的熟面孔隨機坐其他位子當背景（用日期固定）
    function seatsOf(s) {
      var out = [];
      if (s.rush) { s.rush.seats.forEach(function (se) { if (se.gid) out.push({ seat: se.id, gid: se.gid }); }); return out; }
      if (!s.night) return out;
      var cur = s.night.groups[s.night.i];
      if (cur && cur.kind !== "rush") out.push({ seat: 2, gid: cur.gid });
      var done = s.night.groups.slice(0, s.night.i).filter(function (g) { return g.kind !== "rush"; }).slice(-4);
      var free = [0, 4, 1, 5, 3].concat(s.maxStar >= 2 ? [6, 7] : []);
      done.forEach(function (g, k) { if (free[k] !== undefined && hash(s.day, k) < 0.75) out.push({ seat: free[k], gid: g.gid }); });
      return out;
    }
    function syncGuests(s) {
      var list = seatsOf(s), k = list.map(function (x) { return x.seat + ":" + x.gid; }).join(",");
      if (k === guestKey) return;
      guestKey = k;
      guestObjs.forEach(function (o) { guestGroup.remove(o.g); });
      guestObjs = list.map(function (x) { return makeGuest(x.seat, x.gid, Core.photoOf(s, x.gid)); });
    }
    function drawBar(o, f) {
      var c = o.bt.userData.c, g = c.getContext("2d");
      g.fillStyle = "#000"; g.fillRect(0, 0, 64, 8);
      g.fillStyle = f > 0.5 ? "#5dd27a" : f > 0.25 ? "#f2c94c" : "#eb5757"; g.fillRect(1, 1, Math.max(0, 62 * f), 6);
      o.bt.needsUpdate = true;
    }

    // ---------------- 每一影格 ----------------
    var clock = 0, last = performance.now(), raf = 0, alive = true;
    function frame(now) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      var dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
      var s = opts.getState(), u = (opts.getUi && opts.getUi()) || {};
      if (s) {
        tableParts.forEach(function (m) { m.visible = s.maxStar >= 2; });
        view.wide = s.maxStar >= 2;
        syncGuests(s);
        var R = s.rush;
        guestObjs.forEach(function (o) {
          o.head.lookAt(cam.position); o.frame.lookAt(cam.position);
          o.g.position.y = (o.seat >= 6 ? 0.55 : 0.78) + Math.sin(clock * 2 + o.seat) * 0.01;
          var se = R && R.seats[o.seat];
          o.bar.visible = !!(se && se.gid);
          if (o.bar.visible) drawBar(o, Math.max(0, se.pat) / (se.max || 1));
          o.plate.visible = !!(se && se.items.some(function (it) { return it.s === "ready"; }));
          if (o.plate.visible) o.plate.position.y = 1.45 + Math.sin(clock * 6) * 0.04;
          o.head.scale.setScalar(u.hiSeat === o.seat ? 1.12 : 1);
        });
        slotObjs.forEach(function (so) {
          var sl = R && R.st[so.st] && R.st[so.st][so.i];
          so.food.visible = so.ring.visible = !!sl;
          if (!sl) return;
          var d = D.DISHES[sl.d], el = R.t - sl.t0, f = Math.min(1, el / sl.cook);
          so.food.material = M(CAT_COLOR[d.cat] || 0xffffff);
          so.ring.geometry.dispose();
          so.ring.geometry = new T.RingGeometry(0.15, 0.19, 24, 1, 0, Math.PI * 2 * f);
          var burnSoon = (sl.cook && (so.st === "grill" || so.st === "fry") && el > sl.cook * 1.4);
          so.ring.material.color.setHex(f < 1 ? 0xf2c94c : burnSoon ? (Math.sin(clock * 20) > 0 ? 0xff3b30 : 0x661010) : 0x5dd27a);
        });
      }
      lanterns.forEach(function (l) { l.g.rotation.z = Math.sin(clock * 0.8 + l.i) * 0.04; });
      noren.forEach(function (c, i) { c.rotation.x = Math.sin(clock * 1.3 + i) * 0.05; });
      steam.forEach(function (p) { var t = (clock * 0.5 + p.o) % 1; p.m.position.set(Math.sin(t * 6 + p.o * 9) * 0.1, 1.2 + t * 0.8, 0); p.m.material.opacity = 0.35 * (1 - t); p.m.scale.setScalar(0.6 + t); });
      placeCam();
      renderer.render(scene, cam);
    }
    raf = requestAnimationFrame(frame);

    // ---------------- 點擊、拖曳旋轉 ----------------
    var ray = new T.Raycaster(), el = renderer.domElement, drag = null;
    function pick(cx, cy) {
      var r = el.getBoundingClientRect();
      ray.setFromCamera(new T.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), cam);
      var targets = guestObjs.map(function (o) { return o.hit; }).concat(slotObjs.map(function (s) { return s.disc; }));
      var hit = ray.intersectObjects(targets, false)[0];
      return hit ? hit.object.userData.pick : null;
    }
    el.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, yaw: view.yaw, moved: false }; });
    el.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      if (Math.abs(dx) > 6) drag.moved = true;
      if (drag.moved) view.yaw = Math.max(-0.45, Math.min(0.45, drag.yaw - dx * 0.004));
    });
    el.addEventListener("pointerup", function (e) {
      if (drag && !drag.moved && opts.onPick) { var p = pick(e.clientX, e.clientY); if (p) opts.onPick(p[0], p[1], p[2]); }
      drag = null;
    });
    el.addEventListener("pointercancel", function () { drag = null; });

    function resize() {
      var w = box.clientWidth || 800, h = box.clientHeight || 420;
      renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
    }
    var ro = window.ResizeObserver ? new window.ResizeObserver(resize) : null;
    if (ro) ro.observe(box); else window.addEventListener("resize", resize);

    return {
      resize: resize,
      project: function (kind, a) {
        var v = kind === "seat" ? new T.Vector3(SEATS[a][0], 2.2, SEATS[a][1]) : new T.Vector3(STATION_X[a] || 0, 1.6, -0.4);
        v.project(cam);
        if (v.z > 1) return null;
        return { x: (v.x + 1) / 2 * el.clientWidth, y: (1 - v.y) / 2 * el.clientHeight };
      },
      dispose: function () {
        alive = false;
        cancelAnimationFrame(raf);
        if (ro) ro.disconnect(); else window.removeEventListener("resize", resize);
        renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  window.PriTestIzakaya3D = { available: available, load: load, create: create, SEATS: SEATS };
})();
