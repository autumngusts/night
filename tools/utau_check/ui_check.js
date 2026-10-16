// ============================================================================
// utau（我不會唱歌）Playwright 流程檢查：基本模式結算／復原／重新整理還原，
// 進階模式題目遮蔽、換歌、結束與同設定再玩、切換日文。
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8942 --directory dist
// 執行：node tools/utau_check/ui_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.UTAU_BASE || "http://localhost:8942/utau/index.html";

function debugState(page) { return page.evaluate(function () { return window.PriTestUtau._debugState(); }); }

(async function main() {
  var browser = await chromium.launch();
  var page = await browser.newPage();
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); localStorage.setItem("pritest-lang", "zh"); });
  await page.reload();

  // ---- 設定：3 人、計分表跟著人數變成 3 列 ----
  await page.fill("#ut-player-count", "3");
  await page.dispatchEvent("#ut-player-count", "change");
  assert.strictEqual(await page.locator(".ut-name-input").count(), 3);
  assert.strictEqual(await page.locator(".ut-score-input").count(), 3);
  await page.fill(".ut-name-input[data-index='0']", "阿明");
  await page.fill(".ut-score-input[data-k='1']", "5");
  await page.fill("#ut-ai-bonus", "2");
  await page.click("#ut-btn-start");

  var s = await debugState(page);
  assert.strictEqual(s.config.players[0].name, "阿明");
  assert.deepStrictEqual(s.config.scoreTable, [0, 5, 1]);
  assert.strictEqual(s.round, 1);
  assert.strictEqual(await page.locator("#ut-btn-reveal").count(), 0, "basic mode has no masked topic");

  // ---- 結算：AI 答對＋1 人答對 ----
  var singer = s.current.singerId;
  var guesser = s.config.players.map(function (p) { return p.id; }).filter(function (id) { return id !== singer; })[0];
  assert.strictEqual(await page.locator(".ut-player-toggle").count(), 2, "singer is not a guesser");
  await page.click("#ut-btn-ai");
  await page.click(".ut-player-toggle[data-player='" + guesser + "']");
  assert.ok((await page.textContent("#ut-preview")).indexOf("+7") >= 0, "preview shows singer 5+2");
  await page.click("#ut-btn-settle");
  s = await debugState(page);
  assert.strictEqual(s.scores[singer], 7);
  assert.strictEqual(s.scores[guesser], 5);
  assert.strictEqual(s.round, 2);
  assert.notStrictEqual(s.current.singerId, singer);
  assert.strictEqual(await page.locator("#ut-btn-ai.ut-on").count(), 0, "toggles reset for the new round");

  // ---- 復原 ----
  await page.click("#ut-btn-undo");
  s = await debugState(page);
  assert.strictEqual(s.round, 1);
  assert.strictEqual(s.scores[singer], 0);
  await page.click("#ut-btn-settle");

  // ---- 重新整理還原 ----
  await page.reload();
  s = await debugState(page);
  assert.strictEqual(s.round, 2);
  assert.ok(await page.locator("#ut-scoreboard").isVisible());

  // ---- 結束 → 回到設定 → 進階模式 ----
  await page.click("#ut-btn-finish");
  assert.ok(await page.locator("#ut-winner").isVisible());
  await page.click("#ut-btn-back-setup");
  assert.strictEqual(await page.locator(".ut-name-input").count(), 3, "previous config is reused");
  await page.check("#ut-mode-advanced");
  // 只留日本 2010 年代、只留替え歌
  for (var id of ["zh", "ko", "en"]) await page.uncheck("#ut-region-" + id);
  var decades = await page.$$eval("input[id^='ut-decade-']", function (els) { return els.map(function (e) { return e.id; }); });
  for (var dId of decades) {
    if (dId === "ut-decade-2010") await page.check("#" + dId);
    else await page.uncheck("#" + dId);
  }
  for (var st of ["instrumental", "vocal", "variation"]) await page.uncheck("#ut-style-" + st);
  assert.ok(/\d+/.test(await page.textContent("#ut-pool-size")));
  await page.click("#ut-btn-start");

  s = await debugState(page);
  assert.strictEqual(s.config.mode, "advanced");
  assert.strictEqual(await page.locator("#ut-song-card").count(), 0, "song is masked before reveal");
  await page.click("#ut-btn-reveal");
  var title = await page.textContent(".ut-song-title");
  assert.ok(title.length > 0);
  assert.strictEqual(s.current.style, "lyrics");
  assert.ok(s.current.songId.indexOf("ja:") === 0);
  await page.click("#ut-btn-redraw");
  var s2 = await debugState(page);
  assert.notStrictEqual(s2.current.songId, s.current.songId, "redraw picks a different song");
  await page.click("#ut-btn-hide");
  assert.strictEqual(await page.locator("#ut-song-card").count(), 0);

  // 結算後上一輪顯示答案
  await page.click("#ut-btn-settle");
  var song = s2.current.songId.slice(3);
  assert.ok((await page.textContent("#ut-last-round")).indexOf(song) >= 0, "answer shown after scoring");

  // 重新整理後題目回到遮蔽
  await page.click("#ut-btn-reveal");
  await page.reload();
  assert.strictEqual(await page.locator("#ut-song-card").count(), 0, "reveal is not persisted");

  // ---- 切換日文 ----
  await page.evaluate(function () { window.I18N.setLang("ja"); });
  assert.ok((await page.textContent("#ut-round-title")).indexOf("ラウンド") >= 0);

  // ---- 同設定再玩 ----
  await page.click("#ut-btn-finish");
  await page.click("#ut-btn-replay");
  s = await debugState(page);
  assert.strictEqual(s.round, 1);
  assert.strictEqual(s.history.length, 0);
  assert.strictEqual(s.config.mode, "advanced");

  // ---- 首頁有入口 ----
  await page.goto(BASE.replace("utau/index.html", "index.html"));
  assert.strictEqual(await page.locator("a[href='utau/index.html']").count() > 0, true);

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("utau ui_check OK");
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
