// 煉金術士（atelier）第 2 階段 Playwright 流程檢查：
//   今日之色＋墨的圖片採集（每日色彩經驗、連續採色、圖鑑、發想「影之斗篷」）→ 白平衡校正
//   → 圖鑑分頁 → 工房：灰燼升級銅之大釜 → 同色 3 個升華 → 選釜調和色彩墨水
//   → 成品再投入第二次調和（成品被用掉）→ 第 1 階段存檔遷移 → 語言切換 → 手機寬度 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8973 --directory dist
// 執行：node tools/atelier_check/ui2_check.js
// 注意（CLAUDE.md §4.6）：畫面每次操作都會整個重繪，一律用 dispatchEvent 觸發。
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
  // 在頁面裡畫 64×64 的圖：colors 依序由左到右等寬排列
  async function png(colors) {
    var b64 = await page.evaluate(function (cs) {
      var c = document.createElement("canvas"); c.width = 64; c.height = 64;
      var g = c.getContext("2d"), w = 64 / cs.length;
      cs.forEach(function (hex, i) { g.fillStyle = hex; g.fillRect(Math.round(i * w), 0, Math.ceil(w), 64); });
      return c.toDataURL("image/png").split(",")[1];
    }, colors);
    return { name: "t.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") };
  }
  async function upload(colors) {
    await page.setInputFiles("#at-file", await png(colors));
  }
  async function placeAll() {
    for (;;) {
      var pos = await page.evaluate(function () {
        var ui = window.PriTestAtelier._debugUi(), s = ui.session, B = window.PriTestAtelierCore.method(s.method);
        if (B.done(s)) return "done";
        for (var y = 0; y < s.size; y++) for (var x = 0; x < s.size; x++) if (B.canPlace(s, ui.sel, x, y, ui.rot)) return x + "," + y;
        return null;
      });
      if (pos === "done") return;
      assert(pos, "應有可放置的位置");
      await tap('[data-at-cell="' + pos + '"]');
      await tap('[data-at-cell="' + pos + '"]');
    }
  }
  async function synth(recipe, pickItem) {
    await tap('[data-at-tab="lab"]');
    await tap('[data-at-recipe="' + recipe + '"]');
    assert(await page.$("#at-cauldron"), "要能選錬金釜");
    var n = await page.$$eval("[data-at-slot]", function (x) { return x.length; });
    for (var i = 0; i < n; i++) {
      var opts = await page.$$eval('[data-at-slot="' + i + '"] option', function (x) { return x.map(function (o) { return { v: o.value, t: o.textContent }; }); });
      var want = opts.filter(function (o) { return o.v && (i === 0 && pickItem ? o.t.indexOf("★") === 0 : o.t.indexOf("★") !== 0); })[0];
      assert(want, "第 " + i + " 格沒有可選的素材");
      await page.selectOption('[data-at-slot="' + i + '"]', want.v);
    }
    await tap("#at-start");
    await page.waitForSelector("#at-board");
    await placeAll();
    await page.waitForSelector("#at-traits");
    await tap("#at-finish");
    await page.waitForSelector("#at-result");
    await tap("#at-result-close");
    await tap("#at-dev-cool");
  }

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-atelier-save-v1"); });
  await page.reload();

  // 今日之色＋墨
  var daily = await page.evaluate(function () { return window.PriTestAtelierCore.dailyColor(Date.now()).hex; });
  assert(await page.$("#at-daily"));
  await upload([daily, "#595857"]);
  await page.waitForSelector("#at-swatches");
  var swN = await page.$$eval("[data-at-pick]", function (x) { return x.length; });
  for (var i = 0; i < swN; i++) await tap('[data-at-pick="' + i + '"]');
  await tap("#at-collect");
  var s = await state();
  assert(s.daily.date, "應記錄今天已拍到今日之色");
  assert.strictEqual(s.streak.n, 1);
  assert(s.exp >= 50, "每日色彩經驗");
  assert(s.seen.sumi, "墨要記入圖鑑");
  assert(s.ideas.shade, "拍到墨要想到影之斗篷");
  assert((await page.textContent("#at-msg")).length > 0);

  // 白平衡：偏黃的白紙
  await tap("#at-wb");
  await page.waitForSelector("#at-wb-hint");
  await upload(["#FAE6B4"]);
  s = await state();
  assert(s.wb && s.wb.until > Date.now(), "白平衡要生效");
  assert((await page.textContent("#at-wb-status")).length > 0);
  assert.strictEqual(s.basket.n, 5, "校正不消耗採集籃");

  // 圖鑑
  await tap('[data-at-tab="dex"]');
  var seenN = Object.keys(s.seen).length;
  assert((await page.textContent("#at-dex-progress")).indexOf(seenN + "/") >= 0);
  assert(await page.$('[data-at-dex="sumi"]'));

  // 工房：灰燼升級
  await tap("#at-dev-ash");
  await tap('[data-at-tab="shop"]');
  assert(await page.$eval('[data-at-unlock="iron"]', function (b) { return b.disabled; }), "Lv1 不能解鎖鐵之大釜");
  await tap('[data-at-upgrade="copper"]');
  s = await state();
  assert.strictEqual(s.cauldrons.copper, 2);
  assert.strictEqual(s.ash, 20 - 10);

  // 升華：同一個紅色採 3 次
  await tap('[data-at-tab="gather"]');
  var red = daily === "#D7003A" ? { hex: "#1E50A2", id: "ruri" } : { hex: "#D7003A", id: "beni" };   // 避開今日之色
  for (var k = 0; k < 3; k++) {
    await upload([red.hex]);
    await page.waitForSelector("#at-swatches");
    await tap('[data-at-pick="0"]');
    await tap("#at-collect");
  }
  s = await state();
  var reds = s.mats.filter(function (m) { return m.colorId === red.id; }).map(function (m) { return m.uid; });
  assert.strictEqual(reds.length, 3);
  var before = s.mats.length;
  await tap('[data-at-tab="box"]');
  for (var r = 0; r < 3; r++) await page.check('[data-at-sub="' + reds[r] + '"]');
  await tap("#at-sublimate");
  s = await state();
  assert.strictEqual(s.mats.length, before - 2);
  assert(s.mats.some(function (m) { return m.sublimated; }));

  // 調和色彩墨水 → 成品再投入
  await synth("ink", false);
  s = await state();
  assert.strictEqual(s.items.length, 1);
  var firstItem = s.items[0].uid;
  assert.strictEqual(s.made.ink, 1);
  await synth("ink", true);
  s = await state();
  assert.strictEqual(s.items.length, 1, "投入的成品要被用掉");
  assert.notStrictEqual(s.items[0].uid, firstItem);
  assert.strictEqual(s.made.ink, 2);

  // 配方列表：未發想的配方顯示提示
  await tap('[data-at-tab="lab"]');
  assert(await page.$eval('[data-at-recipe="pigment"]', function (b) { return b.disabled; }));

  // 第 1 階段存檔遷移：拿掉第 2 階段的欄位後重新載入
  await page.evaluate(function () {
    var k = "pritest-atelier-save-v1", v = JSON.parse(localStorage.getItem(k));
    ["ideas", "made", "ash", "cauldrons", "shelf", "streak", "daily", "wb"].forEach(function (f) { delete v[f]; });
    localStorage.setItem(k, JSON.stringify(v));
  });
  var expBefore = (await state()).exp;
  await page.reload();
  s = await state();
  assert.deepStrictEqual(s.cauldrons, { copper: 1 });
  assert.strictEqual(s.exp, expBefore);
  assert(s.ideas.shade, "載入時重新檢查發想");

  // 語言切換、手機寬度
  await page.evaluate(function () { window.I18N.setLang("ja"); });
  assert.strictEqual((await page.textContent('[data-at-tab="dex"]')).trim(), "図鑑");
  await page.evaluate(function () { window.I18N.setLang("zh"); });
  for (var tab of ["gather", "box", "lab", "tasks", "dex", "shop"]) {
    await tap('[data-at-tab="' + tab + '"]');
    var over = await page.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    assert(over <= 0, tab + " 橫向捲動 " + over + "px");
  }

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("ui2_check ok");
})().catch(function (e) { console.error(e); process.exit(1); });
