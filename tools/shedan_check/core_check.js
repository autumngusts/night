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

// ---------------- 戰鬥規則（§2～§4） ----------------
var Combat = load("shedan_combat.js");
var H = D.HERO_BY_ID, E = D.ENEMY_BY_ID, K = D.C;
function battle(heroIds, enemies) {
  return Combat.create({
    heroes: heroIds.map(function (id) { return H[id]; }),
    enemies: enemies.map(function (x) { return { def: E[x[0]], x: x[1], y: x[2] }; })
  });
}
function uidOf(b, i) { return b.enemies[i].uid; }
function hit(b, i, step, speed) { return Combat.onHit(b, { enemy: uidOf(b, i), speed: speed == null ? K.SPEED_MAX : speed, step: step || 0 }); }
function types(cmds) { return cmds.map(function (c) { return c.type; }); }

test("倍率：Hit 每 10 下 +0.1、弱點 1.5／抗性 0.5、速度係數 0.4～1.0", function () {
  approx(Combat.hitMult(0), 1); approx(Combat.hitMult(9), 1); approx(Combat.hitMult(10), 1.1); approx(Combat.hitMult(25), 1.2);
  approx(Combat.elemMult(E.spore_drifter, "solar", false), 1.5);
  approx(Combat.elemMult(E.rock_worm, "comet", false), 0.5);
  approx(Combat.elemMult(E.rock_worm, "comet", true), 1, "腐蝕時抗性失效");
  approx(Combat.elemMult(E.rock_worm, "solar", false), 1);
  approx(Combat.speedFactor(K.SPEED_MAX * 2), 1); approx(Combat.speedFactor(0), 0.4); approx(Combat.speedFactor(K.SPEED_MAX / 2), 0.5);
});

test("撞擊傷害＝攻擊力×倍率；6 步內同一敵人不算新的 Hit；量表 +1", function () {
  var b = battle(["ignis", "rime", "volta", "nox"], [["rock_worm", 270, 300], ["spore_drifter", 100, 100]]);
  Combat.beginShot(b);
  hit(b, 0, 0);
  assert.strictEqual(b.enemies[0].hp, 600);
  assert.strictEqual(b.shot.hits, 1);
  assert.strictEqual(hit(b, 0, 3).length, 0);
  assert.strictEqual(b.shot.hits, 1);
  hit(b, 0, 10);
  assert.strictEqual(b.shot.hits, 2);
  assert.strictEqual(b.party[0].gauge, 2);
  hit(b, 1, 20);
  assert.strictEqual(b.enemies[1].hp, 220 - 150, "弱點 ×1.5");
  b.active = 1; Combat.beginShot(b);
  b.enemies[0].mark = null;
  hit(b, 0, 0);
  assert.strictEqual(b.enemies[0].hp, 600 - 100 - 58, "抗性：115×0.5 四捨五入");
});

test("印記：撞擊留下印記；不同屬性再撞觸發反應並消耗印記（蒸氣爆）", function () {
  var b = battle(["ignis", "rime", "volta", "nox"], [["ore_crawler", 270, 300], ["ore_crawler", 270, 420]]);
  Combat.beginShot(b);
  hit(b, 0, 0);
  assert.strictEqual(b.enemies[0].mark.el, "solar");
  b.active = 1; Combat.beginShot(b);
  var cmds = hit(b, 0, 0);
  var r = cmds.filter(function (c) { return c.type === "reaction"; })[0];
  assert.strictEqual(r.id, "steam");
  assert.strictEqual(b.enemies[0].mark, null);
  // 蒸氣爆：半徑 160、攻擊力 115×3=345，波及 120 外的另一隻
  assert.strictEqual(b.enemies[1].hp, 1500 - 345);
  assert.strictEqual(b.enemies[0].hp, 1500 - 150 - 115 - 345, "礦脈蠕弱點恆星：伊格妮第一下 ×1.5");
});

test("反應：超導（Hit 倍率 ×2）、湮滅（真實傷害）、坍縮（吸引＋爆炸）、共鳴", function () {
  var b = battle(["rime", "volta", "lumen", "nox"], [["ore_crawler", 270, 300], ["ore_crawler", 270, 480]]);
  Combat.beginShot(b); hit(b, 0, 0);          // 冰彗印記
  b.active = 1; Combat.beginShot(b);
  var before = b.enemies[0].hp;
  hit(b, 0, 0);                               // 雷漿 → 超導
  assert.ok(b.enemies[0].superconduct);
  assert.strictEqual(before - b.enemies[0].hp, Math.round(90 * 2), "超導讓這一下 Hit 倍率 ×2");
  Combat.endShot(b);
  assert.ok(!b.enemies[0].superconduct, "超導到本發結束");

  var b2 = battle(["lumen", "nox", "orbit", "ignis"], [["ore_crawler", 270, 300], ["ore_crawler", 270, 480]]);
  Combat.beginShot(b2); hit(b2, 0, 0);        // 光子印記
  b2.active = 1; Combat.beginShot(b2);
  var hp0 = b2.enemies[0].hp;
  hit(b2, 0, 0);                              // 虛空 → 湮滅 100×4
  assert.strictEqual(hp0 - b2.enemies[0].hp, 100 + 400);

  b2.active = 2; Combat.beginShot(b2);
  hit(b2, 0, 20);                             // 引力印記
  b2.active = 3; Combat.beginShot(b2);
  var y1 = b2.enemies[1].y;
  var cmds = hit(b2, 0, 40);                  // 恆星 → 坍縮：180 外的敵人被吸近
  assert.ok(types(cmds).indexOf("move") >= 0);
  assert.ok(b2.enemies[1].y < y1);

  var b3 = battle(["ignis", "lumen", "volta", "nox"], [["ore_crawler", 270, 300]]);
  Combat.beginShot(b3); hit(b3, 0, 0);
  b3.active = 1; Combat.beginShot(b3);
  var c3 = hit(b3, 0, 0);
  assert.strictEqual(c3.filter(function (c) { return c.type === "reaction"; })[0].id, "resonance");
});

test("連爆：擊破→爆炸→波及擊破→再爆炸，連鎖層數記錄", function () {
  var b = battle(["volta", "rime", "ignis", "nox"], [["spore_drifter", 100, 100], ["spore_drifter", 135, 100], ["spore_drifter", 170, 100], ["spore_drifter", 400, 100]]);
  b.enemies[0].hp = 1; b.enemies[1].hp = 30; b.enemies[2].hp = 30;
  Combat.beginShot(b);
  var cmds = hit(b, 0, 0);
  assert.ok(b.enemies[0].dead && b.enemies[1].dead && b.enemies[2].dead);
  assert.ok(!b.enemies[3].dead);
  assert.strictEqual(b.shot.chain, 3);
  assert.strictEqual(cmds.filter(function (c) { return c.type === "explode"; }).length, 3);
  var r = Combat.endShot(b);
  assert.strictEqual(b.stats.maxChain, 3);
  assert.strictEqual(r.next, "hero");
});

test("虛空印記的敵人被擊破不爆炸，改成全隊技能量表", function () {
  var b = battle(["nox", "rime", "ignis", "volta"], [["rock_worm", 100, 100], ["spore_drifter", 130, 100]]);
  b.enemies[0].hp = 1; b.enemies[1].hp = 10;
  Combat.beginShot(b);
  var cmds = hit(b, 0, 0);
  assert.ok(b.enemies[0].dead);
  assert.ok(!b.enemies[1].dead, "沒有爆炸波及");
  assert.strictEqual(types(cmds).indexOf("explode"), -1);
  var g = Math.floor(700 * K.VOID_GAUGE_RATIO / K.VOID_GAUGE_DIV);
  assert.strictEqual(b.party[1].gauge, g);
  assert.strictEqual(b.party[0].gauge, 1 + g);
});

test("雷漿撞擊放電弧、引力撞擊吸近附近敵人", function () {
  var b = battle(["volta", "orbit", "ignis", "nox"], [["ore_crawler", 100, 100], ["ore_crawler", 200, 100]]);
  Combat.beginShot(b);
  hit(b, 0, 0);
  assert.strictEqual(b.enemies[1].hp, 1500 - Math.round(90 * K.ARC_RATIO));
  b.active = 1; Combat.beginShot(b);
  b.enemies[0].mark = null;
  b.enemies[1].mark = null;
  var x1 = b.enemies[1].x;
  hit(b, 0, 0);
  assert.ok(b.enemies[1].x < x1, "被拉向撞擊點");
});

test("輪流射擊：4 人射完輪到敵人；敵人全滅判定勝利", function () {
  var b = battle(["ignis", "rime", "volta", "nox"], [["ore_crawler", 100, 100]]);
  var seq = [];
  for (var i = 0; i < 4; i++) { Combat.beginShot(b); seq.push(Combat.endShot(b).next); }
  assert.deepStrictEqual(seq, ["hero", "hero", "hero", "enemy"]);
  assert.strictEqual(b.active, 0);
  b.enemies[0].hp = 1;
  Combat.beginShot(b); hit(b, 0, 0);
  assert.strictEqual(Combat.endShot(b).next, "win");
});

test("敵人回合：倒數 −1、歸零攻擊並重置；冰彗印記倒數 +1 一次；灼燒；HP 歸零落敗", function () {
  var b = battle(["ignis", "rime", "volta", "nox"], [["sentry_drone", 100, 100], ["ore_crawler", 300, 300], ["ore_crawler", 300, 600]]);
  var hp0 = b.hp;
  var r = Combat.enemyTurn(b);
  assert.strictEqual(r.attacks.length, 1, "哨衛倒數 1");
  assert.strictEqual(b.hp, hp0 - 18);
  assert.strictEqual(b.enemies[0].cd, 1);
  assert.strictEqual(b.enemies[1].cd, 4);
  b.active = 1; Combat.beginShot(b); hit(b, 1, 0);
  assert.strictEqual(b.enemies[1].cd, 5, "冰彗 +1");
  b.enemies[1].mark = null; hit(b, 1, 20);
  assert.strictEqual(b.enemies[1].cd, 5, "只生效一次");
  b.active = 0; Combat.beginShot(b); hit(b, 2, 0);
  var h2 = b.enemies[2].hp;
  Combat.enemyTurn(b);
  assert.strictEqual(h2 - b.enemies[2].hp, Math.round(100 * K.BURN_RATIO), "灼燒");
  b.hp = 5;
  b.enemies[0].cd = 1;
  assert.ok(Combat.enemyTurn(b).lose);
});

// ---------------- 物理（matter.js） ----------------
var Physics = load("shedan_physics.js");
function world(enemies, heroPos) {
  var b = battle(["ignis", "rime", "volta", "nox"], enemies);
  var w = Physics.create({ Matter: Matter, battle: b, heroPos: heroPos });
  return { b: b, w: w };
}
function runShot(w, maxSteps) {
  var evs = [];
  for (var i = 0; i < (maxSteps || 5000); i++) {
    var e = Physics.step(w);
    evs = evs.concat(e);
    if (e.some(function (x) { return x.type === "stop"; })) break;
  }
  return evs;
}

test("物理：朝敵人射出產生 hit 事件（含速度與步數），最後一定停止", function () {
  var s = world([["ore_crawler", 270, 300]], [{ x: 270, y: 800 }, { x: 120, y: 860 }, { x: 420, y: 860 }, { x: 270, y: 900 }]);
  Physics.launch(s.w, 0, 0, -K.SPEED_MAX);
  var evs = runShot(s.w);
  var hits = evs.filter(function (e) { return e.type === "hit"; });
  assert.ok(hits.length >= 1, "至少撞到一次");
  assert.strictEqual(hits[0].enemy, s.b.enemies[0].uid);
  assert.ok(hits[0].speed > K.SPEED_MAX * 0.5, "撞擊時仍有速度 " + hits[0].speed);
  assert.ok(evs[evs.length - 1].type === "stop", "最後停止");
  var p = Physics.heroPos(s.w, 0);
  assert.ok(p.x > 0 && p.x < K.FIELD_W && p.y > 0 && p.y < K.FIELD_H);
});

test("物理：最大速度斜射不會穿出場地；隊友是感應區（穿過去、產生 ally 事件）", function () {
  var s = world([], [{ x: 270, y: 800 }, { x: 270, y: 500 }, { x: 60, y: 900 }, { x: 480, y: 900 }]);
  Physics.launch(s.w, 0, K.SPEED_MAX * 0.6, -K.SPEED_MAX * 0.8);
  var out = false, ally = false;
  for (var i = 0; i < 3000; i++) {
    var evs = Physics.step(s.w);
    if (evs.some(function (e) { return e.type === "ally"; })) ally = true;
    var p = Physics.heroPos(s.w, 0);
    if (p.x < 0 || p.x > K.FIELD_W || p.y < 0 || p.y > K.FIELD_H) out = true;
    if (evs.some(function (e) { return e.type === "stop"; })) break;
  }
  assert.ok(!out, "沒有穿牆");
  var s2 = world([], [{ x: 270, y: 800 }, { x: 270, y: 500 }, { x: 60, y: 900 }, { x: 480, y: 900 }]);
  Physics.launch(s2.w, 0, 0, -K.SPEED_MAX);
  var evs2 = runShot(s2.w);
  assert.ok(evs2.some(function (e) { return e.type === "ally" && e.ally === 1; }), "撞到隊友 1 產生 ally");
  var p1 = Physics.heroPos(s2.w, 1);
  assert.strictEqual(p1.x, 270); assert.strictEqual(p1.y, 500);
  void ally;
});

test("物理：移除敵人後不再撞到；moveEnemy 移動剛體", function () {
  var s = world([["ore_crawler", 270, 300]], [{ x: 270, y: 800 }, { x: 120, y: 860 }, { x: 420, y: 860 }, { x: 60, y: 900 }]);
  Physics.removeEnemy(s.w, s.b.enemies[0].uid);
  Physics.launch(s.w, 0, 0, -K.SPEED_MAX);
  var evs = runShot(s.w);
  assert.strictEqual(evs.filter(function (e) { return e.type === "hit"; }).length, 0);
  var s2 = world([["ore_crawler", 270, 300]], null);
  Physics.moveEnemy(s2.w, s2.b.enemies[0].uid, 100, 200);
  var body = s2.w.enemyBodies[s2.b.enemies[0].uid];
  assert.strictEqual(Math.round(body.position.x), 100);
  assert.strictEqual(Math.round(body.position.y), 200);
});

test("物理：停止判定有時間上限（SHOT_MAX_STEPS）", function () {
  var s = world([], null);
  Physics.launch(s.w, 0, K.SPEED_MAX, 0);
  s.w.bodies[0].frictionAir = 0;
  var evs = runShot(s.w, K.SHOT_MAX_STEPS + 10);
  assert.strictEqual(evs[evs.length - 1].type, "stop");
});

module.exports = { D: D, Rng: Rng, Matter: Matter, test: test, approx: approx, load: load };
if (require.main === module) process.on("exit", function () { console.log("passed " + passed); });
