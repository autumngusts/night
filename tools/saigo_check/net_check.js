// ============================================================================
// 賽狗賽狗（saigo）多裝置連線檢查：Firebase emulator 上 3 個瀏覽器
//   房主建房 → 玩家 B 用連結加入並派自己的狗 → 房主發佈出賽表（B 的狗在出走表上）→ 兩邊各自下注、準備
//   → 房主開跑 → 兩邊的比賽時間對齊、名次與時間完全一致 → 中途第三個人用連結加入觀戰、也看到同一場
//   → 結果畫面：各自的派彩只算自己的票、B 的狗的獎金只進 B 的房間籌碼（犬舍錢包不變） → 房主發佈下一場（大家回到出賽表、準備被取消）
//   → 管理面板（密碼 nightnight）：派發、設為、改起始籌碼＋全部重置，所有人同步
//   另外（2026-10-31）：B 在大廳改跑法 → 出賽表上 B 的狗用那個跑法；彩池制：A 的下注即時進彩池、B 看到賠率下降、
//   兩邊的最終賠率一致；累積彩金由房主結算（沒人買三連單＝累積 JP_SEED＋JP_PER_RACE＋下注 5%）
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8947 --directory dist
//   3. Firebase emulator：tools/midnight_check/node_modules/.bin/firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node tools/saigo_check/net_check.js
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
  // B 已經有一隻邊境牧羊犬
  var bKennel = { v: 1, coins: 5000, dogs: [{ id: "d1", breed: "border", name: "閃電", lv: 3, exp: 0, train: { spd: 10, sta: 5, pow: 0, agi: 0, jmp: 0, swm: 0, cat: 0, foc: 0 }, fatigue: 0, mood: 3, bond: 10, races: 0, wins: 0, top3: 0, earnings: 0 }], nextId: 2, at: Date.now(), stats: { races: 0, bets: 0, spent: 0, won: 0, bailouts: 0 }, history: [] };
  var A = await newPage(browser, "A", "房主");
  var B = await newPage(browser, "B", "玩家B", bKennel);

  await A.goto(BASE);
  await ev(A, function () { window.PriTestSaigo.enterRoom(null); });
  await until(A, function () { var r = window.PriTestSaigo.ui.room; return r && r.loaded && r.isHost(); }, null, 15000, "建房");
  var url = await ev(A, function () { return location.href; });
  assert.ok(/\?room=g[0-9a-f]{32}$/.test(url), "網址帶房號：" + url);

  await B.goto(url);
  await until(B, function () { var r = window.PriTestSaigo.ui.room; return r && r.loaded; }, null, 15000, "加入");
  await B.selectOption(".sg-panel select", "d1");
  await until(B, function () { return Array.prototype.some.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.indexOf("逃馬") === 0; }); }, null, 10000, "B 跑法選單");
  await ev(B, function () { Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.indexOf("逃馬") === 0; })[0].click(); });
  await until(A, function () { return window.PriTestSaigo.ui.room.list().some(function (p) { return p.entry && p.entry.name === "閃電" && p.entry.style === "nige"; }); }, null, 10000, "看到 B 的狗（逃馬）");
  await A.screenshot({ path: path.join(SHOT_DIR, "net_lobby.png"), fullPage: true });

  // 發佈出賽表
  await ev(A, function () {
    var b = Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.indexOf("發佈出賽表") >= 0; })[0];
    b.click();
  });
  await until(A, function () { return window.PriTestSaigo.ui.screen === "card"; }, null, 10000, "A 出賽表");
  await until(B, function () { return window.PriTestSaigo.ui.screen === "card"; }, null, 10000, "B 出賽表");
  var cards = await Promise.all([A, B].map(function (p) { return ev(p, function () { var u = window.PriTestSaigo.ui; return { seed: u.card.seed, mine: u.card.dogs.map(function (d, i) { return d.name === "閃電" ? i : -1; }).filter(function (x) { return x >= 0; }), odds: JSON.stringify(window.PriTestSaigoCore.odds(u.card).win) }; }); }));
  assert.strictEqual(cards[0].seed, cards[1].seed, "同一張出賽表");
  assert.strictEqual(cards[0].odds, cards[1].odds, "賠率一致");
  assert.strictEqual(cards[1].mine.length, 1, "B 的狗上場");
  var bDogCard = await ev(B, function (g) { var d = window.PriTestSaigo.ui.card.dogs[g]; return { style: d.style, best: d.best, pm: window.PriTestSaigo.ui.card.pm }; }, cards[1].mine[0]);
  assert.deepStrictEqual(bDogCard, { style: "nige", best: "sashi", pm: 1 }, "B 的狗跑逃馬（舊資料沒有最適跑法＝犬種的差馬）、預設彩池制");
  assert.strictEqual(await B.$$eval(".sg-dogrow.sg-mine", function (x) { return x.length; }), 1, "B 看到自己的狗");
  assert.strictEqual(await A.$$eval(".sg-dogrow.sg-mine", function (x) { return x.length; }), 0, "A 那邊不是自己的狗");

  // 下注：A 單勝 B 的狗 ×300；B 複勝自己的狗 ×200
  var bGate = cards[1].mine[0];
  await until(A, function () { var r = window.PriTestSaigo.ui.room; return r.balLoaded && r.bal[r.pid]; }, null, 10000, "A 籌碼建立");
  await until(B, function () { var r = window.PriTestSaigo.ui.room; return r.balLoaded && r.bal[r.pid]; }, null, 10000, "B 籌碼建立");
  var a0 = await coins(A), b0 = await coins(B), bk0 = await kennelCoins(B);
  assert.strictEqual(a0, 10000, "起始籌碼");
  await A.click(".sg-pick:nth-child(" + (bGate + 1) + ")");
  await A.fill(".sg-stake", "300"); await A.dispatchEvent(".sg-stake", "change");
  await ev(A, function () { Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.trim() === "加入"; })[0].click(); });
  await ev(B, function () { Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.trim() === "複勝"; })[0].click(); });
  await B.click(".sg-pick:nth-child(" + (bGate + 1) + ")");
  await B.fill(".sg-stake", "200"); await B.dispatchEvent(".sg-stake", "change");
  await ev(B, function () { Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.trim() === "加入"; })[0].click(); });
  var tk = await Promise.all([A, B].map(function (p) { return ev(p, function () { return window.PriTestSaigo.ui.tickets.map(function (t) { return t.type + ":" + t.cost; }); }); }));
  assert.deepStrictEqual(tk, [["win:300"], ["place:200"]]);
  // 彩池制：A 的 300 進彩池，B 看到這隻狗的單勝賠率比固定賠率低
  await until(B, function (g) { var w = window.PriTestSaigo.ui.room.livePool().win; return w && w[g] === 300; }, bGate, 10000, "B 看到 A 的下注進彩池");
  var oddsB = await ev(B, function (g) { var u = window.PriTestSaigo.ui, c = u.card; return { live: window.PriTestSaigoBet.poolOdds(c, u.room.livePool(), u.room.poolBase()).win[g], fixed: window.PriTestSaigoCore.odds(c).win[g] }; }, bGate);
  assert.ok(oddsB.live < oddsB.fixed, "彩池賠率下降 " + JSON.stringify(oddsB));

  // B 準備、A 開跑
  await ev(B, function () { Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.indexOf("準備好了") >= 0; })[0].click(); });
  await until(A, function () { return window.PriTestSaigo.ui.room.list().every(function (p) { return p.ready || p.cid === window.PriTestSaigo.ui.room.cid; }); }, null, 10000, "B 準備");
  await ev(A, function () { Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.trim() === "開跑！" && !x.disabled; })[0].click(); });
  await until(A, function () { return window.PriTestSaigo.ui.screen === "race"; }, null, 10000, "A 比賽");
  await until(B, function () { return window.PriTestSaigo.ui.screen === "race"; }, null, 10000, "B 比賽");
  await until(A, function (n) { return window.PriTestSaigo.ui.room.coins() === n; }, a0 - 300, 10000, "A 開跑扣款");
  await until(B, function (n) { return window.PriTestSaigo.ui.room.coins() === n; }, b0 - 200, 10000, "B 開跑扣款");
  await until(A, function (n) { var r = window.PriTestSaigo.ui.room; return r.coinsOf(r.list().filter(function (p) { return p.name === "玩家B"; })[0].pid) === n; }, b0 - 200, 10000, "A 看到 B 的籌碼");

  // 時間對齊（同一時刻兩邊的比賽時間差 < 0.3 秒）
  await A.waitForTimeout(7000);
  var ta = await ev(A, function () { return window.PriTestSaigo.ui.room.raceTime(); });
  var tb = await ev(B, function () { return window.PriTestSaigo.ui.room.raceTime(); });
  assert.ok(Math.abs(ta - tb) < 0.3, "時間對齊 " + ta + " / " + tb);

  // 第三個人中途加入觀戰
  var C = await newPage(browser, "C", "觀眾C");
  await C.goto(url);
  await until(C, function () { return window.PriTestSaigo.ui.screen === "race"; }, null, 15000, "C 中途進入比賽");
  await C.screenshot({ path: path.join(SHOT_DIR, "net_race.png") });

  var results = await Promise.all([A, B, C].map(function (p) { return ev(p, function () { var r = window.PriTestSaigo.ui.result; return JSON.stringify({ o: r.order, t: r.times }); }); }));
  assert.strictEqual(results[0], results[1], "A／B 結果一致");
  assert.strictEqual(results[0], results[2], "A／C 結果一致");

  // 跑完
  var dur = await ev(A, function () { return window.PriTestSaigo.ui.result.duration; });
  await until(A, function () { return window.PriTestSaigo.ui.screen === "result"; }, null, (dur + 15) * 1000, "A 結果");
  await until(B, function () { return window.PriTestSaigo.ui.screen === "result"; }, null, 15000, "B 結果");
  await until(C, function () { return window.PriTestSaigo.ui.screen === "result"; }, null, 15000, "C 結果");
  await B.screenshot({ path: path.join(SHOT_DIR, "net_result.png"), fullPage: true });
  var order = JSON.parse(results[0]).o, place = order.indexOf(bGate);
  var aWon = await ev(A, function () { return window.PriTestSaigo.ui.lastSettle.won; });
  var bInfo = await ev(B, function () { var u = window.PriTestSaigo.ui; return { won: u.lastSettle.won, prize: u.dogRewards.reduce(function (a, x) { return a + x.r.prize; }, 0), rewards: u.dogRewards.length }; });
  var aDog = await ev(A, function () { return window.PriTestSaigo.ui.dogRewards.length; });
  assert.strictEqual(aDog, 0, "A 沒有狗的獎金");
  assert.strictEqual(bInfo.rewards, 1, "B 的狗結算");
  await until(A, function (n) { return window.PriTestSaigo.ui.room.coins() === n; }, a0 - 300 + aWon, 10000, "A 派彩");
  await until(B, function (n) { return window.PriTestSaigo.ui.room.coins() === n; }, b0 - 200 + bInfo.won + bInfo.prize, 10000, "B 派彩＋狗獎金");
  assert.strictEqual(await kennelCoins(B), bk0, "B 的犬舍錢包不變");
  assert.strictEqual(aWon > 0, place === 0, "A 單勝中獎與否");
  var fin = await Promise.all([A, B].map(function (p) { return ev(p, function () { return JSON.stringify(window.PriTestSaigo.ui.finalOdds.win); }); }));
  assert.strictEqual(fin[0], fin[1], "最終賠率一致");
  if (place === 0) assert.strictEqual(aWon, Math.floor(300 * JSON.parse(fin[0])[bGate]), "A 用最終賠率派彩");
  // 累積彩金：沒人買三連單 → 5000 + 500 + floor(500 × 5%)
  await until(B, function () { var jp = window.PriTestSaigo.ui.room.jp; return jp && jp.no === 1; }, null, 10000, "房主結算累積彩金");
  assert.strictEqual(await ev(B, function () { return window.PriTestSaigo.ui.room.jp.amt; }), 5000 + 500 + Math.floor(500 * 0.05), "累積彩金");
  assert.strictEqual(bInfo.won > 0, place <= 1, "B 複勝中獎與否");
  var bDog = await ev(B, function () { return JSON.parse(localStorage.getItem("pritest-saigo-kennel")).dogs[0].races; });
  assert.strictEqual(bDog, 1);

  // 下一場：大家回到出賽表、準備被取消、票清空
  await ev(A, function () { Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.indexOf("發佈下一場") >= 0; })[0].click(); });
  await until(B, function () { var u = window.PriTestSaigo.ui; return u.screen === "card" && u.netNo === 2 && !u.tickets.length && !u.room.me.ready; }, null, 10000, "B 下一場");
  await until(C, function () { return window.PriTestSaigo.ui.screen === "card"; }, null, 10000, "C 下一場");

  // 管理面板：C 輸入密碼開啟（答錯不會進去）
  var answers = ["wrong", "nightnight"];
  C.on("dialog", async function (d) { if (d.type() === "prompt") await d.accept(answers.shift()); else await d.accept(); });
  await ev(C, function () { window.PriTestSaigo.go("lobby"); window.PriTestSaigo.openDash(); });
  assert.notStrictEqual(await screen(C), "dash", "密碼錯誤不進管理面板");
  await ev(C, function () { window.PriTestSaigo.openDash(); });
  assert.strictEqual(await screen(C), "dash", "密碼正確進管理面板");
  var bPid = await ev(B, function () { return window.PriTestSaigo.ui.room.pid; });
  var bNow = await coins(B);
  await ev(C, function (pid) { return window.PriTestSaigo.ui.room.addCoins(pid, 1000, true); }, bPid);
  await until(B, function (n) { return window.PriTestSaigo.ui.room.coins() === n; }, bNow + 1000, 10000, "B 收到派發");
  await ev(C, function (pid) { return window.PriTestSaigo.ui.room.setCoins(pid, 777); }, bPid);
  await until(B, function () { return window.PriTestSaigo.ui.room.coins() === 777; }, null, 10000, "B 籌碼被設為 777");
  await C.screenshot({ path: path.join(SHOT_DIR, "net_dash.png"), fullPage: true });
  await ev(C, function () { return window.PriTestSaigo.ui.room.setBank(5000, true); });
  await until(A, function () { return window.PriTestSaigo.ui.room.coins() === 5000; }, null, 10000, "A 全部重置");
  await until(B, function () { return window.PriTestSaigo.ui.room.coins() === 5000; }, null, 10000, "B 全部重置");
  // 扣款超過餘額：整筆放棄
  var fail = await ev(A, function () { var r = window.PriTestSaigo.ui.room; return r.addCoins(r.pid, -999999); });
  assert.strictEqual(fail, null, "餘額不足扣款被拒");
  assert.strictEqual(await coins(A), 5000);

  var errs = [].concat(A.errors, B.errors, C.errors).filter(function (e) { return !/favicon/.test(e); });
  assert.deepStrictEqual(errs, [], "錯誤：\n" + errs.join("\n"));
  console.log("saigo net_check OK（B 的狗第 " + (place + 1) + " 名）");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
