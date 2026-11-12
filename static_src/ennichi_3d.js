// ============================================================================
// 緣日樂園：three.js 樂園（window.PriTestEnnichi3D）。
//   * 只讀遊戲狀態 s：不修改 s、不呼叫 Core.applyIntent；規則全部在 ennichi_core.js／ennichi_sim.js。
//   * 客人位置內插：sync(s, alpha) 自己保存「前一次」與「這一次」模擬的客人位置（遊戲分鐘改變時換手），
//     每幀依 alpha（0〜1）在兩者之間內插。
//   * 建物：s.mapVer 改變或某個 Struct 的 build／mods／broken（與連結、強風停駛牌）改變時重建該建物；
//     全部用 three.js 基本形狀，動畫以 group.userData.update 驅動。
//   * 燈光、Bloom、招牌、摩天輪、murmur 氣泡沿用樣本頁 ennichi_lab.js；群眾用共用模組 ennichi_crowd.js。
//   * 純視覺效果（雨滴、樹、閃爍）可以用 Math.random。
// 依賴：vendor/three.min.js（r149，全域 THREE）→ vendor/ennichi_vrm.js（PriTestEnnichiVendor），
//       由呼叫端（ennichi.js）先載入再呼叫 init。
// ============================================================================
(function () {
  "use strict";
  var D = window.PriTestEnnichiData, Core = window.PriTestEnnichiCore, Crowd = window.PriTestEnnichiCrowd;
  var M = D.MAP, T = M.TILE;
  var MAX_GUESTS = 512;
  var BUBBLE_LIFE = 4.8, BUBBLE_MAX = 5;

  var V, renderer, scene, camera, controls, composer, bloomPass, clock;
  var stage = null, overlay = null, initPromise = null, ready = false;
  var hemi, sunLight, groundMat, pathMat;
  var pathMesh = null, pathVer = -1, pathState = null;
  var recs = {}; // sid -> { sig, group, speed }
  var decoSway = [];
  var emaPlaques = null, emaCount = -1;
  var cur = null, alphaV = 1;
  var snap = { s: null, key: null, prev: {}, cur: {}, list: [] };
  var headings = {}, drawn = {};
  var crowd = null, umbrellas = null;
  var sayo = null, blinkTimer = 2, blinkT = -1;
  var weather = "sun", rain = null;
  var ghostGroup = null;
  var follow = null, followZoom = false;
  var bubbles = [];
  var tmpV = null, tmpM = null, tmpQ = null, tmpS = null, raycaster = null, groundPlane = null;

  function lang() { return window.I18N && window.I18N.getLang ? window.I18N.getLang() : "zh"; }
  function L(o) { return o ? (lang() === "ja" ? o.ja : o.zh) : ""; }
  function jikanBase() {
    var root = document.getElementById("en-game") || document.getElementById("en-app");
    return (root && root.getAttribute("data-jikan")) || "../static/images/jikan/";
  }

  // ---------------------------------------------------------------- 座標
  function tileToWorld(x, y) { return { x: (x + 0.5 - M.W / 2) * T, z: (y + 0.5 - M.H / 2) * T }; }
  function footCenter(type, x, y) {
    var b = D.BUILD[type] || { w: 1, h: 1 };
    return tileToWorld(x + (b.w - 1) / 2, y + (b.h - 1) / 2);
  }

  // ---------------------------------------------------------------- 材質與小工具
  var matCache = {};
  function lam(hex) {
    if (!matCache[hex]) { matCache[hex] = new THREE.MeshLambertMaterial({ color: hex }); matCache[hex].userData.shared = true; }
    return matCache[hex];
  }
  function glow(hex, k) { return new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) }); }
  function mesh(geo, mat, x, y, z) {
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    return m;
  }
  function box(w, h, d, hex, x, y, z) { return mesh(new THREE.BoxGeometry(w, h, d), typeof hex === "string" ? lam(hex) : hex, x, y, z); }
  function cyl(rt, rb, h, hex, x, y, z, seg) { return mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), typeof hex === "string" ? lam(hex) : hex, x, y, z); }

  function disposeTree(o) {
    o.traverse(function (n) {
      if (n.geometry && !(n.geometry.userData && n.geometry.userData.shared)) n.geometry.dispose();
      var ms = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
      ms.forEach(function (m) {
        if (m.userData && m.userData.shared) return;
        if (m.map) m.map.dispose();
        m.dispose();
      });
    });
  }

  // 招牌（樣本頁的 signMaterial）
  function signMaterial(text, bg) {
    var c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    var g = c.getContext("2d");
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = "#fffaf0";
    var size = text.length > 5 ? Math.floor(200 / text.length) : 40;
    g.font = "bold " + size + "px 'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 128, 34);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return new THREE.MeshBasicMaterial({ map: tex });
  }

  // 浮在建物上方的文字牌（施工中 N、本日運休、×）
  function textSprite(text, bg, fg, width) {
    var c = document.createElement("canvas");
    c.width = 256;
    c.height = 96;
    var g = c.getContext("2d");
    g.fillStyle = bg;
    g.beginPath();
    if (g.roundRect) g.roundRect(4, 4, 248, 88, 18); else g.rect(4, 4, 248, 88);
    g.fill();
    g.fillStyle = fg;
    var size = text.length > 4 ? Math.floor(220 / text.length) : 52;
    g.font = "bold " + size + "px 'Hiragino Sans','Yu Gothic','Noto Sans JP',sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 128, 50);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sp.scale.set(width, width * 96 / 256, 1);
    return sp;
  }
  function crossSprite() {
    var c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    var g = c.getContext("2d");
    g.fillStyle = "#e02a2a";
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#ffffff";
    g.lineWidth = 16;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(38, 38); g.lineTo(90, 90); g.moveTo(90, 38); g.lineTo(38, 90);
    g.stroke();
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sp.scale.set(1.6, 1.6, 1);
    return sp;
  }

  // ---------------------------------------------------------------- 場景
  function setupRenderer() {
    var w = stage.clientWidth || 640, h = stage.clientHeight || 400;
    if (window.getComputedStyle && window.getComputedStyle(stage).position === "static") stage.style.position = "relative";
    // r149 預設 legacyMode：十六進位顏色會被當成 linear，畫面偏亮偏灰（同樣本頁）
    if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.domElement.className = "en-3d-canvas";
    overlay = document.createElement("div");
    overlay.className = "en-overlay";
    stage.appendChild(renderer.domElement);
    stage.appendChild(overlay);

    scene = new THREE.Scene();
    scene.background = new THREE.Color("#8ec9f0");
    scene.fog = new THREE.Fog("#8ec9f0", 80, 170); // 群眾 shader 直接引用 fog.color，換天氣時只改顏色
    camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 400);
    camera.position.set(0, 34, 38);
    controls = new V.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 1);
    controls.enableDamping = true;
    controls.maxPolarAngle = 1.38;
    controls.minDistance = 5;
    controls.maxDistance = 110;
    controls.screenSpacePanning = false;

    hemi = new THREE.HemisphereLight("#dfe8ff", "#5a4a38", 0.75);
    scene.add(hemi);
    sunLight = new THREE.DirectionalLight("#fff2dc", 0.95);
    sunLight.position.set(-20, 40, 25);
    scene.add(sunLight);

    // HDR 合成目標（HalfFloat）：只有顏色超過 1 的燈籠、燈泡會發光
    var rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    if (renderer.capabilities.isWebGL2) rt.samples = 4;
    composer = new V.EffectComposer(renderer, rt);
    composer.addPass(new V.RenderPass(scene, camera));
    bloomPass = new V.UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.5, 1.0);
    composer.addPass(bloomPass);
    composer.addPass(new V.ShaderPass(V.GammaCorrectionShader));

    tmpV = new THREE.Vector3();
    tmpM = new THREE.Matrix4();
    tmpQ = new THREE.Quaternion();
    tmpS = new THREE.Vector3();
    raycaster = new THREE.Raycaster();
    groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    clock = new THREE.Clock();

    window.addEventListener("resize", onResize);
    if (window.ResizeObserver) new window.ResizeObserver(onResize).observe(stage);
  }

  function onResize() {
    if (!renderer) return;
    var w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  }

  function buildWorld() {
    var outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: "#3f5f34" }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    scene.add(outer);
    groundMat = new THREE.MeshLambertMaterial({ color: "#6f9a4e" });
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(M.W * T, M.H * T), groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    // v2 擴張用地（x ≥ UNLOCK_X）：顏色較深
    var lw = (M.W - M.UNLOCK_X) * T;
    var locked = new THREE.Mesh(new THREE.PlaneGeometry(lw, M.H * T), new THREE.MeshLambertMaterial({ color: "#56784a" }));
    locked.rotation.x = -Math.PI / 2;
    locked.position.set((M.UNLOCK_X - M.W / 2) * T + lw / 2, 0.005, 0);
    scene.add(locked);
    pathMat = new THREE.MeshLambertMaterial({ color: "#c9b48e" });

    // 入口鳥居（地圖左外側）與參道旁的石燈籠、幟（擴張用地內，不會和玩家建物重疊）
    var gz = tileToWorld(0, M.GATE.y).z;
    var gate = torii(1);
    gate.rotation.y = Math.PI / 2;
    gate.position.set(-M.W / 2 * T - 1.2, 0, gz);
    scene.add(gate);
    [-1, 1].forEach(function (side) {
      for (var i = 0; i < 2; i++) {
        var f = nobori(i % 2 ? "#c8282e" : "#f4efe4", i * 1.7 + side);
        f.position.set(-M.W / 2 * T - 3 - i * 1.6, 0, gz + side * 2.4);
        scene.add(f);
      }
      for (var x = M.UNLOCK_X; x < M.SHRINE.x - 1; x++) {
        var w = tileToWorld(x, M.GATE.y);
        var lt = stoneLantern();
        lt.position.set(w.x, 0, gz + side * 1.5);
        scene.add(lt);
        var fl = nobori(x % 2 ? "#c8282e" : "#f4efe4", x + side);
        fl.position.set(w.x + 1, 0, gz + side * 1.7);
        scene.add(fl);
      }
    });

    // 樹林（地圖外圍）
    var spots = [];
    var hw = M.W / 2 * T, hh = M.H / 2 * T;
    for (var n = 0; spots.length < 160 && n < 4000; n++) {
      var x0 = (Math.random() * 2 - 1) * (hw + 26), z0 = (Math.random() * 2 - 1) * (hh + 22);
      if (Math.abs(x0) < hw + 3 && Math.abs(z0) < hh + 3) continue;
      if (x0 < -hw && Math.abs(z0 - gz) < 6) continue; // 入口前留空
      spots.push([x0, z0, 0.8 + Math.random() * 0.7]);
    }
    var trunkGeo = new THREE.CylinderGeometry(0.15, 0.22, 1.6, 6);
    trunkGeo.translate(0, 0.8, 0);
    var leafGeo = new THREE.ConeGeometry(1.5, 4, 8);
    leafGeo.translate(0, 3.4, 0);
    var trunks = new THREE.InstancedMesh(trunkGeo, lam("#5a3e2a"), spots.length);
    var leaves = new THREE.InstancedMesh(leafGeo, lam("#2f5a33"), spots.length);
    spots.forEach(function (sp, i) {
      tmpM.compose(tmpV.set(sp[0], 0, sp[1]), tmpQ.identity(), tmpS.set(sp[2], sp[2], sp[2]));
      trunks.setMatrixAt(i, tmpM);
      leaves.setMatrixAt(i, tmpM);
    });
    scene.add(trunks, leaves);

    // 雨滴（setWeather("rain") 時顯示）
    var N = 3000, pos = new Float32Array(N * 3);
    for (var r = 0; r < N; r++) {
      pos[r * 3] = (Math.random() * 2 - 1) * (hw + 6);
      pos[r * 3 + 1] = Math.random() * 30;
      pos[r * 3 + 2] = (Math.random() * 2 - 1) * (hh + 6);
    }
    var rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: "#d8e2ff", size: 0.14, transparent: true, opacity: 0.7 }));
    rain.frustumCulled = false;
    rain.visible = false;
    scene.add(rain);

    // 持傘客人的小傘
    var uGeo = new THREE.ConeGeometry(0.42, 0.22, 10);
    umbrellas = new THREE.InstancedMesh(uGeo, lam("#c8404a"), MAX_GUESTS);
    umbrellas.count = 0;
    umbrellas.frustumCulled = false;
    scene.add(umbrellas);

    // 放置預覽
    ghostGroup = new THREE.Group();
    ghostGroup.visible = false;
    ghostGroup.userData.box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: "#40d060", transparent: true, opacity: 0.38, depthWrite: false }));
    ghostGroup.userData.door = new THREE.Mesh(new THREE.BoxGeometry(T * 0.9, 0.08, T * 0.9), new THREE.MeshBasicMaterial({ color: "#ffd040", transparent: true, opacity: 0.6, depthWrite: false }));
    ghostGroup.add(ghostGroup.userData.box, ghostGroup.userData.door);
    scene.add(ghostGroup);
  }

  // ---------------------------------------------------------------- 共用造型
  function torii(sc) {
    var g = new THREE.Group();
    [-1.75, 1.75].forEach(function (x) { g.add(cyl(0.17, 0.2, 3.4, "#c8282e", x, 1.7, 0, 16)); });
    g.add(box(5, 0.22, 0.42, "#1d1a1c", 0, 3.55, 0));
    g.add(box(4.6, 0.2, 0.36, "#c8282e", 0, 3.36, 0));
    g.add(box(4.2, 0.18, 0.2, "#c8282e", 0, 2.75, 0));
    g.scale.setScalar(sc);
    return g;
  }

  // 幟（旗幟）：竿＋布，布掛在樞紐上，強風時擺動
  function nobori(hex, phase) {
    var g = new THREE.Group();
    g.add(cyl(0.035, 0.04, 3.2, "#3a2a22", 0, 1.6, 0, 6));
    var pivot = new THREE.Group();
    pivot.position.set(0, 3.0, 0);
    var cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 2.0), new THREE.MeshLambertMaterial({ color: hex, side: THREE.DoubleSide }));
    cloth.position.set(0.3, -1.0, 0);
    pivot.add(cloth);
    g.add(pivot);
    decoSway.push({ obj: pivot, phase: phase, axis: "x" });
    return g;
  }

  function stoneLantern() {
    var g = new THREE.Group();
    g.add(box(0.5, 0.2, 0.5, "#8c8a84", 0, 0.1, 0));
    g.add(cyl(0.1, 0.12, 0.8, "#8c8a84", 0, 0.6, 0, 8));
    g.add(box(0.46, 0.32, 0.46, "#8c8a84", 0, 1.16, 0));
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.2, 0.48), glow("#ffc070", 2.0), 0, 1.16, 0));
    var roof = mesh(new THREE.ConeGeometry(0.46, 0.3, 4), lam("#77756f"), 0, 1.47, 0);
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    return g;
  }

  function pad(w, d, hex) { return box(w, 0.1, d, hex || "#a29c90", 0, 0.05, 0); }

  // ---------------------------------------------------------------- 建物
  function buildShrine() {
    var g = new THREE.Group(), inner = new THREE.Group();
    // 以「正面朝 +z」組好再轉向 −x（本殿入口在參道盡頭、朝入口方向）
    inner.add(box(7.4, 0.5, 7.4, "#9a958a", 0, 0.25, -0.3));
    var hall = new THREE.Group();
    hall.add(box(4.6, 2.4, 3.6, "#8a5a3a", 0, 1.7, -1.4));
    [-2.1, 2.1].forEach(function (x) { hall.add(cyl(0.12, 0.12, 2.4, "#c8282e", x, 1.7, 0.35, 10)); });
    var roof = mesh(new THREE.ConeGeometry(4.2, 2.0, 4, 1), lam("#3c4a52"), 0, 3.9, -1.2);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.2, 1, 1.05);
    hall.add(roof);
    hall.add(mesh(new THREE.PlaneGeometry(2.0, 1.5), glow("#ffc070", 1.6), 0, 1.35, 0.42));
    hall.add(box(1.2, 0.5, 0.5, "#6a4428", 0, 0.75, 1.1)); // 賽錢箱
    hall.add(box(2.4, 0.22, 0.8, "#9a958a", 0, 0.6, 1.9)); // 石階
    hall.position.x = 1; // 正對參道（參道在本殿中心往南 1 m）
    inner.add(hall);
    var tr = torii(0.8);
    tr.position.set(1, 0, 4.9);
    inner.add(tr);
    // 繪馬牆：木板＋小屋頂，未完成願望各掛一片小木牌（sync 時更新）
    var ema = new THREE.Group();
    [-1, 1].forEach(function (sx) { ema.add(cyl(0.06, 0.06, 1.9, "#5a3a26", sx * 1.0, 0.95, 0, 6)); });
    ema.add(box(2.1, 1.0, 0.08, "#b88a5a", 0, 1.25, 0));
    ema.add(box(2.4, 0.08, 0.5, "#3c4a52", 0, 1.95, 0));
    emaPlaques = new THREE.Group();
    emaPlaques.position.set(0, 1.25, 0.06);
    ema.add(emaPlaques);
    ema.position.set(-2.6, 0, 2.6);
    ema.rotation.y = Math.PI / 4;
    inner.add(ema);
    emaCount = -1;
    g.add(inner);
    inner.rotation.y = -Math.PI / 2;
    return g;
  }

  function syncEma(s) {
    if (!emaPlaques) return;
    var n = 0;
    (s.wishes || []).forEach(function (w) { if (!w.done) n++; });
    if (n === emaCount) return;
    emaCount = n;
    while (emaPlaques.children.length) {
      var c = emaPlaques.children.pop();
      disposeTree(c);
    }
    for (var i = 0; i < n; i++) {
      var p = box(0.34, 0.24, 0.04, "#e8cfa0", -0.75 + (i % 5) * 0.38, 0.22 - Math.floor(i / 5) * 0.32, 0);
      p.rotation.z = (i % 2 ? 1 : -1) * 0.06;
      p.add(box(0.2, 0.05, 0.01, "#c8282e", 0, 0.05, 0.025));
      emaPlaques.add(p);
    }
  }

  function lionMesh(gold) {
    var g = new THREE.Group();
    var bodyC = gold ? glow("#e8b830", 1.05) : lam("#c8282e");
    var trim = gold ? glow("#ffe080", 1.1) : lam("#d4a531");
    g.add(box(0.36, 0.42, 0.95, null, 0, 0, 0));
    g.children[0].material = bodyC;
    g.add(mesh(new THREE.SphereGeometry(0.26, 12, 10), bodyC, 0, 0.22, 0.52));
    g.add(mesh(new THREE.SphereGeometry(0.3, 10, 8), trim, 0, 0.2, 0.38)); // 鬃毛
    g.add(box(0.4, 0.06, 0.4, null, 0, 0.24, -0.05));
    g.children[3].material = trim; // 鞍
    return g;
  }

  function buildMerry(st) {
    var g = new THREE.Group(), mods = st.mods || {};
    g.add(cyl(3.5, 3.6, 0.3, "#9a958a", 0, 0.15, 0, 32));
    var rot = new THREE.Group();
    rot.position.y = 0.3;
    g.add(rot);
    rot.add(cyl(3.2, 3.2, 0.12, "#a0704a", 0, 0.06, 0, 32));
    rot.add(cyl(0.5, 0.5, 2.8, "#c8282e", 0, 1.4, 0, 16));
    var lions = [];
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * Math.PI * 2;
      var arm = new THREE.Group();
      arm.rotation.y = a;
      arm.add(cyl(0.05, 0.05, 2.7, "#d4a531", 2.3, 1.45, 0, 6));
      var lion = lionMesh(!!mods.deco && (i === 0 || i === 3)); // deco：其中 2 隻變金色
      lion.position.set(2.3, 1.0, 0);
      arm.add(lion);
      lions.push(lion);
      rot.add(arm);
    }
    for (var w = 0; w < 12; w++) {
      var wedge = mesh(new THREE.ConeGeometry(3.6, 1.5, 3, 1, false, w * Math.PI / 6, Math.PI / 6), lam(w % 2 ? "#ece2d2" : "#c8282e"), 0, 3.55, 0);
      rot.add(wedge);
    }
    var bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), mods.light ? glow("#ffb050", 2.6) : glow("#fff6e0", 0.9), 24);
    for (var b = 0; b < 24; b++) {
      var ba = b / 24 * Math.PI * 2;
      tmpM.makeTranslation(Math.cos(ba) * 3.55, 2.82, Math.sin(ba) * 3.55);
      bulbs.setMatrixAt(b, tmpM);
    }
    rot.add(bulbs);
    var angle = 0;
    g.userData.update = function (step) {
      angle += step * 0.7;
      rot.rotation.y = angle;
      for (var k = 0; k < lions.length; k++) lions[k].position.y = 1.0 + Math.sin(angle * 4 + k * 1.3) * 0.22;
    };
    return g;
  }

  function buildCups() {
    var g = new THREE.Group();
    g.add(cyl(2.8, 2.9, 0.25, "#9a958a", 0, 0.12, 0, 32));
    var disk = new THREE.Group();
    disk.position.y = 0.25;
    g.add(disk);
    disk.add(cyl(2.6, 2.6, 0.12, "#e8d8c0", 0, 0.06, 0, 32));
    disk.add(mesh(new THREE.SphereGeometry(0.55, 14, 10), lam("#3f6a3a"), 0, 0.55, 0));
    disk.add(mesh(new THREE.ConeGeometry(0.25, 0.3, 10), lam("#d4a531"), 0, 1.1, 0));
    var prof = [[0, 0], [0.42, 0.02], [0.58, 0.14], [0.67, 0.38], [0.7, 0.62], [0.64, 0.62], [0.6, 0.4], [0.5, 0.2], [0, 0.18]];
    var cupGeo = new THREE.LatheGeometry(prof.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), 20);
    var cupMat = new THREE.MeshLambertMaterial({ color: "#7aa65a", side: THREE.DoubleSide });
    var cups = [];
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * Math.PI * 2;
      var cup = new THREE.Group();
      cup.position.set(Math.cos(a) * 1.7, 0.12, Math.sin(a) * 1.7);
      cup.add(new THREE.Mesh(cupGeo, cupMat));
      cup.add(cyl(0.12, 0.12, 0.4, "#fbf4e6", 0, 0.38, 0, 8));
      cup.add(mesh(new THREE.TorusGeometry(0.68, 0.025, 6, 24), lam("#d4a531"), 0, 0.62, 0));
      cup.children[2].rotation.x = Math.PI / 2;
      disk.add(cup);
      cups.push(cup);
    }
    var angle = 0;
    g.userData.update = function (step) {
      angle += step * 0.8;
      disk.rotation.y = angle;
      for (var k = 0; k < cups.length; k++) cups[k].rotation.y = angle * 2.5 + k;
    };
    return g;
  }

  function buildChairs(st) {
    var g = new THREE.Group(), mods = st.mods || {};
    g.add(cyl(1.0, 1.2, 0.3, "#9a958a", 0, 0.15, 0, 16));
    g.add(cyl(0.22, 0.3, 5.2, "#c8282e", 0, 2.6, 0, 12));
    var top = new THREE.Group();
    top.position.y = 5.2;
    g.add(top);
    var colors = ["#e04a4a", "#f4c040", "#40a0e0", "#60c070"];
    for (var w = 0; w < 8; w++) {
      top.add(mesh(new THREE.ConeGeometry(2.6, 0.9, 2, 1, false, w * Math.PI / 4, Math.PI / 4), lam(colors[w % 4]), 0, 0.45, 0));
    }
    // 頂部的紙風車
    var wheel = new THREE.Group();
    wheel.position.set(0, 1.35, 0);
    for (var b = 0; b < 4; b++) {
      var blade = mesh(new THREE.ConeGeometry(0.35, 0.8, 3), new THREE.MeshLambertMaterial({ color: colors[b], side: THREE.DoubleSide }), 0, 0.4, 0);
      var arm = new THREE.Group();
      arm.rotation.z = b * Math.PI / 2;
      arm.add(blade);
      wheel.add(arm);
    }
    top.add(wheel);
    var pivots = [];
    for (var i = 0; i < 8; i++) {
      var spoke = new THREE.Group();
      spoke.rotation.y = i / 8 * Math.PI * 2;
      var pv = new THREE.Group();
      pv.position.set(2.2, -0.05, 0);
      pv.add(cyl(0.02, 0.02, 2.4, "#c8c8d0", 0, -1.2, 0, 4));
      pv.add(box(0.48, 0.08, 0.46, "#a0704a", 0, -2.42, 0));
      pv.add(box(0.48, 0.4, 0.06, "#a0704a", -0.2, -2.22, 0));
      if (mods.light) for (var k = 1; k <= 3; k++) pv.add(mesh(new THREE.SphereGeometry(0.06, 6, 5), glow(k % 2 ? "#ffd070" : "#ff7090", 2.4), 0, -k * 0.6, 0));
      spoke.add(pv);
      top.add(spoke);
      pivots.push(pv);
    }
    var angle = 0, tilt = 0;
    g.userData.update = function (step, time, spd, dt) {
      angle += step * 1.1;
      top.rotation.y = angle;
      wheel.rotation.y = -angle * 2;
      tilt += (Math.min(0.75, spd * 0.6) - tilt) * Math.min(1, dt * 2); // 依轉速外甩
      for (var p = 0; p < pivots.length; p++) pivots[p].rotation.z = tilt;
    };
    return g;
  }

  function buildWheel(st) {
    var g = new THREE.Group(), mods = st.mods || {};
    var R = 4.6, cy = 5.5;
    g.add(pad(6, 3, "#9a958a"));
    var steel = lam("#c8c8d8");
    [-1, 1].forEach(function (sz) {
      [-1, 1].forEach(function (sx) {
        var len = Math.sqrt(cy * cy + 2.2 * 2.2);
        var leg = mesh(new THREE.BoxGeometry(0.2, len, 0.2), steel, sx * 1.1, cy / 2, sz * 0.8);
        leg.rotation.z = sx * Math.atan2(2.2, cy);
        g.add(leg);
      });
    });
    var rot = new THREE.Group();
    rot.position.set(0, cy, 0);
    g.add(rot);
    [-0.35, 0.35].forEach(function (z) {
      var rim = mesh(new THREE.TorusGeometry(R, 0.08, 6, 64), steel, 0, 0, z);
      rot.add(rim);
      for (var sIdx = 0; sIdx < 16; sIdx++) {
        var spoke = mesh(new THREE.BoxGeometry(0.05, R * 2, 0.05), steel, 0, 0, z);
        spoke.rotation.z = (sIdx / 16) * Math.PI;
        rot.add(spoke);
      }
    });
    var hub = cyl(0.45, 0.45, 1.0, "#8a8a9a", 0, 0, 0, 16);
    hub.rotation.x = Math.PI / 2;
    rot.add(hub);
    var lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: "#ffffff" }), 48);
    var warm = new THREE.Color("#ffc070").multiplyScalar(2.2), col = new THREE.Color();
    for (var q = 0; q < 48; q++) {
      var a = (q / 48) * Math.PI * 2;
      tmpM.makeTranslation(Math.cos(a) * R, Math.sin(a) * R, 0.45);
      lights.setMatrixAt(q, tmpM);
      lights.setColorAt(q, warm);
    }
    rot.add(lights);
    var cabColors = ["#d23a3a", "#2f6fb5", "#e0a020", "#3a9a5a"];
    var cabins = [];
    for (var i = 0; i < 8; i++) {
      var ca = i / 8 * Math.PI * 2;
      var cab = new THREE.Group();
      cab.position.set(Math.cos(ca) * R, Math.sin(ca) * R, 0);
      cab.add(cyl(0.03, 0.03, 0.4, "#c8c8d8", 0, -0.2, 0, 4));
      if (mods.cabin) {
        // 全景玻璃車廂：透明＋邊框
        var geo = new THREE.BoxGeometry(0.95, 0.8, 0.85);
        var glass = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: "#bfe6ff", transparent: true, opacity: 0.32, depthWrite: false }));
        glass.position.y = -0.8;
        var edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: "#f0f0f8" }));
        edges.position.y = -0.8;
        cab.add(glass, edges);
      } else {
        cab.add(box(0.95, 0.8, 0.85, cabColors[i % 4], 0, -0.8, 0));
      }
      cab.add(box(1.05, 0.08, 0.95, "#e8e8f0", 0, -0.36, 0));
      rot.add(cab);
      cabins.push(cab);
    }
    var angle = 0;
    g.userData.update = function (step, time) {
      angle += step * 0.18;
      rot.rotation.z = angle;
      for (var k = 0; k < cabins.length; k++) cabins[k].rotation.z = -angle; // 車廂保持水平
      if (mods.light) {
        // 夜光燈籠串：彩色漸變
        for (var j = 0; j < 48; j++) lights.setColorAt(j, col.setHSL((j / 48 + time * 0.08) % 1, 0.85, 0.6).multiplyScalar(2.4));
        lights.instanceColor.needsUpdate = true;
      }
    };
    return g;
  }

  var STALL_COLORS = {
    kingyo: "#2f6fb5", shateki: "#3a9a5a", wanage: "#e0a020", omikuji: "#c8282e",
    takoyakiSt: "#d23a3a", ameSt: "#e07aa0", ramuneSt: "#3aa0c8", kasaSt: "#8a4ac0", juyo: "#6a4a2a",
  };

  function wagasa(hex) {
    var u = new THREE.Group();
    u.add(mesh(new THREE.ConeGeometry(0.55, 0.32, 12, 1, true), new THREE.MeshLambertMaterial({ color: hex, side: THREE.DoubleSide }), 0, 1.0, 0));
    u.add(cyl(0.015, 0.015, 1.1, "#5a3a26", 0, 0.5, 0, 4));
    return u;
  }

  function buildStall(st) {
    var g = new THREE.Group(), color = STALL_COLORS[st.type] || "#d23a3a";
    g.add(pad(3.6, 3.4));
    g.add(box(2.8, 0.95, 1.2, "#7a5236", 0, 0.48, 0.3));
    g.add(box(2.8, 1.9, 0.15, "#6a4428", 0, 0.95, -1.0));
    [[-1.35, 0.85], [1.35, 0.85], [-1.35, -1.0], [1.35, -1.0]].forEach(function (p) { g.add(box(0.09, 2.25, 0.09, "#5a3a26", p[0], 1.12, p[1])); });
    var roof = box(3.2, 0.12, 2.4, color, 0, 2.28, -0.05);
    roof.rotation.x = 0.12;
    g.add(roof);
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.55), signMaterial(D.BUILD[st.type].name.ja, color));
    sign.position.set(0, 1.92, 0.93);
    g.add(sign);
    if (st.type === "kingyo") g.add(mesh(new THREE.BoxGeometry(2.2, 0.18, 0.9), new THREE.MeshLambertMaterial({ color: "#5ab0ff", transparent: true, opacity: 0.7 }), 0, 1.0, 0.3));
    if (st.type === "kasaSt") {
      ["#c8282e", "#2f6fb5", "#e0a020"].forEach(function (hex, i) {
        var u = wagasa(hex);
        u.position.set(-1.7 + i * 0.25, 0, 1.3 - i * 0.5);
        u.rotation.z = 0.25;
        g.add(u);
      });
    }
    return g;
  }

  function buildQstall(st, s) {
    var g = new THREE.Group(), body = new THREE.Group();
    body.add(box(1.2, 0.7, 0.7, "#a0704a", 0, 0.65, 0));
    [-0.45, 0.45].forEach(function (x) {
      var wl = cyl(0.28, 0.28, 0.08, "#3a2a22", x, 0.3, 0.38, 12);
      wl.rotation.x = Math.PI / 2;
      body.add(wl);
      body.add(box(0.05, 1.0, 0.05, "#5a3a26", x, 1.5, -0.25));
    });
    body.add(box(1.4, 0.06, 0.9, "#c8282e", 0, 2.0, -0.1));
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.3), signMaterial(D.BUILD.qstall.name.ja, "#c8282e"));
    sign.position.set(0, 1.2, 0.36);
    body.add(sign);
    g.add(body);
    // 朝向連結的遊樂設施
    var ride = st.link && s.structs[st.link];
    if (ride) {
      var me = footCenter(st.type, st.x, st.y), to = footCenter(ride.type, ride.x, ride.y);
      body.rotation.y = Math.atan2(to.x - me.x, to.z - me.z);
    }
    return g;
  }

  function buildSmall(st) {
    var g = new THREE.Group(), t = st.type;
    if (t === "bench") {
      g.add(box(1.4, 0.08, 0.45, "#a0704a", 0, 0.45, 0));
      g.add(box(1.4, 0.35, 0.06, "#a0704a", 0, 0.68, -0.2));
      [-0.6, 0.6].forEach(function (x) { g.add(box(0.08, 0.45, 0.4, "#5a3a26", x, 0.22, 0)); });
    } else if (t === "toilet") {
      g.add(pad(3.4, 3.4));
      g.add(box(2.8, 2.2, 2.4, "#f0ece4", 0, 1.1, -0.3));
      var r = mesh(new THREE.ConeGeometry(2.3, 0.8, 4), lam("#3c4a52"), 0, 2.6, -0.3);
      r.rotation.y = Math.PI / 4;
      g.add(r);
      g.add(box(0.6, 1.4, 0.05, "#2f6fb5", -0.6, 0.7, 0.92));
      g.add(box(0.6, 1.4, 0.05, "#d23a3a", 0.6, 0.7, 0.92));
    } else if (t === "trash") {
      g.add(cyl(0.26, 0.22, 0.7, "#6a8a3a", 0, 0.35, 0, 10));
      g.add(cyl(0.28, 0.28, 0.05, "#3a4a2a", 0, 0.72, 0, 10));
    } else if (t === "shelter") {
      [[-1.5, -1.3], [1.5, -1.3], [-1.5, 1.3], [1.5, 1.3]].forEach(function (p) { g.add(cyl(0.07, 0.08, 2.4, "#b8b060", p[0], 1.2, p[1], 6)); });
      var roof = box(3.6, 0.06, 3.2, "#f4efe4", 0, 2.45, 0);
      roof.rotation.x = 0.08;
      g.add(roof);
      g.add(box(3.6, 0.3, 0.04, "#2f4f8f", 0, 2.3, 1.6));
      g.add(box(2.4, 0.08, 0.4, "#a0704a", 0, 0.45, -1.0));
    } else if (t === "lanternPost") {
      g.add(cyl(0.05, 0.06, 2.2, "#3a2a22", 0, 1.1, 0, 6));
      var pivot = new THREE.Group();
      pivot.position.set(0, 2.2, 0);
      var lm = glow("#ffc070", 2.4);
      pivot.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.38, 14), lm, 0, -0.25, 0));
      g.add(pivot);
      g.userData.sway = [{ obj: pivot, phase: st.id * 1.7, axis: "z" }];
      var base = lm.color.clone(), ph = st.id * 2.3;
      g.userData.always = function (time) { lm.color.copy(base).multiplyScalar(1 + 0.12 * Math.sin(time * 7 + ph) + 0.05 * Math.sin(time * 13 + ph)); }; // 微閃
    } else if (t === "flower") {
      g.add(box(1.6, 0.2, 1.6, "#6a4a32", 0, 0.1, 0));
      var cols = ["#ff7aa0", "#ffd040", "#ffffff", "#c070ff", "#ff5050"];
      for (var i = 0; i < 12; i++) {
        g.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), lam(cols[i % cols.length]), -0.55 + (i % 4) * 0.37, 0.28, -0.5 + Math.floor(i / 4) * 0.5));
      }
    }
    return g;
  }

  var BUILDERS = {
    shrine: buildShrine, merry: buildMerry, cups: buildCups, chairs: buildChairs, wheel: buildWheel,
    kingyo: buildStall, shateki: buildStall, wanage: buildStall, omikuji: buildStall,
    takoyakiSt: buildStall, ameSt: buildStall, ramuneSt: buildStall, kasaSt: buildStall, juyo: buildStall,
    qstall: buildQstall, bench: buildSmall, toilet: buildSmall, trash: buildSmall, shelter: buildSmall, lanternPost: buildSmall, flower: buildSmall,
  };
  var SCAFFOLD_H = { wheel: 9, chairs: 6, merry: 4.5, cups: 3.5 };

  // 施工中：地基＋鷹架（細圓柱格子）＋施工圍籬＋「施工中 N」
  function buildScaffold(st) {
    var b = D.BUILD[st.type], g = new THREE.Group();
    var w = b.w * T - 0.4, d = b.h * T - 0.4, H = SCAFFOLD_H[st.type] || 2.6;
    g.add(box(w, 0.15, d, "#a8a8a0", 0, 0.075, 0));
    var nx = Math.max(2, Math.round(w / 1.4) + 1), nz = Math.max(2, Math.round(d / 1.4) + 1), levels = Math.max(2, Math.round(H / 1.5));
    var poleList = [], barList = [];
    var ix, iz, lv;
    for (ix = 0; ix < nx; ix++) for (iz = 0; iz < nz; iz++) {
      if (ix > 0 && ix < nx - 1 && iz > 0 && iz < nz - 1) continue;
      poleList.push([-w / 2 + 0.3 + ix * (w - 0.6) / (nx - 1), -d / 2 + 0.3 + iz * (d - 0.6) / (nz - 1)]);
    }
    for (lv = 1; lv <= levels; lv++) {
      var y = lv * H / levels;
      barList.push([0, y, -d / 2 + 0.3, w - 0.6, 0], [0, y, d / 2 - 0.3, w - 0.6, 0], [-w / 2 + 0.3, y, 0, d - 0.6, 1], [w / 2 - 0.3, y, 0, d - 0.6, 1]);
    }
    var steel = lam("#c8b070");
    var poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, H, 5), steel, poleList.length);
    poleList.forEach(function (p, i) { tmpM.makeTranslation(p[0], H / 2 + 0.15, p[1]); poles.setMatrixAt(i, tmpM); });
    var bars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 4), steel, barList.length);
    barList.forEach(function (p, i) {
      tmpQ.setFromEuler(new THREE.Euler(p[4] ? Math.PI / 2 : 0, 0, p[4] ? 0 : Math.PI / 2));
      tmpM.compose(tmpV.set(p[0], p[1] + 0.15, p[2]), tmpQ, tmpS.set(1, p[3], 1));
      bars.setMatrixAt(i, tmpM);
    });
    g.add(poles, bars);
    var fence = lam("#f0e6c8"), stripe = lam("#e0a020");
    [[0, d / 2 + 0.1, w + 0.2, 0], [0, -d / 2 - 0.1, w + 0.2, 0], [w / 2 + 0.1, 0, d + 0.2, 1], [-w / 2 - 0.1, 0, d + 0.2, 1]].forEach(function (f) {
      var panel = box(f[3] ? 0.05 : f[2], 1.0, f[3] ? f[2] : 0.05, null, f[0], 0.5, f[1]);
      panel.material = fence;
      var band = box(f[3] ? 0.06 : f[2], 0.15, f[3] ? f[2] : 0.06, null, f[0], 0.75, f[1]);
      band.material = stripe;
      g.add(panel, band);
    });
    var sp = textSprite("施工中 " + st.build, "#e0a020", "#2b2230", 3.2);
    sp.position.set(0, H + 1.4, 0);
    g.add(sp);
    return g;
  }

  function windStop(st) { return D.WEATHER[weather] && D.WEATHER[weather].stop && D.BUILD[st.type].wind && !(st.build > 0); }

  function structSig(st) {
    return [st.type, st.x, st.y, st.build > 0 ? st.build : 0, Object.keys(st.mods || {}).sort().join(","), st.broken ? 1 : 0, st.link || 0, windStop(st) ? 1 : 0].join("|");
  }

  function makeStruct(st, s) {
    var g;
    if (st.build > 0) g = buildScaffold(st);
    else g = (BUILDERS[st.type] || buildSmall)(st, s);
    var b = D.BUILD[st.type];
    var top = st.build > 0 ? 0 : (SCAFFOLD_H[st.type] || 2.6) + (st.type === "wheel" ? 1.6 : 0.6);
    if (st.broken && !(st.build > 0)) {
      var x = crossSprite();
      x.position.set(0, top + 1.0, 0);
      g.add(x);
    }
    if (windStop(st)) {
      var sign = textSprite("本日運休", "#f4efe4", "#c8282e", 3.4);
      sign.position.set(0, top + (st.broken ? 2.4 : 1.0), 0);
      g.add(sign);
    }
    var c = footCenter(st.type, st.x, st.y);
    g.position.set(c.x, 0, c.z);
    g.userData.footW = b.w * T;
    return g;
  }

  function syncStructs(s) {
    var seen = {}, k;
    for (k in s.structs) {
      var st = s.structs[k], sig = structSig(st);
      seen[k] = 1;
      var rec = recs[k];
      if (rec && rec.sig === sig) continue;
      if (rec) { scene.remove(rec.group); disposeTree(rec.group); }
      var g = makeStruct(st, s);
      scene.add(g);
      recs[k] = { sig: sig, group: g, speed: 0 };
    }
    for (k in recs) if (!seen[k]) { scene.remove(recs[k].group); disposeTree(recs[k].group); delete recs[k]; }
  }

  function syncPaths(s) {
    if (pathMesh && pathVer === s.mapVer && pathState === s) return;
    pathVer = s.mapVer;
    pathState = s;
    if (pathMesh) { scene.remove(pathMesh); pathMesh.geometry.dispose(); pathMesh.dispose(); }
    var list = [];
    for (var y = 0; y < M.H; y++) for (var x = 0; x < M.W; x++) if (s.tiles[Core.ti(x, y)] === 1) list.push(tileToWorld(x, y));
    var geo = new THREE.BoxGeometry(T, 0.04, T);
    pathMesh = new THREE.InstancedMesh(geo, pathMat, Math.max(1, list.length));
    pathMesh.count = list.length;
    list.forEach(function (p, i) { tmpM.makeTranslation(p.x, 0.02, p.z); pathMesh.setMatrixAt(i, tmpM); });
    scene.add(pathMesh);
  }

  // ---------------------------------------------------------------- 客人
  function jitter(gid) {
    return { x: (((gid * 37) % 11) / 10 - 0.5) * 1.2, z: (((gid * 53) % 13) / 12 - 0.5) * 1.2 };
  }

  function computeSnap(s) {
    var out = {}, list = [], qi = {}, k;
    for (k in s.structs) {
      var st = s.structs[k];
      if (st.q) for (var i = 0; i < st.q.length; i++) qi[st.q[i]] = { st: st, i: i };
    }
    (s.guests || []).forEach(function (g) {
      var p, j = jitter(g.id), q = qi[g.id], rec = { hide: false, face: null, kasa: !!g.kasa, outfit: g.outfit || 0 };
      if (g.state === "queue" && q) {
        // 沿入口往外排成一列（每人 0.6 m），面向設施
        var e = Core.entranceOf(q.st);
        p = tileToWorld(e.x, e.y);
        rec.x = p.x;
        rec.z = p.z - T / 2 + 0.3 + q.i * 0.6;
        rec.face = Math.PI;
      } else {
        p = tileToWorld(g.x, g.y);
        rec.x = p.x + j.x;
        rec.z = p.z + j.z;
        if (g.state === "ride") rec.hide = true; // 搭乘中不畫
      }
      out[g.id] = rec;
      list.push(g.id);
    });
    return { map: out, list: list };
  }

  function updateGuests(time) {
    if (!crowd) return;
    var n = 0, u = 0, a = alphaV, cam = camera.position;
    var nextDrawn = {};
    for (var i = 0; i < snap.list.length && n < MAX_GUESTS; i++) {
      var gid = snap.list[i], c = snap.cur[gid];
      if (!c || c.hide) continue;
      var p = snap.prev[gid] || c;
      var x = p.x + (c.x - p.x) * a, z = p.z + (c.z - p.z) * a;
      var dx = c.x - p.x, dz = c.z - p.z, moving = dx * dx + dz * dz > 0.01 && a < 1;
      var h = headings[gid] || 0;
      if (c.face !== null && !moving) h = c.face;
      else if (dx * dx + dz * dz > 0.01) h = Math.atan2(dx, dz);
      headings[gid] = h;
      var scale = 0.9 + (gid % 7) * 0.025;
      var frame = moving ? Math.floor(time * 6 + gid * 0.37) % 4 : 1;
      crowd.set(n, x, 0.02, z, Crowd.dirIndex(h, cam.x, cam.z, x, z), (c.outfit % Crowd.OUTFITS.length) * Crowd.FRAMES + frame, scale);
      n++;
      nextDrawn[gid] = { x: x, z: z, scale: scale };
      if (c.kasa) {
        tmpM.makeTranslation(x, 1.62 * scale + 0.08, z);
        umbrellas.setMatrixAt(u++, tmpM);
      }
    }
    // 搭乘中（暫時不畫）的客人保留最後位置，氣泡與跟拍仍可定位
    for (var g in drawn) if (!nextDrawn[g] && snap.cur[g]) nextDrawn[g] = drawn[g];
    drawn = nextDrawn;
    crowd.count(n);
    umbrellas.count = u;
    umbrellas.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 小夜（VRM）
  function loadVrm(url) {
    var loader = new V.GLTFLoader();
    loader.register(function (parser) { return new V.VRMLoaderPlugin(parser); });
    return new Promise(function (resolve, reject) { loader.load(url, resolve, null, reject); });
  }

  function sayoSpot() {
    var e = tileToWorld(M.SHRINE.x - 1, M.GATE.y);
    return { x: e.x - 1.2, z: e.z - 1.5 };
  }

  function setupSayo(gltf) {
    sayo = gltf.userData.vrm;
    sayo.scene.traverse(function (o) { o.frustumCulled = false; });
    var p = sayoSpot();
    sayo.scene.position.set(p.x, 0, p.z);
    sayo.scene.rotation.y = -Math.PI / 4; // 面向入口與鏡頭
    Crowd.restPose(sayo);
    scene.add(sayo.scene);
  }

  function updateSayo(dt, time) {
    if (!sayo) return;
    Crowd.restPose(sayo);
    var hb = function (n) { return sayo.humanoid.getNormalizedBoneNode(n); };
    hb("chest").rotation.x = Math.sin(time * 1.6) * 0.025;
    hb("head").rotation.y = Math.sin(time * 0.45) * 0.35;
    hb("head").rotation.z = Math.sin(time * 0.7) * 0.05;
    hb("spine").rotation.z = Math.sin(time * 0.8) * 0.02;
    blinkTimer -= dt;
    if (blinkTimer <= 0 && blinkT < 0) { blinkT = 0; blinkTimer = 2 + Math.random() * 3; }
    var blink = 0;
    if (blinkT >= 0) {
      blinkT += dt;
      blink = blinkT < 0.07 ? blinkT / 0.07 : Math.max(0, 1 - (blinkT - 0.07) / 0.08);
      if (blinkT > 0.15) blinkT = -1;
    }
    sayo.expressionManager.setValue("blink", blink);
    sayo.update(dt);
  }

  // ---------------------------------------------------------------- murmur 氣泡
  function bubble(m) {
    if (!overlay || !m) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "en-bubble en-mm-border-" + m.type;
    b.setAttribute("data-gid", String(m.gid || 0));
    if (m.photo) {
      var img = document.createElement("img");
      img.src = jikanBase() + m.photo + ".webp";
      img.alt = "";
      b.appendChild(img);
    }
    var sp = document.createElement("span");
    sp.textContent = L(m.text);
    b.appendChild(sp);
    b.style.display = "none";
    overlay.appendChild(b);
    bubbles.push({ node: b, life: BUBBLE_LIFE, gid: m.gid || 0 });
    while (bubbles.length > BUBBLE_MAX) removeBubble(0);
  }

  function removeBubble(i) {
    var b = bubbles[i];
    if (b.node.parentNode) b.node.parentNode.removeChild(b.node);
    bubbles.splice(i, 1);
  }

  function updateBubbles(dt) {
    var w = stage.clientWidth, h = stage.clientHeight;
    for (var i = bubbles.length - 1; i >= 0; i--) {
      var b = bubbles[i];
      b.life -= dt;
      if (b.life <= 0) { removeBubble(i); continue; }
      var p = b.gid ? drawn[b.gid] : null;
      if (p) tmpV.set(p.x, 1.62 * p.scale + 0.1, p.z);
      else if (!b.gid && sayo) tmpV.copy(sayo.scene.position).setY(1.7);
      else { b.node.style.display = "none"; continue; }
      tmpV.project(camera);
      var visible = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1;
      b.node.style.display = visible ? "" : "none";
      b.node.style.transform = "translate(" + ((tmpV.x * 0.5 + 0.5) * w) + "px," + ((-tmpV.y * 0.5 + 0.5) * h) + "px) translate(-50%,-100%)";
      b.node.style.opacity = Math.min(1, b.life / 0.6, (BUBBLE_LIFE - b.life) / 0.3) + "";
    }
  }

  // ---------------------------------------------------------------- 天氣
  var SKY = {
    sun: { sky: "#8ec9f0", hemi: 0.65, sun: 0.8, ground: 1 },
    cloud: { sky: "#a7afb8", hemi: 0.62, sun: 0.3, ground: 0.9 },
    rain: { sky: "#66707c", hemi: 0.52, sun: 0.12, ground: 0.62 },
    wind: { sky: "#9cc3e0", hemi: 0.65, sun: 0.7, ground: 1 },
  };
  function setWeather(id) {
    weather = SKY[id] ? id : "sun";
    if (!scene) return;
    var c = SKY[weather];
    scene.background.set(c.sky);
    scene.fog.color.set(c.sky);
    hemi.intensity = c.hemi;
    sunLight.intensity = c.sun;
    groundMat.color.set("#6f9a4e").multiplyScalar(c.ground);
    pathMat.color.set("#c9b48e").multiplyScalar(c.ground);
    rain.visible = weather === "rain";
    // 強風：停駛設施掛「本日運休」牌（簽章含停駛旗標，下次 sync 會重建）
    if (cur) syncStructs(cur);
  }

  function updateRain(dt) {
    if (!rain.visible) return;
    var pos = rain.geometry.attributes.position, arr = pos.array;
    for (var i = 1; i < arr.length; i += 3) {
      arr[i] -= 18 * dt;
      if (arr[i] < 0) arr[i] += 30; // 碰地重置
    }
    pos.needsUpdate = true;
  }

  function swayOne(o, time, windy) {
    var amp = windy ? 0.38 : 0.04, f = windy ? 3.4 : 1.1;
    o.obj.rotation[o.axis] = Math.sin(time * f + o.phase) * amp + (windy ? Math.sin(time * 7.3 + o.phase * 2) * 0.08 : 0);
  }

  // ---------------------------------------------------------------- 迴圈
  function updateStructs(dt, time) {
    var s = cur, windy = weather === "wind";
    for (var k in recs) {
      var rec = recs[k], ud = rec.group.userData, st = s && s.structs[k];
      if (ud.always) ud.always(time);
      if (ud.sway) for (var i = 0; i < ud.sway.length; i++) swayOne(ud.sway[i], time, windy);
      if (!ud.update || !st) continue;
      var running = !st.broken && !(st.build > 0) && st.t > 0 && st.riders && st.riders.length > 0;
      var target = running ? (st.mods && st.mods.drive ? 1.5 : 1) : 0; // drive：轉速 ×1.5
      if (st.broken) rec.speed = 0; // 故障：動畫停止
      else rec.speed += (target - rec.speed) * Math.min(1, dt * 1.5);
      ud.update(dt * rec.speed, time, rec.speed, dt);
    }
    for (var j = 0; j < decoSway.length; j++) swayOne(decoSway[j], time, windy);
  }

  function updateFollow(dt) {
    if (follow == null) return;
    var p = drawn[follow];
    if (!p) return;
    tmpV.set(p.x, 0.8, p.z).sub(controls.target);
    if (followZoom) {
      // 第一次跟拍：拉近到客人附近
      var off = camera.position.clone().sub(controls.target).setLength(14);
      controls.target.add(tmpV);
      camera.position.copy(controls.target).add(off);
      followZoom = false;
      return;
    }
    tmpV.multiplyScalar(Math.min(1, dt * 4));
    controls.target.add(tmpV);
    camera.position.add(tmpV);
  }

  function frame() {
    requestAnimationFrame(frame);
    var dt = Math.min(clock.getDelta(), 0.05), time = clock.elapsedTime;
    updateStructs(dt, time);
    updateGuests(time);
    updateSayo(dt, time);
    updateRain(dt);
    updateFollow(dt);
    controls.update();
    composer.render();
    updateBubbles(dt);
  }

  // ---------------------------------------------------------------- 對外 API
  function init(stageEl, opts) {
    if (initPromise) return initPromise;
    opts = opts || {};
    initPromise = new Promise(function (resolve, reject) {
      if (!window.THREE || !window.PriTestEnnichiVendor) { reject(new Error("three.js / ennichi_vrm.js not loaded")); return; }
      V = window.PriTestEnnichiVendor;
      stage = stageEl;
      try {
        setupRenderer();
        buildWorld();
        setWeather(weather);
      } catch (e) { reject(e); return; }
      requestAnimationFrame(frame);
      var jobs = [];
      // 群眾圖集用程式版 VRM（較輕）；小夜用 modelUrl（Blender 版）
      jobs.push(loadVrm(opts.crowdModelUrl || opts.modelUrl).then(function (gltf) {
        crowd = Crowd.create(scene, Crowd.buildAtlas(renderer, gltf.userData.vrm), MAX_GUESTS);
      }));
      if (opts.modelUrl) jobs.push(loadVrm(opts.modelUrl).then(setupSayo));
      Promise.all(jobs).then(function () { ready = true; resolve(api); }, reject);
    });
    return initPromise;
  }

  function sync(s, alpha) {
    if (!scene || !s) return;
    alphaV = alpha == null ? 1 : Math.max(0, Math.min(1, alpha));
    syncPaths(s);
    syncStructs(s);
    syncEma(s);
    var key = s.day + ":" + s.phase + ":" + s.min;
    if (snap.s !== s) {
      var c0 = computeSnap(s);
      snap = { s: s, key: key, prev: c0.map, cur: c0.map, list: c0.list };
      headings = {};
      drawn = {};
    } else if (snap.key !== key) {
      var c1 = computeSnap(s);
      snap.prev = snap.cur;
      snap.cur = c1.map;
      snap.list = c1.list;
      snap.key = key;
    }
    cur = s;
  }

  function pickTile(clientX, clientY) {
    if (!renderer) return null;
    var r = renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    tmpV.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5);
    raycaster.setFromCamera(tmpV, camera);
    var hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
    var x = Math.floor(hit.x / T + M.W / 2), y = Math.floor(hit.z / T + M.H / 2);
    return Core.inMap(x, y) ? { x: x, y: y } : null;
  }

  function ghost(type, x, y, ok) {
    if (!ghostGroup) return;
    if (type == null) { ghostGroup.visible = false; return; }
    var b = D.BUILD[type], w = b ? b.w : 1, h = b ? b.h : 1;
    var c = tileToWorld(x + (w - 1) / 2, y + (h - 1) / 2);
    var bx = ghostGroup.userData.box, door = ghostGroup.userData.door;
    bx.scale.set(w * T - 0.1, 0.6, h * T - 0.1);
    bx.position.set(c.x, 0.3, c.z);
    bx.material.color.set(ok ? "#40d060" : "#e04040");
    // 入口格（建物下方中央）
    door.visible = !!b && b.kind !== "shrine";
    if (door.visible) {
      var e = tileToWorld(x + Math.floor(w / 2), y + h);
      door.position.set(e.x, 0.06, e.z);
    }
    ghostGroup.visible = true;
  }

  function focusGuest(gid) {
    follow = gid == null ? null : gid;
    followZoom = follow != null;
  }

  var api = {
    init: init, sync: sync, pickTile: pickTile, ghost: ghost, focusGuest: focusGuest, bubble: bubble,
    tileToWorld: tileToWorld, setWeather: setWeather,
    // 測試用：目前畫面的摘要
    _debug: function () {
      return {
        ready: ready, structs: Object.keys(recs).length, guests: crowd ? crowd.mesh.geometry.instanceCount : 0,
        weather: weather, rain: !!(rain && rain.visible), bubbles: bubbles.length, follow: follow, sayo: !!sayo,
        ema: emaCount, paths: pathMesh ? pathMesh.count : 0,
      };
    },
  };
  window.PriTestEnnichi3D = api;
})();
