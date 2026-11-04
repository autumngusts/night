// 賽狗賽狗（saigo）：真賽狗模式的麥克風——對自己的狗喊「賽狗」（2026-11-02 使用者指定）。
// 有語音辨識（Chrome／Edge／Safari 的 SpeechRecognition）就辨識關鍵字；沒有的瀏覽器改用音量偵測（大聲喊一聲就算）。
// 只負責偵測，喊到之後由 saigo.js 送出比賽指令（{ a: "shout" }），效果在 saigo_real.js。
(function () {
  "use strict";

  // 「賽狗」的各種辨識結果（2026-11-04 使用者指定「喊賽狗要更精確，可以顯示系統讀到什麼文字」）：
  //   中文辨識常把「賽狗」聽成同音／近音字，改成「sai 音的字＋gou 音的字」任意組合都算（中間可夾一個標點或空白）；
  //   日文的「さいご」常被轉成「最後／最期」；英文／拼音的 saigo、sai gou。
  var SAI = "賽赛塞曬晒腮鰓鳃顋", GOU = "狗够夠購购構构溝沟勾鉤钩苟垢";
  var WORDS = new RegExp("[" + SAI + "][\\s、，,。.]?[" + GOU + "]|さいご|サイゴ|最後|最后|最期|sai[ -]?gou?|sigh[ -]?go", "gi");
  function hitCount(txt) { return (String(txt || "").match(WORDS) || []).length; }
  var GAP_MS = 1200;

  function Rec() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
  function supported() { return !!(Rec() || (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)); }

  // onShout()：偵測到一次喊聲；onState(state)：listening／error；lang：zh／ja／en
  // onHeard(text, hit, final)：語音辨識讀到的文字（暫定結果也會送；hit＝這段裡有沒有「賽狗」），給畫面顯示
  function start(onShout, onState, lang, onHeard) {
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
      rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 4;
      // 支援的瀏覽器（Chrome 新版的 contextual biasing）：提示辨識器優先聽成「賽狗」
      try {
        if (window.SpeechRecognitionPhrase && "phrases" in rec) {
          rec.phrases = (lang === "ja" ? ["さいご", "サイゴ"] : ["賽狗", "賽狗賽狗"]).map(function (w) { return new window.SpeechRecognitionPhrase(w, 8); });
        }
      } catch (err) { /* 不支援就算了 */ }
      var seen = {};
      rec.onresult = function (e) {
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var res = e.results[i], best = res[0].transcript, hits = 0, shown = best;
          // 每個候選都看：第一候選沒聽成「賽狗」、但其他候選有，也算（顯示命中的那一個）
          for (var a = 0; a < res.length; a++) {
            var h = hitCount(res[a].transcript);
            if (h > hits) { hits = h; shown = res[a].transcript; }
          }
          if (onHeard && alive) onHeard(String(shown || "").trim(), hits > 0, !!res.isFinal);
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

  window.PriTestSaigoMic = { supported: supported, start: start, WORDS: WORDS, hitCount: hitCount };
})();
