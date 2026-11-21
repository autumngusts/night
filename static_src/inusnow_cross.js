/* イヌスノー（狗雪）Snowboard Cross（docs/inusnow_design.md §17.4）：出發台、波浪、護牆彎、跳台；6 隻同場、軟牆、碰撞、CPU。
   碰撞讓每位選手的結果依賴別人，所以所有選手放在同一個模擬裡一起跑（stepCross），紀錄是「每位選手的輸入」。
   不碰 DOM、不讀寫 localStorage；只用 + − × ÷、Math.sqrt、Math.floor、Math.abs、Math.imul（設計 §11、§16）。 */
(function (root) {
  "use strict";

  var D = root.PriTestInusnowData || (typeof require === "function" ? require("./inusnow_data.js") : null);
  var T = root.PriTestInusnowTerrain || (typeof require === "function" ? require("./inusnow_terrain.js") : null);
  var Phys = root.PriTestInusnowPhys || (typeof require === "function" ? require("./inusnow_phys.js") : null);
  var Core = root.PriTestInusnowCore || (typeof require === "function" ? require("./inusnow_core.js") : null);
  var CR = D.CROSS, P = D.PHYS, Z = D.ZOOM, SL = D.SLOPE, SC = D.SCENT;
  function EnvM() { return root.PriTestInusnowEnv || (typeof require === "function" ? require("./inusnow_env.js") : null); }
  var DT = 1 / P.hz;

  function between(rng, a) { return a[0] + (a[1] - a[0]) * rng(); }
  function intBetween(rng, a) { return a[0] + Math.floor(rng() * (a[1] - a[0] + 1)); }

  // ---------------- 賽道 ----------------
  function makeCross(terrain, pisteId, seed) {
    var pi = T.piste(terrain, pisteId);
    var rng = Core.makeRng((seed ^ Core.hash("cross")) >>> 0);
    var W = pi.width, feats = [], used = [];
    function free(a, b) {
      for (var i = 0; i < used.length; i++) if (a < used[i][1] + 10 && b > used[i][0] - 10) return false;
      return a > 40 && b < pi.len - 40;
    }
    // 跳台與波浪要放在「速度不會掉光」的地方：前 30 m～後 15 m 每 5 m 的坡度都 ≥ 0.08，且沒有急彎
    function fast(s) {
      for (var q = s - 30; q < s + 15; q += 5) {
        var p1 = T.at(pi, q), p2 = T.at(pi, q + 5);
        if ((T.height(terrain, p1.x, p1.z) - T.height(terrain, p2.x, p2.z)) / 5 < 0.08) return false;
      }
      var t1 = T.at(pi, s - 30), t2 = T.at(pi, s + 15);
      return t1.tx * t2.tx + t1.tz * t2.tz > 0.9;
    }
    function base(k, s, extra) {
      var a = T.at(pi, s);
      var f = { k: k, x: a.x, z: a.z, tx: a.tx, tz: a.tz, s: s };
      for (var key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) f[key] = extra[key];
      return f;
    }
    // 出發台（下坡助滑）
    var a0 = T.at(pi, 0);
    feats.push({ k: "drop", x: a0.x, z: a0.z, tx: a0.tx, tz: a0.tz, s: 0, L: CR.drop.L, H: CR.drop.H, W: W + 4 });
    // 護牆彎：雪道方向變化大的地方（外側）；不夠就左右交錯補上
    var cand = [];
    for (var s = 60; s < pi.len - 60; s += 10) {
      var t1 = T.at(pi, s - 20), t2 = T.at(pi, s + 20);
      var turn = t2.tx * (-t1.tz) + t2.tz * t1.tx;           // >0：往右彎
      cand.push({ s: s, turn: turn });
    }
    cand.sort(function (p, q) { return Math.abs(q.turn) - Math.abs(p.turn) || p.s - q.s; });
    var nBank = intBetween(rng, CR.banks), banks = [];
    for (var c = 0; c < cand.length && banks.length < nBank; c++) {
      if (Math.abs(cand[c].turn) < 0.2) break;
      var bs = cand[c].s;
      if (!free(bs - CR.bank.len / 2, bs + CR.bank.len / 2)) continue;
      used.push([bs - CR.bank.len / 2, bs + CR.bank.len / 2]);
      banks.push({ s: bs, side: cand[c].turn > 0 ? -1 : 1 });
    }
    var side = rng() < 0.5 ? -1 : 1;
    for (var tries = 0; banks.length < CR.banks[0] && tries < 60; tries++) {
      var bs2 = 60 + rng() * (pi.len - 120);
      if (!free(bs2 - CR.bank.len / 2, bs2 + CR.bank.len / 2)) continue;
      used.push([bs2 - CR.bank.len / 2, bs2 + CR.bank.len / 2]);
      banks.push({ s: bs2, side: side });
      side = -side;
    }
    banks.forEach(function (b) {
      feats.push(base("bank", b.s, { side: b.side, B: CR.bank.B, d0: W / 2 - CR.bank.inset, dw: CR.bank.dw, len: CR.bank.len, fade: CR.bank.fade }));
    });
    // 跳台（M 或 L，橫跨整個雪道寬）
    var nK = intBetween(rng, CR.kickers);
    for (var k = 0, tk = 0; k < nK && tk < 200; tk++) {
      var K = rng() < 0.5 ? SL.kicker.S : SL.kicker.M;
      var ks = 150 + rng() * (pi.len - 230);
      if (!free(ks - K.L - 2, ks + 28)) continue;
      if (!fast(ks)) continue;
      used.push([ks - K.L - 2, ks + 28]);
      feats.push(base("kicker", ks, { L: K.L, H: K.H, W: W }));
      k += 1;
    }
    // 波浪段 2～3 組，每組 3～5 個
    var nG = intBetween(rng, CR.rollerGroups);
    for (var gI = 0, tg = 0; gI < nG && tg < 200; tg++) {
      var n = intBetween(rng, CR.rollers), len = between(rng, CR.rollerLen), A = between(rng, CR.rollerA);
      var glen = n * (len + 2);
      var gs = 60 + rng() * (pi.len - 120 - glen);
      if (!free(gs - len, gs + glen) || !fast(gs) || !fast(gs + glen - 15)) continue;
      used.push([gs - len, gs + glen]);
      for (var r = 0; r < n; r++) feats.push(base("roller", gs + r * (len + 2), { A: A, len: len, W: W + 2 }));
      gI += 1;
    }
    return feats;
  }

  // ---------------- 比賽 ----------------
  // opts：{piste, seed, dogs: [6 隻], snow}
  function newCross(terrain, opts) {
    var feats = makeCross(terrain, opts.piste, opts.seed);
    var tw = T.withFeatures(terrain, feats);
    var pi = T.piste(tw, opts.piste);
    var a = T.at(pi, CR.startS), rx = -a.tz, rz = a.tx;
    var riders = [], ins = [];
    var n = opts.dogs.length;
    for (var k = 0; k < n; k++) {
      var lat = (k - (n - 1) / 2) * CR.laneGap;
      var st = Phys.create(tw, { x: a.x + rx * lat, z: a.z + rz * lat, tx: a.tx, tz: a.tz }, opts.dogs[k]);
      riders.push({ k: k, st: st, near: null, done: false, time: null, place: 0, rank: k + 1, s: CR.startS });
      ins.push([]);
    }
    var fs = pi.len - CR.finishMargin, fin = T.at(pi, fs);
    // G2 嗅覺捷徑：彎道內側穿過樹林的弦（1～2 條）
    var crng = Core.makeRng((opts.seed ^ Core.hash("cuts")) >>> 0);
    var cuts = EnvM().makeShortcuts(terrain, pi, crng, SC.count[0] + Math.floor(crng() * (SC.count[1] - SC.count[0] + 1)));
    var Es = opts.dogs.map(function (dg) { return EnvM().make(opts.cond || EnvM().standard(), { piste: pi, seed: opts.seed, dog: dg, cuts: cuts }); });
    return {
      cuts: cuts, Es: Es,
      kind: "cross", terrain: tw, base: terrain, opts: opts, piste: pi, feats: feats, gates: [],
      finish: { x: fin.x, z: fin.z, tx: fin.tx, tz: fin.tz, s: fs },
      riders: riders, inputs: ins, events: [], steps: 0, status: "run", finished: 0, touch: {},
    };
  }

  function stepCross(race, inputs) {
    if (race.status !== "run") return race.status;
    var rs = race.riders, pi = race.piste, n = rs.length;
    race.steps += 1;
    var pre = [];
    for (var k = 0; k < n; k++) {
      var r = rs[k], st = r.st;
      pre.push([st.p[0], st.p[2]]);
      if (r.done) continue;
      var inp = Core.normInput(inputs[k] || {});
      race.inputs[k].push(inp);
      var ev = Phys.step(st, inp, Core.mergeEnv({ terrain: race.terrain, snow: race.opts.snow }, race.Es[k], race.steps));
      Core.zoomTick(st, ev);
      EnvM().scentTick(st, inp, race.opts.dogs[k].nose, race.cuts, ev);
      if (EnvM().treeHit(st, race.cuts, race.terrain, Phys)) ev.push("fall");
      for (var e = 0; e < ev.length; e++) race.events.push({ k: race.steps, e: ev[e], r: k });
      // 軟牆：雪道寬度外 2 m 起，每超出 1 m 側向推回 4 m/s²、每步減速 2%
      r.near = T.nearest(pi, st.p[0], st.p[2], r.near ? r.near.i : null);
      r.s = r.near.s;
      var ex = Math.abs(r.near.d) - (pi.width / 2 + CR.softMargin);
      if (ex > 0 && !st.air && EnvM().inShortcut(race.cuts, st.p[0], st.p[2], SC.corridor) < 0) {
        var sg = r.near.d > 0 ? -1 : 1;
        st.v[0] += sg * (-r.near.tz) * CR.softPush * ex * DT;
        st.v[2] += sg * r.near.tx * CR.softPush * ex * DT;
        st.v[0] *= 1 - CR.softSlow; st.v[1] *= 1 - CR.softSlow; st.v[2] *= 1 - CR.softSlow;
      }
    }
    // 碰撞：依編號順序處理每一對
    var rad2 = CR.radius * 2;
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var A = rs[i], B = rs[j];
        if (A.done || B.done) continue;
        var dx = B.st.p[0] - A.st.p[0], dz = B.st.p[2] - A.st.p[2], d2 = dx * dx + dz * dz;
        var key = i * 16 + j;
        if (d2 >= rad2 * rad2) { if (race.touch[key]) race.touch[key] = 0; continue; }
        var fresh = !race.touch[key];
        race.touch[key] = 1;
        var dl = Math.sqrt(d2);
        var nx, nz;
        if (dl > 1e-6) { nx = dx / dl; nz = dz / dl; } else { nx = -A.st.h[1]; nz = A.st.h[0]; dl = 0; }
        var push = (rad2 - dl) / 2;
        A.st.p[0] -= nx * push; A.st.p[2] -= nz * push;
        B.st.p[0] += nx * push; B.st.p[2] += nz * push;
        if (!A.st.air) A.st.p[1] = T.height(race.terrain, A.st.p[0], A.st.p[2]);
        if (!B.st.air) B.st.p[1] = T.height(race.terrain, B.st.p[0], B.st.p[2]);
        var rvx = A.st.v[0] - B.st.v[0], rvy = A.st.v[1] - B.st.v[1], rvz = A.st.v[2] - B.st.v[2];
        var rel = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz);
        // 速度損失只在剛碰到的那一步（一直貼著不會每步減速）
        if (!fresh) continue;
        for (var q = 0; q < 3; q++) { A.st.v[q] *= CR.bump; B.st.v[q] *= CR.bump; }
        race.events.push({ k: race.steps, e: "bump", r: i, o: j });
        if (rel > CR.airRel && (A.st.air || B.st.air)) {
          if (A.st.air && Phys.knock(A.st)) race.events.push({ k: race.steps, e: "fall", r: i });
          if (B.st.air && Phys.knock(B.st)) race.events.push({ k: race.steps, e: "fall", r: j });
        }
      }
    }
    // 終點
    var f = race.finish;
    for (var m = 0; m < n; m++) {
      var R = rs[m];
      if (R.done) continue;
      var fa = (pre[m][0] - f.x) * f.tx + (pre[m][1] - f.z) * f.tz, fb = (R.st.p[0] - f.x) * f.tx + (R.st.p[2] - f.z) * f.tz;
      if (fa < 0 && fb >= 0 && R.s > f.s - 30) {
        R.done = true;
        R.time = (race.steps - 1 + (-fa) / (fb - fa)) / P.hz;
        race.finished += 1;
        R.place = race.finished;
        race.events.push({ k: race.steps, e: "finish", r: m, n: R.place });
      }
    }
    // 名次（每 30 步）：超車 +6 興奮度
    if (race.steps % 30 === 0) {
      var order = rankOrder(race);
      for (var o = 0; o < order.length; o++) {
        var rr = rs[order[o]];
        var nr = o + 1;
        if (!rr.done && nr < rr.rank) {
          Core.zoomGain(rr.st, Z.pass * (rr.rank - nr));
          race.events.push({ k: race.steps, e: "pass", r: rr.k });
        }
        rr.rank = nr;
      }
    }
    if (race.finished >= n) { race.status = "finish"; }
    else if (race.steps > CR.maxSec * P.hz) {
      // 超時：沒完賽的依位置排在後面
      var ord = rankOrder(race);
      for (var z = 0; z < ord.length; z++) { var u = rs[ord[z]]; if (!u.done) { race.finished += 1; u.place = race.finished; u.done = true; u.dnf = true; } }
      race.status = "finish";
    }
    return race.status;
  }

  // 目前的名次：已完賽依名次，其他依沿雪道的距離
  function rankOrder(race) {
    var idx = [];
    for (var i = 0; i < race.riders.length; i++) idx.push(i);
    idx.sort(function (a, b) {
      var A = race.riders[a], B = race.riders[b];
      if (A.done && B.done) return A.place - B.place;
      if (A.done) return -1;
      if (B.done) return 1;
      return B.s - A.s || a - b;
    });
    return idx;
  }

  // ---------------- CPU（設計 §17.4） ----------------
  // 沿中心線＋自己的線（依編號偏左或偏右）；前方 6 m 內有人時往空的一側偏 2 m 超車；跳台前蹲低、空中不轉體
  function cpuController(k, seed) {
    var rng = Core.makeRng(seed >>> 0);
    var prefer = (rng() * 2 - 1) * 3;
    return function (race) {
      var me = race.riders[k], st = me.st, pi = race.piste;
      var out = { s: 0, c: 0, j: 0, g: 0 };
      if (me.done || st.air) return out;
      var near = me.near || T.nearest(pi, st.p[0], st.p[2]);
      var sp = Phys.speed(st);
      var lat = prefer;
      for (var i = 0; i < race.riders.length; i++) {
        if (i === k) continue;
        var o = race.riders[i];
        if (o.done || !o.near) continue;
        var ds = o.near.s - near.s, dd = o.near.d - near.d;
        if (ds > -1.5 && ds < CR.look && Math.abs(dd) < 1.5) {
          lat = near.d + (dd > 0 ? -CR.passShift : CR.passShift);
          if (Math.abs(lat) > pi.width / 2 - 3) lat = near.d + (dd > 0 ? CR.passShift : -CR.passShift);
        }
      }
      if (lat > pi.width / 2 - 3) lat = pi.width / 2 - 3; else if (lat < -pi.width / 2 + 3) lat = -pi.width / 2 + 3;
      // 下一個跳台
      var toK = 999;
      for (var q = 0; q < race.feats.length; q++) {
        var f = race.feats[q];
        if (f.k === "kicker" && f.s > near.s && f.s - near.s < toK) toK = f.s - near.s;
      }
      var at = T.at(pi, near.s + 5 + sp * 0.35);
      out.s = steer(st, at.x + (-at.tz) * lat, at.z + at.tx * lat, sp);
      out.c = (toK < 12 || sp < 22) && Math.abs(out.s) <= 2 ? 1 : 0;
      if (st.zoom >= Z.max && st.zoomT === 0 && toK > Z.straight) out.z = 1;
      return out;
    };
  }
  function steer(st, tx, tz, sp) {
    var vx = st.v[0], vz = st.v[2], vh = Math.sqrt(vx * vx + vz * vz);
    var hx = vh > 1 ? vx / vh : st.h[0], hz = vh > 1 ? vz / vh : st.h[1];
    var ex = tx - st.p[0], ez = tz - st.p[2], el = Math.sqrt(ex * ex + ez * ez) || 1;
    var cr = (ex * (-hz) + ez * hx) / el, dot = (ex * hx + ez * hz) / el;
    var s2 = sp > 2 ? sp : 2;
    var wMax = P.turnBase * st.mods.turn / (1 + s2 / P.turnSpeedRef);
    var s = 8 * s2 * (2 * cr / el) / wMax * 1.4;
    if (dot < 0) s = cr >= 0 ? 8 : -8;
    s = Math.floor(s + 0.5);
    if (s > 8) s = 8; else if (s < -8) s = -8;
    return s;
  }

  // CPU 的控制器陣列（玩家的位置放 null）
  function controllers(race, seed, playerIdx) {
    var out = [];
    for (var k = 0; k < race.riders.length; k++) out.push(k === playerIdx ? null : cpuController(k, (seed ^ Core.hash("crosscpu" + k)) >>> 0));
    return out;
  }

  // 重播：用每位選手的紀錄一起重跑
  function replay(terrain, opts, recs) {
    var race = newCross(terrain, opts);
    var ins = recs.map(function (r) { return typeof r === "string" ? Core.decode(r) : r; });
    var max = 0;
    ins.forEach(function (a) { if (a.length > max) max = a.length; });
    var frames = [];
    for (var i = 0; i < max + 1 && race.status === "run"; i++) {
      var step = [];
      for (var k = 0; k < ins.length; k++) step.push(ins[k][i] || { s: 0, c: 0, j: 0, g: 0 });
      stepCross(race, step);
      frames.push(race.riders.map(function (r) { return Core.frameOf(r.st); }));
    }
    return { race: race, frames: frames };
  }

  var Cross = { makeCross: makeCross, newCross: newCross, stepCross: stepCross, rankOrder: rankOrder, cpuController: cpuController, controllers: controllers, replay: replay };
  root.PriTestInusnowCross = Cross;
  if (typeof module !== "undefined" && module.exports) module.exports = Cross;
})(typeof window !== "undefined" ? window : globalThis);
