/* イヌスノー（狗雪）M2 自由滑行（docs/inusnow_design.md §17.8）：整個雪場開放、樹林是障礙、纜車上山、骨頭與隱藏地點、雪道章。
   樹的位置由這裡產生，同一份清單給物理與畫面。
   不碰 DOM、不讀寫 localStorage；只用 + − × ÷、Math.sqrt、Math.floor、Math.abs、Math.imul（設計 §11、§16）。 */
(function (root) {
  "use strict";

  var D = root.PriTestInusnowData || (typeof require === "function" ? require("./inusnow_data.js") : null);
  var T = root.PriTestInusnowTerrain || (typeof require === "function" ? require("./inusnow_terrain.js") : null);
  var Phys = root.PriTestInusnowPhys || (typeof require === "function" ? require("./inusnow_phys.js") : null);
  var Core = root.PriTestInusnowCore || (typeof require === "function" ? require("./inusnow_core.js") : null);
  var F = D.FREE, P = D.PHYS, SC = D.SCENT;
  function EnvM() { return root.PriTestInusnowEnv || (typeof require === "function" ? require("./inusnow_env.js") : null); }

  function isEventPiste(id) { var n = id.length; return id.charAt(n - 2) + id.charAt(n - 1) === "gs" || id.charAt(n - 2) + id.charAt(n - 1) === "sl" || id.charAt(n - 2) + id.charAt(n - 1) === "cx"; }

  // 雪道遮罩（格網上的 0／1）：每個格點離某條雪道中心線在寬度一半＋2 m 內
  function pisteMask(terrain) {
    var w = terrain.w, h = terrain.h, cell = terrain.cell, mask = new Uint8Array(w * h);
    var list = terrain.json.pistes || [];
    for (var pi = 0; pi < list.length; pi++) {
      var p = list[pi], r = Math.floor((p.width / 2 + 2) / cell + 0.5), pts = p.pts;
      if (r < 1) r = 1;
      for (var k = 0; k < pts.length - 1; k++) {
        var x0 = pts[k][0], z0 = pts[k][1], x1 = pts[k + 1][0], z1 = pts[k + 1][1];
        var dl = Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0));
        var n = Math.floor(dl / (cell * 0.5)) + 1;
        for (var t = 0; t <= n; t++) {
          var ci = Math.floor((x0 + (x1 - x0) * t / n) / cell + 0.5), cj = Math.floor((z0 + (z1 - z0) * t / n) / cell + 0.5);
          for (var dj = -r; dj <= r; dj++) for (var di = -r; di <= r; di++) {
            if (di * di + dj * dj > r * r) continue;
            var ii = ci + di, jj = cj + dj;
            if (ii >= 0 && ii < w && jj >= 0 && jj < h) mask[jj * w + ii] = 1;
          }
        }
      }
    }
    return mask;
  }

  // 樹林：雪道外、離某條雪道 treeBand 公尺內（seed 固定）；空間格子 treeCell 公尺
  function makeTrees(terrain, mask) {
    var rng = Core.makeRng(Core.hash("freetrees|" + terrain.id));
    var w = terrain.w, h = terrain.h, cell = terrain.cell;
    var band = Math.floor(F.treeBand / cell);
    // 離雪道 band 格以內的格點（距離轉換：曼哈頓近似，兩次掃描）
    var near = new Int32Array(w * h);
    for (var a = 0; a < w * h; a++) near[a] = mask[a] ? 0 : 99999;
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var k = j * w + i, v = near[k];
      if (i > 0 && near[k - 1] + 1 < v) v = near[k - 1] + 1;
      if (j > 0 && near[k - w] + 1 < v) v = near[k - w] + 1;
      near[k] = v;
    }
    for (var j2 = h - 1; j2 >= 0; j2--) for (var i2 = w - 1; i2 >= 0; i2--) {
      var k2 = j2 * w + i2, v2 = near[k2];
      if (i2 < w - 1 && near[k2 + 1] + 1 < v2) v2 = near[k2 + 1] + 1;
      if (j2 < h - 1 && near[k2 + w] + 1 < v2) v2 = near[k2 + w] + 1;
      near[k2] = v2;
    }
    var trees = [];
    for (var tries = 0; tries < F.treeMax * 8 && trees.length < F.treeMax; tries++) {
      var x = rng() * terrain.sizeX, z = rng() * terrain.sizeZ, sc = 0.7 + rng() * 0.7;
      var ci = Math.floor(x / cell + 0.5), cj = Math.floor(z / cell + 0.5);
      if (ci < 1 || cj < 1 || ci >= w - 1 || cj >= h - 1) continue;
      var nv = near[cj * w + ci];
      if (nv === 0 || nv > band) continue;
      trees.push([x, z, sc]);
    }
    var grid = {};
    for (var q = 0; q < trees.length; q++) {
      var key = Math.floor(trees[q][0] / F.treeCell) * 4096 + Math.floor(trees[q][1] / F.treeCell);
      (grid[key] || (grid[key] = [])).push(q);
    }
    return { list: trees, grid: grid };
  }

  // 纜車：只用格網範圍內的點（有些纜車延伸到格網外）；山腳站＝最低點、山頂站＝最高點
  function lifts(terrain) {
    var out = [], m = 30;
    (terrain.json.lifts || []).forEach(function (l, i) {
      var lo = null, hi = null, hlo = 0, hhi = 0;
      for (var k = 0; k < l.pts.length; k++) {
        var q = l.pts[k];
        if (q[0] < m || q[1] < m || q[0] > terrain.sizeX - m || q[1] > terrain.sizeZ - m) continue;
        var h = T.height(terrain, q[0], q[1]);
        if (!lo || h < hlo) { lo = q; hlo = h; }
        if (!hi || h > hhi) { hi = q; hhi = h; }
      }
      if (!lo || hhi - hlo < 30) return;
      out.push({ i: i, name: l.name || null, bottom: [lo[0], lo[1]], top: [hi[0], hi[1]], rise: hhi - hlo });
    });
    return out;
  }

  // 骨頭（雪道上）與隱藏地點（雪道外的展望點）
  function collectibles(terrain, mask) {
    var rng = Core.makeRng(Core.hash("freebones|" + terrain.id));
    var list = (terrain.json.pistes || []).filter(function (p) { return !isEventPiste(p.id) && p.pts.length > 1; });
    var bones = [], spots = [];
    var total = 0;
    list.forEach(function (p) { total += T.piste(terrain, p.id).len; });
    for (var b = 0; b < F.bones && list.length; b++) {
      var r = rng() * total, pick = list[0];
      for (var i = 0; i < list.length; i++) { var L = T.piste(terrain, list[i].id).len; if (r < L) { pick = list[i]; break; } r -= L; }
      var pi = T.piste(terrain, pick.id), s = 20 + rng() * (pi.len - 40), a = T.at(pi, s > 0 ? s : pi.len / 2);
      var lat = (rng() * 2 - 1) * pi.width * 0.3;
      bones.push({ id: b, x: a.x + (-a.tz) * lat, z: a.z + a.tx * lat });
    }
    for (var tries = 0; list.length && spots.length < F.spots && tries < 400; tries++) {
      var pk = list[Math.floor(rng() * list.length)], pp = T.piste(terrain, pk.id), sa = T.at(pp, rng() * pp.len);
      var side = rng() < 0.5 ? -1 : 1, off = pp.width / 2 + 40 + rng() * 60;
      var x = sa.x + (-sa.tz) * side * off, z = sa.z + sa.tx * side * off;
      var ci = Math.floor(x / terrain.cell + 0.5), cj = Math.floor(z / terrain.cell + 0.5);
      if (ci < 2 || cj < 2 || ci >= terrain.w - 2 || cj >= terrain.h - 2 || mask[cj * terrain.w + ci]) continue;
      spots.push({ id: spots.length, x: x, z: z });
    }
    return { bones: bones, spots: spots };
  }

  // 自由滑行的世界（每個雪場算一次）
  // G2 嗅覺捷徑（自由滑行）：隨機幾條雪道的彎道內側；捷徑通道內的樹林清掉
  function freeCuts(terrain, trees) {
    var rng = Core.makeRng(Core.hash("freecuts|" + terrain.id));
    var list = (terrain.json.pistes || []).filter(function (p) { return !isEventPiste(p.id) && T.piste(terrain, p.id).len > 300; });
    var cuts = [];
    for (var tries = 0; tries < 40 && cuts.length < SC.freeCount && list.length; tries++) {
      var p = list[Math.floor(rng() * list.length)];
      var got = EnvM().makeShortcuts(terrain, T.piste(terrain, p.id), rng, 1);
      if (got.length && cuts.every(function (c) { return c.piste !== got[0].piste; })) cuts.push(got[0]);
    }
    if (cuts.length) {
      var keep = [];
      trees.list.forEach(function (tr) { if (EnvM().inShortcut(cuts, tr[0], tr[1], 1.5) < 0) keep.push(tr); });
      trees.list = keep;
      trees.grid = {};
      for (var q = 0; q < keep.length; q++) {
        var key = Math.floor(keep[q][0] / F.treeCell) * 4096 + Math.floor(keep[q][1] / F.treeCell);
        (trees.grid[key] || (trees.grid[key] = [])).push(q);
      }
    }
    return cuts;
  }

  function makeWorld(terrain) {
    var mask = pisteMask(terrain);
    var c = collectibles(terrain, mask);
    var trees = makeTrees(terrain, mask);
    var cuts = freeCuts(terrain, trees);
    return { mask: mask, trees: trees, cuts: cuts, lifts: lifts(terrain), bones: c.bones, spots: c.spots,
      pistes: (terrain.json.pistes || []).filter(function (p) { return !isEventPiste(p.id) && p.pts.length > 1 && T.piste(terrain, p.id).len >= F.stampMinLen; }).map(function (p) { return p.id; }) };
  }

  // 在纜車山頂站出發：板頭朝最陡的下坡方向
  function placeAt(terrain, x, z) {
    var n = T.normal(terrain, x, z), dx = n[0], dz = n[2], l = Math.sqrt(dx * dx + dz * dz);
    if (l < 1e-6) { dx = 0; dz = 1; l = 1; }
    return { x: x + dx / l * 4, z: z + dz / l * 4, tx: dx / l, tz: dz / l };
  }

  // opts：{dog, snow, lift（出發的纜車編號）}；got：{bones: [id], spots: [id], stamps: [pisteId]}（已收集的，存檔）
  function newFree(terrain, world, opts, got) {
    var lf = world.lifts[opts.lift || 0] || world.lifts[0];
    var at = lf ? placeAt(terrain, lf.top[0], lf.top[1]) : placeAt(terrain, terrain.sizeX / 2, terrain.sizeZ / 2);
    var st = Phys.create(terrain, at, opts.dog);
    st.v[0] *= 0.3; st.v[1] *= 0.3; st.v[2] *= 0.3;
    return {
      kind: "free", terrain: terrain, world: world, opts: opts, st: st, steps: 0, status: "run", inputs: [], events: [], gates: [],
      got: { bones: (got && got.bones || []).slice(), spots: (got && got.spots || []).slice(), stamps: (got && got.stamps || []).slice() },
      newGot: { bones: 0, spots: 0, stamps: 0 }, liftNear: -1, track: {}, still: 0, dist: 0, maxSpeed: 0,
      E: EnvM().make(opts.cond || EnvM().standard(), { seed: Core.hash("free|" + terrain.id), dog: opts.dog, cuts: world.cuts }),
    };
  }

  function teleport(run, liftIdx) {
    var lf = run.world.lifts[liftIdx];
    if (!lf) return false;
    var at = placeAt(run.terrain, lf.top[0], lf.top[1]);
    var st = Phys.create(run.terrain, at, run.opts.dog);
    st.zoom = run.st.zoom;
    st.v[0] *= 0.3; st.v[1] *= 0.3; st.v[2] *= 0.3;
    run.st = st;
    run.track = {};
    run.events.push({ k: run.steps, e: "lift", n: liftIdx });
    return true;
  }

  function has(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i] === v) return true; return false; }

  function stepFree(run, input) {
    var inp = Core.normInput(input);
    run.inputs.push(inp);
    var st = run.st, t = run.terrain, w = run.world;
    var ax = st.p[0], az = st.p[2];
    var ev = Phys.step(st, inp, Core.mergeEnv({ terrain: t, snow: run.opts.snow }, run.E, run.steps));
    run.steps += 1;
    Core.zoomTick(st, ev);
    EnvM().scentTick(st, inp, run.opts.dog.nose, w.cuts, ev);
    if (EnvM().treeHit(st, w.cuts, t, Phys)) ev.push("tree");
    for (var e = 0; e < ev.length; e++) run.events.push({ k: run.steps, e: ev[e] });
    var x = st.p[0], z = st.p[2];
    // 格網邊界：反彈
    if (x < 5 || x > t.sizeX - 5) { st.v[0] = -st.v[0] * 0.5; st.p[0] = x < 5 ? 5 : t.sizeX - 5; }
    if (z < 5 || z > t.sizeZ - 5) { st.v[2] = -st.v[2] * 0.5; st.p[2] = z < 5 ? 5 : t.sizeZ - 5; }
    x = st.p[0]; z = st.p[2];
    var dx = x - ax, dz = z - az;
    run.dist += Math.sqrt(dx * dx + dz * dz);
    var sp = Phys.speed(st);
    if (sp > run.maxSpeed) run.maxSpeed = sp;
    // 樹：撞到就摔倒，推出到樹幹外
    var gi = Math.floor(x / F.treeCell), gj = Math.floor(z / F.treeCell);
    for (var di = -1; di <= 1; di++) for (var dj = -1; dj <= 1; dj++) {
      var cellList = w.trees.grid[(gi + di) * 4096 + (gj + dj)];
      if (!cellList) continue;
      for (var q = 0; q < cellList.length; q++) {
        var tr = w.trees.list[cellList[q]], ex = x - tr[0], ez = z - tr[1], r = F.treeR * tr[2] + 0.4, d2 = ex * ex + ez * ez;
        if (d2 < r * r && !st.air) {
          var dl = Math.sqrt(d2) || 1;
          st.p[0] = tr[0] + ex / dl * r; st.p[2] = tr[1] + ez / dl * r;
          st.p[1] = T.height(t, st.p[0], st.p[2]);
          if (sp > F.knockSpeed && Phys.knock(st)) run.events.push({ k: run.steps, e: "tree" });
          else { st.v[0] *= 0.5; st.v[2] *= 0.5; }
        }
      }
    }
    // 骨頭、隱藏地點
    for (var b = 0; b < w.bones.length; b++) {
      var bo = w.bones[b];
      if (has(run.got.bones, bo.id)) continue;
      if ((x - bo.x) * (x - bo.x) + (z - bo.z) * (z - bo.z) < F.boneR * F.boneR) { run.got.bones.push(bo.id); run.newGot.bones += 1; run.events.push({ k: run.steps, e: "bone", n: bo.id }); }
    }
    for (var s = 0; s < w.spots.length; s++) {
      var so = w.spots[s];
      if (has(run.got.spots, so.id)) continue;
      if ((x - so.x) * (x - so.x) + (z - so.z) * (z - so.z) < F.spotR * F.spotR) { run.got.spots.push(so.id); run.newGot.spots += 1; run.events.push({ k: run.steps, e: "spot", n: so.id }); }
    }
    // 纜車山腳站
    run.liftNear = -1;
    for (var l = 0; l < w.lifts.length; l++) {
      var lb = w.lifts[l].bottom;
      if ((x - lb[0]) * (x - lb[0]) + (z - lb[1]) * (z - lb[1]) < F.liftR * F.liftR) { run.liftNear = l; break; }
    }
    // 雪道章：每 10 步檢查一次所有雪道（起點 50 m 內開始、終點 50 m 內結束、途中 80% 以上在該雪道上）
    if (run.steps % 10 === 0) {
      for (var pi = 0; pi < w.pistes.length; pi++) {
        var pid = w.pistes[pi], pp = T.piste(t, pid), tk = run.track[pid];
        var nr = T.nearest(pp, x, z, tk ? tk.i : null);
        if (tk && Math.abs(nr.d) > pp.width / 2 + 30) nr = T.nearest(pp, x, z);
        var on = Math.abs(nr.d) <= pp.width / 2 + 2;
        if (!tk) {
          if (on && nr.s < F.stampStart) run.track[pid] = { i: nr.i, on: 1, all: 1 };
          continue;
        }
        tk.i = nr.i; tk.all += 1; if (on) tk.on += 1;
        if (on && nr.s > pp.len - F.stampEnd) {
          if (tk.on / tk.all >= F.stampOn && !has(run.got.stamps, pid)) { run.got.stamps.push(pid); run.newGot.stamps += 1; run.events.push({ k: run.steps, e: "stamp", p: pid }); }
          delete run.track[pid];
        } else if (tk.all > 40 && tk.on / tk.all < F.stampOn) delete run.track[pid];
      }
    }
    return run.status;
  }

  var Free = { makeWorld: makeWorld, newFree: newFree, stepFree: stepFree, teleport: teleport, pisteMask: pisteMask, isEventPiste: isEventPiste };
  root.PriTestInusnowFree = Free;
  if (typeof module !== "undefined" && module.exports) module.exports = Free;
})(typeof window !== "undefined" ? window : globalThis);
