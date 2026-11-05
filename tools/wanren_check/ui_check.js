// ============================================================================
// 萬人迷（wanren）Playwright 流程檢查：
//   標題（3D 校園載入）→ 新遊戲（1 學年）→ 入學典禮 → 早上回應迷妹 → 上課 → 自由時間（3D：走動的學生、女主角、快速前往、搭話、聊天）
//   → 購買部買禮物 → 放學 → 晚上 → 睡覺到第 2 天 → 用 core 快轉到學期末 → 報告畫面 → 日文沒有漏翻的 wr_ 鍵
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8951 --directory dist
// 執行：node tools/wanren_check/ui_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var pw;
try { pw = require("playwright"); } catch (e) { pw = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })); }
var chromium = pw.chromium;

var BASE = process.env.WANREN_BASE || "http://localhost:8951/wanren/index.html";
var SHOT_DIR = process.env.WANREN_SHOTS || path.join(__dirname, "shots");

async function clickText(page, label, partial) {
  var ok = await page.evaluate(function (a) {
    var b = Array.prototype.filter.call(document.querySelectorAll("#wr-app button, .wr-modal button"), function (x) {
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
function st(page) { return page.evaluate(function () { var s = window.PriTestWanren.state; return s && { day: s.day, phase: s.phase, stats: s.stats, ap: s.today && s.today.ap, apMax: s.today && s.today.apMax }; }); }
// 隨機事件（每天早上有機率）會先蓋在畫面上：有的話選第一個選項
async function clearEvents(page) {
  for (var i = 0; i < 5; i++) {
    await closeMsg(page);
    var n = await page.evaluate(function () { return window.PriTestWanren.state.events.length; });
    if (!n) return;
    await page.locator(".wr-event .wr-btn-opt").first().click();
    await page.waitForTimeout(100);
  }
}
async function closeMsg(page) { await page.evaluate(function () { var m = document.querySelector(".wr-msg"); if (m) m.click(); }); await page.waitForTimeout(80); }

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  var page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", function (d) { d.accept(); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-wanren-save"); });
  await page.reload();
  await page.waitForFunction(function () { return window.PriTestWanren && window.PriTestWanren.view(); }, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOT_DIR, "01_title.png") });

  // 新遊戲
  await page.fill(".wr-input", "測試君");
  await clickText(page, "1 學年", true);
  await clickText(page, "開始新的學期", true);
  var s = await st(page);
  assert.strictEqual(s.phase, "morning");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestWanren.state.length; }), 232);
  assert.strictEqual(await page.evaluate(function () { return window.PriTestWanren.state.today.kind; }), "entrance", "第一天是入學典禮");
  await clearEvents(page);
  var nAdm = await page.locator(".wr-adm").count();
  assert.ok(nAdm >= 2, "早上應該有迷妹");
  var charm0 = s.stats.charm;
  await page.locator(".wr-adm .wr-btn-pink").first().click();
  await page.waitForTimeout(100);
  s = await st(page);
  assert.ok(s.stats.charm > charm0, "回應迷妹魅力應上升");
  await closeMsg(page);
  await page.screenshot({ path: path.join(SHOT_DIR, "02_morning.png") });
  // 入學典禮沒有課，直接進入自由時間（行動點 6，晴天的假日 +1）；早上的社團招募選第一個（運動社團）
  await clickText(page, "去學校逛逛", true);
  await clearEvents(page);
  s = await st(page);
  assert.strictEqual(s.phase, "free");
  assert.strictEqual(s.ap, s.apMax);
  // 期望值從狀態推算：基本 6、入學典禮固定晴天的假日 +1，再加上迷妹選項的增減（「陪她去吃冰」會 −2）
  var apBonus = await page.evaluate(function () { return window.PriTestWanren.state.today.apBonus; });
  assert.strictEqual(s.ap, Math.max(1, 7 + apBonus), "入學典禮的行動點：" + s.ap + "（apBonus " + apBonus + "）");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestWanren.state.club; }), "sports", "社團招募選了運動社團");
  var ap0 = s.ap;
  await clearEvents(page);

  // 3D：學生、女主角
  var dbg = await page.evaluate(function () { return window.PriTestWanren.view()._debug(); });
  assert.ok(dbg.students >= 18, "應該有走動的學生");
  assert.ok(dbg.heroines.length >= 5, "今天應該有女主角在校園：" + dbg.heroines.length);
  // 找一個今天有人在的地點，快速前往
  var target = await page.evaluate(function () {
    var W = window.PriTestWanren, S = W.state;
    var ls = window.PriTestWanrenData.LOCATIONS.filter(function (l) { return W.core.heroinesAt(S, l.id).length; });
    return { loc: ls[0].id, name: window.PriTestWanrenData.L(ls[0].name), hid: W.core.heroinesAt(S, ls[0].id)[0] };
  });
  await clickText(page, target.name, true);
  // 所在地點是 3D 的畫面迴圈更新的：軟體算圖很慢，等到更新為止（不要用固定時間）
  await page.waitForFunction(function (l) { return window.PriTestWanren.view()._debug().loc === l; }, target.loc, { timeout: 20000 });
  dbg = await page.evaluate(function () { return window.PriTestWanren.view()._debug(); });
  assert.strictEqual(dbg.loc, target.loc, "快速前往後應該在 " + target.loc);
  assert.ok(await page.locator(".wr-hcard").count() >= 1, "地點面板應顯示女主角");
  await page.screenshot({ path: path.join(SHOT_DIR, "03_free_loc.png") });
  await clickText(page, "上前搭話", true);
  var met = await page.evaluate(function (h) { return window.PriTestWanren.state.h[h].met; }, target.hid);
  assert.ok(met, "搭話後應該相遇");
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT_DIR, "04_meet.png") });
  await closeMsg(page);
  // 2026-11-03：行動後有機率觸發校園遭遇，且同一地點的人變多（第一張卡不一定是剛認識的人）
  // → 先清掉事件，再找有「聊天」鍵（已認識）的卡片
  await clearEvents(page);
  await page.locator(".wr-hcard", { has: page.locator("button", { hasText: "聊天" }) }).first().locator("button", { hasText: "聊天" }).click();
  await page.locator(".wr-btn-topic").first().click();
  await page.waitForTimeout(100);
  s = await st(page);
  assert.strictEqual(s.ap, ap0 - 2);
  await closeMsg(page);
  // 成就：第一次見面
  assert.ok(await page.evaluate(function () { return !!window.PriTestWanren.core.loadMeta().ach.meet1; }), "應該解鎖「初次見面」");
  // 學生餐廳的購買部
  // 聊天（用掉行動點）後有 20% 機率觸發校園遭遇，事件畫面會蓋住「快速前往」：先清掉（2026-11-05 修正偶發失敗）
  await clearEvents(page);
  await clickText(page, "學生餐廳", true);
  await page.waitForFunction(function () { return window.PriTestWanren.ui.loc === "cafeteria"; }, null, { timeout: 20000 });
  await clickText(page, "購買部", true);
  var money0 = (await st(page)).stats.money;
  await page.locator(".wr-shop-item button").first().click();
  await page.waitForTimeout(100);
  assert.ok((await st(page)).stats.money < money0, "買東西應扣錢");
  await page.screenshot({ path: path.join(SHOT_DIR, "05_shop.png") });
  await page.click(".wr-modal-x");
  // 鍵盤移動
  var p0 = (await page.evaluate(function () { return window.PriTestWanren.view()._debug(); })).player;
  // swiftshader 軟體算圖每秒只有幾格（dt 上限 0.05 秒），按久一點、門檻放寬
  await page.keyboard.down("w"); await page.waitForTimeout(1500); await page.keyboard.up("w");
  var p1 = (await page.evaluate(function () { return window.PriTestWanren.view()._debug(); })).player;
  assert.ok(Math.abs(p1.z - p0.z) + Math.abs(p1.x - p0.x) > 0.3, "WASD 應該能移動");
  await clickText(page, "放學回家", true);
  s = await st(page);
  assert.strictEqual(s.phase, "evening");
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(SHOT_DIR, "06_evening.png") });
  await clickText(page, "早點睡", true);
  await closeMsg(page);
  await clickText(page, "睡覺", true);
  s = await st(page);
  assert.strictEqual(s.day, 1);
  assert.strictEqual(s.phase, "morning");
  // 第 2 天是平日：要上課
  await clearEvents(page);
  await clickText(page, "去上課", true);
  await clearEvents(page);
  await clickText(page, "認真聽講", true);
  s = await st(page);
  assert.strictEqual(s.phase, "free");
  assert.strictEqual(s.ap, s.apMax);
  assert.ok(s.ap >= 2 && s.ap <= 4, "平日的行動點（天氣、考試週會減少）：" + s.ap);
  // 3D 的季節：大一春天
  assert.strictEqual(await page.evaluate(function () { return window.PriTestWanren.view()._debug().season; }), "spring");
  // 校園遭遇（走路觸發的事件，這裡直接呼叫）
  await clearEvents(page);   // encounter() 在有排隊事件時不會觸發
  var encOk = await page.evaluate(function () { var W = window.PriTestWanren; var ok = W.core.encounter(W.state, null); W.render(); return ok; });
  assert.ok(encOk, "encounter 應該成功");
  assert.strictEqual(await page.locator(".wr-event").count(), 1, "遭遇事件應該出現");
  await page.locator(".wr-event .wr-btn-opt").first().click();
  await closeMsg(page);
  // 約會：多題（直接安排今晚的約會，從晚上開始）
  var dateHid = await page.evaluate(function () {
    var W = window.PriTestWanren, S = W.state, C = W.core;
    var hid = window.PriTestWanrenData.HEROINES.filter(function (h) { return S.h[h.id].met; })[0].id;
    S.today.date = hid; C.endFree(S); W.render();
    return hid;
  });
  await page.locator(".wr-grid2 .wr-btn-card").first().click();
  await page.waitForTimeout(100);
  var nq = await page.evaluate(function () { return window.PriTestWanren.state.today.dateRun.list.length; });
  assert.ok(nq >= 2, "約會應該有 2 題以上：" + nq);
  await page.screenshot({ path: path.join(SHOT_DIR, "05b_date.png") });
  for (var q = 0; q < nq; q++) { await page.locator(".wr-event .wr-btn-opt").first().click(); await page.waitForTimeout(80); await closeMsg(page); }
  s = await st(page);
  assert.strictEqual(s.phase, "night", "答完約會應該進入深夜");
  await clickText(page, "睡覺", true);
  await clearEvents(page);

  // 用 core 快轉到學期末（跟 tools 的模擬同一種策略）
  await page.evaluate(function () {
    var W = window.PriTestWanren, C = W.core, S = W.state, D = window.PriTestWanrenData;
    var guard = 0;
    while (S.phase !== "report" && guard++ < 30000) {
      if (S.phase === "yearreport") { C.nextYear(S); continue; }
      while (S.events.length) C.resolveEvent(S, 0);
      if (S.phase === "morning") { S.today.admirers.forEach(function (a, i) { C.answerAdmirer(S, i, i % 3); }); C.finishMorning(S); continue; }
      if (S.phase === "class") { C.doClass(S, S.stats.stamina < 30 ? "doze" : "focus"); continue; }
      if (S.phase === "exam") { C.doExam(S, true); continue; }
      if (S.phase === "free") {
        D.LOCATIONS.forEach(function (l) {
          C.locQuests(S, l.id).forEach(function (h) { C.doQuest(S, h, l.id); });
          C.heroinesAt(S, l.id).forEach(function (h) {
            if (S.today.ap <= 0) return;
            if (C.canConfess(S, h)) { C.confess(S, h); return; }
            var q = C.questOf(S, h);
            if (q && C.reqMet(S, q.req, l.id)) { C.doQuest(S, h, l.id); return; }
            if (q && q.req.type === "item" && S.stats.money > D.ITEM_BY_ID[q.req.item].price) C.buy(S, q.req.item);
            if (!S.today.date && C.canInvite(S, h)) { C.invite(S, h); return; }
            var tp = C.talkTopics(S, h);
            C.talk(S, h, tp.filter(function (x) { return C.topicPref(h, x) === "like"; })[0] || tp[0]);
          });
        });
        C.endFree(S); continue;
      }
      if (S.phase === "evening") {
        if (S.today.date) { var r = C.startDate(S, "library"); if (r && r.moment) { while (C.dateMoment(S)) C.answerDate(S, D.HEROINE_BY_ID[S.today.date].moment); } else C.cancelDate(S); }
        if (S.phase === "evening") C.doEvening(S, S.stats.money < 3000 ? "work" : "rest");
      }
      if (S.phase === "night" || S.phase === "evening") C.endDay(S);
    }
    C.save(S); W.render();
  });
  s = await st(page);
  assert.strictEqual(s.phase, "report");
  await page.waitForTimeout(1800);
  assert.ok(await page.locator(".wr-rep-title").count() === 1, "應該有稱號");
  // 2026-11-03：追加 50 人後，報告列出「主要 15 人＋已認識的追加角色」（舊值 15 已過時）
  var repRows = await page.evaluate(function () {
    var W = window.PriTestWanren, D = window.PriTestWanrenData;
    return W.core.report(W.state).rows.filter(function (x) { return x.met || !D.HEROINE_BY_ID[x.id].ext; }).length;
  });
  assert.ok(repRows >= 15, "報告至少要有主要 15 人");
  assert.strictEqual(await page.locator(".wr-rep-row").count(), repRows);
  await page.screenshot({ path: path.join(SHOT_DIR, "07_report.png"), fullPage: true });
  var rep = await page.evaluate(function () { var r = window.PriTestWanren.core.report(window.PriTestWanren.state); return { title: r.title, rank: r.rank, grade: r.grade, lovers: r.lovers, exams: r.exams.length }; });
  console.log("report:", JSON.stringify(rep));
  assert.strictEqual(rep.exams, 4, "1 學年應該考過春秋兩學期的期中與期末");

  // 完整版：3 學年的行事曆、學年中間報告 → 進入下一學年
  var calInfo = await page.evaluate(function () {
    var c = window.PriTestWanren.core.buildCal("full"), kinds = {};
    c.forEach(function (d) { kinds[d.kind] = (kinds[d.kind] || 0) + 1; });
    return { n: c.length, kinds: kinds, last: c[c.length - 1].kind };
  });
  assert.strictEqual(calInfo.n, 696);
  assert.strictEqual(calInfo.last, "graduation");
  ["entrance", "newyear", "sports", "summerfest", "festival", "xmas", "valentine", "midterm", "final"].forEach(function (k) { assert.ok(calInfo.kinds[k] > 0, "完整版應該有 " + k); });
  assert.strictEqual(calInfo.kinds.midterm, 6);
  await page.evaluate(function () {
    var W = window.PriTestWanren, C = W.core;
    var S = C.newGame({ length: "full", name: "三年君" });
    var g = 0;
    while (S.phase !== "yearreport" && g++ < 5000) {
      S.events = [];
      if (S.phase === "morning") C.finishMorning(S);
      else if (S.phase === "class") C.doClass(S, "normal");
      else if (S.phase === "exam") C.doExam(S, false);
      else if (S.phase === "free") C.endFree(S);
      else if (S.phase === "evening") C.doEvening(S, "rest");
      else C.endDay(S);
    }
    C.save(S);
  });
  await page.reload();
  await page.waitForFunction(function () { return window.PriTestWanren && window.PriTestWanren.view(); }, null, { timeout: 30000 });
  await clickText(page, "繼續", true);
  assert.strictEqual(await page.evaluate(function () { return window.PriTestWanren.state.phase; }), "yearreport");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, "09_year_report.png") });
  await clickText(page, "進入下一學年", true);
  var ny = await page.evaluate(function () { var S = window.PriTestWanren.state; return { phase: S.phase, kind: S.today.kind, year: window.PriTestWanren.core.cal(S).year, ev: S.events.map(function (e) { return e.type; }) }; });
  assert.deepStrictEqual([ny.phase, ny.kind, ny.year], ["morning", "newyear", 1]);
  assert.ok(ny.ev.indexOf("newyear") >= 0, "新學年應該有事件");
  await page.screenshot({ path: path.join(SHOT_DIR, "10_new_year.png") });

  // 回憶錄（成就／回憶／結局／稱號）
  await clickText(page, "回憶錄", true);
  assert.ok(await page.locator(".wr-ach-item.on").count() >= 3, "應該已解鎖幾個成就");
  await clickText(page, "結局", true);
  await page.screenshot({ path: path.join(SHOT_DIR, "07b_album.png") });
  await clickText(page, "稱號", true);
  assert.ok(await page.locator(".wr-ach-item.on").count() >= 1, "畢業後應該有稱號");
  await page.click(".wr-modal-x");

  // 日文：沒有漏翻的 wr_ 鍵
  await page.evaluate(function () { window.I18N.setLang("ja"); });
  await page.waitForTimeout(300);
  var miss = await page.evaluate(function () {
    var html = document.getElementById("wr-app").innerText;
    return (html.match(/wr_[a-z0-9_]+/g) || []);
  });
  assert.deepStrictEqual(miss, [], "畫面上出現沒翻譯的鍵");
  await page.evaluate(function () { window.I18N.setLang("zh"); });

  // 手機版面
  var mob = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mob.goto(BASE);
  await mob.waitForFunction(function () { return window.PriTestWanren && window.PriTestWanren.view(); }, null, { timeout: 30000 });
  await mob.waitForTimeout(1500);
  var overflow = await mob.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  assert.ok(overflow <= 1, "手機版不應該橫向捲動：" + overflow);
  await mob.screenshot({ path: path.join(SHOT_DIR, "08_mobile.png"), fullPage: true });

  assert.deepStrictEqual(errors, [], "頁面錯誤：" + errors.join("\n"));
  console.log("OK");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
