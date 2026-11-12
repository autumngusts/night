// ============================================================================
// 緣日樂園（ennichi）核心規則檢查（不開瀏覽器，直接用 Node 載入 static_src）。
// 執行：node tools/ennichi_check/core_check.js
// 每個 Task 往下追加一段。
// ============================================================================
"use strict";
var fs = require("fs"), path = require("path"), assert = require("assert");
global.window = global;
global.I18N = { getLang: function () { return "zh"; }, t: function (k) { return k; } };
var SRC = path.join(__dirname, "..", "..", "static_src");
["ennichi_data.js", "ennichi_murmur.js", "ennichi_wish.js", "ennichi_core.js", "ennichi_sim.js"].forEach(function (f) {
  eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8"));
});
var D = window.PriTestEnnichiData;

// ---------------- 1. 資料完整性與層級規則 ----------------
(function () {
  var items = Object.keys(D.ITEMS), recipes = Object.keys(D.RECIPES);
  assert.strictEqual(Object.keys(D.MACHINES).length, 17, "機器 17 種");
  assert.strictEqual(recipes.length, 40, "配方 40 條");
  assert.strictEqual(items.filter(function (k) { return D.ITEMS[k].kind === "mat"; }).length, 14, "原料 14 種");
  recipes.forEach(function (rid) {
    var r = D.RECIPES[rid];
    assert.ok(D.MACHINES[r.m], rid + " 的機器不存在：" + r.m);
    assert.ok(r.out[rid] > 0, rid + " 的產物要等於配方 key");
    Object.keys(r.in).concat(Object.keys(r.out)).forEach(function (k) { assert.ok(D.ITEMS[k], rid + " 的物品不存在：" + k); });
    assert.ok(r.t > 0);
  });
  items.forEach(function (k) {
    var it = D.ITEMS[k];
    if (it.kind === "mat") { assert.ok(it.buy > 0, k + " 要有買價"); assert.ok(!D.RECIPES[k], k + " 是原料，不該有配方"); }
    else assert.ok(D.RECIPES[k], k + " 沒有配方");
    if (["food", "drink", "goods"].indexOf(it.kind) >= 0) assert.ok(it.sell > 0, k + " 要有售價");
    if (it.kind === "module" || it.kind === "upgrade") assert.ok(D.tierOf(k) >= 3, k + " 是模組，層級要 ≥ 3：" + D.tierOf(k));
    if (it.kind === "part") assert.ok(D.tierOf(k) >= 1 && D.tierOf(k) <= 2, k + " 是零件，層級 1〜2：" + D.tierOf(k));
  });
  // 每台機器至少有一條配方
  Object.keys(D.MACHINES).forEach(function (m) { assert.ok(recipes.some(function (r) { return D.RECIPES[r].m === m; }), m + " 沒有配方"); });
  // 建物：大型設施只用第三層模組；一般設施只用第二層以下的零件
  var rides = 0, stalls = 0, large = 0;
  Object.keys(D.BUILD).forEach(function (t) {
    var b = D.BUILD[t];
    assert.ok(b.w >= 1 && b.h >= 1 && b.lv >= 1 && b.lv <= 5, t + " 尺寸／等級");
    Object.keys(b.parts).forEach(function (k) {
      assert.ok(D.ITEMS[k], t + " 的材料不存在：" + k);
      if (b.large) assert.strictEqual(D.ITEMS[k].kind, "module", t + " 是大型設施，只能用模組：" + k);
      else assert.ok(D.ITEMS[k].kind === "part" && D.tierOf(k) <= 2, t + " 是一般設施，只能用第二層以下的零件：" + k);
    });
    if (b.kind === "ride") {
      rides++;
      assert.ok(b.cap > 0 && b.cycle > 0 && b.price >= 0 && b.wear > 0, t + " 搭乘數值");
      Object.keys(b.fix).forEach(function (k) { assert.ok(D.ITEMS[k].kind === "part", t + " 的修理零件要是零件：" + k); });
      if (b.large) {
        large++;
        assert.ok(b.days >= 1, t + " 大型設施要有組裝期");
        Object.keys(b.slots).forEach(function (sl) {
          assert.strictEqual(D.ITEMS[b.slots[sl].mod].kind, "upgrade", t + "." + sl + " 的改裝模組");
          assert.ok(b.slots[sl].n >= 1);
        });
      }
    }
    if (b.kind === "stall") { stalls++; b.sells.forEach(function (k) { assert.ok(["food", "drink", "goods"].indexOf(D.ITEMS[k].kind) >= 0, t + " 賣的不是商品：" + k); }); }
  });
  assert.strictEqual(rides, 8, "遊樂設施 8 種（規格 §10）"); assert.strictEqual(large, 4, "大型設施 4 種"); assert.strictEqual(stalls, 5, "攤位 5 種");
  assert.ok(D.BUILD.qstall && D.BUILD.qstall.kind === "qstall" && D.BUILD.shelter.serves === "shelter");
  function sumW(list) { return list.reduce(function (a, g) { return a + g.w; }, 0); }
  assert.ok(Math.abs(sumW(D.GUESTS) - 1) < 1e-9, "客群權重合計 1");
  assert.ok(Math.abs(sumW(Object.keys(D.WEATHER).map(function (k) { return D.WEATHER[k]; })) - 1) < 1e-9, "天氣權重合計 1");
  // 開局倉庫：夠蓋章魚燒攤、糖果攤、金魚撈、套圈圈、長椅（教學的前幾步）；旋轉木馬要自己建生產線
  var need = {};
  ["takoyakiSt", "ameSt", "kingyo", "wanage", "bench"].forEach(function (t) { var p = D.BUILD[t].parts; for (var k in p) need[k] = (need[k] || 0) + p[k]; });
  for (var k in need) assert.ok((D.START_WARE[k] || 0) >= need[k], "開局不夠：" + k);
  assert.ok(Object.keys(D.BUILD.merry.parts).some(function (k) { return !D.START_WARE[k]; }), "旋轉木馬不能一開局就蓋");
  assert.strictEqual(D.PHOTOS.length, 32);
  console.log("1. 資料與層級 OK");
})();

// ---------------- 2. 新局、地圖、建造、組裝期、倉庫、市場、存檔 ----------------
var Core = window.PriTestEnnichiCore;
(function () {
  var s = Core.newGame({ seed: 7 }), M = D.MAP;
  assert.strictEqual(s.phase, "plan"); assert.strictEqual(s.cash, D.START_CASH);
  for (var x = 0; x < M.SHRINE.x; x++) assert.ok(Core.isPath(s, x, M.GATE.y), "參道 " + x);
  assert.ok(Object.keys(s.structs).some(function (k) { return s.structs[k].type === "shrine"; }));
  assert.strictEqual(s.machines.length, D.START_MACHINES.length);
  assert.strictEqual(s.weather.length, D.SEASON_DAYS + 1);
  s.weather.slice(1).forEach(function (w) { assert.ok(D.WEATHER[w], "天氣：" + w); });
  assert.strictEqual(Core.weatherOf(s, 3), s.weather[3]);
  var a = Core.newGame({ seed: 99 }), b = Core.newGame({ seed: 99 });
  assert.deepStrictEqual(a.weather, b.weather, "天氣可重播");
  // 一般設施：當天完成
  var r = Core.build(s, "takoyakiSt", 10, 8);
  assert.ok(r.ok); assert.strictEqual(s.structs[r.sid].build, 0);
  // 大型設施：沒有模組不能蓋；有模組就進入施工
  assert.strictEqual(Core.canBuild(s, "merry", 4, 6).err, "parts");
  Core.give(s, D.BUILD.merry.parts);
  assert.strictEqual(Core.canBuild(s, "merry", 4, 5).err, "entrance");
  r = Core.build(s, "merry", 4, 6);
  assert.ok(r.ok); var merry = s.structs[r.sid];
  assert.strictEqual(merry.build, D.BUILD.merry.days, "施工中");
  assert.deepStrictEqual(merry.mods, {}); assert.strictEqual(merry.ticket, false);
  assert.deepStrictEqual(Core.entranceOf(merry), { x: 6, y: 10 });
  assert.strictEqual(Core.canBuild(s, "kingyo", 5, 8).err, "occupied");
  assert.strictEqual(Core.canBuild(s, "kingyo", 23, 8).err, "locked");
  assert.strictEqual(Core.canBuild(s, "kingyo", 31, 19).err, "bounds");
  assert.strictEqual(Core.canBuild(s, "wheel", 10, 4).err, "level");
  // 排隊屋台：附近要有遊樂設施
  assert.strictEqual(Core.canBuild(s, "qstall", 18, 9).err, "noride");
  r = Core.build(s, "qstall", 8, 9); // 入口 (8,10)，旋轉木馬入口 (6,10) 在 2 格內
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(s.structs[r.sid].link, merry.id);
  // 施工中拆除：模組退一半
  var cash = s.cash;
  assert.ok(Core.demolish(s, merry.id));
  assert.strictEqual(s.ware.lionPost, Math.floor(6 * D.REFUND));
  assert.strictEqual(s.cash, cash + Math.floor(D.BUILD.merry.cash * D.REFUND));
  // 步道、市場、機器
  cash = s.cash;
  assert.ok(Core.setPath(s, 6, 11, true)); assert.strictEqual(s.cash, cash - D.PATH_COST);
  assert.ok(Core.buy(s, "wood", 5)); assert.ok(!Core.buy(s, "plank", 1), "零件不能買");
  assert.ok(!Core.buy(s, "wood", D.WARE_CAP), "超過倉庫上限");
  assert.strictEqual(Core.machineSlots(s), D.MACHINE_SLOTS);
  s.rep = 160; assert.strictEqual(Core.popLevel(s), 3); assert.strictEqual(Core.machineSlots(s), D.MACHINE_SLOTS + 2 * D.MACHINE_SLOTS_PER_LV);
  assert.ok(Core.addMachine(s, "assembly"));
  assert.ok(Core.setRecipe(s, s.machines.length - 1, "turntable"));
  assert.ok(!Core.setRecipe(s, s.machines.length - 1, "plank"), "組裝台不能製材");
  var t = Core.restore(Core.serialize(s));
  assert.deepStrictEqual(t, s); assert.strictEqual(Core.restore("{bad"), null);
  console.log("2. 核心（地圖、建造、組裝期、倉庫）OK");
})();

// ---------------- 3. 工房 ----------------
(function () {
  var s = Core.newGame({ seed: 3 });
  s.ware = { wood: 2, iron: 1 };
  s.machines = [{ type: "saw", rid: "plank", t: null }, { type: "press", rid: "sheet", t: null }, { type: "weld", rid: "frame", t: null }];
  s.today = { made: {} };
  Core.workshopStep(s);
  assert.strictEqual(s.ware.wood, 1); assert.strictEqual(s.machines[0].t, 0);
  assert.strictEqual(s.machines[2].t, null, "焊接台缺料不開工");
  for (var i = 0; i < 3; i++) Core.workshopStep(s);
  assert.strictEqual(s.ware.plank, 2, "3 分鐘後產出 2 木板"); assert.strictEqual(s.today.made.plank, 2);
  assert.strictEqual(s.machines[0].t, null, "產出那一分鐘歸零待機");
  Core.workshopStep(s);
  assert.strictEqual(s.machines[0].t, 0, "下一分鐘取第 2 根原木"); assert.strictEqual(s.ware.wood || 0, 0);
  // 三層：木板 → 雕刻木件 → 彩繪唐獅子
  var t = Core.newGame({ seed: 4 });
  t.ware = { plank: 4, paint: 1 }; t.today = { made: {} };
  t.machines = [{ type: "carve", rid: "carving", t: null }, { type: "lacquer", rid: "lion", t: null }];
  for (i = 0; i < 30; i++) Core.workshopStep(t);
  assert.strictEqual(t.ware.lion, 1, "兩個雕刻木件＋彩漆 → 彩繪唐獅子");
  // 倉庫滿了不開工
  var u = Core.newGame({ seed: 5 });
  u.ware = { wood: D.WARE_CAP }; u.machines = [{ type: "saw", rid: "plank", t: null }];
  Core.workshopStep(u);
  assert.strictEqual(u.machines[0].t, null, "放不下產出就不開工");
  console.log("3. 工房 OK");
})();
