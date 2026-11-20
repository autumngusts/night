/* イヌスノー（狗雪）操作輸入（docs/inusnow_design.md §10）：拖曳、陀螺儀、鍵盤 → 每個物理步的量化輸入 {s, c, j, g}。
   只負責讀取裝置輸入，不含規則。 */
(function (root) {
  "use strict";

  var DRAG_FULL = 60;       // 左右拖 60 px＝滿格轉向（暫定）
  var TUCK_PX = 40;         // 往下拖 40 px＝蹲低
  var FLICK_PX = 30;        // 放開前 150 ms 內往上滑 30 px＝起跳
  var FLICK_MS = 150;
  var TILT_FULL = 25;       // 傾斜 25°＝滿格
  var KEY_RAMP_MS = 200;    // 按住方向鍵 0.2 秒內漸增到滿格

  var mode = "drag";
  var el = null;
  var ptr = null;            // {id, x0, y0, x, y, hist: [[t, y]]}
  var jumpQueued = false;
  var keys = { left: 0, right: 0, down: false };
  var tilt = { gamma: 0, ok: false };
  var listening = false;

  function now() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }

  function onDown(e) {
    if (ptr) return;
    ptr = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, hist: [[now(), e.clientY]] };
    if (el && el.setPointerCapture && e.pointerId !== undefined) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* 不支援 */ } }
  }
  function onMove(e) {
    if (!ptr || (e.pointerId !== undefined && ptr.id !== undefined && e.pointerId !== ptr.id)) return;
    ptr.x = e.clientX; ptr.y = e.clientY;
    var t = now();
    ptr.hist.push([t, e.clientY]);
    while (ptr.hist.length > 2 && t - ptr.hist[0][0] > FLICK_MS) ptr.hist.shift();
  }
  function onUp(e) {
    if (!ptr) return;
    if (e && e.clientY !== undefined) onMove(e);
    var t = now(), h = ptr.hist, first = null;
    for (var i = 0; i < h.length; i++) if (t - h[i][0] <= FLICK_MS) { first = h[i]; break; }
    if (first && first[1] - ptr.y > FLICK_PX) jumpQueued = true;
    ptr = null;
  }
  function onKey(e, down) {
    var k = e.key;
    if (k === "ArrowLeft") keys.left = down ? (keys.left || now()) : 0;
    else if (k === "ArrowRight") keys.right = down ? (keys.right || now()) : 0;
    else if (k === "ArrowDown") keys.down = down;
    else if (k === " " || k === "ArrowUp") { if (down && !e.repeat) jumpQueued = true; }
    else return;
    e.preventDefault();
  }
  function onOrient(e) {
    if (e.gamma === null || e.gamma === undefined) return;
    tilt.gamma = e.gamma; tilt.ok = true;
  }

  function attach(target) {
    el = target;
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    if (!listening) {
      root.addEventListener("keydown", function (e) { onKey(e, true); });
      root.addEventListener("keyup", function (e) { onKey(e, false); });
      root.addEventListener("deviceorientation", onOrient);
      listening = true;
    }
  }

  // iOS 13+：要在使用者操作中呼叫 requestPermission。回傳 Promise<bool>
  function enableTilt() {
    var DOE = root.DeviceOrientationEvent;
    if (!DOE) return Promise.resolve(false);
    if (typeof DOE.requestPermission === "function") {
      return DOE.requestPermission().then(function (r) { return r === "granted"; }, function () { return false; });
    }
    return Promise.resolve(true);
  }

  function setMode(m) { mode = m === "tilt" ? "tilt" : "drag"; }

  function clampS(v) { v = Math.round(v); return v > 8 ? 8 : v < -8 ? -8 : v; }

  // 每個物理步呼叫一次
  function sample() {
    var s = 0, c = 0, j = 0;
    var t = now();
    if (keys.left || keys.right) {
      var l = keys.left ? Math.min(1, (t - keys.left) / KEY_RAMP_MS) : 0;
      var r = keys.right ? Math.min(1, (t - keys.right) / KEY_RAMP_MS) : 0;
      s = clampS((r - l) * 8);
    } else if (mode === "tilt" && tilt.ok) {
      var orient = (root.screen && root.screen.orientation && root.screen.orientation.angle) || root.orientation || 0;
      var gmm = tilt.gamma;
      if (orient === 90) gmm = -gmm;               // 橫拿時方向相反（簡化：只處理 gamma）
      s = clampS(gmm / TILT_FULL * 8);
    } else if (ptr) {
      s = clampS((ptr.x - ptr.x0) / DRAG_FULL * 8);
    }
    if (keys.down || (ptr && ptr.y - ptr.y0 > TUCK_PX)) c = 1;
    if (jumpQueued) { j = 1; jumpQueued = false; }
    return { s: s, c: c, j: j, g: 0 };
  }

  function reset() { ptr = null; jumpQueued = false; keys.left = 0; keys.right = 0; keys.down = false; }

  var Input = { attach: attach, enableTilt: enableTilt, setMode: setMode, sample: sample, reset: reset, tiltReady: function () { return tilt.ok; } };
  root.PriTestInusnowInput = Input;
})(typeof window !== "undefined" ? window : globalThis);
