// 射彈宇宙（shedan）：Canvas 繪圖。滿版星空背景＋9:16 戰場（540×960 邏輯座標，等比縮放置中）。
// 只負責畫：狀態從 shedan_combat.js 的 battle 與 shedan_physics.js 的 world 讀取；特效用 explode()/floatText()/arc() 加入。
// 瀏覽器掛在 window.PriTestShedanRender。
(function () {
  "use strict";
  var D = window.PriTestShedanData;
  var K = D.C;

  function create(canvas) {
    var r = {
      canvas: canvas, ctx: canvas.getContext("2d"), dpr: 1, scale: 1, ox: 0, oy: 0, cw: 0, ch: 0,
      stars: [], particles: [], floats: [], arcs: [], rings: [], trail: [], lasers: [], bolts: [], shake: 0
    };
    resize(r);
    return r;
  }

  // 讓 canvas 佔滿父元素；計算戰場的縮放與位置
  function resize(r) {
    var c = r.canvas;
    var w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    r.dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * r.dpr);
    c.height = Math.round(h * r.dpr);
    r.cw = w; r.ch = h;
    r.scale = Math.min(w / K.FIELD_W, h / K.FIELD_H);
    r.ox = (w - K.FIELD_W * r.scale) / 2;
    r.oy = (h - K.FIELD_H * r.scale) / 2;
    var n = Math.round(w * h / 2600);
    r.stars = [];
    for (var i = 0; i < n; i++) {
      r.stars.push({ x: Math.random() * w, y: Math.random() * h, s: Math.random() * 1.4 + 0.3, p: Math.random() * 6.28, hue: Math.random() < 0.15 ? 220 + Math.random() * 80 : 0 });
    }
  }

  // 戰場在畫面上的範圍（CSS px），給 HUD 對齊用
  function fieldRect(r) { return { left: r.ox, top: r.oy, width: K.FIELD_W * r.scale, height: K.FIELD_H * r.scale }; }
  function toField(r, clientX, clientY) {
    var rect = r.canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - r.ox) / r.scale, y: (clientY - rect.top - r.oy) / r.scale };
  }

  // ---------------- 特效 ----------------
  function explode(r, x, y, radius, depth, color) {
    var col = color || (depth > 0 ? "#ff7ad9" : "#ffd36b");
    r.rings.push({ x: x, y: y, radius: radius, t: 0, life: 0.45, color: col });
    var n = 14 + Math.min(20, depth * 4);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 4.5;
      r.particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.5 + Math.random() * 0.4, color: col, size: 2 + Math.random() * 3 });
    }
    r.shake = Math.min(10, r.shake + 2 + depth);
  }
  function spark(r, x, y, color) {
    for (var i = 0; i < 6; i++) {
      var a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.5;
      r.particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.3, color: color, size: 2 });
    }
  }
  function floatText(r, x, y, text, color, big) {
    r.floats.push({ x: x + (Math.random() - 0.5) * 14, y: y, text: text, color: color || "#fff", t: 0, life: big ? 1.1 : 0.8, big: !!big });
  }
  function arc(r, x1, y1, x2, y2) { r.arcs.push({ x1: x1, y1: y1, x2: x2, y2: y2, t: 0, life: 0.25 }); }
  function laser(r, x1, y1, x2, y2, el) { r.lasers.push({ x1: x1, y1: y1, x2: x2, y2: y2, color: elColor(el), t: 0, life: 0.35 }); }
  function bolt(r, x1, y1, x2, y2, el) { r.bolts.push({ x1: x1, y1: y1, x2: x2, y2: y2, color: elColor(el), t: 0, life: 0.3 }); }
  function trailPush(r, x, y) { r.trail.push({ x: x, y: y }); if (r.trail.length > 28) r.trail.shift(); }
  function trailClear(r) { r.trail = []; }

  // ---------------- 繪圖 ----------------
  function draw(r, v, dt) {
    var ctx = r.ctx, now = v.time / 1000;
    ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    drawBackground(r, ctx, now);
    r.shake = Math.max(0, r.shake - dt * 30);
    var sx = r.shake ? (Math.random() - 0.5) * r.shake : 0, sy = r.shake ? (Math.random() - 0.5) * r.shake : 0;
    ctx.setTransform(r.dpr * r.scale, 0, 0, r.dpr * r.scale, r.dpr * (r.ox + sx), r.dpr * (r.oy + sy));
    drawField(ctx);
    if (v.battle) {
      drawWells(ctx, v.wells || [], now);
      drawStars(ctx, v.battle, v.lit || [], now);
      drawZones(ctx, v.battle, now);
      drawRocks(ctx, v.battle, now);
      drawEchoes(ctx, v.battle, now);
      drawEnemies(ctx, v.battle, now);
      drawWalls(ctx, v.walls || []);
      drawDebris(ctx, v.debris || []);
      drawTrail(r, ctx, v);
      if (v.ghost) drawGhost(ctx, v.ghost, v.battle, now);
      drawHeroes(ctx, v, now);
      if (v.aim) drawAim(ctx, v.aim);
    }
    drawEffects(r, ctx, dt);
  }

  function drawBackground(r, ctx, now) {
    var g = ctx.createRadialGradient(r.cw * 0.5, r.ch * 0.35, 10, r.cw * 0.5, r.ch * 0.5, Math.max(r.cw, r.ch) * 0.8);
    g.addColorStop(0, "#1a1440");
    g.addColorStop(0.55, "#0a0b22");
    g.addColorStop(1, "#03040c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, r.cw, r.ch);
    for (var i = 0; i < r.stars.length; i++) {
      var s = r.stars[i];
      var a = 0.35 + 0.65 * Math.abs(Math.sin(now * 0.8 + s.p));
      ctx.fillStyle = s.hue ? "hsla(" + s.hue + ",80%,75%," + a + ")" : "rgba(255,255,255," + a + ")";
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
  }

  function drawField(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(20, 24, 60, 0.35)";
    ctx.fillRect(0, 0, K.FIELD_W, K.FIELD_H);
    ctx.strokeStyle = "rgba(120, 140, 255, 0.08)";
    ctx.lineWidth = 1;
    for (var x = 60; x < K.FIELD_W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, K.FIELD_H); ctx.stroke(); }
    for (var y = 60; y < K.FIELD_H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(K.FIELD_W, y); ctx.stroke(); }
    ctx.shadowColor = "#6f7bff";
    ctx.shadowBlur = 14;
    ctx.strokeStyle = "rgba(150, 170, 255, 0.8)";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, K.FIELD_W - 3, K.FIELD_H - 3);
    ctx.restore();
  }

  function drawZones(ctx, b, now) {
    b.zones.forEach(function (z) {
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.08 * Math.sin(now * 6);
      ctx.fillStyle = D.ELEMENT_INFO.plasma.color;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
  }

  function elColor(el) { return (D.ELEMENT_INFO[el] || {}).color || "#ccc"; }

  // ---------------- 場地機關（第 2 階段） ----------------
  function drawWells(ctx, wells, now) {
    wells.forEach(function (g) {
      ctx.save();
      var col = g.hole ? "#ff4fd8" : "#b07cff";
      var grd = ctx.createRadialGradient(g.x, g.y, 4, g.x, g.y, g.radius);
      grd.addColorStop(0, g.hole ? "rgba(0,0,0,0.95)" : "rgba(176,124,255,0.35)");
      grd.addColorStop(0.25, g.hole ? "rgba(60,0,60,0.7)" : "rgba(120,80,220,0.18)");
      grd.addColorStop(1, "rgba(80,40,160,0)");
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      for (var i = 0; i < 3; i++) {
        var a = now * (1.2 + i * 0.3) + i * 2.1, rr = g.radius * (0.35 + i * 0.22);
        ctx.globalAlpha = 0.5 - i * 0.12;
        ctx.beginPath(); ctx.arc(g.x, g.y, rr, a, a + Math.PI * 1.2); ctx.stroke();
      }
      if (g.hole) {
        ctx.globalAlpha = 1;
        ctx.shadowColor = col; ctx.shadowBlur = 18;
        ctx.fillStyle = "#000";
        ctx.beginPath(); ctx.arc(g.x, g.y, K.HOLE_R, 0, Math.PI * 2); ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawStars(ctx, b, lit, now) {
    if (!b.stars || !b.stars.length) return;
    ctx.save();
    if (lit.length > 1) {
      ctx.strokeStyle = "rgba(255, 236, 160, 0.85)";
      ctx.lineWidth = 3;
      ctx.shadowColor = "#ffe27a"; ctx.shadowBlur = 12;
      ctx.beginPath();
      lit.forEach(function (idx, k) { var s = b.stars[idx]; if (k) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      ctx.stroke();
    }
    b.stars.forEach(function (s, i) {
      var on = lit.indexOf(i) >= 0;
      var size = on ? 11 : 7 + Math.sin(now * 3 + i) * 1.5;
      ctx.shadowColor = on ? "#ffe27a" : "#9fb4ff"; ctx.shadowBlur = on ? 20 : 10;
      ctx.fillStyle = on ? "#fff3b0" : "rgba(200, 215, 255, 0.85)";
      ctx.beginPath();
      for (var k = 0; k < 8; k++) {
        var rr = k % 2 ? size * 0.38 : size, a = -Math.PI / 2 + k * Math.PI / 4;
        var px = s.x + Math.cos(a) * rr, py = s.y + Math.sin(a) * rr;
        if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill();
    });
    ctx.restore();
  }

  function drawRocks(ctx, b) {
    (b.rocks || []).forEach(function (r) {
      if (r.broken) return;
      ctx.save();
      ctx.fillStyle = "#4a4458";
      ctx.strokeStyle = "#8a83a0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var i = 0; i < 9; i++) {
        var a = i * Math.PI * 2 / 9, rr = r.r * (0.82 + 0.18 * Math.sin(i * 2.7 + r.x));
        var px = r.x + Math.cos(a) * rr, py = r.y + Math.sin(a) * rr;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 裂痕：耐久越少越多
      ctx.strokeStyle = "#ffb070";
      ctx.lineWidth = 1.5;
      for (var c = 0; c < K.ROCK_DUR - r.dur; c++) {
        var a0 = c * 2.1 + r.y * 0.01;
        ctx.beginPath(); ctx.moveTo(r.x, r.y);
        ctx.lineTo(r.x + Math.cos(a0) * r.r * 0.8, r.y + Math.sin(a0) * r.r * 0.8);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawEchoes(ctx, b, now) {
    (b.echoes || []).forEach(function (c) {
      ctx.save();
      ctx.strokeStyle = elColor(c.el);
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(now * 5);
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(c.x, c.y, c.range * 0.6, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    });
  }

  function drawWalls(ctx, walls) {
    walls.forEach(function (w) {
      ctx.save();
      ctx.strokeStyle = "#bff0ff";
      ctx.shadowColor = "#7fd8ff"; ctx.shadowBlur = 14;
      ctx.lineWidth = 12;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
      ctx.restore();
    });
  }

  function drawDebris(ctx, list) {
    list.forEach(function (d) {
      ctx.save();
      ctx.fillStyle = elColor(d.el);
      ctx.shadowColor = elColor(d.el); ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(d.x, d.y, K.DEBRIS_R, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
  }

  function drawGhost(ctx, g, b, now) {
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.15 * Math.sin(now * 10);
    ctx.fillStyle = elColor(b.party[b.active].element);
    ctx.shadowColor = "#fff"; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(g.x, g.y, K.HERO_R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawEnemies(ctx, b, now) {
    b.enemies.forEach(function (e) {
      if (e.dead) return;
      var weak = e.def.weak[0];
      var base = weak ? elColor(weak) : "#c8c8d8";
      ctx.save();
      // 本體：發光的多邊形（大小不同邊數不同）
      var sides = e.def.size === "s" ? 5 : e.def.size === "m" ? 6 : 8;
      var rot = now * (e.def.size === "s" ? 0.9 : 0.4) + e.x * 0.01;
      ctx.shadowColor = base;
      ctx.shadowBlur = 16;
      ctx.fillStyle = "rgba(12, 14, 30, 0.9)";
      ctx.strokeStyle = base;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (var i = 0; i < sides; i++) {
        var a = rot + i * Math.PI * 2 / sides;
        var px = e.x + Math.cos(a) * e.r, py = e.y + Math.sin(a) * e.r;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      // 核心
      ctx.fillStyle = base;
      ctx.globalAlpha = 0.55 + 0.25 * Math.sin(now * 3 + e.y);
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // 倒數
      ctx.fillStyle = e.cd <= 1 ? "#ff5a6a" : "#fff";
      ctx.font = "bold " + Math.max(12, e.r * 0.8) + "px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(e.cd), e.x, e.y + 1);
      // HP 條
      var bw = Math.max(34, e.r * 2), by = e.y + e.r + 7;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(e.x - bw / 2, by, bw, 5);
      ctx.fillStyle = "#ff5a8a";
      ctx.fillRect(e.x - bw / 2, by, bw * Math.max(0, e.hp / e.hpMax), 5);
      // 印記
      if (e.mark) {
        var info = D.ELEMENT_INFO[e.mark.el];
        ctx.fillStyle = info.color;
        ctx.font = "bold 15px sans-serif";
        ctx.shadowColor = info.color; ctx.shadowBlur = 8;
        ctx.fillText(info.icon, e.x + e.r * 0.85, e.y - e.r * 0.85);
      }
      ctx.restore();
    });
  }

  function drawTrail(r, ctx, v) {
    if (r.trail.length < 2 || v.shooter == null) return;
    var col = elColor(v.battle.party[v.shooter].element);
    ctx.save();
    for (var i = 1; i < r.trail.length; i++) {
      ctx.globalAlpha = i / r.trail.length * 0.6;
      ctx.strokeStyle = col;
      ctx.lineWidth = K.HERO_R * 1.2 * i / r.trail.length;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(r.trail[i - 1].x, r.trail[i - 1].y); ctx.lineTo(r.trail[i].x, r.trail[i].y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawHeroes(ctx, v, now) {
    var b = v.battle;
    b.party.forEach(function (p, i) {
      var pos = v.heroPos(i), active = i === b.active;
      var col = elColor(p.element);
      var R = v.heroRadius ? v.heroRadius(i) : K.HERO_R;
      ctx.save();
      ctx.shadowColor = active ? "#ffe27a" : col;
      ctx.shadowBlur = active ? 18 + 6 * Math.sin(now * 5) : 8;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, R, 0, Math.PI * 2);
      ctx.fillStyle = "#111";
      ctx.fill();
      ctx.shadowBlur = 0;
      var img = v.imgs[p.id];
      if (img && img.complete && img.naturalWidth) {
        ctx.save();
        ctx.beginPath(); ctx.arc(pos.x, pos.y, R - 2, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(img, pos.x - R, pos.y - R, R * 2, R * 2);
        ctx.restore();
      }
      ctx.lineWidth = active ? 4 : 2.5;
      ctx.strokeStyle = active ? "#ffe27a" : col;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, R, 0, Math.PI * 2); ctx.stroke();
      // 技能量表（外圈）
      ctx.lineWidth = 3;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, R + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.gauge / p.gaugeMax);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawAim(ctx, aim) {
    ctx.save();
    var len = Math.sqrt(aim.dx * aim.dx + aim.dy * aim.dy);
    if (len < 1) { ctx.restore(); return; }
    var ux = aim.dx / len, uy = aim.dy / len;
    var reach = 120 + len * 2.2;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -(Date.now() / 30) % 18;
    ctx.strokeStyle = "rgba(255, 240, 180, 0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(aim.x, aim.y); ctx.lineTo(aim.x + ux * reach, aim.y + uy * reach); ctx.stroke();
    ctx.setLineDash([]);
    // 拉弓的皮筋
    ctx.strokeStyle = "rgba(160, 200, 255, 0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(aim.x, aim.y); ctx.lineTo(aim.x - ux * len, aim.y - uy * len); ctx.stroke();
    // 力道
    ctx.fillStyle = "#ffe27a";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(Math.round(aim.power * 100) + "%", aim.x - ux * len, aim.y - uy * len - 12);
    ctx.restore();
  }

  function drawEffects(r, ctx, dt) {
    ctx.save();
    r.rings = r.rings.filter(function (g) {
      g.t += dt;
      var k = g.t / g.life;
      if (k >= 1) return false;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = g.color;
      ctx.shadowColor = g.color; ctx.shadowBlur = 20;
      ctx.lineWidth = 6 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.radius * (0.3 + 0.7 * k), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = (1 - k) * 0.25;
      ctx.fillStyle = g.color;
      ctx.fill();
      return true;
    });
    ctx.shadowBlur = 0;
    r.particles = r.particles.filter(function (p) {
      p.t += dt;
      if (p.t >= p.life) return false;
      p.x += p.vx * dt * 60; p.y += p.vy * dt * 60;
      p.vx *= 0.94; p.vy *= 0.94;
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      return true;
    });
    r.arcs = r.arcs.filter(function (a) {
      a.t += dt;
      if (a.t >= a.life) return false;
      ctx.globalAlpha = 1 - a.t / a.life;
      ctx.strokeStyle = D.ELEMENT_INFO.plasma.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(a.x1, a.y1);
      for (var i = 1; i < 6; i++) {
        var k = i / 6;
        ctx.lineTo(a.x1 + (a.x2 - a.x1) * k + (Math.random() - 0.5) * 16, a.y1 + (a.y2 - a.y1) * k + (Math.random() - 0.5) * 16);
      }
      ctx.lineTo(a.x2, a.y2); ctx.stroke();
      return true;
    });
    r.lasers = r.lasers.filter(function (l) {
      l.t += dt;
      if (l.t >= l.life) return false;
      var k = l.t / l.life;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = l.color;
      ctx.shadowColor = l.color; ctx.shadowBlur = 18;
      ctx.lineWidth = 18 * (1 - k) + 3;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.stroke();
      return true;
    });
    r.bolts = r.bolts.filter(function (o) {
      o.t += dt;
      if (o.t >= o.life) return false;
      var k = o.t / o.life, hx = o.x1 + (o.x2 - o.x1) * Math.min(1, k * 1.6), hy = o.y1 + (o.y2 - o.y1) * Math.min(1, k * 1.6);
      ctx.globalAlpha = 1 - k * 0.6;
      ctx.strokeStyle = o.color;
      ctx.shadowColor = o.color; ctx.shadowBlur = 12;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(o.x1 + (hx - o.x1) * 0.6, o.y1 + (hy - o.y1) * 0.6); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();
      return true;
    });
    ctx.shadowBlur = 0;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    r.floats = r.floats.filter(function (f) {
      f.t += dt;
      if (f.t >= f.life) return false;
      var k = f.t / f.life;
      ctx.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
      ctx.font = "bold " + (f.big ? 26 : 16) + "px sans-serif";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      var y = f.y - k * (f.big ? 50 : 34);
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, y);
      return true;
    });
    ctx.restore();
  }

  window.PriTestShedanRender = {
    create: create, resize: resize, draw: draw, fieldRect: fieldRect, toField: toField,
    explode: explode, spark: spark, floatText: floatText, arc: arc, laser: laser, bolt: bolt, trailPush: trailPush, trailClear: trailClear
  };
})();
