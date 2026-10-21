// ============================================================================
// katana 鍛刀多局掃描（2026-10-21）：每一局的 seed 不同，抽到的工序小遊戲組合也不同。
//   確認每一局都能從材料一路鍛到最後（13 道工序 → 審查 → 試斬 → 互擊 → 總結），
//   表演／較真、好打法／差打法、不同刀種輪流；互擊輪流用陀螺／試合模式並打到分出勝負。
// 前置：py -3 generate.py；py -3 -m http.server 8944 --directory dist
// 執行：node tools/katana_check/forge_sweep_check.js（GAMES=6 可改局數）
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;
var U = require("./ui_check.js");

var BASE = process.env.KATANA_BASE || "http://localhost:8944/katana/index.html";
var GAMES = Number(process.env.GAMES || 6);
var TYPES = ["uchigatana", "tachi", "wakizashi", "odachi", "broadsword", "jian", "sabre", "tanto"];

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); console.log("PAGEERROR", e.stack || String(e)); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); localStorage.setItem("pritest-lang", "zh"); });
  await page.reload();
  await page.waitForSelector("#kt-app .kt-panel");

  var games = [];
  for (var g = 0; g < GAMES; g++) {
    var mode = g % 2 ? "serious" : "show", q = g % 3 === 2 ? 0.5 : 1, arenaMode = g % 2 ? "koma" : "shiai";
    var type = TYPES[g % TYPES.length];
    U.setQuality(q);
    if (g > 0) {
      await U.mustClick(page, "kt_new_game");
      await page.waitForSelector(".kt-names");
    }
    await page.evaluate(function (m) { document.querySelector('input[name="mode"][value="' + m + '"]').dispatchEvent(new Event("change")); }, mode);
    // 單人局（第 3、6…局兩人）
    if (g % 3 !== 2) await page.evaluate(function () { var b = document.querySelector(".kt-names .kt-link"); if (b) b.click(); });
    await U.mustClick(page, "kt_start");
    var before = U.scores().length;
    await U.forgeAll(page, async function (pg, pi) {
      await pg.evaluate(function (ty) {
        var sp = document.querySelector(".kt-special"); if (sp) sp.open = true;
        var r = document.querySelector('input[name="type"][value="' + ty + '"]');
        if (r && !r.disabled) r.dispatchEvent(new Event("change"));
      }, pi ? "uchigatana" : type);
    });
    var s = await U.st(page);
    assert.strictEqual(s.phase, "judge", "game " + g + " reaches judge, phase " + s.phase);
    var played = U.scores().slice(before).map(function (x) { return x.kind.split(" ").pop().replace(/^kt-(tg-)?/, "") + "=" + x.acc; });
    // 審查 → 試斬（直接略過到互擊面板）
    await U.mustClick(page, "kt_go_cut");
    for (var c = 0; c < 12; c++) {
      if (!(await U.clickKey(page, "kt_swing_ready"))) { if (!(await U.clickKey(page, "kt_next"))) break; continue; }
      await page.waitForTimeout(120);
      await U.mustClick(page, "kt_swing_hit");
      await U.mustClick(page, "kt_cut_do");
      await U.mustClick(page, "kt_next");
    }
    // 互擊：加一把對手刀，選對刀模式
    await page.evaluate(function () { var cb = document.querySelector('.kt-check input[type="checkbox"]'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change")); } });
    await page.evaluate(function (m) { document.querySelector('input[name="clashMode"][value="' + m + '"]').dispatchEvent(new Event("change")); }, arenaMode);
    await U.mustClick(page, "kt_go_clash");
    await page.waitForSelector(".kt-arena-canvas");
    var am = await page.evaluate(function () { return window.PriTestKatana._ui().arena.mode; });
    assert.strictEqual(am, arenaMode, "clash arena mode");
    await page.waitForTimeout(800);
    await U.mustClick(page, "kt_ar_skip");
    await page.waitForTimeout(100);
    s = await U.st(page);
    assert.ok(s.clash.winner, "game " + g + " clash winner");
    assert.strictEqual(s.clash.mode, arenaMode, "clash mode saved");
    await U.mustClick(page, "kt_to_final");
    await page.waitForSelector(".kt-table");
    s = await U.st(page);
    assert.strictEqual(s.phase, "end", "game " + g + " ends");
    await U.noMissingKeys(page);
    var line = "game " + g + " " + mode + " q" + q + " " + s.players.map(function (p) { return p.blade.type + " total " + (p.blade.total !== undefined ? p.blade.total : "?") + (p.blade.flaws.length ? " flaws " + p.blade.flaws.join("/") : ""); }).join(" | ") +
      " | arena " + arenaMode + " winner " + s.clash.winner + "\n   games: " + played.join(" ");
    line += "\n   heap MB " + await page.evaluate(function () { return performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1; });
    console.log(line);
    games.push(line);
  }
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("katana forge_sweep_check OK (" + GAMES + " games)");
})().catch(function (e) { console.error(e); process.exit(1); });
