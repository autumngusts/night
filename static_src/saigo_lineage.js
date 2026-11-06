// 賽狗賽狗（saigo）：血統書與繼承（2026-11-06，生涯養成的第 3 步；規劃見 docs/saigo_career_plan.md §2）。
// 因子的產生、血統書（存在犬舍 Kennel.load().lineage，最多 LINEAGE_MAX 筆）、繼承的加成計算。不碰 DOM。
//
// 因子（參考賽馬娘的因子）：
//   藍（能力）：速度／耐力／力量／敏捷其中一項（能力越高越容易被選到），★1〜3 依那一項的高低；
//   紅（跑法適性）：最適跑法，★1〜3 依評分（第一版只做跑法，不做地形；使用者 2026-11-05 確認）；
//   白（技能）：學過的技能各 50% 機率留下（最多 3 個），★1〜3。
//   沒經過生涯的犬舍狗送養時也會留因子，但藍最多 ★2、紅只有 ★1、白的機率較低。
// 繼承（開始生涯時選 2 隻祖先；祖先的祖先也算，效果減半）：
//   開始時：藍 ★1／2／3＝該能力 +BLUE_START[★]；紅：同一種跑法的 ★ 合計（祖父母減半）≥ 2 提高適性 1 階、≥ 6 提高 2 階；
//   第 9、17 回合的繼承事件：每個因子依 ★ 機率觸發（祖父母機率減半），藍＝再加能力、白＝技能提示 +★ 級。
(function () {
  "use strict";

  var D = window.PriTestSaigoData;
  var SK = window.PriTestSaigoSkills;
  var C = D.C;

  var LINEAGE_MAX = 30;
  var BLUE_STATS = ["spd", "sta", "pow", "agi"];
  var BLUE_START = [0, 3, 6, 9];         // 開始時的能力加成（祖父母 × 0.5）
  var BLUE_EVENT = [0, 2, 4, 6];        // 繼承事件觸發時的能力加成（祖父母 × 0.5）
  var PROC_P = [0, 0.3, 0.5, 0.7];      // 繼承事件的觸發機率（祖父母 × 0.5）
  var RED_UP = [[7, 2], [3, 1]];        // 紅因子 ★ 合計 → 適性提高幾階
  var EVENT_TURNS = [9, 17];
  var COLORS = { blue: C("藍", "青", "Blue"), red: C("紅", "赤", "Red"), white: C("白", "白", "White") };

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function stars(rnd, p2, p3) { return 1 + (rnd() < p2 ? 1 : 0) + (rnd() < p3 ? 1 : 0); }

  // dog：{ breed, train, lv, best, skills, rating? }；career＝是不是生涯畢業的狗；rnd＝亂數
  function makeFactors(dog, career, rnd) {
    var B = (D.BREED_BY_ID[dog.breed] || D.BREEDS[0]).base, v = {}, tot = 0;
    BLUE_STATS.forEach(function (k) { v[k] = B[k] + ((dog.train && dog.train[k]) || 0) + (dog.lv || 0) * 0.5; tot += v[k] * v[k]; });
    // 藍：能力越高越容易被選到（依平方加權）
    var x = rnd() * tot, stat = BLUE_STATS[0];
    for (var i = 0; i < BLUE_STATS.length; i++) { x -= v[BLUE_STATS[i]] * v[BLUE_STATS[i]]; if (x < 0) { stat = BLUE_STATS[i]; break; } }
    var bs = stars(rnd, clamp((v[stat] - 80) / 60, 0, 0.85), career ? clamp((v[stat] - 100) / 60, 0, 0.6) : 0);
    // 紅：最適跑法，★ 依評分
    var pts = dog.rating || SK.rating(dogStats(dog), dog.skills || []).pts;
    var rs = career ? stars(rnd, clamp((pts - 1200) / 700, 0.1, 0.8), clamp((pts - 1500) / 800, 0, 0.5)) : 1;
    // 白：學過的技能
    var white = [];
    SK.sanitize(dog.skills).forEach(function (id) {
      if (white.length < 3 && rnd() < (career ? 0.5 : 0.3)) { var r = rnd(); white.push({ id: id, star: r < 0.5 ? 1 : r < 0.85 ? 2 : 3 }); }
    });
    return { blue: { stat: stat, star: bs }, red: { style: D.STYLE_IDS.indexOf(dog.best) >= 0 ? dog.best : "senko", star: rs }, white: white };
  }
  function dogStats(dog) {
    var B = (D.BREED_BY_ID[dog.breed] || D.BREEDS[0]).base, out = {};
    D.STATS.forEach(function (k) { out[k] = B[k] + ((dog.train && dog.train[k]) || 0) + (dog.lv || 0) * 0.5; });
    return out;
  }

  // ---------------- 血統書 ----------------
  function store() {
    var s = window.PriTestSaigoKennel.load();
    if (!Array.isArray(s.lineage)) s.lineage = [];
    if (!isFinite(s.lineageNext)) s.lineageNext = 1;
    return s;
  }
  function list() { return store().lineage; }
  function get(id) { return list().filter(function (x) { return x.id === id; })[0] || null; }
  function full() { return list().length >= LINEAGE_MAX; }
  // rec：{ name, breed, best, grade, pts, factors, parents: [{ name, breed, factors }], career, races, wins, titles }
  function add(rec) {
    var s = store();
    if (s.lineage.length >= LINEAGE_MAX) return null;
    rec.id = "L" + (s.lineageNext++);
    rec.at = Date.now();
    s.lineage.unshift(rec);
    window.PriTestSaigoKennel.save();
    return rec;
  }
  function update(id, patch) {
    var r = get(id);
    if (!r) return null;
    Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
    window.PriTestSaigoKennel.save();
    return r;
  }
  function remove(id) {
    var s = store();
    s.lineage = s.lineage.filter(function (x) { return x.id !== id; });
    window.PriTestSaigoKennel.save();
  }
  // 祖先的簡要資料（存進下一代的 parents，只留一層）
  function brief(rec) { return { name: rec.name, breed: rec.breed, factors: rec.factors }; }

  // ---------------- 繼承 ----------------
  // 祖先（血統書的紀錄）→ 繼承來源 [{ w: 1／0.5, name, factors }]（父母＋父母的父母）
  function sources(recs) {
    var out = [];
    (recs || []).forEach(function (r) {
      if (!r || !r.factors) return;
      out.push({ w: 1, name: r.name, factors: r.factors });
      (r.parents || []).forEach(function (p) { if (p && p.factors) out.push({ w: 0.5, name: p.name, factors: p.factors }); });
    });
    return out;
  }
  // 開始時的加成：{ bonus: { 能力: n }, aptUp: { 跑法: 階 }, red: { 跑法: ★合計 } }
  function startBonus(src) {
    var bonus = {}, red = {}, aptUp = {};
    src.forEach(function (s) {
      var b = s.factors.blue, r = s.factors.red;
      if (b && BLUE_START[b.star]) bonus[b.stat] = (bonus[b.stat] || 0) + BLUE_START[b.star] * s.w;
      if (r && D.STYLE_IDS.indexOf(r.style) >= 0) red[r.style] = (red[r.style] || 0) + r.star * s.w;
    });
    Object.keys(red).forEach(function (st) { for (var i = 0; i < RED_UP.length; i++) if (red[st] >= RED_UP[i][0]) { aptUp[st] = RED_UP[i][1]; break; } });
    Object.keys(bonus).forEach(function (k) { bonus[k] = Math.round(bonus[k] * 10) / 10; });
    return { bonus: bonus, aptUp: aptUp, red: red };
  }
  // 繼承事件：每個因子擲一次。roll＝亂數函式。回傳 [{ name, color, stat?, add?, skill?, lv? }]
  function eventProcs(src, roll) {
    var out = [];
    src.forEach(function (s) {
      var f = s.factors;
      if (f.blue && roll() < PROC_P[f.blue.star] * s.w) out.push({ name: s.name, color: "blue", stat: f.blue.stat, add: BLUE_EVENT[f.blue.star] * s.w });
      (f.white || []).forEach(function (wf) { if (SK.BY_ID[wf.id] && roll() < PROC_P[wf.star] * s.w) out.push({ name: s.name, color: "white", skill: wf.id, lv: wf.star }); });
    });
    return out;
  }

  window.PriTestSaigoLineage = {
    LINEAGE_MAX: LINEAGE_MAX, BLUE_STATS: BLUE_STATS, BLUE_START: BLUE_START, BLUE_EVENT: BLUE_EVENT, PROC_P: PROC_P, RED_UP: RED_UP, EVENT_TURNS: EVENT_TURNS, COLORS: COLORS,
    makeFactors: makeFactors, list: list, get: get, full: full, add: add, update: update, remove: remove, brief: brief,
    sources: sources, startBonus: startBonus, eventProcs: eventProcs
  };
})();
