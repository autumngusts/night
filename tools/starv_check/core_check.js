// 明星經紀 starV 核心引擎的單元測試（node 直接跑，不需要瀏覽器）：
//   node tools/starv_check/core_check.js
"use strict";

global.window = global;
require("../../static_src/starv_data.js");
require("../../static_src/starv_events.js");
require("../../static_src/starv_events_1.js");
var Events = global.PriTestStarvEvents;
require("../../static_src/starv_roster.js");
require("../../static_src/starv_roster_1.js");
var D = global.PriTestStarvData;
var Roster = global.PriTestStarvRoster;
require("../../static_src/starv_core.js");
var Core = global.PriTestStarvCore;
require("../../static_src/starv_store.js");
var Store = global.PriTestStarvStore;
require("../../static_src/starv_avatar.js");
var Avatar = global.PriTestStarvAvatar;
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
  j.minFame = 0; j.minProf = 1; j.isWork = false;
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
  eq(Core.facilityCost(st, "dorm"), 30000, "宿舍 Lv1→2"); eq(Core.facilityCost(st, "practice"), 40000, "練習室 Lv0→1");
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
  eq(m.version, 2); assert(m.trend && m.trend.cur.hot.length >= 2 && m.trend.next, "補上 trend");
});

test("事件資料：40 種、格式正確", function () {
  var FX = ["money", "tickets", "rep", "loan", "sellTop", "fame", "famePct", "stress", "stamina", "satisfaction", "mood", "salaryPct",
    "statAll", "stat", "rest", "specialJob", "leave", "moneyBySalary", "allStress", "allSatisfaction", "allSalaryPct"];
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

// ==== run ====
var fails = 0;
tests.forEach(function (t) {
  try { t[1](); console.log("ok   " + t[0]); }
  catch (e) { fails++; console.log("FAIL " + t[0] + "：" + e.message); }
});
console.log(fails ? fails + " 個失敗" : "全部 " + tests.length + " 個通過");
process.exit(fails ? 1 : 0);
