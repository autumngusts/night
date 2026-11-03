// 賽狗賽狗（saigo）：家園（犬舍）——錢包、自己的狗、訓練／休息／玩耍、賽後成長。存在本機 localStorage。
// 每台裝置一份犬舍；連線比賽時把狗的出賽資料（entry）送進房間，賽後由狗主人那台裝置自己結算獎金與經驗。
(function () {
  "use strict";

  var D = window.PriTestSaigoData;
  var KEY = "pritest-saigo-kennel";
  var MAX_DOGS = 6;
  var TRAIN_CAP = 40;        // 每項訓練加成上限
  var MAX_LV = 20;
  var START_COINS = 10000;
  var ADOPT_COST = 2000;     // 第一隻免費
  var BAILOUT = 3000;        // 錢包見底（不到 100）時的救濟金
  var RECOVER_MIN = 6;       // 每 6 分鐘自然恢復 1 點疲勞

  // 訓練項目：主要提升的能力＋次要能力
  var TRAININGS = {
    sprint: { main: "spd", sub: "pow", icon: "💨" },
    jog: { main: "sta", sub: "spd", icon: "🏃" },
    tire: { main: "pow", sub: "sta", icon: "🛞" },
    slalom: { main: "agi", sub: "foc", icon: "〰" },
    hurdle: { main: "jmp", sub: "agi", icon: "╫" },
    swim: { main: "swm", sub: "sta", icon: "≈" },
    frisbee: { main: "cat", sub: "jmp", icon: "◎" },
    obedience: { main: "foc", sub: "cat", icon: "✋" },
    // 2026-11-02 追加 8 種
    interval: { main: "spd", sub: "sta", icon: "⏱" },
    lure: { main: "spd", sub: "foc", icon: "🐰" },
    hill: { main: "pow", sub: "spd", icon: "⛰" },
    trail: { main: "sta", sub: "agi", icon: "🌲" },
    agility: { main: "agi", sub: "jmp", icon: "🔀" },
    dock: { main: "swm", sub: "jmp", icon: "🌊" },
    tug: { main: "pow", sub: "cat", icon: "🪢" },
    gate: { main: "foc", sub: "agi", icon: "🚪" }
  };
  var SK = window.PriTestSaigoSkills;

  var store = null;
  function now() { return Date.now(); }
  function blank() {
    return { v: 1, coins: START_COINS, dogs: [], nextId: 1, at: now(), stats: { races: 0, bets: 0, spent: 0, won: 0, bailouts: 0 }, history: [], jp: window.PriTestSaigoBet ? window.PriTestSaigoBet.JP_SEED : 5000 };
  }
  function load() {
    if (store) return store;
    try { store = JSON.parse(window.localStorage.getItem(KEY) || "null"); } catch (e) { store = null; }
    if (!store || store.v !== 1) store = blank();
    store.stats = store.stats || blank().stats;
    store.history = store.history || [];
    if (!isFinite(store.jp)) store.jp = blank().jp;
    recover();
    return store;
  }
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* 存不了也能玩 */ }
  }
  // 依經過的真實時間恢復疲勞
  function recover() {
    var mins = (now() - (store.at || now())) / 60000;
    var pts = Math.floor(mins / RECOVER_MIN);
    if (pts > 0) {
      store.dogs.forEach(function (d) { d.fatigue = Math.max(0, d.fatigue - pts); });
      store.at = (store.at || now()) + pts * RECOVER_MIN * 60000;
    }
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function dog(id) { return load().dogs.filter(function (d) { return d.id === id; })[0] || null; }

  function adoptCost() { return load().dogs.length ? ADOPT_COST : 0; }
  function adopt(breed, name) {
    var s = load();
    if (s.dogs.length >= MAX_DOGS || !D.BREED_BY_ID[breed]) return null;
    var cost = adoptCost();
    if (s.coins < cost) return null;
    s.coins -= cost;
    var train = {};
    D.STATS.forEach(function (k) { train[k] = 0; });
    var best = D.rollBestStyle(D.BREED_BY_ID[breed].style, Math.random);
    var d = { id: "d" + (s.nextId++), breed: breed, best: best, runStyle: best, skills: [], skillExp: {}, line: D.LINE_IDS[Math.floor(Math.random() * D.LINE_IDS.length)], name: String(name || "").trim().slice(0, 12) || D.L(D.BREED_BY_ID[breed].name), lv: 0, exp: 0, train: train, fatigue: 0, mood: 3, bond: 10, races: 0, wins: 0, top3: 0, earnings: 0 };
    s.dogs.push(d);
    save();
    return d;
  }
  function release(id) {
    var s = load();
    s.dogs = s.dogs.filter(function (d) { return d.id !== id; });
    save();
  }
  function rename(id, name) {
    var d = dog(id);
    if (d && String(name || "").trim()) { d.name = String(name).trim().slice(0, 12); save(); }
  }

  function gainExp(d, n) {
    d.exp += n;
    var ups = 0;
    while (d.lv < MAX_LV && d.exp >= expNeed(d.lv)) { d.exp -= expNeed(d.lv); d.lv++; ups++; }
    if (d.lv >= MAX_LV) d.exp = 0;
    return ups;
  }
  function expNeed(lv) { return 100 + lv * 40; }

  // 訓練：成長量隨已練程度遞減，心情好練得多，太累練不太動
  function train(id, kind) {
    var d = dog(id), tr = TRAININGS[kind];
    if (!d || !tr) return null;
    if (d.fatigue >= 95) return { tired: true };
    var moodF = [0.6, 0.8, 1, 1.15, 1.3][d.mood];
    var fatF = d.fatigue > 70 ? 0.5 : 1;
    var r = Math.random;
    function grow(stat, base) {
      var cur = d.train[stat] || 0;
      var g = base * (0.7 + r() * 0.6) * (1 - cur / (TRAIN_CAP + 5)) * moodF * fatF;
      g = Math.round(clamp(g, 0.2, 6) * 10) / 10;
      d.train[stat] = Math.min(TRAIN_CAP, Math.round((cur + g) * 10) / 10);
      return Math.round((d.train[stat] - cur) * 10) / 10;
    }
    var out = { main: tr.main, sub: tr.sub, gMain: grow(tr.main, 3), gSub: grow(tr.sub, 1) };
    d.fatigue = clamp(d.fatigue + 14, 0, 100);
    if (d.fatigue > 60 && r() < 0.3) { d.mood = clamp(d.mood - 1, 0, 4); out.moodDown = true; }
    out.lvUp = gainExp(d, 8);
    // 技能池：沒有（或已過期）就抽新的 20 個
    if (!pool()) { s0().skillPool = { at: now(), ids: SK.rollPool(Math.random) }; out.newPool = true; }
    save();
    return out;
  }
  function s0() { return load(); }

  // ---------------- 技能 ----------------
  // 技能池（整個犬舍共用）：訓練時抽 20 個（金 4、罕見 8、一般 8），30 分鐘後消失；
  // 消失後要再訓練才會抽新的。學習＝從池裡拿一個放進狗（欄位：金 1、罕見 2、一般 2），拿走就從池裡移除。
  function pool() {
    var st = load(), p = st.skillPool;
    if (!p || !Array.isArray(p.ids)) return null;
    if (now() - p.at >= SK.POOL_TTL_MS) { st.skillPool = null; save(); return null; }
    return { at: p.at, ids: p.ids.slice(), left: SK.POOL_TTL_MS - (now() - p.at) };
  }
  // 技能期限（2026-11-03 使用者指定「抽選的技能表 30 分鐘過後自動過期，狗無法再帶前 30 分鐘的技能，需要替換」）：
  //   學會的技能跟著它來自的技能池一起過期（池子抽出後 POOL_TTL_MS），過期的技能不會帶進比賽、不算評分，
  //   但仍留在欄位上顯示「已過期」，學新技能時同一階的過期技能會被替換掉。d.skillExp[id]＝到期時刻（毫秒）；
  //   沒有記錄的（這次改版前學的）一律視為已過期。
  function expOf(d, id) { return (d && d.skillExp && d.skillExp[id]) || 0; }
  function skillsOf(d) { return SK.sanitize((d && d.skills || []).filter(function (id) { return expOf(d, id) > now(); })); }
  function expiredSkillsOf(d) {
    var ok = skillsOf(d);
    return (d && d.skills || []).filter(function (id) { return SK.BY_ID[id] && ok.indexOf(id) < 0; });
  }
  function skillLeft(d, id) { return Math.max(0, expOf(d, id) - now()); }
  function learn(dogId, skillId) {
    var d = dog(dogId), p = pool(), st = load();
    if (!d || !p || p.ids.indexOf(skillId) < 0) return "gone";
    var cur = skillsOf(d);
    if (cur.indexOf(skillId) >= 0) return "dup";
    if (!SK.canLearn(cur, skillId)) return "full";
    // 同一階的過期技能：替換掉一個（欄位總數不超過上限）
    var tier = SK.BY_ID[skillId].tier, old = expiredSkillsOf(d), all = cur.concat(old).filter(function (id) { return id !== skillId; });
    var usedT = all.filter(function (id) { return SK.BY_ID[id].tier === tier; }).length;
    var drop = usedT >= SK.TIERS[tier].slots ? old.filter(function (id) { return SK.BY_ID[id].tier === tier; })[0] : null;
    d.skills = all.filter(function (id) { return id !== drop; }).concat([skillId]);
    d.skillExp = d.skillExp || {};
    if (drop) delete d.skillExp[drop];
    Object.keys(d.skillExp).forEach(function (k) { if (d.skills.indexOf(k) < 0) delete d.skillExp[k]; });
    d.skillExp[skillId] = p.at + SK.POOL_TTL_MS;
    var ids = st.skillPool.ids, k = ids.indexOf(skillId);
    ids.splice(k, 1);
    save();
    return drop ? "replaced" : "ok";
  }
  function forget(dogId, skillId) {
    var d = dog(dogId);
    if (!d) return;
    d.skills = (d.skills || []).filter(function (x) { return x !== skillId; });
    if (d.skillExp) delete d.skillExp[skillId];
    save();
  }
  function lineOf(d) { return D.LINES[d.line] ? d.line : D.LINE_IDS[parseInt(String(d.id).replace(/\D/g, ""), 10) % 3 || 0]; }
  // 總評分（能力＋技能）
  function stats(d) {
    var b = D.BREED_BY_ID[d.breed] || D.BREEDS[0], out = {};
    D.STATS.forEach(function (k) { out[k] = b.base[k] + ((d.train && d.train[k]) || 0) + (d.lv || 0) * 0.5; });
    return out;
  }
  function rating(d) { return SK.rating(stats(d), skillsOf(d)); }
  function rest(id) {
    var d = dog(id);
    if (!d) return;
    d.fatigue = clamp(d.fatigue - 35, 0, 100);
    if (d.fatigue < 30) d.mood = clamp(d.mood + 1, 0, 4);
    save();
  }
  function play(id) {
    var d = dog(id);
    if (!d) return;
    d.mood = clamp(d.mood + 1, 0, 4);
    d.bond = clamp(d.bond + 5, 0, 100);
    d.fatigue = clamp(d.fatigue + 4, 0, 100);
    save();
  }
  var TREAT_COST = 200;
  function treat(id) {
    var s = load(), d = dog(id);
    if (!d || s.coins < TREAT_COST) return false;
    s.coins -= TREAT_COST;
    d.mood = clamp(d.mood + 1, 0, 4);
    d.fatigue = clamp(d.fatigue - 10, 0, 100);
    d.bond = clamp(d.bond + 2, 0, 100);
    save();
    return true;
  }

  // 跑法：最適跑法（舊資料沒有＝犬種的跑法）與下次出賽要用的跑法
  function bestStyle(d) { return D.STYLE_IDS.indexOf(d.best) >= 0 ? d.best : (D.BREED_BY_ID[d.breed] || D.BREEDS[0]).style; }
  function runStyle(d) { return D.STYLE_IDS.indexOf(d.runStyle) >= 0 ? d.runStyle : bestStyle(d); }
  function setRunStyle(id, style) {
    var d = dog(id);
    if (d && D.STYLE_IDS.indexOf(style) >= 0) { d.runStyle = style; save(); }
  }

  // 出賽資料（給 Core.makeCard 的 entries）
  function entry(id, owner, ownerName) {
    var d = dog(id);
    if (!d) return null;
    return { breed: d.breed, name: d.name, best: bestStyle(d), style: runStyle(d), train: JSON.parse(JSON.stringify(d.train)), lv: d.lv, mood: d.mood, fatigue: d.fatigue, owner: owner || "me", ownerName: ownerName || "", dogId: d.id, skills: skillsOf(d), line: lineOf(d) };
  }

  // 賽後：自己的狗拿獎金、經驗、疲勞與心情變化。practice＝家園練習賽（沒有獎金，經驗減半）
  // noCoins＝獎金不進犬舍錢包（連線房間：由呼叫端改加進房間籌碼）
  function afterRace(dogId, place, prizeMult, practice, noCoins) {
    var s = load(), d = dog(dogId);
    if (!d) return null;
    var prize = practice ? 0 : Math.round((D.PRIZES[place] || 0) * (prizeMult || 1));
    var exp = [60, 45, 35, 25, 20, 15][place] || 15;
    if (practice) exp = Math.round(exp / 2);
    d.races++;
    if (place === 0) d.wins++;
    if (place < 3) d.top3++;
    d.earnings += prize;
    if (!noCoins) s.coins += prize;
    d.fatigue = clamp(d.fatigue + (practice ? 12 : 25), 0, 100);
    if (place === 0) d.mood = clamp(d.mood + 1, 0, 4);
    else if (place >= 4 && Math.random() < 0.4) d.mood = clamp(d.mood - 1, 0, 4);
    var ups = gainExp(d, exp);
    // 練習賽：隨機兩項能力 +0.5
    if (practice) {
      for (var i = 0; i < 2; i++) {
        var k = D.STATS[Math.floor(Math.random() * D.STATS.length)];
        d.train[k] = Math.min(TRAIN_CAP, Math.round(((d.train[k] || 0) + 0.5) * 10) / 10);
      }
    }
    save();
    return { prize: prize, exp: exp, lvUp: ups };
  }

  function coins() { return load().coins; }
  function spend(n) { var s = load(); if (s.coins < n) return false; s.coins -= n; s.stats.bets++; s.stats.spent += n; save(); return true; }
  function receive(n) { var s = load(); s.coins += n; s.stats.won += n; save(); }
  function bailout() {
    var s = load();
    if (s.coins >= 100) return false;
    s.coins += BAILOUT; s.stats.bailouts++; save();
    return true;
  }
  // 比賽紀錄（最近 30 場）
  function record(row) {
    var s = load();
    s.stats.races++;
    s.history.unshift(row);
    if (s.history.length > 30) s.history.length = 30;
    save();
  }

  // 單機的累積彩金
  function jackpot() { return load().jp; }
  function setJackpot(n) { load().jp = n; save(); }

  window.PriTestSaigoKennel = {
    MAX_DOGS: MAX_DOGS, TRAIN_CAP: TRAIN_CAP, MAX_LV: MAX_LV, TRAININGS: TRAININGS, TREAT_COST: TREAT_COST, BAILOUT: BAILOUT,
    load: load, save: save, dog: dog, adopt: adopt, adoptCost: adoptCost, release: release, rename: rename,
    train: train, rest: rest, play: play, treat: treat, expNeed: expNeed,
    pool: pool, learn: learn, forget: forget, skillsOf: skillsOf, expiredSkillsOf: expiredSkillsOf, skillLeft: skillLeft, lineOf: lineOf, stats: stats, rating: rating,
    entry: entry, afterRace: afterRace, bestStyle: bestStyle, runStyle: runStyle, setRunStyle: setRunStyle, jackpot: jackpot, setJackpot: setJackpot, coins: coins, spend: spend, receive: receive, bailout: bailout, record: record
  };
})();
