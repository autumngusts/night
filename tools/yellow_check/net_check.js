// ============================================================================
// 黃牌 Yellow Card 連線房間檢查：Firebase emulator 上 3 個瀏覽器（房主＋2 人）
//   建房 → 加入 → 各自選角落與職業（搶同一個位置要失敗）→ 開始 → 地圖投票（全員投完才前進）
//   → 戰鬥中各自出牌（不能操作別人的英雄）→ 全員結束回合後敵人行動 → 三邊狀態一致
//   → 有人離線後房主「由我代打」接手 → 房主離線後由下一個人接手房主繼續
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8945 --directory dist
//   3. Firebase emulator（Database＋Auth，見 firebase.json）：
//        tools/midnight_check/node_modules/.bin/firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node tools/yellow_check/net_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.YELLOW_BASE || "http://localhost:8945/yellow/index.html";

async function newPlayer(browser, label, name) {
  var ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.addInitScript(function (n) {
    try { sessionStorage.setItem("pritestRtdbEmulator", "1"); localStorage.setItem("pritest-yellow-netname", n); localStorage.setItem("pritest-lang", "zh"); } catch (e) { /* 測試環境 */ }
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
    var r = window.PriTestYellow.room();
    if (!r) return null;
    return { id: r.id, cid: r.cid, host: r.meta && r.meta.host, status: r.meta && r.meta.status, seats: r.seats, online: Object.keys(r.online || {}).length };
  });
}
function game(page) { return page.evaluate(function () { return window.PriTestYellow.state(); }); }

async function waitFor(page, fn, arg, what, ms) {
  try { await page.waitForFunction(fn, arg, { timeout: ms || 15000 }); }
  catch (e) { throw new Error(page.label + " 等待逾時：" + what); }
}

// 直接呼叫 room（跟按鈕走同一條路徑；畫面點擊另外由 ui_check.js 覆蓋）
function act(page, a) { return page.evaluate(function (x) { return window.PriTestYellow.room().send(x); }, a); }

(async function () {
  var browser = await chromium.launch();
  var A = await newPlayer(browser, "A", "房主阿光");
  var B = await newPlayer(browser, "B", "小貝");
  var C = await newPlayer(browser, "C", "西西");

  // ---- 建房 ----
  await A.goto(BASE);
  await A.evaluate(function () {
    Array.prototype.filter.call(document.querySelectorAll("button"), function (x) { return x.textContent.trim() === window.I18N.t("yc_net_create"); })[0].click();
  });
  await waitFor(A, function () { var r = window.PriTestYellow.room(); return r && r.loaded && r.isHost(); }, null, "建房");
  var ra = await room(A);
  var url = BASE + "?room=" + ra.id;
  await B.goto(url);
  await C.goto(url);
  for (var p of [B, C]) await waitFor(p, function () { var r = window.PriTestYellow.room(); return r && r.loaded; }, null, "加入");
  await waitFor(A, function () { return Object.keys(window.PriTestYellow.room().online).length === 3; }, null, "三人在線");

  // ---- 選座位：A 左上劍士、B 右上法師、C 先搶 B 的位置（要失敗）再坐左下祭司 ----
  await A.evaluate(function () { window.PriTestYellow.room().takeSeat(0, "paladin"); });
  await B.evaluate(function () { window.PriTestYellow.room().takeSeat(1, "mage"); });
  await waitFor(C, function () { var s = window.PriTestYellow.room().seats; return s[0] && s[1]; }, null, "看到 A、B 坐下");
  await C.evaluate(function () { window.PriTestYellow.room().takeSeat(1, "ranger"); });
  await C.waitForTimeout(800);
  var rc = await room(C);
  assert.strictEqual(rc.seats[1].cls, "mage", "別人坐著的位置不能搶");
  await C.evaluate(function () { window.PriTestYellow.room().takeSeat(2, "priest"); });
  await waitFor(A, function () { var s = window.PriTestYellow.room().seats; return s[0] && s[1] && s[2]; }, null, "三個位置");
  // 大廳畫面：每個角落都要畫出來
  var seatsDrawn = await A.evaluate(function () { return document.querySelectorAll(".yc-lobby .yc-seat").length; });
  assert.strictEqual(seatsDrawn, 4);
  assert.strictEqual(await B.evaluate(function () { return !!document.querySelector(".yc-lobby .yc-primary"); }), false, "非房主沒有開始鈕");

  // ---- 開始 ----
  await A.evaluate(function () { window.PriTestYellow.room().start(); });
  for (var p2 of [A, B, C]) await waitFor(p2, function () { var g = window.PriTestYellow.state(); return g && g.phase === "map"; }, null, "收到對局");
  var g = await game(B);
  assert.strictEqual(g.heroes.filter(Boolean).length, 3);
  assert.strictEqual(g.heroes[1].ctrl, (await room(B)).cid, "B 控制右上");
  assert.strictEqual(g.heroes[0].name, "房主阿光");

  // ---- 地圖投票：A、B 投了還不會前進，C 投完才前進 ----
  await act(A, { t: "vote", i: 0 });
  await act(B, { t: "vote", i: 0 });
  await A.waitForTimeout(800);
  assert.strictEqual((await game(A)).phase, "map", "還有人沒投票不該前進");
  await act(C, { t: "vote", i: 0 });
  for (var p3 of [A, B, C]) await waitFor(p3, function () { var g = window.PriTestYellow.state(); return g && g.phase === "battle"; }, null, "進入戰鬥");

  // ---- 不能操作別人的英雄：B 試著替 A 結束回合（房主會拒絕，狀態不變）----
  await act(B, { t: "end", s: 0 });
  await A.waitForTimeout(800);
  assert.strictEqual((await game(A)).heroes[0].done, false, "B 不能結束 A 的回合");

  // ---- 各自用畫面出一張不需要目標的牌（點兩下），再按結束回合 ----
  async function playSelfCard(page, seat) {
    var before = await game(page);
    var ok = await page.evaluate(function () {
      var cards = Array.prototype.filter.call(document.querySelectorAll(".yc-hand button.yc-card:not(.yc-card-off)"), function (c) { return /護盾/.test(c.textContent) && !/隊友/.test(c.textContent); });
      if (!cards[0]) return false;
      cards[0].click();
      var again = document.querySelector(".yc-card-sel");
      if (again) again.click();
      return true;
    });
    if (!ok) return false;
    await waitFor(page, function (a) { var g = window.PriTestYellow.state(); return g.heroes[a[0]].hand.length < a[1] || g.phase !== "battle"; }, [seat, before.heroes[seat].hand.length], "出牌同步");
    return true;
  }
  var played = 0;
  if (await playSelfCard(A, 0)) played++;
  if (await playSelfCard(B, 1)) played++;
  if (await playSelfCard(C, 2)) played++;
  assert.ok(played >= 2, "至少兩人能出護盾牌");
  var r0 = (await game(A)).round;
  for (var pe of [[A, 0], [B, 1], [C, 2]]) await act(pe[0], { t: "end", s: pe[1] });
  for (var p4 of [A, B, C]) await waitFor(p4, function (r) { var g = window.PriTestYellow.state(); return g.phase !== "battle" || g.round > r; }, r0, "敵人行動後進入下一回合");
  var ga = await game(A), gb = await game(B), gc = await game(C);
  assert.strictEqual(JSON.stringify(ga), JSON.stringify(gb), "A、B 狀態不一致");
  assert.strictEqual(JSON.stringify(ga), JSON.stringify(gc), "A、C 狀態不一致");
  assert.ok(ga.log.some(function (e) { return e.t === "enemyTurn"; }), "應有敵人行動紀錄");

  // ---- C 離線 → 房主代打 C 的英雄 ----
  var cCid = (await room(C)).cid;
  await C.close();
  await waitFor(A, function (c) { return !window.PriTestYellow.room().online[c]; }, cCid, "C 離線");
  await waitFor(A, function () { return !!document.querySelector(".yc-hero .yc-small-btn"); }, null, "代打按鈕出現");
  await A.evaluate(function () { document.querySelector(".yc-hero .yc-small-btn").click(); });
  await waitFor(B, function (c) { var g = window.PriTestYellow.state(); return g.heroes[2].ctrl !== c; }, cCid, "代打同步");
  var aCid = (await room(A)).cid;
  assert.strictEqual((await game(B)).heroes[2].ctrl, aCid);

  // ---- 房主 A 離線 → B 接手房主，還能繼續（結束回合會推進）----
  var gNow = await game(B);
  await A.close();
  await waitFor(B, function () { var r = window.PriTestYellow.room(); return r.isHost() && r.game.hostCtrl === r.cid; }, null, "B 接手房主", 20000);
  var gb2 = await game(B);
  assert.strictEqual(gb2.hostCtrl, (await room(B)).cid, "對局的 hostCtrl 改成 B");
  // B 接手 A、C 的英雄後全部結束回合
  for (var s of [0, 2]) assert.strictEqual(await act(B, { t: "take", s: s }), null);
  var r1 = gNow.round;
  for (var s2 of [0, 1, 2]) {
    var h = (await game(B)).heroes[s2];
    if (h && !h.down && !h.done && (await game(B)).phase === "battle") await act(B, { t: "end", s: s2 });
  }
  var gEnd = await game(B);
  assert.ok(gEnd.phase !== "battle" || gEnd.round > r1, "B 接手後應能推進回合");

  var errs = B.errors;
  assert.deepStrictEqual(errs, [], errs.join("\n"));
  await browser.close();
  console.log("OK");
})().catch(function (e) { console.error(e); process.exit(1); });
