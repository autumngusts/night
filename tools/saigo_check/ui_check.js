// ============================================================================
// 賽狗賽狗（saigo）Playwright 流程檢查：
//   首頁 → 圖鑑（3D 預覽）→ 犬舍（領養、訓練、休息）→ 單機：出賽表（派自己的狗）→ 下注（單勝、三連單壓住、三連複 BOX）
//   → 比賽（3D 轉播、切鏡頭、截圖）→ 跳到結果 → 派彩與錢包一致 → 重播不重複結算 → 練習賽 → 確定性 → 日文沒有漏翻的 sg_ 鍵
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8947 --directory dist
// 執行：node tools/saigo_check/ui_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.SAIGO_BASE || "http://localhost:8947/saigo/index.html";
var SHOT_DIR = process.env.SAIGO_SHOTS || path.join(__dirname, "shots");

async function clickText(page, label, partial) {
  var ok = await page.evaluate(function (a) {
    var b = Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) {
      var s = x.textContent.trim();
      return (a.p ? s.indexOf(a.l) >= 0 : s === a.l) && !x.disabled;
    })[0];
    if (!b) return false;
    b.click();
    return true;
  }, { l: label, p: !!partial });
  assert.ok(ok, "找不到按鈕：" + label);
  await page.waitForTimeout(150);
}
// 短距離的比賽可能在按「跳到結果」之前就自己跑完了：已經在結果畫面就不用按
async function skipToResult(page) {
  if (await page.evaluate(function () { return window.PriTestSaigo.ui.screen; }) !== "race") return;
  await clickText(page, "跳到結果");
}
function kennel(page) { return page.evaluate(function () { return JSON.parse(localStorage.getItem("pritest-saigo-kennel")); }); }

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  var page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", function (d) { d.accept(); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); localStorage.setItem("pritest-lang", "zh"); });
  await page.reload();
  await page.waitForSelector(".sg-menu");

  // 圖鑑
  await clickText(page, "📖 犬種圖鑑");
  var n = await page.$$eval(".sg-breed", function (x) { return x.length; });
  assert.ok(n >= 30 && n <= 50, "犬種數 " + n);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, "zukan.png") });

  // 犬舍：領養柴犬、訓練、休息
  await clickText(page, "← 返回");
  await clickText(page, "🏠 我的犬舍");
  await page.selectOption(".sg-panel select", "shiba");
  await page.waitForTimeout(150);
  await page.fill(".sg-panel input.sg-input", "小柴");
  await clickText(page, "領養（第一隻免費）");
  var store = await kennel(page);
  assert.strictEqual(store.dogs.length, 1);
  assert.strictEqual(store.dogs[0].name, "小柴");
  await clickText(page, "衝刺跑", true);
  await clickText(page, "跳欄", true);
  store = await kennel(page);
  assert.ok(store.dogs[0].train.spd > 0 && store.dogs[0].train.jmp > 0, "訓練有成長");
  assert.strictEqual(store.dogs[0].fatigue, 28);
  await clickText(page, "休息", true);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOT_DIR, "kennel.png") });

  // 單機：派小柴出賽
  await clickText(page, "← 返回");
  await clickText(page, "🏁 單機比賽");
  await page.selectOption(".sg-panel select", store.dogs[0].id);
  // 地圖：指定雪山＋暴風雪，距離隨機
  await clickText(page, "🏔 雪山");
  await clickText(page, "🌨 暴風雪");
  await clickText(page, "產生出賽表");
  await page.waitForSelector(".sg-entries");
  var mapInfo = await page.evaluate(function () { var c = window.PriTestSaigo.ui.card; return { t: c.terrain, w: c.weather, code: document.querySelector(".sg-code").textContent }; });
  assert.strictEqual(mapInfo.t, "snowmtn");
  assert.strictEqual(mapInfo.w, "blizzard");
  assert.ok(/#[0-9A-F]{8}/.test(mapInfo.code), "場地編號：" + mapInfo.code);
  assert.strictEqual(await page.$$eval(".sg-dogrow", function (x) { return x.length; }), 6);
  assert.strictEqual(await page.$$eval(".sg-dogrow.sg-mine", function (x) { return x.length; }), 1, "自己的狗有標示");

  // 下注：單勝 1 號、三連單壓住 2 號流 1/3/4（6 注）、三連複 BOX 1-2-3（1 注）
  var coins0 = (await kennel(page)).coins;
  await page.click(".sg-pick:nth-child(1)");
  await clickText(page, "加入");
  await clickText(page, "三連單");
  await clickText(page, "壓住（軸流）");
  await page.click(".sg-pick:nth-child(2)");
  await page.click(".sg-pick:nth-child(1)");
  await page.click(".sg-pick:nth-child(3)");
  await page.click(".sg-pick:nth-child(4)");
  var draft = await page.textContent(".sg-slip");
  assert.ok(draft.indexOf("6 注") >= 0, "三連單 軸 1 頭流 3 頭＝6 注：" + draft);
  await clickText(page, "加入");
  await clickText(page, "三連複");
  await clickText(page, "BOX");
  await page.click(".sg-pick:nth-child(1)");
  await page.click(".sg-pick:nth-child(2)");
  await page.click(".sg-pick:nth-child(3)");
  await clickText(page, "加入");
  assert.strictEqual(await page.$$eval(".sg-ticket", function (x) { return x.length; }), 3);
  await page.click(".sg-dogrow:nth-child(1)");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOT_DIR, "card.png"), fullPage: true });

  // 比賽
  await clickText(page, "開跑！");
  await page.waitForSelector(".sg-stage canvas", { timeout: 15000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(SHOT_DIR, "race_tv.png") });
  assert.strictEqual(coins0 - (await kennel(page)).coins, 100 + 600 + 100, "開跑時扣款");
  var camBtns = await page.$$(".sg-cams .sg-cam-dog");
  await camBtns[0].click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, "race_chase.png") });
  camBtns = await page.$$(".sg-cams .sg-cam-dog");
  await camBtns[6].click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, "race_pov.png") });
  await clickText(page, "🚁 空拍");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOT_DIR, "race_aerial.png") });
  await clickText(page, "📺 轉播");
  await clickText(page, "×4");
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(SHOT_DIR, "race_tv2.png") });
  await skipToResult(page);
  await page.waitForSelector(".sg-pay");
  // 派彩與錢包一致
  var check = await page.evaluate(function () {
    var ui = window.PriTestSaigo.ui, Bet = window.PriTestSaigoBet;
    var sum = Bet.settle(ui.tickets, ui.result.order);
    return { won: sum.won, settled: ui.lastSettle.won, prize: ui.dogRewards.reduce(function (a, x) { return a + x.r.prize; }, 0) };
  });
  var coins1 = (await kennel(page)).coins;
  assert.strictEqual(check.won, check.settled);
  assert.strictEqual(coins1, coins0 - 800 + check.won + check.prize, "錢包＝原本 − 下注 + 派彩 + 獎金");
  await page.screenshot({ path: path.join(SHOT_DIR, "result.png"), fullPage: true });

  // 重播不再結算
  await clickText(page, "▶ 重播");
  await page.waitForTimeout(2500);
  await skipToResult(page);
  assert.strictEqual((await kennel(page)).coins, coins1, "重播不重複派彩");

  // 練習賽
  await clickText(page, "← 返回");
  await clickText(page, "🏠 我的犬舍");
  await clickText(page, "🏁 家園練習賽");
  await page.waitForSelector(".sg-stage");
  await page.waitForTimeout(2000);
  await skipToResult(page);
  await page.waitForSelector(".sg-table");
  assert.strictEqual((await kennel(page)).dogs[0].races, 2);

  // 確定性：經過 JSON 傳送後的出賽表，模擬結果一樣
  var same = await page.evaluate(function () {
    var C = window.PriTestSaigoCore, card = C.makeCard(12345, [], { cls: "open" });
    var a = C.simulate(card, true), b = C.simulate(JSON.parse(JSON.stringify(C.cardForWire(card))), true);
    return JSON.stringify(a.times) === JSON.stringify(b.times) && JSON.stringify(C.odds(card).win) === JSON.stringify(C.odds(JSON.parse(JSON.stringify(C.cardForWire(card)))).win);
  });
  assert.ok(same, "傳送後的出賽表模擬結果與賠率一致");

  // 日文：沒有漏翻的鍵
  for (var scr of ["home", "kennel", "setup", "zukan"]) {
    await page.evaluate(function (s) { window.I18N.setLang("ja"); window.PriTestSaigo.go(s); }, scr);
    var txt = await page.textContent("#sg-app");
    assert.ok(!/sg_\w+/.test(txt), "日文有漏翻（" + scr + "）：" + txt.match(/sg_\w+/));
  }
  await page.evaluate(function () { window.I18N.setLang("zh"); });

  assert.deepStrictEqual(errors, [], "console 錯誤：\n" + errors.join("\n"));
  console.log("saigo ui_check OK");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
