// ============================================================================
// 深夜居酒屋（izakaya）核心功能檢查（不開瀏覽器，直接用 Node 載入 static_src）。
// 執行：node tools/izakaya_check/core_check.js
// 每個 Task 往下追加一段（資料、名單、日循環、客人推理、口碑、劇情、戀愛、店員、尖峰、意圖）。
// ============================================================================
"use strict";
var fs = require("fs"), path = require("path"), assert = require("assert");
global.window = global;
global.I18N = { getLang: function () { return "zh"; }, t: function (k) { return k; } };
var SRC = path.join(__dirname, "..", "..", "static_src");
["gousei_data_food.js", "izakaya_data.js", "izakaya_cast.js", "izakaya_chatter.js", "izakaya_story.js", "izakaya_story_main.js", "izakaya_story_arcs.js",
 "izakaya_story_staff.js", "izakaya_story_main2.js", "izakaya_story_arcs2.js", "izakaya_story_staff2.js", "izakaya_story_heart.js", "izakaya_story_truth.js", "izakaya_story_deep.js", "izakaya_story_deep_staff.js", "izakaya_story_daily.js", "izakaya_story_e.js", "izakaya_story_g.js", "izakaya_story_heart2.js", "izakaya_rush.js", "izakaya_core.js"].forEach(function (f) {
  eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8"));
});
var D = window.PriTestIzakayaData;

// ---------------- 1. 資料完整性 ----------------
(function () {
  var dishes = Object.keys(D.DISHES), food = dishes.filter(function (k) { return D.DISHES[k].cat !== "drink"; });
  var drinks = dishes.filter(function (k) { return D.DISHES[k].cat === "drink"; });
  assert.ok(food.length >= 48 && food.length <= 55, "料理約 50 道：" + food.length);
  assert.strictEqual(drinks.length, 20, "酒飲 20 種");
  var sig = {};
  dishes.forEach(function (k) {
    var d = D.DISHES[k];
    Object.keys(d.ing).forEach(function (i) { assert.ok(D.INGS[i], k + " 的食材不存在：" + i); });
    assert.strictEqual(d.f.length, 5, k + " 的口味向量要 5 維");
    d.tags.forEach(function (t) { assert.ok(D.TAGS.indexOf(t) >= 0, k + " 的標籤不合法：" + t); });
    assert.ok(["grill", "fry", "pot", "cold", "bar"].indexOf(d.st) >= 0, k + " 的工作站不合法");
    assert.ok(d.price > 0 && d.cook > 0, k + " 價格與烹調時間要大於 0");
    if (d.cat !== "drink") {
      // 研發用（食材集合＋手法）找菜：同一組合只能對到一道菜
      var key = Object.keys(d.ing).sort().join("+") + "@" + d.m;
      assert.ok(!sig[key], "研發組合重複：" + k + " 與 " + sig[key]);
      sig[key] = k;
    }
  });
  assert.ok(food.filter(function (k) { return D.DISHES[k].unlock === "start"; }).length >= 15, "開局料理至少 15 道");
  assert.ok(drinks.filter(function (k) { return D.DISHES[k].unlock === "start"; }).length >= 8, "開局酒飲至少 8 種");
  assert.strictEqual(D.SPOTS.length, 12, "1b 約會地點 12 個");
  D.SPOTS.forEach(function (sp) { assert.strictEqual(sp.rounds.length, 3, sp.id + " 3 輪"); assert.ok(sp.heart, sp.id + " 要有通用心動描寫"); });
  assert.strictEqual(D.STAR_REP.length, 5);
  console.log("1. 資料完整性 OK（料理 " + food.length + "、酒飲 " + drinks.length + "）");
})();

// ---------------- 2. 角色名單 ----------------
(function () {
  var Cast = window.PriTestIzakayaCast;
  // 1b 常客 12 人＋批次 B 的隱藏常客「夜」（第 2 年起出現）
  assert.strictEqual(Cast.REGULARS.filter(function (c) { return !c.run; }).length, 24, "常客 24 人（規格第 3 期）");
  assert.ok(Cast.byId("yoru").run === 1 && Cast.byId("yoru").noLove, "隱藏常客：第 2 年起出現、不能約會");
  assert.strictEqual(Cast.STAFF.length, 30, "1b 店員 30 人");
  assert.strictEqual(Cast.ALL_PHOTOS.length, 191, "照片 191 張");
  Cast.ALL_PHOTOS.forEach(function (p) { assert.ok(fs.existsSync(path.join(SRC, "images", "jikan", p + ".webp")), "照片不存在：" + p); });
  var ids = {};
  Cast.REGULARS.concat(Cast.STAFF).forEach(function (c) {
    assert.ok(!ids[c.id], "角色 id 重複：" + c.id); ids[c.id] = 1;
    assert.ok(c.photo === undefined, c.id + " 不可寫死照片（每局輪換）");
    assert.ok(c.age >= 20, c.id + " 必須成年");
    assert.strictEqual(c.pref.length, 5);
    assert.strictEqual(c.likes.length, 2);
    c.likes.forEach(function (t) { assert.ok(D.LIKE_TAGS.indexOf(t) >= 0, c.id + " 的 likes 不合法：" + t); });
    assert.ok(D.SPOTS.some(function (s) { return s.id === c.favSpot; }), c.id + " 的 favSpot 不存在");
    ["confess", "propose", "wedding", "heart"].forEach(function (k) { assert.ok(c.lines[k], c.id + " 缺台詞 " + k); });
  });
  Cast.STAFF.forEach(function (c) { assert.ok(["fast", "memo", "bar", "host"].indexOf(c.ability) >= 0 && c.wage > 0, c.id + " 店員能力／薪水"); });
  // 照片輪換：同一局內不重複；不同種子的分配不同；同一種子結果相同
  function rng(seed) { return function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }
  var a = Cast.assignPhotos(rng(7)), b = Cast.assignPhotos(rng(8)), a2 = Cast.assignPhotos(rng(7));
  var used = Object.keys(a.photos).map(function (k) { return a.photos[k]; });
  assert.strictEqual(used.length, 55); assert.strictEqual(new Set(used.concat(a.rest)).size, 191, "同一局內不重複");
  assert.notDeepStrictEqual(a.photos, b.photos, "不同局要輪換");
  assert.deepStrictEqual(a.photos, a2.photos, "同一種子同一結果");
  var pool = Cast.genPool(rng(9), 60, a.rest);
  assert.strictEqual(pool.length, 60);
  pool.forEach(function (g) { assert.ok(a.rest.indexOf(g.photo) >= 0, "一般客只用剩下的照片：" + g.photo); });
  console.log("2. 角色名單 OK");
})();

// ---------------- 3. 新局、日曆、市場、冰箱、菜單、研發、存檔 ----------------
var Core = window.PriTestIzakayaCore;
function game(np, seed) {
  var ps = []; for (var i = 0; i < np; i++) ps.push({ pid: "p" + i, name: "P" + i, want: ["hall", "chef", "bar", "buyer"][i] });
  return Core.newGame({ seed: seed || 12345, players: ps });
}
(function () {
  var s = game(1);
  assert.strictEqual(s.phase, "market"); assert.strictEqual(s.day, 1); assert.strictEqual(s.cash, D.START_CASH);
  assert.deepStrictEqual(s.roles.p0.slice().sort(), ["bar", "buyer", "chef", "hall"], "單機一人兼四職");
  var r2 = Core.assignRoles([{ pid: "a", want: "chef" }, { pid: "b", want: "chef" }]);
  var all = r2.a.concat(r2.b).sort();
  assert.deepStrictEqual(all, ["bar", "buyer", "chef", "hall"], "兩人分完四職、不重複");
  assert.ok(r2.a.indexOf("chef") >= 0, "先選的人拿到想要的職位");
  // 日曆：dow 5、6 是尖峰日；季節分段
  assert.strictEqual(Core.dowOf(5), 5); assert.ok(Core.isRushDay(5) && Core.isRushDay(6) && !Core.isRushDay(7));
  assert.strictEqual(Core.seasonOf(8), 0); assert.strictEqual(Core.seasonOf(9), 1); assert.strictEqual(Core.seasonOf(30), 3);
  // 市場：每種食材都有價格；當令便宜（同一天比較基準價比例）
  Object.keys(D.INGS).forEach(function (k) { assert.ok(s.mk[k] > 0, "價格：" + k); });
  // 買：扣錢、放冰箱、到期日＝今天＋新鮮天數；超過容量不能買
  var cash = s.cash;
  assert.ok(Core.buy(s, "chicken", 3));
  assert.strictEqual(s.cash, cash - s.mk.chicken * 3);
  assert.deepStrictEqual(s.fridge.chicken, [1 + D.INGS.chicken.fresh, 1 + D.INGS.chicken.fresh, 1 + D.INGS.chicken.fresh]);
  assert.ok(!Core.buy(s, "rice", D.FRIDGE_CAP), "超過冰箱容量");
  // 過期：第 4 天開市場時雞肉（2 天）已丟掉
  s.day = 4; Core.startMarket(s);
  assert.strictEqual(Core.stock(s, "chicken"), 0, "過期丟棄");
  // 菜單：只能放已解鎖的、最多 8 道
  assert.ok(!Core.setBoard(s, ["gyukushi"]), "未解鎖不能上黑板");
  assert.ok(Core.setBoard(s, ["negima", "karaage", "oden"]));
  assert.ok(!Core.setBoard(s, Object.keys(s.known).slice(0, 9)), "最多 8 道");
  // 備料：只有 prep 菜，用掉食材得到 3 份
  Core.buy(s, "daikon", 1); Core.buy(s, "egg", 1); Core.buy(s, "konnyaku", 1);
  assert.ok(!Core.prep(s, "karaage"), "炸雞不能備料");
  assert.ok(Core.prep(s, "oden")); assert.strictEqual(s.prepped.oden, D.PREP_PORTIONS);
  assert.strictEqual(Core.stock(s, "daikon"), 0);
  // 研發：食材集合＋手法對到菜就解鎖；對不到浪費食材
  Core.buy(s, "beef", 2);
  var r = Core.dev(s, ["beef"], "age"); assert.ok(!r.ok, "牛肉＋炸 沒有這道"); assert.strictEqual(Core.stock(s, "beef"), 1, "失敗也用掉");
  r = Core.dev(s, ["beef"], "yaki"); assert.ok(r.ok && r.id === "gyukushi" && s.known.gyukushi, "牛肉＋烤＝牛肉串");
  Core.buy(s, "sake", 1);
  assert.ok(Core.devDrink(s, "sake_hiya") && s.known.sake_hiya, "調飲研發");
  // 照片：每局輪換（換種子分配就不同）、常客都有照片
  var other = game(1, 54321);
  assert.ok(s.photos.mio && other.photos.mio, "常客有照片");
  assert.notDeepStrictEqual(s.photos, other.photos, "不同局照片輪換");
  assert.strictEqual(Core.photoOf(s, "mio"), s.photos.mio); assert.strictEqual(Core.photoOf(s, s.pool[0].id), s.pool[0].photo);
  // 存檔來回
  var back = Core.restore(Core.serialize(s));
  assert.deepStrictEqual(back, s, "JSON 來回不變");
  assert.strictEqual(Core.restore("{\"v\":99}"), null, "版本不符");
  console.log("3. 新局／市場／冰箱／菜單／研發／存檔 OK");
})();

// ---------------- 4. 營業：客人、對話、點單、評分、推理、結帳、口碑、日推進 ----------------
function stockUp(s) { Object.keys(D.INGS).forEach(function (k) { s.fridge[k] = [99, 99, 99, 99, 99, 99, 99, 99]; }); }
(function () {
  var s = game(1, 777); stockUp(s);
  Core.setBoard(s, ["negima", "karaage", "hiyayakko", "maguro_sashi", "oden", "nama", "oolong", "umeshu_rock"]);
  Core.openService(s);
  assert.strictEqual(s.phase, "service");
  // 一般客 4+2 組；常客另外加入（不佔名額，最多 REG_PER_NIGHT 組）——2026-11-09 改規格：原本常客佔總組數
  assert.strictEqual(s.night.groups.filter(function (g) { return g.kind === "walk"; }).length, D.BASE_GROUPS + 2, "★1：一般客 4+2 組");
  assert.ok(s.night.groups.filter(function (g) { return g.kind === "reg"; }).length <= D.REG_PER_NIGHT, "常客上限");
  var g = Core.curGroup(s), guest = Core.guestOf(s, g);
  if (g.step === "story") { g.step = "talk"; }
  // 話題：選到喜歡的 +10、筆記記成確定
  var fav = g.topics.indexOf(guest.topic);
  var before = g.sat;
  if (fav >= 0) { Core.talk(s, fav); assert.strictEqual(g.sat, before + 10); assert.strictEqual(s.notes[g.gid].topic, "c"); }
  else { Core.talk(s, 0); assert.strictEqual(g.sat, before); }
  assert.strictEqual(g.step, "order");
  // 評分公式：用固定的客人直接算
  var fake = { pref: [2, 0, 0, -2, 0], taboo: "raw", drink: 1, topic: "work" };
  var sc = Core.scoreDish(s, fake, "karaage", { want: ["salty"], avoid: ["light"] });
  // karaage f=[2,0,2,0,0] → 2*2*6=24，符合 want salty 且 light=0 → +8 → 32 夾到 30
  assert.strictEqual(sc.delta, 30);
  assert.strictEqual(sc.clue.d, "salty"); assert.strictEqual(sc.clue.lv, "s");
  var sc2 = Core.scoreDish(s, fake, "maguro_sashi", null);
  assert.strictEqual(sc2.delta, -40); assert.ok(sc2.taboo);
  // 上菜 → 喝飲料 → 結帳；推理筆記不會被推測覆蓋確定
  var cash = s.cash, rep = s.rep;
  var r1 = Core.serve(s, "karaage"); assert.ok(r1.ok); assert.strictEqual(g.step, "drink");
  var r2 = Core.serve(s, guest.drink === 0 ? "oolong" : "nama"); assert.ok(r2.ok);
  assert.strictEqual(g.step, "done"); assert.ok(s.cash > cash, "結帳收錢");
  assert.strictEqual(s.night.i, 1, "換下一組");
  Core.note(s, "x", { k: "pref", d: "sweet", v: 1, lv: "c" });
  Core.note(s, "x", { k: "pref", d: "sweet", v: -1, lv: "s" });
  assert.deepStrictEqual(s.notes.x.pref.sweet, { v: 1, lv: "c" }, "確定不被推測覆蓋");
  // 星級：只升不降、記錄解鎖
  // 門檻從資料讀（數值由 sim.js 調整過，不硬編）
  var R = D.STAR_REP;
  assert.strictEqual(Core.starOf(0), 1); assert.strictEqual(Core.starOf(R[1]), 2); assert.strictEqual(Core.starOf(R[4] - 1), 4); assert.strictEqual(Core.starOf(R[4]), 5);
  s.rep = R[2]; s.night.i = s.night.groups.length; Core.closeService(s);
  assert.strictEqual(s.phase, "close"); assert.strictEqual(s.maxStar, 3); assert.strictEqual(s.today.unlock, 3);
  s.rep = 0; s.night = { groups: [], i: 0 }; Core.closeService(s);
  assert.strictEqual(s.star, 1); assert.strictEqual(s.maxStar, 3, "最高星級不回收");
  // 日推進：第 6 天打烊後進公休日；公休後第 7 天；第 30 天後結束
  s.day = 6; Core.nextDay(s); assert.strictEqual(s.phase, "holiday"); assert.strictEqual(s.day, 6);
  Core.afterHoliday(s); assert.strictEqual(s.day, 7); assert.strictEqual(s.phase, "market");
  s.day = 30; s.phase = "close"; Core.nextDay(s); assert.strictEqual(s.phase, "end"); assert.ok(s.end);
  console.log("4. 營業／推理／口碑／日推進 OK");
})();

// ---------------- 5. 劇情引擎 ----------------
(function () {
  var St = window.PriTestIzakayaStory;
  // 正式劇情（Task 11）加入後會跟測試場景搶觸發：測試期間先把正式場景移開，結束再放回
  var saved = window.PriTestIzakayaScenes.splice(0);
  window.PriTestIzakayaScenes.push(
    { id: "t_a", who: ["mio"], at: "visit", cond: { day: [1, 5] }, lines: [["mio", "測試"]], ch: [{ t: "甲", fx: { aff: { mio: 5 }, flag: ["fa"] } }, { t: "乙", fx: { flag: ["fb"] } }] },
    { id: "t_b", who: ["mio"], at: "visit", pri: 5, cond: { seen: ["t_a"], present: ["mio", "chinatsu"] }, lines: [["", "旁白"]], next: "t_c", ch: [{ t: "好", fx: { link: [["mio", "chinatsu", "ex_band"]], arc: { band: 1 } } }] },
    { id: "t_c", who: ["mio"], at: "visit", cond: { flag: ["never"] }, lines: [["mio", "接續"]] },
    { id: "t_d", who: ["mio"], at: "date", priv: true, cond: { spot: "yakei" }, lines: [["mio", "約會"]], ch: [{ t: "心動", fx: { aff: { mio: 8 } } }] }
  );
  var s = game(2, 99);
  assert.strictEqual(St.eligible(s, { at: "visit", who: "mio", present: ["mio"] }).id, "t_a");
  assert.strictEqual(St.eligible(s, { at: "close", who: "mio" }), null, "at 不符");
  s.day = 9; assert.strictEqual(St.eligible(s, { at: "visit", who: "mio", present: ["mio"] }), null, "日期範圍外");
  s.day = 2;
  St.begin(s, "t_a", null);
  assert.ok(St.choose(s, "p0", 0)); assert.ok(s.story.cur, "兩人只投一票還沒決定");
  assert.ok(!St.force(s, "p1"), "不是房主不能強制決定");
  St.choose(s, "p1", 1);   // 平手 → 取房主（p0）的票
  assert.ok(s.story.seen.t_a && s.story.flags.fa && !s.story.flags.fb, "平手取房主");
  // 選項 +5，加上「看完一段劇情主角好感 +2」（2026-11-09 新規則）＝ 7
  assert.strictEqual(s.players.p0.aff.mio, 7); assert.strictEqual(s.players.p1.aff.mio, 7, "非私密場景好感加給所有人");
  assert.strictEqual(St.eligible(s, { at: "visit", who: "mio", present: ["mio"] }), null, "缺 present");
  var sc = St.eligible(s, { at: "visit", who: "mio", present: ["mio", "chinatsu"] });
  assert.strictEqual(sc.id, "t_b");
  St.begin(s, "t_b", null); St.choose(s, "p0", 0); St.force(s, "p0");
  assert.strictEqual(s.story.links["chinatsu|mio"], "ex_band", "關係線（id 依字母排序）");
  assert.strictEqual(s.story.arcs.band, 1);
  assert.strictEqual(s.story.cur.id, "t_c", "next 直接接續（不檢查條件）");
  St.choose(s, "p0", 0); St.force(s, "p0");
  assert.strictEqual(s.story.cur, null);
  // 私密：只有本人能投、好感只加本人
  St.begin(s, "t_d", "p1");
  assert.ok(!St.choose(s, "p0", 0), "別人不能投私密場景");
  St.choose(s, "p1", 0);
  // t_b、t_c 各 +2（兩人）→ 11；私密場景 t_d：+8 與 +2 只給 p1 → 21
  assert.strictEqual(s.players.p1.aff.mio, 21); assert.strictEqual(s.players.p0.aff.mio, 11);
  window.PriTestIzakayaScenes.splice(0);
  Array.prototype.push.apply(window.PriTestIzakayaScenes, saved);
  console.log("5. 劇情引擎 OK");
})();

// ---------------- 6. 戀愛 ----------------
(function () {
  var s = game(2, 5); s.phase = "holiday"; s.maxStar = 2;
  s.players.p0.aff.mio = 40;
  assert.ok(!Core.canDate(s, "p0", "mio"), "★3 才能約會");
  s.maxStar = 3; assert.ok(Core.canDate(s, "p0", "mio"));
  s.players.p1.aff.mio = 10; assert.ok(!Core.canDate(s, "p1", "mio"), "好感不夠");
  assert.ok(Core.startDate(s, "p0", "mio", "yakei"));
  s.players.p1.aff.mio = 40; assert.ok(!Core.canDate(s, "p1", "mio"), "同一角色同一天只能被一人約");
  var mio = window.PriTestIzakayaCast.byId("mio"), spot = D.SPOTS.filter(function (x) { return x.id === "yakei"; })[0];
  for (var r = 0; r < 3; r++) {
    var ci = spot.rounds[r].ch.map(function (o) { return o.tag; }).findIndex(function (t) { return mio.likes.indexOf(t) >= 0; });
    Core.dateChoice(s, "p0", ci < 0 ? 0 : ci);
  }
  assert.ok(s.date.p0.done); assert.ok(s.players.p0.aff.mio > 40 + 5, "約會加好感（含喜歡的地點）");
  assert.ok(!s.date.p0.heart, "★3 沒有心動事件");
  // 告白、三角戀
  s.maxStar = 5; s.players.p0.aff.mio = 90; s.players.p1.aff.mio = 85;
  assert.ok(Core.confess(s, "p1", "mio").ok); assert.strictEqual(s.rel.mio.pid, "p1");
  var t = Core.confess(s, "p0", "mio");
  assert.ok(t.tri && t.winner === "p0", "三角戀：好感高的人贏");
  assert.strictEqual(s.rel.mio.pid, "p0"); assert.strictEqual(s.players.p1.aff.mio, 70, "輸的一方 -15");
  assert.ok(s.story.flags.tri_mio);
  // 求婚：需要交往後 3 次約會且好感 95
  s.players.p0.aff.mio = 96;
  assert.ok(!Core.propose(s, "p0", "mio"), "交往後約會不到 3 次");
  s.rel.mio.dates = 3; assert.ok(Core.propose(s, "p0", "mio")); assert.strictEqual(s.rel.mio.stage, 2);
  s.phase = "holiday"; assert.ok(Core.wedding(s, "p0", "mio")); assert.strictEqual(Core.partnerOf(s, "p0"), "mio");
  console.log("6. 戀愛 OK");
})();

// ---------------- 7. 店員、招牌、伴侶、評論家 ----------------
(function () {
  var s = game(1, 11); stockUp(s);
  assert.ok(!Core.hire(s, "akari"), "★4 前不能雇");
  s.maxStar = 4; assert.ok(!Core.hire(s, "akari"), "沒面試過不能雇");
  s.staff.met.reina = 1; assert.ok(Core.hire(s, "reina")); assert.deepStrictEqual(s.staff.crew, ["reina"]);
  // 調酒店員：飲料 ×1.1；薪水在打烊扣
  Core.setBoard(s, ["karaage", "nama"]);
  var g = { kind: "walk", gid: s.pool[0].id, n: 1, sat: 60, food: "karaage", drink: "nama", step: "drink" };
  s.night = { groups: [g], i: 0, rev: 0, satSum: 0, satN: 0, high: [] };
  var cash = s.cash; Core.pay(s, g);
  assert.strictEqual(s.cash - cash, Math.round(D.DISHES.karaage.price + D.DISHES.nama.price * 1.1));
  cash = s.cash; s.night.i = 1; Core.closeService(s);
  assert.strictEqual(cash - s.cash, D.RENT + window.PriTestIzakayaCast.byId("reina").wage);
  // 招牌菜 ×1.2（★3）
  assert.ok(!Core.setSig(s, "nama"), "飲料不能當招牌");
  assert.ok(Core.setSig(s, "karaage"));
  var g2 = { kind: "walk", gid: s.pool[1].id, n: 2, sat: 60, food: "karaage", drink: "nama", step: "drink" };
  s.night = { groups: [g2], i: 0, rev: 0, satSum: 0, satN: 0, high: [] }; cash = s.cash; Core.pay(s, g2);
  assert.strictEqual(s.cash - cash, Math.round((D.DISHES.karaage.price * 1.2 + D.DISHES.nama.price * 1.1) * 2));
  // 伴侶 +5 滿意度
  s.rel.mio = { pid: "p0", stage: 3, dates: 3 };
  s.staff.crew = ["yuzu"]; s.staff.met.yuzu = 1;
  assert.strictEqual(Core.staffSatBonus(s), 10, "招呼店員 5＋伴侶 5");
  console.log("7. 店員／招牌／伴侶 OK");
})();

// ---------------- 8. 即時尖峰 ----------------
(function () {
  var Rush = window.PriTestIzakayaRush;
  var s = game(2, 31); stockUp(s);
  Core.setBoard(s, ["negima", "karaage", "hiyayakko", "oden", "nama", "oolong"]);
  s.phase = "service"; s.night = { groups: [{ kind: "rush", step: "rush" }], i: 0, rev: 0, satSum: 0, satN: 0, high: [] };
  Rush.start(s);
  assert.strictEqual(s.rush.seats.length, 4 + s.maxStar);
  for (var i = 0; i < 20 && !s.rush.seats.some(function (x) { return x.gid; }); i++) Rush.step(s, 1);
  var seat = s.rush.seats.filter(function (x) { return x.gid; })[0];
  assert.ok(seat, "有客人入座");
  var k = 0, item = seat.items[k], st = D.DISHES[item.d].st, role = Rush.STATION_ROLE[st];
  var wrong = s.order.filter(function (p) { return !Core.hasRole(s, p, role); })[0];
  if (wrong) assert.ok(!Rush.intent(s, wrong, { a: "rc", seat: seat.id, k: k }), "不是這站的人不能做");
  var who = s.order.filter(function (p) { return Core.hasRole(s, p, role); })[0];
  assert.ok(Rush.intent(s, who, { a: "rc", seat: seat.id, k: k })); assert.strictEqual(item.s, "cook");
  var slot = s.rush.st[st].findIndex(function (x) { return x && x.seat === seat.id; });
  assert.ok(!Rush.intent(s, who, { a: "rt", st: st, slot: slot }), "還沒熟不能起鍋");
  Rush.step(s, D.DISHES[item.d].cook + 0.1);
  assert.ok(Rush.intent(s, who, { a: "rt", st: st, slot: slot })); assert.strictEqual(item.s, "ready");
  var hall = s.order.filter(function (p) { return Core.hasRole(s, p, "hall"); })[0];
  assert.ok(Rush.intent(s, hall, { a: "rs", seat: seat.id, k: k })); assert.strictEqual(item.s, "done");
  // 燒焦：串燒放著不管
  var s2 = game(1, 32); stockUp(s2); Core.setBoard(s2, ["negima"]);
  s2.phase = "service"; s2.night = { groups: [{ kind: "rush", step: "rush" }], i: 0, rev: 0, satSum: 0, satN: 0, high: [] };
  Rush.start(s2);
  for (i = 0; i < 20 && !s2.rush.seats.some(function (x) { return x.gid; }); i++) Rush.step(s2, 1);
  var se2 = s2.rush.seats.filter(function (x) { return x.gid; })[0];
  Rush.intent(s2, "p0", { a: "rc", seat: se2.id, k: 0 });
  Rush.step(s2, D.DISHES.negima.cook * 2);
  assert.strictEqual(s2.rush.stats.burnt, 1); assert.strictEqual(se2.items[0].s, "wait", "燒焦回到待做");
  // 決定性：同一種子、同一串操作，結果相同
  var a = game(1, 50), b = game(1, 50);
  [a, b].forEach(function (x) { stockUp(x); Core.setBoard(x, ["negima", "nama"]); x.phase = "service"; x.night = { groups: [{ kind: "rush", step: "rush" }], i: 0, rev: 0, satSum: 0, satN: 0, high: [] }; Rush.start(x); for (var j = 0; j < 100; j++) Rush.step(x, 1); });
  assert.deepStrictEqual(a.night, b.night); assert.strictEqual(a.cash, b.cash);
  assert.strictEqual(a.rush, null, "90 秒後結束"); assert.strictEqual(a.night.i, 1, "結束後換下一組");
  console.log("8. 即時尖峰 OK");
})();

// ---------------- 9. 意圖與階段 ----------------
(function () {
  var s = game(2, 77);
  var buyer = s.order.filter(function (p) { return Core.hasRole(s, p, "buyer"); })[0], other = s.order.filter(function (p) { return p !== buyer; })[0];
  if (!Core.hasRole(s, other, "buyer")) assert.ok(!Core.applyIntent(s, other, { a: "buy", id: "chicken", n: 1 }), "不是採買不能買");
  assert.ok(Core.applyIntent(s, buyer, { a: "buy", id: "chicken", n: 2 }));
  Core.applyIntent(s, "p0", { a: "ready", v: true }); assert.strictEqual(s.phase, "market", "還有人沒準備好");
  Core.applyIntent(s, "p1", { a: "ready", v: true }); assert.strictEqual(s.phase, "prep");
  var hall = s.order.filter(function (p) { return Core.hasRole(s, p, "hall"); })[0];
  assert.ok(Core.applyIntent(s, hall, { a: "board", ids: ["negima", "nama"] }));
  s.order.forEach(function (p) { Core.applyIntent(s, p, { a: "ready", v: true }); });
  assert.strictEqual(s.phase, "service");
  console.log("9. 意圖與階段 OK");
})();

// ---------------- 10. 多名店員（使用者指定 2026-11-09：★4 兩人、★5 三人）----------------
(function () {
  var s = game(1, 61), St = window.PriTestIzakayaStory;
  ["reina", "kotone", "yuzu", "miu", "akari"].forEach(function (k) { s.staff.met[k] = 1; });
  s.maxStar = 4;
  assert.ok(Core.hire(s, "reina") && Core.hire(s, "kotone"));
  assert.ok(!Core.hire(s, "yuzu"), "★4 最多 2 人");
  assert.ok(!Core.hire(s, "reina"), "不能重複雇用");
  s.maxStar = 5; assert.ok(Core.hire(s, "yuzu"), "★5 可以 3 人");
  assert.strictEqual(Core.drinkMult(s), 1.2, "兩位調酒店員疊加 +20%");
  var C = window.PriTestIzakayaCast;
  assert.strictEqual(Core.wageOf(s), C.byId("reina").wage + C.byId("kotone").wage + C.byId("yuzu").wage, "薪水加總");
  assert.ok(Core.fire(s, "kotone")); Core.hire(s, "miu");
  assert.strictEqual(Core.staffSatBonus(s), 10, "兩位招呼店員 +10（上限）");
  // 劇情條件 staff：只要在雇用名單裡
  assert.ok(St.condOk(s, { id: "x", who: ["yuzu"], at: "close", cond: { staff: "yuzu" } }, { at: "close", who: "yuzu" }));
  assert.ok(!St.condOk(s, { id: "x", who: ["kotone"], at: "close", cond: { staff: "kotone" } }, { at: "close", who: "kotone" }));
  // 舊存檔（staff.hired 字串）讀進來轉成名單
  var old = JSON.parse(Core.serialize(game(1, 62))); delete old.staff.crew; old.staff.hired = "reina";
  assert.deepStrictEqual(Core.restore(JSON.stringify(old)).staff.crew, ["reina"], "舊存檔相容");
  console.log("10. 多名店員 OK");
})();

// ---------------- 11. 跨局記憶與多重結局（使用者指定 2026-11-09：最深處的祕密要玩三輪以上）----------------
(function () {
  var St = window.PriTestIzakayaStory;
  var leg = Core.emptyLegacy();
  assert.deepStrictEqual(leg, { runs: 0, seen: {}, endings: {}, secrets: {} });
  var s = Core.newGame({ seed: 5, players: [{ pid: "p0", name: "P0" }], legacy: leg });
  assert.strictEqual(s.legacy.runs, 0);
  // 劇情條件：run（已完成幾輪）、ever（以前的輪看過）、secret（以前的輪解開的祕密）
  var sc = { id: "t_run", who: ["mio"], at: "visit", cond: { run: 2, ever: ["mio_10"], secret: ["secret_a"] } };
  assert.ok(!St.condOk(s, sc, { at: "visit", who: "mio" }));
  // 一年結束 → 合併進記憶
  s.story.seen.mio_10 = 1; s.story.flags.secret_a = 1; s.story.seen.master_06 = 1;
  s.day = 30; s.phase = "close"; Core.nextDay(s);
  assert.ok(s.end && s.end.ending, "結局有 id");
  assert.strictEqual(s.end.ending, "master", "看過師父回歸 → 師父結局");
  leg = Core.mergeLegacy(leg, s);
  assert.strictEqual(leg.runs, 1); assert.ok(leg.seen.mio_10 && leg.endings.master && leg.secrets.secret_a);
  assert.strictEqual(Core.mergeLegacy(leg, s).runs, 1, "同一局只記一次");
  leg.runs = 2;
  var s2 = Core.newGame({ seed: 6, players: [{ pid: "p0", name: "P0" }], legacy: leg });
  assert.ok(St.condOk(s2, sc, { at: "visit", who: "mio" }), "第 3 輪：條件成立");
  // 結局判定：沒守住橫丁、也沒找回師父 → 再開發結局
  var s3 = game(1, 7); s3.day = 30; s3.phase = "close"; Core.nextDay(s3);
  assert.strictEqual(s3.end.ending, "redevelop");
  assert.ok(D.ENDINGS.every(function (e) { return e.id && e.name && e.desc; }), "結局資料完整");
  // 批次 C：劇情條件 rel（關係階段）
  var s4 = game(1, 8), scR = { id: "t_rel", who: ["mio"], at: "close", cond: { rel: 2 } };
  assert.ok(!St.condOk(s4, scR, { at: "close", who: "mio" }), "沒交往不成立");
  s4.rel.mio = { pid: "p0", stage: 1, dates: 0 }; assert.ok(!St.condOk(s4, scR, { at: "close", who: "mio" }), "交往但未訂婚");
  s4.rel.mio.stage = 2; assert.ok(St.condOk(s4, scR, { at: "close", who: "mio" }), "訂婚成立");
  // 批次 D：日常小劇場——沒有主線劇情時隨機抽，at 必須是 "daily"
  var dl = St.all().filter(function (x) { return x.at === "daily"; });
  assert.ok(dl.length >= 80, "日常小劇場至少 80 段：" + dl.length);
  var s5 = game(1, 9); s5.day = 10; var hits = 0;
  for (var q = 0; q < 40; q++) { s5.story.cur = null; s5.night = { groups: [{ kind: "reg", gid: "rin", step: "talk" }], i: 0 }; s5.story.seen = { rin_01: 1, rin_02: 1, contest_01: 1 }; Core.enterGroup(s5); if (s5.story.cur && St.byId(s5.story.cur.id).at === "daily") hits++; }
  assert.ok(hits > 0, "常客到店時會抽到日常小劇場");
  // 批次 F：每位可戀愛的角色 × 每個約會地點，都有一段心動場景
  var C2 = window.PriTestIzakayaCast;
  C2.REGULARS.filter(function (c) { return !c.noLove; }).concat(C2.STAFF).forEach(function (c) {
    D.SPOTS.forEach(function (sp) {
      var n = St.all().filter(function (x) { return x.at === "date" && x.who[0] === c.id && x.cond.spot === sp.id; }).length;
      assert.strictEqual(n, 1, "心動場景：" + c.id + "×" + sp.id + " 要剛好 1 段（實際 " + n + "）");
    });
  });
  console.log("11. 跨局記憶與多重結局 OK");
})();

// ---------------- 12. 創作料理（規格第 2 期：用世界美食的配方合成稀有菜）----------------
(function () {
  var G = window.PriTestGouseiData.food, s = game(1, 71);
  Object.keys(D.GOUSEI_MAP).forEach(function (k) { s.fridge[k] = [99, 99, 99, 99, 99, 99, 99, 99, 99, 99]; });
  var mats = Core.materials(s).map(function (m) { return m.id; });
  assert.ok(mats.indexOf("fire") >= 0 && mats.indexOf(D.GOUSEI_MAP.chicken) >= 0, "素材：基本素材＋冰箱食材");
  // 找一組直接做出料理、和一組做出半成品的配方
  var dishKey = null, prepKey = null;
  Object.keys(G.recipes).forEach(function (k) {
    var p = k.split("|"); if (mats.indexOf(p[0]) < 0 || mats.indexOf(p[1]) < 0 || p[0] === p[1]) return;
    var it = G.items.filter(function (x) { return x[0] === G.recipes[k]; })[0];
    if (!it) return;
    if (D.CREATE_CATS.indexOf(it[3]) >= 0) { if (!dishKey) dishKey = p; } else if (!prepKey) prepKey = p;
  });
  assert.ok(dishKey && prepKey, "有直接成菜與半成品的配方");
  var before = Core.stock(s, "chicken");
  var r = Core.create(s, dishKey[0], dishKey[1]);
  assert.ok(r.ok && r.kind === "dish" && s.known[r.id] && D.DISHES[r.id], "做出創作料理並解鎖：" + JSON.stringify(r));
  assert.ok(s.prepped[r.id] > 0, "創作料理附帶幾份可以直接出菜");
  assert.ok(D.DISHES[r.id].price > 0 && D.DISHES[r.id].f.length === 5);
  var r2 = Core.create(s, prepKey[0], prepKey[1]);
  assert.ok(r2.ok && r2.kind === "prep" && s.atelier[r2.gid] === 1, "半成品收進工坊");
  assert.ok(Core.materials(s).some(function (m) { return m.id === r2.gid && m.src === "atelier"; }), "工坊的半成品可以當素材");
  var r3 = Core.create(s, "water", "water");
  assert.ok(!r3.ok || r3.kind, "不存在的配方：失敗");
  // 存檔來回：創作料理重新登記
  var id = r.id; delete D.DISHES[id];
  var back = Core.restore(Core.serialize(s));
  assert.ok(D.DISHES[id] && back.creations[id], "讀檔後重新登記創作料理");
  console.log("12. 創作料理 OK");
})();

// ---------------- 13. 玩法補完（使用者指定 2026-11-09）----------------
(function () {
  // 殺價：一天一次，成功 8 折、失敗漲一成
  var s = game(1, 81), p0 = s.mk.chicken, h = Core.haggle(s, "chicken");
  assert.ok(h.ok);
  assert.strictEqual(s.mk.chicken, h.cut ? Math.max(10, Math.round(p0 * 0.8 / 10) * 10) : Math.round(p0 * 1.1 / 10) * 10, "殺價結果");
  assert.ok(!Core.haggle(s, "chicken").ok, "同一種食材一天只能殺一次");
  // 接明日預約（★2）：今天接、明天來；做好了拿獎金
  s = game(1, 82); s.maxStar = 2; Core.startMarket(s);
  assert.ok(s.offers.length >= 1, "★2 市場有預約");
  var of = s.offers[0];
  assert.ok(Core.acceptResv(s, of.id) && !Core.acceptResv(s, of.id), "接預約（不能重複接）");
  s.day = 2; Core.startMarket(s); stockUp(s);
  Core.setBoard(s, ["karaage", "nama"]); s.phase = "prep"; Core.openService(s);
  var rg = s.night.groups.filter(function (g) { return g.resv; })[0];
  assert.ok(rg && rg.n === of.n && rg.bonus === of.bonus, "預約的客人今晚來了");
  rg.sat = 90; rg.food = "karaage"; rg.drink = "nama"; s.night.i = s.night.groups.indexOf(rg);
  var c0 = s.cash; Core.pay(s, rg);
  assert.ok(s.cash - c0 >= of.bonus, "做好預約拿到獎金");
  // 季節宴席（★5）：外場選 3 道，當晚多一組 6 人宴席，板前一次出完
  s = game(1, 83); s.maxStar = 5; stockUp(s); s.phase = "prep";
  assert.ok(!Core.setBanquet(s, ["karaage", "negima"]), "宴席要 3 道");
  assert.ok(Core.setBanquet(s, ["karaage", "negima", "oden"]));
  Core.setBoard(s, ["karaage", "negima", "oden", "nama"]); Core.openService(s);
  var bi = s.night.groups.findIndex(function (g) { return g.kind === "banquet"; });
  assert.ok(bi >= 0 && s.night.groups[bi].n === 6, "宴席客 6 人");
  s.night.i = bi; s.story.cur = null; c0 = s.cash;
  var br = Core.serveBanquet(s);
  assert.ok(br.ok && s.cash > c0 && s.night.groups[bi].step === "done", "宴席上菜結帳");
  // 酒保話題：每組一次
  s = game(1, 84); stockUp(s); Core.setBoard(s, ["karaage", "nama"]); s.phase = "prep"; Core.openService(s);
  var g = Core.curGroup(s); g.step = "order"; s.story.cur = null;
  assert.ok(Core.barTalk(s, 1).ok && g.bartalked, "酒保聊天");
  assert.ok(!Core.barTalk(s, 0).ok, "一組只能聊一次");
  // 採買夜間工作：洗碗、緊急補貨（1.3 倍）、突發狀況
  s.night.dirty = 12; assert.ok(Core.wash(s) && s.night.dirty === 0, "洗碗");
  s.fridge = { tofu: [99] };   // stockUp 會把冰箱塞爆，補貨要有空位
  c0 = s.cash; var st0 = Core.stock(s, "tofu");
  assert.ok(Core.restock(s, "tofu"), "營業中補貨");
  assert.strictEqual(Core.stock(s, "tofu"), st0 + 1); assert.strictEqual(c0 - s.cash, Math.round(s.mk.tofu * 1.3));
  s.night.incident = { type: "power", at: s.night.i, done: false };
  assert.ok(Core.handleIncident(s) && s.night.incident.done, "處理突發狀況");
  // 中途加入：營業以外的階段可以加入，職位重新分配
  s = game(2, 85);
  assert.ok(Core.applyIntent(s, "p9", { a: "join", name: "新人", want: "bar" }));
  assert.ok(s.players.p9 && s.order.indexOf("p9") >= 0, "加入成功");
  var all = []; s.order.forEach(function (p) { all = all.concat(s.roles[p]); });
  assert.deepStrictEqual(all.sort(), ["bar", "buyer", "chef", "hall"], "職位重新分配後四職都有人");
  // 斷線代班：暫離的人不用準備；他的職位由第一位在線的玩家代理
  var awayRole = s.roles.p1[0];
  assert.ok(Core.applyIntent(s, "p0", { a: "away", pid: "p1", v: true }));
  assert.ok(Core.hasRole(s, "p0", awayRole), "第一位在線玩家代理暫離者的職位");
  Core.applyIntent(s, "p0", { a: "ready", v: true }); Core.applyIntent(s, "p9", { a: "ready", v: true });
  assert.strictEqual(s.phase, "prep", "暫離的人不用等");
  console.log("13. 玩法補完 OK");
})();

// 2026-11-10：冰箱加大、一鍵備料、臨時加碼出菜、招待小菜／奉茶、尖峰自動加碼、劇情前後的鋪陳
(function () {
  var Core = window.PriTestIzakayaCore, Story = window.PriTestIzakayaStory, Chatter = window.PriTestIzakayaChatter;
  assert.ok(D.FRIDGE_CAP >= 80 && D.FRIDGE_CAP_STAR2 >= 120, "冰箱加大");
  // 一鍵備料：第 1 天黑板空的也估得出來，買完後缺額變少、不超過冰箱容量
  var s = game(1, 91), plan = Core.stockPlan(s);
  assert.ok(Object.keys(plan).length > 0, "有備料計畫");
  assert.ok(Core.applyIntent(s, "p0", { a: "stock" }), "一鍵備料");
  assert.ok(Core.fridgeCount(s) > 0 && Core.fridgeCount(s) <= Core.fridgeCap(s), "備料不超過冰箱容量");
  var left = 0; Object.keys(Core.stockPlan(s)).forEach(function (k) { left += Core.stockPlan(s)[k]; });
  var before = 0; Object.keys(plan).forEach(function (k) { before += plan[k]; });
  assert.ok(left < before, "備料後缺額變少");
  // 臨時加碼出菜：冰箱沒雞肉也能出蔥雞串（1.3 倍價）
  s = game(1, 92); s.fridge = {}; Core.setBoard(s, ["negima", "oolong"]); s.phase = "prep"; Core.openService(s); s.story.cur = null;
  var g = Core.curGroup(s); while (g && g.kind !== "walk" && g.kind !== "reg") { s.night.i++; g = Core.curGroup(s); }
  g.step = "order";
  assert.ok(!Core.canMake(s, "negima") && Core.canBuyShort(s, "negima"), "缺料但買得起");
  var c0 = s.cash, cost = Core.shortCost(s, "negima");
  assert.strictEqual(cost, Core.restockCost(s, "chicken") + Core.restockCost(s, "negi"));
  assert.ok(!Core.applyIntent(s, "p0", { a: "serve", id: "negima" }), "沒有 buy 旗標就出不了");
  assert.ok(Core.applyIntent(s, "p0", { a: "serve", id: "negima", buy: true }), "加碼出菜");
  assert.strictEqual(c0 - s.cash, cost); assert.strictEqual(g.food, "negima"); assert.strictEqual(g.step, "drink");
  // 奉茶：飲料做不出來 → −2、結帳
  s.cash = 0;
  var sat = g.sat, i0 = s.night.i;
  assert.ok(Core.applyIntent(s, "p0", { a: "fallback" }), "奉茶");
  assert.strictEqual(g.sat, sat - 2); assert.ok(g.tea && g.step === "done" && s.night.i > i0, "奉茶後結帳");
  // 招待小菜：點菜時 −6、進到飲料
  g = Core.curGroup(s);
  if (g && (g.kind === "walk" || g.kind === "reg")) {
    s.story.cur = null; g.step = "order"; sat = g.sat;
    assert.ok(Core.applyIntent(s, "p0", { a: "fallback" }), "招待小菜");
    assert.strictEqual(g.sat, sat - 6); assert.ok(g.otoshi && g.step === "drink" && g.food === null);
  }
  // 營業中補貨不受冰箱容量限制，可以一次買 3 份
  s = game(1, 93); stockUp(s); s.phase = "service"; s.cash = 99999;
  var t0 = Core.stock(s, "tofu");
  assert.ok(Core.fridgeCount(s) >= Core.fridgeCap(s) && Core.restock(s, "tofu", 3) && Core.stock(s, "tofu") === t0 + 3, "補貨 ×3");
  // 尖峰缺料自動加碼
  s = game(1, 94); s.fridge = {}; Core.setBoard(s, ["negima"]); s.cash = 99999;
  window.PriTestIzakayaRush.start(s);
  var seat = s.rush.seats[0]; seat.gid = s.pool[0].id; seat.items = [{ d: "negima", s: "wait" }]; seat.max = seat.pat = 40;
  assert.ok(window.PriTestIzakayaRush.intent(s, "p0", { a: "rc", seat: 0, k: 0 }) && seat.items[0].s === "cook", "尖峰自動加碼開做");
  // 劇情鋪陳：一般場景前面多了開場，兩個選項以上的場景選完有反應；結算後 last.n 遞增
  var sc = Story.byId("mio_01");
  assert.ok(Story.script(sc).length > sc.lines.length, "開場鋪陳");
  assert.ok(Story.afterLines(sc, 0).length >= 1, "選項後的反應");
  assert.strictEqual(Chatter.mood(sc, 0, { id: "mio" }), "good");
  var dates = Story.all().filter(function (x) { return x.at === "date"; });
  assert.ok(!dates.length || Story.script(dates[0]).length === dates[0].lines.length, "約會場景不加鋪陳");
  Story.all().forEach(function (x) {   // 每個場景都產得出來、說話者都是有效的 id 或旁白
    Story.script(x).concat(x.ch ? Story.afterLines(x, 0) : []).forEach(function (l) { assert.ok(Array.isArray(l) && typeof l[1] === "string" && l[1].indexOf("{n}") < 0, x.id); });
  });
  s = game(1, 95); Story.begin(s, "mio_01", null);
  assert.ok(Core.applyIntent(s, "p0", { a: "vote", c: 0 }) && s.story.last.n === 1 && s.story.last.c === 0, "last.n");
  // 入座閒聊
  var line = Chatter.chat({ persona: "genki", topic: "food", dish: "蔥雞串" }, function () { return 0.1; });
  assert.ok(typeof line === "string" && line.length > 2 && line.indexOf("{dish}") < 0, "閒聊");
  console.log("14. 備料、加碼、劇情鋪陳 OK");
})();

console.log("ALL OK");
