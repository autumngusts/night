// イヌスノー（狗雪）第 3 階段畫面檢查（Playwright）：node tools/inusnow_check/ui_p3_check.js（先 generate.py 並啟動 http.server 8975）
// 依據 docs/inusnow_design.md §18；計畫 2026-11-21-inusnow-phase3.md T9、T10。截圖存在 SHOT_DIR（預設系統暫存資料夾）。
"use strict";
var path = require("path");
var os = require("os");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var ROOT = process.env.INUSNOW_ROOT || "http://localhost:8975/";
var BASE = ROOT + "inusnow/index.html";
var SHOT_DIR = process.env.SHOT_DIR || os.tmpdir();
function ok(m) { console.log("ok - " + m); }
function shot(page, n) { return page.screenshot({ path: path.join(SHOT_DIR, "inusnow_p3_" + n + ".png") }); }

async function newPage(browser, vp) {
  var page = await browser.newPage({ viewport: vp });
  await page.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
  page._errors = [];
  page.on("pageerror", function (e) { page._errors.push(e.message); });
  page.on("console", function (m) { if (m.type() === "error") page._errors.push(m.text()); });
  page.on("dialog", function (d) { d.accept(); });
  return page;
}
function state(page) { return page.evaluate(function () { return window.PriTestInusnowApp._debug.state(); }); }
function waitRun(page) { return page.waitForFunction(function () { var s = window.PriTestInusnowApp._debug.state(); return s.screen === "race" && s.phase === "run"; }, null, { timeout: 60000 }); }
function waitScreen(page, s, ms) { return page.waitForFunction(function (x) { return window.PriTestInusnowApp._debug.state().screen === x; }, s, { timeout: ms || 180000 }); }
async function run(page, resort, opts, fast) {
  await page.evaluate(function (a) { var d = window.PriTestInusnowApp._debug; d.autopilot(true); d.speedUp(a.k); d.start(a.r, a.o); }, { r: resort, o: opts, k: fast || 8 });
}

(async function () {
  var browser = await chromium.launch();
  try {
    var page = await newPage(browser, { width: 390, height: 844 });
    await page.goto(BASE);
    await page.waitForSelector(".inu-resort");
    // 分頁
    var tabs = await page.$$eval(".inu-tab", function (l) { return l.map(function (b) { return b.getAttribute("data-tab"); }); });
    // 2026-11-21：第 4 階段加上「連線」分頁（設計 §19）
    // 2026-11-21：第 5 階段加上「犬舍」「商店」分頁（設計 §20）
    assert.deepStrictEqual(tabs, ["resorts", "bet", "cup", "daily", "room", "kennel", "shop"], "首頁 7 個分頁");
    assert.ok(await page.$(".inu-coins"), "顯示狗幣");
    await shot(page, "home");

    // 設定：雪況、教練模式、救難犬與雪崩的賽事鍵
    await page.dispatchEvent('.inu-resort[data-resort="happo"]', "click");
    await page.waitForSelector(".inu-event");
    var evs = await page.$$eval(".inu-event", function (l) { return l.map(function (b) { return b.getAttribute("data-event"); }); });
    // 2026-11-21：第 4 階段加上接力（設計 §19.3）
    assert.deepStrictEqual(evs, ["gs", "slope", "cross", "free", "rescue", "avalanche", "relay"], "賽事 7 種");
    await page.dispatchEvent('[data-opt="mode"][data-val="coach"]', "click");
    await page.waitForSelector(".inu-coachbox");
    await page.dispatchEvent('[data-opt="cond"][data-val="pick"]', "click");
    await page.waitForSelector('[data-cond="weather"]');
    await shot(page, "setup");
    await page.dispatchEvent('[data-opt="cond"][data-val="std"]', "click");
    await page.dispatchEvent('[data-opt="mode"][data-val="practice"]', "click");
    ok("首頁分頁、狗幣、設定（雪況、教練模式、6 種賽事）");

    // 教練模式（大曲道）：指令各 1 次
    await run(page, "happo", { mode: "coach" }, 2);
    await waitRun(page);
    await page.waitForTimeout(600);
    await page.dispatchEvent("#btn-inu-calm", "click");
    await page.dispatchEvent("#btn-inu-dash", "click");
    assert.strictEqual((await state(page)).coach, 2, "指令 2 個");
    await page.dispatchEvent("#btn-inu-dash", "click");
    assert.strictEqual((await state(page)).coach, 2, "同一個指令只能 1 次");
    await shot(page, "coach");
    await page.evaluate(function () { window.PriTestInusnowApp._debug.speedUp(10); });
    await waitScreen(page, "result");
    ok("教練模式：送出指令、跑完");
    // 2026-11-21 QA：教練模式不能帶到 Cross 等其他賽事
    await run(page, "happo", { event: "cross", mode: "coach" }, 1);
    await waitRun(page);
    assert.ok(!(await page.$("#btn-inu-dash")), "Cross 沒有教練指令鍵");
    assert.strictEqual((await state(page)).mode, "practice", "Cross 的模式不是 coach");
    await page.dispatchEvent("#btn-inu-pause", "click");
    await page.dispatchEvent("#btn-inu-quit", "click");
    await page.waitForSelector(".inu-event");

    // 濃霧的旗門箭頭、Cross 的嗅覺量表
    await run(page, "happo", { cond: { snow: "groomed", weather: "fog", night: true, change: null } }, 1);
    await waitRun(page);
    await page.waitForTimeout(800);
    assert.ok(await page.$("#inu-fogarrow:not([hidden])"), "濃霧：旗門箭頭");
    assert.ok(await page.$("#inu-wx"), "HUD 顯示天氣");
    await shot(page, "fog_night");
    await page.dispatchEvent("#btn-inu-pause", "click");
    await page.dispatchEvent("#btn-inu-quit", "click");
    await page.waitForSelector(".inu-event");
    await run(page, "happo", { event: "cross", cond: { snow: "powder", weather: "snow", night: false, change: { to: "blizzard", at: 120, chance: 0.5, happen: true } } }, 1);
    await waitRun(page);
    assert.ok(await page.$("#inu-scent"), "Cross：嗅覺量表");
    await page.waitForTimeout(3000);
    await shot(page, "cross_snow");
    await page.evaluate(function () { window.PriTestInusnowApp._debug.speedUp(10); });
    await waitScreen(page, "result");
    ok("雪況：濃霧箭頭、夜間、天候變化、嗅覺量表");

    // 救難犬
    await run(page, "nozawa", { event: "rescue" }, 2);
    await waitRun(page);
    assert.ok(await page.$("#btn-inu-dig") && await page.$("#inu-nose"), "挖掘鍵與鼻子");
    await page.waitForTimeout(2500);
    await shot(page, "rescue");
    await page.evaluate(function () { window.PriTestInusnowApp._debug.speedUp(12); });
    await waitScreen(page, "result");
    var rs = await state(page);
    assert.ok(rs.best["nozawa/rescue"], "救難犬的最佳分數存檔");
    await shot(page, "rescue_result");
    ok("救難犬：救出 " + rs.best["nozawa/rescue"].found + " 位、" + rs.best["nozawa/rescue"].score + " 分");

    // 雪崩逃脫
    await run(page, "happo", { event: "avalanche" }, 1);
    await waitRun(page);
    await page.waitForTimeout(3500);
    assert.ok(await page.$("#inu-avgap"), "雪崩距離表");
    await shot(page, "avalanche");
    await page.evaluate(function () { window.PriTestInusnowApp._debug.speedUp(10); });
    await waitScreen(page, "result");
    assert.ok((await state(page)).best["happo/avalanche"], "雪崩的最佳分數存檔");
    ok("雪崩逃脫");

    // 競猜：出賽表 → 買單勝 → 觀戰 → 結算
    await page.evaluate(function () { window.PriTestInusnowApp._debug.tab("bet"); });
    await page.waitForSelector(".inu-betslot");
    assert.strictEqual((await page.$$(".inu-betslot")).length, 3, "3 場比賽");
    await shot(page, "bet_tab");
    var coins0 = (await state(page)).coins;
    await page.evaluate(function () { window.PriTestInusnowP3.openCard(0); });
    await page.waitForSelector(".inu-entry[data-pick]");
    await page.evaluate(function () { window.PriTestInusnowP3.quickOdds(4); });
    await page.waitForSelector('[data-act="race"]:not([disabled])', { timeout: 60000 });
    await page.dispatchEvent('.inu-entry[data-pick="0"]', "click");
    await page.dispatchEvent('[data-act="buy"]', "click");
    await page.waitForSelector(".inu-lines li");
    assert.strictEqual((await state(page)).coins, coins0 - 100, "扣 100 狗幣");
    await page.dispatchEvent('[data-bt="trio"]', "click");
    await page.dispatchEvent('[data-bm="box"]', "click");
    for (var k = 0; k < 4; k++) await page.dispatchEvent('.inu-entry[data-pick="' + k + '"]', "click");
    var sum = await page.$eval(".inu-ticket-sum", function (e) { return e.textContent; });
    assert.ok(/^4 /.test(sum), "三連複 BOX 4 隻＝4 組（" + sum + "）");
    await shot(page, "bet_card");
    await page.dispatchEvent('[data-act="race"]', "click");
    await page.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().watch; }, null, { timeout: 60000 });
    await page.waitForTimeout(3500);
    await shot(page, "watch");
    await page.dispatchEvent("#btn-inu-wskip", "click");
    await page.waitForSelector(".inu-payout");
    var st = await state(page);
    assert.ok(st.coins >= coins0 - 100, "結算後狗幣");
    await shot(page, "bet_result");
    ok("競猜：出賽表、賠率、單勝、BOX、觀戰、結算（狗幣 " + coins0 + " → " + st.coins + "）");

    // 世界盃：開季 → 第 1 站 → 積分
    await page.evaluate(function () { window.PriTestInusnowApp._debug.tab("cup"); });
    await page.waitForSelector('[data-act="newseason"]');
    await page.dispatchEvent('[data-act="newseason"]', "click");
    await page.waitForSelector(".inu-stage-card");
    assert.strictEqual((await page.$$(".inu-stage-card")).length, 8, "8 站");
    await shot(page, "cup");
    await page.evaluate(function () { var d = window.PriTestInusnowApp._debug; d.autopilot(true); d.speedUp(10); window.PriTestInusnowP3.startStage(); });
    await page.waitForSelector(".inu-cup-gain", { timeout: 240000 });
    await shot(page, "cup_result");
    var sea = (await page.evaluate(function () { return window.PriTestInusnowApp._debug.save().season; }));
    assert.strictEqual(sea.stage, 1, "完成第 1 站");
    assert.strictEqual(sea.results[0].order.length, 24, "24 隻的名次");
    ok("世界盃：開季、第 1 站（" + sea.results[0].event + "）、積分");

    // 今日雪況
    await page.evaluate(function () { window.PriTestInusnowApp._debug.tab("daily"); });
    await page.waitForSelector(".inu-wxcard");
    assert.strictEqual((await page.$$(".inu-wxcard")).length, 8, "8 個雪場的雪況");
    await shot(page, "daily");
    await page.evaluate(function () { var d = window.PriTestInusnowApp._debug; d.autopilot(true); d.speedUp(10); });
    await page.dispatchEvent('[data-act="daily"]', "click");
    await waitScreen(page, "result");
    await page.waitForSelector(".inu-condline");
    ok("今日雪況：8 個雪場、今日挑戰");

    var noScroll = await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth; });
    assert.ok(noScroll, "沒有橫向捲軸");
    assert.deepStrictEqual(page._errors, [], "沒有 console error");
    await page.close();

    // 桌機的競猜畫面
    var pd = await newPage(browser, { width: 1280, height: 800 });
    await pd.goto(BASE);
    await pd.waitForSelector(".inu-resort");
    await pd.evaluate(function () { window.PriTestInusnowApp._debug.tab("bet"); });
    await pd.waitForSelector(".inu-betslot");
    await pd.evaluate(function () { window.PriTestInusnowP3.openCard(1); });
    await pd.waitForSelector(".inu-entry[data-pick]");
    await pd.waitForTimeout(2500);
    await shot(pd, "bet_card_desktop");
    assert.deepStrictEqual(pd._errors, [], "桌機：沒有 console error");
    await pd.close();
    console.log("inusnow ui_p3_check OK（截圖：" + SHOT_DIR + "）");
  } finally {
    await browser.close();
  }
})().catch(function (e) { console.error(e); process.exit(1); });
