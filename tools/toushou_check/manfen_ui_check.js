// ============================================================================
// toushou 滿分男模式 Playwright 整局檢查（單機傳遞）：3 人 × 3 題，啟用帶風向＋黑天鵝，375px 寬。
// 驗證：設定畫面隱藏經典限定選項、爆料者輪替、評分遮蔽與帶風向限制、封口費競價、
// 下注預測小數一位、結算平均與彩池守恆、重新整理還原、整局回顧。
// 前置：py -3 generate.py；py -3 -m http.server 8941 --directory dist
// 執行：node tools/toushou_check/manfen_ui_check.js
// 規則依據：docs/superpowers/specs/2026-10-27-toushou-manfen-mode-design.md
// 備註：會重繪的元素一律用 dispatchEvent（不用 page.click）；黑天鵝／風向卡隨機，期望值由 state 推算。
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.TOUSHOU_BASE || "http://localhost:8941/toushou/index.html";

function debugState(page) { return page.evaluate(function () { return window.PriTestToushou._debugState(); }); }
async function click(page, sel) { await page.dispatchEvent(sel, "click"); await page.waitForTimeout(40); }
async function revealIfMasked(page) {
  if (await page.locator("#ts-mask").count()) await click(page, "#ts-btn-reveal");
}
async function noHScroll(page, label) {
  var w = await page.evaluate(function () { return document.documentElement.scrollWidth; });
  assert.ok(w <= 375, label + ": horizontal scroll (scrollWidth=" + w + ")");
}
function optionValues(page, sel) {
  return page.$$eval(sel + " option", function (os) { return os.map(function (o) { return o.value; }); });
}
function appText(page) { return page.evaluate(function () { return document.getElementById("ts-app").innerText; }); }

(async function main() {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  page.on("dialog", function (d) { d.accept(); });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); localStorage.setItem("pritest-lang", "zh"); });
  await page.reload();

  // ---- 設定 ----
  await page.selectOption("#ts-game-mode", "manfen");
  for (var id of ["#ts-missions", "#ts-sector", "#ts-delta-mode"]) {
    assert.strictEqual(await page.locator(id).count(), 0, id + " hidden in manfen mode");
  }
  assert.strictEqual(await page.locator(".ts-mf-cat").count(), 6);
  await page.fill("#ts-player-count", "3");
  await page.dispatchEvent("#ts-player-count", "change");
  if (!(await page.isChecked("#ts-wind"))) await click(page, "#ts-wind");
  if (!(await page.isChecked("#ts-swan"))) await click(page, "#ts-swan");
  if (await page.locator("#ts-target-count").count()) await page.fill("#ts-target-count", "3");
  await click(page, "#ts-btn-randomize");
  await noHScroll(page, "setup");
  await click(page, "#ts-btn-start");

  var s = await debugState(page);
  assert.strictEqual(s.config.mode, "manfen");
  assert.strictEqual(s.targets.length, 3);
  assert.ok(s.config.windEnabled && s.config.blackSwanEnabled);
  var startTotal = s.players.reduce(function (n, p) { return n + p.chips; }, 0);
  var anyBonus = false;

  for (var round = 0; round < 3; round++) {
    s = await debugState(page);
    assert.strictEqual(s.phase, "reveal_target");
    await click(page, "#ts-btn-start-betting");

    // 爆料：爆料者與畫面一致；有可直接打出的牌就打出第一張，否則自訂
    s = await debugState(page);
    assert.strictEqual(s.phase, "mf_expose");
    var blamerName = s.players.filter(function (p) { return p.id === s.current.blamerId; })[0].name;
    assert.ok((await page.textContent("#ts-mf-blamer")).indexOf(blamerName) >= 0, "blamer shown");
    await revealIfMasked(page);
    if (await page.locator(".ts-hand li .ts-btn-play").count()) {
      await click(page, ".ts-hand li .ts-btn-play >> nth=0");
    } else {
      await page.fill("#ts-news-text", "每天都要跟你報備行程");
      await click(page, "#ts-btn-release");
    }
    s = await debugState(page);
    assert.strictEqual(s.phase, "mf_rate");
    assert.ok((await page.textContent("#ts-mf-sentence")).length > 0);
    assert.strictEqual(await page.locator("#ts-mf-wind-maybe").count(), 1);
    // 黑天鵝是隨機的：抽到事件時一定要顯示徽章
    if (s.current.event) assert.ok(await page.isVisible("#ts-swan-badge"), "swan badge shown when event drawn");
    var event = s.current.event;
    await noHScroll(page, "rate r" + round);

    // 秘密評分：遮蔽畫面不洩漏帶風向身分；帶風向者只看到兩顆可按，其餘全可按
    for (var k = 0; k < 3; k++) {
      var cur = await debugState(page);
      var txt0 = await appText(page);
      assert.ok(txt0.indexOf("你是帶風向的人") < 0 && txt0.indexOf("你不是帶風向的人") < 0, "wind status leaked on mask");
      await revealIfMasked(page);
      var pid = cur.players.filter(function (p) { return !(p.id in cur.current.ratings); })[0].id;
      var enabled = await page.$$eval(".ts-mf-rate", function (bs) {
        return bs.filter(function (b) { return !b.disabled; }).map(function (b) { return Number(b.dataset.value); });
      });
      var totalBtns = await page.locator(".ts-mf-rate").count();
      if (cur.current.windHolder === pid) {
        assert.strictEqual(enabled.length, 2, "wind holder limited to 2 ratings");
        assert.ok(await page.isVisible("#ts-mf-wind-status"));
      } else {
        assert.strictEqual(enabled.length, totalBtns, "non-holder can press every rating");
      }
      await click(page, '.ts-mf-rate[data-value="' + enabled[0] + '"]');
    }
    s = await debugState(page);
    assert.strictEqual(s.phase, "mf_mind");
    assert.ok((await appText(page)).indexOf("你是帶風向") < 0, "wind holder not leaked in mind phase");
    await noHScroll(page, "mind r" + round);

    // 心理戰：第一題做「要求 → 拒絕 → 加價 → 亮牌」，檢查對象選單不含要求者、驗證錯誤後保留選擇
    if (round === 0) {
      var min = Number(await page.getAttribute("#ts-mf-req-offer", "min"));
      var froms = await optionValues(page, "#ts-mf-req-from");
      var from = froms[0];
      for (var fi = 0; fi < froms.length; fi++) {
        await page.selectOption("#ts-mf-req-from", froms[fi]);
        assert.ok((await optionValues(page, "#ts-mf-req-to")).indexOf(froms[fi]) < 0, "target list excludes requester");
      }
      await page.selectOption("#ts-mf-req-from", from);
      var tos = await optionValues(page, "#ts-mf-req-to");
      var to = tos[tos.length - 1];
      await page.selectOption("#ts-mf-req-to", to);
      await page.fill("#ts-mf-req-offer", "0");
      await click(page, "#ts-btn-mf-request");
      assert.ok((await page.textContent("#ts-game-error")).trim().length > 0, "invalid offer rejected");
      assert.strictEqual(await page.inputValue("#ts-mf-req-from"), from, "from kept after error");
      assert.strictEqual(await page.inputValue("#ts-mf-req-to"), to, "to kept after error");
      await page.fill("#ts-mf-req-offer", String(min));
      await click(page, "#ts-btn-mf-request");
      await click(page, "#ts-btn-mf-refuse");
      await page.fill("#ts-mf-raise-offer", String(min + 1));
      await click(page, "#ts-btn-mf-raise");
      await click(page, "#ts-btn-mf-reveal");
      s = await debugState(page);
      assert.strictEqual(s.current.revealed[to], "paid");
      assert.strictEqual(s.current.mindPot, min + (min + min + 1), "gag pot = first offer + raised pair");
      assert.ok((await page.textContent("#ts-mf-revealed")).indexOf(String(s.current.ratings[to])) >= 0);
      assert.ok((await page.textContent("#ts-mf-mind-pot")).indexOf(String(s.current.mindPot)) >= 0);
    }

    // 重新整理後回到同一階段
    await page.reload();
    assert.strictEqual((await debugState(page)).phase, "mf_mind", "state restored after reload");
    await click(page, "#ts-btn-mf-end-mind");

    // 下注：預測 4.5（儲存為 45）
    s = await debugState(page);
    assert.strictEqual(s.phase, "bet");
    var nb = s.current.bettors.length;
    for (var b = 0; b < nb; b++) {
      await revealIfMasked(page);
      await page.fill("#ts-bet-predict", "4.5");
      await click(page, "#ts-btn-confirm-bet");
    }
    s = await debugState(page);
    assert.strictEqual(s.phase, "settle");
    var bets = s.lastSettlement.bets;
    Object.keys(bets).forEach(function (pid2) { assert.strictEqual(bets[pid2].predict, 45); });
    // 交易取消（黑天鵝）時顯示退款而非群體平均
    if (!s.lastSettlement.cancelled) assert.ok(/群體平均/.test(await page.textContent("#ts-mf-avg")), "avg shown");
    assert.strictEqual(await page.locator("#ts-settle-table tr[data-player]").count(), 3);
    var tot = s.players.reduce(function (n, p) { return n + p.chips; }, 0);
    var last = s.history[s.history.length - 1];
    if (last.bonus > 0) anyBonus = true;
    // 沒有任何紓困加碼時，總籌碼守恆
    if (!anyBonus) assert.strictEqual(tot, startTotal, "chips conserved r" + round + " (event " + event + ")");
    await noHScroll(page, "settle r" + round);
    await click(page, "#ts-btn-next-target");
  }

  s = await debugState(page);
  assert.strictEqual(s.phase, "final");
  var blamers = s.history.map(function (h) { return h.blamerId; }).sort();
  assert.deepStrictEqual(blamers, ["p0", "p1", "p2"], "each player exposes once");
  assert.strictEqual(await page.locator("#ts-final-table tr").count(), 4);
  assert.strictEqual(await page.locator("details .ts-mf-sentence").count(), 3);
  await page.evaluate(function () { document.querySelectorAll("details").forEach(function (d) { d.open = true; }); });
  var dupIds = await page.evaluate(function () {
    var seen = {}, dup = [];
    document.querySelectorAll("[id]").forEach(function (n) { if (seen[n.id]) dup.push(n.id); seen[n.id] = 1; });
    return dup;
  });
  assert.deepStrictEqual(dupIds, [], "no duplicate ids on final");
  await noHScroll(page, "final");

  assert.deepStrictEqual(errors, [], "page errors: " + errors.join("\n"));
  await browser.close();
  console.log("manfen_ui_check passed");
})().catch(function (e) { console.error(e); process.exit(1); });
