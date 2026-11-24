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

function ready() {   // 拿到芋頭與病人症狀的 run
  var r = Core.startCase(Core.newSave(), "case0");
  Core.visit(r, "s_sick"); Core.move(r, "p2"); Core.visit(r, "s_pot");
  return r;
}
test("evidenceTags：證物本身＋of 指向它的卡", function () {
  var r = ready();
  TCASE.cards.sym.tags = ["口舌發麻"];
  assert.deepStrictEqual(Core.evidenceTags(r, "ev_tu").sort(), ["口舌發麻", "塊莖"].sort());
  TCASE.cards.sym.tags = [];
});
test("candidates：真藥材一定在候選裡", function () {
  var ids = Core.candidates(["塊莖"]).map(function (h) { return h.id; });
  assert.ok(ids.indexOf("banxia") >= 0 && ids.indexOf("tiannanxing") >= 0);
});
test("identify：對的不扣時辰、錯的扣 1，都不公開對錯；重鑑定會換卡", function () {
  var r0 = Core.startCase(Core.newSave(), "case0");
  assert.deepStrictEqual(Core.identify(r0, "ev_tu", "banxia"), { error: "missing" });
  assert.deepStrictEqual(Core.identify(r0, "ev_led", "banxia"), { error: "evidence" });
  var r = ready(), h0 = r.hours;
  assert.deepStrictEqual(Core.identify(r, "ev_tu", "zz"), { error: "herb" });
  assert.deepStrictEqual(Core.identify(r, "ev_tu", "tiannanxing"), { ok: true });
  assert.strictEqual(r.hours, h0 - 1);
  assert.ok(r.cards.indexOf("herb:tiannanxing") >= 0);
  assert.deepStrictEqual(Core.identify(r, "ev_tu", "banxia"), { ok: true });
  assert.strictEqual(r.hours, h0 - 1);
  assert.ok(r.cards.indexOf("herb:banxia") >= 0);
  assert.ok(r.cards.indexOf("herb:tiannanxing") < 0);
  assert.strictEqual(r.identified.ev_tu, "banxia");
});
test("runTest：案件指定的結果優先，給反應卡；重複不再扣時辰", function () {
  var r = ready(), h0 = r.hours;
  var t1 = Core.runTest(r, "ev_tu", "look");
  assert.strictEqual(t1.text, "小而圓"); assert.strictEqual(t1.gives, "re_look");
  assert.ok(r.cards.indexOf("re_look") >= 0); assert.strictEqual(r.hours, h0 - 1);
  var t2 = Core.runTest(r, "ev_tu", "look");
  assert.strictEqual(t2.repeat, true); assert.strictEqual(r.hours, h0 - 1);
  assert.deepStrictEqual(Core.runTest(r, "ev_tu", "zz"), { error: "method" });
});
test("runTest：沒有指定就用藥材的 tests；沒有就 null", function () {
  var r = ready();
  var t = Core.runTest(r, "ev_tu", "silver");
  assert.strictEqual(t.text, null);
  var smell = Core.runTest(r, "ev_tu", "smell");
  assert.strictEqual(smell.text, Herbs.get("banxia").tests.smell);
});
test("runTest：嚐 danger≥2 扣體力，歸零休息扣 2 時辰並回滿", function () {
  var r = ready();
  r.stamina = 1; r.hours = 8;
  var t = Core.runTest(r, "ev_tu", "taste");   // 生半夏 danger 2
  assert.strictEqual(t.collapsed, true);
  assert.strictEqual(r.stamina, 3);
  assert.strictEqual(r.hours, 8 - 1 - 2);
});
test("giveRemedy：藥箱限制、1～3 味、對了給證言、錯了惡化並扣時辰、到底就 lost", function () {
  var r = ready();
  assert.deepStrictEqual(Core.giveRemedy(r, "pt", ["renshen"]), { error: "box" });
  assert.deepStrictEqual(Core.giveRemedy(r, "pt", []), { error: "count" });
  var h0 = r.hours;
  var w = Core.giveRemedy(r, "pt", ["lvdou"]);
  assert.deepStrictEqual(w, { ok: true, cured: false, lost: false });
  assert.strictEqual(r.patients.pt.level, 1); assert.strictEqual(r.hours, h0 - 1);
  var ok = Core.giveRemedy(r, "pt", ["gancao", "shengjiang"]);
  assert.deepStrictEqual(ok, { ok: true, cured: true, lost: false });
  assert.ok(r.cards.indexOf("tes_pt") >= 0);
  assert.deepStrictEqual(Core.giveRemedy(r, "pt", ["gancao"]), { error: "done" });
  var r2 = ready(); r2.hours = 8;
  Core.giveRemedy(r2, "pt", ["lvdou"]); Core.giveRemedy(r2, "pt", ["bohe"]);
  assert.strictEqual(Core.giveRemedy(r2, "pt", ["lvdou", "bohe"]).lost, true);
});

function atBoard() {
  var r = ready();
  Core.move(r, "p2"); Core.visit(r, "s_led"); Core.move(r, "p1"); Core.visit(r, "s_talk");
  Core.identify(r, "ev_tu", "banxia");
  Core.toBoard(r);
  return r;
}
test("placeCard：只能放持有的卡、格子要合法", function () {
  var r = atBoard();
  assert.deepStrictEqual(Core.placeCard(r, "who", "zz"), { error: "card" });
  assert.deepStrictEqual(Core.placeCard(r, "when", "p_eu"), { error: "slot" });
  assert.deepStrictEqual(Core.placeCard(r, "who", "p_eu"), { ok: true });
  assert.deepStrictEqual(Core.placeCard(r, "who", null), { ok: true });
  assert.strictEqual(r.board.who, null);
});
test("submit：空格不能交；只回饋對幾格；4 格對進入指認", function () {
  var r = atBoard();
  assert.deepStrictEqual(Core.submit(r), { error: "empty" });
  Core.placeCard(r, "who", "p_eu"); Core.placeCard(r, "what", "herb:banxia");
  Core.placeCard(r, "how", "ev_led"); Core.placeCard(r, "why", "tes_eu");
  assert.deepStrictEqual(Core.submit(r), { correct: 2 });
  assert.strictEqual(r.phase, "board");
  Core.placeCard(r, "how", "tes_eu"); Core.placeCard(r, "why", "ev_led");
  assert.deepStrictEqual(Core.submit(r), { correct: 4 });
  assert.strictEqual(r.phase, "accuse"); assert.strictEqual(r.submits, 2);
});
function atAccuse() {
  var r = atBoard();
  Core.placeCard(r, "who", "p_eu"); Core.placeCard(r, "what", "herb:banxia");
  Core.placeCard(r, "how", "tes_eu"); Core.placeCard(r, "why", "ev_led");
  Core.submit(r);
  return r;
}
test("present：對了往下一輪；錯了扣信任；歸零重來", function () {
  var r = atAccuse();
  assert.strictEqual(Core.currentRebuttal(r).claim, "那是芋頭");
  var miss = Core.present(r, "ev_led");
  assert.strictEqual(miss.hit, false); assert.strictEqual(r.trust, 2); assert.strictEqual(r.mispresent, 1);
  assert.strictEqual(Core.present(r, "herb:banxia").hit, true);
  assert.strictEqual(r.accuseStep, 1);
  Core.present(r, "p_eu"); var last = Core.present(r, "p_eu");
  assert.strictEqual(last.reset, true);
  assert.strictEqual(r.accuseStep, 0); assert.strictEqual(r.trust, 3); assert.strictEqual(r.accuseFails, 1);
  Core.present(r, "herb:banxia");
  var done = Core.present(r, "ev_led");
  assert.strictEqual(done.done, true); assert.strictEqual(r.phase, "done");
});
test("rating：公式（暫定）", function () {
  var base = { submits: 1, mispresent: 0, accuseFails: 0, hours: 3 };
  assert.strictEqual(Core.rating(base), "S");
  assert.strictEqual(Core.rating({ submits: 1, mispresent: 0, accuseFails: 0, hours: 2 }), "S");
  assert.strictEqual(Core.rating({ submits: 2, mispresent: 0, accuseFails: 0, hours: 0 }), "A");
  assert.strictEqual(Core.rating({ submits: 2, mispresent: 1, accuseFails: 1, hours: 0 }), "B");
  assert.strictEqual(Core.rating({ submits: 4, mispresent: 2, accuseFails: 1, hours: 0 }), "C");
});
test("deepOption：放對應卡選該項，沒放選 none", function () {
  var r = atAccuse();
  assert.strictEqual(Core.deepOption(TCASE, r).key, "none");
  Core.placeCard(r, "deep", "tes_eu");
  assert.strictEqual(Core.deepOption(TCASE, r).key, "none");
});
test("finish：記評價、解鎖下一案、記圖鑑與獨語與人物", function () {
  var s = Core.newSave();
  var r = Core.startCase(s, "case0");
  Core.visit(r, "s_sick"); Core.move(r, "p2"); Core.visit(r, "s_pot"); Core.visit(r, "s_led");
  Core.move(r, "p1"); Core.visit(r, "s_talk");
  // 病人證言 tes_pt 也拿來放深層臆測
  Core.giveRemedy(r, "pt", ["shengjiang", "gancao"]);
  Core.identify(r, "ev_tu", "banxia");
  assert.deepStrictEqual(Core.finish(s, r), { error: "phase" });
  Core.toBoard(r);
  Core.placeCard(r, "who", "p_eu"); Core.placeCard(r, "what", "herb:banxia");
  Core.placeCard(r, "how", "tes_eu"); Core.placeCard(r, "why", "ev_led"); Core.placeCard(r, "deep", "tes_pt");
  Core.submit(r); Core.present(r, "re_look") ; Core.present(r, "herb:banxia"); Core.present(r, "ev_led");
  var res = Core.finish(s, r);
  assert.strictEqual(res.rating, "A");   // mispresent 1（re_look 沒拿到 → 不持有，算錯）
  assert.deepStrictEqual(res.monologues, ["case0:main", "case0:a"]);
  assert.strictEqual(s.cases.case0.best, "A"); assert.strictEqual(s.cases.case0.cleared, true);
  assert.strictEqual(s.cases.case0.run, null);
  assert.ok(s.unlocked.indexOf("case1") >= 0);
  assert.strictEqual(s.herbsSeen.banxia, true);
  assert.strictEqual(s.monologues["case0:a"], true);
  assert.strictEqual(s.castSeen.maomao, true);
});

console.log("\n" + passed + " passed");
