// 魔法變色龍（mahou）：內建場景。沒有照片時用程序產生的背景（同一個 id＋seed 在每台裝置畫出一樣的圖）。
// 場景刻意做得紋理豐富、顏色多，小人物才有地方躲。2026-11-05 依使用者需求新增。
(function () {
  "use strict";

  var F = window.PriTestMahouFigure;
  var W = 1050, H = 700;

  function hsl(h, s, l, a) { return "hsla(" + Math.round(h) + "," + Math.round(s) + "%," + Math.round(l) + "%," + (a === undefined ? 1 : a) + ")"; }
  function grad(g, y0, y1, stops) {
    var gr = g.createLinearGradient(0, y0, 0, y1);
    stops.forEach(function (s) { gr.addColorStop(s[0], s[1]); });
    return gr;
  }
  function blob(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2); g.fill(); }
  function speckle(g, R, n, x0, y0, w, h, colorFn, size) {
    for (var i = 0; i < n; i++) { g.fillStyle = colorFn(R()); var s = (size || 3) * (0.4 + R()); g.fillRect(x0 + R() * w, y0 + R() * h, s, s); }
  }

  var DRAW = {
    forest: function (g, R) {
      g.fillStyle = grad(g, 0, H, [[0, "#cfe8c9"], [0.55, "#6fa45a"], [1, "#2f4f22"]]); g.fillRect(0, 0, W, H);
      var i, x;
      for (i = 0; i < 60; i++) { g.fillStyle = hsl(95 + R() * 40, 35 + R() * 30, 40 + R() * 25, 0.6); blob(g, R() * W, R() * H * 0.5, 40 + R() * 90, 30 + R() * 60); }
      for (i = 0; i < 14; i++) {
        x = R() * W; var tw = 18 + R() * 40;
        g.fillStyle = hsl(25 + R() * 15, 30 + R() * 20, 20 + R() * 15);
        g.fillRect(x, H * 0.15 + R() * 80, tw, H);
        for (var k = 0; k < 20; k++) { g.fillStyle = hsl(25, 25, 12 + R() * 20, 0.5); g.fillRect(x + R() * tw, H * 0.2 + R() * H, 2 + R() * 4, 10 + R() * 30); }
      }
      for (i = 0; i < 220; i++) { g.fillStyle = hsl(80 + R() * 60, 40 + R() * 40, 25 + R() * 35, 0.8); blob(g, R() * W, H * 0.55 + R() * H * 0.5, 10 + R() * 40, 6 + R() * 20, R() * 3); }
      for (i = 0; i < 60; i++) { g.fillStyle = hsl(40 + R() * 30, 70, 55 + R() * 20, 0.85); blob(g, R() * W, H * 0.65 + R() * H * 0.35, 4 + R() * 6, 4 + R() * 6); }
      speckle(g, R, 3000, 0, 0, W, H, function (v) { return hsl(90 + v * 50, 40, 20 + v * 50, 0.35); }, 3);
    },
    flowers: function (g, R) {
      g.fillStyle = grad(g, 0, H, [[0, "#9fd8ff"], [0.3, "#d8f1ff"], [0.32, "#8fcf6a"], [1, "#3f8a3a"]]); g.fillRect(0, 0, W, H);
      var i;
      for (i = 0; i < 8; i++) { g.fillStyle = "rgba(255,255,255,0.85)"; var cx = R() * W, cy = R() * H * 0.2; for (var k = 0; k < 5; k++) blob(g, cx + k * 22, cy + R() * 10, 30, 18); }
      for (i = 0; i < 900; i++) { g.strokeStyle = hsl(90 + R() * 40, 50, 25 + R() * 30); g.lineWidth = 1.5 + R() * 2; var x = R() * W, y = H * 0.32 + R() * H * 0.7; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 12, y - 10 - R() * 30); g.stroke(); }
      var hues = [0, 30, 50, 280, 320, 200, 340];
      for (i = 0; i < 520; i++) {
        var fx = R() * W, fy = H * 0.34 + R() * H * 0.66, fs = 4 + (fy / H) * 12 * (0.6 + R() * 0.6), hue = hues[Math.floor(R() * hues.length)];
        g.fillStyle = hsl(hue, 80, 55 + R() * 20);
        for (var p = 0; p < 5; p++) { var a = p * Math.PI * 2 / 5; blob(g, fx + Math.cos(a) * fs * 0.6, fy + Math.sin(a) * fs * 0.6, fs * 0.55, fs * 0.38, a); }
        g.fillStyle = hsl(50, 90, 55); blob(g, fx, fy, fs * 0.3, fs * 0.3);
      }
    },
    bricks: function (g, R) {
      g.fillStyle = "#8a4a32"; g.fillRect(0, 0, W, H);
      var bw = 70, bh = 30, y, x, row = 0;
      for (y = 0; y < H; y += bh, row++) for (x = -(row % 2) * bw / 2; x < W; x += bw) {
        g.fillStyle = hsl(10 + R() * 18, 40 + R() * 25, 30 + R() * 20); g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        speckle(g, R, 14, x, y, bw, bh, function (v) { return hsl(15, 30, 20 + v * 40, 0.5); }, 3);
      }
      var cols = ["#ff3d7f", "#ffd23f", "#3cc8ff", "#7bff6b", "#a66cff", "#ff8f2b", "#ffffff"];
      for (var i = 0; i < 22; i++) {
        g.strokeStyle = cols[Math.floor(R() * cols.length)]; g.lineWidth = 6 + R() * 18; g.lineCap = "round";
        g.beginPath(); var sx = R() * W, sy = R() * H; g.moveTo(sx, sy);
        for (var k = 0; k < 4; k++) g.quadraticCurveTo(sx + (R() - 0.5) * 300, sy + (R() - 0.5) * 200, sx += (R() - 0.5) * 260, sy += (R() - 0.5) * 180);
        g.stroke();
      }
      for (i = 0; i < 30; i++) { g.fillStyle = cols[Math.floor(R() * cols.length)]; blob(g, R() * W, R() * H, 8 + R() * 40, 8 + R() * 40); }
      g.font = "bold 90px sans-serif"; g.fillStyle = "rgba(255,255,255,0.75)"; g.fillText("HIDE!", W * 0.55, H * 0.35);
    },
    beach: function (g, R) {
      g.fillStyle = grad(g, 0, H, [[0, "#6ec6ff"], [0.3, "#bfe9ff"], [0.32, "#1f8fd0"], [0.5, "#5fd0e0"], [0.55, "#f3dfa8"], [1, "#d9b77a"]]); g.fillRect(0, 0, W, H);
      var i;
      g.fillStyle = "#fff6b0"; blob(g, W * 0.85, H * 0.1, 45, 45);
      for (i = 0; i < 160; i++) { g.strokeStyle = "rgba(255,255,255," + (0.3 + R() * 0.5).toFixed(2) + ")"; g.lineWidth = 2; var y = H * 0.33 + R() * H * 0.2, x = R() * W; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 20, y - 4, x + 40 + R() * 30, y); g.stroke(); }
      speckle(g, R, 9000, 0, H * 0.55, W, H * 0.45, function (v) { return hsl(38 + v * 12, 45, 55 + v * 30, 0.6); }, 3);
      for (i = 0; i < 40; i++) { g.fillStyle = hsl(R() * 360, 50, 75); blob(g, R() * W, H * 0.6 + R() * H * 0.4, 6 + R() * 10, 4 + R() * 6, R() * 3); }
      g.fillStyle = "#ff5a5a"; g.beginPath(); g.moveTo(W * 0.2, H * 0.55); g.arc(W * 0.2, H * 0.62, 120, Math.PI, 0); g.fill();
      g.fillStyle = "#fff"; for (i = 0; i < 4; i++) { g.beginPath(); g.moveTo(W * 0.2, H * 0.62); g.arc(W * 0.2, H * 0.62, 120, Math.PI + i * Math.PI / 4, Math.PI + i * Math.PI / 4 + Math.PI / 8); g.fill(); }
      g.fillStyle = "#6b4a2a"; g.fillRect(W * 0.2 - 4, H * 0.55, 8, H * 0.3);
      g.fillStyle = "#2b9fff"; g.fillRect(W * 0.6, H * 0.8, 200, 70); g.fillStyle = "#ffd23f"; for (i = 0; i < 6; i++) g.fillRect(W * 0.6 + i * 34, H * 0.8, 17, 70);
    },
    books: function (g, R) {
      g.fillStyle = "#5a3a22"; g.fillRect(0, 0, W, H);
      var shelf = 140;
      for (var y = 0; y < H; y += shelf) {
        g.fillStyle = "#3d2614"; g.fillRect(0, y + shelf - 16, W, 16);
        var x = 8;
        while (x < W - 10) {
          var bw = 14 + R() * 30, bh = shelf - 30 - R() * 40, hue = R() * 360;
          g.fillStyle = hsl(hue, 30 + R() * 50, 25 + R() * 45);
          if (R() < 0.12) { g.save(); g.translate(x, y + shelf - 16); g.rotate(-0.25); g.fillRect(0, -bh, bw, bh); g.restore(); x += bw + 12; continue; }
          g.fillRect(x, y + shelf - 16 - bh, bw, bh);
          g.fillStyle = hsl(hue, 40, 75, 0.7); g.fillRect(x + 2, y + shelf - 16 - bh + 10, bw - 4, 4); g.fillRect(x + 2, y + shelf - 30, bw - 4, 3);
          x += bw + 1 + R() * 3;
        }
      }
      speckle(g, R, 1500, 0, 0, W, H, function (v) { return "rgba(0,0,0," + (v * 0.25).toFixed(2) + ")"; }, 2);
    },
    city: function (g, R) {
      g.fillStyle = grad(g, 0, H, [[0, "#0b0f2a"], [0.6, "#2a1e55"], [1, "#151018"]]); g.fillRect(0, 0, W, H);
      var i;
      for (i = 0; i < 160; i++) { g.fillStyle = "rgba(255,255,255," + (R() * 0.9).toFixed(2) + ")"; g.fillRect(R() * W, R() * H * 0.45, 1.5, 1.5); }
      g.fillStyle = "#f5f0c8"; blob(g, W * 0.15, H * 0.12, 30, 30);
      var x = 0;
      while (x < W) {
        var bw = 50 + R() * 90, bh = 160 + R() * 360;
        g.fillStyle = hsl(240 + R() * 40, 20, 12 + R() * 12); g.fillRect(x, H - bh, bw, bh);
        for (var wy = H - bh + 12; wy < H - 10; wy += 18) for (var wx = x + 8; wx < x + bw - 10; wx += 14) {
          if (R() < 0.55) { g.fillStyle = hsl(40 + R() * 20, 90, 55 + R() * 25, 0.9); g.fillRect(wx, wy, 7, 9); }
        }
        x += bw + R() * 8;
      }
      var neon = ["#ff3dbb", "#3dfff2", "#ffe03d", "#7b5cff"];
      for (i = 0; i < 12; i++) { g.strokeStyle = neon[i % 4]; g.lineWidth = 4; g.shadowColor = neon[i % 4]; g.shadowBlur = 12; g.strokeRect(R() * W, H * 0.45 + R() * H * 0.45, 40 + R() * 80, 16 + R() * 30); }
      g.shadowBlur = 0;
    },
    candy: function (g, R) {
      g.fillStyle = "#ffe3f0"; g.fillRect(0, 0, W, H);
      var i, s = 70;
      for (var y = 0; y < H; y += s) for (var x = 0; x < W; x += s) if (((x + y) / s) % 2 === 0) { g.fillStyle = "#ffc6df"; g.fillRect(x, y, s, s); }
      var cols = ["#ff5fa2", "#ffd23f", "#6fe0ff", "#9be15d", "#b48cff", "#ff8f4b", "#ffffff"];
      for (i = 0; i < 70; i++) {
        var cx = R() * W, cy = R() * H, r = 18 + R() * 34;
        g.fillStyle = cols[Math.floor(R() * cols.length)]; blob(g, cx, cy, r, r);
        g.strokeStyle = cols[Math.floor(R() * cols.length)]; g.lineWidth = r * 0.25;
        g.beginPath(); for (var a = 0; a < Math.PI * 6; a += 0.3) g.lineTo(cx + Math.cos(a) * a * r / 19, cy + Math.sin(a) * a * r / 19); g.stroke();
      }
      for (i = 0; i < 300; i++) { g.fillStyle = cols[Math.floor(R() * cols.length)]; g.save(); g.translate(R() * W, R() * H); g.rotate(R() * 3); g.fillRect(-6, -2, 12, 4); g.restore(); }
    },
    autumn: function (g, R) {
      g.fillStyle = "#7a5a3a"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#a88a62"; g.beginPath(); g.moveTo(W * 0.35, 0); g.bezierCurveTo(W * 0.2, H * 0.4, W * 0.7, H * 0.6, W * 0.45, H); g.lineTo(W * 0.75, H); g.bezierCurveTo(W * 0.95, H * 0.6, W * 0.4, H * 0.4, W * 0.6, 0); g.fill();
      speckle(g, R, 5000, 0, 0, W, H, function (v) { return hsl(30, 25, 30 + v * 35, 0.5); }, 3);
      for (var i = 0; i < 900; i++) {
        var hue = [5, 18, 30, 42, 55, 80][Math.floor(R() * 6)];
        g.fillStyle = hsl(hue, 70 + R() * 25, 35 + R() * 25, 0.92);
        g.save(); g.translate(R() * W, R() * H); g.rotate(R() * Math.PI * 2);
        var s = 8 + R() * 16;
        g.beginPath(); g.moveTo(0, -s); g.quadraticCurveTo(s * 0.8, 0, 0, s); g.quadraticCurveTo(-s * 0.8, 0, 0, -s); g.fill();
        g.strokeStyle = "rgba(60,30,10,0.5)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -s); g.lineTo(0, s); g.stroke();
        g.restore();
      }
    },
    rocks: function (g, R) {
      g.fillStyle = grad(g, 0, H, [[0, "#7fb6c9"], [0.25, "#4e8fa3"], [0.3, "#9a9282"], [1, "#6c665c"]]); g.fillRect(0, 0, W, H);
      for (var i = 0; i < 420; i++) {
        var y = H * 0.25 + R() * H * 0.8, sc = 0.4 + (y / H), rx = (10 + R() * 26) * sc, ry = rx * (0.55 + R() * 0.3);
        var l = 35 + R() * 40, hue = 25 + R() * 30;
        g.fillStyle = hsl(hue, 8 + R() * 14, l); blob(g, R() * W, y, rx, ry, (R() - 0.5) * 0.6);
      }
      speckle(g, R, 6000, 0, H * 0.25, W, H, function (v) { return hsl(30, 10, 25 + v * 60, 0.45); }, 2);
      for (i = 0; i < 30; i++) { g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 2; var x = R() * W, yy = R() * H * 0.25; g.beginPath(); g.moveTo(x, yy); g.lineTo(x + 30 + R() * 50, yy); g.stroke(); }
    },
    toys: function (g, R) {
      g.fillStyle = "#e9d4a8"; g.fillRect(0, 0, W, H);
      var cols = ["#e63946", "#f4a261", "#2a9d8f", "#264653", "#e9c46a", "#8ecae6", "#9b5de5", "#00bb7a"];
      for (var i = 0; i < 160; i++) {
        var x = R() * W, y = R() * H, s = 24 + R() * 60, c = cols[Math.floor(R() * cols.length)], kind = Math.floor(R() * 4);
        g.save(); g.translate(x, y); g.rotate((R() - 0.5) * 1.2);
        g.fillStyle = c;
        if (kind === 0) { g.fillRect(-s / 2, -s / 3, s, s * 0.66); g.fillStyle = "rgba(255,255,255,0.35)"; for (var k = 0; k < 3; k++) blob(g, -s / 3 + k * s / 3, -s / 3, s * 0.1, s * 0.07); }
        else if (kind === 1) { blob(g, 0, 0, s / 2, s / 2); g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(-s / 2, -s * 0.08, s, s * 0.16); }
        else if (kind === 2) { g.beginPath(); g.moveTo(0, -s / 2); g.lineTo(s / 2, s / 2); g.lineTo(-s / 2, s / 2); g.closePath(); g.fill(); }
        else { g.fillRect(-s / 2, -s / 2, s, s); g.fillStyle = "#fff"; g.font = "bold " + Math.round(s * 0.6) + "px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("ABCXYZ"[Math.floor(R() * 6)], 0, 2); }
        g.restore();
      }
    }
  };

  var cache = {};
  function render(id, seed) {
    var key = id + ":" + seed;
    if (cache[key]) return cache[key];
    var c = F.mk(W, H), g = c.getContext("2d");
    (DRAW[id] || DRAW.forest)(g, F.rng((seed >>> 0) || 1));
    cache[key] = c;
    return c;
  }
  function thumb(id, w) {
    var src = render(id, 12345), c = F.mk(w, Math.round(w * H / W));
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  window.PriTestMahouScenes = { W: W, H: H, AR: W / H, render: render, thumb: thumb };
})();
