// 煉金術士（atelier）第 5 階段 Playwright 流程檢查：
//   Lv1 時其他工房主人鎖住 → 存檔調整成 Lv5 → 採色 → 依序前往茜（循環）、翠（熬煮）、雫（調色）、黒曜（結晶）的工房，
//   各調和一次色彩墨水（教學、各自的畫面、完成、回放的方法正確）→ 手機寬度 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8973 --directory dist
// 執行：node tools/atelier_check/ui5_check.js
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
  async function png(colors) {
    var b64 = await page.evaluate(function (cs) {
      var c = document.createElement("canvas"); c.width = 64; c.height = 64;
      var g = c.getContext("2d"), w = 64 / cs.length;
      cs.forEach(function (hex, i) { g.fillStyle = hex; g.fillRect(Math.round(i * w), 0, Math.ceil(w) + 1, 64); });
      return c.toDataURL("image/png").split(",")[1];
    }, colors);
    return { name: "t.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") };
  }

  await page.goto(BASE);
  await page.evaluate(function (k) { localStorage.removeItem(k); }, KEY);
  await page.reload();
  await tap('[data-at-tab="shop"]');
  assert(await page.$eval('[data-at-host="akane"]', function (b) { return b.disabled; }), "Lv1 時茜的工房鎖住");

  // 先讓 App 建立完整存檔，再只改等級（CLAUDE.md §4.4）
  await page.evaluate(function (k) {
    var v = JSON.parse(JSON.stringify(window.PriTestAtelier._debugState()));
    v.exp = 400;
    localStorage.setItem(k, JSON.stringify(v));
  }, KEY);
  await page.reload();

  await tap('[data-at-tab="gather"]');
  var pairs = [["#E83929", "#1E50A2"], ["#3EB370", "#F8B500"], ["#884898", "#D7003A"], ["#0095D9", "#C3D825"]];
  for (var pi = 0; pi < pairs.length; pi++) {
    await page.setInputFiles("#at-file", await png(pairs[pi]));
    await page.waitForSelector("#at-swatches");
    await tap('[data-at-pick="0"]'); await tap('[data-at-pick="1"]');
    await tap("#at-collect");
  }
  assert.strictEqual((await state()).mats.length, 8);

  var hosts = [["akane", "ring", "#at-ring"], ["sui", "brew", "#at-brew"], ["shizuku", "palette", "#at-palette"], ["kokuyou", "gravity", "#at-board"]];
  for (var h of hosts) {
    await tap('[data-at-tab="shop"]');
    await tap('[data-at-host="' + h[0] + '"]');
    assert.strictEqual((await state()).host, h[0]);
    await tap('[data-at-tab="lab"]');
    assert(await page.$("#at-line.at-tutorial"), h[0] + " 的教學");
    await tap('[data-at-recipe="ink"]');
    for (var i = 0; i < 2; i++) {
      var opts = await page.$$eval('[data-at-slot="' + i + '"] option', function (x) {
        return x.map(function (o) { return { v: o.value, t: o.textContent }; }).filter(function (o) { return o.v && o.t.indexOf("★") !== 0; });
      });
      await page.selectOption('[data-at-slot="' + i + '"]', opts[0].v);
    }
    await tap("#at-start");
    await page.waitForSelector(h[2]);
    assert(await page.$("#at-method"));
    for (;;) {
      var pos = await page.evaluate(function () {
        var ui = window.PriTestAtelier._debugUi(), s = ui.session, M = window.PriTestAtelierCore.method(s.method);
        if (M.done(s)) return "done";
        var o = M.options ? M.options(s, ui.sel) : [];
        if (s.method === "board") {
          for (var y = 0; y < s.size; y++) for (var x = 0; x < s.size; x++) if (M.canPlace(s, ui.sel, x, y, ui.rot)) return x + "," + y;
          return null;
        }
        o = o.filter(function (q) { return q[2] === ui.rot; });
        return o.length ? o[0][0] + ",0" : null;
      });
      if (pos === "done") break;
      assert(pos, h[0] + " 應有可放置的位置");
      await tap('[data-at-cell="' + pos + '"]');
      await tap('[data-at-cell="' + pos + '"]');
    }
    await page.waitForSelector("#at-traits");
    await tap("#at-finish");
    await page.waitForSelector("#at-result");
    var s = await state();
    var item = s.items[s.items.length - 1];
    assert.strictEqual(item.replay.method, h[1]);
    assert.strictEqual(s.hosts[h[0]].tut, 1);
    await tap('[data-at-replay="' + item.uid + '"]');
    await page.waitForSelector("#at-replay");
    await tap("#at-replay-next");
    await tap("#at-replay-close");
    await tap("#at-result-close");
    await tap("#at-dev-cool");
  }
  assert.strictEqual((await state()).tutorial, 0, "瑠璃的教學計數不動");

  for (var tab of ["gather", "box", "lab", "tasks", "dex", "book", "shop"]) {
    await tap('[data-at-tab="' + tab + '"]');
    var over = await page.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    assert(over <= 0, tab + " 橫向捲動 " + over + "px");
  }
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("ui5_check ok");
})().catch(function (e) { console.error(e); process.exit(1); });
