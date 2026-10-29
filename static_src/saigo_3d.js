// 賽狗賽狗（saigo）：3D 建模與轉播畫面（three.js r149，第一次用到時才載入 #sg-app[data-three-src]）。
// 只負責「畫」：狗的模型依犬種參數程序生成（體型、腿長、吻長、耳、尾、花紋、毛色），動作依模擬記錄的模式（跑、跳、鑽、游、接飛盤、吃、坐…）計算。
// 鏡頭：tv 轉播導播（側拍／直升機／正面／關卡定點／終點）、chase 跟拍、pov 第一視角、aerial 空拍。
// 名次與結果完全由 saigo_core.js 的模擬決定，這裡只依時間內插播放，所以每台裝置畫的是同一場比賽。
(function () {
  "use strict";

  var D = window.PriTestSaigoData;
  var Core = window.PriTestSaigoCore;
  var M = Core.MODE;
  var SIZE_SCALE = [0, 0.42, 0.55, 0.72, 0.9, 1.08];
  var HALF_W = 3 * Core.LANE_W + 1.2;   // 跑道半寬
  var WATER_TOP = 0.32;                 // 游泳池水面高度
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
    var app = document.getElementById("sg-app"), src = app && app.getAttribute("data-three-src");
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
  function sizeScale(breedId) { var b = D.BREED_BY_ID[breedId] || D.BREEDS[0]; return SIZE_SCALE[b.size]; }

  // 路上一點（超出 0〜L 時沿起點／終點方向延伸）→ three 座標
  function P(course, s, off) {
    var L = course.length;
    if (s < 0 || s > L) {
      var e = Core.pointAt(course, s < 0 ? 0 : L, off), d = s < 0 ? s : s - L;
      return { x: e.x + Math.cos(e.h) * d, z: e.y + Math.sin(e.h) * d, h: e.h };
    }
    var p = Core.pointAt(course, s, off);
    return { x: p.x, z: p.y, h: p.h };
  }

  function mat(T, color, o) {
    var opts = { color: color, roughness: 0.75, metalness: 0.02, flatShading: true };
    Object.keys(o || {}).forEach(function (k) { opts[k] = o[k]; });
    return new T.MeshStandardMaterial(opts);
  }
  function mesh(T, geo, m, cast) { var x = new T.Mesh(geo, m); if (cast) x.castShadow = true; return x; }

  // 號碼布／號碼牌的貼圖
  function numberTex(T, gate, round) {
    var c = document.createElement("canvas"); c.width = c.height = 64;
    var g = c.getContext("2d");
    g.fillStyle = D.GATE_COLORS[gate];
    if (round) { g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill(); g.lineWidth = 3; g.strokeStyle = "#333"; g.stroke(); }
    else g.fillRect(0, 0, 64, 64);
    g.fillStyle = D.GATE_TEXT[gate];
    g.font = "bold 44px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(gate + 1), 32, 35);
    var tx = new T.CanvasTexture(c);
    return tx;
  }

  // ---------------- 狗的模型 ----------------
  // 模型朝 +X，原點在地面。回傳 { root, parts }，parts 給動畫用
  function buildDog(T, breedId, gate) {
    var b = D.BREED_BY_ID[breedId] || D.BREEDS[0], m = b.model;
    var S = SIZE_SCALE[b.size];
    var c1 = mat(T, m.c1), c2 = mat(T, m.c2), dark = mat(T, "#1a1512"), nose = mat(T, "#111");
    var root = new T.Group(), body = new T.Group();
    root.add(body);
    var legLen = 0.5 * m.leg, bodyY = legLen + 0.18, bl = m.body;
    body.position.y = bodyY;
    var torso = mesh(T, new T.SphereGeometry(1, 12, 8), c1, true); torso.scale.set(0.45 * bl, 0.2, 0.19); body.add(torso);
    var chest = mesh(T, new T.SphereGeometry(1, 10, 8), m.pat === 1 || m.pat === 4 ? c2 : c1, true); chest.scale.set(0.2, 0.22, 0.2); chest.position.set(0.25 * bl, 0.02, 0); body.add(chest);
    if (m.pat === 1) { var belly = mesh(T, new T.SphereGeometry(1, 10, 6), c2); belly.scale.set(0.36 * bl, 0.13, 0.15); belly.position.y = -0.08; body.add(belly); }
    if (m.pat === 3) { var saddle = mesh(T, new T.SphereGeometry(1, 10, 6), c2); saddle.scale.set(0.3 * bl, 0.1, 0.175); saddle.position.set(-0.05 * bl, 0.11, 0); body.add(saddle); }
    if (m.pat === 2) {
      var sp = new T.SphereGeometry(0.035, 6, 4);
      [[0.2, 0.12, 0.12], [-0.1, 0.16, 0.08], [-0.3, 0.1, -0.1], [0.05, 0.05, -0.17], [-0.2, -0.02, 0.17], [0.3, 0.1, -0.12], [-0.38, 0.0, 0.1], [0.12, 0.18, -0.04]].forEach(function (q) {
        var s2 = mesh(T, sp, c2); s2.position.set(q[0] * bl, q[1], q[2]); body.add(s2);
      });
    }
    // 號碼布：背上兩側
    var bibTex = numberTex(T, gate, false), bibMat = new T.MeshStandardMaterial({ map: bibTex, roughness: 0.9 });
    [-1, 1].forEach(function (sz) {
      var bib = new T.Mesh(new T.PlaneGeometry(0.26, 0.16), bibMat);
      bib.position.set(-0.04 * bl, 0.06, 0.196 * sz); if (sz < 0) bib.rotation.y = Math.PI; body.add(bib);
    });
    var strip = mesh(T, new T.BoxGeometry(0.26, 0.02, 0.4), mat(T, D.GATE_COLORS[gate])); strip.position.set(-0.04 * bl, 0.19, 0); body.add(strip);

    // 頭
    var neck = new T.Group(); neck.position.set(0.36 * bl, 0.12, 0); body.add(neck);
    var head = new T.Group(); head.position.set(0.1, 0.12, 0); neck.add(head);
    var skull = mesh(T, new T.SphereGeometry(0.15, 10, 8), c1, true); skull.scale.set(1.05, 0.95, 0.9); head.add(skull);
    var snoutLen = 0.2 * m.snout + 0.03;
    var snout = mesh(T, new T.BoxGeometry(snoutLen, 0.09, 0.1), m.pat === 4 || m.pat === 1 ? c2 : c1, true); snout.position.set(0.1 + snoutLen / 2, -0.04, 0); head.add(snout);
    var nz = mesh(T, new T.SphereGeometry(0.028, 6, 4), nose); nz.position.set(0.1 + snoutLen, -0.01, 0); head.add(nz);
    [-1, 1].forEach(function (sz) {
      var eye = mesh(T, new T.SphereGeometry(0.021, 6, 4), dark); eye.position.set(0.11, 0.04, 0.065 * sz); head.add(eye);
      if (m.pat === 4) { var brow = mesh(T, new T.SphereGeometry(0.02, 5, 4), c2); brow.position.set(0.11, 0.08, 0.06 * sz); head.add(brow); }
      var ear;
      if (m.ear === "prick" || m.ear === "bat") {
        var r = m.ear === "bat" ? 0.075 : 0.055, h = m.ear === "bat" ? 0.17 : 0.14;
        ear = mesh(T, new T.ConeGeometry(r, h, 4), c1, true); ear.position.set(-0.02, 0.15, 0.075 * sz); ear.rotation.x = 0.25 * sz * (m.ear === "bat" ? 2 : 1);
      } else if (m.ear === "fold") {
        ear = mesh(T, new T.ConeGeometry(0.05, 0.12, 4), c1, true); ear.position.set(0.0, 0.14, 0.075 * sz); ear.rotation.z = -0.9; ear.rotation.x = 0.3 * sz;
      } else {
        ear = mesh(T, new T.BoxGeometry(0.07, 0.17, 0.035), m.pat === 3 ? c2 : c1, true); ear.position.set(-0.02, -0.02, 0.135 * sz); ear.rotation.x = 0.15 * sz;
      }
      head.add(ear);
    });
    // 腿
    function leg(x, z) {
      var hip = new T.Group(); hip.position.set(x, -0.05, z); body.add(hip);
      var up = mesh(T, new T.CylinderGeometry(0.048, 0.04, legLen / 2, 6), c1, true); up.position.y = -legLen / 4; hip.add(up);
      var knee = new T.Group(); knee.position.y = -legLen / 2; hip.add(knee);
      var lo = mesh(T, new T.CylinderGeometry(0.036, 0.032, legLen / 2, 6), m.pat === 1 ? c2 : c1, true); lo.position.y = -legLen / 4; knee.add(lo);
      var paw = mesh(T, new T.SphereGeometry(0.042, 6, 4), m.pat === 1 ? c2 : c1); paw.position.set(0.02, -legLen / 2, 0); paw.scale.set(1.3, 0.7, 1); knee.add(paw);
      return { hip: hip, knee: knee };
    }
    var legs = [leg(0.28 * bl, 0.1), leg(0.28 * bl, -0.1), leg(-0.3 * bl, 0.1), leg(-0.3 * bl, -0.1)];
    // 尾巴
    var tail = new T.Group(); tail.position.set(-0.44 * bl, 0.08, 0); body.add(tail);
    if (m.tail === "curl") { var tc = mesh(T, new T.TorusGeometry(0.085, 0.035, 5, 10, Math.PI * 1.6), c1, true); tc.position.set(0.04, 0.1, 0); tc.rotation.y = Math.PI / 2; tc.rotation.x = Math.PI / 2; tail.add(tc); }
    else if (m.tail === "bob") { tail.add(mesh(T, new T.SphereGeometry(0.05, 6, 4), c1)); }
    else if (m.tail === "plume") { var pl = mesh(T, new T.ConeGeometry(0.07, 0.36, 6), m.pat === 4 ? c2 : c1, true); pl.position.y = 0.17; tail.add(pl); tail.rotation.z = 1.0; }
    else { var ts = mesh(T, new T.CylinderGeometry(0.018, 0.03, 0.32, 5), c1, true); ts.position.y = 0.16; tail.add(ts); tail.rotation.z = 1.2; }

    root.scale.setScalar(S);
    return { root: root, body: body, head: head, neck: neck, legs: legs, tail: tail, S: S, legLen: legLen, bodyY: bodyY, phase: gate * 1.3 };
  }

  // 動畫：st＝{ v, mode }，span＝目前動作區段 { t0, t1, ev }，extra＝{ jumpH, climbPitch }
  function animateDog(d, v, mode, sp, t, dt) {
    var body = d.body, legs = d.legs;
    var stride = 1.5 * d.S;
    d.phase += (v / Math.max(0.4, stride)) * Math.PI * 2 * dt * 0.5;
    var ph = d.phase, amp = 0.7 * clamp(v / 6, 0.15, 1);
    var y = d.bodyY, pitch = 0, headPitch = 0, headY = 0.12, roll = 0;
    var swing = [Math.sin(ph), Math.sin(ph + 0.5), Math.sin(ph + Math.PI), Math.sin(ph + Math.PI + 0.5)];
    var knees = [0, 0, 0, 0], hips = [0, 0, 0, 0], k;
    for (k = 0; k < 4; k++) { hips[k] = swing[k] * amp * (k < 2 ? -1 : 1); knees[k] = (k < 2 ? 1 : -1) * Math.max(0, Math.sin(ph + k * 0.5 + (k < 2 ? 0.8 : Math.PI + 0.8))) * amp * 1.1; }
    y += Math.abs(Math.sin(ph)) * 0.05 * clamp(v / 6, 0, 1);
    pitch = Math.sin(ph * 2) * 0.06 * clamp(v / 6, 0, 1);
    if (v < 0.3 && mode === M.run) { for (k = 0; k < 4; k++) { hips[k] = 0; knees[k] = 0; } }
    if (mode === M.wade) {
      // 涉水：抬高腳步
      for (k = 0; k < 4; k++) { hips[k] *= 0.8; knees[k] = (k < 2 ? 1 : -1) * (0.6 + Math.max(0, Math.sin(ph + k)) * 0.9); }
      y += 0.04;
    } else if (mode === M.jump || mode === M.dive) {
      for (k = 0; k < 4; k++) { hips[k] = k < 2 ? -0.9 : 0.9; knees[k] = k < 2 ? 0.3 : -0.3; }
      pitch = sp ? (0.5 - sp.p) * 0.5 : 0;
    } else if (mode === M.crawl) {
      y = d.bodyY * 0.62; for (k = 0; k < 4; k++) { hips[k] *= 0.6; knees[k] = (k < 2 ? 1 : -1) * 0.9; }
      headY = 0.06; headPitch = -0.15;
    } else if (mode === M.swim) {
      y = ((d.wt || WATER_TOP) - 0.06) / d.S; for (k = 0; k < 4; k++) hips[k] = Math.sin(ph * 1.6 + k * 1.5) * 0.7;
      headPitch = 0.35; pitch = -0.1;
    } else if (mode === M.catch) {
      for (k = 0; k < 4; k++) { hips[k] = 0; knees[k] = 0; }
      var p = sp ? sp.p : 0;
      headPitch = 0.4 + 0.4 * Math.sin(Math.PI * p);
      if (sp && sp.ev !== "catchMiss" && p > 0.55 && p < 0.85) y += Math.sin((p - 0.55) / 0.3 * Math.PI) * 0.35;
    } else if (mode === M.eat) {
      for (k = 0; k < 4; k++) { hips[k] = 0; knees[k] = 0; }
      headPitch = -1.0; headY = 0.0; pitch = -0.12;
    } else if (mode === M.sit) {
      hips = [0.1, 0.1, -1.1, -1.1]; knees = [0, 0, 2.1, 2.1];
      pitch = 0.5; y = d.bodyY * 0.72; headPitch = 0.25;
    } else if (mode === M.stun) {
      roll = Math.sin(t * 18) * 0.15; pitch = -0.15;
    } else if (mode === M.mud) {
      for (k = 0; k < 4; k++) knees[k] *= 1.4;
    } else if (mode === M.wait) {
      // 停下來觀望：四腳站好、左右張望
      for (k = 0; k < 4; k++) { hips[k] = 0; knees[k] = 0; }
      headPitch = 0.15; roll = Math.sin(t * 2.4) * 0.05;
    } else if (mode === M.ride) {
      // 站在板子上：腳張開微蹲、身體左右平衡
      hips = [-0.25, -0.25, 0.3, 0.3]; knees = [0.35, 0.35, -0.45, -0.45];
      y = d.bodyY * 0.9; roll = Math.sin(t * 3.1 + d.phase) * 0.12; headPitch = 0.1;
    } else if (mode === M.slide) {
      // 溜滑梯：前腳伸直、後腳收起
      hips = [-0.7, -0.7, 1.0, 1.0]; knees = [0.2, 0.2, 1.4, 1.4];
      y = d.bodyY * 0.78; headPitch = 0.2;
    } else if (mode === M.fin) {
      // 衝過終點後慢慢停下
    }
    for (k = 0; k < 4; k++) { legs[k].hip.rotation.z = hips[k]; legs[k].knee.rotation.z = knees[k]; }
    body.position.y = y;
    body.rotation.z = pitch;
    body.rotation.x = roll;
    d.neck.rotation.z = headPitch;
    d.head.position.y = headY;
    d.tail.rotation.x = Math.sin(t * 9 + d.phase) * 0.35;
  }

  // ---------------- 場景 ----------------
  // 天空／霧／光線依天氣；地面與跑道顏色依地形（下雪時非雪山地形的地面也會積雪）
  var WX_LOOK = {
    sunny: { sky: 0x86c1ee, fog: [120, 450], sun: 1.0 }, cloudy: { sky: 0xa9b8c6, fog: [90, 330], sun: 0.7 },
    hot: { sky: 0x9fd0f5, fog: [110, 420], sun: 1.15 }, rain: { sky: 0x8a96a2, fog: [60, 240], sun: 0.55 },
    snow: { sky: 0xc9d3dc, fog: [50, 220], sun: 0.6 }, windy: { sky: 0x9cc4e6, fog: [100, 380], sun: 0.95 },
    typhoon: { sky: 0x5d6a74, fog: [25, 150], sun: 0.4 }, blizzard: { sky: 0xdfe6ea, fog: [12, 95], sun: 0.55 },
    sandstorm: { sky: 0xc9a26a, fog: [10, 90], sun: 0.6 }, fog: { sky: 0xc7ccd0, fog: [8, 75], sun: 0.6 }
  };
  var TERRAIN_LOOK = {
    park: { ground: 0x5f9a46, track: null },
    forest: { ground: 0x3f6f35, track: [0.5, 0.38, 0.26] },
    snowmtn: { ground: 0xeef3f6, track: [0.88, 0.9, 0.95] },
    desert: { ground: 0xd9b778, track: [0.86, 0.72, 0.5] },
    beach: { ground: 0xe8d6a8, track: [0.8, 0.7, 0.52] }
  };
  function weatherLook(card) {
    var w = WX_LOOK[card.weather] || WX_LOOK.sunny, tl = TERRAIN_LOOK[card.terrain] || TERRAIN_LOOK.park;
    var ground = tl.ground;
    if ((card.weather === "snow" || card.weather === "blizzard") && card.terrain !== "snowmtn") ground = 0xdfe7ea;
    return { sky: w.sky, fog: w.fog, sun: w.sun, ground: ground };
  }
  var TRACK_COLOR = { firm: [0.73, 0.55, 0.36], good: [0.62, 0.46, 0.3], soft: [0.52, 0.38, 0.25], heavy: [0.44, 0.32, 0.22] };
  var GROUND_SHADE = { firm: 1, good: 0.94, soft: 0.86, heavy: 0.78 };

  // 坡道的高度（其餘為 0）與坡度：平滑的 (1−cos)/2 起伏，兩端坡度為 0
  function trackY(course, s) {
    if (s < 0 || s > course.length) return 0;
    var p = Core.partAt(course, s);
    if (p.type !== "hill") return 0;
    return p.hh * (1 - Math.cos(2 * Math.PI * (s - p.s0) / p.len)) / 2;
  }
  function trackSlope(course, s) {
    if (s < 0 || s > course.length) return 0;
    var p = Core.partAt(course, s);
    if (p.type !== "hill") return 0;
    return p.hh * Math.PI / p.len * Math.sin(2 * Math.PI * (s - p.s0) / p.len);
  }
  var NO_FENCE = { pool: 1, bridge: 1 };

  // 高架關卡（爬高牆、平衡木、溜滑梯、階梯、蹬牆連跳）的高度輪廓：local＝關卡內里程，S＝體型倍率
  function elevH(p, S) {
    if (p.type === "climbwall") return 0.5 + 1.3 * S;
    if (p.type === "dogwalk") return 0.6 + 0.4 * S;
    if (p.type === "slide") return 0.8 + 1.0 * S;
    if (p.type === "ski") return 2.4;
    if (p.type === "stairs") return 0.9 + 0.6 * S;
    if (p.type === "wallkick") return 1.0 + 1.2 * S;
    return 0;
  }
  function elevY(p, local, S) {
    var H = elevH(p, S), L = p.len, u;
    if (!H) return 0;
    if (p.type === "climbwall") return local < L * 0.35 ? H * local / (L * 0.35) : local < L * 0.65 ? H : H * (L - local) / (L * 0.35);
    if (p.type === "dogwalk") return local < L * 0.25 ? H * local / (L * 0.25) : local < L * 0.75 ? H : H * (L - local) / (L * 0.25);
    if (p.type === "slide") return local < L * 0.3 ? H * local / (L * 0.3) : H * (L - local) / (L * 0.7);
    if (p.type === "stairs") return local < L * 0.55 ? H * local / (L * 0.55) : H * (L - local) / (L * 0.45);
    if (p.type === "ski") { u = local / L; return H * (1 - u) * (1 - u); }   // 滑雪：從高台一路滑下來，坡度越來越緩
    if (p.type === "wallkick") {
      var kz = L * 0.8;
      if (local < kz) return H * local / kz;
      u = (local - kz) / (L - kz);
      return H * (1 - u * u);
    }
    return 0;
  }
  var HURDLE_LIKE = { hurdle: 1, hurdlerace: 1 };
  function hurdleH(p, S) { return p.type === "hurdlerace" ? 0.15 + 0.3 * S : 0.22 + 0.45 * S; }
  // 圓形通道：θ∈[0,2π] 對應的跑道方向位移 u、高度 y（一圈之後回到地面，往前推進 LOOP_C）
  function loopAt(theta) {
    var R = Core.LOOP_R;
    return { u: 1.6 * R * Math.sin(theta) + R * theta, y: R * (1 - Math.cos(theta)), du: R * (1.6 * Math.cos(theta) + 1), dy: R * Math.sin(theta) };
  }

  function buildTrack(T, scene, card) {
    var course = card.course, L = course.length, tl = TERRAIN_LOOK[card.terrain] || TERRAIN_LOOK.park;
    var shade = GROUND_SHADE[card.ground] || 1;
    var tc = tl.track ? tl.track.map(function (c) { return c * shade; }) : (TRACK_COLOR[card.ground] || TRACK_COLOR.firm);
    if ((card.weather === "snow" || card.weather === "blizzard") && card.terrain !== "snowmtn") tc = [0.86, 0.86, 0.88];
    var pos = [], col = [], idx = [], s, k = 0;
    var S0 = -25, S1 = L + 70;
    function partColor(sv) {
      if (sv < 0 || sv > L) return tc;
      var p = Core.partAt(course, sv);
      if (p.type === "pool") return p.kind === "shallow" ? [0.6, 0.85, 0.8] : p.kind === "stream" ? [0.35, 0.5, 0.45] : [0.55, 0.78, 0.86];
      if (p.type === "bridge") return [0.16, 0.36, 0.5];
      if (p.type === "ditch") { var dl = sv - p.s0, d0 = p.len / 2 - p.dw / 2; if (dl >= d0 && dl <= d0 + p.dw) return [0.12, 0.26, 0.36]; }
      if (p.type === "conveyor") return [0.22, 0.22, 0.24];
      if (p.type === "sprinkler") return tc.map(function (c) { return c * 0.82; });
      if (p.type === "tirerun" || p.type === "ballpit") return [0.36, 0.62, 0.32];
      if (p.type === "surf") return [0.2, 0.55, 0.78];
      if (p.type === "ski") return [0.94, 0.96, 0.99];
      if (p.type === "skateboard") return [0.55, 0.55, 0.58];
      if (p.type === "mud") return p.kind === "snow" ? [0.95, 0.97, 1] : p.kind === "sand" ? [0.92, 0.8, 0.57] : [0.3, 0.21, 0.13];
      return tc;
    }
    for (s = S0; s <= S1; s += 1) {
      var a = P(course, s, HALF_W), b = P(course, s, -HALF_W), y = trackY(course, s), c = partColor(s);
      var stripe = (Math.floor(s / 4) % 2 ? 0.97 : 1);
      pos.push(a.x, y + 0.01, a.z, b.x, y + 0.01, b.z);
      col.push(c[0] * stripe, c[1] * stripe, c[2] * stripe, c[0] * stripe, c[1] * stripe, c[2] * stripe);
      if (k > 0) { var i = k * 2; idx.push(i - 2, i - 1, i, i - 1, i + 1, i); }
      k++;
    }
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    var tr = new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: T.DoubleSide }));
    tr.receiveShadow = true; scene.add(tr);
    // 坡道兩側的土堤（從地面接到坡頂，看起來是一座小丘）
    course.parts.forEach(function (p) {
      if (p.type !== "hill") return;
      var bp = [], bi = [], n = 0;
      for (var q = 0; q <= p.len; q += 1) {
        var yy = trackY(course, p.s0 + q);
        [HALF_W, HALF_W + 2 + yy * 2.5, -HALF_W, -HALF_W - 2 - yy * 2.5].forEach(function (off, m) {
          var pp = P(course, p.s0 + q, off); bp.push(pp.x, m % 2 ? 0 : yy, pp.z);
        });
        if (n > 0) { var o = n * 4; bi.push(o - 4, o - 3, o, o - 3, o + 1, o, o - 2, o + 2, o - 1, o - 1, o + 2, o + 3); }
        n++;
      }
      var bg = new T.BufferGeometry(); bg.setAttribute("position", new T.Float32BufferAttribute(bp, 3)); bg.setIndex(bi); bg.computeVertexNormals();
      var hc = p.kind === "snow" ? "#eef3f6" : p.kind === "dune" ? "#d8b679" : "#5b8f43";
      scene.add(new T.Mesh(bg, mat(T, hc, { side: T.DoubleSide })));
    });

    // 跑道分隔線（虛線）
    var lp = [];
    for (var ln = 0; ln <= 6; ln++) {
      var off = (ln - 3) * Core.LANE_W;
      for (s = 0; s < L; s += 2) {
        var pt = Core.partAt(course, s).type;
        if (pt === "pool" || pt === "bridge" || pt === "conveyor" || pt === "ditch" || pt === "surf" || pt === "ski") continue;
        var p1 = P(course, s, off), p2 = P(course, s + 1, off);
        lp.push(p1.x, trackY(course, s) + 0.03, p1.z, p2.x, trackY(course, s + 1) + 0.03, p2.z);
      }
    }
    var lg = new T.BufferGeometry(); lg.setAttribute("position", new T.Float32BufferAttribute(lp, 3));
    scene.add(new T.LineSegments(lg, new T.LineBasicMaterial({ color: card.terrain === "snowmtn" ? 0x5a8fc0 : 0xffffff, transparent: true, opacity: 0.55 })));

    // 外柵欄：柱子＋橫桿（instanced；坡道上跟著高度與坡度）
    var posts = [], rails = [];
    for (s = S0; s <= S1; s += 3) {
      [1, -1].forEach(function (sd) {
        var p = P(course, s, sd * (HALF_W + 0.4)), q = P(course, s + 3, sd * (HALF_W + 0.4));
        if (s >= 0 && s <= L && (NO_FENCE[Core.partAt(course, s).type] || NO_FENCE[Core.partAt(course, Math.min(L, s + 3)).type])) return;
        var y1 = trackY(course, s), y2 = trackY(course, s + 3), flat = Math.hypot(q.x - p.x, q.z - p.z);
        posts.push([p.x, p.z, y1]);
        rails.push([(p.x + q.x) / 2, (p.z + q.z) / 2, Math.atan2(q.z - p.z, q.x - p.x), Math.hypot(flat, y2 - y1), (y1 + y2) / 2, Math.atan2(y2 - y1, flat)]);
      });
    }
    var fenceCol = card.terrain === "forest" || card.terrain === "beach" ? "#8d6e4f" : "#f4f4f0";
    var white = mat(T, fenceCol);
    var pm = new T.InstancedMesh(new T.BoxGeometry(0.1, 1, 0.1), white, posts.length);
    var rm = new T.InstancedMesh(new T.BoxGeometry(1, 0.08, 0.08), white, rails.length);
    var o3 = new T.Object3D();
    posts.forEach(function (q, i) { o3.position.set(q[0], 0.5 + q[2], q[1]); o3.rotation.set(0, 0, 0); o3.scale.set(1, 1, 1); o3.updateMatrix(); pm.setMatrixAt(i, o3.matrix); });
    o3.rotation.order = "YZX";
    rails.forEach(function (q, i) { o3.position.set(q[0], 0.95 + q[4], q[1]); o3.rotation.set(0, -q[2], q[5]); o3.scale.set(q[3], 1, 1); o3.updateMatrix(); rm.setMatrixAt(i, o3.matrix); });
    scene.add(pm); scene.add(rm);
  }

  // 激流的水紋貼圖（每幀移動 offset）
  function stripeTex(T, a, b) {
    var c = document.createElement("canvas"); c.width = 64; c.height = 16;
    var g = c.getContext("2d"); g.fillStyle = a; g.fillRect(0, 0, 64, 16);
    g.fillStyle = b; for (var i = 0; i < 6; i++) g.fillRect(i * 11 + (i % 2) * 3, (i * 5) % 14, 6, 2);
    var tx = new T.CanvasTexture(c); tx.wrapS = tx.wrapT = T.RepeatWrapping; return tx;
  }
  var DOCK_H = 0.6, BRIDGE_Y = 0.4;
  var SEESAW_HP = 0.36, SEESAW_A = Math.atan2(0.36, 2);   // 蹺蹺板支點高度與傾斜角（板長 4 m，一端著地）
  function waterTop(kind) { return kind === "shallow" ? 0.14 : kind === "deep" ? 0.42 : WATER_TOP; }

  // 每個關卡在各跑道上的道具（關卡都在直線段上，方向固定）
  function buildObstacles(T, scene, card, props) {
    var course = card.course;
    var sizes = card.dogs.map(function (d) { return sizeScale(d.breed); });
    var red = mat(T, "#e53935"), wht = mat(T, "#f5f5f5"), blue = mat(T, "#1e88e5"), yel = mat(T, "#fdd835"), grn = mat(T, "#43a047");
    var wood = mat(T, "#8d5a32"), rock = mat(T, "#8a8a85"), snowM = mat(T, "#f5f8fa");
    function place(obj, s, off, y) { var p = P(course, s, off); obj.position.set(p.x, y || 0, p.z); obj.rotation.y = -p.h; scene.add(obj); return obj; }
    function grp1(m) { var g = new T.Group(); g.add(m); return g; }
    course.parts.forEach(function (p) {
      var lane, q;
      if (p.type === "hurdle") {
        var gap = p.len / (p.bars + 1), hk = p.kind || "bar";
        for (var j = 1; j <= p.bars; j++) {
          if (hk === "log" || hk === "snowbank") {
            // 倒木／雪堆：一整條橫跨全部跑道
            var big = hk === "log" ? mesh(T, new T.CylinderGeometry(0.28, 0.32, HALF_W * 2 + 1, 10), wood, true) : mesh(T, new T.SphereGeometry(1, 12, 6), snowM, true);
            if (hk === "log") { big.rotation.x = Math.PI / 2; big.position.y = 0.3; }
            else big.scale.set(0.9, 0.55, HALF_W + 0.5);
            place(grp1(big), p.s0 + gap * j, 0);
            continue;
          }
          for (lane = 0; lane < 6; lane++) {
            var S = sizes[lane], h = 0.22 + 0.45 * S, grp = new T.Group();
            if (hk === "hay") {
              var bale = mesh(T, new T.CylinderGeometry(h / 2 + 0.05, h / 2 + 0.05, 1.3, 10), mat(T, "#d9b25f"), true);
              bale.rotation.x = Math.PI / 2; bale.position.y = h / 2 + 0.05; grp.add(bale);
            } else if (hk === "tire") {
              var R = 0.3 + 0.35 * S, cy = 0.3 + 1.1 * S;
              var tire = mesh(T, new T.TorusGeometry(R, 0.09, 6, 16), mat(T, "#222"), true); tire.rotation.y = Math.PI / 2; tire.position.y = cy; grp.add(tire);
              [-1, 1].forEach(function (sd) { var post = mesh(T, new T.CylinderGeometry(0.04, 0.04, cy + R + 0.2, 5), wht); post.position.set(0, (cy + R + 0.2) / 2, sd * (R + 0.15)); grp.add(post); });
            } else {
              [-1, 1].forEach(function (sd) { var post = mesh(T, new T.CylinderGeometry(0.04, 0.04, h + 0.25, 6), wht, true); post.position.set(0, (h + 0.25) / 2, sd * 0.7); grp.add(post); });
              var bar = mesh(T, new T.CylinderGeometry(0.035, 0.035, 1.4, 6), (j + lane) % 2 ? red : blue, true); bar.rotation.x = Math.PI / 2; bar.position.y = h; grp.add(bar);
              props.bars[lane + ":" + p.s0 + ":" + j] = { mesh: bar, h: h };
            }
            place(grp, p.s0 + gap * j, Core.laneOff(lane));
          }
        }
      } else if (p.type === "tunnel") {
        for (lane = 0; lane < 6; lane++) {
          var r = Math.min(0.72, 0.22 + 0.55 * sizes[lane]);
          var tg = new T.CylinderGeometry(r, r, p.len, 14, 1, true, 0, Math.PI);
          // 半透明，鑽在裡面的狗看得到；雪山是冰洞色
          var tcol = card.terrain === "snowmtn" ? (lane % 2 ? "#e1f5fe" : "#b3e5fc") : ["#e53935", "#1e88e5", "#fdd835", "#43a047", "#8e24aa", "#fb8c00"][lane];
          var tube = mesh(T, tg, mat(T, tcol, { side: T.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false }), false);
          // 圓柱軸轉到跑道方向（局部 +X），θ∈[0,π] 那一半朝上＝拱形隧道
          tube.rotation.z = Math.PI / 2;
          place(grp1(tube), p.s0 + p.len / 2, Core.laneOff(lane));
        }
      } else if (p.type === "frisbee") {
        for (lane = 0; lane < 6; lane++) {
          var ring = mesh(T, new T.RingGeometry(0.6, 0.75, 20), yel); ring.rotation.x = -Math.PI / 2;
          place(grp1(ring), p.s0 + p.len * 0.5, Core.laneOff(lane), 0.03);
          var man = person(T, ["#3949ab", "#00897b", "#c62828", "#6d4c41", "#5e35b1", "#f57c00"][lane]);
          place(man, p.s0 + p.len * 0.5 + 6, Core.laneOff(lane) + 0.8);
          props.throwers[lane + ":" + p.s0] = P(course, p.s0 + p.len * 0.5 + 6, Core.laneOff(lane) + 0.8);
        }
      } else if (p.type === "weave") {
        for (lane = 0; lane < 6; lane++) for (var w = 1; w < p.len - 0.5; w += 2) {
          var pole = mesh(T, new T.CylinderGeometry(0.03, 0.03, 0.5 + 0.8 * sizes[lane], 5), (w % 4 === 1) ? red : wht, true);
          pole.position.y = (0.5 + 0.8 * sizes[lane]) / 2;
          place(grp1(pole), p.s0 + w, Core.laneOff(lane));
        }
      } else if (p.type === "pool") {
        var pk = p.kind || "std", top = waterTop(pk), w0 = pk === "dock" ? Core.DOCK_RUN : 0, wl = p.len - w0;
        var wcol = { std: 0x2f9be0, deep: 0x1565c0, shallow: 0x66d9e8, stream: 0x3a8fb7, dock: 0x2f9be0, ice: 0xa7dcef }[pk];
        var wm = new T.MeshStandardMaterial({ color: wcol, transparent: true, opacity: pk === "deep" ? 0.82 : 0.72, roughness: 0.1, metalness: 0.1 });
        if (pk === "stream") { wm.color.set(0xffffff); wm.map = stripeTex(T, "#3a8fb7", "#d7f0ff"); wm.map.repeat.set(wl / 4, 3); props.flows.push(wm.map); }
        place(grp1(new T.Mesh(new T.BoxGeometry(wl, top, HALF_W * 2), wm)), p.s0 + w0 + wl / 2, 0, top / 2);
        if (pk === "stream" || pk === "shallow") {
          // 自然水域：岸邊是石頭，不是池壁
          for (q = 0; q < wl * 1.2; q++) {
            var st = mesh(T, new T.DodecahedronGeometry(0.25 + ((q * 13) % 7) / 14, 0), rock, true); st.scale.y = 0.6;
            place(grp1(st), p.s0 + w0 + ((q * 37) % (wl * 10)) / 10, (q % 2 ? 1 : -1) * (HALF_W + 0.4), 0.1);
          }
        } else {
          var wallH = top + (pk === "deep" ? 0.45 : 0.15), wallM = pk === "ice" ? snowM : wht;
          [-1, 1].forEach(function (sd) { place(grp1(mesh(T, new T.BoxGeometry(wl + 0.6, wallH, 0.3), wallM)), p.s0 + w0 + wl / 2, sd * (HALF_W + 0.15), wallH / 2); });
          [0, 1].forEach(function (e) { if (!(pk === "dock" && e === 0)) place(grp1(mesh(T, new T.BoxGeometry(0.3, top + 0.05, HALF_W * 2), wallM)), p.s0 + w0 + e * wl, 0, (top + 0.05) / 2); });
        }
        if (pk === "dock") place(grp1(mesh(T, new T.BoxGeometry(Core.DOCK_RUN, DOCK_H, HALF_W * 2), wood, true)), p.s0 + Core.DOCK_RUN / 2, 0, DOCK_H / 2);
        if (pk === "ice") {
          var iceM = mat(T, "#ffffff", { transparent: true, opacity: 0.85 });
          for (q = 0; q < wl * 0.8; q++) {
            var ice = mesh(T, new T.BoxGeometry(0.5 + (q % 3) * 0.3, 0.12, 0.4 + (q % 4) * 0.2), iceM);
            ice.rotation.y = q; place(grp1(ice), p.s0 + w0 + ((q * 53) % (wl * 10)) / 10, (((q * 71) % 100) / 100 - 0.5) * HALF_W * 1.8, top);
          }
        }
      } else if (p.type === "mud") {
        var bm = mat(T, p.kind === "snow" ? "#ffffff" : p.kind === "sand" ? "#d9bb80" : "#4a3320");
        for (q = 0; q < p.len * 2; q++) {
          var lump = mesh(T, new T.SphereGeometry(0.3 + ((q * 37) % 10) / 20, 6, 4), bm); lump.scale.y = p.kind === "snow" ? 0.45 : 0.25;
          place(grp1(lump), p.s0 + ((q * 53) % (p.len * 10)) / 10, (((q * 71) % 100) / 100 - 0.5) * HALF_W * 1.8, 0);
        }
      } else if (p.type === "aframe") {
        for (lane = 0; lane < 6; lane++) {
          var H = 0.4 + 1.1 * sizes[lane], half = p.len / 2, slope = Math.atan2(H, half), plen = Math.hypot(H, half);
          var ag = new T.Group();
          [-1, 1].forEach(function (sd) {
            var board = mesh(T, new T.BoxGeometry(plen, 0.06, 1.0), sd < 0 ? yel : mat(T, "#5d4037"), true);
            board.position.set(sd * half / 2, H / 2, 0); board.rotation.z = -sd * slope; ag.add(board);
          });
          place(ag, p.s0 + half, Core.laneOff(lane));
        }
      } else if (p.type === "treat") {
        for (lane = 0; lane < 6; lane++) {
          var bowl = mesh(T, new T.CylinderGeometry(0.22, 0.15, 0.12, 10), mat(T, "#c62828")); bowl.position.y = 0.06;
          var meat = mesh(T, new T.SphereGeometry(0.13, 6, 4), mat(T, "#8d4b2a")); meat.position.y = 0.14; meat.scale.y = 0.5;
          var bg = new T.Group(); bg.add(bowl); bg.add(meat);
          place(bg, p.s0 + p.len * 0.3 + 1.2, Core.laneOff(lane) - 0.55);
        }
      } else if (p.type === "stay") {
        for (lane = 0; lane < 6; lane++) {
          var mt = mesh(T, new T.BoxGeometry(1.4, 0.04, 1.4), lane % 2 ? grn : blue); mt.position.y = 0.02;
          place(grp1(mt), p.s0 + p.len * 0.5 + 0.3, Core.laneOff(lane));
        }
      } else if (p.type === "bridge") {
        // 河流（橫跨整個畫面）＋每條跑道一座吊橋
        place(grp1(new T.Mesh(new T.BoxGeometry(p.len + 4, 0.04, 140), new T.MeshStandardMaterial({ color: 0x2a6f99, roughness: 0.2 }))), p.s0 + p.len / 2, 0, 0.02);
        var rope = mat(T, "#c8a46e");
        for (lane = 0; lane < 6; lane++) {
          var bgp = new T.Group();
          var deck = mesh(T, new T.BoxGeometry(p.len, 0.08, 1.05), wood, true); deck.position.y = BRIDGE_Y - 0.04; bgp.add(deck);
          [-1, 1].forEach(function (sd) {
            var rp = mesh(T, new T.CylinderGeometry(0.025, 0.025, p.len, 4), rope); rp.rotation.z = Math.PI / 2; rp.position.set(0, BRIDGE_Y + 0.75, sd * 0.55); bgp.add(rp);
            for (var e2 = 0; e2 <= p.len; e2 += 3) { var ps = mesh(T, new T.CylinderGeometry(0.04, 0.04, 0.8, 4), wood); ps.position.set(e2 - p.len / 2, BRIDGE_Y + 0.35, sd * 0.55); bgp.add(ps); }
          });
          place(bgp, p.s0 + p.len / 2, Core.laneOff(lane));
        }
      }
    });
    buildObstacles2(T, scene, card, props, place, grp1, sizes);
  }

  // 新關卡（2026-10-29）的道具：每條跑道一組，體型越大的狗道具越高
  function buildObstacles2(T, scene, card, props, place, grp1, sizes) {
    var course = card.course, lane, q;
    var red = mat(T, "#e53935"), wht = mat(T, "#f5f5f5"), blue = mat(T, "#1e88e5"), yel = mat(T, "#fdd835"), grn = mat(T, "#43a047");
    var wood = mat(T, "#8d5a32"), dark = mat(T, "#263238"), orange = mat(T, "#fb8c00"), pink = mat(T, "#ec407a"), purple = mat(T, "#8e24aa");
    var LC = ["#e53935", "#1e88e5", "#fdd835", "#43a047", "#8e24aa", "#fb8c00"];
    // 兩點之間的板子（local 座標：x＝跑道方向，y＝高度）
    function board(g, x0, y0, x1, y1, w, th, m) {
      var len = Math.hypot(x1 - x0, y1 - y0), b = mesh(T, new T.BoxGeometry(len, th, w), m, true);
      b.position.set((x0 + x1) / 2, (y0 + y1) / 2 - th / 2, 0); b.rotation.z = Math.atan2(y1 - y0, x1 - x0); g.add(b); return b;
    }
    function post(g, x, z, h, m, r) { var c = mesh(T, new T.CylinderGeometry(r || 0.04, r || 0.04, h, 6), m || wht, true); c.position.set(x, h / 2, z); g.add(c); return c; }
    course.parts.forEach(function (p) {
      var j, g, S, H;
      if (p.type === "hurdlerace") {
        // 田徑跨欄：低欄、黑白條紋橫桿、L 型底座
        var gap = p.len / (p.bars + 1), stripe = new T.MeshStandardMaterial({ map: stripeTex(T, "#111111", "#ffffff"), roughness: 0.6 });
        for (j = 1; j <= p.bars; j++) for (lane = 0; lane < 6; lane++) {
          var h = hurdleH(p, sizes[lane]); g = new T.Group();
          [-1, 1].forEach(function (sd) {
            post(g, 0, sd * 0.62, h, wht, 0.03);
            var foot = mesh(T, new T.BoxGeometry(0.5, 0.04, 0.06), wht); foot.position.set(-0.2, 0.02, sd * 0.62); g.add(foot);
          });
          var bar = mesh(T, new T.BoxGeometry(0.04, 0.1, 1.3), stripe, true); bar.position.y = h; g.add(bar);
          props.bars[lane + ":" + p.s0 + ":" + j] = { mesh: bar, h: h };
          place(g, p.s0 + gap * j, Core.laneOff(lane));
        }
      } else if (p.type === "firewheel") {
        // 風火輪：立在支架上的火圈，周圍一圈會閃動的火焰
        var fg = p.len / (p.rings + 1), fire = mat(T, "#ff6d00", { emissive: "#ff3d00", emissiveIntensity: 0.9 }), flame = mat(T, "#ffd54f", { emissive: "#ffab00", emissiveIntensity: 1.0 });
        for (j = 1; j <= p.rings; j++) for (lane = 0; lane < 6; lane++) {
          S = sizes[lane]; var R = 0.35 + 0.4 * S, cy = 0.55 + 0.75 * S; g = new T.Group();
          var ring = mesh(T, new T.TorusGeometry(R, 0.06, 6, 20), fire, true); ring.rotation.y = Math.PI / 2; ring.position.y = cy; g.add(ring);
          [-1, 1].forEach(function (sd) { post(g, 0, sd * (R + 0.12), cy, dark, 0.035); });
          for (q = 0; q < 10; q++) {
            var a = q / 10 * Math.PI * 2, fl = mesh(T, new T.ConeGeometry(0.07, 0.22, 5), q % 2 ? fire : flame);
            fl.position.set(0, cy + Math.sin(a) * (R + 0.08), Math.cos(a) * (R + 0.08)); fl.rotation.x = -a + Math.PI / 2;
            g.add(fl); props.flames.push({ m: fl, k: q + lane * 3 + j });
          }
          place(g, p.s0 + fg * j, Core.laneOff(lane));
        }
      } else if (p.type === "looptube") {
        // 圓形通道：沿著一整圈路線的透明管（每條跑道一條），下方有兩個支架
        for (lane = 0; lane < 6; lane++) {
          S = sizes[lane]; var rt = 0.3 + 0.4 * S, pts = [];
          for (q = 0; q <= 72; q++) {
            var th = q / 72 * Math.PI * 2, L0 = loopAt(th), nl = Math.hypot(L0.du, L0.dy) || 1;
            pts.push(new T.Vector3(L0.u - L0.dy / nl * rt, L0.y + L0.du / nl * rt, (th / (Math.PI * 2) - 0.5) * 0.6));
          }
          pts.unshift(new T.Vector3(-1.2, rt, -0.3)); pts.push(new T.Vector3(Core.LOOP_C + 1.2, rt, 0.3));
          var tube = mesh(T, new T.TubeGeometry(new T.CatmullRomCurve3(pts), 160, rt, 12, false),
            mat(T, LC[lane], { transparent: true, opacity: 0.38, side: T.DoubleSide, depthWrite: false }), false);
          g = new T.Group(); g.add(tube);
          var rimM = mat(T, "#eceff1");
          [0, Math.PI].forEach(function (th2) { var L1 = loopAt(th2); var rim = mesh(T, new T.TorusGeometry(rt + 0.02, 0.04, 5, 16), rimM); rim.position.set(L1.u, L1.y + (th2 ? -rt : rt), (th2 / (Math.PI * 2) - 0.5) * 0.6); rim.rotation.y = Math.PI / 2; g.add(rim); });
          var top = loopAt(Math.PI);
          post(g, top.u, 0.9, top.y + 2 * rt, rimM, 0.07); post(g, top.u, -0.9, top.y + 2 * rt, rimM, 0.07);
          place(g, p.s0 + Core.LOOP_IN, Core.laneOff(lane));
        }
      } else if (p.type === "climbwall") {
        // 爬高牆：陡峭的彩色攀岩板（上面有岩點）＋頂端平台＋下坡板
        for (lane = 0; lane < 6; lane++) {
          S = sizes[lane]; H = elevH(p, S); g = new T.Group();
          var L = p.len, x0 = -L / 2;
          board(g, x0, 0, x0 + L * 0.35, H, 1.1, 0.1, mat(T, LC[lane]));
          board(g, x0 + L * 0.35, H, x0 + L * 0.65, H, 1.1, 0.12, wood);
          board(g, x0 + L * 0.65, H, x0 + L, 0, 1.1, 0.08, wood);
          for (q = 0; q < 9; q++) {
            var f = (q + 0.5) / 9, hold = mesh(T, new T.DodecahedronGeometry(0.06, 0), [yel, pink, grn, purple][q % 4]);
            hold.position.set(x0 + L * 0.35 * f, H * f + 0.03, ((q * 37) % 7 / 7 - 0.5) * 0.8); g.add(hold);
          }
          [-1, 1].forEach(function (sd) { post(g, x0 + L * 0.35, sd * 0.5, H, wood, 0.06); post(g, x0 + L * 0.65, sd * 0.5, H, wood, 0.06); });
          place(g, p.s0 + L / 2, Core.laneOff(lane));
        }
      } else if (p.type === "wallkick") {
        // 蹬牆連跳：左右交錯的高牆板＋最後的平台
        var kz = p.len * 0.8, kg = kz / p.kicks;
        for (lane = 0; lane < 6; lane++) {
          S = sizes[lane]; H = elevH(p, S); g = new T.Group();
          for (j = 1; j <= p.kicks; j++) {
            var wall = mesh(T, new T.BoxGeometry(kg * 0.9, H + 0.6, 0.1), j % 2 ? mat(T, "#90a4ae") : mat(T, "#b0bec5"), true);
            wall.position.set((j - 0.5) * kg, (H + 0.6) / 2, (j % 2 ? 1 : -1) * 0.7); g.add(wall);
            var pad = mesh(T, new T.BoxGeometry(0.35, 0.35, 0.03), yel); pad.position.set((j - 0.5) * kg, H * (j - 0.5) / p.kicks + 0.25, (j % 2 ? 1 : -1) * 0.64); g.add(pad);
          }
          var plat = mesh(T, new T.BoxGeometry(0.9, 0.12, 1.2), wood, true); plat.position.set(kz, H - 0.06, 0); g.add(plat);
          [-1, 1].forEach(function (sd) { post(g, kz, sd * 0.5, H - 0.1, wood, 0.05); });
          place(g, p.s0, Core.laneOff(lane));
        }
      } else if (p.type === "seesaw") {
        // 蹺蹺板：板子的傾斜在 frame() 依每隻狗的位置更新
        for (lane = 0; lane < 6; lane++) {
          g = new T.Group();
          var piv = mesh(T, new T.ConeGeometry(0.28, SEESAW_HP, 4), dark, true); piv.position.y = SEESAW_HP / 2; g.add(piv);
          var arm = new T.Group(); arm.position.y = SEESAW_HP; g.add(arm);
          var plank = mesh(T, new T.BoxGeometry(4.2, 0.08, 0.9), lane % 2 ? yel : blue, true); plank.position.y = 0.04; arm.add(plank);
          [-1, 1].forEach(function (sd) { var tip = mesh(T, new T.BoxGeometry(0.6, 0.085, 0.92), red); tip.position.set(sd * 1.8, 0.045, 0); arm.add(tip); });
          arm.rotation.z = SEESAW_A;
          props.seesaws[lane + ":" + p.s0] = arm;
          place(g, p.s0 + p.len / 2, Core.laneOff(lane));
        }
      } else if (p.type === "dogwalk") {
        // 平衡木：上坡板、窄的高架木板、下坡板；兩端黃色的接觸區
        for (lane = 0; lane < 6; lane++) {
          S = sizes[lane]; H = elevH(p, S); g = new T.Group();
          var L2 = p.len, a0 = -L2 / 2;
          board(g, a0, 0, a0 + L2 * 0.25, H, 0.32, 0.06, yel);
          board(g, a0 + L2 * 0.25, H, a0 + L2 * 0.75, H, 0.3, 0.07, mat(T, "#6d4c41"));
          board(g, a0 + L2 * 0.75, H, a0 + L2, 0, 0.32, 0.06, yel);
          for (q = 0; q <= 2; q++) { var xx = a0 + L2 * (0.25 + 0.25 * q); post(g, xx, 0.12, H, dark, 0.03); post(g, xx, -0.12, H, dark, 0.03); }
          place(g, p.s0 + L2 / 2, Core.laneOff(lane));
        }
      } else if (p.type === "tirerun") {
        // 輪胎陣：每 1 m 一對平放的輪胎
        var tireM = mat(T, "#212121"), tg = new T.TorusGeometry(0.24, 0.08, 6, 14);
        for (lane = 0; lane < 6; lane++) for (q = 0.5; q < p.len; q += 1) [-1, 1].forEach(function (sd) {
          var tr = mesh(T, tg, tireM, true); tr.rotation.x = Math.PI / 2;
          place(grp1(tr), p.s0 + q + (sd > 0 ? 0.5 : 0), Core.laneOff(lane) + sd * 0.27, 0.08);
        });
      } else if (p.type === "ballpit") {
        // 球池：整排跑道的矮圍框＋彩色球（instanced）
        var frameM = mat(T, "#29b6f6");
        [-1, 1].forEach(function (sd) { place(grp1(mesh(T, new T.BoxGeometry(p.len, 0.4, 0.2), frameM, true)), p.s0 + p.len / 2, sd * (HALF_W - 0.1), 0.2); });
        [0, 1].forEach(function (e) { place(grp1(mesh(T, new T.BoxGeometry(0.2, 0.25, HALF_W * 2), frameM, true)), p.s0 + e * p.len, 0, 0.12); });
        var cols = ["#e53935", "#fdd835", "#1e88e5", "#43a047", "#ec407a", "#fb8c00"].map(function (c) { return new T.Color(c); });
        var nb = Math.round(p.len * HALF_W * 2 * 2.2), im = new T.InstancedMesh(new T.SphereGeometry(0.11, 6, 4), new T.MeshStandardMaterial({ roughness: 0.4 }), nb), o3 = new T.Object3D();
        for (q = 0; q < nb; q++) {
          var bp = P(course, p.s0 + ((q * 7919) % 1000) / 1000 * p.len, (((q * 104729) % 1000) / 1000 - 0.5) * (HALF_W * 2 - 0.4));
          o3.position.set(bp.x, 0.08 + ((q * 31) % 5) * 0.06, bp.z); o3.updateMatrix(); im.setMatrixAt(q, o3.matrix); im.setColorAt(q, cols[q % 6]);
        }
        scene.add(im);
      } else if (p.type === "sprinkler") {
        // 灑水陣：兩側的灑水頭，噴出旋轉的半透明水柱
        var water = mat(T, "#81d4fa", { transparent: true, opacity: 0.3, depthWrite: false, side: T.DoubleSide, flatShading: false });
        for (q = 3; q < p.len - 1; q += 6) [-1, 1].forEach(function (sd) {
          g = new T.Group(); post(g, 0, 0, 0.35, mat(T, "#546e7a"), 0.05);
          var spin = new T.Group(); spin.position.y = 0.35; g.add(spin);
          [0, Math.PI].forEach(function (a) { var jet = mesh(T, new T.ConeGeometry(0.18, HALF_W * 0.9, 8, 1, true), water); jet.rotation.z = Math.PI / 2 + 0.5; jet.position.set(Math.cos(a) * HALF_W * 0.5, 0.5, Math.sin(a) * HALF_W * 0.5); jet.rotation.y = -a; spin.add(jet); });
          props.spin.push({ m: spin, axis: "y", w: sd * 1.5 });
          place(g, p.s0 + q, sd * (HALF_W + 0.3));
        });
      } else if (p.type === "conveyor") {
        // 逆向輸送帶：整排跑道的黑色皮帶（條紋往回流動）＋兩端滾筒＋側欄
        var beltM = new T.MeshStandardMaterial({ map: stripeTex(T, "#2b2b2b", "#4a4a4a"), roughness: 0.8 });
        beltM.map.repeat.set(p.len / 2, 1); props.belts.push(beltM.map);
        place(grp1(mesh(T, new T.BoxGeometry(p.len, 0.12, HALF_W * 2), beltM)), p.s0 + p.len / 2, 0, 0.06);
        [0, 1].forEach(function (e) { var rl = mesh(T, new T.CylinderGeometry(0.1, 0.1, HALF_W * 2 + 0.2, 10), mat(T, "#9e9e9e"), true); rl.rotation.x = Math.PI / 2; place(grp1(rl), p.s0 + e * p.len, 0, 0.1); });
        [-1, 1].forEach(function (sd) { place(grp1(mesh(T, new T.BoxGeometry(p.len, 0.25, 0.12), yel, true)), p.s0 + p.len / 2, sd * (HALF_W + 0.05), 0.2); });
      } else if (p.type === "slide") {
        // 溜滑梯：梯子（兩根直桿＋橫檔）、頂台、有側板的滑道
        for (lane = 0; lane < 6; lane++) {
          S = sizes[lane]; H = elevH(p, S); g = new T.Group();
          var L3 = p.len, b0 = -L3 / 2, ladX = b0 + L3 * 0.3;
          board(g, b0, 0, ladX, H, 0.12, 0.05, dark).position.z = 0.42;
          board(g, b0, 0, ladX, H, 0.12, 0.05, dark).position.z = -0.42;
          for (q = 1; q < 8; q++) { var rung = mesh(T, new T.CylinderGeometry(0.025, 0.025, 0.84, 5), wht); rung.rotation.x = Math.PI / 2; rung.position.set(b0 + (ladX - b0) * q / 8, H * q / 8, 0); g.add(rung); }
          var deck = mesh(T, new T.BoxGeometry(0.6, 0.08, 1.0), orange, true); deck.position.set(ladX, H - 0.04, 0); g.add(deck);
          var chute = mat(T, LC[lane]);
          board(g, ladX, H, b0 + L3, 0, 0.8, 0.06, chute);
          [-1, 1].forEach(function (sd) { board(g, ladX, H + 0.2, b0 + L3, 0.2, 0.05, 0.25, chute).position.z = sd * 0.42; });
          post(g, ladX, 0.4, H, dark, 0.05); post(g, ladX, -0.4, H, dark, 0.05);
          place(g, p.s0 + L3 / 2, Core.laneOff(lane));
        }
      } else if (p.type === "trampoline") {
        // 彈跳床：圓框＋黑色彈跳布＋腳
        for (lane = 0; lane < 6; lane++) {
          S = sizes[lane]; var tr2 = 0.6 + 0.25 * S; g = new T.Group();
          var rim2 = mesh(T, new T.TorusGeometry(tr2, 0.05, 6, 22), blue, true); rim2.rotation.x = Math.PI / 2; rim2.position.y = 0.3; g.add(rim2);
          var matM = mesh(T, new T.CircleGeometry(tr2 - 0.03, 22), dark); matM.rotation.x = -Math.PI / 2; matM.position.y = 0.29; g.add(matM);
          for (q = 0; q < 4; q++) { var la = q / 4 * Math.PI * 2 + 0.4; post(g, Math.cos(la) * tr2, Math.sin(la) * tr2, 0.3, dark, 0.03); }
          place(g, p.s0 + p.len * 0.4 + 0.3, Core.laneOff(lane));
        }
      } else if (p.type === "windmill") {
        // 風車門：門框＋沿跑道方向轉動的四片葉片
        for (lane = 0; lane < 6; lane++) {
          S = sizes[lane]; var gh = 0.9 + 1.0 * S; g = new T.Group();
          [-1, 1].forEach(function (sd) { post(g, 0, sd * 0.7, gh + 0.4, wht, 0.05); });
          var beam = mesh(T, new T.BoxGeometry(0.1, 0.1, 1.5), wht); beam.position.y = gh + 0.4; g.add(beam);
          var hub = new T.Group(); hub.position.set(-0.15, gh * 0.55, 0); g.add(hub);
          for (q = 0; q < 4; q++) { var blade = mesh(T, new T.BoxGeometry(0.04, gh * 0.5, 0.18), q % 2 ? red : wht, true); blade.position.y = gh * 0.25; var bh = new T.Group(); bh.rotation.x = q * Math.PI / 2; bh.add(blade); hub.add(bh); }
          props.spin.push({ m: hub, axis: "x", w: 2.2 + lane * 0.15 });
          place(g, p.s0 + 3.2, Core.laneOff(lane));
        }
      } else if (p.type === "catzone") {
        // 貓咪誘惑區：跑道兩側木箱上坐著貓（尾巴會擺）
        var catCols = ["#ff9800", "#424242", "#f5f5f5", "#8d6e63"];
        for (q = 0; q < 6; q++) {
          var sd = q % 2 ? 1 : -1; g = new T.Group();
          var crate = mesh(T, new T.BoxGeometry(0.7, 0.6, 0.7), wood, true); crate.position.y = 0.3; g.add(crate);
          var cm = mat(T, catCols[q % 4]);
          var cb = mesh(T, new T.SphereGeometry(0.2, 8, 6), cm, true); cb.scale.set(1, 1.2, 0.9); cb.position.y = 0.82; g.add(cb);
          var ch = mesh(T, new T.SphereGeometry(0.13, 8, 6), cm, true); ch.position.set(0, 1.12, -sd * 0.04); g.add(ch);
          [-1, 1].forEach(function (e) { var ear = mesh(T, new T.ConeGeometry(0.045, 0.1, 4), cm); ear.position.set(e * 0.07, 1.24, -sd * 0.04); g.add(ear); });
          var tail = new T.Group(); tail.position.set(0, 0.7, sd * 0.18); g.add(tail);
          var tl = mesh(T, new T.CylinderGeometry(0.025, 0.03, 0.4, 5), cm); tl.position.y = 0.2; tail.add(tl);
          props.spin.push({ m: tail, axis: "wag", w: 3 + q });
          place(g, p.s0 + p.len * (0.2 + 0.12 * q), sd * (HALF_W + 0.9));
        }
      } else if (p.type === "sled") {
        // 拖輪胎：起點擺著一排輪胎，拖曳中的輪胎在 frame() 跟著狗
        for (lane = 0; lane < 6; lane++) { var st2 = mesh(T, new T.TorusGeometry(0.28, 0.1, 6, 14), mat(T, "#212121"), true); st2.rotation.x = Math.PI / 2; place(grp1(st2), p.s0 - 1.2, Core.laneOff(lane), 0.1); }
        var flag = mesh(T, new T.BoxGeometry(0.05, 0.4, 0.6), orange); flag.position.y = 1.0;
        [-1, 1].forEach(function (sd) { var fgp = new T.Group(); post(fgp, 0, 0, 1.2, wht, 0.03); fgp.add(flag.clone()); place(fgp, p.s0 + p.len, sd * (HALF_W + 0.3)); });
      } else if (p.type === "ditch") {
        // 跳溝：橫跨所有跑道的水溝（水面略低於地面）＋兩岸的石塊
        var d0 = p.len / 2 - p.dw / 2;
        place(grp1(new T.Mesh(new T.BoxGeometry(p.dw, 0.05, HALF_W * 2 + 2), new T.MeshStandardMaterial({ color: 0x1f5f7a, transparent: true, opacity: 0.85, roughness: 0.15 }))), p.s0 + d0 + p.dw / 2, 0, 0.02);
        var rockM = mat(T, "#8a8a85");
        for (q = 0; q < 26; q++) {
          var rk = mesh(T, new T.DodecahedronGeometry(0.16 + (q % 3) * 0.05, 0), rockM, true); rk.scale.y = 0.6;
          place(grp1(rk), p.s0 + d0 + (q % 2 ? p.dw : 0), ((q >> 1) / 12 - 0.5) * (HALF_W * 2), 0.04);
        }
      } else if (p.type === "surf") {
        // 衝浪：整排跑道的海水（浪紋往前流）＋一道道白色浪頭＋兩側浮標
        var seaM = new T.MeshStandardMaterial({ map: stripeTex(T, "#1e88c8", "#7fd3f5"), transparent: true, opacity: 0.9, roughness: 0.1 });
        seaM.map.repeat.set(p.len / 3, 2); props.belts.push(seaM.map);
        place(grp1(mesh(T, new T.BoxGeometry(p.len, 0.06, HALF_W * 2 + 3), seaM)), p.s0 + p.len / 2, 0, 0.04);
        var foam = mat(T, "#ffffff", { transparent: true, opacity: 0.85 });
        for (q = 4; q < p.len; q += 6) { var wv = mesh(T, new T.CylinderGeometry(0.18, 0.18, HALF_W * 2 + 2, 8), foam); wv.rotation.x = Math.PI / 2; wv.scale.set(1, 1, 0.45); var wg = grp1(wv); place(wg, p.s0 + q, 0, 0.1); props.waves.push({ m: wg, k: q }); }
        for (q = 0; q <= p.len; q += 5) [-1, 1].forEach(function (sd) { place(grp1(mesh(T, new T.SphereGeometry(0.2, 8, 6), q % 10 ? yel : red, true)), p.s0 + q, sd * (HALF_W + 0.8), 0.15); });
      } else if (p.type === "skateboard") {
        // 滑板：灰色水泥路面上的三角筒與兩側的 U 型半管
        for (q = 3; q < p.len - 1; q += 4) for (lane = 0; lane < 6; lane++) {
          var cone = mesh(T, new T.ConeGeometry(0.12, 0.35, 8), orange, true); cone.position.y = 0.175;
          place(grp1(cone), p.s0 + q, Core.laneOff(lane) + (Math.floor(q / 4) % 2 ? 0.45 : -0.45));
        }
        [-1, 1].forEach(function (sd) {
          var pipe = mesh(T, new T.CylinderGeometry(1.4, 1.4, p.len, 16, 1, true, 0, Math.PI / 2), mat(T, "#b0bec5", { side: T.DoubleSide }), true);
          pipe.rotation.z = Math.PI / 2; pipe.rotation.x = sd > 0 ? 0 : Math.PI / 2;
          place(grp1(pipe), p.s0 + p.len / 2, sd * (HALF_W + 1.4), 1.4);
        });
      } else if (p.type === "ski") {
        // 滑雪：雪白的長坡（起點高台）＋旗門（紅藍交錯）＋兩側雪堆
        var snowW = mat(T, "#f5f9fc"), Hs = elevH(p, 1), bp2 = [], bi2 = [], nq = 0;
        for (q = 0; q <= p.len; q += 1) {
          var yy2 = elevY(p, q, 1);
          [-(HALF_W + 1.5), HALF_W + 1.5].forEach(function (off2) { var pp2 = P(course, p.s0 + q, off2); bp2.push(pp2.x, yy2 + 0.02, pp2.z); });
          if (nq > 0) { var o4 = nq * 2; bi2.push(o4 - 2, o4 - 1, o4, o4 - 1, o4 + 1, o4); }
          nq++;
        }
        var sg2 = new T.BufferGeometry(); sg2.setAttribute("position", new T.Float32BufferAttribute(bp2, 3)); sg2.setIndex(bi2); sg2.computeVertexNormals();
        var slope = new T.Mesh(sg2, snowW); slope.material.side = T.DoubleSide; slope.receiveShadow = true; scene.add(slope);
        var tower = mesh(T, new T.BoxGeometry(2, Hs, HALF_W * 2 + 3), mat(T, "#cfd8dc"), true); place(grp1(tower), p.s0 - 1, 0, Hs / 2);
        for (q = 5; q < p.len - 2; q += 5) for (lane = 0; lane < 6; lane++) {
          var gate = new T.Group(), fm = Math.floor(q / 5) % 2 ? red : blue, gx = (Math.floor(q / 5) % 2 ? 0.55 : -0.55);
          post(gate, 0, gx, 0.9, fm, 0.02);
          var flg = mesh(T, new T.BoxGeometry(0.02, 0.3, 0.35), fm); flg.position.set(0, 0.75, gx + 0.18); gate.add(flg);
          place(gate, p.s0 + q, Core.laneOff(lane), elevY(p, q, 1));
        }
        for (q = 0; q < p.len; q += 3) [-1, 1].forEach(function (sd) { var mound = mesh(T, new T.SphereGeometry(0.6, 8, 5), snowW); mound.scale.y = 0.5; place(grp1(mound), p.s0 + q, sd * (HALF_W + 2), elevY(p, q, 1)); });
      } else if (p.type === "stairs") {
        // 階梯：實心台階＋頂台＋下坡板
        for (lane = 0; lane < 6; lane++) {
          S = sizes[lane]; H = elevH(p, S); g = new T.Group();
          var L4 = p.len, up = L4 * 0.55, n = Math.max(3, Math.round(up / 0.55)), sw = up / n, c0 = -L4 / 2, stM = mat(T, lane % 2 ? "#bcaaa4" : "#d7ccc8");
          for (q = 1; q <= n; q++) { var sh = H * q / n, step = mesh(T, new T.BoxGeometry(sw, sh, 1.1), stM, true); step.position.set(c0 + (q - 0.5) * sw, sh / 2, 0); g.add(step); }
          board(g, c0 + up, H, c0 + L4, 0, 1.1, 0.08, wood);
          place(g, p.s0 + L4 / 2, Core.laneOff(lane));
        }
      }
    });
  }

  function person(T, shirt) {
    var g = new T.Group();
    var legs = mesh(T, new T.CylinderGeometry(0.12, 0.14, 0.85, 6), mat(T, "#37474f"), true); legs.position.y = 0.43; g.add(legs);
    var torso = mesh(T, new T.CylinderGeometry(0.17, 0.2, 0.65, 8), mat(T, shirt), true); torso.position.y = 1.18; g.add(torso);
    var head = mesh(T, new T.SphereGeometry(0.13, 8, 6), mat(T, "#f1c9a5"), true); head.position.y = 1.65; g.add(head);
    var cap = mesh(T, new T.CylinderGeometry(0.14, 0.14, 0.06, 8), mat(T, shirt)); cap.position.y = 1.75; g.add(cap);
    return g;
  }

  // instanced 小工具：list＝[[x, z, 縮放, _, y 旋轉, z 傾斜]]，yOf(q) 給高度
  function instanced(T, scene, geo, m, list, yOf, shadow) {
    var im = new T.InstancedMesh(geo, m, Math.max(1, list.length)), o3 = new T.Object3D();
    im.count = list.length;
    list.forEach(function (q, n) {
      o3.position.set(q[0], yOf(q), q[1]); o3.scale.setScalar(q[2]); o3.rotation.set(0, q[4] || 0, q[5] || 0); o3.updateMatrix(); im.setMatrixAt(n, o3.matrix);
    });
    if (shadow) im.castShadow = true;
    scene.add(im);
    return im;
  }

  function buildVenue(T, scene, card) {
    var course = card.course, L = course.length, r = Core.rng((card.seed ^ 0x77aa) >>> 0);
    var terrain = card.terrain || "park";
    // 起跑閘門
    var gate = new T.Group(), steel = mat(T, "#cfd8dc"), green = mat(T, "#2e7d32");
    for (var i = 0; i <= 6; i++) { var pp = mesh(T, new T.BoxGeometry(0.9, 1.6, 0.08), steel, true); pp.position.set(-0.45, 0.8, (i - 3) * Core.LANE_W); gate.add(pp); }
    var top = mesh(T, new T.BoxGeometry(1.2, 0.25, HALF_W * 2), green, true); top.position.set(-0.45, 1.8, 0); gate.add(top);
    for (i = 0; i < 6; i++) { var nb = new T.Mesh(new T.PlaneGeometry(0.4, 0.4), new T.MeshBasicMaterial({ map: numberTex(T, i, true), transparent: true })); nb.position.set(0.16, 1.8, Core.laneOff(i)); nb.rotation.y = Math.PI / 2; gate.add(nb); }
    var p0 = P(course, 0, 0); gate.position.set(p0.x, 0, p0.z); gate.rotation.y = -p0.h; scene.add(gate);
    // 終點拱門＋終點線
    var arch = new T.Group(), ck = document.createElement("canvas"); ck.width = 128; ck.height = 16;
    var cg = ck.getContext("2d");
    for (i = 0; i < 16; i++) for (var j = 0; j < 2; j++) { cg.fillStyle = (i + j) % 2 ? "#111" : "#fff"; cg.fillRect(i * 8, j * 8, 8, 8); }
    var ckm = new T.MeshStandardMaterial({ map: new T.CanvasTexture(ck), side: T.DoubleSide });
    [-1, 1].forEach(function (sd) { var pl = mesh(T, new T.BoxGeometry(0.4, 4.2, 0.4), mat(T, "#d32f2f"), true); pl.position.set(0, 2.1, sd * (HALF_W + 0.6)); arch.add(pl); });
    var banner = new T.Mesh(new T.BoxGeometry(0.2, 0.8, HALF_W * 2 + 1.6), ckm); banner.position.y = 4.0; arch.add(banner);
    var line = new T.Mesh(new T.PlaneGeometry(0.5, HALF_W * 2), new T.MeshBasicMaterial({ color: 0xffffff })); line.rotation.x = -Math.PI / 2; line.position.y = 0.04; arch.add(line);
    var pL = P(course, L, 0); arch.position.set(pL.x, 0, pL.z); arch.rotation.y = -pL.h; scene.add(arch);
    // 看台：沿最後直線外側
    var last = course.parts[course.parts.length - 1], stand = new T.Group();
    var sLen = last.len + 30, crowdPos = [], crowdCol = [], cc = new T.Color();
    for (i = 0; i < 5; i++) {
      var tier = mesh(T, new T.BoxGeometry(sLen, 0.6, 1.6), mat(T, i % 2 ? "#90a4ae" : "#b0bec5"), true);
      tier.position.set(0, 0.3 + i * 0.6, -(HALF_W + 4 + i * 1.6)); tier.scale.y = 1 + i * 2; tier.position.y = (0.6 * (1 + i * 2)) / 2;
      stand.add(tier);
      for (var c = 0; c < sLen * 1.4; c++) {
        crowdPos.push(-sLen / 2 + r() * sLen, 0.6 * (1 + i * 2) + 0.35, -(HALF_W + 4 + i * 1.6) + (r() - 0.5) * 1.0);
        cc.setHSL(r(), 0.6, 0.35 + r() * 0.35); crowdCol.push(cc.r, cc.g, cc.b);
      }
    }
    var roof = mesh(T, new T.BoxGeometry(sLen, 0.2, 9), mat(T, "#eceff1"), true); roof.position.set(0, 7.6, -(HALF_W + 7)); stand.add(roof);
    var cgeo = new T.BufferGeometry(); cgeo.setAttribute("position", new T.Float32BufferAttribute(crowdPos, 3)); cgeo.setAttribute("color", new T.Float32BufferAttribute(crowdCol, 3));
    stand.add(new T.Points(cgeo, new T.PointsMaterial({ size: 0.32, vertexColors: true })));
    var pm = P(course, last.s0 + last.len / 2 + 8, 0); stand.position.set(pm.x, 0, pm.z); stand.rotation.y = -pm.h;
    // 看台放在跑道「右側」（-off），所以 z 負向就是外側
    scene.add(stand);

    // ---- 依地形的景物 ----
    var g = Core.geometry(course), box = g.box, cxm = (box[0] + box[2]) / 2, czm = (box[1] + box[3]) / 2;
    var seaZ = terrain === "beach" ? box[3] + 28 : Infinity;   // 海灘：海在 z 大的那一側
    var wood0 = mat(T, "#8d6e4f");
    function scatter(n, minD, spread) {
      var out = [], lx = g.x[g.N - 1], lz = g.y[g.N - 1];
      for (var a = 0; a < n * 3 && out.length < n; a++) {
        var x = box[0] - spread + r() * (box[2] - box[0] + spread * 2), z = box[1] - spread + r() * (box[3] - box[1] + spread * 2), ok = z < seaZ - 6;
        for (var k = 0; k < g.N && ok; k += 6) { var dx = g.x[k] - x, dz = g.y[k] - z; if (dx * dx + dz * dz < minD * minD) ok = false; }
        if (ok && (lx - x) * (lx - x) + (lz - z) * (lz - z) < 60 * 60) ok = false;
        if (ok) out.push([x, z, 0.7 + r() * 0.8, 0, r() * 6.28]);
      }
      return out;
    }
    var wxSnow = card.weather === "snow" || card.weather === "blizzard";
    function pines(list, snowy) {
      instanced(T, scene, new T.CylinderGeometry(0.25, 0.35, 2, 5), mat(T, "#5d4037"), list, function (q) { return q[2]; });
      instanced(T, scene, new T.ConeGeometry(2.2, 6, 7), mat(T, snowy ? "#2c4a35" : "#2f6b35"), list, function (q) { return 5 * q[2]; }, true);
      if (snowy) instanced(T, scene, new T.ConeGeometry(1.3, 2.6, 7), mat(T, "#f4f8fa"), list, function (q) { return 7.2 * q[2]; });
    }
    function broadleaf(list, col) {
      instanced(T, scene, new T.CylinderGeometry(0.25, 0.35, 3, 5), mat(T, "#5d4037"), list, function (q) { return 1.5 * q[2]; });
      instanced(T, scene, new T.IcosahedronGeometry(2.4, 0), mat(T, col), list, function (q) { return 4.2 * q[2]; }, true);
    }
    function rocks(list, col) { instanced(T, scene, new T.DodecahedronGeometry(1.2, 0), mat(T, col), list, function (q) { return 0.5 * q[2]; }, true); }
    function farHills(n, col, hMin, hMax, rMin) {
      for (var a = 0; a < n; a++) {
        var ang = (a / n) * Math.PI * 2 + r() * 0.3, R = rMin + r() * 90;
        var x = cxm + Math.cos(ang) * R, z = czm + Math.sin(ang) * R;
        if (z > seaZ) continue;
        var hh = hMin + r() * (hMax - hMin), m = new T.Mesh(new T.ConeGeometry(hh * 1.4, hh, 7), mat(T, col));
        m.position.set(x, hh / 2 - 2, z); scene.add(m);
        if (terrain === "snowmtn") { var cap = new T.Mesh(new T.ConeGeometry(hh * 0.5, hh * 0.36, 7), mat(T, "#ffffff")); cap.position.set(x, hh - hh * 0.18 - 2, z); scene.add(cap); }
      }
    }
    if (terrain === "forest") {
      pines(scatter(170, HALF_W + 5, 60), wxSnow);
      broadleaf(scatter(170, HALF_W + 5, 60), wxSnow ? "#c9d6c9" : "#4f8a3a");
      rocks(scatter(40, HALF_W + 3, 40), "#7d7a72");
      farHills(10, "#46704a", 60, 110, 380);
    } else if (terrain === "snowmtn") {
      pines(scatter(150, HALF_W + 8, 70), true);
      rocks(scatter(30, HALF_W + 6, 50), "#8d949a");
      farHills(12, "#7b8794", 120, 220, 300);
    } else if (terrain === "desert") {
      var cacti = scatter(60, HALF_W + 8, 70);
      instanced(T, scene, new T.CylinderGeometry(0.35, 0.4, 4, 8), mat(T, "#3f7d3a"), cacti, function (q) { return 2 * q[2]; }, true);
      instanced(T, scene, new T.CylinderGeometry(0.22, 0.22, 1.6, 6), mat(T, "#3f7d3a"), cacti.map(function (q) { return [q[0] + 0.6 * q[2], q[1], q[2], 0, q[4]]; }), function (q) { return 2.6 * q[2]; });
      rocks(scatter(50, HALF_W + 6, 60), "#b06a3e");
      // 遠方的平頂山（台地）
      for (i = 0; i < 9; i++) {
        var ang = (i / 9) * Math.PI * 2, R = 330 + r() * 120, hh = 40 + r() * 50;
        var mesa = new T.Mesh(new T.CylinderGeometry(50 + r() * 40, 70 + r() * 40, hh, 7), mat(T, "#b8693c"));
        mesa.position.set(cxm + Math.cos(ang) * R, hh / 2 - 2, czm + Math.sin(ang) * R); scene.add(mesa);
      }
      // 近處的沙丘
      scatter(18, HALF_W + 25, 90).forEach(function (q) { var d = new T.Mesh(new T.SphereGeometry(12 * q[2], 10, 6), mat(T, "#d4b06e")); d.scale.y = 0.25; d.position.set(q[0], -0.5, q[1]); scene.add(d); });
    } else if (terrain === "beach") {
      var palms = scatter(60, HALF_W + 6, 60);
      palms.forEach(function (q) { q[5] = 0.18; });
      instanced(T, scene, new T.CylinderGeometry(0.18, 0.28, 6, 6), mat(T, "#9c7a54"), palms, function (q) { return 3 * q[2]; }, true);
      instanced(T, scene, new T.ConeGeometry(2.6, 1.2, 7), mat(T, "#3d9a46"), palms, function (q) { return 6.2 * q[2]; }, true);
      // 海
      var sea = new T.Mesh(new T.PlaneGeometry(3000, 1500), new T.MeshStandardMaterial({ color: 0x2b8fc9, roughness: 0.15, metalness: 0.2 }));
      sea.rotation.x = -Math.PI / 2; sea.position.set(cxm, 0.03, seaZ + 750); scene.add(sea);
      // 陽傘
      scatter(20, HALF_W + 4, 25).forEach(function (q, n) {
        var um = new T.Group(), pole = mesh(T, new T.CylinderGeometry(0.04, 0.04, 2.2, 4), wood0), top2 = mesh(T, new T.ConeGeometry(1.2, 0.5, 8), mat(T, ["#e53935", "#fdd835", "#1e88e5", "#ffffff"][n % 4]), true);
        pole.position.y = 1.1; top2.position.y = 2.3; um.add(pole); um.add(top2); um.position.set(q[0], 0, q[1]); scene.add(um);
      });
      farHills(6, "#7a9a6a", 40, 80, 420);
    } else {
      pines(scatter(100, HALF_W + 9, 70), wxSnow);
      broadleaf(scatter(70, HALF_W + 9, 70), wxSnow ? "#c9d6c9" : "#5c9a40");
      farHills(9, wxSnow ? "#c5d0d8" : "#6f8f7a", 60, 120, 420);
    }
  }

  // 每隻狗的動作區段（依模擬記錄切開；計時動作的事件時間也切一刀，讓接飛盤失敗→重試分成兩段）
  var SPLIT_EVENTS = { catchGood: 1, catchLate: 1, catchMiss: 1, knock: 1, eat: 1, stayGood: 1, stayBreak: 1, weaveMiss: 1,
    fireBalk: 1, ringMiss: 1, loopFail: 1, climbSlip: 1, kickFall: 1, seesawFly: 1, plankFall: 1, trip: 1, ballPlay: 1, sprayStop: 1,
    bounceFlop: 1, paddleBonk: 1, catStare: 1, surfWipe: 1, skateFall: 1, skiFall: 1 };
  function buildSpans(result, n) {
    var fr = result.frames, dt = result.dt, spans = [], d, k;
    var cuts = [];
    for (d = 0; d < n; d++) { cuts.push({}); spans.push([]); }
    (result.events || []).forEach(function (e) { if (SPLIT_EVENTS[e.k] && e.d >= 0) cuts[e.d][Math.round(e.t / dt)] = e.k; });
    for (d = 0; d < n; d++) {
      var cur = null;
      for (k = 0; k < fr.length; k++) {
        var m = Math.floor(fr[k][d * 3 + 2]), cutEv = cuts[d][k];
        if (!cur || cur.m !== m || cutEv) {
          if (cur) cur.t1 = (k + 1) * dt;
          cur = { m: m, t0: (k + 1) * dt, t1: (k + 1) * dt, ev: cutEv || (cur && cur.m === m ? cur.ev : null) };
          spans[d].push(cur);
        }
      }
      if (cur) cur.t1 = (fr.length + 1) * dt;
    }
    return spans;
  }
  function spanAt(list, t) {
    var lo = 0, hi = list.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (list[mid].t0 <= t) lo = mid; else hi = mid - 1; }
    var s = list[lo];
    if (!s) return null;
    return { m: s.m, t0: s.t0, t1: s.t1, ev: s.ev, p: clamp((t - s.t0) / Math.max(0.01, s.t1 - s.t0), 0, 1) };
  }

  // ---------------- 轉播畫面 ----------------
  // opts：{ quality: "high" | "low" }
  function create(container, card, result, opts) {
    var T = window.THREE;
    opts = opts || {};
    var hi = opts.quality !== "low";
    var renderer = new T.WebGLRenderer({ antialias: hi });
    renderer.setPixelRatio(hi ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    renderer.shadowMap.enabled = hi;
    container.appendChild(renderer.domElement);
    renderer.domElement.className = "sg-canvas";
    var look = weatherLook(card);
    var scene = new T.Scene();
    scene.background = new T.Color(look.sky);
    scene.fog = new T.Fog(look.sky, look.fog[0], look.fog[1]);
    scene.add(new T.HemisphereLight(0xffffff, 0x445533, 0.55 * look.sun + 0.2));
    var sun = new T.DirectionalLight(0xffffff, 0.9 * look.sun);
    sun.castShadow = hi;
    sun.shadow.mapSize.set(1024, 1024);
    var sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 160;
    scene.add(sun); scene.add(sun.target);
    var ground = new T.Mesh(new T.PlaneGeometry(3000, 3000), new T.MeshStandardMaterial({ color: look.ground, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; scene.add(ground);

    var props = { throwers: {}, bars: {}, flows: [], flames: [], spin: [], seesaws: {}, belts: [], waves: [] };
    buildTrack(T, scene, card);
    buildObstacles(T, scene, card, props);
    buildVenue(T, scene, card);

    var n = card.dogs.length;
    var dogs = card.dogs.map(function (d, i) {
      var m = buildDog(T, d.breed, i);
      scene.add(m.root);
      // 號碼牌固定螢幕大小（sizeAttenuation:false），近距離不會變巨大
      var tag = new T.Sprite(new T.SpriteMaterial({ map: numberTex(T, i, true), depthTest: false, transparent: true, sizeAttenuation: false }));
      tag.scale.set(0.035, 0.035, 1); tag.renderOrder = 10; scene.add(tag); m.tag = tag;
      var disc = mesh(T, new T.CylinderGeometry(0.13, 0.13, 0.025, 12), mat(T, ["#ff5252", "#448aff", "#ffd740", "#69f0ae", "#e040fb", "#ffab40"][i]));
      disc.visible = false; scene.add(disc); m.disc = disc;
      var has = {};
      card.course.parts.forEach(function (pp) { has[pp.type] = 1; });
      m.gear = {};
      if (has.surf) { var sb = mesh(T, new T.CylinderGeometry(0.5, 0.5, 0.05, 16), mat(T, ["#ff7043", "#29b6f6", "#ffee58", "#66bb6a", "#ab47bc", "#ffa726"][i]), true); sb.scale.set(1.6, 1, 0.5); m.gear.surf = sb; }
      if (has.skateboard) {
        var sk = new T.Group(), dk = mesh(T, new T.BoxGeometry(1.0, 0.04, 0.3), mat(T, "#5d4037"), true); dk.position.y = 0.1; sk.add(dk);
        [-0.35, 0.35].forEach(function (wx) { [-0.11, 0.11].forEach(function (wz) { var wh = mesh(T, new T.CylinderGeometry(0.05, 0.05, 0.05, 8), mat(T, "#fdd835")); wh.rotation.x = Math.PI / 2; wh.position.set(wx, 0.05, wz); sk.add(wh); }); });
        m.gear.skateboard = sk;
      }
      if (has.ski) {
        var sg = new T.Group();
        [-0.12, 0.12].forEach(function (wz) { var sk2 = mesh(T, new T.BoxGeometry(1.3, 0.03, 0.08), mat(T, "#e53935"), true); sk2.position.set(0, 0.02, wz); sg.add(sk2); });
        m.gear.ski = sg;
      }
      Object.keys(m.gear).forEach(function (k) { m.gear[k].visible = false; scene.add(m.gear[k]); });
      if (has.sled) {
        var sled = mesh(T, new T.TorusGeometry(0.28, 0.1, 6, 14), mat(T, "#212121"), true); sled.rotation.x = Math.PI / 2;
        sled.visible = false; scene.add(sled); m.sled = sled;
      }
      return m;
    });
    var spans = buildSpans(result, n);
    // 碰倒的欄：哪隻狗、哪一根、什麼時候（畫面上欄杆會掉下來，那一根也不做跳躍弧線）
    var knocks = [], knocked = {};
    var failed = {};   // 跳失敗（風火輪撞圈、彈跳床摔、跳溝掉水）：那一跳不畫弧線
    (result.events || []).forEach(function (e) {
      if (e.k === "ringMiss" || e.k === "bounceFlop" || e.k === "ditchFall") {
        var s2 = Core.stateAt(result, e.t + result.dt)[e.d].s, pt2 = Core.partAt(card.course, s2);
        var j2 = pt2.type === "firewheel" ? Math.floor((s2 - pt2.s0) / (pt2.len / (pt2.rings + 1))) : 0;
        failed[e.d + ":" + pt2.s0 + ":" + j2] = e.t;
        return;
      }
      if (e.k !== "knock" && e.k !== "clip") return;
      var s = Core.stateAt(result, e.t + result.dt)[e.d].s, part = Core.partAt(card.course, s);
      if (!HURDLE_LIKE[part.type]) return;
      var j = e.k === "clip" && e.x ? e.x : Math.floor((s - part.s0) / (part.len / (part.bars + 1)));
      var key = e.d + ":" + part.s0 + ":" + j;
      knocked[key] = e.t;
      if (props.bars[key]) knocks.push({ bar: props.bars[key], t: e.t });
    });
    // 完走時的速度（衝過終點後減速用）
    var finV = card.dogs.map(function (d, i) {
      var tf = result.times[i];
      if (tf === null) return 0;
      var k = clamp(Math.round(tf / result.dt) - 2, 0, result.frames.length - 1);
      return result.frames[k][i * 3 + 1];
    });

    // 天氣粒子
    // vel＝每秒位移（颱風／暴風雪／沙塵暴是斜的），n＝粒子數
    var PARTICLES = {
      rain: { n: 2600, vel: [0, -22, 0], m: { color: 0xc8d6e5, size: 0.08, transparent: true, opacity: 0.7 } },
      typhoon: { n: 4200, vel: [9, -26, 5], m: { color: 0xc8d6e5, size: 0.09, transparent: true, opacity: 0.75 } },
      snow: { n: 2600, vel: [0, -2.5, 0], drift: 1, m: { color: 0xffffff, size: 0.22 } },
      blizzard: { n: 4200, vel: [8, -5, 4], drift: 1, m: { color: 0xffffff, size: 0.2 } },
      sandstorm: { n: 3600, vel: [14, -0.6, 6], m: { color: 0xd8b27a, size: 0.18, transparent: true, opacity: 0.8 } }
    };
    var pcfg = PARTICLES[card.weather], particles = null;
    if (pcfg) {
      var cnt = Math.round(pcfg.n * (hi ? 1 : 0.45)), pp = [];
      for (var q = 0; q < cnt; q++) pp.push((Math.random() - 0.5) * 80, Math.random() * 30, (Math.random() - 0.5) * 80);
      var pg = new T.BufferGeometry(); pg.setAttribute("position", new T.Float32BufferAttribute(pp, 3));
      particles = new T.Points(pg, new T.PointsMaterial(pcfg.m));
      scene.add(particles);
    }

    var camera = new T.PerspectiveCamera(50, 1, 0.1, 1500);
    var cam = { mode: "tv", dog: 0, shot: null, shotEnd: -1, pos: new T.Vector3(), tgt: new T.Vector3(), snap: true };
    var lastT = 0;

    function dogPos(i, t, st) {
      var s = st.s, tf = result.times[i];
      if (tf !== null && t > tf) { var dtf = t - tf, v0 = finV[i], stopT = v0 / 3; var e = Math.min(dtf, stopT); s = course().length + v0 * e - 1.5 * e * e; }
      var off = Core.laneOff(i), sp = spanAt(spans[i], t), y = 0, part = Core.partAt(card.course, Math.min(s, card.course.length - 0.01));
      var local = s - part.s0;
      if (part.type === "weave" && s < card.course.length) off += Math.sin(local / 2 * Math.PI) * 0.45 * dogs[i].S;
      var jumpP = -1;
      var Sd = dogs[i].S, onC = s < card.course.length;
      if (HURDLE_LIKE[part.type] && onC) {
        // 跳躍弧線以欄為中心（模擬只記「通過」那一刻）；跨欄賽道的欄低、弧線也低
        var lowH = part.type === "hurdlerace";
        var gap = part.len / (part.bars + 1), jb = Math.round(local / gap), R = (lowH ? 0.7 : 0.9) + (lowH ? 0.8 : 1.1) * Sd, db = local - jb * gap;
        if (jb >= 1 && jb <= part.bars && Math.abs(db) < R && knocked[i + ":" + part.s0 + ":" + jb] === undefined) {
          y = (lowH ? 0.18 + 0.4 * Sd : 0.3 + 0.75 * Sd) * (1 - (db / R) * (db / R));
          jumpP = (db + R) / (2 * R);
        }
      }
      if (part.type === "firewheel" && onC) {
        var fgp = part.len / (part.rings + 1), fj = Math.round(local / fgp), FR = 1.0 + 1.0 * Sd, fd = local - fj * fgp;
        if (fj >= 1 && fj <= part.rings && Math.abs(fd) < FR && failed[i + ":" + part.s0 + ":" + fj] === undefined) {
          y = (0.35 + 0.45 * Sd) * (1 - (fd / FR) * (fd / FR)); jumpP = (fd + FR) / (2 * FR);
        }
      }
      if (part.type === "trampoline" && onC) {
        var tb0 = part.len * 0.4, tspan = 3 + 2 * Sd, tu = (local - tb0) / tspan;
        if (tu >= 0 && tu <= 1 && failed[i + ":" + part.s0 + ":0"] === undefined) { y = (0.9 + 1.4 * Sd) * 4 * tu * (1 - tu) + 0.3 * (1 - tu); jumpP = tu; }
      }
      if (part.type === "ditch" && onC) {
        var dd0 = part.len / 2 - part.dw / 2 - 0.5, dspan = part.dw + 1, du2 = (local - dd0) / dspan;
        if (du2 >= 0 && du2 <= 1 && failed[i + ":" + part.s0 + ":0"] === undefined) { y = (0.45 + 0.45 * Sd) * 4 * du2 * (1 - du2); jumpP = du2; }
      }
      var pitch = 0;
      if (onC && elevH(part, Sd)) {
        y = elevY(part, local, Sd);
        pitch = Math.atan((elevY(part, Math.min(part.len, local + 0.15), Sd) - elevY(part, Math.max(0, local - 0.15), Sd)) / 0.3);
        if (part.type === "wallkick" && local < part.len * 0.8) {
          // 左右蹬牆：橫向來回，每一蹬有一個小弧
          var kg2 = part.len * 0.8 / part.kicks, kq = local / kg2;
          off += (kq % 2 < 1 ? 1 : -1) * 0.45 * Sd * Math.sin(Math.PI * (kq % 1));
          y += 0.25 * Sd * Math.abs(Math.sin(Math.PI * kq)); jumpP = kq % 1;
          if (sp && sp.m === M.stun) { y *= 0.25; jumpP = -1; }
        }
        if (part.type === "dogwalk" && sp && sp.m === M.stun) y = 0;   // 從平衡木掉下來
        if (part.type === "climbwall" && sp && sp.m === M.stun) y *= 0.5;
      }
      var seesawAng = null;
      if (part.type === "seesaw" && onC) {
        var mid = part.len / 2;
        seesawAng = local < mid - 0.05 ? SEESAW_A : -SEESAW_A;
        if (sp && sp.m === M.wait) seesawAng = SEESAW_A * (1 - 2 * Math.min(1, sp.p * 1.6));
        var pl = local - mid;
        if (Math.abs(pl) <= 2) { y = SEESAW_HP + 0.08 + pl * Math.tan(seesawAng); pitch = seesawAng; }
      }
      if (part.type === "looptube" && onC && local >= Core.LOOP_IN && local < Core.LOOP_IN + Core.LOOP_C) {
        // 圓形通道：沿著一整圈走（畫面位置由 θ 決定，里程仍是模擬的 s）
        var th = (local - Core.LOOP_IN) / Core.LOOP_C * Math.PI * 2, LA = loopAt(th);
        s = part.s0 + Core.LOOP_IN + LA.u; y = LA.y; pitch = Math.atan2(LA.dy, LA.du); off += (th / (Math.PI * 2) - 0.5) * 0.6;
      }
      if (part.type === "ballpit" && onC) y -= 0.18 * Sd;
      if (part.type === "surf" && onC && !(sp && sp.m === M.swim)) y = 0.12 + Math.sin(t * 2.2 + local * 0.6) * 0.08;
      if (part.type === "ski" && onC) off += Math.sin(local * 0.63) * 0.4;   // 繞旗門的 S 形
      if (part.type === "skateboard" && onC) { var kk = local - part.len * 0.5; if (Math.abs(kk) < 1.5 && !(sp && sp.m === M.stun)) { y = 0.5 * (1 - kk * kk / 2.25); jumpP = -1; } }
      if (part.type === "aframe" && s < card.course.length) {
        var H = 0.4 + 1.1 * dogs[i].S, half = part.len / 2;
        y = H * (1 - Math.abs(local - half) / half); pitch = (local < half ? 1 : -1) * Math.atan2(H, half);
      }
      var onCourse = s < card.course.length;
      if (onCourse && part.type === "hill") { y += trackY(card.course, s); pitch = Math.atan(trackSlope(card.course, s)); }
      if (onCourse && part.type === "bridge") y = BRIDGE_Y + Math.sin(t * 3 + i) * 0.03;
      if (onCourse && part.type === "pool" && part.kind === "dock") {
        if (local < Core.DOCK_RUN) y = DOCK_H;
        else if (sp && sp.m === M.dive) y = (1 - sp.p) * DOCK_H + sp.p * (WATER_TOP - 0.3) + Math.sin(Math.PI * sp.p) * 0.9;
      }
      var p = P(card.course, s, off);
      return { x: p.x, z: p.z, h: p.h, y: y, s: s, sp: sp, pitch: pitch, part: part, local: local, jumpP: jumpP, seesawAng: seesawAng };
    }
    function course() { return card.course; }

    // 導播：每 5 秒左右換鏡頭（依比賽時間決定，所以每台裝置的轉播鏡頭也一樣）
    var SHOTS = ["side", "heli", "front", "side", "chase"];
    function pickShot(t, rank, ps) {
      var lead = rank[0], ls = ps[lead].s, L = card.course.length;
      var idx = Math.floor(t / 5.5);
      if (t < 4) return { type: "start", until: 4 };
      if (L - ls < 110) return { type: "finish", until: Infinity };
      var next = card.course.parts.filter(function (p) { return p.type !== "straight" && p.type !== "curve" && p.s0 > ls + 8 && p.s0 < ls + 55; })[0];
      if (next && idx % 2 === 0) return { type: "fixed", until: t + 6.5, part: next };
      return { type: SHOTS[idx % SHOTS.length], until: (idx + 1) * 5.5 };
    }

    function updateCamera(t, dt, rank, ps) {
      var L = card.course.length, pos, tgt, fov = 50;
      var lead = rank[0], pack = (ps[rank[0]].s + ps[rank[1]].s + ps[rank[2]].s) / 3;
      if (cam.mode === "tv") {
        if (!cam.shot || t >= cam.shot.until || t < lastT - 0.5) { cam.shot = pickShot(t, rank, ps); cam.snap = true; }
        var sh = cam.shot;
        if (sh.type === "start") { var a = P(card.course, -6, -HALF_W - 4); pos = [a.x, 3, a.z]; var b = P(card.course, 6 + pack, 0); tgt = [b.x, 0.5, b.z]; fov = 55; }
        else if (sh.type === "finish") { var f = P(card.course, L + 1.5, HALF_W + 5); pos = [f.x, 2.4, f.z]; var lp = ps[lead]; tgt = [lp.x, 0.6, lp.z]; fov = 38; }
        else if (sh.type === "fixed") { var o2 = P(card.course, sh.part.s0 + sh.part.len * 0.5, HALF_W + 6); pos = [o2.x, 3.2, o2.z]; var lp2 = ps[lead]; tgt = [lp2.x, 0.5, lp2.z]; fov = 42; }
        else if (sh.type === "side") { var sd = P(card.course, pack + 2, HALF_W + 11); pos = [sd.x, 3.2, sd.z]; var c2 = P(card.course, pack, 0); tgt = [c2.x, 0.6, c2.z]; fov = 45; }
        else if (sh.type === "heli") { var hp = P(card.course, pack - 22, -HALF_W - 6); pos = [hp.x, 18, hp.z]; var c3 = P(card.course, pack + 5, 0); tgt = [c3.x, 0, c3.z]; fov = 50; }
        else if (sh.type === "front") { var fp = P(card.course, ps[lead].s + 14, 2); pos = [fp.x, 1.6, fp.z]; var c4 = P(card.course, pack - 3, 0); tgt = [c4.x, 0.5, c4.z]; fov = 45; }
        else { var me = ps[lead], cp = P(card.course, me.s - 6, Core.laneOff(lead) * 0.6); pos = [cp.x, 2.6, cp.z]; tgt = [me.x, 0.6, me.z]; fov = 55; }
      } else if (cam.mode === "chase") {
        var i = cam.dog, d = ps[i], S = dogs[i].S, back = P(card.course, d.s - (3 + 3 * S), Core.laneOff(i));
        pos = [back.x, d.y + 1.0 + 1.4 * S, back.z]; var ah = P(card.course, d.s + 6, Core.laneOff(i)); tgt = [ah.x, 0.4 * S + d.y * 0.5, ah.z]; fov = 60;
      } else if (cam.mode === "pov") {
        var j = cam.dog, dj = ps[j], Sj = dogs[j].S, hy = (dogs[j].bodyY + 0.3) * Sj + dj.y;
        var bodyEl = dogs[j].body.position.y * Sj;
        hy = bodyEl + 0.3 * Sj + (dj.y || 0);
        var eye = P(card.course, dj.s + 0.55 * Sj, Core.laneOff(j));
        pos = [eye.x, hy, eye.z]; var fw = P(card.course, dj.s + 12, Core.laneOff(j)); tgt = [fw.x, hy * 0.7, fw.z]; fov = 78;
        if (dj.sp && dj.sp.m === M.catch) tgt[1] = hy + 3 * Math.sin(Math.PI * dj.sp.p);
        if (dj.sp && dj.sp.m === M.eat) tgt[1] = 0;
      } else {
        var ap = P(card.course, pack - 30, 0); pos = [ap.x, 42, ap.z]; var at = P(card.course, pack + 12, 0); tgt = [at.x, 0, at.z]; fov = 55;
      }
      var k = cam.snap || cam.mode === "pov" ? 1 : 1 - Math.exp(-dt * (cam.mode === "chase" ? 8 : 3));
      cam.pos.set(cam.pos.x + (pos[0] - cam.pos.x) * k, cam.pos.y + (pos[1] - cam.pos.y) * k, cam.pos.z + (pos[2] - cam.pos.z) * k);
      cam.tgt.set(cam.tgt.x + (tgt[0] - cam.tgt.x) * k, cam.tgt.y + (tgt[1] - cam.tgt.y) * k, cam.tgt.z + (tgt[2] - cam.tgt.z) * k);
      cam.snap = false;
      camera.position.copy(cam.pos);
      camera.lookAt(cam.tgt);
      if (Math.abs(camera.fov - fov) > 0.1) { camera.fov = fov; camera.updateProjectionMatrix(); }
      // 陰影跟著看的地方
      sun.position.set(cam.tgt.x + 30, 60, cam.tgt.z + 20); sun.target.position.copy(cam.tgt);
    }

    function frame(t, dt) {
      var st = Core.stateAt(result, Math.max(0, t));
      var rank = Core.rankAt(result, Math.max(0, t));
      var ps = [];
      for (var i = 0; i < n; i++) {
        var d = dogs[i], s = st[i] || { s: 0, v: 0, mode: 0 };
        var p = dogPos(i, t, s);
        ps.push(p);
        var v = s.v;
        if (result.times[i] !== null && t > result.times[i]) v = Math.max(0, finV[i] - 3 * (t - result.times[i]));
        if (t < 0) v = 0;
        var mode = s.mode === M.fin ? M.run : s.mode;
        if (mode === M.jump) mode = M.run;
        if (p.sp && p.sp.m !== s.mode) p.sp = null;
        if (p.jumpP >= 0) { mode = M.jump; p.sp = { p: p.jumpP }; }
        var sp0 = p.sp;
        d.wt = p.part.type === "pool" ? waterTop(p.part.kind) : p.part.type === "ditch" ? -0.12 : p.part.type === "surf" ? 0.12 : WATER_TOP;
        if (p.seesawAng !== null) { var ssw = props.seesaws[i + ":" + p.part.s0]; if (ssw) ssw.rotation.z = p.seesawAng; }
        else card.course.parts.forEach(function (pp) { if (pp.type === "seesaw") { var sw2 = props.seesaws[i + ":" + pp.s0]; if (sw2) sw2.rotation.z = p.s > pp.s0 + pp.len / 2 ? -SEESAW_A : SEESAW_A; } });
        // 乘具（衝浪板、滑板、雪橇）：在該關卡內跟著狗、依體型縮放
        Object.keys(d.gear).forEach(function (k) {
          var gm = d.gear[k], on = p.part.type === k && p.local >= 0 && p.local <= p.part.len && !(sp0 && (sp0.m === M.swim || sp0.m === M.stun));
          gm.visible = on;
          if (on) { gm.position.set(p.x, p.y, p.z); gm.rotation.set(0, -p.h, 0); gm.rotation.order = "YXZ"; gm.rotation.z = p.pitch; gm.scale.setScalar(Math.max(0.6, d.S)); }
        });
        // 拖輪胎：輪胎跟在狗後面
        if (d.sled) {
          var inSled = p.part.type === "sled" && p.local >= 0 && p.local <= p.part.len;
          d.sled.visible = inSled;
          if (inSled) { var bk = P(card.course, p.s - 0.9 - 0.9 * d.S, Core.laneOff(i)); d.sled.position.set(bk.x, 0.1, bk.z); }
        }
        var swimY = 0;
        d.root.position.set(p.x, p.y + swimY, p.z);
        d.root.rotation.set(0, -p.h, 0);
        d.root.rotation.z = p.pitch;
        d.root.rotation.order = "YXZ";
        animateDog(d, v, mode, p.sp, t, dt);
        d.root.visible = !(cam.mode === "pov" && cam.dog === i);
        d.tag.visible = cam.mode !== "pov" && !(cam.mode === "chase" && cam.dog === i);
        d.tag.position.set(p.x, p.y + d.S * 1.45 + 0.45, p.z);
        // 飛盤：從丟盤的人飛到狗的頭上（失敗時飛過頭）
        var disc = d.disc, sp = p.sp;
        disc.visible = false;
        if (sp && sp.m === M.catch) {
          var th = props.throwers[i + ":" + p.part.s0];
          if (th) {
            var miss = sp.ev === "catchMiss", u = clamp(sp.p / 0.6, 0, 1);
            var hx = p.x + Math.cos(p.h) * 0.4 * d.S, hz = p.z + Math.sin(p.h) * 0.4 * d.S, hy = (d.bodyY + 0.45) * d.S;
            var tx = miss ? p.x - Math.cos(p.h) * 4 : hx, tz = miss ? p.z - Math.sin(p.h) * 4 : hz, ty = miss ? 0.05 : hy;
            if (u < 1 || !miss) {
              disc.visible = true;
              disc.position.set(th.x + (tx - th.x) * u, 1.3 + (ty - 1.3) * u + Math.sin(Math.PI * u) * 2.8, th.z + (tz - th.z) * u);
              disc.rotation.set(0.2, t * 12, 0);
            }
          }
        }
      }
      knocks.forEach(function (k) {
        var down = t >= k.t;
        k.bar.mesh.position.y = down ? 0.05 : k.bar.h;
        k.bar.mesh.rotation.z = down ? 0.5 : 0;
      });
      props.flows.forEach(function (tx) { tx.offset.x -= dt * 0.6; });
      props.belts.forEach(function (tx) { tx.offset.x += dt * 1.2; });
      props.waves.forEach(function (w) { w.m.scale.y = 0.8 + 0.4 * Math.abs(Math.sin(t * 1.6 + w.k)); });
      props.flames.forEach(function (f) { var sc = 0.8 + 0.35 * Math.abs(Math.sin(t * 9 + f.k * 1.7)); f.m.scale.set(sc, sc * 1.2, sc); });
      props.spin.forEach(function (o) {
        if (o.axis === "wag") o.m.rotation.x = Math.sin(t * o.w) * 0.5;
        else o.m.rotation[o.axis] += dt * o.w;
      });
      if (particles) {
        var pa = particles.geometry.attributes.position, arr = pa.array, vel = pcfg.vel;
        for (var q = 0; q < arr.length; q += 3) {
          arr[q] += vel[0] * dt; arr[q + 1] += vel[1] * dt; arr[q + 2] += vel[2] * dt;
          if (pcfg.drift) arr[q] += Math.sin(t + q) * 0.01;
          if (arr[q + 1] < 0) arr[q + 1] += 30;
          if (arr[q] > 40) arr[q] -= 80; else if (arr[q] < -40) arr[q] += 80;
          if (arr[q + 2] > 40) arr[q + 2] -= 80; else if (arr[q + 2] < -40) arr[q + 2] += 80;
        }
        pa.needsUpdate = true;
        particles.position.set(cam.pos.x, 0, cam.pos.z);
      }
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
    var onResize = function () { resize(); };
    window.addEventListener("resize", onResize);

    return {
      frame: frame, resize: resize,
      setCam: function (mode, dog) { cam.mode = mode; if (dog !== undefined) cam.dog = dog; cam.snap = true; cam.shot = null; },
      cam: function () { return { mode: cam.mode, dog: cam.dog }; },
      dispose: function () {
        window.removeEventListener("resize", onResize);
        scene.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { if (m.map) m.map.dispose(); m.dispose(); }); }
        });
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }

  // 犬舍／圖鑑用：轉台上的單隻狗（會原地小跑）
  function preview(container, breedId, gate) {
    var T = window.THREE;
    var renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);
    renderer.domElement.className = "sg-preview-canvas";
    var scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xffffff, 0x556644, 0.9));
    var dl = new T.DirectionalLight(0xffffff, 0.8); dl.position.set(3, 5, 4); scene.add(dl);
    var disc = new T.Mesh(new T.CylinderGeometry(1.5, 1.5, 0.08, 32), mat(T, "#8bc34a")); disc.position.y = -0.04; scene.add(disc);
    var d = buildDog(T, breedId, gate || 0);
    scene.add(d.root);
    var camera = new T.PerspectiveCamera(35, 1, 0.05, 50);
    var h = (d.bodyY + 0.3) * d.S;
    camera.position.set(1.9 * Math.max(d.S, 0.6), h + 0.5 * Math.max(d.S, 0.6), 2.2 * Math.max(d.S, 0.6)); camera.lookAt(0, h * 0.6, 0);
    var raf = 0, last = performance.now(), dead = false, ang = 0;
    function size() { var w = container.clientWidth || 240, hh = container.clientHeight || 180; renderer.setSize(w, hh, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%"; camera.aspect = w / hh; camera.updateProjectionMatrix(); }
    size();
    function loop(now) {
      if (dead) return;
      var dt = Math.min(0.05, (now - last) / 1000); last = now; ang += dt * 0.6;
      d.root.rotation.y = ang;
      animateDog(d, 2.2, M.run, null, now / 1000, dt);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return {
      dispose: function () {
        dead = true; cancelAnimationFrame(raf);
        scene.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }

  window.PriTestSaigo3D = { available: available, load: load, create: create, preview: preview, sizeScale: sizeScale };
})();
