// 少女藥師的獨語（yakushi）Playwright 流程檢查。
// 前置：py -3 generate.py ； py -3 -m http.server 8974 --directory dist
// 執行：node tools/yakushi_check/ui_check.js
// 注意（CLAUDE.md §4.6）：畫面整個重繪，一律用 dispatchEvent。
"use strict";
var path = require("path"), assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;
var BASE = (process.env.YAKUSHI_ROOT || "http://localhost:8974/") + "yakushi/index.html";

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 375, height: 800 } }), errors = [];
  await page.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  async function tap(sel) { await page.dispatchEvent(sel, "click"); }
  async function run() { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestYakushi._debugRun())); }); }
  async function st() { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestYakushi._debugState())); }); }

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-yakushi-save"); });
  await page.reload();
  assert.strictEqual(await page.locator('[data-ys-case="case1"]').isDisabled(), true);

  // 序章：劇情 → 調查
  await tap('[data-ys-case="case0"]');
  await tap("#ys-story-skip");
  var r = await run();
  assert.strictEqual(r.phase, "investigate"); assert.strictEqual(r.hours, 8);
  await tap('[data-ys-spot="d_sick"]');
  r = await run();
  assert.ok(r.cards.indexOf("sym_numb") >= 0); assert.strictEqual(r.hours, 7);
  assert.ok((await page.textContent("#ys-hours")).indexOf("7") >= 0);
  await tap('[data-ys-place="kitchen"]');
  await tap('[data-ys-spot="k_pot"]');
  await tap('[data-ys-spot="k_ledger"]');
  await tap('[data-ys-spot="k_eunuch"]');
  r = await run();
  assert.strictEqual(r.hours, 3);

  // 重新整理後繼續
  await page.reload();
  await tap('[data-ys-case="case0"]');
  r = await run();
  assert.strictEqual(r.hours, 3); assert.strictEqual(r.place, "kitchen");

  // ===== Task 11、12 接在這裡 =====

  var noScroll = await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth; });
  assert.ok(noScroll, "手機寬度出現橫向捲動");
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("ui_check ok");
})().catch(function (e) { console.error(e); process.exit(1); });
