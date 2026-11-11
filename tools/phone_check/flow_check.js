// ============================================================================
// 手機裡的她們（phone）Playwright 流程檢查：
//   18 禁確認 → 21 天 × 4 時段（打開通知、選語氣回覆、貼圖、記憶題、限動按讚、交友 App 滑卡、
//   約會邀請 → 行事曆 → 約會、告白、交往、深夜去她家、視訊通話、已讀不回）→ 最後一晚 → 結局 → 回憶 → 手機寬度 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8953 --directory dist
// 執行：node tools/phone_check/flow_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = (process.env.PHONE_ROOT || "http://localhost:8953/") + "phone/index.html";
var SHOT_DIR = path.join(__dirname, "shots");

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload();
  assert(await page.$('[data-act="age-yes"]'), "要先顯示 18 禁確認");
  await page.dispatchEvent('[data-act="age-yes"]', "click");
  await page.dispatchEvent('[data-act="new"]', "click");

  var seen = { story: 0, quiz: 0, date: 0, call: 0, match: 0, ignored: 0, shot: false };
  for (var guard = 0; guard < 6000; guard++) {
    var r = await page.evaluate(function () {
      var Ph = window.PriTestPhone, st = Ph._state(), ui = Ph._ui(), app = document.getElementById("ph-app"), D = window.PriTestPhoneData;
      function c(sel) { var el = app.querySelector(sel); if (el && !el.disabled) { el.click(); return true; } return false; }
      function P(id) { return D.GIRLS.filter(function (g) { return g.id === id; })[0] || st.mp[id]; }
      if (ui.screen === "ending") return "ending";
      if (ui.screen === "story") { c('[data-act="snext"]'); return "story"; }
      if (ui.screen === "vn") { var t = ui.vn.title || ""; if (c('[data-act="next"]')) return /約會|見面/.test(t) ? "date" : "vn"; c('[data-act="ch"][data-k="0"]'); return "ch"; }
      if (ui.screen === "final") { if (!c('[data-act="partner"][data-id]:not([data-id=""])')) c('[data-act="partner"]'); return "final"; }
      if (ui.screen !== "phone") return "screen:" + ui.screen;
      if (st.call) { if (ui.view !== "home") { c('[data-act="view"][data-v="home"]'); return "home"; } c('[data-act="call"]'); return "call"; }
      // 限動按讚、交友滑卡（只在早上）
      if (st.slot === 0 && st.stories.some(function (s) { return !s.liked; })) { if (ui.view !== "stories") { c('[data-act="view"][data-v="stories"]'); return "stories"; } c('[data-act="like"]:not([disabled])'); return "like"; }
      if (st.slot === 0 && st.day <= 4 && st.deck.length) { if (ui.view !== "match") { c('[data-act="view"][data-v="match"]'); return "matchview"; } c('[data-act="swipe"][data-dir="' + (st.day <= 2 ? 1 : 0) + '"]'); return "swipe"; }
      // 回覆：交往中＞約會邀請＞好感高的人；每個時段只回 3 則，故意留 1 則已讀不回（第 3 天）
      if (ui.view === "thread") {
        var id = ui.chat, cc = st.c[id], m = cc && cc.pend;
        if (m && st.replies > 0) {
          var g = P(id), k = 0;
          if (m.k === "quiz") k = m.o.map(function (o) { return o[1]; }).indexOf("R");
          else { var li = m.o.map(function (o) { return o[1]; }).indexOf(g.like); k = li >= 0 ? li : 0; if (m.k !== "invite") { var sb = app.querySelector('[data-act="sticker"][data-s="' + g.sticker + '"]'); if (sb) sb.click(); } }
          app.querySelector('[data-act="reply"][data-k="' + k + '"]').click();
          return m.k === "quiz" ? "quiz" : "reply";
        }
        if (st.slot === 3 && cc && cc.stage >= 3 && st.replies > 0 && c('[data-act="invitenight"]')) return "night";
        c('[data-act="view"][data-v="chats"]'); return "back";
      }
      var pend = Object.keys(st.c).filter(function (id) { return st.c[id].pend && !st.c[id].pend.read; });
      pend.sort(function (a, b) { var ia = st.c[a].pend.k === "invite" ? 100 : 0, ib = st.c[b].pend.k === "invite" ? 100 : 0; return (ib + st.c[b].aff) - (ia + st.c[a].aff); });
      if (pend.length && st.replies > 0) { c('[data-act="view"][data-v="chats"]'); app.querySelector('[data-act="open"][data-id="' + pend[0] + '"]').click(); return "open"; }
      if (st.day === 3 && pend.length && st.replies <= 0) { app.querySelector('[data-act="view"][data-v="chats"]').click(); app.querySelector('[data-act="open"][data-id="' + pend[0] + '"]').click(); app.querySelector('[data-act="view"][data-v="chats"]').click(); return "ignore"; }
      // 深夜：交往中的人去她家
      if (st.slot === 3 && st.replies > 0) { var ds = Object.keys(st.c).filter(function (id) { return st.c[id].stage >= 3; }); if (ds.length) { c('[data-act="view"][data-v="chats"]'); app.querySelector('[data-act="open"][data-id="' + ds[0] + '"]').click(); return "opennight"; } }
      c('[data-act="nextslot"]'); return "next";
    });
    if (r === "story") seen.story++;
    if (r === "quiz") seen.quiz++;
    if (r === "date") seen.date++;
    if (r === "call") seen.call++;
    if (r === "ignore") seen.ignored++;
    if (r === "reply" && !seen.shot) { seen.shot = true; await page.screenshot({ path: path.join(SHOT_DIR, "01_thread.png") }); }
    if (r === "ending") break;
    if (/^screen:/.test(r)) throw new Error("意外的畫面：" + r + " / " + errors.join(" | "));
  }
  var fin = await page.evaluate(function () { var st = window.PriTestPhone._state(), ui = window.PriTestPhone._ui(); return { screen: ui.screen, partner: ui.end && ui.end.partner, contacts: Object.keys(st.c).length, stages: Object.keys(st.c).map(function (k) { return k + ":" + st.c[k].stage + "/" + st.c[k].aff; }).join(" ") }; });
  console.log("結局：", JSON.stringify(fin), JSON.stringify(seen));
  assert.strictEqual(fin.screen, "ending", "要走到結局");
  assert(fin.contacts >= 8, "8 位女主角都要加好友");
  assert(seen.quiz > 0, "要出現記憶題");
  assert(seen.story > 0, "要能交往並看到夜晚劇情");
  // 2026-11-12 加量：每位女主角 4 段專屬夜晚，第 2 段以後的專屬劇情要真的被播到
  var albumKeys = await page.evaluate(function () { return Object.keys(JSON.parse(localStorage.getItem("pritest-phone-album") || "{}")); });
  assert(albumKeys.some(function (k) { return /^own[123]_/.test(k); }), "第 2〜4 段專屬夜晚要能播到（相簿：" + albumKeys.join(",") + "）");
  await page.screenshot({ path: path.join(SHOT_DIR, "02_ending.png"), fullPage: true });
  await page.dispatchEvent('[data-act="title"]', "click");
  await page.dispatchEvent('[data-act="album"]', "click");
  assert((await page.$$('[data-act="replay"]')).length > 0, "回憶要能重看");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.dispatchEvent('[data-act="title"]', "click");
  await page.dispatchEvent('[data-act="new"]', "click");
  for (var k = 0; k < 10; k++) { if (!(await page.$('[data-act="next"]'))) break; await page.dispatchEvent('[data-act="next"]', "click"); }
  var ov = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  assert(ov <= 1, "手機寬度不可以橫向捲動（多出 " + ov + "px）");
  await page.screenshot({ path: path.join(SHOT_DIR, "03_mobile.png"), fullPage: true });
  assert.deepStrictEqual(errors, [], "不可以有 console error：" + errors.join("\n"));
  console.log("OK phone flow_check");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
