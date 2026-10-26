// ============================================================================
// gousei（武俠合成）美術風格檢查（使用者指定 2026-10-26：增加美術、可切換美術風格）：
//   兩個主題各開一局 → 池子每個物體都有圖示 → 切換 5 種風格（純文字＝沒有圖示）→ 風格記在這台瀏覽器（重新整理後還在）
//   → 合成結果有大圖 → 每個分類各抽幾個不同階段的物體排成圖鑑，每種風格截一張圖（tools/gousei_check/shots/）
//   → 三種語言的風格名稱都有翻譯 → 沒有頁面錯誤
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8943 --directory dist
// 執行：node tools/gousei_check/art_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.GOUSEI_BASE || "http://localhost:8943/gousei/index.html";
var SHOT_DIR = path.join(__dirname, "shots");
var STYLES = ["gongbi", "ink", "pixel", "seal", "none"];

async function startGame(page, theme) {
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); });
  await page.goto(BASE);
  await page.check('input[name=gs-theme][value="' + theme + '"]');
  await page.check('input[name=gs-mode][value="shared"]');
  await page.fill("#gs-player-count", "2");
  await page.dispatchEvent("#gs-player-count", "change");
  await page.click("#gs-start");
  await page.waitForFunction(function () { return window.PriTestGousei._debugState() !== null; }, null, { timeout: 15000 });
  await page.waitForSelector("#gs-confirm");
  for (var i = 1; i <= 2; i++) {
    await page.click('button[data-reveal="p' + i + '"]');
    await page.click('button[data-reveal="p' + i + '"]');
  }
  await page.click("#gs-confirm-start");
  await page.waitForSelector("#gs-pool-list");
}

async function setStyle(page, s) {
  await page.selectOption("#gs-art-style", s);
  await page.waitForTimeout(80);
}

// 圖鑑：每個分類抽 6 個物體（不同階段）＋初始物體＋廢料，用目前風格畫在頁面最上方
async function gallery(page, theme, style) {
  await page.evaluate(function (args) {
    var th = window.PriTestGousei._theme();
    var A = window.PriTestGouseiArt;
    var old = document.getElementById("gsa-gallery");
    if (old) old.remove();
    var box = document.createElement("div");
    box.id = "gsa-gallery";
    box.style.cssText = "display:grid;grid-template-columns:repeat(8,72px);gap:6px;padding:10px;background:#fff;width:max-content";
    var items = th.data.items;
    var cats = ["basic"].concat(th.data.categories.map(function (c) { return c.id; })).concat(["junk"]);
    cats.forEach(function (cat) {
      var list = items.filter(function (r) { return r[3] === cat; }).sort(function (a, b) { return a[4] - b[4]; });
      var pickN = Math.min(8, list.length);
      for (var i = 0; i < pickN; i++) {
        var r = list[Math.floor(i * (list.length - 1) / Math.max(1, pickN - 1))];
        var cell = document.createElement("div");
        cell.style.cssText = "font:10px sans-serif;text-align:center;color:#333";
        cell.innerHTML = A.icon(args.theme, { id: r[0], cat: r[3], tier: r[4] }, r[1], 64, args.style) + "<div>" + r[1] + " " + r[4] + "</div>";
        box.appendChild(cell);
      }
    });
    document.body.insertBefore(box, document.body.firstChild);
  }, { theme: theme, style: style });
  await page.locator("#gsa-gallery").screenshot({ path: path.join(SHOT_DIR, "gousei_art_" + theme + "_" + style + ".png") });
  await page.evaluate(function () { document.getElementById("gsa-gallery").remove(); });
}

(async function main() {
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR);
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text()); });

  for (var theme of ["wuxia", "wafu"]) {
    await startGame(page, theme);
    // 預設風格（工筆彩繪／浮世繪）：池子每個按鈕都有圖示
    var counts = await page.evaluate(function () {
      return { items: document.querySelectorAll("#gs-pool-list .gs-item").length, icons: document.querySelectorAll("#gs-pool-list .gs-item .gsa-icon").length };
    });
    assert.ok(counts.items > 0 && counts.items === counts.icons, theme + "：池子每個物體都要有圖示 " + JSON.stringify(counts));
    for (var s of STYLES) {
      await setStyle(page, s);
      var n = await page.evaluate(function () { return document.querySelectorAll("#gs-pool-list .gsa-icon").length; });
      if (s === "none") assert.strictEqual(n, 0, "純文字不畫圖示");
      else {
        assert.ok(n > 0, theme + " " + s + "：要有圖示");
        assert.ok(await page.$("#gs-pool-list .gsa-" + s), theme + " " + s + "：圖示要換成這個風格");
      }
      await page.screenshot({ path: path.join(SHOT_DIR, "gousei_pool_" + theme + "_" + s + ".png"), clip: { x: 0, y: 0, width: 1100, height: 900 } });
      if (s !== "none") await gallery(page, theme, s);
    }
    // 風格記在瀏覽器：重新整理後還是同一個
    await setStyle(page, "ink");
    await page.reload();
    await page.waitForSelector("#gs-pool-list");
    assert.strictEqual(await page.inputValue("#gs-art-style"), "ink", "重新整理後風格還在");
    assert.ok(await page.$("#gs-pool-list .gsa-ink"), "重新整理後畫的是水墨");
    // 合成：工作台與結果有圖示
    var basics = await page.evaluate(function () { return window.PriTestGousei._theme().data.basics; });
    await page.click('#gs-pool-list button[data-item="' + basics[0] + '"]');
    await page.click('#gs-pool-list button[data-item="' + basics[3] + '"]');
    assert.strictEqual(await page.locator(".gs-slot .gsa-icon").count(), 2, "合成欄兩格都有圖示");
    await page.click("#gs-combine");
    await page.waitForSelector("#gs-result .gs-result-item .gsa-icon");
    await page.waitForTimeout(700); // 等彈出動畫播完
    await page.screenshot({ path: path.join(SHOT_DIR, "gousei_result_" + theme + ".png"), clip: { x: 0, y: 0, width: 1100, height: 900 } });
    // 三種語言的風格名稱
    for (var l of ["ja", "en", "zh"]) {
      await page.evaluate(function (x) { window.I18N.setLang(x); }, l);
      var raw = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll("#gs-art-style option"), function (o) { return o.textContent; }).filter(function (x) { return /gs_art/.test(x); }); });
      assert.deepStrictEqual(raw, [], theme + " " + l + "：風格名稱沒翻譯");
    }
    console.log(theme, "OK", JSON.stringify(counts));
  }
  assert.deepStrictEqual(errors, [], "頁面錯誤：" + errors.join("\n"));
  await browser.close();
  console.log("gousei 美術檢查通過");
})().catch(function (e) { console.error(e); process.exit(1); });
