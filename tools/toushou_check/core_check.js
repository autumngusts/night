// ============================================================================
// toushou（東正小遊戲）資料與規則引擎的 Node 單元檢查。
// 不需要瀏覽器：用 new Function 在假的 window 上載入 static_src 的檔案。
// 刻意不用 vm.createContext：不同 realm 的物件 prototype 不同，assert.deepStrictEqual 會誤判。
// 執行：node tools/toushou_check/core_check.js
// 規則依據：docs/superpowers/specs/2026-10-15-toushou-game-design.md
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SRC = path.join(__dirname, "..", "..", "static_src");
// 載入順序與頁面相同：共用資料 → 各類別資料 → 引擎
var DATA_FILES = [
  "toushou_data.js",
  "toushou_data_sengoku.js",
  "toushou_data_celebrity.js",
  "toushou_data_company.js",
  "toushou_data_region.js",
  "toushou_data_food.js",
  "toushou_data_anime.js"
];

function load(files) {
  var win = {};
  files.forEach(function (f) {
    new Function("window", fs.readFileSync(path.join(SRC, f), "utf8"))(win);
  });
  return win;
}

var results = { pass: 0, fail: 0 };
function check(name, fn) {
  try {
    fn();
    results.pass++;
    console.log("  ok   " + name);
  } catch (err) {
    results.fail++;
    console.log("  FAIL " + name + "\n       " + (err && err.message));
  }
}

var hasCore = fs.existsSync(path.join(SRC, "toushou_core.js"));
var w = load(hasCore ? DATA_FILES.concat(["toushou_core.js"]) : DATA_FILES);
var D = w.PriTestToushouData;
var Core = w.PriTestToushouCore;

var CATEGORY_IDS = ["sengoku_event", "sengoku_person", "jp_celebrity", "jp_company",
  "hokkaido", "tohoku", "kansai", "washoku", "yoshoku", "taiwan_food", "anime_game"];
var ROLES_ZH = {
  sengoku_event: "說書人", sengoku_person: "說書人", jp_celebrity: "經紀人", jp_company: "股東",
  hokkaido: "地產商", tohoku: "地產商", kansai: "地產商",
  washoku: "美食評論家", yoshoku: "美食評論家", taiwan_food: "美食評論家", anime_game: "黃牛"
};
function bilingual(o, label) { assert.ok(o && o.zh && o.ja, label + " missing zh/ja"); }

console.log("[data]");
check("data module loaded", function () { assert.ok(D, "PriTestToushouData missing"); });
check("11 categories in load order with role names", function () {
  assert.deepStrictEqual(D.CATEGORIES.map(function (c) { return c.id; }), CATEGORY_IDS);
  D.CATEGORIES.forEach(function (c) {
    bilingual(c.name, c.id);
    bilingual(c.role, c.id);
    assert.strictEqual(c.role.zh, ROLES_ZH[c.id], c.id);
  });
});
check("each category: 6 targets with summary, 2-3 tags, 3 hooks; ids unique", function () {
  var ids = {};
  CATEGORY_IDS.forEach(function (cid) {
    var list = D.TARGETS.filter(function (t) { return t.category === cid; });
    assert.strictEqual(list.length, 6, cid + " has " + list.length);
  });
  D.TARGETS.forEach(function (t) {
    assert.ok(!ids[t.id], "dup " + t.id); ids[t.id] = 1;
    bilingual(t.name, t.id);
    bilingual(t.summary, t.id);
    assert.ok(t.tags.length >= 2 && t.tags.length <= 3, t.id + " tags");
    assert.strictEqual(t.hooks.length, 3, t.id + " hooks");
    t.tags.concat(t.hooks).forEach(function (x) { bilingual(x, t.id); });
  });
});
check("12 common cards + 6 per category, valid tone, unique ids", function () {
  var ids = {};
  assert.strictEqual(D.NEWS_CARDS.filter(function (c) { return c.category === null; }).length, 12);
  CATEGORY_IDS.forEach(function (cid) {
    assert.strictEqual(D.NEWS_CARDS.filter(function (c) { return c.category === cid; }).length, 6, cid);
  });
  D.NEWS_CARDS.forEach(function (c) {
    assert.ok(!ids[c.id], "dup " + c.id); ids[c.id] = 1;
    assert.ok(["up", "down", "neutral"].indexOf(c.tone) >= 0, c.id);
    bilingual(c.text, c.id);
  });
});
check("{target} placeholder appears in both languages or neither", function () {
  D.NEWS_CARDS.forEach(function (c) {
    assert.strictEqual(c.text.zh.indexOf("{target}") >= 0, c.text.ja.indexOf("{target}") >= 0, c.id);
  });
});
check("celebrity excludes scandal card g05 only", function () {
  D.CATEGORIES.forEach(function (c) {
    assert.deepStrictEqual(c.excludeCommonCards, c.id === "jp_celebrity" ? ["g05"] : [], c.id);
  });
});
check("8 missions with known checks", function () {
  var known = ["firstPlaceAtLeast", "exactHit", "categoryRiseAtLeast", "anyTargetCrash",
    "finalRank", "allInOnce", "contrarian", "ownNewsSwing"];
  assert.strictEqual(D.MISSIONS.length, 8);
  D.MISSIONS.forEach(function (m) {
    assert.ok(known.indexOf(m.check) >= 0, m.id);
    assert.ok(m.reward > 0, m.id);
    bilingual(m.text, m.id);
  });
});
check("constants", function () {
  assert.strictEqual(D.HAND_SIZE, 5);
  assert.strictEqual(D.START_PRICE, 100);
  assert.deepStrictEqual(D.WIND_COMPOSITION, { up: 2, down: 2, neutral: 1 });
});
check("text() picks zh for zh, ja otherwise", function () {
  var o = { ja: "J", zh: "Z" };
  assert.strictEqual(D.text(o, "zh"), "Z");
  assert.strictEqual(D.text(o, "ja"), "J");
  assert.strictEqual(D.text(o, "en"), "J");
  assert.strictEqual(D.text({ ja: "", zh: "Z" }, "ja"), "Z");
  assert.strictEqual(D.text("plain", "ja"), "plain");
});

// @@CORE_CHECKS@@

console.log("\n" + results.pass + " passed, " + results.fail + " failed");
process.exit(results.fail ? 1 : 0);
