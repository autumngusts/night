// 明星經紀 starV：3D 公司設施圖（「日程」分頁；starv_view_daily.js 提供移動模擬，這裡只負責畫）。
// 純演出：只讀 state。三個會變的外觀：
//   1. 建築：公司 Lv1～Lv10 各有不同外觀（老公寓一樓 → 地標高塔），一樓剖面就是設施圖，樓上的建築量體疊在後方。
//   2. 季節：依遊戲月份（3～5 春、6～8 夏、9～11 秋、12～2 冬），換地面、行道樹（櫻花、綠蔭、紅葉、積雪）與飄落物。
//   3. 天氣：依遊戲日期雜湊固定（晴、多雲、雨、雪；雪只在冬天），換天空、光線、霧與雨雪粒子。
// 人物沿用 starv_stage3d.js 的 buildRig（和演出同一組外觀參數）；人多或低畫質時改用簡化人形。
// 街上的路人與車輛只存在這裡，和遊戲狀態無關。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var UI = window.PriTestStarvUI;
  var Stage = window.PriTestStarvStage3D;
  var Spec = window.PriTestStarvStageSpec;
  var Murmurs = window.PriTestStarvMurmurs;

  var S = 0.25;                       // 設施圖 1 單位 ＝ 0.25 公尺
  function wx(x) { return (x - 50) * S; }
  function wz(y) { return (y - 32) * S; }
  var FULL_RIG_MAX = 30;              // 藝人超過這個數就用簡化人形
  var STREET = { walkA: 9.1, walkB: 14.1, laneA: 10.9, laneB: 12.4, roadZ1: 9.9, roadZ2: 13.4 };

  // ==== 季節與天氣（2D 圖也會用到，所以不依賴 THREE） ====
  function seasonOf(day) {
    var m = Core.dateOf(day).month;
    return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter";
  }
  var WEATHER_ODDS = {   // 累積機率（%）：晴、多雲、雨、雪
    spring: [55, 80, 100, 100], summer: [60, 78, 100, 100], autumn: [55, 85, 100, 100], winter: [40, 65, 75, 100]
  };
  var forced = null;   // 測試用：_force({ season, weather }) 固定景色
  function climate(st) {
    if (forced) return forced;
    var season = seasonOf(st.day), h = Murmurs.hash("wx:" + (st.era || 1) + ":" + st.day) % 100, o = WEATHER_ODDS[season];
    var weather = h < o[0] ? "sunny" : h < o[1] ? "cloudy" : h < o[2] ? "rain" : "snow";
    return { season: season, weather: weather };
  }
  var SEASON_ICON = { spring: "🌸", summer: "🌻", autumn: "🍁", winter: "⛄" };
  var WEATHER_ICON = { sunny: "☀️", cloudy: "☁️", rain: "🌧️", snow: "❄️" };

  // ==== 建築外觀（公司等級） ====
  // floors：後方量體的樓層數；w：寬度比例；base／win：外牆與窗色；其餘是附加物
  var LEVELS = [null,
    { floors: 2, w: 0.5, base: "#cdbfa8", win: "#5d6d7a", apartment: true, sign: "wood" },
    { floors: 2, w: 0.65, base: "#eceff1", win: "#607d8b", sign: "board" },
    { floors: 3, w: 0.72, base: "#a65e46", win: "#37474f", sign: "board", awning: true },
    { floors: 4, w: 0.78, base: "#d7ccc8", win: "#4fc3f7", sign: "neon", glassFront: true },
    { floors: 5, w: 0.84, base: "#90a4ae", win: "#81d4fa", sign: "neon", glassFront: true, billboard: true, planters: true },
    { floors: 7, w: 0.88, base: "#5c7d99", win: "#b3e5fc", sign: "neon", glassFront: true, curtain: true, planters: true },
    { floors: 9, w: 0.9, base: "#455a64", win: "#e1f5fe", sign: "led", glassFront: true, curtain: true, led: true, planters: true },
    { floors: 11, w: 0.92, base: "#37474f", win: "#e1f5fe", sign: "led", glassFront: true, curtain: true, led: true, heli: true, fountain: true },
    { floors: 13, w: 0.95, base: "#263238", win: "#fff8e1", sign: "led", glassFront: true, curtain: true, led: true, twin: true, fountain: true },
    { floors: 16, w: 0.7, base: "#1c1b33", win: "#ffe082", sign: "gold", glassFront: true, curtain: true, led: true, spire: true, lights: true, fountain: true, carpet: true }
  ];

  var SKY = { sunny: "#9fcbef", cloudy: "#b4bcc8", rain: "#7d8794", snow: "#c9d3de" };
  var GROUND = { spring: "#7fb069", summer: "#4f8f3a", autumn: "#a8a04f", winter: "#e9eef3" };
  var CROWN = { spring: ["#ffb7d5", "#ffc9de", "#8cc06a"], summer: ["#3f8f3a", "#4c9e44", "#2f7a32"], autumn: ["#e2702b", "#f0a030", "#c8462a"], winter: ["#f4f7fb", "#e6edf4", "#f4f7fb"] };
  var FALL = { spring: { color: "#ffc1da", size: 0.12, n: 120, speed: 0.6 }, autumn: { color: "#e8892f", size: 0.13, n: 110, speed: 0.7 } };

  function create(T, host, env) {
    var q = Stage.quality();
    var hi = q === "high";
    var renderer = new T.WebGLRenderer({ antialias: hi, alpha: false });
    renderer.setPixelRatio(hi ? Math.min(2, window.devicePixelRatio || 1) : 1);
    renderer.shadowMap.enabled = hi;
    renderer.domElement.className = "sv-o3d-canvas";
    host.insertBefore(renderer.domElement, host.firstChild);
    var labelLayer = document.createElement("div");
    labelLayer.className = "sv-o3d-labels";
    host.appendChild(labelLayer);

    var scene = new T.Scene();
    var cam = new T.PerspectiveCamera(32, 1.5, 0.5, 160);
    var target = new T.Vector3(-1.5, 0, 3);
    var yaw = 0.32, pitch = 0.86, radius = 36;
    var hemi = new T.HemisphereLight("#ffffff", "#5a5a4a", 0.75);
    var sun = new T.DirectionalLight("#fff4e0", 0.9);
    sun.position.set(-10, 22, 14);
    sun.target.position.set(-2, 0, 2);
    if (hi) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      var sc = sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 70;
    }
    scene.add(hemi, sun, sun.target);

    // ---- 材質（同色共用） ----
    var mats = {};
    function mat(color, o) {
      var key = color + JSON.stringify(o || {});
      if (!mats[key]) {
        var p = { color: color, roughness: 0.75, metalness: 0.02 };
        Object.keys(o || {}).forEach(function (k) { p[k] = o[k]; });
        mats[key] = new T.MeshStandardMaterial(p);
        mats[key].userData.cached = true;
      }
      return mats[key];
    }
    function mesh(geo, m, parent, x, y, z, shadow) {
      var me = new T.Mesh(geo, m);
      me.position.set(x || 0, y || 0, z || 0);
      if (hi && shadow !== false) { me.castShadow = true; me.receiveShadow = true; }
      parent.add(me);
      return me;
    }
    // 以設施圖座標放一個方塊：x、y 是中心，w、d 是寬深（設施圖單位），h 是高度（公尺）
    function box(parent, x, y, w, d, h, color, o, y0) {
      return mesh(new T.BoxGeometry(w * S, h, d * S), mat(color, o), parent, wx(x), (y0 || 0) + h / 2, wz(y));
    }
    function wbox(parent, X, Z, w, d, h, color, o, y0) {
      return mesh(new T.BoxGeometry(w, h, d), mat(color, o), parent, X, (y0 || 0) + h / 2, Z);
    }

    // ---- 文字貼圖（招牌、停機坪） ----
    function textTexture(text, fg, bg, w, h, font) {
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      var g = c.getContext("2d");
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
      var size = Math.floor(h * 0.62);
      g.font = (font || "bold ") + size + "px 'Noto Sans TC','Noto Sans JP',sans-serif";
      while (g.measureText(text).width > w * 0.9 && size > 10) { size -= 2; g.font = (font || "bold ") + size + "px 'Noto Sans TC','Noto Sans JP',sans-serif"; }
      g.fillText(text, w / 2, h / 2 + 2);
      var tex = new T.CanvasTexture(c);
      return tex;
    }
    // 窗戶格子貼圖：cols×rows 扇窗
    function facadeTexture(base, win, cols, rows, curtain) {
      var cw = 16, ch = 20, c = document.createElement("canvas");
      c.width = Math.min(1024, cols * cw); c.height = Math.min(1024, rows * ch);
      var g = c.getContext("2d"), sx = c.width / cols, sy = c.height / rows;
      g.fillStyle = base; g.fillRect(0, 0, c.width, c.height);
      for (var i = 0; i < cols; i++) for (var j = 0; j < rows; j++) {
        g.fillStyle = win;
        g.globalAlpha = 0.75 + 0.25 * ((i * 7 + j * 3) % 5) / 4;
        if (curtain) g.fillRect(i * sx + 1, j * sy + 1, sx - 1, sy - 2);
        else g.fillRect(i * sx + sx * 0.22, j * sy + sy * 0.22, sx * 0.56, sy * 0.5);
      }
      g.globalAlpha = 1;
      return new T.CanvasTexture(c);
    }

    // ---- 靜態場景（建築、房間、街道、自然）：狀態變了才重建 ----
    var world = null, worldKey = "", led = null, lights = [], fall = null, sky = null;
    // 共用快取的材質留著（dispose 時一起釋放），其餘（貼圖材質、人物骨架的材質）跟著物件釋放
    function disposeGroup(g) {
      g.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        [].concat(o.material || []).forEach(function (m) {
          if (m.userData && m.userData.cached) return;
          if (m.map) m.map.dispose();
          m.dispose();
        });
      });
    }
    function own(m) { return m; }

    function buildWorld(st) {
      var cl = climate(st), lv = Math.max(1, Math.min(10, st.company.level)), L = LEVELS[lv];
      var g = new T.Group();
      led = null; lights = [];
      var snowy = cl.season === "winter" || cl.weather === "snow";

      // 天空、光線、霧
      sky = new T.Color(SKY[cl.weather]);
      scene.background = sky;
      scene.fog = new T.Fog(sky, cl.weather === "rain" || cl.weather === "snow" ? 30 : 48, cl.weather === "rain" || cl.weather === "snow" ? 80 : 120);
      sun.intensity = { sunny: 0.95, cloudy: 0.45, rain: 0.3, snow: 0.4 }[cl.weather];
      hemi.intensity = { sunny: 0.7, cloudy: 0.85, rain: 0.8, snow: 0.95 }[cl.weather];
      sun.color.set(cl.season === "autumn" ? "#ffe2b8" : "#fff4e0");

      // 地面、馬路、人行道
      var ground = mesh(new T.PlaneGeometry(140, 140), mat(snowy ? GROUND.winter : GROUND[cl.season]), g, 0, -0.02, 0, false);
      ground.rotation.x = -Math.PI / 2; if (hi) ground.receiveShadow = true;
      wbox(g, 0, (STREET.roadZ1 + STREET.roadZ2) / 2, 140, STREET.roadZ2 - STREET.roadZ1, 0.02, cl.weather === "rain" ? "#2c2f35" : "#3a3d44", { roughness: cl.weather === "rain" ? 0.25 : 0.9 });
      wbox(g, 0, 9.0, 140, 1.8, 0.08, snowy ? "#e3e8ee" : "#b9b4ab");
      wbox(g, 0, 14.4, 140, 1.9, 0.08, snowy ? "#e3e8ee" : "#b9b4ab");
      for (var lx = -60; lx < 60; lx += 3) wbox(g, lx, (STREET.laneA + STREET.laneB) / 2 - 0.1, 1.4, 0.12, 0.03, "#f2f2f2");
      for (var cz = 0; cz < 6; cz++) wbox(g, wx(90), STREET.roadZ1 + 0.3 + cz * 0.58, 2.2, 0.32, 0.03, "#f5f5f5");   // 斑馬線（大門前）
      // 建築基地（一樓樓板）
      wbox(g, wx(50), 0, 26.5, 15.8, 0.1, "#cfc8bd");

      buildRooms(g, st, L, lv, snowy);
      buildTower(g, st, L, lv, snowy);
      buildForecourt(g, L, lv, snowy);
      buildNature(g, cl, snowy);
      buildFall(g, cl);
      return g;
    }

    var ROOM_FLOOR = { dorm: "#b9a7d8", lounge: "#a9d8bf", practice: "#c9b38b", studio: "#5b4a6b", photo: "#eeeeee", classroom: "#d9c9a0", pr: "#b8c4cc", scout: "#a9b5bd", lobby: "#e8dfcf" };

    function buildRooms(g, st, L, lv, snowy) {
      var R = env.ROOMS, wallC = lv >= 4 ? "#f4f2f6" : "#d8cfc2", wallH = 0.95, tall = 2.4, th = 0.12;
      Object.keys(R).forEach(function (k) {
        if (k === "outside") return;
        var r = R[k], ok = env.built(k);
        var f = box(g, (r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2, r.x2 - r.x1 - 0.4, r.y2 - r.y1 - 0.4, 0.04, ok ? ROOM_FLOOR[k] : "#9e9e9e", null, 0.1);
        f.castShadow = false;
        if (ok) furnish(g, k, r, lv); else construction(g, r);
      });
      // 走廊地板
      box(g, 39.5, 31, 77, 13.6, 0.03, lv >= 6 ? "#ddd8e6" : "#c9c1b3", null, 0.1);
      function seg(x1, y1, x2, y2, h, c, o) {
        var horiz = y1 === y2, len = horiz ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
        if (len <= 0.01) return;
        box(g, (x1 + x2) / 2, (y1 + y2) / 2, horiz ? len : th / S, horiz ? th / S : len, h, c || wallC, o, 0.1);
      }
      // 水平牆，gaps：門的中心 x
      function hwall(x1, x2, y, gaps, h, c, o) {
        var cur = x1, gw = 3.6;
        gaps.slice().sort(function (a, b) { return a - b; }).forEach(function (gx) { seg(cur, y, gx - gw / 2, y, h, c, o); cur = gx + gw / 2; });
        seg(cur, y, x2, y, h, c, o);
      }
      var C = env.COLS, topDoors = ["dorm", "lounge", "practice", "studio", "photo"].map(function (k) { return R[k].cx; });
      var botDoors = ["classroom", "pr", "scout", "lobby"].map(function (k) { return R[k].cx; });
      hwall(C[0], C[5], 24, topDoors, wallH);
      hwall(C[0], C[5], 38, botDoors, wallH);
      [1, 2, 3, 4].forEach(function (i) { seg(C[i], 2, C[i], 24, wallH); });
      [1, 2, 3].forEach(function (i) { seg(C[i], 38, C[i], 62, wallH); });
      // 外牆：後面與左邊高、前面矮（剖面看得到裡面）；右邊大廳留大門
      seg(C[0], 2, C[5], 2, tall, L.base);
      seg(C[0], 2, C[0], 62, tall * 0.6, L.base);
      seg(C[5], 2, C[5], 24, tall * 0.6, L.base);
      seg(C[5], 24, C[5], 38, wallH, L.base);
      seg(C[5], 38, C[5], env.ENTR_IN.y - 3, wallH, L.base);
      seg(C[5], env.ENTR_IN.y + 3, C[5], 62, wallH, L.base);
      seg(C[0], 62, C[5], 62, 0.45, L.base);
      if (L.glassFront) {
        var glass = own(new T.MeshStandardMaterial({ color: "#bfe6ff", transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.3, depthWrite: false }));
        var gm = mesh(new T.BoxGeometry(77 * S, 1.3, 0.05), glass, g, wx(39.5), 0.55 + 0.65, wz(62), false);
        gm.renderOrder = 2;
      } else {
        // 舊建築：前牆上方一排小窗框
        for (var x = 4; x < 78; x += 6) box(g, x, 62, 0.4, 0.5, 0.5, "#8d8478", null, 0.55);
      }
      // 大門：門框＋自動門
      box(g, 78, env.ENTR_IN.y - 3.2, 0.6, 0.6, 2.2, lv >= 5 ? "#c0c0c8" : "#7a6a58", { metalness: lv >= 5 ? 0.6 : 0 });
      box(g, 78, env.ENTR_IN.y + 3.2, 0.6, 0.6, 2.2, lv >= 5 ? "#c0c0c8" : "#7a6a58", { metalness: lv >= 5 ? 0.6 : 0 });
      box(g, 78, env.ENTR_IN.y, 0.6, 7, 0.3, lv >= 5 ? "#c0c0c8" : "#7a6a58", null, 2.2);
      if (snowy) box(g, 39.5, 2, 77, 0.8, 0.12, "#ffffff", null, tall + 0.1);
    }

    // 各房間的家具（簡單幾何體）
    function furnish(g, k, r, lv) {
      var x1 = r.x1, x2 = r.x2, y1 = r.y1, y2 = r.y2, cx = r.cx, cy = (y1 + y2) / 2;
      if (k === "dorm") {
        [x1 + 4, x2 - 4].forEach(function (x) {
          box(g, x, y1 + 6, 4, 8, 0.4, "#f5f0e6", null, 0.1);
          box(g, x, y1 + 3, 3.4, 1.6, 0.15, "#ffffff", null, 0.5);
          box(g, x, y1 + 7.5, 4, 4.5, 0.08, "#9fa8da", null, 0.5);
        });
        box(g, cx, y1 + 1.2, 3, 1.4, 1.2, "#8d6e63", null, 0.1);
      } else if (k === "lounge") {
        box(g, cx, y1 + 3, 10, 2.4, 0.45, "#7e57c2", null, 0.1);
        box(g, cx, y1 + 1.8, 10, 0.8, 0.9, "#673ab7", null, 0.1);
        box(g, cx, y1 + 8, 4.5, 3, 0.35, "#d7ccc8", null, 0.1);
        plant(g, x2 - 2, y2 - 3);
        box(g, x1 + 2, y2 - 4, 1.6, 1.6, 1.4, "#eceff1", null, 0.1);   // 自動販賣機
      } else if (k === "practice") {
        var mirror = mesh(new T.BoxGeometry((x2 - x1 - 2) * S, 1.6, 0.04), mat("#d6efff", { metalness: 0.9, roughness: 0.08, emissive: "#24323c" }), g, wx(cx), 0.95, wz(y1 + 0.6), false);
        mirror.castShadow = false;
        box(g, cx, y1 + 2.2, x2 - x1 - 3, 0.3, 0.06, "#bcaaa4", null, 0.95);
        box(g, x2 - 2.5, y2 - 2.5, 2, 2, 0.6, "#37474f", null, 0.1);    // 音響
      } else if (k === "studio") {
        var booth = mesh(new T.BoxGeometry(7 * S, 1.6, 7 * S), own(new T.MeshStandardMaterial({ color: "#b3e5fc", transparent: true, opacity: 0.22, depthWrite: false })), g, wx(cx - 2), 0.9, wz(y1 + 6), false);
        booth.renderOrder = 2;
        box(g, cx - 2, y1 + 6, 0.3, 0.3, 1.3, "#424242", null, 0.1);
        box(g, cx + 3.5, y2 - 5, 5, 2.5, 0.75, "#263238", null, 0.1);
        box(g, cx + 3.5, y2 - 5.6, 4, 1, 0.08, "#4dd0e1", { emissive: "#0a5c66" }, 0.85);
      } else if (k === "photo") {
        box(g, cx, y1 + 1, x2 - x1 - 3, 0.6, 1.9, "#fafafa", null, 0.1);
        box(g, cx, y1 + 4, x2 - x1 - 3, 5, 0.03, "#fafafa", null, 0.12);
        [x1 + 2.5, x2 - 2.5].forEach(function (x) {
          box(g, x, y2 - 6, 0.3, 0.3, 1.5, "#212121", null, 0.1);
          box(g, x, y2 - 6, 2, 0.6, 1, "#fffde7", { emissive: "#8a8455" }, 1.5);
        });
      } else if (k === "classroom") {
        box(g, x1 + 0.5, cy, 0.3, 12, 1, "#2e7d32", null, 0.5);    // 黑板
        for (var i = 0; i < 2; i++) for (var j = 0; j < 3; j++) box(g, x1 + 6 + i * 5, y1 + 6 + j * 6, 3, 2, 0.5, "#a1887f", null, 0.1);
      } else if (k === "pr" || k === "scout") {
        [y1 + 6, y1 + 14].forEach(function (y) {
          box(g, cx, y, 9, 2.6, 0.5, "#eceff1", null, 0.1);
          box(g, cx - 2, y - 0.5, 1.8, 0.2, 0.5, "#263238", { emissive: k === "pr" ? "#1a3a5a" : "#3a2a1a" }, 0.6);
          box(g, cx + 2, y - 0.5, 1.8, 0.2, 0.5, "#263238", { emissive: "#1a3a5a" }, 0.6);
        });
        if (k === "scout") box(g, x2 - 1.5, y2 - 3, 1.5, 3, 1.3, "#78909c", null, 0.1);
        plant(g, x1 + 2, y2 - 2.5);
      } else if (k === "lobby") {
        box(g, x2 - 7, env.ENTR_IN.y - 2, 2, 9, 0.75, lv >= 6 ? "#fafafa" : "#8d6e63", null, 0.1);   // 櫃台
        box(g, cx - 6, y2 - 5, 8, 2.4, 0.45, "#ff8a80", null, 0.1);
        box(g, cx - 6, y2 - 7, 3.5, 2.5, 0.3, "#d7ccc8", null, 0.1);
        plant(g, x1 + 2, y1 + 3);
        plant(g, x2 - 3, y1 + 3);
        if (lv >= 7) box(g, cx + 2, y1 + 3, 3, 3, 0.25, "#ffd66b", { metalness: 0.7, roughness: 0.3 }, 0.1);   // 獎盃展示台
      }
    }
    function plant(g, x, y) {
      mesh(new T.CylinderGeometry(0.22, 0.18, 0.4, 8), mat("#8d6e63"), g, wx(x), 0.3, wz(y));
      mesh(new T.IcosahedronGeometry(0.42, 0), mat("#43a047", { flatShading: true }), g, wx(x), 0.85, wz(y));
    }
    function construction(g, r) {
      for (var i = 0; i < 3; i++) {
        mesh(new T.ConeGeometry(0.18, 0.5, 8), mat("#ff7043"), g, wx(r.x1 + 3 + i * (r.x2 - r.x1 - 6) / 2), 0.35, wz((r.y1 + r.y2) / 2 + (i % 2 ? 3 : -2)));
      }
      box(g, r.cx, (r.y1 + r.y2) / 2, r.x2 - r.x1 - 4, 0.3, 0.05, "#ffd600", null, 0.75);
    }

    // 後方的建築量體（公司等級）
    function buildTower(g, st, L, lv, snowy) {
      var fh = 1.0, depth = 6.5, width = 26 * L.w, zBack = wz(2) - 0.06;
      var floors = L.floors, height = floors * fh;
      function block(X, w, floors2) {
        var h = floors2 * fh + 2.4;   // 一樓（和設施圖同高）＋上面的樓層
        var tex = facadeTexture(L.base, L.win, Math.round(w / 0.9), floors2 + 2, L.curtain);
        var side = facadeTexture(L.base, L.win, Math.round(depth / 0.9), floors2 + 2, L.curtain);
        var faceM = own(new T.MeshStandardMaterial({ map: tex, roughness: L.curtain ? 0.2 : 0.8, metalness: L.curtain ? 0.4 : 0 }));
        var sideM = own(new T.MeshStandardMaterial({ map: side, roughness: L.curtain ? 0.2 : 0.8, metalness: L.curtain ? 0.4 : 0 }));
        var topM = mat(snowy ? "#f5f7fa" : "#6d6d6d");
        mesh(new T.BoxGeometry(w, h, depth), [sideM, sideM, topM, topM, faceM, faceM], g, X, h / 2, zBack - depth / 2);
        return { x: X, w: w, h: h };
      }
      var x0 = wx(1) + width / 2, parts = [];
      if (L.twin) {
        parts.push(block(wx(1) + 4.5, 8.5, floors));
        parts.push(block(wx(78) - 4.5, 8.5, floors - 2));
        wbox(g, wx(39.5), zBack - depth / 2, 9, 1.6, 1.2, "#90caf9", { metalness: 0.5, roughness: 0.2 }, floors * 0.6 + 2.4);   // 空橋
      } else parts.push(block(x0, width, floors));
      var main = parts[0];
      if (L.apartment) {
        // 老公寓：陽台、冷氣機、曬衣竿
        for (var i = 0; i < 4; i++) for (var j = 0; j < 2; j++) {
          wbox(g, main.x - main.w / 2 + 1.2 + i * (main.w - 2.4) / 3, zBack + 0.3, 1.6, 0.6, 0.08, "#9e9e9e", null, 2.4 + j * fh + 0.05);
          wbox(g, main.x - main.w / 2 + 1.7 + i * (main.w - 2.4) / 3, zBack + 0.25, 0.5, 0.3, 0.35, "#eceff1", null, 2.4 + j * fh + 0.2);
        }
      }
      // 招牌
      var name = st.company.name || UI.t("sv_company_default");
      var signStyle = {
        wood: ["#4e342e", "#f3e5ab", 3.2, 0.7], board: ["#ffffff", "#263238", 4.5, 0.9], neon: ["#ff5fa8", "#1a1240", 6, 1.1],
        led: ["#ffffff", "#0d0a1f", 7, 1.3], gold: ["#ffd66b", "#1c1b33", 8, 1.5]
      }[L.sign];
      var signTex = textTexture(name, signStyle[0], signStyle[1], 512, 112);
      var signM = own(new T.MeshBasicMaterial({ map: signTex }));
      mesh(new T.BoxGeometry(signStyle[2], signStyle[3], 0.12), signM, g, main.x, Math.min(main.h - 0.9, 2.4 + 1.6) + (L.sign === "wood" ? -0.6 : 0), zBack + 0.08, false);
      if (L.awning) wbox(g, main.x, zBack + 0.6, main.w * 0.8, 1.2, 0.1, "#c62828", null, 2.45);
      if (L.billboard) {
        wbox(g, main.x, zBack - depth / 2, 5, 0.15, 2, "#263238", null, main.h + 0.3);
        mesh(new T.BoxGeometry(4.6, 1.6, 0.05), own(new T.MeshBasicMaterial({ map: textTexture("starV", "#ffd66b", "#a66bff", 256, 96) })), g, main.x, main.h + 1.3, zBack - depth / 2 + 0.1, false);
      }
      if (L.led) {
        led = mesh(new T.PlaneGeometry(Math.min(6, main.w * 0.45), 2.6), own(new T.MeshBasicMaterial({ color: "#ff5fa8" })), g, main.x + main.w * 0.22, 2.4 + Math.min(main.h - 2.4, 6) * 0.6 + 1, zBack + 0.07, false);
      }
      if (L.heli) {
        var pad = mesh(new T.CylinderGeometry(2.2, 2.2, 0.1, 24), [mat("#455a64"), own(new T.MeshBasicMaterial({ map: textTexture("H", "#ffffff", "#455a64", 128, 128) })), mat("#455a64")], g, main.x, main.h + 0.05, zBack - depth / 2, false);
        pad.rotation.y = Math.PI / 2;
      }
      if (L.spire) {
        mesh(new T.ConeGeometry(0.9, 5, 8), mat("#ffd66b", { metalness: 0.85, roughness: 0.25, emissive: "#3a2a00" }), g, main.x, main.h + 2.5, zBack - depth / 2);
        wbox(g, main.x, zBack + 0.05, main.w + 0.2, 0.2, 0.25, "#ffd66b", { metalness: 0.85, roughness: 0.25 }, main.h - 0.2);
      }
      if (L.lights) {
        [-1, 1].forEach(function (sx) {
          var cone = mesh(new T.ConeGeometry(1.4, 16, 16, 1, true), own(new T.MeshBasicMaterial({ color: "#fff8d0", transparent: true, opacity: 0.13, side: T.DoubleSide, depthWrite: false })), g, main.x + sx * 3, main.h + 8, zBack - depth / 2, false);
          cone.userData.phase = sx;
          lights.push(cone);
        });
      }
      if (snowy) parts.forEach(function (p) { wbox(g, p.x, zBack - depth / 2, p.w + 0.1, depth + 0.1, 0.15, "#ffffff", null, p.h); });
    }

    // 前庭（外出區）：等級越高越氣派
    function buildForecourt(g, L, lv, snowy) {
      var R = env.ROOMS.outside;
      box(g, (R.x1 + R.x2) / 2, (R.y1 + R.y2) / 2, R.x2 - R.x1, R.y2 - R.y1, 0.06, snowy ? "#eef2f6" : lv >= 6 ? "#d9d4cc" : "#a9a49c", null, 0);
      // 外景車
      var vx = wx(R.cx), vz = wz(R.y1 + 9);
      wbox(g, vx, vz, 2, 4.2, 1.5, lv >= 6 ? "#212121" : "#eceff1", { metalness: 0.4, roughness: 0.35 }, 0.3);
      wbox(g, vx, vz + 1.3, 1.9, 1.4, 0.6, "#90caf9", { metalness: 0.5, roughness: 0.1 }, 1.0);
      [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sz) {
        var w = mesh(new T.CylinderGeometry(0.32, 0.32, 0.25, 10), mat("#111"), g, vx + sx * 1.0, 0.32, vz + sz * 1.4);
        w.rotation.z = Math.PI / 2;
      }); });
      if (lv <= 2) for (var i = 0; i < 3; i++) wbox(g, wx(R.x1 + 3 + i * 2), wz(R.y2 - 6), 0.1, 1.4, 0.8, "#546e7a");   // 腳踏車
      if (L.planters) [R.x1 + 2, R.x2 - 2].forEach(function (x) { box(g, x, R.y2 - 3, 2.4, 2.4, 0.5, "#8d6e63"); plant(g, x, R.y2 - 3); });
      if (L.fountain) {
        mesh(new T.CylinderGeometry(1.2, 1.3, 0.45, 20), mat("#cfd8dc"), g, wx(R.cx), 0.23, wz(R.y2 - 12));
        mesh(new T.CylinderGeometry(1.05, 1.05, 0.06, 20), mat("#4fc3f7", { roughness: 0.1, metalness: 0.3, emissive: "#0b3a4a" }), g, wx(R.cx), 0.46, wz(R.y2 - 12), false);
      }
      if (L.carpet) box(g, R.cx, R.y2 - 4, 4, 12, 0.03, "#c62828", null, 0.07);
      // 大門到街上的門柱
      [R.x1 + 1, R.x2 - 1].forEach(function (x) { box(g, x, 63.5, 1, 1, lv >= 8 ? 1.6 : 1, lv >= 8 ? "#ffd66b" : "#8d8478", lv >= 8 ? { metalness: 0.7, roughness: 0.3 } : null); });
    }

    // 行道樹、路燈、遠方的街景
    function buildNature(g, cl, snowy) {
      var crowns = CROWN[snowy && cl.season !== "winter" ? "winter" : cl.season];
      function tree(X, Z, i) {
        mesh(new T.CylinderGeometry(0.12, 0.18, 1.6, 6), mat("#6d4c41"), g, X, 0.8, Z);
        if (cl.season === "winter" && i % 3 === 0) return;   // 冬天有些樹只剩枝幹
        var c = mesh(new T.IcosahedronGeometry(0.95 + (i % 3) * 0.15, 0), mat(crowns[i % crowns.length], { flatShading: true }), g, X, 2.1, Z);
        c.scale.y = 0.9;
      }
      var i = 0, x;
      for (x = -30; x <= 30; x += 4.5) tree(x, 15.6, i++);
      // 近側人行道只在建築兩旁種樹，不擋住剖面
      [-17, -21, -25, 15.5, 19.5, 23.5].forEach(function (X) { tree(X, 8.2, i++); });
      for (var z = -14; z < 6; z += 4) { tree(wx(-6), z, i++); tree(wx(104), z, i++); }
      for (x = -28; x <= 28; x += 9) {
        mesh(new T.CylinderGeometry(0.07, 0.09, 3.2, 6), mat("#455a64"), g, x, 1.6, 8.4);
        mesh(new T.SphereGeometry(0.22, 8, 6), mat("#fff8e1", { emissive: cl.weather === "sunny" ? "#000000" : "#c8b060" }), g, x, 3.2, 8.4, false);
      }
      // 對街的房子（遠景）
      var rnd = 7;
      for (x = -34; x <= 34; x += 6.2) {
        rnd = (rnd * 9301 + 49297) % 233280;
        var h = 3 + (rnd % 7), col = ["#d7ccc8", "#b0bec5", "#ffe0b2", "#cfd8dc", "#f8bbd0"][rnd % 5];
        wbox(g, x, 19.5, 5.4, 4, h, col);
        if (snowy) wbox(g, x, 19.5, 5.5, 4.1, 0.12, "#ffffff", null, h);
      }
    }

    // 雨、雪、花瓣、落葉
    function buildFall(g, cl) {
      fall = null;
      var spec = cl.weather === "rain" ? { color: "#c5d8ee", size: 0.07, n: hi ? 900 : 350, speed: 14, drift: 0 }
        : cl.weather === "snow" ? { color: "#ffffff", size: 0.16, n: hi ? 600 : 250, speed: 1.4, drift: 0.6 }
        : FALL[cl.season] && cl.weather === "sunny" ? { color: FALL[cl.season].color, size: FALL[cl.season].size, n: FALL[cl.season].n, speed: FALL[cl.season].speed, drift: 0.8 } : null;
      if (!spec) return;
      var pos = new Float32Array(spec.n * 3);
      for (var i = 0; i < spec.n; i++) { pos[i * 3] = Math.random() * 60 - 30; pos[i * 3 + 1] = Math.random() * 18; pos[i * 3 + 2] = Math.random() * 40 - 18; }
      var geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(pos, 3));
      var pts = new T.Points(geo, own(new T.PointsMaterial({ color: spec.color, size: spec.size, transparent: true, opacity: 0.85, depthWrite: false })));
      g.add(pts);
      fall = { pts: pts, spec: spec };
    }

    // ==== 人物 ====
    var figs = {};          // 依 mover key
    var peds = [], cars = [];
    function simpleFig(outfit, skin, hair, h) {
      var root = new T.Group(), inner = new T.Group();
      root.add(inner);
      mesh(new T.CylinderGeometry(0.11, 0.13, 0.55, 6), mat("#2b2840"), inner, 0, 0.28, 0);
      mesh(new T.CylinderGeometry(0.17, 0.2, 0.6, 8), mat(outfit), inner, 0, 0.85, 0);
      mesh(new T.SphereGeometry(0.17, 10, 8), mat(skin), inner, 0, 1.33, 0);
      mesh(new T.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(hair), inner, 0, 1.37, -0.01);
      root.scale.setScalar(h || 0.75);
      return { root: root, inner: inner, simple: true };
    }
    function rigFig(look, gender, scale) {
      var holder = new T.Group(), r = Stage.buildRig(T, Spec.rig(look, gender), null);
      holder.add(r.root);
      if (hi) r.root.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      holder.scale.setScalar(scale || 0.72);
      return { root: holder, rig: r };
    }
    function randomLook() {
      var Lk = D.LOOK, R = function (n) { return Math.floor(Math.random() * n); };
      return { face: R(Lk.face), hair: R(Lk.hair), hairColor: R(Lk.hairColors.length), eye: R(Lk.eye), outfit: R(Lk.outfit), acc: R(Lk.acc + 1) - 1, skin: R(Lk.skins.length) };
    }
    function figFor(m, st, artistCount) {
      if (m.kind === "artist") {
        var a = Core.artistById(st, m.aid);
        var look = a ? a.look : null, gender = a ? a.gender : "f";
        return hi && artistCount <= FULL_RIG_MAX ? rigFig(look, gender) : (function () { var s = Spec.rig(look, gender); return simpleFig(s.outfit, s.skin, s.hair, 0.78 * s.height); })();
      }
      if (m.kind === "staff") return simpleFig("#37474f", "#f5cba7", "#1b1b1f", 0.74);
      return simpleFig(["#ff5fa8", "#ff9de2", "#a66bff"][Murmurs.hash(m.key) % 3], "#ffe0cc", "#4a2f23", 0.7);
    }
    function animate(f, t, phase, moving, tired) {
      if (f.rig) {
        var r = f.rig;
        Stage.resetPose(r);
        if (moving) {
          var s = Math.sin(t * 8 + phase);
          r.legL.hip.rotation.x = 0.55 * s; r.legR.hip.rotation.x = -0.55 * s;
          r.legL.knee.rotation.x = Math.max(0, -0.7 * s); r.legR.knee.rotation.x = Math.max(0, 0.7 * s);
          r.armL.sh.rotation.x = -0.45 * s; r.armR.sh.rotation.x = 0.45 * s;
          r.hips.position.y = 0.92 + 0.025 * Math.abs(Math.cos(t * 8 + phase));
        } else {
          r.hips.position.y = 0.92 + 0.008 * Math.sin(t * 2 + phase);
          r.head.rotation.y = 0.4 * Math.sin(t * 0.4 + phase * 3);
          if (tired) { r.head.rotation.x = 0.4; r.armL.sh.rotation.z = 0.1; }
        }
      } else {
        f.inner.position.y = moving ? 0.06 * Math.abs(Math.sin(t * 8 + phase)) : 0;
        f.inner.rotation.z = moving ? 0.06 * Math.sin(t * 8 + phase) : 0;
        f.inner.rotation.x = tired && !moving ? 0.2 : 0;
      }
    }
    function face(f, dx, dz, dt) {
      if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
      var want = Math.atan2(dx, dz), cur = f.root.rotation.y, d = want - cur;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      f.root.rotation.y = cur + d * Math.min(1, dt * 10);
    }

    // 路人與車輛：在街上來回，走出畫面就換一個新人從另一頭出現
    function spawnPed(p, fresh) {
      if (p.f) { scene.remove(p.f.root); disposeGroup(p.f.root); }
      var look = randomLook(), gender = Math.random() < 0.5 ? "f" : "m";
      p.f = hi ? rigFig(look, gender, 0.7) : (function () { var s = Spec.rig(look, gender); return simpleFig(s.outfit, s.skin, s.hair, 0.75); })();
      p.dir = Math.random() < 0.5 ? 1 : -1;
      p.speed = 1.0 + Math.random() * 0.8;
      p.z = (Math.random() < 0.5 ? STREET.walkA : STREET.walkB) + (Math.random() - 0.5) * 0.6;
      p.x = fresh ? Math.random() * 60 - 30 : -32 * p.dir;
      p.phase = Math.random() * 6;
      p.pause = 0;
      p.f.root.rotation.y = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      scene.add(p.f.root);
    }
    function spawnCar(c, fresh) {
      if (!c.g) {
        c.g = new T.Group();
        c.body = mesh(new T.BoxGeometry(3.6, 0.7, 1.6), mat("#ffffff"), c.g, 0, 0.6, 0);
        c.cabin = mesh(new T.BoxGeometry(2, 0.6, 1.4), mat("#90a4ae", { metalness: 0.5, roughness: 0.15 }), c.g, -0.2, 1.2, 0);
        [-1.1, 1.1].forEach(function (x) { [-0.75, 0.75].forEach(function (z) { var w = mesh(new T.CylinderGeometry(0.32, 0.32, 0.2, 10), mat("#111"), c.g, x, 0.32, z); w.rotation.x = Math.PI / 2; }); });
        scene.add(c.g);
      }
      c.body.material = mat(["#e53935", "#fafafa", "#1e88e5", "#212121", "#fdd835", "#43a047"][Math.floor(Math.random() * 6)], { metalness: 0.5, roughness: 0.3 });
      c.dir = Math.random() < 0.5 ? 1 : -1;
      c.speed = 5 + Math.random() * 4;
      c.x = fresh ? Math.random() * 70 - 35 : -40 * c.dir;
      c.g.position.set(c.x, 0, c.dir > 0 ? STREET.laneB : STREET.laneA);
      c.g.rotation.y = c.dir > 0 ? 0 : Math.PI;
    }
    var i;
    for (i = 0; i < (hi ? 12 : 6); i++) { peds.push({}); spawnPed(peds[i], true); }
    for (i = 0; i < (hi ? 4 : 2); i++) { cars.push({}); spawnCar(cars[i], true); }

    // ==== 房間名稱（HTML 疊層） ====
    var labelNodes = {}, labelCache = [];
    function syncLabels() {
      labelCache = env.labels();
      labelCache.forEach(function (l) {
        var n = labelNodes[l.room];
        if (!n) { n = labelNodes[l.room] = document.createElement("span"); n.className = "sv-o3d-label"; labelLayer.appendChild(n); }
        n.textContent = l.text;
        n.classList.toggle("sv-o3d-off", !!l.off);
      });
    }

    // ==== 鏡頭與拖曳旋轉 ====
    var drag = null;
    renderer.domElement.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, yaw: yaw }; });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    function onMove(e) { if (drag) yaw = Math.max(-1.1, Math.min(1.1, drag.yaw - (e.clientX - drag.x) * 0.006)); }
    function onUp() { drag = null; }
    // 鏡頭依大樓高度拉遠、抬高視點，高樓的頂部（停機坪、尖塔）才拍得到
    var camFit = 0;
    function placeCam() {
      var want = LEVELS[Math.max(1, Math.min(10, (env.st() || { company: { level: 1 } }).company.level))].floors;
      camFit += (want - camFit) * 0.05;
      target.set(-1.5, camFit * 0.42, 3 - camFit * 0.22);
      radius = 36 + camFit * 1.25;
      pitch = 0.86 - camFit * 0.014;
      cam.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * radius, target.y + Math.sin(pitch) * radius, target.z + Math.cos(yaw) * Math.cos(pitch) * radius);
      cam.lookAt(target);
    }

    var v3 = new T.Vector3();
    function project(X, Y, Z, w, h) {
      v3.set(X, Y, Z).project(cam);
      return { left: (v3.x + 1) / 2 * 100, top: (1 - v3.y) / 2 * 100, ok: v3.z < 1 && v3.x > -1.1 && v3.x < 1.1 && v3.y > -1.1 && v3.y < 1.1 };
    }

    // ==== 主迴圈 ====
    var raf = 0, last = 0, lastSlow = 0, t0 = performance.now(), running = false, disposed = false, size = "";
    function frame(now) {
      if (disposed) return;
      if (!document.body.contains(host)) { running = false; return; }
      raf = requestAnimationFrame(frame);
      if (now - last < (hi ? 30 : 48)) return;
      var dt = Math.min(0.1, (now - (last || now)) / 1000);
      last = now;
      var st = env.st();
      if (!st) return;
      var w = host.clientWidth, h = host.clientHeight;
      if (w + "x" + h !== size) { size = w + "x" + h; renderer.setSize(w, h, false); cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix(); }
      // 每秒檢查一次要不要重建場景（升級、設施、季節、天氣、改名）
      if (now - lastSlow > 1000) {
        lastSlow = now;
        var cl = climate(st), key = [st.company.level, st.company.name, cl.season, cl.weather].concat(Object.keys(env.ROOMS).map(function (k) { return env.built(k) ? 1 : 0; })).join("|");
        if (key !== worldKey) {
          worldKey = key;
          if (world) { scene.remove(world); disposeGroup(world); }
          world = buildWorld(st);
          scene.add(world);
        }
        syncLabels();
      }
      var tt = (now - t0) / 1000, wall = Date.now();
      placeCam();
      // 設施圖上的人：位置由 starv_view_daily.js 的移動模擬內插而來
      var list = env.movers(), seen = {}, artistCount = st.artists.length;
      list.forEach(function (m) {
        seen[m.key] = true;
        var f = figs[m.key];
        if (!f) { f = figs[m.key] = figFor(m, st, artistCount); f.phase = Math.random() * 6; scene.add(f.root); }
        var k = m.until > m.start ? Math.max(0, Math.min(1, (wall - m.start) / (m.until - m.start))) : 1;
        var x = m.x0 + (m.x - m.x0) * k, y = m.y0 + (m.y - m.y0) * k, moving = wall < m.until;
        f.root.position.set(wx(x), 0.1, wz(y));
        if (moving) face(f, m.x - m.x0, m.y - m.y0, dt);
        var a = m.kind === "artist" ? Core.artistById(st, m.aid) : null;
        animate(f, tt, f.phase, moving, a && (a.stamina < 30 || a.stress > 70));
        if (m.kind === "artist") {
          var p = project(wx(x), 1.25, wz(y));
          m.node.style.left = p.left + "%";
          m.node.style.top = p.top + "%";
          m.node.style.visibility = p.ok ? "" : "hidden";
        }
      });
      Object.keys(figs).forEach(function (k) { if (!seen[k]) { scene.remove(figs[k].root); disposeGroup(figs[k].root); delete figs[k]; } });
      peds.forEach(function (p) {
        p.x += p.dir * p.speed * dt;
        if (Math.abs(p.x) > 33) spawnPed(p, false);
        p.f.root.position.set(p.x, 0.08, p.z);
        animate(p.f, tt, p.phase, true, false);
      });
      cars.forEach(function (c) {
        c.x += c.dir * c.speed * dt;
        if (Math.abs(c.x) > 42) spawnCar(c, false);
        c.g.position.x = c.x;
      });
      if (fall) {
        var arr = fall.pts.geometry.attributes.position.array, sp = fall.spec;
        for (var j = 0; j < arr.length; j += 3) {
          arr[j + 1] -= sp.speed * dt * (0.7 + (j % 7) * 0.08);
          if (sp.drift) arr[j] += Math.sin(tt + j) * sp.drift * dt;
          if (arr[j + 1] < 0) { arr[j + 1] = 16 + Math.random() * 2; arr[j] = Math.random() * 60 - 30; }
        }
        fall.pts.geometry.attributes.position.needsUpdate = true;
      }
      if (led) led.material.color.setHSL((tt * 0.08) % 1, 0.8, 0.6);
      lights.forEach(function (c) { c.rotation.z = 0.45 * Math.sin(tt * 0.6 + c.userData.phase * 1.7); c.rotation.x = 0.25 * Math.cos(tt * 0.5 + c.userData.phase); });
      // 房間名稱
      labelCache.forEach(function (l) {
        var n = labelNodes[l.room];
        if (!n) return;
        var p = project(wx(l.x), l.room === "outside" ? 2.4 : 1.05, wz(l.y));
        n.style.left = p.left + "%"; n.style.top = p.top + "%";
        n.style.visibility = p.ok ? "" : "hidden";
      });
      renderer.render(scene, cam);
    }
    function resume() { if (!running && !disposed) { running = true; last = 0; raf = requestAnimationFrame(frame); } }
    resume();

    return {
      resume: resume,
      dispose: function () {
        disposed = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        disposeGroup(scene);
        Object.keys(mats).forEach(function (k) { mats[k].dispose(); });
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
        if (labelLayer.parentNode) labelLayer.parentNode.removeChild(labelLayer);
      },
      // 測試用：目前的場景摘要
      _debug: function () { return { worldKey: worldKey, peds: peds.length, cars: cars.length, figs: Object.keys(figs).length, fall: fall ? fall.spec.n : 0, led: !!led }; }
    };
  }

  window.PriTestStarvOffice3D = { create: create, climate: climate, seasonOf: seasonOf, SEASON_ICON: SEASON_ICON, WEATHER_ICON: WEATHER_ICON, LEVELS: LEVELS,
    _force: function (c) { forced = c || null; } };
})();
