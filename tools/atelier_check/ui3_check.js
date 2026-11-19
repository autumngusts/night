// 煉金術士（atelier）第 3 階段 Playwright 流程檢查：
//   存檔調整成 Lv3、灰燼 40、好感度 40 → 工房：進階開關與製作擴張觸媒 → 採色
//   → 調和治癒藥水（使用擴張觸媒、6×6、混色顯示、請瑠璃幫忙）→ 結果 → 回放（下一手、播放、關閉）
//   → 每週挑戰（不消耗素材、經驗 +20、最佳分數）→ 手機寬度 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8973 --directory dist
// 執行：node tools/atelier_check/ui3_check.js
"use strict";
var path = require("path"), assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;
var BASE = (process.env.ATELIER_ROOT || "http://localhost:8973/") + "atelier/index.html";
var KEY = "pritest-atelier-save-v1";

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 375, height: 800 } }), errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  async function state() { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestAtelier._debugState())); }); }
  async function tap(sel) { await page.dispatchEvent(sel, "click"); }
  async function placeAll() {
    for (;;) {
      var pos = await page.evaluate(function () {
        var ui = window.PriTestAtelier._debugUi(), s = ui.session, B = window.PriTestAtelierCore.method(s.method);
        if (B.done(s)) return "done";
        for (var r = 0; r < 4; r++) for (var y = 0; y < s.size; y++) for (var x = 0; x < s.size; x++) if (B.canPlace(s, ui.sel, x, y, ui.rot)) return x + "," + y;
        return null;
      });
      if (pos === "done") return;
      assert(pos, "應有可放置的位置");
      await tap('[data-at-cell="' + pos + '"]');
      await tap('[data-at-cell="' + pos + '"]');
    }
  }

  await page.goto(BASE);
  await page.evaluate(function (k) { localStorage.removeItem(k); }, KEY);
  await page.reload();
  // 先讓 App 建立完整存檔，再只改需要的欄位（CLAUDE.md §4.4）
  await page.evaluate(function (k) {
    var s = window.PriTestAtelier._debugState();
    localStorage.setItem(k, JSON.stringify(s));
    var v = JSON.parse(localStorage.getItem(k));
    v.exp = 200; v.ash = 40; v.hosts.ruri.aff = 40;
    localStorage.setItem(k, JSON.stringify(v));
  }, KEY);
  await page.reload();

  // 工房：進階開關、製作擴張觸媒
  await tap('[data-at-tab="shop"]');
  assert(await page.$eval("#at-advanced", function (c) { return c.checked; }));
  await tap('[data-at-make="expand"]');
  var s = await state();
  assert.strictEqual(s.catalysts.expand, 1);
  assert.strictEqual(s.ash, 40 - 6);

  // 採色：瑠璃色＋若竹色 ×2
  await tap('[data-at-tab="gather"]');
  var b64 = await page.evaluate(function () {
    var c = document.createElement("canvas"); c.width = 64; c.height = 64;
    var g = c.getContext("2d");
    g.fillStyle = "#1E50A2"; g.fillRect(0, 0, 32, 64); g.fillStyle = "#68BE8D"; g.fillRect(32, 0, 32, 64);
    return c.toDataURL("image/png").split(",")[1];
  });
  for (var k = 0; k < 2; k++) {
    await page.setInputFiles("#at-file", { name: "t.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
    await page.waitForSelector("#at-swatches");
    await tap('[data-at-pick="0"]'); await tap('[data-at-pick="1"]');
    await tap("#at-collect");
  }
  s = await state();
  var liquid = s.mats.filter(function (m) { return m.category === "liquid"; }).map(function (m) { return m.uid; });
  var plant = s.mats.filter(function (m) { return m.category === "plant"; }).map(function (m) { return m.uid; });

  // 調和：擴張觸媒、瑠璃幫忙
  await tap('[data-at-tab="lab"]');
  await tap('[data-at-recipe="heal"]');
  await page.selectOption('[data-at-slot="0"]', String(liquid[0]));
  await page.selectOption('[data-at-slot="1"]', String(plant[0]));
  await page.selectOption('[data-at-slot="2"]', String(liquid[1]));
  await page.selectOption("#at-catalyst", "expand");
  await tap("#at-start");
  await page.waitForSelector("#at-board");
  assert.strictEqual(await page.$$eval("#at-board [data-at-cell]", function (x) { return x.length; }), 36, "擴張觸媒 → 6×6");
  assert(await page.$("#at-mix"), "進階規則要顯示混色／互補色");
  await page.waitForSelector("#at-help");
  await tap("#at-help");
  var placed = await page.evaluate(function () { return window.PriTestAtelier._debugUi().session.placed.slice(); });
  assert.deepStrictEqual(placed, [true, false, false]);
  assert.strictEqual(await page.$("#at-help"), null, "每次調和只能幫忙 1 次");
  await placeAll();
  await page.waitForSelector("#at-great-chance");
  await tap("#at-finish");
  await page.waitForSelector("#at-result");
  s = await state();
  assert.strictEqual(s.catalysts.expand, 0, "觸媒完成時消耗");
  var item = s.items[s.items.length - 1];
  assert.strictEqual(item.replay.moves.length, 3);

  // 回放
  await tap('[data-at-replay="' + item.uid + '"]');
  await page.waitForSelector("#at-replay");
  assert((await page.textContent("#at-replay-step")).indexOf("0/3") >= 0);
  await tap("#at-replay-next");
  assert((await page.textContent("#at-replay-step")).indexOf("1/3") >= 0);
  await tap("#at-replay-play");
  await page.waitForFunction(function () { var e = document.querySelector("#at-replay-step"); return e && e.textContent.indexOf("3/3") >= 0; }, null, { timeout: 5000 });
  await tap("#at-replay-close");
  assert.strictEqual(await page.$("#at-replay"), null);
  await tap("#at-result-close");

  // 每週挑戰
  var matsBefore = (await state()).mats.length, expBefore = (await state()).exp;
  await tap('[data-at-tab="tasks"]');
  await tap("#at-weekly-start");
  await page.waitForSelector("#at-challenge-banner");
  await placeAll();
  await tap("#at-finish");
  await page.waitForSelector("#at-challenge-result");
  s = await state();
  assert.strictEqual(s.mats.length, matsBefore);
  assert.strictEqual(s.exp, expBefore + 20);
  assert.strictEqual(s.weekly.plays, 1);
  assert(s.weekly.best > 0);
  await tap("#at-challenge-close");

  for (var tab of ["gather", "box", "lab", "tasks", "dex", "shop"]) {
    await tap('[data-at-tab="' + tab + '"]');
    var over = await page.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    assert(over <= 0, tab + " 橫向捲動 " + over + "px");
  }
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("ui3_check ok");
})().catch(function (e) { console.error(e); process.exit(1); });
