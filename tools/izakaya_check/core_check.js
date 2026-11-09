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

// ---------------- 2. 角色名單 ----------------
(function () {
  var Cast = window.PriTestIzakayaCast;
  assert.strictEqual(Cast.REGULARS.length, 6, "1a 常客 6 人");
  assert.strictEqual(Cast.STAFF.length, 10, "1a 店員 10 人");
  assert.strictEqual(Cast.ALL_PHOTOS.length, 191, "照片 191 張");
  Cast.ALL_PHOTOS.forEach(function (p) { assert.ok(fs.existsSync(path.join(SRC, "images", "jikan", p + ".webp")), "照片不存在：" + p); });
  var ids = {};
  Cast.REGULARS.concat(Cast.STAFF).forEach(function (c) {
    assert.ok(!ids[c.id], "角色 id 重複：" + c.id); ids[c.id] = 1;
    assert.ok(c.photo === undefined, c.id + " 不可寫死照片（每局輪換）");
    assert.ok(c.age >= 20, c.id + " 必須成年");
    assert.strictEqual(c.pref.length, 5);
    assert.strictEqual(c.likes.length, 2);
    c.likes.forEach(function (t) { assert.ok(D.LIKE_TAGS.indexOf(t) >= 0, c.id + " 的 likes 不合法：" + t); });
    assert.ok(D.SPOTS.some(function (s) { return s.id === c.favSpot; }), c.id + " 的 favSpot 不存在");
    ["confess", "propose", "wedding", "heart"].forEach(function (k) { assert.ok(c.lines[k], c.id + " 缺台詞 " + k); });
  });
  Cast.STAFF.forEach(function (c) { assert.ok(["fast", "memo", "bar", "host"].indexOf(c.ability) >= 0 && c.wage > 0, c.id + " 店員能力／薪水"); });
  // 照片輪換：同一局內不重複；不同種子的分配不同；同一種子結果相同
  function rng(seed) { return function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }
  var a = Cast.assignPhotos(rng(7)), b = Cast.assignPhotos(rng(8)), a2 = Cast.assignPhotos(rng(7));
  var used = Object.keys(a.photos).map(function (k) { return a.photos[k]; });
  assert.strictEqual(used.length, 16); assert.strictEqual(new Set(used.concat(a.rest)).size, 191, "同一局內不重複");
  assert.notDeepStrictEqual(a.photos, b.photos, "不同局要輪換");
  assert.deepStrictEqual(a.photos, a2.photos, "同一種子同一結果");
  var pool = Cast.genPool(rng(9), 60, a.rest);
  assert.strictEqual(pool.length, 60);
  pool.forEach(function (g) { assert.ok(a.rest.indexOf(g.photo) >= 0, "一般客只用剩下的照片：" + g.photo); });
  console.log("2. 角色名單 OK");
})();

console.log("ALL OK");
