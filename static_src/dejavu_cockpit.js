// DÉJÀ VU 山道下坡（dejavu）：第一人稱車內視角（偽 3D）。只負責畫，物理在 dejavu_core.js。
//   做法：把車前方約 320 m 的路面取樣點投影到透視畫面（車頭方向為前、車身俯仰跟著坡度，所以路看起來是平的），
//   由遠到近一條一條畫「路面＋兩側地形」的帶狀梯形（山壁／山谷／湖海／隧道／橋），
//   每一條畫完就畫落在那一列的看板（樹、護欄柱、彎道指示牌、電線桿、其他車），所以坡頂、山壁會正確擋住後面的東西。
//   遠處用天空色做霧氣淡出；天空有太陽、雲與兩層遠山（依車頭的世界方位平移）。最後疊上引擎蓋、A 柱、儀表板、方向盤與後照鏡。
(function () {
  "use strict";

  var SKY = {
    spring: ["#8cc4ec", "#e6f1f8"], summer: ["#3f97e0", "#cde6f8"], autumn: ["#6aa0d6", "#f3d9b6"], winter: ["#a9bccb", "#eef2f5"], rain: ["#69757e", "#a6b0b7"]
  };
  var FAR_MT = { spring: "#8ea3bb", summer: "#7893ae", autumn: "#8f87a0", winter: "#a8b6c4", rain: "#7c868d" };
  var HILL = { spring: "#6f9160", summer: "#46703c", autumn: "#8e6236", winter: "#d5dfe6", rain: "#5f6d5c" };
  var ROCK = { spring: "#7a7265", summer: "#6b675a", autumn: "#77644f", winter: "#b9c3cb" };
  var CONCRETE = "#9a9a94";
  var NEAR = 1.5;     // 看板（樹、柱子、車）比這更近就不畫
  var CLIP = 0.3;     // 路面／地形多邊形的近裁切平面（鏡頭前 0.3 m）
  var VIEW = 320;     // 往前畫幾公尺

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  var rgbCache = {};
  function rgb(hex) {
    if (typeof hex !== "string" || hex.length !== 7) hex = "#888888";
    if (rgbCache[hex]) return rgbCache[hex];
    var n = parseInt(hex.slice(1), 16);
    return (rgbCache[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  }
  // 顏色＋亮度調整（amt：−1〜1）＋霧（t：0〜1 往 fog 混）
  function tint(hex, amt, fog, t) {
    var c = rgb(hex), out = [0, 0, 0];
    for (var i = 0; i < 3; i++) {
      var v = c[i] + 255 * (amt || 0);
      if (fog) v = v + (fog[i] - v) * t;
      out[i] = clamp(Math.round(v), 0, 255);
    }
    return "rgb(" + out[0] + "," + out[1] + "," + out[2] + ")";
  }
  function shade(hex, amt) { return tint(hex, amt, null, 0); }
  function mixHex(a, b, t) {
    var x = rgb(a), y = rgb(b);
    return "rgb(" + [0, 1, 2].map(function (i) { return Math.round(x[i] + (y[i] - x[i]) * t); }).join(",") + ")";
  }

  // 每條賽道算一次：山壁在哪一側（前後 120 m 的累積轉角決定，彎內側通常是山；湖／海景觀時水那側開闊）、雲、太陽
  function prep(tr, seed) {
    if (tr._cock) return tr._cock;
    var N = tr.N, wall = new Int8Array(N), side = 1, win = 60, sum = 0, i;
    for (i = 0; i <= Math.min(N - 1, win); i++) sum += tr.k[i];
    for (i = 0; i < N; i++) {
      if (i > 0) sum += (i + win < N ? tr.k[i + win] : 0) - (i - win - 1 >= 0 ? tr.k[i - win - 1] : 0);
      if (tr.water) side = -tr.water;
      else if (sum > 0.12) side = 1;
      else if (sum < -0.12) side = -1;
      wall[i] = side;
    }
    var r = window.PriTestDejavuCore.rng((seed | 0) ^ 0x7c0c);
    var clouds = [];
    for (i = 0; i < 14; i++) clouds.push({ az: r() * Math.PI * 2, el: 0.04 + r() * 0.16, w: 0.08 + r() * 0.16, puff: 3 + Math.floor(r() * 3) });
    tr._cock = { wall: wall, clouds: clouds, sunAz: r() * Math.PI * 2, ph: [r() * 6, r() * 6, r() * 6, r() * 6] };
    return tr._cock;
  }

  // o：{ pal, trees, water: 水的顏色或 null, patchColor, decor?: 地區景物, snowWall?: 每個取樣點的雪牆高度（0＝沒有）, shoulder?: 路肩顏色,
  //      cam?: 外部攝影機（轉播用）{ x, y, z, h, j: 所在路段取樣點, pitch: 俯角（弧度，往下看為正）, zoom: 焦距倍率, back: 往後畫幾公尺 }
  //      有 cam 時不畫車內（引擎蓋、儀表板），被跟的車也畫成看板，路面依離鏡頭遠近排序後由遠到近畫（鏡頭可以朝任何方向） }
  function draw(ctx, W, H, race, car, o) {
    var Core = window.PriTestDejavuCore;
    var tr = race.track, ds = tr.ds, sp = tr.sp || [];
    var pc = prep(tr, race.seed);
    var cam = o.cam || null, ext = !!cam;
    var pose = Core.carPose(race, car);
    var view = ext ? { x: cam.x, y: cam.y, h: cam.h } : pose;
    var i0 = ext ? clamp(cam.j, 0, tr.N - 2) : clamp(Math.floor(car.s / ds), 0, tr.N - 2);
    var ch = Math.cos(view.h), sh = Math.sin(view.h);
    var camZ = ext ? cam.z : tr.z[i0] + 1.15;
    var slope = ext ? 0 : tr.sl[i0];
    var pitch = ext ? cam.pitch || 0 : 0, cp = Math.cos(pitch), spch = Math.sin(pitch);
    var F = W * 0.72 * (ext ? cam.zoom || 1 : 1), cx = W / 2, hy = H * (ext ? 0.5 : 0.4);
    // 車速越快鏡頭越低一點、微微晃動
    if (!ext) hy += Math.sin(race.t * 23) * Math.min(1.5, car.v * 0.04);
    // 無限遠（與鏡頭同高）的地平線：車內＝順著坡度；外部鏡頭＝依俯角
    var hz = ext ? hy - Math.tan(pitch) * F : hy - slope * F;
    var season = tr.season, pal = o.pal;
    var skyC = tr.rain ? SKY.rain : SKY[season];
    var fog = rgb(skyC[1]);
    function fogT(f) { return clamp((f - 30) / (VIEW * 1.05), 0, 0.82); }

    // 投影：保留鏡頭座標（f 往前、l 往左、u 往上），多邊形在 CLIP 平面裁切後才換成螢幕座標
    function P(f, l, u) { return { f: f, l: l, u: u, x: cx - l / f * F, y: hy - u / f * F }; }
    function proj(x, y, z) {
      var dx = x - view.x, dy = y - view.y;
      var fw = dx * ch + dy * sh, up = z - camZ + fw * slope;
      if (pitch) return P(fw * cp - up * spch, -dx * sh + dy * ch, fw * spch + up * cp);
      return P(fw, -dx * sh + dy * ch, up);
    }
    function cut(a, b) {
      var t = (CLIP - a.f) / (b.f - a.f);
      return P(CLIP, a.l + (b.l - a.l) * t, a.u + (b.u - a.u) * t);
    }
    // 多邊形對近平面裁切（只切掉鏡頭後面的部分，不整塊丟掉，近處才不會破洞）
    function poly(pts, col) {
      var out = [], n = pts.length;
      for (var i = 0; i < n; i++) {
        var a = pts[i], b = pts[(i + 1) % n], ina = a.f >= CLIP, inb = b.f >= CLIP;
        if (ina) out.push(a);
        if (ina !== inb) out.push(cut(a, b));
      }
      if (out.length < 3) return;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(out[0].x, out[0].y);
      for (i = 1; i < out.length; i++) ctx.lineTo(out[i].x, out[i].y);
      ctx.closePath(); ctx.fill();
    }
    function seg(a, b) {
      if (a.f < CLIP && b.f < CLIP) return;
      if (a.f < CLIP) a = cut(a, b); else if (b.f < CLIP) b = cut(a, b);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    function edge(j, off, dz) {
      var nx = -Math.sin(tr.h[j]), ny = Math.cos(tr.h[j]);
      return proj(tr.x[j] + nx * off, tr.y[j] + ny * off, tr.z[j] + (dz || 0));
    }
    function wallH(j) { return 5 + 2.5 * Math.sin(j * 0.045 + pc.ph[0]) + 1.5 * Math.sin(j * 0.11 + pc.ph[1]); }
    var hw = tr.w / 2;
    // 地形高度（相對路面）：off＝橫向位移（左正）
    function terrainZ(j, off) {
      var side = off >= 0 ? 1 : -1, a = Math.abs(off) - hw, code = sp[j];
      if (code === 3) return wallH(j) + 6;
      if (code === 4) return a < 1.6 ? 0 : -1.2 - (a - 1.6) * 0.8;
      if (tr.water && side === tr.water) return a < 3 ? 0 : -Math.min(2, (a - 3) * 0.3);
      if (side === pc.wall[j]) {
        if (a < 2.2) return 0;
        if (a < 3.2) return (a - 2.2) * wallH(j);
        return wallH(j) + (a - 3.2) * 0.22;
      }
      return a < 1.6 ? 0 : -0.4 - (a - 1.6) * 0.38;
    }

    // ---- 天空 ----
    var g = ctx.createLinearGradient(0, 0, 0, Math.max(10, hz));
    g.addColorStop(0, skyC[0]); g.addColorStop(1, skyC[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, Math.max(0, hz) + 2);
    function azX(az) {
      var d = Math.atan2(Math.sin(az - view.h), Math.cos(az - view.h));
      if (Math.abs(d) > 1.3) return null;
      return cx - Math.tan(d) * F;
    }
    if (!tr.rain) {
      var sx = azX(pc.sunAz);
      if (sx !== null) {
        var sy = hz - (season === "autumn" || season === "winter" ? 0.12 : 0.3) * F;
        var sg = ctx.createRadialGradient(sx, sy, 2, sx, sy, F * 0.25);
        sg.addColorStop(0, "rgba(255,250,225,0.95)"); sg.addColorStop(0.12, "rgba(255,244,200,0.6)"); sg.addColorStop(1, "rgba(255,240,200,0)");
        ctx.fillStyle = sg; ctx.fillRect(sx - F * 0.25, sy - F * 0.25, F * 0.5, F * 0.5);
      }
    }
    pc.clouds.forEach(function (c) {
      var x = azX(c.az);
      if (x === null) return;
      var y = hz - Math.tan(c.el) * F, w = c.w * F;
      ctx.fillStyle = tr.rain ? "rgba(90,98,105,0.55)" : "rgba(255,255,255,0.75)";
      for (var p = 0; p < c.puff; p++) {
        ctx.beginPath();
        ctx.ellipse(x + (p - c.puff / 2) * w * 0.35, y - Math.sin(p * 1.7) * w * 0.08, w * 0.3, w * 0.13, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 兩層遠山：高度是世界方位的函數，所以轉彎時會正確平移
    function ridge(col, amp, freq, ph, base, cap) {
      var gg = ctx.createLinearGradient(0, hz - (base + amp) * F, 0, hz);
      if (cap) { gg.addColorStop(0, "#f4f7fa"); gg.addColorStop(0.3, col); } else gg.addColorStop(0, col);
      gg.addColorStop(1, tint(col, 0.04, fog, 0.35));
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.moveTo(0, hz + 2);
      for (var px = 0; px <= W + 16; px += 16) {
        var u = (view.h + Math.atan((cx - px) / F)) * freq;
        var hgt = base + amp * (0.55 * Math.sin(u + ph) + 0.3 * Math.sin(u * 2.7 + ph * 2) + 0.15 * Math.sin(u * 6.1 + ph * 3));
        ctx.lineTo(px, hz - Math.max(0, hgt) * F);
      }
      ctx.lineTo(W, hz + 2); ctx.closePath(); ctx.fill();
    }
    ridge(tr.rain ? FAR_MT.rain : FAR_MT[season], 0.08, 3, pc.ph[2], 0.06, season === "winter" || season === "spring");
    if (tr.scene !== "sea") ridge(tr.rain ? HILL.rain : HILL[season], 0.05, 5, pc.ph[3], 0.025, season === "winter");
    // 地平線以下的底色（被遠方的霧蓋住的地面）
    ctx.fillStyle = tint(pal.ground, -0.05, fog, 0.6);
    ctx.fillRect(0, hz, W, H - hz);
    if (sp[i0] === 3 && (!ext || camZ < tr.z[i0] + 5)) { ctx.fillStyle = "#1c1c1d"; ctx.fillRect(0, 0, W, H); }


    // ---- 看板：依所在列分桶，畫完那一列的路面才畫 ----
    var jMax = Math.min(tr.N - 2, i0 + Math.round(VIEW / ds));
    // 看板的範圍：車內只看前方；外部鏡頭前後都畫
    var sLo = ext ? Math.max(0, i0 - Math.round((cam.back || 160) / ds)) : i0;
    var nRows = jMax - sLo + 1;
    var buckets = [];
    function addSprite(j, s) {
      var k = j - sLo;
      if (k < 0 || k >= nRows) return;
      (buckets[k] = buckets[k] || []).push(s);
    }
    o.trees.forEach(function (t) {
      if (t.j === undefined || t.j < sLo || t.j > jMax) return;
      var p = proj(t.x, t.y, tr.z[t.j] + terrainZ(t.j, t.o));
      if (p.f > (ext ? 8 : 2) && p.f < VIEW) addSprite(t.j, { f: p.f, kind: "tree", p: p, t: t });   // 外部鏡頭：太近的樹會擋住整個畫面
    });
    // 地區景物（台灣：路邊攤、機車、霓虹、民眾、大看板）
    (o.decor || []).forEach(function (d) {
      if (d.j < sLo || d.j > jMax) return;
      var p = proj(d.x, d.y, tr.z[d.j] + terrainZ(d.j, d.off));
      if (p.f > (ext ? 7 : NEAR) && p.f < VIEW) addSprite(d.j, { f: p.f, kind: "decor", p: p, d: d });   // 外部鏡頭：太近的景物會擋畫面
    });
    var sJ = Math.round(tr.start / ds), fJ = Math.round(tr.finish / ds);
    for (var q = sLo + 1; q <= jMax; q++) {
      var code = sp[q];
      if (code === 3) continue;
      // 護欄柱：山谷側（橋上兩側）
      if (q % 2 === 0) {
        [1, -1].forEach(function (side) {
          if (code !== 4 && side === pc.wall[q] && !(tr.water && side === tr.water)) return;
          var p = edge(q, side * (hw + 1.1));
          if (p.f > NEAR) addSprite(q, { f: p.f, kind: "post", p: p });
        });
      }
      // 彎道指示牌：急彎的外側
      var kq = tr.k[q];
      if (Math.abs(kq) > 1 / 45 && q % 5 === 0) {
        var ps = edge(q, (kq > 0 ? -1 : 1) * (hw + 1.9), 0);
        if (ps.f > NEAR) addSprite(q, { f: ps.f, kind: "chev", p: ps, dir: kq > 0 ? 1 : -1 });
      }
      // 電線桿：山壁側，每 50 m（電線接到下一根）
      if (q % 25 === 0 && !code && !(tr.water && pc.wall[q] === tr.water)) {
        var ws = pc.wall[q];
        var pp = edge(q, ws * (hw + 2.4), 0);
        var nxt = q + 25 <= jMax ? edge(q + 25, pc.wall[q + 25] * (hw + 2.4), 9) : null;
        if (pp.f > NEAR) addSprite(q, { f: pp.f, kind: "pole", p: pp, top: edge(q, ws * (hw + 2.4), 9), next: nxt && nxt.f > NEAR ? nxt : null });
      }
      if (q === sJ || q === fJ) { var gp = edge(q, 0); if (gp.f > NEAR) addSprite(q, { f: gp.f, p: gp, kind: "gate", j: q, goal: q === fJ }); }
    }
    var flat = {};
    (race.items || []).forEach(function (it) {
      if (it.until !== undefined && race.t > it.until) return;
      var j = Math.floor(it.s / ds);
      if (j < sLo || j > jMax) return;
      if (it.kind === "boost" || it.kind === "oil" || it.kind === "mud" || it.kind === "ramp") { (flat[j] = flat[j] || []).push(it); return; }
      var p = edge(j, 0);
      if (p.f > NEAR && p.f < VIEW) addSprite(j, { f: p.f, kind: it.kind, p: p, j: j, it: it });
    });
    race.cars.forEach(function (c) {
      if (c === car && !ext || c.state === "dnf" && c.v < 0.1 && Math.abs(c.s - car.s) > 300) return;
      var ps = Core.carPose(race, c);
      var cj = clamp(Math.floor(c.s / ds), 0, tr.N - 1);
      var p = proj(ps.x, ps.y, tr.z[cj]);
      if (p.f > 1.2 && p.f < VIEW * (ext ? cam.zoom || 1 : 1)) addSprite(cj, { f: p.f, kind: "car", p: p, c: c, rel: ps.h - view.h });
    });

    function quad(a, b, c, d, col) { poly([a, b, c, d], col); }
    // 彎內側的地形不能伸得比彎道半徑還遠，否則相鄰兩列會交叉摺疊
    function reach(ja, side, off) {
      var k = Math.max(Math.abs(tr.k[ja]), Math.abs(tr.k[ja + 1]));
      if (k < 1e-4 || tr.k[ja] * side <= 0) return off;
      return Math.max(hw + 2.4, Math.min(off, 0.8 / k));
    }
    // 兩列之間、橫向 off1→off2 的地形面（off 取絕對值方向由 side 決定）
    function terr(ja, jb, side, o1, o2, col) {
      o2 = reach(ja, side, o2);
      if (o2 <= o1) return;
      var a1 = side * o1, a2 = side * o2;
      quad(edge(ja, a1, terrainZ(ja, a1)), edge(jb, a1, terrainZ(jb, a1)), edge(jb, a2, terrainZ(jb, a2)), edge(ja, a2, terrainZ(ja, a2)), col);
    }

    // ---- 由遠到近：每列一條帶（鏡頭後方幾列也畫，甩尾／打滑轉頭時才不會空白） ----
    var roadCol = tr.rain ? "#3d4246" : pal.road;
    if (!ext) {
      var jBack = Math.max(0, i0 - 12);
      for (var jj = jBack; jj < i0; jj++) strip(jj);
      for (var k = nRows - 2; k >= 0; k--) { strip(i0 + k); drawBucket(k); }
    } else {
      // 外部鏡頭：依離鏡頭的距離由遠到近（畫家演算法）
      var rows = [];
      for (var jr = sLo; jr < jMax; jr++) rows.push({ j: jr, d: (tr.x[jr] - view.x) * (tr.x[jr] - view.x) + (tr.y[jr] - view.y) * (tr.y[jr] - view.y) });
      rows.sort(function (a, b) { return b.d - a.d; });
      rows.forEach(function (r) { strip(r.j); drawBucket(r.j - sLo); });
    }

    function strip(ja) {
      var jb = ja + 1;
      var cA = edge(ja, 0), cB = edge(jb, 0);
      var fa = Math.max(cA.f, cB.f);
      var ft = fogT(Math.max(0, cA.f)), band = Math.floor(ja / 3) % 2, cd = sp[ja];
      var wl = pc.wall[ja];
      if (cd === 3 && ext && sp[i0] !== 3) {
        // 外部鏡頭在隧道外：隧道是一座山（頂＋兩側斜坡），看不到裡面
        quad(edge(ja, hw + 1.6), edge(jb, hw + 1.6), edge(jb, -hw - 1.6), edge(ja, -hw - 1.6), tint("#444648", 0, fog, ft));
        [1, -1].forEach(function (side) {
          terr(ja, jb, side, hw + 16, hw + 60, tint(pal.ground, band ? -0.06 : -0.1, fog, Math.min(0.9, ft + 0.15)));
          quad(edge(ja, side * (hw + 16), 0), edge(jb, side * (hw + 16), 0), edge(jb, side * (hw + 4), 12), edge(ja, side * (hw + 4), 12),
            tint(HILL[season], (side > 0 ? 0 : -0.06) + (band ? 0 : -0.03), fog, ft));
        });
        quad(edge(ja, hw + 4, 12), edge(jb, hw + 4, 12), edge(jb, -hw - 4, 12), edge(ja, -hw - 4, 12), tint(HILL[season], 0.04, fog, ft));
        if (sp[ja - 1] !== 3) portal(ja, ft);
        if (sp[jb] !== 3) portal(jb, ft);
        return;
      }
      if (cd === 3) {
        // 隧道：上方是山體，兩側牆、頂板、燈
        quad(edge(ja, hw + 9, 13), edge(jb, hw + 9, 13), edge(jb, -hw - 9, 13), edge(ja, -hw - 9, 13), tint(HILL[season], -0.05, fog, ft));
        quad(edge(ja, hw + 0.8, 0), edge(jb, hw + 0.8, 0), edge(jb, hw + 0.8, 5.4), edge(ja, hw + 0.8, 5.4), tint("#5a5a56", band ? 0 : -0.04, fog, ft * 0.3));
        quad(edge(ja, -hw - 0.8, 0), edge(jb, -hw - 0.8, 0), edge(jb, -hw - 0.8, 5.4), edge(ja, -hw - 0.8, 5.4), tint("#5a5a56", band ? -0.02 : -0.06, fog, ft * 0.3));
        quad(edge(ja, hw + 0.8, 5.4), edge(jb, hw + 0.8, 5.4), edge(jb, -hw - 0.8, 5.4), edge(ja, -hw - 0.8, 5.4), tint("#2c2c2b", 0, fog, ft * 0.2));
        quad(edge(ja, hw + 0.8, 0), edge(jb, hw + 0.8, 0), edge(jb, -hw - 0.8, 0), edge(ja, -hw - 0.8, 0), tint("#444648", band ? 0 : 0.03, fog, ft * 0.3));
        if (ja % 6 === 0) {
          [1, -1].forEach(function (side) {
            quad(edge(ja, side * (hw + 0.7), 5.0), edge(jb, side * (hw + 0.7), 5.0), edge(jb, side * (hw + 0.7), 5.3), edge(ja, side * (hw + 0.7), 5.3), "#ffd27a");
          });
        }
        laneLines(ja, jb, fa, ft, false);
        if (sp[ja - 1] !== 3 && (ja > i0 || ext)) portal(ja, ft);   // 入口（從外面看的洞口）
        return;
      }
      // 兩側地形
      [1, -1].forEach(function (side) {
        var isWater = tr.water && side === tr.water && cd !== 4;
        var isWall = cd !== 4 && !isWater && side === wl;
        if (isWall) {
          terr(ja, jb, side, hw + 3.2, hw + 40, tint(HILL[season], band ? 0 : -0.03, fog, ft));
          terr(ja, jb, side, hw + 2.2, hw + 3.2, tint(ROCK[season], band ? -0.02 : -0.08, fog, ft));
          terr(ja, jb, side, hw + 1.6, hw + 2.2, tint("#5c564a", 0, fog, ft));
        } else if (isWater && o.water) {
          var wf = reach(ja, side, hw + 450);
          quad(edge(ja, side * (hw + 9), -2.1), edge(jb, side * (hw + 9), -2.1), edge(jb, side * wf, -2.1), edge(ja, side * wf, -2.1),
            tint(o.water, Math.floor(ja / 2) % 3 === 0 ? 0.05 : 0, fog, Math.min(0.75, ft * 0.8)));
          terr(ja, jb, side, hw + 1.6, hw + 9.2, tint(season === "winter" ? "#e9eef2" : "#a89f86", band ? 0 : -0.04, fog, ft));
        } else {
          terr(ja, jb, side, hw + 1.6, hw + 130, tint(pal.ground, band ? -0.06 : -0.1, fog, Math.min(0.9, ft + 0.15)));
          if (cd === 4) quad(edge(ja, side * (hw + 1.6), 0), edge(jb, side * (hw + 1.6), 0), edge(jb, side * (hw + 1.6), -1.2), edge(ja, side * (hw + 1.6), -1.2), tint(CONCRETE, -0.15, fog, ft));
        }
      });
      // 日本冬天：路邊的雪牆（高低起伏，只在部分路段）
      if (o.snowWall && o.snowWall[ja] && cd !== 4) {
        var swh = o.snowWall[ja];
        [1, -1].forEach(function (side) {
          if (tr.water && side === tr.water) return;
          quad(edge(ja, side * (hw + 1.7), 0), edge(jb, side * (hw + 1.7), 0), edge(jb, side * (hw + 1.7), swh), edge(ja, side * (hw + 1.7), swh),
            tint("#dfe7ee", (band ? 0 : -0.03) + (side > 0 ? 0 : -0.04), fog, ft));
          quad(edge(ja, side * (hw + 1.7), swh), edge(jb, side * (hw + 1.7), swh), edge(jb, side * (hw + 3.2), swh + 0.3), edge(ja, side * (hw + 3.2), swh + 0.3),
            tint("#f7fafc", 0, fog, ft));
        });
      }
      // 路肩、路面（日本春秋：路肩鋪滿花瓣／落葉）
      quad(edge(ja, hw + 1.6), edge(jb, hw + 1.6), edge(jb, -hw - 1.6), edge(ja, -hw - 1.6), tint(cd === 4 ? CONCRETE : o.shoulder || pal.shoulder, band ? 0 : -0.07, fog, ft));
      var rl = edge(ja, hw), rr = edge(ja, -hw), bl = edge(jb, hw), br = edge(jb, -hw);
      quad(rl, bl, br, rr, tint(cd === 1 ? "#9b8565" : roadCol, band ? 0 : 0.04, fog, ft));
      if (tr.surf[ja] < 1 && cd !== 1) {
        var kind = "leaf";
        for (var p = 0; p < tr.patches.length; p++) if (ja >= tr.patches[p].a && ja <= tr.patches[p].b) { kind = tr.patches[p].kind; break; }
        quad(rl, bl, br, rr, o.patchColor[kind]);
      }
      // 胎痕：急彎的行車線上
      if (Math.abs(tr.k[ja]) > 1 / 35 && cd !== 1) {
        [0.75, -0.75].forEach(function (d) {
          var off = tr.off[ja] + d;
          quad(edge(ja, off + 0.12), edge(jb, off + 0.12), edge(jb, off - 0.12), edge(ja, off - 0.12), "rgba(20,20,20,0.18)");
        });
      }
      // 溝落：彎內側的排水溝
      if (cd === 2) {
        var ins = tr.k[ja] >= 0 ? 1 : -1;
        quad(edge(ja, ins * hw), edge(jb, ins * hw), edge(jb, ins * (hw - 0.45), -0.12), edge(ja, ins * (hw - 0.45), -0.12), tint("#2f3a2c", 0, fog, ft));
      }
      laneLines(ja, jb, fa, ft, cd === 1);
      (flat[ja] || []).forEach(function (it) {
        var len = it.kind === "boost" || it.kind === "ramp" ? 4 : 6, w = it.kind === "boost" || it.kind === "ramp" ? hw * 0.85 : hw * 0.75;
        var a1 = edge(ja, w), a2 = edge(ja, -w), b1 = edge(jb + Math.round(len / ds) - 1, w), b2 = edge(jb + Math.round(len / ds) - 1, -w);
        if (it.kind === "boost") {
          quad(a1, b1, b2, a2, tint("#ffb020", 0, fog, ft));
          var m1 = edge(ja + 1, w * 0.9), m2 = edge(ja + 1, -w * 0.9), tip = edge(jb + 1, 0);
          poly([m1, tip, m2], tint("#fff27a", 0, fog, ft));
        } else if (it.kind === "ramp") {
          // 跳台：灰色斜板＋黃黑警示條
          quad(edge(ja, w, 0), edge(jb + 1, w, 0.5), edge(jb + 1, -w, 0.5), edge(ja, -w, 0), tint("#8d949b", 0, fog, ft));
          quad(edge(jb + 1, w, 0.5), edge(jb + 1, w, 0.62), edge(jb + 1, -w, 0.62), edge(jb + 1, -w, 0.5), tint("#ffd23a", 0, fog, ft));
        } else if (it.kind === "mud") quad(a1, b1, b2, a2, "rgba(98,70,40," + (0.85 * (1 - ft)).toFixed(2) + ")");
        else quad(a1, b1, b2, a2, "rgba(15,15,20," + (0.8 * (1 - ft)).toFixed(2) + ")");

      });
      // 護欄（山谷、水邊；橋上兩側）
      [1, -1].forEach(function (side) {
        if (cd !== 4 && side === wl && !(tr.water && side === tr.water)) return;
        quad(edge(ja, side * (hw + 1.1), 0.5), edge(jb, side * (hw + 1.1), 0.5), edge(jb, side * (hw + 1.1), 0.82), edge(ja, side * (hw + 1.1), 0.82),
          tint("#d4d8dc", band ? 0 : -0.1, fog, ft));
      });
    }

    function laneLines(ja, jb, fa, ft, gravel) {
      if (gravel) return;
      ctx.strokeStyle = tint(pal.line, 0, fog, ft); ctx.lineWidth = clamp(0.15 / Math.max(0.5, fa) * F, 0.6, 6);
      ctx.beginPath();
      seg(edge(ja, hw - 0.25), edge(jb, hw - 0.25)); seg(edge(ja, -hw + 0.25), edge(jb, -hw + 0.25));
      ctx.stroke();
      if (Math.floor(ja / 2) % 3 === 0) {
        ctx.strokeStyle = tint("#f0c83c", 0, fog, ft);
        ctx.beginPath(); seg(edge(ja, 0), edge(jb, 0)); ctx.stroke();
      }
    }
    function portal(j, ft) {
      var pts = [edge(j, hw + 9, 0), edge(j, hw + 9, 10), edge(j, -hw - 9, 10), edge(j, -hw - 9, 0)];
      var hole = [edge(j, hw + 0.8, 0), edge(j, hw + 0.8, 5.4), edge(j, -hw - 0.8, 5.4), edge(j, -hw - 0.8, 0)];
      if (pts.concat(hole).some(function (p) { return p.f < NEAR; })) return;
      if (ext) {
        ctx.fillStyle = "#151516"; ctx.beginPath();
        hole.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.fill();
      }

      ctx.fillStyle = tint(CONCRETE, -0.05, fog, ft);
      ctx.beginPath();
      pts.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath();
      hole.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath();
      ctx.fill("evenodd");
    }

    function drawBucket(k) {
      var list = buckets[k];
      if (!list) return;
      list.sort(function (a, b) { return b.f - a.f; });
      list.forEach(drawSprite);
    }
    function drawSprite(s) {
      var sc = F / s.f, p = s.p, ft = fogT(s.f);
      if (p.x < -400 || p.x > W + 400) return;
      if (s.kind === "tree") drawTree(p, sc, s.t, ft);
      else if (s.kind === "post") {
        ctx.fillStyle = tint("#e2e5e8", 0, fog, ft); ctx.fillRect(p.x - 0.07 * sc, p.y - 0.85 * sc, Math.max(1, 0.14 * sc), 0.85 * sc);
      } else if (s.kind === "chev") {
        var w = 0.75 * sc, hgt = 0.55 * sc, y0 = p.y - 1.5 * sc;
        ctx.fillStyle = tint("#d8dbde", 0, fog, ft); ctx.fillRect(p.x - 0.04 * sc, y0, Math.max(1, 0.08 * sc), 1.5 * sc);
        ctx.fillStyle = tint("#f2c230", 0, fog, ft); ctx.fillRect(p.x - w / 2, y0 - hgt / 2, w, hgt);
        if (sc > 3) {
          // 箭頭指向彎的方向（左彎＝畫面左）
          var d = -s.dir;
          ctx.strokeStyle = tint("#151515", 0, fog, ft); ctx.lineWidth = Math.max(1, 0.1 * sc);
          ctx.beginPath(); ctx.moveTo(p.x - d * w * 0.18, y0 - hgt * 0.32); ctx.lineTo(p.x + d * w * 0.18, y0); ctx.lineTo(p.x - d * w * 0.18, y0 + hgt * 0.32); ctx.stroke();
        }
      } else if (s.kind === "pole") {
        var top = s.top;
        ctx.strokeStyle = tint("#6b5b4a", 0, fog, ft); ctx.lineWidth = Math.max(1, 0.25 * sc);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(top.x, top.y); ctx.stroke();
        ctx.lineWidth = Math.max(1, 0.12 * sc);
        ctx.beginPath(); ctx.moveTo(top.x - 0.9 * sc, top.y + 0.5 * sc); ctx.lineTo(top.x + 0.9 * sc, top.y + 0.5 * sc); ctx.stroke();
        if (s.next) {
          ctx.strokeStyle = "rgba(30,30,30,0.5)"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(top.x, top.y + 0.5 * sc);
          ctx.quadraticCurveTo((top.x + s.next.x) / 2, (top.y + s.next.y) / 2 + 0.6 * sc, s.next.x, s.next.y + 0.5 * F / s.next.f);
          ctx.stroke();
        }
      } else if (s.kind === "gate") {
        var L = edge(s.j, hw + 1.2), R = edge(s.j, -hw - 1.2), Lt = edge(s.j, hw + 1.2, 5.5), Rt = edge(s.j, -hw - 1.2, 5.5);
        if (L.f < NEAR || R.f < NEAR) return;
        ctx.strokeStyle = tint("#cfd3d6", 0, fog, ft); ctx.lineWidth = Math.max(2, 0.3 * sc);
        ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(Lt.x, Lt.y); ctx.moveTo(R.x, R.y); ctx.lineTo(Rt.x, Rt.y); ctx.stroke();
        var bh = 1.2 * sc;
        ctx.fillStyle = s.goal ? "#111" : "#d33a2c";
        ctx.beginPath(); ctx.moveTo(Lt.x, Lt.y); ctx.lineTo(Rt.x, Rt.y); ctx.lineTo(Rt.x, Rt.y - bh); ctx.lineTo(Lt.x, Lt.y - bh); ctx.closePath(); ctx.fill();
        if (bh > 8) {
          ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "bold " + Math.round(bh * 0.7) + "px sans-serif";
          ctx.fillText(s.goal ? "GOAL" : "START", (Lt.x + Rt.x) / 2, (Lt.y + Rt.y) / 2 - bh * 0.22);
        }
      } else if (s.kind === "car") drawCar(p, sc, s);
      else if (s.kind === "decor") drawDecor(p, sc, s.d, ft);
      else if (s.kind === "rock") {
        [[0.3, 0.9, 0.9], [-0.9, 0.6, 0.7], [1.6, 0.5, 0.5], [-1.8, 0.45, 0.55]].forEach(function (r, n) {
          ctx.fillStyle = tint(n % 2 ? "#6f6a63" : "#8a857c", 0, fog, ft);
          ctx.beginPath(); ctx.ellipse(p.x - r[0] * sc, p.y - r[2] * 0.6 * sc, r[2] * sc, r[2] * 0.7 * sc, 0, 0, Math.PI * 2); ctx.fill();
        });
      } else if (s.kind === "box") {
        [-hw * 0.5, hw * 0.5].forEach(function (o, n) {
          var bp = edge(s.j, o, 1.2 + Math.sin(race.t * 3 + n) * 0.2);
          if (bp.f < NEAR) return;
          var bs = 0.8 * F / bp.f;
          ctx.fillStyle = "hsl(" + Math.round((race.t * 120 + n * 90) % 360) + ",85%,55%)";
          ctx.fillRect(bp.x - bs, bp.y - bs, bs * 2, bs * 2);
          ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(1, bs * 0.12); ctx.strokeRect(bp.x - bs, bp.y - bs, bs * 2, bs * 2);
          if (bs > 6) { ctx.fillStyle = "#fff"; ctx.font = "bold " + Math.round(bs * 1.4) + "px sans-serif"; ctx.textAlign = "center"; ctx.fillText("?", bp.x, bp.y + bs * 0.5); }
        });
      }
    }
    function drawTree(p, sc, t, ft) {
      // 夏冬以杉木為主；春秋多是櫻花／楓樹，夾一些常綠樹
      var conifer = season === "summer" || season === "winter" ? t.kind < 0.7 : t.kind < 0.25;
      var r = t.r;
      if (conifer) {
        var hgt = r * 3.4;
        var base = season === "spring" || season === "autumn" ? "#3d6b3a" : t.c;
        ctx.fillStyle = tint("#4a3826", 0, fog, ft); ctx.fillRect(p.x - 0.18 * sc, p.y - 1.2 * sc, 0.36 * sc, 1.2 * sc);
        for (var l = 0; l < 3; l++) {
          var y1 = p.y - (0.8 + l * hgt * 0.26) * sc, y2 = y1 - hgt * 0.45 * sc, wd = r * (1.05 - l * 0.25) * sc;
          ctx.fillStyle = tint(base, -0.03 * l, fog, ft);
          ctx.beginPath(); ctx.moveTo(p.x - wd, y1); ctx.lineTo(p.x, y2); ctx.lineTo(p.x + wd, y1); ctx.closePath(); ctx.fill();
          ctx.fillStyle = tint(base, 0.06, fog, ft);
          ctx.beginPath(); ctx.moveTo(p.x - wd, y1); ctx.lineTo(p.x, y2); ctx.lineTo(p.x - wd * 0.2, y1); ctx.closePath(); ctx.fill();
          if (season === "winter") {
            ctx.fillStyle = tint("#f4f7fa", 0, fog, ft * 0.5);
            ctx.beginPath(); ctx.moveTo(p.x - wd * 0.35, y2 + (y1 - y2) * 0.35); ctx.lineTo(p.x, y2); ctx.lineTo(p.x + wd * 0.35, y2 + (y1 - y2) * 0.35); ctx.closePath(); ctx.fill();
          }
        }
      } else {
        ctx.fillStyle = tint("#5b4330", 0, fog, ft); ctx.fillRect(p.x - 0.2 * sc, p.y - 2.3 * sc, 0.4 * sc, 2.3 * sc);
        var cy = p.y - (2 + r) * sc;
        [[0, 0, 1, 0], [-0.55, 0.25, 0.7, -0.05], [0.55, 0.2, 0.72, -0.05], [0.1, -0.45, 0.68, 0.07]].forEach(function (b) {
          ctx.fillStyle = tint(t.c, b[3], fog, ft);
          ctx.beginPath(); ctx.arc(p.x + b[0] * r * sc, cy + b[1] * r * sc, b[2] * r * sc, 0, Math.PI * 2); ctx.fill();
        });
        if (season === "winter") {
          ctx.fillStyle = tint("#f4f7fa", 0, fog, ft * 0.5);
          ctx.beginPath(); ctx.ellipse(p.x, cy - r * 0.6 * sc, r * 0.7 * sc, r * 0.25 * sc, 0, Math.PI, 0); ctx.fill();
        }
      }
    }
    function drawCar(p, sc, s) {
      var side = Math.abs(Math.sin(s.rel)), front = Math.cos(s.rel) < -0.2;
      var cw = 1.8 + side * 2.6, chh = 1.3;
      ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(p.x - cw / 2 * sc, p.y - 0.15 * sc, cw * sc, 0.3 * sc);
      if (ext && (side > 0.55 || front)) { drawCarExt(p, sc, s, cw, chh, side, front); return; }
      ctx.fillStyle = "#111";
      ctx.fillRect(p.x - cw * 0.45 * sc, p.y - 0.4 * sc, cw * 0.18 * sc, 0.4 * sc); ctx.fillRect(p.x + cw * 0.27 * sc, p.y - 0.4 * sc, cw * 0.18 * sc, 0.4 * sc);
      ctx.fillStyle = s.c.color; ctx.fillRect(p.x - cw / 2 * sc, p.y - chh * 0.85 * sc, cw * sc, chh * 0.6 * sc);
      ctx.fillStyle = shade(s.c.color, -0.12);
      ctx.beginPath();
      ctx.moveTo(p.x - cw * 0.42 * sc, p.y - chh * 0.85 * sc); ctx.lineTo(p.x - cw * 0.3 * sc, p.y - chh * 1.25 * sc);
      ctx.lineTo(p.x + cw * 0.3 * sc, p.y - chh * 1.25 * sc); ctx.lineTo(p.x + cw * 0.42 * sc, p.y - chh * 0.85 * sc); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(20,30,40,0.85)"; ctx.fillRect(p.x - cw * 0.28 * sc, p.y - chh * 1.18 * sc, cw * 0.56 * sc, chh * 0.28 * sc);
      ctx.fillStyle = s.c.braking ? "#ff2a2a" : "#8a1a1a";
      ctx.fillRect(p.x - cw * 0.48 * sc, p.y - chh * 0.72 * sc, cw * 0.16 * sc, chh * 0.12 * sc);
      ctx.fillRect(p.x + cw * 0.32 * sc, p.y - chh * 0.72 * sc, cw * 0.16 * sc, chh * 0.12 * sc);
      if (s.c.braking && sc > 2) {
        var gl = ctx.createRadialGradient(p.x, p.y - chh * 0.66 * sc, 1, p.x, p.y - chh * 0.66 * sc, cw * 0.8 * sc);
        gl.addColorStop(0, "rgba(255,40,40,0.25)"); gl.addColorStop(1, "rgba(255,40,40,0)");
        ctx.fillStyle = gl; ctx.fillRect(p.x - cw * sc, p.y - chh * 1.5 * sc, cw * 2 * sc, chh * 1.5 * sc);
      }
      if (s.f < 120) {
        ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#fff";
        ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 3;
        ctx.strokeText(s.c.name, p.x, p.y - chh * 1.25 * sc - 6); ctx.fillText(s.c.name, p.x, p.y - chh * 1.25 * sc - 6);
      }
    }

    // ---- 台灣的路邊景物（p＝地面點，sc＝每公尺幾像素） ----
    function box(x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }
    function label(txt, x, y, size, col, vertical) {
      if (size < 7) return;
      ctx.fillStyle = col; ctx.font = "bold " + Math.round(size) + "px sans-serif"; ctx.textAlign = "center";
      if (!vertical) { ctx.fillText(txt, x, y); return; }
      for (var i = 0; i < txt.length; i++) ctx.fillText(txt[i], x, y + i * size * 1.05);
    }
    function drawDecor(p, sc, d, ft) {
      var t = race.t, x = p.x, y = p.y;
      if (sc < 0.6) return;
      ctx.save();
      if (ft > 0.05) ctx.globalAlpha = 1 - ft * 0.85;
      if (d.kind === "stall") {
        var w = 2.6 * sc, h = 2.3 * sc;
        box(x - w / 2, y - h, Math.max(1, 0.08 * sc), h, "#6b6f74"); box(x + w / 2 - 0.08 * sc, y - h, Math.max(1, 0.08 * sc), h, "#6b6f74");
        box(x - w * 0.45, y - 0.95 * sc, w * 0.9, 0.95 * sc, "#c9b48a");
        box(x - w * 0.45, y - 0.95 * sc, w * 0.9, 0.12 * sc, "#8a6d45");
        // 篷子：條紋
        var n = 6;
        for (var k = 0; k < n; k++) {
          ctx.fillStyle = k % 2 ? "#ffffff" : d.c;
          ctx.beginPath();
          var x0 = x - w * 0.6 + k * w * 1.2 / n, x1 = x0 + w * 1.2 / n;
          ctx.moveTo(x0, y - h); ctx.lineTo(x1, y - h); ctx.lineTo(x - w * 0.3 + (k + 1) * w * 0.6 / n, y - h - 0.55 * sc); ctx.lineTo(x - w * 0.3 + k * w * 0.6 / n, y - h - 0.55 * sc); ctx.closePath(); ctx.fill();
        }
        box(x - w * 0.42, y - h + 0.02 * sc, w * 0.84, 0.48 * sc, "#c0262d");
        label(d.txt, x, y - h + 0.4 * sc, 0.38 * sc, "#fff3a8");
        if (sc > 5) {
          ctx.fillStyle = Math.floor(t * 3 + d.ph) % 2 ? "#ffe680" : "#fff7c9";
          for (var b = 0; b < 7; b++) { ctx.beginPath(); ctx.arc(x - w * 0.55 + b * w * 1.1 / 6, y - h + 0.05 * sc, 0.07 * sc, 0, Math.PI * 2); ctx.fill(); }
          // 熱氣
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          for (var q = 0; q < 3; q++) {
            var ph = (t * 0.6 + q / 3 + d.ph) % 1;
            ctx.beginPath(); ctx.arc(x - w * 0.15 + q * 0.3 * sc + Math.sin(ph * 6) * 0.1 * sc, y - (1.0 + ph * 1.1) * sc, (0.12 + ph * 0.18) * sc, 0, Math.PI * 2); ctx.fill();
          }
        }
      } else if (d.kind === "scooter") {
        var L = 1.8 * sc * (0.55 + 0.45 * Math.abs(Math.cos(d.ang))), r = 0.27 * sc;
        ctx.fillStyle = "#151515";
        ctx.beginPath(); ctx.arc(x - L * 0.36, y - r, r, 0, Math.PI * 2); ctx.arc(x + L * 0.36, y - r, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = d.c;
        ctx.beginPath(); ctx.moveTo(x - L * 0.5, y - 0.45 * sc); ctx.lineTo(x - L * 0.45, y - 0.85 * sc); ctx.lineTo(x + L * 0.05, y - 0.8 * sc);
        ctx.lineTo(x + L * 0.25, y - 0.5 * sc); ctx.lineTo(x + L * 0.35, y - 1.15 * sc); ctx.lineTo(x + L * 0.45, y - 1.15 * sc); ctx.lineTo(x + L * 0.42, y - 0.4 * sc); ctx.closePath(); ctx.fill();
        box(x - L * 0.42, y - 0.97 * sc, L * 0.42, 0.14 * sc, "#222");
        ctx.strokeStyle = "#333"; ctx.lineWidth = Math.max(1, 0.06 * sc);
        ctx.beginPath(); ctx.moveTo(x + L * 0.3, y - 1.25 * sc); ctx.lineTo(x + L * 0.5, y - 1.2 * sc); ctx.stroke();
        if (d.helmet) { ctx.fillStyle = d.helmet; ctx.beginPath(); ctx.arc(x - L * 0.15, y - 1.08 * sc, 0.16 * sc, Math.PI, 0); ctx.fill(); }
      } else if (d.kind === "billboard") {
        var bw = d.w * sc, bh = 3 * sc, top = y - d.hgt * sc;
        box(x - bw * 0.3, top + bh, Math.max(1, 0.25 * sc), d.hgt * sc - bh, "#5e6266");
        box(x + bw * 0.3 - 0.25 * sc, top + bh, Math.max(1, 0.25 * sc), d.hgt * sc - bh, "#5e6266");
        box(x - bw / 2 - 0.12 * sc, top - 0.12 * sc, bw + 0.24 * sc, bh + 0.24 * sc, "#e8e8e8");
        box(x - bw / 2, top, bw, bh, d.bg);
        if (d.face) {
          // 選舉看板：抽象的候選人剪影＋號碼（虛構）
          ctx.fillStyle = "#f2d2b6"; ctx.beginPath(); ctx.arc(x - bw * 0.3, top + bh * 0.42, bh * 0.24, 0, Math.PI * 2); ctx.fill();
          box(x - bw * 0.42, top + bh * 0.66, bw * 0.24, bh * 0.34, "#1f3f8f");
          label(d.txt, x + bw * 0.12, top + bh * 0.52, Math.min(bh * 0.42, bw * 0.55 / Math.max(2, d.txt.length)), "#fff");
          label(d.sub, x + bw * 0.12, top + bh * 0.85, Math.min(bh * 0.2, bw * 0.55 / Math.max(3, d.sub.length)), "#ffe14d");
        } else {
          label(d.txt, x, top + bh * 0.58, Math.min(bh * 0.46, bw * 0.92 / Math.max(2, d.txt.length)), d.fg);
          label(d.sub, x, top + bh * 0.9, Math.min(bh * 0.22, bw * 0.9 / Math.max(3, d.sub.length)), d.fg);
        }
      } else if (d.kind === "neon") {
        var nw = 0.9 * sc, nh = 0.75 * sc * d.txt.length + 0.4 * sc, nt = y - 1.2 * sc - nh;
        box(x - 0.05 * sc, nt + nh, Math.max(1, 0.1 * sc), 1.2 * sc, "#4a4a4a");
        box(x - nw / 2, nt, nw, nh, "#1a1420");
        var on = Math.sin(t * 9 + d.ph * 7) > -0.85;
        ctx.strokeStyle = on ? d.c : "#3a2a3a"; ctx.lineWidth = Math.max(1, 0.08 * sc);
        ctx.strokeRect(x - nw / 2 + 0.06 * sc, nt + 0.06 * sc, nw - 0.12 * sc, nh - 0.12 * sc);
        if (on && sc > 3) { ctx.shadowColor = d.c; ctx.shadowBlur = Math.min(18, 0.5 * sc); }
        label(d.txt, x, nt + 0.25 * sc + 0.55 * sc, 0.6 * sc, on ? d.c : "#4a3a4a", true);
        ctx.shadowBlur = 0;
      } else if (d.kind === "person") drawPerson(x, y, sc, d, t);
      ctx.restore();
    }
    function drawPerson(x, y, sc, d, t) {
      var u = sc, ph = d.ph * 6;
      if (u < 2) { box(x - 0.2 * u, y - 1.6 * u, 0.4 * u, 1.6 * u, d.c); return; }
      var head = "#f0c9a5";
      if (d.type === "dog") {
        var wag = Math.sin(t * 14 + ph) * 0.15 * u;
        box(x - 0.45 * u, y - 0.6 * u, 0.9 * u, 0.32 * u, "#a8743f");
        box(x - 0.4 * u, y - 0.3 * u, 0.1 * u, 0.3 * u, "#8e5f31"); box(x + 0.3 * u, y - 0.3 * u, 0.1 * u, 0.3 * u, "#8e5f31");
        box(x + 0.35 * u, y - 0.85 * u, 0.3 * u, 0.3 * u, "#a8743f");
        ctx.strokeStyle = "#8e5f31"; ctx.lineWidth = Math.max(1, 0.07 * u);
        ctx.beginPath(); ctx.moveTo(x - 0.45 * u, y - 0.55 * u); ctx.lineTo(x - 0.7 * u, y - 0.8 * u + wag); ctx.stroke();
        return;
      }
      if (d.type === "santaizi") {
        // 電音三太子：大頭、搖擺跳舞
        var sway = Math.sin(t * 6 + ph) * 0.25, bounce = Math.abs(Math.sin(t * 6 + ph)) * 0.25 * u;
        ctx.save(); ctx.translate(x, y - bounce); ctx.rotate(sway);
        box(-0.35 * u, -1.3 * u, 0.7 * u, 1.3 * u, "#d8342c");
        box(-0.35 * u, -1.0 * u, 0.7 * u, 0.18 * u, "#f5c518");
        ctx.strokeStyle = "#d8342c"; ctx.lineWidth = Math.max(1, 0.16 * u);
        ctx.beginPath(); ctx.moveTo(-0.3 * u, -1.15 * u); ctx.lineTo(-0.75 * u, -1.6 * u - Math.sin(t * 12) * 0.2 * u);
        ctx.moveTo(0.3 * u, -1.15 * u); ctx.lineTo(0.75 * u, -1.6 * u + Math.sin(t * 12) * 0.2 * u); ctx.stroke();
        ctx.fillStyle = "#fbe3d0"; ctx.beginPath(); ctx.arc(0, -1.85 * u, 0.55 * u, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(0, -2.1 * u, 0.5 * u, Math.PI, 0); ctx.fill();
        ctx.fillStyle = "#f5c518"; box(-0.2 * u, -2.5 * u, 0.4 * u, 0.22 * u, "#f5c518");
        ctx.fillStyle = "#e85a6a"; ctx.beginPath(); ctx.arc(-0.28 * u, -1.72 * u, 0.1 * u, 0, Math.PI * 2); ctx.arc(0.28 * u, -1.72 * u, 0.1 * u, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#111"; ctx.fillRect(-0.32 * u, -1.98 * u, 0.22 * u, 0.1 * u); ctx.fillRect(0.1 * u, -1.98 * u, 0.22 * u, 0.1 * u);
        ctx.restore();
        return;
      }
      var hop = d.type === "dancer" ? Math.abs(Math.sin(t * 7 + ph)) * 0.3 * u : 0;
      var by = y - hop;
      // 腳（藍白拖）
      box(x - 0.2 * u, by - 0.8 * u, 0.13 * u, 0.8 * u, head); box(x + 0.07 * u, by - 0.8 * u, 0.13 * u, 0.8 * u, head);
      box(x - 0.25 * u, by - 0.06 * u, 0.2 * u, 0.06 * u, "#2a5bd7"); box(x + 0.05 * u, by - 0.06 * u, 0.2 * u, 0.06 * u, "#2a5bd7");
      box(x - 0.24 * u, by - 0.95 * u, 0.48 * u, 0.3 * u, d.type === "auntie" ? d.c : "#2c3e64");   // 短褲／裙
      box(x - 0.24 * u, by - 1.45 * u, 0.48 * u, 0.55 * u, d.type === "uncle" ? "#f4f4f0" : d.c);  // 上衣（阿伯是白色吊嘎）
      if (d.type === "auntie") { ctx.fillStyle = "#fff"; for (var f2 = 0; f2 < 4; f2++) { ctx.beginPath(); ctx.arc(x - 0.15 * u + (f2 % 2) * 0.28 * u, by - 1.3 * u + Math.floor(f2 / 2) * 0.35 * u, 0.05 * u, 0, Math.PI * 2); ctx.fill(); } }
      ctx.fillStyle = head; ctx.beginPath(); ctx.arc(x, by - 1.62 * u, 0.17 * u, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = head; ctx.lineWidth = Math.max(1, 0.1 * u); ctx.beginPath();
      var wave = Math.sin(t * 8 + ph);
      if (d.type === "uncle" || d.type === "flag") { ctx.moveTo(x + 0.24 * u, by - 1.4 * u); ctx.lineTo(x + (0.45 + wave * 0.15) * u, by - 1.95 * u); }
      else if (d.type === "phone") { ctx.moveTo(x + 0.24 * u, by - 1.4 * u); ctx.lineTo(x + 0.3 * u, by - 1.9 * u); }
      else if (d.type === "dancer") { ctx.moveTo(x - 0.24 * u, by - 1.4 * u); ctx.lineTo(x - (0.5 + wave * 0.2) * u, by - 1.9 * u); ctx.moveTo(x + 0.24 * u, by - 1.4 * u); ctx.lineTo(x + (0.5 - wave * 0.2) * u, by - 1.9 * u); }
      else { ctx.moveTo(x + 0.24 * u, by - 1.4 * u); ctx.lineTo(x + 0.3 * u, by - 0.95 * u); }
      ctx.moveTo(x - 0.24 * u, by - 1.4 * u); ctx.lineTo(x - 0.3 * u, by - 0.95 * u); ctx.stroke();
      if (d.type === "phone") { box(x + 0.22 * u, by - 2.15 * u, 0.16 * u, 0.26 * u, "#222"); box(x + 0.24 * u, by - 2.13 * u, 0.12 * u, 0.2 * u, "#9fd8ff"); }
      if (d.type === "flag") {
        var fx = x + (0.45 + wave * 0.15) * u, fy = by - 1.95 * u;
        ctx.strokeStyle = "#555"; ctx.lineWidth = Math.max(1, 0.04 * u); ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 1.0 * u); ctx.stroke();
        ctx.fillStyle = d.c2; ctx.beginPath(); ctx.moveTo(fx, fy - 1.0 * u); ctx.lineTo(fx + (0.8 + Math.sin(t * 10) * 0.1) * u, fy - 0.8 * u); ctx.lineTo(fx, fy - 0.55 * u); ctx.closePath(); ctx.fill();
      }
      if (d.type === "auntie") {
        // 阿嬤的傘
        ctx.strokeStyle = "#555"; ctx.lineWidth = Math.max(1, 0.04 * u); ctx.beginPath(); ctx.moveTo(x + 0.3 * u, by - 0.95 * u); ctx.lineTo(x + 0.3 * u, by - 2.1 * u); ctx.stroke();
        ctx.fillStyle = d.c2; ctx.beginPath(); ctx.arc(x + 0.3 * u, by - 2.1 * u, 0.6 * u, Math.PI, 0); ctx.fill();
      }
      if (d.type === "uncle") { ctx.fillStyle = "#555"; ctx.beginPath(); ctx.arc(x, by - 1.7 * u, 0.17 * u, Math.PI, 0); ctx.fill(); }
    }

    // 外部鏡頭看到的車：側面（車身＋兩個輪子＋車窗）或正面（頭燈）

    function drawCarExt(p, sc, s, cw, chh, side, front) {
      var col = s.c.color;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(p.x - cw / 2 * sc, p.y - 0.3 * sc); ctx.lineTo(p.x - cw / 2 * sc, p.y - chh * 0.8 * sc);
      ctx.lineTo(p.x + cw / 2 * sc, p.y - chh * 0.8 * sc); ctx.lineTo(p.x + cw / 2 * sc, p.y - 0.3 * sc); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(col, -0.1);
      ctx.beginPath();
      ctx.moveTo(p.x - cw * 0.3 * sc, p.y - chh * 0.8 * sc); ctx.lineTo(p.x - cw * 0.2 * sc, p.y - chh * 1.22 * sc);
      ctx.lineTo(p.x + cw * 0.2 * sc, p.y - chh * 1.22 * sc); ctx.lineTo(p.x + cw * 0.34 * sc, p.y - chh * 0.8 * sc); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(25,35,48,0.85)";
      ctx.fillRect(p.x - cw * 0.22 * sc, p.y - chh * 1.15 * sc, cw * 0.44 * sc, chh * 0.28 * sc);
      if (side > 0.55) {
        ctx.fillStyle = "#111";
        [-0.32, 0.32].forEach(function (u) { ctx.beginPath(); ctx.arc(p.x + cw * u * sc, p.y - 0.32 * sc, 0.34 * sc, 0, Math.PI * 2); ctx.fill(); });
        ctx.fillStyle = "#9aa0a6";
        [-0.32, 0.32].forEach(function (u) { ctx.beginPath(); ctx.arc(p.x + cw * u * sc, p.y - 0.32 * sc, 0.15 * sc, 0, Math.PI * 2); ctx.fill(); });
      }
      if (front) {
        ctx.fillStyle = "#fff6c8";
        ctx.fillRect(p.x - cw * 0.46 * sc, p.y - chh * 0.66 * sc, cw * 0.16 * sc, chh * 0.1 * sc);
        ctx.fillRect(p.x + cw * 0.3 * sc, p.y - chh * 0.66 * sc, cw * 0.16 * sc, chh * 0.1 * sc);
      } else if (s.c.braking) {
        ctx.fillStyle = "#ff2a2a";
        var tx = Math.sin(s.rel) > 0 ? -1 : 1;   // 側面時尾燈在車尾那一端
        ctx.fillRect(p.x + tx * cw * 0.47 * sc - 0.08 * sc, p.y - chh * 0.7 * sc, 0.16 * sc, chh * 0.14 * sc);
      }
      if (s.f < 160) {
        ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#fff";
        ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 3;
        ctx.strokeText(s.c.name, p.x, p.y - chh * 1.25 * sc - 6); ctx.fillText(s.c.name, p.x, p.y - chh * 1.25 * sc - 6);
      }
    }

    if (ext) return;
    // 奔放模式：加速中畫速度線
    var cf = car.fx;
    if (cf && (cf.nitro > 0 || cf.sling > 0 || cf.boost > 0)) {
      ctx.save();
      ctx.strokeStyle = cf.boost > 0 && !(cf.nitro > 0) ? "rgba(255,220,120,0.55)" : "rgba(140,200,255,0.6)";
      for (var sl2 = 0; sl2 < 26; sl2++) {
        var ang = sl2 / 26 * Math.PI * 2 + race.t * 0.7, r0 = Math.min(W, H) * (0.35 + ((sl2 * 37 + Math.floor(race.t * 30)) % 10) / 40);
        ctx.lineWidth = 1 + (sl2 % 3);
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r0, hy + Math.sin(ang) * r0 * 0.7);
        ctx.lineTo(cx + Math.cos(ang) * r0 * 1.5, hy + Math.sin(ang) * r0 * 1.05); ctx.stroke();
      }
      ctx.restore();
    }
    // 高速時的暗角（速度感）
    var vf = clamp((car.v - 20) / 40, 0, 1);
    if (vf > 0) {
      var vg = ctx.createRadialGradient(W / 2, hy, Math.min(W, H) * 0.3, W / 2, hy, Math.max(W, H) * 0.75);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0," + (0.35 * vf).toFixed(3) + ")");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
    drawInterior(ctx, W, H, race, car, tr, i0, skyC);
  }

  function drawInterior(ctx, W, H, race, car, tr, i0, skyC) {
    var inTunnel = tr.sp && tr.sp[i0] === 3;
    // 引擎蓋（車身色，反射天空）
    var hoodTop = H * 0.735, dy = H * 0.8;
    var hg = ctx.createLinearGradient(0, hoodTop, 0, dy + 10);
    hg.addColorStop(0, inTunnel ? shade(car.color, -0.3) : mixHex(car.color, skyC[1], 0.35));
    hg.addColorStop(1, shade(car.color, -0.18));
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.moveTo(W * 0.1, dy + 12); ctx.quadraticCurveTo(W * 0.2, hoodTop + 4, W * 0.5, hoodTop); ctx.quadraticCurveTo(W * 0.8, hoodTop + 4, W * 0.9, dy + 12); ctx.closePath(); ctx.fill();
    // A 柱
    ctx.fillStyle = "#15171a";
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.07, 0); ctx.lineTo(W * 0.13, H * 0.78); ctx.lineTo(0, H * 0.82); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W * 0.93, 0); ctx.lineTo(W * 0.87, H * 0.78); ctx.lineTo(W, H * 0.82); ctx.closePath(); ctx.fill();
    ctx.fillRect(0, 0, W, H * 0.025);
    // 儀表板
    var dg = ctx.createLinearGradient(0, dy - H * 0.06, 0, H);
    dg.addColorStop(0, "#26292e"); dg.addColorStop(1, "#141518");
    ctx.fillStyle = dg;
    ctx.beginPath(); ctx.moveTo(0, dy + 10); ctx.quadraticCurveTo(W / 2, dy - H * 0.06, W, dy + 10); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    // 擋風玻璃反光
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.beginPath(); ctx.moveTo(W * 0.12, H * 0.05); ctx.lineTo(W * 0.3, H * 0.05); ctx.lineTo(W * 0.18, H * 0.6); ctx.lineTo(W * 0.13, H * 0.6); ctx.closePath(); ctx.fill();
    // 方向盤：依路的曲率轉，甩尾時反打
    var k = tr.k[i0];
    var steer = clamp(Math.atan(k * 2.7) * 10 - car.slip * 1.6, -2.6, 2.6) + (car.stun > 0 ? Math.sin(race.t * 18) * 1.5 : 0);
    var wx = W * 0.5, wy = H * 1.02, wr = Math.min(W * 0.2, H * 0.3);
    ctx.save(); ctx.translate(wx, wy); ctx.rotate(-steer);
    ctx.strokeStyle = "#0c0d0f"; ctx.lineWidth = wr * 0.16;
    ctx.beginPath(); ctx.arc(0, 0, wr, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = wr * 0.04;
    ctx.beginPath(); ctx.arc(0, 0, wr * 1.04, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.strokeStyle = "#0c0d0f"; ctx.lineWidth = wr * 0.12;
    ctx.beginPath(); ctx.moveTo(-wr, 0); ctx.lineTo(wr, 0); ctx.moveTo(0, 0); ctx.lineTo(0, wr); ctx.stroke();
    ctx.fillStyle = car.color; ctx.fillRect(-wr * 0.06, -wr * 1.08, wr * 0.12, wr * 0.16);
    ctx.fillStyle = "#24272b"; ctx.beginPath(); ctx.arc(0, 0, wr * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // 轉速錶（左，顯示檔位）＋速度錶（右）；檔位是畫面演出，物理只用連續的出力曲線
    var gr = Math.min(W * 0.075, H * 0.11), gy = H * 0.93;
    var vtop = Math.max(30, car.st.vtop);
    var gears = [0.28, 0.42, 0.56, 0.7, 0.85, 1.0], gi = 0;
    while (gi < gears.length - 1 && car.v > vtop * gears[gi] * 0.97) gi++;
    var lo = gi ? vtop * gears[gi - 1] * 0.97 : 0, hi = vtop * gears[gi];
    var rpm = car.st.ev ? car.v / vtop : clamp(0.25 + 0.75 * (car.v - lo * 0.75) / Math.max(1, hi - lo * 0.75), 0.12, 1);
    gauge(W * 0.22, gy, gr, rpm, car.st.ev ? "EV" : String(gi + 1), !car.st.ev);
    gauge(W * 0.78, gy, gr, clamp(car.v / vtop, 0, 1), String(Math.round(car.v * 3.6)), false);
    function gauge(gx, gy2, r, frac, label, red) {
      ctx.fillStyle = "#0b0c0e"; ctx.beginPath(); ctx.arc(gx, gy2, r * 1.12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#555"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(gx, gy2, r, Math.PI * 0.8, Math.PI * 2.2); ctx.stroke();
      if (red) { ctx.strokeStyle = "#c0392b"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(gx, gy2, r, Math.PI * (0.8 + 1.4 * 0.85), Math.PI * 2.2); ctx.stroke(); }
      var ang = Math.PI * 0.8 + frac * Math.PI * 1.4;
      ctx.strokeStyle = "#ff5a3c"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(gx, gy2); ctx.lineTo(gx + Math.cos(ang) * r * 0.92, gy2 + Math.sin(ang) * r * 0.92); ctx.stroke();
      ctx.fillStyle = red && frac > 0.85 ? "#ff6b5a" : "#fff"; ctx.font = "bold " + Math.round(r * 0.42) + "px monospace"; ctx.textAlign = "center";
      ctx.fillText(label, gx, gy2 + r * 0.62);
    }
    // 後照鏡：最近的後車
    var behind = null;
    race.cars.forEach(function (c) { if (c !== car && c.state === "run" && c.s < car.s && (!behind || c.s > behind.s)) behind = c; });
    var mw = W * 0.2, mh = H * 0.06, mx = W / 2 - mw / 2, my = H * 0.035;
    ctx.fillStyle = "#101214"; ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
    var mg = ctx.createLinearGradient(0, my, 0, my + mh);
    mg.addColorStop(0, inTunnel ? "#2a2a2a" : skyC[1]); mg.addColorStop(0.55, inTunnel ? "#333333" : "#7b8790"); mg.addColorStop(1, "#4b5257");
    ctx.fillStyle = mg; ctx.fillRect(mx, my, mw, mh);
    if (behind && car.s - behind.s < 150) {
      var gap = car.s - behind.s, bw = clamp(mw * 0.5 * (12 / Math.max(6, gap)), 6, mw * 0.8);
      ctx.fillStyle = behind.color; ctx.fillRect(W / 2 - bw / 2, my + mh - bw * 0.45 - 2, bw, bw * 0.45);
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "left";
      ctx.fillText(behind.name + " −" + Math.round(gap) + "m", mx + 4, my + 12);
    }
  }

  window.PriTestDejavuCockpit = { draw: draw, prep: prep };

})();
