// イヌスノー（狗雪）畫面檢查（Playwright）。
//   1. py -3 generate.py
//   2. py -3 -m http.server 8975 --directory dist
//   3. node tools/inusnow_check/ui_check.js   （INUSNOW_ROOT 可改網址）
// 依據計畫 docs/superpowers/plans/2026-11-20-inusnow-phase1.md Task 8。截圖存在 SHOT_DIR（預設系統暫存資料夾）。
"use strict";
var path = require("path");
var os = require("os");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var ROOT = process.env.INUSNOW_ROOT || "http://localhost:8975/";
var BASE = ROOT + "inusnow/index.html";
var SHOT_DIR = process.env.SHOT_DIR || os.tmpdir();
var RESORTS = ["happo", "yakebitai", "teine", "hirafu", "zao", "nozawa", "naeba", "rusutsu"];

function ok(m) { console.log("ok - " + m); }

async function newPage(browser, vp) {
  var page = await browser.newPage({ viewport: vp });
  // 付款分頁的遊戲：開頁前先寫入解鎖旗標（CLAUDE.md §4.3.1）
  await page.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
  page._errors = [];
  page.on("pageerror", function (e) { page._errors.push(e.message); });
  page.on("console", function (m) { if (m.type() === "error") page._errors.push(m.text()); });
  return page;
}

function state(page) { return page.evaluate(function () { return window.PriTestInusnowApp._debug.state(); }); }

async function fullRun(page, resort, opts) {
  await page.evaluate(function (a) {
    var d = window.PriTestInusnowApp._debug;
    d.autopilot(true); d.speedUp(8); d.start(a.r, a.o);
  }, { r: resort, o: opts || {} });
  await page.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().screen === "result"; }, null, { timeout: 180000 });
}

(async function () {
  var browser = await chromium.launch();
  try {
    // 1. 手機與桌機：開頁 → 選八方 → 開賽 → 自動駕駛跑完 → 成績
    var sizes = [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 800 }]];
    for (var i = 0; i < sizes.length; i++) {
      var name = sizes[i][0], page = await newPage(browser, sizes[i][1]);
      await page.goto(BASE);
      await page.waitForSelector(".inu-resort");
      assert.strictEqual((await page.$$(".inu-resort")).length, 8, "雪場 8 個");
      await page.dispatchEvent('.inu-resort[data-resort="happo"]', "click");
      await page.waitForSelector(".inu-breed");
      assert.strictEqual((await page.$$(".inu-breed")).length, 8, "犬種 8 種");
      await page.dispatchEvent('.inu-breed[data-breed="husky"]', "click");
      await page.evaluate(function () { window.PriTestInusnowApp._debug.autopilot(true); });
      await page.dispatchEvent('[data-act="start"]', "click");
      await page.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().phase === "run"; }, null, { timeout: 60000 });
      await page.waitForTimeout(2500);
      var noScroll = await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight; });
      assert.ok(noScroll, name + "：比賽畫面沒有捲軸");
      assert.ok(await page.$("canvas.inu-canvas"), name + "：有 3D 畫面");
      await page.screenshot({ path: path.join(SHOT_DIR, "inusnow_race_" + name + ".png") });
      await page.evaluate(function () { window.PriTestInusnowApp._debug.speedUp(8); });
      await page.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().screen === "result"; }, null, { timeout: 180000 });
      var txt = await page.$eval(".inu-result", function (e) { return e.innerText; });
      assert.ok(/\d:\d\d\.\d\d/.test(txt), name + "：成績顯示時間");
      await page.screenshot({ path: path.join(SHOT_DIR, "inusnow_result_" + name + ".png") });
      assert.deepStrictEqual(page._errors, [], name + "：沒有 console error");
      ok(name + "：雪場 → 選手 → 比賽 → 成績");
      await page.close();
    }

    // 2. 重新整理後最佳紀錄還在；開幽靈 → 下一趟有幽靈；2 趟合計
    var p2 = await newPage(browser, { width: 390, height: 844 });
    await p2.goto(BASE);
    await p2.waitForSelector(".inu-resort");
    await fullRun(p2, "naeba", { ghost: true });
    await p2.reload();
    await p2.waitForSelector(".inu-resort");
    var best = await p2.$eval('.inu-resort[data-resort="naeba"] .inu-resort-best', function (e) { return e.textContent; });
    assert.ok(/\d:\d\d\.\d\d/.test(best), "重新整理後最佳紀錄還在：" + best);
    await p2.evaluate(function () {
      var d = window.PriTestInusnowApp._debug;
      d.autopilot(true); d.start("naeba", { ghost: true });
    });
    await p2.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().phase === "run"; }, null, { timeout: 60000 });
    assert.ok((await state(p2)).ghost, "第二次滑有幽靈");
    await p2.evaluate(function () { window.PriTestInusnowApp._debug.speedUp(8); });
    await p2.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().screen === "result"; }, null, { timeout: 180000 });
    ok("最佳紀錄存檔、幽靈");
    // 2 趟合計
    await p2.evaluate(function () { var d = window.PriTestInusnowApp._debug; d.autopilot(true); d.speedUp(8); d.start("nozawa", { runs: 2, ghost: false }); });
    await p2.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().screen === "result"; }, null, { timeout: 180000 });
    assert.ok(await p2.$('[data-act="next"]'), "第 1 趟結束後有「下一趟」");
    await p2.dispatchEvent('[data-act="next"]', "click");
    await p2.waitForFunction(function () { var s = window.PriTestInusnowApp._debug.state(); return s.screen === "result" && document.querySelector(".inu-total"); }, null, { timeout: 180000 });
    ok("2 趟合計：" + (await p2.$eval(".inu-total", function (e) { return e.textContent; })));
    // 重播
    await p2.dispatchEvent('[data-act="replay"]', "click");
    await p2.waitForSelector("canvas.inu-canvas");
    await p2.dispatchEvent("#btn-inu-skip", "click");
    await p2.waitForSelector(".inu-result");
    ok("重播與略過");
    assert.deepStrictEqual(p2._errors, [], "沒有 console error");
    await p2.close();

    // 3. 拖曳輸入
    var p3 = await newPage(browser, { width: 390, height: 844 });
    await p3.goto(BASE);
    await p3.waitForSelector(".inu-resort");
    await p3.evaluate(function () { window.PriTestInusnowApp._debug.start("yakebitai", { ghost: false }); });
    await p3.waitForSelector("#inu-stage canvas");
    await p3.dispatchEvent("#inu-stage", "pointerdown", { clientX: 200, clientY: 600, pointerId: 1 });
    await p3.dispatchEvent("#inu-stage", "pointermove", { clientX: 260, clientY: 600, pointerId: 1 });
    var smp = await p3.evaluate(function () { return window.PriTestInusnowApp._debug.sample(); });
    assert.ok(smp.s >= 7, "往右拖 60 px → 右轉滿格（s=" + smp.s + "）");
    await p3.dispatchEvent("#inu-stage", "pointermove", { clientX: 200, clientY: 660, pointerId: 1 });
    smp = await p3.evaluate(function () { return window.PriTestInusnowApp._debug.sample(); });
    assert.strictEqual(smp.c, 1, "往下拖＝蹲低");
    await p3.dispatchEvent("#inu-stage", "pointerup", { clientX: 200, clientY: 660, pointerId: 1 });
    ok("拖曳：轉向與蹲低");
    await p3.close();

    // 4. 8 個雪場都能載入地形並開賽
    var p4 = await newPage(browser, { width: 390, height: 844 });
    await p4.goto(BASE);
    await p4.waitForSelector(".inu-resort");
    for (var r = 0; r < RESORTS.length; r++) {
      await p4.evaluate(function (id) { window.PriTestInusnowApp._debug.start(id, { ghost: false }); }, RESORTS[r]);
      await p4.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().phase === "run"; }, null, { timeout: 60000 });
      await p4.waitForTimeout(800);
      await p4.screenshot({ path: path.join(SHOT_DIR, "inusnow_resort_" + RESORTS[r] + ".png") });
      await p4.dispatchEvent("#btn-inu-pause", "click");
      await p4.dispatchEvent("#btn-inu-quit", "click");
      await p4.waitForSelector(".inu-breed");
    }
    assert.deepStrictEqual(p4._errors, [], "沒有 console error");
    ok("8 個雪場都能載入並開賽");
    await p4.close();
    console.log("inusnow ui_check OK（截圖：" + SHOT_DIR + "）");
  } finally {
    await browser.close();
  }
})().catch(function (e) { console.error(e); process.exit(1); });
