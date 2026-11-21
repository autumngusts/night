/* イヌスノー（狗雪）M6 雪橇犬接力（docs/inusnow_design.md §19.3）。
   一隊 4 隻、4 棒：大曲道前半 → Cross（單獨滑、無對手）→ Slopestyle（(100 − 分數) × 0.1 秒加進時間）→ 大曲道後半。
   每一棒都是一般的比賽物件（Core.newRun／Cross.newCross／Slope.newSlope），可以重播；團隊時間＝4 棒合計。
   不碰 DOM、不讀寫 localStorage；只用 + − × ÷、Math.sqrt、Math.floor、Math.abs、Math.imul（設計 §11）。 */
(function (root) {
  "use strict";

  var D = root.PriTestInusnowData || (typeof require === "function" ? require("./inusnow_data.js") : null);
  var T = root.PriTestInusnowTerrain || (typeof require === "function" ? require("./inusnow_terrain.js") : null);
  var Core = root.PriTestInusnowCore || (typeof require === "function" ? require("./inusnow_core.js") : null);
  var SLP = root.PriTestInusnowSlope || (typeof require === "function" ? require("./inusnow_slope.js") : null);
  var CX = root.PriTestInusnowCross || (typeof require === "function" ? require("./inusnow_cross.js") : null);
  var R = D.RELAY, G = D.GATES, HZ = D.PHYS.hz;
  var LEGS = ["gs1", "cross", "slope", "gs2"];

  function pistes(terrain) {
    var e = terrain.json.events || {};
    return { gs: e.gs.piste, cross: (e.cross || e.gs).piste, slope: (e.slope || e.gs).piste };
  }
  function legSeed(seed, k) { return (seed ^ Core.hash("relayleg" + k)) >>> 0; }

  // 第 k 棒的比賽物件：{k, kind: "gs"|"cross"|"slope", run|race}
  function newLeg(terrain, k, seed, dog, cond) {
    var p = pistes(terrain), sd = legSeed(seed, k);
    if (k === 0 || k === 3) {
      var pi = T.piste(terrain, p.gs), half = Math.floor(pi.len / 2);
      return { k: k, kind: "gs", run: Core.newRun(terrain, { piste: p.gs, seed: sd, dog: dog, snow: "groomed", runNo: 0, cond: cond || null,
        from: k === 0 ? G.startS : half, to: k === 0 ? half : pi.len - G.finishMargin }) };
    }
    if (k === 1) return { k: k, kind: "cross", race: CX.newCross(terrain, { piste: p.cross, seed: sd, snow: "groomed", dogs: [dog], cond: cond || null }) };
    return { k: k, kind: "slope", run: SLP.newSlope(terrain, { piste: p.slope, seed: sd, dog: dog, snow: "groomed", runNo: 0, cond: cond || null }) };
  }
  function stepLeg(leg, input) {
    if (leg.kind === "gs") return Core.stepRun(leg.run, input);
    if (leg.kind === "cross") { CX.stepCross(leg.race, [input]); return leg.race.status; }
    return SLP.stepSlope(leg.run, input);
  }
  function legSt(leg) { return leg.kind === "cross" ? leg.race.riders[0].st : leg.run.st; }
  function legSteps(leg) { return leg.kind === "cross" ? leg.race.steps : leg.run.steps; }
  function legDone(leg) { return leg.kind === "cross" ? leg.race.status !== "run" || leg.race.riders[0].done : leg.run.status !== "run"; }
  // 這一棒的時間（秒）；失格／未完賽＝已滑時間＋罰秒（設計 §0.7）
  function legTime(leg) {
    if (leg.kind === "gs") return leg.run.status === "finish" ? leg.run.time : legSteps(leg) / HZ + R.dsqPenalty;
    if (leg.kind === "cross") { var rd = leg.race.riders[0]; return rd.dnf || rd.time === null || rd.time === undefined ? legSteps(leg) / HZ + R.dsqPenalty : rd.time; }
    var sc = leg.run.status === "dsq" ? 0 : (leg.run.final || 0);
    var base = leg.run.time ? leg.run.time : legSteps(leg) / HZ + (leg.run.status === "dsq" ? R.dsqPenalty : 0);
    return base + (100 - sc) * R.slopeK;
  }
  function legInfo(leg) {
    if (leg.kind === "slope") return { score: leg.run.status === "dsq" ? 0 : (leg.run.final || 0), ok: leg.run.status !== "dsq" };
    if (leg.kind === "gs") return { ok: leg.run.status === "finish" };
    return { ok: !leg.race.riders[0].dnf };
  }
  // CPU 的輸入產生器
  function cpuCtl(leg, cpu, seed) {
    if (leg.kind === "gs") return Core.cpuGsController(cpu, seed);
    if (leg.kind === "slope") return SLP.cpuController(cpu, seed);
    var c = CX.cpuController(0, seed);
    return function () { return c(leg.race); };
  }
  function ctlInput(leg, ctl) { return leg.kind === "gs" || leg.kind === "slope" ? ctl(leg.run) : ctl(); }
  // CPU 跑完第 k 棒
  function simLeg(terrain, k, seed, cpu, cond) {
    var leg = newLeg(terrain, k, seed, Core.breed(cpu.breed), cond);
    var ctl = cpuCtl(leg, cpu, (legSeed(seed, k) ^ Core.hash("relaycpu" + cpu.id)) >>> 0);
    var guard = 0;
    while (!legDone(leg) && guard++ < R.maxSteps) stepLeg(leg, ctlInput(leg, ctl));
    return { time: legTime(leg), info: legInfo(leg), leg: leg };
  }
  // CPU 隊伍：3 隊各 4 隻（seed 決定）
  function cpuTeams(seed) {
    var f = Core.cpuField((seed ^ Core.hash("relayteams")) >>> 0, R.teams * 4);
    var out = [];
    for (var i = 0; i < R.teams; i++) out.push(f.slice(i * 4, i * 4 + 4));
    return out;
  }
  function simTeam(terrain, seed, members, cond) {
    var legs = [], total = 0;
    for (var k = 0; k < 4; k++) { var r = simLeg(terrain, k, seed, members[k], cond); legs.push(r.time); total += r.time; }
    return { legs: legs, total: total };
  }

  var Relay = { LEGS: LEGS, pistes: pistes, newLeg: newLeg, stepLeg: stepLeg, legSt: legSt, legSteps: legSteps, legDone: legDone, legTime: legTime, legInfo: legInfo,
    cpuCtl: cpuCtl, ctlInput: ctlInput, simLeg: simLeg, cpuTeams: cpuTeams, simTeam: simTeam };
  root.PriTestInusnowRelay = Relay;
  if (typeof module !== "undefined" && module.exports) module.exports = Relay;
})(typeof window !== "undefined" ? window : globalThis);
