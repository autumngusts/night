// ============================================================================
// 射彈宇宙（shedan）第 3 階段規則檢查（不需要瀏覽器）：
//   敵人 50 種的資料與特性（§6、§6.1）、Boss 部位破壞（§7、§7.1）、物理層的敵人相關功能。
//   期望值一律從資料與常數算。執行：node tools/shedan_check/enemies_check.js [名稱片段]
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
function load(n) { return require(path.join(SRC, n)); }
var Matter = load("vendor/matter.min.js");
var D = load("shedan_data.js");
load("shedan_data_heroes.js");
load("shedan_data_enemies.js");
var C = load("shedan_combat.js");
var P = load("shedan_physics.js");
var H = D.HERO_BY_ID, E = D.ENEMY_BY_ID, K = D.C;

var passed = 0, only = process.argv[2];
function test(name, fn) { if (only && name.indexOf(only) < 0) return; fn(); passed++; console.log("ok - " + name); }

function battle(enemies, opts) {
  opts = opts || {};
  var b = C.create({
    heroes: (opts.heroes || ["ignis", "rime", "volta", "nox"]).map(function (id) { return H[id]; }),
    enemies: enemies.map(function (x) { return { def: E[x[0]], x: x[1], y: x[2] }; }),
    boss: opts.boss, field: opts.field
  });
  b.rng = opts.rng || function () { return 0.5; };
  return b;
}
function hit(b, i, step) { return C.onHit(b, { enemy: b.enemies[i].uid, speed: K.SPEED_MAX, step: step || 0, vx: 0, vy: -10 }); }
function of(cmds, type) { return cmds.filter(function (c) { return c.type === type; }); }
function dmgTo(cmds, uid, kind) { return of(cmds, "damage").filter(function (c) { return c.uid === uid && (!kind || c.kind === kind); }).reduce(function (s, c) { return s + c.amount; }, 0); }
function byId(b, id) { return b.enemies.filter(function (e) { return e.def.id === id; }); }
var ATK = H.ignis.atk; // 伊格妮（恆星）

// ---------------- 資料 ----------------
test("敵人 50 種：星區 16／17／17，特性鍵都認得，星區倍率", function () {
  var n = [0, 0, 0, 0];
  D.ENEMIES.forEach(function (e) {
    n[e.sector]++;
    assert.ok(C.ENEMY_TRAITS.indexOf(e.trait) >= 0, e.id + " " + e.trait);
    assert.ok(e.name.zh && e.name.ja && e.name.en, e.id);
  });
  assert.deepStrictEqual(n.slice(1), [16, 17, 17]);
  assert.strictEqual(D.ENEMIES.length, 50);
  assert.strictEqual(E.nebula_jelly.hp, Math.round(700 * 1.4));
  assert.strictEqual(E.void_eye.atk, Math.round(40 * 1.9));
  assert.strictEqual(D.BOSSES.length, 3);
  D.BOSSES.forEach(function (x) { assert.ok(x.body.hp > 0 && x.parts.length >= 2, x.id); });
});

// ---------------- 減傷類 ----------------
test("岩殼龜撞擊 ×0.7、黑曜騎士撞擊 ×0.5 爆炸全額", function () {
  var b = battle([["shell_turtle", 270, 300]]);
  C.beginShot(b);
  assert.strictEqual(dmgTo(hit(b, 0), b.enemies[0].uid, "hit"), Math.round(ATK * 0.7));
  var b2 = battle([["obsidian_knight", 270, 300], ["spore_drifter", 270, 360]]);
  b2.enemies[1].hp = 1;
  C.beginShot(b2); b2.active = 2;  // 沃爾塔（雷漿）避免弱點
  var c = C.onHit(b2, { enemy: b2.enemies[1].uid, speed: K.SPEED_MAX, step: 0 });
  var ex = dmgTo(c, b2.enemies[0].uid, "explode");
  assert.ok(ex > 0, "爆炸全額");
  var c2 = C.onHit(b2, { enemy: b2.enemies[0].uid, speed: K.SPEED_MAX, step: 30 });
  assert.strictEqual(dmgTo(c2, b2.enemies[0].uid, "hit"), Math.round(H.volta.atk * 0.5));
});

test("盾衛 120 內 ×0.5、星雲水母 150 內 ×0.8；星雲印記（腐蝕）無視", function () {
  var b = battle([["ore_crawler", 270, 300], ["shield_guard", 270, 400]]);
  C.beginShot(b); b.active = 2;
  assert.strictEqual(dmgTo(hit(b, 0), b.enemies[0].uid, "hit"), Math.round(H.volta.atk * 0.5));
  var b2 = battle([["ore_crawler", 270, 300], ["nebula_jelly", 270, 420]]);
  C.beginShot(b2); b2.active = 2;
  assert.strictEqual(dmgTo(hit(b2, 0), b2.enemies[0].uid, "hit"), Math.round(H.volta.atk * 0.8));
  // 用「歸零」的腐蝕（放星雲印記的話，雷漿一撞會先引發電離雲把印記消耗掉）
  b2.nullTurns = 1;
  b2.enemies[0].mark = null;
  b2.shot.lastHit = {};
  var c = C.onHit(b2, { enemy: b2.enemies[0].uid, speed: K.SPEED_MAX, step: 0 });
  assert.strictEqual(dmgTo(c, b2.enemies[0].uid, "hit"), H.volta.atk, "腐蝕時無視水母");
});

test("護盾母體 ×0.2；星雲印記或爆炸破盾", function () {
  var b = battle([["shield_mother", 270, 300]]);
  C.beginShot(b); b.active = 2;
  assert.strictEqual(dmgTo(hit(b, 0), b.enemies[0].uid, "hit"), Math.round(H.volta.atk * 0.2));
  assert.ok(b.enemies[0].shielded);
  b.active = 0; C.beginShot(b);
  b.party[0].element = "nebula";
  b.enemies[0].mark = null;   // 留著雷漿印記的話會先引發電離雲，不會附加星雲印記
  hit(b, 0, 40);
  assert.ok(!b.enemies[0].shielded, "星雲印記破盾");
  var b2 = battle([["shield_mother", 270, 300], ["spore_drifter", 270, 360]]);
  b2.enemies[1].hp = 1; C.beginShot(b2);
  hit(b2, 1);
  assert.ok(!b2.enemies[0].shielded, "爆炸破盾");
});

test("噬光蟲：光子傷害改為回復；共生珊瑚 200 內 HP 不低於 1", function () {
  var b = battle([["light_eater", 270, 300]], { heroes: ["lumen", "rime", "volta", "nox"] });
  b.enemies[0].hp = 100;
  C.beginShot(b);
  var c = hit(b, 0);
  assert.ok(b.enemies[0].hp > 100 && of(c, "enemyHeal").length === 1);
  var b2 = battle([["spore_drifter", 270, 300], ["symbiote_coral", 270, 450]]);
  b2.enemies[0].hp = 5; C.beginShot(b2); hit(b2, 0);
  assert.strictEqual(b2.enemies[0].hp, 1);
  assert.ok(!b2.enemies[0].dead);
});

// ---------------- 被撞反應 ----------------
test("被撞反應：冰晶減速、迴旋刃轉向、反物質加速、電鰻扣量表、水雷自爆扣 HP 5%", function () {
  function struck(id, heroes) {
    var b = battle([[id, 270, 300]], { heroes: heroes });
    C.beginShot(b);
    return { b: b, c: hit(b, 0) };
  }
  assert.strictEqual(of(struck("ice_crystal").c, "shooterVel")[0].mult, 0.8);
  assert.ok(of(struck("spin_blade").c, "shooterVel")[0].rotate !== undefined);
  assert.strictEqual(of(struck("antimatter_orb").c, "shooterVel")[0].mult, 1.5);
  var s = struck("volt_eel");
  assert.strictEqual(s.b.party[0].gauge, 0, "+1 後 −1");
  var m = struck("drift_mine");
  assert.ok(m.b.enemies[0].dead);
  assert.strictEqual(m.b.hp, m.b.hpMax - Math.round(m.b.hpMax * 0.05));
});

test("紗幕「隱蔽」那一發不觸發被撞反應；塵埃雲（非 ★）照樣減速一次", function () {
  var b = battle([["ice_crystal", 270, 300], ["dust_cloud", 100, 300]], { heroes: ["veil", "rime", "volta", "nox"] });
  b.party[0].gauge = b.party[0].gaugeMax;
  C.beginShot(b, { skill: true });
  assert.strictEqual(of(hit(b, 0), "shooterVel").length, 0);
  assert.strictEqual(of(hit(b, 1, 0), "shooterVel").length, 1);
  assert.strictEqual(of(hit(b, 1, 20), "shooterVel").length, 0, "每發一次");
});

test("稜鏡獸：被撞過的那一發結束時換弱點；鏡像分身：抗性 = 射出者屬性", function () {
  var b = battle([["prism_beast", 270, 300], ["mirror_clone", 100, 100], ["prism_beast", 400, 600]], { rng: function () { return 0; } });
  b.enemies[0].weak = ["void"]; b.enemies[2].weak = ["void"];   // rng=0 → 換成第一個屬性（恆星）
  C.beginShot(b); hit(b, 0); C.endShot(b);
  assert.deepStrictEqual(b.enemies[0].weak, [D.ELEMENTS[0]], "被撞過的換弱點");
  assert.deepStrictEqual(b.enemies[2].weak, ["void"], "沒被撞的不換");
  assert.deepStrictEqual(b.enemies[1].resist, ["solar"]);
});

test("回聲體：被撞後的下一個敵人回合生成 HP 1 的殘影", function () {
  var b = battle([["echo_body", 270, 300]]);
  C.beginShot(b); hit(b, 0); C.endShot(b);
  var r = C.enemyTurn(b);
  var sp = of(r.cmds, "spawn");
  assert.strictEqual(sp.length, 1);
  assert.strictEqual(C.byUid(b, sp[0].uid).hp, 1);
});

// ---------------- 擊破時 ----------------
test("擊破時：分裂（2 隻 30%）、寄生藤隨宿主、酸液、虛空眼扣量表、遺忘者清印記、自爆球半徑 ×2", function () {
  var b = battle([["splitter", 270, 300]]);
  b.enemies[0].hp = 1; C.beginShot(b);
  var c = hit(b, 0);
  var sp = of(c, "spawn");
  assert.strictEqual(sp.length, 2);
  assert.strictEqual(C.byUid(b, sp[0].uid).hp, Math.round(E.splitter.hp * 0.3));
  var b2 = battle([["ore_crawler", 270, 300], ["parasite_vine", 270, 360]]);
  assert.strictEqual(b2.enemies[1].host, b2.enemies[0].uid);
  b2.enemies[0].hp = 1; b2.enemies[1].hp = 9999; b2.enemies[1].hpMax = 9999;
  C.beginShot(b2); hit(b2, 0);
  assert.ok(b2.enemies[1].dead, "宿主死亡寄生藤一起消失");
  var b3 = battle([["acid_sac", 270, 300]]);
  b3.enemies[0].hp = 1; C.beginShot(b3); hit(b3, 0);
  assert.strictEqual(b3.acids.length, 1);
  C.endShot(b3); C.beginShot(b3);
  assert.strictEqual(of(C.onPos(b3, { x: 270, y: 300 }), "shooterVel").length, 1);
  assert.strictEqual(of(C.onPos(b3, { x: 270, y: 300 }), "shooterVel").length, 0, "每發一次");
  var b4 = battle([["void_eye", 270, 300]]);
  b4.party.forEach(function (p) { p.gauge = 5; });
  b4.enemies[0].hp = 1; C.beginShot(b4); hit(b4, 0);
  assert.strictEqual(b4.party[1].gauge, 3);
  var b5 = battle([["the_forgotten", 270, 300], ["ore_crawler", 100, 100]]);
  b5.enemies[1].mark = { el: "comet", turns: 3, atk: 1 };
  b5.enemies[0].hp = 1; C.beginShot(b5); hit(b5, 0);
  assert.strictEqual(b5.enemies[1].mark, null);
  var b6 = battle([["blast_orb", 270, 300]]);
  b6.enemies[0].hp = 1; C.beginShot(b6);
  var ex = of(hit(b6, 0), "explode")[0];
  assert.strictEqual(ex.radius, D.SIZE_R.s * K.CHAIN_RADIUS_MULT * 2);
});

test("雙子球：一隻受傷另一隻受 50%（不回傳）", function () {
  var b = battle([["twin_orb", 200, 300], ["twin_orb", 340, 300]]);
  assert.strictEqual(b.enemies[0].partner, b.enemies[1].uid);
  C.beginShot(b); b.active = 2;
  var c = hit(b, 0);
  var d0 = dmgTo(c, b.enemies[0].uid), d1 = dmgTo(c, b.enemies[1].uid);
  assert.strictEqual(d1, Math.round(d0 * 0.5));
});

test("霧隱者：敵人回合切換隱形；隱形時撞擊沒傷害、不計 Hit", function () {
  var b = battle([["mist_lurker", 270, 300]]);
  var r = C.enemyTurn(b);
  assert.ok(b.enemies[0].hidden);
  assert.strictEqual(of(r.cmds, "enemySensor")[0].on, true);
  C.beginShot(b);
  assert.strictEqual(hit(b, 0).length, 0);
  assert.strictEqual(b.shot.hits, 0);
  C.enemyTurn(b);
  assert.ok(!b.enemies[0].hidden);
});

test("星雲巨蟒：頭＋3 節身體，撞頭 ×2，頭死身體一起消失", function () {
  var b = battle([["nebula_serpent", 270, 200]]);
  var bodies = b.enemies.filter(function (e) { return e.owner === b.enemies[0].uid; });
  assert.strictEqual(bodies.length, 3);
  C.beginShot(b); b.active = 2;
  assert.strictEqual(dmgTo(hit(b, 0), b.enemies[0].uid, "hit"), H.volta.atk * 2);
  b.enemies[0].hp = 1;
  hit(b, 0, 30);
  assert.ok(bodies.every(function (e) { return e.dead; }));
});

// ---------------- 敵人回合 ----------------
test("敵人回合：雷雲 −3%、熵蟲量表 −1、修復機回 5%、腐蝕兵破甲 ×1.2、自爆球攻擊後消失", function () {
  var b = battle([["thundercloud", 270, 300], ["entropy_worm", 100, 100]]);
  b.enemies.forEach(function (e) { e.cd = 99; });
  b.party.forEach(function (p) { p.gauge = 3; });
  var hp0 = b.hp;
  C.enemyTurn(b);
  assert.strictEqual(b.hp, hp0 - Math.round(b.hpMax * 0.03));
  assert.strictEqual(b.party[0].gauge, 2);
  var b2 = battle([["repair_bot", 270, 300], ["ore_crawler", 270, 420]]);
  b2.enemies.forEach(function (e) { e.cd = 99; });
  b2.enemies[1].hp = 1000; C.enemyTurn(b2);
  assert.strictEqual(b2.enemies[1].hp, 1000 + Math.round(1500 * 0.05));
  var b3 = battle([["corroder", 270, 300], ["ore_crawler", 100, 100]]);
  b3.enemies[0].cd = 1; b3.enemies[1].cd = 99;
  C.enemyTurn(b3);
  assert.ok(b3.armorBreak);
  b3.enemies[1].cd = 1; b3.enemies[0].cd = 99;
  var r = C.enemyTurn(b3);
  assert.strictEqual(r.attacks[0].dmg, Math.round(E.ore_crawler.atk * 1.2));
  var b4 = battle([["blast_orb", 270, 300], ["ore_crawler", 100, 100]]);
  b4.enemies[0].cd = 1; b4.enemies[1].cd = 99;
  C.enemyTurn(b4);
  assert.ok(b4.enemies[0].dead);
});

test("召喚類：卵囊每 2 回合、孢子母巢每回合、偵察母機每 3 回合、虛空裂口每 2 回合；上限 10 隻", function () {
  // 虛空裂口召喚的是隨機星區 1 敵人，可能抽到會自己孵化的卵囊，所以固定 rng（0.05 → 第一種＝浮游孢子）
  function count(id, turns) {
    var b = battle([[id, 270, 300]], { rng: id === "void_rift" ? function () { return 0.05; } : Math.random });
    b.enemies[0].cd = 99;
    for (var i = 0; i < turns; i++) { b.enemies[0].cd = 99; C.enemyTurn(b); }
    return C.alive(b).length - 1;
  }
  assert.strictEqual(count("egg_sac", 4), 2);
  assert.strictEqual(count("spore_nest", 3), 3);
  assert.strictEqual(count("scout_mother", 3), 1);
  assert.strictEqual(count("void_rift", 4), 2);
  var b = battle([["spore_nest", 270, 300]], { rng: Math.random });
  for (var t = 0; t < 20; t++) { b.enemies[0].cd = 99; C.enemyTurn(b); }
  assert.ok(C.alive(b).length <= 10);
});

test("移動類：跳躍蝦、星雲魟、彗星騎兵、護衛艇、引力雙星都會動且留在場內", function () {
  ["hop_shrimp", "nebula_ray", "comet_knight"].forEach(function (id) {
    var b = battle([[id, 270, 400]], { rng: Math.random });
    b.enemies[0].cd = 99;
    var x = b.enemies[0].x, y = b.enemies[0].y;
    C.enemyTurn(b);
    var e = b.enemies[0];
    assert.ok(e.x !== x || e.y !== y, id + " 有移動");
    assert.ok(e.x >= e.r && e.x <= K.FIELD_W - e.r && e.y <= 720, id + " 在場內");
  });
  var b = battle([["escort_boat", 270, 200], ["ore_crawler", 270, 300]]);
  b.enemies.forEach(function (e) { e.cd = 99; });
  var ex = b.enemies[0].x;
  C.enemyTurn(b);
  assert.notStrictEqual(Math.round(b.enemies[0].x), Math.round(ex));
  var b2 = battle([["binary_star", 170, 400], ["binary_star", 370, 400]]);
  b2.enemies.forEach(function (e) { e.cd = 99; });
  C.enemyTurn(b2);
  assert.ok(Math.abs(b2.enemies[0].y - 400) > 1 && Math.abs(b2.enemies[0].x + b2.enemies[1].x - 540) < 1e-6, "繞中心轉");
});

test("時間幽影隨機倒數、虛空巨鯨吞小型回 20%、星蝕使徒加抗性", function () {
  var b = battle([["time_shade", 270, 300]], { rng: function () { return 0; } });
  b.enemies[0].cd = 99; C.enemyTurn(b);
  assert.strictEqual(b.enemies[0].cd, 1);
  var b2 = battle([["void_whale", 270, 300], ["spore_drifter", 270, 380]]);
  b2.enemies.forEach(function (e) { e.cd = 99; });
  b2.enemies[0].hp = 100;
  C.enemyTurn(b2);
  assert.ok(b2.enemies[1].dead);
  assert.strictEqual(b2.enemies[0].hp, 100 + Math.round(b2.enemies[0].hpMax * 0.2));
  var b3 = battle([["eclipse_apostle", 270, 300], ["ore_crawler", 100, 100]]);
  b3.enemies.forEach(function (e) { e.cd = 99; });
  C.enemyTurn(b3);
  assert.strictEqual(b3.enemies[1].resist.length, 1);
});

test("重力漩渦體自帶引力井，擊破時移除", function () {
  var b = battle([["gravity_vortex", 270, 300]]);
  assert.strictEqual(b.wells.filter(function (g) { return g.owner === b.enemies[0].uid; }).length, 1);
  b.enemies[0].hp = 1; C.beginShot(b);
  var c = hit(b, 0);
  assert.strictEqual(of(c, "removeWells").length, 1);
  assert.strictEqual(b.wells.length, 0);
});

// ---------------- Boss ----------------
test("礦採母艦：鑽臂生成小行星（最多 4）；部位爆炸；全部位破壞本體 −10%；本體死亡勝利", function () {
  var b = battle([], { boss: "mining_carrier" });
  var body = C.byUid(b, b.bossUid), parts = b.enemies.filter(function (e) { return e.owner === body.uid; });
  assert.strictEqual(parts.length, 2);
  body.cd = 99;
  var r = C.enemyTurn(b);
  assert.strictEqual(of(r.cmds, "addRock").length, 2);
  C.enemyTurn(b); C.enemyTurn(b);
  assert.ok(b.rocks.filter(function (k) { return !k.broken; }).length <= 4);
  C.beginShot(b);
  parts.forEach(function (pt) { pt.hp = 1; });
  var h0 = body.hp;
  var c1 = C.onHit(b, { enemy: parts[0].uid, speed: K.SPEED_MAX, step: 0 });
  assert.ok(of(c1, "explode").length >= 1, "部位爆炸");
  C.onHit(b, { enemy: parts[1].uid, speed: K.SPEED_MAX, step: 0 });
  assert.ok(h0 - body.hp >= Math.round(body.hpMax * 0.1), "全部位破壞 −10%");
  body.hp = 1;
  C.onHit(b, { enemy: body.uid, speed: K.SPEED_MAX, step: 40 });
  assert.ok(C.isWin(b));
  assert.strictEqual(C.endShot(b).next, "win");
});

test("星雲巨艦：產生器在時本體 ×0.2；砲塔倒數 2 攻擊", function () {
  var b = battle([], { boss: "nebula_dread" });
  var body = C.byUid(b, b.bossUid);
  C.beginShot(b); b.active = 2;
  assert.strictEqual(dmgTo(C.onHit(b, { enemy: body.uid, speed: K.SPEED_MAX, step: 0 }), body.uid, "hit"), Math.round(H.volta.atk * 0.2));
  b.enemies.filter(function (e) { return e.partKey === "shieldGen"; }).forEach(function (g) { g.dead = true; });
  assert.strictEqual(dmgTo(C.onHit(b, { enemy: body.uid, speed: K.SPEED_MAX, step: 20 }), body.uid, "hit"), H.volta.atk);
  body.cd = 99;
  C.enemyTurn(b);
  var r = C.enemyTurn(b);
  assert.ok(r.attacks.some(function (a) { return C.byUid(b, a.uid).partKey === "turret"; }));
});

test("虛空方舟：3 個核心各有引力井；全部破壞時井消失、本體倒數 +2", function () {
  var b = battle([], { boss: "void_ark" });
  var body = C.byUid(b, b.bossUid);
  assert.strictEqual(b.wells.length, 3);
  var cd0 = body.cd;
  C.beginShot(b);
  b.enemies.filter(function (e) { return e.partKey === "core"; }).forEach(function (c, i) {
    c.hp = 1; C.onHit(b, { enemy: c.uid, speed: K.SPEED_MAX, step: i * 10 });
  });
  assert.strictEqual(b.wells.length, 0);
  assert.strictEqual(body.cd, cd0 + 2);
});

// ---------------- 物理 ----------------
var POS = [{ x: 270, y: 800 }, { x: 60, y: 900 }, { x: 480, y: 900 }, { x: 60, y: 820 }];
function world(enemies, opts) {
  var b = battle(enemies, opts);
  return { b: b, w: P.create({ Matter: Matter, battle: b, heroPos: POS, field: { wells: b.wells, rocks: b.rocks } }) };
}
function runUntil(w, n, fn) { for (var i = 0; i < n; i++) { var evs = P.step(w); if (fn(evs)) return true; } return false; }

test("物理：addEnemy 後會撞到；隱形可穿過；塵埃雲是感應區", function () {
  var s = world([]);
  var e = C.spawnEnemy(s.b, E.ore_crawler, 270, 400, { cmds: [] });
  e.x = 270; e.y = 400;   // 生成位置是「附近的空位」，這裡固定在射線上
  P.addEnemy(s.w, e);
  P.launch(s.w, 0, 0, -K.SPEED_MAX);
  assert.ok(runUntil(s.w, 300, function (evs) { return evs.some(function (x) { return x.type === "hit" && x.enemy === e.uid; }); }));
  var s2 = world([["mist_lurker", 270, 400]]);
  P.setEnemySensor(s2.w, s2.b.enemies[0].uid, true);
  P.launch(s2.w, 0, 0, -K.SPEED_MAX);
  var minY = 999;
  runUntil(s2.w, 120, function () { minY = Math.min(minY, P.heroPos(s2.w, 0).y); return false; });
  assert.ok(minY < 360, "穿過隱形敵人");
  var s3 = world([["dust_cloud", 270, 400]]);
  assert.ok(s3.w.enemyBodies[s3.b.enemies[0].uid].isSensor);
  P.setPierce(s3.w, false);
  assert.ok(s3.w.enemyBodies[s3.b.enemies[0].uid].isSensor, "關掉穿透仍維持感應區");
});

test("物理：鏡面艦彈性 1、磁石吸引、scaleShooter、敵人引力井移除、addRock", function () {
  var s = world([["mirror_ship", 270, 400]]);
  assert.strictEqual(s.w.enemyBodies[s.b.enemies[0].uid].restitution, 1);
  function endX(enemies) {
    var t = world(enemies);
    P.launch(t.w, 0, 0, -K.SPEED_MAX * 0.6);
    for (var i = 0; i < 60; i++) P.step(t.w);
    return P.heroPos(t.w, 0).x;
  }
  assert.ok(endX([["magnet_imp", 390, 550]]) > 271, "被磁石往右吸");
  var s2 = world([]);
  P.launch(s2.w, 0, 0, -20); P.step(s2.w);
  P.scaleShooter(s2.w, 0.5, Math.PI / 2);
  var v = P.heroVel(s2.w, 0);
  assert.ok(Math.abs(Math.sqrt(v.x * v.x + v.y * v.y) - 10) < 0.5 && Math.abs(v.y) < 0.5);
  P.scaleShooter(s2.w, 10, 0, 30);
  v = P.heroVel(s2.w, 0);
  assert.ok(Math.sqrt(v.x * v.x + v.y * v.y) <= 30 + 1e-6, "上限");
  var s3 = world([["gravity_vortex", 270, 300]]);
  assert.strictEqual(P.allWells(s3.w).length, 1);
  P.removeWellsOf(s3.w, s3.b.enemies[0].uid);
  assert.strictEqual(P.allWells(s3.w).length, 0);
  P.addRock(s3.w, { id: "r9", x: 200, y: 200 });
  assert.ok(s3.w.rockBodies.r9);
});

process.on("exit", function () { console.log("passed " + passed); });
