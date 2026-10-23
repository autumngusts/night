// ============================================================================
// 黃牌 Yellow Card：Hellcard 追加功能的畫面檢查（本機模式，2026-10-23）
//   AI 隊友（勾選 AI → 自動選目的地、出牌、結束回合）、苦痛等級／無盡模式（設定 → 頂列標示）、
//   戰場標記（標記鈕＋點擊、右鍵）與表情、音效／音樂開關（存在 localStorage）、敵人荊棘標記
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8945 --directory dist
// 執行：node tools/yellow_check/feature_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.YELLOW_BASE || "http://localhost:8945/yellow/index.html";
var SHOT_DIR = process.env.YELLOW_SHOTS || path.join(__dirname, "shots");

function st(page) { return page.evaluate(function () { return window.PriTestYellow.state(); }); }
async function clickText(page, key) {
  var ok = await page.evaluate(function (k) {
    var l = window.I18N.t(k);
    var b = Array.prototype.filter.call(document.querySelectorAll("#yc-app button"), function (x) { return x.textContent.trim() === l && !x.disabled; })[0];
    if (b) b.click();
    return !!b;
  }, key);
  assert.ok(ok, "找不到按鈕：" + key);
}

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () {
    localStorage.removeItem("pritest-yellow-state"); localStorage.removeItem("pritest-yellow-audio"); localStorage.setItem("pritest-lang", "zh");
    // 2026-10-23 起苦痛等級要先通關前一級才能選（局外進度）：當作已經通關過苦痛 10 的玩家
    localStorage.setItem("pritest-yellow-profile", JSON.stringify({ xp: {}, won: 10, done: [] }));
  });
  await page.reload();

  // ---- 設定：第 2 位勾選 AI、苦痛 3、無盡模式 ----
  // 勾選後會重畫（元素會換掉），所以在頁面裡直接點
  assert.ok((await page.$$(".yc-ai-check")).length >= 2, "每個有英雄的位置都有 AI 勾選");
  await page.evaluate(function () { document.querySelectorAll(".yc-ai-check")[1].click(); });
  await page.evaluate(function () { var sel = document.querySelector(".yc-mode-opts select"); sel.value = "3"; sel.dispatchEvent(new Event("change")); });
  await page.evaluate(function () { var c = document.querySelector('.yc-mode-opts input[type="checkbox"]'); c.click(); });
  assert.strictEqual(await page.$$eval(".yc-torment-list li", function (x) { return x.length; }), 3, "苦痛 3 列出三條效果");
  // 全部 AI 時不能開始
  await page.evaluate(function () { var c = document.querySelectorAll(".yc-ai-check"); if (!c[0].checked) c[0].click(); });
  assert.ok(await page.evaluate(function () { return Array.prototype.some.call(document.querySelectorAll(".yc-primary"), function (b) { return b.textContent === window.I18N.t("yc_start_local") && b.disabled; }); }), "全部 AI 時開始鈕不能按");
  await page.evaluate(function () { document.querySelectorAll(".yc-ai-check")[0].click(); });
  await clickText(page, "yc_start_local");
  var s0 = await st(page);
  assert.strictEqual(s0.torment, 3);
  assert.strictEqual(s0.endless, true);
  assert.strictEqual(s0.heroes[1].ctrl, "ai", "第 2 位是 AI");
  assert.ok(await page.$(".yc-tag-torment") && await page.$(".yc-tag-endless"), "頂列標示苦痛與無盡");

  // ---- 地圖：真人選完目的地後，AI 自己選，進入戰鬥 ----
  await page.evaluate(function () { var b = document.querySelector(".yc-dest:not([disabled]), .yc-node:not([disabled])"); if (b) b.click(); });
  await page.waitForFunction(function () { var s = window.PriTestYellow.state(); return s.phase === "battle"; }, null, { timeout: 15000 });

  // ---- 戰鬥：真人結束回合後，AI 也會出牌、結束回合，回合推進 ----
  await page.evaluate(function () { var l = window.I18N.t("yc_end_turn"); var b = Array.prototype.filter.call(document.querySelectorAll("button"), function (x) { return x.textContent === l; })[0]; if (b) b.click(); });
  await page.waitForFunction(function () { var s = window.PriTestYellow.state(); return s.phase !== "battle" || s.round > 1; }, null, { timeout: 30000 });
  var s1 = await st(page);
  assert.ok(s1.log.some(function (e) { return e.t === "play" && e.s === 1; }) || s1.phase !== "battle", "AI 隊友應該有出牌");

  // ---- 標記與表情 ----
  await page.waitForFunction(function () { return !window.PriTestYellow.replaying(); }, null, { timeout: 60000 });
  if ((await st(page)).phase === "battle") {
    await page.evaluate(function () { document.querySelector(".yc-ping-btn").click(); });
    var box = await (await page.$(".yc-arena")).boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.waitForSelector(".yc-sig-ping", { timeout: 3000 });
    // 右鍵直接標記
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.7, { button: "right" });
    assert.ok((await page.$$(".yc-sig-ping")).length >= 2, "右鍵也能標記");
    // 表情：先點開左下角的 😀，再選一個
    await page.evaluate(function () { document.querySelector(".yc-emo-toggle").click(); });
    await page.waitForSelector(".yc-emo-pop .yc-emote");
    await page.evaluate(function () { document.querySelector(".yc-emo-pop .yc-emote").click(); });
    await page.waitForSelector(".yc-sig-emo", { timeout: 3000 });
    await page.screenshot({ path: path.join(SHOT_DIR, "feature_signals.png") });
    // 4 秒後消失
    await page.waitForFunction(function () { return !document.querySelector(".yc-sig"); }, null, { timeout: 8000 });
  }

  // ---- 音效／音樂開關（存在 localStorage） ----
  await page.evaluate(function () { var b = document.querySelector('.yc-sound button[title="' + window.I18N.t("yc_music") + '"]'); b.click(); });
  var pref = await page.evaluate(function () { return JSON.parse(localStorage.getItem("pritest-yellow-audio") || "null"); });
  assert.ok(pref && pref.music === false, "音樂關掉後記住設定");

  // ---- 荊棘標記：把一個敵人換成有荊棘的審判石像後重新整理 ----
  if ((await st(page)).phase === "battle") {
    await page.evaluate(function () {
      var s = JSON.parse(localStorage.getItem("pritest-yellow-state"));
      s.enemies[0].id = "golem";
      localStorage.setItem("pritest-yellow-state", JSON.stringify(s));
    });
    await page.reload();
    await page.evaluate(function () { var l = window.I18N.t("yc_continue"); Array.prototype.filter.call(document.querySelectorAll("button"), function (x) { return x.textContent.trim() === l; })[0].click(); });
    await page.waitForSelector(".yc-badge-thorns", { timeout: 5000 });
  }

  assert.deepStrictEqual(errors, [], errors.join("\n"));
  await browser.close();
  console.log("OK");
})().catch(function (e) { console.error(e); process.exit(1); });
