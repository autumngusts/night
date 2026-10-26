// DÉJÀ VU 賽道＋物理的自動檢查（node 直接跑，不需要瀏覽器）：
//   node tools/dejavu_check/core_check.js [場數，預設 40]
// 檢查：
//   1. 固定山路的長度、角度與資料一致，沒有路面重疊
//   2. 同一組設定＋同一個 seed 跑兩次，結果完全相同（Déjà vu 重播）；比賽中的戰略指令照紀錄重播也一致
//   3. 隨機山路／隨機組車的同時出發比賽：不丟例外、數值不是 NaN、每台車都會完賽或退賽、名次不重複
//   4. 夏天全部「穩健」的車在固定山路上應該全部完賽；冬天穿夏胎全力進攻要比穿雪胎穩健危險
"use strict";

global.window = global;
require("../../static_src/dejavu_data.js");
require("../../static_src/dejavu_core.js");
var D = global.PriTestDejavuData;
var Core = global.PriTestDejavuCore;
var runs = Number(process.argv[2]) || 40;
var fails = 0;

function ok(cond, msg) { if (!cond) { fails++; console.log("✗ " + msg); } }

// 1. 固定山路
D.COURSES.forEach(function (co) {
  var course = Core.fixedCourse(co.id);
  var tr = Core.buildTrack(course, { season: "summer", seed: 1 });
  var info = Core.trackInfo(tr);
  var want = co.segs.reduce(function (a, s) { return a + (s[0] === "C" ? s[1] : 0); }, 0) * Math.PI / 180;
  var got = tr.h[tr.N - 1] - tr.h[0];
  ok(Math.abs(got - want) < 0.02, co.id + " 總轉角 " + got.toFixed(3) + " ≠ " + want.toFixed(3));
  ok(Math.abs(info.len - Core.courseLen(course)) < 8, co.id + " 長度不一致 " + info.len + " vs " + Core.courseLen(course));
  ok(info.cross === 0, co.id + " 有路面重疊 " + info.cross);
  ok(info.drop > 0, co.id + " 下坡卻沒有落差");
  var up = Core.trackInfo(Core.buildTrack(course, { season: "summer", seed: 1, dir: "up" }));
  ok(up.drop < 0, co.id + " 上坡應該是爬升");
});

function randomCars(r, n) {
  var list = [];
  for (var i = 0; i < n; i++) {
    var custom = r() < 0.15;
    var spec = {
      car: custom ? "custom" : D.CARS[Math.floor(r() * D.CARS.length)].id,
      tire: D.TIRE_IDS[Math.floor(r() * 4)], aero: Math.floor(r() * 6), gear: Math.floor(r() * 5) - 2,
      style: D.STYLE_IDS[Math.floor(r() * 3)], up: { eng: Math.floor(r() * 3), wt: Math.floor(r() * 3), brk: 1, hdl: 0 },
      custom: { drive: D.DRIVES[Math.floor(r() * 5)], kw: 60 + r() * 440, kg: 700 + r() * 1500, grip: 1, brk: 1, hdl: 1, vmax: 250 }
    };
    list.push({ spec: spec, name: "car" + i });
  }
  return list;
}

function summary(race) { return JSON.stringify(Core.results(race).map(function (x) { return [x.id, x.state, x.time, x.spins, x.overtakes]; })); }

// 2. 決定論
(function () {
  var r = Core.rng(42);
  var opts = { course: Core.fixedCourse("akina"), season: "winter", mode: "battle", seed: 777, cars: randomCars(r, 6) };
  var a = summary(Core.runToEnd(Core.createRace(opts)));
  var b = summary(Core.runToEnd(Core.createRace(JSON.parse(JSON.stringify(opts)))));
  ok(a === b, "同一個 seed 結果不同（Déjà vu 失效）");
  var c = summary(Core.runToEnd(Core.createRace(Object.assign({}, opts, { seed: 778 }))));
  ok(a !== c, "換 seed 結果卻完全一樣（亂數沒有作用）");
})();

// 2b. 比賽中下戰略指令：照紀錄重播要完全一致；沒下指令要不一樣
(function () {
  var r = Core.rng(7);
  var opts = { course: Core.fixedCourse("myogi"), season: "autumn", mode: "battle", seed: 4242, cars: randomCars(r, 5) };
  opts.cars[3].cpu = true; opts.cars[4].cpu = true;
  var race = Core.createRace(opts);
  for (var k = 0; k < 4000 && !race.done; k++) {
    if (k === 200) Core.command(race, 0, "attack");
    if (k === 900) Core.command(race, 1, "defend");
    if (k === 2000) Core.command(race, 0, "calm");
    Core.step(race, Core.DT);
  }
  Core.runToEnd(race);
  ok(race.log.length === 3, "戰略指令沒有被記錄 " + race.log.length);
  var replay = Core.runToEnd(Core.createRace(Object.assign({}, opts, { cmds: race.log })));
  ok(summary(replay) === summary(race), "帶指令紀錄重播結果不同");
  ok(summary(Core.runToEnd(Core.createRace(opts))) !== summary(race), "下了戰略指令結果卻沒變");
  ok(!Core.command(race, 0, "attack"), "比賽結束後不該接受指令");
})();

// 3. 隨機壓力測試
var stats = { fin: 0, dnf: 0, passes: 0, spins: 0, time: 0 };
for (var n = 0; n < runs; n++) {
  var r = Core.rng(9000 + n);
  var course = n % 3 === 0 ? Core.fixedCourse(D.COURSES[n % D.COURSES.length].id) : Core.randomCourse(5000 + n, 1500 + r() * 3000);
  var race;
  try {
    race = Core.createRace({
      course: course, season: D.SEASON_IDS[n % 4], mode: n % 5 === 0 ? "attack" : "battle", dir: n % 7 === 0 ? "up" : "down",
      seed: 100 + n, cars: randomCars(r, 2 + Math.floor(r() * 7))
    });
    var steps = 0;
    while (!race.done && steps < 100000) {
      Core.step(race, Core.DT); steps++;
      if (steps % 300 === 0) race.cars.forEach(function (c) {
        ok(isFinite(c.s) && isFinite(c.v) && c.v >= 0 && c.v < 120, "第 " + n + " 場 車 " + c.id + " 數值異常 s=" + c.s + " v=" + c.v);
      });
    }
    ok(race.done, "第 " + n + " 場沒有結束");
    var res = Core.results(race);
    var pos = res.map(function (x) { return x.pos; });
    ok(pos.join() === res.map(function (_, i) { return i + 1; }).join(), "名次不連續");
    res.forEach(function (x) {
      ok(x.state === "fin" || x.state === "dnf", "第 " + n + " 場 有車沒完賽也沒退賽");
      if (x.state === "fin") { stats.fin++; stats.time += x.time; } else stats.dnf++;
      stats.passes += x.overtakes; stats.spins += x.spins;
    });
  } catch (e) {
    fails++;
    console.log("✗ 第 " + n + " 場例外：" + (e.stack || e));
  }
}
console.log("隨機 " + runs + " 場：完賽 " + stats.fin + "、退賽 " + stats.dnf + "、超車 " + stats.passes + "、打滑 " + stats.spins);
ok(stats.passes > 0, "隨機比賽中完全沒有超車");

// 4. 季節與風格的方向性
function rate(season, tire, style, mode) {
  var dnf = 0, spins = 0, total = 0;
  for (var k = 0; k < 15; k++) {
    var race = Core.runToEnd(Core.createRace({
      course: Core.fixedCourse(D.COURSES[k % D.COURSES.length].id), season: season, mode: mode || "attack", seed: 300 + k,
      cars: ["ae86", "fd3s", "gc8", "ek9", "gt3", "r32"].map(function (id) { return { spec: { car: id, tire: tire, style: style } }; })
    }));
    Core.results(race).forEach(function (x) { total++; if (x.state !== "fin") dnf++; spins += x.spins; });
  }
  return { dnf: dnf / total, spins: spins / total };
}
var safe = rate("summer", "sport", "calm");
ok(safe.dnf === 0, "夏天穩健竟然有人退賽 " + safe.dnf);
var risky = rate("winter", "soft", "attack"), careful = rate("winter", "snow", "calm");
console.log("冬天 軟胎全力進攻：退賽率 " + risky.dnf.toFixed(2) + " 打滑 " + risky.spins.toFixed(2) + "／雪胎穩健：退賽率 " + careful.dnf.toFixed(2) + " 打滑 " + careful.spins.toFixed(2));
ok(risky.spins > careful.spins + 0.5, "冬天軟胎全力進攻應該比雪胎穩健更常打滑");

// 5. 第三批：零件、特殊路面、組合技、車款數量
(function () {
  ok(D.CARS.length >= 50, "車款不到 50 款：" + D.CARS.length);
  var ids = {};
  D.CARS.forEach(function (c) {
    ok(!ids[c.id], "車款 id 重複 " + c.id); ids[c.id] = 1;
    ok(D.BRANDS.some(function (b) { return b.id === c.brand; }), c.id + " 的廠牌不存在 " + c.brand);
    var st = Core.carStats({ car: c.id });
    ok(isFinite(st.pi) && st.pi > 0 && isFinite(st.vtop), c.id + " 數值異常");
  });
  D.PIECES.forEach(function (p) {
    var segs = Core.expandPiece(p.id, -1, 9);
    ok(segs.length > 0 && segs.every(function (s) { return Core.segLen(s) > 0; }), p.id + " 展開失敗");
  });
  // 盲坡的坡度寫死，不吃玩家選的坡度
  ok(Core.expandPiece("crest", 1, 9)[1].g === 12, "盲坡的固定坡度被覆蓋了");
  ok(Core.expandPiece("gravel", 1, 5)[0].sf === "gravel" && Core.expandPiece("gravel", 1, 5)[0].g === 5, "碎石路的 sf／坡度不對");
  ok(Core.cleanSeg({ t: "S", len: 100, sf: "tunnel" }).sf === "tunnel" && !Core.cleanSeg({ t: "S", len: 100, sf: "lava" }).sf, "cleanSeg 沒有正確保留／過濾 sf");
  // 特殊路面的抓地：碎石 < 1、溝落 > 1、隧道在雨天／冬天不受影響、橋在冬天打折
  function surfOf(id, season, rain) {
    var course = { w: 6.5, g: 5, segs: [{ t: "S", len: 100, g: null }].concat(Core.expandPiece(id, 1, null), [{ t: "S", len: 100, g: null }]) };
    var tr = Core.buildTrack(course, { season: season, seed: 3, rain: rain });
    var i = Math.round((tr.start + 100 + 10) / tr.ds);
    return tr.surf[i];
  }
  ok(Math.abs(surfOf("gravel", "summer", false) - 0.72) < 1e-6, "碎石抓地不是 0.72");
  ok(surfOf("gutter_hairpin", "summer", false) > 1.1, "溝落沒有抓地加成");
  ok(Math.abs(surfOf("tunnel", "spring", true) * 0.78 - 1) < 1e-6, "隧道裡還在下雨");
  ok(surfOf("tunnel", "winter", false) > 1.3, "隧道裡還有積雪");
  ok(Math.abs(surfOf("bridge", "winter", false) - 0.8) < 0.2 && surfOf("bridge", "winter", false) <= 0.8, "冬天的橋沒有先結冰");
  // 組合技
  var course = { w: 6.5, g: 7, segs: [{ t: "S", len: 120, g: null }] }, pieces = [];
  ["straight_l", "hairpin", "hairpin", "tight", "gravel", "gravel_corner", "tunnel", "hairpin_wide"].forEach(function (id, n) {
    var segs = Core.expandPiece(id, n % 2 ? 1 : -1, null);
    course.segs = course.segs.concat(segs); pieces.push({ o: n % 3, n: segs.length });
  });
  var got = Core.findCombos(course, pieces).map(function (c) { return c.id; });
  ["late_brake", "rally", "dark_hairpin"].forEach(function (id) { ok(got.indexOf(id) >= 0, "組合技沒有成立：" + id + "（得到 " + got.join(",") + "）"); });
  ok(got.indexOf("hairpin_hell") < 0, "只有兩個髮夾不該算髮夾地獄");
  // 全部特殊零件串起來跑一場：不丟例外、全部結束
  var all = { w: 6.5, g: 6, segs: [{ t: "S", len: 150, g: null }] };
  ["crest", "dive", "gutter_hairpin", "gravel", "tunnel_curve", "bridge", "snake", "fishhook", "carousel", "double_apex", "switchback", "cliff_run", "dip", "gravel_corner", "tunnel"].forEach(function (id, n) {
    all.segs = all.segs.concat(Core.expandPiece(id, n % 2 ? 1 : -1, null));
  });
  ["summer", "winter"].forEach(function (season) {
    var race = Core.runToEnd(Core.createRace({ course: all, season: season, mode: "battle", seed: 55,
      cars: ["ae86", "gryaris", "m720s", "cappuccino", "ioniq5n", "huracan"].map(function (id) { return { spec: { car: id, style: "balanced" } }; }) }));
    ok(race.done, "特殊零件賽道（" + season + "）沒有結束");
    Core.results(race).forEach(function (x) { ok(x.state === "fin" || x.state === "dnf", "特殊零件賽道有車卡住"); });
  });
})();

console.log(fails ? "✗ 失敗 " + fails + " 項" : "✓ 全部通過");
process.exit(fails ? 1 : 0);
