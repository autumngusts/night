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
  var ui = freshUi();
  // 對刀・刀鞘相關的畫面狀態（不存檔）：arena 對刀場、duel 自由對刀、lobby 對刀準備、invite 收到的邀請
  function freshUi() {
    return { draft: {}, mg: {}, handoff: -1, result: null, confirmNew: false, error: "", cutResult: null, npc: null, scPick: null,
      arena: null, arenaKey: null, arenaSpeed: 1, duel: null, lobby: ui ? ui.lobby : null, invite: ui ? ui.invite : null, inviteKept: ui ? ui.inviteKept : false,
      inviteOpen: null, copyMsg: "", importText: "", importErr: false, confirmDel: null,
      lab: ui ? ui.lab : null, labOpen: ui ? ui.labOpen : false,
      room: ui ? ui.room : null, roomSword: ui ? ui.roomSword : null, duelDoneNo: ui ? ui.duelDoneNo : null };
  }
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
    var box = el("div", { class: "kt-mg kt-heat" + (cfg.daylight ? " kt-daylight" : ""), "data-live": res && (!cfg.plunge || res.delay !== undefined) ? null : "1" });
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
    var box = el("div", { class: "kt-mg kt-hammer", "data-live": res ? null : "1" });
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
    var box = el("div", { class: "kt-mg kt-stack", "data-live": res ? null : "1" });
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
    var box = el("div", { class: "kt-mg kt-clay", "data-live": res ? null : "1" });
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
    var box = el("div", { class: "kt-mg kt-temper", "data-live": res ? null : "1" });
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
    var nk = length * (bt.id === "yari" || bt.shaft ? 0.9 : (bt.family === "nihonto" ? 0.28 : 0.22));
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
    // 莖・柄（長柄兵器畫成木柄）
    svg += '<polygon points="' + pts(nkPts) + '" fill="' + (bt.shaft ? "#6b4a2a" : "#4f4237") + '" stroke="#2c241d" stroke-width="0.8"/>';
    if (bt.ringPommel) {
      var rp = center(-nk / length);
      svg += '<circle cx="' + (rp[0] - widthPx * 0.45).toFixed(1) + '" cy="' + (rp[1] + widthPx * 0.45).toFixed(1) + '" r="' + (widthPx * 0.55).toFixed(1) + '" fill="none" stroke="#8a6d25" stroke-width="2.4"/>';
    }
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
    // 九環刀：刀背的鐵環
    if (bt.rings) {
      for (var ri = 0; ri < bt.rings; ri++) {
        var ru = 0.1 + ri * (0.55 / Math.max(1, bt.rings - 1));
        var rpp = off(center(ru), normal(ru), widthAt(ru) * 0.2);
        svg += '<circle cx="' + rpp[0].toFixed(1) + '" cy="' + rpp[1].toFixed(1) + '" r="' + (widthPx * 0.13).toFixed(1) + '" fill="none" stroke="#c9a44a" stroke-width="1.4"/>';
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

  // 第二版小遊戲（katana_games.js）用的介面：動畫迴圈・鍵盤・完成時寫入成績
  function mgCtx(key) {
    return {
      el: el, t: t, L: L, tempColor: tempColor, result: ui.mg[key] || null,
      mode: state && state.mode === "serious" ? "serious" : "show",
      seed: (state ? state.seed : "x") + "|" + key,
      run: function (kind, frame, onKey) {
        stopAnim();
        var me = anim = { kind: kind };
        if (onKey) { me.onKey = onKey; document.addEventListener("keydown", onKey); }
        var last = performance.now();
        function loop(now) {
          if (anim !== me) return;
          var dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          if (frame(now, dt) === false || anim !== me) return; // 遊戲在這一格結束（done 會 stopAnim）
          me.id = requestAnimationFrame(loop);
        }
        me.id = requestAnimationFrame(loop);
      },
      stop: stopAnim,
      done: function (res) { stopAnim(); ui.mg[key] = res; rerenderKeepScroll(); }
    };
  }
  var Games = window.PriTestKatanaGames;

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
    [["chinese", "kt_f_type_chinese"], ["famous", "kt_f_type_famous"], ["rare", "kt_f_type_rare"]].forEach(function (g) {
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
      // 先水壓・小割：敲鋼餅上的弱點，裂痕一次次擴大後碎開；敲得準斷口才好判讀。之後碎片散在桌上逐片判讀分揀
      var miz = ui.mg[key("mizuheshi")];
      box.appendChild(Games.shatter(mgCtx(key("mizuheshi")), { title: t("kt_mg_mizuheshi"), pieces: Core.KOWARI_PIECES }));
      if (miz) box.appendChild(sortBoard(pIndex, b, d, miz, key("mizuheshi")));
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
      if (heatDone) box.appendChild(Games.music(mgCtx(hamKey), { title: d.folds ? t("kt_mg_fold_hammer") : t("kt_mg_hammer"),
        lanes: [t("kt_lane_yokoza"), t("kt_lane_saki_l"), t("kt_lane_saki_r")], hammer: true, coolMs: 7000 }));
    } else if (step.kind === "construct") {
      box.appendChild(field(t("kt_f_construction"), radioList("con", D.CONSTRUCTIONS, d.construction, function (v) { setDraft(d, "construction", v); },
        { disabled: function (o) { return o.needsShingane && b.shinId === "none"; } })));
      box.appendChild(constructionDiagram(d.construction));
      box.appendChild(heatGame({ key: heatKey, win: Core.heatWindow(b, "weld"), daylight: false, title: t("kt_mg_weld") }));
      if (heatDone) box.appendChild(Games.arc(mgCtx(hamKey), { title: t("kt_mg_weld_hammer"), strikes: state.mode === "serious" ? 8 : 6, coolMs: 6000 }));
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
      box.appendChild(Games.arc(mgCtx(hamKey), { title: t("kt_mg_sunobe"), strikes: Math.max(Core.HAMMER_STRIKES, state.mode === "serious" ? 10 : 8), coolMs: 8000, grow: true }));
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
      box.appendChild(Games.memory(mgCtx(hamKey), { title: t("kt_mg_hizukuri"), points: Games.bladePoints(), backdrop: "bar", coolMs: 7000 }));
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
      if (d.order.length || ui.mg[key("rhythm")]) {
        box.appendChild(Games.music(mgCtx(key("rhythm")), { title: t("kt_mg_rhythm"), lanes: [t("kt_lane_ha"), t("kt_lane_shinogi"), t("kt_lane_ji"), t("kt_lane_kissaki")],
          segments: d.order.map(function (id) { return L(Core.byId(D.STONES, id).name); }) }));
      } else box.appendChild(el("div", { class: "kt-muted", text: t("kt_togi_pick_first") }));
    } else if (step.kind === "mei") {
      box.appendChild(field(t("kt_f_yasurime"), radioList("yasurime", D.YASURIME, d.yasurime, function (v) { setDraft(d, "yasurime", v); }, { compact: true })));
      box.appendChild(field(t("kt_f_nakagojiri"), radioList("nakagojiri", D.NAKAGOJIRI, d.nakagojiri, function (v) { setDraft(d, "nakagojiri", v); }, { compact: true })));
      var chiselDone = !!ui.mg[key("chisel")];
      box.appendChild(field(t("kt_f_mei"), el("input", { type: "text", class: "kt-text", maxlength: "20", value: d.mei, disabled: chiselDone,
        oninput: function (ev) { d.mei = ev.target.value; } }), t("kt_mei_note")));
      var pb3 = Core.clone(b);
      pb3.yasurime = d.yasurime;
      box.appendChild(bladeSvg(pb3));
      // 鏨的順序：每個字左右兩個鏨位（無銘時是鑢目與目釘穴的 4 點），記住亮起的順序再依序敲
      var meiText = d.mei.trim();
      box.appendChild(Games.memory(mgCtx(key("chisel")), { title: meiText ? t("kt_mg_chisel") : t("kt_mg_chisel_mumei"),
        points: Games.platePoints(meiText), backdrop: "plate", text: Games.plateText(meiText).join("") }));
    }
    return box;
  }

  // 小割的分揀：碎片照碎開時散落的位置擺在桌上；點一片放大看斷口，再分到皮鐵／心鐵／捨棄
  function sortBoard(pIndex, b, d, miz, mkey) {
    var pieces = Core.kowariPieces(state, pIndex, miz.acc);
    var lay = miz.layout || Games.scatterLayout(mgCtx(mkey).seed, pieces.length);
    var selKey = "sort:" + pIndex;
    var sel = ui[selKey];
    if (sel === undefined || sel === null || d.picks[sel]) {
      sel = d.picks.indexOf(null);
      if (sel < 0) sel = ui[selKey] === undefined ? null : ui[selKey]; // 全部分完：保留目前檢視的那片（或不選）
      ui[selKey] = sel;
    }
    var left = d.picks.filter(function (x) { return x === null; }).length;
    var board = el("div", { class: "kt-sort-board" });
    pieces.forEach(function (pc, i) {
      var btn = el("button", { type: "button", class: "kt-shard-btn" + (sel === i ? " kt-shard-sel" : "") + (d.picks[i] ? " kt-shard-" + d.picks[i] : ""),
        "aria-label": t("kt_sort_piece", { n: i + 1 }), "data-i": String(i),
        onclick: function () { ui[selKey] = i; rerenderKeepScroll(); } }, [
        el("div", { class: "kt-piece-face kt-look-" + pc.look + " kt-sheen-" + pc.sheen + " kt-spots-" + pc.spots }),
        d.picks[i] ? el("span", { class: "kt-shard-tag", text: t("kt_tag_" + d.picks[i]) }) : null
      ]);
      btn.style.left = (lay[i][0] * 100) + "%"; btn.style.top = (lay[i][1] * 100) + "%";
      btn.style.transform = "translate(-50%, -50%) rotate(" + lay[i][2] + "deg)";
      board.appendChild(btn);
    });
    var insp;
    if (sel === null || sel === undefined) insp = el("div", { class: "kt-muted", text: t("kt_sort_all_done") });
    else {
      var pc = pieces[sel];
      var chips = el("div", { class: "kt-piece-picks" });
      [["kawa", "kt_pick_kawa"], ["shin", "kt_pick_shin"], ["discard", "kt_pick_discard"]].forEach(function (o) {
        if (o[0] === "shin" && b.shinId === "none") return;
        chips.appendChild(el("button", { type: "button", class: "kt-chip" + (d.picks[sel] === o[0] ? " kt-chip-on kt-chip-" + o[0] : ""), text: t(o[1]),
          onclick: function () {
            d.picks[sel] = o[0];
            var nx = -1;
            for (var k = 1; k <= d.picks.length; k++) { var j = (sel + k) % d.picks.length; if (d.picks[j] === null) { nx = j; break; } }
            ui[selKey] = nx < 0 ? null : nx;
            rerenderKeepScroll();
          } }));
      });
      insp = el("div", { class: "kt-piece kt-sort-insp" }, [
        el("div", { class: "kt-piece-face kt-piece-face-big kt-look-" + pc.look + " kt-sheen-" + pc.sheen + " kt-spots-" + pc.spots }),
        el("div", {}, [
          el("strong", { text: t("kt_sort_piece", { n: sel + 1 }) }),
          el("div", { class: "kt-piece-desc", text: t("kt_look_" + pc.look) + "・" + t("kt_sheen_" + pc.sheen) + "・" + t("kt_spots_" + pc.spots) }),
          state.assist ? el("div", { class: "kt-muted", text: "C≈" + pc.carbon.toFixed(2) + "%" }) : null,
          chips
        ])
      ]);
    }
    var counts = { kawa: 0, shin: 0, discard: 0 };
    d.picks.forEach(function (x) { if (x) counts[x]++; });
    return el("div", { class: "kt-mg kt-sort", "data-live": left ? "1" : null }, [
      el("div", { class: "kt-mg-title", text: t("kt_mg_sort") }),
      el("div", { class: "kt-muted", text: t("kt_sort_hint") }),
      board, insp,
      el("div", { class: "kt-muted", text: t("kt_sort_counts", { k: counts.kawa, s: counts.shin, x: counts.discard, n: left }) })
    ]);
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
    if (ui.room) wrap.appendChild(roomPanel());
    if (ui.invite) wrap.appendChild(invitePanel());
    // 預覽用（artifact）可把實驗場放最上面並展開：window.PRITEST_KATANA_LAB_FIRST
    var labFirst = !!window.PRITEST_KATANA_LAB_FIRST;
    if (labFirst) wrap.appendChild(labPanel(true));
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
        ui = freshUi();
        save();
        render();
      } })
    ]));
    if (ui.invite) {
      wrap.appendChild(lobbyPanel());
      wrap.appendChild(panel);
    } else {
      wrap.appendChild(panel);
      wrap.appendChild(lobbyPanel());
    }
    if (!ui.room) wrap.appendChild(netEntryPanel());
    if (!labFirst) wrap.appendChild(labPanel(false));
    wrap.appendChild(scabbardPanel());
    wrap.appendChild(specialsCatalog());
    wrap.appendChild(flowOverview());
    app.appendChild(wrap);
  }

  // 覺醒招式一覽：依分組列出名稱・覺醒條件・效果
  function specialsCatalog() {
    var box = el("details", { class: "kt-panel kt-catalog" }, [el("summary", { text: t("kt_sp_catalog", { n: D.SPECIALS.length }) }),
      el("p", { class: "kt-muted", text: t("kt_sp_catalog_note") })]);
    D.SPECIAL_GROUPS.forEach(function (g) {
      box.appendChild(el("h3", { text: L(g.name) }));
      box.appendChild(el("ul", { class: "kt-catalog-list" }, D.SPECIALS.filter(function (sp) { return sp.group === g.id; }).map(function (sp) {
        var dot = el("span", { class: "kt-af-dot" });
        dot.style.background = sp.color;
        return el("li", {}, [dot, el("strong", { text: L(sp.name) }), el("span", { class: "kt-muted", text: "　" + t("kt_sp_cond") + L(sp.cond) }), el("div", { text: L(sp.desc) })]);
      })));
    });
    return box;
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
    // 版面（使用者指定 2026-10-20）：最上方固定是小遊戲畫框，主標題與工序流程放在下方。
    // 畫框放「目前要玩的」小遊戲（data-live）；全部玩完時放最後一個的結果。已完成的其他小遊戲留在下方原位。
    var controls = stepControls(pIndex, step);
    var mgs = Array.prototype.slice.call(controls.querySelectorAll(".kt-mg"));
    var active = mgs.filter(function (m) { return m.getAttribute("data-live") === "1"; })[0] || mgs[mgs.length - 1] || null;
    var input = buildInput(pIndex, step);
    var stage = el("div", { class: "kt-stage" });
    stage.appendChild(el("div", { class: "kt-stage-head" }, [
      el("strong", { text: L(step.name) }),
      el("span", { class: "kt-muted", text: p.name + "・" + t("kt_step_n", { n: p.step + 1, total: D.STEPS.length }) }),
      el("span", { class: "kt-mode-badge kt-mode-" + (state.mode || "serious"), text: t("kt_mode_" + (state.mode || "serious")) })
    ]));
    stage.appendChild(active || el("div", { class: "kt-stage-empty", text: t("kt_stage_none") }));
    app.appendChild(stage);
    var main = el("div", { class: "kt-panel" });
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
    stage.appendChild(main.firstChild);
    stage.appendChild(main.firstChild);
    app.appendChild(el("div", { class: "kt-turn" }, [el("strong", { text: p.name }), " — " + t("kt_step_n", { n: p.step + 1, total: D.STEPS.length })]));
    app.appendChild(progressBar(p));
    main.appendChild(el("h2", { text: L(step.name) }));
    main.appendChild(el("p", { text: L(step.summary) }));
    main.appendChild(el("details", { class: "kt-tips", open: true }, [
      el("summary", { text: t("kt_tips") }),
      el("ul", {}, step.tips.map(function (tp) { return el("li", { text: L(tp) }); }))
    ]));
    main.appendChild(controls);
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
    Core.ensureSpecials(state);
    order.forEach(function (p, i) {
      var card = swordCard(p, state.players.length > 1 ? i + 1 : 0);
      card.appendChild(nameAndSheathe(p));
      app.appendChild(card);
    });
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

  // ---------------- 刀鞘（保存鍛好的刀，下次對刀直接拔出來用） ----------------
  // localStorage["pritest-katana-scabbard"] = { v: 1, swords: [{ uid, snap, guest, rec: { w, l }, saved }] }
  //   snap：Core.swordSnapshot()（+ uid：原主那把刀的 uid，邀請碼與匯出會帶著走）；guest＝從別人的邀請碼收下的刀
  //   uid：新收的刀是 "k" + 32 位 hex 亂數（舊資料的 "seed|玩家id"、"guest|hash" 照常有效）；
  //        客刀為 "guest|<原主 uid>"，同一把刀不管經過幾台裝置都認得出來
  var SCABBARD_KEY = "pritest-katana-scabbard";
  var SCABBARD_MAX = 50; // 使用者指定 2026-10-20（原 60）。滿了不再悄悄刪舊刀，改成擋下並提示
  var UID_RE = /^[A-Za-z0-9|_.:-]{1,100}$/;

  function scabbardLoad() {
    try {
      var s = JSON.parse(localStorage.getItem(SCABBARD_KEY) || "null");
      if (s && s.v === 1 && Array.isArray(s.swords)) return s;
    } catch (e) { /* 讀不到就當作空的 */ }
    return { v: 1, swords: [] };
  }

  function scabbardSave(sc) {
    try { localStorage.setItem(SCABBARD_KEY, JSON.stringify(sc)); } catch (e) { /* 私密模式等：只是記不住 */ }
  }

  function scabbardFind(uid) { return scabbardLoad().swords.filter(function (x) { return x.uid === uid; })[0] || null; }

  function scabbardFull() { return scabbardLoad().swords.length >= SCABBARD_MAX; }

  function newUid() {
    var b = new Uint8Array(16);
    try { window.crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
    return "k" + Array.prototype.map.call(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
  }

  // 收到的客刀用的 uid：快照有原主 uid 就用它，舊版邀請碼沒有時退回快照雜湊
  function guestUid(snap) { return "guest|" + (snap.uid || Core.hashStr(JSON.stringify(snap))); }

  // 邀請碼／匯出用：快照補上原主 uid（客刀沿用它原本的原主 uid）
  function snapWithUid(x) {
    var s = {};
    Object.keys(x.snap).forEach(function (k) { s[k] = x.snap[k]; });
    s.uid = x.guest ? (x.snap.uid || x.uid) : x.uid;
    return s;
  }

  // 回傳 null 或 "full"（刀鞘已滿且是新的刀：不收，由畫面提示）
  function sheathe(uid, snap, guest) {
    var sc = scabbardLoad();
    var old = sc.swords.filter(function (x) { return x.uid === uid; })[0];
    if (old) { old.snap = snap; old.saved = Date.now(); }
    else {
      if (sc.swords.length >= SCABBARD_MAX) return "full";
      sc.swords.unshift({ uid: uid, snap: snap, guest: !!guest, rec: { w: 0, l: 0 }, saved: Date.now() });
    }
    scabbardSave(sc);
    return null;
  }

  // ---- 整個刀鞘的匯出／匯入（帶 uid 與戰績，換裝置後接著用） ----
  // 檔案：{ kind: "pritest-katana-scabbard", v: 1, exported, swords: [...] }；刀鞘碼＝"KTSC1." + base64url(同一份 JSON)
  var SCABBARD_EXPORT_KIND = "pritest-katana-scabbard";
  var SCABBARD_CODE_PREFIX = "KTSC1.";

  function b64urlEncode(text) { return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function b64urlDecode(code) {
    var b64 = code.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return decodeURIComponent(escape(atob(b64)));
  }

  function scabbardExportJson() {
    var sc = scabbardLoad();
    return JSON.stringify({ kind: SCABBARD_EXPORT_KIND, v: 1, exported: Date.now(), swords: sc.swords.map(function (x) {
      return { uid: x.uid, snap: snapWithUid(x), guest: !!x.guest, rec: { w: x.rec.w, l: x.rec.l }, saved: x.saved };
    }) });
  }

  function scabbardExportCode() { return SCABBARD_CODE_PREFIX + b64urlEncode(scabbardExportJson()); }

  // 讀檔案內容或刀鞘碼 → 清理過的刀陣列；讀不出來回傳 null。資料不可信：每把刀都過 sanitizeSnap
  function parseScabbardExport(text) {
    var obj;
    try {
      var s = String(text || "").trim();
      if (s.indexOf(SCABBARD_CODE_PREFIX) === 0) s = b64urlDecode(s.slice(SCABBARD_CODE_PREFIX.length).replace(/\s+/g, ""));
      obj = JSON.parse(s);
    } catch (e) { return null; }
    if (!obj || obj.kind !== SCABBARD_EXPORT_KIND || obj.v !== 1 || !Array.isArray(obj.swords)) return null;
    function cnt(v) { v = Math.floor(Number(v)); return isFinite(v) ? Math.min(1e6, Math.max(0, v)) : 0; }
    var seen = {}, out = [];
    obj.swords.forEach(function (x) {
      if (!x || typeof x.uid !== "string" || !UID_RE.test(x.uid) || seen[x.uid]) return;
      var snap = sanitizeSnap(x.snap);
      if (!snap) return;
      seen[x.uid] = true;
      var saved = Number(x.saved);
      out.push({ uid: x.uid, snap: snap, guest: !!x.guest, rec: { w: cnt(x.rec && x.rec.w), l: cnt(x.rec && x.rec.l) }, saved: isFinite(saved) && saved > 0 ? saved : 0 });
    });
    return out;
  }

  // mode："merge"（同 uid：較新的快照、勝敗各取大；新刀加入）或 "replace"（整個取代）
  // 回傳 { added, updated, skipped }；skipped＝超過上限放不下的刀
  function scabbardImport(list, mode) {
    var sc = mode === "replace" ? { v: 1, swords: [] } : scabbardLoad();
    var r = { added: 0, updated: 0, skipped: 0 };
    var incoming = list.slice().sort(function (a, b) { return b.saved - a.saved; });
    incoming.forEach(function (x) {
      var old = sc.swords.filter(function (y) { return y.uid === x.uid; })[0];
      if (old) {
        if (x.saved > (old.saved || 0)) { old.snap = x.snap; old.saved = x.saved; }
        old.rec.w = Math.max(old.rec.w, x.rec.w);
        old.rec.l = Math.max(old.rec.l, x.rec.l);
        r.updated++;
      } else if (sc.swords.length >= SCABBARD_MAX) r.skipped++;
      else { sc.swords.push(x); r.added++; }
    });
    sc.swords.sort(function (a, b) { return (b.saved || 0) - (a.saved || 0); });
    scabbardSave(sc);
    return r;
  }

  function unsheathe(uid) {
    var sc = scabbardLoad();
    sc.swords = sc.swords.filter(function (x) { return x.uid !== uid; });
    scabbardSave(sc);
  }

  // 對刀結果寫進刀鞘的戰績。uidOf：{ 對刀場的 fighter id: 刀鞘 uid }
  function recordResult(res, uidOf) {
    var sc = scabbardLoad(), changed = false;
    sc.swords.forEach(function (x) {
      Object.keys(uidOf).forEach(function (fid) {
        if (uidOf[fid] !== x.uid) return;
        if (res.winner === fid) x.rec.w++; else x.rec.l++;
        changed = true;
      });
    });
    if (changed) scabbardSave(sc);
  }

  // 邀請碼：快照 JSON → base64url。可以貼整個邀請網址或只貼碼
  function encodeSnap(snap) {
    var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(snap))));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeSnap(text) {
    try {
      var code = String(text || "").trim();
      var m = code.match(/[?&#]duel=([A-Za-z0-9_-]+)/);
      if (m) code = m[1];
      var b64 = code.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      return sanitizeSnap(JSON.parse(decodeURIComponent(escape(atob(b64)))));
    } catch (e) { return null; }
  }

  // 收到的碼不可信：只留已知欄位，數值夾在合法範圍內
  function sanitizeSnap(s) {
    if (!s || s.v !== 1 || !s.stats || !Core.byId(D.BLADE_TYPES, s.type)) return null;
    function num(v, lo, hi, dflt) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt; }
    function pick(list, v) { return Core.byId(list, v) ? v : null; }
    var st = s.stats;
    var out = {
      v: 1, name: String(s.name || "").slice(0, 24), smith: String(s.smith || "").slice(0, 16), type: s.type,
      length: num(s.length, 10, 200, 70), sori: num(s.sori, -60, 300, 0), mihaba: num(s.mihaba, 5, 90, 30), kasane: num(s.kasane, 0.3, 15, 7),
      tsukuri: pick(D.TSUKURI, s.tsukuri), kissaki: pick(D.KISSAKI, s.kissaki), soriType: pick(D.SORI_TYPES, s.soriType),
      hamon: pick(D.HAMON, s.hamon), yasurime: pick(D.YASURIME, s.yasurime), mune: pick(D.MUNE, s.mune), pattern: pick(D.PATTERNS, s.pattern),
      kawaId: pick(D.KAWAGANE, s.kawaId), ashi: !!s.ashi, mei: String(s.mei || "").slice(0, 20), mode: s.mode === "show" ? "show" : "serious",
      edges: s.edges === 2 ? 2 : 1, wave: !!s.wave, crack: !!s.crack, special: Core.byId(D.SPECIALS, s.special) ? s.special : null,
      grade: Math.round(num(s.grade, 0, D.GRADES.length - 1, D.GRADES.length - 1)), total: num(s.total, 0, 100, 0),
      flaws: (Array.isArray(s.flaws) ? s.flaws : []).filter(function (f) { return !!D.FLAWS[f]; }).slice(0, 12),
      stats: { hardness: num(st.hardness, 20, 70, 50), toughness: num(st.toughness, 5, 100, 50), sharpness: num(st.sharpness, 0, 100, 50),
        mass: num(st.mass, 0.1, 5, 1), integrity: num(st.integrity, 20, 160, 80), chip: num(st.chip, 0.3, 2, 1) }
    };
    if (typeof s.uid === "string" && UID_RE.test(s.uid)) out.uid = s.uid;
    return out;
  }

  function inviteUrl(snap) { return location.href.split(/[?#]/)[0] + "?duel=" + encodeSnap(snap); }

  function snapTitle(snap) {
    var bt = Core.byId(D.BLADE_TYPES, snap.type);
    return (snap.name ? "「" + snap.name + "」" : "") + (bt ? L(bt.name) : "");
  }

  function npcName(n) { return L(n.name); }

  // 複製到剪貼簿；被拒絕時改成選取文字讓玩家自己複製
  function copyText(text, input) {
    function fallback() { if (input) { input.focus(); input.select(); } ui.copyMsg = t("kt_sc_copy_manual"); }
    try {
      navigator.clipboard.writeText(text).then(function () { ui.copyMsg = t("kt_sc_copied"); rerenderKeepScroll(); }, function () { fallback(); });
    } catch (e) { fallback(); }
  }

  // 刀的小卡（刀鞘列表、邀請、對刀準備用）
  function snapCard(snap, children, cls) {
    var prof = window.PriTestKatanaArena.profile(snap);
    var sp = snap.special ? Core.byId(D.SPECIALS, snap.special) : null;
    var s = snap.stats;
    return el("div", { class: "kt-sheath " + (cls || "") }, [
      el("div", { class: "kt-sheath-blade" }, [bladeSvg(snap)]),
      el("div", { class: "kt-sheath-body" }, [
        el("div", { class: "kt-sheath-title" }, [el("strong", { text: snapTitle(snap) }), snap.smith ? el("span", { class: "kt-muted", text: " " + t("kt_sc_by", { name: snap.smith }) }) : null]),
        el("div", { class: "kt-muted", text: L((D.GRADES[snap.grade] || D.GRADES[D.GRADES.length - 1]).name) + " " + snap.total + t("kt_points") + "・" + L(D.ARENA_STYLES[prof.style].name) +
          "・HRC " + s.hardness + "・" + t("kt_st_tough") + " " + s.toughness + "・" + t("kt_st_sharp") + " " + s.sharpness + "・" + t("kt_st_hp") + " " + s.integrity }),
        sp ? el("div", { class: "kt-sheath-special", title: L(sp.desc), text: t("kt_sp_has", { name: L(sp.name) }) }) : null,
        children && children.length ? el("div", { class: "kt-actions" }, children) : null
      ])
    ]);
  }

  // ---------------- 對刀場（畫面） ----------------
  // a：PriTestKatanaArena.create() 的狀態（保存在 ui，重新 render 也能接著打）。onEnd(result) 只會呼叫一次。
  // net：連線對刀的控制器（PriTestKatanaNet 的 matchCtl）。有的時候：只有自己的刀能放牌、放的牌在回合交界
  //      才由房主統一套用；每一步前問 net.canStep()；沒有暫停・加速・快轉。

  function arenaFighterLabel(f) {
    return f.name + (f.snap && f.snap.name ? "「" + f.snap.name + "」" : "");
  }

  // ---- 俯視的刀形（每把刀的辨識度）----
  // 以觸及半徑 r 為 1 的座標：刀尖在 +x。依刀種的身幅・反り・寬窄變化・波刃・長柄・護手・刀背環畫出剪影，
  // 柄卷用該刀的玩家色，一眼分得出是誰的刀、什麼刀種。結果快取在 f._glyph（對刀場物件，不存檔）。
  // 只用到 f.snap / f.prof.radius / f.rot / f.color，不碰對刀場狀態；美術參考圖工具也用它（_artRef）。
  function glyphOf(f) {
    if (f._glyph) return f._glyph;
    var snap = f.snap, bt = Core.byId(D.BLADE_TYPES, snap.type) || D.BLADE_TYPES[2];
    var dbl = bt.edges === 2, pole = !!bt.shaft || bt.id === "yari";
    var b0 = pole ? 0.45 : 0.06;
    var hw = Math.min(0.34, Math.max(0.07, (snap.mihaba || 30) / 190)); // 身幅誇張約 3 倍，縮小也看得出寬窄
    var sori = Math.max(-0.45, Math.min(1.2, (snap.sori || 0) / 80));
    var wave = bt.wave, N = 30, top = [], bot = [];
    for (var i = 0; i <= N; i++) {
      var u = i / N, x = b0 + (1 - b0) * u;
      var y = -sori * 0.4 * u * u;
      if (wave && u > 0.08 && u < 0.88) y += 0.04 * Math.sin((u - 0.08) / 0.8 * Math.PI * Math.min(wave.count, 9));
      var w = hw * (bt.profile === "widen" ? 0.75 + 0.7 * u : (bt.profile === "narrow" ? 1 - 0.5 * u : (bt.profile === "kukri" ? 0.8 + 0.5 * Math.sin(u * Math.PI * 0.9) : 1 - 0.25 * u)));
      if (u > 0.85) {
        var tt = (u - 0.85) / 0.15;
        w *= (snap.kissaki === "round" || snap.kissaki === "o") ? Math.sqrt(Math.max(0, 1 - tt * tt)) : 1 - tt;
      }
      if (dbl) { top.push([x, y - w / 2]); bot.push([x, y + w / 2]); }
      else { top.push([x, y - w * 0.3]); bot.push([x, y + w * 0.7]); }
    }
    f._glyph = { top: top, bot: bot, poly: top.concat(bot.slice().reverse()), b0: b0, pole: pole, hw: hw, dbl: dbl,
      guard: bt.family === "nihonto" ? "tsuba" : (bt.id === "hudie" ? "dguard" : "cross"),
      rings: bt.rings || 0, ringPommel: !!bt.ringPommel, hilt: pole ? 1.15 : 0.42, family: bt.family };
    return f._glyph;
  }

  function drawBlade(ctx, f, s) {
    var r = f.prof.radius * s, gl = glyphOf(f), px1 = (window.devicePixelRatio || 1) / r;
    function path(arr) { ctx.beginPath(); arr.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); }
    ctx.save();
    ctx.rotate(f.rot);
    ctx.scale(r, r);
    // 柄：長柄是木柄＋玩家色握把；刀劍是玩家色的柄卷
    ctx.fillStyle = gl.pole ? "#6b4a2a" : "#241a14";
    ctx.fillRect(-gl.hilt, -0.045, gl.hilt + gl.b0, 0.09);
    ctx.fillStyle = f.color;
    if (gl.pole) ctx.fillRect(-0.7, -0.055, 0.45, 0.11);
    else ctx.fillRect(-gl.hilt + 0.03, -0.055, gl.hilt - 0.05, 0.11);
    ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 1 * px1;
    for (var k = 0; k < 4; k++) { var hx = (gl.pole ? -0.68 : -gl.hilt + 0.06) + k * 0.09; ctx.beginPath(); ctx.moveTo(hx, -0.055); ctx.lineTo(hx + 0.05, 0.055); ctx.stroke(); }
    if (gl.ringPommel) { ctx.strokeStyle = "#c9a44a"; ctx.lineWidth = 2.4 * px1; ctx.beginPath(); ctx.arc(-gl.hilt - 0.07, 0, 0.07, 0, Math.PI * 2); ctx.stroke(); }
    // 刀身
    ctx.fillStyle = "#dfe6ec"; ctx.strokeStyle = "#4b545c"; ctx.lineWidth = 1 * px1;
    path(gl.poly); ctx.closePath(); ctx.fill(); ctx.stroke();
    // 刃的光（單刃只有刃側；雙刃兩側）
    ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = 1.3 * px1;
    path(gl.bot); ctx.stroke();
    if (gl.dbl) { path(gl.top); ctx.stroke(); }
    if (gl.rings) {
      ctx.strokeStyle = "#c9a44a"; ctx.lineWidth = 1.2 * px1;
      for (var ri = 0; ri < gl.rings; ri++) { var q = gl.top[Math.round((0.08 + ri * 0.06) * 30)]; ctx.beginPath(); ctx.arc(q[0], q[1] + 0.02, 0.025, 0, Math.PI * 2); ctx.stroke(); }
    }
    // 鍔（日本刀）／十字護手／D 形護手（蝴蝶雙刀）
    ctx.fillStyle = "#c9a44a"; ctx.strokeStyle = "#7a5d1f"; ctx.lineWidth = 1 * px1;
    if (gl.guard === "tsuba") { ctx.beginPath(); ctx.ellipse(gl.b0, 0, 0.035, Math.max(0.09, gl.hw * 0.95), 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    else {
      ctx.fillRect(gl.b0 - 0.02, -gl.hw * 1.6, 0.04, gl.hw * 3.2);
      if (gl.guard === "dguard") { ctx.strokeStyle = "#c9a44a"; ctx.lineWidth = 2 * px1; ctx.beginPath(); ctx.moveTo(gl.b0, gl.hw * 1.5); ctx.quadraticCurveTo(-gl.hilt * 0.5, gl.hw * 2.6, -gl.hilt, 0.06); ctx.stroke(); }
    }
    ctx.restore();
    ctx.fillStyle = f.color;
    ctx.beginPath(); ctx.arc(0, 0, Math.max(2.5, 3.5 * s), 0, Math.PI * 2); ctx.fill();
  }

  function arenaView(a, onEnd, net) {
    var Arena = window.PriTestKatanaArena;
    var wrap = el("div", { class: "kt-arena" });
    var hud = el("div", { class: "kt-arena-hud" });
    var roundTxt = el("strong", {});
    var btnPause = el("button", { type: "button", text: t("kt_ar_pause") });
    var btnSpeed = el("button", { type: "button", text: "×" + (ui.arenaSpeed || 1) });
    var btnSkip = el("button", { type: "button", text: t("kt_ar_skip") });
    var netTxt = el("span", { class: "kt-arena-net" });
    hud.appendChild(roundTxt);
    if (net) hud.appendChild(netTxt);
    else hud.appendChild(el("span", { class: "kt-arena-hud-btns" }, [btnPause, btnSpeed, btnSkip]));
    var canvas = el("canvas", { class: "kt-arena-canvas", width: "600", height: "600", "aria-label": t("kt_clash_title") });
    var feed = el("ol", { class: "kt-arena-feed" });
    var panels = el("div", { class: "kt-arena-panels" });
    // 寬螢幕：左邊場地、右邊各刀面板（邊看邊出牌）；窄螢幕上下排列
    wrap.appendChild(hud);
    wrap.appendChild(el("div", { class: "kt-arena-body" }, [
      el("div", { class: "kt-arena-left" }, [el("div", { class: "kt-arena-stage" }, [canvas]), feed]),
      panels
    ]));

    var vis = { parts: [], floats: [], rings: [], bolts: [], cuts: [], arcs: [], trails: {}, flash: null, cutin: null, banner: null, logAt: 0, ver: -1, barT: 0 };
    var paused = false;
    var ended = false;

    function hexRgb(h) { var n = parseInt(String(h).slice(1), 16); return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255); }
    function byF(id) { for (var i = 0; i < a.fighters.length; i++) if (a.fighters[i].id === id) return a.fighters[i]; return null; }
    function cardName(id) { var c = Arena.cardDef(id); return c ? L(c.name) : id; }

    // ----- 每把刀的面板：耐久・勢い・等待區・手牌 -----
    var bars = {};
    function buildPanels() {
      panels.innerHTML = "";
      a.fighters.forEach(function (f) {
        var hpFill = el("div", { class: "kt-bar-fill" });
        var spFill = el("div", { class: "kt-bar-fill kt-bar-spin" });
        bars[f.id] = { hp: hpFill, spin: spFill, hpTxt: el("span", { class: "kt-bar-val" }), spTxt: el("span", { class: "kt-bar-val" }) };
        var head = el("div", { class: "kt-af-head" }, [
          el("span", { class: "kt-af-dot" }),
          el("strong", { text: arenaFighterLabel(f) }),
          f.human && a.mode !== "shiai" ? null : el("span", { class: "kt-af-ai", text: a.mode === "shiai" ? t("kt_amode_auto") : "AI" }),
          net && net.mine(f.id) ? el("span", { class: "kt-af-me", text: t("kt_net_you") }) : null,
          !f.alive ? el("span", { class: "kt-bad", text: " " + t(f.out === "stall" ? "kt_ar_stalled" : "kt_broken") }) : null,
          a.winner === f.id ? el("span", { text: " 🏆" }) : null
        ]);
        head.firstChild.style.background = f.color;
        var traits = el("div", { class: "kt-af-traits" }, [el("span", { class: "kt-af-style", title: L(D.ARENA_STYLES[f.prof.style].desc), text: L(D.ARENA_STYLES[f.prof.style].name) })]
          .concat(f.prof.traits.map(function (tr) { return el("span", { class: "kt-af-trait", title: L(D.ARENA_TRAITS[tr].desc), text: L(D.ARENA_TRAITS[tr].name) }); })));
        var q = el("div", { class: "kt-af-queue" });
        // 連線：已放但還沒到回合交界的牌（pend）排在等待區後面
        var auto = a.mode === "shiai"; // 試合模式全自動：沒有人能放牌
        var mine = f.human && !auto && (!net || net.mine(f.id));
        var pend = net && mine ? net.pending(f.id) : [];
        function pendName(u) {
          if (u === "special") return f.special ? L(Core.byId(D.SPECIALS, f.special).name) : u;
          var h = f.hand.filter(function (x) { return x.uid === u; })[0];
          return h ? cardName(h.card) : u;
        }
        for (var i = 0; i < Arena.QUEUE; i++) {
          var it = f.queue[i], pu = !it ? pend[i - f.queue.length] : null;
          q.appendChild(el("div", { class: "kt-af-slot" + (it ? " kt-af-slot-on" + (it.special ? " kt-af-slot-sp" : "") : (pu ? " kt-af-slot-pending" : "")) },
            it ? [el("strong", { text: cardName(it.card) }), el("span", { class: "kt-muted", text: t("kt_ar_at", { n: it.at }) })]
              : pu ? [el("strong", { text: pendName(pu) }), el("span", { class: "kt-muted", text: t("kt_net_pending") })]
              : [el("span", { class: "kt-muted", text: t("kt_ar_slot_empty") })]));
        }
        var hand = el("div", { class: "kt-af-hand" });
        var canQueue = f.alive && !a.over && f.queue.length + pend.length < Arena.QUEUE;
        function play(uid) {
          if (net) { if (net.pick(a, f.id, uid)) buildPanels(); }
          else if (!Arena.queueCard(a, f.id, uid)) buildPanels();
        }
        if (mine) {
          f.hand.forEach(function (h) {
            var c = Arena.cardDef(h.card);
            hand.appendChild(el("button", { type: "button", class: "kt-card-btn kt-card-" + c.kind, disabled: !canQueue || pend.indexOf(h.uid) >= 0, title: L(c.desc), "data-card": h.card,
              onclick: function () { play(h.uid); } }, [
              el("strong", { text: L(c.name) }),
              el("span", { text: c.wait ? t("kt_ar_wait_n", { n: c.wait }) : t("kt_ar_wait_0") })
            ]));
          });
          if (f.special) {
            var spc = Core.byId(D.SPECIALS, f.special);
            hand.appendChild(el("button", { type: "button", class: "kt-card-btn kt-card-special", disabled: !canQueue || f.specialUsed || pend.indexOf("special") >= 0, title: L(spc.desc), "data-card": "special",
              onclick: function () { play("special"); } }, [
              el("strong", { text: L(spc.name) }),
              el("span", { text: f.specialUsed ? t("kt_ar_used") : t("kt_ar_wait_n", { n: D.SPECIAL_WAIT }) })
            ]));
          }
        } else if (auto) {
          hand.appendChild(el("span", { class: "kt-muted", text: t("kt_ar_auto_hand", { n: f.hand.length }) + (f.special ? "・" + t("kt_sp_has", { name: L(Core.byId(D.SPECIALS, f.special).name) }) + (f.specialUsed ? t("kt_ar_used_paren") : "") : "") }));
        } else if (f.human) {
          hand.appendChild(el("span", { class: "kt-muted", text: t("kt_net_other_hand", { n: f.hand.length }) }));
        } else {
          hand.appendChild(el("span", { class: "kt-muted", text: t("kt_ar_ai_hand", { n: f.hand.length }) + (f.special ? "・" + t("kt_sp_has", { name: L(Core.byId(D.SPECIALS, f.special).name) }) + (f.specialUsed ? t("kt_ar_used_paren") : "") : "") }));
        }
        panels.appendChild(el("div", { class: "kt-af" + (f.alive ? "" : " kt-af-out") + (a.winner === f.id ? " kt-af-win" : ""), "data-fid": f.id }, [
          head, traits,
          el("div", { class: "kt-bar-row" }, [el("span", { class: "kt-bar-label", text: t("kt_st_hp") }), el("div", { class: "kt-bar" }, [hpFill]), bars[f.id].hpTxt]),
          el("div", { class: "kt-bar-row" }, [el("span", { class: "kt-bar-label", text: t("kt_ar_spin") }), el("div", { class: "kt-bar" }, [spFill]), bars[f.id].spTxt]),
          el("div", { class: "kt-af-label", text: t("kt_ar_queue") }), q,
          el("div", { class: "kt-af-label", text: f.human ? t("kt_ar_hand") : "" }), hand
        ]));
      });
      vis.ver = a.ver;
      updateBars();
    }
    function updateBars() {
      a.fighters.forEach(function (f) {
        var b = bars[f.id];
        if (!b) return;
        b.hp.style.width = Math.max(0, f.hp / f.prof.maxHp * 100) + "%";
        b.hp.className = "kt-bar-fill" + (f.hp < f.prof.maxHp * 0.3 ? " kt-bar-low" : "");
        b.spin.style.width = Math.max(0, f.spin * 100) + "%";
        b.hpTxt.textContent = Math.round(f.hp) + "/" + f.prof.maxHp;
        b.spTxt.textContent = Math.round(f.spin * 100) + "%";
      });
      roundTxt.textContent = a.over ? t("kt_ar_over") : t("kt_ar_round", { n: a.round, max: Arena.MAX_ROUNDS, s: (Arena.ROUND_S - (a.time % Arena.ROUND_S)).toFixed(1) });
      if (net) {
        var wait = net.startIn();
        netTxt.textContent = net.hostGone ? t("kt_net_host_gone") : wait > 0 ? t("kt_net_countdown", { s: Math.ceil(wait / 1000) })
          : net.waiting === "players" ? t("kt_net_wait_players") : net.waiting === "host" ? t("kt_net_wait_host") : "";
        netTxt.className = "kt-arena-net" + (net.hostGone ? " kt-error" : "");
      }
    }

    // ----- 文字戰況 -----
    function updateFeed() {
      while (vis.logAt < a.log.length) {
        var e = a.log[vis.logAt++], txt = null;
        if (e.type === "bind") txt = t("kt_ar_log_bind", { a: arenaFighterLabel(byF(e.a)), b: arenaFighterLabel(byF(e.b)) });
        else if (e.type === "card") txt = t("kt_ar_log_card", { f: arenaFighterLabel(byF(e.f)), card: cardName(e.card) });
        else if (e.type === "break") txt = t("kt_ar_log_break", { f: arenaFighterLabel(byF(e.f)) });
        else if (e.type === "stall") txt = t("kt_ar_log_stall", { f: arenaFighterLabel(byF(e.f)) });
        if (!txt) continue;
        feed.insertBefore(el("li", { text: txt }), feed.firstChild);
        while (feed.childNodes.length > 6) feed.removeChild(feed.lastChild);
      }
    }

    // ----- 特效 -----
    function addSparks(x, y, n, kind) {
      for (var i = 0; i < n; i++) {
        var ang = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 120;
        vis.parts.push({ x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0.25 + Math.random() * 0.3, max: 0.55, kind: kind || "spark" });
      }
    }
    function consumeEvents() {
      a.events.forEach(function (e) {
        // 武士風的特效（與下方的基本效果疊加）
        if (e.type === "slash" || e.type === "mikiri") {
          var ca = Math.random() * Math.PI;
          vis.cuts.push({ x: e.x, y: e.y, ang: ca, len: 60, life: 0.32, max: 0.32, color: e.color ? hexRgb(e.color) : "255,255,255" });
          if (e.type === "mikiri") { vis.cuts.push({ x: e.x, y: e.y, ang: ca + Math.PI / 2, len: 50, life: 0.32, max: 0.32, color: "255,255,255" }); vis.floats.push({ x: e.x, y: e.y - 22, text: t("kt_ar_fx_mikiri"), life: 1, max: 1, color: "#ffffff", big: true }); }
        }
        if (e.type === "bloom") { addSparks(e.x, e.y, 30, "petal"); vis.rings.push({ x: e.x, y: e.y, r: 6, grow: 70, life: 0.45, max: 0.45, color: "255,170,200", thick: 4 }); }
        if (e.type === "sakura") addSparks(e.x, e.y, 24, "petal");
        if (e.type === "fubuki") { addSparks(e.x, e.y, 50, "snow"); vis.rings.push({ x: e.x, y: e.y, r: 10, grow: e.r, life: 0.6, max: 0.6, color: "220,240,255", thick: 6 }); }
        if (e.type === "iai") {
          vis.arcs.push({ x: e.x, y: e.y, r: e.r, a0: Math.random() * Math.PI * 2, life: 0.45, max: 0.45 });
          vis.flash = { life: 0.18, max: 0.18 };
          vis.floats.push({ x: e.x, y: e.y - 26, text: t("kt_ar_fx_zan"), life: 1, max: 1, color: "#ffffff", big: true });
        }
        if (e.type === "card" && Core.byId(D.SPECIALS, e.card)) {
          var spc = Core.byId(D.SPECIALS, e.card), cf = byF(e.f);
          vis.cutin = { text: L(spc.name), who: cf ? arenaFighterLabel(cf) : "", color: spc.color, life: 1.3, max: 1.3 };
        }
        if (e.type === "spark") { addSparks(e.x, e.y, 8, e.fire ? "fire" : (e.momiji ? "leaf" : "spark")); if (Math.random() < 0.35) vis.rings.push({ x: e.x, y: e.y, r: 2, grow: 16, life: 0.12, max: 0.12, color: "255,245,200" }); }
        else if (e.type === "bind") { addSparks(e.x, e.y, 34, "spark"); vis.rings.push({ x: e.x, y: e.y, r: 6, grow: 90, life: 0.35, max: 0.35, color: "255,230,150" }); }
        else if (e.type === "release") vis.rings.push({ x: e.x, y: e.y, r: 4, grow: 140, life: 0.3, max: 0.3, color: "255,255,255" });
        else if (e.type === "tick" || e.type === "wall") addSparks(e.x, e.y, 4, "spark");
        else if (e.type === "hit" && e.n >= 2) vis.floats.push({ x: e.x, y: e.y - 12, text: "-" + e.n, life: 0.9, max: 0.9, color: e.kind === "burn" ? "#ff8a3d" : (e.kind === "bleed" ? "#e04848" : (e.kind === "sakura" || e.kind === "kaika" ? "#ff9fc8" : e.kind === "fubuki" ? "#cfe8ff" : e.kind === "poison" ? "#b57cff" : (e.kind === "reflect" ? "#ffcf6a" : "#fff"))) });
        else if (e.type === "card") { var f = byF(e.f); vis.floats.push({ x: e.x, y: e.y - 26, text: cardName(e.card), life: 1.4, max: 1.4, color: f ? f.color : "#fff", big: true }); }
        else if (e.type === "mikiri" || e.type === "slash") { vis.rings.push({ x: e.x, y: e.y, r: 10, grow: 160, life: 0.3, max: 0.3, color: e.color ? hexRgb(e.color) : "220,240,255" }); addSparks(e.x, e.y, 14, "spark"); }
        else if (e.type === "strike") { vis.rings.push({ x: e.x, y: e.y, r: 8, grow: Math.min(e.r, Arena.R * 1.1), life: 0.5, max: 0.5, color: hexRgb(e.color || "#ffffff"), thick: 5 }); addSparks(e.x, e.y, 20, "spark"); }
        else if (e.type === "heal") vis.floats.push({ x: e.x, y: e.y - 12, text: "+" + e.n, life: 1.1, max: 1.1, color: "#7be08f", big: true });
        else if (e.type === "evade") vis.rings.push({ x: e.x, y: e.y, r: 6, grow: 30, life: 0.25, max: 0.25, color: "230,240,255" });
        else if (e.type === "dispel") vis.floats.push({ x: e.x, y: e.y - 16, text: t("kt_ar_dispel"), life: 1.1, max: 1.1, color: "#e0e0ff" });
        else if (e.type === "iai") vis.rings.push({ x: e.x, y: e.y, r: e.r * 0.5, grow: e.r * 2, life: 0.35, max: 0.35, color: "255,255,255", thick: 4 });
        else if (e.type === "lightning") vis.bolts.push({ x: e.x, y: e.y, x2: e.x2, y2: e.y2, life: 0.4, max: 0.4, color: e.color ? hexRgb(e.color) : "200,220,255" });
        else if (e.type === "meteor") { vis.rings.push({ x: e.x, y: e.y, r: 4, grow: e.r * 3, life: 0.45, max: 0.45, color: "255,150,60", thick: 5 }); addSparks(e.x, e.y, 26, "fire"); }
        else if (e.type === "break") { addSparks(e.x, e.y, 30, "shard"); vis.floats.push({ x: e.x, y: e.y - 20, text: t("kt_broken"), life: 1.6, max: 1.6, color: "#ff6a5a", big: true }); }
        else if (e.type === "stall") vis.floats.push({ x: e.x, y: e.y - 20, text: t("kt_ar_stalled"), life: 1.6, max: 1.6, color: "#c9c9c9", big: true });
        else if (e.type === "chip") addSparks(e.x, e.y, 10, "shard");
        else if (e.type === "round") vis.banner = { text: t("kt_ar_round_banner", { n: e.n }), life: 1.1, max: 1.1 };
        else if (e.type === "block") vis.rings.push({ x: e.x, y: e.y, r: 18, grow: 20, life: 0.3, max: 0.3, color: "255,215,90" });
      });
      a.events = [];
    }

    // ----- 繪圖 -----
    function drawFrame() {
      var cssW = canvas.clientWidth || 360;
      var dpr = window.devicePixelRatio || 1;
      var px = Math.round(cssW * dpr);
      if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
      var ctx = canvas.getContext("2d");
      var s = px / (2 * Arena.R + 24);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, px, px);
      ctx.translate(px / 2, px / 2);
      // 場地：碗形的土俵，外圈是注連縄
      var g = ctx.createRadialGradient(0, 0, 10 * s, 0, 0, Arena.R * s);
      g.addColorStop(0, "#5a4a3b"); g.addColorStop(1, "#231c16");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, Arena.R * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,240,220,0.06)";
      ctx.lineWidth = 1 * dpr;
      [0.3, 0.55, 0.8].forEach(function (k) { ctx.beginPath(); ctx.arc(0, 0, Arena.R * k * s, 0, Math.PI * 2); ctx.stroke(); });
      ctx.strokeStyle = "rgba(255,240,220,0.12)";
      ctx.beginPath(); ctx.arc(0, 0, 8 * s, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 7 * s;
      ctx.strokeStyle = "#c9a65a";
      ctx.beginPath(); ctx.arc(0, 0, (Arena.R + 3) * s, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([5 * s, 5 * s]);
      ctx.strokeStyle = "#8a6d33";
      ctx.lineWidth = 3 * s;
      ctx.beginPath(); ctx.arc(0, 0, (Arena.R + 3) * s, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // 流星落下預告
      a.hazards.forEach(function (hz) {
        ctx.strokeStyle = "rgba(255,140,60," + (0.3 + 0.5 * Math.abs(Math.sin(a.time * 12))) + ")";
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.arc(hz.x * s, hz.y * s, hz.r * s, 0, Math.PI * 2); ctx.stroke();
      });
      // 試合：刀光路徑。預告中是逐漸變亮的虛線，斬擊中是從起點到刀身的光跡
      a.fighters.forEach(function (f) {
        if (!f.alive || !f.sh || (f.sh.st !== "aim" && f.sh.st !== "slash")) return;
        var sh = f.sh;
        ctx.save();
        ctx.lineCap = "round";
        if (sh.st === "aim") {
          var p = 1 - Math.max(0, sh.t) / Arena.SHIAI.AIM;
          ctx.globalAlpha = 0.25 + 0.55 * p;
          ctx.strokeStyle = f.color; ctx.lineWidth = 2 * dpr;
          ctx.setLineDash([6 * dpr, 6 * dpr]);
          ctx.beginPath(); ctx.moveTo(sh.x0 * s, sh.y0 * s); ctx.lineTo(sh.x1 * s, sh.y1 * s); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = f.color;
          ctx.beginPath(); ctx.arc(sh.x1 * s, sh.y1 * s, 3 * dpr, 0, Math.PI * 2); ctx.fill();
        } else {
          var g = ctx.createLinearGradient(sh.x0 * s, sh.y0 * s, f.x * s, f.y * s);
          g.addColorStop(0, "rgba(255,255,255,0)");
          g.addColorStop(1, "rgba(255,255,255,0.85)");
          ctx.strokeStyle = g; ctx.lineWidth = 4 * dpr;
          ctx.beginPath(); ctx.moveTo(sh.x0 * s, sh.y0 * s); ctx.lineTo(f.x * s, f.y * s); ctx.stroke();
          ctx.globalAlpha = 0.25;
          ctx.strokeStyle = f.color; ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath(); ctx.moveTo(f.x * s, f.y * s); ctx.lineTo(sh.x1 * s, sh.y1 * s); ctx.stroke();
        }
        ctx.restore();
      });
      // 退場的刀：倒在原地
      a.fighters.forEach(function (f) {
        if (f.alive) return;
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.translate(f.x * s, f.y * s);
        drawBlade(ctx, f, s);
        ctx.restore();
      });
      a.fighters.forEach(function (f) {
        if (!f.alive) return;
        ctx.save();
        ctx.translate(f.x * s, f.y * s);
        var r = f.prof.radius * s;
        // 招式的光環：覺醒招式依各自顏色（D.SPECIALS[].color）
        f.buffs.forEach(function (bf, bi) {
          ctx.globalAlpha = 0.22 + 0.1 * Math.sin(a.time * 10 + bi);
          ctx.fillStyle = bf.color || "#fff";
          ctx.beginPath(); ctx.arc(0, 0, r * (bf.reach || 1) * (1.2 + 0.08 * bi), 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
          if (bf.invuln) { ctx.strokeStyle = bf.color; ctx.lineWidth = 3 * dpr; ctx.beginPath(); ctx.arc(0, 0, r + 8 * s, 0, Math.PI * 2); ctx.stroke(); }
        });
        if (Arena.bany(f, "evade")) ctx.globalAlpha = 0.55 + 0.25 * Math.sin(a.time * 14);
        if (f.fx.momiji > 0) { ctx.fillStyle = "rgba(220,60,40,0.18)"; ctx.beginPath(); ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2); ctx.fill(); }
        if (Arena.bany(f, "vortex")) {
          ctx.strokeStyle = "rgba(170,200,255,0.5)"; ctx.lineWidth = 2 * dpr;
          for (var k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(0, 0, r * (1.4 + k * 0.5), a.time * 4 + k, a.time * 4 + k + 2); ctx.stroke(); }
        }
        var ring = f.fx.guard > 0 ? "rgba(110,170,255,0.8)" : (f.fx.mikiri > 0 ? "rgba(255,255,255,0.85)" : null);
        if (ring) {
          ctx.strokeStyle = ring; ctx.lineWidth = 2.5 * dpr;
          if (f.fx.mikiri > 0 && !f.fx.guard) ctx.setLineDash([4 * dpr, 4 * dpr]);
          ctx.beginPath(); ctx.arc(0, 0, r + 6 * s, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        }
        if (f.fx.iaiHold > 0) { ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(0, 0, r * 3.5 * (1 - f.fx.iaiHold), 0, Math.PI * 2); ctx.stroke(); }
        // 耐久環
        ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 3 * dpr;
        ctx.beginPath(); ctx.arc(0, 0, r + 2.5 * s, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = f.color;
        ctx.beginPath(); ctx.arc(0, 0, r + 2.5 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, f.hp / f.prof.maxHp)); ctx.stroke();
        // 刀身（勢い越低轉越慢、越晃）
        if (f.fx.stun > 0) ctx.translate(Math.sin(a.time * 60) * 2 * s, 0);
        var bd = null;
        a.binds.forEach(function (x) { if (x.a === f || x.b === f) bd = x; });
        if (bd) {
          var op = bd.a === f ? bd.b : bd.a;
          f.rot = Math.atan2(op.y - f.y, op.x - f.x) + Math.sin(a.time * 38 + (bd.a === f ? 0 : 1.7)) * 0.12;
        }
        var tr = vis.trails[f.id] || (vis.trails[f.id] = []);
        var fast = f.sh ? f.sh.st === "slash" : (f.fx.issen > 0 || f.fx.dash > 0 || Arena.bany(f, "speed") && Math.hypot(f.vx, f.vy) > 70);
        if (fast) { tr.push({ x: f.x, y: f.y, rot: f.rot }); if (tr.length > 7) tr.shift(); } else if (tr.length) tr.shift();
        var keepA = ctx.globalAlpha;
        tr.forEach(function (gp, gi) {
          ctx.save();
          ctx.translate((gp.x - f.x) * s, (gp.y - f.y) * s);
          ctx.globalAlpha = keepA * 0.08 * (gi + 1);
          var rot0 = f.rot; f.rot = gp.rot; drawBlade(ctx, f, s); f.rot = rot0;
          ctx.restore();
        });
        ctx.globalAlpha = keepA;
        // 試合的收刀：刀身縮短、稍淡
        if (f.sh && f.sh.st === "sheathe") { ctx.globalAlpha = keepA * 0.8; ctx.scale(0.65, 0.65); }
        drawBlade(ctx, f, s);
        ctx.globalAlpha = 1;
        ctx.restore();
        // 落櫻斬：中招的刀身邊飄著櫻花；吹雪斬：凍僵時有雪
        if (f.dots.some(function (d) { return d.kind === "sakura"; }) && Math.random() < 0.4) vis.parts.push({ x: f.x + (Math.random() - 0.5) * 26, y: f.y - 14, vx: (Math.random() - 0.5) * 16, vy: 22, life: 0.7, max: 0.7, kind: "petal" });
        if (f.fx.slow > 0 && Math.random() < 0.3) vis.parts.push({ x: f.x + (Math.random() - 0.5) * 26, y: f.y + (Math.random() - 0.5) * 26, vx: 0, vy: 6, life: 0.6, max: 0.6, kind: "snow" });
        if (f.fx.kaika > 0 && Math.random() < 0.15) vis.parts.push({ x: f.x, y: f.y, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 0.5, max: 0.5, kind: "petal" });
        // 紅葉斬り：發動中身邊飄落楓葉
        if (f.fx.momiji > 0 && Math.random() < 0.3) vis.parts.push({ x: f.x + (Math.random() - 0.5) * 30, y: f.y + (Math.random() - 0.5) * 30, vx: (Math.random() - 0.5) * 20, vy: 18, life: 0.8, max: 0.8, kind: "leaf" });
        // 火焰尾跡（火之呼吸・炎之呼吸・日之呼吸）
        if (Arena.bany(f, "flame") && Math.random() < 0.6) vis.parts.push({ x: f.x, y: f.y, vx: (Math.random() - 0.5) * 30 - f.vx * 0.2, vy: (Math.random() - 0.5) * 30 - f.vy * 0.2, life: 0.35, max: 0.35, kind: "fire" });
        // 名牌
        ctx.font = Math.round(11 * dpr) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText(f.name, f.x * s, (f.y - f.prof.radius - 7) * s);
      });
      // 火花・碎片・楓葉
      vis.parts.forEach(function (p) {
        var k = p.life / p.max;
        if (p.kind === "petal") { ctx.fillStyle = "rgba(255," + Math.round(160 + 50 * k) + ",200," + k + ")"; ctx.beginPath(); ctx.ellipse(p.x * s, p.y * s, 3.2 * dpr, 2 * dpr, p.vx, 0, Math.PI * 2); ctx.fill(); return; }
        if (p.kind === "snow") { ctx.fillStyle = "rgba(240,248,255," + k + ")"; ctx.beginPath(); ctx.arc(p.x * s, p.y * s, 1.8 * dpr, 0, Math.PI * 2); ctx.fill(); return; }
        if (p.kind === "leaf") { ctx.fillStyle = "rgba(214," + Math.round(60 + 60 * k) + ",40," + k + ")"; ctx.beginPath(); ctx.ellipse(p.x * s, p.y * s, 3 * dpr, 1.6 * dpr, p.vx, 0, Math.PI * 2); ctx.fill(); return; }
        ctx.strokeStyle = p.kind === "fire" ? "rgba(255," + Math.round(90 + 100 * k) + ",30," + k + ")" : (p.kind === "shard" ? "rgba(220,230,240," + k + ")" : "rgba(255," + Math.round(200 + 55 * k) + "," + Math.round(120 * k) + "," + k + ")");
        ctx.lineWidth = (p.kind === "fire" ? 2.5 : 1.6) * dpr;
        ctx.beginPath(); ctx.moveTo(p.x * s, p.y * s); ctx.lineTo((p.x - p.vx * 0.05) * s, (p.y - p.vy * 0.05) * s); ctx.stroke();
      });
      vis.rings.forEach(function (rg) {
        var k = rg.life / rg.max;
        ctx.strokeStyle = "rgba(" + rg.color + "," + k + ")"; ctx.lineWidth = (rg.thick || 2) * dpr;
        ctx.beginPath(); ctx.arc(rg.x * s, rg.y * s, (rg.r + rg.grow * (1 - k)) * s, 0, Math.PI * 2); ctx.stroke();
      });
      vis.bolts.forEach(function (b) {
        var k = b.life / b.max;
        ctx.strokeStyle = "rgba(" + b.color + "," + k + ")"; ctx.lineWidth = 3 * dpr;
        ctx.beginPath(); ctx.moveTo(b.x * s, b.y * s);
        for (var i = 1; i <= 6; i++) {
          var q = i / 6;
          ctx.lineTo((b.x + (b.x2 - b.x) * q + (i < 6 ? (Math.random() - 0.5) * 18 : 0)) * s, (b.y + (b.y2 - b.y) * q + (i < 6 ? (Math.random() - 0.5) * 18 : 0)) * s);
        }
        ctx.stroke();
      });
      vis.floats.forEach(function (fl) {
        var k = fl.life / fl.max;
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.font = (fl.big ? "bold " + Math.round(15 * dpr) : Math.round(12 * dpr)) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = fl.color;
        ctx.fillText(fl.text, fl.x * s, (fl.y - (1 - k) * 18) * s);
        ctx.globalAlpha = 1;
      });
      vis.cuts.forEach(function (c) {
        var k = c.life / c.max, dx = Math.cos(c.ang) * c.len * (1.2 - k * 0.4), dy = Math.sin(c.ang) * c.len * (1.2 - k * 0.4);
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(" + c.color + "," + (0.35 * k) + ")"; ctx.lineWidth = 7 * dpr * k;
        ctx.beginPath(); ctx.moveTo((c.x - dx) * s, (c.y - dy) * s); ctx.lineTo((c.x + dx) * s, (c.y + dy) * s); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255," + k + ")"; ctx.lineWidth = 1.6 * dpr;
        ctx.beginPath(); ctx.moveTo((c.x - dx) * s, (c.y - dy) * s); ctx.lineTo((c.x + dx) * s, (c.y + dy) * s); ctx.stroke();
      });
      vis.arcs.forEach(function (c) {
        var k = c.life / c.max, sweep = Math.PI * 1.7 * (1 - k * 0.6);
        ctx.strokeStyle = "rgba(255,255,255," + (0.9 * k) + ")"; ctx.lineWidth = 6 * dpr * k + 1;
        ctx.beginPath(); ctx.arc(c.x * s, c.y * s, c.r * s, c.a0, c.a0 + sweep); ctx.stroke();
        ctx.strokeStyle = "rgba(180,220,255," + (0.5 * k) + ")"; ctx.lineWidth = 14 * dpr * k;
        ctx.beginPath(); ctx.arc(c.x * s, c.y * s, c.r * s * 0.92, c.a0, c.a0 + sweep); ctx.stroke();
      });
      if (vis.flash) {
        ctx.fillStyle = "rgba(255,255,255," + (0.3 * vis.flash.life / vis.flash.max) + ")";
        ctx.beginPath(); ctx.arc(0, 0, (Arena.R + 12) * s, 0, Math.PI * 2); ctx.fill();
      }
      if (vis.cutin) {
        var kc = vis.cutin.life / vis.cutin.max, slide = Math.min(1, (1 - kc) * 6);
        var bandH = 34 * dpr, by = Arena.R * 0.25 * s;
        ctx.globalAlpha = Math.min(1, kc * 3);
        ctx.fillStyle = "rgba(10,8,6,0.78)";
        ctx.fillRect(-px / 2, by - bandH / 2, px, bandH);
        ctx.fillStyle = vis.cutin.color;
        ctx.fillRect(-px / 2, by - bandH / 2, px, 2 * dpr);
        ctx.fillRect(-px / 2, by + bandH / 2 - 2 * dpr, px, 2 * dpr);
        ctx.font = "bold " + Math.round(17 * dpr) + "px serif";
        ctx.textAlign = "center";
        ctx.fillStyle = vis.cutin.color;
        ctx.fillText(vis.cutin.text, (1 - slide) * px * 0.6, by + 6 * dpr);
        ctx.font = Math.round(10 * dpr) + "px sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillText(vis.cutin.who, (1 - slide) * px * 0.6, by - 10 * dpr);
        ctx.globalAlpha = 1;
      }
      if (vis.banner) {
        var kb = vis.banner.life / vis.banner.max;
        ctx.globalAlpha = Math.min(1, kb * 2);
        ctx.font = "bold " + Math.round(22 * dpr) + "px serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#f3e2b8";
        ctx.fillText(vis.banner.text, 0, -Arena.R * 0.55 * s);
        ctx.globalAlpha = 1;
      }
    }

    function tickVisuals(dt) {
      vis.parts = vis.parts.filter(function (p) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; return p.life > 0; });
      ["floats", "rings", "bolts", "cuts", "arcs"].forEach(function (k) {
        vis[k] = vis[k].filter(function (x) { x.life -= dt; return x.life > 0; });
      });
      ["flash", "cutin"].forEach(function (k) { if (vis[k]) { vis[k].life -= dt; if (vis[k].life <= 0) vis[k] = null; } });
      if (vis.banner) { vis.banner.life -= dt; if (vis.banner.life <= 0) vis.banner = null; }
    }

    function endIfOver() {
      if (!a.over || ended) return false;
      // 連線：房主送出結束狀態後才算結束；非房主以房主的結束狀態為準
      if (net) { net.canStep(a); if (!net.isHost && !net.ended) return false; }
      ended = true;
      stopAnim();
      onEnd(Arena.result(a));
      return true;
    }

    btnPause.addEventListener("click", function () { paused = !paused; btnPause.textContent = paused ? t("kt_ar_resume") : t("kt_ar_pause"); });
    btnSpeed.addEventListener("click", function () { ui.arenaSpeed = ui.arenaSpeed === 2 ? 1 : 2; btnSpeed.textContent = "×" + ui.arenaSpeed; });
    btnSkip.addEventListener("click", function () { Arena.run(a); endIfOver(); });

    if (net) net.onRestore = function () { vis.ver = -1; vis.logAt = Math.min(vis.logAt, a.log.length); };
    buildPanels();
    updateFeed();
    if (a.over && (!net || net.isHost || net.ended)) { drawLater(); return wrap; }

    var acc = 0, last = 0;
    anim = { kind: "arena" };
    function frame(now) {
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      if (!paused) {
        acc += dt * (ui.arenaSpeed || 1);
        var n = 0;
        while (acc >= Arena.DT && n++ < 8 && !a.over) {
          if (net && !net.canStep(a)) { acc = 0; break; }
          Arena.step(a); acc -= Arena.DT;
        }
        if (n >= 8) acc = 0;
        if (net && a.over) net.canStep(a);
        consumeEvents();
        tickVisuals(dt * (ui.arenaSpeed || 1));
      }
      drawFrame();
      vis.barT -= dt;
      if (vis.ver !== a.ver) buildPanels();
      else if (vis.barT <= 0) { vis.barT = 0.1; updateBars(); }
      updateFeed();
      if (endIfOver()) return;
      anim.id = requestAnimationFrame(frame);
    }
    anim.id = requestAnimationFrame(frame);
    return wrap;

    function drawLater() { requestAnimationFrame(function () { if (canvas.isConnected) drawFrame(); }); }
  }

  // 對刀結束後的成績表
  function arenaResultTable(res, nameOf) {
    var head = el("tr", {}, ["", "kt_ar_col_hp", "kt_ar_col_dealt", "kt_ar_col_chips", "kt_ar_col_state"].map(function (k) { return el("th", { text: k ? t(k) : "" }); }));
    var rows = res.placing.map(function (id, i) {
      var sm = res.summary.filter(function (x) { return x.id === id; })[0];
      var st = sm.alive ? (id === res.winner ? "🏆" : t("kt_ar_alive")) : t(sm.out === "stall" ? "kt_ar_stalled" : "kt_broken");
      return el("tr", {}, [el("th", { text: "#" + (i + 1) + " " + nameOf(id) }), el("td", { text: sm.hp + "/" + sm.maxHp }), el("td", { text: String(sm.dealt) }),
        el("td", { text: sm.chips + " / " + sm.bends }), el("td", { text: st })]);
    });
    return el("div", { class: "kt-scroll" }, [el("table", { class: "kt-table" }, [head].concat(rows))]);
  }

  // ---------------- 畫面：互擊（鍛刀局內） ----------------

  function clashSetup() {
    if (!ui.npc) ui.npc = state.players.length < 2 ? { sato: true } : {};
    if (!ui.scPick) ui.scPick = {};
    var panel = el("div", { class: "kt-panel" });
    panel.appendChild(el("h2", { text: t("kt_clash_title") }));
    panel.appendChild(el("p", { text: t("kt_clash_intro") }));
    panel.appendChild(el("div", { class: "kt-mg-title", text: t("kt_clash_npc") }));
    D.NPC_SWORDS.forEach(function (n) {
      panel.appendChild(el("label", { class: "kt-check" }, [
        el("input", { type: "checkbox", checked: !!ui.npc[n.id], onchange: function (ev) { ui.npc[n.id] = ev.target.checked; rerenderKeepScroll(); } }),
        " " + npcName(n)
      ]));
    });
    var thisGame = state.players.map(bladeScUid);
    var mine = scabbardLoad().swords.filter(function (x) { return thisGame.indexOf(x.uid) < 0; });
    if (mine.length) {
      panel.appendChild(el("div", { class: "kt-mg-title", text: t("kt_clash_from_sc") }));
      mine.forEach(function (x) {
        panel.appendChild(el("label", { class: "kt-check" }, [
          el("input", { type: "checkbox", checked: !!ui.scPick[x.uid], onchange: function (ev) { ui.scPick[x.uid] = ev.target.checked; rerenderKeepScroll(); } }),
          " " + snapTitle(x.snap) + (x.snap.smith ? " " + t("kt_sc_by", { name: x.snap.smith }) : "")
        ]));
      });
    }
    var extras = D.NPC_SWORDS.filter(function (n) { return ui.npc[n.id]; }).map(function (n) { return { id: "npc-" + n.id, name: npcName(n), snap: Core.npcSnapshot(n) }; });
    mine.forEach(function (x, i) { if (ui.scPick[x.uid]) extras.push({ id: "sc-" + i, name: x.snap.smith || snapTitle(x.snap), snap: x.snap, uid: x.uid }); });
    var count = state.players.length + extras.length;
    panel.appendChild(el("div", { class: "kt-actions" }, [
      el("button", { type: "button", class: "kt-primary", text: t("kt_go_clash"), disabled: count < 2, onclick: function () {
        Core.startClash(state, extras);
        state.clash.uidOf = {};
        extras.forEach(function (x) { if (x.uid) state.clash.uidOf[x.id] = x.uid; });
        state.players.forEach(function (p) { var u = bladeScUid(p); if (u) state.clash.uidOf[p.id] = u; });
        ui.arena = null;
        save(); window.scrollTo(0, 0); render();
      } }),
      count < 2 ? el("span", { class: "kt-muted", text: t("kt_clash_need2") }) : null
    ]));
    panel.appendChild(el("button", { type: "button", class: "kt-link", text: t("kt_skip_clash"), onclick: function () { state.phase = "end"; save(); render(); } }));
    return panel;
  }

  function fighterName(id) {
    var f = state.clash ? state.clash.fighters.filter(function (x) { return x.id === id; })[0] : null;
    if (f) return f.name;
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === id) return state.players[i].name;
    return id;
  }

  function renderClash() {
    var cl = state.clash;
    app.appendChild(el("h2", { text: t("kt_clash_title") }));
    if (cl.winner) {
      app.appendChild(el("div", { class: "kt-panel kt-result" }, [
        el("h3", { text: t("kt_clash_winner", { name: fighterName(cl.winner) }) }),
        cl.summary && cl.summary.length ? arenaResultTable({ winner: cl.winner, placing: cl.placing, summary: cl.summary }, fighterName) : null,
        el("button", { type: "button", class: "kt-primary", text: t("kt_to_final"), onclick: function () { state.phase = "end"; save(); window.scrollTo(0, 0); render(); } })
      ]));
      return;
    }
    // 對刀場狀態放在 ui（不存檔）：重新整理會從頭再打一次
    if (!ui.arena || ui.arenaKey !== state.seed) {
      ui.arena = window.PriTestKatanaArena.create({ seed: state.seed + "|clash", fighters: cl.fighters });
      ui.arenaKey = state.seed;
    }
    app.appendChild(el("p", { class: "kt-muted", text: t("kt_ar_howto") }));
    app.appendChild(arenaView(ui.arena, function (res) {
      Core.finishClash(state, res);
      recordResult(res, cl.uidOf || {});
      ui.arena = null;
      save();
      render();
    }));
    app.appendChild(footerTools());
  }

  // ---------------- 畫面：刀鞘・邀請・自由對刀（開爐準備畫面） ----------------

  function scabbardPanel() {
    var sc = scabbardLoad();
    var panel = el("div", { class: "kt-panel" });
    panel.appendChild(el("h2", { text: t("kt_sc_title") + " " + t("kt_sc_count", { n: sc.swords.length, max: SCABBARD_MAX }) }));
    panel.appendChild(el("p", { class: "kt-muted", text: t("kt_sc_intro") }));
    if (sc.swords.length >= SCABBARD_MAX) panel.appendChild(el("p", { class: "kt-error kt-sc-full", text: t("kt_sc_full", { max: SCABBARD_MAX }) }));
    if (!sc.swords.length) panel.appendChild(el("p", { text: t("kt_sc_empty") }));
    sc.swords.forEach(function (x) {
      var open = ui.inviteOpen === x.uid;
      var kids = [
        el("span", { class: "kt-muted", text: (x.guest ? t("kt_sc_guest") + "・" : "") + t("kt_sc_rec", { w: x.rec.w, l: x.rec.l }) }),
        el("button", { type: "button", text: open ? t("kt_sc_invite_close") : t("kt_sc_invite"), onclick: function () { ui.inviteOpen = open ? null : x.uid; ui.copyMsg = ""; rerenderKeepScroll(); } }),
        ui.confirmDel === x.uid ? el("span", {}, [
          el("button", { type: "button", class: "kt-danger", text: t("kt_sc_del_yes"), onclick: function () { unsheathe(x.uid); ui.confirmDel = null; rerenderKeepScroll(); } }),
          el("button", { type: "button", text: t("kt_no"), onclick: function () { ui.confirmDel = null; rerenderKeepScroll(); } })
        ]) : el("button", { type: "button", class: "kt-link", text: t("kt_sc_del"), onclick: function () { ui.confirmDel = x.uid; rerenderKeepScroll(); } })
      ];
      panel.appendChild(snapCard(x.snap, kids));
      if (open) {
        var url = inviteUrl(snapWithUid(x));
        var box = el("input", { type: "text", class: "kt-text kt-invite-url", readonly: true, value: url, onfocus: function (ev) { ev.target.select(); } });
        panel.appendChild(el("div", { class: "kt-invite" }, [
          el("p", { class: "kt-muted", text: t("kt_sc_invite_note") }),
          box,
          el("div", { class: "kt-actions" }, [
            el("button", { type: "button", class: "kt-primary", text: t("kt_sc_copy"), onclick: function () { copyText(url, box); } }),
            ui.copyMsg ? el("span", { class: "kt-muted", text: ui.copyMsg }) : null
          ])
        ]));
      }
    });
    // 貼上別人的邀請碼
    var imp = el("textarea", { class: "kt-text kt-import", rows: "2", placeholder: t("kt_sc_import_ph") });
    imp.value = ui.importText || "";
    imp.addEventListener("input", function () { ui.importText = imp.value; });
    panel.appendChild(field(t("kt_sc_import"), imp));
    panel.appendChild(el("div", { class: "kt-actions" }, [
      el("button", { type: "button", text: t("kt_sc_import_go"), onclick: function () {
        var snap = decodeSnap(ui.importText);
        if (!snap) { ui.importErr = true; rerenderKeepScroll(); return; }
        ui.importErr = false; ui.importText = "";
        lobbyAddGuest(snap);
        rerenderKeepScroll();
      } }),
      ui.importErr ? el("span", { class: "kt-error", text: t("kt_sc_import_bad") }) : null
    ]));
    panel.appendChild(scabbardTransferBox());
    return panel;
  }

  // 整個刀鞘的匯出／匯入（換裝置時用）
  function scabbardTransferBox() {
    var tr = ui.scTransfer || (ui.scTransfer = { text: "", mode: "merge", confirm: false, msg: "", bad: false, code: "" });
    var box = el("div", { class: "kt-sc-transfer" });
    box.appendChild(el("h3", { text: t("kt_sc_tr_title") }));
    box.appendChild(el("p", { class: "kt-muted", text: t("kt_sc_tr_intro") }));
    var codeBox = tr.code ? el("textarea", { class: "kt-text kt-import kt-sc-code", rows: "3", readonly: true, onfocus: function (ev) { ev.target.select(); } }) : null;
    if (codeBox) codeBox.value = tr.code;
    box.appendChild(el("div", { class: "kt-actions" }, [
      el("button", { type: "button", text: t("kt_sc_tr_download"), onclick: function () {
        var d = new Date(), pad = function (n) { return (n < 10 ? "0" : "") + n; };
        var blob = new Blob([scabbardExportJson()], { type: "application/json" });
        var a = el("a", { href: URL.createObjectURL(blob), download: "katana-scabbard-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".json" });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      } }),
      el("button", { type: "button", text: t("kt_sc_tr_code"), onclick: function () { tr.code = scabbardExportCode(); ui.copyMsg = ""; rerenderKeepScroll(); } }),
      tr.code ? el("button", { type: "button", class: "kt-primary", text: t("kt_sc_copy_code"), onclick: function () { copyText(tr.code, box.querySelector(".kt-sc-code")); } }) : null,
      tr.code && ui.copyMsg ? el("span", { class: "kt-muted", text: ui.copyMsg }) : null
    ]));
    if (codeBox) box.appendChild(codeBox);
    // 匯入：貼上刀鞘碼或選檔案
    var area = el("textarea", { class: "kt-text kt-import kt-sc-import", rows: "2", placeholder: t("kt_sc_tr_paste_ph") });
    area.value = tr.text;
    area.addEventListener("input", function () { tr.text = area.value; tr.confirm = false; });
    var file = el("input", { type: "file", accept: ".json,application/json,text/plain", class: "kt-sc-file", onchange: function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { tr.text = String(rd.result || ""); tr.confirm = false; tr.msg = ""; tr.bad = false; rerenderKeepScroll(); };
      rd.readAsText(f);
    } });
    box.appendChild(field(t("kt_sc_tr_import"), el("div", {}, [area, file])));
    box.appendChild(radioList("scImportMode", [
      { id: "merge", name: { ja: t("kt_sc_tr_merge"), zh: t("kt_sc_tr_merge") }, desc: { ja: t("kt_sc_tr_merge_desc"), zh: t("kt_sc_tr_merge_desc") } },
      { id: "replace", name: { ja: t("kt_sc_tr_replace"), zh: t("kt_sc_tr_replace") }, desc: { ja: t("kt_sc_tr_replace_desc"), zh: t("kt_sc_tr_replace_desc") } }
    ], tr.mode, function (v) { tr.mode = v; tr.confirm = false; rerenderKeepScroll(); }));
    function doImport() {
      var list = parseScabbardExport(tr.text);
      if (!list) { tr.bad = true; tr.msg = ""; tr.confirm = false; rerenderKeepScroll(); return; }
      var r = scabbardImport(list, tr.mode);
      tr.bad = false; tr.confirm = false; tr.text = "";
      tr.msg = t("kt_sc_tr_done", { added: r.added, updated: r.updated }) + (r.skipped ? " " + t("kt_sc_tr_skipped", { n: r.skipped, max: SCABBARD_MAX }) : "");
      rerenderKeepScroll();
    }
    box.appendChild(el("div", { class: "kt-actions" }, tr.confirm ? [
      el("span", { class: "kt-error", text: t("kt_sc_tr_replace_confirm") }),
      el("button", { type: "button", class: "kt-danger", text: t("kt_sc_tr_replace_yes"), onclick: doImport }),
      el("button", { type: "button", text: t("kt_no"), onclick: function () { tr.confirm = false; rerenderKeepScroll(); } })
    ] : [
      el("button", { type: "button", class: "kt-primary kt-sc-import-go", text: t("kt_sc_tr_import_go"), onclick: function () {
        if (tr.mode === "replace") { if (!parseScabbardExport(tr.text)) { tr.bad = true; rerenderKeepScroll(); return; } tr.confirm = true; rerenderKeepScroll(); return; }
        doImport();
      } }),
      tr.bad ? el("span", { class: "kt-error", text: t("kt_sc_tr_bad") }) : null,
      tr.msg ? el("span", { class: "kt-good kt-sc-tr-msg", text: tr.msg }) : null
    ]));
    return box;
  }

  // 對刀模式：陀螺（koma）｜試合（shiai，使用者指定 2026-10-20：刀不自轉、收刀→刀光→斬到壁面，全自動）
  function arenaModePicker(name, value, onPick, disabled) {
    return field(t("kt_amode"), radioList(name, ["koma", "shiai"].map(function (id) {
      return { id: id, name: { ja: t("kt_amode_" + id), zh: t("kt_amode_" + id) }, desc: { ja: t("kt_amode_" + id + "_desc"), zh: t("kt_amode_" + id + "_desc") } };
    }), value || "koma", onPick, { disabled: disabled ? function () { return true; } : null }));
  }

  // 自由對刀的準備：從刀鞘挑刀、加入收到的客刀與對手刀，指定誰由玩家操作
  function lobby() {
    if (!ui.lobby) ui.lobby = { pick: {}, guests: [], npc: {}, human: {} };
    return ui.lobby;
  }

  function lobbyAddGuest(snap) {
    var lb = lobby();
    lb.guests.push(snap);
    var gid = "g" + (lb.guests.length - 1);
    lb.pick[gid] = true;
    lb.human[gid] = false;
  }

  function lobbyFighters() {
    var lb = lobby(), sc = scabbardLoad(), out = [];
    sc.swords.forEach(function (x, i) {
      if (!lb.pick[x.uid]) return;
      out.push({ id: "s" + i, key: x.uid, name: x.snap.smith || t("kt_sc_mine"), snap: x.snap, human: lb.human[x.uid] !== false, uid: x.uid });
    });
    lb.guests.forEach(function (g, i) {
      var gid = "g" + i;
      if (!lb.pick[gid]) return;
      out.push({ id: gid, key: gid, name: g.smith || t("kt_sc_guest"), snap: g, human: !!lb.human[gid] });
    });
    D.NPC_SWORDS.forEach(function (n) {
      if (!lb.npc[n.id]) return;
      out.push({ id: "npc-" + n.id, key: "npc-" + n.id, name: npcName(n), snap: Core.npcSnapshot(n), human: false });
    });
    return out;
  }

  function lobbyPanel() {
    var lb = lobby(), sc = scabbardLoad();
    var panel = el("div", { class: "kt-panel" });
    panel.appendChild(el("h2", { text: t("kt_duel_title") }));
    panel.appendChild(el("p", { class: "kt-muted", text: t("kt_duel_intro") }));
    function row(key, label, isHuman, canHuman) {
      var picked = !!lb.pick[key];
      return el("div", { class: "kt-lobby-row" }, [
        el("label", { class: "kt-check" }, [
          el("input", { type: "checkbox", checked: picked, onchange: function (ev) { lb.pick[key] = ev.target.checked; rerenderKeepScroll(); } }), " " + label
        ]),
        picked && canHuman ? el("button", { type: "button", class: "kt-chip" + (isHuman ? " kt-chip-on" : ""), text: isHuman ? t("kt_duel_human") : "AI",
          onclick: function () { lb.human[key] = !isHuman; rerenderKeepScroll(); } }) : null
      ]);
    }
    sc.swords.forEach(function (x) { panel.appendChild(row(x.uid, snapTitle(x.snap) + (x.snap.smith ? " " + t("kt_sc_by", { name: x.snap.smith }) : ""), lb.human[x.uid] !== false, true)); });
    lb.guests.forEach(function (g, i) { panel.appendChild(row("g" + i, "✉ " + snapTitle(g) + (g.smith ? " " + t("kt_sc_by", { name: g.smith }) : ""), !!lb.human["g" + i], true)); });
    D.NPC_SWORDS.forEach(function (n) {
      panel.appendChild(el("label", { class: "kt-check" }, [
        el("input", { type: "checkbox", checked: !!lb.npc[n.id], onchange: function (ev) { lb.npc[n.id] = ev.target.checked; rerenderKeepScroll(); } }), " " + npcName(n)
      ]));
    });
    var fs = lobbyFighters();
    panel.appendChild(arenaModePicker("duelMode", ui.duelMode, function (v) { ui.duelMode = v; rerenderKeepScroll(); }));
    panel.appendChild(el("div", { class: "kt-actions" }, [
      el("button", { type: "button", class: "kt-primary", text: t("kt_duel_go"), disabled: fs.length < 2, onclick: function () {
        var seed = String(Date.now());
        var uidOf = {};
        fs.forEach(function (f) { if (f.uid) uidOf[f.id] = f.uid; });
        ui.duel = { arena: window.PriTestKatanaArena.create({ seed: seed, fighters: fs, mode: ui.duelMode }), uidOf: uidOf, result: null, names: {} };
        fs.forEach(function (f) { ui.duel.names[f.id] = f.name + (f.snap.name ? "「" + f.snap.name + "」" : ""); });
        window.scrollTo(0, 0);
        render();
      } }),
      fs.length < 2 ? el("span", { class: "kt-muted", text: t("kt_clash_need2") }) : null
    ]));
    return panel;
  }

  // 收到邀請（?duel=…）時，最上方顯示對方的刀
  function invitePanel() {
    var snap = ui.invite;
    var panel = el("div", { class: "kt-panel kt-invite-panel" });
    panel.appendChild(el("h2", { text: t("kt_inv_title", { name: snap.smith || t("kt_sc_guest") }) }));
    panel.appendChild(snapCard(snap, [
      el("button", { type: "button", text: t("kt_inv_keep"), onclick: function () {
        if (sheathe(guestUid(snap), snap, true) === "full") ui.inviteFull = true;
        else { ui.inviteKept = true; ui.inviteFull = false; }
        rerenderKeepScroll();
      }, disabled: !!ui.inviteKept }),
      ui.inviteKept ? el("span", { class: "kt-good", text: t("kt_inv_kept") }) : null,
      ui.inviteFull && !ui.inviteKept ? el("span", { class: "kt-error", text: t("kt_sc_full", { max: SCABBARD_MAX }) }) : null
    ]));
    panel.appendChild(el("p", { class: "kt-muted", text: scabbardLoad().swords.filter(function (x) { return !x.guest; }).length ? t("kt_inv_pick") : t("kt_inv_no_sword") }));
    return panel;
  }

  // ---------------- 連線對刀（最多 8 把刀，使用者指定 2026-10-20） ----------------
  // 房間與同步協定在 katana_net.js；這裡只做畫面。ui.room＝PriTestKatanaNet.open() 的房間物件。
  // 房間網址：katana/index.html?room=<g+32hex>。玩家名稱記在 localStorage["pritest-katana-netname"]。
  var NETNAME_KEY = "pritest-katana-netname";

  function netName() { try { return localStorage.getItem(NETNAME_KEY) || ""; } catch (e) { return ""; } }
  function setNetName(n) { try { localStorage.setItem(NETNAME_KEY, n); } catch (e) { /* 只是記不住 */ } }
  function roomUrl(id) { return location.href.split(/[?#]/)[0] + "?room=" + id; }

  function openRoom(roomId) {
    var Net = window.PriTestKatanaNet;
    if (!Net) return;
    if (ui.room) ui.room.leave();
    ui.roomSword = null;
    ui.room = Net.open({ roomId: roomId || null, name: netName(), onChange: onRoomChange });
    // 網址帶上房間（重新整理或傳給別人都能回到同一間）；同時去掉 ?duel= 邀請
    try { history.replaceState(null, "", roomUrl(ui.room.id)); } catch (e) { /* file:// 等 */ }
    rerenderKeepScroll();
  }

  function leaveRoom() {
    if (ui.room) ui.room.leave();
    ui.room = null;
    if (ui.duel && ui.duel.online) ui.duel = null;
    if (/[?&]room=/.test(location.search)) history.replaceState(null, "", location.href.split(/[?#]/)[0]);
    render();
  }

  // 房間資料一有變動就呼叫。對刀中不重畫（會中斷動畫），只處理開打・回大廳
  var roomRenderPending = false;
  function onRoomChange() {
    var room = ui.room;
    if (!room) return;
    var meta = room.meta;
    if (meta && meta.status === "play" && room.match && room.match.no === meta.no && (!ui.duel || !ui.duel.online || ui.duel.no !== meta.no) && ui.duelDoneNo !== meta.no) {
      startOnlineDuel(room);
      return;
    }
    if (ui.duel && ui.duel.online) {
      if (ui.duel.result && meta && meta.status === "lobby") { ui.duelDoneNo = ui.duel.no; ui.duel = null; render(); }
      return;
    }
    if (ui.duel || state) return; // 房間只畫在準備畫面；鍛刀中不打斷小遊戲
    // 正在輸入名字時先不重畫（會搶走焦點），離開輸入框再畫
    var act = document.activeElement;
    if (act && act.classList && act.classList.contains("kt-room-name")) { roomRenderPending = true; return; }
    roomRenderPending = false;
    rerenderKeepScroll();
  }

  function startOnlineDuel(room) {
    var m = room.match;
    var a = window.PriTestKatanaArena.create({ seed: m.seed, fighters: m.fighters, mode: m.mode });
    var ctl = room.matchCtl();
    var names = {}, uidOf = {};
    m.fighters.forEach(function (f) {
      names[f.id] = f.name + (f.snap && f.snap.name ? "「" + f.snap.name + "」" : "");
      if (f.cid === room.cid && ui.roomSword) uidOf[f.id] = ui.roomSword;
    });
    ui.duel = { online: true, no: m.no, arena: a, net: ctl, names: names, uidOf: uidOf, result: null };
    window.scrollTo(0, 0);
    render();
  }

  // 沒有房間時：建立房間或貼上房間網址加入
  function netEntryPanel() {
    var panel = el("div", { class: "kt-panel kt-net-entry" });
    panel.appendChild(el("h2", { text: t("kt_net_title") }));
    panel.appendChild(el("p", { class: "kt-muted", text: t("kt_net_intro", { n: window.PriTestKatanaNet ? window.PriTestKatanaNet.MAX_FIGHTERS : 8 }) }));
    var inp = el("input", { type: "text", class: "kt-text kt-net-join-input", placeholder: t("kt_net_join_ph") });
    inp.value = ui.roomJoinText || "";
    inp.addEventListener("input", function () { ui.roomJoinText = inp.value; ui.roomJoinBad = false; });
    panel.appendChild(el("div", { class: "kt-actions" }, [
      el("button", { type: "button", class: "kt-primary kt-net-create", text: t("kt_net_create"), onclick: function () { openRoom(null); } })
    ]));
    panel.appendChild(field(t("kt_net_join"), inp));
    panel.appendChild(el("div", { class: "kt-actions" }, [
      el("button", { type: "button", text: t("kt_net_join_go"), onclick: function () {
        var Net = window.PriTestKatanaNet;
        var id = Net.roomFromUrl(ui.roomJoinText) || (Net.validRoomId(String(ui.roomJoinText || "").trim()) ? String(ui.roomJoinText).trim() : null);
        if (!id) { ui.roomJoinBad = true; rerenderKeepScroll(); return; }
        ui.roomJoinText = "";
        openRoom(id);
      } }),
      ui.roomJoinBad ? el("span", { class: "kt-error", text: t("kt_net_join_bad") }) : null
    ]));
    return panel;
  }

  // 房間大廳
  function roomPanel() {
    var room = ui.room, Net = window.PriTestKatanaNet;
    var panel = el("div", { class: "kt-panel kt-room" });
    panel.appendChild(el("h2", { text: t("kt_net_room_title") }));
    function foot() { return el("div", { class: "kt-actions" }, [el("button", { type: "button", class: "kt-link kt-room-leave", text: t("kt_net_leave"), onclick: leaveRoom })]); }
    if (room.missing) {
      panel.appendChild(el("p", { class: "kt-error", text: t("kt_net_missing") }));
      panel.appendChild(foot());
      return panel;
    }
    if (!room.loaded) {
      panel.appendChild(el("p", { class: "kt-muted", text: t("kt_net_connecting") }));
      panel.appendChild(foot());
      return panel;
    }
    // 邀請網址
    var url = roomUrl(room.id);
    var box = el("input", { type: "text", class: "kt-text kt-invite-url kt-room-url", readonly: true, value: url, onfocus: function (ev) { ev.target.select(); } });
    panel.appendChild(el("div", { class: "kt-invite" }, [
      el("p", { class: "kt-muted", text: t("kt_net_share") }), box,
      el("div", { class: "kt-actions" }, [
        el("button", { type: "button", class: "kt-primary", text: t("kt_net_copy"), onclick: function () { copyText(url, box); } }),
        ui.copyMsg ? el("span", { class: "kt-muted", text: ui.copyMsg }) : null
      ])
    ]));
    if (room.meta && !room.hostOnline()) panel.appendChild(el("p", { class: "kt-error", text: t("kt_net_host_away") }));
    if (room.meta && room.meta.status === "play") panel.appendChild(el("p", { class: "kt-muted", text: t("kt_net_in_play") }));

    // 參加者
    var ps = room.list();
    var host = room.meta ? room.meta.host : null;
    var tbl = el("div", { class: "kt-room-list" });
    ps.forEach(function (p) {
      tbl.appendChild(el("div", { class: "kt-room-row" + (p.cid === room.cid ? " kt-room-me" : ""), "data-cid": p.cid }, [
        el("strong", { text: (p.cid === host ? "👑 " : "") + (p.name || t("kt_net_noname")) + (p.cid === room.cid ? " " + t("kt_net_you") : "") }),
        el("span", { class: "kt-muted", text: p.snap ? snapTitle(p.snap) : t("kt_net_no_sword") }),
        p.snap ? el("span", { class: p.ready ? "kt-good" : "kt-muted", text: p.ready ? t("kt_net_ready_on") : t("kt_net_ready_off") }) : null
      ]));
    });
    room.npcIds().forEach(function (id) {
      var n = Core.byId(D.NPC_SWORDS, id);
      if (n) tbl.appendChild(el("div", { class: "kt-room-row" }, [el("strong", { text: npcName(n) }), el("span", { class: "kt-af-ai", text: "AI" })]));
    });
    panel.appendChild(field(t("kt_net_members", { n: room.fighterCount(), max: Net.MAX_FIGHTERS }), tbl));

    // 自己：名字・出戰的刀・準備
    var lobbyOpen = room.meta && room.meta.status === "lobby";
    var nameInp = el("input", { type: "text", class: "kt-text kt-room-name", maxlength: "16", value: room.me.name || "", placeholder: t("kt_net_name_ph") });
    nameInp.addEventListener("change", function () {
      var v = nameInp.value.trim().slice(0, 16);
      setNetName(v);
      room.update({ name: v });
    });
    nameInp.addEventListener("blur", function () { if (roomRenderPending) setTimeout(onRoomChange, 0); });
    panel.appendChild(field(t("kt_net_name"), nameInp));
    var sc = scabbardLoad();
    if (!sc.swords.length) panel.appendChild(el("p", { class: "kt-muted", text: t("kt_net_need_sword") }));
    else {
      var full = room.full() && !room.me.snap;
      var sel = el("select", { class: "kt-room-sword", disabled: !lobbyOpen || full }, [el("option", { value: "", text: t("kt_net_watch") })].concat(sc.swords.map(function (x) {
        return el("option", { value: x.uid, selected: ui.roomSword === x.uid, text: snapTitle(x.snap) + (x.snap.smith ? " " + t("kt_sc_by", { name: x.snap.smith }) : "") + (x.guest ? "（" + t("kt_sc_guest") + "）" : "") });
      })));
      sel.addEventListener("change", function () {
        var x = sc.swords.filter(function (y) { return y.uid === sel.value; })[0] || null;
        ui.roomSword = x ? x.uid : null;
        room.update({ snap: x ? snapWithUid(x) : null, ready: false });
        rerenderKeepScroll();
      });
      panel.appendChild(field(t("kt_net_sword"), sel, full ? t("kt_net_full", { max: Net.MAX_FIGHTERS }) : null));
      if (room.me.snap && lobbyOpen) {
        panel.appendChild(el("div", { class: "kt-actions" }, [
          el("button", { type: "button", class: "kt-chip kt-room-ready" + (room.me.ready ? " kt-chip-on" : ""), text: room.me.ready ? t("kt_net_ready_on") : t("kt_net_ready_btn"),
            onclick: function () { room.update({ ready: !room.me.ready }); rerenderKeepScroll(); } })
        ]));
      }
    }

    // 對刀模式：房主選，其他人只看
    panel.appendChild(arenaModePicker("roomMode", room.mode(), function (v) { room.setMode(v); }, !(room.isHost() && lobbyOpen)));

    // 房主：AI 對手刀・開打
    if (room.isHost() && lobbyOpen) {
      panel.appendChild(el("div", { class: "kt-mg-title", text: t("kt_net_host_tools") }));
      var count = room.fighterCount();
      D.NPC_SWORDS.forEach(function (n) {
        var on = !!(room.npc && room.npc[n.id]);
        panel.appendChild(el("label", { class: "kt-check" }, [
          el("input", { type: "checkbox", checked: on, disabled: !on && count >= Net.MAX_FIGHTERS, onchange: function (ev) { room.setNpc(n.id, ev.target.checked); } }), " " + npcName(n)
        ]));
      });
      var can = room.canStart();
      panel.appendChild(el("div", { class: "kt-actions" }, [
        el("button", { type: "button", class: "kt-primary kt-room-start", text: t("kt_net_start"), disabled: !can, onclick: function () {
          room.start(function (id) { var n = Core.byId(D.NPC_SWORDS, id); return n ? Core.npcSnapshot(n) : null; },
            function (id) { var n = Core.byId(D.NPC_SWORDS, id); return n ? npcName(n) : id; },
            function (k) { return t("kt_net_anon", { n: k }); });
        } }),
        can ? null : el("span", { class: "kt-muted", text: t("kt_net_start_need") })
      ]));
    } else if (lobbyOpen) {
      panel.appendChild(el("p", { class: "kt-muted", text: t("kt_net_wait_start") }));
    }
    panel.appendChild(foot());
    return panel;
  }

  // ---------------- 對刀實驗場：直接輸入刀的數據來看對刀（使用者指定 2026-10-20） ----------------
  // 不經過鍛刀，直接設定刀種・尺寸・硬度・韌性・鋒利・覺醒招式，開打或批次模擬看勝率。
  // 質量與耐久照遊戲公式自動算（質量＝bladeMassKg、耐久＝60＋韌性×0.6＋質量×20，同 Core.stats）。
  // 設定存在 localStorage["pritest-katana-lab"]（只是方便，讀不到就用預設）。
  var LAB_KEY = "pritest-katana-lab";
  var LAB_MAX = 8;
  var LAB_PRESETS = [
    { type: "uchigatana", special: "hinokokyu", hardness: 61, toughness: 62, sharpness: 80, human: true },
    { type: "guandao", special: "honoo", hardness: 58, toughness: 72, sharpness: 62 },
    { type: "kris", special: "jakou", hardness: 48, toughness: 66, sharpness: 55 },
    { type: "rapier", special: "mushi", hardness: 50, toughness: 74, sharpness: 60 }
  ];

  function mid(r) { return Math.round((r[0] + r[1]) / 2 * 10) / 10; }

  function labCalc(x) {
    var bt = Core.byId(D.BLADE_TYPES, x.type), tk = Core.byId(D.TSUKURI, bt.tsukuri[0]);
    x.mass = Math.round(Core.bladeMassKg(x.length, x.mihaba, x.kasane, tk.area) * 100) / 100;
    x.integrity = Math.round(Core.clamp(60 + x.toughness * 0.6 + x.mass * 20, 20, 160));
    return x;
  }

  function labBlade(p) {
    var bt = Core.byId(D.BLADE_TYPES, p.type) || D.BLADE_TYPES[2];
    return labCalc({ type: bt.id, name: p.name || L(bt.name), special: p.special || "", human: !!p.human,
      length: Math.round(mid(bt.ideal)), mihaba: Math.round(mid(bt.width)), kasane: mid(bt.kasane), sori: Math.round(mid(bt.sori)),
      hardness: p.hardness || Math.round(mid(bt.hrc)), toughness: p.toughness || 60, sharpness: p.sharpness || 60 });
  }

  function labState() {
    if (ui.lab) return ui.lab;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(LAB_KEY) || "null"); } catch (e) { saved = null; }
    if (saved && Array.isArray(saved.blades) && saved.blades.every(function (x) { return Core.byId(D.BLADE_TYPES, x.type); })) ui.lab = { blades: saved.blades.map(labCalc), batch: null, mode: saved.mode === "shiai" ? "shiai" : "koma" };
    else ui.lab = { blades: LAB_PRESETS.map(labBlade), batch: null, mode: "koma" };
    return ui.lab;
  }

  function labSave() { try { localStorage.setItem(LAB_KEY, JSON.stringify({ blades: ui.lab.blades, mode: ui.lab.mode })); } catch (e) { /* 只是記不住 */ } }

  // 實驗場的刀 → 對刀場用的快照（經 sanitizeSnap 夾在合法範圍）
  function labSnap(x) {
    var bt = Core.byId(D.BLADE_TYPES, x.type);
    return sanitizeSnap({ v: 1, name: x.name, smith: "", type: x.type, length: x.length, sori: x.sori, mihaba: x.mihaba, kasane: x.kasane,
      tsukuri: bt.tsukuri[0], kissaki: bt.kissaki[0], soriType: bt.soriType[0], hamon: bt.ht === "diff" ? "suguha" : "none", ashi: false,
      edges: bt.edges, wave: !!bt.wave, crack: false, special: x.special || null, grade: 3, total: 0, flaws: [],
      stats: { hardness: x.hardness, toughness: x.toughness, sharpness: x.sharpness, mass: x.mass, integrity: x.integrity, chip: 1 } });
  }

  function labFighters(forceAi) {
    return ui.lab.blades.map(function (x, i) {
      return { id: "L" + (i + 1), name: (i + 1) + ". " + x.name, human: forceAi ? false : !!x.human, snap: labSnap(x) };
    });
  }

  function typeSelect(value, onPick) {
    var sel = el("select", { class: "kt-text", onchange: function (ev) { onPick(ev.target.value); } });
    [["nihonto", "kt_f_type_nihonto"], ["chinese", "kt_f_type_chinese"], ["famous", "kt_f_type_famous"], ["rare", "kt_f_type_rare"]].forEach(function (g) {
      var og = el("optgroup", { label: t(g[1]) });
      D.BLADE_TYPES.filter(function (o) { return o.family === g[0]; }).forEach(function (o) {
        og.appendChild(el("option", { value: o.id, selected: o.id === value, text: L(o.name) }));
      });
      sel.appendChild(og);
    });
    return sel;
  }

  function specialSelect(value, onPick) {
    var sel = el("select", { class: "kt-text", onchange: function (ev) { onPick(ev.target.value); } });
    sel.appendChild(el("option", { value: "", selected: !value, text: t("kt_lab_no_special") }));
    D.SPECIAL_GROUPS.forEach(function (g) {
      var og = el("optgroup", { label: L(g.name) });
      D.SPECIALS.filter(function (sp) { return sp.group === g.id; }).forEach(function (sp) {
        og.appendChild(el("option", { value: sp.id, selected: sp.id === value, text: L(sp.name) }));
      });
      sel.appendChild(og);
    });
    return sel;
  }

  function labCard(x, i) {
    var lab = ui.lab;
    var bt = Core.byId(D.BLADE_TYPES, x.type);
    var info = el("div", { class: "kt-muted kt-lab-info" });
    var preview = el("div", { class: "kt-lab-preview" });
    function refresh() {
      labCalc(x);
      var snap = labSnap(x), prof = window.PriTestKatanaArena.profile(snap);
      info.textContent = t("kt_lab_calc", { mass: x.mass, hp: x.integrity }) + "・" + L(D.ARENA_STYLES[prof.style].name) +
        (prof.traits.length ? "・" + prof.traits.map(function (tr) { return L(D.ARENA_TRAITS[tr].name); }).join("、") : "");
      preview.innerHTML = "";
      preview.appendChild(bladeSvg(snap));
      labSave();
    }
    function sl(label, key, min, max, stepv, unit) {
      return field(label, slider(min, max, stepv, x[key], function (v) { return v + (unit || ""); }, function (v) { x[key] = v; refresh(); }));
    }
    var card = el("div", { class: "kt-lab-card" }, [
      el("div", { class: "kt-lab-head" }, [
        el("strong", { text: "#" + (i + 1) }),
        el("input", { type: "text", class: "kt-text", maxlength: "16", value: x.name, oninput: function (ev) { x.name = ev.target.value; labSave(); } }),
        el("button", { type: "button", class: "kt-chip" + (x.human ? " kt-chip-on" : ""), text: x.human ? t("kt_duel_human") : "AI",
          onclick: function () { x.human = !x.human; labSave(); rerenderKeepScroll(); } }),
        lab.blades.length > 2 ? el("button", { type: "button", class: "kt-link", text: t("kt_remove"), onclick: function () { lab.blades.splice(i, 1); labSave(); rerenderKeepScroll(); } }) : null
      ]),
      field(t("kt_lab_type"), typeSelect(x.type, function (v) {
        var nb = labBlade({ type: v, special: x.special, hardness: x.hardness, toughness: x.toughness, sharpness: x.sharpness, human: x.human });
        lab.blades[i] = nb; labSave(); rerenderKeepScroll();
      })),
      field(t("kt_lab_special"), specialSelect(x.special, function (v) { x.special = v; labSave(); })),
      preview,
      el("div", { class: "kt-lab-sliders" }, [
        sl(t("kt_f_length"), "length", bt.min, bt.max, 1, " cm"),
        sl(t("kt_f_mihaba"), "mihaba", Math.max(8, bt.width[0] - 10), Math.min(90, bt.width[1] + 10), 1, " mm"),
        sl(t("kt_f_kasane"), "kasane", 0.5, 12, 0.5, " mm"),
        sl(t("kt_s_sori"), "sori", Math.max(-60, bt.sori[0] - 40), Math.min(260, bt.sori[1] + 40), 1, " mm"),
        sl("HRC", "hardness", 40, 66, 0.5, ""),
        sl(t("kt_st_tough"), "toughness", 5, 100, 1, ""),
        sl(t("kt_st_sharp"), "sharpness", 0, 100, 1, "")
      ]),
      info
    ]);
    refresh();
    return card;
  }

  function labPanel(open) {
    var lab = labState();
    var box = el("details", { class: "kt-panel kt-lab", open: open || ui.labOpen }, [el("summary", { text: t("kt_lab_title") })]);
    box.addEventListener("toggle", function () { ui.labOpen = box.open; });
    box.appendChild(el("p", { class: "kt-muted", text: t("kt_lab_intro") }));
    var grid = el("div", { class: "kt-lab-grid" });
    lab.blades.forEach(function (x, i) { grid.appendChild(labCard(x, i)); });
    box.appendChild(grid);
    box.appendChild(el("div", { class: "kt-actions" }, [
      lab.blades.length < LAB_MAX ? el("button", { type: "button", text: t("kt_lab_add"), onclick: function () {
        lab.blades.push(labBlade(LAB_PRESETS[lab.blades.length % LAB_PRESETS.length])); labSave(); rerenderKeepScroll();
      } }) : null,
      el("button", { type: "button", class: "kt-link", text: t("kt_lab_reset"), onclick: function () {
        lab.blades = LAB_PRESETS.map(labBlade); lab.batch = null; labSave(); rerenderKeepScroll();
      } })
    ]));
    box.appendChild(arenaModePicker("labMode", lab.mode, function (v) { lab.mode = v; lab.batch = null; labSave(); rerenderKeepScroll(); }));
    box.appendChild(el("div", { class: "kt-actions" }, [
      el("button", { type: "button", class: "kt-primary", text: t("kt_lab_go"), onclick: function () {
        var fs = labFighters(false), names = {};
        fs.forEach(function (f) { names[f.id] = f.name; });
        ui.duel = { arena: window.PriTestKatanaArena.create({ seed: String(Date.now()), fighters: fs, mode: lab.mode }), uidOf: {}, result: null, names: names };
        window.scrollTo(0, 0);
        render();
      } }),
      el("button", { type: "button", text: t("kt_lab_batch", { n: 100 }), onclick: function () { labBatch(100); rerenderKeepScroll(); } })
    ]));
    if (lab.batch) box.appendChild(labBatchTable(lab.batch));
    return box;
  }

  // 全員 AI 打 n 場：勝率・平均存活時間・平均剩餘耐久・平均造成損傷
  function labBatch(n) {
    var Arena = window.PriTestKatanaArena;
    var fs = labFighters(true);
    var acc = {};
    fs.forEach(function (f) { acc[f.id] = { name: f.name, win: 0, dealt: 0, hp: 0, alive: 0 }; });
    var time = 0;
    for (var k = 0; k < n; k++) {
      var res = Arena.run(Arena.create({ seed: "lab" + k + "|" + Date.now(), fighters: fs, mode: ui.lab.mode }));
      time += res.time;
      acc[res.winner].win++;
      res.summary.forEach(function (sm) { var o = acc[sm.id]; o.dealt += sm.dealt; o.hp += sm.hp / sm.maxHp; if (sm.alive) o.alive++; });
    }
    ui.lab.batch = { n: n, time: time / n, rows: fs.map(function (f) { return acc[f.id]; }) };
  }

  function labBatchTable(b) {
    var head = el("tr", {}, ["", "kt_lab_col_win", "kt_lab_col_dealt", "kt_lab_col_hp"].map(function (k) { return el("th", { text: k ? t(k) : "" }); }));
    var rows = b.rows.slice().sort(function (x, y) { return y.win - x.win; }).map(function (r) {
      var fill = el("div", { class: "kt-bar-fill" });
      fill.style.width = (r.win / b.n * 100) + "%";
      return el("tr", {}, [el("th", { text: r.name }),
        el("td", {}, [el("div", { class: "kt-lab-winbar" }, [el("div", { class: "kt-bar" }, [fill]), el("span", { text: Math.round(r.win / b.n * 100) + "%" })])]),
        el("td", { text: String(Math.round(r.dealt / b.n)) }), el("td", { text: Math.round(r.hp / b.n * 100) + "%" })]);
    });
    return el("div", { class: "kt-lab-batch" }, [
      el("p", { class: "kt-muted", text: t("kt_lab_batch_note", { n: b.n, s: b.time.toFixed(1) }) }),
      el("div", { class: "kt-scroll" }, [el("table", { class: "kt-table" }, [head].concat(rows))])
    ]);
  }

  function renderDuel() {
    var du = ui.duel;
    function nameOf(id) { return du.names[id] || id; }
    if (du.online) { renderOnlineDuel(du, nameOf); return; }
    app.appendChild(el("h2", { text: t("kt_duel_title") }));
    if (du.result) {
      app.appendChild(el("div", { class: "kt-panel kt-result" }, [
        el("h3", { text: t("kt_clash_winner", { name: nameOf(du.result.winner) }) }),
        arenaResultTable(du.result, nameOf),
        el("div", { class: "kt-actions" }, [
          el("button", { type: "button", class: "kt-primary", text: t("kt_duel_again"), onclick: function () {
            var fs = du.arena.fighters.map(function (f) { return { id: f.id, name: f.name, human: f.human, snap: f.snap }; });
            ui.duel = { arena: window.PriTestKatanaArena.create({ seed: String(Date.now()), fighters: fs, mode: du.arena.mode }), uidOf: du.uidOf, result: null, names: du.names };
            render();
          } }),
          el("button", { type: "button", text: t("kt_duel_back"), onclick: function () { ui.duel = null; render(); } })
        ])
      ]));
      return;
    }
    app.appendChild(el("p", { class: "kt-muted", text: t(du.arena.mode === "shiai" ? "kt_amode_shiai_howto" : "kt_ar_howto") }));
    app.appendChild(arenaView(du.arena, function (res) {
      du.result = res;
      recordResult(res, du.uidOf);
      render();
    }));
    app.appendChild(el("div", { class: "kt-footer-tools" }, [
      el("button", { type: "button", class: "kt-link", text: t("kt_duel_quit"), onclick: function () { ui.duel = null; render(); } })
    ]));
  }

  function renderOnlineDuel(du, nameOf) {
    var room = ui.room;
    app.appendChild(el("h2", { text: t("kt_net_duel_title") }));
    if (du.result) {
      var isHost = room && room.isHost();
      app.appendChild(el("div", { class: "kt-panel kt-result" }, [
        el("h3", { text: t("kt_clash_winner", { name: nameOf(du.result.winner) }) }),
        arenaResultTable(du.result, nameOf),
        el("div", { class: "kt-actions" }, [
          el("button", { type: "button", class: "kt-primary kt-net-back", text: t("kt_net_back_room"), onclick: function () {
            if (isHost) room.backToLobby();
            ui.duelDoneNo = du.no;
            ui.duel = null;
            render();
          } }),
          el("button", { type: "button", class: "kt-link", text: t("kt_net_leave"), onclick: leaveRoom })
        ])
      ]));
      return;
    }
    app.appendChild(el("p", { class: "kt-muted", text: t(du.arena.mode === "shiai" ? "kt_amode_shiai_howto" : "kt_net_howto") }));
    app.appendChild(arenaView(du.arena, function (res) {
      du.result = res;
      du.net.dispose();
      recordResult(res, du.uidOf);
      render();
    }, du.net));
    app.appendChild(el("div", { class: "kt-footer-tools" }, [
      el("button", { type: "button", class: "kt-link", text: t("kt_net_quit"), onclick: leaveRoom })
    ]));
  }

  // 這局某位玩家的刀在刀鞘裡的 uid：第一次收入時配亂數 uid 記在刀身（b.scUid）；
  // 舊版以「seed|玩家id」收過的刀沿用舊 uid；還沒收過回傳 null
  function bladeScUid(p) {
    var legacyUid = state.seed + "|" + p.id;
    return p.blade.scUid || (scabbardFind(legacyUid) ? legacyUid : null);
  }

  // 審查・總結畫面的刀卡下方：刀號（命名）・覺醒招式・收入刀鞘
  function nameAndSheathe(p) {
    var b = p.blade;
    var uid = bladeScUid(p);
    var sp = b.special ? Core.byId(D.SPECIALS, b.special) : null;
    var inSc = !!(uid && scabbardFind(uid));
    var full = !inSc && scabbardFull();
    var nameInput = el("input", { type: "text", class: "kt-text", maxlength: "24", value: b.swordName || "", placeholder: t("kt_name_sword_ph"),
      oninput: function (ev) { b.swordName = ev.target.value; save(); } });
    return el("div", { class: "kt-naming" }, [
      sp ? el("div", { class: "kt-awaken" }, [el("strong", { text: t("kt_sp_awaken", { name: L(sp.name) }) }), el("div", { class: "kt-muted", text: L(sp.cond) + "：" + L(sp.desc) })])
        : el("div", { class: "kt-muted", text: t("kt_sp_none") }),
      field(t("kt_name_sword"), nameInput),
      el("div", { class: "kt-actions" }, [
        el("button", { type: "button", class: inSc ? "" : "kt-primary", text: inSc ? t("kt_sc_update") : t("kt_sc_put"), disabled: full, onclick: function () {
          if (!uid) { uid = newUid(); b.scUid = uid; save(); }
          var snap = Core.swordSnapshot(b, { smith: p.name });
          snap.uid = uid;
          sheathe(uid, snap, false);
          rerenderKeepScroll();
        } }),
        inSc ? el("span", { class: "kt-good", text: t("kt_sc_in") }) : null,
        full ? el("span", { class: "kt-error", text: t("kt_sc_full", { max: SCABBARD_MAX }) }) : null
      ])
    ]);
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
    var placing = state.clash && state.clash.summary ? state.clash.summary : [];
    rows.forEach(function (r) {
      var p = state.players.filter(function (x) { return x.id === r.id; })[0];
      var f = placing.filter(function (x) { return x.id === r.id; })[0];
      var card = swordCard(p, 0, f ? { chips: f.chips, broken: !f.alive } : null);
      card.appendChild(nameAndSheathe(p));
      app.appendChild(card);
    });
    app.appendChild(el("div", { class: "kt-actions" }, [
      el("button", { type: "button", class: "kt-primary", text: t("kt_new_game"), onclick: function () { state = null; save(); render(); } })
    ]));
  }

  // ---------------- 主 render ----------------

  function render() {
    stopAnim();
    app.innerHTML = "";
    if (ui.duel) { renderDuel(); return; }
    if (!state) { renderSetup(); return; }
    if (state.phase === "forge" || ui.result) renderForge(); // 最後一道工序的結果也要先看完再進審查
    else if (state.phase === "judge") renderJudge();
    else if (state.phase === "cut") renderCut();
    else if (state.phase === "clash") renderClash();
    else renderEnd();
  }

  state = null;
  (function readRoom() {
    var id = window.PriTestKatanaNet ? window.PriTestKatanaNet.roomFromUrl(location.search) : null;
    if (id) openRoom(id);
  })();
  (function readInvite() {
    var m = location.search.match(/[?&]duel=([A-Za-z0-9_-]+)/);
    var snap = m ? decodeSnap(m[1]) : null;
    if (!snap) return;
    ui.invite = snap;
    lobbyAddGuest(snap);
    // 預設：自己刀鞘裡的第一把刀迎戰
    var mine = scabbardLoad().swords.filter(function (x) { return !x.guest; })[0];
    if (mine) lobby().pick[mine.uid] = true;
    else lobby().npc.sato = true;
  })();
  window.addEventListener("i18n:change", render);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();

  // 測試用
  window.PriTestKatana = { _state: function () { return state; }, _ui: function () { return ui; }, _render: render,
    _scabbard: scabbardLoad, _encode: encodeSnap, _decode: decodeSnap,
    _scExport: scabbardExportCode, _scParse: parseScabbardExport, _scImport: scabbardImport, _scMax: SCABBARD_MAX,
    // 美術參考圖（tools/katana_art/build_prompt_book.js 用）：每個刀種的標準刀形，用遊戲本身的繪圖輸出
    _artRef: {
      snap: function (type) { return labSnap(labBlade({ type: type })); },
      side: function (type) { return bladeSvg(labSnap(labBlade({ type: type }))).outerHTML; },
      // 俯視：畫在 canvas 正中央，刀尖朝右、離中心約 45%（長柄兵器 38%，柄才放得下）；柄卷畫成淺灰
      top: function (canvas, type, color) {
        var snap = labSnap(labBlade({ type: type }));
        var bt = Core.byId(D.BLADE_TYPES, type);
        var S = canvas.width, ctx = canvas.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, S, S);
        ctx.translate(S / 2, S / 2);
        var pole = !!bt.shaft || bt.id === "yari";
        // drawBlade 的 s 是場地縮放（中心圓點也乘它），所以用 radius 決定大小、s 固定 1
        drawBlade(ctx, { snap: snap, prof: { radius: S * (pole ? 0.38 : 0.45) }, rot: 0, color: color || "#c8c8c8" }, 1);
      }
    } };
})();
