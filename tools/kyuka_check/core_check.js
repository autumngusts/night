// ============================================================================
// 九華（kyuka）規則核心檢查（不需要瀏覽器）：
//   資料一致性（81 型不重複、各稀有度都有角色）、稀有度機率、9V 範圍與保底、十連保底、
//   花瓣解鎖（N/R 33・66、SR 33、SSR/UR 全開、解鎖順序＝三華合計由高到低）、型判定（主副、純粹型、同分）、
//   升級成長（上限、期望值在微幅範圍）、標籤（同一個體永遠相同、參考 9V 權重）。
// 執行：node tools/kyuka_check/core_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var D = require(path.join(__dirname, "..", "..", "static_src", "kyuka_data.js"));
global.PriTestKyukaData = D;
var C = require(path.join(__dirname, "..", "..", "static_src", "kyuka_core.js"));

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }
function inst(rarity, v) {
  var o = { rarity: rarity, v: v, v0: v, affection: 0, level: 1, seed: 1 };
  o.order = C.revealOrder(v);
  return o;
}
function vals(arr) { var v = {}; D.ORDER.forEach(function (k, i) { v[k] = arr[i]; }); return v; }

test("81 型名互不重複，開頭字也互不重複", function () {
  var all = [];
  D.ORDER.forEach(function (m) { assert.strictEqual(D.TYPE81[m].length, 9); all = all.concat(D.TYPE81[m]); });
  assert.strictEqual(new Set(all).size, 81);
  assert.strictEqual(new Set(all.map(function (s) { return s[0]; })).size, 81);
});

test("每個稀有度都有角色，機率合計 100", function () {
  var sum = 0;
  D.RARITIES.forEach(function (r) { sum += D.RARITY[r].rate; assert(D.HEROES.some(function (h) { return h.rarity === r; }), r); });
  assert.strictEqual(sum, 100);
});

test("抽 20 萬次：稀有度分布接近設定、9V 在保底～99 之間", function () {
  var rng = C.makeRng(42), cnt = {}, N = 200000;
  for (var i = 0; i < N; i++) {
    var x = C.pull(rng);
    cnt[x.rarity] = (cnt[x.rarity] || 0) + 1;
    if (i < 20000) D.ORDER.forEach(function (k) {
      assert(x.v[k] >= D.RARITY[x.rarity].floor && x.v[k] <= 99, x.rarity + " " + k + "=" + x.v[k]);
    });
  }
  D.RARITIES.forEach(function (r) {
    var pct = cnt[r] / N * 100;
    assert(Math.abs(pct - D.RARITY[r].rate) < 0.6, r + " " + pct.toFixed(2));
  });
});

test("十連：1000 次都至少有一張 SR 以上", function () {
  var rng = C.makeRng(7);
  for (var i = 0; i < 1000; i++) {
    var ten = C.pull10(rng);
    assert.strictEqual(ten.length, 10);
    assert(ten.some(function (x) { return D.RARITIES.indexOf(x.rarity) >= 2; }));
  }
});

test("N/R：一開始一華，親密度 33 第二華、66 全部", function () {
  ["N", "R"].forEach(function (r) {
    var x = inst(r, vals([50, 50, 50, 50, 50, 50, 50, 50, 50]));
    assert.strictEqual(C.visibleCount(x), 1);
    assert.deepStrictEqual(C.setAffection(x, 32), []);
    assert.strictEqual(C.visibleCount(x), 1);
    assert.strictEqual(C.setAffection(x, 33).length, 1);
    assert.strictEqual(C.visibleCount(x), 2);
    assert.strictEqual(C.nextUnlock(x), 66);
    C.setAffection(x, 66);
    assert.strictEqual(C.visibleCount(x), 3);
    assert.strictEqual(C.nextUnlock(x), null);
  });
});

test("SR：一開始兩華、33 全部；SSR/UR 一開始全部", function () {
  var sr = inst("SR", vals([50, 50, 50, 50, 50, 50, 50, 50, 50]));
  assert.strictEqual(C.visibleCount(sr), 2);
  C.setAffection(sr, 33);
  assert.strictEqual(C.visibleCount(sr), 3);
  ["SSR", "UR"].forEach(function (r) { assert.strictEqual(C.visibleCount(inst(r, vals([1, 1, 1, 1, 1, 1, 1, 1, 1]))), 3); });
});

test("解鎖順序：三華合計由高到低（心最高 → 先看到心）", function () {
  // 美 瑟 聲 | 柔 速 剛 | 心 智 緣  → 魅=30, 身=60, 心=270
  var x = inst("N", vals([10, 10, 10, 20, 20, 20, 90, 90, 90]));
  assert.deepStrictEqual(x.order, [2, 1, 0]);
  assert(C.isVisible(x, "智"));
  assert(!C.isVisible(x, "美"));
});

test("型：主＝最高、副＝第二高；差 25 以上為純粹型；同分依美→瑟→…", function () {
  var t = C.type81(vals([90, 85, 10, 10, 10, 10, 10, 10, 10]));
  assert.strictEqual(t.name, "迷人");
  t = C.type81(vals([20, 99, 10, 10, 80, 10, 10, 10, 10]));
  assert.strictEqual(t.name, "小惡魔");
  t = C.type81(vals([10, 10, 10, 10, 10, 10, 99, 74, 10]));
  assert.strictEqual(t.pure, true);
  assert.strictEqual(t.name, "貞德");
  t = C.type81(vals([10, 10, 10, 10, 10, 10, 99, 75, 10]));
  assert.strictEqual(t.pure, false, "差 24 不是純粹型");
  t = C.type81(vals([60, 60, 60, 10, 10, 10, 10, 10, 10]));
  assert.strictEqual(t.name, "迷人", "同分時美為主、瑟為副");
});

test("等級：S 90 以上、A 75、B 50、C 25、D 以下", function () {
  assert.strictEqual(C.grade(99), "S"); assert.strictEqual(C.grade(90), "S"); assert.strictEqual(C.grade(89), "A");
  assert.strictEqual(C.grade(50), "B"); assert.strictEqual(C.grade(25), "C"); assert.strictEqual(C.grade(24), "D");
});

test("升級：上限 50、9V 不超過 99、升滿的平均成長在微幅範圍（N 約 +7、UR 約 +12）", function () {
  ["N", "UR"].forEach(function (r) {
    var rng = C.makeRng(3), total = 0, runs = 400;
    for (var i = 0; i < runs; i++) {
      var x = inst(r, vals([50, 50, 50, 50, 50, 50, 50, 50, 50]));
      while (C.levelUp(x, rng)) {}
      assert.strictEqual(x.level, 50);
      assert.strictEqual(C.levelUp(x, rng), null);
      D.ORDER.forEach(function (k) { total += x.v[k] - 50; });
    }
    var avg = total / runs / 9, exp = 49 * D.RARITY[r].growth;
    assert(Math.abs(avg - exp) < 0.6, r + " 平均 " + avg.toFixed(2) + " 期望 " + exp);
  });
  var top = inst("UR", vals([99, 99, 99, 99, 99, 99, 99, 99, 99]));
  while (C.levelUp(top, C.makeRng(1))) {}
  D.ORDER.forEach(function (k) { assert.strictEqual(top.v[k], 99); });
});

test("標籤：同一個體每次都一樣、成長不影響、不同個體會不同；速高的個體多為「逃」", function () {
  var rng = C.makeRng(11), seen = {}, fastEscape = 0, slowEscape = 0;
  for (var i = 0; i < 3000; i++) {
    var x = C.pull(rng);
    var a = C.tag(x, "run");
    while (C.levelUp(x, rng)) {}
    assert.strictEqual(C.tag(x, "run"), a);
    seen[a] = 1;
  }
  assert.strictEqual(Object.keys(seen).length, 4);
  for (var j = 0; j < 4000; j++) {
    var fast = inst("N", vals([30, 30, 30, 30, 99, 30, 30, 30, 30])); fast.seed = j * 7919;
    var slow = inst("N", vals([30, 30, 30, 30, 1, 30, 30, 30, 30])); slow.seed = j * 7919;
    if (C.tag(fast, "run") === "逃") fastEscape++;
    if (C.tag(slow, "run") === "逃") slowEscape++;
  }
  assert(fastEscape > slowEscape * 1.5, fastEscape + " vs " + slowEscape);
});

console.log("\n" + passed + " 項全部通過");
