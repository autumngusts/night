// 明星經紀 starV 核心引擎的單元測試（node 直接跑，不需要瀏覽器）：
//   node tools/starv_check/core_check.js
"use strict";

global.window = global;
require("../../static_src/starv_data.js");
require("../../static_src/starv_words_1.js");
require("../../static_src/starv_traits_1.js");
require("../../static_src/starv_events.js");
require("../../static_src/starv_events_1.js");
require("../../static_src/starv_events_2.js");
require("../../static_src/starv_events_3.js");
require("../../static_src/starv_events_4.js");
require("../../static_src/starv_events_5.js");
require("../../static_src/starv_events_6.js");
require("../../static_src/starv_events_7.js");
require("../../static_src/starv_awards_data.js");
var Events = global.PriTestStarvEvents;
require("../../static_src/starv_roster.js");
require("../../static_src/starv_roster_1.js");
require("../../static_src/starv_roster_2.js");
require("../../static_src/starv_roster_3.js");
require("../../static_src/starv_roster_4.js");
require("../../static_src/starv_roster_5.js");
require("../../static_src/starv_roster_6.js");
require("../../static_src/starv_roster_rivals_1.js");
require("../../static_src/starv_roster_rivals_2.js");
var D = global.PriTestStarvData;
var Roster = global.PriTestStarvRoster;
// 計畫 3 加入隨機重大事件（每天 8%）。計畫 1、2 的測試寫死了人氣、壓力等數值，
// 所以預設關閉隨機事件；事件相關測試用 withEvents() 暫時打開。
var EVENT_CHANCE = D.BAL.eventDailyChance;
D.BAL.eventDailyChance = 0;
function withEvents(fn) { D.BAL.eventDailyChance = EVENT_CHANCE; try { fn(); } finally { D.BAL.eventDailyChance = 0; } }

// 計畫 4 加入對手每天搶工作：舊測試預設關閉，搶工作的測試自己打開
var SNATCH = [D.BAL.snatchChance, D.BAL.snatchInterestChance];
D.BAL.snatchChance = 0; D.BAL.snatchInterestChance = 0;

require("../../static_src/starv_projects.js");
require("../../static_src/starv_projects_1.js");
require("../../static_src/starv_projects_2.js");
var Projects = global.PriTestStarvProjects;
require("../../static_src/starv_achievements.js");
require("../../static_src/starv_achievements_1.js");
require("../../static_src/starv_achievements_2.js");
require("../../static_src/starv_achievements_3.js");
var Ach = global.PriTestStarvAchievements;

require("../../static_src/starv_core.js");
var Core = global.PriTestStarvCore;
require("../../static_src/starv_store.js");
var Store = global.PriTestStarvStore;
require("../../static_src/starv_avatar.js");
var Avatar = global.PriTestStarvAvatar;
require("../../static_src/starv_stage_spec.js");
var Spec = global.PriTestStarvStageSpec;
require("../../static_src/starv_cloud.js");
var Cloud = global.PriTestStarvCloud;
function fakeStorage() {
  var m = {};
  return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; }, _m: m };
}

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
  // 計畫 10 擴充到 100 種（starv_traits_1.js）；詳細檢查在「特性：100 種…」測試
  eq(D.TRAITS.length, 100, "特質數");
  var seen = {};
  D.TRAITS.forEach(function (t) { assert(!seen[t.id], "特質重複 " + t.id); seen[t.id] = 1; assert(t.name.zh && t.name.ja, "特質名 " + t.id); });
  assert(D.MINOR_EVENTS.length >= 10, "小事件數");
  eq(D.DORM_CAP[1], 5, "宿舍 Lv1"); eq(D.DORM_CAP[10], 100, "宿舍 Lv10");
});

test("名錄：SR 100、SSR 33、宿敵 20，欄位完整", function () {
  eq(Roster.byRarity("SR").length, 100, "SR 數"); eq(Roster.byRarity("SSR").length, 33, "SSR 數");
  eq(Roster.rivals().length, 20, "宿敵數");
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

test("名錄：稀有度規則（能力合計、主方向適性、特質數、外觀範圍、技能 fx、名字不重複、涵蓋 16 方向）", function () {
  var fxKeys = { greatShift: 1 };
  D.TRAITS.forEach(function (t) { Object.keys(t.fx).forEach(function (k) { fxKeys[k] = 1; }); });
  function topStats(dir) {
    var w = D.DIR_BY_ID[dir].weights, mx = 0;
    Object.keys(w).forEach(function (k) { mx = Math.max(mx, w[k]); });
    return Object.keys(w).filter(function (k) { return w[k] === mx; });
  }
  var names = {}, L = D.LOOK;
  Roster.all().forEach(function (e) {
    ["zh", "ja"].forEach(function (l) { assert(!names[l + e.name[l]], e.id + " 名字重複 " + e.name[l]); names[l + e.name[l]] = 1; });
    var k = e.look;
    assert(k.face >= 0 && k.face < L.face && k.hair >= 0 && k.hair < L.hair && k.eye >= 0 && k.eye < L.eye &&
      k.outfit >= 0 && k.outfit < L.outfit && k.acc >= -1 && k.acc < L.acc &&
      k.hairColor >= 0 && k.hairColor < L.hairColors.length && k.skin >= 0 && k.skin < L.skins.length, e.id + " 外觀超出範圍");
    if (e.skill) Object.keys(e.skill.fx).forEach(function (f) { assert(fxKeys[f], e.id + " 技能 fx 不支援 " + f); });
    assert(/^(sr|ssr|rv)\d{3}$/.test(e.id) && e.addedIn, e.id + " ID 格式／addedIn");
    if (e.kind === "rival") return;
    var sum = D.STATS.reduce(function (s, x) { return s + e.stats[x]; }, 0), R = D.RARITY[e.rarity];
    assert(sum >= R.statTotal[0] && sum <= R.statTotal[1], e.id + " 能力合計 " + sum);
    assert(e.traits.length >= R.traits[0] && e.traits.length <= R.traits[1], e.id + " 特質數 " + e.traits.length);
    var need = e.rarity === "SSR" ? ["S"] : ["S", "A"];
    topStats(e.dir).forEach(function (s) { assert(need.indexOf(e.apt[s]) >= 0, e.id + " 主方向適性 " + s + "=" + e.apt[s]); });
    assert(e.subDirs.length <= 2, e.id + " 副方向最多 2");
    e.subDirs.forEach(function (d) { assert(D.DIR_BY_ID[d] && d !== e.dir, e.id + " 副方向 " + d); });
    if (e.rarity === "SSR") assert(e.story && e.story.zh && e.story.ja, e.id + " 小故事");
  });
  var dirs = {};
  Roster.byRarity("SR").concat(Roster.byRarity("SSR")).forEach(function (e) { dirs[e.dir] = 1; });
  eq(Object.keys(dirs).length, 16, "SR／SSR 涵蓋 16 個方向");
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

test("藝人：R 程序生成", function () {
  var st = Core.create({ seed: 11 });
  for (var i = 0; i < 200; i++) {
    var a = Core._genR(st);
    eq(a.rarity, "R"); assert(D.DIR_BY_ID[a.dir], "方向");
    assert(a.age >= 16 && a.age <= 28, "年齡 " + a.age);
    var total = 0;
    D.STATS.forEach(function (s) {
      assert(D.APT[a.apt[s]], "適性"); assert(a.stats[s] >= 0 && a.stats[s] <= a.caps[s], "能力超過上限");
      assert(a.caps[s] <= 999, "上限超過 999"); total += a.stats[s];
    });
    assert(total >= 70 && total <= 160, "能力合計 " + total);
    var top = Object.keys(D.DIR_BY_ID[a.dir].weights).sort(function (x, y) { return D.DIR_BY_ID[a.dir].weights[y] - D.DIR_BY_ID[a.dir].weights[x]; })[0];
    assert(D.APT_ORDER.indexOf(a.apt[top]) <= 2, "主方向最重要的能力至少 B");
    assert(a.traits.length <= 1, "R 特質最多 1");
    assert(a.salary >= 1500 && a.salary <= 3000 && a.salary % 100 === 0, "月薪 " + a.salary);
    eq(a.prof[a.dir].lv, 1, "熟練度初始 1");
  }
});

test("藝人：從名錄建立", function () {
  var st = Core.create({ seed: 1 });
  var a = Core._fromRoster(st, Roster.byId("ssr001"));
  eq(a.rarity, "SSR"); eq(a.rosterId, "ssr001"); eq(a.dir, "idol"); eq(a.stats.vocal, 95);
  eq(a.caps.vocal, 999, "SSR 的 S 適性上限 999"); eq(a.salary, 20000);
});

test("藝人：名字依語言、名錄找不到時顯示未知", function () {
  var st = Core.create({ seed: 5 });
  var a = Core._genR(st);
  var zh = Core.artistName(a, "zh"), ja = Core.artistName(a, "ja");
  assert(zh && ja && zh !== ja, "zh/ja 名字 " + zh + " / " + ja);
  eq(Core.artistName(a, "en"), ja, "en 沿用 ja");
  eq(Core.artistName(Core._fromRoster(st, Roster.byId("sr001")), "zh"), "星野澪");
  var ghost = Core._fromRoster(st, Roster.byId("sr001")); ghost.rosterId = "sr999";
  eq(Core.artistName(ghost, "zh"), "未知藝人");
});

test("姓名庫與作品名詞庫：擴充後舊存檔的名字與作品名不變", function () {
  eq(D.NAME_V1_LEN, 20);
  ["zh", "ja"].forEach(function (l) { ["family", "f", "m"].forEach(function (k) { assert(D.NAMES[l][k].length >= 40, l + "." + k + " 姓名庫 " + D.NAMES[l][k].length); }); });
  D.DIRS.forEach(function (d) {
    assert(d.title.a.length >= 12 && d.title.b.length >= 12, d.id + " 詞庫");
    ["a", "b"].forEach(function (k) {
      var seen = {};
      d.title[k].forEach(function (w) { assert(w.zh && w.ja, d.id + " 缺字"); assert(!seen[w.zh], d.id + " 重複詞 " + w.zh); seen[w.zh] = 1; });
    });
  });
  ["zh", "ja"].forEach(function (l) {
    ["family", "f", "m"].forEach(function (k) {
      var seen = {};
      D.NAMES[l][k].forEach(function (n) { assert(!seen[n], l + "." + k + " 重複 " + n); seen[n] = 1; });
    });
  });
  // 舊 nameSeed（< 1,000,000）只用前 20 個：舊存檔、日誌、名人堂的名字不變
  var old = { rosterId: null, nameSeed: 12345, gender: "f" };
  eq(Core.artistName(old, "zh"), D.NAMES.zh.family[12345 % 20] + D.NAMES.zh.f[Math.floor(12345 / 20) % 20]);
  // 新藝人的 nameSeed ≥ 1,000,000，用整個姓名庫
  var st = Core.create({ seed: 9 }), a = Core._genR(st);
  assert(a.nameSeed >= Core.NAME_V2_BASE, "新的 nameSeed " + a.nameSeed);
  var s = a.nameSeed - Core.NAME_V2_BASE, N = D.NAMES.ja;
  eq(Core.artistName(a, "ja"), N.family[s % N.family.length] + " " + N[a.gender][Math.floor(s / N.family.length) % N[a.gender].length]);
  // 舊作品名索引仍指向同一個詞
  eq(Core.jobTitle({ dir: "film", title: [0, 0] }, "zh"), "電影《午夜的列車》");
});

test("藝人：migrate 補齊藝人欄位", function () {
  var st = Core.create({ seed: 1 });
  var a = Core._genR(st); delete a.satisfaction; delete a.policy; st.artists.push(a);
  Core.migrate(st);
  eq(st.artists[0].satisfaction, 70); eq(st.artists[0].policy, "idle");
});

test("抽卡：費用", function () {
  var st = Core.create({ seed: 1 });
  eq(Core.pullCost(st, "money", 1), 7500); eq(Core.pullCost(st, "money", 10), 67500);
  eq(Core.pullCost(st, "ticket", 1), 1); eq(Core.pullCost(st, "ticket", 10), 10);
  st.facilities.scout = 2;
  var r = Core.rates(st, "money");
  assert(Math.abs(r.SR - 0.036) < 1e-9 && Math.abs(r.SSR - 0.006) < 1e-9, "星探部加成");
});

test("抽卡：十連保證 SR 以上、券與資金扣除", function () {
  for (var s = 1; s <= 40; s++) {
    var st = Core.create({ seed: s });
    st.facilities.dorm = 10;
    var res = Core.pull(st, "ticket", 10);
    assert(!res.err, "err " + res.err);
    eq(res.results.length, 10);
    assert(res.results.some(function (x) { return x.rarity !== "R"; }), "seed " + s + " 沒有 SR 以上");
    eq(st.company.tickets, 0, "券扣除");
  }
  var st2 = Core.create({ seed: 1 });
  eq(Core.pull(st2, "ticket", 10).err, undefined);
  eq(Core.pull(st2, "ticket", 1).err, "tickets");
  st2.company.money = 7000; eq(Core.pull(st2, "money", 1).err, "money");
  eq(Core.pull(st2, "money", 3).err, "count");
});

test("抽卡：每日上限 30", function () {
  var st = Core.create({ seed: 2 }); st.company.money = 1e9; st.facilities.dorm = 10;
  eq(Core.pull(st, "money", 10).err, undefined); eq(Core.pull(st, "money", 10).err, undefined); eq(Core.pull(st, "money", 10).err, undefined);
  eq(Core.pull(st, "money", 1).err, "daily");
  st.day = 1; eq(Core.pull(st, "money", 1).err, undefined, "隔天重置");
});

test("抽卡：保底 150", function () {
  var st = Core.create({ seed: 9 }); st.gacha.pity = 149;
  eq(Core._rollRarity(st, "money"), "SSR"); eq(st.gacha.pity, 0);
});

test("抽卡：重複 SR/SSR 突破，滿了換券", function () {
  var st = Core.create({ seed: 1 }), e = Roster.byId("ssr002");
  var first = Core._grantEntry(st, e);
  assert(!first.dup && st.codex.owned.ssr002, "首次取得");
  var a = Core.artistById(st, first.artistId), capBefore = a.caps.act;
  var second = Core._grantEntry(st, e);
  eq(second.dup, "limitBreak"); eq(a.limitBreak, 1); assert(a.caps.act >= capBefore, "上限提升");
  a.limitBreak = 5;
  var t0 = st.company.tickets, third = Core._grantEntry(st, e);
  eq(third.dup, "tickets"); eq(st.company.tickets, t0 + 10);
});

test("抽卡：宿舍滿了進候補，候補滿了流失；接受候補、解約", function () {
  var st = Core.create({ seed: 4 });
  for (var i = 0; i < 5; i++) st.artists.push(Core._genR(st));
  var r = Core._grantEntry(st, Roster.byId("sr001"));
  assert(r.waitlisted, "應進候補"); eq(st.waitlist.length, 1);
  eq(st.waitlist[0].until, st.day + 30);
  eq(Core.acceptWaitlist(st, 0), "full");
  var victim = st.artists[0], m0 = st.company.money;
  eq(Core.dismiss(st, victim.id), null);
  eq(st.company.money, m0 - victim.salary * 3, "違約金");
  eq(Core.acceptWaitlist(st, 0), null); eq(st.artists.length, 5); eq(st.waitlist.length, 0);
  for (i = 0; i < 10; i++) st.waitlist.push({ artist: Core._genR(st), until: 99 });
  assert(Core._grantEntry(st, Roster.byId("sr002")).lost, "候補滿了要流失");
});

test("抽卡：PICKUP 優先選 debut 角色", function () {
  var st = Core.create({ seed: 1 });
  eq(st.gacha.pickup.SSR, "ssr001", "debut 的 ssr001 先上 PICKUP");
  Core._rotatePickup(st);
  assert(st.gacha.pickup.SSR, "第二期仍有 PICKUP");
});

function freshArtist(st, over) {
  var a = Core._genR(st);
  D.STATS.forEach(function (s) { a.apt[s] = "B"; a.caps[s] = 405; a.stats[s] = 50; });
  a.traits = []; a.age = 20; a.dir = "singer";
  Object.keys(over || {}).forEach(function (k) { a[k] = over[k]; });
  // 月薪隨人氣上升（規格 §5.2）以 baseSalary 計算：測試直接指定 salary 時，基本月薪也跟著指定
  if (over && over.salary != null && over.baseSalary == null) a.baseSalary = over.salary;
  st.artists.push(a);
  return a;
}

test("行程：課程扣錢、3 天後能力提升", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st);
  var m0 = st.company.money;
  eq(Core.schedule(st, a.id, { kind: "course", courseId: "vocal_1" }), null);
  eq(st.company.money, m0 - 1500);
  eq(Core.schedule(st, a.id, { kind: "train" }), "busy");
  Core.advance(st, 2); assert(a.task, "還沒結束");
  Core.advance(st, 1); eq(a.task, null, "第 3 天結束");
  assert(a.stats.vocal > 50 && a.stats.vocal < 80, "歌唱 " + a.stats.vocal);
  assert(a.stamina < 100 && a.stress > 0, "體力與壓力有變化");
});

test("行程：高級課程需要設施或公司等級", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st);
  eq(Core.schedule(st, a.id, { kind: "course", courseId: "vocal_2" }), "facility");
  eq(Core.schedule(st, a.id, { kind: "course", courseId: "talk_2" }), "facility");
  st.facilities.studio = 1; eq(Core.schedule(st, a.id, { kind: "course", courseId: "vocal_2" }), null);
  eq(Core.schedule(st, freshArtist(st).id, { kind: "course", courseId: "nope" }), "noCourse");
  st.company.money = 100; eq(Core.schedule(st, freshArtist(st).id, { kind: "course", courseId: "act_1" }), "money");
});

test("行程：訓練依主方向權重成長", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st);
  Core.schedule(st, a.id, { kind: "train" }); Core.advance(st, 2);
  assert(a.stats.vocal > a.stats.charm && a.stats.charm > 50 && a.stats.act === 50, "歌手：歌唱 > 魅力 > 50，演技不變");
});

test("行程：休息回復、宣傳增加人氣", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { stamina: 20, stress: 60 });
  Core.schedule(st, a.id, { kind: "rest", days: 2 }); Core.advance(st, 2);
  eq(a.stamina, 70); eq(a.stress, 36); eq(a.mood, 1);
  var b = freshArtist(st), m0 = st.company.money;
  Core.schedule(st, b.id, { kind: "promo" }); eq(st.company.money, m0 - 1000);
  Core.advance(st, 2); assert(b.fame >= 12, "人氣 " + b.fame);
});

test("行程：體力歸零強制休息、壓力 100 罷工", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { stamina: 5 });
  Core.schedule(st, a.id, { kind: "train" }); Core.advance(st, 2);
  assert(a.task && a.task.kind === "rest" && a.task.forced && a.task.days === 3, "強制休息 3 天");
  var b = freshArtist(st, { stress: 97 });
  Core.schedule(st, b.id, { kind: "train" }); Core.advance(st, 2);
  assert(b.task && b.task.kind === "rest" && b.task.days === 7, "罷工 7 天"); eq(b.stress, 60);
});

test("成長：不會超過潛力上限", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st);
  a.stats.vocal = 404;
  Core.schedule(st, a.id, { kind: "course", courseId: "vocal_1" }); Core.advance(st, 3);
  assert(a.stats.vocal <= 405, "歌唱 " + a.stats.vocal);
});

test("看板：初始件數、Lv1 只有 D/C", function () {
  var st = Core.create({ seed: 3 });
  eq(st.board.length, 10, "8 + 1×2"); eq(Core.boardSize(st), 10);
  st.board.forEach(function (j) {
    assert(j.tier === "D" || j.tier === "C", "等級 " + j.tier);
    assert(j.pay > 0 && j.pay % 100 === 0, "酬勞"); assert(j.days >= 1, "天數");
    if (j.role === "group") assert(j.slots >= 2 && j.slots <= 5 && D.DIR_BY_ID[j.dir].group, "團體工作");
    else eq(j.slots, 1);
  });
});

test("看板：Lv6 才有 S，而且最多 1 件", function () {
  for (var s = 1; s <= 30; s++) {
    var st = Core.create({ seed: s }); st.company.level = 6; st.board = [];
    for (var k = 0; k < 5; k++) { st.board = []; Core._refreshBoard(st); }
    var nS = st.board.filter(function (j) { return j.tier === "S"; }).length;
    assert(nS <= 1, "S 件數 " + nS); eq(st.board.length, 20);
  }
  var st5 = Core.create({ seed: 1 }); st5.company.level = 5;
  for (var i = 0; i < 300; i++) assert(Core._genJob(st5).tier !== "S", "Lv5 不能出現 S");
});

test("看板：每 7 天補到上限、14 天過期", function () {
  var st = Core.create({ seed: 8 });
  var firstIds = st.board.map(function (j) { return j.id; });
  st.board.splice(0, 4);
  Core.advance(st, 6); eq(st.board.length, 6, "第 6 天還沒刷新");
  Core.advance(st, 1); eq(st.board.length, 10, "第 7 天補滿");
  Core.advance(st, 7);
  assert(st.board.every(function (j) { return firstIds.indexOf(j.id) < 0; }), "第 14 天初始工作都過期");
});

test("看板：作品名", function () {
  var st = Core.create({ seed: 1 }), j = Core._genJob(st);
  j.dir = "film"; j.title = [0, 0];
  eq(Core.jobTitle(j, "zh"), "電影《午夜的列車》"); eq(Core.jobTitle(j, "ja"), "映画『真夜中の列車』");
});

function soloJob(st, over) {
  var j = Core._genJob(st);
  j.dir = "singer"; j.tier = "D"; j.role = "support"; j.slots = 1; j.days = 2; j.pay = 2000; j.fame = 5; j.rep = 5;
  j.minFame = 0; j.minProf = 1; j.isWork = false; j.audition = false; j.interest = null;
  Object.keys(over || {}).forEach(function (k) { j[k] = over[k]; });
  st.board.push(j);
  return j;
}

test("工作：接案檢查", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st), j = soloJob(st, { minFame: 100 });
  eq(Core.takeJob(st, "nope", [a.id]), "noJob");
  eq(Core.takeJob(st, j.id, []), "slots");
  eq(Core.takeJob(st, j.id, [a.id]), "fame");
  j.minFame = 0; j.minProf = 3; eq(Core.takeJob(st, j.id, [a.id]), "prof");
  j.minProf = 1; eq(Core.takeJob(st, j.id, [a.id]), null);
  assert(st.board.indexOf(j) < 0, "從看板移除"); eq(st.activeJobs.length, 1); eq(a.task.kind, "job");
  var b = freshArtist(st), j2 = soloJob(st, { slots: 2, role: "group" });
  eq(Core.takeJob(st, j2.id, [b.id, b.id]), "slots", "同一人不能重複");
  eq(Core.takeJob(st, j2.id, [a.id, b.id]), "busy");
});

test("工作：結算給錢、人氣、聲望、作品紀錄", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st), j = soloJob(st);
  D.STATS.forEach(function (s) { a.stats[s] = 300; });
  var m0 = st.company.money;
  Core.takeJob(st, j.id, [a.id]);
  Core.advance(st, 1); eq(st.activeJobs.length, 1, "第 1 天未結束");
  Core.advance(st, 1);
  eq(st.activeJobs.length, 0); eq(a.task, null);
  eq(a.works.length, 1); eq(a.works[0].result, "great", "表現 300 對難度 60 必定大成功");
  eq(st.company.money, m0 + 3000, "2000 × 1.5");
  assert(a.fame >= 7, "人氣"); assert(st.company.rep >= 7, "聲望"); eq(st.stats.jobsDone, 1);
  eq(a.prof.singer.xp, 3, "熟練度經驗 3 × (D 序號 0 + 1)");
});

test("工作：低能力失敗、人氣下降不會變負", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st), j = soloJob(st, { tier: "C", role: "lead" });
  D.STATS.forEach(function (s) { a.stats[s] = 10; });
  Core.takeJob(st, j.id, [a.id]); Core.advance(st, 2);
  eq(a.works[0].result, "fail"); assert(a.fame >= 0, "人氣");
});

test("工作：預估與作品型分紅", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st), j = soloJob(st, { isWork: true });
  var e = Core.estimate(st, [a.id], j);
  assert(Math.abs(e.ratio - Core.perfScore(st, a, j) / Core.difficulty(j)) < 1e-9, "ratio");
  eq(Core.difficulty(j), 60);
  Core.takeJob(st, j.id, [a.id]); Core.advance(st, 2);
  eq(st.dividends.length, 1); eq(st.dividends[0].months, 3);
});

test("工作：聲望升級給星探券", function () {
  var st = Core.create({ seed: 1 }), t0 = st.company.tickets;
  Core.addRep(st, 1600);
  eq(st.company.level, 3, "500、1500 兩個門檻"); eq(st.company.tickets, t0 + 2 * 2 + 3 * 2);
});

test("組合：默契與團體工作", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st), b = freshArtist(st), c = freshArtist(st);
  eq(Core.createGroup(st, "X", [a.id]).err, "size");
  var g = Core.createGroup(st, "星光", [a.id, b.id]).group;
  eq(Core.createGroup(st, "Y", [b.id, c.id]).err, "taken");
  eq(Core.chemistry(st, [a.id, b.id]), 0);
  g.jobs = 4; assert(Math.abs(Core.chemistry(st, [b.id, a.id]) - 0.08) < 1e-9, "成員順序不影響");
  eq(Core.chemistry(st, [a.id, c.id]), 0, "不是同一組");
  g.jobs = 50; eq(Core.chemistry(st, [a.id, b.id]), 0.2, "上限");
  g.jobs = 0;
  // 能力墊高，避免小事件的負修正讓結果變成失敗（失敗時人氣增量為負，組合人氣會停在 0）
  D.STATS.forEach(function (s) { a.stats[s] = 200; b.stats[s] = 200; });
  var j = soloJob(st, { dir: "idol", role: "group", slots: 2 });
  Core.takeJob(st, j.id, [a.id, b.id]); Core.advance(st, 2);
  eq(g.jobs, 1); assert(g.fame > 0, "組合人氣");
  Core.disbandGroup(st, g.id); eq(st.groups.length, 0);
});

test("工作：小事件會發生並寫入日誌", function () {
  var st = Core.create({ seed: 21 }), n = 0;
  for (var i = 0; i < 30; i++) {
    var a = freshArtist(st), j = soloJob(st, { days: 10 });
    Core.takeJob(st, j.id, [a.id]);
  }
  Core.advance(st, 10);
  st.log.forEach(function (e) { if (e.type === "minor") n++; });
  assert(n >= 5 && n <= 60, "小事件次數 " + n + "（期望約 24）");
});

test("月結：月薪、營運費、負債月數", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { salary: 2000 });
  st.board = []; st.boardRefreshDay = 9999;
  var m0 = st.company.money;
  Core.advance(st, 29); eq(st.company.money, m0, "月底前不扣");
  Core.advance(st, 1); eq(st.company.money, m0 - 2000 - 1000, "月薪 + 營運費 1000×Lv1");
  st.company.money = -10; Core.advance(st, 30); eq(st.company.debtMonths, 1);
  st.company.money = 5000; Core.advance(st, 30); eq(st.company.debtMonths, 0, "轉正歸零");
  assert(st.log.some(function (e) { return e.type === "month_end"; }), "month_end 日誌");
});

test("月結：分紅 3 個月、人氣衰退", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { salary: 0, fame: 1000 });
  st.board = []; st.boardRefreshDay = 9999;
  st.dividends.push({ pay: 10000, stars: 3, months: 3 });
  var m0 = st.company.money;
  Core.advance(st, 30);
  eq(st.company.money, m0 - 1000 + 1000, "分紅 10000×0.1×3/3");
  eq(a.fame, 980, "巔峰期衰退 2%");
  Core.advance(st, 60); eq(st.dividends.length, 0, "3 個月後結束");
  a.age = 50; a.fame = 1000; Core.advance(st, 30); eq(a.fame, 960, "非巔峰 4%");
  st.facilities.pr = 5; a.fame = 1000; Core.advance(st, 30); eq(a.fame, 980, "公關部 Lv5 衰退減半");
});

test("年度：年齡 +1；候補逾期流失", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { age: 20 });
  st.waitlist.push({ artist: Core._genR(st), until: 10 });
  Core.advance(st, 10); eq(st.waitlist.length, 0, "第 10 天流失");
  assert(st.log.some(function (e) { return e.type === "waitlist_expired"; }), "日誌");
  Core.advance(st, 350); eq(a.age, 21);
});

test("自動方針：work 接 C 級以下的工作、不接 A/S", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st);
  st.board = []; st.boardRefreshDay = 9999;
  D.STATS.forEach(function (s) { a.stats[s] = 120; });
  a.fame = 99999; a.prof.singer.lv = 10;
  var jA = soloJob(st, { tier: "A", pay: 90000 }), jD = soloJob(st, { tier: "D", pay: 2000 });
  eq(Core.setPolicy(st, a.id, "work"), null); eq(Core.setPolicy(st, a.id, "lazy"), "policy");
  Core.advance(st, 1);
  eq(a.task && a.task.kind, "job");
  eq(st.activeJobs[0].job.id, jD.id, "選 D 不選 A"); assert(st.board.indexOf(jA) >= 0, "A 還在看板");
});

test("自動方針：study 依安全線決定上課或訓練", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st);
  Core.setPolicy(st, a.id, "study");
  st.company.money = 30000; Core.setSafeLine(st, 20000);
  Core.advance(st, 1); eq(a.task.kind, "course", "30000 − 1500 ≥ 20000");
  eq(a.task.courseId.indexOf("vocal"), 0, "歌手選歌唱");
  var b = freshArtist(st); Core.setPolicy(st, b.id, "study");
  st.company.money = 20500;
  Core.advance(st, 1); eq(b.task.kind, "train", "上課會跌破安全線");
});

test("自動方針：體力或壓力過高先休息；idle 不動；balance 交替", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { stamina: 30 }), b = freshArtist(st), c = freshArtist(st, { stress: 60 });
  Core.setPolicy(st, a.id, "study"); Core.setPolicy(st, c.id, "work");
  Core.advance(st, 1);
  eq(a.task.kind, "rest"); eq(b.task, null, "idle 不排程"); assert(c.task && c.task.kind !== "rest", "work 方針壓力 60 不休息");
  var d = freshArtist(st); st.board = []; st.boardRefreshDay = 9999;
  Core.setPolicy(st, d.id, "balance"); d.lastAuto = "work";
  st.company.money = 1e6;
  Core.advance(st, 1); eq(d.task.kind, "course", "上次 work → 這次 study"); eq(d.lastAuto, "study");
});

test("離線：第一次只記時間、未滿一天不動", function () {
  var st = Core.create({ seed: 1 }); st.lastTickAt = 0;
  eq(Core.catchUp(st, 5000), null); eq(st.lastTickAt, 5000);
  eq(Core.catchUp(st, 5000 + 59999), null); eq(st.day, 0);
  var r = Core.catchUp(st, 5000 + 90000);
  eq(r.days, 1); eq(st.day, 1); eq(st.lastTickAt, 65000, "保留未滿一天的 30 秒");
  assert(Math.abs(Core.dayProgress(st, 95000) - 0.5) < 1e-9, "天內進度");
});

test("離線：上限 480 天", function () {
  var st = Core.create({ seed: 1, now: 1 });
  var r = Core.catchUp(st, 1 + 600 * 60000 + 1234);
  eq(r.days, 480); eq(r.capped, true); eq(st.day, 480); eq(st.lastTickAt, 1 + 600 * 60000);
});

test("離線：一次結算與逐日結算結果相同", function () {
  function setup() {
    var st = Core.create({ seed: 77, now: 1 });
    Core.pull(st, "ticket", 10);
    st.artists.forEach(function (a) { Core.setPolicy(st, a.id, "balance"); });
    return st;
  }
  var a = setup(), b = setup();
  Core.catchUp(a, 1 + 480 * 60000);
  for (var i = 1; i <= 480; i++) Core.catchUp(b, 1 + i * 60000);
  eq(JSON.stringify(a), JSON.stringify(b), "state 不一致");
});

test("離線：報告內容", function () {
  var st = Core.create({ seed: 5, now: 1 });
  Core.pull(st, "ticket", 10);
  st.artists.forEach(function (a) { Core.setPolicy(st, a.id, "work"); });
  var m0 = st.company.money;
  var r = Core.catchUp(st, 1 + 120 * 60000);
  eq(r.days, 120); eq(r.capped, false); eq(r.money, st.company.money - m0);
  eq(r.levelFrom, 1); eq(r.levelTo, st.company.level);
  assert(r.logs.length > 0 && r.logs.every(function (e) { return e.day >= 1; }), "報告只含結算期間的日誌");
});

test("UI 用 API：setDirs", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st);
  a.prof.singer.lv = 4;
  eq(Core.setDirs(st, a.id, "film", ["singer", "idol"]), null);
  eq(a.dir, "film"); eq(a.subDirs.join(","), "singer,idol"); eq(a.prof.singer.lv, 4, "熟練度保留");
  eq(Core.setDirs(st, a.id, "nope", []), "dir");
  eq(Core.setDirs(st, a.id, "film", ["film"]), "sub", "副方向不能是主方向");
  eq(Core.setDirs(st, a.id, "film", ["idol", "idol"]), "sub", "不能重複");
  eq(Core.setDirs(st, a.id, "film", ["idol", "cm", "host"]), "sub", "最多 2 個");
  eq(Core.setDirs(st, "x", "film", []), "noArtist");
});

test("UI 用 API：等級、每日抽卡、保底、課程可否", function () {
  var st = Core.create({ seed: 1 });
  eq(Core.nextLevelRep(st), 500); st.company.level = 10; eq(Core.nextLevelRep(st), null);
  eq(Core.dailyPullsLeft(st), 30);
  st.company.money = 1e9; st.facilities.dorm = 10; Core.pull(st, "money", 10);
  eq(Core.dailyPullsLeft(st), 20); st.day = 1; eq(Core.dailyPullsLeft(st), 30, "隔天");
  st.gacha.pity = 0; eq(Core.pityLeft(st), 150); st.gacha.pity = 149; eq(Core.pityLeft(st), 1);
  eq(Core.courseAllowed(st, D.COURSE_BY_ID.vocal_2), false); st.facilities.studio = 1; eq(Core.courseAllowed(st, D.COURSE_BY_ID.vocal_2), true);
});

test("存檔：存讀、備份、壞檔改讀備份", function () {
  var s = fakeStorage(), st = Core.create({ seed: 3, name: "星光" });
  eq(Store.load(s), null, "沒有存檔");
  assert(Store.save(st, s), "save 回傳 true");
  eq(Store.load(s).company.name, "星光");
  st.company.money = 123; Store.save(st, s);
  eq(JSON.parse(s._m[Store.BACKUP]).company.money, 50000, "備份是上一份");
  s._m[Store.KEY] = "{壞掉";
  eq(Store.load(s).company.money, 50000, "主存檔壞掉讀備份");
  Store.clear(s); eq(Store.load(s), null);
});

test("存檔：讀檔會 migrate", function () {
  var s = fakeStorage(), st = Core.create({ seed: 3 });
  delete st.groups; s.setItem(Store.KEY, JSON.stringify(st));
  assert(Array.isArray(Store.load(s).groups), "補上 groups");
});

test("存檔：匯出入字串（含中日文）", function () {
  var st = Core.create({ seed: 9, name: "夜空プロ・星光" });
  var code = Store.encode(st);
  eq(code.indexOf("SV1."), 0, "前綴");
  assert(/^SV1\.[A-Za-z0-9_-]+$/.test(code), "base64url 字元");
  var back = Store.decode("  \n" + code + "\n ");
  eq(back.company.name, "夜空プロ・星光"); eq(back.seed, st.seed);
  ["", "SV1.", "SV2.abc", "SV1.!!!", "SV1." + Buffer.from('{"a":1}').toString("base64")].forEach(function (bad) {
    var threw = false;
    try { Store.decode(bad); } catch (e) { threw = true; }
    assert(threw, "應該拒絕：" + bad);
  });
});

test("頭像：所有組合都能畫、可重現、反映外觀", function () {
  var seen = {};
  for (var face = 0; face < 4; face++) for (var hair = 0; hair < 12; hair++) for (var eye = 0; eye < 6; eye++) for (var acc = -1; acc < 6; acc++) {
    var look = { face: face, hair: hair, hairColor: hair % 8, eye: eye, outfit: (face + hair) % 8, acc: acc, skin: eye % 4 };
    var s = Avatar.svg(look, { bg: "#123456" });
    assert(s.indexOf("<svg") === 0 && s.slice(-6) === "</svg>", "SVG 外框");
    assert(s.indexOf(D.LOOK.skins[look.skin]) >= 0 && s.indexOf(D.LOOK.hairColors[look.hairColor]) >= 0 && s.indexOf("#123456") >= 0, "顏色");
    assert(s.indexOf(" id=") < 0, "不能有 id");
    seen[s] = 1;
  }
  assert(Object.keys(seen).length === 4 * 12 * 6 * 7, "每種組合都不同");
  eq(Avatar.svg(null, {}), Avatar.svg(null, {}), "預設外觀可重現");
});

test("設施：費用、等級上限、升級", function () {
  var st = Core.create({ seed: 1 });
  eq(Core.facilityCost(st, "dorm"), 30000, "宿舍 Lv1→2"); eq(Core.facilityCost(st, "practice"), 80000, "練習室 Lv0→1（依 sim 平衡調整（計畫 3）：宿舍以外的設施費用 ×2）");
  eq(Core.facilityCap(st, "dorm"), 10); eq(Core.facilityCap(st, "practice"), 1, "公司 Lv1 只能到 Lv1");
  eq(Core.upgradeFacility(st, "nope"), "noFacility");
  st.company.money = 10000; eq(Core.upgradeFacility(st, "dorm"), "money");
  st.company.money = 1e9;
  eq(Core.upgradeFacility(st, "dorm"), null); eq(st.facilities.dorm, 2); eq(Core.capacity(st), 10);
  eq(Core.upgradeFacility(st, "practice"), null); eq(Core.upgradeFacility(st, "practice"), "level");
  st.company.level = 10;
  for (var i = 0; i < 10; i++) Core.upgradeFacility(st, "dorm");
  eq(st.facilities.dorm, 10); eq(Core.upgradeFacility(st, "dorm"), "max"); eq(Core.facilityCost(st, "dorm"), null);
  assert(st.log.some(function (e) { return e.type === "facility_up" && e.data.f === "dorm" && e.data.lv === 2; }), "日誌");
  D.FACILITY_ORDER.forEach(function (f) { assert(D.FACILITIES[f].name.zh && D.FACILITIES[f].desc.ja, "名稱說明 " + f); });
});

test("趨勢：初始、季節更替、倍率", function () {
  var st = Core.create({ seed: 5 });
  var c = st.trend.cur;
  assert(c.hot.length >= 2 && c.hot.length <= 3, "熱門數"); assert(c.hot.indexOf(c.cold) < 0, "低迷不能是熱門");
  c.hot.forEach(function (d, i) { assert(D.DIR_BY_ID[d] && c.hot.indexOf(d) === i, "熱門方向不重複"); });
  eq(Core.trendMult(st, c.hot[0]), 1.5); eq(Core.trendMult(st, c.cold), 0.7);
  var next = JSON.stringify(st.trend.next);
  Core.advance(st, 90);
  eq(JSON.stringify(st.trend.cur), next, "下一季的傳聞成真"); eq(st.trend.season, 1);
  assert(st.log.some(function (e) { return e.type === "trend_new"; }), "日誌");
  var s2 = Core.seasonOf(90); eq(s2.year, 1); eq(s2.season, 2); eq(Core.seasonOf(360).year, 2);
});

test("趨勢：特殊潮流的方向也算熱門、工作帶趨勢倍率", function () {
  var st = Core.create({ seed: 5 });
  st.trend.cur = { hot: ["film", "drama"], cold: "anchor", special: "vtuber_boom" };
  eq(Core.trendMult(st, "vtuber"), 1.5); eq(Core.trendMult(st, "host"), 1);
  st.board = []; Core._refreshBoard(st);
  st.board.forEach(function (j) { eq(j.trend, Core.trendMult(st, j.dir), "job.trend " + j.dir); });
  var n = { hot: 0, cold: 0 };
  for (var i = 0; i < 3000; i++) { var j = Core._genJob(st); if (j.dir === "film") n.hot++; if (j.dir === "anchor") n.cold++; }
  assert(n.hot > n.cold * 2.5, "熱門出現較多 " + JSON.stringify(n));
});

test("指名工作：只有指定藝人能接、不看門檻", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st), b = freshArtist(st);
  var j = Core._genJob(st, { dir: "film", tier: "C", reservedFor: a.id });
  st.board.push(j);
  eq(j.role, "lead"); eq(j.minFame, 0); eq(j.minProf, 1); eq(j.tier, "C"); eq(j.dir, "film");
  eq(Core.eligible(st, b, j), "reserved"); eq(Core.eligible(st, a, j), null);
});

test("存檔版本 2：舊存檔補上趨勢", function () {
  var st = Core.create({ seed: 1 });
  delete st.trend; st.version = 1;
  var m = Core.migrate(JSON.parse(JSON.stringify(st)));
  // 原本寫死 2；計畫 4 升到版本 3 後改成跟著 Core.VERSION（這個測試只關心趨勢有沒有補上）
  eq(m.version, Core.VERSION); assert(m.trend && m.trend.cur.hot.length >= 2 && m.trend.next, "補上 trend");
});

test("事件資料：40 種、格式正確", function () {
  var FX = ["money", "tickets", "rep", "loan", "sellTop", "fame", "famePct", "stress", "stamina", "satisfaction", "mood", "salaryPct",
    "statAll", "stat", "rest", "specialJob", "leave", "moneyBySalary", "allStress", "allSatisfaction", "allSalaryPct", "rivalPower", "renew", "retire", "retain", "projectMod", "projectDays"];
  var TARGETS = ["none", "any", "famous", "rookie", "music", "dance", "stream", "stressed", "unhappy", "lowmood", "idle"];
  eq(D.EVENTS.length, Events.all().length, "D.EVENTS 與登記器一致");
  eq(Events.all().filter(function (e) { return e.addedIn === "v1"; }).length, 40, "v1 事件數");
  var seen = {};
  D.EVENTS.forEach(function (ev) {
    assert(!seen[ev.id], "重複 " + ev.id); seen[ev.id] = 1;
    assert(D.EVENT_BY_ID[ev.id] === ev, "EVENT_BY_ID");
    assert(D.EVENT_CATS.indexOf(ev.category) >= 0, ev.id + " 分類");
    assert(TARGETS.indexOf(ev.target) >= 0, ev.id + " target");
    assert(ev.trigger === "random" || ev.trigger === "cond", ev.id + " trigger");
    assert(ev.title.zh && ev.title.ja && ev.text.zh && ev.text.ja, ev.id + " 文字");
    assert(ev.choices.length >= 2 && ev.choices.length <= 3, ev.id + " 選項數");
    assert(ev.choices[ev.defaultChoice], ev.id + " defaultChoice");
    ev.choices.forEach(function (c, i) {
      assert(c.label.zh && c.label.ja && c.hint.zh && c.hint.ja, ev.id + " 選項文字 " + i);
      assert(c.outcomes.length >= 1, ev.id + " 結果");
      c.outcomes.forEach(function (o) {
        assert(o.w > 0, ev.id + " 權重");
        Object.keys(o.fx).forEach(function (k) { assert(FX.indexOf(k) >= 0, ev.id + " 不支援的 fx " + k); });
        if (o.fx.stat) Object.keys(o.fx.stat).forEach(function (s) { assert(D.STATS.indexOf(s) >= 0, ev.id + " stat " + s); });
      });
    });
  });
  ["strike_talk", "fame_milestone", "finance_crisis", "ssr_debut"].forEach(function (id) { eq(D.EVENT_BY_ID[id].trigger, "cond", id); });
});

test("事件登記器：重複 ID 丟錯、依目標分組", function () {
  var threw = false;
  try { Events.add([Events.byId("charity")]); } catch (e) { threw = true; }
  assert(threw, "重複 ID 沒有丟錯");
  eq(Events.byId("nope"), null);
  var famous = Events.byTarget("famous");
  assert(famous.length > 0 && famous.every(function (e) { return e.target === "famous" && e.trigger === "random"; }), "byTarget");
  assert(Events.byTarget("any").every(function (e) { return e.trigger === "random"; }), "條件事件不在 byTarget 裡");
});

test("事件：觸發、選擇、套用效果", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { fame: 500 });
  var e = Core.triggerEvent(st, "charity", a.id);
  eq(st.events.pending.length, 1); eq(e.deadline, st.day + 3);
  var rep0 = st.company.rep, r = Core.resolveEvent(st, e.uid, 0);
  eq(st.events.pending.length, 0); eq(r.fx.rep, 40); eq(r.fx.fame, 30); eq(a.fame, 530); eq(a.stamina, 90);
  eq(st.company.rep, rep0 + 40);
  eq(Core.resolveEvent(st, e.uid, 0).err, "noEvent");
  var e2 = Core.triggerEvent(st, "charity", a.id); eq(Core.resolveEvent(st, e2.uid, 9).err, "choice");
  assert(st.log.some(function (x) { return x.type === "event_resolved" && x.data.ev === "charity"; }), "日誌");
});

test("事件：逾期自動選預設、最多 3 件", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { fame: 500 });
  Core.triggerEvent(st, "brand_offer", a.id);
  Core.advance(st, 3);
  eq(st.events.pending.length, 0, "第 3 天逾期");
  var auto = st.log.filter(function (x) { return x.type === "event_auto"; });
  eq(auto.length, 1); eq(auto[0].data.choice, 1, "brand_offer 的預設是婉拒");
  for (var i = 0; i < 4; i++) Core.triggerEvent(st, "insomnia", a.id);
  eq(st.events.pending.length, 3, "最多 3 件");
});

test("事件：離開、違約金、指名工作、全員效果", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { fame: 500, salary: 2000 }), b = freshArtist(st);
  Core.createGroup(st, "G", [a.id, b.id]);
  var m0 = st.company.money, e = Core.triggerEvent(st, "poach_offer", a.id), r = Core.resolveEvent(st, e.uid, 1);
  assert(r.fx.leave, "離開"); eq(Core.artistById(st, a.id), null); eq(st.company.money, m0 + 12000, "月薪 × 6");
  eq(st.groups.length, 0, "組合剩一人就解散");
  e = Core.triggerEvent(st, "director_call", b.id); r = Core.resolveEvent(st, e.uid, 0);
  var j = st.board.filter(function (x) { return x.id === r.fx.job; })[0];
  assert(j && j.reservedFor === b.id && j.dir === b.dir, "指名工作");
  var c = freshArtist(st, { stress: 0, satisfaction: 50 });
  e = Core.triggerEvent(st, "staff_trip"); Core.resolveEvent(st, e.uid, 0);
  eq(c.satisfaction, 58); eq(b.stress, 0, "壓力不會低於 0");
});

test("事件：財務危機（借款、賣合約）與條件觸發", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { salary: 3000 }), b = freshArtist(st, { salary: 2000 });
  st.board = []; st.boardRefreshDay = 99999;
  st.company.money = -1e6;
  Core.advance(st, 90);
  var crisis = st.events.pending.filter(function (x) { return x.id === "finance_crisis"; });
  eq(crisis.length, 1, "負債 3 個月觸發一次");
  Core.advance(st, 30);
  eq(st.events.pending.filter(function (x) { return x.id === "finance_crisis"; }).length + st.log.filter(function (x) { return x.data && x.data.ev === "finance_crisis" && x.type === "event_auto"; }).length, 1, "不重複觸發");
  var st2 = Core.create({ seed: 2 }), c = freshArtist(st2, { salary: 3000 });
  st2.board = []; st2.boardRefreshDay = 99999;
  var e = Core.triggerEvent(st2, "finance_crisis"), m0 = st2.company.money;
  Core.resolveEvent(st2, e.uid, 1);
  eq(st2.company.money, m0 + 200000); eq(st2.loans.length, 1);
  var before = st2.company.money; Core.advance(st2, 30);
  eq(before - st2.company.money, 3000 + 1000 + 12000, "月薪 + 營運費 + 還款");
  e = Core.triggerEvent(st2, "finance_crisis"); m0 = st2.company.money;
  Core.resolveEvent(st2, e.uid, 0);
  eq(Core.artistById(st2, c.id), null, "賣掉合約"); eq(st2.company.money, m0 + 3000 * 6);
  var st3 = Core.create({ seed: 3 }), d = freshArtist(st3, { stress: 97 });
  Core.schedule(st3, d.id, { kind: "train" }); Core.advance(st3, 2);
  eq(st3.events.pending[0].id, "strike_talk"); eq(st3.events.pending[0].aid, d.id);
  Core._grantEntry(st3, Roster.byId("ssr001"));
  assert(st3.events.pending.some(function (x) { return x.id === "ssr_debut"; }), "SSR 入社");
});

test("事件：人氣跨過門檻", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { fame: 995 }), j = soloJob(st);
  D.STATS.forEach(function (s) { a.stats[s] = 300; });
  Core.takeJob(st, j.id, [a.id]); Core.advance(st, 2);
  var e = st.events.pending.filter(function (x) { return x.id === "fame_milestone"; })[0];
  assert(e && e.ctx.n === 1000 && e.aid === a.id, "fame_milestone");
});

test("事件：讀檔丟棄找不到的事件", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st);
  Core.triggerEvent(st, "charity", a.id);
  st.events.pending.push({ uid: "e999", id: "removed_event", aid: null, ctx: {}, day: 0, deadline: 3 });
  var m = Core.migrate(JSON.parse(JSON.stringify(st)));
  eq(m.events.pending.length, 1); eq(m.events.pending[0].id, "charity");
});

test("事件：隨機發生頻率、公關部壓低壞結果", function () {
  withEvents(function () {
    var st = Core.create({ seed: 4 }), n = 0;
    freshArtist(st); freshArtist(st, { fame: 500 });
    st.board = []; st.boardRefreshDay = 99999;
    Core.advance(st, 360);
    st.log.forEach(function (x) { if (x.type === "event_new") n++; });
    assert(n >= 15 && n <= 50, "一年 " + n + " 件（預期約 29）");
  });
  function badRate(pr) {
    var st = Core.create({ seed: 9 }), a = freshArtist(st, { fame: 500 }), bad = 0;
    st.facilities.pr = pr;
    for (var i = 0; i < 2000; i++) { var e = Core.triggerEvent(st, "old_post", a.id); if (Core.resolveEvent(st, e.uid, 1).bad) bad++; a.fame = 500; }
    return bad / 2000;
  }
  var r0 = badRate(0), r5 = badRate(5);
  assert(r0 > 0.45 && r0 < 0.55 && r5 > 0.28 && r5 < 0.39, "壞結果比例 pr0=" + r0 + " pr5=" + r5);
});

test("月薪：隨人氣上升（基本月薪 × (1 + √人氣 ÷ salaryFameDiv)）", function () {
  var K = D.BAL.salaryFameDiv;
  function pay(base, fame) { return Math.round(base * (1 + Math.sqrt(fame) / K) / 100) * 100; }
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { salary: 2000, fame: 2500 });
  st.board = []; st.boardRefreshDay = 99999;
  eq(a.baseSalary, 2000);
  Core.advance(st, 30);
  eq(a.salary, pay(2000, a.fame), "月底重算");
  var e = Core.triggerEvent(st, "poach_offer", a.id); a.fame = 2500;
  Core.resolveEvent(st, e.uid, 0);
  eq(a.baseSalary, 2600, "加薪 30% 改的是基本月薪"); eq(a.salary, pay(2600, 2500), "加薪後立即重算");
  e = Core.triggerEvent(st, "finance_crisis"); Core.resolveEvent(st, e.uid, 2);
  eq(a.baseSalary, 2100, "全員減薪 20%（2080 取整到百）");
  var r = Core._genR(st); eq(r.baseSalary, r.salary, "新藝人的基本月薪＝初始月薪");
  var old = Core.create({ seed: 2 }), b = Core._genR(old); delete b.baseSalary; b.salary = 4200; old.artists.push(b);
  eq(Core.migrate(JSON.parse(JSON.stringify(old))).artists[0].baseSalary, 4200, "舊存檔以目前月薪當基本月薪");
});

test("對手：初始 5 家、名字與宿敵明星不重複、不進抽卡池", function () {
  var st = Core.create({ seed: 3 });
  eq(st.rivals.length, 5);
  var names = {}, stars = {};
  st.rivals.forEach(function (r) {
    var n = Core.rivalName(r, "zh");
    assert(!names[n], "公司名重複 " + n); names[n] = 1;
    assert(r.power >= 80 && r.power <= 140, "實力 " + r.power);
    assert(r.stars.length >= 1 && r.stars.length <= 2, "明星數");
    r.stars.forEach(function (s) {
      assert(!stars[s.rosterId], "宿敵明星重複"); stars[s.rosterId] = 1;
      eq(Roster.byId(s.rosterId).kind, "rival");
      assert(Core.rivalStarName(s, "ja"), "明星名");
    });
  });
  assert(Roster.rivals().length >= 10, "宿敵明星名錄");
  assert(Roster.byRarity("SR").concat(Roster.byRarity("SSR")).every(function (e) { return e.kind !== "rival"; }), "不進抽卡池");
  eq(Core.rivalById(st, st.rivals[0].id), st.rivals[0]);
});

test("對手：每年成長、倒閉與遞補、明星流入候補", function () {
  var st = Core.create({ seed: 8 });
  st.board = []; st.boardRefreshDay = 99999;
  var dead = st.rivals[0], deadStars = dead.stars.map(function (s) { return s.rosterId; });
  dead.power = 10;
  var keep = st.rivals[1], p0 = keep.power, fame0 = keep.stars[0].fame;
  Core.advance(st, 360);
  eq(st.rivals.length, 5, "保持 5 家");
  assert(!Core.rivalById(st, dead.id), "倒閉");
  assert(st.log.some(function (e) { return e.type === "rival_bankrupt"; }) && st.log.some(function (e) { return e.type === "rival_new"; }), "日誌");
  assert(keep.stars[0].fame > fame0, "宿敵明星人氣成長");
  assert(keep.power !== p0, "實力變動");
  var joined = st.artists.concat(st.waitlist.map(function (w) { return w.artist; })).filter(function (a) { return deadStars.indexOf(a.rosterId) >= 0; }).length;
  var joinLogs = st.log.filter(function (e) { return e.type === "rival_star_join"; }).length;
  eq(joined, joinLogs, "流入的人數與日誌一致");
});

test("存檔版本 3：舊存檔補上對手", function () {
  var st = Core.create({ seed: 1 });
  delete st.rivals; st.version = 2;
  var m = Core.migrate(JSON.parse(JSON.stringify(st)));
  // 計畫 5 升到版本 4 後改成跟著 Core.VERSION（這個測試只關心對手有沒有補上）
  eq(m.version, Core.VERSION); eq(m.rivals.length, 5);
});

test("試鏡：A/S 是試鏡制、隔天公布、贏了開工輸了被搶", function () {
  var st = Core.create({ seed: 1 });
  st.company.level = 6; st.board = []; st.boardRefreshDay = 99999;
  var hi = freshArtist(st, { fame: 99999 }), lo = freshArtist(st, { fame: 99999 });
  D.STATS.forEach(function (s) { hi.stats[s] = 999; hi.caps[s] = 999; lo.stats[s] = 1; });
  hi.prof.singer.lv = 10; lo.prof.singer.lv = 10;
  var j1 = soloJob(st, { tier: "A", audition: true, minFame: 1500, minProf: 5, days: 3 });
  var j2 = soloJob(st, { tier: "A", audition: true, minFame: 1500, minProf: 5, days: 3 });
  eq(Core.takeJob(st, j1.id, [hi.id]), null); eq(Core.takeJob(st, j2.id, [lo.id]), null);
  eq(st.auditions.length, 2); eq(hi.task.kind, "audition"); eq(st.activeJobs.length, 0);
  Core.advance(st, 1);
  eq(st.auditions.length, 0, "隔天公布");
  eq(st.activeJobs.length, 1, "贏的開工"); eq(st.activeJobs[0].job.id, j1.id); eq(hi.task.kind, "job");
  eq(lo.task, null, "輸的沒事");
  assert(st.log.some(function (e) { return e.type === "audition_won"; }) && st.log.some(function (e) { return e.type === "audition_lost"; }), "日誌");
  var gen = Core._genJob(st, { tier: "S" }); eq(gen.audition, true);
  eq(Core._genJob(st, { tier: "S", reservedFor: hi.id }).audition, false, "指名工作不用試鏡");
  eq(Core._genJob(st, { tier: "C" }).audition, false);
});

test("宿敵劇情：同一位宿敵競爭 3 次推出下一段，10 段依序、前一段未處理不推、最後一段後停止", function () {
  eq(D.BAL.rivalStoryStages, 10); eq(D.BAL.rivalStoryEvery, 3);
  for (var n = 1; n <= 10; n++) {
    var ev = D.EVENT_BY_ID["rival_story_" + n];
    assert(ev, "第 " + n + " 段"); eq(ev.trigger, "cond");
    assert(ev.choices[ev.defaultChoice], "第 " + n + " 段的預設選項");
  }
  var st = Core.create({ seed: 1 });
  st.company.level = 6; st.board = []; st.boardRefreshDay = 99999;
  var r = st.rivals[0];
  r.stars = [{ rosterId: "rv001", stats: { act: 999, vocal: 999, dance: 999, talk: 999, charm: 999, sense: 999 }, fame: 5000, age: 23 }];
  st.rivals = [r];
  var a = freshArtist(st, { fame: 99999 }); a.prof.singer.lv = 10;
  function contest() {
    var j = soloJob(st, { tier: "A", audition: true, minFame: 1500, minProf: 5, days: 1 });
    eq(Core.takeJob(st, j.id, [a.id]), null);
    Core.advance(st, 1);
    a.task = null;
  }
  function pending(id) { return st.events.pending.filter(function (e) { return e.id === id; })[0]; }
  contest(); contest();
  eq(st.rivalStory.stage, 0, "2 次還不觸發");
  contest();
  eq(st.rivalStory.stage, 1, "第 3 次觸發第 1 段");
  var e = pending("rival_story_1");
  assert(e, "推出第 1 段"); eq(e.ctx.star, "rv001"); eq(e.ctx.rival, r.id); eq(e.aid, a.id);
  contest(); contest(); contest();
  eq(st.rivalStory.stage, 1, "前一段還沒處理就不推下一段");
  Core.resolveEvent(st, e.uid, D.EVENT_BY_ID.rival_story_1.defaultChoice);
  contest(); contest(); contest();
  eq(st.rivalStory.stage, 2); assert(pending("rival_story_2"), "推出第 2 段");
  st.events.pending = [];
  st.rivalStory.stage = 9;
  contest(); contest(); contest();
  eq(st.rivalStory.stage, 10); assert(pending("rival_story_10"), "推出第 10 段");
  st.events.pending = [];
  contest(); contest(); contest();
  eq(st.rivalStory.stage, 10, "最後一段之後不再推出");
  var old = Core.create({ seed: 2 }); delete old.rivalStory; old.version = 5;
  var m = Core.migrate(JSON.parse(JSON.stringify(old)));
  eq(m.version, 6); eq(m.rivalStory.stage, 0, "舊存檔補上宿敵劇情");
});

test("搶工作：有興趣的工作比較容易被搶", function () {
  D.BAL.snatchChance = SNATCH[0]; D.BAL.snatchInterestChance = SNATCH[1];
  try {
    var st = Core.create({ seed: 2 }), n = { hot: 0, cold: 0 };
    st.boardRefreshDay = 99999;
    for (var round = 0; round < 40; round++) {
      st.board = [];
      for (var i = 0; i < 20; i++) { var j = Core._genJob(st, { tier: "C" }); j.interest = i < 10 ? st.rivals[0].id : null; j.expires = st.day + 999; st.board.push(j); }
      Core.advance(st, 5);
      st.board.forEach(function (j) { if (j.interest) n.hot++; else n.cold++; });
    }
    assert(n.hot < n.cold, "有興趣的留下較少 " + JSON.stringify(n));
    assert(st.log.some(function (e) { return e.type === "job_snatched"; }), "日誌");
  } finally { D.BAL.snatchChance = 0; D.BAL.snatchInterestChance = 0; }
});

test("獎項資料：55 個、每個方向都有個人獎與作品獎", function () {
  eq(D.AWARDS.length, 55, "獎項數");
  var seen = {}, cer = {};
  D.CEREMONIES.forEach(function (c) { cer[c.id] = 1; assert(c.name.zh && c.name.ja, "典禮名"); });
  D.AWARDS.forEach(function (aw) {
    assert(!seen[aw.id], "重複 " + aw.id); seen[aw.id] = 1;
    assert(cer[aw.ceremony], aw.id + " 典禮"); assert(aw.name.zh && aw.name.ja, aw.id + " 名稱");
    assert(["person", "work", "rookie", "group", "company"].indexOf(aw.kind) >= 0, aw.id + " kind");
    (aw.dirs || []).forEach(function (d) { assert(D.DIR_BY_ID[d], aw.id + " 方向 " + d); });
    eq(D.AWARD_BY_ID[aw.id], aw);
  });
  D.DIRS.forEach(function (d) {
    var has = function (k) { return D.AWARDS.some(function (aw) { return aw.kind === k && aw.dirs && aw.dirs.indexOf(d.id) >= 0; }); };
    assert(has("person"), d.id + " 沒有個人獎"); assert(has("work"), d.id + " 沒有作品獎");
  });
  eq(D.CHARTS.length, 4);
});

test("排行榜：前 10、我方第 1 名加聲望", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { fame: 50 });
  for (var i = 0; i < 3; i++) a.works.unshift({ title: [0, 0], dir: "singer", tier: "S", role: "lead", result: "great", stars: 5, day: st.day, isWork: true, pay: 1 });
  st.day = 10;
  var rep0 = st.company.rep;
  Core.updateCharts(st);
  ["single", "ratings", "boxoffice", "popularity"].forEach(function (id) {
    var l = st.charts.lists[id];
    assert(l.length > 0 && l.length <= 10, id + " 筆數");
    for (var k = 1; k < l.length; k++) assert(l[k - 1].score >= l[k].score, id + " 排序");
  });
  eq(st.charts.lists.single[0].kind, "artist", "S 級 5★ 主打三首拿下單曲榜第 1");
  assert(st.company.rep >= rep0 + 50, "聲望");
  assert(st.log.some(function (e) { return e.type === "chart_top" && e.data.chart === "single"; }), "日誌");
});

test("頒獎：所有獎項都有結果、強者多半得獎、獎品與歷史", function () {
  var st = Core.create({ seed: 1 });
  st.board = []; st.boardRefreshDay = 99999;
  var star = freshArtist(st, { fame: 30000, gender: "f" });
  star.dir = "film";
  for (var i = 0; i < 5; i++) star.works.unshift({ title: [i, i], dir: "film", tier: "S", role: "lead", result: "great", stars: 5, day: 300, isWork: true, pay: 1 });
  st.day = 359;
  var m0 = st.company.money;
  Core.holdAwards(st);
  var h = st.awards.history[0];
  eq(h.year, 1); eq(st.awards.unseen, 1);
  h.results.forEach(function (r) {
    assert(D.AWARD_BY_ID[r.award], "獎項"); assert(r.nominees.length >= 1 && r.nominees.length <= 5, r.award + " 入圍數");
    assert(r.nominees[r.winner], r.award + " 得獎者");
  });
  var mine = h.results.filter(function (r) { var n = r.nominees[r.winner]; return n.kind === "artist" || n.kind === "work"; });
  assert(mine.length >= 1, "強者至少拿到一座");
  assert(star.trophies.length >= 1 && st.company.money > m0, "獎座與獎金");
  assert(h.results.some(function (r) { return r.award === "film_actress"; }), "女主角獎有結果");
  assert(!h.results.filter(function (r) { return r.award === "film_actor"; })[0].nominees.some(function (n) { return n.aid === star.id; }), "女性不會入圍男主角");
  assert(st.log.some(function (e) { return e.type === "awards"; }), "日誌");
});

test("頒獎：每年 12/30 自動舉辦、歷史保留 10 年", function () {
  var st = Core.create({ seed: 2 });
  st.board = []; st.boardRefreshDay = 99999;
  freshArtist(st);
  Core.advance(st, 359);
  eq(st.awards.history.length, 1, "第 1 年 12/30");
  for (var y = 0; y < 11; y++) Core.advance(st, 360);
  eq(st.awards.history.length, 10, "保留 10 年"); eq(st.awards.history[0].year, 12);
});

test("對手事件：帶公司與明星、影響對手實力", function () {
  eq(Events.all().filter(function (e) { return e.addedIn === "v2"; }).length, 6, "v2 事件數");
  var st = Core.create({ seed: 4 }), a = freshArtist(st, { fame: 500 });
  var e = Core.triggerEvent(st, "rival_collab", a.id);
  var r = Core.rivalById(st, e.ctx.rival);
  assert(r, "ctx.rival"); var p0 = r.power;
  var res = Core.resolveEvent(st, e.uid, 0);
  eq(r.power, p0 + 5); eq(res.fx.rivalPower, 5); eq(res.fx.rival, r.id);
  var e2 = Core.triggerEvent(st, "rival_challenge", a.id);
  assert(e2.ctx.star && Roster.byId(e2.ctx.star).kind === "rival", "ctx.star");
});

test("對手：實力每年回歸 100 附近（不會無限累積）", function () {
  var st = Core.create({ seed: 6 });
  st.board = []; st.boardRefreshDay = 99999;
  st.rivals.forEach(function (r) { r.power = 2000; });
  Core.advance(st, 360 * 10);
  st.rivals.forEach(function (r) { assert(r.power < 400, "10 年後實力 " + r.power); });
});

test("合約：建立時 3 年、到期觸發續約、加薪／照常／拒絕", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { salary: 2000, satisfaction: 90 });
  st.board = []; st.boardRefreshDay = 99999;
  eq(Core._genR(st).contractEnd, st.day + 1080, "新藝人");
  a.contractEnd = 5;
  Core.advance(st, 5);
  var e = st.events.pending.filter(function (x) { return x.id === "contract_renewal"; })[0];
  assert(e && e.aid === a.id && a.renewPending, "到期觸發");
  Core.advance(st, 1); eq(st.events.pending.filter(function (x) { return x.id === "contract_renewal"; }).length, 1, "不重複觸發");
  var r = Core.resolveEvent(st, e.uid, 0);
  assert(r.fx.renewed, "加薪續約"); eq(a.baseSalary, 2400); eq(a.contractEnd, 5 + 1080); eq(a.renewPending, false);
  var b = freshArtist(st, { satisfaction: 0 }); b.contractEnd = st.day;
  Core.advance(st, 1);
  e = st.events.pending.filter(function (x) { return x.aid === b.id; })[0];
  r = Core.resolveEvent(st, e.uid, 1);
  assert(r.fx.refused, "滿意度 0 一定拒絕"); eq(Core.artistById(st, b.id), null);
});

test("滿意度：每月依工作、壓力、心情漂移", function () {
  var st = Core.create({ seed: 1 });
  st.board = []; st.boardRefreshDay = 99999;
  var idle = freshArtist(st, { satisfaction: 50 }), busy = freshArtist(st, { satisfaction: 50, stress: 80, mood: 1 });
  busy.works.unshift({ title: [0, 0], dir: "singer", tier: "D", role: "support", result: "success", stars: 3, day: 20, isWork: false, pay: 1 });
  busy.stress = 80;
  Core.advance(st, 30);
  eq(idle.satisfaction, 48, "沒工作 −2");
  eq(busy.satisfaction, 50, "有工作 +2、壓力 −3、心情 +1");
});

test("存檔版本 4：補上合約到期日", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st);
  delete a.contractEnd; st.version = 3;
  var m = Core.migrate(JSON.parse(JSON.stringify(st)));
  // 計畫 6 升到版本 5 後改成跟著 Core.VERSION（這個測試只關心合約）
  eq(m.version, Core.VERSION); eq(m.artists[0].contractEnd, st.day + 1080);
});

test("引退：超過引退線會提出、尊重決定進名人堂、挽留成功率看滿意度", function () {
  var st = Core.create({ seed: 3 });
  st.board = []; st.boardRefreshDay = 99999;
  var old = freshArtist(st, { age: 60, fame: 20000 });
  for (var i = 0; i < 4; i++) old.trophies.push({ award: "singer_f", year: 1 });
  old.worksTotal = 20; old.contractEnd = 99999;   // 避免 3 年後先因合約到期離開
  var tries = 0;
  while (!st.events.pending.some(function (x) { return x.id === "retire_offer"; }) && tries++ < 10) Core.advance(st, 360);
  var e = st.events.pending.filter(function (x) { return x.id === "retire_offer"; })[0];
  assert(e && e.aid === old.id, "提出引退");
  var r = Core.resolveEvent(st, e.uid, 0);
  assert(r.fx.retired && r.fx.retired.hof, "進名人堂");
  eq(Core.artistById(st, old.id), null); eq(st.hall.length, 1); eq(st.retireQueue.length, 1);
  assert(st.timeline.some(function (x) { return x.kind === "hof"; }), "年表");
  var keep = freshArtist(st, { satisfaction: 100, age: 70 });
  e = Core.triggerEvent(st, "retire_offer", keep.id);
  r = Core.resolveEvent(st, e.uid, 1);
  assert(r.fx.retained, "滿意度 100 一定挽留成功"); assert(keep.retireAskedUntil > st.day, "一年內不再問");
  var gone = freshArtist(st, { satisfaction: 0 });
  e = Core.triggerEvent(st, "retire_offer", gone.id);
  r = Core.resolveEvent(st, e.uid, 1);
  assert(r.fx.retired && !r.fx.retired.hof, "挽留失敗、評分不夠不進名人堂"); eq(st.hall.length, 1);
});

test("引退：retireArtist 摘要內容", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { fame: 3000 });
  a.works.unshift({ title: [1, 2], dir: "singer", tier: "B", role: "lead", result: "great", stars: 5, day: 0, isWork: true, pay: 1 });
  a.worksTotal = 1;
  var s = Core.retireArtist(st, a.id);
  eq(s.best.tier, "B"); eq(s.works, 1); eq(s.dir, "singer"); eq(s.era, 1);
  eq(s.score, 0 + 0.5 + 3); eq(s.hof, false);
  eq(Core.retireArtist(st, "nope"), null);
});

test("導師與製作人：名額、加成、月薪", function () {
  var st = Core.create({ seed: 1 });
  st.board = []; st.boardRefreshDay = 99999;
  var h = { id: "h900", era: 1, trophies: [{ award: "x", year: 1 }, { award: "y", year: 1 }], hof: true, dir: "singer", rosterId: null, nameSeed: 1, gender: "f" };
  st.hall.push(h);
  eq(Core.staffSlots(st), 0); eq(Core.hireStaff(st, "h900", "mentor", "singer"), "slots");
  st.company.level = 4; eq(Core.staffSlots(st), 2);
  eq(Core.hireStaff(st, "nope", "mentor", "singer"), "noHof"); eq(Core.hireStaff(st, "h900", "boss", "singer"), "role"); eq(Core.hireStaff(st, "h900", "mentor", "xx"), "dir");
  eq(Core.hireStaff(st, "h900", "mentor", "singer"), null); eq(Core.hireStaff(st, "h900", "producer", "film"), "hired");
  assert(Math.abs(Core.staffBonus(h) - 0.14) < 1e-9, "加成 0.1 + 2 × 0.02");
  var a = freshArtist(st), b = freshArtist(st);
  b.dir = "film";
  Core.schedule(st, a.id, { kind: "course", courseId: "vocal_1" }); Core.schedule(st, b.id, { kind: "course", courseId: "vocal_1" });
  Core.advance(st, 3);
  assert(a.stats.vocal > b.stats.vocal, "有導師的成長較多");
  var m0 = st.company.money; Core.advance(st, 27);
  var me = st.log.filter(function (e) { return e.type === "month_end"; }).pop();
  assert(me.data.salary >= 12000, "月薪含導師 10000 + 2 × 1000");
  Core.fireStaff(st, "h900"); eq(st.staff.length, 0);
});

test("製作人：大成功門檻下修、評價提高", function () {
  function avgStars(withProducer) {
    var st = Core.create({ seed: 5 }), total = 0;
    st.board = []; st.boardRefreshDay = 99999; st.company.level = 4;
    st.hall.push({ id: "h1", era: 1, trophies: [], hof: true, dir: "singer", rosterId: null, nameSeed: 1, gender: "f" });
    if (withProducer) Core.hireStaff(st, "h1", "producer", "singer");
    for (var i = 0; i < 60; i++) {
      var a = freshArtist(st); D.STATS.forEach(function (s) { a.stats[s] = 60; });   // 以成功為主，評價 +1★ 不容易被 5★ 上限吃掉
      var j = soloJob(st); Core.takeJob(st, j.id, [a.id]);
    }
    Core.advance(st, 2);
    st.log.forEach(function (e) { if (e.type === "job_done") total += e.data.stars; });
    return total / 60;
  }
  var base = avgStars(false), prod = avgStars(true);
  assert(prod > base + 0.3, "製作人讓平均評價提高 " + base + " → " + prod);
});

test("成就：20 項、格式、解鎖給券", function () {
  // 計畫 9 新增判定類型（sr、stories、rivalStory…）後，改成從核心讀取，不再寫死清單
  var TYPES = Core.ACH_TYPES;
  eq(Ach.all().filter(function (x) { return x.addedIn === "v1"; }).length, 20);
  Ach.all().forEach(function (x) {
    assert(x.name.zh && x.name.ja && x.desc.zh && x.desc.ja, x.id + " 文字");
    assert(TYPES.indexOf(x.cond.type) >= 0, x.id + " cond");
    eq(D.ACHIEVEMENT_BY_ID[x.id], x);
  });
  var threw = false; try { Ach.add([Ach.byId("first_pull")]); } catch (e) { threw = true; } assert(threw, "重複 ID");
  var st = Core.create({ seed: 1 }), t0 = st.company.tickets;
  st.board = []; st.boardRefreshDay = 99999;
  Core.pull(st, "ticket", 10);
  Core.advance(st, 1);
  assert(st.achievements.first_pull, "抽 10 次"); assert(st.company.tickets > t0 - 10, "獎勵星探券");
  assert(st.log.some(function (e) { return e.type === "achievement" && e.data.id === "first_pull"; }), "日誌");
});

test("圖鑑：統計與 SSR 小故事", function () {
  var st = Core.create({ seed: 1 });
  st.board = []; st.boardRefreshDay = 99999;
  Core._grantEntry(st, Roster.byId("ssr001")); Core._grantEntry(st, Roster.byId("sr001"));
  var c = Core.codexStats(st);
  eq(c.ssr, 1); eq(c.ssrTotal, Roster.byRarity("SSR").length); eq(c.sr, 1); eq(c.srTotal, Roster.byRarity("SR").length);
  Roster.byRarity("SSR").forEach(function (e) { assert(e.story && e.story.zh && e.story.ja, e.id + " 小故事"); });
  var a = st.artists.filter(function (x) { return x.rosterId === "ssr001"; })[0];
  a.fame = 50000;
  for (var i = 0; i < 3; i++) a.works.unshift({ title: [0, i], dir: "idol", tier: "S", role: "lead", result: "great", stars: 5, day: 300, isWork: true, pay: 1 });
  st.day = 359; Core.holdAwards(st);
  if (a.trophies.length) assert(st.codex.stories.ssr001, "得獎解鎖小故事");
  else assert(!st.codex.stories.ssr001, "沒得獎不解鎖");
});

test("新紀元：條件、保留與重置、帶走藝人、傳承點", function () {
  var st = Core.create({ seed: 1, name: "星光" });
  st.board = []; st.boardRefreshDay = 99999;
  var a = freshArtist(st, { fame: 5000 });
  a.stats.vocal = 300; a.trophies.push({ award: "singer_f", year: 1 });
  freshArtist(st);
  st.hall.push({ id: "h1", era: 1, trophies: [], hof: true, dir: "film", rosterId: null, nameSeed: 1, gender: "m" });
  st.achievements.first_pull = { day: 1, era: 1 }; st.codex.owned.sr001 = true;
  st.stats.trophies = 3; st.stats.chartTops = 2;
  eq(Core.newEra(st), "level");
  st.company.level = 10; st.company.money = 9e9; st.facilities.dorm = 8; st.day = 999;
  eq(Core.legacyPoints(st), 5 + 3 + 2);
  eq(Core.newEra(st, "nope"), "noArtist");
  eq(Core.newEra(st, a.id), null);
  eq(st.era, 2); eq(st.day, 0); eq(st.company.level, 1); eq(st.company.money, 50000); eq(st.facilities.dorm, 1);
  eq(st.company.name, "星光"); eq(st.hall.length, 1); assert(st.achievements.first_pull && st.codex.owned.sr001, "保留成就與圖鑑");
  eq(st.legacy.points, 10); eq(st.artists.length, 1, "只帶走一人");
  var c = st.artists[0];
  eq(c.stats.vocal, 210, "能力 ×0.7"); eq(c.trophies.length, 1); eq(c.task, null); eq(c.contractEnd, 1080);
  eq(st.rivals.length, 5); assert(st.timeline.some(function (x) { return x.kind === "era"; }), "年表");
  eq(st.stats.trophies, 0, "本紀元統計重新起算");
});

test("傳承加成：購買、上限、效果", function () {
  var st = Core.create({ seed: 2 });
  st.legacy.points = 100;
  eq(Core.buyPerk(st, "nope"), "noPerk");
  for (var i = 0; i < 5; i++) eq(Core.buyPerk(st, "pity"), null);
  eq(Core.buyPerk(st, "pity"), "max");
  eq(Core.pityLeft(st), 100, "保底 150 − 50");
  st.legacy.points = 0; eq(Core.buyPerk(st, "money"), "points");
  st.legacy.points = 100; Core.buyPerk(st, "money"); Core.buyPerk(st, "dorm"); Core.buyPerk(st, "tickets");
  st.company.level = 10;
  Core.newEra(st);
  eq(st.company.money, 100000); eq(st.facilities.dorm, 2); eq(st.company.tickets, 15);
  var avg = st.rivals.reduce(function (s, r) { return s + r.power; }, 0) / 5;
  assert(avg >= 80 * 1.1 && avg <= 140 * 1.1, "第 2 紀元對手 ×1.1：" + avg);
});

test("企劃資料：5 件、格式、分歧事件存在", function () {
  eq(Projects.all().filter(function (p) { return p.addedIn === "v1"; }).length, 5);
  // 計畫 10 加入 Lv3 起、2 階段的小企劃：這裡只檢查 v1 的 5 件，全體的範圍檢查在「大型企劃：30 件…」
  Projects.all().filter(function (p) { return p.addedIn === "v1"; }).forEach(function (p) {
    assert(p.name.zh && p.name.ja && p.desc.zh && p.desc.ja, p.id + " 文字");
    assert(p.unlockLevel >= 5 && p.cost > 0, p.id + " 解鎖與費用");
    assert(p.stages.length >= 3 && p.stages.length <= 5, p.id + " 階段數");
    p.stages.forEach(function (s, i) {
      assert(s.name.zh && s.name.ja, p.id + " 階段名 " + i);
      assert(s.dirs.length && s.dirs.every(function (d) { return D.DIR_BY_ID[d]; }), p.id + " 方向 " + i);
      assert(s.slots[0] >= 1 && s.slots[1] <= 5 && s.slots[0] <= s.slots[1], p.id + " 人數 " + i);
      assert(D.TIERS[s.tier] && s.days > 0, p.id + " 等級與天數 " + i);
      if (s.branch) assert(D.EVENT_BY_ID[s.branch] && D.EVENT_BY_ID[s.branch].trigger === "cond", p.id + " 分歧事件 " + s.branch);
    });
    eq(D.PROJECT_BY_ID[p.id], p);
  });
  var threw = false; try { Projects.add([Projects.byId("world_tour")]); } catch (e) { threw = true; } assert(threw, "重複 ID");
  eq(Events.all().filter(function (e) { return e.addedIn === "v4"; }).length, 3);
});

function projectTeam(st, dirs, n, stat) {
  var out = [];
  for (var i = 0; i < n; i++) {
    var a = freshArtist(st); a.dir = dirs[i % dirs.length];
    D.STATS.forEach(function (s) { a.stats[s] = stat; a.caps[s] = 999; });
    out.push(a);
  }
  return out;
}

test("企劃：開始條件、派遣檢查、階段推進、結算", function () {
  var st = Core.create({ seed: 1 });
  st.board = []; st.boardRefreshDay = 99999;
  eq(Core.startProject(st, "nope"), "noProject");
  eq(Core.startProject(st, "own_variety"), "level");
  st.company.level = 5; st.company.money = 1000;
  eq(Core.startProject(st, "own_variety"), "money");
  st.company.money = 1e7;
  eq(Core.startProject(st, "own_variety"), null);
  eq(st.company.money, 1e7 - 200000); eq(Core.startProject(st, "world_tour"), "busyProject");
  var team = projectTeam(st, ["host", "comedy"], 4, 600);
  var bad = freshArtist(st); bad.dir = "film";
  eq(Core.assignStage(st, [team[0].id, team[1].id, team[2].id]), "slots", "企劃會議 1～2 人");
  eq(Core.assignStage(st, [bad.id]), "dir");
  eq(Core.assignStage(st, [team[0].id, team[1].id]), null);
  eq(team[0].task.kind, "project"); eq(Core.assignStage(st, [team[2].id]), "stageBusy");
  Core.advance(st, 6);
  eq(st.project.stage, 1); eq(st.project.results.length, 1); eq(team[0].task, null, "階段結束成員自由");
  for (var s = 1; s < 3; s++) {
    while (st.events.pending.length) Core.resolveEvent(st, st.events.pending[0].uid, D.EVENT_BY_ID[st.events.pending[0].id].defaultChoice);
    eq(Core.assignStage(st, [team[0].id, team[1].id, team[2].id]), null, "階段 " + s);
    Core.advance(st, D.PROJECT_BY_ID.own_variety.stages[s].days + (st.project ? st.project.extraDays : 0) + 7);
  }
  eq(st.project, null, "完成");
  eq(st.projectQueue.length, 1); eq(st.stats.projects, 1);
  var q = st.projectQueue[0];
  assert(["great", "success"].indexOf(q.result) >= 0, "能力 600 至少成功：" + q.result);
  assert(team[0].works.some(function (w) { return w.project === "own_variety"; }), "作品紀錄");
  eq(Core.jobTitle(team[0].works.filter(function (w) { return w.project; })[0], "zh"), "自家冠名綜藝");
  assert(st.timeline.some(function (x) { return x.kind === "project"; }), "年表");
  eq(Core.legacyPoints(st), 3, "傳承點 +3");
});

test("企劃：分歧事件影響下一階段、放棄不退款", function () {
  var st = Core.create({ seed: 2 });
  st.board = []; st.boardRefreshDay = 99999; st.company.level = 5; st.company.money = 1e7;
  Core.startProject(st, "world_tour");
  var team = projectTeam(st, ["singer", "idol"], 6, 300);   // 第 3 階段換一批人：前兩階段的人體力耗盡會強制休息
  Core.assignStage(st, [team[0].id, team[1].id]); Core.advance(st, 10);
  eq(st.project.stage, 1); eq(st.events.pending.length, 0, "排練沒有分歧");
  Core.assignStage(st, [team[0].id, team[1].id, team[2].id]); Core.advance(st, 15);
  var e = st.events.pending.filter(function (x) { return x.id === "proj_injury"; })[0];
  assert(e && e.ctx.project === "world_tour", "亞洲站後受傷事件");
  Core.resolveEvent(st, e.uid, 1);
  eq(st.project.extraDays, 7, "延期 7 天");
  eq(Core.assignStage(st, [team[3].id, team[4].id, team[5].id]), null);
  eq(team[3].task.days, 15 + 7, "下一階段天數 +7");
  var m0 = st.company.money; Core.abortProject(st);
  eq(st.project, null); eq(st.company.money, m0, "不退款"); eq(team[3].task, null, "成員解除行程");
});

test("存檔版本 5", function () {
  var st = Core.create({ seed: 1 }); st.version = 4; delete st.projectQueue;
  var m = Core.migrate(JSON.parse(JSON.stringify(st)));
  // 計畫 9 升到版本 6 後改成跟著 Core.VERSION（這個測試只關心 projectQueue 有沒有補上）
  eq(m.version, Core.VERSION); assert(Array.isArray(m.projectQueue));
});

test("成就 v2：企劃", function () {
  eq(Ach.all().filter(function (x) { return x.addedIn === "v2"; }).length, 2);
  var st = Core.create({ seed: 1 }); st.stats.projects = 1; st.board = []; st.boardRefreshDay = 99999;
  Core.advance(st, 1);
  assert(st.achievements.first_project && !st.achievements.great_project, "完成 1 件");
});

test("3D 規格：每個方向都有場景與動作、角色顏色與 2D 頭像一致", function () {
  D.DIRS.forEach(function (d) {
    assert(Spec.SCENES.indexOf(Spec.sceneFor(d.id)) >= 0, d.id + " 場景");
    assert(Spec.MOTIONS.indexOf(Spec.motionFor(d.id)) >= 0, d.id + " 動作");
  });
  var look = { face: 1, hair: 7, hairColor: 3, eye: 2, outfit: 5, acc: 1, skin: 2 };
  var r = Spec.rig(look, "f");
  eq(r.skin, D.LOOK.skins[2]); eq(r.hair, D.LOOK.hairColors[3]); eq(r.outfit, Avatar.OUTFITS[5]);
  eq(r.hairLen, 2); eq(r.bangs, 1); eq(r.acc, 1);
  assert(Spec.rig(null, "m").skin, "預設外觀");
});

test("3D 規格：站位、鏡頭腳本涵蓋整段、鏡頭座標有限", function () {
  for (var n = 1; n <= 5; n++) {
    var s = Spec.slots(n);
    eq(s.length, n); assert(Math.abs(s.reduce(function (a, b) { return a + b; }, 0)) < 1e-9, n + " 人左右對稱");
  }
  ["job", "project", "awards", "replay"].forEach(function (kind) {
    var p = Spec.plan({ dir: "singer", kind: kind, seed: 7 });
    assert(p.duration >= 8 && p.duration <= 25, kind + " 長度 " + p.duration);
    eq(p.shots[0].start, 0); eq(p.shots[p.shots.length - 1].end, p.duration);
    for (var i = 1; i < p.shots.length; i++) eq(p.shots[i].start, p.shots[i - 1].end, kind + " 首尾相接");
    p.shots.forEach(function (sh) {
      [0, 0.5, 1].forEach(function (u) {
        var c = Spec.camera(sh.kind, u, 0.5);
        c.pos.concat(c.look).forEach(function (v) { assert(isFinite(v), sh.kind + " 座標"); });
      });
    });
  });
  eq(Spec.plan({ dir: "film", kind: "awards" }).scene, "awards", "頒獎一律在頒獎會場");
  eq(Spec.plan({ dir: "model", kind: "job" }).motion, "walk");
});

test("企劃階段日誌帶成員與方向（3D 演出用）", function () {
  var st = Core.create({ seed: 2 });
  st.board = []; st.boardRefreshDay = 99999; st.company.level = 5; st.company.money = 1e7;
  Core.startProject(st, "own_variety");
  var team = projectTeam(st, ["host"], 1, 300);
  Core.assignStage(st, [team[0].id]); Core.advance(st, 6);
  var e = st.log.filter(function (x) { return x.type === "project_stage"; })[0];
  eq(e.data.members.join(","), team[0].id); eq(e.data.dir, "host");
});

test("成就：60 項、判定類型都存在、新類型可以達成", function () {
  eq(D.ACHIEVEMENTS.length, 60, "成就數");
  D.ACHIEVEMENTS.forEach(function (x) {
    assert(Core.ACH_TYPES.indexOf(x.cond.type) >= 0, x.id + " 類型不存在 " + x.cond.type);
    assert(x.name.zh && x.name.ja && x.desc.zh && x.desc.ja, x.id + " 文字");
    assert(x.reward.tickets > 0, x.id + " 獎勵");
  });
  var st = Core.create({ seed: 3 });
  st.board = []; st.boardRefreshDay = 99999;
  st.codex.stories = { ssr001: true }; st.rivalStory.stage = 5;
  freshArtist(st, { fame: 12000 });
  D.FACILITY_ORDER.forEach(function (f) { st.facilities[f] = D.FACILITIES[f].max; });
  Core.advance(st, 1);
  ["story_1", "rival_story_1", "rival_story_5", "fame_10k", "fac_max_1", "fac_max_all"].forEach(function (id) { assert(st.achievements[id], id + " 應該達成"); });
  assert(!st.achievements.rival_story_10 && !st.achievements.fame_50k && !st.achievements.story_6, "還沒到門檻的不會達成");
});

test("稱號：只能用已達成的成就、可以取消、新紀元保留", function () {
  var st = Core.create({ seed: 3 });
  eq(Core.setTitle(st, "first_pull"), "locked");
  st.achievements.first_pull = { day: 0, era: 1 };
  eq(Core.setTitle(st, "first_pull"), null); eq(st.title, "first_pull");
  st.company.level = 10;
  assert(!Core.newEra(st), "開新紀元");
  eq(st.era, 2); eq(st.title, "first_pull", "新紀元保留稱號");
  eq(Core.setTitle(st, null), null); eq(st.title, null);
});

test("特性：100 種、id 不重複、文字齊全、新效果鍵會作用", function () {
  eq(D.TRAITS.length, 100, "特性數");
  var seen = {};
  D.TRAITS.forEach(function (t) {
    assert(/^[a-z0-9_]+$/.test(t.id) && !seen[t.id], "特性 id " + t.id); seen[t.id] = 1;
    eq(D.TRAIT_BY_ID[t.id], t, t.id + " 索引");
    assert(t.name.zh && t.name.ja && t.desc.zh && t.desc.ja, t.id + " 文字");
    assert(Object.keys(t.fx).length >= 1, t.id + " 效果");
  });
  var st = Core.create({ seed: 4 });
  st.board = []; st.boardRefreshDay = 99999;
  // salary：月薪 ×v
  var a = freshArtist(st, { salary: 2000 }), b = freshArtist(st, { salary: 2000 });
  a.traits = ["t_frugal"]; Core._updateSalary(a); Core._updateSalary(b);
  assert(a.salary < b.salary, "salary 鍵：月薪較低 " + a.salary + " / " + b.salary);
  // growthStats：指定能力成長較快
  var g1 = freshArtist(st), g2 = freshArtist(st);
  g1.traits = ["t_vocal_gift"];
  Core._growStat(st, g1, "vocal", 10, "course"); Core._growStat(st, g2, "vocal", 10, "course");
  assert(g1.stats.vocal > g2.stats.vocal, "growthStats 鍵");
  // chem：組合默契加成
  st.groups = [{ id: "g1", name: "", members: [g1.id, g2.id], jobs: 50 }];
  var base = Core.chemistry(st, [g1.id, g2.id]);
  g1.traits = ["t_team_player"]; g2.traits = ["t_team_player"];
  assert(Core.chemistry(st, [g1.id, g2.id]) > base, "chem 鍵");
});

var EVENT_FX = "famePct stress satisfaction money rest mood specialJob fame stamina statAll rep stat salaryPct leave moneyBySalary allSatisfaction allStress tickets sellTop loan allSalaryPct rivalPower projectMod projectDays renew retire retain".split(" ");
var CAREER_ONLY = ["renew", "retire", "retain"];
// 用到哪些佔位（不計次數：zh 與 ja 的語序不同，出現次數可以不一樣）
function placeholders(s) { var u = {}; (s.match(/\{[a-z]+\}/g) || []).forEach(function (p) { u[p] = 1; }); return Object.keys(u).sort().join(","); }

test("事件 lint：格式、目標、佔位符、選項、fx 鍵、預設選項、標題不重複", function () {
  var ids = {}, titles = {};
  Events.all().forEach(function (ev) {
    var where = ev.id;
    assert(/^[a-z0-9_]+$/.test(ev.id), where + " id 格式");
    assert(!titles[ev.title.zh], where + " 標題重複：" + ev.title.zh + "（" + titles[ev.title.zh] + "）"); titles[ev.title.zh] = ev.id;
    assert(Events.CATS.indexOf(ev.category) >= 0, where + " 類別");
    assert(ev.trigger === "random" || ev.trigger === "cond", where + " trigger");
    assert(ev.weight > 0, where + " weight");
    assert(Core.EVENT_TARGETS.indexOf(ev.target) >= 0, where + " target " + ev.target);
    assert(ev.title.zh && ev.title.ja && ev.text.zh && ev.text.ja, where + " 文字");
    var ph = placeholders(ev.text.zh);
    eq(placeholders(ev.text.ja), ph, where + " zh/ja 佔位不一致");
    (ph ? ph.split(",") : []).forEach(function (p) { assert(["{name}", "{n}", "{rival}", "{star}"].indexOf(p) >= 0, where + " 不明佔位 " + p); });
    if (ev.target === "none") assert(ph.indexOf("{name}") < 0, where + " target none 不能用 {name}");
    if (ev.trigger === "random" && ph.indexOf("{rival}") >= 0) assert(ev.rival, where + " 用 {rival} 要 rival: true");
    if (ev.trigger === "random" && ph.indexOf("{star}") >= 0) assert(ev.rival && ev.needStar, where + " 用 {star} 要 needStar: true");
    assert(ev.choices.length >= 2 && ev.choices.length <= 3, where + " 選項數 " + ev.choices.length);
    ev.choices.forEach(function (c, i) {
      assert(c.label.zh && c.label.ja && c.hint.zh && c.hint.ja, where + " 選項 " + i + " 文字");
      assert(c.outcomes.length >= 1, where + " 選項 " + i + " 沒有結果");
      c.outcomes.forEach(function (o) {
        assert(o.w > 0, where + " 權重");
        Object.keys(o.fx).forEach(function (k) {
          assert(EVENT_FX.indexOf(k) >= 0, where + " fx 不支援 " + k);
          if (CAREER_ONLY.indexOf(k) >= 0) assert(ev.id === "contract_renewal" || ev.id === "retire_offer", where + " 生涯專用 fx " + k);
          if (k === "projectMod" || k === "projectDays") assert(ev.trigger === "cond", where + " 企劃 fx 只能在 cond 事件");
          if (k === "stat") Object.keys(o.fx.stat).forEach(function (s) { assert(D.STATS.indexOf(s) >= 0, where + " stat 鍵 " + s); });
        });
      });
    });
    assert(ev.choices[ev.defaultChoice], where + " defaultChoice");
  });
});

test("大型企劃：30 件、階段格式、分歧事件存在、解鎖等級與費用範圍", function () {
  eq(D.PROJECTS.length, 30, "企劃數");
  var titles = {};
  D.PROJECTS.forEach(function (p) {
    assert(/^[a-z0-9_]+$/.test(p.id), p.id + " id");
    assert(!titles[p.name.zh], p.id + " 名稱重複"); titles[p.name.zh] = 1;
    assert(p.name.zh && p.name.ja && p.desc.zh && p.desc.ja, p.id + " 文字");
    assert(p.unlockLevel >= 3 && p.unlockLevel <= 10, p.id + " 解鎖等級 " + p.unlockLevel);
    assert(p.cost >= 100000 && p.cost <= 2000000, p.id + " 費用 " + p.cost);
    assert(p.stages.length >= 2 && p.stages.length <= 5, p.id + " 階段數");
    p.stages.forEach(function (s, i) {
      var w = p.id + " 階段 " + i;
      assert(s.name.zh && s.name.ja, w + " 名稱");
      assert(s.dirs.length >= 1 && s.dirs.every(function (d) { return D.DIR_BY_ID[d]; }), w + " 方向");
      assert(s.slots[0] >= 1 && s.slots[0] <= s.slots[1] && s.slots[1] <= 5, w + " 人數");
      assert(D.TIER_ORDER.indexOf(s.tier) >= 0, w + " 等級 " + s.tier);
      assert(s.days >= 3 && s.days <= 30, w + " 天數");
      if (s.branch) { var ev = D.EVENT_BY_ID[s.branch]; assert(ev && ev.trigger === "cond", w + " 分歧事件 " + s.branch); }
    });
  });
  var levels = {};
  D.PROJECTS.forEach(function (p) { levels[p.unlockLevel] = (levels[p.unlockLevel] || 0) + 1; });
  assert(Object.keys(levels).length >= 6, "解鎖等級分散在 6 個以上的等級");
});

// ==== 雲端存檔（計畫 8） ====
// 假的 PriTestGameStorage：所有裝置共用同一個記憶體資料庫；寫入與通知都是非同步（跟 Firebase 一樣）；
// setOnline(false) 時 rtSet 的 Promise 不會完成，恢復連線才一起寫入（模擬 Firebase SDK 的離線佇列）
function fakeCloud() {
  var db = {}, subs = [], clock = { t: 1e12 }, online = true, queued = [];
  function key(id, sub) { return id + "/" + sub; }
  function copy(v) { return v == null ? null : JSON.parse(JSON.stringify(v)); }
  function notify(k) { subs.slice().forEach(function (s) { if (s.k === k) s.fn(copy(db[k])); }); }
  var gs = {
    generateCloudGameId: function () { return "g0123456789abcdef0123456789abcdef"; },
    serverNow: function () { return clock.t; },
    serverTimeOffset: function () { return 0; },
    rtSet: function (id, mode, sub, v) {
      var k = key(id, sub);
      function apply() { db[k] = copy(v); notify(k); }
      if (!online) return new Promise(function (res) { queued.push(function () { apply(); res(); }); });
      return Promise.resolve().then(apply);
    },
    rtSubscribe: function (id, mode, sub, fn) {
      var s = { k: key(id, sub), fn: fn };
      subs.push(s);
      Promise.resolve().then(function () { if (subs.indexOf(s) >= 0) fn(copy(db[s.k])); });
      return function () { var i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); };
    },
    rtTransaction: function (id, mode, sub, fn) {
      var k = key(id, sub);
      return Promise.resolve().then(function () {
        var nv = fn(copy(db[k]));
        if (nv === undefined) return null;
        db[k] = copy(nv); notify(k);
        return copy(nv);
      });
    }
  };
  return {
    gs: gs, db: db, clock: clock,
    setOnline: function (b) { online = b; if (b) queued.splice(0).forEach(function (f) { f(); }); }
  };
}
function fakeApp(st) {
  var a = { s: st, ro: false, adopted: 0, t: 1e12 };
  return { st: function () { return a.s; }, now: function () { return a.t; }, adopt: function (n) { a.s = n; a.adopted++; },
    setReadOnly: function (b) { a.ro = b; }, _a: a };
}
function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

test("雲端：純函式（ID、封包時間換算、搶占、判斷、重要標記、連結）", function () {
  assert(Cloud.validId("g0123456789abcdef0123456789abcdef"), "合法 ID");
  assert(!Cloud.validId("gABC") && !Cloud.validId(null) && !Cloud.validId("g0123456789abcdef0123456789abcdeF"), "不合法 ID");

  var st = Core.create({ seed: 3, now: 1000, name: "雲端社" });
  st.lastTickAt = 5000;
  var env = Cloud.envelope(st, "dA", 6000, 106000);
  eq(env.savedAt, 106000); eq(env.deviceId, "dA"); eq(env.tickAt, 105000, "lastTickAt 換成伺服器時間");
  eq(env.name, "雲端社"); eq(env.day, st.day); eq(typeof env.data, "string");
  var back = Cloud.unpack(env, 2000, 106000);
  eq(back.lastTickAt, 1000, "換回本機時間（伺服器 105000 − 106000 + 本機 2000）");
  eq(back.company.name, "雲端社"); assert(Array.isArray(back.artists));
  eq(Cloud.unpack(env, 2000, 100000).lastTickAt, 2000, "不會換算到本機的未來");
  var threw = false;
  try { Cloud.unpack({ data: "{}" }, 0, 0); } catch (e) { threw = true; }
  assert(threw, "格式不正確要 throw");

  eq(Cloud.claimUpdate(null, "dA", 5, false).deviceId, "dA");
  eq(Cloud.claimUpdate({ deviceId: "dA" }, "dA", 5, false).since, 5);
  eq(Cloud.claimUpdate({ deviceId: "dB" }, "dA", 5, false), undefined, "別台進行中時不搶");
  eq(Cloud.claimUpdate({ deviceId: "dB" }, "dA", 5, true).deviceId, "dA", "強制接回");

  eq(Cloud.decide({ active: { deviceId: "dB" }, remote: null, deviceId: "dA", lastSync: 0 }), "locked");
  eq(Cloud.decide({ active: null, remote: { deviceId: "dB", savedAt: 10 }, deviceId: "dA", lastSync: 5 }), "adopt");
  eq(Cloud.decide({ active: { deviceId: "dA" }, remote: { deviceId: "dB", savedAt: 4 }, deviceId: "dA", lastSync: 5 }), "upload", "雲端比較舊");
  eq(Cloud.decide({ active: null, remote: { deviceId: "dA", savedAt: 10 }, deviceId: "dA", lastSync: 5 }), "upload", "雲端是自己傳的");
  eq(Cloud.decide({ active: null, remote: null, deviceId: "dA", lastSync: 0 }), "upload");

  var m0 = Cloud.marks(st);
  st.stats.pulls += 10; var m1 = Cloud.marks(st);
  assert(m1 !== m0, "抽卡改變標記");
  st.awards.history.unshift({ year: 3, results: [] }); var m2 = Cloud.marks(st);
  assert(m2 !== m1, "頒獎改變標記");
  st.era++; assert(Cloud.marks(st) !== m2, "新紀元改變標記");
  st.company.money += 5; eq(Cloud.marks(st), Cloud.marks(st), "金錢不影響標記");

  eq(Cloud.linkFor("https://x.example/starv/index.html?debug=1#top", "gabc"), "https://x.example/starv/index.html?cloud=gabc");
  eq(Cloud.idFromSearch("?debug=1&cloud=gabc"), "gabc");
  eq(Cloud.idFromSearch("?debug=1"), null);
  eq(Cloud.stripCloudParam("?cloud=gabc&debug=1"), "?debug=1");
  eq(Cloud.stripCloudParam("?debug=1&cloud=gabc"), "?debug=1");
  eq(Cloud.stripCloudParam("?cloud=gabc"), "");
});

test("雲端：啟用 → 另一台連線 → 原裝置轉唯讀 → 接回時採用對方進度", async function () {
  var fc = fakeCloud();
  var sA = fakeStorage(), sB = fakeStorage();
  var appA = fakeApp(Core.create({ seed: 4, now: 1e12, name: "甲社" })), appB = fakeApp(null);
  var A = Cloud.create({ gs: fc.gs, storage: sA, app: appA });
  var B = Cloud.create({ gs: fc.gs, storage: sB, app: appB });
  assert(A.deviceId() !== B.deviceId(), "裝置 ID 不同");
  eq(A.deviceId(), Cloud.create({ gs: fc.gs, storage: sA, app: appA }).deviceId(), "同一台裝置 ID 不變");

  var id = await A.enable();
  assert(Cloud.validId(id), "產生存檔 ID");
  await flush();
  eq(fc.db[id + "/starv/activeDevice"].deviceId, A.deviceId(), "activeDevice＝A");
  eq(fc.db[id + "/starv/save"].name, "甲社", "已上傳");
  eq(JSON.parse(sA.getItem(Cloud.CFG_KEY)).id, id, "本機記住存檔 ID");
  eq(A.info().enabled, true); eq(A.info().pending, false);

  eq(await B.preview("bad"), null, "不合法 ID");
  var env = await B.preview(id);
  eq(env.name, "甲社");
  fc.clock.t += 60000; appB._a.t += 60000;
  assert(await B.connect(id, env), "B 接回");
  await flush();
  eq(appB.st().company.name, "甲社"); eq(appB._a.adopted, 1);
  assert(appA._a.ro && A.info().locked, "A 轉唯讀");
  eq(await A.upload(), false, "唯讀時不上傳");

  appB.st().company.money = 777777;
  fc.clock.t += 1000; appB._a.t += 1000;
  assert(await B.upload(), "B 上傳");
  fc.clock.t += 1000; appA._a.t += 62000;
  assert(await A.takeover(), "A 在此裝置繼續");
  await flush();
  eq(appA.st().company.money, 777777, "A 採用 B 的進度");
  assert(!appA._a.ro && !A.info().locked, "A 解除唯讀");
  assert(appB._a.ro && B.info().locked, "B 轉唯讀");
});

test("雲端：重新開啟時依 activeDevice 與存檔決定、重要時點立即上傳、斷線補傳、停用", async function () {
  var fc = fakeCloud();
  var sA = fakeStorage(), sB = fakeStorage();
  var appA = fakeApp(Core.create({ seed: 5, now: 1e12, name: "乙社" })), appB = fakeApp(null);
  var A = Cloud.create({ gs: fc.gs, storage: sA, app: appA });
  var B = Cloud.create({ gs: fc.gs, storage: sB, app: appB });
  var id = await A.enable();
  fc.clock.t += 1000;
  assert(await B.connect(id, await B.preview(id)));
  appB.st().company.money = 424242;
  fc.clock.t += 1000;
  await B.upload();
  await flush();

  // A 重新開啟頁面：B 還在進行中 → 唯讀
  var appA2 = fakeApp(Core.create({ seed: 5, now: 1e12, name: "乙社" }));
  var A2 = Cloud.create({ gs: fc.gs, storage: sA, app: appA2 });
  eq(await A2.attach(), "locked"); assert(appA2._a.ro, "A2 唯讀");

  // B 已經不在（activeDevice 被清掉）：A 重新開啟時採用 B 比較新的存檔並成為進行中裝置
  fc.db[id + "/starv/activeDevice"] = null;
  var appA3 = fakeApp(Core.create({ seed: 5, now: 1e12, name: "乙社" }));
  var A3 = Cloud.create({ gs: fc.gs, storage: sA, app: appA3 });
  eq(await A3.attach(), "adopt");
  await flush();
  eq(appA3.st().company.money, 424242, "採用 B 的存檔");
  eq(fc.db[id + "/starv/activeDevice"].deviceId, A3.deviceId());

  // 重要時點：抽卡後 changed() 立即上傳；只有金錢變化不上傳
  appA3.st().stats.pulls += 10;
  A3.changed();
  await flush();
  eq(JSON.parse(fc.db[id + "/starv/save"].data).stats.pulls, appA3.st().stats.pulls, "抽卡後上傳");
  appA3.st().company.money = 1;
  A3.changed();
  await flush();
  assert(JSON.parse(fc.db[id + "/starv/save"].data).company.money !== 1, "金錢變化不算重要時點");

  // 斷線：上傳暫存為 pending，恢復後補傳
  fc.setOnline(false);
  A3.upload();
  await flush();
  assert(A3.info().pending, "斷線時 pending");
  assert(JSON.parse(sA.getItem(Cloud.CFG_KEY)).pending, "pending 寫在本機（重新整理後也記得）");
  fc.setOnline(true);
  await flush();
  assert(!A3.info().pending, "恢復後補傳完成");
  eq(JSON.parse(fc.db[id + "/starv/save"].data).company.money, 1);

  // 自己是進行中裝置時重新開啟 → 直接上傳
  var A4 = Cloud.create({ gs: fc.gs, storage: sA, app: appA3 });
  eq(await A4.attach(), "upload");

  A4.disable();
  eq(sA.getItem(Cloud.CFG_KEY), null, "停用後忘記存檔 ID");
  eq(A4.info().enabled, false);
  eq(await A4.attach(), "off");
});

// ==== run ====
// 雲端存檔的測試回傳 Promise（假的 GameStorage 是非同步的），所以依序 await
(async function () {
  var fails = 0;
  for (var i = 0; i < tests.length; i++) {
    try { await tests[i][1](); console.log("ok   " + tests[i][0]); }
    catch (e) { fails++; console.log("FAIL " + tests[i][0] + "：" + e.message); }
  }
  console.log(fails ? fails + " 個失敗" : "全部 " + tests.length + " 個通過");
  process.exit(fails ? 1 : 0);
})();
