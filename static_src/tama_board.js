// 百鬼轉珠（tama）：盤面的 Canvas 繪製與轉珠操作（§3）。
// - 珠子：漸層球＋屬性字，依格子大小預先畫在離屏 canvas 上。
// - 轉珠：pointerdown 抓起一顆，移到相鄰（含斜向）格子就交換；手指移動太快跳格時，逐格補上路徑。
//   時間從第一次交換開始倒數，時間到或放手即結束；沒交換過就放手不算一回合。
// - 結算演出：依 Core.resolve 的 steps，逐組消除（顯示連擊數）→ 落下 → 下一段連鎖。
(function () {
  "use strict";

  var Core = window.PriTestTamaCore;
  if (!Core) return;
  var ROWS = Core.ROWS, COLS = Core.COLS;

  var ORB_STYLE = {
    fire:  { a: "#ffd2a0", b: "#e8402a", c: "#7a1408", ch: "火" },
    water: { a: "#c8ecff", b: "#2a86e0", c: "#0a2a6a", ch: "水" },
    wood:  { a: "#d8ffc0", b: "#3aa83a", c: "#0f4a12", ch: "木" },
    light: { a: "#fff8c8", b: "#f0c020", c: "#7a5a00", ch: "光" },
    dark:  { a: "#ecc8ff", b: "#8a3ad0", c: "#32104a", ch: "闇" },
    heart: { a: "#ffe0ee", b: "#f060a0", c: "#7a1040", ch: "心" },
    jam:   { a: "#c8c8c8", b: "#5a5a64", c: "#1a1a1e", ch: "邪" }
  };

  function easeOut(t) { return 1 - (1 - t) * (1 - t); }

  function create(host, opts) {
    var canvas = document.createElement("canvas");
    canvas.className = "tm-canvas";
    host.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    var cell = 40, dpr = 1, sprites = {};
    var board = null;
    var enabled = false;
    var drag = null;      // { r, c, x, y, moved, start }
    var anim = null;      // 正在演出的動畫狀態
    var raf = 0;
    var limitMs = 5000;

    function makeSprites() {
      sprites = {};
      var size = Math.round(cell * dpr);
      Object.keys(ORB_STYLE).forEach(function (k) {
        var s = ORB_STYLE[k], cv = document.createElement("canvas");
        cv.width = cv.height = size;
        var g = cv.getContext("2d"), R = size / 2, rr = R * 0.86;
        var grd = g.createRadialGradient(R * 0.7, R * 0.6, rr * 0.1, R, R, rr);
        grd.addColorStop(0, s.a); grd.addColorStop(0.55, s.b); grd.addColorStop(1, s.c);
        g.fillStyle = grd;
        g.beginPath(); g.arc(R, R, rr, 0, Math.PI * 2); g.fill();
        g.lineWidth = Math.max(1, size * 0.03); g.strokeStyle = "rgba(255,255,255,0.55)"; g.stroke();
        g.fillStyle = "rgba(255,255,255,0.55)";
        g.beginPath(); g.ellipse(R * 0.72, R * 0.55, rr * 0.32, rr * 0.18, -0.6, 0, Math.PI * 2); g.fill();
        g.font = "bold " + Math.round(size * 0.42) + "px 'Noto Serif TC','Noto Serif JP','Yu Mincho',serif";
        g.textAlign = "center"; g.textBaseline = "middle";
        g.lineWidth = size * 0.06; g.strokeStyle = s.c; g.strokeText(s.ch, R, R + size * 0.03);
        g.fillStyle = "#fff"; g.fillText(s.ch, R, R + size * 0.03);
        sprites[k] = cv;
      });
    }

    function layout() {
      var w = host.clientWidth || 360;
      cell = Math.floor(w / COLS);
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(cell * COLS * dpr);
      canvas.height = Math.round(cell * ROWS * dpr);
      canvas.style.width = cell * COLS + "px";
      canvas.style.height = cell * ROWS + "px";
      makeSprites();
      draw();
    }

    function drawOrb(k, x, y, scale, alpha) {
      if (!k || !sprites[k]) return;
      var s = cell * (scale || 1);
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.drawImage(sprites[k], (x - s / 2) * dpr, (y - s / 2) * dpr, s * dpr, s * dpr);
      ctx.globalAlpha = 1;
    }

    function drawGrid() {
      for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) {
          ctx.fillStyle = (r + c) % 2 ? "rgba(40,28,22,0.92)" : "rgba(58,40,30,0.92)";
          ctx.fillRect(c * cell * dpr, r * cell * dpr, cell * dpr + 1, cell * dpr + 1);
        }
      }
    }

    function drawComboText() {
      if (!anim || !anim.combo) return;
      ctx.save();
      ctx.font = "bold " + Math.round(cell * 0.7 * dpr) + "px 'Noto Serif TC','Noto Serif JP',serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 5 * dpr; ctx.strokeStyle = "#3a0a0a";
      ctx.fillStyle = "#ffd75a";
      var txt = anim.combo + " Combo";
      ctx.strokeText(txt, canvas.width / 2, canvas.height / 2);
      ctx.fillText(txt, canvas.width / 2, canvas.height / 2);
      ctx.restore();
    }

    function draw() {
      if (!board) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawGrid();
      var r, c;
      if (anim && anim.kind === "fall") {
        var t = easeOut(Math.min(1, (performance.now() - anim.start) / anim.dur));
        var moving = {};
        anim.falls.forEach(function (f) { moving[f.to + "," + f.c] = f; });
        for (r = 0; r < ROWS; r++) {
          for (c = 0; c < COLS; c++) {
            var f = moving[r + "," + c];
            var y = f ? (f.from + (f.to - f.from) * t) : r;
            if (f && y < -0.5) continue;
            drawOrb(anim.board[r][c], (c + 0.5) * cell, (y + 0.5) * cell);
          }
        }
      } else if (anim && anim.kind === "clear") {
        var now = performance.now();
        for (r = 0; r < ROWS; r++) {
          for (c = 0; c < COLS; c++) {
            var gi = anim.groupOf[r + "," + c];
            if (gi == null) { drawOrb(anim.board[r][c], (c + 0.5) * cell, (r + 0.5) * cell); continue; }
            var t0 = anim.start + gi * anim.per, p = Math.max(0, Math.min(1, (now - t0) / anim.per));
            if (p >= 1) continue;
            drawOrb(anim.board[r][c], (c + 0.5) * cell, (r + 0.5) * cell, 1 + p * 0.35, 1 - p);
          }
        }
        drawComboText();
      } else if (anim && anim.kind === "flash") {
        var fp = Math.min(1, (performance.now() - anim.start) / anim.dur);
        for (r = 0; r < ROWS; r++) {
          for (c = 0; c < COLS; c++) {
            var hl = anim.cells[r + "," + c];
            drawOrb(board[r][c], (c + 0.5) * cell, (r + 0.5) * cell, hl ? 1 + Math.sin(fp * Math.PI) * 0.25 : 1);
          }
        }
      } else {
        for (r = 0; r < ROWS; r++) {
          for (c = 0; c < COLS; c++) {
            if (drag && drag.r === r && drag.c === c) {
              drawOrb(board[r][c], (c + 0.5) * cell, (r + 0.5) * cell, 1, 0.3);
              continue;
            }
            drawOrb(board[r][c], (c + 0.5) * cell, (r + 0.5) * cell);
          }
        }
        if (drag) drawOrb(board[drag.r][drag.c], drag.x, drag.y, 1.15);
        drawComboText();
      }
    }

    function loop() {
      raf = 0;
      if (drag && drag.start) {
        var remain = limitMs - (performance.now() - drag.start);
        if (opts.onTick) opts.onTick(Math.max(0, remain), limitMs);
        if (remain <= 0) { release(); return; }
      }
      draw();
      if (anim && anim.tick) anim.tick();
      if (drag || anim) raf = requestAnimationFrame(loop);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(loop); }

    function pointerCell(ev) {
      var rect = canvas.getBoundingClientRect();
      var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      return { x: Math.max(0, Math.min(rect.width - 1, x)), y: Math.max(0, Math.min(rect.height - 1, y)) };
    }

    function onDown(ev) {
      if (!enabled || anim || drag) return;
      var p = pointerCell(ev);
      var r = Math.floor(p.y / cell), c = Math.floor(p.x / cell);
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
      ev.preventDefault();
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
      drag = { r: r, c: c, x: p.x, y: p.y, moved: false, start: 0, id: ev.pointerId };
      if (opts.onGrab) opts.onGrab();
      kick();
    }

    function onMove(ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      ev.preventDefault();
      var p = pointerCell(ev);
      drag.x = p.x; drag.y = p.y;
      var tr = Math.floor(p.y / cell), tc = Math.floor(p.x / cell);
      // 只在手指接近格子中心時才交換，避免在格線附近來回抖動
      var cx = (tc + 0.5) * cell, cy = (tr + 0.5) * cell;
      if (Math.abs(p.x - cx) > cell * 0.42 || Math.abs(p.y - cy) > cell * 0.42) return;
      var guard = 0;
      while ((tr !== drag.r || tc !== drag.c) && guard++ < 12) {
        var nr = drag.r + (tr > drag.r ? 1 : tr < drag.r ? -1 : 0);
        var nc = drag.c + (tc > drag.c ? 1 : tc < drag.c ? -1 : 0);
        var tmp = board[drag.r][drag.c];
        board[drag.r][drag.c] = board[nr][nc];
        board[nr][nc] = tmp;
        drag.r = nr; drag.c = nc;
        if (!drag.start) drag.start = performance.now();
        drag.moved = true;
      }
    }

    function release() {
      if (!drag) return;
      var moved = drag.moved;
      drag = null;
      if (opts.onTick) opts.onTick(limitMs, limitMs);
      draw();
      if (opts.onRelease) opts.onRelease(moved);
    }
    function onUp(ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      release();
    }

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    window.addEventListener("resize", layout);

    // 依 steps 演出消除與落下；每消一組呼叫 onCombo(累計連擊數)，全部結束呼叫 done
    function playResolve(steps, done) {
      var combo = 0, si = 0;
      function nextStep() {
        if (si >= steps.length) {
          anim = { kind: "hold", combo: combo, until: performance.now() + (combo ? 260 : 0), tick: function () {
            if (performance.now() >= anim.until) { anim = null; draw(); done(); }
          } };
          kick();
          return;
        }
        var st = steps[si++], groupOf = {}, base = combo;
        st.groups.forEach(function (g, gi) { g.cells.forEach(function (p) { groupOf[p[0] + "," + p[1]] = gi; }); });
        var per = 170;
        anim = { kind: "clear", board: board, groupOf: groupOf, start: performance.now(), per: per, combo: combo, tick: function () {
          var n = Math.min(st.groups.length, Math.floor((performance.now() - anim.start) / per) + 1);
          if (base + n !== anim.combo) { anim.combo = base + n; if (opts.onCombo) opts.onCombo(anim.combo); }
          if (performance.now() - anim.start >= per * st.groups.length) {
            combo = base + st.groups.length;
            anim = { kind: "fall", board: st.board, falls: st.falls, start: performance.now(), dur: 230, combo: combo, tick: function () {
              if (performance.now() - anim.start >= anim.dur) { board = st.board; nextStep(); }
            } };
          }
        } };
        kick();
      }
      nextStep();
    }

    // 技能轉珠、邪珠出現時讓指定格子跳一下
    function flash(cells, done) {
      var map = {};
      (cells || []).forEach(function (p) { map[p[0] + "," + p[1]] = 1; });
      anim = { kind: "flash", cells: map, start: performance.now(), dur: 420, tick: function () {
        if (performance.now() - anim.start >= anim.dur) { anim = null; draw(); if (done) done(); }
      } };
      kick();
    }

    layout();
    return {
      setBoard: function (b) { board = Core.cloneBoard(b); draw(); },
      getBoard: function () { return Core.cloneBoard(board); },
      setEnabled: function (v) { enabled = !!v; canvas.classList.toggle("tm-canvas-off", !enabled); },
      setTimeLimit: function (ms) { limitMs = ms; },
      playResolve: playResolve,
      flash: flash,
      relayout: layout,
      busy: function () { return !!(drag || anim); },
      destroy: function () { window.removeEventListener("resize", layout); if (raf) cancelAnimationFrame(raf); canvas.remove(); }
    };
  }

  window.PriTestTamaBoard = { create: create, ORB_STYLE: ORB_STYLE };
})();
