// ============================================================================
// 煉金術士（atelier）第 3 階段規則檢查（不需要瀏覽器）。規則依據 docs/atelier_design.md §9。
//   混色、互補色抵銷、觸媒（擴張、染色、倍化）、過熱、大成功、特性合成、瑠璃出手、每週挑戰、回放、遷移。
// 執行：node tools/atelier_check/phase3_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
global.PriTestAtelierData = require(path.join(SRC, "atelier_data.js"));
global.PriTestAtelierColors = require(path.join(SRC, "atelier_colors.js"));
global.PriTestAtelierHosts = require(path.join(SRC, "atelier_hosts.js"));
var C = require(path.join(SRC, "atelier_core.js"));
global.PriTestAtelierCore = C;
var Board = require(path.join(SRC, "atelier_method_board.js"));
C.registerMethod("board", Board);
var D = global.PriTestAtelierData;

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }
var DAY = 86400000;
var T0 = Date.UTC(2026, 10, 19, 3, 0, 0);   // JST 2026-11-19（週四）12:00
function mat(uid, el, cat, shape, q, traits, power) {
  return { uid: uid, hex: "#000000", rgb: [0, 0, 0], colorId: "sumi", element: el, category: cat,
    power: power || 2, quality: q || 50, traits: traits || [], shape: shape, at: T0 };
}
var ADV = { mix: true, complement: true, great: true };
function plainCauldron(size) {
  var row = new Array(size + 1).join(".");
  return { id: "test", pattern: new Array(size).fill(row), qualityPerCell: 0 };
}
function lv3Save() { var s = C.newSave(T0); s.exp = 2 * D.EXP_PER_LV; return s; }

// ---------- §9.1 進階棋盤 ----------
test("混色：火與冰相鄰 → 靈 +1；同一個素材自己相鄰不算；規則關閉時不算", function () {
  var mats = [mat(1, "fire", "mineral", [[0, 0]]), mat(2, "ice", "liquid", [[0, 0]]), mat(3, "fire", "mineral", [[0, 0], [1, 0]])];
  var s = Board.create(C.recipe("heal"), mats, plainCauldron(5), {}, { rules: ADV });
  Board.place(s, 0, 0, 0, 0); Board.place(s, 1, 1, 0, 0); Board.place(s, 2, 0, 2, 0);
  var ev = Board.evaluate(s, false);
  assert.strictEqual(ev.mix, 1);
  assert.strictEqual(ev.gauges.spirit, 1);
  var off = Board.create(C.recipe("heal"), mats, plainCauldron(5), {}, {});
  Board.place(off, 0, 0, 0, 0); Board.place(off, 1, 1, 0, 0);
  assert.strictEqual(Board.evaluate(off, false).mix, 0);
});

test("互補色：火素材放在風色格 → 這一格 0 分、火量表 −1，最低 0", function () {
  var cauldron = { id: "t", pattern: ["w....", ".....", ".....", ".....", "....."], qualityPerCell: 0 };
  var s = Board.create(C.recipe("heal"), [mat(1, "fire", "mineral", [[0, 0], [1, 0]], 50, [], 2)], cauldron, {}, { rules: ADV });
  Board.place(s, 0, 0, 0, 0);
  var ev = Board.evaluate(s, false);
  assert.strictEqual(ev.clash, 1);
  assert.strictEqual(ev.gauges.fire, 2 - 1);
  var s2 = Board.create(C.recipe("heal"), [mat(1, "fire", "mineral", [[0, 0]], 50, [], 2)], cauldron, {}, { rules: ADV });
  Board.place(s2, 0, 0, 0, 0);
  assert.strictEqual(Board.evaluate(s2, false).gauges.fire, 0);
});

test("觸媒：擴張 size+1；染色只改中央 3×3 的一般格；倍化讓同色格多加一次", function () {
  var cop = D.CAULDRONS.copper;
  var ex = Board.create(C.recipe("heal"), [mat(1, "wind", "plant", [[0, 0]])], cop, {}, { catalyst: { id: "expand" } });
  assert.strictEqual(ex.size, 6);
  assert.strictEqual(ex.cells.length, 36);
  var tint = Board.catalystPattern(cop.pattern, { id: "tint", el: "wind" });
  assert.deepStrictEqual(tint, ["f.*.i", ".FwI.", "*wsw*", ".WwB.", "w.*.b"]);
  var dbl = Board.create(C.recipe("heal"), [mat(1, "wind", "plant", [[0, 0]], 50, [], 2)], cop, {}, { catalyst: { id: "double", el: "wind" } });
  Board.place(dbl, 0, 0, 4, 0);                // 風色格：2 + 2 + 倍化 2
  assert.strictEqual(Board.evaluate(dbl, false).gauges.wind, 6);
});

test("觸媒製作與消耗：Lv3 以上、灰燼足夠；完成時才消耗；沒有庫存不能用", function () {
  var s = C.newSave(T0);
  s.ash = 100;
  assert.strictEqual(C.makeCatalyst(s, "expand"), false, "Lv1 不能製作");
  s.exp = 2 * D.EXP_PER_LV;
  assert.strictEqual(C.makeCatalyst(s, "expand"), true);
  assert.strictEqual(s.ash, 100 - D.CATALYSTS.expand.ash);
  s.mats = [mat(1, "ice", "liquid", [[0, 0]]), mat(2, "wind", "plant", [[0, 0]]), mat(3, "wind", "plant", [[0, 0]])];
  assert.strictEqual(C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0, { catalyst: { id: "tint", el: "wind" } }).error, "catalyst");
  var ss = C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0, { catalyst: { id: "expand" } });
  assert.strictEqual(ss.size, 6);
  assert.strictEqual(s.catalysts.expand, 1, "開始時不消耗");
  Board.place(ss, 0, 0, 0, 0); Board.place(ss, 1, 1, 0, 0); Board.place(ss, 2, 2, 0, 0);
  var item = C.finishSynthesis(s, ss, [], T0);
  assert.strictEqual(item.recipe, "heal");
  assert.strictEqual(s.catalysts.expand, 0);
  assert.deepStrictEqual(item.replay.cat, { id: "expand", el: null });
});

test("進階規則只在 Lv3 以上且開關開啟時生效", function () {
  var s = C.newSave(T0);
  s.mats = [mat(1, "ice", "liquid", [[0, 0]]), mat(2, "wind", "plant", [[0, 0]]), mat(3, "wind", "plant", [[0, 0]])];
  assert.deepStrictEqual(C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0).rules, {});
  s.exp = 2 * D.EXP_PER_LV;
  assert.strictEqual(C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0).rules.mix, true);
  C.setAdvanced(s, false);
  assert.deepStrictEqual(C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0).rules, {});
});

// ---------- §9.2 過熱、大成功 ----------
test("過熱：覆蓋 90% 以上 → overheat，完成品質 −10", function () {
  var full = [];
  for (var y = 0; y < 5; y++) for (var x = 0; x < 5; x++) full.push([x, y]);
  var big = full.slice(0, 23);                 // 23/25 = 92%
  var s = lv3Save();
  s.mats = [mat(1, "ice", "liquid", big, 60), mat(2, "wind", "plant", [[0, 0]], 60), mat(3, "wind", "plant", [[0, 0]], 60)];
  var ss = C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0);
  Board.place(ss, 0, 0, 0, 0); Board.place(ss, 1, 3, 4, 0); Board.place(ss, 2, 4, 4, 0);
  var ev = Board.evaluate(ss, true);
  assert.strictEqual(ev.overheat, true);
  var item = C.finishSynthesis(s, ss, [], T0);
  assert.strictEqual(item.overheat, true);
  var expect = ev.quality - D.OVERHEAT_PENALTY + (item.great ? D.GREAT_QUALITY : 0);
  assert.strictEqual(item.quality, expect);
});

test("大成功：機率公式、seed 固定時結果相同、品質上限 120、效果 ×1.2", function () {
  var s = lv3Save();
  s.hosts.ruri.aff = 50;
  s.mats = [mat(1, "ice", "liquid", [[0, 0]], 95), mat(2, "wind", "plant", [[0, 0]], 95), mat(3, "wind", "plant", [[0, 0]], 95)];
  var ss = C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0);
  Board.place(ss, 0, 4, 0, 0); Board.place(ss, 1, 0, 4, 0); Board.place(ss, 2, 1, 3, 0);
  var ev = Board.evaluate(ss, true);
  var all = C.effectLevels(ss.recipe, ev.gauges).every(function (e) { return e.level >= 1; });
  assert.strictEqual(C.greatChance(s, ss), D.GREAT_BASE + 50 * D.GREAT_PER_AFF + (all ? D.GREAT_ALL_LV : 0));
  // 找一個會大成功的 nextUid（seed 可重現）
  var uid = 100;
  while (!(C.makeRng("great:" + uid + ":heal")() < C.greatChance(s, ss))) uid++;
  s.nextUid = uid;
  var item = C.finishSynthesis(s, ss, [], T0);
  assert.strictEqual(item.great, true);
  assert(item.quality > 100, "上限放寬到 120：" + item.quality);
  assert(item.quality <= D.QUALITY_CAP_GREAT);
  var e0 = item.effects[0];
  if (e0.level) assert.strictEqual(e0.n, Math.round(D.RECIPES[0].gauges[0].steps[e0.level - 1].n * D.GREAT_EFFECT));
  // Lv1 的存檔（規則關閉）不會大成功也不會過熱
  var s1 = C.newSave(T0);
  s1.mats = [mat(1, "ice", "liquid", [[0, 0]], 95), mat(2, "wind", "plant", [[0, 0]], 95), mat(3, "wind", "plant", [[0, 0]], 95)];
  s1.nextUid = uid;
  var ss1 = C.startSynthesis(s1, "heal", [1, 2, 3], "copper", T0);
  Board.place(ss1, 0, 4, 0, 0); Board.place(ss1, 1, 0, 4, 0); Board.place(ss1, 2, 1, 3, 0);
  assert.strictEqual(C.finishSynthesis(s1, ss1, [], T0).great, false);
});

// ---------- §9.3 特性合成 ----------
test("特性合成：朝露＋黃昏 → 晨昏（成本 14），沒有組合時不變", function () {
  assert.deepStrictEqual(C.fuseTraits(["morning_dew", "dusk"]), ["twilight"]);
  assert.deepStrictEqual(C.fuseTraits(["vivid", "morning_dew", "hue_grace"]), ["morning_dew", "hue_crown"]);
  assert.deepStrictEqual(C.fuseTraits(["vivid", "night"]), ["vivid", "night"]);
  assert.strictEqual(C.traitCost(["morning_dew", "dusk"]), 14);
  var s = lv3Save();      // Lv3：上限 25
  s.mats = [mat(1, "ice", "liquid", [[0, 0]], 50, ["morning_dew"]), mat(2, "wind", "plant", [[0, 0]], 50, ["dusk"]), mat(3, "wind", "plant", [[0, 0]], 50)];
  var ss = C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0);
  Board.place(ss, 0, 0, 0, 0); Board.place(ss, 1, 1, 0, 0); Board.place(ss, 2, 2, 0, 0);
  assert.strictEqual(C.traitsValid(s, ss, ["morning_dew", "dusk"]), true);
  var item = C.finishSynthesis(s, ss, ["morning_dew", "dusk"], T0);
  assert.deepStrictEqual(item.traits, ["twilight"]);
});

// ---------- §9.4 瑠璃出手 ----------
test("瑠璃出手：好感度 40 以上、每次調和 1 次；選到的位置分數不低於任何合法位置", function () {
  var s = lv3Save();
  s.mats = [mat(1, "ice", "liquid", [[0, 0], [1, 0]]), mat(2, "wind", "plant", [[0, 0]]), mat(3, "wind", "plant", [[0, 0]])];
  var ss = C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0);
  assert.strictEqual(C.helpAvailable(s, ss), false);
  s.hosts.ruri.aff = D.HELP_AFF;
  assert.strictEqual(C.helpAvailable(s, ss), true);
  var bp = Board.bestPlacement(ss, 1);
  var p = Board.preview(ss, 1, 0, 4, 0);       // 風色格
  assert(p.after.gauges.wind <= Board.preview(ss, 1, bp.x, bp.y, bp.rot).after.gauges.wind);
  var info = C.useHelp(s, ss, 1);
  assert(info && info.ok);
  assert.strictEqual(ss.placed[1], true);
  assert.strictEqual(C.helpAvailable(s, ss), false);
  assert.strictEqual(C.useHelp(s, ss, 0), null);
});

// ---------- §9.5 每週挑戰 ----------
test("每週挑戰：同一週相同、隔週不同；週一開始", function () {
  assert.strictEqual(C.weekKey(T0), "2026-11-16");
  assert.strictEqual(C.weekKey(Date.UTC(2026, 10, 15, 15, 0, 0)), "2026-11-16", "JST 週一 00:00");
  assert.strictEqual(C.weekKey(Date.UTC(2026, 10, 15, 14, 59, 0)), "2026-11-09", "JST 週日 23:59");
  var a = C.weeklyChallenge(T0), b = C.weeklyChallenge(T0 + 2 * DAY), c = C.weeklyChallenge(T0 + 7 * DAY);
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a.mats.map(function (m) { return m.hex; }), c.mats.map(function (m) { return m.hex; }));
  assert.strictEqual(a.mats.length, C.recipe(a.recipe).needs.length);
});

test("每週挑戰：不消耗素材、不產生成品；最佳分數保存；第一次完成經驗 +20", function () {
  var s = C.newSave(T0);
  s.mats = [mat(1, "ice", "liquid", [[0, 0]])];
  var ss = C.startChallenge(s, T0);
  assert.strictEqual(C.finishChallenge(s, ss, T0).error, "unplaced");
  ss.mats.forEach(function (m, i) {
    for (var rot = 0; rot < 4 && !ss.placed[i]; rot++) for (var y = 0; y < ss.size && !ss.placed[i]; y++) for (var x = 0; x < ss.size && !ss.placed[i]; x++)
      if (Board.canPlace(ss, i, x, y, rot)) Board.place(ss, i, x, y, rot);
  });
  var r = C.finishChallenge(s, ss, T0);
  assert.strictEqual(r.first, true);
  assert.strictEqual(r.score, C.challengeScore(ss));
  assert.strictEqual(s.exp, D.WEEKLY_EXP);
  assert.strictEqual(s.mats.length, 1);
  assert.strictEqual(s.items.length, 0);
  var r2 = C.finishChallenge(s, ss, T0);
  assert.strictEqual(r2.first, false);
  assert.strictEqual(s.exp, D.WEEKLY_EXP);
  assert.strictEqual(s.weekly.best, r.score);
  assert.strictEqual(s.weekly.plays, 2);
});

// ---------- §9.6 回放 ----------
test("回放：moves 記錄每一手、Undo 刪除最後一手；replaySession 重建出相同的量表", function () {
  var s = lv3Save();
  s.mats = [mat(1, "ice", "liquid", [[0, 0], [1, 0]], 60, [], 3), mat(2, "wind", "plant", [[0, 0], [0, 1]], 60, [], 3), mat(3, "fire", "plant", [[0, 0]], 60, [], 2)];
  var ss = C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0, {});
  Board.place(ss, 0, 3, 0, 0);
  Board.place(ss, 1, 0, 3, 1);
  Board.undo(ss);
  assert.deepStrictEqual(ss.moves, [[0, 3, 0, 0]]);
  Board.place(ss, 1, 0, 3, 0);
  Board.place(ss, 2, 4, 1, 0);
  var gauges = Board.evaluate(ss, true).gauges;
  var item = C.finishSynthesis(s, ss, [], T0);
  assert.deepStrictEqual(item.replay.moves, [[0, 3, 0, 0], [1, 0, 3, 0], [2, 4, 1, 0]]);
  var rs = C.replaySession(JSON.parse(JSON.stringify(item)));
  assert.deepStrictEqual(Board.evaluate(rs, true).gauges, gauges);
});

// ---------- 遷移 ----------
test("第 2 階段的存檔：補上 settings、catalysts、weekly", function () {
  var old = C.newSave(T0);
  delete old.settings; delete old.catalysts; delete old.weekly;
  old.exp = 77;
  var s = C.migrate(old);
  assert.deepStrictEqual(s.settings, { advanced: true });
  assert.deepStrictEqual(s.catalysts, { expand: 0, tint: 0, double: 0 });
  assert.deepStrictEqual(s.weekly, { key: "", best: 0, plays: 0 });
  assert.strictEqual(s.exp, 77);
  Object.keys(D.TRAITS).forEach(function (k) { assert(D.TRAITS[k].name.zh && D.TRAITS[k].cost > 0, k); });
  D.TRAIT_FUSION.forEach(function (f) { f.forEach(function (t) { assert(D.TRAITS[t], t); }); });
});

console.log("\n" + passed + " passed");
