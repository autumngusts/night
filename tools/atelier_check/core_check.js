// ============================================================================
// 煉金術士（atelier）規則核心檢查（不需要瀏覽器）。規則依據 docs/atelier_design.md。
// 執行：node tools/atelier_check/core_check.js
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
var T0 = Date.UTC(2026, 10, 19, 3, 0, 0);   // JST 12:00（沒有時間特性）

// 測試用：w×h 的 RGBA，左右兩半不同顏色
function split(left, right, w) {
  var a = new Uint8ClampedArray(w * w * 4);
  for (var y = 0; y < w; y++) for (var x = 0; x < w; x++) {
    var c = x < w / 2 ? left : right, i = (y * w + x) * 4;
    a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; a[i + 3] = 255;
  }
  return a;
}
function mat(uid, el, cat, shape, q, power) {
  return { uid: uid, hex: "#000000", rgb: [0, 0, 0], colorId: "sumi", element: el, category: cat,
    power: power || 2, quality: q || 50, traits: [], shape: shape, at: T0 };
}

// ---------- 色彩數學 ----------
test("HSV：純紅、純綠、灰", function () {
  var r = C.rgbToHsv([255, 0, 0]);
  assert.strictEqual(r.h, 0); assert.strictEqual(r.s, 1); assert.strictEqual(r.v, 1);
  assert.strictEqual(Math.round(C.rgbToHsv([0, 255, 0]).h), 120);
  assert.strictEqual(C.rgbToHsv([128, 128, 128]).s, 0);
});

test("Lab：白 L≈100、黑 L＝0", function () {
  assert(Math.abs(C.rgbToLab([255, 255, 255])[0] - 100) < 0.5);
  assert.strictEqual(Math.round(C.rgbToLab([0, 0, 0])[0]), 0);
});

test("傳統色：瑠璃色本身的最近色就是瑠璃色，距離 0", function () {
  var n = C.nearestColor(C.hexToRgb("#1E50A2"));
  assert.strictEqual(n.color.id, "ruri");
  assert(n.dist < 1e-9);
});

test("色相 → 屬性（含跨 0 度與無彩色）", function () {
  assert.strictEqual(C.elementOf({ h: 350, s: 0.8, v: 0.8 }), "fire");
  assert.strictEqual(C.elementOf({ h: 10, s: 0.8, v: 0.8 }), "fire");
  assert.strictEqual(C.elementOf({ h: 60, s: 0.8, v: 0.8 }), "bolt");
  assert.strictEqual(C.elementOf({ h: 120, s: 0.8, v: 0.8 }), "wind");
  assert.strictEqual(C.elementOf({ h: 220, s: 0.8, v: 0.8 }), "ice");
  assert.strictEqual(C.elementOf({ h: 290, s: 0.8, v: 0.8 }), "spirit");
  assert.strictEqual(C.elementOf({ h: 120, s: 0.05, v: 0.8 }), "spirit");
});

test("類別：暗 → 影、亮且淡 → 結晶、其他依屬性", function () {
  assert.strictEqual(C.categoryOf({ h: 0, s: 0.9, v: 0.1 }, "fire"), "shadow");
  assert.strictEqual(C.categoryOf({ h: 0, s: 0.1, v: 0.95 }, "spirit"), "crystal");
  assert.strictEqual(C.categoryOf({ h: 200, s: 0.8, v: 0.7 }, "ice"), "liquid");
  assert.strictEqual(C.categoryOf({ h: 120, s: 0.8, v: 0.7 }, "wind"), "plant");
});

// ---------- 照片分析 ----------
test("左右兩色的照片 → 2 個色塊，各約 50%，形狀 6 格", function () {
  var sw = C.analyze(split([200, 30, 30], [30, 60, 200], 32), 32, 32, "t1");
  assert.strictEqual(sw.length, 2);
  sw.forEach(function (s) {
    assert(Math.abs(s.frac - 0.5) < 0.01);
    assert.strictEqual(s.shape.length, 6);
  });
  var hexes = sw.map(function (s) { return s.hex; }).sort();
  assert.deepStrictEqual(hexes, ["#1E3CC8", "#C81E1E"]);
});

test("同一張照片、同一個 seed，結果完全相同（O11）", function () {
  var px = split([10, 200, 90], [240, 220, 40], 32);
  assert.deepStrictEqual(C.analyze(px, 32, 32, "same"), C.analyze(px, 32, 32, "same"));
});

test("形狀：連通、正規化到 (0,0)、旋轉 4 次回到原形", function () {
  var G = D.GRID, grid = [];
  for (var i = 0; i < G * G; i++) grid.push(i % G < 3 ? 1 : 0);   // 左邊 3 欄是 label 1
  var shape = C.shapeFromGrid(grid, 1, 5);
  assert.strictEqual(shape.length, 5);
  assert.strictEqual(Math.min.apply(null, shape.map(function (c) { return c[0]; })), 0);
  assert.strictEqual(Math.min.apply(null, shape.map(function (c) { return c[1]; })), 0);
  assert.deepStrictEqual(C.rotateShape(shape, 4), C.normalizeShape(shape));
  assert.deepStrictEqual(C.rotateShape([[0, 0], [1, 0], [2, 0]], 1), [[0, 0], [0, 1], [0, 2]]);
});

// ---------- 素材 ----------
test("素材：純度高的瑠璃色品質高，帶稀有色特性；時間特性依 JST", function () {
  var m = C.makeMaterial({ rgb: C.hexToRgb("#1E50A2"), hex: "#1E50A2", frac: 0.3, shape: [[0, 0]] }, T0, 1);
  assert.strictEqual(m.colorId, "ruri");
  assert.strictEqual(m.element, "ice");
  assert.strictEqual(m.category, "liquid");
  assert(m.quality >= 80, "quality " + m.quality);
  assert(m.traits.indexOf("hue_blessing") >= 0);
  assert(m.traits.indexOf("vivid") >= 0);
  assert.deepStrictEqual(C.timeTraits(Date.UTC(2026, 10, 18, 21, 0, 0)), ["morning_dew"]);   // JST 06:00
  assert.deepStrictEqual(C.timeTraits(Date.UTC(2026, 10, 18, 14, 0, 0)), ["night"]);         // JST 23:00
  assert.deepStrictEqual(C.timeTraits(T0), []);
});

test("採集籃：每次消耗 1，用完不能採；20 分回復 1，不超過上限", function () {
  var s = C.newSave(T0), sw = { rgb: [200, 30, 30], hex: "#C81E1E", frac: 0.5, shape: [[0, 0]] };
  for (var i = 0; i < D.BASKET_MAX; i++) assert(C.capture(s, [sw], T0));
  assert.strictEqual(C.capture(s, [sw], T0), null);
  assert.strictEqual(C.refillBasket(s, T0 + D.BASKET_REFILL_MS * 2 + 1000), 2);
  assert.strictEqual(C.refillBasket(s, T0 + D.BASKET_REFILL_MS * 100), D.BASKET_MAX);
  assert.strictEqual(C.capture(s, [sw, sw, sw, sw], T0), null, "一次最多 3 色");
  assert.strictEqual(s.mats.length, D.BASKET_MAX);
  assert(s.seen.akane || s.seen.beni || Object.keys(s.seen).length === 1);
});

console.log("\n" + passed + " passed");
