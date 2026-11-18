// ============================================================================
// 射彈宇宙（shedan）Playwright 流程檢查（第 1 階段）：
//   手機（390×844）與桌機（1280×800）：滿版、沒有捲軸、導覽列平時隱藏、☰ 展開／點外側收起 →
//   選 4 人出擊 → 用 pointer 事件拖曳拉弓射出 → 敵人 HP 總和下降 → 打完 4 發輪到敵人回合 →
//   強制勝利出現結算 → 再戰一場 → 首頁 shedan 卡片不能點 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8965 --directory dist
// 執行：node tools/shedan_check/ui_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var ROOT = process.env.SHEDAN_ROOT || "http://localhost:8965/";
var BASE = ROOT + "shedan/index.html";
var SHOT_DIR = path.join(__dirname, "shots");

async function waitPhase(page, phase, ms) {
  await page.waitForFunction(function (p) { return window.PriTestShedanApp._debug.state().phase === p; }, phase, { timeout: ms || 20000 });
}

async function checkViewport(browser, vp, tag) {
  var page = await browser.newPage({ viewport: vp });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.waitForSelector(".sd-pick-card");

  // 滿版、沒有捲軸
  var dims = await page.evaluate(function () {
    var c = document.querySelector(".sd-canvas").getBoundingClientRect();
    return { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight, cw: c.width, ch: c.height };
  });
  assert.ok(dims.sw <= dims.iw && dims.sh <= dims.ih, tag + " 沒有捲軸 " + JSON.stringify(dims));
  assert.strictEqual(Math.round(dims.cw), dims.iw, tag + " canvas 滿寬");
  assert.strictEqual(Math.round(dims.ch), dims.ih, tag + " canvas 滿高");

  // 導覽列：平時藏起來，☰ 展開，點外側收起
  async function headerBottom() { return page.evaluate(function () { return document.querySelector(".site-header").getBoundingClientRect().bottom; }); }
  assert.ok(await headerBottom() <= 1, tag + " 導覽列平時隱藏");
  await page.click("#sd-nav-toggle");
  await page.waitForTimeout(350);
  assert.ok(await headerBottom() > 20, tag + " ☰ 展開導覽列");
  await page.screenshot({ path: path.join(SHOT_DIR, tag + "_01_nav.png") });
  await page.mouse.click(vp.width / 2, vp.height - 40);
  await page.waitForTimeout(350);
  assert.ok(await headerBottom() <= 1, tag + " 點外側收起");

  // 選隊
  assert.strictEqual((await page.$$(".sd-pick-card")).length, 8, "初始 8 人");
  // 每點一次選隊畫面就重繪，所以每次重新查詢
  for (var i = 0; i < 4; i++) await page.click(".sd-pick-card >> nth=" + i);
  await page.screenshot({ path: path.join(SHOT_DIR, tag + "_02_pick.png") });
  await page.click('[data-act="launch"]');
  await waitPhase(page, "aim");

  // 拖曳拉弓射出：從畫面中央往下拉（射向上方）
  var hp0 = await page.evaluate(function () { return window.PriTestShedanApp._debug.enemyHp(); });
  var cx = vp.width / 2, cy = vp.height / 2;
  await page.dispatchEvent(".sd-canvas", "pointerdown", { clientX: cx, clientY: cy, pointerId: 1, bubbles: true });
  await page.dispatchEvent(".sd-canvas", "pointermove", { clientX: cx + 10, clientY: cy + 140, pointerId: 1, bubbles: true });
  await page.screenshot({ path: path.join(SHOT_DIR, tag + "_03_aim.png") });
  await page.dispatchEvent(".sd-canvas", "pointerup", { clientX: cx + 10, clientY: cy + 140, pointerId: 1, bubbles: true });
  await waitPhase(page, "shooting", 3000);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, tag + "_04_shooting.png") });
  await page.waitForFunction(function () { return window.PriTestShedanApp._debug.state().phase !== "shooting"; }, null, { timeout: 20000 });

  // 再射 3 發（用 debug 介面，方向各不同）→ 輪到敵人 → 回到 aim
  var dirs = [[0.3, -1], [-0.5, -1], [0.8, -0.6]];
  for (var k = 0; k < dirs.length; k++) {
    var st = await page.evaluate(function () { return window.PriTestShedanApp._debug.state().phase; });
    if (st !== "aim") break;
    await page.evaluate(function (d) { window.PriTestShedanApp._debug.shoot(d[0], d[1], 1); }, dirs[k]);
    await page.waitForFunction(function () { return window.PriTestShedanApp._debug.state().phase !== "shooting"; }, null, { timeout: 20000 });
  }
  var hp1 = await page.evaluate(function () { return window.PriTestShedanApp._debug.enemyHp(); });
  assert.ok(hp1 < hp0, tag + " 敵人 HP 總和下降 " + hp0 + " → " + hp1);
  var info = await page.evaluate(function () { var s = window.PriTestShedanApp._debug.state(); return { phase: s.phase, screen: s.screen, turn: s.battle.turnNo }; });
  if (info.screen === "battle" && info.phase !== "over") {
    await page.waitForFunction(function () { var s = window.PriTestShedanApp._debug.state(); return s.phase === "aim" || s.phase === "over"; }, null, { timeout: 8000 });
    var turn = await page.evaluate(function () { return window.PriTestShedanApp._debug.state().battle.turnNo; });
    assert.ok(turn >= 2, tag + " 4 發後經過敵人回合");
  }
  await page.screenshot({ path: path.join(SHOT_DIR, tag + "_05_after_turn.png") });

  // 強制勝利 → 結算 → 再戰一場
  var screen = await page.evaluate(function () { return window.PriTestShedanApp._debug.state().screen; });
  if (screen === "battle") await page.evaluate(function () { window.PriTestShedanApp._debug.forceWin(); });
  await page.waitForSelector('[data-act="again"]', { timeout: 5000 });
  await page.screenshot({ path: path.join(SHOT_DIR, tag + "_06_result.png") });
  await page.click('[data-act="again"]');
  await waitPhase(page, "aim");

  assert.deepStrictEqual(errors, [], tag + " console error");
  await page.close();
  console.log("ok - " + tag);
}

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch();
  try {
    await checkViewport(browser, { width: 390, height: 844 }, "phone");
    await checkViewport(browser, { width: 1280, height: 800 }, "desktop");
    var page = await browser.newPage();
    await page.goto(ROOT + "index.html");
    var card = await page.evaluate(function () {
      var h = document.querySelector('[data-i18n="project_shedan_name"]');
      var c = h && h.closest(".project-card");
      return c ? { tag: c.tagName, nolink: c.classList.contains("project-card-nolink"), href: c.getAttribute("href") } : null;
    });
    assert.ok(card && card.nolink && card.tag === "DIV" && !card.href, "首頁卡片不能點 " + JSON.stringify(card));
    console.log("ok - 首頁卡片不能點");
  } finally {
    await browser.close();
  }
  console.log("all ok");
})().catch(function (e) { console.error(e); process.exit(1); });
