// 少女藥師的獨語（yakushi）藥材 registry 與資料檢查。規則依據 docs/yakushi_game_design.md §4。
// 執行：node tools/yakushi_check/herbs_check.js
"use strict";
var path = require("path"), assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

// ---------- registry（用假資料，不載入真資料） ----------
var Herbs = require(path.join(SRC, "yakushi_herbs.js"));
function fake(id, group, form, onset) {
  return { id: id, name: id, alias: [id + "別名"], cat: "poison", group: group, danger: 1,
    traits: { form: form, smell: [], taste: [], symptom: [], onset: onset }, tests: {}, distinguish: null, lore: "" };
}
Herbs.register([fake("a", "g1", ["黃花", "藤本"], "fast"), fake("b", "g1", ["黃花"], "slow"), fake("c", null, ["根"], null)]);

test("get／list 依登記順", function () {
  assert.strictEqual(Herbs.get("a").id, "a");
  assert.strictEqual(Herbs.get("zz"), null);
  assert.deepStrictEqual(Herbs.list().map(function (h) { return h.id; }), ["a", "b", "c"]);
});
test("id 重複會 throw", function () {
  assert.throws(function () { Herbs.register([fake("a", null, [], null)]); });
});
test("byGroup／byCat", function () {
  assert.deepStrictEqual(Herbs.byGroup("g1").map(function (h) { return h.id; }), ["a", "b"]);
  assert.strictEqual(Herbs.byCat("poison").length, 3);
});
test("tagsOf 含 onset", function () {
  assert.deepStrictEqual(Herbs.tagsOf(Herbs.get("a")), ["黃花", "藤本", "onset:fast"]);
  assert.deepStrictEqual(Herbs.tagsOf(Herbs.get("c")), ["根"]);
});
test("filter：全部 tags 都要有", function () {
  assert.deepStrictEqual(Herbs.filter(["黃花"]).map(function (h) { return h.id; }), ["a", "b"]);
  assert.deepStrictEqual(Herbs.filter(["黃花", "onset:fast"]).map(function (h) { return h.id; }), ["a"]);
  assert.strictEqual(Herbs.filter([]).length, 3);
});
test("search：名稱或別名", function () {
  assert.deepStrictEqual(Herbs.search("b別").map(function (h) { return h.id; }), ["b"]);
});
Herbs._reset();   // 只給測試用：清空 registry，下面的資料檢查重新載入真資料

console.log("\n" + passed + " passed");
