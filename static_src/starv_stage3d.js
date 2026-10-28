// 明星經紀 starV：3D 表演演出（規格 §16）。three.js r149 只在第一次播放時載入（#sv-app[data-three-src]）。
// 藝人以程序組合的低多邊形幾何體表示，動作是依時間計算的關節旋轉；場景依方向；鏡頭腳本來自 starv_stage_spec.js。
// 畫質：high（陰影、粒子多、裝置像素比）／low（無陰影、粒子少、像素比 1）／off（一律 2D 後備）。不支援 WebGL 也用 2D 後備。
(function () {
  "use strict";

  var UI = window.PriTestStarvUI;
  var Spec = window.PriTestStarvStageSpec;
  var t = UI.t, el = UI.el;
  var KEY = "pritest-starv-stage";
  var END_CARD_MS = 4000;
  var loading = null;

  function available() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  }
  function quality() {
    try { var q = JSON.parse(localStorage.getItem(KEY) || "{}").quality; return q === "low" || q === "off" ? q : "high"; } catch (e) { return "high"; }
  }
  function setQuality(q) { try { localStorage.setItem(KEY, JSON.stringify({ quality: q })); } catch (e) { /* 只是記不住 */ } }

  function load() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (loading) return loading;
    var app = document.getElementById("sv-app"), src = app && app.getAttribute("data-three-src");
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

  // ---------- 角色 ----------
  function mat(T, color, opts) {
    var o = { color: color, roughness: 0.55, metalness: 0.05, flatShading: true };
    Object.keys(opts || {}).forEach(function (k) { o[k] = opts[k]; });
    return new T.MeshStandardMaterial(o);
  }
  function limb(T, len, r, color) {
    var g = new T.Group(), m = new T.Mesh(new T.CylinderGeometry(r, r * 0.9, len, 6), mat(T, color));
    m.position.y = -len / 2; m.castShadow = true; g.add(m);
    return g;
  }
  function buildRig(T, spec, motion) {
    var root = new T.Group(), body = new T.Group();
    body.scale.setScalar(spec.height);
    root.add(body);
    var hips = new T.Group(); hips.position.y = 0.92; body.add(hips);
    var torso = new T.Mesh(new T.CylinderGeometry(0.2, 0.24, 0.62, 8), mat(T, spec.outfit)); torso.position.y = 0.31; torso.castShadow = true; hips.add(torso);
    if (spec.skirt) { var sk = new T.Mesh(new T.ConeGeometry(0.34, 0.36, 10, 1, true), mat(T, spec.outfit, { side: T.DoubleSide })); sk.position.y = -0.05; hips.add(sk); }
    var neck = new T.Group(); neck.position.y = 0.66; hips.add(neck);
    var head = new T.Group(); head.position.y = 0.2; neck.add(head);
    var face = new T.Mesh(new T.IcosahedronGeometry(0.2, 1), mat(T, spec.skin)); face.castShadow = true; head.add(face);
    var hairMat = mat(T, spec.hair);
    // 髮帽往後仰，前緣停在額頭、不蓋住眼睛（2026-10-28 截圖檢查：原本的角度讓部分髮型整個蓋住臉）
    var cap = new T.Mesh(new T.SphereGeometry(0.215, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat);
    cap.rotation.x = [-0.5, -0.62, -0.75][spec.bangs]; head.add(cap);
    if (spec.hairLen === 1) { var bob = new T.Mesh(new T.CylinderGeometry(0.22, 0.24, 0.26, 10, 1, true), hairMat); bob.position.set(0, -0.06, -0.02); head.add(bob); }
    if (spec.hairLen === 2) { var lng = new T.Mesh(new T.BoxGeometry(0.4, 0.55, 0.12), hairMat); lng.position.set(0, -0.22, -0.13); head.add(lng); }
    if (spec.hairLen === 3) [-1, 1].forEach(function (sx) { var tail = new T.Mesh(new T.SphereGeometry(0.1, 8, 6), hairMat); tail.position.set(0.24 * sx, -0.08, -0.04); tail.scale.y = 1.8; head.add(tail); });
    var eyeMat = mat(T, "#2b2238");
    [-1, 1].forEach(function (sx) { var e = new T.Mesh(new T.SphereGeometry(0.028, 6, 4), eyeMat); e.position.set(0.075 * sx, 0.02, 0.185); head.add(e); });
    if (spec.acc === 1) { var gl = new T.Mesh(new T.TorusGeometry(0.05, 0.008, 4, 12), mat(T, "#222")); [-1, 1].forEach(function (sx) { var g2 = gl.clone(); g2.position.set(0.075 * sx, 0.02, 0.2); head.add(g2); }); }
    if (spec.acc === 0 || spec.acc === 3) { var bow = new T.Mesh(new T.OctahedronGeometry(0.06), mat(T, spec.acc === 0 ? "#ff4f8b" : "#ffd66b", { emissive: "#331111" })); bow.position.set(0.14, 0.18, 0); head.add(bow); }
    if (spec.acc === 4) { var hp = new T.Mesh(new T.TorusGeometry(0.22, 0.02, 4, 16, Math.PI), mat(T, "#333")); hp.position.y = 0.04; head.add(hp); }
    if (spec.acc === 5) { var cap2 = new T.Mesh(new T.CylinderGeometry(0.2, 0.24, 0.06, 12), mat(T, "#c62828")); cap2.position.y = 0.2; cap2.rotation.z = 0.2; head.add(cap2); }
    function arm(sx) {
      var sh = new T.Group(); sh.position.set(0.27 * sx, 0.56, 0); hips.add(sh);
      var up = limb(T, 0.3, 0.055, spec.outfit); sh.add(up);
      var el2 = new T.Group(); el2.position.y = -0.3; up.add(el2);
      var lo = limb(T, 0.28, 0.045, spec.skin); el2.add(lo);
      var hand = new T.Group(); hand.position.y = -0.3; lo.add(hand);
      hand.add(new T.Mesh(new T.SphereGeometry(0.05, 6, 4), mat(T, spec.skin)));
      return { sh: sh, el: el2, hand: hand };
    }
    function leg(sx) {
      var hp2 = new T.Group(); hp2.position.set(0.11 * sx, 0, 0); hips.add(hp2);
      var th = limb(T, 0.44, 0.07, spec.skirt ? spec.skin : "#2b2840"); hp2.add(th);
      var kn = new T.Group(); kn.position.y = -0.44; th.add(kn);
      var sh2 = limb(T, 0.42, 0.055, spec.skin); kn.add(sh2);
      var shoe = new T.Mesh(new T.BoxGeometry(0.1, 0.06, 0.18), mat(T, "#1b1b1f")); shoe.position.set(0, -0.45, 0.04); sh2.add(shoe);
      return { hip: hp2, knee: kn };
    }
    var rig = { root: root, hips: hips, neck: neck, head: head, armL: arm(1), armR: arm(-1), legL: leg(1), legR: leg(-1) };
    if (motion === "sing") { var mic = new T.Mesh(new T.CylinderGeometry(0.02, 0.012, 0.18, 6), mat(T, "#888", { metalness: 0.8 })); mic.position.y = -0.06; rig.armR.hand.add(mic); }
    if (motion === "play") { var gt = new T.Mesh(new T.BoxGeometry(0.5, 0.18, 0.06), mat(T, "#a0522d")); gt.position.set(0, 0.3, 0.2); gt.rotation.z = 0.5; hips.add(gt); }
    if (motion === "award") { var tr = new T.Mesh(new T.ConeGeometry(0.06, 0.22, 8), mat(T, "#ffd66b", { metalness: 0.9, roughness: 0.2, emissive: "#3a2a00" })); tr.position.y = -0.08; tr.rotation.x = Math.PI; rig.armR.hand.add(tr); }
    return rig;
  }

  function resetPose(r) {
    [r.armL, r.armR].forEach(function (a) { a.sh.rotation.set(0, 0, 0); a.el.rotation.set(0, 0, 0); });
    [r.legL, r.legR].forEach(function (l) { l.hip.rotation.set(0, 0, 0); l.knee.rotation.set(0, 0, 0); });
    r.hips.rotation.set(0, 0, 0); r.head.rotation.set(0, 0, 0); r.root.rotation.y = 0;
    r.hips.position.y = 0.92; r.root.position.z = 0;   // 有些動作會改高度與前後位置，每一幀先歸位
  }

  // 動作：依時間 t（秒）與每人的相位 p 計算關節角度
  var MOTIONS = {
    sing: function (r, t, p) { r.armR.sh.rotation.x = -2.1; r.armR.el.rotation.x = -0.7; r.armL.sh.rotation.z = 0.5 + 0.35 * Math.sin(t * 2 + p); r.root.rotation.y = 0.18 * Math.sin(t * 1.1 + p); r.head.rotation.z = 0.12 * Math.sin(t * 2 + p); r.hips.position.y = 0.92 + 0.02 * Math.sin(t * 4 + p); },
    dance: function (r, t, p) {
      var b = t * 6 + p, s = Math.sin(b);
      r.hips.position.y = 0.88 + 0.07 * Math.abs(s);
      r.armL.sh.rotation.z = 1.3 + 0.9 * s; r.armR.sh.rotation.z = -1.3 + 0.9 * s;
      r.armL.el.rotation.x = -0.6; r.armR.el.rotation.x = -0.6;
      r.legL.hip.rotation.x = 0.45 * s; r.legR.hip.rotation.x = -0.45 * s;
      r.legL.knee.rotation.x = Math.max(0, 0.7 * s); r.legR.knee.rotation.x = Math.max(0, -0.7 * s);
      r.root.rotation.y = 0.6 * Math.sin(t * 1.4 + p);
    },
    play: function (r, t, p) { r.armL.sh.rotation.x = -0.9; r.armL.el.rotation.x = -1.2; r.armR.sh.rotation.x = -0.5; r.armR.el.rotation.x = -0.9 + 0.35 * Math.sin(t * 12 + p); r.head.rotation.x = 0.15 + 0.1 * Math.sin(t * 6 + p); r.hips.position.y = 0.92 + 0.02 * Math.sin(t * 6 + p); },
    act: function (r, t, p) { var g = Math.sin(t * 0.9 + p); r.armR.sh.rotation.x = -0.8 - 0.6 * Math.max(0, g); r.armR.sh.rotation.z = -0.4; r.armL.sh.rotation.z = 0.3 + 0.3 * Math.max(0, -g); r.head.rotation.y = 0.5 * g; r.root.rotation.y = 0.3 * Math.sin(t * 0.5 + p); },
    host: function (r, t, p) { var g = Math.sin(t * 1.6 + p); r.armR.sh.rotation.x = -1.1 - 0.3 * g; r.armR.sh.rotation.z = -0.6; r.armL.sh.rotation.x = -0.5; r.armL.el.rotation.x = -0.8; r.root.rotation.y = 0.35 * Math.sin(t * 0.7 + p); r.head.rotation.x = -0.05 * g; },
    pose: function (r, t, p) { var k = Math.floor((t + p) / 2) % 3; r.armL.sh.rotation.z = [0.3, 2.4, 0.6][k]; r.armR.sh.rotation.z = [-2.4, -0.3, -0.6][k]; r.armR.el.rotation.x = [-0.3, 0, -1.6][k]; r.hips.rotation.z = [0.08, -0.08, 0][k]; r.root.rotation.y = [0.4, -0.4, 0][k]; },
    walk: function (r, t, p) { var b = t * 4 + p, s = Math.sin(b); r.legL.hip.rotation.x = 0.5 * s; r.legR.hip.rotation.x = -0.5 * s; r.legL.knee.rotation.x = Math.max(0, -0.6 * s); r.legR.knee.rotation.x = Math.max(0, 0.6 * s); r.armL.sh.rotation.x = -0.4 * s; r.armR.sh.rotation.x = 0.4 * s; r.hips.rotation.y = 0.12 * s; r.root.position.z = ((t * 0.6 + p) % 4) - 1; },
    bow: function (r, t, p) { var c = (t + p) % 3, b = c < 1.2 ? Math.sin(c / 1.2 * Math.PI) : 0; r.hips.rotation.x = 0.8 * b; r.armR.sh.rotation.z = c >= 1.2 ? -2.6 + 0.3 * Math.sin(t * 8) : 0; },
    award: function (r, t, p) { var u = Math.min(1, t / 2); r.armR.sh.rotation.x = -2.6 * u; r.armL.sh.rotation.z = 0.4 + 0.5 * u * Math.sin(t * 6 + p); r.hips.position.y = 0.92 + 0.03 * Math.abs(Math.sin(t * 5)); }
  };

  // ---------- 場景 ----------
  function buildScene(T, kind, q) {
    var g = new T.Group(), updaters = [], hi = q === "high";
    function add(m) { g.add(m); return m; }
    function box(w, h, d, color, x, y, z, o) { var m = add(new T.Mesh(new T.BoxGeometry(w, h, d), mat(T, color, o))); m.position.set(x, y, z); m.receiveShadow = true; return m; }
    var floorColor = { concert: "#120c24", filmset: "#3a3a40", studio: "#ece6f5", booth: "#2a2432", theater: "#3a2416", news: "#1a2238", stream: "#1c1630", runway: "#101018", awards: "#2a1a08" }[kind];
    var floor = add(new T.Mesh(new T.CircleGeometry(12, 32), mat(T, floorColor, { roughness: 0.35, metalness: kind === "concert" || kind === "runway" ? 0.4 : 0.05 })));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    if (kind === "concert" || kind === "awards") {
      var colors = kind === "awards" ? ["#ffd66b", "#fff1b8", "#ffb347"] : ["#ff5fa8", "#a66bff", "#4dd0e1"];
      colors.forEach(function (c, i) {
        var cone = add(new T.Mesh(new T.ConeGeometry(1.4, 6, 16, 1, true), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.12, side: T.DoubleSide, depthWrite: false })));
        cone.position.set((i - 1) * 2.4, 3, -0.5);
        updaters.push(function (t) { cone.rotation.z = 0.35 * Math.sin(t * 0.8 + i * 2); cone.material.opacity = 0.08 + 0.06 * Math.sin(t * 3 + i); });
      });
      var wall = box(10, 4, 0.2, "#05030f", 0, 2, -3, { emissive: kind === "awards" ? "#3a2a00" : "#1a0b3a" });
      updaters.push(function (t) { wall.material.emissiveIntensity = 0.6 + 0.4 * Math.sin(t * 2); });
      var n = hi ? 700 : 200, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), cc = new T.Color();
      for (var i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 16; pos[i * 3 + 1] = 0.9 + Math.random() * 0.8; pos[i * 3 + 2] = 4 + Math.random() * 6;
        cc.set(colors[i % 3]); col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
      }
      var geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(pos, 3));
      geo.setAttribute("color", new T.BufferAttribute(col, 3));
      var pts = add(new T.Points(geo, new T.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, opacity: 0.9 })));
      updaters.push(function (t) { pts.position.y = 0.15 * Math.sin(t * 5); });
      if (kind === "awards") { box(2.4, 0.3, 1.2, "#ffd66b", 0, 0.15, 0, { metalness: 0.7, roughness: 0.3 }); }
      else box(9, 0.3, 4, "#1d1540", 0, 0.15, 0, { metalness: 0.3 });
    } else if (kind === "filmset") {
      box(0.5, 0.4, 0.8, "#222", 2.2, 1.4, 3); box(0.08, 1.3, 0.08, "#555", 2.2, 0.65, 3);
      [-3, 3].forEach(function (x) { var p = box(1.2, 1.6, 0.05, "#fff", x, 1.8, 1.5, { emissive: "#ffffff", emissiveIntensity: 0.5 }); p.rotation.y = x > 0 ? -0.6 : 0.6; });
      box(10, 4, 0.2, "#4a4e5a", 0, 2, -3);
    } else if (kind === "studio" || kind === "booth") {
      var back = add(new T.Mesh(new T.CylinderGeometry(6, 6, 5, 24, 1, true, Math.PI * 0.75, Math.PI * 0.5), mat(T, kind === "studio" ? "#ffd1e8" : "#3a2f4a", { side: T.DoubleSide })));
      back.position.set(0, 2.5, 3);
      if (kind === "booth") [-0.8, 0.8].forEach(function (x) { box(0.05, 1.5, 0.05, "#777", x, 0.75, 0.6); box(0.12, 0.2, 0.12, "#444", x, 1.55, 0.6); });
      else [-3, 3].forEach(function (x) { box(1, 1, 0.1, "#fff", x, 2.2, 1, { emissive: "#ffffff", emissiveIntensity: 0.4 }); });
    } else if (kind === "theater") {
      [-1, 1].forEach(function (s) { for (var k = 0; k < 6; k++) { var c = add(new T.Mesh(new T.CylinderGeometry(0.18, 0.18, 5, 6), mat(T, "#8e1b1b"))); c.position.set(s * (2.6 + k * 0.3), 2.5, -1.5 + k * 0.05); } });
      box(8, 0.4, 4, "#5a3a22", 0, 0.2, 0);
    } else if (kind === "news") {
      box(2.6, 0.9, 0.8, "#2e86de", 0, 0.45, 0.8, { metalness: 0.4 });
      var scr = box(5, 2.6, 0.1, "#0a1830", 0, 2.2, -2.5, { emissive: "#1d4f8f" });
      updaters.push(function (t) { scr.material.emissiveIntensity = 0.7 + 0.2 * Math.sin(t * 1.5); });
    } else if (kind === "stream") {
      var mon = box(3.2, 1.9, 0.1, "#111", 0, 2.1, -2, { emissive: "#69f0ae", emissiveIntensity: 0.25 });
      updaters.push(function (t) { mon.material.emissive.setHSL((t * 0.05) % 1, 0.8, 0.5); });
      [-1, 1].forEach(function (s) { box(0.05, 3, 0.05, "#a66bff", s * 3, 1.5, -1.5, { emissive: "#a66bff" }); });
    } else if (kind === "runway") {
      box(1.6, 0.3, 10, "#202030", 0, 0.15, 1, { metalness: 0.5, roughness: 0.2 });
      var flashes = [];
      for (var f = 0; f < (hi ? 8 : 4); f++) {
        var fl = new T.PointLight("#ffffff", 0, 4);
        fl.position.set((f % 2 ? 2 : -2), 1.2, f * 1.2 - 2); g.add(fl); flashes.push(fl);
      }
      updaters.push(function (t) { flashes.forEach(function (fl, i) { fl.intensity = Math.sin(t * 7 + i * 13) > 0.97 ? 3 : 0; }); });
    }
    return { group: g, update: function (t) { updaters.forEach(function (u) { u(t); }); } };
  }

  // ---------- 疊加字卡 ----------
  function overlay(opts) {
    return el("div", { class: "sv-stage-ui" }, [
      el("div", { class: "sv-stage-title" }, [el("b", { text: opts.title || "" }), opts.sub ? el("div", { class: "sv-small", text: opts.sub }) : null]),
      el("div", { class: "sv-stage-names", text: opts.performers.map(function (p) { return p.name; }).join("・") })
    ]);
  }
  function endCard(opts, close) {
    var key = "sv_stage_result_" + (opts.kind === "awards" ? "award" : opts.result || "success");
    return el("div", { class: "sv-stage-end sv-stage-end-" + (opts.kind === "awards" ? "great" : opts.result || "success") }, [
      el("div", { class: "sv-stage-end-result", text: t(key) }),
      opts.stars ? el("div", { class: "sv-stars sv-stage-end-stars", text: new Array(opts.stars + 1).join("★") }) : null,
      UI.btn(t("sv_stage_close"), close, "sv-btn-primary", { "data-act": "stage-close" })
    ]);
  }

  // ---------- 2D 後備 ----------
  function play2d(view, opts, onDone) {
    var stage = el("div", { class: "sv-stage-2d sv-stage-2d-" + Spec.plan(opts).scene }, opts.performers.map(function (p, i) {
      var a = UI.avatar({ look: p.look, rarity: p.rarity, dir: opts.dir }, 96);
      a.style.animationDelay = (i * 0.15) + "s";
      return el("div", { class: "sv-stage-2d-actor" }, [a]);
    }));
    view.appendChild(stage);
    var timer = setTimeout(onDone, Spec.plan(opts).duration * 1000);
    return function () { clearTimeout(timer); };
  }

  // ---------- 3D ----------
  function play3d(T, view, opts, onDone) {
    var q = quality(), plan = Spec.plan(opts);
    var w = view.clientWidth || 360, h = view.clientHeight || 480;
    var renderer = new T.WebGLRenderer({ antialias: q === "high", alpha: false });
    renderer.setPixelRatio(q === "high" ? Math.min(2, window.devicePixelRatio || 1) : 1);
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = q === "high";
    view.appendChild(renderer.domElement);
    var scene = new T.Scene();
    scene.background = new T.Color(plan.scene === "studio" ? "#d8cfe8" : "#07040f");
    scene.fog = new T.Fog(scene.background, 10, 26);
    var cam = new T.PerspectiveCamera(42, w / h, 0.1, 60);
    scene.add(new T.HemisphereLight("#ffffff", "#332244", 0.7));
    var key = new T.DirectionalLight("#ffffff", 0.9);
    key.position.set(3, 6, 5); key.castShadow = q === "high";
    if (key.castShadow) { key.shadow.mapSize.set(1024, 1024); }
    scene.add(key);
    var set = buildScene(T, plan.scene, q);
    scene.add(set.group);
    var y0 = plan.scene === "concert" || plan.scene === "theater" || plan.scene === "runway" || plan.scene === "awards" ? 0.3 : 0;
    var xs = Spec.slots(opts.performers.length), rigs = opts.performers.map(function (p, i) {
      var r = buildRig(T, Spec.rig(p.look, p.gender), plan.motion);
      r.root.position.set(xs[i], y0, 0);
      r.phase = i * 0.7;
      scene.add(r.root);
      return r;
    });
    var start = performance.now(), raf = 0, stopped = false;
    function frame() {
      if (stopped) return;
      var tt = (performance.now() - start) / 1000;
      if (tt >= plan.duration) { onDone(); return; }
      var shot = plan.shots[plan.shots.length - 1];
      plan.shots.forEach(function (s) { if (tt >= s.start && tt < s.end) shot = s; });
      var c = Spec.camera(shot.kind, (tt - shot.start) / (shot.end - shot.start), xs[0], y0);
      cam.position.set(c.pos[0], c.pos[1], c.pos[2]);
      cam.lookAt(c.look[0], c.look[1], c.look[2]);
      rigs.forEach(function (r) { resetPose(r); MOTIONS[plan.motion](r, tt, r.phase); });
      set.update(tt);
      renderer.render(scene, cam);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return function () {
      stopped = true;
      cancelAnimationFrame(raf);
      scene.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      renderer.dispose();
    };
  }

  function play(opts) {
    opts.performers = (opts.performers || []).slice(0, 5);
    return new Promise(function (resolve) {
      var stop = null, endTimer = null;
      UI.openModal(function (box, close) {
        var view = el("div", { class: "sv-stage" });
        var loadingNode = el("div", { class: "sv-stage-loading", text: t("sv_stage_loading") });
        var skip = UI.btn(t("sv_stage_skip"), finish, "sv-btn-ghost sv-stage-skip", { "data-act": "stage-skip" });
        box.appendChild(view);
        box.appendChild(overlay(opts));
        box.appendChild(skip);
        var ended = false;
        function finish() {
          if (ended) return;
          ended = true;
          if (stop) stop();
          stop = null;
          skip.hidden = true;
          box.appendChild(endCard(opts, close));
          endTimer = setTimeout(close, END_CARD_MS);
        }
        if (quality() === "off" || !available()) { stop = play2d(view, opts, finish); return; }
        view.appendChild(loadingNode);
        load().then(function (T) {
          if (ended) return;
          if (loadingNode.parentNode) loadingNode.parentNode.removeChild(loadingNode);
          try { stop = play3d(T, view, opts, finish); } catch (e) { stop = play2d(view, opts, finish); }
        }, function () {
          if (ended) return;
          if (loadingNode.parentNode) loadingNode.parentNode.removeChild(loadingNode);
          stop = play2d(view, opts, finish);
        });
      }, { cls: "sv-stage-modal", locked: true, onClose: function () { clearTimeout(endTimer); if (stop) stop(); resolve(); } });
    });
  }

  // buildRig／resetPose 也給 3D 設施圖（starv_office3d.js）用，人物外觀與演出一致
  window.PriTestStarvStage3D = { available: available, quality: quality, setQuality: setQuality, load: load, play: play, buildRig: buildRig, resetPose: resetPose };
})();
