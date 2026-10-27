// ============================================================================
// toushou 滿分男模式（manfen）的 Node 單元檢查：資料與規則引擎。
// 執行：node tools/toushou_check/manfen_core_check.js
// 規則依據：docs/superpowers/specs/2026-10-27-toushou-manfen-mode-design.md
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SRC = path.join(__dirname, "..", "..", "static_src");
// 載入順序與頁面 TOUSHOU_SCRIPTS 相同
var FILES = [
  "toushou_data.js",
  "toushou_data_sengoku.js",
  "toushou_data_celebrity.js",
  "toushou_data_company.js",
  "toushou_data_region.js",
  "toushou_data_food.js",
  "toushou_data_anime.js",
  "toushou_data_culture.js",
  "toushou_data_taiwan.js",
  "toushou_data_ext.js",
  "toushou_data_manfen.js",
  "toushou_core.js",
  "toushou_core_manfen.js"
].filter(function (f) { return fs.existsSync(path.join(SRC, f)); });

var win = {};
FILES.forEach(function (f) { new Function("window", fs.readFileSync(path.join(SRC, f), "utf8"))(win); });
var D = win.PriTestToushouData;
var Core = win.PriTestToushouCore;
var M = win.PriTestToushouManfen;

var results = { pass: 0, fail: 0 };
function check(name, fn) {
  try { fn(); results.pass++; console.log("  ok   " + name); }
  catch (err) { results.fail++; console.log("  FAIL " + name + "\n       " + (err && err.message)); }
}

var MF_IDS = ["mf_man", "mf_woman", "mf_job", "mf_home", "mf_roommate", "mf_travel"];

check("manfen categories registered in order with phrase containing {flaw}", function () {
  assert.deepStrictEqual(D.MANFEN_CATEGORIES.map(function (c) { return c.id; }), MF_IDS);
  D.MANFEN_CATEGORIES.forEach(function (c) {
    assert.ok(c.phrase.zh.indexOf("{flaw}") >= 0 && c.phrase.ja.indexOf("{flaw}") >= 0, c.id);
    assert.ok(c.name.zh && c.name.ja, c.id);
  });
  assert.ok(D.MANFEN_CLASSIC_PHRASE.zh.indexOf("{target}") >= 0 && D.MANFEN_CLASSIC_PHRASE.zh.indexOf("{flaw}") >= 0);
});

check("manfen categories are not mixed into classic CATEGORIES", function () {
  D.CATEGORIES.forEach(function (c) { assert.ok(MF_IDS.indexOf(c.id) < 0, c.id); });
});

check("each manfen category has exactly 40 targets and 32 own flaw cards, bilingual", function () {
  MF_IDS.forEach(function (id) {
    var ts = D.MANFEN_TARGETS.filter(function (t) { return t.category === id; });
    assert.strictEqual(ts.length, 40, id + " targets " + ts.length);
    ts.forEach(function (t) {
      assert.ok(t.name.zh && t.name.ja && t.summary.zh && t.summary.ja, t.id);
      assert.ok(t.tags.length >= 2 && t.tags.length <= 3, t.id);
    });
    var fs2 = D.FLAW_CARDS.filter(function (f) { return f.category === id; });
    assert.strictEqual(fs2.length, 32, id + " flaws " + fs2.length);
    fs2.forEach(function (f) { assert.ok(f.text.zh && f.text.ja, f.id); });
  });
});

check("common flaw cards: exactly 30, category null, bilingual", function () {
  var common = D.FLAW_CARDS.filter(function (f) { return f.category === null; });
  assert.strictEqual(common.length, 30, String(common.length));
  common.forEach(function (f) { assert.ok(f.text.zh && f.text.ja, f.id); });
});

// 只檢查新資料：既有資料的 id 不在本計畫範圍
check("manfen ids are unique and do not collide with classic targets / news cards", function () {
  var classicT = {};
  D.TARGETS.forEach(function (t) { classicT[t.id] = 1; });
  var seen = {};
  D.MANFEN_TARGETS.forEach(function (t) { assert.ok(!seen[t.id] && !classicT[t.id], "dup " + t.id); seen[t.id] = 1; });
  var news = {};
  D.NEWS_CARDS.forEach(function (c) { news[c.id] = 1; });
  seen = {};
  D.FLAW_CARDS.forEach(function (c) { assert.ok(!seen[c.id] && !news[c.id], "dup " + c.id); seen[c.id] = 1; });
});

check("manfen swan deck: 15 events + calm, composition calm 5", function () {
  var ids = D.MANFEN_SWAN_CARDS.map(function (c) { return c.id; });
  assert.deepStrictEqual(ids, ["circuit", "hype", "whale", "fomo", "panic", "lull", "exhausted", "rumor",
    "gag", "extra", "reverse", "trial", "cancel", "upset", "bailout", "calm"]);
  assert.deepStrictEqual(D.MANFEN_SWAN_COMPOSITION, { calm: 5 });
  D.MANFEN_SWAN_CARDS.forEach(function (c) { assert.ok(c.name.zh && c.name.ja && c.text.zh && c.text.ja, c.id); });
});

// ---- 規則引擎（Task 3 起） ----
if (M) {
  // （Task 3～6 的檢查加在這裡）
}

console.log("\n" + results.pass + " passed, " + results.fail + " failed");
process.exit(results.fail ? 1 : 0);
