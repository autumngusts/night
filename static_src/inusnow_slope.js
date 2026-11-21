/* イヌスノー（狗雪）Slopestyle（docs/inusnow_design.md §17.2）：公園地形（跳台、滑桿、箱子）、空中技巧、滑桿技巧、計分、評審、CPU。
   不碰 DOM、不讀寫 localStorage；只用 + − × ÷、Math.sqrt、Math.floor、Math.abs、Math.imul（設計 §11、§16）。 */
(function (root) {
  "use strict";

  var D = root.PriTestInusnowData || (typeof require === "function" ? require("./inusnow_data.js") : null);
  var T = root.PriTestInusnowTerrain || (typeof require === "function" ? require("./inusnow_terrain.js") : null);
  var Phys = root.PriTestInusnowPhys || (typeof require === "function" ? require("./inusnow_phys.js") : null);
  var Core = root.PriTestInusnowCore || (typeof require === "function" ? require("./inusnow_core.js") : null);
  var SL = D.SLOPE, G = D.GATES, P = D.PHYS, AI = D.CPU_AI;
  var DT = 1 / P.hz;
  var PI = 3.141592653589793;
  var SPIN_ON = SL.spinOnDeg * PI / 180;

  // ---------------- 公園（地形清單） ----------------
  // 依序 6 個地形（box、rail、kicker S／M／L、rail），間隔 70～90 m；雪道短時把間隔等比縮短。
  function makePark(terrain, pisteId, seed) {
    var pi = T.piste(terrain, pisteId);
    var rng = Core.makeRng((seed ^ Core.hash("park")) >>> 0);
    var n = SL.order.length;
    var avail = pi.len - G.finishMargin - SL.finishAfter - SL.first - SL.rail.len;
    var gapMin = SL.gapMin, gapMax = SL.gapMax;
    if (avail / (n - 1) < gapMax) { gapMax = avail / (n - 1); if (gapMin > gapMax) gapMin = gapMax; }
    var feats = [], s = SL.first, last = s;
    for (var i = 0; i < n; i++) {
      var kind = SL.order[i];
      var a = T.at(pi, s);
      var lat = (rng() * 2 - 1) * SL.lateral;
      var sz = 1 + (rng() * 2 - 1) * SL.sizeVar;
      var rx = -a.tz, rz = a.tx, cx = a.x + rx * lat, cz = a.z + rz * lat;
      if (kind.indexOf("kicker") === 0) {
        var K = SL.kicker[kind.charAt(6)];
        feats.push({ k: "kicker", id: i, kind: kind, x: cx, z: cz, tx: a.tx, tz: a.tz, L: K.L * sz, H: K.H * sz, W: K.W, s: s, lat: lat });
      } else {
        var R = kind === "box" ? SL.box : SL.rail;
        // 上桿台（kicker 形狀）的唇口＝滑桿起點
        feats.push({ k: "kicker", id: i, kind: "ramp", ramp: true, x: cx, z: cz, tx: a.tx, tz: a.tz, L: SL.ramp.L, H: SL.ramp.H, W: SL.ramp.W, s: s, lat: lat });
        var ex = cx + a.tx * R.len, ez = cz + a.tz * R.len;
        feats.push({ k: kind, id: i, kind: kind, x: cx, z: cz, tx: a.tx, tz: a.tz, len: R.len, w: R.w, s: s, lat: lat,
          y0: T.height(terrain, cx, cz) + R.top, y1: T.height(terrain, ex, ez) + R.top });
      }
      last = s;
      if (i < n - 1) s += gapMin + (gapMax - gapMin) * rng();
    }
    return { feats: feats, finishS: last + SL.rail.len + SL.finishAfter };
  }

  // ---------------- 比賽 ----------------
  // opts：{piste, seed, dog, snow, runNo}
  function newSlope(terrain, opts) {
    var park = makePark(terrain, opts.piste, opts.seed);
    var tw = T.withFeatures(terrain, park.feats);
    var pi = T.piste(tw, opts.piste);
    var a = T.at(pi, G.startS);
    var fs = park.finishS;
    if (fs > pi.len - G.finishMargin) fs = pi.len - G.finishMargin;
    var fin = T.at(pi, fs);
    var EnvM = root.PriTestInusnowEnv || (typeof require === "function" ? require("./inusnow_env.js") : null);
    return {
      E: opts.cond ? EnvM.make(opts.cond, { piste: pi, seed: opts.seed, dog: opts.dog }) : null,
      kind: "slope", terrain: tw, base: terrain, opts: opts, piste: pi, feats: park.feats, gates: [],
      finish: { x: fin.x, z: fin.z, tx: fin.tx, tz: fin.tz, s: fs },
      st: Phys.create(tw, a, opts.dog),
      status: "run", reason: null, time: null, steps: 0, still: 0, near: null, next: 0,
      inputs: [], events: [],
      air: null, grind: null, railOff: null, tried: {}, shakeWin: 0, prevG: 0, lastTrick: null,
      tricks: [], featScore: [0, 0, 0, 0, 0, 0], seen: {}, score: 0, judges: null, final: 0,
    };
  }

  function featById(run, id, rail) {
    for (var i = 0; i < run.feats.length; i++) {
      var f = run.feats[i];
      if (f.id === id && (rail ? (f.k === "rail" || f.k === "box") : f.k === "kicker")) return f;
    }
    return null;
  }

  // 起跳點附近的跳台（上桿台不算）：唇口前後 featReach 公尺、跳台寬度內
  function kickerAt(run, x, z) {
    for (var i = 0; i < run.feats.length; i++) {
      var f = run.feats[i];
      if (f.k !== "kicker" || f.ramp) continue;
      var l = T.featLocal(f, x, z);
      if (l.u >= -f.L - 1 && l.u <= SL.featReach && Math.abs(l.w) <= f.W / 2 + 1.5) return f;
    }
    return null;
  }

  function railTop(f, u) { return f.y0 + (f.y1 - f.y0) * u / f.len; }

  // 上桿判定（設計 §17.2）：位置在滑桿寬度 ±0.4 m 內、高度在滑桿頂附近
  function railCatch(run, st) {
    for (var i = 0; i < run.feats.length; i++) {
      var f = run.feats[i];
      if ((f.k !== "rail" && f.k !== "box") || run.tried[f.id]) continue;
      var l = T.featLocal(f, st.p[0], st.p[2]);
      if (l.u < 0 || l.u > f.len - 0.3 || Math.abs(l.w) > f.w / 2 + SL.catchW) continue;
      var top = railTop(f, l.u);
      if (st.p[1] < top - SL.catchBelow || st.p[1] > top + SL.catchAbove) continue;
      if (st.v[0] * f.tx + st.v[2] * f.tz < 1) continue;
      return { f: f, u: l.u, top: top };
    }
    return null;
  }

  function railDir(f) {
    var dy = (f.y1 - f.y0) / f.len;
    var l = Math.sqrt(1 + dy * dy);
    return [f.tx / l, dy / l, f.tz / l];
  }

  function enterGrind(run, c, ev) {
    var st = run.st, f = c.f;
    run.tried[f.id] = 1;
    var ch = Math.abs(st.h[0] * f.tx + st.h[1] * f.tz);
    var spinOn = st.air && Math.abs(st.yawAir) >= SPIN_ON;
    run.air = null;
    if (ch < 0.866 && ch > 0.5) {
      // 不穩：掉下滑桿
      st.v[0] *= SL.unstableKeep; st.v[1] *= SL.unstableKeep; st.v[2] *= SL.unstableKeep;
      ev.push("railFail");
      return;
    }
    var d = railDir(f);
    var sp = st.v[0] * d[0] + st.v[1] * d[1] + st.v[2] * d[2];
    if (sp < 1) sp = 1;
    run.grind = { f: f, u: c.u, u0: c.u, trick: ch >= 0.866 ? "fifty" : "slide", spinOn: spinOn, sp: sp };
    st.air = false; st.fall = 0;
    st.p[0] = f.x + f.tx * c.u; st.p[2] = f.z + f.tz * c.u; st.p[1] = c.top;
    st.v[0] = d[0] * sp; st.v[1] = d[1] * sp; st.v[2] = d[2] * sp;
    ev.push("grind");
  }

  // 滑桿上：沿滑桿方向，重力切向分量、μ＝0.02、空氣阻力；轉向輸入改成維持平衡（不轉）
  function grindStep(run, inp, ev) {
    var st = run.st, g = run.grind, f = g.f, d = railDir(f);
    st.t += 1;
    var hz = Math.sqrt(d[0] * d[0] + d[2] * d[2]);
    g.sp += (-P.g * d[1] - SL.grindMu * P.g * hz) * DT;
    g.sp *= 1 - P.kAir * st.mods.drag * g.sp * DT;
    var off = false, ollie = false;
    if (inp.j) { off = true; ollie = true; }
    if (g.sp <= 0.3) { g.sp = 0.3; off = true; }
    g.u += g.sp * hz * DT;
    if (g.u >= f.len) { g.u = f.len; off = true; }
    st.p[0] = f.x + f.tx * g.u; st.p[2] = f.z + f.tz * g.u; st.p[1] = railTop(f, g.u);
    st.v[0] = d[0] * g.sp; st.v[1] = d[1] * g.sp; st.v[2] = d[2] * g.sp;
    var steer = (inp.s || 0) / 8;
    st.edge += (steer * 0.4 - st.edge) * 0.15;
    if (off) {
      if (ollie) st.v[1] += P.vOllie * st.mods.ollie;
      st.p[1] += 0.02;
      st.air = true; st.yawAir = 0; st.airSteps = 0;
      run.railOff = { feat: f.id, rail: true, trick: g.trick, spinOn: g.spinOn, cover: (g.u - g.u0) / f.len > 1 ? 1 : (g.u - g.u0) / f.len };
      run.grind = null;
      ev.push("railOff");
    }
  }

  // ---------------- 計分（設計 §17.2） ----------------
  function r1(v) { return Math.floor(v * 10 + 0.5) / 10; }
  function trickPoints(t) {
    var base;
    if (t.rail) {
      var dd = (t.trick === "fifty" ? SL.railD.fifty : SL.railD.slide) + (t.spinOn ? SL.railD.spin : 0) + (t.spinOff ? SL.railD.spin : 0);
      base = dd * (0.4 + 0.6 * t.cover);
    } else {
      var sp = t.spin > 1440 ? 1440 : t.spin;
      var dA = SL.spinD[sp] || 0;
      var gp = t.grab === 5 ? SL.bite : t.grab > 0 ? SL.grab : 0;
      var aa = t.height * SL.heightK;
      if (aa > SL.heightMax) aa = SL.heightMax;
      if (aa < 0) aa = 0;
      base = dA + gp + aa;
    }
    if (t.bark) base += SL.bark;
    if (t.shake) base += SL.shake;
    return r1(base * t.E * (t.rep ? SL.repeat : 1));
  }
  function trickKey(t) { return t.rail ? "r" + t.trick + (t.spinOn ? 1 : 0) + (t.spinOff ? 1 : 0) : "a" + t.spin + "|" + t.grab; }

  function finalize(run, t) {
    var key = trickKey(t);
    t.rep = !!run.seen[key];
    if (t.E > 0) run.seen[key] = 1;
    t.pts = trickPoints(t);
    run.tricks.push(t);
    if (t.pts > run.featScore[t.feat]) run.featScore[t.feat] = t.pts;
    run.lastTrick = t;
    run.events.push({ k: run.steps, e: "trick", n: run.tricks.length - 1 });
  }
  function refresh(run, t) {
    t.pts = trickPoints(t);
    var best = 0;
    for (var i = 0; i < run.tricks.length; i++) if (run.tricks[i].feat === t.feat && run.tricks[i].pts > best) best = run.tricks[i].pts;
    run.featScore[t.feat] = best;
  }

  function runScore(run) {
    var sum = 0;
    for (var i = 0; i < run.featScore.length; i++) sum += run.featScore[i];
    var sc = sum / run.featScore.length * SL.runK;
    return r1(sc > 100 ? 100 : sc);
  }
  // 3 位評審：一趟分數＋各自偏差（−3.0～+3.0），平均到小數點一位
  function judge(run) {
    var rng = Core.makeRng((run.opts.seed ^ Core.hash("judge" + (run.opts.runNo || 0))) >>> 0);
    var js = [], sum = 0;
    for (var i = 0; i < SL.judges; i++) {
      var off = (rng() * 2 - 1) * SL.judgeVar;
      var v = run.status === "dsq" ? 0 : r1(run.score + off);
      if (v < 0) v = 0; else if (v > 100) v = 100;
      js.push(v); sum += v;
    }
    run.judges = js;
    run.final = r1(sum / SL.judges);
  }

  function endRun(run, status, reason) {
    run.status = status; run.reason = reason;
    run.score = status === "dsq" ? 0 : runScore(run);
    judge(run);
  }

  // ---------------- 一步 ----------------
  function stepSlope(run, input) {
    if (run.status !== "run") return run.status;
    var inp = Core.normInput(input);
    run.inputs.push(inp);
    Core.applyDash(run);
    var st = run.st;
    var ax = st.p[0], az = st.p[2];
    var ev = [];
    if (run.grind) {
      grindStep(run, inp, ev);
    } else {
      var wasAir = st.air;
      ev = Phys.step(st, inp, Core.mergeEnv({ terrain: run.terrain, snow: run.opts.snow, spinMul: SL.spinMul }, run.E, run.steps));
      var c = railCatch(run, st);
      if (c) enterGrind(run, c, ev);
      else if (!wasAir && st.air && !run.railOff) {
        var kf = kickerAt(run, ax, az);
        run.air = { feat: kf ? kf.id : -1, y0: st.p[1], maxY: st.p[1], gCur: 0, gRun: 0, gBest: 0, gBestN: 0, bark: false };
      }
    }
    run.steps += 1;
    Core.zoomTick(st, ev);
    for (var e = 0; e < ev.length; e++) run.events.push({ k: run.steps, e: ev[e] });

    // 空中：高度、抓板（同一個鍵持續 ≥ 18 步）、吠叫
    var tr = run.air || run.railOff;
    if (st.air && tr) {
      if (st.p[1] > (tr.maxY || 0)) tr.maxY = st.p[1];
      var g = inp.g;
      if (g >= 1 && g <= 5) {
        if (g === tr.gCur) tr.gRun += 1; else { tr.gCur = g; tr.gRun = 1; }
        if (tr.gRun > (tr.gBestN || 0)) { tr.gBest = g; tr.gBestN = tr.gRun; }
      } else { tr.gCur = 0; tr.gRun = 0; }
      if (g === 6) tr.bark = true;
    }
    // 落地：結算這一跳
    var landE = -1;
    for (var k = 0; k < ev.length; k++) {
      if (ev[k] === "land") landE = 1;
      else if (ev[k] === "sketchy") landE = SL.sketchy;
      else if (ev[k] === "fall") landE = 0;
    }
    if (landE >= 0) {
      var t = null;
      if (run.railOff) {
        var ro = run.railOff;
        t = { feat: ro.feat, rail: true, trick: ro.trick, spinOn: ro.spinOn, spinOff: Math.abs(st.yawAir) >= SPIN_ON, cover: ro.cover, bark: !!ro.bark, E: landE, height: 0 };
        run.railOff = null;
      } else if (run.air && run.air.feat >= 0 && st.airSteps >= 6) {
        var a2 = run.air, spin = Core.spinDeg(st.yawAir);
        var grab = (a2.gBestN || 0) >= SL.grabSteps ? a2.gBest : 0;
        if (grab === 5 && spin < 360) grab = 0;           // 咬尾抓板只有轉體 ≥ 360° 才成立
        t = { feat: a2.feat, rail: false, spin: spin, grab: grab, height: a2.maxY - a2.y0, bark: a2.bark, E: landE };
      }
      run.air = null;
      if (t) finalize(run, t);
      run.shakeWin = landE === 1 && t ? SL.shakeSteps : 0;
    } else if (run.shakeWin > 0) {
      // 落地甩雪：乾淨落地後 18 步內按下任一抓板鍵
      run.shakeWin -= 1;
      if (inp.g >= 1 && inp.g <= 4 && run.prevG === 0 && run.lastTrick && !run.lastTrick.shake) {
        run.lastTrick.shake = true;
        refresh(run, run.lastTrick);
        run.shakeWin = 0;
        run.events.push({ k: run.steps, e: "shake" });
      }
    }
    run.prevG = inp.g;

    // 進度、終點、失格
    var bx = st.p[0], bz = st.p[2];
    run.near = T.nearest(run.piste, bx, bz, run.near ? run.near.i : null);
    var nx = 0;
    for (var q = 0; q < run.feats.length; q++) if (run.feats[q].k === "kicker" && run.feats[q].s < run.near.s) nx += 1;
    run.next = nx;
    var f = run.finish;
    var fa = (ax - f.x) * f.tx + (az - f.z) * f.tz, fb = (bx - f.x) * f.tx + (bz - f.z) * f.tz;
    if (fa < 0 && fb >= 0 && run.near.s > f.s - 30) {
      run.time = (run.steps - 1 + (-fa) / (fb - fa)) / P.hz;
      endRun(run, "finish", null);
      return run.status;
    }
    if (Math.abs(run.near.d) > run.piste.width / 2 + G.offCourse) { endRun(run, "dsq", "off"); return run.status; }
    if (Phys.speed(st) < G.stopSpeed && !run.grind) run.still += 1; else run.still = 0;
    if (run.still > G.stopSec * P.hz) { endRun(run, "finish", "stop"); return run.status; }
    if (run.steps > SL.maxSec * P.hz) { endRun(run, "finish", "time"); return run.status; }
    return run.status;
  }

  // ---------------- CPU（設計 §17.2） ----------------
  // 路線＝地形中心點的連線；kicker 前蹲低；空中轉到目標 −20° 就停止；抓板依風格固定；滑桿直直上（50-50）
  function cpuController(cpu, seed) {
    var rng = Core.makeRng(seed >>> 0);
    var plan = {};
    var lvSpin = AI.slopeSpin[(cpu.lv || 3) - 1] || 540;
    if (cpu.spinCap && lvSpin > cpu.spinCap) lvSpin = cpu.spinCap;      // 教練模式的目標難度上限
    var cmds = cpu.cmds || null, CO = D.COACH;
    var grabKey = AI.styleGrab[cpu.style] || 2;
    var landedAt = -1, barkDone = {};
    return function (run) {
      var st = run.st, pi = run.piste, near = run.near || T.nearest(pi, st.p[0], st.p[2]);
      var out = { s: 0, c: 0, j: 0, g: 0 };
      var calm = false;
      if (cmds) for (var ci = 0; ci < cmds.length; ci++) {
        var cm = cmds[ci];
        if (cm.a === "calm" && run.steps >= cm.k && run.steps < cm.k + CO.calmSteps) calm = true;
      }
      if (run.grind) return out;
      var sp = Phys.speed(st);
      if (st.air) {
        var tr = run.air;
        if (tr && tr.feat >= 0) {
          var pl = plan[tr.feat];
          if (!pl) {
            var r = rng();
            pl = plan[tr.feat] = { target: lvSpin + (r < 0.33 ? -180 : r > 0.67 ? 180 : 0), dir: rng() < 0.5 ? 1 : -1,
              // 等級低的偶爾轉不足（落地不穩或摔倒）；等級 3 以上換抓板避免重複扣分
              short: rng() < 0.06 * (6 - (cpu.lv || 3)) ? 35 + rng() * 30 : 0,
              grab: (cpu.lv || 3) >= 3 && grabKey !== 5 ? 1 + (grabKey - 1 + tr.feat) % 4 : grabKey };
            if (pl.target < 180) pl.target = 180;
          }
          var a = Math.abs(st.yawAir) * 180 / PI;
          var hAbove = st.p[1] - T.height(run.terrain, st.p[0], st.p[2]);
          if (hAbove < 0) hAbove = 0;
          var vy = st.v[1], disc = vy * vy + 2 * P.g * hAbove;
          var tRem = (vy + Math.sqrt(disc > 0 ? disc : 0)) / P.g;
          var w = P.spinRate * st.mods.spin * SL.spinMul * 180 / PI;
          var reach = a + w * tRem * 0.9;
          var aim = Math.floor(reach / 180) * 180;
          if (aim > pl.target - (calm ? 180 : 0)) aim = pl.target - (calm ? 180 : 0);
          var minAim = Math.floor((a + 25) / 180) * 180;
          if (aim < minAim) aim = minAim;
          if (a < aim - 20 - pl.short) out.s = 8 * pl.dir;
          if (st.airSteps >= 4) out.g = pl.grab === 5 && aim < 360 ? 1 : pl.grab;
          if (cpu.style === "trick" && !barkDone[tr.feat] && st.airSteps >= 30 && a >= aim - 20) { out.g = 6; barkDone[tr.feat] = 1; }
        }
        landedAt = -1;
        return out;
      }
      if (landedAt < 0 && run.lastTrick && run.events.length && run.events[run.events.length - 1].e === "trick") landedAt = run.steps;
      if (cpu.style === "trick" && landedAt >= 0 && run.steps === landedAt + 3) out.g = 1;
      // 下一個地形（唇口還沒過的）
      var nf = null;
      for (var i = 0; i < run.feats.length; i++) {
        var f = run.feats[i];
        if (f.k !== "kicker") continue;
        if (f.s > near.s - 1 && (!nf || f.s < nf.s)) nf = f;
      }
      var look = 5 + sp * 0.35;
      var tgtS = near.s + look, lat = 0;
      if (nf && nf.s - near.s < 45) lat = nf.lat;
      if (nf && nf.ramp && nf.s - near.s < 25) {
        // 對準滑桿方向：瞄準上桿台唇口之後的滑桿線上
        var ax = nf.x + nf.tx * (2 + (near.s > nf.s - 2 ? 4 : 0)), az = nf.z + nf.tz * (2 + (near.s > nf.s - 2 ? 4 : 0));
        out.s = steerTo(st, ax, az, sp);
      } else {
        var at = T.at(pi, tgtS);
        out.s = steerTo(st, at.x + (-at.tz) * lat, at.z + at.tx * lat, sp);
      }
      var toLip = nf ? nf.s - near.s : 999;
      if (sp < 13 || (nf && !nf.ramp && toLip > 0 && toLip < sp * 0.5 + 2)) out.c = 1;
      if (nf && nf.ramp && toLip < 6) out.c = 0;
      if (st.zoom >= D.ZOOM.max && st.zoomT === 0 && toLip > D.ZOOM.straight && cpu.zoom !== "last200") out.z = 1;
      if (st.zoom >= D.ZOOM.max && st.zoomT === 0 && cpu.zoom === "last200" && run.finish.s - near.s < 200) out.z = 1;
      return out;
    };
  }
  function steerTo(st, tx, tz, sp) {
    var vx = st.v[0], vz = st.v[2], vh = Math.sqrt(vx * vx + vz * vz);
    var hx = vh > 1 ? vx / vh : st.h[0], hz = vh > 1 ? vz / vh : st.h[1];
    var ex = tx - st.p[0], ez = tz - st.p[2], el = Math.sqrt(ex * ex + ez * ez) || 1;
    var cross = (ex * (-hz) + ez * hx) / el, dot = (ex * hx + ez * hz) / el;
    var kappa = 2 * cross / el;
    var s2 = sp > 2 ? sp : 2;
    var wMax = P.turnBase * st.mods.turn / (1 + s2 / P.turnSpeedRef);
    var s = 8 * s2 * kappa / wMax * 1.4;
    if (dot < 0) s = cross >= 0 ? 8 : -8;
    s = Math.floor(s + 0.5);
    if (s > 8) s = 8; else if (s < -8) s = -8;
    return s;
  }

  // CPU 跑完一趟
  function simCpu(terrain, base, cpu, seed, idx) {
    var o = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) o[k] = base[k];
    o.dog = Core.breed(cpu.breed);
    var run = newSlope(terrain, o);
    var ctl = cpuController(cpu, (seed ^ Core.hash("slopecpu" + idx)) >>> 0);
    var frames = [Core.frameOf(run.st)];
    while (run.status === "run") { stepSlope(run, ctl(run)); frames.push(Core.frameOf(run.st)); }
    return { cpu: cpu, status: run.status, reason: run.reason, score: run.final, judges: run.judges, tricks: run.tricks, featScore: run.featScore, frames: frames, rec: Core.encode(run.inputs), time: run.time };
  }

  function replay(terrain, opts, rec, every) {
    var inputs = typeof rec === "string" ? Core.decode(rec) : rec;
    var run = newSlope(terrain, opts);
    every = every || 1;
    var frames = [Core.frameOf(run.st)];
    for (var i = 0; i < inputs.length && run.status === "run"; i++) {
      stepSlope(run, inputs[i]);
      if (run.steps % every === 0) frames.push(Core.frameOf(run.st));
    }
    return { status: run.status, score: run.final, frames: frames, every: every, run: run };
  }

  var Slope = {
    makePark: makePark, newSlope: newSlope, stepSlope: stepSlope, trickPoints: trickPoints, runScore: runScore,
    cpuController: cpuController, simCpu: simCpu, replay: replay, railTop: railTop, steerTo: steerTo,
  };
  root.PriTestInusnowSlope = Slope;
  if (typeof module !== "undefined" && module.exports) module.exports = Slope;
})(typeof window !== "undefined" ? window : globalThis);
