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
  // 2026-11-20 起這個遊戲在「付款」分頁，頁面會先問密碼；測試前先寫入解鎖旗標（layout.PAY_STORAGE_KEY）
  await page.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
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
  assert.strictEqual((await page.$$(".sd-pick-card")).length, 30, "30 人都顯示");
  assert.strictEqual((await page.$$(".sd-pick-card.is-locked")).length, 22, "一開始 22 人未解鎖");
  // 每點一次選隊畫面就重繪，所以每次重新查詢；選已解鎖的第 1、3、5、8 位
  var picks = [0, 2, 4, 7];
  for (var i = 0; i < picks.length; i++) await page.click(".sd-pick-card:not(.is-locked) >> nth=" + picks[i]);
  await page.screenshot({ path: path.join(SHOT_DIR, tag + "_02_pick.png") });
  // 開始遠征 → 地圖（第 1 層可走、全是戰鬥）→ 點第一個節點開戰
  await page.click('[data-act="launch"]');
  await page.waitForSelector(".sd-node.is-reach");
  await page.screenshot({ path: path.join(SHOT_DIR, tag + "_02b_map.png") });
  var reach = await page.$$eval(".sd-node.is-reach", function (ns) { return ns.length; });
  assert.ok(reach >= 2 && reach <= 4, tag + " 第 1 層 2～4 個節點");
  await page.dispatchEvent(".sd-node.is-reach >> nth=0", "click");
  await waitPhase(page, "aim");

  var stars = await page.evaluate(function () { return window.PriTestShedanApp._debug.state().battle.stars.length; });
  assert.ok(stars >= 4 && stars <= 6, tag + " 星點 4～6 個：" + stars);

  // 技能鍵：量表未滿時不能按；墊滿後按下 → 這一發發動、量表歸 0
  assert.ok(await page.$eval('[data-act="skill"]', function (b) { return b.disabled; }), tag + " 量表未滿技能鍵不能按");
  await page.evaluate(function () { window.PriTestShedanApp._debug.fillGauge(); });
  await page.dispatchEvent('[data-act="skill"]', "click");
  assert.ok(await page.$eval('[data-act="skill"]', function (b) { return b.classList.contains("is-armed"); }), tag + " 技能已準備");

  // 拖曳拉弓射出：從畫面中央往下拉（射向上方）
  var hp0 = await page.evaluate(function () { return window.PriTestShedanApp._debug.enemyHp(); });
  var cx = vp.width / 2, cy = vp.height / 2;
  await page.dispatchEvent(".sd-canvas", "pointerdown", { clientX: cx, clientY: cy, pointerId: 1, bubbles: true });
  await page.dispatchEvent(".sd-canvas", "pointermove", { clientX: cx + 10, clientY: cy + 140, pointerId: 1, bubbles: true });
  await page.screenshot({ path: path.join(SHOT_DIR, tag + "_03_aim.png") });
  await page.dispatchEvent(".sd-canvas", "pointerup", { clientX: cx + 10, clientY: cy + 140, pointerId: 1, bubbles: true });
  await waitPhase(page, "shooting", 3000);
  assert.strictEqual(await page.evaluate(function () { var b = window.PriTestShedanApp._debug.state().battle; return b.party[b.active].gauge <= 3 && !!b.shot.skill; }), true, tag + " 技能發動、量表歸 0");
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

  // 強制勝利 → 獎勵三選一 → 選第一件 → 回到地圖（下一層可走）
  var screen = await page.evaluate(function () { return window.PriTestShedanApp._debug.state().screen; });
  if (screen === "battle") await page.evaluate(function () { window.PriTestShedanApp._debug.forceWin(); });
  var lost = await page.evaluate(function () { var r = window.PriTestShedanApp._debug.run(); return r && r.state === "lost"; });
  if (!lost) {
    await page.waitForSelector("[data-relic]", { timeout: 5000 });
    assert.strictEqual((await page.$$("[data-relic]")).length, 3, tag + " 三選一");
    await page.screenshot({ path: path.join(SHOT_DIR, tag + "_06_reward.png") });
    await page.dispatchEvent("[data-relic] >> nth=0", "click");
    await page.waitForSelector(".sd-node.is-reach");
    assert.strictEqual(await page.evaluate(function () { return window.PriTestShedanApp._debug.run().relics.length; }), 1, tag + " 拿到遺物");
  }

  assert.deepStrictEqual(errors, [], tag + " console error");
  await page.close();
  console.log("ok - " + tag);
}

// 30 人煙霧測試：每 4 人一組開戰，每一發都墊滿量表並發動技能，跑完一輪（4 發＋敵人回合），不能有 console error
async function smokeAllHeroes(browser) {
  var page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // 2026-11-20 起這個遊戲在「付款」分頁，頁面會先問密碼；測試前先寫入解鎖旗標（layout.PAY_STORAGE_KEY）
  await page.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.waitForSelector(".sd-pick-card");
  var ids = await page.evaluate(function () { return window.PriTestShedanData.HEROES.map(function (h) { return h.id; }); });
  var dirs = [[0.2, -1], [-0.6, -1], [0.9, -0.4], [-0.1, -1]];
  for (var g = 0; g < ids.length; g += 4) {
    var team = ids.slice(g, g + 4);
    while (team.length < 4) team.push(ids[team.length]);
    await page.evaluate(function (t) { window.PriTestShedanApp._debug.pick(t); }, team);
    for (var k = 0; k < 4; k++) {
      var st = await page.evaluate(function () { var s = window.PriTestShedanApp._debug.state(); return s.screen === "battle" ? s.phase : "done"; });
      if (st !== "aim") break;
      await page.evaluate(function (d) {
        var A = window.PriTestShedanApp._debug, s = A.state();
        A.fillGauge(); s.skillArmed = true; A.shoot(d[0], d[1], 1);
        if (s.canRedirect) window.setTimeout(function () { var w = s.world; window.PriTestShedanPhysics.redirect(w, 270, 200); }, 300);
      }, dirs[k]);
      await page.waitForFunction(function () { var s = window.PriTestShedanApp._debug.state(); return s.phase !== "shooting"; }, null, { timeout: 40000 });
    }
    await page.waitForFunction(function () { var s = window.PriTestShedanApp._debug.state(); return s.phase === "aim" || s.phase === "over" || s.screen !== "battle"; }, null, { timeout: 10000 });
    console.log("  smoke " + team.join(","));
  }
  assert.deepStrictEqual(errors, [], "30 人煙霧測試 console error");
  await page.screenshot({ path: path.join(SHOT_DIR, "smoke_last.png") });
  await page.close();
  console.log("ok - 30 人煙霧測試");
}

// 6 種戰場（星區 1～3、Boss 1～3）各跑一輪（每發發動技能），換 3 個種子；Boss 戰要有本體與部位
async function smokeArenas(browser) {
  var page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // 2026-11-20 起這個遊戲在「付款」分頁，頁面會先問密碼；測試前先寫入解鎖旗標（layout.PAY_STORAGE_KEY）
  await page.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  // 戰場按鈕收在「試玩戰場」（摺疊）裡，等它出現在 DOM 就好
  await page.waitForSelector(".sd-arena-btn", { state: "attached" });
  assert.strictEqual((await page.$$(".sd-arena-btn")).length, 6, "戰場選擇 6 個");
  var team = ["ignis", "volta", "mist", "nox"], dirs = [[0.2, -1], [-0.6, -1], [0.9, -0.4], [-0.1, -1]];
  var arenas = ["s1", "s2", "s3", "b1", "b2", "b3"];
  for (var a = 0; a < arenas.length; a++) {
    for (var seed = 1; seed <= 3; seed++) {
      await page.evaluate(function (x) { window.PriTestShedanApp._debug.pick(x.team, x.arena, x.seed); }, { team: team, arena: arenas[a], seed: seed * 7919 });
      var info = await page.evaluate(function () {
        var b = window.PriTestShedanApp._debug.state().battle;
        return { boss: b.bossUid, parts: b.enemies.filter(function (e) { return e.role === "part"; }).length, n: b.enemies.length };
      });
      if (arenas[a].charAt(0) === "b") assert.ok(info.boss && info.parts >= 2, arenas[a] + " Boss 本體與部位");
      else assert.ok(info.n >= 4, arenas[a] + " 敵人數 " + info.n);
      for (var k = 0; k < 4; k++) {
        var st = await page.evaluate(function () { var s = window.PriTestShedanApp._debug.state(); return s.screen === "battle" ? s.phase : "done"; });
        if (st !== "aim") break;
        await page.evaluate(function (d) { var A = window.PriTestShedanApp._debug, s = A.state(); A.fillGauge(); s.skillArmed = true; A.shoot(d[0], d[1], 1); }, dirs[k]);
        await page.waitForFunction(function () { return window.PriTestShedanApp._debug.state().phase !== "shooting"; }, null, { timeout: 40000 });
      }
      await page.waitForFunction(function () { var s = window.PriTestShedanApp._debug.state(); return s.phase === "aim" || s.phase === "over" || s.screen !== "battle"; }, null, { timeout: 10000 });
    }
    await page.screenshot({ path: path.join(SHOT_DIR, "arena_" + arenas[a] + ".png") });
    console.log("  arena " + arenas[a]);
  }
  assert.deepStrictEqual(errors, [], "戰場煙霧測試 console error");
  await page.close();
  console.log("ok - 6 種戰場煙霧測試");
}

// 一整局遠征（全部透過畫面按鈕）：戰鬥用 debug 強制勝利，其他節點選第一個能按的選項；走到通關，沒有 console error
async function smokeRun(browser, seed) {
  var page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // 2026-11-20 起這個遊戲在「付款」分頁，頁面會先問密碼；測試前先寫入解鎖旗標（layout.PAY_STORAGE_KEY）
  await page.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.waitForSelector(".sd-pick-card");
  await page.evaluate(function (s) { window.PriTestShedanApp._debug.startRun(["ignis", "volta", "mist", "nox"], s); }, seed);
  var seen = {};
  for (var step = 0; step < 80; step++) {
    var st = await page.evaluate(function () { var s = window.PriTestShedanApp._debug.state(); return { screen: s.screen, phase: s.phase, run: s.run && s.run.state }; });
    if (st.screen === "runEnd") break;
    seen[st.screen] = (seen[st.screen] || 0) + 1;
    if (st.screen === "map") {
      if (step % 9 === 4) { await page.dispatchEvent('[data-act="relics"]', "click"); await page.waitForSelector('[data-act="back"]'); await page.dispatchEvent('[data-act="back"]', "click"); }
      await page.dispatchEvent(".sd-node.is-reach >> nth=0", "click");
    } else if (st.screen === "battle") {
      await page.waitForFunction(function () { var s = window.PriTestShedanApp._debug.state(); return s.phase === "aim" || s.screen !== "battle"; }, null, { timeout: 15000 });
      await page.evaluate(function () { var s = window.PriTestShedanApp._debug.state(); if (s.screen === "battle" && s.phase === "aim") window.PriTestShedanApp._debug.forceWin(); });
      await page.waitForFunction(function () { return window.PriTestShedanApp._debug.state().screen !== "battle"; }, null, { timeout: 5000 });
    } else if (st.screen === "reward") {
      await page.dispatchEvent(step % 2 ? "[data-relic] >> nth=0" : '[data-act="skip"]', "click");
    } else if (st.screen === "shop") {
      var buy = await page.$("[data-buy]:not([disabled])");
      if (buy) await buy.dispatchEvent("click");
      await page.dispatchEvent('[data-act="leave"]', "click");
    } else if (st.screen === "rest") {
      await page.dispatchEvent(step % 2 ? '[data-act="heal"]' : "[data-team] >> nth=1", "click");
    } else if (st.screen === "drifter") {
      var pay = await page.$("[data-pay]:not([disabled])");
      if (pay) { await pay.dispatchEvent("click"); await page.dispatchEvent("[data-team] >> nth=3", "click"); }
      else await page.dispatchEvent('[data-act="leave"]', "click");
    } else if (st.screen === "event") {
      var opt = await page.$("[data-opt]:not([disabled])");
      await opt.dispatchEvent("click");
    } else if (st.screen === "eventOut") {
      await page.dispatchEvent('[data-act="ok"]', "click");
    } else {
      throw new Error("未預期的畫面 " + st.screen);
    }
    await page.waitForTimeout(120);
    if (step === 3) await page.screenshot({ path: path.join(SHOT_DIR, "run_map.png") });
  }
  var run = await page.evaluate(function () { var r = window.PriTestShedanApp._debug.run(); return { state: r.state, sector: r.sector, relics: r.relics.length, nodes: r.stats.nodes }; });
  await page.screenshot({ path: path.join(SHOT_DIR, "run_end.png") });
  assert.strictEqual(run.state, "won", "走完 3 星區通關 " + JSON.stringify(run));
  assert.ok(await page.$(".sd-score"), "結算顯示分數");
  assert.deepStrictEqual(errors, [], "遠征煙霧測試 console error");
  await page.close();
  console.log("ok - 一整局遠征（" + run.nodes + " 節點、遺物 " + run.relics + " 件、經過畫面：" + Object.keys(seen).join("／") + "）");
}

// 第 5 階段：星艦據點解鎖、存檔續玩（地圖中／戰鬥中重新整理）、每日星圖、難度選擇、遠征結束給星塵
async function checkMeta(browser) {
  var page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // 2026-11-20 起這個遊戲在「付款」分頁，頁面會先問密碼；測試前先寫入解鎖旗標（layout.PAY_STORAGE_KEY）
  await page.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload();
  await page.waitForSelector(".sd-pick-card");
  // 據點：給 200 星塵 → 解鎖焰鈴（60）與加速環（40）→ 重新整理後還在
  await page.evaluate(function () { var m = window.PriTestShedanApp._debug.meta(); m.stardust = 200; window.PriTestShedanApp._debug.setMeta(m); });
  await page.dispatchEvent('[data-act="base"]', "click");
  await page.waitForSelector("[data-unlock-hero]");
  await page.screenshot({ path: path.join(SHOT_DIR, "meta_01_base.png") });
  await page.dispatchEvent('[data-unlock-hero="pyra"]', "click");
  await page.dispatchEvent('[data-unlock-relic="accel_ring"]', "click");
  await page.reload();
  await page.waitForSelector(".sd-pick-card");
  var meta = await page.evaluate(function () { return window.PriTestShedanApp._debug.meta(); });
  assert.strictEqual(meta.stardust, 100, "星塵扣掉 100");
  assert.ok(meta.heroes.indexOf("pyra") >= 0 && meta.startRelics.indexOf("accel_ring") >= 0, "解鎖有存檔");
  assert.strictEqual((await page.$$(".sd-pick-card.is-locked")).length, 21);
  // 選焰鈴＋3 人、帶加速環 → 開始遠征 → 地圖中重新整理 → 繼續遠征
  await page.click('[data-hero="pyra"]');
  for (var i = 0; i < 3; i++) await page.click(".sd-pick-card:not(.is-locked):not(.is-picked) >> nth=0");
  await page.selectOption('[data-act="srelic"]', "accel_ring");
  await page.click('[data-act="launch"]');
  await page.waitForSelector(".sd-node.is-reach");
  assert.deepStrictEqual(await page.evaluate(function () { return window.PriTestShedanApp._debug.run().relics; }), ["accel_ring"], "起始遺物");
  await page.reload();
  await page.waitForSelector('[data-act="continue"]');
  await page.dispatchEvent('[data-act="continue"]', "click");
  await page.waitForSelector(".sd-node.is-reach");
  // 進戰鬥 → 戰鬥中重新整理 → 繼續 → 同一場（同樣的敵人配置）
  await page.dispatchEvent(".sd-node.is-reach >> nth=0", "click");
  await waitPhase(page, "aim");
  var sig = await page.evaluate(function () { return window.PriTestShedanApp._debug.state().battle.enemies.map(function (e) { return e.def.id + Math.round(e.x); }).join(","); });
  await page.reload();
  await page.waitForSelector('[data-act="continue"]');
  await page.dispatchEvent('[data-act="continue"]', "click");
  await waitPhase(page, "aim");
  var sig2 = await page.evaluate(function () { return window.PriTestShedanApp._debug.state().battle.enemies.map(function (e) { return e.def.id + Math.round(e.x); }).join(","); });
  assert.strictEqual(sig2, sig, "戰鬥中重整：同一場重來");
  // 打贏 → 獎勵畫面重新整理 → 繼續回到獎勵
  await page.evaluate(function () { window.PriTestShedanApp._debug.forceWin(); });
  await page.waitForSelector("[data-relic]");
  await page.reload();
  await page.dispatchEvent('[data-act="continue"]', "click");
  await page.waitForSelector("[data-relic]");
  // 跳過獎勵 → 回到地圖（結算星塵另外由下面的整局檢查驗證）
  await page.dispatchEvent('[data-act="skip"]', "click");
  await page.waitForSelector(".sd-node.is-reach");
  await page.close();

  // 每日星圖：只有初始 8 人、出發後 run.daily = 今天、難度 0
  var p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // 2026-11-20 起這個遊戲在「付款」分頁，頁面會先問密碼；測試前先寫入解鎖旗標（layout.PAY_STORAGE_KEY）
  await p2.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
  p2.on("pageerror", function (e) { errors.push(String(e)); });
  await p2.goto(BASE);
  await p2.waitForSelector('[data-act="mode-daily"]');
  await p2.dispatchEvent('[data-act="mode-daily"]', "click");
  await p2.waitForSelector('[data-act="daily-go"]');
  assert.strictEqual((await p2.$$(".sd-pick-card")).length, 8, "每日星圖只有初始 8 人");
  for (var k = 0; k < 4; k++) await p2.click(".sd-pick-card:not(.is-picked) >> nth=0");
  await p2.screenshot({ path: path.join(SHOT_DIR, "meta_02_daily.png") });
  await p2.click('[data-act="daily-go"]');
  await p2.waitForSelector(".sd-node.is-reach");
  var dr = await p2.evaluate(function () { var r = window.PriTestShedanApp._debug.run(); var d = new Date(); return { daily: r.daily, diff: r.difficulty, today: d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) }; });
  assert.strictEqual(dr.daily, dr.today);
  assert.strictEqual(dr.diff, 0);
  await p2.close();

  // 一整局（debug 開局、畫面操作）結束 → 星塵增加、存檔刪除、難度 1 解鎖
  var p3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // 2026-11-20 起這個遊戲在「付款」分頁，頁面會先問密碼；測試前先寫入解鎖旗標（layout.PAY_STORAGE_KEY）
  await p3.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
  p3.on("pageerror", function (e) { errors.push(String(e)); });
  await p3.goto(BASE);
  await p3.waitForSelector(".sd-pick-card");
  var before = await p3.evaluate(function () { return window.PriTestShedanApp._debug.meta().stardust; });
  await playRun(p3, "meta-run");
  var after = await p3.evaluate(function () { return { m: window.PriTestShedanApp._debug.meta(), saved: !!localStorage.getItem("pritest-shedan-run-v1") }; });
  assert.ok(after.m.stardust > before, "星塵增加 " + before + " → " + after.m.stardust);
  assert.ok(!after.saved, "遠征結束刪除存檔");
  assert.strictEqual(after.m.cleared, 0, "通關難度 0");
  await p3.screenshot({ path: path.join(SHOT_DIR, "meta_03_end.png") });
  await p3.reload();
  await p3.waitForSelector('[data-act="diff"]');
  assert.strictEqual((await p3.$$('[data-act="diff"] option')).length, 2, "可以選難度 0、1");
  await p3.close();

  assert.deepStrictEqual(errors, [], "局外檢查 console error");
  console.log("ok - 星艦據點、存檔續玩、每日星圖、星塵結算、難度解鎖");
}

// 用畫面按鈕把一局走完（戰鬥用 debug 強制勝利）
async function playRun(page, seed) {
  await page.evaluate(function (s) { window.PriTestShedanApp._debug.startRun(["ignis", "volta", "mist", "nox"], s); }, seed);
  for (var step = 0; step < 80; step++) {
    var st = await page.evaluate(function () { return window.PriTestShedanApp._debug.state().screen; });
    if (st === "runEnd") return;
    if (st === "map") await page.dispatchEvent(".sd-node.is-reach >> nth=0", "click");
    else if (st === "battle") {
      await page.waitForFunction(function () { var s = window.PriTestShedanApp._debug.state(); return s.phase === "aim" || s.screen !== "battle"; }, null, { timeout: 15000 });
      await page.evaluate(function () { var s = window.PriTestShedanApp._debug.state(); if (s.screen === "battle" && s.phase === "aim") window.PriTestShedanApp._debug.forceWin(); });
      await page.waitForFunction(function () { return window.PriTestShedanApp._debug.state().screen !== "battle"; }, null, { timeout: 5000 });
    }
    else if (st === "reward") await page.dispatchEvent('[data-act="skip"]', "click");
    else if (st === "shop" || st === "drifter") await page.dispatchEvent('[data-act="leave"]', "click");
    else if (st === "rest") await page.dispatchEvent('[data-act="heal"]', "click");
    else if (st === "event") await page.dispatchEvent('[data-opt="b"]', "click");
    else if (st === "eventOut") await page.dispatchEvent('[data-act="ok"]', "click");
    await page.waitForTimeout(100);
  }
  throw new Error("80 步內沒走完");
}

// 100 件遺物同時持有：在 4 種戰場各打一輪（每發發動技能），不能有 console error
async function smokeAllRelics(browser) {
  var page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // 2026-11-20 起這個遊戲在「付款」分頁，頁面會先問密碼；測試前先寫入解鎖旗標（layout.PAY_STORAGE_KEY）
  await page.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.waitForSelector(".sd-pick-card");
  var dirs = [[0.2, -1], [-0.6, -1], [0.9, -0.4], [-0.1, -1]];
  var arenas = ["s1", "s2", "s3", "b3"];
  for (var a = 0; a < arenas.length; a++) {
    await page.evaluate(function (ar) {
      var A = window.PriTestShedanApp._debug;
      A.state().picked = ["echo", "volta", "orbit", "prism"];
      A.arenaWithRelics(window.PriTestShedanData.RELICS.map(function (r) { return r.id; }), ar, 4242 + ar.length);
    }, arenas[a]);
    for (var k = 0; k < 8; k++) {
      var st = await page.evaluate(function () { var s = window.PriTestShedanApp._debug.state(); return s.screen === "battle" ? s.phase : "done"; });
      if (st === "done" || st === "over") break;
      if (st !== "aim") { await page.waitForFunction(function () { var s = window.PriTestShedanApp._debug.state(); return s.phase === "aim" || s.phase === "over" || s.screen !== "battle"; }, null, { timeout: 15000 }); continue; }
      await page.evaluate(function (d) { var A = window.PriTestShedanApp._debug, s = A.state(); A.fillGauge(); s.skillArmed = true; A.shoot(d[0], d[1], 1.15); }, dirs[k % 4]);
      await page.waitForFunction(function () { return window.PriTestShedanApp._debug.state().phase !== "shooting"; }, null, { timeout: 40000 });
    }
    await page.screenshot({ path: path.join(SHOT_DIR, "relics_" + arenas[a] + ".png") });
    console.log("  all relics " + arenas[a]);
  }
  assert.deepStrictEqual(errors, [], "100 件遺物煙霧測試 console error");
  await page.close();
  console.log("ok - 100 件遺物同時持有");
}

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch();
  try {
    await checkViewport(browser, { width: 390, height: 844 }, "phone");
    await checkViewport(browser, { width: 1280, height: 800 }, "desktop");
    await checkMeta(browser);
    await smokeRun(browser, "smoke-a");
    await smokeRun(browser, "smoke-b");
    await smokeAllRelics(browser);
    await smokeAllHeroes(browser);
    await smokeArenas(browser);
    var page = await browser.newPage();
    // 2026-11-20 起這個遊戲在「付款」分頁，頁面會先問密碼；測試前先寫入解鎖旗標（layout.PAY_STORAGE_KEY）
    await page.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
    await page.goto(ROOT + "index.html");
    var card = await page.evaluate(function () {
      var h = document.querySelector('[data-i18n="project_shedan_name"]');
      var c = h && h.closest(".project-card");
      var panel = c && c.closest(".home-tab-panel");
      return c ? { tag: c.tagName, href: c.getAttribute("href"), tab: panel && panel.getAttribute("data-tab") } : null;
    });
    // 舊期望值「首頁卡片不能點」（2026-11-17 指定）已過時：2026-11-20 使用者指定移到「付款」分頁，輸入密碼後可以點
    assert.ok(card && card.tag === "A" && card.href === "shedan/index.html" && card.tab === "pay", "首頁卡片在付款分頁 " + JSON.stringify(card));
    console.log("ok - 首頁卡片在付款分頁");
  } finally {
    await browser.close();
  }
  console.log("all ok");
})().catch(function (e) { console.error(e); process.exit(1); });
