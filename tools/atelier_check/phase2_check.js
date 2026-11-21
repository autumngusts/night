// ============================================================================
// 煉金術士（atelier）第 2 階段規則檢查（不需要瀏覽器）。規則依據 docs/atelier_design.md §8。
//   傳統色擴充與圖鑑、每日色彩、連續採色、白平衡、配方發想、錬金釜收集與升級、灰燼、素材箱擴充、
//   成品再投入（特性繼承）、素材升華、舊存檔遷移。
// 執行：node tools/atelier_check/phase2_check.js
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
var D = global.PriTestAtelierData, COLORS = global.PriTestAtelierColors;

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }
var DAY = 86400000;
var T0 = Date.UTC(2026, 10, 19, 3, 0, 0);   // JST 2026-11-19 12:00
function sw(hex) { return { rgb: C.hexToRgb(hex), hex: hex, frac: 0.3, shape: [[0, 0], [1, 0]] }; }
function colorById(id) { return COLORS.filter(function (c) { return c.id === id; })[0]; }
function mat(uid, el, cat, shape, q, traits) {
  return { uid: uid, hex: "#000000", rgb: [0, 0, 0], colorId: "sumi", element: el, category: cat,
    power: 2, quality: q || 50, traits: traits || [], shape: shape, at: T0 };
}

// ---------- C2 傳統色與圖鑑 ----------
test("傳統色：150 色以上、id 與 hex 不重複、稀有度 1～3", function () {
  assert(COLORS.length >= 150, COLORS.length);
  var ids = {}, hexes = {};
  COLORS.forEach(function (c) {
    assert(!ids[c.id], "id 重複 " + c.id); ids[c.id] = true;
    assert(!hexes[c.hex], "hex 重複 " + c.hex); hexes[c.hex] = true;
    assert(/^#[0-9A-F]{6}$/.test(c.hex), c.id);
    assert(c.rarity >= 1 && c.rarity <= 3, c.id);
    assert(c.name.zh && c.name.ja, c.id);
  });
});

test("圖鑑分組：代表色落在正確的色系，所有顏色都有分組", function () {
  assert.strictEqual(C.dexGroup(colorById("akane")), "red");
  assert.strictEqual(C.dexGroup(colorById("daidai")), "orange");
  assert.strictEqual(C.dexGroup(colorById("kiiro")), "yellow");
  assert.strictEqual(C.dexGroup(colorById("midori")), "green");
  assert.strictEqual(C.dexGroup(colorById("ruri")), "blue");
  assert.strictEqual(C.dexGroup(colorById("murasaki")), "purple");
  assert.strictEqual(C.dexGroup(colorById("kuri")), "brown");
  assert.strictEqual(C.dexGroup(colorById("shiro")), "mono");
  assert.strictEqual(C.dexGroup(colorById("sumi")), "mono");
  var total = C.dexGroups().reduce(function (a, g) { assert(g.colors.length > 0, g.id); return a + g.colors.length; }, 0);
  assert.strictEqual(total, COLORS.length);
});

test("第一次拍到的顏色：記入圖鑑、經驗 +5；同色第二次不加", function () {
  var s = C.newSave(T0);
  var r = C.captureEx(s, [sw("#1E50A2")], T0);
  assert.deepStrictEqual(r.newColors, ["ruri"]);
  var exp1 = s.exp;
  assert(exp1 >= D.DEX_EXP);
  r = C.captureEx(s, [sw("#1E50A2")], T0);
  assert.deepStrictEqual(r.newColors, []);
  assert.strictEqual(C.dexProgress(s).seen, 1);
  assert.strictEqual(C.dexProgress(s).total, COLORS.length);
});

// ---------- O3 每日色彩 ----------
test("每日色彩：同一個 JST 日期相同、一週內會換、不會出稀有度 3", function () {
  assert.strictEqual(C.dailyColor(T0).id, C.dailyColor(T0 + 3600000).id);
  var ids = {};
  for (var d = 0; d < 7; d++) { var c = C.dailyColor(T0 + d * DAY); ids[c.id] = true; assert(c.rarity < 3); }
  assert(Object.keys(ids).length >= 2);
  assert(C.isDailyHit(C.hexToRgb(C.dailyColor(T0).hex), T0));
});

test("拍到今日之色：素材帶「今日之色」，經驗 +50 一天只有一次", function () {
  var s = C.newSave(T0), hex = C.dailyColor(T0).hex;
  var r = C.captureEx(s, [sw(hex)], T0);
  assert.strictEqual(r.daily, true);
  assert(r.mats[0].traits.indexOf("daily_hue") >= 0);
  assert.strictEqual(r.exp, D.DEX_EXP + D.DAILY_EXP);
  r = C.captureEx(s, [sw(hex)], T0 + 60000);
  assert.strictEqual(r.daily, false);
  assert(r.mats[0].traits.indexOf("daily_hue") >= 0, "特性每次都有，經驗一天一次");
  assert.strictEqual(r.exp, 0);
});

// ---------- C9 連續採色 ----------
test("連續採色：同日不變、隔天 +1、中斷時減半再加今天", function () {
  var s = C.newSave(T0);
  assert.strictEqual(C.updateStreak(s, T0), 1);
  assert.strictEqual(C.updateStreak(s, T0 + 3600000), 1);
  assert.strictEqual(C.updateStreak(s, T0 + DAY), 2);
  assert.strictEqual(C.updateStreak(s, T0 + 2 * DAY), 3);
  assert.strictEqual(C.updateStreak(s, T0 + 5 * DAY), 2, "floor(3/2)+1");
  assert.strictEqual(C.streakBonus(1), 0);
  assert.strictEqual(C.streakBonus(4), 3);
  assert.strictEqual(C.streakBonus(50), D.STREAK_CAP);
});

test("連續採色的品質加成會反映在素材上", function () {
  var base = C.makeMaterial(sw("#7B8D42"), T0, 1).quality;
  var s = C.newSave(T0);
  s.streak = { n: 5, date: C.jstDate(T0 - DAY) };
  var r = C.captureEx(s, [sw("#7B8D42")], T0);
  assert.strictEqual(r.streak, 6);
  assert.strictEqual(r.mats[0].quality, Math.min(100, base + 5));
});

// ---------- O2 白平衡 ----------
test("白平衡：偏黃的白紙算出的增益可以把它拉回中性，增益有上下限", function () {
  var N = 32, a = new Uint8ClampedArray(N * N * 4);
  for (var i = 0; i < N * N; i++) { a[i * 4] = 250; a[i * 4 + 1] = 230; a[i * 4 + 2] = 180; a[i * 4 + 3] = 255; }
  var g = C.whiteBalanceGains(a, N, N);
  assert.strictEqual(g[0], 1);
  var fixed = C.applyGains(a, g);
  assert(Math.abs(fixed[0] - fixed[2]) <= 1 && Math.abs(fixed[0] - fixed[1]) <= 1, Array.prototype.slice.call(fixed, 0, 3));
  for (var j = 0; j < N * N; j++) a[j * 4 + 2] = 10;
  assert.strictEqual(C.whiteBalanceGains(a, N, N)[2], D.WB_GAIN_MAX);
});

test("白平衡 30 分內有效，有效期間素材品質 ×1.1", function () {
  var s = C.newSave(T0);
  C.setWhiteBalance(s, [1, 1, 1], T0);
  assert(C.wbActive(s, T0 + D.WB_VALID_MS - 1));
  assert(!C.wbActive(s, T0 + D.WB_VALID_MS));
  var base = C.makeMaterial(sw("#7B8D42"), T0, 1).quality;
  var r = C.captureEx(s, [sw("#7B8D42")], T0);
  assert.strictEqual(r.mats[0].quality, Math.min(100, Math.round(base * D.WB_QUALITY_MULT)));
});

// ---------- C3 配方發想 ----------
test("配方發想：沒有發想條件的配方一開始就會；有條件的要等級與發想都滿足", function () {
  var s = C.newSave(T0);
  var ids = C.recipesFor(s).map(function (r) { return r.id; });
  // 2026-11-21 第 6 階段（§12.1）新增 23 個配方系列：藥湯、繪具系列的第 1 個配方沒有發想條件，一開始就會
  assert.deepStrictEqual(ids, ["heal", "ink", "neutral", "elixir1", "paint1"]);
  s.exp = D.EXP_PER_LV;                       // Lv2
  assert.strictEqual(C.recipeAvailable(s, C.recipe("bomb")), false, "Lv2 但還沒做過中和劑");
  assert.deepStrictEqual(C.checkIdeas(s), []);
  s.made.neutral = 1;
  // 第 6 階段：料理、泉水系列的第 1 個配方也是「做過中和劑」
  assert.deepStrictEqual(C.checkIdeas(s), ["bomb", "cuisine1", "spring1"]);
  assert.deepStrictEqual(C.checkIdeas(s), [], "同一個配方只會想到一次");
  assert.strictEqual(C.recipeAvailable(s, C.recipe("bomb")), true);
});

test("發想條件：拍過某色、拍過 N 色、某屬性 N 色、最佳品質", function () {
  var s = C.newSave(T0);
  assert.strictEqual(C.ideaMet(s, { seen: "sumi" }), false);
  s.seen.sumi = true;
  assert.strictEqual(C.ideaMet(s, { seen: "sumi" }), true);
  COLORS.slice(0, 12).forEach(function (c) { s.seen[c.id] = true; });
  assert.strictEqual(C.ideaMet(s, { seenCount: 12 }), true);
  var wind = COLORS.filter(function (c) { return C.elementOf(C.rgbToHsv(C.hexToRgb(c.hex))) === "wind"; }).slice(0, 5);
  wind.forEach(function (c) { s.seen[c.id] = true; });
  assert.strictEqual(C.ideaMet(s, { seenEl: { el: "wind", n: 5 } }), true);
  assert.strictEqual(C.ideaMet(s, { quality: { recipe: "lamp", n: 60 } }), false);
  s.best.lamp = 60;
  assert.strictEqual(C.ideaMet(s, { quality: { recipe: "lamp", n: 60 } }), true);
});

test("還沒發想的配方不能開始調和", function () {
  var s = C.newSave(T0);
  s.exp = D.EXP_PER_LV;
  s.mats = [mat(1, "fire", "mineral", [[0, 0]]), mat(2, "spirit", "essence", [[0, 0]]), mat(3, "fire", "mineral", [[0, 0]])];
  assert.strictEqual(C.startSynthesis(s, "bomb", [1, 2, 3], "copper", T0).error, "recipe");
  s.ideas.bomb = true;
  assert.strictEqual(C.startSynthesis(s, "bomb", [1, 2, 3], "copper", T0).method, "board");
});

// ---------- C5 錬金釜、B6 升級、C10 灰燼 ----------
test("錬金釜：解鎖要等級與灰燼；沒有的釜不能用", function () {
  var s = C.newSave(T0);
  s.mats = [mat(1, "ice", "liquid", [[0, 0]]), mat(2, "wind", "plant", [[0, 0]]), mat(3, "wind", "plant", [[0, 0]])];
  assert.strictEqual(C.startSynthesis(s, "heal", [1, 2, 3], "iron", T0).error, "cauldron");
  s.ash = 100;
  assert.strictEqual(C.canUnlockCauldron(s, "iron"), false, "Lv1 不能解鎖");
  s.exp = D.EXP_PER_LV;
  assert.strictEqual(C.unlockCauldron(s, "iron"), true);
  assert.strictEqual(s.ash, 100 - D.CAULDRONS.iron.unlock.ash);
  assert.strictEqual(C.unlockCauldron(s, "iron"), false, "不能重複解鎖");
  assert.strictEqual(C.startSynthesis(s, "heal", [1, 2, 3], "iron", T0).size, 5);
});

test("B6 升級：每級品質上升率 +0.1，最高 Lv3，灰燼不足不能升", function () {
  var s = C.newSave(T0);
  assert.strictEqual(C.effectiveCauldron(s, "copper").qualityPerCell, 0.6);
  assert.strictEqual(C.upgradeCauldron(s, "copper"), false);
  s.ash = D.CAULDRON_UPGRADE_ASH[0] + D.CAULDRON_UPGRADE_ASH[1];
  assert.strictEqual(C.upgradeCauldron(s, "copper"), true);
  assert.strictEqual(C.effectiveCauldron(s, "copper").qualityPerCell, 0.7);
  assert.strictEqual(C.upgradeCauldron(s, "copper"), true);
  assert.strictEqual(C.effectiveCauldron(s, "copper").lv, 3);
  assert.strictEqual(C.upgradeCost(s, "copper"), null);
  assert.strictEqual(s.ash, 0);
});

test("擅長的配方：量表 ×1.2（銅之大釜擅長治癒藥水）", function () {
  var s = C.newSave(T0), eff = C.effectiveCauldron(s, "copper");
  var plain = Board.create(C.recipe("heal"), [mat(1, "wind", "plant", [[0, 0]])], D.CAULDRONS.copper, {});
  var good = Board.create(C.recipe("heal"), [mat(1, "wind", "plant", [[0, 0]])], eff, {});
  Board.place(plain, 0, 0, 4, 0); Board.place(good, 0, 0, 4, 0);
  var a = Board.evaluate(plain, false).gauges.wind, b = Board.evaluate(good, false);
  assert.strictEqual(b.gauges.wind, Math.round(a * D.AFFINITY_MULT));
  assert.strictEqual(b.mult, D.AFFINITY_MULT);
  var other = Board.create(C.recipe("bomb"), [mat(1, "fire", "mineral", [[0, 0]])], eff, {});
  Board.place(other, 0, 0, 0, 0);
  assert.strictEqual(Board.evaluate(other, false).mult, 1);
});

test("灰燼：被蓋掉的格子變成灰燼；品質未滿 30 再 +2；記錄做過的配方", function () {
  var s = C.newSave(T0);
  s.mats = [mat(1, "ice", "liquid", [[0, 0], [1, 0]], 10), mat(2, "wind", "plant", [[0, 0], [1, 0]], 10), mat(3, "wind", "plant", [[0, 0]], 10)];
  var ss = C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0);
  Board.place(ss, 0, 0, 2, 0);
  Board.place(ss, 1, 1, 2, 0);     // 蓋掉素材 1 的 1 格
  Board.place(ss, 2, 4, 4, 0);
  var item = C.finishSynthesis(s, ss, [], T0);
  assert(item.quality < D.ASH_LOW_QUALITY, "品質 " + item.quality);
  assert.strictEqual(item.ash, 1 + D.ASH_FAIL_BONUS);
  assert.strictEqual(s.ash, 1 + D.ASH_FAIL_BONUS);
  assert.strictEqual(s.made.heal, 1);
});

// 2026-11-21 第 6 階段（§12.2）：素材箱改成「基本 40、靠任務／委託／劇情擴充、上限 MAT_CAP」，不再用灰燼擴充
test("素材箱擴充：擴充後容量增加，滿了就不能採", function () {
  var s = C.newSave(T0);
  assert.strictEqual(C.matMax(s), D.MAT_BASE);
  assert.deepStrictEqual(C.grow(s, 20, 0), { box: 20, basket: 0 });
  assert.strictEqual(C.matMax(s), D.MAT_BASE + 20);
  for (var i = 0; i < C.matMax(s); i++) s.mats.push(mat(1000 + i, "fire", "mineral", [[0, 0]]));
  assert.strictEqual(C.captureEx(s, [sw("#1E50A2")], T0).error, "full");
});

// ---------- O9 成品再投入、B9 素材升華 ----------
test("成品當素材：類別＝配方類別、屬性＝最高量表、形狀依效果段數、特性繼承", function () {
  var item = { uid: 50, recipe: "heal", quality: 66, effects: [{ el: "wind", level: 2 }, { el: "ice", level: 1 }],
    traits: ["vivid"], gauges: { fire: 0, ice: 9, bolt: 0, wind: 14, spirit: 0 }, at: T0 };
  var m = C.itemAsMaterial(item);
  assert.strictEqual(m.category, "liquid");
  assert.strictEqual(m.element, "wind");
  assert.strictEqual(m.shape.length, 5, "2 + 2 + 1");
  assert.strictEqual(m.power, 4);
  assert.strictEqual(m.quality, 66);
  assert.deepStrictEqual(m.traits, ["vivid"]);
  assert.strictEqual(m.fromItem, "heal");
});

test("成品投入調和：可以放進素材格，完成後成品被用掉，特性可以繼承", function () {
  var s = C.newSave(T0);
  s.items = [{ uid: 50, recipe: "heal", quality: 66, effects: [{ el: "wind", level: 1 }], traits: ["vivid"],
    gauges: { fire: 0, ice: 9, bolt: 0, wind: 14, spirit: 0 }, at: T0 }];
  s.mats = [mat(1, "spirit", "essence", [[0, 0]])];
  s.nextUid = 60;
  var ss = C.startSynthesis(s, "ink", [50, 1], "copper", T0);
  assert.strictEqual(ss.mats[0].fromItem, "heal");
  Board.place(ss, 0, 0, 0, 0);
  Board.place(ss, 1, 4, 4, 0);
  assert(C.traitChoices(ss).indexOf("vivid") >= 0);
  var out = C.finishSynthesis(s, ss, ["vivid"], T0);
  assert.strictEqual(out.recipe, "ink");
  assert.deepStrictEqual(s.items.map(function (it) { return it.uid; }), [out.uid]);
  assert.strictEqual(s.mats.length, 0);
});

test("素材升華：同屬性 3 個 → 1 個，品質＝最高＋8，形狀取最大，特性合併最多 3 個", function () {
  var s = C.newSave(T0);
  s.mats = [mat(1, "fire", "mineral", [[0, 0]], 40, ["dusk"]), mat(2, "fire", "mineral", [[0, 0], [1, 0], [2, 0]], 70, ["vivid", "night"]),
    mat(3, "fire", "mineral", [[0, 0], [1, 0]], 55, ["hue_grace"]), mat(4, "ice", "liquid", [[0, 0]], 90)];
  s.nextUid = 10;
  assert.strictEqual(C.sublimate(s, [1, 2], T0).error, "count");
  assert.strictEqual(C.sublimate(s, [1, 2, 4], T0).error, "element");
  assert.strictEqual(C.sublimate(s, [1, 2, 2], T0).error, "missing");
  var m = C.sublimate(s, [1, 2, 3], T0);
  assert.strictEqual(m.uid, 10);
  assert.strictEqual(m.quality, 78);
  assert.strictEqual(m.shape.length, 3);
  assert.deepStrictEqual(m.traits, ["dusk", "vivid", "night"]);
  assert.deepStrictEqual(s.mats.map(function (x) { return x.uid; }), [4, 10]);
});

// ---------- 存檔遷移 ----------
test("第 1 階段的存檔：補上新欄位，原有資料不動", function () {
  var old = { v: 1, nextUid: 9, mats: [mat(1, "fire", "mineral", [[0, 0]])], items: [], basket: { n: 3, at: T0 }, cooldownUntil: 0,
    exp: 130, host: "ruri", hosts: { ruri: { aff: 12, task: 2 } }, best: { heal: 55 }, tutorial: 3, seen: { ruri: true }, log: [] };
  var s = C.migrate(JSON.parse(JSON.stringify(old)));
  assert.strictEqual(s.exp, 130);
  assert.strictEqual(s.hosts.ruri.task, 2);
  assert.deepStrictEqual(s.best, { heal: 55 });
  assert.deepStrictEqual(s.cauldrons, { copper: 1 });
  assert.strictEqual(s.ash, 0);
  assert.deepStrictEqual(s.ideas, {});
  assert.deepStrictEqual(s.streak, { n: 0, date: "" });
});

test("資料完整性：新配方的類別、發想條件、擅長配方都指向存在的資料；釜的 pattern 是正方形", function () {
  D.RECIPES.forEach(function (r) {
    assert(D.CATEGORIES.indexOf(r.cat) >= 0, r.id + " cat");
    if (r.idea && r.idea.made) assert(C.recipe(r.idea.made), r.id);
    if (r.idea && r.idea.quality) assert(C.recipe(r.idea.quality.recipe), r.id);
    if (r.idea && r.idea.seen) assert(colorById(r.idea.seen), r.id);
  });
  Object.keys(D.CAULDRONS).forEach(function (id) {
    var c = D.CAULDRONS[id];
    c.pattern.forEach(function (row) { assert.strictEqual(row.length, c.pattern.length, id); });
    c.affinity.forEach(function (rid) { assert(C.recipe(rid), id + " " + rid); });
  });
  assert.deepStrictEqual(Object.keys(D.CAULDRONS), D.CAULDRON_ORDER);
  ["idea", "daily", "sublimate", "upgrade"].forEach(function (k) { assert(global.PriTestAtelierHosts.ruri.lines[k], k); });
});

console.log("\n" + passed + " passed");
