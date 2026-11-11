// ============================================================================
// 秘密的同居生活（nest）Playwright 流程檢查：
//   18 禁確認 → 標題 → 選角（頭像池只有 g_、排除名單）→ 90 天完整流程
//   （打招呼、入住申請＋選房、房間配置（搬家／交換、預覽）、修繕、聊天、個人故事、告白、交往、夜晚劇情、敲門、意外事件、收房租）
//   → 還款日 → 選擇最後一晚 → 結局 → 夜晚回憶 → 配置計算的健全性 → 續玩 → 手機寬度 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8953 --directory dist
// 執行：node tools/nest_check/flow_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = (process.env.NEST_ROOT || "http://localhost:8953/") + "nest/index.html";
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
  await page.dispatchEvent('[data-act="castPick"][data-id="aoi"]', "click");
  var imgs = await page.$$eval(".ns-gimg", function (els) { return els.map(function (e) { return e.getAttribute("data-img"); }); });
  assert(imgs.length >= 100, "頭像庫要列出 g_ 系列（實際 " + imgs.length + "）");
  assert(imgs.every(function (x) { return /^g_\d{3}\.webp$/.test(x); }), "頭像庫只能有 g_ 系列");
  ["g_006", "g_010", "g_017", "g_018", "g_019", "g_026", "g_029", "g_032"].forEach(function (x) { assert(imgs.indexOf(x + ".webp") < 0, "排除名單 " + x + " 不可出現"); });
  await page.dispatchEvent('[data-act="castStart"]', "click");

  // 配置計算的健全性：淺眠的人放在吵的人隔壁，舒適度要比較低
  var cf = await page.evaluate(function () {
    var G = window.PriTestNest, st = G._state(), rooms = [];
    for (var i = 0; i < 20; i++) rooms.push(null);
    rooms[9] = "kana"; rooms[10] = "shiori"; var bad = G.comfort("shiori", 10, rooms).c;
    rooms[10] = null; rooms[19] = "shiori"; var good = G.comfort("shiori", 19, rooms).c;
    return { bad: bad, good: good, n: st.rooms.filter(function (x) { return x; }).length };
  });
  assert(cf.good > cf.bad + 2, "淺眠的詩織遠離貝斯手要比較舒服（好 " + cf.good + "／壞 " + cf.bad + "）");
  assert.strictEqual(cf.n, 7, "一開始要有 7 位房客");

  var seen = { story: 0, happen: 0, knock: 0, moves: 0, ending: false, shot: false };
  for (var guard = 0; guard < 8000; guard++) {
    var r = await page.evaluate(function () {
      var G = window.PriTestNest, st = G._state(), ui = G._ui(), app = document.getElementById("ns-app"), D = window.PriTestNestData;
      function c(sel) { var el = app.querySelector(sel); if (el && !el.disabled) { el.click(); return true; } return false; }
      if (ui.screen === "ending") return "ending";
      if (ui.screen === "story") { c('[data-act="snext"]'); return "story"; }
      if (ui.screen === "vn") {
        var t = ui.vn.title || "";
        if (c('[data-act="next"]')) return "vn:" + t;
        // 意外事件：好感夠就選大膽的
        var k = /^意外/.test(t) ? 1 : 0;
        if (!c('[data-act="ch"][data-k="' + k + '"]')) c('[data-act="ch"][data-k="0"]');
        return (/^意外/.test(t) ? "happen" : "ch") + ":" + t;
      }
      if (ui.screen === "final") { if (!c('[data-act="partner"][data-id]:not([data-id=""])')) c('[data-act="partner"]'); return "partner"; }
      if (ui.screen !== "hub") return "screen:" + ui.screen;
      if (st.day >= D.DAYS && st.phase === "day") { c('[data-act="final"]'); return "final"; }
      if (c('[data-act="meet"]')) return "meet";
      // 入住申請：女主角優先，選預估滿意度最高的空房
      if (st.apps.length) {
        var app0 = st.apps.filter(function (id) { return !!window.PriTestNestData.HEROINES.filter(function (h) { return h.id === id; }).length; })[0] || st.apps[0];
        var empty = []; st.rooms.forEach(function (x, i) { if (!x) empty.push(i); });
        if (empty.length) {
          var best = empty.sort(function (a, b) { return G.preview(app0, b) - G.preview(app0, a); })[0];
          c('[data-act="accept"][data-id="' + app0 + '"]');
          app.querySelector('[data-act="room"][data-r="' + best + '"]').click();
          return "accept";
        }
        // 沒空房：女主角的申請 → 請好感最低的一般房客解約
        if (window.PriTestNestData.HEROINES.some(function (h) { return h.id === app0; })) {
          var gens = st.rooms.filter(function (x) { return x && st.gen[x] && !st.gen[x].dating; }).sort(function (a, b) { return st.gen[a].aff - st.gen[b].aff; });
          if (gens.length) { app.querySelector('[data-act="room"][data-r="' + st.rooms.indexOf(gens[0]) + '"]').click(); if (c('[data-act="evict"]')) return "evict"; }
        }
        c('[data-act="decline"]'); return "decline";
      }
      // 房間配置：最不滿意的人，如果搬到別間能 +12 以上就搬
      var ts = st.rooms.map(function (x, i) { return x ? { id: x, r: i } : null; }).filter(Boolean);
      ts.sort(function (a, b) { return G.target(a.id) - G.target(b.id); });
      var w = ts[0];
      if (w && st.phase === "day" && !ui.moved) {
        var cur = G.target(w.id), bestR = -1, bestV = cur + 11;
        for (var i = 0; i < 20; i++) { if (i === w.r) continue; var v = G.preview(w.id, i); var o = st.rooms[i]; if (o) { var rr = st.rooms.slice(); rr[w.r] = o; rr[i] = w.id; if (G.target(o, w.r, rr) < G.target(o) - 6) continue; } if (v > bestV) { bestV = v; bestR = i; } }
        if (bestR >= 0) { app.querySelector('[data-act="room"][data-r="' + w.r + '"]').click(); app.querySelector('[data-act="room"][data-r="' + bestR + '"]').click(); ui.moved = true; return "move"; }
      }
      if (st.phase === "day") {
        ui.moved = false;
        var due = app.querySelector('[data-act="talk"] .ns-new');
        if (due) { due.closest("button").click(); return "talk-due"; }
        if (c('[data-act="repair"]')) return "repair";
        if (st.money < 600 * st.day / 90 - 20 && st.day % 2 === 0) { c('[data-act="work"]'); return "work"; }
        if (st.day % 7 === 0) { c('[data-act="clean"]'); return "clean"; }
        var talks = app.querySelectorAll('[data-act="talk"]');
        if (!talks.length) { c('[data-act="work"]'); return "work"; }
        talks[Math.floor(Math.random() * talks.length)].click(); return "talk";
      }
      if (c('[data-act="knock"]')) return "knock";
      if (Math.random() < 0.45 && c('[data-act="visit"]')) return "visit";
      var sp = app.querySelectorAll('[data-act="space"]');
      if (!sp.length) return "screen:nospace " + st.phase + " " + ui.screen + " " + app.textContent.slice(0, 200);
      sp[Math.floor(Math.random() * sp.length)].click(); return "space";
    });
    if (r === "move") seen.moves++;
    if (r === "knock") seen.knock++;
    if (/^happen/.test(r)) seen.happen++;
    if (r === "story") seen.story++;
    if (!seen.shot && r === "talk" ) {
      var day = await page.evaluate(function () { return window.PriTestNest._state().day; });
      if (day >= 30) { seen.shot = true; }
    }
    if (r === "ending") { seen.ending = true; break; }
    if (/^screen:/.test(r)) throw new Error("意外的畫面：" + r + " / " + errors.join(" | "));
  }
  assert(seen.ending, "要走到結局");
  var fin = await page.evaluate(function () {
    var st = window.PriTestNest._state(), ui = window.PriTestNest._ui();
    var dup = st.rooms.filter(function (x, i) { return x && st.rooms.indexOf(x) !== i; });
    return { tier: ui.end.tier, rel: ui.end.rel, money: Math.round(st.money), n: ui.end.n, avg: Math.round(ui.end.avg),
      met: Object.keys(st.h).filter(function (k) { return st.h[k].met; }).length, dating: Object.keys(st.h).filter(function (k) { return st.h[k].dating; }), dup: dup.length };
  });
  console.log("結局：", JSON.stringify(fin), "夜晚頁數", seen.story, "意外", seen.happen, "敲門", seen.knock, "搬家", seen.moves);
  assert.strictEqual(fin.dup, 0, "同一個人不可以住兩間房");
  assert(fin.met >= 18, "90 天內至少要遇到 18 位女主角（實際 " + fin.met + "）");
  assert(fin.dating.length >= 1 && seen.story > 0, "要能交往並看到夜晚劇情");
  assert(seen.moves > 0 && seen.happen > 0, "要有搬家與意外事件");
  // 2026-11-12 加量：每位房客 4 段專屬夜晚；有人共度 3 晚以上時，第 3 段以後要真的被播到
  var albumKeys = await page.evaluate(function () { return Object.keys(JSON.parse(localStorage.getItem("pritest-nest-album") || "{}")); });
  var maxNights = await page.evaluate(function () { var st = window.PriTestNest._state(); return Math.max.apply(null, Object.keys(st.h).map(function (k) { return st.h[k].nights; })); });
  if (maxNights >= 3) assert(albumKeys.some(function (k) { return /^own[23]_/.test(k); }), "第 3〜4 段專屬夜晚要能播到（相簿：" + albumKeys.join(",") + "）");
  await page.screenshot({ path: path.join(SHOT_DIR, "03_ending.png"), fullPage: true });
  await page.dispatchEvent('[data-act="title"]', "click");
  await page.dispatchEvent('[data-act="album"]', "click");
  var rep = await page.$$('[data-act="replay"]');
  assert(rep.length > 0, "夜晚回憶要有可以重看的劇情");
  await rep[0].dispatchEvent("click");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestNest._ui().screen; }), "story");

  // 新遊戲：存檔與續玩、公寓畫面截圖
  await page.evaluate(function () { localStorage.removeItem("pritest-nest-save-v1"); });
  await page.reload();
  await page.dispatchEvent('[data-act="new"]', "click");
  await page.dispatchEvent('[data-act="castStart"]', "click");
  for (var k = 0; k < 40; k++) { if (!(await page.$('[data-act="next"]'))) break; await page.dispatchEvent('[data-act="next"]', "click"); }
  await page.dispatchEvent('[data-act="room"][data-r="10"]', "click");
  await page.screenshot({ path: path.join(SHOT_DIR, "01_building.png"), fullPage: true });
  assert(await page.$(".ns-detail"), "點房客要顯示詳細與原因");
  await page.dispatchEvent('[data-act="room"][data-r="19"]', "click");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestNest._state().rooms[19]; }), "shiori", "搬家要生效");
  await page.reload();
  await page.dispatchEvent('[data-act="continue"]', "click");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestNest._state().rooms[19]; }), "shiori", "續玩要讀回配置");
  // 手機寬度
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.dispatchEvent('[data-act="continue"]', "click");
  var ov = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  assert(ov <= 1, "手機寬度不可以橫向捲動（多出 " + ov + "px）");
  await page.screenshot({ path: path.join(SHOT_DIR, "02_mobile.png"), fullPage: true });
  assert.deepStrictEqual(errors, [], "不可以有 console error：" + errors.join("\n"));
  console.log("OK nest flow_check");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
