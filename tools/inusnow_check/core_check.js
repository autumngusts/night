// イヌスノー（狗雪）規則檢查（Node）：node tools/inusnow_check/core_check.js
// 依據 docs/inusnow_design.md §2.3、§3、§4.1、§11；計畫 docs/superpowers/plans/2026-11-20-inusnow-phase1.md Task 3～5。
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SRC = path.join(__dirname, "..", "..", "static_src");
var D = require(path.join(SRC, "inusnow_data.js"));
var T = require(path.join(SRC, "inusnow_terrain.js"));
var Phys = require(path.join(SRC, "inusnow_phys.js"));
var Core = require(path.join(SRC, "inusnow_core.js"));

function loadResort(id) {
  var json = JSON.parse(fs.readFileSync(path.join(SRC, "inusnow", "data", id + ".json"), "utf8"));
  return T.load(json).then(function (t) { return { json: json, t: t }; });
}
function ok(msg) { console.log("ok - " + msg); }

// 確定性：規則核心不得使用三角函數、指數、對數、Math.random（設計 §11）
["inusnow_terrain.js", "inusnow_phys.js", "inusnow_core.js"].forEach(function (f) {
  var src = fs.readFileSync(path.join(SRC, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  var bad = src.match(/Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|random|hypot|cbrt)\b/g);
  assert.ok(!bad, f + " 使用了不允許的函式：" + bad);
});
ok("規則核心只用 + − × ÷、sqrt、floor、abs、imul");

// 資料檔
var index = JSON.parse(fs.readFileSync(path.join(SRC, "inusnow", "data", "index.json"), "utf8"));
assert.strictEqual(index.resorts.length, 8, "index.json 有 8 個雪場");
var total = 0;
D.RESORTS.forEach(function (id) {
  var p = path.join(SRC, "inusnow", "data", id + ".json");
  total += fs.statSync(p).size;
  var j = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.ok(j.attribution && j.attribution.length === 2, id + " 有資料出處");
  assert.ok(j.events && j.events.gs && j.pistes.some(function (x) { return x.id === j.events.gs.piste; }), id + " 有大曲道雪道");
});
assert.ok(total <= 4 * 1024 * 1024, "8 個雪場合計 ≤ 4 MB（實際 " + Math.round(total / 1024) + " KB）");
ok("8 個雪場資料、出處、大曲道雪道；合計 " + Math.round(total / 1024) + " KB");

loadResort("happo").then(function (r) {
  var t = r.t, j = r.json;
  // 地形
  var n = T.normal(t, 2000, 2500);
  assert.ok(Math.abs(n[0] * n[0] + n[1] * n[1] + n[2] * n[2] - 1) < 1e-9, "法線是單位向量");
  var pid = j.events.gs.piste, pi = T.piste(t, pid);
  var a0 = T.at(pi, 0), a1 = T.at(pi, pi.len);
  assert.ok(T.height(t, a0.x, a0.z) > T.height(t, a1.x, a1.z) + 150, "大曲道起點比終點高 150 m 以上");
  var sum = 0;
  for (var i = 1; i < pi.pts.length; i++) sum += Math.sqrt(Math.pow(pi.pts[i][0] - pi.pts[i - 1][0], 2) + Math.pow(pi.pts[i][1] - pi.pts[i - 1][1], 2));
  assert.ok(Math.abs(sum - pi.len) < 1e-6, "雪道長度＝累積弧長");
  [10, 123.4, 400, pi.len - 20].forEach(function (s) {
    var a = T.at(pi, s), nr = T.nearest(pi, a.x, a.z);
    assert.ok(Math.abs(nr.s - s) < 0.01 && Math.abs(nr.d) < 0.01, "nearest(at(" + s + ")) 回到同一點");
    // 往右 5 m：d ≈ +5
    var rr = T.nearest(pi, a.x + (-a.tz) * 5, a.z + a.tx * 5);
    assert.ok(Math.abs(rr.d - 5) < 0.05, "右側距離為正");
  });
  ok("地形高度、法線、雪道弧長、最近點");

  // 物理
  var dog = Core.breed("shiba");
  var start = T.at(pi, D.GATES.startS);
  function runStraight(c, steps) {
    var st = Phys.create(t, start, dog);
    for (var k = 0; k < steps; k++) Phys.step(st, { s: 0, c: c, j: 0, g: 0 }, { terrain: t, snow: "groomed" });
    return st;
  }
  var st0 = runStraight(0, 600);
  assert.ok(Phys.speed(st0) > 1 && st0.p[1] < T.height(t, start.x, start.z) - 5, "不輸入 10 秒：沿坡往下滑");
  var stTuck = runStraight(1, 600);
  assert.ok(Phys.speed(stTuck) > Phys.speed(st0), "蹲低比不蹲低快（" + Phys.speed(stTuck).toFixed(2) + " > " + Phys.speed(st0).toFixed(2) + "）");
  var stSkid = Phys.create(t, start, dog), skids = 0;
  for (var k = 0; k < 240; k++) { var ev = Phys.step(stSkid, { s: 8, c: 0, j: 0, g: 0 }, { terrain: t, snow: "groomed" }); if (ev.indexOf("skid") >= 0) skids++; }
  var stIce = Phys.create(t, start, dog), skidsIce = 0;
  for (var k2 = 0; k2 < 240; k2++) { var ev2 = Phys.step(stIce, { s: 8, c: 0, j: 0, g: 0 }, { terrain: t, snow: "ice" }); if (ev2.indexOf("skid") >= 0) skidsIce++; }
  assert.ok(skidsIce >= skids, "冰面比壓雪更容易橫滑");
  // 起跳
  var stJ = runStraight(0, 120);
  var evJ = Phys.step(stJ, { s: 0, c: 0, j: 1, g: 0 }, { terrain: t, snow: "groomed" });
  assert.ok(evJ.indexOf("ollie") >= 0 && stJ.air, "起跳後在空中");
  var landed = false;
  for (var k3 = 0; k3 < 120 && !landed; k3++) { var e3 = Phys.step(stJ, { s: 0, c: 0, j: 0, g: 0 }, { terrain: t, snow: "groomed" }); if (e3.indexOf("land") >= 0) landed = true; }
  assert.ok(landed, "直直起跳會乾淨落地");
  // 空中轉 90° 落地＝摔倒
  var stF = runStraight(0, 300);
  Phys.step(stF, { s: 0, c: 0, j: 1, g: 0 }, { terrain: t, snow: "groomed" });
  var fell = false;
  for (var k4 = 0; k4 < 200 && stF.air; k4++) {
    var spin = Math.abs(stF.yawAir) < 1.5708 ? 8 : 0;
    var e4 = Phys.step(stF, { s: spin, c: 0, j: 0, g: 0 }, { terrain: t, snow: "groomed" });
    if (e4.indexOf("fall") >= 0 || e4.indexOf("sketchy") >= 0) fell = true;
  }
  assert.ok(fell, "空中轉了約 90° 落地＝不穩或摔倒");
  // 同一組輸入兩次，每一步完全相同
  function trace() {
    var st = Phys.create(t, start, dog), out = [];
    var rng = Core.makeRng(42);
    for (var q = 0; q < 900; q++) {
      Phys.step(st, { s: Math.floor(rng() * 17) - 8, c: rng() < 0.3 ? 1 : 0, j: rng() < 0.01 ? 1 : 0, g: 0 }, { terrain: t, snow: "groomed" });
      out.push(st.p[0], st.p[1], st.p[2], st.v[0], st.v[1], st.v[2], st.h[0], st.h[1]);
    }
    return out;
  }
  var t1 = trace(), t2 = trace();
  for (var q2 = 0; q2 < t1.length; q2++) assert.ok(t1[q2] === t2[q2], "確定性：第 " + q2 + " 個值不同");
  ok("物理：滑行、蹲低、橫滑、起跳與落地、摔倒、確定性");

  // 旗門
  var seed = Core.courseSeed("happo", pid);
  var gates = Core.makeGates(t, pid, seed);
  assert.ok(gates.length >= 20 && gates.length <= 45, "旗門數 " + gates.length);
  gates.forEach(function (g, i) {
    if (i) assert.strictEqual(g.side, -gates[i - 1].side, "旗門左右交錯");
    var nr = T.nearest(pi, g.ix, g.iz);
    assert.ok(Math.abs(nr.d) <= pi.width * D.GATES.maxOffset + 0.5, "轉彎旗竿在雪道內");
  });
  var g0 = gates[0], ox = (g0.ox - g0.ix) / D.GATES.width, oz = (g0.oz - g0.iz) / D.GATES.width;
  function cross(lat) {
    var bx = g0.ix + ox * lat, bz = g0.iz + oz * lat;
    return Core.gateCheck(bx - g0.tx, bz - g0.tz, bx + g0.tx, bz + g0.tz, g0);
  }
  assert.strictEqual(cross(3).r, "pass");
  assert.ok(Math.abs(cross(3).dist - 3) < 1e-9);
  assert.strictEqual(cross(-1).r, "miss", "從轉彎旗竿內側過＝漏門");
  assert.strictEqual(cross(9).r, "miss", "從外側旗竿外面過＝漏門");
  ok("旗門配置與通過判定");

  // 比賽：自動駕駛完賽、紀錄重播完全一致
  var opts = { piste: pid, seed: seed, dog: dog, snow: "groomed", runNo: 0 };
  var run = Core.newRun(t, opts);
  while (run.status === "run") Core.stepRun(run, Core.autopilot(run, 0.5));
  assert.strictEqual(run.status, "finish", "自動駕駛完賽（" + run.reason + "）");
  assert.ok(run.time > 30 && run.time < 180, "時間 " + run.time);
  var rec = Core.encode(run.inputs);
  var dec = Core.decode(rec);
  assert.strictEqual(dec.length, run.inputs.length);
  for (var q3 = 0; q3 < dec.length; q3++) assert.deepStrictEqual(dec[q3], run.inputs[q3]);
  var rp = Core.replay(t, opts, rec);
  assert.strictEqual(rp.status, "finish");
  assert.ok(rp.time === run.time, "重播時間完全相同（" + rp.time + " / " + run.time + "）");
  assert.ok(rp.run.st.p[0] === run.st.p[0] && rp.run.st.p[2] === run.st.p[2], "重播最後位置完全相同");
  ok("自動駕駛完賽 " + run.time.toFixed(2) + " 秒；紀錄 " + rec.length + " 字元，重播一致");
  var code = Core.shareCode({ resort: "happo", piste: pid, seed: seed, runNo: 0, breed: "shiba", rec: rec });
  var parsed = Core.parseShare(code);
  assert.ok(parsed && parsed.rec === rec && parsed.seed === seed, "分享碼來回一致");
  assert.strictEqual(Core.parseShare("inu1|x|y|1|0|shiba|zz.zz.zz"), null, "壞的分享碼回傳 null");
  ok("分享碼");

  // 漏門：一直往左轉
  var bad = Core.newRun(t, opts);
  while (bad.status === "run") Core.stepRun(bad, { s: -8, c: 0, j: 0, g: 0 });
  assert.strictEqual(bad.status, "dsq", "一直轉同一邊會失格（" + bad.reason + "）");
  ok("失格：" + bad.reason);

  // 完美旗門：把選手放在離轉彎旗竿 0.3 m 處通過
  // 同樣的速度與方向，一趟離轉彎旗竿 0.3 m（完美）、一趟 1.5 m（普通），比較通過後的速度
  function passAt(lat) {
    var rr = Core.newRun(t, opts), gg = rr.gates[0];
    var gox = (gg.ox - gg.ix) / D.GATES.width, goz = (gg.oz - gg.iz) / D.GATES.width;
    rr.st.p[0] = gg.ix + gox * lat - gg.tx * 0.1; rr.st.p[2] = gg.iz + goz * lat - gg.tz * 0.1;
    rr.st.p[1] = T.height(t, rr.st.p[0], rr.st.p[2]);
    rr.st.v = [gg.tx * 15, 0, gg.tz * 15]; rr.st.h = [gg.tx, gg.tz];
    Core.stepRun(rr, { s: 0, c: 0, j: 0, g: 0 });
    return rr;
  }
  var pr = passAt(0.3), normal = passAt(1.5);
  assert.strictEqual(pr.perfect, 1, "完美旗門");
  assert.strictEqual(pr.chain, 1);
  assert.strictEqual(normal.perfect, 0, "1.5 m 不是完美");
  var ratio = Phys.speed(pr.st) / Phys.speed(normal.st);
  assert.ok(Math.abs(ratio - 1.03) < 0.002, "速度 ×1.03（實際 ×" + ratio.toFixed(4) + "）");
  assert.ok(Math.abs(Core.boostMult(1) - 1.03) < 1e-12 && Math.abs(Core.boostMult(10) - 1.06) < 1e-12, "連續完美的倍率上限 1.06");
  var g1 = pr.gates[1], o1x = (g1.ox - g1.ix) / D.GATES.width, o1z = (g1.oz - g1.iz) / D.GATES.width;
  pr.st.p[0] = g1.ix + o1x * 1.5 - g1.tx * 0.1; pr.st.p[2] = g1.iz + o1z * 1.5 - g1.tz * 0.1;
  pr.st.v = [g1.tx * 15, 0, g1.tz * 15];
  Core.stepRun(pr, { s: 0, c: 0, j: 0, g: 0 });
  assert.strictEqual(pr.next, 2, "第 2 座旗門通過");
  assert.strictEqual(pr.chain, 0, "普通通過讓連續數歸零");
  ok("完美旗門與連續數");

  // 存檔
  var sv = Core.migrate(JSON.parse(JSON.stringify(Core.newSave())));
  assert.strictEqual(sv.v, 1);
  assert.deepStrictEqual(Core.migrate({ v: 99 }), Core.newSave(), "版本不同就重建");
  assert.deepStrictEqual(Core.migrate(null), Core.newSave());
  ok("存檔格式");

  // 8 個雪場都能完賽
  return D.RESORTS.reduce(function (p, id) {
    return p.then(function () {
      return loadResort(id).then(function (rr) {
        var pid2 = rr.json.events.gs.piste;
        var o2 = { piste: pid2, seed: Core.courseSeed(id, pid2), dog: dog, snow: "groomed", runNo: 0 };
        var r2 = Core.newRun(rr.t, o2);
        while (r2.status === "run") Core.stepRun(r2, Core.autopilot(r2, 0.5));
        assert.strictEqual(r2.status, "finish", id + " 自動駕駛完賽（" + r2.reason + "）");
        var o3 = Object.assign({}, o2, { runNo: 1 });
        var r3 = Core.newRun(rr.t, o3);
        while (r3.status === "run") Core.stepRun(r3, Core.autopilot(r3, 0.5));
        assert.strictEqual(r3.status, "finish", id + " 第 2 趟（不同旗門）完賽（" + r3.reason + "）");
        console.log("  " + id + "：" + r2.time.toFixed(2) + " / " + r3.time.toFixed(2) + " 秒");
      });
    });
  }, Promise.resolve()).then(function () { ok("8 個雪場 × 2 趟都能完賽"); });
}).then(function () {
  console.log("inusnow core_check OK");
}).catch(function (e) {
  console.error(e);
  process.exit(1);
});
