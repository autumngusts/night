// ============================================================================
// 明星經紀 starV 雲端存檔的兩台裝置檢查（Firebase Local Emulator，不連真的 Firebase 專案、不經過 App Check）：
//   A 開業 → 啟用雲端（ID、QR）→ B 用 ?cloud=<ID> 連結接回 → A 轉唯讀 → A 在此裝置繼續 → B 轉唯讀
//   → A 抽卡（重要時點立即上傳）→ B 接回後看得到抽卡結果 → A 重新整理後仍是唯讀
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8946 --directory dist
//   3. tools/midnight_check/node_modules/.bin/firebase emulators:start --only database,auth --project demo-starv
//      （9000 被占用時改 firebase.json 以外的 port 啟動，並設定環境變數 STARV_RTDB_PORT）
// 執行：node tools/starv_check/cloud_check.js
// 兩個 browser context＝兩台裝置（localStorage 各自獨立）。按鈕一律用 dispatchEvent（CLAUDE.md §4.6）。
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var PAGE = process.env.STARV_PAGE || "http://localhost:8946/starv/index.html";
var RTDB_PORT = process.env.STARV_RTDB_PORT || "9000";

async function device(browser) {
  var ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(function (port) {
    try { sessionStorage.setItem("pritestRtdbEmulator", "1"); sessionStorage.setItem("pritestRtdbEmulatorPort", port); } catch (e) { /* 忽略 */ }
  }, RTDB_PORT);
  var page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", function (e) { page.errors.push(e.message); });
  return page;
}
async function act(page, name) {
  await page.waitForSelector('[data-act="' + name + '"]', { state: "attached", timeout: 15000 });
  await page.dispatchEvent('[data-act="' + name + '"]', "click");
}
async function tab(page, id) {
  await page.dispatchEvent('.sv-tab[data-tab="' + id + '"]', "click");
  await page.waitForSelector('.sv-tab.sv-on[data-tab="' + id + '"]');
}
function info(page) { return page.evaluate(function () { return window.PriTestStarvCloudUI.ctl().info(); }); }
function st(page) { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestStarv.state())); }); }
async function quiet(page) {
  await page.evaluate(function () { if (window.PriTestStarvData) window.PriTestStarvData.BAL.eventDailyChance = 0; });
}

var steps = [];
function step(name, fn) { steps.push([name, fn]); }
var ctx = {};

step("A：開業 → 啟用雲端 → 顯示 ID 與 QR", async function () {
  var A = ctx.A;
  await A.goto(PAGE + "?debug=1");
  await A.waitForSelector(".sv-welcome input");
  await quiet(A);
  await A.fill(".sv-welcome input", "雲端甲社");
  await act(A, "start");
  await A.waitForSelector(".sv-top");
  await tab(A, "company");
  await act(A, "cloud-enable");
  await A.waitForSelector('[data-act="cloud-id"]', { timeout: 20000 });
  ctx.id = await A.$eval('[data-act="cloud-id"]', function (x) { return x.value; });
  assert.ok(/^g[0-9a-f]{32}$/.test(ctx.id), "存檔 ID：" + ctx.id);
  var qrW = await A.$eval('[data-act="cloud-qr"]', function (c) { return c.width; });
  assert.ok(qrW > 50, "QR 已繪製");
  await A.waitForFunction(function () { var i = window.PriTestStarvCloudUI.ctl().info(); return i.lastSync > 0 && !i.pending; }, null, { timeout: 15000 });
});

step("B：用連結接回 → 公司名一致；A 轉唯讀", async function () {
  var A = ctx.A, B = ctx.B;
  await B.goto(PAGE + "?debug=1&cloud=" + ctx.id);
  await act(B, "cloud-connect-confirm");
  await B.waitForSelector(".sv-top", { timeout: 15000 });
  await quiet(B);
  assert.strictEqual((await st(B)).company.name, "雲端甲社");
  assert.ok(!/cloud=/.test(await B.evaluate(function () { return location.search; })), "網址拿掉 cloud 參數");
  await A.waitForSelector(".sv-cloud-lock", { timeout: 15000 });
  assert.strictEqual(await A.evaluate(function () { return window.PriTestStarv.app.readOnly(); }), true, "A 唯讀");
  var money = (await st(A)).company.money;
  await A.evaluate(function () { window.PriTestStarv.app.act(function (s) { s.company.money += 99999; }); });
  assert.strictEqual((await st(A)).company.money, money, "唯讀時操作無效");
});

step("A：在此裝置繼續 → A 解除唯讀、B 轉唯讀", async function () {
  var A = ctx.A, B = ctx.B;
  await act(A, "cloud-takeover");
  await A.waitForSelector(".sv-cloud-lock", { state: "detached", timeout: 15000 });
  await B.waitForSelector(".sv-cloud-lock", { timeout: 15000 });
  assert.strictEqual(await A.evaluate(function () { return window.PriTestStarv.app.readOnly(); }), false);
});

step("A：抽卡（重要時點立即上傳）→ B 接回後看得到", async function () {
  var A = ctx.A, B = ctx.B;
  await tab(A, "gacha");
  await act(A, "pull-ticket-10");
  await A.waitForSelector(".sv-reveal");
  await act(A, "reveal-skip");
  await act(A, "reveal-done");
  for (var i = 0; i < 10 && await A.$('[data-act="spot-done"]'); i++) await act(A, "spot-done");
  var pulls = (await st(A)).stats.pulls;
  assert.ok(pulls >= 10, "A 抽了 " + pulls);
  await A.waitForFunction(function () { return !window.PriTestStarvCloudUI.ctl().info().pending; }, null, { timeout: 15000 });
  await act(B, "cloud-takeover");
  await B.waitForSelector(".sv-cloud-lock", { state: "detached", timeout: 15000 });
  assert.strictEqual((await st(B)).stats.pulls, pulls, "B 採用 A 的抽卡結果");
  await A.waitForSelector(".sv-cloud-lock", { timeout: 15000 });
});

step("A：重新整理 → 仍是唯讀（B 進行中）；狀態顯示唯讀", async function () {
  var A = ctx.A;
  await A.reload();
  await A.waitForSelector(".sv-cloud-lock", { timeout: 20000 });
  await tab(A, "company");
  var text = await A.$eval('[data-act="cloud-status"]', function (x) { return x.textContent; });
  assert.ok(text.length > 0 && !/sv_/.test(text), "狀態：" + text);
  assert.strictEqual((await info(A)).locked, true);
});

(async function main() {
  var browser = await chromium.launch();
  ctx.A = await device(browser);
  ctx.B = await device(browser);
  var fails = 0;
  for (var i = 0; i < steps.length; i++) {
    try { await steps[i][1](); console.log("ok   " + steps[i][0]); }
    catch (e) { fails++; console.log("FAIL " + steps[i][0] + "：" + e.message); break; }
  }
  var errors = ctx.A.errors.concat(ctx.B.errors);
  if (errors.length) { fails++; console.log("FAIL 頁面錯誤：" + errors.join(" | ")); }
  await browser.close();
  console.log(fails ? "有失敗" : "全部 " + steps.length + " 個步驟通過");
  process.exit(fails ? 1 : 0);
})();
