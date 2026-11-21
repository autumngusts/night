/* イヌスノー（狗雪）房間比賽的規則（docs/inusnow_design.md §19.1、§19.2、§19.3）。不碰網路（網路在 inusnow_net.js）。
   - 出賽表：賽事（pgs＝4 人平行大曲道、slope＝同時 Slopestyle、relay＝接力）、raceSeed、雪況、選手與賽道。
   - 每位選手的比賽物件由「出賽表＋自己的賽道」決定；別人的狗用分段輸入紀錄（每 30 步一段）重算，追不上時用最後的速度外插。
   - 結算：所有人的完整紀錄重算後排名；觀戰者的單勝彩池。
   不碰 DOM、不讀寫 localStorage；只用 + − × ÷、Math.sqrt、Math.floor、Math.abs、Math.imul（設計 §11）。 */
(function (root) {
  "use strict";

  var D = root.PriTestInusnowData || (typeof require === "function" ? require("./inusnow_data.js") : null);
  var T = root.PriTestInusnowTerrain || (typeof require === "function" ? require("./inusnow_terrain.js") : null);
  var Core = root.PriTestInusnowCore || (typeof require === "function" ? require("./inusnow_core.js") : null);
  var SLP = root.PriTestInusnowSlope || (typeof require === "function" ? require("./inusnow_slope.js") : null);
  var Relay = root.PriTestInusnowRelay || (typeof require === "function" ? require("./inusnow_relay.js") : null);
  var RM = D.ROOM, HZ = D.PHYS.hz;

  function maxRiders(event) { return event === "pgs" ? RM.pgsMax : event === "relay" ? 4 : RM.slopeMax; }

  // 出賽表。cfg：{resort, event, cond}；riders：[{cid, pid, name, breed}]（加入順序）；prev：第 2 趟時 {cid: 第 1 趟時間}
  function makeCard(cfg, riders, seed, runNo, prev) {
    var list = riders.slice(0, maxRiders(cfg.event)).map(function (p, i) {
      var lane = i;
      if (cfg.event === "pgs" && runNo === 1) lane = RM.pgsMax - 1 - i;    // 第 2 趟換賽道（1↔4、2↔3）
      return { cid: p.cid, pid: p.pid || "", name: String(p.name || "").slice(0, 16), breed: p.breed, lane: lane };
    });
    return { v: 1, resort: cfg.resort, event: cfg.event, seed: seed >>> 0, cond: cfg.cond || null, runNo: runNo | 0, riders: list, prev: prev || null, runs: cfg.runs || 1 };
  }

  // 選手的比賽物件。relay：rider.lane＝第幾棒
  function newRider(terrain, card, rider) {
    var dog = Core.breed(rider.breed), ev = terrain.json.events;
    if (card.event === "pgs") {
      var pid = ev.gs.piste, pi = T.piste(terrain, pid);
      return { kind: "gs", run: Core.newRun(terrain, { piste: pid, seed: card.seed, dog: dog, snow: "groomed", runNo: card.runNo, cond: card.cond, lane: rider.lane, laneW: Core.laneW(pi) }) };
    }
    if (card.event === "relay") return Relay.newLeg(terrain, rider.lane, card.seed, dog, card.cond);
    return { kind: "slope", run: SLP.newSlope(terrain, { piste: (ev.slope || ev.gs).piste, seed: card.seed, dog: dog, snow: "groomed", runNo: 0, cond: card.cond }) };
  }
  function step(r, input) {
    if (r.race || r.kind === "cross") return Relay.stepLeg(r, input);
    if (r.kind === "gs") return Core.stepRun(r.run, input);
    return SLP.stepSlope(r.run, input);
  }
  function done(r) { return Relay.legDone(r); }
  function stOf(r) { return Relay.legSt(r); }
  function steps(r) { return Relay.legSteps(r); }
  function inputsOf(r) { return r.kind === "cross" ? r.race.inputs[0] : r.run.inputs; }
  // 這位選手的成績：{ok, time, score}；排名用 val（大曲道與接力：時間越小越好；Slopestyle：分數越大越好）
  function result(card, r) {
    if (card.event === "relay") return { ok: true, time: Relay.legTime(r), info: Relay.legInfo(r) };
    if (card.event === "slope") return { ok: r.run.status !== "dsq", score: r.run.status === "dsq" ? 0 : (r.run.final || 0) };
    return { ok: r.run.status === "finish", time: r.run.status === "finish" ? r.run.time : null, reason: r.run.reason };
  }

  // ---------------- 遠端選手：分段紀錄 → 重播 → 外插 ----------------
  function newRemote(terrain, card, rider) {
    return { rider: rider, r: newRider(terrain, card, rider), segs: {}, queue: [], next: 0, last: null, lastV: null, lastAt: 0 };
  }
  // 收到第 k 段（Core.encode 的 30 步）；依序接上
  function addSeg(rm, k, str) {
    if (rm.segs[k] !== undefined) return;
    rm.segs[k] = str;
    while (rm.segs[rm.next] !== undefined) {
      var ins;
      try { ins = Core.decode(rm.segs[rm.next]); } catch (e) { ins = []; }
      for (var i = 0; i < ins.length; i++) rm.queue.push(ins[i]);
      rm.next += 1;
    }
  }
  // 重算到第 target 步（有紀錄的部分）
  function advance(rm, target) {
    var r = rm.r;
    while (!done(r) && steps(r) < target && steps(r) < rm.queue.length) step(r, rm.queue[steps(r)]);
  }
  // 畫面用的 frame：追不上時用最後的速度外插（最多 RM.extrapSec 秒）
  function frameAt(rm, target) {
    var st = stOf(rm.r), f = Core.frameOf(st), lag = target - steps(rm.r);
    if (done(rm.r) || lag <= 0) return f;
    var tt = (lag > RM.extrapSec * HZ ? RM.extrapSec * HZ : lag) / HZ;
    f[0] += st.v[0] * tt; f[2] += st.v[2] * tt;
    f[1] = T.height(rm.r.kind === "gs" ? rm.r.run.terrain : rm.r.kind === "slope" ? rm.r.run.terrain : rm.r.race.terrain, f[0], f[2]);
    return f;
  }
  // 斷線：沒完賽、而且紀錄落後 RM.staleSec 秒以上
  function stale(rm, target) { return !done(rm.r) && target - rm.queue.length > RM.staleSec * HZ; }
  // 結算用的斷線判定（2026-11-21 QA）：牆上時鐘 RM.dnfSec 秒沒有收到新的一段＝未完賽。lastAt 由畫面在收到新段時更新
  function gone(rm, now) { return !done(rm.r) && now - rm.lastAt > RM.dnfSec * 1000; }

  // ---------------- 結算 ----------------
  // 依完整紀錄重算每位選手（recs：{cid: 分段字串陣列}）
  function recompute(terrain, card, recs) {
    return card.riders.map(function (rd) {
      var rm = newRemote(terrain, card, rd), segs = recs[rd.cid] || [];
      for (var k = 0; k < segs.length; k++) if (segs[k] !== undefined && segs[k] !== null) addSeg(rm, k, segs[k]);
      advance(rm, 1e9);
      var res = result(card, rm.r);
      res.cid = rd.cid; res.done = done(rm.r); res.steps = steps(rm.r);
      if (!res.done) res.ok = false;
      return res;
    });
  }
  // 名次：大曲道 2 趟時加上 prev；接力是一隊，回傳 {team: 合計}
  function rank(card, results) {
    if (card.event === "relay") {
      var tot = 0;
      results.forEach(function (x) { tot += x.time; });
      return { team: tot, legs: results };
    }
    var rows = results.map(function (x) {
      var pv = card.prev ? card.prev[x.cid] : 0;
      var v = card.event === "slope" ? (x.ok ? x.score : null) : x.ok && pv !== null && pv !== undefined ? x.time + pv : null;
      return { cid: x.cid, val: v, res: x };
    });
    rows.sort(function (a, b) {
      if (a.val === null && b.val === null) return a.cid < b.cid ? -1 : 1;
      if (a.val === null) return 1;
      if (b.val === null) return -1;
      return card.event === "slope" ? b.val - a.val : a.val - b.val;
    });
    rows.forEach(function (r, i) { r.place = r.val === null ? 0 : i + 1; });
    return { rows: rows };
  }
  // 單勝彩池（觀戰者）：bets＝{pid: {cid: 金額}}；派彩＝總額 × 還原率 × 自己押冠軍的比例
  function poolPays(bets, winner) {
    var total = 0, win = 0, pid, out = {};
    for (pid in bets) if (Object.prototype.hasOwnProperty.call(bets, pid)) {
      var b = bets[pid] || {};
      for (var c in b) if (Object.prototype.hasOwnProperty.call(b, c)) { var v = +b[c] || 0; if (v > 0) { total += v; if (c === winner) win += v; } }
    }
    if (!win) {
      // 沒有人押中冠軍（或全員未完賽）：全額退還（設計 §0.7）
      for (pid in bets) if (Object.prototype.hasOwnProperty.call(bets, pid)) {
        var back = 0, bb = bets[pid] || {};
        for (var c2 in bb) if (Object.prototype.hasOwnProperty.call(bb, c2)) { var v2 = +bb[c2] || 0; if (v2 > 0) back += v2; }
        if (back) out[pid] = back;
      }
      return out;
    }
    for (pid in bets) if (Object.prototype.hasOwnProperty.call(bets, pid)) {
      var s = +(bets[pid] || {})[winner] || 0;
      if (s > 0) out[pid] = Math.floor(total * RM.poolBack * s / win);
    }
    return out;
  }
  function poolOdds(bets, cid) {
    var total = 0, on = 0;
    for (var pid in bets) if (Object.prototype.hasOwnProperty.call(bets, pid)) {
      var b = bets[pid] || {};
      for (var c in b) if (Object.prototype.hasOwnProperty.call(b, c)) { var v = +b[c] || 0; if (v > 0) { total += v; if (c === cid) on += v; } }
    }
    return on > 0 ? Math.floor(total * RM.poolBack / on * 10) / 10 : null;
  }

  var Room = { maxRiders: maxRiders, makeCard: makeCard, newRider: newRider, step: step, done: done, stOf: stOf, steps: steps, inputsOf: inputsOf, result: result,
    newRemote: newRemote, addSeg: addSeg, advance: advance, frameAt: frameAt, stale: stale, gone: gone, recompute: recompute, rank: rank, poolPays: poolPays, poolOdds: poolOdds };
  root.PriTestInusnowRoom = Room;
  if (typeof module !== "undefined" && module.exports) module.exports = Room;
})(typeof window !== "undefined" ? window : globalThis);
