// ============================================================================
// 魔王城的防衛戰（maou）Playwright 流程檢查：
//   18 禁確認 → 標題 → 序章 → 12 章（部下加入、配置（含一次真的點 Canvas）、升級、談話、羈絆故事、奧義、
//   防衛戰（快轉模擬＋一段即時播放）、戰後夜晚、契約）→ 立魔后 → 結局 → 夜晚回憶 → 手機寬度 → 沒有 console error
//   另外記錄每章的重打次數，當作難度的參考。
// 前置：py -3 generate.py ； py -3 -m http.server 8953 --directory dist
// 執行：node tools/maou_check/flow_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = (process.env.MAOU_ROOT || "http://localhost:8953/") + "maou/index.html";
var SHOT_DIR = path.join(__dirname, "shots");

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload();
  assert(await page.$('[data-act="age-yes"]'), "要先顯示 18 禁確認");
  await page.dispatchEvent('[data-act="age-yes"]', "click");
  await page.dispatchEvent('[data-act="new"]', "click");

  var hpLog = [], retries = {}, stories = 0, skills = 0, liveShot = false, clickedCanvas = false;
  for (var guard = 0; guard < 6000; guard++) {
    var r = await page.evaluate(function () {
      var M = window.PriTestMaou, st = M._state(), ui = M._ui(), app = document.getElementById("mu-app"), D = window.PriTestMaouData;
      function c(sel) { var el = app.querySelector(sel); if (el && !el.disabled) { el.click(); return true; } return false; }
      if (ui.screen === "ending") return "ending";
      if (ui.screen === "story") { c('[data-act="snext"]'); return "story"; }
      if (ui.screen === "vn") { if (c('[data-act="next"]')) return "vn"; c('[data-act="ch"][data-k="0"]'); return "ch"; }
      if (ui.screen === "result") { var win = ui.res.win, hp = ui.res.hp; c('[data-act="resultok"]'); return win ? "win:" + st.ch + ":" + hp : "lose:" + st.ch; }
      if (ui.screen === "night") { if (c('[data-act="nightwith"]')) return "night"; c('[data-act="rest"]'); return "rest"; }
      if (ui.screen === "queen") { if (!c('[data-act="queen"][data-id]:not([data-id=""])')) c('[data-act="queen"]'); return "queen"; }
      if (ui.screen === "battle") { M._simulate(400); return "sim"; }
      if (ui.screen !== "hub") return "screen:" + ui.screen;
      // 談話：故事或契約優先，否則找羈絆最低的
      if (st.ap > 0) {
        var due = app.querySelector('.mu-card .mu-new');
        if (due) { due.closest(".mu-card").querySelector('[data-act="talk"]').click(); return "talk"; }
        var ids = Object.keys(st.girls).filter(function (k) { return st.girls[k].joined; }).sort(function (a, b) { return st.girls[a].bond - st.girls[b].bond; });
        c('[data-act="talk"][data-id="' + ids[0] + '"]'); return "talk";
      }
      // 配置：每位部下放在「射程內路徑最長」的空台座
      var cap = D.deployCap(st.ch), joined = D.GIRLS.filter(function (g) { return st.girls[g.id].joined; });
      joined.sort(function (a, b) { return st.girls[b.id].lv - st.girls[a.id].lv; });
      var placed = Object.keys(st.place).length;
      for (var k = 0; k < joined.length && placed < cap; k++) {
        var g = joined[k]; if (st.place[g.id]) continue;
        var rg = D.TYPES[g.type].range, best = null, bv = -1;
        var used = {}; Object.keys(st.place).forEach(function (id) { used[st.place[id]] = 1; });
        for (var rr = 0; rr < D.ROWS; rr++) for (var cc = 0; cc < D.COLS; cc++) {
          if (!M.buildable(cc, rr) || used[cc + "," + rr]) continue;
          var v = 0; D.PATH.forEach(function (p, i) { if (!i) return; var a = D.PATH[i - 1]; for (var t = 0; t <= 20; t++) { var x = a[0] + (p[0] - a[0]) * t / 20, y = a[1] + (p[1] - a[1]) * t / 20; if (Math.hypot(x - cc, y - rr) <= rg) v++; } });
          if (v > bv) { bv = v; best = [cc, rr]; }
        }
        if (best) { M._place(g.id, best[0], best[1]); placed++; return "place"; }
      }
      // 升級：金幣夠就升等級最低的已配置部下
      var dep = Object.keys(st.place).sort(function (a, b) { return st.girls[a].lv - st.girls[b].lv; });
      for (var j = 0; j < dep.length; j++) { var x = st.girls[dep[j]]; if (x.lv < 5 && st.gold >= D.UPGRADE[x.lv]) return "upsel:" + dep[j]; }
      c('[data-act="battle"]'); return "battle";
    });
    if (/^upsel:/.test(r)) {
      var uid = r.slice(6);
      await page.evaluate(function (id) { var M = window.PriTestMaou; M._ui().sel = id; M._ui().pick = null; M._render(); }, uid);
      await page.dispatchEvent('[data-act="upgrade"][data-id="' + uid + '"]', "click");
      continue;
    }
    if (r === "battle") {
      // 第 3 章：用真的 Canvas 點擊配置一次，並即時播放 2 秒截圖、試用奧義
      if (!liveShot && (await page.evaluate(function () { return window.PriTestMaou._state().ch; })) >= 3) {
        liveShot = true;
        await page.waitForTimeout(1800);
        await page.screenshot({ path: path.join(SHOT_DIR, "02_battle.png") });
        var sk = await page.$('[data-act="skill"]:not([disabled])');
        if (sk) { await sk.dispatchEvent("click"); skills++; }
      }
      continue;
    }
    if (r === "place" && !clickedCanvas) {
      clickedCanvas = true;
      // 真的點一次 Canvas：選一位部下 → 點台座 (6,3)
      var free = await page.evaluate(function () { var st = window.PriTestMaou._state(); return Object.keys(st.girls).filter(function (k) { return st.girls[k].joined && !st.place[k]; })[0] || null; });
      if (free) {
        await page.dispatchEvent('[data-act="pick"][data-id="' + free + '"]', "click");
        var box = await (await page.$(".mu-canvas")).boundingBox();
        await page.mouse.click(box.x + box.width * (6.5 / 14), box.y + box.height * (3.5 / 9));
        var ok = await page.evaluate(function (id) { return window.PriTestMaou._state().place[id]; }, free);
        assert.strictEqual(ok, "6,3", "點 Canvas 要能配置部下");
        await page.screenshot({ path: path.join(SHOT_DIR, "01_hub.png") });
      }
    }
    if (/^lose:/.test(r)) { var ch = r.slice(5); retries[ch] = (retries[ch] || 0) + 1; assert(retries[ch] <= 6, "第 " + ch + " 章重打超過 6 次，難度可能太高（王座剩餘：" + hpLog.join(" ") + "）"); }
    if (r === "story") stories++;
    if (/^win:/.test(r)) hpLog.push(r.slice(4));
    if (r === "ending") break;
    if (/^screen:/.test(r)) throw new Error("意外的畫面：" + r + " / " + errors.join(" | "));
  }
  var fin = await page.evaluate(function () { var st = window.PriTestMaou._state(), ui = window.PriTestMaou._ui(); return { screen: ui.screen, queen: ui.end && ui.end.queen, pacts: Object.keys(st.girls).filter(function (k) { return st.girls[k].pact; }), gold: st.gold }; });
  console.log("結局：", JSON.stringify(fin), "重打：", JSON.stringify(retries), "王座剩餘：", hpLog.join(" "), "夜晚頁數", stories, "奧義", skills);
  assert.strictEqual(fin.screen, "ending", "要走到結局");
  assert(stories > 0, "要看到夜晚劇情");
  await page.screenshot({ path: path.join(SHOT_DIR, "03_ending.png"), fullPage: true });
  await page.dispatchEvent('[data-act="title"]', "click");
  await page.dispatchEvent('[data-act="album"]', "click");
  assert((await page.$$('[data-act="replay"]')).length > 0, "夜晚回憶要能重看");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.dispatchEvent('[data-act="title"]', "click");
  await page.dispatchEvent('[data-act="new"]', "click");
  for (var k = 0; k < 40; k++) { if (!(await page.$('[data-act="next"]'))) break; await page.dispatchEvent('[data-act="next"]', "click"); }
  var ov = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  assert(ov <= 1, "手機寬度不可以橫向捲動（多出 " + ov + "px）");
  await page.screenshot({ path: path.join(SHOT_DIR, "04_mobile.png"), fullPage: true });
  assert.deepStrictEqual(errors, [], "不可以有 console error：" + errors.join("\n"));
  console.log("OK maou flow_check");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
