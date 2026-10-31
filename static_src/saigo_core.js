// 賽狗賽狗（saigo）：模擬核心——種子亂數、出賽表（場地／天氣／6 隻狗）、比賽模擬、賠率。不碰 DOM。
//
// 多裝置「跑出同一結果」的做法：出賽表與比賽全部由 seed 決定；模擬只用 + − × ÷ 與 Math.sqrt
// （IEEE 規定 sqrt 必須正確捨入，各瀏覽器結果一致），不用 sin／exp／pow，所以每台裝置算出的每一格都相同。
// 幾何（畫面用的路線形狀）才用三角函數，那只影響畫面、不影響名次。
//
// 比賽一開始就整場模擬完並記錄每一步（frames），畫面依時間內插播放；重播也只是再播一次。
(function () {
  "use strict";

  var D = window.PriTestSaigoData;
  var DT = 0.05;            // 模擬步長（秒）
  var MAX_T = 240;          // 最長秒數（超過算未完走）
  var LANE_W = 1.6;         // 每條跑道寬（m）
  var MODE = { run: 0, jump: 1, crawl: 2, swim: 3, catch: 4, eat: 5, sit: 6, weave: 7, stun: 8, climb: 9, mud: 10, fin: 11, wade: 12, dive: 13, wait: 14, loop: 15, slide: 16, ride: 17 };
  // 圓形通道：入口直線 LOOP_IN m，之後是一圈（沿跑道方向前進 LOOP_C m），畫面上的形狀在 saigo_3d.js
  var LOOP_IN = 6, LOOP_R = 1.6, LOOP_C = 10.05;   // LOOP_C ≈ 2π × LOOP_R

  // mulberry32：只用整數運算，各環境一致
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
  function hashStr(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h;
  }
  function newSeed() { return (Math.floor(Math.random() * 4294967296) >>> 0); }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function between(r, a, b) { return a + (b - a) * r(); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function weighted(r, table) {
    var keys = Object.keys(table), tot = 0, i;
    for (i = 0; i < keys.length; i++) tot += table[keys[i]];
    var x = r() * tot;
    for (i = 0; i < keys.length; i++) { x -= table[keys[i]]; if (x < 0) return keys[i]; }
    return keys[keys.length - 1];
  }

  // ---------------- 場地 ----------------
  // 依 seed 產生零件序列：起跑直道 → 關卡（數量依距離；中間穿插直道／彎道）→ 最後直線。
  // 關卡種類與變體（kind）依地形的權重抽；同一種關卡不連續出現。
  function makeCourse(r, terrainId, distId) {
    var T = D.TERRAINS[terrainId] || D.TERRAINS.park, dist = D.DISTANCES[distId] || D.DISTANCES.middle, sm = dist.straight;
    var parts = [];
    function add(type, len, extra) {
      var p = { type: type, len: Math.round(len) };
      Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
      parts.push(p);
    }
    function connector() {
      if (r() < 0.72) add("curve", between(r, 30, 70), { turn: Math.round(between(r, 40, 110)) * (r() < 0.5 ? -1 : 1) });
      else add("straight", between(r, 30, 70) * sm);
    }
    add("straight", between(r, 50, 90) * sm);
    var n = dist.parts[0] + Math.floor(r() * (dist.parts[1] - dist.parts[0] + 1)), last = "";
    for (var i = 0; i < n; i++) {
      var type;
      do { type = weighted(r, T.parts || D.PART_WEIGHTS); } while (type === last);
      last = type;
      var def = D.PARTS[type];
      var extra = {};
      if (T.kinds && T.kinds[type]) extra.kind = weighted(r, T.kinds[type]);
      else if (D.KINDS[type]) extra.kind = Object.keys(D.KINDS[type])[0];
      if (type === "hurdle") extra.bars = extra.kind === "log" || extra.kind === "snowbank" ? 2 + Math.floor(r() * 2) : 3 + Math.floor(r() * 3);
      if (type === "hill") extra.hh = Math.round(between(r, extra.kind === "dune" ? 2.5 : 1.8, extra.kind === "dune" ? 4.5 : 3.5) * 10) / 10;
      if (type === "hurdlerace") extra.bars = 6 + Math.floor(r() * 4);
      if (type === "firewheel") extra.rings = 2 + Math.floor(r() * 2);
      if (type === "wallkick") extra.kicks = 3 + Math.floor(r() * 2);
      if (type === "ditch") extra.dw = Math.round(between(r, 2.4, 3.4) * 10) / 10;
      add(type, between(r, def.len[0], def.len[1]), extra);
      if (r() < 0.2 && i < n - 1) add("straight", between(r, 60, 120) * sm);
      else connector();
    }
    add("straight", between(r, 80, 140) * sm);
    // 跨欄類每場至少一個（2026-10-29 使用者指定「跨欄出現機率極高」）：沒有抽到就把第一個關卡換成障礙跳高
    if (!parts.some(function (p) { return D.HURDLE_TYPES[p.type]; })) {
      var first = parts.filter(function (p) { return D.PARTS[p.type] && p.type !== "straight" && p.type !== "curve"; })[0];
      var hk = T.kinds && T.kinds.hurdle ? weighted(r, T.kinds.hurdle) : "bar";
      Object.keys(first).forEach(function (k) { if (k !== "len") delete first[k]; });
      first.type = "hurdle"; first.kind = hk; first.len = Math.round(between(r, D.PARTS.hurdle.len[0], D.PARTS.hurdle.len[1]));
      first.bars = hk === "log" || hk === "snowbank" ? 2 + Math.floor(r() * 2) : 3 + Math.floor(r() * 3);
    }
    // 彎道方向限制：車頭方向維持在 ±80° 內，整條路往同一方向前進就不會自己交叉
    var h = 0;
    parts.forEach(function (p) {
      if (p.type !== "curve") return;
      if (Math.abs(h + p.turn) > 80) p.turn = -p.turn;
      if (Math.abs(h + p.turn) > 80) p.turn = (h > 0 ? -1 : 1) * Math.min(Math.abs(p.turn), 80 - Math.abs(h) + 40);
      h += p.turn;
    });
    var s = 0;
    parts.forEach(function (p) { p.s0 = s; s += p.len; });
    return { parts: parts, length: s };
  }

  // 畫面用的路線幾何：每 1 m 一點（x, y, 方向 h）
  function geometry(course) {
    if (course._geo) return course._geo;
    var N = Math.ceil(course.length) + 2, x = new Float32Array(N), y = new Float32Array(N), hd = new Float32Array(N);
    var cx = 0, cy = 0, h = 0, i = 0;
    course.parts.forEach(function (p) {
      var dh = p.type === "curve" ? (p.turn * Math.PI / 180) / p.len : 0;
      for (var k = 0; k < p.len; k++) {
        if (i < N) { x[i] = cx; y[i] = cy; hd[i] = h; i++; }
        h += dh;
        cx += Math.cos(h); cy += Math.sin(h);
      }
    });
    for (; i < N; i++) { x[i] = cx; y[i] = cy; hd[i] = h; cx += Math.cos(h); cy += Math.sin(h); }
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (i = 0; i < N; i++) { minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]); minY = Math.min(minY, y[i]); maxY = Math.max(maxY, y[i]); }
    course._geo = { N: N, x: x, y: y, h: hd, box: [minX, minY, maxX, maxY] };
    return course._geo;
  }
  // 路上一點：s＝里程，off＝橫向（左正）
  function pointAt(course, s, off) {
    var g = geometry(course), p = clamp(s, 0, g.N - 1.001), i = Math.floor(p), f = p - i;
    var h = g.h[i] + (g.h[i + 1] - g.h[i]) * f;
    var x = g.x[i] + (g.x[i + 1] - g.x[i]) * f, y = g.y[i] + (g.y[i + 1] - g.y[i]) * f;
    return { x: x - Math.sin(h) * (off || 0), y: y + Math.cos(h) * (off || 0), h: h };
  }
  function partAt(course, s) {
    var ps = course.parts;
    for (var i = ps.length - 1; i >= 0; i--) if (s >= ps[i].s0) return ps[i];
    return ps[0];
  }
  function laneOff(gate) { return (2.5 - gate) * LANE_W; }

  // ---------------- 狗 ----------------
  // 實際上場的能力：犬種基礎＋訓練加成＋等級，乘上調子；天氣與場地另外修正
  function effStats(dog, weather, ground, terrain) {
    var b = D.BREED_BY_ID[dog.breed] || D.BREEDS[0], mood = D.MOODS[clamp(dog.mood | 0, 0, 4)].mult;
    var w = D.WEATHERS[weather] || D.WEATHERS.sunny, g = D.GROUNDS[ground] || D.GROUNDS.firm;
    var surf = (D.TERRAINS[terrain] || D.TERRAINS.park).surf;
    var out = {};
    D.STATS.forEach(function (k) {
      var v = b.base[k] + ((dog.train && dog.train[k]) || 0) + (dog.lv || 0) * 0.5;
      out[k] = v * mood;
    });
    var tol = w.temp > 0 ? b.heat : w.temp < 0 ? b.cold : 0;
    // 溫度越極端（暴風雪 −3）耐性影響越大
    var tk = Math.abs(w.temp) / 2;
    if (w.temp !== 0) { out.spd *= 1 + 0.035 * tol * tk; out.sta *= 1 + 0.05 * tol * tk; }
    if (weather === "windy") { out.cat *= 0.82; out.foc *= 0.93; }
    if (weather === "rain") { out.foc *= 0.96; }
    if (weather === "typhoon") { out.cat *= 0.65; out.foc *= 0.88; if (b.size <= 2) out.spd *= 0.95; }
    if (weather === "blizzard") { out.cat *= 0.85; out.foc *= 0.9; }
    if (weather === "sandstorm") { out.cat *= 0.8; out.foc *= 0.85; out.sta *= 0.95; }
    if (weather === "fog") { out.cat *= 0.9; out.foc *= 0.94; }
    // 雪地路面：耐寒的狗跑得順；沙地：耐熱的狗跑得順
    if (surf === "snow") out.spd *= 1 + 0.02 * b.cold;
    if (surf === "sand") out.spd *= 1 + 0.015 * b.heat;
    if (g.drag < 1 && b.size <= 2) out.pow *= 0.92;
    D.STATS.forEach(function (k) { out[k] = Math.round(clamp(out[k], 5, 140) * 10) / 10; });
    return out;
  }

  // entries：玩家帶來的狗 [{ breed, name, train, lv, mood(0–4 犬舍心情), fatigue, owner, dogId, ownerName }]
  // opts：{ cls, terrain?, weather?, dist?, ground? }（沒指定＝依 seed 隨機）
  function makeCard(seed, entries, opts) {
    opts = opts || {};
    var r = rng(seed ^ 0x5a1609);
    var cls = D.CLASSES.filter(function (c) { return c.id === opts.cls; })[0] || D.CLASSES[1];
    var terrain = D.TERRAINS[opts.terrain] ? opts.terrain : weighted(r, { park: 30, forest: 20, snowmtn: 17, desert: 16, beach: 17 });
    var TR = D.TERRAINS[terrain];
    var weather = D.WEATHERS[opts.weather] ? opts.weather : weighted(r, TR.weathers);
    var dist = D.DISTANCES[opts.dist] ? opts.dist : weighted(r, { sprint: D.DISTANCES.sprint.w, middle: D.DISTANCES.middle.w, long: D.DISTANCES.long.w });
    var wet = weather === "rain" || weather === "typhoon", cold = weather === "snow" || weather === "blizzard";
    var ground = opts.ground || (weather === "typhoon" ? pick(r, ["soft", "heavy", "heavy"]) : wet ? pick(r, ["good", "soft", "heavy"]) : cold ? pick(r, ["good", "soft"]) : weather === "hot" || weather === "sandstorm" ? "firm" : weighted(r, { firm: 70, good: 30 }));
    var course = makeCourse(r, terrain, dist);
    var dogs = [];
    (entries || []).slice(0, D.FIELD).forEach(function (e) {
      var m = clamp(e.mood === undefined ? 2 : e.mood | 0, 0, 4);
      var f = e.fatigue || 0;
      if (f > 85) m -= 2; else if (f > 60) m -= 1;
      var x = r();
      if (x < 0.15) m -= 1; else if (x > 0.85) m += 1;
      dogs.push({
        breed: e.breed, name: String(e.name || "").slice(0, 16), train: e.train || {}, lv: e.lv || 0, best: e.best || "", style: e.style || "",
        mood: clamp(m, 0, 4), cpu: false, owner: e.owner || "", ownerName: e.ownerName || "", dogId: e.dogId || ""
      });
    });
    var used = {};
    dogs.forEach(function (d) { used[d.name] = 1; });
    var lang = window.I18N && window.I18N.getLang() === "ja" ? "ja" : "zh";
    var names = D.NAMES[lang];
    while (dogs.length < D.FIELD) {
      var b = pick(r, D.BREEDS), train = {};
      D.STATS.forEach(function (k) { train[k] = Math.round(between(r, cls.cpu[0], cls.cpu[1])); });
      var nm, guard = 0;
      do { nm = pick(r, names); guard++; } while (used[nm] && guard < 50);
      used[nm] = 1;
      var mx = r(), mood = mx < 0.08 ? 0 : mx < 0.28 ? 1 : mx < 0.72 ? 2 : mx < 0.92 ? 3 : 4;
      dogs.push({ breed: b.id, name: nm, train: train, lv: Math.round(between(r, 0, cls.cpu[1] / 3)), mood: mood, cpu: true, owner: "", ownerName: "", dogId: "" });
    }
    // 枠順抽籤
    for (var i = dogs.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var tmp = dogs[i]; dogs[i] = dogs[j]; dogs[j] = tmp; }
    // 跑法：最適跑法（CPU 依 seed 抽個體差）＋這場選的跑法（CPU 一律用最適跑法）；用另一條亂數，不影響既有的出賽表
    var sr = rng((seed ^ 0x57e1e) >>> 0);
    dogs.forEach(function (d, k) {
      d.gate = k;
      var bs = (D.BREED_BY_ID[d.breed] || D.BREEDS[0]).style;
      if (D.STYLE_IDS.indexOf(d.best) < 0) d.best = d.cpu ? D.rollBestStyle(bs, sr) : bs;
      if (D.STYLE_IDS.indexOf(d.style) < 0) d.style = d.best;
      d.eff = effStats(d, weather, ground, terrain);
    });
    return { v: 1, seed: seed >>> 0, cls: cls.id, terrain: terrain, dist: dist, weather: weather, ground: ground, course: course, dogs: dogs };
  }

  // ---------------- 比賽模擬 ----------------
  var PACE = {
    nige: { early: 0.98, late: 0.98, at: 1 },
    senko: { early: 0.95, late: 1.0, at: 0.7 },
    sashi: { early: 0.91, late: 1.03, at: 0.62 },
    oikomi: { early: 0.9, late: 1.07, at: 0.68 }   // 2026-10-31 加跑法適性時調整：原 0.87/1.06/0.72 時連追込最適的狗都是跑差馬比較快
  };
  // 展開：逃馬 2 隻以上＝高速步調，逃馬後段乏力、差馬／後追有利；沒有逃馬＝慢步調，先行有利、後追追不上
  function fieldPace(card, style) {
    var p = PACE[style] || PACE.senko, late = p.late;
    var nige = card.dogs.filter(function (d) { return d.style === "nige"; }).length;
    if (nige >= 2) {
      if (style === "nige") late -= 0.015 * (nige - 1);
      else if (style === "sashi" || style === "oikomi") late += 0.008 * (nige - 1);
    } else if (nige === 0) {
      if (style === "senko") late += 0.01;
      else if (style === "oikomi") late -= 0.01;
    }
    return { early: p.early, late: late, at: p.at };
  }
  // 這場的展開：high／even／slow（畫面顯示用）
  function paceKind(card) {
    var nige = card.dogs.filter(function (d) { return d.style === "nige"; }).length;
    return nige >= 2 ? "high" : nige === 0 ? "slow" : "even";
  }
  var CRAWL = [0, 0.78, 0.66, 0.52, 0.4, 0.3];
  var DOCK_RUN = 3;   // 跳水台泳池：台上助跑長度（m）

  // record＝是否記錄每一步（畫面用）；seedOverride 給賠率試算用
  function simulate(card, record, seedOverride) {
    var course = card.course, L = course.length;
    var g0 = D.GROUNDS[card.ground] || D.GROUNDS.firm;
    var sf = D.SURFACES[(D.TERRAINS[card.terrain] || D.TERRAINS.park).surf] || D.SURFACES.dirt;
    var g = { grip: g0.grip * sf.grip, drag: g0.drag * sf.drag, stam: g0.stam * sf.stam };
    var sandy = sf === D.SURFACES.sand;
    var wx = card.weather;
    // 飛盤的風：強風 −15%、颱風 −25%、沙塵暴／暴風雪 −10%
    var discWind = wx === "windy" ? 0.15 : wx === "typhoon" ? 0.25 : wx === "sandstorm" || wx === "blizzard" ? 0.1 : 0;
    // 陣風：每秒速度起伏（平常 ±5%、強風 ±7%、颱風 ±10%）
    var gust = wx === "typhoon" ? 0.1 : wx === "windy" || wx === "blizzard" || wx === "sandstorm" ? 0.07 : 0.05;
    var hot = (D.WEATHERS[wx] || {}).temp > 0;
    var base = seedOverride === undefined ? (card.seed ^ 0x9e3779b1) : seedOverride;
    var dogs = card.dogs.map(function (d, i) {
      var e = d.eff, b = D.BREED_BY_ID[d.breed] || D.BREEDS[0];
      return {
        i: i, e: e, size: b.size, pace: fieldPace(card, d.style),
        r: rng((base + Math.imul(i + 1, 0x632be5ab)) >>> 0),
        vmax: (12.5 + e.spd * 0.045) * g.drag * (sandy ? 0.97 + e.pow * 0.0004 : 1) * D.APT[D.aptitude(d.best || d.style, d.style)].spd,
        cold: b.cold,
        acc: 2.5 + e.pow * 0.03 + (5 - b.size) * 0.4,
        day: 0,
        s: 0, v: 0, sta: 1, jit: 1, jitT: 0,
        mode: MODE.run, timer: 0, timerMode: 0, airT: 0,
        part: -1, flag: 0, tries: 0, done: false, time: null
      };
    });
    var frames = record ? [] : null, events = record ? [] : null;
    var t = 0, step = 0, leader = -1;
    function ev(k, d, x) { if (events) events.push({ t: Math.round(t * 100) / 100, k: k, d: d, x: x === undefined ? null : x }); }
    if (events) ev("start", -1);

    while (t < MAX_T) {
      var alive = 0;
      for (var di = 0; di < dogs.length; di++) {
        var o = dogs[di];
        if (o.done) continue;
        alive++;
        var e = o.e, r = o.r;
        // 每秒換一次隨機起伏（陣風越強越大）
        o.jitT -= DT;
        if (!o.day) o.day = 0.93 + r() * 0.14;   // 當天狀態（每場一次，±7%）
        if (o.jitT <= 0) { o.jitT = 1; o.jit = 1 - gust + r() * gust * 2; }
        var pi = 0, ps = course.parts;
        for (var q = ps.length - 1; q >= 0; q--) if (o.s >= ps[q].s0) { pi = q; break; }
        var p = ps[pi], local = o.s - p.s0;
        if (pi !== o.part) { o.part = pi; o.flag = 0; o.tries = 0; o.airT = 0; if (events && p.type !== "straight" && p.type !== "curve") ev("enter", di, pi); }
        var prog = o.s / L;
        var pace = prog < o.pace.at ? o.pace.early : o.pace.late;
        if (prog > 0.85 && o.sta > 0.3) pace += 0.03;   // 最後直線還有力氣就衝
        var vt = o.vmax * pace * o.jit * o.day;
        if (o.sta < 0.25) vt *= 0.72 + o.sta * 1.1;
        var mode = MODE.run, drain = 1;

        if (o.timer > 0) {
          o.timer -= DT;
          mode = o.timerMode;
          vt = mode === MODE.stun ? vt * 0.3 : 0;
          if (o.timer <= 0 && mode === MODE.eat && events) ev("eatEnd", di);
        } else if (p.type === "curve") {
          var R = p.len / (Math.abs(p.turn) * Math.PI / 180);
          var grip = (0.7 + e.agi * 0.006) * g.grip * (1.06 - o.size * 0.03);
          vt = Math.min(vt, Math.sqrt(R * 9.8 * grip));
        } else if (p.type === "hurdle") {
          var gap = p.len / (p.bars + 1), next = Math.floor(local / gap);   // 下一根欄在 (next+1)*gap
          vt = Math.min(vt, o.vmax * (0.8 + e.jmp * 0.002));
          if (next > o.flag - 1 && next >= 1 && o.flag < next) {
            o.flag = next;
            // 變體：乾草捆較好跳、輪胎圈也看敏捷、倒木／雪堆大狗有利（失敗＝爬過去，停比較久）
            var hk = p.kind || "bar", pj = 0.62 + e.jmp * 0.0042 - (o.size >= 5 ? 0.04 : 0), stun = 0.45, land = 0.95;
            if (hk === "hay") pj += 0.05;
            else if (hk === "tire") pj = 0.5 + e.jmp * 0.003 + e.agi * 0.002;
            else if (hk === "log" || hk === "snowbank") { pj = 0.55 + e.jmp * 0.0035 + (o.size - 3) * 0.05; stun = 0.8; if (hk === "snowbank") land = 0.85; }
            pj = clamp(pj, 0.4, 0.97);
            if (r() < pj) { o.v *= land; o.airT = 0.38; if (events && next === p.bars && pj < 0.8) ev("jumpGood", di); }
            else { o.v *= 0.55; o.timer = stun; o.timerMode = MODE.stun; ev("knock", di, hk); }
          }
          if (o.airT > 0) { o.airT -= DT; mode = MODE.jump; }
        } else if (p.type === "tunnel") {
          vt = Math.min(vt, o.vmax * (CRAWL[o.size] + e.agi * 0.002));
          mode = MODE.crawl;
        } else if (p.type === "frisbee") {
          var spot = p.len * 0.5, dist = spot - local;
          if (o.flag === 0) {
            if (dist > 0) vt = Math.min(vt, 3 + dist * 1.3);
            else {
              // 停下來接飛盤：成功率看接物、專注與風
              o.tries++;
              var pc = clamp(0.35 + e.cat * 0.006 + e.foc * 0.001 - discWind, 0.15, 0.96);
              if (o.tries >= 3 || r() < pc) { o.flag = 1; o.timer = 0.9 + r() * 0.4; o.timerMode = MODE.catch; ev(o.tries === 1 ? "catchGood" : "catchLate", di, o.tries); }
              else { o.timer = 1.3 + r() * 0.5; o.timerMode = MODE.catch; ev("catchMiss", di, o.tries); }
              o.v = 0;
            }
          }
        } else if (p.type === "weave") {
          vt = Math.min(vt, o.vmax * (0.3 + e.agi * 0.004));
          mode = MODE.weave;
          var pole = Math.floor(local / 2);
          if (pole > o.flag) {
            o.flag = pole;
            if (r() < (100 - Math.min(e.foc, 100)) * 0.0011) { o.timer = 0.8; o.timerMode = MODE.weave; o.v *= 0.5; ev("weaveMiss", di); }
          }
        } else if (p.type === "pool") {
          var pk = p.kind || "std";
          if (pk === "shallow") {
            // 淺灘：涉水跑，大狗腿長有利
            vt = Math.min(vt, o.vmax * (0.32 + e.pow * 0.003 + o.size * 0.04));
            mode = MODE.wade; drain = 1.3;
          } else if (pk === "dock" && local < DOCK_RUN) {
            // 跳水台：先在台上助跑
          } else if (pk === "dock" && o.flag < 2) {
            // 飛撲入水：飛行距離看跳躍與速度
            if (o.flag === 0) { o.flag = 1; o.dive = 1.5 + e.jmp * 0.05 + e.spd * 0.02; if (o.dive > 6.5) ev("diveGood", di, Math.round(o.dive * 10) / 10); }
            if (local < DOCK_RUN + o.dive) mode = MODE.dive;
            else { o.flag = 2; o.v = Math.min(o.v, 3); }
          } else {
            var sw = pk === "deep" ? 0.8 + e.swm * 0.032 : pk === "stream" ? 0.6 + e.swm * 0.026 + e.pow * 0.008 : 1.0 + e.swm * 0.03;
            if (pk === "ice") sw *= 1 + 0.05 * o.cold;
            vt = Math.min(vt, sw);
            mode = MODE.swim;
            drain = pk === "deep" ? 1.6 : pk === "stream" ? 1.7 : pk === "ice" ? 1.5 + (o.cold < 0 ? -0.3 * o.cold : 0) : 1.4;
            if (o.flag !== 3) { o.flag = 3; o.v = Math.min(o.v, 4); }
          }
        } else if (p.type === "mud") {
          // 深雪：小狗陷下去；沙坑：看力量
          var mf = p.kind === "snow" ? 0.4 + e.pow * 0.003 + o.size * 0.05 : p.kind === "sand" ? 0.5 + e.pow * 0.0045 : (0.5 + e.pow * 0.004) * (g0.drag < 1 ? 0.92 : 1);
          vt = Math.min(vt, o.vmax * mf);
          mode = MODE.mud; drain = 1.8;
        } else if (p.type === "hill") {
          // 前半上坡（看力量）、後半下坡（看敏捷，雪坡滑）
          if (local < p.len / 2) { vt = Math.min(vt, o.vmax * (0.5 + e.pow * 0.004)); mode = MODE.climb; drain = 1.5; }
          else vt = Math.min(vt, o.vmax * (p.kind === "snow" ? 0.85 + e.agi * 0.002 : 1.02));
        } else if (p.type === "bridge") {
          // 吊橋：窄又晃，膽小的狗會在橋頭猶豫（颱風／強風更怕）
          vt = Math.min(vt, o.vmax * (0.38 + e.agi * 0.0035 + e.foc * 0.001));
          if (o.flag === 0) {
            o.flag = 1;
            var fear = clamp(0.35 - e.foc * 0.003 + (wx === "typhoon" ? 0.2 : wx === "windy" ? 0.1 : 0), 0.03, 0.6);
            if (r() < fear) { o.timer = 0.7 + r() * 0.9; o.timerMode = MODE.sit; o.v = 0; ev("bridgeStop", di); }
          }
        } else if (p.type === "aframe") {
          vt = Math.min(vt, o.vmax * (0.35 + e.pow * 0.0035 + e.agi * 0.0015));
          mode = MODE.climb; drain = 1.4;
        } else if (p.type === "treat") {
          if (o.flag === 0 && local > p.len * 0.3) {
            o.flag = 1;
            if (r() < clamp(0.6 - e.foc * 0.0055, 0.04, 0.6)) { o.timer = 1 + r() * 1.6; o.timerMode = MODE.eat; o.v = 0; ev("eat", di); }
          }
        } else if (p.type === "hurdlerace") {
          // 跨欄賽道：低欄連續，不停下來；踢到欄只會掉速度
          var hg = p.len / (p.bars + 1), hn = Math.floor(local / hg);
          vt = Math.min(vt, o.vmax * (0.86 + e.agi * 0.0015));
          if (hn >= 1 && hn <= p.bars && o.flag < hn) {
            o.flag = hn;
            var pr = clamp(0.7 + e.jmp * 0.0025 + e.agi * 0.0015 - (o.size <= 1 ? 0.06 : 0), 0.5, 0.98);
            if (r() < pr) { o.airT = 0.3; o.v *= 0.98; }
            else { o.v *= 0.72; ev("clip", di, hn); }
          }
          if (o.airT > 0) { o.airT -= DT; mode = MODE.jump; }
        } else if (p.type === "firewheel") {
          // 風火輪：火圈前 2 m 膽小的狗會停下來（看專注），穿過火圈看跳躍
          var fg = p.len / (p.rings + 1), fa = Math.floor((local + 2) / fg), fn = Math.floor(local / fg);
          vt = Math.min(vt, o.vmax * (0.7 + e.jmp * 0.002));
          if (fa >= 1 && fa <= p.rings && o.tries < fa) {
            o.tries = fa;
            if (r() < clamp(0.28 - e.foc * 0.0024, 0.02, 0.28)) { o.timer = 0.7 + r() * 0.6; o.timerMode = MODE.wait; o.v = 0; ev("fireBalk", di); }
          }
          if (fn >= 1 && fn <= p.rings && o.flag < fn) {
            o.flag = fn;
            if (r() < clamp(0.62 + e.jmp * 0.0035 + e.agi * 0.001, 0.4, 0.97)) o.airT = 0.36;
            else { o.v *= 0.5; o.timer = 0.5; o.timerMode = MODE.stun; ev("ringMiss", di); }
          }
          if (o.airT > 0) { o.airT -= DT; mode = MODE.jump; }
        } else if (p.type === "looptube") {
          // 圓形通道：衝進一整圈的透明管；力量與速度不夠會在入口滑下來重衝
          if (local >= LOOP_IN && local < LOOP_IN + LOOP_C) {
            if (o.flag === 0) {
              o.flag = 1;
              var lf = clamp(0.3 - e.pow * 0.0018 - e.spd * 0.0012, 0.03, 0.3) + (o.sta < 0.4 ? 0.1 : 0);
              if (r() < lf) { o.timer = 1.1; o.timerMode = MODE.stun; o.v = 0; ev("loopFail", di); }
            }
            vt = Math.min(vt, o.vmax * (0.62 + e.pow * 0.002 + e.spd * 0.001));
            mode = MODE.loop; drain = 1.3;
          }
        } else if (p.type === "climbwall") {
          // 爬高牆：前 35% 是陡牆（力量＋跳躍），中間平台，後段下坡
          var cu = p.len * 0.35;
          if (local < cu) {
            vt = Math.min(vt, o.vmax * (0.2 + e.pow * 0.0022 + e.jmp * 0.0018));
            mode = MODE.climb; drain = 1.6;
            if (o.flag === 0 && local > cu * 0.5) {
              o.flag = 1;
              if (r() < clamp(0.26 - (e.pow + e.jmp) * 0.0012, 0.02, 0.26)) { o.timer = 0.9; o.timerMode = MODE.stun; o.v = 0; ev("climbSlip", di); }
            }
          } else if (local < p.len * 0.65) vt = Math.min(vt, o.vmax * 0.6);
          else vt = Math.min(vt, o.vmax * (0.5 + e.agi * 0.002));
        } else if (p.type === "wallkick") {
          // 蹬牆連跳：在兩面牆之間左右蹬 kicks 次往上，最後從平台跳下
          var kz = p.len * 0.8, kg = kz / p.kicks, kn = Math.floor(local / kg + 0.5);
          if (local < kz) {
            vt = Math.min(vt, o.vmax * (0.42 + e.agi * 0.0025 + e.jmp * 0.001));
            mode = MODE.jump;
            if (kn >= 1 && kn <= p.kicks && o.flag < kn) {
              o.flag = kn;
              if (r() < clamp(0.62 + e.jmp * 0.0028 + e.agi * 0.0022 - (o.size >= 5 ? 0.08 : 0), 0.35, 0.97)) {
                if (kn === p.kicks && o.tries === 0) ev("kickGood", di);
              } else { o.tries++; o.timer = 1.0; o.timerMode = MODE.stun; o.v = 0; ev("kickFall", di); }
            }
          }
        } else if (p.type === "seesaw") {
          // 蹺蹺板：走到中間要等板子翻過去（專注高的等得剛好），太急會被彈下來
          vt = Math.min(vt, o.vmax * (0.4 + e.agi * 0.003));
          if (o.flag === 0 && local >= p.len / 2) {
            o.flag = 1; o.v = 0;
            if (r() < clamp(0.25 - e.foc * 0.0025, 0.02, 0.25)) { o.timer = 0.8; o.timerMode = MODE.stun; ev("seesawFly", di); }
            else { o.timer = 0.3 + (100 - Math.min(e.foc, 100)) * 0.007; o.timerMode = MODE.wait; }
          }
        } else if (p.type === "dogwalk") {
          // 平衡木：窄又高，看敏捷與專注；掉下去要繞回來
          vt = Math.min(vt, o.vmax * (0.38 + e.agi * 0.003 + e.foc * 0.0015));
          if (o.flag === 0 && local > p.len * 0.4) {
            o.flag = 1;
            if (r() < clamp(0.2 - e.foc * 0.0016 - e.agi * 0.0008, 0.02, 0.2)) { o.timer = 1.3; o.timerMode = MODE.stun; o.v = 0; ev("plankFall", di); }
          }
        } else if (p.type === "tirerun") {
          // 輪胎陣：每 2 m 一排輪胎，抬腿踩格子，敏捷低會絆倒
          vt = Math.min(vt, o.vmax * (0.36 + e.agi * 0.0042));
          mode = MODE.wade;
          var tn = Math.floor(local / 2);
          if (tn > o.flag) {
            o.flag = tn;
            if (r() < (100 - Math.min(e.agi, 100)) * 0.001) { o.timer = 0.4; o.timerMode = MODE.stun; o.v *= 0.5; ev("trip", di); }
          }
        } else if (p.type === "ballpit") {
          // 球池：像泥巴地一樣吃力量，貪玩的狗會玩起來
          vt = Math.min(vt, o.vmax * (0.28 + e.pow * 0.003 + o.size * 0.04));
          mode = MODE.wade; drain = 1.5;
          if (o.flag === 0 && local > p.len * 0.3) {
            o.flag = 1;
            if (r() < clamp(0.32 - e.foc * 0.003, 0.03, 0.32)) { o.timer = 1 + r(); o.timerMode = MODE.eat; o.v = 0; ev("ballPlay", di); }
          }
        } else if (p.type === "sprinkler") {
          // 灑水陣：怕水的狗（游泳低）會停下來
          vt = Math.min(vt, o.vmax * (0.78 + e.swm * 0.002));
          if (o.flag === 0 && local > p.len * 0.25) {
            o.flag = 1;
            if (r() < clamp(0.34 - e.swm * 0.0028 - e.foc * 0.001, 0.02, 0.34)) { o.timer = 0.9 + r() * 0.6; o.timerMode = MODE.wait; o.v = 0; ev("sprayStop", di); }
          }
        } else if (p.type === "conveyor") {
          // 逆向輸送帶：皮帶以 2.4 m/s 往回走，力量大的才推得過去
          vt = Math.max(0.6, Math.min(vt, o.vmax) * (0.85 + e.pow * 0.0015) - 2.4);
          drain = 1.5;
        } else if (p.type === "slide") {
          // 溜滑梯：前 30% 爬梯子，之後滑下去（速度和能力無關，大狗滑得快一點）
          if (local < p.len * 0.3) { vt = Math.min(vt, o.vmax * (0.18 + e.pow * 0.0015 + e.agi * 0.002)); mode = MODE.climb; drain = 1.4; }
          else {
            vt = 6 + o.size * 0.35; mode = MODE.slide; drain = 0.3;
            if (o.flag === 0) { o.flag = 1; o.v = Math.max(o.v, vt * 0.6); }
          }
        } else if (p.type === "trampoline") {
          // 彈跳床：40% 處彈起，成功會加速，失敗摔一跤
          vt = Math.min(vt, o.vmax * (0.6 + e.jmp * 0.002));
          if (o.flag === 0 && local >= p.len * 0.4) {
            o.flag = 1;
            var tp = clamp(0.55 + e.jmp * 0.004, 0.3, 0.97);
            if (r() < tp) { o.airT = 0.7; o.v = Math.max(o.v, o.vmax * 0.75); if (tp < 0.85) ev("bounceGood", di); }
            else { o.timer = 0.8; o.timerMode = MODE.stun; o.v *= 0.3; ev("bounceFlop", di); }
          }
          if (o.airT > 0) { o.airT -= DT; mode = MODE.jump; }
        } else if (p.type === "windmill") {
          // 風車門：等葉片轉過去的空檔再鑽過，敏捷低會被葉片打到
          vt = Math.min(vt, o.vmax * 0.6);
          if (o.flag === 0 && local >= 3) {
            o.flag = 1; o.v = 0;
            if (r() < (100 - Math.min(e.agi, 100)) * 0.0016) { o.timer = 0.7; o.timerMode = MODE.stun; ev("paddleBonk", di); }
            else { o.timer = 0.1 + r() * (1.3 - e.foc * 0.006); o.timerMode = MODE.wait; }
          }
        } else if (p.type === "catzone") {
          // 貓咪誘惑區：專注低的狗會停下來盯著貓
          if (o.flag === 0 && local > p.len * 0.35) {
            o.flag = 1;
            if (r() < clamp(0.5 - e.foc * 0.0045, 0.04, 0.5)) { o.timer = 1.2 + r() * 1.4; o.timerMode = MODE.sit; o.v = 0; ev("catStare", di); }
          }
        } else if (p.type === "sled") {
          // 拖輪胎：看力量與體型，很耗體力
          vt = Math.min(vt, o.vmax * (0.3 + e.pow * 0.0045 + o.size * 0.03));
          mode = MODE.mud; drain = 1.9;
        } else if (p.type === "ditch") {
          // 跳溝：溝寬 dw，跳不過就掉進水裡游過去
          var d0 = p.len / 2 - p.dw / 2;
          vt = Math.min(vt, o.vmax * 0.9);
          if (o.flag === 0 && local >= d0 - 0.5) {
            o.flag = 1;
            var dp = clamp(0.5 + e.jmp * 0.0028 + e.spd * 0.0018 + o.size * 0.025, 0.35, 0.97) - (o.v < 5 ? 0.15 : 0);
            if (r() < dp) { o.airT = 0.45; if (dp < 0.8) ev("ditchGood", di); }
            else { o.flag = 2; o.v = Math.min(o.v, 1.5); ev("ditchFall", di); }
          }
          if (o.flag === 2 && local < d0 + p.dw) { vt = 0.9 + e.swm * 0.012 + e.pow * 0.006; mode = MODE.swim; drain = 1.6; }
          if (o.airT > 0) { o.airT -= DT; mode = MODE.jump; }
        } else if (p.type === "stairs") {
          // 階梯：前 55% 上樓梯（短腿的小狗吃虧），之後下坡
          if (local < p.len * 0.55) {
            vt = Math.min(vt, o.vmax * (0.3 + e.pow * 0.002 + e.agi * 0.002 + (o.size >= 3 ? 0.06 : o.size <= 1 ? -0.08 : 0)));
            mode = MODE.climb; drain = 1.4;
          } else vt = Math.min(vt, o.vmax * 0.7);
        } else if (p.type === "surf" || p.type === "skateboard" || p.type === "ski") {
          // 乘具關卡：站在板子上，速度主要看平衡（敏捷＋專注），跌倒要重新站上去
          //   衝浪：浪推著走，跌倒＝落水游一段；滑板：用力量蹬地；滑雪：下坡，大狗衝得快
          var rv = p.type === "surf" ? 4.6 + e.foc * 0.02 + e.agi * 0.02 + e.swm * 0.01
            : p.type === "skateboard" ? 5.4 + e.agi * 0.025 + e.pow * 0.012
            : 6.4 + o.size * 0.35 + e.agi * 0.02;
          vt = rv * (o.jit * 0.5 + 0.5); mode = MODE.ride; drain = 0.6;
          if (o.flag === 2 && p.type === "surf") { vt = 0.8 + e.swm * 0.012; mode = MODE.swim; drain = 1.5; if (local > o.dive) o.flag = 1; }
          var rn = Math.floor(local / 8);
          if (rn > o.tries && o.flag !== 2) {
            o.tries = rn;
            var rf = p.type === "surf" ? clamp(0.2 - e.foc * 0.0012 - e.agi * 0.0008, 0.02, 0.2)
              : p.type === "skateboard" ? clamp(0.16 - e.agi * 0.0012 - e.foc * 0.0006, 0.02, 0.16)
              : clamp(0.18 - e.agi * 0.0012 - e.foc * 0.0006 + (o.size >= 5 ? 0.03 : 0), 0.02, 0.18);
            if (r() < rf) {
              if (p.type === "surf") { o.flag = 2; o.dive = local + 2.5; o.v = Math.min(o.v, 1); ev("surfWipe", di); }
              else { o.timer = 0.9; o.timerMode = MODE.stun; o.v *= 0.2; ev(p.type === "ski" ? "skiFall" : "skateFall", di); }
            }
          }
          if (o.flag === 0) o.flag = 1;
        } else if (p.type === "stay") {
          if (o.flag === 0) {
            var d2 = p.len * 0.5 - local;
            if (d2 > 0) vt = Math.min(vt, 2.5 + d2 * 1.4);
            else {
              o.flag = 1; o.v = 0;
              var brk = r() < clamp(0.42 - e.foc * 0.004, 0.03, 0.42);
              o.timer = 1.5 + (brk ? 1.6 : 0); o.timerMode = MODE.sit;
              ev(brk ? "stayBreak" : "stayGood", di);
            }
          }
        }

        // 加減速
        if (o.v < vt) o.v = Math.min(vt, o.v + o.acc * DT);
        else o.v = Math.max(vt, o.v - 9 * DT);
        // 耐力：速度比例平方 × 場地 × 炎熱
        var ratio = o.v / o.vmax;
        var heat = hot ? 1.15 : 1;
        o.sta -= ratio * ratio * 0.021 * drain * g.stam * heat * DT / (0.5 + e.sta * 0.01);
        if (o.v < 0.5) o.sta += 0.03 * DT;
        o.sta = clamp(o.sta, 0, 1);
        var prev = o.s;
        o.s += o.v * DT;
        o.mode = mode;
        if (o.s >= L) {
          o.done = true;
          o.time = Math.round((t + (o.v > 0 ? (L - prev) / o.v : DT)) * 1000) / 1000;
          o.s = L; o.mode = MODE.fin;
          ev("finish", di, o.time);
        }
      }
      t += DT; step++;
      if (frames) {
        var f = new Float32Array(dogs.length * 3);
        for (var k = 0; k < dogs.length; k++) { f[k * 3] = dogs[k].s; f[k * 3 + 1] = dogs[k].v; f[k * 3 + 2] = dogs[k].mode + (dogs[k].sta * 0.99); }
        frames.push(f);
      }
      if (events && step % 10 === 0) {
        var best = -1, bs = -1;
        dogs.forEach(function (o2, k2) { if (!o2.done && o2.s > bs) { bs = o2.s; best = k2; } });
        if (best >= 0 && best !== leader && t > 2) { leader = best; ev("lead", best); }
        else if (leader < 0) leader = best;
      }
      if (!alive) break;
    }
    var order = dogs.slice().sort(function (a, b) {
      if (a.time !== null && b.time !== null) return a.time - b.time || a.i - b.i;
      if (a.time !== null) return -1;
      if (b.time !== null) return 1;
      return b.s - a.s || a.i - b.i;
    }).map(function (o) { return o.i; });
    return {
      order: order,
      times: dogs.map(function (o) { return o.time; }),
      frames: frames, events: events, dt: DT,
      duration: Math.min(t, MAX_T)
    };
  }

  // 第 t 秒的狀態（內插）。回傳 [{ s, v, mode, sta }]
  function stateAt(result, t) {
    var fr = result.frames, n = fr.length;
    if (!n) return [];
    var p = clamp(t / result.dt - 1, 0, n - 1), i = Math.floor(p), f = p - i;
    var a = fr[i], b = fr[Math.min(n - 1, i + 1)], out = [];
    for (var k = 0; k < a.length / 3; k++) {
      var m = a[k * 3 + 2];
      out.push({ s: a[k * 3] + (b[k * 3] - a[k * 3]) * f, v: a[k * 3 + 1], mode: Math.floor(m), sta: m - Math.floor(m) });
    }
    return out;
  }
  // 目前名次（已完走依時間，其餘依里程）
  function rankAt(result, t) {
    var st = stateAt(result, t);
    return st.map(function (x, i) { return i; }).sort(function (a, b) {
      var ta = result.times[a], tb = result.times[b];
      var fa = ta !== null && ta <= t, fb = tb !== null && tb <= t;
      if (fa && fb) return ta - tb;
      if (fa) return -1;
      if (fb) return 1;
      return st[b].s - st[a].s || a - b;
    });
  }

  // ---------------- 賠率 ----------------
  // 用不同 seed 試跑 N 場得到每隻的勝率（加平滑），二、三連用 Harville 公式由勝率推算。
  // 賠率是固定賠率（下注當下就決定），所有裝置算出的數字一樣。
  var SIMS = 160;
  function odds(card) {
    if (card._odds) return card._odds;
    var n = card.dogs.length, wins = [], i, j, k;
    for (i = 0; i < n; i++) wins.push(0);
    for (var m = 0; m < SIMS; m++) {
      var res = simulate(card, false, (card.seed + 7919 * (m + 1)) >>> 0);
      wins[res.order[0]]++;
    }
    var p = wins.map(function (w) { return (w + 0.35) / (SIMS + 0.35 * n); });
    function harv2(a, b) { return p[a] * p[b] / (1 - p[a]); }
    function harv3(a, b, c) { return p[a] * p[b] / (1 - p[a]) * p[c] / (1 - p[a] - p[b]); }
    var prob = { win: {}, place: {}, quinella: {}, exacta: {}, wide: {}, trio: {}, trifecta: {} };
    for (i = 0; i < n; i++) {
      prob.win[i] = p[i];
      var pl = p[i];
      for (j = 0; j < n; j++) if (j !== i) pl += harv2(j, i);
      prob.place[i] = pl;
    }
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      if (i === j) continue;
      prob.exacta[i + "-" + j] = harv2(i, j);
      if (i < j) prob.quinella[i + "-" + j] = harv2(i, j) + harv2(j, i);
      for (k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        prob.trifecta[i + "-" + j + "-" + k] = harv3(i, j, k);
      }
    }
    Object.keys(prob.trifecta).forEach(function (key) {
      var a = key.split("-").map(Number), pr = prob.trifecta[key];
      var s = a.slice().sort(function (x, y) { return x - y; });
      var tk = s.join("-");
      prob.trio[tk] = (prob.trio[tk] || 0) + pr;
      [[s[0], s[1]], [s[0], s[2]], [s[1], s[2]]].forEach(function (pair) {
        var wk = pair.join("-");
        prob.wide[wk] = (prob.wide[wk] || 0) + pr;
      });
    });
    var out = { p: p, prob: prob };
    D.BET_TYPES.forEach(function (bt) {
      var o = {};
      Object.keys(prob[bt.id]).forEach(function (key) {
        var v = bt.take / Math.max(prob[bt.id][key], 1e-6);
        o[key] = clamp(Math.floor(v * 10) / 10, 1.1, 9999.9);
      });
      out[bt.id] = o;
    });
    card._odds = out;
    return out;
  }
  // 人氣順（單勝賠率由低到高）
  function popularity(card) {
    var o = odds(card).win;
    var idx = card.dogs.map(function (d, i) { return i; }).sort(function (a, b) { return o[a] - o[b] || a - b; });
    var pop = [];
    idx.forEach(function (d, rank) { pop[d] = rank + 1; });
    return pop;
  }

  // 出賽表要經過網路傳送：去掉快取欄位
  function cardForWire(card) {
    var c = JSON.parse(JSON.stringify({ v: card.v, seed: card.seed, cls: card.cls, terrain: card.terrain, dist: card.dist, weather: card.weather, ground: card.ground, course: { parts: card.course.parts, length: card.course.length }, dogs: card.dogs, pm: card.pm ? 1 : 0 }));
    return c;
  }

  // 場地編號（seed 的 16 進位，8 碼）
  function courseCode(card) { var h = (card.seed >>> 0).toString(16).toUpperCase(); while (h.length < 8) h = "0" + h; return h; }

  window.PriTestSaigoCore = {
    courseCode: courseCode,
    DT: DT, MODE: MODE, LANE_W: LANE_W, DOCK_RUN: DOCK_RUN, LOOP_IN: LOOP_IN, LOOP_R: LOOP_R, LOOP_C: LOOP_C,
    rng: rng, hashStr: hashStr, newSeed: newSeed, clamp: clamp,
    makeCard: makeCard, effStats: effStats, simulate: simulate, stateAt: stateAt, rankAt: rankAt,
    geometry: geometry, pointAt: pointAt, partAt: partAt, laneOff: laneOff,
    odds: odds, popularity: popularity, cardForWire: cardForWire, paceKind: paceKind
  };
})();
