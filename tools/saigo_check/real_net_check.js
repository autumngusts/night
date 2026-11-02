// ============================================================================
// 賽狗賽狗（saigo）真賽狗的多裝置連線檢查（2026-11-02）：Firebase emulator 上 2 個瀏覽器
//   房主 A 派 1 隻、玩家 B 派 2 隻 → 房主切換成真賽狗並發佈 → 出走表 8 隻（A 1 隻＋B 2 隻＋NPC 5 隻）
//   → 開跑 → B 對自己的兩隻狗喊「賽狗」 → A 收到後重新模擬、名次與時間一致 → 結算：B 的 2 隻狗都有獎金
// 前置與執行同 net_check.js（node tools/saigo_check/real_net_check.js）
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.SAIGO_BASE || "http://localhost:8947/saigo/index.html";
var SHOT_DIR = path.join(__dirname, "shots");

async function newPage(browser, label, name, kennel) {
  var ctx = await browser.newContext({ viewport: { width: 1100, height: 860 } });
  // 連不到 gstatic 的環境：FIREBASE_SDK_DIR＝npm 的 firebase@10.14.1 套件目錄，改由本機提供同版本 SDK
  if (process.env.FIREBASE_SDK_DIR) await ctx.route("https://www.gstatic.com/firebasejs/**", function (r) { r.fulfill({ path: path.join(process.env.FIREBASE_SDK_DIR, r.request().url().split("/").pop()), contentType: "application/javascript" }); });
  await ctx.addInitScript(function (a) {
    try {
      sessionStorage.setItem("pritestRtdbEmulator", "1");
      if (!sessionStorage.getItem("sg-init")) {
        sessionStorage.setItem("sg-init", "1");
        localStorage.setItem("pritest-saigo-name", a.name);
        localStorage.setItem("pritest-lang", "zh");
        localStorage.setItem("pritest-saigo-pref", JSON.stringify({ no3d: true }));
        if (a.kennel) localStorage.setItem("pritest-saigo-kennel", JSON.stringify(a.kennel));
      }
    } catch (e) { /* 測試環境 */ }
  }, { name: name, kennel: kennel || null });
  var page = await ctx.newPage();
  page.label = label;
  page.errors = [];
  page.on("pageerror", function (e) { page.errors.push(label + ": " + e); });
  page.on("console", function (m) { if (m.type() === "error") page.errors.push(label + ": " + m.text()); });
  return page;
}
function ev(page, fn, arg) { return page.evaluate(fn, arg); }
function screen(page) { return ev(page, function () { return window.PriTestSaigo.ui.screen; }); }
async function until(page, fn, arg, ms, what) {
  var end = Date.now() + (ms || 15000);
  while (Date.now() < end) {
    if (await ev(page, fn, arg)) return;
    await page.waitForTimeout(150);
  }
  throw new Error(page.label + " 等不到：" + what);
}
// 連線房間的下注改用房間籌碼（2026-10-31 管理面板改版；舊版看的是犬舍錢包 Kennel.coins()）
function coins(page) { return ev(page, function () { return window.PriTestSaigo.ui.room.coins(); }); }
function kennelCoins(page) { return ev(page, function () { return window.PriTestSaigoKennel.coins(); }); }

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch();
  var stats = { races: 0, bets: 0, spent: 0, won: 0, bailouts: 0 };
  var aKennel = { v: 1, coins: 5000, dogs: [{ id: "d1", breed: "greyhound", name: "飛影", lv: 2, exp: 0, train: { spd: 6, sta: 4, pow: 0, agi: 0, jmp: 0, swm: 0, cat: 0, foc: 0 }, fatigue: 0, mood: 2, bond: 10, races: 0, wins: 0, top3: 0, earnings: 0, skills: ["g_allout"], line: "mid" }], nextId: 2, at: Date.now(), stats: stats, history: [] };
  var bKennel = { v: 1, coins: 5000, dogs: [{ id: "d1", breed: "border", name: "閃電", lv: 2, exp: 0, train: { spd: 6, sta: 4, pow: 0, agi: 0, jmp: 0, swm: 0, cat: 0, foc: 0 }, fatigue: 0, mood: 2, bond: 10, races: 0, wins: 0, top3: 0, earnings: 0, skills: ["g_allout"], line: "mid" }, { id: "d2", breed: "whippet", name: "疾風", lv: 2, exp: 0, train: { spd: 6, sta: 4, pow: 0, agi: 0, jmp: 0, swm: 0, cat: 0, foc: 0 }, fatigue: 0, mood: 2, bond: 10, races: 0, wins: 0, top3: 0, earnings: 0, skills: ["g_allout"], line: "mid" }], nextId: 3, at: Date.now(), stats: stats, history: [] };
  var A = await newPage(browser, "A", "房主A", aKennel);
  var B = await newPage(browser, "B", "玩家B", bKennel);
  await A.goto(BASE);
  await A.waitForSelector(".sg-menu");
  await ev(A, function () { window.PriTestSaigo.enterRoom(null); });
  await until(A, function () { var r = window.PriTestSaigo.ui.room; return r && r.loaded && r.isHost(); }, null, 15000, "建房");
  var url = await ev(A, function () { return location.href; });
  // 房主切換成真賽狗
  await until(A, function () { return Array.prototype.some.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.indexOf("真賽狗") >= 0; }); }, null, 10000, "大廳畫好");
  await ev(A, function () { Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.indexOf("真賽狗") >= 0; })[0].click(); });
  await until(A, function () { return window.PriTestSaigo.ui.room.cfg.mode === "real"; }, null, 10000, "設定真賽狗");
  await B.goto(url);
  await until(B, function () { var u = window.PriTestSaigo.ui; return u.room && u.room.loaded && u.screen === "lobby" && u.mode === "real"; }, null, 15000, "B 進大廳（真賽狗）");
  // 各自勾選出賽的狗
  async function checkAll(P) {
    var n = await P.$$eval(".sg-entry-chk input", function (x) { return x.length; });
    for (var i = 0; i < n; i++) { await ev(P, function (k) { var b = document.querySelectorAll(".sg-entry-chk input")[k]; if (!b.checked) b.click(); }, i); await P.waitForTimeout(200); }
  }
  await checkAll(A); await checkAll(B);
  await until(A, function () { return window.PriTestSaigo.ui.room.list().some(function (p) { return p.name === "玩家B" && p.entries.length === 2; }); }, null, 10000, "看到 B 的 2 隻狗");
  await ev(A, function () { Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.indexOf("發佈出賽表") >= 0; })[0].click(); });
  await until(A, function () { return window.PriTestSaigo.ui.screen === "card"; }, null, 10000, "A 出賽表");
  await until(B, function () { return window.PriTestSaigo.ui.screen === "card"; }, null, 10000, "B 出賽表");
  var card = await ev(B, function () { var c = window.PriTestSaigo.ui.card, cid = window.PriTestSaigo.ui.room.cid; return { mode: c.mode, n: c.dogs.length, mineB: c.dogs.filter(function (d) { return d.owner === cid; }).length, npc: c.dogs.filter(function (d) { return d.cpu; }).length }; });
  assert.deepStrictEqual(card, { mode: "real", n: 8, mineB: 2, npc: 5 }, "出走表 8 隻：B 2 隻、NPC 5 隻");
  // B 準備、A 開跑
  await ev(B, function () { Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.indexOf("準備好了") >= 0; })[0].click(); });
  await until(A, function () { return window.PriTestSaigo.ui.room.list().every(function (p) { return p.ready || p.cid === window.PriTestSaigo.ui.room.cid; }); }, null, 10000, "B 準備");
  await ev(A, function () { Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.trim() === "開跑！" && !x.disabled; })[0].click(); });
  await until(B, function () { return window.PriTestSaigo.ui.screen === "race"; }, null, 10000, "B 比賽");
  await until(B, function () { var t = window.PriTestSaigo.ui.room.raceTime(); return t !== null && t > 2; }, null, 15000, "開跑 2 秒");
  // B 對兩隻狗各喊一次「賽狗」（比賽中不能改跑法，只有喊聲）
  var sent = await ev(B, function () { var P = window.PriTestSaigo, u = P.ui; return P.sendShout(u.ctlDog, u.room.raceTime()); });
  assert.ok(sent, "B 喊聲送出");
  await ev(B, function () { document.querySelectorAll(".sg-ctl-tabs button")[1].click(); });
  await B.waitForTimeout(200);
  assert.ok(await ev(B, function () { var P = window.PriTestSaigo, u = P.ui; return P.sendShout(u.ctlDog, u.room.raceTime()); }), "B 對第二隻喊聲");
  var bCmd = await ev(B, function () { return JSON.stringify(window.PriTestSaigo.ui.result.cmds); });
  assert.strictEqual(JSON.parse(bCmd).length, 2, "兩個喊聲指令");
  await until(A, function (c) { return JSON.stringify(window.PriTestSaigo.ui.result.cmds) === c; }, bCmd, 10000, "A 收到 B 的指令");
  var res = await Promise.all([A, B].map(function (p) { return ev(p, function () { var r = window.PriTestSaigo.ui.result; return JSON.stringify({ o: r.order, t: r.times }); }); }));
  assert.strictEqual(res[0], res[1], "A／B 結果一致");
  var dur = await ev(A, function () { return window.PriTestSaigo.ui.result.duration; });
  await until(B, function () { return window.PriTestSaigo.ui.screen === "result"; }, null, (dur + 15) * 1000, "B 結果");
  assert.strictEqual(await ev(B, function () { return window.PriTestSaigo.ui.dogRewards.length; }), 2, "B 的 2 隻狗都結算");
  assert.strictEqual(await ev(A, function () { return window.PriTestSaigo.ui.dogRewards.length; }), 1, "A 的 1 隻狗結算");
  var errs = A.errors.concat(B.errors);
  assert.deepStrictEqual(errs, [], "console 錯誤：\n" + errs.join("\n"));
  console.log("saigo real_net_check OK");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
