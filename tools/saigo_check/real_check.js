// ============================================================================
// 賽狗賽狗（saigo）2026-11-02 追加功能的 Playwright 檢查：
//   犬舍：16 種訓練 → 訓練後出現 20 個技能（金 4／罕見 8／一般 8）→ 學習（欄位上限：金 1）→ 技能池 30 分鐘後消失
//   真賽狗（單機）：選模式 → 派 2 隻自己的狗、各自選跑法 → 出走表 8 隻、複勝前 3 名 → 比賽（3D、應援列切換 2 隻、喊「賽狗」指令、沒有改跑法、技能廣播）
//   → 結果：派彩與錢包一致、2 隻狗都有獎金與經驗；日文沒有漏翻
// 前置：py -3 generate.py；py -3 -m http.server 8947 --directory dist
// 執行：node tools/saigo_check/real_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.SAIGO_BASE || "http://localhost:8947/saigo/index.html";
var SHOT_DIR = process.env.SAIGO_SHOTS || path.join(__dirname, "shots");

async function clickText(page, label, partial) {
  var ok = await page.evaluate(function (a) {
    var b = Array.prototype.filter.call(document.querySelectorAll("#sg-app button"), function (x) {
      var s = x.textContent.trim();
      return (a.p ? s.indexOf(a.l) >= 0 : s === a.l) && !x.disabled;
    })[0];
    if (!b) return false;
    b.click();
    return true;
  }, { l: label, p: !!partial });
  assert.ok(ok, "找不到按鈕：" + label);
  await page.waitForTimeout(150);
}
function kennel(page) { return page.evaluate(function () { return JSON.parse(localStorage.getItem("pritest-saigo-kennel")); }); }

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  var page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", function (d) { d.accept(); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); localStorage.setItem("pritest-lang", "zh"); });
  await page.reload();
  await page.waitForSelector(".sg-menu");

  // ---- 犬舍：領養 2 隻 ----
  await clickText(page, "🏠 我的犬舍");
  await page.selectOption(".sg-panel select", "greyhound");
  await page.fill(".sg-panel input.sg-input", "灰影");
  await clickText(page, "領養（第一隻免費）");
  await page.selectOption(".sg-panel select", "whippet");
  await page.fill(".sg-panel input.sg-input", "小惠");
  await clickText(page, "領養", true);
  var store = await kennel(page);
  assert.strictEqual(store.dogs.length, 2);
  assert.ok(store.dogs.every(function (d) { return Array.isArray(d.skills) && d.line; }), "新狗有技能欄與跑線");
  // 訓練種類 16 種
  assert.strictEqual(await page.$$eval(".sg-train button", function (x) { return x.length; }), 16, "訓練 16 種");
  // 選第一隻（灰影），訓練一次 → 技能池 20 個
  await page.evaluate(function () { document.querySelectorAll(".sg-dog-card")[0].click(); });
  await page.waitForTimeout(150);
  await clickText(page, "間歇跑", true);
  store = await kennel(page);
  assert.ok(store.skillPool && store.skillPool.ids.length === 20, "訓練後出現 20 個技能");
  var tiers = await page.evaluate(function () {
    var SK = window.PriTestSaigoSkills, ids = JSON.parse(localStorage.getItem("pritest-saigo-kennel")).skillPool.ids, c = { n: 0, r: 0, g: 0 };
    ids.forEach(function (id) { c[SK.BY_ID[id].tier]++; });
    return c;
  });
  assert.deepStrictEqual(tiers, { n: 8, r: 8, g: 4 }, "金 4／罕見 8／一般 8");
  var poolBefore = store.skillPool.ids.slice();
  // 再訓練一次不會換池
  await clickText(page, "追誘餌", true);
  assert.deepStrictEqual((await kennel(page)).skillPool.ids, poolBefore, "30 分鐘內再訓練不換池");
  // 學金技能：第一個成功、第二個欄位已滿
  await page.evaluate(function () { document.querySelectorAll(".sg-pool-item.sg-skill-g")[0].click(); });
  await page.waitForTimeout(150);
  store = await kennel(page);
  assert.strictEqual(store.dogs[0].skills.length, 1, "學會 1 個金技能");
  assert.strictEqual(store.skillPool.ids.length, 19, "學了就從池裡拿走");
  await page.evaluate(function () { document.querySelectorAll(".sg-pool-item.sg-skill-g")[0].click(); });
  await page.waitForTimeout(150);
  assert.strictEqual((await kennel(page)).dogs[0].skills.length, 1, "金技能欄位上限 1");
  assert.ok((await page.textContent(".sg-msg")).indexOf("欄位已滿") >= 0);
  // 學 2 個罕見、2 個一般
  for (var k = 0; k < 2; k++) {
    await page.evaluate(function () { document.querySelectorAll(".sg-pool-item.sg-skill-r")[0].click(); });
    await page.waitForTimeout(100);
    await page.evaluate(function () { document.querySelectorAll(".sg-pool-item.sg-skill-n")[0].click(); });
    await page.waitForTimeout(100);
  }
  store = await kennel(page);
  assert.strictEqual(store.dogs[0].skills.length, 5, "金 1＋罕見 2＋一般 2");
  assert.ok((await page.textContent(".sg-rating-line")).indexOf("pt") >= 0, "顯示總評分");
  await page.screenshot({ path: path.join(SHOT_DIR, "kennel_skills.png"), fullPage: true });
  // 技能池過期（30 分鐘）
  await page.evaluate(function () { var s = JSON.parse(localStorage.getItem("pritest-saigo-kennel")); s.skillPool.at -= 31 * 60000; localStorage.setItem("pritest-saigo-kennel", JSON.stringify(s)); });
  await page.reload();
  await page.waitForSelector(".sg-menu");
  await clickText(page, "🏠 我的犬舍");
  assert.ok((await page.textContent("#sg-app")).indexOf("目前沒有技能池") >= 0, "30 分鐘後技能池消失");
  assert.strictEqual((await kennel(page)).dogs[0].skills.length, 5, "學會的技能保留");
  await clickText(page, "坡道衝刺", true);
  assert.strictEqual((await kennel(page)).skillPool.ids.length, 20, "再訓練出現新的 20 個");

  // ---- 真賽狗（單機） ----
  await clickText(page, "← 返回");
  await clickText(page, "🏁 單機比賽");
  await clickText(page, "真賽狗", true);
  var chks = await page.$$(".sg-entry-chk input");
  assert.strictEqual(chks.length, 2);
  for (var ci = 0; ci < 2; ci++) {
    await page.evaluate(function (i) { var b = document.querySelectorAll(".sg-entry-chk input")[i]; if (!b.checked) b.click(); }, ci);
    await page.waitForTimeout(150);
  }
  assert.strictEqual(await page.$$eval(".sg-entry-style", function (x) { return x.length; }), 2, "勾選的 2 隻各自選跑法");
  await page.evaluate(function () { document.querySelectorAll(".sg-entry-style")[1].querySelectorAll(".sg-seg-btn")[3].click(); });
  await page.waitForTimeout(150);
  await clickText(page, "產生出賽表");
  await page.waitForSelector(".sg-entries");
  assert.strictEqual(await page.$$eval(".sg-dogrow", function (x) { return x.length; }), 8, "8 隻");
  assert.ok(await page.evaluate(function () { return window.PriTestSaigo.ui.card.dogs.some(function (d) { return d.owner === "me" && d.name === "小惠" && d.style === "oikomi"; }); }), "出賽前選的跑法進了出走表");
  assert.strictEqual(await page.$$eval(".sg-dogrow.sg-mine", function (x) { return x.length; }), 2, "自己的 2 隻");
  var cardInfo = await page.evaluate(function () {
    var u = window.PriTestSaigo.ui, C = window.PriTestSaigoCore, B = window.PriTestSaigoBet;
    return { mode: u.card.mode, placeK: C.placeK(u.card.dogs.length), hit3: B.hit("place", "5", [0, 1, 5, 2, 3, 4, 6, 7]), npcKennel: u.card.dogs.filter(function (d) { return d.cpu; }).every(function (d) { return !!d.ownerName; }), skills: u.card.dogs.some(function (d) { return d.skills.length; }) };
  });
  assert.deepStrictEqual(cardInfo, { mode: "real", placeK: 3, hit3: true, npcKennel: true, skills: true });
  var coins0 = (await kennel(page)).coins;
  await page.click(".sg-pick:nth-child(1)");
  await clickText(page, "加入");
  await page.screenshot({ path: path.join(SHOT_DIR, "real_card.png"), fullPage: true });
  await clickText(page, "開跑！");
  await page.waitForSelector(".sg-stage canvas", { timeout: 15000 });
  await page.waitForFunction(function () { return window.PriTestSaigo.ui.raceT > 2; }, null, { timeout: 15000 });
  assert.strictEqual(await page.$$eval(".sg-ctl-tabs button", function (x) { return x.length; }), 2, "應援列可切換 2 隻");
  assert.ok(await page.$("#sg-mic-btn"), "麥克風按鈕");
  // 喊「賽狗」：送出指令 → 重新模擬 → 指令被套用
  var sh = await page.evaluate(function () {
    var P = window.PriTestSaigo, u = P.ui, ok = P.sendShout(u.ctlDog, u.raceT);
    return { ok: ok, cmds: u.result.cmds.filter(function (c) { return c.a === "shout"; }).length, again: P.sendShout(u.ctlDog, u.raceT) };
  });
  assert.deepStrictEqual(sh, { ok: true, cmds: 1, again: false }, "喊聲送出一次、2 秒內不能連喊");
  var same = await page.evaluate(function () {
    var u = window.PriTestSaigo.ui, C = window.PriTestSaigoCore, r = C.simulate(u.card, true, undefined, u.cmds);
    return JSON.stringify(r.times) === JSON.stringify(u.result.times);
  });
  assert.ok(same, "同一份指令重新模擬結果相同");
  // 切到第二隻：比賽中沒有改跑法的按鈕（跑法開跑後不能改），對第二隻喊聲
  await page.evaluate(function () { document.querySelectorAll(".sg-ctl-tabs button")[1].click(); });
  await page.waitForTimeout(2200);
  var second = await page.evaluate(function () {
    var P = window.PriTestSaigo, u = P.ui, ok = P.sendShout(u.ctlDog, u.raceT);
    return { ok: ok, styleBtns: document.querySelectorAll(".sg-race-style .sg-style-nige").length, dogs: u.result.cmds.map(function (c) { return c.d; }).filter(function (d, i, a) { return a.indexOf(d) === i; }).length };
  });
  assert.deepStrictEqual(second, { ok: true, styleBtns: 0, dogs: 2 }, "第二隻也能喊、沒有改跑法按鈕");
  // 技能發動：左上廣播出現該技能的名稱（2026-11-02）
  var skEv = await page.evaluate(function () {
    var u = window.PriTestSaigo.ui, e = u.result.events.filter(function (x) { return x.k === "skill" && x.t > u.raceT + 0.3; })[0];
    return e ? { t: e.t, name: window.PriTestSaigoSkills.BY_ID[e.x].name.zh } : null;
  });
  assert.ok(skEv, "這場有技能發動");
  await page.waitForFunction(function (t) { return window.PriTestSaigo.ui.raceT > t + 0.3; }, skEv.t, { timeout: 60000 });
  var bannerTxt = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll(".sg-skill-banner"), function (b) { return b.textContent; }).join(" / "); });
  assert.ok(bannerTxt.indexOf(skEv.name) >= 0, "左上廣播「" + skEv.name + "」：" + bannerTxt);
  await page.screenshot({ path: path.join(SHOT_DIR, "real_race.png") });
  await page.evaluate(function () { window.PriTestSaigo.ui.speed = 4; });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SHOT_DIR, "real_race2.png") });
  await clickText(page, "跳到結果");
  await page.waitForSelector(".sg-pay");
  var check = await page.evaluate(function () {
    var ui = window.PriTestSaigo.ui, Bet = window.PriTestSaigoBet;
    return { won: Bet.settle(ui.tickets, ui.result.order).won, rewards: ui.dogRewards.length, prize: ui.dogRewards.reduce(function (a, x) { return a + x.r.prize; }, 0), payPlace: ui.result.order.slice(0, 3) };
  });
  assert.strictEqual(check.rewards, 2, "2 隻狗都結算");
  assert.strictEqual((await kennel(page)).coins, coins0 - 100 + check.won + check.prize, "錢包＝原本 − 下注 + 派彩 + 獎金");
  var placeRows = await page.evaluate(function () { return Array.prototype.filter.call(document.querySelectorAll(".sg-pay tr"), function (r) { return r.textContent.indexOf("複勝") >= 0; })[0].querySelectorAll("td div").length; });
  assert.strictEqual(placeRows, 3, "8 隻出賽：複勝 3 個中獎");
  await page.screenshot({ path: path.join(SHOT_DIR, "real_result.png"), fullPage: true });

  // 日文沒有漏翻
  for (var scr of ["home", "kennel", "setup"]) {
    await page.evaluate(function (s) { window.I18N.setLang("ja"); window.PriTestSaigo.go(s); }, scr);
    var txt = await page.textContent("#sg-app");
    assert.ok(!/sg_\w+/.test(txt), "日文有漏翻（" + scr + "）：" + txt.match(/sg_\w+/));
  }
  await page.evaluate(function () { window.I18N.setLang("zh"); });

  assert.deepStrictEqual(errors, [], "console 錯誤：\n" + errors.join("\n"));
  console.log("saigo real_check OK");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
