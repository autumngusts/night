// ============================================================================
// 盛夏合宿（natsu）Playwright 流程檢查：
//   18 禁確認 → 標題 → 選角（換外觀、全部隨機）→ 30 天完整流程（含邂逅角色：偶遇、約出來、告白、交往、夜晚）（晨練、個別指導、練習賽、夏日祭、個人線、告白、交往後的夜晚劇情）
//   → 決賽日 → 結局 → 夜晚回憶可重看 → 手機寬度 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8952 --directory dist
// 執行：node tools/natsu_check/flow_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = (process.env.NATSU_ROOT || "http://localhost:8952/") + "natsu/index.html";
var SHOT_DIR = path.join(__dirname, "shots");
var TARGET = process.env.NATSU_TARGET || "yq";

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
  assert(await page.$('[data-act="age-yes"]'), "要先顯示 18 禁確認");
  await page.dispatchEvent('[data-act="age-yes"]', "click");
  await page.dispatchEvent('[data-act="new"]', "click");
  // 選角：換一次外觀，再全部隨機
  await page.dispatchEvent('[data-act="castPick"][data-id="yq"]', "click");
  var galleryImgs = await page.$$eval(".nt-gimg", function (els) { return els.map(function (e) { return e.getAttribute("data-img"); }); });
  assert(galleryImgs.length >= 120, "頭像庫要列出 g_ 系列（實際 " + galleryImgs.length + "）");
  assert(galleryImgs.every(function (x) { return /^g_\d{3}\.webp$/.test(x); }), "頭像庫只能有 g_ 系列");
  ["g_006", "g_010", "g_017", "g_018", "g_019", "g_026", "g_029", "g_032"].forEach(function (x) { assert(galleryImgs.indexOf(x + ".webp") < 0, "排除名單 " + x + " 不可出現"); });
  await page.dispatchEvent('[data-act="castImg"][data-img="g_100.webp"]', "click");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestNatsu._state().img.yq; }), "g_100.webp", "換外觀要生效");
  await page.dispatchEvent('[data-act="castRandom"]', "click");
  var castImgs = await page.evaluate(function () { var st = window.PriTestNatsu._state(); return Object.keys(st.img).map(function (k) { return st.img[k]; }); });
  assert.strictEqual(new Set(castImgs).size, 8, "全部隨機後 8 人外觀不可重複");
  await page.dispatchEvent('[data-act="castStart"]', "click");

  var seen = { story: 0, match: 0, ending: false, fest: false, lines: 0 };
  for (var guard = 0; guard < 4000; guard++) {
    var r = await page.evaluate(function (target) {
      var N = window.PriTestNatsu, st = N._state(), ui = N._ui(), app = document.getElementById("nt-app");
      function c(sel) { var el = app.querySelector(sel); if (el && !el.disabled) { el.click(); return true; } return false; }
      if (ui.screen === "ending") return "ending";
      if (ui.screen === "story") { c('[data-act="snext"]'); return "story"; }
      if (ui.screen === "vn") {
        var t = ui.vn.title || "";
        if (c('[data-act="next"]')) return "vn:" + t;
        c('[data-act="ch"][data-k="0"]'); return "ch:" + t;
      }
      if (ui.screen === "match") {
        if (c('[data-act="aftermatch"]')) return "matchend";
        var opp = ui.match.opp.style, beat = { defense: "quick", serve: "power", quick: "serve", power: "defense" }[opp];
        c('[data-act="tac"][data-id="' + beat + '"]'); return "set";
      }
      if (c('[data-act="final"]')) return "final";
      if (st.phase === "morning") { var menus = ["combo", "spike", "dig", "serve", "wall", "combo", "rest"]; var id = menus[st.day % menus.length]; if (st.m.yq && Object.keys(st.m).some(function (k) { return st.m[k].sta < 30; })) id = "rest"; c('[data-act="menu"][data-id="' + id + '"]'); return "menu"; }
      if (st.phase === "afternoon") {
        if (c('[data-act="match"]')) return "match";
        if (!c('[data-act="coach"][data-id="' + target + '"]')) c('[data-act="skip"]');
        return "coach";
      }
      if (c('[data-act="fest"][data-id="' + target + '"]')) return "fest";
      var tg = st.m[target];
      if (!tg.dating && (tg.line < 3 || tg.aff >= 75)) { c('[data-act="spot"][data-id="beach"]'); return "spot"; }
      var encDating = Object.keys(st.enc).filter(function (k) { return st.enc[k].dating; });
      if (st.day % 2 === 0 && c('[data-act="visit"][data-id="' + target + '"]')) return "visit";
      if (encDating.length && c('[data-act="visit"][data-id="' + encDating[0] + '"]')) return "visit-enc";
      if (st.day % 2 === 1 && c('[data-act="seek"]')) return "seek";
      if (c('[data-act="visit"][data-id="' + target + '"]')) return "visit";
      c('[data-act="spot"][data-id="beach"]'); return "spot";
    }, TARGET);
    if (r === "ending") { seen.ending = true; break; }
    if (r === "story") seen.story++;
    if (r === "fest") seen.fest = true;
    if (r === "set") seen.match++;
    if (/^vn:.*（\d\/3）/.test(r)) seen.lines++;
    if (seen.story === 1 && r === "story") await page.screenshot({ path: path.join(SHOT_DIR, "night_story.png") });
  }
  var st = await page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestNatsu._state())); });
  await page.screenshot({ path: path.join(SHOT_DIR, "ending.png"), fullPage: true });
  console.log("day", st.day, "team results", JSON.stringify(st.res), "target aff", st.m[TARGET].aff, "dating", st.m[TARGET].dating, "nights", st.m[TARGET].nights, "seen", JSON.stringify(seen));
  assert(seen.ending, "要走到結局");
  assert(seen.fest, "要經過夏日祭");
  assert(st.m[TARGET].dating, "專心攻略一人時，30 天內要能交往");
  assert(seen.story >= 11, "要讀過至少一段夜晚劇情（≥11 頁）");
  assert(st.res.p1 != null && st.res.p2 != null, "兩場練習賽都要打");
  // 夜晚劇情加量（2026-11-12）：共度第 2 晚以後要播到追加的專屬夜晚（own1_ 鍵）
  var alb = await page.evaluate(function () { return JSON.parse(localStorage.getItem("pritest-natsu-album") || "{}"); });
  console.log("album keys", Object.keys(alb).join(" "));
  if (st.m[TARGET].nights >= 2) assert(alb["own1_" + TARGET + "_" + TARGET], "第 2 晚要播追加的專屬夜晚");
  var encs = Object.keys(st.enc).map(function (k) { return st.enc[k]; });
  console.log("encounters", encs.length, encs.map(function (e) { return e.name + "(" + e.job + "," + e.aff + (e.dating ? ",💕" : "") + ")"; }).join(" "));
  assert(encs.length >= 1, "30 天內要遇到邂逅角色");
  assert(encs.some(function (e) { return e.dating && e.nights > 0; }), "主動約出來的邂逅角色要能交往並共度夜晚");
  var allImgs = encs.map(function (e) { return e.img; }).concat(Object.keys(st.img).map(function (k) { return st.img[k]; }));
  assert(allImgs.every(function (x) { return /^g_\d{3}\.webp$/.test(x); }), "所有角色都只能用 g_ 頭像");
  assert.strictEqual(new Set(allImgs).size, allImgs.length, "同一張頭像不可同時是兩個角色");

  // 夜晚回憶
  await page.dispatchEvent('[data-act="title"]', "click");
  await page.dispatchEvent('[data-act="album"]', "click");
  assert(await page.$('[data-act="replay"]'), "夜晚回憶要能重看");
  assert(await page.$('[data-act="replayEnc"]'), "邂逅角色的夜晚也要能重看");
  await page.dispatchEvent('[data-act="replayEnc"]', "click");
  assert(await page.$(".nt-story .nt-vnpt"), "重看邂逅角色的夜晚要顯示頭像");
  while (await page.$('[data-act="snext"]')) await page.dispatchEvent('[data-act="snext"]', "click");
  assert(await page.$(".nt-album"), "重看完要回到夜晚回憶");
  // 手機寬度：標題不超出
  await page.setViewportSize({ width: 380, height: 800 });
  await page.dispatchEvent('[data-act="title"]', "click");
  var over = await page.evaluate(function () { return document.documentElement.scrollWidth > window.innerWidth + 1; });
  await page.screenshot({ path: path.join(SHOT_DIR, "mobile_title.png") });
  assert(!over, "手機寬度不可以水平捲動");
  assert.deepStrictEqual(errors, [], "不可以有 console error：" + errors.join("\n"));
  console.log("natsu flow_check OK");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
