// ============================================================================
// 宵の怪談（yoi）Playwright 流程檢查：
//   首頁卡片 → 設定（舞台、2 名探索者）→ 3D 畫面截圖 → 平面圖切換與點房間移動 → 重新整理後「繼續」
//   → 自動玩到天亮或全滅（處理事件、供品、取材對話框）→ 結局畫面 → 再一局：走到結界間、用 UI 名指し → 封印
//   → 日文切換後畫面上沒有漏翻的 yo_ 鍵 → 沒有 console error
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8948 --directory dist
// 執行：node tools/yoi_check/ui_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var ROOT = process.env.YOI_ROOT || "http://localhost:8948/";
var BASE = ROOT + "yoi/index.html";
var SHOT_DIR = process.env.YOI_SHOTS || path.join(__dirname, "shots");

async function click(page, sel) {
  await page.dispatchEvent(sel, "click");
  await page.waitForTimeout(60);
}
async function clickText(page, label, partial) {
  var ok = await page.evaluate(function (a) {
    var b = Array.prototype.filter.call(document.querySelectorAll("#yo-app button"), function (x) {
      var s = x.textContent.trim();
      return (a.p ? s.indexOf(a.l) >= 0 : s === a.l) && !x.disabled;
    })[0];
    if (!b) return false;
    b.click();
    return true;
  }, { l: label, p: !!partial });
  assert.ok(ok, "找不到按鈕：" + label);
  await page.waitForTimeout(80);
}
function state(page) { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestYoi.state())); }); }

// 一步自動操作：有對話框就處理，沒有就搜索／移動／結束行動
async function autoStep(page, r) {
  return page.evaluate(function (r) {
    function q(s) { return Array.prototype.filter.call(document.querySelectorAll(s), function (b) { return !b.disabled; }); }
    var st = window.PriTestYoi.state();
    if (st.result) return "end";
    var modal = document.querySelector("#yo-modal .yo-modal");
    if (modal) {
      var opts = q("#yo-modal [data-act=choose]");
      var pick = opts.filter(function (b) { return /safe|ok|leave/.test(b.getAttribute("data-opt")); })[0] || opts[Math.floor(r * opts.length)] || opts[0];
      if (pick) { pick.click(); return "choose"; }
      var close = q("#yo-modal [data-act=close]")[0];
      if (close) { close.click(); return "close"; }
      return "stuck-modal";
    }
    var search = q("#yo-actions [data-act=search]")[0];
    if (search && r < 0.6) { search.click(); return "search"; }
    var moves = q("#yo-actions [data-act=move]");
    if (moves.length && r < 0.85) { moves[Math.floor(r * 97) % moves.length].click(); return "move"; }
    var pass = q("#yo-actions [data-act=pass]")[0];
    if (pass) { pass.click(); return "pass"; }
    return "nothing";
  }, r);
}

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  var page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });

  // 首頁卡片
  await page.goto(ROOT + "index.html");
  await page.evaluate(function () { localStorage.clear(); localStorage.setItem("pritest-lang", "zh"); });
  await page.reload();
  assert.ok(await page.$('a[href="yoi/index.html"]'), "首頁沒有宵の怪談的入口");

  // 設定
  await page.goto(BASE);
  await page.waitForSelector(".yo-stages");
  await page.screenshot({ path: path.join(SHOT_DIR, "01_setup.png"), fullPage: true });
  await click(page, '[data-act=stage][data-id=yoiya]');
  await click(page, "[data-act=start]");
  await page.waitForSelector(".yo-canvas", { timeout: 15000 });
  await page.waitForTimeout(1200);
  var st = await state(page);
  assert.strictEqual(st.stage, "yoiya");
  assert.strictEqual(st.members.length, 2);
  assert.strictEqual(st.apPer, 3, "雙人每時段 3 行動");
  await page.screenshot({ path: path.join(SHOT_DIR, "02_game_3d.png"), fullPage: true });

  // 3D 點房間移動：用 UI 按鈕的移動（點擊 canvas 需要座標，這裡驗證 2D 平面圖的點房間）
  await clickText(page, "平面圖");
  var cells = await page.$$eval(".yo-map .yo-cell:not(.yo-void)", function (x) { return x.length; });
  assert.strictEqual(cells, 10, "宵屋旅館應有 10 間房");
  await click(page, ".yo-map [data-room=chouba]");
  st = await state(page);
  assert.strictEqual(st.members[0].room, "chouba", "點平面圖房間應移動");
  assert.strictEqual(st.ap, 2);
  await page.screenshot({ path: path.join(SHOT_DIR, "03_game_2d.png"), fullPage: true });
  await clickText(page, "3D");

  // 重新整理 → 繼續
  await page.reload();
  await page.waitForSelector("[data-act=continue]");
  await click(page, "[data-act=continue]");
  st = await state(page);
  assert.strictEqual(st.members[0].room, "chouba", "繼續後狀態應保留");

  // 自動玩到結束
  var seed = 7, steps = 0, sawEvent = false, last;
  while (steps < 600) {
    seed = (seed * 16807) % 2147483647;
    last = await autoStep(page, (seed % 1000) / 1000);
    if (last === "end") break;
    assert.notStrictEqual(last, "stuck-modal", "對話框卡住");
    assert.notStrictEqual(last, "nothing", "沒有可以按的按鈕");
    if (last === "choose" && !sawEvent && await page.$(".yo-event")) sawEvent = true;
    if (!sawEvent && await page.$(".yo-event")) {
      sawEvent = true;
      await page.waitForTimeout(600);   // 等對話框淡入動畫結束
      await page.screenshot({ path: path.join(SHOT_DIR, "04_event.png"), fullPage: false });
    }
    steps++;
  }
  st = await state(page);
  assert.ok(st.result === "escape" || st.result === "wipe" || st.result === "seal", "應該有結局，得到 " + st.result + "（" + steps + " 步）");
  await page.waitForSelector(".yo-result");
  await page.screenshot({ path: path.join(SHOT_DIR, "05_result.png"), fullPage: false });
  console.log("自動對局：" + st.result + "，" + steps + " 步");
  assert.strictEqual(await page.evaluate(function () { return localStorage.getItem("pritest-yoi-save-v1"); }), null, "結局後應清除存檔");

  // 再一局：單人學生在永樂公寓，走到神明廳名指し
  await click(page, "[data-act=again]");
  await page.waitForSelector(".yo-stages");
  await click(page, "[data-act=seat-del][data-i='1']");
  await click(page, "[data-act=seat-job][data-i='0'][data-id=student]");
  await click(page, "[data-act=stage][data-id=yongle]");
  await click(page, "[data-act=start]");
  await page.waitForSelector("#yo-actions [data-act=move]");
  st = await state(page);
  assert.strictEqual(st.apPer, 4, "單人每時段 4 行動");
  await click(page, "#yo-actions [data-act=move][data-room=living]");
  await click(page, "#yo-actions [data-act=move][data-room=shenming]");
  st = await state(page);
  assert.strictEqual(st.members[0].room, "shenming");
  await page.waitForSelector("#yo-actions .yo-accuse-btn");
  await click(page, "#yo-actions .yo-accuse-btn");
  await page.waitForSelector(".yo-accuse");
  var truth = await page.evaluate(function () { var s = window.PriTestYoi.state(); return { kaii: s.kaii, taboos: window.PriTestYoiData.KAII_BY_ID[s.kaii].taboos }; });
  await click(page, "[data-act=sel-kaii][data-id=" + truth.kaii + "]");
  for (var i = 0; i < 3; i++) await click(page, "[data-act=sel-taboo][data-id=" + truth.taboos[i] + "]");
  await page.screenshot({ path: path.join(SHOT_DIR, "06_accuse.png"), fullPage: false });
  await click(page, "#yo-modal [data-act=accuse]");
  st = await state(page);
  assert.strictEqual(st.result, "seal", "正確名指し應封印");
  await page.waitForSelector(".yo-result-seal");
  await page.screenshot({ path: path.join(SHOT_DIR, "07_seal.png"), fullPage: false });

  // 日文：畫面沒有漏翻的鍵
  await click(page, "[data-act=again]");
  await page.evaluate(function () { window.I18N.setLang("ja"); });
  await page.waitForTimeout(100);
  await click(page, "[data-act=start]");
  await page.waitForTimeout(800);
  var raw = await page.evaluate(function () { return (document.getElementById("yo-app").innerText.match(/yo_[a-z_0-9]+/g) || []); });
  assert.deepStrictEqual(raw, [], "日文畫面有漏翻的鍵：" + raw.join(","));
  await page.screenshot({ path: path.join(SHOT_DIR, "08_ja.png"), fullPage: true });

  // 手機寬度不應有水平捲動
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  var overflow = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  assert.ok(overflow <= 1, "手機寬度出現水平捲動 " + overflow + "px");
  await page.screenshot({ path: path.join(SHOT_DIR, "09_mobile.png"), fullPage: true });

  var real = errors.filter(function (e) { return !/favicon|GPU stall|WebGL/i.test(e); });
  assert.deepStrictEqual(real, [], "console error：" + real.join("\n"));
  await browser.close();
  console.log("宵の怪談 UI 檢查：全部通過");
})().catch(function (e) { console.error("[FAIL]", e && e.stack || e); process.exit(1); });
