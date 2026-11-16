// ============================================================================
// 百鬼轉珠（tama）Playwright 流程檢查：
//   首頁 → 遊戲說明 → 隊伍編成（換隊長）→ 關卡選擇 → 1-1 戰鬥：
//   實際用滑鼠在 Canvas 上拖曳轉珠（確認回合前進、時間條歸位）→ 點妖怪鎖定目標 → 技能對話框 →
//   把妖怪生命改成 1 後轉珠，打完 2 波 → 結算（經驗、新角色加入）→ 存檔 → 祓い手一覽 → 角色詳細 →
//   失敗與重試 → 語言切換 → 手機寬度沒有橫向捲動 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8961 --directory dist
// 執行：node tools/tama_check/ui_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = (process.env.TAMA_ROOT || "http://localhost:8961/") + "tama/index.html";
var SHOT_DIR = path.join(__dirname, "shots");

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload();
  await page.waitForSelector(".tm-home");
  await page.screenshot({ path: path.join(SHOT_DIR, "01_home.png") });

  // 說明
  await page.dispatchEvent('[data-act="go-rules"]', "click");
  assert.strictEqual(await page.locator(".tm-rules li").count(), 7);
  await page.screenshot({ path: path.join(SHOT_DIR, "02_rules.png"), fullPage: true });
  await page.dispatchEvent('[data-act="go-home"]', "click");

  // 隊伍編成：第 1 格換成雫當隊長
  await page.dispatchEvent('[data-act="go-team"]', "click");
  await page.dispatchEvent('[data-act="slot"][data-i="0"]', "click");
  await page.dispatchEvent('[data-act="pick"][data-id="shizuku"]', "click");
  var team = await page.evaluate(function () { return window.PriTestTama.state().save.team; });
  assert.strictEqual(team[0], "shizuku");
  assert.strictEqual(team[1], "akane", "原本的隊長和雫交換位置");
  await page.screenshot({ path: path.join(SHOT_DIR, "03_team.png"), fullPage: true });

  // 關卡選擇：只有 1-1 開放
  await page.dispatchEvent('.tm-center [data-act="go-stages"]', "click");
  assert.strictEqual(await page.locator(".tm-stage:not(:disabled)").count(), 1);
  await page.screenshot({ path: path.join(SHOT_DIR, "04_stages.png"), fullPage: true });
  await page.dispatchEvent('[data-act="stage"][data-id="1-1"]', "click");
  await page.waitForSelector(".tm-canvas");
  await page.screenshot({ path: path.join(SHOT_DIR, "05_battle.png") });

  // 實際拖曳：從 (0,0) 繞一圈
  var box = await page.locator(".tm-canvas").boundingBox();
  var cell = box.width / 6;
  async function dragPath(cells) {
    var p0 = cells[0];
    await page.mouse.move(box.x + (p0[1] + 0.5) * cell, box.y + (p0[0] + 0.5) * cell);
    await page.mouse.down();
    for (var i = 1; i < cells.length; i++) {
      await page.mouse.move(box.x + (cells[i][1] + 0.5) * cell, box.y + (cells[i][0] + 0.5) * cell, { steps: 4 });
      await sleep(30);
    }
    await page.mouse.up();
  }
  async function waitIdle() {
    for (var i = 0; i < 200; i++) {
      var s = await page.evaluate(function () { var s = window.PriTestTama.state(); return { busy: s.busy, over: s.battle && s.battle.over, modal: !!document.querySelector(".tm-modal") }; });
      if (!s.busy || s.modal) return s;
      await sleep(100);
    }
    throw new Error("戰鬥演出沒有結束");
  }
  var before = await page.evaluate(function () { return window.PriTestTama.state().battle.board.map(function (r) { return r.join(","); }).join("|"); });
  await dragPath([[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 1], [3, 1], [3, 0]]);
  await sleep(150);
  await page.screenshot({ path: path.join(SHOT_DIR, "06_after_drag.png") });
  await waitIdle();
  var after = await page.evaluate(function () { var b = window.PriTestTama.state().battle; return { turn: b.turn, board: b.board.map(function (r) { return r.join(","); }).join("|") }; });
  assert.strictEqual(after.turn, 1, "拖曳放手後算 1 回合");
  assert.notStrictEqual(after.board, before, "盤面有變");

  // 只按一下不拖曳，不算回合
  await page.mouse.click(box.x + cell * 0.5, box.y + cell * 0.5);
  await sleep(200);
  assert.strictEqual(await page.evaluate(function () { return window.PriTestTama.state().battle.turn; }), 1);

  // 點第 2 隻妖怪鎖定目標
  await page.dispatchEvent("#tm-e1", "click");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestTama.state().battle.target; }), 1);

  // 技能對話框（CD 還沒好）
  await page.dispatchEvent("#tm-m0", "click");
  await page.waitForSelector(".tm-skillpop");
  assert.strictEqual(await page.locator('[data-act="skill-use"]').count(), 0);
  await page.screenshot({ path: path.join(SHOT_DIR, "07_skill.png") });
  await page.dispatchEvent('.tm-modal-btns [data-act="close"]', "click");
  // CD 歸零後可以使用：心→水
  await page.evaluate(function () { window.PriTestTama.state().battle.members[0].cd = 0; });
  await page.dispatchEvent("#tm-m0", "click");
  await page.dispatchEvent('[data-act="skill-use"]', "click");
  await waitIdle();
  var hearts = await page.evaluate(function () { return window.PriTestTama.state().battle.board.join(",").split("heart").length - 1; });
  assert.strictEqual(hearts, 0, "心珠全部轉成水珠");

  // 把妖怪生命改成 1，轉 2 次打完 2 波
  for (var w = 0; w < 2; w++) {
    await page.evaluate(function () { window.PriTestTama.state().battle.enemies.forEach(function (e) { e.hp = 1; }); });
    // 先在盤面上排出保證消除的一排
    await page.evaluate(function () {
      var b = window.PriTestTama.state().battle.board;
      // 橫排 5 顆水珠＝全體攻擊（3 顆只打目標，2 隻妖怪時會剩下一隻）
      b[4][0] = "water"; b[4][1] = "water"; b[4][2] = "fire"; b[4][3] = "water"; b[4][4] = "water"; b[3][2] = "water";
    });
    await page.evaluate(function () { window.PriTestTama.syncBoard(); });
    await dragPath([[3, 2], [4, 2]]);
    var s = await waitIdle();
    if (w === 0) { assert.strictEqual(await page.evaluate(function () { return window.PriTestTama.state().battle.waveIdx; }), 1); await page.screenshot({ path: path.join(SHOT_DIR, "08_wave2.png") }); }
  }
  await page.waitForSelector(".tm-result");
  await page.screenshot({ path: path.join(SHOT_DIR, "09_result.png") });
  var save = await page.evaluate(function () { return JSON.parse(localStorage.getItem("pritest-tama-save-v1")); });
  assert(save.cleared["1-1"]);
  assert(save.roster.homura && save.roster.mio, "1-1 首次通關加入焔、澪");
  assert(save.roster.shizuku.lv >= 2, "60 經驗升到 Lv2");

  // 下一關 → 故意失敗 → 重試
  await page.dispatchEvent('[data-act="next-stage"]', "click");
  await page.waitForSelector(".tm-canvas");
  await page.evaluate(function () { window.PriTestTama.state().battle.hp = 1; });
  box = await page.locator(".tm-canvas").boundingBox();
  for (var k = 0; k < 4; k++) {
    if (await page.$(".tm-result")) break;
    await dragPath([[2, 2], [2, 3]]);
    await waitIdle();
  }
  await page.waitForSelector(".tm-result-lose");
  await page.screenshot({ path: path.join(SHOT_DIR, "10_lose.png") });
  await page.dispatchEvent('[data-act="again"]', "click");
  await page.waitForSelector(".tm-canvas");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestTama.state().battle.turn; }), 0);
  await page.dispatchEvent('[data-act="retreat"]', "click");
  await page.dispatchEvent('[data-act="retreat-yes"]', "click");
  await page.waitForSelector(".tm-stages");

  // 一覽與詳細
  await page.dispatchEvent('[data-act="go-home"]', "click");
  await page.dispatchEvent('[data-act="go-roster"]', "click");
  assert.strictEqual(await page.locator(".tm-card").count(), 25);
  assert.strictEqual(await page.locator(".tm-card-lock").count(), 18);
  await page.dispatchEvent('[data-act="hero"][data-id="mio"]', "click");
  await page.waitForSelector(".tm-hero-detail");
  await page.screenshot({ path: path.join(SHOT_DIR, "11_hero.png") });
  await page.dispatchEvent('.tm-modal-btns [data-act="close"]', "click");

  // 語言切換
  await page.dispatchEvent('.lang-btn[data-lang="ja"]', "click");
  assert((await page.textContent(".tm-h2")).indexOf("祓い手一覧") >= 0);
  await page.dispatchEvent('.lang-btn[data-lang="en"]', "click");
  assert((await page.textContent(".tm-h2")).indexOf("Exorcists") >= 0);
  await page.dispatchEvent('.lang-btn[data-lang="zh"]', "click");

  // 手機寬度不橫向捲動（首頁與戰鬥）
  await page.dispatchEvent('[data-act="go-home"]', "click");
  assert(await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth; }), "首頁沒有橫向捲動");
  await page.evaluate(function () { window.PriTestTama.startBattle("1-2"); });
  await page.waitForSelector(".tm-canvas");
  assert(await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth; }), "戰鬥畫面沒有橫向捲動");

  assert.deepStrictEqual(errors, [], "沒有 console error");
  await browser.close();
  console.log("tama ui_check: 全部通過");
})().catch(function (e) { console.error(e); process.exit(1); });
