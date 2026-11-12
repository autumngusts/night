// ============================================================================
// 緣日樂園（ennichi）核心規則檢查（不開瀏覽器，直接用 Node 載入 static_src）。
// 執行：node tools/ennichi_check/core_check.js
// 每個 Task 往下追加一段。
// ============================================================================
"use strict";
var fs = require("fs"), path = require("path"), assert = require("assert");
global.window = global;
global.I18N = { getLang: function () { return "zh"; }, t: function (k) { return k; } };
var SRC = path.join(__dirname, "..", "..", "static_src");
["ennichi_data.js", "ennichi_murmur.js", "ennichi_wish.js", "ennichi_core.js", "ennichi_sim.js"].forEach(function (f) {
  eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8"));
});
var D = window.PriTestEnnichiData;

// ---------------- 1. 資料完整性與層級規則 ----------------
(function () {
  var items = Object.keys(D.ITEMS), recipes = Object.keys(D.RECIPES);
  assert.strictEqual(Object.keys(D.MACHINES).length, 17, "機器 17 種");
  assert.strictEqual(recipes.length, 40, "配方 40 條");
  assert.strictEqual(items.filter(function (k) { return D.ITEMS[k].kind === "mat"; }).length, 14, "原料 14 種");
  recipes.forEach(function (rid) {
    var r = D.RECIPES[rid];
    assert.ok(D.MACHINES[r.m], rid + " 的機器不存在：" + r.m);
    assert.ok(r.out[rid] > 0, rid + " 的產物要等於配方 key");
    Object.keys(r.in).concat(Object.keys(r.out)).forEach(function (k) { assert.ok(D.ITEMS[k], rid + " 的物品不存在：" + k); });
    assert.ok(r.t > 0);
  });
  items.forEach(function (k) {
    var it = D.ITEMS[k];
    if (it.kind === "mat") { assert.ok(it.buy > 0, k + " 要有買價"); assert.ok(!D.RECIPES[k], k + " 是原料，不該有配方"); }
    else assert.ok(D.RECIPES[k], k + " 沒有配方");
    if (["food", "drink", "goods"].indexOf(it.kind) >= 0) assert.ok(it.sell > 0, k + " 要有售價");
    if (it.kind === "module" || it.kind === "upgrade") assert.ok(D.tierOf(k) >= 3, k + " 是模組，層級要 ≥ 3：" + D.tierOf(k));
    if (it.kind === "part") assert.ok(D.tierOf(k) >= 1 && D.tierOf(k) <= 2, k + " 是零件，層級 1〜2：" + D.tierOf(k));
  });
  // 每台機器至少有一條配方
  Object.keys(D.MACHINES).forEach(function (m) { assert.ok(recipes.some(function (r) { return D.RECIPES[r].m === m; }), m + " 沒有配方"); });
  // 建物：大型設施只用第三層模組；一般設施只用第二層以下的零件
  var rides = 0, stalls = 0, large = 0;
  Object.keys(D.BUILD).forEach(function (t) {
    var b = D.BUILD[t];
    assert.ok(b.w >= 1 && b.h >= 1 && b.lv >= 1 && b.lv <= 5, t + " 尺寸／等級");
    Object.keys(b.parts).forEach(function (k) {
      assert.ok(D.ITEMS[k], t + " 的材料不存在：" + k);
      if (b.large) assert.strictEqual(D.ITEMS[k].kind, "module", t + " 是大型設施，只能用模組：" + k);
      else assert.ok(D.ITEMS[k].kind === "part" && D.tierOf(k) <= 2, t + " 是一般設施，只能用第二層以下的零件：" + k);
    });
    if (b.kind === "ride") {
      rides++;
      assert.ok(b.cap > 0 && b.cycle > 0 && b.price >= 0 && b.wear > 0, t + " 搭乘數值");
      Object.keys(b.fix).forEach(function (k) { assert.ok(D.ITEMS[k].kind === "part", t + " 的修理零件要是零件：" + k); });
      if (b.large) {
        large++;
        assert.ok(b.days >= 1, t + " 大型設施要有組裝期");
        Object.keys(b.slots).forEach(function (sl) {
          assert.strictEqual(D.ITEMS[b.slots[sl].mod].kind, "upgrade", t + "." + sl + " 的改裝模組");
          assert.ok(b.slots[sl].n >= 1);
        });
      }
    }
    if (b.kind === "stall") { stalls++; b.sells.forEach(function (k) { assert.ok(["food", "drink", "goods"].indexOf(D.ITEMS[k].kind) >= 0, t + " 賣的不是商品：" + k); }); }
  });
  assert.strictEqual(rides, 8, "遊樂設施 8 種（規格 §10）"); assert.strictEqual(large, 4, "大型設施 4 種"); assert.strictEqual(stalls, 5, "攤位 5 種");
  assert.ok(D.BUILD.qstall && D.BUILD.qstall.kind === "qstall" && D.BUILD.shelter.serves === "shelter");
  function sumW(list) { return list.reduce(function (a, g) { return a + g.w; }, 0); }
  assert.ok(Math.abs(sumW(D.GUESTS) - 1) < 1e-9, "客群權重合計 1");
  assert.ok(Math.abs(sumW(Object.keys(D.WEATHER).map(function (k) { return D.WEATHER[k]; })) - 1) < 1e-9, "天氣權重合計 1");
  // 開局倉庫：夠蓋章魚燒攤、糖果攤、金魚撈、套圈圈、長椅（教學的前幾步）；旋轉木馬要自己建生產線
  var need = {};
  ["takoyakiSt", "ameSt", "kingyo", "wanage", "bench"].forEach(function (t) { var p = D.BUILD[t].parts; for (var k in p) need[k] = (need[k] || 0) + p[k]; });
  for (var k in need) assert.ok((D.START_WARE[k] || 0) >= need[k], "開局不夠：" + k);
  assert.ok(Object.keys(D.BUILD.merry.parts).some(function (k) { return !D.START_WARE[k]; }), "旋轉木馬不能一開局就蓋");
  assert.strictEqual(D.PHOTOS.length, 32);
  console.log("1. 資料與層級 OK");
})();
