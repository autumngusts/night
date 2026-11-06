// ============================================================================
// 賽狗賽狗（saigo）生涯養成的畫面檢查（2026-11-05）：
//   首頁 → 生涯養成 → 選犬種開始 → 用真的按鈕玩完一整趟（訓練／休息／二選一事件／技能商店／目標賽走出賽表與比賽畫面）
//   → 中途重新整理，進度還在 → 畢業收進犬舍 → 犬舍：能力固定（沒有訓練按鈕、K.train 回 locked、不能重置）、
//   生涯技能永久有效（假裝過了 1 小時仍帶進出賽資料）、entry 帶 career 旗標
//   → 關卡賽有生涯狗出賽時 CPU 補強（同 seed 比較），沒有生涯狗時出賽表不變
//   → 血統書（2026-11-06）：畢業寫入、選祖先開第二趟（開始加成、第 9 回合繼承事件）、送養寫入／更新、血統書畫面與刪除
// 前置：py -3 generate.py、py -3 -m http.server 8947 --directory dist
// 執行：node tools/saigo_check/career_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;
var BASE = process.env.SAIGO_BASE || "http://localhost:8947/saigo/index.html";
var SHOT_DIR = path.join(__dirname, "shots");

function ev(page, fn, arg) { return page.evaluate(fn, arg); }
function career(page) { return ev(page, function () { return window.PriTestSaigoKennel.career(); }); }
function clickText(page, text) {
  return ev(page, function (x) {
    var b = Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (e) { return !e.disabled && e.textContent.indexOf(x) >= 0; })[0];
    if (!b) throw new Error("找不到按鈕：" + x);
    b.click();
  }, text);
}

(async function () {
  require("fs").mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch();
  var ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.addInitScript(function () {
    try {
      if (!sessionStorage.getItem("sg-init")) {
        sessionStorage.setItem("sg-init", "1");
        localStorage.clear();
        localStorage.setItem("pritest-lang", "zh");
        localStorage.setItem("pritest-saigo-pref", JSON.stringify({ no3d: true }));
      }
    } catch (e) { /* 測試環境 */ }
  });
  var page = await ctx.newPage(), errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", function (d) { d.accept(); });
  await page.goto(BASE);
  await page.waitForSelector(".sg-menu");

  // 開始
  await clickText(page, "🎓 生涯養成");
  await page.waitForSelector(".sg-panel select");
  await page.selectOption(".sg-panel select", "border");
  await page.fill(".sg-panel input.sg-input", "小育");
  await clickText(page, "開始養成");
  await page.waitForSelector(".sg-cr-train");
  var c = await career(page);
  assert.strictEqual(c.turn, 1); assert.strictEqual(c.name, "小育"); assert.strictEqual(c.breed, "border");

  // 第一次訓練
  await page.dispatchEvent('.sg-cr-train[data-train="speed"]', "click");
  await page.waitForTimeout(100);
  c = await career(page);
  assert.ok(c.turn === 2 || c.pending, "訓練後進到下一回合（或先選事件）");
  assert.ok(c.train.spd > 0, "速度成長");
  assert.ok((await page.textContent("#sg-app")).indexOf("衝刺：") >= 0, "顯示訓練結果");
  await page.screenshot({ path: path.join(SHOT_DIR, "career_turn.png"), fullPage: true });
  // 二選一事件（這個 seed 不一定抽得到，直接放一個進存檔）：行動按鈕消失、選第 2 個＝專注 +5、進到下一回合
  if (!c.pending) await ev(page, function () { var K = window.PriTestSaigoKennel, cc = K.career(); cc.pending = "cat"; K.setCareer(cc); window.PriTestSaigo.go("career"); });
  await page.waitForSelector(".sg-cr-event-panel");
  assert.strictEqual(await page.$$eval(".sg-cr-train", function (x) { return x.length; }), 0, "有事件時不能行動");
  var ev0 = await career(page), pend = ev0.pending;
  await page.screenshot({ path: path.join(SHOT_DIR, "career_event.png"), fullPage: true });
  await ev(page, function () { document.querySelectorAll(".sg-cr-event-panel button")[1].click(); });
  await page.waitForTimeout(100);
  var ev1 = await career(page);
  assert.ok(ev1.pending === null && ev1.turn === ev0.turn + 1, "選完事件進到下一回合");
  if (pend === "cat") assert.ok(Math.abs(ev1.train.foc - ev0.train.foc - 5) < 1e-9, "選「忍住，坐下」：專注 +5");

  // 玩到結束
  var guard = 0, races = 0, reloaded = false, choices = 0, learned = 0, order = ["speed", "stamina", "speed", "power", "agility"];
  while (!(c = await career(page)).done && guard++ < 120) {
    if (!reloaded && c.turn >= 5) {
      // 中途重新整理：進度還在
      var before = JSON.stringify(c);
      await page.reload();
      await page.waitForSelector(".sg-menu");
      assert.strictEqual(JSON.stringify(await career(page)), before, "重新整理後生涯不變");
      await clickText(page, "🎓 生涯養成");
      reloaded = true;
      continue;
    }
    await page.waitForSelector(".sg-cr-goals");
    // 技能點夠就學
    var learnBtn = await page.$(".sg-cr-shop-item button[data-skill]:not([disabled])");
    if (learnBtn) { await learnBtn.dispatchEvent("click"); learned++; await page.waitForTimeout(60); continue; }
    if (c.pending) {
      await page.dispatchEvent(".sg-cr-event-panel button", "click");
      choices++;
    } else if (CRgoal(c)) {
      await page.dispatchEvent("#sg-cr-goal", "click");
      await raceFlow(page);
      races++;
    } else if (c.injured || c.energy < 45) {
      await page.dispatchEvent("#sg-cr-rest", "click");
    } else if (c.turn % 6 === 3) {
      await page.dispatchEvent("#sg-cr-race", "click");
      await raceFlow(page);
      races++;
    } else {
      await page.dispatchEvent('.sg-cr-train[data-train="' + order[c.turn % order.length] + '"]', "click");
    }
    await page.waitForTimeout(60);
  }
  c = await career(page);
  if (!c.done) { console.log(JSON.stringify({ turn: c.turn, energy: c.energy, pending: c.pending, injured: c.injured, sp: c.sp, screen: await ev(page, function () { return window.PriTestSaigo.ui.screen; }) })); await page.screenshot({ path: path.join(SHOT_DIR, "career_stuck.png"), fullPage: true }); }
  assert.ok(c.done, "生涯結束");
  assert.ok(reloaded, "有測到重新整理");
  assert.ok(races >= 1, "有跑比賽");
  console.log("   生涯：" + c.turn + " 回合、比賽 " + races + " 場（勝 " + c.wins + "）、目標 " + JSON.stringify(c.goals) + "、事件選擇 " + choices + " 次、學技能 " + learned + " 個、評分合計 " + Object.keys(c.train).reduce(function (a, k) { return a + c.train[k]; }, 0).toFixed(1));

  // 畢業
  await page.waitForSelector(".sg-rating-line");
  assert.ok((await page.textContent("#sg-app")).indexOf("畢業了") >= 0);
  await page.screenshot({ path: path.join(SHOT_DIR, "career_grad.png"), fullPage: true });
  await clickText(page, "收進犬舍");
  await page.waitForSelector(".sg-cr-locked");
  var dog = await ev(page, function () { var K = window.PriTestSaigoKennel, d = K.load().dogs[0]; return { d: d, career: K.career(), train: K.train(d.id, "sprint"), reset: K.resetTraining(d.id), left: K.trainLeft(d), entry: K.entry(d.id, "me", "") }; });
  assert.strictEqual(dog.career, null, "生涯清掉了");
  assert.ok(dog.d.career && dog.d.career.grade, "犬舍的狗有生涯資料");
  assert.deepStrictEqual(dog.train, { locked: true }, "不能訓練");
  assert.strictEqual(dog.reset, false, "不能重置");
  assert.strictEqual(dog.left, 0);
  assert.strictEqual(dog.entry.career, 1, "出賽資料帶 career 旗標");
  assert.strictEqual(await page.$$eval("[data-train]", function (x) { return x.length; }), 0, "犬舍沒有訓練按鈕");
  // 生涯技能永久有效：假裝過了 1 小時
  var perm = await ev(page, function () {
    var K = window.PriTestSaigoKennel, d = K.load().dogs[0], real = Date.now;
    Date.now = function () { return real() + 3600 * 1000; };
    try { return { skills: d.skills.length, entry: K.entry(d.id, "me", "").skills.length }; } finally { Date.now = real; }
  });
  assert.strictEqual(perm.entry, perm.skills, "生涯技能 1 小時後仍有效（" + JSON.stringify(perm) + "）");
  await page.screenshot({ path: path.join(SHOT_DIR, "career_kennel.png"), fullPage: true });

  // CPU 補強：同 seed，生涯狗出賽時 CPU 變強；沒有生涯旗標的出賽表不變
  var boost = await ev(page, function () {
    var K = window.PriTestSaigoKennel, Core = window.PriTestSaigoCore, RL = window.PriTestSaigoReal, d = K.load().dogs[0];
    var e1 = K.entry(d.id, "me", ""), e0 = JSON.parse(JSON.stringify(e1));
    delete e0.career;
    var a = Core.makeCard(4242, [e1], { cls: "open" }), b = Core.makeCard(4242, [e0], { cls: "open" });
    function cpu(card) { return card.dogs.filter(function (x) { return x.cpu; }).map(function (x) { return RL.strength(x.breed, x.train, x.lv); }); }
    var b2 = Core.makeCard(4242, [e0], { cls: "open" });
    return { withC: cpu(a), without: cpu(b), same: JSON.stringify(b.dogs) === JSON.stringify(b2.dogs), me: RL.strength(e1.breed, e1.train, e1.lv) };
  });
  var avg = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
  assert.ok(avg(boost.withC) > avg(boost.without), "生涯狗出賽時 CPU 補強（" + avg(boost.without).toFixed(1) + " → " + avg(boost.withC).toFixed(1) + "，生涯狗 " + boost.me.toFixed(1) + "）");
  assert.ok(boost.same, "沒有生涯狗時出賽表固定");
  // ---- 血統書與繼承（2026-11-06）----
  var ln = await ev(page, function () { return window.PriTestSaigoLineage.list(); });
  assert.strictEqual(ln.length, 1, "畢業寫進血統書");
  assert.ok(ln[0].factors && ln[0].factors.blue && ln[0].factors.red, "有因子");
  assert.strictEqual(await ev(page, function () { return window.PriTestSaigoKennel.load().dogs[0].lineageId; }), ln[0].id, "犬舍的狗記著血統書編號");
  // 選祖先開始第二趟生涯
  await ev(page, function () { window.PriTestSaigo.go("career"); });
  await page.waitForSelector('select[data-parent="crP1"]');
  await page.selectOption('select[data-parent="crP1"]', ln[0].id);
  await page.waitForTimeout(100);
  assert.ok((await page.textContent("#sg-app")).indexOf("開始時的繼承加成") >= 0, "顯示繼承加成預覽");
  await page.selectOption(".sg-panel select:not([data-parent])", "shiba");
  await clickText(page, "開始養成");
  await page.waitForSelector(".sg-cr-train");
  var c2 = await career(page);
  assert.strictEqual(c2.parents.length, 1); assert.strictEqual(c2.parents[0].name, "小育");
  var f0 = ln[0].factors, exp = await ev(page, function (st) { return window.PriTestSaigoLineage.BLUE_START[st]; }, f0.blue.star);
  assert.strictEqual(c2.train[f0.blue.stat], exp, "藍因子的開始加成");
  // 玩到第 9 回合（直接用計算核心，畫面重畫一次），看繼承事件
  await ev(page, function () {
    var K = window.PriTestSaigoKennel, CRm = window.PriTestSaigoCareer, c = K.career(), g = 0;
    while (c.turn < 9 && !c.done && g++ < 40) {
      if (c.pending) { CRm.choose(c, 0); continue; }
      if (CRm.goalNow(c)) CRm.applyRace(c, 0); else if (c.energy < 40) CRm.rest(c); else CRm.train(c, "speed");
    }
    K.setCareer(c);
    window.PriTestSaigo.go("career");
  });
  c2 = await career(page);
  if (c2.turn === 9) {
    await page.waitForSelector(".sg-ln-event");
    assert.strictEqual(c2.inheritLog.length, 1);
    await page.screenshot({ path: path.join(SHOT_DIR, "career_inherit.png"), fullPage: true });
  }
  // 送養：生涯狗更新原本那一筆；一般的狗新增一筆
  await ev(page, function () { var K = window.PriTestSaigoKennel; K.load().coins = 99999; K.save(); K.adopt("corgi", "柯柯"); window.PriTestSaigo.ui.selDog = K.load().dogs[1].id; window.PriTestSaigo.go("kennel"); });
  await page.waitForSelector(".sg-dog-card");
  await clickText(page, "送養");
  await page.waitForTimeout(100);
  ln = await ev(page, function () { return window.PriTestSaigoLineage.list(); });
  assert.strictEqual(ln.length, 2, "一般的狗送養也寫進血統書");
  assert.strictEqual(ln[0].name, "柯柯"); assert.ok(ln[0].factors.blue.star <= 2 && ln[0].factors.red.star === 1, "一般狗的因子較弱");
  await ev(page, function () { window.PriTestSaigo.ui.selDog = window.PriTestSaigoKennel.load().dogs[0].id; window.PriTestSaigo.go("kennel"); });
  await page.waitForSelector(".sg-cr-locked");
  await clickText(page, "送養");
  await page.waitForTimeout(100);
  ln = await ev(page, function () { return window.PriTestSaigoLineage.list(); });
  assert.strictEqual(ln.length, 2, "生涯狗送養是更新原本那一筆");
  // 血統書畫面
  await ev(page, function () { window.PriTestSaigo.go("lineage"); });
  await page.waitForSelector(".sg-ln-card");
  assert.strictEqual(await page.$$eval(".sg-ln-card", function (x) { return x.length; }), 2);
  await page.screenshot({ path: path.join(SHOT_DIR, "lineage.png"), fullPage: true });
  await clickText(page, "刪除");
  await page.waitForTimeout(100);
  assert.strictEqual(await page.$$eval(".sg-ln-card", function (x) { return x.length; }), 1, "刪除");

  assert.deepStrictEqual(errors, [], "沒有錯誤");
  console.log("saigo career_check OK");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });

// 目標賽回合（測試端自己判斷，避免依賴內部函式）
function CRgoal(c) { return c.turn === 8 || c.turn === 16 || c.turn === 24; }
// 出賽表 → 出賽 → 跳到結果 → 回到生涯
async function raceFlow(page) {
  await page.waitForSelector(".sg-entries");
  assert.strictEqual(await page.$$eval(".sg-slip", function (x) { return x.length; }), 0, "生涯比賽沒有下注");
  await clickText(page, "出賽！");
  await page.waitForSelector(".sg-stage");
  await clickText(page, "跳到結果");
  await page.waitForSelector("#sg-cr-back");
  await page.dispatchEvent("#sg-cr-back", "click");
}
