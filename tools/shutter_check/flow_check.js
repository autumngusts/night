// ============================================================================
// 快門之後（shutter）Playwright 流程檢查：
//   18 禁確認 → 標題 → 選角（頭像池只有 g_、排除名單）→ 60 天完整流程
//   （邀約、接案、拍攝小遊戲、挑片、章節、約會、個人故事、告白、交往後的夜晚、器材行、作品集）
//   → 交稿選封面 → 結局 → 夜晚回憶 → 評分函式的健全性 → 手機寬度 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8953 --directory dist
// 執行：node tools/shutter_check/flow_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = (process.env.SHUTTER_ROOT || "http://localhost:8953/") + "shutter/index.html";
var SHOT_DIR = path.join(__dirname, "shots");

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
  await page.screenshot({ path: path.join(SHOT_DIR, "01_title.png") });
  await page.dispatchEvent('[data-act="new"]', "click");
  await page.dispatchEvent('[data-act="castPick"][data-id="yu"]', "click");
  var imgs = await page.$$eval(".sh-gimg", function (els) { return els.map(function (e) { return e.getAttribute("data-img"); }); });
  assert(imgs.length >= 110, "頭像庫要列出 g_ 系列（實際 " + imgs.length + "）");
  assert(imgs.every(function (x) { return /^g_\d{3}\.webp$/.test(x); }), "頭像庫只能有 g_ 系列");
  ["g_006", "g_010", "g_017", "g_018", "g_019", "g_026", "g_029", "g_032"].forEach(function (x) { assert(imgs.indexOf(x + ".webp") < 0, "排除名單 " + x + " 不可出現"); });
  await page.dispatchEvent('[data-act="castImg"][data-img="g_066.webp"]', "click");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestShutter._state().img.yu; }), "g_066.webp", "換外觀要生效");
  await page.dispatchEvent('[data-act="castReset"]', "click");
  await page.dispatchEvent('[data-act="castStart"]', "click");

  // 評分健全性：同一個場景，對準＋對的燈光＋好時機 ＞ 沒對準＋錯燈光＋壞時機
  var sc = await page.evaluate(function () {
    var S = window.PriTestShutterShoot;
    var base = { sc: "studio", mx: 450, mh: 330, pose: "natural", lens: "std50", film: "color", gear: { softbox: 1 }, mood: 70, best: null,
      cs: { mood: "soft", frame: "half", want: ["natural"] } };
    var good = Object.assign({}, base, { zoom: 1.7, L: { d: "front", s: true, i: 55, f: 60 } });
    var fw = 900 / 1.7, fh = 600 / 1.7; good.fx = 450 - fw * 2 / 3; good.fy = (600 - 330 * 0.62) - fh / 3;
    var bad = Object.assign({}, base, { zoom: 1.2, fx: 0, fy: 0, L: { d: "back", s: false, i: 10, f: 0 } });
    return { g: S.score(good, 0.97).score, b: S.score(bad, 0.4).score };
  });
  assert(sc.g >= 80 && sc.b < 45 && sc.g > sc.b + 30, "評分要能分出好壞（好 " + sc.g + "／壞 " + sc.b + "）");

  var seen = { story: 0, chapters: 0, ending: false, select: 0, shopShot: false, shootShot: false };
  for (var guard = 0; guard < 6000; guard++) {
    var r = await page.evaluate(function () {
      var G = window.PriTestShutter, st = G._state(), ui = G._ui(), app = document.getElementById("sh-app"), SH = window.PriTestShutterShoot, D = window.PriTestShutterData;
      function c(sel) { var el = app.querySelector(sel); if (el && !el.disabled) { el.click(); return true; } return false; }
      if (ui.screen === "ending") return "ending";
      if (ui.screen === "story") { c('[data-act="snext"]'); return "story"; }
      if (ui.screen === "vn") { var t = ui.vn.title || ""; if (c('[data-act="next"]')) return "vn:" + t; c('[data-act="ch"][data-k="0"]'); return "ch:" + t; }
      if (ui.screen === "shoot") {
        var s = SH._sess(); if (!s) return "noshoot";
        if (s.left > 0) {
          // 依主題調燈光：戲劇用側光硬光，其餘用柔光、補光多
          s.L.i = Math.min(D.SCENES[s.sc].exp, s.gear.strobe ? 100 : 60);
          if (s.cs.mood === "dramatic") { s.L.d = "left"; s.L.s = false; s.L.f = 25; } else { s.L.d = "front"; s.L.s = true; s.L.f = 55; }
          if (!s.talked && s.photos.length === 1) { var want = app.querySelector('[data-sa="pose"].sh-want:not([disabled])'); if (want) want.click(); }
          SH._aim(); SH._shootAt(0.93); return "shot";
        }
        c('[data-sa="end"]'); return "endshoot";
      }
      if (ui.screen === "select") { c('[data-act="confirmsel"]'); return "select"; }
      if (ui.screen === "result") { c('[data-act="resultok"]'); return "result"; }
      if (ui.screen === "final") { app.querySelector('[data-act="cover"]').click(); return "cover"; }
      if (ui.screen !== "hub") return "screen:" + ui.screen;
      if (st.day >= D.DAYS && st.phase === "day") { c('[data-act="final"]'); return "final"; }
      if (st.phase === "day") {
        if (c('[data-act="meet"]')) return "meet";
        if (st.money > 100 && st.gear.lenses.indexOf("port85") < 0) return "shop";
        var dateDue = app.querySelector('[data-act="date"] .sh-new');
        if (dateDue) { dateDue.closest("button").click(); return "date-due"; }
        var ch = Array.prototype.filter.call(app.querySelectorAll('[data-act="chapter"]'), function (b) { return /尚未拍攝/.test(b.textContent); });
        if (ch.length) { ch[0].click(); return "chapter"; }
        if (st.day % 3 === 0 && c('[data-act="date"]')) return "date";
        if (c('[data-act="job"]')) return "job";
        c('[data-act="post"]'); return "post";
      }
      if (st.travelNight) { c('[data-act="travelnight"]'); return "travel"; }
      if (Math.random() < 0.5 && c('[data-act="visit"]')) return "visit";
      var spots = app.querySelectorAll('[data-act="spot"]'); spots[Math.floor(Math.random() * spots.length)].click(); return "spot";
    });
    if (r === "shop") {
      await page.dispatchEvent('[data-act="panel"][data-p="shop"]', "click");
      if (!seen.shopShot) { seen.shopShot = true; await page.screenshot({ path: path.join(SHOT_DIR, "03_shop.png") }); }
      await page.dispatchEvent('[data-act="buy"][data-id="port85"]', "click");
      await page.dispatchEvent('[data-act="panel"][data-p="shop"]', "click");
      continue;
    }
    if (r === "shot" && !seen.shootShot) {
      seen.shootShot = true;
      // 拍攝場景要用去背頭像（images/shutter/），不能用白底的原圖
      var src = await page.$eval(".sh-vp .sh-model-img", function (el) { return el.getAttribute("src"); });
      assert(/images\/shutter\/g_\d{3}\.webp$/.test(src), "拍攝場景要用去背頭像：" + src);
      await page.waitForTimeout(450); // 等閃光燈動畫結束再截圖
      await page.screenshot({ path: path.join(SHOT_DIR, "02_shoot.png") });
    }
    if (r === "select") { seen.select++; if (seen.select === 1) await page.screenshot({ path: path.join(SHOT_DIR, "04_select.png") }); }
    if (r === "story") seen.story++;
    if (r === "chapter") seen.chapters++;
    if (r === "ending") { seen.ending = true; break; }
    if (/^screen:|noshoot/.test(r)) throw new Error("意外的畫面：" + r);
  }
  assert(seen.ending, "要走到結局");
  var fin = await page.evaluate(function () {
    var st = window.PriTestShutter._state(), ui = window.PriTestShutter._ui();
    return { done: ui.end.done, avg: Math.round(ui.end.avg), tier: ui.end.tier, rel: ui.end.rel, port: st.port.length, fame: st.fame, money: st.money,
      dating: Object.keys(st.h).filter(function (k) { return st.h[k].dating; }), clients: Object.keys(st.cl).length };
  });
  console.log("結局：", JSON.stringify(fin), "夜晚頁數", seen.story, "挑片", seen.select);
  assert(fin.done >= 6, "自動流程至少要完成 6 章（實際 " + fin.done + "）");
  assert(fin.port > 10, "作品集要有照片");
  assert(seen.story > 0, "要看到交往後的夜晚劇情");
  assert((await page.$$(".sh-ending .sh-photo")).length >= 1, "結局要顯示封面照片");
  await page.screenshot({ path: path.join(SHOT_DIR, "05_ending.png"), fullPage: true });
  // 夜晚回憶可重看
  await page.dispatchEvent('[data-act="title"]', "click");
  await page.dispatchEvent('[data-act="album"]', "click");
  var rep = await page.$$('[data-act="replay"]');
  assert(rep.length > 0, "夜晚回憶要有可以重看的劇情");
  await rep[0].dispatchEvent("click");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestShutter._ui().screen; }), "story");
  // 手機寬度：新遊戲到拍攝畫面不可橫向捲動
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(function () { localStorage.removeItem("pritest-shutter-save-v1"); });
  await page.reload();
  await page.dispatchEvent('[data-act="new"]', "click");
  await page.dispatchEvent('[data-act="castStart"]', "click");
  for (var k = 0; k < 30; k++) { if (!(await page.$('[data-act="next"]'))) break; await page.dispatchEvent('[data-act="next"]', "click"); }
  await page.dispatchEvent('[data-act="job"]', "click");
  for (k = 0; k < 10; k++) { if (!(await page.$('[data-act="next"]'))) break; await page.dispatchEvent('[data-act="next"]', "click"); }
  assert(await page.$(".sh-vp"), "手機寬度也要能進拍攝畫面");
  var ov = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  assert(ov <= 1, "手機寬度不可以橫向捲動（多出 " + ov + "px）");
  await page.screenshot({ path: path.join(SHOT_DIR, "06_mobile_shoot.png"), fullPage: true });
  assert.deepStrictEqual(errors, [], "不可以有 console error：" + errors.join("\n"));
  console.log("OK shutter flow_check");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
