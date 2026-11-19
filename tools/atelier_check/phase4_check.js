// ============================================================================
// 煉金術士（atelier）第 4 階段規則檢查（不需要瀏覽器）。規則依據 docs/atelier_design.md §10。
//   配色獎勵、虹素材、觀察道具（放大鏡、濾色）、季節色彩祭、著色繪本、工房裝飾、店鋪與行情、稱號、遷移。
// 執行：node tools/atelier_check/phase4_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
global.PriTestAtelierData = require(path.join(SRC, "atelier_data.js"));
global.PriTestAtelierColors = require(path.join(SRC, "atelier_colors.js"));
global.PriTestAtelierHosts = require(path.join(SRC, "atelier_hosts.js"));
var C = require(path.join(SRC, "atelier_core.js"));
global.PriTestAtelierCore = C;
var Board = require(path.join(SRC, "atelier_method_board.js"));
C.registerMethod("board", Board);
var D = global.PriTestAtelierData;

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }
var DAY = 86400000;
var T0 = Date.UTC(2026, 10, 19, 3, 0, 0);   // JST 2026-11-19 12:00（秋）
var WINTER = Date.UTC(2027, 0, 10, 3, 0, 0);
function swHsv(h, s, v) { var rgb = C.hsvToRgb(h, s, v); return { rgb: rgb, hex: C.rgbToHex(rgb), frac: 0.2, shape: [[0, 0]] }; }
function swHex(hex) { return { rgb: C.hexToRgb(hex), hex: hex, frac: 0.3, shape: [[0, 0], [1, 0]] }; }
function mat(uid, el, cat, shape, q, colorId, hex) {
  return { uid: uid, hex: hex || "#000000", rgb: [0, 0, 0], colorId: colorId === undefined ? "sumi" : colorId, element: el, category: cat,
    power: 2, quality: q || 50, traits: [], shape: shape, at: T0 };
}
function item(uid, recipe, q, gauges) {
  return { uid: uid, recipe: recipe, quality: q, effects: [{ el: "wind", level: 1 }], traits: [],
    gauges: gauges || { fire: 0, ice: 20, bolt: 0, wind: 5, spirit: 0 }, at: T0 };
}
function stripes(hues, N) {
  N = N || 32;
  var a = new Uint8ClampedArray(N * N * 4), w = N / hues.length;
  for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
    var rgb = C.hsvToRgb(hues[Math.min(hues.length - 1, Math.floor(x / w))], 0.9, 0.9), i = (y * N + x) * 4;
    a[i] = rgb[0]; a[i + 1] = rgb[1]; a[i + 2] = rgb[2]; a[i + 3] = 255;
  }
  return a;
}

// ---------- §10.1 配色 ----------
test("配色：三角、互補、類似；灰色不算；三角優先", function () {
  assert.strictEqual(C.harmonyOf([swHsv(0, 0.8, 0.8), swHsv(120, 0.8, 0.8), swHsv(240, 0.8, 0.8)]), "triad");
  assert.strictEqual(C.harmonyOf([swHsv(10, 0.8, 0.8), swHsv(195, 0.8, 0.8)]), "complementary");
  assert.strictEqual(C.harmonyOf([swHsv(100, 0.8, 0.8), swHsv(115, 0.8, 0.8), swHsv(130, 0.8, 0.8)]), "analogous");
  assert.strictEqual(C.harmonyOf([swHsv(0, 0.1, 0.8), swHsv(180, 0.1, 0.8)]), null, "灰色不算");
  assert.strictEqual(C.harmonyOf([swHsv(0, 0.8, 0.8), swHsv(60, 0.8, 0.8)]), null);
  assert.strictEqual(C.harmonyOf([swHsv(0, 0.8, 0.8), swHsv(120, 0.8, 0.8), swHsv(240, 0.8, 0.8), swHsv(180, 0.8, 0.8)]), "triad");
});

test("有配色的照片：採到的素材都帶「調和」", function () {
  var s = C.newSave(T0);
  var r = C.captureEx(s, [swHex("#E83929"), swHex("#0095D9")], T0, { harmony: "complementary" });
  r.mats.forEach(function (m) { assert(m.traits.indexOf("harmony") >= 0); });
  assert.strictEqual(r.harmony, "complementary");
});

// ---------- §10.2 虹 ----------
test("虹：12 色相條紋是虹、兩色不是；採集時多 1 個虹之欠片", function () {
  assert.strictEqual(C.rainbowOf(stripes([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330])), true);
  assert.strictEqual(C.rainbowOf(stripes([0, 200])), false);
  var s = C.newSave(T0), r = C.captureEx(s, [swHex("#E83929")], T0, { rainbow: true });
  assert(r.rainbow && r.rainbow.rainbow);
  assert.deepStrictEqual(r.rainbow.traits, ["rainbow"]);
  assert.strictEqual(r.rainbow.quality, D.RAINBOW_MAT.quality);
  assert.strictEqual(s.mats.length, 2);
  assert.strictEqual(C.captureEx(s, [swHex("#E83929")], T0).rainbow, undefined);
});

// ---------- §10.3 觀察道具 ----------
test("放大鏡：7 色、1.5%；分析能抓到更多顏色。濾色：色相 +30°", function () {
  var s = C.newSave(T0);
  assert.deepStrictEqual(C.analyzeOpts(s), {});
  s.tools.loupe = true;
  assert.deepStrictEqual(C.analyzeOpts(s), { k: 7, minFrac: 0.015 });
  var img = stripes([0, 50, 100, 150, 200, 250, 300]);
  assert(C.analyze(img, 32, 32, "x", C.analyzeOpts(s)).length > C.analyze(img, 32, 32, "x").length);
  var red = new Uint8ClampedArray([255, 0, 0, 255]);
  assert.strictEqual(Math.round(C.rgbToHsv(Array.prototype.slice.call(C.shiftHue(red, D.FILTER_SHIFT), 0, 3)).h), 30);
});

test("觀察道具：做出效果 Lv1 以上的放大鏡才取得", function () {
  var s = C.newSave(T0);
  s.exp = 2 * D.EXP_PER_LV; s.ideas.loupe = true;
  s.mats = [mat(1, "bolt", "crystal", [[0, 0]], 50), mat(2, "bolt", "mineral", [[0, 0]], 50)];
  var ss = C.startSynthesis(s, "loupe", [1, 2], "copper", T0);
  Board.place(ss, 0, 0, 0, 0); Board.place(ss, 1, 1, 0, 0);
  var it = C.finishSynthesis(s, ss, [], T0);
  assert.strictEqual(it.effects[0].level, 0);
  assert.strictEqual(!!s.tools.loupe, false);
  s.cooldownUntil = 0;
  s.mats = [mat(3, "bolt", "crystal", [[0, 0], [1, 0], [2, 0]], 50), mat(4, "bolt", "mineral", [[0, 0], [1, 0]], 50)];
  ss = C.startSynthesis(s, "loupe", [3, 4], "copper", T0);
  Board.place(ss, 0, 2, 3, 0); Board.place(ss, 1, 3, 4, 0);     // 雷：同色加成格 (3,3)、雷色格 (4,4)
  it = C.finishSynthesis(s, ss, [], T0);
  assert(it.effects[0].level >= 1, JSON.stringify(it.gauges));
  assert.strictEqual(s.tools.loupe, true);
});

// ---------- §10.7 季節 ----------
test("季節：11 月秋、1 月冬；主題色帶「季節之彩」；季節配方只在當季", function () {
  assert.strictEqual(C.seasonOf(T0), "autumn");
  assert.strictEqual(C.seasonOf(WINTER), "winter");
  assert.strictEqual(C.seasonOf(Date.UTC(2026, 1, 28, 15, 0, 0)), "spring", "JST 3/1 00:00");
  var m = C.makeMaterial(swHex("#B7282E"), T0, 1);      // 茜色（秋的主題色）
  assert(m.traits.indexOf("season") >= 0);
  assert(C.makeMaterial(swHex("#B7282E"), WINTER, 1).traits.indexOf("season") < 0);
  var s = C.newSave(T0);
  s.exp = D.EXP_PER_LV;
  assert.strictEqual(C.recipeAvailable(s, C.recipe("dyecloth"), T0), true);
  assert.strictEqual(C.recipeAvailable(s, C.recipe("dyecloth"), WINTER), false);
  assert.strictEqual(C.recipeAvailable(s, C.recipe("dyecloth")), false, "沒有 now 時不可用");
  assert.strictEqual(C.recipeAvailable(s, C.recipe("snowcharm"), WINTER), true);
  Object.keys(D.SEASONS).forEach(function (k) {
    D.SEASONS[k].colors.forEach(function (id) { assert(C.colorById(id), k + " " + id); });
    assert.strictEqual(C.recipe(D.SEASONS[k].recipe).season, k);
  });
});

// ---------- §10.4 繪本 ----------
test("繪本：色系不符、已填過會被拒絕；填色用掉素材；填完經驗 +30、灰燼 +5", function () {
  var s = C.newSave(T0);
  s.mats = [mat(1, "ice", "liquid", [[0, 0]], 50, "ruri", "#1E50A2"), mat(2, "ice", "liquid", [[0, 0]], 50, "ai", "#165E83"),
    mat(3, "wind", "plant", [[0, 0]], 50, "midori", "#3EB370"), mat(4, "fire", "mineral", [[0, 0]], 50, "daidai", "#EE7800"),
    mat(5, "fire", "mineral", [[0, 0]], 50, "beni", "#D7003A"), mat(6, "spirit", "essence", [[0, 0]], 90, null, "#C9A0DC")];
  assert.strictEqual(C.colorRegion(s, "goldfish", "water", 3).error, "group");
  assert.strictEqual(C.colorRegion(s, "goldfish", "water", 6).error, "material", "沒有傳統色的素材不能用");
  assert.strictEqual(C.colorRegion(s, "nope", "water", 1).error, "page");
  assert(C.colorRegion(s, "goldfish", "water", 1).ok);
  assert.strictEqual(C.colorRegion(s, "goldfish", "water", 2).error, "filled");
  assert.strictEqual(s.mats.length, 5);
  assert.deepStrictEqual(C.pageProgress(s, "goldfish"), { filled: 1, total: 4 });
  assert.strictEqual(C.colorRegion(s, "goldfish", "weed", 3).done, false);
  assert.strictEqual(C.colorRegion(s, "goldfish", "body", 4).done, false);
  var exp = s.exp, ash = s.ash;
  assert.strictEqual(C.colorRegion(s, "goldfish", "tail", 5).done, true);
  assert.strictEqual(s.exp, exp + D.PAGE_REWARD.exp);
  assert.strictEqual(s.ash, ash + D.PAGE_REWARD.ash);
  assert.strictEqual(s.pagesDone.goldfish, true);
  D.PAGES.forEach(function (pg) { pg.regions.forEach(function (r) { assert(D.DEX_GROUPS.indexOf(r.group) >= 0, pg.id + " " + r.id); }); });
});

// ---------- §10.5 裝飾 ----------
test("裝飾：喜歡／不喜歡；放著的成品不能賣、不能投入；每天第一次開啟好感度增加", function () {
  var s = C.newSave(T0);
  s.pagesDone.goldfish = true; s.pagesDone.persimmon = true;
  s.items = [item(10, "heal", 50, { fire: 30, ice: 0, bolt: 0, wind: 1, spirit: 0 }), item(11, "heal", 50)];
  assert.strictEqual(C.setDeco(s, 0, "page:goldfish"), "like");
  assert.strictEqual(C.setDeco(s, 1, "item:10"), "dislike");
  assert.strictEqual(C.setDeco(s, 2, "page:persimmon"), "ok");
  assert.strictEqual(C.setDeco(s, 2, "page:goldfish"), null, "同一個裝飾不能放兩格");
  assert.strictEqual(C.setDeco(s, 3, "page:goldfish"), null);
  assert.strictEqual(C.setDeco(s, 2, "page:iris"), null, "沒完成的繪本不能放");
  assert.strictEqual(C.sell(s, 10, T0), null);
  assert.strictEqual(C.findMat(s, 10), null);
  assert(C.findMat(s, 11));
  C.setDeco(s, 2, "item:11");                                  // 冰屬性的成品 → 喜歡
  assert.deepStrictEqual(C.dailyVisit(s, T0), { aff: 2 });
  assert.strictEqual(s.hosts.ruri.aff, 2);
  assert.strictEqual(C.dailyVisit(s, T0 + 3600000), null);
  assert.deepStrictEqual(C.dailyVisit(s, T0 + DAY), { aff: 2 });
  assert.strictEqual(C.setDeco(s, 1, null), "ok");
});

// ---------- §10.6 店鋪 ----------
test("店鋪：價格公式、賣出、買觸媒與採集籃", function () {
  var s = C.newSave(T0), hot = C.hotElement(T0);
  assert.strictEqual(C.hotElement(T0), C.hotElement(T0 + DAY), "同一週相同");
  var g = { fire: 0, ice: 0, bolt: 0, wind: 0, spirit: 0 };
  var cold = D.ELEMENTS.map(function (e) { return e.id; }).filter(function (e) { return e !== hot; })[0];
  var gHot = JSON.parse(JSON.stringify(g)); gHot[hot] = 10;
  var gCold = JSON.parse(JSON.stringify(g)); gCold[cold] = 10;
  assert.strictEqual(C.priceOf(item(1, "heal", 50, gCold), T0), Math.round(40 * 1.0));
  assert.strictEqual(C.priceOf(item(1, "heal", 50, gHot), T0), Math.round(40 * 1.0 * D.HOT_MULT));
  assert.strictEqual(C.priceOf(item(1, "dyecloth", 100, gCold), T0), Math.round(70 * 1.5 * D.SEASON_MULT), "秋天的楓紅染布");
  s.items = [item(1, "heal", 50, gCold)];
  assert.strictEqual(C.sell(s, 1, T0), 40);
  assert.strictEqual(s.coins, 40); assert.strictEqual(s.coinsEarned, 40); assert.strictEqual(s.items.length, 0);
  assert.strictEqual(C.buyBasket(s, T0), false, "採集籃滿了不能買");
  s.basket.n = 2;
  assert.strictEqual(C.buyBasket(s, T0), true);
  assert.strictEqual(s.basket.n, 3); assert.strictEqual(s.coins, 10);
  assert.strictEqual(C.buyBasket(s, T0), false, "銀幣不足");
  s.coins = 100;
  assert.strictEqual(C.buyCatalyst(s, "expand"), false, "Lv3 以前不能買觸媒");
  s.exp = 2 * D.EXP_PER_LV;
  assert.strictEqual(C.buyCatalyst(s, "expand"), true);
  assert.strictEqual(s.coins, 40); assert.strictEqual(s.catalysts.expand, 1);
  Object.keys(D.RECIPE_PRICE).forEach(function (id) { assert(C.recipe(id), id); });
  D.RECIPES.forEach(function (r) { assert(D.RECIPE_PRICE[r.id], r.id + " 沒有價格"); });
});

// ---------- §10.8 稱號 ----------
test("稱號：條件達成時取得、不重複；只能選已取得的稱號", function () {
  var s = C.newSave(T0);
  assert.deepStrictEqual(C.checkTitles(s), []);
  s.made.heal = 1; s.greatCount = 1; s.coinsEarned = 500; s.pagesDone.goldfish = true;
  assert.deepStrictEqual(C.checkTitles(s).sort(), ["lucky", "merchant", "novice", "painter"]);
  assert.deepStrictEqual(C.checkTitles(s), []);
  s.best.heal = 100; s.weekly.plays = 1; s.hosts.ruri.aff = 100;
  D.PAGES.forEach(function (p) { s.pagesDone[p.id] = true; });
  global.PriTestAtelierColors.slice(0, 80).forEach(function (c) { s.seen[c.id] = true; });
  s.made.ink = 19;
  assert.deepStrictEqual(C.checkTitles(s).sort(), ["artisan", "challenger", "collector", "connoisseur", "friend", "illustrator", "perfect"]);
  global.PriTestAtelierColors.forEach(function (c) { s.seen[c.id] = true; });
  assert.deepStrictEqual(C.checkTitles(s), ["master_hue"]);
  assert.strictEqual(C.setTitle(s, "lucky"), true);
  assert.strictEqual(s.title, "lucky");
  var s2 = C.newSave(T0);
  assert.strictEqual(C.setTitle(s2, "lucky"), false);
});

test("遷移：第 3 階段的存檔補上第 4 階段欄位", function () {
  var old = C.newSave(T0);
  ["coins", "coinsEarned", "tools", "coloring", "pagesDone", "deco", "visitDate", "titles", "title", "greatCount"].forEach(function (k) { delete old[k]; });
  var s = C.migrate(old);
  assert.strictEqual(s.coins, 0);
  assert.deepStrictEqual(s.deco, [null, null, null]);
  assert.deepStrictEqual(s.titles, {});
  ["harmony", "rainbow", "season"].forEach(function (t) { assert(D.TRAITS[t], t); });
  ["deco_like", "deco_dislike", "deco_ok", "page_done", "sold", "title", "harmony", "rainbow", "visit"].forEach(function (k) {
    assert(global.PriTestAtelierHosts.ruri.lines[k], k);
  });
});

console.log("\n" + passed + " passed");
