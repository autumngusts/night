/* イヌスノー（狗雪）第 3 階段的畫面（docs/inusnow_design.md §18）：
   M1 救難犬、M5 雪崩逃脫（賽事種類）、競猜與觀戰（B1、B2、B5）、M3 世界盃、R1 今日雪況（首頁分頁）。
   在 inusnow.js 之前載入，登記到 window.PriTestInusnowExt；inusnow.js 啟動時把共用介面 UI 傳進來。
   規則都在 inusnow_bet／mission／season／env.js；這裡只有畫面與存檔。 */
(function () {
  "use strict";

  (window.PriTestInusnowExt = window.PriTestInusnowExt || []).push(function (UI) {
    var D = window.PriTestInusnowData, T = window.PriTestInusnowTerrain, Phys = window.PriTestInusnowPhys, Core = window.PriTestInusnowCore;
    var SLP = window.PriTestInusnowSlope, CX = window.PriTestInusnowCross, Env = window.PriTestInusnowEnv;
    var Bet = window.PriTestInusnowBet, MS = window.PriTestInusnowMission, SE = window.PriTestInusnowSeason;
    if (!Bet || !MS || !SE || !Env) return;
    var t = UI.t, L = UI.L, esc = UI.esc, fmtTime = UI.fmtTime, fmtScore = UI.fmtScore, S = UI.S, app = UI.app;
    var HZ = D.PHYS.hz, RS = D.RESCUE, AV = D.AVALANCHE;
    function save() { return UI.save(); }
    function on(act, fn, root) { var b = (root || app).querySelector('[data-act="' + act + '"]'); if (b) b.addEventListener("click", fn); }
    function cpuById(id) { for (var i = 0; i < D.CPU.length; i++) if (D.CPU[i].id === id) return D.CPU[i]; return null; }
    function nameOf(id) { if (id === "me") return save().dog.name || t("inu_you"); var c = cpuById(id); return c ? L(c.name) : id; }
    function breedOf(id) { if (id === "me") return Core.breed(save().dog.breed); var c = cpuById(id); return Core.breed(c ? c.breed : "shiba"); }
    function month() { return +UI.jstDate().slice(5, 7); }
    function loading(text) {
      app.innerHTML = '<div class="inu-loading"><div class="inu-loader" aria-hidden="true"><span class="inu-loader-dog"></span><span class="inu-loader-hill"></span></div><p class="inu-loading-title">' + esc(text) + '</p><p class="inu-loading-bar"><i id="inu-load-bar"></i></p></div>';
    }
    function resultShell(icon, title, sub, body, good) {
      return '<div class="inu-page inu-result inu-anim-in">' + (good ? UI.confettiHtml() : "") + '<h2 class="inu-h2">' + icon + esc(title) + (sub ? "　<small>" + esc(sub) + "</small>" : "") + "</h2>" + body + "</div>";
    }
    function backBtns(extra) {
      return '<div class="inu-actions">' + (extra || "") + '<button type="button" class="inu-secondary" data-act="setup">' + esc(t("inu_to_setup")) + '</button><button type="button" class="inu-secondary" data-act="resorts">' + esc(t("inu_to_resorts")) + "</button></div>";
    }
    function bindBack() { on("setup", function () { UI.show("setup"); }); on("resorts", function () { UI.show("resorts"); }); }

    var ICONS = {
      rescue: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 40c6-10 12-14 18-14s12 4 18 14z" fill="currentColor" opacity=".22"/><rect x="20" y="6" width="8" height="22" rx="2" fill="#e2453c"/><rect x="13" y="13" width="22" height="8" rx="2" fill="#e2453c"/><circle cx="24" cy="17" r="2.4" fill="#fff"/></svg>',
      avalanche: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M2 44 22 8l8 14 6-6 10 28z" fill="currentColor" opacity=".25"/><path d="M4 40c6-6 10-2 14-8s8-4 12-10 8-4 14-8" fill="none" stroke="#9cc7ef" stroke-width="5" stroke-linecap="round"/><circle cx="36" cy="38" r="4" fill="#ff7a3d"/></svg>',
      watch: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="12" width="38" height="24" rx="5" fill="currentColor" opacity=".2"/><circle cx="24" cy="24" r="8" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="24" r="3" fill="#f0a020"/></svg>',
    };

    // ======================= M1 救難犬（設計 §18.6） =======================
    UI.kind("rescue", {
      icon: ICONS.rescue, setup: true, noZoom: true,
      setupInfo: function (r) {
        var b = save().best[UI.S.resort + "/rescue"];
        return '<p class="inu-course-line">' + esc(t("inu_rescue_info", { sec: RS.sec })) + "</p>" + (b ? '<p class="inu-course-best">' + esc(t("inu_best_points", { v: b.score })) + "</p>" : "");
      },
      begin: function (r, terrain, vopts) {
        var world = UI.worldOf(r.resort, terrain);
        var seed = r.opts.seed !== undefined ? r.opts.seed : Core.hash(UI.whenKey() + "|rescue|" + r.resort);
        r.run = MS.newRescue(terrain, world, { seed: seed, dog: r.dog, cond: r.std ? null : r.cond });
        vopts.mode = "free";
        vopts.world = { trees: r.run.trees, bones: [], spots: [], lifts: [] };
        vopts.victims = r.run.victims;
        r.pulseAt = 0;
      },
      st: function (r) { return r.run.st; },
      done: function (r) { return r.run.status !== "run"; },
      events: function (r) { return r.run.events; },
      steps: function (r) { return r.run.steps; },
      step: function (r, auto) {
        var inp = auto ? MS.rescueAuto(r.run, SLP.steerTo) : UI.Input.sample();
        r.lastInput = { g: 0 };
        MS.stepRescue(r.run, inp);
      },
      help: function () { return t("inu_help_rescue"); },
      html: function () {
        return '<div class="inu-nose" id="inu-nose" aria-hidden="true"><span class="inu-nose-ring"></span><span class="inu-nose-ring"></span><span class="inu-nose-ico"></span></div>'
          + '<p class="inu-nose-text" id="inu-nose-text"></p>'
          + '<button type="button" class="inu-actbtn inu-digbtn" id="btn-inu-dig">' + esc(t("inu_dig")) + '<svg viewBox="0 0 36 36" class="inu-digring" aria-hidden="true"><circle cx="18" cy="18" r="15"/><circle id="inu-dig-arc" cx="18" cy="18" r="15"/></svg></button>';
      },
      bind: function (r) {
        var b = document.getElementById("btn-inu-dig");
        var down = function (e) { e.stopPropagation(); e.preventDefault(); UI.Input.setGrab(1); b.classList.add("is-down"); };
        var up = function () { UI.Input.setGrab(0); b.classList.remove("is-down"); };
        b.addEventListener("pointerdown", down);
        b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("pointerleave", up);
      },
      hud: function (r) {
        var run = r.run, left = RS.sec - run.steps / HZ;
        var p = MS.pulse(run, r.dog.nose), now = performance.now();
        var nose = document.getElementById("inu-nose"), nt = document.getElementById("inu-nose-text");
        if (nose) {
          nose.classList.toggle("is-far", !p);
          if (p && r.phase === "run" && now - r.pulseAt > p * 1000) {
            r.pulseAt = now;
            nose.classList.remove("is-beat"); void nose.offsetWidth; nose.classList.add("is-beat");
            if (p < 0.4) UI.vibrate(12);
          }
          if (nt) { var key = !p ? "inu_nose_none" : p < 0.35 ? "inu_nose_hot" : p < 0.9 ? "inu_nose_warm" : "inu_nose_cold"; if (r.hud.nose !== key) { r.hud.nose = key; nt.textContent = t(key); nt.className = "inu-nose-text " + key; } }
        }
        var arc = document.getElementById("inu-dig-arc");
        if (arc) {
          var dv = run.digging >= 0 ? run.victims[run.digging].dig / RS.dig : 0;
          arc.style.strokeDashoffset = (94.2 * (1 - dv)).toFixed(1);
        }
        return { time: fmtTime(Math.max(0, left)), sub: "🐾 " + t("inu_rescue_count", { n: run.found, max: run.victims.length }), prog: run.found / run.victims.length };
      },
      event: function (r, e) {
        if (e.e === "rescue") {
          var v = r.run.victims[e.n];
          UI.banner(t("inu_rescued", { n: r.run.found, max: r.run.victims.length }), "is-go");
          if (UI.S.view) UI.S.view.fx("spot", { 0: v.x, 1: T.height(r.terrain, v.x, v.z), 2: v.z, id: "v" + v.id });
          UI.vibrate([40, 30, 40]);
          return true;
        }
        return false;
      },
      fx: function (r, fx) { fx.victims = r.run.victims; },
      end: function (r) {
        var all = r.run.found >= r.run.victims.length;
        UI.banner(all ? t("inu_rescue_all") : t("inu_timeup"), all ? "is-go" : "is-warn");
        if (all && UI.S.view) UI.S.view.fx("finish");
      },
      result: function (r) {
        var run = r.run, key = r.resort + "/rescue", b = save().best[key], nb = !b || run.score > b.score;
        if (nb) save().best[key] = { score: run.score, found: run.found, at: Date.now() };
        UI.persist();
        UI.S.screen = "result";
        var info = UI.resortInfo(r.resort);
        var body = '<p class="inu-bigscore"><span id="inu-bigscore">0</span><small>' + esc(t("inu_points")) + "</small></p>"
          + (nb ? '<p class="inu-newbest">' + esc(t("inu_new_best_score")) + "</p>" : "")
          + '<div class="inu-collect"><div class="inu-collect-card"><span>🐾</span><b>' + run.found + "/" + run.victims.length + "</b><small>" + esc(t("inu_rescue_saved")) + '</small></div><div class="inu-collect-card"><span>⏱</span><b>' + Math.max(0, Math.floor(RS.sec - run.steps / HZ)) + "</b><small>" + esc(t("inu_rescue_left")) + "</small></div></div>"
          + '<p class="inu-muted">' + esc(t("inu_rescue_formula", { per: RS.per, sec: RS.perSec })) + "</p>"
          + backBtns('<button type="button" class="inu-primary" data-act="retry">' + esc(t("inu_retry")) + "</button>");
        app.innerHTML = resultShell(ICONS.rescue, t("inu_event_rescue"), L(info.name), body, run.found >= run.victims.length);
        UI.countUp(document.getElementById("inu-bigscore"), run.score, function (v) { return String(Math.round(v)); }, 1000);
        on("retry", function () { UI.startRace(r.resort, { event: "rescue" }); });
        bindBack();
      },
      debug: function (r) { return { status: r.run.status, steps: r.run.steps, found: r.run.found, victims: r.run.victims.length, score: r.run.score }; },
    });

    // ======================= M5 雪崩逃脫（設計 §18.8） =======================
    UI.kind("avalanche", {
      icon: ICONS.avalanche, setup: true,
      setupInfo: function () {
        var b = save().best[UI.S.resort + "/avalanche"];
        return '<p class="inu-course-line">' + esc(t("inu_avalanche_info")) + "</p>" + (b ? '<p class="inu-course-best">' + esc(t("inu_best_points", { v: b.score })) + "</p>" : "");
      },
      begin: function (r, terrain, vopts, info) {
        var world = UI.worldOf(r.resort, terrain);
        var piste = info.gs.piste;
        r.run = MS.newAvalanche(terrain, world, { piste: piste, seed: Core.hash(UI.whenKey() + "|av"), dog: r.dog, cond: r.std ? null : r.cond });
        var fin = T.at(r.run.piste, r.run.piste.len - D.GATES.finishMargin);
        vopts.mode = "avalanche"; vopts.piste = piste; vopts.avalanche = true;
        vopts.world = { trees: world.trees, bones: [], spots: [], lifts: [] };
        vopts.finish = { x: fin.x, z: fin.z, tx: fin.tx, tz: fin.tz, s: r.run.piste.len - D.GATES.finishMargin };
      },
      st: function (r) { return r.run.st; },
      done: function (r) { return r.run.status !== "run"; },
      events: function (r) { return r.run.events; },
      steps: function (r) { return r.run.steps; },
      step: function (r, auto) {
        var run = r.run, inp;
        if (auto) { var a = T.at(run.piste, Math.min(run.piste.len, run.s + 25)); inp = { s: SLP.steerTo(run.st, a.x, a.z, Phys.speed(run.st)), c: 1, j: 0, g: 0 }; }
        else inp = UI.Input.sample();
        r.lastInput = inp;
        MS.stepAvalanche(run, inp);
      },
      help: function () { return t("inu_help_avalanche"); },
      html: function () { return '<div class="inu-avgap" id="inu-avgap"><span class="inu-avgap-ico" aria-hidden="true"></span><b id="inu-avgap-m">40</b><small>m</small></div><div class="inu-danger" id="inu-danger" aria-hidden="true"></div>'; },
      hud: function (r) {
        var run = r.run, gap = Math.max(0, run.s - run.front);
        var g = Math.round(gap);
        if (r.hud.gap !== g) {
          r.hud.gap = g;
          var el = document.getElementById("inu-avgap-m"); if (el) el.textContent = g;
          var box = document.getElementById("inu-avgap"); if (box) box.classList.toggle("is-close", gap < 20);
          var dn = document.getElementById("inu-danger"); if (dn) dn.style.opacity = Math.max(0, Math.min(1, (25 - gap) / 20)).toFixed(2);
        }
        return { time: fmtTime(run.steps / HZ), sub: t("inu_av_dist", { d: Math.max(0, Math.floor(run.s - D.GATES.startS)) }), prog: Math.min(1, run.s / run.piste.len) };
      },
      event: function (r, e) { if (e.e === "caught") { if (UI.S.view) UI.S.view.fx("fall"); UI.vibrate(200); return true; } return false; },
      fx: function (r, fx) { fx.front = r.run.front; },
      end: function (r) { UI.banner(r.run.escaped ? t("inu_escaped") : t("inu_caught"), r.run.escaped ? "is-go" : "is-warn"); if (r.run.escaped && UI.S.view) UI.S.view.fx("finish"); },
      result: function (r) {
        var run = r.run, key = r.resort + "/avalanche", b = save().best[key], nb = !b || run.score > b.score;
        if (nb) save().best[key] = { score: run.score, escaped: run.escaped, at: Date.now() };
        UI.persist();
        UI.S.screen = "result";
        var info = UI.resortInfo(r.resort);
        var body = '<p class="inu-place-big">' + esc(run.escaped ? t("inu_escaped") : t("inu_caught")) + "</p>"
          + '<p class="inu-bigscore"><span id="inu-bigscore">0</span><small>' + esc(t("inu_points")) + "</small></p>"
          + (nb ? '<p class="inu-newbest">' + esc(t("inu_new_best_score")) + "</p>" : "")
          + '<div class="inu-collect"><div class="inu-collect-card"><span>📏</span><b>' + Math.floor(run.s - D.GATES.startS) + " m</b><small>" + esc(t("inu_av_distance")) + '</small></div><div class="inu-collect-card"><span>⏱</span><b>' + Math.floor(run.steps / HZ) + "</b><small>" + esc(t("inu_av_alive")) + "</small></div></div>"
          + backBtns('<button type="button" class="inu-primary" data-act="retry">' + esc(t("inu_retry")) + "</button>");
        app.innerHTML = resultShell(ICONS.avalanche, t("inu_event_avalanche"), L(info.name), body, run.escaped);
        UI.countUp(document.getElementById("inu-bigscore"), run.score, function (v) { return String(Math.round(v)); }, 1000);
        on("retry", function () { UI.startRace(r.resort, { event: "avalanche" }); });
        bindBack();
      },
      debug: function (r) { return { status: r.run.status, steps: r.run.steps, score: r.run.score, escaped: r.run.escaped, front: r.run.front, s: r.run.s }; },
    });

    // ======================= 觀戰（競猜的比賽；B5 即時勝率） =======================
    // opts：{card, detail, val, focus, names: [..], onEnd(r)}；畫面只是重播已算好的模擬
    function watchFrames(r) {
      var card = r.opts.card, det = r.opts.detail;
      if (card.event === "gs") return det.runs[1].map(function (c) { return c.frames; });
      if (card.event === "slope") return det.results.map(function (c) { return c.frames; });
      return det.frames;
    }
    function fakeSt(fr, prev) {
      return { p: [fr[0], fr[1], fr[2]], v: [(fr[0] - prev[0]) * HZ, (fr[1] - prev[1]) * HZ, (fr[2] - prev[2]) * HZ], h: [fr[3], fr[4]], edge: fr[5], crouch: fr[6], air: !!fr[7], zoom: 0, zoomT: 0, fall: 0, airSteps: 0, scent: 0, scentShow: 0, scentIn: -1 };
    }
    UI.kind("watch", {
      icon: ICONS.watch, noZoom: true,
      begin: function (r, terrain, vopts) {
        var card = r.opts.card, det = r.opts.detail;
        r.frames = watchFrames(r);
        r.maxLen = 0;
        r.frames.forEach(function (f) { if (f.length > r.maxLen) r.maxLen = f.length; });
        r.i = 0;
        r.focus = r.opts.focus || 0;
        r.pi = T.piste(terrain, card.piste);
        var dog = breedOf(card.field[r.focus].id);
        vopts.breed = dog; vopts.piste = card.piste; vopts.mode = card.event; vopts.weather = card.cond;
        if (card.event === "gs") {
          var g = Core.newRun(terrain, { piste: card.piste, seed: card.seed, dog: dog, snow: "groomed", runNo: 1 });
          vopts.gates = g.gates; vopts.finish = g.finish; r.finishS = g.finish.s || r.pi.len - D.GATES.finishMargin;
        } else if (card.event === "slope") {
          var sl = SLP.newSlope(terrain, { piste: card.piste, seed: card.seed, dog: dog, snow: "groomed", runNo: 0 });
          vopts.feats = sl.feats; vopts.finish = sl.finish; vopts.terrain = sl.terrain; r.finishS = sl.finish.s;
        } else {
          vopts.feats = det.feats; vopts.finish = det.finish; vopts.terrain = det.terrain; vopts.cuts = det.cuts; r.finishS = det.finish.s;
        }
        vopts.others = [];
        card.field.forEach(function (e, k) { if (k !== r.focus) vopts.others.push({ breed: breedOf(e.id), ghost: card.event !== "cross", name: (k + 1) + " " + nameOf(e.id), scarf: 0x2a6fd6 }); });
        r.hist = [];
      },
      st: function (r) { var f = r.frames[r.focus], i = Math.min(r.i, f.length - 1); return fakeSt(f[i], f[Math.max(0, i - 1)]); },
      done: function (r) { return r.i >= r.maxLen - 1; },
      events: function () { return []; },
      steps: function (r) { return r.i; },
      step: function (r) { r.i += 1; },
      others: function (r) {
        var out = [];
        r.frames.forEach(function (f, k) { if (k !== r.focus) out.push(f[Math.min(r.i, f.length - 1)]); });
        return out;
      },
      help: function () { return t("inu_help_watch"); },
      html: function (r) { return '<button type="button" class="inu-chip inu-chip-skip" id="btn-inu-wskip">' + esc(t("inu_skip")) + '</button><div class="inu-watch-tag">' + esc(t("inu_watching", { name: nameOf(r.opts.card.field[r.opts.focus || 0].id) })) + "</div>"; },
      bind: function (r) {
        document.getElementById("btn-inu-wskip").addEventListener("click", function () { if (UI.S.race === r) { r.phase = "done"; UI.stopLoop(); UI.showResult(r); } });
      },
      hud: function (r) {
        var card = r.opts.card;
        if (r.hud.wp !== r.i - r.i % 30) {
          r.hud.wp = r.i - r.i % 30;
          var rows = liveProb(r);
          var el = document.getElementById("inu-standings");
          if (el) el.innerHTML = rows.map(function (x, n) {
            return '<li class="' + (x.k === r.focus ? "is-me" : "") + '"><b>' + (n + 1) + "</b>" + esc((x.k + 1) + " " + nameOf(card.field[x.k].id)) + (x.p !== null ? "<em>" + Math.round(x.p * 100) + "%</em>" : "") + "</li>";
          }).join("");
        }
        var fs2 = r.frames[r.focus][Math.min(r.i, r.frames[r.focus].length - 1)];
        var s = T.nearest(r.pi, fs2[0], fs2[2]).s;
        return { time: fmtTime(r.i / HZ), sub: t(card.event === "gs" ? "inu_watch_run2" : "inu_event_" + card.event), prog: Math.min(1, s / r.finishS) };
      },
      end: function (r) { UI.banner(t("inu_finish"), "is-go"); if (UI.S.view) UI.S.view.fx("finish"); },
      result: function (r) { r.opts.onEnd(r); },
      debug: function (r) { return { status: r.i >= r.maxLen - 1 ? "finish" : "run", steps: r.i, watch: true }; },
    });
    // B5 即時勝率（設計 §18.1）：已花時間＋剩餘距離÷近 3 秒平均速度；只顯示
    function liveProb(r) {
      var card = r.opts.card, n = r.frames.length, est = [], i = r.i, k;
      var s = [];
      for (k = 0; k < n; k++) {
        var f = r.frames[k], fi = Math.min(i, f.length - 1);
        s.push(T.nearest(r.pi, f[fi][0], f[fi][2]).s);
      }
      r.hist.push(s);
      if (r.hist.length > 7) r.hist.shift();
      var old = r.hist[0], dtH = (r.hist.length - 1) * 0.5;
      if (card.event === "slope") {
        return card.field.map(function (e, kk) { return { k: kk, p: r.opts.preWin ? r.opts.preWin[kk] : null, s: s[kk] }; }).sort(function (a, b) { return b.s - a.s; });
      }
      var det = r.opts.detail;
      for (k = 0; k < n; k++) {
        var base = card.event === "gs" ? det.runs[0][k].time : 0;
        var fin = card.event === "gs" ? det.runs[1][k] : null;
        var len = r.frames[k].length;
        var tFin = card.event === "gs" ? (fin.status === "finish" ? fin.time : null) : r.opts.val[k];
        if (base === null) { est.push(null); continue; }
        if (i >= len - 1) { est.push(tFin === null ? null : base + tFin); continue; }
        var v = dtH > 0 ? (s[k] - old[k]) / dtH : 8;
        if (v < 2) v = 2;
        est.push(base + i / HZ + (r.finishS - s[k]) / v);
      }
      var wp = Bet.winProb(est);
      var rows = [];
      for (k = 0; k < n; k++) rows.push({ k: k, p: est[k] === null ? 0 : wp[k], e: est[k] });
      rows.sort(function (a, b) { return (a.e === null ? 1e9 : a.e) - (b.e === null ? 1e9 : b.e); });
      return rows;
    }

    // ======================= 競猜（設計 §18.1） =======================
    var TYPES = D.BET.types;
    function slots() {
      var date = UI.jstDate(), hr = new Date(Date.now() + 9 * 3600000).getUTCHours(), blk = Math.floor(hr / 2);
      var out = [];
      for (var i = 0; i < 3; i++) {
        var seed = Core.hash("betslot|" + date + "|" + blk + "|" + i);
        var resort = D.RESORTS[seed % D.RESORTS.length];
        var ev = ["gs", "slope", "cross"][(i + (seed >>> 5)) % 3];
        out.push({ key: date + "#" + blk + "#" + i, seed: seed, resort: resort, event: ev, cond: Env.conditions(seed, resort, month(), {}), start: blk * 2 });
      }
      return out;
    }
    function settledLog(key) { var lg = save().betLog || []; for (var i = 0; i < lg.length; i++) if (lg[i].key === key) return lg[i]; return null; }
    function pendingOf(key) { var b = save().bets || []; for (var i = 0; i < b.length; i++) if (b[i].key === key) return b[i]; return null; }
    // 過了時段還沒出發的票：退還狗幣（記在收支紀錄）
    function refundExpired() {
      var keys = {}, s = save();
      slots().forEach(function (sl) { keys[sl.key] = 1; });
      var keep = [];
      (s.bets || []).forEach(function (b) {
        if (keys[b.key]) { keep.push(b); return; }
        var st = (b.lines || []).reduce(function (a, l) { return a + l.stake; }, 0) + (b.time ? b.time.stake : 0);
        s.coins += st;
        s.betLog = (s.betLog || []).concat([{ key: b.key, resort: "", resortName: t("inu_bet_refund"), event: "gs", stake: st, pay: st, at: Date.now() }]).slice(-30);
      });
      if (keep.length !== (s.bets || []).length) { s.bets = keep; UI.persist(); }
    }
    function renderBetTab(el) {
      Bet.refill(save(), UI.jstDate());
      refundExpired();
      var html = '<section class="inu-bethead"><div class="inu-bethead-coins"><i aria-hidden="true"></i><b>' + save().coins + "</b><small>" + esc(t("inu_coins")) + "</small></div>"
        + '<p class="inu-muted">' + esc(t("inu_bet_note", { floor: D.BET.coinsFloor })) + "</p></section>";
      html += '<h2 class="inu-h2">' + esc(t("inu_bet_races")) + '</h2><div class="inu-betslots">';
      slots().forEach(function (sl, i) {
        var info = UI.resortInfo(sl.resort), done = settledLog(sl.key), pend = pendingOf(sl.key);
        html += '<button type="button" class="inu-betslot" data-slot="' + i + '" style="--d:' + (i * 0.06) + 's"><span class="inu-betslot-ev">' + UI.ICON[sl.event] + "</span>"
          + '<span class="inu-betslot-main"><b>' + esc(t("inu_race_no", { n: i + 1 })) + "・" + esc(t("inu_event_" + sl.event)) + "</b><span>" + esc(info ? L(info.name) : sl.resort) + "</span>"
          + '<span class="inu-betslot-cond">' + esc(UI.condLabel(sl.cond)) + (sl.cond.change ? "　" + esc(t("inu_wx_chance", { w: L(D.WEATHER[sl.cond.change.to].name), p: Math.round(sl.cond.change.chance * 100) })) : "") + "</span></span>"
          + '<span class="inu-betslot-state' + (done ? " is-done" : pend ? " is-pend" : "") + '">' + esc(done ? t("inu_bet_done", { pay: done.pay }) : pend ? t("inu_bet_pending") : t("inu_bet_open")) + "</span></button>";
      });
      html += "</div>";
      var lg = (save().betLog || []).slice(-6).reverse();
      if (lg.length) {
        html += '<h3 class="inu-h3">' + esc(t("inu_bet_history")) + '</h3><ul class="inu-betlog">' + lg.map(function (x) {
          return "<li><span>" + esc(t("inu_event_" + x.event)) + "・" + esc(x.resortName || x.resort) + "</span><b class=\"" + (x.pay > x.stake ? "is-plus" : "") + '">' + (x.pay - x.stake >= 0 ? "+" : "") + (x.pay - x.stake) + "</b></li>";
        }).join("") + "</ul>";
      }
      el.innerHTML = html;
      Array.prototype.forEach.call(el.querySelectorAll(".inu-betslot"), function (b) {
        b.addEventListener("click", function () { openCard(slots()[+b.getAttribute("data-slot")]); });
      });
    }

    // 出賽表畫面
    var BC = null;     // 目前的出賽表狀態
    function openCard(sl) {
      var info = UI.resortInfo(sl.resort);
      if (!info) return;
      UI.stopLoop();
      UI.S.screen = "loading";
      loading(t("inu_loading_resort", { name: L(info.name) }));
      UI.loadTerrain(sl.resort).then(function (terrain) {
        var ev = sl.event, pinfo = ev === "slope" ? info.slope : ev === "cross" ? info.cross : info.gs;
        var card = Bet.makeCard(terrain, { resort: sl.resort, event: ev, seed: sl.seed, piste: pinfo.piste, cond: sl.cond, month: month() });
        var pend = pendingOf(sl.key);
        BC = { sl: sl, card: card, terrain: terrain, info: info, acc: Bet.oddsInit(card), prac: [], lines: pend ? pend.lines.slice() : [], time: pend ? pend.time : null,
          type: "win", method: "normal", sel: [], axis: null, stake: 100, done: !!settledLog(sl.key) };
        UI.S.screen = "betcard";
        renderCard();
        pumpOdds();
      }).catch(function (e) { if (window.console) console.error(e); UI.S.msg = t("inu_load_fail"); UI.show("resorts"); });
    }
    // 賠率：每批模擬 1 次，讓畫面更新進度
    function pumpOdds() {
      var bc = BC;
      if (!bc || UI.S.screen !== "betcard") return;
      var t0 = performance.now();
      while (bc.prac.length < bc.card.field.length && performance.now() - t0 < 30) bc.prac.push(Bet.practice(bc.terrain, bc.card, bc.prac.length));
      var fin = bc.acc.n >= bc.acc.total;
      while (!fin && performance.now() - t0 < 40) fin = Bet.oddsStep(bc.terrain, bc.card, bc.acc);
      var bar = document.getElementById("inu-odds-bar");
      if (bar) bar.style.width = Math.round(100 * bc.acc.n / bc.acc.total) + "%";
      if (fin && bc.prac.length >= bc.card.field.length) { bc.ready = true; renderCard(); return; }
      if (bc.prac.length >= bc.card.field.length && !bc.pracShown) { bc.pracShown = true; renderCard(); }
      setTimeout(pumpOdds, 0);
    }
    function formIcon(f) { return ["↓", "↘", "→", "↗", "↑"][f - 1]; }
    function stars(n) { var s = ""; for (var i = 0; i < 5; i++) s += i < n ? "★" : "☆"; return s; }
    function keyLabel(key) {
      var p = key.split(":"), sel = p[1].split("-").map(function (x) { return +x + 1; });
      var ord = p[0] === "exacta" || p[0] === "trifecta";
      return t("inu_bt_" + p[0]) + " " + sel.join(ord ? "→" : "・");
    }
    function renderCard() {
      var bc = BC;
      if (!bc || UI.S.screen !== "betcard") return;
      var card = bc.card, ready = !!bc.ready, sea = save().season;
      var html = '<div class="inu-page inu-betcard' + (bc.drawn ? " is-static" : " inu-anim-in") + '"><button type="button" class="inu-link" data-act="back">← ' + esc(t("inu_back")) + "</button>";
      html += '<header class="inu-cardhead"><span class="inu-cardhead-ev">' + UI.ICON[card.event] + '</span><div><h2 class="inu-h2">' + esc(t("inu_event_" + card.event)) + "　<small>" + esc(L(bc.info.name)) + "</small></h2>"
        + '<p class="inu-cardcond">' + esc(UI.condLabel(card.cond)) + (card.cond.change ? "　" + esc(t("inu_wx_chance", { w: L(D.WEATHER[card.cond.change.to].name), p: Math.round(card.cond.change.chance * 100) })) : "") + "</p></div></header>";
      html += '<div class="inu-odds-prog' + (ready ? " is-done" : "") + '"><span>' + esc(ready ? t("inu_odds_ready", { n: bc.acc.n }) : t("inu_odds_calc")) + '</span><i><b id="inu-odds-bar" style="width:' + Math.round(100 * bc.acc.n / bc.acc.total) + '%"></b></i></div>';
      // 出賽表（B2）
      html += '<div class="inu-entries"><div class="inu-entry inu-entry-head"><span>#</span><span></span><span>' + esc(t("inu_rider")) + "</span><span>" + esc(t("inu_form")) + "</span><span>" + esc(t("inu_apt")) + "</span><span>" + esc(t("inu_practice")) + "</span><span>" + esc(t("inu_recent")) + "</span><span>" + esc(t("inu_odds_win")) + "</span></div>";
      card.field.forEach(function (e, k) {
        var c = cpuById(e.id), pk = bc.sel.indexOf(k) >= 0, ax = bc.axis === k, pr = bc.prac[k];
        var rec = SE.recent(sea, e.id);
        html += '<button type="button" class="inu-entry' + (pk ? " is-pick" : "") + (ax ? " is-axis" : "") + '" data-pick="' + k + '" style="--d:' + (k * 0.03) + 's"' + (bc.done ? " disabled" : "") + ">"
          + '<span class="inu-entry-no">' + (k + 1) + "</span><span>" + UI.dogFace(Core.breed(c.breed), "is-mini") + "</span>"
          + '<span class="inu-entry-name">' + esc(L(c.name)) + ' <small class="inu-lv">Lv' + c.lv + "</small><small>" + esc(L(Core.breed(c.breed).name)) + "</small></span>"
          + '<span class="inu-form inu-form-' + e.form + '">' + formIcon(e.form) + "</span>"
          + '<span class="inu-apt">' + stars(e.apt) + "</span>"
          + "<span>" + esc(pr === undefined ? "…" : pr === null ? "—" : card.event === "slope" ? fmtScore(pr) : fmtTime(pr)) + "</span>"
          + '<span class="inu-recent">' + esc(rec.length ? rec.join("-") : "—") + "</span>"
          + '<span class="inu-entry-odds">' + (ready ? Bet.odds(bc.acc, "win:" + k).toFixed(1) : "…") + "</span></button>";
      });
      html += "</div>";
      if (!bc.done) {
        // 買票
        html += '<section class="inu-ticket"><h3 class="inu-h3">' + esc(t("inu_ticket")) + "</h3>";
        html += '<div class="inu-seg inu-bt-types">' + TYPES.map(function (ty) { return '<button type="button" data-bt="' + ty + '" class="' + (bc.type === ty ? "is-on" : "") + '">' + esc(t("inu_bt_" + ty)) + "</button>"; }).join("") + "</div>";
        if (Bet.SIZE[bc.type] > 1) html += '<div class="inu-seg inu-bt-methods">' + ["normal", "box", "axis"].map(function (m) { return '<button type="button" data-bm="' + m + '" class="' + (bc.method === m ? "is-on" : "") + '">' + esc(t("inu_bm_" + m)) + "</button>"; }).join("") + "</div>";
        html += '<p class="inu-help inu-help-tight">' + esc(t("inu_bt_help_" + (Bet.SIZE[bc.type] === 1 ? "one" : bc.method))) + "</p>";
        var combos = bc.sel.length ? Bet.expand({ type: bc.type, method: Bet.SIZE[bc.type] === 1 ? "normal" : bc.method, sel: bc.sel, axis: bc.axis }) : [];
        html += '<div class="inu-ticket-row"><label class="inu-field inu-field-mini"><span>' + esc(t("inu_stake")) + '</span><input type="number" id="inu-stake" min="' + D.BET.minStake + '" max="' + D.BET.maxStake + '" step="10" value="' + bc.stake + '"></label>'
          + '<span class="inu-ticket-sum">' + esc(t("inu_ticket_sum", { n: combos.length, c: combos.length * bc.stake })) + "</span>"
          + '<button type="button" class="inu-primary" data-act="buy"' + (ready && combos.length && combos.length * bc.stake <= save().coins ? "" : " disabled") + ">" + esc(t("inu_buy")) + "</button></div>";
        if (card.event === "gs") {
          html += '<div class="inu-ticket-row inu-timebet"><label class="inu-field inu-field-mini"><span>' + esc(t("inu_timebet")) + '</span><input type="number" id="inu-timeguess" step="0.1" min="30" max="400" placeholder="' + esc(t("inu_timebet_ph")) + '"></label>'
            + '<span class="inu-ticket-sum">' + esc(t("inu_timebet_rule")) + '</span><button type="button" class="inu-secondary" data-act="timebet"' + (bc.time || !ready ? " disabled" : "") + ">" + esc(bc.time ? t("inu_timebet_set", { v: bc.time.guess.toFixed(1) }) : t("inu_buy")) + "</button></div>";
        }
        html += "</section>";
      }
      if (bc.lines.length || bc.time) {
        var tot = bc.lines.reduce(function (a, l) { return a + l.stake; }, 0) + (bc.time ? bc.time.stake : 0);
        html += '<h3 class="inu-h3">' + esc(t("inu_my_tickets")) + ' <small>' + esc(t("inu_ticket_total", { c: tot })) + '</small></h3><ul class="inu-lines">' + bc.lines.map(function (l) {
          return "<li><span>" + esc(keyLabel(l.key)) + "</span><span>" + l.stake + "</span><b>×" + l.odds.toFixed(1) + "</b></li>";
        }).join("") + (bc.time ? "<li><span>" + esc(t("inu_timebet")) + " " + bc.time.guess.toFixed(1) + "</span><span>" + bc.time.stake + "</span><b>×5／×12</b></li>" : "") + "</ul>";
      }
      html += '<div class="inu-actions"><button type="button" class="inu-primary inu-go" data-act="race"' + (ready ? "" : " disabled") + ">" + esc(bc.done ? t("inu_watch_again") : t("inu_bet_start")) + "</button></div></div>";
      var keep = bc.drawn && app.querySelector(".inu-page") ? app.querySelector(".inu-page").scrollTop : 0;
      bc.drawn = true;
      app.innerHTML = html;
      var pg = app.querySelector(".inu-page"); if (pg) pg.scrollTop = keep;
      on("back", function () { BC = null; UI.S.tab = "bet"; UI.show("resorts"); });
      Array.prototype.forEach.call(app.querySelectorAll("[data-pick]"), function (b) {
        b.addEventListener("click", function () {
          var k = +b.getAttribute("data-pick"), i = bc.sel.indexOf(k);
          if (bc.method === "axis" && Bet.SIZE[bc.type] > 1 && bc.axis === null) { bc.axis = k; if (i < 0) bc.sel.push(k); }
          else if (i >= 0) { bc.sel.splice(i, 1); if (bc.axis === k) bc.axis = null; }
          else {
            if (Bet.SIZE[bc.type] === 1 || bc.method === "normal") { if (bc.sel.length >= Bet.SIZE[bc.type]) bc.sel.shift(); }
            bc.sel.push(k);
          }
          renderCard();
        });
      });
      Array.prototype.forEach.call(app.querySelectorAll("[data-bt]"), function (b) { b.addEventListener("click", function () { bc.type = b.getAttribute("data-bt"); bc.sel = []; bc.axis = null; renderCard(); }); });
      Array.prototype.forEach.call(app.querySelectorAll("[data-bm]"), function (b) { b.addEventListener("click", function () { bc.method = b.getAttribute("data-bm"); bc.sel = []; bc.axis = null; renderCard(); }); });
      var stake = document.getElementById("inu-stake");
      if (stake) stake.addEventListener("change", function () { var v = Math.round((+stake.value || 0) / 10) * 10; bc.stake = Math.max(D.BET.minStake, Math.min(D.BET.maxStake, v)); renderCard(); });
      on("buy", function () {
        var tk = { type: bc.type, method: Bet.SIZE[bc.type] === 1 ? "normal" : bc.method, sel: bc.sel, axis: bc.axis, stake: bc.stake };
        var lines = Bet.buy(tk, bc.acc), cost = lines.length * bc.stake;
        if (!lines.length || cost > save().coins) return;
        save().coins -= cost;
        bc.lines = bc.lines.concat(lines); bc.sel = []; bc.axis = null;
        storePending(bc);
        UI.toastText(t("inu_bought", { c: cost }), "is-gold");
        renderCard();
      });
      on("timebet", function () {
        var g = +(document.getElementById("inu-timeguess").value || 0);
        if (!(g > 0) || bc.stake > save().coins) return;
        save().coins -= bc.stake;
        bc.time = { guess: Math.floor(g * 10 + 0.5) / 10, stake: bc.stake };
        storePending(bc);
        renderCard();
      });
      on("race", function () { runBetRace(bc); });
    }
    function storePending(bc) {
      var s = save();
      s.bets = (s.bets || []).filter(function (b) { return b.key !== bc.sl.key; });
      s.bets.push({ key: bc.sl.key, lines: bc.lines, time: bc.time });
      UI.persist();
    }
    function runBetRace(bc) {
      var res = Bet.simulate(bc.terrain, bc.card, bc.card.seed, true);
      var focus = bc.lines.length ? +bc.lines[0].key.split(":")[1].split("-")[0] : res.order[0];
      var preWin = bc.card.field.map(function (e, k) { return (bc.acc.c["win:" + k] || 0) / Math.max(1, bc.acc.n); });
      var settle = null;
      if (!bc.done) {
        var lines = Bet.settle(bc.lines, res.order, res.val);
        var pay = lines.reduce(function (a, l) { return a + l.pay; }, 0), stake = lines.reduce(function (a, l) { return a + l.stake; }, 0);
        var tp = 0;
        if (bc.time) { tp = Bet.timePay(bc.time.guess, bc.time.stake, res.val[res.order[0]]); pay += tp; stake += bc.time.stake; }
        save().coins += pay;
        save().bets = (save().bets || []).filter(function (b) { return b.key !== bc.sl.key; });
        save().betLog = (save().betLog || []).concat([{ key: bc.sl.key, resort: bc.sl.resort, resortName: L(bc.info.name), event: bc.card.event, stake: stake, pay: pay, at: Date.now() }]).slice(-30);
        UI.persist();
        settle = { lines: lines, pay: pay, stake: stake, tp: tp };
        bc.done = true;
      }
      UI.startRace(bc.sl.resort, { event: "watch", card: bc.card, detail: res.detail, val: res.val, focus: focus, preWin: preWin, cond: bc.card.cond,
        onEnd: function () { showBetResult(bc, res, settle); } });
    }
    function showBetResult(bc, res, settle) {
      UI.S.screen = "result";
      var card = bc.card;
      var rows = res.order.map(function (k, n) {
        var e = card.field[k], c = cpuById(e.id), v = res.val[k];
        return { place: v === null ? 0 : n + 1, name: (k + 1) + " " + L(c.name), breed: Core.breed(c.breed), lv: c.lv, val: v === null ? t("inu_dnf") : card.event === "slope" ? fmtScore(v) : fmtTime(v) };
      });
      var body = '<div class="inu-podium">' + [1, 0, 2].map(function (i) { var x = rows[i]; return x ? '<div class="inu-podium-step inu-podium-' + (i + 1) + '">' + UI.dogFace(x.breed) + "<span>" + esc(x.name) + "</span><b>" + (i + 1) + "</b></div>" : ""; }).join("") + "</div>";
      if (settle) {
        var net = settle.pay - settle.stake;
        body += '<div class="inu-payout' + (net > 0 ? " is-win" : "") + '"><span>' + esc(t("inu_payout")) + '</span><b id="inu-pay">0</b><small>' + esc(t("inu_coins")) + '</small><em>' + esc(t("inu_net", { v: (net >= 0 ? "+" : "") + net })) + "</em></div>";
        if (settle.lines.length) body += '<ul class="inu-lines is-settled">' + settle.lines.map(function (l) {
          return '<li class="' + (l.hit ? "is-hit" : "") + '"><span>' + esc(keyLabel(l.key)) + "</span><span>" + l.stake + "×" + l.odds.toFixed(1) + "</span><b>" + (l.hit ? "+" + l.pay : "—") + "</b></li>";
        }).join("") + "</ul>";
        if (bc.time) body += '<p class="inu-muted">' + esc(t("inu_timebet_res", { g: bc.time.guess.toFixed(1), w: fmtTime(res.val[res.order[0]]), p: settle.tp })) + "</p>";
      }
      body += '<h3 class="inu-h3">' + esc(t("inu_ranking")) + "</h3>" + UI.standingsTable({ col: card.event === "slope" ? t("inu_score") : t("inu_time"), list: rows });
      body += '<div class="inu-actions"><button type="button" class="inu-primary" data-act="bets">' + esc(t("inu_to_bets")) + '</button><button type="button" class="inu-secondary" data-act="resorts">' + esc(t("inu_to_resorts")) + "</button></div>";
      app.innerHTML = resultShell(UI.ICON[card.event], t("inu_bet_result"), L(bc.info.name), body, settle && settle.pay > settle.stake);
      if (settle) UI.countUp(document.getElementById("inu-pay"), settle.pay, function (v) { return String(Math.round(v)); }, 1100);
      on("bets", function () { UI.S.tab = "bet"; UI.show("resorts"); });
      on("resorts", function () { UI.S.tab = "resorts"; UI.show("resorts"); });
    }
    UI.screen("betcard", renderCard);
    UI.tab({ id: "bet", icon: "🎫", label: "inu_tab_bet", render: renderBetTab });

    // ======================= M3 世界盃（設計 §18.7） =======================
    function renderCupTab(el) {
      var sea = save().season, html = "";
      if (!sea) {
        html = '<section class="inu-cupintro"><div class="inu-cup-trophy" aria-hidden="true"></div><h2 class="inu-h2">' + esc(t("inu_cup_title")) + "</h2><p>" + esc(t("inu_cup_intro", { n: D.CUP.stages, f: D.CUP.field + 1 })) + '</p><button type="button" class="inu-primary inu-go" data-act="newseason">' + esc(t("inu_cup_start")) + "</button></section>";
        el.innerHTML = html;
        on("newseason", function () { newSeason(); }, el);
        return;
      }
      var stg = SE.stages(sea), stand = SE.standings(sea), myRank = 0;
      stand.forEach(function (x, i) { if (x.id === "me") myRank = i + 1; });
      html += '<section class="inu-cuphead"><div><h2 class="inu-h2">' + esc(t("inu_cup_title")) + '</h2><p class="inu-muted">' + esc(t("inu_cup_progress", { n: Math.min(sea.stage, D.CUP.stages), max: D.CUP.stages })) + '</p></div><div class="inu-cup-rank"><small>' + esc(t("inu_cup_myrank")) + "</small><b>" + myRank + "</b><span>" + (sea.points.me || 0) + " pt</span></div></section>";
      html += '<ol class="inu-stages">' + stg.map(function (s, i) {
        var info = UI.resortInfo(s.resort), res = sea.results[i], me = res ? res.order.indexOf("me") + 1 : 0;
        var cls = res ? "is-done" : i === sea.stage ? "is-next" : "";
        return '<li class="inu-stage-card ' + cls + '" style="--d:' + (i * 0.04) + 's"><span class="inu-stage-no">' + (i + 1) + "</span>" + UI.ICON[s.event] + '<span class="inu-stage-name">' + esc(info ? L(info.name) : s.resort) + "<small>" + esc(t("inu_event_" + s.event)) + "</small></span>"
          + '<span class="inu-stage-res">' + (res ? UI.medal(me) + esc(t("inu_place", { n: me })) + "<small>+" + SE.pointsFor(me) + "</small>" : i === sea.stage ? esc(t("inu_cup_next")) : "") + "</span></li>";
      }).join("") + "</ol>";
      if (SE.done(sea)) {
        html += '<div class="inu-cup-final' + (myRank <= 3 ? " is-podium" : "") + '"><p>' + esc(t("inu_cup_done", { n: myRank })) + "</p></div>";
        html += '<div class="inu-actions"><button type="button" class="inu-primary" data-act="newseason">' + esc(t("inu_cup_new")) + "</button></div>";
      } else {
        html += '<div class="inu-actions"><button type="button" class="inu-primary inu-go" data-act="stage">' + esc(t("inu_cup_go", { n: sea.stage + 1 })) + "</button></div>";
      }
      html += '<h3 class="inu-h3">' + esc(t("inu_cup_standings")) + '</h3><table class="inu-table inu-cuptable"><tbody>' + stand.slice(0, 12).concat(myRank > 12 ? [stand[myRank - 1]] : []).map(function (x) {
        var rk = stand.indexOf(x) + 1;
        return '<tr class="' + (x.id === "me" ? "is-me" : "") + '"><td>' + rk + "</td><td>" + UI.medal(rk) + "</td><td>" + UI.dogFace(breedOf(x.id), "is-mini") + esc(nameOf(x.id)) + "</td><td>" + x.pts + " pt</td></tr>";
      }).join("") + "</tbody></table>";
      el.innerHTML = html;
      on("newseason", function () { if (!SE.done(sea) || window.confirm(t("inu_cup_confirm"))) newSeason(); }, el);
      on("stage", function () { startStage(); }, el);
    }
    function newSeason() {
      save().season = SE.newSeason(Core.hash("season|" + UI.whenKey()));
      UI.persist(); UI.S.tab = "cup"; UI.show("resorts");
    }
    function startStage() {
      var sea = save().season, s = SE.stages(sea)[sea.stage], fld = SE.field(sea);
      var opts = { event: s.event, mode: "race", cond: Env.conditions(s.seed, s.resort, month(), {}), label: t("inu_cup_stage", { n: sea.stage + 1 }), after: cupAfter };
      if (s.event === "cross") {
        // 決賽組：目前積分最高的 5 隻 CPU；其他 18 隻分 3 組用模擬（設計 §18.7、U3）
        var stand = SE.standings(sea).filter(function (x) { return x.id !== "me"; });
        var top = stand.slice(0, 5).map(function (x) { return x.id; });
        opts.field = fld.filter(function (c) { return top.indexOf(c.id) >= 0; });
        opts.rest = fld.filter(function (c) { return top.indexOf(c.id) < 0; });
        opts.seed = s.seed;
      } else {
        opts.field = fld;
        if (s.event === "gs") opts.pickKey = "cup|" + sea.seed + "|" + sea.stage; else opts.seed = s.seed;
      }
      UI.S.resort = s.resort;
      UI.startRace(s.resort, opts);
    }
    function cupAfter(r) {
      var sea = save().season, order = [];
      if (r.kind === "gs") {
        var list = r.cpus.map(function (c) { return { id: c.cpu.id, v: c.time }; });
        list.push({ id: "me", v: r.run.status === "finish" ? r.run.time : null });
        list.sort(function (a, b) { return (a.v === null ? 1e9 : a.v) - (b.v === null ? 1e9 : b.v); });
        order = list.map(function (x) { return x.id; });
      } else if (r.kind === "slope") {
        var sl = r.cpus.map(function (c) { return { id: c.cpu.id, v: c.score }; });
        sl.push({ id: "me", v: r.run.status === "dsq" ? -1 : r.run.final });
        sl.sort(function (a, b) { return b.v - a.v; });
        order = sl.map(function (x) { return x.id; });
      } else {
        var fin = r.cross.riders.map(function (x, k) { return { id: k ? r.cpus[k - 1].id : "me", p: x.place }; }).sort(function (a, b) { return a.p - b.p; });
        order = fin.map(function (x) { return x.id; });
        var rest = r.opts.rest || [], heats = [], info = UI.resortInfo(r.resort);
        for (var h = 0; h * 6 < rest.length; h++) {
          var grp = rest.slice(h * 6, h * 6 + 6), seed = (r.opts.seed ^ Core.hash("heat" + h)) >>> 0;
          var race = CX.newCross(r.terrain, { piste: info.cross.piste, seed: seed, snow: "groomed", cond: r.std ? null : r.cond, dogs: grp.map(function (c) { return Core.breed(c.breed); }) });
          var ctl = CX.controllers(race, seed, -1);
          while (race.status === "run") CX.stepCross(race, ctl.map(function (c) { return c(race); }));
          race.riders.forEach(function (x, k) { heats.push({ id: grp[k].id, p: x.place, tm: x.dnf ? 1e9 : x.time }); });
        }
        heats.sort(function (a, b) { return a.p - b.p || a.tm - b.tm; });
        order = order.concat(heats.map(function (x) { return x.id; }));
      }
      var before = sea.points.me || 0;
      SE.applyStage(sea, order);
      UI.persist();
      var place = order.indexOf("me") + 1, stand = SE.standings(sea), rk = 0;
      stand.forEach(function (x, i) { if (x.id === "me") rk = i + 1; });
      UI.S.screen = "result";
      var body = '<p class="inu-place-big">' + UI.medal(place) + esc(t("inu_place", { n: place })) + "</p>"
        + '<p class="inu-cup-gain">+' + (sea.points.me - before) + " pt　→　" + esc(t("inu_cup_myrank")) + " " + rk + "</p>"
        + '<h3 class="inu-h3">' + esc(t("inu_ranking")) + '</h3><table class="inu-table"><tbody>' + order.slice(0, 10).map(function (id, i) {
          return '<tr class="' + (id === "me" ? "is-me" : "") + '" style="--d:' + (i * 0.05) + 's"><td>' + (i + 1) + "</td><td>" + UI.medal(i + 1) + "</td><td>" + UI.dogFace(breedOf(id), "is-mini") + esc(nameOf(id)) + "</td><td>+" + SE.pointsFor(i + 1) + "</td></tr>";
        }).join("") + (place > 10 ? '<tr class="is-me"><td>' + place + "</td><td></td><td>" + esc(nameOf("me")) + "</td><td>+" + SE.pointsFor(place) + "</td></tr>" : "") + "</tbody></table>"
        + '<div class="inu-actions"><button type="button" class="inu-primary" data-act="cup">' + esc(SE.done(sea) ? t("inu_cup_final") : t("inu_cup_back")) + "</button></div>";
      var info2 = UI.resortInfo(r.resort);
      app.innerHTML = resultShell(UI.ICON[r.kind], t("inu_cup_stage", { n: sea.stage }), L(info2.name), body, place <= 3);
      on("cup", function () { UI.S.tab = "cup"; UI.show("resorts"); });
      return true;
    }
    UI.tab({ id: "cup", icon: "🏆", label: "inu_tab_cup", render: renderCupTab });

    // ======================= R1 今日雪況（設計 §18.9） =======================
    function renderDailyTab(el) {
      var date = UI.jstDate(), dy = SE.daily(date), dl = save().daily;
      var best = dl && dl.date === date ? dl.best : null;
      var ch = dy.challenge, cinfo = UI.resortInfo(ch.resort);
      var html = '<section class="inu-dailyhead"><p class="inu-daily-date">' + esc(date) + '</p><h2 class="inu-h2">' + esc(t("inu_daily_title")) + "</h2></section>";
      html += '<div class="inu-challenge"><span class="inu-challenge-badge">' + esc(t("inu_daily_challenge")) + '</span><h3>' + esc(cinfo ? L(cinfo.name) : ch.resort) + "・" + esc(t("inu_event_gs")) + "</h3>"
        + '<p class="inu-cardcond">' + esc(UI.condLabel(dy.conds[ch.resort])) + "</p>"
        + '<p class="inu-challenge-best">' + esc(best ? t("inu_daily_best", { time: fmtTime(best) }) : t("inu_no_best")) + "</p>"
        + '<button type="button" class="inu-primary inu-go" data-act="daily">' + esc(t("inu_start")) + "</button></div>";
      html += '<div class="inu-wxgrid">' + D.RESORTS.map(function (id, i) {
        var info = UI.resortInfo(id), c = dy.conds[id];
        return '<div class="inu-wxcard inu-wx-' + c.weather + (c.night ? " is-night" : "") + '" style="--d:' + (i * 0.04) + 's"><span class="inu-wxcard-ico" aria-hidden="true">' + (UI.WX_ICON[c.weather] || "") + "</span><b>" + esc(info ? L(info.name) : id) + "</b><span>" + esc(L(D.WEATHER[c.weather].name)) + "・" + esc(L(D.SNOW[c.snow].name)) + (c.night ? "・" + esc(t("inu_night")) : "") + "</span></div>";
      }).join("") + "</div>";
      el.innerHTML = html;
      on("daily", function () {
        UI.S.resort = ch.resort;
        UI.startRace(ch.resort, { event: "gs", mode: "practice", pickKey: "daily|" + date, cond: dy.conds[ch.resort], label: t("inu_daily_challenge"), after: dailyAfter });
      }, el);
    }
    function dailyAfter(r) {
      var date = UI.jstDate(), dl = save().daily, run = r.run, nb = false;
      if (run.status === "finish" && (!dl || dl.date !== date || run.time < dl.best)) { save().daily = { date: date, best: run.time, breed: save().dog.breed }; nb = true; UI.persist(); }
      UI.S.screen = "result";
      var info = UI.resortInfo(r.resort), d2 = save().daily;
      var body = run.status === "finish" ? '<p class="inu-bigtime" id="inu-bigtime">' + esc(fmtTime(run.time)) + "</p>" + (nb ? '<p class="inu-newbest">' + esc(t("inu_new_best")) + "</p>" : "")
        : '<p class="inu-bigtime is-dsq">' + esc(t("inu_dsq")) + "</p>";
      body += '<p class="inu-condline">' + esc(UI.condLabel(r.cond)) + "</p>";
      if (d2 && d2.date === date) body += '<p class="inu-total">' + esc(t("inu_daily_best", { time: fmtTime(d2.best) })) + "</p>";
      body += '<p class="inu-muted">' + esc(t("inu_daily_rmd")) + "</p>";
      body += '<div class="inu-actions"><button type="button" class="inu-primary" data-act="again">' + esc(t("inu_retry")) + '</button><button type="button" class="inu-secondary" data-act="daily">' + esc(t("inu_to_daily")) + "</button></div>";
      app.innerHTML = resultShell(UI.ICON.gs, t("inu_daily_challenge"), L(info.name), body, nb);
      on("again", function () { UI.startRace(r.resort, r.opts); });
      on("daily", function () { UI.S.tab = "daily"; UI.show("resorts"); });
      return true;
    }
    UI.tab({ id: "daily", icon: "❄", label: "inu_tab_daily", render: renderDailyTab });

    // 給 Playwright：競猜與世界盃的捷徑
    window.PriTestInusnowP3 = {
      slots: slots, openCard: function (i) { openCard(slots()[i || 0]); }, card: function () { return BC; },
      quickOdds: function (n) { if (BC) BC.acc.total = n || 2; },
      startStage: startStage, newSeason: newSeason,
    };
  });
})();
