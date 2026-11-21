/* イヌスノー（狗雪）M3 世界盃巡迴（docs/inusnow_design.md §18.7）、R1 每日雪況（§18.9）。
   每一站的比賽由畫面用 Core／Slope／Cross 模擬；這裡只管賽程、積分、名次、每日的 seed。
   不碰 DOM、不讀寫 localStorage；只用 + − × ÷、Math.sqrt、Math.floor、Math.abs、Math.imul（設計 §11）。 */
(function (root) {
  "use strict";

  var D = root.PriTestInusnowData || (typeof require === "function" ? require("./inusnow_data.js") : null);
  var Core = root.PriTestInusnowCore || (typeof require === "function" ? require("./inusnow_core.js") : null);
  var Env = root.PriTestInusnowEnv || (typeof require === "function" ? require("./inusnow_env.js") : null);
  var CUP = D.CUP;

  // 一季：8 站（雪場順序由季 seed 決定），賽事大曲道、Slopestyle、Cross 輪流；CPU 23 隻
  function newSeason(seed) { return { v: 1, seed: seed >>> 0, stage: 0, points: {}, results: [] }; }
  function stages(season) {
    var rng = Core.makeRng((season.seed ^ Core.hash("cup")) >>> 0);
    var res = D.RESORTS.slice(), out = [];
    for (var i = res.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = res[i]; res[i] = res[j]; res[j] = t; }
    var e0 = Math.floor(rng() * 3);
    for (var k = 0; k < CUP.stages; k++) out.push({ n: k, resort: res[k % res.length], event: CUP.events[(e0 + k) % 3], seed: Core.hash("cupstage|" + season.seed + "|" + k) });
    return out;
  }
  function field(season) {
    var rng = Core.makeRng((season.seed ^ Core.hash("cupfield")) >>> 0);
    var pool = D.CPU.slice();
    pool.splice(Math.floor(rng() * pool.length), 1);
    return pool.slice(0, CUP.field);
  }
  function pointsFor(place) { return place >= 1 && place <= CUP.points.length ? CUP.points[place - 1] : 0; }
  // order：這一站的名次（"me" 或 CPU id），第 1 名在前
  function applyStage(season, order) {
    var st = stages(season)[season.stage];
    for (var i = 0; i < order.length; i++) season.points[order[i]] = (season.points[order[i]] || 0) + pointsFor(i + 1);
    season.results.push({ stage: season.stage, resort: st.resort, event: st.event, order: order.slice() });
    season.stage += 1;
    return season;
  }
  function done(season) { return season.stage >= CUP.stages; }
  function standings(season) {
    var ids = ["me"].concat(field(season).map(function (c) { return c.id; }));
    return ids.map(function (id) { return { id: id, pts: season.points[id] || 0 }; }).sort(function (a, b) { return b.pts - a.pts || (a.id < b.id ? -1 : 1); });
  }
  // B2：CPU 近 5 場成績（名次）
  function recent(season, id) {
    if (!season) return [];
    var out = [];
    for (var i = season.results.length - 1; i >= 0 && out.length < 5; i--) {
      var o = season.results[i].order, p = o.indexOf(id);
      if (p >= 0) out.push(p + 1);
    }
    return out;
  }

  // ---------------- R1 每日雪況 ----------------
  // date＝"YYYY-MM-DD"（JST）
  function daily(date) {
    var seed = Core.hash("daily|" + date), month = +date.slice(5, 7);
    var conds = {};
    D.RESORTS.forEach(function (r) { conds[r] = Env.conditions(seed, r, month, { change: false }); });
    var res = D.RESORTS[seed % D.RESORTS.length];
    return { date: date, seed: seed, conds: conds, challenge: { resort: res, seed: Core.hash("dailygs|" + date) } };
  }

  var Season = { newSeason: newSeason, stages: stages, field: field, pointsFor: pointsFor, applyStage: applyStage, done: done, standings: standings, recent: recent, daily: daily };
  root.PriTestInusnowSeason = Season;
  if (typeof module !== "undefined" && module.exports) module.exports = Season;
})(typeof window !== "undefined" ? window : globalThis);
