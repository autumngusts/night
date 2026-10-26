// DÉJÀ VU 山道下坡（dejavu）：電視轉播系統（第七批，2026-10-26）。只負責「鏡頭在哪、看哪裡、畫面上的轉播字幕」，不碰模擬。
//   攝影機：track 路邊固定機位（長焦鏡頭跟著車轉、越遠拉越近）、chase 車後追焦、heli 直升機、lead 前導車回看、onboard 車內、top 俯視。
//   3D 畫面借用 dejavu_cockpit.js 的繪圖（傳入 cam 就是外部攝影機），俯視用 dejavu.js 的 drawChase。
//   導播（director）：有纏鬥（前後 30 m 內）就跟纏鬥的追擊方，否則跟領先車；每 3.5–6 秒切一次鏡頭，路邊機位等車通過才切。
//   重播（replay）：同一個瞬間用兩個角度（路邊 → 追焦／直升機）慢動作播放，前後有 REPLAY 轉場。
(function () {
  "use strict";

  var Core = window.PriTestDejavuCore;
  function t(k, p) { return window.I18N.t(k, p); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function fmtTime(s) {
    if (s === null || s === undefined || !isFinite(s)) return "--:--.--";
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ":" + (r < 10 ? "0" : "") + r.toFixed(2);
  }

  // 路上一點（s＝里程，off＝橫向位移左正，dz＝離路面高度）
  function trackPt(tr, s, off, dz) {
    var p = clamp(s / tr.ds, 0, tr.N - 1.001), i = Math.floor(p), f = p - i;
    var h = tr.h[i] + (tr.h[i + 1] - tr.h[i]) * f;
    var x = tr.x[i] + (tr.x[i + 1] - tr.x[i]) * f, y = tr.y[i] + (tr.y[i + 1] - tr.y[i]) * f;
    var z = tr.z[i] + (tr.z[i + 1] - tr.z[i]) * f;
    return { x: x - Math.sin(h) * (off || 0), y: y + Math.cos(h) * (off || 0), z: z + (dz || 0), j: i, h: h };
  }
  function carPt(race, c, dz) {
    var ps = Core.carPose(race, c), tr = race.track;
    var j = clamp(Math.floor(c.s / tr.ds), 0, tr.N - 1);
    return { x: ps.x, y: ps.y, z: tr.z[j] + (dz || 0), h: ps.h };
  }
  function look(pos, tgt, zoom, back) {
    var dx = tgt.x - pos.x, dy = tgt.y - pos.y, dist = Math.max(0.5, Math.hypot(dx, dy));
    return { x: pos.x, y: pos.y, z: pos.z, j: pos.j, h: Math.atan2(dy, dx), pitch: Math.atan2(pos.z - tgt.z, dist), zoom: zoom || 1, back: back || 160, dist: dist };
  }

  // 路邊機位：架在山谷／水邊那一側（山壁那側會把鏡頭埋進山裡），而且要看得到來車的路段——
  //   從 s 往回找（最遠退到 sFrom＋15 m），第一個「視線不穿過山壁」的位置；隧道裡不架。
  //   視線檢查：鏡頭到來車路段上幾個點的連線，取樣點離路中心超過路肩、又落在山壁那側，就當作被山擋住。
  function camAt(tr, pc, s) {
    var j = clamp(Math.floor(s / tr.ds), 0, tr.N - 1);
    var side = pc ? -pc.wall[j] : (tr.k[j] > 0 ? -1 : 1);
    var onBridge = tr.sp && tr.sp[j] === 4;
    // 隧道裡：架在路肩上方（隧道監視器）
    if (tr.sp && tr.sp[j] === 3) return { s: s, off: side * (tr.w / 2 - 0.4), dz: 4.3 };
    return { s: s, off: side * (tr.w / 2 + (onBridge ? 1.4 : 3.6)), dz: 2.6 + (j % 3) * 0.7 };
  }
  function blocked(tr, pc, fix, sTgt) {
    if (!pc) return false;
    var c = trackPt(tr, fix.s, fix.off, 0), g = trackPt(tr, sTgt, 0, 0);
    var j0 = clamp(Math.floor(Math.min(sTgt, fix.s) / tr.ds) - 10, 0, tr.N - 1), j1 = clamp(Math.floor(Math.max(sTgt, fix.s) / tr.ds) + 10, 0, tr.N - 1);
    for (var k = 1; k < 10; k++) {
      var u = k / 10, x = c.x + (g.x - c.x) * u, y = c.y + (g.y - c.y) * u;
      var best = Infinity, bj = j0;
      for (var j = j0; j <= j1; j += 2) { var d = (tr.x[j] - x) * (tr.x[j] - x) + (tr.y[j] - y) * (tr.y[j] - y); if (d < best) { best = d; bj = j; } }
      var lat = -(x - tr.x[bj]) * Math.sin(tr.h[bj]) + (y - tr.y[bj]) * Math.cos(tr.h[bj]);
      if (Math.abs(lat) > tr.w / 2 + 2.2 && (lat > 0 ? 1 : -1) === pc.wall[bj] && !(tr.water && pc.wall[bj] === tr.water)) return true;
    }
    return false;
  }
  function placeTrackCam(race, s, sFrom) {
    var tr = race.track, sp = tr.sp || [];
    var pc = window.PriTestDejavuCockpit && window.PriTestDejavuCockpit.prep ? window.PriTestDejavuCockpit.prep(tr, race.seed) : null;
    if (sFrom === undefined) sFrom = s - 60;
    var first = null;
    var carInT = sp[clamp(Math.floor(sFrom / tr.ds), 0, tr.N - 1)] === 3;
    for (var sc = s; sc >= sFrom + 15; sc -= 8) {
      // 車在隧道外時不把鏡頭架進隧道（反之亦然：車在隧道裡就用隧道內的機位）
      if ((sp[clamp(Math.floor(sc / tr.ds), 0, tr.N - 1)] === 3) !== carInT) continue;
      var fix = camAt(tr, pc, sc);
      if (!first) first = fix;
      if (!blocked(tr, pc, fix, sFrom) && !blocked(tr, pc, fix, (sFrom + sc) / 2)) return fix;
    }
    return first || camAt(tr, pc, s);
  }

  // 鏡頭：kind＝track／chase／heli／lead／onboard／top；st＝這個鏡頭的狀態（路邊機位的位置存在 st.fix）
  // 回傳 { cam }（3D 外部鏡頭）、{ onboard: true } 或 { top: true }
  function shot(race, car, kind, st) {
    var tr = race.track;
    if (kind === "onboard") return { onboard: true };
    if (kind === "top") return { top: true };
    // 車在隧道裡時直升機看不到，改用車後追焦
    if (kind === "heli" && tr.sp && tr.sp[clamp(Math.floor(car.s / tr.ds), 0, tr.N - 1)] === 3) kind = "chase";
    var tgt = carPt(race, car, 0.7);
    if (kind === "track") {
      if (!st.fix) st.fix = placeTrackCam(race, car.s + 55 + car.v * 1.6, car.s);
      var pos = trackPt(tr, st.fix.s, st.fix.off, st.fix.dz);
      var c = look(pos, tgt, 1, 220);
      c.zoom = clamp(c.dist / 16, 1, 5.5);   // 長焦：越遠拉越近，車在畫面上大小差不多
      return { cam: c };
    }
    if (kind === "chase") {
      var back = trackPt(tr, Math.max(0, car.s - 10), car.d * 0.6 + (tr.off[clamp(Math.floor((car.s - 10) / tr.ds), 0, tr.N - 1)] || 0), 2.7);
      var ahead = carPt(race, car, 1.0);
      ahead.x += Math.cos(tgt.h) * 6; ahead.y += Math.sin(tgt.h) * 6;
      return { cam: look(back, ahead, 1, 30) };
    }
    if (kind === "heli") {
      var side = st.side || (st.side = (Math.floor(race.t) % 2 ? 1 : -1));
      var hp = trackPt(tr, Math.max(0, car.s - 30), side * 16, 24);
      var hc = look(hp, tgt, 1.25, 80);
      hc.pitch *= 0.85;   // 車稍微偏畫面下方
      return { cam: hc };
    }
    if (kind === "lead") {
      var lp = trackPt(tr, Math.min(tr.L - 2, car.s + 14), (car.d > 0 ? -1 : 1) * tr.w * 0.22, 3);
      return { cam: look(lp, tgt, 1.15, 120) };
    }
    return { onboard: true };
  }
  // 路邊機位已經沒用了（車開過去了，或離太遠）
  function trackDone(race, car, st) {
    return st.fix && (car.s > st.fix.s + 12 || st.fix.s - car.s > 230);
  }

  // ---------------- 導播 ----------------
  // 誰在纏鬥：依名次找前後 30 m 內的一對，回傳追擊方（＝畫面焦點）與被追的那台
  function battle(race) {
    var ord = Core.order(race).filter(function (c) { return c.state === "run"; });
    for (var i = 1; i < ord.length; i++) {
      if (ord[i - 1].s - ord[i].s < 30) return { car: ord[i], rival: ord[i - 1], pos: i };
    }
    return null;
  }
  // 依局勢挑下一個鏡頭（不跟上一個重複）；只用 Math.random，不影響模擬
  function pickShot(race, car, last, hasRival) {
    var opts = hasRival ? [["track", 3], ["chase", 3], ["lead", 2.5], ["heli", 2], ["onboard", 1.2], ["top", 0.6]]
      : [["track", 3.5], ["heli", 2.5], ["chase", 2], ["onboard", 1.4], ["top", 1]];
    if (race.track.L - car.s < 40) opts = opts.filter(function (o) { return o[0] !== "lead"; });
    opts = opts.filter(function (o) { return o[0] !== last; });
    var tot = opts.reduce(function (a, o) { return a + o[1]; }, 0), x = Math.random() * tot;
    for (var i = 0; i < opts.length; i++) { x -= opts[i][1]; if (x < 0) return opts[i][0]; }
    return opts[0][0];
  }
  // 每幀更新導播狀態 d（{ kind, st, until, focus, lowerT }），回傳焦點車
  //   fixedFocus：玩家自己點了某台車（不自動換人）；now：畫面時間（秒）
  function direct(race, d, now, fixedFocus, lock) {
    var b = battle(race);
    var focus = fixedFocus !== null && fixedFocus !== undefined ? race.cars[fixedFocus] : b ? b.car : Core.order(race)[0];
    if (!focus) focus = race.cars[0];
    var cut = !d.kind || now >= d.until || d.kind === "track" && trackDone(race, race.cars[d.focus] || focus, d.st);
    if (lock && d.kind) cut = d.kind === "track" && trackDone(race, race.cars[d.focus] || focus, d.st);
    if (cut) {
      var rival = b && b.car === focus ? b.rival : null;
      var kind = lock || pickShot(race, focus, d.kind, !!rival);
      if (d.focus !== focus.id) d.lowerT = now;
      d.kind = kind; d.st = {}; d.focus = focus.id;
      d.until = now + (kind === "track" ? 9 : 3.5 + Math.random() * 2.5);
      d.cutT = now;
    }
    return race.cars[d.focus] || focus;
  }

  // ---------------- 轉播字幕 ----------------
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function short(name, n) { return name.length > n ? name.slice(0, n - 1) + "…" : name; }
  // 名次塔：名次、車色、名字、與前一名的差距（秒）
  function tower(ctx, f, race, focusId, max) {
    var ord = Core.order(race), n = Math.min(ord.length, max || 8);
    var x = 10, y = 10, w = 168, rh = 19;
    ctx.save();
    ctx.fillStyle = "rgba(12,14,20,0.82)"; rr(ctx, x, y, w, 22 + n * rh, 6); ctx.fill();
    ctx.fillStyle = "#d4380d"; ctx.fillRect(x, y, w, 20);
    ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("DÉJÀ VU · " + t("dv_tv_standings"), x + 8, y + 14);
    for (var i = 0; i < n; i++) {
      var c = ord[i], yy = y + 22 + i * rh;
      if (c.id === focusId) { ctx.fillStyle = "rgba(255,216,77,0.22)"; ctx.fillRect(x, yy, w, rh); }
      ctx.fillStyle = "#fff"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "right";
      ctx.fillText(String(i + 1), x + 20, yy + 14);
      ctx.fillStyle = c.color; ctx.fillRect(x + 25, yy + 3, 4, rh - 6);
      ctx.textAlign = "left"; ctx.font = (c.id === focusId ? "bold " : "") + "12px sans-serif";
      ctx.fillStyle = c.state === "dnf" ? "#888" : "#fff";
      ctx.fillText(short(c.name, 9), x + 34, yy + 14);
      ctx.textAlign = "right"; ctx.font = "11px monospace"; ctx.fillStyle = "#cfd6dd";
      var gap = "";
      if (c.state === "dnf") gap = "DNF";
      else if (i === 0) gap = c.state === "fin" ? fmtTime(c.finT) : "LEADER";
      else {
        var p = ord[i - 1];
        if (c.state === "fin" && p.state === "fin") gap = "+" + (c.finT - p.finT).toFixed(2);
        else if (c.state === "run") gap = "+" + Math.max(0, (p.s - c.s) / Math.max(5, c.v)).toFixed(1) + "s";
      }
      ctx.fillText(gap, x + w - 6, yy + 14);
    }
    ctx.restore();
  }
  // 右上：LIVE／REPLAY 標誌、時間、山路名稱
  function bug(ctx, f, race, label, live) {
    ctx.save();
    var w = 190, x = f.w - w - 10, y = 10;
    ctx.fillStyle = "rgba(12,14,20,0.82)"; rr(ctx, x, y, w, 40, 6); ctx.fill();
    var blink = Math.floor(performance.now() / 500) % 2 === 0;
    ctx.fillStyle = live ? (blink ? "#ff3030" : "#7a1010") : "#ffd84d";
    ctx.beginPath(); ctx.arc(x + 14, y + 14, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(live ? "LIVE" : "REPLAY", x + 24, y + 18);
    ctx.textAlign = "right"; ctx.font = "bold 14px monospace";
    ctx.fillText(fmtTime(Math.max(0, race.t)), x + w - 8, y + 18);
    ctx.font = "11px sans-serif"; ctx.fillStyle = "#cfd6dd";
    ctx.fillText(short(label || "", 22), x + w - 8, y + 33);
    ctx.restore();
  }
  // 下方字幕條：名次、名字、車款、時速（切到新的車時滑進來）
  function lowerThird(ctx, f, race, car, age) {
    if (age > 3.2) return;
    var a = clamp(age / 0.35, 0, 1) * clamp((3.2 - age) / 0.35, 0, 1);
    var pos = Core.order(race).indexOf(car) + 1;
    ctx.save();
    ctx.globalAlpha = a;
    var x = 16 - (1 - a) * 60, y = f.h - 84, w = Math.min(360, f.w - 32);
    ctx.fillStyle = "#d4380d"; ctx.fillRect(x, y, 44, 46);
    ctx.fillStyle = "#fff"; ctx.font = "bold 20px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("P" + pos, x + 22, y + 30);
    ctx.fillStyle = "rgba(12,14,20,0.86)"; ctx.fillRect(x + 44, y, w - 44, 46);
    ctx.fillStyle = car.color; ctx.fillRect(x + 44, y, 4, 46);
    ctx.textAlign = "left"; ctx.fillStyle = "#fff"; ctx.font = "bold 16px sans-serif";
    ctx.fillText(short(car.name, 16), x + 56, y + 20);
    ctx.font = "12px sans-serif"; ctx.fillStyle = "#cfd6dd";
    ctx.fillText(short(car.st.name, 28) + " · " + Math.round(car.v * 3.6) + " km/h", x + 56, y + 37);
    ctx.restore();
  }
  // 中下：纏鬥字幕（BATTLE FOR P2 ＋ 差距）、並排
  function battleCaption(ctx, f, race, car) {
    var ord = Core.order(race), p = ord.indexOf(car);
    if (car.state !== "run") return;
    var ahead = p > 0 ? ord[p - 1] : null, behind = ord[p + 1];
    var other = null, pos = 0, gap = 0;
    if (ahead && ahead.state === "run" && (ahead.s - car.s) / Math.max(5, car.v) < 1) { other = ahead; pos = p; gap = (ahead.s - car.s) / Math.max(5, car.v); }
    else if (behind && behind.state === "run" && (car.s - behind.s) / Math.max(5, behind.v) < 1) { other = behind; pos = p + 1; gap = (car.s - behind.s) / Math.max(5, behind.v); }
    if (!other) return;
    var sbs = Math.abs(other.s - car.s) < Core.CAR_LEN * 0.9;
    var txt = sbs ? t("dv_tv_sbs") : t("dv_tv_battle", { p: pos });
    ctx.save();
    ctx.font = "bold 15px sans-serif";
    var w = Math.max(220, ctx.measureText(txt).width + 120), x = (f.w - w) / 2, y = f.h - 40;
    ctx.fillStyle = sbs ? "rgba(212,56,13,0.92)" : "rgba(12,14,20,0.85)"; rr(ctx, x, y, w, 28, 14); ctx.fill();
    var a = ahead === other ? other : car, b = ahead === other ? car : other;
    ctx.fillStyle = a.color; ctx.beginPath(); ctx.arc(x + 16, y + 14, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(x + w - 16, y + 14, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center";
    ctx.fillText(txt + (sbs ? "" : "  +" + gap.toFixed(2) + "s"), f.w / 2, y + 19);
    ctx.restore();
  }
  // 鏡頭名稱（左下小字）
  function camTag(ctx, f, kind, extra) {
    ctx.save();
    ctx.font = "bold 11px sans-serif"; ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 3;
    var s = "● " + t("dv_tvcam_" + kind) + (extra ? "  " + extra : "");
    ctx.strokeText(s, f.w - 12, f.h - 10); ctx.fillText(s, f.w - 12, f.h - 10);
    ctx.restore();
  }
  // REPLAY 轉場：斜向色帶掃過畫面（p：0→1）
  function stinger(ctx, f, p, text) {
    if (p <= 0 || p >= 1) return;
    ctx.save();
    var e = p < 0.5 ? p * 2 : (1 - p) * 2;     // 中間最滿
    var cx = -f.w * 0.6 + p * f.w * 2.2;
    var bands = [["#d4380d", 0], ["#ffd84d", 0.18], ["#121418", 0.3]];
    bands.forEach(function (b) {
      var x0 = cx - b[1] * f.w;
      ctx.fillStyle = b[0];
      ctx.beginPath(); ctx.moveTo(x0 - f.w * 0.55, 0); ctx.lineTo(x0 + f.w * 0.05, 0); ctx.lineTo(x0 - f.w * 0.15, f.h); ctx.lineTo(x0 - f.w * 0.75, f.h); ctx.closePath(); ctx.fill();
    });
    if (e > 0.35) {
      ctx.globalAlpha = clamp((e - 0.35) / 0.4, 0, 1);
      ctx.fillStyle = "#fff"; ctx.font = "italic bold " + Math.round(Math.min(48, f.w / 10)) + "px sans-serif"; ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 5;
      ctx.strokeText(text || "REPLAY", f.w / 2, f.h / 2 + 14); ctx.fillText(text || "REPLAY", f.w / 2, f.h / 2 + 14);
    }
    ctx.restore();
  }
  // 重播時的資訊：左上 REPLAY、慢動作倍率、角度、說明、進度
  function replayOverlay(ctx, f, info) {
    ctx.save();
    var blink = Math.floor(performance.now() / 350) % 2;
    ctx.fillStyle = "rgba(12,14,20,0.82)"; rr(ctx, 10, 10, 210, 42, 6); ctx.fill();
    ctx.fillStyle = blink ? "#ff3b3b" : "#ffd84d"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("▶ REPLAY", 20, 28);
    ctx.fillStyle = "#cfd6dd"; ctx.font = "11px sans-serif";
    ctx.fillText(t("dv_tv_angle", { i: info.angle, n: info.angles }) + " · " + t("dv_tvcam_" + info.kind) + " · " + info.speed + "×", 20, 44);
    if (info.caption) {
      ctx.font = "bold 16px sans-serif";
      var w = Math.min(f.w - 24, ctx.measureText(info.caption).width + 36), x = (f.w - w) / 2, y = f.h - 64;
      ctx.fillStyle = "rgba(12,14,20,0.86)"; rr(ctx, x, y, w, 32, 6); ctx.fill();
      ctx.fillStyle = info.color || "#d4380d"; ctx.fillRect(x, y, 5, 32);
      ctx.fillStyle = "#fff"; ctx.textAlign = "center";
      ctx.fillText(info.caption, f.w / 2, y + 21);
    }
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(0, f.h - 4, f.w, 4);
    ctx.fillStyle = "#ffd84d"; ctx.fillRect(0, f.h - 4, f.w * clamp(info.progress, 0, 1), 4);
    ctx.restore();
  }

  // ---------------- 精彩片段 ----------------
  // 從事件挑精華：玩家參與的超車／前三名之爭／招式、晚煞車與並排超車、擦撞、打滑退賽、冠軍與小差距衝線
  function highlights(race, max) {
    var tr = race.track, list = [], fins = [];
    var posAt = {};
    race.events.forEach(function (e) {
      var c = race.cars[e.car];
      if (!c) return;
      var score = 0, other = e.other !== undefined ? race.cars[e.other] : null;
      if ((e.type === "pass" || e.type === "contact") && e.t < 8) return;   // 起跑排頭的位置交換不算精華
      if (e.type === "pass") {
        score = 2 + (e.kind ? 2 : 0) + (e.move ? 2 : 0) + (!c.cpu || other && !other.cpu ? 2 : 0);
        list.push({ type: "pass", t: e.t, car: c.id, other: e.other, kind: e.kind || null, move: e.move || null, score: score });
      } else if (e.type === "contact") list.push({ type: "contact", t: e.t, car: c.id, other: e.other, score: 3 + (!c.cpu ? 1 : 0) });
      else if (e.type === "spin") list.push({ type: "spin", t: e.t, car: c.id, v: e.v, score: 1.5 + (!c.cpu ? 1.5 : 0) + (e.v > 80 ? 1 : 0) });
      else if (e.type === "dnf" && e.why === "crash") list.push({ type: "crash", t: e.t, car: c.id, score: 3 });
      else if (e.type === "fin") fins.push({ t: c.finT, car: c.id });
      void posAt;
    });
    fins.sort(function (a, b) { return a.t - b.t; });
    fins.forEach(function (f2, i) {
      if (i === 0) list.push({ type: "win", t: f2.t, car: f2.car, score: 99 });
      else if (f2.t - fins[i - 1].t < 0.5) list.push({ type: "photo", t: f2.t, car: f2.car, other: fins[i - 1].car, gap: f2.t - fins[i - 1].t, score: 6 });
    });
    // 同一時間附近只留分數最高的一個
    list.sort(function (a, b) { return b.score - a.score; });
    var kept = [];
    list.forEach(function (h) {
      if (kept.length >= (max || 10)) return;
      if (kept.some(function (k) { return Math.abs(k.t - h.t) < 3.5; })) return;
      kept.push(h);
    });
    kept.sort(function (a, b) { return a.t - b.t; });
    void tr;
    return kept;
  }
  // 精華（或超車事件）→ 重播腳本：同一瞬間兩個角度
  function replayPlan(h, endT) {
    var et = h.t, ang2 = h.type === "spin" || h.type === "crash" ? "heli" : h.type === "win" || h.type === "photo" ? "heli" : (Math.floor(et) % 2 ? "chase" : "heli");
    var pre = h.type === "win" || h.type === "photo" ? 3 : 2.8;
    return [
      { kind: "track", from: Math.max(0, et - pre), to: Math.min(endT, et + 0.8), speed: 0.65, focus: h.other !== undefined && h.type === "pass" ? h.car : h.car, trackAt: et },
      { kind: ang2, from: Math.max(0, et - 1.6), to: Math.min(endT, et + 1.2), speed: 0.4, focus: h.car }
    ];
  }
  function caption(race, h) {
    var c = race.cars[h.car], o = h.other !== undefined && h.other !== null ? race.cars[h.other] : null;
    if (h.type === "pass") {
      if (h.move) return t("dv_ev_pass_move", { name: c.name, other: o.name, move: t("dv_move_" + h.move) });
      if (h.kind) return t("dv_tv_pass_" + h.kind, { name: c.name, other: o.name });
      return t("dv_ev_pass", { name: c.name, other: o.name });
    }
    if (h.type === "contact") return t("dv_ev_contact", { name: c.name, other: o.name });
    if (h.type === "spin") return t("dv_ev_spin", { name: c.name, v: h.v });
    if (h.type === "crash") return t("dv_ev_dnf", { name: c.name });
    if (h.type === "win") return "🏆 " + t("dv_winner", { name: c.name }) + " · " + fmtTime(c.finT);
    if (h.type === "photo") return "📸 " + t("dv_tv_photo", { name: c.name, other: o.name, gap: h.gap.toFixed(3) });
    return "";
  }

  window.PriTestDejavuTv = {
    shot: shot, trackDone: trackDone, placeTrackCam: placeTrackCam, trackPt: trackPt, direct: direct, battle: battle,
    tower: tower, bug: bug, lowerThird: lowerThird, battleCaption: battleCaption, camTag: camTag, stinger: stinger, replayOverlay: replayOverlay,
    highlights: highlights, replayPlan: replayPlan, caption: caption, KINDS: ["track", "chase", "heli", "lead", "onboard", "top"]
  };
})();
