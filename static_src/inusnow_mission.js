/* イヌスノー（狗雪）任務：M1 救難犬（docs/inusnow_design.md §18.6）、M5 雪崩逃脫（§18.8）。
   不碰 DOM、不讀寫 localStorage；只用 + − × ÷、Math.sqrt、Math.floor、Math.abs、Math.imul（設計 §11）。 */
(function (root) {
  "use strict";

  var D = root.PriTestInusnowData || (typeof require === "function" ? require("./inusnow_data.js") : null);
  var T = root.PriTestInusnowTerrain || (typeof require === "function" ? require("./inusnow_terrain.js") : null);
  var Phys = root.PriTestInusnowPhys || (typeof require === "function" ? require("./inusnow_phys.js") : null);
  var Core = root.PriTestInusnowCore || (typeof require === "function" ? require("./inusnow_core.js") : null);
  var Env = root.PriTestInusnowEnv || (typeof require === "function" ? require("./inusnow_env.js") : null);
  var RS = D.RESCUE, AV = D.AVALANCHE, F = D.FREE, HZ = D.PHYS.hz;

  // 樹（自由滑行的清單）：撞到就摔倒
  function treeGrid(list) {
    var grid = {};
    for (var q = 0; q < list.length; q++) {
      var key = Math.floor(list[q][0] / F.treeCell) * 4096 + Math.floor(list[q][1] / F.treeCell);
      (grid[key] || (grid[key] = [])).push(q);
    }
    return { list: list, grid: grid };
  }
  function hitTrees(st, trees, terrain) {
    if (st.air) return false;
    var x = st.p[0], z = st.p[2], gi = Math.floor(x / F.treeCell), gj = Math.floor(z / F.treeCell), hit = false;
    for (var di = -1; di <= 1; di++) for (var dj = -1; dj <= 1; dj++) {
      var cell = trees.grid[(gi + di) * 4096 + (gj + dj)];
      if (!cell) continue;
      for (var q = 0; q < cell.length; q++) {
        var tr = trees.list[cell[q]], ex = st.p[0] - tr[0], ez = st.p[2] - tr[1], r = F.treeR * tr[2] + 0.4, d2 = ex * ex + ez * ez;
        if (d2 >= r * r) continue;
        var dl = Math.sqrt(d2) || 1;
        st.p[0] = tr[0] + ex / dl * r; st.p[2] = tr[1] + ez / dl * r; st.p[1] = T.height(terrain, st.p[0], st.p[2]);
        if (Phys.speed(st) > F.knockSpeed) hit = Phys.knock(st) || hit; else { st.v[0] *= 0.5; st.v[2] *= 0.5; }
      }
    }
    return hit;
  }
  function clampGrid(st, terrain) {
    if (st.p[0] < 5 || st.p[0] > terrain.sizeX - 5) { st.v[0] = -st.v[0] * 0.5; st.p[0] = st.p[0] < 5 ? 5 : terrain.sizeX - 5; }
    if (st.p[2] < 5 || st.p[2] > terrain.sizeZ - 5) { st.v[2] = -st.v[2] * 0.5; st.p[2] = st.p[2] < 5 ? 5 : terrain.sizeZ - 5; }
  }

  // ---------------- M1 救難犬 ----------------
  // 從某條雪道旁出發，沿最陡的下坡方向畫出雪崩區（約 250 m），被埋者 3～5 位分散在路線兩側 ±25 m。
  function newRescue(terrain, world, opts) {
    var rng = Core.makeRng((opts.seed ^ Core.hash("rescue|" + terrain.id)) >>> 0);
    var pistes = world.pistes.length ? world.pistes : (terrain.json.pistes || []).map(function (p) { return p.id; });
    var path = null;
    for (var tries = 0; tries < 30 && !path; tries++) {
      var pi = T.piste(terrain, pistes[Math.floor(rng() * pistes.length)]);
      var a = T.at(pi, pi.len * (0.1 + rng() * 0.3));
      var pts = [[a.x, a.z]], x = a.x, z = a.z;
      for (var k = 0; k < RS.pathLen; k++) {
        var n = T.normal(terrain, x, z), gx = n[0], gz = n[2], gl = Math.sqrt(gx * gx + gz * gz);
        if (gl < 0.05) break;                                  // 平地：停
        x += gx / gl * RS.pathStep; z += gz / gl * RS.pathStep;
        if (x < 30 || z < 30 || x > terrain.sizeX - 30 || z > terrain.sizeZ - 30) break;
        pts.push([x, z]);
      }
      if (pts.length >= 30) path = pts;
    }
    if (!path) path = [[terrain.sizeX / 2, terrain.sizeZ / 2], [terrain.sizeX / 2, terrain.sizeZ / 2 + 5]];
    var nv = RS.victims[0] + Math.floor(rng() * (RS.victims[1] - RS.victims[0] + 1));
    var victims = [];
    for (var v = 0; v < nv; v++) {
      var idx = Math.floor(path.length * (0.25 + 0.7 * (v + rng() * 0.8) / nv));
      if (idx > path.length - 2) idx = path.length - 2;
      var p0 = path[idx], p1 = path[idx + 1], dx = p1[0] - p0[0], dz = p1[1] - p0[1], dl = Math.sqrt(dx * dx + dz * dz) || 1;
      var lat = (rng() * 2 - 1) * RS.lateral;
      victims.push({ id: v, pi: idx, x: p0[0] + (-dz / dl) * lat, z: p0[1] + (dx / dl) * lat, found: false, dig: 0 });
    }
    // 雪崩區（路線 ±40 m）裡的樹被雪崩沖走：只留外面的
    var keep = world.trees.list.filter(function (tr) {
      for (var i = 0; i < path.length; i += 2) { var ex = tr[0] - path[i][0], ez = tr[1] - path[i][1]; if (ex * ex + ez * ez < 1600) return false; }
      return true;
    });
    var s0 = path[0], s1 = path[1], sdx = s1[0] - s0[0], sdz = s1[1] - s0[1], sl = Math.sqrt(sdx * sdx + sdz * sdz) || 1;
    var st = Phys.create(terrain, { x: s0[0], z: s0[1], tx: sdx / sl, tz: sdz / sl }, opts.dog);
    st.v[0] *= 0.3; st.v[1] *= 0.3; st.v[2] *= 0.3;
    return {
      kind: "rescue", terrain: terrain, opts: opts, st: st, path: path, victims: victims, trees: treeGrid(keep),
      E: Env.make(opts.cond || Env.standard(), { seed: opts.seed, dog: opts.dog }),
      steps: 0, status: "run", inputs: [], events: [], found: 0, score: 0, digging: -1, gates: [],
    };
  }
  function nearestVictim(run) {
    var st = run.st, best = -1, bd = 0;
    for (var i = 0; i < run.victims.length; i++) {
      var v = run.victims[i];
      if (v.found) continue;
      var dx = v.x - st.p[0], dz = v.z - st.p[2], d = Math.sqrt(dx * dx + dz * dz);
      if (best < 0 || d < bd) { best = i; bd = d; }
    }
    return best < 0 ? null : { i: best, d: bd };
  }
  // 嗅覺的脈動間隔（秒）：距離 5～80 m（× nose）對應 0.1～1.5 秒；範圍外＝0（不跳）
  function pulse(run, nose) {
    var nv = nearestVictim(run);
    if (!nv) return 0;
    var max = RS.senseMax * (nose || 1);
    if (nv.d > max) return 0;
    var k = (nv.d - RS.senseMin) / (max - RS.senseMin);
    if (k < 0) k = 0;
    return RS.pulseMin + (RS.pulseMax - RS.pulseMin) * k;
  }
  function stepRescue(run, input) {
    if (run.status !== "run") return run.status;
    var inp = Core.normInput(input), st = run.st;
    run.inputs.push(inp);
    // 挖掘：被埋者 brakeR 內按住挖掘鍵（g＝1）→ 煞停；digR 內、速度 < 1 m/s 時累積，2 秒救出
    var nv = nearestVictim(run), dig = false;
    if (nv && nv.d <= RS.brakeR && inp.g === 1) dig = true;
    var env = Core.mergeEnv({ terrain: run.terrain, snow: "groomed" }, run.E, run.steps);
    if (dig) env.brake = true;
    var ev = Phys.step(st, inp, env);
    run.steps += 1;
    clampGrid(st, run.terrain);
    if (hitTrees(st, run.trees, run.terrain)) ev.push("tree");
    for (var e = 0; e < ev.length; e++) run.events.push({ k: run.steps, e: ev[e] });
    run.digging = -1;
    if (dig && nv.d <= RS.digR && Phys.speed(st) < 1) {
      var v = run.victims[nv.i];
      v.dig += 1;
      run.digging = nv.i;
      if (v.dig >= RS.dig) { v.found = true; run.found += 1; run.events.push({ k: run.steps, e: "rescue", n: v.id }); }
    } else if (nv && nv.d > RS.digR) run.victims[nv.i].dig = 0;
    var left = RS.sec - run.steps / HZ;
    if (run.found >= run.victims.length || left <= 0) {
      run.status = "finish";
      run.score = run.found * RS.per + (left > 0 ? Math.floor(left) * RS.perSec : 0);
    }
    return run.status;
  }

  // ---------------- M5 雪崩逃脫 ----------------
  // 雪崩前緣在後方 40 m 起追，沿雪道中心線前進：速度 8 m/s 起每秒 +0.6，最高 25 m/s
  function newAvalanche(terrain, world, opts) {
    var pi = T.piste(terrain, opts.piste);
    var a = T.at(pi, D.GATES.startS);
    var st = Phys.create(terrain, a, opts.dog);
    return {
      kind: "avalanche", terrain: terrain, opts: opts, piste: pi, st: st, trees: world.trees, gates: [],
      E: Env.make(opts.cond || Env.standard(), { piste: pi, seed: opts.seed, dog: opts.dog }),
      front: D.GATES.startS - AV.behind, fv: AV.v0, s: D.GATES.startS, near: null,
      steps: 0, status: "run", inputs: [], events: [], score: 0, escaped: false,
    };
  }
  function stepAvalanche(run, input) {
    if (run.status !== "run") return run.status;
    var inp = Core.normInput(input), st = run.st;
    run.inputs.push(inp);
    var ev = Phys.step(st, inp, Core.mergeEnv({ terrain: run.terrain, snow: "groomed" }, run.E, run.steps));
    run.steps += 1;
    Core.zoomTick(st, ev);
    clampGrid(st, run.terrain);
    if (hitTrees(st, run.trees, run.terrain)) ev.push("tree");
    for (var e = 0; e < ev.length; e++) run.events.push({ k: run.steps, e: ev[e] });
    run.near = T.nearest(run.piste, st.p[0], st.p[2], run.near ? run.near.i : null);
    if (Math.abs(run.near.d) > run.piste.width / 2 + 120) run.near = T.nearest(run.piste, st.p[0], st.p[2]);
    run.s = run.near.s;
    run.fv += AV.acc / HZ;
    if (run.fv > AV.vMax) run.fv = AV.vMax;
    run.front += run.fv / HZ;
    var sec = run.steps / HZ;
    if (run.s >= run.piste.len - D.GATES.finishMargin) {
      run.status = "finish"; run.escaped = true;
    } else if (run.front >= run.s || sec >= 180) {
      run.status = "finish";
      run.events.push({ k: run.steps, e: "caught" });
    }
    if (run.status !== "run") run.score = Math.floor(run.s - D.GATES.startS) + Math.floor(sec) + (run.escaped ? AV.finishBonus : 0);
    return run.status;
  }

  // 自動駕駛（測試用）：往路線上還沒經過、還沒救出的下一位被埋者滑，接近時按住挖掘鍵
  function rescueAuto(run, steerTo) {
    var st = run.st, best = 0, bd = 1e9;
    for (var i = 0; i < run.path.length; i++) { var ex = run.path[i][0] - st.p[0], ez = run.path[i][1] - st.p[2], d = ex * ex + ez * ez; if (d < bd) { bd = d; best = i; } }
    var tgt = null;
    for (var k = 0; k < run.victims.length; k++) { var v = run.victims[k]; if (!v.found && v.pi >= best - 2 && (!tgt || v.pi < tgt.pi)) tgt = v; }
    if (!tgt) return { s: 0, c: 1, j: 0, g: 0 };
    var dx = tgt.x - st.p[0], dz = tgt.z - st.p[2], dd = Math.sqrt(dx * dx + dz * dz);
    return { s: steerTo(st, tgt.x, tgt.z, Phys.speed(st)), c: 0, j: 0, g: dd < RS.brakeR ? 1 : 0 };
  }

  var Mission = { rescueAuto: rescueAuto, newRescue: newRescue, stepRescue: stepRescue, pulse: pulse, nearestVictim: nearestVictim, newAvalanche: newAvalanche, stepAvalanche: stepAvalanche, hitTrees: hitTrees };
  root.PriTestInusnowMission = Mission;
  if (typeof module !== "undefined" && module.exports) module.exports = Mission;
})(typeof window !== "undefined" ? window : globalThis);
