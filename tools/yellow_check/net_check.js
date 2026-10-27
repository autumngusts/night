// ============================================================================
// 黃牌 Yellow Card 連線房間檢查：Firebase emulator 上 3 個瀏覽器（房主＋2 人）
//   建房 → 加入 → 各自選角落與職業（搶同一個位置要失敗）→ 開始 → 各自選目的地（全員選完才開戰）
//   → 戰鬥中各自出牌（不能操作別人的英雄）→ 全員結束回合後敵人行動 → 三邊狀態一致
//   → 有人離線後房主「由我代打」接手 → 房主離線後由下一個人接手房主繼續
//   2026-10-23：房主把右下交給 AI 隊友、設定苦痛等級（AI 由房主代為行動，房主換人後由新房主接手）；戰場標記會同步給其他人
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8945 --directory dist
//   3. Firebase emulator（Database＋Auth，見 firebase.json）：
//        tools/midnight_check/node_modules/.bin/firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node tools/yellow_check/net_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.YELLOW_BASE || "http://localhost:8945/yellow/index.html";

async function newPlayer(browser, label, name) {
  var ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.addInitScript(function (n) {
    try { sessionStorage.setItem("pritestRtdbEmulator", "1"); localStorage.setItem("pritest-yellow-netname", n); localStorage.setItem("pritest-lang", "zh"); } catch (e) { /* 測試環境 */ }
  }, name);
  var page = await ctx.newPage();
  page.label = label;
  page.errors = [];
  page.on("pageerror", function (e) { page.errors.push(label + ": " + e); });
  page.on("console", function (m) { if (m.type() === "error" && !/favicon/.test(m.text())) page.errors.push(label + " console: " + m.text()); });
  return page;
}

function room(page) {
  return page.evaluate(function () {
    var r = window.PriTestYellow.room();
    if (!r) return null;
    return { id: r.id, cid: r.cid, host: r.meta && r.meta.host, status: r.meta && r.meta.status, seats: r.seats, online: Object.keys(r.online || {}).length };
  });
}
function game(page) { return page.evaluate(function () { return window.PriTestYellow.state(); }); }

async function waitFor(page, fn, arg, what, ms) {
  try { await page.waitForFunction(fn, arg, { timeout: ms || 15000 }); }
  catch (e) { throw new Error(page.label + " 等待逾時：" + what); }
}

// 直接呼叫 room（跟按鈕走同一條路徑；畫面點擊另外由 ui_check.js 覆蓋）
function act(page, a) { return page.evaluate(function (x) { return window.PriTestYellow.room().send(x); }, a); }

(async function () {
  var browser = await chromium.launch();
  var A = await newPlayer(browser, "A", "房主阿光");
  var B = await newPlayer(browser, "B", "小貝");
  var C = await newPlayer(browser, "C", "西西");

  // ---- 建房 ----
  await A.goto(BASE);
  await A.evaluate(function () {
    Array.prototype.filter.call(document.querySelectorAll("button"), function (x) { return x.textContent.trim() === window.I18N.t("yc_net_create"); })[0].click();
  });
  await waitFor(A, function () { var r = window.PriTestYellow.room(); return r && r.loaded && r.isHost(); }, null, "建房");
  var ra = await room(A);
  var url = BASE + "?room=" + ra.id;
  await B.goto(url);
  await C.goto(url);
  for (var p of [B, C]) await waitFor(p, function () { var r = window.PriTestYellow.room(); return r && r.loaded; }, null, "加入");
  await waitFor(A, function () { return Object.keys(window.PriTestYellow.room().online).length === 3; }, null, "三人在線");

  // ---- 選座位：A 左上劍士、B 右上法師、C 先搶 B 的位置（要失敗）再坐左下祭司 ----
  await A.evaluate(function () { window.PriTestYellow.room().takeSeat(0, "paladin"); });
  await B.evaluate(function () { window.PriTestYellow.room().takeSeat(1, "mage"); });
  await waitFor(C, function () { var s = window.PriTestYellow.room().seats; return s[0] && s[1]; }, null, "看到 A、B 坐下");
  await C.evaluate(function () { window.PriTestYellow.room().takeSeat(1, "ranger"); });
  await C.waitForTimeout(800);
  var rc = await room(C);
  assert.strictEqual(rc.seats[1].cls, "mage", "別人坐著的位置不能搶");
  await C.evaluate(function () { window.PriTestYellow.room().takeSeat(2, "priest"); });
  await waitFor(A, function () { var s = window.PriTestYellow.room().seats; return s[0] && s[1] && s[2]; }, null, "三個位置");
  // ---- 房主把右下交給 AI、設定苦痛 2（非房主不能改）----
  await B.evaluate(function () { window.PriTestYellow.room().setAiSeat(3, "ranger"); window.PriTestYellow.room().setOpts({ torment: 9 }); });
  await A.evaluate(function () { window.PriTestYellow.room().setAiSeat(3, "druid"); window.PriTestYellow.room().setOpts({ torment: 2, endless: false }); });
  await waitFor(C, function () { var r = window.PriTestYellow.room(); return r.seats[3] && r.seats[3].cid === "ai" && r.opts.torment === 2; }, null, "看到 AI 座位與苦痛 2");
  assert.strictEqual((await room(C)).seats[3].cls, "druid", "AI 座位是房主設定的德魯伊（B 的設定無效）");
  // 大廳畫面：每個角落都要畫出來
  var seatsDrawn = await A.evaluate(function () { return document.querySelectorAll(".yc-lobby .yc-seat").length; });
  assert.strictEqual(seatsDrawn, 4);
  assert.strictEqual(await B.evaluate(function () { return !!document.querySelector(".yc-lobby .yc-primary"); }), false, "非房主沒有開始鈕");

  // ---- 開始 ----
  await A.evaluate(function () { window.PriTestYellow.room().start(); });
  for (var p2 of [A, B, C]) await waitFor(p2, function () { var g = window.PriTestYellow.state(); return g && g.phase === "map"; }, null, "收到對局");
  var g = await game(B);
  assert.strictEqual(g.heroes.filter(Boolean).length, 4);
  assert.strictEqual(g.heroes[3].ctrl, "ai", "右下是 AI");
  assert.strictEqual(g.torment, 2, "苦痛等級帶進對局");
  assert.strictEqual(g.heroes[1].ctrl, (await room(B)).cid, "B 控制右上");
  assert.strictEqual(g.heroes[0].name, "房主阿光");

  // ---- 目的地：各自選自己英雄的（A、B 選了還不會開戰，C 選完才開戰）----
  await act(A, { t: "dest", s: 0, i: 0 });
  await act(B, { t: "dest", s: 1, i: 0 });
  await A.waitForTimeout(800);
  assert.strictEqual((await game(A)).phase, "map", "還有人沒選目的地不該開戰");
  await act(C, { t: "dest", s: 2, i: 0 });
  for (var p3 of [A, B, C]) await waitFor(p3, function () { var g = window.PriTestYellow.state(); return g && g.phase === "battle"; }, null, "進入戰鬥");

  // AI 的目的地由房主代選（不用等）
  assert.ok((await game(A)).log.some(function (e) { return e.t === "battle"; }), "AI 也選好目的地了");

  // ---- 戰場標記：B 標記一個位置，A、C 都看得到 ----
  await B.evaluate(function () { window.PriTestYellow.room().signal({ k: "ping", x: 50, y: 30 }); });
  for (var pp of [A, C]) await waitFor(pp, function () { return window.PriTestYellow.signals().some(function (x) { return x.k === "ping"; }); }, null, "收到 B 的標記");
  await C.evaluate(function () { window.PriTestYellow.room().signal({ k: "emo", e: "👍", s: 2 }); });
  await waitFor(A, function () { return window.PriTestYellow.signals().some(function (x) { return x.k === "emo" && x.e === "👍"; }); }, null, "收到 C 的表情");

  // ---- 看不到別人的手牌：B 切到 A 的分頁只有卡背（戰場上的英雄、敵人照常顯示）----
  await B.evaluate(function () { document.querySelectorAll(".yc-tab")[0].click(); });
  var peek = await B.evaluate(function () {
    return { backs: document.querySelectorAll(".yc-fan .yc-card-back").length, faces: document.querySelectorAll(".yc-fan .yc-card-name").length,
      hand: window.PriTestYellow.state().heroes[0].hand.length, enemies: document.querySelectorAll(".yc-enemy").length };
  });
  assert.ok(peek.backs === peek.hand && peek.faces === 0 && peek.enemies > 0, "B 不應看到 A 的手牌：" + JSON.stringify(peek));
  await B.evaluate(function () { document.querySelectorAll(".yc-tab")[1].click(); });
  assert.ok(await B.evaluate(function () { return document.querySelectorAll(".yc-fan .yc-card-name").length > 0; }), "B 看得到自己的手牌");

  // ---- 不能操作別人的英雄：B 試著替 A 結束回合（房主會拒絕，狀態不變）----
  await act(B, { t: "end", s: 0 });
  await A.waitForTimeout(800);
  assert.strictEqual((await game(A)).heroes[0].done, false, "B 不能結束 A 的回合");

  // ---- 各自用畫面把一張自己用的護盾牌拖到戰場上，再按結束回合 ----
  async function playSelfCard(page, seat) {
    var before = await game(page);
    var pts = await page.evaluate(function () {
      document.querySelector(".yc-fan").scrollIntoView({ block: "end" });
      var slots = Array.prototype.filter.call(document.querySelectorAll(".yc-fan .yc-slot"), function (sl) {
        var c = sl.querySelector(".yc-card");
        return !c.classList.contains("yc-card-off") && /護盾/.test(c.textContent) && !/隊友/.test(c.textContent);
      });
      var slot = slots[0];
      if (!slot) return "none";
      var r = slot.getBoundingClientRect(), from = null;
      for (var fy = 0.75; fy >= 0.3 && !from; fy -= 0.15) {
        for (var fx = 0.15; fx <= 0.85; fx += 0.1) {
          var x = r.left + r.width * fx, y = r.top + r.height * fy, hit = document.elementFromPoint(x, y);
          if (hit && hit.closest && hit.closest(".yc-slot") === slot) { from = { x: x, y: y }; break; }
        }
      }
      return from ? { from: from, to: window.PriTestYellow.arenaToClient(50, 24) } : null;
    });
    if (pts === "none") return null; // 手上剛好沒有自己用的護盾牌
    if (!pts) return false;
    await page.mouse.move(pts.from.x, pts.from.y);
    await page.mouse.down();
    await page.mouse.move(pts.from.x, pts.from.y - 30, { steps: 3 });
    await page.mouse.move(pts.to.x, pts.to.y, { steps: 8 });
    await page.mouse.up();
    await waitFor(page, function (a) { var g = window.PriTestYellow.state(); return g.heroes[a[0]].hand.length < a[1] || g.phase !== "battle"; }, [seat, before.heroes[seat].hand.length], "出牌同步");
    return true;
  }
  // 2026-10-27：舊期望「至少兩人能出護盾牌」靠運氣——祭司起手沒有自己用的護盾牌，法師 8 張裡只有 3 張屏障，
  // 起手沒抽到時就會假失敗（review 時約一半機率）。改成：手上有自己用的護盾牌的人都要出得了，而且至少一人
  var played = 0, tried = 0;
  for (var ps of [[A, 0], [B, 1], [C, 2]]) {
    var res = await playSelfCard(ps[0], ps[1]);
    if (res === null) continue;
    tried++;
    if (res) played++;
  }
  assert.ok(tried >= 1 && played === tried, "手上有護盾牌的人都要能用畫面出牌：" + played + "/" + tried);
  var r0 = (await game(A)).round;
  for (var pe of [[A, 0], [B, 1], [C, 2]]) await act(pe[0], { t: "end", s: pe[1] });
  for (var p4 of [A, B, C]) await waitFor(p4, function (r) { var g = window.PriTestYellow.state(); return g.phase !== "battle" || g.round > r; }, r0, "敵人行動後進入下一回合", 30000);
  // AI 會接著出新回合的牌：等 AI 結束這回合、三邊的紀錄編號一樣再比較
  await waitFor(A, function () { var g = window.PriTestYellow.state(); return g.phase !== "battle" || g.heroes[3].done || g.heroes[3].down; }, null, "AI 結束回合", 30000);
  var seqA = (await game(A)).logSeq;
  for (var p5 of [B, C]) await waitFor(p5, function (n) { return window.PriTestYellow.state().logSeq === n; }, seqA, "狀態同步");
  var ga = await game(A), gb = await game(B), gc = await game(C);
  assert.strictEqual(JSON.stringify(ga), JSON.stringify(gb), "A、B 狀態不一致");
  assert.strictEqual(JSON.stringify(ga), JSON.stringify(gc), "A、C 狀態不一致");
  assert.ok(ga.log.some(function (e) { return e.t === "enemyTurn"; }), "應有敵人行動紀錄");

  // ---- B 重新整理：同一個分頁沿用同一個 cid，還是能操作自己的英雄（2026-10-22 修正：原本每次都換新身分） ----
  var bCid = (await room(B)).cid;
  await B.reload();
  await waitFor(B, function () { var r = window.PriTestYellow.room(); return r && r.loaded && !!window.PriTestYellow.state(); }, null, "B 重新整理後回到房間");
  assert.strictEqual((await room(B)).cid, bCid, "重新整理後 cid 應該不變");
  assert.strictEqual((await game(B)).heroes[1].ctrl, bCid, "重新整理後還是 B 在操作自己的英雄");
  // ---- 房主代打 B 的英雄後，B 按「取回操作」拿回來 ----
  assert.strictEqual(await act(A, { t: "take", s: 1 }), null);
  await waitFor(B, function (c) { return window.PriTestYellow.state().heroes[1].ctrl !== c; }, bCid, "B 的英雄被代打");
  assert.strictEqual(await act(C, { t: "reclaim", s: 1 }), null, "送出本身不報錯（非房主只是排進 in/）");
  await B.evaluate(function () { var tabs = document.querySelectorAll(".yc-tab"); if (tabs[1]) tabs[1].click(); });
  var reclaimLabel = await B.evaluate(function () { return window.I18N.t("yc_reclaim"); });
  await waitFor(B, function (l) { return Array.prototype.some.call(document.querySelectorAll(".yc-hand-info button"), function (x) { return x.textContent === l; }); }, reclaimLabel, "取回操作按鈕出現");
  await B.evaluate(function (l) { Array.prototype.filter.call(document.querySelectorAll(".yc-hand-info button"), function (x) { return x.textContent === l; })[0].click(); }, reclaimLabel);
  await waitFor(A, function (c) { return window.PriTestYellow.state().heroes[1].ctrl === c; }, bCid, "B 取回自己的英雄");
  // C 不能拿走 B 的英雄（C 的 reclaim 已被房主拒絕）
  assert.strictEqual((await game(A)).heroes[1].ctrl, bCid);

  // ---- C 離線 → 房主代打 C 的英雄 ----
  var cCid = (await room(C)).cid;
  await C.close();
  await waitFor(A, function (c) { return !window.PriTestYellow.room().online[c]; }, cCid, "C 離線");
  // 代打按鈕在手牌資訊列（切到 C 的英雄分頁時出現）
  await waitFor(A, function () { return !!window.PriTestYellow.state(); }, null, "狀態");
  await A.evaluate(function () { var tabs = document.querySelectorAll(".yc-tab"); if (tabs[2]) tabs[2].click(); });
  await waitFor(A, function () { return !!document.querySelector(".yc-hand-info .yc-small-btn"); }, null, "代打按鈕出現");
  await A.evaluate(function () { document.querySelector(".yc-hand-info .yc-small-btn").click(); });
  await waitFor(B, function (c) { var g = window.PriTestYellow.state(); return g.heroes[2].ctrl !== c; }, cCid, "代打同步");
  var aCid = (await room(A)).cid;
  assert.strictEqual((await game(B)).heroes[2].ctrl, aCid);

  // ---- 房主 A 離線 → B 接手房主，還能繼續（結束回合會推進）----
  var gNow = await game(B);
  await A.close();
  await waitFor(B, function () { var r = window.PriTestYellow.room(); return r.isHost() && r.game.hostCtrl === r.cid; }, null, "B 接手房主", 20000);
  var gb2 = await game(B);
  assert.strictEqual(gb2.hostCtrl, (await room(B)).cid, "對局的 hostCtrl 改成 B");
  // B 接手 A、C 的英雄後全部結束回合（AI 由新房主 B 代為行動）
  for (var s of [0, 2]) assert.strictEqual(await act(B, { t: "take", s: s }), null);
  var r1 = gNow.round;
  for (var s2 of [0, 1, 2]) {
    var h = (await game(B)).heroes[s2];
    if (h && !h.down && !h.done && (await game(B)).phase === "battle") await act(B, { t: "end", s: s2 });
  }
  await waitFor(B, function (r) { var g = window.PriTestYellow.state(); return g.phase !== "battle" || g.round > r; }, r1, "B 接手後（含 AI）應能推進回合", 30000);

  var errs = B.errors;
  assert.deepStrictEqual(errs, [], errs.join("\n"));
  await browser.close();
  console.log("OK");
})().catch(function (e) { console.error(e); process.exit(1); });
