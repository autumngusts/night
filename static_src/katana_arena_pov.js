// 對刀場的演出（使用者指定 2026-10-21：兩種模式更多特效・表演感，並能以「刀視角」第一人稱觀戰）。
// 這裡只負責畫面：不讀寫引擎的隨機數、不改對刀場狀態，所以連線／重播／批次測試的結果完全不受影響。
//   createFx()  打擊感導演：頓幀（hit-stop）、慢動作、畫面震動、閃光、受擊暗角。俯瞰與刀視角共用。
//   createCam() 刀視角的攝影機（跟著哪一把刀、朝向、FOV 衝刺、傾斜、前景刀的姿勢）。
//   draw()      以那把刀的位置為眼睛，把 2D 的圓形場地畫成偽 3D：土俵・四本柱・提燈・對手刀（側視圖看板）・前景自己的刀。
// 規格見 docs/katana_game_design.md §7.7。
(function () {
  "use strict";
  var TAU = Math.PI * 2;
  var EYE_H = 9, BLADE_H = 6, WALL_H = 5, FOV = 1.45, NEAR = 2.5;
  var SIDE_GUARD = 0.225, SIDE_ASPECT = 1024 / 144; // 側視圖：鍔在圖寬 22.5% 處，刀尖朝右（docs/katana_art_spec.md）
  // 四本柱（青・赤・白・黒）與吊り提燈：純佈景，位置固定在場外
  var PILLARS = [[150, -150, "#2f5d8f"], [150, 150, "#a33a2a"], [-150, 150, "#d8d2c4"], [-150, -150, "#26211d"]];
  var LANTERNS = [];
  for (var li = 0; li < 16; li++) LANTERNS.push([Math.cos(li / 16 * TAU + 0.2) * 178, Math.sin(li / 16 * TAU + 0.2) * 178]);
  // 前景刀的姿勢：[鍔的位置 x, y（畫面寬高的比例）, 刀身方向（弧度，0＝朝右）, 不透明度]
  var POSE = {
    sheathe: [1.0, 1.16, -2.85, 0.9],
    aim: [0.86, 0.98, -2.05, 1],
    slash: [0.66, 1.02, -2.5, 1],
    lock: [0.74, 1.04, -2.05, 1],
    recoil: [1.02, 1.12, -3.05, 0.9]
  };

  function hexRgb(h) { var n = parseInt(String(h).slice(1), 16); return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255); }
  function angDiff(a, b) { var d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function byId(a, id) { for (var i = 0; i < a.fighters.length; i++) if (a.fighters[i].id === id) return a.fighters[i]; return null; }
  function lockOp(a, f) {
    if (!f.alive) return null;
    if (f.sh && f.sh.st === "lock") return byId(a, f.sh.op);
    for (var i = 0; i < a.binds.length; i++) { var b = a.binds[i]; if (b.a === f) return b.b; if (b.b === f) return b.a; }
    return null;
  }

  // ---------------- 打擊感導演 ----------------
  // noTime：連線對刀不改時間流速（只震動・閃光），避免房主與其他人的步進節奏不同
  function createFx(opts) {
    opts = opts || {};
    var fx = { shake: 0, stop: 0, slow: 0, slowK: 1, flash: 0, flashMax: 1, flashA: 0, flashRgb: "255,255,255", hurt: 0, focus: null, noTime: !!opts.noTime };
    function kick(n) { fx.shake = Math.max(fx.shake, n); }
    function stop(s) { fx.stop = Math.max(fx.stop, s); }
    function slow(s, k) { if (fx.slow <= 0 || k <= fx.slowK) { fx.slow = Math.max(fx.slow, s); fx.slowK = k; } }
    function flash(s, rgb, al) { fx.flash = fx.flashMax = s; fx.flashRgb = rgb; fx.flashA = al; }
    fx.event = function (e, a) {
      var me = fx.focus, mine = !!me && (e.f === me || e.a === me || e.b === me);
      if (e.type === "bind") { stop(0.09); kick(mine ? 10 : 6); flash(0.14, "255,248,220", mine ? 0.5 : 0.3); if (a && a.mode === "shiai") slow(0.4, 0.3); }
      else if (e.type === "spark") kick(mine ? 2.2 : 1.2);
      else if (e.type === "release") kick(mine ? 7 : 3.5);
      else if (e.type === "mikiri" || e.type === "iai") { stop(0.12); kick(6); flash(0.16, "255,255,255", 0.45); }
      else if (e.type === "hit") {
        if (e.n >= 3) kick(Math.min(8, e.n * 0.35));
        if (me && e.f === me && e.n >= 2) fx.hurt = Math.min(1, fx.hurt + 0.25 + e.n * 0.03);
      }
      else if (e.type === "wall") kick(1.5);
      else if (e.type === "break" || e.type === "stall" || e.type === "crackbreak") {
        stop(0.2); slow(1.1, 0.25); kick(12); flash(0.3, e.f === me ? "255,80,60" : "255,240,220", 0.55);
      }
    };
    fx.special = function () { slow(0.5, 0.45); kick(5); };
    // 回傳這一影格的時間倍率：頓幀中 0、慢動作中 slowK
    fx.tick = function (dt) {
      fx.shake *= Math.exp(-dt * 9); if (fx.shake < 0.05) fx.shake = 0;
      fx.flash = Math.max(0, fx.flash - dt);
      fx.hurt = Math.max(0, fx.hurt - dt * 1.4);
      if (fx.noTime) { fx.stop = fx.slow = 0; return 1; }
      if (fx.stop > 0) { fx.stop -= dt; return 0; }
      if (fx.slow > 0) { fx.slow -= dt; return fx.slowK; }
      return 1;
    };
    fx.offset = function (unit) {
      if (!fx.shake) return { x: 0, y: 0, r: 0 };
      return { x: (Math.random() * 2 - 1) * fx.shake * unit, y: (Math.random() * 2 - 1) * fx.shake * unit, r: (Math.random() * 2 - 1) * fx.shake * 0.003 };
    };
    // 全畫面的閃光與受擊暗角（ctx 需是未變形的畫布座標）
    fx.overlay = function (ctx, w, h) {
      if (fx.flash > 0) { ctx.fillStyle = "rgba(" + fx.flashRgb + "," + (fx.flashA * fx.flash / fx.flashMax) + ")"; ctx.fillRect(0, 0, w, h); }
      if (fx.hurt > 0) {
        var g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
        g.addColorStop(0, "rgba(200,20,20,0)"); g.addColorStop(1, "rgba(200,20,20," + 0.42 * fx.hurt + ")");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
    };
    return fx;
  }

  // ---------------- 刀視角 ----------------
  function createCam(fid) { return { fid: fid, ang: null, kick: 0, roll: 0, pose: null, ghosts: [], sparks: [], t: 0 }; }

  function nearestFoe(a, f) {
    var best = null, bd = 1e9;
    a.fighters.forEach(function (g) { if (g === f || !g.alive) return; var d = Math.hypot(g.x - f.x, g.y - f.y); if (d < bd) { bd = d; best = g; } });
    return best;
  }

  function camUpdate(cam, a, f, dt) {
    cam.t += dt;
    var sh = f.sh, tgt = null, rate = 4, op = lockOp(a, f);
    if (op) { tgt = Math.atan2(op.y - f.y, op.x - f.x); rate = 12; }
    else if (sh && f.alive && (sh.st === "aim" || sh.st === "slash")) { tgt = sh.dir; rate = sh.st === "slash" ? 14 : 9; }
    else {
      // 平常：鎖定最近的對手（格鬥遊戲的 lock-on）；陀螺不跟著自己的旋轉轉，否則會暈
      var n = nearestFoe(a, f);
      tgt = n ? Math.atan2(n.y - f.y, n.x - f.x) : (cam.ang === null ? f.rot : cam.ang);
      rate = a.mode === "shiai" ? 4 : 3.2;
    }
    if (cam.ang === null) cam.ang = tgt;
    cam.ang += angDiff(cam.ang, tgt) * Math.min(1, rate * dt);
    var spd = Math.hypot(f.vx || 0, f.vy || 0);
    var kt = sh ? (sh.st === "slash" ? 1 : 0) : clamp((spd - 40) / 140, 0, 1);
    cam.kick += (kt - cam.kick) * Math.min(1, 8 * dt);
    // 傾斜：相接時互推的顫動、彈開時被甩、陀螺依橫向速度
    var lat = -(f.vx || 0) * Math.sin(cam.ang) + (f.vy || 0) * Math.cos(cam.ang), rt = 0;
    if (op) rt = Math.sin(cam.t * 40) * 0.025;
    else if (sh && sh.st === "recoil") rt = clamp(lat / 900, -0.14, 0.14);
    else if (!sh) rt = clamp(lat / 1200, -0.1, 0.1);
    cam.roll += (rt - cam.roll) * Math.min(1, 7 * dt);
  }

  // 側視圖（或退回程式畫的簡化刀）：原點＝鍔，刀尖朝 +x，長度 L
  function sideBlade(ctx, img, L, color, glow) {
    var h = L / SIDE_ASPECT;
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
    if (img) {
      ctx.drawImage(img, -SIDE_GUARD * L, -h / 2, L, h);
      if (glow) { ctx.shadowBlur = 0; ctx.drawImage(img, -SIDE_GUARD * L, -h / 2, L, h); }
    } else {
      var bl = L * (1 - SIDE_GUARD);
      ctx.fillStyle = "#dfe6ec";
      ctx.beginPath(); ctx.moveTo(0, -h * 0.28); ctx.quadraticCurveTo(bl * 0.6, -h * 0.4, bl, -h * 0.75); ctx.lineTo(bl * 0.96, h * 0.05); ctx.quadraticCurveTo(bl * 0.6, h * 0.3, 0, h * 0.28); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = color; ctx.fillRect(-SIDE_GUARD * L, -h * 0.22, SIDE_GUARD * L * 0.95, h * 0.44);
      ctx.fillStyle = "#c9a44a"; ctx.beginPath(); ctx.ellipse(0, 0, h * 0.14, h * 0.55, 0, 0, TAU); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  // opts: dt（這一影格經過的對刀時間）, vis（katana.js 的特效陣列：parts/rings/floats/cuts/bolts/scars）,
  //       sideArt(f) → 側視圖 Image｜null, fx, dpr, labels { lock, out }, hpOf(f) → 0..1
  function draw(ctx, W, H, a, cam, opts) {
    var f = byId(a, cam.fid);
    if (!f) return;
    var dpr = opts.dpr || 1, vis = opts.vis || {}, R = 100;
    camUpdate(cam, a, f, opts.dt || 0);
    var ang = cam.ang, ca = Math.cos(ang), sa = Math.sin(ang);
    var ex = f.x - ca * f.prof.radius * 0.5, ey = f.y - sa * f.prof.radius * 0.5, er = Math.hypot(ex, ey);
    if (er > R - 4) { ex *= (R - 4) / er; ey *= (R - 4) / er; }
    var F = (W / 2) / Math.tan(FOV / 2) * (1 - 0.18 * cam.kick);
    var HY = H * 0.46;
    var off = opts.fx ? opts.fx.offset(W / 600) : { x: 0, y: 0, r: 0 };
    function toCam(x, y) { var dx = x - ex, dy = y - ey; return [dx * ca + dy * sa, -dx * sa + dy * ca]; }
    function proj(z, xr, h) { return [xr / z * F, (EYE_H - h) / z * F]; }
    function P(x, y, h) { var c = toCam(x, y); return c[0] < NEAR ? null : proj(c[0], c[1], h); }
    // 世界座標的線段（會裁掉眼睛後方的部分）
    function seg(x0, y0, x1, y1, h) {
      var p = toCam(x0, y0), q = toCam(x1, y1);
      if (p[0] < NEAR && q[0] < NEAR) return;
      if (p[0] < NEAR) { var t = (NEAR - p[0]) / (q[0] - p[0]); p = [NEAR, p[1] + (q[1] - p[1]) * t]; }
      else if (q[0] < NEAR) { var u = (NEAR - q[0]) / (p[0] - q[0]); q = [NEAR, q[1] + (p[1] - q[1]) * u]; }
      var A = proj(p[0], p[1], h), B = proj(q[0], q[1], h);
      ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]);
    }
    function circle(x, y, r, h, n) {
      n = n || 48;
      for (var i = 0; i < n; i++) { var a0 = i / n * TAU, a1 = (i + 1) / n * TAU; seg(x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r, h); }
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0b0a10"; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2 + off.x, HY + off.y);
    ctx.rotate(cam.roll + off.r);
    var M = Math.max(W, H) * 1.6;
    // 天：夜的神社，地平線附近透出篝火的暖色
    var sky = ctx.createLinearGradient(0, -HY, 0, 0);
    sky.addColorStop(0, "#07060c"); sky.addColorStop(0.75, "#1a1218"); sky.addColorStop(1, "#3a2418");
    ctx.fillStyle = sky; ctx.fillRect(-M, -M, 2 * M, M);
    // 地：土俵的土，近處被照亮
    var gnd = ctx.createLinearGradient(0, 0, 0, H - HY);
    gnd.addColorStop(0, "#2a2018"); gnd.addColorStop(0.35, "#5a4532"); gnd.addColorStop(1, "#8a6a4a");
    ctx.fillStyle = gnd; ctx.fillRect(-M, 0, 2 * M, M);
    // 場外佈景（遠到近）：提燈與四本柱
    var far = [];
    LANTERNS.forEach(function (l) { var c = toCam(l[0], l[1]); if (c[0] > NEAR) far.push({ z: c[0], k: "lan", c: c }); });
    PILLARS.forEach(function (p) { var c = toCam(p[0], p[1]); if (c[0] > NEAR) far.push({ z: c[0], k: "pil", c: c, col: p[2] }); });
    far.sort(function (p, q) { return q.z - p.z; });
    far.forEach(function (o) {
      if (o.k === "pil") {
        var w = 9 / o.z * F, top = proj(o.z, o.c[1], 95), bot = proj(o.z, o.c[1], 0);
        ctx.fillStyle = o.col; ctx.fillRect(top[0] - w / 2, top[1], w, bot[1] - top[1]);
        ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(top[0] + w * 0.15, top[1], w * 0.35, bot[1] - top[1]);
      } else {
        var c = proj(o.z, o.c[1], 42), r = 5 / o.z * F, fl = 0.85 + 0.15 * Math.sin(cam.t * 6 + o.c[1]);
        var lg = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], r * 3);
        lg.addColorStop(0, "rgba(255,190,110," + 0.55 * fl + ")"); lg.addColorStop(1, "rgba(255,140,60,0)");
        ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(c[0], c[1], r * 3, 0, TAU); ctx.fill();
        ctx.fillStyle = "rgba(255,226,170," + fl + ")"; ctx.beginPath(); ctx.ellipse(c[0], c[1], r * 0.6, r * 0.85, 0, 0, TAU); ctx.fill();
      }
    });
    // 俵（圓形場地的邊）：逐欄求視線與圓的交點
    var step = Math.max(2, Math.round(W / 220)), Rw = R + 3;
    for (var sx = -M * 0.6; sx < M * 0.6; sx += step) {
      var rel = Math.atan(sx / F), d = ang + rel, dxr = Math.cos(d), dyr = Math.sin(d);
      var b = ex * dxr + ey * dyr, cc = ex * ex + ey * ey - Rw * Rw, tt = -b + Math.sqrt(Math.max(0, b * b - cc));
      var z = tt * Math.cos(rel);
      if (z < NEAR) continue;
      var top = (EYE_H - WALL_H) / z * F, bot = EYE_H / z * F;
      var th = Math.atan2(ey + dyr * tt, ex + dxr * tt), bale = Math.floor((th + Math.PI) / TAU * 56) % 2;
      var sh = clamp(1.05 - tt / 230, 0.35, 1) * (bale ? 1 : 0.86);
      ctx.fillStyle = "rgb(" + Math.round(196 * sh) + "," + Math.round(168 * sh) + "," + Math.round(104 * sh) + ")";
      ctx.fillRect(sx, top, step + 0.6, bot - top);
      ctx.fillStyle = "rgba(240,215,140," + 0.7 * sh + ")";
      ctx.fillRect(sx, top, step + 0.6, Math.max(1, (bot - top) * 0.16));
    }
    // 地上的圈線與斬痕
    ctx.lineWidth = 1 * dpr; ctx.strokeStyle = "rgba(255,240,220,0.12)";
    ctx.beginPath(); [0.3, 0.55, 0.8].forEach(function (k) { circle(0, 0, R * k, 0, 64); }); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); seg(-20, -3, -20, 3, 0); seg(20, -3, 20, 3, 0); ctx.stroke(); // 仕切り線
    (vis.scars || []).forEach(function (sc) {
      var k = sc.life / sc.max;
      ctx.strokeStyle = "rgba(20,12,8," + 0.5 * k + ")"; ctx.lineWidth = 3 * dpr;
      ctx.beginPath(); seg(sc.x0, sc.y0, sc.x1, sc.y1, 0.05); ctx.stroke();
      ctx.strokeStyle = "rgba(255,225,180," + 0.25 * k + ")"; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); seg(sc.x0, sc.y0, sc.x1, sc.y1, 0.1); ctx.stroke();
    });
    // 試合：刀光（一閃）與斬擊光跡，貼在地面上往遠方延伸
    ctx.lineCap = "round";
    a.fighters.forEach(function (g) {
      if (!g.alive || !g.sh || (g.sh.st !== "aim" && g.sh.st !== "slash")) return;
      var s2 = g.sh, rgb = hexRgb(g.color), x1 = s2.x1, y1 = s2.y1;
      if (s2.st === "aim") {
        var aimMax = 0.55 * (g.fx.dash > 0 || g.fx.issen > 0 ? 0.5 : 1), p = clamp(1 - Math.max(0, s2.t) / aimMax, 0, 1), q = Math.min(1, p / 0.35), e2 = 1 - Math.pow(1 - q, 3);
        x1 = s2.x0 + (s2.x1 - s2.x0) * e2; y1 = s2.y0 + (s2.y1 - s2.y0) * e2;
        var fl = 0.85 + 0.15 * Math.sin(cam.t * 70);
        ctx.shadowColor = "rgba(" + rgb + ",0.9)"; ctx.shadowBlur = (8 + 12 * p) * dpr;
        ctx.strokeStyle = "rgba(" + rgb + "," + (0.3 + 0.45 * p) * fl + ")"; ctx.lineWidth = (3 + 6 * p) * dpr;
        ctx.beginPath(); seg(s2.x0, s2.y0, x1, y1, 0.3); ctx.stroke();
        ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(255,255,255," + (0.6 + 0.4 * p) * fl + ")"; ctx.lineWidth = (1 + 1.5 * p) * dpr;
        ctx.beginPath(); seg(s2.x0, s2.y0, x1, y1, 0.3); ctx.stroke();
      } else {
        ctx.shadowColor = "rgba(" + rgb + ",0.9)"; ctx.shadowBlur = 14 * dpr;
        ctx.strokeStyle = "rgba(" + rgb + ",0.6)"; ctx.lineWidth = 7 * dpr;
        ctx.beginPath(); seg(s2.x0, s2.y0, g.x, g.y, 0.3); ctx.stroke();
        ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); seg(s2.x0, s2.y0, g.x, g.y, 0.3); ctx.stroke();
      }
    });
    ctx.shadowBlur = 0;
    // 地上的衝擊環
    (vis.rings || []).forEach(function (rg) {
      var k = rg.life / rg.max;
      ctx.strokeStyle = "rgba(" + rg.color + "," + k + ")"; ctx.lineWidth = (rg.thick || 2) * dpr;
      ctx.beginPath(); circle(rg.x, rg.y, rg.r + rg.grow * (1 - k), 0.4, 32); ctx.stroke();
    });
    // 對手的刀：側視圖看板，由遠到近
    var me = f, myLock = lockOp(a, f), boards = [];
    a.fighters.forEach(function (g) {
      if (g === me || g === myLock) return; // 相接中的對手畫在前景
      var c = toCam(g.x, g.y);
      if (c[0] > NEAR + 1) boards.push({ g: g, z: c[0], xr: c[1] });
    });
    boards.sort(function (p, q) { return q.z - p.z; });
    boards.forEach(function (o) {
      var g = o.g, sc = F / o.z, L = g.prof.radius * 2.1 * sc;
      var rot = g.rot, gop = lockOp(a, g);
      if (gop) rot = Math.atan2(gop.y - g.y, gop.x - g.x);
      var rel = rot - ang, sn = Math.sin(rel), fs = Math.max(0.14, Math.abs(sn));
      var base = proj(o.z, o.xr, 0), c = proj(o.z, o.xr, g.alive ? BLADE_H : 0.8);
      // 地上的影子與玩家色的光圈
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.ellipse(base[0], base[1], g.prof.radius * sc, Math.max(1, g.prof.radius * sc * EYE_H / o.z), 0, 0, TAU); ctx.fill();
      if (g.alive) {
        ctx.strokeStyle = "rgba(" + hexRgb(g.color) + ",0.55)"; ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.ellipse(base[0], base[1], g.prof.radius * sc * 1.1, Math.max(1, g.prof.radius * sc * 1.1 * EYE_H / o.z), 0, 0, TAU); ctx.stroke();
      }
      var tilt = !g.alive ? 0 : (g.sh && g.sh.st === "aim" ? -0.55 + Math.sin(cam.t * 50) * 0.03 : (gop ? -0.3 + Math.sin(cam.t * 45) * 0.08 : 0));
      if (g.fx && g.fx.stun > 0) c[0] += Math.sin(cam.t * 60) * 2 * dpr;
      var img = opts.sideArt ? opts.sideArt(g) : null;
      function one(r2, al) {
        var s3 = Math.sin(r2 - ang);
        ctx.save();
        ctx.globalAlpha = al * (g.alive ? 1 : 0.4);
        ctx.translate(c[0], c[1]);
        ctx.rotate(s3 < 0 ? -tilt : tilt);
        ctx.scale((s3 < 0 ? -1 : 1) * Math.max(0.14, Math.abs(s3)), 1);
        sideBlade(ctx, img, L, g.color, g.alive ? Math.max(4, 10 * sc / 3) * dpr : 0);
        ctx.restore();
      }
      // 陀螺高速旋轉：留兩道殘影；試合斬擊：沿移動方向的殘影
      if (!g.sh && g.alive && g.spin > 0.25) { var w = (6 + 22 * g.spin) * (g.dir || 1); one(rot - w * 0.035, 0.25); one(rot - w * 0.018, 0.4); }
      if (g.sh && g.sh.st === "slash") {
        for (var gi = 1; gi <= 3; gi++) {
          var pc = P(g.x - g.vx * 0.025 * gi, g.y - g.vy * 0.025 * gi, BLADE_H);
          if (!pc) continue;
          ctx.save(); ctx.globalAlpha = 0.35 / gi; ctx.translate(pc[0], pc[1]); ctx.scale(sn < 0 ? -fs : fs, 1);
          sideBlade(ctx, img, L, g.color, 0); ctx.restore();
        }
      }
      one(rot, 1);
      // 名牌與耐久條
      if (g.alive) {
        var lab = proj(o.z, o.xr, BLADE_H + 10), fsz = clamp(sc * 2.2, 9, 15) * dpr, bw = clamp(sc * 14, 26, 80) * dpr;
        ctx.font = "bold " + Math.round(fsz) + "px sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fillText(g.name, lab[0], lab[1] - 5 * dpr);
        var hp = opts.hpOf ? opts.hpOf(g) : 1;
        ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(lab[0] - bw / 2, lab[1], bw, 4 * dpr);
        ctx.fillStyle = g.color; ctx.fillRect(lab[0] - bw / 2, lab[1], bw * hp, 4 * dpr);
      }
    });
    // 空中的特效：火花・碎片・花瓣、斬線、雷、數字
    (vis.parts || []).forEach(function (p) {
      var k = p.life / p.max, h = BLADE_H + (p.h || 0), A = P(p.x, p.y, h);
      if (!A) return;
      var c = toCam(p.x, p.y), lw = clamp(F / c[0] * 0.25, 0.8, 4) * dpr;
      if (p.kind === "petal" || p.kind === "snow" || p.kind === "leaf") {
        ctx.fillStyle = p.kind === "petal" ? "rgba(255," + Math.round(160 + 50 * k) + ",200," + k + ")" : (p.kind === "snow" ? "rgba(240,248,255," + k + ")" : "rgba(214," + Math.round(60 + 60 * k) + ",40," + k + ")");
        ctx.beginPath(); ctx.arc(A[0], A[1], lw * 1.4, 0, TAU); ctx.fill(); return;
      }
      var B = P(p.x - p.vx * 0.05, p.y - p.vy * 0.05, h);
      if (!B) return;
      ctx.strokeStyle = p.kind === "fire" ? "rgba(255," + Math.round(90 + 100 * k) + ",30," + k + ")" : (p.kind === "shard" ? "rgba(220,230,240," + k + ")" : "rgba(255," + Math.round(200 + 55 * k) + "," + Math.round(120 * k) + "," + k + ")");
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
    });
    (vis.cuts || []).forEach(function (c) {
      var k = c.life / c.max, dx = Math.cos(c.ang) * c.len * (1.2 - k * 0.4), dy = Math.sin(c.ang) * c.len * (1.2 - k * 0.4);
      ctx.strokeStyle = "rgba(" + c.color + "," + 0.4 * k + ")"; ctx.lineWidth = 8 * dpr * k;
      ctx.beginPath(); seg(c.x - dx, c.y - dy, c.x + dx, c.y + dy, BLADE_H + 2); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255," + k + ")"; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); seg(c.x - dx, c.y - dy, c.x + dx, c.y + dy, BLADE_H + 2); ctx.stroke();
    });
    (vis.bolts || []).forEach(function (b) {
      var k = b.life / b.max;
      ctx.strokeStyle = "rgba(" + b.color + "," + k + ")"; ctx.lineWidth = 3 * dpr;
      ctx.beginPath(); seg(b.x, b.y, b.x2, b.y2, BLADE_H + 4); ctx.stroke();
    });
    (vis.floats || []).forEach(function (fl) {
      var k = fl.life / fl.max, A = P(fl.x, fl.y, BLADE_H + 8 + (1 - k) * 8);
      if (!A) return;
      var c = toCam(fl.x, fl.y), fsz = clamp(F / c[0] * (fl.big ? 3.2 : 2.4), 10, fl.big ? 34 : 26) * dpr;
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.font = "bold " + Math.round(fsz) + "px sans-serif"; ctx.textAlign = "center";
      ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.strokeText(fl.text, A[0], A[1]);
      ctx.fillStyle = fl.color; ctx.fillText(fl.text, A[0], A[1]);
      ctx.globalAlpha = 1;
    });
    // 速度線：從消失點往外放射
    if (cam.kick > 0.2) {
      ctx.lineCap = "round";
      var n = Math.round(30 * cam.kick);
      for (var i = 0; i < n; i++) {
        var ra = Math.random() * TAU, r0 = W * (0.22 + Math.random() * 0.35), ln = W * (0.08 + Math.random() * 0.3) * cam.kick;
        ctx.strokeStyle = "rgba(255,255,255," + (0.12 + Math.random() * 0.35) * cam.kick + ")"; ctx.lineWidth = (0.8 + Math.random() * 1.6) * dpr;
        ctx.beginPath(); ctx.moveTo(Math.cos(ra) * r0, Math.sin(ra) * r0); ctx.lineTo(Math.cos(ra) * (r0 + ln), Math.sin(ra) * (r0 + ln)); ctx.stroke();
      }
    }
    ctx.restore();

    // ---- 前景：自己的刀（只跟著鏡頭震動，不跟世界傾斜）----
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, off.x * 1.4, off.y * 1.4);
    var img = opts.sideArt ? opts.sideArt(f) : null, Ls = W * 0.8, glow = 14 * dpr;
    var dt = opts.dt || 0, st = f.sh ? f.sh.st : null;
    if (!f.alive) {
      ctx.globalAlpha = 0.5;
      ctx.translate(W * 0.9, H * 1.12); ctx.rotate(-2.95);
      sideBlade(ctx, img, Ls, f.color, 0);
    } else if (myLock || f.sh) {
      var key = myLock ? "lock" : st, tg = POSE[key] || POSE.sheathe;
      if (!cam.pose) cam.pose = tg.slice();
      var rate = key === "slash" ? 30 : (key === "lock" ? 18 : (key === "recoil" ? 14 : 7)), kk = Math.min(1, rate * dt);
      cam.pose[0] += (tg[0] - cam.pose[0]) * kk; cam.pose[1] += (tg[1] - cam.pose[1]) * kk;
      cam.pose[2] += angDiff(cam.pose[2], tg[2]) * kk; cam.pose[3] += (tg[3] - cam.pose[3]) * kk;
      var trem = key === "aim" ? Math.sin(cam.t * 55) * 0.015 : (key === "lock" ? Math.sin(cam.t * 45) * 0.03 : 0);
      var pz = cam.pose, hx = pz[0] * W, hy = pz[1] * H, pa = pz[2] + trem;
      // 揮刀的殘影
      cam.ghosts.push([hx, hy, pa]); if (cam.ghosts.length > 6) cam.ghosts.shift();
      if (key === "slash" || key === "recoil") {
        cam.ghosts.forEach(function (gp, gi) {
          ctx.save(); ctx.globalAlpha = 0.08 * (gi + 1); ctx.translate(gp[0], gp[1]); ctx.rotate(gp[2]);
          sideBlade(ctx, img, Ls, f.color, 0); ctx.restore();
        });
      }
      // 蓄力：刀身的玩家色光越來越強
      var aimGlow = key === "aim" ? (0.4 + 0.6 * clamp(1 - f.sh.t / 0.55, 0, 1)) : 0;
      ctx.save(); ctx.globalAlpha = pz[3]; ctx.translate(hx, hy); ctx.rotate(pa);
      sideBlade(ctx, img, Ls, f.color, glow * (1 + aimGlow * 2.5));
      ctx.restore();
      if (myLock) {
        // 對手的刀從畫面右上壓下來，與自己的刀交叉成 X，交叉處噴火花
        var oimg = opts.sideArt ? opts.sideArt(myLock) : null, oh = [0.98 * W, -0.04 * H], oa = 2.2 + Math.sin(cam.t * 45 + 1.7) * 0.03;
        ctx.save(); ctx.translate(oh[0], oh[1]); ctx.rotate(oa); ctx.scale(1, -1);
        sideBlade(ctx, oimg, Ls * 1.45, myLock.color, glow);
        ctx.restore();
        var d1 = [Math.cos(pa), Math.sin(pa)], d2 = [Math.cos(oa), Math.sin(oa)], den = d1[0] * d2[1] - d1[1] * d2[0];
        var X = [W * 0.5, H * 0.55];
        if (Math.abs(den) > 1e-3) { var t1 = ((oh[0] - hx) * d2[1] - (oh[1] - hy) * d2[0]) / den; X = [hx + d1[0] * t1, hy + d1[1] * t1]; }
        var pulse = 0.6 + 0.4 * Math.sin(cam.t * 30), gr = ctx.createRadialGradient(X[0], X[1], 0, X[0], X[1], W * 0.16);
        gr.addColorStop(0, "rgba(255,252,230," + 0.95 * pulse + ")"); gr.addColorStop(0.3, "rgba(255,200,90," + 0.5 * pulse + ")"); gr.addColorStop(1, "rgba(255,150,40,0)");
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(X[0], X[1], W * 0.16, 0, TAU); ctx.fill();
        for (var si = 0; si < 4; si++) {
          var sa2 = Math.random() * TAU, sp = W * (0.4 + Math.random() * 1.1);
          cam.sparks.push({ x: X[0], y: X[1], vx: Math.cos(sa2) * sp, vy: Math.sin(sa2) * sp - W * 0.3, life: 0.35 + Math.random() * 0.3, max: 0.65 });
        }
      }
    } else {
      // 陀螺：自己就是轉動的刀，刀身像螺旋槳一樣從畫面下方掃過
      cam.pose = null;
      var srel = angDiff(ang, f.rot), pivX = W / 2, pivY = H * 1.25, sang = -Math.PI / 2 + srel;
      var wsp = (6 + 22 * (f.spin || 0)) * (f.dir || 1);
      {
        // 殘影扇形
        ctx.save(); ctx.translate(pivX, pivY);
        var sweep = clamp(Math.abs(wsp) * 0.05, 0.05, 1.2), a0 = wsp > 0 ? sang - sweep : sang, a1 = wsp > 0 ? sang : sang + sweep;
        var fan = ctx.createRadialGradient(0, 0, Ls * 0.2, 0, 0, Ls * 0.78);
        fan.addColorStop(0, "rgba(220,230,240,0)"); fan.addColorStop(0.7, "rgba(220,230,240," + 0.18 * (f.spin || 0) + ")"); fan.addColorStop(1, "rgba(" + hexRgb(f.color) + "," + 0.25 * (f.spin || 0) + ")");
        ctx.fillStyle = fan; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, Ls * 0.78, a0, a1); ctx.closePath(); ctx.fill();
        ctx.rotate(sang);
        sideBlade(ctx, img, Ls, f.color, glow);
        ctx.restore();
      }
    }
    // 畫面座標的火花
    cam.sparks = cam.sparks.filter(function (p) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += W * 1.6 * dt; return p.life > 0; });
    ctx.lineCap = "round";
    cam.sparks.forEach(function (p) {
      var k = p.life / p.max;
      ctx.strokeStyle = "rgba(255," + Math.round(200 + 55 * k) + "," + Math.round(140 * k) + "," + k + ")"; ctx.lineWidth = 2.2 * dpr;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
    });
    ctx.restore();

    // ---- HUD：暗角・相接字樣・小地圖・自己的耐久 ----
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * (0.42 - 0.12 * cam.kick), W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0," + (0.55 + 0.25 * cam.kick) + ")");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    if (myLock && opts.labels && opts.labels.lock) {
      var pu = 0.75 + 0.25 * Math.sin(cam.t * 12);
      ctx.font = "bold " + Math.round(W * 0.06) + "px serif"; ctx.textAlign = "center";
      ctx.lineWidth = 4 * dpr; ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.strokeText(opts.labels.lock, W / 2, H * 0.16);
      ctx.fillStyle = "rgba(255,226,150," + pu + ")"; ctx.fillText(opts.labels.lock, W / 2, H * 0.16);
    }
    // 小地圖（右上）：場地、各刀、自己的視野扇形
    var mr = W * 0.1, mx = W - mr - 10 * dpr, my = mr + 10 * dpr, ms = mr / R;
    ctx.fillStyle = "rgba(10,8,6,0.6)"; ctx.beginPath(); ctx.arc(mx, my, mr + 3 * dpr, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(201,166,90,0.8)"; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.beginPath(); ctx.moveTo(mx + f.x * ms, my + f.y * ms); ctx.arc(mx + f.x * ms, my + f.y * ms, mr * 0.9, ang - FOV / 2, ang + FOV / 2); ctx.closePath(); ctx.fill();
    a.fighters.forEach(function (g) {
      ctx.globalAlpha = g.alive ? 1 : 0.35; ctx.fillStyle = g.color;
      ctx.beginPath(); ctx.arc(mx + g.x * ms, my + g.y * ms, (g === f ? 3.5 : 2.6) * dpr, 0, TAU); ctx.fill();
      if (g === f) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1 * dpr; ctx.stroke(); }
    });
    ctx.globalAlpha = 1;
    // 自己的名字與耐久（左下）
    var bw2 = W * 0.34, bx2 = 12 * dpr, by2 = H - 18 * dpr, hp2 = opts.hpOf ? opts.hpOf(f) : 1;
    ctx.font = "bold " + Math.round(12 * dpr) + "px sans-serif"; ctx.textAlign = "left";
    ctx.fillStyle = f.color; ctx.fillText("● " + f.name, bx2, by2 - 8 * dpr);
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(bx2, by2, bw2, 6 * dpr);
    ctx.fillStyle = hp2 < 0.3 ? "#e04848" : f.color; ctx.fillRect(bx2, by2, bw2 * hp2, 6 * dpr);
    if (!f.alive && opts.labels && opts.labels.out) {
      ctx.fillStyle = "rgba(20,20,20,0.45)"; ctx.fillRect(0, 0, W, H);
      ctx.font = "bold " + Math.round(W * 0.055) + "px serif"; ctx.textAlign = "center"; ctx.fillStyle = "#e8e2d6";
      ctx.fillText(opts.labels.out, W / 2, H * 0.5);
    }
    if (opts.fx) opts.fx.overlay(ctx, W, H);
    ctx.restore();
  }

  window.PriTestKatanaPov = { createFx: createFx, createCam: createCam, draw: draw, lockOp: lockOp, SIDE_GUARD: SIDE_GUARD };
})();
