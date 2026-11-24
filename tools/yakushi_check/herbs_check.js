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

// ---------- 真資料 ----------
global.PriTestYakushiHerbs = Herbs;
var FILES = ["poison", "mineral", "animal", "tonic", "clear", "boudoir"];
var EXPECT = { poison: 22, mineral: 12, animal: 14, tonic: 18, clear: 18, boudoir: 16 };
var GROUPS = ["aconite", "yellow_vine", "nightshade", "umbel", "human_root", "pink_leaf", "almond",
  "white_powder", "red_mineral", "red_flower", "numb_poison", "fragrant_wood", "raw_tuber", "mad_honey"];
var loaded = [];
FILES.forEach(function (cat) {
  var p = path.join(SRC, "yakushi_herbs_" + cat + ".js");
  if (require("fs").existsSync(p) && require(p).length) loaded.push(cat);   // Task 1 的空殼（0 筆）不算已載入
});
var BANNED = ["劑量", "克", "服用量", "提煉", "萃取", "購買"];

test("已載入類別的數量符合 §4.2", function () {
  loaded.forEach(function (cat) {
    var LIST = require(path.join(SRC, "yakushi_herbs_" + cat + ".js"));
    assert.strictEqual(LIST.length, EXPECT[cat], cat + " 應為 " + EXPECT[cat] + " 種，實際 " + LIST.length);
    LIST.forEach(function (h) { assert.strictEqual(h.cat, cat, h.id + " 的 cat"); });
  });
});
test("前 3 類（毒草、礦石、動物）已有資料", function () {
  ["poison", "mineral", "animal"].forEach(function (c) { assert.ok(loaded.indexOf(c) >= 0, c + " 還沒有資料"); });
});
test("每筆欄位齊全、danger 0..3、group 合法", function () {
  Herbs.list().forEach(function (h) {
    assert.ok(/^[a-z]+$/.test(h.id), h.id);
    assert.ok(h.name && Array.isArray(h.alias) && h.lore, h.id + " 缺 name／alias／lore");
    assert.ok(h.danger >= 0 && h.danger <= 3, h.id + " danger");
    assert.ok(h.group === null || GROUPS.indexOf(h.group) >= 0, h.id + " group " + h.group);
    assert.ok(h.traits && Array.isArray(h.traits.form) && h.traits.form.length > 0, h.id + " traits.form");
    Herbs.METHODS.forEach(function (m) { assert.ok(m in h.tests, h.id + " tests." + m); });
    if (h.group) assert.ok(h.distinguish, h.id + " 有群組卻沒有 distinguish");
  });
});
test("銀針只對砒霜有反應（§4.4）", function () {
  Herbs.list().forEach(function (h) {
    if (h.id === "pishuang") assert.ok(h.tests.silver, "砒霜要有銀針反應");
    else assert.strictEqual(h.tests.silver, null, h.id + " 的 silver 應為 null");
  });
});
test("文字不含劑量、提煉、取得方法（§4.5）", function () {
  Herbs.list().forEach(function (h) {
    var all = JSON.stringify(h);
    BANNED.forEach(function (w) { assert.ok(all.indexOf(w) < 0, h.id + " 含禁用字「" + w + "」"); });
  });
});
test("易混群組：外觀有共同標籤，且兩兩可分辨", function () {
  GROUPS.forEach(function (g) {
    var members = Herbs.byGroup(g);
    if (members.length === 0) return;               // 該群組的類別還沒載入
    var common = Herbs.tagsOf(members[0]).filter(function (tag) {
      return members.every(function (m) { return Herbs.tagsOf(m).indexOf(tag) >= 0; });
    });
    if (members.length >= 2) assert.ok(common.length > 0, g + " 沒有共同標籤，篩選無法停在群組");
    for (var i = 0; i < members.length; i++) for (var j = i + 1; j < members.length; j++) {
      var a = members[i], b = members[j];
      var ta = Herbs.tagsOf(a).sort().join("|"), tb = Herbs.tagsOf(b).sort().join("|");
      var diffTest = Herbs.METHODS.some(function (m) { return (a.tests[m] || null) !== (b.tests[m] || null); });
      assert.ok(ta !== tb || diffTest, g + "：" + a.id + " 與 " + b.id + " 無法分辨");
    }
  });
});
test("後續案件依賴的標籤（半夏／天南星）", function () {
  var b = Herbs.tagsOf(Herbs.get("banxia")), t = Herbs.tagsOf(Herbs.get("tiannanxing"));
  ["塊莖", "口舌發麻", "喉嚨腫痛", "小型塊莖", "頂端凹陷莖痕", "刺舌感", "onset:fast"].forEach(function (x) {
    assert.ok(b.indexOf(x) >= 0, "banxia 缺 " + x);
  });
  ["塊莖", "口舌發麻", "喉嚨腫痛", "扁球形大塊莖", "onset:fast"].forEach(function (x) {
    assert.ok(t.indexOf(x) >= 0, "tiannanxing 缺 " + x);
  });
  ["小型塊莖", "頂端凹陷莖痕", "刺舌感"].forEach(function (x) {
    assert.ok(t.indexOf(x) < 0, "tiannanxing 不應有 " + x);
  });
});
test("6 類全部載入，共 100 種，14 個群組都至少 2 名成員", function () {
  assert.deepStrictEqual(loaded, FILES);
  assert.strictEqual(Herbs.list().length, 100);
  GROUPS.forEach(function (g) { assert.ok(Herbs.byGroup(g).length >= 2, g + " 成員不足 2"); });
});

console.log("\n" + passed + " passed");
