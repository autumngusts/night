// DÉJÀ VU 山道下坡（dejavu）：賽道生成與物理模擬（純邏輯，不碰 DOM；node 也能跑，見 tools/dejavu_check/core_check.js）。
//
// 賽道：路段清單（直線 S／彎道 C）→ 每 DS 公尺取樣一點（座標、航向、曲率、坡度、路面抓地）。
//   曲率先做移動平均（相當於緩和曲線），再積分出座標。前面自動加一段發車區直線，終點後加一段緩衝區。
// 車：質點模型。彎道極限 v² · |k| ≤ μ ·（g＋下壓力/m）；縱向用摩擦圓與彎道分抓地。
//   車手在開賽前依「自己以為的路面抓地 × 風格的極限比例 ×（1＋每個彎的失誤）」算出目標速度曲線，
//   再由後往前推出煞車點。實際行駛時若橫向需求超過抓地就滑動（甩尾，掉速度），超過「救得回來的極限」就打滑失控
//   （撞護欄、累積損傷，損傷到 100 就退賽）。
// 同時出發（battle）時有跟車／超車：前車擋路時只有在路夠寬、前方是直線、自己比較快時才有機會超過去；
//   計時賽（attack）各車互不干擾。
// 整場模擬只用 race.seed 的亂數，同樣的設定＋同樣的 seed 一定跑出同樣的結果（「Déjà vu」重播）。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestDejavuData;

  var G = 9.81;
  var RHO_HALF = 0.6;        // ½ρ（空氣密度 1.2）
  var ROLL = 0.15;           // 滾動阻力（m/s²）
  var DS = 2;                // 取樣間距（m）
  var DT = 1 / 30;           // 模擬固定步長（秒）
  var CAR_LEN = 4.5;
  var GRID_LEN = 120;        // 發車區（最多 12 台單列排隊）
  var RUNOFF = 180;          // 終點後緩衝區
  var GRID_GAP = 9;
  var WET_MU = 0.78;
  var DNF_DAMAGE = 100;

  // ---------------- 亂數 ----------------
  function rng(seed) {
    var s = seed | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {
    var u = Math.max(1e-9, r()), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  // ---------------- 路段 ----------------
  // 資料格式 ["S", len, g?, sf?] / ["C", ang, r, g?, sf?] → { t, len, ang, r, g, sf? }
  //   g＝null 表示用整條路的預設坡度；sf＝特殊路面（D.SURFACES：gravel 碎石、gutter 溝落、tunnel 隧道、bridge 橋）
  function parseSeg(a) {
    var s = a[0] === "S" ? { t: "S", len: a[1], g: a.length > 2 ? a[2] : null } : { t: "C", ang: a[1], r: a[2], g: a.length > 3 ? a[3] : null };
    var sf = a[0] === "S" ? a[3] : a[4];
    if (sf && D.SURFACES[sf]) s.sf = sf;
    if (s.g === undefined) s.g = null;
    return s;
  }
  function segLen(s) { return s.t === "S" ? s.len : Math.abs(s.ang) * Math.PI / 180 * s.r; }
  function courseLen(course) { return course.segs.reduce(function (n, s) { return n + segLen(s); }, 0); }

  function fixedCourse(id) {
    var c = D.course(id);
    if (!c) return null;
    return { src: id, w: c.w, g: c.g, scene: c.scene || "mountain", water: c.water || 0, segs: c.segs.map(parseSeg) };
  }

  // 一塊零件展開成路段；side＝1 左、-1 右；grade＝null 用預設坡度（零件自己寫死坡度的段，例如盲坡，維持原樣）
  function expandPiece(id, side, grade) {
    var p = D.piece(id);
    if (!p) return [];
    return p.segs.map(function (a) {
      var s = parseSeg(a);
      if (s.t === "C") s.ang *= side;
      if (s.g === null) s.g = grade === undefined ? null : grade;
      return s;
    });
  }

  function cleanSeg(s) {
    var o = { t: s.t === "C" ? "C" : "S", g: s.g === null || s.g === undefined || s.g === "" ? null : clamp(Number(s.g) || 0, -15, 15) };
    if (o.t === "S") o.len = clamp(Math.round(Number(s.len) || 0), 10, 1000);
    else { o.ang = clamp(Math.round(Number(s.ang) || 0), -180, 180) || 30; o.r = clamp(Math.round(Number(s.r) || 0), 10, 400); }
    if (s.sf && D.SURFACES[s.sf]) o.sf = s.sf;
    return o;
  }
  function cleanCourse(c) {
    c = c || {};
    return {
      src: typeof c.src === "string" ? c.src : "custom",
      w: clamp(Number(c.w) || 6.5, 5, 10),
      g: clamp(Number(c.g) || 0, 0, 15),
      scene: c.scene === "lake" || c.scene === "sea" ? c.scene : "mountain",
      water: c.water === 1 || c.water === -1 ? c.water : 0,
      segs: (c.segs || []).slice(0, 600).map(cleanSeg)
    };
  }

  // ---------------- 取樣 ----------------
  function smooth(arr, half) {
    var n = arr.length, out = new Array(n), sum = 0, cnt = 0, i;
    // 滑動視窗平均
    var lo = 0, hi = -1;
    for (i = 0; i < n; i++) {
      while (hi < Math.min(n - 1, i + half)) { hi++; sum += arr[hi]; cnt++; }
      while (lo < i - half) { sum -= arr[lo]; lo++; cnt--; }
      out[i] = sum / cnt;
    }
    return out;
  }

  // opts：{ season, dir: "down"|"up", seed, rain?（true／false，省略＝依季節機率用 seed 決定） }
  function buildTrack(course, opts) {
    opts = opts || {};
    var season = D.SEASONS[opts.season] || D.SEASONS.summer;
    var dirSign = opts.dir === "up" ? -1 : 1;
    var segs = [{ t: "S", len: GRID_LEN, g: 0 }].concat(course.segs, [{ t: "S", len: RUNOFF, g: 0 }]);
    var kRaw = [], gRaw = [], segOf = [], spRaw = [];
    segs.forEach(function (s, si) {
      var n = Math.max(1, Math.round(segLen(s) / DS));
      var k = s.t === "S" ? 0 : (s.ang > 0 ? 1 : -1) / s.r;
      // 實際取樣後的角度要跟設定一致：用取樣數反推曲率
      if (s.t === "C") k = (s.ang * Math.PI / 180) / (n * DS);
      var g = s.g === null || s.g === undefined ? (si === 0 || si === segs.length - 1 ? 0 : course.g) : s.g;
      var sp = s.sf && D.SURFACES[s.sf] ? D.SURFACES[s.sf].code : 0;
      for (var j = 0; j < n; j++) { kRaw.push(k); gRaw.push(g); segOf.push(si - 1); spRaw.push(sp); }
    });
    var N = kRaw.length + 1;
    kRaw.push(0); gRaw.push(0); segOf.push(segs.length - 2); spRaw.push(0);
    var k = smooth(kRaw, 4);
    var gr = smooth(gRaw, 10);
    var x = new Array(N), y = new Array(N), z = new Array(N), h = new Array(N), sl = new Array(N);
    x[0] = 0; y[0] = 0; z[0] = 0; h[0] = Math.PI / 2;
    for (var i = 0; i < N; i++) {
      sl[i] = Math.sin(Math.atan(dirSign * gr[i] / 100));
      if (i + 1 < N) {
        var hm = h[i] + k[i] * DS / 2;
        x[i + 1] = x[i] + Math.cos(hm) * DS;
        y[i + 1] = y[i] + Math.sin(hm) * DS;
        h[i + 1] = h[i] + k[i] * DS;
        z[i + 1] = z[i] - sl[i] * DS;
      }
    }
    // 行車線：彎內側（左彎＝左側偏移為正），用大視窗平滑過的曲率
    var kw = smooth(k, 12);
    var w = course.w;
    var off = kw.map(function (v) { return clamp(v * 260, -(w / 2 - 1.2), w / 2 - 1.2); });

    // 路面：季節的落葉／結冰／下雨
    var r = rng((opts.seed | 0) ^ 0x51ed);
    var rain = opts.rain !== undefined ? !!opts.rain : r() < season.rain;
    var surf = new Array(N), i2;
    for (i2 = 0; i2 < N; i2++) surf[i2] = 1;
    var patches = [];
    var start = Math.round(GRID_LEN / DS), finish = N - 1 - Math.round(RUNOFF / DS);
    var km = (finish - start) * DS / 1000;
    function addPatches(perKm, kind, mul, minLen, maxLen) {
      var cnt = Math.round(perKm * km * (0.7 + r() * 0.6));
      for (var p = 0; p < cnt; p++) {
        var a = start + Math.floor(r() * (finish - start));
        var len = Math.round((minLen + r() * (maxLen - minLen)) / DS);
        var b = Math.min(finish, a + len);
        for (var q = a; q <= b; q++) surf[q] = Math.min(surf[q], mul);
        patches.push({ a: a, b: b, kind: kind });
      }
    }
    if (season.leaf) addPatches(season.leaf, "leaf", 0.8, 25, 80);
    if (season.ice) addPatches(season.ice, "ice", 0.62, 20, 60);
    if (rain) addPatches(1.5, "puddle", 0.82, 10, 30);
    // 特殊路面：碎石固定打折、溝落（髮夾內側的排水溝）抓地加成、橋在冬天先結冰；隧道裡沒有雨雪、落葉
    var sfList = D.SURFACE_IDS.map(function (id) { return D.SURFACES[id]; });
    for (i2 = 0; i2 < N; i2++) {
      if (!spRaw[i2]) continue;
      var info = sfList[spRaw[i2] - 1];
      if (info.dry) surf[i2] = (rain ? 1 / WET_MU : 1) * (opts.season === "winter" ? info.dry : 1);
      else surf[i2] *= info.mu * (opts.season === "winter" && info.winter ? info.winter : 1);
    }
    patches = patches.filter(function (p) { return !(spRaw[p.a] && sfList[spRaw[p.a] - 1].dry); });

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (i2 = 0; i2 < N; i2++) {
      if (x[i2] < minX) minX = x[i2]; if (x[i2] > maxX) maxX = x[i2];
      if (y[i2] < minY) minY = y[i2]; if (y[i2] > maxY) maxY = y[i2];
      if (z[i2] < minZ) minZ = z[i2]; if (z[i2] > maxZ) maxZ = z[i2];
    }
    return {
      N: N, ds: DS, x: x, y: y, z: z, h: h, k: k, sl: sl, off: off, surf: surf, segOf: segOf, patches: patches, sp: spRaw,
      w: w, start: start * DS, finish: finish * DS, L: (N - 1) * DS, rain: rain, season: opts.season || "summer",
      scene: course.scene || "mountain", water: course.water || 0,
      bbox: { minX: minX, minY: minY, maxX: maxX, maxY: maxY, minZ: minZ, maxZ: maxZ }
    };
  }

  // 統計：長度、彎數、髮夾彎數、高低差、交叉（路面重疊）處
  function trackInfo(tr) {
    var corners = 0, hairpins = 0, inC = false, turn = 0, i;
    for (i = 0; i < tr.N; i++) {
      var on = Math.abs(tr.k[i]) > 1 / 250;
      if (on && !inC) { corners++; turn = 0; }
      if (on) turn += tr.k[i] * DS;
      if (!on && inC && Math.abs(turn) > 2.6) hairpins++;
      inC = on;
    }
    // 交叉：粗略取樣，距離太近且在路線上相隔很遠
    var cross = 0, step = 5, lim = tr.w + 2;
    for (i = 0; i < tr.N; i += step) {
      for (var j = i + 60; j < tr.N; j += step) {
        var dx = tr.x[i] - tr.x[j], dy = tr.y[i] - tr.y[j];
        if (dx * dx + dy * dy < lim * lim) { cross++; i += 30; break; }
      }
    }
    return {
      len: tr.finish - tr.start, corners: corners, hairpins: hairpins, drop: tr.z[Math.round(tr.start / DS)] - tr.z[Math.round(tr.finish / DS)],
      cross: cross
    };
  }

  // ---------------- 隨機山路 ----------------
  var PIECE_WEIGHT = { straight_s: 4, straight_l: 2, sweep: 3, medium: 3, tight: 3, hairpin: 2, s_curve: 2, double_hairpin: 1,
    kink: 2, long_sweep: 1, hairpin_wide: 1, chicane: 1, decreasing: 1, increasing: 1, esses: 1, triple_hairpin: 0.4,
    crest: 1, dip: 0.6, dive: 0.8, gutter_hairpin: 0.8, gravel: 0.4, gravel_corner: 0.4, tunnel: 0.6, tunnel_curve: 0.5, bridge: 0.6,
    snake: 0.6, fishhook: 0.8, carousel: 0.6, double_apex: 0.8, switchback: 0.3, cliff_run: 0.6 };
  function randomPiece(r) {
    var ids = Object.keys(PIECE_WEIGHT), tot = 0, i;
    for (i = 0; i < ids.length; i++) tot += PIECE_WEIGHT[ids[i]];
    var x = r() * tot;
    for (i = 0; i < ids.length; i++) { x -= PIECE_WEIGHT[ids[i]]; if (x < 0) return ids[i]; }
    return ids[0];
  }
  // 從 segs 接著隨機加零件到 targetLen（盡量不重疊）
  function randomFill(course, seed, targetLen) {
    var r = rng(seed);
    var segs = course.segs.slice();
    var base = { src: course.src, w: course.w, g: course.g, segs: segs };
    var guard = 0;
    while (courseLen(base) < targetLen && guard++ < 200) {
      var best = null;
      for (var tries = 0; tries < 6; tries++) {
        var g = D.GRADES[Math.floor(r() * D.GRADES.length)];
        var cand = expandPiece(randomPiece(r), r() < 0.5 ? 1 : -1, r() < 0.6 ? null : g);
        var test = { w: base.w, g: base.g, segs: segs.concat(cand) };
        var cross = trackInfo(buildTrack(test, { seed: 1, season: "summer", rain: false })).cross;
        if (!best || cross < best.cross) best = { segs: cand, cross: cross };
        if (cross === 0) break;
      }
      segs = segs.concat(best.segs);
      base.segs = segs;
    }
    return base;
  }
  function randomCourse(seed, targetLen) {
    var r = rng(seed);
    var w = [5.5, 6, 6.5, 7, 8][Math.floor(r() * 5)];
    var start = { src: "random", w: w, g: 5 + Math.floor(r() * 5), segs: [{ t: "S", len: 150, g: null }] };
    return randomFill(start, seed ^ 0x9e37, targetLen || 3200);
  }

  // ---------------- 組合技 ----------------
  // 一塊零件（一段 segs）的特徵標籤：hp 髮夾、ls 長直線、cr 起伏（盲坡／急降）、sn 連續小彎、gv 碎石、tn 隧道、br 橋、sp 螺旋、fa 高速彎
  function pieceTags(segs) {
    var tags = {}, flips = 0, last = 0;
    segs.forEach(function (s) {
      if (s.t === "S" && s.len >= 240) tags.ls = 1;
      if (s.t === "C") {
        var a = Math.abs(s.ang);
        if (a >= 150 && s.r <= 35) tags.hp = 1;
        if (a >= 300) tags.sp = 1;
        if (s.r >= 100 && a >= 30) tags.fa = 1;
        if (a <= 75 && s.r >= 20) {
          var sg = s.ang > 0 ? 1 : -1;
          if (last && sg !== last) flips++;
          last = sg;
        }
      }
      if (s.g !== null && s.g !== undefined && (s.g >= 12 || s.g < 0)) tags.cr = 1;
      if (s.sf === "gravel") tags.gv = 1;
      if (s.sf === "tunnel") tags.tn = 1;
      if (s.sf === "bridge") tags.br = 1;
    });
    if (flips >= 2) tags.sn = 1;
    return tags;
  }
  // pieces：建造紀錄 [{ o, n }]（依序、每塊佔 n 段），course.segs 前面可能有起始直線
  // 回傳 [{ id, by: [玩家索引…], at: 第幾塊 }]，每個組合技在每個位置成立一次
  function findCombos(course, pieces) {
    var segs = course.segs, end = segs.length, list = [];
    for (var i = pieces.length - 1; i >= 0; i--) {
      var a = end - pieces[i].n;
      list.unshift({ o: pieces[i].o, tags: pieceTags(segs.slice(Math.max(0, a), end)) });
      end = a;
    }
    var out = [];
    D.COMBOS.forEach(function (cb) {
      for (var i = 0; i + cb.seq.length <= list.length; i++) {
        var hit = true, by = [];
        for (var j = 0; j < cb.seq.length; j++) {
          if (!list[i + j].tags[cb.seq[j]]) { hit = false; break; }
          if (by.indexOf(list[i + j].o) < 0) by.push(list[i + j].o);
        }
        if (hit) { out.push({ id: cb.id, by: by, at: i + cb.seq.length - 1 }); i += cb.seq.length - 1; }
      }
    });
    out.sort(function (x, y) { return x.at - y.at; });
    return out;
  }

  // ---------------- 車 ----------------
  // spec：{ car: id, custom?: { drive, kw, kg, grip, brk, hdl, vmax }, tire, aero(0–5), gear(-2–2), style, up: { eng, wt, brk, hdl } }
  function cleanSpec(sp) {
    sp = sp || {};
    var o = {
      car: sp.car === "custom" || D.car(sp.car) ? sp.car : "ae86",
      tire: D.TIRES[sp.tire] ? sp.tire : "sport",
      aero: clamp(Math.round(Number(sp.aero) || 0), 0, 5),
      gear: clamp(Math.round(Number(sp.gear) || 0), -2, 2),
      style: D.STYLES[sp.style] ? sp.style : "balanced",
      up: {}
    };
    var used = 0;
    D.UPGRADES.forEach(function (u) {
      var v = clamp(Math.round(Number(sp.up && sp.up[u]) || 0), 0, D.UPGRADE_MAX);
      if (used + v > D.UPGRADE_POINTS) v = D.UPGRADE_POINTS - used;
      used += v;
      o.up[u] = v;
    });
    if (o.car === "custom") {
      var b = D.CUSTOM.base, rg = D.CUSTOM.range, cu = sp.custom || {};
      o.custom = { drive: D.DRIVE_INFO[cu.drive] ? cu.drive : b.drive };
      Object.keys(rg).forEach(function (key) {
        var v = Number(cu[key]);
        o.custom[key] = clamp(isFinite(v) && cu[key] !== null && cu[key] !== "" ? v : b[key], rg[key][0], rg[key][1]);
      });
    }
    return o;
  }

  function carStats(spec) {
    spec = cleanSpec(spec);
    var base = spec.car === "custom" ? D.CUSTOM.base : D.car(spec.car);
    var b = {};
    Object.keys(base).forEach(function (k) { b[k] = base[k]; });
    if (spec.car === "custom") Object.keys(spec.custom).forEach(function (k) { b[k] = spec.custom[k]; });
    var up = spec.car === "custom" ? { eng: 0, wt: 0, brk: 0, hdl: 0 } : spec.up;
    var st = {
      name: b.name, brand: b.brand, drive: b.drive, ev: !!b.ev,
      kw: b.kw * (1 + 0.06 * up.eng),
      m: b.kg * (1 - 0.03 * up.wt),
      grip: b.grip,
      brk: b.brk * (1 + 0.04 * up.brk),
      hdl: b.hdl * (1 + 0.04 * up.hdl),
      cda: b.cda + 0.035 * spec.aero,
      cla: b.cla + 0.18 * spec.aero,
      vmax: b.vmax
    };
    st.P = st.kw * 1000;
    // 輪胎負荷敏感度：車越重，每公斤分到的抓地越少（輕量車在山路的優勢）；重車下坡煞車也比較吃力
    st.load = Math.pow(1250 / st.m, 0.15);
    st.brk *= Math.pow(1250 / st.m, 0.1);
    st.vcap = st.vmax / 3.6 * (1 + 0.05 * spec.gear);
    // 引擎：低轉出力打折，短齒比（gear 負）較早拿到全出力
    st.vpk = 26 * (1 + 0.12 * spec.gear);
    // 實際極速＝馬力推得動空阻的速度與齒比上限取小
    st.vtop = Math.min(st.vcap, Math.pow(st.P / (RHO_HALF * st.cda), 1 / 3));
    st.pw = st.kw / st.m;
    st.pi = Math.round(1000 * (0.5 * Math.min(1, st.pw / 0.35) + 0.25 * clamp((st.grip - 0.85) / 0.35, 0, 1) +
      0.12 * clamp((st.brk - 0.85) / 0.4, 0, 1) + 0.13 * clamp((st.hdl - 0.8) / 0.5, 0, 1)) + spec.aero * 6);
    return st;
  }

  // ---------------- 比賽 ----------------
  // opts：{ course, season, dir, mode: "battle"|"attack", seed, cars: [{ spec, name, color, cpu }] }
  function createRace(opts) {
    var seed = opts.seed | 0;
    var course = cleanCourse(opts.course);
    var season = D.SEASONS[opts.season] ? opts.season : "summer";
    var tr = buildTrack(course, { season: season, dir: opts.dir, seed: seed });
    var r = rng(seed);
    var race = {
      seed: seed, season: season, mode: opts.mode === "attack" ? "attack" : "battle", dir: opts.dir === "up" ? "up" : "down",
      course: course, track: tr, t: 0, done: false, events: [], cars: [], rnd: r,
      baseMu: D.SEASONS[season].mu * (tr.rain ? WET_MU : 1),
      timeout: 60 + (tr.finish - tr.start) / 4,
      stepN: 0, log: [],
      // 重播用的戰略指令（Déjà vu：照原本的步數套用，結果就會一模一樣）
      pending: (opts.cmds || []).slice().sort(function (a, b) { return a.n - b.n; })
    };
    var n = opts.cars.length;
    // 發車順序：隨機（計時賽全部同一位置出發）
    var grid = [];
    for (var i = 0; i < n; i++) grid.push(i);
    for (i = n - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var tmp = grid[i]; grid[i] = grid[j]; grid[j] = tmp; }
    opts.cars.forEach(function (c, idx) {
      var spec = cleanSpec(c.spec);
      var st = carStats(spec);
      var tire = D.TIRES[spec.tire];
      var car = {
        id: idx, name: c.name || ("#" + (idx + 1)), color: c.color || D.COLORS[idx % D.COLORS.length], cpu: !!c.cpu,
        spec: spec, st: st, di: D.DRIVE_INFO[st.drive], style: D.STYLES[spec.style],
        tireMul: tire[season] * (tr.rain ? tire.wet : 1),
        grid: grid.indexOf(idx),
        s: race.mode === "attack" ? tr.start : tr.start - grid.indexOf(idx) * GRID_GAP,
        v: 0, d: 0, yaw: 0, spinDir: 1, stun: 0, slip: 0, dmg: 0, spins: 0, drifts: 0, drifting: false, overtakes: 0,
        state: "run", finT: null, dnf: null, maxV: 0, passing: null, side: 1, cap: Infinity, draft: false,
        styleId: spec.style, noise: cornerNoise(tr, r)
      };
      car.prof = buildProfile(race, car);
      race.cars.push(car);
    });
    return race;
  }

  function carMu(race, c, i, assumed) {
    var s = race.track.surf[i];
    if (assumed) s = 1 - 0.8 * (1 - s);   // 車手看得到路面，但只能預估八成
    var mu = race.baseMu * s * c.tireMul * c.st.grip * c.st.load;
    if (mu < 0.8) mu *= c.di.low;
    return mu;
  }

  // 每個彎的失誤（標準常態），開賽時抽好；乘上當下風格的 sigma 才是實際誤差——這樣比賽中換戰略不必再抽亂數，重播仍然一致
  function cornerNoise(tr, r) {
    var out = new Array(tr.N), err = 0, inC = false;
    for (var i = 0; i < tr.N; i++) {
      var on = Math.abs(tr.k[i]) > 1 / 250;
      if (on && !inC) err = gauss(r);
      inC = on;
      out[i] = on ? err : 0;
    }
    return out;
  }

  function setStyle(race, c, id) {
    if (!D.STYLES[id] || c.styleId === id) return false;
    c.styleId = id; c.style = D.STYLES[id];
    c.prof = buildProfile(race, c);
    return true;
  }

  // 玩家在比賽中下的戰略指令（記錄步數，Déjà vu 重播時照樣套用）
  function command(race, carId, styleId) {
    var c = race.cars[carId];
    if (!c || c.state !== "run" || !D.STYLES[styleId]) return false;
    if (!setStyle(race, c, styleId)) return false;
    race.log.push({ n: race.stepN, car: carId, style: styleId });
    event(race, c, "tactic", { style: styleId });
    return true;
  }

  // CPU 依局勢自己換戰略（只看比賽狀態，決定論）
  function cpuTactics(race) {
    var ord = order(race).filter(function (c) { return c.state === "run"; });
    ord.forEach(function (c, p) {
      if (!c.cpu) return;
      var want = "balanced";
      var ahead = p > 0 ? ord[p - 1] : null, behind = ord[p + 1];
      if (c.dmg >= 50) want = "calm";
      else if (race.mode === "battle" && behind && behind.s > c.s - 30) want = "defend";
      else if (ahead && ahead.s - c.s < 60) want = "attack";
      setStyle(race, c, want);
    });
  }

  function buildProfile(race, c) {
    var tr = race.track, st = c.st, N = tr.N;
    var season = D.SEASONS[race.season];
    var sigma = c.style.sigma / st.hdl * season.sigma * (tr.rain ? 1.25 : 1);
    var f = c.style.f;
    var q = RHO_HALF * st.cla / st.m;
    var vc = new Array(N), i;
    for (i = 0; i < N; i++) {
      var k = Math.abs(tr.k[i]);
      var on = k > 1 / 250;
      var err = c.noise[i] * sigma;
      var muL = carMu(race, c, i, true) * c.di.bal;
      var den = k - muL * q;
      var lim = den <= 1e-6 ? st.vtop : Math.sqrt(muL * G / den);
      vc[i] = lim >= st.vtop ? st.vtop : Math.min(st.vtop, lim * f * (on ? 1 + err : 1));
    }
    // 終點後慢慢停下
    var fin = Math.round(tr.finish / DS);
    for (i = fin + 1; i < N; i++) vc[i] = Math.min(vc[i], Math.max(0, (N - 1 - i) * 0.25));
    // 由後往前推煞車點（車手只敢用九成煞車力，且還要扣掉下坡重力）
    for (i = N - 2; i >= 0; i--) {
      var v1 = vc[i + 1];
      var mu = carMu(race, c, i, true);
      // 彎中還在用橫向抓地時，能拿來煞車的部分比較少（摩擦圓）
      var rr = Math.min(1, v1 * v1 * Math.abs(tr.k[i]) / (mu * c.di.bal * (G + q * v1 * v1)));
      var circ = Math.sqrt(Math.max(0.15, 1 - rr * rr));
      var dec = mu * st.brk * (G + q * v1 * v1) * 0.9 * f * circ + RHO_HALF * st.cda * v1 * v1 / st.m + ROLL - G * tr.sl[i];
      dec = Math.max(dec, 0.6);
      var vb = Math.sqrt(v1 * v1 + 2 * dec * DS);
      if (vb < vc[i]) vc[i] = vb;
    }
    return vc;
  }

  function idxAt(tr, s) { return clamp(Math.floor(s / DS), 0, tr.N - 1); }
  function profAt(c, tr, s) {
    var p = clamp(s / DS, 0, tr.N - 1), i = Math.floor(p), f = p - i;
    if (i >= tr.N - 1) return c.prof[tr.N - 1];
    return c.prof[i] * (1 - f) + c.prof[i + 1] * f;
  }
  function maxK(tr, s0, s1) {
    var a = idxAt(tr, s0), b = idxAt(tr, s1), m = 0;
    for (var i = a; i <= b; i++) { var k = Math.abs(tr.k[i]); if (k > m) m = k; }
    return m;
  }

  function event(race, c, type, extra) {
    var e = { t: Math.round(race.t * 10) / 10, car: c.id, type: type };
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    race.events.push(e);
  }

  function spin(race, c, v, r, kSign) {
    var sev = r - c.di.tol;
    var hit = v > 13 ? (v - 10) * 1.6 * (1 + sev * 4) : 0;
    c.dmg = Math.min(DNF_DAMAGE, c.dmg + 8 + hit);
    c.spins++;
    c.stun = 2.2 + Math.min(2, sev * 8);
    c.spinDir = kSign >= 0 ? 1 : -1;
    c.passing = null;
    event(race, c, "spin", { v: Math.round(v * 3.6) });
    if (c.dmg >= DNF_DAMAGE) {
      c.state = "dnf"; c.dnf = "crash";
      event(race, c, "dnf", { why: "crash" });
    }
    return v * 0.25;
  }

  // 同時出發：決定每台車這一步的速度上限（跟車）與超車
  function traffic(race, dt) {
    var tr = race.track, cars = race.cars;
    var active = cars.filter(function (c) { return c.state === "run" && c.stun <= 0; });
    cars.forEach(function (c) { c.cap = Infinity; c.draft = false; });
    if (race.mode !== "battle") return;
    active.forEach(function (c) {
      var ahead = null;
      active.forEach(function (a) { if (a !== c && a.s > c.s && (!ahead || a.s < ahead.s)) ahead = a; });
      if (!ahead) { c.passing = null; return; }
      var gap = ahead.s - c.s - CAR_LEN;
      if (c.passing !== null && c.passing !== ahead.id) c.passing = null;
      if (gap < 25 && maxK(tr, c.s, ahead.s) < 1 / 200) c.draft = true;
      if (c.passing === ahead.id) {
        if (maxK(tr, c.s, c.s + 25) > 1 / 60 && c.s < ahead.s - 1.5) c.passing = null; // 彎道到了還沒超過：放棄
        else return;
      }
      if (gap < 10 && c.v > ahead.v - 0.5) {
        var room = tr.w >= 6 && maxK(tr, c.s, c.s + 70) < 1 / 150;
        var faster = profAt(c, tr, c.s + 40) > ahead.v * 1.04 + 0.5;
        if (room && faster && race.rnd() < c.style.pass * ahead.style.block * dt * 2) {
          c.passing = ahead.id;
          c.side = (ahead.d > 0.3 ? -1 : ahead.d < -0.3 ? 1 : (race.rnd() < 0.5 ? 1 : -1));
          return;
        }
        c.cap = gap < 0 ? ahead.v - 1 : ahead.v + Math.max(0, gap - 3) * 0.6;
      }
    });
  }

  function stepCar(race, c, dt) {
    var tr = race.track, st = c.st;
    var i = idxAt(tr, c.s);
    var v = c.v;
    if (c.state === "dnf") {
      c.v = Math.max(0, v - 8 * dt); c.s = Math.min(tr.L, c.s + c.v * dt);
      c.d += ((tr.w / 2 + 1.5) * c.side - c.d) * Math.min(1, dt * 2);
      return;
    }
    var kS = tr.k[i], k = Math.abs(kS);
    var mu = carMu(race, c, i, false);
    var q = RHO_HALF * st.cla / st.m;
    var latMax = mu * c.di.bal * (G + q * v * v);
    var r = v * v * k / latMax;
    var drag = RHO_HALF * st.cda * v * v / st.m * (c.draft ? 0.8 : 1);
    var grav = G * tr.sl[i];
    var target = c.state === "fin" ? profAt(c, tr, c.s) : Math.min(profAt(c, tr, c.s), profAt(c, tr, c.s + v * 0.12), c.cap);
    var rc = Math.min(1, r);
    var circle = Math.sqrt(Math.max(0.15, 1 - rc * rc));
    var a;
    if (c.stun > 0) {
      c.stun -= dt;
      a = -6 + grav * 0.5;
      c.yaw += c.spinDir * 6 * dt * Math.min(1, c.stun);
    } else if (v < target - 0.05) {
      var pf = st.ev ? 1 : Math.min(1, 0.5 + 0.5 * v / st.vpk);
      var fp = st.P * pf / Math.max(v, 4);
      var ft = mu * c.di.share * st.m * (G + q * v * v);
      a = Math.min(fp, ft) / st.m * circle - drag - ROLL + grav;
      if (v >= st.vcap && a > 0) a = 0;
      if (a > 0 && v + a * dt > target) a = (target - v) / dt;
    } else {
      var maxB = mu * st.brk * (G + q * v * v) * circle;
      var need = (v - target) / dt + grav - drag - ROLL;
      a = -clamp(need, 0, maxB) - drag - ROLL + grav;
    }
    c.braking = a < -2.5 && c.stun <= 0;
    if (c.stun <= 0) c.yaw *= Math.max(0, 1 - dt * 3);
    v = Math.max(0, v + a * dt);
    // 橫向：滑動／打滑
    var slipT = 0;
    if (c.stun <= 0 && k > 0.002 && c.state === "run") {
      r = v * v * k / latMax;
      if (r > c.di.tol) v = spin(race, c, v, r, kS);
      else if (r > 1) {
        v = Math.max(0, v - ((r - 1) * 25 + 1.5) * dt);
        slipT = 1;
      } else if (r > 0.86 && k > 1 / 90) slipT = (r - 0.86) / 0.14;
      if (st.drive === "FF") slipT *= 0.35;
      else if (st.drive === "4WD") slipT *= 0.75;
    }
    c.slip += (slipT * (kS >= 0 ? 1 : -1) - c.slip) * Math.min(1, dt * 4);
    // 甩尾次數：滑動角超過門檻算一次，要回正到幾乎直行才會再算下一次（避免門檻附近來回跳動重複計數）
    var as = Math.abs(c.slip);
    if (!c.drifting && as > 0.55) { c.drifting = true; c.drifts++; }
    else if (c.drifting && as < 0.15) c.drifting = false;
    if (c.state === "dnf") return;
    // 橫向位置：超車時移到旁邊
    var dT = c.passing !== null ? c.side * (tr.w * 0.3) : c.state === "fin" ? (tr.w / 2 - 1.3) * c.side : 0;
    c.d += (dT - c.d) * Math.min(1, dt * 2.2);
    c.v = v;
    var s0 = c.s;
    c.s = Math.min(tr.L - 0.5, c.s + v * dt);
    if (c.s >= tr.L - 0.5) c.v = 0;
    if (v > c.maxV && c.state === "run") c.maxV = v;
    if (c.state === "run" && c.s >= tr.finish) {
      c.state = "fin";
      c.finT = race.t - dt + (tr.finish - s0) / Math.max(0.1, c.s - s0) * dt;
      c.passing = null;
      event(race, c, "fin");
    }
  }

  function step(race, dt) {
    if (race.done) return;
    dt = dt || DT;
    while (race.pending.length && race.pending[0].n <= race.stepN) {
      var cm = race.pending.shift();
      command(race, cm.car, cm.style);
    }
    if (race.stepN % 60 === 0) cpuTactics(race);
    race.stepN++;
    race.t += dt;
    traffic(race, dt);
    var prevOrder = race.mode === "battle" ? order(race).map(function (c) { return c.id; }) : null;
    race.cars.forEach(function (c) { stepCar(race, c, dt); });
    if (prevOrder) {
      var now = order(race).map(function (c) { return c.id; });
      now.forEach(function (id, p) {
        var was = prevOrder.indexOf(id);
        if (was > p) {
          var c = race.cars[id], passed = race.cars[prevOrder[p]];
          if (c.state === "run" && passed.state === "run" && passed.stun <= 0) { c.overtakes++; event(race, c, "pass", { other: passed.id }); }
        }
      });
    }
    if (race.t > race.timeout) {
      race.cars.forEach(function (c) { if (c.state === "run") { c.state = "dnf"; c.dnf = "time"; event(race, c, "dnf", { why: "time" }); } });
    }
    if (race.cars.every(function (c) { return c.state !== "run"; })) {
      if (race.endT === undefined) race.endT = race.t;
      // 全部抵達後再多跑兩秒讓車停下來
      if (race.t - race.endT > 2) race.done = true;
    }
  }

  // 目前名次：已完賽依時間、比賽中依位置、退賽墊底
  function order(race) {
    return race.cars.slice().sort(function (a, b) {
      var ra = a.state === "fin" ? 0 : a.state === "run" ? 1 : 2, rb = b.state === "fin" ? 0 : b.state === "run" ? 1 : 2;
      if (ra !== rb) return ra - rb;
      if (ra === 0) return a.finT - b.finT;
      return b.s - a.s;
    });
  }

  function runToEnd(race) {
    var guard = 0;
    while (!race.done && guard++ < 200000) step(race, DT);
    return race;
  }

  function results(race) {
    var lead = null;
    return order(race).map(function (c, i) {
      if (i === 0 && c.state === "fin") lead = c.finT;
      return {
        pos: i + 1, id: c.id, name: c.name, color: c.color, car: c.st.name, cpu: c.cpu, state: c.state,
        time: c.finT, gap: c.state === "fin" && lead !== null ? c.finT - lead : null, dnf: c.dnf,
        dist: Math.max(0, Math.min(c.s, race.track.finish) - race.track.start),
        maxKmh: Math.round(c.maxV * 3.6), spins: c.spins, drifts: c.drifts, overtakes: c.overtakes, dmg: Math.round(c.dmg)
      };
    });
  }

  // 畫面用：車在世界座標的位置與朝向
  function carPose(race, c) {
    var tr = race.track;
    var p = clamp(c.s / DS, 0, tr.N - 1.001), i = Math.floor(p), f = p - i;
    var x = tr.x[i] + (tr.x[i + 1] - tr.x[i]) * f, y = tr.y[i] + (tr.y[i + 1] - tr.y[i]) * f;
    var h = tr.h[i] + (tr.h[i + 1] - tr.h[i]) * f;
    var off = tr.off[i] + c.d;
    if (c.state === "fin" || c.state === "dnf") off = c.d;
    x += -Math.sin(h) * off; y += Math.cos(h) * off;
    return { x: x, y: y, h: h + c.slip * 0.42 + c.yaw, z: tr.z[i] };
  }

  root.PriTestDejavuCore = {
    DT: DT, DS: DS, CAR_LEN: CAR_LEN,
    rng: rng, parseSeg: parseSeg, pieceTags: pieceTags, findCombos: findCombos, segLen: segLen, courseLen: courseLen, fixedCourse: fixedCourse, expandPiece: expandPiece,
    cleanCourse: cleanCourse, cleanSeg: cleanSeg, buildTrack: buildTrack, trackInfo: trackInfo, randomCourse: randomCourse, randomFill: randomFill,
    cleanSpec: cleanSpec, carStats: carStats, createRace: createRace, command: command, step: step, order: order, runToEnd: runToEnd, results: results, carPose: carPose
  };
})();
