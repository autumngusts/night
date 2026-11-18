// ============================================================================
// 射彈宇宙（shedan）第 4 階段：遠征規則核心（shedan_run.js，§11、§11.1）。不需要瀏覽器。
// 執行：node tools/shedan_check/run_check.js [名稱片段]
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

var passed = 0, only = process.argv[2];
function test(name, fn) { if (only && name.indexOf(only) < 0) return; fn(); passed++; console.log("ok - " + name); }
var TEAM = ["ignis", "rime", "volta", "nox"];
function newRun(seed, extra) { var o = { seed: seed || "t1", heroes: TEAM }; if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; }); return Run.create(o); }
// 走到第一個指定種類的節點（沿著可走的路，找不到回傳 null）
function goTo(run, type) {
  for (var guard = 0; guard < 20; guard++) {
    var r = Run.reachable(run);
    if (!r.length) return null;
    var hit = r.filter(function (id) { return Run.nodeOf(run, id).type === type; })[0];
    var id = hit || r[0];
    Run.enter(run, id);
    if (hit) return Run.nodeOf(run, id);
    // 不是目標：快速處理掉
    clearNode(run);
  }
  return null;
}
function clearNode(run) {
  var n = Run.current(run);
  if (n.type === "battle" || n.type === "elite" || n.type === "boss") { Run.finishBattle(run, { win: true, hp: run.hp }); Run.takeRelic(run, null); }
  else if (n.type === "rest") Run.rest(run, "heal");
  else if (n.type === "event") Run.choose(run, "b");
  else Run.leave(run);
}

test("地圖：同種子相同；每層 2～4、第 1 層全戰鬥、第 1～2 層無精英、第 4 層有休息、第 7 層連 Boss", function () {
  for (var s = 0; s < 40; s++) {
    var a = newRun("seed" + s), b = newRun("seed" + s);
    assert.deepStrictEqual(Run.mapOf(a), Run.mapOf(b));
    var m = Run.mapOf(a);
    for (var L = 1; L <= 7; L++) {
      var layer = m.nodes.filter(function (n) { return n.layer === L; });
      assert.ok(layer.length >= 2 && layer.length <= 4, "層 " + L);
      if (L === 1) assert.ok(layer.every(function (n) { return n.type === "battle"; }));
      if (L <= 2) assert.ok(layer.every(function (n) { return n.type !== "elite"; }));
      if (L === 4) assert.ok(layer.some(function (n) { return n.type === "rest"; }));
      if (L === 7) assert.ok(layer.every(function (n) { return n.next.length === 1 && n.next[0] === m.bossId; }));
    }
  }
});

test("地圖：每個節點都有入線（第 1 層除外）與出線；同一條路不連續兩個補給站", function () {
  for (var s = 0; s < 40; s++) {
    var m = Run.mapOf(newRun("conn" + s));
    m.nodes.forEach(function (n) {
      if (n.layer > 1) assert.ok(n.prev.length >= 1, n.id + " 入線");
      if (n.type !== "boss") assert.ok(n.next.length >= 1, n.id + " 出線");
      if (n.type === "shop") n.prev.forEach(function (p) { assert.notStrictEqual(Run.nodeOf({ maps: { 1: m }, sector: 1 }, p).type, "shop"); });
    });
  }
});

test("只能走到相連的節點", function () {
  var run = newRun("walk");
  var first = Run.reachable(run);
  assert.ok(first.length >= 2);
  var bad = Run.mapOf(run).nodes.filter(function (n) { return n.layer === 2; })[0].id;
  assert.throws(function () { Run.enter(run, bad); });
  Run.enter(run, first[0]);
  assert.strictEqual(Run.reachable(run).length, 0, "節點處理中不能移動");
});

test("戰鬥：配置可重現；勝利給能源與三選一；精英保證稀有以上；幸運骰 4 選；不重複已持有", function () {
  var a = newRun("bt"), b = newRun("bt");
  Run.enter(a, Run.reachable(a)[0]); Run.enter(b, Run.reachable(b)[0]);
  assert.deepStrictEqual(Run.battleSetup(a).enemies.map(function (e) { return e.def.id + e.x; }), Run.battleSetup(b).enemies.map(function (e) { return e.def.id + e.x; }));
  var r = Run.finishBattle(a, { win: true, hp: a.hp - 100, damage: 5000, maxChain: 3 });
  assert.strictEqual(r.energy, 30);
  assert.strictEqual(r.choices.length, 3);
  assert.strictEqual(a.hp, a.hpMax - 100);
  Run.takeRelic(a, r.choices[0]);
  assert.deepStrictEqual(a.relics, [r.choices[0]]);
  var e = newRun("elite" + 3);
  var en = goTo(e, "elite");
  if (en) {
    var re = Run.finishBattle(e, { win: true, hp: e.hp });
    assert.ok(re.choices.every(function (id) { return D.RELIC_BY_ID[id].rarity !== "common"; }), "精英保證稀有以上");
    assert.strictEqual(re.energy, 60);
  }
  var l = newRun("lucky", { relics: ["lucky_die"] });
  Run.enter(l, Run.reachable(l)[0]);
  var rl = Run.finishBattle(l, { win: true, hp: l.hp });
  assert.strictEqual(rl.choices.length, 4);
  assert.ok(rl.choices.indexOf("lucky_die") < 0, "不重複已持有");
});

test("精英：其中一隻帶精英特性；星區 3 可能是星蝕使徒", function () {
  var R = global.PriTestShedanRng;
  var apostle = 0, elite = 0;
  for (var s = 0; s < 60; s++) {
    var bt = Run.genBattle(R.make(s), { sector: 3, elite: true });
    var el = bt.enemies.filter(function (e) { return e.elite; });
    assert.strictEqual(el.length, 1);
    assert.ok(Run.ELITE_TRAITS.indexOf(el[0].elite) >= 0);
    elite++;
    if (el[0].def.id === "eclipse_apostle") apostle++;
    assert.ok(bt.enemies.filter(function (e) { return !e.elite; }).every(function (e) { return e.def.trait !== "eclipse"; }), "非精英不會是星蝕使徒");
  }
  assert.ok(apostle > 0 && apostle < elite);
});

test("戰敗 → lost；Boss（星區 3）→ won；Boss 後進下一星區", function () {
  var run = newRun("lose");
  Run.enter(run, Run.reachable(run)[0]);
  Run.finishBattle(run, { win: false, hp: 0 });
  assert.strictEqual(run.state, "lost");
  var w = newRun("winrun");
  for (var sec = 1; sec <= 3; sec++) {
    assert.strictEqual(w.sector, sec);
    assert.ok(goTo(w, "boss"), "星區 " + sec + " 走得到 Boss");
    Run.finishBattle(w, { win: true, hp: w.hp });
    Run.takeRelic(w, null);
  }
  assert.strictEqual(w.state, "won");
  assert.ok(Run.score(w) > 1000);
});

test("補給站：3 件、價格依稀有度、商人會員卡 −20%、能源不足不能買、修復一次", function () {
  var run = newRun("shop1");
  for (var s = 0; s < 30 && !goTo(run, "shop"); s++) run = newRun("shop" + s);
  assert.strictEqual(Run.current(run).type, "shop");
  var sh = Run.data(run).shop;
  assert.strictEqual(sh.items.length, 3);
  sh.items.forEach(function (it) { assert.strictEqual(it.price, { common: 80, rare: 120, legendary: 150 }[D.RELIC_BY_ID[it.id].rarity]); });
  run.energy = 0;
  assert.ok(!Run.buy(run, 0));
  run.energy = 1000;
  assert.ok(Run.buy(run, 0));
  assert.ok(!Run.buy(run, 0), "已售出");
  run.hp = 10;
  assert.ok(Run.repair(run));
  assert.ok(!Run.repair(run), "每站一次");
  var cheap = newRun("x", { relics: ["merchant_card"] });
  assert.strictEqual(Run.price(cheap, "fuse"), Math.round(120 * 0.8));
});

test("休息：回 30%（醫療艙 ×1.5）；強化技能量表上限 −5（最低 8）", function () {
  var run = newRun("rest");
  goTo(run, "rest");
  run.hp = 100;
  Run.rest(run, "heal");
  assert.strictEqual(run.hp, 100 + Math.round(run.hpMax * 0.3));
  var r2 = newRun("rest", { relics: ["med_pod"] });
  goTo(r2, "rest"); r2.hp = 100; Run.rest(r2, "heal");
  assert.strictEqual(r2.hp, 100 + Math.round(r2.hpMax * 0.3 * 1.5));
  var r3 = newRun("rest");
  goTo(r3, "rest"); Run.rest(r3, "upgrade", 0);
  assert.strictEqual(r3.gaugeMinus.ignis, 5);
  r3.gaugeMinus.ignis = 11; r3.state = "node"; Run.rest(r3, "upgrade", 0);
  assert.strictEqual(r3.gaugeMinus.ignis, D.HERO_BY_ID.ignis.gauge - 8);
});

test("漂流者：救援角色不在隊上；兩種代價；替換後最大 HP 重算、HP 依比例", function () {
  var run = null;
  for (var s = 0; s < 40; s++) { run = newRun("drift" + s); if (goTo(run, "drifter")) break; }
  assert.strictEqual(Run.current(run).type, "drifter");
  var who = Run.data(run).drifter;
  assert.ok(run.heroes.indexOf(who) < 0);
  run.energy = 10;
  assert.ok(!Run.canRescue(run, "energy"));
  run.hp = Math.round(run.hpMax / 2);
  var cost = Run.drifterCost(run, "hp");
  assert.strictEqual(cost, Math.round(run.hp * 0.15));
  var ratio = (run.hp - cost) / run.hpMax;     // 付完代價後的比例
  assert.ok(Run.rescue(run, "hp", 0));
  assert.strictEqual(run.heroes[0], who);
  assert.strictEqual(run.hpMax, Run.calcMaxHp(run));
  assert.ok(Math.abs(run.hp / run.hpMax - ratio) < 0.01, "換隊後 HP 依比例");
  var r2 = null;
  for (var t = 0; t < 40; t++) { r2 = newRun("drift" + t); if (goTo(r2, "drifter")) break; }
  r2.energy = 100;
  assert.ok(Run.rescue(r2, "energy", null));
  assert.strictEqual(r2.energy, 60);
  assert.deepStrictEqual(r2.heroes, TEAM, "只救不換");
});

test("異常訊號：效果、能源不足不能選、拾荒者之手減半", function () {
  function atEvent(id, extra) {
    for (var s = 0; s < 200; s++) {
      var run = newRun("ev" + s, extra);
      var n = goTo(run, "event");
      if (n && Run.data(run).event === id) return run;
    }
    return null;
  }
  var r = atEvent("dust_storm");
  var e0 = r.energy, h0 = r.hp;
  Run.choose(r, "a");
  assert.strictEqual(r.energy, e0 + 50);
  // Math.round(-148.5) = -148（JS 的 .5 往 +∞），期望值用同一個算法
  assert.strictEqual(r.hp, h0 + Math.round(r.hpMax * -0.15));
  var r2 = atEvent("dust_storm", { relics: ["scavenger_hand"] });
  var h2 = r2.hp; Run.choose(r2, "a");
  assert.strictEqual(r2.hp, h2 + Math.round(r2.hpMax * -0.075));
  var r3 = atEvent("caravan");
  r3.energy = 10;
  assert.ok(!Run.canChoose(r3, "a"));
  r3.energy = 100;
  var out = Run.choose(r3, "a");
  assert.strictEqual(D.RELIC_BY_ID[out.relic].rarity, "rare");
  var r4 = atEvent("crystal");
  Run.choose(r4, "a");
  assert.ok(r4.flags.fullGauge);
  var r5 = atEvent("black_market");
  var mx = r5.hpMax; Run.choose(r5, "a");
  assert.strictEqual(r5.hpMax, Math.round(mx * 0.9));
});

test("強化外殼：最大 HP +15%（目前 HP 依比例）；地圖兩層以後要雷達才顯示種類", function () {
  var run = newRun("hull");
  var mx = run.hpMax;
  Run.addRelic(run, "reinforced_hull");
  assert.strictEqual(run.hpMax, Math.round(mx * 1.15));
  var far = Run.mapOf(run).nodes.filter(function (n) { return n.layer === 5; })[0];
  assert.ok(!Run.typeVisible(run, far));
  Run.addRelic(run, "scan_radar");
  assert.ok(Run.typeVisible(run, far));
});

process.on("exit", function () { console.log("passed " + passed); });
