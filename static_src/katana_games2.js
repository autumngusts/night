// 神前鍛刀對決：工序小遊戲 第四批（使用者指定 2026-10-21：再做約 20 種，鍛刀時隨機碰到）
// 全部用同一個畫布框架 make(type, spec)，交給 katana_core 的成績格式與其他小遊戲相同：
//   { acc: 0〜1, strikes, cold, reheats }。規則與數值計算不變。
//
//   計時類　pendulum 振り鎚　color 色見　align 照準　sustain 間合い　reaction 火花　lissa 狙い打ち　slide 砥石滑らし　beat 拍子保持
//   持續類　bellows ふいご　balance 水平　pressure 力加減　steer 刃文なぞり（固定時間，成績＝待在範圍內的比例）
//   判讀類　count 回數打ち　pairs 神経衰弱　odd 見分け　spot 疵探し　heatpick 熱見比べ　order 順打ち　combo 型　catch 受け
//
// spec：{ btn: 主按鈕文字 key, pad: 方向鍵盤（"lr"＝只有左右）, cont: [表演 ms, 較真 ms]（持續類）, warm: 不計分的開頭 ms,
//         coolRate: 鋼冷卻速度倍率（要想的遊戲較慢）, gap: 兩次之間的停頓 ms, trials(cfg, a): 回合數,
//         init(a, now), trial(a, now), frame(a, now, dt), press/release(a, now), dir(a, k, down, now), point(a, x, y, now), move(a, x, y),
//         auto(a, now, q)：測試用，依規則操作 a.ui（不是直接寫成績）, progress(a): 進度文字 }
// 輸入時間一律用事件的 timeStamp（與 performance.now 同一時間軸），自動遊玩傳入預定時間。
(function () {
  "use strict";

  var Core = window.PriTestKatanaCore, Games = window.PriTestKatanaGames;
  if (!Core || !Games) return;

  var TAU = Math.PI * 2;
  function r2(v) { return Math.round(v * 100) / 100; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function avg(a) { var s = 0; a.forEach(function (x) { s += x; }); return a.length ? s / a.length : 0; }
  // 區間評分：偏差 d、半寬 half → 中心 40% 內＝1，半寬處＝0.6，兩倍半寬＝0
  function zone(d, half) {
    d = Math.abs(d);
    if (d <= half * 0.4) return 1;
    if (d <= half) return r2(1 - 0.4 * (d - half * 0.4) / (half * 0.6));
    if (d <= half * 2) return r2(0.6 * (1 - (d - half) / half));
    return 0;
  }
  // 越快越好：用掉的時間比例 used（0〜1）→ base〜1
  function quick(used, base) { return r2(base + (1 - base) * clamp(1 - used, 0, 1)); }
  function grade(s) { return s >= 0.9 ? "perfect" : s >= 0.7 ? "great" : s >= 0.35 ? "good" : "miss"; }
  // 來回移動（三角波）：t 毫秒、速度 v px/s、起點偏移 off
  function tri(t, lo, hi, v, off) {
    var span = hi - lo, p = ((t * v / 1000 + off) % (2 * span) + 2 * span) % (2 * span);
    return lo + (p < span ? p : 2 * span - p);
  }
  var NUMS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  var DIRS = [["up", "↑", "ArrowUp", "w"], ["down", "↓", "ArrowDown", "s"], ["left", "←", "ArrowLeft", "a"], ["right", "→", "ArrowRight", "d"]];

  // ---- 繪圖小工具（畫布固定深色爐邊底，兩種主題都一樣） ----
  var BG = "#1f1b18", INK = "#efe6d8", DIM = "rgba(239,230,216,0.45)", GOLD = "#e0b44c", RED = "#e2604a";
  function clear(a) { var g = a.g; g.fillStyle = BG; g.fillRect(0, 0, a.W, a.H); }
  function text(a, s, x, y, size, color, align) {
    var g = a.g;
    g.fillStyle = color || INK; g.font = "bold " + (size || 14) + "px sans-serif"; g.textAlign = align || "center"; g.textBaseline = "middle";
    g.fillText(s, x, y);
  }
  function bar(a, x, y, w, h, color) { a.g.fillStyle = color; a.g.fillRect(x, y, w, h); }
  function ring(a, x, y, r, color, lw) { var g = a.g; g.strokeStyle = color; g.lineWidth = lw || 2; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); }
  function dot(a, x, y, r, color) { var g = a.g; g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  function anvil(a, y) { bar(a, 70, y, 180, 10, "#4a4440"); bar(a, 110, y + 10, 100, 16, "#3a3532"); }
  function steelColor(a) { return a.steelCss || "#9aa1a8"; }
  // 刀身（橫向，切先朝右）
  function blade(a, color, y) {
    var g = a.g; y = y || a.H / 2;
    g.fillStyle = color; g.beginPath();
    g.moveTo(24, y - 12); g.lineTo(270, y - 14); g.quadraticCurveTo(300, y - 12, 304, y + 2); g.lineTo(270, y + 12); g.lineTo(24, y + 12); g.closePath(); g.fill();
    bar(a, 10, y - 8, 16, 16, "#5b4a3a");
  }

  // ============================== 共用框架 ==============================
  function make(type, spec) {
    return function (ctx, cfg) {
      var el = ctx.el, t = ctx.t, res = ctx.result, hard = ctx.mode === "serious";
      var box = el("div", { class: "kt-mg kt-tg kt-tg-" + type, "data-live": res ? null : "1" });
      box.appendChild(el("div", { class: "kt-mg-title", text: cfg.title }));
      var st = cfg.coolMs ? Games.steelBar(ctx, cfg) : null;
      if (st) box.appendChild(st.node);
      var W = 320, H = 180;
      var cv = el("canvas", { class: "kt-tg-canvas", width: String(W), height: String(H) });
      var stage = el("div", { class: "kt-g-stage" }, [cv]);
      box.appendChild(stage);
      var info = el("div", { class: "kt-readout" });
      box.appendChild(info);
      var a = {
        ctx: ctx, cfg: cfg, t: t, g: cv.getContext("2d"), W: W, H: H, hard: hard, stage: stage,
        rng: Core.makeRng(ctx.seed + "|" + type), i: 0, scores: [], strikeCount: 0, good: 0, elapsed: 0,
        k: function (show, serious) { return hard ? serious : show; }
      };
      a.tempColor = function (T) { return ctx.tempColor(T, false); };
      function doneText(r) {
        return cfg.coolMs ? t("kt_hammer_done", { p: Math.round(r.acc * 100), c: r.cold || 0, r: r.reheats || 0 }) : t("kt_arc_done", { p: Math.round(r.acc * 100) });
      }
      if (res) {
        if (st) st.done();
        a.steelCss = st ? ctx.tempColor(900, false) : null;
        clear(a); blade(a, steelColor(a));
        info.textContent = doneText(res);
        return box;
      }

      var running = false, autoQ = null, pauseUntil = 0, coolT = 0, timers = [], dur = 0, warm = spec.warm || 0;
      a.n = spec.trials ? spec.trials(cfg, a) : cfg.strikes;
      if (spec.cont) dur = cfg.coolMs ? Math.min(a.k(spec.cont[0], spec.cont[1]), cfg.coolMs * 0.6) : a.k(spec.cont[0], spec.cont[1]);
      a.dur = dur;
      function sync(now) { if (st) { st.start(now - coolT); a.steelCss = st.node.style.background; } }
      function updateInfo() {
        if (spec.cont) info.textContent = t("kt_tg_cont", { s: Math.max(0, (dur - a.elapsed) / 1000).toFixed(1), p: Math.round(a.good / Math.max(1, a.elapsed - warm) * 100) });
        else info.textContent = spec.progress ? spec.progress(a) : t("kt_tg_progress", { n: a.scores.length, total: a.n });
      }
      function finish() {
        if (!running) return;
        running = false;
        timers.forEach(clearTimeout);
        var r = spec.cont
          ? { acc: r2(clamp(a.good / Math.max(1, dur - warm), 0, 1)), strikes: Math.max(cfg.strikes || 0, cfg.minStrikes || 0) }
          : { acc: r2(avg(a.scores)), strikes: Math.max(a.strikeCount || a.scores.length, cfg.minStrikes || 0) };
        if (st) { var s = st.stats(); r.cold = s.cold; r.reheats = s.reheats; }
        ctx.done(r);
      }
      // 一次判定。keep＝同一回合繼續（拍子保持），不停頓
      a.score = function (s, now, keep) {
        if (!running || (!keep && !a.active)) return;
        if (!keep) a.active = false;
        a.scores.push(s);
        sync(now);
        if (st && s > 0) st.strike(now);
        Games.popup(ctx, stage, grade(s));
        if (s <= 0) Games.shake(stage);
        updateInfo();
        if (a.scores.length >= a.n) { finish(); return; }
        // 鋼冷到 1000℃ 以下：回爐（非連續的遊戲停頓一下）
        if (st && st.temp(now) < 1000) { st.reheat(now); coolT = 0; if (!keep) pauseUntil = Math.max(pauseUntil, now + 550); }
        if (!keep) { pauseUntil = Math.max(pauseUntil, now + (spec.gap || 380)); a.pending = true; }
      };
      a.tap = function (now) { a.strikeCount++; sync(now); if (st) st.strike(now); };
      a.later = function (ms, fn) {
        var at = performance.now() + ms;
        timers.push(setTimeout(function () { if (running) fn(at); }, ms));
      };
      a.finish = finish;

      // 輸入（玩家與自動遊玩共用同一條路）
      function live(now) { return running && (spec.cont || (a.active && now >= a.t0)); }
      a.ui = {
        press: function (now) { if (live(now) && spec.press) spec.press(a, now); },
        release: function (now) { if (running && spec.release) spec.release(a, now); },
        dir: function (k, down, now) { if (running && (live(now) || !down) && spec.dir) spec.dir(a, k, down, now); },
        point: function (x, y, now) { if (!live(now)) return; if (spec.point) spec.point(a, x, y, now); else if (spec.press) spec.press(a, now); },
        move: function (x, y) { if (running && spec.move) spec.move(a, x, y); }
      };

      function begin(now) { a.active = true; a.pending = false; a.t0 = now; a.plan = null; spec.trial(a, now); }
      function frame(now, dt) {
        if (st && (spec.cont || a.active)) coolT += dt * 1000 * (spec.coolRate || 1);
        sync(now);
        if (st) st.paint(now);
        if (spec.cont) {
          a.elapsed += dt * 1000;
          if (a.elapsed >= dur) { spec.frame(a, now, 0); finish(); return false; }
        } else if (a.pending && now >= pauseUntil) begin(now);
        spec.frame(a, now, dt);
        if (!running) return false;
        if (autoQ !== null && (spec.cont || a.active)) spec.auto(a, now, autoQ);
        updateInfo();
        if (!running) return false;
      }
      var btnGo = el("button", { type: "button", class: "kt-primary", text: t("kt_hammer_start") });
      var btnAct = spec.btn ? el("button", { type: "button", class: "kt-primary kt-hit kt-big-hit", text: t(spec.btn), disabled: true }) : null;
      function start() {
        if (running) return;
        running = true; btnGo.disabled = true; if (btnAct) btnAct.disabled = false;
        var now = performance.now();
        if (st) st.start(now);
        if (spec.init) spec.init(a, now);
        if (spec.cont) { a.active = true; a.t0 = now; } else begin(now);
        ctx.run("tg-" + type, frame, function (ev) {
          if (ev.code === "Space" || ev.key === " ") { ev.preventDefault(); if (!ev.repeat) a.ui.press(ev.timeStamp || performance.now()); return; }
          for (var k = 0; k < 4; k++) if (ev.key === DIRS[k][2] || String(ev.key).toLowerCase() === DIRS[k][3]) {
            if (!spec.dir) return;
            ev.preventDefault(); if (!ev.repeat) a.ui.dir(k, true, ev.timeStamp || performance.now());
          }
        }, function (ev) {
          if (ev.code === "Space" || ev.key === " ") a.ui.release(ev.timeStamp || performance.now());
          for (var k = 0; k < 4; k++) if (ev.key === DIRS[k][2] || String(ev.key).toLowerCase() === DIRS[k][3]) a.ui.dir(k, false, performance.now());
        });
      }
      function toXY(ev) { var r = cv.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width * W, (ev.clientY - r.top) / r.height * H]; }
      cv.addEventListener("pointerdown", function (ev) {
        ev.preventDefault();
        if (!running) { start(); return; }
        var p = toXY(ev);
        a.ui.move(p[0], p[1]);
        a.ui.point(p[0], p[1], ev.timeStamp || performance.now());
      });
      cv.addEventListener("pointermove", function (ev) { var p = toXY(ev); a.ui.move(p[0], p[1]); });
      cv.addEventListener("pointerup", function (ev) { a.ui.release(ev.timeStamp || performance.now()); });
      btnGo.addEventListener("click", start);
      var row = [btnGo];
      if (btnAct) {
        btnAct.addEventListener("pointerdown", function (ev) { ev.preventDefault(); a.ui.press(ev.timeStamp || performance.now()); });
        btnAct.addEventListener("pointerup", function (ev) { a.ui.release(ev.timeStamp || performance.now()); });
        btnAct.addEventListener("pointerleave", function () { a.ui.release(performance.now()); });
        row.push(btnAct);
      }
      if (spec.pad) {
        var pad = el("div", { class: "kt-arrow-pad" });
        DIRS.forEach(function (dd, k) {
          if (spec.pad === "lr" && k < 2) return;
          if (spec.pad === "ud" && k >= 2) return;
          var lbl = cfg.labels && spec.padLabels ? cfg.labels[dd[0]] : "";
          var b = el("button", { type: "button", class: "kt-arrow-btn" }, [el("span", { class: "kt-arrow-sym", text: dd[1] }), el("span", { class: "kt-arrow-lbl", text: lbl })]);
          b.addEventListener("pointerdown", function (ev) { ev.preventDefault(); if (!running) start(); else a.ui.dir(k, true, ev.timeStamp || performance.now()); });
          b.addEventListener("pointerup", function () { a.ui.dir(k, false, performance.now()); });
          b.addEventListener("pointerleave", function () { a.ui.dir(k, false, performance.now()); });
          pad.appendChild(b);
        });
        box.appendChild(pad);
      }
      box.appendChild(el("div", { class: "kt-muted", text: t("kt_" + type + "_hint") }));
      box.appendChild(el("div", { class: "kt-actions" }, row));
      clear(a); blade(a, steelColor(a));
      text(a, t("kt_tg_tap_start"), W / 2, H / 2, 15, INK);
      updateInfo();
      box.ktAuto = function (q) { autoQ = q === undefined ? 1 : q; start(); };
      return box;
    };
  }
  // 自動遊玩的「差的打法」：第奇數回合出錯
  function sloppy(a, q) { return q < 1 && a.i % 2 === 1; }

  // ============================== 計時類 ==============================

  // 振り鎚：大鎚像擺錘來回，擺到最低點（打在鋼上）時按
  var pendulum = {
    btn: "kt_tg_strike", coolRate: 0.8,
    trial: function (a) {
      a.i = a.scores.length;
      a.A = (a.k(55, 62) + a.rng() * 20) * Math.PI / 180;
      a.P = a.k(1700, 1150) * (0.85 + a.rng() * 0.3);
      a.ph = a.rng() < 0.5 ? 0 : Math.PI;
      a.half = a.k(11, 7) * Math.PI / 180;
    },
    ang: function (a, now) { return a.A * Math.cos(TAU * (now - a.t0) / a.P + a.ph); },
    frame: function (a, now) {
      clear(a);
      var g = a.g, th = a.active ? pendulum.ang(a, now) : 0;
      anvil(a, 150); bar(a, 110, 138, 100, 12, steelColor(a));
      g.fillStyle = "rgba(224,180,76,0.18)"; g.beginPath(); g.moveTo(160, 18); g.arc(160, 18, 130, Math.PI / 2 - a.half, Math.PI / 2 + a.half); g.fill();
      var hx = 160 + Math.sin(th) * 112, hy = 18 + Math.cos(th) * 112;
      g.strokeStyle = "#a0805a"; g.lineWidth = 4; g.beginPath(); g.moveTo(160, 18); g.lineTo(hx, hy); g.stroke();
      g.save(); g.translate(hx, hy); g.rotate(-th); bar(a, -18, -2, 36, 16, "#6c7178"); g.restore();
      dot(a, 160, 18, 5, GOLD);
      if (a.active && now - a.t0 > a.P * 2.6) a.score(0, now);
    },
    press: function (a, now) { a.score(zone(pendulum.ang(a, now), a.half), now); },
    auto: function (a, now, q) {
      if (a.plan) return;
      a.plan = 1;
      // 下一次擺到最低點的時間：相位 φ＝2π(t−t0)/P＋ph 到 π/2 的奇數倍
      var phase = TAU * (now - a.t0) / a.P + a.ph, next = Math.ceil((phase - Math.PI / 2) / Math.PI + 0.08) * Math.PI + Math.PI / 2;
      var at = (next - phase) / TAU * a.P + (sloppy(a, q) ? 90 : 0);
      a.later(at, function (tt) { a.ui.press(tt); });
    }
  };

  // 色見：鋼慢慢加熱變色，顏色和樣本一樣時按
  var color = {
    btn: "kt_tg_take", coolRate: 0.7,
    trial: function (a) {
      a.i = a.scores.length;
      a.T = Math.round((a.k(900, 880) + a.rng() * a.k(330, 360)) / 10) * 10;
      a.R = a.k(2600, 1900);
      a.half = a.k(36, 22);
    },
    temp: function (a, now) { return 650 + (now - a.t0) / a.R * 700; },
    frame: function (a, now) {
      clear(a);
      var T = a.active ? color.temp(a, now) : 650;
      text(a, a.t("kt_color_sample"), 52, 22, 12, DIM);
      bar(a, 22, 34, 60, 34, a.tempColor(a.T));
      a.g.strokeStyle = INK; a.g.lineWidth = 1; a.g.strokeRect(22, 34, 60, 34);
      bar(a, 110, 50, 190, 46, a.tempColor(T));
      if (!a.hard) {
        // 表演：下方色帶標出樣本的位置（不標目前溫度）
        for (var x = 0; x < 280; x += 4) bar(a, 20 + x, 140, 4, 12, a.tempColor(650 + x / 280 * 700));
        bar(a, 20 + (a.T - 650) / 700 * 280 - 1, 134, 3, 24, INK);
      }
      if (a.active && T > 1365) a.score(0, now);
    },
    press: function (a, now) { a.score(zone(color.temp(a, now) - a.T, a.half), now); },
    auto: function (a, now, q) {
      if (a.plan) return;
      a.plan = 1;
      var at = a.t0 + (a.T - 650) / 700 * a.R + (sloppy(a, q) ? a.R * 0.08 : 0) - now;
      a.later(Math.max(0, at), function (tt) { a.ui.press(tt); });
    }
  };

  // 照準：先停直線（左右），再停橫線（上下），交點越接近記號越好
  var align = {
    btn: "kt_tg_stop", coolRate: 0.7,
    trial: function (a, now) {
      a.i = a.scores.length;
      a.tx = 50 + a.rng() * 220; a.ty = 40 + a.rng() * 100;
      a.v = a.k(230, 340); a.ox = a.rng() * 400; a.oy = a.rng() * 300;
      a.phase = 0; a.ph0 = now; a.fx = null;
    },
    pos: function (a, now) { return a.phase === 0 ? tri(now - a.ph0, 20, 300, a.v, a.ox) : tri(now - a.ph0, 20, 160, a.v * 0.7, a.oy); },
    frame: function (a, now) {
      clear(a);
      var g = a.g;
      bar(a, 30, 60, 260, 60, steelColor(a));
      ring(a, a.tx, a.ty, 9, GOLD, 2); dot(a, a.tx, a.ty, 2, GOLD);
      g.strokeStyle = RED; g.lineWidth = 2;
      var x = a.phase === 0 && a.active ? align.pos(a, now) : a.fx;
      if (x !== null && x !== undefined) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, a.H); g.stroke(); }
      if (a.phase === 1 && a.active) { var y = align.pos(a, now); g.beginPath(); g.moveTo(0, y); g.lineTo(a.W, y); g.stroke(); }
      if (a.active && now - a.ph0 > 5000) a.score(0, now);
    },
    press: function (a, now) {
      if (a.phase === 0) { a.fx = align.pos(a, now); a.phase = 1; a.ph0 = now; a.plan = null; return; }
      var y = align.pos(a, now);
      a.score(zone(Math.sqrt((a.fx - a.tx) * (a.fx - a.tx) + (y - a.ty) * (y - a.ty)), a.k(10, 7)), now);
    },
    auto: function (a, now, q) {
      if (a.plan) return;
      a.plan = 1;
      var target = a.phase === 0 ? a.tx : a.ty;
      for (var dt = 30; dt < 4000; dt += 1) {
        var t1 = now + dt, t2 = t1 + 1;
        var d1 = align.pos(a, t1) - target, d2 = align.pos(a, t2) - target;
        if (d1 === 0 || (d1 < 0) !== (d2 < 0)) {
          var at = dt + Math.abs(d1) / (Math.abs(d1) + Math.abs(d2)) + (sloppy(a, q) ? 70 : 0);
          a.later(at, function (tt) { a.ui.press(tt); });
          return;
        }
      }
    }
  };

  // 間合い：按住到指定的時間再放開；量表中途會消失
  var sustain = {
    btn: "kt_tg_hold", coolRate: 0.7, MAX: 2800,
    trial: function (a) {
      a.i = a.scores.length;
      a.T = a.k(900, 800) + a.rng() * a.k(900, 1300);
      a.hold = null;
    },
    frame: function (a, now) {
      clear(a);
      var held = a.hold !== null ? now - a.hold : 0, x0 = 20, w = 280;
      bar(a, x0, 70, w, 30, "#2e2925");
      bar(a, x0 + a.T / sustain.MAX * w - 2, 62, 4, 46, GOLD);
      var hideAt = a.T * a.k(0.6, 0.3);
      if (a.hold !== null && held < hideAt) bar(a, x0, 70, held / sustain.MAX * w, 30, steelColor(a));
      else if (a.hold !== null) text(a, "？", x0 + 14, 85, 18, INK);
      text(a, (a.T / 1000).toFixed(2) + "s", x0 + a.T / sustain.MAX * w, 48, 13, GOLD);
      if (a.active && a.hold !== null && held > sustain.MAX) a.score(0, now);
      if (a.active && a.hold === null && now - a.t0 > 6000) a.score(0, now);
    },
    press: function (a, now) { if (a.hold === null) a.hold = now; },
    release: function (a, now) {
      if (!a.active || a.hold === null) return;
      a.score(zone(now - a.hold - a.T, a.k(110, 70)), now);
    },
    auto: function (a, now, q) {
      if (a.plan) return;
      a.plan = 1;
      var off = sloppy(a, q) ? 230 : 0;
      a.later(150, function (tt) { a.ui.press(tt); a.later(a.T + off, function (t2) { a.ui.release(t2); }); });
    }
  };

  // 火花：等火花迸出的瞬間按；太早按＝失（較真模式會有假的暗紅閃光）
  var reaction = {
    btn: "kt_tg_strike", coolRate: 0.6,
    trial: function (a) {
      a.i = a.scores.length;
      a.wait = a.k(900, 800) + a.rng() * a.k(1500, 1900);
      a.fake = a.hard && a.rng() < 0.6 ? a.wait * (0.3 + a.rng() * 0.4) : -1;
      a.limit = a.k(650, 480);
    },
    frame: function (a, now) {
      clear(a);
      anvil(a, 120); bar(a, 115, 108, 90, 12, steelColor(a));
      var e = now - a.t0;
      if (a.active && e >= a.wait) {
        var f = 1 - (e - a.wait) / a.limit;
        for (var k = 0; k < 14; k++) { var ang = k / 14 * TAU; a.g.strokeStyle = "rgba(255,226,140," + clamp(f, 0.2, 1) + ")"; a.g.lineWidth = 2; a.g.beginPath(); a.g.moveTo(160 + Math.cos(ang) * 12, 100 + Math.sin(ang) * 12); a.g.lineTo(160 + Math.cos(ang) * 44, 100 + Math.sin(ang) * 44); a.g.stroke(); }
        dot(a, 160, 100, 10, "#fff4c8");
        if (e - a.wait > a.limit) a.score(0, now);
      } else if (a.active && a.fake >= 0 && e >= a.fake && e < a.fake + 140) dot(a, 160, 100, 9, "#8a3a2a");
    },
    press: function (a, now) {
      var e = now - a.t0;
      if (e < a.wait) { a.score(0, now); return; } // 太早
      a.score(quick((e - a.wait) / a.limit, 0.6), now);
    },
    auto: function (a, now, q) {
      if (a.plan) return;
      a.plan = 1;
      var at = a.t0 + (sloppy(a, q) ? a.wait * 0.5 : a.wait + 60) - now;
      a.later(Math.max(0, at), function (tt) { a.ui.press(tt); });
    }
  };

  // 狙い打ち：游標沿著 8 字（李薩如曲線）在鋼上移動，經過記號時按
  var lissa = {
    btn: "kt_tg_strike", coolRate: 0.6,
    trial: function (a) {
      a.i = a.scores.length;
      a.px = TAU / (a.k(2800, 2100) * (0.9 + a.rng() * 0.2));
      a.ratio = [1.5, 1.33, 0.75, 2][Math.floor(a.rng() * 4)];
      a.phi = a.rng() * TAU;
      a.ts = 700 + a.rng() * 1900;
      var p = lissa.pos(a, a.t0 + a.ts);
      a.tx = p[0]; a.ty = p[1];
    },
    pos: function (a, now) { var e = now - a.t0; return [160 + 115 * Math.sin(a.px * e + a.phi), 90 + 58 * Math.sin(a.px * a.ratio * e)]; },
    frame: function (a, now) {
      clear(a);
      bar(a, 35, 40, 250, 100, steelColor(a));
      ring(a, a.tx, a.ty, a.k(12, 8), GOLD, 2);
      if (!a.active) return;
      for (var k = 1; k <= 6; k++) { var q = lissa.pos(a, now - k * 40); dot(a, q[0], q[1], 5 - k * 0.6, "rgba(226,96,74," + (0.5 - k * 0.07) + ")"); }
      var p = lissa.pos(a, now);
      dot(a, p[0], p[1], 6, RED);
      if (now - a.t0 > 5200) a.score(0, now);
    },
    press: function (a, now) { var p = lissa.pos(a, now); a.score(zone(Math.sqrt((p[0] - a.tx) * (p[0] - a.tx) + (p[1] - a.ty) * (p[1] - a.ty)), a.k(12, 8)), now); },
    auto: function (a, now, q) {
      if (a.plan) return;
      a.plan = 1;
      a.later(Math.max(0, a.t0 + a.ts + (sloppy(a, q) ? 80 : 0) - now), function (tt) { a.ui.press(tt); });
    }
  };

  // 砥石滑らし：按住時力道量表來回擺動，放開把砥石推出去；砥石有摩擦，停在記號上最好
  var slide = {
    btn: "kt_tg_hold", coolRate: 0.5, MU: 300, RANGE: 270,
    trial: function (a) {
      a.i = a.scores.length;
      a.D = 70 + a.rng() * 180;
      a.per = a.k(1400, 1000);
      a.hold = null; a.v0 = null; a.rel = 0;
    },
    power: function (a, now) { return tri(now - a.hold, 0, 1, 2000 / a.per, 0); },
    dist: function (p) { return p * p * slide.RANGE; },
    frame: function (a, now) {
      clear(a);
      var x0 = 30;
      bar(a, 20, 96, 290, 22, steelColor(a));
      bar(a, x0 + a.D - a.k(14, 9), 88, a.k(28, 18), 38, "rgba(224,180,76,0.35)");
      bar(a, x0 + a.D - 1, 84, 2, 46, GOLD);
      var sx = x0;
      if (a.v0 !== null) {
        var tt = (now - a.rel) / 1000, stopT = a.v0 / slide.MU;
        var e = Math.min(tt, stopT);
        sx = x0 + a.v0 * e - slide.MU * e * e / 2;
        if (a.active && tt >= stopT + 0.15) a.score(zone(slide.dist(a.p) - a.D, a.k(14, 9)), now);
      }
      bar(a, sx - 14, 80, 28, 16, "#8b8f8a");
      if (a.hold !== null && a.v0 === null) {
        var p = slide.power(a, now);
        bar(a, 20, 150, 280, 12, "#2e2925"); bar(a, 20, 150, 280 * p, 12, RED);
        if (!a.hard) bar(a, x0 + slide.dist(p) - 1, 128, 2, 12, DIM); // 表演：預測落點
        if (now - a.hold > a.per * 3) slide.release(a, now);
      }
    },
    press: function (a, now) { if (a.hold === null) a.hold = now; },
    release: function (a, now) {
      if (!a.active || a.hold === null || a.v0 !== null) return;
      a.p = slide.power(a, now);
      a.v0 = Math.sqrt(2 * slide.MU * slide.dist(a.p));
      a.rel = now;
    },
    auto: function (a, now, q) {
      if (a.plan) return;
      a.plan = 1;
      var pStar = Math.sqrt(a.D / slide.RANGE); // 上升段：p＝(t/per)×2
      a.later(150, function (tt) { a.ui.press(tt); a.later(pStar * a.per / 2 + (sloppy(a, q) ? 70 : 0), function (t2) { a.ui.release(t2); }); });
    }
  };

  // 拍子保持：前 4 拍看得到節拍器，之後節拍器消失，照同樣的拍子繼續敲
  var beat = {
    btn: "kt_tg_strike", coolRate: 0.6,
    trial: function (a, now) {
      a.I = a.k(600, 480);
      a.lead = 4;
      a.next = 0; // 下一個要判定的拍（從 0 起算，指的是 lead 之後的第幾拍）
      a.start0 = now + 600;
    },
    beatAt: function (a, j) { return a.start0 + (a.lead + j) * a.I; },
    frame: function (a, now) {
      clear(a);
      var e = now - a.start0, b = Math.floor(e / a.I), f = (e - b * a.I) / a.I;
      var vis = b < a.lead ? 1 : a.k(0.22, 0);
      anvil(a, 130); bar(a, 115, 118, 90, 12, steelColor(a));
      if (e >= 0 && vis > 0) {
        ring(a, 160, 70, 22 + 20 * (1 - f), "rgba(224,180,76," + (vis * (1 - f)) + ")", 3);
        if (b < a.lead) text(a, NUMS[b], 160, 70, 22, GOLD);
      }
      if (e >= 0 && b >= a.lead) text(a, a.t("kt_tg_your_turn"), 160, 28, 13, INK);
      // 錯過的拍＝失
      while (a.next < a.n && now > beat.beatAt(a, a.next) + a.I / 2) { a.next++; a.score(0, now, true); }
    },
    press: function (a, now) {
      if (a.next >= a.n) return;
      var target = beat.beatAt(a, a.next), d = now - target;
      if (d < -a.I / 2) return; // 還在前導拍
      a.next++;
      a.tap(now);
      a.score(zone(d, a.k(75, 50)), now, true);
    },
    auto: function (a, now, q) {
      if (a.plan) return;
      a.plan = 1;
      for (var j = 0; j < a.n; j++) (function (j) {
        var off = q < 1 && j % 2 ? 110 : 0;
        a.later(Math.max(0, beat.beatAt(a, j) + off - now), function (tt) { a.ui.press(tt); });
      })(j);
    }
  };

  // ============================== 持續類 ==============================

  // ふいご：點按送風，火溫會慢半拍跟上；讓火溫維持在金色區間
  var bellows = {
    btn: "kt_tg_pump", cont: [5000, 6500], warm: 1200,
    init: function (a) { a.h = 0.3; a.air = 0.3; a.band = a.k([0.55, 0.78], [0.6, 0.73]); a.lastTap = 0; a.lastAuto = 0; },
    press: function (a, now) {
      if (now - a.lastTap < 70) return;
      a.lastTap = now;
      a.air = Math.min(1.2, a.air + a.k(0.13, 0.11));
    },
    frame: function (a, now, dt) {
      a.air *= Math.exp(-dt * a.k(0.6, 0.75));
      a.h += (a.air - a.h) * Math.min(1, dt * a.k(3, 2.4));
      if (a.elapsed > a.warm0() && a.h >= a.band[0] && a.h <= a.band[1]) a.good += dt * 1000;
      clear(a);
      var g = a.g, fire = a.tempColor(500 + clamp(a.h, 0, 1) * 850);
      var grd = g.createRadialGradient(170, 110, 6, 170, 110, 70); grd.addColorStop(0, fire); grd.addColorStop(1, BG);
      g.fillStyle = grd; g.fillRect(90, 40, 160, 130);
      var bh = 30 + 50 * clamp(1 - (now - a.lastTap) / 300, 0, 1);
      bar(a, 20, 110 - bh / 2, 50, bh, "#6b4a32"); bar(a, 70, 104, 30, 12, "#4a4440");
      bar(a, 280, 20, 18, 140, "#2e2925");
      bar(a, 280, 160 - a.band[1] * 140, 18, (a.band[1] - a.band[0]) * 140, "rgba(224,180,76,0.45)");
      bar(a, 274, 160 - clamp(a.h, 0, 1) * 140 - 2, 30, 4, INK);
    },
    auto: function (a, now, q) {
      if (now - a.lastAuto < 80) return;
      a.lastAuto = now;
      var mid = (a.band[0] + a.band[1]) / 2;
      if (q >= 1 ? a.air < mid - 0.05 : a.h < a.band[0] - 0.02 && now - a.lastTap > 200) a.ui.press(now);
    }
  };

  // 水平：橫桿會被亂流推歪，按 ←／→ 把它扶回水平
  var balance = {
    pad: "lr", cont: [5000, 6500], warm: 300,
    init: function (a) { a.ang = 0; a.w = 0; a.drift = 0; a.driftT = 0; a.nextD = 0; a.L = false; a.R = false; a.tol = a.k(0.12, 0.08); },
    dir: function (a, k, down) { if (k === 2) a.L = down; if (k === 3) a.R = down; },
    frame: function (a, now, dt) {
      if (now > a.nextD) { a.driftT = (a.rng() * 2 - 1) * a.k(1.4, 2); a.nextD = now + 600 + a.rng() * 700; }
      a.drift += (a.driftT - a.drift) * Math.min(1, dt * 2);
      var input = (a.R ? 1 : 0) - (a.L ? 1 : 0);
      a.w += (a.drift + input * a.k(3.2, 3.6) - a.w * 0.8 + a.ang * 0.6) * dt;
      a.ang += a.w * dt;
      if (Math.abs(a.ang) > 0.6) { a.ang = clamp(a.ang, -0.6, 0.6); a.w = 0; }
      if (a.elapsed > a.warm0() && Math.abs(a.ang) < a.tol) a.good += dt * 1000;
      clear(a);
      var g = a.g, ok = Math.abs(a.ang) < a.tol;
      g.fillStyle = "rgba(224,180,76,0.16)"; g.beginPath(); g.moveTo(160, 120); g.arc(160, 120, 140, -a.tol, a.tol); g.arc(160, 120, 140, Math.PI - a.tol, Math.PI + a.tol); g.fill();
      g.save(); g.translate(160, 120); g.rotate(a.ang); bar(a, -130, -8, 260, 14, steelColor(a)); g.restore();
      g.fillStyle = "#4a4440"; g.beginPath(); g.moveTo(160, 126); g.lineTo(144, 160); g.lineTo(176, 160); g.closePath(); g.fill();
      text(a, ok ? "◎" : a.ang > 0 ? "←" : "→", 160, 40, 22, ok ? GOLD : INK);
    },
    auto: function (a, now, q) {
      var u = a.ang + a.w * 0.35, thr = q >= 1 ? a.tol * 0.25 : a.tol * 1.6;
      a.ui.dir(2, u > thr, now); a.ui.dir(3, u < -thr, now);
    }
  };

  // 力加減：按住力道上升、放開下降；金色區間會一直移動
  var pressure = {
    btn: "kt_tg_hold", cont: [5000, 6500], warm: 800,
    init: function (a, now) { a.p = 0.2; a.holding = false; a.P1 = a.k(4200, 3200); a.ph1 = a.rng() * TAU; a.ph2 = a.rng() * TAU; a.w = a.k(0.2, 0.13); a.c0 = now; },
    center: function (a, now) { var e = now - a.c0; return 0.5 + 0.22 * Math.sin(TAU * e / a.P1 + a.ph1) + 0.07 * Math.sin(TAU * e / (a.P1 * 0.43) + a.ph2); },
    press: function (a) { a.holding = true; },
    release: function (a) { a.holding = false; },
    frame: function (a, now, dt) {
      a.p = clamp(a.p + (a.holding ? a.k(0.9, 1.1) : -0.8) * dt, 0, 1);
      var c = pressure.center(a, now);
      if (a.elapsed > a.warm0() && Math.abs(a.p - c) < a.w / 2) a.good += dt * 1000;
      clear(a);
      blade(a, steelColor(a), 50);
      bar(a, 20, 120, 280, 26, "#2e2925");
      bar(a, 20 + (c - a.w / 2) * 280, 116, a.w * 280, 34, "rgba(224,180,76,0.4)");
      bar(a, 20 + a.p * 280 - 2, 112, 4, 42, a.holding ? RED : INK);
    },
    auto: function (a, now, q) {
      var c = pressure.center(a, now);
      if (q >= 1) { if (a.p < c) a.ui.press(now); else a.ui.release(now); }
      else if (a.p < c - a.w * 0.8) a.ui.press(now); else if (a.p > c + a.w * 0.8) a.ui.release(now);
    }
  };

  // 刃文なぞり：筆自動往右走，用 ↑↓（或拖曳）讓筆沿著刃文線
  var steer = {
    pad: "ud", cont: [4000, 3000], warm: 0,
    init: function (a) {
      a.terms = [];
      var nT = a.k(2, 3);
      for (var k = 0; k < nT; k++) a.terms.push({ amp: (a.k(22, 18) + a.rng() * 10) / (k + 1), f: (1.2 + a.rng() * 1.6) * (k + 1), ph: a.rng() * TAU });
      // 斜率上限 1：筆最快 140px/s，路線最快約 95px/s，追得上
      var maxS = 0;
      for (var x = 20; x <= 300; x += 2) maxS = Math.max(maxS, Math.abs(steer.path(a, x + 1) - steer.path(a, x)));
      if (maxS > 1) a.terms.forEach(function (tm) { tm.amp /= maxS; });
      a.y = steer.path(a, 20); a.aim = null; a.U = false; a.Dn = false;
      a.v = 280 / (a.dur / 1000);
    },
    path: function (a, x) { var y = 90; a.terms.forEach(function (tm) { y += tm.amp * Math.sin(tm.f * TAU * (x - 20) / 280 + tm.ph); }); return y; },
    penX: function (a) { return 20 + a.v * a.elapsed / 1000; },
    dir: function (a, k, down) { if (k === 0) a.U = down; if (k === 1) a.Dn = down; if (down) a.aim = null; },
    move: function (a, x, y) { a.aim = y; },
    frame: function (a, now, dt) {
      var sp = 140 * dt;
      if (a.aim !== null) a.y += clamp(a.aim - a.y, -sp, sp);
      else a.y += ((a.Dn ? 1 : 0) - (a.U ? 1 : 0)) * sp;
      a.y = clamp(a.y, 10, 170);
      var px = steer.penX(a), d = Math.abs(a.y - steer.path(a, px)), tol = a.k(14, 10);
      a.good += dt * 1000 * zone(d, tol);
      clear(a);
      blade(a, steelColor(a), 90);
      var g = a.g, ahead = a.k(400, 70);
      g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 3; g.beginPath();
      for (var x = 20; x <= Math.min(300, px + ahead); x += 3) { var yy = steer.path(a, x); if (x === 20) g.moveTo(x, yy); else g.lineTo(x, yy); }
      g.stroke();
      dot(a, px, a.y, 6, d < tol ? GOLD : RED);
    },
    auto: function (a, now, q) {
      if (q >= 1) { a.ui.move(0, steer.path(a, steer.penX(a) + a.v * 0.05)); return; }
      if (!a.plan || now - a.plan > 450) { a.plan = now; a.ui.move(0, steer.path(a, steer.penX(a)) + 16); }
    }
  };

  // ============================== 判讀類 ==============================

  // 回數打ち：看向こう鎚敲了幾下，再照同樣次數敲
  var count = {
    btn: "kt_tg_strike", coolRate: 0.4, gap: 500,
    trials: function (cfg) { return Math.max(3, Math.round(cfg.strikes / 3)); },
    trial: function (a, now) {
      a.i = a.scores.length;
      a.N = a.k(2, 3) + Math.floor(a.rng() * a.k(3, 4));
      a.flashes = [];
      var tt = now + 500;
      for (var j = 0; j < a.N; j++) { a.flashes.push(tt); tt += a.k(420, 260) + (a.hard ? (a.rng() - 0.5) * 160 : 0); }
      a.turnAt = a.flashes[a.N - 1] + 450;
      a.taps = 0; a.lastTap = 0;
    },
    frame: function (a, now) {
      clear(a);
      anvil(a, 130); bar(a, 115, 118, 90, 12, steelColor(a));
      if (!a.active) return;
      var hit = a.flashes.some(function (f) { return now >= f && now < f + 130; });
      bar(a, 140, hit ? 92 : 40, 40, 22, "#6c7178");
      if (hit) dot(a, 160, 116, 14, "rgba(255,226,140,0.8)");
      if (now >= a.turnAt) {
        text(a, a.t("kt_tg_your_turn"), 160, 24, 13, INK);
        if (now - a.lastTap < 120) dot(a, 160, 116, 10, "rgba(255,226,140,0.7)");
        var quiet = a.taps ? now - a.lastTap > 900 : now - a.turnAt > 3000;
        if (quiet) a.score(a.taps === a.N ? 1 : Math.abs(a.taps - a.N) === 1 ? 0.35 : 0, now);
      } else text(a, a.t("kt_count_watch"), 160, 24, 13, DIM);
    },
    press: function (a, now) { if (now < a.turnAt) return; a.taps++; a.lastTap = now; a.tap(now); },
    auto: function (a, now, q) {
      if (a.plan || now < a.turnAt) return;
      a.plan = 1;
      var n = a.N + (sloppy(a, q) ? 1 : 0);
      for (var j = 0; j < n; j++) a.later(100 + j * 170, function (tt) { a.ui.press(tt); });
    }
  };

  // 神経衰弱：開頭會亮牌一下，之後翻兩張配對；每翻一組算一擊
  var PAIR_SYM = ["鎚", "鏨", "鑢", "砥", "炭", "水", "鋼", "鍔"];
  var pairs = {
    coolRate: 0.35, gap: 150,
    trials: function () { return Infinity; },
    progress: function (a) { return a.t("kt_pairs_progress", { n: a.matched || 0, total: a.P || 0 }); },
    init: function (a, now) {
      a.P = a.k(4, 6);
      var cols = 4, rows = a.P * 2 / cols, deck = [];
      for (var j = 0; j < a.P; j++) deck.push(j, j);
      for (var k = deck.length - 1; k > 0; k--) { var r = Math.floor(a.rng() * (k + 1)), tmp = deck[k]; deck[k] = deck[r]; deck[r] = tmp; }
      a.cards = deck.map(function (s, k) { return { s: s, x: 30 + (k % cols) * 68, y: 10 + Math.floor(k / cols) * (160 / rows), w: 56, h: 160 / rows - 10, done: false }; });
      a.peekUntil = now + a.k(1800, 1000);
      a.matched = 0;
    },
    trial: function (a) { a.i = a.scores.length; a.sel = []; a.revealUntil = 0; },
    frame: function (a, now) {
      clear(a);
      var peek = now < a.peekUntil;
      a.cards.forEach(function (c, k) {
        var open = peek || c.done || a.sel.indexOf(k) >= 0;
        bar(a, c.x, c.y, c.w, c.h, c.done ? "#3d4a3a" : open ? "#d8cbb4" : "#5b4a3a");
        if (open) text(a, PAIR_SYM[c.s], c.x + c.w / 2, c.y + c.h / 2, 20, c.done ? DIM : "#2a221c");
      });
      if (a.active && a.sel.length === 2 && now >= a.revealUntil) {
        var c1 = a.cards[a.sel[0]], c2 = a.cards[a.sel[1]], ok = c1.s === c2.s;
        if (ok) { c1.done = c2.done = true; a.matched++; }
        a.tap(now);
        if (a.matched === a.P) a.n = a.scores.length + 1;
        a.score(ok ? 1 : 0.25, now);
      }
    },
    point: function (a, x, y, now) {
      if (now < a.peekUntil || a.sel.length >= 2) return;
      for (var k = 0; k < a.cards.length; k++) {
        var c = a.cards[k];
        if (!c.done && a.sel.indexOf(k) < 0 && x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
          a.sel.push(k);
          if (a.sel.length === 2) a.revealUntil = now + 450;
          return;
        }
      }
    },
    auto: function (a, now, q) {
      if (a.plan || now < a.peekUntil) return;
      a.plan = 1;
      var open = [];
      a.cards.forEach(function (c, k) { if (!c.done) open.push(k); });
      var k1 = open[0], k2 = open.filter(function (k) { return k !== k1 && a.cards[k].s === a.cards[k1].s; })[0];
      if (sloppy(a, q)) k2 = open.filter(function (k) { return k !== k1 && a.cards[k].s !== a.cards[k1].s; })[0] || k2;
      function at(k) { var c = a.cards[k]; return [c.x + c.w / 2, c.y + c.h / 2]; }
      a.later(120, function (tt) { var p = at(k1); a.ui.point(p[0], p[1], tt); });
      a.later(260, function (tt) { var p = at(k2); a.ui.point(p[0], p[1], tt); });
    }
  };

  // 見分け：六片鋼裡有一片的顏色不一樣，點出來
  var odd = {
    coolRate: 0.6,
    trial: function (a) {
      a.i = a.scores.length;
      a.odd = Math.floor(a.rng() * 6);
      a.L = 48 + a.rng() * 14;
      a.dL = a.k(14, 7) * (a.rng() < 0.5 ? -1 : 1);
      a.hue = 200 + a.rng() * 30;
      a.limit = a.k(3500, 2600);
      a.grain = a.rng() * 100;
    },
    rect: function (k) { return [24 + (k % 3) * 98, 22 + Math.floor(k / 3) * 74, 80, 60]; },
    frame: function (a, now) {
      clear(a);
      var g = a.g;
      for (var k = 0; k < 6; k++) {
        var r = odd.rect(k);
        bar(a, r[0], r[1], r[2], r[3], "hsl(" + a.hue.toFixed(0) + ",9%," + (a.L + (k === a.odd ? a.dL : 0)).toFixed(1) + "%)");
        g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 1;
        for (var j = 0; j < 5; j++) { var yy = r[1] + 8 + j * 11 + Math.sin(a.grain + j) * 3; g.beginPath(); g.moveTo(r[0] + 4, yy); g.lineTo(r[0] + r[2] - 4, yy + Math.cos(a.grain + j) * 4); g.stroke(); }
      }
      if (a.active) {
        var used = (now - a.t0) / a.limit;
        bar(a, 24, 170, 272 * clamp(1 - used, 0, 1), 4, GOLD);
        if (used >= 1) a.score(0, now);
      }
    },
    point: function (a, x, y, now) {
      for (var k = 0; k < 6; k++) {
        var r = odd.rect(k);
        if (x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]) { a.score(k === a.odd ? quick((now - a.t0) / a.limit, 0.6) : 0, now); return; }
      }
    },
    auto: function (a, now, q) {
      if (a.plan) return;
      a.plan = 1;
      var k = sloppy(a, q) ? (a.odd + 1) % 6 : a.odd, r = odd.rect(k);
      a.later(200, function (tt) { a.ui.point(r[0] + 40, r[1] + 30, tt); });
    }
  };

  // 疵探し：刀身上藏著一道細小的裂紋，找出來點掉；點錯會扣分
  var spot = {
    coolRate: 0.6,
    trial: function (a) {
      a.i = a.scores.length;
      a.fx = 50 + a.rng() * 220; a.fy = 80 + a.rng() * 20;
      a.fa = a.rng() * Math.PI; a.mis = 0;
      a.limit = a.k(4000, 3000);
      a.noise = [];
      for (var k = 0; k < 40; k++) a.noise.push([30 + a.rng() * 260, 80 + a.rng() * 20, a.rng() * Math.PI, 3 + a.rng() * 5]);
    },
    frame: function (a, now) {
      clear(a);
      blade(a, steelColor(a), 90);
      var g = a.g;
      g.lineWidth = 1;
      a.noise.forEach(function (n) { g.strokeStyle = "rgba(255,255,255,0.18)"; g.beginPath(); g.moveTo(n[0], n[1]); g.lineTo(n[0] + Math.cos(n[2]) * n[3], n[1] + Math.sin(n[2]) * n[3]); g.stroke(); });
      if (!a.active) return;
      var len = a.k(10, 7);
      g.strokeStyle = a.hard ? "rgba(30,24,20,0.55)" : "rgba(20,14,10,0.85)"; g.lineWidth = a.k(2, 1.5);
      g.beginPath(); g.moveTo(a.fx - Math.cos(a.fa) * len / 2, a.fy - Math.sin(a.fa) * len / 2); g.lineTo(a.fx + Math.cos(a.fa) * len / 2, a.fy + Math.sin(a.fa) * len / 2); g.stroke();
      var used = (now - a.t0) / a.limit;
      bar(a, 24, 170, 272 * clamp(1 - used, 0, 1), 4, GOLD);
      if (used >= 1) a.score(0, now);
    },
    point: function (a, x, y, now) {
      if (Math.abs(x - a.fx) < 16 && Math.abs(y - a.fy) < 16) a.score(r2(quick((now - a.t0) / a.limit, 0.6) * Math.pow(0.85, a.mis)), now);
      else { a.mis++; Games.shake(a.stage); }
    },
    auto: function (a, now, q) {
      if (a.plan) return;
      a.plan = 1;
      if (sloppy(a, q)) { a.later(200, function (tt) { a.ui.point(a.fx > 160 ? 60 : 260, 90, tt); }); a.later(1500, function (tt) { a.ui.point(a.fx, a.fy, tt); }); }
      else a.later(250, function (tt) { a.ui.point(a.fx, a.fy, tt); });
    }
  };

  // 熱見比べ：五根鋼條溫度不同，依題目點出最熱的／最冷的／和樣本同溫的
  var heatpick = {
    coolRate: 0.6,
    trial: function (a) {
      a.i = a.scores.length;
      var gapT = a.k(90, 45), ts = [];
      // 先平均分位置再加抖動（隨機重抽可能塞不下第五根而無限迴圈），最後打亂順序
      var span = 4 * gapT + a.rng() * (520 - 4 * gapT), lo = 720 + a.rng() * (560 - span);
      for (var j = 0; j < 5; j++) ts.push(Math.round(lo + span * j / 4 + (a.rng() - 0.5) * (span / 4 - gapT)));
      for (var m = 4; m > 0; m--) { var r = Math.floor(a.rng() * (m + 1)), tmp = ts[m]; ts[m] = ts[r]; ts[r] = tmp; }
      a.ts = ts;
      a.q = Math.floor(a.rng() * 3);
      var sorted = ts.slice().sort(function (x, y) { return x - y; });
      a.ans = a.q === 0 ? ts.indexOf(sorted[4]) : a.q === 1 ? ts.indexOf(sorted[0]) : Math.floor(a.rng() * 5);
      a.limit = a.k(3500, 2600);
    },
    frame: function (a, now) {
      clear(a);
      if (!a.active) return;
      text(a, a.t(["kt_heat_hot", "kt_heat_cold", "kt_heat_match"][a.q]), a.q === 2 ? 130 : 160, 18, 13, INK);
      if (a.q === 2) { bar(a, 226, 8, 50, 20, a.tempColor(a.ts[a.ans])); }
      for (var k = 0; k < 5; k++) bar(a, 22 + k * 58, 40, 46, 118, a.tempColor(a.ts[k]));
      var used = (now - a.t0) / a.limit;
      bar(a, 22, 168, 278 * clamp(1 - used, 0, 1), 4, GOLD);
      if (used >= 1) a.score(0, now);
    },
    point: function (a, x, y, now) {
      if (y < 36) return;
      var k = Math.floor((x - 22) / 58);
      if (k < 0 || k > 4 || x - 22 - k * 58 > 46) return;
      a.score(k === a.ans ? quick((now - a.t0) / a.limit, 0.6) : 0, now);
    },
    auto: function (a, now, q) {
      if (a.plan) return;
      a.plan = 1;
      var k = sloppy(a, q) ? (a.ans + 2) % 5 : a.ans;
      a.later(220, function (tt) { a.ui.point(45 + k * 58, 100, tt); });
    }
  };

  // 順打ち：鋼上散著幾個數字，照一、二、三…的順序點；每點一個算一擊
  var order = {
    coolRate: 0.5,
    trials: function (cfg, a) { return Math.max(2, Math.ceil(cfg.strikes / a.k(5, 7))); },
    trial: function (a) {
      a.i = a.scores.length;
      a.N = a.k(5, 7);
      a.pts = [];
      for (var tries = 0; a.pts.length < a.N; tries++) {
        var p = [30 + a.rng() * 260, 24 + a.rng() * 132];
        // 太擠時（極少見）放寬間距，避免無限迴圈
        var gapP = tries > 400 ? 18 : 34;
        if (a.pts.every(function (q) { return Math.abs(q[0] - p[0]) > gapP || Math.abs(q[1] - p[1]) > gapP; })) a.pts.push(p);
      }
      a.next = 0; a.err = 0;
      a.limit = a.N * a.k(900, 650);
    },
    frame: function (a, now) {
      clear(a);
      bar(a, 14, 12, 292, 156, steelColor(a));
      if (!a.active) return;
      a.pts.forEach(function (p, k) {
        dot(a, p[0], p[1], 15, k < a.next ? "rgba(31,27,24,0.35)" : "#2a221c");
        text(a, NUMS[k], p[0], p[1], 15, k < a.next ? DIM : INK);
      });
      var used = (now - a.t0) / a.limit;
      bar(a, 14, 172, 292 * clamp(1 - used, 0, 1), 4, GOLD);
      if (used >= 1) a.score(r2(a.next / a.N * 0.5), now);
    },
    point: function (a, x, y, now) {
      for (var k = a.next; k < a.N; k++) {
        var p = a.pts[k];
        if ((x - p[0]) * (x - p[0]) + (y - p[1]) * (y - p[1]) <= 17 * 17) {
          if (k !== a.next) { a.err++; Games.shake(a.stage); return; }
          a.next++; a.tap(now);
          if (a.next >= a.N) a.score(r2(Math.max(0, 1 - 0.15 * a.err) * quick((now - a.t0) / a.limit, 0.7)), now);
          return;
        }
      }
    },
    auto: function (a, now, q) {
      if (a.plan) return;
      a.plan = 1;
      var seq = [];
      for (var k = 0; k < a.N; k++) seq.push(k);
      if (sloppy(a, q)) seq.splice(1, 0, a.N - 1, a.N - 1);
      seq.forEach(function (k, j) { a.later(120 + j * 120, function (tt) { a.ui.point(a.pts[k][0], a.pts[k][1], tt); }); });
    }
  };

  // 型：一次顯示整串方向，限時內依序輸入；按錯就斷
  var combo = {
    pad: "all", padLabels: true, coolRate: 0.6,
    trial: function (a) {
      a.i = a.scores.length;
      a.K = a.k(3, 4) + (a.rng() < 0.4 ? 1 : 0);
      a.seq = [];
      for (var j = 0; j < a.K; j++) a.seq.push(Math.floor(a.rng() * 4));
      a.pos = 0;
      a.limit = a.k(2600, 2200) + a.K * a.k(250, 180);
    },
    frame: function (a, now) {
      clear(a);
      if (!a.active) return;
      var w = 56, x0 = 160 - a.K * w / 2;
      a.seq.forEach(function (d, j) {
        bar(a, x0 + j * w + 4, 50, w - 8, 64, j < a.pos ? "#3d4a3a" : j === a.pos ? "#5b4a3a" : "#2e2925");
        text(a, DIRS[d][1], x0 + j * w + w / 2, 76, 26, j < a.pos ? DIM : INK);
        var lbl = a.cfg.labels ? a.cfg.labels[DIRS[d][0]] : "";
        if (lbl) text(a, lbl, x0 + j * w + w / 2, 104, 11, DIM);
      });
      var used = (now - a.t0) / a.limit;
      bar(a, 20, 150, 280 * clamp(1 - used, 0, 1), 6, GOLD);
      if (used >= 1) a.score(r2(a.pos / a.K * 0.5), now);
    },
    dir: function (a, k, down, now) {
      if (!down || !a.active) return;
      if (k !== a.seq[a.pos]) { a.score(r2(a.pos / a.K * 0.5), now); return; }
      a.pos++;
      if (a.pos >= a.K) a.score(quick((now - a.t0) / a.limit, 0.7), now);
    },
    auto: function (a, now, q) {
      if (a.plan) return;
      a.plan = 1;
      a.seq.forEach(function (d, j) {
        var k = sloppy(a, q) && j === 1 ? (d + 1) % 4 : d;
        a.later(120 + j * 100, function (tt) { a.ui.dir(k, true, tt); a.ui.dir(k, false, tt); });
      });
    }
  };

  // 受け：鋼片從上方落下，用 ←／→（或拖曳）移動火箸接住
  var catchGame = {
    pad: "lr", coolRate: 1,
    init: function (a) { a.tx = 160; a.aim = 160; },
    trial: function (a) {
      a.i = a.scores.length;
      a.x0 = 30 + a.rng() * 260;
      a.sway = a.hard ? (a.rng() - 0.5) * 50 : 0;
      a.F = a.k(1500, 1000);
    },
    fx: function (a, f) { return clamp(a.x0 + a.sway * Math.sin(f * Math.PI), 16, 304); },
    dir: function (a, k, down) { if (k === 2) a.aim = down ? 0 : a.tx; if (k === 3) a.aim = down ? 320 : a.tx; },
    move: function (a, x) { a.aim = x; },
    frame: function (a, now, dt) {
      var sp = a.k(320, 380) * dt;
      a.tx = clamp(a.tx + clamp(a.aim - a.tx, -sp, sp), 16, 304);
      clear(a);
      bar(a, a.tx - 22, 156, 44, 8, "#8b8f8a"); bar(a, a.tx - 22, 146, 4, 12, "#8b8f8a"); bar(a, a.tx + 18, 146, 4, 12, "#8b8f8a");
      if (!a.active) return;
      var f = (now - a.t0) / a.F;
      var x = catchGame.fx(a, Math.min(1, f)), y = 10 + Math.min(1, f) * 140;
      bar(a, x - 10, y - 5, 20, 10, a.steelCss || a.tempColor(1100));
      if (f >= 1) a.score(zone(x - a.tx, a.k(22, 15)), now);
    },
    auto: function (a, now, q) { a.ui.move(catchGame.fx(a, 1) + (sloppy(a, q) ? 45 : 0), 0); }
  };

  // 持續類的計分開頭（warm）在 spec 上，框架用 a.warm0() 讀
  function withWarm(spec) {
    var init = spec.init;
    spec.init = function (a, now) { a.warm0 = function () { return spec.warm || 0; }; if (init) init(a, now); };
    return spec;
  }

  var SPECS = {
    pendulum: pendulum, color: color, align: align, sustain: sustain, reaction: reaction, lissa: lissa, slide: slide, beat: beat,
    bellows: withWarm(bellows), balance: withWarm(balance), pressure: withWarm(pressure), steer: withWarm(steer),
    count: count, pairs: pairs, odd: odd, spot: spot, heatpick: heatpick, order: order, combo: combo, "catch": catchGame
  };
  Object.keys(SPECS).forEach(function (k) { Games[k] = make(k, SPECS[k]); });
  Games.EXTRA = Object.keys(SPECS);
  Games.zone = zone;
})();
