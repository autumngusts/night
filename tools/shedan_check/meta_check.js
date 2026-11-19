// ============================================================================
// 射彈宇宙（shedan）第 5 階段：局外成長、難度、每日星圖、存檔（§12、§12.1）。不需要瀏覽器。
// 執行：node tools/shedan_check/meta_check.js [名稱片段]
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
function load(n) { return require(path.join(SRC, n)); }
var D = load("shedan_data.js");
global.PriTestShedanData = D;
load("shedan_data_heroes.js");
load("shedan_data_enemies.js");
load("shedan_data_relics.js");
global.PriTestShedanRng = load("shedan_rng.js");
var Run = load("shedan_run.js");
var C = load("shedan_combat.js");
var E = D.ENEMY_BY_ID;

var passed = 0, only = process.argv[2];
function test(name, fn) { if (only && name.indexOf(only) < 0) return; fn(); passed++; console.log("ok - " + name); }
var TEAM = ["ignis", "rime", "volta", "nox"];

test("新 meta：只有初始 8 人、星塵 0、難度只有 0", function () {
  var m = Run.newMeta();
  assert.strictEqual(m.heroes.length, 8);
  assert.ok(m.heroes.every(function (id) { return D.HERO_BY_ID[id].initial; }));
  assert.strictEqual(m.stardust, 0);
  assert.strictEqual(Run.maxDifficulty(m), 0);
});

test("解鎖：角色 60、起始遺物 40（只限普通）；星塵不足／重複不行", function () {
  var m = Run.newMeta();
  assert.ok(!Run.unlockHero(m, "pyra"), "星塵不足");
  m.stardust = 130;
  assert.ok(Run.unlockHero(m, "pyra"));
  assert.strictEqual(m.stardust, 70);
  assert.ok(!Run.unlockHero(m, "pyra"), "重複");
  assert.ok(!Run.unlockHero(m, "ignis"), "初始角色本來就有");
  assert.ok(!Run.unlockStartRelic(m, "fuse"), "引信強化是稀有");
  assert.ok(Run.unlockStartRelic(m, "accel_ring"));
  assert.strictEqual(m.stardust, 30);
  assert.ok(!Run.unlockStartRelic(m, "spring"), "星塵不足");
  assert.strictEqual(D.RELICS.filter(function (r) { return Run.canStartRelic(r.id); }).length, 60);
});

test("normalizeMeta：壞檔回新 meta；補欄位、去掉不存在的 id、初始 8 人一定在", function () {
  assert.strictEqual(Run.normalizeMeta(null).heroes.length, 8);
  var m = Run.normalizeMeta({ stardust: 5, heroes: ["pyra", "ghost_hero"], startRelics: ["nope", "spring"] });
  assert.strictEqual(m.stardust, 5);
  assert.ok(m.heroes.indexOf("pyra") >= 0 && m.heroes.indexOf("ghost_hero") < 0 && m.heroes.length === 9);
  assert.deepStrictEqual(m.startRelics, ["spring"]);
  assert.strictEqual(m.cleared, -1);
});

test("星塵與結算：公式、星塵吸收器、最佳分數、通關解鎖下一難度（最高 5）", function () {
  var run = Run.create({ seed: "s", heroes: TEAM });
  run.stats.nodes = 10; run.stats.bosses = 2;
  assert.strictEqual(Run.stardust(run), 70);
  Run.addRelic(run, "stardust_absorber");
  assert.strictEqual(Run.stardust(run), 84);
  var m = Run.newMeta();
  run.state = "won";
  var out = Run.settle(m, run);
  assert.strictEqual(m.stardust, 84);
  assert.ok(out.newBest && m.best === out.score);
  assert.strictEqual(m.cleared, 0);
  assert.strictEqual(out.unlockedDifficulty, 1);
  assert.strictEqual(Run.maxDifficulty(m), 1);
  var r5 = Run.create({ seed: "s5", heroes: TEAM, difficulty: 5 });
  r5.state = "won"; m.cleared = 4;
  var o5 = Run.settle(m, r5);
  assert.strictEqual(m.cleared, 5);
  assert.strictEqual(o5.unlockedDifficulty, null, "已是最高");
  assert.strictEqual(Run.maxDifficulty(m), 5);
  var lost = Run.create({ seed: "l", heroes: TEAM, difficulty: 3 });
  lost.state = "lost"; m.cleared = 2;
  Run.settle(m, lost);
  assert.strictEqual(m.cleared, 2, "失敗不解鎖");
});

test("每日星圖：同日期同種子、地圖相同；紀錄只留 14 天、不影響難度", function () {
  assert.strictEqual(Run.dailySeed("2026-11-19"), Run.dailySeed("2026-11-19"));
  assert.notStrictEqual(Run.dailySeed("2026-11-19"), Run.dailySeed("2026-11-20"));
  assert.strictEqual(Run.todayStr(new Date(2026, 0, 5)), "2026-01-05");
  var a = Run.create({ seed: Run.dailySeed("2026-11-19"), heroes: TEAM, daily: "2026-11-19" });
  var b = Run.create({ seed: Run.dailySeed("2026-11-19"), heroes: ["lumen", "mist", "orbit", "flare"], daily: "2026-11-19" });
  assert.deepStrictEqual(Run.mapOf(a), Run.mapOf(b), "隊伍不同、地圖相同");
  var m = Run.newMeta();
  for (var d = 1; d <= 20; d++) {
    var r = Run.create({ seed: "d" + d, heroes: TEAM, daily: "2026-11-" + ("0" + d).slice(-2) });
    r.state = "won"; r.stats.nodes = d;
    Run.settle(m, r);
  }
  assert.strictEqual(Object.keys(m.daily).length, 14);
  assert.ok(m.daily["2026-11-20"] && !m.daily["2026-11-01"]);
  assert.strictEqual(m.cleared, -1, "每日星圖不解鎖難度");
});

test("難度 1：敵人 HP ×1.15；3：倒數 −1；5：Boss 多 1 個部位", function () {
  function mk(diff, boss) {
    return C.create({ heroes: TEAM.map(function (id) { return D.HERO_BY_ID[id]; }), enemies: [{ def: E.ore_crawler, x: 270, y: 600 }], boss: boss, difficulty: diff });
  }
  assert.strictEqual(mk(0).enemies[0].hpMax, 1500);
  assert.strictEqual(mk(1).enemies[0].hpMax, Math.round(1500 * 1.15));
  assert.strictEqual(mk(2).enemies[0].cdMax, E.ore_crawler.cd);
  assert.strictEqual(mk(3).enemies[0].cdMax, E.ore_crawler.cd - 1);
  var parts0 = mk(4, "void_ark").enemies.filter(function (e) { return e.role === "part"; });
  var b5 = mk(5, "void_ark");
  var parts5 = b5.enemies.filter(function (e) { return e.role === "part"; });
  assert.strictEqual(parts5.length, parts0.length + 1);
  assert.strictEqual(b5.wells.length, 4, "多出來的核心也有引力井");
});

test("難度 2：精英戰 2 隻精英；4：補給站價格 ×1.3（與會員卡相乘）", function () {
  var R = global.PriTestShedanRng;
  for (var s = 0; s < 20; s++) {
    var bt = Run.genBattle(R.make(s), { sector: 1, elite: true, difficulty: 2 });
    assert.strictEqual(bt.enemies.filter(function (e) { return e.elite; }).length, 2);
  }
  var r = Run.create({ seed: "p", heroes: TEAM, difficulty: 4 });
  assert.strictEqual(Run.price(r, "fuse"), Math.round(120 * 1.3));
  Run.addRelic(r, "merchant_card");
  assert.strictEqual(Run.price(r, "fuse"), Math.round(120 * 0.8 * 1.3));
});

test("存檔：序列化 → 還原後可走的節點、下一場戰鬥配置都相同；壞檔丟例外", function () {
  var run = Run.create({ seed: "save1", heroes: TEAM, relics: ["accel_ring"], difficulty: 2 });
  Run.enter(run, Run.reachable(run)[0]);
  Run.finishBattle(run, { win: true, hp: run.hp - 50, damage: 1234, maxChain: 2 });
  Run.takeRelic(run, run.pendingChoices[0]);
  var str = Run.serialize(run);
  var back = Run.restore(str);
  assert.deepStrictEqual(Run.reachable(back), Run.reachable(run));
  assert.strictEqual(back.hp, run.hp);
  assert.deepStrictEqual(back.relics, run.relics);
  var next = Run.reachable(run)[0];
  Run.enter(run, next); Run.enter(back, next);
  if (Run.inBattle(run)) {
    var s1 = Run.battleSetup(run), s2 = Run.battleSetup(back);
    assert.deepStrictEqual(s2.enemies.map(function (e) { return e.def.id + ":" + e.x + ":" + e.elite; }), s1.enemies.map(function (e) { return e.def.id + ":" + e.x + ":" + e.elite; }));
    assert.strictEqual(s2.enemies[0].def, D.ENEMY_BY_ID[s2.enemies[0].def.id], "def 換回資料物件");
    assert.strictEqual(s2.seed, s1.seed);
    assert.strictEqual(s2.difficulty, 2);
  }
  assert.ok(str.length < 200000, "存檔大小 " + str.length);
  assert.throws(function () { Run.restore("{}"); });
  assert.throws(function () { Run.restore("not json"); });
});

process.on("exit", function () { console.log("passed " + passed); });
