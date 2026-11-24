// 少女藥師的獨語（yakushi）規則核心檢查。規則依據 docs/yakushi_game_design.md §5～§8。
// 執行：node tools/yakushi_check/core_check.js
"use strict";
var path = require("path"), assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
var Herbs = require(path.join(SRC, "yakushi_herbs.js"));
global.PriTestYakushiHerbs = Herbs;
["poison", "mineral", "animal", "tonic", "clear", "boudoir"].forEach(function (c) { require(path.join(SRC, "yakushi_herbs_" + c + ".js")); });
var Core = require(path.join(SRC, "yakushi_core.js"));
var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

// 測試專用案件：生半夏混入芋頭（與序章同構，但 id 獨立）
var TCASE = {
  id: "case0", title: "測試", hours: 8, startPlace: "p1", cast: ["maomao"], startCards: [],
  places: [
    { id: "p1", name: "宿舍", spots: [
      { id: "s_sick", kind: "look", label: "看病人", gives: ["sym"], text: "口舌發麻" },
      { id: "s_talk", kind: "talk", label: "問人", requires: ["ev_led"], gives: ["p_eu", "tes_eu"], text: "……" }
    ] },
    { id: "p2", name: "廚房", spots: [
      { id: "s_pot", kind: "look", label: "鍋", gives: ["ev_tu"], text: "芋頭" },
      { id: "s_led", kind: "look", label: "帳", cost: 2, gives: ["ev_led"], text: "帳本" }
    ] }
  ],
  cards: {
    sym: { kind: "symptom", name: "口舌發麻", text: "", tags: [], of: "ev_tu" },
    ev_tu: { kind: "evidence", name: "芋頭", text: "", tags: ["塊莖"], herb: "banxia" },
    ev_led: { kind: "evidence", name: "帳本", text: "" },
    p_eu: { kind: "person", name: "小宦官", text: "" },
    tes_eu: { kind: "testimony", name: "證言", text: "" },
    re_look: { kind: "reaction", name: "細看", text: "", tags: [], of: "ev_tu" },
    tes_pt: { kind: "testimony", name: "病人證言", text: "" }
  },
  tests: [{ evidence: "ev_tu", method: "look", text: "小而圓", gives: "re_look" }],
  patients: [{ id: "pt", name: "阿桃", remedy: ["shengjiang", "gancao"], gives: "tes_pt", text: "" }],
  medicineBox: ["shengjiang", "gancao", "lvdou", "bohe"],
  solution: { who: "p_eu", what: "herb:banxia", how: "tes_eu", why: "ev_led" },
  rebuttals: [
    { who: "eu", claim: "那是芋頭", accepts: ["herb:banxia", "re_look"], reply: "……" },
    { who: "eu", claim: "錢沒少", accepts: ["ev_led"], reply: "……" }
  ],
  deep: { label: "誰教的", options: [{ key: "a", card: "tes_pt", monologue: [{ who: "maomao", text: "A" }] }], none: [{ who: "maomao", text: "N" }] },
  story: { intro: [], truth: [], outro: [] },
  monologue: [{ who: "maomao", text: "M" }]
};
Core.registerCase(TCASE);
Core.registerCase(Object.assign({}, TCASE, { id: "case1" }));   // 只為了測「已登記但未解鎖」→ locked

test("newSave：只解鎖序章", function () {
  var s = Core.newSave();
  assert.deepStrictEqual(s.unlocked, ["case0"]);
  assert.strictEqual(s.v, 1);
});
test("normalizeSave：壞資料重建、缺欄位補齊", function () {
  assert.deepStrictEqual(Core.normalizeSave(null), Core.newSave());
  var s = Core.normalizeSave({ unlocked: ["case0", "case1"], herbsSeen: { banxia: true } });
  assert.deepStrictEqual(s.unlocked, ["case0", "case1"]);
  assert.deepStrictEqual(s.monologues, {});
  assert.strictEqual(s.herbsSeen.banxia, true);
});
test("startCase：鎖住的案件不能開始", function () {
  var s = Core.newSave();
  assert.deepStrictEqual(Core.startCase(s, "case1"), { error: "locked" });
  assert.deepStrictEqual(Core.startCase(s, "nope"), { error: "case" });
  var r = Core.startCase(s, "case0");
  assert.strictEqual(r.hours, 8); assert.strictEqual(r.place, "p1"); assert.strictEqual(r.phase, "investigate");
  assert.strictEqual(s.cases.case0.run, r);
  assert.deepStrictEqual(r.patients.pt, { level: 0, cured: false, lost: false });
});
test("visit：同場所才能查、扣時辰、不能重複、requires 未滿足會鎖", function () {
  var r = Core.startCase(Core.newSave(), "case0");
  assert.deepStrictEqual(Core.visit(r, "s_pot"), { error: "place" });
  assert.deepStrictEqual(Core.visit(r, "s_talk"), { error: "locked" });
  var v = Core.visit(r, "s_sick");
  assert.ok(v.ok); assert.deepStrictEqual(v.gives, ["sym"]); assert.strictEqual(r.hours, 7);
  assert.deepStrictEqual(Core.visit(r, "s_sick"), { error: "done" });
});
test("move：換場所扣 1，同場所 0；cost 欄位生效", function () {
  var r = Core.startCase(Core.newSave(), "case0");
  assert.deepStrictEqual(Core.move(r, "p1"), { ok: true, cost: 0 });
  assert.deepStrictEqual(Core.move(r, "p2"), { ok: true, cost: 1 });
  Core.visit(r, "s_led");
  assert.strictEqual(r.hours, 5);
  assert.deepStrictEqual(Core.move(r, "zz"), { error: "place" });
});
test("時辰用完強制進入推理板，之後不能調查", function () {
  var r = Core.startCase(Core.newSave(), "case0");
  r.hours = 1;
  Core.visit(r, "s_sick");
  assert.strictEqual(r.hours, 0); assert.strictEqual(r.phase, "board");
  assert.deepStrictEqual(Core.move(r, "p2"), { error: "phase" });
});
test("cardInfo：一般卡與 herb: 卡", function () {
  assert.strictEqual(Core.cardInfo(TCASE, "ev_tu").name, "芋頭");
  var h = Core.cardInfo(TCASE, "herb:banxia");
  assert.strictEqual(h.kind, "herb"); assert.strictEqual(h.herb, "banxia"); assert.strictEqual(h.name, "生半夏");
  assert.strictEqual(Core.cardInfo(TCASE, "zz"), null);
});

console.log("\n" + passed + " passed");
