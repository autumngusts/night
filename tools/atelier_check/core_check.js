// ============================================================================
// 煉金術士（atelier）規則核心檢查（不需要瀏覽器）。規則依據 docs/atelier_design.md。
// 執行：node tools/atelier_check/core_check.js
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
var T0 = Date.UTC(2026, 10, 19, 3, 0, 0);   // JST 12:00（沒有時間特性）

// 測試用：w×h 的 RGBA，左右兩半不同顏色
function split(left, right, w) {
  var a = new Uint8ClampedArray(w * w * 4);
  for (var y = 0; y < w; y++) for (var x = 0; x < w; x++) {
    var c = x < w / 2 ? left : right, i = (y * w + x) * 4;
    a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; a[i + 3] = 255;
  }
  return a;
}
function mat(uid, el, cat, shape, q, power) {
  return { uid: uid, hex: "#000000", rgb: [0, 0, 0], colorId: "sumi", element: el, category: cat,
    power: power || 2, quality: q || 50, traits: [], shape: shape, at: T0 };
}

// ---------- 色彩數學 ----------
test("HSV：純紅、純綠、灰", function () {
  var r = C.rgbToHsv([255, 0, 0]);
  assert.strictEqual(r.h, 0); assert.strictEqual(r.s, 1); assert.strictEqual(r.v, 1);
  assert.strictEqual(Math.round(C.rgbToHsv([0, 255, 0]).h), 120);
  assert.strictEqual(C.rgbToHsv([128, 128, 128]).s, 0);
});

test("Lab：白 L≈100、黑 L＝0", function () {
  assert(Math.abs(C.rgbToLab([255, 255, 255])[0] - 100) < 0.5);
  assert.strictEqual(Math.round(C.rgbToLab([0, 0, 0])[0]), 0);
});

test("傳統色：瑠璃色本身的最近色就是瑠璃色，距離 0", function () {
  var n = C.nearestColor(C.hexToRgb("#1E50A2"));
  assert.strictEqual(n.color.id, "ruri");
  assert(n.dist < 1e-9);
});

test("色相 → 屬性（含跨 0 度與無彩色）", function () {
  assert.strictEqual(C.elementOf({ h: 350, s: 0.8, v: 0.8 }), "fire");
  assert.strictEqual(C.elementOf({ h: 10, s: 0.8, v: 0.8 }), "fire");
  assert.strictEqual(C.elementOf({ h: 60, s: 0.8, v: 0.8 }), "bolt");
  assert.strictEqual(C.elementOf({ h: 120, s: 0.8, v: 0.8 }), "wind");
  assert.strictEqual(C.elementOf({ h: 220, s: 0.8, v: 0.8 }), "ice");
  assert.strictEqual(C.elementOf({ h: 290, s: 0.8, v: 0.8 }), "spirit");
  assert.strictEqual(C.elementOf({ h: 120, s: 0.05, v: 0.8 }), "spirit");
});

test("類別：暗 → 影、亮且淡 → 結晶、其他依屬性", function () {
  assert.strictEqual(C.categoryOf({ h: 0, s: 0.9, v: 0.1 }, "fire"), "shadow");
  assert.strictEqual(C.categoryOf({ h: 0, s: 0.1, v: 0.95 }, "spirit"), "crystal");
  assert.strictEqual(C.categoryOf({ h: 200, s: 0.8, v: 0.7 }, "ice"), "liquid");
  assert.strictEqual(C.categoryOf({ h: 120, s: 0.8, v: 0.7 }, "wind"), "plant");
});

// ---------- 照片分析 ----------
test("左右兩色的照片 → 2 個色塊，各約 50%，形狀 6 格", function () {
  var sw = C.analyze(split([200, 30, 30], [30, 60, 200], 32), 32, 32, "t1");
  assert.strictEqual(sw.length, 2);
  sw.forEach(function (s) {
    assert(Math.abs(s.frac - 0.5) < 0.01);
    assert.strictEqual(s.shape.length, 6);
  });
  var hexes = sw.map(function (s) { return s.hex; }).sort();
  assert.deepStrictEqual(hexes, ["#1E3CC8", "#C81E1E"]);
});

test("同一張照片、同一個 seed，結果完全相同（O11）", function () {
  var px = split([10, 200, 90], [240, 220, 40], 32);
  assert.deepStrictEqual(C.analyze(px, 32, 32, "same"), C.analyze(px, 32, 32, "same"));
});

test("形狀：連通、正規化到 (0,0)、旋轉 4 次回到原形", function () {
  var G = D.GRID, grid = [];
  for (var i = 0; i < G * G; i++) grid.push(i % G < 3 ? 1 : 0);   // 左邊 3 欄是 label 1
  var shape = C.shapeFromGrid(grid, 1, 5);
  assert.strictEqual(shape.length, 5);
  assert.strictEqual(Math.min.apply(null, shape.map(function (c) { return c[0]; })), 0);
  assert.strictEqual(Math.min.apply(null, shape.map(function (c) { return c[1]; })), 0);
  assert.deepStrictEqual(C.rotateShape(shape, 4), C.normalizeShape(shape));
  assert.deepStrictEqual(C.rotateShape([[0, 0], [1, 0], [2, 0]], 1), [[0, 0], [0, 1], [0, 2]]);
});

// ---------- 素材 ----------
test("素材：純度高的瑠璃色品質高，帶稀有色特性；時間特性依 JST", function () {
  var m = C.makeMaterial({ rgb: C.hexToRgb("#1E50A2"), hex: "#1E50A2", frac: 0.3, shape: [[0, 0]] }, T0, 1);
  assert.strictEqual(m.colorId, "ruri");
  assert.strictEqual(m.element, "ice");
  assert.strictEqual(m.category, "liquid");
  assert(m.quality >= 80, "quality " + m.quality);
  assert(m.traits.indexOf("hue_blessing") >= 0);
  assert(m.traits.indexOf("vivid") >= 0);
  assert.deepStrictEqual(C.timeTraits(Date.UTC(2026, 10, 18, 21, 0, 0)), ["morning_dew"]);   // JST 06:00
  assert.deepStrictEqual(C.timeTraits(Date.UTC(2026, 10, 18, 14, 0, 0)), ["night"]);         // JST 23:00
  assert.deepStrictEqual(C.timeTraits(T0), []);
});

test("採集籃：每次消耗 1，用完不能採；20 分回復 1，不超過上限", function () {
  var s = C.newSave(T0), sw = { rgb: [200, 30, 30], hex: "#C81E1E", frac: 0.5, shape: [[0, 0]] };
  for (var i = 0; i < D.BASKET_MAX; i++) assert(C.capture(s, [sw], T0));
  assert.strictEqual(C.capture(s, [sw], T0), null);
  assert.strictEqual(C.refillBasket(s, T0 + D.BASKET_REFILL_MS * 2 + 1000), 2);
  assert.strictEqual(C.refillBasket(s, T0 + D.BASKET_REFILL_MS * 100), D.BASKET_MAX);
  assert.strictEqual(C.capture(s, [sw, sw, sw, sw], T0), null, "一次最多 3 色");
  assert.strictEqual(s.mats.length, D.BASKET_MAX);
  assert(s.seen.akane || s.seen.beni || Object.keys(s.seen).length === 1);
});

// ---------- 棋盤 ----------
function session(mats, ability) {
  return Board.create(C.recipe("heal"), mats, D.CAULDRONS.copper, ability || {});
}

test("棋盤：銅之大釜 5×5，色格與加成格依 pattern", function () {
  var s = session([mat(1, "wind", "plant", [[0, 0]])]);
  assert.strictEqual(s.size, 5);
  assert.deepStrictEqual(s.cells[0], { color: "fire", bonus: false });
  assert.deepStrictEqual(s.cells[2], { color: null, bonus: true });
  assert.deepStrictEqual(s.cells[6], { color: "fire", bonus: true });
});

test("放置：超出邊界或重複放置不行", function () {
  var s = session([mat(1, "wind", "plant", [[0, 0], [1, 0]])]);
  assert.strictEqual(Board.canPlace(s, 0, 4, 0, 0), false);
  assert.strictEqual(Board.canPlace(s, 0, 4, 0, 1), true);     // 旋轉後變直的就放得下
  assert(Board.place(s, 0, 3, 0, 0).ok);
  assert.strictEqual(Board.place(s, 0, 0, 0, 0).ok, false);
});

test("量表：一般格 power、同色格 ×2、加成格 +2／同色 +4", function () {
  // (0,4) 是風色格 w；(1,3) 是風色加成格 W；(1,1) 是火色加成格 F
  var s = session([mat(1, "wind", "plant", [[0, 0]], 50, 2), mat(2, "wind", "plant", [[0, 0]], 50, 2),
    mat(3, "wind", "plant", [[0, 0]], 50, 2), mat(4, "wind", "plant", [[0, 0]], 50, 2)]);
  Board.place(s, 0, 1, 0, 0);   // 一般格：2
  Board.place(s, 1, 0, 4, 0);   // 同色格：2+2＝4
  Board.place(s, 2, 1, 3, 0);   // 同色加成格：2+2+4＝8
  Board.place(s, 3, 1, 1, 0);   // 異色加成格：2+2＝4
  var ev = Board.evaluate(s, false);
  assert.strictEqual(ev.gauges.wind, 2 + 4 + 8 + 4);
  assert.strictEqual(ev.covered, 4);
});

test("瑠璃的能力：同色格每格再 +1", function () {
  var s = session([mat(1, "wind", "plant", [[0, 0]], 50, 2)], { matchBonus: 1 });
  Board.place(s, 0, 0, 4, 0);
  assert.strictEqual(Board.evaluate(s, false).gauges.wind, 5);
});

test("覆蓋：被蓋掉的格子不再計算；完全被蓋掉的素材 visible＝0；Undo 還原", function () {
  var s = session([mat(1, "fire", "mineral", [[0, 0]]), mat(2, "wind", "plant", [[0, 0], [1, 0]])]);
  Board.place(s, 0, 1, 0, 0);
  var info = Board.place(s, 1, 0, 0, 0);
  assert.strictEqual(info.overwritten, 1);
  var ev = Board.evaluate(s, false);
  assert.strictEqual(ev.visible[0], 0);
  assert.strictEqual(ev.gauges.fire, 0);
  assert(Board.undo(s));
  assert.strictEqual(Board.evaluate(s, false).visible[0], 1);
  assert.strictEqual(s.placed[1], false);
});

test("最後一推：佔比最多的屬性 × 佔比 × 0.5", function () {
  var s = session([mat(1, "wind", "plant", [[0, 0], [1, 0], [2, 0]], 50, 2), mat(2, "fire", "mineral", [[0, 0]], 50, 2)]);
  Board.place(s, 0, 1, 2, 0);    // (1,2) 一般、(2,2) 靈色格（異色）、(3,2) 一般 → 6
  Board.place(s, 1, 0, 1, 0);    // (0,1) 一般 → 2
  var ev = Board.evaluate(s, true);
  assert.strictEqual(ev.dominant, "wind");
  assert.strictEqual(ev.push, Math.round(6 * 0.75 * D.FINAL_PUSH_RATE));
  assert.strictEqual(ev.gauges.wind, 6 + ev.push);
});

test("品質：看得到的素材平均＋每格 × 釜的品質上升率", function () {
  var s = session([mat(1, "wind", "plant", [[0, 0], [1, 0]], 40), mat(2, "wind", "plant", [[0, 0]], 60)]);
  Board.place(s, 0, 1, 2, 0);
  Board.place(s, 1, 0, 0, 0);
  assert.strictEqual(Board.evaluate(s, true).quality, Math.round(50 + 0.6 * 3));
});

test("預覽不改動 session", function () {
  var s = session([mat(1, "wind", "plant", [[0, 0]])]);
  var p = Board.preview(s, 0, 0, 4, 0);
  assert.strictEqual(p.after.gauges.wind > p.before.gauges.wind, true);
  assert.strictEqual(s.placed[0], false);
  assert.strictEqual(s.owner[20], -1);
});

// ---------- 調和流程 ----------
function readySave() {
  var s = C.newSave(T0);
  s.mats = [mat(11, "ice", "liquid", [[0, 0], [1, 0]], 60, 3), mat(12, "wind", "plant", [[0, 0], [0, 1]], 60, 3),
    mat(13, "wind", "plant", [[0, 0]], 60, 3)];
  s.mats[0].traits = ["vivid"]; s.mats[1].traits = ["hue_grace", "dusk"];
  s.nextUid = 100;
  return s;
}

test("開始調和：類別不合、冷卻中、等級不足都會被擋下", function () {
  var s = readySave();
  assert.strictEqual(C.startSynthesis(s, "heal", [12, 11, 13], "copper", T0).error, "slot");
  assert.strictEqual(C.startSynthesis(s, "bomb", [11, 12, 13], "copper", T0).error, "recipe");
  s.cooldownUntil = T0 + 1;
  assert.strictEqual(C.startSynthesis(s, "heal", [11, 12, 13], "copper", T0).error, "cooldown");
});

test("完成調和：特性成本上限、成品、扣素材、經驗、冷卻、好感度、最佳紀錄", function () {
  var s = readySave(), ss = C.startSynthesis(s, "heal", [11, 12, 13], "copper", T0);
  assert.strictEqual(ss.method, "board");
  assert.strictEqual(C.finishSynthesis(s, ss, [], T0).error, "unplaced");
  Board.place(ss, 0, 3, 0, 0);   // 冰 2 格：(3,0) 一般、(4,0) 冰色格
  Board.place(ss, 1, 0, 3, 0);   // 風 2 格：(0,3) 一般、(0,4) 風色格
  Board.place(ss, 2, 1, 3, 0);   // 風色加成格
  assert.deepStrictEqual(C.traitChoices(ss).sort(), ["dusk", "hue_grace", "vivid"]);
  assert.strictEqual(C.traitCap(s), 15);
  assert.strictEqual(C.traitsValid(s, ss, ["vivid", "hue_grace"]), false, "12＋10 超過 15");
  assert.strictEqual(C.traitsValid(s, ss, ["vivid", "night"]), false, "沒有的特性不能選");
  assert.strictEqual(C.finishSynthesis(s, ss, ["hue_grace", "dusk"], T0).error, "traits", "10＋6 超過 15");
  var item = C.finishSynthesis(s, ss, ["dusk"], T0);
  assert.strictEqual(item.recipe, "heal");
  assert.strictEqual(s.mats.length, 0);
  assert.strictEqual(s.items.length, 1);
  assert.strictEqual(s.exp, D.EXP_PER_SYNTH);
  assert.strictEqual(s.cooldownUntil, T0 + D.COOLDOWN_MS);
  assert.strictEqual(s.hosts.ruri.aff, D.AFF_PER_SYNTH);
  assert.strictEqual(s.best.heal, item.quality);
  var heal = item.effects[0];
  assert.strictEqual(heal.el, "wind");
  assert(heal.level >= 1);
  assert.strictEqual(heal.n, Math.round(D.RECIPES[0].gauges[0].steps[heal.level - 1].n * 1.1), "黃昏 +10%");
});

test("任務：符合條件才能交貨，交貨後進到下一個任務", function () {
  var s = C.newSave(T0);
  s.items = [{ uid: 5, recipe: "heal", quality: 20, effects: [], traits: [] }, { uid: 6, recipe: "heal", quality: 35, effects: [], traits: [] }];
  assert.strictEqual(C.currentTask(s).id, "r1");
  assert.strictEqual(C.deliver(s, 5), false);
  assert.strictEqual(C.deliver(s, 6), true);
  assert.strictEqual(C.currentTask(s).id, "r2");
  assert.strictEqual(s.hosts.ruri.aff, D.AFF_PER_TASK);
});

test("瑠璃的反應：效果升級 > 加成格 > 同色 > 覆蓋 > 沒對上（好感度高時給提示）", function () {
  var s = C.newSave(T0), r = C.recipe("heal");
  var g0 = { gauges: { wind: 0 } }, g1 = { gauges: { wind: 6 } };
  assert.strictEqual(C.react(s, g0, g1, { recipe: r, cells: 1, matchCells: 0, bonusCells: 0, overwritten: 0 }), "levelup");
  assert.strictEqual(C.react(s, g0, g0, { recipe: r, cells: 2, matchCells: 0, bonusCells: 1, overwritten: 0 }), "bonus");
  assert.strictEqual(C.react(s, g0, g0, { recipe: r, cells: 2, matchCells: 1, bonusCells: 0, overwritten: 0 }), "match");
  assert.strictEqual(C.react(s, g0, g0, { recipe: r, cells: 3, matchCells: 1, bonusCells: 0, overwritten: 1 }), "overwrite");
  assert.strictEqual(C.react(s, g0, g0, { recipe: r, cells: 3, matchCells: 0, bonusCells: 0, overwritten: 0 }), "miss");
  s.hosts.ruri.aff = D.AFF_HINT;
  assert.strictEqual(C.react(s, g0, g0, { recipe: r, cells: 3, matchCells: 0, bonusCells: 0, overwritten: 0 }), "hint");
});

test("資料完整性：每個配方的量表屬性存在、每個工房主人的 method 已登記、台詞都有 zh／ja", function () {
  var els = D.ELEMENTS.map(function (e) { return e.id; });
  D.RECIPES.forEach(function (r) {
    r.gauges.forEach(function (g) { assert(els.indexOf(g.el) >= 0, r.id); });
    r.needs.forEach(function (n) { assert(n === "*" || D.CATEGORIES.indexOf(n) >= 0, r.id + " " + n); });
  });
  Object.keys(global.PriTestAtelierHosts).forEach(function (id) {
    var h = global.PriTestAtelierHosts[id];
    assert(C.method(h.method), id + " method");
    Object.keys(h.lines).forEach(function (k) { h.lines[k].forEach(function (l) { assert(l.zh && l.ja, id + " " + k); }); });
    h.tasks.forEach(function (t) { assert(C.recipe(t.recipe), t.id); });
  });
  Object.keys(D.TRAITS).forEach(function (t) { assert(D.TRAITS[t].cost > 0); });
  D.TIME_TRAITS.concat([{ trait: D.RARITY_TRAIT[2] }, { trait: D.RARITY_TRAIT[3] }, { trait: "vivid" }])
    .forEach(function (t) { assert(D.TRAITS[t.trait], t.trait); });
});

console.log("\n" + passed + " passed");
