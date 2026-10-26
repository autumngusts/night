// ============================================================================
// 鐵拳教育：搜打撤模式 Playwright 流程檢查：
//   入口選搜打撤 → 辦公桌（晨間傳聞、案件筆記）帶一個 OK 繃 → 潛入 → 開局簡報 →
//   用畫面操作（切區域分頁、點地點移動、搜索、撿東西、跟學生交談看對話框、開打進格鬥畫面用鍵盤打）
//   → 背包有東西就去撤離點撤離 → 結算（明天的傳聞）→ 回到辦公桌，倉庫有東西、筆記有線索、提交證據換聲望
//   → 第二局潛入到一半重新整理，要回到同一局 → 三種語言沒有漏翻的鍵 → 手機寬度沒有橫向捲動 → 截圖
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8946 --directory dist
// 執行：node tools/fist_check/raid_ui_check.js
// 注意：地圖每一影格都在更新，按鈕一律用 dispatchEvent／element.click()，不要用 page.click（CLAUDE.md §4.6）。
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;
global.window = global;
require("../../static_src/fist_data.js");
require("../../static_src/fist_raid_data.js");
require("../../static_src/fist_raid_text.js");
require("../../static_src/fist_raid_core.js");
var D = global.PriTestFistData;
var R = global.PriTestFistRaidData;
var Core = global.PriTestFistRaidCore;

var BASE = process.env.FIST_BASE || "http://localhost:8946/fist/index.html";
var SHOT_DIR = process.env.FIST_SHOTS || path.join(__dirname, "shots");

function run(page) { return page.evaluate(function () { return window.PriTestFistRaid.state(); }); }
function view(page) { return page.evaluate(function () { return window.PriTestFistRaid.view(); }); }

// 面板是在下一影格才依新狀態重建，剛到新格子時按鈕可能還沒出現：最多等 0.6 秒
async function clickSel(page, sel) {
  var ok = false;
  for (var i = 0; i < 12 && !ok; i++) {
    ok = await page.evaluate(function (s) {
      var b = document.querySelector(s);
      if (!b || b.disabled) return false;
      b.click();
      return true;
    }, sel);
    if (!ok) await page.waitForTimeout(50);
  }
  if (!ok && process.env.FIST_DEBUG) console.log(await page.evaluate(function () {
    var r = window.PriTestFistRaid.state();
    return JSON.stringify({ at: r && r.me.at, act: r && r.me.act, path: r && r.me.path, dialog: r && r.dialog, fight: r && r.fight, phase: r && r.phase }) + " / " + (document.querySelector(".fr-panel") || {}).innerHTML;
  }));
  assert.ok(ok, "找不到或無法按：" + sel);
}
// 地點在別的區域時，先切到那個區域的分頁
async function tapTile(page, id) {
  if (!(await page.$('[data-tile="' + id + '"]'))) await clickSel(page, '[data-zone="' + R.TILE[id].zone + '"]');
  await page.dispatchEvent('[data-tile="' + id + '"]', "pointerdown");
}
async function noRawKeys(page, where) {
  var raw = await page.evaluate(function () { return (document.getElementById("fe-app").innerText.match(/\bf[re]_[a-z0-9_]+/g) || []); });
  assert.deepStrictEqual(raw, [], where + " 有沒翻譯的鍵：" + raw.join(", "));
}

// 格鬥畫面：一直出拳，對手蓄力時擋；打完按結果的按鈕
async function fight(page) {
  for (var i = 0; i < 400; i++) {
    var st = await page.evaluate(function () {
      var f = window.PriTestFistRaid.fight();
      if (!f) return "none";
      if (document.querySelector(".ff-result-ok")) return "result";
      var e = f.engine;
      return e.foes.some(function (x) { return x.phase === "wind" && x.timer < 0.2; }) ? "guard" : "hit";
    });
    if (st === "none") return;
    if (st === "result") { await clickSel(page, ".ff-result-ok"); return; }
    if (st === "guard") { await page.keyboard.down("l"); await page.waitForTimeout(160); await page.keyboard.up("l"); }
    else { await page.keyboard.press("j"); await page.waitForTimeout(60); }
  }
  throw new Error("格鬥打不完");
}

function nearest(s, ids) {
  return ids.filter(function (id) { return Core.route(s, s.me.at, id); }).sort(function (a, b) { return Core.dist(s.me.at, a) - Core.dist(s.me.at, b); })[0];
}

// 一局：搜一搜、遇到學生就聊，背包有幾樣（或察覺度高）就去撤離
async function playRaid(page, opts) {
  var stats = { moves: 0, searches: 0, fights: 0, takes: 0, chats: 0, dialogs: 0, zones: {} };
  var shot = false, dlgShot = false;
  for (var step = 0; step < 700; step++) {
    var v = await view(page);
    if (v !== "raid") break;
    var s = await run(page);
    if (!s) { await page.waitForTimeout(200); continue; }
    if (s.phase !== "raid") { await page.waitForTimeout(1600); break; } // 結束演出播完才切到結算
    if (await page.evaluate(function () { return !!window.PriTestFistRaid.fight(); })) { stats.fights++; await fight(page); continue; }
    if (s.briefing || s.dialog) {
      stats.dialogs++;
      if (s.dialog && !dlgShot && opts.dlgShot) { dlgShot = true; await page.waitForTimeout(100); await page.screenshot({ path: path.join(SHOT_DIR, opts.dlgShot), fullPage: false }); }
      assert.ok(await page.evaluate(function () { return window.PriTestFistRaid.paused(); }), "對話框開著時時間要暫停");
      await clickSel(page, ".fr-dlg-ok");
      continue;
    }
    if (s.me.act || s.me.path.length) { await page.waitForTimeout(150); continue; }
    stats.zones[R.TILE[s.me.at].zone] = true;
    if (!shot && stats.searches >= 2) { shot = true; await page.screenshot({ path: path.join(SHOT_DIR, opts.shot || "fist_raid.png"), fullPage: true }); }
    var at = s.me.at;
    var free = s.me.bagMax - Core.used(s.me.bag);
    var floor = (s.floor[at] || []).filter(function (id) { return R.ITEM[id].size <= free; });
    var leave = s.me.bag.length >= (opts.leaveAt || 3) || s.alert >= 60 || s.lock || s.me.hp <= s.me.max * 0.4;
    if (floor.length) { await clickSel(page, '.fr-floor [data-act="take"]'); stats.takes++; continue; }
    if (leave) {
      if (Core.isExit(s, at)) {
        if (Core.hereBullies(s).length) await clickSel(page, '[data-act="fight"]');
        else await clickSel(page, '[data-act="extract"]');
        continue;
      }
      await tapTile(page, nearest(s, s.exits));
      stats.moves++;
      continue;
    }
    var bossHere = s.bullies.some(function (b) { return b.boss && b.at === at; });
    if (Core.hereBullies(s).some(function (b) { return !b.boss && b.stun <= 0; }) && !bossHere) { await clickSel(page, '[data-act="fight"]'); continue; }
    var stu = Core.studentsAt(s, at).filter(function (x) { return !s.talked[x.s] && !s.cs.refused[x.s]; })[0];
    if (stu) { await clickSel(page, '[data-act="chat"][data-u="' + stu.u + '"]'); stats.chats++; continue; }
    if ((s.spots[at] || []).some(function (x) { return !x.done; })) { await clickSel(page, '[data-act="search"]'); stats.searches++; continue; }
    var bossAt = s.bullies.filter(function (b) { return b.boss; }).map(function (b) { return b.at; })[0];
    // 還沒跟任何人聊過就不論距離去找學生（學生位置是隨機的）
    var near = s.students.filter(function (x) { return !s.talked[x.s] && !s.cs.refused[x.s] && (Core.dist(at, x.at) <= 3 || !stats.chats); })[0];
    var targets = R.TILES.filter(function (t) { return t.id !== bossAt && t.id !== at && Core.open(s, t.id) && (s.spots[t.id] || []).some(function (x) { return !x.done; }); }).map(function (t) { return t.id; });
    await tapTile(page, near ? near.at : nearest(s, targets));
    stats.moves++;
  }
  return stats;
}

(async function main() {
  var browser = await chromium.launch();
  var ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  var page = await ctx.newPage();
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text()); });

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-fist-raid"); localStorage.removeItem("pritest-fist-raid-run"); window.I18N.setLang("zh"); });
  await page.reload();
  await noRawKeys(page, "入口");
  assert.ok(await page.$(".fe-mode-main"), "入口要有搜打撤模式");
  await clickSel(page, ".fe-mode-main");
  assert.strictEqual(await view(page), "hub");
  await noRawKeys(page, "辦公桌");
  assert.ok(await page.$(".fr-rumors li"), "辦公桌要有晨間傳聞");

  // 整備：帶一個 OK 繃、選體育老師
  var p0 = await page.evaluate(function () { return window.PriTestFistRaid.profile(); });
  assert.deepStrictEqual(p0.stash, ["bandage", "bandage"], "新的辦公桌有 2 個 OK 繃");
  assert.strictEqual(p0.cs.cast.length, R.CAST, "案件名單");
  await page.evaluate(function () {
    var b = Array.prototype.filter.call(document.querySelectorAll(".fr-stash .fe-act"), function (x) { return x.textContent === window.I18N.t("fr_bring"); })[0];
    b.click();
  });
  await page.screenshot({ path: path.join(SHOT_DIR, "fist_raid_hub.png"), fullPage: true });
  await clickSel(page, ".fr-go");
  assert.strictEqual(await view(page), "raid");
  var s = await run(page);
  assert.deepStrictEqual(s.me.bag, ["bandage"], "帶進去的 OK 繃在背包裡");
  assert.ok(s.briefing, "開局有簡報");
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, "fist_raid_brief.png"), fullPage: false });
  // 簡報開著時時間不走
  var t0 = (await run(page)).t;
  await page.waitForTimeout(400);
  assert.strictEqual((await run(page)).t, t0, "簡報開著時間要暫停");
  await page.keyboard.press("Enter");
  await noRawKeys(page, "潛入中");
  // 區域分頁：切到操場看看
  await clickSel(page, '[data-zone="yard"]');
  assert.ok(await page.$('[data-tile="gate"]'), "切到操場分頁要看到校門");
  assert.ok(await page.$('.fr-zone-tab.fr-locked[data-zone="roof"]'), "頂樓一開始是鎖著的");
  await page.screenshot({ path: path.join(SHOT_DIR, "fist_raid_yard.png"), fullPage: false });
  await clickSel(page, '[data-zone="main1"]');

  var stats = await playRaid(page, { leaveAt: 5, shot: "fist_raid.png", dlgShot: "fist_raid_dialog.png" });
  console.log("第一局", JSON.stringify(stats));
  assert.ok(stats.moves > 0 && stats.searches > 0, "應該有移動和搜索");
  assert.ok(stats.chats > 0 && stats.dialogs > 1, "應該有跟學生交談、看到對話框");
  await page.waitForTimeout(200);
  assert.strictEqual(await view(page), "result", "結束後要顯示結算");
  await noRawKeys(page, "結算");
  await page.screenshot({ path: path.join(SHOT_DIR, "fist_raid_result.png"), fullPage: true });
  var res = await page.evaluate(function () { return document.querySelector(".fr-result").className; });
  console.log("結果", res);
  await clickSel(page, ".fr-result .fe-primary");
  assert.strictEqual(await view(page), "hub");
  var p1 = await page.evaluate(function () { return window.PriTestFistRaid.profile(); });
  assert.strictEqual(p1.stats.raids, 1, "潛入次數 +1");
  assert.strictEqual(p1.cs.raids, 1, "案件記得已經潛入 1 次");
  if (stats.chats) assert.ok(Object.keys(p1.cs.met).length > 0, "聊過的學生要記在案件裡");
  // 打開案件筆記
  await page.evaluate(function () { document.querySelector(".fr-case").open = true; });
  await noRawKeys(page, "案件筆記");
  await page.screenshot({ path: path.join(SHOT_DIR, "fist_raid_notebook.png"), fullPage: true });
  if (/fr-result-extract/.test(res)) {
    assert.ok(p1.stash.length >= 1, "撤離成功，倉庫要有東西");
    var evid = p1.stash.filter(function (id) { return R.ITEM[id].kind === "evid"; });
    if (evid.length) {
      await page.evaluate(function () {
        var b = Array.prototype.filter.call(document.querySelectorAll(".fr-stash .fe-act"), function (x) { return /⭐/.test(x.textContent); })[0];
        b.click();
      });
      var p2 = await page.evaluate(function () { return window.PriTestFistRaid.profile(); });
      assert.ok(p2.rep > p1.rep, "提交證據要增加聲望");
    }
  }

  // 第二局：走到體育館區，途中重新整理，要回到同一局
  await clickSel(page, ".fr-go");
  await page.keyboard.press("Enter");
  await tapTile(page, "gym_back");
  await page.waitForTimeout(1500);
  s = await run(page);
  assert.ok(s.t > 0.5, "時間要前進");
  await page.reload();
  await page.waitForTimeout(300);
  assert.strictEqual(await view(page), "raid", "重新整理後回到潛入中的一局");
  var s2 = await run(page);
  assert.ok(Math.abs(s2.t - s.t) < 2.5 && s2.cls === s.cls, "存檔接得上（" + s.t.toFixed(1) + " → " + s2.t.toFixed(1) + "）");
  // 筆記（N 鍵）
  await page.keyboard.press("n");
  assert.ok(await page.evaluate(function () { return window.PriTestFistRaid.paused(); }), "筆記開著時時間暫停");
  for (var lang of ["ja", "en", "zh"]) {
    await page.evaluate(function (l) { window.I18N.setLang(l); }, lang);
    await page.waitForTimeout(120);
    await noRawKeys(page, "潛入中 " + lang);
  }

  // 放棄潛入 → 結算 → 辦公桌，規則說明三語
  await page.evaluate(function () {
    var b = Array.prototype.filter.call(document.querySelectorAll(".fr-foot button"), function (x) { return x.textContent === window.I18N.t("fr_quit"); })[0];
    b.click();
  });
  await page.evaluate(function () {
    var b = Array.prototype.filter.call(document.querySelectorAll(".fr-foot button"), function (x) { return x.textContent === window.I18N.t("fe_yes"); })[0];
    b.click();
  });
  await page.waitForTimeout(1700);
  assert.strictEqual(await view(page), "result", "放棄後顯示結算");
  await clickSel(page, ".fr-result .fe-primary");
  for (var l2 of ["ja", "en", "zh"]) {
    await page.evaluate(function (l) { window.I18N.setLang(l); document.querySelector(".fe-rules").open = true; document.querySelector(".fr-case").open = true; }, l2);
    await noRawKeys(page, "辦公桌 " + l2);
  }

  // 手機寬度：辦公桌與地圖都不能橫向捲動
  await page.setViewportSize({ width: 360, height: 780 });
  var ov1 = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  assert.ok(ov1 <= 0, "手機寬度辦公桌橫向溢出 " + ov1 + "px");
  await clickSel(page, ".fr-go");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  var ov2 = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  await page.screenshot({ path: path.join(SHOT_DIR, "fist_raid_mobile.png"), fullPage: true });
  assert.ok(ov2 <= 0, "手機寬度地圖橫向溢出 " + ov2 + "px");
  var stats3 = await playRaid(page, { leaveAt: 2, shot: "fist_raid_mobile_play.png", dlgShot: "fist_raid_mobile_dialog.png" });
  console.log("手機一局", JSON.stringify(stats3));

  if (await view(page) === "result") await clickSel(page, ".fr-result .fe-primary");
  await page.evaluate(function () {
    var b = Array.prototype.filter.call(document.querySelectorAll(".fr-hub button"), function (x) { return x.textContent === window.I18N.t("fr_back_modes"); })[0];
    b.click();
  });
  await clickSel(page, ".fe-mode:not(.fe-mode-main)");
  assert.ok(await page.$(".fe-seat"), "經典回合制的本機面板還在");

  assert.deepStrictEqual(errors, [], "頁面錯誤：" + errors.join("\n"));
  await browser.close();
  console.log("搜打撤 UI 檢查通過");
})().catch(function (e) { console.error(e); process.exit(1); });
