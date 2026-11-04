// ============================================================================
// 末日據點（zombie）的瀏覽器檢查（Playwright）。先 python generate.py，再起本機伺服器：
//   python -m http.server 8947 --directory dist
//   node tools/zombie_check/ui_check.js
// 單機：首頁 → 設定 → 規劃（工作、地圖、修建）→ 探索事件卡 → 即時 3D 防守（點殭屍射擊）→ 剩下自動 → 清晨 → 第 2 天；
//       傳承畫面、每日挑戰、日文沒有漏翻、繼續上一局。
// 合作：兩個獨立的瀏覽器（各自的 localStorage＝不同玩家），用 Node 端的假 Firebase（同 rtSet／rtSubscribe 介面）轉送：
//       建房 → 加入 → 房主開始 → 各自分配自己的倖存者（意圖由房主套用）→ 探索 → 房主開即時防守、客人看快照並下修牆指令
//       → 房主剩下自動 → 雙方都到清晨 → 準備好 → 第 2 天。
// ============================================================================
"use strict";
var assert = require("assert");
var path = require("path");
var chromium = require("playwright").chromium;

var BASE = process.env.ZOMBIE_BASE || "http://localhost:8947/zombie/index.html";
var SHOT_DIR = process.env.ZOMBIE_SHOTS || path.join(__dirname, "shots");
require("fs").mkdirSync(SHOT_DIR, { recursive: true });

async function clickText(page, label, partial) {
  var ok = await page.evaluate(function (a) {
    var b = Array.prototype.filter.call(document.querySelectorAll("#zm-app button"), function (x) {
      var s = x.textContent.trim();
      return (a.p ? s.indexOf(a.l) >= 0 : s === a.l) && !x.disabled;
    })[0];
    if (!b) return false;
    b.click();
    return true;
  }, { l: label, p: !!partial });
  assert.ok(ok, "找不到按鈕：" + label);
  await page.waitForTimeout(120);
}
async function noMissingKeys(page, where) {
  var txt = await page.textContent("#zm-app");
  assert.ok(!/zm_\w+/.test(txt), "漏翻（" + where + "）：" + (txt.match(/zm_\w+/g) || []).join(","));
}
// 在可見的畫布裡找一隻殭屍的螢幕位置
function visibleZombie() {
  var Z = window.PriTestZombie, cv = document.querySelector(".zm-canvas");
  if (!cv || !Z.ui.view) return null;
  var rc = cv.getBoundingClientRect(), list = Z.ui.sim ? Z.ui.sim.zs.map(function (z) { return z.id; }) : (Z.ui.room && Z.ui.room.snap ? Z.ui.room.snap.z.map(function (z) { return z[0]; }) : []);
  for (var i = 0; i < list.length; i++) {
    var pos = Z.ui.view.zombiePos(list[i]);
    if (!pos) continue;
    var q = Z.ui.view.screenOf(pos.x, pos.z);
    if (q.x > rc.left + 30 && q.x < rc.right - 30 && q.y > rc.top + 30 && q.y < rc.bottom - 30 && q.y < window.innerHeight - 10) return q;
  }
  return null;
}

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
        window.PriTestZombieFakeGS = {
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

(async function () {
  var browser = await chromium.launch();
  var errors = [];
  function watch(page, tag) {
    page.on("pageerror", function (e) { errors.push(tag + ": " + e); });
    page.on("console", function (m) { if (m.type() === "error") errors.push(tag + ": " + m.text()); });
    page.on("dialog", function (d) { d.accept(); });
  }

  // ======================= 單機 =======================
  var ctx = await browser.newContext({ viewport: { width: 1100, height: 950 } });
  var page = await ctx.newPage();
  watch(page, "solo");
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); localStorage.setItem("pritest-lang", "zh"); });
  await page.reload();
  await page.waitForSelector(".zm-menu");
  await noMissingKeys(page, "home");
  await clickText(page, "單機新遊戲", true);
  await clickText(page, "日本", true);
  await clickText(page, "開始");
  await page.waitForSelector(".zm-surv");
  var s0 = await page.evaluate(function () { var s = window.PriTestZombie.sess.s; return { city: s.city, n: s.surv.length, len: s.len, phase: s.phase }; });
  assert.deepStrictEqual(s0, { city: "jp", n: 4, len: 10, phase: "plan" }, "單機 4 人、日本、10 天");
  await noMissingKeys(page, "plan");
  // 點特質看說明
  await page.click(".zm-trait");
  assert.ok(await page.$(".zm-traitdesc"), "點特質顯示說明");
  // 用畫面操作：第一個人外出、第二個人修建、地圖選便利商店
  await page.evaluate(function () { document.querySelectorAll(".zm-surv")[0].querySelectorAll(".zm-jobs button")[0].click(); });
  await page.waitForTimeout(100);
  await page.evaluate(function () { document.querySelectorAll(".zm-surv")[1].querySelectorAll(".zm-jobs button")[1].click(); });
  await page.waitForTimeout(100);
  await page.click('.zm-map-node[data-d="conv"]');
  await page.waitForTimeout(100);
  var plan = await page.evaluate(function () { var s = window.PriTestZombie.sess.s, v = s.surv; return { a0: v[0].assign, a1: v[1].assign, d: s.plans.me.district }; });
  assert.deepStrictEqual(plan, { a0: "scavenge", a1: "build", d: "conv" }, "工作與區域");
  await page.screenshot({ path: path.join(SHOT_DIR, "solo_plan.png"), fullPage: true });
  // 大門口事件（有的話先處理）
  if (await page.evaluate(function () { return !!window.PriTestZombie.sess.s.gate; })) {
    assert.ok(await page.evaluate(function () { return document.querySelector(".zm-next button.zm-primary").disabled; }), "大門口的事沒處理不能出發");
    await page.evaluate(function () { Array.prototype.filter.call(document.querySelectorAll(".zm-card .zm-choice"), function (b) { return !b.disabled; }).pop().click(); });
    await page.waitForTimeout(100);
  }
  await clickText(page, "出發！");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestZombie.sess.s.phase; }), "explore");
  await page.screenshot({ path: path.join(SHOT_DIR, "solo_card.png"), fullPage: true });
  var cards = 0;
  while (await page.$(".zm-card .zm-choice:not([disabled])")) { await page.click(".zm-card .zm-choice:not([disabled])"); await page.waitForTimeout(100); cards++; if (cards > 5) break; }
  assert.ok(cards >= 2, "翻了 " + cards + " 張事件卡");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestZombie.sess.s.phase; }), "night", "探索完入夜");
  await noMissingKeys(page, "night prep");
  await page.screenshot({ path: path.join(SHOT_DIR, "solo_nightprep.png"), fullPage: true });
  await clickText(page, "即時防守", true);
  await page.waitForSelector(".zm-canvas", { timeout: 20000 });
  // 測試用：拿掉守衛，殭屍才會走進畫面讓我們點（第 1 晚殭屍少，守衛常在畫面外就打光了）
  await page.evaluate(function () { var sim = window.PriTestZombie.ui.sim; window.__guards = [sim.guards, sim.reserve]; sim.guards = []; sim.reserve = []; });
  await page.waitForFunction(visibleZombie, null, { timeout: 40000 });
  var q = await page.evaluate(visibleZombie), shots0 = await page.evaluate(function () { return window.PriTestZombie.ui.sim.shots; });
  await page.mouse.move(q.x, q.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(function () { return window.PriTestZombie.ui.live.okCmd >= 1; }), "點殭屍＝射擊指令成功");
  assert.ok((await page.evaluate(function () { return window.PriTestZombie.ui.sim.shots; })) > shots0, "射擊次數增加");
  // 修牆工具：點牆
  await page.evaluate(function () { document.getElementById("zm-tool-repair").click(); });
  var wall = await page.evaluate(function () { var v = window.PriTestZombie.ui.view; return v.screenOf(0, 12); });
  var mats0 = await page.evaluate(function () { var s = window.PriTestZombie.ui.sim; s.walls[9] = 10; return s.mats; });
  await page.mouse.move(wall.x, wall.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(200);
  var rep = await page.evaluate(function () { var s = window.PriTestZombie.ui.sim; return { mats: s.mats, used: s.matsUsed }; });
  assert.ok(rep.used >= 1 && rep.mats < mats0, "點牆＝修牆（材料 " + mats0 + "→" + rep.mats + "）");
  await page.screenshot({ path: path.join(SHOT_DIR, "solo_night.png") });
  await page.evaluate(function () { var sim = window.PriTestZombie.ui.sim; sim.guards = window.__guards[0]; sim.reserve = window.__guards[1]; sim.core = sim.coreMax; });
  await page.evaluate(function () { document.getElementById("zm-skip").click(); });
  await page.waitForSelector(".zm-big-line", { timeout: 20000 });
  assert.strictEqual(await page.evaluate(function () { return window.PriTestZombie.sess.s.phase; }), "dawn", "天亮了");
  await noMissingKeys(page, "dawn");
  await page.screenshot({ path: path.join(SHOT_DIR, "solo_dawn.png"), fullPage: true });
  await clickText(page, "迎接第 2 天");
  assert.deepStrictEqual(await page.evaluate(function () { var s = window.PriTestZombie.sess.s; return [s.day, s.phase]; }), [2, "plan"]);
  // 存檔與繼續
  await page.reload();
  await page.waitForSelector(".zm-menu");
  await clickText(page, "繼續上一局", true);
  assert.strictEqual(await page.evaluate(function () { return window.PriTestZombie.sess.s.day; }), 2, "繼續上一局＝第 2 天");
  // 自動結算一路玩到結束（確認結局畫面與傳承點數）
  var guard = 0;
  while (guard++ < 200) {
    var ph = await page.evaluate(function () {
      var Z = window.PriTestZombie, s = Z.sess.s;
      if (s.phase === "plan") { if (s.gate) Z.sess.send({ a: "gate", c: D_last(s) }); Z.sess.send({ a: "ready", v: true }); }
      else if (s.phase === "explore") { var c = window.PriTestZombieCore.currentCard(s, Z.sess.pid); if (c) Z.sess.send({ a: "answer", c: c.ch.map(function (o, j) { return window.PriTestZombieCore.reqOk(s, s.explore[Z.sess.pid], o.req) ? j : -1; }).filter(function (j) { return j >= 0; })[0] }); }
      else if (s.phase === "night") Z.autoNight();
      else if (s.phase === "dawn") Z.sess.send({ a: "ready", v: true });
      function D_last(st) { return window.PriTestZombieData.EVENT_BY_ID[st.gate.id].ch.length - 1; }
      return s.phase;
    });
    if (ph === "end") break;
  }
  await page.waitForTimeout(200);
  await noMissingKeys(page, "end");
  var end = await page.evaluate(function () { var s = window.PriTestZombie.sess.s; return { kind: s.end && s.end.kind, pts: window.PriTestZombieCore.loadMeta().pts }; });
  assert.ok(end.kind && end.pts > 0, "結局與傳承點數：" + JSON.stringify(end));
  await page.screenshot({ path: path.join(SHOT_DIR, "solo_end.png"), fullPage: true });
  // 日文
  for (var scr of ["home", "legacy", "help", "setup"]) {
    await page.evaluate(function (x) { window.I18N.setLang("ja"); window.PriTestZombie.go(x); }, scr);
    await noMissingKeys(page, "ja " + scr);
  }
  await page.evaluate(function () { window.I18N.setLang("zh"); window.PriTestZombie.go("home"); });
  // 每日挑戰：同一天同一個種子
  await clickText(page, "每日挑戰", true);
  var d1 = await page.evaluate(function () { return window.PriTestZombie.sess.s.seed; });
  await page.evaluate(function () { window.PriTestZombie.go("home"); });
  await clickText(page, "每日挑戰", true);
  assert.strictEqual(await page.evaluate(function () { return window.PriTestZombie.sess.s.seed; }), d1, "每日挑戰同一天同一個種子");
  await ctx.close();
  console.log("單機 OK");

  // ======================= 合作連線 =======================
  var fb = fakeFirebase();
  var ctxA = await browser.newContext({ viewport: { width: 1100, height: 950 } }), ctxB = await browser.newContext({ viewport: { width: 1100, height: 950 } });
  await fb.attach(ctxA); await fb.attach(ctxB);
  var A = await ctxA.newPage(), B = await ctxB.newPage();
  watch(A, "host"); watch(B, "guest");
  await A.goto(BASE); await fb.sync(A);
  await A.evaluate(function () { localStorage.setItem("pritest-lang", "zh"); localStorage.setItem("pritest-zombie-name", "房主"); });
  await A.reload(); await fb.sync(A);
  await A.waitForSelector(".zm-menu");
  await clickText(A, "合作連線", true);
  await A.waitForSelector(".zm-url");
  var url = await A.inputValue(".zm-url");
  assert.ok(/room=g[0-9a-f]{32}/.test(url), "房間網址");
  await B.goto(BASE); await fb.sync(B);
  await B.evaluate(function () { localStorage.setItem("pritest-lang", "zh"); localStorage.setItem("pritest-zombie-name", "客人"); });
  await B.goto(url); await fb.sync(B);
  await B.waitForSelector(".zm-plist li", { timeout: 10000 });
  await A.waitForFunction(function () { return document.querySelectorAll(".zm-plist li").length === 2; }, null, { timeout: 10000 });
  await noMissingKeys(B, "lobby guest");
  await A.screenshot({ path: path.join(SHOT_DIR, "coop_lobby.png"), fullPage: true });
  await clickText(A, "開始！");
  await B.waitForSelector(".zm-surv", { timeout: 10000 });
  var info = await B.evaluate(function () { var Z = window.PriTestZombie, s = Z.sess.s; return { players: s.players.length, mine: s.surv.filter(function (v) { return v.owner === Z.sess.pid; }).length, host: Z.sess.host }; });
  assert.deepStrictEqual(info, { players: 2, mine: 3, host: false }, "合作：2 人、各 3 名倖存者");
  // 客人：自己的第一個人外出、選區域（意圖送給房主）
  await B.evaluate(function () { document.querySelector(".zm-surv.zm-mine .zm-jobs button").click(); });
  await B.waitForTimeout(300);
  await B.click('.zm-map-node[data-d="homes"]');
  await A.waitForFunction(function () {
    var s = window.PriTestZombie.sess.s, guest = s.players[1].pid;
    return s.plans[guest].district === "homes" && s.surv.some(function (v) { return v.owner === guest && v.assign === "scavenge"; });
  }, null, { timeout: 10000 });
  // 客人不能動房主的人
  var hostSid = await A.evaluate(function () { var s = window.PriTestZombie.sess.s; return s.surv.filter(function (v) { return v.owner === s.players[0].pid; })[0].id; });
  await B.evaluate(function (sid) { window.PriTestZombie.sess.send({ a: "assign", sid: sid, job: "craft" }); }, hostSid);
  await A.waitForTimeout(400);
  assert.notStrictEqual(await A.evaluate(function (sid) { return window.PriTestZombieCore.survById(window.PriTestZombie.sess.s, sid).assign; }, hostSid), "craft", "不能指揮別人的倖存者");
  // 大門口事件：兩人都投票（2026-11-04 改為全員投票）
  if (await A.evaluate(function () { return !!window.PriTestZombie.sess.s.gate; })) {
    await A.evaluate(function () { Array.prototype.filter.call(document.querySelectorAll(".zm-card .zm-choice"), function (b) { return !b.disabled; }).pop().click(); });
    await B.waitForSelector(".zm-voters", { timeout: 10000 });
    assert.ok(await A.evaluate(function () { return !!window.PriTestZombie.sess.s.gate; }), "大門口：一票不夠");
    await B.evaluate(function () { Array.prototype.filter.call(document.querySelectorAll(".zm-card .zm-choice"), function (b) { return !b.disabled; }).pop().click(); });
    await A.waitForFunction(function () { return !window.PriTestZombie.sess.s.gate; }, null, { timeout: 10000 });
  }
  await clickText(A, "結束白天", true);
  await clickText(B, "出發！");
  await B.waitForFunction(function () { return window.PriTestZombie.sess.s.phase === "explore"; }, null, { timeout: 10000 });
  await A.waitForFunction(function () { return window.PriTestZombie.sess.s.phase === "explore"; }, null, { timeout: 10000 });
  // 房主沒派人外出，也看得到客人那一隊的事件卡，並且能投票（2026-11-04）
  var guestPid = await B.evaluate(function () { return window.PriTestZombie.sess.pid; });
  await A.waitForSelector('.zm-card[data-ex="' + guestPid + '"] .zm-choice', { timeout: 10000 });
  assert.ok((await A.textContent("#zm-app")).indexOf("你今天沒有派人外出，但每一隊遇到的事都可以投票") >= 0, "沒派人外出的人看到投票說明");
  await noMissingKeys(A, "explore host");
  var bc = 0;
  while (await B.evaluate(function () { return window.PriTestZombie.sess.s.phase === "explore"; }) && bc < 6) {
    var sel = '.zm-card[data-ex="' + guestPid + '"] .zm-choice:not([disabled])';
    await B.waitForSelector(sel, { timeout: 10000 });
    var step0 = await B.evaluate(function () { var Z = window.PriTestZombie; return Z.sess.s.explore[Z.sess.pid].step; });
    await B.click(sel);
    // 一票不夠：房主那邊看得到客人的票
    await A.waitForFunction(function (pid) { return !!document.querySelector('.zm-card[data-ex="' + pid + '"] .zm-voters'); }, guestPid, { timeout: 10000 });
    assert.strictEqual(await A.evaluate(function () { var Z = window.PriTestZombie, s = Z.sess.s; return s.explore[s.players[1].pid].step; }), step0, "2 人只有 1 票還沒決定");
    if (bc === 0) {
      await A.screenshot({ path: path.join(SHOT_DIR, "coop_vote_host.png"), fullPage: true });
      // 第一張：房主也投（投同一個）＝決定
      await A.click(sel.replace(":not([disabled])", ".zm-on") + ", " + sel);
    } else {
      // 之後：客人（該隊玩家）用「以目前票數決定」
      await clickText(B, "以目前票數決定");
    }
    await B.waitForFunction(function (st) { var Z = window.PriTestZombie, ex = Z.sess.s.explore[Z.sess.pid]; return Z.sess.s.phase !== "explore" || !ex || ex.step > st; }, step0, { timeout: 10000 });
    bc++;
  }
  assert.ok(bc >= 2, "客人那一隊翻了 " + bc + " 張卡");
  var lastVote = await A.evaluate(function () { var s = window.PriTestZombie.sess.s, ex = s.explore[s.players[1].pid]; return ex.log.filter(function (l) { return l.card; })[0].votes; });
  assert.strictEqual(Object.keys(lastVote).length, 2, "第一張卡兩人都投了（日誌有記錄）");
  await A.waitForFunction(function () { return window.PriTestZombie.sess.s.phase === "night"; }, null, { timeout: 10000 });
  await B.waitForSelector(".zm-muted", { timeout: 5000 });
  assert.ok((await B.textContent("#zm-app")).indexOf("等房主開始今晚的防守") >= 0, "客人等房主開防守");
  await clickText(A, "即時防守", true);
  await A.waitForSelector(".zm-canvas", { timeout: 20000 });
  await B.waitForSelector(".zm-canvas", { timeout: 20000 });
  await B.waitForFunction(function () { var r = window.PriTestZombie.ui.room; return r && r.snap && r.snap.t > 1; }, null, { timeout: 20000 });
  // 客人修牆：指令送到房主的模擬
  var used0 = await A.evaluate(function () { var s = window.PriTestZombie.ui.sim; s.walls[3] = 5; return s.matsUsed; });
  await B.evaluate(function () { window.PriTestZombie.nightCmd({ a: "repair", seg: 3 }); });
  await A.waitForFunction(function (u) { return window.PriTestZombie.ui.sim.matsUsed > u; }, used0, { timeout: 10000 });
  await B.screenshot({ path: path.join(SHOT_DIR, "coop_night_guest.png") });
  await A.evaluate(function () { document.getElementById("zm-skip").click(); });
  await A.waitForSelector(".zm-big-line", { timeout: 20000 });
  await B.waitForSelector(".zm-big-line", { timeout: 20000 });
  assert.strictEqual(await B.evaluate(function () { return window.PriTestZombie.sess.s.phase; }), "dawn", "客人也到清晨");
  await clickText(B, "迎接第 2 天");
  await clickText(A, "迎接第 2 天");
  await A.waitForFunction(function () { return window.PriTestZombie.sess.s.day === 2; }, null, { timeout: 10000 });
  await B.waitForFunction(function () { return window.PriTestZombie.sess.s.day === 2 && window.PriTestZombie.sess.s.phase === "plan"; }, null, { timeout: 10000 });
  await noMissingKeys(B, "coop day 2");
  await B.screenshot({ path: path.join(SHOT_DIR, "coop_day2_guest.png"), fullPage: true });
  // 客人重新整理：同一個 pid、還是自己的倖存者
  var bPid = await B.evaluate(function () { return window.PriTestZombie.sess.pid; });
  assert.ok(/room=g[0-9a-f]{32}/.test(await B.evaluate(function () { return location.href; })), "加入後網址帶著房間（重新整理才回得到）");
  // 真的 Firebase 在重新整理（斷線）時會自動移除在線狀態（onDisconnect）；假 Firebase 沒有，這裡手動模擬
  await B.evaluate(function () { window.PriTestZombie.ui.room.close(); });
  await B.reload(); await fb.sync(B);
  await B.waitForSelector(".zm-surv.zm-mine", { timeout: 10000 });
  assert.strictEqual(await B.evaluate(function () { return window.PriTestZombie.sess.pid; }), bPid, "重新整理後還是同一個人");
  // 房主離開：客人接手當房主，用「不等離線的人繼續」推進
  await A.evaluate(function () { window.PriTestZombie.ui.room.close(); });
  await B.waitForFunction(function () { return window.PriTestZombie.sess.host; }, null, { timeout: 10000 });
  await B.waitForSelector("#zm-skip-offline", { timeout: 10000 });
  // 大門口事件：另一人離線，先投一票再「以目前票數決定」（沒有票不能決定）
  if (await B.evaluate(function () { return !!window.PriTestZombie.sess.s.gate; })) {
    assert.ok(!(await B.evaluate(function () { return window.PriTestZombie.sess.send({ a: "force", k: "gate" }) && !window.PriTestZombie.sess.s.gate; })), "沒有票不能決定");
    await B.evaluate(function () { Array.prototype.filter.call(document.querySelectorAll(".zm-card .zm-choice"), function (b) { return !b.disabled; }).pop().click(); });
    await B.waitForTimeout(150);
    await clickText(B, "以目前票數決定");
    assert.ok(await B.evaluate(function () { return !window.PriTestZombie.sess.s.gate; }), "大門口事件決定了");
  }
  await B.evaluate(function () { window.PriTestZombie.sess.send({ a: "ready", v: true }); });
  await B.evaluate(function () { document.getElementById("zm-skip-offline").click(); });
  await B.waitForFunction(function () { var ph = window.PriTestZombie.sess.s.phase; return ph === "explore" || ph === "night"; }, null, { timeout: 10000 });
  // 新房主自己那一隊：投票後用「以目前票數決定」（另一人離線，一票不過半）
  for (var gi = 0; gi < 6 && await B.evaluate(function () { return window.PriTestZombie.sess.s.phase === "explore"; }); gi++) {
    await B.evaluate(function () { var c = document.querySelector(".zm-card .zm-choice:not([disabled])"); if (c) c.click(); });
    await B.waitForTimeout(150);
    await clickText(B, "以目前票數決定");
  }
  await B.waitForFunction(function () { return window.PriTestZombie.sess.s.phase === "night"; }, null, { timeout: 10000 });
  await clickText(B, "自動結算", true);
  await B.waitForFunction(function () { return window.PriTestZombie.sess.s.phase === "dawn" || window.PriTestZombie.sess.s.phase === "end"; }, null, { timeout: 10000 });
  await noMissingKeys(B, "coop new host");
  console.log("合作連線 OK");

  assert.deepStrictEqual(errors, [], "console 錯誤：\n" + errors.join("\n"));
  console.log("zombie ui_check OK");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
