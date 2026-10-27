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

step("藝人：卡片 → 詳情 → 安排訓練", async function (page) {
  await tab(page, "artists");
  await noRawKeys(page, "藝人分頁");
  var s = await st(page);
  assert.strictEqual(await page.$$eval(".sv-acard", function (x) { return x.length; }), s.artists.length, "卡片數");
  var aid = s.artists[0].id;
  await page.dispatchEvent('.sv-acard[data-aid="' + aid + '"]', "click");
  await page.waitForSelector(".sv-modal-detail");
  await noRawKeys(page, "藝人詳情");
  await act(page, "do-train");
  s = await st(page);
  assert.strictEqual(s.artists[0].task && s.artists[0].task.kind, "train");
  await act(page, "modal-close");
});

step("藝人：多選套用方針", async function (page) {
  await act(page, "select-mode");
  var s = await st(page);
  var ids = s.artists.slice(1).map(function (a) { return a.id; });
  for (var i = 0; i < ids.length; i++) await page.dispatchEvent('.sv-acard[data-aid="' + ids[i] + '"]', "click");
  await page.selectOption('[data-act="batch-policy-select"]', "balance");
  await act(page, "batch-policy");
  s = await st(page);
  s.artists.slice(1).forEach(function (a) { assert.strictEqual(a.policy, "balance", a.id); });
  assert.strictEqual(s.artists[0].policy, "idle", "沒選的不變");
  await act(page, "select-mode");
});

step("工作：選角 → 簽約", async function (page) {
  await tab(page, "jobs");
  await noRawKeys(page, "工作分頁");
  var pickJob = function () {
    return page.evaluate(function () {
      var s = window.PriTestStarv.state();
      var j = s.board.filter(function (x) { return x.slots === 1 && x.minFame === 0; })[0];
      return j ? j.id : null;
    });
  };
  var jobId = await pickJob();
  // 看板上偶爾沒有 D 級單人工作：快轉 7 天讓看板刷新（App.skip 在 Task 4 就有）
  for (var i = 0; i < 5 && !jobId; i++) { await page.evaluate(function () { window.PriTestStarv.app.skip(7); }); jobId = await pickJob(); }
  assert.ok(jobId, "看板上沒有 D 級單人工作");
  await page.dispatchEvent('.sv-job[data-job="' + jobId + '"]', "click");
  await page.waitForSelector(".sv-cast-row");
  await noRawKeys(page, "選角");
  await page.dispatchEvent(".sv-cast-row:not(.sv-dis)", "click");
  await act(page, "cast-sign");
  var s = await st(page);
  assert.ok(s.activeJobs.some(function (aj) { return aj.job.id === jobId; }), "工作進行中");
});

step("工作：結成組合", async function (page) {
  await act(page, "jobs-sub-groups");
  await noRawKeys(page, "組合");
  await page.fill('[data-act="group-name"]', "星光少女");
  var ids = await page.$$eval(".sv-group-pick input[data-aid]", function (xs) { return xs.slice(0, 2).map(function (x) { return x.getAttribute("data-aid"); }); });
  assert.strictEqual(ids.length, 2, "至少要有兩位可選的藝人");
  for (var i = 0; i < ids.length; i++) await page.check('.sv-group-pick input[data-aid="' + ids[i] + '"]');
  await act(page, "group-create");
  var s = await st(page);
  assert.strictEqual(s.groups.length, 1); assert.strictEqual(s.groups[0].name, "星光少女");
  await act(page, "jobs-sub-board");
});

step("公司：匯出 → 匯入 → 名稱一致", async function (page) {
  await tab(page, "company");
  await noRawKeys(page, "公司分頁");
  await act(page, "save-export");
  var code = await page.$eval('[data-act="save-code"]', function (x) { return x.value; });
  assert.ok(code.indexOf("SV1.") === 0, "匯出字串");
  await page.fill('[data-act="save-import-text"]', code);
  await act(page, "save-import");
  await act(page, "save-import-confirm");
  var s = await st(page);
  assert.strictEqual(s.company.name, "測試經紀");
});

step("debug：快轉 30 天 → 日誌有紀錄", async function (page) {
  var d0 = (await st(page)).day;
  await act(page, "debug-skip-30");
  var s = await st(page);
  // 主迴圈每秒也可能推進一天，所以用 ≥ 比較
  assert.ok(s.day >= d0 + 30 && s.day <= d0 + 31, "日期 " + d0 + " → " + s.day);
  assert.ok(s.log.some(function (e) { return e.type === "month_end"; }), "有月結");
  await act(page, "log-toggle");
  await page.waitForSelector(".sv-log-panel .sv-log-line");
  await noRawKeys(page, "日誌");
  await act(page, "log-toggle");
});

step("離線報告：回到 10 天前 → 跳出報告", async function (page) {
  await page.evaluate(function () { window.PriTestStarv.state().lastTickAt -= 10 * 60000; });
  await page.waitForSelector(".sv-report", { timeout: 5000 });
  await noRawKeys(page, "離線報告");
  await act(page, "report-close");
});

step("重新整理後從存檔繼續", async function (page) {
  var before = await st(page);
  await page.reload();
  await page.waitForSelector(".sv-top");
  var s = await st(page);
  assert.strictEqual(s.company.name, before.company.name);
  assert.ok(s.day >= before.day, "日期不會倒退");
  assert.strictEqual(s.artists.length, before.artists.length);
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
