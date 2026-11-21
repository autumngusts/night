// イヌスノー（狗雪）畫面檢查（Playwright）。
//   1. py -3 generate.py
//   2. py -3 -m http.server 8975 --directory dist
//   3. node tools/inusnow_check/ui_check.js   （INUSNOW_ROOT 可改網址）
// 依據計畫 docs/superpowers/plans/2026-11-20-inusnow-phase1.md Task 8、2026-11-21-inusnow-phase2.md T10。截圖存在 SHOT_DIR（預設系統暫存資料夾）。
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
      // 2026-11-21：第 2 階段犬種補到 24 種（設計 §5.1），舊的期望值 8 種已過時
      assert.strictEqual((await page.$$(".inu-breed")).length, 24, "犬種 24 種");
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
    // 2026-11-21：雪場卡片改成 4 個賽事的徽章（第 1 個＝大曲道最佳時間），原本的 .inu-resort-best 已移除
    var best = await p2.$eval('.inu-resort[data-resort="naeba"] .inu-badge', function (e) { return e.textContent; });
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

    // 5. 第 2 階段：賽事選擇、各賽事完賽與成績畫面、手機 HUD 按鈕（計畫 2026-11-21-inusnow-phase2.md T10）
    var p5 = await newPage(browser, { width: 390, height: 844 });
    await p5.goto(BASE);
    await p5.waitForSelector(".inu-resort");
    await p5.dispatchEvent('.inu-resort[data-resort="naeba"]', "click");
    await p5.waitForSelector(".inu-event");
    assert.strictEqual((await p5.$$(".inu-event")).length, 4, "賽事 4 種");
    await p5.dispatchEvent('.inu-event[data-event="slope"]', "click");
    await p5.waitForSelector(".inu-course-feats .inu-feat");
    assert.strictEqual((await p5.$$(".inu-course-feats .inu-feat")).length, 6, "Slopestyle 6 個地形");
    await p5.dispatchEvent('[data-opt="mode"][data-val="race"]', "click");
    assert.ok(await p5.$('[data-opt="mode"][data-val="race"].is-on'), "切換到比賽模式");
    await p5.dispatchEvent('[data-opt="mode"][data-val="practice"]', "click");
    var flows = [
      { ev: "slope", mode: "practice", check: async function (pg) { assert.strictEqual((await pg.$$(".inu-judge")).length, 3, "評審 3 位"); assert.strictEqual((await pg.$$(".inu-featrow")).length, 6, "地形別分數 6 列"); } },
      { ev: "gs", mode: "race", check: async function (pg) { assert.strictEqual((await pg.$$(".inu-table tbody tr")).length, 8, "大曲道比賽：名次表 8 隻"); assert.ok(await pg.$(".inu-table tr.is-me"), "名次表有自己"); } },
      { ev: "slope", mode: "race", check: async function (pg) { assert.strictEqual((await pg.$$(".inu-table tbody tr")).length, 8, "Slopestyle 比賽：名次表 8 隻"); } },
      { ev: "cross", mode: "race", check: async function (pg) { assert.strictEqual((await pg.$$(".inu-table tbody tr")).length, 6, "Cross：名次表 6 隻"); assert.ok(await pg.$(".inu-podium"), "頒獎台"); } },
    ];
    for (var fi = 0; fi < flows.length; fi++) {
      var fl = flows[fi];
      await p5.evaluate(function (a) { var d = window.PriTestInusnowApp._debug; d.autopilot(true); d.speedUp(10); d.start("naeba", { event: a.ev, mode: a.mode, ghost: false }); }, { ev: fl.ev, mode: fl.mode });
      await p5.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().phase === "run"; }, null, { timeout: 60000 });
      if (fl.ev === "cross") assert.strictEqual((await state(p5)).cpus, 5, "Cross：CPU 5 隻");
      await p5.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().screen === "result"; }, null, { timeout: 240000 });
      await fl.check(p5);
      await p5.screenshot({ path: path.join(SHOT_DIR, "inusnow_p2_" + fl.ev + "_" + fl.mode + ".png") });
      ok("第 2 階段：" + fl.ev + "／" + fl.mode + " 完賽與成績畫面");
    }
    // Slopestyle 的手機 HUD：抓板鍵（按住）、吠叫鍵、骨頭鍵
    await p5.evaluate(function () { var d = window.PriTestInusnowApp._debug; d.autopilot(false); d.speedUp(1); d.start("naeba", { event: "slope", mode: "practice", ghost: false }); });
    await p5.waitForSelector("#btn-inu-grab");
    await p5.dispatchEvent("#btn-inu-grab", "pointerdown", { clientX: 300, clientY: 780, pointerId: 3 });
    var sg = await p5.evaluate(function () { return window.PriTestInusnowApp._debug.sample(); });
    assert.strictEqual(sg.g, 1, "按住抓板鍵＝g 1");
    await p5.dispatchEvent("#btn-inu-grab", "pointerup", { clientX: 300, clientY: 780, pointerId: 3 });
    await p5.dispatchEvent("#btn-inu-bark", "pointerdown", { clientX: 340, clientY: 700, pointerId: 4 });
    sg = await p5.evaluate(function () { return window.PriTestInusnowApp._debug.sample(); });
    assert.strictEqual(sg.g, 6, "吠叫鍵＝g 6（一步）");
    await p5.dispatchEvent("#btn-inu-zoom", "click");
    sg = await p5.evaluate(function () { return window.PriTestInusnowApp._debug.sample(); });
    assert.strictEqual(sg.z, 1, "骨頭鍵＝z");
    await p5.dispatchEvent("#btn-inu-pause", "click");
    await p5.dispatchEvent("#btn-inu-quit", "click");
    await p5.waitForSelector(".inu-event");
    ok("手機 HUD：抓板、吠叫、興奮度");
    // 自由滑行：坐纜車、結束、收集存檔
    await p5.evaluate(function () { var d = window.PriTestInusnowApp._debug; d.autopilot(true); d.speedUp(1); d.fastLift(true); d.start("naeba", { event: "free" }); });
    await p5.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().phase === "run"; }, null, { timeout: 60000 });
    assert.ok(await p5.$("#inu-minimap"), "自由滑行有小地圖");
    await p5.evaluate(function () { window.PriTestInusnowApp._debug.toLift(0); });
    await p5.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().liftNear === 0; }, null, { timeout: 10000 });
    await p5.dispatchEvent("#btn-inu-lift", "click");
    await p5.waitForTimeout(500);
    assert.ok((await state(p5)).liftNear !== 0, "坐纜車上山");
    await p5.screenshot({ path: path.join(SHOT_DIR, "inusnow_p2_free.png") });
    await p5.dispatchEvent("#btn-inu-end", "click");
    await p5.waitForSelector(".inu-collect");
    assert.ok((await state(p5)).free.naeba, "自由滑行的收集存檔");
    ok("自由滑行：小地圖、坐纜車、結束、存檔");
    assert.deepStrictEqual(p5._errors, [], "沒有 console error");
    await p5.close();
    console.log("inusnow ui_check OK（截圖：" + SHOT_DIR + "）");
  } finally {
    await browser.close();
  }
})().catch(function (e) { console.error(e); process.exit(1); });
