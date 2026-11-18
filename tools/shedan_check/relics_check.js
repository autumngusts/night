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

// ---------------- 遺物在戰鬥中的效果（§10、§10.1） ----------------
function battle(relics, enemies, opts) {
  opts = opts || {};
  var b = C.create({
    heroes: (opts.heroes || ["ignis", "rime", "volta", "nox"]).map(function (id) { return H[id]; }),
    enemies: enemies.map(function (x) { return { def: E[x[0]], x: x[1], y: x[2], elite: x[3] }; }),
    mods: D.computeMods(relics), field: opts.field
  });
  b.rng = opts.rng || function () { return 0.5; };
  return b;
}
function hit(b, i, step) { return C.onHit(b, { enemy: b.enemies[i].uid, speed: K.SPEED_MAX, step: step || 0, vx: 0, vy: -10 }); }
function of(cmds, type) { return cmds.filter(function (c) { return c.type === type; }); }
function dmgTo(cmds, uid, kind) { return of(cmds, "damage").filter(function (c) { return c.uid === uid && (!kind || c.kind === kind); }).reduce(function (s, c) { return s + c.amount; }, 0); }
var VA = H.volta.atk;  // 用沃爾塔（雷漿）打礦脈蠕（弱點恆星）：倍率 1，好算

test("數值類：不穩定核心 +30%、屬性透鏡 1.8、質量增幅器、技能迴路＋指揮官徽章", function () {
  var b = battle(["unstable_core"], [["ore_crawler", 270, 300]]);
  C.beginShot(b); b.active = 2;
  assert.strictEqual(dmgTo(hit(b, 0), b.enemies[0].uid, "hit"), Math.round(VA * 1.3));
  var b2 = battle(["element_lens"], [["ore_crawler", 270, 300]]);
  C.beginShot(b2);
  assert.strictEqual(dmgTo(hit(b2, 0), b2.enemies[0].uid, "hit"), Math.round(H.ignis.atk * 1.8));
  var b3 = battle(["mass_amp"], [["ore_crawler", 270, 300]], { heroes: ["rime", "ignis", "volta", "nox"] });
  C.beginShot(b3);
  assert.strictEqual(dmgTo(hit(b3, 0), b3.enemies[0].uid, "hit"), Math.round(H.rime.atk * 1.25));
  var b4 = battle(["skill_circuit", "commander_badge"], [["ore_crawler", 270, 300]], { heroes: ["volta", "ignis", "rime", "nox"] });
  b4.party[0].gauge = b4.party[0].gaugeMax;
  C.beginShot(b4, { skill: true });
  // 過載（沃爾塔技能）不改撞擊傷害；技能迴路 +20%、隊長 +30%
  assert.strictEqual(dmgTo(hit(b4, 0), b4.enemies[0].uid, "hit"), Math.round(VA * 1.5));
});

test("連爆類：引信強化 +20%、爆裂 3 半徑 +30%、爆心標定器第一次 ×2、誘爆彈頭、連鎖雷管", function () {
  function chainOf(relics) {
    var b = battle(relics, [["spore_drifter", 270, 300], ["ore_crawler", 470, 900]]);
    b.enemies[0].hp = 1; C.beginShot(b); b.active = 2;
    return of(hit(b, 0), "explode")[0];
  }
  var base = chainOf([]);
  assert.strictEqual(chainOf(["fuse"]).radius, base.radius);
  assert.strictEqual(chainOf(["fuse", "unstable_core", "shockwave"]).radius, base.radius * 1.3, "爆裂 3");
  assert.strictEqual(chainOf(["ground_zero"]).radius, base.radius * 2);
  var b = battle(["fuse"], [["spore_drifter", 270, 300], ["ore_crawler", 270, 340]]);
  b.enemies[0].hp = 1; C.beginShot(b); b.active = 2;
  assert.strictEqual(dmgTo(hit(b, 0), b.enemies[1].uid, "explode"), Math.round(220 * 0.3 * 1.2 * 1.0));
  var bw = battle(["warhead"], [["spore_drifter", 270, 300], ["ore_crawler", 270, 340]]);
  bw.enemies[0].hp = 1; C.beginShot(bw); bw.active = 2;
  assert.strictEqual(dmgTo(hit(bw, 0), bw.enemies[1].uid, "explode"), Math.round(VA * 1.5));
  var bc = battle(["detonator_chain"], [["spore_drifter", 100, 100], ["spore_drifter", 135, 100], ["spore_drifter", 170, 100], ["ore_crawler", 470, 900]]);
  // 第 2、3 隻 HP 30：雷漿電弧（27）打不死，靠連爆才死，才會連成 3 層
  bc.enemies[0].hp = 1; bc.enemies[1].hp = 30; bc.enemies[2].hp = 30;
  C.beginShot(bc); bc.active = 2;
  hit(bc, 0);
  assert.strictEqual(bc.shot.chain, 3);
  assert.ok(bc.party[1].gauge >= 3, "連爆 3 層全隊 +3");
});

test("反應類：反應催化劑 +20%、蒸氣閥半徑、共鳴音叉 ×2、湮滅透鏡 ×2、雙印記、反應 5 不消耗", function () {
  function steam(relics) {
    var b = battle(relics, [["ore_crawler", 270, 300]], { heroes: ["ignis", "rime", "volta", "nox"] });
    C.beginShot(b); hit(b, 0);
    b.active = 1; C.beginShot(b);
    return { b: b, ex: of(hit(b, 0), "explode")[0] };
  }
  assert.strictEqual(steam(["steam_valve"]).ex.radius, 160 * 1.4);
  assert.strictEqual(steam(["catalyst"]).ex.radius, 160);
  var s = steam(["double_mark"]);
  assert.strictEqual(s.b.enemies[0].mark.el, "comet", "雙印記：反應後留下冰彗印記");
  var k = steam(["catalyst", "steam_valve", "supercoil"]);
  assert.strictEqual(k.b.enemies[0].mark, null);
  var k5 = steam(["catalyst", "steam_valve", "supercoil", "ion_condenser", "tuning_fork"]);
  assert.strictEqual(k5.b.enemies[0].mark.el, "solar", "反應 5：不消耗印記");
  var bt = battle(["tuning_fork"], [["ore_crawler", 270, 300]], { heroes: ["ignis", "lumen", "volta", "nox"] });
  C.beginShot(bt); hit(bt, 0); bt.active = 1; C.beginShot(bt);
  var c = hit(bt, 0);
  // 共鳴＝攻 ×1.0 的爆炸，音叉 ×2；爆炸屬性是流明的光子，對礦脈蠕（弱點恆星）倍率 1
  assert.strictEqual(dmgTo(c, bt.enemies[0].uid, "explode"), Math.round(H.lumen.atk * 1.0 * 2));
});

test("友情類：編隊通訊器 +25%、羈絆電路 +2、友情 5 每位 2 次、合體訊號、同屬性共鳴", function () {
  var b = battle(["squad_comm"], [["ore_crawler", 270, 300], ["ore_crawler", 470, 60]], { heroes: ["rime", "nox", "volta", "ignis"] });
  C.beginShot(b);
  assert.strictEqual(dmgTo(C.onAlly(b, { ally: 1, x: 270, y: 700 }), b.enemies[0].uid), Math.round(H.nox.atk * 1.25 * 2.5));
  var b2 = battle(["bond_circuit"], [["ore_crawler", 270, 300]], { heroes: ["rime", "nox", "volta", "ignis"] });
  C.beginShot(b2); C.onAlly(b2, { ally: 1, x: 270, y: 700 });
  assert.strictEqual(b2.party[0].gauge, 2);
  var f5 = ["squad_comm", "bond_circuit", "relay_thruster", "union_signal", "backup_drone"];
  var b3 = battle(f5, [["ore_crawler", 270, 300]], { heroes: ["rime", "nox", "volta", "ignis"] });
  C.beginShot(b3);
  assert.ok(C.onAlly(b3, { ally: 1, x: 270, y: 700 }).length > 0);
  assert.ok(C.onAlly(b3, { ally: 1, x: 270, y: 700 }).length > 0, "第 2 次");
  assert.strictEqual(C.onAlly(b3, { ally: 1, x: 270, y: 700 }).length, 0, "第 3 次不行");
  assert.ok(!b3.shot.unionDone, "目前 2 次");
  C.onAlly(b3, { ally: 2, x: 270, y: 700 });
  assert.ok(b3.shot.unionDone, "第 3 次友情技（另一位隊友）→ 合體訊號");
  var b4 = battle(["kin_resonance"], [["ore_crawler", 270, 300]], { heroes: ["rime", "nox", "volta", "ignis"] });
  C.beginShot(b4); C.onAlly(b4, { ally: 1, x: 270, y: 700 });
  assert.strictEqual(b4.enemies[0].mark.el, "void");
});

test("星座類：星圖半徑、北極星 +1、黃道儀 +3、天球儀 2 次、星座爆破、流星許願、共振天線、新星標記", function () {
  var STARS = [{ x: 100, y: 500 }, { x: 200, y: 500 }, { x: 300, y: 500 }];
  var b = battle(["star_chart"], [["ore_crawler", 270, 200]], { field: { stars: STARS } });
  C.beginShot(b); C.onPos(b, { x: 100, y: 500 + 35 });
  assert.strictEqual(b.shot.lit.length, 1, "半徑 26×1.5 內點亮");
  var b2 = battle(["polaris", "zodiac"], [["ore_crawler", 270, 200]], { field: { stars: STARS } });
  C.beginShot(b2); C.onPos(b2, { x: 100, y: 500 }); C.onPos(b2, { x: 200, y: 500 });
  var r2 = C.endShot(b2);
  assert.strictEqual(of(r2.cmds, "constellation")[0].id, "tri", "2 點＋北極星 = 三角");
  assert.strictEqual(of(r2.cmds, "bolt").length, K.METEOR_N + 3);
  var b3 = battle(["celestial_globe", "wish_star", "star_blast"], [["ore_crawler", 270, 200]], { field: { stars: STARS.concat([{ x: 400, y: 500 }]) } });
  b3.hp -= 100;
  C.beginShot(b3); [100, 200, 300, 400].forEach(function (x) { C.onPos(b3, { x: x, y: 500 }); });
  var r3 = C.endShot(b3);
  assert.strictEqual(of(r3.cmds, "explode").length, 4, "星座爆破：每個星點");
  assert.ok(b3.hp > b3.hpMax - 100, "流星許願");
  b3.enemies[0].cd = 1; C.enemyTurn(b3);
  assert.strictEqual(b3.shield, K.ARK_SHIELD, "天球儀：擋完第 1 次還在");
  b3.enemies[0].cd = 1; C.enemyTurn(b3);
  assert.strictEqual(b3.shield, 0);
  var b4 = battle(["resonance_antenna"], [["ore_crawler", 270, 200]]);
  C.beginShot(b4); C.onPos(b4, { x: 220, y: 835, allies: [{ i: 1, x: 220, y: 835 }] });
  assert.strictEqual(b4.shot.lit[0].key, "a1");
  var b5 = battle(["nova_marker"], [["spore_drifter", 270, 300], ["ore_crawler", 470, 900]], { rng: function () { return 0.1; } });
  b5.enemies[0].hp = 1; C.beginShot(b5); b5.active = 2;
  assert.strictEqual(of(hit(b5, 0), "addStar").length, 1);
});

test("技能類：冷卻劑＋技能 3 上限 −6、充能電池、溢流儲存、二段技能、技能 5、擊破充能", function () {
  var b = battle(["coolant", "charged_cell", "skill_circuit"], [["ore_crawler", 270, 300]]);
  assert.strictEqual(b.party[0].gaugeMax, H.ignis.gauge - 6);
  assert.strictEqual(b.party[0].gauge, 5);
  var b2 = battle(["overflow_store"], [["ore_crawler", 270, 300]]);
  b2.party[0].gauge = b2.party[0].gaugeMax + 7;
  C.beginShot(b2, { skill: true });
  assert.strictEqual(b2.party[0].gauge, 7, "留下超出的 7");
  var b3 = battle(["two_stage"], [["ore_crawler", 270, 300]]);
  b3.party[0].gauge = b3.party[0].gaugeMax;
  C.beginShot(b3, { skill: true });
  assert.strictEqual(b3.party[0].gauge, Math.round(b3.party[0].gaugeMax * 0.5));
  var sk5 = ["coolant", "charged_cell", "skill_circuit", "overflow_store", "kill_charger"];
  var b4 = battle(sk5, [["spore_drifter", 270, 300], ["ore_crawler", 470, 900]]);
  b4.party[0].gauge = b4.party[0].gaugeMax;
  var g1 = b4.party[1].gauge;
  C.beginShot(b4, { skill: true });
  assert.strictEqual(b4.party[1].gauge, Math.min(C.gaugeCap(b4, b4.party[1]), g1 + Math.round(b4.party[1].gaugeMax * 0.5)), "技能 5");
  b4.enemies[0].hp = 1;
  var g0 = b4.party[0].gauge;
  hit(b4, 0);
  assert.strictEqual(b4.party[0].gauge, g0 + 2, "撞擊 +1、擊破充能 +1");
});

test("守護類：偏轉護盾、緩衝氣墊、嘲諷信標、反擊裝甲、守護 5、隕鐵外殼、救生艙、緊急超頻、再生裝甲", function () {
  var b = battle(["deflector"], [["ore_crawler", 270, 300]]);
  var ctx = { cmds: [], queue: [] };
  assert.strictEqual(C.teamDamage(b, 100, ctx), 0);
  assert.strictEqual(C.teamDamage(b, 100, ctx), 100);
  var b2 = battle(["cushion"], [["ore_crawler", 270, 300]]);
  assert.strictEqual(C.teamDamage(b2, 9999, ctx), Math.round(b2.hpMax * 0.25));
  var b3 = battle(["taunt_beacon"], [["ore_crawler", 270, 300]], { rng: function () { return 0.1; } });
  assert.strictEqual(C.teamDamage(b3, 100, ctx, { attacker: b3.enemies[0] }), 0);
  var b4 = battle(["counter_armor"], [["ore_crawler", 270, 300]]);
  var c4 = { cmds: [], queue: [] };
  C.teamDamage(b4, 100, c4, { attacker: b4.enemies[0] });
  assert.ok(dmgTo(c4.cmds, b4.enemies[0].uid, "counter") > 0);
  var g5 = ["reinforced_hull", "repair_nanites", "regen_armor", "cushion", "med_pod"];
  var b5 = battle(g5, [["ore_crawler", 270, 300]]);
  b5.enemies[0].cd = 1;
  var hp0 = b5.hp;
  var r5 = C.enemyTurn(b5);
  assert.strictEqual(r5.attacks[0].dmg, Math.round(E.ore_crawler.atk * 0.6), "守護 5");
  assert.strictEqual(b5.hp, hp0 - r5.attacks[0].dmg + Math.round(b5.hpMax * 0.01), "再生裝甲");
  var b6 = battle(["meteor_hull"], [["ore_crawler", 270, 300]], { field: { rocks: [{ x: 100, y: 500 }, { x: 400, y: 500 }] } });
  assert.strictEqual(C.teamDamage(b6, 100, ctx), 90);
  var b7 = battle(["life_pod"], [["ore_crawler", 270, 300]]);
  var c7 = { cmds: [], queue: [] };
  C.teamDamage(b7, b7.hpMax * 2, c7);
  assert.strictEqual(b7.hp, Math.round(b7.hpMax * 0.3), "救生艙");
  assert.strictEqual(of(c7.cmds, "lifePod").length, 1);
  C.teamDamage(b7, b7.hpMax * 2, c7);
  assert.strictEqual(b7.hp, 0, "救生艙只有一次");
  var b8 = battle(["emergency_oc"], [["ore_crawler", 270, 300]]);
  C.teamDamage(b8, Math.round(b8.hpMax * 0.8), { cmds: [], queue: [] });
  assert.ok(b8.party.every(function (p) { return p.gauge === p.gaugeMax; }), "緊急超頻（低於 30%）");
});

test("碎片類：碎片收集器 +2、脆化射線耐久 1、硬化碎片門檻 3、碎片風暴 +2 Hit、碎片 5 ×2、撞擊鑽頭", function () {
  var b = battle(["debris_collector", "brittle_ray"], [["ore_crawler", 270, 300]], { field: { rocks: [{ x: 270, y: 500 }] } });
  assert.strictEqual(b.rocks[0].dur, 1);
  C.beginShot(b);
  var deb = of(C.onRock(b, { rock: "r0", step: 0 }), "debris")[0];
  assert.ok(deb.n >= 5 && deb.n <= 7);
  var b2 = battle(["hardened_shards", "shard_storm"], [["ore_crawler", 270, 300]]);
  C.beginShot(b2);
  assert.ok(C.onDebris(b2, { enemy: b2.enemies[0].uid, speed: 4, step: 0, debris: 1 }).length > 0);
  assert.strictEqual(b2.shot.hits, 3);
  var d5 = ["debris_collector", "brittle_ray", "hardened_shards", "shard_storm", "ore_rail"];
  var b3 = battle(d5, [["ore_crawler", 270, 300]]);
  C.beginShot(b3);
  assert.strictEqual(dmgTo(C.onDebris(b3, { enemy: b3.enemies[0].uid, speed: 8, step: 0, debris: 1 }), b3.enemies[0].uid), Math.round(H.ignis.atk * K.DEBRIS_MULT * 2 * 1.5));
  var b4 = battle(["impact_drill", "brittle_ray"], [["ore_crawler", 270, 300]], { field: { rocks: [{ x: 270, y: 500 }] } });
  C.beginShot(b4); b4.active = 2; C.onRock(b4, { rock: "r0", step: 0 });
  assert.strictEqual(dmgTo(hit(b4, 0), b4.enemies[0].uid, "hit"), Math.round(VA * 1.15));
});

test("反彈類：角落獵人 +2 Hit、稜角裝甲、共振牆每 5 次、反彈 3＋5、迴旋紀錄器", function () {
  var b = battle(["corner_hunter"], [["ore_crawler", 270, 300]]);
  C.beginShot(b); C.onWall(b, { x: 0, y: 40 });
  assert.strictEqual(b.shot.hits, 2);
  var b2 = battle(["edged_armor"], [["ore_crawler", 60, 300]]);
  C.beginShot(b2);
  assert.ok(dmgTo(C.onWall(b2, { x: 0, y: 300 }), b2.enemies[0].uid) > 0);
  var b5 = battle(["spring", "edged_armor", "spin_recorder", "accel_ring", "resonant_wall"], [["ore_crawler", 270, 300]]);
  var r = C.beginShot(b5);
  assert.strictEqual(r.launch.restitution, 1);
  assert.strictEqual(r.launch.speedMult, 1.1);
  for (var i = 0; i < 10; i++) C.onWall(b5, { x: 540, y: 400 });
  assert.strictEqual(b5.shot.hits, 10, "反彈 3：每次撞牆 Hit +1");
  b5.active = 2; b5.shot.lastHit = {};
  assert.strictEqual(dmgTo(hit(b5, 0), b5.enemies[0].uid, "hit"), Math.round(VA * 1.5 * C.hitMult(11)), "反彈 5：撞牆後下一下 ×1.5");
  b5.active = 0;
  var re = C.endShot(b5);
  assert.strictEqual(of(re.cmds, "relic").filter(function (c) { return c.id === "spin_recorder"; }).length, 1);
});

test("開場類：不穩定核心倒數 −1、時間緩衝 +1；聚合場；黑洞種子第 3 回合", function () {
  var b = battle(["unstable_core"], [["ore_crawler", 270, 300]]);
  assert.strictEqual(b.enemies[0].cd, E.ore_crawler.cd - 1);
  var b2 = battle(["time_buffer"], [["ore_crawler", 270, 300]]);
  assert.strictEqual(b2.enemies[0].cd, E.ore_crawler.cd + 1);
  var b3 = battle(["convergence"], [["ore_crawler", 100, 150]]);
  b3.enemies[0].cd = 99; C.enemyTurn(b3);
  assert.ok(b3.enemies[0].x > 100 && b3.enemies[0].y > 150);
  var b4 = battle(["hole_seed"], [["ore_crawler", 270, 300], ["ore_crawler", 100, 150]]);
  C.beginShot(b4); hit(b4, 1); C.endShot(b4);
  b4.enemies.forEach(function (e) { e.cd = 99; });
  C.enemyTurn(b4);
  var r = C.enemyTurn(b4);
  var w = of(r.cmds, "well")[0];
  assert.ok(w && w.hole && w.x === b4.enemies[1].x);
});

test("殘影類：殘影 3 +30%、殘影收穫計 Hit、殘光濾鏡留印記、回溯計時器、幽靈隊員", function () {
  var b = battle(["ghost_projector", "ghost_expand", "ghost_harvest", "afterglow_filter", "rewind_timer"], [["ore_crawler", 270, 300], ["spore_drifter", 100, 100]]);
  C.beginShot(b);
  var c = C.onGhost(b, { enemy: b.enemies[0].uid, step: 0 });
  assert.strictEqual(dmgTo(c, b.enemies[0].uid), Math.round(H.ignis.atk * K.GHOST_MULT * 1.3 * 1.5));
  assert.strictEqual(b.shot.hits, 1);
  assert.strictEqual(b.enemies[0].mark.el, "solar");
  b.enemies[1].hp = 1;
  C.onGhost(b, { enemy: b.enemies[1].uid, step: 0 });
  assert.strictEqual(b.party[0].gauge, 2);
  var b2 = battle(["phantom_crew"], [["ore_crawler", 270, 300]], { heroes: ["rime", "nox", "volta", "ignis"] });
  C.beginShot(b2);
  assert.ok(C.onAlly(b2, { ally: 1, x: 270, y: 700, ghost: true }).length > 0);
  assert.strictEqual(C.onAlly(b2, { ally: 2, x: 270, y: 700, ghost: true }).length, 0, "殘影每發一次");
  var b3 = battle([], [["ore_crawler", 270, 300]], { heroes: ["rime", "nox", "volta", "ignis"] });
  C.beginShot(b3);
  assert.strictEqual(C.onAlly(b3, { ally: 1, x: 270, y: 700, ghost: true }).length, 0, "沒有遺物時殘影不觸發");
});

test("精英：HP ×2.5、護盾 ×0.5、迅捷倒數 −1、分裂、再生 5%", function () {
  var b = battle([], [["ore_crawler", 270, 300, "shield"], ["rock_worm", 100, 100, "haste"], ["shell_turtle", 400, 500, "regen"]]);
  assert.strictEqual(b.enemies[0].hpMax, Math.round(1500 * 2.5));
  assert.strictEqual(b.enemies[1].cdMax, E.rock_worm.cd - 1);
  C.beginShot(b); b.active = 2;
  assert.strictEqual(dmgTo(hit(b, 0), b.enemies[0].uid, "hit"), Math.round(VA * 0.5));
  b.enemies[2].hp = 100; b.enemies.forEach(function (e) { e.cd = 99; });
  C.endShot(b); C.enemyTurn(b);
  assert.strictEqual(b.enemies[2].hp, 100 + Math.round(b.enemies[2].hpMax * 0.05));
  var b2 = battle([], [["rock_worm", 270, 300, "split"]]);
  b2.enemies[0].hp = 1; C.beginShot(b2);
  var sp = of(hit(b2, 0), "spawn");
  assert.strictEqual(sp.length, 2);
  assert.strictEqual(C.byUid(b2, sp[0].uid).def.id, "rock_worm");
});

// ---------------- 物理層的遺物 ----------------
var Matter = load("vendor/matter.min.js");
var P = load("shedan_physics.js");
var POS = [{ x: 270, y: 800 }, { x: 300, y: 600 }, { x: 480, y: 900 }, { x: 60, y: 820 }];
function world(relics) {
  var b = battle(relics, []);
  return { b: b, w: P.create({ Matter: Matter, battle: b, heroPos: POS }) };
}

test("物理：礦石磁軌讓碎片多活 4 秒；隊形磁鐵吸引射出者；時滯晶片", function () {
  function debrisAfter(relics, sec) {
    var s = world(relics);
    P.launch(s.w, 0, 0, -6);
    s.w.bodies[0].frictionAir = 0;           // 讓這一發撐到碎片壽命以後
    P.spawnDebris(s.w, 270, 400, 3, "solar");
    for (var i = 0; i < sec * 180; i++) P.step(s.w);
    return s.w.debris.length;
  }
  assert.strictEqual(debrisAfter([], 7), 0, "6 秒後消失");
  assert.strictEqual(debrisAfter(["ore_rail"], 7), 3, "礦石磁軌：10 秒");
  function passX(relics) {
    var s = world(relics);
    P.launch(s.w, 0, 0, -K.SPEED_MAX * 0.5);
    var minDx = 999;
    for (var i = 0; i < 120; i++) { P.step(s.w); var p = P.heroPos(s.w, 0); if (p.y < 620 && p.y > 580) minDx = Math.min(minDx, Math.abs(p.x - 300)); }
    return P.heroPos(s.w, 0).x;
  }
  assert.ok(passX(["formation_magnet"]) > passX([]) + 0.5, "被隊友（x 300）吸過去");
  var s = world(["stasis_chip"]);
  P.launch(s.w, 0, 0, -10, { airMult: 1 });
  P.setShooterAirless(s.w, true);
  assert.strictEqual(s.w.bodies[0].frictionAir, 0);
  P.setShooterAirless(s.w, false);
  assert.strictEqual(s.w.bodies[0].frictionAir, K.AIR);
});

process.on("exit", function () { console.log("passed " + passed); });
module.exports = { test: test };
