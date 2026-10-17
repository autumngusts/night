// ============================================================================
// gousei（武俠合成）Playwright 流程檢查：
//   同一裝置：設定 → 交接畫面 → 任務顯示 → 合成 → 結果 → 下一位 → 復原 → 重新整理還原 → 親手達成任務
//   分別裝置：QR 畫面 → 手機頁任務與共用裝置一致 → 無效連結
//   兩個主題都能載入；切換日文後名稱改變
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8943 --directory dist
// 執行：node tools/gousei_check/ui_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.GOUSEI_BASE || "http://localhost:8943/gousei/index.html";

function debugState(page) { return page.evaluate(function () { return window.PriTestGousei._debugState(); }); }

// 從主題資料找出「用目前池子就能一步合出」的配方
function findRecipeFor(page, resultId) {
  return page.evaluate(function (rid) {
    var th = window.PriTestGousei._theme();
    var keys = Object.keys(th.recipes);
    for (var i = 0; i < keys.length; i++) if (th.recipes[keys[i]] === rid) return keys[i].split("|");
    return null;
  }, resultId);
}

async function startGame(page, opts) {
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); });
  await page.goto(BASE);
  await page.check('input[name=gs-theme][value="' + opts.theme + '"]');
  await page.check('input[name=gs-mode][value="' + opts.mode + '"]');
  await page.fill("#gs-player-count", String(opts.count));
  await page.dispatchEvent("#gs-player-count", "change");
  await page.click("#gs-start");
  await page.waitForFunction(function () { return window.PriTestGousei._debugState() !== null; }, null, { timeout: 15000 });
}

(async function main() {
  var browser = await chromium.launch();
  var page = await browser.newPage();
  var pageErrors = [];
  page.on("pageerror", function (e) { pageErrors.push(String(e)); });

  // ---- 同一裝置 ----
  await startGame(page, { theme: "wuxia", mode: "shared", count: 2 });
  await page.waitForSelector("#gs-handoff-ready");
  await page.click("#gs-handoff-ready");
  assert.strictEqual(await page.locator("#gs-targets li").count(), 3, "顯示 3 張任務");
  await page.click("#gs-toggle-targets");
  assert.strictEqual(await page.locator("#gs-targets").count(), 0, "可隱藏任務");

  await page.click('#gs-pool-list button[data-item="metal"]');
  await page.click('#gs-pool-list button[data-item="fire"]');
  await page.click("#gs-combine");
  await page.waitForSelector("#gs-result");
  var st = await debugState(page);
  assert.strictEqual(st.log.length, 1);
  assert.strictEqual(st.turn, 1, "輪到第二位");
  await page.click("#gs-next");
  await page.waitForSelector("#gs-handoff-ready");

  // 復原：同一裝置模式下回到「被復原的玩家」的交接畫面，不可讓下一位看到前一位的任務
  await page.click("#gs-handoff-ready");
  await page.click("#gs-undo");
  st = await debugState(page);
  assert.strictEqual(st.log.length, 0);
  assert.strictEqual(st.turn, 0);
  await page.waitForSelector("#gs-handoff-ready");
  assert.strictEqual(await page.locator("#gs-targets").count(), 0, "復原後不顯示任務");
  await page.click("#gs-handoff-ready");

  // 重新整理：回到交接畫面、state 保留
  await page.click('#gs-pool-list button[data-item="water"]');
  await page.click('#gs-pool-list button[data-item="water"]');
  await page.click("#gs-combine");
  await page.reload();
  await page.waitForSelector("#gs-handoff-ready");
  assert.strictEqual((await debugState(page)).log.length, 1);

  // 搜尋只重畫清單（輸入框維持焦點）
  await page.click("#gs-handoff-ready");
  await page.fill("#gs-pool-search", "水");
  assert.ok(await page.evaluate(function () { return document.activeElement.id === "gs-pool-search"; }));
  await page.fill("#gs-pool-search", "");

  // 親手達成：把目前玩家中階任務的兩個材料放進池子，合成後應達成
  st = await debugState(page);
  var cur = st.players[st.turn];
  var pair = await findRecipeFor(page, cur.targets[0]);
  assert.ok(pair, "中階任務要有配方");
  st.pool = st.pool.concat(pair.filter(function (id) { return st.pool.indexOf(id) < 0; }));
  await page.evaluate(function (s) { localStorage.setItem("pritest-gousei-state", JSON.stringify(s)); }, st);
  await page.reload();
  await page.click("#gs-handoff-ready");
  await page.click('#gs-pool-list button[data-item="' + pair[0] + '"]');
  await page.click('#gs-pool-list button[data-item="' + pair[1] + '"]');
  await page.click("#gs-combine");
  await page.waitForSelector("#gs-result.gs-achieved");
  st = await debugState(page);
  assert.deepStrictEqual(st.players[cur.id === "p1" ? 0 : 1].done, [cur.targets[0]]);

  // 日文切換：結果標題變成「○○ の合成結果」（中文是「○○ 的合成結果」）
  await page.evaluate(function () { window.I18N.setLang("ja"); });
  assert.ok((await page.textContent("#gs-result")).indexOf("の合成結果") >= 0, "切換日文後重畫");
  await page.evaluate(function () { window.I18N.setLang("zh"); });

  // ---- 分別裝置 ----
  await startGame(page, { theme: "wafu", mode: "split", count: 3 });
  await page.waitForSelector("#gs-qr-screen");
  await page.click('button[data-qr-player="1"]');
  await page.waitForSelector("#gs-qr-canvas");
  var url = await page.inputValue("#gs-qr-url");
  st = await debugState(page);
  var phone = await browser.newPage();
  await phone.goto(url);
  await phone.waitForSelector("#gs-join-toggle");
  await phone.click("#gs-join-toggle");
  var phoneTargets = await phone.$$eval("#gs-join-targets li", function (lis) { return lis.map(function (li) { return li.getAttribute("data-target"); }); });
  assert.deepStrictEqual(phoneTargets, st.players[1].targets, "手機任務與共用裝置一致");
  await phone.goto(BASE + "?join=garbage");
  await phone.waitForSelector("#gs-join.gs-error");
  await phone.close();

  await page.click("#gs-qr-continue");
  assert.strictEqual(await page.locator("#gs-targets").count(), 0, "分別裝置模式不在共用裝置顯示任務");
  assert.strictEqual(await page.locator("#gs-show-qr").count(), 1);
  await page.click('#gs-pool-list button[data-item="thunder"]');
  await page.click('#gs-pool-list button[data-item="wind"]');
  await page.click("#gs-combine");
  await page.click("#gs-next");
  assert.strictEqual(await page.locator("#gs-handoff-ready").count(), 0, "分別裝置模式沒有交接畫面");

  assert.deepStrictEqual(pageErrors, [], "頁面不應有 JS 錯誤");
  await browser.close();
  console.log("gousei ui_check OK");
})().catch(function (e) { console.error(e); process.exit(1); });
