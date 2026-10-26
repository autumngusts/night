// DÉJÀ VU 山道下坡（dejavu）：畫面。物理在 dejavu_core.js，資料在 dejavu_data.js。
//   流程：設定（玩家、季節、模式）→ 山路（固定山路／輪流建造／隨機，都可以微調）→ 車庫（選車、調校）→ 自動比賽 → 結果。
//   設定存在 localStorage["pritest-dejavu-setup"]；比賽本身不存檔（同一個 seed 一定重播出同樣的比賽）。
//   比賽畫面：主畫面是跟著某台車、車頭朝上旋轉的俯視追焦鏡頭，旁邊是全圖小地圖、高低差剖面與即時名次。
(function () {
  "use strict";

  var D = window.PriTestDejavuData;
  var Core = window.PriTestDejavuCore;
  var app = document.getElementById("dv-app");
  if (!app || !D || !Core) return;

  var KEY = "pritest-dejavu-setup";
  var SCREENS = ["setup", "course", "garage", "race", "result"];
  var SEASON_ICON = { spring: "🌸", summer: "☀️", autumn: "🍁", winter: "❄️" };
  var PI_CAPS = [0, 400, 500, 600, 700, 800];
  // 固定山路的分類（第六批：日本峠／台灣／世界／MFG／原創）
  var COURSE_CATS = ["touge", "tw", "world", "mfg", "orig", "city"];
  // 我的山路（自訂路線存檔）與調校存檔：存在各自的 localStorage
  var MY_KEY = "pritest-dejavu-mycourses", MY_MAX = 60;
  var TUNE_KEY = "pritest-dejavu-tunes", TUNE_MAX = 30;
  var CAR_LIST_MAX = 60;
  // 零件面板分組（id 對應 dejavu_data.js 的 PIECES）
  var PIECE_GROUPS = [
    { id: "basic", ids: ["straight_s", "straight_l", "kink", "sweep", "medium", "tight", "hairpin", "hairpin_wide", "long_sweep", "carousel"] },
    { id: "combo", ids: ["s_curve", "chicane", "esses", "snake", "double_apex", "decreasing", "increasing", "fishhook", "cliff_run",
      "double_hairpin", "triple_hairpin", "switchback", "spiral"] },
    { id: "special", ids: ["crest", "dip", "dive", "gutter_hairpin", "gravel", "gravel_corner", "tunnel", "tunnel_curve", "bridge"] }
  ];
  // 特殊路面在地圖／俯視圖上的顏色（code 對應 D.SURFACE_IDS 的順序＋1）
  var SF_COLOR = { 1: "#a3865c", 2: "#2e7d4f", 3: "#3a3a3c", 4: "#7fa7c4" };
  var RAND_LENS = [2000, 3200, 4500];
  var SPEEDS = [1, 2, 4, 8];
  var CAMS = ["tv", "chase", "drone", "cockpit"];   // 電視轉播（導播自動切鏡頭）／追焦／空拍（MF Ghost 風）／車內第一人稱
  var Tv = window.PriTestDejavuTv;
  var WATER = { lake: "#4f86a8", sea: "#2c6b98", frozen: "#cfe2ec" };

  // 各季節的畫面配色
  var PAL = {
    spring: { ground: "#a7c785", road: "#565b60", shoulder: "#8f8c7c", trees: ["#f4b6c8", "#f9cfdb", "#7fae5b", "#ee9fb6"], line: "#f2f2f2" },
    summer: { ground: "#6c9d4b", road: "#4c5055", shoulder: "#8a876f", trees: ["#2f7a35", "#3d8b3a", "#25622b", "#4f9a44"], line: "#f2f2f2" },
    autumn: { ground: "#b39858", road: "#55524e", shoulder: "#93805a", trees: ["#d9622b", "#e8a13a", "#b8382a", "#8a6d2f", "#c9852b"], line: "#f2f2f2" },
    winter: { ground: "#e6ecf1", road: "#7f868e", shoulder: "#f3f6f9", trees: ["#2f4f3f", "#dfe8ee", "#3b5b4b", "#cfdbe3"], line: "#fbfbfb" }
  };
  var PATCH_COLOR = { leaf: "rgba(214,120,40,0.55)", ice: "rgba(200,235,255,0.8)", puddle: "rgba(50,80,120,0.45)" };

  function t(key, params) { return window.I18N.t(key, params); }
  function lang() { return window.I18N.getLang(); }
  function L(obj) { if (!obj) return ""; var l = lang(); return obj[l] || obj.zh || ""; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") node.textContent = v;
      else if (k === "class") node.className = v;
      else if (k === "style") node.setAttribute("style", v);
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  }
  function btn(label, onclick, cls, disabled) { return el("button", { type: "button", class: cls || "", onclick: onclick, disabled: !!disabled }, [label]); }

  function newSeed() { return Math.floor(Math.random() * 2147483647); }
  function fmtTime(s) {
    if (s === null || s === undefined || !isFinite(s)) return "--:--.--";
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ":" + (r < 10 ? "0" : "") + r.toFixed(2);
  }

  // ---------------- 設定 ----------------
  function defaultSpec(carId) {
    var cu = {};
    Object.keys(D.CUSTOM.range).forEach(function (k) { cu[k] = D.CUSTOM.base[k]; });
    cu.drive = D.CUSTOM.base.drive;
    return { car: carId, tire: "sport", aero: 0, gear: 0, style: "balanced", up: { eng: 0, wt: 0, brk: 0, hdl: 0 }, custom: cu };
  }
  function defaults() {
    return {
      v: 1,
      players: [{ name: "", color: D.COLORS[1] }, { name: "", color: D.COLORS[2] }],
      cpu: 2, season: "autumn", mode: "battle", rule: "real", dir: "down", piCap: 0, upPts: D.UPGRADE_POINTS,
      course: Core.fixedCourse("akina"), build: null,
      cars: [defaultSpec("ae86"), defaultSpec("fd3s")], cpuCars: null, seed: newSeed()
    };
  }
  function load() {
    try {
      var s = JSON.parse(window.localStorage.getItem(KEY) || "null");
      if (!s || s.v !== 1 || !s.players || !s.players.length || !s.course || !s.cars) return null;
      s.players = s.players.slice(0, D.MAX_CARS);
      while (s.cars.length < s.players.length) s.cars.push(defaultSpec("ae86"));
      if (D.UPGRADE_PTS_OPTIONS.indexOf(s.upPts) < 0) s.upPts = D.UPGRADE_POINTS;
      s.cars = s.cars.slice(0, s.players.length).map(function (c) { var o = Core.cleanSpec(c, s.upPts); if (!o.custom) o.custom = (c && c.custom) || defaultSpec("custom").custom; return o; });
      s.cpu = clamp(Number(s.cpu) || 0, 0, D.MAX_CARS - s.players.length);
      if (!D.SEASONS[s.season]) s.season = "autumn";
      if (D.RULE_IDS.indexOf(s.rule) < 0) s.rule = "real";
      if (s.course.src === "shinmei") s.course.src = "myogi"; // 2026-10-26 真明山改名為妙義山
      return s;
    } catch (e) { return null; }
  }
  function save() { try { window.localStorage.setItem(KEY, JSON.stringify(setup)); } catch (e) { /* 私密模式等：不存也能玩 */ } }

  var setup = load() || defaults();
  var ui = {
    screen: "setup", tab: 0, courseTab: setup.build ? "build" : (setup.course.src === "random" ? "random" : "fixed"),
    randLen: 3200, segOpen: false, side: 1, grade: "", speed: 2, paused: false, camMode: Tv ? "tv" : "chase",
    race: null, follow: null, autoFollow: true, countdown: 0, result: null, raf: 0, lastFrame: 0, acc: 0
  };

  function playerName(i) { var p = setup.players[i]; return (p && p.name) || t("dv_player_n", { n: i + 1 }); }

  // ---------------- CPU 車 ----------------
  function ensureCpu() {
    if (setup.cpuCars && setup.cpuCars.length === setup.cpu) return;
    var r = Core.rng((setup.seed ^ 0x777) + setup.cpu * 31);
    var used = setup.players.map(function (p) { return p.color; });
    var free = D.COLORS.filter(function (c) { return used.indexOf(c) < 0; });
    setup.cpuCars = [];
    for (var i = 0; i < setup.cpu; i++) {
      var spec = null;
      for (var tries = 0; tries < 40; tries++) {
        var car = D.CARS[Math.floor(r() * D.CARS.length)];
        var sp = defaultSpec(car.id);
        sp.tire = setup.season === "winter" ? "snow" : (r() < 0.3 ? "soft" : "sport");
        sp.aero = Math.floor(r() * 3);
        sp.style = D.STYLE_IDS[Math.floor(r() * 3)];
        for (var p = 0; p < setup.upPts; p++) {
          var u = D.UPGRADES[Math.floor(r() * D.UPGRADES.length)];
          if (sp.up[u] < D.UPGRADE_MAX) sp.up[u]++;
        }
        spec = sp;
        if (!setup.piCap || Core.carStats(sp, setup.upPts).pi <= setup.piCap) break;
      }
      setup.cpuCars.push({ spec: spec, color: free[i % Math.max(1, free.length)] || D.COLORS[(i + 3) % D.COLORS.length] });
    }
    save();
  }

  function raceCars() {
    ensureCpu();
    var list = setup.players.map(function (p, i) { return { spec: setup.cars[i], name: playerName(i), color: p.color, cpu: false }; });
    setup.cpuCars.forEach(function (c, i) { list.push({ spec: c.spec, name: "CPU " + (i + 1), color: c.color, cpu: true }); });
    return list;
  }

  // ---------------- 共用：賽道快取、場景 ----------------
  var trackCache = { key: "", tr: null };
  function previewTrack() {
    var key = JSON.stringify([setup.course, setup.season, setup.dir, setup.seed]);
    if (trackCache.key !== key) {
      trackCache.key = key;
      trackCache.tr = Core.buildTrack(Core.cleanCourse(setup.course), { season: setup.season, dir: setup.dir, seed: setup.seed });
      trackCache.info = Core.trackInfo(trackCache.tr);
    }
    return trackCache.tr;
  }

  // 景觀地區：山路自己設定的 region 優先；否則固定山路依分類（台灣→tw、世界名道→none、其他→jp），自訂／隨機路線預設日本
  function autoRegion(src) {
    var co = D.course(src);
    if (!co) return "jp";
    if (co.region) return co.region;

    return co.cat === "tw" ? "tw" : co.cat === "world" ? "none" : "jp";
  }
  function regionOf(tr) { return tr.region || autoRegion(tr.src); }
  function cityKind(region) { return region === "jpcity" ? "jp" : region === "twcity" ? "tw" : null; }
  var SAKURA = ["#f7c6d6", "#f4a9c0", "#fbe0e8", "#f2b5c9", "#ffd6e2"];
  var MOMIJI = ["#d8281c", "#e5501f", "#f08a24", "#c41f2e", "#f2b134", "#b81d24"];
  var TW_STALL = ["香腸", "珍奶", "臭豆腐", "鹽酥雞", "烤玉米", "芒果冰", "肉圓", "蔥油餅", "烤魷魚", "甘蔗汁"];
  var TW_NEON = ["檳榔", "KTV", "卡拉OK", "冷飲", "旅社", "海產", "熱炒", "撞球", "小吃"];
  // 看板內容都是虛構的
  var TW_BOARD = [["預售屋", "2房3房 · 近交流道"], ["土雞城", "前方 500 m ➜"], ["檳榔 香菸 飲料", "24H"], ["溫泉會館", "泡湯 · 住宿"],
    ["全台最便宜", "汽車美容"], ["鴨肉飯", "▶ 200 m"], ["租車", "0800-000-000"], ["天公廟", "前方左轉"], ["釣蝦場", "通宵"], ["駕訓班", "保證考上"]];
  var TW_ELECT = [["凍蒜！", "1 號 · 拜託拜託"], ["凍蒜！", "2 號 · 做事的人"], ["感謝支持", "3 號 · 為鄉親打拚"]];
  var TW_BG = [["#d8342c", "#fff"], ["#1f5fb8", "#fff"], ["#f5c518", "#c0262d"], ["#14853c", "#fff"], ["#ffffff", "#d8342c"], ["#6a2ca0", "#ffe14d"]];
  var NEON_COL = ["#ff3cac", "#3cf0ff", "#fff03c", "#5cff7a", "#ff7a2e"];
  var SCOOTER_COL = ["#e6e6e6", "#2b2b2b", "#c0262d", "#2a6fd6", "#f2c230", "#7ec4a8", "#9c9c9c", "#e88cb3"];
  var PEOPLE = ["uncle", "uncle", "auntie", "santaizi", "phone", "phone", "dog", "dancer", "flag"];

  // 台灣：路邊攤、機車群、霓虹招牌、民眾、大看板（只是畫面，不影響行車）
  function twDecor(tr) {
    var r = Core.rng(4242 + tr.N), out = [], hw = tr.w / 2;
    function at(s, off, o) {
      var j = clamp(Math.floor(s / tr.ds), 0, tr.N - 2), p = posAt(tr, s, off);
      o.j = j; o.off = off; o.x = p.x; o.y = p.y; o.h = p.h; o.ph = r();
      out.push(o);
      return o;
    }
    function pick(a) { return a[Math.floor(r() * a.length)]; }
    function person(s, side, near) {
      var type = pick(PEOPLE);
      at(s, side * (hw + (near ? 1.9 : 0.9 + r() * 1.3)), { kind: "person", type: type, c: pick(["#3d7cc9", "#d84a6b", "#6b4fa0", "#2f9e6a", "#e08a2a"]), c2: pick(["#d8342c", "#14853c", "#f5c518"]) });
    }
    var s = tr.start - 40;
    while (s < tr.finish + 40) {
      s += 8 + r() * 17;
      var j = clamp(Math.floor(s / tr.ds), 0, tr.N - 1);
      if (tr.sp && (tr.sp[j] === 3 || tr.sp[j] === 4)) continue;
      var side = r() < 0.5 ? 1 : -1;
      if (tr.water && side === tr.water && r() < 0.75) side = -side;
      // 權重：機車 3.5、攤販 2.5、大看板 3、霓虹 2、民眾 2.5
      var x = r() * 13.5;
      if (x < 3.5) {
        // 機車亂停：一排 2–7 台，角度亂七八糟
        var n = 2 + Math.floor(r() * 6);
        for (var k = 0; k < n; k++) at(s + k * (0.8 + r() * 0.4), side * (hw + 0.5 + r() * 0.9), { kind: "scooter", c: pick(SCOOTER_COL), ang: (r() - 0.5) * 1.2, helmet: r() < 0.4 ? pick(["#f5c518", "#fff", "#d8342c", "#2a6fd6"]) : null });
        s += n;
      } else if (x < 6) {
        at(s, side * (hw + 2.3), { kind: "stall", c: pick(["#d8342c", "#1f5fb8", "#14853c", "#f08a24"]), txt: pick(TW_STALL) });
        if (r() < 0.8) person(s + 2.2, side, true);
        if (r() < 0.4) at(s - 2, side * (hw + 0.7), { kind: "scooter", c: pick(SCOOTER_COL), ang: (r() - 0.5) * 1.2 });
      } else if (x < 9) {
        var el2 = r() < 0.3, b = el2 ? pick(TW_ELECT) : pick(TW_BOARD), bg = el2 ? ["#f08a24", "#fff"] : pick(TW_BG);
        at(s, side * (hw + 5 + r() * 5), { kind: "billboard", w: 6 + r() * 3, hgt: 6 + r() * 3, txt: b[0], sub: b[1], bg: bg[0], fg: bg[1], face: el2 });
      } else if (x < 11) {
        at(s, side * (hw + 1.8), { kind: "neon", txt: pick(TW_NEON), c: pick(NEON_COL) });
      } else person(s, side, false);
    }
    return out;
  }
  // ---------------- 城市街景（第九批） ----------------
  // 每一側沿路切成一塊塊「地」：bldg 大樓、gap 側街（路口）、temple 廟（台灣）。路口外側一定是側街（十字路口），高架路段的大樓從橋下長上來。
  //   lot：{ side, a, b（取樣點範圍）, type, h 高度, set 退縮, col 外牆, win 窗, shop 一樓店面, arcade 騎樓（台灣）, addon 屋頂鐵皮加蓋 }
  var JP_WALL = ["#d9d6cf", "#c7c3ba", "#b5b1a8", "#e4e1d8", "#a39f97", "#8d8a84", "#c9b8a0", "#7d8a96", "#9aa7b2", "#b9a48c"];
  var JP_WIN = ["#4c5a66", "#5f7486", "#3d4955", "#8fa9bf", "#6d7f8c"];
  var JP_SHOP = ["#f4f4f0", "#1f6fb2", "#d8342c", "#f2c230", "#2f9e5b", "#3a3a3a", "#e86a2b"];
  var TW_WALL = ["#d8cfc0", "#c9b9a3", "#b8b0a6", "#9c9a94", "#e0d6c8", "#8f8577", "#c4c9cc", "#d4c4ae", "#a7b4b0"];
  var TW_WIN = ["#6f7a7c", "#5d6a6d", "#7d8a86", "#4f5d63"];
  var JP_VSIGN = ["居酒屋", "カラオケ", "ラーメン", "焼肉", "薬", "歯科", "不動産", "英会話", "ネットカフェ", "ホテル", "すし", "喫茶", "牛丼", "整体"];
  var TW_TSIGN = ["診所", "牙醫", "補習班", "當舖", "茶行", "中藥行", "小吃", "火鍋", "KTV", "旅館", "眼鏡", "手機", "彩券", "藥局", "銀樓", "按讚", "冷氣", "早餐", "便當", "機車行"];
  var SIGN_BG = [["#d8342c", "#fff"], ["#f5c518", "#c0262d"], ["#1f5fb8", "#fff"], ["#ffffff", "#d8342c"], ["#14853c", "#fff"], ["#ffffff", "#1f3f8f"], ["#6a2ca0", "#ffe14d"]];
  var GINKGO = ["#f2c230", "#e8b21c", "#f7d454", "#d9a514"];
  var CITY_TREE = ["#3f7d3a", "#4a8a3f", "#2f6b33", "#5a9a48"];
  var JP_PEOPLE = ["salary", "salary", "student", "phone", "granny", "salary", "phone"];

  function cityLayout(tr, kind) {
    var r = Core.rng(9090 + tr.N), hw = tr.w / 2, N = tr.N;
    var tw = kind === "tw";
    var co = D.course(tr.src), prof = co && co.prof || "city_grid";
    var lots = [], lotOf = { "1": new Int16Array(N).fill(-1), "-1": new Int16Array(N).fill(-1) };
    var cross = new Uint8Array(N);
    function pick(a) { return a[Math.floor(r() * a.length)]; }
    // 路口：急彎（棋盤街區的 90° 路口）的外側是側街
    var corner = { "1": new Uint8Array(N), "-1": new Uint8Array(N) };
    for (var i = 0; i < N; i++) {
      if (Math.abs(tr.k[i]) > 1 / 32) {
        var out = tr.k[i] > 0 ? -1 : 1;
        for (var q = Math.max(0, i - 7); q <= Math.min(N - 1, i + 7); q++) corner[out][q] = 1;
      }
    }
    [1, -1].forEach(function (side) {
      var j = 0;
      while (j < N - 1) {
        var elev = tr.sp && tr.sp[j] === 4;
        var water = tr.water && side === tr.water;
        var lot = { side: side, a: j };
        var len;
        if (water) { lot.type = "water"; len = 30; }
        else if (corner[side][j]) {
          lot.type = "gap"; len = 1;
          while (j + len < N - 1 && corner[side][j + len]) len++;
        } else if (!elev && prof !== "city_express" && r() < (prof === "city_avenue" ? 0.08 : 0.14)) {
          lot.type = "gap"; len = 5 + Math.floor(r() * 3);
        } else {
          lot.type = tw && !elev && r() < 0.035 ? "temple" : "bldg";
          len = Math.round((tw ? 5 : 6) + r() * (tw ? 7 : 11));
          var tall = r() < (prof === "city_avenue" ? 0.3 : 0.12);
          lot.h = lot.type === "temple" ? 7 : tw ? (tall ? 40 + r() * 80 : 10 + Math.floor(r() * 6) * 3.2) : (tall ? 45 + r() * 90 : 12 + r() * 30);
          lot.set = r() < 0.3 ? r() * 2 : 0;
          lot.col = lot.type === "temple" ? "#b3261e" : pick(tw ? TW_WALL : JP_WALL);
          lot.win = pick(tw ? TW_WIN : JP_WIN);
          lot.shop = pick(JP_SHOP);
          lot.glass = !tw && tall && r() < 0.6;          // 高樓：整面玻璃帷幕
          lot.arcade = tw && lot.type === "bldg" && !tall;  // 騎樓
          lot.addon = tw && !tall && r() < 0.55 ? pick(["#3f6fa3", "#9b5a37", "#5d7f9c", "#8a8f94"]) : null;
          lot.base = elev ? -9 : 0;
        }
        lot.b = Math.min(N - 1, j + len);
        var id = lots.length;
        lots.push(lot);
        for (var q2 = lot.a; q2 <= lot.b; q2++) lotOf[side][q2] = id;
        // 側街的兩端：主路上畫斑馬線
        if (lot.type === "gap" && !elev) {
          for (var c1 = 0; c1 < 2; c1++) {
            var at = c1 ? lot.b + 1 : lot.a - 3;
            for (var c2 = 0; c2 < 2; c2++) if (at + c2 >= 0 && at + c2 < N) cross[at + c2] = 1;
          }
        }
        j = lot.b + 1;
      }
    });
    return { kind: kind, lots: lots, lotOf: lotOf, cross: cross, prof: prof, lm: co && co.lm || "" };
  }
  // 城市的路邊景物：行道樹、電線桿與電線（日本）、自動販賣機、紅綠燈、招牌、機車（台灣）、行人、屋頂水塔與看板
  function cityDecor(tr, city, trees) {
    var r = Core.rng(7171 + tr.N), out = [], hw = tr.w / 2, tw = city.kind === "tw";
    function at(s, off, o) {
      var j = clamp(Math.floor(s / tr.ds), 0, tr.N - 2), p = posAt(tr, s, off);
      o.j = j; o.off = off; o.x = p.x; o.y = p.y; o.h = p.h; o.ph = r();
      out.push(o);
      return o;
    }
    function pick(a) { return a[Math.floor(r() * a.length)]; }
    var treeCol = tr.season === "autumn" && !tw ? GINKGO : tr.season === "spring" && !tw ? SAKURA : tr.season === "winter" && !tw ? ["#8a7f72", "#9a8f80"] : CITY_TREE;
    var poles = { "1": null, "-1": null };
    city.lots.forEach(function (lot) {
      var side = lot.side, s0 = lot.a * tr.ds, s1 = lot.b * tr.ds, L = s1 - s0, s, k;
      if (lot.type === "water") {
        if (r() < 0.5) at(s0 + r() * L, side * (hw + 1.2), { kind: "person", type: tw ? pick(PEOPLE) : pick(JP_PEOPLE), c: pick(["#3d7cc9", "#d84a6b", "#6b4fa0", "#2f9e6a", "#333"]), c2: "#d8342c" });
        return;
      }
      if (lot.type === "gap") {
        // 路口：紅綠燈（兩個角各一支）
        // 燈桿立在人行道，懸臂伸到車道上方（ax／ay＝懸臂末端）
        function light(sl) {
          var o = at(sl, side * (hw + 0.8), { kind: "light", tw: tw, arm: side });
          var pe = posAt(tr, sl, side * (hw + 0.8 - 4.5));
          o.ax = pe.x; o.ay = pe.y;
        }
        if (lot.b - lot.a >= 4) {
          light(s0 - 1);
          if (r() < 0.6) light(s1 + 1);
        }
        return;
      }
      if (lot.base < 0) {
        // 高架旁的大樓：只放屋頂看板
        if (r() < 0.25) at(s0 + L / 2, side * (hw + 9 + lot.set + 6), { kind: "billboard", w: 8 + r() * 4, hgt: 4 + r() * 2, dz: lot.base + lot.h, txt: pick(tw ? TW_BOARD : [["新発売", "冷たい！"], ["24H", "パーキング"], ["英会話", "駅前"], ["不動産", "賃貸・売買"]])[0], sub: "", bg: pick(TW_BG)[0], fg: "#fff" });
        return;
      }
      var face = hw + 3 + lot.set;
      // 行道樹（人行道外緣）
      for (s = s0 + 3 + r() * 4; s < s1 - 2; s += 9 + r() * 5) {
        if (r() < (tw ? 0.45 : 0.6)) {
          var p = posAt(tr, s, side * (hw + 0.9));
          trees.push({ x: p.x, y: p.y, r: 1.4 + r() * 0.9, c: pick(treeCol), j: clamp(Math.floor(s / tr.ds), 0, tr.N - 1), o: side * (hw + 0.9), kind: 0.95, city: true });
        }
      }
      if (lot.type === "temple") {
        at(s0 + L / 2, side * (face + 0.2), { kind: "troof", w: Math.min(L, 16), dz: 7 });
        at(s0 + L / 2, side * (hw + 1.6), { kind: "person", type: "santaizi", c: "#d8342c" });
        return;
      }
      if (!tw) {
        // 日本：電線桿（每 30 m 左右，同一側用電線連起來）、自動販賣機、直立招牌、腳踏車、行人
        for (s = s0 + r() * 10; s < s1; s += 26 + r() * 10) {
          var pole = at(s, side * (hw + 0.5), { kind: "upole" });
          if (poles[side]) { poles[side].nx = pole.x; poles[side].ny = pole.y; poles[side].nj = pole.j; }
          poles[side] = pole;
        }
        if (r() < 0.35) { var vs = s0 + r() * L; at(vs, side * (hw + 2.5), { kind: "vend", c: pick(["#f4f4f0", "#d8342c", "#1f6fb2"]) }); at(vs + 1.1, side * (hw + 2.5), { kind: "vend", c: pick(["#f4f4f0", "#d8342c", "#1f6fb2"]) }); }
        for (k = 0; k < Math.min(3, Math.floor(lot.h / 12)); k++) {
          if (r() < 0.55) { var sb = pick(SIGN_BG); at(s0 + 1 + r() * Math.max(1, L - 2), side * (face - 0.5), { kind: "vsign", txt: pick(JP_VSIGN), bg: sb[0], fg: sb[1], dz: 4 + r() * Math.max(1, lot.h - 14), hgt: 4 + r() * 5 }); }
        }
        if (r() < 0.3) at(s0 + r() * L, side * (hw + 2.2), { kind: "bike", c: pick(["#c0c0c0", "#d8342c", "#2a6fd6", "#222"]) });
        for (k = 0; k < 2; k++) if (r() < 0.55) at(s0 + r() * L, side * (hw + 1.2 + r() * 1.5), { kind: "person", type: pick(JP_PEOPLE), c: pick(["#2b2f3a", "#3a3f4a", "#1f2633", "#6b4fa0", "#d84a6b"]), c2: "#2a6fd6" });
      } else {
        // 台灣：騎樓前整排機車、突出的直立招牌（一層層）、霓虹、攤販、行人、屋頂水塔
        if (r() < 0.75) {
          var n = 3 + Math.floor(r() * Math.min(10, L / 1.0));
          var sc0 = s0 + r() * 2;
          for (k = 0; k < n && sc0 + k * 0.85 < s1; k++) at(sc0 + k * (0.8 + r() * 0.15), side * (hw + 1.0 + r() * 0.5), { kind: "scooter", c: pick(SCOOTER_COL), ang: Math.PI / 2 + (r() - 0.5) * 0.5, helmet: r() < 0.35 ? pick(["#f5c518", "#fff", "#d8342c", "#2a6fd6"]) : null });
        }
        var nS = Math.max(1, Math.round(L / 7));
        for (k = 0; k < nS; k++) {
          var stack = [], levels = Math.min(5, Math.max(1, Math.floor((lot.h - 3) / 3.2)));
          for (var lv = 0; lv < levels; lv++) { var bg = pick(SIGN_BG); stack.push({ txt: pick(TW_TSIGN), bg: bg[0], fg: bg[1] }); }
          at(s0 + (k + 0.5) * L / nS, side * (hw + 2.4), { kind: "tsign", stack: stack, dz: 3.4 });
        }
        if (r() < 0.25) at(s0 + r() * L, side * (hw + 2.0), { kind: "neon", txt: pick(TW_NEON), c: pick(NEON_COL) });
        if (r() < 0.15) at(s0 + r() * L, side * (hw + 2.3), { kind: "stall", c: pick(["#d8342c", "#1f5fb8", "#14853c", "#f08a24"]), txt: pick(TW_STALL) });
        if (r() < 0.5) at(s0 + r() * L, side * (hw + 1.6 + r()), { kind: "person", type: pick(PEOPLE), c: pick(["#3d7cc9", "#d84a6b", "#6b4fa0", "#2f9e6a", "#e08a2a"]), c2: pick(["#d8342c", "#14853c", "#f5c518"]) });
        if (lot.addon || r() < 0.5) at(s0 + L * (0.3 + r() * 0.4), side * (face + 4), { kind: "wtank", dz: lot.h + (lot.addon ? 2.6 : 0) });
      }
      // 屋頂看板
      if (lot.h > 14 && r() < (tw ? 0.18 : 0.22)) {
        var b = tw ? pick(TW_BOARD) : pick([["新発売", "冷たい一杯"], ["英会話", "駅から 1 分"], ["24H", "パーキング"], ["不動産", "賃貸・売買"], ["カメラ", "ポイント 10%"], ["ラーメン", "→ 50 m"]]), bc = pick(TW_BG);
        at(s0 + L / 2, side * (face + 3), { kind: "billboard", w: Math.min(L, 6 + r() * 6), hgt: 4 + r() * 2, dz: lot.h, txt: b[0], sub: b[1], bg: bc[0], fg: bc[1] });
      }
    });
    return out;
  }

  // 日本冬天：雪牆的高度（每個取樣點；0＝這段沒有雪牆）
  function snowWalls(tr) {
    var h = new Float32Array(tr.N), ph = (tr.N % 97) / 15;
    for (var i = 0; i < tr.N; i++) {
      if (tr.sp && (tr.sp[i] === 3 || tr.sp[i] === 4)) continue;
      var on = Math.sin(i * 0.006 + ph) > -0.35;
      if (on) h[i] = 1.3 + 1.7 * (0.5 + 0.5 * Math.sin(i * 0.021 + ph * 2)) + 0.25 * Math.sin(i * 0.17);
    }
    return h;
  }

  // 路邊的樹（決定論；離任何一段路太近的不種）
  function scenery(tr) {
    if (tr._scenery) return tr._scenery;
    var r = Core.rng(1234 + tr.N);
    var cell = 20, grid = {};
    var i;
    for (i = 0; i < tr.N; i += 2) {
      var key = Math.floor(tr.x[i] / cell) + "," + Math.floor(tr.y[i] / cell);
      (grid[key] = grid[key] || []).push(i);
    }
    function near(x, y, lim) {
      var cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) {
        var list = grid[(cx + a) + "," + (cy + b)];
        if (!list) continue;
        for (var j = 0; j < list.length; j++) {
          var dx = tr.x[list[j]] - x, dy = tr.y[list[j]] - y;
          if (dx * dx + dy * dy < lim * lim) return true;
        }
      }
      return false;
    }
    var trees = [], cols = PAL[tr.season].trees;
    for (i = 0; i < tr.N; i += 4) {
      if (tr.sp && (tr.sp[i] === 3 || tr.sp[i] === 4)) continue;   // 隧道裡、橋上沒有樹
      for (var side = -1; side <= 1; side += 2) {
        if (r() < 0.35) continue;
        if (tr.water && side === tr.water) continue;
        var o = side * (tr.w / 2 + 3.5 + r() * 22);
        var x = tr.x[i] - Math.sin(tr.h[i]) * o, y = tr.y[i] + Math.cos(tr.h[i]) * o;
        if (near(x, y, tr.w / 2 + 3)) continue;
        trees.push({ x: x, y: y, r: 1.6 + r() * 2.4, c: cols[Math.floor(r() * cols.length)], j: i, o: o, kind: r() });
      }
    }
    // 日本的春天／秋天：路邊再種一排櫻花／紅葉行道樹（較靠近路、比較密）
    var region = regionOf(tr);
    if (region === "jp" && (tr.season === "spring" || tr.season === "autumn")) {
      var jcol = tr.season === "spring" ? SAKURA : MOMIJI;
      for (i = 0; i < tr.N; i += 3) {
        if (tr.sp && (tr.sp[i] === 3 || tr.sp[i] === 4)) continue;
        for (var s2 = -1; s2 <= 1; s2 += 2) {
          if (r() < 0.45 || tr.water && s2 === tr.water) continue;
          var o2 = s2 * (tr.w / 2 + 2.8 + r() * 8);
          var x2 = tr.x[i] - Math.sin(tr.h[i]) * o2, y2 = tr.y[i] + Math.cos(tr.h[i]) * o2;
          if (near(x2, y2, tr.w / 2 + 2.4)) continue;
          trees.push({ x: x2, y: y2, r: 1.8 + r() * 1.6, c: jcol[Math.floor(r() * jcol.length)], j: i, o: o2, kind: 0.95 });
        }
      }
    }
    // 路段分塊（畫面只畫看得到的部分）
    var chunks = [], CH = 25;
    for (i = 0; i < tr.N - 1; i += CH) {
      var b2 = Math.min(tr.N - 1, i + CH), mx = 0, my = 0, n = 0, rad = 0, j;
      for (j = i; j <= b2; j++) { mx += tr.x[j]; my += tr.y[j]; n++; }
      mx /= n; my /= n;
      for (j = i; j <= b2; j++) rad = Math.max(rad, Math.hypot(tr.x[j] - mx, tr.y[j] - my));
      chunks.push({ a: i, b: b2, x: mx, y: my, r: rad + tr.w + 4 });
    }
    // 特殊路面的連續區間
    var spr = [];
    if (tr.sp) for (i = 0; i < tr.N; i++) {
      if (!tr.sp[i]) continue;
      if (spr.length && spr[spr.length - 1].code === tr.sp[i] && spr[spr.length - 1].b === i - 1) spr[spr.length - 1].b = i;
      else spr.push({ a: i, b: i, code: tr.sp[i] });
    }
    // 城市：沒有山林的樹，改成街區（大樓、側街）＋行道樹＋街道景物
    var ck = cityKind(region), city = null;
    if (ck) { trees.length = 0; city = cityLayout(tr, ck); }
    var decor = city ? cityDecor(tr, city, trees) : region === "tw" ? twDecor(tr) : [];
    var sw = region === "jp" && tr.season === "winter" ? snowWalls(tr) : null;
    var shoulder = region === "jp" && tr.season === "spring" ? "#e6b3c3" : region === "jp" && tr.season === "autumn" ? "#b8572e" : null;
    if (city) { sw = null; shoulder = null; }
    tr._scenery = { trees: trees, chunks: chunks, sp: spr, region: region, decor: decor, snowWall: sw, shoulder: shoulder, city: city };
    return tr._scenery;
  }

  function fitCanvas(cv) {
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(10, Math.round(cv.clientWidth * dpr)), h = Math.max(10, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: cv.clientWidth, h: cv.clientHeight };
  }

  // 全圖（北朝上）：opts { race?, owners?: true（輪流建造時依建造者上色） }
  function drawMap(cv, tr, opts) {
    opts = opts || {};
    var f = fitCanvas(cv), ctx = f.ctx;
    var pal = PAL[tr.season];
    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, 0, f.w, f.h);
    var bb = tr.bbox, pad = 14;
    var sc = Math.min((f.w - pad * 2) / Math.max(30, bb.maxX - bb.minX), (f.h - pad * 2) / Math.max(30, bb.maxY - bb.minY));
    var ox = (f.w - (bb.maxX - bb.minX) * sc) / 2, oy = (f.h - (bb.maxY - bb.minY) * sc) / 2;
    function X(i) { return ox + (tr.x[i] - bb.minX) * sc; }
    function Y(i) { return f.h - oy - (tr.y[i] - bb.minY) * sc; }
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    function path(a, b) { ctx.beginPath(); ctx.moveTo(X(a), Y(a)); for (var i = a + 1; i <= b; i++) ctx.lineTo(X(i), Y(i)); }
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 6; path(0, tr.N - 1); ctx.stroke();
    ctx.strokeStyle = pal.road; ctx.lineWidth = 3.5; path(0, tr.N - 1); ctx.stroke();
    if (opts.owners) {
      var segs = setup.course.segs, a = 0;
      for (var i = 1; i <= tr.N; i++) {
        if (i === tr.N || tr.segOf[i] !== tr.segOf[a]) {
          var sg = segs[tr.segOf[a]];
          if (sg && sg.o !== undefined && setup.players[sg.o]) {
            ctx.strokeStyle = setup.players[sg.o].color; ctx.lineWidth = 3.5; path(a, Math.min(i, tr.N - 1)); ctx.stroke();
          }
          a = i;
        }
      }
    }
    tr.patches.forEach(function (p) { ctx.strokeStyle = PATCH_COLOR[p.kind]; ctx.lineWidth = 3.5; path(p.a, p.b); ctx.stroke(); });
    scenery(tr).sp.forEach(function (r) {
      ctx.strokeStyle = SF_COLOR[r.code]; ctx.lineWidth = r.code === 3 ? 7 : r.code === 4 ? 6 : 3;
      if (r.code === 3 || r.code === 4) ctx.globalAlpha = 0.75;
      path(r.a, r.b); ctx.stroke(); ctx.globalAlpha = 1;
    });
    var si = Math.round(tr.start / tr.ds), fi = Math.round(tr.finish / tr.ds);
    [[si, "#2e9e5b"], [fi, "#111"]].forEach(function (m) {
      ctx.fillStyle = m[1]; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(m[0]), Y(m[0]), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    if (opts.race) {
      opts.race.cars.slice().reverse().forEach(function (c) {
        if (c.state === "dnf") return;
        var ps = Core.carPose(opts.race, c);
        var x = ox + (ps.x - bb.minX) * sc, y = f.h - oy - (ps.y - bb.minY) * sc;
        ctx.fillStyle = c.color; ctx.strokeStyle = c.id === ui.follow ? "#ff0" : "#000"; ctx.lineWidth = c.id === ui.follow ? 2.5 : 1.2;
        ctx.beginPath(); ctx.arc(x, y, c.id === ui.follow ? 5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
    }
  }

  // 高低差剖面
  function drawElev(cv, tr, race) {
    var f = fitCanvas(cv), ctx = f.ctx;
    ctx.clearRect(0, 0, f.w, f.h);
    var bb = tr.bbox, span = Math.max(20, bb.maxZ - bb.minZ), pad = 6;
    function X(s) { return pad + (s / tr.L) * (f.w - pad * 2); }
    function Y(z) { return f.h - pad - (z - bb.minZ) / span * (f.h - pad * 2); }
    ctx.beginPath(); ctx.moveTo(X(0), f.h);
    for (var i = 0; i < tr.N; i += 3) ctx.lineTo(X(i * tr.ds), Y(tr.z[i]));
    ctx.lineTo(X(tr.L), f.h); ctx.closePath();
    ctx.fillStyle = "rgba(120,140,120,0.35)"; ctx.fill();
    ctx.strokeStyle = "rgba(90,110,90,0.9)"; ctx.lineWidth = 1.5; ctx.stroke();
    [tr.start, tr.finish].forEach(function (s) { ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(s), 0); ctx.lineTo(X(s), f.h); ctx.stroke(); ctx.setLineDash([]); });
    if (race) race.cars.forEach(function (c) {
      var z = tr.z[clamp(Math.floor(c.s / tr.ds), 0, tr.N - 1)];
      ctx.fillStyle = c.color; ctx.strokeStyle = "#000"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(X(c.s), Y(z), c.id === ui.follow ? 4.5 : 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
  }

  // ---------------- 外框 ----------------
  function stepNav() {
    var labels = { setup: "dv_step_setup", course: "dv_step_course", garage: "dv_step_garage", race: "dv_step_race", result: "dv_step_result" };
    var cur = SCREENS.indexOf(ui.screen);
    return el("ol", { class: "dv-steps" }, SCREENS.map(function (s, i) {
      var can = i < cur && i <= 2;
      return el("li", { class: (i === cur ? "dv-on" : "") + (can ? " dv-can" : ""), onclick: can ? function () { go(s); } : null }, [t(labels[s])]);
    }));
  }

  function go(screen) {
    if (ui.screen === "race" && screen !== "race") stopLoop();
    stopHl();
    ui.screen = screen;
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    stopHl();
    if (ui.screen === "race") return renderRace();
    app.innerHTML = "";
    app.appendChild(stepNav());
    if (ui.screen === "setup") renderSetup();
    else if (ui.screen === "course") renderCourse();
    else if (ui.screen === "garage") renderGarage();
    else if (ui.screen === "result") renderResult();
  }

  function choice(ids, cur, labelOf, onpick, cls) {
    return el("div", { class: "dv-choice " + (cls || "") }, ids.map(function (id) {
      return btn(labelOf(id), function () { onpick(id); }, id === cur ? "dv-on" : "");
    }));
  }

  // ---------------- 1. 設定 ----------------
  function renderSetup() {
    var box = el("div", { class: "dv-panel" }, [el("p", { class: "dv-intro" }, [t("dv_intro")])]);
    app.appendChild(box);

    var pl = el("div", { class: "dv-panel" }, [el("h2", {}, [t("dv_players")])]);
    setup.players.forEach(function (p, i) {
      pl.appendChild(el("div", { class: "dv-player-row" }, [
        el("button", {
          type: "button", class: "dv-swatch", style: "background:" + p.color, title: t("dv_color"),
          onclick: function () {
            var k = D.COLORS.indexOf(p.color);
            p.color = D.COLORS[(k + 1) % D.COLORS.length];
            setup.cpuCars = null; save(); render();
          }
        }, []),
        el("input", {
          type: "text", maxlength: "16", value: p.name, placeholder: t("dv_player_n", { n: i + 1 }), class: "dv-name",
          oninput: function (e) { p.name = e.target.value.slice(0, 16); save(); }
        }, []),
        setup.players.length > 1 ? btn("✕", function () {
          setup.players.splice(i, 1); setup.cars.splice(i, 1);
          if (setup.build) setup.build = null;
          setup.cpuCars = null; save(); render();
        }, "dv-x") : null
      ]));
    });
    pl.appendChild(el("div", { class: "dv-actions" }, [
      btn(t("dv_add_player"), function () {
        var used = setup.players.map(function (p) { return p.color; });
        var col = D.COLORS.filter(function (c) { return used.indexOf(c) < 0; })[0] || D.COLORS[0];
        setup.players.push({ name: "", color: col });
        setup.cars.push(defaultSpec(D.CARS[(setup.players.length * 5) % D.CARS.length].id));
        setup.cpu = Math.min(setup.cpu, D.MAX_CARS - setup.players.length);
        setup.cpuCars = null; save(); render();
      }, "", setup.players.length >= D.MAX_CARS),
      el("span", { class: "dv-muted" }, [t("dv_cpu")]),
      btn("−", function () { setup.cpu = Math.max(0, setup.cpu - 1); setup.cpuCars = null; save(); render(); }, "dv-step", setup.cpu <= 0),
      el("b", { class: "dv-num" }, [String(setup.cpu)]),
      btn("+", function () { setup.cpu++; setup.cpuCars = null; save(); render(); }, "dv-step", setup.players.length + setup.cpu >= D.MAX_CARS)
    ]));
    app.appendChild(pl);

    var rules = el("div", { class: "dv-panel" }, [
      el("h3", {}, [t("dv_rule")]),
      choice(D.RULE_IDS, setup.rule, function (id) { return t("dv_rule_" + id); }, function (id) { setup.rule = id; save(); render(); }, "dv-big"),
      el("p", { class: "dv-muted" }, [t("dv_rule_" + setup.rule + "_desc")]),
      el("h3", {}, [t("dv_season")]),
      choice(D.SEASON_IDS, setup.season, function (id) { return SEASON_ICON[id] + " " + L(D.SEASONS[id].name); },
        function (id) { setup.season = id; setup.cpuCars = null; save(); render(); }, "dv-big"),
      el("p", { class: "dv-muted" }, [t("dv_season_" + setup.season)]),
      el("h3", {}, [t("dv_mode")]),
      choice(["battle", "attack"], setup.mode, function (id) { return t("dv_mode_" + id); }, function (id) { setup.mode = id; save(); render(); }),
      el("p", { class: "dv-muted" }, [t("dv_mode_" + setup.mode + "_desc")]),
      el("h3", {}, [t("dv_dir")]),
      choice(["down", "up"], setup.dir, function (id) { return t("dv_dir_" + id); }, function (id) { setup.dir = id; save(); render(); }),
      el("h3", {}, [t("dv_picap")]),
      choice(PI_CAPS.map(String), String(setup.piCap), function (id) { return id === "0" ? t("dv_picap_none") : "PI ≤ " + id; },
        function (id) { setup.piCap = Number(id); setup.cpuCars = null; save(); render(); }),
      el("p", { class: "dv-muted" }, [t("dv_picap_desc")]),
      el("h3", {}, [t("dv_uppts")]),
      choice(D.UPGRADE_PTS_OPTIONS.map(String), String(setup.upPts), function (id) { return t("dv_uppts_" + id); },
        function (id) { setup.upPts = Number(id); setup.cars = setup.cars.map(function (c) { var o = Core.cleanSpec(c, setup.upPts); o.custom = c.custom; return o; }); setup.cpuCars = null; save(); render(); }),
      el("p", { class: "dv-muted" }, [t("dv_uppts_desc")])
    ]);
    app.appendChild(rules);
    app.appendChild(el("div", { class: "dv-actions dv-next" }, [
      btn(t("dv_reset"), function () { setup = defaults(); save(); render(); }, "dv-link"),
      btn(t("dv_next_course"), function () { go("course"); }, "dv-primary")
    ]));
  }

  // ---------------- 2. 山路 ----------------
  function courseName() {
    var c = setup.course;
    var fixed = D.course(c.src);
    var name = fixed ? L(fixed.name) : c.name ? c.name : c.src === "random" ? t("dv_course_random") : t("dv_course_custom");
    return name + (fixed && c.mod ? t("dv_modified") : "");
  }

  function touchCourse() { setup.course.mod = true; save(); render(); }

  function renderCourse() {
    var tabs = choice(["fixed", "build", "random", "my"], ui.courseTab, function (id) { return t("dv_ctab_" + id); }, function (id) { ui.courseTab = id; render(); });
    var panel = el("div", { class: "dv-panel" }, [tabs]);
    if (ui.courseTab === "fixed") {
      panel.appendChild(renderCoursePicker());
    } else if (ui.courseTab === "my") {
      panel.appendChild(renderMyCourses());
    } else if (ui.courseTab === "random") {
      panel.appendChild(el("p", { class: "dv-muted" }, [t("dv_random_desc")]));
      panel.appendChild(el("div", { class: "dv-actions" }, [
        choice(RAND_LENS.map(String), String(ui.randLen), function (id) { return (Number(id) / 1000).toFixed(1) + " km"; }, function (id) { ui.randLen = Number(id); render(); }),
        btn(t("dv_generate"), function () {
          setup.course = Core.randomCourse(newSeed(), ui.randLen); setup.build = null; save(); render();
        }, "dv-primary")
      ]));
    } else {
      panel.appendChild(renderBuilder());
    }
    app.appendChild(panel);

    // 預覽＋資訊
    var tr = previewTrack(), info = trackCache.info;
    var map = el("canvas", { class: "dv-map" }, []);
    var elev = el("canvas", { class: "dv-elev" }, []);
    var warn = [];
    if (info.cross) warn.push(el("p", { class: "dv-muted" }, [t("dv_cross", { n: info.cross })]));
    if (tr.rain) warn.push(el("p", { class: "dv-muted" }, ["🌧 " + t("dv_rain_forecast")]));
    var prev = el("div", { class: "dv-panel" }, [
      el("h2", {}, [courseName()]),
      el("div", { class: "dv-preview" }, [map, el("div", { class: "dv-preview-side" }, [
        el("ul", { class: "dv-facts" }, [
          el("li", {}, [t("dv_fact_len"), el("b", {}, [(info.len / 1000).toFixed(2) + " km"])]),
          el("li", {}, [t("dv_fact_corners"), el("b", {}, [String(info.corners)])]),
          el("li", {}, [t("dv_fact_hairpins"), el("b", {}, [String(info.hairpins)])]),
          el("li", {}, [t(setup.dir === "up" ? "dv_fact_climb" : "dv_fact_drop"), el("b", {}, [Math.abs(Math.round(info.drop)) + " m"])])
        ]),
        el("label", { class: "dv-range" }, [t("dv_width"), el("input", {
          type: "range", min: "5", max: "10", step: "0.5", value: String(setup.course.w),
          onchange: function (e) { setup.course.w = Number(e.target.value); touchCourse(); }
        }, []), el("b", {}, [setup.course.w + " m"])]),
        el("label", { class: "dv-range" }, [t("dv_grade"), el("input", {
          type: "range", min: "0", max: "14", step: "1", value: String(setup.course.g),
          onchange: function (e) { setup.course.g = Number(e.target.value); touchCourse(); }
        }, []), el("b", {}, [setup.course.g + " %"])]),
        // 景觀地區（只影響畫面）：自動＝依山路
        el("label", { class: "dv-range" }, [t("dv_region"), el("select", {
          class: "dv-region", onchange: function (e) { setup.course.region = e.target.value; save(); render(); }
        }, [""].concat(D.REGIONS).map(function (id) {
          return el("option", { value: id, selected: (setup.course.region || "") === id }, [id ? t("dv_region_" + id) : t("dv_region_auto", { r: t("dv_region_" + autoRegion(setup.course.src)) })]);
        })), el("b", {}, [""])]),

        el("div", { class: "dv-legend dv-small" }, [
          el("span", {}, [el("i", { style: "background:#2e9e5b" }, []), t("dv_start")]),
          el("span", {}, [el("i", { style: "background:#111" }, []), t("dv_finish")]),
          setup.season === "autumn" ? el("span", {}, [el("i", { style: "background:" + PATCH_COLOR.leaf }, []), t("dv_patch_leaf")]) : null,
          setup.season === "winter" ? el("span", {}, [el("i", { style: "background:" + PATCH_COLOR.ice }, []), t("dv_patch_ice")]) : null,
          tr.rain ? el("span", {}, [el("i", { style: "background:" + PATCH_COLOR.puddle }, []), t("dv_patch_puddle")]) : null
        ])
      ].concat(warn))]),
      elev
    ]);
    app.appendChild(prev);
    app.appendChild(renderSegEditor());
    app.appendChild(el("div", { class: "dv-actions dv-next" }, [
      btn(t("dv_back"), function () { go("setup"); }),
      btn(t("dv_next_garage"), function () { go("garage"); }, "dv-primary", info.len < 300 || buildPending())
    ]));
    if (info.len < 300) app.appendChild(el("p", { class: "dv-muted dv-right" }, [t("dv_too_short")]));
    requestAnimationFrame(function () { drawMap(map, tr, { owners: !!setup.build }); drawElev(elev, tr); });
  }

  // ---- 固定山路選單（第六批：分類、路線性格、搜尋） ----
  function courseCat(co) { return co.cat || "touge"; }
  function courseMatch(co, q) {
    if (!q) return true;
    var n = co.name || {};
    return [n.zh, n.ja, n.en, co.id].join(" ").toLowerCase().indexOf(q) >= 0;
  }
  function courseList() {
    var q = (ui.courseQ || "").trim().toLowerCase(), cat = ui.courseCat || "touge", prof = ui.courseProf || "";
    return D.COURSES.filter(function (co) {
      if (q) return courseMatch(co, q) && (!prof || co.prof === prof);   // 搜尋時跨分類
      return courseCat(co) === cat && (!prof || co.prof === prof);
    });
  }
  function fillCourseCards(box) {
    box.innerHTML = "";
    var list = courseList();
    if (!list.length) box.appendChild(el("p", { class: "dv-muted" }, [t("dv_course_none")]));
    list.forEach(function (co) {
      var on = setup.course.src === co.id && !setup.build;
      var len = Core.courseLen(Core.fixedCourse(co.id));
      box.appendChild(el("button", {
        type: "button", class: "dv-card" + (on ? " dv-on" : ""),
        onclick: function () { setup.course = Core.fixedCourse(co.id); setup.build = null; save(); render(); }
      }, [el("b", {}, [L(co.name)]),
        el("span", { class: "dv-small" }, [(len / 1000).toFixed(1) + " km · " + t("dv_width_n", { n: co.w }) + (co.prof ? " · " + t("dv_prof_" + co.prof) : "")]),
        el("span", { class: "dv-small dv-muted" }, [co.desc ? L(co.desc) : co.prof ? t("dv_profd_" + co.prof) : ""])]));
    });
  }
  function renderCoursePicker() {
    var cat = ui.courseCat || "touge";
    var box = el("div", {}, []);
    var cards = el("div", { class: "dv-cards" }, []);
    box.appendChild(el("div", { class: "dv-actions" }, [
      choice(COURSE_CATS, cat, function (id) {
        return t("dv_cat_" + id) + " " + D.COURSES.filter(function (co) { return courseCat(co) === id; }).length;
      }, function (id) { ui.courseCat = id; ui.courseQ = ""; render(); })
    ]));
    box.appendChild(el("div", { class: "dv-actions" }, [
      el("select", { onchange: function (e) { ui.courseProf = e.target.value; fillCourseCards(cards); } },
        [""].concat(D.COURSE_PROFILES || []).map(function (id) { return el("option", { value: id, selected: (ui.courseProf || "") === id }, [id ? t("dv_prof_" + id) : t("dv_prof_all")]); })),
      el("input", {
        type: "search", class: "dv-search", value: ui.courseQ || "", placeholder: t("dv_course_search"),
        oninput: function (e) { ui.courseQ = e.target.value; fillCourseCards(cards); }
      }, []),
      btn("🎲 " + t("dv_course_pick_random"), function () {
        var list = courseList();
        if (!list.length) list = D.COURSES;
        var co = list[Math.floor(Math.random() * list.length)];
        setup.course = Core.fixedCourse(co.id); setup.build = null; ui.courseCat = courseCat(co); save(); render();
      })
    ]));
    if (cat === "mfg" && !ui.courseQ) box.appendChild(el("p", { class: "dv-muted dv-small" }, [t("dv_cat_mfg_note")]));
    fillCourseCards(cards);
    box.appendChild(cards);
    return box;
  }

  // ---- 我的山路（自訂路線存檔、匯出／匯入代碼） ----
  function loadMy() {
    try {
      var a = JSON.parse(window.localStorage.getItem(MY_KEY) || "[]");
      return Array.isArray(a) ? a.filter(function (x) { return x && x.course && x.course.segs; }) : [];
    } catch (e) { return []; }
  }
  function saveMy(list) {
    try { window.localStorage.setItem(MY_KEY, JSON.stringify(list.slice(0, MY_MAX))); return true; } catch (e) { return false; }
  }
  function segArr(s) {
    var a = s.t === "S" ? ["S", s.len] : ["C", s.ang, s.r];
    if (s.g !== null && s.g !== undefined || s.sf) a.push(s.g === undefined ? null : s.g);
    if (s.sf) a.push(s.sf);
    return a;
  }
  // 代碼：「DV1.」＋ base64（UTF-8 JSON），路段用資料檔同樣的陣列格式比較短
  function encodeCourse(name, course) {
    var c = Core.cleanCourse(course);
    var json = JSON.stringify({ n: name, w: c.w, g: c.g, sc: c.scene, wa: c.water, rg: c.region || undefined, s: c.segs.map(segArr) });
    return "DV1." + window.btoa(unescape(encodeURIComponent(json)));
  }
  function decodeCourse(code) {
    try {
      var m = String(code || "").replace(/\s+/g, "");
      if (m.indexOf("DV1.") !== 0) return null;
      var o = JSON.parse(decodeURIComponent(escape(window.atob(m.slice(4)))));
      if (!o || !Array.isArray(o.s) || !o.s.length) return null;
      var c = Core.cleanCourse({ src: "my", w: o.w, g: o.g, scene: o.sc, water: o.wa, region: o.rg, segs: o.s.map(Core.parseSeg) });
      return { name: String(o.n || "").slice(0, 30) || t("dv_course_custom"), course: c };
    } catch (e) { return null; }
  }
  function storeCourse() {
    var c = Core.cleanCourse(setup.course);
    c.src = "my";
    return c;
  }
  function renderMyCourses() {
    var list = loadMy();
    var box = el("div", {}, [el("p", { class: "dv-muted" }, [t("dv_my_desc", { n: list.length, max: MY_MAX })])]);
    if (ui.myName === undefined) ui.myName = "";
    box.appendChild(el("div", { class: "dv-actions" }, [
      el("input", { type: "text", maxlength: "30", class: "dv-name", value: ui.myName, placeholder: courseName(), oninput: function (e) { ui.myName = e.target.value; } }, []),
      btn("💾 " + t("dv_my_save"), function () {
        var l = loadMy();
        if (l.length >= MY_MAX) return;
        l.unshift({ id: "m" + Date.now().toString(36) + Math.floor(Math.random() * 1e4), name: (ui.myName || courseName()).slice(0, 30), at: Date.now(), course: storeCourse() });
        ui.myMsg = saveMy(l) ? t("dv_my_saved") : t("dv_my_fail");
        ui.myName = ""; render();
      }, "dv-primary", list.length >= MY_MAX || buildPending())
    ]));
    if (ui.myMsg) box.appendChild(el("p", { class: "dv-good dv-small" }, [ui.myMsg]));
    ui.myMsg = "";
    var rows = el("div", { class: "dv-mylist" }, []);
    list.forEach(function (it, k) {
      var len = Core.courseLen(Core.cleanCourse(it.course));
      var on = setup.course.src === "my" && setup.course.myId === it.id && !setup.build;
      rows.appendChild(el("div", { class: "dv-myrow" + (on ? " dv-on" : "") }, [
        el("b", {}, [it.name]),
        el("span", { class: "dv-small dv-muted" }, [(len / 1000).toFixed(2) + " km · " + it.course.segs.length + " " + t("dv_my_segs") + " · " + new Date(it.at).toLocaleDateString()]),
        el("div", { class: "dv-actions" }, [
          btn(t("dv_my_load"), function () {
            setup.course = JSON.parse(JSON.stringify(it.course)); setup.course.src = "my"; setup.course.name = it.name; setup.course.myId = it.id;
            setup.build = null; save(); render();
          }, on ? "dv-on" : ""),
          btn(t("dv_my_overwrite"), function () {
            var l = loadMy(); l[k] = { id: it.id, name: it.name, at: Date.now(), course: storeCourse() };
            ui.myMsg = saveMy(l) ? t("dv_my_saved") : t("dv_my_fail"); render();
          }, "", buildPending()),
          btn(t("dv_my_export"), function () { ui.myCode = encodeCourse(it.name, it.course); render(); }),
          btn("✕", function () { var l = loadMy(); l.splice(k, 1); saveMy(l); render(); }, "dv-x")
        ])
      ]));
    });
    if (!list.length) rows.appendChild(el("p", { class: "dv-muted" }, [t("dv_my_empty")]));
    box.appendChild(rows);
    // 匯出／匯入
    var ta = el("textarea", { class: "dv-code", rows: "3", placeholder: t("dv_my_code_ph") }, []);
    ta.value = ui.myCode || "";
    box.appendChild(el("h4", { class: "dv-pgroup" }, [t("dv_my_share")]));
    box.appendChild(ta);
    box.appendChild(el("div", { class: "dv-actions" }, [
      btn(t("dv_my_export_cur"), function () { ui.myCode = encodeCourse(courseName(), setup.course); render(); }, "", buildPending()),
      btn(t("dv_my_copy"), function () {
        ta.select();
        try { if (navigator.clipboard) navigator.clipboard.writeText(ta.value); else document.execCommand("copy"); } catch (e) { /* 沒有剪貼簿權限：使用者自己複製 */ }
      }, "", !ta.value),
      btn(t("dv_my_import"), function () {
        var got = decodeCourse(ta.value);
        if (!got) { ui.myMsg = ""; ui.myErr = true; render(); return; }
        var l = loadMy(), entry = { id: "m" + Date.now().toString(36), name: got.name, at: Date.now(), course: got.course };
        var kept = l.length < MY_MAX;
        if (kept) { l.unshift(entry); saveMy(l); }
        setup.course = JSON.parse(JSON.stringify(got.course)); setup.course.name = got.name; setup.course.myId = kept ? entry.id : null;
        setup.build = null; ui.myCode = ""; ui.myMsg = t("dv_my_imported"); save(); render();
      }, "dv-primary")
    ]));
    if (ui.myErr) { box.appendChild(el("p", { class: "dv-bad dv-small" }, [t("dv_my_bad_code")])); ui.myErr = false; }
    return box;
  }

  function buildTotal(b) { return b.rounds * setup.players.length * (b.per || 1); }
  function buildPending() { return !!setup.build && setup.build.pieces.length < buildTotal(setup.build); }

  // 輪流建造：每回合一位玩家放 per 塊，rounds 輪；可以放預設零件或自訂路段
  function renderBuilder() {
    var b = setup.build;
    var box = el("div", { class: "dv-builder" }, []);
    if (!b) {
      var rounds = ui.buildRounds || 3, per = ui.buildPer || 1;
      box.appendChild(el("p", { class: "dv-muted" }, [t("dv_build_desc")]));
      box.appendChild(el("div", { class: "dv-actions" }, [
        el("span", {}, [t("dv_build_rounds")]),
        el("select", { onchange: function (e) { ui.buildRounds = Number(e.target.value); } },
          [2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map(function (k) { return el("option", { value: String(k), selected: k === rounds }, [String(k)]); })),
        el("span", {}, [t("dv_build_per")]),
        choice(["1", "2", "3", "4", "5"], String(per), function (id) { return id; }, function (id) { ui.buildPer = Number(id); render(); }),
        btn(t("dv_build_start"), function () {
          setup.build = { rounds: ui.buildRounds || 3, per: ui.buildPer || 1, pieces: [] };
          setup.course = { src: "custom", w: setup.course.w || 6.5, g: 7, scene: "mountain", water: 0, segs: [{ t: "S", len: 120, g: null }] };
          save(); render();
        }, "dv-primary")
      ]));
      return box;
    }
    var n = setup.players.length, per = b.per || 1, total = buildTotal(b), idx = b.pieces.length;
    function place(segs, who) {
      // 路段數到上限：這一塊記成空的（輪流照樣進行），提示玩家
      if (setup.course.segs.length + segs.length > Core.MAX_SEGS) { b.pieces.push({ o: who, n: 0 }); ui.segCap = true; return; }

      var before = Core.findCombos(setup.course, b.pieces).length;
      segs.forEach(function (sg) { sg.o = who; });
      setup.course.segs = setup.course.segs.concat(segs);
      b.pieces.push({ o: who, n: segs.length });
      var after = Core.findCombos(setup.course, b.pieces);
      ui.comboNew = after.length > before ? after[after.length - 1] : null;
    }
    if (idx < total) {
      var turn = Math.floor(idx / per), who = turn % n;
      var gradeVal = ui.grade === "" ? null : Number(ui.grade);
      box.appendChild(el("p", { class: "dv-turn" }, [
        el("i", { class: "dv-dot", style: "background:" + setup.players[who].color }, []),
        t("dv_build_turn", { name: playerName(who), k: Math.floor(turn / n) + 1, r: b.rounds, i: idx + 1, n: total }),
        per > 1 ? el("span", { class: "dv-muted" }, [" " + t("dv_build_left", { n: per - idx % per })]) : null
      ]));
      box.appendChild(el("div", { class: "dv-actions" }, [
        choice(["1", "-1"], String(ui.side), function (id) { return t(id === "1" ? "dv_left" : "dv_right"); }, function (id) { ui.side = Number(id); render(); }),
        choice([""].concat(D.GRADES.map(String)), ui.grade, function (id) { return id === "" ? t("dv_grade_default") : t("dv_grade_n", { n: id }); }, function (id) { ui.grade = id; render(); })
      ]));
      PIECE_GROUPS.forEach(function (gp) {
        box.appendChild(el("h4", { class: "dv-pgroup" }, [t("dv_pgroup_" + gp.id)]));
        box.appendChild(el("div", { class: "dv-pieces" }, gp.ids.map(function (id) {
          return el("button", {
            type: "button", class: "dv-piece", title: t("dv_ptip_" + id),
            onclick: function () { place(Core.expandPiece(id, ui.side, gradeVal), who); save(); render(); }
          }, [pieceIcon(id, ui.side), el("span", {}, [t("dv_piece_" + id)])]);
        })));
      });
      // 自訂路段：任意長度／角度／半徑
      var cp = ui.cp || (ui.cp = { t: "C", len: 120, ang: 90, r: 40 });
      function slider(key, min, max, step, label) {
        return el("label", { class: "dv-range" }, [label, el("input", {
          type: "range", min: String(min), max: String(max), step: String(step), value: String(cp[key]),
          oninput: function (e) { cp[key] = Number(e.target.value); e.target.nextSibling.textContent = String(cp[key]); }
        }, []), el("b", {}, [String(cp[key])])]);
      }
      box.appendChild(el("details", { class: "dv-custom-piece", open: ui.cpOpen ? true : null, ontoggle: function (e) { ui.cpOpen = e.target.open; } }, [
        el("summary", {}, [t("dv_custom_piece")]),
        choice(["S", "C"], cp.t, function (id) { return t(id === "S" ? "dv_seg_s" : "dv_seg_c"); }, function (id) { cp.t = id; render(); }),
        cp.t === "S" ? slider("len", 10, 600, 10, t("dv_seg_len")) : el("div", {}, [
          slider("ang", 5, 360, 5, t("dv_cp_ang")), slider("r", 10, 300, 1, t("dv_seg_r"))]),
        el("div", { class: "dv-actions" }, [btn(t("dv_cp_place"), function () {
          var sg = cp.t === "S" ? { t: "S", len: cp.len, g: gradeVal } : { t: "C", ang: cp.ang * ui.side, r: cp.r, g: gradeVal };
          place([sg], who); save(); render();
        }, "dv-primary")])
      ]));
    } else {
      box.appendChild(el("p", { class: "dv-good" }, [t("dv_build_done")]));
    }
    if (ui.segCap) box.appendChild(el("p", { class: "dv-bad dv-small" }, [t("dv_seg_cap", { n: Core.MAX_SEGS })]));

    box.appendChild(renderCombos(Core.findCombos(setup.course, b.pieces)));
    box.appendChild(el("div", { class: "dv-actions" }, [
      btn(t("dv_undo"), function () {
        ui.comboNew = null;
        var last = b.pieces.pop();
        if (last) setup.course.segs.splice(setup.course.segs.length - last.n, last.n);
        save(); render();
      }, "", !b.pieces.length),
      idx < total ? btn(t("dv_build_fill"), function () {
        // 剩下的全部隨機（照樣記在輪到的玩家名下）
        var r = Core.rng(newSeed());
        var ids = D.PIECES.map(function (p) { return p.id; }).filter(function (id) { return id !== "spiral"; });
        for (var j = idx; j < total; j++) place(Core.expandPiece(ids[Math.floor(r() * ids.length)], r() < 0.5 ? 1 : -1, null), Math.floor(j / per) % n);
        save(); render();
      }) : null,
      btn(t("dv_build_restart"), function () { setup.build = null; ui.segCap = false; save(); render(); }, "dv-link")
    ]));
    return box;
  }

  // 組合技清單（剛成立的那個會閃一下）
  function renderCombos(list) {
    var box = el("div", { class: "dv-combos" }, [el("b", {}, [t("dv_combos", { n: list.length })])]);
    if (!list.length) box.appendChild(el("span", { class: "dv-muted" }, [" " + t("dv_combos_none")]));
    list.forEach(function (cb) {
      var fresh = ui.comboNew && ui.comboNew.id === cb.id && ui.comboNew.at === cb.at;
      box.appendChild(el("span", { class: "dv-combo" + (fresh ? " dv-combo-new" : ""), title: t("dv_combo_tip_" + cb.id) },
        cb.by.map(function (o) { return setup.players[o] ? el("i", { class: "dv-dot", style: "background:" + setup.players[o].color }, []) : null; })
          .concat([t("dv_combo_" + cb.id)])));
    });
    return box;
  }

  // 零件的小圖示（SVG 折線）
  function pieceIcon(id, side) {
    var segs = Core.expandPiece(id, side, null);
    var x = 0, y = 0, h = -Math.PI / 2, pts = [[0, 0]];
    segs.forEach(function (s) {
      var len = Core.segLen(s), n = 12, k = s.t === "C" ? (s.ang * Math.PI / 180) / len : 0;
      for (var i = 0; i < n; i++) { var d = len / n; h -= k * d; x += Math.cos(h) * d; y += Math.sin(h) * d; pts.push([x, y]); }
    });
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(function (p) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
    var sc = 28 / Math.max(10, maxX - minX, maxY - minY);
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + (18 + (p[0] - (minX + maxX) / 2) * sc).toFixed(1) + " " + (18 + (p[1] - (minY + maxY) / 2) * sc).toFixed(1); }).join(" ");
    var svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgNode.setAttribute("viewBox", "0 0 36 36"); svgNode.setAttribute("class", "dv-picon");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d); path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "3"); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round");
    svgNode.appendChild(path);
    var sf = segs[0] && segs[0].sf;
    if (sf) {
      path.setAttribute("stroke", SF_COLOR[D.SURFACES[sf].code]);
      if (sf === "tunnel") path.setAttribute("stroke-dasharray", "4 3");
    }
    if (segs.some(function (sg) { return sg.g !== null && (sg.g >= 12 || sg.g < 0); })) svgNode.setAttribute("class", "dv-picon dv-picon-slope");
    return svgNode;
  }

  // 路段微調清單
  function renderSegEditor() {
    var segs = setup.course.segs;
    var det = el("details", { class: "dv-panel dv-segs", open: ui.segOpen ? true : null, ontoggle: function (e) { ui.segOpen = e.target.open; } }, [
      el("summary", {}, [t("dv_segs_title", { n: segs.length })])
    ]);
    var locked = buildPending();
    if (locked) det.appendChild(el("p", { class: "dv-muted" }, [t("dv_segs_locked")]));
    var tbl = el("div", { class: "dv-seglist" }, []);
    function num(val, min, max, step, onset, ph) {
      return el("input", {
        type: "number", min: String(min), max: String(max), step: String(step), value: val === null || val === undefined ? "" : String(val), placeholder: ph || "",
        disabled: locked, onchange: function (e) { onset(e.target.value); touchCourse(); }
      }, []);
    }
    segs.forEach(function (s, i) {
      var owner = s.o !== undefined && setup.players[s.o] ? setup.players[s.o].color : "transparent";
      var row = el("div", { class: "dv-seg" }, [
        el("i", { class: "dv-dot", style: "background:" + owner }, []),
        el("span", { class: "dv-seg-i" }, [String(i + 1)]),
        el("select", {
          disabled: locked, onchange: function (e) {
            var nt = e.target.value;
            segs[i] = nt === "S" ? { t: "S", len: 100, g: s.g, o: s.o } : { t: "C", ang: 60, r: 50, g: s.g, o: s.o };
            touchCourse();
          }
        }, [el("option", { value: "S", selected: s.t === "S" }, [t("dv_seg_s")]), el("option", { value: "C", selected: s.t === "C" }, [t("dv_seg_c")])])
      ]);
      if (s.t === "S") row.appendChild(el("label", {}, [t("dv_seg_len"), num(s.len, 10, 1000, 10, function (v) { s.len = Number(v) || 10; })]));
      else {
        row.appendChild(el("label", {}, [t("dv_seg_ang"), num(s.ang, -180, 180, 5, function (v) { s.ang = Number(v) || 30; })]));
        row.appendChild(el("label", {}, [t("dv_seg_r"), num(s.r, 10, 400, 1, function (v) { s.r = Number(v) || 10; })]));
      }
      row.appendChild(el("label", {}, [t("dv_seg_g"), num(s.g, -15, 15, 1, function (v) { s.g = v === "" ? null : Number(v); }, t("dv_grade_default"))]));
      row.appendChild(el("select", {
        disabled: locked, title: t("dv_seg_sf"), onchange: function (e) { if (e.target.value) s.sf = e.target.value; else delete s.sf; touchCourse(); }
      }, [""].concat(D.SURFACE_IDS).map(function (id) { return el("option", { value: id, selected: (s.sf || "") === id }, [t("dv_sf_" + (id || "none"))]); })));
      row.appendChild(btn("⇄", function () { if (s.t === "C") { s.ang = -s.ang; touchCourse(); } }, "dv-x", locked || s.t !== "C"));
      row.appendChild(btn("✕", function () { segs.splice(i, 1); touchCourse(); }, "dv-x", locked));
      tbl.appendChild(row);
    });
    det.appendChild(tbl);
    det.appendChild(el("div", { class: "dv-actions" }, [
      btn(t("dv_add_s"), function () { segs.push({ t: "S", len: 100, g: null }); touchCourse(); }, "", locked),
      btn(t("dv_add_c"), function () { segs.push({ t: "C", ang: 60, r: 50, g: null }); touchCourse(); }, "", locked)
    ]));
    return det;
  }

  // ---------------- 3. 車庫 ----------------
  function statBar(label, val, ratio, cls) {
    return el("div", { class: "dv-stat" }, [
      el("span", {}, [label]),
      el("div", { class: "dv-bar" }, [el("i", { class: cls || "", style: "width:" + Math.round(clamp(ratio, 0.02, 1) * 100) + "%" }, [])]),
      el("b", {}, [val])
    ]);
  }

  // ---- 調校存檔（整套 spec，任何玩家都能讀） ----
  function loadTunes() {
    try { var a = JSON.parse(window.localStorage.getItem(TUNE_KEY) || "[]"); return Array.isArray(a) ? a.filter(function (x) { return x && x.spec; }) : []; } catch (e) { return []; }
  }
  function saveTunes(list) { try { window.localStorage.setItem(TUNE_KEY, JSON.stringify(list.slice(0, TUNE_MAX))); } catch (e) { /* 存不了就算了 */ } }
  function carLabel(spec) {
    if (spec.car === "custom") return t("dv_custom_car");
    var c = D.car(spec.car);
    return c ? brandName(c.brand) + " " + c.name : spec.car;
  }

  // 車款搜尋：名稱／廠牌關鍵字＋車種＋驅動篩選，結果最多 CAR_LIST_MAX 台（只更新清單，不重畫整個畫面，輸入框才不會失焦）
  function carMatches() {
    var q = (ui.carQ || "").trim().toLowerCase(), cls = ui.carCls || "", drv = ui.carDrv || "";
    if (!q && !cls && !drv) return null;
    return D.CARS.filter(function (c) {
      if (cls && c.cls !== cls) return false;
      if (drv && c.drive !== drv) return false;
      return !q || (brandName(c.brand) + " " + c.name + " " + c.id).toLowerCase().indexOf(q) >= 0;
    });
  }
  function fillCarList(box, pick) {
    box.innerHTML = "";
    var list = carMatches();
    if (!list) return;
    box.appendChild(el("div", { class: "dv-small dv-muted" }, [t("dv_car_found", { n: list.length })]));
    list.slice(0, CAR_LIST_MAX).forEach(function (c) {
      var st = Core.carStats({ car: c.id });
      box.appendChild(el("button", { type: "button", class: "dv-carpick", onclick: function () { pick(c.id); } }, [
        el("b", {}, [brandName(c.brand) + " " + c.name]),
        el("span", { class: "dv-small dv-muted" }, [c.drive + (c.ev ? " · EV" : "") + " · " + c.kw + " kW · " + c.kg + " kg · PI " + st.pi])
      ]));
    });
    if (list.length > CAR_LIST_MAX) box.appendChild(el("div", { class: "dv-small dv-muted" }, [t("dv_car_more", { n: list.length - CAR_LIST_MAX })]));
  }

  function renderGarage() {
    ensureCpu();
    var n = setup.players.length, pts = setup.upPts;
    ui.tab = clamp(ui.tab, 0, n - 1);
    app.appendChild(el("div", { class: "dv-tabs" }, setup.players.map(function (p, i) {
      var st = Core.carStats(setup.cars[i], pts);
      var over = setup.piCap && st.pi > setup.piCap;
      return el("button", { type: "button", class: "dv-tab" + (i === ui.tab ? " dv-on" : "") + (over ? " dv-bad" : ""), style: "border-color:" + p.color, onclick: function () { ui.tab = i; render(); } },
        [el("i", { class: "dv-dot", style: "background:" + p.color }, []), playerName(i)]);
    })));

    var i = ui.tab, spec = setup.cars[i];
    var st = Core.carStats(spec, pts);
    function commit() { var cu = spec.custom; setup.cars[i] = Core.cleanSpec(spec, pts); setup.cars[i].custom = setup.cars[i].custom || cu || defaultSpec("custom").custom; save(); render(); }
    function upd(fn) { return function (e) { fn(e && e.target ? e.target.value : e); commit(); }; }
    var brand = spec.car === "custom" ? "custom" : D.car(spec.car).brand;

    var left = el("div", { class: "dv-panel" }, [el("h3", {}, [t("dv_car")])]);
    left.appendChild(el("div", { class: "dv-actions" }, [
      el("select", {
        class: "dv-brand", onchange: upd(function (v) {
          spec.car = v === "custom" ? "custom" : D.CARS.filter(function (c) { return c.brand === v; })[0].id;
        })
      }, D.BRANDS.map(function (b) {
        var cnt = D.CARS.filter(function (c) { return c.brand === b.id; }).length;
        return el("option", { value: b.id, selected: b.id === brand }, [b.id === "custom" ? t("dv_custom_car") : b.name + " (" + cnt + ")"]);
      })),
      brand !== "custom" ? el("select", { class: "dv-model", onchange: upd(function (v) { spec.car = v; }) },
        D.CARS.filter(function (c) { return c.brand === brand; }).map(function (c) { return el("option", { value: c.id, selected: c.id === spec.car }, [c.name + " · " + c.drive + " · PI " + Core.carStats({ car: c.id }).pi]); })) : null,
      btn("🎲", function () {
        var pool = carMatches() || D.CARS;
        if (setup.piCap) pool = pool.filter(function (c) { return Core.carStats({ car: c.id }).pi <= setup.piCap; });
        if (!pool.length) pool = D.CARS;
        spec.car = pool[Math.floor(Math.random() * pool.length)].id; commit();
      }, "dv-step")
    ]));
    // 搜尋＋篩選
    var found = el("div", { class: "dv-carlist" }, []);
    function pickCar(id) { spec.car = id; commit(); }
    left.appendChild(el("div", { class: "dv-actions" }, [
      el("input", {
        type: "search", class: "dv-search", value: ui.carQ || "", placeholder: t("dv_car_search", { n: D.CARS.length }),
        oninput: function (e) { ui.carQ = e.target.value; fillCarList(found, pickCar); }
      }, []),
      el("select", { onchange: function (e) { ui.carCls = e.target.value; fillCarList(found, pickCar); } },
        [""].concat(D.CAR_CLASSES || []).map(function (id) { return el("option", { value: id, selected: (ui.carCls || "") === id }, [id ? t("dv_cls_" + id) : t("dv_cls_all")]); })),
      el("select", { onchange: function (e) { ui.carDrv = e.target.value; fillCarList(found, pickCar); } },
        [""].concat(D.DRIVES).map(function (id) { return el("option", { value: id, selected: (ui.carDrv || "") === id }, [id || t("dv_drv_all")]); }))
    ]));
    fillCarList(found, pickCar);
    left.appendChild(found);

    if (spec.car === "custom") {
      var cu = spec.custom;
      left.appendChild(el("div", { class: "dv-actions" }, [el("span", {}, [t("dv_drive")]),
        choice(D.DRIVES, cu.drive, function (id) { return id; }, upd(function (v) { cu.drive = v; }))]));
      Object.keys(D.CUSTOM.range).forEach(function (k) {
        var rg = D.CUSTOM.range[k];
        var val = cu[k] === undefined ? D.CUSTOM.base[k] : cu[k];
        left.appendChild(el("label", { class: "dv-range" }, [t("dv_cu_" + k), el("input", {
          type: "range", min: String(rg[0]), max: String(rg[1]), step: String(rg[2]), value: String(val),
          oninput: function (e) { e.target.nextSibling.textContent = e.target.value; },
          onchange: upd(function (v) { cu[k] = Number(v); })
        }, []), el("b", {}, [String(val)])]));
      });
    }
    left.appendChild(el("h3", {}, [t("dv_tire")]));
    left.appendChild(choice(D.TIRE_IDS, spec.tire, function (id) { return L(D.TIRES[id].name); }, upd(function (v) { spec.tire = v; })));
    left.appendChild(el("p", { class: "dv-muted dv-small" }, [t("dv_tire_hint_" + setup.season)]));
    left.appendChild(el("label", { class: "dv-range" }, [t("dv_aero"), el("input", {
      type: "range", min: "0", max: "5", step: "1", value: String(spec.aero), onchange: upd(function (v) { spec.aero = Number(v); })
    }, []), el("b", {}, [String(spec.aero)])]));
    left.appendChild(el("p", { class: "dv-muted dv-small" }, [t("dv_aero_hint")]));
    left.appendChild(el("label", { class: "dv-range" }, [t("dv_gear"), el("input", {
      type: "range", min: "-2", max: "2", step: "1", value: String(spec.gear), onchange: upd(function (v) { spec.gear = Number(v); })
    }, []), el("b", {}, [t(spec.gear < 0 ? "dv_gear_short" : spec.gear > 0 ? "dv_gear_long" : "dv_gear_std")])]));
    left.appendChild(el("h3", {}, [t("dv_style")]));
    left.appendChild(choice(D.STYLE_IDS, spec.style, function (id) { return L(D.STYLES[id].name); }, upd(function (v) { spec.style = v; })));
    left.appendChild(el("p", { class: "dv-muted dv-small" }, [t("dv_style_" + spec.style)]));
    if (spec.car !== "custom") {
      var used = D.UPGRADES.reduce(function (a, u) { return a + (spec.up[u] || 0); }, 0);
      left.appendChild(el("h3", {}, [t("dv_upgrades", { n: pts - used })]));
      D.UPGRADES.forEach(function (u) {
        var v = spec.up[u] || 0;
        left.appendChild(el("div", { class: "dv-up" }, [
          el("span", {}, [t("dv_up_" + u)]),
          btn("−", upd(function () { spec.up[u] = Math.max(0, v - 1); }), "dv-step", v <= 0),
          el("span", { class: "dv-pips" }, [new Array(D.UPGRADE_MAX + 1).join("●").slice(0, v) + new Array(D.UPGRADE_MAX + 1).join("○").slice(0, D.UPGRADE_MAX - v)]),
          btn("+", upd(function () { spec.up[u] = v + 1; }), "dv-step", v >= D.UPGRADE_MAX || used >= pts)
        ]));
      });
    }
    // 細部調校（第六批）：全部 0＝原廠
    var tune = el("details", { class: "dv-tune", open: ui.tuneOpen ? true : null, ontoggle: function (e) { ui.tuneOpen = e.target.open; } }, [
      el("summary", {}, [t("dv_tune_title")]),
      el("p", { class: "dv-muted dv-small" }, [t("dv_tune_desc")])
    ]);
    if (spec.car !== "custom") {
      var stock = D.car(spec.car).drive;
      tune.appendChild(el("div", { class: "dv-actions" }, [el("span", {}, [t("dv_drv_swap")]),
        choice([""].concat(D.DRIVES.filter(function (d) { return d !== stock; })), spec.drv || "", function (id) { return id || t("dv_drv_stock", { d: stock }); },
          upd(function (v) { spec.drv = v; }))]));
    }
    Object.keys(D.TUNES).forEach(function (k) {
      var rg = D.TUNES[k], v = spec[k] || 0;
      tune.appendChild(el("label", { class: "dv-range" }, [t("dv_tune_" + k), el("input", {
        type: "range", min: String(rg[0]), max: String(rg[1]), step: String(rg[2]), value: String(v),
        oninput: function (e) { e.target.nextSibling.textContent = tuneLabel(k, Number(e.target.value)); },
        onchange: upd(function (x) { spec[k] = Number(x); })
      }, []), el("b", {}, [tuneLabel(k, v)])]));
      tune.appendChild(el("p", { class: "dv-muted dv-small dv-tune-hint" }, [t("dv_tuneh_" + k)]));
    });
    tune.appendChild(el("div", { class: "dv-actions" }, [btn(t("dv_tune_reset"), function () {
      Object.keys(D.TUNES).forEach(function (k) { spec[k] = 0; }); spec.drv = ""; commit();
    }, "dv-link")]));
    left.appendChild(tune);
    // 調校存檔
    var tunes = loadTunes();
    var preset = el("details", { class: "dv-tune", open: ui.presetOpen ? true : null, ontoggle: function (e) { ui.presetOpen = e.target.open; } }, [
      el("summary", {}, [t("dv_preset_title", { n: tunes.length, max: TUNE_MAX })])
    ]);
    preset.appendChild(el("div", { class: "dv-actions" }, [
      el("input", { type: "text", maxlength: "24", class: "dv-name", value: ui.presetName || "", placeholder: carLabel(spec), oninput: function (e) { ui.presetName = e.target.value; } }, []),
      btn("💾 " + t("dv_preset_save"), function () {
        var l = loadTunes();
        l.unshift({ name: (ui.presetName || carLabel(spec)).slice(0, 24), spec: JSON.parse(JSON.stringify(spec)) });
        saveTunes(l); ui.presetName = ""; render();
      }, "", tunes.length >= TUNE_MAX)
    ]));
    tunes.forEach(function (p, k) {
      var ps = Core.carStats(p.spec, pts);
      preset.appendChild(el("div", { class: "dv-myrow" }, [
        el("b", {}, [p.name]),
        el("span", { class: "dv-small dv-muted" }, [carLabel(p.spec) + " · PI " + ps.pi]),
        el("div", { class: "dv-actions" }, [
          btn(t("dv_preset_load"), function () { var cu = spec.custom; spec = JSON.parse(JSON.stringify(p.spec)); if (!spec.custom) spec.custom = cu; setup.cars[i] = spec; commit(); }),
          btn("✕", function () { var l = loadTunes(); l.splice(k, 1); saveTunes(l); render(); }, "dv-x")
        ])
      ]));
    });
    left.appendChild(preset);

    var tire = D.TIRES[spec.tire];
    var gripNow = st.grip * st.load * tire[setup.season] * D.SEASONS[setup.season].mu;
    var over = setup.piCap && st.pi > setup.piCap;
    var right = el("div", { class: "dv-panel dv-carcard" }, [
      el("div", { class: "dv-carhead" }, [el("i", { class: "dv-carswatch", style: "background:" + setup.players[i].color }, []),
        el("div", {}, [el("b", {}, [spec.car === "custom" ? t("dv_custom_car") : (brandName(st.brand) + " " + st.name)]),
          el("div", { class: "dv-small dv-muted" }, [st.drive + (st.swap ? " ← " + st.swap : "") + (st.ev ? " · EV" : "") +
            (spec.car !== "custom" && D.car(spec.car).cls ? " · " + t("dv_cls_" + D.car(spec.car).cls) : "")])])]),
      statBar(t("dv_st_power"), Math.round(st.kw) + " kW / " + Math.round(st.kw * 1.36) + " PS", st.kw / 800),
      statBar(t("dv_st_weight"), Math.round(st.m) + " kg", st.m / 2500),
      statBar(t("dv_st_pw"), (st.m / st.kw).toFixed(1) + " kg/kW", st.pw / 0.35),
      statBar(t("dv_st_grip"), gripNow.toFixed(2), (gripNow - 0.4) / 0.8),
      statBar(t("dv_st_brake"), st.brk.toFixed(2), (st.brk - 0.75) / 0.5),
      statBar(t("dv_st_handling"), st.hdl.toFixed(2), (st.hdl - 0.8) / 0.5),
      statBar(t("dv_st_top"), Math.round(st.vtop * 3.6) + " km/h", st.vtop * 3.6 / 420),
      statBar("PI", String(st.pi) + (setup.piCap ? " / " + setup.piCap : ""), st.pi / 1000, over ? "dv-over" : ""),
      over ? el("p", { class: "dv-bad" }, [t("dv_pi_over", { cap: setup.piCap })]) : null,
      over ? el("p", { class: "dv-muted dv-small" }, [t("dv_pi_over_hint")]) : null
    ]);
    app.appendChild(el("div", { class: "dv-garage" }, [left, right]));

    if (setup.cpuCars.length) {
      app.appendChild(el("div", { class: "dv-panel" }, [
        el("h3", {}, [t("dv_cpu_cars")]),
        el("ul", { class: "dv-cpulist" }, setup.cpuCars.map(function (c, k) {
          var cs = Core.carStats(c.spec, pts);
          return el("li", {}, [el("i", { class: "dv-dot", style: "background:" + c.color }, []), "CPU " + (k + 1) + " · " + brandName(cs.brand) + " " + cs.name +
            " · " + L(D.STYLES[c.spec.style].name) + " · PI " + cs.pi]);
        })),
        btn(t("dv_cpu_reroll"), function () { setup.seed = newSeed(); setup.cpuCars = null; save(); render(); }, "dv-link")
      ]));
    }
    var anyOver = setup.piCap && setup.cars.some(function (c) { return Core.carStats(c, pts).pi > setup.piCap; });
    app.appendChild(el("div", { class: "dv-actions dv-next" }, [
      btn(t("dv_back"), function () { go("course"); }),
      btn(t("dv_go"), function () { startRace(setup.seed); }, "dv-primary", anyOver)
    ]));
  }
  function tuneLabel(k, v) {
    if (k === "susp") return v === 0 ? t("dv_tune_std") : (v < 0 ? t("dv_tune_soft") : t("dv_tune_hard")) + " " + Math.abs(v);
    if (k === "rst") return v ? "−" + v + "%" : t("dv_tune_off");
    if (k === "blst") return v ? "+" + v + " kg" : t("dv_tune_off");
    return v ? String(v) : t("dv_tune_off");
  }
  function brandName(id) { for (var i = 0; i < D.BRANDS.length; i++) if (D.BRANDS[i].id === id) return D.BRANDS[i].id === "custom" ? "" : D.BRANDS[i].name; return ""; }

  // ---------------- 4. 比賽 ----------------
  // cmds：Déjà vu 重播時帶入上一場的戰略指令紀錄
  function startRace(seed, cmds) {
    ui.race = Core.createRace({ course: setup.course, season: setup.season, dir: setup.dir, mode: setup.mode, rule: setup.rule, seed: seed, cars: raceCars(), cmds: cmds || [], upPts: setup.upPts });
    scenery(ui.race.track);   // 轉播機位要先知道街景（城市的大樓）
    ui.raceSeed = seed;
    ui.follow = 0; ui.autoFollow = setup.players.length > 1; ui.paused = false;
    ui.countdown = 3.2; ui.acc = 0; ui.result = null; ui.cam = null; ui.smoke = []; ui.weather = []; ui.seenEv = 0; ui.ticker = [];
    ui.rec = { t: [], a: [] }; ui.rp = null; ui.rpCool = 0; ui.finHold = null; ui.final = null; ui.flash = null;
    ui.tvD = {}; ui.tvRp = null; ui.tvPend = null; ui.hlSel = null;
    if (ui.replayOn === undefined) ui.replayOn = true;
    go("race");
  }

  var R = {}; // 比賽畫面的 DOM 參照

  function renderRace() {
    var race = ui.race;
    if (!race) return go("garage");
    app.innerHTML = "";
    app.appendChild(stepNav());
    R.main = el("canvas", { class: "dv-chase", onclick: function () { if (ui.final) finishRace(); else if (ui.tvRp) { ui.tvRp = null; ui.rpCool = performance.now() + 4000; } } }, []);
    R.map = el("canvas", { class: "dv-minimap" }, []);
    R.elev = el("canvas", { class: "dv-elev" }, []);
    R.board = el("ol", { class: "dv-board" }, []);
    R.ticker = el("ul", { class: "dv-ticker" }, []);
    R.ctrl = el("div", { class: "dv-ctrl" }, []);
    R.tac = el("div", { class: "dv-tactics" }, []);
    R.tacSig = "";
    app.appendChild(el("div", { class: "dv-race" }, [
      el("div", { class: "dv-race-main" }, [R.main, R.ctrl, R.tac, R.elev]),
      el("div", { class: "dv-race-side" }, [R.board, R.map, R.ticker])
    ]));
    renderCtrl();
    renderBoard();
    renderTactics();
    startLoop();
  }

  // 戰略面板：每位玩家的車一列，隨時切換全力／均衡／保守／防守（只在狀態改變時重畫，避免吃掉點擊）
  function humanCars() { return ui.race.cars.filter(function (c) { return !c.cpu; }); }
  function renderTactics() {
    var cars = humanCars();
    var sig = cars.map(function (c) { return c.styleId + c.state + (c.hand ? c.hand.join(",") : ""); }).join("|") + lang();
    if (sig === R.tacSig) return;
    R.tacSig = sig;
    R.tac.innerHTML = "";
    var wild = ui.race.wild;
    R.tac.appendChild(el("div", { class: "dv-small dv-muted" }, [t("dv_tactic_title") +
      (cars.length === 1 ? "　" + t("dv_tactic_keys") + (wild ? "　" + t("dv_hand_keys") : "") : "")]));
    cars.forEach(function (c) {
      R.tac.appendChild(el("div", { class: "dv-tac-row" }, [
        el("span", { class: "dv-tac-name" }, [el("i", { class: "dv-dot", style: "background:" + c.color }, []), c.name]),
        el("div", { class: "dv-choice" }, D.STYLE_IDS.map(function (id) {
          return btn(L(D.STYLES[id].name), function () { if (Core.command(ui.race, c.id, id)) renderTactics(); },
            (c.styleId === id ? "dv-on " : "") + "dv-tac-" + id, c.state !== "run" || ui.race.done);
        })),
        wild ? el("div", { class: "dv-hand" }, c.hand.length ? c.hand.map(function (id, idx) {
          return el("button", {
            type: "button", class: "dv-hcard dv-hcard-" + id, title: t("dv_cardd_" + id), disabled: c.state !== "run" || ui.race.done,
            onclick: function () { if (Core.playCard(ui.race, c.id, idx)) renderTactics(); }
          }, [el("b", {}, [D.CARDS[id].icon]), t("dv_card_" + id)]);
        }) : [el("span", { class: "dv-muted dv-small" }, [t("dv_hand_empty")])]) : null
      ]));
    });
  }
  document.addEventListener("keydown", function (e) {
    if (ui.screen !== "race" || !ui.race || e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    var cars = humanCars();
    var k = "1234".indexOf(e.key);
    var ci = "qwe".indexOf(String(e.key).toLowerCase());
    if (k >= 0 && cars.length === 1) { Core.command(ui.race, cars[0].id, D.STYLE_IDS[k]); renderTactics(); }
    else if (ci >= 0 && cars.length === 1 && ui.race.wild) { Core.playCard(ui.race, cars[0].id, ci); renderTactics(); }
    else if (e.key === "c" || e.key === "C") { ui.camMode = CAMS[(CAMS.indexOf(ui.camMode) + 1) % CAMS.length]; ui.cam = null; ui.tvRp = null; renderCtrl(); }
    else if (e.key === " ") { ui.paused = !ui.paused; renderCtrl(); e.preventDefault(); }
  });

  function renderCtrl() {
    R.ctrl.innerHTML = "";
    R.ctrl.appendChild(btn(ui.paused ? "▶" : "⏸", function () { ui.paused = !ui.paused; renderCtrl(); }, "dv-pause"));
    SPEEDS.forEach(function (s) { R.ctrl.appendChild(btn(s + "×", function () { ui.speed = s; renderCtrl(); }, ui.speed === s ? "dv-on" : "")); });
    R.ctrl.appendChild(el("span", { class: "dv-sep" }, []));
    CAMS.forEach(function (m) {
      if (m === "tv" && !Tv) return;
      R.ctrl.appendChild(btn(t("dv_cam_" + m), function () { ui.camMode = m; ui.cam = null; ui.tvRp = null; ui.rp = null; renderCtrl(); }, ui.camMode === m ? "dv-on" : ""));
    });
    if (ui.camMode === "tv") {
      // 轉播：自動導播或鎖定某個機位
      R.ctrl.appendChild(el("select", { class: "dv-tvlock", title: t("dv_tv_lock"), onchange: function (e) { ui.tvLock = e.target.value || null; ui.tvD = {}; } },
        [""].concat(Tv.KINDS).map(function (k) { return el("option", { value: k, selected: (ui.tvLock || "") === k }, [k ? t("dv_tvcam_" + k) : t("dv_tv_auto")]); })));
    }
    R.ctrl.appendChild(el("label", { class: "dv-small" }, [el("input", { type: "checkbox", checked: ui.autoFollow, onchange: function (e) { ui.autoFollow = e.target.checked; } }, []), t("dv_auto_follow")]));
    R.ctrl.appendChild(el("label", { class: "dv-small" }, [el("input", { type: "checkbox", checked: ui.replayOn, onchange: function (e) { ui.replayOn = e.target.checked; if (!ui.replayOn) ui.rp = null; } }, []), t("dv_replay_on")]));
    R.ctrl.appendChild(btn(t("dv_skip"), function () { skipToEnd(); finishRace(); }, "dv-link"));
  }

  function stateLabel(c) {
    if (c.state === "fin") return fmtTime(c.finT);
    if (c.state === "dnf") return t(c.dnf === "time" ? "dv_dnf_time" : "dv_dnf");
    if (c.stun > 0) return t("dv_spin");
    return Math.round(c.v * 3.6) + " km/h";
  }

  function renderBoard() {
    var race = ui.race;
    var ord = Core.order(race);
    var lead = ord[0];
    R.board.innerHTML = "";
    ord.forEach(function (c, p) {
      var gap = "";
      if (p > 0 && c.state === "run" && lead.state === "run") gap = "−" + Math.max(0, Math.round(lead.s - c.s)) + " m";
      else if (p > 0 && c.state === "fin" && lead.state === "fin") gap = "+" + (c.finT - lead.finT).toFixed(2);
      R.board.appendChild(el("li", { class: (c.id === ui.follow ? "dv-on " : "") + (c.state === "dnf" ? "dv-dnf" : ""), onclick: function () { ui.follow = c.id; ui.autoFollow = false; renderCtrl(); } }, [
        el("span", { class: "dv-pos" }, [String(p + 1)]),
        el("i", { class: "dv-dot", style: "background:" + c.color }, []),
        el("span", { class: "dv-bname" }, [c.name, el("small", {}, [c.st.name + " · " + L(D.STYLES[c.styleId].name)])]),
        el("span", { class: "dv-bstate" }, [stateLabel(c), gap ? el("small", {}, [gap]) : null])
      ]));
    });
  }

  function eventText(e) {
    var race = ui.race, c = race.cars[e.car];
    if (e.type === "spin") return t("dv_ev_spin", { name: c.name, v: e.v });
    if (e.type === "dnf") return t(e.why === "time" ? "dv_ev_dnf_time" : "dv_ev_dnf", { name: c.name });
    if (e.type === "pass" && e.move) return t("dv_ev_pass_move", { name: c.name, other: race.cars[e.other].name, move: t("dv_move_" + e.move) });
    if (e.type === "pass" && e.kind) return t("dv_tv_pass_" + e.kind, { name: c.name, other: race.cars[e.other].name });
    if (e.type === "pass_fail") return t("dv_ev_pass_fail", { name: c.name, other: race.cars[e.other].name });
    if (e.type === "contact") return t("dv_ev_contact", { name: c.name, other: race.cars[e.other].name });
    if (e.type === "pass") return t("dv_ev_pass", { name: c.name, other: race.cars[e.other].name });
    if (e.type === "card") return t("dv_ev_card", { name: c.name, card: D.CARDS[e.card].icon + t("dv_card_" + e.card) });
    if (e.type === "item") return t("dv_ev_item", { name: c.name, card: D.CARDS[e.card].icon + t("dv_card_" + e.card) });
    if (e.type === "trap") return t("dv_ev_trap_" + e.kind, { name: c.name });
    if (e.type === "shield") return t("dv_ev_shield", { name: c.name, kind: t("dv_hz_" + e.kind) });
    if (e.type === "jump") return t("dv_ev_jump", { name: c.name });
    if (e.type === "charge") return e.card ? t("dv_ev_charge", { name: c.name, card: D.CARDS[e.card].icon + t("dv_card_" + e.card) }) : t("dv_ev_charge_boost", { name: c.name });
    if (e.type === "fin") return t("dv_ev_fin", { name: c.name, time: fmtTime(c.finT) });
    if (e.type === "tactic") return t("dv_ev_tactic", { name: c.name, style: L(D.STYLES[e.style].name) });
    return "";
  }

  function updateTicker() {
    var ev = ui.race.events;
    if (ui.seenEv === ev.length) return;
    for (; ui.seenEv < ev.length; ui.seenEv++) { ui.ticker.unshift(ev[ui.seenEv]); onEvent(ev[ui.seenEv]); }
    ui.ticker = ui.ticker.slice(0, 7);
    R.ticker.innerHTML = "";
    ui.ticker.forEach(function (e) { R.ticker.appendChild(el("li", { class: "dv-ev-" + e.type }, [el("small", {}, [fmtTime(e.t)]), eventText(e)])); });
  }

  // ---------------- 錄影與重播 ----------------
  // 每兩步（1/15 秒）存一格各車狀態；重播時內插出一個「幽靈比賽」交給同一套繪圖函式畫
  var REC_F = 9;   // s, d, yaw, slip, v, braking, state, stun, 效果旗標（奔放模式：1 加速、2 防守、4 鬼、8 招式、16 護盾、32 煙幕）
  var STATE_CODE = { run: 0, fin: 1, dnf: 2 }, STATE_NAME = ["run", "fin", "dnf"];
  function record(race) {
    var a = new Float32Array(race.cars.length * REC_F);
    race.cars.forEach(function (c, i) {
      var o = i * REC_F;
      a[o] = c.s; a[o + 1] = c.d; a[o + 2] = c.yaw; a[o + 3] = c.slip; a[o + 4] = c.v;
      a[o + 5] = c.braking ? 1 : 0; a[o + 6] = STATE_CODE[c.state]; a[o + 7] = c.stun; a[o + 8] = fxBits(c);
    });
    ui.rec.t.push(race.t); ui.rec.a.push(a);
  }
  function ghostAt(race, t, ghost) {
    var T = ui.rec.t, lo = 0, hi = T.length - 1;
    if (hi < 0) return null;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (T[mid] <= t) lo = mid; else hi = mid - 1; }
    var i = lo, j = Math.min(T.length - 1, i + 1), f = j > i ? clamp((t - T[i]) / (T[j] - T[i]), 0, 1) : 0;
    var A = ui.rec.a[i], B = ui.rec.a[j];
    ghost = ghost || { track: race.track, mode: race.mode, items: race.items, wild: race.wild, season: race.season, seed: race.seed, events: [], cars: race.cars.map(function (c) {
      return { id: c.id, name: c.name, color: c.color, st: c.st, cpu: c.cpu, finT: c.finT };
    }) };
    ghost.t = t;
    ghost.cars.forEach(function (g, k) {
      var o = k * REC_F;
      g.s = A[o] + (B[o] - A[o]) * f; g.d = A[o + 1] + (B[o + 1] - A[o + 1]) * f;
      g.yaw = A[o + 2] + (B[o + 2] - A[o + 2]) * f; g.slip = A[o + 3] + (B[o + 3] - A[o + 3]) * f; g.v = A[o + 4] + (B[o + 4] - A[o + 4]) * f;
      g.braking = A[o + 5] > 0.5; g.state = STATE_NAME[A[o + 6]]; g.stun = A[o + 7];
      var b = A[o + 8];
      g.fxv = { go: b & 1, block: b & 2, ghost: b & 4, move: b & 8, shield: b & 16, blind: b & 32 };
    });
    return ghost;
  }

  // 奔放模式的效果（畫面用）：go＝加速中、block＝鐵壁、ghost＝鬼之走線、move＝招式超車中
  function fxView(c) {
    if (c.fxv) return c.fxv;
    var f = c.fx;
    if (!f) return null;
    return { go: f.nitro > 0 || f.sling > 0 || f.boost > 0 || f.jump > 0, block: f.block > 0, ghost: f.ghost > 0, move: f.move > 0 || f.sling > 0,
      shield: f.shield > 0, blind: f.blind > 0 };
  }
  function fxBits(c) {
    var v = fxView(c);
    return v ? (v.go ? 1 : 0) | (v.block ? 2 : 0) | (v.ghost ? 4 : 0) | (v.move ? 8 : 0) | (v.shield ? 16 : 0) | (v.blind ? 32 : 0) : 0;
  }

  function onEvent(e) {
    var race = ui.race, c = race.cars[e.car];
    if (e.type === "fin") {
      // 衝線：鏡頭停在這台車上一下，顯示名次與時間
      var pos = Core.order(race).indexOf(c) + 1;
      if (ui.autoFollow || c.id === ui.follow) ui.finHold = { id: c.id, pos: pos, until: performance.now() + 2600 };
    }
    if (e.type === "pass" && e.move) ui.flash = { text: c.name + " · " + t("dv_move_" + e.move) + "!", color: c.color, until: performance.now() + 1600 };
    else if (e.type === "card" && !c.cpu) ui.flash = { text: D.CARDS[e.card].icon + " " + t("dv_card_" + e.card), color: c.color, until: performance.now() + 1200 };
    else if (e.type === "charge" && !c.cpu) ui.flash = { text: "⚡ " + (e.card ? D.CARDS[e.card].icon + " " + t("dv_card_" + e.card) : t("dv_charge_boost")), color: c.color, until: performance.now() + 1200 };
    else if (e.type === "jump" && c.id === ui.follow) ui.flash = { text: "🛫 " + t("dv_jump"), color: c.color, until: performance.now() + 1000 };
    if (e.type === "pass" && e.kind && !e.move && (!c.cpu || c.id === ui.follow)) ui.flash = { text: t("dv_tv_pass_" + e.kind + "_short"), color: c.color, until: performance.now() + 1400 };
    // 起跑後 8 秒內的位置交換（排頭起跑）不插播
    if ((e.type === "pass" || e.type === "contact") && e.t > 8 && ui.replayOn && !ui.rp && !ui.tvRp && !ui.tvPend && performance.now() > ui.rpCool) {
      var other = race.cars[e.other];
      var pos2 = Core.order(race).indexOf(c) + 1;
      // 玩家參與的超車、前三名之爭、晚煞車／並排超車、奔放模式的招式超車、擦撞才重播
      if (!c.cpu || !other.cpu || pos2 <= 3 || e.move || e.kind || e.type === "contact") {
        var h = { type: e.type, t: e.t, car: c.id, other: other.id, kind: e.kind || null, move: e.move || null };
        if (ui.camMode === "tv") ui.tvPend = { h: h, at: e.t + 1.3 };   // 轉播：全畫面插播（等錄到事後一秒）
        else ui.rp = newReplay(h, true);
      }
    }
  }

  // ---------------- 轉播重播 ----------------
  // 重播腳本：plan＝[{ kind, from, to, speed, focus, trackAt? }]，依序播放；director＝整場重播（導播自動切鏡頭）
  function newReplay(h, pip) {
    var plan = Tv.replayPlan(h, ui.race.t + 30);
    if (pip) plan = plan.slice(0, 1);
    return { h: h, plan: plan, i: 0, clock: null, st: {}, ghost: null, cutAt: performance.now(), mul: 1, caption: Tv.caption(ui.race, h), color: ui.race.cars[h.car].color };
  }
  function skipToEnd() {
    var race = ui.race, guard = 0;
    while (!race.done && guard++ < 200000) { Core.step(race, Core.DT); if (race.stepN % 2 === 0) record(race); }
  }
  // 推進重播時鐘；整段播完回傳 false
  function replayStep(rp, dt) {
    var seg = rp.plan[rp.i];
    if (!seg) return false;
    if (rp.clock === null) rp.clock = seg.from;
    rp.clock += dt * seg.speed * (rp.mul || 1);
    if (rp.clock > seg.to) {
      rp.i++; rp.clock = null; rp.st = {}; rp.cutAt = performance.now();
      return rp.i < rp.plan.length;
    }
    return true;
  }
  function cockpitOpts(tr, cam) {
    var sc = scenery(tr);
    return {
      pal: PAL[tr.season], trees: sc.trees, patchColor: PATCH_COLOR, cam: cam || null, decor: sc.decor, snowWall: sc.snowWall, shoulder: sc.shoulder, city: sc.city,
      water: tr.water ? (tr.season === "winter" && tr.scene === "lake" ? WATER.frozen : WATER[tr.scene] || WATER.lake) : null
    };
  }
  // 用某個機位畫一格（3D 外部鏡頭／車內／俯視）
  function renderShot(race, car, kind, st, f, dt) {
    var s = Tv.shot(race, car, kind, st);
    if (s.top) drawChase(race, dt, { f: f, follow: car.id, hold: st, ghost: true, drone: true });
    else window.PriTestDejavuCockpit.draw(f.ctx, f.w, f.h, race, car, cockpitOpts(race.track, s.cam));
  }
  // 畫一格重播；overlay＝畫 REPLAY 資訊（子畫面只畫小標）
  function replayDraw(rp, f, dt, overlay) {
    var race = ui.race, seg = rp.plan[Math.min(rp.i, rp.plan.length - 1)];
    var clock = rp.clock === null ? seg.from : rp.clock;
    rp.ghost = ghostAt(race, clock, rp.ghost);
    if (!rp.ghost) return;
    var kind = seg.kind, car;
    if (kind === "director") {
      rp.dir = rp.dir || {};
      car = Tv.direct(rp.ghost, rp.dir, clock, null, rp.lock || null);
      kind = rp.dir.kind;
    } else {
      car = rp.ghost.cars[seg.focus];
      if (rp.lock) kind = rp.lock;
      if (kind === "track" && !rp.st.fix && seg.trackAt !== undefined) {
        // 路邊機位：架在事發地點稍微前面，看著車開過來、從眼前通過
        var g2 = ghostAt(race, seg.trackAt, null);
        var g0 = ghostAt(race, seg.from, null);
        rp.st.fix = Tv.placeTrackCam(race, g2.cars[seg.focus].s + 8, g0.cars[seg.focus].s);
      }
    }
    renderShot(rp.ghost, car, kind, seg.kind === "director" ? rp.dir.st : rp.st, f, dt);
    var ctx = f.ctx;
    if (seg.kind === "director") {
      Tv.tower(ctx, f, rp.ghost, car.id);
      Tv.bug(ctx, f, rp.ghost, courseName(), false);
      Tv.lowerThird(ctx, f, rp.ghost, car, clock - (rp.dir.lowerT || 0));
      Tv.battleCaption(ctx, f, rp.ghost, car);
      Tv.camTag(ctx, f, kind, (rp.mul || 1) + "×");
    } else if (overlay) {
      Tv.replayOverlay(ctx, f, { angle: rp.i + 1, angles: rp.plan.length, kind: kind, speed: Math.round(seg.speed * (rp.mul || 1) * 100) / 100,
        caption: rp.caption, color: rp.color, progress: (clock - seg.from) / Math.max(0.1, seg.to - seg.from) });
    }
    // 轉場：開頭與換角度時掃一下
    var age = (performance.now() - rp.cutAt) / 1000;
    if (overlay && age < 0.55) Tv.stinger(ctx, f, age / 0.55, rp.i === 0 ? "REPLAY" : t("dv_tv_angle", { i: rp.i + 1, n: rp.plan.length }));
  }

  // 轉播模式（直播）：導播挑焦點車與機位，畫轉播字幕
  function drawTvLive(race, dt) {
    var f = fitCanvas(R.main), ctx = f.ctx, tr = race.track;
    var hold = ui.finHold && performance.now() < ui.finHold.until ? ui.finHold.id : null;
    var fixed = hold !== null ? hold : ui.autoFollow ? null : ui.follow;
    var car = Tv.direct(race, ui.tvD, performance.now() / 1000, fixed, ui.tvLock || null);
    ui.follow = car.id;
    renderShot(race, car, ui.tvD.kind, ui.tvD.st, f, dt);
    if (ui.tvD.kind !== "top") drawWeather(ctx, f, tr, dt);
    Tv.tower(ctx, f, race, car.id);
    Tv.bug(ctx, f, race, courseName(), true);
    Tv.lowerThird(ctx, f, race, car, performance.now() / 1000 - (ui.tvD.lowerT || 0));
    Tv.battleCaption(ctx, f, race, car);
    Tv.camTag(ctx, f, ui.tvD.kind);
    if (race.wild && car.charge !== undefined) drawCharge(ctx, f.w - 200, 56, car);
    drawHudFx(ctx, f, race, car);
  }
  // 轉播模式的全畫面插播重播（比賽照常進行）
  function drawTvReplay(dt) {
    var f = fitCanvas(R.main);
    if (!ui.paused && !replayStep(ui.tvRp, dt)) { ui.tvRp = null; ui.rpCool = performance.now() + 6000; return false; }
    replayDraw(ui.tvRp, f, dt, true);
    var ctx = f.ctx;
    ctx.save(); ctx.font = "11px sans-serif"; ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText(t("dv_tap_skip"), f.w - 12, 66); ctx.restore();
    return true;
  }

  // 子畫面：超車重播（比賽照常進行；用路邊機位的 3D 畫面）
  function drawReplayPip(dt) {
    var rp = ui.rp, race = ui.race;
    if (!rp) return;
    if (race.t < rp.plan[0].to && !race.done) return;   // 還沒錄到事後那一秒
    if (!ui.paused && !replayStep(rp, dt)) { ui.rp = null; ui.rpCool = performance.now() + 2500; return; }
    var main = fitCanvas(R.main), dpr = window.devicePixelRatio || 1;
    var pw = Math.round(Math.max(150, main.w * 0.42)), ph = Math.round(pw * 0.62);
    var cv = ui.pipCv || (ui.pipCv = document.createElement("canvas"));
    if (cv.width !== pw * dpr || cv.height !== ph * dpr) { cv.width = pw * dpr; cv.height = ph * dpr; }
    var pctx = cv.getContext("2d");
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    replayDraw(rp, { ctx: pctx, w: pw, h: ph }, dt, false);
    var x = main.w - pw - 8, y = 58, ctx = main.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(x - 3, y - 3, pw + 6, ph + 6);
    ctx.drawImage(cv, x, y, pw, ph);
    ctx.fillStyle = "rgba(0,0,0,0.65)"; ctx.fillRect(x, y, pw, 20);
    ctx.fillStyle = Math.floor(rp.clock * 3) % 2 ? "#ff3b3b" : "#ffd84d";
    ctx.font = "bold 12px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("▶ REPLAY", x + 6, y + 14);
    ctx.fillStyle = "#fff"; ctx.textAlign = "right";
    var txt = Tv.caption(race, rp.h);
    ctx.fillText(txt.length > 34 ? txt.slice(0, 33) + "…" : txt, x + pw - 6, y + 14);
    ctx.restore();
  }

  // 全部抵達後：冠軍衝線的兩角度慢動作重播（路邊 → 直升機），播完才進結果畫面
  function drawFinal(dt) {
    var fin = ui.final, race = ui.race;
    if (!ui.paused && !replayStep(fin.rp, dt)) return true;
    var f = fitCanvas(R.main), ctx = f.ctx;
    replayDraw(fin.rp, f, dt, true);
    var c = race.cars[fin.id];
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 58, f.w, 50);
    ctx.textAlign = "center"; ctx.fillStyle = "#ffd84d"; ctx.font = "bold 22px sans-serif";
    ctx.fillText("🏆 " + t("dv_winner", { name: c.name }), f.w / 2, 82);
    ctx.fillStyle = "#fff"; ctx.font = "13px sans-serif";
    ctx.fillText(c.st.name + " · " + fmtTime(c.finT), f.w / 2, 100);
    ctx.textAlign = "right"; ctx.fillText(t("dv_tap_skip"), f.w - 12, f.h - 12);
    ctx.restore();
    return false;
  }

  function stopLoop() { if (ui.raf) cancelAnimationFrame(ui.raf); ui.raf = 0; }
  function startLoop() {
    stopLoop();
    ui.lastFrame = 0;
    var boardT = 0;
    function frame(ts) {
      if (ui.screen !== "race" || !ui.race) return;
      var dt = ui.lastFrame ? Math.min(0.1, (ts - ui.lastFrame) / 1000) : 0;
      ui.lastFrame = ts;
      var race = ui.race;
      if (!ui.paused) {
        if (ui.countdown > 0) ui.countdown -= dt;
        else if (!race.done) {
          // 跟拍的車快到終點時自動放慢到 1 倍速，才看得到衝線
          var fc = race.cars[ui.follow];
          var near = fc && fc.state === "run" && race.track.finish - fc.s < 70 + fc.v * 0.5;
          // 插播重播時比賽照跑，但最多 1 倍速，免得錯過太多
          ui.acc += dt * (near || ui.tvRp ? Math.min(1, ui.speed) : ui.speed);
          var steps = 0;
          while (ui.acc >= Core.DT && steps < 800 && !race.done) {
            Core.step(race, Core.DT); ui.acc -= Core.DT; steps++;
            if (race.stepN % 2 === 0) record(race);
          }
        }
      }
      var hold = ui.finHold && performance.now() < ui.finHold.until ? ui.finHold : null;
      if (ui.camMode === "tv") { /* 轉播模式由導播決定焦點 */ }
      else if (hold && ui.autoFollow) ui.follow = hold.id;
      else if (ui.autoFollow) {
        var ord = Core.order(race).filter(function (c) { return c.state === "run"; });
        if (ord.length) ui.follow = ord[0].id;
      }
      if (race.done && !ui.doneAt) {
        ui.doneAt = ts;
        var win = Core.order(race)[0];
        if (win && win.state === "fin" && ui.rec.t.length && !ui.final) {
          ui.rp = null; ui.tvRp = null; ui.tvPend = null;
          var frp = newReplay({ type: "win", t: win.finT, car: win.id }, false);
          frp.plan.forEach(function (sg) { sg.to = Math.min(sg.to, race.t); });
          ui.final = { id: win.id, rp: frp };
        }
      }
      // 畫面出錯不能讓整個比賽迴圈停掉（模擬照跑，只記一次錯誤）
      try {
        if (ui.tvPend && (race.t >= ui.tvPend.at || race.done) && !ui.final) { ui.tvRp = newReplay(ui.tvPend.h, false); ui.tvPend = null; }
        if (ui.final) {
          if (drawFinal(dt)) { finishRace(); return; }
        } else if (ui.tvRp && ui.camMode === "tv" && drawTvReplay(dt)) {
          /* 插播中 */
        } else {
          if (ui.camMode === "tv" && Tv) drawTvLive(race, dt);
          else if (ui.camMode === "cockpit" && window.PriTestDejavuCockpit) drawCockpit(race, dt);
          else drawChase(race, dt);
          if (ui.camMode !== "tv") drawReplayPip(dt);
        }
      } catch (err) {
        if (!ui.drawErr) { ui.drawErr = true; console.error(err); }
        if (ui.final) { finishRace(); return; }
      }
      boardT += dt;
      if (boardT > 0.2) { boardT = 0; renderBoard(); renderTactics(); drawMap(R.map, race.track, { race: race }); drawElev(R.elev, race.track, race); }
      updateTicker();
      if (race.done && !ui.final && ts - ui.doneAt > 1800) { finishRace(); return; }
      ui.raf = requestAnimationFrame(frame);
    }
    ui.doneAt = 0;
    ui.raf = requestAnimationFrame(frame);
  }

  function finishRace() {
    stopLoop();
    ui.final = null; ui.rp = null; ui.tvRp = null; ui.tvPend = null;
    ui.lastLog = ui.race.log.slice();
    ui.result = Core.results(ui.race);
    go("result");
  }

  // 追焦鏡頭：車頭朝上旋轉的俯視圖
  // opt：{ f: 畫布（預設主畫面）, follow: 跟哪台, hold: 存鏡頭狀態的物件（預設 ui）, ghost: true＝重播（不畫煙、天氣、HUD） }
  function drawChase(race, dt, opt) {
    opt = opt || {};
    var f = opt.f || fitCanvas(R.main), ctx = f.ctx, tr = race.track;
    var pal = PAL[tr.season];
    var sc = scenery(tr);
    var car = race.cars[opt.follow !== undefined ? opt.follow : ui.follow] || race.cars[0];
    var H0 = opt.hold || ui;
    var pose = Core.carPose(race, car);
    var i0 = clamp(Math.floor(car.s / tr.ds), 0, tr.N - 1);
    var camH = tr.h[i0];
    if (!H0.cam || H0.cam.car !== car.id) H0.cam = { car: car.id, h: camH, x: pose.x, y: pose.y, z: 7 };
    var drone = opt.drone || !opt.ghost && ui.camMode === "drone";
    var cam = H0.cam, k = Math.min(1, dt * (drone ? 0.6 : 3));
    cam.h += (camH - cam.h) * k;
    var look = drone ? 25 + car.v * 0.6 : 10 + car.v * 0.35;
    var tx = pose.x + Math.cos(cam.h) * look, ty = pose.y + Math.sin(cam.h) * look;
    cam.x += (tx - cam.x) * Math.min(1, dt * 5); cam.y += (ty - cam.y) * Math.min(1, dt * 5);
    var zoom = drone ? clamp(f.h / (210 + car.v * 2.5), 0.8, 2.6) : clamp(f.h / (55 + car.v * 1.6), 2.5, 9);
    cam.z += (zoom - cam.z) * Math.min(1, dt * 1.5);
    var s = cam.z, cx = f.w / 2, cy = f.h * 0.55;
    var viewR = Math.hypot(f.w, f.h) / s * 0.6;

    var city = sc.city;
    ctx.fillStyle = city ? (tr.season === "winter" && city.kind === "jp" ? "#c9ced3" : "#a29d94") : pal.ground;
    ctx.fillRect(0, 0, f.w, f.h);
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(s, -s); ctx.rotate(-(cam.h - Math.PI / 2)); ctx.translate(-cam.x, -cam.y);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    var vis = sc.chunks.filter(function (c) { return Math.hypot(c.x - cam.x, c.y - cam.y) < viewR + c.r; });
    function strokeRange(a, b, off) {
      ctx.beginPath();
      for (var i = a; i <= b; i++) {
        var x = tr.x[i], y = tr.y[i];
        if (off) { x += -Math.sin(tr.h[i]) * off; y += Math.cos(tr.h[i]) * off; }
        if (i === a) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    function layer(style, width, off, dash) {
      ctx.strokeStyle = style; ctx.lineWidth = width; if (dash) ctx.setLineDash(dash);
      vis.forEach(function (c) { strokeRange(c.a, c.b, off); });
      if (dash) ctx.setLineDash([]);
    }
    if (tr.water) layer(tr.season === "winter" && tr.scene === "lake" ? WATER.frozen : WATER[tr.scene] || WATER.lake, 170, tr.water * (tr.w / 2 + 6 + 85));
    function spLayer(code, style, width, off) {
      ctx.strokeStyle = style; ctx.lineWidth = width;
      sc.sp.forEach(function (r) {
        if (r.code !== code) return;
        vis.forEach(function (c) { var a = Math.max(c.a, r.a), b = Math.min(c.b, r.b); if (a < b) strokeRange(a, b, off); });
      });
    }
    if (city) drawCityTop(ctx, tr, city, vis, strokeRange, pal);
    else spLayer(4, "rgba(40,70,100,0.45)", tr.w + 40, 0);   // 橋下的山谷陰影
    layer("rgba(0,0,0,0.18)", tr.w + 5, 0);
    layer(city ? "#c8c3b9" : sc.shoulder || pal.shoulder, city ? tr.w + 6.2 : tr.w + 2.4, 0);
    if (sc.shoulder) {
      // 路肩上的花瓣／落葉
      ctx.fillStyle = tr.season === "spring" ? "rgba(255,214,226,0.9)" : "rgba(214,70,30,0.85)";
      vis.forEach(function (c) {
        for (var q = c.a; q <= c.b; q += 1) {
          var o = ((q * 7919) % 13 / 13 - 0.5) * (tr.w + 2.2);
          ctx.beginPath(); ctx.arc(tr.x[q] - Math.sin(tr.h[q]) * o, tr.y[q] + Math.cos(tr.h[q]) * o, 0.18, 0, Math.PI * 2); ctx.fill();
        }
      });
    }
    layer(tr.rain ? "#3f4448" : pal.road, tr.w, 0);
    spLayer(1, SF_COLOR[1], tr.w, 0);
    spLayer(4, "#9aa3ab", tr.w + 2.4, 0); spLayer(4, tr.rain ? "#3f4448" : pal.road, tr.w, 0);
    spLayer(2, "rgba(20,40,30,0.75)", 0.6, tr.w / 2 - 0.3); spLayer(2, "rgba(20,40,30,0.75)", 0.6, -(tr.w / 2 - 0.3));
    tr.patches.forEach(function (p) {
      ctx.strokeStyle = PATCH_COLOR[p.kind]; ctx.lineWidth = tr.w * 0.85;
      vis.forEach(function (c) { var a = Math.max(c.a, p.a), b = Math.min(c.b, p.b); if (a < b) strokeRange(a, b, 0); });
    });
    ctx.lineCap = "butt";
    layer(pal.line, 0.15, tr.w / 2 - 0.35); layer(pal.line, 0.15, -(tr.w / 2 - 0.35));
    if (city) {
      // 城市：白色車道虛線（雙向各一線以上）＋中央雙黃線；路口的斑馬線
      layer(city.kind === "tw" ? "rgba(240,200,60,0.9)" : "#f2f2f2", 0.15, 0.12); layer(city.kind === "tw" ? "rgba(240,200,60,0.9)" : "#f2f2f2", 0.15, -0.12);
      if (tr.w >= 7.5) { layer("#f2f2f2", 0.12, tr.w / 4, [3, 5]); layer("#f2f2f2", 0.12, -tr.w / 4, [3, 5]); }
      ctx.fillStyle = "#f4f4f4";
      vis.forEach(function (c) {
        for (var q = c.a; q <= c.b; q++) {
          if (!city.cross[q]) continue;
          for (var o = -tr.w / 2 + 0.4; o < tr.w / 2 - 0.3; o += 1.0) {
            var p1 = posAt(tr, q * tr.ds, o), p2 = posAt(tr, q * tr.ds + tr.ds, o);
            ctx.save(); ctx.translate((p1.x + p2.x) / 2, (p1.y + p2.y) / 2); ctx.rotate(p1.h); ctx.fillRect(-tr.ds / 2, -0.25, tr.ds, 0.5); ctx.restore();
          }
        }
      });
    } else {
      layer("rgba(240,200,60,0.85)", 0.15, 0, [3, 4]);
      layer("#c9ccd0", 0.3, tr.w / 2 + 1.1); layer("#c9ccd0", 0.3, -(tr.w / 2 + 1.1));
    }
    ctx.lineCap = "round";
    // 起點／終點線
    [tr.start, tr.finish].forEach(function (sx, n) {
      var i = Math.round(sx / tr.ds), h = tr.h[i];
      var nx = -Math.sin(h), ny = Math.cos(h), fx = Math.cos(h), fy = Math.sin(h);
      var cells = 8, cw = tr.w / cells;
      for (var j = 0; j < cells; j++) for (var r = 0; r < 2; r++) {
        ctx.fillStyle = (j + r) % 2 ? "#111" : "#fff";
        var o = -tr.w / 2 + j * cw, bx = tr.x[i] + nx * o + fx * r * cw, by = tr.y[i] + ny * o + fy * r * cw;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + nx * cw, by + ny * cw); ctx.lineTo(bx + nx * cw + fx * cw, by + ny * cw + fy * cw); ctx.lineTo(bx + fx * cw, by + fy * cw); ctx.fill();
      }
      void n;
    });
    // 日本冬天：雪牆（白色帶）
    if (sc.snowWall) {
      ctx.lineCap = "butt";
      [1, -1].forEach(function (side) {
        if (tr.water && side === tr.water) return;
        vis.forEach(function (c) {
          var a = -1;
          for (var q = c.a; q <= c.b + 1; q++) {
            var on = q <= c.b && sc.snowWall[q] > 0;
            if (on && a < 0) a = q;
            if (!on && a >= 0) {
              ctx.strokeStyle = "#f4f7fa"; ctx.lineWidth = 1.6; strokeRange(a, q - 1, side * (tr.w / 2 + 2.4));
              ctx.strokeStyle = "rgba(150,170,190,0.6)"; ctx.lineWidth = 0.25; strokeRange(a, q - 1, side * (tr.w / 2 + 1.65));
              a = -1;
            }
          }
        });
      });
      ctx.lineCap = "round";
    }
    // 台灣的路邊景物（地面的：機車、攤販、民眾）
    if (sc.decor.length) drawDecorTop(ctx, sc.decor, cam, viewR, race.t, false);
    // 奔放模式的路面機關
    if (race.items && race.items.length) drawItems(ctx, race, cam, viewR);
    // 煙（重播不畫）
    var smoke = opt.ghost ? [] : ui.smoke;
    race.cars.forEach(function (c) {
      if (Math.abs(c.slip) > 0.45 && c.v > 6 || c.stun > 0 && c.v > 3) {
        var ps = Core.carPose(race, c);
        if (Math.hypot(ps.x - cam.x, ps.y - cam.y) > viewR) return;
        for (var w = -1; w <= 1; w += 2) smoke.push({ x: ps.x - Math.cos(ps.h) * 1.8 - Math.sin(ps.h) * w * 0.8, y: ps.y - Math.sin(ps.h) * 1.8 + Math.cos(ps.h) * w * 0.8, r: 0.6, life: 1 });
      }
    });
    if (smoke.length > 400) smoke.splice(0, smoke.length - 400);
    var smokeCol = tr.season === "winter" ? "235,240,245" : "220,220,220";
    for (var si = smoke.length - 1; si >= 0; si--) {
      var p = smoke[si];
      p.life -= dt * 0.8 * Math.max(1, ui.speed * 0.5); p.r += dt * 2.5;
      if (p.life <= 0) { smoke.splice(si, 1); continue; }
      ctx.fillStyle = "rgba(" + smokeCol + "," + (p.life * 0.45).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    // 車（被跟的最後畫）
    var drawList = race.cars.filter(function (c) { return c.id !== car.id; }).concat([car]);
    var labels = [];
    drawList.forEach(function (c) {
      var ps = Core.carPose(race, c);
      if (Math.hypot(ps.x - cam.x, ps.y - cam.y) > viewR) return;
      ctx.save();
      ctx.translate(ps.x, ps.y); ctx.rotate(ps.h);
      ctx.globalAlpha = race.mode === "attack" && c.id !== car.id ? 0.55 : c.state === "dnf" ? 0.6 : 1;
      if (c.id === car.id || c.v > 5) {
        // 車燈
        ctx.fillStyle = "rgba(255,250,200,0.18)";
        ctx.beginPath(); ctx.moveTo(2.2, 0.7); ctx.lineTo(16, 3.6); ctx.lineTo(16, -3.6); ctx.lineTo(2.2, -0.7); ctx.fill();
      }
      var fv = fxView(c);
      if (fv) drawCarFx(ctx, fv, race.t);
      if (fv && fv.ghost) ctx.globalAlpha *= 0.5;
      ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(-2.3, -1.0, 4.7, 2.1);
      ctx.fillStyle = c.color; ctx.fillRect(-2.2, -0.9, 4.4, 1.8);
      ctx.fillStyle = "rgba(20,30,40,0.85)"; ctx.fillRect(0.3, -0.75, 0.9, 1.5); ctx.fillRect(-1.6, -0.7, 0.6, 1.4);
      ctx.fillStyle = c.braking ? "#ff2a2a" : "#7a1010"; ctx.fillRect(-2.25, -0.85, 0.2, 0.45); ctx.fillRect(-2.25, 0.4, 0.2, 0.45);
      ctx.fillStyle = "#fff8c0"; ctx.fillRect(2.05, -0.85, 0.2, 0.4); ctx.fillRect(2.05, 0.45, 0.2, 0.4);
      ctx.restore();
      labels.push({ c: c, x: ps.x, y: ps.y });
    });
    // 隧道頂（蓋在車上面，半透明）
    ctx.lineCap = "butt";
    spLayer(3, "rgba(45,45,48,0.72)", tr.w + 6, 0);
    spLayer(3, "rgba(255,210,120,0.55)", 0.25, 0);
    ctx.lineCap = "round";
    // 樹
    sc.trees.forEach(function (tr2) {
      if (Math.abs(tr2.x - cam.x) > viewR || Math.abs(tr2.y - cam.y) > viewR) return;
      ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.beginPath(); ctx.arc(tr2.x + 0.6, tr2.y - 0.6, tr2.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = tr2.c; ctx.beginPath(); ctx.arc(tr2.x, tr2.y, tr2.r, 0, Math.PI * 2); ctx.fill();
    });
    if (sc.decor.length) drawDecorTop(ctx, sc.decor, cam, viewR, race.t, true);
    var m = ctx.getTransform();
    ctx.restore();
    // 名牌（螢幕座標，避免文字被翻轉）
    var dpr = window.devicePixelRatio || 1;
    ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
    labels.forEach(function (lb) {
      var sx = (m.a * lb.x + m.c * lb.y + m.e) / dpr, sy = (m.b * lb.x + m.d * lb.y + m.f) / dpr;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      var w = ctx.measureText(lb.c.name).width + 8;
      ctx.fillRect(sx - w / 2, sy - 26, w, 16);
      ctx.fillStyle = lb.c.id === car.id ? "#ffe066" : "#fff";
      ctx.fillText(lb.c.name, sx, sy - 14);
    });
    if (opt.ghost) return;
    drawWeather(ctx, f, tr, dt);
    drawHud(ctx, f, race, car);
    if (drone) drawLive(ctx, f, race);
  }

  // 俯視圖的城市：側街（往外延伸的柏油路）與大樓屋頂
  function drawCityTop(ctx, tr, city, vis, strokeRange, pal) {
    var hw = tr.w / 2, seen = {};
    ctx.lineCap = "butt";
    vis.forEach(function (c) {
      [1, -1].forEach(function (side) {
        for (var q = c.a; q <= c.b; q++) {
          var id = city.lotOf[side][q];
          if (id < 0 || seen[id]) continue;
          seen[id] = 1;
          var lot = city.lots[id];
          if (lot.type === "water") continue;
          if (lot.type === "gap") {
            ctx.strokeStyle = tr.rain ? "#3f4448" : pal.road; ctx.lineWidth = 46; strokeRange(lot.a, lot.b, side * (hw + 23));
            continue;
          }
          var face = hw + (lot.base < 0 ? 9 : 3) + lot.set;
          ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 14; strokeRange(lot.a, lot.b, side * (face + 7.6));
          ctx.strokeStyle = lot.type === "temple" ? "#d5682b" : lot.glass ? "#7f93a6" : lot.col; ctx.lineWidth = 14; strokeRange(lot.a, lot.b, side * (face + 7));
          // 屋頂的設備（冷氣機、水塔）
          ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 3; strokeRange(lot.a, lot.b, side * (face + 7));
        }
      });
    });
    ctx.lineCap = "round";
  }

  // 俯視圖的台灣景物；tall＝高的東西（看板、霓虹）畫在樹上面
  function drawDecorTop(ctx, list, cam, viewR, t, tall) {
    list.forEach(function (d) {
      var isTall = d.kind === "billboard" || d.kind === "neon" || d.kind === "tsign" || d.kind === "vsign" || d.kind === "wtank" || d.kind === "troof" || d.kind === "upole" || d.kind === "light";
      if (isTall !== tall || Math.abs(d.x - cam.x) > viewR || Math.abs(d.y - cam.y) > viewR) return;
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.h);
      if (d.kind === "scooter") {
        ctx.rotate(d.ang);
        ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(-0.85, -0.25, 1.8, 0.55);
        ctx.fillStyle = d.c; ctx.fillRect(-0.9, -0.3, 1.8, 0.6);
        ctx.fillStyle = "#222"; ctx.fillRect(-0.6, -0.18, 0.7, 0.36); ctx.fillRect(0.75, -0.4, 0.12, 0.8);
      } else if (d.kind === "stall") {
        for (var k = 0; k < 6; k++) { ctx.fillStyle = k % 2 ? "#fff" : d.c; ctx.fillRect(-1.5 + k * 0.5, -1.2, 0.5, 2.4); }
        ctx.fillStyle = "rgba(255,240,180,0.6)"; ctx.beginPath(); ctx.arc(0, 0, 1.9 + Math.sin(t * 3 + d.ph * 6) * 0.15, 0, Math.PI * 2); ctx.fill();
      } else if (d.kind === "person") {
        var bob = d.type === "santaizi" || d.type === "dancer" ? 0.12 * Math.sin(t * 8 + d.ph * 6) : 0;
        ctx.fillStyle = d.type === "dog" ? "#a8743f" : d.type === "santaizi" ? "#d8342c" : d.type === "uncle" ? "#f4f4f0" : d.c;
        ctx.beginPath(); ctx.arc(0, 0, (d.type === "santaizi" ? 0.75 : d.type === "dog" ? 0.3 : 0.38) + bob, 0, Math.PI * 2); ctx.fill();
        if (d.type === "auntie") { ctx.fillStyle = d.c2; ctx.beginPath(); ctx.arc(0, 0, 0.8, 0, Math.PI * 2); ctx.globalAlpha = 0.8; ctx.fill(); }
      } else if (d.kind === "billboard") {
        ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(-d.w / 2 + 0.6, -0.4, d.w, 0.8);
        ctx.fillStyle = d.bg; ctx.fillRect(-d.w / 2, -0.35, d.w, 0.7);
        ctx.strokeStyle = "#eee"; ctx.lineWidth = 0.12; ctx.strokeRect(-d.w / 2, -0.35, d.w, 0.7);
      } else if (d.kind === "upole" || d.kind === "light") {
        ctx.fillStyle = "#555"; ctx.beginPath(); ctx.arc(0, 0, 0.3, 0, Math.PI * 2); ctx.fill();
        if (d.kind === "light") { ctx.fillStyle = Math.floor(t / 4 + d.ph * 3) % 3 === 0 ? "#ff3b3b" : "#3cf06a"; ctx.beginPath(); ctx.arc(0, -d.arm * 2.5, 0.4, 0, Math.PI * 2); ctx.fill(); }
      } else if (d.kind === "tsign" || d.kind === "vsign") {
        ctx.fillStyle = d.kind === "tsign" ? d.stack[0].bg : d.bg; ctx.fillRect(-0.5, -0.9, 1.0, 1.8);
      } else if (d.kind === "wtank") {
        ctx.fillStyle = "#c9cdd1"; ctx.beginPath(); ctx.arc(0, 0, 0.9, 0, Math.PI * 2); ctx.fill();
      } else if (d.kind === "troof") {
        ctx.fillStyle = "#2f7d4f"; ctx.fillRect(-d.w / 2, -5, d.w, 10); ctx.fillStyle = "#d5682b"; ctx.fillRect(-d.w / 2, -0.4, d.w, 0.8);
      } else if (d.kind === "vend") {
        ctx.fillStyle = d.c; ctx.fillRect(-0.5, -0.4, 1.0, 0.8);
      } else if (d.kind === "bike") {
        ctx.fillStyle = d.c; ctx.fillRect(-0.85, -0.15, 1.7, 0.3);
      } else if (d.kind === "neon") {
        var on = Math.sin(t * 9 + d.ph * 7) > -0.85;
        ctx.fillStyle = on ? d.c : "#3a2a3a"; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillRect(-0.4, -0.25, 0.8, 0.5);
      }
      ctx.restore();
    });
  }

  // 路上某點（s）的世界座標與方向；off＝橫向位移（左正）
  function posAt(tr, s, off) {
    var p = clamp(s / tr.ds, 0, tr.N - 1.001), i = Math.floor(p), f = p - i;
    var h = tr.h[i] + (tr.h[i + 1] - tr.h[i]) * f;
    var x = tr.x[i] + (tr.x[i + 1] - tr.x[i]) * f, y = tr.y[i] + (tr.y[i + 1] - tr.y[i]) * f;
    return { x: x - Math.sin(h) * (off || 0), y: y + Math.cos(h) * (off || 0), h: h };
  }
  // 機關：加速帶（黃色箭頭）、道具箱（旋轉的？方塊）、落石、油漬（世界座標，ctx 已經是俯視轉換）
  function drawItems(ctx, race, cam, viewR) {
    var tr = race.track;
    race.items.forEach(function (it) {
      if (it.until !== undefined && race.t > it.until) return;
      var p = posAt(tr, it.s, 0);
      if (Math.abs(p.x - cam.x) > viewR || Math.abs(p.y - cam.y) > viewR) return;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.h);
      if (it.kind === "boost") {
        var w = tr.w * 0.42, blink = Math.floor(race.t * 6) % 3;
        for (var k = 0; k < 3; k++) {
          ctx.fillStyle = k === blink ? "#fff27a" : "#ffb020";
          ctx.beginPath(); ctx.moveTo(-1.5 + k * 1.6, -w); ctx.lineTo(0.2 + k * 1.6, 0); ctx.lineTo(-1.5 + k * 1.6, w);
          ctx.lineTo(-0.7 + k * 1.6, w); ctx.lineTo(1.0 + k * 1.6, 0); ctx.lineTo(-0.7 + k * 1.6, -w); ctx.closePath(); ctx.fill();
        }
      } else if (it.kind === "box") {
        [-tr.w * 0.25, tr.w * 0.25].forEach(function (o, n) {
          ctx.save(); ctx.translate(0, o); ctx.rotate(race.t * 2 + n);
          ctx.fillStyle = "hsl(" + Math.round((race.t * 120 + n * 90) % 360) + ",85%,55%)"; ctx.fillRect(-0.8, -0.8, 1.6, 1.6);
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 0.15; ctx.strokeRect(-0.8, -0.8, 1.6, 1.6);
          ctx.restore();
        });
      } else if (it.kind === "rock") {
        [[0.2, 0.6, 0.9], [-0.6, -0.8, 0.7], [0.9, -1.6, 0.5], [-1, 1.5, 0.55]].forEach(function (r, n) {
          ctx.fillStyle = n % 2 ? "#6f6a63" : "#8a857c";
          ctx.beginPath(); ctx.arc(r[0], r[1] + ((it.id % 3) - 1) * 0.8, r[2], 0, Math.PI * 2); ctx.fill();
        });
      } else if (it.kind === "mud") {
        ctx.fillStyle = "rgba(98,70,40,0.82)";
        ctx.beginPath(); ctx.ellipse(0, 0, 4, tr.w * 0.36, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(140,105,65,0.7)";
        [[-1.6, 0.6, 0.7], [1.2, -0.9, 0.6], [0.4, 1.2, 0.45]].forEach(function (b) { ctx.beginPath(); ctx.arc(b[0], b[1], b[2], 0, Math.PI * 2); ctx.fill(); });
      } else if (it.kind === "ramp") {
        var rw = tr.w * 0.4;
        ctx.fillStyle = "#8d949b"; ctx.fillRect(-1.5, -rw, 3, rw * 2);
        for (var q = -rw; q < rw; q += 0.9) { ctx.fillStyle = Math.round(q / 0.9) % 2 ? "#ffd23a" : "#222"; ctx.fillRect(1.1, q, 0.4, 0.9); }
      } else if (it.kind === "oil") {
        ctx.fillStyle = "rgba(15,15,20,0.75)";
        ctx.beginPath(); ctx.ellipse(0, 0, 3.2, tr.w * 0.38, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(120,80,200,0.35)";
        ctx.beginPath(); ctx.ellipse(0.6, 0.4, 1.4, tr.w * 0.15, 0.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    });
  }
  // 車身上的效果（ctx 已轉到車的座標：車頭朝 +x）
  function drawCarFx(ctx, fv, t) {
    if (fv.go) {
      var fl = 1.6 + Math.sin(t * 40) * 0.5;
      ctx.fillStyle = "rgba(80,170,255,0.85)";
      ctx.beginPath(); ctx.moveTo(-2.2, -0.5); ctx.lineTo(-2.2 - fl * 1.4, 0); ctx.lineTo(-2.2, 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,200,80,0.9)";
      ctx.beginPath(); ctx.moveTo(-2.2, -0.3); ctx.lineTo(-2.2 - fl * 0.8, 0); ctx.lineTo(-2.2, 0.3); ctx.closePath(); ctx.fill();
    }
    if (fv.move) {
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 0.12;
      for (var k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(-3, k * 0.9); ctx.lineTo(-7 - Math.abs(k) * 1.5, k * 1.1); ctx.stroke(); }
    }
    if (fv.block) {
      ctx.strokeStyle = "rgba(90,220,255,0.8)"; ctx.lineWidth = 0.25;
      ctx.beginPath(); ctx.ellipse(0, 0, 3.4, 2.1, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (fv.ghost) {
      ctx.strokeStyle = "rgba(190,120,255,0.9)"; ctx.lineWidth = 0.2;
      ctx.strokeRect(-2.6, -1.2, 5.2, 2.4);
    }
    if (fv.shield) {
      ctx.strokeStyle = "rgba(120,240,255," + (0.55 + 0.35 * Math.sin(t * 8)).toFixed(2) + ")"; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.arc(0, 0, 3.1, 0, Math.PI * 2); ctx.stroke();
    }
    if (fv.blind) {
      ctx.fillStyle = "rgba(200,200,205,0.55)";
      [[2.6, 0.6, 1.4], [3.4, -0.7, 1.2], [1.6, -0.2, 1.1]].forEach(function (b) { ctx.beginPath(); ctx.arc(b[0], b[1], b[2], 0, Math.PI * 2); ctx.fill(); });
    }
  }

  // 空拍轉播（MF Ghost 風）：LIVE 標誌與前三名
  function drawLive(ctx, f, race) {
    var blink = Math.floor(race.t * 2) % 2 === 0;
    ctx.textAlign = "left"; ctx.font = "bold 13px sans-serif";
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(8, f.h - 34, 210, 26);
    ctx.fillStyle = blink ? "#ff3030" : "#7a1010"; ctx.beginPath(); ctx.arc(22, f.h - 21, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText("LIVE · " + t("dv_cam_drone"), 34, f.h - 16);
    var ord = Core.order(race).slice(0, 3);
    ctx.textAlign = "right";
    ord.forEach(function (c, i) {
      var y = f.h - 18 - (ord.length - 1 - i) * 22;
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(f.w - 168, y - 15, 160, 20);
      ctx.fillStyle = c.color; ctx.fillRect(f.w - 168, y - 15, 5, 20);
      ctx.fillStyle = "#fff"; ctx.fillText((i + 1) + ". " + c.name, f.w - 14, y);
    });
  }

  function drawCockpit(race, dt) {
    var f = fitCanvas(R.main), ctx = f.ctx, tr = race.track;
    var car = race.cars[ui.follow] || race.cars[0];
    window.PriTestDejavuCockpit.draw(ctx, f.w, f.h, race, car, cockpitOpts(tr));
    drawWeather(ctx, f, tr, dt);
    drawHud(ctx, f, race, car);
  }

  function drawWeather(ctx, f, tr, dt) {
    var w = ui.weather, kind = tr.rain ? "rain" : tr.season === "winter" ? "snow" : tr.season === "spring" ? "petal" : tr.season === "autumn" ? "leaf" : null;
    if (!kind) return;
    // 日本的春秋冬：落櫻、落葉、雪下得更多
    var jp = scenery(tr).region === "jp" || scenery(tr).region === "jpcity";

    var want = kind === "rain" ? 120 : kind === "snow" ? (jp ? 160 : 90) : jp ? 75 : 25;
    while (w.length < want) w.push({ x: Math.random() * f.w, y: Math.random() * f.h, v: 0.5 + Math.random(), a: Math.random() * 6 });
    w.forEach(function (p) {
      if (kind === "rain") {
        p.y += dt * 700 * p.v; p.x -= dt * 80;
        ctx.strokeStyle = "rgba(200,220,255,0.45)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 3, p.y + 12); ctx.stroke();
      } else {
        p.a += dt * 2;
        p.y += dt * (kind === "snow" ? 50 : 35) * p.v; p.x += Math.sin(p.a) * dt * 25;
        ctx.fillStyle = kind === "snow" ? "rgba(255,255,255,0.85)" : kind === "petal" ? "rgba(255,190,210,0.9)" : "rgba(210,110,40,0.85)";
        ctx.beginPath();
        if (kind === "snow") ctx.arc(p.x, p.y, 1.5 + p.v, 0, Math.PI * 2);
        else ctx.ellipse(p.x, p.y, 3.5, 2, p.a, 0, Math.PI * 2);
        ctx.fill();
      }
      if (p.y > f.h + 10) { p.y = -10; p.x = Math.random() * (f.w + 60); }
      if (p.x < -20) p.x = f.w + 10;
    });
  }

  function drawHud(ctx, f, race, car) {
    var ord = Core.order(race), pos = ord.indexOf(car) + 1;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(8, 8, 190, 64);
    ctx.fillStyle = car.color; ctx.fillRect(8, 8, 5, 64);
    ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif";
    ctx.fillText("P" + pos + "/" + race.cars.length + "  " + car.name, 20, 27);
    ctx.font = "bold 24px sans-serif";
    ctx.fillText(Math.round(car.v * 3.6) + " km/h", 20, 54);
    ctx.font = "11px sans-serif"; ctx.fillStyle = "#ddd";
    ctx.fillText(car.st.name, 20, 67);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(f.w - 150, 8, 142, 44);
    ctx.fillStyle = "#fff"; ctx.font = "bold 18px monospace";
    ctx.fillText(fmtTime(Math.max(0, race.t)), f.w - 16, 29);
    ctx.font = "12px sans-serif";
    ctx.fillText(SEASON_ICON[race.season] + " " + L(D.SEASONS[race.season].name) + (race.track.rain ? " 🌧" : "") + " · " + t("dv_mode_" + race.mode), f.w - 16, 46);
    // 剩餘距離
    var left = Math.max(0, race.track.finish - car.s);
    ctx.textAlign = "left"; ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(8, 78, 190, 8);
    ctx.fillStyle = car.color;
    ctx.fillRect(8, 78, 190 * clamp(1 - left / (race.track.finish - race.track.start), 0, 1), 8);
    // 奔放模式：甩尾集氣表
    if (race.wild && car.charge !== undefined) drawCharge(ctx, 8, 90, car);
    drawHudFx(ctx, f, race, car);
  }
  function drawCharge(ctx, x, y, car) {
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(x, y, 190, 14);
    ctx.fillStyle = car.charge > 0.8 ? "#ffe066" : "#5ec8ff"; ctx.fillRect(x + 2, y + 2, 186 * clamp(car.charge, 0, 1), 10);
    ctx.fillStyle = "#fff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "left"; ctx.fillText("⚡ " + t("dv_charge"), x + 4, y + 11);
  }
  // 畫面中央的演出：打滑／甩尾字樣、倒數、閃現大字、衝線停留、比賽結束（追焦、車內、轉播共用）
  function drawHudFx(ctx, f, race, car) {


    if (car.stun > 0 || car.state === "dnf") {
      ctx.textAlign = "center"; ctx.font = "bold 22px sans-serif"; ctx.fillStyle = "#ff6b5b";
      ctx.fillText(car.state === "dnf" ? t("dv_dnf") : t("dv_spin"), f.w / 2, f.h * 0.3);
    } else if (Math.abs(car.slip) > 0.55 && car.v > 8) {
      ctx.textAlign = "center"; ctx.font = "italic bold 20px sans-serif"; ctx.fillStyle = "#ffe066";
      ctx.fillText("DRIFT", f.w / 2, f.h * 0.3);
    }
    if (ui.countdown > 0 || race.t < 0.8) {
      var n = Math.ceil(ui.countdown);
      ctx.textAlign = "center"; ctx.font = "bold 64px sans-serif";
      ctx.fillStyle = ui.countdown > 0 ? "#ffd84d" : "#5dff8a";
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 5;
      var txt = ui.countdown > 0 ? String(clamp(n, 1, 3)) : "GO!";
      ctx.strokeText(txt, f.w / 2, f.h * 0.45); ctx.fillText(txt, f.w / 2, f.h * 0.45);
    }
    var fl = ui.flash && performance.now() < ui.flash.until ? ui.flash : null;
    if (fl) {
      var age = 1 - (ui.flash.until - performance.now()) / 1600;
      ctx.save();
      ctx.textAlign = "center"; ctx.font = "italic bold " + Math.round(26 + 8 * Math.max(0, 0.3 - age) / 0.3) + "px sans-serif";
      ctx.lineWidth = 5; ctx.strokeStyle = "rgba(0,0,0,0.75)"; ctx.fillStyle = "#fff";
      ctx.strokeText(fl.text, f.w / 2, f.h * 0.62); ctx.fillText(fl.text, f.w / 2, f.h * 0.62);
      ctx.fillStyle = fl.color; ctx.fillRect(f.w / 2 - 60, f.h * 0.62 + 8, 120, 4);
      ctx.restore();
    }
    var fh = ui.finHold && performance.now() < ui.finHold.until ? ui.finHold : null;
    if (fh) {
      var fcar = race.cars[fh.id];
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, f.h * 0.36, f.w, 64);
      // 格子旗條紋
      for (var cxk = 0; cxk < f.w; cxk += 12) for (var cyk = 0; cyk < 2; cyk++) {
        ctx.fillStyle = (cxk / 12 + cyk) % 2 ? "#111" : "#fff";
        ctx.fillRect(cxk, f.h * 0.36 + (cyk ? 58 : 0), 12, 6);
      }
      ctx.textAlign = "center"; ctx.fillStyle = "#ffd84d"; ctx.font = "bold 26px sans-serif";
      ctx.fillText("🏁 FINISH  P" + fh.pos, f.w / 2, f.h * 0.36 + 32);
      ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif";
      ctx.fillText(fcar.name + " · " + fmtTime(fcar.finT), f.w / 2, f.h * 0.36 + 51);
      ctx.restore();
    }
    if (race.done) {
      ctx.textAlign = "center"; ctx.font = "bold 30px sans-serif"; ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 4;
      ctx.strokeText(t("dv_race_over"), f.w / 2, f.h * 0.45); ctx.fillText(t("dv_race_over"), f.w / 2, f.h * 0.45);
    }
  }

  // ---------------- 5. 結果 ----------------
  function renderResult() {
    var res = ui.result || [];
    var fin = res.filter(function (r) { return r.state === "fin"; });
    var pod = el("div", { class: "dv-podium" }, [1, 0, 2].map(function (k) {
      var r = fin[k];
      if (!r) return el("div", { class: "dv-pod dv-pod-empty dv-pod-" + (k + 1) }, []);
      return el("div", { class: "dv-pod dv-pod-" + (k + 1) }, [
        el("div", { class: "dv-medal" }, [["🥇", "🥈", "🥉"][k]]),
        el("i", { class: "dv-carswatch", style: "background:" + r.color }, []),
        el("b", {}, [r.name]),
        el("span", { class: "dv-small" }, [r.car]),
        el("span", { class: "dv-time" }, [fmtTime(r.time)]),
        el("div", { class: "dv-step-block" }, [String(k + 1)])
      ]);
    }));
    var tbl = el("table", { class: "dv-results" }, [
      el("thead", {}, [el("tr", {}, ["dv_r_pos", "dv_r_name", "dv_r_car", "dv_r_time", "dv_r_gap", "dv_r_max", "dv_r_drift", "dv_r_spin", "dv_r_pass"].map(function (k) { return el("th", {}, [t(k)]); }))]),
      el("tbody", {}, res.map(function (r) {
        return el("tr", { class: r.state === "dnf" ? "dv-dnf" : "" }, [
          el("td", {}, [r.state === "fin" ? String(r.pos) : "—"]),
          el("td", {}, [el("i", { class: "dv-dot", style: "background:" + r.color }, []), r.name]),
          el("td", {}, [r.car]),
          el("td", {}, [r.state === "fin" ? fmtTime(r.time) : t(r.dnf === "time" ? "dv_dnf_time" : "dv_dnf") + "（" + (r.dist / 1000).toFixed(2) + " km）"]),
          el("td", {}, [r.gap ? "+" + r.gap.toFixed(2) : ""]),
          el("td", {}, [r.maxKmh + " km/h"]),
          el("td", {}, [String(r.drifts)]),
          el("td", {}, [String(r.spins)]),
          el("td", {}, [String(r.overtakes)])
        ]);
      }))
    ]);
    app.appendChild(el("div", { class: "dv-panel" }, [
      el("h2", {}, [courseName() + " · " + SEASON_ICON[setup.season] + " " + L(D.SEASONS[setup.season].name) + " · " + t("dv_mode_" + setup.mode) +
        (ui.race && ui.race.wild ? " · " + t("dv_rule_wild") : "")]),
      fin.length ? pod : el("p", {}, [t("dv_nobody")]),
      el("div", { class: "dv-scroll" }, [tbl])
    ]));
    var hl = renderHighlights();
    if (hl) app.appendChild(hl);
    app.appendChild(el("div", { class: "dv-actions dv-next" }, [
      btn(t("dv_dejavu"), function () { startRace(ui.raceSeed, ui.lastLog); }, "", false),
      btn(t("dv_rematch"), function () { setup.seed = newSeed(); save(); startRace(setup.seed); }, "dv-primary"),
      btn(t("dv_to_garage"), function () { go("garage"); }),
      btn(t("dv_to_course"), function () { go("course"); })
    ]));
    app.appendChild(el("p", { class: "dv-muted dv-right" }, [t("dv_dejavu_desc")]));
  }

  // ---------------- 精彩重播（結果畫面）：精華逐段播放、整場轉播重播 ----------------
  function stopHl() { if (ui.hl && ui.hl.raf) cancelAnimationFrame(ui.hl.raf); ui.hl = null; }
  function hlLoop(cv, onDone) {
    var last = 0;
    function frame(ts) {
      var hl = ui.hl;
      if (!hl || !cv.isConnected) return;
      var dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
      last = ts;
      var f = fitCanvas(cv);
      if (!replayStep(hl.rp, dt)) {
        if (!onDone()) { hlCard(f, "🏁 " + t("dv_hl_end")); ui.hl = null; return; }
      }
      try { replayDraw(hl.rp, f, dt, true); } catch (err) { if (!ui.drawErr) { ui.drawErr = true; console.error(err); } ui.hl = null; return; }
      hl.raf = requestAnimationFrame(frame);
    }
    ui.hl.raf = requestAnimationFrame(frame);
  }
  function hlCard(f, text, sub) {
    var ctx = f.ctx;
    var g = ctx.createLinearGradient(0, 0, f.w, f.h);
    g.addColorStop(0, "#14161c"); g.addColorStop(1, "#3a1a10");
    ctx.fillStyle = g; ctx.fillRect(0, 0, f.w, f.h);
    ctx.fillStyle = "#d4380d"; ctx.fillRect(0, f.h * 0.5 + 26, f.w, 4);
    ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "italic bold " + Math.round(Math.min(34, f.w / 14)) + "px sans-serif";
    ctx.fillText(text, f.w / 2, f.h * 0.5);
    if (sub) { ctx.font = "14px sans-serif"; ctx.fillStyle = "#cfd6dd"; ctx.fillText(sub, f.w / 2, f.h * 0.5 + 54); }
  }
  function hlStart(rp, cv, queue) {
    stopHl();
    rp.lock = ui.hlCam || null; rp.mul = ui.hlMul || 1;
    ui.hl = { rp: rp, queue: queue || [], raf: 0 };
    hlLoop(cv, function () {
      var hl = ui.hl;
      if (!hl || !hl.queue.length) return false;
      var h = hl.queue.shift();
      ui.hlSel = h;
      hl.rp = newReplay(h, false); hl.rp.lock = ui.hlCam || null; hl.rp.mul = ui.hlMul || 1;
      markHl();
      return true;
    });
  }
  function markHl() {
    Array.prototype.forEach.call(document.querySelectorAll(".dv-hl-item"), function (b) { b.classList.toggle("dv-on", !!ui.hlSel && b.getAttribute("data-t") === String(ui.hlSel.t)); });
  }
  function renderHighlights() {
    var race = ui.race;
    if (!Tv || !race || !race.done || !ui.rec || !ui.rec.t.length) return null;
    var list = Tv.highlights(race, 10);
    var cv = el("canvas", { class: "dv-hl-cv" }, []);
    function playOne(h) { ui.hlSel = h; markHl(); hlStart(newReplay(h, false), cv, []); }
    var speeds = el("div", { class: "dv-choice" }, ["0.5", "1", "2", "4"].map(function (id) {
      return btn(id + "×", function (e) {
        ui.hlMul = Number(id);
        if (ui.hl) ui.hl.rp.mul = ui.hlMul;
        Array.prototype.forEach.call(speeds.children, function (b) { b.classList.toggle("dv-on", b === e.target); });
      }, Number(id) === (ui.hlMul || 1) ? "dv-on" : "");
    }));
    var box = el("div", { class: "dv-panel dv-hl" }, [
      el("h3", {}, ["📺 " + t("dv_hl_title")]),
      el("p", { class: "dv-muted dv-small" }, [t("dv_hl_desc")]),
      cv,
      el("div", { class: "dv-actions" }, [
        btn("▶ " + t("dv_hl_play_all", { n: list.length }), function () {
          var q = list.slice(), h = q.shift();
          ui.hlSel = h; markHl();
          hlStart(newReplay(h, false), cv, q);
        }, "dv-primary", !list.length),
        btn("📺 " + t("dv_hl_full"), function () {
          ui.hlSel = null; markHl();
          hlStart({ plan: [{ kind: "director", from: 0, to: race.t, speed: 1 }], i: 0, clock: null, st: {}, ghost: null, cutAt: performance.now(), caption: "" }, cv, []);
        }),
        btn("⏹", function () { stopHl(); hlCard(fitCanvas(cv), "📺 " + t("dv_hl_title")); }, "dv-step"),
        el("label", { class: "dv-small" }, [t("dv_hl_cam") + " ", el("select", {
          class: "dv-hl-cam", onchange: function (e) { ui.hlCam = e.target.value || null; if (ui.hl) { ui.hl.rp.lock = ui.hlCam; ui.hl.rp.st = {}; ui.hl.rp.dir = {}; } }
        }, [""].concat(Tv.KINDS).map(function (k) { return el("option", { value: k, selected: (ui.hlCam || "") === k }, [k ? t("dv_tvcam_" + k) : t("dv_tv_auto")]); }))]),
        speeds
      ])
    ]);
    if (!list.length) box.appendChild(el("p", { class: "dv-muted" }, [t("dv_hl_none")]));
    box.appendChild(el("div", { class: "dv-hl-list" }, list.map(function (h) {
      var c = race.cars[h.car];
      return el("button", { type: "button", class: "dv-hl-item", "data-t": String(h.t), onclick: function () { playOne(h); } }, [
        el("i", { class: "dv-dot", style: "background:" + c.color }, []),
        el("small", {}, [fmtTime(h.t)]), " " + Tv.caption(race, h)
      ]);
    })));
    requestAnimationFrame(function () { if (cv.isConnected && !ui.hl) hlCard(fitCanvas(cv), "📺 " + t("dv_hl_title"), t("dv_hl_count", { n: list.length })); });
    return box;
  }

  window.addEventListener("i18n:change", function () { if (ui.screen === "race") { renderCtrl(); } else render(); });
  window.addEventListener("resize", function () { if (ui.screen === "course") render(); });

  // 測試用
  window.PriTestDejavu = {
    setup: function () { return JSON.parse(JSON.stringify(setup)); },
    ui: function () {
      return { screen: ui.screen, tab: ui.tab, courseTab: ui.courseTab, follow: ui.follow, replay: !!(ui.rp && ui.race && ui.race.t >= ui.rp.t1),
        final: !!ui.final, finHold: ui.finHold ? ui.finHold.id : null, recFrames: ui.rec ? ui.rec.t.length : 0 };
    },
    race: function () { return ui.race; },
    scene: function () {
      var sc = scenery(previewTrack()), k = {};
      sc.decor.forEach(function (d) { k[d.kind] = (k[d.kind] || 0) + 1; });
      return { region: sc.region, decor: k, snowWall: !!sc.snowWall, shoulder: sc.shoulder, trees: sc.trees.length, city: sc.city ? sc.city.lots.length : 0 };
    },
    tv: function () { return { kind: ui.tvD && ui.tvD.kind, focus: ui.tvD && ui.tvD.focus, replay: !!ui.tvRp, pend: !!ui.tvPend, hl: !!ui.hl, hlSeg: ui.hl ? ui.hl.rp.i : null }; },

    result: function () { return ui.result; },
    go: go
  };

  render();
})();
