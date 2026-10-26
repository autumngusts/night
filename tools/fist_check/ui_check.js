// ============================================================================
// 鐵拳教育（fist）Playwright 流程檢查（本機模式）：
//   選兩位老師 → 開始上課 → 用畫面操作（拖曳老師移動、點老師再點格子、開打進格鬥畫面用鍵盤打、技能、結束回合…）
//   打到第二章或分出勝負
//   → 重新整理後能從存檔繼續 → 三種語言沒有漏翻的 fe_ 鍵 → 手機寬度沒有橫向捲動 → 截圖
// 每一步都用 bot.js 決定要做什麼，再換成對應的畫面點擊（不直接呼叫 Core.apply）。
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8946 --directory dist
// 執行：node tools/fist_check/ui_check.js [最多步數，預設 120]（每場格鬥要真的打 10 秒左右）
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;
global.window = global;
require("../../static_src/fist_data.js");
require("../../static_src/fist_core.js");
var D = global.PriTestFistData;
var Core = global.PriTestFistCore;
var botAction = require("./bot.js").botAction;

var BASE = process.env.FIST_BASE || "http://localhost:8946/fist/index.html";
var STEPS = Number(process.argv[2]) || 120;
var SHOT_DIR = process.env.FIST_SHOTS || path.join(__dirname, "shots");

// 2026-10-26 起入口預設是模式選擇（搜打撤是主要模式），經典回合制的面板要先點開
async function openClassic(page) {
  await page.evaluate(function () {
    if (document.querySelector(".fe-seat")) return;
    var b = document.querySelector(".fe-mode:not(.fe-mode-main)");
    if (b) b.click();
  });
}

function st(page) { return page.evaluate(function () { return window.PriTestFist.state(); }); }

async function click(page, sel) {
  var ok = await page.evaluate(function (s) {
    var b = document.querySelector(s);
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }, sel);
  assert.ok(ok, "找不到或無法按：" + sel);
}
async function clickText(page, key) {
  var ok = await page.evaluate(function (k) {
    var l = window.I18N.t(k);
    var b = Array.prototype.filter.call(document.querySelectorAll("#fe-app button"), function (x) { return x.textContent.trim() === l && !x.disabled; })[0];
    if (!b) return false;
    b.click();
    return true;
  }, key);
  assert.ok(ok, "找不到按鈕：" + key);
}

async function noRawKeys(page, where) {
  var raw = await page.evaluate(function () { return (document.body.innerText.match(/fe_[a-zA-Z_]+|project_fist_[a-z]+/g) || []); });
  assert.deepStrictEqual(raw, [], where + " 有漏翻的鍵：" + raw.join(","));
}

var stats = { moves: 0, fights: 0 };

// 把 bot 的操作換成畫面操作：移動＝滑鼠拖曳老師到格子；開打＝進入格鬥畫面用鍵盤打完
async function center(page, sel) {
  var b = await page.evaluate(function (s) { var n = document.querySelector(s); if (!n) return null; var r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  assert.ok(b, "找不到 " + sel);
  return b;
}

async function dragTeacher(page, seat, tileId) {
  await page.evaluate(function (sel) { document.querySelector(sel).scrollIntoView({ block: "center" }); }, '[data-u="t' + seat + '"]');
  var from = await center(page, '[data-u="t' + seat + '"]');
  var to = await center(page, '[data-tile="' + tileId + '"]');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (var i = 1; i <= 6; i++) await page.mouse.move(from.x + (to.x - from.x) * i / 6, from.y + (to.y - from.y) * i / 6);
  stats.ghostSeen = stats.ghostSeen || await page.evaluate(function () { return !!document.querySelector(".fe-ghost") && !!document.querySelector(".fe-path-end"); });
  await page.mouse.up();
}

// 格鬥：連打 J，看到 ⚠ 蓄力就按住 L 擋；出現結果後按「回到地圖」
async function playFight(page) {
  await page.waitForSelector(".ff-overlay");
  var t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (await page.$(".ff-result")) break;
    if (!stats.fightShot && Date.now() - t0 > 2200) { stats.fightShot = true; await page.screenshot({ path: path.join(SHOT_DIR, "fist_fight.png") }); }
    var wind = await page.evaluate(function () { return !!document.querySelector(".ff-foe.ff-wind"); });
    if (wind) { await page.keyboard.down("l"); await page.waitForTimeout(180); await page.keyboard.up("l"); }
    else { await page.keyboard.press("j"); if (Math.random() < 0.25) await page.keyboard.press("k"); }
    await page.waitForTimeout(70);
  }
  await page.waitForSelector(".ff-result", { timeout: 5000 });
  await page.click(".ff-result-ok");
  await page.waitForFunction(function () { return !document.querySelector(".ff-overlay"); });
}

async function doAction(page, s, a) {
  // 先切到該老師的分頁
  await page.evaluate(function (seat) {
    var tabs = document.querySelectorAll(".fe-tab");
    if (tabs[seat] && !tabs[seat].classList.contains("fe-on")) tabs[seat].click();
  }, Core.teachers(s).map(function (h) { return h.seat; }).indexOf(a.s));
  if (a.t === "move") {
    var id = Core.tileAt(a.x, a.y).id;
    if (stats.moves % 3 === 2) {
      // 另一種操作：點一下老師（進入點格子模式）再點格子
      await page.evaluate(function (sel) { var n = document.querySelector(sel); n.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 1, clientY: 1 })); window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); }, '[data-u="t' + a.s + '"]');
      await page.waitForTimeout(30);
      await click(page, '[data-tile="' + id + '"].fe-target');
    } else await dragTeacher(page, a.s, id);
    stats.moves++;
    return;
  }
  if (a.t === "fight") { await click(page, '[data-act="fight"]'); await playFight(page); stats.fights++; return; }
  if (a.t === "skill" && a.x !== undefined) { await click(page, '[data-act="skill"]'); await click(page, '[data-tile="' + Core.tileAt(a.x, a.y).id + '"]'); return; }
  if (a.t === "talk") { await click(page, '[data-act="talk-' + a.b + '"]'); return; }
  await click(page, '[data-act="' + a.t + '"]');
}

(async function () {
  var browser = await chromium.launch();
  var ctx = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  await ctx.addInitScript(function () { try { if (!sessionStorage.getItem("fe-init")) { localStorage.removeItem("pritest-fist-state"); localStorage.setItem("pritest-lang", "zh"); sessionStorage.setItem("fe-init", "1"); } } catch (e) { /* */ } });
  var page = await ctx.newPage();
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text()); });

  await page.goto(BASE);
  await noRawKeys(page, "入口");
  await openClassic(page);
  // 預設是體育老師＋輔導老師；第二位改成資訊老師（測地圖選格子的技能）
  await page.evaluate(function () {
    var seats = document.querySelectorAll(".fe-seat");
    var btn = Array.prototype.filter.call(seats[1].querySelectorAll(".fe-class-btn"), function (b) { return b.textContent.indexOf(window.PriTestFistData.CLASS.it.name.zh) >= 0; })[0];
    btn.click();
  });
  await clickText(page, "fe_start_local");
  var s = await st(page);
  assert.strictEqual(s.phase, "story");
  assert.deepStrictEqual(Core.teachers(s).map(function (h) { return h.cls; }), ["pe", "it"]);
  await click(page, '[data-act="go"]');

  var steps = 0, skills = 0, startCh = 0;
  while (steps < STEPS) {
    s = await st(page);
    if (s.phase === "win" || s.phase === "lose") break;
    if (s.phase === "story") { await click(page, '[data-act="go"]'); continue; }
    if (s.phase === "perk") {
      var h0 = Core.teachers(s).filter(function (h) { return !s.perkPicked[h.seat]; })[0];
      await click(page, '[data-perk="' + s.perkOpts[h0.seat][0] + '"]');
      continue;
    }
    if (s.chapter > startCh) break;
    var h = Core.active(s).filter(function (x) { return !x.done; })[0];
    var a = botAction(Core, D, s, h.seat);
    // 畫面上不能按的（bot 偶爾會想做無效的事）就改按結束回合，跟 core_check 的處理一樣
    var copy = JSON.parse(JSON.stringify(s));
    if (Core.apply(copy, "local", a)) a = { t: "end", s: h.seat, on: true };
    var before = s.logSeq;
    await doAction(page, s, a);
    if (a.t === "skill") skills++;
    var after = await st(page);
    assert.ok(after.logSeq > before || a.t === "end", "操作沒有效果：" + JSON.stringify(a));
    steps++;
    if (steps === 6) {
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(SHOT_DIR, "fist_play.png"), fullPage: true });
    }
  }
  s = await st(page);
  console.log("步數", steps, "開打", stats.fights, "移動", stats.moves, "技能", skills, "章", s.chapter + 1, "節", s.round, "phase", s.phase);
  assert.ok(stats.fights > 0 && stats.moves > 0, "應該有開打與移動");
  assert.ok(stats.ghostSeen, "拖曳時要顯示老師分身與路線");
  assert.ok(s.log.some(function (e) { return e.k === "fight"; }) || s.chapter > 0, "要有格鬥紀錄");
  await noRawKeys(page, "對局中");

  // 重新整理 → 從存檔繼續
  if (s.phase !== "win" && s.phase !== "lose") {
    await page.reload();
    await openClassic(page);
    await clickText(page, "fe_continue");
    var s2 = await st(page);
    assert.strictEqual(s2.logSeq, s.logSeq, "存檔繼續後狀態要一樣");
  }

  // 三種語言
  for (var lang of ["ja", "en", "zh"]) {
    await page.evaluate(function (l) { window.I18N.setLang(l); }, lang);
    await page.waitForTimeout(50);
    await noRawKeys(page, "語言 " + lang);
  }
  // 規則面板（入口）也檢查
  await page.evaluate(function () { localStorage.removeItem("pritest-fist-state"); });
  await page.reload();
  await openClassic(page);
  await page.evaluate(function () { document.querySelector(".fe-rules").open = true; });
  for (var l2 of ["ja", "en", "zh"]) {
    await page.evaluate(function (l) { window.I18N.setLang(l); document.querySelector(".fe-rules").open = true; }, l2);
    await noRawKeys(page, "入口 " + l2);
  }

  // 手機寬度：開一局看地圖，不能有橫向捲動
  await page.setViewportSize({ width: 360, height: 780 });
  await clickText(page, "fe_start_local");
  await click(page, '[data-act="go"]');
  var overflow = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  await page.screenshot({ path: path.join(SHOT_DIR, "fist_mobile.png"), fullPage: true });
  assert.ok(overflow <= 0, "手機寬度橫向溢出 " + overflow + "px");

  assert.deepStrictEqual(errors, [], "頁面錯誤：" + errors.join("\n"));
  await browser.close();
  console.log("OK ui_check");
})().catch(function (e) { console.error(e); process.exit(1); });
