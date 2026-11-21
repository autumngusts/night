/* イヌスノー（狗雪）競猜（docs/inusnow_design.md §18.1）：出賽表、調子、雪道適性、CPU 比賽的模擬、機率與賠率、票種與買法、結算、時間預測。
   狗幣只是遊戲內點數，不能購買、不能換現金（D10）。不讀 saigo 的檔案（§18.1）。
   不碰 DOM、不讀寫 localStorage；只用 + − × ÷、Math.sqrt、Math.floor、Math.abs、Math.imul（設計 §11）。 */
(function (root) {
  "use strict";

  var D = root.PriTestInusnowData || (typeof require === "function" ? require("./inusnow_data.js") : null);
  var T = root.PriTestInusnowTerrain || (typeof require === "function" ? require("./inusnow_terrain.js") : null);
  var Core = root.PriTestInusnowCore || (typeof require === "function" ? require("./inusnow_core.js") : null);
  var SLP = root.PriTestInusnowSlope || (typeof require === "function" ? require("./inusnow_slope.js") : null);
  var CX = root.PriTestInusnowCross || (typeof require === "function" ? require("./inusnow_cross.js") : null);
  var Env = root.PriTestInusnowEnv || (typeof require === "function" ? require("./inusnow_env.js") : null);
  var B = D.BET;

  function r1(v) { return Math.floor(v * 10 + 0.5) / 10; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // 雪道的平均坡度與彎道量（適性用）
  function courseShape(pi, terrain) {
    var drop = 0, turn = 0, n = 0;
    for (var s = 0; s + 20 <= pi.len; s += 20) {
      var a = T.at(pi, s), b = T.at(pi, s + 20);
      drop += T.height(terrain, a.x, a.z) - T.height(terrain, b.x, b.z);
      turn += Math.abs(a.tx * b.tz - a.tz * b.tx);
      n += 1;
    }
    return { grade: n ? drop / (n * 20) : 0, turn: n ? turn / n : 0 };
  }
  // 雪道適性 ★1～5：賽事與雪道形狀決定看重哪些能力
  function aptitude(breed, event, shape) {
    var s = breed.stats, v;
    if (event === "slope") v = s.brv * 0.4 + s.tec * 0.4 + s.bal * 0.2;
    else if (event === "cross") v = s.pow * 0.35 + s.siz * 0.25 + s.bal * 0.2 + s.brv * 0.2;
    else v = s.tec * (0.3 + shape.turn * 2) + s.bal * 0.3 + s.siz * (0.4 - shape.turn * 2) + (shape.grade > 0.3 ? s.brv * 0.1 : 0);
    return clamp(Math.floor((v - 45) / 8 + 0.5), 1, 5);
  }

  // 出賽表：opts＝{resort, event, seed, piste, month, cond?}
  function makeCard(terrain, opts) {
    var n = opts.event === "cross" ? D.CROSS.riders : D.CPU_AI.field + 1;
    var seed = opts.seed >>> 0;
    var field = Core.cpuField(seed, n);
    var rng = Core.makeRng((seed ^ Core.hash("card")) >>> 0);
    var pi = T.piste(terrain, opts.piste);
    var shape = courseShape(pi, terrain);
    var cond = opts.cond || Env.conditions(seed, opts.resort, opts.month || 1, {});
    return {
      v: 1, resort: opts.resort, event: opts.event, seed: seed, piste: opts.piste, cond: cond,
      field: field.map(function (c) {
        var b = Core.breed(c.breed);
        return { id: c.id, form: 1 + Math.floor(rng() * 5), apt: aptitude(b, opts.event, shape) };
      }),
    };
  }

  // 調子 → CPU 的變化（大曲道：aggr ±、失誤率 ×；Slopestyle：等級 ±1）
  function variant(entry) {
    var c = null;
    for (var i = 0; i < D.CPU.length; i++) if (D.CPU[i].id === entry.id) c = D.CPU[i];
    var o = { id: c.id, breed: c.breed, name: c.name, lv: c.lv, style: c.style, aggrAdd: (entry.form - 3) * B.condAggr, missMul: B.condMiss[entry.form - 1] };
    if (entry.form >= 5 && o.lv < 5) o.slopeLv = o.lv + 1;
    else if (entry.form <= 1 && o.lv > 1) o.slopeLv = o.lv - 1;
    return o;
  }

  // 用 seed 模擬一場 CPU 比賽 → {order: [出賽表的 index…], val: [時間或分數]}
  // keep＝true 時附上觀戰用的 detail（大曲道：2 趟的模擬；Slopestyle：每隻的結果與 frames；Cross：每步每隻的 frame）
  function condOf(card) { return Env && card.cond && !Env.isStandard(card.cond) ? card.cond : null; }
  function simulate(terrain, card, seed, keep) {
    var cpus = card.field.map(variant), n = cpus.length, val = [], i, cond = condOf(card);
    if (card.event === "slope") {
      var res = [];
      for (i = 0; i < n; i++) {
        var cp = cpus[i], cc = { id: cp.id, breed: cp.breed, lv: cp.slopeLv || cp.lv, style: cp.style };
        var sr = SLP.simCpu(terrain, { piste: card.piste, seed: seed, snow: "groomed", runNo: 0, cond: cond }, cc, seed, i);
        val.push(sr.score);
        if (keep) res.push(sr);
      }
      return { order: orderBy(val, true), val: val, detail: keep ? { results: res } : null };
    }
    if (card.event === "cross") {
      var race = CX.newCross(terrain, { piste: card.piste, seed: seed, snow: "groomed", cond: cond, dogs: cpus.map(function (c) { return Core.breed(c.breed); }) });
      var ctl = CX.controllers(race, seed, -1);
      var frames = keep ? race.riders.map(function (r) { return [Core.frameOf(r.st)]; }) : null;
      while (race.status === "run") {
        CX.stepCross(race, ctl.map(function (c) { return c(race); }));
        if (keep) race.riders.forEach(function (r, k) { frames[k].push(Core.frameOf(r.st)); });
      }
      race.riders.forEach(function (r) { val.push(r.dnf ? null : r.time); });
      var ord = [];
      for (i = 0; i < n; i++) ord.push(i);
      ord.sort(function (a, b) { return race.riders[a].place - race.riders[b].place; });
      return { order: ord, val: val, detail: keep ? { frames: frames, feats: race.feats, finish: race.finish, terrain: race.terrain, cuts: race.cuts, len: race.piste.len } : null };
    }
    // 大曲道：2 趟合計（第 2 趟旗門 seed＋1）；任何一趟失格＝排在最後
    var tot = [], sims = [];
    for (i = 0; i < n; i++) tot.push(0);
    for (var run = 0; run < 2; run++) {
      var sim = Core.simGsField(terrain, { piste: card.piste, seed: seed, snow: "groomed", runNo: run, cond: cond }, cpus, seed + run * 7919);
      for (i = 0; i < n; i++) tot[i] = tot[i] === null || sim.cpus[i].time === null ? null : tot[i] + sim.cpus[i].time;
      if (keep) sims.push(sim.cpus);
    }
    return { order: orderBy(tot, false), val: tot, detail: keep ? { runs: sims } : null };
  }
  // B2 練習滑行：每隻 CPU 一趟（大曲道：時間；Slopestyle：分數；Cross：沒有）
  function practice(terrain, card, i) {
    var cp = variant(card.field[i]), seed = (card.seed ^ Core.hash("practice" + cp.id)) >>> 0, cond = condOf(card);
    if (card.event === "slope") return SLP.simCpu(terrain, { piste: card.piste, seed: seed, snow: "groomed", runNo: 0, cond: cond }, { id: cp.id, breed: cp.breed, lv: cp.slopeLv || cp.lv, style: cp.style }, seed, i).score;
    if (card.event === "gs") {
      var r = Core.simCpuGs(terrain, { piste: card.piste, seed: seed, snow: "groomed", runNo: 0, cond: cond }, cp, seed, i, null);
      return r.status === "finish" ? r.time : null;
    }
    return null;
  }
  function orderBy(val, desc) {
    var idx = [];
    for (var i = 0; i < val.length; i++) idx.push(i);
    idx.sort(function (a, b) {
      var x = val[a], y = val[b];
      if (x === null && y === null) return a - b;
      if (x === null) return 1;
      if (y === null) return -1;
      return (desc ? y - x : x - y) || a - b;
    });
    return idx;
  }

  // ---------------- 機率與賠率 ----------------
  function oddsInit(card) { return { n: 0, total: B.oddsSims, c: {} }; }
  function add(c, k) { c[k] = (c[k] || 0) + 1; }
  function sortNum(a) { return a.slice().sort(function (x, y) { return x - y; }); }
  // val：未完賽（null）的選手不算進名次（2026-11-21 QA：DNF 不能中複勝、三連）
  function keysOf(order, val) {
    var o = order.map(function (x) { return val && val[x] === null ? -1 : x; });
    var a = o[0], b = o[1], c = o[2];
    return {
      win: ["win:" + a], place: ["place:" + a, "place:" + b, "place:" + c],
      exacta: ["exacta:" + a + "-" + b], quinella: ["quinella:" + sortNum([a, b]).join("-")],
      trifecta: ["trifecta:" + a + "-" + b + "-" + c], trio: ["trio:" + sortNum([a, b, c]).join("-")],
    };
  }
  // 用「其他 seed」各模擬一次（實際比賽用 card.seed 本身，不在這些裡面）
  function oddsStep(terrain, card, acc) {
    if (acc.n >= acc.total) return true;
    var res = simulate(terrain, card, (card.seed ^ Core.hash("odds" + acc.n)) >>> 0);
    var ks = keysOf(res.order, res.val);
    for (var t in ks) if (Object.prototype.hasOwnProperty.call(ks, t)) ks[t].forEach(function (k) { add(acc.c, k); });
    acc.n += 1;
    return acc.n >= acc.total;
  }
  function odds(acc, key) {
    var cnt = acc.c[key] || 0;
    var p = cnt > 0 ? cnt / acc.n : 0.3 / acc.n;
    return clamp(r1(B.payback / p), B.minOdds, B.maxOdds);
  }

  // ---------------- 票 ----------------
  var SIZE = { win: 1, place: 1, exacta: 2, quinella: 2, trifecta: 3, trio: 3 };
  var ORDERED = { exacta: true, trifecta: true };
  function perms(list, k) {
    if (k === 0) return [[]];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var rest = list.slice(0, i).concat(list.slice(i + 1));
      perms(rest, k - 1).forEach(function (p) { out.push([list[i]].concat(p)); });
    }
    return out;
  }
  // ticket：{type, method: "normal"|"box"|"axis", sel: [index…], axis?: index}
  function expand(tk) {
    var k = SIZE[tk.type], out = {}, combos = [];
    if (k === 1) combos = tk.sel.map(function (x) { return [x]; });
    else if (tk.method === "box") combos = perms(tk.sel, k);
    else if (tk.method === "axis") {
      var others = tk.sel.filter(function (x) { return x !== tk.axis; });
      perms(others, k - 1).forEach(function (p) { combos.push([tk.axis].concat(p)); });
    } else if (tk.sel.length >= k) combos = [tk.sel.slice(0, k)];
    combos.forEach(function (c) {
      var key = tk.type + ":" + (ORDERED[tk.type] ? c : sortNum(c)).join("-");
      out[key] = 1;
    });
    return Object.keys(out);
  }
  // 買票：每個組合 stake 狗幣，買的當下鎖定賠率
  function buy(tk, acc) {
    var keys = expand(tk);
    return keys.map(function (k) { return { key: k, stake: tk.stake, odds: odds(acc, k) }; });
  }
  function settle(lines, order, val) {
    var ks = keysOf(order, val), hit = {};
    for (var t in ks) if (Object.prototype.hasOwnProperty.call(ks, t)) ks[t].forEach(function (k) { hit[k] = 1; });
    return lines.map(function (l) { var h = !!hit[l.key]; return { key: l.key, stake: l.stake, odds: l.odds, hit: h, pay: h ? Math.floor(l.stake * l.odds) : 0 }; });
  }
  // B1 時間預測：冠軍的 2 趟合計，誤差 ±0.2 秒 12 倍、±0.5 秒 5 倍
  function timePay(guess, stake, winner) {
    if (winner === null || winner === undefined) return 0;
    var d = Math.abs(guess - winner);
    for (var i = 0; i < B.timeHit.length; i++) if (d <= B.timeHit[i][0]) return Math.floor(stake * B.timeHit[i][1]);
    return 0;
  }
  // 狗幣：JST 日期變更時，低於 300 就補到 300（U5）
  function refill(save, date) {
    if (typeof save.coins !== "number") save.coins = B.coinsStart;
    if (save.coinsDay !== date) {
      if (save.coins < B.coinsFloor) save.coins = B.coinsFloor;
      save.coinsDay = date;
      return true;
    }
    return false;
  }
  // B5 即時勝率（只顯示）：est＝預估完成時間，softmax（溫度 1.5 秒）
  function winProb(est) {
    var min = null, i;
    for (i = 0; i < est.length; i++) if (est[i] !== null && (min === null || est[i] < min)) min = est[i];
    var w = [], sum = 0;
    for (i = 0; i < est.length; i++) {
      var x = est[i] === null ? 0 : expNeg((est[i] - min) / B.softTemp);
      w.push(x); sum += x;
    }
    return w.map(function (x) { return sum > 0 ? x / sum : 0; });
  }
  // e^(−x)（x ≥ 0）：用加減乘除的近似（只用在畫面顯示的勝率）
  function expNeg(x) {
    if (x > 20) return 0;
    var k = 0;
    while (x > 0.5) { x = x / 2; k += 1; }
    var y = 1 - x + x * x / 2 - x * x * x / 6 + x * x * x * x / 24;
    while (k-- > 0) y = y * y;
    return y;
  }

  var Bet = { courseShape: courseShape, aptitude: aptitude, makeCard: makeCard, variant: variant, simulate: simulate, practice: practice,
    oddsInit: oddsInit, oddsStep: oddsStep, odds: odds, expand: expand, buy: buy, settle: settle, timePay: timePay,
    refill: refill, winProb: winProb, keysOf: keysOf, SIZE: SIZE };
  root.PriTestInusnowBet = Bet;
  if (typeof module !== "undefined" && module.exports) module.exports = Bet;
})(typeof window !== "undefined" ? window : globalThis);
