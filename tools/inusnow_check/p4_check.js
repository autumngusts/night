// イヌスノー（狗雪）第 4 階段規則檢查：由 core_check.js 在最後呼叫（也可以單獨執行 node tools/inusnow_check/p4_check.js）
// 依據 docs/inusnow_design.md §19；計畫 2026-11-21-inusnow-phase4.md。
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SRC = path.join(__dirname, "..", "..", "static_src");
var D = require(path.join(SRC, "inusnow_data.js"));
var T = require(path.join(SRC, "inusnow_terrain.js"));
var Core = require(path.join(SRC, "inusnow_core.js"));
var SLP = require(path.join(SRC, "inusnow_slope.js"));
var CX = require(path.join(SRC, "inusnow_cross.js"));
require(path.join(SRC, "inusnow_env.js"));
var Relay = require(path.join(SRC, "inusnow_relay.js"));
var HL = require(path.join(SRC, "inusnow_highlight.js"));
var Room = require(path.join(SRC, "inusnow_room.js"));

function ok(msg) { console.log("ok - " + msg); }
function loadResort(id) {
  var json = JSON.parse(fs.readFileSync(path.join(SRC, "inusnow", "data", id + ".json"), "utf8"));
  return T.load(json).then(function (t) { return { json: json, t: t }; });
}

module.exports = function () {
  ["inusnow_relay.js", "inusnow_highlight.js", "inusnow_room.js"].forEach(function (f) {
    var src = fs.readFileSync(path.join(SRC, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    var bad = src.match(/Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|random|hypot|cbrt)\b|localStorage|document\./g);
    assert.ok(!bad, f + " 使用了不允許的函式：" + bad);
  });
  ok("P4 規則檔只用 + − × ÷、sqrt、floor、abs、imul；不碰 DOM／localStorage");

  return loadResort("happo").then(function (r) {
    var t = r.t, j = r.json, pid = j.events.gs.piste, pi = T.piste(t, pid), seed = 4242;
    var dog = Core.breed("shiba");

    // 平行大曲道：4 條賽道、同一座旗門的 s 相同、賽道互不重疊；標準大曲道不變
    var std = Core.newRun(t, { piste: pid, seed: seed, dog: dog, snow: "groomed", runNo: 0 });
    assert.ok(!std.gates[0].w, "標準大曲道沒有 w（與第 1 階段相同）");
    var lw = Core.laneW(pi), runs = [0, 1, 2, 3].map(function (k) { return Core.newRun(t, { piste: pid, seed: seed, dog: dog, snow: "groomed", runNo: 0, lane: k, laneW: lw }); });
    assert.ok(lw <= D.ROOM.laneMax && lw > 5, "賽道寬 " + lw);
    runs.forEach(function (rr) { assert.strictEqual(rr.gates.length, std.gates.length, "旗門數相同"); assert.strictEqual(rr.gates[3].s, std.gates[3].s, "並排（s 相同）"); });
    for (var g = 0; g < std.gates.length; g++) {
      for (var k = 0; k < 3; k++) {
        var a = runs[k].gates[g], b = runs[k + 1].gates[g];
        var na = T.nearest(pi, a.ix, a.iz).d, nb = T.nearest(pi, b.ix, b.iz).d;
        assert.ok(nb > na, "賽道 " + (k + 2) + " 在 " + (k + 1) + " 的右側");
      }
    }
    var fin = 0;
    runs.forEach(function (rr) { while (rr.status === "run") Core.stepRun(rr, Core.autopilot(rr, 0.45)); if (rr.status === "finish") fin += 1; });
    assert.ok(fin >= 3, "自動駕駛在 4 條賽道至少 3 條完賽（" + runs.map(function (x) { return x.status + (x.time ? x.time.toFixed(1) : ""); }).join(" ") + "）");
    ok("平行大曲道：4 條賽道並排、旗門縮小、完賽 " + fin + "/4");
  }).then(function () {
    // 2026-11-21 QA：8 個雪場 × 4 條賽道，CPU（大曲道 AI）都要能完賽（賽道的旗門寬也要用在 CPU 的路線）
    return D.RESORTS.reduce(function (p, id) {
      return p.then(function () {
        return loadResort(id).then(function (rr) {
          var pid2 = rr.json.events.gs.piste, pi2 = T.piste(rr.t, pid2), lw2 = Core.laneW(pi2), okN = 0;
          for (var k2 = 0; k2 < 4; k2++) {
            var o = { piste: pid2, seed: 77, snow: "groomed", runNo: 0, lane: k2, laneW: lw2 };
            if (Core.simCpuGs(rr.t, o, D.CPU[5], 77, k2, null).status === "finish") okN += 1;
          }
          assert.ok(okN >= 3, id + " 平行賽道 CPU 完賽 " + okN + "/4");
        });
      });
    }, Promise.resolve()).then(function () { ok("平行大曲道：8 個雪場 × 4 條賽道 CPU 完賽"); return loadResort("happo"); });
  }).then(function (r) {
    var t = r.t, j = r.json, pid = j.events.gs.piste, pi = T.piste(t, pid), seed = 4242;
    var dog = Core.breed("shiba");
    var std = Core.newRun(t, { piste: pid, seed: seed, dog: dog, snow: "groomed", runNo: 0 });

    // 房間：出賽表、第 2 趟換賽道、分段紀錄重算、外插、斷線、名次、彩池
    var riders = [{ cid: "ca", pid: "p1", name: "A", breed: "shiba" }, { cid: "cb", pid: "p2", name: "B", breed: "husky" }];
    var card = Room.makeCard({ resort: "happo", event: "pgs", runs: 2 }, riders, seed, 0, null);
    assert.deepStrictEqual(card.riders.map(function (x) { return x.lane; }), [0, 1], "第 1 趟賽道");
    var card2 = Room.makeCard({ resort: "happo", event: "pgs", runs: 2 }, riders, seed, 1, { ca: 60, cb: 61 });
    assert.deepStrictEqual(card2.riders.map(function (x) { return x.lane; }), [3, 2], "第 2 趟換賽道（1↔4、2↔3）");
    var mine = Room.newRider(t, card, card.riders[0]), segs = [], sent = 0;
    while (!Room.done(mine)) {
      Room.step(mine, Core.autopilot(mine.run, 0.45));
      var ins = Room.inputsOf(mine);
      while ((sent + 1) * D.ROOM.seg <= ins.length || (Room.done(mine) && sent * D.ROOM.seg < ins.length)) { segs.push(Core.encode(ins.slice(sent * D.ROOM.seg, (sent + 1) * D.ROOM.seg))); sent += 1; }
    }
    var rm = Room.newRemote(t, card, card.riders[0]);
    Room.addSeg(rm, 1, segs[1]);
    assert.strictEqual(rm.queue.length, 0, "缺第 0 段時先不接");
    Room.addSeg(rm, 0, segs[0]);
    assert.strictEqual(rm.queue.length, 60, "依序接上");
    Room.advance(rm, 200);
    assert.strictEqual(Room.steps(rm.r), 60, "只重算到有紀錄的部分");
    var f0 = Core.frameOf(Room.stOf(rm.r)), fx = Room.frameAt(rm, 90);
    assert.ok(Math.abs(fx[0] - f0[0]) + Math.abs(fx[2] - f0[2]) > 0.5, "落後時外插");
    assert.ok(!Room.stale(rm, 200) && Room.stale(rm, 60 + 181), "3 秒沒有新紀錄＝斷線");
    var res = Room.recompute(t, card, { ca: segs, cb: [] });
    assert.ok(res[0].done && res[0].time === mine.run.time, "重算與自己的結果一致（" + res[0].time + "）");
    assert.ok(!res[1].ok, "沒有紀錄＝未完賽");
    var rk = Room.rank(card, res);
    assert.strictEqual(rk.rows[0].cid, "ca", "名次");
    var rk2 = Room.rank(card2, [{ cid: "ca", ok: true, time: 50 }, { cid: "cb", ok: true, time: 48 }]);
    assert.strictEqual(rk2.rows[0].cid, "cb", "2 趟合計（61+48 < 60+50）");
    var pays = Room.poolPays({ p9: { ca: 100 }, p8: { cb: 300 }, p7: { ca: 100 } }, "ca");
    assert.deepStrictEqual(pays, { p9: 200, p7: 200 }, "單勝彩池（總額 500 × 0.8 依比例）");
    assert.strictEqual(Room.poolOdds({ p9: { ca: 100 }, p8: { cb: 300 } }, "cb"), 1, "彩池賠率（400 × 0.8 ÷ 300）");
    // 2026-11-21 QA：沒人押中＝退還；0／負的注金不算；Slopestyle 未完賽＝DNF；牆上時鐘 10 秒沒新段＝未完賽
    assert.deepStrictEqual(Room.poolPays({ p9: { ca: 100, cb: -50 }, p8: { cb: 0 } }, "cz"), { p9: 100 }, "沒人押中冠軍：退還");
    assert.strictEqual(Room.poolOdds({ p9: { ca: 100, cb: -50 } }, "ca"), 0.8, "負的注金不算進賠率");
    var sc = Room.makeCard({ resort: "happo", event: "slope" }, riders, seed, 0, null);
    var srk = Room.rank(sc, [{ cid: "ca", ok: false, score: 0 }, { cid: "cb", ok: true, score: 12 }]);
    assert.ok(srk.rows[0].cid === "cb" && srk.rows[1].place === 0, "Slopestyle 未完賽＝DNF");
    var rg = Room.newRemote(t, card, card.riders[1]);
    rg.lastAt = 1000;
    assert.ok(!Room.gone(rg, 1000 + D.ROOM.dnfSec * 1000) && Room.gone(rg, 1001 + D.ROOM.dnfSec * 1000), "10 秒沒有新段＝未完賽");
    ok("房間：出賽表、換賽道、分段紀錄、外插、斷線、重算、名次、彩池（退還、DNF）");

    // 接力：4 棒、CPU 隊伍、團隊時間
    var legs = [0, 1, 2, 3].map(function (k) { return Relay.newLeg(t, k, seed, dog, null); });
    assert.deepStrictEqual(legs.map(function (l) { return l.kind; }), ["gs", "cross", "slope", "gs"], "4 棒的種類");
    assert.ok(legs[0].run.finish.s < pi.len / 2 + 1 && legs[3].run.gates[0].s > pi.len / 2, "大曲道前半／後半");
    var teams = Relay.cpuTeams(seed);
    assert.strictEqual(teams.length, 3, "CPU 3 隊");
    var tm = Relay.simTeam(t, seed, teams[0], null), tm2 = Relay.simTeam(t, seed, teams[0], null);
    assert.strictEqual(tm.total, tm2.total, "接力模擬確定性");
    assert.ok(tm.legs.every(function (x) { return x > 5 && x < 400; }), "每棒時間合理（" + tm.legs.map(function (x) { return x.toFixed(1); }).join(" / ") + "）");
    var sl = Relay.simLeg(t, 2, seed, teams[1][2], null);
    assert.ok(Math.abs(sl.time - ((sl.leg.run.time || sl.leg.run.steps / 60) + (100 - (sl.leg.run.status === "dsq" ? 0 : sl.leg.run.final)) * 0.1)) < 1e-9 || sl.leg.run.status === "dsq", "Slopestyle 棒＝時間＋(100−分數)×0.1");
    ok("M6 接力：4 棒、CPU 隊伍 " + tm.total.toFixed(1) + " 秒");

    // R5 精彩重播
    var gp = Core.replay(t, std.opts, (function () { var x = Core.newRun(t, std.opts); while (x.status === "run") Core.stepRun(x, Core.autopilot(x, 0.5)); return x.inputs; })(), 1);
    var clips = HL.find({ frames: [Core.frameOf(Core.newRun(t, std.opts).st)].concat(gp.frames), terrain: t, events: gp.run.events, kind: "gs" });
    assert.ok(clips.some(function (c) { return c.kind === "fast" && c.b - c.a === 600; }), "最快的 10 秒");
    var sid = j.events.slope.piste, ss = Core.courseSeed("happo", sid);
    var scpu = SLP.simCpu(t, { piste: sid, seed: ss, snow: "groomed", runNo: 0 }, D.CPU[2], ss, 0);
    var srp = SLP.replay(t, { piste: sid, seed: ss, dog: Core.breed(D.CPU[2].breed), snow: "groomed", runNo: 0 }, scpu.rec, 1);
    var sclips = HL.find({ frames: srp.frames, terrain: srp.run.terrain, events: srp.run.events, tricks: srp.run.tricks, kind: "slope" });
    assert.ok(sclips.some(function (c) { return c.kind === "jump"; }) && sclips.some(function (c) { return c.kind === "trick"; }), "Slopestyle：最大的一跳、最高分技巧（" + sclips.map(function (c) { return c.kind + ":" + c.val; }).join(" ") + "）");
    var code = Core.shareCode({ resort: "happo", piste: pid, seed: seed, runNo: 0, breed: "shiba", rec: "0" });
    var cc = HL.withClip(code, 100, 700);
    assert.deepStrictEqual(HL.clipOf(cc), { a: 100, b: 700 }, "片段");
    assert.ok(Core.parseShare(cc) && Core.parseShare(cc).seed === seed, "含片段的分享碼可以匯入");
    ok("R5 精彩重播：大曲道 " + clips.length + " 段、Slopestyle " + sclips.length + " 段、分享片段");
  });
};

if (require.main === module) {
  module.exports().then(function () { console.log("inusnow p4_check OK"); }).catch(function (e) { console.error(e); process.exit(1); });
}
