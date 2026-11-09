// ============================================================================
// 深夜居酒屋（izakaya）的瀏覽器檢查（Playwright）。先 python generate.py，再起本機伺服器：
//   python -m http.server 8952 --directory dist
//   node tools/izakaya_check/ui_check.js
// （本機沒有裝 playwright 時：NODE_PATH=<有 playwright 的 node_modules>，IZ_CHROME=<chrome.exe 路徑>）
// 單機：首頁 → 新遊戲 → 市場買食材 → 準備黑板 → 營業（話題、上菜、飲料）→ 週五尖峰（開做、起鍋、上菜）
//       → 打烊結算 → 公休日約會（墊好感與星級）→ 筆記本與關係圖 → 手機寬度無橫向捲動 → 日文沒有漏翻。
// 連線：兩個瀏覽器＋假 Firebase：建房 → 加入 → 選職位 → 開始 → 外場不能買、採買能買 → 雙方準備 → 劇情投票。
// 觸發一律 dispatchEvent（畫面每幀依狀態重建，page.click 會逾時）。
// ============================================================================
"use strict";
var assert = require("assert"), path = require("path");
var chromium = require("playwright").chromium;
var BASE = process.env.IZ_BASE || "http://localhost:8952/izakaya/index.html";
var SHOTS = process.env.IZ_SHOTS || path.join(__dirname, "shots");
require("fs").mkdirSync(SHOTS, { recursive: true });

// ---- 假 Firebase：Node 端保存整棵樹，任何一頁寫入就推給所有頁 ----
function fakeFirebase() {
  var store = {}, pages = [];
  async function push(p, json) {
    for (var i = 0; i < pages.length; i++) { try { await pages[i].evaluate(function (a) { window.__fgPush(a[0], a[1]); }, [p, json]); } catch (e) { /* 頁面關了 */ } }
  }
  return {
    attach: async function (ctx) {
      await ctx.exposeBinding("__fgSet", async function (src, p, json) {
        Object.keys(store).forEach(function (k) { if (k === p || k.indexOf(p + "/") === 0) delete store[k]; });
        if (json !== "null") store[p] = json;
        await push(p, json);
        return true;
      });
      await ctx.addInitScript(function () {
        // 真的 Firebase 第一次回呼就帶著現有資料；這裡等 Node 把整棵樹補完（__fgDone）才發第一次回呼
        var tree = {}, subs = [], ready = false, pending = [];
        window.__fgDone = function () { ready = true; pending.forEach(function (f) { f(); }); pending = []; };
        function parts(p) { return p.split("/").filter(Boolean); }
        function getAt(p) { var o = tree; var ps = parts(p); for (var i = 0; i < ps.length; i++) { if (!o || typeof o !== "object") return null; o = o[ps[i]]; } return o === undefined ? null : JSON.parse(JSON.stringify(o)); }
        function setAt(p, v) {
          var ps = parts(p), o = tree;
          for (var i = 0; i < ps.length - 1; i++) { if (!o[ps[i]] || typeof o[ps[i]] !== "object") o[ps[i]] = {}; o = o[ps[i]]; }
          if (v === null) delete o[ps[ps.length - 1]]; else o[ps[ps.length - 1]] = v;
        }
        window.__fgPush = function (p, json) {
          setAt(p, JSON.parse(json));
          subs.forEach(function (s) { if (s.p === p || s.p.indexOf(p + "/") === 0 || p.indexOf(s.p + "/") === 0) s.fn(getAt(s.p)); });
        };
        function full(room, sub) { return "games/" + room + "/rtState/" + sub; }
        function set(room, mode, sub, v) { return window.__fgSet(full(room, sub), JSON.stringify(v === undefined ? null : v)); }
        window.PriTestIzakayaFakeGS = {
          generateCloudGameId: function () { var h = ""; for (var i = 0; i < 32; i++) h += Math.floor(Math.random() * 16).toString(16); return "g" + h; },
          serverNow: function () { return Date.now(); },
          rtSet: set,
          rtSubscribe: function (room, mode, sub, fn) {
            var s = { p: full(room, sub), fn: fn };
            subs.push(s);
            var fire = function () { fn(getAt(s.p)); };
            if (ready) setTimeout(fire, 0); else pending.push(fire);
            return function () { subs = subs.filter(function (x) { return x !== s; }); };
          },
          rtTransaction: function (room, mode, sub, upd) { var cur = getAt(full(room, sub)), nv = upd(cur); return nv === undefined ? Promise.resolve() : set(room, mode, sub, nv); },
          rtSetWithOnDisconnect: function (room, mode, sub, v) { set(room, mode, sub, v); return function () { set(room, mode, sub, null); }; }
        };
      });
    },
    // 新頁面載入後把目前整棵樹補給它
    sync: async function (page) {
      if (pages.indexOf(page) < 0) pages.push(page);
      var keys = Object.keys(store);
      for (var i = 0; i < keys.length; i++) await page.evaluate(function (a) { window.__fgPush(a[0], a[1]); }, [keys[i], store[keys[i]]]);
      await page.evaluate(function () { window.__fgDone(); });
    }
  };
}


async function act(page, sel) { await page.waitForSelector(sel, { state: "attached", timeout: 15000 }); await page.dispatchEvent(sel, "click"); await page.waitForTimeout(60); }
async function state(page) { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestIzakaya.state())); }); }
async function noMissingKeys(page, where) {
  var txt = await page.textContent("#iz-app");
  assert.ok(!/iz_\w+/.test(txt), "漏翻（" + where + "）：" + (txt.match(/iz_\w+/g) || []).join(","));
}
// 劇情視窗開著就一路點到底（選第 0 個選項）
async function clearStory(page) {
  for (var i = 0; i < 60; i++) {
    if (!(await page.$("#iz-story"))) return;
    if (await page.$("[data-next]")) await act(page, "[data-next]");
    else if (await page.$('[data-choice="0"]')) await act(page, '[data-choice="0"]');
    else return;   // 私密場景（別人約會中）
  }
}
// 單機：把完整存檔改幾個欄位再重新載入（不手寫不完整的 state）
async function patchSave(page, fn) {
  await page.evaluate(function (src) {
    var s = window.PriTestIzakaya.state();
    (new Function("s", "D", src))(s, window.PriTestIzakayaData);
    localStorage.setItem("pritest-izakaya-save", JSON.stringify(s));
  }, fn);
  await page.reload();
  await act(page, '[data-act="continue"]');
}

(async function () {
  var browser = await chromium.launch(process.env.IZ_CHROME ? { executablePath: process.env.IZ_CHROME, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  var errors = [];
  function watch(page, tag) {
    page.on("pageerror", function (e) { errors.push(tag + ": " + e.message); });
    page.on("console", function (m) { if (m.type() === "error") errors.push(tag + ": " + m.text()); });
  }

  // ======================= 單機 =======================
  var page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  watch(page, "solo");
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); localStorage.setItem("pritest-lang", "zh"); });
  await page.reload();
  await noMissingKeys(page, "home");
  await act(page, '[data-act="new"]');
  // 市場
  for (var k of ["chicken", "chicken", "chicken", "negi", "tofu", "tofu", "beer", "beer", "oolong", "oolong"]) await act(page, '[data-buy="' + k + '"]');
  var s = await state(page);
  assert.strictEqual(s.fridge.chicken.length, 3, "買到雞肉");
  await noMissingKeys(page, "market");
  await act(page, '[data-act="ready"]');
  // 準備
  for (var d of ["karaage", "negima", "hiyayakko", "nama", "oolong"]) await act(page, '[data-board="' + d + '"]');
  s = await state(page);
  assert.deepStrictEqual(s.board, ["karaage", "negima", "hiyayakko", "nama", "oolong"], "黑板");
  await noMissingKeys(page, "prep");
  await act(page, '[data-act="ready"]');
  await page.waitForSelector("#iz-stage canvas", { timeout: 20000 });
  // 營業：服務到第一組結帳
  for (var g = 0; g < 30; g++) {
    s = await state(page);
    if (!s.night || s.night.i >= 1) break;
    await clearStory(page);
    if (await page.$('[data-talk="0"]:not([disabled])')) { await act(page, '[data-talk="0"]'); continue; }
    var srv = await page.$$eval("[data-serve]:not([disabled])", function (b) { return b.map(function (x) { return x.getAttribute("data-serve"); }); });
    if (srv.length) { await act(page, '[data-serve="' + srv[0] + '"]'); continue; }
    if (await page.$('[data-act="skip"]')) await act(page, '[data-act="skip"]');
  }
  s = await state(page);
  assert.ok(s.night.i >= 1 || s.phase === "close", "第一組結帳");
  assert.ok(Object.keys(s.notes).length >= 1, "筆記本有線索");
  await noMissingKeys(page, "service");
  await page.screenshot({ path: path.join(SHOTS, "service.png") });

  // 推進到第 5 天（尖峰日）的準備階段：從完整存檔改 day／phase
  // 食材每種 30 份：批次 E 常客增加後，尖峰前要服務的組數變多，6 份會在尖峰前用完（2026-11-09 偶發失敗的原因）
  await patchSave(page, "s.day = 5; s.phase = 'prep'; s.night = null; s.story.cur = null; s.story.queue = []; Object.keys(D.INGS).forEach(function (k) { s.fridge[k] = []; for (var n = 0; n < 30; n++) s.fridge[k].push(99); }); s.board = ['karaage', 'negima', 'hiyayakko', 'nama', 'oolong'];");
  await act(page, '[data-act="ready"]');
  for (g = 0; g < 80; g++) {
    s = await state(page);
    var cur = s.night && s.night.groups[s.night.i];
    if (cur && cur.kind === "rush") break;
    await clearStory(page);
    if (await page.$('[data-talk="0"]:not([disabled])')) { await act(page, '[data-talk="0"]'); continue; }
    srv = await page.$$eval("[data-serve]:not([disabled])", function (b) { return b.map(function (x) { return x.getAttribute("data-serve"); }); });
    if (srv.length) await act(page, '[data-serve="' + srv[0] + '"]');
  }
  await act(page, '[data-act="rush"]');
  await page.waitForSelector("#iz-rush", { timeout: 5000 });
  var served = 0;
  for (var tt = 0; tt < 200 && served < 3; tt++) {
    if (await page.$("[data-rc]:not([disabled])")) await page.dispatchEvent("[data-rc]:not([disabled])", "click");
    if (await page.$("[data-rt]:not([disabled])")) await page.dispatchEvent("[data-rt]:not([disabled])", "click");
    if (await page.$("[data-rs]:not([disabled])")) { await page.dispatchEvent("[data-rs]:not([disabled])", "click"); served++; }
    await page.waitForTimeout(200);
  }
  if (!served) console.log("rush debug:", JSON.stringify(await page.evaluate(function () { var s = window.PriTestIzakaya.state(); return { phase: s.phase, rush: s.rush && { t: s.rush.t, seats: s.rush.seats.map(function (x) { return x.gid + ":" + x.items.map(function (i) { return i.d + "/" + i.s; }).join(","); }) }, story: s.story.cur, i: s.night && s.night.i }; })));
  assert.ok(served >= 1, "尖峰至少上了一道菜");
  await noMissingKeys(page, "rush");
  await page.screenshot({ path: path.join(SHOTS, "rush.png") });

  // 打烊結算
  await patchSave(page, "s.rush = null; s.night = { groups: [], i: 0, rev: 0, satSum: 0, satN: 0, high: [], hints: {} }; s.story.cur = null; s.phase = 'service';");
  await page.evaluate(function () { var s = window.PriTestIzakaya.state(); window.PriTestIzakayaCore.closeService(s); });
  await page.waitForSelector("#iz-close");
  await noMissingKeys(page, "close");

  // 公休日約會：墊好感與星級
  await patchSave(page, "s.day = 6; s.phase = 'holiday'; s.rush = null; s.night = null; s.story.cur = null; s.story.queue = []; s.maxStar = 4; s.date = {}; s.players[s.order[0]].aff.mio = 60;");
  await act(page, '[data-date="mio"]');
  await act(page, '[data-spot="yakei"]');
  for (var r = 0; r < 3; r++) await act(page, '[data-dc="0"]');
  await clearStory(page);
  s = await state(page);
  assert.ok(s.date[s.order[0]].done && s.players[s.order[0]].aff.mio > 60, "約會完成並加好感");
  await noMissingKeys(page, "date");
  await page.screenshot({ path: path.join(SHOTS, "date.png") });
  // 1b：★4 在非最愛的地點約會 → 心動事件顯示該地點的通用描寫（新地點 beach）
  await patchSave(page, "s.date = {}; s.players[s.order[0]].aff.ayano = 70;");
  await act(page, '[data-date="ayano"]');
  await act(page, '[data-spot="beach"]');
  for (r = 0; r < 3; r++) await act(page, '[data-dc="0"]');
  await clearStory(page);
  await page.waitForSelector(".iz-heart");
  var heartTxt = await page.textContent(".iz-heart");
  assert.ok(heartTxt.indexOf("夕陽") >= 0, "非最愛地點顯示地點的通用心動描寫：" + heartTxt);
  // 筆記本與關係圖
  await patchSave(page, "s.story.links['chinatsu|mio'] = 'ex_band';");
  await act(page, '[data-act="notes"]');
  await page.waitForSelector("#iz-notes"); await page.waitForSelector("#iz-rel line");
  await page.screenshot({ path: path.join(SHOTS, "notes.png") });
  await page.keyboard.press("Escape");
  // 手機寬度
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  var ov = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  assert.ok(ov <= 0, "手機寬度不可橫向捲動：" + ov);
  await page.screenshot({ path: path.join(SHOTS, "mobile.png"), fullPage: true });
  // 日文沒有漏翻
  await page.evaluate(function () { localStorage.setItem("pritest-lang", "ja"); });
  await page.reload(); await act(page, '[data-act="continue"]');
  await noMissingKeys(page, "ja holiday");
  await page.evaluate(function () { localStorage.setItem("pritest-lang", "zh"); });
  // 批次 A：★5 可同時雇用 3 名店員
  await patchSave(page, "s.phase = 'holiday'; s.date = {}; s.maxStar = 5; ['reina', 'yuzu', 'akari', 'kotone'].forEach(function (k) { s.staff.met[k] = 1; });");
  await act(page, '[data-tab="staff"]');
  for (var h of ["reina", "yuzu", "akari"]) await act(page, '[data-hire="' + h + '"]');
  s = await state(page);
  assert.deepStrictEqual(s.staff.crew, ["reina", "yuzu", "akari"], "★5 雇用 3 人");
  assert.ok(await page.$('[data-hire="kotone"][disabled]'), "第 4 人不能雇");
  await act(page, '[data-fire="yuzu"]');
  s = await state(page);
  assert.deepStrictEqual(s.staff.crew, ["reina", "akari"], "解雇指定的人");
  // 批次 A：一年結束 → 結局畫面、跨局記憶（輪數＋結局收集）
  await page.evaluate(function () { localStorage.removeItem("pritest-izakaya-legacy"); });
  await patchSave(page, "s.day = 30; s.phase = 'close'; s.ready = {}; s.story.flags.will_stop = 1;");
  await act(page, '[data-act="ready"]');
  await page.waitForSelector("#iz-end .iz-ending");
  var endTxt = await page.textContent("#iz-end");
  assert.ok(endTxt.indexOf("守住月見橫丁") >= 0, "結局：守住月見橫丁");
  var lg = await page.evaluate(function () { return JSON.parse(localStorage.getItem("pritest-izakaya-legacy")); });
  assert.ok(lg.runs === 1 && lg.endings.street, "跨局記憶記下第 1 輪與結局");
  await page.reload();
  var homeTxt = await page.textContent("#iz-app");
  assert.ok(homeTxt.indexOf("已經營 1 年") >= 0 && homeTxt.indexOf("守住月見橫丁") >= 0, "首頁顯示輪數與結局收集");

  // ======================= 合作連線 =======================
  var fb = fakeFirebase();
  var ctxA = await browser.newContext({ viewport: { width: 1200, height: 900 } }), ctxB = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await fb.attach(ctxA); await fb.attach(ctxB);
  var A = await ctxA.newPage(), B = await ctxB.newPage();
  watch(A, "host"); watch(B, "guest");
  await A.goto(BASE); await fb.sync(A);
  await A.evaluate(function () { localStorage.setItem("pritest-lang", "zh"); localStorage.setItem("pritest-izakaya-name", "店長"); });
  await A.reload(); await fb.sync(A);
  await act(A, '[data-act="coop"]');
  await A.waitForSelector(".iz-lobby input");
  await act(A, '[data-role="hall"]');
  var url = await A.inputValue(".iz-lobby input");
  assert.ok(/room=g[0-9a-f]{32}/.test(url), "房間網址");
  await B.goto(BASE); await fb.sync(B);
  await B.evaluate(function () { localStorage.setItem("pritest-lang", "zh"); localStorage.setItem("pritest-izakaya-name", "店員"); });
  await B.goto(url); await fb.sync(B);
  await B.waitForSelector(".iz-plist li", { timeout: 10000 });
  await act(B, '[data-role="buyer"]');
  await A.waitForFunction(function () { return document.querySelectorAll(".iz-plist li").length === 2; }, null, { timeout: 10000 });
  await A.waitForTimeout(300);
  await act(A, '[data-act="start"]');
  await B.waitForSelector("[data-buy]", { timeout: 10000 });
  var roles = await A.evaluate(function () { var s = window.PriTestIzakaya.state(); return s.order.map(function (p) { return s.roles[p].slice().sort().join(","); }); });
  assert.ok(roles[0].indexOf("hall") >= 0 && roles[1].indexOf("buyer") >= 0, "分工：房主外場、客人採買：" + roles.join(" / "));
  // 房主（外場）不能買；客人（採買）能買
  assert.ok(await A.$('[data-buy="chicken"][disabled]'), "外場不能買");
  await act(B, '[data-buy="chicken"]');
  await A.waitForFunction(function () { var s = window.PriTestIzakaya.state(); return s.fridge.chicken && s.fridge.chicken.length === 1; }, null, { timeout: 10000 });
  await act(A, '[data-act="ready"]'); await act(B, '[data-act="ready"]');
  await A.waitForFunction(function () { return window.PriTestIzakaya.state().phase === "prep"; }, null, { timeout: 10000 });
  await B.waitForFunction(function () { return window.PriTestIzakaya.state().phase === "prep"; }, null, { timeout: 10000 });
  // 劇情投票：房主手動開一段，兩人各投一票
  await A.evaluate(function () { var s = window.PriTestIzakaya.state(); window.PriTestIzakayaStory.begin(s, "rin_01", null); });
  await A.evaluate(function () { window.PriTestIzakaya.send({ a: "vote", c: 0 }); });   // 讓房主廣播
  await B.waitForSelector("#iz-story", { timeout: 10000 });
  await clearStory(A); await clearStory(B);
  await A.waitForFunction(function () { var s = window.PriTestIzakaya.state(); return !s.story.cur && s.story.seen.rin_01; }, null, { timeout: 10000 });
  await noMissingKeys(B, "coop");
  await B.screenshot({ path: path.join(SHOTS, "coop.png") });

  console.log("errors:", errors.length ? errors : "none");
  assert.strictEqual(errors.length, 0, "不能有 JS 錯誤");
  await browser.close();
  console.log("ui_check OK");
})().catch(function (e) { console.error(e); process.exit(1); });
