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
["izakaya_data.js", "izakaya_cast.js", "izakaya_story.js", "izakaya_story_main.js", "izakaya_story_arcs.js",
 "izakaya_story_staff.js", "izakaya_rush.js", "izakaya_core.js"].forEach(function (f) {
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
  assert.strictEqual(D.SPOTS.length, 6, "1a 約會地點 6 個");
  assert.strictEqual(D.STAR_REP.length, 5);
  console.log("1. 資料完整性 OK（料理 " + food.length + "、酒飲 " + drinks.length + "）");
})();

// ---------------- 2. 角色名單 ----------------
(function () {
  var Cast = window.PriTestIzakayaCast;
  assert.strictEqual(Cast.REGULARS.length, 6, "1a 常客 6 人");
  assert.strictEqual(Cast.STAFF.length, 10, "1a 店員 10 人");
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
  assert.strictEqual(used.length, 16); assert.strictEqual(new Set(used.concat(a.rest)).size, 191, "同一局內不重複");
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
  assert.strictEqual(s.night.groups.filter(function (g) { return g.kind !== "rush"; }).length, D.BASE_GROUPS + 2, "★1：4+2 組");
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
  assert.strictEqual(Core.starOf(0), 1); assert.strictEqual(Core.starOf(25), 2); assert.strictEqual(Core.starOf(239), 4); assert.strictEqual(Core.starOf(240), 5);
  s.rep = 80; s.night.i = s.night.groups.length; Core.closeService(s);
  assert.strictEqual(s.phase, "close"); assert.strictEqual(s.maxStar, 3); assert.strictEqual(s.today.unlock, 3);
  s.rep = 0; s.night = { groups: [], i: 0 }; Core.closeService(s);
  assert.strictEqual(s.star, 1); assert.strictEqual(s.maxStar, 3, "最高星級不回收");
  // 日推進：第 6 天打烊後進公休日；公休後第 7 天；第 30 天後結束
  s.day = 6; Core.nextDay(s); assert.strictEqual(s.phase, "holiday"); assert.strictEqual(s.day, 6);
  Core.afterHoliday(s); assert.strictEqual(s.day, 7); assert.strictEqual(s.phase, "market");
  s.day = 30; s.phase = "close"; Core.nextDay(s); assert.strictEqual(s.phase, "end"); assert.ok(s.end);
  console.log("4. 營業／推理／口碑／日推進 OK");
})();

console.log("ALL OK");
