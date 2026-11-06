// ============================================================================
// 賽狗賽狗（saigo）生涯養成的平衡模擬（2026-11-05，不開瀏覽器）：
//   「自動玩家」用固定策略跑 N 趟生涯，量畢業能力、評分分布、目標賽達成率、失敗／受傷次數、技能數，
//   並和「犬舍領養＋20 次訓練」的狗比較能力總量與各賽事等級的勝率。
// 自動玩家的策略：受傷或體力 < 45 就休息（調子 ≤ 1 時改外出）；目標賽前一回合體力 < 70 也休息；
//   其他回合訓練（依 速度 3／耐力 2／力量 1.5／敏捷 1／技巧 0.6 ÷（1＋該能力已練 ÷ 20）× 訓練等級 挑，有一點隨機）；
//   每 4 回合跑一場自選比賽；技能點夠就買（金 → 罕見 → 一般）；二選一事件一律選第 1 個。
// 執行：node tools/saigo_check/career_sim.js [趟數=500]
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
global.window = global;
global.I18N = { getLang: function () { return "zh"; } };
var SRC = path.join(__dirname, "..", "..", "static_src");
["saigo_data.js", "saigo_skills.js", "saigo_core.js", "saigo_real.js", "saigo_lineage.js", "saigo_career.js"].forEach(function (f) { eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8")); });
var D = window.PriTestSaigoData, Core = window.PriTestSaigoCore, CR = window.PriTestSaigoCareer, SK = window.PriTestSaigoSkills;

var N = Number(process.argv[2]) || 500;
// 第 2 個參數＝休息門檻（預設 45；調低＝不太休息的貪心玩家，用來確認失敗與受傷的風險）
var REST_AT = Number(process.argv[3]) || 45;
var BREEDS = ["border", "greyhound", "shiba", "husky", "corgi", "doberman", "formosan", "golden", "whippet", "mix"];
var W = { speed: 3, stamina: 2, power: 1.5, agility: 1, skill: 0.6 };

function runRace(c) {
  var st = CR.raceSetup(c);
  var card = Core.makeCard(st.seed, [st.entry], { cls: st.cls });
  var gate = card.dogs.map(function (d) { return d.owner; }).indexOf("me");
  var place = Core.simulate(card, false).order.indexOf(gate);
  return CR.applyRace(c, place);
}
function buySkills(c) {
  var bought = true;
  while (bought) {
    bought = false;
    var list = CR.shop(c).filter(function (x) { return x.can; }).sort(function (a, b) { return b.price - a.price; });
    if (list.length && CR.learn(c, list[0].id)) bought = true;
  }
}
function autoCareer(breed, seed, parents) {
  var c = CR.create({ breed: breed, name: "auto", seed: seed, parents: parents }), rnd = Core.rng((seed ^ 0xa070) >>> 0);
  var stat = { fail: 0, injured: 0, events: 0, races: 0 };
  var guard = 0;
  while (!c.done && guard++ < 100) {
    if (c.pending) { CR.choose(c, 0); continue; }
    var res, g = CR.goalNow(c), nextGoal = CR.goalAt(c.turn + 1);
    if (g) res = runRace(c);
    else if (c.injured || c.energy < REST_AT || (nextGoal && c.energy < 70)) res = c.mood <= 1 ? CR.outing(c) : CR.rest(c);
    else if (c.turn % 4 === 2 && c.energy >= 60) res = runRace(c);
    else {
      var best = null, bs = -1;
      // 練得越多的能力越不急著練（像真人會輪著練），訓練等級高的稍微優先
      CR.TRAIN_IDS.forEach(function (k) { var sc = W[k] / (1 + Math.max(0, c.train[CR.TRAINS[k].main]) / 20) * (1 + (c.fac[k] - 1) * 0.15) * (0.85 + rnd() * 0.3); if (sc > bs) { bs = sc; best = k; } });
      res = CR.train(c, best);
    }
    if (res && res.fail) stat.fail++;
    if (res && res.injured) stat.injured++;
    if (res && res.event) stat.events++;
    if (res && res.act === "race") stat.races++;
    buySkills(c);
  }
  return { c: c, stat: stat };
}
// 犬舍的狗：20 次訓練（主 +4、次 +1.5，心情普通），把速度、耐力各練約 10 次
function kennelDog(breed) {
  var train = {};
  D.STATS.forEach(function (k) { train[k] = 0; });
  for (var i = 0; i < 10; i++) { train.spd += 4; train.pow += 1.5; }
  for (var j = 0; j < 10; j++) { train.sta += 4; train.spd += 1.5; }
  D.STATS.forEach(function (k) { train[k] = Math.min(40, train[k]); });
  return { breed: breed, name: "kennel", best: D.BREED_BY_ID[breed].style, train: train, lv: 6, mood: 2, owner: "me", skills: [] };
}
function winRate(entry, cls, n, seed0) {
  var w = 0, t3 = 0;
  for (var i = 0; i < n; i++) {
    var card = Core.makeCard((seed0 + i * 7919) >>> 0, [entry], { cls: cls });
    var gate = card.dogs.map(function (d) { return d.owner; }).indexOf("me"), pl = Core.simulate(card, false).order.indexOf(gate);
    if (pl === 0) w++;
    if (pl < 3) t3++;
  }
  return { win: w / n, top3: t3 / n };
}
function sum(o) { var s = 0; D.STATS.forEach(function (k) { s += o[k] || 0; }); return s; }
function pct(x) { return (x * 100).toFixed(1) + "%"; }

var t0 = Date.now(), runs = [], grades = {}, goalOk = [0, 0, 0], goalTry = [0, 0, 0], tot = { fail: 0, injured: 0, events: 0, races: 0, skills: 0, train: 0, lv: 0, sp: 0 };
var perStat = {};
D.STATS.forEach(function (k) { perStat[k] = 0; });
for (var i = 0; i < N; i++) {
  var r = autoCareer(BREEDS[i % BREEDS.length], (i * 2654435761) >>> 0), c = r.c;
  runs.push(r);
  var rt = CR.rating(c);
  grades[rt.grade] = (grades[rt.grade] || 0) + 1;
  c.goals.forEach(function (ok, gi) { goalTry[gi]++; if (ok) goalOk[gi]++; });
  ["fail", "injured", "events", "races"].forEach(function (k) { tot[k] += r.stat[k]; });
  tot.skills += c.skills.length; tot.train += sum(c.train); tot.lv += c.lv; tot.sp += c.sp;
  D.STATS.forEach(function (k) { perStat[k] += c.train[k]; });
}
console.log("生涯 " + N + " 趟（休息門檻 " + REST_AT + "，" + ((Date.now() - t0) / 1000).toFixed(1) + " 秒）");
console.log("  訓練加成合計（平均）：" + (tot.train / N).toFixed(1) + "　各項：" + D.STATS.map(function (k) { return k + " " + (perStat[k] / N).toFixed(1); }).join("、"));
console.log("  等級 " + (tot.lv / N).toFixed(1) + "、技能 " + (tot.skills / N).toFixed(2) + " 個、剩餘技能點 " + (tot.sp / N).toFixed(0));
console.log("  每趟：失敗 " + (tot.fail / N).toFixed(2) + "、受傷 " + (tot.injured / N).toFixed(2) + "、事件 " + (tot.events / N).toFixed(1) + "、比賽 " + (tot.races / N).toFixed(1));
console.log("  目標賽：" + CR.GOALS.map(function (g, gi) { return "第 " + g.turn + " 回合 " + g.cls + " 前 " + g.place + " 名 " + (goalTry[gi] ? pct(goalOk[gi] / goalTry[gi]) : "-") + "（" + goalTry[gi] + " 次）"; }).join("　"));
console.log("  全部達成：" + pct(runs.filter(function (r) { return r.c.goals.length === 3 && r.c.goals.every(Boolean); }).length / N));
console.log("  評分分布：" + ["SS", "S", "A+", "A", "B+", "B", "C+", "C", "D", "E", "G"].filter(function (g) { return grades[g]; }).map(function (g) { return g + " " + pct(grades[g] / N); }).join("、"));

// 和犬舍的狗比較（同一批犬種）：能力總量、各等級勝率
var kTrain = sum(kennelDog("border").train);
console.log("犬舍 20 次訓練的狗：訓練加成合計 " + kTrain + "（生涯／犬舍＝" + (tot.train / N / kTrain).toFixed(2) + " 倍）");
var M = 40;
["rookie", "open", "stakes"].forEach(function (cls) {
  var kw = 0, kt = 0, cw = 0, ct = 0, bw = 0, bt = 0;
  BREEDS.forEach(function (b, bi) {
    var k = winRate(kennelDog(b), cls, M, 1000 + bi);
    kw += k.win; kt += k.top3;
    var grad = runs.filter(function (r) { return r.c.breed === b && r.c.done && r.c.failed < 0; })[0] || runs.filter(function (r) { return r.c.breed === b; })[0];
    var e = CR.entry(grad.c);
    var g = winRate(e, cls, M, 1000 + bi);
    cw += g.win; ct += g.top3;
    // 畢業後在犬舍出賽（帶 career 旗標）：關卡賽的 CPU 會依它補強（2026-11-05 使用者選 B）
    e.career = 1;
    var gb = winRate(e, cls, M, 1000 + bi);
    bw += gb.win; bt += gb.top3;
  });
  var n = BREEDS.length;
  console.log("  " + cls + "：犬舍狗 勝率 " + pct(kw / n) + "／前三 " + pct(kt / n) + "　生涯中（CPU 不補強） 勝率 " + pct(cw / n) + "／前三 " + pct(ct / n) + "　畢業後（CPU 補強） 勝率 " + pct(bw / n) + "／前三 " + pct(bt / n));
});

// ---- 血統繼承（2026-11-06）：第 1 代的畢業狗當祖先跑第 2 代，第 2 代再當祖先跑第 3 代（有祖父母） ----
var LN = window.PriTestSaigoLineage;
function toRec(r) {
  var g = CR.graduate(r.c);
  return { name: "g", breed: g.breed, best: g.best, factors: g.factors, parents: g.parents };
}
function generation(prev, label) {
  var out = [], tr = 0, ok = 0, all3 = 0, apt = 0, inh = 0, start = 0;
  for (var i = 0; i < N; i++) {
    var a = prev[(i * 7) % prev.length], b = prev[(i * 13 + 5) % prev.length];
    var r = autoCareer(BREEDS[i % BREEDS.length], (i * 2246822519 + 77) >>> 0, [toRec(a), toRec(b)]);
    out.push(r);
    tr += sum(r.c.train);
    if (r.c.goals.length === 3 && r.c.goals.every(Boolean)) all3++;
    if (Object.keys(r.c.aptUp || {}).length) apt++;
    r.c.inheritLog.forEach(function (x) { inh += x.procs.length; });
    start += sum(LN.startBonus(LN.sources([toRec(a), toRec(b)])).bonus);
  }
  console.log(label + "：訓練加成合計 " + (tr / N).toFixed(1) + "（開始時加成 " + (start / N).toFixed(1) + "、繼承事件觸發 " + (inh / N).toFixed(1) + " 次）、3 場目標全部達成 " + pct(all3 / N) + "、跑法適性提高 " + pct(apt / N));
  return out;
}
var g2 = generation(runs, "第 2 代（父母）");
generation(g2, "第 3 代（父母＋祖父母）");
