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
    // 藝人欄位的補齊在 Task 3 加上（ARTIST_DEFAULTS）
    st.version = VERSION;
    return st;
  }

  // ==== exports ====
  api.VERSION = VERSION;
  api.create = create;
  api.migrate = migrate;
  api.dateOf = dateOf;
  api._rnd = rnd;
  api._wpick = wpick;
  root.PriTestStarvCore = api;
})();
