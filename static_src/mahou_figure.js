// 魔法變色龍（mahou）：小人物繪製與上色引擎（canvas）。
//
// 上色層（paint）：PX×PX 的不透明畫布，對應小人物座標 -100〜100（1 單位＝PX/200 像素）。
// 實際顯示時用動作的剪影當遮罩（destination-in），所以換動作不會弄丟顏料，只是露出的部位不同。
// 剪影幾何來自 mahou_core.js 的 skeleton()，跟命中判定是同一組形狀。眼睛永遠畫在最上層（鬼的線索）。
(function () {
  "use strict";

  var D = window.PriTestMahouData, Core = window.PriTestMahouCore;
  var PX = 256, U = PX / 200;
  var BASE = "#8fbf6a";

  function mk(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h || w; return c; }
  function ctx2(c) { return c.getContext("2d", { willReadFrequently: true }) || c.getContext("2d"); }
  function toPx(l) { return [(l[0] + 100) * U, (l[1] + 100) * U]; }
  function toLocal(p) { return [p[0] / U - 100, p[1] / U - 100]; }

  // ---------------- 剪影 ----------------
  function silhouette(ctx, sk, color) {
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = "round";
    sk.segs.forEach(function (g) {
      ctx.lineWidth = g.r * 2;
      ctx.beginPath(); ctx.moveTo(g.a[0], g.a[1]); ctx.lineTo(g.b[0], g.b[1]); ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(sk.head.x, sk.head.y, sk.head.r, 0, Math.PI * 2); ctx.fill();
  }
  var maskCache = {};
  function mask(poseId) {
    if (maskCache[poseId]) return maskCache[poseId];
    var c = mk(PX), g = c.getContext("2d");
    g.setTransform(U, 0, 0, U, PX / 2, PX / 2);
    silhouette(g, Core.skeleton(poseId), "#fff");
    maskCache[poseId] = c;
    return c;
  }
  function outline(ctx, sk, color, w) {
    // 只畫外輪廓：先畫粗的再用 destination-out 挖掉內部（在獨立畫布上做，避免影響主畫面）
    var c = mk(PX), g = c.getContext("2d");
    g.setTransform(U, 0, 0, U, PX / 2, PX / 2);
    var big = { segs: sk.segs.map(function (s) { return { a: s.a, b: s.b, r: s.r + w }; }), head: { x: sk.head.x, y: sk.head.y, r: sk.head.r + w } };
    silhouette(g, big, color);
    g.globalCompositeOperation = "destination-out";
    silhouette(g, sk, "#000");
    ctx.drawImage(c, -100, -100, 200, 200);
  }

  // ---------------- 眼睛 ----------------
  // 每個人每回合的細微差異：用「玩家 id＋回合」當種子，所有裝置算出一樣的結果
  function seedOf(str) {
    var h = 0x811c9dc5;
    str = String(str || "");
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0 || 1;
  }
  var IRIS = ["#111111", "#3b2414", "#1d3f7a", "#1f5a2e", "#5a1d1d", "#3a2a55", "#6b4a12"];
  var WHITE = ["#ffffff", "#fffaf0", "#f4fbff", "#fff7fb", "#fbfff2"];
  function eyeVariant(seed) {
    if (!seed) return { sc: 1, gap: 0, dy: 0, pup: 0.52, look: [0, 0], iris: IRIS[0], white: WHITE[0], tilt: 0 };
    var R = rng(seed);
    var ang = R() * Math.PI * 2, lr = R() * 0.7;
    return {
      sc: 0.82 + R() * 0.36, gap: (R() - 0.5) * 1.8, dy: (R() - 0.5) * 2.4, pup: 0.4 + R() * 0.22,
      look: [Math.cos(ang) * lr, Math.sin(ang) * lr], iris: IRIS[Math.floor(R() * IRIS.length)], white: WHITE[Math.floor(R() * WHITE.length)],
      tilt: (R() - 0.5) * 0.5
    };
  }
  function drawEyes(ctx, sk, eyeId, seed) {
    var V = eyeVariant(seed);
    var hd = sk.ha * Math.PI / 180, dx = Math.sin(hd), dy = -Math.cos(hd), sx = -dy, sy = dx;
    var fx = dx * 0.8 + V.look[0], fy = dy * 0.8 + V.look[1];
    sk.eyes.forEach(function (p, i) {
      var side = i ? 1 : -1;
      // 間距與上下位置的差異沿著頭的方向套用，換動作也不會跑出頭外
      var x = p[0] + sx * side * V.gap / 2 + dx * V.dy * 0.5, y = p[1] + sy * side * V.gap / 2 + dy * V.dy * 0.5;
      ctx.lineWidth = 0.7; ctx.strokeStyle = "rgba(0,0,0,0.85)";
      if (eyeId === "tiny") {
        var tr = 1.7 * V.sc;
        ctx.fillStyle = V.iris; ctx.beginPath(); ctx.arc(x, y, tr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x - tr * 0.3, y - tr * 0.35, tr * 0.32, 0, Math.PI * 2); ctx.fill();
        return;
      }
      var r = (eyeId === "big" ? 4 : 3) * V.sc;
      ctx.fillStyle = V.white; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = V.iris; ctx.beginPath(); ctx.arc(x + fx * V.sc, y + fy * V.sc, r * V.pup, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + fx * V.sc - r * 0.2, y + fy * V.sc - r * 0.22, r * 0.17, 0, Math.PI * 2); ctx.fill();
      if (eyeId === "sleepy") {
        ctx.save();
        ctx.translate(x, y); ctx.rotate(hd + side * V.tilt);
        ctx.fillStyle = "rgba(40,40,40,0.95)";
        ctx.beginPath(); ctx.arc(0, 0, r + 0.35, Math.PI, 0); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    });
  }

  // 小人物成品：上色層＋剪影遮罩＋眼睛（opts.outline＝描邊顏色，躲藏時給自己看位置用）
  function render(paint, poseId, eyeId, opts) {
    opts = opts || {};
    var c = opts.into || mk(PX), g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, PX, PX);
    g.globalCompositeOperation = "source-over";
    if (paint) g.drawImage(paint, 0, 0, PX, PX); else { g.fillStyle = BASE; g.fillRect(0, 0, PX, PX); }
    g.globalCompositeOperation = "destination-in";
    g.drawImage(mask(poseId), 0, 0);
    g.globalCompositeOperation = "source-over";
    g.setTransform(U, 0, 0, U, PX / 2, PX / 2);
    var sk = Core.skeleton(poseId);
    if (opts.outline) outline(g, sk, opts.outline, opts.outlineW || 1.4);
    drawEyes(g, sk, eyeId || "round", opts.eyeSeed || 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    return c;
  }

  // 在照片座標（ctx 已縮放成「1 單位＝照片高度」）上畫小人物
  function place(ctx, figCanvas, fig) {
    var k = Core.figK(fig);
    ctx.save();
    ctx.translate(fig.x, fig.y);
    ctx.rotate((fig.r || 0) * Math.PI / 180);
    ctx.scale(k * (fig.f ? -1 : 1), k);
    ctx.drawImage(figCanvas, -100, -100, 200, 200);
    ctx.restore();
  }

  function poseIcon(poseId, size, color) {
    var c = mk(size), g = c.getContext("2d");
    var sk = Core.skeleton(poseId), b = sk.box, span = Math.max(b[2] - b[0], b[3] - b[1]) + 8;
    var sc = size / span;
    g.setTransform(sc, 0, 0, sc, size / 2, size / 2);
    silhouette(g, sk, color || "#5aa66a");
    drawEyes(g, sk, "round");
    return c;
  }

  // ---------------- 仿射矩陣（2×3） ----------------
  function mul(m, n) { return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]; }
  function inv(m) {
    var d = m[0] * m[3] - m[1] * m[2];
    return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
  }
  // 上色層像素 → 照片像素（照片高度 H 像素）
  function paintToPhoto(fig, H) {
    var k = Core.figK(fig) * H, r = (fig.r || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    var m = [1, 0, 0, 1, fig.x * H, fig.y * H];
    m = mul(m, [c, s, -s, c, 0, 0]);
    m = mul(m, [k * (fig.f ? -1 : 1), 0, 0, k, 0, 0]);
    m = mul(m, [1 / U, 0, 0, 1 / U, -100, -100]);
    return m;
  }
  // 小人物身體底下的照片（上色層座標），變色拓印與偽裝度都用它
  // jitter（變色拓印用）：{ dx, dy（照片像素位移）, filter }——拓印出來跟原圖有細微差別，不會完美隱形
  function underlay(photo, fig, into, jitter) {
    var c = into || mk(PX), g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#777"; g.fillRect(0, 0, PX, PX);
    if (!photo) return c;
    var m = inv(paintToPhoto(fig, photo.height));
    g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (jitter && "filter" in g) g.filter = jitter.filter;
    g.drawImage(photo, jitter ? jitter.dx : 0, jitter ? jitter.dy : 0);
    if (jitter && "filter" in g) g.filter = "none";
    g.setTransform(1, 0, 0, 1, 0, 0);
    return c;
  }
  function cloneJitter(seed) {
    var R = rng(seed || 1);
    function sgn() { return R() < 0.5 ? -1 : 1; }
    var mag = 1 + R() * 2, ang = R() * Math.PI * 2;
    return {
      dx: Math.cos(ang) * mag, dy: Math.sin(ang) * mag,
      filter: "hue-rotate(" + (sgn() * (4 + R() * 4)).toFixed(1) + "deg) brightness(" + (100 + sgn() * (4 + R() * 3)).toFixed(1) + "%) saturate(" + (100 + sgn() * (5 + R() * 7)).toFixed(1) + "%) blur(" + (0.35 + R() * 0.4).toFixed(2) + "px)"
    };
  }

  // 偽裝度 0〜100：剪影內每個像素跟底下照片的顏色差（縮小取樣，順便有點模糊效果）
  function camoScore(paint, photo, fig) {
    var N = 48, a = mk(N), b = mk(N), m = mk(N);
    var ga = ctx2(a), gb = ctx2(b), gm = ctx2(m);
    ga.drawImage(paint, 0, 0, N, N);
    gb.drawImage(underlay(photo, fig), 0, 0, N, N);
    gm.drawImage(mask(fig.p), 0, 0, N, N);
    var da = ga.getImageData(0, 0, N, N).data, db = gb.getImageData(0, 0, N, N).data, dm = gm.getImageData(0, 0, N, N).data;
    var sum = 0, cnt = 0;
    for (var i = 0; i < da.length; i += 4) {
      if (dm[i + 3] < 200) continue;
      var dr = da[i] - db[i], dg = da[i + 1] - db[i + 1], dB = da[i + 2] - db[i + 2];
      sum += Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + dB * dB * 0.11) * 1.6;
      cnt++;
    }
    if (!cnt) return 0;
    return Math.round(Math.max(0, Math.min(100, 100 * (1 - (sum / cnt) / 95))));
  }

  // 照片色票：量化成 4-bit 色箱，取最多的幾個
  function palette(photo, n) {
    var W = 64, H = Math.max(8, Math.round(64 * photo.height / photo.width));
    var c = mk(W, H), g = ctx2(c);
    g.drawImage(photo, 0, 0, W, H);
    var d = g.getImageData(0, 0, W, H).data, bins = {};
    for (var i = 0; i < d.length; i += 4) {
      var key = (d[i] >> 4) + "," + (d[i + 1] >> 4) + "," + (d[i + 2] >> 4);
      var b = bins[key] || (bins[key] = { n: 0, r: 0, g: 0, b: 0 });
      b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
    }
    var list = Object.keys(bins).map(function (k) { var b = bins[k]; return [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n), b.n]; });
    list.sort(function (x, y) { return y[3] - x[3]; });
    var out = [];
    list.forEach(function (c0) {
      if (out.length >= (n || 16)) return;
      if (out.some(function (o) { return Math.abs(o[0] - c0[0]) + Math.abs(o[1] - c0[1]) + Math.abs(o[2] - c0[2]) < 42; })) return;
      out.push(c0);
    });
    return out.map(function (c0) { return rgbHex(c0[0], c0[1], c0[2]); });
  }
  function rgbHex(r, g, b) { return "#" + [r, g, b].map(function (v) { return ("0" + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join(""); }
  function hexRgb(h) { h = String(h || "#000").replace("#", ""); if (h.length === 3) h = h.replace(/(.)/g, "$1$1"); var n = parseInt(h, 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  // ---------------- 紋理 ----------------
  function rng(seed) { var x = seed >>> 0 || 1; return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
  function pattern(id, c1, c2, scale) {
    var c = mk(PX), g = c.getContext("2d"), sc = Math.max(0.4, scale || 1), R = rng(7 + id.length * 31);
    g.fillStyle = c2; g.fillRect(0, 0, PX, PX);
    g.fillStyle = c1; g.strokeStyle = c1;
    var s = 16 * sc, x, y, i;
    if (id === "dots") {
      for (y = 0; y < PX + s; y += s) for (x = 0; x < PX + s; x += s) { g.beginPath(); g.arc(x + ((y / s) % 2 ? s / 2 : 0), y, s * 0.28, 0, Math.PI * 2); g.fill(); }
    } else if (id === "stripes") {
      g.lineWidth = s * 0.45;
      for (i = -PX; i < PX * 2; i += s) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + PX, PX); g.stroke(); }
    } else if (id === "scales") {
      g.lineWidth = Math.max(1, s * 0.12);
      for (y = 0; y < PX + s; y += s * 0.5) for (x = 0; x < PX + s; x += s) {
        var ox = (Math.round(y / (s * 0.5)) % 2) ? s / 2 : 0;
        g.beginPath(); g.arc(x + ox, y, s * 0.5, 0, Math.PI); g.stroke();
      }
    } else if (id === "noise") {
      var a = hexRgb(c1);
      for (i = 0; i < 2600 / sc; i++) { var al = R(); g.fillStyle = "rgba(" + a[0] + "," + a[1] + "," + a[2] + "," + (0.25 + al * 0.6).toFixed(2) + ")"; var w = 1 + R() * 2.5 * sc; g.fillRect(R() * PX, R() * PX, w, w); }
    } else if (id === "checker") {
      for (y = 0; y < PX; y += s) for (x = 0; x < PX; x += s) if (((x + y) / s) % 2 === 0) g.fillRect(x, y, s, s);
    } else if (id === "leaves") {
      for (i = 0; i < 90 / sc; i++) {
        g.save(); g.translate(R() * PX, R() * PX); g.rotate(R() * Math.PI * 2);
        g.beginPath(); g.ellipse(0, 0, s * 0.55, s * 0.22, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    } else if (id === "bricks") {
      g.fillStyle = c1; g.fillRect(0, 0, PX, PX);
      g.strokeStyle = c2; g.lineWidth = Math.max(1, s * 0.12);
      for (y = 0, i = 0; y < PX; y += s, i++) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(PX, y); g.stroke();
        for (x = (i % 2) ? s : 0; x < PX; x += s * 2) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + s); g.stroke(); }
      }
    } else if (id === "wood") {
      g.lineWidth = Math.max(1, s * 0.1);
      for (y = 0; y < PX; y += s * 0.35) {
        g.beginPath();
        for (x = 0; x <= PX; x += 8) g.lineTo(x, y + Math.sin(x / (22 * sc) + y * 0.07) * s * 0.25);
        g.stroke();
      }
    } else if (id === "waves") {
      g.lineWidth = Math.max(1.5, s * 0.18);
      for (y = 0; y < PX + s; y += s * 0.6) {
        g.beginPath();
        for (x = 0; x <= PX; x += 4) g.lineTo(x, y + Math.sin(x / (s * 0.5)) * s * 0.2);
        g.stroke();
      }
    } else if (id === "stars") {
      for (i = 0; i < 70 / sc; i++) {
        var cx = R() * PX, cy = R() * PX, rr = s * (0.2 + R() * 0.25);
        g.beginPath();
        for (var k = 0; k < 10; k++) { var ang = k * Math.PI / 5 - Math.PI / 2, rad = k % 2 ? rr * 0.45 : rr; g.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad); }
        g.closePath(); g.fill();
      }
    }
    return c;
  }

  // ---------------- 上色器 ----------------
  // opts: { getUnderlay(): canvas（變色拓印用） }
  function Painter(opts) {
    this.opts = opts || {};
    this.paint = mk(PX);
    this.g = ctx2(this.paint);
    this.layer = mk(PX);         // 這一筆的暫存層（放開時以透明度合成）
    this.lg = this.layer.getContext("2d");
    this.view = mk(PX);          // paint＋layer 的即時合成
    this.undo = []; this.redo = [];
    this.tool = "brush"; this.size = 8; this.opacity = 1; this.hard = 0.6;
    this.c1 = BASE; this.c2 = "#3f6b2f"; this.base = BASE;
    this.pat = "dots"; this.patScale = 1; this.mirror = false;
    this.stroke = null;
    this.rev = 0;
    this.clear(BASE, true);
  }
  Painter.prototype.snapshot = function () {
    this.undo.push(this.g.getImageData(0, 0, PX, PX));
    if (this.undo.length > 30) this.undo.shift();
    this.redo = [];
  };
  Painter.prototype.changed = function () { this.rev++; };
  Painter.prototype.doUndo = function () {
    if (!this.undo.length) return false;
    this.redo.push(this.g.getImageData(0, 0, PX, PX));
    this.g.putImageData(this.undo.pop(), 0, 0);
    this.changed(); return true;
  };
  Painter.prototype.doRedo = function () {
    if (!this.redo.length) return false;
    this.undo.push(this.g.getImageData(0, 0, PX, PX));
    this.g.putImageData(this.redo.pop(), 0, 0);
    this.changed(); return true;
  };
  Painter.prototype.clear = function (color, noUndo) {
    if (!noUndo) this.snapshot();
    this.base = color || this.base;
    this.g.globalAlpha = 1; this.g.globalCompositeOperation = "source-over";
    this.g.fillStyle = this.base; this.g.fillRect(0, 0, PX, PX);
    this.changed();
  };
  Painter.prototype.load = function (img) {
    this.g.globalAlpha = 1; this.g.globalCompositeOperation = "source-over";
    this.g.drawImage(img, 0, 0, PX, PX);
    this.undo = []; this.redo = [];
    this.changed();
  };
  Painter.prototype.exportUrl = function () { return this.paint.toDataURL("image/jpeg", 0.86); };
  Painter.prototype.current = function () {
    if (!this.stroke || this.stroke.direct) return this.paint;
    var g = this.view.getContext("2d");
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    g.drawImage(this.paint, 0, 0);
    g.globalAlpha = this.opacity;
    g.drawImage(this.layer, 0, 0);
    g.globalAlpha = 1;
    return this.view;
  };

  // 一個圓形的筆觸點：src＝顏色字串或畫布（拓印／紋理／模糊來源，和上色層同座標）
  var dabC = mk(64);
  Painter.prototype.dab = function (g, src, x, y, r, hard, alpha) {
    var d = Math.ceil(r * 2 + 2);
    if (dabC.width < d) { dabC.width = d; dabC.height = d; }
    var dg = dabC.getContext("2d");
    dg.setTransform(1, 0, 0, 1, 0, 0);
    dg.globalCompositeOperation = "source-over"; dg.globalAlpha = 1;
    dg.clearRect(0, 0, d, d);
    var ox = x - d / 2, oy = y - d / 2;
    if (typeof src === "string") { dg.fillStyle = src; dg.fillRect(0, 0, d, d); }
    else dg.drawImage(src, -ox, -oy);
    dg.globalCompositeOperation = "destination-in";
    var gr = dg.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, r);
    gr.addColorStop(0, "rgba(0,0,0,1)");
    gr.addColorStop(Math.max(0.01, Math.min(0.99, hard)), "rgba(0,0,0,1)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    dg.fillStyle = gr;
    dg.fillRect(0, 0, d, d);
    g.globalAlpha = alpha === undefined ? 1 : alpha;
    g.drawImage(dabC, 0, 0, d, d, ox, oy, d, d);
    g.globalAlpha = 1;
  };
  Painter.prototype.dabs = function (g, src, x, y, r, hard, alpha) {
    this.dab(g, src, x, y, r, hard, alpha);
    if (this.mirror) this.dab(g, src, PX - x, y, r, hard, alpha);
  };
  Painter.prototype.source = function () {
    var t = this.tool;
    if (t === "brush") return this.c1;
    if (t === "eraser") return this.base;
    if (t === "clone") return this.opts.getUnderlay ? this.opts.getUnderlay() : this.c1;
    if (t === "stamp") return (this.opts.getStamp && this.opts.getStamp()) || this.c1;   // 取樣拓印：照片別處的紋理
    if (t === "env") return (this.opts.getEnv && this.opts.getEnv()) || this.c1;         // 環境色筆：背景的模糊平均色
    if (t === "pattern") return this.stroke.pat || (this.stroke.pat = pattern(this.pat, this.c1, this.c2, this.patScale));
    if (t === "blur") return this.stroke.blur;
    return this.c1;
  };
  // 座標皆為上色層像素
  Painter.prototype.begin = function (x, y) {
    var t = this.tool;
    if (t === "picker" || t === "stampSrc") return;
    this.snapshot();
    if (t === "fill") { this.flood(x, y); this.changed(); this.stroke = null; return; }
    var direct = t === "smudge" || t === "blur";
    this.stroke = { x: x, y: y, x0: x, y0: y, direct: direct, last: null };
    this.lg.clearRect(0, 0, PX, PX);
    if (t === "blur") {
      var b = mk(PX), bg = b.getContext("2d");
      if ("filter" in bg) { bg.filter = "blur(" + Math.max(1.5, this.size * U * 0.25).toFixed(1) + "px)"; bg.drawImage(this.paint, 0, 0); bg.filter = "none"; }
      else { var sm = mk(PX / 4); sm.getContext("2d").drawImage(this.paint, 0, 0, PX / 4, PX / 4); bg.drawImage(sm, 0, 0, PX, PX); }
      this.stroke.blur = b;
    }
    if (t === "smudge") { this.stroke.sm = mk(PX); this.stroke.px = x; this.stroke.py = y; }
    this.move(x, y, true);
  };
  Painter.prototype.move = function (x, y, first) {
    var st = this.stroke;
    if (!st) return;
    var t = this.tool, r = Math.max(1, this.size * U);
    if (t === "gradient") {
      st.x = x; st.y = y;
      this.lg.clearRect(0, 0, PX, PX);
      var gr = this.lg.createLinearGradient(st.x0, st.y0, x, y);
      gr.addColorStop(0, this.c1); gr.addColorStop(1, this.c2);
      this.lg.fillStyle = gr; this.lg.fillRect(0, 0, PX, PX);
      return;
    }
    if (t === "spray") {
      var n = Math.ceil(r * 1.4);
      for (var i = 0; i < n; i++) {
        var ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * r, dx = x + Math.cos(ang) * rad, dy = y + Math.sin(ang) * rad, w = Math.max(0.8, r * 0.07);
        this.lg.fillStyle = this.c1;
        this.lg.fillRect(dx, dy, w, w);
        if (this.mirror) this.lg.fillRect(PX - dx, dy, w, w);
      }
      st.x = x; st.y = y; this.changed();
      return;
    }
    var dist = first ? 0 : Math.hypot(x - st.x, y - st.y), stepLen = Math.max(1, r * 0.22);
    var steps = first ? 1 : Math.max(1, Math.floor(dist / stepLen));
    if (!first && dist < stepLen) return;
    for (var k = 1; k <= steps; k++) {
      var px = first ? x : st.x + (x - st.x) * k / steps, py = first ? y : st.y + (y - st.y) * k / steps;
      if (t === "smudge") {
        // 來源＝上色層往筆觸方向平移，等於把上一個位置的顏料推到這裡
        var sg = st.sm.getContext("2d");
        sg.clearRect(0, 0, PX, PX);
        sg.drawImage(this.paint, px - st.px, py - st.py);
        this.dabs(this.g, st.sm, px, py, r, 0.3, 0.6 * this.opacity);
        st.px = px; st.py = py;
      } else if (t === "blur") this.dabs(this.g, this.source(), px, py, r, 0.3, this.opacity);
      else this.dabs(this.lg, this.source(), px, py, r, t === "clone" ? Math.min(this.hard, 0.75) : this.hard, 1);
    }
    st.x = x; st.y = y;
    this.changed();
  };
  Painter.prototype.end = function () {
    var st = this.stroke;
    if (!st) return;
    if (!st.direct) {
      this.g.globalAlpha = this.opacity;
      this.g.drawImage(this.layer, 0, 0);
      this.g.globalAlpha = 1;
      this.lg.clearRect(0, 0, PX, PX);
    }
    this.stroke = null;
    this.changed();
  };
  Painter.prototype.flood = function (x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= PX || y >= PX) return;
    var img = this.g.getImageData(0, 0, PX, PX), d = img.data;
    var i0 = (y * PX + x) * 4, r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2];
    var col = hexRgb(this.c1), a = this.opacity, tol = 40;
    var seen = new Uint8Array(PX * PX), stack = [x, y];
    function same(i) { return Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) <= tol; }
    var pts = [];
    while (stack.length) {
      var py = stack.pop(), px = stack.pop();
      if (px < 0 || py < 0 || px >= PX || py >= PX) continue;
      var p = py * PX + px;
      if (seen[p]) continue;
      seen[p] = 1;
      if (!same(p * 4)) continue;
      pts.push(p);
      stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
    }
    var mirror = this.mirror;
    function paintAt(p) { var j = p * 4; d[j] = d[j] * (1 - a) + col[0] * a; d[j + 1] = d[j + 1] * (1 - a) + col[1] * a; d[j + 2] = d[j + 2] * (1 - a) + col[2] * a; }
    pts.forEach(function (p) { paintAt(p); });
    if (mirror) {
      // 對稱：另一側從鏡射點再填一次
      this.g.putImageData(img, 0, 0);
      this.mirror = false;
      if (PX - 1 - x !== x) this.flood(PX - 1 - x, y);
      this.mirror = true;
      return;
    }
    this.g.putImageData(img, 0, 0);
  };
  // 整體調整：hue（度）、sat（%）、bri（%）、con（%）
  Painter.prototype.adjust = function (f) {
    this.snapshot();
    var c = mk(PX), g = c.getContext("2d");
    if ("filter" in g) {
      g.filter = "hue-rotate(" + (f.hue || 0) + "deg) saturate(" + (f.sat || 100) + "%) brightness(" + (f.bri || 100) + "%) contrast(" + (f.con || 100) + "%)" + (f.blur ? " blur(" + f.blur + "px)" : "");
      g.drawImage(this.paint, 0, 0);
      this.g.drawImage(c, 0, 0);
    }
    this.changed();
  };
  Painter.prototype.noise = function (amount) {
    this.snapshot();
    var img = this.g.getImageData(0, 0, PX, PX), d = img.data, a = amount || 28;
    for (var i = 0; i < d.length; i += 4) {
      var n = (Math.random() - 0.5) * a * 2;
      d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    this.g.putImageData(img, 0, 0);
    this.changed();
  };
  // 把整片紋理套在全身（主色＋副色）
  Painter.prototype.fillPattern = function () {
    this.snapshot();
    this.g.globalAlpha = this.opacity;
    this.g.drawImage(pattern(this.pat, this.c1, this.c2, this.patScale), 0, 0);
    this.g.globalAlpha = 1;
    this.changed();
  };
  Painter.prototype.fillAll = function () {
    this.snapshot();
    this.g.globalAlpha = this.opacity;
    this.g.fillStyle = this.c1; this.g.fillRect(0, 0, PX, PX);
    this.g.globalAlpha = 1;
    this.changed();
  };
  Painter.prototype.pickAt = function (x, y) {
    var d = this.g.getImageData(Math.max(0, Math.min(PX - 1, Math.floor(x))), Math.max(0, Math.min(PX - 1, Math.floor(y))), 1, 1).data;
    return rgbHex(d[0], d[1], d[2]);
  };

  // ---------------- 進階變色（2026-11-05 使用者指定「新增更完善變色龍方式」） ----------------
  function imgData(c) { return ctx2(c).getImageData(0, 0, c.width, c.height); }
  function scaled(src, n) { var c = mk(n), g = ctx2(c); g.drawImage(src, 0, 0, n, n); return c; }
  // 環境色：底下照片的大範圍模糊（只取顏色與明暗走向，不含細節）
  function envLayer(under, into) {
    var c = into || mk(PX), g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    if ("filter" in g) { g.filter = "blur(10px)"; g.drawImage(under, 0, 0); g.filter = "none"; }
    else g.drawImage(scaled(under, 16), 0, 0, PX, PX);
    return c;
  }
  // 色調匹配：把剪影內上色層的平均與標準差對齊底下照片（Reinhard 色彩轉移，逐通道），保留已經畫好的花紋
  Painter.prototype.matchTone = function (under, poseId, strength) {
    this.snapshot();
    var a = strength == null ? 0.85 : strength;
    var pd = this.g.getImageData(0, 0, PX, PX), d = pd.data, ud = imgData(under).data, md = imgData(mask(poseId)).data;
    var sp = [0, 0, 0], sq = [0, 0, 0], su = [0, 0, 0], sv = [0, 0, 0], n = 0, i, k;
    for (i = 0; i < d.length; i += 4) {
      if (md[i + 3] < 128) continue;
      n++;
      for (k = 0; k < 3; k++) { sp[k] += d[i + k]; sq[k] += d[i + k] * d[i + k]; su[k] += ud[i + k]; sv[k] += ud[i + k] * ud[i + k]; }
    }
    if (!n) return;
    var mp = [], dp = [], mu = [], du = [];
    for (k = 0; k < 3; k++) {
      mp[k] = sp[k] / n; mu[k] = su[k] / n;
      dp[k] = Math.sqrt(Math.max(1, sq[k] / n - mp[k] * mp[k])); du[k] = Math.sqrt(Math.max(1, sv[k] / n - mu[k] * mu[k]));
    }
    for (i = 0; i < d.length; i += 4) for (k = 0; k < 3; k++) {
      var v = (d[i + k] - mp[k]) / dp[k] * Math.min(du[k], dp[k] * 3) + mu[k];
      d[i + k] = Math.max(0, Math.min(255, d[i + k] * (1 - a) + v * a));
    }
    this.g.putImageData(pd, 0, 0);
    this.changed();
  };
  // 邊緣融合：越靠近剪影邊緣，越換成底下的照片（輪廓線消失在背景裡）
  Painter.prototype.edgeBlend = function (under, poseId, width, strength) {
    this.snapshot();
    var w = width || 6, a = strength == null ? 0.8 : strength;
    var m = mk(PX), mg = m.getContext("2d");
    if ("filter" in mg) { mg.filter = "blur(" + w + "px)"; mg.drawImage(mask(poseId), 0, 0); mg.filter = "none"; }
    else mg.drawImage(scaled(mask(poseId), 32), 0, 0, PX, PX);
    var pd = this.g.getImageData(0, 0, PX, PX), d = pd.data, ud = imgData(under).data, bd = mg.getImageData(0, 0, PX, PX).data, md = imgData(mask(poseId)).data;
    for (var i = 0; i < d.length; i += 4) {
      if (md[i + 3] < 128) continue;
      // 模糊後的遮罩：內部接近 1、邊緣接近 0.5 → 換算成 0（內部）〜1（邊緣）
      var f = Math.max(0, Math.min(1, (1 - bd[i + 3] / 255) * 2)) * a;
      if (f <= 0) continue;
      for (var k = 0; k < 3; k++) d[i + k] = d[i + k] * (1 - f) + ud[i + k] * f;
    }
    this.g.putImageData(pd, 0, 0);
    this.changed();
  };
  // 色票對齊：每個像素換成照片色票裡最接近的顏色（strength 混合）
  Painter.prototype.quantize = function (pal, strength) {
    if (!pal || !pal.length) return;
    this.snapshot();
    var a = strength == null ? 0.7 : strength, cols = pal.map(hexRgb);
    var pd = this.g.getImageData(0, 0, PX, PX), d = pd.data;
    for (var i = 0; i < d.length; i += 4) {
      var best = cols[0], bd = 1e9;
      for (var j = 0; j < cols.length; j++) {
        var c = cols[j], dr = d[i] - c[0], dg = d[i + 1] - c[1], db = d[i + 2] - c[2], v = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (v < bd) { bd = v; best = c; }
      }
      d[i] = d[i] * (1 - a) + best[0] * a; d[i + 1] = d[i + 1] * (1 - a) + best[1] * a; d[i + 2] = d[i + 2] * (1 - a) + best[2] * a;
    }
    this.g.putImageData(pd, 0, 0);
    this.changed();
  };
  // 偽裝熱圖：剪影內跟底下照片差很多的地方塗紅（只有躲的人自己看得到）
  function camoHeat(paint, photo, fig, into) {
    var N = 64, a = mk(N), b = mk(N);
    ctx2(a).drawImage(paint, 0, 0, N, N);
    ctx2(b).drawImage(underlay(photo, fig), 0, 0, N, N);
    var da = imgData(a).data, db = imgData(b).data;
    var h = mk(N), hg = ctx2(h), hd = hg.createImageData(N, N), o = hd.data;
    for (var i = 0; i < da.length; i += 4) {
      var dr = da[i] - db[i], dg = da[i + 1] - db[i + 1], dB = da[i + 2] - db[i + 2];
      var v = Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + dB * dB * 0.11) * 1.6 / 95;
      var t = Math.max(0, Math.min(1, (v - 0.25) / 0.6));
      o[i] = 255; o[i + 1] = Math.round(220 * (1 - t)); o[i + 2] = 40; o[i + 3] = Math.round(t * 190);
    }
    hg.putImageData(hd, 0, 0);
    var c = into || mk(PX), g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, PX, PX);
    g.imageSmoothingEnabled = true;
    g.drawImage(h, 0, 0, PX, PX);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(mask(fig.p), 0, 0);
    g.globalCompositeOperation = "source-over";
    return c;
  }

  window.PriTestMahouFigure = {
    PX: PX, U: U, BASE: BASE, mk: mk, toPx: toPx, toLocal: toLocal,
    mask: mask, render: render, place: place, poseIcon: poseIcon, underlay: underlay, camoScore: camoScore, envLayer: envLayer, camoHeat: camoHeat,
    palette: palette, pattern: pattern, seedOf: seedOf, eyeVariant: eyeVariant, cloneJitter: cloneJitter, rgbHex: rgbHex, hexRgb: hexRgb, Painter: Painter, rng: rng
  };
})();
