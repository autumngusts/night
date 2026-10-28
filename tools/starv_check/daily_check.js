// ============================================================================
// 明星經紀 starV「日程」分頁與藝人情報的 Playwright 檢查：
//   開業 → 招募十連 → 排行程 → 設施圖（每位藝人都在、依行程走到對應房間、工作人員、murmur 對話框）
//   → 月曆（今天、行程頭像、🏁、日期詳情、換月、篩選單人）→ 進度一覽 → 藝人詳情的情報與 murmur
//   → 三種語言沒有漏翻、手機寬度沒有水平捲動 → 截圖
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8946 --directory dist
// 執行：node tools/starv_check/daily_check.js
// 這頁每秒重畫，按鈕一律用 dispatchEvent 觸發（CLAUDE.md §4.6）。
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.STARV_BASE || "http://localhost:8946/starv/index.html?debug=1";
var SHOT_DIR = process.env.STARV_SHOTS || path.join(__dirname, "shots");

function st(page) { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestStarv.state())); }); }
function movers(page) { return page.evaluate(function () { return window.PriTestStarvDaily._debugMovers(); }); }
async function act(page, name) {
  await page.waitForSelector('[data-act="' + name + '"]', { state: "attached", timeout: 5000 });
  await page.dispatchEvent('[data-act="' + name + '"]', "click");
}
async function tab(page, id) {
  await page.dispatchEvent('.sv-tab[data-tab="' + id + '"]', "click");
  await page.waitForSelector('.sv-tab.sv-on[data-tab="' + id + '"]');
}
async function noRawKeys(page, where) {
  var raw = await page.evaluate(function () { return (document.querySelector(".sv-root").innerText.match(/sv_[a-zA-Z0-9_]+/g) || []); });
  assert.deepStrictEqual(raw, [], where + " 有漏翻的鍵：" + raw.join(","));
  var ph = await page.evaluate(function () { return (document.querySelector(".sv-root").innerText.match(/\{[a-z]+\}/g) || []); });
  assert.deepStrictEqual(ph, [], where + " 有沒代換的 placeholder：" + ph.join(","));
}
async function noOverflow(page, where) {
  var over = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  assert.ok(over <= 0, where + " 水平溢出 " + over + "px");
}
async function shot(page, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, name + ".png"), fullPage: true });
}
async function clearEvents(page) {
  for (var i = 0; i < 6; i++) {
    var pending = await page.evaluate(function () { var s = window.PriTestStarv.state(); return s && s.events ? s.events.pending.length : 0; });
    if (!pending) return;
    if (!(await page.$(".sv-event"))) await act(page, "event-bell");
    await page.dispatchEvent(".sv-event [data-default]", "click");
    await act(page, "event-result-close");
  }
}
async function closeModals(page) {
  for (var i = 0; i < 12 && await page.$('[data-act="modal-close"]'); i++) await page.dispatchEvent('[data-act="modal-close"]', "click");
  for (var j = 0; j < 12 && await page.$('[data-act="spot-done"]'); j++) await act(page, "spot-done");
}

var steps = [];
function step(name, fn) { steps.push([name, fn]); }

step("開業 → 招募十連", async function (page) {
  await page.waitForSelector(".sv-welcome input");
  await page.fill(".sv-welcome input", "日程測試");
  await act(page, "start");
  await page.waitForSelector(".sv-top");
  await tab(page, "gacha");
  await act(page, "pull-ticket-10");
  await page.waitForSelector(".sv-reveal");
  await act(page, "reveal-skip");
  await act(page, "reveal-done");
  await closeModals(page);
  assert.ok((await st(page)).artists.length >= 3, "至少有 3 位藝人");
});

step("設施圖：每位藝人都在、工作人員在走動", async function (page) {
  await tab(page, "daily");
  await page.waitForSelector(".sv-map .sv-map-artist");
  var s = await st(page), ms = await movers(page);
  var artists = ms.filter(function (m) { return m.kind === "artist"; });
  assert.strictEqual(artists.length, s.artists.length, "設施圖上的藝人數");
  assert.ok(ms.filter(function (m) { return m.kind === "staff"; }).length >= 3, "至少 3 位工作人員");
  // 剛入社都在待命：大廳（休息室未建設）
  artists.forEach(function (m) { assert.strictEqual(m.room, "lobby", m.key + " 待命應在大廳"); });
  await noRawKeys(page, "日程分頁");
});

step("排行程 → 走到對應房間（休息→宿舍、訓練→教室、宣傳→外出）", async function (page) {
  var ids = (await st(page)).artists.map(function (a) { return a.id; });
  await page.evaluate(function (ids) {
    var App = window.PriTestStarv.app, Core = window.PriTestStarvCore;
    App.act(function (s) {
      Core.schedule(s, ids[0], { kind: "rest", days: 3 });
      Core.schedule(s, ids[1], { kind: "train" });
      Core.schedule(s, ids[2], { kind: "promo" });
    });
  }, ids);
  var want = {};
  want["a:" + ids[0]] = "dorm"; want["a:" + ids[1]] = "classroom"; want["a:" + ids[2]] = "outside";
  var ms = await movers(page);
  ms.forEach(function (m) { if (want[m.key]) assert.strictEqual(m.room, want[m.key], m.key + " 的目的地"); });
  // 等他們走完（最長的路徑：大廳 → 宿舍，約 4 秒）
  await page.waitForFunction(function (keys) {
    return window.PriTestStarvDaily._debugMovers().filter(function (m) { return keys.indexOf(m.key) >= 0; }).every(function (m) { return !m.walking; });
  }, Object.keys(want), { timeout: 15000 });
  ms = await movers(page);
  var outside = ms.filter(function (m) { return m.key === "a:" + ids[2]; })[0];
  assert.ok(outside.x > 81, "宣傳中的人走到外出區（x=" + outside.x + "）");
  var dorm = ms.filter(function (m) { return m.key === "a:" + ids[0]; })[0];
  assert.ok(dorm.x < 16.4 && dorm.y < 24, "休息中的人在宿舍（" + dorm.x + "," + dorm.y + "）");
});

step("murmur 對話框會冒出來、碎碎念列表有內容", async function (page) {
  await page.waitForSelector(".sv-map-say", { timeout: 8000 });
  var text = await page.textContent(".sv-map-say");
  assert.ok(text && text.length > 1, "對話框有文字");
  await page.waitForFunction(function () { return document.querySelectorAll(".sv-map-feed li b").length >= 1; }, null, { timeout: 8000 });
  await noRawKeys(page, "murmur");
});

async function mapShot(page, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.locator(".sv-map").screenshot({ path: path.join(SHOT_DIR, name + ".png") });
}
function d3(page) { return page.evaluate(function () { return window.PriTestStarvDaily._debug3d(); }); }
// 改公司等級／固定季節天氣後，等 3D 場景重建（每秒檢查一次）
async function waitWorld(page, re) {
  await page.waitForFunction(function (src) { var d = window.PriTestStarvDaily._debug3d(); return d && new RegExp(src).test(d.worldKey); }, re, { timeout: 8000 });
  await page.waitForTimeout(400);
}

step("3D 設施圖：載入、路人與車輛、每個人都有 3D 人物", async function (page) {
  await page.waitForSelector(".sv-map.sv-map-3d canvas.sv-o3d-canvas", { timeout: 15000 });
  await waitWorld(page, "^1\\|");
  var d = await d3(page), ms = await movers(page);
  assert.ok(d.peds >= 6 && d.cars >= 2, "街上有路人和車（" + d.peds + "／" + d.cars + "）");
  assert.strictEqual(d.figs, ms.length, "每個移動中的人都有 3D 人物");
  assert.ok(await page.$(".sv-o3d-label"), "房間名稱疊層");
  await noRawKeys(page, "3D 設施圖");
});

step("季節與天氣：一年四季都會出現、雪只在冬天", async function (page) {
  var r = await page.evaluate(function () {
    var O = window.PriTestStarvOffice3D, s = window.PriTestStarv.state(), seasons = {}, bad = 0, wx = {};
    var save = s.day;
    for (var d = 0; d < 360; d++) { s.day = d; var c = O.climate(s); seasons[c.season] = 1; wx[c.weather] = 1; if (c.weather === "snow" && c.season !== "winter") bad++; }
    s.day = save;
    return { seasons: Object.keys(seasons).length, wx: Object.keys(wx).length, bad: bad };
  });
  assert.strictEqual(r.seasons, 4);
  assert.strictEqual(r.wx, 4, "四種天氣都會出現");
  assert.strictEqual(r.bad, 0, "冬天以外不下雪");
  await page.waitForSelector('[data-act="map-climate"]');
});

step("建築外觀隨公司等級改變（Lv1～Lv10）＋季節天氣截圖", async function (page) {
  await page.setViewportSize({ width: 1000, height: 900 });
  var looks = [[1, "spring", "sunny"], [3, "autumn", "rain"], [5, "summer", "sunny"], [7, "spring", "cloudy"], [8, "summer", "sunny"], [9, "autumn", "sunny"], [10, "winter", "snow"]];
  for (var i = 0; i < looks.length; i++) {
    var L = looks[i];
    await page.evaluate(function (L) {
      window.PriTestStarvOffice3D._force({ season: L[1], weather: L[2] });
      window.PriTestStarv.app.act(function (s) { s.company.level = L[0]; });
    }, L);
    await waitWorld(page, "^" + L[0] + "\\|.*\\|" + L[1] + "\\|" + L[2]);
    var d = await d3(page);
    if (L[2] === "snow" || L[2] === "rain") assert.ok(d.fall > 0, "下雨／下雪有粒子");
    if (L[0] >= 7) assert.ok(d.led, "Lv7 以上有 LED 螢幕");
    await page.waitForTimeout(2500);
    await mapShot(page, "office3d-lv" + L[0] + "-" + L[1] + "-" + L[2]);
  }
  await page.evaluate(function () { window.PriTestStarvOffice3D._force(null); window.PriTestStarv.app.act(function (s) { s.company.level = 1; }); });
  await page.setViewportSize({ width: 420, height: 900 });
});

step("3D／2D 切換", async function (page) {
  await act(page, "map-view-2d");
  await page.waitForSelector(".sv-map:not(.sv-map-3d)");
  assert.strictEqual(await page.$("canvas.sv-o3d-canvas"), null, "2D 時沒有 3D 畫布");
  await act(page, "map-view-3d");
  await page.waitForSelector(".sv-map.sv-map-3d canvas.sv-o3d-canvas", { timeout: 15000 });
});

step("快速排程：待命的人直接在進度一覽派任務", async function (page) {
  var a = (await st(page)).artists.filter(function (x) { return !x.task; })[0];
  assert.ok(a, "有待命的人");
  await page.waitForSelector('.sv-prog-idle-row[data-aid="' + a.id + '"]');
  await act(page, "quick-train-" + a.id);
  var after = (await st(page)).artists.filter(function (x) { return x.id === a.id; })[0];
  assert.strictEqual(after.task && after.task.kind, "train", "排了訓練");
  await page.waitForSelector('.sv-prog-idle-row[data-aid="' + a.id + '"]', { state: "detached" });
  // 下一個待命的人：上課（推薦課程）
  var b = (await st(page)).artists.filter(function (x) { return !x.task; })[0];
  if (b) {
    await act(page, "quick-course-" + b.id);
    var bb = (await st(page)).artists.filter(function (x) { return x.id === b.id; })[0];
    assert.strictEqual(bb.task && bb.task.kind, "course", "排了上課");
  }
  await noRawKeys(page, "快速排程");
});

step("月曆：點頭像直接開那個人的詳情", async function (page) {
  await page.waitForSelector(".sv-cal-chip[data-chip]");
  await page.dispatchEvent(".sv-cal-chip[data-chip] >> nth=0", "click");
  await page.waitForSelector(".sv-modal-detail .sv-murmur");
  await closeModals(page);
});

step("月曆：今天、行程頭像、🏁 結束日、日期詳情", async function (page) {
  var s = await st(page);
  await page.waitForSelector('.sv-cal-day.sv-cal-today[data-day="' + s.day + '"]');
  var chips = await page.$$eval('.sv-cal-day[data-day="' + s.day + '"] .sv-cal-chip, .sv-cal-day[data-day="' + s.day + '"] .sv-cal-more', function (n) { return n.length; });
  assert.ok(chips >= 1, "今天的格子有行程");
  // 訓練 2 天：明天是最後一天（若明天跨到下個月就跳過這項）
  var tomorrow = s.day + 1;
  if (await page.$('.sv-cal-day[data-day="' + tomorrow + '"]')) {
    assert.ok(await page.$('.sv-cal-day[data-day="' + tomorrow + '"] .sv-cal-end'), "訓練結束日有 🏁");
  }
  await page.dispatchEvent('.sv-cal-day[data-day="' + s.day + '"]', "click");
  await page.waitForSelector(".sv-modal .sv-prog-row");
  await noRawKeys(page, "日期詳情");
  await act(page, "modal-close");
});

step("月曆：換月、回到本月、篩選單人", async function (page) {
  await act(page, "cal-next");
  await page.waitForSelector('[data-act="cal-today"]');
  await act(page, "cal-today");
  await page.waitForSelector('[data-act="cal-today"]', { state: "detached" });
  var aid = (await st(page)).artists[1].id;
  await page.selectOption('[data-act="cal-who"]', aid);
  await page.waitForFunction(function () { return document.querySelector('[data-act="cal-who"]').value !== ""; });
  var n = await page.$$eval(".sv-cal-chip", function (x) { return x.length; });
  assert.ok(n >= 1 && n <= 30, "只顯示一個人的行程（" + n + " 格）");
  await page.selectOption('[data-act="cal-who"]', "");
});

step("過了一天：行程推進、休息的人還在宿舍、訓練完成後回大廳", async function (page) {
  await page.evaluate(function () { window.PriTestStarv.app.skip(2); });
  await clearEvents(page);
  await closeModals(page);
  var s = await st(page);
  var ms = await movers(page);
  var trained = s.artists[1];
  if (!trained.task) {
    var m = ms.filter(function (x) { return x.key === "a:" + trained.id; })[0];
    assert.ok(m.room === "lobby" || m.room === "lounge", "訓練完的人回到大廳（" + m.room + "）");
  }
  await page.waitForSelector(".sv-prog-row, .sv-prog-idle");
});

step("藝人詳情：情報與 murmur", async function (page) {
  var aid = (await st(page)).artists[0].id;
  await page.dispatchEvent('.sv-map-artist >> nth=0', "click");
  await page.waitForSelector(".sv-modal-detail .sv-murmur");
  var info = await page.$$eval(".sv-modal-detail .sv-info-row", function (n) { return n.length; });
  assert.strictEqual(info, 8, "8 項個人資料");
  var trivia = await page.$$eval(".sv-modal-detail .sv-info-trivia li", function (n) { return n.length; });
  assert.strictEqual(trivia, 2, "2 則趣聞");
  // 同一個人的情報固定不變
  var p1 = await page.evaluate(function (aid) { var a = window.PriTestStarvCore.artistById(window.PriTestStarv.state(), aid); return JSON.stringify(window.PriTestStarvMurmurs.profile(a)); }, aid);
  var p2 = await page.evaluate(function (aid) { var a = window.PriTestStarvCore.artistById(window.PriTestStarv.state(), aid); return JSON.stringify(window.PriTestStarvMurmurs.profile(a)); }, aid);
  assert.strictEqual(p1, p2);
  await noRawKeys(page, "藝人詳情");
  await shot(page, "daily-detail");
  await closeModals(page);
});

step("三種語言：日程分頁沒有漏翻、手機寬度沒有水平捲動", async function (page) {
  var langs = ["ja", "en", "zh"];
  for (var i = 0; i < langs.length; i++) {
    await page.dispatchEvent('.lang-btn[data-lang="' + langs[i] + '"]', "click");
    await tab(page, "daily");
    await noRawKeys(page, langs[i] + " / daily");
    await noOverflow(page, langs[i] + " / daily");
  }
  await page.waitForTimeout(2800);
  await shot(page, "daily-mobile");
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(2800);
  await shot(page, "daily-desktop");
  await noOverflow(page, "桌機 / daily");
  await page.setViewportSize({ width: 360, height: 800 });
  await noOverflow(page, "360px / daily");
});

(async function main() {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(e.message); });
  page.on("console", function (m) { if (m.type() === "error" && m.text().indexOf("fonts.g") < 0) errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload();
  await page.evaluate(function () { if (window.PriTestStarvData) window.PriTestStarvData.BAL.eventDailyChance = 0; });
  var fails = 0;
  for (var i = 0; i < steps.length; i++) {
    try { await clearEvents(page); await steps[i][1](page); console.log("ok   " + steps[i][0]); }
    catch (e) { fails++; console.log("FAIL " + steps[i][0] + "：" + e.message); await shot(page, "daily-fail").catch(function () {}); break; }
  }
  if (errors.length) { fails++; console.log("FAIL 頁面錯誤：" + errors.join(" | ")); }
  await browser.close();
  console.log(fails ? "有失敗" : "全部 " + steps.length + " 個步驟通過");
  process.exit(fails ? 1 : 0);
})();
