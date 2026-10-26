// ============================================================================
// DÉJÀ VU（dejavu）Playwright 流程檢查：
//   設定（加玩家、季節、模式）→ 山路（固定山路、輪流建造到完成、微調一段）→ 車庫（換廠牌、自製車、改裝）
//   → 比賽（跑幾秒、截圖、跳到結果）→ 結果 → Déjà vu 重播結果一致 → 三種語言沒有漏翻的 dv_ 鍵
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8946 --directory dist
// 執行：node tools/dejavu_check/ui_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.DEJAVU_BASE || "http://localhost:8946/dejavu/index.html";
var SHOT_DIR = process.env.DEJAVU_SHOTS || path.join(__dirname, "shots");

async function clickText(page, label) {
  var ok = await page.evaluate(function (l) {
    var b = Array.prototype.filter.call(document.querySelectorAll("#dv-app button"), function (x) { return x.textContent.trim() === l && !x.disabled; })[0];
    if (!b) return false;
    b.click();
    return true;
  }, label);
  assert.ok(ok, "找不到按鈕：" + label);
}
async function clickKey(page, key, params) {
  var label = await page.evaluate(function (a) { return window.I18N.t(a[0], a[1]); }, [key, params || {}]);
  await clickText(page, label);
}
async function noRawKeys(page, where) {
  var raw = await page.evaluate(function () { return (document.getElementById("dv-app").innerText.match(/dv_[a-zA-Z_]+/g) || []); });
  assert.deepStrictEqual(raw, [], where + " 有漏翻的鍵：" + raw.join(","));
}
function screen(page) { return page.evaluate(function () { return window.PriTestDejavu.ui().screen; }); }

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-dejavu-setup"); });
  await page.reload();
  await page.waitForFunction(function () { return !!window.PriTestDejavu; });

  // ---- 1. 設定 ----
  await noRawKeys(page, "設定");
  await clickKey(page, "dv_add_player");
  await page.fill(".dv-player-row:nth-child(2) .dv-name", "拓海");
  var winter = await page.evaluate(function () { return "❄️ " + window.PriTestDejavuData.SEASONS.winter.name[window.I18N.getLang()]; });
  await clickText(page, winter);
  var s = await page.evaluate(function () { return window.PriTestDejavu.setup(); });
  assert.strictEqual(s.players.length, 3);
  assert.strictEqual(s.players[0].name, "拓海");
  assert.strictEqual(s.season, "winter");
  await clickKey(page, "dv_next_course");
  assert.strictEqual(await screen(page), "course");

  // ---- 2. 山路：固定山路 → 輪流建造 ----
  await noRawKeys(page, "山路");
  var hakone = await page.evaluate(function () { return window.PriTestDejavuData.course("hakone").name[window.I18N.getLang()]; });
  await page.evaluate(function (n) {
    var c = Array.prototype.filter.call(document.querySelectorAll(".dv-card"), function (x) { return x.textContent.indexOf(n) >= 0; })[0];
    c.click();
  }, hakone);
  s = await page.evaluate(function () { return window.PriTestDejavu.setup(); });
  assert.strictEqual(s.course.src, "hakone");
  await page.screenshot({ path: path.join(SHOT_DIR, "course_fixed.png"), fullPage: true });

  await clickKey(page, "dv_ctab_build");
  await clickKey(page, "dv_build_start");
  var pieceCount = 0;
  for (var turn = 0; turn < 9; turn++) {
    var label = await page.evaluate(function (i) {
      var bs = document.querySelectorAll(".dv-piece");
      return bs.length ? bs[i % bs.length].textContent.trim() : null;
    }, turn);
    assert.ok(label, "第 " + turn + " 回合沒有零件按鈕");
    if (turn === 4) await clickKey(page, "dv_right");
    if (turn === 1) {
      // 自訂路段：轉 150°、半徑 25 m（右彎）
      await page.evaluate(function () { document.querySelector(".dv-custom-piece").open = true; });
      await clickKey(page, "dv_seg_c");
      await page.evaluate(function () {
        var rs = document.querySelectorAll(".dv-custom-piece input[type=range]");
        rs[0].value = "150"; rs[0].dispatchEvent(new Event("input"));
        rs[1].value = "25"; rs[1].dispatchEvent(new Event("input"));
      });
      await clickKey(page, "dv_right");
      await clickKey(page, "dv_cp_place");
      await clickKey(page, "dv_left");
      continue;
    }
    await page.evaluate(function (i) { var bs = document.querySelectorAll(".dv-piece"); bs[i % bs.length].click(); }, turn);
    pieceCount++;
  }
  s = await page.evaluate(function () { return window.PriTestDejavu.setup(); });
  assert.strictEqual(s.build.pieces.length, 9, "3 人 × 3 塊");
  assert.deepStrictEqual(s.build.pieces.map(function (p) { return p.o; }), [0, 1, 2, 0, 1, 2, 0, 1, 2], "輪流順序");
  assert.ok(s.course.segs.some(function (x) { return x.t === "C" && x.ang < 0; }), "應該有右彎");
  assert.ok(s.course.segs.some(function (x) { return x.t === "C" && x.ang === -150 && x.r === 25 && x.o === 1; }), "自訂路段沒有放上去");
  assert.strictEqual(await page.locator(".dv-piece").count(), 0, "建造完成後零件要收起來");
  // 微調：第一段直線改成 300 m
  await page.evaluate(function () { document.querySelector(".dv-segs").open = true; });
  await page.fill(".dv-seg:first-child input[type=number]", "300");
  await page.dispatchEvent(".dv-seg:first-child input[type=number]", "change");
  s = await page.evaluate(function () { return window.PriTestDejavu.setup(); });
  assert.strictEqual(s.course.segs[0].len, 300, "微調沒有生效");
  await page.screenshot({ path: path.join(SHOT_DIR, "course_build.png"), fullPage: true });
  await clickKey(page, "dv_next_garage");
  assert.strictEqual(await screen(page), "garage");

  // ---- 3. 車庫 ----
  await noRawKeys(page, "車庫");
  await page.selectOption(".dv-brand", "tesla");
  s = await page.evaluate(function () { return window.PriTestDejavu.setup(); });
  assert.ok(["m3p", "plaid"].indexOf(s.cars[0].car) >= 0, "換廠牌後車款要跟著換");
  await page.selectOption(".dv-model", "plaid");
  var snow = await page.evaluate(function () { return window.PriTestDejavuData.TIRES.snow.name[window.I18N.getLang()]; });
  await clickText(page, snow);
  await page.evaluate(function () { document.querySelectorAll(".dv-tab")[1].click(); });
  await page.selectOption(".dv-brand", "custom");
  await page.evaluate(function () { document.querySelectorAll(".dv-tab")[2].click(); });
  await page.selectOption(".dv-brand", "toyota");
  await page.selectOption(".dv-model", "ae86");
  for (var u = 0; u < 3; u++) await page.evaluate(function () { document.querySelectorAll(".dv-up")[1].querySelectorAll("button")[1].click(); });
  s = await page.evaluate(function () { return window.PriTestDejavu.setup(); });
  assert.strictEqual(s.cars[0].car, "plaid");
  assert.strictEqual(s.cars[0].tire, "snow");
  assert.strictEqual(s.cars[1].car, "custom");
  assert.strictEqual(s.cars[2].up.wt, 3);
  await page.screenshot({ path: path.join(SHOT_DIR, "garage.png"), fullPage: true });
  await clickKey(page, "dv_go");

  // ---- 4. 比賽 ----
  assert.strictEqual(await screen(page), "race");
  await page.evaluate(function () { Array.prototype.filter.call(document.querySelectorAll(".dv-ctrl button"), function (b) { return b.textContent === "8×"; })[0].click(); });
  await page.waitForFunction(function () { return window.PriTestDejavu.race().t > 12; }, null, { timeout: 20000 });
  await page.screenshot({ path: path.join(SHOT_DIR, "race.png") });
  // 戰略：第一位玩家切成「全力」
  var allOut = await page.evaluate(function () { return window.PriTestDejavuData.STYLES.attack.name[window.I18N.getLang()]; });
  await page.evaluate(function (l) {
    var b = Array.prototype.filter.call(document.querySelectorAll(".dv-tac-row")[0].querySelectorAll("button"), function (x) { return x.textContent === l; })[0];
    b.click();
  }, allOut);
  var r0 = await page.evaluate(function () { var r = window.PriTestDejavu.race(); return { style: r.cars[0].styleId, log: r.log.length }; });
  assert.strictEqual(r0.style, "attack", "戰略按鈕沒有生效");
  assert.strictEqual(r0.log, 1);
  // 鏡頭：車內、空拍
  await clickKey(page, "dv_cam_cockpit");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, "race_cockpit.png") });
  await clickKey(page, "dv_cam_drone");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, "race_drone.png") });
  await clickKey(page, "dv_cam_chase");
  var boardRows = await page.locator(".dv-board li").count();
  assert.strictEqual(boardRows, 5, "3 位玩家＋2 台 CPU");
  // 點名次表切換跟拍
  await page.evaluate(function () { document.querySelectorAll(".dv-board li")[2].click(); });
  var fol = await page.evaluate(function () { return window.PriTestDejavu.ui().follow; });
  assert.ok(fol !== null);
  await clickKey(page, "dv_skip");
  assert.strictEqual(await screen(page), "result");
  await noRawKeys(page, "結果");
  var res1 = await page.evaluate(function () { return JSON.stringify(window.PriTestDejavu.result().map(function (r) { return [r.id, r.state, r.time]; })); });
  await page.screenshot({ path: path.join(SHOT_DIR, "result.png"), fullPage: true });

  // ---- 5. Déjà vu ----
  await clickKey(page, "dv_dejavu");
  assert.strictEqual(await screen(page), "race");
  await clickKey(page, "dv_skip");
  var res2 = await page.evaluate(function () { return JSON.stringify(window.PriTestDejavu.result().map(function (r) { return [r.id, r.state, r.time]; })); });
  assert.strictEqual(res2, res1, "Déjà vu 重播結果不同");
  await clickKey(page, "dv_rematch");
  await page.waitForTimeout(300);
  await clickKey(page, "dv_skip");

  // ---- 5b. 車內視角不跳過、自然跑完：終點門架進入視野不能讓畫面迴圈停掉（2026-10-26 的 bug），
  //          要出現衝線停留、冠軍重播，最後自己進結果畫面 ----
  await page.evaluate(function () {
    var s = JSON.parse(localStorage.getItem("pritest-dejavu-setup"));
    s.course = window.PriTestDejavuCore.fixedCourse("usui"); s.build = null; s.season = "summer";
    localStorage.setItem("pritest-dejavu-setup", JSON.stringify(s));
  });
  await page.reload();
  await page.waitForFunction(function () { return !!window.PriTestDejavu; });
  await page.evaluate(function () { window.PriTestDejavu.go("garage"); });
  await clickKey(page, "dv_go");
  await clickKey(page, "dv_cam_cockpit");
  await page.evaluate(function () { Array.prototype.filter.call(document.querySelectorAll(".dv-ctrl button"), function (b) { return b.textContent === "8×"; })[0].click(); });
  var sawHold = false, sawFinal = false;
  for (var w = 0; w < 400 && await screen(page) === "race"; w++) {
    var u5 = await page.evaluate(function () { return window.PriTestDejavu.ui(); });
    if (u5.finHold !== null) sawHold = true;
    if (u5.final && !sawFinal) { sawFinal = true; await page.screenshot({ path: path.join(SHOT_DIR, "race_final_replay.png") }); }
    await page.waitForTimeout(250);
  }
  assert.strictEqual(await screen(page), "result", "車內視角跑完整場沒有自己進到結果畫面");
  assert.ok(sawHold, "沒有衝線停留畫面");
  assert.ok(sawFinal, "沒有冠軍衝線重播");

  // ---- 5c. 奔放模式：設定畫面切規則、比賽中按手牌出牌、機關畫得出來、Déjà vu 照樣一致 ----
  await page.evaluate(function () { window.PriTestDejavu.go("setup"); });
  await clickKey(page, "dv_rule_wild");
  assert.strictEqual((await page.evaluate(function () { return window.PriTestDejavu.setup(); })).rule, "wild");
  await page.evaluate(function () { window.PriTestDejavu.go("garage"); });
  await clickKey(page, "dv_go");
  await page.evaluate(function () { Array.prototype.filter.call(document.querySelectorAll(".dv-ctrl button"), function (b) { return b.textContent === "4×"; })[0].click(); });
  await page.waitForFunction(function () { return window.PriTestDejavu.race().t > 6; }, null, { timeout: 30000 });
  var handN = await page.locator(".dv-hcard").count();
  assert.ok(handN >= 1, "奔放模式沒有手牌按鈕");
  await page.evaluate(function () { document.querySelector(".dv-hcard:not(:disabled)").click(); });
  var cardLog = await page.evaluate(function () { return window.PriTestDejavu.race().log.filter(function (l) { return l.card; }).length; });
  assert.ok(cardLog >= 1, "按手牌沒有出牌");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, "race_wild.png") });
  await clickKey(page, "dv_cam_cockpit");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOT_DIR, "race_wild_cockpit.png") });
  await noRawKeys(page, "奔放模式比賽");
  await clickKey(page, "dv_skip");
  var w1 = await page.evaluate(function () { return JSON.stringify(window.PriTestDejavu.result().map(function (r) { return [r.id, r.state, r.time, r.cards]; })); });
  await clickKey(page, "dv_dejavu");
  await clickKey(page, "dv_skip");
  var w2 = await page.evaluate(function () { return JSON.stringify(window.PriTestDejavu.result().map(function (r) { return [r.id, r.state, r.time, r.cards]; })); });
  assert.strictEqual(w2, w1, "奔放模式 Déjà vu 重播結果不同");
  await page.evaluate(function () { window.PriTestDejavu.go("setup"); });
  await clickKey(page, "dv_rule_real");

  // ---- 6. 重新整理後設定還在、三語 ----
  await page.reload();
  await page.waitForFunction(function () { return !!window.PriTestDejavu; });
  s = await page.evaluate(function () { return window.PriTestDejavu.setup(); });
  assert.strictEqual(s.cars[0].car, "plaid", "重新整理後設定遺失");
  var screens = ["setup", "course", "garage"];
  for (var li = 0; li < 3; li++) {
    var lang = ["zh", "ja", "en"][li];
    await page.click('.lang-btn[data-lang="' + lang + '"]');
    for (var si = 0; si < screens.length; si++) {
      await page.evaluate(function (sc) { window.PriTestDejavu.go(sc); }, screens[si]);
      await noRawKeys(page, lang + "/" + screens[si]);
    }
  }
  // 手機寬度不能有橫向捲動
  await page.setViewportSize({ width: 390, height: 800 });
  for (var mi = 0; mi < screens.length; mi++) {
    await page.evaluate(function (sc) { window.PriTestDejavu.go(sc); }, screens[mi]);
    var over = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
    assert.ok(over <= 1, screens[mi] + " 手機寬度出現橫向捲動 " + over + "px");
  }
  await page.screenshot({ path: path.join(SHOT_DIR, "mobile_garage.png"), fullPage: true });

  assert.deepStrictEqual(errors, [], "頁面錯誤：" + errors.join("\n"));
  await browser.close();
  console.log("✓ dejavu UI 流程通過（截圖在 " + SHOT_DIR + "）");
})().catch(function (e) { console.error("✗", e); process.exit(1); });
