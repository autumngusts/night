/* イヌスノー（狗雪）雪況與天氣（docs/inusnow_design.md §18.3～§18.5）、G2 嗅覺捷徑（§17.7）。
   雪況 cond＝{snow, weather, night, change: {to, at（步）, chance, happen} | null}。
   Env.make(cond, …) 產生每一步的物理環境（路面雪質、抓地、μ 增加、側風、寒冷）。
   不碰 DOM、不讀寫 localStorage；只用 + − × ÷、Math.sqrt、Math.floor、Math.abs、Math.imul（設計 §11）。 */
(function (root) {
  "use strict";

  var D = root.PriTestInusnowData || (typeof require === "function" ? require("./inusnow_data.js") : null);
  var T = root.PriTestInusnowTerrain || (typeof require === "function" ? require("./inusnow_terrain.js") : null);
  var Core = root.PriTestInusnowCore || (typeof require === "function" ? require("./inusnow_core.js") : null);
  var E = D.ENV, SC = D.SCENT;
  var HZ = D.PHYS.hz;

  function pick(rng, weights) {
    var sum = 0, k;
    for (k in weights) if (Object.prototype.hasOwnProperty.call(weights, k)) sum += weights[k];
    var r = rng() * sum;
    for (k in weights) if (Object.prototype.hasOwnProperty.call(weights, k)) { r -= weights[k]; if (r < 0) return k; }
    return k;
  }

  function standard() { return { snow: "groomed", weather: "clear", night: false, change: null }; }
  function isStandard(c) { return !c || (c.snow === "groomed" && c.weather === "clear" && !c.night && !(c.change && c.change.happen)); }

  // 隨機雪況：地區與月份加權（月份 1～12，JST）；ov 可以指定其中幾項
  function conditions(seed, resort, month, ov) {
    ov = ov || {};
    var rng = Core.makeRng((seed ^ Core.hash("cond|" + resort)) >>> 0);
    var reg = D.REGION[resort] || "nagano";
    var sw = {}, ww = D.REGION_WEATHER[reg], k;
    for (k in D.REGION_SNOW[reg]) if (Object.prototype.hasOwnProperty.call(D.REGION_SNOW[reg], k)) sw[k] = D.REGION_SNOW[reg][k];
    if (month === 3 || month === 4) sw.spring = sw.spring * 3;
    else if (month === 12 || month === 1 || month === 2) sw.spring = sw.spring * 0.2;
    var snow = pick(rng, sw), weather = pick(rng, ww);
    var night = rng() < E.nightChance;
    var to = pick(rng, ww), chance = 0.2 + rng() * 0.4, happen = rng() < chance, hasCh = rng() < E.changeChance;
    var at = Math.floor((E.changeFrom + rng() * (E.changeTo - E.changeFrom)) * HZ);
    if (ov.snow) snow = ov.snow;
    if (ov.weather) weather = ov.weather;
    if (ov.night !== undefined && ov.night !== null) night = !!ov.night;
    var change = to !== weather && hasCh ? { to: to, at: at, chance: Math.floor(chance * 100 + 0.5) / 100, happen: happen } : null;
    if (ov.change === false) change = null;
    return { snow: snow, weather: weather, night: night, change: change };
  }

  function weatherAt(cond, step) {
    if (cond.change && cond.change.happen && step >= cond.change.at) return cond.change.to;
    return cond.weather;
  }

  // 線段 a→b 與點的距離
  function segDist(ax, az, bx, bz, x, z) {
    var dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    var u = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    if (u < 0) u = 0; else if (u > 1) u = 1;
    var ex = x - (ax + dx * u), ez = z - (az + dz * u);
    return Math.sqrt(ex * ex + ez * ez);
  }
  function inShortcut(cuts, x, z, extra) {
    if (!cuts) return -1;
    for (var i = 0; i < cuts.length; i++) {
      var c = cuts[i];
      if (segDist(c.ax, c.az, c.bx, c.bz, x, z) <= SC.halfW + (extra || 0)) return i;
    }
    return -1;
  }

  // ---------------- 物理環境 ----------------
  // opts：{piste（G3 用）, seed, dog, cuts（嗅覺捷徑）, windDir: [x, z]}
  function make(cond, opts) {
    cond = cond || standard();
    var pi = opts.piste || null, seed = (opts.seed >>> 0) || 0;
    var cld = opts.dog && opts.dog.stats ? opts.dog.stats.cld : 50;
    var wd = opts.windDir;
    if (!wd && pi) {
      var a = T.at(pi, 0), b = T.at(pi, pi.len), dx = b.x - a.x, dz = b.z - a.z, l = Math.sqrt(dx * dx + dz * dz) || 1;
      wd = [-dz / l, dx / l];                       // 雪道整體方向的右側
    }
    if (!wd) wd = [1, 0];
    var base = D.SNOW[cond.snow] ? cond.snow : "groomed";
    return {
      cond: cond,
      // 第 step 步的物理環境（rider 的位置在 x, z）
      env: function (step) {
        var w = weatherAt(cond, step), W = D.WEATHER[w];
        var fresh = base === "powder" || w === "snow" || w === "blizzard";
        var o = { snow: base };
        if (W.grip !== 1) o.grip = W.grip;
        if (W.muRate) {
          var from = cond.change && cond.change.happen && w === cond.change.to ? cond.change.at : 0;
          o.muAdd = W.muRate * (step - from) / (60 * HZ);
        }
        if (W.wind) {
          var k = Math.floor(step / E.windEvery);
          var sgn = (Core.hash(seed + "|wind|" + k) & 1) ? 1 : -1;
          o.wind = [wd[0] * W.wind * sgn, wd[1] * W.wind * sgn];
        }
        if (W.cold && cld < W.cold) o.cold = E.coldK * (W.cold - cld);
        var cuts = opts.cuts;
        if (fresh || cuts) {
          o.surf = function (x, z) {
            if (cuts && inShortcut(cuts, x, z, 0) >= 0) return "deep";
            if (fresh && pi) {
              var nr = T.nearest(pi, x, z);
              var lim = pi.width * E.freshCenter;
              if (nr.d > lim || nr.d < -lim) return "powder";
              return base === "powder" ? "groomed" : base;
            }
            return base;
          };
        }
        return o;
      },
    };
  }

  // ---------------- G2 嗅覺捷徑 ----------------
  // 彎道內側的弦：從雪道 s−L 到 s+L 直線穿過樹林，長度比繞雪道短 5～15%，中點在雪道外
  function makeShortcuts(terrain, pi, rng, count) {
    var cand = [];
    for (var s = 60; s < pi.len - 60; s += 10) {
      for (var L = 25; L <= 70; L += 5) {
        if (s - L < 20 || s + L > pi.len - 20) continue;
        var a = T.at(pi, s - L), b = T.at(pi, s + L);
        var cl = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
        var save = 1 - cl / (2 * L);
        if (save < SC.save[0] || save > SC.save[1]) continue;
        var nr = T.nearest(pi, (a.x + b.x) / 2, (a.z + b.z) / 2);
        if (Math.abs(nr.d) < pi.width / 2 + 3) continue;
        cand.push({ s: s, L: L, save: save, a: a, b: b });
        break;
      }
    }
    var out = [];
    while (out.length < count && cand.length) {
      var k = Math.floor(rng() * cand.length), c = cand[k];
      cand.splice(k, 1);
      var ok = true;
      for (var q = 0; q < out.length; q++) if (Math.abs(out[q].s - c.s) < out[q].L + c.L + 20) ok = false;
      if (!ok) continue;
      out.push(cutOf(terrain, pi, c, rng));
    }
    return out;
  }
  function cutOf(terrain, pi, c, rng) {
    var ax = c.a.x, az = c.a.z, bx = c.b.x, bz = c.b.z;
    var dx = bx - ax, dz = bz - az, len = Math.sqrt(dx * dx + dz * dz), tx = dx / len, tz = dz / len;
    var trees = [];
    for (var u = 6; u < len - 6; u += SC.treeGap) {
      for (var sd = -1; sd <= 1; sd += 2) {
        var off = SC.treeOff[0] + 0.3 + rng() * (SC.treeOff[1] - SC.treeOff[0]);
        var x = ax + tx * u + (-tz) * sd * off, z = az + tz * u + tx * sd * off;
        var nr = T.nearest(pi, x, z);
        if (Math.abs(nr.d) < pi.width / 2 + 1) continue;      // 雪道上不放樹
        trees.push([x, z, 0.7 + rng() * 0.5]);
      }
    }
    return { piste: pi.id, s: c.s, L: c.L, save: c.save, ax: ax, az: az, bx: bx, bz: bz, len: len, trees: trees };
  }

  // 嗅覺量表（每位選手）：每秒 +5 × nose（蹲低 ×1.5）；滿了腳印標示 10 秒；進入捷徑歸 0
  function scentTick(st, inp, nose, cuts, ev) {
    if (!cuts || !cuts.length) return;
    if (st.scentShow > 0) st.scentShow -= 1;
    var inside = inShortcut(cuts, st.p[0], st.p[2], 0);
    if (inside >= 0) {
      if (st.scentIn !== inside) { st.scentIn = inside; st.scent = 0; st.scentShow = 0; ev.push("shortcut"); }
      return;
    }
    st.scentIn = -1;
    if (st.scent >= SC.max) return;
    st.scent += SC.rate * (nose || 1) * (inp.c ? SC.crouchMul : 1) / HZ;
    if (st.scent >= SC.max) { st.scent = SC.max; st.scentShow = SC.showSteps; ev.push("scent"); }
  }
  // 捷徑的樹：撞到就摔倒（速度 > 3 m/s），推到樹幹外
  function treeHit(st, cuts, terrain, Phys) {
    if (!cuts || st.air) return false;
    var x = st.p[0], z = st.p[2], hit = false;
    for (var i = 0; i < cuts.length; i++) {
      var c = cuts[i];
      if (segDist(c.ax, c.az, c.bx, c.bz, x, z) > SC.treeOff[1] + 2) continue;
      for (var k = 0; k < c.trees.length; k++) {
        var tr = c.trees[k], ex = x - tr[0], ez = z - tr[1], r = D.FREE.treeR * tr[2] + 0.4, d2 = ex * ex + ez * ez;
        if (d2 >= r * r) continue;
        var dl = Math.sqrt(d2) || 1;
        st.p[0] = tr[0] + ex / dl * r; st.p[2] = tr[1] + ez / dl * r;
        st.p[1] = T.height(terrain, st.p[0], st.p[2]);
        if (Phys.speed(st) > D.FREE.knockSpeed) hit = Phys.knock(st) || hit;
        else { st.v[0] *= 0.5; st.v[2] *= 0.5; }
      }
    }
    return hit;
  }

  var Env = { standard: standard, isStandard: isStandard, conditions: conditions, weatherAt: weatherAt, make: make,
    makeShortcuts: makeShortcuts, inShortcut: inShortcut, scentTick: scentTick, treeHit: treeHit, segDist: segDist };
  root.PriTestInusnowEnv = Env;
  if (typeof module !== "undefined" && module.exports) module.exports = Env;
})(typeof window !== "undefined" ? window : globalThis);
