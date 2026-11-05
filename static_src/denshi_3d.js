// 電子守衛（denshi）：3D 畫面（three.js r149，第一次進入遊戲才載入 #ds-app[data-three-src]）。
// 只負責畫面與點擊：每一影格向 opts.getState() 拿狀態（單機直接是模擬中的物件、連線是房主廣播的快照），
// 敵人位置用平滑內插；fx（特效事件）依 id 只播一次。點到的格子交給 opts.onCell(x, y)。
// 所有模型都用基本幾何體在程式裡組出來（電路板、晶片、電容、線圈……），不需要外部素材。
(function () {
  "use strict";

  var D = window.PriTestDenshiData;
  var W = D.W, H = D.H;
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
    var app = document.getElementById("ds-app"), src = app && app.getAttribute("data-three-src");
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

  // 固定的偽亂數（同一格每次畫出同樣的裝飾）
  function hash(a, b) { var h = Math.imul(a * 374761393 + b * 668265263, 1274126177); h ^= h >>> 13; return ((Math.imul(h, 1103515245) >>> 0) % 10000) / 10000; }
  function wx(x) { return x - W / 2; }
  function wz(y) { return y - H / 2; }

  // opts：{ getState(), getUi() → { ghost, ghostOk, range, sel, hoverTower }, onCell(x, y), onHover(x, y|null), onFrame(dt), quality }
  function create(box, opts) {
    var T = window.THREE;
    var low = opts.quality === "low";
    var W0 = box.clientWidth || 800, H0 = box.clientHeight || 500;
    var renderer = new T.WebGLRenderer({ antialias: !low, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 2));
    renderer.setSize(W0, H0);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !low;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.domElement.className = "ds-canvas";
    box.appendChild(renderer.domElement);

    var s0 = opts.getState();
    var theme = D.MAPS[s0.map] || D.MAPS[0];
    var scene = new T.Scene();
    var bgc = new T.Color(theme.board).multiplyScalar(0.35);
    scene.background = bgc;
    scene.fog = new T.Fog(bgc, 50, 120);

    var cam = new T.PerspectiveCamera(42, W0 / H0, 0.1, 200);
    var view = { yaw: 0, pitch: 0.98, dist: 19, tx: 0, tz: 0.6 }, MAXD = 48;
    function placeCam() {
      var cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
      cam.position.set(view.tx + Math.sin(view.yaw) * cp * view.dist, sp * view.dist, view.tz + Math.cos(view.yaw) * cp * view.dist);
      cam.lookAt(view.tx, 0, view.tz);
    }
    // 依畫面長寬比算出剛好裝得下整塊電路板的距離；直立畫面把電路板轉 90 度（長邊朝上下）
    function fitCam() {
      var a = (box.clientWidth || W0) / (box.clientHeight || H0), portrait = a < 1.1;
      view.yaw = portrait ? Math.PI / 2 : 0;
      view.tx = portrait ? 0.6 : 0; view.tz = portrait ? 0 : 0.6;
      var ew = (portrait ? H : W) / 2 + 0.9, ed = (portrait ? W : H) / 2 + 0.9;
      var tv = Math.tan(cam.fov * Math.PI / 360), th = tv * a;
      var dW = ew / th + ed * Math.cos(view.pitch), dH = (ed * Math.sin(view.pitch) + 0.6) / tv + ed * Math.cos(view.pitch) * 0.5;
      view.dist = Math.max(8, Math.min(MAXD, Math.max(dW, dH) * 1.04));
    }
    fitCam(); placeCam();

    // ---------------- 光 ----------------
    scene.add(new T.HemisphereLight(0xbfd8ff, 0x10140c, 0.55));
    var sun = new T.DirectionalLight(0xffffff, 1.1);
    sun.position.set(-8, 16, 10);
    sun.castShadow = !low;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -13; sun.shadow.camera.right = 13; sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 50;
    sun.shadow.bias = -0.0008;
    scene.add(sun);
    var rim = new T.DirectionalLight(theme.glow, 0.35);
    rim.position.set(10, 6, -12);
    scene.add(rim);

    // ---------------- 共用素材 ----------------
    var matCache = {};
    function M(color, o) {
      o = o || {};
      var key = color + "|" + JSON.stringify(o);
      if (matCache[key]) return matCache[key];
      var m = new T.MeshStandardMaterial({
        color: color, metalness: o.m !== undefined ? o.m : 0.3, roughness: o.r !== undefined ? o.r : 0.55,
        emissive: o.e !== undefined ? o.e : 0x000000, emissiveIntensity: o.ei !== undefined ? o.ei : 1,
        transparent: !!o.t, opacity: o.t ? o.t : 1, wireframe: !!o.w, side: o.ds ? T.DoubleSide : T.FrontSide, depthWrite: o.t ? false : true
      });
      matCache[key] = m;
      return m;
    }
    var METAL = M(0xb8c0c8, { m: 0.85, r: 0.28 }), DARK = M(0x23262b, { m: 0.5, r: 0.45 }), BLACK = M(0x121316, { m: 0.2, r: 0.6 });
    var COPPER = M(0xc87533, { m: 0.9, r: 0.32 }), GOLD = M(0xd4a640, { m: 0.95, r: 0.25 }), SILVER = M(0xe4e8ee, { m: 0.95, r: 0.18 });
    function glowM(color) { return M(color, { e: color, ei: 2.2, m: 0.1, r: 0.4 }); }

    var glowTex = (function () {
      var c = document.createElement("canvas"); c.width = c.height = 64;
      var g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,0.6)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      var t = new T.CanvasTexture(c); return t;
    })();
    var spriteMats = {};
    function glow(color, size, op) {
      var key = color + "|" + (op || 1);
      if (!spriteMats[key]) spriteMats[key] = new T.SpriteMaterial({ map: glowTex, color: color, transparent: true, opacity: op || 1, blending: T.AdditiveBlending, depthWrite: false });
      var sp = new T.Sprite(spriteMats[key]);
      sp.scale.set(size, size, size);
      return sp;
    }
    function glowOwn(color, size) {
      var sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: color, transparent: true, opacity: 1, blending: T.AdditiveBlending, depthWrite: false }));
      sp.scale.set(size, size, size);
      return sp;
    }

    var G = {
      box: function (w, h, d, m) { var g = new T.Mesh(new T.BoxGeometry(w, h, d), m); g.castShadow = g.receiveShadow = !low; return g; },
      cyl: function (rt, rb, h, m, seg) { var g = new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 16), m); g.castShadow = g.receiveShadow = !low; return g; },
      sph: function (r, m, ws) { var g = new T.Mesh(new T.SphereGeometry(r, ws || 16, (ws || 16) * 0.75), m); g.castShadow = !low; return g; },
      tor: function (r, t, m, seg) { var g = new T.Mesh(new T.TorusGeometry(r, t, 8, seg || 24), m); g.castShadow = !low; return g; },
      at: function (o, x, y, z) { o.position.set(x, y, z); return o; }
    };

    // ---------------- 電路板 ----------------
    function pcbTexture() {
      var S = 96, c = document.createElement("canvas");
      c.width = W * S; c.height = H * S;
      var g = c.getContext("2d");
      var bc = new T.Color(theme.board), tc = new T.Color(theme.trace);
      g.fillStyle = "#" + bc.getHexString(); g.fillRect(0, 0, c.width, c.height);
      // 微微的雜訊
      for (var i = 0; i < 2600; i++) { g.fillStyle = "rgba(255,255,255," + (hash(i, 7) * 0.035) + ")"; g.fillRect(hash(i, 1) * c.width, hash(i, 2) * c.height, 2, 2); }
      var trace = "rgba(" + Math.round(tc.r * 255) + "," + Math.round(tc.g * 255) + "," + Math.round(tc.b * 255) + ",";
      // 走線（直角＋45 度轉角）
      g.lineCap = "round"; g.lineJoin = "round";
      for (var k = 0; k < 70; k++) {
        var x = Math.floor(hash(k, 11) * W * 4) * S / 4, y = Math.floor(hash(k, 12) * H * 4) * S / 4;
        g.strokeStyle = trace + (0.25 + hash(k, 13) * 0.3) + ")";
        g.lineWidth = 3 + Math.floor(hash(k, 14) * 3) * 2;
        g.beginPath(); g.moveTo(x, y);
        var dir = Math.floor(hash(k, 15) * 4);
        for (var st = 0; st < 5; st++) {
          var len = (1 + Math.floor(hash(k, 20 + st) * 4)) * S / 2;
          var dd = [[1, 0], [0, 1], [-1, 0], [0, -1]][dir];
          x += dd[0] * len; y += dd[1] * len;
          g.lineTo(x, y);
          var diag = S / 4;
          var turn = hash(k, 30 + st) < 0.5 ? 1 : 3;
          var nd = (dir + turn) % 4, n2 = [[1, 0], [0, 1], [-1, 0], [0, -1]][nd];
          x += (dd[0] + n2[0]) * diag; y += (dd[1] + n2[1]) * diag;
          g.lineTo(x, y);
          dir = nd;
        }
        g.stroke();
        g.fillStyle = trace + "0.7)";
        g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#" + bc.getHexString();
        g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
      }
      // 導通孔
      for (k = 0; k < 160; k++) {
        var vx = hash(k, 41) * c.width, vy = hash(k, 42) * c.height;
        g.fillStyle = trace + "0.55)"; g.beginPath(); g.arc(vx, vy, 5, 0, Math.PI * 2); g.fill();
        g.fillStyle = "rgba(0,0,0,0.6)"; g.beginPath(); g.arc(vx, vy, 2, 0, Math.PI * 2); g.fill();
      }
      // 絲印文字
      g.font = "bold 18px monospace"; g.fillStyle = "rgba(255,255,255,0.28)";
      var labels = ["R", "C", "U", "Q", "L", "D", "J", "TP"];
      for (k = 0; k < 40; k++) g.fillText(labels[k % labels.length] + (1 + Math.floor(hash(k, 51) * 98)), hash(k, 52) * c.width, hash(k, 53) * c.height);
      // 格線
      g.strokeStyle = "rgba(255,255,255,0.07)"; g.lineWidth = 2;
      for (x = 0; x <= W; x++) { g.beginPath(); g.moveTo(x * S, 0); g.lineTo(x * S, c.height); g.stroke(); }
      for (y = 0; y <= H; y++) { g.beginPath(); g.moveTo(0, y * S); g.lineTo(c.width, y * S); g.stroke(); }
      var t = new T.CanvasTexture(c);
      t.encoding = T.sRGBEncoding;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return t;
    }
    var board = new T.Mesh(new T.BoxGeometry(W, 0.4, H), [DARK, DARK, M(0xffffff, { m: 0.25, r: 0.7 }), DARK, DARK, DARK]);
    board.material[2] = new T.MeshStandardMaterial({ map: pcbTexture(), metalness: 0.25, roughness: 0.7 });
    board.position.y = -0.2;
    board.receiveShadow = true;
    scene.add(board);
    // 機殼外框與螺絲
    var caseFrame = G.box(W + 1.6, 0.5, H + 1.6, M(0x1a1c20, { m: 0.7, r: 0.35 }));
    caseFrame.position.y = -0.45; scene.add(caseFrame);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
      var sc = G.cyl(0.22, 0.22, 0.08, SILVER, 20); G.at(sc, p[0] * (W / 2 + 0.4), -0.17, p[1] * (H / 2 + 0.4)); scene.add(sc);
      var sl = G.box(0.3, 0.02, 0.05, BLACK); G.at(sl, p[0] * (W / 2 + 0.4), -0.12, p[1] * (H / 2 + 0.4)); sl.rotation.y = 0.6; scene.add(sl);
    });
    var under = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshStandardMaterial({ color: bgc.clone().multiplyScalar(0.8), roughness: 1 }));
    under.rotation.x = -Math.PI / 2; under.position.y = -0.72; under.receiveShadow = true; scene.add(under);

    // ---------------- 地形（晶片、匯流排、散熱片、輸送帶、光纖、壞軌、入口、核心） ----------------
    var terGroup = new T.Group(); scene.add(terGroup);
    var terKey = "", beltTex = null, badMeshes = [], portals = [], pinRings = [];
    function chipMesh(x, y, big) {
      var g = new T.Group(), sz = 0.82;
      var body = G.box(sz, 0.22, sz, M(0x15161a, { m: 0.15, r: 0.55 }));
      body.position.y = 0.11; g.add(body);
      var dot = G.cyl(0.05, 0.05, 0.01, M(0x555, { r: 0.8 }), 10); G.at(dot, -0.28, 0.225, -0.28); g.add(dot);
      for (var i = 0; i < 6; i++) {
        var o = -0.34 + i * 0.136;
        [[o, 0.45, 0], [o, -0.45, 0], [0.45, o, 1], [-0.45, o, 1]].forEach(function (p) {
          var pin = G.box(p[2] ? 0.1 : 0.06, 0.04, p[2] ? 0.06 : 0.1, SILVER);
          G.at(pin, p[0], 0.05, p[1]);
          g.add(pin);
        });
      }
      var lab = G.box(0.4, 0.005, 0.12, M(0x6a6a70, { r: 0.9 })); G.at(lab, 0.05, 0.225, 0.08); g.add(lab);
      if (big) g.scale.set(1.08, 1.2, 1.08);
      return g;
    }
    function capMesh(seed) {
      var g = new T.Group(), col = [0x1d3d8f, 0x222222, 0x5a1d6a][Math.floor(seed * 3)];
      var c = G.cyl(0.3, 0.3, 0.7, M(col, { m: 0.3, r: 0.35 }), 24); c.position.y = 0.35; g.add(c);
      var top = G.cyl(0.29, 0.29, 0.02, SILVER, 24); top.position.y = 0.71; g.add(top);
      var x1 = G.box(0.4, 0.025, 0.04, M(0x888c90, { m: 0.8 })); x1.position.y = 0.725; g.add(x1);
      var x2 = x1.clone(); x2.rotation.y = Math.PI / 2; g.add(x2);
      var stripe = G.box(0.08, 0.66, 0.02, M(0xdddddd, { r: 0.6 })); G.at(stripe, 0, 0.35, 0.3); g.add(stripe);
      return g;
    }
    function rebuildTerrain(s) {
      var key = s.ter.join("") + "|" + s.core.join(",");
      if (key === terKey) return;
      terKey = key;
      while (terGroup.children.length) terGroup.remove(terGroup.children[0]);
      badMeshes = []; portals = []; pinRings = [];
      var x, y, i;
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
        i = y * W + x;
        var t = s.ter[i], px = wx(x) + 0.5, pz = wz(y) + 0.5, hv = hash(x, y);
        if (t === "#") {
          var m = hv < 0.35 ? capMesh(hash(y, x)) : chipMesh(x, y, hv > 0.85);
          G.at(m, px, 0, pz); m.rotation.y = Math.floor(hash(x + 5, y) * 4) * Math.PI / 2;
          terGroup.add(m);
        } else if (t === "b") {
          for (var k = 0; k < 6; k++) { var ln = G.box(1, 0.012, 0.05, GOLD); G.at(ln, px, 0.006, pz - 0.36 + k * 0.144); terGroup.add(ln); }
        } else if (t === "c") {
          for (k = 0; k < 5; k++) { var fin = G.box(0.06, 0.32, 0.92, M(0xaab4c0, { m: 0.9, r: 0.35 })); G.at(fin, px - 0.36 + k * 0.18, 0.16, pz); terGroup.add(fin); }
          var base = G.box(0.96, 0.04, 0.96, M(0x8a96a4, { m: 0.9, r: 0.4 })); G.at(base, px, 0.02, pz); terGroup.add(base);
        } else if (t === "v") {
          if (!beltTex) {
            var bc = document.createElement("canvas"); bc.width = 64; bc.height = 64;
            var bg = bc.getContext("2d"); bg.fillStyle = "#2b2d33"; bg.fillRect(0, 0, 64, 64);
            bg.fillStyle = "#ffcf5a"; bg.beginPath(); bg.moveTo(18, 14); bg.lineTo(44, 32); bg.lineTo(18, 50); bg.lineTo(26, 32); bg.fill();
            beltTex = new T.CanvasTexture(bc); beltTex.wrapS = beltTex.wrapT = T.RepeatWrapping; beltTex.encoding = T.sRGBEncoding;
          }
          var belt = new T.Mesh(new T.BoxGeometry(1, 0.05, 0.86), new T.MeshStandardMaterial({ map: beltTex, roughness: 0.8, emissive: 0x332200, emissiveMap: beltTex }));
          belt.receiveShadow = true; G.at(belt, px, 0.025, pz); terGroup.add(belt);
          var rail1 = G.box(1, 0.08, 0.05, METAL); G.at(rail1, px, 0.04, pz - 0.46); terGroup.add(rail1);
          var rail2 = rail1.clone(); rail2.position.z = pz + 0.46; terGroup.add(rail2);
        } else if (t === "f") {
          var fb = G.box(0.9, 0.04, 0.12, glowM(0x35e0ff)); G.at(fb, px, 0.02, pz); terGroup.add(fb);
          var fb2 = G.box(0.12, 0.04, 0.9, glowM(0x35e0ff)); G.at(fb2, px, 0.02, pz); terGroup.add(fb2);
        } else if (t === "p") {
          // 電源排針：黑色塑膠座＋2×3 根鍍金針腳，底下一圈發光
          var hdr = G.box(0.62, 0.12, 0.42, M(0x111214, { r: 0.6 })); G.at(hdr, px, 0.06, pz); terGroup.add(hdr);
          for (var pr = 0; pr < 6; pr++) { var pin2 = G.box(0.06, 0.34, 0.06, GOLD); G.at(pin2, px - 0.2 + (pr % 3) * 0.2, 0.25, pz - 0.1 + Math.floor(pr / 3) * 0.2); terGroup.add(pin2); }
          var pring = new T.Mesh(new T.RingGeometry(0.4, 0.47, 32), M(0xffd04a, { e: 0xffd04a, ei: 1.5, t: 0.8, ds: true }));
          pring.rotation.x = -Math.PI / 2; G.at(pring, px, 0.015, pz); terGroup.add(pring); pinRings.push(pring);
          var plab = new T.Mesh(new T.PlaneGeometry(0.9, 0.9), new T.MeshBasicMaterial({ map: modTextureChar("⚡", "#ffd04a"), transparent: true, depthWrite: false }));
          plab.rotation.x = -Math.PI / 2; G.at(plab, px, 0.012, pz); terGroup.add(plab);
        } else if (t === "x") {
          var bad = new T.Mesh(new T.BoxGeometry(0.94, 0.1, 0.94), new T.MeshStandardMaterial({ color: 0x400010, emissive: 0xff1a3a, emissiveIntensity: 0.8, roughness: 0.6 }));
          G.at(bad, px, 0.05, pz); terGroup.add(bad); badMeshes.push(bad);
          for (k = 0; k < 3; k++) { var gl = G.box(0.2 + hash(k, i) * 0.5, 0.02, 0.06, glowM(0xff5577)); G.at(gl, px - 0.2 + hash(i, k) * 0.4, 0.11, pz - 0.3 + k * 0.3); terGroup.add(gl); }
        } else if (t === "S") {
          var pg = new T.Group();
          var ring = G.tor(0.42, 0.07, glowM(0xff3ad0), 32); ring.rotation.y = Math.PI / 2; ring.position.y = 0.5; pg.add(ring);
          var ring2 = G.tor(0.3, 0.03, glowM(0xffffff), 32); ring2.rotation.y = Math.PI / 2; ring2.position.y = 0.5; pg.add(ring2);
          var pad = G.cyl(0.46, 0.5, 0.06, M(0x301030, { m: 0.6, r: 0.3 }), 24); pad.position.y = 0.03; pg.add(pad);
          var gs = glow(0xff3ad0, 1.4, 0.8); gs.position.y = 0.5; pg.add(gs);
          G.at(pg, px, 0, pz); terGroup.add(pg);
          portals.push({ g: pg, r: ring, r2: ring2, gl: gs, i: s.spawns.findIndex(function (p) { return p[0] === x && p[1] === y; }) });
        }
      }
      buildCore(s);
    }
    // 核心＝CPU（散熱蓋＋發光晶粒＋全像環）
    var coreObj = null;
    function buildCore(s) {
      var g = new T.Group();
      var sub = G.box(1.5, 0.12, 1.5, M(0x1f6b3a, { m: 0.3, r: 0.6 })); sub.position.y = 0.06; g.add(sub);
      for (var i = 0; i < 10; i++) {
        var o = -0.63 + i * 0.14;
        [[o, -0.7], [o, 0.7], [-0.7, o], [0.7, o]].forEach(function (p) { var pin = G.box(0.07, 0.03, 0.07, GOLD); G.at(pin, p[0], 0.135, p[1]); g.add(pin); });
      }
      var ihs = G.box(1.1, 0.14, 1.1, M(0xcfd5dc, { m: 0.95, r: 0.22 })); ihs.position.y = 0.19; g.add(ihs);
      var die = G.box(0.5, 0.06, 0.5, glowM(theme.glow)); die.position.y = 0.29; g.add(die);
      var holo = new T.Group(); holo.position.y = 1.0; g.add(holo);
      var hr1 = G.tor(0.55, 0.025, glowM(theme.glow), 48); hr1.rotation.x = Math.PI / 2; holo.add(hr1);
      var hr2 = G.tor(0.42, 0.02, glowM(0xffffff), 48); hr2.rotation.x = Math.PI / 2.4; holo.add(hr2);
      var gem = new T.Mesh(new T.OctahedronGeometry(0.22, 0), M(theme.glow, { e: theme.glow, ei: 1.6, t: 0.85, m: 0.2, r: 0.1 })); holo.add(gem);
      var gl = glowOwn(theme.glow, 2.6); gl.position.y = 1; g.add(gl);
      var pl = new T.PointLight(theme.glow, 1.6, 6); pl.position.y = 1.2; g.add(pl);
      G.at(g, wx(s.core[0]) + 0.5, 0, wz(s.core[1]) + 0.5);
      terGroup.add(g);
      coreObj = { g: g, holo: holo, hr1: hr1, hr2: hr2, gem: gem, gl: gl, die: die, pl: pl, flash: 0 };
    }

    // ---------------- 地基 ----------------
    var foundGroup = new T.Group(); scene.add(foundGroup);
    var foundKey = "", foundMeshes = {}, modTex = {};
    function modTextureChar(ch, col) {
      var key = "c:" + ch + col;
      if (modTex[key]) return modTex[key];
      var c = document.createElement("canvas"); c.width = c.height = 64;
      var g = c.getContext("2d");
      g.fillStyle = col; g.globalAlpha = 0.35; g.font = "bold 40px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ch, 32, 34);
      var t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding;
      modTex[key] = t; return t;
    }
    function modTexture(mod) {
      if (modTex[mod]) return modTex[mod];
      var c = document.createElement("canvas"); c.width = c.height = 64;
      var g = c.getContext("2d"), col = "#" + new T.Color(D.MODS[mod].color).getHexString();
      g.strokeStyle = col; g.lineWidth = 4; g.strokeRect(6, 6, 52, 52);
      g.fillStyle = col; g.font = "bold 34px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(D.MODS[mod].icon, 32, 34);
      var t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding;
      modTex[mod] = t; return t;
    }
    function foundationMesh(mod, ownerColor, powered) {
      var g = new T.Group();
      var slab = G.box(0.96, 0.16, 0.96, M(0x2d3138, { m: 0.55, r: 0.4 })); slab.position.y = 0.08; g.add(slab);
      var top = G.box(0.84, 0.02, 0.84, M(0x14361f, { m: 0.2, r: 0.6 })); top.position.y = 0.17; g.add(top);
      [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]].forEach(function (p) { var pad = G.box(0.12, 0.02, 0.12, GOLD); G.at(pad, p[0], 0.17, p[1]); g.add(pad); });
      var edge = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(0.96, 0.16, 0.96)), new T.LineBasicMaterial({ color: ownerColor, transparent: true, opacity: 0.55 }));
      edge.position.y = 0.08; g.add(edge);
      if (powered) {
        // 通電：表面多一條發光走線＋側邊亮條
        var tr = G.box(0.86, 0.012, 0.08, M(theme.glow, { e: theme.glow, ei: 1.8 })); tr.position.y = 0.186; g.add(tr);
        var tr2 = G.box(0.08, 0.012, 0.86, M(theme.glow, { e: theme.glow, ei: 1.8 })); tr2.position.y = 0.186; g.add(tr2);
        var side = G.box(1.0, 0.04, 1.0, M(theme.glow, { e: theme.glow, ei: 2, t: 0.75 })); side.position.y = 0.12; g.add(side);
        g.userData.pw = [tr, tr2];
      }
      if (mod) {
        var mc = D.MODS[mod].color;
        var icon = new T.Mesh(new T.PlaneGeometry(0.7, 0.7), new T.MeshBasicMaterial({ map: modTexture(mod), transparent: true, depthWrite: false }));
        icon.rotation.x = -Math.PI / 2; icon.position.y = 0.185; g.add(icon);
        var ml = G.box(0.98, 0.03, 0.98, M(mc, { e: mc, ei: 0.9, t: 0.5 })); ml.position.y = 0.02; g.add(ml);
      }
      return g;
    }
    function rebuildFound(s) {
      var key = s.fo.join(",") + "|" + s.fm.join(",") + "|" + s.ter.join("");
      if (key === foundKey) return;
      foundKey = key;
      var seen = {}, net = window.PriTestDenshiCore.nets(s);
      for (var i = 0; i < s.fo.length; i++) {
        if (!s.fo[i]) continue;
        var cpw = net.comp[i] >= 0 && net.info[net.comp[i]].pw;
        var k = i + ":" + s.fm[i] + ":" + s.fo[i] + ":" + (cpw ? 1 : 0);
        seen[k] = 1;
        if (foundMeshes[k]) continue;
        var p = s.players[s.fo[i]], col = D.PLAYER_COLORS[p ? p.ci : 0];
        var m = foundationMesh(s.fm[i], col, cpw);
        var x = i % W, y = (i - x) / W;
        G.at(m, wx(x) + 0.5, 1.2, wz(y) + 0.5);
        m.userData.drop = 1.2;
        foundGroup.add(m);
        foundMeshes[k] = m;
      }
      Object.keys(foundMeshes).forEach(function (k) { if (!seen[k]) { foundGroup.remove(foundMeshes[k]); delete foundMeshes[k]; } });
    }

    // ---------------- 砲塔模型 ----------------
    // 回傳 { g, head（會轉向目標）, spin（自轉零件）, tip（槍口在 head 內的位置）, glows（隨狀態變亮）}
    function buildTower(ty, lv, ownerColor) {
      var def = D.TOWERS[ty], col = def.color;
      var g = new T.Group(), head = new T.Group(), spin = null, tip = new T.Vector3(0.4, 0, 0), glows = [];
      var ped = G.cyl(0.36, 0.4, 0.14, M(0x30343b, { m: 0.75, r: 0.32 }), 8); ped.position.y = 0.25; g.add(ped);
      var ring = G.tor(0.37, 0.025, glowM(ownerColor), 8); ring.rotation.x = Math.PI / 2; ring.position.y = 0.3; ring.rotation.z = Math.PI / 8; g.add(ring);
      var nlv = def.cat === "evo" ? lv + 4 : lv + 1;
      for (var i = 0; i < Math.min(nlv, 5); i++) { var pip = G.sph(0.035, glowM(def.cat === "evo" ? 0xffd04a : 0x7dffb0), 8); G.at(pip, -0.16 + i * 0.08, 0.27, 0.39); g.add(pip); }
      if (def.cat === "evo") { var crown = G.tor(0.3, 0.02, GOLD, 32); crown.rotation.x = Math.PI / 2; crown.position.y = 0.34; g.add(crown); }
      head.position.y = 0.32; g.add(head);
      var e = glowM(col);
      switch (ty) {
        case "gun": case "transistor": {
          if (ty === "gun") {
            var hs = G.box(0.32, 0.2, 0.3, M(0x8a96a4, { m: 0.85, r: 0.3 })); hs.position.set(0, 0.12, 0); head.add(hs);
            var vent = G.box(0.2, 0.02, 0.24, BLACK); vent.position.set(-0.04, 0.225, 0); head.add(vent);
          } else {
            var body = G.box(0.3, 0.36, 0.12, M(0x161616, { r: 0.5 })); body.position.set(-0.05, 0.2, 0); head.add(body);
            var tab = G.box(0.3, 0.16, 0.04, SILVER); tab.position.set(-0.05, 0.44, -0.04); head.add(tab);
            var hole = G.tor(0.04, 0.012, METAL, 12); hole.position.set(-0.05, 0.46, -0.015); head.add(hole);
            for (var l = 0; l < 3; l++) { var leg = G.box(0.03, 0.12, 0.03, SILVER); leg.position.set(-0.13 + l * 0.08, 0.02, 0.02); head.add(leg); }
            var mark = G.box(0.2, 0.005, 0.005, M(0xaaaaaa)); mark.position.set(-0.05, 0.25, 0.062); head.add(mark);
            var lens = G.sph(0.05, glowM(0xff4060), 10); lens.position.set(0.11, 0.2, 0); head.add(lens); glows.push(lens);
          }
          spin = new T.Group(); spin.position.set(0.16, ty === "gun" ? 0.12 : 0.2, 0); head.add(spin);
          for (var b = 0; b < 3; b++) {
            var a = b * Math.PI * 2 / 3, br = G.cyl(0.03, 0.03, 0.42, METAL, 10);
            br.rotation.z = Math.PI / 2; br.position.set(0.18, Math.cos(a) * 0.055, Math.sin(a) * 0.055); spin.add(br);
          }
          var mz = G.cyl(0.085, 0.085, 0.04, DARK, 12); mz.rotation.z = Math.PI / 2; mz.position.set(0.36, 0, 0); spin.add(mz);
          tip.set(0.55, ty === "gun" ? 0.12 : 0.2, 0);
          break;
        }
        case "coilgun": {
          var bar = G.cyl(0.05, 0.05, 0.75, METAL, 12); bar.rotation.z = Math.PI / 2; bar.position.set(0.2, 0.16, 0); head.add(bar);
          for (var c2 = 0; c2 < 4; c2++) { var coil = G.tor(0.09, 0.035, COPPER, 16); coil.rotation.y = Math.PI / 2; coil.position.set(-0.02 + c2 * 0.15, 0.16, 0); head.add(coil); glows.push(coil); }
          var cap1 = G.cyl(0.07, 0.07, 0.2, M(0x2a50b0, { m: 0.3 }), 14); cap1.position.set(-0.15, 0.1, 0.16); head.add(cap1);
          var cap2 = cap1.clone(); cap2.position.z = -0.16; head.add(cap2);
          tip.set(0.6, 0.16, 0);
          break;
        }
        case "cannon": case "capacitor": case "emp": {
          if (ty === "capacitor") {
            var cb = G.cyl(0.24, 0.24, 0.6, M(0x1f4fc0, { m: 0.35, r: 0.3 }), 28); cb.position.y = 0.3; head.add(cb);
            var ct = G.cyl(0.23, 0.23, 0.02, SILVER, 28); ct.position.y = 0.61; head.add(ct);
            var sp2 = G.box(0.08, 0.56, 0.02, M(0xe8e8e8)); sp2.position.set(0, 0.3, 0.24); head.add(sp2);
            var arc = G.sph(0.08, glowM(0x8fd0ff), 12); arc.position.y = 0.7; head.add(arc); glows.push(arc);
            var cg = glow(0x6fb8ff, 0.8, 0.8); cg.position.y = 0.7; head.add(cg);
            tip.set(0, 0.7, 0);
          } else if (ty === "emp") {
            var dish = new T.Mesh(new T.SphereGeometry(0.34, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), M(0xd8e0ea, { m: 0.7, r: 0.25, ds: true }));
            dish.rotation.z = Math.PI; dish.position.y = 0.42; dish.castShadow = !low; head.add(dish);
            var mast = G.cyl(0.03, 0.03, 0.4, METAL, 8); mast.position.y = 0.3; head.add(mast);
            var emi = G.sph(0.07, glowM(0x7ad0ff), 12); emi.position.y = 0.5; head.add(emi); glows.push(emi);
            spin = new T.Group(); spin.position.y = 0.2; head.add(spin);
            var er = G.tor(0.22, 0.015, glowM(0x7ad0ff), 32); er.rotation.x = Math.PI / 2; spin.add(er);
            tip.set(0, 0.5, 0);
          } else {
            var dome = new T.Mesh(new T.SphereGeometry(0.26, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M(0x8a5a32, { m: 0.8, r: 0.35 }));
            dome.position.y = 0.05; dome.castShadow = !low; head.add(dome);
            var brl = G.cyl(0.09, 0.11, 0.42, M(0x4a4e56, { m: 0.85, r: 0.3 }), 14); brl.rotation.z = Math.PI / 2 - 0.35; brl.position.set(0.2, 0.2, 0); head.add(brl);
            var core = G.sph(0.07, glowM(0xff8a3c), 10); core.position.set(0.38, 0.27, 0); head.add(core); glows.push(core);
            tip.set(0.4, 0.28, 0);
          }
          break;
        }
        case "sniper": case "laser": case "accel": {
          if (ty === "accel") {
            spin = new T.Group(); spin.position.set(-0.08, 0.3, 0); head.add(spin);
            var cyc = G.tor(0.26, 0.05, M(0x5a4a8a, { m: 0.8, r: 0.3 }), 32); spin.add(cyc);
            var cyg = G.tor(0.26, 0.015, glowM(0xa070ff), 32); spin.add(cyg); glows.push(cyg);
            var abr = G.cyl(0.05, 0.06, 0.7, METAL, 12); abr.rotation.z = Math.PI / 2; abr.position.set(0.3, 0.3, 0); head.add(abr);
            var acc = G.sph(0.06, glowM(0xc8a0ff), 10); acc.position.set(0.66, 0.3, 0); head.add(acc);
            var st2 = G.box(0.1, 0.3, 0.1, DARK); st2.position.set(-0.08, 0.1, 0); head.add(st2);
            tip.set(0.68, 0.3, 0);
          } else if (ty === "laser") {
            var lb = G.box(0.4, 0.2, 0.22, M(0x2a2e36, { m: 0.7, r: 0.35 })); lb.position.set(0, 0.16, 0); head.add(lb);
            for (var f2 = 0; f2 < 5; f2++) { var fin = G.box(0.03, 0.12, 0.26, M(0xaab4c0, { m: 0.9, r: 0.3 })); fin.position.set(-0.16 + f2 * 0.07, 0.31, 0); head.add(fin); }
            var lens2 = G.sph(0.08, M(0xff2030, { e: 0xff2030, ei: 2, t: 0.9 }), 14); lens2.position.set(0.23, 0.16, 0); head.add(lens2); glows.push(lens2);
            var lr = G.tor(0.08, 0.02, SILVER, 16); lr.rotation.y = Math.PI / 2; lr.position.set(0.21, 0.16, 0); head.add(lr);
            tip.set(0.27, 0.16, 0);
          } else {
            var sb = G.box(0.22, 0.14, 0.16, M(0x5a6470, { m: 0.85, r: 0.3 })); sb.position.set(-0.06, 0.12, 0); head.add(sb);
            var r1 = G.box(0.72, 0.035, 0.03, METAL); r1.position.set(0.26, 0.15, 0.04); head.add(r1);
            var r2 = r1.clone(); r2.position.z = -0.04; head.add(r2);
            var rc = G.box(0.7, 0.02, 0.02, glowM(0x7ad0ff)); rc.position.set(0.26, 0.15, 0); head.add(rc); glows.push(rc);
            var scope = G.cyl(0.035, 0.035, 0.22, BLACK, 10); scope.rotation.z = Math.PI / 2; scope.position.set(0, 0.24, 0); head.add(scope);
            tip.set(0.64, 0.15, 0);
          }
          break;
        }
        case "frost": case "supercond": case "faraday": {
          if (ty === "faraday") {
            var cage = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.55, 10, 4, true), M(0xc8d0dc, { m: 0.9, r: 0.3, w: true }));
            cage.position.y = 0.3; head.add(cage);
            var cageTop = G.cyl(0.31, 0.31, 0.03, METAL, 10); cageTop.position.y = 0.58; head.add(cageTop);
            var inner = G.sph(0.12, glowM(0x9fd8ff), 16); inner.position.y = 0.3; head.add(inner); glows.push(inner);
            var ig = glow(0x9fd8ff, 0.9, 0.7); ig.position.y = 0.3; head.add(ig);
            spin = cage;
            tip.set(0, 0.3, 0);
          } else {
            var tank = G.cyl(0.17, 0.17, 0.4, M(ty === "frost" ? 0xeef4fa : 0xd6f0ff, { m: 0.4, r: 0.3 }), 20); tank.position.y = 0.22; head.add(tank);
            var bands = ty === "frost" ? 1 : 3;
            for (var bb = 0; bb < bands; bb++) { var band = G.tor(0.175, 0.02, glowM(0x6ad1ff), 24); band.rotation.x = Math.PI / 2; band.position.y = 0.12 + bb * 0.12; head.add(band); glows.push(band); }
            var noz = G.cyl(0.03, 0.07, 0.26, METAL, 12); noz.rotation.z = -Math.PI / 2; noz.position.set(0.22, 0.3, 0); head.add(noz);
            var cap3 = G.sph(0.17, M(0xeef4fa, { m: 0.4, r: 0.3 }), 16); cap3.scale.y = 0.5; cap3.position.y = 0.42; head.add(cap3);
            tip.set(0.36, 0.3, 0);
          }
          break;
        }
        case "tesla": {
          var col2 = G.cyl(0.1, 0.12, 0.6, M(0x30343b, { m: 0.5 }), 16); col2.position.y = 0.3; head.add(col2);
          for (var w = 0; w < 7; w++) { var wd = G.tor(0.115, 0.018, COPPER, 16); wd.rotation.x = Math.PI / 2; wd.position.y = 0.06 + w * 0.075; head.add(wd); }
          var toro = G.tor(0.17 + lv * 0.02, 0.07, SILVER, 32); toro.rotation.x = Math.PI / 2; toro.position.y = 0.66; head.add(toro);
          var spark = glowOwn(0xb0d8ff, 0.8); spark.position.y = 0.66; head.add(spark); glows.push(spark);
          tip.set(0, 0.7, 0);
          break;
        }
        case "osc": {
          var xt = new T.Mesh(new T.CapsuleGeometry(0.11, 0.26, 6, 16), M(0xdfe4ea, { m: 0.95, r: 0.15 }));
          xt.rotation.z = Math.PI / 2; xt.position.y = 0.26; xt.castShadow = !low; head.add(xt);
          for (var pn = 0; pn < 2; pn++) { var leg2 = G.cyl(0.015, 0.015, 0.16, SILVER, 6); leg2.position.set(-0.08 + pn * 0.16, 0.08, 0); head.add(leg2); }
          spin = new T.Group(); spin.position.y = 0.26; head.add(spin);
          var wv = G.tor(0.3, 0.012, glowM(0xffffff), 40); wv.rotation.x = Math.PI / 2; spin.add(wv); glows.push(wv);
          tip.set(0, 0.26, 0);
          break;
        }
        case "transformer": {
          var core2 = G.box(0.5, 0.42, 0.18, M(0x5a6068, { m: 0.75, r: 0.45 })); core2.position.y = 0.22; head.add(core2);
          for (var ln2 = 0; ln2 < 6; ln2++) { var lam = G.box(0.505, 0.005, 0.185, M(0x3a3e44)); lam.position.y = 0.04 + ln2 * 0.07; head.add(lam); }
          var cA = G.cyl(0.11, 0.11, 0.3, COPPER, 18); cA.position.set(-0.13, 0.22, 0); head.add(cA);
          var cB = cA.clone(); cB.position.x = 0.13; head.add(cB);
          var tl = G.sph(0.04, glowM(0xffd04a), 8); tl.position.set(0, 0.47, 0); head.add(tl); glows.push(tl);
          break;
        }
        case "relay": {
          var ms = G.cyl(0.025, 0.04, 0.8, METAL, 8); ms.position.y = 0.4; head.add(ms);
          for (var cr = 0; cr < 3; cr++) { var bar2 = G.box(0.36 - cr * 0.08, 0.02, 0.02, METAL); bar2.position.y = 0.3 + cr * 0.18; bar2.rotation.y = cr * 0.6; head.add(bar2); }
          var bl = G.sph(0.045, glowM(0xff3040), 8); bl.position.y = 0.82; head.add(bl); glows.push(bl);
          break;
        }
        case "solar": {
          var pc = document.createElement("canvas"); pc.width = pc.height = 64;
          var pg = pc.getContext("2d"); pg.fillStyle = "#0d2a6a"; pg.fillRect(0, 0, 64, 64);
          pg.strokeStyle = "#7ea8ff"; pg.lineWidth = 1;
          for (var q = 0; q <= 4; q++) { pg.beginPath(); pg.moveTo(q * 16, 0); pg.lineTo(q * 16, 64); pg.stroke(); pg.beginPath(); pg.moveTo(0, q * 16); pg.lineTo(64, q * 16); pg.stroke(); }
          var ptex = new T.CanvasTexture(pc); ptex.encoding = T.sRGBEncoding;
          var panel = new T.Mesh(new T.BoxGeometry(0.72, 0.03, 0.72), [METAL, METAL, new T.MeshStandardMaterial({ map: ptex, metalness: 0.6, roughness: 0.2 }), METAL, METAL, METAL]);
          panel.castShadow = !low; panel.rotation.z = 0.45; panel.position.y = 0.32; head.add(panel);
          var post = G.cyl(0.03, 0.03, 0.3, METAL, 8); post.position.y = 0.15; head.add(post);
          break;
        }
      }
      g.traverse(function (o) { if (o.isMesh && o.material === e) glows.push(o); });
      return { g: g, head: head, spin: spin, tip: tip, glows: glows };
    }

    // ---------------- 敵人模型 ----------------
    function buildEnemy(ty) {
      var def = D.ENEMIES[ty], col = def.color, g = new T.Group(), body = new T.Group(), parts = {};
      g.add(body);
      var hover = def.fly ? 1.0 : 0;
      body.position.y = hover;
      switch (ty) {
        case "bit": {
          var sh = G.sph(0.2, M(0x1a5a2a, { m: 0.5, r: 0.3, e: col, ei: 0.25 }), 16); sh.scale.set(1.2, 0.7, 0.95); sh.position.y = 0.18; body.add(sh);
          var hd = G.sph(0.1, M(0x123a1c, { m: 0.5, r: 0.35 }), 12); hd.position.set(0.24, 0.16, 0); body.add(hd);
          [-1, 1].forEach(function (sd) { var ey = G.sph(0.03, glowM(col), 8); ey.position.set(0.31, 0.2, sd * 0.05); body.add(ey); });
          parts.legs = [];
          for (var i = 0; i < 6; i++) {
            var lg = G.cyl(0.012, 0.012, 0.22, BLACK, 5); lg.rotation.x = (i % 2 ? 1 : -1) * 1.0;
            lg.position.set(-0.12 + Math.floor(i / 2) * 0.12, 0.08, (i % 2 ? 1 : -1) * 0.14); body.add(lg); parts.legs.push(lg);
          }
          var stripe = G.box(0.4, 0.01, 0.03, glowM(col)); stripe.position.set(0, 0.32, 0); body.add(stripe);
          break;
        }
        case "packet": {
          var cube = G.box(0.28, 0.28, 0.28, M(0x0a2a3a, { m: 0.6, r: 0.2, t: 0.85 })); cube.position.y = 0.3; body.add(cube);
          var edges = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(0.3, 0.3, 0.3)), new T.LineBasicMaterial({ color: col }));
          edges.position.y = 0.3; body.add(edges);
          var gg = glow(col, 0.7, 0.6); gg.position.y = 0.3; body.add(gg);
          parts.spin = [cube, edges];
          break;
        }
        case "drone": {
          var db = G.box(0.26, 0.08, 0.26, M(0x2a2a2a, { m: 0.6, r: 0.35 })); body.add(db);
          var dome = G.sph(0.08, M(0x111, { m: 0.4, r: 0.1, e: col, ei: 0.4 }), 12); dome.position.y = 0.05; body.add(dome);
          parts.rotors = [];
          [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (p) {
            var arm = G.box(0.24, 0.025, 0.03, DARK); arm.position.set(p[0] * 0.13, 0, p[1] * 0.13); arm.rotation.y = p[0] * p[1] > 0 ? -Math.PI / 4 : Math.PI / 4; body.add(arm);
            var rot = new T.Mesh(new T.CylinderGeometry(0.11, 0.11, 0.005, 16), M(0xcccccc, { t: 0.35 })); rot.position.set(p[0] * 0.21, 0.04, p[1] * 0.21); body.add(rot);
            var bl = G.box(0.2, 0.008, 0.025, M(0x333333)); bl.position.copy(rot.position); body.add(bl); parts.rotors.push(bl);
          });
          var lt = glow(col, 0.5, 0.9); lt.position.y = -0.06; body.add(lt);
          break;
        }
        case "firewall": {
          var hx = G.cyl(0.3, 0.32, 0.34, M(0x6a2a10, { m: 0.6, r: 0.4 }), 6); hx.position.y = 0.17; body.add(hx);
          for (var b = 0; b < 3; b++) { var brk = G.cyl(0.305, 0.305, 0.02, M(0x2a0e04), 6); brk.position.y = 0.06 + b * 0.11; body.add(brk); }
          var fl = G.cyl(0.18, 0.24, 0.12, glowM(col), 6); fl.position.y = 0.4; body.add(fl);
          var fg = glow(0xff7a2c, 0.9, 0.8); fg.position.y = 0.5; body.add(fg);
          parts.flame = fg;
          break;
        }
        case "worm": {
          parts.segs = [];
          for (var sg = 0; sg < 4; sg++) { var seg = G.sph(0.13 - sg * 0.02, M(0x4a2070, { m: 0.4, r: 0.35, e: col, ei: 0.3 }), 12); seg.position.set(0.12 - sg * 0.16, 0.14, 0); body.add(seg); parts.segs.push(seg); }
          var shb = new T.Mesh(new T.SphereGeometry(0.4, 20, 14), M(0xb36bff, { e: 0x7a3aff, ei: 0.6, t: 0.22 }));
          shb.position.y = 0.16; body.add(shb); parts.shield = shb;
          break;
        }
        case "splitter": {
          var ico = new T.Mesh(new T.IcosahedronGeometry(0.22, 0), M(0x8a1022, { m: 0.4, r: 0.3, e: col, ei: 0.35 }));
          ico.position.y = 0.3; ico.castShadow = !low; body.add(ico);
          var spikes = new T.Group(); spikes.position.y = 0.3; body.add(spikes);
          var ig = new T.IcosahedronGeometry(1, 0), pos = ig.attributes.position;
          for (var v = 0; v < pos.count; v += 3) {
            var dir = new T.Vector3(pos.getX(v), pos.getY(v), pos.getZ(v)).normalize();
            var cone = new T.Mesh(new T.ConeGeometry(0.035, 0.12, 6), glowM(col));
            cone.position.copy(dir.clone().multiplyScalar(0.24)); cone.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir); spikes.add(cone);
          }
          parts.spin = [ico, spikes];
          break;
        }
        case "trojan": {
          var oc = new T.Mesh(new T.OctahedronGeometry(0.24, 0), M(0xc0c8ff, { e: 0x6070ff, ei: 0.4, t: 0.35, m: 0.2, r: 0.1 }));
          oc.position.y = 0.35; body.add(oc);
          var ow = new T.LineSegments(new T.EdgesGeometry(new T.OctahedronGeometry(0.25, 0)), new T.LineBasicMaterial({ color: 0xdde3ff, transparent: true, opacity: 0.5 }));
          ow.position.y = 0.35; body.add(ow);
          parts.spin = [oc, ow]; parts.ghost = [oc.material, ow.material];
          oc.material = oc.material.clone(); ow.material = ow.material.clone(); parts.ghost = [oc.material, ow.material];
          break;
        }
        case "healer": {
          var ht = G.tor(0.2, 0.06, M(0x1a6a52, { m: 0.5, r: 0.3, e: col, ei: 0.4 }), 24); ht.rotation.x = Math.PI / 2; ht.position.y = 0.2; body.add(ht);
          var cr1 = G.box(0.08, 0.3, 0.08, glowM(col)); cr1.position.y = 0.4; body.add(cr1);
          var cr2 = G.box(0.26, 0.08, 0.08, glowM(col)); cr2.position.y = 0.44; body.add(cr2);
          var hg = glow(col, 1.0, 0.5); hg.position.y = 0.3; body.add(hg); parts.pulse = hg;
          break;
        }
        case "kernel": {
          var kb = G.box(0.8, 0.8, 0.8, M(0x2a0a10, { m: 0.7, r: 0.3 })); kb.position.y = 0.5; body.add(kb);
          var ke = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(0.82, 0.82, 0.82)), new T.LineBasicMaterial({ color: col }));
          ke.position.y = 0.5; body.add(ke);
          var kc = G.sph(0.2, glowM(col), 16); kc.position.y = 0.5; body.add(kc);
          var kr = G.tor(0.62, 0.03, glowM(0xff6688), 40); kr.position.y = 0.5; body.add(kr);
          var kr2 = G.tor(0.7, 0.02, glowM(0xffaa33), 40); kr2.position.y = 0.5; kr2.rotation.x = Math.PI / 2; body.add(kr2);
          var kgl = glow(col, 2.2, 0.6); kgl.position.y = 0.5; body.add(kgl);
          parts.spin = [kb, ke]; parts.rings = [kr, kr2];
          break;
        }
        case "daemon": {
          var dbd = G.sph(0.35, M(0x3a1a00, { m: 0.6, r: 0.3, e: col, ei: 0.3 }), 20); dbd.scale.set(1.3, 0.7, 1); body.add(dbd);
          parts.wings = [];
          [-1, 1].forEach(function (sd) {
            var wg = G.box(0.5, 0.03, 0.7, M(0x221100, { m: 0.5, r: 0.4, e: 0xff5500, ei: 0.3 })); wg.position.set(-0.1, 0.05, sd * 0.55); wg.rotation.x = sd * 0.25; body.add(wg); parts.wings.push(wg);
          });
          [-1, 1].forEach(function (sd) { var ey = G.sph(0.06, glowM(0xffee00), 8); ey.position.set(0.42, 0.08, sd * 0.12); body.add(ey); });
          var dg = glow(col, 2.4, 0.5); body.add(dg);
          break;
        }
        case "singularity": {
          var bh = G.sph(0.45, M(0x000000, { m: 0, r: 1 }), 24); bh.position.y = 0.6; body.add(bh);
          var disk = new T.Mesh(new T.RingGeometry(0.55, 1.05, 48), M(0x9a55ff, { e: 0xb070ff, ei: 1.6, t: 0.75, ds: true }));
          disk.rotation.x = -Math.PI / 2 + 0.35; disk.position.y = 0.6; body.add(disk);
          var dk2 = new T.Mesh(new T.RingGeometry(0.47, 0.55, 48), M(0xffffff, { e: 0xffffff, ei: 2, t: 0.9, ds: true }));
          dk2.rotation.x = -Math.PI / 2 + 0.35; dk2.position.y = 0.6; body.add(dk2);
          var sgl = glow(0x9a55ff, 3.2, 0.6); sgl.position.y = 0.6; body.add(sgl);
          parts.disk = [disk, dk2];
          break;
        }
      }
      // 影子圓點（飛行單位也看得出位置）
      var shadow = new T.Mesh(new T.CircleGeometry(def.boss ? 0.55 : 0.22, 16), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; g.add(shadow);
      // 血條／護盾條
      var top = (def.boss ? 1.5 : 0.7) + hover;
      var hpBg = new T.Sprite(new T.SpriteMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthTest: false }));
      var hpW = def.boss ? 1.4 : 0.6;
      hpBg.scale.set(hpW + 0.04, 0.09, 1); hpBg.position.y = top; hpBg.renderOrder = 10; g.add(hpBg);
      var hpFg = new T.Sprite(new T.SpriteMaterial({ color: 0x5dff7a, depthTest: false }));
      hpFg.center.set(0, 0.5); hpFg.scale.set(hpW, 0.06, 1); hpFg.position.set(-hpW / 2, top, 0); hpFg.renderOrder = 11; g.add(hpFg);
      var shFg = new T.Sprite(new T.SpriteMaterial({ color: 0x7ab8ff, depthTest: false }));
      shFg.center.set(0, 0.5); shFg.scale.set(hpW, 0.04, 1); shFg.position.set(-hpW / 2, top + 0.08, 0); shFg.renderOrder = 11; g.add(shFg);
      var ice = new T.Mesh(new T.BoxGeometry(0.5, 0.5, 0.5), M(0xbfefff, { e: 0x6ad1ff, ei: 0.6, t: 0.4 }));
      ice.position.y = 0.25 + hover; ice.visible = false; g.add(ice);
      var slowGl = glow(0x6ad1ff, 0.9, 0.5); slowGl.position.y = 0.2 + hover; slowGl.visible = false; g.add(slowGl);
      if (def.boss) body.scale.setScalar(1.2);
      return { g: g, body: body, parts: parts, hpFg: hpFg, shFg: shFg, hpW: hpW, ice: ice, slowGl: slowGl, def: def };
    }

    // ---------------- 狀態同步 ----------------
    var towerObjs = {}, enemyObjs = {}, beamObjs = {}, auraObjs = {};
    var fxList = [], lastFx = -1, clock = 0;
    var effectGroup = new T.Group(); scene.add(effectGroup);

    function syncTowers(s) {
      var seen = {};
      s.towers.forEach(function (tw) {
        seen[tw.id] = 1;
        var o = towerObjs[tw.id], p = s.players[tw.o], oc = D.PLAYER_COLORS[p ? p.ci : 0];
        var key = tw.ty + ":" + tw.lv;
        if (!o || o.key !== key) {
          if (o) scene.remove(o.m.g);
          var m = buildTower(tw.ty, tw.lv, oc);
          G.at(m.g, wx(tw.x) + 0.5, 0, wz(tw.y) + 0.5);
          scene.add(m.g);
          o = towerObjs[tw.id] = { m: m, key: key, ang: tw.ang || Math.PI, born: o ? o.born : clock, kick: 0 };
          if (D.TOWERS[tw.ty].kind === "aura") {
            var st = window.PriTestDenshiCore.stats(s, tw);
            var ar = new T.Mesh(new T.RingGeometry(st.range - 0.06, st.range, 64), M(0x9fd8ff, { e: 0x9fd8ff, ei: 1, t: 0.25, ds: true }));
            ar.rotation.x = -Math.PI / 2; ar.position.y = 0.03; m.g.add(ar); o.aura = ar;
          }
        }
        // 轉向（最短角度平滑）
        var target = tw.ang === undefined ? o.ang : tw.ang, da = target - o.ang;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        o.ang += da * 0.35;
        o.m.head.rotation.y = -o.ang;
        if (o.m.spin) { if (tw.ty === "gun" || tw.ty === "transistor") o.m.spin.rotation.x += (tw.cd > 0 ? 0.6 : 0.05); else o.m.spin.rotation.y += 0.03; if (tw.ty === "accel") o.m.spin.rotation.x = Math.PI / 2; }
        var off = tw.oh || window.PriTestDenshiCore.offline(s, tw);
        var ocOn = p && p.ocU > s.time;
        var hot = tw.heat || 0;
        o.m.glows.forEach(function (gm) {
          if (gm.isSprite) { gm.visible = !off; gm.material.opacity = 0.6 + Math.sin(clock * 20 + tw.id) * 0.3; return; }
          gm.visible = !off || Math.sin(clock * 25) > 0;
        });
        // 開火後座力
        o.kick = Math.max(0, (o.kick || 0) - 0.12);
        o.m.head.position.x = -Math.cos(o.ang) * o.kick * 0.05;
        o.m.head.position.z = Math.sin(o.ang) * o.kick * 0.05;
        o.m.g.position.y = off ? -0.02 + Math.sin(clock * 30) * 0.01 : 0;
        // 剛蓋好：從上方落下
        var age = clock - o.born;
        if (age < 0.35) { var k = age / 0.35; o.m.g.scale.setScalar(0.6 + 0.4 * k); o.m.g.position.y += (1 - k) * 0.8; } else o.m.g.scale.setScalar(1);
        if (!o.status) { o.status = glowOwn(0xff4030, 0.6); o.status.position.y = 1.0; o.m.g.add(o.status); }
        var hiStat = tw.chg > s.time || ocOn;
        o.status.visible = off || hot > 0.5 || hiStat;
        if (o.status.visible) {
          o.status.material.color.setHex(ocOn ? 0xffa030 : tw.chg > s.time ? 0x9fd8ff : off ? 0x888888 : 0xff5030);
          o.status.material.opacity = hiStat ? 0.9 : off ? 0.5 + Math.sin(clock * 12) * 0.3 : hot;
          o.status.scale.setScalar(hiStat ? 1.2 + Math.sin(clock * 30) * 0.3 : 0.6);
        }
        // 雷射光束
        if (tw.bt) {
          var e = enemyObjs[tw.bt];
          if (e) {
            var b = beamObjs[tw.id];
            if (!b) {
              b = beamObjs[tw.id] = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 1, 8, 1, true), new T.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false }));
              b.userData.glow = glowOwn(0xff2030, 0.5); scene.add(b); scene.add(b.userData.glow);
            }
            var from = o.m.tip.clone(); o.m.head.localToWorld(from);
            var to = new T.Vector3(e.g.position.x, e.body.position.y + 0.3, e.g.position.z);
            var len = from.distanceTo(to);
            b.position.copy(from).add(to).multiplyScalar(0.5);
            b.scale.set(1 + Math.sin(clock * 50) * 0.3 + Math.min(2, tw.held || 0), len, 1 + Math.min(2, tw.held || 0));
            b.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), to.clone().sub(from).normalize());
            b.visible = true; b.userData.glow.visible = true; b.userData.glow.position.copy(to);
            b.userData.seen = clock;
            // 光束折射：從第一個目標折到第二個目標
            var e2 = tw.bt2 && enemyObjs[tw.bt2];
            var rb = b.userData.refr;
            if (e2) {
              if (!rb) { rb = b.userData.refr = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 1, 6, 1, true), new T.MeshBasicMaterial({ color: 0xff88aa, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false })); scene.add(rb); }
              var to2 = new T.Vector3(e2.g.position.x, e2.body.position.y + 0.3, e2.g.position.z);
              rb.position.copy(to).add(to2).multiplyScalar(0.5);
              rb.scale.set(1, to.distanceTo(to2), 1);
              rb.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), to2.clone().sub(to).normalize());
              rb.visible = true;
            } else if (rb) rb.visible = false;
          }
        }
      });
      Object.keys(towerObjs).forEach(function (id) { if (!seen[id]) { scene.remove(towerObjs[id].m.g); delete towerObjs[id]; } });
      Object.keys(beamObjs).forEach(function (id) {
        var b = beamObjs[id];
        if (b.userData.seen !== clock) { b.visible = false; b.userData.glow.visible = false; if (b.userData.refr) b.userData.refr.visible = false; }
        if (!seen[id]) { scene.remove(b); scene.remove(b.userData.glow); if (b.userData.refr) scene.remove(b.userData.refr); delete beamObjs[id]; }
      });
    }

    function syncEnemies(s, dt) {
      var seen = {}, k = 1 - Math.exp(-dt * 14);
      s.enemies.forEach(function (e) {
        seen[e.id] = 1;
        var o = enemyObjs[e.id];
        var tx = wx(0) + e.x, tz = wz(0) + e.y;
        if (!o) {
          o = enemyObjs[e.id] = buildEnemy(e.ty);
          o.g.position.set(tx, 0, tz);
          o.face = 0;
          scene.add(o.g);
        }
        var px = o.g.position.x, pz = o.g.position.z;
        var jump = (tx - px) * (tx - px) + (tz - pz) * (tz - pz) > 4;
        o.g.position.x = jump ? tx : px + (tx - px) * k;
        o.g.position.z = jump ? tz : pz + (tz - pz) * k;
        var mvx = o.g.position.x - px, mvz = o.g.position.z - pz;
        if (mvx * mvx + mvz * mvz > 1e-6) {
          var fa = Math.atan2(mvz, mvx), d = fa - o.face;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          o.face += d * 0.25;
        }
        o.body.rotation.y = -o.face;
        var P = o.parts, frozen = e.stunU > s.time, slowed = e.slowU > s.time;
        var tt = frozen ? 0 : clock;
        if (P.legs) P.legs.forEach(function (lg, i) { lg.rotation.z = Math.sin(tt * 18 + i * 1.7) * 0.5; });
        if (P.spin) P.spin.forEach(function (m) { m.rotation.y += frozen ? 0 : 0.04; m.rotation.x += frozen ? 0 : 0.02; });
        if (P.rotors) P.rotors.forEach(function (r) { r.rotation.y += frozen ? 0 : 0.9; });
        if (P.segs) P.segs.forEach(function (sg, i) { sg.position.z = Math.sin(tt * 8 - i * 0.9) * 0.06; });
        if (P.shield) { P.shield.visible = e.sh > 0; P.shield.scale.setScalar(0.7 + 0.3 * (e.msh ? e.sh / e.msh : 0)); }
        if (P.ghost) { var vis = e.revU > s.time ? 0.85 : 0.18 + Math.sin(clock * 5) * 0.06; P.ghost[0].opacity = vis * 0.6; P.ghost[1].opacity = vis; }
        if (P.pulse) P.pulse.scale.setScalar(0.8 + Math.sin(clock * 4) * 0.3);
        if (P.rings) { P.rings[0].rotation.y += 0.03; P.rings[1].rotation.z += 0.02; }
        if (P.wings) P.wings.forEach(function (wg, i) { wg.rotation.x = (i ? 1 : -1) * (0.25 + Math.sin(tt * 6) * 0.35); });
        if (P.disk) P.disk.forEach(function (dk) { dk.rotation.z += 0.02; });
        if (o.def.fly) o.body.position.y = 1 + Math.sin(clock * 3 + e.id) * 0.06;
        else if (!o.def.boss) o.body.position.y = Math.abs(Math.sin(tt * 10 + e.id)) * 0.03;
        var r = Math.max(0, e.hp / e.mhp);
        o.hpFg.scale.x = o.hpW * r;
        o.hpFg.material.color.setHex(r > 0.5 ? 0x5dff7a : r > 0.25 ? 0xffd23c : 0xff4a4a);
        o.shFg.visible = e.sh > 0;
        if (e.sh > 0) o.shFg.scale.x = o.hpW * (e.sh / e.msh);
        o.ice.visible = frozen;
        o.slowGl.visible = slowed && !frozen;
      });
      Object.keys(enemyObjs).forEach(function (id) { if (!seen[id]) { scene.remove(enemyObjs[id].g); delete enemyObjs[id]; } });
    }

    // ---------------- 特效 ----------------
    function addFx(o) { fxList.push(o); if (o.obj) effectGroup.add(o.obj); }
    function lineObj(points, color, op) {
      var geo = new T.BufferGeometry().setFromPoints(points);
      return new T.Line(geo, new T.LineBasicMaterial({ color: color, transparent: true, opacity: op || 1, blending: T.AdditiveBlending, depthWrite: false }));
    }
    function ringObj(color, r0) {
      var m = new T.Mesh(new T.RingGeometry(0.85, 1, 48), new T.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.9, side: T.DoubleSide, blending: T.AdditiveBlending, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.scale.setScalar(r0 || 0.1);
      return m;
    }
    function jag(a, b, n, amp) {
      var pts = [a.clone()];
      for (var i = 1; i < n; i++) {
        var p = a.clone().lerp(b, i / n);
        p.x += (Math.random() - 0.5) * amp; p.y += (Math.random() - 0.5) * amp; p.z += (Math.random() - 0.5) * amp;
        pts.push(p);
      }
      pts.push(b.clone());
      return pts;
    }
    function towerTip(id, fx, fy) {
      var o = towerObjs[id];
      if (o) { var v = o.m.tip.clone(); o.m.head.localToWorld(v); o.kick = 1; return v; }
      return new T.Vector3(wx(0) + fx, 0.6, wz(0) + fy);
    }
    function v3(x, y, h) { return new T.Vector3(wx(0) + x, h, wz(0) + y); }
    function spawnFx(f, s) {
      var def, c, o;
      switch (f.k) {
        case "shot": {
          def = D.TOWERS[f.ty] || D.TOWERS.gun;
          c = f.ty === "transistor" ? 0xff5070 : f.ty === "sniper" ? 0x9fe8ff : 0xffe27a;
          o = new T.Group();
          var core = glow(c, f.ty === "sniper" ? 0.55 : 0.32, 1); o.add(core);
          var trail = new T.Mesh(new T.CylinderGeometry(0.015, 0.015, 0.4, 6), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.7, blending: T.AdditiveBlending }));
          trail.rotation.z = Math.PI / 2; o.add(trail);
          var from = towerTip(f.tw, f.x, f.y);
          o.position.copy(from);
          addFx({ obj: o, t0: clock, dur: Math.max(0.05, f.d), kind: "shot", from: from, e: f.e, trail: trail });
          var flash = glow(0xfff0b0, 0.5, 1); flash.position.copy(from);
          addFx({ obj: flash, t0: clock, dur: 0.07, kind: "fade" });
          break;
        }
        case "shell": case "spray": {
          c = f.k === "spray" ? 0xa8e8ff : (f.ty2 === "emp" ? 0x7ad0ff : f.ty2 === "capacitor" ? 0x6fb8ff : 0xff9a3c);
          o = glow(c, f.k === "spray" ? 0.5 : 0.45, 1);
          var fr = towerTip(f.tw, f.x, f.y);
          o.position.copy(fr);
          addFx({ obj: o, t0: clock, dur: Math.max(0.05, f.d), kind: "arc", from: fr, to: v3(f.tx, f.ty, 0.15), h: f.k === "spray" ? 0.3 : 1.2 });
          break;
        }
        case "boom": {
          c = f.ty === "emp" ? 0x7ad0ff : f.ty === "capacitor" ? 0x8fc8ff : f.ty === "frost" ? 0xa8e8ff : 0xff8a3c;
          o = ringObj(c, 0.1); o.position.copy(v3(f.x, f.y, 0.08));
          addFx({ obj: o, t0: clock, dur: 0.4, kind: "ring", r: f.r || 1 });
          var fl = glowOwn(c, 0.3); fl.position.copy(v3(f.x, f.y, 0.35));
          addFx({ obj: fl, t0: clock, dur: 0.3, kind: "grow", r: (f.r || 1) * 2.2 });
          if (f.ty === "capacitor" || f.ty === "emp") for (var b = 0; b < 4; b++) {
            var a = Math.random() * Math.PI * 2, end = v3(f.x + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r, 0.1);
            addFx({ obj: lineObj(jag(v3(f.x, f.y, 0.4), end, 5, 0.25), 0xcfe8ff), t0: clock, dur: 0.18, kind: "fadeLine" });
          }
          break;
        }
        case "rail": {
          c = f.ty2 === "accel" ? 0xb080ff : 0xffa050;
          var a2 = towerTip(f.tw, f.x, f.y), b2 = v3(f.tx, f.ty, a2.y);
          var len = a2.distanceTo(b2);
          var beam = new T.Mesh(new T.CylinderGeometry(f.ty2 === "accel" ? 0.09 : 0.05, f.ty2 === "accel" ? 0.09 : 0.05, len, 10, 1, true), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, blending: T.AdditiveBlending, depthWrite: false }));
          beam.position.copy(a2).add(b2).multiplyScalar(0.5);
          beam.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b2.clone().sub(a2).normalize());
          addFx({ obj: beam, t0: clock, dur: f.ty2 === "accel" ? 0.45 : 0.22, kind: "thin" });
          var inner = beam.clone(); inner.material = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: T.AdditiveBlending, depthWrite: false }); inner.scale.set(0.35, 1, 0.35);
          addFx({ obj: inner, t0: clock, dur: 0.15, kind: "thin" });
          break;
        }
        case "chain": {
          var pts = f.p.map(function (p, i) { return i === 0 ? towerTip(f.tw, p[0], p[1]) : v3(p[0], p[1], 0.35); });
          for (var i = 1; i < pts.length; i++) {
            addFx({ obj: lineObj(jag(pts[i - 1], pts[i], 7, 0.22), 0xbfe0ff), t0: clock, dur: 0.22, kind: "fadeLine" });
            addFx({ obj: lineObj(jag(pts[i - 1], pts[i], 5, 0.35), 0x6aa8ff, 0.6), t0: clock, dur: 0.16, kind: "fadeLine" });
            var hit = glowOwn(0x9fd0ff, 0.6); hit.position.copy(pts[i]);
            addFx({ obj: hit, t0: clock, dur: 0.2, kind: "fade" });
          }
          break;
        }
        case "pulse": {
          o = ringObj(0xffffff, 0.1); o.position.copy(v3(f.x, f.y, 0.3));
          addFx({ obj: o, t0: clock, dur: 0.45, kind: "ring", r: f.r });
          var o2 = ringObj(0x9fd8ff, 0.1); o2.position.copy(v3(f.x, f.y, 0.1));
          addFx({ obj: o2, t0: clock + 0.08, dur: 0.45, kind: "ring", r: f.r });
          break;
        }
        case "freeze": {
          o = ringObj(0xd6f4ff, 0.1); o.position.copy(v3(f.x, f.y, 0.1));
          addFx({ obj: o, t0: clock, dur: 0.5, kind: "ring", r: 2.8 });
          (f.e || []).forEach(function (id) {
            var eo = enemyObjs[id];
            if (eo) { var sn = glowOwn(0xd6f4ff, 0.8); sn.position.copy(eo.g.position); sn.position.y = 0.4; addFx({ obj: sn, t0: clock, dur: 0.4, kind: "fade" }); }
          });
          break;
        }
        case "die": {
          def = D.ENEMIES[f.ty] || D.ENEMIES.bit;
          var n = f.b ? 26 : 9, h0 = f.f ? 1 : 0.3;
          for (var q = 0; q < n; q++) {
            var bit = new T.Mesh(new T.BoxGeometry(0.06, 0.06, 0.06), new T.MeshBasicMaterial({ color: q % 3 ? def.color : 0xffffff, transparent: true }));
            bit.position.copy(v3(f.x, f.y, h0));
            var ang = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * (f.b ? 3 : 1.8);
            addFx({ obj: bit, t0: clock, dur: 0.6 + Math.random() * 0.3, kind: "debris", vx: Math.cos(ang) * sp, vz: Math.sin(ang) * sp, vy: 1.5 + Math.random() * 2.5 });
          }
          var df = glowOwn(def.color, 0.4); df.position.copy(v3(f.x, f.y, h0));
          addFx({ obj: df, t0: clock, dur: 0.3, kind: "grow", r: f.b ? 4 : 1.4 });
          break;
        }
        case "leak": {
          if (coreObj) coreObj.flash = 1;
          shake = 0.25;
          break;
        }
        case "bolt": {
          var top = v3(f.x + (Math.random() - 0.5) * 2, f.y + (Math.random() - 0.5) * 2, 9), bot = v3(f.x, f.y, 0.1);
          addFx({ obj: lineObj(jag(top, bot, 14, 0.7), 0xffffff), t0: clock, dur: 0.3, kind: "fadeLine" });
          addFx({ obj: lineObj(jag(top, bot, 10, 1.0), 0x8fb0ff, 0.7), t0: clock, dur: 0.24, kind: "fadeLine" });
          var bf = glowOwn(0xc8d8ff, 1); bf.position.copy(bot);
          addFx({ obj: bf, t0: clock, dur: 0.35, kind: "grow", r: 3 });
          var br2 = ringObj(0xb0c4ff, 0.1); br2.position.copy(bot);
          addFx({ obj: br2, t0: clock, dur: 0.35, kind: "ring", r: 1.1 });
          flashLight = 1;
          break;
        }
        case "emp": {
          o = ringObj(0xb070ff, 0.1); o.position.copy(v3(f.x, f.y, 0.2));
          addFx({ obj: o, t0: clock, dur: 0.7, kind: "ring", r: f.r });
          var eg = glowOwn(0xb070ff, 1); eg.position.copy(v3(f.x, f.y, 0.6));
          addFx({ obj: eg, t0: clock, dur: 0.5, kind: "grow", r: 5 });
          break;
        }
        case "tunnel": {
          [[f.x, f.y], [f.tx, f.ty]].forEach(function (p) { var tg = glowOwn(0xd17bff, 0.3); tg.position.copy(v3(p[0], p[1], 0.3)); addFx({ obj: tg, t0: clock, dur: 0.35, kind: "grow", r: 1.6 }); });
          addFx({ obj: lineObj([v3(f.x, f.y, 0.3), v3(f.tx, f.ty, 0.3)], 0xd17bff, 0.8), t0: clock, dur: 0.3, kind: "fadeLine" });
          break;
        }
        case "heal": {
          o = ringObj(0x6bffcf, 0.1); o.position.copy(v3(f.x, f.y, 0.08));
          addFx({ obj: o, t0: clock, dur: 0.5, kind: "ring", r: 1.5 });
          break;
        }
        case "summon": {
          var sg = glowOwn(0xff8a00, 0.4); sg.position.copy(v3(f.x, f.y, 1));
          addFx({ obj: sg, t0: clock, dur: 0.4, kind: "grow", r: 2 });
          break;
        }
        case "build": case "up": case "evo": case "sell": {
          c = f.k === "evo" ? 0xffd04a : f.k === "sell" ? 0xff6a50 : 0x7dffb0;
          for (var rr = 0; rr < (f.k === "evo" ? 3 : 1); rr++) {
            o = ringObj(c, 0.45); o.position.copy(v3(f.x, f.y, 0.1));
            addFx({ obj: o, t0: clock + rr * 0.12, dur: 0.6, kind: "rise", r: 0.45 });
          }
          break;
        }
        case "surge": { flashLight = 0.8; break; }
        case "skill": {
          if (f.s === "emp") {
            o = ringObj(0x9fd8ff, 0.1); o.position.set(0, 0.3, 0);
            addFx({ obj: o, t0: clock, dur: 0.9, kind: "ring", r: 14 });
            var o3 = ringObj(0xffffff, 0.1); o3.position.set(0, 0.6, 0);
            addFx({ obj: o3, t0: clock + 0.1, dur: 0.8, kind: "ring", r: 12 });
            flashLight = 1.2; shake = 0.2;
          } else if (f.s === "oc") {
            s.towers.forEach(function (tw) {
              if (tw.o !== f.o) return;
              var r3 = ringObj(0xffa030, 0.5); r3.position.copy(v3(tw.x + 0.5, tw.y + 0.5, 0.1));
              addFx({ obj: r3, t0: clock + Math.random() * 0.2, dur: 0.6, kind: "rise", r: 0.5 });
            });
          } else if (f.s === "fix" && coreObj) {
            var cg2 = glowOwn(0x6bff8a, 1); cg2.position.copy(coreObj.g.position); cg2.position.y = 1;
            addFx({ obj: cg2, t0: clock, dur: 0.8, kind: "grow", r: 4 });
            for (var fr2 = 0; fr2 < 3; fr2++) { var hr = ringObj(0x6bff8a, 0.6); hr.position.copy(coreObj.g.position); hr.position.y = 0.1; addFx({ obj: hr, t0: clock + fr2 * 0.15, dur: 0.7, kind: "rise", r: 0.8 }); }
          }
          break;
        }
        case "phase": {
          var pg2 = glowOwn(f.n === 3 ? 0xff3060 : 0xb070ff, 1); pg2.position.copy(v3(f.x, f.y, 0.8));
          addFx({ obj: pg2, t0: clock, dur: 0.9, kind: "grow", r: 7 });
          var pr2 = ringObj(0xb070ff, 0.1); pr2.position.copy(v3(f.x, f.y, 0.1));
          addFx({ obj: pr2, t0: clock, dur: 1, kind: "ring", r: 5 });
          flashLight = 1.5; shake = 0.35;
          break;
        }
        case "eat": case "split": {
          c = f.k === "eat" ? 0xff3355 : 0xffb040;
          for (var q2 = 0; q2 < 14; q2++) {
            var chunk = new T.Mesh(new T.BoxGeometry(0.12, 0.05, 0.12), new T.MeshBasicMaterial({ color: q2 % 2 ? c : 0x2d3138, transparent: true }));
            chunk.position.copy(v3(f.x, f.y, 0.2));
            var a3 = Math.random() * Math.PI * 2, sp3 = 1 + Math.random() * 2;
            addFx({ obj: chunk, t0: clock, dur: 0.8, kind: "debris", vx: Math.cos(a3) * sp3, vz: Math.sin(a3) * sp3, vy: 2 + Math.random() * 2 });
          }
          shake = 0.15;
          break;
        }
      }
      void s;
    }
    var shake = 0, flashLight = 0;
    function updateFx(dt) {
      var keep = [];
      fxList.forEach(function (f) {
        var age = clock - f.t0, k = age / f.dur;
        if (age < 0) { if (f.obj) f.obj.visible = false; keep.push(f); return; }
        if (f.obj) f.obj.visible = true;
        if (k >= 1) { if (f.obj) { effectGroup.remove(f.obj); if (f.obj.geometry) f.obj.geometry.dispose(); } return; }
        var o = f.obj;
        if (f.kind === "shot") {
          var e = enemyObjs[f.e], to = e ? new T.Vector3(e.g.position.x, e.body.position.y + 0.25, e.g.position.z) : (f.last || f.from);
          f.last = to;
          o.position.copy(f.from).lerp(to, k);
          var dir = to.clone().sub(f.from);
          o.rotation.y = -Math.atan2(dir.z, dir.x);
        } else if (f.kind === "arc") {
          o.position.copy(f.from).lerp(f.to, k);
          o.position.y += Math.sin(k * Math.PI) * f.h;
        } else if (f.kind === "ring") {
          o.scale.setScalar(0.1 + k * f.r); o.material.opacity = 0.9 * (1 - k);
        } else if (f.kind === "grow") {
          o.scale.setScalar(0.2 + k * f.r); o.material.opacity = 1 - k;
        } else if (f.kind === "fade") {
          o.material.opacity = 1 - k;
        } else if (f.kind === "fadeLine" || f.kind === "thin") {
          o.material.opacity = (f.kind === "thin" ? 0.95 : 1) * (1 - k);
          if (f.kind === "thin") { o.scale.x = o.scale.z = Math.max(0.05, (o.scale.x > 0.5 ? 1 : 0.35) * (1 - k * 0.7)); }
        } else if (f.kind === "debris") {
          o.position.x += f.vx * dt; o.position.z += f.vz * dt; f.vy -= 9 * dt; o.position.y = Math.max(0.03, o.position.y + f.vy * dt);
          o.rotation.x += 0.3; o.rotation.y += 0.2; o.material.opacity = 1 - k * k;
        } else if (f.kind === "rise") {
          o.position.y = 0.1 + k * 1.2; o.material.opacity = 0.9 * (1 - k);
        }
        keep.push(f);
      });
      fxList = keep;
    }

    // ---------------- 路徑指示（流動的光點） ----------------
    // 使用者指定 2026-11-05：預估路線要更明顯 → 每條路鋪一條粉紅發光帶，光點改成亮黃色、加大
    var PATH_COL = 0xff3d7f, PATH_DOT = 0xfff07a;
    var pathPts = null, pathKey = "", paths = [], ribbonGroup = new T.Group(), ribbons = [];
    scene.add(ribbonGroup);
    function rebuildPaths(s) {
      var key = s.gv + "|" + s.spawns.length;
      if (key === pathKey) return;
      pathKey = key;
      paths = s.spawns.map(function (p) { return window.PriTestDenshiCore.pathFrom(s, p[0], p[1]); });
      var n = 0; paths.forEach(function (p) { n += p.length * 2; });
      if (pathPts) { scene.remove(pathPts); pathPts.geometry.dispose(); }
      while (ribbonGroup.children.length) { var rc = ribbonGroup.children[0]; ribbonGroup.remove(rc); if (rc.geometry) rc.geometry.dispose(); }
      ribbons = paths.map(function (p) {
        // 一般混合（不用加色）：在任何顏色的電路板上都保持粉紅色；中間細線用亮黃色
        var mat = new T.MeshBasicMaterial({ color: PATH_COL, transparent: true, opacity: 0.75, depthWrite: false });
        var edgeMat = new T.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.6, depthWrite: false });
        for (var i = 1; i < p.length; i++) {
          var a = p[i - 1], b = p[i], horiz = a[1] === b[1];
          var seg = new T.Mesh(new T.BoxGeometry(horiz ? 1.12 : 0.2, 0.02, horiz ? 0.2 : 1.12), mat);
          seg.position.set(wx((a[0] + b[0]) / 2) + 0.5, 0.035, wz((a[1] + b[1]) / 2) + 0.5);
          ribbonGroup.add(seg);
          var core2 = new T.Mesh(new T.BoxGeometry(horiz ? 1.02 : 0.06, 0.022, horiz ? 0.06 : 1.02), edgeMat);
          core2.position.copy(seg.position); core2.position.y = 0.04;
          ribbonGroup.add(core2);
        }
        return { mat: mat, edge: edgeMat };
      });
      var geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(new Float32Array(Math.max(1, n) * 3), 3));
      pathPts = new T.Points(geo, new T.PointsMaterial({ color: PATH_DOT, size: 0.55, map: glowTex, transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0.85 }));
      scene.add(pathPts);
    }
    function updatePaths(s, nextSp) {
      if (!pathPts) return;
      var arr = pathPts.geometry.attributes.position.array, n = 0;
      paths.forEach(function (p, pi) {
        var on = !nextSp || nextSp[pi];
        for (var i = 0; i < p.length * 2; i++) {
          var u = (i / 2 + (clock * 1.6) % 1) , a = Math.floor(u), f = u - a;
          var c0 = p[Math.min(a, p.length - 1)], c1 = p[Math.min(a + 1, p.length - 1)];
          arr[n * 3] = on ? wx(c0[0] + (c1[0] - c0[0]) * f) + 0.5 : 0;
          arr[n * 3 + 1] = on ? 0.08 : -5;
          arr[n * 3 + 2] = on ? wz(c0[1] + (c1[1] - c0[1]) * f) + 0.5 : 0;
          n++;
        }
      });
      pathPts.geometry.attributes.position.needsUpdate = true;
      pathPts.geometry.setDrawRange(0, n);
      pathPts.material.opacity = s.phase === "wave" ? 0.4 : 1;
      var pulse = 0.5 + Math.sin(clock * 3) * 0.15;
      ribbons.forEach(function (r, pi) {
        var on = !nextSp || nextSp[pi];
        r.mat.opacity = s.phase === "wave" ? 0.3 : on ? pulse + 0.3 : 0.18;
        r.edge.opacity = s.phase === "wave" ? 0.2 : on ? 0.8 : 0.1;
      });
    }

    // ---------------- 放置預覽、射程圈、選取 ----------------
    var ghostGroup = new T.Group(); scene.add(ghostGroup);
    var ghostBoxOk = M(0x3cffb0, { e: 0x3cffb0, ei: 0.7, t: 0.45 }), ghostBoxBad = M(0xff3355, { e: 0xff3355, ei: 0.7, t: 0.45 });
    // 射程圈：用一圈短段做出明顯的虛線（WebGL 線寬固定 1px，LineDashed 太細看不清楚）
    var rangeRing = new T.Group(); rangeRing.visible = false; scene.add(rangeRing);
    var dashMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
    var rangeR = -1;
    function buildDashes(r) {
      while (rangeRing.children.length) { var c = rangeRing.children[0]; rangeRing.remove(c); c.geometry.dispose(); }
      var n = Math.max(12, Math.round(Math.PI * 2 * r / 0.32)), len = Math.PI * 2 * r / n * 0.55;
      for (var i = 0; i < n; i++) {
        var a = i / n * Math.PI * 2, d = new T.Mesh(new T.BoxGeometry(0.07, 0.03, len), dashMat);
        d.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        d.rotation.y = -a;
        rangeRing.add(d);
      }
      rangeR = r;
    }
    var rangeDisc = new T.Mesh(new T.CircleGeometry(1, 72), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, side: T.DoubleSide, depthWrite: false }));
    rangeDisc.rotation.x = -Math.PI / 2; rangeDisc.visible = false; scene.add(rangeDisc);
    var towerGhost = null, towerGhostKey = "";
    var ghostTwOk = new T.MeshBasicMaterial({ color: 0x7dffd0, transparent: true, opacity: 0.45, depthWrite: false });
    var ghostTwBad = new T.MeshBasicMaterial({ color: 0xff5566, transparent: true, opacity: 0.45, depthWrite: false });
    var selBox = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1, 1.1, 1)), new T.LineBasicMaterial({ color: 0xffffff }));
    selBox.visible = false; scene.add(selBox);
    var hoverTile = new T.Mesh(new T.PlaneGeometry(0.96, 0.96), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
    hoverTile.rotation.x = -Math.PI / 2; hoverTile.visible = false; scene.add(hoverTile);
    var ghostKey = "";
    function updateGhost(s, u) {
      var key = u.ghost ? JSON.stringify(u.ghost) + u.ghostOk : "";
      if (key !== ghostKey) {
        ghostKey = key;
        while (ghostGroup.children.length) ghostGroup.remove(ghostGroup.children[0]);
        if (u.ghost) u.ghost.forEach(function (c) {
          if (c.x < 0 || c.y < 0 || c.x >= W || c.y >= H) return;
          var m = new T.Mesh(new T.BoxGeometry(0.94, 0.2, 0.94), u.ghostOk ? ghostBoxOk : ghostBoxBad);
          G.at(m, wx(c.x) + 0.5, 0.1, wz(c.y) + 0.5); ghostGroup.add(m);
          if (c.m) { var ic = new T.Mesh(new T.PlaneGeometry(0.7, 0.7), new T.MeshBasicMaterial({ map: modTexture(c.m), transparent: true, depthWrite: false })); ic.rotation.x = -Math.PI / 2; G.at(ic, wx(c.x) + 0.5, 0.22, wz(c.y) + 0.5); ghostGroup.add(ic); }
        });
      }
      ghostGroup.position.y = Math.sin(clock * 6) * 0.03;
      if (u.range) {
        if (Math.abs(rangeR - u.range.r) > 0.01) buildDashes(u.range.r);
        rangeRing.visible = rangeDisc.visible = true;
        rangeDisc.scale.setScalar(u.range.r);
        rangeRing.position.set(wx(u.range.x) + 0.5, 0.08, wz(u.range.y) + 0.5);
        rangeRing.rotation.y = clock * 0.25;
        rangeDisc.position.set(rangeRing.position.x, 0.05, rangeRing.position.z);
        dashMat.color.setHex(u.range.bad ? 0xff5566 : u.range.ghost ? 0x7dffd0 : 0xffffff);
        rangeDisc.material.color.setHex(u.range.bad ? 0xff5566 : u.range.ghost ? 0x7dffd0 : 0xffffff);
        rangeDisc.material.opacity = u.range.ghost ? 0.12 : 0.08;
      } else rangeRing.visible = rangeDisc.visible = false;
      // 砲塔殘影（半透明模型）
      var tk = u.towerGhost ? u.towerGhost.ty + "|" + u.towerGhost.x + "," + u.towerGhost.y + "|" + u.towerGhost.ok : "";
      if (tk !== towerGhostKey) {
        towerGhostKey = tk;
        if (towerGhost) { scene.remove(towerGhost); towerGhost = null; }
        if (u.towerGhost) {
          towerGhost = buildTower(u.towerGhost.ty, 0, 0xffffff).g;
          var gm = u.towerGhost.ok ? ghostTwOk : ghostTwBad;
          towerGhost.traverse(function (o) { if (o.isMesh || o.isLineSegments) { o.material = gm; o.castShadow = false; } else if (o.isSprite) o.visible = false; });
          towerGhost.position.set(wx(u.towerGhost.x) + 0.5, 0.2, wz(u.towerGhost.y) + 0.5);
          scene.add(towerGhost);
        }
      }
      if (towerGhost) towerGhost.position.y = 0.2 + Math.sin(clock * 5) * 0.04;
      var st = u.sel && window.PriTestDenshiCore.towerById(s, u.sel);
      selBox.visible = !!st;
      if (st) { selBox.position.set(wx(st.x) + 0.5, 0.55, wz(st.y) + 0.5); selBox.material.color.setHSL((clock * 0.5) % 1, 0.6, 0.7); }
      hoverTile.visible = !!u.hover && !u.ghost && !u.towerGhost;
      if (u.hover) hoverTile.position.set(wx(u.hover[0]) + 0.5, 0.2, wz(u.hover[1]) + 0.5);
    }

    // ---------------- 組合技連線（兩座砲塔之間跳動的弧線） ----------------
    var comboGroup = new T.Group(); scene.add(comboGroup);
    var comboKey = "", comboLines = [];
    function updateCombos(s) {
      var key = (s.tv || 0) + "|" + s.towers.length + "|" + s.towers.map(function (t) { return t.ty; }).join(",");
      if (key !== comboKey) {
        comboKey = key;
        while (comboGroup.children.length) comboGroup.remove(comboGroup.children[0]);
        comboLines = [];
        var done = {};
        s.towers.forEach(function (tw) {
          window.PriTestDenshiCore.combosOf(s, tw).forEach(function (x) {
            var o = window.PriTestDenshiCore.towerById(s, x.with);
            if (!o) return;
            var pk = Math.min(tw.id, o.id) + "-" + Math.max(tw.id, o.id) + x.c.id;
            if (done[pk]) return;
            done[pk] = 1;
            var a = v3(tw.x + 0.5, tw.y + 0.5, 0.75), b = v3(o.x + 0.5, o.y + 0.5, 0.75);
            var mid = a.clone().add(b).multiplyScalar(0.5); mid.y += 0.45;
            var curve = new T.QuadraticBezierCurve3(a, mid, b);
            var ln = new T.Mesh(new T.TubeGeometry(curve, 20, 0.03, 6, false), new T.MeshBasicMaterial({ color: 0xffd04a, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false }));
            comboGroup.add(ln);
            var mk = glowOwn(0xffd04a, 0.35); mk.position.copy(mid); comboGroup.add(mk);
            comboLines.push({ ln: ln, mk: mk, curve: curve });
          });
        });
      }
      comboLines.forEach(function (c, i) {
        c.ln.material.opacity = 0.45 + Math.sin(clock * 5 + i) * 0.3;
        c.mk.position.copy(c.curve.getPoint((clock * 0.8 + i * 0.3) % 1));
      });
    }

    // 天線陣列的干擾波
    var jamBand = new T.Mesh(new T.BoxGeometry(3, 2.2, H), new T.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.12, blending: T.AdditiveBlending, depthWrite: false }));
    jamBand.visible = false; jamBand.position.y = 1.1; scene.add(jamBand);
    var jamLine = new T.Mesh(new T.BoxGeometry(0.05, 0.05, H), new T.MeshBasicMaterial({ color: 0xfff2a0 }));
    jamLine.visible = false; scene.add(jamLine);

    // ---------------- 每一影格 ----------------
    var last = performance.now(), raf = 0, alive = true;
    function frame(now) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      var dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
      last = now;
      clock += dt;
      if (opts.onFrame) opts.onFrame(dt);
      var s = opts.getState(), u = (opts.getUi && opts.getUi()) || {};
      if (!s) return;
      rebuildTerrain(s);
      rebuildFound(s);
      rebuildPaths(s);
      // 新的特效事件
      var maxId = 0;
      s.fx.forEach(function (f) { if (f.id > maxId) maxId = f.id; });
      if (lastFx < 0 || maxId < lastFx) lastFx = maxId;
      s.fx.forEach(function (f) { if (f.id > lastFx) spawnFx(f, s); });
      lastFx = Math.max(lastFx, maxId);
      syncEnemies(s, dt);
      syncTowers(s);
      updateFx(dt);
      updatePaths(s, s.phase === "build" && !s.end ? u.nextSpawns : null);
      updateGhost(s, u);
      // 地基落下
      foundGroup.children.forEach(function (m) { if (m.position.y > 0) { m.userData.v = (m.userData.v || 0) + dt * 18; m.position.y = Math.max(0, m.position.y - m.userData.v * dt); } });
      // 入口（下一波會出怪的入口特別亮）
      portals.forEach(function (p) {
        p.r.rotation.x += dt * 1.5; p.r2.rotation.x -= dt * 2.3;
        var hot = s.phase === "wave" ? 1 : (u.nextSpawns && u.nextSpawns[p.i] ? 1 : 0.35);
        p.gl.material.opacity = hot * (0.6 + Math.sin(clock * 4) * 0.2);
      });
      updateCombos(s);
      pinRings.forEach(function (r, i) { r.material.opacity = 0.5 + Math.abs(Math.sin(clock * 3 + i)) * 0.5; });
      badMeshes.forEach(function (b, i) { b.material.emissiveIntensity = 0.5 + Math.abs(Math.sin(clock * 7 + i * 1.3)) * 0.8; });
      if (beltTex) beltTex.offset.x -= dt * 1.2;
      if (coreObj) {
        coreObj.holo.rotation.y += dt * 0.8; coreObj.hr2.rotation.z += dt * 1.3; coreObj.gem.rotation.y -= dt * 2;
        coreObj.holo.position.y = 1.0 + Math.sin(clock * 2) * 0.08;
        coreObj.flash = Math.max(0, coreObj.flash - dt * 2);
        var hr = s.hp / s.mhp;
        coreObj.pl.color.setHex(coreObj.flash > 0 ? 0xff2030 : theme.glow);
        coreObj.pl.intensity = 1.2 + coreObj.flash * 4;
        coreObj.gl.material.color.setHex(coreObj.flash > 0.1 || hr < 0.3 ? 0xff3040 : theme.glow);
        coreObj.gl.scale.setScalar(2.2 + Math.sin(clock * 3) * 0.3 + coreObj.flash * 2);
      }
      if (window.PriTestDenshiCore.has(s, "antenna") && s.phase === "wave") {
        var jx = window.PriTestDenshiCore.jamX(s);
        jamBand.visible = jamLine.visible = true;
        jamBand.position.x = wx(0) + jx; jamLine.position.set(wx(0) + jx, 0.05 + Math.abs(Math.sin(clock * 9)) * 2, 0);
      } else jamBand.visible = jamLine.visible = false;
      flashLight = Math.max(0, flashLight - dt * 3);
      var surge = window.PriTestDenshiCore.has(s, "psu") && s.m && s.m.surgeU > s.time;
      sun.intensity = 1.1 + flashLight * 2.5;
      rim.intensity = 0.35 + (surge ? 0.8 + Math.sin(clock * 25) * 0.3 : 0);
      // 鏡頭
      shake = Math.max(0, shake - dt);
      placeCam();
      if (shake > 0) { cam.position.x += (Math.random() - 0.5) * shake * 0.6; cam.position.y += (Math.random() - 0.5) * shake * 0.6; }
      renderer.render(scene, cam);
    }
    raf = requestAnimationFrame(frame);

    // ---------------- 操作（點擊、拖曳旋轉、滾輪／雙指縮放） ----------------
    var ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), -0.18), hitV = new T.Vector3();
    function cellAt(cx, cy) {
      var r = renderer.domElement.getBoundingClientRect();
      var v = new T.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v, cam);
      if (!ray.ray.intersectPlane(plane, hitV)) return null;
      var x = Math.floor(hitV.x + W / 2), y = Math.floor(hitV.z + H / 2);
      return x >= 0 && y >= 0 && x < W && y < H ? [x, y] : null;
    }
    var el = renderer.domElement, drag = null, pinch = null, touches = {};
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    el.addEventListener("pointerdown", function (e) {
      touches[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(touches);
      if (ids.length === 2) {
        var a = touches[ids[0]], b = touches[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: view.dist };
        drag = null;
        return;
      }
      drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, tx: view.tx, tz: view.tz, moved: false, btn: e.button, type: e.pointerType };
      try { el.setPointerCapture(e.pointerId); } catch (er) { /* 舊瀏覽器 */ }
    });
    el.addEventListener("pointermove", function (e) {
      if (touches[e.pointerId]) touches[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinch) {
        var ids = Object.keys(touches);
        if (ids.length === 2) {
          var a = touches[ids[0]], b = touches[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
          view.dist = Math.max(8, Math.min(MAXD, pinch.dist * pinch.d / Math.max(1, d)));
        }
        return;
      }
      if (drag) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > (drag.type === "touch" ? 12 : 6)) drag.moved = true;
        if (drag.moved) {
          if (drag.btn === 2 || e.shiftKey) {
            var sc = view.dist / 600, cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
            view.tx = Math.max(-W / 2, Math.min(W / 2, drag.tx - (dx * cy + dy * sy) * sc));
            view.tz = Math.max(-H / 2, Math.min(H / 2, drag.tz - (-dx * sy + dy * cy) * sc));
          } else {
            view.yaw = drag.yaw - dx * 0.006;
            view.pitch = Math.max(0.45, Math.min(1.45, drag.pitch + dy * 0.005));
          }
        }
        return;
      }
      if (e.pointerType === "mouse" && opts.onHover) opts.onHover(cellAt(e.clientX, e.clientY));
    });
    function up(e) {
      delete touches[e.pointerId];
      if (pinch) { if (!Object.keys(touches).length) pinch = null; return; }
      if (drag && !drag.moved && drag.btn !== 2) {
        var c = cellAt(e.clientX, e.clientY);
        if (c && opts.onCell) opts.onCell(c[0], c[1], e.pointerType);
      }
      drag = null;
    }
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", function (e) { delete touches[e.pointerId]; drag = null; pinch = null; });
    el.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse" && opts.onHover && !drag) opts.onHover(null); });
    el.addEventListener("wheel", function (e) { e.preventDefault(); view.dist = Math.max(8, Math.min(MAXD, view.dist * (e.deltaY > 0 ? 1.1 : 0.91))); }, { passive: false });

    function resize() {
      var w = box.clientWidth || 800, h = box.clientHeight || 500;
      renderer.setSize(w, h);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      fitCam();
    }
    window.addEventListener("resize", resize);

    return {
      resize: resize,
      // 電路板座標（格子單位，可帶小數）→ 畫布內的像素座標；在鏡頭後方回傳 null
      project: function (bx, by, h) {
        var v = new T.Vector3(wx(0) + bx, h || 0.6, wz(0) + by).project(cam);
        if (v.z > 1) return null;
        var el2 = renderer.domElement;
        return { x: (v.x + 1) / 2 * el2.clientWidth, y: (1 - v.y) / 2 * el2.clientHeight };
      },
      resetCam: function () { view.pitch = 0.98; fitCam(); },
      rotate: function (d) { view.yaw += d; },
      zoom: function (f) { view.dist = Math.max(8, Math.min(MAXD, view.dist * f)); },
      dispose: function () {
        alive = false;
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }

  window.PriTestDenshi3D = { available: available, load: load, create: create };
})();
