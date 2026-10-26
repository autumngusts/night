// ============================================================================
// gousei（合成）連線同步檢查：3 個瀏覽器 context＝主機 A＋手機 B（玩家1）、C（玩家2），
// 走 Firebase Local Emulator，不連真的 Firebase 專案、不觸發 App Check。
// 規則依據：docs/gousei_game_design.md §4.1（連線同步）
//
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8943 --directory dist
//   3. （repo 根目錄）tools/midnight_check/node_modules/.bin/firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node tools/gousei_check/multi_device_check.js
//
// 流程：A 開分別裝置＋連線同步 → B、C 掃各自的 QR 網址 → 只有輪到的手機能合成、其他裝置顯示結果 →
// 主機替人操作 → 同一回合兩台同時按合成只成立一次 → 已知廢料提示與清除廢料同步 → 復原只有主機 →
// 重新整理回到房間 → 主機開新遊戲後手機顯示「這局已結束」；途中比對三台 state 一致。
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.GOUSEI_BASE || "http://localhost:8943/gousei/index.html";
var TIMEOUT = 20000;

function debugState(page) { return page.evaluate(function () { return window.PriTestGousei._debugState(); }); }

function waitLog(page, n) {
  return page.waitForFunction(function (k) {
    var s = window.PriTestGousei && window.PriTestGousei._debugState();
    return !!s && s.log.length === k;
  }, n, { timeout: TIMEOUT });
}

async function newDevice(browser, errors, label) {
  var context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await context.addInitScript(function () {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
      window.localStorage.setItem("pritest-lang", "zh");
    } catch (e) { /* 忽略 */ }
  });
  var page = await context.newPage();
  page.on("pageerror", function (e) { errors.push(label + ": " + String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(label + " console: " + m.text()); });
  return page;
}

async function pick(page, a, b) {
  await page.click('#gs-pool-list button[data-item="' + a + '"]');
  await page.click('#gs-pool-list button[data-item="' + b + '"]');
}

// 三台都看到第 n 筆紀錄的結果畫面後，各自按「下一位」收起
async function seeResultAndDismiss(pages, n) {
  for (var i = 0; i < pages.length; i++) {
    await waitLog(pages[i], n);
    await pages[i].waitForSelector("#gs-result", { timeout: TIMEOUT });
    await pages[i].click("#gs-next");
  }
}

async function assertSameState(pages, label) {
  var base = JSON.stringify(await debugState(pages[0]));
  for (var i = 1; i < pages.length; i++) {
    assert.strictEqual(JSON.stringify(await debugState(pages[i])), base, label + "：第 " + (i + 1) + " 台 state 不一致");
  }
}

(async function main() {
  var browser = await chromium.launch();
  var errors = [];
  var A = await newDevice(browser, errors, "A");
  var B = await newDevice(browser, errors, "B");
  var C = await newDevice(browser, errors, "C");
  var all = [A, B, C];

  // ---- A：分別裝置＋連線同步 ----
  await A.goto(BASE);
  await A.evaluate(function () { localStorage.clear(); });
  await A.reload();
  assert.strictEqual(await A.locator("#gs-online").count(), 0, "同一裝置模式不顯示連線選項");
  await A.check('input[name=gs-theme][value="wuxia"]');
  await A.check('input[name=gs-mode][value="split"]');
  await A.check("#gs-online");
  await A.click("#gs-start");
  await A.waitForSelector("#gs-qr-screen", { timeout: TIMEOUT });
  var room = await A.evaluate(function () { return window.PriTestGousei._debugRoom(); });
  assert.ok(/^g[0-9a-f]{32}$/.test(room.id) && room.hostId === room.clientId && room.me === null, "A 是主機");
  var urls = [];
  for (var i = 0; i < 2; i++) {
    await A.click('button[data-qr-player="' + i + '"]');
    await A.waitForSelector("#gs-qr-url");
    urls.push(await A.inputValue("#gs-qr-url"));
  }
  urls.forEach(function (u) { assert.ok(u.indexOf("&room=" + room.id) >= 0, "QR 網址帶房間：" + u); });
  await A.click("#gs-qr-continue");

  // ---- B、C 加入 ----
  await B.goto(urls[0]);
  await C.goto(urls[1]);
  await B.waitForSelector("#gs-my-targets", { timeout: TIMEOUT });
  await C.waitForSelector("#gs-my-targets", { timeout: TIMEOUT });
  assert.ok((await B.textContent("#gs-my-targets")).indexOf("玩家1") >= 0);
  assert.ok((await B.textContent("#gs-my-targets")).indexOf("輪到你了") >= 0, "B 先手");
  assert.strictEqual(await C.locator("#gs-combine").count(), 0, "C 不是自己的回合：沒有合成鍵");
  assert.ok((await C.textContent("#gs-wait")).indexOf("玩家1") >= 0);
  await C.click('#gs-pool-list button[data-item="metal"]');
  assert.strictEqual(await C.locator(".gs-slot.gs-filled").count(), 0, "不是自己的回合不能選材料");
  assert.strictEqual(await B.locator("#gs-undo, #gs-new-game, #gs-show-qr, #gs-voice").count(), 0, "手機沒有復原／新遊戲／QR／語音");
  await B.click("#gs-join-toggle");
  var st = await debugState(B);
  assert.strictEqual(await B.locator("#gs-join-targets li").count(), st.players[0].targets.length, "手機看得到自己的任務");

  // ---- B 合成 → 三台都顯示結果 ----
  await pick(B, "metal", "fire");
  await B.click("#gs-combine");
  await seeResultAndDismiss(all, 1);
  await assertSameState(all, "B 合成後");
  assert.ok((await C.textContent("#gs-my-targets")).indexOf("輪到你了") >= 0, "換 C");

  // ---- C 合成 ----
  await pick(C, "water", "water");
  await C.click("#gs-combine");
  await seeResultAndDismiss(all, 2);

  // ---- 主機替 B 操作 ----
  await pick(A, "wood", "earth");
  await A.click("#gs-combine");
  await seeResultAndDismiss(all, 3);
  st = await debugState(B);
  assert.strictEqual(st.log[2].playerId, "p1", "主機替輪到的玩家合成");

  // ---- 同一回合兩台同時按合成：只成立一次 ----
  await pick(A, "metal", "metal");
  await pick(C, "earth", "earth");
  // page.click 會等元素穩定，先成立的一台會讓另一台重畫；直接在頁面內觸發才是真的同時送出
  function clickNow(page) { return page.evaluate(function () { document.getElementById("gs-combine").click(); }); }
  await Promise.all([clickNow(A), clickNow(C)]);
  await waitLog(A, 4);
  await A.waitForTimeout(1500);
  for (var d = 0; d < all.length; d++) assert.strictEqual((await debugState(all[d])).log.length, 4, "同時操作只成立一次");
  await assertSameState(all, "同時操作後");
  for (d = 0; d < all.length; d++) if (await all[d].locator("#gs-next").count()) await all[d].click("#gs-next");

  // ---- 已知廢料：B 合出廢料 → C 合同一組先提示 → 清除廢料同步 ----
  var junkPair = await B.evaluate(function () {
    var th = window.PriTestGousei._theme(), pool = window.PriTestGousei._debugState().pool;
    for (var i = 0; i < pool.length; i++) for (var j = i + 1; j < pool.length; j++) {
      var k = pool[i] <= pool[j] ? pool[i] + "|" + pool[j] : pool[j] + "|" + pool[i];
      if (!th.recipes[k] && !th.junkSet[pool[i]] && !th.junkSet[pool[j]]) return [pool[i], pool[j]];
    }
    return null;
  });
  assert.ok(junkPair, "要有無配方的組合");
  st = await debugState(B);
  var turnPage = st.turn === 0 ? B : C;
  var otherPage = st.turn === 0 ? C : B;
  await pick(turnPage, junkPair[0], junkPair[1]);
  await turnPage.click("#gs-combine");
  await seeResultAndDismiss(all, 5);
  await pick(otherPage, junkPair[1], junkPair[0]);
  await otherPage.click("#gs-combine");
  await otherPage.waitForSelector("#gs-junk-warn");
  await otherPage.click("#gs-junk-warn-cancel");
  await A.waitForSelector("#gs-clear-junk");
  await A.click("#gs-clear-junk");
  for (d = 0; d < all.length; d++) {
    await all[d].waitForFunction(function () {
      var th = window.PriTestGousei._theme();
      return window.PriTestGousei._debugState().pool.every(function (id) { return !th.junkSet[id]; });
    }, null, { timeout: TIMEOUT });
  }
  await assertSameState(all, "清除廢料後");
  assert.strictEqual((await debugState(A)).log.length, 5, "清除廢料不算回合");

  // ---- 重新整理：主機與手機都回到房間 ----
  await A.reload();
  await B.reload();
  await A.waitForSelector("#gs-pool", { timeout: TIMEOUT });
  await B.waitForSelector("#gs-my-targets", { timeout: TIMEOUT });
  await waitLog(A, 5);
  await waitLog(B, 5);
  await assertSameState(all, "重新整理後");

  // ---- 復原（只有主機）→ 手機同步 ----
  await A.click("#gs-undo");
  await waitLog(B, 4);
  await waitLog(C, 4);

  // ---- 主機開新遊戲 → 房間結束 ----
  await A.click("#gs-new-game");
  await A.click("#gs-new-game");
  await A.waitForSelector("#gs-start");
  assert.strictEqual(await A.evaluate(function () { return window.PriTestGousei._debugRoom(); }), null, "主機離開房間");
  await B.waitForFunction(function () {
    var n = document.getElementById("gs-online-status");
    return n && n.textContent.indexOf("已結束") >= 0;
  }, null, { timeout: TIMEOUT });
  await A.reload();
  await A.waitForSelector("#gs-start");

  assert.deepStrictEqual(errors, [], "頁面不應有 JS 錯誤");
  await browser.close();
  console.log("gousei multi_device_check OK");
})().catch(function (e) { console.error(e); process.exit(1); });
