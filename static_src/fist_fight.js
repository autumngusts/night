// 鐵拳教育（fist）：格鬥畫面（使用者指定 2026-10-26：進入格鬥畫面即時對打、每一擊都有彩色演出、角色切入、音效）。
//   createEngine(opts)：純邏輯（不碰 DOM，node 也能跑：tools/fist_check/fight_check.js），tick(dt) 前進、input(種類) 操作
//   open(opts)：全螢幕格鬥畫面，打完呼叫 opts.onDone(結果)，結果交給 fist_core.js 的 fight 操作
//   cutIn(...)：老師大頭切入（必殺技、擊倒權力者；地圖畫面也會用）
//   sfx：WebAudio 合成音效（不載入任何音檔），可關閉
// 畫面上的數值＝規則數值 × FIGHT_SCALE（10）。結果換算回規則數值後才寫進對局狀態。
(function () {
  "use strict";

  var D = window.PriTestFistData;
  if (!D) return;
  var S = D.FIGHT_SCALE;

  // ---------------- 數值 ----------------
  var T = {
    punchCd: 0.26, kickCd: 0.62, comboWindow: 0.9, critRate: 0.1,
    wind: 0.62, bossWind: 0.8, recover: 0.4, idleMin: 1.0, idleRand: 1.0,
    parryWindow: 0.22, blockRate: 0.25, dodgeTime: 0.4, dodgeCd: 1.0,
    foeHit: 6, ultFreeze: 1.3, intro: 0.9
  };

  function mulberry(seed) {
    var s = seed | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // opts：{ pow, talk, ult（必殺技 id）, heat, hp, max（規則數值）, foes: [{ u, id, hp, max, atk, boss, wall, stun }], time, seed }
  function createEngine(o) {
    var rnd = mulberry(o.seed || 1);
    var e = {
      t: 0, time: o.time || D.FIGHT_TIME, timeMax: o.time || D.FIGHT_TIME, over: false, why: null, freeze: 0, intro: T.intro,
      me: { hp: o.hp * S, max: o.max * S, coreHp: o.hp, pow: o.pow, talk: o.talk, ultId: o.ult, heat: o.heat || 0,
        guard: false, guardAt: -9, dodgeUntil: -9, dodgeCd: 0, atkCd: 0, combo: 0, comboT: -9, maxCombo: 0, nextCrit: false,
        ult: false, taken: 0, fist: false },
      foes: o.foes.map(function (f, i) {
        return { u: f.u, id: f.id, hp: f.hp * S, max: f.max * S, coreHp: f.hp, atk: f.atk, boss: !!f.boss, wall: f.boss ? f.wall || 0 : 0,
          phase: f.stun ? "stun" : "idle", timer: f.stun ? 2 : 0.9 + i * 0.75 + rnd() * 0.6, how: "fist" };
      }),
      target: 0, events: []
    };

    function ev(k, data) { var x = { k: k }; Object.keys(data || {}).forEach(function (n) { x[n] = data[n]; }); e.events.push(x); }
    function alive() { return e.foes.filter(function (f) { return f.phase !== "down"; }); }
    function end(why) { if (e.over) return; e.over = true; e.why = why; ev("end", { why: why }); }
    function busy() { return e.over || e.intro > 0 || e.freeze > 0; }
    function targetFoe() {
      var f = e.foes[e.target];
      if (f && f.phase !== "down") return f;
      var list = alive();
      // 優先打得到的（權力之壁還在的權力者排最後）
      list.sort(function (a, b) { return (a.wall > 0) - (b.wall > 0); });
      if (!list.length) return null;
      e.target = e.foes.indexOf(list[0]);
      return list[0];
    }
    function checkClear() {
      // 剩下的都是打不到的權力者也不結束（手下還會補…這裡只看畫面上的人）
      if (!alive().length) end("clear");
    }
    function ko(f) {
      f.phase = "down";
      ev("ko", { i: e.foes.indexOf(f), boss: f.boss });
      checkClear();
    }

    function attack(kind) {
      if (busy() || e.me.atkCd > 0 || e.me.guard) return;
      var f = targetFoe();
      if (!f) return;
      var i = e.foes.indexOf(f);
      e.me.atkCd = kind === "kick" ? T.kickCd : T.punchCd;
      e.me.combo = e.t - e.me.comboT <= T.comboWindow ? e.me.combo + 1 : 1;
      e.me.comboT = e.t;
      e.me.maxCombo = Math.max(e.me.maxCombo, e.me.combo);
      if (f.wall > 0) { ev("wall", { i: i, kind: kind }); return; }
      var base = kind === "kick" ? 3 + e.me.pow * 1.5 : 1 + e.me.pow;
      var crit = e.me.nextCrit || rnd() < T.critRate;
      e.me.nextCrit = false;
      var d = Math.round(base * (1 + Math.min(e.me.combo - 1, 15) * 0.03) * (crit ? 2 : 1));
      d = Math.min(d, f.hp);
      f.hp -= d;
      f.how = "fist";
      if (!f.boss) e.me.fist = true;
      ev("hit", { i: i, d: d, crit: crit, kind: kind, combo: e.me.combo });
      if (kind === "kick" && f.phase === "wind") { f.phase = "idle"; f.timer = 1.0; ev("interrupt", { i: i }); }
      if (f.hp <= 0) ko(f);
    }

    function ult() {
      if (busy() || e.me.ult || e.me.heat < D.MAX_HEAT || !D.FIGHT_ULTS[e.me.ultId]) return;
      e.me.ult = true;
      e.freeze = T.ultFreeze;
      ev("ult", { id: e.me.ultId });
      var id = e.me.ultId;
      var dmg = id === "barrage" ? e.me.pow * 2 * S : id === "legend" ? 4 * S : id === "truth" ? e.me.talk * 2 * S : 3 * S;
      alive().forEach(function (f) {
        var i = e.foes.indexOf(f);
        if (f.wall > 0) { ev("wall", { i: i, kind: "ult" }); return; }
        var d = Math.min(dmg, f.hp);
        f.hp -= d;
        f.how = id === "truth" ? "talk" : "fist";
        if (id !== "truth" && !f.boss) e.me.fist = true;
        ev("hit", { i: i, d: d, crit: true, kind: "ult" });
        if (id === "reaction") { f.phase = "stun"; f.timer = 2.5; }
        if (f.hp <= 0) ko(f);
      });
    }

    function strike(f) {
      var i = e.foes.indexOf(f);
      var me = e.me;
      var dmg = f.atk * T.foeHit;
      if (e.t < me.dodgeUntil) { ev("dodge", { i: i }); me.nextCrit = true; return; }
      if (me.guard) {
        if (e.t - me.guardAt <= T.parryWindow) { f.phase = "stun"; f.timer = 1.3; ev("parry", { i: i }); return; }
        dmg = Math.round(dmg * T.blockRate);
        ev("block", { i: i, d: dmg });
      } else {
        me.combo = 0;
        ev("hurt", { i: i, d: dmg });
      }
      dmg = Math.min(dmg, me.hp);
      me.hp -= dmg;
      me.taken += dmg;
      if (me.hp <= 0) end("down");
    }

    e.input = function (kind, arg) {
      if (kind === "retreat") { if (!e.over) end("retreat"); return; }
      if (kind === "target") { var f = e.foes[arg]; if (f && f.phase !== "down") e.target = arg; return; }
      if (kind === "guardOff") { e.me.guard = false; return; }
      if (busy()) return;
      if (kind === "punch" || kind === "kick") attack(kind);
      else if (kind === "guardOn") { if (!e.me.guard) { e.me.guard = true; e.me.guardAt = e.t; } }
      else if (kind === "dodge") {
        if (e.me.dodgeCd > 0) return;
        e.me.dodgeUntil = e.t + T.dodgeTime; e.me.dodgeCd = T.dodgeCd; e.me.guard = false;
        ev("dash", {});
      } else if (kind === "ult") ult();
    };

    e.tick = function (dt) {
      if (e.over) return;
      if (e.intro > 0) { e.intro -= dt; if (e.intro <= 0) ev("go", {}); return; }
      if (e.freeze > 0) { e.freeze -= dt; return; }
      e.t += dt;
      e.time -= dt;
      e.me.atkCd = Math.max(0, e.me.atkCd - dt);
      e.me.dodgeCd = Math.max(0, e.me.dodgeCd - dt);
      e.foes.forEach(function (f) {
        if (f.phase === "down" || e.over) return;
        f.timer -= dt;
        if (f.timer > 0) return;
        if (f.phase === "idle" || f.phase === "stun") { f.phase = "wind"; f.timer = f.boss ? T.bossWind : T.wind; ev("wind", { i: e.foes.indexOf(f) }); }
        else if (f.phase === "wind") { strike(f); if (f.phase === "wind") { f.phase = "recover"; f.timer = T.recover; } }
        else if (f.phase === "recover") { f.phase = "idle"; f.timer = T.idleMin + rnd() * T.idleRand; }
      });
      if (!e.over && e.time <= 0) { e.time = 0; end("time"); }
    };

    // 換算回規則數值，交給 fist_core 的 fight 操作
    e.result = function () {
      return {
        hits: e.foes.map(function (f) {
          var d = f.hp <= 0 ? f.coreHp : Math.min(f.coreHp - 1, Math.round((f.max - f.hp) / S));
          return { b: f.u, d: d, how: f.how };
        }).filter(function (x) { return x.d > 0; }),
        taken: e.me.hp <= 0 ? e.me.coreHp : Math.min(e.me.coreHp - 1, Math.round(e.me.taken / S)),
        combo: e.me.maxCombo, ult: e.me.ult, fist: e.me.fist
      };
    };
    return e;
  }

  // ---------------- 音效 ----------------
  var SFX_KEY = "pritest-fist-sfx";
  var sfx = {
    on: (function () { try { return localStorage.getItem(SFX_KEY) !== "0"; } catch (e) { return true; } })(),
    ctx: null,
    toggle: function () { sfx.on = !sfx.on; try { localStorage.setItem(SFX_KEY, sfx.on ? "1" : "0"); } catch (e) { /* 只是記不住 */ } return sfx.on; },
    ac: function () {
      if (!sfx.on || typeof window.AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined") return null;
      if (!sfx.ctx) { try { sfx.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
      if (sfx.ctx.state === "suspended") sfx.ctx.resume();
      return sfx.ctx;
    },
    tone: function (type, f0, f1, dur, vol, delay) {
      var c = sfx.ac(); if (!c) return;
      var t0 = c.currentTime + (delay || 0);
      var o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    },
    noise: function (dur, vol, freq, delay) {
      var c = sfx.ac(); if (!c) return;
      var t0 = c.currentTime + (delay || 0);
      var n = Math.floor(c.sampleRate * dur);
      var buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = buf; f.type = "lowpass"; f.frequency.value = freq || 2000;
      g.gain.setValueAtTime(vol, t0);
      src.connect(f); f.connect(g); g.connect(c.destination);
      src.start(t0);
    },
    play: function (k) {
      if (!sfx.on) return;
      switch (k) {
        case "punch": sfx.noise(0.06, 0.5, 2500); sfx.tone("sine", 160, 60, 0.1, 0.6); break;
        case "kick": sfx.noise(0.12, 0.6, 1400); sfx.tone("sine", 110, 40, 0.2, 0.8); break;
        case "crit": sfx.play("kick"); sfx.tone("square", 880, 1760, 0.12, 0.15, 0.02); break;
        case "hurt": sfx.tone("square", 320, 110, 0.18, 0.2); sfx.noise(0.08, 0.3, 800); break;
        case "block": sfx.tone("triangle", 1300, 900, 0.07, 0.25); sfx.noise(0.04, 0.2, 5000); break;
        case "parry": sfx.tone("sine", 1500, 2400, 0.25, 0.3); sfx.tone("sine", 2250, 3000, 0.2, 0.15, 0.04); break;
        case "dodge": sfx.noise(0.16, 0.25, 900); break;
        case "wall": sfx.tone("sine", 75, 50, 0.25, 0.7); sfx.tone("triangle", 420, 380, 0.15, 0.15); break;
        case "wind": sfx.tone("sawtooth", 180, 260, 0.2, 0.06); break;
        case "ko": [523, 659, 784, 1046].forEach(function (f, i) { sfx.tone("square", f, f, 0.1, 0.12, i * 0.07); }); break;
        case "ult": sfx.tone("sawtooth", 160, 1400, 0.55, 0.18); sfx.noise(0.5, 0.25, 3000, 0.05); break;
        case "go": sfx.tone("square", 660, 660, 0.08, 0.12); sfx.tone("square", 990, 990, 0.16, 0.12, 0.12); break;
        case "win": [392, 523, 659, 784, 1046].forEach(function (f, i) { sfx.tone("square", f, f, 0.14, 0.12, i * 0.09); }); break;
        case "lose": sfx.tone("triangle", 330, 110, 0.6, 0.2); break;
        case "step": sfx.tone("sine", 240, 200, 0.04, 0.08); break;
        case "rescue": [659, 880, 1175].forEach(function (f, i) { sfx.tone("sine", f, f, 0.18, 0.15, i * 0.08); }); break;
      }
    }
  };

  // ---------------- DOM 小工具 ----------------
  function t(key, params) { return window.I18N ? window.I18N.t(key, params) : key; }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function restart(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }

  // 老師大頭切入：斜向色帶＋放大的老師圖示＋大字
  function cutIn(icon, color, title, sub) {
    var band = el("div", "ff-cutin");
    band.style.setProperty("--ff-c", color || "#ff6a2a");
    var face = el("div", "ff-cutin-face", icon);
    var txt = el("div", "ff-cutin-text");
    txt.appendChild(el("div", "ff-cutin-title", title));
    if (sub) txt.appendChild(el("div", "ff-cutin-sub", sub));
    band.appendChild(face);
    band.appendChild(txt);
    document.body.appendChild(band);
    sfx.play("ult");
    setTimeout(function () { if (band.parentNode) band.parentNode.removeChild(band); }, 1300);
  }

  var WORDS = {
    punch: ["バシッ!", "ドッ!", "パンッ!", "ゴッ!", "ビシッ!"],
    kick: ["ドカッ!!", "ズドン!!", "バキィ!!", "ドゴォ!!"],
    ult: ["ドドドド!!", "ズガガガ!!", "ドォン!!"]
  };

  // ---------------- 格鬥畫面 ----------------
  // opts：{ teacher: { icon, color, name, pow, talk, hp, max, heat, ult: { id, name } }, foes: [{ u, id, icon, name, hp, max, atk, boss, wall, stun }],
  //         place, seed, onDone(result) }
  function open(opts) {
    var tc = opts.teacher;
    var eng = createEngine({ pow: tc.pow, talk: tc.talk, ult: tc.ult.id, heat: tc.heat, hp: tc.hp, max: tc.max, foes: opts.foes, seed: opts.seed });
    var root = el("div", "ff-overlay");
    var box = el("div", "ff-box");
    root.appendChild(box);

    // 頂列：地點、剩餘時間、連段
    var head = el("div", "ff-head");
    head.appendChild(el("span", "ff-place", "📍" + opts.place));
    var timer = el("span", "ff-timer");
    var timerFill = el("span", "ff-timer-fill");
    timer.appendChild(timerFill);
    head.appendChild(timer);
    var comboEl = el("span", "ff-combo");
    head.appendChild(comboEl);
    var sfxBtn = el("button", "ff-sfx", sfx.on ? "🔊" : "🔇");
    sfxBtn.type = "button";
    sfxBtn.addEventListener("click", function () { sfxBtn.textContent = sfx.toggle() ? "🔊" : "🔇"; });
    head.appendChild(sfxBtn);
    box.appendChild(head);

    // 舞台：左老師、右霸凌者
    var stage = el("div", "ff-stage");
    var meEl = el("div", "ff-me");
    meEl.style.setProperty("--ff-c", tc.color);
    var meIcon = el("div", "ff-icon ff-me-icon", tc.icon);
    var meShield = el("div", "ff-shield", "🛡️");
    var meBar = el("div", "ff-hp"), meFill = el("div", "ff-hp-fill");
    meBar.appendChild(meFill);
    meEl.appendChild(meIcon);
    meEl.appendChild(meShield);
    meEl.appendChild(el("div", "ff-name", tc.name));
    meEl.appendChild(meBar);
    var heatEl = el("div", "ff-heat");
    meEl.appendChild(heatEl);
    stage.appendChild(meEl);

    var foesEl = el("div", "ff-foes");
    var foeEls = opts.foes.map(function (f, i) {
      var n = el("div", "ff-foe" + (f.boss ? " ff-boss" : ""));
      var warn = el("div", "ff-warn", "⚠");
      var icon = el("div", "ff-icon", f.icon);
      var bar = el("div", "ff-hp"), fill = el("div", "ff-hp-fill ff-hp-foe");
      bar.appendChild(fill);
      n.appendChild(warn);
      n.appendChild(icon);
      n.appendChild(el("div", "ff-name", f.name));
      var wall = f.boss && f.wall > 0 ? el("div", "ff-wall", "🧱 " + t("fe_wall") + " " + f.wall) : null;
      if (wall) n.appendChild(wall);
      n.appendChild(bar);
      n.addEventListener("pointerdown", function (ev) { ev.preventDefault(); eng.input("target", i); });
      foesEl.appendChild(n);
      return { node: n, icon: icon, fill: fill };
    });
    stage.appendChild(foesEl);
    var fx = el("div", "ff-fx");
    stage.appendChild(fx);
    var banner = el("div", "ff-banner", t("fe_fight_ready"));
    stage.appendChild(banner);
    box.appendChild(stage);

    // 操作鍵
    var pads = el("div", "ff-pads");
    function pad(cls, label, key, down, up) {
      var b = el("button", "ff-pad " + cls);
      b.type = "button";
      b.appendChild(el("span", "ff-pad-label", label));
      b.appendChild(el("span", "ff-pad-key", key));
      b.addEventListener("pointerdown", function (ev) { ev.preventDefault(); down(); b.classList.add("ff-press"); });
      var release = function () { b.classList.remove("ff-press"); if (up) up(); };
      b.addEventListener("pointerup", release);
      b.addEventListener("pointerleave", release);
      b.addEventListener("pointercancel", release);
      b.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
      pads.appendChild(b);
      return b;
    }
    pad("ff-pad-punch", "👊 " + t("fe_fight_punch"), "J", function () { eng.input("punch"); });
    pad("ff-pad-kick", "🦵 " + t("fe_fight_kick"), "K", function () { eng.input("kick"); });
    pad("ff-pad-guard", "🛡️ " + t("fe_fight_guard"), "L", function () { eng.input("guardOn"); }, function () { eng.input("guardOff"); });
    pad("ff-pad-dodge", "💨 " + t("fe_fight_dodge"), "Space", function () { eng.input("dodge"); });
    var ultPad = D.FIGHT_ULTS[tc.ult.id] ? pad("ff-pad-ult", "🔥 " + tc.ult.name, "U", function () { eng.input("ult"); }) : null;
    pad("ff-pad-retreat", "🏃 " + t("fe_fight_retreat"), "Esc", function () { eng.input("retreat"); });
    box.appendChild(pads);
    box.appendChild(el("div", "ff-hint", t("fe_fight_hint")));

    var resultBox = null;
    var shakeT = 0, hitstop = 0, last = 0, raf = 0, closed = false;

    function keydown(ev) {
      if (ev.target && ev.target.tagName === "INPUT") return;
      var k = ev.key.toLowerCase();
      if (eng.over) { if (resultBox && (k === "enter" || k === " ")) { ev.preventDefault(); finish(); } return; }
      var map = { j: "punch", z: "punch", k: "kick", x: "kick", l: "guardOn", c: "guardOn", " ": "dodge", u: "ult", v: "ult", escape: "retreat" };
      if (!map[k]) return;
      ev.preventDefault();
      if (ev.repeat && map[k] !== "guardOn") return;
      eng.input(map[k]);
    }
    function keyup(ev) {
      var k = ev.key.toLowerCase();
      if (k === "l" || k === "c") eng.input("guardOff");
    }
    document.addEventListener("keydown", keydown);
    document.addEventListener("keyup", keyup);

    function foeCenter(i) {
      var r = foeEls[i].node.getBoundingClientRect(), s = stage.getBoundingClientRect();
      return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height * 0.35 };
    }
    function pop(x, y, text, cls, color) {
      var n = el("div", "ff-pop " + (cls || ""), text);
      n.style.left = x + "px";
      n.style.top = y + "px";
      if (color) n.style.color = color;
      n.style.setProperty("--ff-rot", (Math.random() * 24 - 12).toFixed(1) + "deg");
      fx.appendChild(n);
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 900);
    }
    function shake(power) { shakeT = Math.max(shakeT, power); }

    function handle(evn) {
      var c, w, hue;
      switch (evn.k) {
        case "go":
          banner.textContent = t("fe_fight_go");
          restart(banner, "ff-banner-go");
          sfx.play("go");
          break;
        case "hit":
          c = foeCenter(evn.i);
          w = WORDS[evn.kind] || WORDS.punch;
          hue = Math.floor(Math.random() * 360);
          pop(c.x + (Math.random() * 40 - 20), c.y - 10, w[Math.floor(Math.random() * w.length)], "ff-pop-word" + (evn.crit ? " ff-pop-crit" : ""), "hsl(" + hue + ", 95%, 58%)");
          pop(c.x + 26, c.y + 24, "−" + evn.d, "ff-pop-num");
          if (evn.crit && evn.kind !== "ult") pop(c.x, c.y - 52, t("fe_fight_crit"), "ff-pop-critlabel");
          restart(foeEls[evn.i].icon, "ff-recoil");
          restart(meIcon, evn.kind === "kick" ? "ff-kick" : "ff-punch");
          hitstop = evn.kind === "kick" || evn.crit ? 0.08 : 0.045;
          shake(evn.kind === "kick" || evn.crit ? 8 : 3);
          sfx.play(evn.crit ? "crit" : evn.kind === "kick" ? "kick" : "punch");
          break;
        case "wall":
          c = foeCenter(evn.i);
          pop(c.x, c.y - 20, "🧱 " + t("fe_fight_wall"), "ff-pop-wall");
          restart(meIcon, "ff-bounce");
          sfx.play("wall");
          break;
        case "interrupt":
          c = foeCenter(evn.i);
          pop(c.x, c.y - 40, t("fe_fight_interrupt"), "ff-pop-good");
          break;
        case "wind":
          sfx.play("wind");
          break;
        case "hurt":
          pop(60, 40, "−" + evn.d, "ff-pop-hurt");
          restart(foeEls[evn.i].icon, "ff-lunge");
          restart(meIcon, "ff-hurt");
          restart(box, "ff-flash-red");
          shake(10);
          sfx.play("hurt");
          break;
        case "block":
          pop(60, 30, t("fe_fight_block") + " −" + evn.d, "ff-pop-block");
          restart(foeEls[evn.i].icon, "ff-lunge");
          shake(3);
          sfx.play("block");
          break;
        case "parry":
          pop(70, 20, t("fe_fight_parry"), "ff-pop-parry");
          restart(foeEls[evn.i].icon, "ff-lunge");
          restart(box, "ff-flash-white");
          hitstop = 0.12;
          sfx.play("parry");
          break;
        case "dodge":
          pop(70, 20, t("fe_fight_dodged"), "ff-pop-good");
          sfx.play("dodge");
          break;
        case "dash":
          restart(meIcon, "ff-dash");
          sfx.play("dodge");
          break;
        case "ko":
          c = foeCenter(evn.i);
          pop(c.x, c.y - 30, "K.O.!!", "ff-pop-ko", "hsl(" + Math.floor(Math.random() * 360) + ", 95%, 60%)");
          restart(box, "ff-flash-white");
          shake(12);
          sfx.play("ko");
          if (evn.boss) cutIn(tc.icon, tc.color, t("fe_fx_boss_down"), opts.foes[evn.i].name);
          break;
        case "ult":
          cutIn(tc.icon, tc.color, tc.ult.name + "!!", tc.name);
          restart(meIcon, "ff-kick");
          shake(14);
          break;
        case "end":
          setTimeout(showResult, 650);
          break;
      }
    }

    function draw() {
      var me = eng.me;
      timerFill.style.width = Math.max(0, 100 * eng.time / eng.timeMax) + "%";
      timer.classList.toggle("ff-timer-low", eng.time < 3);
      comboEl.textContent = me.combo >= 2 ? t("fe_fight_combo", { n: me.combo }) : "";
      comboEl.style.fontSize = me.combo >= 2 ? (1 + Math.min(me.combo, 20) * 0.05) + "em" : "";
      meFill.style.width = Math.max(0, 100 * me.hp / me.max) + "%";
      meEl.classList.toggle("ff-guarding", me.guard);
      meEl.classList.toggle("ff-dodging", eng.t < me.dodgeUntil);
      heatEl.textContent = "🔥".repeat(me.ult ? 0 : Math.min(me.heat, D.MAX_HEAT));
      if (ultPad) ultPad.disabled = me.ult || me.heat < D.MAX_HEAT;
      eng.foes.forEach(function (f, i) {
        var n = foeEls[i];
        n.fill.style.width = Math.max(0, 100 * f.hp / f.max) + "%";
        n.node.classList.toggle("ff-wind", f.phase === "wind");
        n.node.classList.toggle("ff-stun", f.phase === "stun");
        n.node.classList.toggle("ff-down", f.phase === "down");
        n.node.classList.toggle("ff-target", i === eng.target && f.phase !== "down");
      });
      if (shakeT > 0) {
        stage.style.transform = "translate(" + ((Math.random() * 2 - 1) * shakeT).toFixed(1) + "px," + ((Math.random() * 2 - 1) * shakeT * 0.6).toFixed(1) + "px)";
        shakeT = Math.max(0, shakeT - 1.2);
      } else stage.style.transform = "";
    }

    function frame(now) {
      if (closed) return;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      if (hitstop > 0) hitstop -= dt;
      else eng.tick(dt);
      var evs = eng.events.splice(0);
      evs.forEach(handle);
      draw();
      raf = requestAnimationFrame(frame);
    }

    function showResult() {
      if (resultBox || closed) return;
      var r = eng.result();
      var kos = eng.foes.filter(function (f) { return f.phase === "down"; }).length;
      resultBox = el("div", "ff-result ff-result-" + eng.why);
      resultBox.appendChild(el("div", "ff-result-title", t("fe_fight_end_" + eng.why)));
      resultBox.appendChild(el("div", "ff-result-line", t("fe_fight_summary", { ko: kos, combo: r.combo, hurt: r.taken })));
      if (r.fist && !opts.proof) resultBox.appendChild(el("div", "ff-result-warn", t("fe_fight_comp_warn")));
      var ok = el("button", "ff-result-ok", t("fe_fight_back"));
      ok.type = "button";
      ok.addEventListener("click", finish);
      resultBox.appendChild(ok);
      box.appendChild(resultBox);
      sfx.play(eng.why === "clear" ? "win" : eng.why === "down" ? "lose" : "step");
      setTimeout(function () { try { ok.focus(); } catch (e) { /* */ } }, 50);
    }

    function finish() {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("keyup", keyup);
      if (root.parentNode) root.parentNode.removeChild(root);
      document.body.classList.remove("ff-lock");
      opts.onDone(eng.result(), eng.why);
    }

    document.body.appendChild(root);
    document.body.classList.add("ff-lock");
    sfx.ac(); // 使用者剛按了按鈕：在這時建立 AudioContext 才會被瀏覽器允許
    raf = requestAnimationFrame(frame);
    return { engine: eng, close: finish };
  }

  window.PriTestFistFight = { createEngine: createEngine, open: open, cutIn: cutIn, sfx: sfx, TUNING: T };
})();
