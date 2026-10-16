// ============================================================================
// gousei（武俠合成）規則引擎的 Node 檢查。
// 執行：node tools/gousei_check/core_check.js
// 規則（使用者指定）：組合必有結果（無配方→廢料，材料含廢料→廢料）；
// 每人任務 中階×1（階段3〜4）＋高階×2（階段5〜7）不重複；
// 只有在自己回合親手合出自己的任務物才算達成；先 3/3 者勝。
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SRC = path.join(__dirname, "..", "..", "static_src");
var win = {};
new Function("window", fs.readFileSync(path.join(SRC, "gousei_core.js"), "utf8"))(win);
var Core = win.PriTestGouseiCore;

// ---- 測試用小主題：每層 3 個物體，階段 1〜7 ----
function fixture() {
  var items = [["b1", "甲", "甲", "basic", 0], ["b2", "乙", "乙", "basic", 0],
    ["z1", "灰", "灰", "junk", 0], ["z2", "渣", "渣", "junk", 0]];
  var recipes = {};
  var levels = ["i", "j", "k", "l", "m", "n", "o"];
  var prev = null;
  levels.forEach(function (L, idx) {
    var tier = idx + 1;
    var ids = [L + "1", L + "2", L + "3"];
    ids.forEach(function (id) { items.push([id, id, id, "c", tier]); });
    if (!prev) {
      recipes["b1|b1"] = ids[0]; recipes["b1|b2"] = ids[1]; recipes["b2|b2"] = ids[2];
    } else {
      recipes[Core.pairKey(prev[0], prev[1])] = ids[0];
      recipes[Core.pairKey(prev[1], prev[2])] = ids[1];
      recipes[Core.pairKey(prev[0], prev[2])] = ids[2];
    }
    prev = ids;
  });
  return { id: "fx", name: { zh: "測試", ja: "テスト" }, basics: ["b1", "b2"], junk: ["z1", "z2"],
    categories: [{ id: "c", zh: "類", ja: "類" }], items: items, recipes: recipes };
}
var theme = Core.indexTheme(fixture());

// ---- 基本工具 ----
assert.strictEqual(Core.pairKey("b", "a"), "a|b");
assert.strictEqual(Core.pairKey("a", "a"), "a|a");
assert.strictEqual(Core.hashStr("abc"), Core.hashStr("abc"));
var r1 = Core.makeRng("s1"), r2 = Core.makeRng("s1");
for (var i = 0; i < 5; i++) assert.strictEqual(r1(), r2());
assert.ok(/^[0-9a-z]{8}$/.test(Core.newSeed(Math.random)));
assert.strictEqual(theme.byId.k1.tier, 3);

// ---- 合成 ----
assert.strictEqual(Core.combine(theme, "b1", "b2"), "i2");
assert.strictEqual(Core.combine(theme, "b2", "b1"), "i2", "順序不影響");
var junk = Core.combine(theme, "b1", "o3");
assert.ok(theme.junkSet[junk], "無配方 → 廢料");
assert.strictEqual(Core.combine(theme, "o3", "b1"), junk, "廢料是確定性的");
assert.ok(theme.junkSet[Core.combine(theme, "z1", "z1")], "廢料 + 廢料 → 廢料");
// 即使把廢料塞進配方表，含廢料的組合仍是廢料
theme.recipes["b1|z1"] = "i1";
assert.ok(theme.junkSet[Core.combine(theme, "b1", "z1")], "材料含廢料 → 廢料");
delete theme.recipes["b1|z1"];

// ---- 發任務 ----
var deal = Core.dealTargets(theme, "seedA", 2);
assert.strictEqual(deal.length, 2);
var seen = {};
deal.forEach(function (ts) {
  assert.strictEqual(ts.length, 3);
  var t0 = theme.byId[ts[0]].tier;
  assert.ok(t0 >= 3 && t0 <= 4, "中階 " + ts[0]);
  [ts[1], ts[2]].forEach(function (id) { var tt = theme.byId[id].tier; assert.ok(tt >= 5 && tt <= 7, "高階 " + id); });
  ts.forEach(function (id) { assert.ok(!seen[id], "任務不重複 " + id); seen[id] = true; });
});
assert.deepStrictEqual(Core.dealTargets(theme, "seedA", 2), deal, "同 seed 相同");
assert.throws(function () { Core.dealTargets(theme, "seedA", 7); }, /not-enough-targets/);

// ---- 開局 ----
var st = Core.newGame(theme, { seed: "seedA", mode: "shared", names: ["A", "B"] });
assert.strictEqual(st.version, 1);
assert.deepStrictEqual(st.pool, ["b1", "b2"]);
assert.deepStrictEqual(st.players[0].targets, deal[0]);
assert.strictEqual(st.players[1].id, "p2");
assert.strictEqual(Core.currentPlayer(st).id, "p1");

// ---- 合成流程：新發現、輪替、輪數 ----
var res = Core.applyCombine(theme, st, "b1", "b2");
assert.strictEqual(res.entry.result, "i2");
assert.strictEqual(res.entry.isNew, true);
assert.strictEqual(res.entry.playerId, "p1");
assert.ok(res.state.pool.indexOf("i2") >= 0);
assert.strictEqual(Core.currentPlayer(res.state).id, "p2");
assert.strictEqual(st.pool.length, 2, "不改動傳入的 state");
var res2 = Core.applyCombine(theme, res.state, "b2", "b1");
assert.strictEqual(res2.entry.isNew, false);
assert.strictEqual(res2.state.round, 2);
assert.strictEqual(res2.state.turn, 0);
assert.throws(function () { Core.applyCombine(theme, res2.state, "b1", "k1"); }, /not-in-pool/);

// ---- 復原：只保留一層 ----
var back = Core.undo(res2.state);
assert.deepStrictEqual(back.pool, res.state.pool);
assert.strictEqual(back.turn, 1);
assert.strictEqual(Core.undo(back), null, "只能復原一層");

// ---- 達成：只算自己回合親手合出 ----
var s3 = Core.newGame(theme, { seed: "x", mode: "shared", names: ["A", "B"] });
s3.players[0].targets = ["k1", "m1", "n1"];
s3.players[1].targets = ["k2", "m2", "n2"];
s3.pool = s3.pool.concat(["j1", "j2", "j3"]);
var a1 = Core.applyCombine(theme, s3, "j2", "j3"); // p1 合出 k2（p2 的任務）
assert.strictEqual(a1.entry.achieved, false, "別人的任務不算");
var a2 = Core.applyCombine(theme, a1.state, "j2", "j3"); // p2 再合出 k2，但已在池子中
assert.strictEqual(a2.entry.achieved, true, "自己親手合出才算（已在池子中也可以）");
assert.deepStrictEqual(a2.state.players[1].done, ["k2"]);
var a3 = Core.applyCombine(theme, a2.state, "j1", "j2"); // p1 合出 k1
assert.strictEqual(a3.entry.achieved, true);

// ---- 勝利 ----
var s4 = Core.newGame(theme, { seed: "x", mode: "shared", names: ["A", "B"] });
s4.players[0].targets = ["k1", "m1", "n1"];
s4.players[0].done = ["m1", "n1"];
s4.pool = s4.pool.concat(["j1", "j2"]);
var w = Core.applyCombine(theme, s4, "j1", "j2");
assert.strictEqual(w.state.winner, "p1");
assert.strictEqual(w.state.turn, 0, "獲勝後不再輪替");
assert.throws(function () { Core.applyCombine(theme, w.state, "b1", "b1"); }, /game-over/);

// ---- 參加碼 ----
var jp = Core.joinParam(st, 1);
assert.strictEqual(jp, "fx.seedA.2.1");
assert.deepStrictEqual(Core.parseJoin(jp), { themeId: "fx", seed: "seedA", count: 2, index: 1 });
assert.strictEqual(Core.parseJoin("fx.seedA.2.5"), null);
assert.strictEqual(Core.parseJoin("garbage"), null);
assert.strictEqual(Core.parseJoin("fx.seedA.9.0"), null, "人數超過 8");

console.log("gousei core_check OK");
