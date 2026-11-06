// 賽狗賽狗（saigo）：生涯養成（2026-11-05 使用者指定，參考賽馬娘的育成；規劃見 docs/saigo_career_plan.md）。
// 這裡只有純計算（不碰 DOM、不碰 localStorage）：回合、訓練成長與失敗、事件、目標賽、技能點、畢業。
// 畫面在 saigo.js，存檔在犬舍（Kennel.load().career）。
//
// 已確認的規則（2026-11-05）：
//   - 一趟 24 回合（3 年 × 8 回合），第 8／16／24 回合是目標賽，沒達成＝生涯提前結束（仍可畢業）。
//   - 畢業的狗能力固定（不能再用犬舍的 20 次訓練、不能重置）；生涯學到的技能永久有效（不套用 30 分鐘過期）。
//   - 生涯中的比賽不能下注。
// 亂數：每次擲骰都由 c.seed＋計數器 c.n 決定，所以同一份存檔、同樣的選擇會得到同樣的結果（重新整理也不能重擲）。
(function () {
  "use strict";

  var D = window.PriTestSaigoData;
  var Core = window.PriTestSaigoCore;
  var SK = window.PriTestSaigoSkills;
  var C = D.C;
  function LN() { return window.PriTestSaigoLineage; }

  var TURNS = 24, YEAR = 8;
  // 目標賽：回合、賽事等級、要拿到的名次（含）
  var GOALS = [
    { turn: 8, cls: "rookie", place: 3 },
    { turn: 16, cls: "open", place: 3 },
    { turn: 24, cls: "stakes", place: 1 }
  ];
  var STAT_CAP = 70;          // 生涯訓練加成每項上限（犬舍是 40）

  // ---------------- 訓練 ----------------
  // main／sub：主能力與 2 項次能力；cost＝體力消耗。成長＝基礎 × 訓練等級 × 調子 ×（體力 < 30 時 × 0.8）
  var TRAINS = {
    speed: { icon: "💨", name: C("衝刺", "スピード", "Speed"), main: "spd", sub: ["pow", "agi"], cost: 22 },
    stamina: { icon: "🏃", name: C("長跑", "スタミナ", "Stamina"), main: "sta", sub: ["spd", "foc"], cost: 18 },
    power: { icon: "🛞", name: C("拉輪胎", "パワー", "Power"), main: "pow", sub: ["sta", "jmp"], cost: 21 },
    agility: { icon: "╫", name: C("障礙", "アジリティ", "Agility"), main: "agi", sub: ["jmp", "cat"], cost: 20 },
    skill: { icon: "≈", name: C("水上與服從", "水泳と服従", "Water & obedience"), main: "swm", sub: ["cat", "foc"], cost: 16 }
  };
  var TRAIN_IDS = ["speed", "stamina", "power", "agility", "skill"];
  var GAIN_MAIN = 4.6, GAIN_SUB = 1.7;
  var FAC_MAX = 5, FAC_STEP = 4, FAC_BONUS = 0.1;   // 同一種練 4 次升一級（最多 5 級），每級成長 +10%
  var REST = 50, REST_BAD = 30, OUTING_ENERGY = 15, RACE_COST = 15;
  var MOOD_MULT = [0.8, 0.9, 1, 1.1, 1.2];

  // 失敗率：體力 50 以上 0%，0 時 40%
  function failRate(c) { return c.energy >= 50 ? 0 : Math.min(0.4, (50 - c.energy) * 0.008); }

  // ---------------- 事件 ----------------
  // eff：{ stats: { k: n }, energy, mood, sp, hint: "n"|"r"|"g" }；choices：二選一；when：{ size: [最小, 最大], mood: [最小, 最大], year: [..] }
  function E(id, zh, ja, eff, choices, when) { return { id: id, text: C(zh, ja, zh), eff: eff || null, choices: choices || null, when: when || null }; }
  function O(zh, ja, eff) { return { text: C(zh, ja, zh), eff: eff }; }
  var EVENTS = [
    E("ball", "在公園撿到一顆網球，玩了一下午。", "公園でテニスボールを見つけて、午後じゅう遊んだ。", { mood: 1, energy: 5 }),
    E("rain_walk", "下雨天還是想出去散步……", "雨の日でも散歩に行きたい……", null, [O("陪牠去淋雨散步", "一緒に雨の中を散歩する", { stats: { sta: 4 }, energy: -10 }), O("在家玩拔河", "家で引っ張りっこ", { stats: { pow: 3 }, mood: 1 })]),
    E("cat", "圍牆上有一隻貓盯著牠看。", "塀の上の猫がじっと見ている。", null, [O("追上去！", "追いかける！", { stats: { agi: 5, spd: 2 }, energy: -15 }), O("忍住，坐下", "我慢して座る", { stats: { foc: 5 }, hint: "n" })]),
    E("vet", "定期健康檢查，獸醫說狀況很好。", "定期健診。獣医さんによると調子はいいらしい。", { energy: 15 }),
    E("treat", "鄰居給了一塊好吃的肉乾。", "近所の人がおいしいジャーキーをくれた。", { mood: 1 }),
    E("puddle", "跳進水坑弄得全身泥巴。", "水たまりに飛び込んで泥だらけ。", { stats: { swm: 3, pow: 1 }, mood: -1 }, null),
    E("mentor", "退役的老冠軍犬來訓練場打招呼。", "引退した名犬が練習場に挨拶に来た。", { sp: 30, hint: "r" }),
    E("night_run", "晚上偷偷溜出去跑了一圈。", "夜にこっそり抜け出して一周走ってきた。", { stats: { spd: 3, sta: 2 }, energy: -10 }),
    E("nap", "在陽光下睡了一個好覺。", "日なたでぐっすり昼寝した。", { energy: 20 }),
    E("frisbee", "附近的小朋友找牠玩飛盤。", "近所の子どもがフリスビーで遊んでくれた。", { stats: { cat: 5, jmp: 2 }, mood: 1, energy: -5 }),
    E("stairs", "發現一段很長的石階。", "長い石段を見つけた。", null, [O("一口氣衝上去", "一気に駆け上がる", { stats: { pow: 5, sta: 2 }, energy: -15 }), O("慢慢走上去看風景", "ゆっくり登って景色を見る", { mood: 1, energy: 5 })]),
    E("tv", "在電視上看到重賞的轉播，看得很入迷。", "テレビで重賞の中継を見て夢中になった。", { sp: 20, hint: "n" }),
    E("bath", "洗澡日。牠不太高興。", "お風呂の日。ちょっとご機嫌ななめ。", { mood: -1, energy: 5 }),
    E("rival_pup", "遇到另一家犬舍的幼犬，互相看不順眼。", "よその犬舎の子犬と出会い、にらみ合いになった。", null, [O("比一場賽跑", "かけっこ勝負", { stats: { spd: 4 }, energy: -12, sp: 15 }), O("無視牠", "相手にしない", { stats: { foc: 4 } })], { year: [1, 2] }),
    E("swim_lake", "去湖邊玩水。", "湖へ水遊びに行った。", { stats: { swm: 6 }, energy: -8, mood: 1 }),
    E("toy_broken", "最喜歡的玩具壞掉了……", "お気に入りのおもちゃが壊れてしまった……", { mood: -1 }),
    E("new_toy", "買了新的拉繩玩具。", "新しいロープのおもちゃを買った。", { stats: { pow: 3 }, mood: 1 }),
    E("crowd", "第一次被很多觀眾圍著看，有點緊張。", "大勢の観客に囲まれて少し緊張した。", null, [O("慢慢習慣人群", "人混みに少しずつ慣らす", { stats: { foc: 6 }, energy: -8 }), O("先回家休息", "今日は帰って休む", { energy: 15 })], { year: [1] }),
    E("snow", "下雪了！在雪地裡跑來跑去。", "雪だ！雪の中を駆け回った。", { stats: { sta: 3, agi: 2 }, mood: 1, energy: -8 }),
    E("hot_day", "好熱的一天，什麼都不想做。", "とても暑い日。何もしたくない。", { energy: -10, mood: -1 }),
    E("small_gap", "鑽過了圍籬的小縫。", "フェンスの小さなすき間をくぐり抜けた。", { stats: { agi: 4 }, hint: "n" }, null, { size: [1, 3] }),
    E("big_log", "把一根大樹枝拖回家了。", "大きな木の枝を家まで引きずってきた。", { stats: { pow: 5 } }, null, { size: [4, 5] }),
    E("photo", "雜誌來拍照採訪。", "雑誌の取材で写真を撮られた。", { sp: 25, mood: 1 }, null, { year: [2, 3] }),
    E("slump", "最近好像有點提不起勁……", "最近ちょっと元気がない……", null, [O("帶去新的散步路線", "新しい散歩コースへ", { mood: 1, energy: -5 }), O("多休息幾天", "しばらく休ませる", { energy: 25, stats: { spd: -2 } })], { mood: [0, 1] }),
    E("hot_streak", "狀態絕佳，訓練時一直想再跑一圈！", "絶好調で、練習中ずっともう一周走りたがる！", null, [O("讓牠多跑一圈", "もう一周走らせる", { stats: { spd: 4, sta: 4 }, energy: -15 }), O("適可而止", "ほどほどにする", { energy: 10 })], { mood: [4, 4] }),
    E("old_tape", "看了以前冠軍犬的比賽錄影。", "昔の名犬のレース映像を見た。", { sp: 15, hint: "g" }, null, { year: [2, 3] }),
    E("lucky", "撿到一個幸運的四葉草項圈。", "四つ葉のクローバーの首輪を拾った。", { sp: 20 }),
    E("hiccup", "打嗝打了一整天。", "一日中しゃっくりが止まらなかった。", { energy: -5 }),
    E("bird", "追了一整個早上的鴿子。", "朝からずっとハトを追いかけていた。", { stats: { spd: 2, agi: 3 }, energy: -10 }),
    E("brush", "仔細梳了毛，毛色亮晶晶。", "丁寧にブラッシングして毛ヅヤぴかぴか。", { mood: 1 }),
    E("sleepless", "雷雨的晚上嚇得睡不著。", "雷雨の夜、怖くて眠れなかった。", { energy: -15, stats: { foc: 2 } })
  ];
  var EVENT_P = 0.35;

  // ---------------- 技能 ----------------
  var PRICE = { n: 120, r: 200, g: 360 };
  var HINT_MAX = 3, HINT_OFF = 0.1;
  var TABLE = { g: 2, r: 6, n: 10 };   // 每趟生涯開始時抽的生涯技能表

  // ---------------- 亂數 ----------------
  function roll(c) {
    c.n = (c.n || 0) + 1;
    return Core.rng(((c.seed >>> 0) + Math.imul(c.n, 0x9e3779b1)) >>> 0)();
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function r1(x) { return Math.round(x * 10) / 10; }

  // ---------------- 建立 ----------------
  // opts：{ breed, name, seed?, bonus?: { 能力: 加成 }, hints?: { 技能: 等級 },
  //         parents?: [血統書紀錄]（血統繼承，第 3 步：開始時的能力加成與跑法適性、第 9／17 回合的繼承事件）}
  function create(opts) {
    var b = D.BREED_BY_ID[opts.breed];
    if (!b) return null;
    var c = { v: 1, breed: b.id, name: String(opts.name || "").trim().slice(0, 12) || D.L(b.name), seed: (opts.seed === undefined ? Core.newSeed() : opts.seed) >>> 0, n: 0,
      turn: 1, energy: 100, mood: 2, train: {}, fac: {}, facN: {}, sp: 0, hints: {}, skills: [], table: [], exp: 0, lv: 0,
      injured: 0, goals: [], done: false, failed: -1, pending: null, log: [], races: 0, wins: 0,
      parents: [], inherit: [], aptUp: {}, inheritLog: [] };
    var bonus = opts.bonus || {};
    if (opts.parents && opts.parents.length && LN()) {
      c.parents = opts.parents.map(LN().brief);
      c.inherit = LN().sources(opts.parents);
      var sb = LN().startBonus(c.inherit);
      bonus = sb.bonus; c.aptUp = sb.aptUp;
    }
    D.STATS.forEach(function (k) { c.train[k] = bonus[k] || 0; });
    TRAIN_IDS.forEach(function (k) { c.fac[k] = 1; c.facN[k] = 0; });
    var sr = function () { return roll(c); };
    c.best = D.rollBestStyle(b.style, sr);
    c.line = D.LINE_IDS[Math.floor(roll(c) * D.LINE_IDS.length)];
    SK.TIER_IDS.forEach(function (tier) {
      var src = SK.byTier(tier).slice();
      for (var i = 0; i < TABLE[tier] && src.length; i++) c.table.push(src.splice(Math.floor(roll(c) * src.length), 1)[0].id);
    });
    Object.keys(opts.hints || {}).forEach(function (id) { if (SK.BY_ID[id]) c.hints[id] = clamp(opts.hints[id] | 0, 1, HINT_MAX); });
    return c;
  }

  // ---------------- 查詢 ----------------
  function year(c) { return Math.min(3, Math.floor((c.turn - 1) / YEAR) + 1); }
  function goalAt(turn) { return GOALS.filter(function (g) { return g.turn === turn; })[0] || null; }
  function goalNow(c) { return goalAt(c.turn); }
  function stats(c) {
    var B = D.BREED_BY_ID[c.breed].base, out = {};
    D.STATS.forEach(function (k) { out[k] = B[k] + (c.train[k] || 0) + c.lv * 0.5; });
    return out;
  }
  function rating(c) { return SK.rating(stats(c), c.skills); }
  // 訓練預估（不擲骰）：主／次能力的成長
  function preview(c, kind) {
    var t = TRAINS[kind], m = (1 + (c.fac[kind] - 1) * FAC_BONUS) * MOOD_MULT[c.mood] * (c.energy < 30 ? 0.8 : 1), out = {};
    out[t.main] = r1(GAIN_MAIN * m);
    t.sub.forEach(function (k) { out[k] = r1((out[k] || 0) + GAIN_SUB * m); });
    return out;
  }
  // 現在可以做的事
  function canTrain(c) { return !c.done && !c.pending && !goalNow(c) && !c.injured; }
  function canFree(c) { return !c.done && !c.pending && !goalNow(c); }

  // ---------------- 行動 ----------------
  function addStat(c, k, v, out) {
    var before = c.train[k] || 0;
    c.train[k] = r1(clamp(before + v, -20, STAT_CAP));
    var d = r1(c.train[k] - before);
    if (d && out) out[k] = r1((out[k] || 0) + d);
    return d;
  }
  function gainExp(c, n) {
    c.exp += n;
    while (c.lv < 20 && c.exp >= 100 + c.lv * 40) { c.exp -= 100 + c.lv * 40; c.lv++; }
  }
  function train(c, kind) {
    var t = TRAINS[kind];
    if (!t || !canTrain(c)) return null;
    var res = { act: "train", kind: kind, gains: {}, fail: false, injured: false };
    if (roll(c) < failRate(c)) {
      res.fail = true;
      addStat(c, t.main, -3, res.gains);
      c.mood = clamp(c.mood - 1, 0, 4);
      if (roll(c) < 0.3) { c.injured = 2; res.injured = true; }
      c.energy = clamp(c.energy - 5, 0, 100);
    } else {
      var p = preview(c, kind);
      Object.keys(p).forEach(function (k) { addStat(c, k, p[k] * (0.9 + roll(c) * 0.2), res.gains); });
      c.energy = clamp(c.energy - t.cost, 0, 100);
      c.sp += 8;
      gainExp(c, 15);
      c.facN[kind]++;
      if (c.fac[kind] < FAC_MAX && c.facN[kind] >= FAC_STEP * c.fac[kind]) { c.fac[kind]++; res.facUp = c.fac[kind]; }
    }
    return endTurn(c, res);
  }
  function rest(c) {
    if (!canFree(c)) return null;
    var bad = roll(c) < 0.15, res = { act: "rest", bad: bad, energy: bad ? REST_BAD : REST };
    c.energy = clamp(c.energy + res.energy, 0, 100);
    if (c.injured) c.injured = Math.max(0, c.injured - 1);
    return endTurn(c, res);
  }
  function outing(c) {
    if (!canFree(c)) return null;
    var res = { act: "outing", mood: c.mood < 4 ? 1 : 0 };
    c.mood = clamp(c.mood + 1, 0, 4);
    c.energy = clamp(c.energy + OUTING_ENERGY, 0, 100);
    if (c.injured) c.injured = Math.max(0, c.injured - 1);
    return endTurn(c, res);
  }

  // ---------------- 比賽 ----------------
  // 生涯的出賽資料（給 Core.makeCard 的 entry；owner＝"me" 讓畫面標成自己的狗）
  function entry(c) {
    return { breed: c.breed, name: c.name, best: c.best, style: c.style || c.best, train: JSON.parse(JSON.stringify(c.train)), lv: c.lv, mood: c.mood, fatigue: 0,
      owner: "me", ownerName: "", dogId: "", skills: SK.sanitize(c.skills), line: c.line, aptUp: c.aptUp || {} };
  }
  // 這一回合要跑的比賽：目標賽（第 8／16／24 回合）或自選比賽（依年份：新手戰／一般戰／重賞）
  function raceSetup(c) {
    if (c.done || c.pending || (c.injured && !goalNow(c))) return null;
    var g = goalNow(c), cls = g ? g.cls : ["rookie", "open", "stakes"][year(c) - 1];
    return { cls: cls, goal: g, seed: (Math.imul(c.seed ^ 0x5eed, 31) + Math.imul(c.turn, 0x2c1b3c6d) + c.races) >>> 0, entry: entry(c) };
  }
  var RACE_SP = [60, 45, 35, 25, 20, 15, 10, 10], RACE_EXP = [60, 45, 35, 25, 20, 15, 15, 15];
  // place：0 起的名次（比賽在畫面或測試裡用 Core.simulate 跑）
  function applyRace(c, place) {
    var g = goalNow(c), res = { act: "race", place: place, goal: g ? GOALS.indexOf(g) : -1, gains: {}, sp: RACE_SP[place] || 10 };
    c.races++;
    if (place === 0) { c.wins++; c.mood = clamp(c.mood + 1, 0, 4); }
    else if (place >= 3 && roll(c) < 0.4) c.mood = clamp(c.mood - 1, 0, 4);
    if (g) res.sp += 40;
    c.sp += res.sp;
    gainExp(c, RACE_EXP[place] || 15);
    // 比賽也會成長：隨機 2 項 +2〜4（名次越前越多）
    for (var i = 0; i < 2; i++) addStat(c, D.STATS[Math.floor(roll(c) * D.STATS.length)], (place < 3 ? 2 : 1.5) + roll(c), res.gains);
    c.energy = clamp(c.energy - RACE_COST, 0, 100);
    if (g) {
      var ok = place < g.place;
      c.goals[GOALS.indexOf(g)] = ok;
      res.goalOk = ok;
      if (!ok) { c.done = true; c.failed = GOALS.indexOf(g); }
    }
    return endTurn(c, res);
  }

  // ---------------- 回合結束與事件 ----------------
  function eventOk(c, e) {
    var w = e.when;
    if (!w) return true;
    var sz = D.BREED_BY_ID[c.breed].size;
    if (w.size && (sz < w.size[0] || sz > w.size[1])) return false;
    if (w.mood && (c.mood < w.mood[0] || c.mood > w.mood[1])) return false;
    if (w.year && w.year.indexOf(year(c)) < 0) return false;
    return true;
  }
  function applyEff(c, eff) {
    var out = { gains: {} };
    if (!eff) return out;
    Object.keys(eff.stats || {}).forEach(function (k) { addStat(c, k, eff.stats[k], out.gains); });
    if (eff.energy) { c.energy = clamp(c.energy + eff.energy, 0, 100); out.energy = eff.energy; }
    if (eff.mood) { c.mood = clamp(c.mood + eff.mood, 0, 4); out.mood = eff.mood; }
    if (eff.sp) { c.sp += eff.sp; out.sp = eff.sp; }
    if (eff.hint) {
      var cand = c.table.filter(function (id) { return SK.BY_ID[id].tier === eff.hint && (c.hints[id] || 0) < HINT_MAX && c.skills.indexOf(id) < 0; });
      if (!cand.length) cand = c.table.filter(function (id) { return (c.hints[id] || 0) < HINT_MAX && c.skills.indexOf(id) < 0; });
      if (cand.length) { var id = cand[Math.floor(roll(c) * cand.length)]; c.hints[id] = (c.hints[id] || 0) + 1; out.hint = id; }
    }
    return out;
  }
  function endTurn(c, res) {
    // 每回合調子小幅起伏
    var x = roll(c);
    if (x < 0.06) c.mood = clamp(c.mood - 1, 0, 4); else if (x > 0.96) c.mood = clamp(c.mood + 1, 0, 4);
    // 事件
    if (!c.done && c.turn < TURNS && roll(c) < EVENT_P) {
      var list = EVENTS.filter(function (e) { return eventOk(c, e); }), e = list[Math.floor(roll(c) * list.length)];
      if (e) {
        res.event = e.id;
        if (e.choices) c.pending = e.id;
        else res.eventEff = applyEff(c, e.eff);
      }
    }
    c.log.push({ turn: c.turn, act: res.act, kind: res.kind || "", place: res.place, fail: !!res.fail, ev: res.event || "" });
    if (!c.pending) advance(c);
    return res;
  }
  function advance(c) {
    if (c.done) return;
    c.turn++;
    if (c.turn > TURNS) { c.turn = TURNS; c.done = true; return; }
    // 繼承事件（第 9、17 回合開始時）：祖先的因子依 ★ 機率觸發
    if (c.inherit && c.inherit.length && LN() && LN().EVENT_TURNS.indexOf(c.turn) >= 0) {
      var procs = LN().eventProcs(c.inherit, function () { return roll(c); });
      procs.forEach(function (x) {
        if (x.color === "blue") x.got = addStat(c, x.stat, x.add);
        else if (x.color === "white") c.hints[x.skill] = Math.min(HINT_MAX, (c.hints[x.skill] || 0) + x.lv);
      });
      c.inheritLog.push({ turn: c.turn, procs: procs });
    }
  }
  // 二選一事件
  function choose(c, i) {
    var e = EVENT_BY_ID[c.pending];
    if (!e || !e.choices || !e.choices[i]) return null;
    c.pending = null;
    var out = applyEff(c, e.choices[i].eff);
    out.choice = i;
    advance(c);
    return out;
  }

  // ---------------- 技能商店 ----------------
  function price(c, id) {
    var s = SK.BY_ID[id];
    return s ? Math.round(PRICE[s.tier] * (1 - HINT_OFF * Math.min(HINT_MAX, c.hints[id] || 0))) : Infinity;
  }
  // 可以學的技能：生涯技能表＋有提示的技能
  function shop(c) {
    var ids = c.table.slice();
    Object.keys(c.hints).forEach(function (id) { if (ids.indexOf(id) < 0 && SK.BY_ID[id]) ids.push(id); });
    return ids.map(function (id) { return { id: id, price: price(c, id), hint: c.hints[id] || 0, have: c.skills.indexOf(id) >= 0, can: SK.canLearn(c.skills, id) && c.sp >= price(c, id) }; });
  }
  function learn(c, id) {
    if (c.done && c.graduated) return false;
    if (!SK.canLearn(c.skills, id) || c.sp < price(c, id)) return false;
    if (c.table.indexOf(id) < 0 && !c.hints[id]) return false;
    c.sp -= price(c, id);
    c.skills.push(id);
    return true;
  }

  // ---------------- 畢業 ----------------
  // 犬舍的狗要用的資料（收進犬舍由 Kennel 負責）
  function graduate(c) {
    if (!c.done) return null;
    var r = rating(c);
    // 因子：第一次叫的時候用生涯的亂數產生並記在生涯上（同一份存檔每次都一樣，重新整理也不能重擲）
    if (!c.factors && LN()) c.factors = LN().makeFactors({ breed: c.breed, train: c.train, lv: c.lv, best: c.best, skills: c.skills, rating: r.pts }, true, function () { return roll(c); });
    return {
      factors: c.factors || null, parents: c.parents || [], aptUp: c.aptUp || {},
      breed: c.breed, name: c.name, best: c.best, runStyle: c.best, line: c.line, lv: c.lv, exp: 0,
      train: JSON.parse(JSON.stringify(c.train)), skills: SK.sanitize(c.skills),
      career: { rating: r.pts, grade: r.grade, goals: c.goals.slice(), failed: c.failed, turns: c.turn, races: c.races, wins: c.wins, seed: c.seed }
    };
  }

  var EVENT_BY_ID = {};
  EVENTS.forEach(function (e) { EVENT_BY_ID[e.id] = e; });

  window.PriTestSaigoCareer = {
    TURNS: TURNS, YEAR: YEAR, GOALS: GOALS, TRAINS: TRAINS, TRAIN_IDS: TRAIN_IDS, EVENTS: EVENTS, EVENT_BY_ID: EVENT_BY_ID, PRICE: PRICE, STAT_CAP: STAT_CAP,
    FAC_MAX: FAC_MAX, FAC_STEP: FAC_STEP, REST: REST, RACE_COST: RACE_COST,
    create: create, year: year, goalAt: goalAt, goalNow: goalNow, stats: stats, rating: rating, preview: preview, failRate: failRate,
    canTrain: canTrain, canFree: canFree, train: train, rest: rest, outing: outing, choose: choose,
    entry: entry, raceSetup: raceSetup, applyRace: applyRace, shop: shop, price: price, learn: learn, graduate: graduate
  };
})();
