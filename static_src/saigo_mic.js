// 賽狗賽狗（saigo）：真賽狗模式的麥克風——對自己的狗喊「賽狗」（2026-11-02 使用者指定）。
// 有語音辨識（Chrome／Edge／Safari 的 SpeechRecognition）就辨識關鍵字；沒有的瀏覽器改用音量偵測（大聲喊一聲就算）。
// 只負責偵測，喊到之後由 saigo.js 送出比賽指令（{ a: "shout" }），效果在 saigo_real.js。
(function () {
  "use strict";

  // 「賽狗」的各種辨識結果（中文同音字、日文的「さいご」常被轉成「最後」）
  var WORDS = /賽狗|赛狗|塞狗|賽夠|赛够|曬狗|晒狗|さいご|サイゴ|最後|最后|sai ?gou|saigo/i;
  var GAP_MS = 1200;

  function Rec() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
  function supported() { return !!(Rec() || (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)); }

  // onShout()：偵測到一次喊聲；onState(state)：listening／error；lang：zh／ja／en
  function start(onShout, onState, lang) {
    var alive = true, last = 0, rec = null, stream = null, ac = null, raf = 0;
    function fire() {
      var now = Date.now();
      if (now - last < GAP_MS) return;
      last = now;
      onShout();
    }
    function state(s, why) { if (alive && onState) onState(s, why); }
    var R = Rec();
    if (R) {
      rec = new R();
      rec.lang = lang === "ja" ? "ja-JP" : lang === "en" ? "en-US" : "zh-TW";
      rec.continuous = true; rec.interimResults = true;
      var seen = {};
      rec.onresult = function (e) {
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var txt = e.results[i][0].transcript, hits = (txt.match(new RegExp(WORDS.source, "gi")) || []).length;
          // 同一段話的暫定結果會重複送來：只在關鍵字次數增加時算一次
          if (hits > (seen[i] || 0)) { seen[i] = hits; fire(); }
        }
      };
      rec.onerror = function (e) { if (e.error === "not-allowed" || e.error === "service-not-allowed") { alive = false; state("error", e.error); } };
      rec.onend = function () { seen = {}; if (alive) { try { rec.start(); } catch (err) { /* 已經在跑 */ } } };
      try { rec.start(); state("listening", "speech"); } catch (err) { state("error", String(err)); }
    } else {
      // 音量偵測：連續 0.15 秒以上很大聲＝喊了一聲
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (st) {
        if (!alive) { st.getTracks().forEach(function (tr) { tr.stop(); }); return; }
        stream = st;
        ac = new (window.AudioContext || window.webkitAudioContext)();
        var src = ac.createMediaStreamSource(st), an = ac.createAnalyser();
        an.fftSize = 1024; src.connect(an);
        var buf = new Float32Array(an.fftSize), loud = 0, prev = performance.now();
        (function loop(now) {
          if (!alive) return;
          an.getFloatTimeDomainData(buf);
          var sum = 0;
          for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          var rms = Math.sqrt(sum / buf.length), dt = (now - prev) / 1000; prev = now;
          loud = rms > 0.18 ? loud + dt : 0;
          if (loud > 0.15) { loud = -0.5; fire(); }
          raf = requestAnimationFrame(loop);
        })(prev);
        state("listening", "volume");
      }).catch(function (err) { alive = false; state("error", String(err && err.name || err)); });
    }
    return {
      method: R ? "speech" : "volume",
      stop: function () {
        alive = false;
        if (rec) { try { rec.abort(); } catch (err) { /* 已停止 */ } }
        if (raf) cancelAnimationFrame(raf);
        if (stream) stream.getTracks().forEach(function (tr) { tr.stop(); });
        if (ac) { try { ac.close(); } catch (err) { /* 已關閉 */ } }
      }
    };
  }

  window.PriTestSaigoMic = { supported: supported, start: start, WORDS: WORDS };
})();
