// ============================================================================
// 賽狗賽狗（saigo）模擬核心與賠率的數值檢查（不開瀏覽器，直接用 Node 載入 static_src）：
//   1. 開跑後不能改跑法（指令無效）；真賽狗的喊聲：確定性、次數／間隔上限、成功率
//   2. 賠率規則：最低 1.0 倍、0.1 倍單位捨去；彩池制複勝／寬照 JRA 算法（扣本金後由中獎組合平分利益）
//   3. 跑法平衡：中距離四種跑法（都在適性 A）平均名次差距不大
//   4. 賠率校準：用另一批獨立試跑估真實機率，每種票的期望回收率接近扣除後的回收率
//   5. 真賽狗（關卡地圖＋搶道）
//   6. 真賽狗關閉關卡障礙（2026-11-03）：只有直道／彎道、8 隻跑完、有搶道；開啟時後方的狗會改排關卡的別道
//   7. 技能期限（2026-11-03）：技能跟著技能池 30 分鐘過期，過期的不帶進出賽資料，學同階新技能時替換
//   8. 暴衝／對決／照片判定（2026-11-05）：Core.preRace 與正式比賽一致、頻率、暴衝是懲罰、看板確定性
//   9. WIN5 與冠軍大會的純計算、宿敵王牌狗的實力、粉絲與重賞賽程（2026-11-05）
//   10. 生涯養成的計算核心（2026-11-05）：確定性、失敗率、目標賽沒達成就結束、二選一事件、技能商店、畢業資料
//       （平衡數字另外用 tools/saigo_check/career_sim.js 量）
// 執行：node tools/saigo_check/core_check.js（約 1〜2 分鐘）
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

global.window = global;
global.I18N = { getLang: function () { return "zh"; } };
var SRC = path.join(__dirname, "..", "..", "static_src");
["saigo_data.js", "saigo_skills.js", "saigo_core.js", "saigo_real.js", "saigo_bet.js", "saigo_kennel.js", "saigo_press.js", "saigo_league.js", "saigo_cup.js", "saigo_career.js"].forEach(function (f) { eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8")); });
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
  var races = 120, lineRank = { rail: [0, 0], mid: [0, 0], wide: [0, 0] }, overlaps = 0, stationSteps = 0, boxed = 0, bumps = 0, queues = 0;
  for (var s = 0; s < races; s++) {
    var cd = Core.makeCard((s * 2246822519 + 7) >>> 0, [], { mode: "real", cls: ["rookie", "open", "stakes"][s % 3] });
    assert.ok(cd.course && cd.course.parts.length >= 5, "真賽狗用關卡賽的地圖");
    assert.strictEqual(cd.dogs.length, 8, "真賽狗 8 隻");
    var res = Core.simulate(cd, true);
    assert.ok(res.real && res.crowd && res.frames[0].length === 32, "frames 每隻 4 格");
    assert.ok(res.times.every(function (x) { return x !== null; }), "8 隻都跑完：" + cd.seed);
    res.events.forEach(function (e) { if (e.k === "boxed") boxed++; if (e.k === "bump") bumps++; if (e.k === "queue") queues++; });
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
  console.log("   每場：卡位 " + (boxed / races).toFixed(1) + " 次、碰撞 " + (bumps / races).toFixed(1) + " 次、後方改排關卡別道 " + (queues / races).toFixed(1) + " 次；關卡內重疊 " + overlaps + "／" + stationSteps);
  assert.ok(boxed > 0 && bumps > 0, "有搶道（卡位、碰撞）");
  assert.ok(queues > 0, "後方的狗會改排關卡的別道");
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

// 6. 關閉關卡障礙：只有直道／彎道（長度接近障礙賽道）、8 隻跑完、有搶道；同 seed 開啟時仍是障礙賽道
(function () {
  var lens = { sprint: [], middle: [], long: [] }, boxed = 0, bumps = 0;
  for (var s = 0; s < 90; s++) {
    var dist = ["sprint", "middle", "long"][s % 3];
    var cd = Core.makeCard((s * 2246822519 + 11) >>> 0, [], { mode: "real", cls: "open", dist: dist, obstacles: false });
    assert.ok(cd.noObs && cd.course.flat, "出賽表標記無障礙");
    assert.ok(cd.course.parts.every(function (p) { return p.type === "straight" || p.type === "curve"; }), "無障礙＝只有直道／彎道");
    lens[dist].push(cd.course.length);
    var res = Core.simulate(cd, true);
    assert.ok(res.times.every(function (x) { return x !== null; }), "無障礙 8 隻都跑完：" + cd.seed);
    assert.strictEqual(JSON.stringify(Core.simulate(cd, false).order), JSON.stringify(res.order), "無障礙模擬確定性");
    res.events.forEach(function (e) { if (e.k === "boxed") boxed++; if (e.k === "bump") bumps++; });
  }
  var on = Core.makeCard(31337, [], { mode: "real", cls: "open" });
  assert.ok(!on.noObs && on.course.parts.some(function (p) { return p.type !== "straight" && p.type !== "curve"; }), "預設（開啟）仍是障礙賽道");
  Object.keys(lens).forEach(function (k) {
    var a = lens[k].reduce(function (x, y) { return x + y; }, 0) / lens[k].length;
    console.log("   無障礙 " + k + " 平均長度 " + Math.round(a) + "m");
  });
  console.log("   無障礙每場：卡位 " + (boxed / 90).toFixed(1) + " 次、碰撞 " + (bumps / 90).toFixed(1) + " 次");
  assert.ok(boxed > 0 && bumps > 0, "無障礙也有搶道");
})();
console.log("6. 關卡障礙開關 OK");

// 7. 技能期限：用假的 localStorage 與時鐘
(function () {
  var mem = {}, realNow = Date.now, clock = realNow();
  global.localStorage = { getItem: function (k) { return mem[k] || null; }, setItem: function (k, v) { mem[k] = String(v); } };
  Date.now = function () { return clock; };
  try {
    var Kn = window.PriTestSaigoKennel;
    var d = Kn.adopt("shiba", "テスト");
    Kn.train(d.id, "sprint");
    var pool = Kn.pool(), g = pool.ids.filter(function (id) { return SK.BY_ID[id].tier === "g"; });
    assert.strictEqual(Kn.learn(d.id, g[0]), "ok");
    assert.deepStrictEqual(Kn.entry(d.id).skills, [g[0]], "期限內帶進出賽資料");
    clock += SK.POOL_TTL_MS + 1000;
    assert.strictEqual(Kn.pool(), null, "30 分鐘後技能池消失");
    assert.deepStrictEqual(Kn.entry(d.id).skills, [], "過期的技能不帶進出賽資料");
    assert.deepStrictEqual(Kn.expiredSkillsOf(Kn.dog(d.id)), [g[0]], "過期技能仍顯示在欄位");
    assert.strictEqual(Kn.rating(Kn.dog(d.id)).skill, 0, "過期技能不算評分");
    Kn.train(d.id, "sprint");
    var g2 = Kn.pool().ids.filter(function (id) { return SK.BY_ID[id].tier === "g" && id !== g[0]; })[0];
    assert.strictEqual(Kn.learn(d.id, g2), "replaced", "學同階新技能時替換過期的");
    assert.deepStrictEqual(Kn.dog(d.id).skills, [g2], "金欄位只剩新技能");
    assert.deepStrictEqual(Kn.entry(d.id).skills, [g2]);
    // 舊資料（沒有期限記錄）視為已過期
    Kn.dog(d.id).skills.push("n_corner");
    assert.ok(Kn.entry(d.id).skills.indexOf("n_corner") < 0, "沒有期限記錄的舊技能視為過期");
  } finally { Date.now = realNow; delete global.localStorage; }
})();
console.log("7. 技能期限 OK");

// 8. 暴衝／對決／照片判定
(function () {
  var N = 150, kk = 0, duel = 0, photo = 0, match = 0, pre = 0;
  for (var s = 1; s <= N; s++) {
    var c = Core.makeCard(s * 7919, [], s % 2 ? { cls: "open" } : { mode: "real", cls: "open" });
    var r = Core.simulate(c, true), pr = Core.preRace(c), hit = {};
    r.events.forEach(function (e) { if (e.k === "kakari") { kk++; hit[e.d] = 1; } if (e.k === "duel") duel++; });
    pr.forEach(function (p, i) { if (p.kakari) { pre++; if (hit[i]) match++; } });
    if (r.photo) { photo++; assert.ok(r.times[r.photo.b] - r.times[r.photo.a] < Core.PHOTO_GAP + 1e-9, "照片判定的差距"); assert.strictEqual(r.photo.a, r.order[0]); }
    var r2 = Core.simulate(c, false);
    assert.strictEqual(JSON.stringify(r2.order), JSON.stringify(r.order), "記錄與否結果相同");
  }
  assert.strictEqual(match, pre, "preRace 的暴衝＝正式比賽的暴衝");
  console.log("   每場：暴衝 " + (kk / N).toFixed(2) + " 次、對決 " + (duel / N).toFixed(2) + " 次、照片判定 " + (photo / N * 100).toFixed(1) + "%");
  assert.ok(kk / N > 0.3 && kk / N < 1.2, "暴衝頻率");
  assert.ok(duel / N > 0.4 && duel / N < 2, "對決頻率");
  assert.ok(photo > 0 && photo / N < 0.2, "照片判定頻率");
  assert.strictEqual(Core.marginKind(0.005, 15), "nose");
  assert.strictEqual(Core.marginKind(0.03, 15), "neck");
  assert.strictEqual(Core.marginKind(0.2, 15), "");
  // 看板與報紙：同一張出賽表結果相同
  var c1 = Core.makeCard(99, [], { cls: "open" }), c2 = Core.makeCard(99, [], { cls: "open" }), P = window.PriTestSaigoPress;
  assert.strictEqual(JSON.stringify(P.paddock(c1)), JSON.stringify(P.paddock(c2)));
  assert.strictEqual(JSON.stringify(P.marks(c1)), JSON.stringify(P.marks(c2)));
  P.REPORTERS.forEach(function (rp) { assert.strictEqual(P.marks(c1)[rp.id].filter(function (m) { return m === "◎"; }).length, 1, rp.id + " 只有一個 ◎"); });
  var pop = Core.popularity(c1);
  assert.ok(pop[P.honmei(c1, "ana")] > 2, "穴派的 ◎ 不給人氣前 2 名");
})();
console.log("8. 暴衝／對決／照片判定／賽前情報 OK");

// 9. WIN5／冠軍大會／宿敵／粉絲
(function () {
  var Cp = window.PriTestSaigoCup, Lg = window.PriTestSaigoLeague;
  // WIN5
  var res = { 1: 0, 2: 3, 3: 1, 4: 5, 5: 2 };
  var st = Cp.w5Settle({ a: { picks: { 1: 0, 2: 3, 3: 1, 4: 5, 5: 2 } }, b: { picks: { 1: 0, 2: 3, 3: 1, 4: 5, 5: 4 } }, c: { picks: { 1: 0, 2: 3, 3: 1, 4: 5, 5: 2 } } }, res, 100);
  assert.deepStrictEqual(st.winners, ["a", "c"]);
  assert.strictEqual(st.pot, 100 + 2100);
  assert.strictEqual(st.pay, 1100); assert.strictEqual(st.carry, 0);
  var none = Cp.w5Settle({ a: { picks: { 1: 1 } } }, res, 0);
  assert.strictEqual(none.carry, 700, "沒人中＝整筆累積");
  assert.deepStrictEqual(Cp.w5NextLeg(null), { ser: 1, leg: 1, fresh: true });
  assert.deepStrictEqual(Cp.w5NextLeg({ ser: 1, leg: 2, res: { 1: 0 } }), { ser: 1, leg: 2, fresh: false }, "上一場還沒跑＝同一場");
  assert.deepStrictEqual(Cp.w5NextLeg({ ser: 1, leg: 2, res: { 1: 0, 2: 4 } }), { ser: 1, leg: 3, fresh: false });
  assert.deepStrictEqual(Cp.w5NextLeg({ ser: 1, leg: 5, res: [null, 0, 1, 2, 3, 4] }), { ser: 2, leg: 1, fresh: true }, "Firebase 把數字鍵存成陣列也能讀");
  // 冠軍大會：關卡賽 6 隻
  ["classic", "real"].forEach(function (mode) {
    var cf = Cp.conf(mode), mk = function (n) { var l = []; for (var i = 0; i < n; i++) l.push({ breed: "shiba", name: n + "-" + i, train: {}, lv: 1, owner: "p" + n, ownerName: "P" + n, dogId: "d" + i }); return l; };
    var cup = Cp.start("c1", mode, "open", [mk(1), mk(2), mk(3)]);
    assert.strictEqual(cup.h1.length + cup.h2.length, 6, "6 隻玩家的狗分兩組");
    var stages = [];
    while (cup.stage !== "done") {
      var es = Cp.entriesFor(cup), card = Core.makeCard(31 * (stages.length + 1), es, mode === "real" ? { mode: "real", cls: "open" } : { cls: "open" });
      assert.strictEqual(card.dogs.length, cf.field);
      es.forEach(function (e) { assert.ok(card.dogs.some(function (d) { return d.name === e.name; }), cup.stage + " 有 " + e.name); });
      if (cup.stage === "rep") assert.strictEqual(es.length, cf.rep * 2);
      if (cup.stage === "final") assert.strictEqual(es.length, cf.field, "決賽剛好滿");
      var r = Core.simulate(card, false);
      stages.push(cup.stage);
      var nx = Cp.advance(cup, card, r.order);
      if (cup.stage === "final") assert.strictEqual(nx.champ.name, card.dogs[r.order[0]].name);
      cup = nx;
    }
    assert.deepStrictEqual(stages, ["h1", "h2", "rep", "final"]);
  });
  // 宿敵與粉絲（假的 localStorage）
  var mem = {};
  global.localStorage = { getItem: function (k) { return mem[k] || null; }, setItem: function (k, v) { mem[k] = String(v); } };
  try {
    var Kn = window.PriTestSaigoKennel;
    var d = Kn.adopt("border", "測");
    var e = Kn.entry(d.id, "me", "");
    var re = Lg.rivalEntry("ginga", [e]), RL = window.PriTestSaigoReal;
    var sp = RL.strength(e.breed, e.train, e.lv), sr = RL.strength(re.breed, re.train, re.lv);
    assert.ok(Math.abs(sr - sp) < 2.5, "宿敵實力貼近玩家（" + sp.toFixed(1) + " / " + sr.toFixed(1) + "）");
    assert.ok(re.train.spd > re.train.agi, "銀河流星擅長速度");
    assert.ok(Lg.canEnter([d.id], Lg.STAKES[0]) && !Lg.canEnter([d.id], Lg.STAKES[2]), "粉絲門檻");
    var card = Core.makeCard(5, [e, re], { cls: "stakes", terrain: "park", dist: "sprint" });
    card.stakes = { id: "spring", grade: "G3", season: 1 };
    var gi = card.dogs.map(function (x) { return x.name; }).indexOf("測"), ri = card.dogs.map(function (x) { return x.rival || ""; }).indexOf("ginga");
    var order = [gi, ri].concat(card.dogs.map(function (x, i) { return i; }).filter(function (i) { return i !== gi && i !== ri; }));
    var out = Lg.afterRace(card, order, [{ dogId: d.id, place: 0 }], false);
    assert.strictEqual(out.fans[0].gain, 300 * 6, "G3 冠軍粉絲 300 × 6");
    assert.ok(out.title && out.rivals[0].beat, "得到稱號、贏過宿敵");
    assert.strictEqual(Lg.state().week, 1, "重賞賽程前進");
    assert.strictEqual(Lg.state().rv.ginga.grow, 1, "宿敵輸了會變強");
    assert.ok(Lg.RIVALS.every(function (r) { return r.skills.length === 5 && SK.sanitize(r.skills).length === 5; }), "宿敵技能都有效");
  } finally { delete global.localStorage; }
})();
console.log("9. WIN5／冠軍大會／宿敵／粉絲 OK");

// 10. 生涯養成
(function () {
  var CR = window.PriTestSaigoCareer;
  function play(seed) {
    var c = CR.create({ breed: "border", name: "測", seed: seed }), g = 0;
    while (!c.done && g++ < 100) {
      if (c.pending) { CR.choose(c, 1); continue; }
      if (CR.goalNow(c) || c.turn % 5 === 0) {
        var st = CR.raceSetup(c), card = Core.makeCard(st.seed, [st.entry], { cls: st.cls });
        CR.applyRace(c, Core.simulate(card, false).order.indexOf(card.dogs.map(function (d) { return d.owner; }).indexOf("me")));
      } else if (c.energy < 40 || c.injured) CR.rest(c);
      else CR.train(c, CR.TRAIN_IDS[c.turn % 5]);
    }
    return c;
  }
  var a = play(12345), b = play(12345);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b), "同一個 seed、同樣的選擇＝同樣的生涯");
  assert.ok(a.done && a.turn <= CR.TURNS);
  // 失敗率邊界
  var c = CR.create({ breed: "shiba", seed: 1 });
  c.energy = 50; assert.strictEqual(CR.failRate(c), 0);
  c.energy = 0; assert.strictEqual(CR.failRate(c), 0.4);
  c.energy = 25; assert.ok(Math.abs(CR.failRate(c) - 0.2) < 1e-9);
  // 目標賽：第 8 回合跑第 4 名＝沒達成，生涯結束
  c = CR.create({ breed: "shiba", seed: 2 }); c.turn = 8; c.energy = 100;
  assert.ok(!CR.train(c, "speed"), "目標賽回合不能訓練");
  CR.applyRace(c, 3);
  assert.ok(c.done && c.failed === 0 && c.goals[0] === false);
  assert.ok(CR.graduate(c).career.failed === 0, "沒達成也能畢業");
  c = CR.create({ breed: "shiba", seed: 3 }); c.turn = 8;
  CR.applyRace(c, 2);
  assert.ok(!c.done && c.goals[0] === true && (c.turn === 9 || c.pending), "前 3 名＝達成");
  // 受傷：不能訓練、休息兩次後恢復
  c = CR.create({ breed: "shiba", seed: 4 }); c.injured = 2;
  assert.ok(!CR.train(c, "speed"));
  c.pending = null; CR.rest(c); c.pending = null; CR.rest(c); c.pending = null;
  assert.strictEqual(c.injured, 0);
  // 二選一事件
  c = CR.create({ breed: "shiba", seed: 5 }); c.pending = "cat"; var t0 = c.turn, foc0 = c.train.foc;
  assert.ok(!CR.train(c, "speed") && !CR.rest(c), "有事件要先選");
  CR.choose(c, 1);
  assert.ok(c.pending === null && c.turn === t0 + 1 && c.train.foc === foc0 + 5, "選第 2 個：專注 +5");
  // 技能商店：價格、提示折扣、技能點與欄位
  c = CR.create({ breed: "shiba", seed: 6 });
  var gid = c.table.filter(function (id) { return SK.BY_ID[id].tier === "g"; })[0];
  assert.strictEqual(CR.price(c, gid), 360);
  c.hints[gid] = 2; assert.strictEqual(CR.price(c, gid), 288, "提示 2 級打 8 折");
  assert.ok(!CR.learn(c, gid), "技能點不夠");
  c.sp = 1000; assert.ok(CR.learn(c, gid) && c.sp === 712);
  var g2 = c.table.filter(function (id) { return SK.BY_ID[id].tier === "g" && id !== gid; })[0];
  assert.ok(!CR.learn(c, g2), "金技能欄位只有 1 格");
  assert.ok(!CR.learn(c, SK.LIST.filter(function (s) { return c.table.indexOf(s.id) < 0 && s.tier === "n"; })[0].id), "不在技能表也沒有提示的不能學");
  // 能力上限
  c.train.spd = CR.STAT_CAP - 1; c.turn = 2; c.energy = 100; c.fac.speed = 5;
  CR.train(c, "speed");
  assert.ok(c.train.spd <= CR.STAT_CAP);
  // 畢業資料
  var gr = CR.graduate(a);
  assert.ok(gr.train && gr.career && gr.career.grade && Array.isArray(gr.skills));
  assert.ok(CR.EVENTS.length >= 30, "事件至少 30 個");
})();
console.log("10. 生涯養成 OK");
console.log("saigo core_check OK");
