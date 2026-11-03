// ============================================================================
// gousei（武俠合成）合作模式 Playwright 檢查（使用者指定 2026-11-03）：
//   三個主題都能以合作模式開局 → 沒有任務確認畫面、共同目標 5 個公開
//   → 任何人合出目標即全隊達成 → 廢料記失敗 → 全部達成後顯示效率得分與最佳紀錄
//   → 提前結算 → 復原
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8943 --directory dist
// 執行：node tools/gousei_check/coop_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.GOUSEI_BASE || "http://localhost:8943/gousei/index.html";

function debugState(page) { return page.evaluate(function () { return window.PriTestGousei._debugState(); }); }

async function startCoop(page, theme, count) {
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-gousei-state"); });
  await page.goto(BASE);
  await page.check('input[name=gs-theme][value="' + theme + '"]');
  await page.check('input[name=gs-mode][value="coop"]');
  await page.fill("#gs-player-count", String(count));
  await page.dispatchEvent("#gs-player-count", "change");
  await page.click("#gs-start");
  await page.waitForFunction(function () { return window.PriTestGousei._debugState() !== null; }, null, { timeout: 20000 });
  await page.waitForSelector("#gs-coop");
}

// 完整 state 由 App 建立後，只改指定欄位再寫回（CLAUDE.md §4.4）
async function patchState(page, fn, arg) {
  await page.evaluate(function (args) {
    var s = JSON.parse(localStorage.getItem("pritest-gousei-state"));
    new Function("s", "arg", args[0])(s, args[1]);
    localStorage.setItem("pritest-gousei-state", JSON.stringify(s));
  }, [fn, arg]);
  await page.reload();
  await page.waitForSelector("#gs-coop, #gs-coop-score");
}

// 找一個能合出 rid 的 2 材料配方
function recipeFor(page, rid) {
  return page.evaluate(function (r) {
    var th = window.PriTestGousei._theme();
    var keys = Object.keys(th.recipes);
    for (var i = 0; i < keys.length; i++) if (th.recipes[keys[i]] === r) return keys[i].split("|");
    return null;
  }, rid);
}

async function combine(page, a, b) {
  await page.dispatchEvent('#gs-pool-list button[data-item="' + a + '"]', "click");
  await page.dispatchEvent('#gs-pool-list button[data-item="' + b + '"]', "click");
  await page.dispatchEvent("#gs-combine", "click");
  // 已知廢料提示時照樣合成
  if (await page.locator("#gs-combine-anyway").count()) await page.dispatchEvent("#gs-combine-anyway", "click");
  await page.waitForSelector("#gs-result");
}

(async function main() {
  var browser = await chromium.launch();
  var page = await browser.newPage();
  var pageErrors = [];
  page.on("pageerror", function (e) { pageErrors.push(String(e)); });

  // ---- 三個主題都能以合作模式開局 ----
  var themes = ["wuxia", "wafu", "food"];
  for (var ti = 0; ti < themes.length; ti++) {
    await startCoop(page, themes[ti], 2);
    var st0 = await debugState(page);
    assert.strictEqual(st0.mode, "coop");
    assert.strictEqual(st0.coop.targets.length, 5, themes[ti] + "：共同目標 5 個");
    assert.ok(!st0.confirm, "合作模式沒有任務確認畫面");
    assert.strictEqual(await page.locator("#gs-coop-targets li").count(), 5, "共同目標公開顯示");
    assert.strictEqual(await page.locator("#gs-player-targets").count(), 0, "沒有個人任務區");
  }

  // ---- 武俠：達成目標、失敗、計分 ----
  await page.evaluate(function () { localStorage.removeItem("pritest-gousei-coop-best"); });
  await startCoop(page, "wuxia", 2);
  var st = await debugState(page);
  var target = st.coop.targets[0];
  var rec = await recipeFor(page, target);
  assert.ok(rec, "目標有配方");
  await patchState(page, "arg.forEach(function (id) { if (s.pool.indexOf(id) < 0) s.pool.push(id); });", rec);

  // p1 合出廢料（金＋金以外，找一個沒配方的組合）
  var junkPair = await page.evaluate(function () {
    var th = window.PriTestGousei._theme();
    var s = window.PriTestGousei._debugState();
    var Core = window.PriTestGouseiCore;
    for (var i = 0; i < s.pool.length; i++) for (var j = i; j < s.pool.length; j++) {
      if (th.junkSet[Core.combine(th, s.pool[i], s.pool[j])]) return [s.pool[i], s.pool[j]];
    }
    return null;
  });
  assert.ok(junkPair, "找得到會合出廢料的組合");
  await combine(page, junkPair[0], junkPair[1]);
  st = await debugState(page);
  assert.strictEqual(st.coop.fails, 1, "廢料記 1 次失敗");
  assert.ok((await page.textContent("#gs-coop-stats")).indexOf("1") >= 0);
  await page.dispatchEvent("#gs-next", "click");

  // p2 合出共同目標 → 全隊達成
  await combine(page, rec[0], rec[1]);
  st = await debugState(page);
  assert.deepStrictEqual(st.coop.done, [target], "p2 合出即全隊達成");
  assert.deepStrictEqual(st.players[1].done, [target], "記為 p2 的貢獻");
  assert.ok(await page.locator('#gs-coop-targets li.gs-done[data-target="' + target + '"]').count(), "目標標記為完成");
  await page.dispatchEvent("#gs-next", "click");

  // 其他 4 個先標記完成，再合一次目標 → 結束並計分
  var target2 = st.coop.targets[1];
  var rec2 = await recipeFor(page, target2);
  await patchState(page, "s.coop.done = s.coop.done.concat(arg.others); arg.rec.forEach(function (id) { if (s.pool.indexOf(id) < 0) s.pool.push(id); });",
    { others: st.coop.targets.slice(2), rec: rec2 });
  await combine(page, rec2[0], rec2[1]);
  await page.waitForSelector("#gs-coop-score");
  st = await debugState(page);
  assert.strictEqual(st.winner, "coop");
  var expect = Math.round(1000 * 5 / (st.round + st.coop.fails));
  assert.ok((await page.textContent("#gs-coop-score-value")).indexOf(String(expect)) >= 0, "效率得分 = 1000×5÷(回合+失敗)");
  assert.strictEqual(await page.locator("#gs-coop-new-best").count(), 1, "第一次紀錄＝新紀錄");
  assert.strictEqual(await page.locator("#gs-pool").count(), 0, "結束後不能再合成");
  var best = await page.evaluate(function () { return JSON.parse(localStorage.getItem("pritest-gousei-coop-best")).wuxia; });
  assert.strictEqual(best.score, expect);
  await page.reload();
  await page.waitForSelector("#gs-coop-new-best");

  // ---- 提前結算與復原 ----
  await startCoop(page, "wafu", 3);
  await page.dispatchEvent("#gs-coop-end", "click");
  assert.ok((await page.textContent("#gs-coop-end")).length > 0, "第一次按只是確認");
  assert.strictEqual(await page.locator("#gs-coop-score").count(), 0);
  await page.dispatchEvent("#gs-coop-end", "click");
  await page.waitForSelector("#gs-coop-score");
  assert.ok((await page.textContent("#gs-coop-score-value")).indexOf("0") >= 0, "沒有達成＝0 分");
  await page.dispatchEvent("#gs-undo", "click");
  await page.waitForSelector("#gs-pool");
  assert.strictEqual((await debugState(page)).winner, null, "提前結算可復原");

  // ---- 設定畫面顯示最佳紀錄 ----
  await page.evaluate(function () { localStorage.removeItem("pritest-gousei-state"); });
  await page.goto(BASE);
  await page.check('input[name=gs-mode][value="coop"]');
  await page.check('input[name=gs-theme][value="wuxia"]');
  assert.ok((await page.textContent("#gs-coop-best")).indexOf(String(expect)) >= 0, "設定畫面顯示該主題最佳紀錄");

  assert.deepStrictEqual(pageErrors, [], "沒有頁面錯誤");
  await browser.close();
  console.log("gousei coop_check OK");
})().catch(function (e) { console.error(e); process.exit(1); });
