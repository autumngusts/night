// ============================================================================
// 射彈宇宙（shedan）第 2 階段規則檢查（不需要瀏覽器）：
//   30 人的射擊特性（§4.1）、友情技（§4.2）、技能（§4.3）、星座／小行星／碎片／殘影／護盾（§8、§8.1）。
//   期望值一律從角色資料與常數算，不硬編攻擊力。
// 執行：node tools/shedan_check/effects_check.js [名稱片段]
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
function load(n) { return require(path.join(SRC, n)); }
var D = load("shedan_data.js");
load("shedan_data_heroes.js");
load("shedan_data_enemies.js");
var C = load("shedan_combat.js");
var H = D.HERO_BY_ID, E = D.ENEMY_BY_ID, K = D.C;

var passed = 0, only = process.argv[2];
function test(name, fn) { if (only && name.indexOf(only) < 0) return; fn(); passed++; console.log("ok - " + name); }

// 第一位是射出者；敵人 [id, x, y]
function battle(ids, enemies, field) {
  var b = C.create({
    heroes: ids.map(function (id) { return H[id]; }),
    enemies: enemies.map(function (x) { return { def: E[x[0]], x: x[1], y: x[2] }; }),
    field: field
  });
  b.rng = function () { return 0; };
  return b;
}
function fill(ids) { var a = ids.slice(); ["ignis", "rime", "volta", "nox"].forEach(function (x) { if (a.length < 4 && a.indexOf(x) < 0) a.push(x); }); return a; }
function hit(b, i, step, extra) {
  var ev = { enemy: b.enemies[i].uid, speed: K.SPEED_MAX, step: step || 0, vx: 0, vy: -10 };
  if (extra) Object.keys(extra).forEach(function (k) { ev[k] = extra[k]; });
  return C.onHit(b, ev);
}
function of(cmds, type) { return cmds.filter(function (c) { return c.type === type; }); }
function dmgTo(cmds, uid, kind) { return of(cmds, "damage").filter(function (c) { return c.uid === uid && (!kind || c.kind === kind); }).reduce(function (s, c) { return s + c.amount; }, 0); }
function full(b) { b.party[b.active].gauge = b.party[b.active].gaugeMax; }
var ORE = E.ore_crawler; // 大型、HP 1500、弱點恆星

// ---------------- 資料 ----------------
test("30 人的特性／友情技／技能都是規則層認得的類型，且有三語名稱", function () {
  D.HEROES.forEach(function (h) {
    assert.ok(C.TRAIT_KINDS.indexOf(h.trait.kind) >= 0, h.id + " trait " + h.trait.kind);
    assert.ok(C.FRIEND_KINDS.indexOf(h.friend.kind) >= 0, h.id + " friend " + h.friend.kind);
    assert.ok(C.SKILL_KINDS.indexOf(h.skill.kind) >= 0, h.id + " skill " + h.skill.kind);
    ["zh", "ja", "en"].forEach(function (l) { assert.ok(h.friend.name[l] && h.skill.name[l], h.id + " " + l); });
  });
  var kinds = {};
  D.HEROES.forEach(function (h) { kinds[h.skill.kind] = (kinds[h.skill.kind] || 0) + 1; });
  C.SKILL_KINDS.forEach(function (k) { assert.ok(kinds[k], "技能類型 " + k + " 有角色使用"); });
});

// ---------------- 射擊特性 ----------------
test("火花（赫利）：撞擊點半徑 40 爆炸、攻 ×0.3", function () {
  var b = battle(fill(["helio"]), [["ore_crawler", 270, 300], ["spore_drifter", 270, 340]]);
  C.beginShot(b);
  var cmds = hit(b, 0);
  assert.strictEqual(dmgTo(cmds, b.enemies[1].uid, "explode"), Math.round(H.helio.atk * 0.3 * 1.5));
});

test("印記擴散（孢子）、隨機印記（稜鏡）", function () {
  var b = battle(fill(["spore"]), [["ore_crawler", 270, 300], ["ore_crawler", 270, 400], ["ore_crawler", 270, 700]]);
  C.beginShot(b); hit(b, 0);
  assert.strictEqual(b.enemies[1].mark.el, "nebula");
  assert.strictEqual(b.enemies[2].mark, null);
  var b2 = battle(fill(["prism"]), [["ore_crawler", 270, 300]]);
  C.beginShot(b2); hit(b2, 0);
  assert.strictEqual(b2.enemies[0].mark.el, D.ELEMENTS[0], "rng=0 → 第一個屬性");
});

test("印記轉化（零）：消耗印記改成真實傷害，再留下虛空印記，不觸發反應", function () {
  var b = battle(fill(["null"]), [["ore_crawler", 270, 300]]);
  b.enemies[0].mark = { el: "photon", turns: 3, atk: 100 };
  C.beginShot(b);
  var cmds = hit(b, 0);
  assert.strictEqual(of(cmds, "reaction").length, 0);
  assert.strictEqual(dmgTo(cmds, b.enemies[0].uid, "true"), Math.round(H.null.atk * H.null.trait.mult));
  assert.strictEqual(b.enemies[0].mark.el, "void");
});

test("斬殺（本影）、治療（光環）、量表吸取（深淵）", function () {
  var b = battle(fill(["umbra"]), [["ore_crawler", 270, 300]]);
  b.enemies[0].hp = 1000;
  C.beginShot(b);
  assert.strictEqual(dmgTo(hit(b, 0), b.enemies[0].uid, "hit"), Math.round(H.umbra.atk + 500 * 0.05));
  var b2 = battle(fill(["halo"]), [["ore_crawler", 270, 300]]);
  b2.hp -= 100; C.beginShot(b2); hit(b2, 0);
  assert.strictEqual(b2.hp, b2.hpMax - 100 + Math.round(b2.hpMax * 0.005));
  var b3 = battle(fill(["abyss"]), [["ore_crawler", 270, 300]]);
  C.beginShot(b3); hit(b3, 0);
  assert.strictEqual(b3.party[0].gauge, 2);
});

test("撞擊電弧（泰絲）打第二近；撞擊牽引（潮汐）；重量推開（霜苓）", function () {
  var b = battle(fill(["tesla"]), [["ore_crawler", 270, 300], ["ore_crawler", 270, 380], ["ore_crawler", 370, 300]]);
  C.beginShot(b);
  var arcs = of(hit(b, 0), "arc").map(function (a) { return a.to; });
  assert.deepStrictEqual(arcs.sort(), [b.enemies[1].uid, b.enemies[2].uid].sort());
  var b2 = battle(fill(["tidal"]), [["ore_crawler", 270, 300], ["ore_crawler", 270, 440]]);
  C.beginShot(b2); var y0 = b2.enemies[1].y; hit(b2, 0);
  assert.ok(b2.enemies[1].y < y0);
  var b3 = battle(fill(["rime"]), [["ore_crawler", 270, 300]]);
  C.beginShot(b3); hit(b3, 0, 0, { vx: 0, vy: -10 });
  assert.strictEqual(b3.enemies[0].y, 300 - H.rime.trait.dist);
});

test("撞牆凍結（冰岬）／撞牆電弧（亞克）／撞牆吸引（環月）", function () {
  var b = battle(fill(["glacier"]), [["ore_crawler", 60, 300]]);
  C.beginShot(b); C.onWall(b, { x: 0, y: 300 });
  assert.strictEqual(b.enemies[0].mark.el, "comet");
  var b2 = battle(fill(["arc"]), [["ore_crawler", 100, 300]]);
  C.beginShot(b2);
  assert.strictEqual(dmgTo(C.onWall(b2, { x: 0, y: 300 }), b2.enemies[0].uid), Math.round(H.arc.atk * 0.4));
  var b3 = battle(fill(["orbit"]), [["ore_crawler", 120, 300]]);
  C.beginShot(b3); C.onWall(b3, { x: 0, y: 300 });
  assert.ok(b3.enemies[0].x < 120);
});

test("冰霜軌跡（長尾）：經過的敵人倒數 +1，每發每敵一次", function () {
  var b = battle(fill(["tail"]), [["ore_crawler", 270, 300]]);
  var cd = b.enemies[0].cd;
  C.beginShot(b);
  C.onPos(b, { x: 270, y: 370, r: K.HERO_R });
  C.onPos(b, { x: 270, y: 360, r: K.HERO_R });
  assert.strictEqual(b.enemies[0].cd, cd + 1);
});

test("殘響（回音）：本發不觸發；下一發經過時爆炸並消失", function () {
  var b = battle(["echo", "ignis", "rime", "volta"], [["ore_crawler", 270, 300]]);
  C.beginShot(b); hit(b, 0);
  assert.strictEqual(b.echoes.length, 1);
  assert.strictEqual(of(C.onPos(b, { x: 270, y: 300 }), "explode").length, 0);
  C.endShot(b, { x: 270, y: 500 });
  C.beginShot(b);
  var cmds = C.onPos(b, { x: 270, y: 320 });
  assert.strictEqual(of(cmds, "explode").length, 1);
  assert.strictEqual(b.echoes.length, 0);
});

test("穿透第一個（霧帆）：第一次撞擊送出 pierceOff，之後不再送", function () {
  var b = battle(fill(["mist"]), [["ore_crawler", 270, 300]]);
  var r = C.beginShot(b);
  assert.ok(r.launch.pierceFirst);
  assert.strictEqual(of(hit(b, 0, 0), "pierceOff").length, 1);
  assert.strictEqual(of(hit(b, 0, 20), "pierceOff").length, 0);
});

test("先導雷射（光束）：射出瞬間沿射擊方向", function () {
  var b = battle(fill(["beam"]), [["ore_crawler", 270, 300], ["ore_crawler", 60, 300]]);
  var r = C.beginShot(b, { x: 270, y: 800, dir: { x: 0, y: -1 } });
  assert.strictEqual(of(r.cmds, "laser").length, 1);
  assert.strictEqual(dmgTo(r.cmds, b.enemies[0].uid), Math.round(H.beam.atk * 0.8));
  assert.strictEqual(dmgTo(r.cmds, b.enemies[1].uid), 0);
});

// ---------------- 友情技 ----------------
function allyBattle(allyId, enemies) {
  var b = battle(["volta", allyId, "rime", "nox"].filter(function (x, i, a) { return a.indexOf(x) === i; }).concat(["ignis"]).slice(0, 4), enemies);
  if (allyId === "volta") b = battle(["rime", "volta", "ignis", "nox"], enemies);
  C.beginShot(b);
  return b;
}
function ally(b, x, y) { return C.onAlly(b, { ally: 1, x: x, y: y }); }

test("十字雷射（伊格妮）：水平＋垂直，每位隊友每發一次、射出者自己不算", function () {
  var b = allyBattle("ignis", [["ore_crawler", 400, 600], ["ore_crawler", 270, 200], ["ore_crawler", 60, 60]]);
  var cmds = ally(b, 270, 600);
  var A = H.ignis.atk * 0.8;
  assert.strictEqual(dmgTo(cmds, b.enemies[0].uid), Math.round(A * 1.5));
  assert.strictEqual(dmgTo(cmds, b.enemies[1].uid), Math.round(A * 1.5));
  assert.strictEqual(dmgTo(cmds, b.enemies[2].uid), 0);
  assert.strictEqual(ally(b, 270, 600).length, 0, "同一發第二次不觸發");
  assert.strictEqual(C.onAlly(b, { ally: 0, x: 0, y: 0 }).length, 0, "射出者自己");
});

test("直線雷射（離子）、追蹤彈（霜苓 5 發循環）、重擊（諾克斯）", function () {
  var b = allyBattle("ion", [["ore_crawler", 270, 300], ["ore_crawler", 470, 60]]);  // 第 0 隻最近
  var cmds = ally(b, 270, 700);
  assert.strictEqual(of(cmds, "laser").length, 1);
  assert.strictEqual(dmgTo(cmds, b.enemies[0].uid), Math.round(H.ion.atk * 1.0));
  var b2 = allyBattle("rime", [["ore_crawler", 270, 300], ["ore_crawler", 470, 300]]);
  assert.strictEqual(of(ally(b2, 270, 700), "bolt").length, 5);
  var b3 = allyBattle("nox", [["ore_crawler", 270, 300]]);
  assert.strictEqual(dmgTo(ally(b3, 270, 700), b3.enemies[0].uid), Math.round(H.nox.atk * 2.5));
});

test("爆發附加印記（霧帆）、清除印記（零）、連鎖閃電（沃爾塔）、雷網（亞克）", function () {
  var b = allyBattle("mist", [["ore_crawler", 270, 650], ["ore_crawler", 270, 200]]);
  ally(b, 270, 700);
  assert.strictEqual(b.enemies[0].mark.el, "nebula");
  assert.strictEqual(b.enemies[1].mark, null);
  var b2 = allyBattle("null", [["ore_crawler", 270, 650]]);
  b2.enemies[0].mark = { el: "solar", turns: 3, atk: 100 };
  ally(b2, 270, 700);
  assert.strictEqual(b2.enemies[0].mark, null);
  var b3 = allyBattle("volta", [["ore_crawler", 270, 500], ["ore_crawler", 270, 360], ["ore_crawler", 270, 220]]);
  assert.strictEqual(of(ally(b3, 270, 700), "bolt").length, 3);
  var b4 = allyBattle("arc", [["ore_crawler", 270, 560], ["ore_crawler", 270, 100]]);
  var c4 = ally(b4, 270, 700);
  assert.ok(dmgTo(c4, b4.enemies[0].uid) > 0 && dmgTo(c4, b4.enemies[1].uid) === 0);
});

test("球狀閃電、全場灼燒、隕石、推開、引力井／冰牆指令、冰晶護盾、治療、虛空門", function () {
  var b = allyBattle("tesla", [["ore_crawler", 270, 300]]);
  ally(b, 270, 700); assert.strictEqual(b.zones.length, 1);
  var b2 = allyBattle("helio", [["ore_crawler", 270, 300], ["ore_crawler", 100, 100]]);
  ally(b2, 270, 700); assert.ok(b2.enemies.every(function (e) { return e.mark && e.mark.el === "solar"; }));
  var b3 = allyBattle("well", [["ore_crawler", 270, 300]]);
  assert.strictEqual(of(ally(b3, 270, 700), "bolt").length, 3);
  var b4 = allyBattle("corona", [["ore_crawler", 270, 600]]);
  ally(b4, 270, 700); assert.ok(b4.enemies[0].y < 600);
  assert.strictEqual(of(ally(allyBattle("orbit", [["ore_crawler", 1, 1]]), 270, 700), "well").length, 1);
  assert.strictEqual(of(ally(allyBattle("sleet", [["ore_crawler", 1, 1]]), 270, 700), "wall").length, 1);
  var b5 = allyBattle("glacier", [["ore_crawler", 270, 300]]);
  ally(b5, 270, 700); assert.strictEqual(b5.shield, 0.3);
  b5.enemies[0].cd = 1;
  var r = C.enemyTurn(b5);
  assert.strictEqual(r.attacks[0].dmg, Math.round(ORE.atk * 0.7));
  assert.strictEqual(b5.shield, 0, "護盾用一次就消失");
  var b6 = allyBattle("halo", [["ore_crawler", 270, 300]]);
  b6.hp -= 200; ally(b6, 270, 700); assert.strictEqual(b6.hp, b6.hpMax - 200 + Math.round(b6.hpMax * 0.05));
  var b7 = allyBattle("abyss", [["ore_crawler", 270, 600], ["ore_crawler", 270, 100]]);
  b7.enemies[0].hp = 200; b7.enemies[1].hp = 200;
  ally(b7, 270, 700);
  assert.ok(b7.enemies[0].dead && !b7.enemies[1].dead);
});

// ---------------- 技能 ----------------
test("技能：量表未滿不能發動；發動後量表歸 0", function () {
  var b = battle(fill(["sleet"]), [["ore_crawler", 270, 300]]);
  assert.ok(!C.canSkill(b));
  C.beginShot(b, { skill: true });
  assert.strictEqual(b.shot.skill, null);
  full(b);
  var r = C.beginShot(b, { skill: true });
  assert.strictEqual(b.party[0].gauge, 0);
  assert.strictEqual(of(r.cmds, "skill").length, 1);
});

test("立即型技能：冰河（全場冰彗）、永凍（倒數 +1）、歸零（抗性失效 2 回合）", function () {
  var b = battle(fill(["sleet"]), [["ore_crawler", 270, 300], ["rock_worm", 100, 100]]);
  full(b); C.beginShot(b, { skill: true });
  assert.ok(b.enemies.every(function (e) { return e.mark.el === "comet"; }));
  var b2 = battle(fill(["glacier"]), [["ore_crawler", 270, 300]]);
  var cd = b2.enemies[0].cd; full(b2); C.beginShot(b2, { skill: true });
  assert.strictEqual(b2.enemies[0].cd, cd + 1);
  var b3 = battle(["null", "rime", "ignis", "volta"], [["rock_worm", 270, 300]]);
  full(b3); C.beginShot(b3, { skill: true });
  assert.strictEqual(b3.nullTurns, 2);
  C.endShot(b3); C.beginShot(b3);  // 霜苓（冰彗）打碎岩蟲（抗冰彗）
  assert.strictEqual(dmgTo(hit(b3, 0), b3.enemies[0].uid, "hit"), H.rime.atk, "抗性失效");
});

test("撞擊型技能：熾核、耀斑、聚焦、處決、潮汐鎖、隱蔽、日珥、絕對零度", function () {
  function one(id, setup) {
    var b = battle(fill([id]), [["ore_crawler", 270, 300], ["ore_crawler", 470, 800]]);
    if (setup) setup(b);
    full(b); C.beginShot(b, { skill: true });
    return b;
  }
  var b = one("ignis");
  assert.ok(of(hit(b, 0), "explode").some(function (x) { return x.radius === 60; }));
  b = one("flare");
  assert.strictEqual(dmgTo(hit(b, 0), b.enemies[0].uid, "hit"), Math.round(H.flare.atk * 2 * 1.5));
  b = one("beam");
  assert.strictEqual(dmgTo(hit(b, 0, 0), b.enemies[0].uid, "hit"), H.beam.atk * 5);
  assert.strictEqual(dmgTo(hit(b, 0, 20), b.enemies[0].uid, "hit"), H.beam.atk);
  b = one("umbra", function (x) { x.enemies[0].hp = 400; });
  assert.strictEqual(dmgTo(hit(b, 0), b.enemies[0].uid, "hit"), Math.round((H.umbra.atk + (1500 - 400) * H.umbra.trait.ratio) * 3), "處決 ×3（含被動斬殺）");
  b = one("tidal");
  hit(b, 0, 0);
  assert.strictEqual(dmgTo(hit(b, 0, 20), b.enemies[0].uid, "hit"), Math.round(H.tidal.atk * 1.3));
  b = one("veil");
  assert.strictEqual(dmgTo(hit(b, 0), b.enemies[0].uid, "hit"), Math.round(H.veil.atk * 1.3));
  b = one("corona");
  hit(b, 0);
  assert.strictEqual(b.enemies[0].mark.burnMult, 2);
  var h0 = b.enemies[0].hp; C.endShot(b); C.enemyTurn(b);
  assert.strictEqual(h0 - b.enemies[0].hp, Math.round(H.corona.atk * K.BURN_RATIO * 2));
  b = one("rime");
  var cd = b.enemies[0].cd; hit(b, 0, 0); hit(b, 0, 20);
  assert.strictEqual(b.enemies[0].cd, cd + 2, "冰彗印記 +1、絕對零度 +1（各一次）");
});

test("折射（稜鏡）每次撞擊都引發反應；聖域（光環）每 10 Hit 回復 5%", function () {
  var b = battle(fill(["prism"]), [["ore_crawler", 270, 300]]);
  full(b); C.beginShot(b, { skill: true });
  assert.strictEqual(of(hit(b, 0), "reaction").length, 1);
  var b2 = battle(fill(["halo"]), [["ore_crawler", 270, 300]]);
  b2.hp = 100; full(b2); C.beginShot(b2, { skill: true });
  for (var i = 0; i < 10; i++) hit(b2, 0, i * 10);
  var trait = Math.round(b2.hpMax * 0.005);
  assert.strictEqual(b2.hp, 100 + trait * 10 + Math.round(b2.hpMax * 0.05));
});

test("擊破型技能：坍縮核、深淵（全隊 +5）、吞噬（虛空量表 ×2）；恆星爐（連爆加成）", function () {
  var b = battle(fill(["well"]), [["spore_drifter", 270, 300], ["ore_crawler", 270, 400]]);
  b.enemies[0].hp = 1; full(b); C.beginShot(b, { skill: true });
  assert.ok(of(hit(b, 0), "explode").some(function (x) { return x.radius === 120; }));
  var b2 = battle(fill(["abyss"]), [["spore_drifter", 270, 300], ["ore_crawler", 470, 900]]);
  b2.enemies[0].hp = 1; full(b2); C.beginShot(b2, { skill: true }); hit(b2, 0);
  assert.strictEqual(b2.party[1].gauge, 5);
  var b3 = battle(fill(["nox"]), [["rock_worm", 270, 300], ["ore_crawler", 470, 900]]);
  b3.enemies[0].hp = 1; full(b3); C.beginShot(b3, { skill: true }); hit(b3, 0);
  assert.strictEqual(b3.party[1].gauge, Math.floor(700 * K.VOID_GAUGE_RATIO / K.VOID_GAUGE_DIV) * 2);
  var b4 = battle(fill(["helio"]), [["spore_drifter", 100, 100], ["spore_drifter", 135, 100]]);
  b4.enemies[0].hp = 1; b4.enemies[1].hp = 500; full(b4); C.beginShot(b4, { skill: true });
  var c4 = hit(b4, 0);
  // 連爆第 1 層 ×1.25，再加上赫利被動火花（第 0 層，不加成）
  assert.strictEqual(dmgTo(c4, b4.enemies[1].uid, "explode"), Math.round(220 * 0.3 * 1.25 * 1.5) + Math.round(H.helio.atk * 0.3 * 1.5));
});

test("過載（沃爾塔 3 跳）、磁暴（撞牆全體）、電容（結束時 30%）、超新星（停止點爆炸）", function () {
  var b = battle(fill(["volta"]), [["ore_crawler", 100, 300], ["ore_crawler", 200, 300], ["ore_crawler", 300, 300], ["ore_crawler", 400, 300]]);
  full(b); C.beginShot(b, { skill: true });
  assert.strictEqual(of(hit(b, 0), "arc").length, 3);
  var b2 = battle(fill(["arc"]), [["ore_crawler", 270, 300], ["ore_crawler", 100, 800]]);
  full(b2); C.beginShot(b2, { skill: true });
  var c2 = C.onWall(b2, { x: 540, y: 0 });
  assert.ok(dmgTo(c2, b2.enemies[0].uid) > 0 && dmgTo(c2, b2.enemies[1].uid) > 0);
  var b3 = battle(fill(["tesla"]), [["ore_crawler", 270, 300]]);
  full(b3); C.beginShot(b3, { skill: true });
  var hd = dmgTo(hit(b3, 0), b3.enemies[0].uid, "hit");
  var r3 = C.endShot(b3, { x: 0, y: 0 });
  assert.strictEqual(dmgTo(r3.cmds, b3.enemies[0].uid), Math.round(hd * 0.3));
  var b4 = battle(fill(["pyra"]), [["ore_crawler", 270, 300]]);
  full(b4); C.beginShot(b4, { skill: true });
  var r4 = C.endShot(b4, { x: 270, y: 400 });
  assert.ok(of(r4.cmds, "explode").some(function (x) { return x.radius === 200; }));
});

test("射擊選項：穿透、半徑、光速、偏折、轉向、事件視界、殘影、反彈不減速、引力加倍", function () {
  function launch(id, skill) {
    var b = battle(fill([id]), [["ore_crawler", 270, 300]]);
    if (skill) full(b);
    return { b: b, r: C.beginShot(b, { skill: !!skill, x: 270, y: 800 }) };
  }
  assert.ok(launch("pyra").r.launch.pierce);
  assert.ok(launch("tail", true).r.launch.pierce);
  assert.ok(!launch("tail").r.launch.pierce);
  assert.strictEqual(launch("drift").r.launch.radius, 30);
  assert.strictEqual(launch("drift", true).r.launch.radius, 30 * 1.6);
  var l = launch("lumen", true).r.launch;
  assert.strictEqual(l.speedMult, 1.5); assert.strictEqual(l.airMult, 0.67); assert.strictEqual(l.restitution, 1);
  var d = launch("lens", true).r.launch;
  assert.strictEqual(d.enemyPull, 30); assert.strictEqual(d.wellBoost, 2);
  assert.ok(launch("ion", true).r.launch.redirect);
  assert.strictEqual(of(launch("orbit", true).r.cmds, "well").length, 1);
  assert.ok(launch("echo", true).b.ghostNext);
});

// ---------------- 場地：星座、小行星、碎片、殘影 ----------------
var STARS = [{ x: 100, y: 500 }, { x: 200, y: 500 }, { x: 300, y: 500 }, { x: 400, y: 500 }, { x: 480, y: 500 }];
function starBattle() { return battle(["ignis", "rime", "volta", "nox"], [["ore_crawler", 270, 200], ["ore_crawler", 100, 200]], { stars: STARS }); }
function light(b, n) { for (var i = 0; i < n; i++) C.onPos(b, { x: STARS[i].x, y: STARS[i].y + 10 }); }

test("星座：同一星點只亮一次；3 → 隕石雨 5 發、4 → 護盾、5 → 全隊量表充滿", function () {
  var b = starBattle(); C.beginShot(b);
  light(b, 3); light(b, 3);
  assert.strictEqual(b.shot.lit.length, 3);
  var r = C.endShot(b, { x: 0, y: 0 });
  assert.strictEqual(of(r.cmds, "constellation")[0].id, "tri");
  assert.strictEqual(of(r.cmds, "bolt").length, K.METEOR_N);
  b = starBattle(); C.beginShot(b); light(b, 4); C.endShot(b);
  assert.strictEqual(b.shield, K.ARK_SHIELD);
  b = starBattle(); C.beginShot(b); light(b, 5); C.endShot(b);
  assert.ok(b.party.every(function (p) { return p.gauge === p.gaugeMax; }));
  b = starBattle(); C.beginShot(b); light(b, 2);
  assert.strictEqual(of(C.endShot(b).cmds, "constellation").length, 0);
});

test("小行星：撞 3 次碎裂並產生 3～5 個碎片；碎片撞敵（速度 ≥ 6）攻 ×0.4、計 Hit", function () {
  var b = battle(["ignis", "rime", "volta", "nox"], [["ore_crawler", 270, 300]], { rocks: [{ x: 270, y: 500 }] });
  C.beginShot(b);
  C.onRock(b, { rock: "r0", step: 0 }); C.onRock(b, { rock: "r0", step: 2 });
  assert.strictEqual(b.rocks[0].dur, K.ROCK_DUR - 1, "6 步內不重複");
  C.onRock(b, { rock: "r0", step: 20 });
  var cmds = C.onRock(b, { rock: "r0", step: 40 });
  assert.strictEqual(of(cmds, "rockBreak").length, 1);
  var deb = of(cmds, "debris")[0];
  assert.ok(deb.n >= 3 && deb.n <= 5);
  assert.strictEqual(C.onDebris(b, { enemy: b.enemies[0].uid, speed: 3, step: 50, debris: 1 }).length, 0);
  var h = b.shot.hits;
  var c2 = C.onDebris(b, { enemy: b.enemies[0].uid, speed: 8, step: 60, debris: 1 });
  assert.strictEqual(dmgTo(c2, b.enemies[0].uid), Math.round(H.ignis.atk * K.DEBRIS_MULT * 1.5));
  assert.strictEqual(b.shot.hits, h + 1);
});

test("殘影：射出者攻 ×0.5×屬性、不計 Hit、不留印記、6 子步間隔", function () {
  var b = battle(["ignis", "rime", "volta", "nox"], [["ore_crawler", 270, 300]]);
  C.beginShot(b);
  var c = C.onGhost(b, { enemy: b.enemies[0].uid, step: 0 });
  assert.strictEqual(dmgTo(c, b.enemies[0].uid), Math.round(H.ignis.atk * K.GHOST_MULT * 1.5));
  assert.strictEqual(b.shot.hits, 0);
  assert.strictEqual(b.enemies[0].mark, null);
  assert.strictEqual(C.onGhost(b, { enemy: b.enemies[0].uid, step: 3 }).length, 0);
});

process.on("exit", function () { console.log("passed " + passed); });
