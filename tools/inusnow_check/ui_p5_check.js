// イヌスノー（狗雪）第 5 階段畫面檢查（Playwright）：node tools/inusnow_check/ui_p5_check.js（先 generate.py 並啟動 http.server 8975）
// 依據 docs/inusnow_design.md §20；計畫 2026-11-21-inusnow-phase5.md T8。
// 日期固定成 2026-01-15（一般雪季）：雪場鎖才會出現（5～11 月是夢之雪，全部開放）。
"use strict";
var path = require("path");
var os = require("os");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var ROOT = process.env.INUSNOW_ROOT || "http://localhost:8975/";
var BASE = ROOT + "inusnow/index.html";
var SHOT_DIR = process.env.SHOT_DIR || os.tmpdir();
function ok(m) { console.log("ok - " + m); }
function shot(page, n) { return page.screenshot({ path: path.join(SHOT_DIR, "inusnow_p5_" + n + ".png") }); }
function st(page) { return page.evaluate(function () { return window.PriTestInusnowApp._debug.state(); }); }
function sv(page) { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestInusnowApp._debug.save())); }); }

(async function () {
  var browser = await chromium.launch();
  var errors = [];
  try {
    var ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(function () {
      try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) { /* 測試 */ }
      var fixed = Date.UTC(2026, 0, 15, 3, 0, 0), real = Date.now, t0 = real();
      Date.now = function () { return fixed + (real() - t0); };
    });
    var page = await ctx.newPage();
    page.on("pageerror", function (e) { errors.push(e.message); });
    page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
    page.on("dialog", function (d) { d.accept(); });
    await page.goto(BASE);
    await page.waitForSelector(".inu-resort");
    var tabs = await page.$$eval(".inu-tab", function (l) { return l.map(function (b) { return b.getAttribute("data-tab"); }); });
    assert.deepStrictEqual(tabs, ["resorts", "bet", "cup", "daily", "room", "kennel", "shop"], "首頁 7 個分頁");
    assert.strictEqual((await page.$$(".inu-resort.is-locked")).length, 5, "一般雪季：5 個雪場上鎖");
    await page.dispatchEvent('.inu-resort[data-resort="zao"]', "click");
    assert.strictEqual((await st(page)).screen, "resorts", "上鎖的雪場點了不會進去");
    await shot(page, "locked");
    ok("雪場鎖（一開始 3 個開放）");

    // 犬舍：能力點分配、梳毛
    await page.evaluate(function () {
      var d = window.PriTestInusnowApp._debug;
      d.setSave({ coins: 3000, dogs: { shiba: { lv: 3, exp: 50, pts: 6, add: { bal: 0, pow: 0, brv: 0, tec: 0, siz: 0, cld: 0 }, aff: 10, groom: "", races: 0, raceDay: "", food: null } } });
      d.tab("kennel");
    });
    await page.waitForSelector('.inu-kplus[data-stat="tec"]');
    await page.dispatchEvent('.inu-kplus[data-stat="tec"]', "click");
    await page.dispatchEvent('[data-act="groom"]', "click");
    var s1 = await sv(page);
    assert.ok(s1.dogs.shiba.add.tec === 1 && s1.dogs.shiba.pts === 5, "分配 1 點技巧");
    assert.strictEqual(s1.dogs.shiba.aff, 15, "梳毛 好感 +5");
    await page.waitForTimeout(600);
    await shot(page, "kennel");
    await page.evaluate(function () { var a = document.querySelector(".inu-award"); if (a) a.remove(); });
    ok("犬舍：能力點、梳毛");

    // 商店：雙板、外套、毛帽、打蠟
    await page.evaluate(function () { window.PriTestInusnowApp._debug.tab("shop"); });
    await page.waitForSelector('[data-buy="ski:ski-M"]');
    await page.dispatchEvent('[data-buy="ski:ski-M"]', "click");
    await page.dispatchEvent('[data-buy="ccoat:red"]', "click");
    await page.dispatchEvent('[data-buy="chat:beanie"]', "click");
    await page.dispatchEvent('[data-wax="groomed"]', "click");
    await page.dispatchEvent('[data-wax="groomed"]', "click");
    var s2 = await sv(page);
    assert.ok(s2.gear.ski && s2.gear.skiId === "ski-M", "買了雙板並換上");
    assert.ok(s2.cosm.coat === "red" && s2.cosm.hat === "beanie", "換裝");
    assert.ok(s2.wax.sel === "groomed" && s2.wax.stock.groomed === 2, "打蠟 2 個");
    assert.strictEqual(s2.coins, 3000 - 500 - 80 - 70 - 40, "扣狗幣");
    await page.evaluate(function () { var a = document.querySelectorAll(".inu-award"); Array.prototype.forEach.call(a, function (x) { x.remove(); }); });
    await shot(page, "shop");
    ok("商店：雙板、外套、毛帽、打蠟");

    // 雙板＋打蠟的大曲道練習：獎勵、蠟消耗、/ski 紀錄、spec
    await page.evaluate(function () { var d = window.PriTestInusnowApp._debug; d.autopilot(true); d.speedUp(1); d.start("happo", { event: "gs" }); });
    await page.waitForFunction(function () { var s = window.PriTestInusnowApp._debug.state(); return s.screen === "race" && s.phase === "run"; }, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    await shot(page, "ski_race");
    await page.evaluate(function () { window.PriTestInusnowApp._debug.speedUp(10); });
    await page.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().screen === "result"; }, null, { timeout: 180000 });
    await page.waitForSelector(".inu-award", { timeout: 5000 });
    await shot(page, "award");
    var s3 = await sv(page);
    assert.ok(s3.best["happo/gs/0/ski"] && s3.best["happo/gs/0/ski"].spec, "雙板的紀錄分開，帶 spec");
    assert.ok(!s3.best["happo/gs/0"], "沒有寫到單板的紀錄");
    assert.strictEqual(s3.wax.stock.groomed, 1, "打蠟消耗 1 個");
    assert.ok(s3.totalExp >= 20 && s3.dogs.shiba.aff >= 17, "經驗與好感");
    ok("雙板比賽：獎勵、/ski 紀錄、spec、打蠟消耗（經驗 " + s3.totalExp + "）");
    // 幽靈：用 spec 重播自己的雙板紀錄
    await page.evaluate(function () { var a = document.querySelectorAll(".inu-award"); Array.prototype.forEach.call(a, function (x) { x.remove(); }); var d = window.PriTestInusnowApp._debug; d.speedUp(1); d.start("happo", { event: "gs", ghost: true }); });
    await page.waitForFunction(function () { var s = window.PriTestInusnowApp._debug.state(); return s.screen === "race" && s.phase === "run"; }, null, { timeout: 60000 });
    assert.ok((await st(page)).ghost, "雙板紀錄的幽靈");
    await page.evaluate(function () { window.PriTestInusnowApp._debug.speedUp(12); });
    await page.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().screen === "result"; }, null, { timeout: 180000 });
    ok("幽靈（spec 重播）");

    // 設定畫面：溫泉、美食
    await page.evaluate(function () { var a = document.querySelectorAll(".inu-award"); Array.prototype.forEach.call(a, function (x) { x.remove(); }); });
    await page.dispatchEvent('[data-act="setup"]', "click");
    await page.waitForSelector('[data-act="onsen"]');
    var c0 = (await sv(page)).coins;
    await page.dispatchEvent('[data-act="onsen"]', "click");
    await page.waitForSelector('[data-act="food"]');
    await page.dispatchEvent('[data-act="food"]', "click");
    var s4 = await sv(page);
    assert.strictEqual(s4.coins, c0 - 50, "溫泉 20＋美食 30");
    assert.ok(s4.dogs.shiba.food && s4.dogs.shiba.food.stat === "pow", "八方的おやき：力量");
    await page.evaluate(function () { var a = document.querySelectorAll(".inu-award"); Array.prototype.forEach.call(a, function (x) { x.remove(); }); });
    await shot(page, "facil");
    ok("溫泉、在地美食");

    // 公園編輯器：開啟 → 刪一個 → 試滑 → 自訂公園最佳
    await page.dispatchEvent('.inu-event[data-event="slope"]', "click");
    await page.waitForSelector('[data-act="parked"]');
    await page.dispatchEvent('[data-act="parked"]', "click");
    await page.waitForSelector(".inu-parklist li");
    var n0 = (await page.$$(".inu-parklist li")).length;
    await page.dispatchEvent('[data-pkdel="1"]', "click");
    assert.strictEqual((await page.$$(".inu-parklist li")).length, n0 - 1, "刪除地形");
    await shot(page, "park");
    await page.evaluate(function () { var d = window.PriTestInusnowApp._debug; d.autopilot(true); d.speedUp(8); });
    await page.dispatchEvent('[data-act="ride"]', "click");
    await page.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().screen === "result"; }, null, { timeout: 180000 });
    var s5 = await sv(page);
    assert.ok(s5.parks.happo && s5.parks.happo.list.length === n0 - 1, "自訂公園存檔");
    assert.ok(!s5.best["happo/slope/ski"], "自訂公園不寫一般的 Slopestyle 紀錄");
    ok("公園編輯器：編輯、試滑（最佳 " + s5.parks.happo.best + "）");

    var noScroll = await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth; });
    assert.ok(noScroll, "沒有橫向捲軸");
    assert.deepStrictEqual(errors, [], "沒有 console error");
    console.log("inusnow ui_p5_check OK（截圖：" + SHOT_DIR + "）");
  } finally {
    await browser.close();
  }
})().catch(function (e) { console.error(e); process.exit(1); });
