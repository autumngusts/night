// ============================================================================
// DÉJÀ VU（dejavu）第十一批 Playwright 檢查：機車 100 款、自訂車輛、自訂路的自由編輯
//   車庫：機車廠牌分組、選機車（不能驅動改裝）、CPU 改開機車 → 比賽（車內騎乘視角＋轉播＋俯視）沒有錯誤
//   自訂車：以現有車為基礎、取名、切成機車（車重範圍）、EV、隨機、調校代碼匯出入
//   自訂路：景觀／水側、接零件、上下移、複製、鏡像、反轉、隨機延長、清空
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8946 --directory dist
// 執行：node tools/dejavu_check/bike_check.js
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

(async function () {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-dejavu-setup"); });
  await page.reload();
  await page.waitForFunction(function () { return !!window.PriTestDejavu; });

  // ---- 資料 ----
  var data = await page.evaluate(function () {
    var D = window.PriTestDejavuData, Core = window.PriTestDejavuCore;
    var bikes = D.CARS.filter(function (c) { return c.bike; });
    var ids = {};
    D.CARS.forEach(function (c) { ids[c.id] = (ids[c.id] || 0) + 1; });
    return {
      bikes: bikes.length, allMC: bikes.every(function (c) { return c.drive === "MC"; }),
      dup: Object.keys(ids).filter(function (k) { return ids[k] > 1; }),
      // 騎士體重有加、機車沒有套車重的抓地加成
      m: Core.carStats({ car: "b_v4r" }).m, load: Core.carStats({ car: "b_v4r" }).load, bike: Core.carStats({ car: "b_v4r" }).bike,
      // 汽車改裝不能改成機車、機車不能改驅動
      swapCar: Core.cleanSpec({ car: "ae86", drv: "MC" }).drv, swapBike: Core.cleanSpec({ car: "b_cygnus", drv: "4WD" }).drv,
      // 自訂汽車的車重仍擋在 450 kg；自訂機車可以 120 kg
      kgCar: Core.cleanSpec({ car: "custom", custom: { drive: "FR", kg: 120 } }).custom.kg,
      kgBike: Core.cleanSpec({ car: "custom", custom: { drive: "MC", kg: 120 } }).custom.kg,
      name: Core.carStats({ car: "custom", custom: { drive: "MC", kg: 150, name: "  我的戰車  " } }).name
    };
  });
  assert.strictEqual(data.bikes, 100, "機車要 100 款");
  assert.ok(data.allMC, "機車的驅動要是 MC");
  assert.deepStrictEqual(data.dup, [], "車款 id 重複");
  assert.strictEqual(data.m, 194 + 75, "V4 R 要加上騎士 75 kg");
  assert.strictEqual(data.load, 1);
  assert.ok(data.bike);
  assert.strictEqual(data.swapCar, "");
  assert.strictEqual(data.swapBike, "");
  assert.strictEqual(data.kgCar, 450);
  assert.strictEqual(data.kgBike, 120);
  assert.strictEqual(data.name, "我的戰車");

  // ---- 車庫：選機車 ----
  await page.evaluate(function () { window.PriTestDejavu.go("garage"); });
  await noRawKeys(page, "車庫");
  var groups = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll(".dv-brand optgroup"), function (g) { return g.children.length; }); });
  assert.strictEqual(groups.length, 2, "廠牌選單要分汽車／機車兩組");
  await page.selectOption(".dv-brand", "mc_ducati");
  await page.selectOption(".dv-model", "b_v4r");
  var s = await setup(page);
  assert.strictEqual(s.cars[0].car, "b_v4r");
  // 細部調校的標題本來就寫著「驅動改裝」，所以看裡面有沒有驅動的選項按鈕
  var swapUi = await page.evaluate(function () {
    var d = document.querySelector(".dv-tune"); d.open = true;
    return Array.prototype.some.call(d.querySelectorAll("button"), function (b) { return ["FF", "FR", "MR", "RR", "4WD"].indexOf(b.textContent.trim()) >= 0; });
  });
  assert.ok(!swapUi, "機車不應該出現驅動改裝");
  // 第二位玩家開台灣速克達
  await page.evaluate(function () { Array.prototype.filter.call(document.querySelectorAll(".dv-tab"), function () { return true; })[1].click(); });
  await page.selectOption(".dv-brand", "mc_yamaha");
  await page.selectOption(".dv-model", "b_cygnus");
  // CPU 改開機車
  await clickKey(page, "dv_cpu_kind_bike");
  s = await setup(page);
  assert.strictEqual(s.cpuKind, "bike");
  assert.ok(s.cpuCars.length > 0 && s.cpuCars.every(function (c) { return c.spec.car.indexOf("b_") === 0; }), "CPU 要全部是機車");
  await page.screenshot({ path: path.join(SHOT_DIR, "bike_garage.png"), fullPage: true });

  // ---- 比賽：車內（騎乘視角）、轉播、俯視 ----
  await page.evaluate(function () { window.PriTestDejavu.go("course"); });
  var irohazaka = await page.evaluate(function () { return window.PriTestDejavuData.course("irohazaka").name[window.I18N.getLang()]; });
  await page.evaluate(function (n) {
    Array.prototype.filter.call(document.querySelectorAll(".dv-card"), function (x) { return x.textContent.indexOf(n) >= 0; })[0].click();
  }, irohazaka).catch(function () {});
  await page.evaluate(function () { window.PriTestDejavu.go("garage"); });
  await clickKey(page, "dv_go");
  await page.waitForFunction(function () { var r = window.PriTestDejavu.race(); return r && r.t > 8; }, null, { timeout: 30000 });
  var bikeCar = await page.evaluate(function () { return window.PriTestDejavu.race().cars[0].st.bike; });
  assert.ok(bikeCar);
  await clickKey(page, "dv_cam_cockpit");
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOT_DIR, "bike_cockpit.png") });
  await clickKey(page, "dv_cam_tv");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, "bike_tv.png") });
  await clickKey(page, "dv_cam_chase");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, "bike_chase.png") });
  assert.deepStrictEqual(errors, [], "比賽畫面有錯誤：" + errors.join("\n"));

  // ---- 自訂車 ----
  await page.evaluate(function () { window.PriTestDejavu.go("garage"); });
  await page.evaluate(function () { document.querySelectorAll(".dv-tab")[0].click(); });
  await page.selectOption(".dv-brand", "toyota");
  await clickKey(page, "dv_custom_from", null, "🛠 ");
  s = await setup(page);
  assert.strictEqual(s.cars[0].car, "custom");
  assert.strictEqual(s.cars[0].custom.name, "Sprinter Trueno AE86", "以現有車為基礎要帶入名稱");
  await page.fill("#dv-app .dv-panel input.dv-name", "峠の白い彗星");
  await page.dispatchEvent("#dv-app .dv-panel input.dv-name", "change");
  s = await setup(page);
  assert.strictEqual(s.cars[0].custom.name, "峠の白い彗星");
  // 切成機車：車重跳到機車的範圍
  await clickKey(page, "dv_drv_mc");
  s = await setup(page);
  assert.strictEqual(s.cars[0].custom.drive, "MC");
  assert.ok(s.cars[0].custom.kg < 450);
  await page.check("#dv-app .dv-check input");
  s = await setup(page);
  assert.strictEqual(s.cars[0].custom.ev, true);
  await clickKey(page, "dv_custom_rand_bike", null, "🎲 ");
  s = await setup(page);
  assert.strictEqual(s.cars[0].custom.drive, "MC");
  await noRawKeys(page, "自訂車");
  await page.screenshot({ path: path.join(SHOT_DIR, "bike_custom.png"), fullPage: true });
  // 調校代碼：匯出 → 換車 → 匯入回來
  await page.evaluate(function () { var d = document.querySelectorAll(".dv-tune"); d[d.length - 1].open = true; });
  await clickKey(page, "dv_tune_code_export");
  var code = await page.evaluate(function () { var t = document.querySelectorAll(".dv-tune .dv-code"); return t[t.length - 1].value; });
  assert.ok(/^DVCAR1:/.test(code), "調校代碼格式");
  var before = (await setup(page)).cars[0];
  await page.selectOption(".dv-brand", "honda");
  await page.evaluate(function (c) { var t = document.querySelectorAll(".dv-tune .dv-code"); t[t.length - 1].value = c; }, code);
  await clickKey(page, "dv_tune_code_import");
  var after = (await setup(page)).cars[0];
  assert.strictEqual(after.car, "custom");
  assert.deepStrictEqual(after.custom, before.custom, "匯入的調校要跟匯出時一樣");
  await page.evaluate(function () { var t = document.querySelectorAll(".dv-tune .dv-code"); t[t.length - 1].value = "亂打的"; });
  await clickKey(page, "dv_tune_code_import");
  var bad = await page.evaluate(function () { return document.getElementById("dv-app").innerText.indexOf(window.I18N.t("dv_tune_code_bad")) >= 0; });
  assert.ok(bad, "壞代碼要顯示錯誤");

  // ---- 自訂路：自由編輯 ----
  await page.evaluate(function () { window.PriTestDejavu.go("course"); });
  await page.evaluate(function () { document.querySelector(".dv-segs").open = true; });
  await clickKey(page, "dv_edit_blank", null, "🧹 ");
  s = await setup(page);
  assert.strictEqual(s.course.src, "custom");
  assert.strictEqual(s.course.segs.length, 1);
  await page.evaluate(function () {
    var sel = Array.prototype.filter.call(document.querySelectorAll(".dv-segs select"), function (x) { return x.querySelector("optgroup"); })[0];
    sel.value = "double_hairpin"; sel.dispatchEvent(new Event("change"));
  });
  await clickKey(page, "dv_add_piece");
  s = await setup(page);
  var n1 = s.course.segs.length;
  assert.ok(n1 > 1, "接零件後路段要變多");
  var angs = s.course.segs.filter(function (x) { return x.t === "C"; }).map(function (x) { return x.ang; });
  await clickKey(page, "dv_edit_mirror", null, "⇋ ");
  s = await setup(page);
  assert.deepStrictEqual(s.course.segs.filter(function (x) { return x.t === "C"; }).map(function (x) { return x.ang; }), angs.map(function (a) { return -a; }), "鏡像要把彎的方向反過來");
  var order = s.course.segs.map(function (x) { return x.t + (x.len || x.ang); });
  await clickKey(page, "dv_edit_reverse", null, "⟲ ");
  s = await setup(page);
  assert.strictEqual(s.course.segs[0].t + (s.course.segs[0].len || -s.course.segs[0].ang), order[order.length - 1], "反轉後第一段是原本的最後一段（彎向相反）");
  await clickKey(page, "dv_edit_extend", null, "🎲 ");
  s = await setup(page);
  assert.ok(s.course.segs.length > n1, "隨機延長");
  // 複製第一段、把第二段往上移
  var first = JSON.stringify(s.course.segs[0]);
  await page.evaluate(function () { Array.prototype.filter.call(document.querySelectorAll(".dv-seg button"), function (b) { return b.textContent === "⧉"; })[0].click(); });
  s = await setup(page);
  assert.strictEqual(JSON.stringify(s.course.segs[1]), first, "複製的路段要插在下一個");
  var second = JSON.stringify(s.course.segs[2]);
  await page.evaluate(function () { Array.prototype.filter.call(document.querySelectorAll(".dv-seg button"), function (b) { return b.textContent === "↑" && !b.disabled; })[1].click(); });
  s = await setup(page);
  assert.strictEqual(JSON.stringify(s.course.segs[1]), second, "上移");
  // 景觀：海邊、水在右側
  await page.evaluate(function () {
    var sel = Array.prototype.filter.call(document.querySelectorAll("#dv-app select"), function (x) { return x.querySelector("option[value=sea]"); })[0];
    sel.value = "sea"; sel.dispatchEvent(new Event("change"));
  });
  await clickKey(page, "dv_right");
  s = await setup(page);
  assert.strictEqual(s.course.scene, "sea");
  assert.strictEqual(s.course.water, -1);
  await noRawKeys(page, "自訂路");
  await page.screenshot({ path: path.join(SHOT_DIR, "bike_course_edit.png"), fullPage: true });

  // 自訂路＋自訂機車跑一場
  await page.evaluate(function () { window.PriTestDejavu.go("garage"); });
  await clickKey(page, "dv_go");
  await page.waitForFunction(function () { var r = window.PriTestDejavu.race(); return r && r.t > 5; }, null, { timeout: 30000 });
  await clickKey(page, "dv_cam_cockpit");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOT_DIR, "bike_custom_race.png") });

  // ---- 三種語言 ----
  for (var lang of ["ja", "en", "zh"]) {
    await page.evaluate(function (l) { window.I18N.setLang(l); }, lang);
    await page.evaluate(function () { window.PriTestDejavu.go("garage"); });
    await noRawKeys(page, "車庫（" + lang + "）");
    await page.evaluate(function () { window.PriTestDejavu.go("course"); });
    await page.evaluate(function () { var d = document.querySelector(".dv-segs"); if (d) d.open = true; });
    await noRawKeys(page, "山路（" + lang + "）");
  }

  assert.deepStrictEqual(errors, [], "頁面有錯誤：" + errors.join("\n"));
  await browser.close();
  console.log("✓ dejavu 機車／自訂車／自訂路檢查通過（截圖在 " + SHOT_DIR + "）");
})().catch(function (e) { console.error(e); process.exit(1); });
