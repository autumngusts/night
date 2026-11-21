// 煉金術士（atelier）第 4 階段 Playwright 流程檢查：
//   彩虹條紋照片（虹、配色、季節色彩祭）→ 兩張兩色照片 → 繪本「金魚」填完（經驗、稱號「繪本畫家」）
//   → 稱號顯示在頁首 → 裝飾繪本（瑠璃喜歡）→ 調和色彩墨水 → 店鋪賣出 → 語言切換 → 手機寬度 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8973 --directory dist
// 執行：node tools/atelier_check/ui4_check.js
"use strict";
var path = require("path"), assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;
var BASE = (process.env.ATELIER_ROOT || "http://localhost:8973/") + "atelier/index.html";
var KEY = "pritest-atelier-save-v1";

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 375, height: 800 } }), errors = [];
  // 2026-11-20 起這個遊戲在「付款」分頁，頁面會先問密碼；測試前先寫入解鎖旗標（layout.PAY_STORAGE_KEY）
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
  async function captureAll(colors, max) {
    await page.setInputFiles("#at-file", await png(colors));
    await page.waitForSelector("#at-swatches");
    var n = Math.min(max || 3, await page.$$eval("[data-at-pick]", function (x) { return x.length; }));
    for (var i = 0; i < n; i++) await tap('[data-at-pick="' + i + '"]');
    await tap("#at-collect");
  }

  await page.goto(BASE);
  await page.evaluate(function (k) { localStorage.removeItem(k); }, KEY);
  await page.reload();
  assert(await page.$("#at-season"), "採色頁要顯示季節色彩祭");

  // 彩虹條紋：虹＋配色
  var rainbow = ["#FF0000", "#FF8000", "#FFFF00", "#80FF00", "#00FF00", "#00FF80", "#00FFFF", "#0080FF", "#0000FF", "#8000FF", "#FF00FF", "#FF0080"];
  await page.setInputFiles("#at-file", await png(rainbow));
  await page.waitForSelector("#at-swatches");
  assert(await page.$("#at-rainbow"), "要提示這張照片是虹");
  assert(await page.$("#at-harmony"), "彩虹照片應該有配色");
  await tap('[data-at-pick="0"]');
  await tap("#at-collect");
  var s = await state();
  assert(s.mats.some(function (m) { return m.rainbow; }), "要得到虹之欠片");
  assert(s.mats.filter(function (m) { return !m.rainbow; })[0].traits.indexOf("harmony") >= 0);

  // 四色照片 → 繪本「金魚」
  // 每張只放 2 色並全部選取（4 色一張只能選 3 色，哪 3 色取決於 seed，會不穩定）
  await captureAll(["#1E50A2", "#3EB370"], 2);
  await captureAll(["#EE7800", "#D7003A"], 2);
  await tap('[data-at-tab="book"]');
  assert(await page.$("#at-book"));
  for (var region of ["water", "weed", "body", "tail"]) {
    await tap('[data-at-region="' + region + '"]');
    await page.waitForSelector("[data-at-paint]");
    await tap("[data-at-paint]");
  }
  s = await state();
  assert.strictEqual(s.pagesDone.goldfish, true);
  assert(s.titles.painter, "完成繪本要取得「繪本畫家」");
  assert((await page.textContent("#at-msg")).length > 0);

  // 稱號、裝飾
  await tap('[data-at-tab="shop"]');
  await page.selectOption("#at-title-select", "painter");
  assert(await page.$("#at-title"), "頁首要顯示稱號");
  await page.selectOption('[data-at-deco="0"]', "page:goldfish");
  s = await state();
  assert.strictEqual(s.deco[0], "page:goldfish");

  // 調和色彩墨水 → 店鋪賣出
  await tap('[data-at-tab="lab"]');
  await tap('[data-at-recipe="ink"]');
  for (var i = 0; i < 2; i++) {
    var opts = await page.$$eval('[data-at-slot="' + i + '"] option', function (x) { return x.map(function (o) { return o.value; }).filter(Boolean); });
    await page.selectOption('[data-at-slot="' + i + '"]', opts[0]);
  }
  await tap("#at-start");
  await page.waitForSelector("#at-board");
  for (;;) {
    var pos = await page.evaluate(function () {
      var ui = window.PriTestAtelier._debugUi(), ss = ui.session, B = window.PriTestAtelierCore.method(ss.method);
      if (B.done(ss)) return "done";
      for (var y = 0; y < ss.size; y++) for (var x = 0; x < ss.size; x++) if (B.canPlace(ss, ui.sel, x, y, ui.rot)) return x + "," + y;
      return null;
    });
    if (pos === "done") break;
    assert(pos);
    await tap('[data-at-cell="' + pos + '"]'); await tap('[data-at-cell="' + pos + '"]');
  }
  await tap("#at-finish");
  await page.waitForSelector("#at-result");
  s = await state();
  var uid = s.items[0].uid;
  await tap('[data-at-tab="shop"]');
  await tap('[data-at-sell="' + uid + '"]');
  s = await state();
  assert.strictEqual(s.items.length, 0);
  assert(s.coins > 0 && s.coinsEarned === s.coins);

  // 語言、手機寬度
  await page.evaluate(function () { window.I18N.setLang("ja"); });
  // 2026-11-21 起分頁加上圖示（.at-tab-icon），只比對文字標籤
  assert.strictEqual((await page.textContent('[data-at-tab="book"] .at-tab-label')).trim(), "絵本");
  await page.evaluate(function () { window.I18N.setLang("zh"); });
  for (var tab of ["gather", "box", "lab", "tasks", "dex", "book", "shop"]) {
    await tap('[data-at-tab="' + tab + '"]');
    var over = await page.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    assert(over <= 0, tab + " 橫向捲動 " + over + "px");
  }
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("ui4_check ok");
})().catch(function (e) { console.error(e); process.exit(1); });
