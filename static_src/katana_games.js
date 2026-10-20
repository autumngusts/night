// 神前鍛刀對決：工序小遊戲 第二版（使用者指定 2026-10-20）
//   arc     圓弧判定：指針繞圈，每次在隨機位置出現判定格，指針進格時按下（造込み・素延べ）
//   music   音樂遊戲：音符從上方落下，落到判定線時按對應軌道；樂譜隨機生成（下鍛え・上鍛え＝向こう鎚的拍子；研ぎ＝砥石）
//   memory  記憶敲打：記住亮起的位置與順序，再依序敲回去（火造り＝敲打位置；銘切り＝鏨的順序）
//   shatter 碎裂：敲鋼餅上的弱點，每敲一下裂痕擴大，最後碎開散落（水へし・小割り；之後在 katana.js 逐片判讀分揀）
// 每個遊戲只交給 katana_core 一個成績（同舊版欄位）：{ acc: 0〜1, strikes, cold, reheats, … }，規則與數值計算不變。
// 難度依鍛刀模式：表演（show）短而寬鬆；較真（serious）長而嚴格。
//
// ctx（katana.js 的 mgCtx() 提供）：{ el, t, L, tempColor, result, mode, seed, run(kind, frame, onKey), stop(), done(result) }
//   frame(now, dt) 回傳 false 時停止迴圈。測試用：遊戲框的 DOM 節點上有 ktAuto(quality)，會依遊戲規則自動操作（不是直接寫成績）。
(function () {
  "use strict";

  var Core = window.PriTestKatanaCore;
  if (!Core) return;

  var DIFF = {
    show: { arcZone: 36, arcPerfect: 11, arcSpeed: 1.7, arcRamp: 0.06, notes: 10, bpm: 96, fallMs: 1700, win: [70, 120, 180],
      mem: [3, 4], memFlash: 520, memGap: 200, shatterTaps: 5, shatterLife: 1900, shatterR: 18 },
    serious: { arcZone: 22, arcPerfect: 7, arcSpeed: 2.3, arcRamp: 0.1, notes: 16, bpm: 116, fallMs: 1250, win: [50, 95, 150],
      mem: [4, 5, 6], memFlash: 400, memGap: 160, shatterTaps: 7, shatterLife: 1300, shatterR: 13 }
  };
  function diff(ctx) { return DIFF[ctx.mode === "serious" ? "serious" : "show"]; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function avg(a) { var s = 0; a.forEach(function (x) { s += x; }); return a.length ? s / a.length : 0; }
  var TAU = Math.PI * 2;

  // 判定文字（浮在畫面上，淡出）
  function popup(ctx, host, grade) {
    var n = ctx.el("div", { class: "kt-g-pop kt-g-" + grade, text: ctx.t("kt_g_" + grade) });
    host.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 650);
  }

  function shake(box) { box.classList.remove("kt-shake"); void box.offsetWidth; box.classList.add("kt-shake"); }

  // 鋼的溫度（敲打類共用）：起點 1250℃，coolMs 內冷到 600℃；800℃ 以下敲＝冷打（核心會依此判斷鍛え割れ等）
  function steelBar(ctx, cfg) {
    var node = ctx.el("div", { class: "kt-steel kt-steel-small" });
    var t0 = 0, reheats = 0, cold = 0;
    var api = {
      node: node,
      start: function (now) { t0 = now; },
      temp: function (now) { return 1250 - Math.max(0, Math.min(1, (now - t0) / cfg.coolMs)) * 650; },
      paint: function (now) { node.style.background = ctx.tempColor(api.temp(now), false); },
      strike: function (now) { if (api.temp(now) < 800) cold++; },
      reheat: function (now) { reheats++; t0 = now; },
      grow: function (f) { if (cfg.grow) node.style.width = (30 + 70 * Math.min(1, f)) + "%"; },
      done: function () { node.style.background = ctx.tempColor(900, false); api.grow(1); },
      stats: function () { return { cold: cold, reheats: reheats }; }
    };
    api.grow(0);
    return api;
  }

  // ======================= 圓弧判定 =======================
  // cfg：{ key, title, strikes, coolMs（有＝顯示鋼溫度與回爐）, grow }
  function arc(ctx, cfg) {
    var el = ctx.el, t = ctx.t, dv = diff(ctx), res = ctx.result;
    var box = el("div", { class: "kt-mg kt-arc", "data-live": res ? null : "1" });
    box.appendChild(el("div", { class: "kt-mg-title", text: cfg.title }));
    var st = cfg.coolMs ? steelBar(ctx, cfg) : null; // 溫度畫在中央的鋼上
    var cv = el("canvas", { class: "kt-arc-canvas", width: "320", height: "320" });
    var stage = el("div", { class: "kt-g-stage" }, [cv]);
    box.appendChild(stage);
    var info = el("div", { class: "kt-readout" });
    box.appendChild(info);
    var g = cv.getContext("2d");
    var ZONE = dv.arcZone * Math.PI / 360, PERF = dv.arcPerfect * Math.PI / 360;
    var ang = -Math.PI / 2, zone = null, hits = [], perfect = 0;

    function draw() {
      g.clearRect(0, 0, 320, 320);
      g.lineCap = "butt";
      g.lineWidth = 20;
      g.strokeStyle = "rgba(127,127,127,0.28)";
      g.beginPath(); g.arc(160, 160, 120, 0, TAU); g.stroke();
      if (zone) {
        g.strokeStyle = "#d9a441"; g.beginPath(); g.arc(160, 160, 120, zone - ZONE, zone + ZONE); g.stroke();
        g.strokeStyle = "#fff4d0"; g.beginPath(); g.arc(160, 160, 120, zone - PERF, zone + PERF); g.stroke();
      }
      // 已打的格數（外圈小點）
      for (var i = 0; i < cfg.strikes; i++) {
        var a = -Math.PI / 2 + TAU * i / cfg.strikes;
        g.fillStyle = i < hits.length ? (hits[i] >= 1 ? "#fff4d0" : hits[i] > 0 ? "#d9a441" : "#c0392b") : "rgba(127,127,127,0.35)";
        g.beginPath(); g.arc(160 + Math.cos(a) * 148, 160 + Math.sin(a) * 148, 4, 0, TAU); g.fill();
      }
      // 中央的鋼（素延べ：隨打擊延長）
      var bw = cfg.grow ? 60 + 110 * Math.min(1, hits.length / cfg.strikes) : 110;
      g.fillStyle = st ? st.node.style.background || "#555" : "#8d939a";
      g.fillRect(160 - bw / 2, 150, bw, 20);
      // 指針
      g.strokeStyle = "#e8764f"; g.lineWidth = 4; g.lineCap = "round";
      g.beginPath(); g.moveTo(160 + Math.cos(ang) * 40, 160 + Math.sin(ang) * 40); g.lineTo(160 + Math.cos(ang) * 134, 160 + Math.sin(ang) * 134); g.stroke();
      g.fillStyle = "#e8764f"; g.beginPath(); g.arc(160 + Math.cos(ang) * 134, 160 + Math.sin(ang) * 134, 7, 0, TAU); g.fill();
    }

    if (res) {
      if (st) st.done();
      hits = new Array(cfg.strikes).fill(1);
      draw();
      info.textContent = cfg.coolMs ? t("kt_hammer_done", { p: Math.round(res.acc * 100), c: res.cold, r: res.reheats }) : t("kt_arc_done", { p: Math.round(res.acc * 100) });
      return box;
    }
    var rng = Core.makeRng(ctx.seed + "|arc");
    var speed = dv.arcSpeed, running = false, autoQ = null;
    function rel() { var d = ang - zone; return ((d + Math.PI) % TAU + TAU) % TAU - Math.PI; } // 負＝還沒到
    function newZone() { zone = ang + (80 + rng() * 100) * Math.PI / 180; }
    function updateInfo() { info.textContent = t("kt_arc_progress", { n: hits.length, total: cfg.strikes }) + (st ? "・" + t("kt_g_cold", { c: st.stats().cold }) : ""); }
    function record(acc, grade, now) {
      hits.push(acc);
      if (acc >= 1) perfect++;
      if (st) { st.strike(now); st.grow(hits.length / cfg.strikes); }
      popup(ctx, stage, grade);
      if (grade !== "miss") shake(box);
      speed += dv.arcRamp;
      updateInfo();
      if (hits.length >= cfg.strikes) {
        var r = { acc: round2(avg(hits)), strikes: hits.length, perfect: perfect };
        if (st) { var s = st.stats(); r.cold = s.cold; r.reheats = s.reheats; }
        ctx.done(r);
        return;
      }
      newZone();
    }
    function press() {
      if (!running || !zone) return;
      var d = Math.abs(rel()), now = performance.now();
      if (d <= PERF) record(1, "perfect", now);
      else if (d <= ZONE) record(round2(1 - 0.4 * (d - PERF) / (ZONE - PERF)), "good", now);
      else record(0, "miss", now);
    }
    updateInfo();
    draw();
    var btnGo = el("button", { type: "button", class: "kt-primary", text: t("kt_hammer_start") });
    var btnHit = el("button", { type: "button", class: "kt-primary kt-hit", text: t("kt_hammer_hit"), disabled: true });
    var btnReheat = st ? el("button", { type: "button", text: t("kt_hammer_reheat"), disabled: true }) : null;
    function start() {
      if (running) return;
      running = true;
      btnGo.disabled = true; btnHit.disabled = false;
      if (btnReheat) btnReheat.disabled = false;
      newZone();
      if (st) st.start(performance.now());
      ctx.run("arc", function (now, dt) {
        ang += speed * dt;
        if (st) st.paint(now);
        if (st && autoQ !== null && autoQ >= 1 && st.temp(now) < 840) st.reheat(now);
        if (rel() > ZONE) { record(0, "miss", now); if (!running) return false; }
        if (autoQ !== null && Math.abs(rel()) <= (autoQ >= 1 ? PERF * 0.6 : ZONE * 0.9)) press();
        draw();
      }, function (ev) { if (ev.code === "Space" || ev.key === " ") { ev.preventDefault(); press(); } });
    }
    btnGo.addEventListener("click", start);
    btnHit.addEventListener("click", press);
    cv.addEventListener("pointerdown", function (ev) { ev.preventDefault(); if (running) press(); else start(); });
    if (btnReheat) btnReheat.addEventListener("click", function () { st.reheat(performance.now()); });
    box.appendChild(el("div", { class: "kt-muted", text: t("kt_arc_hint") }));
    box.appendChild(el("div", { class: "kt-actions" }, [btnGo, btnHit, btnReheat]));
    box.ktAuto = function (q) { autoQ = q === undefined ? 1 : q; start(); };
    return box;
  }

  // ======================= 音樂遊戲 =======================
  // cfg：{ key, title, lanes: [軌道名稱], segments?: [段落名稱（研ぎ的砥石）], coolMs?（有＝顯示鋼溫度；樂譜依此切成樂句，樂句之間回爐）, hammer? }
  var LANE_KEYS = { 3: ["f", "j", "k"], 4: ["d", "f", "j", "k"] };
  var LANE_COLORS = ["#e8764f", "#d9a441", "#5aa9e6", "#9b7fd4"];

  function makeChart(ctx, cfg) {
    var dv = diff(ctx), rng = Core.makeRng(ctx.seed + "|chart");
    var n = cfg.notes || dv.notes, lanes = cfg.lanes.length;
    var eighth = 60000 / dv.bpm / 2, tcur = dv.fallMs + 700, notes = [], last = [-1, -1], phrases = [tcur];
    // 有鋼的溫度時，一個樂句不超過冷卻時間的 55%：照節奏打的人不會打到冷掉的鋼（休止時回爐）
    var phraseMs = cfg.coolMs ? cfg.coolMs * 0.55 : Infinity;
    var gaps = ctx.mode === "serious" ? [1, 2, 2, 2, 3, 4] : [2, 2, 3, 4];
    for (var i = 0; i < n; i++) {
      if (i > 0 && tcur - phrases[phrases.length - 1] > phraseMs) { tcur += eighth * 6; phrases.push(tcur); }
      var lane;
      if (cfg.hammer && i % 3 === 0) lane = 0; // 橫座的小鎚先下，向こう鎚跟著打
      else {
        do { lane = cfg.hammer ? 1 + Math.floor(rng() * (lanes - 1)) : Math.floor(rng() * lanes); }
        while (lanes > 2 && lane === last[0] && lane === last[1]);
      }
      last = [lane, last[0]];
      notes.push({ t: tcur, lane: lane, seg: Math.floor(i * (cfg.segments ? cfg.segments.length : 1) / n), j: null });
      // 較真模式偶爾兩軌同時（算兩個音符）
      if (ctx.mode === "serious" && !cfg.hammer && i < n - 1 && rng() < 0.12) {
        var l2 = (lane + 1 + Math.floor(rng() * (lanes - 1))) % lanes;
        notes.push({ t: tcur, lane: l2, seg: notes[notes.length - 1].seg, j: null });
        i++;
      }
      tcur += eighth * gaps[Math.floor(rng() * gaps.length)];
    }
    return { notes: notes, end: tcur + 600, phrases: phrases };
  }

  function music(ctx, cfg) {
    var el = ctx.el, t = ctx.t, dv = diff(ctx), res = ctx.result;
    var lanes = cfg.lanes.length, keys = LANE_KEYS[lanes] || LANE_KEYS[4];
    var box = el("div", { class: "kt-mg kt-music", "data-live": res ? null : "1" });
    box.appendChild(el("div", { class: "kt-mg-title", text: cfg.title }));
    var st = cfg.coolMs ? steelBar(ctx, cfg) : null;
    if (st) box.appendChild(st.node);
    var segLabel = cfg.segments ? el("div", { class: "kt-music-seg" }) : null;
    if (segLabel) box.appendChild(segLabel);
    var W = lanes * 76, H = 340, LINE = 286;
    var cv = el("canvas", { class: "kt-music-canvas", width: String(W), height: String(H) });
    var stage = el("div", { class: "kt-g-stage" }, [cv]);
    box.appendChild(stage);
    var info = el("div", { class: "kt-readout" });
    box.appendChild(info);
    var g = cv.getContext("2d");
    var chart = makeChart(ctx, cfg), notes = chart.notes;
    var songT = -1, lit = [], counts = { perfect: 0, great: 0, good: 0, miss: 0 }, combo = 0;
    for (var li = 0; li < lanes; li++) lit.push(0);

    function draw() {
      g.clearRect(0, 0, W, H);
      for (var l = 0; l < lanes; l++) {
        g.fillStyle = l % 2 ? "rgba(127,127,127,0.10)" : "rgba(127,127,127,0.16)";
        g.fillRect(l * 76, 0, 76, H);
        if (lit[l] > 0) { g.fillStyle = "rgba(255,244,208," + (0.35 * lit[l]) + ")"; g.fillRect(l * 76, 0, 76, LINE + 10); }
      }
      g.fillStyle = "#d9a441"; g.fillRect(0, LINE - 2, W, 4);
      notes.forEach(function (n) {
        if (n.j) return;
        var y = LINE - (n.t - songT) / dv.fallMs * (LINE + 20);
        if (y < -20 || y > H + 20) return;
        g.fillStyle = LANE_COLORS[n.lane % LANE_COLORS.length];
        g.beginPath();
        var x = n.lane * 76 + 8, w = 60, h = 16, r = 8;
        g.moveTo(x + r, y - h / 2); g.arcTo(x + w, y - h / 2, x + w, y + h / 2, r); g.arcTo(x + w, y + h / 2, x, y + h / 2, r);
        g.arcTo(x, y + h / 2, x, y - h / 2, r); g.arcTo(x, y - h / 2, x + w, y - h / 2, r); g.fill();
      });
      g.font = "bold 13px sans-serif"; g.textAlign = "center";
      for (var k = 0; k < lanes; k++) {
        g.fillStyle = "rgba(127,127,127,0.9)";
        g.fillText(cfg.lanes[k], k * 76 + 38, LINE + 26);
        g.fillText("[" + keys[k].toUpperCase() + "]", k * 76 + 38, LINE + 44);
      }
    }
    function resultText(r) { return t("kt_music_done", { p: Math.round(r.acc * 100), a: r.perfect, b: r.great, c: r.good, d: r.miss }); }
    if (res) {
      if (st) st.done();
      notes.forEach(function (n) { n.j = "done"; });
      draw();
      info.textContent = resultText(res);
      return box;
    }
    var running = false, autoQ = null, t0 = 0, phrase = 0, autoN = 0;
    function updateInfo() {
      var judged = notes.filter(function (n) { return n.j; }).length;
      info.textContent = t("kt_music_progress", { n: judged, total: notes.length, combo: combo });
      if (segLabel) {
        var next = notes.filter(function (n) { return !n.j; })[0];
        segLabel.textContent = t("kt_music_seg", { name: cfg.segments[next ? next.seg : cfg.segments.length - 1] });
      }
    }
    function judge(n, grade, now) {
      n.j = grade;
      counts[grade]++;
      combo = grade === "miss" ? 0 : combo + 1;
      if (st && grade !== "miss") st.strike(now);
      popup(ctx, stage, grade);
      updateInfo();
    }
    function press(lane) {
      if (!running) return;
      var now = performance.now(), best = null;
      lit[lane] = 1;
      notes.forEach(function (n) {
        if (n.j || n.lane !== lane) return;
        var d = Math.abs(n.t - songT);
        if (d <= dv.win[2] && (!best || d < Math.abs(best.t - songT))) best = n;
      });
      if (!best) return;
      var d = Math.abs(best.t - songT);
      judge(best, d <= dv.win[0] ? "perfect" : d <= dv.win[1] ? "great" : "good", now);
    }
    function finish() {
      var w = counts.perfect + counts.great * 0.8 + counts.good * 0.5;
      var r = { acc: round2(w / notes.length), strikes: notes.length, perfect: counts.perfect, great: counts.great, good: counts.good, miss: counts.miss };
      if (st) { var s = st.stats(); r.cold = s.cold; r.reheats = s.reheats; }
      ctx.done(r);
    }
    updateInfo();
    draw();
    var btnGo = el("button", { type: "button", class: "kt-primary", text: t("kt_music_start") });
    var pads = el("div", { class: "kt-music-pads" });
    cfg.lanes.forEach(function (name, l) {
      var b = el("button", { type: "button", class: "kt-music-pad", text: name });
      b.addEventListener("pointerdown", function (ev) { ev.preventDefault(); press(l); });
      pads.appendChild(b);
    });
    pads.style.width = W + "px";
    function start() {
      if (running) return;
      running = true;
      btnGo.disabled = true;
      t0 = performance.now();
      if (st) st.start(t0 + chart.phrases[0] - 250); // 鋼在第一個音前一刻才從火床取出
      phrase = 1;
      ctx.run("music", function (now, dt) {
        songT = now - t0;
        // 樂句之間的休止：鋼回爐，下一句的第一個音前一刻取出
        if (st && phrase < chart.phrases.length && songT >= chart.phrases[phrase] - 250) { phrase++; st.reheat(now); }
        if (st) st.paint(now);
        notes.forEach(function (n) { if (!n.j && songT - n.t > dv.win[2]) judge(n, "miss", now); });
        if (autoQ !== null) notes.forEach(function (n) {
          if (!n.j && Math.abs(n.t - songT) <= 12) { autoN++; if (autoQ >= 1 || autoN % 3) press(n.lane); }
        });
        for (var l = 0; l < lanes; l++) lit[l] = Math.max(0, lit[l] - dt * 5);
        draw();
        if (songT > chart.end && notes.every(function (n) { return n.j; })) { finish(); return false; }
      }, function (ev) {
        var k = keys.indexOf(String(ev.key).toLowerCase());
        if (k >= 0) { ev.preventDefault(); if (!ev.repeat) press(k); }
      });
    }
    btnGo.addEventListener("click", start);
    cv.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      if (!running) { start(); return; }
      var r = cv.getBoundingClientRect();
      press(Math.max(0, Math.min(lanes - 1, Math.floor((ev.clientX - r.left) / r.width * lanes))));
    });
    box.appendChild(pads);
    box.appendChild(el("div", { class: "kt-muted", text: t("kt_music_hint", { keys: keys.join(" ").toUpperCase() }) }));
    box.appendChild(el("div", { class: "kt-actions" }, [btnGo]));
    box.ktAuto = function (q) { autoQ = q === undefined ? 1 : q; start(); };
    return box;
  }

  // ======================= 記憶敲打 =======================
  // cfg：{ key, title, points: [{ x, y, label? }]（0〜1）, backdrop: "bar" | "plate", text?（銘）, rounds?, coolMs? }
  function memory(ctx, cfg) {
    var el = ctx.el, t = ctx.t, dv = diff(ctx), res = ctx.result;
    var box = el("div", { class: "kt-mg kt-memory", "data-live": res ? null : "1" });
    box.appendChild(el("div", { class: "kt-mg-title", text: cfg.title }));
    var st = cfg.coolMs ? steelBar(ctx, cfg) : null;
    var stage = el("div", { class: "kt-g-stage kt-mem-stage kt-mem-" + cfg.backdrop });
    var back = el("div", { class: "kt-mem-back" });
    stage.appendChild(back);
    if (cfg.backdrop === "plate") {
      Array.from(cfg.text || "").forEach(function (ch, i, arr) {
        var c = el("span", { class: "kt-mem-char", text: ch });
        c.style.top = (10 + 80 * (i + 0.5) / arr.length) + "%";
        back.appendChild(c);
      });
    }
    var pts = cfg.points.map(function (p, i) {
      var b = el("button", { type: "button", class: "kt-mem-pt", disabled: true, "aria-label": String(i + 1) });
      b.style.left = (p.x * 100) + "%"; b.style.top = (p.y * 100) + "%";
      stage.appendChild(b);
      return b;
    });
    box.appendChild(stage);
    var info = el("div", { class: "kt-readout" });
    box.appendChild(info);
    if (res) {
      back.style.background = st ? ctx.tempColor(900, false) : "";
      info.textContent = t("kt_mem_done", { p: Math.round(res.acc * 100) });
      return box;
    }
    var rng = Core.makeRng(ctx.seed + "|mem");
    var rounds = cfg.rounds || dv.mem;
    var seqs = rounds.map(function (len) {
      var s = [];
      while (s.length < len) { var k = Math.floor(rng() * pts.length); if (k !== s[s.length - 1]) s.push(k); }
      return s;
    });
    var total = 0;
    rounds.forEach(function (n) { total += n; });
    var r = 0, pos = 0, phase = "idle", phaseT = 0, correct = 0, taps = 0, autoQ = null, autoNext = 0, running = false;
    function flash(i, cls) {
      var b = pts[i];
      b.classList.remove("kt-mem-show", "kt-mem-ok", "kt-mem-ng");
      void b.offsetWidth;
      b.classList.add(cls);
    }
    var heated = false;
    function setPhase(p, now) {
      phase = p; phaseT = now;
      // 看順序時鋼在火床裡；輪到你敲才取出開始冷卻（第二輪起算一次回爐）
      if (p === "input" && st) { if (heated) st.reheat(now); else { st.start(now); heated = true; } }
      pts.forEach(function (b) { b.disabled = p !== "input"; });
      info.textContent = p === "watch" ? t("kt_mem_watch", { r: r + 1, total: rounds.length }) :
        p === "input" ? t("kt_mem_your", { n: seqs[r].length - pos }) : info.textContent;
      stage.classList.toggle("kt-mem-input", p === "input");
    }
    function nextRound(now) {
      r++; pos = 0;
      if (r >= rounds.length) {
        var out = { acc: round2(correct / total), strikes: taps };
        if (st) { var s = st.stats(); out.cold = s.cold; out.reheats = s.reheats; }
        ctx.done(out);
        return;
      }
      setPhase("pause", now);
    }
    function tap(i) {
      if (phase !== "input") return;
      var now = performance.now();
      taps++;
      if (st) st.strike(now);
      if (i === seqs[r][pos]) {
        correct++; pos++;
        flash(i, "kt-mem-ok");
        if (pos >= seqs[r].length) nextRound(now);
        else info.textContent = t("kt_mem_your", { n: seqs[r].length - pos });
      } else {
        flash(i, "kt-mem-ng");
        shake(box);
        taps += seqs[r].length - pos - 1; // 剩下的都算錯
        nextRound(now);
      }
    }
    pts.forEach(function (b, i) { b.addEventListener("click", function () { tap(i); }); });
    info.textContent = t("kt_mem_intro", { rounds: rounds.length });
    var btnGo = el("button", { type: "button", class: "kt-primary", text: t("kt_mem_start") });
    function start() {
      if (running) return;
      running = true;
      btnGo.disabled = true;
      var now0 = performance.now();
      if (st) st.start(now0 + 1e9); // 還在火床裡（溫度維持 1250℃）
      setPhase("watch", now0);
      var step = dv.memFlash + dv.memGap, shown = -1;
      ctx.run("memory", function (now) {
        if (st) { st.paint(now); back.style.background = st.node.style.background; }
        var el2 = now - phaseT;
        if (phase === "pause" && el2 > 700) setPhase("watch", now);
        else if (phase === "watch") {
          var k = Math.floor(el2 / step);
          if (k !== shown && k < seqs[r].length) { shown = k; flash(seqs[r][k], "kt-mem-show"); }
          if (k >= seqs[r].length) { shown = -1; setPhase("input", now); }
        } else if (phase === "input" && autoQ !== null && now > autoNext) {
          autoNext = now + 180;
          var want = seqs[r][pos];
          tap(autoQ >= 1 || (taps % 4) ? want : (want + 1) % pts.length);
        }
        if (r >= rounds.length) return false;
      });
    }
    btnGo.addEventListener("click", start);
    box.appendChild(el("div", { class: "kt-actions" }, [btnGo]));
    box.ktAuto = function (q) { autoQ = q === undefined ? 1 : q; start(); };
    return box;
  }

  // 火造り的敲打位置：刀身由元到切先，刃側・棟側交錯
  function bladePoints() {
    var out = [];
    for (var i = 0; i < 8; i++) out.push({ x: 0.1 + 0.8 * i / 7, y: i % 2 ? 0.66 : 0.34 });
    return out;
  }

  // 銘切り的鏨位：每個字左右兩點（無銘時只有鑢目與目釘穴 4 點）
  function plateText(text) { return Array.from(String(text || "")).slice(0, 8); }
  function platePoints(text) {
    var chars = plateText(text), out = [];
    if (!chars.length) return [{ x: 0.42, y: 0.25 }, { x: 0.58, y: 0.45 }, { x: 0.42, y: 0.65 }, { x: 0.58, y: 0.85 }];
    chars.forEach(function (c, i) {
      var y = 0.1 + 0.8 * (i + 0.5) / chars.length;
      out.push({ x: 0.36, y: y }); out.push({ x: 0.64, y: y });
    });
    return out;
  }

  // ======================= 碎裂（水へし・小割り） =======================
  // cfg：{ key, title, pieces }；結果 { acc, layout: [[x, y, rot]...] }（碎片散落位置，0〜1；分揀畫面照這個擺）
  function cakeShape(rng) {
    var pts = [];
    for (var i = 0; i < 20; i++) {
      var a = TAU * i / 20, k = 0.86 + rng() * 0.14;
      pts.push([160 + Math.cos(a) * 118 * k, 110 + Math.sin(a) * 78 * k]);
    }
    return pts;
  }
  function insideCake(x, y) { var dx = (x - 160) / 112, dy = (y - 110) / 72; return dx * dx + dy * dy < 1; }
  // 多邊形以半平面 (p−m)·n ≤ 0 裁切（Sutherland–Hodgman）
  function clipHalf(poly, mx, my, nx, ny) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var da = (a[0] - mx) * nx + (a[1] - my) * ny, db = (b[0] - mx) * nx + (b[1] - my) * ny;
      if (da <= 0) out.push(a);
      if ((da <= 0) !== (db <= 0)) { var tt = da / (da - db); out.push([a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt]); }
    }
    return out;
  }
  function shards(cake, seeds) {
    return seeds.map(function (s, i) {
      var poly = cake.slice();
      seeds.forEach(function (o, j) {
        if (i === j || poly.length < 3) return;
        poly = clipHalf(poly, (s[0] + o[0]) / 2, (s[1] + o[1]) / 2, o[0] - s[0], o[1] - s[1]);
      });
      return poly;
    });
  }
  // 碎片最後散落的位置（分揀畫面也用）
  function scatterLayout(seed, n) {
    var rng = Core.makeRng(seed + "|scatter"), out = [];
    var cols = Math.ceil(Math.sqrt(n * 1.6)), rows = Math.ceil(n / cols);
    for (var i = 0; i < n; i++) {
      var c = i % cols, r = Math.floor(i / cols);
      out.push([round2((c + 0.5 + (rng() - 0.5) * 0.5) / cols), round2((r + 0.5 + (rng() - 0.5) * 0.4) / rows), Math.round((rng() - 0.5) * 50)]);
    }
    return out;
  }

  function shatter(ctx, cfg) {
    var el = ctx.el, t = ctx.t, dv = diff(ctx), res = ctx.result;
    var NS = "http://www.w3.org/2000/svg";
    function sv(tag, attrs) { var n = document.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; }
    var box = el("div", { class: "kt-mg kt-shatter", "data-live": res ? null : "1" });
    box.appendChild(el("div", { class: "kt-mg-title", text: cfg.title }));
    var svg = sv("svg", { viewBox: "0 0 320 220", class: "kt-shatter-svg" });
    var stage = el("div", { class: "kt-g-stage" }, [svg]);
    box.appendChild(stage);
    var info = el("div", { class: "kt-readout" });
    box.appendChild(info);
    var rng = Core.makeRng(ctx.seed + "|shatter");
    var cake = cakeShape(rng);
    function polyStr(p) { return p.map(function (q) { return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" "); }
    var cakeEl = sv("polygon", { points: polyStr(cake), class: "kt-cake" });
    var cracks = sv("g", { class: "kt-cracks" });
    svg.appendChild(cakeEl); svg.appendChild(cracks);
    if (res) {
      cakeEl.setAttribute("class", "kt-cake kt-cake-cold");
      info.textContent = t("kt_shatter_done", { n: cfg.pieces, p: Math.round(res.acc * 100) });
      return box;
    }
    var taps = [], marker = null, mEl = sv("circle", { class: "kt-weak", r: dv.shatterR }), mRing = sv("circle", { class: "kt-weak-ring", r: dv.shatterR });
    var running = false, autoQ = null, autoNext = 0, broken = false;
    function newMarker(now) {
      var x, y;
      do { x = 60 + rng() * 200; y = 50 + rng() * 120; } while (!insideCake(x, y));
      marker = { x: x, y: y, born: now };
      [mEl, mRing].forEach(function (c) { c.setAttribute("cx", x.toFixed(1)); c.setAttribute("cy", y.toFixed(1)); });
    }
    function heatColor() {
      // 每敲一下鋼餅冷一點（橘紅 → 灰）
      var k = Math.min(1, taps.length / dv.shatterTaps);
      var a = [232, 118, 58], b = [110, 112, 116];
      return "rgb(" + a.map(function (v, i) { return Math.round(v + (b[i] - v) * k); }).join(",") + ")";
    }
    function addCrack(x, y) {
      var n = 2 + Math.floor(rng() * 2), len = 26 + taps.length * 12;
      for (var i = 0; i < n; i++) {
        var a = rng() * TAU, pts = [[x, y]], px = x, py = y;
        for (var k = 0; k < 5; k++) {
          a += (rng() - 0.5) * 0.9;
          px += Math.cos(a) * len / 5; py += Math.sin(a) * len / 5;
          pts.push([px, py]);
        }
        cracks.appendChild(sv("polyline", { points: polyStr(pts), class: "kt-crack" }));
      }
    }
    function updateInfo() { info.textContent = t("kt_shatter_progress", { n: taps.length, total: dv.shatterTaps }); }
    function hitAt(x, y, now) {
      if (!running || broken || !marker) return;
      var life = Math.max(0.35, 1 - (now - marker.born) / dv.shatterLife);
      var d = Math.hypot(x - marker.x, y - marker.y), r = dv.shatterR * life;
      var acc = d <= r * 0.45 ? 1 : Math.max(0, 1 - (d - r * 0.45) / (r * 2.2));
      taps.push(round2(acc));
      popup(ctx, stage, acc >= 1 ? "perfect" : acc >= 0.5 ? "good" : "miss");
      shake(box);
      addCrack(x, y);
      cakeEl.style.fill = heatColor();
      updateInfo();
      if (taps.length >= dv.shatterTaps) breakApart(now);
      else newMarker(now);
    }
    function breakApart() {
      broken = true;
      [mEl, mRing].forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
      var seeds = [];
      while (seeds.length < cfg.pieces) { var x = 50 + rng() * 220, y = 40 + rng() * 140; if (insideCake(x, y)) seeds.push([x, y]); }
      var polys = shards(cake, seeds);
      cakeEl.style.opacity = "0";
      cracks.style.opacity = "0";
      var layout = scatterLayout(ctx.seed, cfg.pieces);
      polys.forEach(function (p, i) {
        if (p.length < 3) return;
        var cx = 0, cy = 0;
        p.forEach(function (q) { cx += q[0]; cy += q[1]; });
        cx /= p.length; cy /= p.length;
        var sh = sv("polygon", { points: polyStr(p), class: "kt-shard" });
        sh.style.fill = heatColor();
        sh.style.transformOrigin = cx.toFixed(1) + "px " + cy.toFixed(1) + "px";
        svg.appendChild(sh);
        var tx = layout[i][0] * 320 - cx, ty = layout[i][1] * 220 - cy;
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          sh.style.transform = "translate(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px) rotate(" + layout[i][2] + "deg) scale(0.62)";
        }); });
      });
      info.textContent = t("kt_shatter_break");
      var acc = round2(avg(taps));
      setTimeout(function () { ctx.done({ acc: acc, strikes: taps.length, layout: layout }); }, 950);
    }
    svg.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      if (!running) { start(); return; }
      var r = svg.getBoundingClientRect();
      hitAt((ev.clientX - r.left) / r.width * 320, (ev.clientY - r.top) / r.height * 220, performance.now());
    });
    updateInfo();
    var btnGo = el("button", { type: "button", class: "kt-primary", text: t("kt_shatter_start") });
    function start() {
      if (running) return;
      running = true;
      btnGo.disabled = true;
      svg.appendChild(mRing); svg.appendChild(mEl);
      newMarker(performance.now());
      ctx.run("shatter", function (now) {
        if (broken) return false;
        var life = 1 - (now - marker.born) / dv.shatterLife;
        if (life <= 0) newMarker(now); // 沒敲到：弱點移到別處
        else {
          mEl.setAttribute("r", (dv.shatterR * Math.max(0.35, life)).toFixed(1));
          mRing.setAttribute("r", (dv.shatterR * (1 + (1 - life) * 0.8)).toFixed(1));
        }
        if (autoQ !== null && now > autoNext) {
          autoNext = now + 220;
          var off = autoQ >= 1 ? 0 : dv.shatterR * 1.2;
          hitAt(marker.x + off, marker.y, now);
        }
      });
    }
    btnGo.addEventListener("click", start);
    box.appendChild(el("div", { class: "kt-muted", text: t("kt_shatter_hint", { n: dv.shatterTaps }) }));
    box.appendChild(el("div", { class: "kt-actions" }, [btnGo]));
    box.ktAuto = function (q) { autoQ = q === undefined ? 1 : q; start(); };
    return box;
  }

  window.PriTestKatanaGames = {
    DIFF: DIFF, arc: arc, music: music, memory: memory, shatter: shatter,
    makeChart: makeChart, bladePoints: bladePoints, platePoints: platePoints, plateText: plateText, scatterLayout: scatterLayout, shards: shards
  };
})();
