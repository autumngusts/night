// ============================================================================
// 賽狗賽狗（saigo）模擬核心與賠率的數值檢查（不開瀏覽器，直接用 Node 載入 static_src）：
//   1. 比賽中改跑法：生效前每一步不變、同一份指令結果相同、次數上限／90% 後／同跑法的指令被忽略
//   2. 賠率規則：最低 1.0 倍、0.1 倍單位捨去；彩池制複勝／寬照 JRA 算法（扣本金後由中獎組合平分利益）
//   3. 跑法平衡：中距離四種跑法（都在適性 A）平均名次差距不大
//   4. 賠率校準：用另一批獨立試跑估真實機率，每種票的期望回收率接近扣除後的回收率
// 執行：node tools/saigo_check/core_check.js（約 1〜2 分鐘）
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

global.window = global;
global.I18N = { getLang: function () { return "zh"; } };
var SRC = path.join(__dirname, "..", "..", "static_src");
["saigo_data.js", "saigo_core.js", "saigo_bet.js"].forEach(function (f) { eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8")); });
var D = window.PriTestSaigoData, Core = window.PriTestSaigoCore, Bet = window.PriTestSaigoBet;

// 1. 改跑法
var card = Core.makeCard(424242, [], { cls: "open" });
var plain = Core.simulate(card, true);
var other = card.dogs[2].style === "nige" ? "oikomi" : "nige";
var K = 400, cmd = [{ k: K, d: 2, s: other }];
var a = Core.simulate(card, true, undefined, cmd), b = Core.simulate(card, true, undefined, cmd.slice());
for (var i = 0; i < K; i++) for (var j = 0; j < plain.frames[i].length; j++) assert.strictEqual(a.frames[i][j], plain.frames[i][j], "第 " + i + " 步不一樣");
assert.strictEqual(JSON.stringify(a.times), JSON.stringify(b.times), "同一份指令結果相同");
assert.strictEqual(a.cmds.length, 1);
assert.strictEqual(a.events.filter(function (e) { return e.k === "style"; }).length, 1);
var many = Core.simulate(card, false, undefined, [{ k: 100, d: 1, s: "nige" }, { k: 200, d: 1, s: "oikomi" }, { k: 300, d: 1, s: "sashi" }, { k: 50, d: 3, s: card.dogs[3].style }]);
assert.strictEqual(many.cmds.filter(function (c) { return c.d === 1; }).length, Core.STYLE_CMD_MAX, "超過次數上限的指令被忽略");
assert.strictEqual(many.cmds.filter(function (c) { return c.d === 3; }).length, 0, "跟目前一樣的跑法不算一次");
var late = Core.simulate(card, false, undefined, [{ k: plain.frames.length - 5, d: plain.order[5], s: other }]);
assert.strictEqual(late.cmds.length, 0, "跑完 90% 之後不能改");
var shuffled = Core.simulate(card, false, undefined, [{ k: 300, d: 4, s: "nige" }, { k: 200, d: 0, s: "oikomi" }]);
var sorted = Core.simulate(card, false, undefined, [{ k: 200, d: 0, s: "oikomi" }, { k: 300, d: 4, s: "nige" }]);
assert.strictEqual(JSON.stringify(shuffled.times), JSON.stringify(sorted.times), "指令順序不影響結果（各裝置收到的順序可能不同）");
console.log("1. 改跑法 OK");

// 2. 賠率規則
var od = Core.odds(card);
D.BET_TYPES.forEach(function (bt) {
  Object.keys(od[bt.id]).forEach(function (c) {
    var v = od[bt.id][c];
    assert.ok(v >= 1.0, bt.id + " " + c + " 低於 1.0：" + v);
    assert.ok(Math.abs(v * 10 - Math.round(v * 10)) < 1e-6, "0.1 倍單位：" + v);
  });
});
assert.strictEqual(Core.oddsValue(0.5), 1.0, "元返し");
assert.strictEqual(Core.oddsValue(3.4999), 3.4, "捨去");
var pool = { place: { "0": 6000, "1": 500 }, wide: { "0-1": 3000 } }, base = 3000, order = [0, 1, 2, 3, 4, 5];
var po = Bet.poolOdds(card, pool, base, order);
(function () {
  var pr = od.prob.place, S = 0, V = base * Math.sqrt(6), T = V + 6500, amt = {};
  Object.keys(pr).forEach(function (c) { S += pr[c]; });
  Object.keys(pr).forEach(function (c) { amt[c] = V * pr[c] / S + (pool.place[c] || 0); });
  var net = T * 0.8, profit = Math.max(0, net - amt["0"] - amt["1"]);
  assert.strictEqual(po.place["0"], Core.oddsValue(1 + profit / (2 * amt["0"])), "複勝（JRA 算法）");
  assert.strictEqual(po.place["1"], Core.oddsValue(1 + profit / (2 * amt["1"])));
  assert.ok(po.place["0"] < po.place["1"], "押得多的賠率低");
  // 利益不夠分（大家都押同兩隻）＝元返し 1.0
  var heavy = Bet.poolOdds(card, { place: { "0": 500000, "1": 500000 } }, base, order);
  assert.strictEqual(heavy.place["0"], 1.0, "元返し");
  assert.ok(po.range.place["0"][0] <= po.place["0"] && po.place["0"] <= po.range.place["0"][1], "確定賠率在範圍內");
})();
assert.ok(po.wide["0-1"] >= 1.0 && po.range.wide["0-1"][0] <= po.range.wide["0-1"][1]);
console.log("2. 賠率規則 OK");

// 3. 跑法平衡（中距離）
(function () {
  var tot = {}, N = 80, S = 6;
  D.STYLE_IDS.forEach(function (s) { tot[s] = 0; });
  for (var r = 0; r < N; r++) {
    var c0 = Core.makeCard((r * 2246822519 + 7) >>> 0, [], { cls: "open", dist: "middle" });
    D.STYLE_IDS.forEach(function (s) {
      var c = JSON.parse(JSON.stringify(c0)); c.course = c0.course;
      c.dogs[0].style = s; c.dogs[0].best = s;
      for (var m = 0; m < S; m++) tot[s] += Core.simulate(c, false, (r * 977 + m * 7919 + 1) >>> 0).order.indexOf(0) + 1;
    });
  }
  var avg = D.STYLE_IDS.map(function (s) { return tot[s] / N / S; });
  console.log("   跑法平均名次（逃／先／差／追）：" + avg.map(function (x) { return x.toFixed(2); }).join(" / "));
  assert.ok(Math.max.apply(null, avg) - Math.min.apply(null, avg) < 0.35, "跑法差距過大");
})();
console.log("3. 跑法平衡 OK");

// 4. 賠率校準
(function () {
  var C = 12, T = 600, acc = {};
  D.BET_TYPES.forEach(function (bt) { acc[bt.id] = { ev: 0, n: 0 }; });
  for (var r = 0; r < C; r++) {
    var cd = Core.makeCard((r * 2654435761 + 11) >>> 0, [], { cls: ["rookie", "open", "stakes"][r % 3] });
    var o = Core.odds(cd), cnt = {};
    D.BET_TYPES.forEach(function (bt) { cnt[bt.id] = {}; });
    for (var m = 0; m < T; m++) {
      var ord = Core.simulate(cd, false, (cd.seed * 31 + 104729 * (m + 1)) >>> 0).order;
      D.BET_TYPES.forEach(function (bt) { Object.keys(o[bt.id]).forEach(function (c) { if (Bet.hit(bt.id, c, ord)) cnt[bt.id][c] = (cnt[bt.id][c] || 0) + 1; }); });
    }
    D.BET_TYPES.forEach(function (bt) { Object.keys(o[bt.id]).forEach(function (c) { acc[bt.id].ev += o[bt.id][c] * (cnt[bt.id][c] || 0) / T; acc[bt.id].n++; }); });
  }
  D.BET_TYPES.forEach(function (bt) {
    var ev = acc[bt.id].ev / acc[bt.id].n;
    console.log("   " + bt.id + "：期望回收率 " + ev.toFixed(3) + "（扣除後 " + bt.take + "）");
    assert.ok(ev < 0.95 && Math.abs(ev - bt.take) < 0.12, bt.id + " 回收率偏離：" + ev);
  });
})();
console.log("4. 賠率校準 OK");
console.log("saigo core_check OK");
