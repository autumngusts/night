// ============================================================================
// 煉金術士（atelier）第 6 階段規則檢查（不需要瀏覽器）。規則依據 docs/atelier_design.md §12。
//   200 種配方的資料完整性、發想鏈、容量擴充（任務／委託／劇情、上限）、舊存檔換算、町的委託、劇情解鎖
// 執行：node tools/atelier_check/phase6_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
global.PriTestAtelierData = require(path.join(SRC, "atelier_data.js"));
global.PriTestAtelierColors = require(path.join(SRC, "atelier_colors.js"));
global.PriTestAtelierHosts = require(path.join(SRC, "atelier_hosts.js"));
global.PriTestAtelierStory = require(path.join(SRC, "atelier_story.js"));
var C = require(path.join(SRC, "atelier_core.js"));
global.PriTestAtelierCore = C;
["board", "ring", "brew", "palette", "gravity"].forEach(function (id) { C.registerMethod(id, require(path.join(SRC, "atelier_method_" + id + ".js"))); });
var D = global.PriTestAtelierData, STORY = global.PriTestAtelierStory;

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }
var T0 = Date.UTC(2026, 10, 19, 3, 0, 0);   // JST 12:00
function item(uid, recipe, quality, lv) {
  return { uid: uid, recipe: recipe, quality: quality, effects: [{ el: "wind", level: lv || 0 }, { el: "ice", level: 0 }], traits: [],
    gauges: { fire: 0, ice: 0, bolt: 0, wind: 5, spirit: 0 }, at: T0 };
}

test("配方共 200 種、id 不重複、名稱三語齊全、價格與量表都有", function () {
  assert.strictEqual(D.RECIPES.length, 200);
  var ids = {};
  D.RECIPES.forEach(function (r) {
    assert(!ids[r.id], "重複 " + r.id); ids[r.id] = true;
    assert(r.name.zh && r.name.ja && r.name.en, r.id);
    assert(D.RECIPE_PRICE[r.id] > 0, r.id + " 價格");
    assert(r.lv >= 1 && r.lv <= D.LV_MAX, r.id + " lv");
    assert.strictEqual(r.gauges.length, 2, r.id);
    assert.notStrictEqual(r.gauges[0].el, r.gauges[1].el, r.id + " 兩條量表屬性不同");
    r.gauges.forEach(function (g) {
      for (var i = 1; i < g.steps.length; i++) assert(g.steps[i].at > g.steps[i - 1].at, r.id + " 門檻遞增");
      g.steps.forEach(function (st) { assert(st.n > 0, r.id); });
    });
  });
});

test("名稱不重複（各語言）", function () {
  ["zh", "ja", "en"].forEach(function (l) {
    var seen = {};
    D.RECIPES.forEach(function (r) { assert(!seen[r.name[l]], l + " 重複：" + r.name[l]); seen[r.name[l]] = true; });
  });
});

test("系列：23 個 × 8 個，系列中每個配方的發想都指向前一個；擅長的釜都有登記", function () {
  assert.strictEqual(D.RECIPE_SERIES.length, 23);
  D.RECIPE_SERIES.forEach(function (s) {
    assert.strictEqual(s.recipes.length, 8, s.id);
    s.recipes.forEach(function (id, i) {
      var r = C.recipe(id);
      assert.strictEqual(r.series, s.id);
      assert(D.CAULDRONS[s.cauldron].affinity.indexOf(id) >= 0, id + " 擅長的釜");
      if (i === 0) return;
      var prev = s.recipes[i - 1], idea = r.idea;
      assert(idea.made === prev || (idea.quality && idea.quality.recipe === prev), id + " 發想指向前一個");
      assert(r.lv > C.recipe(prev).lv, id + " 等級比前一個高");
    });
  });
});

test("每個配方都可能想到：發想條件指向存在的配方／顏色，且沒有循環", function () {
  D.RECIPES.forEach(function (r) {
    var seen = {}, cur = r;
    while (cur && cur.idea) {
      assert(!seen[cur.id], r.id + " 發想循環"); seen[cur.id] = true;
      var i = cur.idea;
      if (i.seen) assert(C.colorById(i.seen), r.id + " " + i.seen);
      cur = i.made ? C.recipe(i.made) : i.quality ? C.recipe(i.quality.recipe) : null;
      if (i.made || i.quality) assert(cur, r.id + " 指向不存在的配方");
    }
  });
});

test("全部做過一次後，200 種都能發想；Lv20 時全部可以調和（季節限定除外）", function () {
  var s = C.newSave(T0);
  s.exp = D.EXP_PER_LV * 30;
  D.RECIPES.forEach(function (r) { s.made[r.id] = 1; s.best[r.id] = 100; });
  require(path.join(SRC, "atelier_colors.js")).forEach(function (c) { s.seen[c.id] = true; });
  C.checkIdeas(s);
  D.RECIPES.forEach(function (r) {
    if (r.season) return;
    assert(C.recipeAvailable(s, r, T0), r.id);
  });
  assert.strictEqual(C.recipesMade(s), 200);
});

test("素材箱：新存檔 40，擴充到上限 100 就停；採集籃最多 10 且擴充時直接補滿", function () {
  var s = C.newSave(T0);
  assert.strictEqual(C.matMax(s), D.MAT_BASE);
  assert.strictEqual(C.basketMax(s), D.BASKET_MAX);
  assert.deepStrictEqual(C.grow(s, 50, 0), { box: 50, basket: 0 });
  assert.deepStrictEqual(C.grow(s, 50, 0), { box: D.MAT_CAP - D.MAT_BASE - 50, basket: 0 });
  assert.strictEqual(C.matMax(s), D.MAT_CAP);
  var n0 = s.basket.n;
  assert.deepStrictEqual(C.grow(s, 0, 3), { box: 0, basket: 3 });
  assert.strictEqual(s.basket.n, n0 + 3);
  assert.deepStrictEqual(C.grow(s, 0, 9), { box: 0, basket: D.BASKET_CAP - D.BASKET_MAX - 3 });
  assert.strictEqual(C.basketMax(s), D.BASKET_CAP);
  assert.strictEqual(C.refillBasket(s, T0 + D.BASKET_REFILL_MS * 100), D.BASKET_CAP);
});

test("舊存檔換算：基本 60＋灰燼擴充＋已完成的任務，容量不會變少", function () {
  var old = { v: 1, nextUid: 30, mats: [], items: [], basket: { n: 3, at: T0 }, cooldownUntil: 0, exp: 200, host: "ruri",
    hosts: { ruri: { aff: 20, task: 3 }, akane: { aff: 0, task: 1, tut: 0 } }, best: {}, tutorial: 3, seen: {}, log: [], shelf: 2 };
  C.migrate(old);
  assert.strictEqual(C.matMax(old), Math.min(D.MAT_CAP, 60 + 2 * 20 + 4 * D.BOX_PER_TASK));
  assert(C.matMax(old) >= 60 + 2 * 20);
  assert.strictEqual(old.story, 0);
  assert.deepStrictEqual(old.reqs, []);
  // 舊版最多 60＋3×20＝120，超過新上限也不能變少
  var big = { v: 1, nextUid: 300, mats: [], items: [], basket: { n: 3, at: T0 }, cooldownUntil: 0, exp: 900, host: "ruri",
    hosts: { ruri: { aff: 20, task: 5 } }, best: {}, tutorial: 3, seen: {}, log: [], shelf: 3 };
  C.migrate(big);
  assert.strictEqual(C.matMax(big), 120);
  var fresh = C.newSave(T0);
  assert.strictEqual(fresh.boxPlus, 0, "新存檔沒有舊版補償");
});

test("工房主人的任務：交貨後素材箱 +BOX_PER_TASK", function () {
  var s = C.newSave(T0);
  s.items.push(item(5, "heal", 80, 1));
  assert.strictEqual(C.deliver(s, 5), true);
  assert.strictEqual(C.matMax(s), D.MAT_BASE + D.BOX_PER_TASK);
});

test("町的委託：補滿 3 件、seed 可重現、只出現可調和的配方", function () {
  var a = C.newSave(T0), b = C.newSave(T0);
  C.refreshReqs(a, T0); C.refreshReqs(b, T0);
  assert.strictEqual(a.reqs.length, D.REQ_SLOTS);
  assert.deepStrictEqual(a.reqs, b.reqs);
  a.reqs.forEach(function (q) {
    assert(C.recipeAvailable(a, C.recipe(q.recipe), T0), q.recipe);
    assert(q.q >= D.REQ_Q_MIN && q.q <= D.REQ_Q_MAX);
    assert(q.coins > 0 && q.exp > 0);
    assert(D.REQ_CLIENTS[q.who]);
  });
  assert.strictEqual(new Set(a.reqs.map(function (q) { return q.id; })).size, D.REQ_SLOTS, "委託 id 不重複");
});

test("町的委託：條件不符不能交；交貨得到銀幣、經驗、前 10 件素材箱 +2，並補上新的委託", function () {
  var s = C.newSave(T0);
  C.refreshReqs(s, T0);
  var req = s.reqs[0];
  s.items.push(item(900, req.recipe, req.q - 1, 1));
  assert.strictEqual(C.fulfillReq(s, req.id, 900, T0), null, "品質不足");
  s.items[0].quality = req.q;
  s.items[0].effects[0].level = req.minLevel;
  var coins = s.coins, exp = s.exp;
  var r = C.fulfillReq(s, req.id, 900, T0);
  assert(r);
  assert.strictEqual(s.coins, coins + req.coins);
  assert.strictEqual(s.exp, exp + req.exp);
  assert.strictEqual(r.box, D.REQ_BOX);
  assert.strictEqual(s.reqDone, 1);
  assert.strictEqual(s.items.length, 0);
  assert.strictEqual(s.reqs.length, D.REQ_SLOTS);
  assert(s.reqs.every(function (q) { return q.id !== req.id; }));
  // 第 11 件以後不再擴充
  s.reqDone = D.REQ_BOX_N;
  var q2 = s.reqs[0];
  s.items.push(item(901, q2.recipe, 100, 3));
  assert.strictEqual(C.fulfillReq(s, q2.id, 901, T0).box, 0);
});

test("町的委託：換一件要花銀幣；配方目前不能調和時免費", function () {
  var s = C.newSave(T0);
  C.refreshReqs(s, T0);
  var req = s.reqs[0];
  assert.strictEqual(C.rerollCost(s, req, T0), D.REQ_REROLL_COINS);
  assert.strictEqual(C.rerollReq(s, req.id, T0), false, "銀幣不足");
  s.coins = D.REQ_REROLL_COINS;
  assert.strictEqual(C.rerollReq(s, req.id, T0), true);
  assert.strictEqual(s.coins, 0);
  assert(s.reqs.every(function (q) { return q.id !== req.id; }));
  s.reqs[0].recipe = "sachet";                                  // 春季限定：11 月不能調和
  assert.strictEqual(C.rerollCost(s, s.reqs[0], T0), 0);
  assert.strictEqual(C.rerollReq(s, s.reqs[0].id, T0), true);
});

test("劇情：依做過的配方種類數依序解鎖，獎勵只給一次；章節門檻遞增、終章＝200 減去季節限定", function () {
  for (var i = 1; i < STORY.length; i++) assert(STORY[i].recipes > STORY[i - 1].recipes);
  assert.strictEqual(STORY[STORY.length - 1].recipes, 200 - D.RECIPES.filter(function (r) { return r.season; }).length);
  STORY.forEach(function (ch) {
    assert(ch.title.zh && ch.title.ja && ch.lines.length);
    ch.lines.forEach(function (l) { assert(l.zh && l.ja && (l.who === "narr" || global.PriTestAtelierHosts[l.who]), ch.id); });
  });
  var s = C.newSave(T0);
  assert.deepStrictEqual(C.checkStory(s), []);
  s.made.heal = 2;
  var got = C.checkStory(s);
  assert.deepStrictEqual(got, [{ index: 0, box: STORY[0].box, basket: STORY[0].basket }]);
  assert.deepStrictEqual(C.checkStory(s), [], "同一章只解鎖一次");
  ["ink", "neutral", "elixir1", "paint1"].forEach(function (id) { s.made[id] = 1; });
  got = C.checkStory(s);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(C.basketMax(s), D.BASKET_MAX + STORY[1].basket);
  assert.strictEqual(C.nextChapter(s).id, "c3");
});

test("劇情＋任務＋委託合計可以擴充到上限；稱號 recipes／reqs 條件", function () {
  var total = D.MAT_BASE + STORY.reduce(function (a, c) { return a + c.box; }, 0) + D.REQ_BOX * D.REQ_BOX_N;
  Object.keys(global.PriTestAtelierHosts).forEach(function (id) { total += global.PriTestAtelierHosts[id].tasks.length * D.BOX_PER_TASK; });
  assert(total >= D.MAT_CAP, "合計 " + total);
  var s = C.newSave(T0);
  assert.strictEqual(C.titleMet(s, { recipes: 1 }), false);
  s.made.heal = 1;
  assert.strictEqual(C.titleMet(s, { recipes: 1 }), true);
  s.reqDone = 30;
  assert.strictEqual(C.titleMet(s, { reqs: 30 }), true);
});

console.log("\n" + passed + " passed");
