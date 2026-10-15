// ============================================================================
// toushou（東正小遊戲）多裝置連線檢查：3 個瀏覽器 context＝3 台裝置，走 Firebase Local Emulator，
// 不連真的 Firebase 專案、不觸發 App Check。
// 規則依據：docs/superpowers/specs/2026-10-15-toushou-multidevice-design.md
//
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8941 --directory dist
//   3. （repo 根目錄）tools/midnight_check/node_modules/.bin/firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node tools/toushou_check/multi_device_check.js
//
// 流程：A 建房（主持人，認領 p0）→ B、C 以連結加入並認領 p1、p2 → 各自確認任務 → 主持人開始下注 →
// 不照順序同時下注（並驗證遠端更新不會清掉輸入中的內容）→ 各股東在自己的裝置釋放消息 → 主持人輸入加減分
// → 跑完 3 個標的；途中重新整理 B 確認回到原座位；最後比對三台裝置的 state 完全一致。
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.TOUSHOU_BASE || "http://localhost:8941/toushou/index.html";
var TIMEOUT = 15000;
var DEVICES = [];
var ERRORS = [];

function debugState(page) { return page.evaluate(function () { return window.PriTestToushou._debugState(); }); }
function debugRoom(page) { return page.evaluate(function () { return window.PriTestToushou._debugRoom(); }); }

function waitPhase(page, phase) {
  return page.waitForFunction(function (ph) {
    var s = window.PriTestToushou && window.PriTestToushou._debugState();
    return !!s && s.phase === ph;
  }, phase, { timeout: TIMEOUT });
}

function waitState(page, fnSrc, arg) {
  return page.waitForFunction(new Function("arg", "var s = window.PriTestToushou && window.PriTestToushou._debugState(); if (!s) return false; " + fnSrc), arg, { timeout: TIMEOUT });
}

async function newDevice(browser, errors, label) {
  var context = await browser.newContext();
  await context.addInitScript(function () {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
      window.localStorage.setItem("pritest-lang", "zh");
    } catch (e) { /* 忽略 */ }
  });
  var page = await context.newPage();
  DEVICES.push({ label: label, page: page });
  page.on("dialog", function (d) { d.accept(); });
  page.on("pageerror", function (e) { errors.push(label + ": " + String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(label + " console: " + m.text()); });
  return page;
}

(async function main() {
  var browser = await chromium.launch();
  var errors = ERRORS;
  var A = await newDevice(browser, errors, "A");
  var B = await newDevice(browser, errors, "B");
  var C = await newDevice(browser, errors, "C");

  // ---- A：設定 3 人、開連線模式、建立房間 ----
  await A.goto(BASE);
  await A.fill("#ts-player-count", "3");
  await A.dispatchEvent("#ts-player-count", "change");
  await A.click("#ts-online");
  assert.ok((await A.textContent("#ts-btn-start")).indexOf("建立房間") >= 0);
  await A.click("#ts-btn-start");
  await A.waitForSelector("#ts-room-url", { timeout: TIMEOUT });
  var url = await A.inputValue("#ts-room-url");
  assert.ok(/\?room=g[0-9a-f]{32}$/.test(url), "room url: " + url);
  assert.ok(A.url().indexOf("?room=") >= 0, "host url updated");
  var roomA = await debugRoom(A);
  assert.strictEqual(roomA.hostId, roomA.clientId, "creator is host");

  // ---- 認領座位：A=p0、B=p1、C=p2 ----
  await A.click('.ts-btn-claim[data-player="p0"]');
  await B.goto(url);
  await C.goto(url);
  await B.waitForSelector('.ts-btn-claim[data-player="p1"]', { timeout: TIMEOUT });
  await B.click('.ts-btn-claim[data-player="p1"]');
  await C.waitForSelector('.ts-btn-claim[data-player="p2"]', { timeout: TIMEOUT });
  await C.click('.ts-btn-claim[data-player="p2"]');
  await A.waitForFunction(function () {
    var r = window.PriTestToushou._debugRoom();
    return r && r.seats && r.seats.p0 && r.seats.p1 && r.seats.p2;
  }, null, { timeout: TIMEOUT });
  var seats = (await debugRoom(A)).seats;
  assert.strictEqual(seats.p1, (await debugRoom(B)).clientId);
  assert.strictEqual(seats.p2, (await debugRoom(C)).clientId);
  var deviceOf = { p0: A, p1: B, p2: C };

  // ---- 任務：各自只看到自己的任務，不需遮蔽 ----
  var s = await debugState(A);
  assert.strictEqual(s.phase, "missions");
  for (var pid in deviceOf) {
    var dev = deviceOf[pid];
    await dev.waitForSelector("#ts-mission-text", { timeout: TIMEOUT });
    assert.strictEqual(await dev.locator("#ts-mask").count(), 0, "single-seat device has no mask");
    assert.strictEqual(await dev.locator("#ts-mission-text").count(), 1);
  }
  await B.click("#ts-btn-hide");
  await B.waitForSelector(".ts-wait-text", { timeout: TIMEOUT });
  assert.ok((await B.textContent(".ts-wait-text")).indexOf("1 / 3") >= 0, "B waits for others");
  await C.click("#ts-btn-hide");
  await A.click("#ts-btn-hide");
  await Promise.all([A, B, C].map(function (d) { return waitPhase(d, "reveal_target"); }));

  for (var round = 0; round < 3; round++) {
    // ---- 只有主持人能開始下注 ----
    assert.strictEqual(await B.locator("#ts-btn-start-betting").count(), 0);
    await A.click("#ts-btn-start-betting");
    await Promise.all([A, B, C].map(function (d) { return waitPhase(d, "bet"); }));
    for (var p in deviceOf) await deviceOf[p].waitForSelector("#ts-bet-amount", { timeout: TIMEOUT });

    // B 先打到一半；C 下注造成遠端更新後，B 的輸入內容要保留
    await B.fill("#ts-bet-amount", "150");
    await B.fill("#ts-bet-predict", "110");
    await C.fill("#ts-bet-amount", "200");
    await C.fill("#ts-bet-predict", "130");
    await C.click("#ts-btn-confirm-bet");
    await waitState(B, "return Object.keys(s.current.bets).length === 1;");
    assert.strictEqual(await B.inputValue("#ts-bet-amount"), "150", "typed value kept after remote update");
    assert.strictEqual(await B.inputValue("#ts-bet-predict"), "110");
    await B.click("#ts-btn-confirm-bet");
    await A.fill("#ts-bet-amount", "100");
    await A.fill("#ts-bet-predict", "90");
    await A.click("#ts-btn-confirm-bet");
    await Promise.all([A, B, C].map(function (d) { return waitPhase(d, "news"); }));

    // ---- 股東在自己的裝置釋放消息，其他人只看到等待；主持人輸入加減分 ----
    for (var k = 0; k < 3; k++) {
      s = await debugState(A);
      var sh = s.current.order[s.current.turnIndex];
      var shDev = deviceOf[sh];
      await shDev.waitForSelector("#ts-news-text", { timeout: TIMEOUT });
      for (var other in deviceOf) {
        if (other === sh) continue;
        assert.strictEqual(await deviceOf[other].locator("#ts-news-text").count(), 0, other + " must not see " + sh + "'s hand");
        assert.strictEqual(await deviceOf[other].locator(".ts-hand").count(), 0);
      }
      if (k === 0) {
        await shDev.locator(".ts-btn-edit").first().click();
        await shDev.fill("#ts-news-text", (await shDev.inputValue("#ts-news-text")) + "（改寫）");
      } else {
        await shDev.fill("#ts-news-text", "消息 " + round + "-" + k);
      }
      await shDev.click("#ts-btn-release");
      await Promise.all([A, B, C].map(function (d) { return waitPhase(d, "vote"); }));
      if (sh !== "p0") assert.strictEqual(await shDev.locator("#ts-delta").count(), 0, "only host inputs delta");
      await A.fill("#ts-delta", String(k === 0 ? 20 : -5));
      await A.click("#ts-btn-apply-delta");
      var expectPhase = k === 2 ? "settle" : "news";
      await Promise.all([A, B, C].map(function (d) { return waitPhase(d, expectPhase); }));
      await B.waitForFunction(function (n) { return document.querySelectorAll("#ts-news-board li").length === n; }, k + 1, { timeout: TIMEOUT });
    }

    s = await debugState(A);
    var h = s.history[round];
    assert.strictEqual(h.finalPrice, 110);
    assert.deepStrictEqual(h.news.map(function (n) { return n.playerId; }).sort(), ["p0", "p1", "p2"]);
    var sum = Object.keys(h.payouts).reduce(function (a, id) { return a + h.payouts[id]; }, 0);
    assert.strictEqual(sum, h.pot);

    // ---- 第 1 個標的結算後重新整理 B：回到原座位、state 一致 ----
    if (round === 0) {
      var bClient = (await debugRoom(B)).clientId;
      await B.reload();
      await waitPhase(B, "settle");
      var rb = await debugRoom(B);
      assert.strictEqual(rb.clientId, bClient, "client id persisted");
      assert.strictEqual(rb.seats.p1, bClient, "seat kept after reload");
    }

    assert.strictEqual(await B.locator("#ts-btn-next-target").count(), 0, "only host advances");
    await A.click("#ts-btn-next-target");
    await Promise.all([A, B, C].map(function (d) { return waitPhase(d, round === 2 ? "final" : "reveal_target"); }));
  }

  // ---- 三台裝置的 state 完全一致 ----
  var sa = await debugState(A), sb = await debugState(B), sc = await debugState(C);
  assert.deepStrictEqual(sb, sa);
  assert.deepStrictEqual(sc, sa);
  assert.strictEqual(sa.players.reduce(function (a, p) { return a + p.chips; }, 0), 3000, "chips conserved");
  for (var d in deviceOf) assert.strictEqual(await deviceOf[d].locator("#ts-final-table tr").count(), 4);

  assert.deepStrictEqual(errors.filter(function (e) { return e.indexOf("favicon") < 0; }), []);
  await browser.close();
  console.log("toushou multi_device_check: OK");
})().catch(async function (err) {
  console.error(err);
  // 失敗時輸出各裝置的狀態，方便判斷是哪一台卡住
  for (var i = 0; i < DEVICES.length; i++) {
    var d = DEVICES[i];
    try {
      var info = await d.page.evaluate(function () {
        var s = window.PriTestToushou._debugState();
        var e = document.getElementById("ts-game-error");
        return { round: s && s.history.length, chips: s && s.players.map(function (p) { return p.chips; }), amt: (document.getElementById("ts-bet-amount") || {}).value, phase: s && s.phase, bets: s && s.current && Object.keys(s.current.bets), error: e && e.textContent,
          wait: Array.prototype.map.call(document.querySelectorAll(".ts-wait-text"), function (n) { return n.textContent; }) };
      });
      console.error(d.label, JSON.stringify(info));
    } catch (e2) { console.error(d.label, "unavailable", String(e2)); }
  }
  console.error("errors:", JSON.stringify(ERRORS));
  process.exit(1);
});
