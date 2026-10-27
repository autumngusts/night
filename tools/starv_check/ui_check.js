// ============================================================================
// 明星經紀 starV Playwright 流程檢查：
//   開業 → 招募十連 → 藝人詳情排行程 → 多選套用方針 → 接工作 → 組合 → 存檔匯出入 → 日誌 → 離線報告
//   → 三種語言沒有漏翻的 sv_ 鍵 → 手機寬度沒有水平捲動 → 截圖
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8946 --directory dist
// 執行：node tools/starv_check/ui_check.js
// 這頁每秒重畫，按鈕一律用 dispatchEvent 觸發（CLAUDE.md §4.6）。
// ============================================================================
"use strict";
var path = require("path");
var os = require("os");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.STARV_BASE || "http://localhost:8946/starv/index.html?debug=1";
var SHOT_DIR = process.env.STARV_SHOTS || path.join(__dirname, "shots");

function st(page) { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestStarv.state())); }); }
async function act(page, name) {
  await page.waitForSelector('[data-act="' + name + '"]', { state: "attached", timeout: 5000 });
  await page.dispatchEvent('[data-act="' + name + '"]', "click");
}
async function tab(page, id) {
  await page.dispatchEvent('.sv-tab[data-tab="' + id + '"]', "click");
  await page.waitForSelector('.sv-tab.sv-on[data-tab="' + id + '"]');
}
async function noRawKeys(page, where) {
  var raw = await page.evaluate(function () { return (document.querySelector(".sv-root").innerText.match(/sv_[a-zA-Z0-9_]+/g) || []); });
  assert.deepStrictEqual(raw, [], where + " 有漏翻的鍵：" + raw.join(","));
}
async function shot(page, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, name + ".png"), fullPage: true });
}

var steps = [];
function step(name, fn) { steps.push([name, fn]); }

step("開業畫面 → 建立公司", async function (page) {
  await page.waitForSelector(".sv-welcome input");
  await noRawKeys(page, "開業畫面");
  await page.fill(".sv-welcome input", "測試經紀");
  await act(page, "start");
  await page.waitForSelector(".sv-top");
  var s = await st(page);
  assert.strictEqual(s.company.name, "測試經紀");
  assert.strictEqual(s.company.tickets, 10);
  await noRawKeys(page, "頂部列");
});

step("招募：星探券十連 → 翻卡 → 入社", async function (page) {
  await tab(page, "gacha");
  await noRawKeys(page, "招募分頁");
  await act(page, "pull-ticket-10");
  await page.waitForSelector(".sv-reveal");
  await act(page, "reveal-skip");
  await act(page, "reveal-done");
  // 抽到新 SSR 會接著出現全螢幕介紹
  for (var i = 0; i < 10 && await page.$('[data-act="spot-done"]'); i++) await act(page, "spot-done");
  var s = await st(page);
  assert.strictEqual(s.company.tickets, 0, "券用完");
  // 宿舍 Lv1 上限 5 人，其餘進候補；抽到重複的 SR/SSR 會變成突破，所以總人數可能少於 10
  assert.ok(s.artists.length >= 1 && s.artists.length <= 5, "入社人數 " + s.artists.length);
  assert.ok(s.artists.length + s.waitlist.length <= 10, "入社＋候補不超過抽數");
  await noRawKeys(page, "招募結果後");
});

// ==== 之後的 task 在這行之前追加步驟 ====

(async function main() {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(e.message); });
  page.on("console", function (m) { if (m.type() === "error" && m.text().indexOf("fonts.g") < 0) errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload();
  var fails = 0;
  for (var i = 0; i < steps.length; i++) {
    try { await steps[i][1](page); console.log("ok   " + steps[i][0]); }
    catch (e) { fails++; console.log("FAIL " + steps[i][0] + "：" + e.message); await shot(page, "fail").catch(function () {}); break; }
  }
  if (errors.length) { fails++; console.log("FAIL 頁面錯誤：" + errors.join(" | ")); }
  await browser.close();
  console.log(fails ? "有失敗" : "全部 " + steps.length + " 個步驟通過");
  process.exit(fails ? 1 : 0);
})();
