// 明星經紀 starV：核心引擎（純邏輯，不碰 DOM；node 也能跑，見 tools/starv_check/core_check.js）。
// 整局狀態是一個可 JSON 化的物件 st，亂數狀態存在 st.seed（mulberry32），所以存檔、模擬、離線結算都可以重現。
// 時間：現實 1 分鐘＝遊戲 1 天；advance(st, days) 逐日結算（規格 §2）。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var Roster = root.PriTestStarvRoster;
  var BAL = D.BAL;
  var VERSION = 2;
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
      company: { name: opts.name || "", level: 1, rep: 0, money: BAL.startMoney, tickets: BAL.startTickets, debtMonths: 0, safeLine: BAL.startSafeLine, crisisOn: false },
      facilities: { dorm: 1, practice: 0, studio: 0, photo: 0, lounge: 0, pr: 0, scout: 0 },
      artists: [], waitlist: [], board: [], boardRefreshDay: 0, activeJobs: [], dividends: [], groups: [],
      gacha: { pity: 0, pullDay: -1, pullCount: 0, pickup: { SR: null, SSR: null }, debutShown: {} },
      codex: { owned: {}, recruitedR: 0 },
      stats: { pulls: 0, jobsDone: 0 },
      trend: null, events: { pending: [] }, loans: [],
      log: [], logSeq: 0, nextId: 1
    };
  }

  function create(opts) {
    var st = blankState(opts);
    // 初始化鉤子（之後的 task 在這裡加上抽卡 PICKUP、工作看板）
    rotatePickup(st);
    initTrend(st);
    refreshBoard(st);
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
    // 月薪隨人氣上升（計畫 3 補）：舊存檔沒有基本月薪，以目前月薪當基本月薪
    st.artists.concat(st.waitlist.map(function (w) { return w.artist; })).forEach(function (a) { if (a.baseSalary == null) a.baseSalary = a.salary; });
    st.waitlist.forEach(function (w) { fillDefaults(w.artist, ARTIST_DEFAULTS); });
    if (!st.trend) initTrend(st);   // version 1 → 2：補上業界趨勢
    // 事件資料被移除或改名時，存檔裡待處理的舊事件直接丟掉（不讓存檔壞掉）
    st.events.pending = st.events.pending.filter(function (e) { return !!(D.EVENT_BY_ID && D.EVENT_BY_ID[e.id]); });
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
    stamina: 100, stress: 0, mood: 0, fame: 0, satisfaction: 70, salary: 1500, baseSalary: null,
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
    a.baseSalary = a.salary;
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
    a.baseSalary = a.salary;
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

  // 月薪 ＝ 基本月薪 × (1 + √人氣 ÷ salaryFameDiv)，取整到百（規格 §5.2「會隨人氣上升」）
  function updateSalary(a) {
    if (a.baseSalary == null) a.baseSalary = a.salary;
    a.salary = Math.round(a.baseSalary * (1 + Math.sqrt(Math.max(0, a.fame)) / BAL.salaryFameDiv) / 100) * 100;
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

  // ==== 抽卡（§5.1） ====
  function pullCost(st, pool, count) {
    if (pool === "ticket") return count;
    var unit = Math.round(BAL.pullBaseCost * (1 + st.company.level * BAL.pullLevelMult));
    return unit * (count === 10 ? 9 : count);
  }
  function rates(st, pool) {
    var r = BAL.poolRates[pool], sr = r.SR, ssr = r.SSR;
    if (pool === "money") { sr += st.facilities.scout * BAL.scoutBonus.SR; ssr += st.facilities.scout * BAL.scoutBonus.SSR; }
    return { SR: sr, SSR: ssr };
  }
  function pityMax() { return BAL.pityMax; }   // 新紀元的傳承加成在計畫 5 擴充
  function rollRarity(st, pool) {
    var r = rates(st, pool), x = rnd(st), out;
    if (st.gacha.pity + 1 >= pityMax(st)) out = "SSR";
    else out = x < r.SSR ? "SSR" : x < r.SSR + r.SR ? "SR" : "R";
    st.gacha.pity = out === "SSR" ? 0 : st.gacha.pity + 1;
    return out;
  }

  function findByRoster(st, rosterId) {
    var i;
    for (i = 0; i < st.artists.length; i++) if (st.artists[i].rosterId === rosterId) return st.artists[i];
    for (i = 0; i < st.waitlist.length; i++) if (st.waitlist[i].artist.rosterId === rosterId) return st.waitlist[i].artist;
    return null;
  }

  // 入社：宿舍有空位就進來，否則進候補（保留 30 天），候補也滿了就流失
  function place(st, a, res) {
    res.artistId = a.id;
    if (st.artists.length < capacity(st)) {
      st.artists.push(a);
      log(st, "join", { aid: a.id, rarity: a.rarity });
      if (a.rarity === "SSR") pushEvent(st, "ssr_debut", a.id);
    }
    else if (st.waitlist.length < BAL.waitlistMax) {
      st.waitlist.push({ artist: a, until: st.day + BAL.waitlistDays });
      res.waitlisted = true; log(st, "waitlist", { rarity: a.rarity, rosterId: a.rosterId, nameSeed: a.nameSeed, gender: a.gender });
    } else { res.lost = true; log(st, "lost", { rarity: a.rarity, rosterId: a.rosterId }); }
    return res;
  }

  function grantEntry(st, e) {
    var owned = findByRoster(st, e.id);
    if (owned) {
      if (owned.limitBreak < BAL.limitBreakMax) {
        owned.limitBreak++; recomputeCaps(owned);
        log(st, "dup_lb", { aid: owned.id, lb: owned.limitBreak });
        return { rarity: e.rarity, rosterId: e.id, artistId: owned.id, dup: "limitBreak" };
      }
      var n = BAL.dupTickets[e.rarity];
      st.company.tickets += n;
      log(st, "dup_ticket", { aid: owned.id, tickets: n });
      return { rarity: e.rarity, rosterId: e.id, artistId: owned.id, dup: "tickets", tickets: n };
    }
    var res = place(st, fromRoster(st, e), { rarity: e.rarity, rosterId: e.id });
    if (!res.lost) st.codex.owned[e.id] = true;   // 流失的不算取得（圖鑑不解鎖）
    return res;
  }

  function pickRoster(st, rarity) {
    var list = Roster.byRarity(rarity);
    if (!list.length) return null;
    var pu = st.gacha.pickup[rarity];
    if (pu && Roster.byId(pu) && rnd(st) < BAL.pickupChance) return Roster.byId(pu);
    return pick(st, list);
  }

  function grant(st, rarity) {
    var e = rarity === "R" ? null : pickRoster(st, rarity);
    if (!e) { st.codex.recruitedR++; return place(st, genR(st), { rarity: "R" }); }
    return grantEntry(st, e);
  }

  function pull(st, pool, count) {
    if (count !== 1 && count !== 10) return { err: "count" };
    var cost = pullCost(st, pool, count);
    if (pool === "money") {
      if (st.company.money < cost) return { err: "money" };
      if (st.gacha.pullDay !== st.day) { st.gacha.pullDay = st.day; st.gacha.pullCount = 0; }
      if (st.gacha.pullCount + count > BAL.dailyPullLimit) return { err: "daily" };
      st.company.money -= cost;
      st.gacha.pullCount += count;
    } else if (pool === "ticket") {
      if (st.company.tickets < cost) return { err: "tickets" };
      st.company.tickets -= cost;
    } else return { err: "pool" };
    var rarities = [], i;
    for (i = 0; i < count; i++) rarities.push(rollRarity(st, pool));
    if (count === 10 && rarities.every(function (r) { return r === "R"; })) rarities[9] = "SR";
    st.stats.pulls += count;
    return { results: rarities.map(function (r) { return grant(st, r); }) };
  }

  // PICKUP：每月輪換；debut 角色優先，各自只優先一次
  function rotatePickup(st) {
    ["SR", "SSR"].forEach(function (r) {
      var list = Roster.byRarity(r);
      if (!list.length) { st.gacha.pickup[r] = null; return; }
      var fresh = list.filter(function (e) { return e.debut && !st.gacha.debutShown[e.id]; });
      var e = fresh.length ? fresh[0] : pick(st, list);
      st.gacha.debutShown[e.id] = true;
      st.gacha.pickup[r] = e.id;
    });
  }

  function acceptWaitlist(st, idx) {
    var w = st.waitlist[idx];
    if (!w) return "noEntry";
    if (st.artists.length >= capacity(st)) return "full";
    st.waitlist.splice(idx, 1);
    st.artists.push(w.artist);
    log(st, "join", { aid: w.artist.id, rarity: w.artist.rarity });
    return null;
  }

  // 從公司移除（解約、被挖角、賣合約共用）：組合剩一人就解散；在進行中工作裡就退出，工作沒人了就取消
  function removeArtist(st, a) {
    st.artists.splice(st.artists.indexOf(a), 1);
    st.groups.forEach(function (g) { g.members = g.members.filter(function (id) { return id !== a.id; }); });
    st.groups = st.groups.filter(function (g) { return g.members.length >= 2; });
    st.activeJobs.forEach(function (aj) { aj.members = aj.members.filter(function (id) { return id !== a.id; }); });
    st.activeJobs = st.activeJobs.filter(function (aj) { return aj.members.length > 0; });
  }
  function leftInfo(a) { return { rarity: a.rarity, rosterId: a.rosterId, nameSeed: a.nameSeed, gender: a.gender }; }

  function dismiss(st, aid) {
    var a = artistById(st, aid);
    if (!a) return "noArtist";
    if (a.task) return "busy";
    st.company.money -= a.salary * BAL.dismissSalaryMonths;
    removeArtist(st, a);
    log(st, "dismiss", leftInfo(a));
    return null;
  }  // ==== 行程與成長（§6.1） ====
  function courseAllowed(st, c) {
    if (!c.need) return true;
    if (c.need.facility) return (st.facilities[c.need.facility] || 0) >= c.need.lv;
    if (c.need.company) return st.company.level >= c.need.company;
    return true;
  }

  function schedule(st, aid, spec) {
    var a = artistById(st, aid);
    if (!a) return "noArtist";
    if (a.task) return "busy";
    var t;
    if (spec.kind === "course") {
      var c = D.COURSE_BY_ID[spec.courseId];
      if (!c) return "noCourse";
      if (!courseAllowed(st, c)) return "facility";
      if (st.company.money < c.cost) return "money";
      st.company.money -= c.cost;
      t = { kind: "course", courseId: c.id, days: c.days, left: c.days, stamina: c.stamina, stress: c.stress };
    } else if (spec.kind === "train") {
      t = { kind: "train", days: D.TRAIN.days, left: D.TRAIN.days, stamina: D.TRAIN.stamina, stress: D.TRAIN.stress };
    } else if (spec.kind === "rest") {
      var n = clamp(spec.days | 0, 1, 5);
      t = { kind: "rest", days: n, left: n, stamina: 0, stress: 0 };
    } else if (spec.kind === "promo") {
      if (st.company.money < D.PROMO.cost) return "money";
      st.company.money -= D.PROMO.cost;
      t = { kind: "promo", days: D.PROMO.days, left: D.PROMO.days, stamina: D.PROMO.stamina, stress: D.PROMO.stress };
    } else return "kind";
    a.task = t;
    return null;
  }

  function restMult(st) { return 1 + st.facilities.lounge * D.FACILITIES.lounge.rest; }
  function stressMult(st, a) { return fxMult(a, "stress") * (1 - st.facilities.lounge * D.FACILITIES.lounge.stress); }

  // 設施對成長的加成：練習室加訓練；錄音室／攝影棚加對應能力的課程
  function facilityGrowth(st, stat, src) {
    if (src === "train") return 1 + st.facilities.practice * D.FACILITIES.practice.trainGrowth;
    var m = 1;
    ["studio", "photo"].forEach(function (f) {
      if (D.FACILITIES[f].stats.indexOf(stat) >= 0) m *= 1 + st.facilities[f] * D.FACILITIES[f].v;
    });
    return m;
  }

  // 成長量 ＝ 基礎值 × 適性 × 心情 × 特質 × 巔峰 × 設施 × sqrt(剩餘比例)；保留一位小數
  function growStat(st, a, stat, base, src) {
    var cap = a.caps[stat], cur = a.stats[stat];
    if (cur >= cap) return 0;
    var m = D.APT[a.apt[stat]].mult * (1 + a.mood * BAL.moodPerf) * fxMult(a, "growth") *
      fxMult(a, src === "course" ? "growthCourse" : "growthTrain") *
      (inPeak(a) ? 1 : BAL.offPeakGrowth) * facilityGrowth(st, stat, src);
    var g = base * m * Math.sqrt((cap - cur) / cap);
    var next = Math.min(cap, Math.round((cur + g) * 10) / 10);
    a.stats[stat] = next;
    return next - cur;
  }

  function finishTask(st, a, t) {
    if (t.kind === "course") {
      var c = D.COURSE_BY_ID[t.courseId];
      var g = growStat(st, a, c.stat, c.gain, "course");
      addProf(a, a.dir, 1);
      log(st, "course_done", { aid: a.id, courseId: c.id, gain: Math.round(g * 10) / 10 });
    } else if (t.kind === "train") {
      var w = dirById(a.dir).weights;
      Object.keys(w).forEach(function (s) { growStat(st, a, s, D.TRAIN.gain * w[s] * 2, "train"); });
      addProf(a, a.dir, 1);
      log(st, "train_done", { aid: a.id });
    } else if (t.kind === "rest") {
      if (t.days >= 2) a.mood = clamp(a.mood + 1, -2, 2);
    } else if (t.kind === "promo") {
      var df = Math.round((D.PROMO.fame + a.stats.charm / 20) * fxMult(a, "fame"));
      a.fame = clamp(a.fame + df, 0, 99999);
      log(st, "promo_done", { aid: a.id, fame: df });
    }
  }

  // 行程結束後：體力歸零強制休息 3 天；壓力 100 罷工 7 天（壓力降到 60）
  function postTask(st, a) {
    if (a.task) return;
    if (a.stress >= 100) {
      a.stress = BAL.strikeStressAfter;
      a.task = { kind: "rest", days: BAL.strikeDays, left: BAL.strikeDays, stamina: 0, stress: 0, forced: true };
      log(st, "strike", { aid: a.id });
      pushEvent(st, "strike_talk", a.id);
    } else if (a.stamina <= 0) {
      a.task = { kind: "rest", days: BAL.forcedRestDays, left: BAL.forcedRestDays, stamina: 0, stress: 0, forced: true };
      log(st, "forced_rest", { aid: a.id });
    }
  }

  function tickArtists(st) {
    st.artists.forEach(function (a) {
      var t = a.task;
      if (!t) return;
      if (t.kind === "rest") {
        a.stamina = clamp(a.stamina + D.REST.stamina * restMult(st), 0, 100);
        a.stress = clamp(a.stress - D.REST.stress, 0, 100);
      } else {
        a.stamina = clamp(a.stamina - t.stamina / t.days * fxMult(a, "stamina"), 0, 100);
        a.stress = clamp(a.stress + t.stress / t.days * stressMult(st, a), 0, 100);
      }
      t.left--;
      // 工作由 activeJobs 統一結算（Task 7），這裡只處理體力與壓力
      if (t.kind !== "job" && t.left <= 0) { a.task = null; finishTask(st, a, t); postTask(st, a); }
    });
  }

  function advanceDay(st) {
    st.day++;
    tickArtists(st);
    tickJobs(st);
    seasonTick(st);
    tickBoard(st);
    tickWaitlist(st);
    if (st.day % BAL.daysPerMonth === 0) monthly(st);
    if (st.day % BAL.daysPerYear === 0) yearly(st);
    tickEvents(st);
    autoPlan(st);
  }

  function advance(st, days) {
    for (var i = 0; i < days; i++) advanceDay(st);
  }

  // ==== 工作看板（§6.2） ====
  function boardSize(st) { return BAL.boardBase + st.company.level * BAL.boardPerLevel; }

  // over（可省略）：{ dir, tier, reservedFor }。reservedFor＝指名工作：只有該藝人能接，主角、不看人氣與熟練度門檻
  function genJob(st, over) {
    over = over || {};
    var tier = over.tier;
    if (!tier) {
      var weights = {}, hasS = st.board.some(function (j) { return j.tier === "S"; });
      D.TIER_ORDER.forEach(function (t) {
        if (D.TIERS[t].unlock > st.company.level) return;
        if (t === "S" && hasS) return;
        weights[t] = D.TIERS[t].w;
      });
      tier = wpick(st, weights);
    }
    var T = D.TIERS[tier];
    var d = over.dir ? dirById(over.dir) : null;
    if (!d) {
      var dw = {};
      D.DIRS.forEach(function (x) {
        var m = trendMult(st, x.id);
        dw[x.id] = m > 1 ? BAL.trendBoardHot : m < 1 ? BAL.trendBoardCold : 1;
      });
      d = dirById(wpick(st, dw));
    }
    var group = !over.reservedFor && d.group && rnd(st) < BAL.groupJobChance;
    var role = over.reservedFor ? "lead" : group ? "group" : wpick(st, { lead: 25, support: 45, cameo: 30 });
    var R = D.ROLES[role];
    var days = rint(st, T.days[0], T.days[1]);
    var slots = group ? rint(st, 2, 5) : 1;
    var mid = (T.days[0] + T.days[1]) / 2;
    var trend = trendMult(st, d.id);
    var pay = T.pay * R.pay * (days / mid) * (0.8 + rnd(st) * 0.4) * (group ? slots * 0.7 : 1) * trend;
    var job = {
      id: newId(st, "j"), dir: d.id, tier: tier, role: role, days: days, slots: slots,
      pay: Math.max(100, Math.round(pay / 100) * 100), fame: Math.round(T.fame * R.fame), rep: T.rep,
      minFame: T.minFame, minProf: T.minProf, isWork: tier !== "D", trend: trend,
      title: [rint(st, 0, d.title.a.length - 1), rint(st, 0, d.title.b.length - 1)],
      expires: st.day + BAL.jobLifeDays
    };
    if (over.reservedFor) { job.reservedFor = over.reservedFor; job.minFame = 0; job.minProf = 1; }
    return job;
  }  function refreshBoard(st) {
    st.board = st.board.filter(function (j) { return j.expires > st.day; });
    while (st.board.length < boardSize(st)) st.board.push(genJob(st));
    st.boardRefreshDay = st.day + BAL.boardRefreshDays;
  }

  function tickBoard(st) {
    st.board = st.board.filter(function (j) { return j.expires > st.day; });
    if (st.day >= st.boardRefreshDay) refreshBoard(st);
  }

  function jobTitle(job, lang) {
    lang = lang === "zh" ? "zh" : "ja";
    var t = dirById(job.dir).title;
    return t.fmt[lang].replace("{a}", t.a[job.title[0]][lang]).replace("{b}", t.b[job.title[1]][lang]);
  }

  // ==== 工作判定（§6.3）、組合（§6.4） ====
  function facilityPerf(st, dir) {
    var m = 1;
    ["studio", "photo"].forEach(function (f) {
      if (D.FACILITIES[f].dirs.indexOf(dir) >= 0) m *= 1 + st.facilities[f] * D.FACILITIES[f].v;
    });
    return m;
  }

  // 表現分（不含隨機與事件修正）
  function perfScore(st, a, job) {
    var w = dirById(job.dir).weights, s = 0;
    Object.keys(w).forEach(function (k) { s += a.stats[k] * w[k]; });
    s *= 1 + a.prof[job.dir].lv * BAL.profPerf;
    if (a.stamina < BAL.lowStamina) s *= BAL.lowStaminaMult;
    s *= 1 + a.mood * BAL.moodPerf;
    return s * fxMult(a, "perf") * fxDirMult(a, job.dir) * facilityPerf(st, job.dir);
  }
  function difficulty(job) { return D.TIERS[job.tier].diff * D.ROLES[job.role].diff; }

  function sameMembers(x, y) {
    if (x.length !== y.length) return false;
    for (var i = 0; i < x.length; i++) if (y.indexOf(x[i]) < 0) return false;
    return true;
  }
  function groupOf(st, aids) {
    for (var i = 0; i < st.groups.length; i++) if (sameMembers(st.groups[i].members, aids)) return st.groups[i];
    return null;
  }
  function chemistry(st, aids) {
    var g = aids.length >= 2 ? groupOf(st, aids) : null;
    return g ? Math.min(BAL.chemistryMax, g.jobs * BAL.chemistryPerJob) : 0;
  }

  function teamPerf(st, members, job) {
    var sum = 0;
    members.forEach(function (a) { sum += perfScore(st, a, job); });
    return sum / members.length * (1 + chemistry(st, members.map(function (a) { return a.id; })));
  }

  function estimate(st, aids, job) {
    var members = aids.map(function (id) { return artistById(st, id); }).filter(Boolean);
    if (!members.length) return { ratio: 0, label: "low" };
    var ratio = teamPerf(st, members, job) / difficulty(job);
    return { ratio: ratio, label: ratio >= 1.0 ? "high" : ratio >= 0.7 ? "mid" : "low" };
  }

  function eligible(st, a, job) {
    if (!a) return "noArtist";
    if (a.task) return "busy";
    if (job.reservedFor && job.reservedFor !== a.id) return "reserved";
    if (a.fame < job.minFame) return "fame";
    if (a.prof[job.dir].lv < job.minProf) return "prof";
    return null;
  }

  function takeJob(st, jobId, aids) {
    var job = null, i;
    for (i = 0; i < st.board.length; i++) if (st.board[i].id === jobId) job = st.board[i];
    if (!job) return "noJob";
    if (!aids || aids.length !== job.slots) return "slots";
    for (i = 0; i < aids.length; i++) if (aids.indexOf(aids[i]) !== i) return "slots";
    for (i = 0; i < aids.length; i++) {
      var err = eligible(st, artistById(st, aids[i]), job);
      if (err) return err;
    }
    st.board.splice(st.board.indexOf(job), 1);
    var aj = { id: newId(st, "w"), job: job, members: aids.slice(), left: job.days, eventMod: 0 };
    st.activeJobs.push(aj);
    var load = D.TIERS[job.tier].load;
    aids.forEach(function (id) {
      artistById(st, id).task = {
        kind: "job", ref: aj.id, days: job.days, left: job.days,
        stamina: Math.min(BAL.jobStaminaMax, job.days * BAL.jobStaminaPerDay * load),
        stress: Math.min(BAL.jobStressMax, job.days * BAL.jobStressPerDay * load)
      };
    });
    return null;
  }

  function minorEvent(st, a, aj) {
    if (rnd(st) >= BAL.minorEventRate * fxMult(a, "eventRate")) return;
    var w = {};
    D.MINOR_EVENTS.forEach(function (e) { w[e.id] = e.w * (e.bad && a.stress > 70 ? 2 : 1); });
    var id = wpick(st, w), e = null;
    D.MINOR_EVENTS.forEach(function (x) { if (x.id === id) e = x; });
    var f = e.fx;
    if (f.eventMod) aj.eventMod += f.eventMod;
    if (f.stamina) a.stamina = clamp(a.stamina + f.stamina, 0, 100);
    if (f.stress) a.stress = clamp(a.stress + f.stress, 0, 100);
    if (f.mood) a.mood = clamp(a.mood + f.mood, -2, 2);
    if (f.fame) a.fame = clamp(a.fame + f.fame, 0, 99999);
    log(st, "minor", { aid: a.id, ev: e.id, jobId: aj.job.id });
  }

  function addRep(st, n) {
    st.company.rep += n;
    while (st.company.level < 10 && st.company.rep >= BAL.levelRep[st.company.level - 1]) {
      st.company.level++;
      st.company.tickets += st.company.level * BAL.levelTickets;
      log(st, "level_up", { lv: st.company.level });
    }
  }

  function resolveJob(st, aj) {
    var job = aj.job;
    var members = aj.members.map(function (id) { return artistById(st, id); }).filter(Boolean);
    if (!members.length) return;
    var perf = teamPerf(st, members, job) * (1 + aj.eventMod);
    var ratio = perf / difficulty(job) * (BAL.randLo + rnd(st) * (BAL.randHi - BAL.randLo));
    var shift = 0;
    members.forEach(function (a) { shift = Math.max(shift, fxGreatShift(a, job.dir)); });
    var res = ratio >= D.RESULTS.great.min - shift ? "great" : ratio >= D.RESULTS.success.min ? "success" :
      ratio >= D.RESULTS.normal.min ? "normal" : "fail";
    var R = D.RESULTS[res];
    var payMult = 0;
    members.forEach(function (a) { payMult += fxMult(a, "pay"); });
    var pay = Math.round(job.pay * R.pay * payMult / members.length);
    st.company.money += pay;
    var stars = rint(st, R.stars[0], R.stars[1]);
    var tierIdx = D.TIER_ORDER.indexOf(job.tier);
    members.forEach(function (a) {
      var fame0 = a.fame;
      a.fame = clamp(a.fame + Math.round(job.fame * R.fame * fxMult(a, "fame") * (job.trend || 1)), 0, 99999);
      BAL.fameMilestones.forEach(function (n) { if (fame0 < n && a.fame >= n) pushEvent(st, "fame_milestone", a.id, { n: n }); });
      addProf(a, job.dir, R.xp * (tierIdx + 1));
      a.satisfaction = clamp(a.satisfaction + R.sat, 0, 100);
      a.works.unshift({ title: job.title.slice(), dir: job.dir, tier: job.tier, role: job.role, result: res, stars: stars, day: st.day, isWork: job.isWork, pay: pay });
      if (a.works.length > BAL.worksMax) a.works.length = BAL.worksMax;
      a.task = null;
      postTask(st, a);
    });
    var g = members.length >= 2 ? groupOf(st, aj.members) : null;
    if (g) { g.jobs++; g.fame = Math.max(0, g.fame + Math.round(job.fame * R.fame)); }
    if (job.isWork) st.dividends.push({ pay: job.pay, stars: stars, months: BAL.dividendMonths });
    addRep(st, Math.round(job.rep * R.rep));
    st.stats.jobsDone++;
    log(st, "job_done", { aids: aj.members.slice(), dir: job.dir, tier: job.tier, title: job.title.slice(), result: res, pay: pay, stars: stars });
  }

  function tickJobs(st) {
    var done = [];
    st.activeJobs.forEach(function (aj) {
      aj.members.forEach(function (id) { var a = artistById(st, id); if (a) minorEvent(st, a, aj); });
      aj.left--;
      if (aj.left <= 0) done.push(aj);
    });
    done.forEach(function (aj) {
      st.activeJobs.splice(st.activeJobs.indexOf(aj), 1);
      resolveJob(st, aj);
    });
  }

  function createGroup(st, name, aids) {
    if (!aids || aids.length < 2 || aids.length > 5) return { err: "size" };
    for (var i = 0; i < aids.length; i++) {
      if (!artistById(st, aids[i])) return { err: "noArtist" };
      if (st.groups.some(function (g) { return g.members.indexOf(aids[i]) >= 0; })) return { err: "taken" };
    }
    var g = { id: newId(st, "g"), name: String(name || "").slice(0, 20), members: aids.slice(), jobs: 0, fame: 0, formedDay: st.day };
    st.groups.push(g);
    return { group: g };
  }
  function disbandGroup(st, gid) {
    st.groups = st.groups.filter(function (g) { return g.id !== gid; });
  }

  // ==== 月結、年度（§2、§5.2） ====
  function monthly(st) {
    var salary = 0, upkeep = BAL.upkeepPerLevel * st.company.level, div = 0, loan = 0;
    st.dividends.forEach(function (d) { div += Math.round(d.pay * BAL.dividendRate * d.stars / 3); d.months--; });
    st.dividends = st.dividends.filter(function (d) { return d.months > 0; });
    st.loans.forEach(function (l) { loan += l.monthly; l.months--; });
    st.loans = st.loans.filter(function (l) { return l.months > 0; });
    st.company.money += div - upkeep - loan;
    var prMult = 1 - st.facilities.pr * D.FACILITIES.pr.fameDecay;
    st.artists.forEach(function (a) {
      var rate = (inPeak(a) ? BAL.fameDecay : BAL.fameDecayOffPeak) * prMult;
      a.fame = Math.round(a.fame * (1 - rate));
    });
    // 月薪隨人氣上升（規格 §5.2）：人氣衰退後重算，再支付
    st.artists.forEach(function (a) { updateSalary(a); salary += a.salary; });
    st.company.money -= salary;
    st.company.debtMonths = st.company.money < 0 ? st.company.debtMonths + 1 : 0;
    if (!st.company.debtMonths) st.company.crisisOn = false;
    if (st.company.debtMonths >= BAL.debtCrisisMonths && !st.company.crisisOn) {
      st.company.crisisOn = true;
      pushEvent(st, "finance_crisis");
    }
    rotatePickup(st);
    log(st, "month_end", { salary: salary, upkeep: upkeep, dividends: div, loan: loan });
  }

  function yearly(st) {
    st.artists.forEach(function (a) { a.age++; });
    st.waitlist.forEach(function (w) { w.artist.age++; });
    log(st, "birthday_year", { year: dateOf(st.day).year });
  }

  function tickWaitlist(st) {
    var keep = [];
    st.waitlist.forEach(function (w) {
      if (w.until > st.day) keep.push(w);
      else log(st, "waitlist_expired", { rarity: w.artist.rarity, rosterId: w.artist.rosterId, nameSeed: w.artist.nameSeed, gender: w.artist.gender });
    });
    st.waitlist = keep;
  }

  // ==== 自動方針（§6.5） ====
  var POLICIES = ["idle", "study", "balance", "work"];

  function setPolicy(st, aid, p) {
    var a = artistById(st, aid);
    if (!a) return "noArtist";
    if (POLICIES.indexOf(p) < 0) return "policy";
    a.policy = p;
    return null;
  }
  function setSafeLine(st, v) { st.company.safeLine = Math.max(0, Math.round(v) || 0); }

  function bestAutoJob(st, a) {
    var maxIdx = D.TIER_ORDER.indexOf(BAL.autoMaxTier), best = null, bestScore = 0;
    st.board.forEach(function (j) {
      if (j.slots !== 1 || D.TIER_ORDER.indexOf(j.tier) > maxIdx || eligible(st, a, j)) return;
      var r = estimate(st, [a.id], j).ratio;
      if (r < D.RESULTS.normal.min) return;
      var score = j.pay * Math.min(r, D.RESULTS.great.min);
      if (score > bestScore) { bestScore = score; best = j; }
    });
    return best;
  }

  function autoStudy(st, a) {
    var w = dirById(a.dir).weights, stat = null, best = -1;
    Object.keys(w).forEach(function (s) {
      var v = w[s] * (1 - a.stats[s] / a.caps[s]);
      if (v > best) { best = v; stat = s; }
    });
    var ids = [stat + "_2", stat + "_1"];
    for (var i = 0; i < ids.length; i++) {
      var c = D.COURSE_BY_ID[ids[i]];
      if (courseAllowed(st, c) && st.company.money - c.cost >= st.company.safeLine) {
        schedule(st, a.id, { kind: "course", courseId: c.id });
        return;
      }
    }
    schedule(st, a.id, { kind: "train" });
  }

  function autoOne(st, a) {
    var p = a.policy;
    var stressLimit = p === "work" ? BAL.autoRestStressWork : BAL.autoRestStress;
    if (a.stamina < BAL.autoRestStamina || a.stress > stressLimit) { schedule(st, a.id, { kind: "rest", days: 2 }); return; }
    if (p === "balance") p = a.lastAuto === "work" ? "study" : "work";
    if (p === "work") {
      var j = bestAutoJob(st, a);
      if (!(j && takeJob(st, j.id, [a.id]) === null)) schedule(st, a.id, { kind: "train" });
      a.lastAuto = "work";
    } else {
      autoStudy(st, a);
      a.lastAuto = "study";
    }
  }

  function autoPlan(st) {
    st.artists.forEach(function (a) { if (!a.task && a.policy !== "idle") autoOne(st, a); });
  }

  // ==== 離線結算（§2） ====
  function catchUp(st, now) {
    if (!st.lastTickAt) { st.lastTickAt = now; return null; }
    var elapsed = now - st.lastTickAt;
    if (elapsed < BAL.dayMs) return null;
    var days = Math.floor(elapsed / BAL.dayMs), capped = false;
    if (days > BAL.offlineCapDays) {
      days = BAL.offlineCapDays; capped = true;
      st.lastTickAt = now - (elapsed % BAL.dayMs);
    } else st.lastTickAt += days * BAL.dayMs;
    var before = { money: st.company.money, tickets: st.company.tickets, rep: st.company.rep, level: st.company.level, seq: st.logSeq };
    advance(st, days);
    return {
      days: days, capped: capped,
      money: st.company.money - before.money, tickets: st.company.tickets - before.tickets, rep: st.company.rep - before.rep,
      levelFrom: before.level, levelTo: st.company.level,
      logs: st.log.filter(function (e) { return e.seq > before.seq; })
    };
  }

  function dayProgress(st, now) {
    if (!st.lastTickAt) return 0;
    return clamp((now - st.lastTickAt) / BAL.dayMs, 0, 1);
  }

  // ==== UI 用的查詢與操作（計畫 2） ====
  function setDirs(st, aid, dir, subDirs) {
    var a = artistById(st, aid);
    if (!a) return "noArtist";
    if (!dirById(dir)) return "dir";
    subDirs = subDirs || [];
    if (subDirs.length > 2) return "sub";
    for (var i = 0; i < subDirs.length; i++) {
      if (!dirById(subDirs[i]) || subDirs[i] === dir || subDirs.indexOf(subDirs[i]) !== i) return "sub";
    }
    a.dir = dir;
    a.subDirs = subDirs.slice();
    return null;
  }
  function nextLevelRep(st) { return st.company.level >= 10 ? null : BAL.levelRep[st.company.level - 1]; }
  function dailyPullsLeft(st) { return BAL.dailyPullLimit - (st.gacha.pullDay === st.day ? st.gacha.pullCount : 0); }
  function pityLeft(st) { return pityMax(st) - st.gacha.pity; }

  // ==== 設施（§8.2） ====
  function facilityCap(st, f) {
    var F = D.FACILITIES[f];
    return f === "dorm" ? F.max : Math.min(F.max, st.company.level);
  }
  function facilityCost(st, f) {
    var F = D.FACILITIES[f];
    if (!F || st.facilities[f] >= F.max) return null;
    return Math.round(F.base * Math.pow(F.growth, st.facilities[f] - F.start) / 1000) * 1000;
  }
  function upgradeFacility(st, f) {
    var F = D.FACILITIES[f];
    if (!F || !F.base) return "noFacility";
    if (st.facilities[f] >= F.max) return "max";
    if (st.facilities[f] >= facilityCap(st, f)) return "level";
    var cost = facilityCost(st, f);
    if (st.company.money < cost) return "money";
    st.company.money -= cost;
    st.facilities[f]++;
    log(st, "facility_up", { f: f, lv: st.facilities[f] });
    return null;
  }

  // ==== 業界趨勢（§8.3） ====
  function rollTrend(st) {
    var ids = D.DIRS.map(function (d) { return d.id; }), hot = [], n = rint(st, 2, 3), cold;
    while (hot.length < n) { var x = pick(st, ids); if (hot.indexOf(x) < 0) hot.push(x); }
    do { cold = pick(st, ids); } while (hot.indexOf(cold) >= 0);
    var special = rnd(st) < BAL.specialTrendChance ? pick(st, D.SPECIAL_TRENDS).id : null;
    return { hot: hot, cold: cold, special: special };
  }
  function initTrend(st) {
    st.trend = { season: Math.floor(st.day / BAL.seasonDays), cur: rollTrend(st), next: rollTrend(st) };
  }
  function seasonTick(st) {
    if (st.day % BAL.seasonDays !== 0) return;
    st.trend.season = st.day / BAL.seasonDays;
    st.trend.cur = st.trend.next;
    st.trend.next = rollTrend(st);
    log(st, "trend_new", { season: st.trend.season });
  }
  function trendMult(st, dir) {
    var c = st.trend && st.trend.cur;
    if (!c) return 1;
    var sp = c.special ? D.SPECIAL_TREND_BY_ID[c.special] : null;
    if (c.hot.indexOf(dir) >= 0 || (sp && sp.dirs.indexOf(dir) >= 0)) return BAL.trendHot;
    if (c.cold === dir) return BAL.trendCold;
    return 1;
  }
  function seasonOf(day) {
    var s = Math.floor(day / BAL.seasonDays);
    return { year: Math.floor(s / 4) + 1, season: (s % 4) + 1 };
  }

  // ==== 重大事件（§7） ====
  var MUSIC_DIRS = ["singer", "band", "composer", "idol", "voice"];
  var DANCE_DIRS = ["dancer", "idol", "stage", "model"];
  var STREAM_DIRS = ["vtuber", "influencer"];
  var EVENT_FILTERS = {
    any: function () { return true; },
    famous: function (st, a) { return a.fame >= BAL.famousFame; },
    rookie: function (st, a) { return st.day - a.joinedDay <= BAL.rookieDays; },
    music: function (st, a) { return MUSIC_DIRS.indexOf(a.dir) >= 0; },
    dance: function (st, a) { return DANCE_DIRS.indexOf(a.dir) >= 0; },
    stream: function (st, a) { return STREAM_DIRS.indexOf(a.dir) >= 0; },
    stressed: function (st, a) { return a.stress >= 60; },
    unhappy: function (st, a) { return a.satisfaction < 50; },
    lowmood: function (st, a) { return a.mood <= 0; },
    idle: function (st, a) { return !a.task; }
  };

  function pushEvent(st, id, aid, ctx) {
    if (!D.EVENT_BY_ID || !D.EVENT_BY_ID[id]) return null;
    var e = { uid: newId(st, "e"), id: id, aid: aid || null, ctx: ctx || {}, day: st.day, deadline: st.day + BAL.eventDeadlineDays };
    st.events.pending.push(e);
    log(st, "event_new", { uid: e.uid, ev: id, aid: e.aid });
    while (st.events.pending.length > BAL.eventMax) autoResolve(st, st.events.pending[0]);
    return e;
  }

  // 依目標篩選鍵分組：每個篩選鍵只對藝人算一次，事件數量變多（上千種）時成本主要看篩選鍵種類
  function triggerRandomEvent(st) {
    var Events = root.PriTestStarvEvents;
    if (!Events) return null;
    var pool = {}, targets = {};
    Events.targets().forEach(function (key) {
      var list = null;
      if (key !== "none") {
        var f = EVENT_FILTERS[key];
        list = f ? st.artists.filter(function (a) { return f(st, a); }) : [];
        if (!list.length) return;
      }
      Events.byTarget(key).forEach(function (ev) { pool[ev.id] = ev.weight; targets[ev.id] = list; });
    });
    if (!Object.keys(pool).length) return null;
    var id = wpick(st, pool);
    return pushEvent(st, id, targets[id] ? pick(st, targets[id]).id : null);
  }

  function bumpStat(a, s, v) { a.stats[s] = clamp(Math.round((a.stats[s] + v) * 10) / 10, 0, a.caps[s]); }

  // 指名工作的等級：比藝人目前人氣夠格的最高等級再高一級，但不超過公司已解鎖的等級
  function tierUp(st, a) {
    var idx = 0, maxIdx = 0;
    D.TIER_ORDER.forEach(function (t, i) {
      if (D.TIERS[t].minFame <= a.fame) idx = i;
      if (D.TIERS[t].unlock <= st.company.level) maxIdx = i;
    });
    return D.TIER_ORDER[Math.min(idx + 1, maxIdx)];
  }

  function applyFx(st, e, fx) {
    var a = e.aid ? artistById(st, e.aid) : null, out = {};
    function add(k, v) { if (v) out[k] = (out[k] || 0) + v; }
    function bump(obj, k, v, lo, hi) { var v0 = obj[k]; obj[k] = clamp(obj[k] + v, lo, hi); return obj[k] - v0; }
    if (fx.money) { st.company.money += fx.money; add("money", fx.money); }
    if (fx.tickets) { st.company.tickets += fx.tickets; add("tickets", fx.tickets); }
    if (fx.rep) {
      if (fx.rep > 0) addRep(st, fx.rep); else st.company.rep = Math.max(0, st.company.rep + fx.rep);
      add("rep", fx.rep);
    }
    if (fx.loan) {
      st.company.money += fx.loan.amount;
      st.loans.push({ monthly: fx.loan.monthly, months: fx.loan.months });
      add("money", fx.loan.amount);
      out.loan = { monthly: fx.loan.monthly, months: fx.loan.months };
    }
    if (a) {
      if (fx.moneyBySalary) { var m = a.salary * fx.moneyBySalary; st.company.money += m; add("money", m); }
      var df = (fx.fame || 0) + Math.round(a.fame * (fx.famePct || 0));
      if (df) add("fame", bump(a, "fame", df, 0, 99999));
      ["stress", "stamina", "satisfaction"].forEach(function (k) { if (fx[k]) add(k, bump(a, k, fx[k], 0, 100)); });
      if (fx.mood) add("mood", bump(a, "mood", fx.mood, -2, 2));
      if (fx.salaryPct) {
        var s0 = a.salary;
        a.baseSalary = Math.round(a.baseSalary * (1 + fx.salaryPct) / 100) * 100;
        updateSalary(a);
        add("salary", a.salary - s0);
      }
      if (fx.statAll) { D.STATS.forEach(function (s) { bumpStat(a, s, fx.statAll); }); out.statAll = fx.statAll; }
      if (fx.stat) { Object.keys(fx.stat).forEach(function (s) { bumpStat(a, s, fx.stat[s]); }); out.stat = fx.stat; }
      if (fx.rest && !a.task) { a.task = { kind: "rest", days: fx.rest, left: fx.rest, stamina: 0, stress: 0, forced: true }; out.rest = fx.rest; }
      if (fx.specialJob) { var j = genJob(st, { dir: a.dir, tier: tierUp(st, a), reservedFor: a.id }); st.board.push(j); out.job = j.id; }
      if (fx.leave) { removeArtist(st, a); out.leave = true; log(st, "left", leftInfo(a)); }
    }
    ["allStress", "allSatisfaction"].forEach(function (k) {
      if (!fx[k]) return;
      var key = k === "allStress" ? "stress" : "satisfaction";
      st.artists.forEach(function (x) { bump(x, key, fx[k], 0, 100); });
      out[k] = fx[k];
    });
    if (fx.allSalaryPct) {
      st.artists.forEach(function (x) { x.baseSalary = Math.max(100, Math.round(x.baseSalary * (1 + fx.allSalaryPct) / 100) * 100); updateSalary(x); });
      out.allSalaryPct = fx.allSalaryPct;
    }
    if (fx.sellTop) {
      var top = null;
      st.artists.forEach(function (x) { if (!x.task && (!top || x.salary > top.salary)) top = x; });
      if (top) {
        var gain = top.salary * BAL.sellContractMonths;
        st.company.money += gain; add("money", gain);
        removeArtist(st, top);
        out.sold = leftInfo(top);
        log(st, "left", leftInfo(top));
      }
    }
    return out;
  }

  function resolveEvent(st, uid, idx, auto) {
    var i, e = null;
    for (i = 0; i < st.events.pending.length; i++) if (st.events.pending[i].uid === uid) e = st.events.pending[i];
    if (!e) return { err: "noEvent" };
    var ev = D.EVENT_BY_ID[e.id], ch = ev.choices[idx];
    if (!ch) return { err: "choice" };
    st.events.pending.splice(st.events.pending.indexOf(e), 1);
    var w = {};
    ch.outcomes.forEach(function (o, k) { w[k] = o.w * (o.bad ? 1 - st.facilities.pr * BAL.prBadCut : 1); });
    var k = Number(wpick(st, w)), o = ch.outcomes[k];
    var fx = applyFx(st, e, o.fx);
    log(st, auto ? "event_auto" : "event_resolved", { uid: uid, ev: e.id, aid: e.aid, choice: idx, outcome: k, fx: fx });
    return { outcome: k, fx: fx, bad: o.bad };
  }
  function autoResolve(st, e) { resolveEvent(st, e.uid, D.EVENT_BY_ID[e.id].defaultChoice, true); }

  function tickEvents(st) {
    st.events.pending.filter(function (e) { return e.deadline <= st.day; }).forEach(function (e) { autoResolve(st, e); });
    if (st.artists.length && rnd(st) < BAL.eventDailyChance) triggerRandomEvent(st);
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
  api.pullCost = pullCost;
  api.rates = rates;
  api.pull = pull;
  api.acceptWaitlist = acceptWaitlist;
  api.dismiss = dismiss;
  api._rollRarity = rollRarity;
  api._grantEntry = grantEntry;
  api._rotatePickup = rotatePickup;
  api.schedule = schedule;
  api.advance = advance;
  api.jobTitle = jobTitle;
  api.boardSize = boardSize;
  api._refreshBoard = refreshBoard;
  api._genJob = genJob;
  api.eligible = eligible;
  api.takeJob = takeJob;
  api.perfScore = perfScore;
  api.difficulty = difficulty;
  api.estimate = estimate;
  api.addRep = addRep;
  api.chemistry = chemistry;
  api.createGroup = createGroup;
  api.disbandGroup = disbandGroup;
  api.setPolicy = setPolicy;
  api.setSafeLine = setSafeLine;
  api.catchUp = catchUp;
  api.dayProgress = dayProgress;
  api.setDirs = setDirs;
  api.courseAllowed = courseAllowed;
  api.nextLevelRep = nextLevelRep;
  api.dailyPullsLeft = dailyPullsLeft;
  api.pityLeft = pityLeft;
  api.facilityCap = facilityCap;
  api.facilityCost = facilityCost;
  api.upgradeFacility = upgradeFacility;
  api.trendMult = trendMult;
  api.seasonOf = seasonOf;
  api.triggerEvent = pushEvent;
  api.triggerRandomEvent = triggerRandomEvent;
  api.resolveEvent = function (st, uid, idx) { return resolveEvent(st, uid, idx, false); };
  root.PriTestStarvCore = api;
})();
