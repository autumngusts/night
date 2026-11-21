// イヌスノー（狗雪）規則檢查（Node）：node tools/inusnow_check/core_check.js
// 依據 docs/inusnow_design.md §2.3、§3、§4.1、§11、§17；計畫 2026-11-20-inusnow-phase1.md Task 3～5、2026-11-21-inusnow-phase2.md。
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
["inusnow_terrain.js", "inusnow_phys.js", "inusnow_core.js", "inusnow_slope.js", "inusnow_cross.js", "inusnow_free.js"].forEach(function (f) {
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
  // 第 1 階段的 golden 紀錄（2026-11-21 第 2 階段完成時的值）：物理或旗門有任何回歸都會在這裡發現
  assert.strictEqual(run.time, 90.02053129836553, "golden：八方・柴犬・aggr 0.5 的時間");
  assert.strictEqual(run.steps, 5402, "golden：步數");
  assert.strictEqual(Core.hash(rec), 269765139, "golden：紀錄");
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
  // ================= 第 2 階段（docs/inusnow_design.md §17；計畫 2026-11-21-inusnow-phase2.md） =================
  var SLP = require(path.join(SRC, "inusnow_slope.js"));
  var CX = require(path.join(SRC, "inusnow_cross.js"));
  var FR = require(path.join(SRC, "inusnow_free.js"));
  assert.strictEqual(D.BREEDS.length, 24, "犬種 24 種");
  assert.strictEqual(D.CPU.length, 24, "CPU 名冊 24 隻");
  D.CPU.forEach(function (c) { assert.ok(D.BREEDS.some(function (b) { return b.id === c.breed; }), c.id + " 的犬種存在"); assert.ok(c.lv >= 1 && c.lv <= 5); });
  D.BREEDS.forEach(function (b) { assert.ok(b.nose >= 0.8 && b.nose <= 1.3, b.id + " 的 nose 在 0.8～1.3"); });
  ok("犬種 24 種、CPU 24 隻");
  index.resorts.forEach(function (r) {
    var j = JSON.parse(fs.readFileSync(path.join(SRC, "inusnow", "data", r.id + ".json"), "utf8"));
    assert.ok(r.slope && r.cross, r.id + "：index 有 slope／cross");
    assert.strictEqual(j.events.slope.piste, r.slope.piste);
    assert.ok(j.pistes.some(function (p) { return p.id === j.events.slope.piste; }) && j.pistes.some(function (p) { return p.id === j.events.cross.piste; }), r.id + "：Slopestyle／Cross 雪道存在");
  });
  ok("8 個雪場都有 Slopestyle 與 Cross 雪道（add_events.js）");

  // 紀錄：z（興奮度發動）+476，沒有 z 的紀錄不變
  var ins = [{ s: 3, c: 1, j: 0, g: 2 }, { s: -8, c: 0, j: 1, g: 6, z: 1 }, { s: 0, c: 0, j: 0, g: 0 }];
  assert.deepStrictEqual(Core.decode(Core.encode(ins)), ins, "z 的紀錄來回一致");
  assert.strictEqual(Core.encode([{ s: 0, c: 0, j: 0, g: 0 }]), "8", "沒有 z 時編碼和第 1 階段相同");
  ok("紀錄格式：z 向下相容");

  // 附加物：解析梯度＝有限差分（不連續處以外）
  var fts = [{ k: "kicker", x: 0, z: 0, tx: 0.6, tz: 0.8, L: 9, H: 2, W: 7 }, { k: "roller", x: 30, z: 0, tx: 1, tz: 0, A: 1.2, len: 10, W: 20 },
    { k: "bank", x: 0, z: 60, tx: 0, tz: 1, side: 1, B: 2.5, d0: 10, dw: 5, len: 34, fade: 4 }, { k: "drop", x: 80, z: 80, tx: 1, tz: 0, L: 15, H: 2, W: 14 }].map(T.prepFeat);
  var flat = { w: 2, h: 2, cell: 1000, hs: new Float64Array([0, 0, 0, 0]), feats: fts };
  [[-2, -4], [28, 3], [-12, 58], [-13.5, 70], [85, 82], [83, 86.5]].forEach(function (q) {
    var e = 1e-5, gx = (T.height(flat, q[0] + e, q[1]) - T.height(flat, q[0] - e, q[1])) / 2 / e, gz = (T.height(flat, q[0], q[1] + e) - T.height(flat, q[0], q[1] - e)) / 2 / e;
    var n = T.normal(flat, q[0], q[1]);
    assert.ok(Math.abs(-n[0] / n[1] - gx) < 1e-4 && Math.abs(-n[2] / n[1] - gz) < 1e-4, "附加物的法線＝高度的梯度 " + q);
  });
  assert.ok(Math.abs(T.height(flat, 0, 0) - 2) < 1e-9, "跳台唇口高度＝H");
  ok("地形附加物：高度與解析梯度");

  return loadResort("naeba").then(function (rr) {
    var t = rr.t, j = rr.json, dog = Core.breed("husky");
    // S2 興奮度：完美旗門 +12；滿了按 z 發動 240 步、比不發動快
    var gpid = j.events.gs.piste, gseed = Core.courseSeed("naeba", gpid);
    var zr = Core.newRun(t, { piste: gpid, seed: gseed, dog: dog, snow: "groomed", runNo: 0 });
    for (var k = 0; k < 120; k++) Core.stepRun(zr, Core.autopilot(zr, 0.5));
    var zr2 = Core.newRun(t, { piste: gpid, seed: gseed, dog: dog, snow: "groomed", runNo: 0 });
    for (var k2 = 0; k2 < 120; k2++) Core.stepRun(zr2, Core.autopilot(zr2, 0.5));
    zr.st.zoom = 100; zr2.st.zoom = 100;
    var first = Core.autopilot(zr, 0.5); first.z = 1;
    Core.stepRun(zr, first);
    Core.stepRun(zr2, Core.autopilot(zr2, 0.5));
    assert.strictEqual(zr.st.zoomT, D.ZOOM.steps - 1, "發動後持續 240 步");
    assert.strictEqual(zr.st.zoom, 0, "發動後量表歸 0");
    for (var k3 = 0; k3 < 90; k3++) { Core.stepRun(zr, Core.autopilot(zr, 0.5)); Core.stepRun(zr2, Core.autopilot(zr2, 0.5)); }
    assert.ok(Phys.speed(zr.st) > Phys.speed(zr2.st), "興奮度發動中比較快");
    var gz = Core.newRun(t, { piste: gpid, seed: gseed, dog: dog, snow: "groomed", runNo: 0 });
    Core.zoomGain(gz.st, 50);
    assert.strictEqual(gz.st.zoom, 50);
    ok("S2 興奮度：發動、持續、加速");

    // CPU 大曲道與溝痕：確定性；後出發的有溝痕
    var rseed = Core.pickGsSeed(t, gpid, "naeba", "check", dog);
    var field = Core.cpuField(rseed, 7);
    assert.strictEqual(field.length, 7);
    assert.deepStrictEqual(Core.cpuField(rseed, 7), field, "同一個 seed 抽到同樣的 CPU");
    var simA = Core.simGsField(t, { piste: gpid, seed: rseed, snow: "groomed", runNo: 0 }, field, rseed);
    var simB = Core.simGsField(t, { piste: gpid, seed: rseed, snow: "groomed", runNo: 0 }, field, rseed);
    simA.cpus.forEach(function (c, i) { assert.strictEqual(c.time, simB.cpus[i].time, "CPU 模擬確定性"); });
    var fin = simA.cpus.filter(function (c) { return c.status === "finish"; }).length;
    assert.ok(fin >= 5, "CPU 大多數完賽（" + fin + "/7）");
    assert.ok(simA.rut.count === 7 && Object.keys(simA.rut.cells).length > 500, "溝痕格網");
    var withRut = Core.newRun(t, { piste: gpid, seed: rseed, dog: dog, snow: "groomed", runNo: 0, rut: simA.rut });
    var noRut = Core.newRun(t, { piste: gpid, seed: rseed, dog: dog, snow: "groomed", runNo: 0 });
    while (withRut.status === "run") Core.stepRun(withRut, Core.autopilot(withRut, 0.4));
    while (noRut.status === "run") Core.stepRun(noRut, Core.autopilot(noRut, 0.4));
    assert.ok(withRut.steps !== noRut.steps || withRut.st.p[0] !== noRut.st.p[0], "溝痕會影響滑行");
    console.log("  CPU：" + simA.cpus.map(function (c) { return c.cpu.id + " " + (c.time ? c.time.toFixed(1) : c.reason); }).join("、"));
    ok("CPU 大曲道、比賽 seed、G1 溝痕");

    // Slopestyle：計分規則
    var SL = D.SLOPE;
    assert.strictEqual(SLP.trickPoints({ rail: false, spin: 720, grab: 5, height: 2, E: 1 }), SL.spinD[720] + SL.bite + 8, "720 咬尾抓板、高度 2 m");
    assert.strictEqual(SLP.trickPoints({ rail: false, spin: 360, grab: 1, height: 10, E: 0.6, rep: true }), Math.floor((35 + 8 + 20) * 0.6 * 0.6 * 10 + 0.5) / 10, "不穩落地與重複");
    assert.strictEqual(SLP.trickPoints({ rail: true, trick: "fifty", spinOn: true, spinOff: false, cover: 1, E: 1 }), 40, "50-50 轉上");
    assert.strictEqual(SLP.trickPoints({ rail: true, trick: "slide", spinOn: false, spinOff: false, cover: 0.5, E: 1, bark: true }), Math.floor((35 * 0.7 + 5) * 10 + 0.5) / 10, "板滑一半＋吠叫");
    var spid = j.events.slope.piste, sseed = Core.courseSeed("naeba", spid);
    var park = SLP.makePark(t, spid, sseed);
    var kinds = park.feats.filter(function (f) { return !f.ramp; }).map(function (f) { return f.kind; });
    assert.deepStrictEqual(kinds, SL.order, "公園 6 個地形的順序");
    var sr = SLP.simCpu(t, { piste: spid, seed: sseed, snow: "groomed", runNo: 0 }, D.CPU[6], sseed, 0);
    assert.strictEqual(sr.status, "finish", "Slopestyle CPU 完賽");
    assert.ok(sr.score > 10 && sr.tricks.length >= 4, "Slopestyle CPU 有得分（" + sr.score + "）");
    var srp = SLP.replay(t, { piste: spid, seed: sseed, dog: Core.breed(D.CPU[6].breed), snow: "groomed", runNo: 0 }, sr.rec, 1);
    assert.strictEqual(srp.score, sr.score, "Slopestyle 重播分數一致");
    assert.strictEqual(sr.judges.length, 3);
    ok("Slopestyle：計分、公園、CPU、評審、重播（" + sr.score + " 分）");

    // Cross：6 隻同場、重播一致
    var cpid = j.events.cross.piste, cseed = Core.courseSeed("naeba", cpid);
    var cf = Core.cpuField(cseed, 6);
    var copts = { piste: cpid, seed: cseed, snow: "groomed", dogs: cf.map(function (c) { return Core.breed(c.breed); }) };
    var race = CX.newCross(t, copts), ctl = CX.controllers(race, cseed, -1);
    while (race.status === "run") CX.stepCross(race, ctl.map(function (c) { return c(race); }));
    var places = race.riders.map(function (x) { return x.place; }).sort();
    assert.deepStrictEqual(places, [1, 2, 3, 4, 5, 6], "Cross 名次 1～6");
    var crp = CX.replay(t, copts, race.inputs.map(function (a) { return Core.encode(a); }));
    race.riders.forEach(function (x, i) { assert.strictEqual(crp.race.riders[i].time, x.time, "Cross 重播一致"); });
    // 碰撞：兩隻疊在一起會被推開
    var r2 = CX.newCross(t, copts);
    r2.riders[1].st.p[0] = r2.riders[0].st.p[0] + 0.2; r2.riders[1].st.p[2] = r2.riders[0].st.p[2];
    CX.stepCross(r2, [{}, {}, {}, {}, {}, {}]);
    var dx = r2.riders[1].st.p[0] - r2.riders[0].st.p[0], dz = r2.riders[1].st.p[2] - r2.riders[0].st.p[2];
    assert.ok(Math.sqrt(dx * dx + dz * dz) >= D.CROSS.radius * 2 - 1e-6, "碰撞推開");
    ok("Snowboard Cross：6 隻完賽、碰撞、重播（冠軍 " + race.riders.filter(function (x) { return x.place === 1; })[0].time.toFixed(2) + " 秒）");

    // 自由滑行
    var w = FR.makeWorld(t);
    assert.ok(w.lifts.length > 0 && w.bones.length === D.FREE.bones && w.spots.length === D.FREE.spots, "纜車、骨頭、隱藏地點");
    w.lifts.forEach(function (l) { assert.ok(l.top[0] >= 0 && l.top[0] <= t.sizeX && l.top[1] >= 0 && l.top[1] <= t.sizeZ, "纜車山頂站在格網內"); });
    var fr = FR.newFree(t, w, { dog: dog, snow: "groomed", lift: 0 }, null);
    var b0 = w.bones[0];
    fr.st.p[0] = b0.x; fr.st.p[2] = b0.z; fr.st.p[1] = T.height(t, b0.x, b0.z);
    FR.stepFree(fr, { s: 0, c: 0, j: 0, g: 0 });
    assert.ok(fr.got.bones.indexOf(b0.id) >= 0, "撿到骨頭");
    var lb = w.lifts[0].bottom;
    fr.st.p[0] = lb[0]; fr.st.p[2] = lb[1]; fr.st.p[1] = T.height(t, lb[0], lb[1]); fr.st.v = [0, 0, 0];
    FR.stepFree(fr, { s: 0, c: 0, j: 0, g: 0 });
    assert.strictEqual(fr.liftNear, 0, "纜車山腳站附近");
    assert.ok(FR.teleport(fr, 0) && Math.abs(fr.st.p[0] - w.lifts[0].top[0]) < 10, "坐纜車到山頂站");
    var tr0 = w.trees.list[0];
    var ft = FR.newFree(t, w, { dog: dog, snow: "groomed", lift: 0 }, null);
    ft.st.p[0] = tr0[0] - 0.5; ft.st.p[2] = tr0[1]; ft.st.p[1] = T.height(t, ft.st.p[0], ft.st.p[2]); ft.st.v = [8, 0, 0];
    FR.stepFree(ft, { s: 0, c: 0, j: 0, g: 0 });
    assert.ok(ft.st.fall > 0, "撞到樹會摔倒");
    ok("M2 自由滑行：纜車、骨頭、樹（樹 " + w.trees.list.length + " 棵）");
  }).then(function () {
    // 8 個雪場：Slopestyle 與 Cross 的 CPU 都能跑完
    return D.RESORTS.reduce(function (p, id) {
      return p.then(function () {
        return loadResort(id).then(function (rr) {
          var t = rr.t, j = rr.json;
          var spid = j.events.slope.piste, sseed = Core.courseSeed(id, spid);
          var s1 = SLP.simCpu(t, { piste: spid, seed: sseed, snow: "groomed", runNo: 0 }, D.CPU[2], sseed, 0);
          assert.strictEqual(s1.status, "finish", id + " Slopestyle 完賽（" + s1.reason + "）");
          var cpid = j.events.cross.piste, cseed = Core.courseSeed(id, cpid), cf = Core.cpuField(cseed, 6);
          var race = CX.newCross(t, { piste: cpid, seed: cseed, snow: "groomed", dogs: cf.map(function (c) { return Core.breed(c.breed); }) });
          var ctl = CX.controllers(race, cseed, -1);
          while (race.status === "run") CX.stepCross(race, ctl.map(function (c) { return c(race); }));
          var dnf = race.riders.filter(function (x) { return x.dnf; }).length;
          assert.ok(dnf <= 1, id + " Cross 未完賽 ≤ 1（" + dnf + "）");
          console.log("  " + id + "：Slopestyle " + s1.score + " 分；Cross 冠軍 " + race.riders.filter(function (x) { return x.place === 1; })[0].time.toFixed(1) + " 秒");
        });
      });
    }, Promise.resolve()).then(function () { ok("8 個雪場 × Slopestyle／Cross"); });
  });
}).then(function () {
  return require("./p3_check.js")();
}).then(function () {
  return require("./p4_check.js")();
}).then(function () {
  return require("./p5_check.js")();
}).then(function () {
  console.log("inusnow core_check OK");
}).catch(function (e) {
  console.error(e);
  process.exit(1);
});
