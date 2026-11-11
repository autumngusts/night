// ============================================================================
// 無人島的漂流者（isle）Playwright 流程檢查：
//   18 禁確認 → 序章 → 30 天（用真的 <select> 分配工作與配給、開工建造、探索發現、夜晚地點、個人故事、告白、交往、夜晚劇情）
//   → 結局（獲救／出海／回家／留下）→ 夜晚回憶 → 手機寬度 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8953 --directory dist
// 執行：node tools/isle_check/flow_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = (process.env.ISLE_ROOT || "http://localhost:8953/") + "isle/index.html";
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

  var stories = 0, shot = false, minHp = 100, finds = 0;
  for (var guard = 0; guard < 4000; guard++) {
    var r = await page.evaluate(function () {
      var I = window.PriTestIsle, st = I._state(), ui = I._ui(), app = document.getElementById("il-app"), D = window.PriTestIsleData;
      function c(sel) { var el = app.querySelector(sel); if (el && !el.disabled) { el.click(); return true; } return false; }
      function setSel(sel, v) { var el = app.querySelector(sel); if (el && el.value !== v) { el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); } }
      if (ui.screen === "ending") return "ending";
      if (ui.screen === "story") { c('[data-act="snext"]'); return "story"; }
      if (ui.screen === "vn") { var t = ui.vn.title || ""; if (c('[data-act="next"]')) return /^.+發現/.test(t) ? "find" : "vn"; var k = /^意外/.test(t) ? 1 : 0; if (!c('[data-act="ch"][data-k="' + k + '"]')) c('[data-act="ch"][data-k="0"]'); return "ch"; }
      if (ui.screen === "partner") { if (!c('[data-act="partner"][data-id]:not([data-id=""])')) c('[data-act="partner"]'); return "partner"; }
      if (ui.screen === "day30") { if (!c('[data-act="end"][data-id="paradise"]')) c('[data-act="end"]'); return "day30"; }
      if (ui.screen === "report") {
        if (c('[data-act="knock"]')) return "knock";
        if (Math.random() < 0.4 && c('[data-act="visit"]')) return "visit";
        // 夜晚：去好感最高的人常去的地點
        var top = D.GIRLS.slice().sort(function (a, b) { return st.g[b.id].aff - st.g[a.id].aff; })[0];
        var sp = Array.prototype.filter.call(app.querySelectorAll('[data-act="spot"]'), function (b) { return !b.disabled; });
        var fav = sp.filter(function (b) { return top.spots.indexOf(b.getAttribute("data-id")) >= 0; });
        (fav.length ? fav[0] : sp[Math.floor(Math.random() * sp.length)]).click(); return "spot";
      }
      if (ui.screen !== "plan") return "screen:" + ui.screen;
      if (app.querySelector('[data-act="sail"]')) { var ds0 = Object.keys(st.g).filter(function (k) { return st.g[k].dating; }); if (ds0.length || st.day >= 28) { c('[data-act="sail"]'); return "sail"; } c('[data-act="notyet"]'); return "notyet"; }
      // 開工：照順序挑第一個可以蓋的
      if (!st.proj) { var order = ["fire", "shelter", "rain", "net", "hut", "garden", "signal", "raft"]; for (var i = 0; i < order.length; i++) if (c('[data-act="startbuild"][data-id="' + order[i] + '"]')) return "build:" + order[i]; }
      // 分配工作：先保證食物和水，再看建築缺什麼材料，剩下的人探索或建造
      var R = st.res, n = 9, B = {}; D.BUILDS.forEach(function (b) { B[b.id] = b; });
      var auto = (st.built.net ? 3 : 0) + (st.built.garden ? 3 : 0), autoW = st.built.rain ? 3 : 0;
      var foodNeed = Math.max(0, n * 1.2 - auto - Math.max(0, R.food - n * 2) / 2), waterNeed = Math.max(0, n * 1.1 - autoW - Math.max(0, R.water - n * 2) / 2);
      var nextB = ["fire", "shelter", "rain", "net", "hut", "garden", "signal", "raft"].filter(function (id) { return !st.built[id] && !(st.proj && st.proj.id === id); })[0];
      var want = nextB ? B[nextB].cost : {};
      var avail = D.GIRLS.filter(function (g) { return st.g[g.id].hp >= 35; });
      D.GIRLS.forEach(function (g) { if (st.g[g.id].hp < 35) setSel('.il-sel[data-id="' + g.id + '"]', st.g[g.id].hp < 20 ? "rest" : "heal"); });
      function take(task, amount, per) {
        avail.sort(function (a, b) { return (b.skills.indexOf(task) >= 0) - (a.skills.indexOf(task) >= 0); });
        while (amount > 0 && avail.length) { var g = avail.shift(); setSel('.il-sel[data-id="' + g.id + '"]', task); amount -= per * (g.skills.indexOf(task) >= 0 ? 1.8 : 1); }
      }
      take("food", foodNeed, 3.6 * 0.8); take("water", waterNeed, 4.2 * 0.8);
      if ((want.fiber || 0) > R.fiber || (want.stone || 0) > R.stone) take("mat", 4, 3);
      if ((want.wood || 0) > R.wood) take("wood", want.wood - R.wood, 3);
      if (st.target) take("explore", 30, 14);
      take(st.proj ? "build" : "wood", 99, 10);
      setSel('.il-sel[data-id="me"]', st.proj ? "build" : "wood");
      setSel(".il-ration", R.food > n * 4 ? "high" : R.food < n * 1.5 ? "low" : "normal");
      c('[data-act="endday"]'); return "endday";
    });
    if (r === "endday") {
      var hp = await page.evaluate(function () { var st = window.PriTestIsle._state(); return Math.min.apply(null, Object.keys(st.g).map(function (k) { return st.g[k].hp; })); });
      minHp = Math.min(minHp, hp);
      if (!shot) { shot = true; await page.screenshot({ path: path.join(SHOT_DIR, "01_plan.png"), fullPage: true }); }
    }
    if (r === "find") finds++;
    if (r === "story") stories++;
    if (r === "ending") break;
    if (/^screen:/.test(r)) throw new Error("意外的畫面：" + r + " / " + errors.join(" | "));
  }
  var fin = await page.evaluate(function () { var st = window.PriTestIsle._state(), ui = window.PriTestIsle._ui(); return { screen: ui.screen, kind: ui.end && ui.end.kind, day: st.day, built: Object.keys(st.built), zones: st.zones, dating: Object.keys(st.g).filter(function (k) { return st.g[k].dating; }) }; });
  console.log("結局：", JSON.stringify(fin), "夜晚頁數", stories, "最低體力", minHp, "發現", finds);
  assert.strictEqual(fin.screen, "ending", "要走到結局");
  assert(fin.built.length >= 5, "30 天內應該能蓋好 5 座以上建築（實際 " + fin.built.join("、") + "）");
  assert(stories > 0, "要看到夜晚劇情");
  await page.screenshot({ path: path.join(SHOT_DIR, "02_ending.png"), fullPage: true });
  await page.dispatchEvent('[data-act="title"]', "click");
  await page.dispatchEvent('[data-act="album"]', "click");
  assert((await page.$$('[data-act="replay"]')).length > 0, "夜晚回憶要能重看");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.dispatchEvent('[data-act="title"]', "click");
  await page.dispatchEvent('[data-act="new"]', "click");
  for (var k = 0; k < 20; k++) { if (!(await page.$('[data-act="next"]'))) break; await page.dispatchEvent('[data-act="next"]', "click"); }
  var ov = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  assert(ov <= 1, "手機寬度不可以橫向捲動（多出 " + ov + "px）");
  await page.screenshot({ path: path.join(SHOT_DIR, "03_mobile.png"), fullPage: true });
  assert.deepStrictEqual(errors, [], "不可以有 console error：" + errors.join("\n"));
  console.log("OK isle flow_check");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
