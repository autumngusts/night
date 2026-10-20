// ============================================================================
// katana 連線對刀檢查（2026-10-20）：Firebase emulator 上 3 個瀏覽器（房主＋2 人）＋1 把 AI 刀
//   建房 → 加入 → 選刀・準備 → 開打 → 各自出牌（只能操作自己的刀）→ 回合交界同步 →
//   三邊結果一致 → 戰績寫回各自刀鞘 → 回到房間 → 第二場中途有人離線（改由 AI 接手）也能打完
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8944 --directory dist
//   3. Firebase emulator（Database＋Auth，見 firebase.json；tools/midnight_check 有 firebase-tools）：
//        tools/midnight_check/node_modules/.bin/firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node tools/katana_check/net_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.KATANA_BASE || "http://localhost:8944/katana/index.html";

async function newPlayer(browser, label, npcId, swordName) {
  var ctx = await browser.newContext();
  await ctx.addInitScript(function () { try { sessionStorage.setItem("pritestRtdbEmulator", "1"); } catch (e) { /* 測試環境 */ } });
  var page = await ctx.newPage();
  page.label = label;
  page.errors = [];
  page.on("pageerror", function (e) { page.errors.push(label + ": " + e); });
  await page.goto(BASE);
  // 刀鞘放一把刀（走正式的匯入路徑）
  await page.evaluate(function (a) {
    var Core = window.PriTestKatanaCore, D = window.PriTestKatanaData;
    var snap = Core.npcSnapshot(Core.byId(D.NPC_SWORDS, a[0]));
    snap.name = a[1]; snap.smith = a[1]; snap.uid = "k" + a[1];
    window.PriTestKatana._scImport([{ uid: "k" + a[1], snap: snap, guest: false, rec: { w: 0, l: 0 }, saved: Date.now() }], "replace");
  }, [npcId, swordName]);
  return page;
}

function net(page) { return page.evaluate(function () { var r = window.PriTestKatana._ui().room; return r ? { id: r.id, cid: r.cid, host: r.isHost(), loaded: r.loaded, n: r.list().length } : null; }); }

async function pickSword(page, name) {
  await page.waitForSelector(".kt-room-sword");
  await page.evaluate(function () {
    var sel = document.querySelector(".kt-room-sword");
    sel.value = sel.options[1].value;
    sel.dispatchEvent(new Event("change"));
  });
  await page.fill(".kt-room-name", name);
  await page.dispatchEvent(".kt-room-name", "change");
  await page.waitForSelector(".kt-room-ready");
  await page.dispatchEvent(".kt-room-ready", "click");
}

function arenaInfo(page) {
  return page.evaluate(function () {
    var du = window.PriTestKatana._ui().duel;
    if (!du || !du.arena) return null;
    var a = du.arena;
    return { over: a.over, round: a.round, time: a.time, winner: a.winner, result: du.result,
      fighters: a.fighters.map(function (f) { return { id: f.id, human: f.human, cid: f.cid, mine: du.net.mine(f.id), queue: f.queue.length, alive: f.alive }; }) };
  });
}

// 自己的刀放一張牌（在畫面上按）
function playMyCard(page) {
  return page.evaluate(function () {
    var box = document.querySelector(".kt-af .kt-af-me");
    if (!box) return null;
    var af = box.closest(".kt-af");
    var b = Array.prototype.filter.call(af.querySelectorAll(".kt-card-btn"), function (x) { return !x.disabled; })[0];
    if (!b) return null;
    b.click();
    return { fid: af.getAttribute("data-fid"), card: b.getAttribute("data-card") };
  });
}

(async function () {
  var browser = await chromium.launch();
  var host = await newPlayer(browser, "host", "hono", "甲");
  var p2 = await newPlayer(browser, "p2", "sato", "乙");
  var p3 = await newPlayer(browser, "p3", "minarai", "丙");
  var all = [host, p2, p3];

  // ---- 建房・加入 ----
  await host.dispatchEvent(".kt-net-create", "click");
  await host.waitForFunction(function () { var r = window.PriTestKatana._ui().room; return r && r.loaded; }, null, { timeout: 20000 });
  var info = await net(host);
  assert.ok(info.host, "creator is host");
  var url = await host.locator(".kt-room-url").inputValue();
  assert.ok(url.indexOf("?room=" + info.id) > 0, "room url");
  // 壞的房間代碼
  await p2.fill(".kt-net-join-input", "nope");
  await p2.evaluate(function () { var b = Array.prototype.filter.call(document.querySelectorAll(".kt-net-entry button"), function (x) { return x.textContent === window.I18N.t("kt_net_join_go"); })[0]; b.click(); });
  assert.strictEqual(await p2.locator(".kt-net-entry .kt-error").count(), 1, "bad room code");
  await p2.goto(url);
  await p3.goto(url);
  for (var i = 0; i < all.length; i++) await pickSword(all[i], ["房主", "二號", "三號"][i]);
  // 房主加一把 AI 刀
  await host.evaluate(function () { window.PriTestKatana._ui().room.setNpc("sato", true); });
  await host.waitForFunction(function () { var r = window.PriTestKatana._ui().room; return r.list().filter(function (p) { return p.ready; }).length === 3 && r.canStart(); }, null, { timeout: 20000 });
  assert.strictEqual(await p2.evaluate(function () { return window.PriTestKatana._ui().room.isHost(); }), false);
  assert.strictEqual(await p2.locator(".kt-room-start").count(), 0, "only host can start");
  await host.dispatchEvent(".kt-room-start", "click");

  // ---- 開打 ----
  for (var j = 0; j < all.length; j++) await all[j].waitForSelector(".kt-arena-canvas", { timeout: 20000 });
  var ai = await arenaInfo(p2);
  assert.strictEqual(ai.fighters.length, 4, "4 fighters");
  assert.strictEqual(ai.fighters.filter(function (f) { return f.mine; }).length, 1, "p2 controls exactly one");
  assert.strictEqual(ai.fighters.filter(function (f) { return !f.human; }).length, 1, "one AI");
  // 其他人的刀沒有可按的手牌
  var foreignBtns = await p2.evaluate(function () {
    return Array.prototype.filter.call(document.querySelectorAll(".kt-af"), function (af) { return !af.querySelector(".kt-af-me"); })
      .reduce(function (n, af) { return n + af.querySelectorAll(".kt-card-btn").length; }, 0);
  });
  assert.strictEqual(foreignBtns, 0, "cannot play others' cards");

  // 倒數結束後各自放牌
  await p2.waitForFunction(function () { var du = window.PriTestKatana._ui().duel; return du.arena.time > 0.3; }, null, { timeout: 15000 });
  var played2 = await playMyCard(p2);
  var played3 = await playMyCard(p3);
  assert.ok(played2 && played3, "played cards");
  assert.ok(await p2.locator(".kt-af-slot-pending").count() >= 1, "pending shown");
  // 房主那邊：過了回合交界，二號的牌進了等待區或已發動
  await host.waitForFunction(function (fid) {
    var a = window.PriTestKatana._ui().duel.arena;
    var f = a.fighters.filter(function (x) { return x.id === fid; })[0];
    return f.queue.length > 0 || a.log.some(function (e) { return e.type === "card" && e.f === fid; }) || !f.alive;
  }, played2.fid, { timeout: 15000 });

  // 對局中途：三邊在同一回合交界的狀態一致（房主寫的就是大家換上的）
  await p3.waitForFunction(function () { return window.PriTestKatana._ui().duel.arena.round >= 3 || window.PriTestKatana._ui().duel.arena.over; }, null, { timeout: 30000 });

  // ---- 打到結束：三邊結果一致 ----
  for (var k = 0; k < all.length; k++) {
    await all[k].waitForFunction(function () { var du = window.PriTestKatana._ui().duel; return du && du.result; }, null, { timeout: 120000 });
  }
  var results = [];
  for (var k2 = 0; k2 < all.length; k2++) results.push((await all[k2].evaluate(function () { return window.PriTestKatana._ui().duel.result; })));
  assert.deepStrictEqual(results[1], results[0], "p2 result == host");
  assert.deepStrictEqual(results[2], results[0], "p3 result == host");
  console.log("match 1:", JSON.stringify({ winner: results[0].winner, placing: results[0].placing, rounds: results[0].rounds }));
  for (var k3 = 0; k3 < all.length; k3++) {
    var sc = await all[k3].evaluate(function () { return window.PriTestKatana._scabbard(); });
    assert.strictEqual(sc.swords[0].rec.w + sc.swords[0].rec.l, 1, all[k3].label + " record written");
  }

  // ---- 回到房間 → 第二場，三號中途離開 ----
  await host.dispatchEvent(".kt-net-back", "click");
  await p2.waitForSelector(".kt-room-start, .kt-room-ready", { timeout: 15000 });
  await host.waitForFunction(function () { return window.PriTestKatana._ui().room.canStart(); }, null, { timeout: 15000 });
  await host.dispatchEvent(".kt-room-start", "click");
  for (var j2 = 0; j2 < all.length; j2++) await all[j2].waitForFunction(function () { var du = window.PriTestKatana._ui().duel; return du && du.no === 2 && du.arena.time > 0.2; }, null, { timeout: 20000 });
  var p3fid = (await arenaInfo(p3)).fighters.filter(function (f) { return f.mine; })[0].id;
  await p3.context().close();
  await host.waitForFunction(function (fid) {
    var f = window.PriTestKatana._ui().duel.arena.fighters.filter(function (x) { return x.id === fid; })[0];
    return !f.human || window.PriTestKatana._ui().duel.arena.over;
  }, p3fid, { timeout: 30000 });
  for (var k4 = 0; k4 < 2; k4++) {
    await all[k4].waitForFunction(function () { var du = window.PriTestKatana._ui().duel; return du && du.no === 2 && du.result; }, null, { timeout: 120000 });
  }
  var r2h = await host.evaluate(function () { return window.PriTestKatana._ui().duel.result; });
  var r2p = await p2.evaluate(function () { return window.PriTestKatana._ui().duel.result; });
  assert.deepStrictEqual(r2p, r2h, "match 2 results agree after disconnect");
  console.log("match 2:", JSON.stringify({ winner: r2h.winner, placing: r2h.placing }));

  // ---- 滿 8 把：房主＋二號＋5 人＋AI 1 把；第 9 人只能觀戰 ----
  await host.dispatchEvent(".kt-net-back", "click");
  var extra = [];
  var npcs = ["minarai", "sato", "hono", "minarai", "sato"];
  for (var e = 0; e < 5; e++) {
    var px = await newPlayer(browser, "x" + e, npcs[e], "客" + e);
    await px.goto(url);
    await pickSword(px, "X" + e);
    extra.push(px);
  }
  await host.waitForFunction(function () { var r = window.PriTestKatana._ui().room; return r.list().filter(function (p) { return p.snap && p.ready; }).length === 7 && r.canStart(); }, null, { timeout: 30000 });
  var ninth = await newPlayer(browser, "ninth", "sato", "九");
  await ninth.goto(url);
  await ninth.waitForFunction(function () { var r = window.PriTestKatana._ui().room; return r && r.loaded && r.list().length >= 8; }, null, { timeout: 20000 });
  await ninth.waitForSelector(".kt-room-sword");
  assert.ok(await ninth.evaluate(function () { return document.querySelector(".kt-room-sword").disabled; }), "9th player can only watch");
  // AI 已經 1 把、人 7 把＝8：房主不能再加 AI
  assert.ok(await host.evaluate(function () {
    return Array.prototype.filter.call(document.querySelectorAll(".kt-room .kt-check input"), function (x) { return !x.checked; }).every(function (x) { return x.disabled; });
  }), "npc boxes disabled at 8");
  await host.dispatchEvent(".kt-room-start", "click");
  var eight = [host, p2].concat(extra, [ninth]);
  for (var q = 0; q < eight.length; q++) {
    await eight[q].waitForFunction(function () { var du = window.PriTestKatana._ui().duel; return du && du.no === 3 && du.result; }, null, { timeout: 150000 });
  }
  var r3 = [];
  for (var q2 = 0; q2 < eight.length; q2++) r3.push(await eight[q2].evaluate(function () { return window.PriTestKatana._ui().duel.result; }));
  assert.strictEqual(r3[0].placing.length, 8, "8 fighters");
  r3.forEach(function (r, i) { assert.deepStrictEqual(r, r3[0], eight[i].label + " agrees (8 blades)"); });
  console.log("match 3 (8 blades):", JSON.stringify({ winner: r3[0].winner, rounds: r3[0].rounds }));

  var errors = host.errors.concat(p2.errors, p3.errors);
  eight.forEach(function (p) { if (p !== host && p !== p2) errors = errors.concat(p.errors); });
  if (errors.length) console.log("ERRORS", errors);
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("katana net_check OK");
})().catch(function (e) { console.error(e); process.exit(1); });
