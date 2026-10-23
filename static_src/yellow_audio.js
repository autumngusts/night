// 黃牌 Yellow Card：音效與音樂（2026-10-23 使用者指定）。沒有音檔，全部用 Web Audio 即時合成。
//   PriTestYellowAudio.sfx(kind)      音效：play／hit／heavy／block／heal／kill／hurt／thorns／shift／turn／win／lose／click／ping／emote／gold
//   PriTestYellowAudio.scene(name)    背景音樂：null／"map"／"battle"／"boss"（同一個場景重複呼叫不會重來）
//   PriTestYellowAudio.settings()／setSfx(on)／setMusic(on)：開關存在 localStorage（每位玩家自己的偏好）
// 瀏覽器要等使用者第一次點擊後才允許出聲，所以在第一次 pointerdown 時才建立 AudioContext。
(function () {
  "use strict";

  var KEY = "pritest-yellow-audio";
  var prefs = { sfx: true, music: true };
  try { var saved = JSON.parse(localStorage.getItem(KEY) || "null"); if (saved) { prefs.sfx = saved.sfx !== false; prefs.music = saved.music !== false; } } catch (e) { /* 私密模式等 */ }
  function savePrefs() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* 只是記不住 */ } }

  var ctx = null, master = null, sfxBus = null, musicBus = null;
  var wantScene = null, curScene = null;

  function init() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = prefs.sfx ? 0.32 : 0; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = prefs.music ? 0.11 : 0; musicBus.connect(master);
    return ctx;
  }
  function unlock() {
    if (!init()) return;
    if (ctx.state === "suspended") ctx.resume();
    if (wantScene && wantScene !== curScene) startScene(wantScene);
  }
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);

  // ---------------- 音效 ----------------
  function tone(o) {
    // o：{ f, f2（滑到）, type, dur, vol, at（延遲秒）, bus }
    var t0 = ctx.currentTime + (o.at || 0);
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + o.dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.5, t0 + Math.min(0.015, o.dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g); g.connect(o.bus || sfxBus);
    osc.start(t0); osc.stop(t0 + o.dur + 0.02);
  }
  var noiseBuf = null;
  function noise(o) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var t0 = ctx.currentTime + (o.at || 0);
    var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = o.filter || "lowpass"; f.frequency.value = o.freq || 1200;
    g.gain.setValueAtTime(o.vol || 0.4, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(t0); src.stop(t0 + o.dur + 0.02);
  }

  var SFX = {
    play: function () { noise({ dur: 0.12, freq: 3200, filter: "highpass", vol: 0.25 }); tone({ f: 520, f2: 760, type: "triangle", dur: 0.09, vol: 0.18 }); },
    hit: function () { noise({ dur: 0.14, freq: 900, vol: 0.5 }); tone({ f: 180, f2: 70, type: "square", dur: 0.12, vol: 0.25 }); },
    heavy: function () { noise({ dur: 0.3, freq: 600, vol: 0.6 }); tone({ f: 120, f2: 40, type: "sawtooth", dur: 0.28, vol: 0.35 }); },
    block: function () { tone({ f: 880, type: "triangle", dur: 0.18, vol: 0.25 }); tone({ f: 1320, type: "sine", dur: 0.22, vol: 0.12, at: 0.02 }); },
    heal: function () { [660, 880, 1100].forEach(function (f, i) { tone({ f: f, type: "sine", dur: 0.22, vol: 0.18, at: i * 0.06 }); }); },
    kill: function () { noise({ dur: 0.35, freq: 1800, vol: 0.4 }); tone({ f: 440, f2: 110, type: "square", dur: 0.3, vol: 0.2 }); },
    hurt: function () { tone({ f: 260, f2: 120, type: "sawtooth", dur: 0.22, vol: 0.3 }); noise({ dur: 0.18, freq: 700, vol: 0.35 }); },
    thorns: function () { tone({ f: 1500, f2: 900, type: "square", dur: 0.08, vol: 0.15 }); tone({ f: 1200, f2: 700, type: "square", dur: 0.08, vol: 0.12, at: 0.06 }); },
    shift: function () { tone({ f: 300, f2: 600, type: "sine", dur: 0.2, vol: 0.2 }); noise({ dur: 0.2, freq: 2400, filter: "bandpass", vol: 0.2 }); },
    turn: function () { tone({ f: 196, type: "triangle", dur: 0.35, vol: 0.3 }); tone({ f: 147, type: "triangle", dur: 0.45, vol: 0.25, at: 0.12 }); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone({ f: f, type: "triangle", dur: 0.3, vol: 0.25, at: i * 0.1 }); }); },
    lose: function () { [392, 330, 262, 196].forEach(function (f, i) { tone({ f: f, type: "sawtooth", dur: 0.4, vol: 0.18, at: i * 0.18 }); }); },
    click: function () { tone({ f: 1000, type: "sine", dur: 0.04, vol: 0.12 }); },
    ping: function () { tone({ f: 1320, type: "sine", dur: 0.25, vol: 0.25 }); tone({ f: 1760, type: "sine", dur: 0.3, vol: 0.18, at: 0.08 }); },
    emote: function () { tone({ f: 784, type: "triangle", dur: 0.12, vol: 0.2 }); tone({ f: 988, type: "triangle", dur: 0.14, vol: 0.18, at: 0.07 }); },
    gold: function () { tone({ f: 1568, type: "square", dur: 0.06, vol: 0.12 }); tone({ f: 2093, type: "square", dur: 0.1, vol: 0.12, at: 0.05 }); }
  };
  var lastAt = {};
  function sfx(kind) {
    if (!prefs.sfx || !ctx || ctx.state !== "running" || !SFX[kind]) return;
    // 同一種音效 40ms 內只響一次（範圍攻擊一次打很多個時不要爆音）
    var now = ctx.currentTime;
    if (lastAt[kind] && now - lastAt[kind] < 0.04) return;
    lastAt[kind] = now;
    try { SFX[kind](); } catch (e) { /* 不影響遊戲 */ }
  }

  // ---------------- 背景音樂（即時排程的簡單循環） ----------------
  // 每個場景：速度、和弦進行（根音 MIDI 編號＋和弦內音）、旋律音色
  var SCENES = {
    map: { bpm: 76, lead: "triangle", bass: "sine", prog: [[57, [0, 3, 7]], [53, [0, 4, 7]], [48, [0, 4, 7]], [55, [0, 4, 7]]] },
    battle: { bpm: 112, lead: "square", bass: "triangle", prog: [[50, [0, 3, 7]], [46, [0, 4, 7]], [48, [0, 4, 7]], [45, [0, 4, 7]]] },
    boss: { bpm: 132, lead: "sawtooth", bass: "square", prog: [[52, [0, 3, 7]], [48, [0, 4, 7]], [50, [0, 4, 7]], [47, [0, 4, 7]]] }
  };
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  var timer = null, nextTime = 0, step = 0;
  function startScene(name) {
    stopScene();
    curScene = name;
    if (!name || !ctx || ctx.state !== "running") return;
    step = 0;
    nextTime = ctx.currentTime + 0.1;
    timer = setInterval(schedule, 90);
  }
  function stopScene() { if (timer) clearInterval(timer); timer = null; curScene = null; }
  function schedule() {
    var sc = SCENES[curScene];
    if (!sc || !ctx) return;
    var spb = 60 / sc.bpm / 2; // 八分音符
    while (nextTime < ctx.currentTime + 0.35) {
      var bar = Math.floor(step / 8) % sc.prog.length, pos = step % 8;
      var ch = sc.prog[bar], root = ch[0];
      var at = nextTime - ctx.currentTime;
      if (pos === 0) tone({ f: midi(root - 12), type: sc.bass, dur: spb * 7.5, vol: 0.5, at: at, bus: musicBus });
      if (pos === 4 && curScene !== "map") tone({ f: midi(root - 12), type: sc.bass, dur: spb * 3.5, vol: 0.35, at: at, bus: musicBus });
      // 分散和弦：上行再下行；地圖場景比較稀疏
      var arp = [0, 1, 2, 1, 2, 1, 0, 2];
      if (curScene !== "map" || pos % 2 === 0) {
        var note = root + 12 + ch[1][arp[pos]] + (pos >= 4 && bar % 2 ? 12 : 0);
        tone({ f: midi(note), type: sc.lead, dur: spb * 0.9, vol: curScene === "boss" ? 0.16 : 0.2, at: at, bus: musicBus });
      }
      if (curScene !== "map" && (pos === 2 || pos === 6)) {
        // 小鼓：一點雜音
        var t0 = ctx.currentTime + at;
        var src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        if (!noiseBuf) noise({ dur: 0.01, vol: 0.0001 });
        src.buffer = noiseBuf; f.type = "highpass"; f.frequency.value = 2500;
        g.gain.setValueAtTime(0.25, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
        src.connect(f); f.connect(g); g.connect(musicBus); src.start(t0); src.stop(t0 + 0.1);
      }
      nextTime += spb;
      step += 1;
    }
  }
  function scene(name) {
    wantScene = name || null;
    if (!prefs.music) { stopScene(); return; }
    if (wantScene === curScene) return;
    startScene(wantScene);
  }

  window.PriTestYellowAudio = {
    sfx: sfx,
    scene: scene,
    settings: function () { return { sfx: prefs.sfx, music: prefs.music }; },
    setSfx: function (on) { prefs.sfx = !!on; savePrefs(); if (sfxBus) sfxBus.gain.value = on ? 0.32 : 0; },
    setMusic: function (on) {
      prefs.music = !!on; savePrefs();
      if (musicBus) musicBus.gain.value = on ? 0.11 : 0;
      if (on) { var w = wantScene; curScene = null; scene(w); } else stopScene();
    }
  };
})();
