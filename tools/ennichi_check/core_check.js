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

// ---------------- 4. 模組改裝 ----------------
function finishAll(s) { for (var k in s.structs) s.structs[k].build = 0; }
(function () {
  var s = Core.newGame({ seed: 8 });
  Core.give(s, D.BUILD.merry.parts);
  var merry = s.structs[Core.build(s, "merry", 4, 6).sid];
  Core.give(s, { nightLanterns: 2, fastTurntable: 1 });
  assert.ok(!Core.upgrade(s, merry.id, "light"), "施工中不能改裝");
  finishAll(s);
  var base = Core.effStats(merry);
  assert.deepStrictEqual(base, { thrill: 1, charm: 3, photo: 2, price: 300, wearMul: 1 });
  assert.ok(!Core.upgrade(s, merry.id, "deco"), "沒有金箔唐獅子");
  assert.ok(!Core.upgrade(s, merry.id, "nope"), "沒有這個槽");
  assert.ok(Core.upgrade(s, merry.id, "light"));
  assert.ok(!s.ware.nightLanterns, "用掉 2 個夜光燈籠串");
  assert.ok(!Core.upgrade(s, merry.id, "light"), "同一槽只能裝一次");
  assert.ok(Core.upgrade(s, merry.id, "drive"));
  var e = Core.effStats(merry);
  assert.deepStrictEqual(e, { thrill: 2, charm: 4, photo: 3, price: 300, wearMul: 1.5 });
  merry.price = 400; assert.strictEqual(Core.effStats(merry).price, 400);
  Core.give(s, { goldLion: 2 }); assert.ok(Core.upgrade(s, merry.id, "deco"));
  assert.strictEqual(Core.effStats(merry).price, 450, "金箔唐獅子 票價 +50");
  // 營業中不能改裝：另蓋一座咖啡杯、完工後在營業中嘗試
  Core.give(s, D.BUILD.cups.parts);
  var cups = s.structs[Core.build(s, "cups", 16, 7).sid];
  finishAll(s); Core.give(s, { fastTurntable: 1 });
  s.phase = "open";
  assert.ok(!Core.upgrade(s, cups.id, "drive"), "營業中不能改裝");
  s.phase = "plan";
  assert.ok(Core.upgrade(s, cups.id, "drive"));
  console.log("4. 模組改裝 OK");
})();

// ---------------- 5. 客人：生成、尋路、選目的地 ----------------
var Sim = window.PriTestEnnichiSim;
function freshPark(seed) {
  var s = Core.newGame({ seed: seed || 11 });
  Core.give(s, D.BUILD.merry.parts);
  Core.build(s, "merry", 4, 6);         // 入口 (6,10)
  Core.build(s, "takoyakiSt", 10, 8);   // 入口 (11,10)
  Core.build(s, "bench", 14, 9);        // 入口 (14,10)
  finishAll(s);
  return s;
}
function sidOf(s, type) { return +Object.keys(s.structs).filter(function (k) { return s.structs[k].type === type; })[0]; }
(function () {
  var s = freshPark();
  var gate = Sim.distField(s, "gate");
  assert.strictEqual(gate[Core.ti(5, 10)], 5); assert.strictEqual(gate[Core.ti(5, 5)], -1);
  assert.strictEqual(Sim.distField(s, sidOf(s, "merry"))[Core.ti(0, 10)], 6);
  assert.strictEqual(Sim.distField(s, "gate"), gate, "快取");
  Core.setPath(s, 3, 11, true); assert.notStrictEqual(Sim.distField(s, "gate"), gate, "改地圖後重算");
  // 來客數（第 1 天的天氣依種子而定 → 固定成晴天檢查公式）
  s.weather[1] = "sun"; assert.strictEqual(Sim.arrivals(s), 30);
  s.weather[1] = "rain"; assert.strictEqual(Sim.arrivals(s), Math.round(30 * 0.6));
  s.day = 6; s.weather[6] = "sun"; s.rep = 100; assert.strictEqual(Sim.arrivals(s), Math.round(90 * 1.8));
  s.day = 1; s.rep = 0; s.weather[1] = "sun";
  var sch = Sim.spawnSchedule(s);
  assert.strictEqual(sch.length, 30);
  assert.ok(sch.every(function (m, i) { return m >= D.DAY_START && m <= D.LAST_ENTRY && (i === 0 || m >= sch[i - 1]); }));
  s.today = { guests: 0, fees: 0, rev: 0, murmurs: [], topics: {}, closed: [], sales: {} };
  var cash = s.cash, g = Sim.spawn(s);
  assert.deepStrictEqual([g.x, g.y], [0, 10]); assert.strictEqual(s.cash, cash + s.fee);
  assert.strictEqual(g.need.dry, 0); assert.strictEqual(g.kasa, false);
  g.need = { fun: 0, hunger: 90, thirst: 0, toilet: 0, fatigue: 0, dry: 0 };
  assert.strictEqual(s.structs[Sim.choose(s, g)].type, "takoyakiSt");
  g.need = { fun: 0, hunger: 0, thirst: 0, toilet: 0, fatigue: 90, dry: 0 };
  assert.strictEqual(s.structs[Sim.choose(s, g)].type, "bench");
  g.need = { fun: 0, hunger: 0, thirst: 90, toilet: 0, fatigue: 0, dry: 0 };
  assert.strictEqual(Sim.choose(s, g), null, "沒有汽水攤");
  // 施工中、停駛的不選
  g.need = { fun: 90, hunger: 0, thirst: 0, toilet: 0, fatigue: 0, dry: 0 };
  s.structs[sidOf(s, "merry")].build = 1;
  assert.strictEqual(s.structs[Sim.choose(s, g)].type, "shrine", "旋轉木馬施工中 → 只能去參拜");
  s.structs[sidOf(s, "merry")].build = 0; s.today.closed = ["merry"];
  assert.strictEqual(s.structs[Sim.choose(s, g)].type, "shrine", "停駛中");
  s.today.closed = [];
  g.need = { fun: 0, hunger: 90, thirst: 0, toilet: 0, fatigue: 0, dry: 0 };
  g.sid = Sim.choose(s, g);
  assert.ok(!Sim.moveToward(s, g, g.sid)); assert.strictEqual(g.x, 2);
  for (var i = 0; i < 10 && !Sim.moveToward(s, g, g.sid); i++);
  assert.deepStrictEqual([g.x, g.y], [11, 10]);
  var h = g.need.hunger; Sim.needsTick(s, g); assert.ok(g.need.hunger > h);
  console.log("5. 客人（生成、尋路、選目的地）OK");
})();

// ---------------- 6. 排隊、搭乘、攤位、故障、murmur ----------------
var Murmur = window.PriTestEnnichiMurmur;
function openToday(s) {
  s.phase = "open"; s.min = D.DAY_START;
  s.today = { guests: 0, left: 0, rev: 0, fees: 0, hapSum: 0, hapN: 0, sns: 0, made: {}, sales: {}, spawn: [], murmurs: [], topics: {}, weather: "cloud", closed: [], wishesDone: 0 };
}
function walker(s, x, y, sid, need) {
  var g = Sim.spawn(s); g.cash = 5000; g.x = x; g.y = y; g.sid = sid;
  g.need = { fun: 0, hunger: 0, thirst: 0, toilet: 0, fatigue: 0, dry: 0 };
  for (var k in need) g.need[k] = need[k];
  return g;
}
(function () {
  var s = freshPark(21); openToday(s);
  var g = Sim.spawn(s);
  var m = Murmur.say(s, g, "complaint", "queue", { ride: D.BUILD.merry.name });
  assert.ok(m.text.zh.length > 0 && m.text.zh.indexOf("{") < 0, "範本的變數都有換掉");
  assert.strictEqual(s.today.topics.queue, 1); assert.deepStrictEqual(Murmur.topTopics(s, 1), [["queue", 1]]);
  var mp = Murmur.say(s, g, "sns", "photo", { ride: D.BUILD.merry.name }), mg = Murmur.say(s, g, "sns", "goods", { item: D.ITEMS.takoyaki.name });
  assert.ok(mp.text.zh.indexOf(D.BUILD.merry.name.zh) >= 0, "photo 的 sns 含設施名");
  assert.ok(mg.text.zh.indexOf(D.ITEMS.takoyaki.name.zh) >= 0, "goods 的 sns 含商品名");
  // 搭乘
  var merry = s.structs[sidOf(s, "merry")];
  g = walker(s, 6, 10, merry.id, { fun: 90 });
  Sim.step(s); assert.strictEqual(g.state, "queue", "先排隊（設施在客人之前處理）");
  Sim.step(s); assert.strictEqual(g.state, "ride", "下一分鐘上車");
  assert.strictEqual(merry.waitN, 1);
  for (var i = 0; i < D.BUILD.merry.cycle; i++) Sim.step(s);
  assert.strictEqual(g.state, "walk"); assert.ok(g.need.fun < 90); assert.strictEqual(g.rides, 1);
  assert.strictEqual(merry.wear, D.BUILD.merry.wear);
  assert.ok(s.today.rev >= merry.price);
  // 改裝過的磨損倍率
  merry.mods.drive = 1; merry.wear = 0;
  var g3 = walker(s, 6, 10, merry.id, { fun: 90 });
  for (i = 0; i < 2 + D.BUILD.merry.cycle; i++) Sim.step(s);
  assert.strictEqual(merry.wear, D.BUILD.merry.wear * 1.5, "高速迴轉台 磨損 ×1.5");
  delete merry.mods.drive;
  // 故障
  merry.wear = 99; merry.riders = []; merry.t = 0;
  g = walker(s, 6, 10, merry.id, { fun: 90 }); g.state = "queue"; merry.q = [g.id];
  var g2 = walker(s, 6, 10, merry.id, { fun: 90 });
  Sim.step(s);
  for (i = 0; i < D.BUILD.merry.cycle; i++) Sim.step(s);
  assert.ok(merry.broken); assert.strictEqual(merry.q.length, 0); assert.notStrictEqual(g2.state, "queue");
  // 攤位
  var t = freshPark(22); openToday(t);
  var c = walker(t, 11, 10, sidOf(t, "takoyakiSt"), { hunger: 90 });
  t.ware.takoyaki = 1;
  Sim.step(t);
  assert.strictEqual(t.ware.takoyaki || 0, 0); assert.ok(c.need.hunger < 90);
  assert.strictEqual(t.today.rev, D.ITEMS.takoyaki.sell); assert.strictEqual(t.today.sales.takoyaki, 1);
  assert.ok(t.dirt >= 1, "附近沒有垃圾桶 → 髒亂");
  var c2 = walker(t, 11, 10, sidOf(t, "takoyakiSt"), { hunger: 90 });
  var hap = c2.hap; Sim.step(t); assert.ok(c2.hap < hap, "賣完了心情下降");
  // 排隊太久
  var u = freshPark(23); openToday(u);
  var mm = u.structs[sidOf(u, "merry")]; mm.riders = [999]; mm.t = 50;
  var w = walker(u, 6, 10, mm.id, { fun: 90 });
  for (i = 0; i <= w.patience + 1; i++) Sim.step(u);
  assert.strictEqual(mm.q.indexOf(w.id), -1, "超過耐心離隊");
  // 離場
  u.min = D.DAY_END;
  for (i = 0; i < 40 && u.guests.length; i++) { Sim.step(u); u.min++; }
  assert.strictEqual(u.guests.length, 0); assert.ok(u.today.hapN >= 1);
  console.log("6. 搭乘、攤位、故障、murmur OK");
})();

// ---------------- 7. 天氣 ----------------
(function () {
  var s = freshPark(41); openToday(s);
  s.today.weather = "sun";
  var g = walker(s, 2, 10, null, {});
  Sim.needsTick(s, g); var sunThirst = g.need.thirst;
  s.today.weather = "rain";
  var h = walker(s, 2, 10, null, {});
  Sim.needsTick(s, h);
  assert.ok(h.need.thirst < sunThirst, "雨天比較不渴");
  assert.ok(h.need.dry > 0, "沒有傘會淋濕");
  h.kasa = true; var d = h.need.dry; Sim.needsTick(s, h); assert.strictEqual(h.need.dry, d, "有傘不再淋濕");
  // 淋濕的客人會去買傘或避雨
  Core.give(s, D.BUILD.kasaSt.parts); s.phase = "plan";
  var kasa = Core.build(s, "kasaSt", 16, 8).sid; s.phase = "open";
  var w = walker(s, 2, 10, null, { dry: 90 });
  assert.strictEqual(Sim.choose(s, w), kasa);
  s.ware.kasa = 2; w.x = 17; w.y = 10; w.sid = kasa;
  Sim.step(s);
  assert.ok(w.kasa && w.need.dry === 0, "買到和傘");
  // 強風：飛椅、摩天輪停駛
  assert.deepStrictEqual(Sim.closedFor(s, "wind").sort(), ["chairs", "wheel"]);
  assert.deepStrictEqual(Sim.closedFor(s, "sun"), []);
  console.log("7. 天氣 OK");
})();

// ---------------- 8. 排隊屋台與整理券 ----------------
(function () {
  var s = freshPark(51);
  var merry = s.structs[sidOf(s, "merry")];
  var qs = s.structs[Core.build(s, "qstall", 8, 9).sid];
  assert.strictEqual(qs.link, merry.id);
  openToday(s);
  merry.riders = [999]; merry.t = 200; // 一直在運轉，隊伍不會前進
  s.ware.ramune = 20;
  var g = walker(s, 6, 10, merry.id, { thirst: 90, fun: 90 }); g.state = "queue"; merry.q = [g.id];
  g.patience = 200; // 測試只看屋台販售，不讓客人因排隊太久離開
  var p0 = g.patience;
  for (var i = 0; i < 60 && g.need.thirst > 40; i++) Sim.step(s);
  assert.ok(g.need.thirst <= 40, "排隊時跟屋台買了汽水");
  assert.ok(g.patience > p0, "買到後耐心增加");
  // 整理券
  var t = freshPark(52); openToday(t);
  var mm = t.structs[sidOf(t, "merry")];
  assert.ok(Core.setTicket(t, mm.id, true)); assert.ok(!Core.setTicket(t, sidOf(t, "bench"), true), "只有遊樂設施");
  mm.riders = [999]; mm.t = 30;
  for (i = 0; i < D.BUILD.merry.cap * D.TICKET_FACTOR; i++) { var q = walker(t, 6, 10, null, { fun: 90 }); q.state = "queue"; q.sid = mm.id; mm.q.push(q.id); }
  var k = walker(t, 6, 10, mm.id, { fun: 90 });
  Sim.step(t);
  assert.ok(k.ticket && k.ticket.sid === mm.id && k.state === "walk", "隊伍太長 → 拿整理券");
  t.min = k.ticket.at;
  k.x = 6; k.y = 10; k.sid = null;
  Sim.step(t);
  assert.strictEqual(mm.q[0], k.id, "回來直接排到最前面"); assert.strictEqual(k.ticket, null);
  console.log("8. 排隊屋台與整理券 OK");
})();

// ---------------- 8b. 整理券修正：未到時間不插隊、設施故障票作廢 ----------------
(function () {
  var t = freshPark(53); openToday(t);
  var mm = t.structs[sidOf(t, "merry")];
  Core.setTicket(t, mm.id, true);
  mm.riders = [999]; mm.t = 30;
  for (var i = 0; i < D.BUILD.merry.cap * D.TICKET_FACTOR; i++) { var q = walker(t, 6, 10, null, { fun: 90 }); q.state = "queue"; q.sid = mm.id; mm.q.push(q.id); }
  var k = walker(t, 6, 10, mm.id, { fun: 90 });
  Sim.step(t);
  assert.ok(k.ticket, "拿到整理券");
  // (a) 未到時間：choose 不會再選該設施；即使人在設施旁也不會插到最前面
  for (i = 0; i < 20; i++) assert.notStrictEqual(Sim.choose(t, k), mm.id, "票未到時間不選該設施");
  var front = mm.q[0];
  k.sid = mm.id; k.x = 6; k.y = 10; k.state = "walk";
  Sim.arrive(t, k);
  assert.strictEqual(mm.q[0], front, "提早到不插隊"); assert.strictEqual(k.ticket, null);
  // (b) 設施故障：票作廢，回到一般選擇
  var u = freshPark(54); openToday(u);
  var m2 = u.structs[sidOf(u, "merry")];
  Core.setTicket(u, m2.id, true);
  var h = walker(u, 6, 10, null, { fun: 90 });
  h.ticket = { sid: m2.id, at: u.min - 1 };
  m2.broken = true;
  Sim.step(u);
  assert.strictEqual(h.ticket, null, "設施故障 → 票作廢");
  assert.notStrictEqual(h.sid, m2.id, "不再鎖定故障設施");
  console.log("8b. 整理券修正 OK");
})();

// ---------------- 9. 繪馬許願 ----------------
var Wish = window.PriTestEnnichiWish;
(function () {
  var s = freshPark(61); openToday(s);
  var g = Sim.spawn(s);
  var cs = Wish.candidates(s, g);
  assert.ok(cs.some(function (c) { return c.kind === "build" && c.target === "kingyo"; }), "可以許願要金魚撈");
  assert.ok(!cs.some(function (c) { return c.kind === "build" && c.target === "merry"; }), "已經有旋轉木馬");
  assert.ok(cs.some(function (c) { return c.kind === "upgrade"; }), "旋轉木馬有空的改裝槽");
  // 強制產生 3 個，第 4 個不會產生
  var made = [];
  for (var i = 0; i < 5; i++) { var w = Wish.maybeMake(s, g, true); if (w) made.push(w); }
  assert.strictEqual(Wish.active(s).length, D.WISH.MAX);
  assert.ok(made.every(function (w) { return w.text.zh.length > 0 && w.text.zh.indexOf("{") < 0; }));
  // 完成「蓋金魚撈」
  s.wishes = []; s.nextWish = 1;
  s.wishes.push({ id: s.nextWish++, kind: "build", target: "kingyo", n: 0, prog: 0, day: s.day, gid: 0, photo: null, text: { zh: "x", ja: "x" }, done: false });
  s.wishes.push({ id: s.nextWish++, kind: "sell", target: "takoyaki", n: 2, prog: 0, day: s.day, gid: 0, photo: null, text: { zh: "x", ja: "x" }, done: false });
  var rep = s.rep;
  s.phase = "plan"; Core.give(s, D.BUILD.kingyo.parts); Core.build(s, "kingyo", 16, 8); s.phase = "open";
  Wish.check(s);
  assert.ok(s.wishes[0].done); assert.strictEqual(s.rep, rep + D.WISH.REWARD.build);
  // 賣出 2 份章魚燒完成 sell
  s.ware.takoyaki = 5;
  for (i = 0; i < 2; i++) { var c = walker(s, 11, 10, sidOf(s, "takoyakiSt"), { hunger: 90 }); Sim.step(s); }
  Wish.check(s);
  assert.ok(s.wishes[1].done, "賣出 2 份");
  // 7 天沒完成撤下並扣口碑
  s.wishes.push({ id: s.nextWish++, kind: "build", target: "toilet", n: 0, prog: 0, day: s.day, gid: 0, photo: null, text: { zh: "x", ja: "x" }, done: false });
  rep = s.rep; s.day += D.WISH.EXPIRE;
  Wish.expire(s);
  assert.ok(!s.wishes.some(function (w) { return w.target === "toilet"; })); assert.strictEqual(s.rep, Math.max(0, rep - D.WISH.PENALTY));
  console.log("9. 繪馬許願 OK");
})();

// ---------------- 10. 日循環、施工進度、結算、修理、季末 ----------------
(function () {
  var s = freshPark(31);
  s.ware.takoyaki = 50; s.weather[1] = "sun"; s.weather[2] = "wind";
  // 施工：第 1 天放下咖啡杯（組裝 1 天）→ 第 2 天營業
  Core.give(s, D.BUILD.cups.parts);
  var cups = s.structs[Core.applyIntent(s, { a: "build", type: "cups", x: 16, y: 7 }).sid];
  assert.strictEqual(cups.build, 1);
  assert.ok(Core.applyIntent(s, { a: "open" }).ok);
  assert.strictEqual(s.today.weather, "sun"); assert.deepStrictEqual(s.today.closed, []);
  assert.ok(!Core.applyIntent(s, { a: "build", type: "bench", x: 15, y: 9 }).ok, "營業中不能蓋");
  Core.tick(s, D.DAY_END - D.DAY_START + 120);
  assert.strictEqual(s.phase, "close"); assert.strictEqual(s.guests.length, 0);
  var sum = s.history[0];
  assert.strictEqual(sum.day, 1); assert.ok(sum.guests > 0); assert.strictEqual(sum.weather, "sun");
  assert.ok(s.rep >= Math.max(0, sum.repDelta), "口碑至少加上當天的變化（繪馬完成會再加）");
  assert.ok(s.today.murmurs.length > 0);
  assert.strictEqual(cups.build, 0, "打烊時施工完成");
  var merry = s.structs[sidOf(s, "merry")];
  assert.ok(merry.lastWait >= 0 && merry.waitN === 0);
  // 第 2 天強風：飛椅、摩天輪停駛清單
  assert.ok(Core.applyIntent(s, { a: "next" }).ok); assert.strictEqual(s.day, 2);
  merry.wear = 100; merry.broken = true; s.ware.gear = 5;
  assert.ok(Core.applyIntent(s, { a: "repair", sid: merry.id }).ok); assert.ok(!merry.broken); assert.strictEqual(s.ware.gear, 3);
  Core.give(s, { nightLanterns: 2 });
  assert.ok(Core.applyIntent(s, { a: "upgrade", sid: merry.id, slot: "light" }).ok);
  assert.ok(Core.applyIntent(s, { a: "ticket", sid: merry.id, on: true }).ok);
  Core.applyIntent(s, { a: "open" });
  assert.deepStrictEqual(s.today.closed.sort(), ["chairs", "wheel"]);
  // 決定性
  function run(seed) { var t = freshPark(seed); Core.applyIntent(t, { a: "open" }); Core.tick(t, 600); return Core.serialize(t); }
  assert.strictEqual(run(77), run(77));
  // 季末
  s.phase = "close"; s.day = D.SEASON_DAYS;
  Core.nextDay(s); assert.strictEqual(s.phase, "season");
  var res = Core.seasonResult(s);
  assert.ok(res.guests >= sum.guests && res.level >= 1 && res.wishes >= 0);
  assert.strictEqual(Core.applyIntent(s, { a: "bogus" }).err, "unknown");
  console.log("10. 日循環、施工進度、結算、修理、季末 OK");
})();
