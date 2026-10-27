// 明星經紀 starV 核心引擎的單元測試（node 直接跑，不需要瀏覽器）：
//   node tools/starv_check/core_check.js
"use strict";

global.window = global;
require("../../static_src/starv_data.js");
require("../../static_src/starv_roster.js");
require("../../static_src/starv_roster_1.js");
var D = global.PriTestStarvData;
var Roster = global.PriTestStarvRoster;

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

// ==== run ====
var fails = 0;
tests.forEach(function (t) {
  try { t[1](); console.log("ok   " + t[0]); }
  catch (e) { fails++; console.log("FAIL " + t[0] + "：" + e.message); }
});
console.log(fails ? fails + " 個失敗" : "全部 " + tests.length + " 個通過");
process.exit(fails ? 1 : 0);
