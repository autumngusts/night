/* イヌスノー（狗雪）規則核心（docs/inusnow_design.md §3.4、§4.1、§13）：旗門、比賽流程、輸入紀錄、重播、存檔格式。
   不碰 DOM、不讀寫 localStorage；只用 + − × ÷、Math.sqrt、Math.floor、Math.abs、Math.imul（設計 §11）。 */
(function (root) {
  "use strict";

  var D = root.PriTestInusnowData || (typeof require === "function" ? require("./inusnow_data.js") : null);
  var T = root.PriTestInusnowTerrain || (typeof require === "function" ? require("./inusnow_terrain.js") : null);
  var Phys = root.PriTestInusnowPhys || (typeof require === "function" ? require("./inusnow_phys.js") : null);
  var G = D.GATES;
  var Z = D.ZOOM, AI = D.CPU_AI;
  var PI = 3.141592653589793;

  // P3：雪況與天氣（inusnow_env.js；循環依賴，所以用到時才取）
  function Env() { return root.PriTestInusnowEnv || (typeof require === "function" ? require("./inusnow_env.js") : null); }
  function mergeEnv(env, E, step) {
    if (!E) return env;
    var o = E.env(step);
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) env[k] = o[k];
    return env;
  }

  // ---------------- 亂數 ----------------
  function hash(str) {
    var h = 2166136261 >>> 0;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  // mulberry32（整數運算）
  function makeRng(seed) {
    var a = (typeof seed === "number" ? seed : hash(seed)) >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------- 旗門 ----------------
  // 每座旗門：轉彎旗竿 I（離雪道中心 side×off）與外側旗竿 O（再往外 G.width）。
  // side：+1＝旗門在中心線右側；color 交替（0 紅、1 藍）。
  // P4：平行大曲道的賽道寬（設計 §19.2）與第 k 條賽道中心線的偏移
  function laneW(pi) { var w = pi.width / 4; return w > D.ROOM.laneMax ? D.ROOM.laneMax : w; }
  function laneOff(lane, lw) { return (lane - 1.5) * lw; }
  // o（可省略）：{lane, laneW（平行大曲道）, from, to（接力的雪道區間）}；省略時與第 1 階段完全相同
  function makeGates(terrain, pisteId, seed, o) {
    o = o || {};
    var pi = T.piste(terrain, pisteId);
    var rng = makeRng(seed);
    var gates = [];
    var s = o.from !== undefined ? o.from + G.first - G.startS : G.first;
    var side = rng() < 0.5 ? -1 : 1;
    var finishS = o.to !== undefined ? o.to : pi.len - G.finishMargin;
    var lane = o.lane !== undefined && o.lane !== null, lw = o.laneW || 0;
    while (s < finishS - G.endMargin) {
      var a = T.at(pi, s);
      var off = pi.width * (G.offsetMin + (G.offsetMax - G.offsetMin) * rng());
      if (off > pi.width * G.maxOffset) off = pi.width * G.maxOffset;
      var rx = -a.tz, rz = a.tx;              // 行進方向的右側
      var gw = G.width, c = 0;
      if (lane) { off = off * lw / pi.width; gw = lw * D.ROOM.gateW; c = laneOff(o.lane, lw); }
      var ix = a.x + rx * (c + side * off), iz = a.z + rz * (c + side * off);
      var g = {
        n: gates.length, s: s, side: side, color: gates.length % 2,
        ix: ix, iz: iz, ox: ix + rx * side * gw, oz: iz + rz * side * gw,
        tx: a.tx, tz: a.tz,
      };
      if (lane) g.w = gw;
      gates.push(g);
      side = -side;
      s += G.spacingMin + (G.spacingMax - G.spacingMin) * rng();
    }
    return gates;
  }

  // 這一步的移動（a→b）有沒有越過旗門所在的橫線；越過時看交點在兩根旗竿之間（通過）或外面（漏門）。
  // 回傳 null（還沒到）或 {r: "pass"|"miss", dist: 和轉彎旗竿的距離}
  function gateCheck(ax, az, bx, bz, gate) {
    var ua = (ax - gate.ix) * gate.tx + (az - gate.iz) * gate.tz;
    var ub = (bx - gate.ix) * gate.tx + (bz - gate.iz) * gate.tz;
    if (!(ua < 0 && ub >= 0)) return null;
    var gw = gate.w || G.width;
    var ox = (gate.ox - gate.ix) / gw, oz = (gate.oz - gate.iz) / gw;   // I→O 的單位向量
    var la = (ax - gate.ix) * ox + (az - gate.iz) * oz;
    var lb = (bx - gate.ix) * ox + (bz - gate.iz) * oz;
    var lat = la + (lb - la) * (-ua) / (ub - ua);
    if (lat >= 0 && lat <= gw) return { r: "pass", dist: lat };
    return { r: "miss", dist: lat };
  }

  // ---------------- 比賽 ----------------
  // opts：{piste, seed, dog, snow, runNo}
  function newRun(terrain, opts) {
    var pi = T.piste(terrain, opts.piste);
    var a = T.at(pi, opts.from !== undefined ? opts.from : G.startS);
    var gates = makeGates(terrain, opts.piste, (opts.seed >>> 0) + (opts.runNo || 0), opts);
    var fs = opts.to !== undefined ? opts.to : pi.len - G.finishMargin;
    var fin = T.at(pi, fs);
    if (opts.lane !== undefined && opts.lane !== null) {
      var lc = laneOff(opts.lane, opts.laneW || laneW(pi));
      a = { x: a.x + (-a.tz) * lc, z: a.z + a.tx * lc, tx: a.tx, tz: a.tz };
    }
    return {
      terrain: terrain, opts: opts, piste: pi, gates: gates,
      finish: { x: fin.x, z: fin.z, tx: fin.tx, tz: fin.tz, s: fs },
      st: Phys.create(terrain, a, opts.dog),
      next: 0, perfect: 0, chain: 0, still: 0, near: null,
      status: "run", reason: null, missGate: -1, steps: 0, inputs: [], events: [], gateT: [],
      kind: "gs", rut: opts.rut || null,
      E: opts.cond ? Env().make(opts.cond, { piste: pi, seed: opts.seed, dog: opts.dog }) : null,
      cmds: opts.cmds || null,
    };
  }

  // 轉體角度（rad）→ 四捨五入到 180 的倍數（度）
  function spinDeg(yaw) {
    var deg = (yaw < 0 ? -yaw : yaw) * 180 / PI;
    return Math.floor(deg / 180 + 0.5) * 180;
  }

  // S2 興奮度量表的累積（設計 §17.5）：只依物理事件與時間，重播一致。發動中不累積
  function zoomGain(st, n) {
    if (st.zoomT > 0) return;
    st.zoom += n;
    if (st.zoom > Z.max) st.zoom = Z.max;
    if (st.zoom < 0) st.zoom = 0;
  }
  function zoomTick(st, ev) {
    var g = 0;
    for (var i = 0; i < ev.length; i++) {
      if (ev[i] === "land" && st.airSteps >= Z.landMinAir) g += spinDeg(st.yawAir) >= 360 ? Z.trick : Z.land;
      else if (ev[i] === "fall") g += Z.fall;
    }
    if (Phys.speed(st) > Z.fastMs) g += Z.fastPerSec / D.PHYS.hz;
    if (g !== 0) zoomGain(st, g);
  }
  function normInput(input) {
    var inp = { s: input.s | 0, c: input.c ? 1 : 0, j: input.j ? 1 : 0, g: input.g | 0 };
    if (input.z) inp.z = 1;
    if (inp.s > 8) inp.s = 8; else if (inp.s < -8) inp.s = -8;
    if (inp.g < 0 || inp.g > 6) inp.g = 0;
    return inp;
  }

  function boostMult(chain) {
    var pf = G.perfect;
    var m = pf.mult + pf.chainStep * (chain - 1);
    return m > pf.chainMax ? pf.chainMax : m;
  }

  function stepRun(run, input) {
    if (run.status !== "run") return run.status;
    var inp = normInput(input);
    run.inputs.push(inp);
    applyDash(run);
    var st = run.st;
    var ax = st.p[0], az = st.p[2];
    var ev = Phys.step(st, inp, mergeEnv({ terrain: run.terrain, snow: run.opts.snow, rut: run.rut }, run.E, run.steps));
    run.steps += 1;
    zoomTick(st, ev);
    var bx = st.p[0], bz = st.p[2];
    for (var e = 0; e < ev.length; e++) run.events.push({ k: run.steps, e: ev[e] });

    // 旗門
    if (run.next < run.gates.length) {
      var gate = run.gates[run.next];
      var r = gateCheck(ax, az, bx, bz, gate);
      if (r) {
        if (r.r === "miss") {
          run.status = "dsq"; run.reason = "miss"; run.missGate = run.next + 1;
          return run.status;
        }
        if (r.dist < G.perfect.dist) {
          run.chain += 1; run.perfect += 1;
          var mul = boostMult(run.chain);
          st.v[0] *= mul; st.v[1] *= mul; st.v[2] *= mul;
          run.events.push({ k: run.steps, e: "perfect", n: run.chain });
          zoomGain(st, Z.perfect);
        } else {
          run.chain = 0;
          run.events.push({ k: run.steps, e: "gate" });
        }
        run.gateT.push(run.steps);
        run.next += 1;
      }
    }
    // 終點
    var f = run.finish;
    var fa = (ax - f.x) * f.tx + (az - f.z) * f.tz, fb = (bx - f.x) * f.tx + (bz - f.z) * f.tz;
    if (fa < 0 && fb >= 0 && run.next >= run.gates.length) {
      // 用越線的比例補到步內的時間
      run.time = (run.steps - 1 + (-fa) / (fb - fa)) / D.PHYS.hz;
      run.status = "finish";
      return run.status;
    }
    // 離開雪道、停住、超時
    run.near = T.nearest(run.piste, bx, bz, run.near ? run.near.i : null);
    if (Math.abs(run.near.d) > run.piste.width / 2 + G.offCourse) { run.status = "dsq"; run.reason = "off"; return run.status; }
    if (Phys.speed(st) < G.stopSpeed) run.still += 1; else run.still = 0;
    if (run.still > G.stopSec * D.PHYS.hz) { run.status = "dsq"; run.reason = "stop"; return run.status; }
    if (run.steps > G.maxSec * D.PHYS.hz) { run.status = "dsq"; run.reason = "time"; return run.status; }
    return run.status;
  }

  // ---------------- 自動駕駛（測試、開發面板；第 2 階段的 CPU 也用它） ----------------
  // 路線＝出發點 → 每座旗門的通過點（轉彎旗竿往外 want 公尺）→ 終點後方。用 pure pursuit 沿路線往前看 L 公尺，
  // 把需要的曲率換算成轉向輸入。aggr：0～1，越大越貼旗竿（want 越小）。
  function racingLine(run, aggr) {
    var key = "a" + aggr;
    if (run._line && run._line.key === key) return run._line;
    var want = 1.2 + (1 - aggr) * 2.4;
    var st = run.st, pts = [[st.p[0], st.p[2]]];
    for (var i = 0; i < run.gates.length; i++) {
      var g = run.gates[i], gwi = g.w || G.width, ox = (g.ox - g.ix) / gwi, oz = (g.oz - g.iz) / gwi;
      pts.push([g.ix + ox * want, g.iz + oz * want]);
    }
    var f = run.finish;
    pts.push([f.x, f.z]);
    pts.push([f.x + f.tx * 40, f.z + f.tz * 40]);
    run._line = { key: key, pts: pts, seg: 0 };
    return run._line;
  }

  function autopilot(run, aggr) {
    if (aggr === undefined) aggr = 0.6;
    var line = racingLine(run, aggr), pts = line.pts;
    var st = run.st, p = st.p, v = st.v;
    var vh = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
    // 目前所在的線段：投影超過線段終點就往下一段（不回頭）
    while (line.seg < pts.length - 2) {
      var a = pts[line.seg], b = pts[line.seg + 1];
      var dx = b[0] - a[0], dz = b[1] - a[1];
      var u = ((p[0] - a[0]) * dx + (p[2] - a[1]) * dz) / (dx * dx + dz * dz);
      if (u < 1) break;
      line.seg += 1;
    }
    // 旗門已經通過時，路線至少要從那座旗門之後開始
    if (line.seg < run.next) line.seg = run.next;
    // 往前看 L 公尺
    var L = 4 + vh * 0.32;
    var k = line.seg, a0 = pts[k], b0 = pts[k + 1];
    var sdx = b0[0] - a0[0], sdz = b0[1] - a0[1], sl = Math.sqrt(sdx * sdx + sdz * sdz) || 1;
    var u0 = ((p[0] - a0[0]) * sdx + (p[2] - a0[1]) * sdz) / sl;
    if (u0 < 0) u0 = 0;
    var remain = L, tx = 0, tz = 0, pos = u0;
    while (true) {
      a0 = pts[k]; b0 = pts[k + 1];
      sdx = b0[0] - a0[0]; sdz = b0[1] - a0[1]; sl = Math.sqrt(sdx * sdx + sdz * sdz) || 1;
      if (pos + remain <= sl || k >= pts.length - 2) {
        var uu = (pos + remain) / sl;
        tx = a0[0] + sdx * uu; tz = a0[1] + sdz * uu;
        break;
      }
      remain -= sl - pos; pos = 0; k += 1;
    }
    var ex = tx - p[0], ez = tz - p[2], el = Math.sqrt(ex * ex + ez * ez) || 1;
    var hx = vh > 1 ? v[0] / vh : st.h[0], hz = vh > 1 ? v[2] / vh : st.h[1];
    var cross = (ex * (-hz) + ez * hx) / el;         // 目標在右側為正（右＝(−hz, hx)）
    var dot = (ex * hx + ez * hz) / el;
    var kappa = 2 * cross / el;                       // pure pursuit 的曲率
    var sp = vh > 2 ? vh : 2;
    var wMax = D.PHYS.turnBase * st.mods.turn / (1 + sp / D.PHYS.turnSpeedRef);
    var s = 8 * sp * kappa / wMax * 1.4;
    if (dot < 0) s = cross >= 0 ? 8 : -8;
    s = Math.floor(s + 0.5);
    if (s > 8) s = 8; else if (s < -8) s = -8;
    var c = (dot > 0.985 && Math.abs(s) <= 1) ? 1 : 0;
    return { s: s, c: c, j: 0, g: 0 };
  }

  // ---------------- 輸入紀錄（設計 §3.4） ----------------
  // z（興奮度發動）時再 +476，舊紀錄不受影響（設計 §3.6）
  function codeOf(inp) { return (inp.s + 8) + 17 * ((inp.c ? 1 : 0) + 2 * ((inp.j ? 1 : 0) + 2 * (inp.g | 0))) + (inp.z ? 476 : 0); }
  function inputOf(code) {
    var z = 0;
    if (code >= 476) { z = 1; code -= 476; }
    var s = code % 17 - 8; code = (code - (code % 17)) / 17;
    var c = code % 2; code = (code - c) / 2;
    var j = code % 2; code = (code - j) / 2;
    var o = { s: s, c: c, j: j, g: code };
    if (z) o.z = 1;
    return o;
  }
  function encode(inputs) {
    var out = [], prev = -1, cnt = 0;
    for (var i = 0; i < inputs.length; i++) {
      var c = codeOf(inputs[i]);
      if (c === prev) { cnt += 1; continue; }
      if (cnt) out.push(prev.toString(36) + (cnt > 1 ? "." + cnt.toString(36) : ""));
      prev = c; cnt = 1;
    }
    if (cnt) out.push(prev.toString(36) + (cnt > 1 ? "." + cnt.toString(36) : ""));
    return out.join(",");
  }
  function decode(str) {
    var out = [];
    if (!str) return out;
    var parts = String(str).split(",");
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i].split(".");
      var code = parseInt(seg[0], 36), cnt = seg.length > 1 ? parseInt(seg[1], 36) : 1;
      if (!(code >= 0 && code < 17 * 2 * 2 * 7 * 2) || !(cnt >= 1)) throw new Error("bad record");
      var inp = inputOf(code);
      for (var k = 0; k < cnt; k++) out.push(inp);
    }
    return out;
  }

  // 重播：同一份 opts＋紀錄 → 同樣的結果。frames：每 every 步一格 [x, y, z, hx, hz, edge, crouch, air]
  function replay(terrain, opts, rec, every) {
    var inputs = typeof rec === "string" ? decode(rec) : rec;
    var run = newRun(terrain, opts);
    every = every || 2;
    var frames = [];
    for (var i = 0; i < inputs.length && run.status === "run"; i++) {
      stepRun(run, inputs[i]);
      if (run.steps % every === 0) frames.push(frameOf(run.st));
    }
    return { time: run.time || null, status: run.status, reason: run.reason, steps: run.steps, perfect: run.perfect, frames: frames, every: every, run: run };
  }
  function frameOf(st) { return [st.p[0], st.p[1], st.p[2], st.h[0], st.h[1], st.edge, st.crouch, st.air ? 1 : 0]; }

  // ---------------- CPU 選手（設計 §5.2、§17.3） ----------------
  // 比賽 seed：比賽模式每場不同（練習模式用固定的 courseSeed）
  function raceSeed(resort, when) { return hash("race|" + resort + "|" + when); }
  // 比賽模式的旗門：有些 seed 會在平緩段排出大彎而停住，所以依序試 8 個 seed，取慢速自動駕駛（aggr 0.2）能完賽的第一個（確定性）
  function pickGsSeed(terrain, piste, resort, when, dog) {
    var first = 0;
    for (var k = 0; k < 8; k++) {
      var sd = raceSeed(resort, when + "#" + k);
      if (k === 0) first = sd;
      var run = newRun(terrain, { piste: piste, seed: sd, dog: dog, snow: "groomed", runNo: 0 });
      while (run.status === "run") stepRun(run, autopilot(run, 0.2));
      if (run.status === "finish") return sd;
    }
    return first;
  }
  // 從名冊抽 n 隻（同一場比賽固定）
  function cpuField(seed, n) {
    var rng = makeRng((seed ^ hash("field")) >>> 0);
    var pool = D.CPU.slice(), out = [];
    while (out.length < n && pool.length) {
      var k = Math.floor(rng() * pool.length);
      out.push(pool[k]);
      pool.splice(k, 1);
    }
    return out;
  }
  function cpuBaseAggr(cpu) { return AI.aggrBase + AI.aggrLv * cpu.lv + (AI.styleAggr[cpu.style] || 0); }
  // 大曲道 CPU 的輸入產生器：每座旗門抽一次 aggr 的變動與失誤；輸入延遲（環形緩衝）
  // P3：cpu.aggrAdd／missMul（競猜的調子）；coach＝教練模式 {aggr, zoom: "auto"|"straight"|"last200", cmds: [{k, a: "dash"|"calm"}]}
  function cpuGsController(cpu, seed, coach) {
    var rng = makeRng(seed >>> 0);
    var CO = D.COACH;
    var base = coach ? coach.aggr : cpuBaseAggr(cpu) + (cpu.aggrAdd || 0), delay = AI.delayBase - (cpu.lv || 3);
    if (delay < 0) delay = 0;
    var buf = [], seen = -1, aggr = base;
    function cmdActive(run, a, len) {
      if (!coach || !coach.cmds) return false;
      for (var i = 0; i < coach.cmds.length; i++) { var c = coach.cmds[i]; if (c.a === a && run.steps >= c.k && run.steps < c.k + len) return true; }
      return false;
    }
    return function (run) {
      var calm = cmdActive(run, "calm", CO.calmSteps);
      if (run.next !== seen) {
        seen = run.next;
        aggr = base + (rng() * 2 - 1) * AI.vary;
        if (rng() < AI.missK * (6 - (cpu.lv || 3)) * (cpu.missMul || 1) && !calm) aggr -= AI.missDrop;
        if (calm) aggr -= CO.calmAggr;
        if (aggr < 0.05) aggr = 0.05; else if (aggr > AI.aggrMax) aggr = AI.aggrMax;
        aggr = Math.floor(aggr * 100 + 0.5) / 100;
      }
      var inp = autopilot(run, aggr);
      buf.push(inp);
      var out = buf.length > delay ? buf.shift() : { s: 0, c: 0, j: 0, g: 0 };
      if (run.st.zoom >= Z.max && run.st.zoomT === 0) {
        var g = run.gates[run.next], st = run.st;
        var far = g ? (g.ix - st.p[0]) * (g.ix - st.p[0]) + (g.iz - st.p[2]) * (g.iz - st.p[2]) > Z.straight * Z.straight : true;
        if (coach && coach.zoom === "last200") far = !!run.near && run.piste.len - run.near.s < 200;
        if (far) out = { s: out.s, c: out.c, j: out.j, g: out.g, z: 1 };
      }
      return out;
    };
  }
  // 教練的「衝！」（設計 §18.2）：在比賽物件裡依 opts.cmds 的步數套用，重播會一樣
  // 量表 ≥ 50 時發動半強度興奮度 2 秒（生效步數＝送出＋90 步）
  function applyDash(run) {
    var cmds = run.opts.cmds;
    if (!cmds) return;
    var CO = D.COACH, s0 = run.st;
    for (var ci = 0; ci < cmds.length; ci++) {
      var cm = cmds[ci];
      if (cm.a === "dash" && run.steps === cm.k && s0.zoom >= CO.dashMin && s0.zoomT === 0) { s0.zoomT = CO.dashSteps; s0.zoomHalf = true; s0.zoom = 0; run.events.push({ k: run.steps, e: "zoom" }); }
    }
  }
  // 一隻 CPU 跑完一趟（frames 每步一格，給幽靈與溝痕用）
  function simCpuGs(terrain, base, cpu, seed, idx, rut, coach) {
    var o = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) o[k] = base[k];
    o.dog = breed(cpu.breed); o.rut = rut || null;
    if (coach && coach.cmds) o.cmds = coach.cmds;
    var run = newRun(terrain, o);
    var ctl = cpuGsController(cpu, (seed + idx + 1) >>> 0, coach);
    var frames = [frameOf(run.st)];
    while (run.status === "run") {
      stepRun(run, ctl(run));
      frames.push(frameOf(run.st));
    }
    return { cpu: cpu, status: run.status, reason: run.reason, time: run.status === "finish" ? run.time : null, perfect: run.perfect,
      gateT: run.gateT, frames: frames, rec: encode(run.inputs) };
  }
  // 大曲道比賽：CPU 依出發順序跑，後出發的走在前面選手的溝痕上（G1）。回傳 {cpus, rut（給玩家用）}
  function simGsField(terrain, base, field, seed) {
    var rut = newRut(), out = [];
    for (var i = 0; i < field.length; i++) {
      var r = simCpuGs(terrain, base, field[i], seed, i, rut.count ? rut : null);
      out.push(r);
      rutAdd(rut, r.frames);
    }
    return { cpus: out, rut: rut };
  }

  // ---------------- G1 溝痕（設計 §17.6） ----------------
  // 稀疏 1 m 格網：先出發者的軌跡經過一格就 +18（同一次經過只算一次），並累積方向
  function newRut() { return { cells: {}, count: 0 }; }
  function rutAdd(rut, frames) {
    var R = D.RUT, prev = null, px = 0, pz = 0;
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      if (f[7]) { prev = null; continue; }
      var ci = Math.floor(f[0]), cj = Math.floor(f[2]);
      var key = (ci + 32768) * 65536 + (cj + 32768);
      if (key !== prev && prev !== null) {
        var c = rut.cells[key];
        if (!c) { c = { n: 0, dx: 0, dz: 0 }; rut.cells[key] = c; }
        c.n += R.add;
        if (c.n > R.max) c.n = R.max;
        var dx = f[0] - px, dz = f[2] - pz, dl = Math.sqrt(dx * dx + dz * dz);
        if (dl > 0) {
          // 方向不分前後：和累積方向反向時翻轉再加
          if (dx * c.dx + dz * c.dz < 0) { dx = -dx; dz = -dz; }
          c.dx += dx / dl; c.dz += dz / dl;
        }
      }
      prev = key; px = f[0]; pz = f[2];
    }
    rut.count += 1;
    return rut;
  }

  // 分享碼：resort|piste|seed|runNo|breed|record
  function shareCode(o) { return ["inu1", o.resort, o.piste, o.seed >>> 0, o.runNo | 0, o.breed, o.rec].join("|"); }
  function parseShare(str) {
    var a = String(str || "").trim().split("|");
    if (a.length === 8 && /^h:\d+-\d+$/.test(a[7])) a.pop();     // P4：精彩片段（設計 §19.4）
    if (a.length !== 7 || a[0] !== "inu1") return null;
    try { decode(a[6]); } catch (e) { return null; }
    return { resort: a[1], piste: a[2], seed: parseInt(a[3], 10) >>> 0, runNo: parseInt(a[4], 10) | 0, breed: a[5], rec: a[6] };
  }

  // ---------------- 存檔格式（設計 §13） ----------------
  function newSave() {
    // P2 追加：settings.event／mode／lift、free（自由滑行的收集）
    // P3 追加：settings.cond／condPick／coach*、coins／coinsDay／bets／daily／season（設計 §13）
    return { v: 1, dog: { breed: "shiba", name: "" }, best: {},
      settings: { control: "drag", camera: "chase", runs: 1, ghost: true, event: "gs", mode: "practice", lift: 0, cond: "std", condPick: { snow: "groomed", weather: "clear", night: false }, coachRoute: "std", coachSpin: 540, coachZoom: "auto", relayLeg: 0 },
      ghostImport: null, free: {}, coins: D.BET ? D.BET.coinsStart : 1000, coinsDay: "", bets: [], daily: null, season: null, betLog: [] };
  }
  function migrate(obj) {
    var s = newSave();
    if (!obj || typeof obj !== "object" || obj.v !== 1) return s;
    if (obj.dog && typeof obj.dog.breed === "string") s.dog = { breed: obj.dog.breed, name: String(obj.dog.name || "") };
    if (obj.best && typeof obj.best === "object") s.best = obj.best;
    if (obj.settings && typeof obj.settings === "object") {
      for (var k in s.settings) if (Object.prototype.hasOwnProperty.call(obj.settings, k)) s.settings[k] = obj.settings[k];
    }
    if (obj.ghostImport && typeof obj.ghostImport === "object") s.ghostImport = obj.ghostImport;
    if (obj.free && typeof obj.free === "object") s.free = obj.free;
    if (typeof obj.coins === "number" && obj.coins >= 0) s.coins = Math.floor(obj.coins);
    if (typeof obj.coinsDay === "string") s.coinsDay = obj.coinsDay;
    if (obj.bets && obj.bets.length !== undefined) s.bets = obj.bets;
    if (obj.betLog && obj.betLog.length !== undefined) s.betLog = obj.betLog.slice(-30);
    if (obj.daily && typeof obj.daily === "object") s.daily = obj.daily;
    if (obj.season && typeof obj.season === "object") s.season = obj.season;
    return s;
  }

  // 固定的每日 seed 以外，第 1 階段每個雪場的旗門 seed 固定（同一條雪道的紀錄才能比較）
  function courseSeed(resort, piste) { return hash("inusnow|" + resort + "|" + piste); }

  function breed(id) {
    for (var i = 0; i < D.BREEDS.length; i++) if (D.BREEDS[i].id === id) return D.BREEDS[i];
    return D.BREEDS[0];
  }

  var Core = {
    hash: hash, makeRng: makeRng, makeGates: makeGates, gateCheck: gateCheck,
    newRun: newRun, stepRun: stepRun, autopilot: autopilot, boostMult: boostMult,
    encode: encode, decode: decode, replay: replay, frameOf: frameOf,
    shareCode: shareCode, parseShare: parseShare, normInput: normInput,
    spinDeg: spinDeg, zoomTick: zoomTick, zoomGain: zoomGain,
    raceSeed: raceSeed, pickGsSeed: pickGsSeed, cpuField: cpuField, cpuBaseAggr: cpuBaseAggr, cpuGsController: cpuGsController, simCpuGs: simCpuGs, simGsField: simGsField,
    newRut: newRut, rutAdd: rutAdd, mergeEnv: mergeEnv, applyDash: applyDash, laneW: laneW,
    newSave: newSave, migrate: migrate, courseSeed: courseSeed, breed: breed,
  };
  root.PriTestInusnowCore = Core;
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
})(typeof window !== "undefined" ? window : globalThis);
