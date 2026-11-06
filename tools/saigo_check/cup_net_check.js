// ============================================================================
// 賽狗賽狗（saigo）連線房間的 WIN5 與冠軍大會檢查（2026-11-05）：Firebase emulator 上 2 個瀏覽器
//   房主 A、玩家 B 各派一隻 → A 開啟 WIN5（短距離）→ A 開始冠軍大會（預賽 A）
//   → 第 1 場兩人各買 WIN5（各扣 1000 籌碼）；A 每場都選真正的冠軍（自己先跑一次確定性模擬），B 選一定不會贏的狗
//   → 預賽 A／預賽 B／敗部復活／決賽 4 關＋閉幕後再 1 場＝WIN5 的 5 場
//   → 檢查：每關的出賽狗＝上一關的晉級名單（決賽＝兩組預賽前 2＋敗部復活前 2）、兩邊出賽表一致；
//      大會冠軍＝決賽第 1 名；WIN5 第 5 場後只有 A 全中，彩池 1400（2 × 1000 × 70%）全歸 A
// 前置同 net_check.js（generate.py、http.server 8947、Firebase emulator）。
// 執行：node tools/saigo_check/cup_net_check.js（連不到 gstatic 時加 FIREBASE_SDK_DIR=<node_modules/firebase 的路徑>）
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;
var BASE = process.env.SAIGO_BASE || "http://localhost:8947/saigo/index.html";

function kennel(name, breed) {
  return { v: 1, coins: 5000, dogs: [{ id: "d1", breed: breed, name: name, lv: 3, exp: 0, train: { spd: 8, sta: 4, pow: 0, agi: 0, jmp: 0, swm: 0, cat: 0, foc: 0 }, fatigue: 0, mood: 3, bond: 10, races: 0, wins: 0, top3: 0, earnings: 0 }], nextId: 2, at: Date.now(), stats: { races: 0, bets: 0, spent: 0, won: 0, bailouts: 0 }, history: [] };
}
async function newPage(browser, label, name, kn) {
  var ctx = await browser.newContext({ viewport: { width: 1100, height: 860 } });
  if (process.env.FIREBASE_SDK_DIR) await ctx.route("https://www.gstatic.com/firebasejs/**", function (r) { r.fulfill({ path: path.join(process.env.FIREBASE_SDK_DIR, r.request().url().split("/").pop()), contentType: "application/javascript" }); });
  await ctx.addInitScript(function (a) {
    try {
      sessionStorage.setItem("pritestRtdbEmulator", "1");
      if (!sessionStorage.getItem("sg-init")) {
        sessionStorage.setItem("sg-init", "1");
        localStorage.setItem("pritest-saigo-name", a.name);
        localStorage.setItem("pritest-lang", "zh");
        localStorage.setItem("pritest-saigo-pref", JSON.stringify({ no3d: true, entryDog: "d1" }));
        localStorage.setItem("pritest-saigo-kennel", JSON.stringify(a.kn));
      }
    } catch (e) { /* 測試環境 */ }
  }, { name: name, kn: kn });
  var page = await ctx.newPage();
  page.label = label;
  page.errors = [];
  page.on("pageerror", function (e) { page.errors.push(label + ": " + e); });
  page.on("console", function (m) { if (m.type() === "error") page.errors.push(label + ": " + m.text()); });
  return page;
}
function ev(page, fn, arg) { return page.evaluate(fn, arg); }
async function until(page, fn, arg, ms, what) {
  var end = Date.now() + (ms || 15000);
  while (Date.now() < end) {
    if (await ev(page, fn, arg)) return;
    await page.waitForTimeout(200);
  }
  throw new Error(page.label + " 等不到：" + what);
}
function clickBtn(page, text, exact) {
  return ev(page, function (a) {
    var b = Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) { return !x.disabled && (a.exact ? x.textContent.trim() === a.text : x.textContent.indexOf(a.text) >= 0); })[0];
    if (!b) throw new Error("找不到按鈕：" + a.text);
    b.click();
  }, { text: text, exact: !!exact });
}
function cardOf(page) {
  return ev(page, function () { var c = window.PriTestSaigo.ui.card; return { seed: c.seed, cup: c.cup, w5: c.w5, names: c.dogs.map(function (d) { return d.name; }), no: window.PriTestSaigo.ui.netNo }; });
}

(async function () {
  var browser = await chromium.launch();
  var A = await newPage(browser, "A", "房主", kennel("阿灰", "greyhound"));
  var B = await newPage(browser, "B", "玩家B", kennel("小柯", "corgi"));
  A.on("dialog", function (d) { d.accept(); });
  await A.goto(BASE);
  await ev(A, function () { window.PriTestSaigo.enterRoom(null); });
  await until(A, function () { var r = window.PriTestSaigo.ui.room; return r && r.loaded && r.isHost(); }, null, 15000, "建房");
  var url = await ev(A, function () { return location.href; });
  await B.goto(url);
  await until(B, function () { var r = window.PriTestSaigo.ui.room; return r && r.loaded; }, null, 15000, "加入");
  await until(A, function () { var l = window.PriTestSaigo.ui.room.list(); return l.length === 2 && l.every(function (p) { return p.entry; }); }, null, 15000, "兩人都派狗");
  // 短距離、WIN5 開啟
  await clickBtn(A, "短距離");
  await clickBtn(A, "🎯 開啟", true);
  await until(B, function () { return window.PriTestSaigo.ui.room.cfg.w5 === true && window.PriTestSaigo.ui.room.cfg.dist === "sprint"; }, null, 10000, "B 收到 WIN5 設定");
  await until(A, function () { var r = window.PriTestSaigo.ui.room; return r.balLoaded && r.bal[r.pid]; }, null, 10000, "A 籌碼");
  await until(B, function () { var r = window.PriTestSaigo.ui.room; return r.balLoaded && r.bal[r.pid]; }, null, 10000, "B 籌碼");
  var a0 = await ev(A, function () { return window.PriTestSaigo.ui.room.coins(); });
  await clickBtn(A, "開始冠軍大會");

  var expectStages = ["h1", "h2", "rep", "final", null], prevCup = null;
  for (var leg = 1; leg <= 5; leg++) {
    await until(A, function (l) { var u = window.PriTestSaigo.ui; return u.screen === "card" && u.card && u.card.w5 && u.card.w5.leg === l; }, leg, 20000, "A 第 " + leg + " 場出賽表");
    await until(B, function (l) { var u = window.PriTestSaigo.ui; return u.screen === "card" && u.card && u.card.w5 && u.card.w5.leg === l; }, leg, 20000, "B 第 " + leg + " 場出賽表");
    var ca = await cardOf(A), cb = await cardOf(B);
    assert.strictEqual(ca.seed, cb.seed, "同一張出賽表");
    assert.strictEqual(ca.cup ? ca.cup.stage : null, expectStages[leg - 1], "第 " + leg + " 場的關卡");
    // 這一關的出賽狗＝大會狀態的名單
    if (ca.cup) {
      var want = await ev(A, function () { return window.PriTestSaigoCup.entriesFor(window.PriTestSaigo.ui.room.cup).map(function (e) { return e.name; }); });
      want.forEach(function (n) { assert.ok(ca.names.indexOf(n) >= 0, ca.cup.stage + " 有 " + n + "：" + ca.names.join(",")); });
      if (ca.cup.stage === "h1") assert.ok(ca.names.indexOf("阿灰") >= 0 || ca.names.indexOf("小柯") >= 0, "預賽 A 有玩家的狗");
      if (ca.cup.stage === "final") {
        var c0 = prevCup;
        var fin = c0.q1.concat(c0.q2, c0.qr).map(function (e) { return e.name; }).sort();
        assert.deepStrictEqual(ca.names.slice().sort(), fin, "決賽＝預賽前 2×2＋敗部復活前 2");
      }
    }
    if (leg === 1) {
      await clickBtn(A, "買這一輪 WIN5");
      await clickBtn(B, "買這一輪 WIN5");
      await until(A, function () { return Object.keys(window.PriTestSaigo.ui.room.w5Buyers(window.PriTestSaigo.ui.card.w5.ser)).length === 2; }, null, 10000, "兩人都買了");
    }
    // A 選真正的冠軍、B 選最後一名
    var res = await ev(A, function () { var c = window.PriTestSaigo.ui.card; return window.PriTestSaigoCore.simulate(c, false).order; });
    await ev(A, function (g) { document.querySelectorAll(".sg-w5 .sg-pick")[g].click(); }, res[0]);
    await ev(B, function (g) { var x = document.querySelectorAll(".sg-w5 .sg-pick")[g]; if (x) x.click(); }, res[res.length - 1]);
    await until(A, function (a) { var u = window.PriTestSaigo.ui, w = u.card.w5, x = u.room.w5Buyers(w.ser); return Object.keys(x).length === 2 && Object.keys(x).every(function (pid) { return x[pid].picks && x[pid].picks[w.leg] !== undefined; }) || a.leg > 1; }, { leg: leg }, 10000, "兩人都選了");
    if (leg === 2) await A.screenshot({ path: "/tmp/claude-0/-home-user-night/be67c67d-43f3-5efe-9133-302dba7c9278/scratchpad/shots/net_card.png", fullPage: true });
    await clickBtn(B, "準備好了");
    await until(A, function () { return window.PriTestSaigo.ui.room.list().every(function (p) { return p.ready || p.cid === window.PriTestSaigo.ui.room.cid; }); }, null, 10000, "B 準備");
    await until(A, function () { return Array.prototype.some.call(document.querySelectorAll("#sg-app button"), function (x) { return x.textContent.trim() === "開跑！" && !x.disabled; }); }, null, 10000, "A 開跑鍵可以按");
    await clickBtn(A, "開跑！", true);
    await until(A, function () { return window.PriTestSaigo.ui.screen === "result"; }, null, 120000, "A 第 " + leg + " 場結果");
    await until(B, function () { return window.PriTestSaigo.ui.screen === "result"; }, null, 30000, "B 第 " + leg + " 場結果");
    var ord = await ev(A, function () { return window.PriTestSaigo.ui.result.order; });
    assert.deepStrictEqual(ord, res, "結果＝事先模擬");
    assert.deepStrictEqual(await ev(B, function () { return window.PriTestSaigo.ui.result.order; }), ord, "兩邊結果一致");
    await until(A, function (l) { var w = window.PriTestSaigo.ui.room.w5; return w && w.res && w.res[l] !== undefined && w.res[l] !== null; }, leg, 10000, "WIN5 記下第 " + leg + " 場");
    if (ca.cup) {
      await until(A, function (st) { var c = window.PriTestSaigo.ui.room.cup; return c && c.stage !== st; }, ca.cup.stage, 10000, "大會晉級");
      prevCup = await ev(A, function () { return window.PriTestSaigo.ui.room.cup; });
      if (ca.cup.stage === "final") {
        assert.strictEqual(prevCup.stage, "done");
        var champ = await ev(A, function () { var u = window.PriTestSaigo.ui; return u.card.dogs[u.result.order[0]].name; });
        assert.strictEqual(prevCup.champ.name, champ, "大會冠軍＝決賽第 1 名");
        await A.screenshot({ path: "/tmp/claude-0/-home-user-night/be67c67d-43f3-5efe-9133-302dba7c9278/scratchpad/shots/net_final.png", fullPage: true });
      }
    }
    if (leg < 5) await clickBtn(A, "發佈下一場");
  }
  await until(A, function () { var w = window.PriTestSaigo.ui.room.w5; return w && w.last && w.last.ser === 1; }, null, 10000, "WIN5 結算");
  var last = await ev(A, function () { var r = window.PriTestSaigo.ui.room; return { last: r.w5.last, me: r.pid, carry: r.w5.carry }; });
  assert.strictEqual(last.last.pot, 1400, "彩池＝2 × 1000 × 70%");
  assert.deepStrictEqual(last.last.win.map(function (x) { return x.pid; }), [last.me], "只有 A 全中");
  assert.strictEqual(last.carry, 0);
  await until(A, function () { return document.querySelector(".sg-w5") && document.querySelector(".sg-w5").textContent.indexOf("全中") >= 0; }, null, 10000, "A 結果畫面顯示全中");
  await A.screenshot({ path: "/tmp/claude-0/-home-user-night/be67c67d-43f3-5efe-9133-302dba7c9278/scratchpad/shots/net_w5.png", fullPage: true });
  var errs = A.errors.concat(B.errors).filter(function (e) { return e.indexOf("favicon") < 0; });
  assert.deepStrictEqual(errs, [], "沒有錯誤");
  console.log("saigo cup_net_check OK（A 籌碼 " + a0 + " → " + (await ev(A, function () { return window.PriTestSaigo.ui.room.coins(); })) + "）");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
