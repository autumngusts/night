// ============================================================================
// 末日據點（zombie）核心功能檢查（不開瀏覽器，直接用 Node 載入 static_src）。
// 執行：node tools/zombie_check/core_check.js
//   1. 投票（2026-11-04）：過半數決定、全員投完依多數、平手以該隊玩家為準、以目前票數決定的權限、不合條件的票、收留的人歸誰
//   2. 權限：不能指揮別人的倖存者、規劃好了就不能改
//   3. 感染：血清、截肢（需要醫生或醫務室）、請他離開、說出來；藏著屍變會傷人、公開屍變不會
//   4. 裝備：同一把武器只能一個人拿
//   5. 修建與製作：材料扣除、圍牆升級加耐久、菜園生產、燃燒瓶
//   6. 結局：無線電 3 天後撤離、研究室做出解藥、撐到最後一天、全滅、士氣連兩天 0 解散、缺糧受傷
//   7. 夜晚：四種指令的消耗與冷卻、同一份設定＋同一串指令結果相同、陷落
//   8. 傳承：一場只記一次、解鎖扣點、每日挑戰同一天同一個種子
//   9. 存檔：JSON 來回不變、舊存檔沒有 votes 也能用
// ============================================================================
"use strict";
var fs = require("fs"), path = require("path"), assert = require("assert");
global.window = global;
global.I18N = { getLang: function () { return "zh"; } };
var mem = {};
global.localStorage = { getItem: function (k) { return mem[k] === undefined ? null : mem[k]; }, setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; } };
var SRC = path.join(__dirname, "..", "..", "static_src");
["zombie_data.js", "zombie_night.js", "zombie_core.js"].forEach(function (f) { eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8")); });
var D = window.PriTestZombieData, Core = window.PriTestZombieCore, Night = window.PriTestZombieNight;

function game(np, o) {
  var ps = []; for (var i = 0; i < np; i++) ps.push({ pid: "p" + i, name: "P" + i });
  o = o || {};
  o.seed = o.seed || 12345; o.players = ps; o.city = o.city || "tw"; o.len = o.len || 10;
  return Core.newGame(o);
}
function mine(s, pid) { return Core.alive(s).filter(function (v) { return v.owner === pid; }); }
// 讓 pid 的第一個人外出到 conv，其他人都休息；全員準備好
function goExplore(s, who) {
  s.players.forEach(function (p) {
    mine(s, p.pid).forEach(function (v, i) { Core.applyIntent(s, p.pid, { a: "assign", sid: v.id, job: who.indexOf(p.pid) >= 0 && i === 0 ? "scavenge" : "rest" }); });
    if (who.indexOf(p.pid) >= 0) Core.applyIntent(s, p.pid, { a: "district", d: "conv" });
  });
  s.gate = null;
  s.players.forEach(function (p) { Core.applyIntent(s, p.pid, { a: "ready", v: true }); });
  assert.strictEqual(s.phase, "explore");
}
function okChoices(s, owner) {
  var c = Core.currentCard(s, owner);
  return c.ch.map(function (o, j) { return Core.reqOk(s, s.explore[owner], o.req) ? j : -1; }).filter(function (j) { return j >= 0; });
}

// ---------------- 1. 投票 ----------------
(function () {
  // 2 人：一票不夠（沒過半）；兩人都投、意見不同＝平手 → 以該隊玩家（p0）的票為準
  var s = game(2);
  goExplore(s, ["p0"]);
  var ok = okChoices(s, "p0");
  assert.ok(ok.length >= 2, "這張卡至少兩個可選選項（seed 固定）");
  Core.applyIntent(s, "p1", { a: "answer", ex: "p0", c: ok[1] });
  assert.strictEqual(s.explore.p0.step, 0, "2 人只有 1 票：還沒決定");
  assert.ok(!Core.applyIntent(s, "p1", { a: "force", k: "p0" }), "不是這隊的玩家不能「以目前票數決定」");
  Core.applyIntent(s, "p0", { a: "answer", ex: "p0", c: ok[0] });
  assert.strictEqual(s.explore.p0.step, 1, "全員投完就決定");
  var last = s.explore.p0.log.filter(function (l) { return l.card; }).pop();
  assert.strictEqual(last.c, ok[0], "平手以該隊玩家的票為準");
  assert.deepStrictEqual(Object.keys(last.votes).sort(), ["p0", "p1"], "日誌記錄每個人的票");
  // 改票：還沒決定前可以改
  var ok2 = okChoices(s, "p0");
  Core.applyIntent(s, "p0", { a: "answer", ex: "p0", c: ok2[0] });
  Core.applyIntent(s, "p0", { a: "answer", ex: "p0", c: ok2[ok2.length - 1] });
  assert.strictEqual(Core.votesOf(s, Core.voteKeyCard(s, "p0")).p0, ok2[ok2.length - 1], "可以改票");
  assert.ok(Core.applyIntent(s, "p0", { a: "force", k: "p0" }), "該隊玩家可以以目前票數決定");
  assert.strictEqual(s.explore.p0.step, 2);

  // 3 人：2 票相同＝過半，立刻決定（第 3 人還沒投）
  var s3 = game(3);
  goExplore(s3, ["p1"]);
  var o3 = okChoices(s3, "p1");
  Core.applyIntent(s3, "p0", { a: "answer", ex: "p1", c: o3[0] });
  assert.strictEqual(s3.explore.p1.step, 0);
  Core.applyIntent(s3, "p2", { a: "answer", ex: "p1", c: o3[0] });
  assert.strictEqual(s3.explore.p1.step, 1, "3 人中 2 票相同＝過半");
  // 不合條件的選項不能投
  var cur = Core.currentCard(s3, "p1"), bad = cur.ch.map(function (o, j) { return Core.reqOk(s3, s3.explore.p1, o.req) ? -1 : j; }).filter(function (j) { return j >= 0; })[0];
  if (bad !== undefined) assert.ok(!Core.applyIntent(s3, "p0", { a: "answer", ex: "p1", c: bad }), "不合條件的選項不能投");
  // 兩隊同時外出，彼此都能投
  var s4 = game(2);
  goExplore(s4, ["p0", "p1"]);
  ["p0", "p1"].forEach(function (owner) { var c = okChoices(s4, owner)[0]; Core.applyIntent(s4, "p0", { a: "answer", ex: owner, c: c }); Core.applyIntent(s4, "p1", { a: "answer", ex: owner, c: c }); });
  assert.ok(s4.explore.p0.step === 1 && s4.explore.p1.step === 1, "兩隊的卡都由兩人投票決定");

  // 大門口：2 人投不同 → 平手取最前面的選項；收留的人給倖存者最少的玩家
  var g = game(2);
  g.gate = { id: "g_family" };
  mine(g, "p0")[0].alive = false;                        // p0 少一人
  Core.applyIntent(g, "p1", { a: "gate", c: 2 });
  assert.ok(g.gate, "大門口：1 票不夠");
  assert.ok(!Core.applyIntent(g, "p1", { a: "ready", v: true }), "大門口沒決定不能準備好");
  var before0 = mine(g, "p0").length;
  Core.applyIntent(g, "p0", { a: "gate", c: 0 });
  assert.strictEqual(g.gate, null, "兩人都投了就決定");
  assert.strictEqual(mine(g, "p0").length, before0 + 2, "平手取最前面的選項（收留 2 人），歸倖存者最少的玩家");
  var g2 = game(3);
  g2.gate = { id: "g_merchant" };
  Core.applyIntent(g2, "p2", { a: "gate", c: 3 });
  assert.ok(Core.applyIntent(g2, "p1", { a: "force", k: "gate" }), "大門口：任何人都可以以目前票數決定");
  assert.strictEqual(g2.gate, null);
  // 單機：投下去就決定
  var so = game(1);
  goExplore(so, ["p0"]);
  Core.applyIntent(so, "p0", { a: "answer", c: okChoices(so, "p0")[0] });
  assert.strictEqual(so.explore.p0.step, 1, "單機投下去就決定（不用 ex）");
})();
console.log("1. 投票 OK");

// ---------------- 2. 權限 ----------------
(function () {
  var s = game(2), other = mine(s, "p1")[0];
  assert.ok(!Core.applyIntent(s, "p0", { a: "assign", sid: other.id, job: "craft" }), "不能指揮別人的倖存者");
  assert.ok(!Core.applyIntent(s, "nobody", { a: "ready", v: true }), "觀戰者不能操作");
  Core.applyIntent(s, "p0", { a: "ready", v: true });
  assert.ok(!Core.applyIntent(s, "p0", { a: "assign", sid: mine(s, "p0")[0].id, job: "craft" }), "準備好之後不能改工作");
  var v = mine(s, "p1")[0]; v.hp = 3;
  assert.ok(!Core.applyIntent(s, "p1", { a: "assign", sid: v.id, job: "scavenge" }), "重傷不能外出");
})();
console.log("2. 權限 OK");

// ---------------- 3. 感染 ----------------
(function () {
  var s = game(1), vs = mine(s, "p0");
  vs[0].inf = { d: 3, hid: true };
  assert.ok(!Core.applyIntent(s, "p0", { a: "treat", sid: vs[0].id, how: "serum" }), "沒有血清");
  s.items.serum = 1;
  assert.ok(Core.applyIntent(s, "p0", { a: "treat", sid: vs[0].id, how: "serum" }) && !vs[0].inf && s.items.serum === 0, "血清治好、用掉");
  // 截肢：沒醫生也沒醫務室 → 不行
  vs.forEach(function (v) { v.stats.med = 1; v.traits = []; });
  vs[1].inf = { d: 2, hid: false };
  assert.ok(!Core.applyIntent(s, "p0", { a: "treat", sid: vs[1].id, how: "amputate" }), "截肢需要醫生或醫務室");
  s.bld.infirmary = 1;
  assert.ok(Core.applyIntent(s, "p0", { a: "treat", sid: vs[1].id, how: "amputate" }), "有醫務室可以截肢");
  assert.ok(!vs[1].alive || (vs[1].amp && !vs[1].inf), "截肢：成功（截肢、沒感染）或失敗（死亡）");
  vs[2].inf = { d: 2, hid: true };
  assert.ok(Core.applyIntent(s, "p0", { a: "treat", sid: vs[2].id, how: "reveal" }) && vs[2].inf.hid === false, "說出來");
  assert.ok(Core.applyIntent(s, "p0", { a: "treat", sid: vs[2].id, how: "exile" }) && !vs[2].alive, "請他離開");
  // 藏著屍變：會有人受傷；公開屍變：不會
  function turnTest(hid) {
    var t = game(1, { seed: 777 }), xs = mine(t, "p0");
    xs[0].inf = { d: 1, hid: hid };
    var hp0 = xs.slice(1).map(function (v) { return v.hp; }).reduce(function (a, b) { return a + b; }, 0);
    Core.applyIntent(t, "p0", { a: "ready", v: true });
    Core.endNight(t, Night.create(t.night).runToEnd());
    var hp1 = xs.slice(1).map(function (v) { return v.hp; }).reduce(function (a, b) { return a + b; }, 0);
    return { dead: !xs[0].alive, lost: hp0 - hp1, log: t.dawnLog.map(function (l) { return l.k; }) };
  }
  var h = turnTest(true), k = turnTest(false);
  assert.ok(h.dead && h.log.indexOf("zm_l_turned_hidden") >= 0, "藏著的人屍變");
  assert.ok(k.dead && k.log.indexOf("zm_l_turned_known") >= 0, "公開的人在隔離室屍變");
  assert.ok(h.lost > k.lost, "藏著屍變會咬傷人（HP 損失 " + h.lost + " > " + k.lost + "）");
})();
console.log("3. 感染 OK");

// ---------------- 4. 裝備 ----------------
(function () {
  var s = game(2), a = mine(s, "p0")[0], b = mine(s, "p1")[0];
  s.weapons.push({ uid: "wX", type: "bat", dur: 5 });
  assert.ok(Core.applyIntent(s, "p0", { a: "equip", sid: a.id, w: "wX" }) && a.weapon === "wX");
  assert.ok(Core.applyIntent(s, "p1", { a: "equip", sid: b.id, w: "wX" }) && b.weapon === "wX" && a.weapon === null, "同一把武器只能一個人拿");
  assert.ok(!Core.applyIntent(s, "p0", { a: "equip", sid: a.id, w: "nope" }), "不存在的武器");
})();
console.log("4. 裝備 OK");

// ---------------- 5. 修建與製作 ----------------
(function () {
  var s = game(1), vs = mine(s, "p0");
  s.res.mats = 40; s.res.fuel = 5;
  vs.forEach(function (v) { v.stats.crf = 5; Core.applyIntent(s, "p0", { a: "assign", sid: v.id, job: v === vs[3] ? "craft" : "build" }); });
  Core.applyIntent(s, "p0", { a: "build", b: "wall" });
  Core.applyIntent(s, "p0", { a: "craft", r: "molotov" });
  var mol0 = s.items.molotov;
  Core.applyIntent(s, "p0", { a: "ready", v: true });
  assert.strictEqual(s.phase, "night");
  assert.strictEqual(s.bld.wall, 2, "圍牆升到 Lv2");
  assert.ok(s.walls.every(function (w) { return w === 100; }), "圍牆耐久 60 → 100");
  assert.ok(s.items.molotov > mol0, "做出燃燒瓶");
  assert.ok(s.res.mats < 40 && s.res.fuel < 5, "扣掉材料與燃料");
  assert.ok(!Core.applyIntent(game(1), "p0", { a: "build", b: "lab" }), "研究室需要發電機");
  // 菜園：清晨生產
  var g = game(1); g.bld.garden = 1;
  var food0 = g.res.food;
  Core.applyIntent(g, "p0", { a: "ready", v: true });
  Core.endNight(g, Night.create(g.night).runToEnd());
  assert.ok(g.dawnLog.some(function (l) { return l.k === "zm_l_garden"; }), "菜園收成");
  assert.ok(g.res.food >= food0 + 2 - Core.alive(g).length - 1, "食物＝原本＋收成−吃掉");
})();
console.log("5. 修建與製作 OK");

// ---------------- 6. 結局 ----------------
function runDays(s, n) {
  for (var i = 0; i < n && !s.end; i++) {
    if (s.phase === "plan") { s.gate = null; mine(s, "p0").forEach(function (v) { Core.applyIntent(s, "p0", { a: "assign", sid: v.id, job: "rest" }); }); Core.applyIntent(s, "p0", { a: "ready", v: true }); }
    if (s.phase === "night") { s.night.n = 1; Core.endNight(s, Night.create(s.night).runToEnd()); }
    if (s.phase === "dawn") Core.applyIntent(s, "p0", { a: "ready", v: true });
  }
}
(function () {
  // 無線電：零件 3 個＋蓋好 → 3 天後撤離
  var s = game(1);
  s.items.part = 3; s.res.mats = 30; s.res.food = 99; s.res.water = 99;
  mine(s, "p0").forEach(function (v) { v.stats.crf = 5; Core.applyIntent(s, "p0", { a: "assign", sid: v.id, job: "build" }); });
  Core.applyIntent(s, "p0", { a: "build", b: "radio" });
  Core.applyIntent(s, "p0", { a: "ready", v: true });
  assert.ok(s.bld.radio === 1 && s.items.part === 0 && s.evacIn === Core.EVAC_DAYS, "無線電蓋好，3 天後撤離");
  runDays(s, 12);
  // 第 1 天蓋好 → 撐過 3 個夜晚，第 3 夜後的清晨撤離（end.day＝撐過的最後一天，與救援結局同樣記法）
  assert.ok(s.end && s.end.kind === "radio" && s.end.day === 1 + Core.EVAC_DAYS - 1, "撐過 3 夜後撤離：" + JSON.stringify(s.end));
  // 解藥
  var c = game(1); c.bld.lab = 1; c.bld.generator = 1; c.research = Core.cureNeed(c) - 0.5; c.res.food = 99; c.res.water = 99;
  mine(c, "p0").forEach(function (v) { Core.applyIntent(c, "p0", { a: "assign", sid: v.id, job: "research" }); });
  Core.applyIntent(c, "p0", { a: "ready", v: true });
  Core.endNight(c, Night.create(c.night).runToEnd());
  assert.strictEqual(c.end && c.end.kind, "cure", "研究點數滿了＝解藥");
  // 撐到最後一天
  var r = game(1); r.res.food = 999; r.res.water = 999;
  runDays(r, 60);
  assert.strictEqual(r.end && r.end.kind, "rescue", "撐過第 10 天＝救援");
  assert.ok(r.end.win && r.end.legacy >= 1);
  // 陷落
  var f = game(1);
  Core.applyIntent(f, "p0", { a: "ready", v: true });
  var res = Night.create(f.night).runToEnd(); res.overrun = true; res.core = 0;
  Core.endNight(f, res);
  assert.strictEqual(f.end.kind, "fall");
  // 士氣連兩天 0 → 解散
  var m = game(1); m.res.food = 99; m.res.water = 99;
  m.morale = 0; mine(m, "p0").forEach(function (v) { v.traits = []; });
  runDays(m, 1); m.morale = 0; runDays(m, 4);
  assert.strictEqual(m.end && m.end.kind, "disband", "士氣連兩天 0＝解散");
  // 缺糧
  var h = game(1); h.res.food = 0; h.res.water = 0;
  var hp0 = mine(h, "p0").reduce(function (a, v) { return a + v.hp; }, 0);
  runDays(h, 3);
  assert.ok(h.dawnLog.some(function (l) { return l.k === "zm_l_hungry"; }) && h.dawnLog.some(function (l) { return l.k === "zm_l_thirsty"; }), "缺糧缺水");
  assert.ok(mine(h, "p0").reduce(function (a, v) { return a + v.hp; }, 0) < hp0, "缺糧會受傷");
})();
console.log("6. 結局 OK");

// ---------------- 7. 夜晚 ----------------
(function () {
  var s = game(1);
  Core.applyIntent(s, "p0", { a: "ready", v: true });
  var setup = JSON.parse(JSON.stringify(s.night));
  setup.molotov = 1; setup.decoy = 1; setup.mats = 5; setup.ammo = 10;
  var sim = Night.create(setup);
  for (var i = 0; i < 150; i++) sim.tick();
  var z = sim.zs[0];
  assert.ok(z, "有殭屍");
  assert.ok(sim.cmd("me", { a: "shoot", id: z.id }) && sim.ammo === 10 - sim.ammoUsed, "射擊用彈藥");
  assert.ok(!sim.cmd("me", { a: "shoot", id: z.id }), "射擊冷卻 0.4 秒");
  assert.ok(sim.cmd("other", { a: "shoot", id: z.id }), "冷卻是每個玩家各自算");
  sim.walls[2] = 10;
  assert.ok(sim.cmd("me", { a: "repair", seg: 2 }) && sim.walls[2] === 25 && sim.mats === 4, "修牆 +15、材料 −1");
  assert.ok(sim.cmd("me", { a: "fire", x: z.x, z: z.z }) && sim.molotov === 0 && sim.fires.length === 1, "燃燒瓶");
  assert.ok(!sim.cmd("me", { a: "fire", x: 0, z: 0 }), "沒有燃燒瓶了");
  assert.ok(sim.cmd("me", { a: "decoy", x: 20, z: 20 }) && sim.decoy === 0 && sim.decoys.length === 1, "噪音誘餌");
  var r1 = sim.runToEnd();
  // 確定性：同一份設定＋同一串指令
  function replay() {
    var x = Night.create(setup);
    for (var j = 0; j < 150; j++) x.tick();
    var zz = x.zs[0];
    x.cmd("me", { a: "shoot", id: zz.id }); x.cmd("me", { a: "shoot", id: zz.id }); x.cmd("other", { a: "shoot", id: zz.id });
    x.walls[2] = 10; x.cmd("me", { a: "repair", seg: 2 }); x.cmd("me", { a: "fire", x: zz.x, z: zz.z }); x.cmd("me", { a: "fire", x: 0, z: 0 }); x.cmd("me", { a: "decoy", x: 20, z: 20 });
    return x.runToEnd();
  }
  assert.strictEqual(JSON.stringify(replay()), JSON.stringify(r1), "同一份設定＋指令＝同一結果");
  // 陷落：牆與建築都很弱、殭屍很多、沒彈藥
  var w = JSON.parse(JSON.stringify(setup));
  w.walls = w.walls.map(function () { return 1; }); w.core = 5; w.n = 30; w.ammo = 0; w.guards = [];
  assert.ok(Night.create(w).runToEnd().overrun, "沒人守＝陷落");
})();
console.log("7. 夜晚 OK");

// ---------------- 8. 傳承 ----------------
(function () {
  mem = {};
  var s = game(1); s.res.food = 999; s.res.water = 999;
  runDays(s, 60);
  var m1 = Core.recordRun(s), pts = m1.pts;
  assert.ok(pts > 0 && m1.runs === 1, "記錄一場");
  var m2 = Core.recordRun(s);
  assert.ok(m2.pts === pts && m2.runs === 1, "同一場只記一次");
  m2.pts = 30; Core.saveMeta(m2);
  var m3 = Core.loadMeta();
  assert.ok(!Core.isUnlocked(m3, "cop") && Core.unlock(m3, "cop") && Core.isUnlocked(Core.loadMeta(), "cop") && Core.loadMeta().pts === 30 - D.SPECIALS.cop.cost, "解鎖扣點");
  assert.ok(!Core.unlock(Core.loadMeta(), "police"), "點數不夠不能解鎖");
  var a = Core.dailyOpts(20261104), b = Core.dailyOpts(20261104), c = Core.dailyOpts(20261105);
  assert.deepStrictEqual(a, b, "每日挑戰同一天一樣");
  assert.notStrictEqual(a.seed, c.seed, "隔天不一樣");
  // 特殊倖存者與起始據點
  var sp = Core.newGame({ seed: 5, city: "jp", len: 30, base: "police", rules: ["horde"], players: [{ pid: "p0", special: "cop" }] });
  assert.ok(sp.surv.some(function (v) { return v.special === "cop" && v.weapon; }), "特殊倖存者帶著手槍");
  assert.ok(sp.bld.wall === 2 && sp.walls[0] === 100 && sp.res.ammo === 44, "派出所：圍牆 Lv2、彈藥多");
  assert.strictEqual(Core.ruleMult(sp), 1.4);
})();
console.log("8. 傳承 OK");

// ---------------- 9. 存檔 ----------------
(function () {
  var s = game(2);
  goExplore(s, ["p0"]);
  Core.applyIntent(s, "p1", { a: "answer", ex: "p0", c: okChoices(s, "p0")[0] });
  var copy = JSON.parse(JSON.stringify(s));
  assert.deepStrictEqual(copy, s, "JSON 來回不變");
  delete copy.votes;
  assert.ok(Core.applyIntent(copy, "p0", { a: "answer", ex: "p0", c: okChoices(copy, "p0")[0] }), "舊存檔沒有 votes 也能投票");
})();
console.log("9. 存檔 OK");


// ---------------- 10. 不等離線的人（2026-11-04） ----------------
(function () {
  var s = game(2);
  Core.applyIntent(s, "p0", { a: "ready", v: true });
  assert.strictEqual(s.phase, "plan");
  assert.ok(!Core.applyIntent(s, "p0", { a: "skip", who: ["p0"] }), "不能 skip 自己");
  s.gate = null;
  mine(s, "p1").forEach(function (v, i) { Core.applyIntent(s, "p1", { a: "assign", sid: v.id, job: i === 0 ? "scavenge" : "rest" }); });
  Core.applyIntent(s, "p1", { a: "district", d: "conv" });
  assert.ok(Core.applyIntent(s, "p0", { a: "skip", who: ["p1"] }) && s.phase === "explore", "規劃：當作離線的人準備好了");
  assert.ok(Core.applyIntent(s, "p0", { a: "skip", who: ["p1"] }) && s.phase === "night", "外出：離線的人那一隊用目前的票（沒有就第一個）決定到結束");
  Core.endNight(s, Night.create(s.night).runToEnd());
  Core.applyIntent(s, "p0", { a: "ready", v: true });
  assert.strictEqual(s.phase, "dawn");
  assert.ok(Core.applyIntent(s, "p0", { a: "skip", who: ["p1"] }) && s.phase === "plan" && s.day === 2, "清晨：當作離線的人看完了");
})();
console.log("10. 不等離線的人 OK");
// ---------------- 11. 中途加入／離開（2026-11-05） ----------------
(function () {
  var s = game(2);
  s.gate = null;
  var food0 = s.res.food, n0 = Core.alive(s).length;
  assert.ok(Core.applyIntent(s, "p9", { a: "join", name: "新人" }), "中途加入");
  assert.strictEqual(s.players.length, 3);
  assert.strictEqual(mine(s, "p9").length, Core.JOIN_SURV, "帶著同伴前來");
  assert.ok(s.res.food > food0 && Core.alive(s).length === n0 + Core.JOIN_SURV);
  assert.ok(!Core.applyIntent(s, "p9", { a: "join", name: "新人" }), "已經在局裡不能再加入");
  assert.ok(Core.applyIntent(s, "p9", { a: "assign", sid: mine(s, "p9")[0].id, job: "build" }), "加入後可以操作自己的人");
  // 離開：倖存者交給留下來的人，準備狀態照算
  Core.applyIntent(s, "p0", { a: "ready", v: true });
  Core.applyIntent(s, "p1", { a: "ready", v: true });
  var had = mine(s, "p9").map(function (v) { return v.id; });
  assert.ok(Core.applyIntent(s, "p9", { a: "leave" }), "中途離開");
  assert.strictEqual(s.players.length, 2);
  assert.strictEqual(mine(s, "p9").length, 0, "倖存者交出去了");
  assert.ok(s.phase === "explore" || s.phase === "night", "剩下的人都準備好了＝照常往下走（沒人外出時直接入夜）");
  // 再回來：領回還活著的人，不會多送
  Core.applyIntent(s, "p0", { a: "skip", who: ["p1"] });
  while (s.phase === "explore") { Object.keys(s.explore).forEach(function (k) { if (!s.explore[k].done) Core.applyIntent(s, "p0", { a: "skip", who: [k] }) || Core.applyIntent(s, k, { a: "force", k: k }); }); }
  assert.ok(!Core.applyIntent(s, "p9", { a: "join" }) || s.phase !== "night", "夜晚不能加入");
  if (s.phase === "night") Core.endNight(s, Night.create(s.night).runToEnd());
  var nAlive = Core.alive(s).length;
  assert.ok(Core.applyIntent(s, "p9", { a: "join", name: "新人" }), "回到這一局");
  assert.ok(mine(s, "p9").every(function (v) { return had.indexOf(v.id) >= 0; }) && Core.alive(s).length === nAlive, "領回原本的人，沒有多送");
  assert.ok(s.phase === "dawn" && s.ack.p9 === false, "清晨加入要一起看完");
  // 最後一人不能離開；離線的人可以被房主請出去
  assert.ok(Core.applyIntent(s, "p0", { a: "kick", who: ["p1", "p9"] }) && s.players.length === 1, "讓離線的人退出");
  assert.ok(!Core.applyIntent(s, "p0", { a: "leave" }), "最後一人不能離開");
  JSON.parse(JSON.stringify(s));
  // 上限 4 人
  var s2 = game(4);
  assert.ok(!Core.applyIntent(s2, "p8", { a: "join" }), "滿 4 人不能加入");
})();
console.log("11. 中途加入／離開 OK");
console.log("zombie core_check OK");
