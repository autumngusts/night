// イヌスノー（狗雪）第 4 階段畫面檢查（Playwright）：node tools/inusnow_check/ui_p4_check.js（先 generate.py 並啟動 http.server 8975）
// 依據 docs/inusnow_design.md §19；計畫 2026-11-21-inusnow-phase4.md T10。
// 單人：接力、精彩重播。連線：3 個獨立的瀏覽器（A 房主上場、B 上場、C 觀戰下注），用 Node 端的假 Firebase（同 rtSet／rtSubscribe 介面）轉送，
//       建房 → 用連結加入 → 準備 → 發佈出賽表 → C 下注 → 出發 → 兩人同時滑平行大曲道 → 三台的名次一致 → 派彩。
"use strict";
var path = require("path");
var os = require("os");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var ROOT = process.env.INUSNOW_ROOT || "http://localhost:8975/";
var BASE = ROOT + "inusnow/index.html";
var SHOT_DIR = process.env.SHOT_DIR || os.tmpdir();
function ok(m) { console.log("ok - " + m); }
function shot(page, n) { return page.screenshot({ path: path.join(SHOT_DIR, "inusnow_p4_" + n + ".png") }); }
function st(page) { return page.evaluate(function () { return window.PriTestInusnowApp._debug.state(); }); }

// 假 Firebase：Node 持有整棵樹，set 之後推給所有頁面
function fakeHub() {
  var store = {}, pages = [];
  async function push(p, json) { for (var i = 0; i < pages.length; i++) { try { await pages[i].evaluate(function (a) { window.__fgPush(a[0], a[1]); }, [p, json]); } catch (e) { /* 關閉中 */ } } }
  return {
    attach: async function (ctx) {
      await ctx.exposeBinding("__fgSet", async function (src, p, json) {
        Object.keys(store).forEach(function (k) { if (k === p || k.indexOf(p + "/") === 0) delete store[k]; });
        if (json !== "null") store[p] = json;
        await push(p, json);
        return true;
      });
      await ctx.addInitScript(function () {
        try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) { /* 測試 */ }
        var tree = {}, subs = [], ready = false, pending = [];
        window.__fgDone = function () { ready = true; pending.forEach(function (f) { f(); }); pending = []; };
        function parts(p) { return p.split("/").filter(Boolean); }
        function getAt(p) { var o = tree, ps = parts(p); for (var i = 0; i < ps.length; i++) { if (!o || typeof o !== "object") return null; o = o[ps[i]]; } return o === undefined ? null : JSON.parse(JSON.stringify(o)); }
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
        window.PriTestInusnowFakeGS = {
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
          rtTransaction: function (room, mode, sub, upd) { var cur = getAt(full(room, sub)), nv = upd(cur); return nv === undefined ? Promise.resolve(null) : set(room, mode, sub, nv).then(function () { return nv; }); },
          rtSetWithOnDisconnect: function (room, mode, sub, v) { set(room, mode, sub, v); return function () { set(room, mode, sub, null); }; },
        };
      });
    },
    sync: async function (page) {
      if (pages.indexOf(page) < 0) pages.push(page);
      var keys = Object.keys(store);
      for (var i = 0; i < keys.length; i++) await page.evaluate(function (a) { window.__fgPush(a[0], a[1]); }, [keys[i], store[keys[i]]]);
      await page.evaluate(function () { window.__fgDone(); });
    },
  };
}

(async function () {
  var browser = await chromium.launch();
  var errors = [];
  function watch(page, tag) {
    page.on("pageerror", function (e) { errors.push(tag + ": " + e.message); });
    page.on("console", function (m) { if (m.type() === "error") errors.push(tag + ": " + m.text()); });
    page.on("dialog", function (d) { d.accept(); });
  }
  try {
    // ======================= 單人：接力、精彩重播 =======================
    var ctx0 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx0.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
    var p = await ctx0.newPage();
    watch(p, "solo");
    await p.goto(BASE);
    await p.waitForSelector(".inu-resort");
    var tabs = await p.$$eval(".inu-tab", function (l) { return l.map(function (b) { return b.getAttribute("data-tab"); }); });
    // 2026-11-21：第 5 階段加上「犬舍」「商店」分頁（設計 §20）
    assert.deepStrictEqual(tabs, ["resorts", "bet", "cup", "daily", "room", "kennel", "shop"], "首頁 7 個分頁");
    await p.dispatchEvent('.inu-resort[data-resort="happo"]', "click");
    await p.waitForSelector('.inu-event[data-event="relay"]');
    await p.dispatchEvent('.inu-event[data-event="relay"]', "click");
    await p.waitForSelector(".inu-legs");
    await p.dispatchEvent('[data-opt="relayLeg"][data-val="2"]', "click");
    await p.waitForSelector('.inu-legs li.is-me');
    await shot(p, "relay_setup");
    await p.evaluate(function () { var d = window.PriTestInusnowApp._debug; d.autopilot(true); d.speedUp(4); });
    await p.dispatchEvent('[data-act="start"]', "click");
    await p.waitForFunction(function () { var s = window.PriTestInusnowApp._debug.state(); return s.screen === "race" && s.phase === "run"; }, null, { timeout: 60000 });
    assert.strictEqual((await st(p)).legKind, "slope", "第 3 棒是 Slopestyle");
    await p.waitForTimeout(1500);
    await shot(p, "relay_race");
    await p.waitForSelector(".inu-legtable li", { timeout: 180000 });
    assert.strictEqual((await p.$$(".inu-legtable li")).length, 4, "4 棒的成績");
    await p.waitForTimeout(1200);
    await shot(p, "relay_result");
    ok("單人接力：選第 3 棒、跑完、4 棒成績與隊伍排名");
    // 精彩重播（大曲道練習）
    await p.evaluate(function () { var d = window.PriTestInusnowApp._debug; d.autopilot(true); d.speedUp(10); d.start("nozawa", { event: "gs" }); });
    await p.waitForSelector('[data-act="hl"]', { timeout: 180000 });
    assert.ok(await p.$('[data-act="shareclip"]'), "分享片段鍵");
    await p.dispatchEvent('[data-act="hl"]', "click");
    await p.waitForSelector(".inu-hlplay");
    await p.waitForTimeout(1500);
    await shot(p, "highlight");
    await p.dispatchEvent("#btn-inu-skip", "click");
    await p.waitForSelector('[data-act="hl"]');
    ok("精彩重播：播放、略過、回到成績");
    await ctx0.close();

    // ======================= 連線：A 房主、B 上場、C 觀戰 =======================
    var hub = fakeHub();
    async function player(tag, name, breed) {
      var ctx = await browser.newContext({ viewport: { width: 900, height: 760 } });
      await hub.attach(ctx);
      var pg = await ctx.newPage();
      watch(pg, tag);
      pg._ctx = ctx;
      await pg.addInitScript(function (a) { try { if (!sessionStorage.getItem("i0")) { sessionStorage.setItem("i0", "1"); localStorage.setItem("pritest-inusnow-save-v1", JSON.stringify({ v: 1, dog: { breed: a.b, name: a.n } })); } } catch (e) {} }, { n: name, b: breed });
      return pg;
    }
    var A = await player("A", "阿雪", "husky"), B = await player("B", "小柴", "shiba"), C = await player("C", "觀眾", "corgi");
    await A.goto(BASE);
    await hub.sync(A);
    await A.waitForSelector(".inu-resort");
    await A.evaluate(function () { window.PriTestInusnowP4.enterRoom(null); });
    await A.waitForFunction(function () { var r = window.PriTestInusnowP4.room(); return r && r.loaded && r.isHost(); }, null, { timeout: 15000 });
    var url = await A.evaluate(function () { return location.href; });
    assert.ok(/\?room=g[0-9a-f]{32}$/.test(url), "網址帶房號");
    for (var pg2 of [B, C]) { await pg2.goto(url); await hub.sync(pg2); }
    await B.waitForFunction(function () { var r = window.PriTestInusnowP4.room(); return r && r.loaded; }, null, { timeout: 15000 });
    await C.waitForFunction(function () { var r = window.PriTestInusnowP4.room(); return r && r.loaded; }, null, { timeout: 15000 });
    await A.waitForFunction(function () { return window.PriTestInusnowP4.room().list().length === 3; }, null, { timeout: 15000 });
    // C 觀戰；A 設定雪場；大家準備
    await C.waitForSelector('[data-opt="rrole"][data-val="watch"]');
    await C.dispatchEvent('[data-opt="rrole"][data-val="watch"]', "click");
    await A.waitForSelector("#inu-rresort");
    await A.selectOption("#inu-rresort", "nozawa");
    for (var pg3 of [A, B]) { await pg3.waitForSelector('[data-act="ready"]'); await pg3.dispatchEvent('[data-act="ready"]', "click"); }
    await A.waitForFunction(function () { var b = document.querySelector('[data-act="publish"]'); return b && !b.disabled; }, null, { timeout: 15000 });
    await shot(A, "lobby");
    await A.dispatchEvent('[data-act="publish"]', "click");
    await C.waitForSelector("[data-bet]", { timeout: 15000 });
    var c0 = await C.evaluate(function () { return window.PriTestInusnowP4.room().coins(); });
    var aCid = await A.evaluate(function () { return window.PriTestInusnowP4.room().cid; });
    await C.dispatchEvent('[data-bet="' + aCid + '"]', "click");
    await C.waitForFunction(function (c) { var r = window.PriTestInusnowP4.room(); return r.match && r.match.bets[r.pid] && r.match.bets[r.pid][c] === 100; }, aCid, { timeout: 10000 });
    assert.strictEqual(await C.evaluate(function () { return window.PriTestInusnowP4.room().coins(); }), c0 - 100, "C 下注扣房間狗幣");
    await shot(C, "card");
    for (var pg4 of [A, B, C]) await pg4.evaluate(function () { window.PriTestInusnowApp._debug.autopilot(true); });
    await A.dispatchEvent('[data-act="start"]', "click");
    for (var pg5 of [A, B, C]) await pg5.waitForFunction(function () { var s = window.PriTestInusnowApp._debug.state(); return s.screen === "race" && s.room; }, null, { timeout: 30000 });
    await A.waitForTimeout(9000);
    await shot(A, "race_A");
    await shot(C, "race_C");
    for (var pg6 of [A, B, C]) await pg6.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().screen === "roomres"; }, null, { timeout: 240000 });
    var rows = [];
    for (var pg7 of [A, B, C]) rows.push(await pg7.evaluate(function () { return JSON.stringify(window.PriTestInusnowP4.rs().res.rows.map(function (x) { return [x.cid, x.val === null ? null : x.val.toFixed(4)]; })); }));
    assert.strictEqual(rows[0], rows[1], "A 和 B 的名次與時間一致");
    assert.strictEqual(rows[0], rows[2], "觀戰的 C 也一致");
    var res = JSON.parse(rows[0]);
    var cPay = await C.evaluate(function () { return window.PriTestInusnowP4.rs().res.myPay; });
    // 2026-11-21 QA 後：沒有人押中冠軍時全額退還（設計 §0.7），舊的期望值 0 已過時
    assert.strictEqual(cPay, res[0][0] === aCid ? 80 : 100, "C 的派彩（押中：100 × 0.8；沒人押中：退還 100）");
    await shot(A, "result");
    ok("連線：建房、加入、觀戰下注、同時出發、3 台名次一致（" + res.map(function (x) { return x[1]; }).join(" / ") + "）、派彩 " + cPay);
    // 回大廳
    await A.dispatchEvent('[data-act="lobby"]', "click");
    await B.waitForSelector('[data-act="ready"]', { timeout: 15000 });
    ok("房主回大廳、大家回到大廳");
    // 房間接力：A 第 1 棒、B 第 2 棒、第 3、4 棒 CPU；兩台的團隊時間一致
    await A.waitForSelector('[data-opt="revent"][data-val="relay"]');
    await A.dispatchEvent('[data-opt="revent"][data-val="relay"]', "click");
    for (var pg8 of [A, B]) {
      await pg8.waitForFunction(function () { var b = document.querySelector('[data-act="ready"]'); return b && /準備好了/.test(b.textContent); }, null, { timeout: 15000 });
      await pg8.dispatchEvent('[data-act="ready"]', "click");
    }
    await A.waitForFunction(function () { var b = document.querySelector('[data-act="publish"]'); return b && !b.disabled; }, null, { timeout: 15000 });
    await A.dispatchEvent('[data-act="publish"]', "click");
    await A.waitForSelector('[data-act="start"]', { timeout: 15000 });
    await A.dispatchEvent('[data-act="start"]', "click");
    for (var pg9 of [A, B, C]) await pg9.waitForFunction(function () { return window.PriTestInusnowApp._debug.state().screen === "roomres"; }, null, { timeout: 300000 });
    var tots = [];
    for (var pg10 of [A, B, C]) tots.push(await pg10.evaluate(function () { var r = window.PriTestInusnowP4.rs().res; return r.relay ? r.total.toFixed(4) + "|" + r.legs.length : "x"; }));
    assert.strictEqual(tots[0], tots[1], "A 和 B 的接力團隊時間一致");
    assert.strictEqual(tots[0], tots[2], "觀戰的 C 也一致");
    await shot(B, "relay_room_result");
    ok("房間接力：每人一棒、CPU 補空棒、3 台團隊時間一致（" + tots[0] + "）");
    assert.deepStrictEqual(errors, [], "沒有 console error");
    console.log("inusnow ui_p4_check OK（截圖：" + SHOT_DIR + "）");
  } finally {
    await browser.close();
  }
})().catch(function (e) { console.error(e); process.exit(1); });
