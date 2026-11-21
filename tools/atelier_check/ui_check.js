// 煉金術士（atelier）Playwright 流程檢查：
//   清空存檔 → 從圖片取色（左瑠璃色、右若竹色）→ 選 2 色採集 → 再採 1 色（採集籃 6→4）
//   → 調和：教學台詞 → 選治癒藥水 → 依格子要求選素材 → 棋盤：點一次預覽、再點一次放下 → Undo → 放完
//   → 最後一推 → 選特性 → 完成 → 成品、扣素材、冷卻 → 開發面板跳過冷卻 → 委託交貨
//   → 語言切換 → 手機寬度不橫向捲動 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8973 --directory dist
// 執行：node tools/atelier_check/ui_check.js
// 注意（CLAUDE.md §4.6）：HUD 會整個重繪，一律用 dispatchEvent 觸發，不用 page.click。
"use strict";
var path = require("path"), assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;
var BASE = (process.env.ATELIER_ROOT || "http://localhost:8973/") + "atelier/index.html";

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 375, height: 800 } }), errors = [];
  // 2026-11-20 起這個遊戲在「付款」分頁，頁面會先問密碼；測試前先寫入解鎖旗標（layout.PAY_STORAGE_KEY）
  await page.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  async function state() { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestAtelier._debugState())); }); }
  async function tap(sel) { await page.dispatchEvent(sel, "click"); }

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-atelier-save-v1"); });
  await page.reload();
  var s = await state();
  assert.strictEqual(s.mats.length, 0);
  assert.strictEqual(s.basket.n, 6);

  // 測試圖片：左半瑠璃色（冰／液體）、右半若竹色（風／植物）
  var png = await page.evaluate(function () {
    var c = document.createElement("canvas"); c.width = 64; c.height = 64;
    var g = c.getContext("2d");
    g.fillStyle = "#1E50A2"; g.fillRect(0, 0, 32, 64);
    g.fillStyle = "#68BE8D"; g.fillRect(32, 0, 32, 64);
    return c.toDataURL("image/png").split(",")[1];
  });
  var file = { name: "two.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") };
  async function uploadAndPick(n) {
    await page.setInputFiles("#at-file", file);
    await page.waitForSelector("#at-swatches");
    for (var i = 0; i < n; i++) await tap('[data-at-pick="' + i + '"]');
    await tap("#at-collect");
  }
  await uploadAndPick(2);
  await uploadAndPick(1);
  s = await state();
  assert.strictEqual(s.mats.length, 3);
  assert.strictEqual(s.basket.n, 4);
  var cats = s.mats.map(function (m) { return m.category; }).sort();
  assert(cats.indexOf("liquid") >= 0 && cats.indexOf("plant") >= 0, "應有液體與植物：" + cats);
  assert(s.mats.some(function (m) { return m.colorId === "ruri"; }), "瑠璃色應配對到傳統色 ruri");

  // 調和：教學、選配方、選素材
  await tap('[data-at-tab="lab"]');
  assert(await page.$("#at-line.at-tutorial"), "前 3 次調和要顯示教學");
  await tap('[data-at-recipe="heal"]');
  var liquid = s.mats.filter(function (m) { return m.category === "liquid"; })[0].uid;
  var plant = s.mats.filter(function (m) { return m.category === "plant"; })[0].uid;
  var other = s.mats.filter(function (m) { return m.uid !== liquid && m.uid !== plant; })[0].uid;
  await page.selectOption('[data-at-slot="0"]', String(liquid));
  await page.selectOption('[data-at-slot="1"]', String(plant));
  await page.selectOption('[data-at-slot="2"]', String(other));
  await tap("#at-start");
  await page.waitForSelector("#at-board");

  // 找一個放得下的位置：點一次預覽（出現虛線），再點一次放下
  async function placeSelected() {
    var pos = await page.evaluate(function () {
      var ui = window.PriTestAtelier._debugUi(), s = ui.session, B = window.PriTestAtelierCore.method(s.method);
      for (var y = 0; y < s.size; y++) for (var x = 0; x < s.size; x++) if (B.canPlace(s, ui.sel, x, y, ui.rot)) return x + "," + y;
      return null;
    });
    assert(pos, "應有可放置的位置");
    await tap('[data-at-cell="' + pos + '"]');
    assert(await page.$(".at-ghost"), "第 1 次點擊應出現預覽");
    await tap('[data-at-cell="' + pos + '"]');
  }
  await tap("#at-rot");
  await placeSelected();
  var placed = await page.evaluate(function () { return window.PriTestAtelier._debugUi().session.placed.slice(); });
  assert.deepStrictEqual(placed, [true, false, false]);
  await tap("#at-undo");
  placed = await page.evaluate(function () { return window.PriTestAtelier._debugUi().session.placed.slice(); });
  assert.deepStrictEqual(placed, [false, false, false]);
  for (var k = 0; k < 3; k++) await placeSelected();
  await page.waitForSelector("#at-traits");
  assert(await page.$("#at-push"), "放完後要顯示最後一推");
  // 2026-11-21：色彩散步的顏色依時間而變，第一個特性可能是「色之祝福」（成本 18 > Lv1 上限 15）而讓完成鍵停用。
  // 改成只勾成本在上限內的特性（規格沒變，只是讓測試不受當下時間影響）
  var fit = await page.evaluate(function () {
    var A = window.PriTestAtelier, C = window.PriTestAtelierCore, D = window.PriTestAtelierData, cap = C.traitCap(A._debugState());
    var el = Array.prototype.filter.call(document.querySelectorAll("[data-at-trait]"), function (x) { return D.TRAITS[x.dataset.atTrait].cost <= cap; })[0];
    return el ? el.dataset.atTrait : null;
  });
  if (fit) await page.check('[data-at-trait="' + fit + '"]');
  await tap("#at-finish");
  await page.waitForSelector("#at-result");
  s = await state();
  assert.strictEqual(s.items.length, 1);
  assert.strictEqual(s.mats.length, 0);
  assert(s.cooldownUntil > Date.now());
  assert.strictEqual(s.tutorial, 1);
  assert.strictEqual(s.hosts.ruri.aff, 2);

  // 冷卻中 → 開發面板跳過
  await tap("#at-result-close");
  await page.waitForSelector("#at-cooldown");
  await tap("#at-dev-cool");
  await page.waitForSelector("#at-recipes");

  // 委託：品質 30 以上的治癒藥水可以交貨
  await tap('[data-at-tab="tasks"]');
  var itemQ = s.items[0].quality, uid = s.items[0].uid;
  var btn = '[data-at-deliver="' + uid + '"]';
  if (itemQ >= 30) {
    await tap(btn);
    s = await state();
    assert.strictEqual(s.hosts.ruri.task, 1);
    assert.strictEqual(s.items.length, 0);
  } else {
    assert(await page.$eval(btn, function (b) { return b.disabled; }), "品質不足不能交貨");
  }

  // 語言切換
  await page.evaluate(function () { window.I18N.setLang("ja"); });
  // 2026-11-21 起分頁加上圖示（.at-tab-icon），只比對文字標籤
  assert.strictEqual((await page.textContent('[data-at-tab="gather"] .at-tab-label')).trim(), "色あつめ");
  await page.evaluate(function () { window.I18N.setLang("zh"); });

  // 手機寬度不橫向捲動
  var over = await page.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
  assert(over <= 0, "橫向捲動 " + over + "px");

  // 色彩散步（沒有相機時）
  await tap('[data-at-tab="gather"]');
  await tap("#at-walk");
  await page.waitForSelector("#at-swatches");
  assert(await page.$("#at-scene"));

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("ui_check ok");
})().catch(function (e) { console.error(e); process.exit(1); });
