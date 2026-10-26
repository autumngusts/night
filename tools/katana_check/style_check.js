// ============================================================================
// 神前鍛刀對決：美術風格與戰鬥場景檢查（使用者指定 2026-10-26）：
//   準備畫面有美術風格／戰鬥場景選單 → 對刀實驗場開打 → 9 個場景各截一張（開場字幕過後）
//   → 4 種美術風格（水墨／浮世繪／霓虹／像素）各截一張 → 刀視角換成場景的天空 → 跳過 → 決著演出（「勝」）
//   → 演出播完換到結果畫面 → 選擇存在瀏覽器、重新整理後還在 → 沒有頁面錯誤
// 截圖在 tools/katana_check/shots/（style_stage_<id>.png、style_look_<id>.png、style_pov.png、style_finale.png）
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8944 --directory dist
// 執行：node tools/katana_check/style_check.js
// 注意：對刀場每一影格都重畫，按鈕一律用 element.click()（CLAUDE.md §4.6）。
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.KATANA_BASE || "http://localhost:8944/katana/index.html";
var SHOT_DIR = path.join(__dirname, "shots");

async function clickText(page, key, params) {
  var ok = await page.evaluate(function (a) {
    var label = window.I18N.t(a[0], a[1]);
    var b = Array.prototype.filter.call(document.querySelectorAll("#kt-app button"), function (x) { return x.textContent.trim() === label && !x.disabled; })[0];
    if (!b) return false;
    b.click();
    return true;
  }, [key, params || {}]);
  assert.ok(ok, "找不到按鈕 " + key);
}
async function choose(page, sel, value) {
  await page.evaluate(function (a) { var s = document.querySelector(a[0]); s.value = a[1]; s.dispatchEvent(new Event("change")); }, [sel, value]);
}
// 從準備畫面的實驗場直接開打
async function startLab(page) {
  await page.evaluate(function () { var d = document.querySelector(".kt-lab"); if (d) d.open = true; });
  await clickText(page, "kt_lab_go");
  await page.waitForSelector(".kt-arena-canvas");
}

(async function main() {
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR);
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text()); });

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-katana-look"); localStorage.removeItem("pritest-katana-stage"); localStorage.removeItem("pritest-katana-state"); window.I18N.setLang("zh"); });
  await page.reload();
  assert.ok(await page.$(".kt-looks .kt-look-select"), "準備畫面要有美術風格選單");
  assert.ok(await page.$(".kt-looks .kt-stage-select"), "準備畫面要有戰鬥場景選單");
  var stages = await page.evaluate(function () { return window.PriTestKatanaStyle.STAGES.map(function (x) { return x.id; }); });
  assert.ok(stages.length >= 8, "至少 8 個場景");

  // 每個場景
  for (var id of stages) {
    await page.reload();
    await choose(page, ".kt-looks .kt-stage-select", id);
    await startLab(page);
    // 開場字幕
    await page.waitForTimeout(500);
    if (id === stages[0]) await page.locator(".kt-arena-canvas").screenshot({ path: path.join(SHOT_DIR, "style_intro.png") });
    await page.waitForTimeout(2200);
    await page.locator(".kt-arena-canvas").screenshot({ path: path.join(SHOT_DIR, "style_stage_" + id + ".png") });
  }

  // 美術風格（固定在夜櫻）
  for (var lk of ["sumi", "ukiyo", "neon", "pixel"]) {
    await page.reload();
    await choose(page, ".kt-looks .kt-stage-select", "sakura");
    await choose(page, ".kt-looks .kt-look-select", lk);
    assert.ok(await page.evaluate(function (x) { return document.getElementById("kt-app").classList.contains("kt-look-" + x); }, lk), "套用 kt-look-" + lk);
    await startLab(page);
    await page.waitForTimeout(2600);
    if (lk === "pixel") {
      var w = await page.evaluate(function () { var c = document.querySelector(".kt-arena-canvas"); return { w: c.width, css: c.clientWidth }; });
      assert.ok(w.w < w.css, "像素風格的畫布解析度要比顯示尺寸低 " + JSON.stringify(w));
    }
    await page.locator(".kt-arena-stage").screenshot({ path: path.join(SHOT_DIR, "style_look_" + lk + ".png") });
  }

  // 重新整理後選擇還在
  await page.reload();
  assert.strictEqual(await page.inputValue(".kt-looks .kt-look-select"), "pixel", "美術風格記住了");
  assert.strictEqual(await page.inputValue(".kt-looks .kt-stage-select"), "sakura", "戰鬥場景記住了");
  await choose(page, ".kt-looks .kt-look-select", "std");
  await choose(page, ".kt-looks .kt-stage-select", "snow");

  // 刀視角＋對刀中換場景
  await startLab(page);
  await page.waitForTimeout(2400);
  await page.evaluate(function () { document.querySelector(".kt-arena-view").click(); });
  await page.waitForTimeout(800);
  await page.locator(".kt-arena-canvas").screenshot({ path: path.join(SHOT_DIR, "style_pov.png") });
  await choose(page, ".kt-arena-hud .kt-stage-select", "forge");
  await page.waitForTimeout(500);
  await page.locator(".kt-arena-canvas").screenshot({ path: path.join(SHOT_DIR, "style_pov_forge.png") });
  await page.evaluate(function () { document.querySelector(".kt-arena-view").click(); });
  while (await page.evaluate(function () { return document.querySelector(".kt-arena-view").textContent !== window.I18N.t("kt_ar_view_top"); })) {
    await page.evaluate(function () { document.querySelector(".kt-arena-view").click(); });
  }

  // 跳過 → 決著演出 → 結果畫面
  await clickText(page, "kt_ar_skip");
  await page.waitForTimeout(700);
  assert.ok(await page.$(".kt-arena-canvas"), "決著演出中還在對刀場");
  await page.locator(".kt-arena-canvas").screenshot({ path: path.join(SHOT_DIR, "style_finale.png") });
  await page.waitForFunction(function () { return !document.querySelector(".kt-arena-canvas") || /🏆/.test(document.getElementById("kt-app").textContent); }, null, { timeout: 8000 });

  // 三種語言的選單
  for (var l of ["ja", "en", "zh"]) {
    await page.evaluate(function (x) { window.I18N.setLang(x); }, l);
    var raw = await page.evaluate(function () { return (document.getElementById("kt-app").innerText.match(/\bkt_(look|scene)[a-z_]*/g) || []); });
    assert.deepStrictEqual(raw, [], l + "：沒翻譯的鍵");
  }

  assert.deepStrictEqual(errors, [], "頁面錯誤：" + errors.join("\n"));
  await browser.close();
  console.log("katana 美術風格與戰鬥場景檢查通過");
})().catch(function (e) { console.error(e); process.exit(1); });
