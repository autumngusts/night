// ============================================================================
// 緣日樂園（ennichi）的瀏覽器檢查（Playwright）。先 py -3 generate.py，再起本機伺服器：
//   py -3 -m http.server 8962 --directory dist
//   node tools/ennichi_check/ui_check.js
// 流程：標題 → 新遊戲 → 小地圖放置章魚燒攤 → 墊旋轉木馬的模組後放置（施工中）→ 市場買料 → 配方樹
//       → 開園 4 倍速跑完一天 → 日結算 → 下一天（旋轉木馬完工）→ 改裝、整理券、修理 → 繪馬牆
//       → 區域視窗買下陸地樂園、放碰碰車、區域列切換（2026-11-14）
//       → 重新整理後「繼續」讀回同一天 → 手機寬度無橫向捲動。
// 觸發一律 dispatchEvent；小地圖是靜態 canvas，用 page.mouse 點格子。
//
// Playwright 解析順序：環境變數 PLAYWRIGHT_CORE（模組路徑）→ playwright → playwright-core
//   （搜尋路徑含本資料夾、tools/midnight_check、目前工作目錄）。
// 瀏覽器：環境變數 CHROMIUM_PATH 指定 executablePath；未設定則用 Playwright 預設安裝。
// 其他環境變數：EN_BASE（頁面網址，預設 http://localhost:8962/ennichi/index.html）。
// ============================================================================
"use strict";
var assert = require("assert"), path = require("path"), fs = require("fs");

function loadPlaywright() {
  var tries = [];
  if (process.env.PLAYWRIGHT_CORE) tries.push(process.env.PLAYWRIGHT_CORE);
  tries.push("playwright", "playwright-core");
  var paths = [__dirname, path.join(__dirname, "..", "midnight_check"), process.cwd()];
  for (var i = 0; i < tries.length; i++) {
    try { return require(require.resolve(tries[i], { paths: paths })); } catch (e) { /* 試下一個 */ }
  }
  throw new Error("找不到 playwright / playwright-core；請安裝，或用 PLAYWRIGHT_CORE 指定模組路徑");
}
var pw = loadPlaywright();
var BASE = process.env.EN_BASE || "http://localhost:8962/ennichi/index.html";
var SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

async function act(page, sel) { await page.waitForSelector(sel, { state: "attached", timeout: 20000 }); await page.dispatchEvent(sel, "click"); await page.waitForTimeout(80); }
async function st(page) { return page.evaluate(function () { return window.PriTestEnnichiGame._state(); }); }
// 小地圖為 32x20 格的 canvas（顯示尺寸由 CSS 決定），依實際寬高換算格子中心。
async function clickTile(page, x, y) {
  var box = await (await page.$("#en-minimap")).boundingBox();
  await page.mouse.click(box.x + (x + 0.5) * box.width / 32, box.y + (y + 0.5) * box.height / 20);
  await page.waitForTimeout(80);
}
function sidOf(s, type) { return Object.keys(s.structs).filter(function (k) { return s.structs[k].type === type; })[0]; }

(async function () {
  var opts = { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] };
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  var browser = await pw.chromium.launch(opts);
  var errors = [];
  var page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("pageerror", function (e) { errors.push(e.message); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () { try { localStorage.removeItem("pritest-ennichi-save"); } catch (e) {} });
  await page.reload();
  await act(page, "#en-btn-new");
  await page.waitForSelector("#en-hud", { timeout: 60000 });
  var s = await st(page);
  assert.strictEqual(s.phase, "plan");
  assert.ok((await page.$$("#en-forecast [data-day]")).length === 3, "顯示 3 天預報");

  // 放置：章魚燒攤（一般設施，當天完成）
  await act(page, "#en-tab-build");
  await act(page, "[data-build=\"takoyakiSt\"]"); await clickTile(page, 10, 8);
  // 旋轉木馬：先墊模組（測試捷徑）再放置 → 施工中
  await page.evaluate(function () { var g = window.PriTestEnnichiGame, D = window.PriTestEnnichiData; window.PriTestEnnichiCore.give(g._state(), D.BUILD.merry.parts); });
  await act(page, "[data-build=\"merry\"]"); await clickTile(page, 4, 6);
  s = await st(page);
  assert.ok(sidOf(s, "takoyakiSt") && sidOf(s, "merry"), "放置成功");
  assert.strictEqual(s.structs[sidOf(s, "merry")].build, 1, "旋轉木馬施工中");
  var cash = s.cash;
  await act(page, "[data-build=\"kingyo\"]"); await clickTile(page, 5, 7);
  assert.strictEqual((await st(page)).cash, cash, "重疊時不扣錢");
  await act(page, "#en-btn-cancel");

  // 工房：買料、配方樹
  await act(page, "#en-tab-work");
  await act(page, "[data-buy=\"octopus\"]"); await act(page, "[data-buy=\"flour\"]");
  s = await st(page); assert.ok(s.ware.octopus >= 10 && s.ware.flour >= 10);
  await act(page, "[data-tree=\"lionPost\"]");
  var tree = await page.textContent("#en-recipe-tree");
  assert.ok(tree.indexOf("原木") >= 0, "獅子柱組的配方樹展開到原木（zh、ja 同字）");

  // 開園跑一天
  await act(page, "#en-btn-open");
  await act(page, "#en-btn-speed-4");
  await page.evaluate(function () { window.PriTestEnnichiGame._fast = 40; });
  await page.screenshot({ path: path.join(SHOTS, "open.png") });
  await page.waitForSelector("#en-day-summary", { timeout: 120000 });
  s = await st(page);
  assert.strictEqual(s.phase, "close"); assert.ok(s.history[0].guests > 0);
  await act(page, "#en-tab-murmur"); // 側欄只渲染目前的分頁
  assert.ok((await page.$$("#en-murmur-wall .en-wall-item")).length > 0, "murmur 牆有內容");
  await page.screenshot({ path: path.join(SHOTS, "summary.png") });
  await act(page, "#en-btn-next-day");
  s = await st(page);
  assert.strictEqual(s.day, 2); assert.strictEqual(s.structs[sidOf(s, "merry")].build, 0, "隔天完工");

  // 改裝、整理券、修理
  var merrySid = sidOf(s, "merry");
  await page.evaluate(function (sid) {
    var g = window.PriTestEnnichiGame, s = g._state();
    window.PriTestEnnichiCore.give(s, { nightLanterns: 2, gear: 4 });
    s.structs[sid].wear = 100; s.structs[sid].broken = true;
  }, merrySid);
  await act(page, "#en-tab-park");
  await act(page, "[data-struct=\"" + merrySid + "\"]");
  await act(page, "[data-upgrade=\"light\"]");
  await act(page, "#en-ticket-toggle");
  await act(page, "#en-btn-repair");
  s = await st(page);
  assert.ok(s.structs[merrySid].mods.light, "裝上夜光燈籠串");
  assert.ok(s.structs[merrySid].ticket, "整理券開啟");
  assert.ok(!s.structs[merrySid].broken, "修好了");

  // 繪馬牆
  await page.evaluate(function () { var g = window.PriTestEnnichiGame; window.PriTestEnnichiWish.maybeMake(g._state(), null, true); });
  await act(page, "#en-tab-wish");
  assert.ok((await page.$$("#en-wish-board [data-wish]")).length >= 1, "繪馬牆有願望");

  // 多張地圖（規格 §6.3.1）：從「區域」視窗買下陸地樂園 → 自動移過去 → 在小地圖放碰碰車 → 區域列切回境內
  await page.evaluate(function () { var s = window.PriTestEnnichiGame._state(); s.rep = window.PriTestEnnichiData.POP_LEVELS[1]; s.cash = 1e6; });
  await act(page, "#en-tab-area");
  await act(page, "[data-area-buy=\"land\"]");
  s = await st(page);
  assert.ok(s.areas.land, "買下陸地樂園");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestEnnichiGame._area(); }), 1, "買下後移到陸地樂園");
  await page.evaluate(function () { var D = window.PriTestEnnichiData; window.PriTestEnnichiCore.give(window.PriTestEnnichiGame._state(), D.BUILD.bumper.parts); });
  await act(page, "#en-win-area [data-win-close]");
  await act(page, "#en-tab-build");
  assert.ok(await page.$("[data-build=\"bumper\"]"), "陸地樂園的建造清單有碰碰車");
  assert.ok(!(await page.$("[data-build=\"coaster\"]")), "其他區域的專屬設施不列出");
  await act(page, "[data-build=\"bumper\"]"); await clickTile(page, 3, 6);
  s = await st(page);
  var bsid = sidOf(s, "bumper");
  assert.ok(bsid && s.structs[bsid].y === 20 + 6, "碰碰車蓋在陸地樂園（世界 y = 20 + 6）");
  await act(page, "#en-btn-mode-cancel");
  await act(page, "[data-area=\"0\"]");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestEnnichiGame._area(); }), 0, "區域列切回境內");
  await page.screenshot({ path: path.join(SHOTS, "areas.png") });

  // 讀檔
  await page.reload();
  await act(page, "#en-btn-continue");
  await page.waitForSelector("#en-hud", { timeout: 60000 });
  s = await st(page);
  assert.strictEqual(s.day, 2, "讀回第 2 天");
  assert.ok(s.areas.land, "讀回已解鎖的區域");

  // 手機寬度（新的瀏覽器環境沒有存檔 → 新遊戲）
  var m = await (await browser.newContext(pw.devices["iPhone 13"])).newPage();
  m.on("pageerror", function (e) { errors.push("mobile: " + e.message); });
  await m.goto(BASE);
  await m.dispatchEvent("#en-btn-new", "click");
  await m.waitForSelector("#en-hud", { timeout: 60000 });
  var over = await m.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  assert.ok(over <= 0, "手機無橫向捲動：" + over);
  await m.screenshot({ path: path.join(SHOTS, "mobile.png") });

  assert.deepStrictEqual(errors, [], "沒有 JS 錯誤：\n" + errors.join("\n"));
  console.log("ui OK");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
