// 明星經紀 starV 核心引擎的單元測試（node 直接跑，不需要瀏覽器）：
//   node tools/starv_check/core_check.js
"use strict";

global.window = global;
require("../../static_src/starv_data.js");
require("../../static_src/starv_roster.js");
require("../../static_src/starv_roster_1.js");
var D = global.PriTestStarvData;
var Roster = global.PriTestStarvRoster;
require("../../static_src/starv_core.js");
var Core = global.PriTestStarvCore;

var tests = [];
function test(name, fn) { tests.push([name, fn]); }
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "") + " 預期 " + JSON.stringify(b) + "，實際 " + JSON.stringify(a)); }

test("資料：16 個方向、id 不重複、權重總和為 1", function () {
  eq(D.DIRS.length, 16, "方向數");
  var seen = {};
  D.DIRS.forEach(function (d) {
    assert(!seen[d.id], "方向 id 重複 " + d.id); seen[d.id] = 1;
    var sum = 0;
    Object.keys(d.weights).forEach(function (k) { assert(D.STATS.indexOf(k) >= 0, d.id + " 權重鍵不明 " + k); sum += d.weights[k]; });
    assert(Math.abs(sum - 1) < 1e-9, d.id + " 權重總和 " + sum);
    assert(d.peak[0] < d.peak[1] && d.retire > d.peak[1], d.id + " 年齡區間");
    assert(d.title.a.length >= 6 && d.title.b.length >= 6, d.id + " 作品名詞庫不足");
    assert(d.title.fmt.zh.indexOf("{a}") >= 0 && d.title.fmt.ja.indexOf("{b}") >= 0, d.id + " 作品名格式");
    assert(D.DIR_BY_ID[d.id] === d, "DIR_BY_ID");
  });
});

test("資料：課程、特質、小事件", function () {
  eq(D.COURSES.length, 12, "課程數");
  D.COURSES.forEach(function (c) { assert(D.STATS.indexOf(c.stat) >= 0, "課程能力 " + c.id); assert(D.COURSE_BY_ID[c.id] === c, "COURSE_BY_ID"); });
  eq(D.TRAITS.length, 25, "特質數");
  var seen = {};
  D.TRAITS.forEach(function (t) { assert(!seen[t.id], "特質重複 " + t.id); seen[t.id] = 1; assert(t.name.zh && t.name.ja, "特質名 " + t.id); });
  assert(D.MINOR_EVENTS.length >= 10, "小事件數");
  eq(D.DORM_CAP[1], 5, "宿舍 Lv1"); eq(D.DORM_CAP[10], 100, "宿舍 Lv10");
});

test("名錄：首批 SR 3、SSR 2，欄位完整", function () {
  eq(Roster.byRarity("SR").length, 3, "SR 數"); eq(Roster.byRarity("SSR").length, 2, "SSR 數");
  Roster.all().forEach(function (e) {
    assert(e.name.zh && e.name.ja && e.bio.zh && e.bio.ja, e.id + " 名字／簡介");
    assert(D.DIR_BY_ID[e.dir], e.id + " 方向");
    D.STATS.forEach(function (s) { assert(D.APT[e.apt[s]], e.id + " 適性 " + s); assert(typeof e.stats[s] === "number", e.id + " 能力 " + s); });
    e.traits.forEach(function (t) { assert(D.TRAIT_BY_ID[t], e.id + " 特質不存在 " + t); });
    ["face", "hair", "hairColor", "eye", "outfit", "acc", "skin"].forEach(function (k) { assert(typeof e.look[k] === "number", e.id + " 外觀 " + k); });
    if (e.rarity === "SSR") assert(e.skill && e.skill.fx, e.id + " SSR 必須有專屬技能");
  });
  assert(Roster.byId("nope") === null, "byId 找不到要回傳 null");
});

test("名錄：重複 ID 會丟錯", function () {
  var threw = false;
  try { Roster.add([Roster.byId("sr001")]); } catch (e) { threw = true; }
  assert(threw, "重複 ID 沒有丟錯");
});

test("core：create 的初始值", function () {
  var st = Core.create({ seed: 42, now: 1000 });
  eq(st.version, Core.VERSION, "version");
  eq(st.company.money, 50000, "資金"); eq(st.company.tickets, 10, "星探券");
  eq(st.company.level, 1, "公司等級"); eq(st.facilities.dorm, 1, "宿舍");
  eq(st.day, 0, "day"); eq(st.lastTickAt, 1000, "lastTickAt");
  assert(Array.isArray(st.artists) && Array.isArray(st.activeJobs) && Array.isArray(st.groups), "陣列欄位");
});

test("core：亂數可重現", function () {
  var a = Core.create({ seed: 7 }), b = Core.create({ seed: 7 });
  for (var i = 0; i < 20; i++) eq(Core._rnd(a), Core._rnd(b), "第 " + i + " 次");
  var x = Core._rnd(a); assert(x >= 0 && x < 1, "範圍");
});

test("core：wpick 依權重", function () {
  var st = Core.create({ seed: 3 }), n = { a: 0, b: 0 };
  for (var i = 0; i < 10000; i++) n[Core._wpick(st, { a: 9, b: 1 })]++;
  assert(n.a > 8500 && n.a < 9500, "a 次數 " + n.a);
});

test("core：dateOf", function () {
  var d = Core.dateOf(0); eq(d.year, 1); eq(d.month, 1); eq(d.day, 1);
  d = Core.dateOf(359); eq(d.year, 1); eq(d.month, 12); eq(d.day, 30);
  d = Core.dateOf(390); eq(d.year, 2); eq(d.month, 2); eq(d.day, 1);
});

test("core：migrate 補齊缺少的欄位", function () {
  var st = Core.create({ seed: 1 });
  delete st.groups; delete st.company.safeLine; delete st.gacha.pickup; st.version = 0;
  var m = Core.migrate(JSON.parse(JSON.stringify(st)));
  assert(Array.isArray(m.groups), "groups"); eq(m.company.safeLine, 20000, "safeLine");
  assert(m.gacha.pickup && "SSR" in m.gacha.pickup, "pickup"); eq(m.version, Core.VERSION, "version");
  eq(m.company.money, st.company.money, "既有值不能被覆蓋");
});

// ==== run ====
var fails = 0;
tests.forEach(function (t) {
  try { t[1](); console.log("ok   " + t[0]); }
  catch (e) { fails++; console.log("FAIL " + t[0] + "：" + e.message); }
});
console.log(fails ? fails + " 個失敗" : "全部 " + tests.length + " 個通過");
process.exit(fails ? 1 : 0);
