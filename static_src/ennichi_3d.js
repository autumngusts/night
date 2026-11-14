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
  var MAX_GUESTS = 768; // 各區客人合計（目前觀看區域的客人優先畫）
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
  // 區域 a 的中心在 z = areaZ(a)：各區沿 −z 排列，中間隔 28 m 的林帶（規格 §6.3.1）
  var STRIDE = M.H * T + 28;
  function areaZ(a) { return -a * STRIDE; }
  function tileToWorld(x, y) {
    var a = Math.max(0, Math.min(D.AREAS.length - 1, Math.floor(y / M.H))), ly = y - a * M.H;
    return { x: (x + 0.5 - M.W / 2) * T, z: areaZ(a) + (ly + 0.5 - M.H / 2) * T };
  }
  // 方向（規格 §4.7）：模型一律以「入口朝 +z」組好，再依 rot 轉向（0 +z、1 −x、2 −z、3 +x）
  var ROT_Y = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
  function footCenter(type, x, y, rot) {
    var d = D.BUILD[type] ? Core.dims(type, rot) : { w: 1, h: 1 };
    return tileToWorld(x + (d.w - 1) / 2, y + (d.h - 1) / 2);
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
    // near 0.5：合成用的多重取樣深度緩衝可能只有 16 bit，near 太小時遠處區域的步道（高 4 cm）會和地面互相蓋住
    camera = new THREE.PerspectiveCamera(42, w / h, 0.5, 400);
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
    var span = STRIDE * D.AREAS.length + 400;
    var outer = new THREE.Mesh(new THREE.PlaneGeometry(400, span), new THREE.MeshLambertMaterial({ color: "#3f5f34" }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(0, -0.4, areaZ(D.AREAS.length - 1) / 2); // 比地面低很多：地面材質有 polygonOffset
    scene.add(outer);
    groundMat = groundMaterial("#6f9a4e");
    groundMats.push({ mat: groundMat, hex: "#6f9a4e" });
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(M.W * T, M.H * T), groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    // v2 擴張用地（x ≥ UNLOCK_X）：顏色較深
    var lw = (M.W - M.UNLOCK_X) * T;
    var locked = new THREE.Mesh(new THREE.PlaneGeometry(lw, M.H * T), new THREE.MeshLambertMaterial({ color: "#56784a" }));
    locked.rotation.x = -Math.PI / 2;
    locked.position.set((M.UNLOCK_X - M.W / 2) * T + lw / 2, 0.005, 0);
    scene.add(locked);
    pathMat = new THREE.MeshLambertMaterial({ color: "#ffffff" }); // 各區步道顏色放在 instanceColor

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

    buildScenery();
    buildTrees();
    buildAreas();
    var hw = M.W / 2 * T, hh = M.H / 2 * T;

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

  // ---------------------------------------------------------------- 區域環境（多張地圖，規格 §6.3.1）
  // 每區一張 32×20 的地面，沿 −z 排列（區域之間是林帶）；未開放的區域蓋暗、圍上柵欄、掛「🔒」牌。
  var AREA_STYLE = {
    shrine: { ground: "#6f9a4e", path: "#c9b48e" },
    land: { ground: "#7cab55", path: "#dccaa4", gate: ["#e05a8a", "#f4c040"] },
    factory: { ground: "#8a8a82", path: "#6f7076", gate: ["#6a6f7a", "#e0a020"] },
    water: { ground: "#d9c690", path: "#b8875a", gate: ["#2f8fd0", "#ffffff"] },
    theme: { ground: "#6f9458", path: "#b5604c", gate: ["#7a4ac0", "#f4c040"] },
  };
  var groundMats = [], areaLocks = [], envUpdates = [], areasSig = "";

  // 地面材質：polygonOffset 讓地面在深度上往後退，貼在上面的步道、湖岸不會閃爍
  function groundMaterial(hex) {
    return new THREE.MeshLambertMaterial({ color: hex, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
  }
  function areaRect(a) { return { x: 0, z: areaZ(a), w: M.W * T, d: M.H * T }; }

  // 入口拱門（境內以外的區域）：兩根柱子＋半圓拱＋招牌
  function archGate(a) {
    var ar = D.AREAS[a], st = AREA_STYLE[ar.id], g = new THREE.Group();
    [-2.2, 2.2].forEach(function (z) {
      g.add(cyl(0.28, 0.32, 4.2, st.gate[0], 0, 2.1, z, 12));
      g.add(mesh(new THREE.SphereGeometry(0.42, 12, 10), lam(st.gate[1]), 0, 4.45, z));
    });
    var arch = mesh(new THREE.TorusGeometry(2.2, 0.16, 8, 24, Math.PI), lam(st.gate[1]), 0, 4.2, 0);
    arch.rotation.y = Math.PI / 2;
    g.add(arch);
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.8), signMaterial(ar.name.ja, st.gate[0]));
    sign.position.set(-0.05, 4.8, 0);
    sign.rotation.y = -Math.PI / 2;
    g.add(sign);
    var back = sign.clone();
    back.position.x = 0.05;
    back.rotation.y = Math.PI / 2;
    g.add(back);
    // 拱門上的燈泡
    var bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), glow("#ffe0a0", 2.2), 14);
    for (var i = 0; i < 14; i++) {
      var an = i / 13 * Math.PI;
      tmpM.makeTranslation(0, 4.2 + Math.sin(an) * 2.2, Math.cos(an) * 2.2);
      bulbs.setMatrixAt(i, tmpM);
    }
    g.add(bulbs);
    return g;
  }

  // 未開放：暗色罩＋柵欄＋浮在空中的鎖牌
  function lockGroup(a) {
    var r = areaRect(a), g = new THREE.Group();
    var cover = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), new THREE.MeshBasicMaterial({ color: "#1a1626", transparent: true, opacity: 0.42, depthWrite: false }));
    cover.rotation.x = -Math.PI / 2;
    cover.position.set(0, 0.09, r.z);
    g.add(cover);
    var posts = [], step = 2.4, hw = r.w / 2, hd = r.d / 2, x, z;
    for (x = -hw; x <= hw + 0.01; x += step) posts.push([x, r.z - hd], [x, r.z + hd]);
    for (z = -hd + step; z < hd; z += step) posts.push([-hw, r.z + z], [hw, r.z + z]);
    var pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 1.1, 0.14), lam("#d8c49a"), posts.length);
    posts.forEach(function (p, i) { tmpM.makeTranslation(p[0], 0.55, p[1]); pm.setMatrixAt(i, tmpM); });
    pm.frustumCulled = false;
    g.add(pm);
    [[0, r.z - hd, r.w, 0], [0, r.z + hd, r.w, 0], [-hw, r.z, r.d, 1], [hw, r.z, r.d, 1]].forEach(function (f) {
      [0.45, 0.85].forEach(function (y) { g.add(box(f[3] ? 0.05 : f[2], 0.06, f[3] ? f[2] : 0.05, "#e0a020", f[0], y, f[1])); });
    });
    var ar = D.AREAS[a];
    var sp = textSprite("🔒 " + L(ar.name), "#2b2230", "#ffe7a8", 9);
    sp.position.set(0, 7, r.z);
    g.add(sp);
    var sp2 = textSprite("Lv" + ar.lv + " ¥" + ar.cash.toLocaleString("en-US"), "#c8282e", "#ffffff", 6);
    sp2.position.set(0, 4.6, r.z);
    g.add(sp2);
    return g;
  }

  // 水樂園的湖：細分平面，每幀讓頂點起伏（flatShading 的 Phong 才看得出波光）
  function buildLake(a) {
    var lk = D.AREAS[a].lake, c = tileToWorld(lk.x + (lk.w - 1) / 2, a * M.H + lk.y + (lk.h - 1) / 2);
    var geo = new THREE.PlaneGeometry(lk.w * T, lk.h * T, lk.w * 2, lk.h * 2);
    geo.rotateX(-Math.PI / 2);
    var mat = new THREE.MeshPhongMaterial({ color: "#3a8fd0", shininess: 90, specular: "#cfefff", transparent: true, opacity: 0.88, flatShading: true });
    var lake = new THREE.Mesh(geo, mat);
    lake.position.set(c.x, 0.06, c.z);
    scene.add(lake);
    // 湖岸（砂）與淺灘
    var shore = box(lk.w * T + 0.8, 0.05, lk.h * T + 0.8, "#c9b27a", c.x, 0.02, c.z);
    scene.add(shore);
    var pos = geo.attributes.position, base = Float32Array.from(pos.array);
    envUpdates.push(function (time) {
      if (!lake.visible) return;
      for (var i = 0; i < pos.count; i++) {
        var x = base[i * 3], z = base[i * 3 + 2];
        pos.array[i * 3 + 1] = Math.sin(x * 0.9 + time * 1.6) * 0.05 + Math.cos(z * 1.3 + time * 1.1) * 0.04;
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    });
  }

  // 各區的背景（地圖外側，不擋玩家的格子）
  function envLand(a, gz) {
    var r = areaRect(a), ex = r.w / 2 + 7;
    // 熱氣球
    [["#e05a5a", -6, 12], ["#f4c040", 4, 15], ["#5aa0e0", 12, 11]].forEach(function (b, i) {
      var bg = new THREE.Group();
      bg.add(mesh(new THREE.SphereGeometry(1.6, 16, 12), lam(b[0]), 0, 0, 0));
      bg.add(mesh(new THREE.ConeGeometry(0.9, 1.2, 12), lam(b[0]), 0, -1.6, 0));
      bg.add(box(0.6, 0.45, 0.6, "#8a5a3a", 0, -2.6, 0));
      bg.position.set(ex + b[1] * 0.4, b[2], r.z + b[1]);
      scene.add(bg);
      envUpdates.push(function (time) { bg.position.y = b[2] + Math.sin(time * 0.4 + i * 2) * 0.6; });
    });
    // 外側的彩色帳篷
    ["#e05a8a", "#5ab0e0", "#f4c040"].forEach(function (hex, i) {
      var tz = r.z - 12 + i * 10;
      scene.add(cyl(1.8, 1.8, 2.0, "#f4efe4", ex, 1.0, tz, 16));
      scene.add(mesh(new THREE.ConeGeometry(2.2, 1.8, 16), lam(hex), ex, 2.9, tz));
    });
    // 入口旁的氣球束
    for (var i = 0; i < 6; i++) {
      var col = ["#ff5a5a", "#ffd040", "#5ad0ff", "#a070ff", "#60d080", "#ff8ad0"][i];
      var bl = mesh(new THREE.SphereGeometry(0.32, 10, 8), lam(col), -r.w / 2 - 3.2 + (i % 3) * 0.5, 3.2 + (i % 2) * 0.5, gz + 3 + Math.floor(i / 3) * 0.5);
      scene.add(bl);
    }
  }
  function envFactory(a, gz) {
    var r = areaRect(a), ex = r.w / 2 + 9;
    // 遠方的大工廠＋煙囪＋水塔
    scene.add(box(10, 6, 16, "#8a5040", ex + 2, 3, r.z));
    for (var i = 0; i < 4; i++) {
      var saw = box(10.2, 0.2, 4.6, "#5a6068", ex + 2, 6.8, r.z - 6 + i * 4);
      saw.rotation.x = 0.5;
      scene.add(saw);
    }
    var puffs = [];
    [[-4, 14], [3, 12]].forEach(function (c, ci) {
      scene.add(cyl(0.7, 0.9, c[1], "#7a5040", ex - 3, c[1] / 2, r.z + c[0], 14));
      scene.add(cyl(0.75, 0.75, 0.6, "#e8e0d0", ex - 3, c[1] * 0.85, r.z + c[0], 14));
      for (var k = 0; k < 5; k++) {
        var pf = mesh(new THREE.SphereGeometry(0.8, 8, 6), new THREE.MeshLambertMaterial({ color: "#e8e8ee", transparent: true, opacity: 0.6, depthWrite: false }), ex - 3, c[1], r.z + c[0]);
        scene.add(pf);
        puffs.push({ m: pf, base: c[1], ph: k / 5 + ci * 0.37 });
      }
    });
    envUpdates.push(function (time) {
      puffs.forEach(function (p) {
        var u = (time * 0.12 + p.ph) % 1;
        p.m.position.y = p.base + u * 7;
        p.m.position.x = ex - 3 - u * 3;
        p.m.scale.setScalar(0.6 + u * 1.8);
        p.m.material.opacity = 0.6 * (1 - u);
      });
    });
    var wt = new THREE.Group();
    [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]].forEach(function (p) { wt.add(cyl(0.08, 0.08, 6, "#6a6f7a", p[0], 3, p[1], 6)); });
    wt.add(cyl(1.5, 1.5, 2.2, "#a8b0b8", 0, 7.1, 0, 16));
    wt.add(mesh(new THREE.ConeGeometry(1.6, 0.9, 16), lam("#6a6f7a"), 0, 8.65, 0));
    wt.position.set(ex - 4, 0, r.z + 9);
    scene.add(wt);
    // 入口旁的貨櫃
    ["#c8482e", "#2f6fb5", "#3a9a5a"].forEach(function (hex, i) {
      scene.add(box(2.4, 1.2, 1.1, hex, -r.w / 2 - 4, 0.6 + (i === 2 ? 1.2 : 0), gz + 3.5 + (i === 1 ? 1.2 : 0)));
    });
  }
  function envWater(a, gz) {
    var r = areaRect(a), ex = r.w / 2 + 6;
    buildLake(a);
    // 外側沙灘、椰子樹、陽傘、燈塔
    scene.add(box(10, 0.04, r.d + 8, "#e6d29a", ex + 1, 0.01, r.z));
    var sea = box(16, 0.05, r.d + 30, "#2f86c8", ex + 14, 0.02, r.z);
    scene.add(sea);
    for (var i = 0; i < 6; i++) {
      var pz = r.z - 16 + i * 6.4, palm = new THREE.Group();
      var trunk = cyl(0.14, 0.22, 4.2, "#8a6a42", 0, 2.1, 0, 8);
      trunk.rotation.z = 0.12;
      palm.add(trunk);
      for (var k = 0; k < 6; k++) {
        var leaf = box(2.2, 0.06, 0.5, "#3f8a3a", 0, 0, 0);
        var lp = new THREE.Group();
        lp.position.set(0.25, 4.2, 0);
        lp.rotation.y = k / 6 * Math.PI * 2;
        leaf.position.x = 1.0;
        leaf.rotation.z = -0.35;
        lp.add(leaf);
        palm.add(lp);
      }
      palm.position.set(ex - 1 + (i % 2) * 2.5, 0, pz);
      scene.add(palm);
    }
    ["#ff5a5a", "#ffd040", "#5ad0ff"].forEach(function (hex, i) {
      var u = new THREE.Group();
      u.add(cyl(0.04, 0.04, 2.2, "#f0f0f0", 0, 1.1, 0, 6));
      u.add(mesh(new THREE.ConeGeometry(1.2, 0.5, 12), lam(hex), 0, 2.2, 0));
      u.position.set(ex + 2, 0, r.z - 6 + i * 6);
      scene.add(u);
    });
    var lh = new THREE.Group();
    lh.add(cyl(0.9, 1.3, 9, "#f4f0ea", 0, 4.5, 0, 16));
    [2, 5, 8].forEach(function (y) { lh.add(cyl(1.05 - y * 0.03, 1.1 - y * 0.03, 0.8, "#c8282e", 0, y, 0, 16)); });
    lh.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.9, 12), glow("#fff0b0", 2.2), 0, 9.5, 0));
    lh.add(mesh(new THREE.ConeGeometry(1.0, 0.9, 12), lam("#3c4a52"), 0, 10.4, 0));
    lh.position.set(ex + 6, 0, r.z + 13);
    scene.add(lh);
  }
  function envTheme(a, gz) {
    var r = areaRect(a), ex = r.w / 2 + 10;
    // 城堡
    var c = new THREE.Group();
    c.add(box(4, 5, 12, "#e8e0f0", 0, 2.5, 0));
    c.add(box(3, 3, 5, "#d8d0ec", 0, 6.5, 0));
    [[-6, 7], [6, 7], [0, 10]].forEach(function (p) {
      c.add(cyl(1.0, 1.1, p[1], "#e8e0f0", 0, p[1] / 2, p[0], 14));
      c.add(mesh(new THREE.ConeGeometry(1.4, 2.6, 14), lam("#5a4ac0"), 0, p[1] + 1.3, p[0]));
      var flag = box(0.04, 0.5, 0.8, "#f4c040", 0, p[1] + 3.0, p[0] + 0.4);
      c.add(cyl(0.03, 0.03, 0.9, "#555", 0, p[1] + 2.9, p[0], 4), flag);
    });
    for (var i = 0; i < 6; i++) c.add(box(0.06, 0.9, 0.5, "#fff2b0", -2.03, 2.2 + (i % 2) * 2, -4 + Math.floor(i / 2) * 4));
    c.position.set(ex, 0, r.z);
    scene.add(c);
    // 彩旗串（入口到城堡方向，地圖外側上空）
    var cols = ["#ff5a5a", "#ffd040", "#5ad0ff", "#a070ff", "#60d080"];
    var flags = new THREE.InstancedMesh(new THREE.ConeGeometry(0.22, 0.45, 3), new THREE.MeshLambertMaterial({ color: "#ffffff" }), 40);
    var col = new THREE.Color();
    for (var f = 0; f < 40; f++) {
      tmpQ.setFromEuler(new THREE.Euler(Math.PI, 0, 0));
      tmpM.compose(tmpV.set(-r.w / 2 - 1.5, 5.2 - Math.sin(f / 39 * Math.PI) * 0.8, r.z - r.d / 2 + f / 39 * r.d), tmpQ, tmpS.set(1, 1, 1));
      flags.setMatrixAt(f, tmpM);
      flags.setColorAt(f, col.set(cols[f % cols.length]));
    }
    flags.frustumCulled = false;
    scene.add(flags);
    // 入口旁的探照燈柱
    [-1, 1].forEach(function (sd) {
      scene.add(cyl(0.2, 0.25, 5, "#3c3a4a", -r.w / 2 - 4, 2.5, gz + sd * 4.5, 8));
      scene.add(mesh(new THREE.SphereGeometry(0.4, 10, 8), glow("#fff2c0", 2.6), -r.w / 2 - 4, 5.2, gz + sd * 4.5));
    });
  }
  var ENV = { land: envLand, factory: envFactory, water: envWater, theme: envTheme };

  function buildAreas() {
    D.AREAS.forEach(function (ar, a) {
      if (a === 0) return; // 境內在 buildWorld 已經建好
      var st = AREA_STYLE[ar.id], r = areaRect(a);
      var gm = groundMaterial(st.ground);
      groundMats.push({ mat: gm, hex: st.ground });
      var gr = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), gm);
      gr.rotation.x = -Math.PI / 2;
      gr.position.set(0, 0, r.z);
      scene.add(gr);
      var gz = tileToWorld(0, Core.gateOf(a).y).z;
      var gate = archGate(a);
      gate.position.set(-r.w / 2 - 1.2, 0, gz);
      scene.add(gate);
      if (ENV[ar.id]) ENV[ar.id](a, gz);
      var lock = lockGroup(a);
      scene.add(lock);
      areaLocks[a] = lock;
    });
  }

  function syncAreas(s) {
    var sig = JSON.stringify(s.areas || {});
    if (sig === areasSig) return;
    areasSig = sig;
    areaLocks.forEach(function (g, a) { if (g) g.visible = !Core.areaOpen(s, a); });
  }

  // 樹林：整個世界（所有區域與林帶）的外圍與區域之間，避開區域本體與入口前
  function buildTrees() {
    var spots = [], hw = M.W / 2 * T, hh = M.H / 2 * T, N = D.AREAS.length;
    var zMax = hh + 22, zMin = areaZ(N - 1) - hh - 22;
    function blocked(x0, z0) {
      for (var a = 0; a < N; a++) {
        var cz = areaZ(a);
        if (Math.abs(x0) < hw + 3 && Math.abs(z0 - cz) < hh + 3) return true;
        var gz = tileToWorld(0, Core.gateOf(a).y).z;
        if (x0 < -hw && x0 > -hw - 9 && Math.abs(z0 - gz) < 6) return true;
        if (a > 0 && x0 > hw + 2 && x0 < hw + 22 && Math.abs(z0 - cz) < hh + 6) return true; // 各區外側的背景
      }
      return false;
    }
    for (var n = 0; spots.length < 520 && n < 20000; n++) {
      var x0 = (Math.random() * 2 - 1) * (hw + 30), z0 = zMin + Math.random() * (zMax - zMin);
      if (blocked(x0, z0)) continue;
      spots.push([x0, z0, 0.75 + Math.random() * 0.75, Math.random()]);
    }
    var trunkGeo = new THREE.CylinderGeometry(0.15, 0.24, 1.8, 6);
    trunkGeo.translate(0, 0.9, 0);
    var leafGeo = new THREE.ConeGeometry(1.5, 3.2, 8);
    leafGeo.translate(0, 3.0, 0);
    var leafGeo2 = new THREE.ConeGeometry(1.1, 2.4, 8);
    leafGeo2.translate(0, 4.4, 0);
    var roundGeo = new THREE.IcosahedronGeometry(1.5, 1);
    roundGeo.translate(0, 3.0, 0);
    var conifer = spots.filter(function (s) { return s[3] < 0.62; }), broad = spots.filter(function (s) { return s[3] >= 0.62; });
    var trunks = new THREE.InstancedMesh(trunkGeo, lam("#5a3e2a"), spots.length);
    var leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: "#ffffff" }), conifer.length);
    var leaves2 = new THREE.InstancedMesh(leafGeo2, new THREE.MeshLambertMaterial({ color: "#ffffff" }), conifer.length);
    var rounds = new THREE.InstancedMesh(roundGeo, new THREE.MeshLambertMaterial({ color: "#ffffff", flatShading: true }), broad.length);
    var col = new THREE.Color();
    spots.forEach(function (sp, i) {
      tmpM.compose(tmpV.set(sp[0], 0, sp[1]), tmpQ.setFromEuler(new THREE.Euler(0, sp[3] * 6.28, 0)), tmpS.set(sp[2], sp[2], sp[2]));
      trunks.setMatrixAt(i, tmpM);
    });
    conifer.forEach(function (sp, i) {
      tmpM.compose(tmpV.set(sp[0], 0, sp[1]), tmpQ.identity(), tmpS.set(sp[2], sp[2], sp[2]));
      leaves.setMatrixAt(i, tmpM);
      leaves2.setMatrixAt(i, tmpM);
      col.setHSL(0.33 + sp[3] * 0.06, 0.38, 0.22 + sp[3] * 0.08);
      leaves.setColorAt(i, col);
      leaves2.setColorAt(i, col.offsetHSL(0, 0, 0.04));
    });
    broad.forEach(function (sp, i) {
      tmpM.compose(tmpV.set(sp[0], 0, sp[1]), tmpQ.setFromEuler(new THREE.Euler(0, sp[3] * 9, 0)), tmpS.set(sp[2], sp[2] * 0.9, sp[2]));
      rounds.setMatrixAt(i, tmpM);
      col.setHSL(0.24 + (sp[3] - 0.62) * 0.3, 0.45, 0.3);
      rounds.setColorAt(i, col);
    });
    [trunks, leaves, leaves2, rounds].forEach(function (m) { m.frustumCulled = false; });
    scene.add(trunks, leaves, leaves2, rounds);
  }

  // ---------------------------------------------------------------- 區域切換（鏡頭平移）
  var curArea = 0, camGoal = null;
  function setArea(a, instant) {
    curArea = Math.max(0, Math.min(D.AREAS.length - 1, a | 0));
    follow = null;
    if (!controls) return;
    var tx = 0, tz = areaZ(curArea) + 1;
    if (instant) {
      var dx = tx - controls.target.x, dz = tz - controls.target.z;
      controls.target.x += dx; controls.target.z += dz;
      camera.position.x += dx; camera.position.z += dz;
      camGoal = null;
      return;
    }
    camGoal = { x: tx, z: tz };
  }
  function updateCam(dt) {
    if (!camGoal) return;
    var dx = camGoal.x - controls.target.x, dz = camGoal.z - controls.target.z;
    var k = Math.abs(dx) + Math.abs(dz) < 0.05 ? 1 : Math.min(1, dt * 3.2);
    controls.target.x += dx * k; controls.target.z += dz * k;
    camera.position.x += dx * k; camera.position.z += dz * k;
    if (k === 1) camGoal = null;
  }

  // ---------------------------------------------------------------- 景觀（2026-11-14：地圖精美化）
  // 天空漸層、遠山、雲跟著鏡頭走（不受霧影響）；草叢、小花、草坪條紋、步道路緣石隨地圖重建。
  var skyDome = null, skyGeo = null, backdrop = null, clouds = [];
  var decoMesh = null, decoVer = -1, decoState = null;

  function paintSky(topHex, horizonHex) {
    if (!skyGeo) return;
    var pos = skyGeo.attributes.position, col = skyGeo.attributes.color, top = new THREE.Color(topHex), hor = new THREE.Color(horizonHex), c = new THREE.Color();
    for (var i = 0; i < pos.count; i++) {
      var h = Math.max(0, pos.getY(i) / 380); // 0 地平線 → 1 天頂
      c.copy(hor).lerp(top, Math.pow(h, 0.55));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  function buildScenery() {
    skyGeo = new THREE.SphereGeometry(380, 32, 16);
    skyGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
    skyDome = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    skyDome.renderOrder = -10;
    skyDome.frustumCulled = false;
    scene.add(skyDome);
    // 遠山（三層，越遠越淡）＋雲：放在 backdrop 群組裡跟著鏡頭平移
    backdrop = new THREE.Group();
    [[300, "#8aa8c8", 70, 46], [250, "#6f9070", 52, 40], [215, "#5a7a58", 34, 34]].forEach(function (layer, li) {
      var n = layer[3], geo = new THREE.ConeGeometry(1, 1, 5);
      geo.translate(0, 0.5, 0);
      var m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: layer[1], fog: false }), n);
      for (var i = 0; i < n; i++) {
        var a = i / n * Math.PI * 2 + li * 0.4, r = layer[0] + Math.sin(i * 7.3) * 12;
        var h = layer[2] * (0.6 + 0.4 * Math.abs(Math.sin(i * 2.17 + li))), w = h * (1.3 + 0.4 * Math.abs(Math.cos(i * 3.1)));
        tmpM.compose(tmpV.set(Math.cos(a) * r, -2, Math.sin(a) * r), tmpQ.setFromEuler(new THREE.Euler(0, i, 0)), tmpS.set(w, h, w));
        m.setMatrixAt(i, tmpM);
      }
      m.frustumCulled = false;
      m.renderOrder = -9;
      backdrop.add(m);
    });
    var cloudMat = new THREE.MeshLambertMaterial({ color: "#ffffff", fog: false, flatShading: true });
    for (var k = 0; k < 14; k++) {
      var cg = new THREE.Group();
      for (var j = 0; j < 4; j++) {
        var puff = mesh(new THREE.IcosahedronGeometry(6 + (j % 2) * 3, 0), cloudMat, (j - 1.5) * 8, (j % 2) * 2.5, Math.sin(j * 2) * 3);
        puff.scale.y = 0.6;
        cg.add(puff);
      }
      var ca = k / 14 * Math.PI * 2;
      cg.position.set(Math.cos(ca) * (150 + (k % 3) * 30), 70 + (k % 4) * 9, Math.sin(ca) * (150 + (k % 3) * 30));
      cg.userData.speed = 0.008 + (k % 5) * 0.002;
      clouds.push(cg);
      backdrop.add(cg);
    }
    scene.add(backdrop);
  }

  function updateScenery(time) {
    if (!skyDome) return;
    skyDome.position.copy(camera.position);
    backdrop.position.set(controls.target.x, 0, controls.target.z);
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i], r = Math.sqrt(c.position.x * c.position.x + c.position.z * c.position.z), a = Math.atan2(c.position.z, c.position.x) + c.userData.speed * 0.016;
      c.position.x = Math.cos(a) * r; c.position.z = Math.sin(a) * r;
    }
  }

  // 每格的固定雜湊（0〜1）：草叢、花、色差不用 Math.random，地圖重建時位置不變
  function hash01(x, y, k) { var n = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return n - Math.floor(n); }
  var GRASS_AREAS = { shrine: 1, land: 1, theme: 1 };
  function syncDecor(s) {
    if (decoMesh && decoVer === s.mapVer && decoState === s) return;
    decoVer = s.mapVer; decoState = s;
    if (decoMesh) { decoMesh.forEach(function (m) { scene.remove(m); m.geometry.dispose(); if (!m.material.userData.shared) m.material.dispose(); m.dispose(); }); }
    var tufts = [], flowers = [], stripes = [], curbs = [], x, y;
    for (y = 0; y < M.WH; y++) for (x = 0; x < M.W; x++) {
      var a = Core.areaOf(y), ar = D.AREAS[a], i = Core.ti(x, y), w = tileToWorld(x, y);
      if (s.tiles[i] === 1) {
        // 路緣石：步道和非步道（同一區）相鄰的邊
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var nx = x + d[0], ny = y + d[1];
          if (Core.inMap(nx, ny) && Core.areaOf(ny) === a && s.tiles[Core.ti(nx, ny)] === 1) return;
          curbs.push([w.x + d[0] * (T / 2 - 0.05), w.z + d[1] * (T / 2 - 0.05), d[0] !== 0]);
        });
        continue;
      }
      if (GRASS_AREAS[ar.id] && (ar.id !== "shrine" || x < ar.unlockX)) {
        if ((ar.id === "land" || ar.id === "theme") && x % 2 === 0) stripes.push(w); // 草坪修剪條紋
        if (s.occ[i] || Core.isWater(x, y)) continue;
        var n = Math.floor(hash01(x, y, 1) * 3);
        for (var k = 0; k < n; k++) tufts.push([w.x + (hash01(x, y, k + 2) - 0.5) * 1.6, w.z + (hash01(x, y, k + 7) - 0.5) * 1.6, 0.6 + hash01(x, y, k + 11) * 0.7]);
        if (hash01(x, y, 19) < 0.09) flowers.push([w.x + (hash01(x, y, 23) - 0.5) * 1.2, w.z + (hash01(x, y, 29) - 0.5) * 1.2, hash01(x, y, 31)]);
      } else if (ar.id === "water" && !s.occ[i] && !Core.isWater(x, y) && hash01(x, y, 37) < 0.05) {
        flowers.push([w.x, w.z, -1]); // 沙灘上的貝殼
      }
    }
    var list = [], col = new THREE.Color();
    var tg = new THREE.ConeGeometry(0.12, 0.42, 4); tg.translate(0, 0.21, 0);
    var tm = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({ color: "#ffffff" }), Math.max(1, tufts.length * 3));
    var ti = 0;
    tufts.forEach(function (t) {
      for (var b = 0; b < 3; b++) {
        tmpQ.setFromEuler(new THREE.Euler((b - 1) * 0.35, b * 2.1, (b - 1) * 0.25));
        tmpM.compose(tmpV.set(t[0] + (b - 1) * 0.08, 0, t[1] + (b % 2) * 0.06), tmpQ, tmpS.set(t[2], t[2], t[2]));
        tm.setMatrixAt(ti, tmpM);
        tm.setColorAt(ti++, col.setHSL(0.27 + t[2] * 0.04, 0.5, 0.28 + b * 0.04));
      }
    });
    tm.count = ti;
    list.push(tm);
    var fg = new THREE.SphereGeometry(0.11, 6, 5); fg.translate(0, 0.16, 0);
    var fm = new THREE.InstancedMesh(fg, new THREE.MeshLambertMaterial({ color: "#ffffff" }), Math.max(1, flowers.length * 3));
    var fi = 0, FCOL = ["#ff8ab0", "#ffe060", "#ffffff", "#b890ff", "#ff7050"];
    flowers.forEach(function (f) {
      var shell = f[2] < 0;
      for (var b = 0; b < (shell ? 1 : 3); b++) {
        tmpM.compose(tmpV.set(f[0] + (b - 1) * 0.2, shell ? -0.1 : 0, f[1] + (b % 2) * 0.18), tmpQ.identity(), tmpS.set(1, shell ? 0.5 : 1, 1));
        fm.setMatrixAt(fi, tmpM);
        fm.setColorAt(fi++, col.set(shell ? "#f4e4d4" : FCOL[Math.floor(f[2] * FCOL.length) % FCOL.length]));
      }
    });
    fm.count = fi;
    list.push(fm);
    var sm = new THREE.InstancedMesh(new THREE.PlaneGeometry(T, T), new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.09, depthWrite: false }), Math.max(1, stripes.length));
    stripes.forEach(function (w, i) { tmpQ.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); tmpM.compose(tmpV.set(w.x, 0.006, w.z), tmpQ, tmpS.set(1, 1, 1)); sm.setMatrixAt(i, tmpM); });
    sm.count = stripes.length;
    list.push(sm);
    var cm = new THREE.InstancedMesh(new THREE.BoxGeometry(T, 0.09, 0.1), lam("#8c8a84"), Math.max(1, curbs.length));
    curbs.forEach(function (c, i) { tmpQ.setFromEuler(new THREE.Euler(0, c[2] ? Math.PI / 2 : 0, 0)); tmpM.compose(tmpV.set(c[0], 0.045, c[1]), tmpQ, tmpS.set(1, 1, 1)); cm.setMatrixAt(i, tmpM); });
    cm.count = curbs.length;
    list.push(cm);
    list.forEach(function (m) {
      m.frustumCulled = false;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      scene.add(m);
    });
    decoMesh = list;
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
    // 2026-11-14 精細化：注連繩＋紙垂、屋頂的千木與鰹木
    var rope = mesh(new THREE.TorusGeometry(1.15, 0.09, 8, 24, Math.PI), lam("#d8c08a"), 0, 2.75, 0.5);
    rope.rotation.z = Math.PI;
    hall.add(rope);
    for (var sh = 0; sh < 4; sh++) {
      var ax = -0.75 + sh * 0.5;
      hall.add(box(0.12, 0.34, 0.01, "#ffffff", ax, 2.05 - Math.abs(ax) * 0.25, 0.52));
    }
    [-1, 1].forEach(function (sx) {
      var chigi = box(0.1, 1.2, 0.1, "#5a3a26", sx * 0.25, 5.15, -1.2);
      chigi.rotation.z = sx * 0.5;
      hall.add(chigi);
    });
    for (var kg = 0; kg < 3; kg++) { var ko = cyl(0.08, 0.08, 0.7, "#5a3a26", 0, 4.85, -1.9 + kg * 0.7, 8); ko.rotation.z = Math.PI / 2; hall.add(ko); }
    hall.position.x = 1; // 正對參道（參道在本殿中心往南 1 m）
    inner.add(hall);
    var tr = torii(0.8);
    tr.position.set(1, 0, 4.9);
    inner.add(tr);
    // 狛犬（石台＋身體＋頭）
    [-1, 1].forEach(function (sx) {
      var k = new THREE.Group();
      k.add(box(0.6, 0.5, 0.6, "#8c8a84", 0, 0.25, 0));
      k.add(box(0.36, 0.42, 0.5, "#a8a49a", 0, 0.7, 0));
      k.add(mesh(new THREE.SphereGeometry(0.22, 10, 8), lam("#a8a49a"), 0, 1.05, 0.15));
      k.add(mesh(new THREE.SphereGeometry(0.25, 8, 6), lam("#9a968c"), 0, 1.0, 0.0));
      k.position.set(1 + sx * 1.7, 0.5, 2.6);
      inner.add(k);
    });
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
    // 2026-11-14 精細化：垂邊（波浪裝飾）、頂飾、中柱鏡板
    var skirt = new THREE.Mesh(new THREE.CylinderGeometry(3.62, 3.62, 0.38, 32, 1, true), new THREE.MeshLambertMaterial({ color: "#d4a531", side: THREE.DoubleSide }));
    skirt.position.y = 2.98;
    rot.add(skirt);
    var scal = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), lam("#c8282e"), 36);
    for (var sc = 0; sc < 36; sc++) { var sa = sc / 36 * Math.PI * 2; tmpM.makeTranslation(Math.cos(sa) * 3.62, 2.78, Math.sin(sa) * 3.62); scal.setMatrixAt(sc, tmpM); }
    rot.add(scal);
    rot.add(mesh(new THREE.SphereGeometry(0.28, 12, 10), mods.deco ? glow("#ffe080", 1.2) : lam("#d4a531"), 0, 4.45, 0));
    rot.add(mesh(new THREE.ConeGeometry(0.12, 0.5, 10), lam("#d4a531"), 0, 4.9, 0));
    for (var mr = 0; mr < 8; mr++) {
      var mp = mesh(new THREE.PlaneGeometry(0.34, 1.6), glow("#e8f0ff", 1.05), 0, 1.6, 0);
      var ma = mr / 8 * Math.PI * 2;
      mp.position.set(Math.cos(ma) * 0.52, 1.6, Math.sin(ma) * 0.52);
      mp.rotation.y = -ma + Math.PI / 2;
      rot.add(mp);
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
    var spout = cyl(0.06, 0.12, 0.6, "#3f6a3a", 0.62, 0.65, 0, 8); spout.rotation.z = -0.9; disk.add(spout);
    var handle = mesh(new THREE.TorusGeometry(0.28, 0.05, 6, 14, Math.PI), lam("#3f6a3a"), -0.55, 0.6, 0); handle.rotation.z = Math.PI / 2; disk.add(handle);
    disk.add(mesh(new THREE.ConeGeometry(0.25, 0.3, 10), lam("#d4a531"), 0, 1.1, 0));
    var prof = [[0, 0], [0.42, 0.02], [0.58, 0.14], [0.67, 0.38], [0.7, 0.62], [0.64, 0.62], [0.6, 0.4], [0.5, 0.2], [0, 0.18]];
    var cupGeo = new THREE.LatheGeometry(prof.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), 20);
    var cupColors = ["#7aa65a", "#d2584a", "#e8b84a", "#5a8ad2", "#c870b0", "#f0ebe0"];
    var cups = [];
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * Math.PI * 2;
      var cup = new THREE.Group();
      cup.position.set(Math.cos(a) * 1.7, 0.12, Math.sin(a) * 1.7);
      cup.add(new THREE.Mesh(cupGeo, new THREE.MeshLambertMaterial({ color: cupColors[i], side: THREE.DoubleSide })));
      cup.add(cyl(0.12, 0.12, 0.4, "#fbf4e6", 0, 0.38, 0, 8));
      cup.add(mesh(new THREE.TorusGeometry(0.68, 0.025, 6, 24), lam("#d4a531"), 0, 0.62, 0));
      cup.children[2].rotation.x = Math.PI / 2;
      cup.add(cyl(0.82, 0.86, 0.06, "#fbf4e6", 0, -0.02, 0, 20)); // 杯盤
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
    // 乘車月台＋售票亭
    g.add(box(3.0, 0.5, 1.4, "#b8b0a0", 0, 0.25, 1.6));
    for (var stp = 0; stp < 3; stp++) g.add(box(1.2, 0.16, 0.3, "#a8a090", 0, 0.08 + stp * 0.16, 2.6 - stp * 0.3));
    g.add(box(0.9, 1.3, 0.8, "#c8282e", 2.4, 0.65, 2.0));
    var tkr = box(1.1, 0.1, 1.0, "#3c4a52", 2.4, 1.36, 2.0); tkr.rotation.x = 0.1; g.add(tkr);
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
      var cr = mesh(new THREE.ConeGeometry(0.78, 0.3, 4), lam(cabColors[i % 4]), 0, -0.24, 0); cr.rotation.y = Math.PI / 4; cab.add(cr);
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

  // 攤位（2026-11-14 精細化）：切妻屋根、暖簾、屋簷兩端的提燈、檯面上依種類擺商品
  var STALL_GOODS = {
    takoyakiSt: function (g) { for (var i = 0; i < 2; i++) { g.add(box(0.7, 0.05, 0.45, "#3a2a22", -0.5 + i * 1.0, 1.04, 0.4)); for (var k = 0; k < 6; k++) g.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), lam("#b8783a"), -0.7 + i * 1.0 + (k % 3) * 0.2, 1.1, 0.3 + Math.floor(k / 3) * 0.2)); } },
    ameSt: function (g) { for (var k = 0; k < 7; k++) { g.add(cyl(0.01, 0.01, 0.35, "#e8d8b0", -0.9 + k * 0.3, 1.18, 0.45, 4)); g.add(mesh(new THREE.SphereGeometry(k % 2 ? 0.1 : 0.13, 10, 8), lam(k % 2 ? "#ffffff" : "#d0202a"), -0.9 + k * 0.3, 1.38, 0.45)); } },
    ramuneSt: function (g) { g.add(cyl(0.45, 0.4, 0.25, "#3a7ab8", 0, 1.12, 0.4, 14)); for (var k = 0; k < 8; k++) g.add(cyl(0.04, 0.045, 0.32, "#bfe6ff", Math.cos(k) * 0.25, 1.32, 0.4 + Math.sin(k) * 0.18, 6)); },
    juyo: function (g) { for (var k = 0; k < 5; k++) g.add(box(0.22, 0.16, 0.03, "#e8cfa0", -0.8 + k * 0.4, 1.12, 0.6)); for (var k2 = 0; k2 < 4; k2++) g.add(box(0.1, 0.16, 0.04, ["#c8282e", "#2f6fb5", "#3a9a5a", "#e0a020"][k2], -0.6 + k2 * 0.4, 1.1, 0.35)); },
    shateki: function (g) { for (var k = 0; k < 6; k++) g.add(box(0.18, 0.22, 0.12, ["#e0a020", "#c870b0", "#5ab0e0"][k % 3], -1.0 + k * 0.4, 1.55, -0.85)); g.add(box(1.4, 0.05, 0.25, "#6a4428", 0, 1.45, -0.85)); },
    wanage: function (g) { for (var k = 0; k < 6; k++) g.add(cyl(0.03, 0.03, 0.4, "#e8d8b0", -0.9 + (k % 3) * 0.9, 1.2, -0.2 + Math.floor(k / 3) * 0.5, 5)); },
    omikuji: function (g) { g.add(box(0.35, 0.5, 0.35, "#e8d8b0", 0, 1.25, 0.4)); g.add(cyl(0.02, 0.02, 0.2, "#c8282e", 0, 1.6, 0.4, 4)); },
    kingyo: function (g) { for (var k = 0; k < 7; k++) g.add(mesh(new THREE.SphereGeometry(0.05, 6, 5), lam(k % 3 ? "#ff6a2a" : "#1d1a1c"), -0.8 + k * 0.27, 1.06, 0.2 + (k % 2) * 0.2)); },
  };
  function buildStall(st) {
    var g = new THREE.Group(), color = STALL_COLORS[st.type] || "#d23a3a";
    g.add(pad(3.6, 3.4));
    g.add(box(2.8, 0.95, 1.2, "#7a5236", 0, 0.48, 0.3));
    g.add(box(2.95, 0.06, 1.3, "#b8885a", 0, 0.98, 0.3)); // 檯面板
    g.add(box(2.8, 1.9, 0.15, "#6a4428", 0, 0.95, -1.0));
    [-1.4, 1.4].forEach(function (x) { g.add(box(0.07, 1.1, 1.9, "#7a5236", x, 0.55, -0.1)); });
    [[-1.35, 0.85], [1.35, 0.85], [-1.35, -1.0], [1.35, -1.0]].forEach(function (p) { g.add(box(0.09, 2.25, 0.09, "#5a3a26", p[0], 1.12, p[1])); });
    [-1, 1].forEach(function (sd) { var r = box(3.3, 0.08, 1.35, color, 0, 2.5, -0.08 + sd * 0.6); r.rotation.x = sd * 0.42; g.add(r); });
    g.add(box(3.35, 0.1, 0.12, "#3a2a22", 0, 2.77, -0.08)); // 棟木
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.45), signMaterial(D.BUILD[st.type].name.ja, color));
    sign.position.set(0, 2.05, 0.95);
    g.add(sign);
    for (var n = 0; n < 5; n++) g.add(box(0.5, 0.36, 0.02, n % 2 ? "#f4efe4" : color, -1.08 + n * 0.54, 1.62, 0.93)); // 暖簾
    g.add(chochin("#ff5a3a", -1.5, 2.0, 0.95, 0.9), chochin("#ff5a3a", 1.5, 2.0, 0.95, 0.9));
    if (STALL_GOODS[st.type]) STALL_GOODS[st.type](g);
    if (st.type === "kingyo") g.add(mesh(new THREE.BoxGeometry(2.2, 0.18, 0.9), new THREE.MeshLambertMaterial({ color: "#5ab0ff", transparent: true, opacity: 0.6 }), 0, 1.0, 0.3));
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
      var me = footCenter(st.type, st.x, st.y, st.rot), to = footCenter(ride.type, ride.x, ride.y, ride.rot);
      body.rotation.y = Math.atan2(to.x - me.x, to.z - me.z) - ROT_Y[st.rot || 0]; // 扣掉群組本身的轉向
    }
    return g;
  }

  function buildSmall(st) {
    var g = new THREE.Group(), t = st.type;
    if (t === "bench") {
      g.add(box(1.4, 0.08, 0.45, "#a0704a", 0, 0.45, 0));
      g.add(box(1.4, 0.35, 0.06, "#a0704a", 0, 0.68, -0.2));
      [-0.6, 0.6].forEach(function (x) { g.add(box(0.08, 0.45, 0.4, "#5a3a26", x, 0.22, 0)); g.add(box(0.08, 0.06, 0.42, "#5a3a26", x * 1.12, 0.62, 0)); });
      for (var sl = 0; sl < 3; sl++) g.add(box(1.4, 0.02, 0.1, "#8a5a3a", 0, 0.5, -0.15 + sl * 0.15));
    } else if (t === "toilet") {
      g.add(pad(3.4, 3.4));
      g.add(box(2.8, 2.2, 2.4, "#f0ece4", 0, 1.1, -0.3));
      var r = mesh(new THREE.ConeGeometry(2.3, 0.8, 4), lam("#3c4a52"), 0, 2.6, -0.3);
      r.rotation.y = Math.PI / 4;
      g.add(r);
      g.add(box(0.6, 1.4, 0.05, "#2f6fb5", -0.6, 0.7, 0.92));
      g.add(box(0.6, 1.4, 0.05, "#d23a3a", 0.6, 0.7, 0.92));
      g.add(box(3.2, 0.08, 0.5, "#3c4a52", 0, 2.25, 1.05)); // 雨庇
      [-0.6, 0.6].forEach(function (x, k) { g.add(mesh(new THREE.CircleGeometry(0.16, 16), glow(k ? "#ff8a8a" : "#8ab8ff", 1.3), x, 1.75, 0.96)); });
      g.add(box(0.4, 0.5, 0.3, "#d8d4cc", 1.6, 0.25, 0.8)); // 洗手台
    } else if (t === "trash") {
      g.add(cyl(0.26, 0.22, 0.7, "#6a8a3a", 0, 0.35, 0, 10));
      g.add(cyl(0.28, 0.28, 0.05, "#3a4a2a", 0, 0.72, 0, 10));
      g.add(cyl(0.14, 0.14, 0.04, "#1d1a1c", 0, 0.75, 0, 10)); // 投入口
    } else if (t === "shelter") {
      [[-1.5, -1.3], [1.5, -1.3], [-1.5, 1.3], [1.5, 1.3]].forEach(function (p) { g.add(cyl(0.07, 0.08, 2.4, "#b8b060", p[0], 1.2, p[1], 6)); });
      var roof = box(3.6, 0.06, 3.2, "#f4efe4", 0, 2.45, 0);
      roof.rotation.x = 0.08;
      g.add(roof);
      g.add(box(3.6, 0.3, 0.04, "#2f4f8f", 0, 2.3, 1.6));
      g.add(box(2.4, 0.08, 0.4, "#a0704a", 0, 0.45, -1.0));
    } else if (t === "lanternPost") {
      g.add(cyl(0.05, 0.06, 2.2, "#3a2a22", 0, 1.1, 0, 6));
      g.add(box(0.36, 0.16, 0.36, "#8c8a84", 0, 0.08, 0)); // 石座
      g.add(box(0.5, 0.04, 0.06, "#3a2a22", 0, 2.2, 0)); // 橫木
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
      for (var lf = 0; lf < 10; lf++) g.add(box(0.16, 0.14, 0.06, "#4a8a3a", -0.62 + (lf % 5) * 0.3, 0.24, -0.6 + Math.floor(lf / 5) * 1.2));
      [[0, 0.78], [0, -0.78], [0.78, 0], [-0.78, 0]].forEach(function (p) { g.add(box(p[0] ? 0.06 : 1.6, 0.26, p[0] ? 1.6 : 0.06, "#8c8a84", p[0], 0.13, p[1])); }); // 石緣
      var cols = ["#ff7aa0", "#ffd040", "#ffffff", "#c070ff", "#ff5050"];
      for (var i = 0; i < 12; i++) {
        g.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), lam(cols[i % cols.length]), -0.55 + (i % 4) * 0.37, 0.28, -0.5 + Math.floor(i / 4) * 0.5));
      }
    }
    return g;
  }

  // ---------------------------------------------------------------- 各區專屬設施（2026-11-14）
  // 都以「入口朝 +z（地圖下方）」組好；本體尺寸不超過 w×T、h×T。
  function tube(points, r, hex, closed, seg) {
    var curve = new THREE.CatmullRomCurve3(points, !!closed, "catmullrom", 0.5);
    return mesh(new THREE.TubeGeometry(curve, seg || 64, r, 6, !!closed), typeof hex === "string" ? lam(hex) : hex);
  }
  function chochin(hex, x, y, z, s) {
    var g = new THREE.Group();
    g.add(mesh(new THREE.SphereGeometry(0.2, 12, 10), glow(hex || "#ff6a3a", 1.9), 0, 0, 0));
    g.children[0].scale.set(1, 1.25, 1);
    g.add(cyl(0.12, 0.12, 0.05, "#1d1a1c", 0, 0.25, 0, 10), cyl(0.12, 0.12, 0.05, "#1d1a1c", 0, -0.25, 0, 10));
    g.position.set(x, y, z);
    if (s) g.scale.setScalar(s);
    return g;
  }
  function bulbRing(n, r, y, hex, k, size) {
    var m = new THREE.InstancedMesh(new THREE.SphereGeometry(size || 0.07, 8, 6), glow(hex, k), n);
    for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2; tmpM.makeTranslation(Math.cos(a) * r, y, Math.sin(a) * r); m.setMatrixAt(i, tmpM); }
    return m;
  }

  // 人力車碰碰車：圍欄場地＋天幕＋6 台人力車造型的碰碰車（導電桿頂端會閃火花）
  function buildBumper(st) {
    var g = new THREE.Group(), mods = st.mods || {}, W = 7.4;
    g.add(box(W, 0.18, W, "#4a4a58", 0, 0.09, 0));
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) if ((i + j) % 2) g.add(box(W / 4 - 0.05, 0.02, W / 4 - 0.05, "#5a5a6a", -W / 2 + W / 8 + i * W / 4, 0.19, -W / 2 + W / 8 + j * W / 4));
    [[0, W / 2, W, 0], [0, -W / 2, W, 0], [W / 2, 0, W, 1], [-W / 2, 0, W, 1]].forEach(function (f, k) {
      var gap = k === 0; // 入口側留出口
      if (gap) {
        [-1, 1].forEach(function (sd) { g.add(box(W / 2 - 0.8, 0.45, 0.22, "#e0a020", sd * (W / 4 + 0.4), 0.4, f[1])); });
      } else g.add(box(f[3] ? 0.22 : f[2], 0.45, f[3] ? f[2] : 0.22, "#e0a020", f[0], 0.4, f[1]));
    });
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) { g.add(cyl(0.12, 0.14, 3.4, "#c8282e", p[0] * (W / 2 - 0.1), 1.7, p[1] * (W / 2 - 0.1), 10)); });
    [[0, W / 2, W + 0.4, 0], [0, -W / 2, W + 0.4, 0], [W / 2, 0, W + 0.4, 1], [-W / 2, 0, W + 0.4, 1]].forEach(function (f) {
      g.add(box(f[3] ? 0.3 : f[2], 0.5, f[3] ? f[2] : 0.3, "#c8282e", f[0], 3.45, f[1])); // 屋頂外框（中間挑空，從上面看得到車）
    });
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (d) { var bm = box(0.12, 0.12, W * 0.72, "#c8282e", d[0] * W / 4, 3.7, d[1] * W / 4); bm.rotation.y = d[0] * d[1] > 0 ? Math.PI / 4 : -Math.PI / 4; bm.rotation.x = 0; g.add(bm); });
    for (var w = 0; w < 8; w++) g.add(mesh(new THREE.ConeGeometry(1.3, 1.3, 4, 1, false, w * Math.PI / 4 + Math.PI / 4, Math.PI / 4), lam(w % 2 ? "#f4efe4" : "#2f6fb5"), 0, 4.55, 0));
    g.add(mesh(new THREE.SphereGeometry(0.18, 10, 8), lam("#d4a531"), 0, 5.3, 0));
    for (var n = -3; n <= 3; n++) { g.add(box(W, 0.03, 0.03, "#8a8a9a", 0, 3.3, n)); g.add(box(0.03, 0.03, W, "#8a8a9a", n, 3.3, 0)); }
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.6), signMaterial("バンパーカー", "#2f6fb5"));
    sign.position.set(0, 3.0, W / 2 + 0.25);
    g.add(sign);
    if (mods.light) { var lb = bulbRing(32, W / 2 + 0.2, 3.38, "#ffd070", 2.6, 0.08); lb.scale.set(1, 1, 1); g.add(lb); }
    var colors = ["#d23a3a", "#2f6fb5", "#e0a020", "#3a9a5a", "#c870b0", "#f4efe4"], cars = [], sparks = [];
    for (var c = 0; c < 6; c++) {
      var car = new THREE.Group();
      car.add(cyl(0.62, 0.66, 0.22, "#1d1a1c", 0, 0.3, 0, 16)); // 防撞圈
      car.add(box(0.8, 0.35, 1.0, colors[c], 0, 0.55, 0.05));
      car.add(box(0.8, 0.55, 0.12, colors[c], 0, 0.85, -0.42)); // 椅背
      car.add(box(0.6, 0.1, 0.4, "#2b2230", 0, 0.76, 0.05));
      var hood = box(0.84, 0.06, 0.6, "#2b2230", 0, 1.25, -0.25); hood.rotation.x = -0.4; car.add(hood); // 人力車的車篷
      [-0.48, 0.48].forEach(function (x) { var wh = mesh(new THREE.TorusGeometry(0.36, 0.04, 6, 16), lam("#3a2a22"), x, 0.45, -0.1); wh.rotation.y = Math.PI / 2; car.add(wh); });
      car.add(cyl(0.02, 0.02, 2.1, "#c8c8d8", 0, 2.2, -0.45, 4));
      var sp = mesh(new THREE.SphereGeometry(0.08, 6, 5), glow("#a0d8ff", 3), 0, 3.25, -0.45);
      car.add(sp); sparks.push(sp);
      g.add(car); cars.push(car);
    }
    var t0 = 0;
    function place() {
      for (var k = 0; k < cars.length; k++) {
        var x = Math.sin(t0 * 0.9 + k * 1.7) * 2.5, z = Math.sin(t0 * 1.3 + k * 2.3) * 2.5;
        var dx = Math.cos(t0 * 0.9 + k * 1.7) * 0.9, dz = Math.cos(t0 * 1.3 + k * 2.3) * 1.3;
        cars[k].position.set(x, 0, z);
        cars[k].rotation.y = Math.atan2(dx, dz);
      }
    }
    place();
    g.userData.update = function (step, time, spd) {
      t0 += step * 0.8;
      place();
      for (var k = 0; k < sparks.length; k++) sparks[k].visible = spd > 0.3 && Math.sin(time * 23 + k * 3) > 0.6;
    };
    return g;
  }

  // 狐狸小火車：橢圓軌道＋月台＋狐狸頭火車頭與 3 節車廂
  function buildFoxTrain(st) {
    var g = new THREE.Group(), mods = st.mods || {}, A = 5.0, B = 2.8, pts = [], i;
    g.add(box(11.6, 0.06, 7.6, "#9ab070", 0, 0.03, 0));
    for (i = 0; i < 24; i++) { var an = i / 24 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(an) * A, 0.18, Math.sin(an) * B - 0.3)); }
    var curve = new THREE.CatmullRomCurve3(pts, true);
    [-0.32, 0.32].forEach(function (off) {
      var rp = curve.getSpacedPoints(96).slice(0, 96).map(function (p, k, arr) {
        var nx = arr[(k + 1) % arr.length], tx = nx.x - p.x, tz = nx.z - p.z, l = Math.sqrt(tx * tx + tz * tz) || 1;
        return new THREE.Vector3(p.x - tz / l * off, 0.2, p.z + tx / l * off);
      });
      g.add(tube(rp, 0.05, "#9a9aa8", true, 160));
    });
    var sl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.95, 0.08, 0.22), lam("#6a4a32"), 60);
    for (i = 0; i < 60; i++) {
      var u = i / 60, p = curve.getPointAt(u), tg = curve.getTangentAt(u);
      tmpQ.setFromEuler(new THREE.Euler(0, Math.atan2(tg.x, tg.z) + Math.PI / 2, 0));
      tmpM.compose(tmpV.set(p.x, 0.1, p.z), tmpQ, tmpS.set(1, 1, 1));
      sl.setMatrixAt(i, tmpM);
    }
    g.add(sl);
    // 中央的小山與狐狸神社
    var hill = mesh(new THREE.SphereGeometry(2.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), lam("#6a9a4e"), 0, 0, -0.3);
    hill.scale.set(1.6, 0.6, 0.9);
    g.add(hill);
    var tr = torii(0.32); tr.position.set(0, 1.25, 0.2); g.add(tr);
    g.add(box(0.5, 0.45, 0.4, "#c8282e", 0, 1.5, -0.4));
    // 月台（入口側）
    g.add(box(4.0, 0.35, 0.9, "#b8b0a0", 0, 0.18, 3.35));
    [-1.8, 1.8].forEach(function (x) { g.add(cyl(0.06, 0.06, 2.0, "#c8282e", x, 1.2, 3.55, 8)); });
    var roof = box(4.4, 0.1, 1.2, "#c8282e", 0, 2.25, 3.4); roof.rotation.x = 0.12; g.add(roof);
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.45), signMaterial("きつね列車", "#e07a2a"));
    sign.position.set(0, 1.95, 3.86); g.add(sign);
    if (mods.light) for (i = 0; i < 5; i++) g.add(chochin("#ff8a3a", -1.6 + i * 0.8, 2.0, 3.95, 0.8));
    // 列車
    var cars = [];
    var loco = new THREE.Group();
    loco.add(box(0.8, 0.5, 1.2, "#e07a2a", 0, 0.55, 0));
    var boiler = cyl(0.32, 0.32, 0.9, "#2b2230", 0, 0.95, 0.15, 12); boiler.rotation.x = Math.PI / 2; loco.add(boiler);
    loco.add(cyl(0.09, 0.12, 0.4, "#2b2230", 0, 1.4, 0.45, 8));
    loco.add(box(0.8, 0.55, 0.5, "#c8282e", 0, 1.05, -0.4));
    var face = mesh(new THREE.SphereGeometry(0.34, 12, 10), lam("#f4efe4"), 0, 0.95, 0.68); face.scale.set(1, 0.9, 0.8); loco.add(face);
    loco.add(mesh(new THREE.ConeGeometry(0.14, 0.32, 8), lam("#f4efe4"), 0, 0.88, 0.98));
    loco.children[loco.children.length - 1].rotation.x = Math.PI / 2;
    [-0.2, 0.2].forEach(function (x) {
      loco.add(mesh(new THREE.ConeGeometry(0.11, 0.3, 6), lam("#e07a2a"), x, 1.3, 0.62));
      loco.add(mesh(new THREE.SphereGeometry(0.04, 6, 5), lam("#1d1a1c"), x * 0.6, 1.02, 0.94));
    });
    cars.push(loco);
    for (i = 0; i < 3; i++) {
      var cg = new THREE.Group();
      cg.add(box(0.75, 0.35, 1.1, ["#c8282e", "#f4efe4", "#c8282e"][i], 0, 0.5, 0));
      cg.add(box(0.6, 0.12, 0.35, "#6a4a32", 0, 0.72, 0.2), box(0.6, 0.12, 0.35, "#6a4a32", 0, 0.72, -0.25));
      [-0.3, 0.3].forEach(function (x) { cg.add(cyl(0.03, 0.03, 0.7, "#d4a531", x, 1.0, 0.45, 4), cyl(0.03, 0.03, 0.7, "#d4a531", x, 1.0, -0.45, 4)); });
      var cr = box(0.85, 0.06, 1.15, "#e07a2a", 0, 1.36, 0); cg.add(cr);
      cars.push(cg);
    }
    cars.forEach(function (c) { g.add(c); });
    var u0 = 0.25;
    function place() {
      for (var k = 0; k < cars.length; k++) {
        var uu = ((u0 - k * 0.042) % 1 + 1) % 1, p = curve.getPointAt(uu), t = curve.getTangentAt(uu);
        cars[k].position.set(p.x, 0.05, p.z);
        cars[k].rotation.y = Math.atan2(t.x, t.z);
      }
    }
    place();
    g.userData.update = function (step) { u0 = (u0 + step * 0.06) % 1; place(); };
    return g;
  }

  // 工廠見學館：紅磚廠房、鋸齒屋頂、正面的大齒輪、煙囪冒煙
  function buildTour(st) {
    var g = new THREE.Group();
    g.add(pad(7.6, 5.6, "#8a8a84"));
    g.add(box(7.0, 3.0, 4.2, "#a0523c", 0, 1.6, -0.5));
    for (var i = 0; i < 3; i++) {
      var r1 = box(2.4, 0.1, 4.3, "#5a6068", -2.3 + i * 2.33, 3.55, -0.5); r1.rotation.z = 0.45; g.add(r1);
      g.add(mesh(new THREE.PlaneGeometry(4.1, 0.9), glow("#bfe6ff", 1.15), -2.95 + i * 2.33, 3.55, -0.5));
      g.children[g.children.length - 1].rotation.y = Math.PI / 2;
    }
    for (var w = 0; w < 4; w++) g.add(mesh(new THREE.PlaneGeometry(1.0, 0.9), glow("#ffe6a0", 1.3), -2.6 + w * 1.4 + (w > 1 ? 0.8 : 0), 1.9, 1.61));
    g.add(box(1.4, 1.8, 0.1, "#3c4a52", 0, 0.9, 1.62)); // 入口
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5), signMaterial("工場見学", "#3c4a52"));
    sign.position.set(0, 2.2, 1.66); g.add(sign);
    var gear = new THREE.Group();
    gear.add(cyl(0.7, 0.7, 0.15, "#d4a531", 0, 0, 0, 20));
    for (var tth = 0; tth < 12; tth++) { var tb = box(0.22, 0.18, 0.15, "#d4a531", 0, 0, 0); tb.position.set(Math.cos(tth / 12 * 6.283) * 0.8, Math.sin(tth / 12 * 6.283) * 0.8, 0); tb.rotation.z = tth / 12 * 6.283; gear.add(tb); }
    gear.children[0].rotation.x = Math.PI / 2;
    gear.position.set(2.6, 2.6, 1.7); g.add(gear);
    g.add(cyl(0.3, 0.4, 5.2, "#7a5040", -3.0, 2.6, -2.0, 12));
    g.add(cyl(0.34, 0.34, 0.3, "#e8e0d0", -3.0, 4.6, -2.0, 12));
    var puffs = [];
    for (var k = 0; k < 4; k++) {
      var pf = mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshLambertMaterial({ color: "#eeeef2", transparent: true, opacity: 0.6, depthWrite: false }), -3.0, 5.3, -2.0);
      g.add(pf); puffs.push(pf);
    }
    g.userData.always = function (time) {
      for (var q = 0; q < puffs.length; q++) {
        var u = (time * 0.25 + q / puffs.length) % 1;
        puffs[q].position.set(-3.0 - u * 1.2, 5.3 + u * 2.5, -2.0);
        puffs[q].scale.setScalar(0.6 + u * 1.6);
        puffs[q].material.opacity = 0.55 * (1 - u);
      }
    };
    g.userData.update = function (step) { gear.rotation.z -= step * 1.2; };
    return g;
  }

  // 倉庫棟：波浪鐵皮、山形屋頂、捲門、棧板與木箱
  function buildWarehouse(st) {
    var g = new THREE.Group();
    g.add(pad(5.6, 5.6, "#7a7a76"));
    g.add(box(5.0, 2.8, 4.4, "#8a9aaa", 0, 1.4, -0.3));
    for (var i = 0; i < 18; i++) g.add(box(0.06, 2.8, 0.04, "#6f7f8f", -2.45 + i * 0.29, 1.4, 1.93));
    [-1, 1].forEach(function (sd) { var r = box(5.3, 0.1, 2.5, "#5a6068", 0, 3.25, -0.3 + sd * 1.1); r.rotation.x = -sd * 0.32; g.add(r); });
    g.add(box(2.4, 2.1, 0.08, "#e0b030", 0, 1.05, 1.96));
    for (var l = 0; l < 7; l++) g.add(box(2.4, 0.03, 0.02, "#a08020", 0, 0.2 + l * 0.29, 2.01));
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), signMaterial("倉庫", "#2b2230"));
    sign.position.set(0, 2.45, 1.98); g.add(sign);
    [[-2.0, 2.4], [2.0, 2.4]].forEach(function (p, k) {
      g.add(box(1.0, 0.14, 0.9, "#a0704a", p[0], 0.07, p[1]));
      g.add(box(0.8, 0.6, 0.7, k ? "#c89a5a" : "#b8884a", p[0], 0.45, p[1]));
      if (!k) g.add(box(0.6, 0.45, 0.55, "#c89a5a", p[0], 0.98, p[1]));
    });
    return g;
  }

  // 機器棚：開放式棚架＋車床（主軸轉動）＋工作台＋懸臂吊車
  function buildShed(st) {
    var g = new THREE.Group();
    g.add(pad(5.6, 5.6, "#8a8a84"));
    [[-2.5, -2.3], [2.5, -2.3], [-2.5, 2.3], [2.5, 2.3]].forEach(function (p) { g.add(box(0.14, 3.0, 0.14, "#5a6068", p[0], 1.5, p[1])); });
    var roof = box(5.6, 0.08, 5.2, "#3f6a8a", 0, 3.1, 0); roof.rotation.x = 0.1; g.add(roof);
    var lathe = new THREE.Group();
    lathe.add(box(2.0, 0.8, 0.6, "#3a7a5a", 0, 0.5, 0), box(2.2, 0.12, 0.7, "#2b2230", 0, 0.96, 0));
    var chuck = cyl(0.22, 0.22, 0.3, "#c8c8d8", -0.7, 1.25, 0, 10); chuck.rotation.z = Math.PI / 2; lathe.add(chuck);
    lathe.add(box(0.3, 0.4, 0.3, "#3a7a5a", 0.7, 1.2, 0));
    lathe.position.set(-1.0, 0, -1.2); g.add(lathe);
    g.add(box(1.6, 0.9, 0.7, "#a0704a", 1.4, 0.45, -1.4), box(1.6, 0.06, 0.75, "#6a4428", 1.4, 0.92, -1.4));
    g.add(box(0.3, 0.2, 0.3, "#c8282e", 1.0, 1.05, -1.4), box(0.15, 0.3, 0.15, "#2f6fb5", 1.7, 1.1, -1.3));
    g.add(cyl(0.1, 0.12, 2.8, "#e0a020", 2.1, 1.4, 1.6, 8));
    var arm = box(2.0, 0.14, 0.14, "#e0a020", 1.2, 2.75, 1.6); g.add(arm);
    g.add(cyl(0.01, 0.01, 1.2, "#2b2230", 0.4, 2.1, 1.6, 4), box(0.2, 0.15, 0.2, "#2b2230", 0.4, 1.45, 1.6));
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.4), signMaterial("機械小屋", "#3f6a8a"));
    sign.position.set(0, 2.75, 2.65); g.add(sign);
    g.userData.always = function (time) { chuck.rotation.x = time * 8; };
    return g;
  }

  // 滑水道：塔台＋螺旋滑道（落入湖中）＋直線滑道；搭乘中有小浮圈滑下來
  function buildWaterSlide(st) {
    var g = new THREE.Group(), H = 6.2, i;
    [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]].forEach(function (p) { g.add(cyl(0.1, 0.12, H, "#f4efe4", p[0] - 1.6, H / 2, p[1] - 1.4, 8)); });
    g.add(box(2.4, 0.2, 2.4, "#2f8fd0", -1.6, H, -1.4));
    var rail = new THREE.Group();
    [[0, 1.2, 2.4, 0], [0, -1.2, 2.4, 0], [1.2, 0, 2.4, 1], [-1.2, 0, 2.4, 1]].forEach(function (f) { rail.add(box(f[3] ? 0.05 : f[2], 0.05, f[3] ? f[2] : 0.05, "#ffffff", f[0], 0.9, f[1])); });
    rail.position.set(-1.6, H, -1.4); g.add(rail);
    var canopy = mesh(new THREE.ConeGeometry(1.8, 0.9, 8), lam("#ffd040"), -1.6, H + 2.0, -1.4); g.add(canopy);
    g.add(cyl(0.05, 0.05, 1.6, "#f4efe4", -1.6, H + 0.9, -1.4, 6));
    // 階梯（之字形，從入口側上去）
    for (i = 0; i < 12; i++) g.add(box(0.8, 0.08, 0.35, "#e8e0d0", 0.2 + (i % 2 ? 0.0 : 0.0), 0.25 + i * 0.5, 3.4 - i * 0.38));
    g.add(box(0.06, 6, 0.06, "#c8c8d8", 0.6, 3, 1.3));
    // 螺旋滑道
    var spiral = [];
    for (i = 0; i <= 48; i++) { var a = i / 48 * Math.PI * 3.2, r = 2.0; spiral.push(new THREE.Vector3(-1.6 + Math.cos(a) * r, H - 0.1 - i / 48 * (H - 0.35), -1.4 + Math.sin(a) * r)); }
    g.add(tube(spiral, 0.42, new THREE.MeshLambertMaterial({ color: "#ffd040", side: THREE.DoubleSide }), false, 120));
    // 直線滑道
    var straight = [new THREE.Vector3(-0.4, H - 0.1, -1.4), new THREE.Vector3(1.0, H - 2.4, -1.6), new THREE.Vector3(2.2, 1.2, -2.6), new THREE.Vector3(3.0, 0.3, -3.4)];
    g.add(tube(straight, 0.38, new THREE.MeshLambertMaterial({ color: "#e05a5a", side: THREE.DoubleSide }), false, 60));
    // 落水處的水花圈
    var splashes = [];
    [spiral[spiral.length - 1], straight[straight.length - 1]].forEach(function (p) {
      var ring = mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 20), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.7 }), p.x, 0.12, p.z);
      ring.rotation.x = Math.PI / 2; g.add(ring); splashes.push(ring);
    });
    var curve = new THREE.CatmullRomCurve3(spiral);
    var rider = mesh(new THREE.TorusGeometry(0.25, 0.1, 6, 12), lam("#ff7a3a"), 0, 0, 0);
    rider.rotation.x = Math.PI / 2; g.add(rider);
    var u = 0;
    g.userData.always = function (time) {
      for (var q = 0; q < splashes.length; q++) { var v = (time * 0.8 + q * 0.5) % 1; splashes[q].scale.setScalar(0.6 + v * 1.4); splashes[q].material.opacity = 0.7 * (1 - v); }
    };
    g.userData.update = function (step, time, spd) {
      rider.visible = spd > 0.2;
      u = (u + step * 0.35) % 1;
      var p = curve.getPointAt(u); rider.position.set(p.x, p.y + 0.15, p.z);
    };
    return g;
  }

  // 天鵝船：棧橋＋4 艘天鵝船（漂浮搖晃、搭乘中繞圈）
  function buildSwanBoat(st) {
    var g = new THREE.Group(), mods = st.mods || {};
    g.add(box(1.2, 0.12, 3.4, "#a0704a", 0, 0.22, 1.2)); // 棧橋（接到入口）
    for (var i = 0; i < 6; i++) g.add(cyl(0.06, 0.06, 0.5, "#6a4428", (i % 2 ? 0.5 : -0.5), 0.05, -0.2 + Math.floor(i / 2) * 1.2, 6));
    if (mods.light) [-0.5, 0.5].forEach(function (x) { g.add(cyl(0.03, 0.03, 1.4, "#3a2a22", x, 0.9, 2.6, 4)); g.add(chochin("#ffb050", x, 1.65, 2.6, 0.8)); });
    var boats = [], cols = ["#ffffff", "#ffffff", "#ffd8e8", "#ffffff"];
    for (var b = 0; b < 4; b++) {
      var bt = new THREE.Group();
      var body = mesh(new THREE.SphereGeometry(0.6, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), lam(cols[b]), 0, 0.15, 0);
      body.scale.set(0.95, 0.9, 1.3); body.rotation.x = Math.PI; bt.add(body);
      bt.add(box(0.9, 0.08, 1.2, cols[b], 0, 0.18, 0));
      bt.add(box(0.6, 0.1, 0.35, "#c8282e", 0, 0.3, -0.1));
      var wing1 = mesh(new THREE.SphereGeometry(0.35, 10, 8), lam(cols[b]), 0.42, 0.38, -0.25); wing1.scale.set(0.3, 0.7, 1.2); bt.add(wing1);
      var wing2 = wing1.clone(); wing2.position.x = -0.42; bt.add(wing2);
      bt.add(tube([new THREE.Vector3(0, 0.3, 0.55), new THREE.Vector3(0, 0.75, 0.8), new THREE.Vector3(0, 1.2, 0.68), new THREE.Vector3(0, 1.35, 0.85)], 0.09, cols[b], false, 16));
      bt.add(mesh(new THREE.SphereGeometry(0.15, 10, 8), lam(cols[b]), 0, 1.38, 0.88));
      var beak = mesh(new THREE.ConeGeometry(0.06, 0.22, 8), lam("#f08a2a"), 0, 1.36, 1.06); beak.rotation.x = Math.PI / 2; bt.add(beak);
      [-0.08, 0.08].forEach(function (x) { bt.add(mesh(new THREE.SphereGeometry(0.025, 6, 5), lam("#1d1a1c"), x, 1.43, 0.98)); });
      g.add(bt); boats.push(bt);
    }
    var ang = 0;
    function place(time) {
      for (var k = 0; k < boats.length; k++) {
        var a = ang + k / boats.length * Math.PI * 2;
        boats[k].position.set(Math.cos(a) * 1.7, 0.1 + Math.sin(time * 1.4 + k) * 0.05, -0.9 + Math.sin(a) * 1.3);
        boats[k].rotation.y = -a + Math.PI;
        boats[k].rotation.z = Math.sin(time * 1.1 + k * 2) * 0.05;
      }
    }
    place(0);
    g.userData.always = place;
    g.userData.update = function (step) { ang += step * 0.35; };
    return g;
  }

  // 天狗雲霄飛車：起伏軌道（拉升坡→大落差→小山丘）＋支柱＋月台（天狗面具）＋3 節車廂
  function buildCoaster(st) {
    var g = new THREE.Group(), mods = st.mods || {}, i;
    var P = [[-6.4, 3.6, 0.6], [-6.8, 0, 0.6], [-6.4, -3.4, 0.9], [-3.5, -3.8, 4.5], [-0.6, -3.8, 7.6], [1.4, -3.6, 7.2], [3.6, -3.4, 1.2], [6.2, -2.4, 1.4],
      [6.8, 0.2, 4.2], [5.6, 2.6, 2.0], [3.2, 3.0, 3.8], [0.6, 3.6, 1.0], [-3.0, 3.8, 0.6]];
    var curve = new THREE.CatmullRomCurve3(P.map(function (p) { return new THREE.Vector3(p[0], p[2], p[1]); }), true, "catmullrom", 0.5);
    var N = 220, pts = curve.getSpacedPoints(N).slice(0, N), up = new THREE.Vector3(0, 1, 0);
    var L = [], R = [];
    pts.forEach(function (p, k) {
      var nx = pts[(k + 1) % N], t = nx.clone().sub(p).normalize(), side = new THREE.Vector3().crossVectors(t, up).normalize().multiplyScalar(0.42);
      L.push(p.clone().add(side)); R.push(p.clone().sub(side));
    });
    var rail = new THREE.MeshLambertMaterial({ color: mods.light ? "#ff5a5a" : "#c8282e" });
    g.add(tube(L, 0.07, rail, true, 400), tube(R, 0.07, rail, true, 400), tube(pts, 0.1, "#6a6f7a", true, 400));
    var ties = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.06, 0.12), lam("#3c3a4a"), N / 2);
    var sup = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 1, 6), lam("#9a9aa8"), N / 6 | 0);
    var si = 0;
    for (i = 0; i < N; i += 2) {
      var p = pts[i], nx = pts[(i + 1) % N];
      tmpV.set(nx.x - p.x, nx.y - p.y, nx.z - p.z).normalize();
      tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmpV);
      tmpM.compose(p, tmpQ, tmpS.set(1, 1, 1));
      ties.setMatrixAt(i / 2, tmpM);
      if (i % 6 === 0 && p.y > 0.6 && si < sup.count) { tmpM.compose(tmpV.set(p.x, p.y / 2, p.z), tmpQ.identity(), tmpS.set(1, p.y, 1)); sup.setMatrixAt(si++, tmpM); }
    }
    sup.count = si;
    g.add(ties, sup);
    if (mods.light) { var lb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 6, 5), glow("#ffe080", 2.6), N / 5 | 0); for (i = 0; i < lb.count; i++) { tmpM.makeTranslation(L[i * 5].x, L[i * 5].y + 0.1, L[i * 5].z); lb.setMatrixAt(i, tmpM); } g.add(lb); }
    // 月台＋天狗面具
    g.add(box(4.2, 0.5, 1.6, "#b8b0a0", -2.0, 0.25, 4.3));
    [-3.9, -0.1].forEach(function (x) { g.add(cyl(0.08, 0.08, 2.4, "#3c3a4a", x, 1.45, 4.9, 8)); });
    var roof = box(4.6, 0.12, 1.8, "#c8282e", -2.0, 2.7, 4.4); roof.rotation.x = 0.15; g.add(roof);
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.55), signMaterial("天狗コースター", "#1d1a1c"));
    sign.position.set(-2.0, 2.25, 5.25); g.add(sign);
    var mask = new THREE.Group();
    mask.add(mesh(new THREE.SphereGeometry(0.6, 14, 10), lam("#d02a2a"), 0, 0, 0));
    var nose = mesh(new THREE.ConeGeometry(0.16, 1.1, 10), lam("#d02a2a"), 0, -0.05, 0.85); nose.rotation.x = Math.PI / 2; mask.add(nose);
    mask.add(box(0.7, 0.12, 0.1, "#f4efe4", 0, 0.28, 0.5));
    mask.position.set(-2.0, 3.6, 4.7); g.add(mask);
    // 車廂
    var cars = [];
    for (i = 0; i < 3; i++) {
      var c = new THREE.Group();
      c.add(box(0.95, 0.4, 1.2, i === 0 ? "#1d1a1c" : "#c8282e", 0, 0.35, 0));
      c.add(box(0.8, 0.35, 0.15, "#d4a531", 0, 0.65, -0.35), box(0.8, 0.35, 0.15, "#d4a531", 0, 0.65, 0.2));
      if (i === 0) { var tn = mesh(new THREE.ConeGeometry(0.1, 0.7, 8), lam("#d02a2a"), 0, 0.45, 0.85); tn.rotation.x = Math.PI / 2; c.add(tn); }
      g.add(c); cars.push(c);
    }
    var u0 = 0.93, fwd = new THREE.Vector3(0, 0, 1); // 從月台附近出發
    function place() {
      for (var k = 0; k < cars.length; k++) {
        var uu = ((u0 - k * 0.022) % 1 + 1) % 1;
        cars[k].position.copy(curve.getPointAt(uu));
        cars[k].quaternion.setFromUnitVectors(fwd, curve.getTangentAt(uu)); // 車頭朝切線方向
      }
    }
    place();
    g.userData.update = function (step) {
      var y = curve.getPointAt(u0).y;
      u0 = (u0 + step * (0.02 + 0.03 * Math.sqrt(Math.max(0, 7.8 - y)))) % 1; // 越低越快（位能換動能）
      place();
    };
    return g;
  }

  // 風神自由落體：14 m 鐵塔＋環形座椅（慢慢升到頂、停一下、急速落下）
  function buildDropTower(st) {
    var g = new THREE.Group(), mods = st.mods || {}, H = 13.5, i;
    g.add(pad(5.6, 5.6, "#8a8a84"));
    g.add(cyl(1.6, 1.9, 0.4, "#6a6f7a", 0, 0.2, 0, 20));
    [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].forEach(function (p) { g.add(cyl(0.07, 0.07, H, "#c8c8d8", p[0], H / 2, p[1], 6)); });
    var bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.05, 0.05), lam("#9a9aa8"), 36);
    for (i = 0; i < 36; i++) {
      var y = 0.8 + Math.floor(i / 4) * 1.4, sd = i % 4;
      tmpQ.setFromEuler(new THREE.Euler(0, sd * Math.PI / 2, sd % 2 ? 0.6 : -0.6));
      tmpM.compose(tmpV.set(sd === 1 ? 0.5 : sd === 3 ? -0.5 : 0, y, sd === 0 ? 0.5 : sd === 2 ? -0.5 : 0), tmpQ, tmpS.set(1, 1, 1));
      bars.setMatrixAt(i, tmpM);
    }
    g.add(bars);
    g.add(cyl(1.1, 1.1, 0.8, "#2f4f8f", 0, H + 0.4, 0, 16));
    g.add(mesh(new THREE.ConeGeometry(1.2, 1.4, 16), lam("#d4a531"), 0, H + 1.5, 0));
    var sign = textSprite("風神", "#2f4f8f", "#ffffff", 2.2); sign.position.set(0, H + 0.4, 1.25); g.add(sign);
    if (mods.light) for (i = 0; i < 6; i++) g.add(bulbRing(12, 0.75, 1.5 + i * 2.2, i % 2 ? "#70d0ff" : "#ffd070", 2.6, 0.07));
    var car = new THREE.Group();
    car.add(cyl(1.25, 1.25, 0.3, "#c8282e", 0, 0, 0, 20));
    for (i = 0; i < 8; i++) {
      var a = i / 8 * Math.PI * 2, seat = new THREE.Group();
      seat.add(box(0.5, 0.08, 0.45, "#2b2230", 0, -0.35, 0.2), box(0.5, 0.75, 0.1, "#e0a020", 0, 0, -0.05));
      seat.position.set(Math.cos(a) * 1.35, 0, Math.sin(a) * 1.35);
      seat.rotation.y = -a + Math.PI / 2;
      car.add(seat);
    }
    car.position.y = 1.0; g.add(car);
    var ph = 0;
    g.userData.update = function (step, time, spd) {
      if (spd < 0.05 && car.position.y <= 1.01) return;
      ph = (ph + step * 0.22) % 1;
      var y;
      if (ph < 0.6) y = 1 + 11.2 * (ph / 0.6);
      else if (ph < 0.7) y = 12.2;
      else if (ph < 0.8) { var q = (ph - 0.7) / 0.1; y = 12.2 - 11.2 * q * q; }
      else y = 1;
      car.position.y = y;
    };
    return g;
  }

  var BUILDERS = {
    shrine: buildShrine, merry: buildMerry, cups: buildCups, chairs: buildChairs, wheel: buildWheel,
    kingyo: buildStall, shateki: buildStall, wanage: buildStall, omikuji: buildStall,
    takoyakiSt: buildStall, ameSt: buildStall, ramuneSt: buildStall, kasaSt: buildStall, juyo: buildStall,
    qstall: buildQstall, bench: buildSmall, toilet: buildSmall, trash: buildSmall, shelter: buildSmall, lanternPost: buildSmall, flower: buildSmall,
    bumper: buildBumper, foxTrain: buildFoxTrain, tour: buildTour, warehouse: buildWarehouse, shed: buildShed,
    waterSlide: buildWaterSlide, swanBoat: buildSwanBoat, coaster: buildCoaster, dropTower: buildDropTower,
  };
  var SCAFFOLD_H = { wheel: 9, chairs: 6, merry: 4.5, cups: 3.5, bumper: 4.4, foxTrain: 3, tour: 4.2, warehouse: 3.4, shed: 3.2, waterSlide: 8, swanBoat: 2, coaster: 7.8, dropTower: 15 };

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
    return [st.type, st.x, st.y, st.rot || 0, st.build > 0 ? st.build : 0, Object.keys(st.mods || {}).sort().join(","), st.broken ? 1 : 0, st.link || 0, windStop(st) ? 1 : 0].join("|");
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
    // 設施內的 InstancedMesh（燈泡、枕木、支柱…）也一樣：以群組原點裁切會在畫面邊緣整組消失
    g.traverse(function (o) { if (o.isInstancedMesh) o.frustumCulled = false; });
    var c = footCenter(st.type, st.x, st.y, st.rot);
    g.position.set(c.x, 0, c.z);
    g.rotation.y = ROT_Y[st.rot || 0];
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
    var list = [], col = new THREE.Color();
    for (var y = 0; y < M.WH; y++) for (var x = 0; x < M.W; x++) if (s.tiles[Core.ti(x, y)] === 1) { var w = tileToWorld(x, y); w.a = Core.areaOf(y); w.h = ((x * 73 + y * 151) % 17) / 17; list.push(w); }
    var geo = new THREE.BoxGeometry(T - 0.06, 0.04, T - 0.06); // 每格留細縫，看得出石板
    pathMesh = new THREE.InstancedMesh(geo, pathMat, Math.max(1, list.length));
    pathMesh.count = list.length;
    pathMesh.frustumCulled = false; // r149 的 InstancedMesh 以原點判斷視錐裁切：其他區域的步道會整片消失
    list.forEach(function (p, i) {
      tmpM.makeTranslation(p.x, 0.02, p.z);
      pathMesh.setMatrixAt(i, tmpM);
      pathMesh.setColorAt(i, col.set(AREA_STYLE[D.AREAS[p.a].id].path).multiplyScalar(0.92 + p.h * 0.14));
    });
    if (pathMesh.instanceColor) pathMesh.instanceColor.needsUpdate = true;
    scene.add(pathMesh);
  }

  // ---------------------------------------------------------------- 客人
  function jitter(gid) {
    return { x: (((gid * 37) % 11) / 10 - 0.5) * 1.2, z: (((gid * 53) % 13) / 12 - 0.5) * 1.2 };
  }

  var QUEUE_DIR = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // 入口朝向（rot）→ 隊伍往外延伸的方向
  function computeSnap(s) {
    var out = {}, list = [], qi = {}, k;
    for (k in s.structs) {
      var st = s.structs[k];
      if (st.q) for (var i = 0; i < st.q.length; i++) qi[st.q[i]] = { st: st, i: i };
    }
    var later = [];
    (s.guests || []).forEach(function (g) {
      var p, j = jitter(g.id), q = qi[g.id], rec = { hide: false, face: null, kasa: !!g.kasa, outfit: g.outfit || 0 };
      if (g.state === "queue" && q) {
        // 沿入口往外排成一列（每人 0.6 m），面向設施
        var e = Core.entranceOf(q.st);
        p = tileToWorld(e.x, e.y);
        var od = QUEUE_DIR[q.st.type === "shrine" ? 1 : (q.st.rot || 0)], off = -T / 2 + 0.3 + q.i * 0.6; // 依入口方向往外排
        rec.x = p.x + od[0] * off;
        rec.z = p.z + od[1] * off;
        rec.face = Math.atan2(-od[0], -od[1]);
      } else {
        p = tileToWorld(g.x, g.y);
        rec.x = p.x + j.x;
        rec.z = p.z + j.z;
        if (g.state === "ride") rec.hide = true; // 搭乘中不畫
      }
      out[g.id] = rec;
      ((g.area || 0) === curArea ? list : later).push(g.id); // 目前區域的客人先畫（超過上限時遠方的先省略）
    });
    return { map: out, list: list.concat(later) };
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
    sun: { sky: "#a9d6f2", top: "#3c86d8", hemi: 0.65, sun: 0.8, ground: 1 },
    cloud: { sky: "#b3bac2", top: "#7d8894", hemi: 0.62, sun: 0.3, ground: 0.9 },
    rain: { sky: "#6c7682", top: "#3e4652", hemi: 0.52, sun: 0.12, ground: 0.62 },
    wind: { sky: "#b0d2ea", top: "#4f94d4", hemi: 0.65, sun: 0.7, ground: 1 },
  };
  function setWeather(id) {
    weather = SKY[id] ? id : "sun";
    if (!scene) return;
    var c = SKY[weather];
    scene.background.set(c.sky);
    scene.fog.color.set(c.sky);
    paintSky(c.top, c.sky); // 地平線顏色＝霧的顏色，遠處地面自然融進天空
    hemi.intensity = c.hemi;
    sunLight.intensity = c.sun;
    groundMats.forEach(function (g) { g.mat.color.set(g.hex).multiplyScalar(c.ground); });
    pathMat.color.set("#ffffff").multiplyScalar(c.ground);
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
  var IDLE_SPEED = 0.25;
  function updateStructs(dt, time) {
    var s = cur, windy = weather === "wind";
    for (var k in recs) {
      var rec = recs[k], ud = rec.group.userData, st = s && s.structs[k];
      if (ud.always) ud.always(time);
      if (ud.sway) for (var i = 0; i < ud.sway.length; i++) swayOne(ud.sway[i], time, windy);
      if (!ud.update || !st) continue;
      var running = !st.broken && !(st.build > 0) && st.t > 0 && st.riders && st.riders.length > 0;
      // 空車、開園前也慢速試運轉（使用者指定 2026-11-14：設施動畫隨時看得到）；故障、施工中、強風停駛則停止
      var idle = !st.broken && !(st.build > 0) && !windStop(st) ? IDLE_SPEED : 0;
      var target = running ? (st.mods && st.mods.drive ? 1.5 : 1) : idle; // drive：轉速 ×1.5
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
    if (rain) rain.position.set(controls.target.x, 0, controls.target.z); // 雨跟著鏡頭
    for (var e = 0; e < envUpdates.length; e++) envUpdates[e](time);
    updateScenery(time);
    updateCam(dt);
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
        setArea(curArea, true);
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
    syncAreas(s);
    syncPaths(s);
    syncDecor(s);
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
    var x = Math.floor(hit.x / T + M.W / 2);
    for (var a = 0; a < D.AREAS.length; a++) {
      var ly = Math.floor((hit.z - areaZ(a)) / T + M.H / 2);
      if (ly >= 0 && ly < M.H) { var y = a * M.H + ly; return Core.inMap(x, y) ? { x: x, y: y } : null; }
    }
    return null;
  }

  // 放置預覽：半透明的實際模型（依方向轉）＋腳下綠／紅色底板＋黃色入口格
  var ghostModel = null, ghostType = null, ghostMats = [];
  function makeGhostModel(type) {
    var fake = { id: 0, type: type, x: 0, y: 0, rot: 0, mods: {}, build: 0, broken: false, q: [], riders: [], t: 0, link: null };
    var g = (BUILDERS[type] || buildSmall)(fake, { structs: {} });
    ghostMats = [];
    g.traverse(function (o) {
      if (o.isInstancedMesh) o.frustumCulled = false;
      if (!o.material) return;
      var list = Array.isArray(o.material) ? o.material : [o.material];
      var cl = list.map(function (m) { var c = m.clone(); c.transparent = true; c.opacity = 0.55; c.depthWrite = false; c.userData = {}; ghostMats.push(c); return c; });
      o.material = Array.isArray(o.material) ? cl : cl[0];
    });
    return g;
  }
  function ghost(type, x, y, ok, rot) {
    if (!ghostGroup) return;
    if (type == null) { ghostGroup.visible = false; return; }
    rot = (rot | 0) % 4;
    var b = D.BUILD[type], d = b ? Core.dims(type, rot) : { w: 1, h: 1 };
    var c = tileToWorld(x + (d.w - 1) / 2, y + (d.h - 1) / 2);
    var bx = ghostGroup.userData.box, door = ghostGroup.userData.door;
    bx.scale.set(d.w * T - 0.1, 0.08, d.h * T - 0.1);
    bx.position.set(c.x, 0.06, c.z);
    bx.material.color.set(ok ? "#40d060" : "#e04040");
    if (ghostType !== type) {
      if (ghostModel) { ghostGroup.remove(ghostModel); disposeTree(ghostModel); ghostModel = null; }
      ghostType = type;
      if (b) { ghostModel = makeGhostModel(type); ghostGroup.add(ghostModel); }
    }
    if (ghostModel) {
      ghostModel.position.set(c.x, 0.02, c.z);
      ghostModel.rotation.y = ROT_Y[rot];
      for (var i = 0; i < ghostMats.length; i++) ghostMats[i].opacity = ok ? 0.6 : 0.3;
    }
    door.visible = !!b && b.kind !== "shrine";
    if (door.visible) {
      var e = Core.entranceAt(type, x, y, rot), ew = tileToWorld(e.x, e.y);
      door.position.set(ew.x, 0.08, ew.z);
    }
    ghostGroup.visible = true;
  }

  function focusGuest(gid) {
    follow = gid == null ? null : gid;
    followZoom = follow != null;
  }

  var api = {
    init: init, sync: sync, pickTile: pickTile, ghost: ghost, focusGuest: focusGuest, bubble: bubble,
    tileToWorld: tileToWorld, setWeather: setWeather, setArea: setArea,
    _scene: function () { return scene; }, // 測試用：直接檢查場景物件
    // 測試用：目前畫面的摘要
    _debug: function () {
      return {
        ready: ready, structs: Object.keys(recs).length, guests: crowd ? crowd.mesh.geometry.instanceCount : 0,
        weather: weather, rain: !!(rain && rain.visible), bubbles: bubbles.length, follow: follow, sayo: !!sayo,
        ema: emaCount, paths: pathMesh ? pathMesh.count : 0, area: curArea,
        locked: areaLocks.map(function (g) { return g ? g.visible : false; }),
      };
    },
  };
  window.PriTestEnnichi3D = api;
})();
