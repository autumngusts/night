// ============================================================================
// 黃牌 Yellow Card 連線房間補強檢查（2026-10-27）：Firebase emulator 上 3 個瀏覽器（房主 A＋B＋旁觀的 C）
//   大廳座位的英雄等級／出發遺物要帶進對局（原本同步時被丟掉）
//   → 房內聊天雙向收到 → 連線每日挑戰（英雄依當天固定、和本機同一局）
//   → 催促（被催的人看到提示）→ 第二局（上一局流水號很大）也有敵人回合重播 → 房主斷線時的排隊寫入不能蓋掉新房主的狀態
//   → B 離開後，沒有英雄的 C 接手 B 的英雄 → 每日挑戰成績每台裝置都有記
// 前置：同 net_check.js（generate、http.server 8945、emulator database＋auth）
// 執行：node tools/yellow_check/net2_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.YELLOW_BASE || "http://localhost:8945/yellow/index.html";
var DAY = "2026-10-27";

async function newPlayer(browser, label, name) {
  var ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.addInitScript(function (n) {
    try { sessionStorage.setItem("pritestRtdbEmulator", "1"); localStorage.setItem("pritest-yellow-netname", n); localStorage.setItem("pritest-lang", "zh"); } catch (e) { /* 測試環境 */ }
  }, name);
  var page = await ctx.newPage();
  page.ctx = ctx;
  page.label = label;
  page.errors = [];
  page.on("pageerror", function (e) { page.errors.push(label + ": " + e); });
  page.on("console", function (m) { if (m.type() === "error" && !/favicon/.test(m.text())) page.errors.push(label + " console: " + m.text()); });
  return page;
}
function game(page) { return page.evaluate(function () { return window.PriTestYellow.state(); }); }
function cidOf(page) { return page.evaluate(function () { return window.PriTestYellow.room().cid; }); }
async function waitFor(page, fn, arg, what, ms) {
  try { await page.waitForFunction(fn, arg, { timeout: ms || 15000 }); }
  catch (e) { throw new Error(page.label + " 等待逾時：" + what); }
}

(async function () {
  var browser = await chromium.launch();
  var A = await newPlayer(browser, "A", "房主阿光");
  var B = await newPlayer(browser, "B", "小貝");
  var C = await newPlayer(browser, "C", "西西");

  await A.goto(BASE);
  await A.evaluate(function () {
    Array.prototype.filter.call(document.querySelectorAll("button"), function (x) { return x.textContent.trim() === window.I18N.t("yc_net_create"); })[0].click();
  });
  await waitFor(A, function () { var r = window.PriTestYellow.room(); return r && r.loaded && r.isHost(); }, null, "建房");
  var url = BASE + "?room=" + (await A.evaluate(function () { return window.PriTestYellow.room().id; }));
  await B.goto(url);
  await C.goto(url);
  await waitFor(A, function () { return Object.keys(window.PriTestYellow.room().online).length === 3; }, null, "三人在線");

  // ---- 1. 座位的英雄等級與出發遺物要帶進對局 ----
  var art = await A.evaluate(function () { return window.PriTestYellowData.STARTERS[0].id; });
  await A.evaluate(function (a) { window.PriTestYellow.room().takeSeat(0, "paladin", { lv: 2, art: a }); }, art);
  await B.evaluate(function () { window.PriTestYellow.room().takeSeat(1, "mage", { lv: 0 }); });
  await waitFor(B, function () { var s = window.PriTestYellow.room().seats; return s[0] && s[0].lv === 2 && s[1]; }, null, "看到座位的等級");
  await A.evaluate(function () { window.PriTestYellow.room().start(); });
  for (var p of [A, B]) await waitFor(p, function () { var g = window.PriTestYellow.state(); return g && g.phase === "map"; }, null, "收到對局");
  var g1 = await game(B);
  assert.strictEqual(g1.heroes[0].lv, 2, "英雄等級帶進對局（原本同步時被丟掉，一律 99）");
  assert.strictEqual(g1.heroes[1].lv, 0, "B 的英雄等級帶進對局");
  assert.ok(g1.heroes[0].relics.indexOf(art) >= 0, "出發遺物帶進對局");

  // ---- 2. 聊天：B 說話，A 的聊天框與浮出提示都看得到；A 回話 B 也收到 ----
  await B.evaluate(function () { window.PriTestYellow.room().chat("哈囉大家"); });
  await waitFor(A, function () { var l = document.querySelector(".yc-chat-list"); return l && l.innerText.indexOf("哈囉大家") >= 0; }, null, "A 的聊天框收到");
  assert.ok(await A.evaluate(function () { return Array.prototype.some.call(document.querySelectorAll(".yc-toast"), function (x) { return x.textContent.indexOf("哈囉大家") >= 0; }); }), "A 看到浮出的訊息");
  await A.evaluate(function () { var b = Array.prototype.filter.call(document.querySelectorAll(".yc-chat-quick button"), function (x) { return x.textContent === window.I18N.t("yc_q_ok"); })[0]; b.click(); });
  await waitFor(B, function () { return window.PriTestYellow.room().chats.some(function (m) { return m.t === window.I18N.t("yc_q_ok"); }); }, null, "B 收到快速短句");
  // 聊天框打字中，別人的操作也要更新畫面，而且輸入框的焦點與內容留著（2026-10-27 修正：原本聊天框有焦點時整個畫面停住）
  await B.focus(".yc-chat-input");
  await B.keyboard.type("打到一半");
  var openBefore = await B.evaluate(function () { return document.querySelectorAll(".yc-dest-open").length; });
  await A.evaluate(function () { window.PriTestYellow.room().send({ t: "dest", s: 0, i: 0 }); });
  await waitFor(B, function (n) { return document.querySelectorAll(".yc-dest-open").length < n; }, openBefore, "B 打字中畫面也更新");
  var keep = await B.evaluate(function () { var e = document.activeElement; return { focus: !!(e && e.classList.contains("yc-chat-input")), v: e && e.value }; });
  assert.ok(keep.focus && keep.v === "打到一半", "重畫後聊天框的焦點與內容要留著：" + JSON.stringify(keep));

  // ---- 3. 連線每日挑戰：英雄依當天固定，和本機同人數的開局是同一局 ----
  // 第一局的紀錄流水號墊高（實際玩過一局就會這麼大），第二局才測得出「沿用上一局的已讀流水號」
  await A.evaluate(function () { var r = window.PriTestYellow.room(); r.game.logSeq = 5000; r.republish(); });
  await waitFor(B, function () { return window.PriTestYellow.state().logSeq === 5000; }, null, "B 收到第一局的流水號");
  await A.evaluate(function () { window.PriTestYellow.room().backToLobby(); });
  await waitFor(B, function () { var r = window.PriTestYellow.room(); return r.meta.status === "lobby"; }, null, "回到大廳");
  await B.evaluate(function () { window.PriTestYellow.room().setOpts({ daily: true }); });
  await A.waitForTimeout(500);
  assert.strictEqual(await A.evaluate(function () { return window.PriTestYellow.room().opts.daily; }), false, "非房主不能開每日挑戰");
  await A.evaluate(function () { window.PriTestYellow.room().setOpts({ torment: 0, endless: false, daily: true }); });
  await waitFor(B, function () { return window.PriTestYellow.room().opts.daily && document.querySelectorAll(".yc-daily-seat").length === 2; }, null, "B 看到每日挑戰與座位的今日英雄");
  await A.evaluate(function (d) { window.PriTestYellow.room().start(d); }, DAY);
  for (var p2 of [A, B]) await waitFor(p2, function (d) { var g = window.PriTestYellow.state(); return g && g.daily === d && g.phase === "map"; }, DAY, "收到每日挑戰");
  var cmp = await B.evaluate(function (d) {
    var C2 = window.PriTestYellowCore, g = window.PriTestYellow.state(), loc = C2.createDaily(d, 2);
    function core(x) { return JSON.stringify({ seed: x.seed, tmods: x.tmods, secs: x.secs, heroes: x.heroes.map(function (h) { return h && { cls: h.cls, deck: h.deck, hp: h.hp, dests: h.dests }; }) }); }
    return { same: core(g) === core(loc), ctrl: g.heroes.filter(Boolean).map(function (h) { return h.ctrl; }), host: g.hostCtrl };
  }, DAY);
  assert.ok(cmp.same, "連線每日挑戰和本機同人數的開局要相同");
  var ca = await cidOf(A), cb = await cidOf(B);
  assert.deepStrictEqual(cmp.ctrl.slice().sort(), [ca, cb].sort(), "兩位英雄分別由 A、B 操作");
  assert.strictEqual(cmp.host, ca, "房主是 A");

  // ---- 4. 催促：A 催 B，B 看到提示 ----
  await A.evaluate(function (c) { window.PriTestYellow.room().nudge(c); }, cb);
  await waitFor(B, function () { return !!document.querySelector(".yc-toast-nudge"); }, null, "B 看到被催促");

  // ---- 5. 同一個房間的第二局也要有敵人回合重播（2026-10-27 修正：原本沿用上一局的已讀流水號）----
  var heroes2 = (await game(A)).heroes.filter(Boolean);
  for (var hh of heroes2) await (hh.ctrl === ca ? A : B).evaluate(function (s) { window.PriTestYellow.room().send({ t: "dest", s: s, i: 0 }); }, hh.seat);
  for (var p3 of [A, B]) await waitFor(p3, function () { var g = window.PriTestYellow.state(); return g && g.phase === "battle"; }, null, "第二局進入戰鬥");
  await B.waitForTimeout(3000);
  await B.evaluate(function () { window.__sawReplay = false; setInterval(function () { if (window.PriTestYellow.replaying()) window.__sawReplay = true; }, 50); });
  for (var hh2 of heroes2) await (hh2.ctrl === ca ? A : B).evaluate(function (s) { window.PriTestYellow.room().send({ t: "end", s: s }); }, hh2.seat);
  await waitFor(B, function () { return window.__sawReplay; }, null, "第二局的敵人回合有重播");
  for (var p4 of [A, B]) await waitFor(p4, function () { return !window.PriTestYellow.replaying(); }, null, "重播結束", 30000);

  // ---- 6. 房主斷線時還在操作：重新連上後，舊房主排隊的寫入不能蓋掉新房主的狀態 ----
  var st6 = await game(A);
  if (st6.phase === "battle") {
    var aSeat = st6.heroes.filter(Boolean).filter(function (h) { return h.ctrl === ca; })[0].seat;
    var bSeat6 = st6.heroes.filter(Boolean).filter(function (h) { return h.ctrl === cb; })[0].seat;
    await A.evaluate(function () { window.firebase.database().goOffline(); });
    await waitFor(B, function (c) { var r = window.PriTestYellow.room(); return r.meta && r.meta.host === c; }, cb, "B 接手房主", 30000);
    // A 不知道自己斷線了，還在操作（Firebase 會把寫入排隊）
    await A.evaluate(function (s) { window.PriTestYellow.room().send({ t: "end", s: s }); }, aSeat);
    // 新房主 B 也操作一次
    await B.evaluate(function (s) { window.PriTestYellow.room().send({ t: "end", s: s }); }, bSeat6);
    await waitFor(C, function (s) { var g = window.PriTestYellow.state(); return g && g.heroes[s].done; }, bSeat6, "C 收到新房主的狀態");
    await A.evaluate(function () { window.firebase.database().goOnline(); });
    await A.waitForTimeout(4000);
    var after6 = await C.evaluate(function (x) { var g = window.PriTestYellow.state(); return { a: g.heroes[x.a].done, b: g.heroes[x.b].done }; }, { a: aSeat, b: bSeat6 });
    assert.ok(after6.b && !after6.a, "舊房主斷線時的操作不能蓋掉新房主的狀態：" + JSON.stringify(after6));
    await waitFor(A, function (x) { var g = window.PriTestYellow.state(); return g && g.heroes[x.b].done && !g.heroes[x.a].done; }, { a: aSeat, b: bSeat6 }, "A 重新連上後跟上新房主的狀態");
  } else console.log("（第二局第一回合就結束了，略過斷線檢查）");

  // ---- 7. 換裝置接回：B 離開，沒有英雄的 C 接手 B 的英雄 ----
  var bSeat = (await game(A)).heroes.filter(Boolean).filter(function (h) { return h.ctrl === cb; })[0].seat;
  assert.strictEqual(await C.evaluate(function (s) { return window.PriTestYellow.room().canClaim(s); }, bSeat), false, "B 還在線時不能接手");
  await B.ctx.close();
  await waitFor(C, function (c) { return !window.PriTestYellow.room().online[c]; }, cb, "C 看到 B 離線", 30000);
  await waitFor(C, function (s) { return window.PriTestYellow.room().canClaim(s); }, bSeat, "C 可以接手 B 的英雄", 30000);
  // 畫面：切到 B 的英雄分頁，按「接手這位英雄」
  var clicked = await C.evaluate(function (s) {
    var hs = window.PriTestYellowCore.heroes(window.PriTestYellow.state());
    var tabs = document.querySelectorAll(".yc-tab");
    if (!tabs.length) { window.PriTestYellow.room().send({ t: "claim", s: s }); return false; }
    tabs[hs.map(function (h) { return h.seat; }).indexOf(s)].click();
    return true;
  }, bSeat);
  if (clicked) {
    await C.waitForTimeout(300);
    await C.evaluate(function () {
      var b = Array.prototype.filter.call(document.querySelectorAll("button"), function (x) { return x.textContent.trim() === window.I18N.t("yc_claim"); })[0];
      b.click();
    });
  }
  var cc = await cidOf(C);
  await waitFor(A, function (x) { var h = window.PriTestYellow.state().heroes[x.s]; return h && h.ctrl === x.c && h.owner === x.c; }, { s: bSeat, c: cc }, "C 接手 B 的英雄");
  assert.strictEqual(await A.evaluate(function (s) { return window.PriTestYellow.room().canClaim(s); }, bSeat), false, "已經有英雄的人不能接手");

  // ---- 8. 連線每日挑戰的成績：每台裝置都要記（2026-10-27 修正：原本房主畫面改的旗標跟著狀態傳出去，其他人不記）----
  await waitFor(A, function () { return window.PriTestYellow.room().isHost(); }, null, "A 再接手房主", 30000);
  await A.evaluate(function () { var r = window.PriTestYellow.room(); r.game.phase = "lose"; r.republish(); });
  for (var p5 of [A, C]) await waitFor(p5, function (d) { var rec = JSON.parse(localStorage.getItem("pritest-yellow-daily") || "{}"); return !!(rec[d] && rec[d][2]); }, DAY, "每日挑戰成績有記錄");
  assert.ok(await C.evaluate(function () { return !!document.querySelector(".yc-daily-share"); }), "非房主也看得到分享文字");

  await browser.close();
  var errs = A.errors.concat(C.errors).concat(B.errors.filter(function (x) { return !/Target page|closed/.test(x); }));
  assert.deepStrictEqual(errs, [], "JS 錯誤：" + errs.join(" | "));
  console.log("OK");
})().catch(function (e) { console.error(e); process.exit(1); });
