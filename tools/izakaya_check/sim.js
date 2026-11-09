// 深夜居酒屋（izakaya）30 天平衡模擬：兩種機器人（會推理的／亂選的）各跑 20 局，檢查星級與資金落在合理範圍。
// 執行：node tools/izakaya_check/sim.js
"use strict";
var fs = require("fs"), path = require("path"), assert = require("assert");
global.window = global;
global.I18N = { getLang: function () { return "zh"; }, t: function (k) { return k; } };
var SRC = path.join(__dirname, "..", "..", "static_src");
["izakaya_data.js", "izakaya_cast.js", "izakaya_story.js", "izakaya_story_main.js", "izakaya_story_arcs.js",
 "izakaya_story_staff.js", "izakaya_story_main2.js", "izakaya_story_arcs2.js", "izakaya_story_staff2.js", "izakaya_story_heart.js", "izakaya_story_truth.js", "izakaya_story_deep.js", "izakaya_story_deep_staff.js", "izakaya_story_daily.js", "izakaya_rush.js", "izakaya_core.js"].forEach(function (f) { eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8")); });
var D = window.PriTestIzakayaData, Core = window.PriTestIzakayaCore, Rush = window.PriTestIzakayaRush;

function guessScore(s, gid, id) {
  var n = s.notes[gid] || { pref: {} }, d = D.DISHES[id], sc = 0;
  if (n.taboo && d.tags.indexOf(n.taboo) >= 0) return -99;
  D.DIMS.forEach(function (k, i) { var p = n.pref[k]; if (p) sc += p.v * d.f[i]; });
  return sc;
}
function play(seed, smart, legacy) {
  var s = Core.newGame({ seed: seed, players: [{ pid: "p0", name: "bot" }], legacy: legacy }), guard = 0;
  while (s.phase !== "end" && guard++ < 20000) {
    if (s.story.cur) { Core.applyIntent(s, "p0", { a: "vote", c: 0 }); continue; }
    if (s.phase === "market") {
      var board = Object.keys(s.known).sort(function (a, b) { return D.DISHES[b].price - D.DISHES[a].price; });
      var food = board.filter(function (k) { return D.DISHES[k].cat !== "drink"; }).slice(0, 6), drink = board.filter(function (k) { return D.DISHES[k].cat === "drink"; }).slice(0, 2);
      s._want = food.concat(drink);
      s._want.forEach(function (k) { Object.keys(D.DISHES[k].ing).forEach(function (i) { while (Core.stock(s, i) < 3 && Core.applyIntent(s, "p0", { a: "buy", id: i, n: 1 })); }); });
      Core.applyIntent(s, "p0", { a: "ready", v: true });
    } else if (s.phase === "prep") {
      Core.applyIntent(s, "p0", { a: "board", ids: s._want || [] });
      Core.applyIntent(s, "p0", { a: "ready", v: true });
    } else if (s.phase === "service") {
      if (s.rush) {
        s.rush.seats.forEach(function (se) { se.items.forEach(function (it, k) { if (it.s === "wait") Core.applyIntent(s, "p0", { a: "rc", seat: se.id, k: k }); if (it.s === "ready") Core.applyIntent(s, "p0", { a: "rs", seat: se.id, k: k }); }); });
        Rush.STATIONS.forEach(function (k) { s.rush.st[k].forEach(function (sl, i) { if (sl) Core.applyIntent(s, "p0", { a: "rt", st: k, slot: i }); }); });
        Core.tick(s, 1);
        continue;
      }
      var g = Core.curGroup(s);
      if (!g) { Core.closeService(s); continue; }
      if (g.kind === "rush") { Core.applyIntent(s, "p0", { a: "rush" }); continue; }
      if (g.step === "talk") {
        var n = s.notes[g.gid], ci = smart && n && n.topic ? g.topics.indexOf(Core.guestOf(s, g).topic) : 0;
        Core.applyIntent(s, "p0", { a: "talk", c: ci < 0 ? 0 : ci });
      } else {
        var drinkStep = g.step === "drink";
        var opts = s.board.filter(function (k) { return (D.DISHES[k].cat === "drink") === drinkStep && Core.canMake(s, k); });
        if (!opts.length) { g.step = drinkStep ? "done" : "drink"; if (drinkStep) Core.pay(s, g); continue; }
        var pickD = smart ? opts.sort(function (a, b) { return guessScore(s, g.gid, b) - guessScore(s, g.gid, a); })[0] : opts[Core.rint(s, opts.length)];
        Core.applyIntent(s, "p0", { a: "serve", id: pickD });
      }
    } else Core.applyIntent(s, "p0", { a: "ready", v: true });
  }
  assert.strictEqual(s.phase, "end", "30 天要能玩完（seed " + seed + "）");
  return s;
}
var smart = [], dumb = [];
for (var i = 1; i <= 20; i++) { smart.push(play(1000 + i, true)); dumb.push(play(2000 + i, false)); }
function avg(a, f) { return a.reduce(function (t, x) { return t + f(x); }, 0) / a.length; }
var sm = avg(smart, function (s) { return s.maxStar; }), dm = avg(dumb, function (s) { return s.maxStar; });
if (process.env.IZ_UNSEEN) { var idsU = {}; smart.forEach(function (s) { Object.keys(s.story.seen).forEach(function (k) { idsU[k] = 1; }); }); console.log("沒出現過：" + window.PriTestIzakayaStory.all().filter(function (x) { return !idsU[x.id]; }).map(function (x) { return x.id; }).join(" ")); }
var seenAvg = avg(smart, function (s) { return Object.keys(s.story.seen).length; });
var ids = {}; smart.forEach(function (s) { Object.keys(s.story.seen).forEach(function (k) { ids[k] = 1; }); });
console.log("劇情：每局平均看過 " + seenAvg.toFixed(1) + " 段；20 局合計出現過 " + Object.keys(ids).length + "／" + window.PriTestIzakayaStory.all().length + " 段");
assert.ok(ids.mio_10 && ids.band_06 && ids.contest_06, "機器人至少要能看到樂團線與歌唱比賽線的結局");
// 1b：六條事件線的高潮段落都要在 30 天內觸發得到（後期到店的常客與公休日的數量是瓶頸）
["dance_06", "invest_06", "will_06", "master_06"].forEach(function (k) { assert.ok(ids[k], "1b 事件線的高潮要觸發得到：" + k); });
console.log("會推理：平均最高星 " + sm.toFixed(2) + "、資金 " + Math.round(avg(smart, function (s) { return s.cash; })));
console.log("亂選：平均最高星 " + dm.toFixed(2) + "、資金 " + Math.round(avg(dumb, function (s) { return s.cash; })));
assert.ok(sm >= 3 && sm <= 4.8, "會推理的機器人應能到 ★3〜★4.8（★5 留給認真玩的玩家）");
assert.ok(dm < sm, "亂選要比推理差");
assert.ok(smart.every(function (s) { return s.cash > 0; }), "會推理的不會破產");
// 批次 B（使用者指定 2026-11-09：不跑 3 輪以上很難串到最深處的祕密）：帶著跨局記憶連續經營，
// 真結局（secret_truth）第 1、2 年絕對到不了，第 3 年以後要到得了
var chains = [], firstTruth = [];
for (var c = 1; c <= 12; c++) {
  var leg = Core.emptyLegacy(), got = 0, ends = [];
  for (var y = 1; y <= 4 && !got; y++) {
    var sy = play(5000 + c * 10 + y, true, leg);
    ends.push(sy.end.ending);
    if (sy.story.flags.secret_truth) got = y;
    leg = Core.mergeLegacy(leg, sy);
  }
  chains.push(ends.join(">")); firstTruth.push(got);
}
console.log("多輪：" + chains.slice(0, 4).join("　") + "　…　真結局在第幾年：" + firstTruth.join(","));
assert.ok(firstTruth.every(function (y) { return y === 0 || y >= 3; }), "真結局不能在前兩年達成");
assert.ok(firstTruth.some(function (y) { return y >= 3; }), "連續經營 3〜4 年要能到達真結局");
console.log("sim OK");
