// ============================================================================
// dejavu 多裝置連線檢查（第十三批，2026-10-27）：Firebase emulator 上 3 個瀏覽器
//   房主建房 → 玩家用連結加入 → 房主改設定、玩家那邊跟著變 → 玩家在車庫改車（房主看得到）→ 都按準備 → 開賽
//   → 比賽中玩家只能指揮自己的車、指令會傳到房主 → 兩邊時間對齊、結果完全一致 → 房主播精彩重播、玩家跟著播
//   → Déjà vu 一起重看（中途第三個人用連結加入觀戰）：結果與第一場相同 → 回房間（玩家的準備自動取消）→ 離開
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8946 --directory dist
//   3. Firebase emulator（Database＋Auth，見 firebase.json；tools/midnight_check 有 firebase-tools）：
//        tools/midnight_check/node_modules/.bin/firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node tools/dejavu_check/net_check.js
// 截圖在 tools/dejavu_check/shots/（net_lobby.png、net_race.png、net_result.png）
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.DEJAVU_BASE || "http://localhost:8946/dejavu/index.html";
var SHOT_DIR = path.join(__dirname, "shots");

async function newPage(browser, label, name) {
  var ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.addInitScript(function (n) {
    try { sessionStorage.setItem("pritestRtdbEmulator", "1"); localStorage.setItem("pritest-dejavu-netname", n); } catch (e) { /* 測試環境 */ }
  }, name);
  var page = await ctx.newPage();
  page.label = label;
  page.errors = [];
  page.on("pageerror", function (e) { page.errors.push(label + ": " + e); });
  return page;
}
function dv(page, fn, arg) { return page.evaluate(fn, arg); }
function screen(page) { return dv(page, function () { return window.PriTestDejavu.ui().screen; }); }
function room(page) {
  return dv(page, function () {
    var r = window.PriTestDejavu.room();
    return r ? { id: r.id, host: r.isHost(), loaded: r.loaded, n: r.list().length, status: r.meta && r.meta.status, me: r.me, list: r.list() } : null;
  });
}
function net(page) { return dv(page, function () { return window.PriTestDejavu.net(); }); }
function waitFor(page, fn, arg, ms) { return page.waitForFunction(fn, arg, { timeout: ms || 20000 }); }
async function clickText(page, sel, text) {
  var ok = await dv(page, function (a) {
    var b = Array.prototype.filter.call(document.querySelectorAll(a[0]), function (x) { return x.textContent.trim() === a[1] && !x.disabled; })[0];
    if (b) b.click();
    return !!b;
  }, [sel, text]);
  assert.ok(ok, page.label + " 找不到按鈕：" + text);
}
function resKey(res) { return JSON.stringify((res || []).map(function (r) { return [r.pos, r.id, r.name, r.state, r.time]; })); }
async function toResult(page) { await waitFor(page, function () { return window.PriTestDejavu.ui().screen === "result"; }, null, 180000); }

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch();
  var host = await newPage(browser, "房主", "阿房");
  var guest = await newPage(browser, "玩家", "小客");
  var watcher = await newPage(browser, "觀戰", "路人");
  try {
    // ---- 房主：先在單機設定裡挑最短的固定山路、1 台 CPU、奔放模式（手牌、機關也要同步），再建房 ----
    await host.goto(BASE);
    await waitFor(host, function () { return !!window.PriTestDejavu; });
    var shortest = await dv(host, function () {
      var D = window.PriTestDejavuData, Core = window.PriTestDejavuCore;
      return D.COURSES.map(function (c) { return { id: c.id, L: Core.courseLen(Core.fixedCourse(c.id)) }; }).sort(function (a, b) { return a.L - b.L; })[0].id;
    });
    await dv(host, function (id) {
      var s = JSON.parse(localStorage.getItem("pritest-dejavu-setup") || "null") || window.PriTestDejavu.setup();
      s.course = window.PriTestDejavuCore.fixedCourse(id); s.cpu = 1; s.cpuCars = null; s.rule = "wild"; s.season = "summer";
      localStorage.setItem("pritest-dejavu-setup", JSON.stringify(s));
    }, shortest);
    await host.reload();
    await waitFor(host, function () { return !!document.querySelector(".dv-net-create"); });
    var soloBefore = await dv(host, function () { return localStorage.getItem("pritest-dejavu-setup"); });
    await host.dispatchEvent(".dv-net-create", "click");
    await waitFor(host, function () { var r = window.PriTestDejavu.room(); return r && r.loaded && r.isHost(); });
    var info = await room(host);
    assert.ok(/[?&]room=g[0-9a-f]{32}/.test(host.url()), "房主網址要帶房間：" + host.url());
    console.log("房間 " + info.id + "（山路 " + shortest + "）");

    // ---- 玩家：先存一台車，再用連結加入 ----
    await guest.goto(BASE);
    await dv(guest, function () {
      localStorage.setItem("pritest-dejavu-netcar", JSON.stringify({ car: "fd3s", tire: "sport", aero: 0, gear: 0, style: "balanced", up: { eng: 0, wt: 0, brk: 0, hdl: 0 } }));
    });
    await guest.goto(BASE + "?room=" + info.id);
    await waitFor(guest, function () { var r = window.PriTestDejavu.room(); return r && r.loaded && r.list().length === 2; });
    await waitFor(host, function () { return window.PriTestDejavu.room().list().length === 2; });
    assert.strictEqual((await room(guest)).host, false, "加入的人不是房主");
    // 非房主的設定畫面：只有房主設定的摘要，不能改
    await waitFor(guest, function () { return !!document.querySelector(".dv-net-cfg"); });
    assert.strictEqual(await dv(guest, function () { return document.querySelectorAll(".dv-player-row").length; }), 0, "非房主不能改玩家");
    var gs = await dv(guest, function () { return window.PriTestDejavu.setup(); });
    assert.strictEqual(gs.course.src, shortest, "玩家拿到房主的山路");
    assert.strictEqual(gs.rule, "wild");
    assert.strictEqual(gs.players.length, 1, "每台裝置一位玩家");

    // ---- 房主改季節、速度 → 玩家跟著變 ----
    var winter = await dv(host, function () { return "❄️ " + window.PriTestDejavuData.SEASONS.winter.name[window.I18N.getLang()]; });
    await clickText(host, ".dv-choice button", winter);
    await clickText(host, ".dv-net-ready-row .dv-choice button", "4×");
    await waitFor(guest, function () { var s = window.PriTestDejavu.setup(); return s.season === "winter" && s.netSpeed === 4; });
    // 房主的單機設定沒有被動到
    assert.strictEqual(await dv(host, function () { return localStorage.getItem("pritest-dejavu-setup"); }), soloBefore, "連線中改設定不能寫進單機存檔");

    // ---- 玩家在車庫改車（換硬胎）→ 房主的成員清單看得到 ----
    await guest.dispatchEvent(".dv-net-garage", "click");
    await waitFor(guest, function () { return window.PriTestDejavu.ui().screen === "garage"; });
    var hard = await dv(guest, function () { return window.PriTestDejavuData.TIRES.hard.name[window.I18N.getLang()]; });
    await clickText(guest, ".dv-choice button", hard);
    await waitFor(host, function () {
      return window.PriTestDejavu.room().list().some(function (p) { return p.name === "小客" && p.spec && p.spec.car === "fd3s" && p.spec.tire === "hard"; });
    });
    // 準備：房主要等大家都準備好才能開賽
    await host.dispatchEvent(".dv-net-ready", "click");
    await waitFor(host, function () { return window.PriTestDejavu.room().me.ready; });
    assert.ok(await dv(host, function () { return document.querySelector(".dv-net-start").disabled; }), "玩家還沒準備，不能開賽");
    await guest.dispatchEvent(".dv-net-ready", "click");
    await waitFor(host, function () { var b = document.querySelector(".dv-net-start"); return b && !b.disabled; });
    await host.screenshot({ path: path.join(SHOT_DIR, "net_lobby.png"), fullPage: true });
    await host.dispatchEvent(".dv-net-start", "click");

    // ---- 比賽：兩邊都進比賽畫面，各自只指揮自己的車 ----
    await waitFor(host, function () { return window.PriTestDejavu.ui().screen === "race"; });
    await waitFor(guest, function () { return window.PriTestDejavu.ui().screen === "race"; });
    var hn = await net(host), gn = await net(guest);
    assert.strictEqual(hn.no, gn.no);
    assert.strictEqual(hn.mine.length, 1); assert.strictEqual(gn.mine.length, 1);
    assert.notStrictEqual(hn.mine[0], gn.mine[0], "兩邊指揮的車不同");
    assert.strictEqual(gn.follow, gn.mine[0], "預設看自己的車");
    var cars = await dv(guest, function () { return window.PriTestDejavu.race().cars.map(function (c) { return { name: c.name, cpu: c.cpu, car: c.spec.car, tire: c.spec.tire }; }); });
    assert.strictEqual(cars.length, 3, "2 位玩家＋1 台 CPU");
    assert.ok(cars.some(function (c) { return c.name === "小客" && c.car === "fd3s" && c.tire === "hard"; }), "玩家改的車有上場");
    assert.strictEqual(await dv(guest, function () { return document.querySelectorAll(".dv-tac-row").length; }), 1, "戰略面板只有自己的車");
    assert.strictEqual(await dv(guest, function () { return !!document.querySelector(".dv-pause"); }), false, "連線比賽不能暫停");
    // 開賽倒數後，玩家換戰略 → 房主那邊的同一台車也換了
    await waitFor(guest, function () { return window.PriTestDejavu.race().t > 1.5; }, null, 30000);
    var pick = await dv(guest, function (id) {
      var c = window.PriTestDejavu.race().cars[id];
      return window.PriTestDejavuData.STYLE_IDS.filter(function (s) { return s !== c.styleId; })[0];
    }, gn.mine[0]);
    await guest.dispatchEvent(".dv-tac-row .dv-tac-" + pick, "click");
    await waitFor(host, function (a) { return window.PriTestDejavu.race().cars[a[0]].styleId === a[1]; }, [gn.mine[0], pick], 8000);
    // 玩家自己這邊換上房主快照之後，戰略也不能被蓋回去
    await guest.waitForTimeout(2500);
    var gStyle = await dv(guest, function (id) { return window.PriTestDejavu.race().cars[id].styleId; }, gn.mine[0]);
    assert.strictEqual(gStyle, pick, "玩家換上快照後戰略被蓋回去了");
    // 鏡頭：看領頭 → 看自己
    await guest.dispatchEvent(".dv-net-lead", "click");
    assert.strictEqual((await net(guest)).auto, true);
    await guest.dispatchEvent(".dv-net-me", "click");
    var g2 = await net(guest);
    assert.ok(!g2.auto && g2.follow === gn.mine[0], "切回看自己");
    // 兩邊的比賽時間對齊（依伺服器時鐘）
    var tt = await Promise.all([host, guest].map(function (p) { return dv(p, function () { return window.PriTestDejavu.race().t; }); }));
    assert.ok(Math.abs(tt[0] - tt[1]) < 1.5, "兩邊比賽時間差太多：" + tt.join(" / "));
    await guest.screenshot({ path: path.join(SHOT_DIR, "net_race.png") });

    // ---- 結果：兩邊完全一致 ----
    await Promise.all([toResult(host), toResult(guest)]);
    await waitFor(guest, function () { return window.PriTestDejavu.net().resApplied; });
    var r1 = await dv(host, function () { return window.PriTestDejavu.result(); });
    var r1g = await dv(guest, function () { return window.PriTestDejavu.result(); });
    assert.strictEqual(resKey(r1g), resKey(r1), "兩邊結果不同");
    console.log("第一場：" + r1.map(function (r) { return r.pos + ". " + r.name; }).join("　"));
    await guest.screenshot({ path: path.join(SHOT_DIR, "net_result.png"), fullPage: true });

    // ---- 房主播精彩重播 → 玩家那邊跟著播 ----
    var hasHl = await dv(host, function () { var b = document.querySelector(".dv-hl-all"); return b && !b.disabled; });
    if (hasHl) {
      await host.dispatchEvent(".dv-hl-all", "click");
      await waitFor(guest, function () { return window.PriTestDejavu.tv().hl; }, null, 8000);
    } else console.log("（這場沒有精華片段，略過一起看精華）");

    // ---- Déjà vu 一起重看；中途第三個人加入觀戰 ----
    await host.dispatchEvent(".dv-net-dejavu", "click");
    await waitFor(host, function (no) { var n = window.PriTestDejavu.net(); return n && n.no === no + 1 && window.PriTestDejavu.ui().screen === "race"; }, hn.no);
    await waitFor(guest, function (no) { var n = window.PriTestDejavu.net(); return n && n.no === no + 1 && window.PriTestDejavu.ui().screen === "race"; }, hn.no);
    await waitFor(host, function () { return window.PriTestDejavu.race().t > 3; }, null, 30000);
    await watcher.goto(BASE + "?room=" + info.id);
    await waitFor(watcher, function () { return window.PriTestDejavu.ui().screen === "race"; }, null, 30000);
    assert.deepStrictEqual((await net(watcher)).mine, [], "中途加入的人只能觀戰");
    assert.strictEqual(await dv(watcher, function () { return document.querySelectorAll(".dv-tac-row").length; }), 0);
    await Promise.all([toResult(host), toResult(guest), toResult(watcher)]);
    await waitFor(watcher, function () { return window.PriTestDejavu.net().resApplied; });
    await waitFor(guest, function () { return window.PriTestDejavu.net().resApplied; });
    var r2 = await dv(host, function () { return window.PriTestDejavu.result(); });
    assert.strictEqual(resKey(r2), resKey(r1), "Déjà vu 結果要和第一場相同");
    assert.strictEqual(resKey(await dv(watcher, function () { return window.PriTestDejavu.result(); })), resKey(r1), "觀戰的人結果相同");

    // ---- 回房間：玩家的準備自動取消 ----
    await host.dispatchEvent(".dv-net-lobby", "click");
    await waitFor(guest, function () { var r = window.PriTestDejavu.room(); return r.meta.status === "lobby" && !r.me.ready; });
    // 離開房間：成員減少，玩家回到自己的單機設定
    await guest.goto(BASE + "?room=" + info.id);   // 重新整理也會回到同一間
    await waitFor(guest, function () { var r = window.PriTestDejavu.room(); return r && r.loaded; });
    await guest.dispatchEvent(".dv-net-leave", "click");
    await waitFor(guest, function () { return !window.PriTestDejavu.room() && !/room=/.test(location.search); });
    await waitFor(host, function () { return !window.PriTestDejavu.room().list().some(function (p) { return p.name === "小客"; }); }, null, 15000);

    var errs = host.errors.concat(guest.errors, watcher.errors);
    assert.deepStrictEqual(errs, [], "頁面錯誤：\n" + errs.join("\n"));
    console.log("✓ dejavu 多裝置連線檢查通過（截圖在 " + SHOT_DIR + "）");
  } catch (err) {
    console.error(err);
    await Promise.all([host, guest, watcher].map(function (p) { return p.screenshot({ path: path.join(SHOT_DIR, "net_fail_" + p.label + ".png"), fullPage: true }).catch(function () {}); }));
    console.error(host.errors.concat(guest.errors, watcher.errors).join("\n"));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
