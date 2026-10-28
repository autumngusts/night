// 明星經紀 starV 的平衡模擬與抽卡統計（node 直接跑）：
//   node tools/starv_check/sim.js [年數，預設 30]
// 不變量（數值必須是有限數、範圍正確、保底不超過 150）違反時 exit 1；
// 平衡指標（升級速度、資金走向）超出預期只印 WARN，供調整 starv_data.js 的 BAL 時參考。
"use strict";

global.window = global;
require("../../static_src/starv_data.js");
require("../../static_src/starv_words_1.js");
require("../../static_src/starv_traits_1.js");
require("../../static_src/starv_events.js");
require("../../static_src/starv_events_1.js");
require("../../static_src/starv_events_2.js");
require("../../static_src/starv_events_3.js");
require("../../static_src/starv_events_4.js");
require("../../static_src/starv_events_5.js");
require("../../static_src/starv_events_6.js");
require("../../static_src/starv_events_7.js");
require("../../static_src/starv_events_8.js");
require("../../static_src/starv_events_9.js");
require("../../static_src/starv_events_10.js");
require("../../static_src/starv_events_11.js");
require("../../static_src/starv_events_12.js");
require("../../static_src/starv_events_13.js");
require("../../static_src/starv_events_14.js");
require("../../static_src/starv_awards_data.js");
require("../../static_src/starv_projects.js");
require("../../static_src/starv_projects_1.js");
require("../../static_src/starv_projects_2.js");
require("../../static_src/starv_achievements.js");
require("../../static_src/starv_achievements_1.js");
require("../../static_src/starv_achievements_2.js");
require("../../static_src/starv_achievements_3.js");
require("../../static_src/starv_roster.js");
require("../../static_src/starv_roster_1.js");
require("../../static_src/starv_roster_2.js");
require("../../static_src/starv_roster_3.js");
require("../../static_src/starv_roster_4.js");
require("../../static_src/starv_roster_5.js");
require("../../static_src/starv_roster_6.js");
require("../../static_src/starv_roster_rivals_1.js");
require("../../static_src/starv_roster_rivals_2.js");
require("../../static_src/starv_core.js");
var D = global.PriTestStarvData;
var Core = global.PriTestStarvCore;

var YEARS = Number(process.argv[2]) || 30;
var errors = 0;

function fail(msg) { errors++; console.log("ERROR " + msg); }
function warn(msg) { console.log("WARN  " + msg); }

function checkState(st, tag) {
  ["money", "tickets", "rep", "level"].forEach(function (k) { if (!isFinite(st.company[k])) fail(tag + " company." + k + " 不是有限數"); });
  if (st.artists.length > Core.capacity(st)) fail(tag + " 藝人數超過宿舍上限");
  st.artists.forEach(function (a) {
    D.STATS.forEach(function (s) {
      if (!isFinite(a.stats[s]) || a.stats[s] < 0 || a.stats[s] > a.caps[s]) fail(tag + " " + a.id + "." + s + " = " + a.stats[s]);
    });
    if (a.stamina < 0 || a.stamina > 100 || a.stress < 0 || a.stress > 100) fail(tag + " " + a.id + " 體力／壓力超出範圍");
    if (!isFinite(a.fame) || a.fame < 0) fail(tag + " " + a.id + " 人氣異常");
  });
  if (st.rivals.length !== D.BAL.rivalCount) fail(tag + " 對手數量 " + st.rivals.length);
  if (!(st.era >= 1)) fail(tag + " era 異常");
  st.hall.forEach(function (h) { if (typeof h.score !== "number") fail(tag + " 名人堂缺 score"); });
}

// 積極經營：空檔藝人手動接「預估比率 ≥ 0.9」中酬勞最高的工作（含 A/S）
function activeAssign(st) {
  st.artists.forEach(function (a) {
    if (a.task || a.stamina < 45 || a.stress > 60) return;
    var best = null, bestPay = 0;
    st.board.forEach(function (j) {
      if (j.slots !== 1 || Core.eligible(st, a, j)) return;
      if (Core.estimate(st, [a.id], j).ratio < 0.9) return;
      if (j.pay > bestPay) { bestPay = j.pay; best = j; }
    });
    if (best) Core.takeJob(st, best.id, [a.id]);
  });
}

// 每月先升級設施：宿舍優先（資金 ≥ 費用 × 1.5 + 5 萬），其他設施在資金 ≥ 費用 × 3 時升級
function buyFacilities(st) {
  var cost;
  while ((cost = Core.facilityCost(st, "dorm")) !== null && st.facilities.dorm < Core.facilityCap(st, "dorm") &&
    st.company.money >= cost * 1.5 + 50000) Core.upgradeFacility(st, "dorm");
  D.FACILITY_ORDER.forEach(function (f) {
    if (f === "dorm") return;
    while ((cost = Core.facilityCost(st, f)) !== null && st.facilities[f] < Core.facilityCap(st, f) && st.company.money >= cost * 3) {
      if (Core.upgradeFacility(st, f)) break;
    }
  });
}

// 積極經營：做得起就開最貴的企劃；階段空著就派「在 dirs 裡、能力合計最高」的空閒藝人
function runProject(st) {
  if (!st.project) {
    var can = D.PROJECTS.filter(function (p) { return st.company.level >= p.unlockLevel && st.company.money >= p.cost * 2; })
      .sort(function (x, y) { return y.cost - x.cost; })[0];
    if (can) Core.startProject(st, can.id);
    return;
  }
  if (st.project.active) return;
  var stage = D.PROJECT_BY_ID[st.project.id].stages[st.project.stage];
  var pool = st.artists.filter(function (a) {
    return !a.task && (stage.dirs.indexOf(a.dir) >= 0 || a.subDirs.some(function (d) { return stage.dirs.indexOf(d) >= 0; }));
  }).sort(function (x, y) { return power(y) - power(x); });
  if (pool.length >= stage.slots[0]) Core.assignStage(st, pool.slice(0, stage.slots[1]).map(function (a) { return a.id; }));
}
function power(a) { var s = 0; D.STATS.forEach(function (k) { s += a.stats[k]; }); return s; }

function runScenario(name, seed) {
  var st = Core.create({ seed: seed });
  Core.pull(st, "ticket", 10);
  var rows = [];
  for (var day = 1; day <= YEARS * 360; day++) {
    if (name !== "idle" && day % 30 === 1) {
      buyFacilities(st);
      while (st.company.money > 150000 && st.artists.length < Core.capacity(st)) {
        if (Core.pull(st, "money", 1).err) break;
      }
      if (st.company.tickets >= 10) Core.pull(st, "ticket", 10);
      st.artists.forEach(function (a) { if (a.policy === "idle") Core.setPolicy(st, a.id, name === "active" ? "work" : "balance"); });
    }
    if (name === "active") runProject(st);
    if (name === "active") activeAssign(st);
    // 積極經營的玩家：超過引退線的人提出引退就尊重（事件預設是挽留；不選的話名人堂永遠不會有人）
    if (name === "active") st.events.pending.filter(function (e) { return e.id === "retire_offer"; }).forEach(function (e) {
      var a = Core.artistById(st, e.aid);
      if (a && a.age > D.DIR_BY_ID[a.dir].retire) Core.resolveEvent(st, e.uid, 0);
    });
    if (name === "active" && st.company.level >= 10 && st.day % 360 === 0 && st.era === 1) {
      var bestA = null;
      st.artists.forEach(function (a) { var s = 0; D.STATS.forEach(function (k) { s += a.stats[k]; }); if (!bestA || s > bestA.s) bestA = { a: a, s: s }; });
      Core.newEra(st, bestA ? bestA.a.id : null);
    }
    Core.advance(st, 1);
    if (day % 360 === 0) {
      checkState(st, name + " Y" + (day / 360));
      if ((day / 360) % 5 === 0 || day === 360) {
        var avg = 0;
        st.artists.forEach(function (a) { D.STATS.forEach(function (s) { avg += a.stats[s]; }); });
        avg = st.artists.length ? Math.round(avg / st.artists.length / 6) : 0;
        rows.push({ year: day / 360, era: st.era, proj: st.stats.projects, hof: st.hall.length, ret: st.timeline.filter(function (x) { return x.kind === "retire"; }).length, dorm: st.facilities.dorm,
          wins: st.awards.history.length ? st.awards.history[0].results.filter(function (r) { var n = r.nominees[r.winner]; return ["artist", "work", "group", "company"].indexOf(n.kind) >= 0; }).length : 0,
          rivals: Math.round(st.rivals.reduce(function (s, r) { return s + r.power; }, 0) / st.rivals.length),
          money: Math.round(st.company.money), level: st.company.level, artists: st.artists.length, avgStat: avg, jobs: st.stats.jobsDone });
      }
    }
  }
  console.log("\n== 情境 " + name + "（seed " + seed + "）==");
  console.table(rows);
  return { st: st, rows: rows };
}

var idle = runScenario("idle", 101);
var auto = runScenario("auto", 202);
var active = runScenario("active", 303);

// 平衡期望（只警告）：放置不該升級太快；積極經營第 1 年不該升滿，30 年內應該達到 Lv5 以上
if (YEARS >= 30 && active.st.company.money > 20000000) warn("積極經營 30 年資金 " + active.st.company.money + "（後期資金過剩，預期 ≤ 2,000 萬）");
if (auto.rows.length > 2 && auto.rows[2].dorm < 5) warn("自動方針 10 年宿舍只到 Lv" + auto.rows[2].dorm + "（預期 ≥ 5）");
var activeWins = active.rows.reduce(function (s, r) { return s + r.wins; }, 0);
if (YEARS >= 30 && activeWins === 0) warn("積極經營 30 年從未得獎");
active.rows.forEach(function (r) { if (r.year >= 20 && r.wins > 33) warn("積極經營第 " + r.year + " 年得獎 " + r.wins + " 座（> 60%）"); });
if (YEARS >= 30 && !active.st.timeline.some(function (x) { return x.kind === "project"; })) warn("積極經營 30 年沒有完成任何大型企劃");
if (YEARS >= 30 && !active.st.hall.length) warn("積極經營 30 年沒有人進名人堂");
if (YEARS >= 30 && active.st.era < 2) warn("積極經營 30 年沒有進入第 2 紀元");
if (idle.st.company.level > 3) warn("無操作放置的公司等級 " + idle.st.company.level + "（預期 ≤ 3）");
if (active.rows[0].level >= 10) warn("積極經營第 1 年就升滿 Lv10");
if (YEARS >= 30 && active.st.company.level < 5) warn("積極經營 30 年只到 Lv" + active.st.company.level + "（預期 ≥ 5）");
if (auto.st.company.money < -500000) warn("自動方針全開的資金 " + auto.st.company.money + "（可能入不敷出）");

// 抽卡統計：100 萬次，含保底
(function gachaStats() {
  ["money", "ticket"].forEach(function (pool) {
    var st = Core.create({ seed: 999 }), n = { R: 0, SR: 0, SSR: 0 }, gap = 0, maxGap = 0, N = 1000000;
    for (var i = 0; i < N; i++) {
      var r = Core._rollRarity(st, pool);
      n[r]++;
      gap = r === "SSR" ? 0 : gap + 1;
      if (gap > maxGap) maxGap = gap;
    }
    var base = D.BAL.poolRates[pool];
    var sr = n.SR / N, ssr = n.SSR / N;
    // 含保底的 SSR 理論機率 ＝ 1 / 期望間隔；期望間隔 ＝ Σ_{k=0}^{pity-1} (1-p)^k
    // （一般試鏡 p=0.5% 時約 0.945%，星探券 p=3% 時約 3.0%）
    var expGap = 0;
    for (var k = 0; k < D.BAL.pityMax; k++) expGap += Math.pow(1 - base.SSR, k);
    var ssrExp = 1 / expGap;
    console.log("\n== 抽卡 " + pool + " ==  SR " + (sr * 100).toFixed(3) + "%  SSR " + (ssr * 100).toFixed(3) + "%（理論 " + (ssrExp * 100).toFixed(3) + "%）  最長未出 SSR " + maxGap);
    if (Math.abs(sr - base.SR) > 0.002) fail(pool + " SR 機率 " + sr + " 偏離 " + base.SR);
    if (Math.abs(ssr - ssrExp) > ssrExp * 0.1) fail(pool + " SSR 機率 " + ssr + " 偏離理論值 " + ssrExp);
    if (maxGap >= D.BAL.pityMax) fail(pool + " 保底失效：連續 " + maxGap + " 抽沒有 SSR");
  });
})();

console.log(errors ? "\n" + errors + " 個錯誤" : "\n不變量全部通過");
process.exit(errors ? 1 : 0);
