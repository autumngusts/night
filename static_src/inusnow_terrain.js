/* イヌスノー（狗雪）地形與雪道幾何（docs/inusnow_design.md §2.3、§3）。
   不碰 DOM、不讀寫 localStorage；只用 + − × ÷、Math.sqrt、Math.floor、Math.abs（設計 §11：之後移植成 Go）。
   座標：原點＝格網西北角，x 往東、z 往南、y 往上（公尺）。 */
(function (root) {
  "use strict";

  var D = root.PriTestInusnowData || (typeof require === "function" ? require("./inusnow_data.js") : null);

  // ---------------- 格網解碼 ----------------
  // 資料格式：q＝round((h−base)÷scale) 的二維預測誤差（左＋上−左上），Int16LE、deflate、base64。
  function b64ToBytes(b64) {
    if (typeof atob === "function") {
      var bin = atob(b64), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, "base64"));
  }

  // 解壓：瀏覽器用 DecompressionStream（zlib 格式＝"deflate"），Node 用 zlib。回傳 Promise<Uint8Array>
  function inflate(b64) {
    var bytes = b64ToBytes(b64);
    if (typeof DecompressionStream === "function" && typeof Response === "function") {
      var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
      return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    }
    var zlib = require("zlib");
    return Promise.resolve(new Uint8Array(zlib.inflateSync(Buffer.from(bytes))));
  }

  // 由解壓後的位元組建立地形（純函式、同步）
  function build(json, raw) {
    var g = json.grid, w = g.w, h = g.h, n = w * h;
    var dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    var q = new Int32Array(n);
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        var k = j * w + i, pred;
        if (i === 0 && j === 0) pred = 0;
        else if (j === 0) pred = q[k - 1];
        else if (i === 0) pred = q[k - w];
        else pred = q[k - 1] + q[k - w] - q[k - w - 1];
        q[k] = pred + dv.getInt16(k * 2, true);
      }
    }
    var hs = new Float64Array(n);
    for (var a = 0; a < n; a++) hs[a] = g.base + q[a] * g.scale;
    // 壓雪後的平順坡面：3×3 平均模糊（邊緣只取存在的格子）
    var tmp = new Float64Array(n);
    for (var pass = 0; pass < D.PHYS.blurPasses; pass++) {
      for (var jj = 0; jj < h; jj++) {
        for (var ii = 0; ii < w; ii++) {
          var sum = 0, cnt = 0;
          for (var dz = -1; dz <= 1; dz++) {
            var z2 = jj + dz;
            if (z2 < 0 || z2 >= h) continue;
            for (var dx = -1; dx <= 1; dx++) {
              var x2 = ii + dx;
              if (x2 < 0 || x2 >= w) continue;
              sum += hs[z2 * w + x2];
              cnt += 1;
            }
          }
          tmp[jj * w + ii] = sum / cnt;
        }
      }
      var sw = hs; hs = tmp; tmp = sw;
    }
    var pistes = {};
    (json.pistes || []).forEach(function (p) { pistes[p.id] = makePiste(p); });
    return { id: json.id, json: json, w: w, h: h, cell: g.cell, hs: hs, pistes: pistes, sizeX: (w - 1) * g.cell, sizeZ: (h - 1) * g.cell };
  }

  function load(json) {
    return inflate(json.grid.data).then(function (raw) { return build(json, raw); });
  }

  function cellOf(t, x, z) {
    var fx = x / t.cell, fz = z / t.cell;
    var i0 = Math.floor(fx), j0 = Math.floor(fz);
    if (i0 < 0) i0 = 0; else if (i0 > t.w - 2) i0 = t.w - 2;
    if (j0 < 0) j0 = 0; else if (j0 > t.h - 2) j0 = t.h - 2;
    var tx = fx - i0, tz = fz - j0;
    if (tx < 0) tx = 0; else if (tx > 1) tx = 1;
    if (tz < 0) tz = 0; else if (tz > 1) tz = 1;
    var k = j0 * t.w + i0;
    return { tx: tx, tz: tz, a: t.hs[k], b: t.hs[k + 1], c: t.hs[k + t.w], d: t.hs[k + t.w + 1] };
  }

  function gridHeight(t, x, z) {
    var c = cellOf(t, x, z);
    return (c.a * (1 - c.tx) + c.b * c.tx) * (1 - c.tz) + (c.c * (1 - c.tx) + c.d * c.tx) * c.tz;
  }

  function height(t, x, z) {
    var y = gridHeight(t, x, z);
    if (t.feats) y += featOffset(t.feats, x, z);
    return y;
  }

  // 雙線性面的解析梯度 → 單位法線；附加物的梯度也用解析式加上去
  // （2026-11-21：原設計的中央差分在跳台唇口的落差處會算出近乎垂直的法線，讓速度歸零，所以改成解析梯度）
  function normal(t, x, z) {
    var c = cellOf(t, x, z);
    var dhdx = ((c.b - c.a) * (1 - c.tz) + (c.d - c.c) * c.tz) / t.cell;
    var dhdz = ((c.c - c.a) * (1 - c.tx) + (c.d - c.b) * c.tx) / t.cell;
    if (t.feats) {
      var fg = featGrad(t.feats, x, z);
      dhdx += fg[0]; dhdz += fg[1];
    }
    var len = Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
    return [-dhdx / len, 1 / len, -dhdz / len];
  }

  // ---------------- 雪道 ----------------
  function makePiste(p) {
    var pts = p.pts, cum = [0];
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1];
      cum.push(cum[i - 1] + Math.sqrt(dx * dx + dz * dz));
    }
    return { id: p.id, src: p, pts: pts, cum: cum, len: cum[cum.length - 1], width: p.width };
  }

  function piste(t, id) { return t.pistes[id] || null; }

  // 弧長 s 處的點與單位切線
  function at(pi, s) {
    var pts = pi.pts, cum = pi.cum, n = pts.length;
    if (s <= 0) s = 0;
    if (s >= pi.len) s = pi.len;
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    var seg = cum[hi] - cum[lo];
    var u = seg > 0 ? (s - cum[lo]) / seg : 0;
    var dx = pts[hi][0] - pts[lo][0], dz = pts[hi][1] - pts[lo][1];
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    return { x: pts[lo][0] + dx * u, z: pts[lo][1] + dz * u, tx: dx / len, tz: dz / len, i: lo };
  }

  // 最近點：回傳弧長 s、帶號側向距離 d（行進方向的右側為正；右＝(−tz, tx)）、線段 i。
  // hint：上次的線段，只在附近 ±win 段內搜尋（找不到更近的就全部搜尋）
  function nearest(pi, x, z, hint) {
    var pts = pi.pts, n = pts.length;
    var from = 0, to = n - 2;
    if (hint !== undefined && hint !== null) {
      from = hint - 6; to = hint + 6;
      if (from < 0) from = 0;
      if (to > n - 2) to = n - 2;
    }
    var best = null;
    for (var i = from; i <= to; i++) {
      var ax = pts[i][0], az = pts[i][1];
      var dx = pts[i + 1][0] - ax, dz = pts[i + 1][1] - az;
      var l2 = dx * dx + dz * dz;
      var u = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      if (u < 0) u = 0; else if (u > 1) u = 1;
      var px = ax + dx * u, pz = az + dz * u;
      var ex = x - px, ez = z - pz;
      var d2 = ex * ex + ez * ez;
      if (!best || d2 < best.d2) best = { d2: d2, i: i, u: u, dx: dx, dz: dz, ex: ex, ez: ez, l2: l2 };
    }
    var len = Math.sqrt(best.l2) || 1;
    var tx = best.dx / len, tz = best.dz / len;
    var side = best.ex * (-tz) + best.ez * tx;
    return { s: pi.cum[best.i] + len * best.u, d: side, i: best.i, tx: tx, tz: tz };
  }

  // ---------------- 地形附加物（設計 §3.5） ----------------
  // 每個附加物：{k, x, z, tx, tz（沿雪道單位向量）, u0, u1, wMax（包圍範圍）, 形狀參數}。
  // u＝沿 t 的距離、w＝沿右側 r＝(−tz, tx) 的距離。不改格網，只在高度上疊加。
  function latFade(w, half) {
    var a = w < 0 ? -w : w;
    if (a <= half) return 1;
    if (a >= half + 1) return 0;
    return 1 - (a - half);
  }
  function featLocal(f, x, z) {
    var dx = x - f.x, dz = z - f.z;
    return { u: dx * f.tx + dz * f.tz, w: dx * (-f.tz) + dz * f.tx };
  }
  function offsetOf(f, u, w) {
    var k = f.k;
    if (k === "kicker") {
      if (u < -f.L || u > 0) return 0;
      var q = (u + f.L) / f.L;
      return f.H * q * q * latFade(w, f.W / 2);
    }
    if (k === "roller") {
      var xr = u / (f.len / 2);
      if (xr < -1 || xr > 1) return 0;
      var m = 1 - xr * xr;
      return f.A * m * m * latFade(w, f.W / 2);
    }
    if (k === "drop") {
      if (u > f.L) return 0;
      var qd = u < 0 ? 1 : 1 - u / f.L;
      return f.H * qd * qd * latFade(w, f.W / 2);
    }
    if (k === "bank") {
      var sw = f.side * w - f.d0;
      if (sw <= 0) return 0;
      var hl = f.len / 2, au = u < 0 ? -u : u;
      if (au >= hl) return 0;
      var endF = au > hl - f.fade ? (hl - au) / f.fade : 1;
      var r = sw / f.dw;
      if (r > 1) r = 1;
      return f.B * r * r * endF;
    }
    return 0;
  }
  // 附加物高度對 (u, w) 的偏微分
  function latFadeD(w, half) {
    var a = w < 0 ? -w : w;
    if (a <= half || a >= half + 1) return 0;
    return w < 0 ? 1 : -1;
  }
  function gradOf(f, u, w) {
    var k = f.k;
    if (k === "kicker") {
      if (u < -f.L || u > 0) return [0, 0];
      var q = (u + f.L) / f.L;
      return [2 * f.H * q / f.L * latFade(w, f.W / 2), f.H * q * q * latFadeD(w, f.W / 2)];
    }
    if (k === "roller") {
      var hl = f.len / 2, xr = u / hl;
      if (xr < -1 || xr > 1) return [0, 0];
      var m = 1 - xr * xr;
      return [f.A * 2 * m * (-2 * xr) / hl * latFade(w, f.W / 2), f.A * m * m * latFadeD(w, f.W / 2)];
    }
    if (k === "drop") {
      if (u > f.L) return [0, 0];
      if (u < 0) return [0, f.H * latFadeD(w, f.W / 2)];
      var qd = 1 - u / f.L;
      return [-2 * f.H * qd / f.L * latFade(w, f.W / 2), f.H * qd * qd * latFadeD(w, f.W / 2)];
    }
    if (k === "bank") {
      var sw = f.side * w - f.d0;
      if (sw <= 0) return [0, 0];
      var hb = f.len / 2, au = u < 0 ? -u : u;
      if (au >= hb) return [0, 0];
      var endF = au > hb - f.fade ? (hb - au) / f.fade : 1;
      var dEnd = au > hb - f.fade ? (u < 0 ? 1 : -1) / f.fade : 0;
      var r = sw / f.dw, dr = f.side / f.dw;
      if (r > 1) { r = 1; dr = 0; }
      return [f.B * r * r * dEnd, f.B * 2 * r * dr * endF];
    }
    return [0, 0];
  }
  function featGrad(feats, x, z) {
    var gx = 0, gz = 0;
    for (var i = 0; i < feats.length; i++) {
      var f = feats[i];
      if (f.k === "rail" || f.k === "box") continue;
      var l = featLocal(f, x, z);
      if (!inBox(f, l)) continue;
      var g = gradOf(f, l.u, l.w);
      // u 沿 t、w 沿 r＝(−tz, tx)
      gx += g[0] * f.tx + g[1] * (-f.tz);
      gz += g[0] * f.tz + g[1] * f.tx;
    }
    return [gx, gz];
  }
  function inBox(f, l) { return l.u >= f.u0 && l.u <= f.u1 && l.w >= -f.wMax && l.w <= f.wMax; }
  function featOffset(feats, x, z) {
    var y = 0;
    for (var i = 0; i < feats.length; i++) {
      var f = feats[i];
      if (f.k === "rail" || f.k === "box") continue;
      var l = featLocal(f, x, z);
      if (inBox(f, l)) y += offsetOf(f, l.u, l.w);
    }
    return y;
  }
  // 附加物的包圍範圍（u0、u1、wMax）依種類補上
  function prepFeat(f) {
    if (f.k === "kicker") { f.u0 = -f.L; f.u1 = 0; f.wMax = f.W / 2 + 1; }
    else if (f.k === "roller") { f.u0 = -f.len / 2; f.u1 = f.len / 2; f.wMax = f.W / 2 + 1; }
    else if (f.k === "drop") { f.u0 = -200; f.u1 = f.L; f.wMax = f.W / 2 + 1; }
    else if (f.k === "bank") { f.u0 = -f.len / 2; f.u1 = f.len / 2; f.wMax = f.d0 + f.dw + 40; }
    else { f.u0 = 0; f.u1 = f.len; f.wMax = f.w / 2 + 1; }
    return f;
  }
  // 地形的包裝：同一份格網，加上附加物清單（物理與畫面都透過這個取高度與法線）
  function withFeatures(t, feats) {
    var o = {};
    for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) o[k] = t[k];
    o.base = t.base || t;
    o.feats = [];
    for (var i = 0; i < feats.length; i++) o.feats.push(prepFeat(feats[i]));
    return o;
  }

  // ---------------- G1 溝痕（設計 §17.6） ----------------
  // 稀疏格網（1 m 格）：key＝i×65536＋j → {n: 0～255, dx, dz（累積方向）}
  function rutAt(rut, x, z) {
    if (!rut) return null;
    var i = Math.floor(x), j = Math.floor(z);
    var c = rut.cells[(i + 32768) * 65536 + (j + 32768)];
    return c || null;
  }

  var T = { inflate: inflate, build: build, load: load, height: height, gridHeight: gridHeight, normal: normal, piste: piste, at: at, nearest: nearest,
    withFeatures: withFeatures, featLocal: featLocal, featOffset: featOffset, offsetOf: offsetOf, prepFeat: prepFeat, rutAt: rutAt };
  root.PriTestInusnowTerrain = T;
  if (typeof module !== "undefined" && module.exports) module.exports = T;
})(typeof window !== "undefined" ? window : globalThis);
