// ============================================================================
// toushou（東正小遊戲）Playwright 整局流程檢查：3 人 × 3 標的，含任務卡、改寫手牌、
// 純自訂消息、直接出牌、消息累積到標的消息面、重新整理還原、切換日文。
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8941 --directory dist
// 執行：node tools/toushou_check/ui_check.js
// 規則依據：docs/superpowers/specs/2026-10-15-toushou-game-design.md
// toushou 沒有每幀重繪的元素，所以這裡可以用 page.click（與 midnight 的 CLAUDE.md §4.6 不同）。
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

  // ---- 設定：3 人、標的數依人數、任務卡開（預設）----
  await page.fill("#ts-player-count", "3");
  await page.dispatchEvent("#ts-player-count", "change");
  assert.strictEqual(await page.locator(".ts-player-name").count(), 3);
  assert.strictEqual(await page.locator(".ts-cat").count(), 17, "17 categories listed");
  await page.click("#ts-btn-randomize");
  assert.strictEqual(await page.locator(".ts-target-row").count(), 3);
  await page.click("#ts-btn-start");

  var s = await debugState(page);
  assert.strictEqual(s.phase, "missions");
  assert.strictEqual(s.players.length, 3);

  // ---- 任務逐人查看 ----
  for (var i = 0; i < 3; i++) {
    assert.strictEqual(await page.locator("#ts-mission-text").count(), 0, "mission hidden before reveal");
    await page.click("#ts-btn-reveal");
    assert.ok((await page.textContent("#ts-mission-text")).trim().length > 0);
    await page.click("#ts-btn-hide");
  }
  s = await debugState(page);
  assert.strictEqual(s.phase, "reveal_target");
  assert.ok((await page.textContent(".ts-summary")).trim().length > 0, "summary shown");
  assert.ok((await page.textContent(".ts-hooks")).indexOf("消息切入點") >= 0, "hooks shown");

  for (var round = 0; round < 3; round++) {
    await page.click("#ts-btn-start-betting");

    // ---- 下注：第 1 輪先試一次低於最低押注 ----
    for (var b = 0; b < 3; b++) {
      await page.click("#ts-btn-reveal");
      if (round === 0 && b === 0) {
        await page.fill("#ts-bet-amount", "1");
        await page.click("#ts-btn-confirm-bet");
        assert.ok((await page.textContent("#ts-game-error")).trim().length > 0, "min bet error shown");
      }
      await page.fill("#ts-bet-amount", String(100 + b * 50));
      await page.fill("#ts-bet-predict", String(90 + b * 20));
      await page.click("#ts-btn-confirm-bet");
    }
    s = await debugState(page);
    assert.strictEqual(s.phase, "news");
    assert.strictEqual(s.current.pot, 100 + 150 + 200);

    // ---- 三位股東：改寫／純自訂／直接出牌（沒有可直接打出的牌時改用改寫）----
    for (var k = 0; k < 3; k++) {
      var before = await debugState(page);
      var sh = before.current.order[before.current.turnIndex];
      await page.click("#ts-btn-reveal");
      var handTexts = await page.locator(".ts-hand li p").allTextContents();
      handTexts.forEach(function (tx) { assert.ok(tx.indexOf("{target}") < 0, "placeholder replaced: " + tx); });
      var playButtons = await page.locator(".ts-btn-play").count();
      if (k === 0 || (k === 2 && playButtons === 0)) {
        await page.locator(".ts-btn-edit").first().click();
        var prefilled = await page.inputValue("#ts-news-text");
        assert.ok(prefilled.length > 0, "edit prefills card text");
        await page.fill("#ts-news-text", prefilled + "（改寫）");
        await page.click("#ts-btn-release");
      } else if (k === 1) {
        await page.fill("#ts-news-text", "純自訂消息" + round);
        await page.click("#ts-btn-release");
      } else {
        await page.locator(".ts-btn-play").first().click();
      }
      var mid = await debugState(page);
      assert.strictEqual(mid.phase, "vote", "released (round " + round + ", turn " + k + ")");
      var hand = mid.players.filter(function (p) { return p.id === sh; })[0].hand;
      assert.strictEqual(hand.length, 5, "hand refilled / kept at 5");
      if (k === 0) assert.strictEqual(mid.current.pending.edited, true);
      if (k === 1) assert.strictEqual(mid.current.pending.cardId, null);
      if (k === 2 && playButtons > 0) {
        assert.strictEqual(mid.current.pending.edited, false);
        assert.ok(mid.current.pending.text.indexOf("{target}") < 0);
      }

      await page.fill("#ts-delta", String(k === 0 ? 20 : -5));
      await page.click("#ts-btn-apply-delta");
      assert.strictEqual(await page.locator("#ts-news-board li").count(), k + 1, "news accumulates on target card");
    }

    // ---- 每位玩家恰好當一次股東 ----
    s = await debugState(page);
    assert.strictEqual(s.phase, "settle");
    var h = s.history[round];
    assert.deepStrictEqual(h.news.map(function (n) { return n.playerId; }).sort(), ["p0", "p1", "p2"]);
    assert.strictEqual(h.finalPrice, 110);

    // ---- 結算與 Core.settleTarget 一致、彩池守恆（期望值由引擎計算，不硬編）----
    var expected = await page.evaluate(function (hist) {
      return window.PriTestToushouCore.settleTarget(hist.bets, hist.finalPrice, ["p0", "p1", "p2"]);
    }, h);
    assert.deepStrictEqual(h.payouts, expected.payouts);
    var sum = Object.keys(h.payouts).reduce(function (a, id) { return a + h.payouts[id]; }, 0);
    assert.strictEqual(sum, h.pot);
    assert.strictEqual(await page.locator("#ts-settle-table tr").count(), 4);

    // ---- 第 1 個標的結算後重新整理，state 完整還原 ----
    if (round === 0) {
      await page.reload();
      assert.deepStrictEqual(await debugState(page), s);
    }
    await page.click("#ts-btn-next-target");
  }

  s = await debugState(page);
  assert.strictEqual(s.phase, "final");
  assert.strictEqual(await page.locator("#ts-final-table tr").count(), 4);
  assert.strictEqual(await page.locator("#ts-final-missions li").count(), 3);
  var totalChips = s.players.reduce(function (a, p) { return a + p.chips; }, 0);
  assert.strictEqual(totalChips, 3000, "chips conserved across the game");

  // ---- 切換日文：標題與表頭跟著變 ----
  await page.click('.lang-btn[data-lang="ja"]');
  assert.ok((await page.textContent("h1")).indexOf("東正ミニゲーム") >= 0);
  assert.ok((await page.textContent("#ts-final-table")).indexOf("合計") >= 0);

  // ---- 第二局：單機 + 全員投票，跑 1 個標的 ----
  await page.click('.lang-btn[data-lang="zh"]');
  await page.click("#ts-btn-back-setup");
  await page.fill("#ts-player-count", "3");
  await page.dispatchEvent("#ts-player-count", "change");
  await page.uncheck("#ts-missions");
  await page.selectOption("#ts-delta-mode", "vote");
  assert.strictEqual(await page.inputValue("#ts-vote-cap"), "100");
  await page.click("#ts-btn-start");
  s = await debugState(page);
  assert.strictEqual(s.config.deltaMode, "vote");
  await page.click("#ts-btn-start-betting");
  for (var vb = 0; vb < 3; vb++) {
    await page.click("#ts-btn-reveal");
    await page.fill("#ts-bet-amount", "100");
    await page.fill("#ts-bet-predict", "100");
    await page.click("#ts-btn-confirm-bet");
  }
  for (var vk = 0; vk < 3; vk++) {
    await page.click("#ts-btn-reveal");
    await page.fill("#ts-news-text", "投票消息" + vk);
    await page.click("#ts-btn-release");
    var votes = [30, -10, 0];
    for (var vv = 0; vv < 3; vv++) {
      assert.strictEqual(await page.locator("#ts-vote-value").count(), 0, "vote hidden behind mask");
      await page.click("#ts-btn-reveal");
      if (vk === 0 && vv === 0) {
        await page.fill("#ts-vote-value", "101");
        await page.click("#ts-btn-cast-vote");
        assert.ok((await page.textContent("#ts-game-error")).indexOf("100") >= 0, "range error shows cap");
      }
      await page.fill("#ts-vote-value", String(votes[vv]));
      await page.click("#ts-btn-cast-vote");
    }
    assert.strictEqual(await page.locator(".ts-vote-detail").count(), vk + 1);
  }
  s = await debugState(page);
  assert.strictEqual(s.phase, "settle");
  assert.strictEqual(s.history[0].finalPrice, 100 + 7 * 3);

  // ---- 第三局：黑天鵝＋板塊連動，同一類別 2 個標的（spec 2026-10-16-toushou-swan-sector-design.md）----
  await page.click("#ts-btn-abandon");
  await page.waitForSelector("#ts-btn-start");
  await page.selectOption("#ts-delta-mode", "host");
  await page.check("#ts-swan");
  await page.check("#ts-sector");
  var catCount = await page.locator(".ts-cat").count();
  for (var ci = 1; ci < catCount; ci++) await page.locator(".ts-cat").nth(ci).uncheck();
  await page.click("#ts-btn-randomize");
  await page.click("#ts-btn-start");
  s = await debugState(page);
  assert.strictEqual(s.config.blackSwanEnabled, true);
  assert.strictEqual(s.config.sectorLinkEnabled, true);
  assert.ok(s.targets.every(function (tg) { return tg.category === s.targets[0].category; }), "single category");
  for (var sr = 0; sr < 2; sr++) {
    if (sr === 1) {
      // 下注前就預覽板塊連動的起始價
      var expectStart = await page.evaluate(function () {
        var st = window.PriTestToushou._debugState();
        return window.PriTestToushouCore.sectorStartPrice(st, st.targets[st.targetIndex].category).price;
      });
      assert.ok((await page.textContent("#ts-start-price")).indexOf(String(expectStart)) >= 0, "start price preview");
    }
    await page.click("#ts-btn-start-betting");
    s = await debugState(page);
    if (sr === 1) assert.strictEqual(s.current.startPrice, expectStart);
    for (var sb = 0; sb < 3; sb++) {
      await page.click("#ts-btn-reveal");
      assert.strictEqual(await page.inputValue("#ts-bet-predict"), String(s.current.startPrice), "predict defaults to start price");
      await page.fill("#ts-bet-amount", "100");
      await page.click("#ts-btn-confirm-bet");
    }
    s = await debugState(page);
    assert.ok(s.current.event, "event drawn");
    assert.strictEqual(await page.locator("#ts-swan-badge").count(), 1, "event badge shown");
    var turns = 0;
    while (s.phase === "news") {
      await page.click("#ts-btn-reveal");
      if (await page.locator(".ts-btn-play").count()) {
        await page.locator(".ts-btn-play").first().click();
      } else {
        await page.fill("#ts-news-text", "事件局消息" + turns);
        await page.click("#ts-btn-release");
      }
      await page.fill("#ts-delta", "20");
      await page.click("#ts-btn-apply-delta");
      turns++;
      s = await debugState(page);
    }
    assert.strictEqual(s.phase, "settle");
    assert.strictEqual(turns, s.history[sr].event === "extra" ? 4 : 3);
    await page.click("#ts-btn-next-target");
  }

  // ---- 英文介面：文字來自 en、組字串的標點改為半形（遊戲資料在英文模式顯示日文）----
  await page.click('.lang-btn[data-lang="en"]');
  assert.strictEqual((await page.textContent("#ts-btn-start-betting")).trim(), "Start betting");
  var enCard = await page.textContent(".ts-target-card");
  assert.ok(enCard.indexOf("Target 3 / 3") >= 0, "target heading in English");
  assert.ok(enCard.indexOf("Price: ") >= 0 && enCard.indexOf("Price：") < 0, "half-width colon in English");
  assert.ok((await page.textContent("#ts-start-price")).indexOf("sector linkage: previous target") >= 0);
  assert.ok((await page.textContent("#ts-start-price")).indexOf("（") < 0, "half-width parentheses in English");
  await page.click("#ts-btn-abandon");
  await page.waitForSelector("#ts-btn-start");
  var enSetup = await page.textContent(".ts-panel");
  ["開局設定", "人數", "最低押注", "加減分方式", "黑天鵝"].forEach(function (zhText) {
    assert.ok(enSetup.indexOf(zhText) < 0, "no Chinese UI text in English setup: " + zhText);
  });
  assert.strictEqual((await page.textContent("#ts-btn-start")).trim(), "Start game");
  await page.click('.lang-btn[data-lang="zh"]');
  assert.strictEqual((await page.textContent("#ts-btn-start")).trim(), "開始遊戲");

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("toushou ui_check: OK");
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
