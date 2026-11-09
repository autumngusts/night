// ============================================================================
// 深夜居酒屋（izakaya）核心功能檢查（不開瀏覽器，直接用 Node 載入 static_src）。
// 執行：node tools/izakaya_check/core_check.js
// 每個 Task 往下追加一段（資料、名單、日循環、客人推理、口碑、劇情、戀愛、店員、尖峰、意圖）。
// ============================================================================
"use strict";
var fs = require("fs"), path = require("path"), assert = require("assert");
global.window = global;
global.I18N = { getLang: function () { return "zh"; }, t: function (k) { return k; } };
var SRC = path.join(__dirname, "..", "..", "static_src");
["izakaya_data.js", "izakaya_cast.js", "izakaya_story.js", "izakaya_story_main.js", "izakaya_story_arcs.js",
 "izakaya_story_staff.js", "izakaya_rush.js", "izakaya_core.js"].forEach(function (f) {
  eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8"));
});
var D = window.PriTestIzakayaData;

// ---------------- 1. 資料完整性 ----------------
(function () {
  var dishes = Object.keys(D.DISHES), food = dishes.filter(function (k) { return D.DISHES[k].cat !== "drink"; });
  var drinks = dishes.filter(function (k) { return D.DISHES[k].cat === "drink"; });
  assert.ok(food.length >= 48 && food.length <= 55, "料理約 50 道：" + food.length);
  assert.strictEqual(drinks.length, 20, "酒飲 20 種");
  var sig = {};
  dishes.forEach(function (k) {
    var d = D.DISHES[k];
    Object.keys(d.ing).forEach(function (i) { assert.ok(D.INGS[i], k + " 的食材不存在：" + i); });
    assert.strictEqual(d.f.length, 5, k + " 的口味向量要 5 維");
    d.tags.forEach(function (t) { assert.ok(D.TAGS.indexOf(t) >= 0, k + " 的標籤不合法：" + t); });
    assert.ok(["grill", "fry", "pot", "cold", "bar"].indexOf(d.st) >= 0, k + " 的工作站不合法");
    assert.ok(d.price > 0 && d.cook > 0, k + " 價格與烹調時間要大於 0");
    if (d.cat !== "drink") {
      // 研發用（食材集合＋手法）找菜：同一組合只能對到一道菜
      var key = Object.keys(d.ing).sort().join("+") + "@" + d.m;
      assert.ok(!sig[key], "研發組合重複：" + k + " 與 " + sig[key]);
      sig[key] = k;
    }
  });
  assert.ok(food.filter(function (k) { return D.DISHES[k].unlock === "start"; }).length >= 15, "開局料理至少 15 道");
  assert.ok(drinks.filter(function (k) { return D.DISHES[k].unlock === "start"; }).length >= 8, "開局酒飲至少 8 種");
  assert.strictEqual(D.SPOTS.length, 6, "1a 約會地點 6 個");
  assert.strictEqual(D.STAR_REP.length, 5);
  console.log("1. 資料完整性 OK（料理 " + food.length + "、酒飲 " + drinks.length + "）");
})();

console.log("ALL OK");
