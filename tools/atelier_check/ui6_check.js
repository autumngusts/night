// 煉金術士（atelier）第 6 階段 Playwright 流程檢查（docs/atelier_design.md §12）：
//   採色 → 用核心調和一次（產生完整的成品資料）→ 重新載入時第一章劇情跳出 → 一句一句看完 → 素材箱擴充與通知
//   → 配方列表 200 種、類別／狀態篩選 → 町的委託 3 件、交貨（銀幣、素材箱 +2、補新委託）→ 重看章節 → 手機寬度 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8973 --directory dist
// 執行：node tools/atelier_check/ui6_check.js
"use strict";
var path = require("path"), assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;
var BASE = (process.env.ATELIER_ROOT || "http://localhost:8973/") + "atelier/index.html";
var KEY = "pritest-atelier-save-v1";

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 375, height: 800 } }), errors = [];
  await page.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  async function state() { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestAtelier._debugState())); }); }
  async function tap(sel) { await page.dispatchEvent(sel, "click"); }
  async function png(colors) {
    var b64 = await page.evaluate(function (cs) {
      var c = document.createElement("canvas"); c.width = 64; c.height = 64;
      var g = c.getContext("2d"), w = 64 / cs.length;
      cs.forEach(function (hex, i) { g.fillStyle = hex; g.fillRect(Math.round(i * w), 0, Math.ceil(w) + 1, 64); });
      return c.toDataURL("image/png").split(",")[1];
    }, colors);
    return { name: "t.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") };
  }

  await page.goto(BASE);
  await page.evaluate(function (k) { localStorage.removeItem(k); }, KEY);
  await page.reload();
  var s = await state();
  assert.strictEqual(s.reqs.length, 3, "一開始就有 3 件町的委託");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestAtelierCore.matMax(window.PriTestAtelier._debugState()); }), 40);

  // 採色 2 個素材
  await page.setInputFiles("#at-file", await png(["#E83929", "#1E50A2"]));
  await page.waitForSelector("#at-swatches");
  await tap('[data-at-pick="0"]'); await tap('[data-at-pick="1"]');
  await tap("#at-collect");
  assert.strictEqual((await state()).mats.length, 2);

  // 用核心做一次色彩墨水（產生完整的成品資料），存檔後重新載入（CLAUDE.md §4.4：由 App 建立資料，再寫回）
  await page.evaluate(function (k) {
    var A = window.PriTestAtelier, C = window.PriTestAtelierCore, sv = A._debugState(), now = Date.now();
    var ss = C.startSynthesis(sv, "ink", sv.mats.map(function (m) { return m.uid; }), "copper", now);
    var impl = C.method(ss.method);
    ss.mats.forEach(function (m, i) { var o = C.bestPlacement(ss, i); impl.place(ss, i, o.x, o.y, o.rot); });
    var it = C.finishSynthesis(sv, ss, [], now);
    if (it.error) throw new Error(it.error);
    localStorage.setItem(k, JSON.stringify(sv));
  }, KEY);
  await page.reload();

  // 第一章劇情跳出
  await page.waitForSelector("#at-story");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestAtelier._debugUi().story.i; }), 0);
  assert(await page.$(".at-story-fresh"), "第一次出現時有進場動畫");
  var lines = await page.evaluate(function () { return window.PriTestAtelierStory[0].lines.length; });
  for (var i = 0; i < lines; i++) {
    assert(await page.$("#at-story-line"), "第 " + (i + 1) + " 句");
    await tap("#at-story-next");
  }
  await page.waitForSelector("#at-story-reward .at-reward-pop");
  await tap("#at-story-close");
  assert.strictEqual(await page.$("#at-story"), null, "關閉後視窗消失");
  await page.waitForSelector("#at-toasts .at-toast");
  s = await state();
  assert.strictEqual(s.story, 1);
  assert.strictEqual(await page.evaluate(function () { return window.PriTestAtelierCore.matMax(window.PriTestAtelier._debugState()); }), 45);

  // 配方列表：200 種、類別篩選、只看可以調和
  await tap('[data-at-tab="lab"]');
  await tap("#at-dev-cool");
  await page.waitForSelector("#at-recipes");
  assert.strictEqual(await page.$$eval("#at-recipes li", function (x) { return x.length; }), 200);
  assert(await page.$("#at-rprog"), "做過的配方進度");
  await tap('[data-at-rcat="liquid"]');
  var cls = await page.$$eval("#at-recipes .at-rcard", function (x) { return x.map(function (b) { return b.className; }); });
  assert(cls.length > 0 && cls.every(function (c) { return c.indexOf("at-rcat-liquid") >= 0; }), "只剩液體");
  await tap('[data-at-rcat="all"]');
  await tap('[data-at-rview="ready"]');
  var ready = await page.evaluate(function () {
    return window.PriTestAtelierData.RECIPES.filter(function (r) { return window.PriTestAtelierCore.recipeAvailable(window.PriTestAtelier._debugState(), r, Date.now()); }).length;
  });
  assert.strictEqual(await page.$$eval("#at-recipes li", function (x) { return x.length; }), ready);
  assert.strictEqual(await page.$$eval("#at-recipes .at-rcard:disabled", function (x) { return x.length; }), 0);
  assert(await page.$('[data-at-recipe="ink"] .at-rcard-badge-done'), "做過的配方有 ✓");
  await tap('[data-at-rview="fresh"]');
  assert.strictEqual(await page.$('[data-at-recipe="ink"]'), null, "「還沒做過」不含墨水");
  await tap('[data-at-rview="all"]');
  // 鏈的後段：前一個還沒想到時不洩漏名稱
  var hint = await page.textContent('[data-at-recipe="elixir3"]');
  assert(hint.indexOf("蜂蜜滋養液") < 0, "elixir2 還不知道，不能出現名稱：" + hint);

  // 町的委託：把第 1 件改成「墨水、品質不超過成品」再重新載入（只改需要的欄位）
  await page.evaluate(function (k) {
    var sv = JSON.parse(JSON.stringify(window.PriTestAtelier._debugState()));
    sv.reqs[0].recipe = "ink"; sv.reqs[0].q = Math.min(sv.items[0].quality, 20); sv.reqs[0].minLevel = 0;
    localStorage.setItem(k, JSON.stringify(sv));
  }, KEY);
  await page.reload();
  await tap('[data-at-tab="tasks"]');
  await page.waitForSelector("#at-reqs");
  assert.strictEqual(await page.$$eval("#at-reqs > li", function (x) { return x.length; }), 3);
  s = await state();
  var reqId = s.reqs[0].id, uid = s.items[0].uid, coins = s.coins;
  await tap('[data-at-fulfill="' + reqId + ":" + uid + '"]');
  s = await state();
  assert.strictEqual(s.reqDone, 1);
  assert(s.coins > coins, "得到銀幣");
  assert.strictEqual(s.items.length, 0);
  assert.strictEqual(s.reqs.length, 3, "補上新的委託");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestAtelierCore.matMax(window.PriTestAtelier._debugState()); }), 47);

  // 重看第一章：沒有獎勵
  await tap('[data-at-chapter="0"]');
  await page.waitForSelector("#at-story");
  await tap("#at-story-skip");
  await page.waitForSelector("#at-story-reward");
  assert.strictEqual(await page.$("#at-story-reward .at-reward-pop"), null, "重看沒有獎勵");
  await tap("#at-story-close");
  assert.strictEqual((await state()).story, 1);

  // 素材箱分頁的容量、店鋪不再有灰燼擴充
  await tap('[data-at-tab="shop"]');
  assert.strictEqual(await page.$("#at-shelf"), null);
  assert(await page.$("#at-box-cap"));

  // 語言切換（日文）後劇情視窗也能顯示
  await page.evaluate(function () { window.I18N.setLang("ja"); });
  await tap('[data-at-tab="tasks"]');
  await tap('[data-at-chapter="0"]');
  assert((await page.textContent("#at-story .at-story-title")).indexOf("第一章") >= 0);
  await tap("#at-story-skip"); await tap("#at-story-close");
  await page.evaluate(function () { window.I18N.setLang("zh"); });

  // 手機寬度不橫向捲動（配方列表、委託）
  for (var tab of ["lab", "tasks"]) {
    await tap('[data-at-tab="' + tab + '"]');
    var over = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
    assert(over <= 1, tab + " 橫向捲動 " + over);
  }

  assert.deepStrictEqual(errors, []);
  console.log("ui6_check ok");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
