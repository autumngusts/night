// ============================================================================
// 賽狗賽狗（saigo）模擬核心與賠率的數值檢查（不開瀏覽器，直接用 Node 載入 static_src）：
//   1. 開跑後不能改跑法（指令無效）；真賽狗的喊聲：確定性、次數／間隔上限、成功率
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
["saigo_data.js", "saigo_skills.js", "saigo_core.js", "saigo_real.js", "saigo_bet.js", "saigo_kennel.js"].forEach(function (f) { eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8")); });
var D = window.PriTestSaigoData, Core = window.PriTestSaigoCore, Bet = window.PriTestSaigoBet, Real = window.PriTestSaigoReal, SK = window.PriTestSaigoSkills;

// 1. 開跑後不能改跑法（改跑法指令一律無效）；真賽狗的喊聲：生效前每一步不變、同一份指令結果相同、次數與間隔上限
var card = Core.makeCard(424242, [], { cls: "open" });
var plain = Core.simulate(card, true);
var styled = Core.simulate(card, true, undefined, [{ k: 300, d: 2, s: "nige" }, { k: 300, d: 3, s: "oikomi" }]);
assert.strictEqual(JSON.stringify(styled.times), JSON.stringify(plain.times), "關卡賽：改跑法指令無效");
var rc = Core.makeCard(777, [], { mode: "real", cls: "open", dist: "middle" });
var rp = Core.simulate(rc, true);
var rs = Core.simulate(rc, true, undefined, [{ k: 200, d: 1, s: "oikomi" }]);
assert.strictEqual(JSON.stringify(rs.times), JSON.stringify(rp.times), "真賽狗：改跑法指令無效");
var K = 200, sc = [{ k: K, d: 2, a: "shout" }];
var a = Core.simulate(rc, true, undefined, sc), b = Core.simulate(rc, true, undefined, sc.slice());
for (var i = 0; i < K; i++) for (var j = 0; j < rp.frames[i].length; j++) assert.strictEqual(a.frames[i][j], rp.frames[i][j], "第 " + i + " 步不一樣");
assert.strictEqual(JSON.stringify(a.times), JSON.stringify(b.times), "同一份指令結果相同");
assert.strictEqual(a.cmds.length, 1);
var many = Core.simulate(rc, false, undefined, [{ k: 100, d: 1, a: "shout" }, { k: 110, d: 1, a: "shout" }, { k: 150, d: 1, a: "shout" }]);
assert.strictEqual(many.cmds.length, 2, "喊聲間隔 2 秒（40 步）");
var lots = [];
for (var q = 0; q < 12; q++) lots.push({ k: 60 + q * 45, d: 4, a: "shout" });
assert.strictEqual(Core.simulate(rc, false, undefined, lots).cmds.length, Real.SHOUT_MAX, "每場喊聲上限");
var hits = 0;
for (var z = 0; z < 2000; z++) if (Real.shoutHits(rc, z, z % 8)) hits++;
assert.ok(hits > 2000 * Real.SHOUT_P * 0.8 && hits < 2000 * Real.SHOUT_P * 1.2, "喊聲成功率約 " + Real.SHOUT_P + "：" + hits / 2000);
console.log("1. 跑法鎖定／喊聲 OK");

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

// 5. 真賽狗（2026-11-02 第二版：關卡賽的地圖＋搶道）
//    出賽表用關卡地圖、8 隻都跑完、關卡裡同一位置不重疊、三種跑線平均名次接近、賠率校準
(function () {
  var races = 120, lineRank = { rail: [0, 0], mid: [0, 0], wide: [0, 0] }, overlaps = 0, stationSteps = 0, boxed = 0, bumps = 0;
  for (var s = 0; s < races; s++) {
    var cd = Core.makeCard((s * 2246822519 + 7) >>> 0, [], { mode: "real", cls: ["rookie", "open", "stakes"][s % 3] });
    assert.ok(cd.course && cd.course.parts.length >= 5, "真賽狗用關卡賽的地圖");
    assert.strictEqual(cd.dogs.length, 8, "真賽狗 8 隻");
    var res = Core.simulate(cd, true);
    assert.ok(res.real && res.crowd && res.frames[0].length === 32, "frames 每隻 4 格");
    assert.ok(res.times.every(function (x) { return x !== null; }), "8 隻都跑完：" + cd.seed);
    res.events.forEach(function (e) { if (e.k === "boxed") boxed++; if (e.k === "bump") bumps++; });
    // 關卡裡（非直道／彎道）同一位置的兩隻狗不能重疊
    for (var k = 0; k < res.frames.length; k += 4) {
      var f = res.frames[k];
      for (var a = 0; a < 8; a++) {
        var pa = Core.partAt(cd.course, Math.min(f[a * 4], cd.course.length - 0.01));
        if (pa.type === "straight" || pa.type === "curve" || f[a * 4] >= cd.course.length) continue;
        stationSteps++;
        for (var b = 0; b < 8; b++) {
          if (b === a || f[b * 4] >= cd.course.length) continue;
          var ds = f[a * 4] - f[b * 4], dx = f[a * 4 + 1] - f[b * 4 + 1];
          if (ds > -0.9 && ds < 0.9 && dx > -0.6 && dx < 0.6) { overlaps++; break; }
        }
      }
    }
  }
  console.log("   每場：卡位 " + (boxed / races).toFixed(1) + " 次、碰撞 " + (bumps / races).toFixed(1) + " 次；關卡內重疊 " + overlaps + "／" + stationSteps);
  assert.ok(boxed > 0 && bumps > 0, "有搶道（卡位、碰撞）");
  assert.ok(overlaps / Math.max(1, stationSteps) < 0.005, "關卡裡同一位置不重疊");
  // 跑線平衡：樣本少時誤差大（120 場相差可達 0.4），用 600 場不記錄畫面的試跑
  for (var s2 = 0; s2 < 600; s2++) {
    var lc = Core.makeCard((s2 * 2654435761 + 99) >>> 0, [], { mode: "real", cls: ["rookie", "open", "stakes"][s2 % 3] });
    Core.simulate(lc, false).order.forEach(function (d, rk) { var l = lc.dogs[d].line; lineRank[l][0] += rk + 1; lineRank[l][1]++; });
  }
  var lr = Object.keys(lineRank).map(function (l) { return lineRank[l][0] / lineRank[l][1]; });
  console.log("   跑線平均名次（內欄／中間／外側）：" + lr.map(function (x) { return x.toFixed(2); }).join(" / "));
  assert.ok(Math.max.apply(null, lr) - Math.min.apply(null, lr) < 0.35, "三種跑線平均名次接近");

  var C = 8, T = 300, acc = {};
  D.BET_TYPES.forEach(function (bt) { acc[bt.id] = { ev: 0, n: 0 }; });
  for (var r = 0; r < C; r++) {
    var rc2 = Core.makeCard((r * 2654435761 + 23) >>> 0, [], { mode: "real", cls: ["rookie", "open", "stakes"][r % 3] });
    var o = Core.odds(rc2), cnt = {};
    D.BET_TYPES.forEach(function (bt) { cnt[bt.id] = {}; });
    for (var m = 0; m < T; m++) {
      var ord = Core.simulate(rc2, false, (rc2.seed * 31 + 104729 * (m + 1)) >>> 0).order;
      D.BET_TYPES.forEach(function (bt) { Object.keys(o[bt.id]).forEach(function (c) { if (Bet.hit(bt.id, c, ord)) cnt[bt.id][c] = (cnt[bt.id][c] || 0) + 1; }); });
    }
    D.BET_TYPES.forEach(function (bt) { Object.keys(o[bt.id]).forEach(function (c) { acc[bt.id].ev += o[bt.id][c] * (cnt[bt.id][c] || 0) / T; acc[bt.id].n++; }); });
  }
  D.BET_TYPES.forEach(function (bt) {
    var ev = acc[bt.id].ev / acc[bt.id].n;
    console.log("   真賽狗 " + bt.id + "：期望回收率 " + ev.toFixed(3) + "（扣除後 " + bt.take + "）");
    assert.ok(ev < 0.98 && Math.abs(ev - bt.take) < 0.15, "真賽狗 " + bt.id + " 回收率偏離：" + ev);
  });
})();
console.log("5. 真賽狗（關卡地圖＋搶道）OK");
console.log("saigo core_check OK");
