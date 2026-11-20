// ============================================================================
// 九華（kyuka）Playwright 流程檢查：
//   招募 1 次／10 次（10 次必有 SR 以上）→ 卡片顯示型名與花紋 → 角色詳細：
//   依稀有度隱藏的花瓣（N/R 一華、SR 兩華、SSR/UR 全部）、型名抽到就顯示、
//   親密度 +11 到 33／66 時綻放、升 1 級與升滿級（9V 不超過 99、標籤不變）→ 送別 → 收藏篩選 →
//   說明頁的 81 型表 → 語言切換 → 存檔 → 手機寬度不橫向捲動 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8964 --directory dist
// 執行：node tools/kyuka_check/ui_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = (process.env.KYUKA_ROOT || "http://localhost:8964/") + "kyuka/index.html";
var SHOT_DIR = path.join(__dirname, "shots");

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // 2026-11-20 起這個遊戲在「付款」分頁，頁面會先問密碼；測試前先寫入解鎖旗標（layout.PAY_STORAGE_KEY）
  await page.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload();
  await page.waitForSelector(".ky-banner");
  await page.screenshot({ path: path.join(SHOT_DIR, "01_gacha.png") });

  async function st() { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestKyuka.state())); }); }

  // 招募
  await page.dispatchEvent('[data-act="pull1"]', "click");
  assert.strictEqual((await st()).save.items.length, 1);
  await page.dispatchEvent('[data-act="pull10"]', "click");
  var s = await st();
  assert.strictEqual(s.save.items.length, 11);
  var ten = s.save.items.slice(1);
  assert(ten.some(function (x) { return ["SR", "SSR", "UR"].indexOf(x.rarity) >= 0; }), "10 次必有 SR 以上");
  assert.strictEqual(await page.locator(".ky-grid-pull .ky-card").count(), 10);
  var typeText = await page.locator(".ky-grid-pull .ky-card-type").first().textContent();
  assert(typeText && typeText.trim().length > 0, "卡片上抽到就顯示型名");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOT_DIR, "02_pull10.png"), fullPage: true });

  // 多抽幾次，確保有 N/R、SR、SSR 以上的個體可以檢查
  for (var k = 0; k < 8; k++) await page.dispatchEvent('[data-act="pull10"]', "click");
  s = await st();
  function first(pred) { for (var i = 0; i < s.save.items.length; i++) if (pred(s.save.items[i])) return s.save.items[i]; return null; }
  var low = first(function (x) { return x.rarity === "N" || x.rarity === "R"; });
  var sr = first(function (x) { return x.rarity === "SR"; });
  var hi = first(function (x) { return x.rarity === "SSR" || x.rarity === "UR"; });
  assert(low && sr, "90 抽內應有 N/R 與 SR");

  async function openDetail(uid) {
    await page.dispatchEvent('[data-act="tab"][data-v="coll"]', "click");
    await page.dispatchEvent('.ky-card[data-uid="' + uid + '"]', "click");
    await page.waitForSelector(".ky-detail");
  }
  async function lockedCount() { return page.locator(".ky-detail .ky-stat-bar.ky-locked").count(); }

  // N/R：一華可見（6 項鎖住），型名照樣顯示
  await openDetail(low.uid);
  assert.strictEqual(await lockedCount(), 6, "N/R 一開始只看得到一華");
  assert((await page.textContent(".ky-type-name")).trim().length > 0, "型名抽到就顯示");
  await page.screenshot({ path: path.join(SHOT_DIR, "03_detail_low.png"), fullPage: true });
  for (var a = 0; a < 3; a++) await page.dispatchEvent('[data-act="aff"][data-d="11"]', "click");
  assert.strictEqual(await lockedCount(), 3, "親密度 33 第二華綻放");
  assert((await page.textContent(".ky-log")).indexOf("綻放") >= 0);
  for (a = 0; a < 3; a++) await page.dispatchEvent('[data-act="aff"][data-d="11"]', "click");
  assert.strictEqual(await lockedCount(), 0, "親密度 66 全部綻放");
  await page.screenshot({ path: path.join(SHOT_DIR, "04_detail_open.png"), fullPage: true });

  // 升級：標籤不變、9V 不超過 99
  var tagsBefore = await page.locator(".ky-tag").allTextContents();
  await page.dispatchEvent('[data-act="lv1"]', "click");
  s = await st();
  var me = s.save.items.filter(function (x) { return x.uid === low.uid; })[0];
  assert.strictEqual(me.level, 2);
  await page.dispatchEvent('[data-act="lvmax"]', "click");
  s = await st();
  me = s.save.items.filter(function (x) { return x.uid === low.uid; })[0];
  assert.strictEqual(me.level, 50);
  Object.keys(me.v).forEach(function (k) { assert(me.v[k] <= 99 && me.v[k] >= me.v0[k]); });
  assert.deepStrictEqual(await page.locator(".ky-tag").allTextContents(), tagsBefore, "升級後標籤不變");
  assert(await page.locator('[data-act="lv1"]').isDisabled());
  await page.dispatchEvent('.ky-detail-foot [data-act="close"]', "click");

  // SR：兩華可見
  await openDetail(sr.uid);
  assert.strictEqual(await lockedCount(), 3, "SR 一開始兩華");
  for (a = 0; a < 3; a++) await page.dispatchEvent('[data-act="aff"][data-d="11"]', "click");
  assert.strictEqual(await lockedCount(), 0, "SR 親密度 33 全部");
  await page.dispatchEvent('.ky-detail-foot [data-act="close"]', "click");

  // SSR/UR：全部可見
  if (hi) {
    await openDetail(hi.uid);
    assert.strictEqual(await lockedCount(), 0, "SSR/UR 一開始全部");
    await page.dispatchEvent('.ky-detail-foot [data-act="close"]', "click");
  }

  // 送別
  var countBefore = (await st()).save.items.length;
  await openDetail(sr.uid);
  await page.dispatchEvent('[data-act="release"]', "click");
  await page.dispatchEvent('[data-act="release-yes"]', "click");
  assert.strictEqual((await st()).save.items.length, countBefore - 1);

  // 篩選
  await page.dispatchEvent('[data-act="filter"][data-v="N"]', "click");
  var nCards = await page.locator(".ky-card").count();
  var nItems = (await st()).save.items.filter(function (x) { return x.rarity === "N"; }).length;
  assert.strictEqual(nCards, nItems);
  await page.screenshot({ path: path.join(SHOT_DIR, "05_collection.png"), fullPage: true });

  // 說明
  await page.dispatchEvent('[data-act="tab"][data-v="rules"]', "click");
  assert.strictEqual(await page.locator(".ky-t81 td").count(), 81);
  assert.strictEqual(await page.locator(".ky-t81 td.ky-pure").count(), 9);
  await page.screenshot({ path: path.join(SHOT_DIR, "06_rules.png"), fullPage: true });

  // 語言
  await page.dispatchEvent('.lang-btn[data-lang="ja"]', "click");
  assert((await page.textContent('[data-act="tab"][data-v="rules"]')).indexOf("説明") >= 0);
  await page.dispatchEvent('.lang-btn[data-lang="en"]', "click");
  assert((await page.textContent('[data-act="tab"][data-v="rules"]')).indexOf("Guide") >= 0);
  await page.dispatchEvent('.lang-btn[data-lang="zh"]', "click");

  // 存檔：重新載入後還在
  var saved = (await st()).save.items.length;
  await page.reload();
  await page.waitForSelector(".ky-tabs");
  assert.strictEqual((await st()).save.items.length, saved);

  // 手機寬度不橫向捲動
  await page.dispatchEvent('[data-act="tab"][data-v="coll"]', "click");
  assert(await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth; }), "收藏頁沒有橫向捲動");

  assert.deepStrictEqual(errors, [], "沒有 console error");
  await browser.close();
  console.log("kyuka ui_check: 全部通過");
})().catch(function (e) { console.error(e); process.exit(1); });
