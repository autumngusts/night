// ============================================================================
// 潛入晶片（sennyu）Playwright 流程檢查：
//   首頁卡片 → 標題 → 選角（重抽、改名）→ 序章對話與選項 → 每日行動 → 處理請求小遊戲
//   → 重新整理後「繼續」→ 潛入地圖（移動）→ 擊暈 QTE → 人物／情報一覽 → 結局畫面與結局收藏
//   → 手機寬度 → 沒有 console error
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8951 --directory dist
// 執行：node tools/sennyu_check/ui_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var ROOT = process.env.SENNYU_ROOT || "http://localhost:8951/";
var BASE = ROOT + "sennyu/index.html";
var SHOT_DIR = process.env.SENNYU_SHOTS || path.join(__dirname, "shots");

async function click(page, sel) { await page.dispatchEvent(sel, "click"); await page.waitForTimeout(40); }
function state(page) { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestSennyu.state())); }); }
async function shot(page, name) { await page.screenshot({ path: path.join(SHOT_DIR, name + ".png"), fullPage: true }); }

// 一步：對話就前進、選項就選第一個可選的、行動就挑主線（沒有就第一個）
async function step(page) {
  return page.evaluate(function () {
    var st = window.PriTestSennyu.state(), app = document.getElementById("sn-app");
    function c(sel) { var el = app.querySelector(sel); if (el) el.click(); return !!el; }
    if (!st) return "none";
    if (st.ending && !st.cur) return "ending";
    if (st.cur) {
      if (st.cur.phase === "lines") { c(".sn-box[data-act=next]"); c(".sn-box[data-act=next]"); return "lines"; }
      if (st.cur.phase === "choice") { c(".sn-choice:not([disabled])"); return "choice"; }
      return "mini:" + st.mini.kind;
    }
    var b = app.querySelector(".sn-act-main:not([disabled])") || app.querySelector(".sn-act:not([disabled])");
    b.click();
    return "hub";
  });
}
function pageCall(page, fn) {
  return page.evaluate(function (src) {
    var C = window.PriTestSennyuCore, st = window.PriTestSennyu.state();
    (new Function("C", "st", src))(C, st);
    window.PriTestSennyu.refresh();
  }, fn);
}

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });

  // 首頁卡片
  await page.goto(ROOT + "index.html");
  assert.ok(await page.$("a[href='sennyu/index.html']"), "首頁沒有潛入晶片的卡片");

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-sennyu-save-v1"); localStorage.removeItem("pritest-sennyu-endings"); });
  await page.reload();
  await page.waitForSelector(".sn-title");
  await shot(page, "01_title");

  // 選角
  await click(page, "[data-act=new]");
  assert.strictEqual(await page.$$eval(".sn-cand", function (x) { return x.length; }), 5, "候選人不是 5 位");
  await click(page, "[data-act=reroll]");
  await click(page, ".sn-cand[data-i='2']");
  await page.fill("#sn-name", "測試夜鶯");
  await shot(page, "02_select");
  await click(page, "[data-act=start]");
  var st = await state(page);
  assert.strictEqual(st.hero.name, "測試夜鶯");
  assert.strictEqual(st.cur.sid, "p_brief");
  await page.waitForTimeout(300);
  await shot(page, "03_scene");

  // 序章：一路走到第一章的每日行動
  var guard = 0, sawChoice = false;
  while (guard++ < 300) {
    st = await state(page);
    if (st.cur && st.cur.phase === "choice" && !sawChoice) { sawChoice = true; await shot(page, "04_choice"); }
    if (!st.cur && st.ch === 1) break;
    await step(page);
  }
  assert.ok(!st.cur && st.ch === 1, "沒有進入第一章的每日行動");
  await shot(page, "05_hub");

  // 處理請求
  await click(page, "[data-act=do][data-id=work]");
  while ((st = await state(page)).cur.phase === "lines") await step(page);
  assert.strictEqual(st.mini.kind, "inbox");
  await shot(page, "06_inbox");
  guard = 0;
  while (guard++ < 30) {
    st = await state(page);
    if (!st.mini) break;
    if (await page.$("[data-act=inbox-next]")) await click(page, "[data-act=inbox-next]");
    else if (await page.$("[data-act=mini-end]")) await click(page, "[data-act=mini-end]");
    else await click(page, ".sn-inbox-opts .sn-choice:not([disabled])");
  }
  while ((st = await state(page)).cur) await step(page);
  assert.ok(st.slot === 1 || st.day === 2, "處理請求後時段沒有前進");

  // 重新整理 → 繼續
  await page.reload();
  await page.waitForSelector("[data-act=continue]");
  await click(page, "[data-act=continue]");
  assert.ok(await page.$(".sn-hud"), "繼續後沒有回到遊戲");

  // 潛入地圖
  await pageCall(page, "C.startScene(st, 'c3_sneak_map');");
  while ((st = await state(page)).cur.phase === "lines") await step(page);
  assert.strictEqual(st.mini.kind, "sneak");
  var before = st.mini.pos.join(",");
  await page.keyboard.press("ArrowRight");
  st = await state(page);
  assert.notStrictEqual(st.mini.pos.join(","), before, "方向鍵沒有移動");
  await click(page, "[data-act=move][data-dx='0'][data-dy='0']");
  await shot(page, "07_sneak");
  // 硬走到被發現
  guard = 0;
  while (guard++ < 30) {
    st = await state(page);
    if (st.mini.alert || st.mini.done) break;
    await pageCall(page, "if (!C.sneakMove(st, 1, 0)) if (!C.sneakMove(st, 0, 1)) C.sneakMove(st, 0, 0);");
  }
  if (st.mini.alert) {
    await shot(page, "08_alert");
    if (st.mini.alert.adj) {
      await click(page, "[data-act=sn-stun]");
      assert.ok(await page.$(".sn-qte-bar"), "擊暈沒有出現 QTE");
      await page.waitForTimeout(250);
      await shot(page, "09_qte");
      for (var k = 0; k < 4 && await page.$("[data-act=qte-hit]"); k++) { await click(page, "[data-act=qte-hit]"); await page.waitForTimeout(150); }
      await click(page, "[data-act=qte-end]");
    } else await click(page, "[data-act=sn-bluff]");
  }

  // 一覽
  await pageCall(page, "C.applyEff(st, { intel: ['p_org', 'v_loc', 'k_1'], meet: ['shen', 'ye'] });");
  await click(page, "[data-act=panel][data-p=people]");
  await shot(page, "10_people");
  await click(page, "[data-act=close]");
  await click(page, "[data-act=panel][data-p=intel]");
  assert.ok((await page.textContent(".sn-modal")).indexOf("VN 的權力結構") >= 0, "情報一覽沒有顯示取得的情報");
  await shot(page, "11_intel");
  await click(page, "[data-act=close]");

  // 結局
  await pageCall(page, "st.mini = null; C.goNext(st, '@ending:e_perfect');");
  guard = 0;
  while (guard++ < 80 && (await step(page)) !== "ending") ;
  assert.ok(await page.$(".sn-ending"), "沒有出現結局畫面");
  assert.ok((await page.textContent(".sn-end-title")).indexOf("黎明的晶圓") >= 0);
  await shot(page, "12_ending");
  await click(page, "[data-act=title]");
  assert.ok((await page.textContent(".sn-gallery")).indexOf("黎明的晶圓") >= 0, "結局收藏沒有記錄");
  assert.ok(!(await page.$("[data-act=continue]")), "結局後存檔沒有清掉");

  // 手機寬度
  await page.setViewportSize({ width: 390, height: 844 });
  await click(page, "[data-act=new]");
  await click(page, "[data-act=start]");
  await page.waitForTimeout(400);
  var overflow = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  assert.ok(overflow <= 1, "手機寬度橫向溢出 " + overflow + "px");
  await shot(page, "13_mobile");

  assert.deepStrictEqual(errors, [], "console error：" + errors.join("\n"));
  await browser.close();
  console.log("OK（截圖在 " + SHOT_DIR + "）");
})().catch(function (e) { console.error(e); process.exit(1); });
