// ============================================================================
// 鐵拳教育（fist）連線房間檢查：Firebase emulator 上 3 個瀏覽器（房主＋2 人）
//   建房 → 加入 → 各自選老師（搶同一個位置要失敗）→ 開始 → 故事畫面「開始上課」
//   → 各自用畫面移動／結束回合（不能操作別人的老師）→ 全員結束後校園階段推進 → 三邊狀態一致
//   → C 離線後房主「由我代打」→ 房主離線後由 B 接手房主繼續
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8946 --directory dist
//   3. Firebase emulator（Database＋Auth，見 firebase.json）：
//        tools/midnight_check/node_modules/.bin/firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node tools/fist_check/net_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.FIST_BASE || "http://localhost:8946/fist/index.html";

async function newPlayer(browser, label, name) {
  var ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.addInitScript(function (n) {
    try { sessionStorage.setItem("pritestRtdbEmulator", "1"); localStorage.setItem("pritest-fist-netname", n); localStorage.setItem("pritest-lang", "zh"); } catch (e) { /* 測試環境 */ }
  }, name);
  var page = await ctx.newPage();
  page.label = label;
  page.errors = [];
  page.on("pageerror", function (e) { page.errors.push(label + ": " + e); });
  page.on("console", function (m) { if (m.type() === "error" && !/favicon/.test(m.text())) page.errors.push(label + " console: " + m.text()); });
  return page;
}

function room(page) {
  return page.evaluate(function () {
    var r = window.PriTestFist.room();
    if (!r) return null;
    return { id: r.id, cid: r.cid, host: r.meta && r.meta.host, status: r.meta && r.meta.status, seats: r.seats };
  });
}
function game(page) { return page.evaluate(function () { return window.PriTestFist.state(); }); }

async function waitFor(page, fn, arg, what, ms) {
  try { await page.waitForFunction(fn, arg, { timeout: ms || 15000 }); }
  catch (e) { throw new Error(page.label + " 等待逾時：" + what); }
}
function act(page, a) { return page.evaluate(function (x) { return window.PriTestFist.room().send(x); }, a); }

// 用畫面移動：切到自己的分頁 → 點自己的老師 → 點第一個可去的格子
async function uiMove(page, seat) {
  await page.evaluate(function (s) {
    var tabs = document.querySelectorAll(".fe-tab");
    var st = window.PriTestFist.state();
    tabs[st.seats.filter(Boolean).map(function (h) { return h.seat; }).indexOf(s)].click();
    // 點一下自己的老師＝進入點格子移動模式（拖曳另由 ui_check.js 覆蓋）
    document.querySelector('[data-u="t' + s + '"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 1, clientY: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, seat);
  await page.waitForTimeout(50);
  return page.evaluate(function () {
    var t = document.querySelector(".fe-tile.fe-target");
    if (!t) return false;
    t.click();
    return t.getAttribute("data-tile");
  });
}

(async function () {
  var browser = await chromium.launch();
  var A = await newPlayer(browser, "A", "阿光老師");
  var B = await newPlayer(browser, "B", "小貝老師");
  var C = await newPlayer(browser, "C", "西西老師");

  await A.goto(BASE);
  await A.evaluate(function () {
    var m = document.querySelector(".fe-mode:not(.fe-mode-main)");
    if (m && !document.querySelector(".fe-seat")) m.click();
  });
  await A.evaluate(function () {
    Array.prototype.filter.call(document.querySelectorAll("button"), function (x) { return x.textContent.trim() === window.I18N.t("fe_net_create"); })[0].click();
  });
  await waitFor(A, function () { var r = window.PriTestFist.room(); return r && r.loaded && r.isHost(); }, null, "建房");
  var url = BASE + "?room=" + (await room(A)).id;
  await B.goto(url);
  await C.goto(url);
  for (var p of [B, C]) await waitFor(p, function () { var r = window.PriTestFist.room(); return r && r.loaded; }, null, "加入");
  await waitFor(A, function () { return Object.keys(window.PriTestFist.room().online).length === 3; }, null, "三人在線");

  // ---- 選老師：A 體育、B 輔導、C 先搶 B 的位置（要失敗）再坐 3 號資訊老師 ----
  await A.evaluate(function () { window.PriTestFist.room().takeSeat(0, "pe"); });
  await B.evaluate(function () { window.PriTestFist.room().takeSeat(1, "counselor"); });
  await waitFor(C, function () { var s = window.PriTestFist.room().seats; return s[0] && s[1]; }, null, "看到 A、B 坐下");
  await C.evaluate(function () { window.PriTestFist.room().takeSeat(1, "it"); });
  await C.waitForTimeout(800);
  assert.strictEqual((await room(C)).seats[1].cls, "counselor", "別人坐著的位置不能搶");
  await C.evaluate(function () { window.PriTestFist.room().takeSeat(2, "it"); });
  await waitFor(A, function () { var s = window.PriTestFist.room().seats; return s[0] && s[1] && s[2]; }, null, "三個位置");
  assert.strictEqual(await A.evaluate(function () { return document.querySelectorAll(".fe-seat").length; }), 4, "大廳畫出 4 個位置");
  assert.strictEqual(await B.evaluate(function () { return !!document.querySelector(".fe-primary"); }), false, "非房主沒有開始鈕");

  // ---- 開始 → 故事 → B 按開始上課 ----
  await A.evaluate(function () { window.PriTestFist.room().start(); });
  for (var p2 of [A, B, C]) await waitFor(p2, function () { var g = window.PriTestFist.state(); return g && g.phase === "story"; }, null, "收到對局");
  var g = await game(B);
  assert.strictEqual(g.seats.filter(Boolean).length, 3);
  assert.strictEqual(g.seats[1].ctrl, (await room(B)).cid, "B 控制 2 號");
  assert.strictEqual(g.seats[0].name, "阿光老師");
  await B.evaluate(function () { document.querySelector('[data-act="go"]').click(); });
  for (var p3 of [A, B, C]) await waitFor(p3, function () { return window.PriTestFist.state().phase === "play"; }, null, "開始上課");

  // ---- 不能操作別人的老師 ----
  await act(B, { t: "end", s: 0 });
  await A.waitForTimeout(800);
  assert.strictEqual((await game(A)).seats[0].done, false, "B 不能結束 A 的回合");
  // C 的畫面上看 A 的分頁，不會有行動按鈕
  var cSeesButtons = await C.evaluate(function () { document.querySelectorAll(".fe-tab")[0].click(); return !!document.querySelector('[data-act="end"]'); });
  assert.strictEqual(cSeesButtons, false, "別人的老師不顯示行動按鈕");

  // ---- 各自用畫面移動一次（不會引起連鎖），再結束回合 ----
  var moved = [];
  for (var pm of [[A, 0], [B, 1], [C, 2]]) {
    var tid = await uiMove(pm[0], pm[1]);
    assert.ok(tid, pm[0].label + " 移動失敗");
    moved.push(tid);
    await waitFor(pm[0], function (a) { var st = window.PriTestFist.state(); return st.log.some(function (e) { return e.k === "move" && e.s === a; }); }, pm[1], "移動同步");
  }
  var r0 = (await game(A)).round;
  for (var pe of [[A, 0], [B, 1], [C, 2]]) await act(pe[0], { t: "end", s: pe[1] });
  for (var p4 of [A, B, C]) await waitFor(p4, function (r) { return window.PriTestFist.state().round > r || window.PriTestFist.state().phase !== "play"; }, r0, "校園階段後進入下一回合");
  var ga = await game(A), gb = await game(B), gc = await game(C);
  assert.strictEqual(JSON.stringify(ga), JSON.stringify(gb), "A、B 狀態不一致");
  assert.strictEqual(JSON.stringify(ga), JSON.stringify(gc), "A、C 狀態不一致");
  assert.ok(ga.log.some(function (e) { return e.k === "school"; }), "應有校園階段紀錄");

  // ---- C 離線 → 房主代打 ----
  var cCid = (await room(C)).cid;
  await C.close();
  await waitFor(A, function (c) { return !window.PriTestFist.room().online[c]; }, cCid, "C 離線");
  await A.evaluate(function () { document.querySelectorAll(".fe-tab")[2].click(); });
  await waitFor(A, function () { return Array.prototype.some.call(document.querySelectorAll(".fe-teacher button"), function (b) { return b.textContent === window.I18N.t("fe_takeover"); }); }, null, "代打按鈕出現");
  await A.evaluate(function () { Array.prototype.filter.call(document.querySelectorAll(".fe-teacher button"), function (b) { return b.textContent === window.I18N.t("fe_takeover"); })[0].click(); });
  var aCid = (await room(A)).cid;
  await waitFor(B, function (c) { return window.PriTestFist.state().seats[2].ctrl === c; }, aCid, "代打同步");

  // ---- 房主 A 離線 → B 接手房主，還能推進回合 ----
  await A.close();
  await waitFor(B, function () { var r = window.PriTestFist.room(); return r.isHost() && r.game.hostCtrl === r.cid; }, null, "B 接手房主", 20000);
  for (var s of [0, 2]) assert.strictEqual(await act(B, { t: "take", s: s }), null);
  var r1 = (await game(B)).round;
  for (var s2 of [0, 1, 2]) {
    var gNow = await game(B);
    var h = gNow.seats[s2];
    if (gNow.phase === "play" && h && !h.down && !h.done) await act(B, { t: "end", s: s2 });
  }
  var gEnd = await game(B);
  assert.ok(gEnd.phase !== "play" || gEnd.round > r1, "B 接手後應能推進回合");

  assert.deepStrictEqual(B.errors, [], B.errors.join("\n"));
  await browser.close();
  console.log("OK net_check");
})().catch(function (e) { console.error(e); process.exit(1); });
