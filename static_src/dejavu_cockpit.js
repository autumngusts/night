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
  var NEAR = 3.5;     // 車頭前 3.5 m 內被引擎蓋擋住，不畫（太近的梯形投影會爆大）
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

  // o：{ pal, trees, water: 水的顏色或 null, patchColor }
  function draw(ctx, W, H, race, car, o) {
    var Core = window.PriTestDejavuCore;
    var tr = race.track, ds = tr.ds, sp = tr.sp || [];
    var pc = prep(tr, race.seed);
    var pose = Core.carPose(race, car);
    var i0 = clamp(Math.floor(car.s / ds), 0, tr.N - 2);
    var ch = Math.cos(pose.h), sh = Math.sin(pose.h);
    var camZ = tr.z[i0] + 1.15;
    var slope = tr.sl[i0];
    var F = W * 0.72, cx = W / 2, hy = H * 0.4;
    // 車速越快鏡頭越低一點、微微晃動
    hy += Math.sin(race.t * 23) * Math.min(1.5, car.v * 0.04);
    var hz = hy - slope * F;   // 無限遠（與鏡頭同高）的地平線
    var season = tr.season, pal = o.pal;
    var skyC = tr.rain ? SKY.rain : SKY[season];
    var fog = rgb(skyC[1]);
    function fogT(f) { return clamp((f - 30) / (VIEW * 1.05), 0, 0.82); }

    function proj(x, y, z) {
      var dx = x - pose.x, dy = y - pose.y;
      var fw = dx * ch + dy * sh, lt = -dx * sh + dy * ch;
      var up = z - camZ + fw * slope;
      return { f: fw, x: cx - lt / fw * F, y: hy - up / fw * F };
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
      var d = Math.atan2(Math.sin(az - pose.h), Math.cos(az - pose.h));
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
        var u = (pose.h + Math.atan((cx - px) / F)) * freq;
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
    if (sp[i0] === 3) { ctx.fillStyle = "#1c1c1d"; ctx.fillRect(0, 0, W, H); }

    // ---- 看板：依所在列分桶，畫完那一列的路面才畫 ----
    var jMax = Math.min(tr.N - 2, i0 + Math.round(VIEW / ds));
    var nRows = jMax - i0 + 1;
    var buckets = [];
    function addSprite(j, s) {
      var k = j - i0;
      if (k < 0 || k >= nRows) return;
      (buckets[k] = buckets[k] || []).push(s);
    }
    o.trees.forEach(function (t) {
      if (t.j === undefined || t.j < i0 || t.j > jMax) return;
      var p = proj(t.x, t.y, tr.z[t.j] + terrainZ(t.j, t.o));
      if (p.f > 2 && p.f < VIEW) addSprite(t.j, { f: p.f, kind: "tree", p: p, t: t });
    });
    var sJ = Math.round(tr.start / ds), fJ = Math.round(tr.finish / ds);
    for (var q = i0 + 1; q <= jMax; q++) {
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
      if (q === sJ || q === fJ) addSprite(q, { f: edge(q, 0).f, kind: "gate", j: q, goal: q === fJ });
    }
    race.cars.forEach(function (c) {
      if (c === car || c.state === "dnf" && c.v < 0.1 && Math.abs(c.s - car.s) > 300) return;
      var ps = Core.carPose(race, c);
      var cj = clamp(Math.floor(c.s / ds), 0, tr.N - 1);
      var p = proj(ps.x, ps.y, tr.z[cj]);
      if (p.f > 1.2 && p.f < VIEW) addSprite(cj, { f: p.f, kind: "car", p: p, c: c, rel: ps.h - pose.h });
    });

    function quad(a, b, c, d, col) {
      if (a.f < NEAR || b.f < NEAR || c.f < NEAR || d.f < NEAR) return;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
    }
    // 兩列之間、橫向 off1→off2 的地形面
    function terr(ja, jb, off1, off2, col) {
      quad(edge(ja, off1, terrainZ(ja, off1)), edge(jb, off1, terrainZ(jb, off1)), edge(jb, off2, terrainZ(jb, off2)), edge(ja, off2, terrainZ(ja, off2)), col);
    }

    // ---- 由遠到近：每列一條帶 ----
    var roadCol = tr.rain ? "#3d4246" : pal.road;
    // 車頭正前方：先在鏡頭座標裡畫一小段平面路面當底，後面的帶狀路面會蓋上去；補上路面和引擎蓋之間的空隙
    (function apron() {
      var dx0 = tr.x[i0] - pose.x, dy0 = tr.y[i0] - pose.y;
      var f0 = dx0 * ch + dy0 * sh, lt0 = -dx0 * sh + dy0 * ch, dh = tr.h[i0] - pose.h;
      var cs = Math.cos(dh), tn = Math.tan(clamp(dh, -1.2, 1.2));
      function P(f, off) { var L = lt0 + off * cs + (f - f0) * tn; return { x: cx - L / f * F, y: hy + 1.15 / f * F }; }
      var f1 = NEAR + 2.5, f2 = 0.7, yTop = P(f1, 0).y;
      ctx.fillStyle = sp[i0] === 3 ? "#3a3a38" : tint(pal.ground, -0.06, null, 0);
      ctx.fillRect(0, yTop - 1, W, H - yTop + 1);
      function band2(o1, o2, col) {
        var a = P(f1, o1), b = P(f1, o2), c = P(f2, o2), d = P(f2, o1);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
      }
      var cd0 = sp[i0];
      band2(hw + 1.6, -hw - 1.6, cd0 === 4 ? CONCRETE : cd0 === 3 ? "#444648" : pal.shoulder);
      band2(hw, -hw, cd0 === 1 ? "#9b8565" : cd0 === 3 ? "#444648" : roadCol);
      if (cd0 !== 1) { band2(hw - 0.1, hw - 0.4, pal.line); band2(-hw + 0.4, -hw + 0.1, pal.line); }
    })();

    for (var k = nRows - 2; k >= 0; k--) {
      var ja = i0 + k, jb = ja + 1;
      var cA = edge(ja, 0);
      if (cA.f < NEAR * 0.5) { drawBucket(k); continue; }
      var ft = fogT(cA.f), band = Math.floor(ja / 3) % 2, cd = sp[ja];
      var wl = pc.wall[ja];
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
        laneLines(ja, jb, cA, ft, false);
        if (sp[ja - 1] !== 3) portal(ja, ft);   // 入口（從外面看的洞口）
        drawBucket(k);
        continue;
      }
      // 兩側地形
      [1, -1].forEach(function (side) {
        var isWater = tr.water && side === tr.water && cd !== 4;
        var isWall = cd !== 4 && !isWater && side === wl;
        if (isWall) {
          terr(ja, jb, side * (hw + 3.2), side * (hw + 40), tint(HILL[season], band ? 0 : -0.03, fog, ft));
          terr(ja, jb, side * (hw + 2.2), side * (hw + 3.2), tint(ROCK[season], band ? -0.02 : -0.08, fog, ft));
          terr(ja, jb, side * (hw + 1.6), side * (hw + 2.2), tint("#5c564a", 0, fog, ft));
        } else if (isWater && o.water) {
          quad(edge(ja, side * (hw + 9), -2.1), edge(jb, side * (hw + 9), -2.1), edge(jb, side * (hw + 450), -2.1), edge(ja, side * (hw + 450), -2.1),
            tint(o.water, Math.floor(ja / 2) % 3 === 0 ? 0.05 : 0, fog, Math.min(0.75, ft * 0.8)));
          terr(ja, jb, side * (hw + 1.6), side * (hw + 9.2), tint(season === "winter" ? "#e9eef2" : "#a89f86", band ? 0 : -0.04, fog, ft));
        } else {
          terr(ja, jb, side * (hw + 1.6), side * (hw + 130), tint(pal.ground, band ? -0.06 : -0.1, fog, Math.min(0.9, ft + 0.15)));
          if (cd === 4) quad(edge(ja, side * (hw + 1.6), 0), edge(jb, side * (hw + 1.6), 0), edge(jb, side * (hw + 1.6), -1.2), edge(ja, side * (hw + 1.6), -1.2), tint(CONCRETE, -0.15, fog, ft));
        }
      });
      // 路肩、路面
      quad(edge(ja, hw + 1.6), edge(jb, hw + 1.6), edge(jb, -hw - 1.6), edge(ja, -hw - 1.6), tint(cd === 4 ? CONCRETE : pal.shoulder, band ? 0 : -0.07, fog, ft));
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
      laneLines(ja, jb, cA, ft, cd === 1);
      // 護欄（山谷、水邊；橋上兩側）
      [1, -1].forEach(function (side) {
        if (cd !== 4 && side === wl && !(tr.water && side === tr.water)) return;
        quad(edge(ja, side * (hw + 1.1), 0.5), edge(jb, side * (hw + 1.1), 0.5), edge(jb, side * (hw + 1.1), 0.82), edge(ja, side * (hw + 1.1), 0.82),
          tint("#d4d8dc", band ? 0 : -0.1, fog, ft));
      });
      drawBucket(k);
    }

    function laneLines(ja, jb, cA, ft, gravel) {
      if (gravel) return;
      var lw = clamp(0.15 / cA.f * F, 0.6, 5);
      ctx.strokeStyle = tint(pal.line, 0, fog, ft); ctx.lineWidth = lw;
      var a1 = edge(ja, hw - 0.25), b1 = edge(jb, hw - 0.25), a2 = edge(ja, -hw + 0.25), b2 = edge(jb, -hw + 0.25);
      if (a1.f > NEAR && b1.f > NEAR && a2.f > NEAR && b2.f > NEAR) {
        ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
      }
      if (Math.floor(ja / 2) % 3 === 0) {
        var c1 = edge(ja, 0), c2 = edge(jb, 0);
        if (c1.f > NEAR && c2.f > NEAR) {
          ctx.strokeStyle = tint("#f0c83c", 0, fog, ft);
          ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.stroke();
        }
      }
    }
    function portal(j, ft) {
      var pts = [edge(j, hw + 9, 0), edge(j, hw + 9, 10), edge(j, -hw - 9, 10), edge(j, -hw - 9, 0)];
      var hole = [edge(j, hw + 0.8, 0), edge(j, hw + 0.8, 5.4), edge(j, -hw - 0.8, 5.4), edge(j, -hw - 0.8, 0)];
      if (pts.concat(hole).some(function (p) { return p.f < NEAR; })) return;
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
      var cw = 1.8 + Math.abs(Math.sin(s.rel)) * 2.6, chh = 1.3;
      ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(p.x - cw / 2 * sc, p.y - 0.15 * sc, cw * sc, 0.3 * sc);
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

  window.PriTestDejavuCockpit = { draw: draw };
})();
