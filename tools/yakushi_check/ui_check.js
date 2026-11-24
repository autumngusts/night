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
  // 工作台：試藥（細看）→ 反應卡；鑑定錯一次再改對；調藥錯一次再調對
  await tap("#ys-open-lab");
  await tap('[data-ys-lab="test"]');
  await tap('[data-ys-evidence="ev_tuber"]');
  await tap('[data-ys-test="look"]');
  r = await run();
  assert.ok(r.cards.indexOf("re_tuber_look") >= 0); assert.strictEqual(r.hours, 2);
  assert.ok((await page.textContent("#ys-test-result")).length > 0);

  await tap('[data-ys-lab="identify"]');
  await tap('[data-ys-evidence="ev_tuber"]');
  assert.strictEqual(await page.locator('[data-ys-herb="tiannanxing"]').count(), 0, "細看後天南星應被篩掉");
  await tap('[data-ys-tag="小型塊莖"]');              // 取消勾選這兩個 → 天南星回到候選
  await tap('[data-ys-tag="頂端凹陷莖痕"]');
  assert.strictEqual(await page.locator(".ys-lookalike").count(), 1, "同群組候選 ≥2 應顯示 ys_lookalike");
  await tap('[data-ys-herb="tiannanxing"]');
  await tap("#ys-identify-confirm");
  r = await run();
  assert.strictEqual(r.identified.ev_tuber, "tiannanxing"); assert.strictEqual(r.hours, 1);
  await tap('[data-ys-tag="小型塊莖"]');              // 勾回來（勾選狀態在換證物前會保留）
  await tap('[data-ys-tag="頂端凹陷莖痕"]');
  await tap('[data-ys-herb="banxia"]');
  await tap("#ys-identify-confirm");
  r = await run();
  assert.strictEqual(r.identified.ev_tuber, "banxia"); assert.strictEqual(r.hours, 1);

  await tap('[data-ys-lab="remedy"]');
  await tap('[data-ys-patient="pt_roommate"]');
  await tap('[data-ys-med="shengjiang"]'); await tap('[data-ys-med="gancao"]');
  await tap("#ys-remedy-give");
  r = await run();
  assert.strictEqual(r.patients.pt_roommate.cured, true);
  assert.ok(r.cards.indexOf("tes_roommate") >= 0);
  await tap("#ys-lab-close");

  // 圖鑑：未見過顯示剪影
  await tap("#ys-back-title");
  await tap("#ys-open-book");
  await tap('[data-ys-cat="poison"]');
  var sil = await page.textContent('[data-ys-book-herb="gouwen"]');
  assert.ok(sil.indexOf("？？？") >= 0);
  assert.ok(!/[a-z_]{3,}/.test(sil), "剪影不可外露群組 id：" + sil);
  assert.ok((await page.textContent("#ys-app")).indexOf("非醫療建議") >= 0, "圖鑑要顯示免責聲明");
  await tap("#ys-book-close");
  await tap('[data-ys-case="case0"]');

  // 壞檔不可讓畫面整個空白
  await page.evaluate(function () {
    var s = JSON.parse(localStorage.getItem("pritest-yakushi-save"));
    s.cases.case0.run.cards = "x";
    localStorage.setItem("pritest-yakushi-save", JSON.stringify(s));
  });
  await page.reload();
  assert.strictEqual(await page.locator('[data-ys-case="case0"]').count(), 1);
  assert.strictEqual(await page.locator('[data-ys-case="case1"]').isDisabled(), true);

  var noScroll = await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth; });
  assert.ok(noScroll, "手機寬度出現橫向捲動");
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("ui_check ok");
})().catch(function (e) { console.error(e); process.exit(1); });
