// ============================================================================
// DÉJÀ VU（dejavu）第十二批 Playwright 檢查：玩法與進階條件
//   每日挑戰（套用設定、成績）、下注（扣籌碼、結算）、山道傳說（一對一、圖鑑）、錦標賽（3 站積分、總冠軍）、
//   路線紀錄、進階條件（夜間／天氣變化／輪胎磨耗＋煞車過熱）的比賽畫面，三種語言沒有漏翻。
//   另外在頁面裡直接跑物理：條件全關時與不帶條件的結果完全相同。
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8946 --directory dist
// 執行：node tools/dejavu_check/modes_check.js
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.DEJAVU_BASE || "http://localhost:8946/dejavu/index.html";
var SHOT_DIR = process.env.DEJAVU_SHOTS || path.join(__dirname, "shots");

async function clickText(page, label) {
  var ok = await page.evaluate(function (l) {
    var b = Array.prototype.filter.call(document.querySelectorAll("#dv-app button"), function (x) { return x.textContent.trim() === l && !x.disabled; })[0];
    if (!b) return false;
    b.click();
    return true;
  }, label);
  assert.ok(ok, "找不到按鈕：" + label);
}
async function clickKey(page, key, params, prefix) {
  var label = await page.evaluate(function (a) { return window.I18N.t(a[0], a[1]); }, [key, params || {}]);
  await clickText(page, (prefix || "") + label);
}
async function noRawKeys(page, where) {
  var raw = await page.evaluate(function () { return (document.getElementById("dv-app").innerText.match(/dv_[a-zA-Z_]+/g) || []); });
  assert.deepStrictEqual(raw, [], where + " 有漏翻的鍵：" + raw.join(","));
}
function setup(page) { return page.evaluate(function () { return window.PriTestDejavu.setup(); }); }
// 開跑 → 跳到結果
async function raceToResult(page) {
  await clickKey(page, "dv_go");
  await page.waitForFunction(function () { var r = window.PriTestDejavu.race(); return r && window.PriTestDejavu.ui().screen === "race"; });
  await clickKey(page, "dv_skip");
  await page.waitForFunction(function () { return window.PriTestDejavu.ui().screen === "result"; }, null, { timeout: 60000 });
  return page.evaluate(function () { return { res: window.PriTestDejavu.result(), post: window.PriTestDejavu.post() }; });
}
// 改存檔裡的某些欄位（先讓 App 建好完整 setup，再只改需要的欄位）
async function patchSetup(page, patch) {
  await page.evaluate(function (p) {
    var s = JSON.parse(localStorage.getItem("pritest-dejavu-setup"));
    Object.keys(p).forEach(function (k) { s[k] = p[k]; });
    localStorage.setItem("pritest-dejavu-setup", JSON.stringify(s));
  }, patch);
  await page.reload();
  await page.waitForFunction(function () { return !!window.PriTestDejavu; });
}

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () {
    ["setup", "records", "legends", "wallet", "daily"].forEach(function (k) { localStorage.removeItem("pritest-dejavu-" + k); });
  });
  await page.reload();
  await page.waitForFunction(function () { return !!window.PriTestDejavu && !!window.PriTestDejavuModes; });

  // ---- 物理：條件全關＝跟以前一樣；開了會有效果 ----
  var phys = await page.evaluate(function () {
    var Core = window.PriTestDejavuCore;
    function sp(id, tire) { return { car: id, tire: tire || "sport", style: "balanced", up: {} }; }
    var base = { course: Core.fixedCourse("akina"), season: "summer", dir: "down", mode: "battle", rule: "real", seed: 777, upPts: 6,
      cars: [{ spec: sp("ae86") }, { spec: sp("r35", "soft") }, { spec: sp("b_r1m") }] };
    function run(extra) {
      var o = Object.assign({}, base, extra);
      var r = Core.runToEnd(Core.createRace(o));
      return { res: Core.results(r).map(function (x) { return [x.id, x.time, x.state, x.overtakes]; }), ev: r.events };
    }
    var a = run({}), b = run({ night: false, wx: false, wear: false }), n = run({ night: true }), w = run({ wx: true }), t = run({ wear: true });
    var tr = Core.results(Core.runToEnd(Core.createRace(Object.assign({}, base, { wear: true }))));
    return {
      same: JSON.stringify(a.res) === JSON.stringify(b.res),
      nightSlower: n.res.reduce(function (s, x) { return s + (x[1] || 0); }, 0) > a.res.reduce(function (s, x) { return s + (x[1] || 0); }, 0),
      weather: w.ev.filter(function (e) { return e.type === "weather"; }).length,
      wearCols: tr.every(function (x) { return x.wear >= 0 && x.brake >= 0; }),
      wearNone: Core.results(Core.runToEnd(Core.createRace(base))).every(function (x) { return x.wear === null; })
    };
  });
  assert.ok(phys.same, "條件全關時結果要跟不帶條件時一樣");
  assert.ok(phys.nightSlower, "夜間總時間應該比較慢");
  assert.strictEqual(phys.weather, 1, "天氣變化要剛好發生一次");
  assert.ok(phys.wearCols && phys.wearNone, "磨耗欄位只在開啟時出現");

  // ---- 設定畫面：玩法面板、進階條件 ----
  await noRawKeys(page, "設定");
  assert.ok(await page.$(".dv-mode-grid"), "要有玩法面板");
  var conds = await page.$$(".dv-cond input");
  assert.strictEqual(conds.length, 3);
  await page.screenshot({ path: path.join(SHOT_DIR, "modes_setup.png"), fullPage: true });

  // ---- 每日挑戰 ----
  await clickKey(page, "dv_daily_go");
  var s = await setup(page), d = await page.evaluate(function () { var M = window.PriTestDejavuModes; return M.daily(M.today()); });
  assert.strictEqual(s.course.src, d.course); assert.strictEqual(s.seed, d.seed); assert.strictEqual(s.piCap, d.piCap);
  assert.strictEqual(s.night, d.night); assert.strictEqual(s.wx, d.wx); assert.strictEqual(s.wear, d.wear); assert.strictEqual(s.mode, "attack");
  assert.ok(await page.$(".dv-banner"), "車庫要顯示每日挑戰橫幅");
  var out = await raceToResult(page);
  var human = out.res.filter(function (r) { return !r.cpu && r.state === "fin"; });
  if (human.length) {
    assert.ok(out.post.daily && out.post.daily.newBest, "第一次完賽要是今日最佳");
    assert.ok(out.post.record, "第一次完賽也是路線紀錄");
  }
  await noRawKeys(page, "每日挑戰結果");
  await page.screenshot({ path: path.join(SHOT_DIR, "modes_daily_result.png"), fullPage: true });

  // ---- 下注 ----
  await patchSetup(page, { daily: null, piCap: 0, night: false, wx: false, wear: false, mode: "battle", cpu: 3, cpuCars: null });
  await page.evaluate(function () { window.PriTestDejavu.go("garage"); });
  var chips0 = await page.evaluate(function () { return window.PriTestDejavuModes.wallet().chips; });
  await page.evaluate(function () { document.querySelector(".dv-bet summary").click(); });
  await page.evaluate(function () { document.querySelectorAll(".dv-betlist button")[1].click(); });
  assert.ok(await page.$(".dv-betlist li.dv-on"), "選了要亮起來");
  out = await raceToResult(page);
  assert.ok(out.post.bet, "要有下注結算");
  var chips1 = await page.evaluate(function () { return window.PriTestDejavuModes.wallet().chips; });
  assert.strictEqual(chips1, out.post.bet.rescued ? 300 : chips0 - out.post.bet.amount + out.post.bet.pay, "籌碼計算");
  // Déjà vu 重播不能下注
  await page.evaluate(function () { document.querySelectorAll(".dv-betlist button")[0].click(); });
  await clickKey(page, "dv_dejavu");
  await page.waitForFunction(function () { return window.PriTestDejavu.ui().screen === "race"; });
  var chips2 = await page.evaluate(function () { return window.PriTestDejavuModes.wallet().chips; });
  assert.strictEqual(chips2, chips1, "Déjà vu 重播不扣籌碼");
  await clickKey(page, "dv_skip");
  await page.waitForFunction(function () { return window.PriTestDejavu.ui().screen === "result"; }, null, { timeout: 60000 });
  out = await page.evaluate(function () { return { post: window.PriTestDejavu.post() }; });
  assert.ok(!out.post.bet, "重播沒有下注結算");

  // ---- 山道傳說 ----
  await patchSetup(page, { cars: [{ car: "ff80", tire: "soft", aero: 2, gear: 0, style: "balanced", up: { eng: 0, wt: 0, brk: 0, hdl: 0 } }, { car: "r35", tire: "soft", aero: 2, gear: 0, style: "balanced", up: { eng: 0, wt: 0, brk: 0, hdl: 0 } }] });
  await page.evaluate(function () { window.PriTestDejavu.go("course"); });
  var akina = await page.evaluate(function () { return window.PriTestDejavuData.course("akina").name[window.I18N.getLang()]; });
  await page.evaluate(function (n) {
    window.PriTestDejavu.go("course");
    var b = Array.prototype.filter.call(document.querySelectorAll(".dv-card"), function (x) { return x.textContent.indexOf(n) >= 0; })[0];
    if (b) b.click();
  }, akina);
  s = await setup(page);
  assert.strictEqual(s.course.src, "akina");
  assert.ok(await page.$(".dv-legend"), "固定山路要顯示傳說");
  await page.screenshot({ path: path.join(SHOT_DIR, "modes_legend_course.png"), fullPage: true });
  await clickKey(page, "dv_legend_go");
  assert.ok(await page.$(".dv-banner-legend"), "車庫要顯示傳說橫幅");
  out = await raceToResult(page);
  assert.strictEqual(out.res.length, s.players.length + 1, "傳說戰只有玩家＋傳說");
  assert.ok(out.post.legend, "要有傳說結果");
  var beaten = await page.evaluate(function () { return window.PriTestDejavuModes.legendBeaten(); });
  assert.strictEqual(!!beaten.akina, out.post.legend.win, "贏了才收進圖鑑");
  console.log("傳說戰：" + (out.post.legend.win ? "勝" : "敗") + " " + out.post.legend.name);

  // ---- 錦標賽 3 站 ----
  await page.evaluate(function () { window.PriTestDejavu.go("setup"); });
  await clickKey(page, "dv_champ_n", { n: "3" });
  await clickKey(page, "dv_champ_start");
  s = await setup(page);
  assert.ok(s.champ && s.champ.plan.length === 3 && s.champ.round === 0);
  assert.strictEqual(s.course.src, s.champ.plan[0].course);
  var total = 0;
  for (var k = 0; k < 3; k++) {
    out = await raceToResult(page);
    assert.ok(out.post.champ, "第 " + (k + 1) + " 站要有積分");
    total += out.post.champ.reduce(function (a, e) { return a + e.pts; }, 0);
    s = await setup(page);
    assert.strictEqual(s.champ.round, k + 1);
    if (k < 2) {
      var nextName = await page.evaluate(function (c) { return window.PriTestDejavuData.course(c).name[window.I18N.getLang()]; }, s.champ.plan[k + 1].course);
      var icon = { spring: "🌸", summer: "☀️", autumn: "🍁", winter: "❄️" }[s.champ.plan[k + 1].season];
      var lbl = await page.evaluate(function (n) { return window.I18N.t("dv_champ_next", { name: n }); }, nextName);
      var hit = await page.evaluate(function (l) {
        var x = Array.prototype.filter.call(document.querySelectorAll("#dv-app button"), function (b) { return b.textContent.trim().indexOf(l) === 0; })[0];
        if (x) x.click();
        return !!x;
      }, lbl);
      assert.ok(hit, "找不到下一站按鈕 " + icon);
    }
  }
  var sum = Object.keys(s.champ.table).reduce(function (a, key) { return a + s.champ.table[key]; }, 0);
  assert.strictEqual(sum, total, "總積分要等於各站加總");
  assert.ok(await page.$(".dv-big-msg"), "最後一站要顯示總冠軍");
  await page.screenshot({ path: path.join(SHOT_DIR, "modes_champ_final.png"), fullPage: true });

  // ---- 進階條件的比賽畫面 ----
  await patchSetup(page, { champ: null, night: true, wx: true, wear: true });
  await page.evaluate(function () { window.PriTestDejavu.go("garage"); });
  await clickKey(page, "dv_go");
  await page.waitForFunction(function () { var r = window.PriTestDejavu.race(); return r && r.t > 6; }, null, { timeout: 30000 });
  var rflags = await page.evaluate(function () { var r = window.PriTestDejavu.race(); return { night: r.night, wear: r.wear, wx: !!r.wx, tw: r.cars[0].tw }; });
  assert.ok(rflags.night && rflags.wear && rflags.wx && rflags.tw <= 1);
  await clickKey(page, "dv_cam_cockpit");
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOT_DIR, "modes_night_cockpit.png") });
  await clickKey(page, "dv_cam_chase");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, "modes_night_chase.png") });
  await clickKey(page, "dv_cam_tv");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, "modes_night_tv.png") });
  await clickKey(page, "dv_skip");
  await page.waitForFunction(function () { return window.PriTestDejavu.ui().screen === "result"; }, null, { timeout: 60000 });
  var wx = await page.evaluate(function () { return window.PriTestDejavu.race().events.filter(function (e) { return e.type === "weather"; }).length; });
  assert.strictEqual(wx, 1, "天氣要變一次");
  assert.ok(await page.evaluate(function () { return document.querySelector(".dv-results thead").textContent.indexOf(window.I18N.t("dv_r_wear")) >= 0; }), "結果表要有磨耗欄");

  // ---- 三種語言 ----
  for (var lang of ["ja", "en", "zh"]) {
    await page.evaluate(function (l) { window.I18N.setLang(l); }, lang);
    await page.evaluate(function () { window.PriTestDejavu.go("setup"); });
    await noRawKeys(page, "設定（" + lang + "）");
    await page.evaluate(function () { window.PriTestDejavu.go("course"); });
    await noRawKeys(page, "山路（" + lang + "）");
    await page.evaluate(function () { window.PriTestDejavu.go("garage"); });
    await noRawKeys(page, "車庫（" + lang + "）");
  }
  assert.deepStrictEqual(errors, [], "頁面有錯誤：" + errors.join("\n"));
  await browser.close();
  console.log("✓ dejavu 玩法（每日／下注／傳說／錦標賽）與進階條件檢查通過");
})().catch(function (e) { console.error(e); process.exit(1); });
