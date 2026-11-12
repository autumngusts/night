// ============================================================================
// 緣日樂園 28 天平衡模擬：機器人用「物料需求展開」自動排程工房，依序蓋設施與改裝。
// 執行：node tools/ennichi_check/sim.js [種子]
// 目標（MVP 的手感基準）：不破產、來客成長、平均心情 50〜85、第 10 天前蓋好旋轉木馬、季末人氣 Lv3 以上、
//                         至少完成 1 個繪馬願望、至少裝上 1 個改裝模組、murmur 類型至少 5 種。
// 對 brief 原始 bot 的修改（2026-11-12，Task 12）：
//   1. 沒有需求的機器改用 {a:"recipe", rid:null} 停機（原本會一直跑，雕刻台等把木板吃光，永遠蓋不出旋轉木馬）。
//   2. 營業中每 30 分鐘重新展開需求並分派配方：只挑「現在有料可做」的配方，只動待機中的機器
//      （原本一天只分派一次，同一台機器要做兩種配方時會卡死，例如漆工房同時要彩漆與唐獅子）。
//   3. 缺的機器先各買 1 台；同一種機器要做 2 種以上配方、且機器槽還有剩時補第 2 台。
//   4. 商品目標改成依前一天來客數估計當天銷量（原本固定 60／40／20 份），商品機器用 {a:"limit"} 設庫存上限。
//   5. murmur 類型改成每 30 分鐘收集一次（s.today.murmurs 只保留最新 300 則，打烊後才看會漏掉早上的 SNS）。
// ============================================================================
"use strict";
var fs = require("fs"), path = require("path"), assert = require("assert");
global.window = global;
var SRC = path.join(__dirname, "..", "..", "static_src");
["ennichi_data.js", "ennichi_murmur.js", "ennichi_wish.js", "ennichi_core.js", "ennichi_sim.js"].forEach(function (f) { eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8")); });
var D = window.PriTestEnnichiData, Core = window.PriTestEnnichiCore;
var seed = +(process.argv[2] || 2026);
var s = Core.newGame({ seed: seed });
function act(a) { return Core.applyIntent(s, a).ok; }

// 第二條街：x=21 往下接到 y=17，再沿 y=17 往左。上排蓋在參道上方（y = 10 − h），下排蓋在第二條街上方（y = 17 − h）
var ROWS = [D.MAP.GATE.y, 17];
function layStreets() {
  for (var y = D.MAP.GATE.y + 1; y <= 17; y++) Core.setPath(s, 21, y, true);
  for (var x = 1; x <= 20; x++) Core.setPath(s, x, 17, true);
}
function tryPlace(type) {
  var b = D.BUILD[type];
  for (var r = 0; r < ROWS.length; r++) for (var x = 1; x + b.w <= 21; x++) if (act({ a: "build", type: type, x: x, y: ROWS[r] - b.h })) return true;
  return false;
}
function tryQstall() {
  for (var k in s.structs) {
    if (s.structs[k].type !== "merry" || s.structs[k].build) continue;
    var e = Core.entranceOf(s.structs[k]);
    for (var dx = -3; dx <= 3; dx++) if (act({ a: "build", type: "qstall", x: e.x + dx, y: e.y - 1 })) return true;
  }
  return false;
}

// 物料需求展開：要做出 want（{item: n}）還缺什麼 → make（{item: 批次數}）、buy（{原料: n}）
function explode(want) {
  var stock = JSON.parse(JSON.stringify(s.ware)), make = {}, buy = {};
  function need(k, n) {
    var use = Math.min(n, stock[k] || 0); stock[k] = (stock[k] || 0) - use; n -= use;
    if (n <= 0) return;
    var it = D.ITEMS[k];
    if (it.kind === "mat") { buy[k] = (buy[k] || 0) + n; return; }
    var r = D.RECIPES[k], batches = Math.ceil(n / r.out[k]);
    make[k] = (make[k] || 0) + batches;
    stock[k] = (stock[k] || 0) + batches * r.out[k] - n;
    for (var i in r.in) need(i, r.in[i] * batches);
  }
  for (var k in want) need(k, want[k]);
  return { make: make, buy: buy };
}

var GOALS = ["takoyakiSt", "ameSt", "kingyo", "wanage", "bench", "trash", "bench", "toilet", "merry", "ramuneSt", "kasaSt", "shelter",
  "trash", "cups", "omikuji", "shateki", "juyo", "chairs", "lanternPost", "lanternPost", "wheel", "flower"];
var UPGRADES = [["merry", "light"], ["merry", "deco"], ["wheel", "cabin"]];
var types = {}, upgraded = 0, merryDay = null;
var GOODS = ["takoyaki", "ramune", "wataame", "kasa", "ema"];

// 本日目標：下一個要蓋的設施＋修理零件＋第一個改裝＋商品（依前一天來客數估計）
function goodsWant() {
  var G = s.history.length ? Math.max(30, s.history[s.history.length - 1].guests) : 30;
  return { takoyaki: Math.ceil(G * 0.5), ramune: Math.ceil(G * 0.5), wataame: Math.ceil(G * 0.25), kasa: 6, ema: 8 };
}
function computePlan() {
  var want = {};
  function addMap(m) { for (var i in m) want[i] = (want[i] || 0) + m[i]; }
  if (GOALS.length) addMap(D.BUILD[GOALS[0]].parts);
  addMap({ gear: 2, chain: 2, plank: 4 });
  var u = UPGRADES[0], ub = D.BUILD[u[0]];
  if (ub.slots[u[1]]) { var o = {}; o[ub.slots[u[1]].mod] = ub.slots[u[1]].n; addMap(o); }
  addMap(goodsWant());
  return explode(want);
}
// 每台待機中的機器挑「有需求且現在有料可做」的配方；沒有就停機
function assignRecipes(plan) {
  var byM = {}, used = {}, gw = goodsWant();
  for (var r in plan.make) { var m = D.RECIPES[r].m; (byM[m] = byM[m] || []).push(r); }
  s.machines.forEach(function (mc) { if (mc.t !== null && mc.rid) used[mc.rid] = 1; });
  s.machines.forEach(function (mc, i) {
    if (mc.t !== null) return;
    var list = (byM[mc.type] || []).filter(function (x) { return !used[x] && Core.have(s, D.RECIPES[x].in); })
      .sort(function (a, b) { return plan.make[b] - plan.make[a]; });
    var pick = list[0] || null;
    if (pick) used[pick] = 1;
    if (mc.rid !== pick) act({ a: "recipe", mi: i, rid: pick });
    act({ a: "limit", mi: i, n: pick && gw[pick] ? gw[pick] : null });
  });
}

function planDay() {
  for (var k in s.structs) if (s.structs[k].broken || s.structs[k].wear > 60) act({ a: "repair", sid: +k });
  while (GOALS.length && tryPlace(GOALS[0])) GOALS.shift();
  tryQstall();
  UPGRADES.forEach(function (u) {
    for (var j in s.structs) if (s.structs[j].type === u[0]) { if (act({ a: "upgrade", sid: +j, slot: u[1] })) upgraded++; }
  });
  for (var t in s.structs) if (D.BUILD[s.structs[t].type].kind === "ride") act({ a: "ticket", sid: +t, on: true });
  var plan = computePlan();
  // 同一種機器有幾種配方要做就買幾台
  var byM = {};
  for (var r in plan.make) { var m = D.RECIPES[r].m; byM[m] = (byM[m] || 0) + 1; }
  function count(m) { return s.machines.filter(function (x) { return x.type === m; }).length; }
  // 先確保每種機器至少 1 台，機器槽有剩（保留 2 槽）才補第 2 台
  Object.keys(byM).forEach(function (m) { if (!count(m)) act({ a: "machine", type: m }); });
  Object.keys(byM).forEach(function (m) {
    if (byM[m] > 1 && count(m) < 2 && Core.machineSlots(s) - s.machines.length > 2) act({ a: "machine", type: m });
  });
  for (var b in plan.buy) if (s.cash > 800) act({ a: "buy", item: b, n: Math.min(plan.buy[b], D.WARE_CAP - Core.wareTotal(s)) });
  assignRecipes(computePlan());
}

layStreets();
console.log("day wthr guests   rev hap  rep   cash built");
for (var d = 1; d <= D.SEASON_DAYS; d++) {
  planDay();
  act({ a: "open" });
  while (s.phase === "open") {
    Core.tick(s, 30);
    s.today.murmurs.forEach(function (m) { types[m.type] = 1; }); // murmur 牆只留最新 300 則 → 每 30 分鐘收集一次
    if (s.phase === "open") assignRecipes(computePlan());
  }
  if (merryDay === null) for (var k in s.structs) if (s.structs[k].type === "merry" && s.structs[k].build === 0) merryDay = d;
  var h = s.history[s.history.length - 1];
  console.log([h.day, h.weather, h.guests, h.rev, h.avgHap, s.rep, s.cash, Object.keys(s.structs).length].map(function (v) { return String(v).padStart(5); }).join(" "));
  act({ a: "next" });
}
var res = Core.seasonResult(s);
console.log("season", JSON.stringify(res), "merryDay", merryDay, "upgraded", upgraded, "murmur types", Object.keys(types).join(","));
assert.ok(s.cash > 0, "沒有破產");
assert.ok(s.history[27].guests > s.history[0].guests, "來客成長");
assert.ok(res.avgHap >= 50 && res.avgHap <= 85, "平均心情 50〜85：" + res.avgHap);
assert.ok(merryDay !== null && merryDay <= 10, "第 10 天前蓋好旋轉木馬：" + merryDay);
assert.ok(res.level >= 3, "季末人氣 Lv3 以上：Lv" + res.level);
assert.ok(res.wishes >= 1, "至少完成 1 個繪馬願望");
assert.ok(upgraded >= 1, "至少裝上 1 個改裝模組");
assert.ok(Object.keys(types).length >= 5, "murmur 類型至少 5 種");
console.log("sim OK");
