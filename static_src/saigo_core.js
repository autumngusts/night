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
  var SK = window.PriTestSaigoSkills;
  function Real() { return window.PriTestSaigoReal; }
  // 平衡參數（2026-11-02 調整）：
  //   STA_K：耐力消耗係數，消耗 ∝ (速度比)⁴——前段放慢才省得到體力，後段衝刺也更吃體力，四種跑法才有取捨
  //   DAY：當天狀態幅度（±7%）；CPU_BW／CPU_ADJ：CPU 依等級配對的犬種抽選寬度與訓練補正比例
  var STA_K = 0.0245, DAY = 0.14, CPU_BW = 7, CPU_ADJ = 0.75;
  // 跑法在出賽表產生時決定、下注前可改，開跑後不得調整（使用者指定 2026-11-02，取代同日稍早的「比賽中改跑法」）
  var DT = 0.05;            // 模擬步長（秒）
  var CROWD_APPROACH = 14;  // 真賽狗：進關卡前幾公尺開始搶位置
  var MAX_T = 240;          // 最長秒數（超過算未完走）
  var LANE_W = 1.6;         // 每條跑道寬（m）
  var MODE = { run: 0, jump: 1, crawl: 2, swim: 3, catch: 4, eat: 5, sit: 6, weave: 7, stun: 8, climb: 9, mud: 10, fin: 11, wade: 12, dive: 13, wait: 14, loop: 15, slide: 16, ride: 17 };
  // 圓形通道：入口直線 LOOP_IN m，之後是一圈（沿跑道方向前進 LOOP_C m），畫面上的形狀在 saigo_3d.js
  var LOOP_IN = 6, LOOP_R = 1.6, LOOP_C = 10.05;   // LOOP_C ≈ 2π × LOOP_R

  // ---- 暴衝與對決（2026-11-05 使用者指定，參考賽馬娘的「掛かり」與「追い比べ」）----
  // 暴衝：比賽開始時每隻擲一次（專注低、調子極端的狗容易暴衝），在前段某一點開始，
  //   暴衝中無視跑法全力往前衝（目標速度 ≥ KAKARI_PACE）、體力消耗 × KAKARI_DRAIN（實測：關卡賽平均名次落後約 0.24、真賽狗約 0.55）；
  //   每 KAKARI_CHECK 秒有 KAKARI_CALM 機率冷靜下來，最多 KAKARI_MAX 秒。技能「冷靜沉著」可立刻解除。
  var KAKARI_PACE = 1.02, KAKARI_DRAIN = 2.5, KAKARI_CHECK = 3, KAKARI_CALM = 0.55, KAKARI_MAX = 12;
  function kakariP(foc, mood) { return clamp(0.17 - foc * 0.0013, 0.03, 0.17) + (mood === 4 ? 0.05 : mood === 0 ? 0.04 : 0); }
  // 對決：最後直線（進度 85% 以後、開放區段）名次相鄰的兩隻前後差 DUEL_GAP m 內（真賽狗另外要橫向 DUEL_LAT m 內）
  //   就開始對決，每隻每場限一次；對決中目標速度＋（2%＋力量 × 0.02%＋剩餘體力 × 3%）、加速度 × 1.3，
  //   離開 DUEL_END m 或其中一隻到終點就結束。力量（根性）與剩下的體力多的那隻比較會贏。
  var DUEL_GAP = 1.5, DUEL_LAT = 2.2, DUEL_END = 4, DUEL_PROG = 0.85;
  function duelBonus(e, sta) { return 0.02 + e.pow * 0.0002 + sta * 0.03; }
  // 照片判定：第 1、2 名的時間差小於 PHOTO_GAP 秒
  var PHOTO_GAP = 0.05;
  // 每隻狗這場的「當天狀態」與暴衝（模擬開頭就決定；出賽表的看板依同一個值給提示，所以要能單獨算出來）
  function dogRng(base, i) { return rng((base + Math.imul(i + 1, 0x632be5ab)) >>> 0); }
  function kakariRng(base, i) { return rng(((base ^ 0x7a4a41) + Math.imul(i + 11, 0x1b873593)) >>> 0); }
  function raceBase(card) { return (card.seed ^ 0x9e3779b1) >>> 0; }
  // 正式比賽（不是賠率試跑）每隻狗的當天狀態 day（0.93〜1.07）與會不會暴衝
  function preRace(card) {
    var base = raceBase(card);
    return card.dogs.map(function (d, i) {
      var day = 1 - DAY / 2 + dogRng(base, i)() * DAY, kr = kakariRng(base, i);
      return { day: day, kakari: kr() < kakariP((d.eff || {}).foc || 0, d.mood | 0) };
    });
  }

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

  // 真賽狗「關閉關卡障礙」（2026-11-03 使用者指定「能選擇是否起動關卡障礙」）：只有直道與彎道的賽道，
  // 長度與障礙賽道相近（短 ≈420、中 ≈650、長 ≈950 m），彎道方向限制與 makeCourse 相同（不會自己交叉）。
  var FLAT_LEN = { sprint: 420, middle: 650, long: 950 };
  function makeFlatCourse(r, distId) {
    var dist = D.DISTANCES[distId] || D.DISTANCES.middle, sm = dist.straight, target = FLAT_LEN[distId] || FLAT_LEN.middle;
    var parts = [], s = 0, lastCurve = false;
    function add(type, len, extra) {
      var p = { type: type, len: Math.round(len) };
      Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
      parts.push(p); s += p.len;
    }
    add("straight", between(r, 60, 100) * sm);
    while (s < target - 130) {
      if (!lastCurve && r() < 0.75) { add("curve", between(r, 35, 75), { turn: Math.round(between(r, 45, 110)) * (r() < 0.5 ? -1 : 1) }); lastCurve = true; }
      else { add("straight", between(r, 40, 90) * sm); lastCurve = false; }
    }
    add("straight", between(r, 90, 140) * sm);
    var h = 0;
    parts.forEach(function (p) {
      if (p.type !== "curve") return;
      if (Math.abs(h + p.turn) > 80) p.turn = -p.turn;
      if (Math.abs(h + p.turn) > 80) p.turn = (h > 0 ? -1 : 1) * Math.min(Math.abs(p.turn), 80 - Math.abs(h) + 40);
      h += p.turn;
    });
    var s2 = 0;
    parts.forEach(function (p) { p.s0 = s2; s2 += p.len; });
    return { parts: parts, length: s2, flat: true };
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
    if (opts.mode === "real") return Real().makeCard(seed, entries, opts);
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
        skills: SK.sanitize(e.skills), line: D.LINES[e.line] ? e.line : "",
        mood: clamp(m, 0, 4), cpu: false, owner: e.owner || "", ownerName: e.ownerName || "", dogId: e.dogId || ""
      });
      if (e.rival) dogs[dogs.length - 1].rival = String(e.rival).slice(0, 16);   // 宿敵的王牌狗（saigo_league.js）
      if (e.npc) dogs[dogs.length - 1].npc = 1;
      if (e.career) dogs[dogs.length - 1].career = 1;
      var au = D.cleanAptUp(e.aptUp);
      if (Object.keys(au).length) dogs[dogs.length - 1].aptUp = au;   // 血統繼承提高的跑法適性   // 生涯畢業的狗（關卡賽的 CPU 依它補強）   // 冠軍大會晉級的 NPC（只是顯示用）
      if (e.ownerPid) dogs[dogs.length - 1].ownerPid = String(e.ownerPid).slice(0, 20);   // 冠軍大會：重新連線後用 pid 找回飼主
    });
    var used = {};
    dogs.forEach(function (d) { used[d.name] = 1; });
    var lang = window.I18N && window.I18N.getLang() === "ja" ? "ja" : "zh";
    var names = D.NAMES[lang];
    // CPU 依賽事等級配對（像賽馬的分組）：先抽這場的實力基準，犬種越接近基準越容易被抽到，
    // 再依差距給訓練加成，讓同場的狗實力相近、冷門也有機會（2026-11-02 平衡調整）
    var anchor = between(r, cls.band[0], cls.band[1]), bw = {};
    D.BREEDS.forEach(function (x) { var z = (D.breedRating(x) - anchor) / CPU_BW; bw[x.id] = 1 / (1 + z * z * z * z); });
    while (dogs.length < D.FIELD) {
      var b = D.BREED_BY_ID[weighted(r, bw)], train = {};
      var adj = clamp(Math.round((anchor - D.breedRating(b)) * CPU_ADJ), -12, 12);
      D.STATS.forEach(function (k) { train[k] = Math.round(between(r, cls.cpu[0], cls.cpu[1])) + adj; });
      var nm, guard = 0;
      do { nm = pick(r, names); guard++; } while (used[nm] && guard < 50);
      used[nm] = 1;
      var mx = r(), mood = mx < 0.08 ? 0 : mx < 0.28 ? 1 : mx < 0.72 ? 2 : mx < 0.92 ? 3 : 4;
      dogs.push({ breed: b.id, name: nm, train: train, lv: Math.round(between(r, 0, cls.cpu[1] / 3)), mood: mood, cpu: true, owner: "", ownerName: "", dogId: "", skills: [] });
    }
    // 生涯畢業的狗出賽時（2026-11-05 使用者選 B「只在有生涯畢業狗出賽時補強」）：CPU 依出賽玩家裡最強的狗補強，
    //   做法同真賽狗的 NPC（實力分低於 top 的 96〜103% 就把訓練補上去、等級貼近 top、調子至少普通）。
    //   用另一條亂數；沒有生涯狗的出賽表與改版前逐位相同。
    if (dogs.some(function (d) { return d.career; })) {
      var RL = Real(), top = null, br = rng((seed ^ 0xca2ee) >>> 0);
      dogs.forEach(function (d) { if (d.cpu) return; var sv = RL.strength(d.breed, d.train, d.lv); if (!top || sv > top.s) top = { s: sv, lv: d.lv || 0 }; });
      dogs.forEach(function (d) {
        if (!d.cpu) return;
        var tgt = top.s * between(br, 0.96, 1.03), lv2 = clamp(top.lv + Math.round(between(br, -2, 2)), 0, 20);
        if (RL.strength(d.breed, d.train, d.lv) >= tgt) return;
        var tAdd = tgt - RL.strength(d.breed, null, lv2);
        D.STATS.forEach(function (k) { d.train[k] = Math.round(clamp(tAdd + between(br, -4, 4), -15, 70)); });
        d.lv = lv2;
        if (d.mood < 2) d.mood = 2;
      });
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
    // CPU 的技能（另一條亂數）：依賽事等級，讓同場的總評分接近
    var kr = rng((seed ^ 0x5c111) >>> 0);
    dogs.forEach(function (d) { if (d.cpu) d.skills = SK.npcSkills(cls.id, kr); });
    return { v: 1, seed: seed >>> 0, cls: cls.id, terrain: terrain, dist: dist, weather: weather, ground: ground, course: course, dogs: dogs };
  }

  // ---------------- 比賽模擬 ----------------
  var PACE = {
    nige: { early: 0.975, late: 0.975, at: 1 },
    senko: { early: 0.95, late: 1.0, at: 0.6 },
    sashi: { early: 0.92, late: 1.045, at: 0.6 },
    oikomi: { early: 0.9, late: 1.1, at: 0.62 }
  };   // 2026-11-02 與耐力消耗改四次方一起調整：中距離四種跑法平均名次相差 0.1 以內，短距離前段稍有利、長距離後段稍有利

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

  // 比賽中的指令（真賽狗的喊聲）在第幾步生效
  function stepOf(t) { return Math.max(0, Math.ceil(t / DT - 1e-9)); }

  // record＝是否記錄每一步（畫面用）；seedOverride 給賠率試算用；cmds＝比賽中的指令（只有真賽狗的喊聲，關卡賽沒有）
  function simulate(card, record, seedOverride, cmds) {
    if (card.mode === "real" && !card.course) return Real().simulate(card, record, seedOverride, cmds);   // 舊版橢圓跑道的出賽表
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
      var vbase = (12.5 + e.spd * 0.045) * g.drag * (sandy ? 0.97 + e.pow * 0.0004 : 1);
      return {
        i: i, e: e, size: b.size, pace: fieldPace(card, d.style), style: d.style,
        r: dogRng(base, i), kr: kakariRng(base, i),
        vmax: vbase * D.APT[D.aptitude(d.best || d.style, d.style, d.aptUp && d.aptUp[d.style])].spd,
        sk: SK.runtime(d.skills, rng((base ^ 0x5c111 ^ Math.imul(i + 7, 0x2c1b3c6d)) >>> 0), e.foc), boost: null,
        cold: b.cold,
        acc: 2.5 + e.pow * 0.03 + (5 - b.size) * 0.4,
        day: 0,
        s: 0, v: 0, sta: 1, jit: 1, jitT: 0,
        mode: MODE.run, timer: 0, timerMode: 0, airT: 0,
        part: -1, flag: 0, tries: 0, done: false, time: null,
        kk: 0, kkOn: false, kkT: 0, kkNext: 0, kkAt: 0, duel: -1, duelUsed: false
      };
    });
    // 當天狀態（每場一次，±7%）：o.r 的第一個值（和改版前一樣，只是提前算）；暴衝：另一條亂數
    dogs.forEach(function (o, i) {
      o.day = 1 - DAY / 2 + o.r() * DAY;
      o.kk = o.kr() < kakariP(o.e.foc, card.dogs[i].mood | 0) ? 1 : 0;
      o.kkAt = 0.06 + o.kr() * 0.2;   // 在進度 6〜26% 的某一點開始暴衝
    });
    var duelN = 0, byRank = [];
    var frames = record ? [] : null, events = record ? [] : null;
    var t = 0, step = 0, leader = -1, ranks = [];
    function ev(k, d, x) { if (events) events.push({ t: Math.round(t * 100) / 100, k: k, d: d, x: x === undefined ? null : x }); }
    if (events) ev("start", -1);

    // ---- 真賽狗（2026-11-02 使用者指定）：關卡賽的地圖＋起跑後不分跑道、要搶道 ----
    // 直道／彎道：橫向位置 x 自由（左正），被前面的狗擋住只能跟跑，同時找左右空檔切出去；擠在一起會碰撞。
    //   彎道跑內側距離短（沿中心線的前進＝實際移動 × Rc ÷ (Rc − x)），但過彎限速也比較低。
    // 關卡：每個關卡有 n 個位置（＝畫面上的 n 組道具），進關卡前 CROWD_APPROACH m 要搶到一個空位；
    //   進了關卡就不能換道，前面同一位置的狗停下來（吃零食、接飛盤、摔倒…）就只能等。
    var crowd = card.mode === "real", n = dogs.length;
    var HW = n * LANE_W / 2, XMAX = HW - 0.35, DOG_W = 0.72, DOG_L = 1.05, LOOK = 2.6;
    var cmdAt = crowd ? Real().cmdIndex(cmds, n) : null, applied = [], bumpAt = {}, S0 = [], X0 = [], V0 = [];
    function slotX(k) { return ((n - 1) / 2 - k) * LANE_W; }
    function isOpen(pt) { return pt.type === "straight" || pt.type === "curve"; }
    // 橫向 cx 附近（±0.8 m）、里程差在 (from, to) 之間有沒有別的狗（用這一步開始時的位置，與處理順序無關）
    function laneFree(o, cx, from, to) {
      for (var q = 0; q < n; q++) {
        var z = dogs[q];
        if (z === o || z.done) continue;
        var dp = S0[q] - o.s, dx = X0[q] - cx;
        if (dp > from && dp < to && dx < 0.8 && dx > -0.8) return false;
      }
      return true;
    }
    if (crowd) dogs.forEach(function (o, i) {
      var d = card.dogs[i], e = o.e, r2 = rng((base ^ 0x6a7e5 ^ Math.imul(i + 3, 0x27d4eb2f)) >>> 0), ln = D.LINES[d.line] || D.LINES.mid;
      o.x = slotX(i); o.xt = o.x; o.lat = 0; o.slot = i;
      o.slow = r2() < clamp(0.12 - e.agi * 0.0008, 0.02, 0.12);
      o.react = 0.08 + (100 - Math.min(e.foc, 100)) * 0.0022 + r2() * 0.12 + (o.slow ? 0.35 : 0);
      o.lineId = D.LINES[d.line] ? d.line : "mid"; o.lineB = ln.bend * 2.5;   // 關卡賽地圖的彎道比較急，外側加成放大 2.5 倍，三種跑線平均名次才接近（實測 1200 場：4.57／4.38／4.56）
      o.started = false; o.shoutN = 0; o.lastShout = -1e9; o.blockEv = -9; o.queueEv = -1;
    });
    // 決定目標橫向位置 o.xt、橫移速度 o.lat，回傳被擋住後的目標速度
    function crowdSteer(o, di, pi, p, vt) {
      var xt = o.x, lat = 2.2 + o.e.agi * 0.01, nx = course.parts[pi + 1], toward = 0;
      var approach = isOpen(p) && nx && !isOpen(nx) && nx.s0 - o.s < CROWD_APPROACH;
      if (!isOpen(p)) { xt = slotX(o.slot); lat = 1.2; }
      else if (approach) {
        // 搶關卡的位置（2026-11-03 加強「後方的狗要計算排進關卡的哪一道」）：
        //   每一道估一個代價＝橫移距離＋來不及在入口前移到的部分（大幅加重）＋那一道裡前面的狗造成的等待。
        //   入口附近（入口後 6 m 內）有狗＝那一道被佔住；更裡面停下來／比自己慢的狗也算等待（看整個關卡長度）。
        var toGo = nx.s0 - o.s, reach = lat * toGo / Math.max(o.v, 3) + 0.2, best = o.slot, bc = 1e9, near = 0, nd = 1e9;
        for (var k = 0; k < n; k++) {
          var cx = slotX(k), dd = cx - o.x;
          if (dd < 0) dd = -dd;
          if (dd < nd) { nd = dd; near = k; }
          var cost = dd + (dd > reach ? (dd - reach) * 6 : 0) - (k === o.slot ? 0.3 : 0);
          for (var q2 = 0; q2 < n; q2++) {
            var z2 = dogs[q2];
            if (z2 === o || z2.done) continue;
            var dp2 = S0[q2] - o.s, dx2 = X0[q2] - cx;
            if (!(dx2 < 0.8 && dx2 > -0.8) || dp2 <= -1.2 || dp2 >= toGo + nx.len) continue;
            if (dp2 < toGo + 6) cost += 50;                                     // 入口被佔住
            else if (V0[q2] < 1) cost += 8;                                     // 關卡裡停下來的狗（吃零食、接飛盤、摔倒…）
            else if (V0[q2] < o.v - 0.5) cost += 1.5 + (o.v - V0[q2]) * 0.6;   // 比自己慢的狗
          }
          if (cost < bc) { bc = cost; best = k; }
        }
        // 實況：後半的狗因為最近的那一道被佔住而改排別道
        if (events && toGo < 3 && o.queueEv !== pi) { o.queueEv = pi; if (best !== near && ranks[di] > n / 2) ev("queue", di, best + 1); }
        o.slot = best; xt = slotX(best);
      } else if (p.type === "curve") {
        // 彎道：依跑線偏好靠內／中間／外側（彎道內側＝turn 的正負決定）
        var sg = p.turn > 0 ? 1 : -1;
        xt = o.lineId === "rail" ? sg * (XMAX - 0.3) : o.lineId === "wide" ? -sg * 1.6 : sg * 1.0;
        toward = xt - o.x;
      }
      // 前方有沒有狗：擋住（貼得很近）或想超車（比前面快）
      var ahead = -1, gap = 99;
      for (var q = 0; q < n; q++) {
        var z = dogs[q];
        if (q === di || z.done) continue;
        var dp = S0[q] - o.s, dx = X0[q] - o.x;
        if (dp > 0 && dp < 5 && dx < DOG_W + 0.12 && dx > -DOG_W - 0.12 && dp < gap) { gap = dp; ahead = q; }
      }
      if (ahead >= 0) {
        var av = V0[ahead], boxed = false;
        if (isOpen(p) && !approach && (gap < LOOK || vt > av + 0.3)) {
          // 找空檔：往自己想去的那一側優先
          var c1 = o.x + (toward > 0 ? 1 : -1) * 0.95, c2 = o.x - (toward > 0 ? 1 : -1) * 0.95;
          if (c1 > -XMAX && c1 < XMAX && laneFree(o, c1, -1.6, 1.6)) xt = c1;
          else if (c2 > -XMAX && c2 < XMAX && laneFree(o, c2, -1.6, 1.6)) xt = c2;
          else boxed = gap < LOOK;
        } else boxed = gap < LOOK;
        if (boxed) {
          vt = Math.min(vt, av + (gap - 1.2) * 2.5);
          if (events && t - o.blockEv > 3) { o.blockEv = t; ev("boxed", di, ahead); }
        }
        if (gap < 1.15) vt = Math.min(vt, av - 0.3);
      }
      o.xt = clamp(xt, -XMAX, XMAX); o.lat = lat;
      return Math.max(0, vt);
    }

    while (t < MAX_T) {
      var alive = 0;
      rankInto(dogs, ranks);
      // 對決：用這一步開始時的位置配對（與處理順序無關）
      for (var dz = 0; dz < n; dz++) {
        var oz = dogs[dz];
        if (oz.duel >= 0) {
          var pz = dogs[oz.duel], gz = pz.s - oz.s;
          if (oz.done || pz.done || gz > DUEL_END || gz < -DUEL_END) { oz.duel = -1; }
        }
      }
      for (var zr = 0; zr < n; zr++) byRank[ranks[zr] - 1] = zr;
      for (var ra = 1; ra < n; ra++) {
        var A = byRank[ra - 1], B = byRank[ra];
        var oa = dogs[A], ob = dogs[B];
        if (oa.done || ob.done || oa.duelUsed || ob.duelUsed || oa.duel >= 0 || ob.duel >= 0) continue;
        if (oa.s / L < DUEL_PROG || ob.s / L < DUEL_PROG || oa.timer > 0 || ob.timer > 0) continue;
        if (!isOpen(partAt(course, oa.s)) || !isOpen(partAt(course, ob.s))) continue;
        var gab = oa.s - ob.s;
        if (gab > DUEL_GAP || gab < -DUEL_GAP) continue;
        if (crowd && (oa.x - ob.x > DUEL_LAT || ob.x - oa.x > DUEL_LAT)) continue;
        oa.duel = B; ob.duel = A; oa.duelUsed = ob.duelUsed = true; duelN++;
        ev("duel", A, B);
      }
      if (crowd) {
        for (var z0 = 0; z0 < n; z0++) { S0[z0] = dogs[z0].s; X0[z0] = dogs[z0].x; V0[z0] = dogs[z0].v; }
        // 比賽中的指令：喊「賽狗」（每場每隻 SHOUT_MAX 次、間隔 SHOUT_GAP 步，成功機率 SHOUT_P）
        var RL = Real(), cl = cmdAt[step];
        if (cl) for (var ci = 0; ci < cl.length; ci++) {
          var cm = cl[ci], co = dogs[cm.d];
          if (co.done || co.shoutN >= RL.SHOUT_MAX || step - co.lastShout < RL.SHOUT_GAP || t < co.react) continue;
          co.shoutN++; co.lastShout = step;
          var hit = RL.shoutHits(card, step, cm.d);
          if (hit) co.sta = Math.min(1, co.sta + RL.SHOUT_HEAL);
          applied.push({ k: step, d: cm.d, a: "shout", ok: hit ? 1 : 0 });
          ev(hit ? "shoutHeal" : "shout", cm.d);
        }
      }
      for (var di = 0; di < dogs.length; di++) {
        var o = dogs[di];
        if (o.done) continue;
        alive++;
        var e = o.e, r = o.r;
        if (crowd) {
          // 閘門反應（專注越高越快），偶爾出閘慢
          if (t < o.react) { o.mode = MODE.wait; continue; }
          if (!o.started) { o.started = true; ev(o.slow ? "slowStart" : o.react < 0.16 ? "goodBreak" : "go", di); }
        }
        // 每秒換一次隨機起伏（陣風越強越大）
        o.jitT -= DT;
        if (o.jitT <= 0) { o.jitT = 1; o.jit = 1 - gust + r() * gust * 2; }
        var pi = 0, ps = course.parts;
        for (var q = ps.length - 1; q >= 0; q--) if (o.s >= ps[q].s0) { pi = q; break; }
        var p = ps[pi], local = o.s - p.s0;
        if (pi !== o.part) { o.part = pi; o.flag = 0; o.tries = 0; o.airT = 0; if (events && p.type !== "straight" && p.type !== "curve") ev("enter", di, pi); }
        var prog = o.s / L;
        var pace = prog < o.pace.at ? o.pace.early : o.pace.late;
        if (prog > 0.85 && o.sta > 0.3) pace += 0.03;   // 最後直線還有力氣就衝
        // 暴衝：開始、每 KAKARI_CHECK 秒擲一次冷靜、最多 KAKARI_MAX 秒
        if (o.kk === 1 && prog >= o.kkAt) { o.kk = 2; o.kkOn = true; o.kkT = t; o.kkNext = t + KAKARI_CHECK; ev("kakari", di); }
        else if (o.kkOn && t >= o.kkNext) {
          if (t - o.kkT >= KAKARI_MAX - 1e-9 || o.kr() < KAKARI_CALM) { o.kkOn = false; ev("calm", di); }
          else o.kkNext = t + KAKARI_CHECK;
        }
        // 技能：符合條件時發動（每個限一次），加成在持續時間內套用到目標速度與加速度
        var bo = o.sk.length ? SK.tick(o.sk, { prog: prog, sect: p.type === "curve" ? "curve" : p.type === "straight" ? "straight" : "other", style: o.style, weather: wx, ground: card.ground, sta: o.sta, rank: ranks[di], n: dogs.length, kakari: o.kkOn, duel: o.duel >= 0 }, t, SK.SCALE_CLASSIC) : null;
        o.boost = bo;
        if (bo && bo.heal) o.sta = Math.min(1, o.sta + bo.heal);
        if (bo && bo.fired) for (var fi = 0; fi < bo.fired.length; fi++) ev("skill", di, bo.fired[fi]);
        if (bo && bo.calm && o.kkOn) { o.kkOn = false; ev("calm", di, 1); }
        if (o.kkOn && pace < KAKARI_PACE) pace = KAKARI_PACE;
        var duelK = o.duel >= 0 ? 1 + duelBonus(e, o.sta) : 1;
        var vt = o.vmax * pace * o.jit * o.day * (bo ? 1 + bo.spd : 1) * duelK;
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
          if (crowd) {
            // 實際半徑依橫向位置；跑外側的狗習慣大弧度過彎、不太減速（抵銷多跑的距離）
            var Rx = Math.max(4, R - o.x * (p.turn > 0 ? 1 : -1));
            vt = Math.min(vt * (1 + o.lineB), Math.sqrt(Rx * 9.8 * grip) * (1 + o.lineB));
          } else vt = Math.min(vt, Math.sqrt(R * 9.8 * grip));
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

        if (crowd) vt = crowdSteer(o, di, pi, p, vt);
        // 加減速
        if (o.v < vt) o.v = Math.min(vt, o.v + o.acc * (o.boost ? 1 + o.boost.acc : 1) * (o.duel >= 0 ? 1.3 : 1) * DT);
        else o.v = Math.max(vt, o.v - 9 * DT);
        // 耐力：速度比例四次方 × 場地 × 炎熱
        var ratio = o.v / o.vmax;
        var heat = hot ? 1.15 : 1;
        o.sta -= ratio * ratio * ratio * ratio * STA_K * drain * g.stam * heat * (o.kkOn ? KAKARI_DRAIN : 1) * DT / (0.5 + e.sta * 0.01);
        if (o.v < 0.5) o.sta += 0.03 * DT;
        o.sta = clamp(o.sta, 0, 1);
        var prev = o.s, fac = 1;
        if (crowd) {
          var lm = o.lat * DT;
          o.x = clamp(o.x + clamp(o.xt - o.x, -lm, lm), -XMAX, XMAX);
          if (p.type === "curve") { var Rc = p.len / (Math.abs(p.turn) * Math.PI / 180); fac = Rc / Math.max(4, Rc - o.x * (p.turn > 0 ? 1 : -1)); }
        }
        o.s += o.v * DT * fac;
        o.mode = mode;
        if (o.s >= L) {
          o.done = true;
          o.time = Math.round((t + (o.v > 0 ? (L - prev) / (o.v * fac) : DT)) * 1000) / 1000;
          o.s = L; o.mode = MODE.fin;
          ev("finish", di, o.time);
        }
      }
      if (crowd) {
        // 碰撞（搶道）：直道／彎道上互相推開、都掉速度（體型大的掉得少）；關卡裡同一位置不能重疊，後面的狗被擋在後面
        for (var a = 0; a < n; a++) {
          var PA = dogs[a];
          if (PA.done || t < PA.react) continue;
          for (var b = a + 1; b < n; b++) {
            var QB = dogs[b];
            if (QB.done || t < QB.react) continue;
            var ddp = PA.s - QB.s, ddx = PA.x - QB.x;
            if (!(ddp > -DOG_L && ddp < DOG_L && ddx > -DOG_W && ddx < DOG_W)) continue;
            if (isOpen(partAt(course, PA.s)) && isOpen(partAt(course, QB.s))) {
              var sg2 = ddx > 0 || (ddx === 0 && a > b) ? 1 : -1, push = (DOG_W - (ddx < 0 ? -ddx : ddx)) / 2 + 0.02;
              PA.x = clamp(PA.x + sg2 * push, -XMAX, XMAX); QB.x = clamp(QB.x - sg2 * push, -XMAX, XMAX);
              var key = a * 16 + b;
              if (!(bumpAt[key] > t - 1.2)) {
                bumpAt[key] = t;
                PA.v *= 1 - clamp(0.035 + 0.01 * (QB.size - PA.size), 0.01, 0.06);
                QB.v *= 1 - clamp(0.035 + 0.01 * (PA.size - QB.size), 0.01, 0.06);
                PA.sta = Math.max(0, PA.sta - 0.01); QB.sta = Math.max(0, QB.sta - 0.01);
                ev("bump", a, b);
              }
            } else {
              var fr2 = ddp >= 0 ? PA : QB, rr = fr2 === PA ? QB : PA;
              rr.s = Math.max(S0[rr.i], Math.min(rr.s, fr2.s - DOG_L));
              rr.v = Math.min(rr.v, fr2.v);
            }
          }
        }
      }
      t += DT; step++;
      if (frames) {
        var FS = crowd ? 4 : 3, f = new Float32Array(dogs.length * FS);
        for (var k = 0; k < dogs.length; k++) {
          var Zk = dogs[k], mk = Zk.mode + (Zk.sta * 0.99);
          if (crowd) { f[k * 4] = Zk.s; f[k * 4 + 1] = Zk.x; f[k * 4 + 2] = Zk.v; f[k * 4 + 3] = mk; }
          else { f[k * 3] = Zk.s; f[k * 3 + 1] = Zk.v; f[k * 3 + 2] = mk; }
        }
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
    var out = {
      order: order,
      times: dogs.map(function (o) { return o.time; }),
      frames: frames, events: events, dt: DT, cmds: crowd ? applied : [],
      duration: Math.min(t, MAX_T)
    };
    // 真賽狗：frames 每隻 4 格 [里程, 橫向, 速度, 模式+體力]，和舊版橢圓跑道同格式（stateAt／rankAt 共用 saigo_real.js）
    if (crowd) { out.real = true; out.crowd = true; }
    // 照片判定：第 1、2 名差不到 PHOTO_GAP 秒
    var t1 = out.times[order[0]], t2 = order.length > 1 ? out.times[order[1]] : null;
    if (t1 !== null && t2 !== null && t2 - t1 < PHOTO_GAP) out.photo = { a: order[0], b: order[1], gap: Math.round((t2 - t1) * 1000) / 1000 };
    out.duels = duelN;
    return out;
  }

  // 目前名次（1 起）：已完走的依時間在前，其餘依里程
  function rankInto(dogs, out) {
    for (var i = 0; i < dogs.length; i++) {
      var r = 1, a = dogs[i];
      for (var j = 0; j < dogs.length; j++) {
        if (j === i) continue;
        var b = dogs[j];
        if (b.done && (!a.done || b.time < a.time || (b.time === a.time && j < i))) r++;
        else if (!b.done && !a.done && (b.s > a.s || (b.s === a.s && j < i))) r++;
      }
      out[i] = r;
    }
  }

  // 第 t 秒的狀態（內插）。回傳 [{ s, v, mode, sta }]
  function stateAt(result, t) {
    if (result.real) return Real().stateAt(result, t);
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
    if (result.real) return Real().rankAt(result, t);
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
  // 用不同 seed 試跑 SIMS 場，數出每隻得第 1／2／3 名的次數（加平滑）。
  // 名次組合的機率用「分名次強度」模型（Lo–Bacon-Shone 的 Harville 修正）：
  //   P(a 第1, b 第2, c 第3) = p1[a] × s2[b]/(1−s2[a]) × s3[c]/(1−s3[a]−s3[b])
  // p1＝試跑勝率；s2、s3 反覆調整到「模型推出的第 2、3 名機率」等於試跑的第 2、3 名機率。
  // 舊版只用勝率套 Harville，會低估冷門狗擠進前三的機率（寬、三連複的回收率曾經超過 100%）。
  // 只用四則運算，所有裝置算出的數字一樣。
  var SIMS_CLASSIC = 200, SMOOTH_CLASSIC = 0.5, FIT_ITERS = 40;
  // 下限 1.0＝JRA 的「元返し」；賠率以 0.1 為單位無條件捨去（JRA 派彩以 10 円為單位捨去）
  var ODDS_MIN = 1.0, ODDS_MAX = 9999.9;
  function oddsValue(v) { return clamp(Math.floor(v * 10 + 1e-9) / 10, ODDS_MIN, ODDS_MAX); }
  // 真賽狗（8 隻、搶道）比較隨機：平滑 1.0，冷門狗的賠率才不會開太高。
  // 舊版橢圓跑道試跑 300 場；關卡地圖版一場比較長，試跑 200 場（和關卡賽相同，出賽表約 1 秒）
  function placeProbs(card) {
    var real = card.mode === "real", SIMS = real ? (card.course ? SIMS_CLASSIC : 300) : SIMS_CLASSIC, SMOOTH = real ? 1.0 : SMOOTH_CLASSIC;
    var n = card.dogs.length, c1 = [], c2 = [], c3 = [], i, j, k, it;
    for (i = 0; i < n; i++) { c1.push(0); c2.push(0); c3.push(0); }
    for (var m = 0; m < SIMS; m++) {
      var o = simulate(card, false, (card.seed + 7919 * (m + 1)) >>> 0).order;
      c1[o[0]]++; c2[o[1]]++; if (n > 2) c3[o[2]]++;
    }
    function sm(c) { return c.map(function (x) { return (x + SMOOTH) / (SIMS + SMOOTH * n); }); }
    var p1 = sm(c1), e2 = sm(c2), e3 = sm(c3), s2 = e2.slice(), s3 = e3.slice();
    function norm(a) { var t = 0; a.forEach(function (x) { t += x; }); return a.map(function (x) { return x / t; }); }
    function ex(a, b) { return p1[a] * s2[b] / Math.max(1 - s2[a], 1e-9); }
    function tri(a, b, c) { return ex(a, b) * s3[c] / Math.max(1 - s3[a] - s3[b], 1e-9); }
    for (it = 0; it < FIT_ITERS; it++) {
      var q2 = [];
      for (j = 0; j < n; j++) { var t2 = 0; for (i = 0; i < n; i++) if (i !== j) t2 += ex(i, j); q2.push(t2); }
      s2 = norm(s2.map(function (x, z) { return x * e2[z] / Math.max(q2[z], 1e-12); }));
    }
    for (it = 0; it < FIT_ITERS; it++) {
      var q3 = [];
      for (k = 0; k < n; k++) {
        var t3 = 0;
        for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (i !== j && i !== k && j !== k) t3 += tri(i, j, k);
        q3.push(t3);
      }
      s3 = norm(s3.map(function (x, z) { return x * e3[z] / Math.max(q3[z], 1e-12); }));
    }
    var prob = { win: {}, place: {}, quinella: {}, exacta: {}, wide: {}, trio: {}, trifecta: {} };
    // 複勝：7 隻以下＝前 2 名、8 隻以上＝前 3 名（JRA 規則）
    var top3 = placeK(n) === 3;
    for (i = 0; i < n; i++) {
      prob.win[i] = p1[i];
      var pl = p1[i];
      for (j = 0; j < n; j++) if (j !== i) {
        pl += ex(j, i);
        if (top3) for (k = 0; k < n; k++) if (k !== i && k !== j) pl += tri(j, k, i);
      }
      prob.place[i] = pl;
    }
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      if (i === j) continue;
      prob.exacta[i + "-" + j] = ex(i, j);
      if (i < j) prob.quinella[i + "-" + j] = ex(i, j) + ex(j, i);
      for (k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        var pr = tri(i, j, k), srt = [i, j, k].sort(function (x, y) { return x - y; });
        prob.trifecta[i + "-" + j + "-" + k] = pr;
        prob.trio[srt.join("-")] = (prob.trio[srt.join("-")] || 0) + pr;
        [[srt[0], srt[1]], [srt[0], srt[2]], [srt[1], srt[2]]].forEach(function (pair) {
          var wk = pair.join("-");
          prob.wide[wk] = (prob.wide[wk] || 0) + pr;
        });
      }
    }
    return { p: p1, prob: prob };
  }
  function placeK(n) { return n >= 8 ? 3 : 2; }
  function odds(card) {
    if (card._odds) return card._odds;
    var pp = placeProbs(card), out = { p: pp.p, prob: pp.prob };
    D.BET_TYPES.forEach(function (bt) {
      var o = {};
      Object.keys(pp.prob[bt.id]).forEach(function (key) { o[key] = oddsValue(bt.take / Math.max(pp.prob[bt.id][key], 1e-6)); });
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
    if (card.mode === "real") return JSON.parse(JSON.stringify(card, function (k, v) { return k.charAt(0) === "_" ? undefined : v; }));
    var c = JSON.parse(JSON.stringify({ v: card.v, seed: card.seed, cls: card.cls, terrain: card.terrain, dist: card.dist, weather: card.weather, ground: card.ground, course: { parts: card.course.parts, length: card.course.length }, dogs: card.dogs, pm: card.pm ? 1 : 0, w5: card.w5 || null, cup: card.cup || null, prizeMult: card.prizeMult || 0 }));
    return c;
  }

  // 著差（日本賽馬的說法）：時間差 × 到終點時的速度 ≈ 差幾公尺；狗身長約 1 m
  //   nose 鼻差（< 0.15 m）、head 頭差（< 0.3）、neck 頸差（< 0.55）、half 半身（< 0.8）、len 1 身以上（顯示秒數）
  function marginKind(dt, v) {
    var m = dt * (v || 15);
    return m < 0.15 ? "nose" : m < 0.3 ? "head" : m < 0.55 ? "neck" : m < 0.8 ? "half" : "";
  }

  // 場地編號（seed 的 16 進位，8 碼）
  function courseCode(card) { var h = (card.seed >>> 0).toString(16).toUpperCase(); while (h.length < 8) h = "0" + h; return h; }

  window.PriTestSaigoCore = {
    courseCode: courseCode,
    DT: DT, MODE: MODE, stepOf: stepOf, LANE_W: LANE_W, DOCK_RUN: DOCK_RUN, LOOP_IN: LOOP_IN, LOOP_R: LOOP_R, LOOP_C: LOOP_C,
    rng: rng, hashStr: hashStr, newSeed: newSeed, clamp: clamp, weighted: weighted, between: between, pick: pick,
    fieldPace: fieldPace, PACE: PACE, STA_K: STA_K, DAY: DAY, CPU_BW: CPU_BW, CPU_ADJ: CPU_ADJ, placeK: placeK,
    makeCard: makeCard, effStats: effStats, simulate: simulate, stateAt: stateAt, rankAt: rankAt,
    geometry: geometry, pointAt: pointAt, partAt: partAt, laneOff: laneOff, makeCourse: makeCourse, makeFlatCourse: makeFlatCourse, CROWD_APPROACH: CROWD_APPROACH,
    odds: odds, oddsValue: oddsValue, ODDS_MIN: ODDS_MIN, popularity: popularity, cardForWire: cardForWire, paceKind: paceKind,
    preRace: preRace, kakariP: kakariP, marginKind: marginKind, PHOTO_GAP: PHOTO_GAP,
    KAKARI_PACE: KAKARI_PACE, KAKARI_DRAIN: KAKARI_DRAIN, DUEL_GAP: DUEL_GAP
  };
})();
