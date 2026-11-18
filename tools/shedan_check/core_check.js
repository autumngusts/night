// ============================================================================
// 射彈宇宙（shedan）規則核心檢查（不需要瀏覽器）：
//   資料（角色 30／初始 8、7 屬性、星區 1 敵人 16、反應表）、種子亂數、
//   戰鬥規則（Hit 倍率、屬性倍率、印記與反應、連爆、敵人回合、勝負）、
//   物理（matter.js：撞擊事件、停止判定、不穿牆、移除與吸引）。
// 規則依據 docs/shedan_game_design.md。執行：node tools/shedan_check/core_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
function load(name) { return require(path.join(SRC, name)); }

var Matter = load("vendor/matter.min.js");
global.Matter = Matter;
var Rng = load("shedan_rng.js");
var D = load("shedan_data.js");
load("shedan_data_heroes.js");
load("shedan_data_enemies.js");

var passed = 0;
var only = process.argv[2];
function test(name, fn) {
  if (only && name.indexOf(only) < 0) return;
  fn(); passed++; console.log("ok - " + name);
}
function approx(a, b, msg) { assert.ok(Math.abs(a - b) < 1e-6, (msg || "") + " expected " + b + " got " + a); }

// ---------------- 資料與亂數 ----------------
test("角色 30 人、初始 8 人、7 屬性都有角色、id 不重複", function () {
  assert.strictEqual(D.HEROES.length, 30);
  assert.strictEqual(D.HEROES.filter(function (h) { return h.initial; }).length, 8);
  D.ELEMENTS.forEach(function (el) {
    assert.ok(D.HEROES.some(function (h) { return h.element === el; }), el);
    assert.ok(D.HEROES.some(function (h) { return h.element === el && h.initial; }), "initial " + el);
  });
  assert.strictEqual(new Set(D.HEROES.map(function (h) { return h.id; })).size, 30);
  D.HEROES.forEach(function (h) {
    assert.ok(h.name.zh && h.name.ja && h.name.en, h.id);
    assert.ok(h.atk > 0 && h.hp > 0 && h.gauge > 0, h.id);
    assert.ok(/^g_\d{3}\.webp$/.test(h.img), h.id);
  });
});

test("星區 1 敵人 16 種，數值與屬性合法", function () {
  var s1 = D.ENEMIES.filter(function (e) { return e.sector === 1; });
  assert.strictEqual(s1.length, 16);
  D.ENEMIES.forEach(function (e) {
    assert.ok(e.name.zh && e.name.ja && e.name.en, e.id);
    assert.ok(D.SIZE_R[e.size], e.id);
    assert.ok(e.hp > 0 && e.atk > 0 && e.cd >= 1, e.id);
    e.weak.concat(e.resist).forEach(function (el) { assert.ok(D.ELEMENTS.indexOf(el) >= 0, e.id + " " + el); });
  });
});

test("反應表：7 種情形，與順序無關，同屬性不反應", function () {
  function id(a, b) { var r = D.reactionFor(a, b); return r && r.id; }
  assert.strictEqual(id("solar", "comet"), "steam");
  assert.strictEqual(id("comet", "solar"), "steam");
  assert.strictEqual(id("comet", "plasma"), "superconduct");
  assert.strictEqual(id("plasma", "nebula"), "ionize");
  assert.strictEqual(id("nebula", "solar"), "wildfire");
  assert.strictEqual(id("photon", "void"), "annihilate");
  assert.strictEqual(id("gravity", "photon"), "collapse");
  assert.strictEqual(id("solar", "gravity"), "collapse");
  assert.strictEqual(id("solar", "photon"), "resonance");
  assert.strictEqual(D.reactionFor("solar", "solar"), null);
});

test("種子亂數：同種子序列相同、不同種子不同、int 在範圍內", function () {
  var a = Rng.make(42), b = Rng.make(42), c = Rng.make(43);
  var sa = [], sb = [], sc = [];
  for (var i = 0; i < 20; i++) { sa.push(a()); sb.push(b()); sc.push(c()); }
  assert.deepStrictEqual(sa, sb);
  assert.notDeepStrictEqual(sa, sc);
  var r = Rng.make(7);
  for (var j = 0; j < 200; j++) { var v = Rng.int(r, 3, 5); assert.ok(v >= 3 && v <= 5); }
  assert.strictEqual(Rng.hashStr("2026-11-18"), Rng.hashStr("2026-11-18"));
  assert.notStrictEqual(Rng.hashStr("2026-11-18"), Rng.hashStr("2026-11-19"));
});

module.exports = { D: D, Rng: Rng, Matter: Matter, test: test, approx: approx, load: load };
if (require.main === module) process.on("exit", function () { console.log("passed " + passed); });
