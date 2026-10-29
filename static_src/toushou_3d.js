// 東正小遊戲（toushou）：標的卡上的 3D 拍賣展示台（three.js r149，第一次顯示標的卡時才載入 #ts-app[data-three-src]）。
// 2026-10-29 使用者指定「每個標的有精美建模」：約 60 種程式化模板（壽司、拉麵、城、塔、人物…），
// 依標的名稱的關鍵字（中日文）＋類別決定模板，再用標的 id 的雜湊決定配色與配件，所以每個標的的模型都不一樣。
// 只負責「畫」：不讀寫 state、不影響規則。整頁只有一個 WebGL 畫布，重畫 DOM 時把同一張畫布搬到新的佔位元素裡。
(function () {
  "use strict";

  var D = window.PriTestToushouData;
  var loading = null, three = null;
  var R = null;   // { renderer, scene, camera, pedestal, model, key, holder, raf, last }

  // ---------------- 小工具 ----------------
  function hash(s) {
    var h = 2166136261 >>> 0;
    s = String(s || "");
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h;
  }
  // 由 id 產生的確定性亂數（同一個標的每次長得一樣）
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }

  function available() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  }
  function load() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (loading) return loading;
    var app = document.getElementById("ts-app"), src = app && app.getAttribute("data-three-src");
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

  // ---------------- 建模基本件 ----------------
  var T;   // = window.THREE（載入後）
  var matCache = {};
  function M(color, o) {
    var k = color + (o ? JSON.stringify(o) : "");
    if (matCache[k]) return matCache[k];
    var opts = { color: color, roughness: 0.55, metalness: 0.05, flatShading: true };
    Object.keys(o || {}).forEach(function (x) { opts[x] = o[x]; });
    return (matCache[k] = new T.MeshStandardMaterial(opts));
  }
  function add(g, geo, color, x, y, z, o) {
    var m = new T.Mesh(geo, typeof color === "string" ? M(color, o) : color);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    g.add(m);
    return m;
  }
  function box(g, w, h, d, c, x, y, z) { return add(g, new T.BoxGeometry(w, h, d), c, x, y, z); }
  function cyl(g, rt, rb, h, c, x, y, z, seg) { return add(g, new T.CylinderGeometry(rt, rb, h, seg || 18), c, x, y, z); }
  function sph(g, r, c, x, y, z, seg) { return add(g, new T.SphereGeometry(r, seg || 16, Math.max(6, (seg || 16) * 0.6 | 0)), c, x, y, z); }
  function cone(g, r, h, c, x, y, z, seg) { return add(g, new T.ConeGeometry(r, h, seg || 16), c, x, y, z); }
  function torus(g, r, tube, c, x, y, z, arc) { return add(g, new T.TorusGeometry(r, tube, 8, 24, arc || Math.PI * 2), c, x, y, z); }
  function grp(parent, x, y, z) { var g = new T.Group(); g.position.set(x || 0, y || 0, z || 0); parent.add(g); return g; }

  var PALETTES = [
    ["#e2423f", "#ffd23f", "#2c6cff"], ["#18b96b", "#ffd8b0", "#b08d3c"], ["#ff4f7b", "#2c6cff", "#ffd23f"],
    ["#7e57c2", "#ffd23f", "#26c6da"], ["#ff7043", "#5c6bc0", "#f8f1e0"], ["#00897b", "#ffca28", "#e53935"],
    ["#3949ab", "#ef5350", "#f8f1e0"], ["#8d6e63", "#81c784", "#ffd54f"]
  ];
  var SKIN = ["#ffd8b0", "#f1c27d", "#e0ac69", "#c68642"];
  var HAIR = ["#1b1b1b", "#3e2723", "#5d4037", "#8d6e63", "#d4a94e", "#b0bec5", "#e57373", "#4a148c"];

  // ---------------- 模板 ----------------
  // 每個模板：function (g, r, P, opt)；g＝模型群組（底部在 y=0、高度約 1.2–1.8），r＝亂數，P＝配色 [主, 副, 點綴]
  var TPL = {};

  // ---- 食物 ----
  function plate(g, r, c) { cyl(g, 0.95, 0.8, 0.08, c || "#f8f1e0", 0, 0.04, 0, 28); torus(g, 0.9, 0.03, "#2c6cff", 0, 0.08, 0).rotation.x = Math.PI / 2; }
  function bowl(g, color, rim) {
    var b = cyl(g, 0.8, 0.45, 0.6, color, 0, 0.32, 0, 28);
    torus(g, 0.78, 0.05, rim || "#b08d3c", 0, 0.62, 0).rotation.x = Math.PI / 2;
    cyl(g, 0.35, 0.38, 0.08, color, 0, 0.04, 0, 20);
    return b;
  }
  TPL.sushi = function (g, r, P, o) {
    plate(g, r, "#263238");
    var fish = o.fish || pick(r, ["#ff7043", "#e53935", "#ffab91", "#f8f1e0", "#ffd23f"]);
    var n = 2 + Math.floor(r() * 2);
    for (var i = 0; i < n; i++) {
      var x = (i - (n - 1) / 2) * 0.55, s = grp(g, x, 0.08, 0);
      box(s, 0.32, 0.22, 0.5, "#fafafa", 0, 0.11, 0);
      var top = box(s, 0.38, 0.09, 0.62, i === 1 && o.mix ? "#ffd23f" : fish, 0, 0.26, 0);
      top.rotation.x = 0.06;
      if (fish === "#f8f1e0" || i === 1) box(s, 0.39, 0.02, 0.1, "#1b1b1b", 0, 0.24, 0);
    }
    box(g, 0.25, 0.12, 0.2, "#81c784", 0.65, 0.14, 0.45);
  };
  TPL.noodle = function (g, r, P, o) {
    bowl(g, o.bowl || pick(r, ["#e2423f", "#1b1b1b", "#f8f1e0", "#2c6cff"]));
    cyl(g, 0.72, 0.72, 0.06, o.soup || pick(r, ["#e0a35a", "#c97b3a", "#f1d9a6", "#8d4b2a"]), 0, 0.6, 0, 28);
    for (var i = 0; i < 7; i++) torus(g, 0.12 + i * 0.07, 0.015, o.noodle || "#ffe082", 0, 0.64, 0).rotation.x = Math.PI / 2;
    if (o.egg !== false) { var e = sph(g, 0.17, "#fafafa", 0.32, 0.66, 0.15); e.scale.y = 0.6; var y = sph(g, 0.09, "#ffb300", 0.34, 0.72, 0.15); y.scale.y = 0.5; }
    if (o.meat !== false) { var m = cyl(g, 0.22, 0.22, 0.05, "#a1673a", -0.3, 0.67, 0.1); m.rotation.x = 0.2; }
    for (var k = 0; k < 6; k++) box(g, 0.06, 0.02, 0.06, "#43a047", (r() - 0.5) * 0.8, 0.66, (r() - 0.5) * 0.8);
    var ch = box(g, 0.04, 0.04, 1.4, "#b08d3c", 0.2, 0.95, -0.1); ch.rotation.set(0.5, 0.4, 0.3);
    var ch2 = box(g, 0.04, 0.04, 1.4, "#b08d3c", 0.32, 0.95, -0.05); ch2.rotation.set(0.5, 0.5, 0.3);
  };
  TPL.donburi = function (g, r, P, o) {
    bowl(g, o.bowl || pick(r, ["#1b1b1b", "#e2423f", "#3949ab"]));
    var rice = sph(g, 0.72, "#fafafa", 0, 0.58, 0); rice.scale.y = 0.3;
    var top = o.top || pick(r, ["#a1673a", "#ffb300", "#ff7043", "#6d4c41"]);
    for (var i = 0; i < 5; i++) { var t = box(g, 0.32, 0.07, 0.22, top, (r() - 0.5) * 0.6, 0.78, (r() - 0.5) * 0.6); t.rotation.y = r() * 3; }
    if (o.egg) { var y = sph(g, 0.14, "#ffb300", 0, 0.84, 0); y.scale.y = 0.55; }
    box(g, 0.08, 0.03, 0.08, "#43a047", 0.15, 0.85, 0.2);
  };
  TPL.curry = function (g, r, P, o) {
    plate(g, r, "#f8f1e0");
    var rice = sph(g, 0.5, "#fafafa", -0.3, 0.08, 0); rice.scale.y = 0.45;
    var sauce = cyl(g, 0.55, 0.6, 0.08, o.sauce || pick(r, ["#8d4b2a", "#a0522d", "#6d3b1e", "#d84315"]), 0.25, 0.12, 0, 24);
    for (var i = 0; i < 4; i++) box(g, 0.16, 0.12, 0.16, pick(r, ["#ff8a65", "#ffd54f", "#a1887f"]), 0.25 + (r() - 0.5) * 0.6, 0.22, (r() - 0.5) * 0.6);
    if (o.omelette) { var om = sph(g, 0.55, "#ffd23f", -0.1, 0.12, 0); om.scale.set(1.3, 0.45, 0.8); box(g, 0.6, 0.03, 0.06, "#e53935", -0.1, 0.38, 0); }
  };
  TPL.fried = function (g, r, P, o) {
    plate(g, r);
    var col = o.col || "#d39b4a", n = 3 + Math.floor(r() * 3);
    for (var i = 0; i < n; i++) {
      var p = o.shrimp ? cyl(g, 0.08, 0.13, 0.9, col, (i - n / 2) * 0.28, 0.2, 0, 8) : sph(g, 0.22, col, (r() - 0.5) * 0.9, 0.22, (r() - 0.5) * 0.9, 7);
      if (o.shrimp) { p.rotation.z = Math.PI / 2 - 0.3; p.rotation.y = (r() - 0.5); cone(g, 0.08, 0.18, "#ff5722", (i - n / 2) * 0.28 + 0.45, 0.35, 0, 6); }
      else p.scale.y = 0.7;
    }
    for (var k = 0; k < 8; k++) box(g, 0.05, 0.3, 0.05, "#c5e1a5", -0.6 + r() * 0.2, 0.18, -0.4 + r() * 0.8).rotation.z = r();
    var lemon = sph(g, 0.14, "#fff176", 0.6, 0.16, 0.45); lemon.scale.x = 0.4;
  };
  TPL.skewer = function (g, r, P, o) {
    plate(g, r, "#efe4c8");
    for (var s = 0; s < 3; s++) {
      var k = grp(g, 0, 0.18, (s - 1) * 0.35); k.rotation.y = 0.2;
      box(k, 1.6, 0.03, 0.03, "#d7ccc8", 0, 0, 0);
      for (var i = 0; i < 4; i++) {
        var c = o.dango ? ["#ff8fab", "#fafafa", "#81c784"][i % 3] : pick(r, ["#8d4b2a", "#a1673a", "#6d4c41"]);
        var b = o.dango ? sph(k, 0.15, c, -0.5 + i * 0.3, 0, 0) : box(k, 0.22, 0.18, 0.2, c, -0.5 + i * 0.3, 0, 0);
        if (!o.dango) b.rotation.x = r();
      }
    }
  };
  TPL.takoyaki = function (g, r, P) {
    var boat = box(g, 1.6, 0.12, 1.0, "#d7b07a", 0, 0.06, 0);
    for (var i = 0; i < 6; i++) {
      var x = ((i % 3) - 1) * 0.45, z = (Math.floor(i / 3) - 0.5) * 0.42;
      sph(g, 0.2, "#c9853f", x, 0.3, z, 12);
      box(g, 0.25, 0.02, 0.06, "#5d2c0f", x, 0.48, z).rotation.y = r();
      box(g, 0.06, 0.02, 0.06, "#43a047", x + 0.05, 0.5, z);
    }
    var stick = box(g, 0.03, 0.03, 0.7, "#d7ccc8", 0.5, 0.6, 0.1); stick.rotation.x = 0.8;
  };
  TPL.hotpot = function (g, r, P, o) {
    cyl(g, 0.6, 0.55, 0.25, "#424242", 0, 0.12, 0, 24);
    var pot = cyl(g, 0.9, 0.75, 0.45, o.pot || "#5d4037", 0, 0.48, 0, 28);
    torus(g, 0.9, 0.05, "#212121", 0, 0.7, 0).rotation.x = Math.PI / 2;
    cyl(g, 0.84, 0.84, 0.05, o.soup || pick(r, ["#a1673a", "#e0a35a", "#f8f1e0", "#d84315"]), 0, 0.68, 0, 28);
    for (var i = 0; i < 9; i++) {
      var c = pick(r, ["#ef9a9a", "#a5d6a7", "#fff59d", "#ce93d8", "#ffffff", "#8d6e63"]);
      var it = i % 3 ? box(g, 0.28, 0.06, 0.18, c, (r() - 0.5) * 1.2, 0.74, (r() - 0.5) * 1.2) : sph(g, 0.12, c, (r() - 0.5) * 1.1, 0.74, (r() - 0.5) * 1.1, 8);
      it.rotation.y = r() * 3;
    }
    [-1, 1].forEach(function (s) { torus(g, 0.15, 0.04, "#212121", s * 0.95, 0.62, 0).rotation.y = Math.PI / 2; });
  };
  TPL.griddle = function (g, r, P, o) {
    box(g, 1.8, 0.1, 1.3, "#37474f", 0, 0.05, 0);
    var cake = cyl(g, 0.65, 0.65, 0.16, o.col || "#e0a35a", 0, 0.18, 0, 28);
    if (o.roll) { cake.scale.set(1.2, 1.4, 0.55); }
    for (var i = 0; i < 5; i++) box(g, 1.0, 0.02, 0.04, o.sauce || "#5d2c0f", 0, 0.28, (i - 2) * 0.18).rotation.y = 0.5;
    for (var k = 0; k < 4; k++) box(g, 0.9, 0.02, 0.03, "#fff8e1", 0, 0.29, (k - 1.5) * 0.2).rotation.y = -0.6;
    for (var j = 0; j < 10; j++) box(g, 0.07, 0.02, 0.07, "#43a047", (r() - 0.5) * 0.9, 0.3, (r() - 0.5) * 0.9);
    var sp = box(g, 0.35, 0.02, 0.25, "#b0bec5", 0.7, 0.35, 0.3); sp.rotation.z = 0.4;
  };
  TPL.onigiri = function (g, r, P, o) {
    plate(g, r, "#a5d6a7");
    for (var i = 0; i < (o.single ? 1 : 2); i++) {
      var s = grp(g, (i - 0.5) * 0.65 * (o.single ? 0 : 1), 0.08, 0);
      var tri = cone(s, 0.42, 0.7, "#fafafa", 0, 0.38, 0, 3); tri.rotation.y = Math.PI / 6;
      tri.scale.z = 0.6;
      box(s, 0.38, 0.28, 0.27, "#1b1b1b", 0, 0.16, 0);
      sph(s, 0.06, o.fill || "#e53935", 0, 0.45, 0.13, 8);
    }
  };
  TPL.steamer = function (g, r, P, o) {
    cyl(g, 0.85, 0.85, 0.4, "#d7b07a", 0, 0.2, 0, 24);
    torus(g, 0.85, 0.04, "#a1887f", 0, 0.4, 0).rotation.x = Math.PI / 2;
    var n = 5;
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2, x = Math.cos(a) * 0.45, z = Math.sin(a) * 0.45;
      var b = sph(g, 0.22, o.col || "#fafafa", x, 0.52, z, 12); b.scale.y = 0.75;
      cone(g, 0.08, 0.12, o.col || "#fafafa", x, 0.72, z, 8);
    }
    sph(g, 0.22, o.col || "#fafafa", 0, 0.52, 0, 12).scale.y = 0.75;
    for (var k = 0; k < 3; k++) { var st = torus(g, 0.12, 0.02, M("#ffffff", { transparent: true, opacity: 0.5 }), (k - 1) * 0.3, 1.1 + k * 0.12, 0); st.rotation.y = k; }
  };
  TPL.bun = function (g, r, P) {
    plate(g, r);
    var b = sph(g, 0.5, "#fafafa", 0, 0.3, 0); b.scale.set(1.2, 0.5, 0.8);
    box(g, 0.9, 0.16, 0.5, "#8d4b2a", 0.05, 0.32, 0);
    for (var i = 0; i < 6; i++) box(g, 0.1, 0.04, 0.1, pick(r, ["#43a047", "#ffd54f"]), (r() - 0.5) * 0.8, 0.42, (r() - 0.5) * 0.4);
  };
  TPL.taiyaki = function (g, r, P, o) {
    plate(g, r);
    for (var i = 0; i < 2; i++) {
      var f = grp(g, (i - 0.5) * 0.4, 0.3 + i * 0.12, (i - 0.5) * 0.3); f.rotation.y = 0.5 - i;
      var b = sph(f, 0.45, o.col || "#c9853f", 0, 0, 0); b.scale.set(1.2, 0.75, 0.3);
      var tail = cone(f, 0.25, 0.4, o.col || "#c9853f", -0.6, 0, 0, 3); tail.rotation.z = Math.PI / 2; tail.scale.z = 0.3;
      sph(f, 0.05, "#3e2723", 0.35, 0.12, 0.13, 6);
    }
  };
  TPL.wagashi = function (g, r, P, o) {
    box(g, 1.4, 0.06, 1.0, "#3e2723", 0, 0.03, 0);
    var n = 3;
    for (var i = 0; i < n; i++) {
      var c = o.col || pick(r, ["#f8bbd0", "#fafafa", "#c5e1a5", "#ffe0b2"]);
      var m = o.dora ? cyl(g, 0.35, 0.35, 0.22, "#b5651d", (i - 1) * 0.42, 0.18, 0) : sph(g, 0.24, c, (i - 1) * 0.42, 0.22, 0);
      if (!o.dora) m.scale.y = 0.75;
      else box(g, 0.66, 0.06, 0.4, "#5d2c0f", (i - 1) * 0.42, 0.18, 0).scale.set(1, 1, 0.9);
    }
    var leaf = sph(g, 0.2, "#66bb6a", 0.55, 0.08, 0.3); leaf.scale.set(1.6, 0.15, 0.7);
  };
  TPL.shavedIce = function (g, r, P, o) {
    cyl(g, 0.65, 0.4, 0.4, "#e1f5fe", 0, 0.2, 0, 20);
    var ice = cone(g, 0.7, 0.9, o.col || pick(r, ["#ffcc80", "#ef9a9a", "#a5d6a7", "#fff59d"]), 0, 0.85, 0, 20);
    ice.scale.y = 0.9;
    for (var i = 0; i < 7; i++) box(g, 0.18, 0.18, 0.18, o.fruit || "#ffb300", (r() - 0.5) * 0.7, 0.75 + r() * 0.3, (r() - 0.5) * 0.7).rotation.set(r(), r(), r());
    var sp = box(g, 0.08, 0.02, 0.7, "#ffd23f", 0.3, 1.25, 0); sp.rotation.x = 0.7;
  };
  TPL.pudding = function (g, r, P, o) {
    box(g, 1.2, 0.06, 1.2, "#8d6e63", 0, 0.03, 0);
    var cup = cyl(g, 0.5, 0.4, 0.5, o.cup || "#f8f1e0", 0, 0.31, 0, 20);
    cyl(g, 0.46, 0.46, 0.05, o.col || "#fff3e0", 0, 0.56, 0, 20);
    for (var i = 0; i < 5; i++) sph(g, 0.06, o.top || "#6d4c41", (r() - 0.5) * 0.5, 0.6, (r() - 0.5) * 0.5, 6);
    var sp = box(g, 0.07, 0.02, 0.8, "#b08d3c", 0.4, 0.6, 0.3); sp.rotation.set(0.3, 0.8, 0);
  };
  TPL.tea = function (g, r, P, o) {
    box(g, 1.3, 0.05, 1.0, "#3e2723", 0, 0.025, 0);
    cyl(g, 0.45, 0.32, 0.45, o.cup || "#5d4037", -0.2, 0.28, 0, 20);
    cyl(g, 0.42, 0.42, 0.04, o.col || "#7cb342", -0.2, 0.48, 0, 20);
    var wh = grp(g, 0.5, 0.05, 0.2);
    cyl(wh, 0.04, 0.04, 0.4, "#d7b07a", 0, 0.45, 0);
    for (var i = 0; i < 10; i++) { var t = box(wh, 0.01, 0.3, 0.01, "#d7b07a", Math.cos(i) * 0.1, 0.15, Math.sin(i) * 0.1); t.rotation.z = Math.cos(i) * 0.3; }
    var sw = sph(g, 0.17, "#a5d6a7", 0.45, 0.14, -0.3); sw.scale.y = 0.7;
  };
  TPL.bubbleTea = function (g, r, P, o) {
    var cup = cyl(g, 0.42, 0.34, 1.2, M("#ffffff", { transparent: true, opacity: 0.35 }), 0, 0.6, 0, 20);
    cup.castShadow = false;
    cyl(g, 0.38, 0.32, 0.95, o.col || "#c8a27a", 0, 0.5, 0, 20);
    for (var i = 0; i < 18; i++) sph(g, 0.07, "#2b1b14", (r() - 0.5) * 0.45, 0.1 + r() * 0.15, (r() - 0.5) * 0.45, 6);
    cyl(g, 0.44, 0.44, 0.06, "#f8f1e0", 0, 1.22, 0, 20);
    var straw = cyl(g, 0.05, 0.05, 1.0, P[0], 0.1, 1.5, 0, 8); straw.rotation.z = -0.15;
  };
  TPL.burger = function (g, r, P, o) {
    plate(g, r);
    var y = 0.12;
    function layer(h, c, rr, sc) { var m = cyl(g, rr, rr, h, c, 0, y + h / 2, 0, 24); if (sc) m.scale.set(1, 1, sc); y += h; return m; }
    layer(0.15, "#d39b4a", 0.55);
    layer(0.18, o.patty || "#5d4037", 0.58);
    layer(0.04, "#ffca28", 0.62);
    layer(0.06, "#66bb6a", 0.6);
    var top = sph(g, 0.56, "#d39b4a", 0, y, 0); top.scale.y = 0.55;
    for (var i = 0; i < 8; i++) box(g, 0.04, 0.02, 0.02, "#fff8e1", (r() - 0.5) * 0.6, y + 0.25, (r() - 0.5) * 0.6);
  };
  TPL.fish = function (g, r, P, o) {
    box(g, 1.7, 0.08, 0.8, "#f8f1e0", 0, 0.04, 0);
    var f = grp(g, 0, 0.24, 0);
    var b = sph(f, 0.5, o.col || "#90a4ae", 0, 0, 0); b.scale.set(1.5, 0.45, 0.35);
    var t = cone(f, 0.25, 0.35, o.col || "#90a4ae", -0.85, 0, 0, 4); t.rotation.z = Math.PI / 2; t.scale.z = 0.3;
    sph(f, 0.05, "#1b1b1b", 0.55, 0.08, 0.12, 6);
    if (o.puffer) { b.scale.set(0.9, 0.85, 0.85); for (var i = 0; i < 14; i++) cone(f, 0.03, 0.1, "#fff59d", Math.cos(i) * 0.4, Math.sin(i * 1.7) * 0.4, Math.sin(i) * 0.3, 4); }
    for (var k = 0; k < 4; k++) box(f, 0.05, 0.01, 0.3, "#3e2723", (k - 1.5) * 0.25, 0.2, 0);
    var lemon = sph(g, 0.14, "#fff176", 0.7, 0.16, 0.25); lemon.scale.x = 0.4;
  };
  TPL.crab = function (g, r, P) {
    plate(g, r, "#81d4fa");
    var c = grp(g, 0, 0.32, 0);
    var b = sph(c, 0.45, "#e53935", 0, 0, 0); b.scale.set(1, 0.45, 0.8);
    [-1, 1].forEach(function (s) {
      for (var i = 0; i < 3; i++) { var l = box(c, 0.6, 0.06, 0.06, "#e53935", s * 0.55, -0.08, (i - 1) * 0.22); l.rotation.z = s * -0.4; }
      var cl = sph(c, 0.15, "#c62828", s * 0.35, 0.05, 0.55, 8); cl.scale.set(1, 0.7, 1.4);
      sph(c, 0.05, "#1b1b1b", s * 0.12, 0.22, 0.32, 6);
    });
  };
  TPL.tofu = function (g, r, P, o) {
    plate(g, r);
    for (var i = 0; i < 5; i++) box(g, 0.32, 0.3, 0.32, o.col || "#c9853f", ((i % 3) - 1) * 0.4, 0.25 + (i > 2 ? 0.3 : 0), (i > 2 ? 0 : 0.15)).rotation.y = r();
    for (var k = 0; k < 10; k++) box(g, 0.06, 0.02, 0.12, "#a5d6a7", (r() - 0.5) * 1.1, 0.12, (r() - 0.5) * 1.1);
  };
  TPL.bento = function (g, r, P) {
    box(g, 1.7, 0.25, 1.2, "#1b1b1b", 0, 0.125, 0);
    box(g, 1.6, 0.05, 1.1, "#b71c1c", 0, 0.27, 0);
    var cells = [[-0.45, -0.3], [0.35, -0.3], [-0.45, 0.25], [0.35, 0.25]];
    cells.forEach(function (c, i) {
      for (var k = 0; k < 3; k++) {
        var col = pick(r, ["#fafafa", "#ffb74d", "#81c784", "#e57373", "#ffd54f", "#ce93d8"]);
        var it = i % 2 ? sph(g, 0.12, col, c[0] + (k - 1) * 0.2, 0.36, c[1], 8) : box(g, 0.2, 0.12, 0.2, col, c[0] + (k - 1) * 0.22, 0.36, c[1]);
        it.rotation.y = r();
      }
    });
    box(g, 0.04, 0.12, 1.1, "#b71c1c", -0.05, 0.33, 0);
  };
  TPL.drinkBottle = function (g, r, P, o) {
    for (var i = 0; i < (o.many ? 3 : 1); i++) {
      var x = o.many ? (i - 1) * 0.45 : 0, b = grp(g, x, 0, (i % 2) * 0.2);
      cyl(b, 0.2, 0.22, 0.9, o.col || P[0], 0, 0.45, 0, 16);
      cone(b, 0.2, 0.3, o.col || P[0], 0, 1.05, 0, 16);
      cyl(b, 0.07, 0.07, 0.2, o.col || P[0], 0, 1.25, 0, 10);
      cyl(b, 0.08, 0.08, 0.06, o.cap || "#ffd23f", 0, 1.37, 0, 10);
      cyl(b, 0.225, 0.225, 0.3, o.label || "#f8f1e0", 0, 0.5, 0, 16);
    }
  };
  TPL.snackBag = function (g, r, P, o) {
    var b = box(g, 0.9, 1.2, 0.35, o.col || P[0], 0, 0.62, 0); b.rotation.y = 0.2;
    box(g, 0.92, 0.1, 0.36, "#f8f1e0", 0, 1.2, 0).rotation.y = 0.2;
    var star = sph(g, 0.25, o.mark || P[1], 0, 0.7, 0.2, 5); star.scale.z = 0.2; star.rotation.y = 0.2;
    for (var i = 0; i < 4; i++) { var c = sph(g, 0.12, "#ffca28", 0.6 + r() * 0.3, 0.1, (r() - 0.5) * 0.6, 6); c.scale.set(1.5, 0.5, 1); }
  };

  // ---- 地標與地方 ----
  function roofTier(g, w, y, c) {
    var roof = cone(g, w * 0.78, 0.35, c, 0, y, 0, 4); roof.rotation.y = Math.PI / 4; return roof;
  }
  TPL.castle = function (g, r, P, o) {
    box(g, 1.7, 0.4, 1.4, "#9e9e9e", 0, 0.2, 0);
    var tiers = o.tiers || (3 + Math.floor(r() * 2)), roof = o.roof || pick(r, ["#37474f", "#455a64", "#2e7d32", "#263238"]), wall = o.wall || (o.black ? "#212121" : "#fafafa");
    var y = 0.4, w = 1.3;
    for (var i = 0; i < tiers; i++) {
      box(g, w, 0.32, w * 0.8, wall, 0, y + 0.16, 0);
      roofTier(g, w * 1.25, y + 0.45, roof);
      y += 0.5; w *= 0.78;
    }
    cone(g, 0.12, 0.25, "#ffd23f", 0.15, y + 0.15, 0, 6).rotation.z = 0.4;
    cone(g, 0.12, 0.25, "#ffd23f", -0.15, y + 0.15, 0, 6).rotation.z = -0.4;
    if (o.fire) for (var k = 0; k < 7; k++) cone(g, 0.15 + r() * 0.15, 0.6 + r() * 0.5, M(pick(r, ["#ff6d00", "#ffd54f", "#e53935"]), { emissive: "#ff3d00", emissiveIntensity: 0.6 }), (r() - 0.5) * 1.4, 0.7 + r() * 0.8, (r() - 0.5) * 1.0, 6);
  };
  TPL.tower = function (g, r, P, o) {
    var h = o.h || (1.5 + r() * 0.4), col = o.col || pick(r, ["#e53935", "#90a4ae", "#4fc3f7", "#b0bec5"]);
    cyl(g, 0.7, 0.8, 0.12, "#9e9e9e", 0, 0.06, 0, 24);
    if (o.lattice) {
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (s) {
        var leg = cyl(g, 0.03, 0.05, h, col, s[0] * 0.25, h / 2, s[1] * 0.25, 6); leg.rotation.z = s[0] * -0.15; leg.rotation.x = s[1] * 0.15;
      });
      box(g, 0.45, 0.08, 0.45, "#fafafa", 0, h * 0.45, 0);
      cyl(g, 0.02, 0.04, 0.6, col, 0, h + 0.25, 0, 6);
    } else if (o.stack) {
      for (var i = 0; i < 8; i++) { var b = cyl(g, 0.32 - i * 0.015, 0.25 - i * 0.015, 0.2, col, 0, 0.2 + i * 0.2, 0, 4); b.rotation.y = Math.PI / 4; }
      cyl(g, 0.02, 0.03, 0.6, "#fafafa", 0, 2.0, 0, 6);
    } else {
      cyl(g, 0.12, 0.2, h, col, 0, h / 2, 0, 12);
      torus(g, 0.25, 0.08, "#fafafa", 0, h * 0.62, 0).rotation.x = Math.PI / 2;
      torus(g, 0.2, 0.06, "#fafafa", 0, h * 0.82, 0).rotation.x = Math.PI / 2;
      cyl(g, 0.02, 0.05, 0.6, "#fafafa", 0, h + 0.3, 0, 6);
    }
    for (var k = 0; k < 5; k++) box(g, 0.25, 0.3 + r() * 0.5, 0.25, pick(r, ["#90a4ae", "#b0bec5", "#78909c"]), Math.cos(k * 1.3) * 0.6, 0.25, Math.sin(k * 1.3) * 0.5);
  };
  TPL.shrine = function (g, r, P, o) {
    box(g, 1.8, 0.06, 1.4, "#bdbdbd", 0, 0.03, 0);
    var n = o.many ? 4 : 1;
    for (var i = 0; i < n; i++) {
      var t = grp(g, 0, 0, (i - (n - 1) / 2) * 0.35 - (o.many ? 0 : 0.3)), red = o.col || "#e2423f";
      cyl(t, 0.05, 0.06, 1.0, red, -0.45, 0.5, 0, 10); cyl(t, 0.05, 0.06, 1.0, red, 0.45, 0.5, 0, 10);
      box(t, 1.25, 0.08, 0.1, "#212121", 0, 1.05, 0); box(t, 1.05, 0.06, 0.08, red, 0, 0.88, 0);
    }
    if (!o.many) {
      var hall = grp(g, 0, 0, 0.35);
      box(hall, 0.9, 0.45, 0.55, "#8d6e63", 0, 0.28, 0);
      var roof = cone(hall, 0.85, 0.4, o.roof || "#455a64", 0, 0.7, 0, 4); roof.rotation.y = Math.PI / 4; roof.scale.z = 0.7;
      if (o.gold) roof.material = M("#ffd23f", { metalness: 0.6, roughness: 0.3 });
    }
  };
  TPL.pagoda = function (g, r, P, o) {
    box(g, 1.2, 0.15, 1.2, "#9e9e9e", 0, 0.075, 0);
    var tiers = o.tiers || 5, y = 0.15;
    for (var i = 0; i < tiers; i++) {
      var w = 0.7 - i * 0.07;
      box(g, w, 0.22, w, o.gold ? "#ffd23f" : "#8d4b2a", 0, y + 0.11, 0);
      var rf = cone(g, w * 1.05, 0.18, "#37474f", 0, y + 0.3, 0, 4); rf.rotation.y = Math.PI / 4;
      y += 0.32;
    }
    cyl(g, 0.02, 0.03, 0.5, "#ffd23f", 0, y + 0.2, 0, 6);
  };
  TPL.onsen = function (g, r, P) {
    var pool = cyl(g, 0.9, 0.9, 0.2, "#9e9e9e", 0, 0.1, 0, 10);
    cyl(g, 0.78, 0.78, 0.05, M("#4fc3f7", { transparent: true, opacity: 0.85 }), 0, 0.2, 0, 24);
    for (var i = 0; i < 10; i++) { var rk = add(g, new T.DodecahedronGeometry(0.15 + r() * 0.1, 0), "#78909c", Math.cos(i * 0.63) * 0.9, 0.25, Math.sin(i * 0.63) * 0.9); rk.scale.y = 0.7; }
    for (var k = 0; k < 4; k++) { var st = sph(g, 0.18 + k * 0.03, M("#ffffff", { transparent: true, opacity: 0.45 }), (k % 2 - 0.5) * 0.4, 0.5 + k * 0.25, 0, 8); st.castShadow = false; }
    sph(g, 0.16, "#ffd8b0", 0.3, 0.3, 0.1, 10);
    box(g, 0.25, 0.05, 0.15, "#fafafa", 0.3, 0.47, 0.1);
    var mk = add(g, new T.TorusGeometry(0.18, 0.04, 6, 16, Math.PI), "#e2423f", -0.4, 1.4, 0); mk.rotation.z = Math.PI;
  };
  TPL.mountain = function (g, r, P, o) {
    var h = o.h || (1.3 + r() * 0.4);
    cone(g, 0.95, h, o.col || pick(r, ["#558b2f", "#6d4c41", "#455a64", "#7cb342"]), 0, h / 2, 0, 9);
    if (o.snow !== false) cone(g, 0.32, h * 0.33, "#fafafa", 0, h * 0.84, 0, 9);
    cone(g, 0.55, h * 0.6, pick(r, ["#689f38", "#5d4037"]), 0.65, h * 0.3, 0.3, 8);
    if (o.volcano) { cyl(g, 0.15, 0.2, 0.1, "#e53935", 0, h + 0.02, 0); for (var i = 0; i < 3; i++) sph(g, 0.2 + i * 0.07, M("#9e9e9e", { transparent: true, opacity: 0.6 }), i * 0.12, h + 0.3 + i * 0.25, 0, 8); }
    for (var k = 0; k < 6; k++) cone(g, 0.12, 0.35, "#2e7d32", (r() - 0.5) * 1.8, 0.17, 0.6 + r() * 0.3, 6);
  };
  TPL.lake = function (g, r, P, o) {
    var w = cyl(g, 1.0, 1.0, 0.08, M(o.col || "#29b6f6", { transparent: true, opacity: 0.9, roughness: 0.15 }), 0, 0.04, 0, 28);
    for (var i = 0; i < 12; i++) { var rk = add(g, new T.DodecahedronGeometry(0.12 + r() * 0.08, 0), "#8d6e63", Math.cos(i * 0.52) * 1.0, 0.08, Math.sin(i * 0.52) * 1.0); rk.scale.y = 0.6; }
    if (o.island) { var is = sph(g, 0.4, "#c5a46e", 0.2, 0, 0.1); is.scale.y = 0.4; var trunk = cyl(g, 0.04, 0.06, 0.7, "#8d6e63", 0.25, 0.45, 0.1, 6); trunk.rotation.z = -0.2; for (var k = 0; k < 5; k++) { var lf = sph(g, 0.3, "#43a047", 0.32 + Math.cos(k * 1.25) * 0.22, 0.82, 0.1 + Math.sin(k * 1.25) * 0.22, 6); lf.scale.y = 0.25; } }
    else if (o.falls) { box(g, 1.2, 1.4, 0.4, "#6d4c41", 0, 0.7, -0.8); box(g, 0.4, 1.3, 0.05, M("#e1f5fe", { transparent: true, opacity: 0.85 }), 0, 0.68, -0.58); }
    else if (o.ice) { for (var j = 0; j < 6; j++) box(g, 0.4, 0.08, 0.3, "#fafafa", (r() - 0.5) * 1.2, 0.1, (r() - 0.5) * 1.2).rotation.y = r() * 3; }
    else { var boat = box(g, 0.5, 0.12, 0.2, "#8d4b2a", -0.2, 0.12, 0.2); boat.rotation.y = 0.6; cone(g, 0.18, 0.4, "#fafafa", -0.2, 0.38, 0.2, 3); cone(g, 0.6, 0.9, "#558b2f", 0.4, 0.45, -0.55, 8); }
  };
  TPL.bridge = function (g, r, P, o) {
    box(g, 2.0, 0.06, 0.9, M("#29b6f6", { transparent: true, opacity: 0.85 }), 0, 0.03, 0);
    var col = o.col || pick(r, ["#e53935", "#fafafa", "#b0bec5"]);
    box(g, 2.0, 0.08, 0.3, col, 0, 0.5, 0);
    [-0.6, 0.6].forEach(function (x) { box(g, 0.12, 1.3, 0.12, col, x, 0.65, -0.12); box(g, 0.12, 1.3, 0.12, col, x, 0.65, 0.12); });
    for (var i = 0; i < 12; i++) { var c = box(g, 0.02, 0.02, 0.02, "#424242", -1 + i * 0.18, 0.55 + Math.abs(Math.cos((i / 11) * Math.PI)) * 0.7, 0); c.scale.y = 1; }
    var cable = torus(g, 0.6, 0.015, "#424242", 0, 1.25, 0, Math.PI); cable.rotation.z = Math.PI; cable.scale.y = 0.9;
  };
  TPL.festival = function (g, r, P, o) {
    var cart = box(g, 1.4, 0.3, 0.8, "#5d4037", 0, 0.3, 0);
    [-0.5, 0.5].forEach(function (x) { [-0.42, 0.42].forEach(function (z) { torus(g, 0.16, 0.04, "#3e2723", x, 0.16, z).rotation.y = 0; }); });
    if (o.lanterns) {
      cyl(g, 0.03, 0.03, 1.6, "#d7b07a", 0, 1.1, 0, 6);
      for (var i = 0; i < 9; i++) { var lv = Math.floor(i / 3), x = (i % 3 - 1) * (0.35 - lv * 0.08); sph(g, 0.09, M("#ffb300", { emissive: "#ff6f00", emissiveIntensity: 0.6 }), x, 1.2 + lv * 0.3, 0, 8).scale.y = 1.3; }
    } else {
      var fig = box(g, 1.1, 0.9, 0.6, M(P[0], { emissive: P[0], emissiveIntensity: 0.25 }), 0, 0.95, 0);
      sph(g, 0.3, M("#ffd8b0", { emissive: "#ffb74d", emissiveIntensity: 0.3 }), 0, 1.6, 0);
      box(g, 0.5, 0.08, 0.08, "#1b1b1b", 0, 1.68, 0.27);
      for (var k = 0; k < 6; k++) box(g, 0.12, 0.3, 0.02, pick(r, ["#e53935", "#ffd23f", "#2c6cff"]), -0.5 + k * 0.2, 0.55, 0.31);
    }
  };
  TPL.street = function (g, r, P, o) {
    box(g, 2.0, 0.04, 1.2, "#bcaaa4", 0, 0.02, 0);
    for (var i = 0; i < 3; i++) {
      var s = grp(g, (i - 1) * 0.65, 0, i % 2 ? -0.25 : 0.1);
      box(s, 0.55, 0.45, 0.45, pick(r, ["#8d6e63", "#a1887f", "#5d4037"]), 0, 0.225, 0);
      var aw = box(s, 0.62, 0.05, 0.35, pick(r, ["#e53935", "#ffd23f", "#2c6cff", "#43a047"]), 0, 0.55, 0.15); aw.rotation.x = 0.35;
      box(s, 0.55, 0.12, 0.08, "#f8f1e0", 0, 0.68, 0.22);
    }
    for (var k = 0; k < 6; k++) { var l = sph(g, 0.08, M("#e53935", { emissive: "#d50000", emissiveIntensity: 0.5 }), -0.9 + k * 0.36, 1.0 + Math.sin(k) * 0.05, 0.45, 8); l.scale.y = 1.3; }
    cyl(g, 0.01, 0.01, 2.0, "#424242", 0, 1.05, 0.45, 4).rotation.z = Math.PI / 2;
  };
  TPL.park = function (g, r, P, o) {
    var gr = cyl(g, 1.0, 1.0, 0.1, "#7cb342", 0, 0.05, 0, 24);
    for (var i = 0; i < 4; i++) {
      var x = Math.cos(i * 1.6 + 0.4) * 0.65, z = Math.sin(i * 1.6 + 0.4) * 0.6;
      cyl(g, 0.05, 0.07, 0.5, "#6d4c41", x, 0.35, z, 6);
      sph(g, 0.3, o.blossom ? pick(r, ["#f8bbd0", "#f48fb1"]) : pick(r, ["#43a047", "#66bb6a", "#2e7d32"]), x, 0.75, z, 8);
    }
    if (o.animal) { var a = grp(g, 0, 0.1, 0); var b = sph(a, 0.25, o.animal, 0, 0.25, 0, 10); b.scale.x = 1.4; sph(a, 0.16, o.animal, 0.32, 0.4, 0, 10); [-0.15, 0.15].forEach(function (x) { cyl(a, 0.04, 0.04, 0.2, o.animal, x, 0.08, 0.1, 6); cyl(a, 0.04, 0.04, 0.2, o.animal, x, 0.08, -0.1, 6); }); }
    else if (o.flowers) for (var k = 0; k < 30; k++) sph(g, 0.05, pick(r, ["#e53935", "#ffd23f", "#ab47bc", "#2c6cff", "#fafafa"]), (r() - 0.5) * 1.6, 0.14, (r() - 0.5) * 1.6, 6);
    else { box(g, 0.5, 0.06, 0.15, "#8d6e63", 0, 0.3, 0); box(g, 0.04, 0.2, 0.15, "#424242", -0.2, 0.2, 0); box(g, 0.04, 0.2, 0.15, "#424242", 0.2, 0.2, 0); }
  };
  TPL.museum = function (g, r, P, o) {
    box(g, 1.8, 0.15, 1.1, "#e0e0e0", 0, 0.075, 0);
    box(g, 1.6, 0.12, 0.95, "#eeeeee", 0, 0.21, 0);
    for (var i = 0; i < 6; i++) cyl(g, 0.07, 0.08, 0.9, "#fafafa", -0.65 + i * 0.26, 0.72, 0.35, 10);
    box(g, 1.6, 0.8, 0.5, o.col || "#d7ccc8", 0, 0.67, -0.15);
    var roof = cone(g, 1.0, 0.45, o.roof || "#b0bec5", 0, 1.38, 0.05, 3); roof.rotation.y = Math.PI / 2; roof.scale.set(1, 1, 1.6);
    if (o.mod) { roof.visible = false; var c = sph(g, 0.6, M("#81d4fa", { transparent: true, opacity: 0.6 }), 0, 1.15, 0, 16); c.scale.y = 0.6; }
  };
  TPL.ferris = function (g, r, P) {
    box(g, 1.8, 0.08, 0.9, "#bdbdbd", 0, 0.04, 0);
    [-0.25, 0.25].forEach(function (z) { var l1 = box(g, 0.08, 1.2, 0.08, "#fafafa", -0.25, 0.6, z); l1.rotation.z = -0.35; var l2 = box(g, 0.08, 1.2, 0.08, "#fafafa", 0.25, 0.6, z); l2.rotation.z = 0.35; });
    var wheel = grp(g, 0, 1.1, 0);
    torus(wheel, 0.75, 0.035, P[0], 0, 0, 0);
    for (var i = 0; i < 10; i++) {
      var a = i / 10 * Math.PI * 2;
      var sp = box(wheel, 0.02, 0.75, 0.02, "#fafafa", Math.cos(a) * 0.37, Math.sin(a) * 0.37, 0); sp.rotation.z = a - Math.PI / 2;
      box(wheel, 0.16, 0.16, 0.16, pick(r, ["#e53935", "#ffd23f", "#2c6cff", "#43a047", "#ff4f7b"]), Math.cos(a) * 0.78, Math.sin(a) * 0.78 - 0.1, 0);
    }
    cone(g, 0.3, 0.6, P[1], 0.75, 0.3, 0.25, 6); cone(g, 0.25, 0.5, P[2], -0.75, 0.25, 0.25, 6);
  };
  TPL.city = function (g, r, P, o) {
    box(g, 2.0, 0.05, 1.4, "#9e9e9e", 0, 0.025, 0);
    for (var i = 0; i < 9; i++) {
      var h = 0.4 + r() * 1.2, x = ((i % 3) - 1) * 0.6 + (r() - 0.5) * 0.15, z = (Math.floor(i / 3) - 1) * 0.42;
      box(g, 0.38, h, 0.32, pick(r, ["#90a4ae", "#b0bec5", "#78909c", "#cfd8dc", P[1]]), x, h / 2, z);
      for (var w = 0; w < 3; w++) box(g, 0.3, 0.04, 0.33, M("#fff59d", { emissive: "#ffd54f", emissiveIntensity: 0.4 }), x, h * (0.3 + w * 0.22), z);
    }
    if (o.sign) for (var k = 0; k < 4; k++) box(g, 0.15, 0.35, 0.03, M(pick(r, ["#ff4f7b", "#2c6cff", "#ffd23f", "#18b96b"]), { emissive: "#ffffff", emissiveIntensity: 0.2 }), -0.8 + k * 0.5, 0.6, 0.72);
  };
  TPL.house = function (g, r, P, o) {
    var st = o.style || "villa", wall = o.wall || pick(r, ["#fafafa", "#ffe0b2", "#d7ccc8", "#b3e5fc"]), roof = o.roof || pick(r, ["#e53935", "#455a64", "#6d4c41", "#2e7d32"]);
    cyl(g, 1.0, 1.0, 0.08, "#7cb342", 0, 0.04, 0, 24);
    if (st === "tower") {
      box(g, 0.8, 1.7, 0.7, "#90a4ae", 0, 0.93, 0);
      for (var i = 0; i < 6; i++) box(g, 0.82, 0.05, 0.72, M("#b3e5fc", { emissive: "#4fc3f7", emissiveIntensity: 0.3 }), 0, 0.3 + i * 0.27, 0);
      if (o.garden) for (var k = 0; k < 5; k++) sph(g, 0.12, "#43a047", (r() - 0.5) * 0.6, 1.85, (r() - 0.5) * 0.5, 6);
    } else if (st === "dome") {
      var d = sph(g, 0.8, M("#e1f5fe", { transparent: true, opacity: 0.55, roughness: 0.1 }), 0, 0.08, 0, 20); d.scale.y = 0.9;
      box(g, 0.4, 0.4, 0.4, wall, 0, 0.28, 0);
      for (var j = 0; j < 4; j++) sph(g, 0.08, "#43a047", Math.cos(j * 1.5) * 0.4, 0.2, Math.sin(j * 1.5) * 0.4, 6);
    } else if (st === "castle") {
      box(g, 1.1, 0.8, 0.8, "#bcaaa4", 0, 0.48, 0);
      [[-0.55, -0.4], [0.55, -0.4], [-0.55, 0.4], [0.55, 0.4]].forEach(function (p) { cyl(g, 0.18, 0.18, 1.2, "#a1887f", p[0], 0.68, p[1], 10); cone(g, 0.22, 0.4, roof, p[0], 1.48, p[1], 10); });
    } else if (st === "tree") {
      cyl(g, 0.18, 0.28, 1.4, "#6d4c41", 0, 0.75, 0, 8);
      sph(g, 0.65, "#43a047", 0, 1.55, 0, 10);
      box(g, 0.6, 0.4, 0.5, "#a1887f", 0.25, 1.05, 0.25);
      var rf = cone(g, 0.5, 0.3, "#5d4037", 0.25, 1.4, 0.25, 4); rf.rotation.y = Math.PI / 4;
    } else if (st === "mushroom") {
      cyl(g, 0.35, 0.45, 0.8, "#fff8e1", 0, 0.48, 0, 14);
      var cap = sph(g, 0.75, "#e53935", 0, 0.9, 0, 16); cap.scale.y = 0.6;
      for (var q = 0; q < 6; q++) sph(g, 0.1, "#fafafa", Math.cos(q) * 0.5, 1.2, Math.sin(q) * 0.5, 6);
      box(g, 0.2, 0.32, 0.05, "#8d6e63", 0, 0.24, 0.42);
    } else if (st === "lighthouse") {
      cyl(g, 0.22, 0.35, 1.5, "#fafafa", 0, 0.83, 0, 14);
      for (var s = 0; s < 3; s++) cyl(g, 0.3 - s * 0.04, 0.32 - s * 0.04, 0.2, "#e53935", 0, 0.35 + s * 0.45, 0, 14);
      cyl(g, 0.24, 0.24, 0.25, M("#fff59d", { emissive: "#ffd54f", emissiveIntensity: 0.8 }), 0, 1.7, 0, 12);
      cone(g, 0.28, 0.25, "#212121", 0, 1.95, 0, 12);
    } else if (st === "container") {
      [["#e53935", 0, 0.35], ["#2c6cff", 0.15, 0.82], ["#ffd23f", -0.1, 1.29]].forEach(function (c) { var b = box(g, 1.2, 0.45, 0.5, c[0], c[1], c[2], 0); for (var z = 0; z < 8; z++) box(g, 0.02, 0.43, 0.52, "#455a64", c[1] - 0.55 + z * 0.15, c[2], 0); return b; });
    } else if (st === "igloo") {
      var ig = sph(g, 0.75, M("#e1f5fe", { transparent: true, opacity: 0.6 }), 0, 0.08, 0, 16); ig.scale.y = 0.85;
      for (var a = 0; a < 3; a++) { var au = box(g, 2.0, 0.04, 0.12, M(pick(r, ["#69f0ae", "#b388ff", "#40c4ff"]), { emissive: "#69f0ae", emissiveIntensity: 0.5, transparent: true, opacity: 0.7 }), 0, 1.6 + a * 0.15, -0.6); au.rotation.z = 0.2 - a * 0.15; }
    } else if (st === "machiya") {
      box(g, 1.3, 0.7, 0.8, "#6d4c41", 0, 0.43, 0);
      for (var b = 0; b < 10; b++) box(g, 0.03, 0.6, 0.02, "#3e2723", -0.6 + b * 0.13, 0.4, 0.41);
      var r1 = cone(g, 1.05, 0.45, "#37474f", 0, 1.0, 0, 4); r1.rotation.y = Math.PI / 4; r1.scale.z = 0.75;
      sph(g, 0.1, M("#e53935", { emissive: "#d50000", emissiveIntensity: 0.4 }), 0.45, 0.65, 0.48, 8).scale.y = 1.3;
    } else if (st === "boat") {
      cyl(g, 1.0, 1.0, 0.06, M("#29b6f6", { transparent: true, opacity: 0.85 }), 0, 0.03, 0, 24);
      box(g, 1.0, 0.5, 0.7, wall, 0, 0.45, 0);
      for (var p2 = 0; p2 < 4; p2++) cyl(g, 0.04, 0.04, 0.5, "#8d6e63", -0.4 + p2 * 0.27, 0.2, 0.3, 6);
      var r2 = cone(g, 0.85, 0.4, roof, 0, 0.9, 0, 4); r2.rotation.y = Math.PI / 4;
    } else {
      box(g, 1.1, 0.7, 0.8, wall, 0, 0.43, 0);
      var rr = cone(g, 0.95, 0.55, roof, 0, 1.06, 0, 4); rr.rotation.y = Math.PI / 4; rr.scale.z = 0.8;
      box(g, 0.22, 0.38, 0.04, "#6d4c41", 0, 0.27, 0.41);
      [-0.32, 0.32].forEach(function (x) { box(g, 0.2, 0.2, 0.04, M("#b3e5fc", { emissive: "#4fc3f7", emissiveIntensity: 0.3 }), x, 0.5, 0.41); });
      box(g, 0.15, 0.35, 0.15, "#8d6e63", 0.3, 1.2, -0.1);
      if (o.pool) cyl(g, 0.3, 0.3, 0.04, "#29b6f6", 0.6, 0.1, 0.6, 16);
      if (o.slide) { var sl = box(g, 0.25, 0.03, 1.0, "#ffd23f", 0.75, 0.45, 0.2); sl.rotation.x = 0.8; }
    }
  };
  TPL.train = function (g, r, P, o) {
    box(g, 2.0, 0.05, 0.5, "#6d4c41", 0, 0.025, 0);
    [-0.15, 0.15].forEach(function (z) { box(g, 2.0, 0.04, 0.04, "#9e9e9e", 0, 0.07, z); });
    var col = o.col || pick(r, ["#fafafa", "#43a047", "#2c6cff", "#e2423f"]);
    var body = box(g, 1.3, 0.45, 0.5, col, -0.2, 0.38, 0);
    var nose = sph(g, 0.25, col, 0.45, 0.35, 0, 12); nose.scale.set(o.bullet ? 2.0 : 0.8, 0.9, 1);
    box(g, 1.3, 0.06, 0.51, o.stripe || P[0], -0.2, 0.3, 0);
    for (var i = 0; i < 5; i++) box(g, 0.16, 0.12, 0.52, M("#263238", { metalness: 0.4 }), -0.75 + i * 0.25, 0.48, 0);
    if (o.gondola) { body.visible = false; nose.visible = false; cyl(g, 0.01, 0.01, 2.0, "#424242", 0, 1.6, 0, 4).rotation.z = Math.PI / 2 - 0.2; box(g, 0.5, 0.45, 0.45, col, 0, 1.0, 0); box(g, 0.04, 0.4, 0.04, "#424242", 0, 1.38, 0); }
  };
  TPL.plane = function (g, r, P, o) {
    cyl(g, 0.04, 0.04, 0.6, "#9e9e9e", 0, 0.3, 0, 8);
    var p = grp(g, 0, 0.8, 0); p.rotation.z = 0.12;
    var body = cyl(p, 0.17, 0.17, 1.7, o.col || "#fafafa", 0, 0, 0, 14); body.rotation.z = Math.PI / 2;
    sph(p, 0.17, o.col || "#fafafa", 0.85, 0, 0, 12).scale.x = 1.6;
    box(p, 0.45, 0.04, 1.7, o.wing || P[0], 0.05, -0.05, 0);
    box(p, 0.25, 0.4, 0.04, o.tail || P[0], -0.75, 0.22, 0);
    box(p, 0.2, 0.03, 0.6, o.wing || P[0], -0.75, 0.05, 0);
    [-0.45, 0.45].forEach(function (z) { cyl(p, 0.07, 0.07, 0.25, "#9e9e9e", 0.1, -0.15, z, 10).rotation.z = Math.PI / 2; });
    for (var i = 0; i < 6; i++) box(p, 0.06, 0.05, 0.36, "#263238", 0.55 - i * 0.18, 0.06, 0);
  };
  TPL.car = function (g, r, P, o) {
    box(g, 2.0, 0.04, 1.1, "#616161", 0, 0.02, 0);
    var col = o.col || P[0];
    if (o.bike || o.scooter) {
      var b = grp(g, 0, 0, 0);
      [-0.45, 0.45].forEach(function (x) { torus(b, 0.25, 0.04, "#212121", x, 0.29, 0).rotation.y = 0; });
      if (o.scooter) { box(b, 0.7, 0.18, 0.25, col, 0, 0.4, 0); var fr = box(b, 0.1, 0.6, 0.2, col, 0.35, 0.65, 0); fr.rotation.z = -0.3; box(b, 0.4, 0.1, 0.24, "#212121", -0.15, 0.58, 0); }
      else { var t1 = box(b, 0.9, 0.04, 0.04, col, 0, 0.5, 0); t1.rotation.z = 0.1; var t2 = box(b, 0.04, 0.5, 0.04, col, -0.15, 0.5, 0); t2.rotation.z = 0.2; box(b, 0.25, 0.04, 0.1, "#212121", -0.2, 0.78, 0); box(b, 0.04, 0.04, 0.4, "#212121", 0.4, 0.8, 0); }
      return;
    }
    box(g, 1.5, 0.35, 0.75, col, 0, 0.38, 0);
    var cab = box(g, 0.8, 0.3, 0.68, col, -0.1, 0.68, 0);
    box(g, 0.82, 0.22, 0.7, M("#263238", { metalness: 0.5, roughness: 0.2 }), -0.1, 0.7, 0);
    [-0.5, 0.5].forEach(function (x) { [-0.38, 0.38].forEach(function (z) { var w = cyl(g, 0.17, 0.17, 0.12, "#212121", x, 0.2, z, 14); w.rotation.x = Math.PI / 2; }); });
    [-0.25, 0.25].forEach(function (z) { box(g, 0.04, 0.08, 0.12, M("#fff59d", { emissive: "#ffd54f", emissiveIntensity: 0.6 }), 0.76, 0.42, z); });
    if (o.race) { box(g, 0.25, 0.04, 0.8, "#212121", -0.75, 0.75, 0); box(g, 1.5, 0.02, 0.15, "#fafafa", 0, 0.56, 0); }
  };
  TPL.chip = function (g, r, P, o) {
    var b = box(g, 1.3, 0.12, 1.3, "#2e7d32", 0, 0.06, 0);
    var chip = box(g, 0.75, 0.16, 0.75, "#263238", 0, 0.2, 0);
    box(g, 0.5, 0.02, 0.5, M(o.col || "#b0bec5", { metalness: 0.8, roughness: 0.25 }), 0, 0.29, 0);
    for (var i = 0; i < 8; i++) [-1, 1].forEach(function (s) { box(g, 0.05, 0.03, 0.18, "#ffd23f", -0.35 + i * 0.1, 0.14, s * 0.46); box(g, 0.18, 0.03, 0.05, "#ffd23f", s * 0.46, 0.14, -0.35 + i * 0.1); });
    for (var k = 0; k < 10; k++) box(g, 0.02, 0.01, 0.4 + r() * 0.3, "#ffd23f", (r() - 0.5) * 1.2, 0.125, (r() - 0.5) * 1.2).rotation.y = Math.floor(r() * 2) * Math.PI / 2;
    if (o.laptop) { b.visible = false; chip.visible = false; box(g, 1.4, 0.06, 0.95, "#90a4ae", 0, 0.05, 0.1); var sc = box(g, 1.4, 0.9, 0.05, "#90a4ae", 0, 0.5, -0.38); sc.rotation.x = -0.25; var scr = box(g, 1.25, 0.75, 0.02, M(P[0], { emissive: P[0], emissiveIntensity: 0.4 }), 0, 0.51, -0.35); scr.rotation.x = -0.25; }
  };
  TPL.shop = function (g, r, P, o) {
    box(g, 1.8, 0.05, 1.2, "#bdbdbd", 0, 0.025, 0);
    box(g, 1.5, 0.9, 0.9, "#fafafa", 0, 0.5, -0.1);
    var stripes = o.stripes || [P[0], P[1], P[2]];
    stripes.forEach(function (c, i) { box(g, 1.52, 0.08, 0.92, c, 0, 0.82 - i * 0.09, -0.1); });
    box(g, 1.3, 0.45, 0.02, M("#b3e5fc", { transparent: true, opacity: 0.7, emissive: "#e1f5fe", emissiveIntensity: 0.4 }), 0, 0.3, 0.36);
    box(g, 0.9, 0.22, 0.06, o.sign || P[0], 0, 1.08, 0.3);
    var bag = grp(g, 0.75, 0, 0.5);
    box(bag, 0.3, 0.35, 0.15, o.bag || P[1], 0, 0.2, 0);
    torus(bag, 0.08, 0.015, "#3e2723", 0, 0.4, 0, Math.PI);
  };
  TPL.office = function (g, r, P, o) {
    box(g, 1.6, 0.05, 1.2, "#9e9e9e", 0, 0.025, 0);
    var h = o.h || (1.4 + r() * 0.4), col = o.col || pick(r, ["#90a4ae", "#4fc3f7", "#b0bec5"]);
    box(g, 0.75, h, 0.6, M(col, { metalness: 0.4, roughness: 0.25 }), -0.15, h / 2, 0);
    box(g, 0.5, h * 0.6, 0.45, M("#cfd8dc", { metalness: 0.3 }), 0.5, h * 0.3, 0.1);
    for (var i = 0; i < 7; i++) box(g, 0.77, 0.03, 0.62, M("#e1f5fe", { emissive: "#81d4fa", emissiveIntensity: 0.3 }), -0.15, 0.2 + i * h / 8, 0);
    var logo = sph(g, 0.16, M(o.logo || P[0], { emissive: o.logo || P[0], emissiveIntensity: 0.4 }), -0.15, h - 0.2, 0.31, 12); logo.scale.z = 0.25;
    if (o.factory) { [0.45, 0.7].forEach(function (x) { cyl(g, 0.07, 0.09, 1.1, "#8d6e63", x, 0.55, -0.35, 10); sph(g, 0.15, M("#eceff1", { transparent: true, opacity: 0.6 }), x, 1.25, -0.35, 8); }); }
  };
  TPL.product = function (g, r, P, o) {
    if (o.kind === "camera") {
      box(g, 1.1, 0.6, 0.45, "#263238", 0, 0.4, 0); var lens = cyl(g, 0.24, 0.26, 0.4, "#37474f", 0, 0.4, 0.4, 20); lens.rotation.x = Math.PI / 2;
      cyl(g, 0.17, 0.17, 0.02, M("#4fc3f7", { metalness: 0.6, roughness: 0.1 }), 0, 0.4, 0.61, 20).rotation.x = Math.PI / 2;
      box(g, 0.2, 0.1, 0.2, "#e53935", 0.35, 0.75, 0);
    } else if (o.kind === "tv") {
      box(g, 1.7, 1.0, 0.08, "#212121", 0, 0.75, 0); box(g, 1.6, 0.9, 0.02, M(P[0], { emissive: P[2], emissiveIntensity: 0.35 }), 0, 0.75, 0.05); box(g, 0.5, 0.05, 0.3, "#212121", 0, 0.03, 0); box(g, 0.1, 0.25, 0.1, "#212121", 0, 0.15, 0);
    } else if (o.kind === "piano") {
      box(g, 1.5, 0.6, 0.6, "#1b1b1b", 0, 0.55, 0); box(g, 1.5, 0.05, 0.25, "#fafafa", 0, 0.62, 0.4);
      for (var i = 0; i < 10; i++) box(g, 0.05, 0.05, 0.15, "#1b1b1b", -0.65 + i * 0.15, 0.66, 0.36);
      [-0.65, 0.65].forEach(function (x) { box(g, 0.08, 0.25, 0.08, "#1b1b1b", x, 0.12, 0.3); });
    } else if (o.kind === "cosmetic") {
      cyl(g, 0.25, 0.3, 0.8, M(o.col || "#e91e63", { metalness: 0.3, roughness: 0.2 }), -0.25, 0.4, 0, 16); sph(g, 0.22, "#ffd23f", -0.25, 0.9, 0, 12);
      cyl(g, 0.12, 0.12, 0.6, "#fafafa", 0.35, 0.3, 0.1, 12); cyl(g, 0.1, 0.12, 0.2, "#e53935", 0.35, 0.7, 0.1, 12);
    } else if (o.kind === "phone") {
      var ph = box(g, 0.6, 1.15, 0.08, "#212121", 0, 0.65, 0); ph.rotation.x = -0.2; var sc = box(g, 0.54, 1.0, 0.02, M(P[2], { emissive: P[0], emissiveIntensity: 0.4 }), 0, 0.66, 0.05); sc.rotation.x = -0.2; box(g, 0.6, 0.05, 0.4, "#9e9e9e", 0, 0.025, 0.1);
    } else {
      var bx = box(g, 1.0, 0.8, 0.8, o.col || P[0], 0, 0.4, 0); bx.rotation.y = 0.3;
      box(g, 1.02, 0.15, 0.82, P[1], 0, 0.6, 0).rotation.y = 0.3; box(g, 0.15, 0.82, 0.82, P[1], 0, 0.4, 0).rotation.y = 0.3;
      torus(g, 0.15, 0.04, P[1], 0, 0.88, 0).rotation.y = 0.3;
    }
  };
  TPL.controller = function (g, r, P, o) {
    var c = grp(g, 0, 0.5, 0); c.rotation.x = -0.35;
    box(c, 1.2, 0.18, 0.55, o.col || pick(r, ["#424242", "#e53935", "#2c6cff", "#fafafa"]), 0, 0, 0);
    [-1, 1].forEach(function (s) { var gr = sph(c, 0.3, o.col || "#424242", s * 0.55, -0.05, 0.18, 12); gr.scale.set(1, 0.5, 1.2); });
    box(c, 0.1, 0.05, 0.3, "#212121", -0.38, 0.12, 0); box(c, 0.3, 0.05, 0.1, "#212121", -0.38, 0.12, 0);
    [["#e53935", 0.35, -0.08], ["#ffd23f", 0.45, 0.02], ["#18b96b", 0.35, 0.12], ["#2c6cff", 0.25, 0.02]].forEach(function (b) { cyl(c, 0.045, 0.045, 0.05, b[0], b[1], 0.12, b[2], 10); });
    cyl(g, 0.3, 0.4, 0.2, "#9e9e9e", 0, 0.1, 0, 16);
  };

  // ---- 動漫、文化、運動 ----
  TPL.manga = function (g, r, P, o) {
    for (var i = 0; i < 4; i++) {
      var b = box(g, 0.75, 0.16, 1.05, i === 3 ? P[0] : pick(r, [P[1], P[2], "#fafafa", "#ffd23f"]), (r() - 0.5) * 0.1, 0.08 + i * 0.17, 0);
      b.rotation.y = (r() - 0.5) * 0.3;
      box(g, 0.7, 0.14, 1.0, "#f8f1e0", (r() - 0.5) * 0.05 + 0.03, 0.08 + i * 0.17, 0.02).rotation.y = b.rotation.y;
    }
    var ic = o.icon || "star";
    var top = grp(g, 0, 0.78, 0);
    if (ic === "star") { var s = sph(top, 0.3, M(P[2], { emissive: P[2], emissiveIntensity: 0.3 }), 0, 0.3, 0, 5); s.scale.z = 0.25; }
    else if (ic === "ball") { sph(top, 0.32, o.col || "#ff9800", 0, 0.3, 0, 18); for (var k = 0; k < (o.stars || 4); k++) sph(top, 0.05, "#e53935", Math.cos(k * 1.6) * 0.12, 0.3 + Math.sin(k * 1.6) * 0.12, 0.3, 5); }
    else if (ic === "hat") { var brim = cyl(top, 0.55, 0.55, 0.04, "#ffd54f", 0, 0.05, 0, 24); cyl(top, 0.3, 0.32, 0.3, "#ffd54f", 0, 0.22, 0, 20); cyl(top, 0.33, 0.33, 0.08, "#e53935", 0, 0.12, 0, 20); }
    else if (ic === "sword") { var bl = box(top, 0.06, 1.0, 0.03, M("#eceff1", { metalness: 0.8, roughness: 0.2 }), 0, 0.7, 0); box(top, 0.25, 0.05, 0.25, o.col || "#212121", 0, 0.2, 0); box(top, 0.07, 0.3, 0.07, o.col || "#212121", 0, 0.03, 0); top.rotation.z = 0.35; }
    else if (ic === "ring") { torus(top, 0.35, 0.06, M("#ffd23f", { emissive: "#ffb300", emissiveIntensity: 0.6, metalness: 0.7 }), 0, 0.4, 0).rotation.x = 0.3; }
    else if (ic === "mecha") { box(top, 0.4, 0.45, 0.3, o.col || "#7e57c2", 0, 0.35, 0); box(top, 0.25, 0.2, 0.25, o.col || "#7e57c2", 0, 0.7, 0); cone(top, 0.05, 0.25, "#ffd23f", 0, 0.92, 0, 4); [-1, 1].forEach(function (s2) { box(top, 0.12, 0.4, 0.12, "#fafafa", s2 * 0.28, 0.35, 0); box(top, 0.14, 0.35, 0.14, o.col || "#7e57c2", s2 * 0.1, 0.0, 0); }); sph(top, 0.05, M("#76ff03", { emissive: "#76ff03" }), 0.06, 0.74, 0.13, 6); }
    else if (ic === "slime") { var sl = sph(top, 0.32, o.col || "#29b6f6", 0, 0.25, 0, 16); sl.scale.y = 0.8; cone(top, 0.12, 0.2, o.col || "#29b6f6", 0, 0.58, 0, 10); [-0.1, 0.1].forEach(function (x) { sph(top, 0.05, "#1b1b1b", x, 0.32, 0.27, 6); }); box(top, 0.18, 0.03, 0.02, "#e53935", 0, 0.2, 0.3); }
    else if (ic === "lens") { torus(top, 0.25, 0.04, "#6d4c41", 0, 0.45, 0); cyl(top, 0.23, 0.23, 0.02, M("#b3e5fc", { transparent: true, opacity: 0.5 }), 0, 0.45, 0).rotation.x = Math.PI / 2; box(top, 0.08, 0.45, 0.08, "#6d4c41", 0.2, 0.08, 0).rotation.z = 0.6; }
    else if (ic === "wall") { for (var w = 0; w < 6; w++) box(top, 0.25, 0.18, 0.3, "#bcaaa4", -0.3 + (w % 3) * 0.3, 0.12 + Math.floor(w / 3) * 0.2, 0); var gi = sph(top, 0.2, "#e57373", 0.15, 0.55, -0.05, 10); gi.scale.y = 1.2; }
    else if (ic === "crystal") { var cr = add(top, new T.OctahedronGeometry(0.32, 0), M(o.col || "#4fc3f7", { transparent: true, opacity: 0.8, emissive: "#29b6f6", emissiveIntensity: 0.4 }), 0, 0.45, 0); cr.scale.y = 1.6; }
    else if (ic === "ink") { for (var p = 0; p < 7; p++) { var dot = sph(top, 0.1 + r() * 0.12, o.col || pick(r, ["#ff4081", "#76ff03", "#ffd23f"]), (r() - 0.5) * 0.6, 0.1 + r() * 0.3, (r() - 0.5) * 0.4, 8); dot.scale.y = 0.5; } }
    else if (ic === "leaf") { var lf = sph(top, 0.3, "#43a047", 0, 0.35, 0, 10); lf.scale.set(1, 1.4, 0.2); box(top, 0.03, 0.5, 0.03, "#6d4c41", 0, 0.1, 0); }
    else if (ic === "mushroom") { cyl(top, 0.14, 0.18, 0.25, "#fff8e1", 0, 0.15, 0, 12); var cap = sph(top, 0.32, o.col || "#e53935", 0, 0.32, 0, 14); cap.scale.y = 0.65; for (var q = 0; q < 4; q++) sph(top, 0.07, "#fafafa", Math.cos(q * 1.6) * 0.2, 0.45, Math.sin(q * 1.6) * 0.2, 6); }
    else if (ic === "kunai") { var kb = cone(top, 0.12, 0.5, M("#90a4ae", { metalness: 0.7 }), 0, 0.55, 0, 4); box(top, 0.05, 0.3, 0.05, "#212121", 0, 0.15, 0); torus(top, 0.06, 0.02, "#212121", 0, -0.05, 0); top.rotation.z = 0.4; }
    else if (ic === "ballV") { sph(top, 0.3, "#fafafa", 0, 0.32, 0, 16); torus(top, 0.3, 0.02, o.col || "#2c6cff", 0, 0.32, 0).rotation.y = 0.5; torus(top, 0.3, 0.02, "#ffd23f", 0, 0.32, 0).rotation.x = 1.2; }
    else if (ic === "heart") { [-0.12, 0.12].forEach(function (x) { sph(top, 0.18, o.col || "#ff4f7b", x, 0.42, 0, 12); }); var tip = cone(top, 0.27, 0.35, o.col || "#ff4f7b", 0, 0.2, 0, 12); tip.rotation.z = Math.PI; }
    else if (ic === "bell") { sph(top, 0.25, "#ffd23f", 0, 0.3, 0, 14); box(top, 0.5, 0.06, 0.06, "#e53935", 0, 0.52, 0); }
    else { var s3 = sph(top, 0.3, P[2], 0, 0.3, 0, 5); s3.scale.z = 0.25; }
  };
  TPL.ball = function (g, r, P, o) {
    var k = o.kind || "soccer";
    cyl(g, 0.55, 0.65, 0.12, "#b08d3c", 0, 0.06, 0, 20);
    var b = grp(g, 0, 0.55, 0);
    if (k === "soccer") { sph(b, 0.42, "#fafafa", 0, 0, 0, 16); for (var i = 0; i < 8; i++) { var p = add(b, new T.DodecahedronGeometry(0.11, 0), "#212121", Math.cos(i * 0.8) * 0.36, Math.sin(i * 1.7) * 0.25, Math.sin(i * 0.8) * 0.36); p.lookAt(0, 0, 0); } }
    else if (k === "baseball") { sph(b, 0.38, "#fafafa", 0, 0, 0, 16); torus(b, 0.3, 0.015, "#e53935", 0.1, 0, 0).rotation.y = 1.2; torus(b, 0.3, 0.015, "#e53935", -0.1, 0, 0).rotation.y = 1.9; var bat = cyl(g, 0.05, 0.1, 1.4, "#d7b07a", 0.5, 0.75, 0, 10); bat.rotation.z = 0.5; }
    else if (k === "basket") { sph(b, 0.42, "#ef6c00", 0, 0, 0, 16); torus(b, 0.42, 0.012, "#212121", 0, 0, 0); torus(b, 0.42, 0.012, "#212121", 0, 0, 0).rotation.y = Math.PI / 2; torus(b, 0.42, 0.012, "#212121", 0, 0, 0).rotation.x = Math.PI / 2; }
    else if (k === "volley") { sph(b, 0.4, "#fafafa", 0, 0, 0, 16); torus(b, 0.4, 0.03, "#2c6cff", 0, 0, 0).rotation.y = 0.6; torus(b, 0.4, 0.03, "#ffd23f", 0, 0, 0).rotation.x = 1.0; }
    else if (k === "rugby") { var rb = sph(b, 0.3, "#8d4b2a", 0, 0, 0, 16); rb.scale.x = 1.6; box(b, 0.3, 0.02, 0.02, "#fafafa", 0, 0.3, 0); }
    else if (k === "tennis") { sph(b, 0.18, "#c6ff00", -0.35, -0.2, 0.2, 14); var rk = grp(b, 0.15, 0.1, 0); rk.rotation.z = -0.5; torus(rk, 0.3, 0.04, "#2c6cff", 0, 0.25, 0).rotation.y = Math.PI / 2; cyl(rk, 0.04, 0.04, 0.6, "#212121", 0, -0.3, 0, 8); }
    else if (k === "pingpong") { var pd = cyl(b, 0.3, 0.3, 0.04, "#e53935", 0, 0.1, 0, 20); pd.rotation.x = Math.PI / 2; box(b, 0.08, 0.35, 0.06, "#8d6e63", 0, -0.3, 0); sph(b, 0.07, "#fafafa", 0.35, 0.3, 0.1, 10); }
    else if (k === "shuttle") { sph(b, 0.12, "#fafafa", 0, -0.2, 0, 10); cone(b, 0.25, 0.45, M("#fafafa", { transparent: true, opacity: 0.9 }), 0, 0.12, 0, 16, true); var rq = grp(g, 0.5, 0.5, 0); rq.rotation.z = 0.6; torus(rq, 0.25, 0.03, "#18b96b", 0, 0.35, 0).rotation.y = Math.PI / 2; cyl(rq, 0.03, 0.03, 0.6, "#212121", 0, -0.15, 0, 8); }
    else if (k === "golf") { sph(b, 0.15, "#fafafa", 0, -0.3, 0, 12); cyl(g, 0.02, 0.02, 1.0, "#9e9e9e", 0.35, 0.6, 0, 6).rotation.z = 0.3; box(g, 0.2, 0.08, 0.06, "#9e9e9e", 0.5, 0.14, 0); var flag = box(g, 0.35, 0.2, 0.02, "#e53935", -0.3, 1.1, 0); cyl(g, 0.015, 0.015, 1.1, "#fafafa", -0.48, 0.65, 0, 6); }
  };
  TPL.sportGear = function (g, r, P, o) {
    var k = o.kind;
    cyl(g, 0.55, 0.65, 0.12, "#b08d3c", 0, 0.06, 0, 20);
    if (k === "skate") { var sh = box(g, 0.7, 0.4, 0.3, "#fafafa", 0, 0.45, 0); box(g, 0.3, 0.3, 0.3, "#fafafa", -0.2, 0.75, 0); box(g, 0.9, 0.03, 0.05, M("#cfd8dc", { metalness: 0.9, roughness: 0.2 }), 0, 0.2, 0); }
    else if (k === "ski") { [-0.15, 0.15].forEach(function (z) { var s = box(g, 0.08, 1.6, 0.04, P[0], 0, 0.9, z); s.rotation.z = 0.15; }); [-0.25, 0.25].forEach(function (z) { cyl(g, 0.02, 0.02, 1.2, "#9e9e9e", 0.35, 0.7, z, 6).rotation.z = -0.2; }); }
    else if (k === "board") { var bd = cyl(g, 0.3, 0.3, 0.05, P[0], 0, 0.9, 0, 20); bd.scale.set(1, 1, 5.0); bd.rotation.x = Math.PI / 2; bd.rotation.z = 0.15; }
    else if (k === "skateboard") { var dk = box(g, 0.3, 0.05, 1.1, P[0], 0, 0.45, 0); dk.rotation.x = -0.3; [-0.4, 0.4].forEach(function (z) { [-0.1, 0.1].forEach(function (x) { cyl(g, 0.06, 0.06, 0.05, "#ffd23f", x, 0.35 + z * 0.3, z, 10).rotation.z = Math.PI / 2; }); }); }
    else if (k === "glove") { var gl = sph(g, 0.35, o.col || "#e53935", 0, 0.6, 0, 14); gl.scale.set(1, 1.2, 0.9); sph(g, 0.15, o.col || "#e53935", 0.28, 0.55, 0.1, 10); cyl(g, 0.25, 0.25, 0.25, "#fafafa", 0, 0.25, 0, 14); }
    else if (k === "sumo") { cyl(g, 0.95, 1.0, 0.3, "#c9a46e", 0, 0.15, 0, 24); torus(g, 0.7, 0.04, "#f8f1e0", 0, 0.3, 0).rotation.x = Math.PI / 2; [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s, i) { var tf = cyl(g, 0.12, 0.12, 0.04, ["#18b96b", "#e53935", "#2c6cff", "#fafafa"][i], s[0] * 0.75, 1.6, s[1] * 0.75, 10); cyl(g, 0.02, 0.02, 0.4, ["#18b96b", "#e53935", "#2c6cff", "#fafafa"][i], s[0] * 0.75, 1.4, s[1] * 0.75, 6); }); var rf = cone(g, 1.1, 0.35, "#5d4037", 0, 1.85, 0, 4); rf.rotation.y = Math.PI / 4; }
    else if (k === "kendo") { var sw = box(g, 0.06, 1.4, 0.06, "#d7b07a", 0, 0.8, 0); sw.rotation.z = 0.3; var mn = sph(g, 0.3, "#1a237e", -0.3, 0.45, 0, 12); for (var i = 0; i < 5; i++) box(g, 0.02, 0.35, 0.02, "#b0bec5", -0.3 + (i - 2) * 0.06, 0.45, 0.28); }
    else if (k === "shoe") { var sh2 = box(g, 0.75, 0.25, 0.32, P[0], 0, 0.3, 0); box(g, 0.8, 0.08, 0.34, "#fafafa", 0, 0.16, 0); box(g, 0.3, 0.3, 0.3, P[0], -0.22, 0.5, 0); var bt = cyl(g, 0.05, 0.05, 0.5, P[1], 0.3, 0.75, 0, 10); bt.rotation.z = 0.7; }
    else if (k === "climb") { var wl = box(g, 1.0, 1.4, 0.1, "#78909c", 0, 0.8, -0.2); wl.rotation.x = -0.15; for (var j = 0; j < 9; j++) add(g, new T.DodecahedronGeometry(0.07, 0), pick(r, ["#e53935", "#ffd23f", "#18b96b", "#2c6cff", "#ff4f7b"]), (r() - 0.5) * 0.8, 0.3 + r() * 1.1, -0.12); }
    else if (k === "rings") { [-0.3, 0.3].forEach(function (x) { cyl(g, 0.01, 0.01, 1.0, "#9e9e9e", x, 1.2, 0, 4); torus(g, 0.12, 0.025, "#8d6e63", x, 0.6, 0).rotation.y = Math.PI / 2; }); box(g, 1.0, 0.06, 0.06, "#9e9e9e", 0, 1.7, 0); }
    else if (k === "swim") { cyl(g, 0.7, 0.7, 0.08, M("#4fc3f7", { transparent: true, opacity: 0.8 }), 0, 0.16, 0, 24); [-0.15, 0.15].forEach(function (x) { torus(g, 0.12, 0.035, P[0], x, 0.55, 0); }); box(g, 0.08, 0.03, 0.03, P[0], 0, 0.55, 0); }
    else if (k === "horse") { var hs = torus(g, 0.4, 0.09, M("#b0bec5", { metalness: 0.8, roughness: 0.25 }), 0, 0.6, 0, Math.PI * 1.4); hs.rotation.z = -Math.PI * 0.2; }
    else { var cup = cyl(g, 0.35, 0.15, 0.6, M("#ffd23f", { metalness: 0.8, roughness: 0.25 }), 0, 0.85, 0, 20); cyl(g, 0.08, 0.08, 0.3, M("#ffd23f", { metalness: 0.8 }), 0, 0.42, 0); cyl(g, 0.3, 0.35, 0.15, "#3e2723", 0, 0.2, 0); [-1, 1].forEach(function (s) { torus(g, 0.15, 0.03, M("#ffd23f", { metalness: 0.8 }), s * 0.38, 0.9, 0).rotation.y = 0; }); }
  };
  TPL.mic = function (g, r, P, o) {
    cyl(g, 0.9, 1.0, 0.15, "#212121", 0, 0.075, 0, 24);
    for (var i = 0; i < 6; i++) sph(g, 0.07, M(pick(r, ["#ff4f7b", "#ffd23f", "#40c4ff", "#76ff03"]), { emissive: "#ffffff", emissiveIntensity: 0.4 }), Math.cos(i) * 0.85, 0.18, Math.sin(i) * 0.85, 8);
    cyl(g, 0.04, 0.04, 1.1, "#9e9e9e", 0, 0.7, 0, 8);
    cyl(g, 0.25, 0.25, 0.03, "#212121", 0, 0.16, 0, 16);
    var m = grp(g, 0, 1.25, 0); m.rotation.z = 0.25;
    cyl(m, 0.07, 0.05, 0.4, o.col || "#212121", 0, 0, 0, 12);
    sph(m, 0.12, M("#b0bec5", { metalness: 0.7, roughness: 0.3 }), 0, 0.25, 0, 12);
    for (var k = 0; k < 4; k++) { var note = grp(g, (r() - 0.5) * 1.2, 0.9 + r() * 0.6, (r() - 0.5) * 0.5); sph(note, 0.07, P[k % 3], 0, 0, 0, 8).scale.y = 0.75; box(note, 0.02, 0.25, 0.02, P[k % 3], 0.06, 0.12, 0); }
  };
  TPL.film = function (g, r, P, o) {
    var reel = grp(g, 0, 0.8, 0);
    cyl(reel, 0.55, 0.55, 0.12, "#37474f", 0, 0, 0, 24).rotation.x = Math.PI / 2;
    for (var i = 0; i < 5; i++) { var h = cyl(reel, 0.13, 0.13, 0.14, "#eceff1", Math.cos(i * 1.257) * 0.3, Math.sin(i * 1.257) * 0.3, 0, 12); h.rotation.x = Math.PI / 2; }
    box(g, 0.08, 0.6, 0.08, "#37474f", 0, 0.3, 0);
    var strip = box(g, 1.3, 0.25, 0.02, "#212121", 0.4, 0.12, 0.3); strip.rotation.y = 0.4;
    for (var k = 0; k < 5; k++) box(g, 0.18, 0.15, 0.025, M(P[k % 3], { emissive: P[k % 3], emissiveIntensity: 0.3 }), 0.4 + (k - 2) * 0.24 * Math.cos(0.4), 0.12, 0.3 - (k - 2) * 0.24 * Math.sin(0.4));
    var clap = grp(g, -0.6, 0.12, 0.3); box(clap, 0.5, 0.35, 0.04, "#212121", 0, 0.1, 0); var tp = box(clap, 0.5, 0.08, 0.04, "#fafafa", 0, 0.32, 0); tp.rotation.z = 0.25;
  };
  TPL.toy = function (g, r, P, o) {
    if (o.kind === "capsule") {
      cyl(g, 0.45, 0.5, 0.7, P[0], 0, 0.35, 0, 18); var dome = sph(g, 0.45, M("#e1f5fe", { transparent: true, opacity: 0.5 }), 0, 0.7, 0, 18);
      for (var i = 0; i < 6; i++) { var c = sph(g, 0.12, pick(r, ["#e53935", "#ffd23f", "#2c6cff", "#18b96b"]), (r() - 0.5) * 0.5, 0.75 + r() * 0.2, (r() - 0.5) * 0.5, 10); }
      cyl(g, 0.1, 0.1, 0.05, "#fafafa", 0, 0.35, 0.5, 12).rotation.x = Math.PI / 2;
    } else if (o.kind === "claw") {
      box(g, 1.0, 0.5, 0.8, P[0], 0, 0.25, 0); box(g, 1.0, 0.9, 0.8, M("#e1f5fe", { transparent: true, opacity: 0.35 }), 0, 0.95, 0); box(g, 1.05, 0.12, 0.85, P[0], 0, 1.45, 0);
      for (var k = 0; k < 6; k++) sph(g, 0.13, pick(r, ["#f8bbd0", "#fff59d", "#b3e5fc", "#c5e1a5"]), (r() - 0.5) * 0.7, 0.62, (r() - 0.5) * 0.5, 10);
      cyl(g, 0.01, 0.01, 0.4, "#9e9e9e", 0, 1.2, 0, 4); [-1, 0, 1].forEach(function (s) { var cl = box(g, 0.03, 0.15, 0.03, "#9e9e9e", s * 0.06, 0.95, 0); cl.rotation.z = s * 0.4; });
    } else if (o.kind === "cards") {
      for (var j = 0; j < 5; j++) { var cd = box(g, 0.6, 0.85, 0.02, j === 4 ? M("#ffd23f", { metalness: 0.6, roughness: 0.3 }) : pick(r, [P[0], P[1], P[2]]), (j - 2) * 0.18, 0.55, j * 0.03); cd.rotation.z = (j - 2) * -0.18; }
      box(g, 0.9, 0.08, 0.6, "#3e2723", 0, 0.04, 0);
    } else if (o.kind === "monster") {
      var bd = sph(g, 0.5, o.col || "#455a64", 0, 0.55, 0, 12); bd.scale.set(0.9, 1.2, 0.9); sph(g, 0.3, o.col || "#455a64", 0.25, 1.15, 0, 10);
      for (var q = 0; q < 6; q++) cone(g, 0.08, 0.25, "#cfd8dc", -0.2 - q * 0.02, 0.6 + q * 0.15, 0, 4).rotation.z = 0.8;
      var tail = cone(g, 0.2, 0.9, o.col || "#455a64", -0.6, 0.25, 0, 8); tail.rotation.z = Math.PI / 2 + 0.3;
      sph(g, 0.05, M("#ffeb3b", { emissive: "#ffeb3b" }), 0.45, 1.22, 0.15, 6);
    } else {
      // 布偶（熊、雞蛋、小動物）：依 id 決定顏色與耳朵
      var col = o.col || pick(r, ["#a1887f", "#fafafa", "#fff59d", "#ffccbc"]);
      var body = sph(g, 0.45, col, 0, 0.45, 0, 16); body.scale.y = 0.9;
      var head = sph(g, 0.38, col, 0, 1.05, 0, 16);
      if (o.egg) { head.visible = false; body.scale.set(0.85, 1.25, 0.85); body.position.y = 0.6; cyl(g, 0.38, 0.38, 0.06, "#ffb300", 0, 0.75, 0.05, 20).rotation.x = 0.2; }
      else [-1, 1].forEach(function (s) { sph(g, 0.12, col, s * 0.28, 1.35, 0, 10); });
      [-0.12, 0.12].forEach(function (x) { sph(g, 0.04, "#1b1b1b", x, o.egg ? 0.85 : 1.08, o.egg ? 0.38 : 0.34, 6); });
      sph(g, 0.06, "#ff8a80", -0.22, o.egg ? 0.78 : 0.98, 0.3, 6); sph(g, 0.06, "#ff8a80", 0.22, o.egg ? 0.78 : 0.98, 0.3, 6);
    }
  };
  TPL.battle = function (g, r, P, o) {
    box(g, 1.9, 0.06, 1.4, "#8d6e63", 0, 0.03, 0);
    var cols = [o.a || "#e2423f", o.b || "#2c6cff"];
    for (var i = 0; i < 6; i++) {
      var x = -0.75 + i * 0.3, side = i < 3 ? 0 : 1, z = side ? 0.35 : -0.35;
      cyl(g, 0.02, 0.02, 1.4, "#3e2723", x, 0.7, z, 6);
      box(g, 0.2, 0.6, 0.01, cols[side], x + 0.1, 1.05, z);
      sph(g, 0.05, "#fafafa", x + 0.1, 1.15, z + 0.01, 6);
    }
    if (o.fire) { TPL.castle(grp(g, 0, 0, 0), r, P, { tiers: 2, fire: true, roof: "#3e2723", wall: "#8d6e63" }); }
    else { var hl = grp(g, 0, 0.06, 0); TPL.kabutoOnly(hl, r, P, { crest: pick(r, ["moon", "horn", "sun"]) }); hl.scale.setScalar(0.7); }
  };
  TPL.kabutoOnly = function (g, r, P, o) {
    var bowlM = o.helm || pick(r, ["#212121", "#4e342e", "#1a237e", "#b71c1c"]);
    var h = sph(g, 0.45, M(bowlM, { metalness: 0.4, roughness: 0.4 }), 0, 0.5, 0, 16); h.scale.y = 0.8;
    for (var i = 0; i < 3; i++) { var sk = torus(g, 0.5 + i * 0.06, 0.06, bowlM, 0, 0.32 - i * 0.12, 0, Math.PI * 1.3); sk.rotation.x = Math.PI / 2; sk.rotation.z = Math.PI * 0.85; }
    crest(g, o.crest, 0.85);
  };
  function crest(g, kind, y) {
    var gold = M("#ffd23f", { metalness: 0.7, roughness: 0.25 });
    if (kind === "moon") { var mo = torus(g, 0.35, 0.05, gold, 0, y, 0.25, Math.PI * 0.9); mo.rotation.z = Math.PI * 0.05; }
    else if (kind === "horn") { [-1, 1].forEach(function (s) { var hn = cone(g, 0.06, 0.6, gold, s * 0.2, y + 0.2, 0.2, 6); hn.rotation.z = s * -0.5; }); }
    else if (kind === "antler") { [-1, 1].forEach(function (s) { var a = cyl(g, 0.03, 0.03, 0.6, "#3e2723", s * 0.25, y + 0.2, 0.1, 6); a.rotation.z = s * -0.6; cyl(g, 0.025, 0.025, 0.3, "#3e2723", s * 0.35, y + 0.35, 0.1, 6).rotation.z = s * 0.3; }); }
    else if (kind === "sun") { var sn = cyl(g, 0.22, 0.22, 0.04, gold, 0, y + 0.1, 0.3, 20); sn.rotation.x = Math.PI / 2; }
    else if (kind === "ai") { box(g, 0.25, 0.3, 0.04, gold, 0, y + 0.1, 0.3); }
    else { var fl = box(g, 0.2, 0.35, 0.03, gold, 0, y + 0.12, 0.3); fl.rotation.z = 0.785; }
  }

  // ---- 人物（Q 版）＋動物 ----
  // o：{ gender, hair, outfit, hat, prop, kabuto, crest, skin, animal }
  TPL.figure = function (g, r, P, o) {
    if (o.animal) return animal(g, r, P, o);
    var skin = o.skin || pick(r, SKIN), hairC = o.hairC || pick(r, HAIR), outfit = o.outfit || pick(r, [P[0], P[1], P[2], "#37474f", "#fafafa"]);
    var woman = o.gender === "f";
    cyl(g, 0.6, 0.7, 0.1, "#b08d3c", 0, 0.05, 0, 24);
    // 腳、身體、手
    [-0.12, 0.12].forEach(function (x) { cyl(g, 0.07, 0.08, 0.35, o.pants || "#37474f", x, 0.27, 0, 8); box(g, 0.13, 0.07, 0.2, "#3e2723", x, 0.12, 0.04); });
    var body = woman ? cone(g, 0.36, 0.7, outfit, 0, 0.75, 0, 16) : cyl(g, 0.24, 0.3, 0.55, outfit, 0, 0.7, 0, 14);
    if (o.kabuto) { box(g, 0.62, 0.35, 0.4, M(o.armor || "#b71c1c", { metalness: 0.3 }), 0, 0.72, 0); for (var a = 0; a < 3; a++) box(g, 0.64, 0.03, 0.42, "#ffd23f", 0, 0.6 + a * 0.12, 0); [-1, 1].forEach(function (s) { var sd = box(g, 0.2, 0.25, 0.3, M(o.armor || "#b71c1c", { metalness: 0.3 }), s * 0.38, 0.88, 0); sd.rotation.z = s * 0.4; }); }
    if (o.coat) { box(g, 0.5, 0.5, 0.38, o.coat, 0, 0.72, 0); box(g, 0.1, 0.45, 0.39, outfit, 0, 0.74, 0); }
    var armL = grp(g, -0.3, 0.95, 0), armR = grp(g, 0.3, 0.95, 0);
    [armL, armR].forEach(function (am, i) { var c = cyl(am, 0.06, 0.06, 0.4, o.coat || outfit, 0, -0.18, 0, 8); sph(am, 0.07, skin, 0, -0.4, 0, 8); am.rotation.z = (i ? -1 : 1) * 0.25; });
    armR.rotation.z = -0.9; armR.rotation.x = -0.4;
    // 頭
    var head = grp(g, 0, 1.28, 0);
    sph(head, 0.3, skin, 0, 0, 0, 18);
    [-0.1, 0.1].forEach(function (x) { sph(head, 0.035, "#1b1b1b", x, 0.02, 0.27, 6); });
    sph(head, 0.04, "#ff8a80", -0.17, -0.06, 0.23, 6); sph(head, 0.04, "#ff8a80", 0.17, -0.06, 0.23, 6);
    box(head, 0.1, 0.02, 0.02, "#6d4c41", 0, -0.1, 0.28);
    if (o.glasses) { torus(head, 0.07, 0.012, "#1b1b1b", -0.1, 0.02, 0.29); torus(head, 0.07, 0.012, "#1b1b1b", 0.1, 0.02, 0.29); }
    if (o.kabuto) { var kb = grp(head, 0, -0.32, 0); kb.scale.setScalar(0.85); TPL.kabutoOnly(kb, r, P, { helm: o.helm, crest: o.crest }); }
    else hair(head, r, hairC, o.hairStyle || (woman ? pick(r, ["long", "bob", "bun", "pony"]) : pick(r, ["short", "spiky", "short", "side"])));
    if (o.hat) hat(head, r, o.hat, o.hatC);
    if (o.prop) prop(armR, r, P, o.prop, o.propC);
    if (o.cape) { var cp = box(g, 0.55, 0.75, 0.03, o.cape, 0, 0.7, -0.24); cp.rotation.x = 0.12; }
    if (o.wings) [-1, 1].forEach(function (s) { var w = sph(g, 0.3, M(o.wings, { transparent: true, opacity: 0.8 }), s * 0.32, 1.0, -0.22, 10); w.scale.set(0.5, 1.1, 0.15); w.rotation.z = s * 0.4; });
    if (o.tailC) { var tl = cone(g, 0.12, 0.6, o.tailC, 0, 0.5, -0.3, 8); tl.rotation.x = -1.0; }
  };
  function hair(head, r, c, st) {
    if (st === "bald") return;
    // 髮帽：上半球往後傾，臉露出來
    var top = add(head, new T.SphereGeometry(0.33, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), c, 0, 0.02, -0.02);
    top.rotation.x = -0.55;
    sph(head, 0.3, c, 0, 0.02, -0.08, 12).scale.set(1, 0.95, 0.8);
    if (st === "spiky") for (var i = 0; i < 7; i++) { var sp = cone(head, 0.07, 0.22, c, Math.cos(i) * 0.18, 0.28, Math.sin(i) * 0.15 - 0.05, 5); sp.rotation.set(Math.sin(i) * 0.5, 0, -Math.cos(i) * 0.5); }
    if (st === "side") { var s = box(head, 0.35, 0.08, 0.2, c, 0.06, 0.22, 0.12); s.rotation.z = -0.3; }
    if (st === "long") { box(head, 0.56, 0.6, 0.15, c, 0, -0.18, -0.18); [-1, 1].forEach(function (x) { box(head, 0.1, 0.55, 0.2, c, x * 0.27, -0.15, 0.02); }); }
    if (st === "bob") { var b = sph(head, 0.34, c, 0, -0.02, -0.04, 14); b.scale.set(1.05, 0.85, 1); b.position.y = 0.02; box(head, 0.5, 0.12, 0.1, c, 0, 0.16, 0.22); }
    if (st === "bun") { sph(head, 0.13, c, 0, 0.35, -0.12, 10); }
    if (st === "pony") { var pn = cone(head, 0.1, 0.5, c, 0, -0.05, -0.35, 8); pn.rotation.x = -2.6; }
    if (st === "topknot") { var tk = cyl(head, 0.05, 0.05, 0.22, c, 0, 0.32, -0.05, 8); tk.rotation.x = -1.2; }
    if (st === "afro") { var af = sph(head, 0.42, c, 0, 0.12, -0.04, 10); af.scale.y = 0.9; }
  }
  function hat(head, r, kind, c) {
    if (kind === "chef") { cyl(head, 0.24, 0.24, 0.2, "#fafafa", 0, 0.32, 0, 14); sph(head, 0.28, "#fafafa", 0, 0.48, 0, 12).scale.y = 0.6; }
    else if (kind === "cap") { var cp = sph(head, 0.31, c || "#1a237e", 0, 0.12, 0, 14); cp.scale.y = 0.65; box(head, 0.32, 0.03, 0.2, c || "#1a237e", 0, 0.12, 0.3); sph(head, 0.05, "#ffd23f", 0, 0.28, 0.22, 6); }
    else if (kind === "witch") { cyl(head, 0.45, 0.45, 0.03, c || "#4a148c", 0, 0.22, 0, 20); var wc = cone(head, 0.25, 0.6, c || "#4a148c", 0, 0.52, 0, 14); wc.rotation.z = 0.25; }
    else if (kind === "crown") { cyl(head, 0.2, 0.22, 0.12, M("#ffd23f", { metalness: 0.7, roughness: 0.25 }), 0, 0.34, 0, 10); for (var i = 0; i < 5; i++) cone(head, 0.04, 0.1, M("#ffd23f", { metalness: 0.7 }), Math.cos(i * 1.26) * 0.19, 0.44, Math.sin(i * 1.26) * 0.19, 4); }
    else if (kind === "helmet") { var hm = sph(head, 0.34, c || "#e53935", 0, 0.08, 0, 14); hm.scale.y = 0.8; box(head, 0.5, 0.04, 0.5, c || "#e53935", 0, 0.08, 0.05); }
    else if (kind === "straw") { cyl(head, 0.5, 0.5, 0.03, "#ffd54f", 0, 0.24, 0, 20); cyl(head, 0.25, 0.27, 0.16, "#ffd54f", 0, 0.32, 0, 16); }
    else if (kind === "beret") { var bt = sph(head, 0.3, c || "#c62828", 0.04, 0.24, 0, 12); bt.scale.y = 0.4; }
    else if (kind === "headband") { torus(head, 0.3, 0.03, c || "#e53935", 0, 0.08, 0).rotation.x = Math.PI / 2; }
    else if (kind === "headset") { torus(head, 0.32, 0.03, "#212121", 0, 0.05, 0, Math.PI).rotation.z = 0; [-1, 1].forEach(function (s) { sph(head, 0.08, c || "#00e5ff", s * 0.31, 0, 0, 8); }); }
    else if (kind === "flower") { for (var k = 0; k < 5; k++) sph(head, 0.05, c || "#ff4f7b", 0.2 + Math.cos(k * 1.26) * 0.06, 0.22 + Math.sin(k * 1.26) * 0.06, 0.15, 6); sph(head, 0.04, "#ffd23f", 0.2, 0.22, 0.17, 6); }
    else if (kind === "ears") { [-1, 1].forEach(function (s) { cone(head, 0.09, 0.2, c || "#ff9800", s * 0.2, 0.33, 0, 4); }); }
    else if (kind === "horns") { [-1, 1].forEach(function (s) { var hn = cone(head, 0.05, 0.22, "#ffd23f", s * 0.18, 0.33, 0, 6); hn.rotation.z = s * -0.4; }); }
    else if (kind === "halo") { torus(head, 0.2, 0.025, M("#ffd23f", { emissive: "#ffd23f", emissiveIntensity: 0.8 }), 0, 0.48, 0).rotation.x = Math.PI / 2; }
    else if (kind === "antenna") { [-1, 1].forEach(function (s) { cyl(head, 0.015, 0.015, 0.3, "#9e9e9e", s * 0.1, 0.42, 0, 4); sph(head, 0.05, M("#76ff03", { emissive: "#76ff03" }), s * 0.1, 0.58, 0, 6); }); }
    else if (kind === "ninja") { torus(head, 0.3, 0.06, c || "#212121", 0, 0.02, 0).rotation.x = Math.PI / 2; box(head, 0.5, 0.18, 0.05, c || "#212121", 0, -0.12, 0.27); }
  }
  function prop(hand, r, P, kind, c) {
    var p = grp(hand, 0, -0.42, 0.05);
    if (kind === "mic") { cyl(p, 0.035, 0.025, 0.22, "#212121", 0, 0.1, 0, 8); sph(p, 0.06, M("#b0bec5", { metalness: 0.7 }), 0, 0.24, 0, 10); }
    else if (kind === "sword") { box(p, 0.03, 0.7, 0.015, M("#eceff1", { metalness: 0.9, roughness: 0.2 }), 0, 0.45, 0); box(p, 0.1, 0.03, 0.1, "#ffd23f", 0, 0.1, 0); box(p, 0.035, 0.15, 0.035, "#212121", 0, 0.02, 0); }
    else if (kind === "guitar") { var gb = sph(p, 0.18, c || "#8d4b2a", 0, -0.05, 0.12, 12); gb.scale.z = 0.3; box(p, 0.05, 0.45, 0.03, "#3e2723", 0, 0.3, 0.12); }
    else if (kind === "violin") { var vb = sph(p, 0.12, "#8d4b2a", 0, 0, 0.1, 12); vb.scale.set(0.8, 1.2, 0.3); box(p, 0.03, 0.25, 0.02, "#3e2723", 0, 0.22, 0.1); }
    else if (kind === "book") { box(p, 0.25, 0.32, 0.06, c || P[0], 0, 0.05, 0.05); box(p, 0.22, 0.3, 0.065, "#f8f1e0", 0.02, 0.05, 0.05); }
    else if (kind === "camera") { box(p, 0.24, 0.16, 0.12, "#263238", 0, 0.05, 0.05); cyl(p, 0.06, 0.06, 0.1, "#37474f", 0, 0.05, 0.14, 10).rotation.x = Math.PI / 2; }
    else if (kind === "stetho") { torus(p, 0.08, 0.015, "#455a64", 0, 0.05, 0.05); sph(p, 0.04, "#b0bec5", 0, -0.04, 0.05, 8); }
    else if (kind === "wrench") { box(p, 0.04, 0.35, 0.02, M("#90a4ae", { metalness: 0.8 }), 0, 0.15, 0.05); torus(p, 0.05, 0.02, M("#90a4ae", { metalness: 0.8 }), 0, 0.35, 0.05, Math.PI * 1.5); }
    else if (kind === "brush") { box(p, 0.03, 0.35, 0.03, "#d7b07a", 0, 0.15, 0.05); cone(p, 0.03, 0.08, c || "#e53935", 0, 0.36, 0.05, 6); }
    else if (kind === "whisk") { box(p, 0.03, 0.15, 0.03, "#9e9e9e", 0, 0.05, 0.05); var wk = sph(p, 0.07, M("#cfd8dc", { wireframe: true }), 0, 0.2, 0.05, 6); wk.scale.y = 1.6; }
    else if (kind === "wand") { box(p, 0.02, 0.35, 0.02, "#5d4037", 0, 0.15, 0.05); sph(p, 0.05, M("#ffd23f", { emissive: "#ffd23f", emissiveIntensity: 0.8 }), 0, 0.35, 0.05, 6); }
    else if (kind === "flag") { box(p, 0.015, 0.6, 0.015, "#8d6e63", 0, 0.25, 0.05); box(p, 0.25, 0.16, 0.01, c || P[0], 0.13, 0.48, 0.05); }
    else if (kind === "surf") { var sb = cyl(p, 0.12, 0.12, 0.02, c || P[0], 0.1, 0.1, 0.12, 16); sb.scale.set(1, 1, 4.5); sb.rotation.x = Math.PI / 2; }
    else if (kind === "ski") { box(p, 0.03, 0.8, 0.05, c || "#e53935", 0.05, 0.25, 0.1); box(p, 0.03, 0.8, 0.05, c || "#e53935", 0.12, 0.25, 0.1); }
    else if (kind === "suitcase") { box(p, 0.28, 0.32, 0.12, c || P[0], 0, -0.12, 0.05); box(p, 0.1, 0.04, 0.03, "#212121", 0, 0.06, 0.05); }
    else if (kind === "briefcase") { box(p, 0.3, 0.22, 0.08, c || "#5d4037", 0, -0.1, 0.05); torus(p, 0.05, 0.012, "#212121", 0, 0.03, 0.05, Math.PI); }
    else if (kind === "ball") { sph(p, 0.12, c || "#ff9800", 0, 0.05, 0.1, 12); }
    else if (kind === "racket") { torus(p, 0.12, 0.015, c || "#18b96b", 0, 0.3, 0.05); box(p, 0.02, 0.2, 0.02, "#212121", 0, 0.1, 0.05); }
    else if (kind === "lantern") { box(p, 0.01, 0.2, 0.01, "#3e2723", 0, 0.1, 0.05); sph(p, 0.09, M("#ff7043", { emissive: "#ff3d00", emissiveIntensity: 0.6 }), 0, -0.05, 0.05, 8).scale.y = 1.3; }
    else if (kind === "map") { box(p, 0.3, 0.22, 0.01, "#ffe0b2", 0, 0.08, 0.08); box(p, 0.1, 0.01, 0.015, "#e53935", 0.02, 0.1, 0.09); }
    else if (kind === "cup") { cyl(p, 0.06, 0.05, 0.12, c || "#fafafa", 0, 0.03, 0.06, 10); }
    else if (kind === "tea") { cyl(p, 0.08, 0.06, 0.08, "#5d4037", 0, 0.02, 0.06, 12); }
    else if (kind === "fan") { var f = cyl(p, 0.2, 0.2, 0.01, c || "#e53935", 0, 0.15, 0.06, 12, true); f.rotation.x = Math.PI / 2; }
    else if (kind === "hose") { cyl(p, 0.04, 0.04, 0.4, "#e53935", 0, 0.15, 0.05, 8).rotation.z = 0.8; }
    else if (kind === "flower") { box(p, 0.015, 0.3, 0.015, "#43a047", 0, 0.12, 0.05); sph(p, 0.07, c || "#ff4f7b", 0, 0.28, 0.05, 8); }
    else if (kind === "baton") { cyl(p, 0.01, 0.01, 0.35, "#fafafa", 0, 0.15, 0.05, 6); }
    else if (kind === "lamp") { sph(p, 0.1, M("#ffd23f", { emissive: "#ffb300", emissiveIntensity: 0.7 }), 0, 0.05, 0.08, 8); torus(p, 0.06, 0.015, "#ffd23f", 0, 0.12, 0.08, Math.PI); }
    else if (kind === "star") { var st = sph(p, 0.12, M("#ffd23f", { emissive: "#ffd23f", emissiveIntensity: 0.6 }), 0, 0.2, 0.05, 5); st.scale.z = 0.3; }
    else if (kind === "letter") { box(p, 0.25, 0.16, 0.02, "#fafafa", 0, 0.05, 0.07); box(p, 0.06, 0.06, 0.025, "#e53935", 0, 0.05, 0.08); }
    else if (kind === "glass") { cyl(p, 0.05, 0.02, 0.1, M("#fafafa", { transparent: true, opacity: 0.6 }), 0, 0.12, 0.06, 10); cyl(p, 0.045, 0.02, 0.06, "#880e4f", 0, 0.12, 0.06, 10); box(p, 0.01, 0.1, 0.01, "#fafafa", 0, 0.03, 0.06); }
    else if (kind === "scissors") { [-1, 1].forEach(function (s) { var bl = box(p, 0.02, 0.22, 0.01, M("#b0bec5", { metalness: 0.9 }), s * 0.02, 0.15, 0.06); bl.rotation.z = s * 0.25; torus(p, 0.035, 0.01, "#e53935", s * 0.04, 0.0, 0.06); }); }
  }
  function animal(g, r, P, o) {
    var c = o.animalC || "#d39b4a", k = o.animal;
    if (k === "mermaid") return TPL.figure(g, r, P, { gender: "f", hairC: o.hairC || "#26c6da", outfit: "#ab47bc", tailC: "#26a69a", hairStyle: "long", prop: "star" });
    cyl(g, 0.6, 0.7, 0.1, "#b08d3c", 0, 0.05, 0, 24);
    if (k === "octopus") {
      sph(g, 0.4, c, 0, 0.75, 0, 16).scale.y = 1.15;
      for (var i = 0; i < 8; i++) { var t = cyl(g, 0.06, 0.03, 0.55, c, Math.cos(i * 0.785) * 0.28, 0.32, Math.sin(i * 0.785) * 0.28, 6); t.rotation.set(Math.sin(i * 0.785) * 0.6, 0, -Math.cos(i * 0.785) * 0.6); }
      [-0.13, 0.13].forEach(function (x) { sph(g, 0.06, "#fafafa", x, 0.75, 0.36, 8); sph(g, 0.03, "#1b1b1b", x, 0.75, 0.41, 6); });
    } else if (k === "bird") {
      var bd = sph(g, 0.35, c, 0, 0.6, 0, 14); bd.scale.y = 1.2;
      sph(g, 0.25, c, 0, 1.05, 0.05, 12); var bk = cone(g, 0.08, 0.2, "#ffd23f", 0, 1.0, 0.3, 6); bk.rotation.x = Math.PI / 2 + 0.3;
      [-1, 1].forEach(function (s) { var w = sph(g, 0.22, o.wingC || "#2c6cff", s * 0.3, 0.6, -0.05, 8); w.scale.set(0.3, 1, 0.8); });
      [-0.09, 0.09].forEach(function (x) { sph(g, 0.04, "#1b1b1b", x, 1.1, 0.25, 6); });
      var tail = cone(g, 0.12, 0.5, "#e53935", 0, 0.3, -0.35, 6); tail.rotation.x = -2.3;
    } else if (k === "dragon") {
      var db = sph(g, 0.45, c, 0, 0.6, 0, 12); db.scale.set(1.3, 1, 0.9);
      sph(g, 0.3, c, 0.55, 1.05, 0, 12); box(g, 0.3, 0.15, 0.22, c, 0.8, 1.0, 0);
      [-1, 1].forEach(function (s) { var w = cone(g, 0.4, 0.8, M("#ffd23f", { transparent: true, opacity: 0.85 }), -0.1, 1.1, s * 0.4, 3); w.rotation.x = s * 1.2; cone(g, 0.04, 0.2, "#fafafa", 0.55, 1.35, s * 0.12, 6); });
      var tl = cone(g, 0.2, 0.9, c, -0.75, 0.45, 0, 8); tl.rotation.z = Math.PI / 2 + 0.4;
      sph(g, 0.04, M("#ffeb3b", { emissive: "#ffeb3b" }), 0.7, 1.12, 0.18, 6);
    } else if (k === "ghost") {
      var gh = sph(g, 0.45, M("#fafafa", { transparent: true, opacity: 0.85 }), 0, 0.85, 0, 16); gh.scale.y = 1.3;
      cone(g, 0.45, 0.4, M("#fafafa", { transparent: true, opacity: 0.85 }), 0, 0.3, 0, 16).rotation.x = Math.PI;
      [-0.14, 0.14].forEach(function (x) { sph(g, 0.06, "#1b1b1b", x, 0.95, 0.4, 8); });
      sph(g, 0.07, "#1b1b1b", 0, 0.75, 0.42, 8);
    } else if (k === "robot") {
      box(g, 0.6, 0.6, 0.45, o.animalC || "#b0bec5", 0, 0.6, 0); box(g, 0.45, 0.38, 0.4, o.animalC || "#b0bec5", 0, 1.15, 0);
      [-0.1, 0.1].forEach(function (x) { sph(g, 0.06, M("#00e5ff", { emissive: "#00e5ff" }), x, 1.18, 0.21, 8); });
      cyl(g, 0.02, 0.02, 0.2, "#616161", 0, 1.44, 0, 4); sph(g, 0.05, M("#e53935", { emissive: "#e53935" }), 0, 1.56, 0, 8);
      [-1, 1].forEach(function (s) { cyl(g, 0.06, 0.06, 0.45, "#78909c", s * 0.38, 0.6, 0, 8); box(g, 0.15, 0.3, 0.15, "#78909c", s * 0.15, 0.15, 0); });
      box(g, 0.3, 0.15, 0.02, M(P[0], { emissive: P[0], emissiveIntensity: 0.4 }), 0, 0.65, 0.23);
    } else if (k === "alien") {
      var hd = sph(g, 0.4, "#9ccc65", 0, 1.05, 0, 16); hd.scale.set(1, 1.2, 1);
      [-0.15, 0.15].forEach(function (x) { var e = sph(g, 0.12, "#1b1b1b", x, 1.05, 0.32, 10); e.scale.set(0.8, 1.2, 0.5); });
      cyl(g, 0.18, 0.25, 0.55, "#9ccc65", 0, 0.45, 0, 12);
      var ufo = sph(g, 0.6, M("#b0bec5", { metalness: 0.7 }), 0, 1.65, 0, 16); ufo.scale.y = 0.18;
    } else if (k === "panda") {
      var pb = sph(g, 0.45, "#fafafa", 0, 0.55, 0, 16); pb.scale.y = 0.95; sph(g, 0.33, "#fafafa", 0, 1.1, 0, 16);
      [-1, 1].forEach(function (s) { sph(g, 0.12, "#1b1b1b", s * 0.25, 1.38, 0, 8); var ep = sph(g, 0.09, "#1b1b1b", s * 0.12, 1.13, 0.27, 8); ep.scale.y = 1.3; sph(g, 0.15, "#1b1b1b", s * 0.35, 0.65, 0.1, 8); });
      var bb = cyl(g, 0.03, 0.03, 0.8, "#7cb342", 0.4, 0.8, 0.25, 6); bb.rotation.z = 0.4;
    } else if (k === "yeti") {
      var yb = sph(g, 0.5, "#eceff1", 0, 0.65, 0, 10); yb.scale.y = 1.2; sph(g, 0.32, "#eceff1", 0, 1.25, 0, 10);
      box(g, 0.3, 0.2, 0.05, "#90caf9", 0, 1.22, 0.3); [-0.08, 0.08].forEach(function (x) { sph(g, 0.04, "#1b1b1b", x, 1.27, 0.33, 6); });
      [-1, 1].forEach(function (s) { cyl(g, 0.12, 0.1, 0.55, "#eceff1", s * 0.48, 0.65, 0, 8).rotation.z = s * 0.3; });
    } else {
      // 狗／貓／狐：四腳＋耳朵＋尾巴
      var bd2 = sph(g, 0.38, c, 0, 0.55, 0, 14); bd2.scale.set(1.35, 0.9, 0.9);
      var hd2 = grp(g, 0.42, 0.95, 0);
      sph(hd2, 0.28, c, 0, 0, 0, 14);
      box(hd2, 0.2, 0.14, 0.18, o.muzzle || "#fff3e0", 0.22, -0.06, 0);
      sph(hd2, 0.04, "#1b1b1b", 0.33, -0.02, 0, 6);
      [-0.1, 0.1].forEach(function (z) { sph(hd2, 0.035, "#1b1b1b", 0.18, 0.07, z, 6); });
      [-1, 1].forEach(function (s) { var ear = cone(hd2, k === "dog" && o.flop ? 0.09 : 0.08, 0.2, o.earC || c, -0.02, 0.24, s * 0.14, 4); if (k === "dog" && o.flop) { ear.rotation.x = s * 2.4; ear.position.y = 0.05; ear.position.z = s * 0.25; } });
      [[-0.3, -0.18], [-0.3, 0.18], [0.3, -0.18], [0.3, 0.18]].forEach(function (p) { cyl(g, 0.07, 0.06, 0.4, c, p[0], 0.25, p[1], 8); });
      var tl2 = cone(g, k === "fox" ? 0.16 : 0.07, k === "fox" ? 0.6 : 0.4, c, -0.55, 0.75, 0, 8); tl2.rotation.z = 0.9;
      if (k === "fox") for (var t9 = 0; t9 < 4; t9++) { var tt = cone(g, 0.12, 0.55, c, -0.55, 0.75, (t9 - 1.5) * 0.15, 8); tt.rotation.set((t9 - 1.5) * 0.4, 0, 0.9); cone(g, 0.06, 0.15, "#fafafa", -0.78, 1.0, (t9 - 1.5) * 0.2, 6); }
      if (o.patches) for (var q = 0; q < 3; q++) { var pt = sph(g, 0.15, o.patches[q % o.patches.length], -0.2 + q * 0.2, 0.75, (q - 1) * 0.15, 8); pt.scale.y = 0.4; }
      if (o.prop) { var mh = grp(hd2, 0.25, -0.15, 0.12); prop(mh, r, P, o.prop); mh.children[0].position.y = 0.3; }
    }
    if (o.hat) { var hh = grp(g, 0, k === "octopus" ? 0.85 : k === "dog" || k === "cat" || k === "fox" ? 0.97 : 1.05, 0); if (k === "dog" || k === "cat" || k === "fox") hh.position.x = 0.42; hat(hh, r, o.hat, o.hatC); }
  }

  // ---------------- 名稱 → 模板 ----------------
  // [正規表示式（比對中日文名稱＋標籤）, 模板, 選項]；由上往下第一個符合的生效
  // 滿分男的非人類對象（只在滿分男類別比對，避免「貓空纜車」之類的地名被當成貓）
  var ANIMAL_RULES = [
    [/黃金獵犬|ゴールデン/, "figure", { animal: "dog", animalC: "#e0a956", flop: true }],
    [/柴犬|柴/, "figure", { animal: "dog", animalC: "#d9893b" }],
    [/三花貓|三毛/, "figure", { animal: "cat", animalC: "#fafafa", patches: ["#ff9800", "#1b1b1b"] }],
    [/貓咪|猫/, "figure", { animal: "cat", animalC: "#ff9800" }],
    [/九尾狐/, "figure", { animal: "fox", animalC: "#ffb74d", prop: "stetho" }],
    [/鸚鵡|オウム/, "figure", { animal: "bird", animalC: "#43a047", wingC: "#2c6cff" }],
    [/章魚|タコ(?!焼)/, "figure", { animal: "octopus", animalC: "#ff7043" }],
    [/龍的|ドラゴン|龍の/, "figure", { animal: "dragon", animalC: "#43a047" }],
    [/熊貓|パンダ/, "figure", { animal: "panda" }],
    [/幽靈|幽霊/, "figure", { animal: "ghost" }],
    [/機器人|ロボット|仿生人|アンドロイド/, "figure", { animal: "robot" }],
    [/外星|宇宙人/, "figure", { animal: "alien" }],
    [/雪怪|イエティ/, "figure", { animal: "yeti" }],
    [/人魚/, "figure", { animal: "mermaid" }]
  ];
  // [正規表示式, 模板, 選項]
  var RULES = [
    // 食物
    [/壽司郎|スシロー/, "sushi", { mix: true }],
    [/壽司|寿司|生魚片|刺身/, "sushi", {}],
    [/海鮮丼/, "donburi", { top: "#ff7043", egg: false }],
    [/鰻/, "donburi", { top: "#6d3b1e", bowl: "#b71c1c" }],
    [/牛丼|吉野家/, "donburi", { top: "#8d4b2a", bowl: "#e65100" }],
    [/親子丼/, "donburi", { top: "#ffd54f", egg: true }],
    [/天丼/, "donburi", { top: "#d39b4a" }],
    [/滷肉飯|ルーロー/, "donburi", { top: "#6d3b1e", bowl: "#f8f1e0", egg: true }],
    [/明太子|納豆|茶泡飯|お茶漬/, "donburi", { top: "#ef6c00", bowl: "#3e2723" }],
    [/一蘭|拉麵|ラーメン/, "noodle", { soup: "#c97b3a" }],
    [/烏龍|うどん/, "noodle", { soup: "#f1d9a6", noodle: "#fff8e1", meat: false }],
    [/蕎麥|そば/, "noodle", { soup: "#5d4037", noodle: "#8d6e63", egg: false, meat: false }],
    [/牛肉麵|牛肉麺/, "noodle", { soup: "#8d2b0b", egg: false }],
    [/日清|泡麵|カップ/, "noodle", { bowl: "#fafafa", soup: "#e0a35a" }],
    [/味噌湯|味噌汁/, "noodle", { bowl: "#3e2723", soup: "#c9853f", noodle: "#fafafa", egg: false, meat: false }],
    [/拿坡里|ナポリタン|焗烤|グラタン|義大利麵/, "curry", { sauce: "#e53935" }],
    [/蛋包飯|オムライス/, "curry", { omelette: true, sauce: "#e53935" }],
    [/咖哩|カレー|燴飯|ハヤシ/, "curry", {}],
    [/漢堡排|ハンバーグ/, "curry", { sauce: "#5d2c0f" }],
    [/奶油燉菜|シチュー/, "hotpot", { soup: "#fff8e1", pot: "#e53935" }],
    [/天婦羅|天ぷら|炸蝦|エビフライ/, "fried", { shrimp: true }],
    [/炸豬排|とんかつ|可樂餅|コロッケ|鹽酥雞|唐揚/, "fried", {}],
    [/燒鳥|焼き鳥|焼鳥/, "skewer", {}],
    [/糰子|団子/, "skewer", { dango: true }],
    [/章魚燒|たこ焼/, "takoyaki", {}],
    [/壽喜燒|すき焼|涮涮|しゃぶ|關東煮|おでん|相撲火鍋|ちゃんこ|鍋/, "hotpot", {}],
    [/燒肉|焼肉|牛舌|牛タン/, "hotpot", { pot: "#212121", soup: "#424242" }],
    [/大阪燒|お好み|廣島燒|文字燒|もんじゃ/, "griddle", {}],
    [/玉子燒|卵焼/, "griddle", { col: "#ffd23f", roll: true, sauce: "#ffd23f" }],
    [/蚵仔煎|オアジェン/, "griddle", { col: "#fff3e0", sauce: "#e53935" }],
    [/飯糰|おにぎり/, "onigiri", {}],
    [/小籠包|鼎泰豐|小籠/, "steamer", {}],
    [/刈包|グァバオ/, "bun", {}],
    [/鯛魚燒|たい焼/, "taiyaki", {}],
    [/銅鑼燒|どら焼/, "wagashi", { dora: true }],
    [/大福|和菓子|羊羹/, "wagashi", {}],
    [/芒果冰|かき氷|刨冰/, "shavedIce", { col: "#ffcc80", fruit: "#ffb300" }],
    [/豆花|トウファ|茶碗蒸|布丁|プリン/, "pudding", {}],
    [/珍珠奶茶|タピオカ/, "bubbleTea", {}],
    [/抹茶/, "tea", {}],
    [/懷石|懐石|便當|弁当/, "bento", {}],
    [/秋刀魚|サンマ/, "fish", { col: "#78909c" }],
    [/河豚|ふぐ/, "fish", { puffer: true, col: "#fff59d" }],
    [/螃蟹|カニ/, "crab", {}],
    [/臭豆腐/, "tofu", {}],
    [/漢堡|バーガー/, "burger", {}],
    [/85 度|85度|麵包|ベーカリー/, "wagashi", { col: "#d39b4a" }],
    // 動漫、娛樂
    [/寶可夢カード|卡牌|PTCG|トレカ/, "toy", { kind: "cards" }],
    [/寶可夢|ポケモン/, "manga", { icon: "ballV", col: "#e53935" }],
    [/瑪利歐|マリオ/, "manga", { icon: "mushroom" }],
    [/七龍珠|ドラゴンボール/, "manga", { icon: "ball", stars: 4 }],
    [/航海王|ワンピース/, "manga", { icon: "hat" }],
    [/鬼滅|咒術|死神|BLEACH/, "manga", { icon: "sword" }],
    [/艾爾登|エルデン/, "manga", { icon: "ring" }],
    [/福音戰士|エヴァ|鋼彈|ガンダム/, "manga", { icon: "mecha" }],
    [/薩爾達|ゼルダ|王國之心|キングダム/, "manga", { icon: "sword", col: "#2c6cff" }],
    [/進擊的巨人|進撃/, "manga", { icon: "wall" }],
    [/勇者鬥惡龍|ドラゴンクエスト|ドラクエ/, "manga", { icon: "slime" }],
    [/柯南|コナン/, "manga", { icon: "lens" }],
    [/哆啦|ドラえもん/, "manga", { icon: "bell" }],
    [/灌籃|スラムダンク/, "ball", { kind: "basket" }],
    [/排球少年|ハイキュー/, "ball", { kind: "volley" }],
    [/藍色監獄|ブルーロック/, "ball", { kind: "soccer" }],
    [/魔物獵人|モンハン/, "manga", { icon: "sword", col: "#6d4c41" }],
    [/火影|ナルト/, "manga", { icon: "kunai" }],
    [/太空戰士|ファイナルファンタジー/, "manga", { icon: "crystal" }],
    [/斯普拉遁|スプラトゥーン/, "manga", { icon: "ink" }],
    [/動物森友會|どうぶつの森/, "manga", { icon: "leaf" }],
    [/我推|推しの子|美少女戰士|セーラームーン/, "manga", { icon: "heart" }],
    [/惡靈古堡|バイオハザード/, "manga", { icon: "leaf" }],
    [/哥吉拉|ゴジラ/, "toy", { kind: "monster" }],
    [/吉伊卡哇|ちいかわ/, "toy", { col: "#fafafa" }],
    [/拉拉熊|リラックマ/, "toy", { col: "#a1887f" }],
    [/蛋黃哥|ぐでたま/, "toy", { egg: true, col: "#fafafa" }],
    [/熊本熊|くまモン/, "toy", { col: "#1b1b1b" }],
    [/三麗鷗|サンリオ/, "toy", { col: "#fafafa" }],
    [/扭蛋|ガチャ/, "toy", { kind: "capsule" }],
    [/夾娃娃|クレーン/, "toy", { kind: "claw" }],
    [/你的名字|神隱|千と千尋|龍貓|トトロ|鈴芽|すずめ|宮崎駿|吉卜力美術館|ジブリ/, "film", {}],
    [/村上春樹/, "manga", { icon: "star" }],
    [/劇$|ドラマ|半澤|逃恥|First Love|孤獨的美食家|東京愛情|交響情人夢|法醫|重啟人生|Silent/, "film", {}],
    [/VTuber|初音/, "figure", { hat: "headset", hairC: "#26c6da", hairStyle: "pony", gender: "f" }],
    [/紅白|M-1|卡拉OK|カラオケ|YOASOBI|Ado|King Gnu|Mrs\. GREEN|髭男|藤井風|AKB|乃木坂|LiSA|Perfume|Snow Man|米津|（嵐）|ARASHI|木村拓哉|新垣/, "mic", {}],
    // 運動
    [/大谷|鈴木一朗|侍 JAPAN|WBC|甲子園|高校野球|巨人|阪神|鷹|火腿|野球|棒球/, "ball", { kind: "baseball" }],
    [/男排|排球|バレー/, "ball", { kind: "volley" }],
    [/足球|サッカー|女足|J聯盟|Jリーグ|鹿角|紅鑽/, "ball", { kind: "soccer" }],
    [/男籃|B\.LEAGUE|籃球|バスケ/, "ball", { kind: "basket" }],
    [/橄欖球|ラグビー/, "ball", { kind: "rugby" }],
    [/網球|テニス/, "ball", { kind: "tennis" }],
    [/桌球|卓球/, "ball", { kind: "pingpong" }],
    [/羽球|バドミントン/, "ball", { kind: "shuttle" }],
    [/高爾夫|ゴルフ/, "ball", { kind: "golf" }],
    [/羽生|花式滑冰|フィギュア|滑冰/, "sportGear", { kind: "skate" }],
    [/跳台滑雪|單板|^スキー|スキージャンプ|スノーボード/, "sportGear", { kind: "ski" }],
    [/日本滑板|スケートボード/, "sportGear", { kind: "skateboard" }],
    [/日本衝浪|サーフィン/, "sportGear", { kind: "board" }],
    [/攀登|クライミング/, "sportGear", { kind: "climb" }],
    [/相撲/, "sportGear", { kind: "sumo" }],
    [/劍道|剣道/, "sportGear", { kind: "kendo" }],
    [/拳擊|ボクシング|角力|レスリング|柔道/, "sportGear", { kind: "glove" }],
    [/驛傳|駅伝|馬拉松|マラソン|田徑|陸上|接力/, "sportGear", { kind: "shoe" }],
    [/體操|体操/, "sportGear", { kind: "rings" }],
    [/游泳|競泳/, "sportGear", { kind: "swim" }],
    [/有馬紀念|有馬記念|競馬/, "sportGear", { kind: "horse" }],
    // 企業
    [/捷安特|ジャイアント/, "car", { bike: true, col: "#2c6cff" }],
    [/光陽|Gogoro|機車|バイク/, "car", { scooter: true }],
    [/F1|賽車/, "car", { race: true, col: "#e53935" }],
    [/汽車|豐田|トヨタ|本田|ホンダ/, "car", {}],
    [/航空|全日空|JAL|ANA|機場|空港/, "plane", {}],
    [/高鐵|新幹線|JR|鐵道|三陸鐵|捷運|車站|駅/, "train", { bullet: true }],
    [/纜車|ロープウェイ/, "train", { gondola: true }],
    [/任天堂|SEGA|セガ|卡普空|CAPCOM|萬代|バンダイ|Square|光榮|コーエー|宮本茂/, "controller", {}],
    [/索尼|ソニー/, "controller", { col: "#212121" }],
    [/筆電|華碩|宏碁|廣達|微星|ASUS|Acer/, "chip", { laptop: true }],
    [/台積電|聯發科|美光|輝達|NVIDIA|鎧俠|日月光|大立光|鴻海|半導體|晶片/, "chip", {}],
    [/佳能|キヤノン|カメラ/, "product", { kind: "camera" }],
    [/松下|パナソニック|大同/, "product", { kind: "tv" }],
    [/山葉|ヤマハ|鋼琴|ピアノ/, "product", { kind: "piano" }],
    [/資生堂/, "product", { kind: "cosmetic" }],
    [/中華電信|軟銀|ソフトバンク|蝦皮|樂天|楽天/, "product", { kind: "phone" }],
    [/7-Eleven|セブン|統一超商/, "shop", { stripes: ["#ff7043", "#18b96b", "#e53935"] }],
    [/全家|ファミリーマート/, "shop", { stripes: ["#2c6cff", "#18b96b", "#2c6cff"] }],
    [/LAWSON|ローソン/, "shop", { stripes: ["#2c6cff", "#fafafa", "#2c6cff"] }],
    [/便利商店|コンビニ|全聯|好市多|コストコ|唐吉訶德|ドン・キホーテ|大創|DAISO|宜得利|ニトリ|無印|優衣庫|ユニクロ|三越|誠品/, "shop", {}],
    [/啤酒|ビール|菸酒|黑松|養樂多|ヤクルト|朝日/, "drinkBottle", { many: true }],
    [/卡樂比|カルビー|乖乖|明治(?!神宮)|義美|統一企業/, "snackBag", {}],
    [/東橫|星野(?!TOMAMU)|ホテル|飯店/, "office", { col: "#b3e5fc" }],
    [/台塑|中鋼|台電|工廠/, "office", { factory: true }],
    [/金控|國泰|銀行|集團|企業|株式/, "office", {}],
    // 地點
    [/五稜郭塔/, "tower", { col: "#fafafa" }],
    [/台北 101|台北101/, "tower", { stack: true, col: "#4db6ac" }],
    [/東京鐵塔|東京タワー|通天閣/, "tower", { lattice: true, col: "#e53935" }],
    [/晴空塔|スカイツリー/, "tower", { col: "#b3e5fc", h: 1.9 }],
    [/塔|タワー|展望|大廈|ビル/, "tower", {}],
    [/環球影城|迪士尼|ディズニー|豪斯登堡|ハウステンボス|海洋世界|萬博/, "ferris", {}],
    [/城跡|城(?!市|崎)|首里城/, "castle", {}],
    [/本能寺/, "battle", { fire: true }],
    [/之戰|の戦い|征伐/, "battle", {}],
    [/金閣寺/, "shrine", { gold: true }],
    [/稻荷|稲荷/, "shrine", { many: true }],
    [/五重塔|法隆寺|東寺/, "pagoda", {}],
    [/寺|神社|神宮|大社|天滿宮|天満宮|東照宮|出羽三山|中尊寺|高野山/, "shrine", {}],
    [/溫泉|温泉|湯/, "onsen", {}],
    [/水族館|海遊館/, "lake", { col: "#0288d1" }],
    [/動物園|旭山/, "park", { animal: "#9e9e9e" }],
    [/牧場|農場|丘|清境|十勝|富良野|美瑛/, "park", { flowers: true }],
    [/公園|庭園|偕樂園|花(?!笠)|吉野山|嵐山/, "park", { blossom: true }],
    [/大橋|天橋立/, "bridge", {}],
    [/雲海/, "mountain", { snow: false }],
    [/瀑布|滝/, "lake", { falls: true }],
    [/流冰|流氷/, "lake", { ice: true, col: "#4fc3f7" }],
    [/櫻島|桜島|阿蘇/, "mountain", { volcano: true, snow: false }],
    [/島|嶼|墾丁|白濱|白浜|澎湖|蘭嶼|旗津|七星潭|三仙台/, "lake", { island: true }],
    [/湖|池(?!袋)|沼|濕地|湿原|溪|渓|潭|松島|海/, "lake", {}],
    [/橋|天橋立/, "bridge", {}],
    [/祭|天燈|燈籠/, "festival", {}],
    [/富士|山|岳|樹冰|御釜|雲海|陽明山|合歡|阿里山|太魯閣|層雲峽|峡/, "mountain", {}],
    [/美術館|博物館|劇場|劇院|歌劇院|萬畫館|紀念館|teamLab|故宮|中正紀念堂/, "museum", {}],
    [/蒸餾所|酒莊|ワイナリー/, "drinkBottle", { col: "#4e342e", many: true }],
    [/市場|夜市|老街|屋台|朝市|中華街|商店街|竹下|西門町|下北澤|秋葉原|池袋|中野|狸小路|祇園|錦|道頓堀|國際通|小樽|九份|鹿港|大內宿|角館|宿|倉庫|門司港|舟屋|眷村/, "street", {}],
    [/十字路口|新宿|銀座|澀谷|渋谷|台場|港未來|駁二|安平|梅田|中洲|夜景/, "city", { sign: true }],
    [/巨蛋|ドーム/, "museum", { mod: true }]
  ];
  // 祭典：竿燈與天燈用燈籠造型
  var LANTERN_FEST = /竿燈|天燈|七夕/;

  // 職業／人物關鍵字 → 人物配件（滿分男與名人用）
  var PERSON_RULES = [
    [/醫師|醫生|医師|牙醫|獸醫|皮膚科|護理|看護|中醫/, { coat: "#fafafa", prop: "stetho" }],
    [/主廚|廚師|料理|甜點|壽司師傅|居酒屋|小吃|餐廳|食|試吃|巧克力/, { hat: "chef", outfit: "#fafafa", prop: "whisk" }],
    [/消防/, { hat: "helmet", hatC: "#e53935", outfit: "#ef6c00", prop: "hose" }],
    [/機師|座艙長|空服|船長|駕駛/, { hat: "cap", hatC: "#1a237e", outfit: "#1a237e", prop: "map" }],
    [/建築|木工|水電|維修|工程師|晶片|技術長/, { hat: "helmet", hatC: "#ffd23f", prop: "wrench", glasses: true }],
    [/音樂|吉他|三線|佛朗明哥|駐唱|歌|舞/, { prop: "guitar" }],
    [/小提琴|指揮|鋼琴/, { prop: "violin", outfit: "#212121" }],
    [/老師|講師|教授|校長|研究|科學家|學者|圖書館|書店|翻譯|劇本|會計|律師|特務/, { prop: "book", glasses: true }],
    [/攝影|導遊|部落客|旅/, { prop: "camera" }],
    [/滑雪|雪/, { prop: "ski", hat: "beret", hatC: "#29b6f6" }],
    [/衝浪|潛水|海/, { prop: "surf", outfit: "#29b6f6" }],
    [/羽球|網球/, { prop: "racket" }],
    [/冰上曲棍球|花式滑冰|泰拳|拳/, { prop: "ball", hat: "headband" }],
    [/劍道|武將|忍者|武/, { prop: "sword", hat: "ninja" }],
    [/魔女|魔法|巫/, { hat: "witch", prop: "wand", outfit: "#4a148c" }],
    [/王子|伯爵|國王|富二代|有錢/, { hat: "crown", cape: "#b71c1c", outfit: "#fafafa" }],
    [/天使|神明|引路/, { hat: "halo", wings: "#fafafa", outfit: "#fafafa" }],
    [/吸血鬼/, { cape: "#212121", outfit: "#4a148c", prop: "glass" }],
    [/陰陽師|平安|才女|茶道/, { hat: "beret", hatC: "#212121", outfit: "#880e4f", prop: "fan" }],
    [/超級英雄/, { cape: "#e53935", outfit: "#2c6cff" }],
    [/精靈|小精靈/, { wings: "#b2ebf2", prop: "wand", hat: "flower" }],
    [/雪女/, { outfit: "#e1f5fe", hairC: "#eceff1", prop: "star" }],
    [/花藝|園|農|植物|牧場/, { hat: "straw", prop: "flower", outfit: "#7cb342" }],
    [/美髮|設計|畫|美術|插畫|藝/, { prop: "brush", hat: "beret" }],
    [/郵差/, { hat: "cap", hatC: "#18b96b", prop: "letter" }],
    [/警衛|保鑣|巡守|救難/, { hat: "cap", hatC: "#37474f", prop: "lamp" }],
    [/燈塔|煙火|熱氣球/, { prop: "lamp" }],
    [/經理|主管|公務員|行銷|產品|投資|基金|商/, { prop: "briefcase", outfit: "#37474f" }],
    [/咖啡|茶|品酒/, { prop: "cup" }],
    [/香|調香/, { prop: "glass" }],
    [/健身|體力|運動|跑/, { hat: "headband", outfit: "#e53935" }],
    [/時間|時光/, { prop: "star", glasses: true }],
    [/神燈/, { prop: "lamp", hat: "beret", hatC: "#ffd23f" }],
    [/地圖|規劃|預算|嚮導/, { prop: "map" }],
    [/購物|時尚/, { prop: "briefcase", hat: "flower" }],
    [/外交|語言|留學|交換/, { prop: "suitcase" }],
    [/零食|美食/, { prop: "cup" }],
    [/機械|仿生|未來|Wi-Fi/, { hat: "antenna" }]
  ];
  var WOMAN = /女|媽|姬|娘|阿嬤|魔女|妹|小姐|新垣|阿市|伽羅奢|雪女/;

  var HOME_RULES = [
    [/101|大樓|公寓|頂樓|港景|景觀宅|濱海|生活機能/, "tower"], [/圓頂|月球|玻璃屋|冰島/, "dome"], [/古堡|城/, "castle"],
    [/樹屋|叢林|雨林/, "tree"], [/蘑菇|童話/, "mushroom"], [/燈塔/, "lighthouse"], [/貨櫃/, "container"],
    [/町家|古民家|宿舍|韓屋|茶屋|赤瓦|錢湯/, "machiya"], [/海底|人工島|海邊|湖畔|馬爾地夫/, "boat"], [/極光|冰/, "igloo"]
  ];

  function nameOf(target) {
    var n = target && target.name;
    if (!n) return "";
    if (typeof n === "string") return n;
    return [n.zh, n.ja].filter(Boolean).join("／");
  }
  // 由標的資料決定模板與選項（回傳 { tpl, opt }）
  function choose(target) {
    var cat = target.category || "", name = nameOf(target), r = rng(hash(target.id || name));
    var tags = (target.tags || []).map(function (t) { return typeof t === "string" ? t : (t.zh || "") + (t.ja || ""); }).join(" ");
    var i, opt;
    // 人物類：戰國武將、滿分男
    if (cat === "sengoku_person") {
      var woman = WOMAN.test(name);
      opt = { gender: woman ? "f" : "m", kabuto: !woman && !/千利休|半藏|武藏/.test(name), crest: pick(r, ["moon", "horn", "antler", "sun", "ai", "flame"]),
        armor: pick(r, ["#b71c1c", "#1a237e", "#212121", "#4e342e", "#2e7d32"]), helm: pick(r, ["#212121", "#4e342e", "#1a237e"]), prop: "sword", outfit: pick(r, ["#880e4f", "#37474f", "#1a237e", "#4e342e"]) };
      if (/伊達/.test(name)) opt.crest = "moon";
      if (/本多/.test(name)) opt.crest = "antler";
      if (/直江/.test(name)) opt.crest = "ai";
      if (/真田/.test(name)) { opt.armor = "#c62828"; opt.helm = "#c62828"; }
      if (/千利休/.test(name)) { opt.prop = "tea"; opt.hairStyle = "bald"; opt.outfit = "#424242"; }
      if (/半藏/.test(name)) { opt.hat = "ninja"; opt.outfit = "#212121"; }
      if (/武藏/.test(name)) { opt.hairStyle = "topknot"; opt.outfit = "#5d4037"; }
      if (woman) { opt.prop = "fan"; opt.hairStyle = "long"; opt.outfit = pick(r, ["#ad1457", "#6a1b9a", "#c62828"]); }
      return { tpl: "figure", opt: opt };
    }
    if (cat === "mf_home") {
      var st = "villa";
      for (i = 0; i < HOME_RULES.length; i++) if (HOME_RULES[i][0].test(name)) { st = HOME_RULES[i][1]; break; }
      return { tpl: "house", opt: { style: st, pool: /別墅|峇里|杜拜/.test(name), slide: /溜滑梯/.test(name), garden: /花園/.test(name) } };
    }
    if (/^mf_/.test(cat)) {
      for (i = 0; i < ANIMAL_RULES.length; i++) if (ANIMAL_RULES[i][0].test(name)) return { tpl: "figure", opt: ANIMAL_RULES[i][2] };
    }
    // 先只比名稱；名稱沒有線索才看標籤（標籤常有「ドラマ」「パン」之類的旁枝字眼，會誤判）
    for (i = 0; !/^mf_/.test(cat) && i < RULES.length * 2; i++) {
      if (RULES[i % RULES.length][0].test(i < RULES.length ? name : tags)) {
        i = i % RULES.length;
        opt = {};
        Object.keys(RULES[i][2]).forEach(function (k) { opt[k] = RULES[i][2][k]; });
        if (RULES[i][1] === "festival") opt.lanterns = LANTERN_FEST.test(name);
        return { tpl: RULES[i][1], opt: opt };
      }
    }
    if (/^mf_/.test(cat) || cat === "jp_celebrity") {
      opt = { gender: cat === "mf_woman" || WOMAN.test(name) ? "f" : "m" };
      for (i = 0; i < PERSON_RULES.length; i++) if (PERSON_RULES[i][0].test(name)) { Object.keys(PERSON_RULES[i][1]).forEach(function (k) { opt[k] = PERSON_RULES[i][1][k]; }); break; }
      if (cat === "mf_travel" && !opt.prop) opt.prop = "suitcase";
      if (cat === "mf_roommate" && !opt.prop) opt.prop = "cup";
      if (cat === "jp_celebrity" && !opt.prop) opt.prop = "mic";
      return { tpl: "figure", opt: opt };
    }
    var DEF = {
      washoku: ["sushi", "noodle", "donburi", "bento", "wagashi"], yoshoku: ["curry", "fried", "burger"], taiwan_food: ["bubbleTea", "steamer", "noodle", "tofu"],
      anime_game: ["manga"], jp_pop: ["mic", "film", "toy"], jp_sports: ["sportGear", "ball"], jp_company: ["office", "shop", "product"],
      tw_company: ["office", "chip", "shop"], sengoku_event: ["battle"], hokkaido: ["mountain", "lake", "park", "city"], tohoku: ["mountain", "lake", "street", "shrine"],
      kansai: ["shrine", "street", "castle", "city"], kanto: ["city", "shrine", "street", "tower"], kyushu_okinawa: ["city", "mountain", "castle"], taiwan_spot: ["street", "mountain", "lake", "city"]
    };
    return { tpl: pick(r, DEF[cat] || ["product", "manga", "city"]), opt: {} };
  }

  function build(target) {
    var c = choose(target), r = rng(hash((target.id || "") + nameOf(target)) ^ 0x9e3779b1), P = PALETTES[hash(target.id || nameOf(target)) % PALETTES.length];
    var g = new T.Group();
    (TPL[c.tpl] || TPL.product)(g, r, P, c.opt);
    // 正規化：縮放到展示台上約 1.6 高、最寬 2.0
    var bb = new T.Box3().setFromObject(g), size = bb.getSize(new T.Vector3());
    var s = Math.min(1.7 / Math.max(0.3, size.y), 2.1 / Math.max(0.3, size.x, size.z));
    g.scale.setScalar(s);
    bb.setFromObject(g);
    g.position.y -= bb.min.y;
    var center = bb.getCenter(new T.Vector3());
    g.position.x -= center.x; g.position.z -= center.z;
    var wrap = new T.Group(); wrap.add(g);
    wrap.userData.tpl = c.tpl;
    return wrap;
  }

  // ---------------- 展示台（整頁共用一個 renderer） ----------------
  function dark() { return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; }
  function setup() {
    T = window.THREE;
    var renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.domElement.className = "ts-stage-canvas";
    var scene = new T.Scene();
    var camera = new T.PerspectiveCamera(32, 2, 0.1, 50);
    camera.position.set(0, 2.1, 6.2); camera.lookAt(0, 0.95, 0);
    scene.add(new T.HemisphereLight(0xfff3e0, 0x5d4037, 0.75));
    var key = new T.SpotLight(0xffffff, 1.0, 20, 0.6, 0.5); key.position.set(2.5, 6, 3.5); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    scene.add(key); scene.add(key.target);
    var rim = new T.DirectionalLight(0xffd59e, 0.45); rim.position.set(-3, 2, -3); scene.add(rim);
    // 拍賣展示台：深色木台＋金邊＋紅絨布
    var ped = new T.Group();
    var base = new T.Mesh(new T.CylinderGeometry(1.45, 1.6, 0.35, 48), new T.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.6 }));
    base.position.y = -0.2; base.receiveShadow = true; ped.add(base);
    var rimG = new T.Mesh(new T.TorusGeometry(1.46, 0.035, 8, 64), new T.MeshStandardMaterial({ color: 0xb08d3c, metalness: 0.8, roughness: 0.3 }));
    rimG.rotation.x = Math.PI / 2; rimG.position.y = -0.03; ped.add(rimG);
    var cloth = new T.Mesh(new T.CylinderGeometry(1.38, 1.38, 0.04, 48), new T.MeshStandardMaterial({ color: 0x8e1b1b, roughness: 0.9 }));
    cloth.position.y = -0.01; cloth.receiveShadow = true; ped.add(cloth);
    scene.add(ped);
    var turn = new T.Group(); scene.add(turn);
    R = { renderer: renderer, scene: scene, camera: camera, turn: turn, model: null, key: null, holder: null, raf: 0, last: 0, angle: 0, drag: null };
    var cv = renderer.domElement;
    // 拖曳可以手動轉（放開後繼續自動旋轉）
    cv.addEventListener("pointerdown", function (e) { R.drag = { x: e.clientX, a: R.angle }; try { cv.setPointerCapture(e.pointerId); } catch (x) { /* 忽略 */ } });
    cv.addEventListener("pointermove", function (e) { if (R.drag) R.angle = R.drag.a + (e.clientX - R.drag.x) * 0.012; });
    cv.addEventListener("pointerup", function () { R.drag = null; });
    cv.addEventListener("pointercancel", function () { R.drag = null; });
  }
  function resize() {
    var w = R.holder.clientWidth || 320, h = R.holder.clientHeight || 220;
    R.renderer.setSize(w, h, false);
    R.renderer.domElement.style.width = "100%"; R.renderer.domElement.style.height = "100%";
    R.camera.aspect = w / h;
    // 窄螢幕時把鏡頭拉遠，模型不會被切掉
    R.camera.position.set(0, 1.9, w / h < 1.3 ? 6.8 : 5.0);
    R.camera.lookAt(0, 0.85, 0);
    R.camera.updateProjectionMatrix();
  }
  function loop(ts) {
    R.raf = 0;
    if (!R.holder || !document.body.contains(R.holder)) return;
    var dt = R.last ? Math.min(0.05, (ts - R.last) / 1000) : 0.016;
    R.last = ts;
    if (!R.drag) R.angle += dt * 0.6;
    R.turn.rotation.y = R.angle;
    if (R.model) R.model.position.y = 0.04 + Math.sin(ts / 900) * 0.03;
    if (R.holder.clientWidth && (R.holder.clientWidth !== R.w || R.holder.clientHeight !== R.h)) { R.w = R.holder.clientWidth; R.h = R.holder.clientHeight; resize(); }
    R.renderer.render(R.scene, R.camera);
    if (!document.hidden) R.raf = requestAnimationFrame(loop);
  }
  document.addEventListener("visibilitychange", function () { if (R && !document.hidden && !R.raf && R.holder) R.raf = requestAnimationFrame(loop); });

  // 找回資料裡的標的：先比 id，再比「類別＋名稱（中或日）」，都找不到就當成自訂標的（以名稱決定外觀）
  function findTarget(id, cat, name) {
    var all = D ? (D.TARGETS || []).concat(D.MANFEN_TARGETS || []) : [], i, t;
    for (i = 0; id && i < all.length; i++) if (all[i].id === id) return all[i];
    for (i = 0; name && i < all.length; i++) {
      t = all[i];
      if ((!cat || t.category === cat) && t.name && (t.name.zh === name || t.name.ja === name)) return t;
    }
    return name ? { id: "custom:" + name, category: cat, name: name } : null;
  }
  function show(holder) {
    var target = findTarget(holder.getAttribute("data-target"), holder.getAttribute("data-cat"), holder.getAttribute("data-name"));
    if (!target) return;
    if (!R) setup();
    var key = target.id + "|" + nameOf(target);
    if (R.key !== key) {
      if (R.model) {
        R.turn.remove(R.model);
        R.model.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
      }
      R.model = build(target);
      R.model.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      R.turn.add(R.model);
      R.key = key;
      R.angle = 0.6;
    }
    R.holder = holder;
    holder.appendChild(R.renderer.domElement);
    holder.setAttribute("data-tpl", R.model.userData.tpl);
    holder.classList.add("ts-stage-on");
    R.w = 0;
    if (!R.raf) R.raf = requestAnimationFrame(loop);
  }

  // render() 之後呼叫：找到畫面上的第一個展示台佔位元素，把共用畫布放進去
  function mount(root) {
    var holder = root && root.querySelector(".ts-stage");
    if (!holder) return;
    if (!available()) { holder.classList.add("ts-stage-off"); return; }
    if (window.THREE) { T = window.THREE; show(holder); return; }
    holder.classList.add("ts-stage-loading");
    load().then(function () {
      T = window.THREE;
      // 載入期間畫面可能已重畫：用最新的佔位元素
      var cur = document.querySelector(".ts-stage");
      if (cur) show(cur);
    }, function () { holder.classList.add("ts-stage-off"); });
  }

  window.PriTestToushou3D = {
    mount: mount,
    choose: choose,
    _templates: function () { return Object.keys(TPL); },
    _state: function () { return R ? { key: R.key, tpl: R.model && R.model.userData.tpl } : null; }
  };
})();
