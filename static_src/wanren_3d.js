// 萬人迷（wanren）：3D 校園（three.js r149，第一次用到時才載入 #wr-app[data-three-src]）。
// 只負責「畫」與「走」：校園建築（窗戶貼圖、鐘樓、圓頂圖書館、拱頂體育館、操場、櫻花林道、噴水池、咖啡廳）、
// 來回走動的學生、站在各地點的女主角（點她就會回呼 onPick）、玩家角色（點地面移動、WASD、拖曳轉鏡頭、滾輪縮放）。
// 玩家走進某個地點的範圍時回呼 onLocation(locId)；規則全部在 wanren_core.js。
(function () {
  "use strict";

  var D = window.PriTestWanrenData;
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
    var app = document.getElementById("wr-app"), src = app && app.getAttribute("data-three-src");
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
  // 固定種子的亂數（每次進遊戲校園長得一樣）
  function seeded(seed) {
    var st = seed | 0;
    return function () {
      var t = (st = (st + 0x6D2B79F5) | 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 時段的光線
  var PHASE_LIGHT = {
    morning: { sky: 0xbfe0ff, fog: 0xd4e8ff, sun: 0xfff2dc, si: 1.0, sp: [40, 50, 45], hemi: 0.5, ground: 0x8fae6a, win: 0.0, lamp: 0 },
    class: { sky: 0x9fd0ff, fog: 0xbfe0ff, sun: 0xffffff, si: 1.05, sp: [20, 70, 30], hemi: 0.55, ground: 0x8fae6a, win: 0.0, lamp: 0 },
    free: { sky: 0xffc896, fog: 0xf3cba6, sun: 0xffb46a, si: 1.0, sp: [-60, 30, 35], hemi: 0.45, ground: 0x9a8a5a, win: 0.25, lamp: 0.3 },
    evening: { sky: 0x1a2142, fog: 0x1e2546, sun: 0x8fa2ef, si: 0.22, sp: [-30, 50, -40], hemi: 0.16, ground: 0x2a2a3a, win: 1.0, lamp: 1 },
    report: { sky: 0xffd2b0, fog: 0xffdcc0, sun: 0xffc890, si: 0.95, sp: [-50, 35, 40], hemi: 0.5, ground: 0x9a8a5a, win: 0.2, lamp: 0.2 }
  };

  function create(container, opts) {
    var T = window.THREE;
    opts = opts || {};
    var lowEnd = (navigator.hardwareConcurrency || 4) <= 4 || /Mobi|Android/i.test(navigator.userAgent);
    var renderer = new T.WebGLRenderer({ antialias: !lowEnd });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : 1.75));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    // 低階裝置（手機等）關掉陰影：人物很多，陰影會讓 draw call 加倍
    renderer.shadowMap.enabled = !lowEnd;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.domElement.className = "wr-canvas";
    container.appendChild(renderer.domElement);

    var scene = new T.Scene();
    scene.background = new T.Color(0xcfe8ff);
    scene.fog = new T.Fog(0xdcecff, 70, 190);
    var camera = new T.PerspectiveCamera(50, 16 / 9, 0.3, 400);

    var hemi = new T.HemisphereLight(0xffffff, 0x8fae6a, 0.5);
    scene.add(hemi);
    var sun = new T.DirectionalLight(0xffffff, 1.05);
    sun.castShadow = true;
    sun.shadow.mapSize.set(lowEnd ? 1024 : 2048, lowEnd ? 1024 : 2048);
    var sc = sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 1; sc.far = 220;
    sun.shadow.bias = -0.0006;
    scene.add(sun); scene.add(sun.target);

    var disposables = [];
    function track(x) { disposables.push(x); return x; }
    var matCache = {};
    function mat(color, extra) {
      var key = color + (extra ? JSON.stringify(extra) : "");
      if (matCache[key]) return matCache[key];
      var o = { color: color, roughness: 0.85, metalness: 0.0 };
      Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
      return (matCache[key] = track(new T.MeshStandardMaterial(o)));
    }
    function mesh(geo, m, x, y, z, shadow) {
      var o = new T.Mesh(track(geo), m);
      o.position.set(x || 0, y || 0, z || 0);
      if (shadow !== false) { o.castShadow = true; o.receiveShadow = true; }
      return o;
    }
    function canvasTex(w, h, draw) {
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      draw(c.getContext("2d"), w, h);
      var t = track(new T.CanvasTexture(c));
      t.encoding = T.sRGBEncoding;
      t.anisotropy = 4;
      return t;
    }

    var world = new T.Group();
    scene.add(world);
    var R = seeded(20260406);

    // ---------------- 地面與道路 ----------------
    var grassTex = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#7fae5c"; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 2600; i++) {
        var v = Math.floor(R() * 40);
        g.fillStyle = "rgba(" + (70 + v) + "," + (130 + v) + "," + (60 + v / 2) + ",0.55)";
        g.fillRect(R() * w, R() * h, 2, 3);
      }
    });
    grassTex.wrapS = grassTex.wrapT = T.RepeatWrapping;
    grassTex.repeat.set(26, 26);
    var groundMat = track(new T.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
    var ground = new T.Mesh(track(new T.PlaneGeometry(240, 240)), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.userData.ground = true;
    world.add(ground);

    var paveTex = canvasTex(128, 128, function (g, w, h) {
      g.fillStyle = "#d9cfbd"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(120,100,80,0.35)"; g.lineWidth = 2;
      for (var y = 0; y < h; y += 32) for (var x = 0; x < w; x += 32) {
        var off = (y / 32) % 2 ? 16 : 0;
        g.strokeRect(x + off, y, 32, 32);
        g.fillStyle = "rgba(" + (190 + Math.floor(R() * 30)) + "," + (175 + Math.floor(R() * 30)) + ",150,0.5)";
        g.fillRect(x + off + 2, y + 2, 28, 28);
      }
    });
    paveTex.wrapS = paveTex.wrapT = T.RepeatWrapping;
    function pathStrip(x1, z1, x2, z2, wdt) {
      var dx = x2 - x1, dz = z2 - z1, len = Math.sqrt(dx * dx + dz * dz);
      var t = paveTex.clone(); t.needsUpdate = true; track(t);
      t.repeat.set(wdt / 3, len / 3);
      var m = track(new T.MeshStandardMaterial({ map: t, roughness: 0.95 }));
      var p = new T.Mesh(track(new T.PlaneGeometry(wdt, len)), m);
      p.rotation.x = -Math.PI / 2;
      p.rotation.z = -Math.atan2(dx, dz);
      p.position.set((x1 + x2) / 2, 0.03, (z1 + z2) / 2);
      p.receiveShadow = true;
      world.add(p);
    }
    var Z = {};
    D.LOCATIONS.forEach(function (l) { Z[l.id] = l.z; });
    var plaza = Z.plaza;
    pathStrip(0, 58, 0, plaza.z, 6);                         // 校門 → 中庭
    pathStrip(plaza.x, plaza.z, 0, Z.classroom.z, 6);        // 中庭 → 教學大樓
    ["library", "cafeteria", "club", "infirmary"].forEach(function (id) { pathStrip(plaza.x, plaza.z, Z[id].x, Z[id].z, 4); });
    pathStrip(Z.gate.x, Z.gate.z, Z.cafe.x, Z.cafe.z, 3.5);
    pathStrip(Z.cafeteria.x, Z.cafeteria.z, Z.gym.x, Z.gym.z, 4);
    pathStrip(Z.library.x, Z.library.z, -30, Z.field.z + 12, 4);
    pathStrip(-24, Z.garden.z, 24, Z.garden.z, 5);           // 櫻花林道
    pathStrip(-26, 1, -26, Z.garden.z, 3.5);
    pathStrip(26, 1, 26, Z.garden.z, 3.5);
    pathStrip(-26, 1, 26, 1, 4);
    // 中庭的圓形廣場
    var pz = paveTex.clone(); pz.needsUpdate = true; track(pz); pz.repeat.set(6, 6);
    var plazaDisc = new T.Mesh(track(new T.CircleGeometry(11, 48)), track(new T.MeshStandardMaterial({ map: pz, roughness: 0.95 })));
    plazaDisc.rotation.x = -Math.PI / 2; plazaDisc.position.set(plaza.x, 0.04, plaza.z); plazaDisc.receiveShadow = true;
    world.add(plazaDisc);

    // ---------------- 建築 ----------------
    var colliders = [];   // 軸對齊矩形（x1,z1,x2,z2）
    var winMats = [];     // 夜間亮窗
    function facade(wu, hu, o) {
      var ppu = 14, W = Math.min(1024, Math.max(64, Math.round(wu * ppu))), H = Math.min(512, Math.max(64, Math.round(hu * ppu)));
      var floors = Math.max(1, Math.floor(hu / (o.floorH || 3.2))), cols = Math.max(1, Math.floor(wu / (o.colW || 2.6)));
      function draw(g, lit) {
        g.fillStyle = lit ? "#000" : o.wall; g.fillRect(0, 0, W, H);
        if (!lit) {
          g.fillStyle = o.band || "rgba(0,0,0,0.08)";
          for (var f = 0; f <= floors; f++) g.fillRect(0, H - f * H / floors - 2, W, 3);
        }
        var fh = H / floors, cw = W / cols;
        for (var f2 = 0; f2 < floors; f2++) for (var c = 0; c < cols; c++) {
          if (o.door && f2 === 0 && Math.abs(c - (cols - 1) / 2) < 0.6) {
            g.fillStyle = lit ? "#ffcf7a" : "#4a4038"; g.fillRect(c * cw + cw * 0.15, H - fh * 0.9, cw * 0.7, fh * 0.9);
            continue;
          }
          var x = c * cw + cw * (o.big ? 0.06 : 0.2), y = H - (f2 + 1) * fh + fh * (o.big ? 0.1 : 0.22);
          var ww = cw * (o.big ? 0.88 : 0.6), wh = fh * (o.big ? 0.8 : 0.52);
          if (lit) {
            var on = R() < 0.72;
            g.fillStyle = on ? (R() < 0.3 ? "#ffe9b0" : "#ffd27a") : "#111";
            g.fillRect(x, y, ww, wh);
          } else {
            g.fillStyle = o.frame || "#e9e4da"; g.fillRect(x - 2, y - 2, ww + 4, wh + 4);
            var grd = g.createLinearGradient(x, y, x + ww, y + wh);
            grd.addColorStop(0, o.glass || "#8fb8d8"); grd.addColorStop(1, o.glass2 || "#cfe3f1");
            g.fillStyle = grd; g.fillRect(x, y, ww, wh);
            g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(x + ww * 0.1, y + wh * 0.1, ww * 0.18, wh * 0.8);
          }
        }
      }
      var map = canvasTex(W, H, function (g) { draw(g, false); });
      var em = canvasTex(W, H, function (g) { draw(g, true); });
      var m = track(new T.MeshStandardMaterial({ map: map, emissiveMap: em, emissive: new T.Color(0xffffff), emissiveIntensity: 0, roughness: 0.8 }));
      winMats.push(m);
      return m;
    }
    function building(b, o) {
      var g = new T.Group();
      var front = facade(b.w, b.h, o), side = facade(b.d, b.h, o);
      var noDoor = {}; Object.keys(o).forEach(function (k) { noDoor[k] = o[k]; }); noDoor.door = false;
      var back = facade(b.w, b.h, noDoor);
      var roofM = mat(o.roof || 0x8a8f99);
      var box = new T.Mesh(track(new T.BoxGeometry(b.w, b.h, b.d)), [side, side, roofM, roofM, front, back]);
      box.position.y = b.h / 2; box.castShadow = true; box.receiveShadow = true;
      g.add(box);
      // 屋頂邊緣
      var rim = mesh(new T.BoxGeometry(b.w + 0.6, 0.5, b.d + 0.6), mat(o.rim || 0xf2efe8), 0, b.h + 0.25, 0);
      g.add(rim);
      g.position.set(b.x, 0, b.z);
      world.add(g);
      colliders.push({ x1: b.x - b.w / 2 - 0.6, z1: b.z - b.d / 2 - 0.6, x2: b.x + b.w / 2 + 0.6, z2: b.z + b.d / 2 + 0.6 });
      return g;
    }
    function label(text, sub, color) {
      var tex = canvasTex(512, 160, function (g, w, h) {
        g.fillStyle = "rgba(255,255,255,0.88)";
        roundRect(g, 8, 18, w - 16, h - 36, 40); g.fill();
        g.strokeStyle = color || "#e76f9a"; g.lineWidth = 6; roundRect(g, 8, 18, w - 16, h - 36, 40); g.stroke();
        g.fillStyle = "#3a2a3a"; g.textAlign = "center"; g.textBaseline = "middle";
        g.font = "bold 54px 'Noto Sans TC','Noto Sans JP',sans-serif";
        g.fillText(text, w / 2, sub ? h / 2 - 12 : h / 2);
        if (sub) { g.font = "28px 'Noto Sans TC','Noto Sans JP',sans-serif"; g.fillStyle = "#8a5a7a"; g.fillText(sub, w / 2, h / 2 + 34); }
      });
      var sp = new T.Sprite(track(new T.SpriteMaterial({ map: tex, depthWrite: false, transparent: true })));
      sp.scale.set(6.4, 2.0, 1);
      sp.renderOrder = 10;
      return sp;
    }
    function roundRect(g, x, y, w, h, r) {
      g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
      g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
      g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
    }

    var L = D.LOC_BY_ID;
    // 教學大樓＋鐘樓
    var cb = L.classroom.b;
    building(cb, { wall: "#efe6d6", band: "rgba(150,110,80,0.25)", roof: 0x7d6a5a, rim: 0xb5533c, door: true });
    var tower = new T.Group();
    tower.add(mesh(new T.BoxGeometry(7, 22, 7), mat(0xe9dfcc), 0, 11, 0));
    tower.add(mesh(new T.BoxGeometry(7.6, 0.6, 7.6), mat(0xb5533c), 0, 22.3, 0));
    var spire = mesh(new T.ConeGeometry(5.4, 7, 4), mat(0x8c3b2e), 0, 26, 0);
    spire.rotation.y = Math.PI / 4; tower.add(spire);
    var clockTex = null, clockMat = track(new T.MeshStandardMaterial({ roughness: 0.6 }));
    var clock = new T.Mesh(track(new T.CircleGeometry(2.3, 40)), clockMat);
    clock.position.set(0, 18, 3.52); tower.add(clock);
    tower.position.set(cb.x, 0, cb.z);
    world.add(tower);
    function drawClock(hh, mm) {
      if (clockTex) clockTex.dispose();
      clockTex = canvasTex(256, 256, function (g, w) {
        g.fillStyle = "#fdf8ec"; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
        g.strokeStyle = "#5a3a2a"; g.lineWidth = 10; g.stroke();
        g.fillStyle = "#3a2a1a";
        for (var i = 0; i < 12; i++) { var a = i / 12 * Math.PI * 2; g.fillRect(128 + Math.sin(a) * 100 - 4, 128 - Math.cos(a) * 100 - 8, 8, 16); }
        function hand(a, len, wd) { g.save(); g.translate(128, 128); g.rotate(a); g.fillRect(-wd / 2, -len, wd, len + 10); g.restore(); }
        hand((hh % 12 + mm / 60) / 12 * Math.PI * 2, 60, 10);
        hand(mm / 60 * Math.PI * 2, 92, 6);
      });
      clockMat.map = clockTex; clockMat.needsUpdate = true;
    }
    drawClock(8, 30);
    // 正門雨遮
    var canopy = mesh(new T.BoxGeometry(10, 0.4, 4), mat(0xb5533c), cb.x, 4.2, cb.z + cb.d / 2 + 2);
    world.add(canopy);
    [-4.5, 4.5].forEach(function (dx) { world.add(mesh(new T.CylinderGeometry(0.2, 0.2, 4.2, 10), mat(0xf2efe8), cb.x + dx, 2.1, cb.z + cb.d / 2 + 3.8)); });

    // 圖書館：圓頂＋列柱
    var lb = L.library.b;
    building(lb, { wall: "#e7dcc8", roof: 0x7a8a7a, rim: 0xd8ccb4, door: true, floorH: 5, colW: 3 });
    var dome = mesh(new T.SphereGeometry(5.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x6fa58f, { roughness: 0.5, metalness: 0.3 }), lb.x, lb.h + 0.5, lb.z);
    world.add(dome);
    world.add(mesh(new T.CylinderGeometry(0.5, 0.5, 2, 12), mat(0xd8ccb4), lb.x, lb.h + 6.2, lb.z));
    for (var ci = 0; ci < 6; ci++) {
      world.add(mesh(new T.CylinderGeometry(0.45, 0.5, lb.h - 1, 14), mat(0xf4efe4), lb.x + lb.w / 2 + 1.6, (lb.h - 1) / 2, lb.z - 6 + ci * 2.4));
    }
    world.add(mesh(new T.BoxGeometry(2.6, 0.8, 15), mat(0xf4efe4), lb.x + lb.w / 2 + 1.6, lb.h - 0.6, lb.z));
    colliders.push({ x1: lb.x + lb.w / 2, z1: lb.z - 7.5, x2: lb.x + lb.w / 2 + 2.4, z2: lb.z + 7.5 });

    // 學生餐廳：大片玻璃
    var fb = L.cafeteria.b;
    building(fb, { wall: "#f3ead8", roof: 0x9a8a7a, rim: 0xe0a458, door: true, big: true, floorH: 3.5, colW: 3, glass: "#9fc8e0", glass2: "#e8f4fb" });
    var awn = mesh(new T.BoxGeometry(0.4, 0.3, fb.d), mat(0xe0a458), fb.x - fb.w / 2 - 0.4, 3.6, fb.z);
    world.add(awn);

    // 體育館：拱頂
    var gb = L.gym.b;
    building(gb, { wall: "#e2e6ea", roof: 0x5f7a99, rim: 0x5f7a99, door: true, floorH: 4.5, colW: 4, glass: "#a8c0d8" });
    var arch = mesh(new T.CylinderGeometry(gb.w / 2, gb.w / 2, gb.d + 0.6, 32, 1, false, -Math.PI / 2, Math.PI), mat(0x4f6f94, { roughness: 0.4, metalness: 0.4 }), gb.x, gb.h, gb.z);
    arch.rotation.x = Math.PI / 2; arch.rotation.z = Math.PI / 2;
    arch.scale.set(1, 1, 0.35);
    world.add(arch);

    // 社團大樓：彩色布條
    var kb = L.club.b;
    building(kb, { wall: "#f5e3cf", roof: 0x9a7a6a, rim: 0x6a9ad0, door: true });
    ["#ef6f8a", "#6ac0a0", "#f2c14e", "#6a8ad0"].forEach(function (c, i) {
      var t = canvasTex(64, 192, function (g, w, h) { g.fillStyle = c; g.fillRect(0, 0, w, h); g.fillStyle = "#fff"; g.font = "bold 36px sans-serif"; g.textAlign = "center"; ["♪", "⚽", "✎", "★"].forEach(function (s, j) { if (j === i) g.fillText(s, w / 2, h / 2 + 12); }); });
      var ban = new T.Mesh(track(new T.PlaneGeometry(1.4, 4.2)), track(new T.MeshStandardMaterial({ map: t, side: T.DoubleSide })));
      ban.position.set(kb.x - kb.w / 2 - 0.05, 4.4, kb.z - 3.6 + i * 2.4); ban.rotation.y = -Math.PI / 2;
      world.add(ban);
    });

    // 保健中心：白牆＋紅十字
    var ib = L.infirmary.b;
    building(ib, { wall: "#f8f8f6", roof: 0x9ab0b8, rim: 0x88c0d0, door: true });
    var crossM = mat(0xe04848, { emissive: new T.Color(0x601010) });
    world.add(mesh(new T.BoxGeometry(0.3, 2.2, 0.7), crossM, ib.x + ib.w / 2 + 0.16, ib.h - 1.6, ib.z));
    world.add(mesh(new T.BoxGeometry(0.3, 0.7, 2.2), crossM, ib.x + ib.w / 2 + 0.16, ib.h - 1.6, ib.z));

    // 咖啡廳：條紋遮陽篷、戶外座位
    var eb = L.cafe.b;
    building(eb, { wall: "#f6e7d2", roof: 0x7a5a4a, rim: 0x7a5a4a, door: true, big: true, glass: "#e8c89a", glass2: "#fff2dc" });
    var stripe = canvasTex(256, 64, function (g, w, h) { for (var i = 0; i < 16; i++) { g.fillStyle = i % 2 ? "#fff6e6" : "#e8763a"; g.fillRect(i * 16, 0, 16, h); } });
    var awning = new T.Mesh(track(new T.BoxGeometry(eb.w, 0.2, 2.4)), track(new T.MeshStandardMaterial({ map: stripe })));
    awning.position.set(eb.x, 3.4, eb.z - eb.d / 2 - 1.1); awning.rotation.x = 0.25; awning.castShadow = true;
    world.add(awning);
    awning.rotation.y = Math.PI;
    for (var ti = 0; ti < 3; ti++) {
      var tx = eb.x - eb.w / 2 - 1.5 - ti * 0.2, tz = eb.z - 6 + ti * 3;
      tx = eb.x - 3 + ti * 3; tz = eb.z - eb.d / 2 - 4;
      world.add(mesh(new T.CylinderGeometry(0.7, 0.7, 0.08, 16), mat(0xffffff), tx, 0.9, tz));
      world.add(mesh(new T.CylinderGeometry(0.06, 0.06, 0.9, 6), mat(0x555555), tx, 0.45, tz));
      world.add(mesh(new T.CylinderGeometry(0.05, 0.05, 2.4, 6), mat(0x888888), tx, 1.6, tz));
      world.add(mesh(new T.ConeGeometry(1.6, 0.7, 8), mat(ti % 2 ? 0xe8763a : 0xfff6e6), tx, 2.9, tz));
    }

    // 校門：門柱、橫樑、校名、圍牆
    var gz = 58;
    var signTex = canvasTex(512, 96, function (g, w, h) {
      g.fillStyle = "#3a4a6a"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#f6e7b0"; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "bold 46px 'Noto Serif TC','Noto Serif JP',serif"; g.fillText("私立音夣學園大學", w / 2, 40);
      g.font = "18px serif"; g.fillText("OTOYUME GAKUEN UNIVERSITY", w / 2, 78);
    });
    [-5, 5].forEach(function (dx) { world.add(mesh(new T.BoxGeometry(1.4, 6, 1.4), mat(0xb8a890), dx, 3, gz)); world.add(mesh(new T.BoxGeometry(1.8, 0.5, 1.8), mat(0x8a7a6a), dx, 6.2, gz)); });
    var sign = new T.Mesh(track(new T.BoxGeometry(9, 1.6, 0.4)), [mat(0x3a4a6a), mat(0x3a4a6a), mat(0x3a4a6a), mat(0x3a4a6a), track(new T.MeshStandardMaterial({ map: signTex })), mat(0x3a4a6a)]);
    sign.position.set(0, 5.2, gz); sign.castShadow = true; world.add(sign);
    colliders.push({ x1: -6, z1: gz - 1, x2: -4, z2: gz + 1 }, { x1: 4, z1: gz - 1, x2: 6, z2: gz + 1 });
    var fenceM = mat(0x6a6a72, { metalness: 0.5, roughness: 0.5 });
    [[-58, -6], [6, 58]].forEach(function (seg) {
      var len = seg[1] - seg[0];
      world.add(mesh(new T.BoxGeometry(len, 0.15, 0.15), fenceM, (seg[0] + seg[1]) / 2, 1.6, gz));
      world.add(mesh(new T.BoxGeometry(len, 0.15, 0.15), fenceM, (seg[0] + seg[1]) / 2, 0.6, gz));
      for (var fx = seg[0]; fx <= seg[1]; fx += 2) world.add(mesh(new T.BoxGeometry(0.12, 1.8, 0.12), fenceM, fx, 0.9, gz, false));
      colliders.push({ x1: seg[0], z1: gz - 0.4, x2: seg[1], z2: gz + 0.4 });
    });

    // 操場：紅土跑道＋草皮＋白線＋看台
    var fz = Z.field;
    var trackShape = new T.Shape();
    trackShape.absellipse(0, 0, 19, 12, 0, Math.PI * 2, false, 0);
    var hole = new T.Path(); hole.absellipse(0, 0, 15, 8, 0, Math.PI * 2, true, 0);
    trackShape.holes.push(hole);
    var trackMesh = new T.Mesh(track(new T.ShapeGeometry(trackShape, 48)), mat(0xb5553e, { roughness: 1 }));
    trackMesh.rotation.x = -Math.PI / 2; trackMesh.position.set(fz.x, 0.05, fz.z); trackMesh.receiveShadow = true;
    world.add(trackMesh);
    for (var ln = 1; ln < 4; ln++) {
      var rr = 15 + ln;
      var ring = new T.Shape(); ring.absellipse(0, 0, rr + 4 * ln / 4 * 0 + 0.06, 8 + ln + 0.06, 0, Math.PI * 2, false, 0);
      var rh = new T.Path(); rh.absellipse(0, 0, rr - 0.06, 8 + ln - 0.06, 0, Math.PI * 2, true, 0); ring.holes.push(rh);
      var lm = new T.Mesh(track(new T.ShapeGeometry(ring, 48)), mat(0xffffff, { roughness: 1 }));
      lm.rotation.x = -Math.PI / 2; lm.position.set(fz.x, 0.06, fz.z); world.add(lm);
    }
    var inner = new T.Mesh(track(new T.CircleGeometry(1, 48)), mat(0x6fa84a, { roughness: 1 }));
    inner.scale.set(15, 8, 1); inner.rotation.x = -Math.PI / 2; inner.position.set(fz.x, 0.055, fz.z); inner.receiveShadow = true;
    world.add(inner);
    [-1, 1].forEach(function (sd) {
      var goal = new T.Group();
      goal.add(mesh(new T.BoxGeometry(0.15, 2, 0.15), mat(0xffffff), 0, 1, -2));
      goal.add(mesh(new T.BoxGeometry(0.15, 2, 0.15), mat(0xffffff), 0, 1, 2));
      goal.add(mesh(new T.BoxGeometry(0.15, 0.15, 4.15), mat(0xffffff), 0, 2, 0));
      goal.position.set(fz.x + sd * 12.5, 0, fz.z); world.add(goal);
    });
    for (var st = 0; st < 4; st++) {
      world.add(mesh(new T.BoxGeometry(22, 0.5, 1.2), mat(st % 2 ? 0x6a8ad0 : 0x8aa4e0), fz.x, 0.25 + st * 0.5, fz.z - 14 - st * 1.2));
    }
    colliders.push({ x1: fz.x - 11, z1: fz.z - 19.5, x2: fz.x + 11, z2: fz.z - 13.4 });

    // 噴水池
    var fountain = new T.Group();
    fountain.add(mesh(new T.CylinderGeometry(4.2, 4.4, 0.8, 40), mat(0xe8e2d6), 0, 0.4, 0));
    var waterM = track(new T.MeshStandardMaterial({ color: 0x5fb2e0, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85, emissive: new T.Color(0x0a3050) }));
    var water = new T.Mesh(track(new T.CylinderGeometry(3.8, 3.8, 0.1, 40)), waterM);
    water.position.y = 0.75; fountain.add(water);
    fountain.add(mesh(new T.CylinderGeometry(0.5, 0.8, 2.4, 16), mat(0xe8e2d6), 0, 1.6, 0));
    fountain.add(mesh(new T.CylinderGeometry(1.6, 1.2, 0.3, 24), mat(0xe8e2d6), 0, 2.8, 0));
    var jetM = track(new T.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.55, roughness: 0.1 }));
    var jet = new T.Mesh(track(new T.ConeGeometry(0.35, 2.2, 12, 1, true)), jetM);
    jet.position.y = 4; jet.rotation.x = Math.PI; fountain.add(jet);
    fountain.position.set(plaza.x, 0, plaza.z);
    world.add(fountain);
    var fountainR = 4.8;

    // ---------------- 樹、櫻花、長椅、路燈 ----------------
    var trunkM = mat(0x6b4a33);
    var leafMs = [mat(0x5c9a48, { flatShading: true }), mat(0x6bab50, { flatShading: true }), mat(0x4e8a40, { flatShading: true })];
    var sakuraMs = [mat(0xf7b6cc, { flatShading: true }), mat(0xfac8d8, { flatShading: true }), mat(0xf29fbd, { flatShading: true })];
    var leafGeo = track(new T.IcosahedronGeometry(1, 1));
    function tree(x, z, sakura, sz) {
      sz = sz || 1;
      var g = new T.Group();
      var tr = mesh(new T.CylinderGeometry(0.22 * sz, 0.32 * sz, 2.6 * sz, 7), trunkM, 0, 1.3 * sz, 0);
      g.add(tr);
      var n = sakura ? 6 : 4;
      for (var i = 0; i < n; i++) {
        var lm = new T.Mesh(leafGeo, (sakura ? sakuraMs : leafMs)[i % 3]);
        var a = i / n * Math.PI * 2;
        var s = (sakura ? 1.3 : 1.5) * sz * (0.8 + R() * 0.4);
        lm.scale.set(s, s * 0.85, s);
        lm.position.set(Math.cos(a) * 0.9 * sz, (3 + R() * 0.8) * sz, Math.sin(a) * 0.9 * sz);
        lm.castShadow = true;
        g.add(lm);
      }
      var top = new T.Mesh(leafGeo, (sakura ? sakuraMs : leafMs)[1]);
      top.scale.setScalar((sakura ? 1.4 : 1.6) * sz); top.position.y = 3.9 * sz; top.castShadow = true;
      g.add(top);
      g.position.set(x, 0, z);
      g.rotation.y = R() * Math.PI;
      world.add(g);
      colliders.push({ x1: x - 0.5, z1: z - 0.5, x2: x + 0.5, z2: z + 0.5 });
    }
    for (var sx = -22; sx <= 22; sx += 5.5) { tree(sx, Z.garden.z - 4.5, true); tree(sx + 2.75, Z.garden.z + 4.5, true); }
    [[-9, 26], [9, 26], [-9, 12], [9, 12], [-12, 40], [12, 36], [-46, 0], [46, 0], [-50, 24], [50, 26], [-48, 48], [48, 46], [-14, -44], [14, -44], [30, -42], [-52, -48], [52, -44], [-4, 44], [4, 34], [-56, 10], [56, 12]].forEach(function (p, i) { tree(p[0], p[1], i % 5 === 0, 0.9 + R() * 0.4); });
    // 外圍樹林
    for (var k = 0; k < 40; k++) {
      var ang = k / 40 * Math.PI * 2, rad = 66 + R() * 10;
      tree(Math.cos(ang) * rad, Math.sin(ang) * rad * 0.9, R() < 0.2, 1 + R() * 0.5);
    }
    function bench(x, z, ry) {
      var g = new T.Group();
      g.add(mesh(new T.BoxGeometry(2.2, 0.12, 0.6), mat(0x9a6a40), 0, 0.55, 0));
      g.add(mesh(new T.BoxGeometry(2.2, 0.5, 0.1), mat(0x9a6a40), 0, 0.85, -0.28));
      [-0.9, 0.9].forEach(function (dx) { g.add(mesh(new T.BoxGeometry(0.1, 0.55, 0.55), mat(0x444444), dx, 0.27, 0)); });
      g.position.set(x, 0, z); g.rotation.y = ry || 0;
      world.add(g);
    }
    [[-6, 27, Math.PI], [6, 27, Math.PI], [-8, 13, 0], [8, 13, 0], [-10, Z.garden.z, Math.PI / 2], [10, Z.garden.z, -Math.PI / 2], [-29, -12, 0]].forEach(function (b) { bench(b[0], b[1], b[2]); });
    var lampBulbs = [];
    var bulbM = track(new T.MeshStandardMaterial({ color: 0xfff4d0, emissive: new T.Color(0xffd27a), emissiveIntensity: 0 }));
    function lamp(x, z) {
      world.add(mesh(new T.CylinderGeometry(0.08, 0.12, 4, 8), mat(0x2f3440, { metalness: 0.6, roughness: 0.4 }), x, 2, z));
      var b = mesh(new T.SphereGeometry(0.32, 12, 10), bulbM, x, 4.1, z, false);
      world.add(b);
      lampBulbs.push(b);
    }
    [[-3.6, 32], [3.6, 40], [-3.6, 48], [-8, 19], [8, 19], [-14, 15], [14, 15], [-15, 1], [15, 1], [-18, Z.garden.z], [18, Z.garden.z], [17, 38], [-17, 38]].forEach(function (p) { lamp(p[0], p[1]); });
    var lampLights = [];
    [[0, 30], [0, 8], [-14, 15], [14, 15], [0, Z.garden.z]].forEach(function (p) {
      var pl = new T.PointLight(0xffc878, 0, 22, 2);
      pl.position.set(p[0], 4.5, p[1]);
      scene.add(pl); lampLights.push(pl);
    });

    // 雲
    var clouds = [];
    var cloudM = track(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92 }));
    for (var cl = 0; cl < 9; cl++) {
      var cg = new T.Group();
      for (var cp = 0; cp < 4; cp++) {
        var cm = new T.Mesh(leafGeo, cloudM);
        cm.scale.set(4 + R() * 3, 1.6 + R(), 3 + R() * 2);
        cm.position.set(cp * 4 - 6, R(), R() * 2);
        cg.add(cm);
      }
      cg.position.set(-120 + R() * 240, 48 + R() * 14, -110 + R() * 160);
      scene.add(cg); clouds.push(cg);
    }

    // 櫻花瓣粒子
    var PET = lowEnd ? 160 : 360;
    var petPos = new Float32Array(PET * 3), petVel = [];
    for (var pi = 0; pi < PET; pi++) {
      petPos[pi * 3] = -26 + R() * 52; petPos[pi * 3 + 1] = R() * 7; petPos[pi * 3 + 2] = Z.garden.z - 8 + R() * 16;
      petVel.push(0.3 + R() * 0.6);
    }
    var petGeo = track(new T.BufferGeometry());
    petGeo.setAttribute("position", new T.BufferAttribute(petPos, 3));
    var petTex = canvasTex(32, 32, function (g) { g.fillStyle = "#ffc4d8"; g.beginPath(); g.ellipse(16, 16, 12, 7, 0.6, 0, Math.PI * 2); g.fill(); });
    var petals = new T.Points(petGeo, track(new T.PointsMaterial({ size: 0.35, map: petTex, transparent: true, depthWrite: false })));
    world.add(petals);

    // ---------------- 人物模型 ----------------
    var geo = {
      limb: track(new T.CapsuleGeometry(0.07, 0.62, 4, 8)),
      arm: track(new T.CapsuleGeometry(0.055, 0.46, 4, 8)),
      torso: track(new T.CylinderGeometry(0.17, 0.15, 0.5, 12)),
      skirt: track(new T.CylinderGeometry(0.17, 0.32, 0.3, 14, 1, true)),
      longSkirt: track(new T.CylinderGeometry(0.17, 0.34, 0.72, 14, 1, true)),
      head: track(new T.SphereGeometry(0.16, 18, 14)),
      cap: track(new T.SphereGeometry(0.175, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58)),
      ball: track(new T.SphereGeometry(1, 12, 10)),
      eye: track(new T.SphereGeometry(0.022, 8, 6)),
      shoe: track(new T.BoxGeometry(0.12, 0.07, 0.22)),
      ribbon: track(new T.BoxGeometry(0.12, 0.06, 0.03)),
      lens: track(new T.TorusGeometry(0.04, 0.008, 6, 16)),
      coat: track(new T.CylinderGeometry(0.19, 0.27, 0.95, 14, 1, true))
    };
    var skinM = {};
    function sm(c) { return mat(c, { roughness: 0.7 }); }
    function hairBall(g, m, x, y, z, sx, sy, sz) {
      var b = new T.Mesh(geo.ball, m); b.position.set(x, y, z); b.scale.set(sx, sy, sz); b.castShadow = sx > 0.1; g.add(b); return b;
    }
    function person(look) {
      var root = new T.Group();
      var body = new T.Group();
      root.add(body);
      var h = look.h || 1;
      var skin = sm(look.skin || 0xf6dcc8), top = sm(look.top || 0x2a3358), bottom = sm(look.bottom || 0x2a3358), hair = mat(look.hair || 0x2a1e1a, { roughness: 0.55 });
      var outfit = look.outfit || "blazer", pants = outfit === "jersey" || outfit === "hakama" || outfit === "boy" || outfit === "hoodie" && look.pants;
      var legM = pants ? bottom : skin;
      var parts = {};
      ["L", "R"].forEach(function (s, i) {
        var hip = new T.Group(); hip.position.set(i ? 0.085 : -0.085, 0.82, 0);
        var leg = new T.Mesh(geo.limb, legM); leg.position.y = -0.38; leg.castShadow = true; hip.add(leg);
        if (!pants) { var sock = new T.Mesh(geo.limb, sm(outfit === "suit" || outfit === "kimono" ? 0x2a2a2a : 0x2a2a3a)); sock.scale.set(1.08, 0.38, 1.08); sock.position.y = -0.6; hip.add(sock); }
        var shoe = new T.Mesh(geo.shoe, sm(outfit === "jersey" ? 0xffffff : 0x3a2a22)); shoe.position.set(0, -0.79, 0.04); hip.add(shoe);
        body.add(hip);
        parts["leg" + s] = hip;
      });
      if (outfit === "hakama") {
        var hk = new T.Mesh(geo.longSkirt, bottom); hk.position.y = 0.58; hk.scale.set(1.1, 1.05, 1.1); hk.castShadow = true; body.add(hk);
      } else if (outfit === "kimono") {
        var km = new T.Mesh(geo.longSkirt, top); km.position.y = 0.52; km.scale.set(0.95, 1.2, 0.95); km.castShadow = true; body.add(km);
      } else if (!pants) {
        var long = outfit === "dress" || outfit === "apron" || outfit === "suit" || outfit === "cardigan";
        var sk = new T.Mesh(long ? geo.longSkirt : geo.skirt, outfit === "dress" ? top : bottom);
        sk.position.y = long ? 0.66 : 0.84; if (outfit === "suit") sk.scale.set(0.8, 0.7, 0.8), sk.position.y = 0.78;
        sk.castShadow = true; body.add(sk);
      }
      var torso = new T.Mesh(geo.torso, top); torso.position.y = 1.2; torso.castShadow = true; body.add(torso);
      if (outfit === "labcoat" || outfit === "coat") {
        var ct = new T.Mesh(geo.coat, sm(outfit === "labcoat" ? 0xffffff : look.top)); ct.position.y = 1.0; ct.castShadow = true; body.add(ct);
      }
      if (outfit === "apron") { var ap = new T.Mesh(new T.BoxGeometry(0.28, 0.6, 0.02), sm(0xffffff)); track(ap.geometry); ap.position.set(0, 0.95, 0.19); body.add(ap); }
      if (outfit === "blazer" || outfit === "boy" || outfit === "suit") {
        var rb = new T.Mesh(geo.ribbon, sm(look.ribbon || 0xd04050)); rb.position.set(0, 1.38, 0.165); body.add(rb);
        if (outfit === "boy") rb.scale.set(0.45, 3.2, 1), rb.position.y = 1.3;
      }
      ["L", "R"].forEach(function (s, i) {
        var sh = new T.Group(); sh.position.set(i ? 0.215 : -0.215, 1.42, 0);
        var arm = new T.Mesh(geo.arm, outfit === "labcoat" ? sm(0xffffff) : top); arm.position.y = -0.27; arm.castShadow = true; sh.add(arm);
        var hand = new T.Mesh(geo.ball, skin); hand.scale.setScalar(0.055); hand.position.y = -0.56; sh.add(hand);
        sh.rotation.z = i ? -0.08 : 0.08;
        body.add(sh);
        parts["arm" + s] = sh;
      });
      var head = new T.Group(); head.position.y = 1.63; body.add(head);
      var hm = new T.Mesh(geo.head, skin); hm.castShadow = true; head.add(hm);
      var eyeM = sm(0x2a1e2a);
      [-0.055, 0.055].forEach(function (x) { var e = new T.Mesh(geo.eye, eyeM); e.position.set(x, 0.0, 0.148); e.scale.set(1, 1.35, 0.6); head.add(e); });
      var blushM = mat(0xf2a0a8, { transparent: true, opacity: 0.55 });
      if (outfit !== "boy") [-0.09, 0.09].forEach(function (x) { var b = new T.Mesh(geo.ball, blushM); b.scale.set(0.025, 0.014, 0.01); b.position.set(x, -0.04, 0.142); head.add(b); });
      if (look.glasses) [-0.055, 0.055].forEach(function (x) { var gl = new T.Mesh(geo.lens, sm(0x333333)); gl.position.set(x, 0, 0.158); head.add(gl); });
      var cap = new T.Mesh(geo.cap, hair); cap.position.set(0, 0.025, -0.012); cap.rotation.x = -0.25; cap.castShadow = true; head.add(cap);
      var st = look.style || "long";
      hairBall(head, hair, 0, 0.07, 0.095, 0.15, 0.06, 0.07);    // 瀏海
      if (st === "long" || st === "wavy" || st === "longcurl") {
        hairBall(head, hair, 0, -0.17, -0.09, 0.17, 0.32, 0.09);
        if (st !== "long") { hairBall(head, hair, -0.13, -0.32, -0.04, 0.07, 0.12, 0.07); hairBall(head, hair, 0.13, -0.32, -0.04, 0.07, 0.12, 0.07); }
        if (st === "longcurl") [-0.1, 0, 0.1].forEach(function (x) { hairBall(head, hair, x, -0.47, -0.1, 0.06, 0.07, 0.06); });
      } else if (st === "ponytail" || st === "highpony") {
        var py = st === "highpony" ? 0.1 : 0.02;
        hairBall(head, hair, 0, py, -0.19, 0.06, 0.06, 0.06);
        hairBall(head, hair, 0, py - 0.2, -0.22, 0.06, 0.2, 0.05);
      } else if (st === "twin") {
        [-1, 1].forEach(function (s) { hairBall(head, hair, s * 0.17, 0.05, -0.04, 0.05, 0.05, 0.05); hairBall(head, hair, s * 0.2, -0.16, -0.04, 0.05, 0.2, 0.05); });
      } else if (st === "bob") {
        hairBall(head, hair, 0, -0.04, -0.03, 0.19, 0.14, 0.17);
      } else if (st === "braid") {
        for (var bi = 0; bi < 5; bi++) hairBall(head, hair, 0.12, -0.08 - bi * 0.08, 0.06 - bi * 0.005, 0.04, 0.045, 0.04);
      } else if (st === "bun" || st === "updo") {
        hairBall(head, hair, 0, st === "updo" ? 0.14 : 0.08, -0.15, 0.08, 0.08, 0.08);
      } else if (st === "sidepony") {
        hairBall(head, hair, 0.16, -0.02, -0.06, 0.05, 0.05, 0.05); hairBall(head, hair, 0.17, -0.22, 0.0, 0.05, 0.18, 0.05);
      } else if (st === "messy") {
        for (var mi = 0; mi < 6; mi++) hairBall(head, hair, Math.cos(mi) * 0.13, 0.08 + (mi % 2) * 0.04, Math.sin(mi) * 0.1 - 0.03, 0.06, 0.04, 0.06);
        hairBall(head, hair, 0, -0.08, -0.1, 0.15, 0.14, 0.08);
      } else if (st === "short" || st === "boy") {
        hairBall(head, hair, 0, -0.03, -0.07, 0.165, 0.12, 0.12);
      }
      if (look.ribbon && (st === "ponytail" || st === "twin" || st === "highpony")) hairBall(head, sm(look.ribbon), 0, (st === "highpony" ? 0.1 : 0.02) + 0.03, -0.2, 0.05, 0.03, 0.02);
      root.scale.setScalar(h);
      root.userData.parts = parts; root.userData.body = body; root.userData.head = head;
      return root;
    }
    function animate(p, t, moving, speed) {
      var pt = p.userData.parts, sw = moving ? Math.sin(t * speed * 3.2) * 0.6 : 0;
      pt.legL.rotation.x = sw; pt.legR.rotation.x = -sw;
      pt.armL.rotation.x = -sw * 0.8; pt.armR.rotation.x = sw * 0.8;
      p.userData.body.position.y = moving ? Math.abs(Math.cos(t * speed * 3.2)) * 0.04 : Math.sin(t * 1.6) * 0.008;
    }

    // ---------------- 地點標籤 ----------------
    var locLabels = {};
    D.LOCATIONS.forEach(function (l) {
      var sp = label(l.icon + " " + D.L(l.name), null, "#8a6ad0");
      var y = l.b ? Math.min(l.b.h + 3, 12) : 6.5;
      if (l.id === "classroom") y = 9;
      var px = l.b ? l.b.x : l.z.x, pz2 = l.b ? l.b.z + l.b.d / 2 + 0.5 : l.z.z;
      if (l.id === "library") { px = l.b.x + l.b.w / 2; pz2 = l.b.z; }
      if (l.id === "cafeteria" || l.id === "club") { px = l.b.x - l.b.w / 2; pz2 = l.b.z; }
      if (l.id === "infirmary") { px = l.b.x + l.b.w / 2; pz2 = l.b.z; }
      if (l.id === "gate") y = 8.2;
      sp.position.set(px, y, pz2);
      sp.scale.set(6.2, 1.94, 1);
      world.add(sp);
      locLabels[l.id] = sp;
    });

    // ---------------- 走動的學生 ----------------
    var nodes = {};
    D.LOCATIONS.forEach(function (l) { nodes[l.id] = { x: l.z.x, z: l.z.z }; });
    function route(from, to) {
      if (from === to) return [to];
      var hub = function (id) { return id === "cafe" ? ["gate", "plaza"] : id === "gym" ? ["cafeteria", "plaza"] : id === "field" ? ["library", "plaza"] : id === "garden" ? ["classroom", "plaza"] : id === "plaza" ? [] : ["plaza"]; };
      var a = [from].concat(hub(from)), b = [to].concat(hub(to));
      // 找共同點
      for (var i = 0; i < a.length; i++) { var j = b.indexOf(a[i]); if (j >= 0) return a.slice(1, i + 1).concat(b.slice(0, j).reverse()); }
      return a.slice(1).concat(b.slice().reverse());
    }
    var HAIRS = [0x1c1814, 0x2a1e1a, 0x3a2a20, 0x5a3b26, 0x7a5030, 0x1c1d2b, 0x9a6a3a, 0xc9a06a];
    var SKINS = [0xf6dcc8, 0xf2d0b4, 0xeec3a2, 0xf8e4d6, 0xe0b090];
    var NSTU = lowEnd ? 18 : 34;
    var students = [];
    var locIds = D.LOCATIONS.map(function (l) { return l.id; });
    for (var si = 0; si < NSTU; si++) {
      var girl = R() < 0.62;
      var styles = ["long", "ponytail", "bob", "twin", "short", "braid", "bun"];
      var lk = girl ? { hair: HAIRS[Math.floor(R() * HAIRS.length)], style: styles[Math.floor(R() * styles.length)], skin: SKINS[Math.floor(R() * SKINS.length)], top: [0x2a3358, 0x23305a, 0xf2f2f2, 0x3a4a6a][Math.floor(R() * 4)], bottom: [0x2b2f45, 0x6a4a4a, 0x2b4a3a][Math.floor(R() * 3)], outfit: R() < 0.7 ? "blazer" : "casual", ribbon: [0xd04050, 0x4a70c0, 0x40a070][Math.floor(R() * 3)], h: 0.92 + R() * 0.1, glasses: R() < 0.15 }
        : { hair: HAIRS[Math.floor(R() * 6)], style: "boy", skin: SKINS[Math.floor(R() * SKINS.length)], top: [0x2a3358, 0x3a3a3a, 0x4a5a7a][Math.floor(R() * 3)], bottom: 0x2b2f45, outfit: "boy", ribbon: [0xd04050, 0x4a70c0][Math.floor(R() * 2)], h: 1.02 + R() * 0.1, glasses: R() < 0.2 };
      var p = person(lk);
      var at = locIds[Math.floor(R() * locIds.length)];
      var n0 = nodes[at];
      p.position.set(n0.x + (R() - 0.5) * 6, 0, n0.z + (R() - 0.5) * 6);
      world.add(p);
      students.push({ obj: p, at: at, path: [], wait: R() * 5, speed: 1.3 + R() * 0.6, off: (R() - 0.5) * 2.4, t: R() * 10 });
    }
    function stepStudent(s, dt) {
      s.t += dt;
      if (s.wait > 0) { s.wait -= dt; animate(s.obj, s.t, false, 1); return; }
      if (!s.path.length) {
        var next = locIds[Math.floor(Math.random() * locIds.length)];
        s.path = route(s.at, next);
        s.dest = next;
      }
      var tgt = nodes[s.path[0]];
      var tx = tgt.x + s.off, tz = tgt.z + s.off * 0.6;
      var dx = tx - s.obj.position.x, dz = tz - s.obj.position.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.6) {
        s.at = s.path.shift();
        if (!s.path.length) s.wait = 3 + Math.random() * 9;
        return;
      }
      var v = Math.min(d, s.speed * dt);
      s.obj.position.x += dx / d * v; s.obj.position.z += dz / d * v;
      s.obj.rotation.y = Math.atan2(dx, dz);
      animate(s.obj, s.t, true, s.speed);
    }

    // ---------------- 女主角 ----------------
    var heroines = {};   // hid → { obj, label, loc, slot }
    var SLOTS = [[-2.4, 1.4], [2.4, 1.4], [0, -2.6], [-3.4, -1.8], [3.4, -1.8], [0, 3.2]];
    function heroLabel(text, sub, color) {
      var sp = label(text, sub, color);
      sp.scale.set(4.2, 1.31, 1);
      return sp;
    }
    function setHeroines(list) {
      var keep = {};
      var perLoc = {};
      list.forEach(function (it) {
        keep[it.id] = true;
        var hv = heroines[it.id];
        var sig = it.label + "|" + (it.sub || "") + "|" + (it.color || "");
        if (!hv) {
          var hd = D.HEROINE_BY_ID[it.id];
          var obj = person(hd.look);
          obj.traverse(function (o) { o.userData.hid = it.id; });
          world.add(obj);
          hv = heroines[it.id] = { obj: obj, label: null, sig: "", t: Math.random() * 10 };
        }
        if (hv.sig !== sig) {
          if (hv.label) { hv.obj.remove(hv.label); hv.label.material.map.dispose(); hv.label.material.dispose(); }
          hv.label = heroLabel(it.label, it.sub, it.color);
          hv.label.position.y = 2.4;
          hv.label.scale.multiplyScalar(1 / (D.HEROINE_BY_ID[it.id].look.h || 1));
          hv.label.userData.hid = it.id;
          hv.obj.add(hv.label);
          hv.sig = sig;
        }
        var n = perLoc[it.loc] = (perLoc[it.loc] || 0);
        perLoc[it.loc]++;
        var z = nodes[it.loc], sl = SLOTS[n % SLOTS.length];
        hv.loc = it.loc;
        hv.obj.position.set(z.x + sl[0], 0, z.z + sl[1]);
        hv.home = { x: z.x + sl[0], z: z.z + sl[1] };
        hv.obj.rotation.y = Math.atan2(z.x - hv.home.x, z.z + 4 - hv.home.z);
        hv.obj.visible = true;
      });
      Object.keys(heroines).forEach(function (hid) { if (!keep[hid]) heroines[hid].obj.visible = false; });
    }

    // ---------------- 玩家 ----------------
    var player = person({ hair: 0x221a16, style: "boy", skin: 0xf2d0b4, top: 0x23305a, bottom: 0x2b2f45, outfit: "boy", ribbon: 0xc03048, h: 1.08 });
    world.add(player);
    var ring = new T.Mesh(track(new T.RingGeometry(0.45, 0.6, 32)), track(new T.MeshBasicMaterial({ color: 0xff6fa5, transparent: true, opacity: 0.8 })));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; player.add(ring);
    var marker = new T.Mesh(track(new T.RingGeometry(0.3, 0.5, 24)), track(new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })));
    marker.rotation.x = -Math.PI / 2; marker.visible = false; world.add(marker);
    var pState = { tx: null, tz: null, speed: 7.5, t: 0, follow: null };
    var cam = { yaw: 0, pitch: 0.5, dist: 14, cx: 0, cz: 0 };
    function teleport(locId) {
      var z = nodes[locId] || nodes.gate;
      player.position.set(z.x, 0, z.z + (locId === "gate" ? -5 : 3));
      pState.tx = null; pState.follow = null; marker.visible = false;
      cam.cx = player.position.x; cam.cz = player.position.z;
      curLoc = undefined;
    }
    function collide(p) {
      for (var i = 0; i < colliders.length; i++) {
        var c = colliders[i];
        if (p.x > c.x1 && p.x < c.x2 && p.z > c.z1 && p.z < c.z2) {
          var dl = p.x - c.x1, dr = c.x2 - p.x, dt = p.z - c.z1, db = c.z2 - p.z, m = Math.min(dl, dr, dt, db);
          if (m === dl) p.x = c.x1; else if (m === dr) p.x = c.x2; else if (m === dt) p.z = c.z1; else p.z = c.z2;
        }
      }
      var fx = p.x - plaza.x, fz2 = p.z - plaza.z, fd = Math.sqrt(fx * fx + fz2 * fz2);
      if (fd < fountainR) { p.x = plaza.x + fx / (fd || 1) * fountainR; p.z = plaza.z + fz2 / (fd || 1) * fountainR; }
      p.x = clamp(p.x, -60, 60); p.z = clamp(p.z, -56, gz - 0.6);
      if (Math.abs(p.x) < 4 && p.z > gz - 2) p.z = Math.min(p.z, gz - 0.6);
    }
    var keys = {};
    function onKey(e) {
      var down = e.type === "keydown";
      var k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].indexOf(k) < 0) return;
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (!enabled || !inView()) return;
      keys[k] = down;
      if (down) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    function inView() {
      var r = renderer.domElement.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    }

    // ---------------- 輸入：點擊、拖曳、縮放 ----------------
    var ray = new T.Raycaster(), ndc = new T.Vector2();
    var drag = null, pinch = null, enabled = true;
    var cvs = renderer.domElement;
    function pickAt(cx, cy) {
      var r = cvs.getBoundingClientRect();
      ndc.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1);
      ray.setFromCamera(ndc, camera);
      var objs = [];
      Object.keys(heroines).forEach(function (hid) { if (heroines[hid].obj.visible) objs.push(heroines[hid].obj); });
      var hits = ray.intersectObjects(objs, true);
      if (hits.length) {
        var hid = hits[0].object.userData.hid;
        if (hid) {
          var hv = heroines[hid];
          pState.follow = hid;
          pState.tx = hv.obj.position.x; pState.tz = hv.obj.position.z + 1.6;
          marker.visible = false;
          if (opts.onPick) opts.onPick(hid);
          return;
        }
      }
      var g = ray.intersectObject(ground, false)[0];
      if (g) {
        pState.tx = g.point.x; pState.tz = g.point.z; pState.follow = null;
        marker.position.set(g.point.x, 0.07, g.point.z); marker.visible = true;
      }
    }
    cvs.addEventListener("pointerdown", function (e) {
      if (!enabled) return;
      drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: false, id: e.pointerId };
      try { cvs.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
    });
    cvs.addEventListener("pointermove", function (e) {
      if (!drag || drag.id !== e.pointerId || pinch) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
      if (drag.moved) {
        cam.yaw = drag.yaw - dx * 0.006;
        cam.pitch = clamp(drag.pitch + dy * 0.004, 0.25, 1.35);
      }
    });
    cvs.addEventListener("pointerup", function (e) {
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.moved && !pinch) pickAt(e.clientX, e.clientY);
      drag = null;
    });
    cvs.addEventListener("pointercancel", function () { drag = null; });
    cvs.addEventListener("wheel", function (e) {
      if (!enabled) return;
      e.preventDefault();
      cam.dist = clamp(cam.dist * (e.deltaY > 0 ? 1.1 : 0.9), 7, 60);
    }, { passive: false });
    cvs.addEventListener("touchstart", function (e) {
      if (e.touches.length === 2) {
        var a = e.touches[0], b = e.touches[1];
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), dist: cam.dist };
      }
    }, { passive: true });
    cvs.addEventListener("touchmove", function (e) {
      if (pinch && e.touches.length === 2) {
        var a = e.touches[0], b = e.touches[1];
        var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        cam.dist = clamp(pinch.dist * pinch.d / Math.max(20, d), 7, 60);
        e.preventDefault();
      }
    }, { passive: false });
    cvs.addEventListener("touchend", function (e) { if (e.touches.length < 2) setTimeout(function () { pinch = null; }, 50); }, { passive: true });

    // ---------------- 時段 ----------------
    var light = { cur: null, from: null, to: PHASE_LIGHT.morning, k: 1 };
    function snapLight(p) {
      return { sky: new T.Color(p.sky), fog: new T.Color(p.fog), sun: new T.Color(p.sun), si: p.si, sp: p.sp.slice(), hemi: p.hemi, ground: new T.Color(p.ground), win: p.win, lamp: p.lamp };
    }
    light.cur = snapLight(PHASE_LIGHT.morning);
    function setPhase(ph) {
      var p = PHASE_LIGHT[ph] || PHASE_LIGHT.free;
      light.from = { sky: light.cur.sky.clone(), fog: light.cur.fog.clone(), sun: light.cur.sun.clone(), si: light.cur.si, sp: light.cur.sp.slice(), hemi: light.cur.hemi, ground: light.cur.ground.clone(), win: light.cur.win, lamp: light.cur.lamp };
      light.to = snapLight(p); light.k = 0; light.t0 = performance.now();
      var hm = { morning: [8, 20], class: [11, 5], free: [16, 40], evening: [20, 15], report: [17, 30] }[ph] || [12, 0];
      drawClock(hm[0], hm[1]);
    }
    function stepLight(dt) {
      if (light.k >= 1 || !light.from) return;
      light.k = Math.min(1, (performance.now() - light.t0) / 1600);
      var k = light.k * light.k * (3 - 2 * light.k), a = light.from, b = light.to, c = light.cur;
      c.sky.copy(a.sky).lerp(b.sky, k); c.fog.copy(a.fog).lerp(b.fog, k); c.sun.copy(a.sun).lerp(b.sun, k); c.ground.copy(a.ground).lerp(b.ground, k);
      c.si = lerp(a.si, b.si, k); c.hemi = lerp(a.hemi, b.hemi, k); c.win = lerp(a.win, b.win, k); c.lamp = lerp(a.lamp, b.lamp, k);
      for (var i = 0; i < 3; i++) c.sp[i] = lerp(a.sp[i], b.sp[i], k);
      applyLight();
    }
    function applyLight() {
      var c = light.cur;
      scene.background.copy(c.sky); scene.fog.color.copy(c.fog);
      sun.color.copy(c.sun); sun.intensity = c.si;
      hemi.intensity = c.hemi; hemi.groundColor.copy(c.ground);
      hemi.color.copy(c.sky).lerp(new T.Color(0xffffff), 0.5);
      winMats.forEach(function (m) { m.emissiveIntensity = c.win; });
      bulbM.emissiveIntensity = c.lamp * 2.2;
      lampLights.forEach(function (l) { l.intensity = c.lamp * 0.45; });
      renderer.toneMappingExposure = 0.9 - c.lamp * 0.15;
      cloudM.opacity = 0.92 - c.lamp * 0.5;
      waterM.emissive.setRGB(0.04 + c.lamp * 0.1, 0.18 + c.lamp * 0.2, 0.3 + c.lamp * 0.3);
    }
    applyLight();

    // ---------------- 主迴圈 ----------------
    var curLoc;
    var clock3 = new T.Clock();
    var raf = 0, alive = true, tAll = 0;
    var camPos = new T.Vector3(), camLook = new T.Vector3();
    function locOf(x, z) {
      for (var i = 0; i < D.LOCATIONS.length; i++) {
        var zz = D.LOCATIONS[i].z, dx = x - zz.x, dz = z - zz.z;
        if (dx * dx + dz * dz < zz.r * zz.r) return D.LOCATIONS[i].id;
      }
      return null;
    }
    function frame() {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      var dt = Math.min(0.05, clock3.getDelta());
      tAll += dt;
      if (document.hidden || !inView()) return;
      stepLight(dt);
      // 玩家移動
      var mx = 0, mz = 0;
      if (keys.w || keys.arrowup) mz -= 1;
      if (keys.s || keys.arrowdown) mz += 1;
      if (keys.a || keys.arrowleft) mx -= 1;
      if (keys.d || keys.arrowright) mx += 1;
      var moving = false;
      if (mx || mz) {
        pState.tx = null; pState.follow = null; marker.visible = false;
        var cs = Math.cos(cam.yaw), sn = Math.sin(cam.yaw);
        var wx = mx * cs + mz * sn, wz = -mx * sn + mz * cs, wl = Math.sqrt(wx * wx + wz * wz);
        player.position.x += wx / wl * pState.speed * dt; player.position.z += wz / wl * pState.speed * dt;
        player.rotation.y = Math.atan2(wx, wz);
        moving = true;
      } else if (pState.tx !== null) {
        var dx = pState.tx - player.position.x, dz = pState.tz - player.position.z, d = Math.sqrt(dx * dx + dz * dz);
        if (d < 0.25) { pState.tx = null; marker.visible = false; if (pState.follow && heroines[pState.follow]) { var ho = heroines[pState.follow].obj.position; player.rotation.y = Math.atan2(ho.x - player.position.x, ho.z - player.position.z); } }
        else {
          var v = Math.min(d, pState.speed * dt);
          var ox = player.position.x, oz = player.position.z;
          player.position.x += dx / d * v; player.position.z += dz / d * v;
          player.rotation.y = Math.atan2(dx, dz);
          collide(player.position);
          if (Math.abs(player.position.x - ox) + Math.abs(player.position.z - oz) < v * 0.2) { pState.tx = null; marker.visible = false; }
          moving = true;
        }
      }
      collide(player.position);
      pState.t += dt;
      animate(player, pState.t, moving, 2.2);
      marker.rotation.z += dt * 2;
      // 地點
      var lc = locOf(player.position.x, player.position.z);
      if (lc !== curLoc) { curLoc = lc; if (opts.onLocation) opts.onLocation(lc); }
      Object.keys(locLabels).forEach(function (id) { locLabels[id].material.opacity = id === lc ? 0.18 : 0.85; });
      // 學生、女主角
      students.forEach(function (s) { stepStudent(s, dt); });
      Object.keys(heroines).forEach(function (hid) {
        var hv = heroines[hid];
        if (!hv.obj.visible) return;
        hv.t += dt;
        var px = player.position.x - hv.obj.position.x, pz = player.position.z - hv.obj.position.z, pd = Math.sqrt(px * px + pz * pz);
        if (pd < 7) {
          var want = Math.atan2(px, pz), cur = hv.obj.rotation.y;
          var diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
          hv.obj.rotation.y = cur + diff * Math.min(1, dt * 4);
        }
        animate(hv.obj, hv.t, false, 1);
        var pt = hv.obj.userData.parts;
        if (pd < 4) { pt.armR.rotation.z = -1.9 - Math.sin(hv.t * 7) * 0.35; pt.armR.rotation.x = 0; }
        else { pt.armR.rotation.z = -0.08; }
        hv.label.position.y = 2.4 + Math.sin(hv.t * 2) * 0.05;
      });
      // 環境
      jet.scale.set(1 + Math.sin(tAll * 6) * 0.08, 1 + Math.sin(tAll * 4.3) * 0.12, 1);
      water.rotation.y += dt * 0.2;
      clouds.forEach(function (c, i) { c.position.x += dt * (0.6 + i * 0.07); if (c.position.x > 130) c.position.x = -130; });
      var pa = petGeo.attributes.position.array;
      for (var i = 0; i < PET; i++) {
        pa[i * 3 + 1] -= petVel[i] * dt;
        pa[i * 3] += Math.sin(tAll * 0.8 + i) * dt * 0.6 + dt * 0.3;
        pa[i * 3 + 2] += Math.cos(tAll * 0.6 + i * 1.7) * dt * 0.4;
        if (pa[i * 3 + 1] < 0.02) { pa[i * 3 + 1] = 5 + Math.random() * 2.5; pa[i * 3] = -26 + Math.random() * 52; pa[i * 3 + 2] = Z.garden.z - 8 + Math.random() * 16; }
      }
      petGeo.attributes.position.needsUpdate = true;
      // 鏡頭
      cam.cx = lerp(cam.cx, player.position.x, Math.min(1, dt * 5));
      cam.cz = lerp(cam.cz, player.position.z, Math.min(1, dt * 5));
      var hz = Math.cos(cam.pitch) * cam.dist, hy = Math.sin(cam.pitch) * cam.dist;
      camPos.set(cam.cx + Math.sin(cam.yaw) * hz, hy + 1, cam.cz + Math.cos(cam.yaw) * hz);
      camera.position.copy(camPos);
      camLook.set(cam.cx, 1.6, cam.cz);
      camera.lookAt(camLook);
      sun.position.set(cam.cx + light.cur.sp[0], light.cur.sp[1], cam.cz + light.cur.sp[2]);
      sun.target.position.set(cam.cx, 0, cam.cz);
      renderer.render(scene, camera);
    }
    function resize() {
      var w = container.clientWidth || 640, h = container.clientHeight || 360;
      renderer.setSize(w, h, false);
      cvs.style.width = "100%"; cvs.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    var ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(container); else window.addEventListener("resize", resize);
    resize();
    teleport("gate");
    frame();

    return {
      setPhase: setPhase,
      setHeroines: setHeroines,
      teleport: teleport,
      walkTo: function (locId) { var z = nodes[locId]; if (!z) return; pState.tx = z.x; pState.tz = z.z + 1.5; pState.follow = null; marker.position.set(pState.tx, 0.07, pState.tz); marker.visible = true; },
      getLoc: function () { return curLoc || null; },
      setEnabled: function (on) { enabled = !!on; if (!on) { keys = {}; pState.tx = null; marker.visible = false; } },
      resize: resize,
      // 測試用
      _debug: function () { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, player: { x: player.position.x, z: player.position.z }, loc: curLoc, heroines: Object.keys(heroines).filter(function (k) { return heroines[k].obj.visible; }), students: students.length, sky: "#" + light.cur.sky.getHexString() }; },
      dispose: function () {
        alive = false;
        cancelAnimationFrame(raf);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keyup", onKey);
        if (ro) ro.disconnect(); else window.removeEventListener("resize", resize);
        Object.keys(heroines).forEach(function (hid) { var l = heroines[hid].label; if (l) { l.material.map.dispose(); l.material.dispose(); } });
        if (clockTex) clockTex.dispose();
        disposables.forEach(function (d) { if (d && d.dispose) d.dispose(); });
        renderer.dispose();
        if (cvs.parentNode) cvs.parentNode.removeChild(cvs);
      }
    };
  }

  window.PriTestWanren3D = { available: available, load: load, create: create };
})();
