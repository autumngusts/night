// ============================================================================
// toushou 內線模式 Playwright 整局檢查（單機傳遞）：3 人 × 3 標的。
// 驗證：設定畫面隱藏經典限定選項、內線人輪替、實價只出現在內線人遮蔽畫面、押金公開、
// 敘述 1～3 則、內線人不下注、公布答案後結算、重新整理還原。
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8941 --directory dist
// 執行：node tools/toushou_check/insider_ui_check.js
// 規則依據：docs/superpowers/specs/2026-10-21-toushou-insider-mode-design.md
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.TOUSHOU_BASE || "http://localhost:8941/toushou/index.html";

function debugState(page) { return page.evaluate(function () { return window.PriTestToushou._debugState(); }); }

(async function main() {
  var browser = await chromium.launch();
  var page = await browser.newPage();
  page.on("dialog", function (d) { d.accept(); });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); localStorage.setItem("pritest-lang", "zh"); });
  await page.reload();

  // ---- 設定：切到內線模式，經典限定的選項消失 ----
  assert.strictEqual(await page.locator("#ts-wind").count(), 1);
  await page.selectOption("#ts-game-mode", "insider");
  for (var id of ["#ts-missions", "#ts-wind", "#ts-swan", "#ts-sector", "#ts-delta-mode"]) {
    assert.strictEqual(await page.locator(id).count(), 0, id + " hidden in insider mode");
  }
  await page.fill("#ts-player-count", "3");
  await page.dispatchEvent("#ts-player-count", "change");
  assert.strictEqual(await page.locator("#ts-insider-uneven").count(), 0, "3 targets / 3 players is even");
  await page.click("#ts-btn-randomize");
  await page.click("#ts-btn-start");

  var s = await debugState(page);
  assert.strictEqual(s.config.mode, "insider");
  assert.strictEqual(s.phase, "reveal_target");
  var insiders = [];

  for (var round = 0; round < 3; round++) {
    assert.ok((await page.textContent("#ts-insider-name")).indexOf("內線人") >= 0);
    assert.strictEqual((await page.textContent("#ts-price")).trim(), "?");
    await page.click("#ts-btn-start-betting");
    s = await debugState(page);
    assert.strictEqual(s.phase, "insider_stake");
    var ins = s.current.insiderId;
    var T = s.current.truth;
    insiders.push(ins);

    // ---- 押金：遮蔽 → 超過上限被擋 → 押 200 ----
    assert.strictEqual(await page.locator("#ts-insider-stake").count(), 0, "stake hidden before reveal");
    await page.click("#ts-btn-reveal");
    var chips = s.players.filter(function (p) { return p.id === ins; })[0].chips;
    await page.fill("#ts-insider-stake", String(Math.floor(chips / 2) + 1));
    await page.click("#ts-btn-insider-stake");
    assert.ok((await page.textContent("#ts-game-error")).trim().length > 0, "over-max stake rejected");
    assert.strictEqual((await debugState(page)).phase, "insider_stake");
    await page.fill("#ts-insider-stake", "200");
    await page.click("#ts-btn-insider-stake");
    s = await debugState(page);
    assert.strictEqual(s.phase, "insider_narrate");
    assert.ok((await page.textContent("#ts-insider-name")).indexOf("200") >= 0, "stake is public");

    // ---- 敘述：實價只在遮蔽之後出現；送出後輸入框清空 ----
    assert.strictEqual(await page.locator("#ts-insider-truth").count(), 0, "truth hidden behind mask");
    await page.click("#ts-btn-reveal");
    assert.strictEqual((await page.textContent("#ts-insider-truth")).trim(), String(T));
    assert.ok(await page.locator("#ts-btn-end-narration").isDisabled(), "cannot end with 0 news");
    await page.fill("#ts-news-text", "暗示一 R" + round);
    await page.click("#ts-btn-release");
    if (round === 0) {
      // 第 1 個標的：發滿 3 則自動結束
      await page.click("#ts-btn-reveal");
      assert.strictEqual(await page.inputValue("#ts-news-text"), "", "textarea cleared after release");
      await page.locator(".ts-hand .ts-btn-play").first().click();
      await page.click("#ts-btn-reveal");
      await page.fill("#ts-news-text", "暗示三");
      await page.click("#ts-btn-release");
      s = await debugState(page);
      assert.strictEqual(s.current.news.length, 3);
    } else {
      await page.click("#ts-btn-reveal");
      await page.click("#ts-btn-end-narration");
      s = await debugState(page);
      assert.strictEqual(s.current.news.length, 1);
    }
    assert.strictEqual(s.phase, "bet");
    assert.strictEqual(s.current.bettors.indexOf(ins), -1, "insider does not bet");
    assert.ok((await page.textContent("#ts-news-board")).indexOf("暗示一 R" + round) >= 0);

    // ---- 其他人下注：第 1 位先試預測 100 被擋 ----
    for (var b = 0; b < 2; b++) {
      await page.click("#ts-btn-reveal");
      await page.fill("#ts-bet-amount", "100");
      if (b === 0) {
        await page.fill("#ts-bet-predict", "100");
        await page.click("#ts-btn-confirm-bet");
        assert.ok((await page.textContent("#ts-game-error")).indexOf("0～99") >= 0, "predict > 99 rejected");
      }
      await page.fill("#ts-bet-predict", String(b === 0 ? T : Math.min(99, T + 15)));
      await page.click("#ts-btn-confirm-bet");
    }
    s = await debugState(page);
    assert.strictEqual(s.phase, "discuss");

    if (round === 1) {
      await page.reload();
      s = await debugState(page);
      assert.strictEqual(s.phase, "discuss", "state restored after reload");
    }

    // ---- 公布答案 ----
    await page.click("#ts-btn-reveal-answer");
    s = await debugState(page);
    assert.strictEqual(s.phase, "settle");
    var h = s.history[round];
    assert.strictEqual(h.truth, T);
    // 兩人誤差 0 與 15（或靠 99 截斷更小）：E ≤ 10.6 → 至少賺半倍
    assert.ok(h.insiderNet >= 100, "insider net " + h.insiderNet);
    assert.ok((await page.textContent(".ts-insider-result")).indexOf("內線人") >= 0);
    assert.strictEqual((await page.textContent("#ts-price")).trim(), String(T), "truth revealed on card");
    await page.click("#ts-btn-next-target");
  }

  s = await debugState(page);
  assert.strictEqual(s.phase, "final");
  assert.deepStrictEqual(insiders.slice().sort(), ["p0", "p1", "p2"], "each player was insider once");
  assert.ok((await page.textContent("#ts-final-table")).length > 0);
  assert.strictEqual(await page.locator("#ts-final-missions").count(), 0, "no missions in insider mode");

  // ---- 日文切換不出錯 ----
  await page.evaluate(function () { window.I18N.setLang && window.I18N.setLang("ja"); });

  assert.deepStrictEqual(errors, [], "page errors: " + errors.join("\n"));
  await browser.close();
  console.log("toushou insider_ui_check: OK");
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
