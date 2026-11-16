// ============================================================================
// 百鬼轉珠（tama）規則核心檢查（不需要瀏覽器）：
//   盤面生成不含 3 連、消除判定（直／橫／L 型合併／分開的同色兩組）、落下補珠、連鎖、
//   傷害公式（§4）、屬性相剋、全體攻擊、隊長技能、主動技能、妖怪行動、波次與勝負、升級。
// 執行：node tools/tama_check/core_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var D = require(path.join(__dirname, "..", "..", "static_src", "tama_data.js"));
global.PriTestTamaData = D;
var C = require(path.join(__dirname, "..", "..", "static_src", "tama_core.js"));

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

// 用字串畫盤面：F 火 W 水 G 木 L 光 D 闇 H 心 J 邪
var CODE = { F: "fire", W: "water", G: "wood", L: "light", D: "dark", H: "heart", J: "jam" };
function board(rows) { return rows.map(function (s) { return s.split("").map(function (ch) { return CODE[ch]; }); }); }

test("開局盤面 1000 次都沒有 3 連", function () {
  var rng = C.makeRng(1);
  for (var i = 0; i < 1000; i++) assert.strictEqual(C.findGroups(C.newBoard(rng)).length, 0);
});

test("橫 3 連算 1 組", function () {
  var g = C.findGroups(board(["FFFWGL", "WGLDHW", "GLDHWG", "LDHWGL", "DHWGLD"]));
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].color, "fire");
  assert.strictEqual(g[0].count, 3);
});

test("L 型（橫 3＋直 3 共用一角）合併為 1 組 5 顆", function () {
  var g = C.findGroups(board(["FFFWGL", "FGLDHW", "FLDHWG", "LDHWGL", "DHWGLD"]));
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].count, 5);
});

test("不相連的同色兩組算 2 連擊", function () {
  var g = C.findGroups(board(["FFFWGL", "WGLDHW", "GLDHWG", "LDHWGL", "DHFFFD"]));
  assert.strictEqual(g.length, 2);
});

test("同色但只有 2 顆的旁邊格子不會被吞進組裡", function () {
  var g = C.findGroups(board(["FFFWGL", "FFLDHW", "GLDHWG", "LDHWGL", "DHWGLD"]));
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].count, 3, "第 2 列的 FF 沒有 3 連，不消除");
});

test("落下：上方珠子掉到底，空格由新珠補滿，盤面不留空", function () {
  var b = board(["FWGLDH", "WGLDHF", "GLDHFW", "LDHFWG", "DHFWGL"]);
  b[4][0] = null; b[3][0] = null;
  var d = C.drop(b, C.makeRng(2));
  assert.strictEqual(d.board[4][0], "wood", "第 3 列（G）掉到最底");
  assert.strictEqual(d.board[3][0], "water");
  assert.strictEqual(d.board[2][0], "fire");
  d.board.forEach(function (row) { row.forEach(function (o) { assert(o); }); });
  assert.strictEqual(d.falls.filter(function (f) { return f.fresh; }).length, 2);
});

test("resolve 會一直連鎖到沒有 3 連為止", function () {
  var rng = C.makeRng(3);
  for (var i = 0; i < 200; i++) {
    var b = C.newBoard(rng);
    b[0][0] = b[0][1] = b[0][2] = "fire";
    var res = C.resolve(b, rng);
    assert(res.groups.length >= 1);
    assert.strictEqual(C.findGroups(res.board).length, 0);
    assert.strictEqual(res.steps.length >= 1, true);
  }
});

test("屬性相剋", function () {
  assert.strictEqual(C.advantage("fire", "wood"), 2);
  assert.strictEqual(C.advantage("wood", "fire"), 0.5);
  assert.strictEqual(C.advantage("water", "fire"), 2);
  assert.strictEqual(C.advantage("light", "dark"), 2);
  assert.strictEqual(C.advantage("dark", "light"), 2);
  assert.strictEqual(C.advantage("light", "fire"), 1);
});

function starterBattle(stage, seed) {
  return C.createBattle(stage || "1-1", D.STARTERS.map(function (id) { return { id: id, lv: 1 }; }), seed || 7);
}

test("傷害公式：4 顆一組 ×1.25、2 連擊 ×1.25、隊長火 ×1.5", function () {
  var st = starterBattle();
  var groups = [{ color: "fire", count: 4, cells: [] }, { color: "water", count: 3, cells: [] }];
  var a = C.computeAttack(st, groups);
  // 朱音 ATK 90 × 1.25 × 1.25 × 1.5 = 210.9375
  assert.strictEqual(a.members[0].raw, 90 * 1.25 * 1.25 * 1.5);
  // 雫（水）不吃火屬性隊長倍率：90 × 1 × 1.25
  assert.strictEqual(a.members[1].raw, 90 * 1.25);
  assert.strictEqual(a.members[2].raw, 0);
});

test("5 顆一組變全體攻擊，相剋 ×2，扣防禦", function () {
  var st = starterBattle("1-1", 9);
  var ev = C.playerTurn(st, [{ color: "water", count: 5, cells: [] }]);
  var hits = ev.filter(function (e) { return e.t === "hit"; });
  assert.strictEqual(hits.length, 2, "第一波 2 隻鬼火都被打到");
  // 雫 90 × 1.5（5 顆） × 1（1 連擊） × 2（水剋火） = 270 − 防禦 0
  assert.strictEqual(hits[0].dmg, 270);
});

test("回復：心珠 3 顆 = 隊伍回復力合計 × 1", function () {
  var st = starterBattle();
  st.hp = 100;
  var ev = C.playerTurn(st, [{ color: "heart", count: 3, cells: [] }]);
  var h = ev.filter(function (e) { return e.t === "heal"; })[0];
  assert.strictEqual(h.amount, 35 * 5);
});

test("妖怪 CD 歸零才攻擊，攻擊後回到初始 CD", function () {
  var st = starterBattle();   // 1-1 第一波：鬼火 CD 1
  var ev = C.playerTurn(st, []);
  var atks = ev.filter(function (e) { return e.t === "attack"; });
  assert.strictEqual(atks.length, 2);
  assert.strictEqual(atks[0].dmg, 90);
  assert.strictEqual(st.enemies[0].cd, 1);
});

test("打倒整波進下一波，最後一波打倒是勝利", function () {
  var st = starterBattle();
  st.enemies.forEach(function (e) { e.hp = 1; });
  var ev = C.playerTurn(st, [{ color: "water", count: 5, cells: [] }]);
  assert(ev.some(function (e) { return e.t === "wave"; }));
  assert.strictEqual(st.waveIdx, 1);
  st.enemies.forEach(function (e) { e.hp = 1; });
  ev = C.playerTurn(st, [{ color: "fire", count: 5, cells: [] }]);
  assert(ev.some(function (e) { return e.t === "win"; }));
  assert.strictEqual(st.over, "win");
});

test("生命歸零是失敗", function () {
  var st = starterBattle();
  st.hp = 10;
  var ev = C.playerTurn(st, []);
  assert(ev.some(function (e) { return e.t === "lose"; }));
  assert.strictEqual(st.over, "lose");
});

test("主動技能：開局 CD 滿，冷卻完才可用；心→火 轉換全部心珠", function () {
  var st = starterBattle();
  assert.strictEqual(C.useSkill(st, 0).ok, false);
  st.members[0].cd = 0;
  var hearts = 0;
  st.board.forEach(function (row) { row.forEach(function (o) { if (o === "heart") hearts++; }); });
  var r = C.useSkill(st, 0);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.events[0].cells.length, hearts);
  st.board.forEach(function (row) { row.forEach(function (o) { assert.notStrictEqual(o, "heart"); }); });
  assert.strictEqual(st.members[0].cd, 5);
});

test("回合結束 CD −1", function () {
  var st = starterBattle();
  C.playerTurn(st, []);
  assert.strictEqual(st.members[0].cd, 4);
});

test("轉珠時間：基本 5 秒，瑠璃隊長 +1 秒，再加技能 +3 秒（2 回合）", function () {
  var st = C.createBattle("1-1", [{ id: "ruri", lv: 1 }], 1);
  assert.strictEqual(C.moveTimeMs(st), 6000);
  st.members[0].cd = 0;
  C.useSkill(st, 0);
  assert.strictEqual(C.moveTimeMs(st), 9000);
  C.playerTurn(st, []);
  assert.strictEqual(C.moveTimeMs(st), 9000);
  C.playerTurn(st, []);
  assert.strictEqual(C.moveTimeMs(st), 6000);
});

test("隊長技能：全隊生命 ×1.5、受傷 −20%", function () {
  var a = C.createBattle("1-1", [{ id: "wakaba", lv: 1 }], 1);
  assert.strictEqual(a.hpMax, Math.round(420 * 1.5));
  var b = C.createBattle("1-1", [{ id: "shizuka", lv: 1 }, { id: "akane", lv: 1 }], 1);
  var ev = C.playerTurn(b, []);
  assert.strictEqual(ev.filter(function (e) { return e.t === "attack"; })[0].dmg, Math.floor(90 * 0.8));
});

test("邪氣：把珠變成邪珠並造成 0.5 倍傷害", function () {
  var st = starterBattle("1-3", 5);   // 1-3 第一波：提灯（CD 2，邪氣 3）＋鬼火
  C.playerTurn(st, []);
  var ev = C.playerTurn(st, []);
  var jam = ev.filter(function (e) { return e.t === "jam"; })[0];
  assert(jam);
  assert.strictEqual(jam.cells.length, 3);
  jam.cells.forEach(function (p) { assert.strictEqual(st.board[p[0]][p[1]], "jam"); });
});

test("升級：40 × 等級的經驗，上限 30", function () {
  var e = { lv: 1, exp: 0 };
  assert.strictEqual(C.gainExp(e, 40), 1);
  assert.strictEqual(e.lv, 2);
  assert.strictEqual(C.gainExp(e, 100000), 28);
  assert.strictEqual(e.lv, 30);
  assert.strictEqual(e.exp, 0);
});

test("資料一致：25 人、每屬性 5 人、首次通關加入的 20 人不重複且不含開局角色", function () {
  assert.strictEqual(D.HEROES.length, 25);
  D.ATTRS.forEach(function (a) { assert.strictEqual(D.HEROES.filter(function (h) { return h.attr === a; }).length, 5); });
  var seen = {};
  D.STAGE_ORDER.forEach(function (id) {
    D.STAGE_BY_ID[id].recruit.forEach(function (h) {
      assert(D.HERO_BY_ID[h], h);
      assert(!seen[h], "重複加入 " + h);
      assert(D.STARTERS.indexOf(h) < 0);
      seen[h] = 1;
    });
    D.STAGE_BY_ID[id].waves.forEach(function (w) { w.forEach(function (k) { assert(D.ENEMIES[k], k); }); });
  });
  assert.strictEqual(Object.keys(seen).length, 20);
});

console.log("\n" + passed + " 項全部通過");
