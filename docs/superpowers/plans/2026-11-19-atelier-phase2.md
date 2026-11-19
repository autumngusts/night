# 煉金術士（atelier）第 2 階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在第 1 階段上加入以下系統：傳統色擴充到 154 色並做成圖鑑、每日色彩、連續採色、白平衡校正、配方發想（新增 4 種配方）、錬金釜收集與升級、灰燼、素材箱擴充、成品再投入（特性繼承）、素材升華，並讓第 1 階段的存檔可以直接沿用。

**Architecture:** 規則照舊集中在純函式的 `atelier_core.js`（加上 `migrate()`，讓舊存檔補上新欄位）。棋盤只多一個「擅長配方的量表倍率」。數值、配方、釜放在 `atelier_data.js`，顏色放在 `atelier_colors.js`。畫面 `atelier.js` 增加「圖鑑」和「工房」兩個分頁。第 1 階段的介面全部保留（`capture()` 仍然回傳素材陣列），所以第 1 階段的檢查不需要修改。

**Tech Stack:** Vanilla ES5 IIFE、Python 產生靜態 HTML（`generate.py`）、Node `assert` 的規則檢查、Playwright 的畫面檢查。

## Global Constraints

- 規則依據：`docs/atelier_design.md` §8（第 2 階段規則）與 §7（存檔）。數值都是「暫定」，集中在 `atelier_data.js`。
- 前綴照舊：`window.PriTestAtelier*`、`at_`、`at-`。樣式只放 `static_src/css/atelier.css`。
- 傳統色資料：自行整理的一般通行參考值，**不要從沒有授權的色票或清單複製**。
- 第 1 階段的檢查（`core_check.js` 23 項、`ui_check.js`）必須維持通過，不能修改它們的期望值。
- 存檔鍵仍是 `pritest-atelier-save-v1`（`v: 1`），新欄位一律由 `Core.migrate()` 補上。
- 修改既有檔案時用下面附的 Python 替換腳本（每段 `old` 都必須剛好出現 1 次，否則 assert 失敗並停止）。腳本放暫存目錄執行，不要提交。
- Playwright 一律用 `dispatchEvent`（CLAUDE.md §4.6）。
- 版本：`site_src/version.py` 遞增 minor → `2.76.0`（約跑的計畫以後要改用 `2.77.0`）。只推 `private`（`git push private main`）。
- 回覆、註解、文件、commit message 用繁體中文。

## 檔案結構

| 檔案 | 變更 |
|---|---|
| `static_src/atelier_colors.js` | 42 色 → 154 色（換成全文） |
| `static_src/atelier_data.js` | 錬金釜 4 個與升級、新配方 4 種與 `cat`／`idea`、`ITEM_SHAPES`、`daily_hue` 特性、第 2 階段常數 |
| `static_src/atelier_core.js` | `migrate`、`captureEx`、每日色彩、連續採色、白平衡、圖鑑、發想、釜、灰燼、素材箱、成品再投入、升華 |
| `static_src/atelier_method_board.js` | `evaluate()` 加上擅長配方的量表倍率，回傳 `mult` |
| `static_src/atelier_hosts.js` | 瑠璃新增台詞 `idea`／`daily`／`sublimate`／`upgrade` |
| `static_src/atelier.js` | 圖鑑、工房分頁；採色頁的每日色彩、連續天數、白平衡；選釜；成品投入；升華；發想提示（換成全文） |
| `static_src/css/atelier.css` | 分頁改成 3×2、每日色彩、圖鑑格線 |
| `site_src/i18n_atelier.py` | 第 2 階段字串 |
| `tools/atelier_check/phase2_check.js` | 第 2 階段規則檢查（新增） |
| `tools/atelier_check/ui2_check.js` | 第 2 階段畫面檢查（新增） |

## 介面（新增）

```js
Core.jstDate(ms) → "YYYY-MM-DD"；Core.dayDiff(d1, d2) → 天數
Core.migrate(save) → save                       // 補上 ideas, made, ash, cauldrons, shelf, streak, daily, wb
Core.captureEx(save, swatches, nowMs) → {mats, newColors, daily, streak, exp} | {error: "pick"|"basket"|"full"}
Core.capture(save, swatches, nowMs) → [material]|null   // 第 1 階段介面，內部呼叫 captureEx
Core.makeMaterial(swatch, nowMs, uid, opts?)    // opts = {streakBonus, wb, daily}
Core.updateStreak(save, nowMs) → n；Core.streakBonus(n) → 品質加值
Core.dailyColor(nowMs) → color；Core.isDailyHit(rgb, nowMs) → bool
Core.whiteBalanceGains(rgba, w, h) → [gr, gg, gb]；Core.applyGains(rgba, gains) → RGBA
Core.setWhiteBalance(save, gains, nowMs)；Core.wbActive(save, nowMs) → bool
Core.dexGroup(color) → "red"|"orange"|"yellow"|"green"|"blue"|"purple"|"brown"|"mono"
Core.dexGroups() → [{id, colors}]；Core.dexProgress(save) → {seen, total}
Core.ideaMet(save, idea) → bool；Core.recipeKnown(save, r)；Core.recipeAvailable(save, r)；Core.checkIdeas(save) → [recipeId]
Core.cauldronLv(save, id)；Core.canUnlockCauldron(save, id)；Core.unlockCauldron(save, id) → bool
Core.upgradeCost(save, id) → ash|null；Core.upgradeCauldron(save, id) → bool
Core.effectiveCauldron(save, id) → {id, lv, name, pattern, qualityPerCell, affinity, affinityMult}|null
Core.matMax(save)；Core.shelfCost(save) → ash|null；Core.upgradeShelf(save) → bool
Core.itemAsMaterial(item) → material（fromItem: recipeId）；Core.findMat(save, uid) → material|null
Core.sublimate(save, uids, nowMs) → material | {error: "count"|"missing"|"element"}
Core.startSynthesis(...) 新增 {error: "cauldron"}；matUids 可以包含成品的 uid
Core.finishSynthesis(...) 的 item 新增 ash；會增加 save.ash、save.made，並移除投入的成品
Board.evaluate(...) 回傳新增 mult（擅長配方時為 AFFINITY_MULT，否則 1）
```

---

### Task 1: 傳統色擴充與第 2 階段的規則檢查

**Files:**
- Modify: `static_src/atelier_colors.js`（換成全文）
- Create: `tools/atelier_check/phase2_check.js`

- [ ] **Step 1: 寫第 2 階段的規則檢查**（`tools/atelier_check/phase2_check.js`，全文）

```js
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
  assert.deepStrictEqual(ids, ["heal", "ink", "neutral"]);
  s.exp = D.EXP_PER_LV;                       // Lv2
  assert.strictEqual(C.recipeAvailable(s, C.recipe("bomb")), false, "Lv2 但還沒做過中和劑");
  assert.deepStrictEqual(C.checkIdeas(s), []);
  s.made.neutral = 1;
  assert.deepStrictEqual(C.checkIdeas(s), ["bomb"]);
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

test("素材箱擴充：每級 +20，滿了就不能採", function () {
  var s = C.newSave(T0);
  assert.strictEqual(C.matMax(s), D.MAT_MAX);
  s.ash = D.SHELF_ASH[0];
  assert.strictEqual(C.upgradeShelf(s), true);
  assert.strictEqual(C.matMax(s), D.MAT_MAX + D.SHELF_STEP);
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
```

- [ ] **Step 2: 跑檢查確認失敗**

Run: `node tools/atelier_check/phase2_check.js`
Expected: FAIL（第一個測試：`COLORS.length` 只有 42）

- [ ] **Step 3: 傳統色 154 色**（`static_src/atelier_colors.js`，全文）

```js
// 煉金術士（atelier）：日本傳統色（C2）。[id, hex, 日文名, 中文名, 稀有度 1～3]
// 第 2 階段擴充（2026-11-19）：自行整理的一般通行參考值，不是任何特定色票或書籍的複製；hex 與實物可能有些微差異。
// 稀有度：1 日常常見、2 較少見或需要特定場景、3 金屬色或極深的黑等特別難拍到的顏色。
(function () {
  "use strict";
  var rows = [
    // 紅・粉紅
    ["akane", "#B7282E", "茜色", "茜色", 2], ["beni", "#D7003A", "紅", "紅", 2], ["shu", "#EB6101", "朱色", "朱色", 1],
    ["hi", "#D3381C", "緋色", "緋色", 1], ["shojohi", "#E2041B", "猩々緋", "猩猩緋", 2], ["karakurenai", "#E95464", "韓紅", "韓紅", 2],
    ["enji", "#B94047", "臙脂", "胭脂", 1], ["suou", "#9E3D3F", "蘇芳", "蘇芳", 2], ["kokiake", "#D9333F", "深緋", "深緋", 2],
    ["akabeni", "#C53D43", "紅赤", "紅赤", 1], ["shinku", "#A22041", "真紅", "真紅", 2], ["ichigo", "#B5495B", "苺色", "莓色", 1],
    ["tougarashi", "#E83929", "唐辛子色", "辣椒色", 1], ["benikaba", "#BB5548", "紅樺色", "紅樺色", 1], ["bara", "#E9546B", "薔薇色", "薔薇色", 1],
    ["usubeni", "#F0908D", "薄紅", "薄紅", 1], ["momo", "#F09199", "桃色", "桃色", 1], ["toki", "#F4B3C2", "鴇色", "鴇色", 2],
    ["sango", "#F5B1AA", "珊瑚色", "珊瑚色", 2], ["sangoshu", "#EE836F", "珊瑚朱色", "珊瑚朱色", 2], ["nadeshiko", "#EEBBCB", "撫子色", "撫子色", 2],
    ["tsutsuji", "#E95295", "躑躅色", "躑躅色", 2], ["kobai", "#E16B8C", "紅梅色", "紅梅色", 2], ["botan", "#E7609E", "牡丹色", "牡丹色", 2],
    ["sakura", "#FEF4F4", "桜色", "櫻色", 1], ["usuzakura", "#FDEFF2", "薄桜", "薄櫻", 1], ["haizakura", "#E8D3D1", "灰桜", "灰櫻", 1],
    ["sakuranezumi", "#E9DFE5", "桜鼠", "櫻鼠", 2], ["umenezumi", "#C099A0", "梅鼠", "梅鼠", 2],
    // 橙
    ["kaki", "#ED6D3D", "柿色", "柿色", 1], ["daidai", "#EE7800", "橙色", "橙色", 1], ["ninjin", "#EC6D51", "人参色", "胡蘿蔔色", 1],
    ["kaba", "#CD5E3C", "樺色", "樺色", 1], ["kanzou", "#F3981D", "萱草色", "萱草色", 1], ["mikan", "#F08300", "蜜柑色", "橘子色", 1],
    ["ouni", "#F39800", "黄丹", "黃丹", 2], ["sharegaki", "#F7B977", "洒落柿", "灑落柿", 2], ["araishu", "#EF8F74", "洗朱", "洗朱", 2],
    ["terigaki", "#C47222", "照柿", "照柿", 2],
    // 黃
    ["yamabuki", "#F8B500", "山吹色", "棣棠色", 2], ["kiiro", "#FFD900", "黄色", "黃色", 1], ["kariyasu", "#F5E56B", "刈安色", "刈安色", 2],
    ["kuchinashi", "#FFDB4F", "梔子色", "梔子色", 1], ["tamago", "#FCD575", "玉子色", "蛋黃色", 1], ["nanohana", "#FFEC47", "菜の花色", "油菜花色", 1],
    ["himawari", "#FCC800", "向日葵色", "向日葵色", 1], ["ukon", "#FABF14", "鬱金色", "鬱金色", 2], ["kihada", "#FEF263", "黄蘗色", "黃蘗色", 2],
    ["remon", "#FFF33F", "レモン色", "檸檬色", 1], ["ominaeshi", "#F2F2B0", "女郎花", "女郎花", 2], ["torinoko", "#FFF1CF", "鳥の子色", "鳥之子色", 1],
    ["kincha", "#C89932", "金茶", "金茶", 2], ["odo", "#C39143", "黄土色", "黃土色", 1], ["kitsune", "#C38743", "狐色", "狐色", 1],
    ["kohaku", "#BF783A", "琥珀色", "琥珀色", 2],
    // 綠
    ["uguisu", "#928C36", "鶯色", "鶯色", 2], ["moegi", "#AACF53", "萌黄", "萌黃", 1], ["wakakusa", "#C3D825", "若草色", "若草色", 1],
    ["wakaba", "#B9D08B", "若葉色", "嫩葉色", 1], ["hiwa", "#D7CF3A", "鶸色", "鶸色", 2], ["matcha", "#C5C56A", "抹茶色", "抹茶色", 1],
    ["wasabi", "#A8BF93", "山葵色", "山葵色", 1], ["yanagi", "#A8C97F", "柳色", "柳色", 1], ["byakuroku", "#DBEBC4", "白緑", "白綠", 2],
    ["koke", "#69821B", "苔色", "苔色", 1], ["matsuba", "#839B5C", "松葉色", "松葉色", 1], ["kusa", "#7B8D42", "草色", "草色", 1],
    ["yomogi", "#7A942E", "蓬色", "艾草色", 1], ["midori", "#3EB370", "緑", "綠", 1], ["fukamidori", "#00552E", "深緑", "深綠", 1],
    ["wakatake", "#68BE8D", "若竹色", "若竹色", 1], ["aotake", "#7EBEAB", "青竹色", "青竹色", 1], ["tokiwa", "#007B43", "常磐色", "常盤色", 2],
    ["rokusho", "#47885E", "緑青", "綠青", 2], ["tokusa", "#3B7960", "木賊色", "木賊色", 2], ["aomidori", "#00A381", "青緑", "青綠", 1],
    ["seiji", "#7EBEA5", "青磁色", "青瓷色", 2], ["rikyunezumi", "#888E7E", "利休鼠", "利休鼠", 2], ["tetsu", "#005243", "鉄色", "鐵色", 1],
    // 藍
    ["kamenozoki", "#A2D7DD", "瓶覗", "瓶窺", 2], ["mizu", "#BCE2E8", "水色", "水色", 1], ["sora", "#A0D8EF", "空色", "空色", 1],
    ["wasurenagusa", "#89C3EB", "勿忘草色", "勿忘草色", 2], ["mizuasagi", "#80ABA9", "水浅葱", "水淺蔥", 2], ["shinbashi", "#59B9C6", "新橋色", "新橋色", 2],
    ["asagi", "#00A3AF", "浅葱色", "淺蔥色", 2], ["nando", "#008899", "納戸色", "納戶色", 1], ["hanaasagi", "#2A83A2", "花浅葱", "花淺蔥", 2],
    ["tsuyukusa", "#38A1DB", "露草色", "鴨跖草色", 2], ["ao", "#0095D9", "青", "青", 1], ["hanada", "#2792C3", "縹色", "縹色", 2],
    ["masuhana", "#5B7E91", "舛花色", "舛花色", 2], ["ainezumi", "#6C848D", "藍鼠", "藍鼠", 1], ["ai", "#165E83", "藍色", "藍色", 1],
    ["ruri", "#1E50A2", "瑠璃色", "瑠璃色", 3], ["rurikon", "#19448E", "瑠璃紺", "瑠璃紺", 2], ["gunjo", "#4C6CB3", "群青色", "群青色", 2],
    ["kakitsubata", "#3E62AD", "杜若色", "杜若色", 2], ["konjo", "#113285", "紺青", "紺青", 2], ["kon", "#223A70", "紺色", "紺色", 1],
    ["tetsukon", "#17184B", "鉄紺", "鐵紺", 2],
    // 紫
    ["kikyo", "#5654A2", "桔梗色", "桔梗色", 2], ["sumire", "#7058A3", "菫色", "堇色", 2], ["edomurasaki", "#745399", "江戸紫", "江戶紫", 2],
    ["fuji", "#BBBCDE", "藤色", "藤色", 1], ["fujimurasaki", "#A59ACA", "藤紫", "藤紫", 1], ["fujinezumi", "#A6A5C4", "藤鼠", "藤鼠", 1],
    ["shion", "#867BA9", "紫苑色", "紫苑色", 2], ["hatoba", "#95859C", "鳩羽色", "鳩羽色", 2], ["murasaki", "#884898", "紫", "紫", 2],
    ["kodaimurasaki", "#895B8A", "古代紫", "古代紫", 2], ["kyomurasaki", "#9D5B8B", "京紫", "京紫", 2], ["nasukon", "#824880", "茄子紺", "茄子紺", 1],
    ["ayame", "#CC7EB1", "菖蒲色", "菖蒲色", 2], ["benifuji", "#CCA6BF", "紅藤色", "紅藤色", 2], ["kuwanomi", "#55295B", "桑の実色", "桑椹色", 2],
    ["budou", "#522F60", "葡萄色", "葡萄色", 2], ["fukamurasaki", "#493759", "深紫", "深紫", 2],
    // 茶
    ["azuki", "#96514D", "小豆色", "紅豆色", 1], ["ebicha", "#6C2C2F", "海老茶", "海老茶", 1], ["cha", "#965042", "茶色", "茶色", 1],
    ["tobi", "#95483F", "鳶色", "鳶色", 1], ["benigara", "#9F563A", "弁柄色", "紅殼色", 1], ["sabi", "#6C3524", "錆色", "鏽色", 1],
    ["kuri", "#762F07", "栗色", "栗色", 1], ["kurumi", "#A86F4C", "胡桃色", "胡桃色", 1], ["rakuda", "#BF794E", "駱駝色", "駱駝色", 1],
    ["kogecha", "#6F4B3E", "焦茶", "焦茶", 1], ["kurocha", "#583822", "黒茶", "黑茶", 1], ["kobicha", "#716246", "媚茶", "媚茶", 2],
    ["uguisucha", "#715C1F", "鶯茶", "鶯茶", 2], ["rikyucha", "#A59564", "利休茶", "利休茶", 2], ["shiracha", "#DCD3B2", "白茶", "白茶", 1],
    ["kurotobi", "#554738", "黒鳶", "黑鳶", 1],
    // 白・灰・黑
    ["shiro", "#FFFFFF", "白", "白", 1], ["gofun", "#FFFFFC", "胡粉色", "胡粉色", 1], ["shironeri", "#F3F3F2", "白練", "白練", 1],
    ["kinari", "#FBFAF5", "生成り色", "生成色", 1], ["zouge", "#F8F4E6", "象牙色", "象牙色", 1], ["shironezumi", "#DCDDDD", "白鼠", "白鼠", 1],
    ["nezumi", "#949495", "鼠色", "鼠色", 1], ["hai", "#7D7D7D", "灰色", "灰色", 1], ["namari", "#7B7C7D", "鉛色", "鉛色", 1],
    ["nibi", "#727171", "鈍色", "鈍色", 1], ["sumi", "#595857", "墨", "墨", 1], ["keshizumi", "#524748", "消炭色", "消炭色", 1],
    ["kuro", "#2B2B2B", "黒", "黑", 1], ["tetsuguro", "#281A14", "鉄黒", "鐵黑", 2], ["nurebairo", "#180614", "濡羽色", "濡羽色", 3],
    ["shikkoku", "#0D0015", "漆黒", "漆黑", 3],
    // 金屬
    ["kin", "#E6B422", "金色", "金色", 3], ["gin", "#AFAFB0", "銀色", "銀色", 3], ["dou", "#B87333", "銅色", "銅色", 3],
    ["shakudo", "#752100", "赤銅色", "赤銅色", 3]
  ];
  var list = rows.map(function (r) {
    return { id: r[0], hex: r[1], name: { ja: r[2], zh: r[3], en: r[0] }, rarity: r[4] };
  });
  if (typeof module !== "undefined" && module.exports) module.exports = list;
  else window.PriTestAtelierColors = list;
})();
```

- [ ] **Step 4: 確認第 1 個測試通過、第 1 階段沒有壞**

Run: `node tools/atelier_check/phase2_check.js; node tools/atelier_check/core_check.js`
Expected: phase2 第 1 個測試 ok，第 2 個測試失敗（`C.dexGroup is not a function`）；core_check `23 passed`

- [ ] **Step 5: Commit**

```bash
git add static_src/atelier_colors.js tools/atelier_check/phase2_check.js
git commit -m "feat(atelier): 傳統色擴充到 154 色與第 2 階段規則檢查"
```

---

### Task 2: 第 2 階段的規則

**Files:**
- Modify: `static_src/atelier_data.js`, `static_src/atelier_core.js`, `static_src/atelier_method_board.js`, `static_src/atelier_hosts.js`

**Interfaces:**
- Produces: 「介面（新增）」一節的全部函式

- [ ] **Step 1: 數值表**：在 repo 根目錄執行下面的腳本（存到暫存目錄，例如 `p2data.py`，再用 `py -3 <路徑>` 執行）

```python
import pathlib
p = pathlib.Path("static_src/atelier_data.js"); s = p.read_text(encoding="utf-8")
def rep(old, new):
    global s
    assert s.count(old) == 1, old
    s = s.replace(old, new)
rep('''      copper: {
        name: { zh: "銅之大釜", ja: "銅の大釜", en: "Copper Cauldron" },
        qualityPerCell: 0.6,
        pattern: ["f.*.i", ".F.I.", "*.s.*", ".W.B.", "w.*.b"]
      }
    },''', '''      copper: {
        name: { zh: "銅之大釜", ja: "銅の大釜", en: "Copper Cauldron" },
        qualityPerCell: 0.6, unlock: null, affinity: ["heal", "ink", "neutral"],
        pattern: ["f.*.i", ".F.I.", "*.s.*", ".W.B.", "w.*.b"]
      },
      // 第 2 階段（C5）：依等級與灰燼解鎖；affinity＝擅長的配方，量表 ×AFFINITY_MULT
      iron: {
        name: { zh: "鐵之大釜", ja: "鉄の大釜", en: "Iron Cauldron" },
        qualityPerCell: 0.8, unlock: { lv: 2, ash: 10 }, affinity: ["bomb", "pigment"],
        pattern: ["*.f.*", ".F*B.", "f*.*b", ".B*F.", "*.b.*"]
      },
      glass: {
        name: { zh: "玻璃之釜", ja: "ガラスの釜", en: "Glass Cauldron" },
        qualityPerCell: 0.4, unlock: { lv: 3, ash: 20 }, affinity: ["frost", "heal", "charm"],
        pattern: ["i.w.i.", ".I..W.", "w.s.s.", ".s.s.w", ".W..I.", ".i.w.i"]
      },
      star: {
        name: { zh: "星之釜", ja: "星の釜", en: "Star Cauldron" },
        qualityPerCell: 0.5, unlock: { lv: 4, ash: 40 }, affinity: ["lamp", "prism", "shade"],
        pattern: ["s..*..s", ".b...b.", "..S.S..", "*..*..*", "..S.S..", ".b...b.", "s..*..s"]
      }
    },
    CAULDRON_ORDER: ["copper", "iron", "glass", "star"],
    AFFINITY_MULT: 1.2,              // 擅長的配方：量表 ×1.2（暫定）
    CAULDRON_LV_MAX: 3,
    CAULDRON_UPGRADE_ASH: [10, 25],  // B6：Lv1→2、Lv2→3 的灰燼（暫定）
    CAULDRON_LV_QUALITY: 0.1,        // 每升 1 級，品質上升率 +0.1（暫定）
    SHELF_STEP: 20, SHELF_ASH: [8, 16, 30],   // B6 素材箱擴充：每級 +20，共 3 級（暫定）
    ASH_LOW_QUALITY: 30, ASH_FAIL_BONUS: 2,   // C10：品質未滿 30 的成品另外 +2 灰燼（暫定）''')
rep('{ id: "heal", lv: 1, needs: ["liquid", "plant", "*"],', '{ id: "heal", lv: 1, cat: "liquid", needs: ["liquid", "plant", "*"],')
rep('{ id: "ink", lv: 1, needs: ["*", "*"],', '{ id: "ink", lv: 1, cat: "essence", needs: ["*", "*"],')
rep('{ id: "neutral", lv: 1, needs: ["liquid", "mineral", "*"],', '{ id: "neutral", lv: 1, cat: "liquid", needs: ["liquid", "mineral", "*"],')
rep('{ id: "bomb", lv: 2, needs: ["mineral", "essence", "*"],', '{ id: "bomb", lv: 2, cat: "mineral", idea: { made: "neutral" }, needs: ["mineral", "essence", "*"],')
rep('{ id: "lamp", lv: 3, needs: ["crystal", "mineral", "*", "*"],', '{ id: "lamp", lv: 3, cat: "crystal", idea: { seenCount: 20 }, needs: ["crystal", "mineral", "*", "*"],')
rep('{ id: "charm", lv: 3, needs: ["plant", "essence", "*", "*"],', '{ id: "charm", lv: 3, cat: "plant", idea: { seenEl: { el: "wind", n: 5 } }, needs: ["plant", "essence", "*", "*"],')
rep('''          { el: "spirit", steps: [{ at: 10, kind: "speed", n: 1 }, { at: 22, kind: "speed", n: 2 }] }
        ] }
    ],''', '''          { el: "spirit", steps: [{ at: 10, kind: "speed", n: 1 }, { at: 22, kind: "speed", n: 2 }] }
        ] },
      // 第 2 階段（C3 配方發想）新增
      { id: "pigment", lv: 2, cat: "mineral", idea: { seenCount: 12 }, needs: ["mineral", "*"],
        name: { zh: "顏料塊", ja: "顔料のかたまり", en: "Pigment Cake" },
        gauges: [
          { el: "fire", steps: [{ at: 6, kind: "dye", n: 1 }, { at: 12, kind: "dye", n: 2 }, { at: 18, kind: "dye", n: 3 }] },
          { el: "bolt", steps: [{ at: 8, kind: "value", n: 40 }, { at: 16, kind: "value", n: 80 }] }
        ] },
      { id: "frost", lv: 2, cat: "crystal", idea: { seenEl: { el: "ice", n: 6 } }, needs: ["crystal", "liquid", "*"],
        name: { zh: "冰晶", ja: "氷晶", en: "Frost Crystal" },
        gauges: [
          { el: "ice", steps: [{ at: 8, kind: "freeze", n: 1 }, { at: 16, kind: "freeze", n: 2 }, { at: 24, kind: "freeze", n: 3 }] },
          { el: "spirit", steps: [{ at: 10, kind: "value", n: 50 }, { at: 20, kind: "value", n: 100 }] }
        ] },
      { id: "shade", lv: 3, cat: "shadow", idea: { seen: "sumi" }, needs: ["shadow", "plant", "*", "*"],
        name: { zh: "影之斗篷", ja: "影のマント", en: "Shade Cloak" },
        gauges: [
          { el: "spirit", steps: [{ at: 10, kind: "guard", n: 15 }, { at: 20, kind: "guard", n: 30 }, { at: 30, kind: "guard", n: 50 }] },
          { el: "wind", steps: [{ at: 10, kind: "speed", n: 1 }, { at: 22, kind: "speed", n: 2 }] }
        ] },
      { id: "prism", lv: 4, cat: "crystal", idea: { quality: { recipe: "lamp", n: 60 } }, needs: ["crystal", "essence", "*", "*"],
        name: { zh: "稜鏡", ja: "プリズム", en: "Prism" },
        gauges: [
          { el: "bolt", steps: [{ at: 12, kind: "light", n: 2 }, { at: 24, kind: "light", n: 3 }, { at: 36, kind: "light", n: 4 }] },
          { el: "spirit", steps: [{ at: 12, kind: "value", n: 80 }, { at: 26, kind: "value", n: 200 }] }
        ] }
    ],
    // O9 成品再投入：成品當素材時的形狀（依格數）
    ITEM_SHAPES: {
      3: [[0, 0], [1, 0], [0, 1]],
      4: [[0, 0], [1, 0], [2, 0], [1, 1]],
      5: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
      6: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]
    },''')
rep('''      vivid: { cost: 12, quality: 10, name: { zh: "鮮豔", ja: "あざやか", en: "Vivid" } }''',
    '''      vivid: { cost: 12, quality: 10, name: { zh: "鮮豔", ja: "あざやか", en: "Vivid" } },
      daily_hue: { cost: 8, boost: 15, name: { zh: "今日之色", ja: "今日の色", en: "Color of the Day" } }''')
rep('''    VIVID_QUALITY: 80''', '''    VIVID_QUALITY: 80,

    // ---------- 第 2 階段 ----------
    DEX_EXP: 5,                      // C2 圖鑑：第一次拍到某個傳統色，經驗 +5（暫定）
    DEX_GROUPS: ["red", "orange", "yellow", "green", "blue", "purple", "brown", "mono"],
    DAILY_TOLERANCE: 20,             // O3 每日色彩：ΔE 20 以內也算拍到（暫定）
    DAILY_EXP: 50,
    STREAK_STEP: 1, STREAK_CAP: 10,  // C9 連續採色：每天 +1 品質，最多 +10；中斷時減半（暫定）
    WB_VALID_MS: 30 * 60000,         // O2 白平衡校正：30 分內有效（暫定）
    WB_QUALITY_MULT: 1.1,
    WB_GAIN_MIN: 0.5, WB_GAIN_MAX: 2,
    SUBLIMATE_N: 3, SUBLIMATE_BONUS: 8   // B9 素材升華：同屬性 3 個 → 1 個，品質＝最高者＋8（暫定）''')
p.write_text(s, encoding="utf-8", newline="\n")
print("ok")
```

  Expected: 印出 `ok`

- [ ] **Step 2: 規則核心、棋盤、瑠璃台詞**：同樣用下面的腳本修改

```python
import pathlib
p = pathlib.Path("static_src/atelier_core.js"); s = p.read_text(encoding="utf-8")
def rep(old, new):
    global s
    assert s.count(old) == 1, old
    s = s.replace(old, new)

rep('''  function inRange(h, from, to) { return from <= to ? (h >= from && h < to) : (h >= from || h < to); }''',
'''  function inRange(h, from, to) { return from <= to ? (h >= from && h < to) : (h >= from || h < to); }
  function jstDate(ms) { return new Date(ms + JST).toISOString().slice(0, 10); }
  function dayDiff(d1, d2) { return Math.round((Date.parse(d2) - Date.parse(d1)) / 86400000); }''')

rep('''  function makeMaterial(swatch, now, uid) {
    var hsv = rgbToHsv(swatch.rgb), el = elementOf(hsv), near = nearestColor(swatch.rgb);
    var purity = 1 - Math.min(near.dist, D.PURITY_RANGE) / D.PURITY_RANGE;
    var quality = clamp(Math.round(15 + 45 * hsv.s + 40 * purity), 1, 100);
    var traits = timeTraits(now);''',
'''  // opts（第 2 階段）：{ streakBonus: C9 連續採色的品質加值, wb: O2 白平衡有效, daily: O3 拍到今日之色 }
  function makeMaterial(swatch, now, uid, opts) {
    opts = opts || {};
    var hsv = rgbToHsv(swatch.rgb), el = elementOf(hsv), near = nearestColor(swatch.rgb);
    var purity = 1 - Math.min(near.dist, D.PURITY_RANGE) / D.PURITY_RANGE;
    var quality = clamp(Math.round(15 + 45 * hsv.s + 40 * purity), 1, 100);
    if (opts.streakBonus) quality = clamp(quality + opts.streakBonus, 1, 100);
    if (opts.wb) quality = clamp(Math.round(quality * D.WB_QUALITY_MULT), 1, 100);
    var traits = timeTraits(now);
    if (opts.daily) traits.push("daily_hue");''')

rep('''  function newSave(now) {
    return { v: 1, nextUid: 1, mats: [], items: [], basket: { n: D.BASKET_MAX, at: now }, cooldownUntil: 0,
      exp: 0, host: "ruri", hosts: { ruri: { aff: 0, task: 0 } }, best: {}, tutorial: 0, seen: {}, log: [] };
  }''',
'''  function newSave(now) {
    return migrate({ v: 1, nextUid: 1, mats: [], items: [], basket: { n: D.BASKET_MAX, at: now }, cooldownUntil: 0,
      exp: 0, host: "ruri", hosts: { ruri: { aff: 0, task: 0 } }, best: {}, tutorial: 0, seen: {}, log: [] });
  }
  // 第 1 階段的存檔補上第 2 階段的欄位（原有資料不動）
  function migrate(save) {
    var def = { ideas: {}, made: {}, ash: 0, cauldrons: { copper: 1 }, shelf: 0, streak: { n: 0, date: "" },
      daily: { date: "" }, wb: null, best: {}, seen: {}, log: [], tutorial: 0 };
    Object.keys(def).forEach(function (k) { if (save[k] === undefined) save[k] = def[k]; });
    if (!save.cauldrons.copper) save.cauldrons.copper = 1;
    return save;
  }''')

rep('''  // 選 1～PICK_MAX 個色塊，消耗 1 籃 → 回傳新增的素材；失敗回傳 null
  function capture(save, swatches, now) {
    refillBasket(save, now);
    if (!swatches.length || swatches.length > D.PICK_MAX || save.basket.n <= 0) return null;
    if (save.mats.length + swatches.length > D.MAT_MAX) return null;
    if (save.basket.n >= D.BASKET_MAX) save.basket.at = now;
    save.basket.n--;
    var added = swatches.map(function (s) { var m = makeMaterial(s, now, save.nextUid++); save.mats.push(m); save.seen[m.colorId] = true; return m; });
    return added;
  }''',
'''  // C9 連續採色：同一天不變、隔天 +1、中斷時減半再加今天
  function updateStreak(save, now) {
    var today = jstDate(now), st = save.streak;
    if (st.date === today) return st.n;
    st.n = !st.date ? 1 : dayDiff(st.date, today) === 1 ? st.n + 1 : Math.floor(st.n / 2) + 1;
    st.date = today;
    return st.n;
  }
  function streakBonus(n) { return Math.min(D.STREAK_CAP, Math.max(0, n - 1) * D.STREAK_STEP); }
  // 選 1～PICK_MAX 個色塊，消耗 1 籃。回傳 {mats, newColors, daily, streak, exp} 或 {error: "pick"|"basket"|"full"}
  function captureEx(save, swatches, now) {
    refillBasket(save, now);
    if (!swatches.length || swatches.length > D.PICK_MAX) return { error: "pick" };
    if (save.basket.n <= 0) return { error: "basket" };
    if (save.mats.length + swatches.length > matMax(save)) return { error: "full" };
    if (save.basket.n >= D.BASKET_MAX) save.basket.at = now;
    save.basket.n--;
    var n = updateStreak(save, now), wb = wbActive(save, now), today = jstDate(now);
    var res = { mats: [], newColors: [], daily: false, streak: n, exp: 0 };
    swatches.forEach(function (s) {
      var hit = isDailyHit(s.rgb, now);
      var m = makeMaterial(s, now, save.nextUid++, { wb: wb, streakBonus: streakBonus(n), daily: hit });
      save.mats.push(m);
      if (!save.seen[m.colorId]) { save.seen[m.colorId] = true; res.newColors.push(m.colorId); res.exp += D.DEX_EXP; }
      if (hit && save.daily.date !== today) { save.daily = { date: today }; res.daily = true; res.exp += D.DAILY_EXP; }
      res.mats.push(m);
    });
    save.exp += res.exp;
    return res;
  }
  // 第 1 階段的介面：成功回傳新增的素材，失敗回傳 null
  function capture(save, swatches, now) { var r = captureEx(save, swatches, now); return r.error ? null : r.mats; }

  // ---------- O3 每日色彩、O2 白平衡、C2 圖鑑 ----------
  function dailyColor(now) {
    var pool = COLORS.filter(function (c) { return c.rarity < 3; });
    return pool[hash("daily:" + jstDate(now)) % pool.length];
  }
  function isDailyHit(rgb, now) {
    var d = dailyColor(now);
    return nearestColor(rgb).color.id === d.id || deltaE(rgbToLab(rgb), rgbToLab(hexToRgb(d.hex))) <= D.DAILY_TOLERANCE;
  }
  // 拍白紙：取中央一半的平均色，算出讓三個通道一樣亮的增益
  function whiteBalanceGains(rgba, w, h) {
    var sum = [0, 0, 0], n = 0;
    for (var y = Math.floor(h / 4); y < Math.ceil(h * 3 / 4); y++) for (var x = Math.floor(w / 4); x < Math.ceil(w * 3 / 4); x++) {
      var i = (y * w + x) * 4; sum[0] += rgba[i]; sum[1] += rgba[i + 1]; sum[2] += rgba[i + 2]; n++;
    }
    var avg = sum.map(function (v) { return Math.max(1, v / n); }), top = Math.max(avg[0], avg[1], avg[2]);
    return avg.map(function (a) { return clamp(top / a, D.WB_GAIN_MIN, D.WB_GAIN_MAX); });
  }
  function applyGains(rgba, gains) {
    var out = new Uint8ClampedArray(rgba.length);
    for (var i = 0; i < rgba.length; i += 4) {
      out[i] = rgba[i] * gains[0]; out[i + 1] = rgba[i + 1] * gains[1]; out[i + 2] = rgba[i + 2] * gains[2]; out[i + 3] = rgba[i + 3];
    }
    return out;
  }
  function setWhiteBalance(save, gains, now) { save.wb = { gains: gains, until: now + D.WB_VALID_MS }; }
  function wbActive(save, now) { return !!(save.wb && now < save.wb.until); }
  function dexGroup(color) {
    var hsv = rgbToHsv(hexToRgb(color.hex)), h = hsv.h;
    if (hsv.s < 0.12 || (hsv.s < 0.25 && hsv.v < 0.3)) return "mono";
    if ((h < 50 || h >= 345) && hsv.v < 0.6 && hsv.s > 0.3) return "brown";
    if (h >= 330 || h < 15) return "red";
    if (h < 45) return "orange";
    if (h < 70) return "yellow";
    if (h < 170) return "green";
    if (h < 250) return "blue";
    return "purple";
  }
  function dexGroups() {
    return D.DEX_GROUPS.map(function (g) { return { id: g, colors: COLORS.filter(function (c) { return dexGroup(c) === g; }) }; });
  }
  function dexProgress(save) {
    return { seen: COLORS.filter(function (c) { return save.seen[c.id]; }).length, total: COLORS.length };
  }

  // ---------- C3 配方發想 ----------
  function seenElCount(save, el) {
    return COLORS.filter(function (c) { return save.seen[c.id] && elementOf(rgbToHsv(hexToRgb(c.hex))) === el; }).length;
  }
  function ideaMet(save, idea) {
    if (idea.seen) return !!save.seen[idea.seen];
    if (idea.seenCount) return dexProgress(save).seen >= idea.seenCount;
    if (idea.seenEl) return seenElCount(save, idea.seenEl.el) >= idea.seenEl.n;
    if (idea.made) return (save.made[idea.made] || 0) > 0;
    if (idea.quality) return (save.best[idea.quality.recipe] || 0) >= idea.quality.n;
    return false;
  }
  function recipeKnown(save, r) { return !r.idea || !!save.ideas[r.id]; }
  function recipeAvailable(save, r) { return r.lv <= level(save) && recipeKnown(save, r); }
  // 檢查所有還沒發想的配方，回傳這次新想到的配方 id
  function checkIdeas(save) {
    var out = [];
    D.RECIPES.forEach(function (r) {
      if (r.idea && !save.ideas[r.id] && ideaMet(save, r.idea)) { save.ideas[r.id] = true; out.push(r.id); }
    });
    return out;
  }

  // ---------- C5 錬金釜、B6 升級、C10 灰燼 ----------
  function cauldronLv(save, id) { return save.cauldrons[id] || 0; }
  function canUnlockCauldron(save, id) {
    var c = D.CAULDRONS[id];
    return !!c && !cauldronLv(save, id) && !!c.unlock && level(save) >= c.unlock.lv && save.ash >= c.unlock.ash;
  }
  function unlockCauldron(save, id) {
    if (!canUnlockCauldron(save, id)) return false;
    save.ash -= D.CAULDRONS[id].unlock.ash; save.cauldrons[id] = 1;
    return true;
  }
  function upgradeCost(save, id) {
    var lv = cauldronLv(save, id);
    return lv && lv < D.CAULDRON_LV_MAX ? D.CAULDRON_UPGRADE_ASH[lv - 1] : null;
  }
  function upgradeCauldron(save, id) {
    var cost = upgradeCost(save, id);
    if (cost === null || save.ash < cost) return false;
    save.ash -= cost; save.cauldrons[id]++;
    return true;
  }
  // 調和實際使用的釜：品質上升率加上升級；擅長的配方量表 ×affinityMult
  function effectiveCauldron(save, id) {
    var c = D.CAULDRONS[id], lv = cauldronLv(save, id);
    if (!c || !lv) return null;
    return { id: id, lv: lv, name: c.name, pattern: c.pattern, affinity: c.affinity, affinityMult: D.AFFINITY_MULT,
      qualityPerCell: Math.round((c.qualityPerCell + (lv - 1) * D.CAULDRON_LV_QUALITY) * 100) / 100 };
  }
  function matMax(save) { return D.MAT_MAX + (save.shelf || 0) * D.SHELF_STEP; }
  function shelfCost(save) { var c = D.SHELF_ASH[save.shelf]; return c === undefined ? null : c; }
  function upgradeShelf(save) {
    var cost = shelfCost(save);
    if (cost === null || save.ash < cost) return false;
    save.ash -= cost; save.shelf++;
    return true;
  }

  // ---------- O9 成品再投入、B9 素材升華 ----------
  function itemAsMaterial(item) {
    var r = recipe(item.recipe), best = null, maxLv = 0, sumLv = 0, e = null;
    Object.keys(item.gauges).forEach(function (k) { if (best === null || item.gauges[k] > item.gauges[best]) best = k; });
    item.effects.forEach(function (x) { sumLv += x.level; maxLv = Math.max(maxLv, x.level); });
    D.ELEMENTS.forEach(function (x) { if (x.id === best) e = x; });
    return { uid: item.uid, hex: e.color, rgb: hexToRgb(e.color), colorId: null, element: best, category: r.cat,
      power: Math.min(4, 2 + maxLv), quality: item.quality, traits: item.traits.slice(),
      shape: D.ITEM_SHAPES[clamp(2 + sumLv, 3, 6)], at: item.at, fromItem: item.recipe };
  }
  function findMat(save, uid) {
    var i;
    for (i = 0; i < save.mats.length; i++) if (save.mats[i].uid === uid) return save.mats[i];
    for (i = 0; i < save.items.length; i++) if (save.items[i].uid === uid) return itemAsMaterial(save.items[i]);
    return null;
  }
  // 同屬性的素材 3 個 → 1 個：顏色取品質最高者、形狀取最大者、特性合併（最多 MAX_TRAITS）
  function sublimate(save, uids, now) {
    if (uids.length !== D.SUBLIMATE_N) return { error: "count" };
    var ms = uids.map(function (u) { return save.mats.filter(function (m) { return m.uid === u; })[0]; });
    if (ms.some(function (m) { return !m; }) || uids.some(function (u, i) { return uids.indexOf(u) !== i; })) return { error: "missing" };
    if (ms.some(function (m) { return m.element !== ms[0].element; })) return { error: "element" };
    var base = ms.slice().sort(function (a, b) { return b.quality - a.quality; })[0];
    var big = ms.slice().sort(function (a, b) { return b.shape.length - a.shape.length; })[0];
    var traits = [];
    ms.forEach(function (m) { m.traits.forEach(function (t) { if (traits.indexOf(t) < 0) traits.push(t); }); });
    var out = { uid: save.nextUid++, hex: base.hex, rgb: base.rgb, colorId: base.colorId, element: base.element, category: base.category,
      power: Math.max.apply(null, ms.map(function (m) { return m.power; })), quality: clamp(base.quality + D.SUBLIMATE_BONUS, 1, 100),
      traits: traits.slice(0, D.MAX_TRAITS), shape: big.shape, at: now, sublimated: true };
    save.mats = save.mats.filter(function (m) { return uids.indexOf(m.uid) < 0; });
    save.mats.push(out);
    return out;
  }''')

rep('''  function recipesFor(save) { var lv = level(save); return D.RECIPES.filter(function (r) { return r.lv <= lv; }); }''',
    '''  function recipesFor(save) { return D.RECIPES.filter(function (r) { return recipeAvailable(save, r); }); }''')

rep('''    var r = recipe(recipeId);
    if (!r || r.lv > level(save)) return { error: "recipe" };
    if (!canSynth(save, now)) return { error: "cooldown" };
    if (matUids.length !== r.needs.length) return { error: "count" };
    var mats = [];
    for (var i = 0; i < matUids.length; i++) {
      var m = null;
      for (var j = 0; j < save.mats.length; j++) if (save.mats[j].uid === matUids[i]) m = save.mats[j];
      if (!m || mats.indexOf(m) >= 0 || !slotOk(r.needs[i], m)) return { error: "slot", slot: i };
      mats.push(m);
    }
    var h = host(save);
    return methods[h.method].create(r, mats, D.CAULDRONS[cauldronId], h.ability);''',
'''    var r = recipe(recipeId);
    if (!r || !recipeAvailable(save, r)) return { error: "recipe" };
    if (!canSynth(save, now)) return { error: "cooldown" };
    if (matUids.length !== r.needs.length) return { error: "count" };
    var cauldron = effectiveCauldron(save, cauldronId);
    if (!cauldron) return { error: "cauldron" };
    var mats = [];
    for (var i = 0; i < matUids.length; i++) {
      var m = findMat(save, matUids[i]);
      if (!m || matUids.indexOf(matUids[i]) !== i || !slotOk(r.needs[i], m)) return { error: "slot", slot: i };
      mats.push(m);
    }
    var h = host(save);
    return methods[h.method].create(r, mats, cauldron, h.ability);''')

rep('''    var used = session.mats.map(function (m) { return m.uid; });
    save.mats = save.mats.filter(function (m) { return used.indexOf(m.uid) < 0; });
    save.items.push(item);''',
'''    var used = session.mats.map(function (m) { return m.uid; }), ash = 0;
    session.mats.forEach(function (m, i) { ash += m.shape.length - ev.visible[i]; });   // C10：被蓋掉的格子變成灰燼
    if (item.quality < D.ASH_LOW_QUALITY) ash += D.ASH_FAIL_BONUS;
    item.ash = ash;
    save.ash += ash;
    save.made[item.recipe] = (save.made[item.recipe] || 0) + 1;
    save.mats = save.mats.filter(function (m) { return used.indexOf(m.uid) < 0; });
    save.items = save.items.filter(function (it) { return used.indexOf(it.uid) < 0; });   // O9：投入的成品也會用掉
    save.items.push(item);''')

rep('''    clamp: clamp, hash: hash, makeRng: makeRng, jstHour: jstHour,''',
'''    clamp: clamp, hash: hash, makeRng: makeRng, jstHour: jstHour, jstDate: jstDate, dayDiff: dayDiff, migrate: migrate,
    updateStreak: updateStreak, streakBonus: streakBonus, captureEx: captureEx,
    dailyColor: dailyColor, isDailyHit: isDailyHit, whiteBalanceGains: whiteBalanceGains, applyGains: applyGains,
    setWhiteBalance: setWhiteBalance, wbActive: wbActive, dexGroup: dexGroup, dexGroups: dexGroups, dexProgress: dexProgress,
    ideaMet: ideaMet, recipeKnown: recipeKnown, recipeAvailable: recipeAvailable, checkIdeas: checkIdeas,
    cauldronLv: cauldronLv, canUnlockCauldron: canUnlockCauldron, unlockCauldron: unlockCauldron, upgradeCost: upgradeCost,
    upgradeCauldron: upgradeCauldron, effectiveCauldron: effectiveCauldron, matMax: matMax, shelfCost: shelfCost, upgradeShelf: upgradeShelf,
    itemAsMaterial: itemAsMaterial, findMat: findMat, sublimate: sublimate,''')
p.write_text(s, encoding="utf-8", newline="\n")

b = pathlib.Path("static_src/atelier_method_board.js"); t = b.read_text(encoding="utf-8")
old = '''      gauges[dominant] += push;
    }'''
assert t.count(old) == 1
t = t.replace(old, old + '''
    // 第 2 階段（C5）：擅長這個配方的釜，量表 ×affinityMult
    var mult = s.cauldron.affinityMult && s.cauldron.affinity && s.cauldron.affinity.indexOf(s.recipe.id) >= 0 ? s.cauldron.affinityMult : 1;
    if (mult !== 1) Object.keys(gauges).forEach(function (k) { gauges[k] = Math.round(gauges[k] * mult); });''')
old2 = "return { gauges: gauges, visible: visible, covered: covered, dominant: dominant, push: push, quality: quality };"
assert t.count(old2) == 1
t = t.replace(old2, "return { gauges: gauges, visible: visible, covered: covered, dominant: dominant, push: push, quality: quality, mult: mult };")
b.write_text(t, encoding="utf-8", newline="\n")

h = pathlib.Path("static_src/atelier_hosts.js"); u = h.read_text(encoding="utf-8")
old3 = '''        cooldown: [L("大釜還在冷卻，先去採色吧。", "大釜はまだ冷めてないよ。先に色を集めてきて。")]'''
assert u.count(old3) == 1
u = u.replace(old3, old3 + ''',
        idea: [L("我想到了！有新的配方了。", "ひらめいた！新しいレシピができたよ。")],
        daily: [L("這就是今天的顏色！找得真好。", "それが今日の色！よく見つけたね。")],
        sublimate: [L("三個合而為一……顏色變得更純了。", "三つがひとつに……色がもっと澄んだね。")],
        upgrade: [L("工房又變得更好用了。", "アトリエがまた使いやすくなったね。")]''')
h.write_text(u, encoding="utf-8", newline="\n")
print("ok")
```

  Expected: 印出 `ok`

  實作重點：
  - `captureEx` 的順序是：先檢查是否可以採集，再扣採集籃，再更新連續天數。素材品質依序加上連續天數加成、乘上白平衡倍率，最後才判定是否「鮮豔」。
  - `startSynthesis` 透過 `effectiveCauldron` 取得含升級效果的釜。找素材用 `findMat`，成品會轉成素材（`fromItem`）。重複的 uid 用 `matUids.indexOf` 擋下。
  - 棋盤只有在 `cauldron.affinityMult` 存在時才乘倍率。第 1 階段的測試直接使用 `D.CAULDRONS.copper`（沒有 `affinityMult`），所以期望值不變。

- [ ] **Step 3: 跑全部規則檢查**

Run: `node --check static_src/atelier_core.js; node tools/atelier_check/core_check.js; node tools/atelier_check/phase2_check.js`
Expected: `23 passed`、`22 passed`

- [ ] **Step 4: Commit**

```bash
git add static_src/atelier_data.js static_src/atelier_core.js static_src/atelier_method_board.js static_src/atelier_hosts.js
git commit -m "feat(atelier): 每日色彩、連續採色、白平衡、圖鑑、配方發想、錬金釜與灰燼、成品再投入、素材升華"
```

---

### Task 3: 畫面

**Files:**
- Modify: `static_src/atelier.js`（換成全文）, `static_src/css/atelier.css`, `site_src/i18n_atelier.py`
- Create: `tools/atelier_check/ui2_check.js`

**Interfaces:**
- Consumes: Task 2 的全部介面
- Produces: 新的 DOM id／data 屬性：`#at-daily`、`#at-streak`、`#at-wb`、`#at-wb-hint`、`#at-wb-status`、`#at-cauldron`、`#at-affinity`、`[data-at-sub]`、`#at-sublimate`、`#at-dex-progress`、`[data-at-dex]`、`[data-at-unlock]`、`[data-at-upgrade]`、`#at-shelf`、`#at-ash`、`#at-dev-day`、`#at-dev-ash`

- [ ] **Step 1: 寫畫面檢查**（`tools/atelier_check/ui2_check.js`，全文）

```js
// 煉金術士（atelier）第 2 階段 Playwright 流程檢查：
//   今日之色＋墨的圖片採集（每日色彩經驗、連續採色、圖鑑、發想「影之斗篷」）→ 白平衡校正
//   → 圖鑑分頁 → 工房：灰燼升級銅之大釜 → 同色 3 個升華 → 選釜調和色彩墨水
//   → 成品再投入第二次調和（成品被用掉）→ 第 1 階段存檔遷移 → 語言切換 → 手機寬度 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8973 --directory dist
// 執行：node tools/atelier_check/ui2_check.js
// 注意（CLAUDE.md §4.6）：畫面每次操作都會整個重繪，一律用 dispatchEvent 觸發。
"use strict";
var path = require("path"), assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;
var BASE = (process.env.ATELIER_ROOT || "http://localhost:8973/") + "atelier/index.html";

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 375, height: 800 } }), errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  async function state() { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestAtelier._debugState())); }); }
  async function tap(sel) { await page.dispatchEvent(sel, "click"); }
  // 在頁面裡畫 64×64 的圖：colors 依序由左到右等寬排列
  async function png(colors) {
    var b64 = await page.evaluate(function (cs) {
      var c = document.createElement("canvas"); c.width = 64; c.height = 64;
      var g = c.getContext("2d"), w = 64 / cs.length;
      cs.forEach(function (hex, i) { g.fillStyle = hex; g.fillRect(Math.round(i * w), 0, Math.ceil(w), 64); });
      return c.toDataURL("image/png").split(",")[1];
    }, colors);
    return { name: "t.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") };
  }
  async function upload(colors) {
    await page.setInputFiles("#at-file", await png(colors));
  }
  async function placeAll() {
    for (;;) {
      var pos = await page.evaluate(function () {
        var ui = window.PriTestAtelier._debugUi(), s = ui.session, B = window.PriTestAtelierCore.method(s.method);
        if (B.done(s)) return "done";
        for (var y = 0; y < s.size; y++) for (var x = 0; x < s.size; x++) if (B.canPlace(s, ui.sel, x, y, ui.rot)) return x + "," + y;
        return null;
      });
      if (pos === "done") return;
      assert(pos, "應有可放置的位置");
      await tap('[data-at-cell="' + pos + '"]');
      await tap('[data-at-cell="' + pos + '"]');
    }
  }
  async function synth(recipe, pickItem) {
    await tap('[data-at-tab="lab"]');
    await tap('[data-at-recipe="' + recipe + '"]');
    assert(await page.$("#at-cauldron"), "要能選錬金釜");
    var n = await page.$$eval("[data-at-slot]", function (x) { return x.length; });
    for (var i = 0; i < n; i++) {
      var opts = await page.$$eval('[data-at-slot="' + i + '"] option', function (x) { return x.map(function (o) { return { v: o.value, t: o.textContent }; }); });
      var want = opts.filter(function (o) { return o.v && (i === 0 && pickItem ? o.t.indexOf("★") === 0 : o.t.indexOf("★") !== 0); })[0];
      assert(want, "第 " + i + " 格沒有可選的素材");
      await page.selectOption('[data-at-slot="' + i + '"]', want.v);
    }
    await tap("#at-start");
    await page.waitForSelector("#at-board");
    await placeAll();
    await page.waitForSelector("#at-traits");
    await tap("#at-finish");
    await page.waitForSelector("#at-result");
    await tap("#at-result-close");
    await tap("#at-dev-cool");
  }

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-atelier-save-v1"); });
  await page.reload();

  // 今日之色＋墨
  var daily = await page.evaluate(function () { return window.PriTestAtelierCore.dailyColor(Date.now()).hex; });
  assert(await page.$("#at-daily"));
  await upload([daily, "#595857"]);
  await page.waitForSelector("#at-swatches");
  var swN = await page.$$eval("[data-at-pick]", function (x) { return x.length; });
  for (var i = 0; i < swN; i++) await tap('[data-at-pick="' + i + '"]');
  await tap("#at-collect");
  var s = await state();
  assert(s.daily.date, "應記錄今天已拍到今日之色");
  assert.strictEqual(s.streak.n, 1);
  assert(s.exp >= 50, "每日色彩經驗");
  assert(s.seen.sumi, "墨要記入圖鑑");
  assert(s.ideas.shade, "拍到墨要想到影之斗篷");
  assert((await page.textContent("#at-msg")).length > 0);

  // 白平衡：偏黃的白紙
  await tap("#at-wb");
  await page.waitForSelector("#at-wb-hint");
  await upload(["#FAE6B4"]);
  s = await state();
  assert(s.wb && s.wb.until > Date.now(), "白平衡要生效");
  assert((await page.textContent("#at-wb-status")).length > 0);
  assert.strictEqual(s.basket.n, 5, "校正不消耗採集籃");

  // 圖鑑
  await tap('[data-at-tab="dex"]');
  var seenN = Object.keys(s.seen).length;
  assert((await page.textContent("#at-dex-progress")).indexOf(seenN + "/") >= 0);
  assert(await page.$('[data-at-dex="sumi"]'));

  // 工房：灰燼升級
  await tap("#at-dev-ash");
  await tap('[data-at-tab="shop"]');
  assert(await page.$eval('[data-at-unlock="iron"]', function (b) { return b.disabled; }), "Lv1 不能解鎖鐵之大釜");
  await tap('[data-at-upgrade="copper"]');
  s = await state();
  assert.strictEqual(s.cauldrons.copper, 2);
  assert.strictEqual(s.ash, 20 - 10);

  // 升華：同一個紅色採 3 次
  await tap('[data-at-tab="gather"]');
  var red = daily === "#D7003A" ? { hex: "#1E50A2", id: "ruri" } : { hex: "#D7003A", id: "beni" };   // 避開今日之色
  for (var k = 0; k < 3; k++) {
    await upload([red.hex]);
    await page.waitForSelector("#at-swatches");
    await tap('[data-at-pick="0"]');
    await tap("#at-collect");
  }
  s = await state();
  var reds = s.mats.filter(function (m) { return m.colorId === red.id; }).map(function (m) { return m.uid; });
  assert.strictEqual(reds.length, 3);
  var before = s.mats.length;
  await tap('[data-at-tab="box"]');
  for (var r = 0; r < 3; r++) await page.check('[data-at-sub="' + reds[r] + '"]');
  await tap("#at-sublimate");
  s = await state();
  assert.strictEqual(s.mats.length, before - 2);
  assert(s.mats.some(function (m) { return m.sublimated; }));

  // 調和色彩墨水 → 成品再投入
  await synth("ink", false);
  s = await state();
  assert.strictEqual(s.items.length, 1);
  var firstItem = s.items[0].uid;
  assert.strictEqual(s.made.ink, 1);
  await synth("ink", true);
  s = await state();
  assert.strictEqual(s.items.length, 1, "投入的成品要被用掉");
  assert.notStrictEqual(s.items[0].uid, firstItem);
  assert.strictEqual(s.made.ink, 2);

  // 配方列表：未發想的配方顯示提示
  await tap('[data-at-tab="lab"]');
  assert(await page.$eval('[data-at-recipe="pigment"]', function (b) { return b.disabled; }));

  // 第 1 階段存檔遷移：拿掉第 2 階段的欄位後重新載入
  await page.evaluate(function () {
    var k = "pritest-atelier-save-v1", v = JSON.parse(localStorage.getItem(k));
    ["ideas", "made", "ash", "cauldrons", "shelf", "streak", "daily", "wb"].forEach(function (f) { delete v[f]; });
    localStorage.setItem(k, JSON.stringify(v));
  });
  var expBefore = (await state()).exp;
  await page.reload();
  s = await state();
  assert.deepStrictEqual(s.cauldrons, { copper: 1 });
  assert.strictEqual(s.exp, expBefore);
  assert(s.ideas.shade, "載入時重新檢查發想");

  // 語言切換、手機寬度
  await page.evaluate(function () { window.I18N.setLang("ja"); });
  assert.strictEqual((await page.textContent('[data-at-tab="dex"]')).trim(), "図鑑");
  await page.evaluate(function () { window.I18N.setLang("zh"); });
  for (var tab of ["gather", "box", "lab", "tasks", "dex", "shop"]) {
    await tap('[data-at-tab="' + tab + '"]');
    var over = await page.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    assert(over <= 0, tab + " 橫向捲動 " + over + "px");
  }

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("ui2_check ok");
})().catch(function (e) { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 跑檢查確認失敗**

Run: `py -3 generate.py`，另開終端機執行 `py -3 -m http.server 8973 --directory dist`，然後 `node tools/atelier_check/ui2_check.js`
Expected: FAIL（`#at-daily` 不存在）

- [ ] **Step 3: 字串與樣式**：用下面的腳本修改

```python
import pathlib
p = pathlib.Path("site_src/i18n_atelier.py"); s = p.read_text(encoding="utf-8")
anchor = '''    ("at_reset_confirm", "確定清除？再按一次", "本当に消す？もう一度押す", "Really reset? Tap again"),
)'''
assert s.count(anchor) == 1
rows = '''    ("at_reset_confirm", "確定清除？再按一次", "本当に消す？もう一度押す", "Really reset? Tap again"),
    # ---------- 第 2 階段 ----------
    ("at_tab_dex", "圖鑑", "図鑑", "Colors"),
    ("at_tab_shop", "工房", "工房", "Workshop"),
    ("at_ash", "灰燼 {n}", "灰 {n}", "Ash {n}"),
    ("at_ash_gain", "灰燼 +{n}", "灰 +{n}", "Ash +{n}"),
    ("at_daily", "今日之色：{name}", "今日の色：{name}", "Color of the day: {name}"),
    ("at_daily_done", "（今天已經拍到）", "（今日はもう見つけた）", "(found today)"),
    ("at_daily_hit", "拍到今日之色！經驗 +{n}", "今日の色を見つけた！経験 +{n}", "Found the color of the day! EXP +{n}"),
    ("at_streak", "連續採色 {n} 天（品質 +{b}）", "連続 {n} 日（品質 +{b}）", "{n}-day streak (quality +{b})"),
    ("at_wb", "白平衡校正", "ホワイトバランス", "White balance"),
    ("at_wb_hint", "用相機或圖片拍一張白紙或白牆，這一張會用來校正顏色。", "白い紙か白い壁をカメラか画像で取ってね。その一枚で色を補正するよ。", "Capture a white sheet or wall; it will be used to correct colors."),
    ("at_wb_set", "白平衡校正完成（30 分內有效）", "ホワイトバランス補正完了（30 分有効）", "White balance set (30 min)"),
    ("at_wb_on", "白平衡有效：還有 {m} 分（品質 ×1.1）", "ホワイトバランス有効：あと {m} 分（品質 ×1.1）", "White balance on: {m} min (quality ×1.1)"),
    ("at_new", "新", "新", "New"),
    ("at_new_colors", "新的顏色：{names}", "新しい色：{names}", "New colors: {names}"),
    ("at_idea_new", "想到新配方：{names}", "新レシピをひらめいた：{names}", "New recipe: {names}"),
    ("at_recipe_idea", "尚未發想", "まだひらめいていない", "Not yet discovered"),
    ("at_idea_seen", "提示：拍到「{color}」", "ヒント：「{color}」を見つける", "Hint: find {color}"),
    ("at_idea_seenCount", "提示：圖鑑收集 {n} 色", "ヒント：図鑑を {n} 色集める", "Hint: collect {n} colors"),
    ("at_idea_seenEl", "提示：拍到 {n} 種{el}屬性的顏色", "ヒント：{el}属性の色を {n} 種見つける", "Hint: find {n} {el} colors"),
    ("at_idea_made", "提示：做出{recipe}", "ヒント：{recipe}を作る", "Hint: make {recipe}"),
    ("at_idea_quality", "提示：{recipe}的品質達到 {n}", "ヒント：{recipe}を品質 {n} で作る", "Hint: make {recipe} at quality {n}"),
    ("at_cauldron", "錬金釜", "錬金釜", "Cauldron"),
    ("at_affinity", "擅長", "得意", "Good at"),
    ("at_affinity_on", "這個釜擅長這個配方：量表 ×{m}", "この釜はこのレシピが得意：ゲージ ×{m}", "This cauldron suits the recipe: gauges ×{m}"),
    ("at_cauldron_info", "{size}×{size}・品質上升 {q}／格・Lv{lv}", "{size}×{size}・品質上昇 {q}／マス・Lv{lv}", "{size}×{size}, quality +{q}/cell, Lv{lv}"),
    ("at_unlock", "解鎖（需要 Lv{lv}・灰燼 {ash}）", "解放（Lv{lv}・灰 {ash}）", "Unlock (Lv{lv}, ash {ash})"),
    ("at_upgrade", "升級（灰燼 {ash}）", "強化（灰 {ash}）", "Upgrade (ash {ash})"),
    ("at_max", "已達最高等級", "最大レベル", "Max level"),
    ("at_box_cap", "素材箱容量 {n}", "素材箱の容量 {n}", "Box capacity {n}"),
    ("at_shelf", "擴充 +{n}（灰燼 {ash}）", "拡張 +{n}（灰 {ash}）", "Expand +{n} (ash {ash})"),
    ("at_shelf_max", "已擴充到最大", "最大まで拡張済み", "Fully expanded"),
    ("at_sublimate", "升華", "昇華", "Sublimate"),
    ("at_sublimate_hint", "勾選 3 個同屬性的素材可以升華成 1 個（品質＝最高者＋8）。", "同じ属性の素材を 3 つ選ぶと 1 つに昇華できる（品質＝最高＋8）。", "Pick 3 materials of the same element to merge them (quality = best + 8)."),
    ("at_sublimate_ok", "升華完成：品質 {q}", "昇華完了：品質 {q}", "Sublimated: quality {q}"),
    ("at_dex_progress", "圖鑑 {seen}/{total}", "図鑑 {seen}/{total}", "Colors {seen}/{total}"),
    ("at_dex_red", "紅", "赤", "Red"),
    ("at_dex_orange", "橙", "橙", "Orange"),
    ("at_dex_yellow", "黃", "黄", "Yellow"),
    ("at_dex_green", "綠", "緑", "Green"),
    ("at_dex_blue", "藍", "青", "Blue"),
    ("at_dex_purple", "紫", "紫", "Purple"),
    ("at_dex_brown", "茶", "茶", "Brown"),
    ("at_dex_mono", "白・灰・黑", "白・灰・黒", "White, gray, black"),
    ("at_fx_freeze", "凍結 {n} 回合", "凍結 {n} ターン", "Freeze {n} turns"),
    ("at_err_cauldron", "還沒有這個錬金釜", "この錬金釜はまだない", "Cauldron not owned"),
    ("at_err_element", "要選同屬性的素材", "同じ属性の素材を選んでね", "Materials must share an element"),
    ("at_err_missing", "找不到選擇的素材", "選んだ素材が見つからない", "Material not found"),
    ("at_err_pick", "請選 1～3 個顏色", "1～3 色えらんでね", "Pick 1–3 colors"),
    ("at_dev_day", "時間 +1 天", "時間 +1 日", "Time +1 day"),
    ("at_dev_ash", "灰燼 +20", "灰 +20", "Ash +20"),
)'''
s = s.replace(anchor, rows)
p.write_text(s, encoding="utf-8", newline="\n")

c = pathlib.Path("static_src/css/atelier.css"); u = c.read_text(encoding="utf-8")
old = ".at-tabs { display: flex; gap: 0.25rem; margin: 0.75rem 0; }\n.at-tabs button { flex: 1; min-width: 0; padding: 0.45rem 0.2rem; white-space: nowrap; }"
assert u.count(old) == 1
u = u.replace(old, ".at-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.25rem; margin: 0.75rem 0; }\n.at-tabs button { min-width: 0; padding: 0.45rem 0.2rem; white-space: nowrap; }")
u += """/* 第 2 階段：每日色彩、圖鑑、升華 */
.at-daily { display: flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.6rem; background: #fff; border: 1px dashed var(--at-accent); border-radius: 8px; }
.at-new { background: #e6f0ff; border-color: var(--at-accent); }
.at-wrap button.at-on { outline: 3px solid var(--at-accent); }
.at-subpick input { width: 1.1rem; height: 1.1rem; }
.at-dex-grid { list-style: none; padding: 0; margin: 0.3rem 0 0.8rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr)); gap: 0.3rem; }
.at-dex-grid li { display: flex; align-items: center; gap: 0.3rem; padding: 0.25rem 0.4rem; background: #fff; border: 1px solid var(--at-line); border-radius: 8px; font-size: 0.85rem; }
.at-dex-off { opacity: 0.5; }
.at-dex-off .at-chip { background: repeating-linear-gradient(45deg, #ddd, #ddd 3px, #f4f4f4 3px, #f4f4f4 6px); }
"""
c.write_text(u, encoding="utf-8", newline="\n")
print("ok")
```

- [ ] **Step 4: 畫面**（`static_src/atelier.js`，全文）

```js
// 煉金術士（atelier）：畫面、存檔、相機操作。規則全部在 atelier_core.js／atelier_method_board.js。
(function () {
  "use strict";
  var D = window.PriTestAtelierData, C = window.PriTestAtelierCore, H = window.PriTestAtelierHosts;
  var CAM = window.PriTestAtelierCamera, COLORS = window.PriTestAtelierColors;
  var KEY = "pritest-atelier-save-v1";
  var TABS = ["gather", "box", "lab", "tasks", "dex", "shop"];
  var app = document.getElementById("at-app");
  if (!app) return;

  var save = load();
  var ui = { tab: "gather", swatches: null, picks: [], scene: null, recipe: null, slots: [], cauldron: "copper", session: null,
    sel: -1, rot: 0, ghost: null, traits: [], result: null, line: null, dev: false, resetArm: false, msg: "", wbMode: false, subs: [] };

  // ---------- 共用 ----------
  function now() { return Date.now() + (save.offsetMs || 0); }
  function lang() { return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || "zh"; }
  function t(k, p) { return window.I18N ? window.I18N.t(k, p) : k; }
  function loc(o) { var l = lang(); return o[l] || (l === "en" && o.ja) || o.zh || o.ja || ""; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function el(id) { for (var i = 0; i < D.ELEMENTS.length; i++) if (D.ELEMENTS[i].id === id) return D.ELEMENTS[i]; return null; }
  function colorOf(id) { for (var i = 0; i < COLORS.length; i++) if (COLORS[i].id === id) return COLORS[i]; return null; }
  function host() { return H[save.host]; }
  function say(key) { var arr = host().lines[key] || host().lines.ok; ui.line = arr[Math.floor(Math.random() * arr.length)]; }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 1 && Array.isArray(s.mats)) return C.migrate(s);
    } catch (e) { /* 壞檔就重建 */ }
    return C.newSave(Date.now());
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* 容量不足時只保留記憶體中的狀態 */ } }
  function recipeName(id) { return loc(C.recipe(id).name); }
  // C3：每次操作後檢查有沒有想到新配方
  function ideas() {
    var got = C.checkIdeas(save);
    if (got.length) { say("idea"); ui.msg = (ui.msg ? ui.msg + "　" : "") + t("at_idea_new", { names: got.map(recipeName).join("、") }); }
    return got;
  }
  function matName(m) { return m.fromItem ? "★" + recipeName(m.fromItem) : loc(colorOf(m.colorId).name); }

  // 素材形狀的小圖（色覺友善：同時顯示屬性圖形）
  function shapeHtml(m, cls) {
    var w = 0, h = 0;
    m.shape.forEach(function (c) { w = Math.max(w, c[0] + 1); h = Math.max(h, c[1] + 1); });
    var on = {}; m.shape.forEach(function (c) { on[c[0] + "," + c[1]] = true; });
    var out = '<span class="at-shape ' + (cls || "") + '" style="grid-template-columns:repeat(' + w + ',1fr)">';
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++)
      out += on[x + "," + y] ? '<i style="background:' + m.hex + '">' + el(m.element).icon + "</i>" : "<i class=\"at-off\"></i>";
    return out + "</span>";
  }
  function matHtml(m) {
    var e = el(m.element);
    return '<span class="at-mat-name">' + esc(matName(m)) + "</span>" +
      '<span class="at-tag" style="border-color:' + e.color + '">' + e.icon + " " + t("at_el_" + m.element) + "</span>" +
      '<span class="at-tag">' + t("at_cat_" + m.category) + "</span>" +
      '<span class="at-tag">' + t("at_quality", { n: m.quality }) + "</span>" +
      '<span class="at-tag">' + t("at_power", { n: m.power }) + "</span>" +
      m.traits.map(function (tr) { return '<span class="at-tag at-trait">' + esc(loc(D.TRAITS[tr].name)) + "</span>"; }).join("");
  }
  function fxText(e) { return e.kind ? t("at_fx_" + e.kind, { n: e.n }) : t("at_fx_none"); }
  function ideaHint(r) {
    var i = r.idea;
    if (i.seen) return t("at_idea_seen", { color: loc(colorOf(i.seen).name) });
    if (i.seenCount) return t("at_idea_seenCount", { n: i.seenCount });
    if (i.seenEl) return t("at_idea_seenEl", { n: i.seenEl.n, el: t("at_el_" + i.seenEl.el) });
    if (i.made) return t("at_idea_made", { recipe: recipeName(i.made) });
    if (i.quality) return t("at_idea_quality", { recipe: recipeName(i.quality.recipe), n: i.quality.n });
    return "";
  }

  // ---------- 畫面 ----------
  function render() {
    C.refillBasket(save, now());
    var h = host(), hs = save.hosts[save.host];
    var tutorial = ui.tab === "lab" && save.tutorial < h.tutorial.length ? h.tutorial[save.tutorial] : null;
    var line = tutorial || ui.line || h.lines.greet[0];
    var html = '<header class="at-head">' +
      '<div class="at-avatar" style="background:' + h.color + '">' + h.glyph + "</div>" +
      '<div class="at-who"><b>' + esc(loc(h.name)) + "</b> <small>" + esc(loc(h.title)) + "</small><br><small>" +
      t("at_level", { n: C.level(save) }) + "・" + t("at_aff", { n: hs.aff }) + "・" + t("at_ash", { n: save.ash }) + "</small></div>" +
      '<p id="at-line" class="at-bubble' + (tutorial ? " at-tutorial" : "") + '">' + esc(loc(line)) + "</p></header>" +
      '<nav class="at-tabs">' + TABS.map(function (k) {
        return '<button type="button" data-at-tab="' + k + '" class="' + (ui.tab === k ? "at-on" : "") + '">' + t("at_tab_" + k) + "</button>";
      }).join("") + "</nav>";
    if (ui.msg) html += '<p class="at-msg" id="at-msg">' + esc(ui.msg) + "</p>";
    html += '<section class="at-body">' + ({ gather: renderGather, box: renderBox, lab: renderLab, tasks: renderTasks, dex: renderDex, shop: renderShop })[ui.tab]() + "</section>";
    html += renderDev();
    var video = app.querySelector("#at-video");
    app.innerHTML = html;
    // 相機播放中時保留同一個 <video>，避免每次重繪都斷線
    var slot = app.querySelector("#at-video-slot");
    if (slot) {
      if (!video) { video = document.createElement("video"); video.id = "at-video"; video.className = "at-video"; }
      slot.appendChild(video);
      if (CAM.isOpen() && video.paused) video.play().catch(function () { /* 重新掛上後自動播放失敗時，等使用者再按一次 */ });
    }
  }

  function renderGather() {
    var b = save.basket, n = now(), mins = b.n >= D.BASKET_MAX ? 0 : Math.ceil((b.at + D.BASKET_REFILL_MS - n) / 60000);
    var daily = C.dailyColor(n), doneToday = save.daily.date === C.jstDate(n);
    var st = save.streak, stN = st.date && C.dayDiff(st.date, C.jstDate(n)) <= 1 ? st.n : 0;
    var out = '<div class="at-daily" id="at-daily"><span class="at-chip" style="background:' + daily.hex + '"></span>' +
      t("at_daily", { name: loc(daily.name) }) + (doneToday ? " " + t("at_daily_done") : "") + "</div>" +
      '<p class="at-basket" id="at-basket">' + t("at_basket", { n: b.n, max: D.BASKET_MAX }) +
      (mins > 0 ? "　" + t("at_basket_next", { m: mins }) : "") + "<br>" +
      '<span id="at-streak">' + t("at_streak", { n: stN, b: C.streakBonus(stN) }) + "</span><br>" +
      '<span id="at-wb-status">' + (C.wbActive(save, n) ? t("at_wb_on", { m: Math.ceil((save.wb.until - n) / 60000) }) : "") + "</span></p>" +
      '<div id="at-video-slot" class="at-video-slot' + (CAM.isOpen() ? "" : " at-hidden") + '"><span class="at-reticle"></span></div>' +
      '<div class="at-row">' +
      (CAM.supported() ? (CAM.isOpen()
        ? '<button type="button" id="at-cam-shot" class="at-main">' + t(ui.wbMode ? "at_wb" : "at_cam_shot") + '</button><button type="button" id="at-cam-close">' + t("at_cam_close") + "</button>"
        : '<button type="button" id="at-cam-open" class="at-main">' + t("at_cam_open") + "</button>") : "") +
      '<label class="at-file">' + t("at_upload") + '<input type="file" id="at-file" accept="image/*"></label>' +
      '<button type="button" id="at-walk">' + t("at_walk") + "</button>" +
      '<button type="button" id="at-wb" class="' + (ui.wbMode ? "at-on" : "") + '">' + t("at_wb") + "</button></div>";
    if (ui.wbMode) out += '<p class="at-hint" id="at-wb-hint">' + t("at_wb_hint") + "</p>";
    if (ui.scene) out += '<img class="at-scene" id="at-scene" alt="" src="' + ui.scene + '">';
    if (ui.swatches) {
      out += '<p class="at-hint">' + t("at_pick_hint", { n: D.PICK_MAX }) + '</p><ul class="at-swatches" id="at-swatches">';
      ui.swatches.forEach(function (s, i) {
        var m = C.makeMaterial(s, n, 0, { daily: C.isDailyHit(s.rgb, n) }), on = ui.picks.indexOf(i) >= 0;
        out += '<li><button type="button" data-at-pick="' + i + '" class="at-swatch' + (on ? " at-on" : "") + '">' +
          '<span class="at-chip" style="background:' + s.hex + '"></span>' + shapeHtml(m) + matHtml(m) +
          (save.seen[m.colorId] ? "" : '<span class="at-tag at-new">' + t("at_new") + "</span>") +
          '<span class="at-tag">' + Math.round(s.frac * 100) + "%</span></button></li>";
      });
      out += '</ul><button type="button" id="at-collect" class="at-main"' + (ui.picks.length && b.n > 0 ? "" : " disabled") + ">" + t("at_collect") + "</button>";
    }
    return out;
  }

  function renderBox() {
    var out = "<h3>" + t("at_tab_box") + " (" + save.mats.length + "/" + C.matMax(save) + ')</h3><p class="at-hint">' + t("at_sublimate_hint") + '</p><ul class="at-list" id="at-mats">';
    if (!save.mats.length) out += "<li>" + t("at_box_empty") + "</li>";
    save.mats.forEach(function (m) {
      out += '<li data-at-uid="' + m.uid + '"><label class="at-subpick"><input type="checkbox" data-at-sub="' + m.uid + '"' +
        (ui.subs.indexOf(m.uid) >= 0 ? " checked" : "") + "></label>" + shapeHtml(m) + matHtml(m) + "</li>";
    });
    out += '</ul><button type="button" id="at-sublimate"' + (ui.subs.length === D.SUBLIMATE_N ? "" : " disabled") + ">" + t("at_sublimate") + "</button>";
    out += "<h3>" + t("at_items") + '</h3><ul class="at-list" id="at-items">';
    if (!save.items.length) out += "<li>" + t("at_items_empty") + "</li>";
    save.items.forEach(function (it) { out += "<li>" + itemHtml(it) + "</li>"; });
    return out + "</ul>";
  }
  function itemHtml(it) {
    return '<span class="at-mat-name">' + esc(recipeName(it.recipe)) + "</span>" +
      '<span class="at-tag">' + t("at_quality", { n: it.quality }) + "</span>" +
      it.effects.map(function (e) { return '<span class="at-tag" style="border-color:' + el(e.el).color + '">' + el(e.el).icon + " " + esc(fxText(e)) + "</span>"; }).join("") +
      it.traits.map(function (tr) { return '<span class="at-tag at-trait">' + esc(loc(D.TRAITS[tr].name)) + "</span>"; }).join("");
  }

  function renderLab() {
    if (ui.result) {
      return '<div id="at-result" class="at-result"><h3>' + t("at_result") + "</h3><p>" + itemHtml(ui.result) + "</p><p>" +
        t("at_best", { n: save.best[ui.result.recipe] }) + (ui.result.ash ? "　" + t("at_ash_gain", { n: ui.result.ash }) : "") +
        '</p><button type="button" id="at-result-close" class="at-main">' + t("at_back") + "</button></div>";
    }
    if (ui.session) return renderBoard();
    var left = save.cooldownUntil - now();
    if (left > 0) return '<p id="at-cooldown" class="at-cooldown">' + t("at_cooldown", { m: Math.ceil(left / 60000) }) + "</p>";
    if (!ui.recipe) {
      return "<h3>" + t("at_recipes") + '</h3><ul class="at-list" id="at-recipes">' + D.RECIPES.map(function (r) {
        var lvOk = r.lv <= C.level(save), known = C.recipeKnown(save, r), ok = lvOk && known;
        var note = !lvOk ? t("at_recipe_locked", { n: r.lv }) + (known ? "" : "　" + ideaHint(r)) : !known ? t("at_recipe_idea") + "　" + ideaHint(r) :
          (save.best[r.id] ? t("at_best", { n: save.best[r.id] }) : "");
        return '<li><button type="button" data-at-recipe="' + r.id + '"' + (ok ? "" : " disabled") + ">" +
          esc(known ? loc(r.name) : "？？？") + (note ? " — " + esc(note) : "") + "</button></li>";
      }).join("") + "</ul>";
    }
    var r = C.recipe(ui.recipe), out = "<h3>" + esc(loc(r.name)) + "</h3>";
    out += '<label class="at-slot">' + t("at_cauldron") + '<select id="at-cauldron">' + D.CAULDRON_ORDER.filter(function (id) { return C.cauldronLv(save, id); }).map(function (id) {
      var c = D.CAULDRONS[id], good = c.affinity.indexOf(r.id) >= 0;
      return '<option value="' + id + '"' + (ui.cauldron === id ? " selected" : "") + ">" + esc(loc(c.name)) + " Lv" + C.cauldronLv(save, id) +
        " (" + c.pattern.length + "×" + c.pattern.length + ")" + (good ? " ★" + t("at_affinity") : "") + "</option>";
    }).join("") + "</select></label><div id=\"at-slots\">";
    var pool = save.mats.concat(save.items.map(C.itemAsMaterial));
    r.needs.forEach(function (need, i) {
      out += '<label class="at-slot">' + t("at_slot", { n: i + 1, need: need === "*" ? t("at_any") : t("at_cat_" + need) }) +
        '<select data-at-slot="' + i + '"><option value="">' + t("at_choose") + "</option>";
      pool.forEach(function (m) {
        if (!C.slotOk(need, m)) return;
        if (ui.slots.some(function (u, j) { return j !== i && u === m.uid; })) return;
        out += '<option value="' + m.uid + '"' + (ui.slots[i] === m.uid ? " selected" : "") + ">" +
          esc(matName(m)) + " / " + el(m.element).icon + " / " + t("at_quality", { n: m.quality }) + " / " + t("at_cells", { n: m.shape.length }) + "</option>";
      });
      out += "</select></label>";
    });
    var ready = r.needs.every(function (n, i) { return ui.slots[i]; });
    return out + '</div><div class="at-row"><button type="button" id="at-back">' + t("at_back") + '</button><button type="button" id="at-start" class="at-main"' +
      (ready ? "" : " disabled") + ">" + t("at_start") + "</button></div>";
  }

  function renderBoard() {
    var s = ui.session, impl = C.method(s.method), ghost = ui.ghost;
    var ev = ghost ? ghost.after : impl.evaluate(s, impl.done(s));
    var ghostSet = {}; if (ghost) ghost.cells.forEach(function (c) { ghostSet[c[0] + "," + c[1]] = true; });
    var out = '<div class="at-board" id="at-board" style="grid-template-columns:repeat(' + s.size + ',1fr)">';
    for (var y = 0; y < s.size; y++) for (var x = 0; x < s.size; x++) {
      var idx = y * s.size + x, cell = s.cells[idx], o = s.owner[idx], cls = "at-cell";
      var bg = cell.color ? el(cell.color).color : "";
      var inner = cell.color ? el(cell.color).icon : "";
      if (cell.bonus) cls += " at-bonus";
      if (o >= 0) { cls += " at-filled"; bg = s.mats[o].hex; inner = el(s.mats[o].element).icon; }
      if (ghostSet[x + "," + y]) cls += " at-ghost";
      out += '<button type="button" class="' + cls + '" data-at-cell="' + x + "," + y + '" style="--at-c:' + (bg || "var(--at-line)") + '">' + inner + "</button>";
    }
    out += '</div><ul class="at-gauges" id="at-gauges">';
    C.effectLevels(s.recipe, ev.gauges).forEach(function (g) {
      var e = el(g.el), val = ev.gauges[g.el], top = s.recipe.gauges.filter(function (x) { return x.el === g.el; })[0].steps.slice(-1)[0].at;
      out += '<li><span style="color:' + e.color + '">' + e.icon + " " + t("at_el_" + g.el) + "</span> " +
        '<meter min="0" max="' + top + '" value="' + Math.min(val, top) + '"></meter> <b>' + val + "</b> Lv" + g.level +
        " <small>" + (g.next ? t("at_gauge_next", { n: g.next }) : t("at_gauge_max")) + "</small></li>";
    });
    out += "</ul>";
    if (ev.mult > 1) out += '<p class="at-hint" id="at-affinity">' + t("at_affinity_on", { m: ev.mult }) + "</p>";
    if (ev.push) out += '<p class="at-push" id="at-push">' + t("at_final_push", { el: t("at_el_" + ev.dominant), n: ev.push }) + "</p>";
    out += '<p class="at-hint">' + t("at_quality", { n: ev.quality }) + "　" + t("at_tap_hint") + "</p>";
    if (!impl.done(s)) {
      out += '<div class="at-tray" id="at-tray">' + s.mats.map(function (m, i) {
        if (s.placed[i]) return "";
        var shown = { shape: C.rotateShape(m.shape, i === ui.sel ? ui.rot : 0), hex: m.hex, element: m.element };
        return '<button type="button" data-at-mat="' + i + '" class="' + (i === ui.sel ? "at-on" : "") + '">' + shapeHtml(shown) + "</button>";
      }).join("") + "</div>";
    }
    out += '<div class="at-row"><button type="button" id="at-rot"' + (ui.sel < 0 ? " disabled" : "") + ">" + t("at_rotate") + "</button>" +
      '<button type="button" id="at-undo"' + (s.history.length ? "" : " disabled") + ">" + t("at_undo") + "</button>" +
      '<button type="button" id="at-abort">' + t("at_back") + "</button></div>";
    if (impl.done(s)) {
      var choices = C.traitChoices(s), used = ui.traits.reduce(function (a, k) { return a + D.TRAITS[k].cost; }, 0);
      out += '<div id="at-traits"><p>' + t("at_traits", { used: used, cap: C.traitCap(save), max: D.MAX_TRAITS }) + "</p>" +
        choices.map(function (k) {
          return '<label class="at-tag"><input type="checkbox" data-at-trait="' + k + '"' + (ui.traits.indexOf(k) >= 0 ? " checked" : "") + "> " +
            esc(loc(D.TRAITS[k].name)) + " (" + D.TRAITS[k].cost + ")</label>";
        }).join("") + '</div><button type="button" id="at-finish" class="at-main"' +
        (C.traitsValid(save, s, ui.traits) ? "" : " disabled") + ">" + t("at_finish") + "</button>";
    }
    return out;
  }

  function renderTasks() {
    var task = C.currentTask(save);
    if (!task) return '<p id="at-task">' + t("at_task_done") + "</p>";
    var out = '<div id="at-task"><h3>' + t("at_task_now") + "</h3><p>" + esc(loc(task.text)) + "</p><p><small>" +
      t("at_task_need", { recipe: recipeName(task.recipe), q: task.minQuality }) +
      (task.minLevel ? t("at_task_lv", { n: task.minLevel }) : "") + '</small></p></div><ul class="at-list">';
    save.items.forEach(function (it) {
      var ok = C.taskMet(task, it);
      out += "<li>" + itemHtml(it) + ' <button type="button" data-at-deliver="' + it.uid + '"' + (ok ? "" : " disabled") + ">" + t("at_deliver") + "</button></li>";
    });
    return out + "</ul>";
  }

  // C2 圖鑑：依色系分組，沒拍過的只顯示「？」
  function renderDex() {
    var p = C.dexProgress(save), out = '<h3 id="at-dex-progress">' + t("at_dex_progress", { seen: p.seen, total: p.total }) + '</h3><div id="at-dex">';
    C.dexGroups().forEach(function (g) {
      out += "<h4>" + t("at_dex_" + g.id) + '</h4><ul class="at-dex-grid">' + g.colors.map(function (c) {
        return save.seen[c.id]
          ? '<li class="at-dex-on" data-at-dex="' + c.id + '"><span class="at-chip" style="background:' + c.hex + '"></span>' + esc(loc(c.name)) +
            (c.rarity > 1 ? " " + new Array(c.rarity).join("★") : "") + "</li>"
          : '<li class="at-dex-off"><span class="at-chip"></span>？</li>';
      }).join("") + "</ul>";
    });
    return out + "</div>";
  }

  // C5 錬金釜、B6 升級、C10 灰燼
  function renderShop() {
    var out = '<h3 id="at-ash">' + t("at_ash", { n: save.ash }) + '</h3><ul class="at-list" id="at-cauldrons">';
    D.CAULDRON_ORDER.forEach(function (id) {
      var c = D.CAULDRONS[id], lv = C.cauldronLv(save, id), eff = C.effectiveCauldron(save, id);
      out += "<li><b>" + esc(loc(c.name)) + "</b> <small>" +
        t("at_cauldron_info", { size: c.pattern.length, q: eff ? eff.qualityPerCell : c.qualityPerCell, lv: lv || "-" }) + "<br>" +
        t("at_affinity") + "：" + c.affinity.map(function (rid) { return C.recipeKnown(save, C.recipe(rid)) ? esc(recipeName(rid)) : "？？？"; }).join("、") + "</small> ";
      if (!lv) out += '<button type="button" data-at-unlock="' + id + '"' + (C.canUnlockCauldron(save, id) ? "" : " disabled") + ">" + t("at_unlock", { lv: c.unlock.lv, ash: c.unlock.ash }) + "</button>";
      else {
        var cost = C.upgradeCost(save, id);
        out += cost === null ? "<small>" + t("at_max") + "</small>"
          : '<button type="button" data-at-upgrade="' + id + '"' + (save.ash >= cost ? "" : " disabled") + ">" + t("at_upgrade", { ash: cost }) + "</button>";
      }
      out += "</li>";
    });
    var sc = C.shelfCost(save);
    out += '</ul><p>' + t("at_box_cap", { n: C.matMax(save) }) + " " + (sc === null ? "<small>" + t("at_shelf_max") + "</small>"
      : '<button type="button" id="at-shelf"' + (save.ash >= sc ? "" : " disabled") + ">" + t("at_shelf", { n: D.SHELF_STEP, ash: sc }) + "</button>") + "</p>";
    return out;
  }

  function renderDev() {
    return '<details class="at-dev"' + (ui.dev ? " open" : "") + '><summary id="at-dev-toggle">' + t("at_dev") + "</summary>" +
      '<button type="button" id="at-dev-time">' + t("at_dev_time") + '</button><button type="button" id="at-dev-day">' + t("at_dev_day") + "</button>" +
      '<button type="button" id="at-dev-cool">' + t("at_dev_cool") + '</button><button type="button" id="at-dev-ash">' + t("at_dev_ash") + "</button>" +
      '<button type="button" id="at-reset">' + t(ui.resetArm ? "at_reset_confirm" : "at_reset") + "</button></details>";
  }

  // ---------- 操作 ----------
  function showSwatches(rgba, sceneUrl) {
    var n = now();
    if (ui.wbMode) {                          // O2：這一張當作白紙校正
      C.setWhiteBalance(save, C.whiteBalanceGains(rgba, D.SRC_SIZE, D.SRC_SIZE), n);
      ui.wbMode = false; ui.msg = t("at_wb_set"); persist(); render();
      return;
    }
    if (C.wbActive(save, n)) rgba = C.applyGains(rgba, save.wb.gains);
    ui.swatches = C.analyze(rgba, D.SRC_SIZE, D.SRC_SIZE, String(n));
    ui.picks = []; ui.scene = sceneUrl || null; ui.msg = "";
    render();
  }
  function collect() {
    var r = C.captureEx(save, ui.picks.map(function (k) { return ui.swatches[k]; }), now()), msgs = [];
    if (r.error) { ui.msg = t(r.error === "basket" ? "at_collect_fail_basket" : r.error === "full" ? "at_collect_fail_full" : "at_err_pick"); render(); return; }
    ui.swatches = null; ui.scene = null; ui.picks = [];
    msgs.push(t("at_collect_ok", { n: r.mats.length }));
    if (r.newColors.length) msgs.push(t("at_new_colors", { names: r.newColors.map(function (id) { return loc(colorOf(id).name); }).join("、") }));
    if (r.daily) { msgs.push(t("at_daily_hit", { n: D.DAILY_EXP })); say("daily"); }
    ui.msg = msgs.join("　");
    ideas(); persist(); render();
  }
  function startSession() {
    var res = C.startSynthesis(save, ui.recipe, ui.slots.slice(), ui.cauldron, now());
    if (res.error) { ui.msg = t("at_err_" + res.error); say(res.error === "cooldown" ? "cooldown" : "miss"); render(); return; }
    ui.session = res; ui.sel = 0; ui.rot = 0; ui.ghost = null; ui.traits = []; ui.msg = "";
    render();
  }
  function pickCauldron(recipeId) {
    var owned = D.CAULDRON_ORDER.filter(function (id) { return C.cauldronLv(save, id); });
    var good = owned.filter(function (id) { return D.CAULDRONS[id].affinity.indexOf(recipeId) >= 0; });
    return good[0] || owned[0];
  }
  function tapCell(x, y) {
    var s = ui.session, impl = C.method(s.method);
    if (ui.sel < 0) return;
    if (ui.ghost && ui.ghost.x === x && ui.ghost.y === y) {   // 第 2 次點同一格：放下
      var before = impl.evaluate(s, false), info = impl.place(s, ui.sel, x, y, ui.rot);
      if (info.ok) {
        say(C.react(save, before, impl.evaluate(s, impl.done(s)), info));
        ui.sel = s.placed.indexOf(false); ui.rot = 0;
      }
      ui.ghost = null;
    } else {
      var p = impl.preview(s, ui.sel, x, y, ui.rot);
      ui.ghost = p ? { x: x, y: y, cells: p.cells, after: p.after } : null;
    }
    render();
  }

  app.addEventListener("click", function (ev) {
    var b = ev.target.closest("button, summary");
    if (!b || b.disabled) return;
    var d = b.dataset, s = ui.session;
    if (d.atTab) { ui.tab = d.atTab; ui.msg = ""; ui.subs = []; if (ui.tab !== "gather") CAM.close(app.querySelector("#at-video")); render(); return; }
    if (b.id === "at-cam-open") {
      CAM.open(app.querySelector("#at-video")).then(render, function () { ui.msg = t("at_cam_denied"); render(); });
      render(); return;
    }
    if (b.id === "at-cam-close") { CAM.close(app.querySelector("#at-video")); render(); return; }
    if (b.id === "at-cam-shot") { showSwatches(CAM.grab(app.querySelector("#at-video"))); return; }
    if (b.id === "at-walk") { ui.wbMode = false; var w = CAM.walkScene(now()); showSwatches(w.rgba, w.url); return; }
    if (b.id === "at-wb") { ui.wbMode = !ui.wbMode; ui.swatches = null; render(); return; }
    if (d.atPick !== undefined) {
      var i = +d.atPick, at = ui.picks.indexOf(i);
      if (at >= 0) ui.picks.splice(at, 1); else if (ui.picks.length < D.PICK_MAX) ui.picks.push(i);
      render(); return;
    }
    if (b.id === "at-collect") { collect(); return; }
    if (d.atRecipe) { ui.recipe = d.atRecipe; ui.slots = []; ui.cauldron = pickCauldron(d.atRecipe); render(); return; }
    if (b.id === "at-back") { ui.recipe = null; ui.slots = []; render(); return; }
    if (b.id === "at-start") { startSession(); return; }
    if (d.atCell) { var xy = d.atCell.split(","); tapCell(+xy[0], +xy[1]); return; }
    if (d.atMat !== undefined) { ui.sel = +d.atMat; ui.rot = 0; ui.ghost = null; render(); return; }
    if (b.id === "at-rot") {
      ui.rot = (ui.rot + 1) % 4;
      if (ui.ghost) { var p = C.method(s.method).preview(s, ui.sel, ui.ghost.x, ui.ghost.y, ui.rot); ui.ghost = p ? { x: ui.ghost.x, y: ui.ghost.y, cells: p.cells, after: p.after } : null; }
      render(); return;
    }
    if (b.id === "at-undo") { C.method(s.method).undo(s); ui.sel = s.placed.indexOf(false); ui.rot = 0; ui.ghost = null; ui.traits = []; render(); return; }
    if (b.id === "at-abort") { ui.session = null; ui.ghost = null; render(); return; }
    if (b.id === "at-finish") {
      var item = C.finishSynthesis(save, s, ui.traits, now());
      if (item.error) { ui.msg = t("at_err_" + item.error); render(); return; }
      ui.result = item; ui.session = null; ui.recipe = null; ui.slots = []; ui.msg = "";
      say(item.quality >= 50 ? "finish_good" : "finish_bad");
      ideas(); persist(); render(); return;
    }
    if (b.id === "at-result-close") { ui.result = null; render(); return; }
    if (d.atDeliver) { if (C.deliver(save, +d.atDeliver)) { say("finish_good"); ideas(); persist(); } render(); return; }
    if (b.id === "at-sublimate") {
      var m = C.sublimate(save, ui.subs.slice(), now());
      if (m.error) ui.msg = t("at_err_" + m.error);
      else { ui.msg = t("at_sublimate_ok", { q: m.quality }); say("sublimate"); persist(); }
      ui.subs = []; render(); return;
    }
    if (d.atUnlock) { if (C.unlockCauldron(save, d.atUnlock)) { say("upgrade"); persist(); } render(); return; }
    if (d.atUpgrade) { if (C.upgradeCauldron(save, d.atUpgrade)) { say("upgrade"); persist(); } render(); return; }
    if (b.id === "at-shelf") { if (C.upgradeShelf(save)) { say("upgrade"); persist(); } render(); return; }
    if (b.id === "at-dev-toggle") { ui.dev = !ui.dev; return; }
    if (b.id === "at-dev-time") { save.offsetMs = (save.offsetMs || 0) + 20 * 60000; persist(); render(); return; }
    if (b.id === "at-dev-day") { save.offsetMs = (save.offsetMs || 0) + 86400000; persist(); render(); return; }
    if (b.id === "at-dev-cool") { save.cooldownUntil = 0; persist(); render(); return; }
    if (b.id === "at-dev-ash") { save.ash += 20; persist(); render(); return; }
    if (b.id === "at-reset") {
      if (!ui.resetArm) { ui.resetArm = true; render(); return; }
      try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
      save = C.newSave(Date.now()); ui.resetArm = false; ui.session = null; ui.result = null; ui.recipe = null; render();
    }
  });
  app.addEventListener("change", function (ev) {
    var x = ev.target;
    if (x.id === "at-file" && x.files && x.files[0]) {
      CAM.fromFile(x.files[0]).then(function (rgba) { showSwatches(rgba); }, function () { ui.msg = t("at_err_image"); render(); });
      return;
    }
    if (x.id === "at-cauldron") { ui.cauldron = x.value; render(); return; }
    if (x.dataset.atSlot !== undefined) { ui.slots[+x.dataset.atSlot] = x.value ? +x.value : undefined; render(); return; }
    if (x.dataset.atSub) {
      var u = +x.dataset.atSub, k = ui.subs.indexOf(u);
      if (x.checked && k < 0 && ui.subs.length < D.SUBLIMATE_N) ui.subs.push(u); else if (!x.checked && k >= 0) ui.subs.splice(k, 1);
      render(); return;
    }
    if (x.dataset.atTrait) {
      var tk = x.dataset.atTrait, at = ui.traits.indexOf(tk);
      if (x.checked && at < 0) ui.traits.push(tk); else if (!x.checked && at >= 0) ui.traits.splice(at, 1);
      render();
    }
  });
  window.addEventListener("i18n:change", render);
  setInterval(function () { if (ui.tab === "gather" || (ui.tab === "lab" && !ui.session)) { if (!CAM.isOpen()) render(); } }, 30000);

  ideas();
  window.PriTestAtelier = { _debugState: function () { return save; }, _debugUi: function () { return ui; } };
  render();
})();
```

  實作重點：
  - 讀檔一律經過 `C.migrate()`，啟動時先跑一次 `ideas()`（舊存檔也會補上已滿足的發想）。
  - 白平衡模式下，下一張照片只用來校正，不顯示色塊，也不消耗採集籃。
  - 工房分頁的「擅長」只列出已經發想的配方名稱，其他顯示「？？？」，避免劇透。
  - 等級不足但還沒發想的配方，同時顯示等級和發想提示。

- [ ] **Step 5: 全部檢查**

Run: `py -3 generate.py; py -3 tools/split_css.py --check; node --check static_src/atelier.js; node tools/atelier_check/core_check.js; node tools/atelier_check/phase2_check.js; node tools/atelier_check/ui_check.js; node tools/atelier_check/ui2_check.js`
Expected: `23 passed`、`22 passed`、`ui_check ok`、`ui2_check ok`

- [ ] **Step 6: Commit**

```bash
git add static_src/atelier.js static_src/css/atelier.css site_src/i18n_atelier.py tools/atelier_check/ui2_check.js
git commit -m "feat(atelier): 圖鑑與工房分頁、每日色彩、白平衡、選釜、成品投入、升華與畫面檢查"
```

---

### Task 4: 版本與推送

- [ ] **Step 1:** `site_src/version.py` 的 `VERSION = "2.76.0"`
- [ ] **Step 2:** 再跑一次 Task 3 Step 5 的全部檢查
- [ ] **Step 3: Commit 並推送**

```bash
git add site_src/version.py
git commit -m "feat(atelier): v2.76.0 煉金術士第 2 階段：圖鑑 154 色、每日色彩、配方發想、錬金釜與灰燼、成品再投入、升華"
git push private main
```

---

## 自我檢查（對照 docs/atelier_design.md §8）

| 設計 | Task |
|---|---|
| §8.1 C2 154 色、8 組、第一次拍到經驗 +5、圖鑑分頁 | 1、2、3 |
| §8.2 O3 每日色彩（JST、ΔE 20、今日之色特性、一天一次 +50） | 2、3 |
| §8.3 C9 連續採色（減半不歸零、品質 +min(10, n−1)） | 2、3 |
| §8.4 O2 白平衡（中央一半、0.5～2、30 分、×1.1、不消耗採集籃） | 2、3 |
| §8.5 C3 配方發想 5 種條件、新配方 4 種、提示顯示 | 2、3 |
| §8.6 C5 釜 4 個、擅長 ×1.2、B6 升級與素材箱、C10 灰燼 | 2、3 |
| §8.7 O9 成品再投入（類別、形狀、特性繼承、用掉） | 2、3 |
| §8.8 B9 素材升華 | 2、3 |
| §7 舊存檔遷移 | 2、3 |

