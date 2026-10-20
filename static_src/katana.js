// 神前鍛刀對決（katana）UI。規則全部在 katana_core.js，資料在 katana_data.js；這裡只負責畫面、小遊戲與存讀檔。
// 小遊戲（加熱火色、鎚擊時機、試斬刃筋）只在畫面上執行，結果以數值交給 Core.applyStep / Core.applyCut。
//   小遊戲進行中不呼叫 render()（會重建 DOM 中斷動畫）；結束時才寫入 ui.mg 再 render()。
//   ui（草稿、小遊戲結果）刻意不存檔：重新整理後該工序要重做小遊戲，已完成的工序不受影響。
// 同一裝置輪流：每道工序全員輪一次（Core.currentForger），換人時先顯示「請交給 ○○」。
(function () {
  "use strict";

  var Core = window.PriTestKatanaCore;
  var D = window.PriTestKatanaData;
  var STORAGE_KEY = "pritest-katana-state";
  var app = document.getElementById("kt-app");
  if (!app || !Core || !D) return;

  var state = null;
  var setup = { names: ["", ""], assist: true, mode: "show" };
  var ui = { draft: {}, mg: {}, handoff: -1, result: null, confirmNew: false, error: "", cutResult: null, npc: null };
  var anim = null;

  function t(key, params) { return window.I18N.t(key, params); }
  function lang() { return window.I18N.getLang(); }
  // 遊戲資料只有 zh / ja；en 依專案慣例 fallback 至 ja
  function L(obj) { return obj ? (lang() === "zh" ? obj.zh : obj.ja) : ""; }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") node.textContent = v;
      else if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function save() {
    try {
      if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* 私密模式等：只是記不住 */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return s && s.v === 3 && s.players ? s : null; // v3：加入模式與各工序小遊戲；舊版存檔不相容
    } catch (e) { return null; }
  }

  function stopAnim() {
    if (anim) {
      if (anim.id) cancelAnimationFrame(anim.id);
      if (anim.onKey) document.removeEventListener("keydown", anim.onKey);
      anim = null;
    }
  }

  // ---------------- 火色 ----------------

  var COLOR_STOPS = [[400, [26, 26, 26]], [550, [58, 10, 5]], [650, [110, 14, 8]], [750, [168, 24, 14]], [820, [212, 42, 18]],
    [900, [234, 90, 20]], [1000, [245, 138, 31]], [1100, [255, 180, 58]], [1200, [255, 216, 106]], [1300, [255, 240, 168]],
    [1400, [255, 251, 230]], [1500, [255, 255, 255]]];

  // daylight：明亮處看火色會被環境光沖淡（焼き入れ要在暗處的理由）
  function tempColor(T, daylight) {
    var c = COLOR_STOPS[0][1];
    for (var i = 1; i < COLOR_STOPS.length; i++) {
      var a = COLOR_STOPS[i - 1], b = COLOR_STOPS[i];
      if (T <= b[0]) {
        var f = Math.max(0, (T - a[0]) / (b[0] - a[0]));
        c = [0, 1, 2].map(function (k) { return a[1][k] + (b[1][k] - a[1][k]) * f; });
        break;
      }
      c = b[1];
    }
    if (daylight) {
      var wash = T < 900 ? 0.68 : Math.max(0.15, 0.68 - (T - 900) / 400 * 0.53);
      var amb = [205, 200, 192];
      c = [0, 1, 2].map(function (k) { return c[k] * (1 - wash) + amb[k] * wash; });
    }
    return "rgb(" + c.map(function (v) { return Math.round(v); }).join(",") + ")";
  }

  // ---------------- 小遊戲：加熱（＋淬火時的入水） ----------------
  // cfg：{ key, win: Core.heatWindow 結果, daylight, title, plunge }
  // plunge：取出後還要按「入水」，取出到入水的毫秒數存成 delay（核心以空冷 25℃/秒 換算）
  function heatGame(cfg) {
    var res = ui.mg[cfg.key];
    var box = el("div", { class: "kt-mg kt-heat" + (cfg.daylight ? " kt-daylight" : "") });
    var steel = el("div", { class: "kt-steel" });
    var sparks = el("div", { class: "kt-sparks" });
    var stage = el("div", { class: "kt-forge" }, [steel, sparks]);
    var gauge = el("div", { class: "kt-gauge" });
    var readout = el("div", { class: "kt-readout" });
    box.appendChild(el("div", { class: "kt-mg-title", text: cfg.title }));
    box.appendChild(stage);
    var range = cfg.win.max - cfg.win.min;
    if (state.assist) {
      var band = el("div", { class: "kt-gauge-band" });
      band.style.left = ((cfg.win.lo - cfg.win.min) / range * 100) + "%";
      band.style.width = ((cfg.win.hi - cfg.win.lo) / range * 100) + "%";
      gauge.appendChild(band);
      gauge.appendChild(el("div", { class: "kt-gauge-needle" }));
      box.appendChild(gauge);
    }
    box.appendChild(readout);

    function paint(T) {
      steel.style.background = tempColor(T, cfg.daylight);
      steel.style.boxShadow = T > 900 ? "0 0 " + Math.round((T - 900) / 18) + "px " + tempColor(T, false) : "none";
      sparks.className = "kt-sparks" + (T >= 1400 ? " kt-sparks-wild" : (T >= 1250 ? " kt-sparks-on" : ""));
      if (state.assist) {
        gauge.lastChild.style.left = (Math.min(1, Math.max(0, (T - cfg.win.min) / range)) * 100) + "%";
        readout.textContent = t("kt_heat_temp", { t: Math.round(T) });
      }
    }

    if (res && (!cfg.plunge || res.delay !== undefined)) {
      paint(res.temp);
      stage.classList.add(cfg.plunge ? "kt-quenched" : "kt-pulled");
      var txt = state.assist ? t("kt_heat_done_assist", { t: Math.round(res.temp) }) : t("kt_heat_done");
      if (cfg.plunge) txt += " " + t("kt_plunge_done", { s: (res.delay / 1000).toFixed(1) });
      readout.textContent = txt;
      return box;
    }
    var btnStart = el("button", { type: "button", class: "kt-primary", text: t("kt_heat_start") });
    var btnPull = el("button", { type: "button", class: "kt-primary", text: t("kt_heat_pull"), disabled: true });
    var btnPlunge = cfg.plunge ? el("button", { type: "button", class: "kt-primary kt-plunge", text: t("kt_plunge"), disabled: true }) : null;
    paint(cfg.win.min);
    if (!state.assist) readout.textContent = t("kt_heat_hint");
    var T = cfg.win.min;
    function startPlunge(temp) {
      // 已取出：鋼在空氣中冷卻，等玩家按「入水」
      btnStart.disabled = true; btnPull.disabled = true; btnPlunge.disabled = false;
      readout.textContent = t("kt_plunge_hint");
      var t0 = performance.now();
      anim = { kind: "plunge" };
      function frame(now) {
        paint(temp - Core.AIR_COOL_RATE * (now - t0) / 1000);
        anim.id = requestAnimationFrame(frame);
      }
      anim.finish = function () {
        var delay = Math.round(performance.now() - t0);
        stopAnim();
        ui.mg[cfg.key] = { temp: Math.round(temp), delay: delay };
        render();
      };
      anim.id = requestAnimationFrame(frame);
    }
    btnStart.addEventListener("click", function () {
      stopAnim();
      btnStart.disabled = true; btnPull.disabled = false;
      var rng = Core.makeRng(state.seed + "|heat|" + cfg.key + "|" + Date.now());
      var dur = 6500 + rng() * 3500;
      var t0 = performance.now();
      anim = { kind: "heat" };
      function frame(now) {
        var p = Math.min(1.12, (now - t0) / dur);
        T = cfg.win.min + range * Math.pow(p, 0.85);
        paint(T);
        if (T >= cfg.win.max) { finish(cfg.win.max); return; }
        anim.id = requestAnimationFrame(frame);
      }
      function finish(temp) {
        stopAnim();
        if (cfg.plunge) { startPlunge(temp); return; }
        ui.mg[cfg.key] = { temp: Math.round(temp) };
        render();
      }
      anim.finish = function () { finish(T); };
      anim.id = requestAnimationFrame(frame);
    });
    btnPull.addEventListener("click", function () { if (anim && anim.finish) anim.finish(); });
    if (btnPlunge) btnPlunge.addEventListener("click", function () { if (anim && anim.finish) anim.finish(); });
    box.appendChild(el("div", { class: "kt-actions" }, [btnStart, btnPull, btnPlunge]));
    return box;
  }

  // ---------------- 小遊戲：鎚擊／刃筋／鏨 ----------------
  // cfg：{ key, strikes, speed, zone, coolMs, title, swing（試斬）, chisel（不顯示鋼的溫度）, grow（素延：鋼條隨打擊延長） }
  function hammerGame(cfg) {
    var res = ui.mg[cfg.key];
    var noSteel = cfg.swing || cfg.chisel;
    var box = el("div", { class: "kt-mg kt-hammer" });
    box.appendChild(el("div", { class: "kt-mg-title", text: cfg.title }));
    var track = el("div", { class: "kt-track" });
    var zone = el("div", { class: "kt-zone" });
    zone.style.left = ((0.5 - cfg.zone) * 100) + "%";
    zone.style.width = (cfg.zone * 200) + "%";
    var marker = el("div", { class: "kt-marker" });
    track.appendChild(zone); track.appendChild(marker);
    var steel = noSteel ? null : el("div", { class: "kt-steel kt-steel-small" });
    var info = el("div", { class: "kt-readout" });
    if (steel) box.appendChild(steel);
    if (cfg.chisel) box.appendChild(el("div", { class: "kt-mei-plate", text: cfg.text || "" }));
    box.appendChild(track);
    box.appendChild(info);
    function growTo(n) { if (steel && cfg.grow) steel.style.width = (30 + 70 * Math.min(1, n / cfg.strikes)) + "%"; }
    if (res) {
      marker.style.left = "50%";
      if (steel) { steel.style.background = tempColor(900, false); growTo(cfg.strikes); }
      info.textContent = cfg.swing ? t("kt_swing_done", { p: Math.round(res.acc * 100) }) :
        (cfg.chisel ? t("kt_chisel_done", { p: Math.round(res.acc * 100) }) : t("kt_hammer_done", { p: Math.round(res.acc * 100), c: res.cold, r: res.reheats }));
      return box;
    }
    growTo(0);
    var hits = [], cold = 0, reheats = 0, heatT0 = 0, running = false;
    var startKey = cfg.swing ? "kt_swing_ready" : (cfg.chisel ? "kt_chisel_start" : "kt_hammer_start");
    var hitKey = cfg.swing ? "kt_swing_hit" : (cfg.chisel ? "kt_chisel_hit" : "kt_hammer_hit");
    var btnGo = el("button", { type: "button", class: "kt-primary", text: t(startKey) });
    var btnHit = el("button", { type: "button", class: "kt-primary kt-hit", text: t(hitKey), disabled: true });
    var btnReheat = noSteel ? null : el("button", { type: "button", text: t("kt_hammer_reheat"), disabled: true });
    var x = 0.5, phase = 0, last = 0;
    function steelTemp(now) { return 1250 - Math.min(1, (now - heatT0) / cfg.coolMs) * 650; }
    function updateInfo() {
      info.textContent = cfg.swing ? t("kt_swing_hint") : (cfg.chisel ? t("kt_chisel_progress", { n: hits.length, total: cfg.strikes }) :
        t("kt_hammer_progress", { n: hits.length, total: cfg.strikes, c: cold }));
    }
    updateInfo();
    function hit() {
      if (!running) return;
      var now = performance.now();
      var acc = Math.max(0, 1 - Math.abs(x - 0.5) / (cfg.swing ? 0.35 : 0.45));
      hits.push(acc);
      if (steel && steelTemp(now) < 800) cold++;
      marker.classList.remove("kt-marker-flash");
      void marker.offsetWidth;
      marker.classList.add("kt-marker-flash");
      box.classList.remove("kt-shake");
      void box.offsetWidth;
      box.classList.add("kt-shake");
      growTo(hits.length);
      updateInfo();
      if (hits.length >= cfg.strikes) {
        var sum = 0;
        hits.forEach(function (h) { sum += h; });
        stopAnim();
        ui.mg[cfg.key] = { acc: Math.round(sum / hits.length * 100) / 100, strikes: hits.length, cold: cold, reheats: reheats };
        render();
      }
    }
    btnGo.addEventListener("click", function () {
      stopAnim();
      btnGo.disabled = true; btnHit.disabled = false;
      if (btnReheat) btnReheat.disabled = false;
      running = true;
      heatT0 = last = performance.now();
      anim = { kind: "hammer" };
      anim.onKey = function (ev) {
        if (ev.code === "Space" || ev.key === " ") { ev.preventDefault(); hit(); }
      };
      document.addEventListener("keydown", anim.onKey);
      function frame(now) {
        var dt = (now - last) / 1000;
        last = now;
        phase += dt * (cfg.speed + hits.length * 0.12);
        x = 0.5 + 0.5 * Math.sin(phase);
        marker.style.left = (x * 100) + "%";
        if (steel) steel.style.background = tempColor(steelTemp(now), false);
        anim.id = requestAnimationFrame(frame);
      }
      anim.id = requestAnimationFrame(frame);
    });
    btnHit.addEventListener("click", hit);
    if (btnReheat) btnReheat.addEventListener("click", function () { reheats++; heatT0 = performance.now(); });
    box.appendChild(el("div", { class: "kt-actions" }, [btnGo, btnHit, btnReheat]));
    return box;
  }

  // ---------------- 小遊戲：積沸（把小片疊到槓桿棒上） ----------------
  // 小片左右擺動，按「放下」時與鋼堆中心的偏差決定精準度；疊越高擺越快
  function stackGame(cfg) {
    var res = ui.mg[cfg.key];
    var box = el("div", { class: "kt-mg kt-stack" });
    box.appendChild(el("div", { class: "kt-mg-title", text: t("kt_mg_stack") }));
    var field_ = el("div", { class: "kt-stack-field" });
    var mover = el("div", { class: "kt-stack-piece kt-stack-mover" });
    var bar = el("div", { class: "kt-stack-bar" });
    field_.appendChild(bar);
    var info = el("div", { class: "kt-readout" });
    box.appendChild(field_);
    box.appendChild(info);
    var placed = res ? res.offsets : [];
    function drawPlaced() {
      Array.prototype.slice.call(field_.querySelectorAll(".kt-stack-placed")).forEach(function (n) { n.remove(); });
      placed.forEach(function (off, i) {
        var pc = el("div", { class: "kt-stack-piece kt-stack-placed" });
        pc.style.left = "calc(" + (50 + off * 50) + "% - 2.25rem)";
        pc.style.bottom = (14 + i * 9) + "px";
        field_.appendChild(pc);
      });
    }
    drawPlaced();
    if (res) {
      info.textContent = t("kt_stack_done", { p: Math.round(res.acc * 100) });
      return box;
    }
    info.textContent = t("kt_stack_progress", { n: 0, total: cfg.pieces });
    var btnGo = el("button", { type: "button", class: "kt-primary", text: t("kt_stack_start") });
    var btnDrop = el("button", { type: "button", class: "kt-primary kt-hit", text: t("kt_stack_drop"), disabled: true });
    var x = 0, phase = 0, last = 0;
    function drop() {
      if (!anim || anim.kind !== "stack") return;
      placed.push(Math.round(x * 100) / 100);
      drawPlaced();
      info.textContent = t("kt_stack_progress", { n: placed.length, total: cfg.pieces });
      if (placed.length >= cfg.pieces) {
        var sum = 0;
        placed.forEach(function (o) { sum += Math.max(0, 1 - Math.abs(o) / 0.6); });
        stopAnim();
        ui.mg[cfg.key] = { acc: Math.round(sum / placed.length * 100) / 100, offsets: placed };
        render();
      }
    }
    btnGo.addEventListener("click", function () {
      stopAnim();
      btnGo.disabled = true; btnDrop.disabled = false;
      field_.appendChild(mover);
      last = performance.now();
      anim = { kind: "stack" };
      anim.onKey = function (ev) { if (ev.code === "Space" || ev.key === " ") { ev.preventDefault(); drop(); } };
      document.addEventListener("keydown", anim.onKey);
      function frame(now) {
        phase += (now - last) / 1000 * (2 + placed.length * 0.35);
        last = now;
        x = Math.sin(phase);
        mover.style.left = "calc(" + (50 + x * 50) + "% - 2.25rem)";
        mover.style.bottom = (14 + placed.length * 9 + 26) + "px";
        anim.id = requestAnimationFrame(frame);
      }
      anim.id = requestAnimationFrame(frame);
    });
    btnDrop.addEventListener("click", drop);
    box.appendChild(el("div", { class: "kt-actions" }, [btnGo, btnDrop]));
    return box;
  }

  // ---------------- 小遊戲：置土（沿著虛線畫出土的邊界） ----------------
  // 畫布上是刀身（刃朝下），虛線是所選刃文的土線。以滑鼠／手指由左往右描，
  // 依每一段與虛線的偏差計分，未描到的段落以 0 計。
  var CLAY_BINS = 40;
  function hamonShape(hamonId, u) {
    if (hamonId === "konotare") return 0.3 + 0.08 * Math.sin(u * Math.PI * 4);
    if (hamonId === "gunome") return 0.3 + 0.1 * Math.abs(Math.sin(u * Math.PI * 9));
    if (hamonId === "choji") return 0.33 + 0.12 * Math.pow(Math.abs(Math.sin(u * Math.PI * 11)), 3);
    if (hamonId === "hitatsura") return 0.55 + 0.12 * Math.sin(u * Math.PI * 6);
    return 0.24;
  }
  function clayGame(cfg) {
    var res = ui.mg[cfg.key];
    var box = el("div", { class: "kt-mg kt-clay" });
    box.appendChild(el("div", { class: "kt-mg-title", text: t("kt_mg_clay") }));
    var canvas = el("canvas", { class: "kt-clay-canvas", width: "640", height: "150", "aria-label": t("kt_mg_clay") });
    box.appendChild(canvas);
    var info = el("div", { class: "kt-readout" });
    box.appendChild(info);
    var ctx = canvas.getContext("2d");
    var W = 640, H = 150, top = 30, bot = 120, x0 = 20, x1 = 620;
    var drawn = res ? res.path.slice() : [];
    function targetY(u) { return bot - (bot - top) * hamonShape(cfg.hamon, u); }
    function paint() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#9aa3ab";
      ctx.beginPath(); ctx.moveTo(x0, top); ctx.lineTo(x1 - 30, top + 6); ctx.lineTo(x1, bot - 20); ctx.lineTo(x1 - 10, bot); ctx.lineTo(x0, bot); ctx.closePath(); ctx.fill();
      // 刀背側厚土（灰褐）
      ctx.fillStyle = "rgba(92, 74, 58, 0.55)";
      ctx.beginPath(); ctx.moveTo(x0, top);
      for (var i = 0; i <= 60; i++) { var u = i / 60; ctx.lineTo(x0 + (x1 - x0) * u, top); }
      for (var j = 60; j >= 0; j--) { var u2 = j / 60; ctx.lineTo(x0 + (x1 - x0) * u2, targetY(u2)); }
      ctx.closePath(); ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
      ctx.setLineDash([6, 5]); ctx.strokeStyle = "#f4efe6"; ctx.lineWidth = 2;
      ctx.beginPath();
      for (var k = 0; k <= 80; k++) { var u3 = k / 80, xx = x0 + (x1 - x0) * u3; if (k) ctx.lineTo(xx, targetY(u3)); else ctx.moveTo(xx, targetY(u3)); }
      ctx.stroke(); ctx.setLineDash([]);
      if (drawn.length) {
        ctx.strokeStyle = "#5a4636"; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.beginPath(); ctx.moveTo(drawn[0][0], drawn[0][1]);
        drawn.forEach(function (pt) { ctx.lineTo(pt[0], pt[1]); });
        ctx.stroke();
      }
    }
    function score() {
      var bins = new Array(CLAY_BINS).fill(null);
      drawn.forEach(function (pt) {
        var u = (pt[0] - x0) / (x1 - x0);
        if (u < 0 || u >= 1) return;
        var i = Math.floor(u * CLAY_BINS);
        var err = Math.abs(pt[1] - targetY(u)) / 25;
        bins[i] = bins[i] === null ? err : Math.min(bins[i], err);
      });
      var sum = 0;
      bins.forEach(function (e) { sum += e === null ? 0 : Math.max(0, 1 - e); });
      return Math.round(sum / CLAY_BINS * 100) / 100;
    }
    paint();
    if (res) {
      info.textContent = t("kt_clay_done", { p: Math.round(res.acc * 100) });
      box.appendChild(el("div", { class: "kt-actions" }, [el("button", { type: "button", text: t("kt_clay_redo"), onclick: function () { delete ui.mg[cfg.key]; rerenderKeepScroll(); } })]));
      return box;
    }
    info.textContent = t("kt_clay_hint");
    var drawing = false;
    function pos(ev) {
      var r = canvas.getBoundingClientRect();
      return [(ev.clientX - r.left) * W / r.width, (ev.clientY - r.top) * H / r.height];
    }
    canvas.addEventListener("pointerdown", function (ev) { drawing = true; canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId); drawn.push(pos(ev)); paint(); });
    canvas.addEventListener("pointermove", function (ev) { if (!drawing) return; drawn.push(pos(ev)); paint(); info.textContent = t("kt_clay_live", { p: Math.round(score() * 100) }); });
    canvas.addEventListener("pointerup", function () { drawing = false; });
    canvas.addEventListener("pointercancel", function () { drawing = false; });
    box.appendChild(el("div", { class: "kt-actions" }, [
      el("button", { type: "button", class: "kt-primary", text: t("kt_clay_ok"), onclick: function () {
        ui.mg[cfg.key] = { acc: score(), path: drawn.map(function (pt) { return [Math.round(pt[0]), Math.round(pt[1])]; }) };
        rerenderKeepScroll();
      } }),
      el("button", { type: "button", text: t("kt_clay_clear"), onclick: function () { drawn = []; paint(); info.textContent = t("kt_clay_hint"); } })
    ]));
    return box;
  }

  // ---------------- 小遊戲：合い取り（看回火色停火） ----------------
  // 刀背壓在加熱的銅台上，磨亮的面隨溫度出現回火色（淡麥稈→麥稈→褐→紫→藍→灰）。按「離火」時的溫度＝回火溫度。
  function temperGame(cfg) {
    var res = ui.mg[cfg.key];
    var box = el("div", { class: "kt-mg kt-temper" });
    box.appendChild(el("div", { class: "kt-mg-title", text: t("kt_mg_temper") }));
    var plate = el("div", { class: "kt-temper-plate" });
    var swatches = el("div", { class: "kt-temper-guide" }, D.TEMPER_COLORS.filter(function (c) { return c.t >= 180 && c.t <= 400; }).map(function (c) {
      var sw = el("span", { class: "kt-temper-sw", title: L(c.name) + (state.assist ? " " + c.t + "℃" : "") }, [L(c.name)]);
      sw.style.background = c.color;
      return sw;
    }));
    var info = el("div", { class: "kt-readout" });
    box.appendChild(plate);
    box.appendChild(swatches);
    box.appendChild(info);
    function paint(T) {
      plate.style.background = Core.temperColorAt(T).color;
      if (state.assist) info.textContent = t("kt_heat_temp", { t: Math.round(T) });
    }
    if (res) {
      paint(res.temp || 20);
      info.textContent = res.temp ? t("kt_temper_done", { c: L(Core.temperColorAt(res.temp).name) }) + (state.assist ? "（" + res.temp + "℃）" : "") : t("kt_temper_none");
      box.appendChild(el("div", { class: "kt-actions" }, [el("button", { type: "button", text: t("kt_redo"), onclick: function () { delete ui.mg[cfg.key]; rerenderKeepScroll(); } })]));
      return box;
    }
    paint(20);
    if (!state.assist) info.textContent = t("kt_temper_hint");
    var btnGo = el("button", { type: "button", class: "kt-primary", text: t("kt_temper_start") });
    var btnStop = el("button", { type: "button", class: "kt-primary", text: t("kt_temper_stop"), disabled: true });
    var btnSkip = el("button", { type: "button", text: t("kt_temper_skip"), onclick: function () { stopAnim(); ui.mg[cfg.key] = { temp: 0 }; rerenderKeepScroll(); } });
    var T = 20;
    btnGo.addEventListener("click", function () {
      stopAnim();
      btnGo.disabled = true; btnStop.disabled = false;
      var t0 = performance.now();
      anim = { kind: "temper" };
      function frame(now) {
        // 約 14 秒升到 560℃；前段較快、後段較慢
        T = 20 + 540 * Math.min(1, Math.pow((now - t0) / 14000, 0.8));
        paint(T);
        if (T >= 559) { anim.finish(); return; }
        anim.id = requestAnimationFrame(frame);
      }
      anim.finish = function () { stopAnim(); ui.mg[cfg.key] = { temp: Math.round(T) }; rerenderKeepScroll(); };
      anim.id = requestAnimationFrame(frame);
    });
    btnStop.addEventListener("click", function () { if (anim && anim.finish) anim.finish(); });
    box.appendChild(el("div", { class: "kt-actions" }, [btnGo, btnStop, btnSkip]));
    return box;
  }

  // ---------------- 小遊戲：研磨節奏 ----------------
  // 圓圈依固定節拍脹縮，在最大時按「研ぐ」。偏離節拍越少越好；刀面隨著次數變亮
  function rhythmGame(cfg) {
    var res = ui.mg[cfg.key];
    var box = el("div", { class: "kt-mg kt-rhythm" });
    box.appendChild(el("div", { class: "kt-mg-title", text: t("kt_mg_rhythm") }));
    var face = el("div", { class: "kt-rhythm-face" });
    var ring = el("div", { class: "kt-rhythm-ring" });
    var stageEl = el("div", { class: "kt-rhythm-stage" }, [face, ring]);
    var info = el("div", { class: "kt-readout" });
    box.appendChild(stageEl);
    box.appendChild(info);
    function shine(n) { face.style.opacity = String(0.25 + 0.75 * Math.min(1, n / cfg.strokes)); }
    if (res) {
      shine(cfg.strokes);
      info.textContent = t("kt_rhythm_done", { p: Math.round(res.acc * 100) });
      return box;
    }
    shine(0);
    var PERIOD = 900, hits = [], t0 = 0;
    info.textContent = t("kt_rhythm_progress", { n: 0, total: cfg.strokes });
    var btnGo = el("button", { type: "button", class: "kt-primary", text: t("kt_rhythm_start") });
    var btnHit = el("button", { type: "button", class: "kt-primary kt-hit", text: t("kt_rhythm_hit"), disabled: true });
    function stroke() {
      if (!anim || anim.kind !== "rhythm") return;
      var ph = ((performance.now() - t0) % PERIOD) / PERIOD; // 0＝拍點
      var err = Math.min(ph, 1 - ph) * 2; // 0〜1
      hits.push(Math.max(0, 1 - err * 1.6));
      shine(hits.length);
      info.textContent = t("kt_rhythm_progress", { n: hits.length, total: cfg.strokes });
      if (hits.length >= cfg.strokes) {
        var sum = 0;
        hits.forEach(function (h) { sum += h; });
        stopAnim();
        ui.mg[cfg.key] = { acc: Math.round(sum / hits.length * 100) / 100 };
        rerenderKeepScroll();
      }
    }
    btnGo.addEventListener("click", function () {
      stopAnim();
      btnGo.disabled = true; btnHit.disabled = false;
      t0 = performance.now();
      anim = { kind: "rhythm" };
      anim.onKey = function (ev) { if (ev.code === "Space" || ev.key === " ") { ev.preventDefault(); stroke(); } };
      document.addEventListener("keydown", anim.onKey);
      function frame(now) {
        var ph = ((now - t0) % PERIOD) / PERIOD;
        var s = 1 - Math.min(ph, 1 - ph) * 2; // 拍點時 1
        ring.style.transform = "scale(" + (0.55 + 0.45 * s) + ")";
        ring.style.opacity = String(0.35 + 0.65 * s);
        anim.id = requestAnimationFrame(frame);
      }
      anim.id = requestAnimationFrame(frame);
    });
    btnHit.addEventListener("click", stroke);
    box.appendChild(el("div", { class: "kt-actions" }, [btnGo, btnHit]));
    return box;
  }

  // ---------------- 刀身 SVG ----------------
  // 刃朝下、切先朝右。反りの中心は SORI_TYPES.center（負的反り＝內彎，如廓爾喀刀）；切先の長さは KISSAKI.len。
  // 單刃：中心線＝棟，刃在下方；雙刃：中心線為劍脊，兩側對稱。異國刀劍畫護手，日本刀畫鎺。
  function bladeSvg(b, opts) {
    opts = opts || {};
    var bt = Core.byId(D.BLADE_TYPES, b.type) || D.BLADE_TYPES[2];
    var dbl = bt.edges === 2;
    var length = b.length || Math.round((bt.ideal[0] + bt.ideal[1]) / 2);
    var mihaba = b.mihaba || Math.round((bt.width[0] + bt.width[1]) / 2);
    var sori = opts.sori !== undefined ? opts.sori : (b.sori || 0);
    var st = Core.byId(D.SORI_TYPES, b.soriType) || D.SORI_TYPES[1];
    var ks = Core.byId(D.KISSAKI, b.kissaki) || (dbl ? Core.byId(D.KISSAKI, "kensaki") : D.KISSAKI[1]);
    var S = 6; // px / cm
    var nk = length * (bt.id === "yari" ? 0.9 : (bt.family === "nihonto" ? 0.28 : 0.22));
    var Lpx = length * S, NKpx = nk * S;
    var widthPx = mihaba / 10 * S * 1.6;
    var soriPx = sori / 10 * S * (Math.abs(sori) > 50 ? 1 : 1.6); // 小彎度誇張 1.6 倍讓反り看得出來
    var pad = 14;
    var x0 = 14 + NKpx;
    var kLenW = ks.len;
    var c = st.center;
    function g(u) {
      if (u < 0) return u * (2 / c);
      return u < c ? 1 - Math.pow((c - u) / c, 2) : 1 - Math.pow((u - c) / (1 - c), 2);
    }
    var wave = bt.wave;
    function center(u) {
      var y = pad + soriPx * g(u);
      // 波刃：刃身中段（避開根部與切先）左右擺動
      if (wave && u > 0.06 && u < 1 - kLenW) y += wave.amp / 10 * S * 1.6 * Math.sin((u - 0.06) / (1 - kLenW - 0.06) * Math.PI * wave.count);
      return [x0 + u * Lpx, y];
    }
    function normal(u) {
      var a = center(u - 0.002), b2 = center(u + 0.002);
      var dx = b2[0] - a[0], dy = b2[1] - a[1], len = Math.sqrt(dx * dx + dy * dy);
      return [-dy / len, dx / len];
    }
    var kLen = ks.len;
    function widthAt(u) {
      var w;
      if (bt.profile === "kukri") w = widthPx * (0.75 + 0.45 * Math.sin(Math.min(1, u * 1.2) * Math.PI * 0.8));
      else if (bt.profile === "widen") w = widthPx * (0.85 + 0.35 * u);
      else if (ks.id === "ikubi") w = widthPx * (1 - 0.15 * u);
      else if (bt.profile === "narrow") w = widthPx * (1 - 0.4 * u);
      else w = widthPx * (1 - 0.3 * u);
      var k0 = 1 - kLen;
      if (u > k0) {
        var tt = Math.min(1, (u - k0) / kLen);
        if (dbl) w *= ks.id === "round" ? Math.sqrt(Math.max(0, 1 - tt * tt)) : 1 - tt;
        else w *= ks.id === "o" ? Math.sqrt(Math.max(0, 1 - tt * tt)) : (ks.id === "needle" ? 1 - tt : Math.pow(Math.max(0, Math.cos(tt * Math.PI / 2)), 0.8));
      }
      return w;
    }
    var hamon = b.hamon && b.hamon !== "none" ? b.hamon : null;
    function hamonRatio(u) {
      if (hamon === "konotare") return 0.3 + 0.08 * Math.sin(u * Math.PI * 8);
      if (hamon === "gunome") return 0.3 + 0.1 * Math.abs(Math.sin(u * Math.PI * 30));
      if (hamon === "choji") return 0.32 + 0.12 * Math.pow(Math.abs(Math.sin(u * Math.PI * 36)), 3) + 0.06 * Math.pow(Math.abs(Math.sin(u * Math.PI * 36 + 1)), 5);
      if (hamon === "hitatsura") return 0.5 + 0.12 * Math.sin(u * Math.PI * 14);
      return 0.26;
    }
    // 單刃：top＝棟（offset 0）、bot＝刃（offset w）。雙刃：top＝−w/2、bot＝+w/2
    var N = 160, top = [], bot = [], hamB = [], hamT = [], ridge = [];
    var tk = Core.byId(D.TSUKURI, b.tsukuri) || (dbl ? Core.byId(D.TSUKURI, "diamond") : D.TSUKURI[0]);
    function off(p, n, d) { return [p[0] + n[0] * d, p[1] + n[1] * d]; }
    for (var i = 0; i <= N; i++) {
      var u = i / N;
      var p = center(u), n = normal(u), w = widthAt(u);
      var hr = hamonRatio(u);
      if (u > 1 - kLen) hr = Math.min(0.7, hr + (u - (1 - kLen)) / kLen * 0.2);
      if (dbl) {
        top.push(off(p, n, -w / 2)); bot.push(off(p, n, w / 2));
        hamB.push(off(p, n, w / 2 - w / 2 * hr * 1.4)); hamT.push(off(p, n, -w / 2 + w / 2 * hr * 1.4));
        ridge.push(p);
      } else {
        top.push(p); bot.push(off(p, n, w));
        hamB.push(off(p, n, w * (1 - hr)));
        if (u <= 1 - kLen) ridge.push(off(p, n, w * (1 - tk.shinogiAt)));
      }
    }
    function pts(arr) { return arr.map(function (q) { return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" "); }
    // 莖
    var nkTop = [], nkBot = [];
    var n0 = normal(0);
    for (var j = 0; j <= 20; j++) {
      var uu = -j / 20 * (nk / length);
      var pc = center(uu), ww = widthPx * (dbl ? 0.45 - 0.15 * (j / 20) : 0.92 - 0.35 * (j / 20));
      if (dbl) { nkTop.push(off(pc, n0, -ww / 2)); nkBot.push(off(pc, n0, ww / 2)); }
      else { nkTop.push(pc); nkBot.push(off(pc, n0, ww)); }
    }
    var nkPts = nkTop.concat(nkBot.slice().reverse());
    var c0 = center(0);
    var guardH = bt.family !== "nihonto" ? widthPx * (dbl ? 2.6 : 1.8) : 0;
    var gMid = dbl ? c0 : off(c0, n0, widthPx / 2);
    var maxY = -1e9, minY = 1e9;
    top.concat(bot, nkPts).forEach(function (q) { if (q[1] > maxY) maxY = q[1]; if (q[1] < minY) minY = q[1]; });
    minY = Math.min(minY, gMid[1] - guardH / 2); maxY = Math.max(maxY, gMid[1] + guardH / 2);
    var vbY = Math.floor(minY - 8), H = Math.ceil(maxY + 8) - vbY, Wd = Math.ceil(x0 + Lpx + 14);
    var svg = '<svg class="kt-blade" viewBox="0 ' + vbY + " " + Wd + " " + H + '" xmlns="http://www.w3.org/2000/svg" role="img">';
    svg += '<defs><linearGradient id="ktSteel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7d8790"/><stop offset="0.5" stop-color="#b9c1c8"/><stop offset="1" stop-color="#8d969e"/></linearGradient>' +
      '<filter id="ktNioi"><feGaussianBlur stdDeviation="0.8"/></filter></defs>';
    svg += '<polygon points="' + pts(nkPts) + '" fill="#4f4237" stroke="#2c241d" stroke-width="0.8"/>';
    if (bt.family === "nihonto") {
      for (var y = 2; y < 20; y += 2) {
        var a0 = nkTop[y], b0 = nkBot[y];
        var slant = b.yasurime === "kiri" ? 0 : (b.yasurime === "sujikai" ? 5 : 3);
        svg += '<line x1="' + a0[0].toFixed(1) + '" y1="' + a0[1].toFixed(1) + '" x2="' + (b0[0] - slant).toFixed(1) + '" y2="' + b0[1].toFixed(1) + '" stroke="#2c241d" stroke-width="0.6" opacity="0.7"/>';
      }
      var mkp = off(center(-nk / length * 0.45), n0, widthPx * 0.42);
      svg += '<circle cx="' + mkp[0].toFixed(1) + '" cy="' + mkp[1].toFixed(1) + '" r="2.4" fill="#1b1612"/>';
    }
    // 刀身
    svg += '<polygon points="' + pts(top.concat(bot.slice().reverse())) + '" fill="url(#ktSteel)" stroke="#3c434a" stroke-width="0.9"/>';
    if (hamon) {
      svg += '<polygon points="' + pts(hamB.concat(bot.slice().reverse())) + '" fill="#eef3f6" opacity="0.92"/>';
      svg += '<polyline points="' + pts(hamB) + '" fill="none" stroke="#ffffff" stroke-width="1.6" filter="url(#ktNioi)"/>';
      if (dbl) {
        svg += '<polygon points="' + pts(hamT.concat(top.slice().reverse())) + '" fill="#eef3f6" opacity="0.92"/>';
        svg += '<polyline points="' + pts(hamT) + '" fill="none" stroke="#ffffff" stroke-width="1.6" filter="url(#ktNioi)"/>';
      }
      if (hamon === "hitatsura") {
        for (var s2 = 0.12; s2 < 0.85; s2 += 0.11) {
          var cp = off(center(s2), normal(s2), widthAt(s2) * (dbl ? 0 : 0.25));
          svg += '<ellipse cx="' + cp[0].toFixed(1) + '" cy="' + cp[1].toFixed(1) + '" rx="5" ry="1.6" fill="#eef3f6" opacity="0.85"/>';
        }
      }
      if (b.ashi && hamon !== "hitatsura") {
        for (var a1 = 0.04; a1 < 1 - kLen; a1 += 0.03) {
          var ix = Math.round(a1 * N), hp = hamB[ix], ep = bot[ix];
          svg += '<line x1="' + hp[0].toFixed(1) + '" y1="' + hp[1].toFixed(1) + '" x2="' + (hp[0] * 0.6 + ep[0] * 0.4).toFixed(1) + '" y2="' + (hp[1] * 0.6 + ep[1] * 0.4).toFixed(1) + '" stroke="#ffffff" stroke-width="0.8" opacity="0.8"/>';
        }
      }
    }
    if (dbl) {
      svg += '<polyline points="' + pts(ridge) + '" fill="none" stroke="#5d666e" stroke-width="' + (tk.id === "fuller" ? 3 : 0.8) + '" opacity="' + (tk.id === "fuller" ? 0.5 : 1) + '"/>';
    } else if (tk.id === "shinogi" || tk.id === "kiriha" || tk.id === "lenticular") {
      svg += '<polyline points="' + pts(ridge) + '" fill="none" stroke="#5d666e" stroke-width="0.8"/>';
      if (tk.id !== "lenticular") {
        var yk = Math.round((1 - kLen) * N);
        svg += '<line x1="' + top[yk][0].toFixed(1) + '" y1="' + top[yk][1].toFixed(1) + '" x2="' + bot[yk][0].toFixed(1) + '" y2="' + bot[yk][1].toFixed(1) + '" stroke="#5d666e" stroke-width="0.8"/>';
      }
    }
    // 鎺（日本刀）／護手（異國刀劍）
    if (bt.family === "nihonto") {
      var s0 = dbl ? off(c0, n0, -widthPx / 2) : c0, e0 = off(c0, n0, dbl ? widthPx / 2 : widthPx);
      svg += '<polygon points="' + [[s0[0] - 9, s0[1] - 1], [s0[0] + 3, s0[1] - 1], [e0[0] + 3, e0[1] + 1], [e0[0] - 9, e0[1] + 1]].map(function (q) { return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" ") + '" fill="#c9a44a" stroke="#8a6d25" stroke-width="0.8"/>';
    } else {
      svg += '<rect x="' + (gMid[0] - 5).toFixed(1) + '" y="' + (gMid[1] - guardH / 2).toFixed(1) + '" width="6" height="' + guardH.toFixed(1) + '" rx="2" fill="#8a6d25" stroke="#5a4515" stroke-width="0.8"/>';
    }
    // 瑕疵
    var flaws = b.flaws || [];
    if (flaws.indexOf("yakiware") >= 0) {
      var cpp = top[Math.round(0.55 * N)], cbb = bot[Math.round(0.55 * N)];
      svg += '<polyline points="' + [0, 0.3, 0.55, 0.8, 1].map(function (f, k) {
        return (cpp[0] + (cbb[0] - cpp[0]) * f + (k % 2 ? 3 : -2)).toFixed(1) + "," + (cpp[1] + (cbb[1] - cpp[1]) * f).toFixed(1);
      }).join(" ") + '" fill="none" stroke="#c0392b" stroke-width="1.4"/>';
    }
    if (flaws.indexOf("hagire") >= 0) {
      var hpp = bot[Math.round(0.35 * N)];
      svg += '<line x1="' + hpp[0].toFixed(1) + '" y1="' + hpp[1].toFixed(1) + '" x2="' + (hpp[0] + 2).toFixed(1) + '" y2="' + (hpp[1] - 6).toFixed(1) + '" stroke="#c0392b" stroke-width="1.4"/>';
    }
    var chips = opts.chips || 0;
    for (var ci = 0; ci < Math.min(chips, 8); ci++) {
      var ep2 = bot[Math.round((0.2 + ci * 0.08) * N)];
      svg += '<circle cx="' + ep2[0].toFixed(1) + '" cy="' + ep2[1].toFixed(1) + '" r="1.8" fill="#c0392b"/>';
    }
    if (opts.broken) {
      var bt0 = top[N / 2], bb0 = bot[N / 2];
      svg += '<line x1="' + (bt0[0] - 4).toFixed(1) + '" y1="' + (bt0[1] - 4).toFixed(1) + '" x2="' + (bb0[0] + 4).toFixed(1) + '" y2="' + (bb0[1] + 4).toFixed(1) + '" stroke="#c0392b" stroke-width="3"/>';
    }
    svg += "</svg>";
    return el("div", { class: "kt-blade-wrap", html: svg });
  }

  // ---------------- 共用表單元件 ----------------

  function radioList(name, list, value, onPick, opts) {
    opts = opts || {};
    var box = el("div", { class: "kt-options" + (opts.compact ? " kt-options-compact" : "") });
    list.forEach(function (o) {
      var disabled = opts.disabled && opts.disabled(o);
      var lbl = el("label", { class: "kt-option" + (value === o.id ? " kt-option-on" : "") + (disabled ? " kt-option-off" : "") }, [
        el("input", { type: "radio", name: name, value: o.id, checked: value === o.id, disabled: disabled,
          onchange: function () { onPick(o.id); } }),
        el("span", { class: "kt-option-name", text: L(o.name) + (opts.recommend && opts.recommend.indexOf(o.id) >= 0 ? " ★" : "") }),
        o.desc && !opts.compact ? el("span", { class: "kt-option-desc", text: L(o.desc) }) : null
      ]);
      box.appendChild(lbl);
    });
    return box;
  }

  function field(label, control, note) {
    return el("div", { class: "kt-field" }, [el("div", { class: "kt-label", text: label }), control, note ? el("div", { class: "kt-muted", text: note }) : null]);
  }

  function slider(min, max, stepv, value, fmt, onChange) {
    var out = el("span", { class: "kt-slider-val", text: fmt(value) });
    var inp = el("input", { type: "range", min: String(min), max: String(max), step: String(stepv), value: String(value) });
    inp.addEventListener("input", function () {
      var v = parseFloat(inp.value);
      out.textContent = fmt(v);
      onChange(v, false);
    });
    inp.addEventListener("change", function () { onChange(parseFloat(inp.value), true); });
    return el("div", { class: "kt-slider" }, [inp, out]);
  }

  // ---------------- 工序草稿 ----------------

  function mgKey(pIndex, stepId, part) { return pIndex + ":" + stepId + ":" + part; }

  // 刀種相稱的選項：先找刀種宣告的第一個，找不到就取刃數相符的第一個
  function edgesOk(o, bt) { return !o.edges || o.edges === bt.edges; }
  function firstFit(list, wanted, bt) {
    var hit = list.filter(function (o) { return wanted.indexOf(o.id) >= 0 && edgesOk(o, bt); })[0];
    return (hit || list.filter(function (o) { return edgesOk(o, bt); })[0]).id;
  }

  function draftFor(pIndex, stepId) {
    var key = pIndex + ":" + stepId;
    if (ui.draft[key]) return ui.draft[key];
    var b = state.players[pIndex].blade;
    var d = {};
    var bt = Core.byId(D.BLADE_TYPES, b.type) || D.BLADE_TYPES[2];
    var mat = b.kawaId ? Core.byId(D.KAWAGANE, b.kawaId) : null;
    var bar = mat && mat.form !== "bloom" && mat.form !== "stack";
    // 預設：玉鋼打刀（使用者指定「大部分選擇的初階階段基本都是成品日本刀」）
    if (stepId === "material") d = { kawagane: "tama1", kawaKg: 6, shingane: "hocho", shinKg: 2, type: "uchigatana" };
    else if (stepId === "kowari") d = { picks: new Array(Core.KOWARI_PIECES).fill(null) };
    else if (stepId === "tsumi") d = { ash: true };
    else if (stepId === "shitakitae") d = { folds: bar ? 0 : 7, shinFolds: 4 };
    else if (stepId === "uwakitae") d = { folds: bar ? 0 : 6, pattern: "itame" };
    else if (stepId === "tsukurikomi") d = { construction: b.shinId === "none" ? "maru" : "kobuse" };
    else if (stepId === "sunobe") d = { length: Math.round((bt.ideal[0] + bt.ideal[1]) / 2) };
    else if (stepId === "hizukuri") {
      d = { tsukuri: firstFit(D.TSUKURI, bt.tsukuri, bt), kissaki: firstFit(D.KISSAKI, bt.kissaki, bt), mune: "iori",
        soriType: firstFit(D.SORI_TYPES, bt.soriType, bt), kasane: (bt.kasane[0] + bt.kasane[1]) / 2,
        mihaba: Math.round((bt.width[0] + bt.width[1]) / 2), forgeSori: bt.forgeSori };
    } else if (stepId === "tsuchioki") d = { hamon: bt.ht === "through" ? "none" : "suguha", edgeClay: "thin", spineClay: "thick", ashi: bt.ht !== "through", norm: 1 };
    else if (stepId === "yakiire") d = { media: "warm", dark: false };
    else if (stepId === "aitori") d = { hours: 1, soriAdjust: 0 };
    else if (stepId === "togi") d = { order: [], edge: "standard" };
    else if (stepId === "mei") d = { yasurime: "katte", nakagojiri: "kuri", mei: state.players[pIndex].name };
    ui.draft[key] = d;
    return d;
  }

  // 每道工序要完成的小遊戲（依序出現）
  function mgParts(step, d) {
    switch (step.id) {
      case "kowari": return ["mizuheshi"];
      case "tsumi": return ["stack", "heat"];
      case "shitakitae": case "uwakitae": return ["heat", "hammer"];
      case "tsukurikomi": return ["heat", "hammer"];
      case "sunobe": return ["hammer"];
      case "hizukuri": return ["hammer"];
      case "tsuchioki": return d.hamon === "none" ? [] : ["clay"];
      case "yakiire": return ["heat"];
      case "aitori": return ["temper"];
      case "togi": return ["rhythm"];
      case "mei": return ["chisel"];
    }
    return [];
  }

  // 收集送給 Core 的 input；小遊戲未完成時回傳 null
  function buildInput(pIndex, step) {
    var d = draftFor(pIndex, step.id);
    var x = Core.clone(d);
    var parts = mgParts(step, d);
    for (var i = 0; i < parts.length; i++) if (!ui.mg[mgKey(pIndex, step.id, parts[i])]) return null;
    function mg(part) { return ui.mg[mgKey(pIndex, step.id, part)]; }
    if (parts.indexOf("heat") >= 0) { x.temp = mg("heat").temp; if (mg("heat").delay !== undefined) x.delay = mg("heat").delay; }
    if (parts.indexOf("hammer") >= 0) x.hammer = mg("hammer");
    if (step.id === "kowari") { x.mizuheshi = mg("mizuheshi"); if (d.picks.indexOf(null) >= 0) return null; }
    if (step.id === "tsumi") x.stack = mg("stack");
    if (step.id === "tsuchioki") x.clayAcc = d.hamon === "none" ? 1 : mg("clay").acc;
    if (step.id === "aitori") x.temp = mg("temper").temp;
    if (step.id === "togi") { x.rhythm = mg("rhythm"); if (!d.order.length) return null; }
    if (step.id === "mei") x.chisel = mg("chisel");
    return x;
  }

  // ---------------- 工序面板 ----------------

  function rerenderKeepScroll() {
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  function setDraft(d, k, v, rerender) {
    d[k] = v;
    if (rerender !== false) rerenderKeepScroll();
  }

  function typeGroups(d, pickType) {
    var wrap = el("div", {});
    wrap.appendChild(field(t("kt_f_type_nihonto"), radioList("type", D.BLADE_TYPES.filter(function (o) { return o.family === "nihonto"; }), d.type, pickType)));
    var fam = Core.byId(D.BLADE_TYPES, d.type).family;
    [["famous", "kt_f_type_famous"], ["rare", "kt_f_type_rare"]].forEach(function (g) {
      wrap.appendChild(el("details", { class: "kt-special", open: fam === g[0] }, [
        el("summary", { text: t(g[1]) }),
        radioList("type", D.BLADE_TYPES.filter(function (o) { return o.family === g[0]; }), d.type, pickType)
      ]));
    });
    return wrap;
  }

  function stepControls(pIndex, step) {
    var p = state.players[pIndex], b = p.blade, d = draftFor(pIndex, step.id);
    var box = el("div", { class: "kt-controls" });
    var heatKey = mgKey(pIndex, step.id, "heat"), hamKey = mgKey(pIndex, step.id, "hammer");
    var heatDone = !!ui.mg[heatKey];
    function key(part) { return mgKey(pIndex, step.id, part); }

    if (step.kind === "material") {
      box.appendChild(typeGroups(d, function (v) { setDraft(d, "type", v); }));
      var pickKawa = function (v) { setDraft(d, "kawagane", v); };
      box.appendChild(field(t("kt_f_kawagane"), radioList("kawa", D.KAWAGANE.filter(function (o) { return !o.special; }), d.kawagane, pickKawa)));
      box.appendChild(el("details", { class: "kt-special", open: !!Core.byId(D.KAWAGANE, d.kawagane).special }, [
        el("summary", { text: t("kt_f_kawagane_special") }),
        radioList("kawa", D.KAWAGANE.filter(function (o) { return o.special; }), d.kawagane, pickKawa)
      ]));
      box.appendChild(field(t("kt_f_kawa_kg"), slider(2, 12, 0.5, d.kawaKg, function (v) { return v + " kg"; }, function (v) { d.kawaKg = v; })));
      box.appendChild(field(t("kt_f_shingane"), radioList("shin", D.SHINGANE, d.shingane, function (v) { setDraft(d, "shingane", v); })));
      if (d.shingane !== "none") box.appendChild(field(t("kt_f_shin_kg"), slider(0.5, 4, 0.5, d.shinKg, function (v) { return v + " kg"; }, function (v) { d.shinKg = v; })));
      if (state.assist) box.appendChild(compTable(Core.byId(D.KAWAGANE, d.kawagane)));
    } else if (step.kind === "kowari") {
      // 先水壓（打薄），打得均勻斷口才好判讀；之後才敲碎分揀
      var miz = ui.mg[key("mizuheshi")];
      box.appendChild(hammerGame({ key: key("mizuheshi"), strikes: 6, speed: 2.2, zone: 0.14, coolMs: 7000, title: t("kt_mg_mizuheshi") }));
      if (miz) {
        var pieces = Core.kowariPieces(state, pIndex, miz.acc);
        var grid = el("div", { class: "kt-pieces" });
        pieces.forEach(function (pc, i) {
          var face = el("div", { class: "kt-piece-face kt-look-" + pc.look + " kt-sheen-" + pc.sheen + " kt-spots-" + pc.spots });
          var picks = el("div", { class: "kt-piece-picks" });
          [["kawa", "kt_pick_kawa"], ["shin", "kt_pick_shin"], ["discard", "kt_pick_discard"]].forEach(function (o) {
            if (o[0] === "shin" && b.shinId === "none") return;
            picks.appendChild(el("button", { type: "button", class: "kt-chip" + (d.picks[i] === o[0] ? " kt-chip-on kt-chip-" + o[0] : ""), text: t(o[1]),
              onclick: function () { d.picks[i] = o[0]; rerenderKeepScroll(); } }));
          });
          grid.appendChild(el("div", { class: "kt-piece" + (d.picks[i] ? " kt-piece-picked" : "") }, [
            face,
            el("div", { class: "kt-piece-desc", text: t("kt_look_" + pc.look) + "・" + t("kt_sheen_" + pc.sheen) + "・" + t("kt_spots_" + pc.spots) }),
            state.assist ? el("div", { class: "kt-muted", text: "C≈" + pc.carbon.toFixed(2) + "%" }) : null,
            picks
          ]));
        });
        box.appendChild(el("div", { class: "kt-mg-title", text: t("kt_mg_sort") }));
        box.appendChild(grid);
        box.appendChild(el("div", { class: "kt-muted", text: t("kt_kowari_left", { n: d.picks.filter(function (x) { return x === null; }).length }) }));
      }
    } else if (step.kind === "heat") {
      if (step.id === "tsumi") {
        box.appendChild(stackGame({ key: key("stack"), pieces: 7 }));
        if (!ui.mg[key("stack")]) return box;
        box.appendChild(el("label", { class: "kt-check" }, [
          el("input", { type: "checkbox", checked: d.ash, disabled: heatDone, onchange: function (ev) { d.ash = ev.target.checked; } }),
          " " + t("kt_f_ash")
        ]));
      } else {
        box.appendChild(field(t("kt_f_media"), radioList("media", D.QUENCH_MEDIA, d.media, function (v) { setDraft(d, "media", v); }, { compact: true })));
        box.appendChild(el("label", { class: "kt-check" }, [
          el("input", { type: "checkbox", checked: d.dark, disabled: heatDone, onchange: function (ev) { setDraft(d, "dark", ev.target.checked); } }),
          " " + t("kt_f_dark")
        ]));
        box.appendChild(bladeSvg(b, { sori: b.forgeSori }));
      }
      if (state.assist) box.appendChild(metalInfo(b));
      box.appendChild(heatGame({ key: heatKey, win: Core.heatWindow(b, step.heatId), daylight: step.id === "yakiire" && !d.dark,
        title: step.id === "yakiire" ? t("kt_mg_quench") : t("kt_mg_heat"), plunge: step.id === "yakiire" }));
    } else if (step.kind === "fold") {
      var mat = Core.byId(D.KAWAGANE, b.kawaId);
      box.appendChild(field(t("kt_f_folds"), slider(0, 12, 1, d.folds, function (v) { return v ? t("kt_times", { n: v }) : t("kt_no_fold"); }, function (v, done) {
        d.folds = v;
        if (done) rerenderKeepScroll(); // 折返與否決定加熱目標（鍛接溫度／鍛造溫度）
      }), heatDone ? t("kt_folds_locked") : null));
      if (heatDone) box.lastChild.querySelector("input").disabled = true;
      if (step.stage === "shita" && b.shinId !== "none") {
        box.appendChild(field(t("kt_f_shin_folds"), slider(0, 10, 1, d.shinFolds, function (v) { return t("kt_times", { n: v }); }, function (v) { d.shinFolds = v; })));
      }
      if (step.stage === "uwa" && mat.pattern === "jihada") {
        box.appendChild(field(t("kt_f_pattern"), radioList("pattern", D.PATTERNS, d.pattern, function (v) { setDraft(d, "pattern", v); })));
      }
      if (step.stage === "uwa") box.appendChild(el("div", { class: "kt-muted", text: t("kt_folds_so_far", { n: b.folds, l: b.layers.toLocaleString() }) }));
      if (state.assist) box.appendChild(metalInfo(b));
      box.appendChild(el("div", { class: "kt-muted", text: d.folds ? t("kt_heat_goal_weld") : t("kt_heat_goal_forge") }));
      box.appendChild(heatGame({ key: heatKey, win: Core.heatWindow(b, "fold", { folds: d.folds }), daylight: false, title: t("kt_mg_heat") }));
      if (heatDone) box.appendChild(hammerGame({ key: hamKey, strikes: Core.HAMMER_STRIKES, speed: 2.4, zone: 0.12, coolMs: 7000,
        title: d.folds ? t("kt_mg_fold_hammer") : t("kt_mg_hammer") }));
    } else if (step.kind === "construct") {
      box.appendChild(field(t("kt_f_construction"), radioList("con", D.CONSTRUCTIONS, d.construction, function (v) { setDraft(d, "construction", v); },
        { disabled: function (o) { return o.needsShingane && b.shinId === "none"; } })));
      box.appendChild(constructionDiagram(d.construction));
      box.appendChild(heatGame({ key: heatKey, win: Core.heatWindow(b, "weld"), daylight: false, title: t("kt_mg_weld") }));
      if (heatDone) box.appendChild(hammerGame({ key: hamKey, strikes: 6, speed: 2.4, zone: 0.12, coolMs: 6000, title: t("kt_mg_weld_hammer") }));
    } else if (step.kind === "sunobe") {
      var bt = Core.byId(D.BLADE_TYPES, b.type);
      box.appendChild(el("p", {}, [el("strong", { text: L(bt.name) }), "：" + L(bt.desc) + " " + t("kt_ideal_len", { lo: bt.ideal[0], hi: bt.ideal[1] })]));
      var need = el("div", { class: "kt-muted" });
      function updNeed() {
        need.textContent = t("kt_steel_need", { need: Core.steelNeeded(b, d.length).toFixed(2), have: b.steelKg.toFixed(2) }) +
          "（" + t("kt_shaku", { s: (d.length / 30.3).toFixed(2) }) + "）";
      }
      updNeed();
      box.appendChild(field(t("kt_f_length"), slider(bt.min, bt.max, 1, d.length, function (v) { return v + " cm"; }, function (v) { d.length = v; updNeed(); }), null));
      box.appendChild(need);
      box.appendChild(hammerGame({ key: hamKey, strikes: Core.HAMMER_STRIKES, speed: 2.2, zone: 0.14, coolMs: 8000, title: t("kt_mg_sunobe"), grow: true }));
    } else if (step.kind === "hizukuri") {
      var hbt = Core.byId(D.BLADE_TYPES, b.type);
      var preview = el("div", { class: "kt-preview" });
      function updPreview() {
        preview.innerHTML = "";
        var pb = Core.clone(b);
        pb.tsukuri = d.tsukuri; pb.kissaki = d.kissaki; pb.soriType = d.soriType; pb.mihaba = d.mihaba; pb.kasane = d.kasane;
        preview.appendChild(bladeSvg(pb, { sori: d.forgeSori }));
        preview.appendChild(el("div", { class: "kt-muted", text: t("kt_ratio", { r: (d.kasane / d.mihaba).toFixed(2) }) + "　" +
          t("kt_type_guide", { w0: hbt.width[0], w1: hbt.width[1], k0: hbt.kasane[0], k1: hbt.kasane[1], s0: hbt.sori[0], s1: hbt.sori[1] }) }));
      }
      updPreview();
      box.appendChild(preview);
      var byEdges = function (o) { return edgesOk(o, hbt); };
      box.appendChild(field(t("kt_f_tsukuri"), radioList("tsukuri", D.TSUKURI.filter(byEdges), d.tsukuri, function (v) { setDraft(d, "tsukuri", v); }, { recommend: hbt.tsukuri })));
      box.appendChild(field(t("kt_f_kissaki"), radioList("kissaki", D.KISSAKI.filter(byEdges), d.kissaki, function (v) { setDraft(d, "kissaki", v); }, { recommend: hbt.kissaki })));
      box.appendChild(field(t("kt_f_sori_type"), radioList("soriType", D.SORI_TYPES, d.soriType, function (v) { setDraft(d, "soriType", v); }, { recommend: hbt.soriType })));
      if (hbt.edges === 1) box.appendChild(field(t("kt_f_mune"), radioList("mune", D.MUNE, d.mune, function (v) { setDraft(d, "mune", v); }, { compact: true })));
      // 滑桿範圍依刀種：標準值上下各留餘裕（鞭劍的重不到 1mm，步進改 0.1）
      var wLo = Math.max(8, hbt.width[0] - 10), wHi = Math.min(90, hbt.width[1] + 10);
      var kLo = Math.max(0.3, Math.round(hbt.kasane[0] * 0.6 * 10) / 10), kHi = Math.min(15, Math.round(hbt.kasane[1] * 1.4 * 10) / 10);
      var sLo = Math.max(-150, hbt.sori[0] - 40), sHi = Math.min(300, hbt.sori[1] + 40);
      box.appendChild(field(t("kt_f_mihaba"), slider(wLo, wHi, 1, d.mihaba, function (v) { return v + " mm"; }, function (v) { d.mihaba = v; updPreview(); })));
      box.appendChild(field(t("kt_f_kasane"), slider(kLo, kHi, kHi < 3 ? 0.1 : 0.5, d.kasane, function (v) { return v + " mm"; }, function (v) { d.kasane = v; updPreview(); })));
      box.appendChild(field(t("kt_f_forge_sori"), slider(sLo, sHi, 1, d.forgeSori, function (v) { return v + " mm"; }, function (v) { d.forgeSori = v; updPreview(); }), t("kt_forge_sori_note")));
      box.appendChild(hammerGame({ key: hamKey, strikes: 10, speed: 2.6, zone: 0.12, coolMs: 7000, title: t("kt_mg_hizukuri") }));
    } else if (step.kind === "tsuchioki") {
      var pb2 = Core.clone(b);
      pb2.hamon = d.hamon === "none" ? null : d.hamon; pb2.ashi = d.ashi;
      box.appendChild(bladeSvg(pb2, { sori: b.forgeSori }));
      box.appendChild(field(t("kt_f_norm"), slider(0, 3, 1, d.norm, function (v) { return t("kt_times", { n: v }); }, function (v) { d.norm = v; })));
      box.appendChild(field(t("kt_f_hamon"), radioList("hamon", D.HAMON, d.hamon, function (v) { delete ui.mg[key("clay")]; setDraft(d, "hamon", v); })));
      if (d.hamon !== "none") {
        box.appendChild(field(t("kt_f_edge_clay"), radioList("edgeClay", D.CLAY_LEVELS, d.edgeClay, function (v) { setDraft(d, "edgeClay", v); }, { compact: true })));
        box.appendChild(field(t("kt_f_spine_clay"), radioList("spineClay", D.CLAY_LEVELS, d.spineClay, function (v) { setDraft(d, "spineClay", v); }, { compact: true })));
        box.appendChild(el("label", { class: "kt-check" }, [
          el("input", { type: "checkbox", checked: d.ashi, onchange: function (ev) { setDraft(d, "ashi", ev.target.checked); } }), " " + t("kt_f_ashi")
        ]));
        box.appendChild(clayGame({ key: key("clay"), hamon: d.hamon }));
      }
    } else if (step.kind === "aitori") {
      var bt2 = Core.byId(D.BLADE_TYPES, b.type) || D.BLADE_TYPES[2];
      var pv = el("div", { class: "kt-preview" });
      function updSori() {
        pv.innerHTML = "";
        pv.appendChild(bladeSvg(b, { sori: b.sori + d.soriAdjust }));
        pv.appendChild(el("div", { class: "kt-muted", text: t("kt_sori_now", { s: (b.sori + d.soriAdjust).toFixed(1), lo: bt2.sori[0], hi: bt2.sori[1], type: L(bt2.name) }) }));
      }
      updSori();
      box.appendChild(pv);
      if (state.assist) box.appendChild(el("div", { class: "kt-muted", text: t("kt_temper_goal", { h: b.hardEdge, lo: bt2.hrc[0], hi: bt2.hrc[1] }) }));
      box.appendChild(field(t("kt_f_temper_hours"), radioList("hours", D.TEMPER_HOURS.map(function (h) { return { id: h, name: { ja: h + " 時間", zh: h + " 小時" } }; }),
        d.hours, function (v) { setDraft(d, "hours", v); }, { compact: true })));
      box.appendChild(temperGame({ key: key("temper") }));
      box.appendChild(field(t("kt_f_sori_adjust"), slider(-5, 5, 0.5, d.soriAdjust, function (v) { return (v > 0 ? "+" : "") + v + " mm"; }, function (v) { d.soriAdjust = v; updSori(); })));
    } else if (step.kind === "togi") {
      var rng = Core.makeRng(state.seed + "|stones|" + pIndex);
      var shuffled = D.STONES.slice();
      for (var i = shuffled.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp; }
      var pool = el("div", { class: "kt-stones" });
      shuffled.forEach(function (s) {
        var used = d.order.indexOf(s.id) >= 0;
        pool.appendChild(el("button", { type: "button", class: "kt-stone", disabled: used, text: L(s.name),
          onclick: function () { d.order.push(s.id); rerenderKeepScroll(); } }));
      });
      box.appendChild(field(t("kt_f_stones"), pool));
      var seq = el("ol", { class: "kt-stone-seq" });
      d.order.forEach(function (id, k) {
        var s = Core.byId(D.STONES, id);
        seq.appendChild(el("li", {}, [L(s.name), " ", el("button", { type: "button", class: "kt-link", text: "×",
          onclick: function () { d.order.splice(k, 1); rerenderKeepScroll(); } })]));
      });
      box.appendChild(field(t("kt_f_stone_seq"), d.order.length ? seq : el("div", { class: "kt-muted", text: t("kt_stone_empty") })));
      box.appendChild(field(t("kt_f_edge"), radioList("edge", D.EDGE_GEOMETRY, d.edge, function (v) { setDraft(d, "edge", v); })));
      box.appendChild(rhythmGame({ key: key("rhythm"), strokes: 12 }));
    } else if (step.kind === "mei") {
      box.appendChild(field(t("kt_f_yasurime"), radioList("yasurime", D.YASURIME, d.yasurime, function (v) { setDraft(d, "yasurime", v); }, { compact: true })));
      box.appendChild(field(t("kt_f_nakagojiri"), radioList("nakagojiri", D.NAKAGOJIRI, d.nakagojiri, function (v) { setDraft(d, "nakagojiri", v); }, { compact: true })));
      var chiselDone = !!ui.mg[key("chisel")];
      box.appendChild(field(t("kt_f_mei"), el("input", { type: "text", class: "kt-text", maxlength: "20", value: d.mei, disabled: chiselDone,
        oninput: function (ev) { d.mei = ev.target.value; } }), t("kt_mei_note")));
      var pb3 = Core.clone(b);
      pb3.yasurime = d.yasurime;
      box.appendChild(bladeSvg(pb3));
      // 一字一鏨（至少 2 下：鑢目與目釘穴），最多 8 下
      var chars = Math.max(2, Math.min(8, Array.from(d.mei.trim()).length));
      box.appendChild(hammerGame({ key: key("chisel"), strikes: chars, speed: 2.8, zone: 0.1, coolMs: 1e9, chisel: true, text: d.mei.trim() || t("kt_mumei"),
        title: d.mei.trim() ? t("kt_mg_chisel") : t("kt_mg_chisel_mumei") }));
    }
    return box;
  }

  function constructionDiagram(id) {
    // 斷面示意：灰＝皮鐵（硬）、褐＝心鐵（軟）、藍＝刃鐵、紫＝背鐵（本三枚・四方詰）
    var shapes = {
      maru: '<polygon points="30,4 42,4 50,92 22,92" fill="#9aa4ad"/>',
      kobuse: '<polygon points="30,4 42,4 50,92 22,92" fill="#9aa4ad"/><polygon points="32,10 40,10 43,70 29,70" fill="#8a6a4a"/>',
      honsanmai: '<polygon points="30,4 42,4 50,92 22,92" fill="#9aa4ad"/><polygon points="31,14 41,14 45,70 27,70" fill="#8a6a4a"/><polygon points="27,70 45,70 50,92 22,92" fill="#6f8fb0"/>',
      shihozume: '<polygon points="30,4 42,4 50,92 22,92" fill="#9aa4ad"/><polygon points="31,4 41,4 41,14 31,14" fill="#8f6fa8"/><polygon points="32,14 40,14 43,70 29,70" fill="#8a6a4a"/><polygon points="27,70 45,70 50,92 22,92" fill="#6f8fb0"/>'
    };
    var html = '<svg viewBox="0 0 72 96" class="kt-section" xmlns="http://www.w3.org/2000/svg">' + (shapes[id] || shapes.kobuse) + "</svg>";
    return el("div", { class: "kt-section-wrap" }, [el("div", { html: html }), el("div", { class: "kt-muted", text: t("kt_section_legend") })]);
  }

  // 輔助模式：材料成分表
  function compTable(mat) {
    var keys = ["C", "Mn", "Si", "Ni", "Cr", "W", "P", "S"];
    return el("table", { class: "kt-status kt-comp" }, [
      el("tr", {}, keys.map(function (k) { return el("th", { text: k }); })),
      el("tr", {}, keys.map(function (k) { return el("td", { text: String(mat.comp[k] || 0) }); }))
    ]);
  }

  // 輔助模式：目前鋼材的變態點等冶金數值（Core.metal.metallurgy）
  function metalInfo(b) {
    var m = Core.metal.metallurgy(b);
    return el("div", { class: "kt-metal" }, [
      el("span", { text: "C " + m.C + "%" + (m.hyper ? t("kt_m_hyper") : t("kt_m_hypo")) }),
      el("span", { text: t("kt_m_solidus", { t: m.solidus }) }),
      el("span", { text: "Ac1 " + m.ac1 + "℃" }),
      el("span", { text: (m.hyper ? "Acm " + m.acm : "Ac3 " + m.ac3) + "℃" }),
      el("span", { text: "Ms " + m.ms + "℃" }),
      el("span", { text: t("kt_m_di", { d: m.di }) })
    ]);
  }

  // 刀的現況（輔助模式顯示數值，否則只顯示鍛冶的感覺）
  function bladeStatus(b) {
    var rows = [];
    function row(k, v) { rows.push(el("tr", {}, [el("th", { text: k }), el("td", { text: v })])); }
    if (b.type) row(t("kt_f_type"), L(Core.byId(D.BLADE_TYPES, b.type).name) + (b.length ? " " + b.length + " cm" : ""));
    if (b.kawaId) row(t("kt_s_material"), L(Core.byId(D.KAWAGANE, b.kawaId).name) + " / " + L(Core.byId(D.SHINGANE, b.shinId).name));
    if (b.kawaId) {
      if (state.assist) {
        row(t("kt_s_kawa"), b.kawaKg.toFixed(2) + " kg・C " + b.kawaC.toFixed(2) + "%・" + t("kt_s_imp", { n: Math.round(b.impurity) }));
        if (b.shinId !== "none") row(t("kt_s_shin"), b.shinKg.toFixed(2) + " kg・C " + b.shinC.toFixed(2) + "%");
      } else {
        row(t("kt_s_kawa"), b.kawaKg.toFixed(1) + " kg・" + t(b.kawaC > 0.8 ? "kt_feel_hard" : (b.kawaC >= 0.55 ? "kt_feel_good" : "kt_feel_soft")));
      }
    }
    if (b.folds) row(t("kt_s_folds"), t("kt_times", { n: b.folds }) + "・" + t("kt_s_layers", { n: b.layers.toLocaleString() }));
    if (b.construction) row(t("kt_f_construction"), L(Core.byId(D.CONSTRUCTIONS, b.construction).name));
    if (b.kasane) row(t("kt_s_size"), t("kt_s_size_v", { w: b.mihaba, k: b.kasane }));
    if (b.hardEdge) {
      row(t("kt_s_hard"), state.assist ? t("kt_s_hard_v", { e: b.hardEdge, s: b.hardSpine }) : t(b.hardEdge >= 56 ? "kt_feel_hard" : "kt_feel_soft"));
      if (state.assist) row(t("kt_s_micro"), t("kt_s_micro_v", { m: Math.round(b.edgeM * 100), ra: Math.round(b.retainedAus * 100), g: b.grain, ms: b.ms }));
    }
    if (b.sori || b.forgeSori) row(t("kt_s_sori"), (b.quenchTemp ? b.sori : b.forgeSori) + " mm");
    if (b.temperTemp) row(t("kt_s_temper"), L(Core.temperColorAt(b.temperTemp).name) + (state.assist ? "（" + b.temperTemp + "℃）" : ""));
    if (b.flaws.length) row(t("kt_s_flaws"), b.flaws.map(function (f) { return L(D.FLAWS[f].name); }).join("、"));
    return el("table", { class: "kt-status" }, rows);
  }

  // ---------------- 畫面：設定 ----------------

  function renderSetup() {
    var saved = load();
    var wrap = el("div", {});
    if (saved) {
      wrap.appendChild(el("div", { class: "kt-panel" }, [
        el("p", { text: t("kt_saved_found") }),
        el("div", { class: "kt-actions" }, [
          el("button", { type: "button", class: "kt-primary", text: t("kt_continue"), onclick: function () { state = saved; render(); } }),
          el("button", { type: "button", text: t("kt_discard_saved"), onclick: function () { localStorage.removeItem(STORAGE_KEY); render(); } })
        ])
      ]));
    }
    var panel = el("div", { class: "kt-panel" });
    panel.appendChild(el("h2", { text: t("kt_setup") }));
    panel.appendChild(el("p", { class: "kt-intro", text: t("kt_intro") }));
    var list = el("ol", { class: "kt-names" });
    setup.names.forEach(function (n, i) {
      list.appendChild(el("li", {}, [
        el("input", { type: "text", class: "kt-text", maxlength: "16", value: n, placeholder: t("kt_name_ph", { n: i + 1 }),
          oninput: function (ev) { setup.names[i] = ev.target.value; } }),
        setup.names.length > Core.MIN_PLAYERS ? el("button", { type: "button", class: "kt-link", text: t("kt_remove"),
          onclick: function () { setup.names.splice(i, 1); render(); } }) : null
      ]));
    });
    panel.appendChild(field(t("kt_players"), list));
    if (setup.names.length < Core.MAX_PLAYERS) {
      panel.appendChild(el("button", { type: "button", text: t("kt_add_player"), onclick: function () { setup.names.push(""); render(); } }));
    }
    panel.appendChild(field(t("kt_mode"), radioList("mode", [
      { id: "show", name: { ja: t("kt_mode_show"), zh: t("kt_mode_show") }, desc: { ja: t("kt_mode_show_desc"), zh: t("kt_mode_show_desc") } },
      { id: "serious", name: { ja: t("kt_mode_serious"), zh: t("kt_mode_serious") }, desc: { ja: t("kt_mode_serious_desc"), zh: t("kt_mode_serious_desc") } }
    ], setup.mode, function (v) { setup.mode = v; render(); })));
    panel.appendChild(el("label", { class: "kt-check" }, [
      el("input", { type: "checkbox", checked: setup.assist, onchange: function (ev) { setup.assist = ev.target.checked; } }),
      " " + t("kt_assist")
    ]));
    panel.appendChild(el("div", { class: "kt-muted", text: t("kt_assist_note") }));
    panel.appendChild(el("div", { class: "kt-actions" }, [
      el("button", { type: "button", class: "kt-primary", text: t("kt_start"), onclick: function () {
        state = Core.newGame({ names: setup.names.map(function (n, i) { return n.trim() || t("kt_name_ph", { n: i + 1 }); }), assist: setup.assist, mode: setup.mode });
        ui = { draft: {}, mg: {}, handoff: -1, result: null, confirmNew: false, error: "", cutResult: null, npc: null };
        save();
        render();
      } })
    ]));
    wrap.appendChild(panel);
    wrap.appendChild(flowOverview());
    app.appendChild(wrap);
  }

  function flowOverview() {
    var ol = el("ol", { class: "kt-flow" });
    D.STEPS.forEach(function (s) { ol.appendChild(el("li", {}, [el("strong", { text: L(s.name) }), "：" + L(s.summary)])); });
    return el("div", { class: "kt-panel" }, [el("h2", { text: t("kt_flow_title") }), ol, el("p", { class: "kt-muted", text: t("kt_flow_after") })]);
  }

  // ---------------- 畫面：鍛刀 ----------------

  function progressBar(p) {
    var bar = el("ol", { class: "kt-progress" });
    D.STEPS.forEach(function (s, i) {
      var skip = !Core.stepApplies(p.blade, s);
      bar.appendChild(el("li", { class: skip ? "kt-skip" : (i < p.step ? "kt-done" : (i === p.step ? "kt-now" : "")), title: L(s.name), text: L(s.name) }));
    });
    return bar;
  }

  function othersProgress() {
    if (state.players.length < 2) return null;
    return el("div", { class: "kt-others" }, state.players.map(function (p) {
      return el("span", { class: "kt-other", text: p.name + " " + Math.min(p.step, D.STEPS.length) + "/" + D.STEPS.length });
    }));
  }

  function renderForge() {
    // 剛完成一道工序：先顯示結果
    if (ui.result) {
      var rp = state.players[ui.result.pIndex];
      var rstep = Core.byId(D.STEPS, ui.result.stepId);
      var panel = el("div", { class: "kt-panel kt-result" }, [
        el("h2", { text: t("kt_result_title", { name: rp.name, step: L(rstep.name) }) }),
        el("ul", { class: "kt-notes" }, ui.result.notes.map(function (n) { return el("li", { text: L(n) }); })),
        bladeStatus(rp.blade),
        el("div", { class: "kt-actions" }, [el("button", { type: "button", class: "kt-primary", text: t("kt_next"), onclick: function () {
          ui.result = null; ui.error = "";
          window.scrollTo(0, 0);
          render();
        } })])
      ]);
      app.appendChild(panel);
      return;
    }
    var pIndex = Core.currentForger(state);
    var p = state.players[pIndex];
    if (state.players.length > 1 && ui.handoff !== pIndex) {
      app.appendChild(el("div", { class: "kt-panel kt-handoff" }, [
        el("h2", { text: t("kt_handoff", { name: p.name }) }),
        el("p", { text: t("kt_handoff_step", { step: L(D.STEPS[p.step].name), n: p.step + 1, total: D.STEPS.length }) }),
        othersProgress(),
        el("button", { type: "button", class: "kt-primary", text: t("kt_handoff_go"), onclick: function () { ui.handoff = pIndex; render(); } })
      ]));
      app.appendChild(footerTools());
      return;
    }
    var step = D.STEPS[p.step];
    app.appendChild(el("div", { class: "kt-turn" }, [el("strong", { text: p.name }), " — " + t("kt_step_n", { n: p.step + 1, total: D.STEPS.length }),
      el("span", { class: "kt-mode-badge kt-mode-" + (state.mode || "serious"), text: t("kt_mode_" + (state.mode || "serious")) })]));
    app.appendChild(progressBar(p));
    var main = el("div", { class: "kt-panel" });
    main.appendChild(el("h2", { text: L(step.name) }));
    main.appendChild(el("p", { text: L(step.summary) }));
    main.appendChild(el("details", { class: "kt-tips", open: true }, [
      el("summary", { text: t("kt_tips") }),
      el("ul", {}, step.tips.map(function (tp) { return el("li", { text: L(tp) }); }))
    ]));
    main.appendChild(stepControls(pIndex, step));
    var input = buildInput(pIndex, step);
    main.appendChild(el("div", { class: "kt-error", text: ui.error ? t(ui.error) : "" }));
    main.appendChild(el("div", { class: "kt-actions" }, [
      el("button", { type: "button", class: "kt-primary", text: t("kt_finish_step"), disabled: !input, onclick: function () {
        var res = Core.applyStep(state, pIndex, step.id, buildInput(pIndex, step));
        if (!res.ok) { ui.error = res.error; render(); return; }
        ui.error = "";
        ui.result = { pIndex: pIndex, stepId: step.id, notes: res.notes };
        save();
        window.scrollTo(0, 0);
        render();
      } }),
      !input ? el("span", { class: "kt-muted", text: t("kt_need_minigame") }) : null
    ]));
    app.appendChild(main);
    app.appendChild(el("div", { class: "kt-panel" }, [el("h2", { text: t("kt_blade_now") }), bladeStatus(p.blade), pastNotes(p)]));
    app.appendChild(footerTools());
  }

  function pastNotes(p) {
    if (!p.log.length) return null;
    return el("details", { class: "kt-log" }, [
      el("summary", { text: t("kt_log") }),
      el("ol", {}, p.log.map(function (e) {
        return el("li", {}, [el("strong", { text: L(Core.byId(D.STEPS, e.step).name) }), "：" + e.notes.map(L).join(" ")]);
      }))
    ]);
  }

  function footerTools() {
    var box = el("div", { class: "kt-footer-tools" });
    if (ui.confirmNew) {
      box.appendChild(el("span", { text: t("kt_confirm_new") }));
      box.appendChild(el("button", { type: "button", class: "kt-danger", text: t("kt_yes"), onclick: function () {
        state = null; save(); ui.confirmNew = false; render();
      } }));
      box.appendChild(el("button", { type: "button", text: t("kt_no"), onclick: function () { ui.confirmNew = false; render(); } }));
    } else {
      box.appendChild(el("button", { type: "button", class: "kt-link", text: t("kt_new_game"), onclick: function () { ui.confirmNew = true; render(); } }));
    }
    return box;
  }

  // ---------------- 畫面：審查 ----------------

  var SCORE_KEYS = ["jigane", "hamon", "sugata", "soundness", "finish"];

  function swordCard(p, rankNo, extra) {
    var b = p.blade, j = Core.judge(b), s = Core.stats(b);
    var card = el("div", { class: "kt-card" });
    card.appendChild(el("div", { class: "kt-card-head" }, [
      rankNo ? el("span", { class: "kt-rank", text: "#" + rankNo }) : null,
      el("strong", { text: p.name }),
      el("span", { class: "kt-grade", text: L(D.GRADES[j.grade].name) + "　" + j.total + t("kt_points") })
    ]));
    card.appendChild(bladeSvg(b, extra));
    var bt = Core.byId(D.BLADE_TYPES, b.type);
    card.appendChild(el("div", { class: "kt-card-sub", text: [
      b.mei ? "「" + b.mei + "」" : t("kt_mumei"),
      bt ? L(bt.name) : "", b.length + "cm", t("kt_s_sori") + " " + b.sori + "mm",
      L((Core.byId(D.HAMON, b.hamon) || {}).name), L((Core.byId(D.PATTERNS, b.pattern) || {}).name)
    ].join("・") }));
    var bars = el("div", { class: "kt-bars" });
    SCORE_KEYS.forEach(function (k) {
      var v = j.scores[k];
      var fill = el("div", { class: "kt-bar-fill" });
      fill.style.width = (v / 20 * 100) + "%";
      bars.appendChild(el("div", { class: "kt-bar-row" }, [
        el("span", { class: "kt-bar-label", text: t(k === "hamon" && j.heatTreat ? "kt_score_heat" : "kt_score_" + k) }),
        el("div", { class: "kt-bar" }, [fill]),
        el("span", { class: "kt-bar-val", text: v.toFixed(1) })
      ]));
    });
    card.appendChild(bars);
    card.appendChild(el("div", { class: "kt-stats" }, [
      el("span", { text: t("kt_st_hard") + " HRC " + s.hardness }),
      el("span", { text: t("kt_st_tough") + " " + s.toughness }),
      el("span", { text: t("kt_st_sharp") + " " + s.sharpness }),
      el("span", { text: t("kt_st_mass") + " " + s.mass + "kg" }),
      el("span", { text: t("kt_st_hp") + " " + s.integrity })
    ]));
    if (b.flaws.length) card.appendChild(el("div", { class: "kt-flaws", text: t("kt_s_flaws") + "：" + b.flaws.map(function (f) { return L(D.FLAWS[f].name); }).join("、") }));
    if (j.comments.length) card.appendChild(el("ul", { class: "kt-comments" }, j.comments.map(function (c) { return el("li", { text: L(c) }); })));
    return card;
  }

  function renderJudge() {
    var order = state.players.slice().sort(function (a, b) { return Core.judge(b.blade).total - Core.judge(a.blade).total; });
    app.appendChild(el("div", { class: "kt-panel" }, [el("h2", { text: t("kt_judge_title") }), el("p", { text: t("kt_judge_intro") })]));
    order.forEach(function (p, i) { app.appendChild(swordCard(p, state.players.length > 1 ? i + 1 : 0)); });
    app.appendChild(el("div", { class: "kt-panel" }, [
      el("p", { text: t("kt_cut_intro") }),
      el("div", { class: "kt-actions" }, [
        el("button", { type: "button", class: "kt-primary", text: t("kt_go_cut"), onclick: function () {
          Core.startCut(state); ui.cutResult = null; save(); window.scrollTo(0, 0); render();
        } })
      ])
    ]));
    app.appendChild(footerTools());
  }

  // ---------------- 畫面：試斬 ----------------

  function renderCut() {
    var turn = Core.cutTurn(state);
    app.appendChild(el("h2", { text: t("kt_cut_title") }));
    if (ui.cutResult) {
      var r = ui.cutResult, rp = state.players[r.pIndex], tg = Core.byId(D.TARGETS, r.res.target);
      var msg = r.res.broken ? t("kt_cut_broken_already") : (r.res.skipped ? t("kt_cut_skipped") : (r.res.cut ? t("kt_cut_ok") : t("kt_cut_fail")));
      var evs = r.res.events.map(function (e) { return t("kt_ev_" + e); });
      app.appendChild(el("div", { class: "kt-panel kt-result" }, [
        el("h3", { text: rp.name + "：" + L(tg.name) }),
        el("p", { class: r.res.cut ? "kt-good" : "kt-bad", text: msg + (r.res.points ? " +" + r.res.points : "") }),
        evs.length ? el("p", { class: "kt-bad", text: evs.join("、") }) : null,
        !r.res.skipped ? el("p", { class: "kt-muted", text: t("kt_cut_loss", { n: r.res.loss, hp: Math.max(0, state.cut.hp[rp.id]) }) }) : null,
        el("button", { type: "button", class: "kt-primary", text: t("kt_next"), onclick: function () { ui.cutResult = null; render(); } })
      ]));
      app.appendChild(cutTable());
      return;
    }
    if (!turn) {
      app.appendChild(cutTable());
      app.appendChild(clashSetup());
      app.appendChild(footerTools());
      return;
    }
    var p = turn.player, tg2 = turn.target, hp = state.cut.hp[p.id];
    var panel = el("div", { class: "kt-panel" });
    panel.appendChild(el("h3", { text: t("kt_cut_turn", { name: p.name, target: L(tg2.name), n: state.cut.target + 1, total: D.TARGETS.length }) }));
    panel.appendChild(el("p", { class: "kt-muted", text: t("kt_cut_hp", { hp: Math.max(0, hp) }) }));
    var key = "cut:" + state.cut.target + ":" + state.cut.turn;
    function commit(skip) {
      var mg = ui.mg[key];
      var res = Core.applyCut(state, mg ? mg.acc : 0, skip);
      ui.cutResult = { pIndex: turn.pIndex, res: res };
      save();
      render();
    }
    if (hp <= 0) {
      panel.appendChild(el("p", { text: t("kt_cut_broken_already") }));
      panel.appendChild(el("button", { type: "button", class: "kt-primary", text: t("kt_next"), onclick: function () { commit(true); } }));
    } else {
      panel.appendChild(hammerGame({ key: key, strikes: 1, speed: 3.4, zone: 0.07, coolMs: 1e9, title: t("kt_mg_swing"), swing: true }));
      panel.appendChild(el("div", { class: "kt-actions" }, [
        el("button", { type: "button", class: "kt-primary", text: t("kt_cut_do"), disabled: !ui.mg[key], onclick: function () { commit(false); } }),
        el("button", { type: "button", text: t("kt_cut_skip"), onclick: function () { commit(true); } })
      ]));
    }
    app.appendChild(panel);
    app.appendChild(cutTable());
  }

  function cutTable() {
    var head = el("tr", {}, [el("th", { text: "" })].concat(D.TARGETS.map(function (tg) { return el("th", { text: L(tg.name) }); }),
      [el("th", { text: t("kt_points") }), el("th", { text: t("kt_st_hp") })]));
    var rows = state.players.map(function (p) {
      var res = state.cut.results[p.id];
      return el("tr", {}, [el("th", { text: p.name })].concat(D.TARGETS.map(function (tg, i) {
        var r = res[i];
        var txt = !r ? "" : (r.skipped ? "—" : (r.cut ? "○" : "×")) + (r.events.indexOf("chip") >= 0 ? "⚠" : "") + (r.events.indexOf("break") >= 0 ? "✕" : "");
        return el("td", { text: txt });
      }), [el("td", { text: String(Core.cutPoints(state, p.id)) }), el("td", { text: String(Math.max(0, state.cut.hp[p.id])) })]));
    });
    return el("div", { class: "kt-panel kt-scroll" }, [el("table", { class: "kt-table" }, [head].concat(rows))]);
  }

  // ---------------- 畫面：互擊 ----------------

  function clashSetup() {
    if (!ui.npc) ui.npc = state.players.length < 2 ? { sato: true } : {};
    var panel = el("div", { class: "kt-panel" });
    panel.appendChild(el("h2", { text: t("kt_clash_title") }));
    panel.appendChild(el("p", { text: t("kt_clash_intro") }));
    D.NPC_SWORDS.forEach(function (n) {
      panel.appendChild(el("label", { class: "kt-check" }, [
        el("input", { type: "checkbox", checked: !!ui.npc[n.id], onchange: function (ev) { ui.npc[n.id] = ev.target.checked; render(); } }),
        " " + L(n.name)
      ]));
    });
    var npcIds = D.NPC_SWORDS.filter(function (n) { return ui.npc[n.id]; }).map(function (n) { return n.id; });
    var count = state.players.length + npcIds.length;
    panel.appendChild(el("div", { class: "kt-actions" }, [
      el("button", { type: "button", class: "kt-primary", text: t("kt_go_clash"), disabled: count < 2, onclick: function () {
        Core.startClash(state, npcIds); save(); window.scrollTo(0, 0); render();
      } }),
      count < 2 ? el("span", { class: "kt-muted", text: t("kt_clash_need2") }) : null
    ]));
    panel.appendChild(el("button", { type: "button", class: "kt-link", text: t("kt_skip_clash"), onclick: function () { state.phase = "end"; save(); render(); } }));
    return panel;
  }

  function fighterName(id) {
    if (id.indexOf("npc-") === 0) return L(Core.byId(D.NPC_SWORDS, id.slice(4)).name);
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === id) return state.players[i].name;
    return id;
  }

  function renderClash() {
    var cl = state.clash;
    app.appendChild(el("h2", { text: t("kt_clash_title") }));
    var list = el("div", { class: "kt-fighters" });
    cl.fighters.forEach(function (f) {
      var fill = el("div", { class: "kt-bar-fill" + (f.hp < f.maxHp * 0.3 ? " kt-bar-low" : "") });
      fill.style.width = Math.max(0, f.hp / f.maxHp * 100) + "%";
      var stance = null;
      if (!f.npc && f.alive && !cl.winner) {
        stance = el("div", { class: "kt-stance" }, ["go", "ju"].map(function (sv) {
          return el("button", { type: "button", class: "kt-chip" + (f.stance === sv ? " kt-chip-on" : ""), text: t("kt_stance_" + sv), title: t("kt_stance_" + sv + "_desc"),
            onclick: function () { f.stance = sv; save(); render(); } });
        }));
      }
      list.appendChild(el("div", { class: "kt-fighter" + (f.alive ? "" : " kt-fighter-out") + (cl.winner === f.id ? " kt-fighter-win" : "") }, [
        el("div", { class: "kt-fighter-name" }, [el("strong", { text: fighterName(f.id) }), f.alive ? null : " " + t("kt_broken"), cl.winner === f.id ? " 🏆" : null]),
        el("div", { class: "kt-bar" }, [fill]),
        el("div", { class: "kt-muted", text: t("kt_fighter_info", { hp: Math.round(Math.max(0, f.hp)), max: f.maxHp, c: f.chips, b: f.bends }) }),
        stance
      ]));
    });
    app.appendChild(el("div", { class: "kt-panel" }, [list]));
    if (!cl.winner) {
      app.appendChild(el("div", { class: "kt-actions" }, [
        el("button", { type: "button", class: "kt-primary", text: t("kt_clash_round"), onclick: function () { Core.clashRound(state); save(); render(); } }),
        el("button", { type: "button", text: t("kt_clash_auto"), onclick: function () {
          var g = 0;
          while (!state.clash.winner && g++ < 300) Core.clashRound(state);
          save(); render();
        } })
      ]));
    } else {
      app.appendChild(el("div", { class: "kt-panel kt-result" }, [
        el("h3", { text: t("kt_clash_winner", { name: fighterName(cl.winner) }) }),
        el("button", { type: "button", class: "kt-primary", text: t("kt_to_final"), onclick: function () { state.phase = "end"; save(); window.scrollTo(0, 0); render(); } })
      ]));
    }
    var log = el("ol", { class: "kt-clash-log", reversed: true });
    cl.log.slice().reverse().forEach(function (r) {
      var items = r.entries.map(function (e) {
        if (e.bye) return el("li", { text: t("kt_clash_bye", { name: fighterName(e.bye) }) });
        function evs(arr) { return arr.length ? "（" + arr.map(function (x) { return t("kt_ev_" + x); }).join("、") + "）" : ""; }
        return el("li", { text: t("kt_clash_entry", { a: fighterName(e.a), b: fighterName(e.b), da: e.da, db: e.db }) + evs(e.ea.concat(e.eb.map(function (x) { return x; }))) });
      });
      log.appendChild(el("li", {}, [el("strong", { text: t("kt_round", { n: r.round }) }), el("ul", {}, items)]));
    });
    if (cl.log.length) app.appendChild(el("div", { class: "kt-panel" }, [el("h3", { text: t("kt_log") }), log]));
    app.appendChild(footerTools());
  }

  // ---------------- 畫面：總結 ----------------

  function renderEnd() {
    var rows = Core.finalRanking(state);
    var head = el("tr", {}, ["", "kt_col_judge", "kt_col_cut", "kt_col_clash", "kt_col_total"].map(function (k) { return el("th", { text: k ? t(k) : "" }); }));
    var trs = rows.map(function (r, i) {
      return el("tr", {}, [el("th", { text: "#" + (i + 1) + " " + fighterName(r.id) }), el("td", { text: String(r.judge) }),
        el("td", { text: r.cut + " ×2" }), el("td", { text: "+" + r.clash }), el("td", { text: String(r.total) })]);
    });
    app.appendChild(el("div", { class: "kt-panel" }, [
      el("h2", { text: t("kt_final_title") }),
      el("p", { class: "kt-good", text: t("kt_final_winner", { name: fighterName(rows[0].id) }) }),
      el("div", { class: "kt-scroll" }, [el("table", { class: "kt-table" }, [head].concat(trs))]),
      el("p", { class: "kt-muted", text: t("kt_final_note") })
    ]));
    var placing = state.clash ? state.clash.fighters : [];
    rows.forEach(function (r) {
      var p = state.players.filter(function (x) { return x.id === r.id; })[0];
      var f = placing.filter(function (x) { return x.id === r.id; })[0];
      app.appendChild(swordCard(p, 0, f ? { chips: f.chips, broken: !f.alive } : null));
    });
    app.appendChild(el("div", { class: "kt-actions" }, [
      el("button", { type: "button", class: "kt-primary", text: t("kt_new_game"), onclick: function () { state = null; save(); render(); } })
    ]));
  }

  // ---------------- 主 render ----------------

  function render() {
    stopAnim();
    app.innerHTML = "";
    if (!state) { renderSetup(); return; }
    if (state.phase === "forge" || ui.result) renderForge(); // 最後一道工序的結果也要先看完再進審查
    else if (state.phase === "judge") renderJudge();
    else if (state.phase === "cut") renderCut();
    else if (state.phase === "clash") renderClash();
    else renderEnd();
  }

  state = null;
  window.addEventListener("i18n:change", render);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();

  // 測試用
  window.PriTestKatana = { _state: function () { return state; }, _ui: function () { return ui; }, _render: render };
})();
