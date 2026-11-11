// ============================================================================
// 星途巡演（tour）Playwright 流程檢查：
//   18 禁確認 → 標題 → 選角（換外觀、全部隨機）→ 20 站完整流程（含邂逅角色：偶遇、白天約會、約出來、告白、交往、夜晚）（白天行動、單獨相處、個人線、告白、交往、夜晚劇情、狗仔爆料）
//   → 第一站用模擬按鍵實際打節奏遊戲（要拿到高準確率）→ 其餘自動演出 → 大巨蛋結局 → 夜晚回憶 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8952 --directory dist
// 執行：node tools/tour_check/flow_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = (process.env.TOUR_ROOT || "http://localhost:8952/") + "tour/index.html";
var SHOT_DIR = path.join(__dirname, "shots");
var TARGET = process.env.TOUR_TARGET || "th";

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload();
  await page.dispatchEvent('[data-act="age-yes"]', "click");
  await page.dispatchEvent('[data-act="new"]', "click");
  await page.dispatchEvent('[data-act="castPick"][data-id="yk"]', "click");
  var galleryImgs = await page.$$eval(".tr-gimg", function (els) { return els.map(function (e) { return e.getAttribute("data-img"); }); });
  assert(galleryImgs.length >= 120 && galleryImgs.every(function (x) { return /^g_\d{3}\.webp$/.test(x); }), "頭像庫只能有 g_ 系列");
  ["g_006", "g_010", "g_017", "g_018", "g_019", "g_026", "g_029", "g_032"].forEach(function (x) { assert(galleryImgs.indexOf(x + ".webp") < 0, "排除名單 " + x + " 不可出現"); });
  await page.dispatchEvent('[data-act="castRandom"]', "click");
  assert.strictEqual(new Set(await page.evaluate(function () { var st = window.PriTestTour._state(); return Object.keys(st.img).map(function (k) { return st.img[k]; }); })).size, 5, "全部隨機後 5 人外觀不可重複");
  await page.dispatchEvent('[data-act="castStart"]', "click");

  var seen = { story: 0, scandal: false, manual: null, shows: 0 };
  for (var guard = 0; guard < 4000; guard++) {
    var r = await page.evaluate(function (target) {
      var T = window.PriTestTour, st = T._state(), ui = T._ui(), app = document.getElementById("tr-app");
      function c(sel) { var el = app.querySelector(sel); if (el && !el.disabled) { el.click(); return true; } return false; }
      if (ui.screen === "ending") return "ending";
      if (ui.screen === "rhythm") return "rhythm";
      if (ui.screen === "result") { var res = ui.result; c('[data-act="toEnding"]') || c('[data-act="toNight"]'); return "result:" + (res.auto ? "auto" : res.acc.toFixed(3)); }
      if (ui.screen === "story") { c('[data-act="snext"]'); return "story"; }
      if (ui.screen === "vn") { var t = ui.vn.title || ""; if (c('[data-act="next"]')) return "vn:" + t; c('[data-act="ch"][data-k="0"]'); return "ch:" + t; }
      if (st.phase === "day") {
        var encIds = Object.keys(st.enc).sort(function (a, b) { return st.enc[b].aff - st.enc[a].aff; });
        var encTarget = encIds.filter(function (k) { return !st.enc[k].dating; })[0];
        if (ui.pickDate && st.city % 2 === 1 && encTarget && c('[data-act="dateWith"][data-id="' + encTarget + '"]')) return "date-enc";
        if (c('[data-act="dateWith"][data-id="' + target + '"]')) return "date";
        if (st.slot === 0) { c('[data-act="action"][data-id="date"]'); return "pick"; }
        var avgSta = Object.keys(st.m).reduce(function (a, k) { return a + st.m[k].sta; }, 0) / 5;
        c('[data-act="action"][data-id="' + (avgSta < 45 ? "rest" : st.city % 2 ? "promo" : "rehearse") + '"]'); return "act";
      }
      if (st.phase === "show") { c('[data-act="song"][data-id="' + (st.city === 0 ? "lumina" : "sunrise") + '"]'); return "song"; }
      var encDating = Object.keys(st.enc).filter(function (k) { return st.enc[k].dating; });
      if (st.city % 3 === 1 && encDating.length && c('[data-act="visit"][data-id="' + encDating[0] + '"]')) return "visit-enc";
      if (st.city % 3 === 2 && c('[data-act="seek"]')) return "seek";
      if (c('[data-act="visit"][data-id="' + target + '"]')) return "visit";
      c('[data-act="spot"][data-id="bar"]'); return "spot";
    }, TARGET);
    if (r === "ending") break;
    if (r === "story") seen.story++;
    if (/週刊爆料/.test(r)) seen.scandal = true;
    if (/^result:/.test(r)) { seen.shows++; if (r !== "result:auto") seen.manual = +r.slice(7); }
    if (r === "rhythm") {
      var isFirst = await page.evaluate(function () { return window.PriTestTour._state().city === 0; });
      if (isFirst) {
        // 第一站：依譜面時間送出按鍵，模擬玩家實際打
        await page.screenshot({ path: path.join(SHOT_DIR, "rhythm.png") });
        await page.evaluate(function () {
          var rg = window.PriTestTour._ui().rg, keys = ["d", "f", "j", "k"];
          return new Promise(function (done) {
            rg.notes.forEach(function (n) {
              var at = (rg.t0 + n.t) * 1000 - performance.now();
              setTimeout(function () { document.dispatchEvent(new KeyboardEvent("keydown", { key: keys[n.lane] })); }, Math.max(0, at));
            });
            var check = setInterval(function () { if (window.PriTestTour._ui().screen !== "rhythm") { clearInterval(check); done(); } }, 200);
          });
        });
      } else {
        await page.dispatchEvent('[data-act="auto"]', "click");
      }
    }
  }
  var st = await page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestTour._state())); });
  await page.screenshot({ path: path.join(SHOT_DIR, "ending.png"), fullPage: true });
  console.log("city", st.city + 1, "fans", Math.round(st.fans), "zap", st.zap, "target", JSON.stringify({ aff: st.m[TARGET].aff, dating: st.m[TARGET].dating, nights: st.m[TARGET].nights }), "seen", JSON.stringify(seen));
  assert.strictEqual(st.city, 19, "要走到第 20 站");
  assert.strictEqual(seen.shows, 20, "20 站都要演出");
  assert(seen.manual != null && seen.manual > 0.85, "模擬按鍵實際打節奏遊戲要能拿高準確率（實際 " + seen.manual + "）");
  assert(st.m[TARGET].dating, "專心攻略一人時要能交往");
  assert(seen.story >= 11, "要讀過至少一段夜晚劇情");
  var encs = Object.keys(st.enc).map(function (k) { return st.enc[k]; });
  console.log("encounters", encs.length, encs.map(function (e) { return e.name + "(" + (e.home ? e.home + "的" : "") + e.job + "," + e.aff + (e.dating ? ",💕" : "") + ")"; }).join(" "));
  assert(encs.length >= 1, "巡演中要遇到邂逅角色");
  assert(encs.some(function (e) { return e.dating && e.nights > 0; }), "邂逅角色要能交往並共度夜晚");
  var allImgs = encs.map(function (e) { return e.img; }).concat(Object.keys(st.img).map(function (k) { return st.img[k]; }));
  assert(allImgs.every(function (x) { return /^g_\d{3}\.webp$/.test(x); }), "所有角色都只能用 g_ 頭像");
  assert.strictEqual(new Set(allImgs).size, allImgs.length, "同一張頭像不可同時是兩個角色");
  await page.dispatchEvent('[data-act="title"]', "click");
  await page.dispatchEvent('[data-act="album"]', "click");
  assert(await page.$('[data-act="replay"]'), "夜晚回憶要能重看");
  assert(await page.$('[data-act="replayEnc"]'), "邂逅角色的夜晚也要能重看");
  await page.dispatchEvent('[data-act="replayEnc"]', "click");
  while (await page.$('[data-act="snext"]')) await page.dispatchEvent('[data-act="snext"]', "click");
  assert(await page.$(".tr-album"), "重看完要回到夜晚回憶");
  await page.setViewportSize({ width: 380, height: 800 });
  await page.dispatchEvent('[data-act="title"]', "click");
  assert(!(await page.evaluate(function () { return document.documentElement.scrollWidth > window.innerWidth + 1; })), "手機寬度不可以水平捲動");
  assert.deepStrictEqual(errors, [], "不可以有 console error：" + errors.join("\n"));
  console.log("tour flow_check OK");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
