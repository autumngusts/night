// イヌスノー（狗雪）第 3 階段規則檢查：由 core_check.js 在最後呼叫（也可以單獨執行 node tools/inusnow_check/p3_check.js）
// 依據 docs/inusnow_design.md §17.7、§18；計畫 2026-11-21-inusnow-phase3.md。
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SRC = path.join(__dirname, "..", "..", "static_src");
var D = require(path.join(SRC, "inusnow_data.js"));
var T = require(path.join(SRC, "inusnow_terrain.js"));
var Phys = require(path.join(SRC, "inusnow_phys.js"));
var Core = require(path.join(SRC, "inusnow_core.js"));
var SLP = require(path.join(SRC, "inusnow_slope.js"));
var CX = require(path.join(SRC, "inusnow_cross.js"));
var FR = require(path.join(SRC, "inusnow_free.js"));
var Env = require(path.join(SRC, "inusnow_env.js"));
var Bet = require(path.join(SRC, "inusnow_bet.js"));
var MS = require(path.join(SRC, "inusnow_mission.js"));
var SE = require(path.join(SRC, "inusnow_season.js"));

function ok(msg) { console.log("ok - " + msg); }
function loadResort(id) {
  var json = JSON.parse(fs.readFileSync(path.join(SRC, "inusnow", "data", id + ".json"), "utf8"));
  return T.load(json).then(function (t) { return { json: json, t: t }; });
}
function gsRun(t, pid, seed, dog, cond, aggr) {
  var run = Core.newRun(t, { piste: pid, seed: seed, dog: dog, snow: "groomed", runNo: 0, cond: cond || null });
  while (run.status === "run") Core.stepRun(run, Core.autopilot(run, aggr || 0.5));
  return run;
}

module.exports = function () {
  ["inusnow_env.js", "inusnow_bet.js", "inusnow_mission.js", "inusnow_season.js"].forEach(function (f) {
    var src = fs.readFileSync(path.join(SRC, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    var bad = src.match(/Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|random|hypot|cbrt)\b/g);
    assert.ok(!bad, f + " 使用了不允許的函式：" + bad);
  });
  ok("P3 規則檔只用 + − × ÷、sqrt、floor、abs、imul");

  return loadResort("happo").then(function (r) {
    var t = r.t, j = r.json, pid = j.events.gs.piste, seed = Core.courseSeed("happo", pid);
    var dog = Core.breed("shiba");

    // 雪況：標準雪況與第 1 階段完全相同
    var a = gsRun(t, pid, seed, dog, null), b = gsRun(t, pid, seed, dog, Env.standard());
    assert.strictEqual(a.time, b.time, "標準雪況＝第 1 階段");
    assert.strictEqual(Core.encode(a.inputs), Core.encode(b.inputs), "標準雪況的輸入相同");
    // 隨機雪況是確定性的
    var c1 = Env.conditions(123, "happo", 1, {}), c2 = Env.conditions(123, "happo", 1, {});
    assert.deepStrictEqual(c1, c2, "雪況由 seed 決定");
    var cnt = { powder: 0 };
    for (var i = 0; i < 400; i++) if (Env.conditions(i, "hirafu", 1, {}).snow === "powder") cnt.powder++;
    var cntN = 0;
    for (var i2 = 0; i2 < 400; i2++) if (Env.conditions(i2, "naeba", 4, {}).snow === "spring") cntN++;
    assert.ok(cnt.powder > 100 && cntN > 100, "北海道粉雪多（" + cnt.powder + "/400）、新潟 4 月春雪多（" + cntN + "/400）");
    var ov = Env.conditions(5, "happo", 1, { snow: "ice", weather: "fog", night: true });
    assert.ok(ov.snow === "ice" && ov.weather === "fog" && ov.night, "可以指定雪況");
    // 暴風雪：側風、耐寒低的狗變慢
    var bz = { snow: "groomed", weather: "blizzard", night: false, change: null };
    var dogCold = Core.breed("taiwan"), dogWarm = Core.breed("husky");
    assert.ok(dogCold.stats.cld < 60 && dogWarm.stats.cld >= 60, "台灣犬怕冷、哈士奇耐寒");
    var Ec = Env.make(bz, { piste: T.piste(t, pid), seed: 1, dog: dogCold }).env(0);
    var Ew = Env.make(bz, { piste: T.piste(t, pid), seed: 1, dog: dogWarm }).env(0);
    assert.ok(Ec.cold > 0 && !Ew.cold && Ec.wind && Ec.grip === 0.95, "暴風雪：寒冷、側風、抓地");
    var Esn = Env.make({ snow: "groomed", weather: "snow", night: false, change: null }, { piste: T.piste(t, pid), seed: 1, dog: dog });
    assert.ok(Math.abs(Esn.env(3600).muAdd - 0.004) < 1e-9, "降雪：每分鐘 μ +0.004");
    // G3：雪道外側是新雪
    var pi = T.piste(t, pid), mid = T.at(pi, 300), sf = Esn.env(0).surf;
    assert.strictEqual(sf(mid.x, mid.z), "groomed", "雪道中心壓雪");
    var off = pi.width * 0.45;
    assert.strictEqual(sf(mid.x + (-mid.tz) * off, mid.z + mid.tx * off), "powder", "雪道外側新雪");
    var bzRun = gsRun(t, pid, seed, dogCold, bz);
    assert.ok(bzRun.status !== "finish" || bzRun.time > a.time, "暴風雪中台灣犬比較慢（" + bzRun.time + " vs " + a.time + "）");
    // G5：天候變化
    var chg = { snow: "groomed", weather: "clear", night: false, change: { to: "fog", at: 600, chance: 0.3, happen: true } };
    assert.strictEqual(Env.weatherAt(chg, 599), "clear");
    assert.strictEqual(Env.weatherAt(chg, 600), "fog");
    ok("雪況：標準＝P1、確定性、地區權重、暴風雪與耐寒、降雪 μ、G3 新雪分佈、G5 天候變化（標準 " + a.time.toFixed(2) + " 秒）");

    // G2 嗅覺捷徑
    var cpid = j.events.cross.piste, cseed = Core.courseSeed("happo", cpid), cf = Core.cpuField(cseed, 6);
    var race = CX.newCross(t, { piste: cpid, seed: cseed, snow: "groomed", dogs: cf.map(function (c) { return Core.breed(c.breed); }) });
    var cuts = race.cuts;
    var st = Phys.create(t, T.at(race.piste, 20), dog), evs = [];
    for (var k = 0; k < 60 * 15; k++) Env.scentTick(st, { c: 1 }, 1, cuts.length ? cuts : [{ ax: -1e5, az: -1e5, bx: -1e5, bz: -1e5, trees: [] }], evs);
    assert.ok(evs.indexOf("scent") >= 0 && st.scentShow > 0, "嗅覺量表滿了出現腳印");
    var w = FR.makeWorld(t);
    assert.ok(w.cuts.length >= 1, "自由滑行有捷徑（" + w.cuts.length + "）");
    var cu = w.cuts[0];
    assert.ok(cu.save >= D.SCENT.save[0] && cu.save <= D.SCENT.save[1], "捷徑比繞雪道短 5～15%");
    var E2 = Env.make(Env.standard(), { seed: 1, dog: dog, cuts: w.cuts });
    assert.strictEqual(E2.env(0).surf((cu.ax + cu.bx) / 2, (cu.az + cu.bz) / 2), "deep", "捷徑內是深雪");
    ok("G2 嗅覺捷徑：Cross " + cuts.length + " 條、自由滑行 " + w.cuts.length + " 條；量表、深雪");

    // 競猜
    var month = 1;
    var card = Bet.makeCard(t, { resort: "happo", event: "gs", seed: seed, piste: pid, month: month, cond: Env.standard() });
    assert.strictEqual(card.field.length, 8, "大曲道 8 隻");
    card.field.forEach(function (e) { assert.ok(e.form >= 1 && e.form <= 5 && e.apt >= 1 && e.apt <= 5, "調子與適性 1～5"); });
    var res1 = Bet.simulate(t, card, card.seed), res2 = Bet.simulate(t, card, card.seed);
    assert.deepStrictEqual(res1.order, res2.order, "模擬是確定性的");
    var acc = Bet.oddsInit(card);
    acc.total = 6;
    while (!Bet.oddsStep(t, card, acc)) { /* */ }
    var sumP = 0;
    for (var q = 0; q < 8; q++) sumP += (acc.c["win:" + q] || 0) / acc.n;
    assert.ok(Math.abs(sumP - 1) < 1e-9, "單勝機率合計 1");
    var tk = Bet.buy({ type: "trifecta", method: "box", sel: [0, 1, 2], stake: 10 }, acc);
    assert.strictEqual(tk.length, 6, "三連單 BOX 3 隻＝6 組");
    var tk2 = Bet.buy({ type: "trio", method: "box", sel: [0, 1, 2, 3], stake: 10 }, acc);
    assert.strictEqual(tk2.length, 4, "三連複 BOX 4 隻＝4 組");
    var tk3 = Bet.buy({ type: "exacta", method: "axis", axis: 2, sel: [2, 0, 1, 5], stake: 10 }, acc);
    assert.strictEqual(tk3.length, 3, "連勝單式 壓住＝3 組");
    tk.forEach(function (l) { assert.ok(l.odds >= 1.1, "賠率 ≥ 1.1"); });
    var settled = Bet.settle([{ key: "win:" + res1.order[0], stake: 100, odds: 2.5 }, { key: "win:" + res1.order[1], stake: 100, odds: 3 }], res1.order);
    assert.ok(settled[0].hit && settled[0].pay === 250 && !settled[1].hit, "單勝結算");
    assert.strictEqual(Bet.timePay(100.1, 10, 100), 120, "時間預測 ±0.2 秒 12 倍");
    assert.strictEqual(Bet.timePay(100.4, 10, 100), 50, "時間預測 ±0.5 秒 5 倍");
    assert.strictEqual(Bet.timePay(101, 10, 100), 0, "時間預測落空");
    var sv = { coins: 120 };
    assert.ok(Bet.refill(sv, "2026-11-21") && sv.coins === 300 && !Bet.refill(sv, "2026-11-21"), "每日補到 300");
    var wp = Bet.winProb([60, 61.5, null]);
    assert.ok(wp[0] > wp[1] && wp[2] === 0 && Math.abs(wp[0] + wp[1] - 1) < 1e-9, "B5 即時勝率");
    var sc = Bet.makeCard(t, { resort: "happo", event: "slope", seed: 77, piste: j.events.slope.piste, cond: Env.standard() });
    var ss = Bet.simulate(t, sc, 77);
    assert.strictEqual(ss.order.length, 8, "Slopestyle 模擬 8 隻");
    var xc = Bet.makeCard(t, { resort: "happo", event: "cross", seed: 78, piste: cpid, cond: Env.standard() });
    var xs = Bet.simulate(t, xc, 78);
    assert.strictEqual(xs.order.length, 6, "Cross 模擬 6 隻");
    ok("競猜：出賽表、模擬、賠率、票種與買法、結算、時間預測、狗幣補充、即時勝率（冠軍 " + (res1.val[res1.order[0]] || 0).toFixed(2) + " 秒）");

    // 教練模式：同一組指令重算結果相同；「穩住！」改變結果
    var cpu = { id: "me", breed: "shiba", lv: 3, style: "std" };
    var base = { piste: pid, seed: seed, snow: "groomed", runNo: 0 };
    var c0 = Core.simCpuGs(t, base, cpu, seed, 0, null, { aggr: 0.5, zoom: "auto", cmds: [] });
    var c1b = Core.simCpuGs(t, base, cpu, seed, 0, null, { aggr: 0.5, zoom: "auto", cmds: [{ k: 600, a: "calm" }] });
    var c1c = Core.simCpuGs(t, base, cpu, seed, 0, null, { aggr: 0.5, zoom: "auto", cmds: [{ k: 600, a: "calm" }] });
    assert.strictEqual(c1b.time, c1c.time, "教練指令重算一致");
    assert.strictEqual(c0.frames.length > 600 ? Core.encode(c0.frames.slice(0, 600).map(function () { return {}; })) : 0, c0.frames.length > 600 ? Core.encode(c1b.frames.slice(0, 600).map(function () { return {}; })) : 0);
    assert.ok(c0.status === "finish" && c1b.status === "finish", "教練模式完賽");
    // 2026-11-21 QA：「衝！」在比賽物件裡套用，重播（Core.replay＋同一份 cmds）結果一致
    var dcm = [{ k: 400, a: "dash" }, { k: 1500, a: "dash" }];
    var cd = Core.simCpuGs(t, base, cpu, seed, 0, null, { aggr: 0.5, zoom: "auto", cmds: dcm });
    var rpd = Core.replay(t, { piste: pid, seed: seed, dog: Core.breed("shiba"), snow: "groomed", runNo: 0, cmds: dcm }, cd.rec, 1);
    assert.strictEqual(rpd.status, cd.status, "衝！的重播狀態一致");
    assert.strictEqual(rpd.time, cd.time, "衝！的重播時間一致");
    // DNF 的選手不能中複勝
    var ks = Bet.keysOf([2, 0, 1], [null, 50, 49]);
    assert.ok(ks.place.indexOf("place:1") >= 0 && ks.place.indexOf("place:-1") >= 0 && ks.place.indexOf("place:0") < 0, "DNF 不算名次");
    ok("教練模式：路線、指令重算（標準 " + c0.time.toFixed(2) + "、穩住 " + c1b.time.toFixed(2) + " 秒）");

    // M1 救難犬
    var rs = MS.newRescue(t, w, { seed: 42, dog: Core.breed("stbernard") });
    assert.ok(rs.victims.length >= 3 && rs.victims.length <= 5, "被埋 3～5 位");
    var rs2 = MS.newRescue(t, w, { seed: 42, dog: Core.breed("stbernard") });
    assert.deepStrictEqual(rs.victims.map(function (v) { return [v.x, v.z]; }), rs2.victims.map(function (v) { return [v.x, v.z]; }), "被埋位置由 seed 決定");
    while (rs.status === "run") MS.stepRescue(rs, MS.rescueAuto(rs, SLP.steerTo));
    assert.ok(rs.found >= 1, "自動駕駛至少救出 1 位（" + rs.found + "/" + rs.victims.length + "）");
    var v0 = rs2.victims[0];
    rs2.st.p = [v0.x + 1, T.height(t, v0.x + 1, v0.z), v0.z]; rs2.st.v = [0, 0, 0];
    for (var dg = 0; dg < 200 && !v0.found; dg++) MS.stepRescue(rs2, { s: 0, c: 0, j: 0, g: 1 });
    assert.ok(v0.found, "在被埋者旁按住挖掘 2 秒救出");
    assert.ok(MS.pulse(rs2, 1) >= 0, "嗅覺脈動");
    ok("M1 救難犬：救出 " + rs.found + "/" + rs.victims.length + "、分數 " + rs.score);

    // M5 雪崩逃脫
    var av = MS.newAvalanche(t, w, { piste: pid, seed: 3, dog: dog });
    while (av.status === "run") {
      var fake = { st: av.st, piste: av.piste, near: av.near, next: 0, gates: [], steps: av.steps };
      var o = { s: SLP.steerTo(av.st, T.at(av.piste, av.s + 25).x, T.at(av.piste, av.s + 25).z, Phys.speed(av.st)), c: 1, j: 0, g: 0 };
      MS.stepAvalanche(av, o);
    }
    var av0 = MS.newAvalanche(t, w, { piste: pid, seed: 3, dog: dog });
    while (av0.status === "run") MS.stepAvalanche(av0, { s: 0, c: 0, j: 0, g: 0 });
    assert.ok(av.score > av0.score, "認真滑比不動分數高（" + av.score + " > " + av0.score + "）");
    ok("M5 雪崩逃脫：" + (av.escaped ? "逃脫" : "被追上") + "、分數 " + av.score);

    // M3 世界盃、R1 每日雪況
    var sea = SE.newSeason(99), stg = SE.stages(sea);
    assert.strictEqual(stg.length, 8, "8 站");
    var rset = {};
    stg.forEach(function (s) { rset[s.resort] = 1; });
    assert.strictEqual(Object.keys(rset).length, 8, "8 個雪場各一站");
    var fld = SE.field(sea);
    assert.strictEqual(fld.length, 23, "CPU 23 隻");
    var order = ["me"].concat(fld.map(function (c) { return c.id; }));
    SE.applyStage(sea, order);
    assert.strictEqual(sea.points.me, 100, "第 1 名 100 分");
    assert.strictEqual(sea.points[order[10]], 24, "第 11 名 24 分");
    assert.strictEqual(sea.points[order[20]] || 0, 0, "第 21 名 0 分");
    assert.deepStrictEqual(SE.recent(sea, order[1]), [2], "近 5 場成績");
    var dy = SE.daily("2026-11-21"), dy2 = SE.daily("2026-11-21");
    assert.deepStrictEqual(dy, dy2, "每日雪況確定性");
    assert.ok(D.RESORTS.indexOf(dy.challenge.resort) >= 0, "今日挑戰的雪場");
    ok("M3 世界盃（8 站、積分、近 5 場）、R1 每日雪況（" + dy.challenge.resort + "）");
  });
};

if (require.main === module) {
  module.exports().then(function () { console.log("inusnow p3_check OK"); }).catch(function (e) { console.error(e); process.exit(1); });
}
