// 明星經紀 starV：核心引擎（純邏輯，不碰 DOM；node 也能跑，見 tools/starv_check/core_check.js）。
// 整局狀態是一個可 JSON 化的物件 st，亂數狀態存在 st.seed（mulberry32），所以存檔、模擬、離線結算都可以重現。
// 時間：現實 1 分鐘＝遊戲 1 天；advance(st, days) 逐日結算（規格 §2）。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var Roster = root.PriTestStarvRoster;
  var BAL = D.BAL;
  var VERSION = 1;
  var api = {};

  // ==== 亂數與工具 ====
  function rnd(st) {
    var t = (st.seed = (st.seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rint(st, lo, hi) { return lo + Math.floor(rnd(st) * (hi - lo + 1)); }
  function pick(st, arr) { return arr[Math.floor(rnd(st) * arr.length)]; }
  function wpick(st, map) {
    var keys = Object.keys(map), total = 0, i;
    for (i = 0; i < keys.length; i++) total += map[keys[i]];
    var r = rnd(st) * total;
    for (i = 0; i < keys.length; i++) { r -= map[keys[i]]; if (r < 0) return keys[i]; }
    return keys[keys.length - 1];
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function newId(st, prefix) { return prefix + (st.nextId++); }

  function dateOf(day) {
    return {
      year: Math.floor(day / BAL.daysPerYear) + 1,
      month: Math.floor((day % BAL.daysPerYear) / BAL.daysPerMonth) + 1,
      day: (day % BAL.daysPerMonth) + 1
    };
  }

  // 日誌：UI 依 type 找 sv_log_<type> 字串，data 放參數（藝人 id、作品名索引等）
  function log(st, type, data) {
    st.log.push({ seq: ++st.logSeq, day: st.day, type: type, data: data || {} });
    if (st.log.length > BAL.logMax) st.log.splice(0, st.log.length - BAL.logMax);
  }

  // ==== 狀態 ====
  function blankState(opts) {
    opts = opts || {};
    return {
      version: VERSION,
      seed: (opts.seed == null ? Math.floor(Math.random() * 2147483647) : opts.seed) | 0,
      day: 0, lastTickAt: opts.now || 0, era: 1,
      company: { name: opts.name || "", level: 1, rep: 0, money: BAL.startMoney, tickets: BAL.startTickets, debtMonths: 0, safeLine: BAL.startSafeLine },
      facilities: { dorm: 1, practice: 0, studio: 0, photo: 0, lounge: 0, pr: 0, scout: 0 },
      artists: [], waitlist: [], board: [], boardRefreshDay: 0, activeJobs: [], dividends: [], groups: [],
      gacha: { pity: 0, pullDay: -1, pullCount: 0, pickup: { SR: null, SSR: null }, debutShown: {} },
      codex: { owned: {}, recruitedR: 0 },
      stats: { pulls: 0, jobsDone: 0 },
      log: [], logSeq: 0, nextId: 1
    };
  }

  function create(opts) {
    var st = blankState(opts);
    // 初始化鉤子（之後的 task 在這裡加上抽卡 PICKUP、工作看板）
    return st;
  }

  // 依 base 補齊缺少的欄位：只補 undefined，既有值不動；陣列不合併
  function fillDefaults(target, base) {
    Object.keys(base).forEach(function (k) {
      if (target[k] === undefined) target[k] = clone(base[k]);
      else if (base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) &&
        target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) fillDefaults(target[k], base[k]);
    });
  }

  function migrate(st) {
    fillDefaults(st, blankState({ seed: 1 }));
    st.artists.forEach(function (a) { fillDefaults(a, ARTIST_DEFAULTS); if (!a.prof) a.prof = profInit(); });
    st.waitlist.forEach(function (w) { fillDefaults(w.artist, ARTIST_DEFAULTS); });
    st.version = VERSION;
    return st;
  }

  // ==== 藝人 ====
  function dirById(id) { return D.DIR_BY_ID[id]; }
  function topStat(dirId) {
    var w = dirById(dirId).weights, best = null;
    Object.keys(w).forEach(function (k) { if (best === null || w[k] > w[best]) best = k; });
    return best;
  }
  function capFor(rarity, apt, lb) {
    return Math.min(999, Math.round(D.RARITY[rarity].capBase * D.APT[apt].cap * (1 + (lb || 0) * BAL.limitBreakCap)));
  }
  function recomputeCaps(a) {
    D.STATS.forEach(function (s) { a.caps[s] = capFor(a.rarity, a.apt[s], a.limitBreak); });
  }
  function profInit() {
    var p = {};
    D.DIRS.forEach(function (d) { p[d.id] = { lv: 1, xp: 0 }; });
    return p;
  }
  function makeLook(st) {
    var L = D.LOOK;
    return {
      face: rint(st, 0, L.face - 1), hair: rint(st, 0, L.hair - 1), hairColor: rint(st, 0, L.hairColors.length - 1),
      eye: rint(st, 0, L.eye - 1), outfit: rint(st, 0, L.outfit - 1), acc: rint(st, -1, L.acc - 1), skin: rint(st, 0, L.skins.length - 1)
    };
  }

  // 藝人欄位的預設值（migrate 也用這份補齊舊存檔）
  var ARTIST_DEFAULTS = {
    rosterId: null, nameSeed: 0, gender: "f", age: 18, traits: [], subDirs: [],
    stamina: 100, stress: 0, mood: 0, fame: 0, satisfaction: 70, salary: 1500,
    policy: "idle", lastAuto: null, task: null, works: [], limitBreak: 0, joinedDay: 0
  };

  function baseArtist(st, rarity) {
    var a = clone(ARTIST_DEFAULTS);
    a.id = newId(st, "a");
    a.rarity = rarity;
    a.nameSeed = rint(st, 0, 999999);
    a.joinedDay = st.day;
    a.stats = {}; a.apt = {}; a.caps = {};
    a.prof = profInit();
    a.dir = D.DIRS[0].id;
    a.look = null;
    return a;
  }

  // 能力合計依「適性 × (1 + 2 × 方向權重) × 隨機」分配，並受潛力上限限制
  function distributeStats(st, a, total) {
    var w = {}, sum = 0, dw = dirById(a.dir).weights;
    D.STATS.forEach(function (s) {
      w[s] = D.APT[a.apt[s]].mult * (1 + 2 * (dw[s] || 0)) * (0.8 + rnd(st) * 0.4);
      sum += w[s];
    });
    recomputeCaps(a);
    D.STATS.forEach(function (s) { a.stats[s] = Math.min(a.caps[s], Math.round(total * w[s] / sum)); });
  }

  function genR(st) {
    var R = D.RARITY.R, a = baseArtist(st, "R");
    a.gender = rnd(st) < 0.5 ? "f" : "m";
    a.age = rint(st, 16, 28);
    a.dir = pick(st, D.DIRS).id;
    D.STATS.forEach(function (s) { a.apt[s] = wpick(st, D.R_APT_WEIGHTS); });
    var top = topStat(a.dir);
    if (D.APT_ORDER.indexOf(a.apt[top]) > 2) a.apt[top] = "B";
    distributeStats(st, a, rint(st, R.statTotal[0], R.statTotal[1]));
    var nT = rint(st, R.traits[0], R.traits[1]);
    while (a.traits.length < nT) {
      var t = pick(st, D.TRAITS).id;
      if (a.traits.indexOf(t) < 0) a.traits.push(t);
    }
    a.salary = Math.round(rint(st, R.salary[0], R.salary[1]) / 100) * 100;
    a.look = makeLook(st);
    return a;
  }

  function fromRoster(st, e) {
    var a = baseArtist(st, e.rarity);
    a.rosterId = e.id;
    a.gender = e.gender; a.age = e.age; a.dir = e.dir;
    a.subDirs = e.subDirs.slice(); a.traits = e.traits.slice();
    D.STATS.forEach(function (s) { a.apt[s] = e.apt[s]; });
    recomputeCaps(a);
    D.STATS.forEach(function (s) { a.stats[s] = Math.min(a.caps[s], e.stats[s]); });
    a.salary = D.RARITY[e.rarity].salary[0];
    a.look = clone(e.look);
    return a;
  }

  function artistName(a, lang) {
    lang = lang === "zh" ? "zh" : "ja";
    if (a.rosterId) {
      var e = Roster.byId(a.rosterId);
      return e ? (e.name[lang] || e.name.zh) : D.UNKNOWN_NAME[lang];
    }
    var N = D.NAMES[lang], givenList = N[a.gender] || N.f;
    var fam = N.family[a.nameSeed % N.family.length];
    var giv = givenList[Math.floor(a.nameSeed / N.family.length) % givenList.length];
    return lang === "ja" ? fam + " " + giv : fam + giv;
  }

  function capacity(st) { return D.DORM_CAP[st.facilities.dorm] || D.DORM_CAP[1]; }
  function artistById(st, id) {
    for (var i = 0; i < st.artists.length; i++) if (st.artists[i].id === id) return st.artists[i];
    return null;
  }

  // 特質與 SSR 專屬技能的 fx 彙整（§3.2）
  function fxList(a) {
    var out = [];
    a.traits.forEach(function (id) { var t = D.TRAIT_BY_ID[id]; if (t) out.push(t.fx); });
    if (a.rosterId) { var e = Roster.byId(a.rosterId); if (e && e.skill) out.push(e.skill.fx); }
    return out;
  }
  function fxMult(a, key) {
    var m = 1;
    fxList(a).forEach(function (f) { if (typeof f[key] === "number") m *= f[key]; });
    return m;
  }
  function fxDirMult(a, dir) {
    var m = 1;
    fxList(a).forEach(function (f) { if (f.perfDirs && f.perfDirs.dirs.indexOf(dir) >= 0) m *= f.perfDirs.v; });
    return m;
  }
  function fxGreatShift(a, dir) {
    var s = 0;
    fxList(a).forEach(function (f) { if (f.greatShift && f.greatShift.dirs.indexOf(dir) >= 0) s += f.greatShift.v; });
    return s;
  }
  function inPeak(a) { var p = dirById(a.dir).peak; return a.age >= p[0] && a.age <= p[1]; }

  function addProf(a, dir, xp) {
    var p = a.prof[dir];
    if (!p) p = a.prof[dir] = { lv: 1, xp: 0 };
    p.xp += xp;
    while (p.lv < 10 && p.xp >= D.PROF_XP[p.lv + 1]) p.lv++;
  }

  // ==== exports ====
  api.VERSION = VERSION;
  api.create = create;
  api.migrate = migrate;
  api.dateOf = dateOf;
  api._rnd = rnd;
  api._wpick = wpick;
  api.artistName = artistName;
  api.capacity = capacity;
  api.artistById = artistById;
  api._genR = genR;
  api._fromRoster = fromRoster;
  root.PriTestStarvCore = api;
})();
