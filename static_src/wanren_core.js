// 萬人迷（wanren）：遊戲規則與狀態。畫面在 wanren.js、3D 在 wanren_3d.js、資料在 wanren_data.js。
// 一天的流程：早上（迷妹搭訕＋隨機事件）→ 上課（平日）／考試 → 自由時間（3D 校園，行動點）→ 晚上（約會或自主活動）→ 一天結算。
// 所有狀態放在單一 state 物件，存在 localStorage["pritest-wanren-save"]。亂數用 state.rs（mulberry32），讀檔後可重現。
(function () {
  "use strict";

  var D = window.PriTestWanrenData;
  if (!D) return;
  var SAVE_KEY = "pritest-wanren-save";
  var VERSION = 2;
  // 學期長度：pace＝學業／魅力／好感的成長倍率（越長越慢，避免第一年就全部滿值）
  // questTerm：第 2、3 個任務最早在第幾個學期開放（0＝大一春、1＝大一秋、2＝大二春…）；hours＝預估遊玩時間
  // 2026-11-06 使用者要求「預估時間更短，一個學期大約 30 分」：新增濃縮行事曆（short: true）並設為預設。
  //   濃縮版每週只玩 1 天（單週星期三、雙週星期六，都是社團日），特殊日與考試照常 → 一學期約 16 天 × 2 分鐘 ≈ 30 分鐘。
  //   legacy＝對應的「每天都玩」行事曆，用來算 span（濃縮版的 1 天約等於幾天，見 span()）。
  //   原本的 trial／year／full 保留為「慢活版」，舊存檔照常讀取。sp＝學業的成長倍率（沒寫就用 pace）。
  var LENGTHS = [
    { id: "sterm", short: true, legacy: "sterm_legacy", name: { zh: "1 學期", ja: "1 学期" }, time: { zh: "約 30 分鐘", ja: "約 30 分" }, hours: 0.5, pace: 2.6, sp: 2.6, questTerm: [0, 0, 0] },
    { id: "syear", short: true, legacy: "year", name: { zh: "1 學年", ja: "1 学年" }, time: { zh: "約 1.2 小時", ja: "約 1.2 時間" }, hours: 1.2, pace: 1.6, sp: 1.8, questTerm: [0, 0, 1] },
    { id: "sfull", short: true, legacy: "full", name: { zh: "完整版（3 學年）", ja: "フル（3 学年）" }, time: { zh: "約 3.5 小時", ja: "約 3.5 時間" }, hours: 3.5, pace: 0.75, sp: 1.15, questTerm: [0, 1, 2] },
    { id: "trial", slow: true, name: { zh: "慢活・體驗版（4 週）", ja: "スロー・体験版（4 週間）" }, hours: 1, pace: 1, questTerm: [0, 0, 0] },
    { id: "year", slow: true, name: { zh: "慢活・1 學年", ja: "スロー・1 学年" }, hours: 8, pace: 0.6, questTerm: [0, 0, 1] },
    { id: "full", slow: true, name: { zh: "慢活・完整版", ja: "スロー・フル" }, hours: 24, pace: 0.38, questTerm: [0, 1, 2] }
  ];
  var STATS = [
    { id: "study", icon: "📖", name: { zh: "學業", ja: "学業" } },
    { id: "charm", icon: "✨", name: { zh: "魅力", ja: "魅力" } },
    { id: "stamina", icon: "💪", name: { zh: "體力", ja: "体力" } },
    { id: "money", icon: "💰", name: { zh: "金錢", ja: "お金" } },
    { id: "rep", icon: "🗣", name: { zh: "風評", ja: "評判" } }
  ];
  var STAT_BY_ID = {};
  STATS.forEach(function (s) { STAT_BY_ID[s.id] = s; });
  var STAGES = [
    { min: -1, name: { zh: "未相遇", ja: "未対面" } },
    { min: 0, name: { zh: "認識", ja: "顔見知り" } },
    { min: 20, name: { zh: "朋友", ja: "友達" } },
    { min: 40, name: { zh: "好感", ja: "好感" } },
    { min: 60, name: { zh: "心動", ja: "ときめき" } },
    { min: 80, name: { zh: "喜歡", ja: "大好き" } },
    { min: 999, name: { zh: "交往中", ja: "交際中" } }
  ];
  var WD = ["一", "二", "三", "四", "五", "六", "日"];
  var WD_JA = ["月", "火", "水", "木", "金", "土", "日"];

  // ---------------- 亂數 ----------------
  function rand(s) {
    var t = (s.rs = (s.rs + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function ri(s, a, b) { return a + Math.floor(rand(s) * (b - a + 1)); }
  function pick(s, arr) { return arr[Math.floor(rand(s) * arr.length)]; }
  // 不消耗亂數狀態的雜湊（當天的位置、話題等：重複查詢結果一樣）
  function hash() {
    var h = 2166136261;
    for (var i = 0; i < arguments.length; i++) {
      var str = String(arguments[i]);
      for (var j = 0; j < str.length; j++) { h ^= str.charCodeAt(j); h = Math.imul(h, 16777619); }
      h ^= 0x9e37; h = Math.imul(h, 16777619);
    }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function name(hid) { return D.L(D.HEROINE_BY_ID[hid].name); }
  function fmt(str, p) { return String(str).replace(/\{(\w+)\}/g, function (m, k) { return p && p[k] !== undefined ? p[k] : m; }); }

  // ---------------- 新遊戲 ----------------
  function newGame(opts) {
    opts = opts || {};
    var len = LENGTHS.filter(function (l) { return l.id === opts.length; })[0] || LENGTHS[2];   // 預設：濃縮完整版
    var seed = opts.seed !== undefined ? (opts.seed | 0) : (Math.floor(Math.random() * 2147483647) | 0);
    var s = {
      v: VERSION, seed: seed, rs: seed, name: String(opts.name || "新生").slice(0, 12), lengthId: len.id, length: buildCal(len.id).length,
      day: 0, phase: "morning",
      stats: { study: 20, charm: 20, stamina: 80, money: 10000, rep: 0 },
      att: { ok: 0, total: 0 }, exams: [],
      h: {}, inv: {},
      fans: 0, admirersTotal: 0, ignored: 0, rejected: 0, contacts: 0, shura: 0, dates: 0, breakups: 0,
      pool: [], events: [], flags: {}, history: [], today: null, summary: null, promoted: []
    };
    registerDyn(s);   // 上一場轉正的迷妹要先移除
    ensureFields(s);
    // 二周目：繼承上一輪的部分專長與魅力，隱藏女主角會出現（第 12 項）
    var meta = loadMeta();
    if (opts.inherit && meta.clears > 0) {
      s.ng = meta.clears;
      s.stats.charm += 10; s.stats.money += 5000;
      Object.keys(meta.lastSkills || {}).forEach(function (k) { if (s.skills[k] !== undefined) s.skills[k] = Math.round(meta.lastSkills[k] * 0.3); });
    }
    startDay(s);
    return s;
  }
  function blankHeroine() { return { aff: 0, met: false, quest: 0, dating: false, lastSeen: -99, known: { topics: {}, gifts: {} }, cooldown: -1, dates: 0, rel: 0, since: -1 }; }
  // 舊存檔或新版欄位：補上缺的
  function ensureFields(s) {
    D.HEROINES.forEach(function (hd) {
      if (!s.h[hd.id]) {
        s.h[hd.id] = blankHeroine();
        // 死黨（wanren_data5.js）：入學前就認識，一開始就有好感
        if (hd.startMet) { s.h[hd.id].met = true; s.h[hd.id].aff = hd.startAff || 0; }
      }
      var h = s.h[hd.id];
      if (h.rel === undefined) h.rel = h.dating ? 1 : 0;
      if (h.since === undefined) h.since = h.dating ? s.day : -1;
    });
    if (!s.skills) s.skills = { cook: 0, sport: 0, art: 0, music: 0, talk: 0 };
    if (s.club === undefined) s.club = null;
    ["meetupOk", "encounters", "hiddenTalks", "storySeen", "clubDays", "clubWins", "xev", "hunts", "rumorGood", "rumorBad", "sns", "snsPosts", "polaroids", "chatSeq", "chatReplies", "affirmed", "nightTalks", "dokiN", "dokiPerfect"].forEach(function (k) { if (s[k] === undefined) s[k] = 0; });
    // 2026-11-05 擴充：轉正的迷妹、傳聞紀錄、穿搭、房間
    if (!s.promoted) s.promoted = [];
    if (!s.rumorLog) s.rumorLog = [];
    if (!s.outfits) s.outfits = { casual: 1 };
    if (!s.outfit) s.outfit = "casual";
    if (!s.room) s.room = {};
    if (!s.chat) s.chat = {};   // 手機聊天
    if (!s.newAch) s.newAch = [];
    return s;
  }

  // ---------------- 跨存檔的紀錄：成就、回憶、結局、稱號、通關次數（第 8、12 項） ----------------
  var META_KEY = "pritest-wanren-meta";
  function loadMeta() {
    var m = null;
    try { m = JSON.parse(window.localStorage.getItem(META_KEY) || "null"); } catch (e) { m = null; }
    m = m || {};
    m.clears = m.clears || 0; m.ach = m.ach || {}; m.mem = m.mem || {}; m.endings = m.endings || {}; m.titles = m.titles || {};
    return m;
  }
  function saveMeta(m) { try { window.localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) { /* 記不住也能玩 */ } }
  function unlock(s, id) {
    var m = loadMeta();
    if (m.ach[id]) return false;
    var a = D.ACHIEVEMENTS.filter(function (x) { return x.id === id; })[0];
    if (!a) return false;
    m.ach[id] = Date.now();
    saveMeta(m);
    s.newAch.push(id);
    return true;
  }
  function memory(s, id, title, text, hid) {
    var m = loadMeta();
    if (m.mem[id]) return;
    m.mem[id] = { title: title, text: text, hid: hid || null, at: Date.now() };
    saveMeta(m);
  }
  function takeNewAchievements(s) { var a = s.newAch.slice(); s.newAch.length = 0; return a; }
  // 各種成就的條件：每次行動後由畫面呼叫
  function checkAchievements(s) {
    // 主要女主角＝原本的 15 人；追加的 50 人（ext）另外算
    var mains = D.HEROINES.filter(function (hd) { return !hd.hidden && !hd.ext; });
    var met = mains.filter(function (hd) { return s.h[hd.id].met; }).length;
    var everyone = D.HEROINES.filter(function (hd) { return !hd.hidden && !hd.dyn; });
    var metAll = everyone.filter(function (hd) { return s.h[hd.id].met; }).length;
    var lovers = loversOf(s).length;
    var maxRel = D.HEROINES.reduce(function (a, hd) { return Math.max(a, s.h[hd.id].rel || 0); }, 0);
    if (met >= 1) unlock(s, "meet1");
    if (met >= mains.length) unlock(s, "meetAll");
    if (metAll >= 30) unlock(s, "meet30");
    if (metAll >= everyone.length) unlock(s, "meetEvery");
    if ((s.xev || 0) + s.encounters >= 50) unlock(s, "events50");
    if (loversOf(s).some(function (hid) { return D.HEROINE_BY_ID[hid].group === "kouhai"; })) unlock(s, "kouhaiLover");
    if (s.flags.parentOK) unlock(s, "parentOK");
    if (s.dates >= 1) unlock(s, "date1");
    if (s.dates >= 50) unlock(s, "date50");
    if (lovers >= 1) unlock(s, "lover1");
    if (lovers >= 3) unlock(s, "lover3");
    if (lovers >= 5) unlock(s, "lover5");
    if (s.flags.harem) unlock(s, "harem");
    if (maxRel >= 2) unlock(s, "rel2");
    if (maxRel >= 3) unlock(s, "rel3");
    if (maxRel >= 4) unlock(s, "rel4");
    if (s.exams.some(function (e) { return e.score >= 95; })) unlock(s, "exam95");
    if (s.fans >= 100) unlock(s, "fans100");
    if (s.fans >= 1000) unlock(s, "fans1000");
    if (s.ignored >= 100) unlock(s, "ignore100");
    if (s.clubWins > 0) unlock(s, "clubWin");
    if (Object.keys(s.skills).some(function (k) { return s.skills[k] >= 80; })) unlock(s, "skill80");
    if (s.hiddenTalks >= 5) unlock(s, "hidden");
    if (s.encounters >= 20) unlock(s, "encounter20");
    if (s.meetupOk >= 10) unlock(s, "meetup10");
    if (s.storySeen >= 10) unlock(s, "story10");
    if (s.flags.hiyori) unlock(s, "hiyori");
    // 2026-11-05 擴充：照片圖鑑（meta.ph）與新玩法的成就
    var m = loadMeta();
    if (recordPhotos(s, m)) saveMeta(m);
    var ph = m.ph || {}, phN = Object.keys(ph).length;
    if (phN >= 30) unlock(s, "photo30");
    if (phN >= 100) unlock(s, "photo100");
    if (phN >= PHOTO_POOL.length) unlock(s, "photoAll");
    if (Object.keys(ph).some(function (k) { return ph[k].l.length >= 2; })) unlock(s, "photoFate");
    if (s.promoted.length) unlock(s, "fanUp");
    if (loversOf(s).some(function (hid) { return D.HEROINE_BY_ID[hid].dyn; })) unlock(s, "fanLover");
    if (s.hunts >= 10) unlock(s, "hunt10");
    if (s.rumorGood >= 15) unlock(s, "rumorGood");
    if (D.FURNITURE && D.FURNITURE.every(function (f) { return s.room[f.id]; })) unlock(s, "roomFull");
    if (D.OUTFITS && D.OUTFITS.every(function (o) { return s.outfits[o.id]; })) unlock(s, "outfitAll");
    if ((m.pol || []).length >= 20) unlock(s, "polaroid20");
    if (s.sns >= 1000) unlock(s, "sns1000");
    if (s.chatReplies >= 50) unlock(s, "chat50");
    if (s.affirmed >= 30) unlock(s, "affirm30");
    if (s.dokiN >= 10) unlock(s, "doki10");
    if (s.dokiN >= 40) unlock(s, "doki40");
    if (s.dokiPerfect >= 10) unlock(s, "dokiPerfect10");
    if (s.nightTalks >= 10) unlock(s, "nightTalk10");
    return takeNewAchievements(s);
  }
  // 隱藏女主角要解鎖後才會出現
  // 學妹（追加的 13 人）：完整版第二學年才入學；其他模式一開始就在
  function available(s, hid, day) {
    var hd = D.HEROINE_BY_ID[hid];
    if (hd.hidden) return !!s.flags[hid];
    if (hd.group === "kouhai" && s.lengthId === "full" && cal(s, day === undefined ? s.day : day).year < 1) return false;
    return true;
  }

  // ---------------- 交往：開始與分手（第 7 項） ----------------
  function startDating(s, hid) {
    var h = s.h[hid];
    h.dating = true; h.rel = Math.max(1, h.rel || 0); h.since = s.day; h.anniv = 0;
    memory(s, "confess_" + hid, name(hid) + "・告白", D.HEROINE_BY_ID[hid].lines.cy, hid);
  }
  function breakUp(s, hid, out, line) {
    var h = s.h[hid];
    h.dating = false; h.rel = 0; h.since = -1;
    s.breakups++;
    if (out && line) out.push(line);
    rumor(s, hid, false, "和" + name(hid) + "分手了", out);
  }

  // ---------------- 專長（第 6 項） ----------------
  function addSkill(s, k, v, out) {
    if (!s.skills || s.skills[k] === undefined || !v) return 0;
    var before = s.skills[k];
    // 越高越難練（沒有下限）
    var g = v > 0 ? v * Math.pow(Math.max(0, 1 - before / 100), 1.2) * pace(s) : v;
    s.skills[k] = clamp(Math.round((before + g) * 10) / 10, 0, 100);
    var real = Math.round((s.skills[k] - before) * 10) / 10;
    if (out && real) out.push("（" + D.L(D.SKILL_BY_ID[k].name) + (real > 0 ? " +" : " ") + real + "）");
    return real;
  }
  function bestSkill(s) {
    var best = null;
    Object.keys(s.skills).forEach(function (k) { if (!best || s.skills[k] > s.skills[best]) best = k; });
    return best;
  }

  // ---------------- 天氣、考試週（第 4、11 項） ----------------
  function season(s, day) {
    var m = cal(s, day).m;
    return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter";
  }
  var WEATHER_TABLE = {
    spring: [["sunny", 0.6], ["cloudy", 0.25], ["rain", 0.15]],
    summer: [["sunny", 0.62], ["cloudy", 0.13], ["rain", 0.25]],
    autumn: [["sunny", 0.5], ["cloudy", 0.3], ["rain", 0.2]],
    winter: [["sunny", 0.35], ["cloudy", 0.4], ["snow", 0.25]]
  };
  var WEATHER_INFO = {
    sunny: { icon: "☀️", name: { zh: "晴", ja: "晴れ" } },
    cloudy: { icon: "☁️", name: { zh: "陰", ja: "くもり" } },
    rain: { icon: "🌧", name: { zh: "雨", ja: "雨" } },
    snow: { icon: "❄️", name: { zh: "雪", ja: "雪" } }
  };
  function weather(s, day) {
    if (day === undefined) day = s.day;
    var kind = dayKind(s, day);
    if (D.SPECIAL_DAYS[kind] && kind !== "summer" && kind !== "holiday") return season(s, day) === "winter" ? "snow" : "sunny";   // 活動日不下雨
    var tb = WEATHER_TABLE[season(s, day)], r = hash(s.seed, day, "weather"), acc = 0;
    for (var i = 0; i < tb.length; i++) { acc += tb[i][1]; if (r < acc) return tb[i][0]; }
    return "sunny";
  }
  // 考試週：期中／期末考前 3 天內的平日
  function examWeek(s, day) {
    if (day === undefined) day = s.day;
    if (dayKind(s, day) !== "weekday") return false;
    for (var i = 1; i <= (span(s) > 1 ? 1 : 3); i++) { var k = dayKind(s, day + i); if (EXAM_KINDS[k]) return true; }
    return false;
  }
  // 自由時間進行到第幾段（0〜2）：女主角會依時段換地點（第 10 項）
  function curSlot(s) {
    if (!s.today || s.phase !== "free" || !s.today.apMax) return 0;
    var used = s.today.apMax - s.today.ap;
    return clamp(Math.floor(used * 3 / s.today.apMax), 0, 2);
  }

  // ---------------- 行事曆 ----------------
  // 每一天＝{ y, m, d, wd（0＝一）, kind, year（0〜2）, term（學期序號）, termName }
  // 一學年：春學期 16 週 → 暑假活動日 6 天 → 秋學期 16 週（含學園祭、聖誕夜、寒假）→ 情人節 → 結業式／畢業典禮
  var calCache = {};
  function mkDay(dt, kind, year, term, termName) {
    return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), wd: (dt.getDay() + 6) % 7, kind: kind, year: year, term: term, termName: termName, t: Math.round(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) / 86400000) };
  }
  // 濃縮行事曆（2026-11-06）：特殊日、考試日全部保留；其他日子每週只留 1 天（單週星期三、雙週星期六），
  // 那一週已經有特殊日就不再留。暑假留 8/1 與夏日祭典，寒假留 1 天。
  var ORDINARY = { weekday: 1, weekend: 1, summer: 1, holiday: 1 };
  function compress(full) {
    var out = [], weeks = {}, starts = {};
    full.forEach(function (c) { if (starts[c.termName] === undefined) starts[c.termName] = c.t; });
    function wk(c) { return c.termName + "#" + Math.floor((c.t - starts[c.termName]) / 7); }
    full.forEach(function (c) { if (!ORDINARY[c.kind]) weeks[wk(c)] = true; });
    full.forEach(function (c) {
      if (!ORDINARY[c.kind]) { out.push(c); return; }
      if (c.kind === "summer") { if (c.d === 1) out.push(c); return; }
      var k = wk(c), w = Math.floor((c.t - starts[c.termName]) / 7);
      if (weeks[k]) return;
      if (c.kind === "holiday" ? c.wd === 2 || (c.m === 1 && c.d === 2) : c.wd === (w % 2 ? 5 : 2)) { weeks[k] = true; out.push(c); }
    });
    return out;
  }
  function firstMonday(y, m, d) {
    var dt = new Date(y, m, d);
    while (dt.getDay() !== 1) dt.setDate(dt.getDate() + 1);
    return dt;
  }
  function addDays(dt, n) { var x = new Date(dt.getTime()); x.setDate(x.getDate() + n); return x; }
  // 16 週的學期：期中考第 8 週三、期末考第 16 週五；extra(i, dt) 回傳特殊日 kind
  function term(out, start, weeks, year, termIdx, termName, extra) {
    for (var i = 0; i < weeks * 7; i++) {
      var dt = addDays(start, i), wd = (dt.getDay() + 6) % 7;
      var kind = wd >= 5 ? "weekend" : "weekday";
      if (i === 7 * Math.floor(weeks / 2) - 5) kind = "midterm";
      if (i === weeks * 7 - 3) kind = "final";
      var ex = extra && extra(i, dt);
      if (ex) kind = ex;
      out.push(mkDay(dt, kind, year, termIdx, termName));
    }
  }
  var YEAR_NAMES = ["大一", "大二", "大三"];
  function buildCal(lengthId) {
    if (calCache[lengthId]) return calCache[lengthId];
    var out = [];
    if (lengthId === "syear" || lengthId === "sfull") return (calCache[lengthId] = compress(buildCal(lengthId === "syear" ? "year" : "full")));
    if (lengthId === "sterm_legacy" || lengthId === "sterm") {
      // 1 學期：大一春學期（入學典禮〜期末考）
      term(out, firstMonday(2026, 3, 6), 16, 0, 0, "大一・春學期", function (i) { return i === 0 ? "entrance" : i === 6 * 7 + 5 ? "sports" : null; });
      return (calCache[lengthId] = lengthId === "sterm" ? compress(out) : out);
    }
    if (lengthId === "trial") {
      term(out, firstMonday(2026, 3, 6), 4, 0, 0, "大一・春學期", function (i) { return i === 0 ? "entrance" : i === 19 ? "festival" : null; });
      out.length = 26;
      out[25].kind = "final";
      return (calCache[lengthId] = out);
    }
    var years = lengthId === "full" ? 3 : 1;
    for (var y = 0; y < years; y++) {
      var Y = 2026 + y, yn = YEAR_NAMES[y];
      term(out, firstMonday(Y, 3, 6), 16, y, y * 2, yn + "・春學期", function (i) {
        if (i === 0) return y === 0 ? "entrance" : "newyear";
        if (i === 6 * 7 + 5) return "sports";
        return null;
      });
      [1, 6, 11, 16, 21, 26].forEach(function (d) { out.push(mkDay(new Date(Y, 7, d), d === 16 ? "summerfest" : "summer", y, y * 2, yn + "・暑假")); });
      term(out, firstMonday(Y, 8, 21), 16, y, y * 2 + 1, yn + "・秋學期", function (i, dt) {
        if (i === 6 * 7 + 5) return "festival";
        if (i === 9 * 7 + 5) return "clubcup";
        if (dt.getMonth() === 11 && dt.getDate() === 24) return "xmas";
        if ((dt.getMonth() === 11 && dt.getDate() >= 25) || (dt.getMonth() === 0 && dt.getDate() <= 4)) return "holiday";
        return null;
      });
      out.push(mkDay(new Date(Y + 1, 1, 14), "valentine", y, y * 2 + 1, yn + "・春假"));
      out.push(mkDay(new Date(Y + 1, 2, 18), y === years - 1 && years === 3 ? "graduation" : "yearend", y, y * 2 + 1, yn + "・春假"));
    }
    return (calCache[lengthId] = out);
  }
  function cal(s, day) { var c = buildCal(s.lengthId); return c[Math.min(day === undefined ? s.day : day, c.length - 1)]; }
  function weekday(s, day) { return cal(s, day).wd; }
  var CLASS_KINDS = { weekday: 1 }, EXAM_KINDS = { midterm: 1, final: 1 };
  // 沒有課的日子（週末、假日、特殊活動日）
  function isWeekend(s, day) { var k = cal(s, day).kind; return !CLASS_KINDS[k] && !EXAM_KINDS[k]; }
  function dateLabel(s, day) {
    var c = cal(s, day), ja = window.I18N && window.I18N.getLang && window.I18N.getLang() === "ja";
    return c.y + "/" + c.m + "/" + c.d + "（" + (ja ? WD_JA : WD)[c.wd] + "）";
  }
  function termName(s, day) { return cal(s, day).termName; }
  function dayKind(s, day) { return cal(s, day).kind; }
  function special(s, day) { return D.SPECIAL_DAYS[dayKind(s, day)] || null; }
  function lengthOf(s) { return LENGTHS.filter(function (l) { return l.id === (s.lengthId || "full"); })[0] || LENGTHS[2]; }
  function pace(s) { return lengthOf(s).pace; }
  // 濃縮版的 1 天約等於原本的幾天（慢活版＝1）。以「天數」寫的規則（交往 30 天紀念日、劇情機率…）用它換算。
  function span(s) {
    var l = lengthOf(s);
    return l.short ? buildCal(l.legacy).length / buildCal(l.id).length : 1;
  }
  // 「n 天前」換成濃縮版的天數
  function ago(s, realDays) { return s.day - Math.max(1, Math.round(realDays / span(s))); }

  // ---------------- 屬性 ----------------
  function applyEff(s, eff, out) {
    var parts = [];
    Object.keys(eff || {}).forEach(function (k) {
      var v = eff[k];
      if (!v || !STAT_BY_ID[k]) return;
      var before = s.stats[k];
      // 學業與魅力越高越難成長（遞減）
      // 長的模式成長比較慢（pace）
      if (k === "study" && v > 0) v = v * clamp(1.1 - before / 95, 0.04, 1) * (lengthOf(s).sp || pace(s));   // sp：濃縮版的學業另外調快（上課天數少）
      // 魅力（2026-11-02 使用者要求加難）：越接近 100 越難漲，沒有下限
      else if (k === "charm" && v > 0) v = v * Math.pow(Math.max(0, 1 - before / 100), 1.4) * pace(s);
      else if ((k === "study" || k === "charm") && v < 0) v = v * pace(s);
      if (k === "money") s.stats.money = Math.max(0, Math.round(before + v));
      else if (k === "rep") s.stats.rep = clamp(Math.round((before + v) * 10) / 10, -100, 100);
      else s.stats[k] = clamp(Math.round((before + v) * 10) / 10, 0, 100);
      var real = Math.round((s.stats[k] - before) * 10) / 10;
      if (real) parts.push(D.L(STAT_BY_ID[k].name) + (real > 0 ? " +" : " ") + (k === "money" ? "¥" + real.toLocaleString() : real));
    });
    if (parts.length && out) out.push("（" + parts.join("、") + "）");
    return parts;
  }

  // ---------------- 女主角 ----------------
  function stageOf(s, hid) {
    var h = s.h[hid];
    if (!h.met) return 0;
    if (h.dating) return 6;
    var st = 1;
    for (var i = 1; i < 6; i++) if (h.aff >= STAGES[i].min) st = i;
    return st;
  }
  function stageName(s, hid) { return D.L(STAGES[stageOf(s, hid)].name); }
  // 沒完成任務時，好感卡在下一個任務門檻 +9
  function affCap(s, hid) {
    var hd = D.HEROINE_BY_ID[hid], h = s.h[hid];
    if (h.quest >= hd.quests.length) return 100;
    return hd.quests[h.quest].at + 9;
  }
  function addAff(s, hid, n, out, ignoreCap) {
    var h = s.h[hid];
    var cap = ignoreCap ? 100 : Math.max(affCap(s, hid), h.aff);
    var before = h.aff;
    // 長的模式好感也漲得比較慢（任務與劇情的獎勵不打折）
    if (n > 0 && !ignoreCap) n = n * Math.sqrt(pace(s));
    h.aff = clamp(Math.round(h.aff + n), 0, n > 0 ? cap : 100);
    var real = h.aff - before;
    if (out) {
      if (real) out.push("（" + name(hid) + " 好感 " + (real > 0 ? "+" : "") + real + "）");
      else if (n > 0 && h.aff >= cap && cap < 100 && !ignoreCap) out.push("（" + name(hid) + " 的好感暫時到頂了，完成她的任務才能更進一步）");
    }
    return real;
  }
  function loversOf(s) { return D.HEROINES.filter(function (hd) { return s.h[hd.id].dating; }).map(function (hd) { return hd.id; }); }

  // 今天自由時間她在哪（null＝不在學校）
  // slot：自由時間的第幾段（省略＝目前）；她有 40% 機率在下一段換到別的地點
  function whereIs(s, hid, day, slot) {
    var isToday = day === undefined || day === s.day;
    if (day === undefined) day = s.day;
    if (slot === undefined) slot = isToday ? curSlot(s) : 0;
    var hd = D.HEROINE_BY_ID[hid], wd = weekday(s, day), kind = dayKind(s, day), sp = D.SPECIAL_DAYS[kind];
    if (!available(s, hid, day)) return null;
    if (hd.hidden && cal(s, day).year < 1) return null;   // 學妹第二學年才入學
    if (isToday && s.today && s.today.absent && s.today.absent[hid]) return null;   // 今天請假（感冒等事件）
    // 約好見面：她整天都在約定的地點等你
    if (isToday && s.today && s.today.meetup && s.today.meetup.hid === hid && !s.today.meetup.done) return s.today.meetup.loc;
    function spotOf(list, salt) {
      var k = slot > 0 && hash(s.seed, day, hid, "m", slot) < 0.4 ? slot : 0;
      return list[Math.floor(hash(s.seed, day, hid, salt, k) * list.length)];
    }
    // 特殊活動日：大家都來學校，聚在活動的地點
    if (sp && sp.spots) {
      // 追加的 50 人：活動日也只有一部分會來，避免一個地點擠滿二十幾個人
      if (hd.ext && hash(s.seed, day, hid, "a") < 0.6) return null;
      return spotOf(sp.spots, "f");
    }
    if (sp && sp.absent) {
      if (hash(s.seed, day, hid, "a") < sp.absent) return null;
      return spotOf(hd.spots, "s");
    }
    if (hd.days && hd.days.indexOf(wd) < 0) return null;
    if (wd === 6 && hd.group === "teacher") return null;
    var absent = wd >= 5 ? (hd.group === "parent" ? 0 : 0.45) : 0.1;
    // 追加的 50 人：出現率低一點，避免每個地點擠滿人
    if (hd.ext) absent = wd >= 5 ? (hd.group === "parent" ? 0.3 : 0.6) : 0.4;
    if (hash(s.seed, day, hid, "a") < absent) return null;
    return spotOf(hd.spots, "s");
  }
  function heroinesAt(s, loc) {
    return D.HEROINES.filter(function (hd) { return whereIs(s, hd.id) === loc; }).map(function (hd) { return hd.id; });
  }

  // ---------------- 一天的開始 ----------------
  function startDay(s) {
    var kind = dayKind(s, s.day);
    s.phase = "morning";
    s.today = {
      kind: kind, ap: 0, apMax: 0, apBonus: 0, talked: {}, gifted: {}, invited: {}, pairs: {}, quests: {},
      date: null, dateRun: null, flirt: 0, log: [], admirers: genAdmirers(s), festDance: null,
      combo: {}, enc: 0, meetup: null, clubDone: false, weather: weather(s), examWeek: examWeek(s), hunt: null
    };
    s.today.hunt = genHunt(s);   // 剪影尋人
    if (s.chat) genChats(s);      // 她們傳來的訊息
    s.flags.pose = false;
    dayEvents(s, kind);
    // 隨機事件（有修羅場時優先）。2026-11-03 使用者要求事件更頻繁：0.38 → 0.55，另有 15% 再多一件
    if (!s.events.length && rand(s) < 0.55) {
      var ev = genEvent(s);
      if (ev) s.events.push(ev);
      if (ev && rand(s) < 0.15) {
        var ev2 = genEvent(s);
        if (ev2 && !(ev2.type === ev.type && ev2.id === ev.id)) s.events.push(ev2);
      }
    }
  }

  // ---------------- 迷妹 ----------------
  function genAdmirers(s) {
    var c = s.stats.charm;
    var n = 2 + (rand(s) < 0.5 ? 1 : 0) + (c >= 45 ? 1 : 0) + (c >= 75 ? 1 : 0) + (s.flags.pose ? 1 : 0);
    if (s.outfit === "street" && rand(s) < 0.4) n += 1;   // 街頭潮流穿搭
    if (s.day === 0) n = 3;
    var w = weather(s);
    if (w === "rain" || w === "snow") n -= 1;   // 雨天出門的人比較少
    n = clamp(n, 1, 6);
    var list = [];
    // 二周目第二學年起：神秘的學妹（回應 3 次就會成為可攻略角色）
    if (s.ng && cal(s).year >= 1 && !s.flags.hiyori && hash(s.seed, s.day, "hiyori") < 0.3) {
      list.push({ id: "hiyori_adm", name: "朝比奈 日和", role: "大一學妹（神秘）", hair: 0xe8e2f0, ap: pick(s, ["letter", "bento", "study", "contact"]), ret: (s.flags.hiyoriN || 0) ? "fan" : null, choice: null, type: "pure", special: "hiyori" });
      n--;
    }
    for (var i = 0; i < n; i++) {
      var back = s.pool.filter(function (p) { return (p.st === "ignored" || p.st === "fan") && !list.some(function (x) { return x.id === p.id; }); });
      if (back.length && rand(s) < 0.22) {
        var p = pick(s, back);
        list.push({ id: p.id, name: p.name, role: p.role, hair: p.hair, ap: pick(s, D.APPROACHES).id, ret: p.st, choice: null, type: p.type || "pure" });
        continue;
      }
      var a = {
        id: "a" + s.day + "_" + i + "_" + ri(s, 0, 9999),
        name: pick(s, D.ADMIRER_SURNAMES) + " " + pick(s, D.ADMIRER_GIVEN),
        role: pick(s, D.ADMIRER_ROLES),
        hair: pick(s, D.ADMIRER_LOOKS),
        ap: pick(s, D.APPROACHES).id, ret: null, choice: null, type: pickType(s)
      };
      list.push(a);
    }
    return list;
  }
  function pickType(s) {
    var r = rand(s), acc = 0;
    for (var i = 0; i < D.ADMIRER_TYPES.length; i++) { acc += D.ADMIRER_TYPES[i].w; if (r < acc) return D.ADMIRER_TYPES[i].id; }
    return "pure";
  }
  function approachOf(id) { return D.APPROACHES.filter(function (a) { return a.id === id; })[0]; }
  function answerAdmirer(s, idx, optIdx) {
    var a = s.today.admirers[idx];
    if (!a || a.choice !== null || s.phase !== "morning") return null;
    var ap = approachOf(a.ap), o = ap.opts[optIdx];
    if (!o) return null;
    var out = [o.res];
    a.choice = optIdx;
    s.admirersTotal++;
    // 同一天回應很多迷妹：第 2 個起魅力收益依序減半（只有第一次心動最有效）
    var eff = {};
    Object.keys(o.eff).forEach(function (k) { eff[k] = o.eff[k]; });
    if (eff.charm > 0) {
      eff.charm = eff.charm * Math.pow(0.5, s.today.charmFans || 0);
      if (optIdx === 0) s.today.charmFans = (s.today.charmFans || 0) + 1;
    }
    applyEff(s, eff, out);
    if (o.money) { var m = ri(s, o.money[0], o.money[1]); applyEff(s, { money: m }, out); }
    if (o.fans) s.fans += o.fans;
    if (o.flirt) s.today.flirt += o.flirt;
    if (o.contact) s.contacts++;
    if (o.ap) s.today.apBonus += o.ap;
    var st = optIdx === 0 ? "fan" : optIdx === ap.opts.length - 1 ? "ignored" : "rejected";
    if (st === "ignored") s.ignored++;
    if (st === "rejected") { s.rejected++; if (s.skills.talk >= 40) { applyEff(s, { rep: 1 }, out); out.push("（口才好，拒絕得很得體）"); } }
    // 隱藏學妹：回應 3 次就解鎖
    if (a.special === "hiyori") {
      if (st === "fan") {
        s.flags.hiyoriN = (s.flags.hiyoriN || 0) + 1;
        if (s.flags.hiyoriN >= 3) s.events.push({ type: "hiyoriUnlock" });
      }
      return out;
    }
    var rec = s.pool.filter(function (p) { return p.id === a.id; })[0];
    if (!rec) { rec = { id: a.id, name: a.name, role: a.role, hair: a.hair, st: st, type: a.type || "pure", n: 0 }; s.pool.push(rec); }
    rec.st = st;
    // 迷妹的個性：太常回應「執著」的人會變成跟蹤、回應「肉食系」的人會被爆料（第 3 項）
    if (st === "fan") {
      rec.n = (rec.n || 0) + 1;
      if (rec.type === "stalker" && rec.n >= 2 && !rec.trouble) { rec.trouble = 1; s.events.push({ type: "stalker", who: rec.name }); }
      if (rec.type === "bold" && rec.n >= 3 && !rec.trouble) { rec.trouble = 1; s.events.push({ type: "leak", who: rec.name }); }
      // 純情的迷妹回應滿 NEED 次：想正式認識你（迷妹轉正）
      var K = D.FAN_KIT;
      if (K && rec.type === "pure" && rec.n >= (K.NEED[s.lengthId] || 3) && !rec.promo && !rec.trouble && s.promoted.length < K.MAX) {
        rec.promo = 1;
        s.events.push({ type: "fanPromote", aid: rec.id, who: rec.name, role: rec.role, hair: rec.hair, n: rec.n });
      }
    }
    if (s.pool.length > 80) s.pool.shift();
    if (o.flirt && loversOf(s).length) out.push("（女友們好像會在意你跟別人太親近……）");
    return out;
  }
  function finishMorning(s) {
    if (s.phase !== "morning") return;
    s.today.admirers.forEach(function (a, i) {
      if (a.choice === null) answerAdmirer(s, i, approachOf(a.ap).opts.length - 1);
    });
    var k = s.today.kind;
    if (CLASS_KINDS[k]) s.phase = "class";
    else if (EXAM_KINDS[k]) s.phase = "exam";
    else { s.phase = "free"; setAp(s, 6); }
  }
  function apMod(s) {
    var w = s.today.weather, m = 0;
    if (w === "rain" || w === "snow") m -= 1;
    if (s.today.examWeek) m -= 1;
    if (w === "sunny" && isWeekend(s)) m += 1;
    return m;
  }
  function setAp(s, base) {
    var n = Math.max(1, base + s.today.apBonus + apMod(s));
    s.today.ap = n; s.today.apMax = n;
  }

  // ---------------- 上課／考試 ----------------
  function doClass(s, optId) {
    if (s.phase !== "class") return null;
    var o = D.CLASS_OPTS.filter(function (c) { return c.id === optId; })[0];
    if (!o) return null;
    var out = [D.L(o.name) + "。"];
    var eff = {};
    Object.keys(o.eff).forEach(function (k) { eff[k] = o.eff[k]; });
    if (eff.study > 0 && s.stats.stamina < 25) { eff.study = eff.study / 2; out.push("太累了，上課內容一半都沒進到腦子裡。"); }
    if (eff.study > 0 && s.today.examWeek) { eff.study = eff.study * 1.5; out.push("考試週，大家都很認真。（學業加成）"); }
    applyEff(s, eff, out);
    attend(s, !!o.att);
    if (o.teacher && s.h.rinko.met) {
      addAff(s, "rinko", o.teacher, out);
      if (o.teacher < 0) out.push("柊老師的紅筆在你名字旁邊停了一下。");
    }
    s.phase = "free";
    setAp(s, 4 + (o.ap || 0));
    checkFaint(s, out);
    return out;
  }
  function doExam(s, effort) {
    if (s.phase !== "exam") return null;
    var out = [];
    var isFinal = s.today.kind === "final";
    var bonus = effort ? 6 : 0;
    var score = Math.round(clamp(s.stats.study * 0.85 + 12 + bonus + (rand(s) * 16 - 8) - (s.stats.stamina < 20 ? 10 : 0), 0, 100));
    applyEff(s, { stamina: effort ? -15 : -6 }, null);
    s.exams.push({ kind: isFinal ? "final" : "midterm", score: score, day: s.day, year: cal(s).year, term: cal(s).termName });
    attend(s, true);
    out.push((isFinal ? "期末考" : "期中考") + "結束了。你的分數是 " + score + " 分。");
    if (score >= 90) { out.push("全學年前段班！柊老師難得對你點了點頭。"); if (s.h.rinko.met) addAff(s, "rinko", 4, out); applyEff(s, { rep: 3 }, out); }
    else if (score < 50) { out.push("……不及格邊緣。柊老師的眼神好可怕。"); applyEff(s, { rep: -2 }, out); }
    s.phase = "free";
    setAp(s, 3);
    checkFaint(s, out);
    return out;
  }
  // 出席：總計＋各學年（學年報告只算當年）
  function attend(s, ok) {
    var y = cal(s).year;
    s.att.total++; if (ok) s.att.ok++;
    var by = s.att.byYear || (s.att.byYear = {});
    var a = by[y] || (by[y] = { ok: 0, total: 0 });
    a.total++; if (ok) a.ok++;
  }
  function checkFaint(s, out) {
    if (s.stats.stamina > 0) return false;
    out.push("眼前一黑——你昏倒了。醒來時，你躺在保健中心的床上。");
    s.stats.stamina = 35;
    s.today.ap = 0;
    var h = s.h.rena;
    if (!h.met) { h.met = true; out.push("「你醒啦？不可以太勉強自己喔。」保健中心的七瀨醫師溫柔地看著你。"); }
    addAff(s, "rena", 5, out);
    h.lastSeen = s.day;
    applyEff(s, { rep: -1 }, out);
    return true;
  }

  // ---------------- 自由時間 ----------------
  function useAp(s, n) {
    if (s.phase !== "free" || s.today.ap < n) return false;
    s.today.ap -= n;
    return true;
  }
  function locAction(s, locId) {
    var loc = D.LOC_BY_ID[locId];
    if (!loc || !loc.act || s.phase !== "free") return null;
    var a = loc.act;
    if (a.id === "home") { endFree(s); return ["你今天早點回家了。"]; }
    if (a.eff.money && a.eff.money < 0 && s.stats.money < -a.eff.money) return ["錢不夠。"];
    if (!useAp(s, a.ap)) return ["沒有行動點了。"];
    var out = [D.L(a.name) + "。"];
    applyEff(s, a.eff, out);
    if (a.flag) s.flags[a.flag] = true;
    if (a.id === "workout") addSkill(s, "sport", 1, out);
    if (a.id === "read") addSkill(s, "talk", 0.5, out);
    if (a.id === "read" && s.today.examWeek) { applyEff(s, { study: 2 }, out); out.push("（考試週的圖書館特別有效率）"); }
    checkFaint(s, out);
    return out;
  }
  function talkTopics(s, hid) {
    var cnt = s.today.talked[hid] || 0;
    var ids = D.TOPICS.map(function (t) { return t.id; });
    var res = [];
    var k = 0;
    while (res.length < 3 && k < 40) {
      var id = ids[Math.floor(hash(s.seed, s.day, hid, cnt, k) * ids.length)];
      if (res.indexOf(id) < 0) res.push(id);
      k++;
    }
    return res;
  }
  function topicPref(hid, tid) {
    var hd = D.HEROINE_BY_ID[hid];
    return hd.topics.like.indexOf(tid) >= 0 ? "like" : hd.topics.bad.indexOf(tid) >= 0 ? "bad" : "mid";
  }
  function giftPref(hid, iid) {
    var hd = D.HEROINE_BY_ID[hid];
    return hd.gifts.like.indexOf(iid) >= 0 ? "like" : hd.gifts.bad.indexOf(iid) >= 0 ? "bad" : "mid";
  }
  function lineOf(s, arr) { return arr[Math.floor(rand(s) * arr.length)]; }
  // 第一次搭話＝相遇
  function meet(s, hid) {
    var h = s.h[hid], hd = D.HEROINE_BY_ID[hid];
    if (h.met) return null;
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    h.met = true;
    h.lastSeen = s.day;
    s.today.talked[hid] = 1;
    var out = [name(hid) + "：" + hd.lines.greet];
    addAff(s, hid, 5, out);
    completeHunt(s, hid, out);
    return out;
  }
  function talk(s, hid, tid) {
    var h = s.h[hid], hd = D.HEROINE_BY_ID[hid];
    if (!h.met) return meet(s, hid);
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    var cnt = s.today.talked[hid] || 0;
    var pref = topicPref(hid, tid);
    h.known.topics[tid] = pref;
    // 全肯定（2026-11-05）：關係極好的人，就算不是她喜歡的話題，通常也會肯定你
    var affirm = pref !== "like" && rollAffirm(s, hid);
    var out = ["你：" + D.TOPIC_BY_ID[tid].say, name(hid) + "：" + (affirm ? affirmLine(s, hid) : lineOf(s, hd.lines[pref]))];
    if (affirm) { out.push("（🫶 她全肯定了你" + (pref === "bad" ? "，即使這不是她喜歡的話題" : "") + "）"); pref = "mid"; }
    // 連擊記在她身上：跨日保留，3 天沒聊就歸零
    var combo = s.day - (h.comboDay === undefined ? -99 : h.comboDay) <= 3 ? (h.combo || 0) : 0;
    // 隱藏對話：連擊 2 以上時，聊到她的特定話題
    var ht = D.HIDDEN_TALKS[hid];
    var hidden = ht && ht.topic === tid && combo >= 2 && !h.hiddenSeen && (!ht.needMet || s.h[ht.needMet].met);
    var base = pref === "like" ? 8 : pref === "bad" ? -4 : affirm ? 5 : 3;
    if (base > 0) base *= 1 + s.stats.charm / 150;
    if (base > 0 && cnt >= 1) base *= 0.5;
    // 連擊：連續選中她喜歡的話題，加成越來越高；選到她討厭的就斷掉
    if (pref === "like") { combo++; base *= Math.min(2, 1 + 0.25 * (combo - 1)); if (combo >= 2) out.push("（連擊 ×" + combo + "）"); }
    else if (pref === "bad") combo = 0;
    h.combo = combo; h.comboDay = s.day;
    // 專長：聊到跟專長相關的話題；口才讓所有聊天都更順
    D.SKILLS.forEach(function (k) { if (k.topic === tid && pref !== "bad" && s.skills[k.id] >= 10) base += s.skills[k.id] / 20; });
    if (base > 0) base *= 1 + s.skills.talk / 250;
    if (base > 0 && s.club && D.CLUB_BY_ID[s.club].members.indexOf(hid) >= 0) base *= 1.3;
    if (h.dating) base += 1;
    if (base > 0 && s.today.lucky) base *= 1.2;   // 星座運勢（事件）
    addAff(s, hid, base, out);
    if (hidden) {
      h.hiddenSeen = true; s.hiddenTalks++;
      out.push("【隱藏對話】" + ht.text);
      addAff(s, hid, 6, out);
      memory(s, "hidden_" + hid, name(hid) + "・不為人知的一面", ht.text, hid);
    }
    if (h.dating && rand(s) < 0.5) out.push(name(hid) + "：" + lineOf(s, hd.lines.lover));
    completeHunt(s, hid, out);
    s.today.talked[hid] = cnt + 1;
    h.lastSeen = s.day;
    // 💓 心跳時刻：聊得很順（她喜歡的話題或被全肯定）時
    if ((pref === "like" || affirm) && rand(s) < dokiChance(s, hid)) dokiStart(s, hid, "talk", out, whereIs(s, hid, s.day, curSlot(s)));
    return out;
  }
  function gift(s, hid, iid) {
    var h = s.h[hid], hd = D.HEROINE_BY_ID[hid];
    if (!h.met || s.today.gifted[hid] || !s.inv[iid]) return null;
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    s.inv[iid]--;
    if (!s.inv[iid]) delete s.inv[iid];
    var pref = giftPref(hid, iid);
    h.known.gifts[iid] = pref;
    var it = D.ITEM_BY_ID[iid];
    var out = ["你送給" + name(hid) + "「" + D.L(it.name) + "」。", name(hid) + "：" + hd.lines[pref === "like" ? "gl" : pref === "bad" ? "gb" : "gn"]];
    var base = pref === "like" ? 12 : pref === "bad" ? -5 : 4;
    if (base > 0) base *= 1 + s.stats.charm / 200;
    addAff(s, hid, base, out);
    if (pref === "like") rumor(s, hid, true, "送給" + name(hid) + "的禮物很用心", out);
    s.today.gifted[hid] = true;
    h.lastSeen = s.day;
    return out;
  }
  function buy(s, iid) {
    var it = D.ITEM_BY_ID[iid];
    if (!it || s.stats.money < it.price) return null;
    s.stats.money -= it.price;
    s.inv[iid] = (s.inv[iid] || 0) + 1;
    return ["買了「" + D.L(it.name) + "」（¥" + it.price.toLocaleString() + "）。"];
  }
  function inviteMin(hid) { return D.HEROINE_BY_ID[hid].inviteMin || 30; }
  function canInvite(s, hid) {
    var h = s.h[hid];
    return s.phase === "free" && h.met && !s.today.date && !s.today.invited[hid] && h.aff >= inviteMin(hid);
  }
  function invite(s, hid) {
    if (!canInvite(s, hid)) return null;
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    var h = s.h[hid], hd = D.HEROINE_BY_ID[hid];
    s.today.invited[hid] = true;
    var p = h.dating ? 0.95 : clamp(0.35 + (h.aff - inviteMin(hid)) / 50 + s.stats.charm / 300, 0.1, 0.95);
    var when = isWeekend(s) ? "今天" : "今晚";
    var out = ["你約" + name(hid) + when + "出去。"];
    if (rand(s) < p) {
      s.today.date = hid;
      out.push(name(hid) + "：" + hd.lines.dy);
      out.push("（約會成立！晚上記得赴約。）");
    } else {
      out.push(name(hid) + "：" + hd.lines.dn);
    }
    h.lastSeen = s.day;
    return out;
  }
  function questOf(s, hid) {
    var hd = D.HEROINE_BY_ID[hid], h = s.h[hid];
    if (!h.met || h.quest >= hd.quests.length) return null;
    var q = hd.quests[h.quest];
    return h.aff >= q.at && !questLock(s, h.quest) ? q : null;
  }
  // 長的模式：第 2、3 個任務要到某個學期才開放（回傳開放的學期名稱，已開放則 null）
  function questLock(s, idx) {
    var need = lengthOf(s).questTerm[idx] || 0;
    if (cal(s).term >= need) return null;
    return YEAR_NAMES[Math.floor(need / 2)] + (need % 2 ? "秋學期" : "春學期");
  }
  function reqText(req) {
    if (req.type === "stat") {
      var alt = D.STAT_ALT_SKILL[req.stat];
      return D.L(STAT_BY_ID[req.stat].name) + " ≥ " + req.min + (alt ? "（或 " + D.L(D.SKILL_BY_ID[alt].name) + " ≥ " + Math.ceil(req.min * 0.8) + "）" : "") + (req.cost ? "（消耗體力 " + req.cost + "）" : "");
    }
    if (req.type === "item") return "持有「" + D.L(D.ITEM_BY_ID[req.item].name) + "」";
    if (req.type === "money") return "花費 ¥" + req.amount.toLocaleString();
    if (req.type === "loc") return "到「" + D.L(D.LOC_BY_ID[req.loc].name) + "」執行";
    if (req.type === "heroine") return name(req.id) + " 的好感 ≥ " + req.min;
    return "";
  }
  function reqMet(s, req, curLoc) {
    if (req.type === "stat") {
      var alt = D.STAT_ALT_SKILL[req.stat];
      var ok = s.stats[req.stat] >= req.min || (alt && s.skills && s.skills[alt] >= Math.ceil(req.min * 0.8));
      return ok && (!req.cost || s.stats.stamina > req.cost);
    }
    if (req.type === "item") return !!s.inv[req.item];
    if (req.type === "money") return s.stats.money >= req.amount;
    if (req.type === "loc") return curLoc === req.loc;
    if (req.type === "heroine") return s.h[req.id].met && s.h[req.id].aff >= req.min;
    return false;
  }
  // 地點型任務：人在那個地點就能做（不用她剛好在場）
  function locQuests(s, curLoc) {
    return D.HEROINES.filter(function (hd) {
      var q = questOf(s, hd.id);
      return q && q.req.type === "loc" && q.req.loc === curLoc && !s.today.quests[hd.id];
    }).map(function (hd) { return hd.id; });
  }
  function doQuest(s, hid, curLoc) {
    var q = questOf(s, hid);
    if (!q || s.today.quests[hid]) return null;
    if (!reqMet(s, q.req, curLoc)) return ["條件不足：" + reqText(q.req)];
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    var h = s.h[hid];
    if (q.req.type === "item") { s.inv[q.req.item]--; if (!s.inv[q.req.item]) delete s.inv[q.req.item]; }
    if (q.req.type === "money") s.stats.money -= q.req.amount;
    if (q.req.type === "stat" && q.req.cost) applyEff(s, { stamina: -q.req.cost }, null);
    var out = ["【任務】" + q.title, q.done];
    h.quest++;
    s.today.quests[hid] = true;
    var r = q.reward || {};
    addAff(s, hid, r.aff || 10, out, true);
    var eff = {};
    ["study", "charm", "stamina", "money", "rep"].forEach(function (k) { if (r[k]) eff[k] = r[k]; });
    applyEff(s, eff, out);
    if (r.heroine && s.h[r.heroine.id].met) addAff(s, r.heroine.id, r.heroine.aff, out);
    if (q.req.type === "heroine" && D.HEROINE_BY_ID[hid].group === "parent" && D.HEROINE_BY_ID[hid].daughter === q.req.id) s.flags.parentOK = true;
    h.lastSeen = s.day;
    rumor(s, hid, true, "幫了" + name(hid) + "的忙", out);
    if (h.quest >= D.HEROINE_BY_ID[hid].quests.length) out.push("（" + name(hid) + " 的任務全部完成！好感 80 以上就可以告白了。）");
    checkFaint(s, out);
    return out;
  }
  function confessReq(s, hid) {
    var hd = D.HEROINE_BY_ID[hid], c = hd.confess || {};
    var lack = [];
    Object.keys(c).forEach(function (k) { if (s.stats[k] < c[k]) lack.push(D.L(STAT_BY_ID[k].name) + " ≥ " + c[k]); });
    return lack;
  }
  function canConfess(s, hid) {
    var h = s.h[hid], hd = D.HEROINE_BY_ID[hid];
    return s.phase === "free" && h.met && !h.dating && h.quest >= hd.quests.length && h.aff >= 80 && h.cooldown < s.day;
  }
  // bonus：心跳告白的成功率加減（dokiFinish）；great：心跳全中而且說法符合她
  function confess(s, hid, bonus, great) {
    if (!canConfess(s, hid)) return null;
    var lack = confessReq(s, hid);
    if (lack.length) return ["還差一點……（" + lack.join("、") + "）"];
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    var h = s.h[hid], hd = D.HEROINE_BY_ID[hid];
    var lovers = loversOf(s).length;
    var p = clamp(0.55 + (h.aff - 80) / 50 + s.stats.charm / 400 + s.stats.rep / 400 - lovers * hd.jealousy * 0.12 + (s.outfit === "formal" ? 0.05 : 0) + (bonus || 0), 0.05, 0.97);
    var out = ["你鼓起勇氣，對" + name(hid) + "說出了「我喜歡你」。"];
    if (rand(s) < p) {
      startDating(s, hid);
      out.push(name(hid) + "：" + hd.lines.cy);
      out.push("💕 你和" + name(hid) + "開始交往了！");
      addAff(s, hid, 5, out, true);
      if (great) unlock(s, "dokiConfess");
      if (lovers) { out.push("（……你現在同時和 " + (lovers + 1) + " 個人交往。小心修羅場。）"); }
      applyEff(s, { charm: 3 }, out);
    } else {
      out.push(name(hid) + "：" + hd.lines.cn);
      addAff(s, hid, -10, out);
      h.cooldown = s.day + (span(s) > 1 ? 1 : 3);
      out.push(span(s) > 1 ? "（下一次見面之前不能再告白）" : "（3 天後才能再告白）");
    }
    h.lastSeen = s.day;
    return out;
  }
  function pairsAt(s, curLoc) {
    var here = heroinesAt(s, curLoc);
    return D.PAIRS.filter(function (p) {
      return here.indexOf(p.a) >= 0 && here.indexOf(p.b) >= 0 && s.h[p.a].met && s.h[p.b].met && !s.today.pairs[p.a + p.b];
    });
  }
  function pairTalk(s, a, b) {
    var p = D.PAIRS.filter(function (x) { return x.a === a && x.b === b; })[0];
    if (!p || s.today.pairs[a + b]) return null;
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    s.today.pairs[a + b] = true;
    var hot = s.h[a].aff >= 60 && s.h[b].aff >= 60;
    var out = ["【" + name(a) + " × " + name(b) + "】", hot ? p.shura : p.text];
    if (hot) {
      addAff(s, a, 3, out); addAff(s, b, 3, out);
      applyEff(s, { charm: 1, stamina: -4 }, out);
      out.push("（兩個人都很在意你……）");
    } else {
      addAff(s, a, 4, out); addAff(s, b, 4, out);
    }
    s.h[a].lastSeen = s.day; s.h[b].lastSeen = s.day;
    return out;
  }
  function joinClub(s, id) {
    if (id && !D.CLUB_BY_ID[id]) return null;
    var before = s.club;
    s.club = id || null;
    return [id ? "你加入了「" + D.L(D.CLUB_BY_ID[id].name) + "」。" : "你退出了社團。"].concat(before && before !== id ? ["（之前的社團經驗還在，但社團大會只算現在的社團）"] : []);
  }
  function isClubDay(s) { return D.CLUB_DAYS.indexOf(weekday(s)) >= 0 && !EXAM_KINDS[s.today.kind]; }
  function canClubAction(s, curLoc) {
    var c = s.club && D.CLUB_BY_ID[s.club];
    return !!c && s.phase === "free" && isClubDay(s) && !s.today.clubDone && curLoc === c.loc;
  }
  function clubAction(s, curLoc) {
    if (!canClubAction(s, curLoc)) return null;
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    var c = D.CLUB_BY_ID[s.club], out = ["【" + D.L(c.name) + "】今天的社團活動。"];
    Object.keys(c.skills).forEach(function (k) { addSkill(s, k, c.skills[k], out); });
    c.members.forEach(function (m) {
      if (!s.h[m].met || !available(s, m)) return;
      addAff(s, m, 2, out);
      s.h[m].lastSeen = s.day;
    });
    applyEff(s, { rep: 1, stamina: -6 }, out);
    s.today.clubDone = true;
    s.clubDays++;
    var cy = s.clubYear || (s.clubYear = {}), yy = cal(s).year;
    cy[yy] = (cy[yy] || 0) + 1;
    checkFaint(s, out);
    return out;
  }
  // 到達某地點（3D 走進範圍或快速前往）：約定見面
  function arrive(s, loc) {
    var mu = s.today && s.today.meetup;
    if (!mu || mu.done || s.phase !== "free" || loc !== mu.loc) return null;
    mu.done = true;
    var used = s.today.apMax - s.today.ap, out;
    if (used <= mu.by) {
      out = [name(mu.hid) + "看到你，用力地揮手：「你真的來了！」"];
      addAff(s, mu.hid, 6, out); s.meetupOk++;
    } else {
      out = [name(mu.hid) + "鼓著臉頰：「你遲到了喔。」"];
      addAff(s, mu.hid, -3, out);
    }
    s.h[mu.hid].lastSeen = s.day;
    return out;
  }
  // 在 3D 校園走路、或在自由時間做完一件事時觸發（畫面呼叫）
  // 2026-11-03 使用者要求事件更頻繁：一天最多 2 次 → 4 次
  var ENC_PER_DAY = 4;
  function encounter(s, curLoc) {
    if (s.phase !== "free" || !s.today || s.today.enc >= ENC_PER_DAY || s.events.length) return false;
    var here = curLoc ? heroinesAt(s, curLoc).filter(function (h) { return s.h[h].met; }) : [];
    var list = D.ENCOUNTERS.filter(function (e) { return !e.kind || here.length; });
    // 💓 在場的人好感夠高：有機率變成心跳時刻
    var dk = here.filter(function (h) { return s.h[h].aff >= 30; });
    if (dk.length && rand(s) < 0.35) {
      var dh = pick(s, dk);
      if (dokiStart(s, dh, "enc", null, curLoc)) { s.today.enc++; s.encounters++; return true; }
    }
    var e = pick(s, list);
    s.today.enc++;
    s.encounters++;
    s.events.push({ type: "enc", id: e.id, hid: e.kind ? pick(s, here) : undefined });
    return true;
  }
  function endFree(s) {
    if (s.phase !== "free") return null;
    s.phase = "evening";
    var mu = s.today.meetup, out = null;
    if (mu && !mu.done) {
      mu.done = true;
      out = [name(mu.hid) + "在" + D.L(D.LOC_BY_ID[mu.loc].name) + "等了你一整個下午……"];
      addAff(s, mu.hid, -8, out);
      rumor(s, mu.hid, false, "讓" + name(mu.hid) + "白等了一下午", out);
    }
    return out;
  }

  // ---------------- 晚上 ----------------
  function dateSpots(s) {
    return D.DATE_SPOTS.filter(function (d) { return !d.weekend || isWeekend(s); });
  }
  function moodOf(s, hid) { return D.MOODS[Math.floor(hash(s.seed, s.day, hid, "mood") * D.MOODS.length)]; }
  function startDate(s, spotId) {
    var hid = s.today.date;
    if (s.phase !== "evening" || !hid || s.today.dateRun) return null;
    var sp = D.DATE_BY_ID[spotId];
    if (!sp || (sp.weekend && !isWeekend(s))) return null;
    if (s.stats.money < sp.cost) return { error: "錢不夠。" };
    s.stats.money -= sp.cost;
    // 該地點的 2 題（順序隨機），交往中再加 1 題通用題
    var list = (D.SPOT_MOMENTS[spotId] || []).map(function (m, i) { return { spot: spotId, i: i }; });
    if (rand(s) < 0.5) list.reverse();
    if (!list.length || s.h[hid].dating) list.push({ g: Math.floor(rand(s) * D.DATE_MOMENTS.length) });
    var mood = moodOf(s, hid);
    s.today.dateRun = { hid: hid, spot: spotId, list: list, step: 0, score: 0, mood: mood.id };
    return { moment: dateMoment(s), mood: mood };
  }
  function dateMoment(s) {
    var run = s.today && s.today.dateRun;
    if (!run || run.done) return null;
    var it = run.list[run.step];
    return it.g !== undefined ? D.DATE_MOMENTS[it.g] : D.SPOT_MOMENTS[it.spot][it.i];
  }
  // 「展現特技」：最高的專長 40 以上才能選
  function skillAnswer(s) {
    var k = bestSkill(s);
    return k && s.skills[k] >= 40 ? k : null;
  }
  function answerDate(s, key) {
    var run = s.today && s.today.dateRun;
    if (!run || run.done || s.phase !== "evening") return null;
    var hid = run.hid, hd = D.HEROINE_BY_ID[hid];
    var mood = D.MOODS.filter(function (m) { return m.id === run.mood; })[0];
    var out = [], pts;
    if (key === "skill") {
      var k = skillAnswer(s);
      if (!k) return null;
      var sk = D.SKILL_BY_ID[k];
      var liked = k === "talk" || hd.topics.like.indexOf(sk.topic) >= 0;
      pts = liked ? 6 + s.skills[k] / 20 : 2;
      out.push("你展現了" + D.L(sk.name) + "的特技。" + (liked ? name(hid) + "看得目不轉睛。" : name(hid) + "好像沒什麼興趣……"));
    } else {
      pts = 1 + (key === hd.moment ? 5 : 0) + (key === mood.pref ? 4 : 0);
      if (pts < 8 && rollAffirm(s, hid)) { pts = Math.max(pts, 6); out.push(name(hid) + "：" + affirmLine(s, hid)); out.push("（🫶 她全肯定了你）"); }
      else out.push(pts >= 8 ? name(hid) + "的臉紅了，靜靜地靠近了你。" : pts >= 5 ? name(hid) + "開心地笑了。" : name(hid) + "笑了笑，好像不太是她想聽的。");
    }
    run.score += pts;
    run.step++;
    if (run.step < run.list.length) return out;
    return out.concat(finishDate(s));
  }
  function finishDate(s) {
    var run = s.today.dateRun;
    if (!run || run.done) return null;
    var hid = run.hid, hd = D.HEROINE_BY_ID[hid], h = s.h[hid], sp = D.DATE_BY_ID[run.spot];
    var out = [];
    var spotPref = hd.dates.like.indexOf(run.spot) >= 0 ? "like" : hd.dates.bad.indexOf(run.spot) >= 0 ? "bad" : "mid";
    var gain = 6 + (spotPref === "like" ? 8 : spotPref === "bad" ? -4 : 0) + run.score;
    out.push(spotPref === "like" ? name(hid) + "看起來非常喜歡這個地方，一直拉著你的手。" : spotPref === "bad" ? name(hid) + "對這個地方好像有點提不起勁……" : "你們度過了愉快的時光。");
    if (h.dating) { gain += 2; out.push(name(hid) + "：" + lineOf(s, hd.lines.lover)); }
    // 被執著的迷妹跟蹤：約會被打擾
    if (s.flags.stalker) { gain -= 6; s.flags.stalker = false; out.push("……約會途中，你發現那個執著的女生一直躲在不遠處偷看。氣氛全毀了。"); applyEff(s, { rep: -2 }, out); }
    // 後夜祭、聖誕夜等特殊日的晚上有約：約會對象就是共度的人
    var spEv = specialEvening(s);
    if (spEv) {
      out.push(fmt(spEv.act, { n: name(hid) })); gain += 4; s.today.festDance = hid;
      memory(s, "night_" + s.today.kind + "_" + hid, name(hid) + "・" + spEv.title, fmt(spEv.act, { n: name(hid) }), hid);
    }
    // 穿搭（第 7 項）：穿得適合這個地點
    if (outfitFits(s, run.spot)) { gain += 4; out.push("（你的「" + D.L(D.OUTFIT_BY_ID[s.outfit].name) + "」很適合這裡，她多看了你好幾眼）"); }
    addAff(s, hid, gain, out);
    if (gain >= 14) {
      takePolaroid(s, hid, run.spot, out);
      rumor(s, hid, true, "和" + name(hid) + "的約會很浪漫", out);
      // 房間舒適度夠：她想來你的房間坐坐
      var cf = comfort(s);
      if (D.ROOM_VISIT && cf >= D.ROOM_VISIT.need && (h.dating || h.aff >= 60) && rand(s) < 0.6) {
        var vt = pick(s, D.ROOM_VISIT.text);
        out.push("🏠 回程時她小聲說：「……可以去你房間坐一下嗎？」", vt);
        addAff(s, hid, Math.min(8, 2 + cf), out);
        memory(s, "room_" + hid, name(hid) + "・你的房間", vt, hid);
      }
    }
    if (sp.eff) applyEff(s, sp.eff, out);
    applyEff(s, { stamina: -6 }, out);
    h.lastSeen = s.day;
    h.dates++;
    s.dates++;
    run.done = true;
    s.phase = "night";
    // 💓 約會很順利：回家前的心跳時刻（特殊日的晚上是煙火／最後一支舞）
    if (gain >= 10 && rand(s) < 0.75) dokiStart(s, hid, spEv ? "fest" : "date", out);
    return out;
  }
  function cancelDate(s) {
    var hid = s.today.date;
    if (!hid || s.today.dateRun) return null;
    var out = ["你放了" + name(hid) + "鴿子……"];
    addAff(s, hid, -8, out);
    rumor(s, hid, false, "放了" + name(hid) + "鴿子", out);
    s.today.date = null;
    return out;
  }
  function doEvening(s, optId, arg) {
    if (s.phase !== "evening" || s.today.date) return null;
    var o = D.EVENING_OPTS.concat(D.SKILL_EVENINGS).filter(function (e) { return e.id === optId; })[0];
    if (!o) return null;
    if (o.eff.money && o.eff.money < 0 && s.stats.money < -o.eff.money) return ["錢不夠。"];
    var out = [D.L(o.name) + "。"];
    if (optId === "message") {
      var h = s.h[arg];
      if (!h || !h.met || h.aff < 20) return null;
      out = ["你傳了訊息給" + name(arg) + "。（📱 手機裡繼續聊，總共 3 回合）"];
      addAff(s, arg, h.dating ? 2 : 1, out);
      h.lastSeen = Math.max(h.lastSeen, s.day - 1);
      applyEff(s, { stamina: -3 }, out);
      // 2026-11-05：改成實際在手機上聊天（3 回合）
      if (D.CHAT_KINDS) {
        var th = thread(s, arg);
        if (th.pend) { th.pend = null; }
        chatPush(s, arg, "m", pick(s, ["在做什麼？", "還沒睡？", "今天辛苦了。", "欸，問你喔——"]));
        chatAsk(s, arg, "open", 1, 3, true);
      }
    } else if (optId === "sns") {
      out = snsPost(s, arg);
      if (!out) return null;
    } else {
      applyEff(s, o.eff, out);
      var mul = (o.skill === "music" && s.room.speaker) || (o.skill === "cook" && s.room.kitchen) ? 1.3 : 1;
      if (o.skill) addSkill(s, o.skill, 3 * mul, out);
      // 家具（第 7 項）
      if (optId === "study" && s.room.lamp) applyEff(s, { study: 2 }, out);
      if (optId === "groom" && s.room.mirror) applyEff(s, { charm: 1 }, out);
    }
    s.phase = "night";
    // 深夜的訊息（2026-11-03 追加事件）
    var night = metList(s, function (h) { return h.aff >= 30; });
    if (night.length && D.X_EVENT_BY_ID && rand(s) < 0.22) s.events.push({ type: "x", id: "latenight", hid: pick(s, night) });
    return out;
  }
  // 特殊日的晚上（後夜祭、夏日祭典、聖誕夜、情人節、畢業典禮）：選一位共度
  function specialEvening(s) {
    var sp = special(s);
    return sp && sp.evening && s.today && !s.today.festDance ? sp.evening : null;
  }
  function festDance(s, hid) {
    var ev = specialEvening(s);
    if (s.phase !== "evening" || !ev || s.today.date) return null;
    var h = s.h[hid];
    if (!h || !h.met || h.aff < 40) return null;
    var out = [fmt(ev.act, { n: name(hid) }), name(hid) + "：" + lineOf(s, D.HEROINE_BY_ID[hid].lines[h.dating ? "lover" : "like"])];
    memory(s, "night_" + s.today.kind + "_" + hid, name(hid) + "・" + ev.title, fmt(ev.act, { n: name(hid) }), hid);
    addAff(s, hid, h.dating ? 16 : 12, out, true);
    loversOf(s).forEach(function (o) {
      if (o !== hid) { out.push(name(o) + "遠遠地看著你們……"); addAff(s, o, -5, out); }
    });
    h.lastSeen = s.day;
    h.dates++;
    s.today.festDance = hid;
    s.phase = "night";
    dokiStart(s, hid, "fest", out);   // 💓 煙火下／最後一支舞
    return out;
  }

  // 每天早上的固定事件：新學年、情人節、畢業典禮、第 2／3 學年的個人劇情
  function dayEvents(s, kind) {
    var c = cal(s);
    if (kind === "newyear") s.events.push({ type: "newyear", year: c.year });
    if (kind === "valentine") s.events.push({ type: "valentine" });
    if (kind === "graduation") s.events.push({ type: "graduation" });
    // 社團：入學（新學年）時還沒加入就邀請；社團大會
    if ((kind === "entrance" || kind === "newyear") && !s.club) s.events.push({ type: "clubjoin" });
    if (kind === "clubcup" && s.club) s.events.push({ type: "clubcup" });
    var lovers = loversOf(s), last = s.day === s.length - 1;
    lovers.forEach(function (hid) {
      var h = s.h[hid], days = (s.day - h.since) * span(s);   // 換算成實際天數
      if (h.rel === 1 && days >= 30 && !h.anniv) s.events.push({ type: "anniv", hid: hid });
      else if (h.rel === 2 && days >= 90 && h.aff >= 90) s.events.push({ type: "family", hid: hid });
      else if (last && h.rel >= 3) s.events.push({ type: "promise", hid: hid });
      else if (days > 7 && hash(s.seed, s.day, hid, "quarrel") < Math.min(0.08, 0.012 * span(s))) s.events.push({ type: "quarrel", hid: hid });
    });
    // 女友約你在某個地點見面（有課或放假的日子都可能）
    if (lovers.length && !EXAM_KINDS[kind] && hash(s.seed, s.day, "meetup") < 0.15) {
      var mh = lovers[Math.floor(hash(s.seed, s.day, "meetupWho") * lovers.length)];
      var spots = D.HEROINE_BY_ID[mh].spots;
      s.events.push({ type: "meetup", hid: mh, loc: spots[Math.floor(hash(s.seed, s.day, "meetupLoc") * spots.length)] });
    }
    if (c.year >= 1) {
      D.HEROINES.forEach(function (hd) {
        var h = s.h[hd.id];
        if (!h.met || h.aff < 55 || (h.story || 0) >= c.year || !hd.story) return;
        if (hash(s.seed, s.day, hd.id, "story") < Math.min(0.2, 0.03 * span(s))) s.events.push({ type: "story", hid: hd.id, idx: h.story || 0 });
      });
    }
  }

  // ---------------- 一天的結束 ----------------
  function endDay(s) {
    if (s.phase === "free") endFree(s);
    if (s.phase === "evening") {
      if (s.today.date && !s.today.dateRun) cancelDate(s);
      s.phase = "night";
    }
    s.doki = null;   // 沒處理完的心跳時刻不留到隔天
    var out = [];
    // 睡覺回復
    applyEff(s, { stamina: 20 + (s.room.bed ? 8 : 0) }, null);
    // 魅力 50 以上會慢慢下降，要靠打扮、健身等維持（每天最多 −0.25）
    if (s.stats.charm > 50) s.stats.charm = Math.round((s.stats.charm - 0.25 * Math.sqrt(span(s)) * (s.stats.charm - 50) / 50) * 100) / 100;
    chatExpire(s, out);   // 沒回的訊息
    var lovers = loversOf(s);
    // 跟太多迷妹曖昧：女友吃醋
    if (lovers.length && s.today.flirt >= 3) {
      lovers.forEach(function (hid) {
        var n = Math.min(4, Math.round((s.today.flirt - 2) * D.HEROINE_BY_ID[hid].jealousy * 1.5));
        if (n > 0) { out.push(name(hid) + "聽說你今天被一堆女生圍著……"); addAff(s, hid, -n, out); }
      });
    }
    // 冷落
    D.HEROINES.forEach(function (hd) {
      var h = s.h[hd.id];
      if (!h.met) return;
      var gap = s.day - h.lastSeen;
      if (h.dating && gap >= (h.rel >= 2 ? 4 : 3)) { out.push(name(hd.id) + "：「最近……都沒看到你呢。」"); addAff(s, hd.id, -3, out); }
      else if (!h.dating && h.aff >= 40 && gap >= 6) addAff(s, hd.id, -1, null);
    });
    // 女友好感太低：分手
    lovers.forEach(function (hid) {
      if (s.h[hid].aff < 50) breakUp(s, hid, out, "💔 " + name(hid) + "：「我們……還是分開吧。」你們分手了。");
    });
    lovers = loversOf(s);
    // 修羅場
    if (lovers.length >= 2) {
      var avgJ = lovers.reduce(function (a, hid) { return a + D.HEROINE_BY_ID[hid].jealousy; }, 0) / lovers.length;
      var p = clamp(0.05 * (lovers.length - 1) * (1 + avgJ) + s.today.flirt * 0.015 - s.stats.rep / 600, 0.02, 0.55) * pace(s);
      // 修羅場之後 10 天內不會再爆發
      if (s.day - (s.flags.lastShura || -99) >= Math.max(2, Math.round(10 / span(s))) && rand(s) < p) {
        s.flags.lastShura = s.day;
        var a = pick(s, lovers), rest = lovers.filter(function (x) { return x !== a; }), b = pick(s, rest);
        s.events.unshift({ type: "shura", a: a, b: b });
      }
    }
    s.history.push({ day: s.day, study: s.stats.study, charm: s.stats.charm, money: s.stats.money, rep: s.stats.rep, lovers: lovers.length });
    s.summary = { day: s.day, lines: out };
    var prevYear = cal(s).year;
    s.day++;
    if (s.day >= s.length) { s.phase = "report"; s.today = null; }
    else if (cal(s).year !== prevYear) {
      // 學年結束：先看中間報告，再進入下一學年
      s.phase = "yearreport"; s.yearReport = prevYear; s.today = null;
    }
    else startDay(s);
    return out;
  }
  function nextYear(s) {
    if (s.phase !== "yearreport") return;
    s.yearReport = null;
    // 新學年：體力至少回到 80（出席率在學年報告中按學年分開計算）
    s.stats.stamina = Math.max(s.stats.stamina, 80);
    startDay(s);
  }

  // ---------------- 隨機事件 ----------------
  function metList(s, f) { return D.HEROINES.filter(function (hd) { var h = s.h[hd.id]; return h.met && (!f || f(h, hd)); }).map(function (hd) { return hd.id; }); }
  function genEvent(s) {
    var c = [];
    var met = metList(s);
    if (met.length && weather(s) === "rain") c.push({ type: "rain", hid: pick(s, met) }, { type: "rain", hid: pick(s, met) });
    c.push({ type: "wallet" });
    if (s.today.kind === "weekday") c.push({ type: "quiz" });
    if (s.fans >= 10 && !s.flags.fanpage) c.push({ type: "fanpage" });
    if (s.contacts > 0) c.push({ type: "line" });
    var inv = metList(s, function (h, hd) { return h.aff >= 45 && !h.dating; });
    if (inv.length) c.push({ type: "invite", hid: pick(s, inv) }, { type: "invite", hid: pick(s, inv) });
    var conf = metList(s, function (h, hd) { return h.aff >= 85 && !h.dating && h.quest >= hd.quests.length; });
    if (conf.length) c.push({ type: "herconfess", hid: pick(s, conf) }, { type: "herconfess", hid: pick(s, conf) });
    if (s.stats.money < 1500) c.push({ type: "broke" });
    // 追加的事件（wanren_data4.js）：依權重混進候選
    var w = c.map(function () { return 1; });
    (D.X_EVENTS || []).forEach(function (x) {
      if (x.night || !x.w || !x.cond(s, XA)) return;
      var ev = { type: "x", id: x.id };
      if (x.pick) { var p = x.pick(s, XA); Object.keys(p).forEach(function (k) { ev[k] = p[k]; }); }
      c.push(ev); w.push(x.w);
    });
    if (!c.length) return null;
    var tot = w.reduce(function (a, b) { return a + b; }, 0), r = rand(s) * tot;
    for (var i = 0; i < c.length; i++) { r -= w[i]; if (r < 0) return c[i]; }
    return c[c.length - 1];
  }
  function eventView(s, ev) {
    var n = ev.hid ? name(ev.hid) : "";
    if (ev.type === "rain") return { title: "☔ 突如其來的大雨", text: "放學時下起了大雨。你在校門口看到" + n + "望著天空，好像沒帶傘。", opts: ["共撐一把傘", "把傘借她，自己淋雨回家", "裝作沒看見"] };
    if (ev.type === "wallet") return { title: "👛 撿到錢包", text: "你在中庭撿到一個錢包，裡面有三千塊和一張學生證。", opts: ["交給失物招領處", "……沒人看到吧"] };
    if (ev.type === "quiz") return { title: "📝 突襲小考", text: "柊老師走進教室：「把課本收起來，小考。」", opts: ["憑實力作答", "偷看隔壁的答案"] };
    if (ev.type === "fanpage") return { title: "📱 粉絲專頁", text: "校園論壇上出現了「" + s.name + " 後援會」的粉絲專頁，追蹤人數持續增加中。", opts: ["大方分享、跟粉絲互動", "請管理員低調處理"] };
    if (ev.type === "line") return { title: "💬 LINE 爆炸", text: "之前交換聯絡方式的女生們，一早就傳來了上百則訊息。", opts: ["一則一則耐心回覆", "已讀不回", "全部封鎖"] };
    if (ev.type === "invite") return { title: "💌 " + n + " 的邀約", text: n + " 傳來訊息：「今天" + (isWeekend(s) ? "" : "放學後") + "……有空嗎？想跟你一起出去。」", opts: ["當然好！", "抱歉，今天不行"] };
    if (ev.type === "herconfess") return { title: "🌸 櫻花樹下", text: n + " 約你到櫻花林道。她低著頭，聲音在發抖：「我……我喜歡你。可以跟我交往嗎？」", opts: ["「我也喜歡你」", "「對不起……」"] };
    if (ev.type === "broke") return { title: "💸 錢包見底", text: "你的錢包只剩下幾枚硬幣。學餐的美紀學姐看你可憐，問你要不要來打工一天。", opts: ["去打工（今天自由時間 −2）", "撐過去就好"] };
    if (ev.type === "newyear") return { title: "🌸 " + YEAR_NAMES[ev.year] + "・新學年", text: "櫻花又開了。你升上了" + YEAR_NAMES[ev.year] + "，學姐們也升上了" + ["大二", "大三", "大四"][Math.min(ev.year, 2)] + "。校園裡多了一批對你投以憧憬眼神的新生。" + (ev.year === 2 ? "這是學姐們在學校的最後一年。" : ""), opts: ["新的一年也要加油"] };
    if (ev.type === "valentine") {
      var got = metList(s, function (h) { return h.aff >= 40; });
      return { title: "🍫 情人節", text: got.length ? "你收到了 " + got.map(name).join("、") + " 送的巧克力。還有鞋櫃裡塞滿了不知道是誰送的義理巧克力。" : "鞋櫃裡塞滿了不知道是誰送的巧克力……不過，認識的人一個也沒有送。", opts: ["收下大家的心意"] };
    }
    if (ev.type === "graduation") return { title: "🎓 畢業典禮", text: "學姐們今天畢業了。穿著袴的她們在櫻花樹下一一跟你道別。", opts: ["目送她們離開"] };
    if (ev.type === "story") return { title: "📖 " + n + "的故事", text: D.HEROINE_BY_ID[ev.hid].story[ev.idx], opts: ["陪在她身邊", "默默地聽她說"] };
    if (ev.type === "clubjoin") return { title: "🎪 社團招募", text: "中庭擠滿了社團招募的攤位。每個社團都在拉人：加入社團後，每週三、六可以參加社團活動（練專長、和社員變熟），秋天還有社團大會。", opts: D.CLUBS.map(function (c) { return c.icon + " " + D.L(c.name); }).concat(["先不加入"]) };
    if (ev.type === "clubcup") { var cc = D.CLUB_BY_ID[s.club]; return { title: "🏆 社團大會", text: "「" + D.L(cc.name) + "」上場了。這一年的練習成果，就看今天。", opts: ["全力以赴", "享受比賽就好"] }; }
    if (ev.type === "meetup") return { title: "💬 " + n + "的訊息", text: n + "：「今天……想在「" + D.L(D.LOC_BY_ID[ev.loc].name) + "」見面。早點來喔。」（自由時間開始後，用掉 2 點行動點以前到達算準時）", opts: ["「好，一定準時到」"] };
    if (ev.type === "anniv") return { title: "🎉 交往一個月", text: "今天是你和" + n + "交往滿一個月的日子。她好像一直在偷看你，等你開口。", opts: ["準備了驚喜", "「今天是我們的紀念日吧？」", "（忘記了……）"] };
    if (ev.type === "quarrel") return { title: "💢 吵架了", text: n + "從早上就不跟你說話。好像是因為你昨天說錯了什麼。", opts: ["馬上道歉", "先讓她冷靜一下", "說清楚自己沒有錯"] };
    if (ev.type === "family") return { title: "🏠 重要的人", text: n + "鼓起勇氣說：「我想……讓你見見我重要的人。」（正式拜訪要準備伴手禮 ¥5,000，風評 10 以上比較能被接受）", opts: ["正式去拜訪", "還沒準備好"] };
    if (ev.type === "promise") return { title: "💍 未來的約定", text: "最後一天的黃昏，" + n + "看著你：「三年，好快喔。……之後的日子，我們也要一起走下去嗎？」", opts: ["「約好了。」", "「……我還不知道。」"] };
    if (ev.type === "stalker") return { title: "👁 揮之不去的視線", text: "你回應過的「" + ev.who + "」開始每天在你家門口等你，還知道你昨天去了哪裡。", opts: ["嚴正地說清楚", "找可靠的人幫忙", "算了，隨她去"] };
    if (ev.type === "leak") return { title: "📢 論壇爆料", text: "「" + ev.who + "」在校園論壇發文：「他對每個女生都這麼溫柔嗎？」還附上了你們的合照。", opts: ["發文澄清", "不予理會"] };
    if (ev.type === "hiyoriUnlock") return { title: "🌙 神秘的學妹", text: "那個一直遠遠看著你的學妹，終於鼓起勇氣站到你面前：「學長……我叫朝比奈日和。我、我可以……成為學長身邊的人嗎？」", opts: ["「當然，請多指教」"] };
    if (ev.type === "fanPromote") return { title: "💗 " + ev.who + "的心意", text: "回應過你好幾次的" + ev.role + "「" + ev.who + "」在校門口攔住了你。她抓著書包的背帶，深呼吸了一次：「我……不想只是每天早上遠遠地看著你。可以讓我，正式地認識你嗎？」", opts: ["「當然。我們從朋友開始吧」", "「謝謝你……但還是保持現在這樣吧」"] };
    if (ev.type === "x") return D.X_EVENT_BY_ID[ev.id].view(s, ev, XA);
    if (ev.type === "enc") {
      var e = D.ENCOUNTERS.filter(function (x) { return x.id === ev.id; })[0];
      return { title: e.title, text: fmt(e.text, { n: n }), opts: e.opts };
    }
    if (ev.type === "shura") {
      var a = name(ev.a), b = name(ev.b);
      return { title: "⚡ 修羅場", text: a + "和" + b + "同時出現在你面前。她們看看彼此，再看看你。\n" + a + "：" + D.HEROINE_BY_ID[ev.a].lines.jealous + "\n" + b + "：" + D.HEROINE_BY_ID[ev.b].lines.jealous,
        opts: ["選擇" + a, "選擇" + b, "坦白：「我兩個都喜歡！」", "找藉口矇混過去"] };
    }
    return { title: "", text: "", opts: ["OK"] };
  }
  function resolveEvent(s, idx) {
    var ev = s.events.shift();
    if (!ev) return null;
    var out = [];
    var hid = ev.hid;
    if (ev.type === "rain") {
      if (idx === 0) { out.push("小小的傘下，你們的肩膀碰在一起。她一路上都沒說話，但嘴角一直在笑。"); addAff(s, hid, 6, out); }
      else if (idx === 1) { out.push("你把傘塞給她就跑進雨裡。隔天她紅著臉把傘還給你，還附了一張小卡片。"); addAff(s, hid, 9, out); applyEff(s, { stamina: -12 }, out); }
      else out.push("你撐著傘從她身邊走過。");
      if (idx < 2) s.h[hid].lastSeen = s.day;
    } else if (ev.type === "wallet") {
      if (idx === 0) { out.push("失主是一位學妹，她感激得一直鞠躬。這件事在系上傳開了。"); applyEff(s, { rep: 3 }, out); s.fans += 1; }
      else { out.push("你把三千塊放進口袋。……心裡有點不舒服。"); applyEff(s, { money: 3000, rep: -5 }, out); }
    } else if (ev.type === "quiz") {
      if (idx === 0) {
        if (s.stats.study >= 20 + rand(s) * 50) { out.push("寫得很順！你拿了高分。"); applyEff(s, { study: 2, rep: 1 }, out); if (s.h.rinko.met) addAff(s, "rinko", 2, out); }
        else { out.push("……有一半看不懂。"); applyEff(s, { study: 1 }, out); }
      } else if (rand(s) < 0.5) { out.push("成功了……但什麼也沒學到。"); }
      else { out.push("「你在看哪裡？」柊老師就站在你背後。"); applyEff(s, { rep: -5 }, out); if (s.h.rinko.met) addAff(s, "rinko", -5, out); }
    } else if (ev.type === "fanpage") {
      s.flags.fanpage = true;
      if (idx === 0) { out.push("你在專頁留言，粉絲們瘋狂了。"); applyEff(s, { charm: 3, rep: 1 }, out); s.fans += 5; s.today.flirt += 1; }
      else { out.push("專頁改成了私密社團。大家都說你很謙虛。"); applyEff(s, { rep: 2 }, out); }
    } else if (ev.type === "line") {
      if (idx === 0) { out.push("回到手指抽筋。大家都覺得你超溫柔。"); applyEff(s, { charm: 1, stamina: -5 }, out); s.fans += 1; s.today.flirt += 1; }
      else if (idx === 1) { out.push("訊息越來越多……"); applyEff(s, { rep: -1 }, out); }
      else { out.push("世界安靜了。不過也有人說你很無情。"); applyEff(s, { rep: -2 }, out); s.contacts = 0; }
    } else if (ev.type === "invite") {
      if (idx === 0) {
        if (s.today.date) { out.push("……可是你今天已經有約了。只好下次再說。"); addAff(s, hid, -1, out); }
        else { s.today.date = hid; out.push("約會成立！晚上記得赴約。"); }
      } else { out.push("「這樣啊……那下次吧。」"); addAff(s, hid, -2, out); }
    } else if (ev.type === "herconfess") {
      var hd = D.HEROINE_BY_ID[hid];
      if (idx === 0) {
        startDating(s, hid);
        out.push(name(hid) + "：" + hd.lines.cy);
        out.push("💕 你和" + name(hid) + "開始交往了！");
        addAff(s, hid, 8, out, true);
        applyEff(s, { charm: 3 }, out);
      } else { out.push(name(hid) + "強忍著眼淚：「……我知道了。謝謝你。」"); addAff(s, hid, -20, out); }
      s.h[hid].lastSeen = s.day;
    } else if (ev.type === "broke") {
      if (idx === 0) { out.push("你在學餐洗了一整天的盤子。"); applyEff(s, { money: 3000, stamina: -8 }, out); s.today.apBonus -= 2; if (s.h.miki.met) addAff(s, "miki", 4, out); }
      else out.push("今天就喝水度日吧……");
    } else if (ev.type === "newyear") {
      out.push("新的一年開始了。");
      applyEff(s, { stamina: 10 }, out);
    } else if (ev.type === "valentine") {
      metList(s, function (h) { return h.aff >= 40; }).forEach(function (x) {
        out.push(name(x) + "：" + lineOf(s, D.HEROINE_BY_ID[x].lines[s.h[x].dating ? "lover" : "like"]));
        addAff(s, x, s.h[x].dating ? 6 : 3, out);
        s.h[x].lastSeen = s.day;
      });
      s.fans += 3;
      if (out.length === 0) out.push("你吃了很多義理巧克力。");
    } else if (ev.type === "graduation") {
      D.HEROINES.filter(function (hd) { return hd.group === "senior" && s.h[hd.id].met; }).forEach(function (hd) {
        var h = s.h[hd.id], st = h.dating ? "lover" : h.aff >= 60 ? "high" : h.aff >= 20 ? "mid" : "low";
        out.push(name(hd.id) + "：" + hd.lines.end[st]);
        h.lastSeen = s.day;
      });
      if (!out.length) out.push("你不太認識的學姐們畢業了。");
      else memory(s, "graduation", "學姐們的畢業典禮", out.join("\n"), null);
    } else if (ev.type === "story") {
      var sh = s.h[hid];
      sh.story = Math.max(sh.story || 0, ev.idx + 1);
      s.storySeen++;
      memory(s, "story_" + hid + "_" + ev.idx, name(hid) + "・第 " + (ev.idx + 1) + " 段故事", D.HEROINE_BY_ID[hid].story[ev.idx], hid);
      out.push(idx === 0 ? "你一直陪在" + name(hid) + "身邊。" : "你安靜地聽" + name(hid) + "說完。");
      addAff(s, hid, idx === 0 ? 10 : 7, out);
      sh.lastSeen = s.day;
    } else if (ev.type === "clubjoin") {
      var club = D.CLUBS[idx];
      if (club) out = out.concat(joinClub(s, club.id));
      else out.push("暫時不加入社團。（之後隨時可以到社團大樓加入）");
      if (club) club.members.forEach(function (m) { if (available(s, m) && !s.h[m].met) { s.h[m].met = true; out.push("你在社團認識了" + name(m) + "。"); addAff(s, m, 5, out); } });
    } else if (ev.type === "clubcup") {
      var c2 = D.CLUB_BY_ID[s.club];
      var lv = Object.keys(c2.skills).reduce(function (a, k) { return a + s.skills[k]; }, 0) / Object.keys(c2.skills).length;
      // 2026-11-02 使用者要求加難：只看這一學年的出席，對手每年變強
      var yr = cal(s).year, att = (s.clubYear && s.clubYear[yr]) || 0;
      var score = lv * 0.5 + Math.min(att * (span(s) > 1 ? 1.4 : 1), 40) * 0.5 + (idx === 0 ? 6 : 0) + rand(s) * 20;
      var rival = 58 + yr * 13 + rand(s) * 15;
      if (idx === 0) applyEff(s, { stamina: -15 }, null);
      var place = score >= rival ? 1 : score >= rival - 12 ? 2 : 3;
      out.push("（我方 " + Math.round(score) + "　對手 " + Math.round(rival) + "）");
      out.push(place === 1 ? "🏆 優勝！全場起立鼓掌。" : place === 2 ? "🥈 準優勝！只差一點點。" : "這次沒有得名，但大家都很盡力。");
      if (place === 1) s.clubWins++;
      applyEff(s, { rep: place === 1 ? 6 : place === 2 ? 3 : 1, charm: place === 1 ? 3 : 1 }, out);
      c2.members.forEach(function (m) { if (s.h[m].met) { addAff(s, m, place === 1 ? 8 : place === 2 ? 5 : 3, out); s.h[m].lastSeen = s.day; } });
      memory(s, "clubcup_" + s.day, D.L(c2.name) + "・社團大會", out[1] + out[0], null);
    } else if (ev.type === "meetup") {
      s.today.meetup = { hid: hid, loc: ev.loc, by: 2, done: false };
      out.push("（記得在自由時間前往「" + D.L(D.LOC_BY_ID[ev.loc].name) + "」）");
    } else if (ev.type === "anniv") {
      var sh2 = s.h[hid];
      sh2.anniv = 1;
      if (idx === 2) { out.push(name(hid) + "：「……果然忘了。」她整天都沒有笑。"); addAff(s, hid, -10, out); }
      else {
        out.push(idx === 0 ? "你拿出準備好的禮物，" + name(hid) + "愣了一下，然後撲進你懷裡。" : name(hid) + "的眼睛一下子亮了：「你記得！」");
        addAff(s, hid, idx === 0 ? 10 : 6, out, true);
        if (sh2.aff >= 85) { sh2.rel = 2; out.push("💗 你們進入了熱戀期。"); memory(s, "rel2_" + hid, name(hid) + "・熱戀", out[0], hid); }
        else out.push("（好感 85 以上時，紀念日會讓你們進入熱戀。下次再努力吧。）");
        if (sh2.rel < 2) sh2.anniv = 0, sh2.since = s.day;   // 一個月後再來一次
      }
    } else if (ev.type === "quarrel") {
      var hq = D.HEROINE_BY_ID[hid];
      // 吃醋程度高的人要先道歉；不太在意的人給她時間
      var best = hq.jealousy >= 0.7 ? 0 : hq.jealousy <= 0.45 ? 1 : (hq.moment === "earnest" ? 2 : 0);
      if (idx === best) { out.push("和好之後，你們的感情好像比以前更好了。"); addAff(s, hid, 6, out, true); }
      else if (idx === 2) { out.push("「你都不懂我在想什麼！」她生氣地走掉了。"); addAff(s, hid, -10, out); }
      else { out.push("過了幾天，她才慢慢恢復笑容。"); addAff(s, hid, -3, out); }
      s.h[hid].lastSeen = s.day;
    } else if (ev.type === "family") {
      var sh3 = s.h[hid];
      if (idx === 1) { out.push(name(hid) + "：「……嗯，我等你準備好。」"); sh3.since = ago(s, 60); }
      else if (s.stats.money < 5000) { out.push("你連伴手禮都買不起……這次只好延期了。"); sh3.since = ago(s, 60); }
      else {
        applyEff(s, { money: -5000 }, out);
        var ft = D.FAMILY_TEXT[hid] || D.FAMILY_TEXT._default;
        out.push(fmt(ft, { n: name(hid) }));
        if (s.stats.rep >= 10 || rand(s) < 0.5) { sh3.rel = 3; addAff(s, hid, 8, out, true); out.push("🏠 你們的關係被家人認可了。"); memory(s, "rel3_" + hid, name(hid) + "・重要的人", fmt(ft, { n: name(hid) }), hid); }
        else { out.push("……家人似乎還有點疑慮。（風評再高一點吧）"); sh3.since = ago(s, 60); }
      }
    } else if (ev.type === "promise") {
      if (idx === 0) {
        s.h[hid].rel = 4;
        out.push("夕陽下，你和" + name(hid) + "勾了勾小指。💍");
        addAff(s, hid, 5, out, true);
        memory(s, "rel4_" + hid, name(hid) + "・未來的約定", "夕陽下，你和" + name(hid) + "勾了勾小指。", hid);
      } else { out.push(name(hid) + "：「……沒關係，我會等。」"); }
    } else if (ev.type === "stalker") {
      var helper = ["sachi", "akane", "kaoru"].filter(function (x) { return s.h[x] && s.h[x].met && available(s, x); })[0];
      if (idx === 0) { out.push("你清楚地拒絕了她。她哭著跑走了，之後再也沒有出現。"); applyEff(s, { rep: 2 }, out); }
      else if (idx === 1 && helper) { out.push(name(helper) + "站到你前面：「有事找我談。」從此世界安靜了。"); addAff(s, helper, 6, out); s.h[helper].lastSeen = s.day; }
      else if (idx === 1) { out.push("你找了學生會幫忙，事情總算平息了。"); applyEff(s, { rep: 1 }, out); }
      else { out.push("……她還在。下次約會可能會出事。"); s.flags.stalker = true; }
    } else if (ev.type === "leak") {
      if (idx === 0) {
        var ok2 = s.skills.talk >= 30 || rand(s) < 0.5;
        out.push(ok2 ? "你的澄清文寫得很誠懇，風向轉過來了。" : "澄清文反而越描越黑……");
        applyEff(s, { rep: ok2 ? 1 : -4 }, out);
      } else {
        out.push("討論串越來越長。");
        applyEff(s, { rep: -4 }, out);
        loversOf(s).forEach(function (x) { addAff(s, x, -3, out); });
      }
    } else if (ev.type === "hiyoriUnlock") {
      s.flags.hiyori = true;
      s.h.hiyori.met = true; s.h.hiyori.lastSeen = s.day;
      addAff(s, "hiyori", 10, out, true);
      out.push("🌙 隱藏女主角「朝比奈 日和」登場了！");
    } else if (ev.type === "fanPromote") {
      if (idx === 0) { out.push("她用力點頭，眼眶有點紅：「嗯！請多指教！」"); promoteFan(s, ev, out); }
      else {
        out.push("她笑著擦了擦眼角：「……嗯。那我會繼續默默支持你的！」");
        applyEff(s, { rep: 1 }, out);
        var rj = s.pool.filter(function (p) { return p.id === ev.aid; })[0];
        if (rj) rj.st = "rejected";
      }
    } else if (ev.type === "x") {
      s.xev = (s.xev || 0) + 1;
      D.X_EVENT_BY_ID[ev.id].res(s, ev, idx, out, XA);
    } else if (ev.type === "enc" && D.ENCOUNTERS.some(function (x) { return x.id === ev.id && x.res; })) {
      D.ENCOUNTERS.filter(function (x) { return x.id === ev.id; })[0].res(s, ev, idx, out, XA);
    } else if (ev.type === "enc") {
      if (ev.id === "bump") {
        if (idx === 0) { out.push("你們蹲在地上一起撿東西，手不小心碰在一起。"); addAff(s, hid, 4, out); }
        else if (idx === 1) { out.push(name(hid) + "握著你的手站起來：「……謝謝。」"); addAff(s, hid, 3, out); }
        else { out.push("你道歉後就走了。"); addAff(s, hid, -1, out); }
        s.h[hid].lastSeen = s.day;
      } else if (ev.id === "item") {
        if (idx === 0) { out.push("失主是一位學妹。她感激得送了你一盒巧克力。"); s.inv.choco = (s.inv.choco || 0) + 1; applyEff(s, { rep: 1 }, out); }
        else { var it = pick(s, D.ITEMS.slice(0, 9)); s.inv[it.id] = (s.inv[it.id] || 0) + 1; out.push("裡面是「" + D.L(it.name) + "」。……先收著吧。"); applyEff(s, { rep: -1 }, out); }
      } else if (ev.id === "witness") {
        if (idx === 0) { out.push("她接過面紙，哭著笑了：「……謝謝你。」"); s.fans += 1; applyEff(s, { charm: 1 }, out); }
        else out.push("你悄悄離開了。");
      } else if (ev.id === "lost") {
        if (idx === 0) { out.push("新生一路上都在偷看你。隔天，她的朋友們都知道你的名字了。"); s.fans += 2; applyEff(s, { stamina: -3 }, out); }
        else { out.push("「謝謝學長！」"); s.fans += 1; }
      } else if (ev.id === "coin") {
        if (idx === 0) applyEff(s, { money: 500 }, out);
        else { out.push("硬幣沉進水裡。……今天好像會有好事發生。"); applyEff(s, { charm: 1 }, out); }
      } else if (ev.id === "cat") {
        out.push(idx === 0 ? "三花貓吃完後在你腳邊睡著了。" : "三花貓舒服地瞇起眼睛。");
        applyEff(s, { stamina: 4 }, out);
        if (s.h.rena.met) { out.push("七瀨醫師從保健中心的窗戶看著你笑。"); addAff(s, "rena", 2, out); }
      } else if (ev.id === "rain") {
        if (idx === 0) applyEff(s, { stamina: 3 }, out);
        else { out.push("全身濕透了。"); applyEff(s, { stamina: -5 }, out); }
      }
    } else if (ev.type === "shura") {
      s.shura++;
      var a = ev.a, b = ev.b;
      if (!s.h[a].dating || !s.h[b].dating) { out.push("……好像是誤會一場。"); return out; }
      if (idx === 0 || idx === 1) {
        var keep = idx === 0 ? a : b, lose = idx === 0 ? b : a;
        out.push("你握住了" + name(keep) + "的手。" + name(lose) + "什麼也沒說，轉身離開了。");
        breakUp(s, lose);
        addAff(s, lose, -30, out); addAff(s, keep, 6, out);
        applyEff(s, { rep: -3 }, out);
      } else if (idx === 2) {
        var ok = s.stats.charm >= 70 && rand(s) < 0.3 + (s.stats.charm - 70) / 60;
        if (ok) {
          out.push("一陣沉默之後，兩個人同時嘆了一口氣：「……真拿你沒辦法。」這就是萬人迷的力量嗎？");
          addAff(s, a, -4, out); addAff(s, b, -4, out);
          s.flags.harem = (s.flags.harem || 0) + 1;
          applyEff(s, { charm: 2 }, out);
        } else {
          out.push("「你是認真的嗎？！」兩記巴掌同時落在你的臉上。");
          [a, b].forEach(function (x) {
            addAff(s, x, -20, out);
            if (D.HEROINE_BY_ID[x].jealousy >= 0.6 || s.h[x].aff < 50) breakUp(s, x, out, "💔 " + name(x) + "跟你分手了。");
          });
          applyEff(s, { rep: -8 }, out);
        }
      } else {
        if (rand(s) < 0.45 + s.stats.charm / 300) { out.push("「她只是在問我功課啦！」……好像矇混過去了。"); applyEff(s, { rep: -2 }, out); }
        else {
          out.push("藉口被一眼看穿了。");
          addAff(s, a, -15, out); addAff(s, b, -15, out);
          var worse = D.HEROINE_BY_ID[a].jealousy >= D.HEROINE_BY_ID[b].jealousy ? a : b;
          breakUp(s, worse, out, "💔 " + name(worse) + "跟你分手了。");
          applyEff(s, { rep: -5 }, out);
        }
      }
    }
    return out;
  }

  // ---------------- 學期報告 ----------------
  // year 有值＝該學年的中間報告（考試只算那一學年）
  function report(s, year) {
    var interim = year !== undefined && year !== null;
    var exams = s.exams.filter(function (e) { return !interim || (e.year || 0) === year; });
    var examAvg = exams.length ? exams.reduce(function (a, e) { return a + e.score; }, 0) / exams.length : s.stats.study;
    var att = interim ? (s.att.byYear && s.att.byYear[year]) || { ok: 0, total: 0 } : s.att;
    var attRate = att.total ? att.ok / att.total : 1;
    var grade = Math.round(clamp(examAvg * 0.6 + attRate * 25 + s.stats.study * 0.15, 0, 100));
    var letter = grade >= 90 ? "S（秀）" : grade >= 80 ? "A（優）" : grade >= 70 ? "B（良）" : grade >= 60 ? "C（可）" : "F（不可）";
    var rows = D.HEROINES.filter(function (hd) { return available(s, hd.id); }).map(function (hd) {
      var h = s.h[hd.id];
      var st = !h.met ? "none" : h.dating ? "lover" : h.aff >= 60 ? "high" : h.aff >= 20 ? "mid" : "low";
      return { id: hd.id, name: D.L(hd.name), group: hd.group, aff: h.aff, met: h.met, dating: h.dating, stage: stageName(s, hd.id), status: st,
        line: st === "none" ? "" : hd.lines.end[st], dates: h.dates, quest: h.quest, rel: h.rel || 0,
        relName: h.dating ? D.L(D.REL_STAGES[h.rel || 1].name) : "" };
    });
    var lovers = rows.filter(function (r) { return r.dating; });
    var r = {
      grade: grade, letter: letter, examAvg: Math.round(examAvg), attRate: Math.round(attRate * 100), exams: exams, interim: interim, yearName: interim ? YEAR_NAMES[year] : "", years: lengthOf(s).id === "full" ? 3 : 1,
      lovers: lovers.length, friends: rows.filter(function (x) { return x.met && x.aff >= 20; }).length,
      maxAff: rows.reduce(function (a, x) { return Math.max(a, x.aff); }, 0), met: rows.filter(function (x) { return x.met; }).length,
      fans: s.fans, admirers: s.admirersTotal, ignored: s.ignored, rejected: s.rejected, shura: s.shura, breakups: s.breakups, dates: s.dates,
      rep: s.stats.rep, charm: s.stats.charm, study: s.stats.study, money: s.stats.money, rows: rows, name: s.name, days: Math.max(1, Math.min(s.day, s.length))
    };
    var title = D.TITLES.filter(function (t) { return t.cond(r); })[0];
    r.title = title.name; r.titleComment = title.comment;
    // 人數變多（66 人）後只算好感最高的 15 人，避免分數膨脹
    var sumAff = rows.map(function (x) { return x.aff; }).sort(function (a, b) { return b - a; }).slice(0, 15).reduce(function (a, x) { return a + x; }, 0);
    r.fansPerDay = r.fans / r.days;
    r.score = Math.round(r.charm * 1.5 + Math.min(r.fansPerDay, 6) * 12 + sumAff / 6 + r.lovers * 25 + r.rep * 0.5 + grade * 0.5);
    r.rank = r.score >= 480 ? "SS" : r.score >= 380 ? "S" : r.score >= 280 ? "A" : r.score >= 190 ? "B" : r.score >= 110 ? "C" : "D";
    // 導師評語
    r.teacher = grade >= 90 ? "成績優異，無可挑剔。……接下來，也繼續坐在第一排吧。" :
      grade >= 80 ? "很認真。能保持這種成績，值得肯定。" :
      grade >= 70 ? "表現穩定。但我知道你可以做得更好。" :
      grade >= 60 ? "勉強及格。你的心思，好像不完全在課本上。" :
      "這樣下去會留級。暑假的補習，我會親自盯著你。";
    if (r.attRate < 70) r.teacher += "另外，出席率 " + r.attRate + "% 是怎麼回事？";
    // 感情評語
    var love = [];
    if (r.lovers === 0) love.push(r.maxAff >= 60 ? "有好幾段差一點就開花結果的感情。下學期，勇敢一點吧。" : "這個學期沒有談戀愛。也許你在等一個真正的心動。");
    else if (r.lovers === 1) love.push("你和" + lovers[0].name + "的故事，是校園裡最多人在聊的話題。");
    else love.push("你同時和 " + lovers.map(function (x) { return x.name; }).join("、") + " 交往中。" + (r.shura ? "經歷了 " + r.shura + " 次修羅場，" : "奇蹟似地沒有被發現，") + "依然活著。");
    if (r.fans >= 20) love.push("後援會的人數達到 " + r.fans + " 人，你走在校園裡會被偷拍。");
    if (r.ignored >= 20) love.push("你無視了 " + r.ignored + " 個鼓起勇氣的女生。有人說你是「冰山王子」。");
    if (r.breakups) love.push("也經歷了 " + r.breakups + " 次分手。每一次心痛，都讓你更懂得愛。");
    if (lovers.some(function (x) { return x.group === "parent"; }) && lovers.some(function (x) { return x.group === "classmate"; })) love.push("……和同學的媽媽交往這件事，下學期要怎麼解釋呢？");
    if (lovers.some(function (x) { return x.group === "teacher"; })) love.push("師生戀被傳開之前，最好低調一點。");
    r.love = love;
    r.skills = JSON.parse(JSON.stringify(s.skills)); r.club = s.club; r.clubWins = s.clubWins; r.ng = s.ng || 0;
    // 真結局：二周目以上，15 位主要女主角好感都 80 以上（第 12 項）
    r.trueEnd = !interim && !!s.ng && D.HEROINES.filter(function (hd) { return !hd.hidden && !hd.ext; }).every(function (hd) { return s.h[hd.id].aff >= 80; });
    if (r.trueEnd) love.unshift("🌈【真結局】三年來，你讓每一個人都露出了笑容。畢業典禮那天，15 個人一起站在櫻花樹下，對你說：「謝謝你來到這間學校。」");
    if (!interim) recordEnding(s, r);
    r.summary = interim ? s.name + "的" + YEAR_NAMES[year] + "學年結束了。目前的稱號是「" + r.title + "」。" :
      s.name + "在私立音夣學園大學的" + (r.years === 3 ? "三年" : lengthOf(s).id === "year" ? "第一年" : "四週") + "，以「" + r.title + "」畫下句點。學業 " + letter + "、萬人迷指數 " + r.score + "（" + r.rank + "）。";
    return r;
  }

  // 最後的報告：記錄各女主角的結局、稱號、通關次數（同一個存檔只記一次）
  function recordEnding(s, r) {
    if (s.flags.recorded) return;
    s.flags.recorded = true;
    var m = loadMeta();
    var rank = { lover4: 4, lover: 3, high: 2, mid: 1 };
    r.rows.forEach(function (row) {
      var tier = row.status === "lover" && row.rel >= 4 ? "lover4" : row.status;
      if (!rank[tier] || (D.HEROINE_BY_ID[row.id] || {}).dyn) return;
      if (!m.endings[row.id] || rank[m.endings[row.id]] < rank[tier]) m.endings[row.id] = tier;
    });
    m.titles[r.title] = (m.titles[r.title] || 0) + 1;
    m.lastSkills = r.skills;
    if (lengthOf(s).id === "full") m.clears++;
    saveMeta(m);
    if (lengthOf(s).id === "full") unlock(s, "clear");
    if (r.trueEnd) unlock(s, "trueEnd");
  }

  // ======================================================================
  // 2026-11-05 遊戲性擴充（使用者選 1、2、3、6、7＋更多玩法）。資料在 wanren_data6.js。
  // ======================================================================

  // ---------------- 照片：時間管理大師的女生照片，以 seed 洗牌（同一場固定，新遊戲換一組） ----------------
  var PHOTO_POOL = (function () {
    var a = [], i;
    for (i = 0; i < 143; i++) a.push("g_" + ("00" + i).slice(-3));
    for (i = 0; i < 32; i++) a.push("n_" + ("00" + i).slice(-3));
    return a;
  })();
  var photoCache = { seed: null };
  function photoSet(seed) {
    if (photoCache.seed === seed) return photoCache;
    var x = (seed ^ 0x5eed1234) | 0;
    var rnd = function () { x = (x + 0x6D2B79F5) | 0; var r = Math.imul(x ^ (x >>> 15), 1 | x); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
    var pool = PHOTO_POOL.slice(), i, j, tmp;
    for (i = pool.length - 1; i > 0; i--) { j = Math.floor(rnd() * (i + 1)); tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp; }
    var byHid = {}, k = 0;
    // 固定登場的人一人一張；轉正的迷妹沿用她當迷妹時的照片
    D.HEROINES.forEach(function (hd) { if (!hd.dyn) byHid[hd.id] = pool[k++ % pool.length]; });
    photoCache = { seed: seed, byHid: byHid, rest: k < pool.length ? pool.slice(k) : pool };
    return photoCache;
  }
  function photoOfAdmirer(seed, nm, role) {
    var P = photoSet(seed);
    return P.rest[Math.floor(hash(nm, role, seed, "photo") * P.rest.length)];
  }
  function photoOf(seed, hid) {
    var hd = D.HEROINE_BY_ID[hid];
    if (!hd) return null;
    if (hd.fan) return photoOfAdmirer(seed, hd.fan.name, hd.fan.role);
    return photoSet(seed).byHid[hid] || null;
  }
  // 照片圖鑑（跨周目，meta.ph）：哪張照片扮演過誰、最高好感、在哪幾輪交往過。
  // 只有「認識」的角色才算收集（迷妹不算），一輪約 86 張，要好幾輪才收得齊。
  function notePhoto(m, file, nm, aff, lover, seed) {
    if (!file) return false;
    var ph = m.ph || (m.ph = {}), e = ph[file], ch = false;
    if (!e) { e = ph[file] = { n: [], a: 0, l: [] }; ch = true; }
    if (nm && e.n.indexOf(nm) < 0) { e.n.push(nm); if (e.n.length > 6) e.n.shift(); ch = true; }
    if (aff > e.a) { e.a = aff; ch = true; }
    if (lover && e.l.indexOf(seed) < 0) { e.l.push(seed); if (e.l.length > 6) e.l.shift(); ch = true; }
    return ch;
  }
  function recordPhotos(s, m) {
    var ch = false;
    D.HEROINES.forEach(function (hd) {
      var h = s.h[hd.id];
      if (h && h.met && notePhoto(m, photoOf(s.seed, hd.id), D.L(hd.name), h.aff, h.dating, s.seed)) ch = true;
    });
    return ch;
  }

  // ---------------- 1. 迷妹轉正 ----------------
  // 轉正的迷妹＝執行時才產生的角色（hd.dyn）。存檔只存精簡資料（s.promoted），讀檔、新遊戲時重新登錄。
  var circleCache = null;
  function registerDyn(s) {
    for (var i = D.HEROINES.length - 1; i >= 0; i--) {
      if (D.HEROINES[i].dyn) { delete D.HEROINE_BY_ID[D.HEROINES[i].id]; D.HEROINES.splice(i, 1); }
    }
    (s.promoted || []).forEach(function (c) {
      var hd = D.CAST_KIT.build(c);
      hd.dyn = true; hd.fan = c.fan;
      D.HEROINES.push(hd); D.HEROINE_BY_ID[hd.id] = hd;
    });
    circleCache = null;
  }
  function fanCast(s, ev) {
    var K = D.FAN_KIT, nm = ev.who, role = ev.role;
    var info = K.ROLE_INFO[role] || { sp: "plaza cafe garden", age: 19 };
    function hv(salt) { return hash(s.seed, nm, role, salt); }
    function pickH(arr, salt) { return arr[Math.floor(hv(salt) * arr.length)]; }
    function pickN(arr, n, salt, not) {
      var out = [], k = 0;
      while (out.length < n && k < 60) { var x = arr[Math.floor(hash(s.seed, nm, salt, k) * arr.length)]; if (out.indexOf(x) < 0 && (!not || not.indexOf(x) < 0)) out.push(x); k++; }
      return out;
    }
    var tl = pickN(K.TOPICS, 2, "tl"), tb = pickN(K.TOPICS, 2, "tb", tl);
    var gl = pickN(K.GIFTS, 3, "gl"), gb = pickN(K.GIFTS, 2, "gb", gl);
    var dl = pickN(K.DATES, 2, "dl"), db = pickN(K.DATES, 2, "db", dl);
    var sp = info.sp.split(" ");
    var given = nm.split(" ")[1] || nm;
    var q = K.QUESTS.map(function (t) {
      var req = t[3] === "loc" ? "loc:" + sp[0] : t[3] === "item" ? "item:" + gl[0] : t[3];
      var desc = t[2].replace("{l}", "「" + D.L(D.LOC_BY_ID[sp[0]].name) + "」").replace("{g}", "「" + D.L(D.ITEM_BY_ID[gl[0]].name) + "」");
      return [t[0], t[1], desc, req, t[4], t[5]];
    });
    var L = K.LINES;
    return {
      id: "fan_" + (s.promoted.length + 1) + "_" + Math.floor(hv("id") * 1e6), g: "fanclub", age: info.age,
      n: [nm, nm], t: [role + "（前迷妹）", role + "（元ファン）"], p: pickH(K.PERSONAS, "p"),
      intro: role + "。原本是每天早上跟你搭話的女生之一。你回應了她 " + (ev.n || 3) + " 次心意之後，她鼓起勇氣說想正式認識你。",
      tl: tl.join(" "), tb: tb.join(" "), gl: gl.join(" "), gb: gb.join(" "), dl: dl.join(" "), db: db.join(" "),
      m: pickH(["romantic", "funny", "earnest"], "m"), sp: info.sp,
      look: [ev.hair || 0x2a1e1a, pickH(["long", "ponytail", "bob", "twin", "wavy", "braid", "sidepony"], "style"), 0xf6dcc8, pickH(K.TOPS, "top"), 0x2a3358, pickH(K.OUTFITS, "outfit"), 0xd04050, 0.93 + hv("h") * 0.08],
      q: q, st: K.STORY.map(function (x) { return x.replace(/\{n\}/g, given); }),
      cf: { charm: 40 }, j: 0.5, inv: 30,
      greet: L.greet.replace(/\{n\}/g, nm), cy: L.cy, jl: L.jl, el: L.el,
      fan: { name: nm, role: role }
    };
  }
  function promoteFan(s, ev, out) {
    var c = fanCast(s, ev);
    s.promoted.push(c);
    registerDyn(s);
    ensureFields(s);
    var h = s.h[c.id];
    h.met = true; h.lastSeen = s.day;
    addAff(s, c.id, 20, out, true);
    var rec = s.pool.filter(function (p) { return p.id === ev.aid; })[0];
    if (rec) rec.st = "promoted";
    out.push("🌱「" + ev.who + "」成為可攻略角色了！（人物一覽的「轉正的迷妹」）");
    memory(s, "fan_" + s.seed + "_" + c.id, ev.who + "・從粉絲開始", "那天早上鼓起勇氣跟你搭話的" + ev.role + "，現在成了你身邊的人。", c.id);
  }

  // ---------------- 3. 剪影尋人 ----------------
  // 一半的日子（考試日除外）會有一張剪影：在校園裡找到她、跟她說話就成功
  function genHunt(s) {
    if (EXAM_KINDS[s.today.kind] || hash(s.seed, s.day, "hunt") >= 0.5) return null;
    var here = D.HEROINES.filter(function (hd) { return !hd.hidden && whereIs(s, hd.id, s.day, 0); });
    if (!here.length) return null;
    var unmet = here.filter(function (hd) { return !s.h[hd.id].met; });
    var list = unmet.length ? unmet : here;
    var hd = list[Math.floor(hash(s.seed, s.day, "huntWho") * list.length)];
    return { hid: hd.id, loc: whereIs(s, hd.id, s.day, 0), done: false };
  }
  function completeHunt(s, hid, out) {
    var hu = s.today && s.today.hunt;
    if (!hu || hu.done || hu.hid !== hid) return;
    hu.done = true; s.hunts++;
    out.push("【🔍 尋人成功】找到剪影的主人了！");
    applyEff(s, { charm: 1, rep: 2 }, out);
    addAff(s, hid, 4, out);
  }

  // ---------------- 6. 傳聞網路 ----------------
  // 交友圈：同社團、雙人互動、母女；轉正的迷妹彼此是一個圈子（迷妹情報網）
  function circles() {
    if (circleCache) return circleCache;
    var map = {};
    function link(a, b) {
      if (!a || !b || a === b || !D.HEROINE_BY_ID[a] || !D.HEROINE_BY_ID[b]) return;
      (map[a] = map[a] || {})[b] = 1; (map[b] = map[b] || {})[a] = 1;
    }
    D.CLUBS.forEach(function (c) { c.members.forEach(function (a) { c.members.forEach(function (b) { link(a, b); }); }); });
    D.PAIRS.forEach(function (p) { link(p.a, p.b); });
    var fans = [];
    D.HEROINES.forEach(function (hd) { if (hd.daughter) link(hd.id, hd.daughter); if (hd.dyn) fans.push(hd.id); });
    fans.forEach(function (a) { fans.forEach(function (b) { link(a, b); }); });
    circleCache = map;
    return map;
  }
  function circleOf(hid) { return Object.keys(circles()[hid] || {}); }
  // good：好事傳開（35%，一人好感 +3）；壞事（60%，一人好感 −4）
  function rumor(s, hid, good, why, out) {
    var fr = circleOf(hid).filter(function (x) { return s.h[x] && s.h[x].met && available(s, x); });
    if (!fr.length || rand(s) >= (good ? 0.35 : 0.6)) return;
    var who = pick(s, fr), text = name(who) + "聽說了你" + why + "。";
    if (out) out.push("📣 傳聞：" + text);
    addAff(s, who, good ? 3 : -4, out);
    if (good) s.rumorGood++; else s.rumorBad++;
    s.rumorLog.unshift({ day: s.day, good: !!good, text: text });
    if (s.rumorLog.length > 12) s.rumorLog.length = 12;
  }

  // ---------------- 7. 穿搭與房間 ----------------
  function buyOutfit(s, id) {
    var o = D.OUTFIT_BY_ID[id];
    if (!o) return null;
    if (s.outfits[id]) { s.outfit = id; return ["換上了「" + D.L(o.name) + "」。"]; }
    if (s.stats.money < o.price) return ["錢不夠。"];
    s.stats.money -= o.price; s.outfits[id] = 1; s.outfit = id;
    return ["買了「" + D.L(o.name) + "」並換上（¥" + o.price.toLocaleString() + "）。"];
  }
  function buyFurniture(s, id) {
    var f = D.FURNITURE_BY_ID[id];
    if (!f || s.room[id]) return null;
    if (s.stats.money < f.price) return ["錢不夠。"];
    s.stats.money -= f.price; s.room[id] = 1;
    return ["房間添了「" + D.L(f.name) + "」（¥" + f.price.toLocaleString() + "）。"];
  }
  function comfort(s) { return Object.keys(s.room || {}).reduce(function (a, id) { return a + ((D.FURNITURE_BY_ID && D.FURNITURE_BY_ID[id] || {}).comfort || 0); }, 0); }
  function outfitFits(s, spotId) { var o = D.OUTFIT_BY_ID && D.OUTFIT_BY_ID[s.outfit]; return !!(o && o.spots.indexOf(spotId) >= 0); }

  // ---------------- 追加：約會拍立得 ----------------
  function takePolaroid(s, hid, spotId, out) {
    s.polaroids++;
    var m = loadMeta();
    m.pol = m.pol || [];
    m.pol.unshift({ k: s.seed + "_" + s.day, hid: hid, file: photoOf(s.seed, hid), name: name(hid), spot: spotId, date: dateLabel(s, s.day), at: Date.now() });
    if (m.pol.length > 150) m.pol.length = 150;
    saveMeta(m);
    out.push("📸 你們拍了一張拍立得。（回憶錄 → 拍立得）");
  }

  // ---------------- 追加：校園 SNS ----------------
  function snsPost(s, arg) {
    var parts = String(arg || "").split(":"), pid = parts[0], hid = parts[1];
    var p = (D.SNS_POSTS || []).filter(function (x) { return x.id === pid; })[0];
    if (!p) return null;
    if (p.need === "club" && !s.club) return null;
    if (p.need === "lover" && !(hid && s.h[hid] && s.h[hid].dating)) return null;
    var out = [p.icon + " 你在校園 SNS 發了一篇「" + D.L(p.name) + "」。"];
    var mult = 1 + s.stats.charm / 80 + Math.min(1, s.sns / 2000);
    if (pid === "food" && s.skills.cook >= 20) mult *= 2;
    if (s.lastPost === pid) { mult *= 0.5; out.push("（又是同一種文……大家有點膩了）"); }
    var gain = Math.max(1, Math.round(p.f * mult * (0.7 + rand(s) * 0.6)));
    var before = s.sns;
    s.sns += gain; s.snsPosts++; s.lastPost = pid;
    out.push("（追蹤 +" + gain + "，目前 " + s.sns.toLocaleString() + " 人）");
    if (pid === "selfie") {
      var f = ri(s, 1, 3); s.fans += f; s.today.flirt += 1;
      out.push("留言區被愛心洗版了。（粉絲 +" + f + "）");
    } else if (pid === "food") {
      metList(s, function (h, hd) { return hd.topics.like.indexOf("food") >= 0; }).slice(0, 3).forEach(function (x) { out.push(name(x) + "按了讚：「看起來好好吃！」"); addAff(s, x, 1, out); });
    } else if (pid === "study") {
      applyEff(s, { study: 1, rep: 1 }, out);
    } else if (pid === "club") {
      D.CLUB_BY_ID[s.club].members.filter(function (x) { return s.h[x] && s.h[x].met; }).slice(0, 4).forEach(function (x) { addAff(s, x, 1, out); });
    } else if (pid === "lover") {
      out.push(name(hid) + "轉發了，還加了一句：「♡」");
      addAff(s, hid, 5, out);
      var others = loversOf(s).filter(function (x) { return x !== hid; });
      others.forEach(function (x) { out.push(name(x) + "：「……那張照片是怎麼回事？」"); addAff(s, x, -4, out); });
      if (others.length >= 2 && rand(s) < 0.3) {
        out.push("🔥 炎上了！有人把你和不同女生的合照拼成了一張圖。");
        applyEff(s, { rep: -5 }, out);
        loversOf(s).forEach(function (x) { addAff(s, x, -3, out); });
      }
    }
    (D.SNS_STEPS || []).forEach(function (st) {
      if (before < st && s.sns >= st) { var bonus = Math.round(st / 50); out.push("🎉 追蹤人數突破 " + st.toLocaleString() + "！（粉絲 +" + bonus + "）"); s.fans += bonus; applyEff(s, { charm: 1 }, out); }
    });
    applyEff(s, { stamina: -2 }, out);
    return out;
  }

  // ======================================================================
  // 2026-11-05 手機聊天與全肯定（資料在 wanren_data7.js）
  // ======================================================================
  // ---------------- 全肯定：好感 80 以上或交往中，通常（85%）會全盤肯定你 ----------------
  function isClose(s, hid) { var h = s.h[hid]; return !!h && (h.dating || h.aff >= (D.AFFIRM_MIN_AFF || 80)); }
  function rollAffirm(s, hid) { return !!D.AFFIRM && isClose(s, hid) && rand(s) < (D.AFFIRM_RATE || 0.85); }
  function affirmLine(s, hid) {
    var hd = D.HEROINE_BY_ID[hid], key = hd.persona || (D.MAIN_PERSONA || {})[hid];
    var pool = (D.AFFIRM[key] || []).concat(D.AFFIRM.generic);
    var y = (D.CAST_KIT && D.CAST_KIT.ADDRESS[hd.group]) || "你";
    s.affirmed++;
    return pick(s, pool).replace(/\{y\}/g, y);
  }

  // ---------------- 💓 心跳時刻（2026-11-06） ----------------
  // s.doki＝{ hid, sit（情境 id 或 "confess"）, ctx, step: "choose"→"beat", tone }。畫面看到 s.doki 就先顯示它。
  // 一天最多 3 次，每人每天 1 次；告白不受限制。節拍的判定在畫面，這裡只收「得分 0〜taps×2」。
  var DOKI_PER_DAY = 3;
  function dokiPref(hid) {
    var hd = D.HEROINE_BY_ID[hid], key = hd.persona || (D.MAIN_PERSONA || {})[hid];
    return (D.DOKI_PREF || {})[key] || "gentle";
  }
  function dokiBpm(s, hid) {
    var b = D.DOKI_BEAT, h = s.h[hid];
    return Math.round(b.base + h.aff * b.perAff + (h.dating ? b.dating : 0));
  }
  function dokiSit(s) { return s.doki ? (s.doki.sit === "confess" ? D.DOKI_CONFESS : D.DOKI_BY_ID[s.doki.sit]) : null; }
  function dokiStart(s, hid, ctx, out, curLoc) {
    if (!D.DOKI || !s.today || s.doki) return false;
    var h = s.h[hid], td = s.today;
    td.dokiN = td.dokiN || 0; td.dokiWho = td.dokiWho || {};
    if (!h || !h.met || td.dokiN >= DOKI_PER_DAY || td.dokiWho[hid]) return false;
    var rainy = td.weather === "rain" || td.weather === "snow";
    var list = D.DOKI.filter(function (d) {
      if (d.ctx.indexOf(ctx) < 0 && !(rainy && d.ctx.indexOf("rain") >= 0 && ctx !== "fest")) return false;
      return !d.loc || (curLoc && d.loc.indexOf(curLoc) >= 0);
    });
    if (rainy) list = list.concat(list.filter(function (d) { return d.ctx.indexOf("rain") >= 0; }));   // 雨天：傘下的機率加倍
    if (!list.length) return false;
    var sit = pick(s, list);
    td.dokiN++; td.dokiWho[hid] = true;
    s.doki = { hid: hid, sit: sit.id, ctx: ctx, step: "choose", tone: null };
    if (out) out.push("（💓 ……心跳突然加快了。）");
    return true;
  }
  // 聊天、遭遇後的機率：好感 30 以上，越喜歡你越常發生
  function dokiChance(s, hid) {
    var a = s.h[hid].aff;
    return a < 30 ? 0 : clamp(0.12 + (a - 30) / 250 + (s.h[hid].dating ? 0.08 : 0), 0, 0.4);
  }
  function dokiChoose(s, tone) {
    if (!s.doki || s.doki.step !== "choose" || !D.DOKI_TONES.some(function (x) { return x.id === tone; })) return null;
    s.doki.tone = tone; s.doki.step = "beat";
    return { bpm: dokiBpm(s, s.doki.hid), taps: D.DOKI_BEAT.taps };
  }
  // pts：節拍得分（完美 2、普通 1、沒按到 0）的總和
  function dokiFinish(s, pts) {
    var dk = s.doki;
    if (!dk || dk.step !== "beat") return null;
    s.doki = null;
    var hid = dk.hid, max = D.DOKI_BEAT.taps * 2;
    pts = clamp(Math.round(pts) || 0, 0, max);
    var pref = dokiPref(hid), match = dk.tone === pref ? "match" : dk.tone === "gentle" ? "mid" : "miss";
    var perfect = pts >= max;
    if (match === "match") s.h[hid].dokiTone = dk.tone;   // 猜中一次之後，畫面會標出她最心動的做法
    s.dokiN = (s.dokiN || 0) + 1;
    if (perfect) s.dokiPerfect = (s.dokiPerfect || 0) + 1;
    var sit = dk.sit === "confess" ? D.DOKI_CONFESS : D.DOKI_BY_ID[dk.sit];
    var out = [];
    out.push("💓 " + (pts >= max ? "心跳完全同步！" : pts >= max / 2 ? "心跳有點對上了。" : "心跳亂成一團……") + "（" + pts + "／" + max + "）");
    if (dk.sit === "confess") {
      // 告白：說法符合她 +10%、溫柔 +3%、不合 −5%；每 1 分心跳 +2%
      var bonus = (match === "match" ? 0.1 : match === "mid" ? 0.03 : -0.05) + pts * 0.02;
      if (perfect) out.push(sit.hit);
      return out.concat(confess(s, hid, bonus, perfect && match === "match"));
    }
    out.push(fmt(pick(s, D.DOKI_REACT[match]), { n: name(hid) }));
    if (perfect && match !== "miss") out.push(sit.hit);
    var gain = (match === "match" ? 6 : match === "mid" ? 3 : -1) + pts * 0.8 + (perfect ? 2 : 0);
    addAff(s, hid, gain, out);
    if (perfect && match === "match") {
      applyEff(s, { charm: 1 }, out);
      memory(s, "doki_" + hid + "_" + dk.sit, name(hid) + "・" + sit.title, fmt(sit.text, { n: name(hid) }) + "\n" + sit.hit, hid);
    }
    s.h[hid].lastSeen = s.day;
    return out;
  }
  // 按下「告白」：條件都符合才進入心跳告白（行動點在 confess() 才扣）
  function confessStart(s, hid) {
    if (!canConfess(s, hid)) return null;
    var lack = confessReq(s, hid);
    if (lack.length) return ["還差一點……（" + lack.join("、") + "）"];
    if (!s.today.ap) return ["沒有行動點了。"];
    if (!D.DOKI_CONFESS || s.doki) return confess(s, hid);
    s.doki = { hid: hid, sit: "confess", ctx: "confess", step: "choose", tone: null };
    return null;
  }

  // ---------------- 手機（LINE 風格） ----------------
  // s.chat[hid] = { log: [{ f: "h"她／"m"你／"s"系統, t, p: 附照片, d: 天 }], unread, last, pend: { kind, opts, round, max, ev } }
  var CHAT_LOG_MAX = 40;
  function thread(s, hid) {
    var c = s.chat[hid];
    if (!c) c = s.chat[hid] = { log: [], unread: 0, last: 0, pend: null };
    return c;
  }
  function chatPush(s, hid, f, t, photo) {
    var c = thread(s, hid);
    c.log.push({ f: f, t: t, p: photo ? 1 : 0, d: s.day });
    if (c.log.length > CHAT_LOG_MAX) c.log.splice(0, c.log.length - CHAT_LOG_MAX);
    c.last = ++s.chatSeq;
    if (f === "h") c.unread++;
  }
  function chatKind(id) { return (D.CHAT_KINDS || []).filter(function (k) { return k.id === id; })[0]; }
  function chatFill(s, hid, str) {
    var hd = D.HEROINE_BY_ID[hid];
    var tp = D.TOPIC_BY_ID[hd.topics.like[Math.floor(rand(s) * hd.topics.like.length)]] || D.TOPICS[0];
    var lc = D.LOC_BY_ID[hd.spots[Math.floor(rand(s) * hd.spots.length)]] || D.LOCATIONS[0];
    return str.replace(/\{t\}/g, D.L(tp.name)).replace(/\{l\}/g, D.L(lc.name));
  }
  // 她傳來一則訊息（有回覆選項）
  function chatAsk(s, hid, kindId, round, max, ev) {
    var k = chatKind(kindId);
    if (!k) return false;
    var her = chatFill(s, hid, pick(s, k.her));
    chatPush(s, hid, "h", her, k.photo);
    var opts = {};
    Object.keys(k.opts).forEach(function (tone) { opts[tone] = chatFill(s, hid, k.opts[tone]); });
    thread(s, hid).pend = { kind: kindId, opts: opts, round: round || 1, max: max || 1, ev: !!ev };
    return true;
  }
  function chatOk(s, hid, k) {
    var h = s.h[hid], nd = k.need || {};
    if (k.ev) return false;
    if (nd.minAff && h.aff < nd.minAff) return false;
    if (nd.lover && !h.dating) return false;
    if (nd.flirt && !(s.today && s.today.flirt > 0)) return false;
    return true;
  }
  // 早上：0〜2 位（女友多的話更多）主動傳訊息來
  function genChats(s) {
    if (!D.CHAT_KINDS) return;
    var cand = metList(s, function (h, hd) { return h.aff >= 25 && available(s, hd.id) && !(s.chat[hd.id] && s.chat[hd.id].pend); });
    if (!cand.length) return;
    var n = (rand(s) < 0.6 ? 1 : 0) + (rand(s) < 0.25 ? 1 : 0) + (loversOf(s).length && rand(s) < 0.4 ? 1 : 0);
    for (var i = 0; i < n && cand.length; i++) {
      // 女友、好感高的人比較常傳
      var w = cand.map(function (x) { var h = s.h[x]; return (h.dating ? 3 : 1) * (0.5 + h.aff / 100); });
      var tot = w.reduce(function (a, b) { return a + b; }, 0), r = rand(s) * tot, j = 0;
      for (; j < cand.length - 1; j++) { r -= w[j]; if (r < 0) break; }
      var hid = cand.splice(j, 1)[0];
      var kinds = D.CHAT_KINDS.filter(function (k) { return chatOk(s, hid, k); });
      var kw = kinds.map(function (k) { return k.w || 1; }), kt = kw.reduce(function (a, b) { return a + b; }, 0), kr = rand(s) * kt, q = 0;
      for (; q < kinds.length - 1; q++) { kr -= kw[q]; if (kr < 0) break; }
      chatAsk(s, hid, kinds[q].id, 1, 1, false);
    }
  }
  // 回覆：tone＝romantic／funny／earnest，"ignore"＝已讀不回
  function chatReply(s, hid, tone) {
    var c = s.chat[hid], p = c && c.pend;
    if (!p || !s.h[hid]) return null;
    var hd = D.HEROINE_BY_ID[hid], h = s.h[hid], k = chatKind(p.kind), out = [];
    c.pend = null; c.unread = 0;
    if (tone === "ignore") {
      chatPush(s, hid, "s", "（已讀不回）");
      if (h.dating || h.aff >= 50) { addAff(s, hid, h.dating ? -3 : -1, out); }
      out.forEach(function (x) { chatPush(s, hid, "s", x); });
      return out;
    }
    chatPush(s, hid, "m", p.opts[tone]);
    s.chatReplies++;
    var mood = moodOf(s, hid);
    var pts = 1 + (tone === hd.moment ? 3 : 0) + (tone === mood.pref ? 2 : 0) + ((k.bonus || {})[tone] || 0);
    var affirm = rollAffirm(s, hid);
    if (affirm) {
      pts = Math.max(pts, 5);
      chatPush(s, hid, "h", affirmLine(s, hid));
      chatPush(s, hid, "s", "（被全肯定了。心情變好了）");
      applyEff(s, { stamina: 2 }, out);
    } else {
      chatPush(s, hid, "h", pts >= 5 ? lineOf(s, hd.lines.like) : pts >= 3 ? lineOf(s, hd.lines.mid) : lineOf(s, D.CHAT_MEH));
    }
    if (h.dating && pts >= 4 && rand(s) < 0.4) chatPush(s, hid, "h", lineOf(s, hd.lines.lover));
    addAff(s, hid, Math.round(pts * (p.ev ? 0.8 : 0.7)), out);
    h.lastSeen = Math.max(h.lastSeen, s.day - 1);
    out.forEach(function (x) { chatPush(s, hid, "s", x); });
    // 晚上的聊天：繼續下一回合
    if (p.ev && p.round < p.max) {
      var next = D.CHAT_KINDS.filter(function (x) { return !x.ev && x.id !== "jealous" && x.id !== "night" && chatOk(s, hid, x); });
      chatAsk(s, hid, p.round + 1 === p.max && isClose(s, hid) ? "night" : pick(s, next).id, p.round + 1, p.max, true);
    } else if (p.ev) {
      s.nightTalks++;
      chatPush(s, hid, "h", "「……啊，已經這麼晚了。今天聊得好開心。晚安！」");
    }
    c.unread = 0;
    return out;
  }
  function chatRead(s, hid) { if (s.chat[hid]) s.chat[hid].unread = 0; }
  function chatUnread(s) { return Object.keys(s.chat || {}).reduce(function (a, k) { var c = s.chat[k]; return a + (c.pend ? 1 : 0); }, 0); }
  // 一天結束：沒回的訊息算已讀不回
  function chatExpire(s, out) {
    Object.keys(s.chat || {}).forEach(function (hid) {
      var c = s.chat[hid], h = s.h[hid];
      if (!c.pend || !h) return;
      var ev = c.pend.ev;
      c.pend = null;
      chatPush(s, hid, "s", "（沒有回覆）");
      if (!ev && (h.dating || h.aff >= 50)) {
        var n = h.dating ? -3 : -1;
        if (out) out.push("📱 " + name(hid) + "的訊息你一直沒回……");
        addAff(s, hid, n, out);
      }
    });
  }

  // ---------------- 存讀檔 ----------------
  function save(s) {
    try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  }
  function load() {
    try {
      var s = JSON.parse(window.localStorage.getItem(SAVE_KEY) || "null");
      if (!s || s.v !== VERSION || !s.h || !s.stats) return null;
      registerDyn(s);
      ensureFields(s);
      if (s.today) {
        var td = s.today;
        if (!td.combo) td.combo = {};
        if (td.enc === undefined) td.enc = 0;
        if (td.weather === undefined) td.weather = weather(s);
        if (td.examWeek === undefined) td.examWeek = examWeek(s);
        // 舊版的約會進行中（單題）：直接重新開始
        if (td.dateRun && !td.dateRun.list) td.dateRun = null;
      }
      return s;
    } catch (e) { return null; }
  }
  function clearSave() { try { window.localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }

  // 追加事件（wanren_data4.js）用的工具：沿用這裡的規則，不在資料檔重複定義
  var XA = {
    addAff: addAff, applyEff: applyEff, addSkill: addSkill, name: name, pick: pick, rand: rand, ri: ri,
    metList: metList, loversOf: loversOf, available: available, whereIs: whereIs, memory: memory
  };

  window.PriTestWanrenCore = {
    SAVE_KEY: SAVE_KEY, LENGTHS: LENGTHS, STATS: STATS, STAT_BY_ID: STAT_BY_ID, STAGES: STAGES,
    newGame: newGame, save: save, load: load, clearSave: clearSave,
    loadMeta: loadMeta, saveMeta: saveMeta, checkAchievements: checkAchievements, available: available,
    season: season, weather: weather, WEATHER_INFO: WEATHER_INFO, examWeek: examWeek, curSlot: curSlot,
    addSkill: addSkill, bestSkill: bestSkill, joinClub: joinClub, isClubDay: isClubDay, canClubAction: canClubAction, clubAction: clubAction,
    arrive: arrive, encounter: encounter, dateMoment: dateMoment, answerDate: answerDate, skillAnswer: skillAnswer, moodOf: moodOf,
    dateLabel: dateLabel, termName: termName, weekday: weekday, isWeekend: isWeekend, dayKind: dayKind, special: special, specialEvening: specialEvening,
    cal: cal, buildCal: buildCal, lengthOf: lengthOf, questLock: questLock, nextYear: nextYear, YEAR_NAMES: YEAR_NAMES,
    stageOf: stageOf, stageName: stageName, affCap: affCap, loversOf: loversOf,
    whereIs: whereIs, heroinesAt: heroinesAt,
    approachOf: approachOf, answerAdmirer: answerAdmirer, finishMorning: finishMorning,
    doClass: doClass, doExam: doExam,
    locAction: locAction, talkTopics: talkTopics, topicPref: topicPref, giftPref: giftPref,
    talk: talk, meet: meet, gift: gift, buy: buy, canInvite: canInvite, inviteMin: inviteMin, invite: invite,
    questOf: questOf, reqText: reqText, reqMet: reqMet, locQuests: locQuests, doQuest: doQuest,
    canConfess: canConfess, confessReq: confessReq, confess: confess,
    pairsAt: pairsAt, pairTalk: pairTalk, endFree: endFree,
    dateSpots: dateSpots, startDate: startDate, finishDate: answerDate, cancelDate: cancelDate, doEvening: doEvening, festDance: festDance,
    endDay: endDay, eventView: eventView, resolveEvent: resolveEvent,
    report: report, fmt: fmt,
    // 2026-11-05 擴充
    PHOTO_POOL: PHOTO_POOL, photoOf: photoOf, photoOfAdmirer: photoOfAdmirer, circleOf: circleOf,
    buyOutfit: buyOutfit, buyFurniture: buyFurniture, comfort: comfort, outfitFits: outfitFits,
    chatReply: chatReply, chatRead: chatRead, chatUnread: chatUnread, isClose: isClose,
    // 2026-11-06 心跳時刻、濃縮行事曆
    dokiStart: dokiStart, dokiChoose: dokiChoose, dokiFinish: dokiFinish, dokiSit: dokiSit, dokiPref: dokiPref, dokiBpm: dokiBpm, confessStart: confessStart, span: span
  };
})();
