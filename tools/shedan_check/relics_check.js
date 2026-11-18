// ============================================================================
// 射彈宇宙（shedan）第 4 階段：遺物、套裝、事件資料＋遺物在戰鬥中的效果（§9、§10、§10.1、§11.1）。
// 執行：node tools/shedan_check/relics_check.js [名稱片段]
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
function load(n) { return require(path.join(SRC, n)); }
var D = load("shedan_data.js");
load("shedan_data_heroes.js");
load("shedan_data_enemies.js");
load("shedan_data_relics.js");
var C = load("shedan_combat.js");
var H = D.HERO_BY_ID, E = D.ENEMY_BY_ID, K = D.C;

var passed = 0, only = process.argv[2];
function test(name, fn) { if (only && name.indexOf(only) < 0) return; fn(); passed++; console.log("ok - " + name); }

// ---------------- 資料 ----------------
test("遺物 100 件：10 標籤各 9 件主標籤＋無標籤 10、id 不重複、三語名稱", function () {
  assert.strictEqual(D.RELICS.length, 100);
  assert.strictEqual(new Set(D.RELICS.map(function (r) { return r.id; })).size, 100);
  var first = {};
  D.RELICS.forEach(function (r) {
    var k = r.tags[0] || "none";
    first[k] = (first[k] || 0) + 1;
    assert.ok(r.name.zh && r.name.ja && r.name.en, r.id);
    r.tags.forEach(function (t) { assert.ok(D.TAGS.indexOf(t) >= 0, r.id + " " + t); });
  });
  D.TAGS.forEach(function (t) { assert.strictEqual(first[t], 9, t); });
  assert.strictEqual(first.none, 10);
});

test("稀有度：傳說 10、稀有 30、普通 60；雙重殘影需要殘影投影機", function () {
  var n = { common: 0, rare: 0, legendary: 0 };
  D.RELICS.forEach(function (r) { n[r.rarity]++; });
  assert.deepStrictEqual(n, { common: 60, rare: 30, legendary: 10 });
  assert.strictEqual(D.RELIC_BY_ID.double_ghost.requires, "ghost_projector");
});

test("套裝 10 種；事件 8 則（兩個選項都有三語）", function () {
  assert.strictEqual(Object.keys(D.SETS).length, 10);
  D.TAGS.forEach(function (t) { assert.ok(D.SETS[t] && D.SETS[t].t3 && D.SETS[t].t5, t); });
  assert.strictEqual(D.EVENTS.length, 8);
  D.EVENTS.forEach(function (e) { ["zh", "ja", "en"].forEach(function (l) { assert.ok(e.name[l] && e.text[l] && e.a.label[l] && e.b.label[l], e.id + l); }); });
});

test("computeMods：數字相加、旗標 OR、套裝 3／5 件門檻（任一標籤都算）", function () {
  var m = D.computeMods(["fuse", "unstable_core", "spring", "accel_ring"]);
  assert.strictEqual(m.chainDmg, 0.2);
  assert.strictEqual(m.dmgAll, 0.3);
  assert.strictEqual(m.unstable, true);
  assert.strictEqual(m.chainRadius || 0, 0, "爆裂只有 2 件，未達 3");
  var m3 = D.computeMods(["fuse", "unstable_core", "ground_zero"]);
  assert.strictEqual(m3.chainRadius, 0.3, "爆裂 3 件");
  assert.strictEqual(m3.chainDepthBoost || 0, 0);
  var m5 = D.computeMods(["fuse", "unstable_core", "ground_zero", "shockwave", "star_blast"]);
  assert.strictEqual(m5.chainDepthBoost, 0.15, "星座爆破的第二標籤「爆裂」也算");
  var mg = D.computeMods(["coolant", "charged_cell", "skill_circuit"]);
  assert.strictEqual(mg.gaugeMaxMinus, 6, "冷卻劑 3 ＋技能套裝 3");
});

process.on("exit", function () { console.log("passed " + passed); });
module.exports = { test: test };
