/* イヌスノー（狗雪）畫面流程與存檔（docs/inusnow_design.md §10、§13）。
   畫面：雪場 → 選手與設定 → 比賽（倒數、滑行、終點）→ 成績（重播、分享碼）。規則都在 inusnow_core.js。 */
(function () {
  "use strict";

  var D = window.PriTestInusnowData;
  var T = window.PriTestInusnowTerrain;
  var Phys = window.PriTestInusnowPhys;
  var Core = window.PriTestInusnowCore;
  var Input = window.PriTestInusnowInput;
  var R3 = window.PriTestInusnow3D;
  var app = document.getElementById("inu-app");
  if (!app || !D || !Core) return;
  var dataDir = app.getAttribute("data-data-dir") || "../static/inusnow/data/";

  function t(k, p) { return window.I18N ? window.I18N.t(k, p) : k; }
  function lang() { return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || document.documentElement.lang || "zh"; }
  function L(obj) { if (!obj) return ""; return obj[lang()] || obj.ja || obj.zh || obj.en || ""; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmtTime(sec) {
    if (sec === null || sec === undefined || !isFinite(sec)) return "--:--.--";
    var m = Math.floor(sec / 60), s = sec - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(2);
  }
  function fmtDiff(d) { return (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(2); }

  // ---------------- 存檔 ----------------
  var save = (function () {
    try { return Core.migrate(JSON.parse(localStorage.getItem(D.SAVE_KEY) || "null")); } catch (e) { return Core.newSave(); }
  })();
  function persist() { try { localStorage.setItem(D.SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 私密模式等 */ } }

  // ---------------- 導覽列（滿版，☰ 展開；比照射彈宇宙） ----------------
  function setupNav() {
    document.body.classList.add("inu-body");
    window.requestAnimationFrame(function () { window.requestAnimationFrame(function () { document.body.classList.add("inu-nav-anim"); }); });
    var btn = document.createElement("button");
    btn.type = "button"; btn.id = "inu-nav-toggle"; btn.textContent = "☰";
    btn.setAttribute("aria-expanded", "false");
    document.body.appendChild(btn);
    btn.addEventListener("click", function (e) { e.stopPropagation(); setNav(!document.body.classList.contains("inu-nav-open")); });
    document.addEventListener("pointerdown", function (e) {
      if (!document.body.classList.contains("inu-nav-open")) return;
      var header = document.querySelector(".site-header");
      if (e.target === btn || (header && header.contains(e.target))) return;
      setNav(false);
    }, true);
  }
  function setNav(open) {
    document.body.classList.toggle("inu-nav-open", open);
    var b = document.getElementById("inu-nav-toggle");
    if (b) b.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && S.screen === "race" && S.race && !S.race.paused) togglePause(true);
  }

  // ---------------- 狀態 ----------------
  var S = {
    screen: "resorts", index: null, resort: null, terrainCache: {}, race: null, view: null, toast: null,
    autopilot: false, msg: "",
  };

  function bestKey(resort, runNo) { return resort + "/gs/" + runNo; }

  // ---------------- 畫面：雪場清單 ----------------
  function renderResorts() {
    var html = '<div class="inu-page"><header class="inu-hero"><h1 class="inu-title">' + esc(t("inu_title")) + '</h1><p class="inu-sub">' + esc(t("inu_subtitle")) + "</p></header>";
    html += '<h2 class="inu-h2">' + esc(t("inu_pick_resort")) + "　<small>" + esc(t("inu_event_gs")) + "</small></h2>";
    if (!S.index) {
      html += '<p class="inu-muted">' + esc(S.msg || t("inu_loading")) + "</p>";
    } else {
      html += '<div class="inu-resorts">';
      S.index.resorts.forEach(function (r) {
        if (D.RESORTS.indexOf(r.id) < 0) return;
        var best = save.best[bestKey(r.id, 0)];
        html += '<button type="button" class="inu-resort" data-resort="' + esc(r.id) + '">'
          + '<span class="inu-resort-name">' + esc(L(r.name)) + '</span><span class="inu-resort-pref">' + esc(L(r.pref)) + "</span>"
          + '<span class="inu-resort-piste"><i class="inu-diff inu-diff-' + esc(r.gs.diff) + '"></i>' + esc(t("inu_piste_info", { piste: L(r.gs.name), len: Math.round(r.gs.len), drop: Math.round(r.gs.drop) })) + "</span>"
          + '<span class="inu-resort-best">' + esc(best ? t("inu_best", { time: fmtTime(best.time) }) : t("inu_no_best")) + "</span></button>";
      });
      html += "</div>";
    }
    html += aboutHtml() + "</div>";
    app.innerHTML = html;
    Array.prototype.forEach.call(app.querySelectorAll(".inu-resort"), function (b) {
      b.addEventListener("click", function () { S.resort = b.getAttribute("data-resort"); show("setup"); });
    });
  }

  function aboutHtml() {
    return '<details class="inu-about"><summary>' + esc(t("inu_about")) + "</summary><p>" + esc(t("inu_attr_osm")) + "<br>" + esc(t("inu_attr_gsi")) + '</p><p class="inu-muted">' + esc(t("inu_attr_note")) + "</p></details>";
  }

  // ---------------- 畫面：選手與設定 ----------------
  function renderSetup() {
    var r = resortInfo(S.resort);
    var st = save.settings;
    var html = '<div class="inu-page"><button type="button" class="inu-link" data-act="back">← ' + esc(t("inu_back")) + "</button>";
    html += '<h2 class="inu-h2">' + esc(L(r.name)) + "　<small>" + esc(L(r.gs.name)) + "</small></h2>";
    html += '<h3 class="inu-h3">' + esc(t("inu_pick_dog")) + '</h3><div class="inu-breeds">';
    D.BREEDS.forEach(function (b) {
      var on = save.dog.breed === b.id;
      html += '<button type="button" class="inu-breed' + (on ? " is-on" : "") + '" data-breed="' + b.id + '" aria-pressed="' + on + '">'
        + '<span class="inu-breed-face" style="--c1:' + b.look.c1 + ";--c2:" + b.look.c2 + '"></span><span class="inu-breed-name">' + esc(L(b.name)) + "</span>"
        + '<span class="inu-stats">' + ["bal", "pow", "brv", "tec", "siz", "cld"].map(function (k) {
          return '<span class="inu-stat"><em>' + esc(t("inu_stat_" + k)) + '</em><b style="width:' + b.stats[k] + '%"></b></span>';
        }).join("") + "</span></button>";
    });
    html += "</div>";
    html += '<label class="inu-field"><span>' + esc(t("inu_dog_name")) + '</span><input type="text" id="inu-name" maxlength="12" value="' + esc(save.dog.name || "") + '" placeholder="' + esc(L(Core.breed(save.dog.breed).name)) + '"></label>';
    html += opt("runs", t("inu_runs"), [[1, t("inu_runs_1")], [2, t("inu_runs_2")]], st.runs);
    html += opt("ghost", t("inu_ghost"), [[true, t("inu_on")], [false, t("inu_off")]], st.ghost);
    html += opt("control", t("inu_control"), [["drag", t("inu_control_drag")], ["tilt", t("inu_control_tilt")]], st.control);
    html += '<p class="inu-help">' + esc(t("inu_help_gates")) + "<br>" + esc(t(st.control === "tilt" ? "inu_help_tilt" : "inu_help_drag")) + "<br>" + esc(t("inu_help_keys")) + "</p>";
    if (S.msg) html += '<p class="inu-msg">' + esc(S.msg) + "</p>";
    html += '<div class="inu-actions"><button type="button" class="inu-primary" data-act="start">' + esc(t("inu_start")) + '</button>'
      + '<button type="button" class="inu-secondary" data-act="import">' + esc(t("inu_import")) + "</button></div>";
    html += aboutHtml() + "</div>";
    app.innerHTML = html;
    Array.prototype.forEach.call(app.querySelectorAll(".inu-breed"), function (b) {
      b.addEventListener("click", function () { save.dog.breed = b.getAttribute("data-breed"); persist(); render(); });
    });
    Array.prototype.forEach.call(app.querySelectorAll("[data-opt]"), function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-opt"), raw = b.getAttribute("data-val");
        save.settings[k] = raw === "true" ? true : raw === "false" ? false : /^\d+$/.test(raw) ? +raw : raw;
        persist(); S.msg = ""; render();
      });
    });
    var name = document.getElementById("inu-name");
    name.addEventListener("change", function () { save.dog.name = name.value.slice(0, 12); persist(); });
    app.querySelector('[data-act="back"]').addEventListener("click", function () { S.msg = ""; show("resorts"); });
    app.querySelector('[data-act="import"]').addEventListener("click", importCode);
    app.querySelector('[data-act="start"]').addEventListener("click", function () {
      save.dog.name = name.value.slice(0, 12); persist();
      var go = function () { startRace(S.resort, { runs: save.settings.runs }); };
      if (save.settings.control === "tilt") {
        Input.enableTilt().then(function (ok) {
          if (!ok) { save.settings.control = "drag"; persist(); S.msg = t("inu_tilt_denied"); }
          go();
        });
      } else go();
    });
  }
  function opt(key, label, choices, cur) {
    return '<div class="inu-opt"><span>' + esc(label) + '</span><div class="inu-seg">' + choices.map(function (c) {
      var on = String(c[0]) === String(cur);
      return '<button type="button" data-opt="' + key + '" data-val="' + esc(String(c[0])) + '" class="' + (on ? "is-on" : "") + '" aria-pressed="' + on + '">' + esc(c[1]) + "</button>";
    }).join("") + "</div></div>";
  }
  function importCode() {
    var raw = window.prompt(t("inu_import"));
    if (raw === null) return;
    var p = Core.parseShare(raw);
    if (!p || D.RESORTS.indexOf(p.resort) < 0) { S.msg = t("inu_import_bad"); render(); return; }
    save.ghostImport = p; persist();
    S.resort = p.resort; S.msg = t("inu_import_ok"); render();
  }

  function resortInfo(id) {
    var list = (S.index && S.index.resorts) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // ---------------- 載入雪場 ----------------
  function loadTerrain(id) {
    if (S.terrainCache[id]) return Promise.resolve(S.terrainCache[id]);
    return fetch(dataDir + id + ".json").then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (json) { return T.load(json); }).then(function (terrain) {
      S.terrainCache = {}; S.terrainCache[id] = terrain;      // 只留一個，省記憶體
      return terrain;
    });
  }

  // ---------------- 比賽 ----------------
  // opts：{runs, runNo, prevTimes}
  function startRace(resort, opts) {
    opts = opts || {};
    var info = resortInfo(resort);
    S.screen = "loading";
    app.innerHTML = '<div class="inu-loading"><p>' + esc(t("inu_loading_resort", { name: L(info.name) })) + '</p><p class="inu-muted inu-attr">' + esc(t("inu_attr_osm")) + "<br>" + esc(t("inu_attr_gsi")) + "</p></div>";
    Promise.all([loadTerrain(resort), R3.load()]).then(function (res) {
      beginRace(resort, res[0], opts);
    }).catch(function (e) {
      if (window.console) console.error(e);
      S.screen = "resorts"; S.msg = t("inu_load_fail"); render();
    });
  }

  function ghostFor(resort, piste, runNo) {
    var gi = save.ghostImport;
    if (gi && gi.resort === resort && gi.piste === piste && gi.runNo === runNo) return { rec: gi.rec, breed: gi.breed, seed: gi.seed };
    var b = save.best[bestKey(resort, runNo)];
    if (b && b.rec && b.piste === piste) return { rec: b.rec, breed: b.breed, seed: b.seed };
    return null;
  }

  function beginRace(resort, terrain, opts) {
    var info = resortInfo(resort), piste = info.gs.piste;
    var runNo = opts.runNo || 0;
    var seed = Core.courseSeed(resort, piste);
    var dog = Core.breed(save.dog.breed);
    var ro = { piste: piste, seed: seed, dog: dog, snow: "groomed", runNo: runNo };
    var run = Core.newRun(terrain, ro);
    var ghost = null;
    if (save.settings.ghost) {
      var gsrc = ghostFor(resort, piste, runNo);
      if (gsrc) {
        try {
          var gro = { piste: piste, seed: gsrc.seed, dog: Core.breed(gsrc.breed), snow: "groomed", runNo: runNo };
          var rp = Core.replay(terrain, gro, gsrc.rec, 1);
          ghost = { frames: rp.frames, breed: Core.breed(gsrc.breed) };
        } catch (e) { ghost = null; }
      }
    }
    S.screen = "race";
    app.innerHTML = '<div class="inu-race"><div class="inu-stage" id="inu-stage"></div>'
      + '<div class="inu-hud"><div class="inu-hud-top"><span class="inu-hud-run">' + esc(t("inu_run_n", { n: runNo + 1 })) + '</span><span class="inu-hud-time" id="inu-time">0:00.00</span>'
      + '<span class="inu-hud-gate" id="inu-gate"></span><span class="inu-hud-speed" id="inu-speed"></span></div>'
      + '<div class="inu-hud-right"><button type="button" class="inu-chip" id="btn-inu-camera">' + esc(t("inu_cam")) + '</button><button type="button" class="inu-chip" id="btn-inu-pause">' + esc(t("inu_pause")) + "</button></div>"
      + '<div class="inu-banner" id="inu-banner"></div><div class="inu-chain" id="inu-chain"></div>'
      + '<p class="inu-hud-help" id="inu-help">' + esc(t(save.settings.control === "tilt" ? "inu_help_tilt" : "inu_help_drag")) + "</p></div>"
      + '<div class="inu-pausebox" id="inu-pausebox" hidden><button type="button" class="inu-primary" id="btn-inu-resume">' + esc(t("inu_resume")) + '</button><button type="button" class="inu-secondary" id="btn-inu-quit">' + esc(t("inu_quit")) + "</button></div></div>";
    var stage = document.getElementById("inu-stage");
    var view = R3.create(stage, terrain, { piste: piste, gates: run.gates, finish: run.finish, breed: dog, ghostBreed: ghost ? ghost.breed : null, camera: save.settings.camera });
    S.view = view;
    Input.reset();
    Input.setMode(save.settings.control);
    Input.attach(stage);
    S.race = {
      resort: resort, terrain: terrain, opts: opts, runNo: runNo, run: run, ghost: ghost,
      phase: "count", countLeft: 3, acc: 0, last: 0, paused: false, endAt: 0,
      prev: Core.frameOf(run.st), cur: Core.frameOf(run.st), gatesShown: 0,
    };
    document.getElementById("btn-inu-camera").addEventListener("click", cycleCamera);
    document.getElementById("btn-inu-pause").addEventListener("click", function () { togglePause(); });
    document.getElementById("btn-inu-resume").addEventListener("click", function () { togglePause(false); });
    document.getElementById("btn-inu-quit").addEventListener("click", function () { stopLoop(); show("setup"); });
    banner("3");
    setTimeout(function () { var h = document.getElementById("inu-help"); if (h) h.classList.add("is-fade"); }, 5000);
    S.race.last = performance.now();
    S.loop = requestAnimationFrame(frame);
  }

  var CAMS = ["chase", "tv", "air", "pov"];
  function cycleCamera() {
    var i = CAMS.indexOf(save.settings.camera);
    save.settings.camera = CAMS[(i + 1) % CAMS.length];
    persist();
    if (S.view) S.view.setCamera(save.settings.camera);
    toastText(t("inu_cam_" + save.settings.camera));
  }
  function togglePause(force) {
    var r = S.race;
    if (!r || r.phase === "done") return;
    r.paused = force === undefined ? !r.paused : !!force;
    var box = document.getElementById("inu-pausebox");
    if (box) box.hidden = !r.paused;
    r.last = performance.now();
  }
  function stopLoop() {
    if (S.loop) cancelAnimationFrame(S.loop);
    S.loop = 0;
    if (S.view) { S.view.dispose(); S.view = null; }
  }

  function banner(text, cls) {
    var b = document.getElementById("inu-banner");
    if (!b) return;
    b.textContent = text;
    b.className = "inu-banner is-show" + (cls ? " " + cls : "");
  }
  function toastText(text) {
    var b = document.getElementById("inu-chain");
    if (!b) return;
    b.textContent = text;
    b.classList.remove("is-pop"); void b.offsetWidth; b.classList.add("is-pop");
  }

  var STEP_MS = 1000 / D.PHYS.hz;
  function frame(now) {
    var r = S.race;
    if (!r || S.screen !== "race") return;
    S.loop = requestAnimationFrame(frame);
    var dtMs = now - r.last;
    r.last = now;
    if (dtMs > 250) dtMs = 250;
    if (!r.paused) {
      if (r.phase === "count") {
        r.countLeft -= dtMs / 1000;
        var c = Math.ceil(r.countLeft);
        if (c > 0) banner(String(c));
        else { banner(t("inu_go"), "is-go"); r.phase = "run"; r.acc = 0; }
      } else if (r.phase === "run") {
        r.acc += dtMs;
        var steps = 0;
        while (r.acc >= STEP_MS && steps < 40 && r.run.status === "run") {
          r.acc -= STEP_MS; steps += 1;
          r.prev = r.cur;
          var inp = S.autopilot ? Core.autopilot(r.run, 0.5) : Input.sample();
          var evStart = r.run.events.length;
          Core.stepRun(r.run, inp);
          r.cur = Core.frameOf(r.run.st);
          handleEvents(r, evStart);
        }
        if (r.run.status !== "run") endRun(r);
      } else if (r.phase === "end" && now >= r.endAt) {
        r.phase = "done";
        stopLoop();
        showResult(r);
        return;
      }
    }
    // 畫面：物理狀態之間內插
    var a = r.phase === "run" ? Math.min(1, r.acc / STEP_MS) : 1;
    var f = [];
    for (var i = 0; i < 8; i++) f[i] = r.prev[i] + (r.cur[i] - r.prev[i]) * (i === 7 ? 0 : a);
    f[7] = r.cur[7];
    var gf = null;
    if (r.ghost && r.ghost.frames.length) {
      var gi = r.run.steps + (r.phase === "run" ? a : 0);
      var k = Math.min(r.ghost.frames.length - 1, Math.max(0, Math.floor(gi) - 1));
      gf = r.ghost.frames[k];
      if (r.phase === "count") gf = r.ghost.frames[0];
    }
    if (S.view) S.view.render(f, r.run.st.v, gf, dtMs / 1000);
    updateHud(r);
  }

  function handleEvents(r, from) {
    var ev = r.run.events;
    for (var i = from; i < ev.length; i++) {
      var e = ev[i];
      if (e.e === "perfect") { toastText(e.n > 1 ? t("inu_perfect_chain", { n: e.n }) : t("inu_perfect")); }
      if (e.e === "fall") banner(t("inu_fall"), "is-warn");
      if ((e.e === "perfect" || e.e === "gate") && S.view) S.view.gatePassed(r.run.next - 1);
    }
  }

  function updateHud(r) {
    var tm = document.getElementById("inu-time");
    if (!tm) return;
    var sec = r.run.status === "finish" ? r.run.time : r.run.steps / D.PHYS.hz;
    tm.textContent = fmtTime(sec);
    document.getElementById("inu-gate").textContent = t("inu_gate", { n: Math.min(r.run.next, r.run.gates.length), max: r.run.gates.length });
    document.getElementById("inu-speed").textContent = t("inu_speed", { v: Math.round(Phys.speed(r.run.st) * 3.6) });
  }

  function endRun(r) {
    r.phase = "end";
    r.endAt = performance.now() + 1600;
    if (r.run.status === "finish") banner(t("inu_finish"), "is-go");
    else banner(t("inu_dsq"), "is-warn");
  }

  // ---------------- 成績 ----------------
  function showResult(r) {
    var run = r.run, info = resortInfo(r.resort);
    var times = (r.opts.prevTimes || []).slice();
    var newBest = false, diff = null;
    var rec = Core.encode(run.inputs);
    var key = bestKey(r.resort, r.runNo);
    if (run.status === "finish") {
      times.push(run.time);
      var b = save.best[key];
      if (b) diff = run.time - b.time;
      if (!b || run.time < b.time) {
        save.best[key] = { time: run.time, rec: rec, breed: save.dog.breed, seed: run.opts.seed, piste: run.opts.piste, at: Date.now() };
        newBest = true;
      }
    }
    var totalRuns = r.opts.runs || 1;
    var isLast = r.runNo + 1 >= totalRuns || run.status !== "finish";
    var total = null;
    if (isLast && run.status === "finish" && totalRuns === 2 && times.length === 2) {
      total = times[0] + times[1];
      var tk = r.resort + "/gs/total";
      if (!save.best[tk] || total < save.best[tk].time) save.best[tk] = { time: total, at: Date.now() };
    }
    persist();
    S.screen = "result";
    S.lastRun = { r: r, rec: rec };
    var html = '<div class="inu-page inu-result"><h2 class="inu-h2">' + esc(t("inu_result")) + "　<small>" + esc(L(info.name)) + "・" + esc(t("inu_run_n", { n: r.runNo + 1 })) + "</small></h2>";
    if (run.status === "finish") {
      html += '<p class="inu-bigtime">' + esc(fmtTime(run.time)) + "</p>";
      if (newBest) html += '<p class="inu-newbest">' + esc(t("inu_new_best")) + "</p>";
      if (diff !== null && !newBest) html += '<p class="inu-muted">' + esc(t("inu_diff_best", { d: fmtDiff(diff) })) + "</p>";
      html += '<p class="inu-muted">' + esc(t("inu_perfect_count", { n: run.perfect })) + "</p>";
      if (total !== null) html += '<p class="inu-total">' + esc(t("inu_total", { time: fmtTime(total) })) + "</p>";
    } else {
      var why = run.reason === "miss" ? t("inu_dsq_miss", { n: run.missGate }) : t("inu_dsq_" + run.reason);
      html += '<p class="inu-bigtime is-dsq">' + esc(t("inu_dsq")) + '</p><p class="inu-muted">' + esc(why) + "</p>";
    }
    html += '<div class="inu-actions">';
    if (!isLast) html += '<button type="button" class="inu-primary" data-act="next">' + esc(t("inu_next_run")) + "</button>";
    html += '<button type="button" class="' + (isLast ? "inu-primary" : "inu-secondary") + '" data-act="retry">' + esc(t("inu_retry")) + "</button>";
    html += '<button type="button" class="inu-secondary" data-act="replay">' + esc(t("inu_replay")) + "</button>";
    if (run.status === "finish") html += '<button type="button" class="inu-secondary" data-act="share">' + esc(t("inu_share")) + "</button>";
    html += '<button type="button" class="inu-secondary" data-act="resorts">' + esc(t("inu_to_resorts")) + "</button></div></div>";
    app.innerHTML = html;
    var on = function (act, fn) { var b = app.querySelector('[data-act="' + act + '"]'); if (b) b.addEventListener("click", fn); };
    on("next", function () { startRace(r.resort, { runs: totalRuns, runNo: r.runNo + 1, prevTimes: times }); });
    on("retry", function () { startRace(r.resort, { runs: totalRuns }); });
    on("replay", function () { startReplay(r); });
    on("resorts", function () { show("resorts"); });
    on("share", function () {
      var code = Core.shareCode({ resort: r.resort, piste: run.opts.piste, seed: run.opts.seed, runNo: r.runNo, breed: save.dog.breed, rec: rec });
      var done = function () { var b = app.querySelector('[data-act="share"]'); if (b) b.textContent = t("inu_share_done"); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, function () { window.prompt(t("inu_share"), code); });
      else window.prompt(t("inu_share"), code);
    });
  }

  // 重播：用同一份紀錄重跑（不存成績），結束後回到成績
  function startReplay(r) {
    var run = r.run;
    var rp = Core.replay(r.terrain, run.opts, run.inputs, 1);
    S.screen = "race";
    app.innerHTML = '<div class="inu-race"><div class="inu-stage" id="inu-stage"></div><div class="inu-hud"><div class="inu-hud-top"><span class="inu-hud-run">' + esc(t("inu_replay")) + '</span><span class="inu-hud-time" id="inu-rtime"></span></div>'
      + '<div class="inu-hud-right"><button type="button" class="inu-chip" id="btn-inu-camera">' + esc(t("inu_cam")) + '</button><button type="button" class="inu-chip" id="btn-inu-skip">✕</button></div></div></div>';
    var view = R3.create(document.getElementById("inu-stage"), r.terrain, { piste: run.opts.piste, gates: run.gates, finish: run.finish, breed: Core.breed(save.dog.breed), camera: save.settings.camera === "pov" ? "tv" : save.settings.camera });
    S.view = view;
    var i = 0, last = performance.now(), acc = 0;
    var finish = function () { stopLoop(); showResult(Object.assign({}, r, { opts: Object.assign({}, r.opts) })); };
    document.getElementById("btn-inu-camera").addEventListener("click", cycleCamera);
    document.getElementById("btn-inu-skip").addEventListener("click", finish);
    function fr(now) {
      if (S.screen !== "race" || S.view !== view) return;
      S.loop = requestAnimationFrame(fr);
      acc += Math.min(250, now - last); last = now;
      while (acc >= STEP_MS && i < rp.frames.length - 1) { acc -= STEP_MS; i += 1; }
      var f = rp.frames[i];
      var prev = rp.frames[Math.max(0, i - 1)];
      view.render(f, [f[0] - prev[0], 0, f[2] - prev[2]], null, 1 / 60);
      var tt = document.getElementById("inu-rtime"); if (tt) tt.textContent = fmtTime(i / D.PHYS.hz);
      if (i >= rp.frames.length - 1) setTimeout(finish, 800), cancelAnimationFrame(S.loop), S.loop = 0;
    }
    S.loop = requestAnimationFrame(fr);
  }

  // ---------------- 切換 ----------------
  function show(screen) { stopLoop(); S.screen = screen; render(); }
  function render() {
    if (S.screen === "resorts") renderResorts();
    else if (S.screen === "setup") renderSetup();
  }

  window.addEventListener("resize", function () { if (S.view) S.view.resize(); });
  window.addEventListener("i18n:change", function () { if (S.screen === "resorts" || S.screen === "setup") render(); });

  setupNav();
  render();
  fetch(dataDir + "index.json").then(function (r) { return r.json(); }).then(function (idx) {
    S.index = idx; render();
  }).catch(function () { S.msg = t("inu_load_fail"); render(); });

  // 給 Playwright／開發用
  window.PriTestInusnowApp = {
    _debug: {
      state: function () {
        var r = S.race;
        return { screen: S.screen, phase: r && r.phase, status: r && r.run.status, steps: r && r.run.steps, next: r && r.run.next, gates: r && r.run.gates.length, time: r && r.run.time, ghost: !!(r && r.ghost), best: save.best };
      },
      autopilot: function (on) { S.autopilot = !!on; },
      start: function (resort, opts) {
        opts = opts || {};
        if (opts.breed) save.dog.breed = opts.breed;
        if (opts.ghost !== undefined) save.settings.ghost = !!opts.ghost;
        S.resort = resort;
        startRace(resort, { runs: opts.runs || 1 });
      },
      sample: function () { return Input.sample(); },
      speedUp: function (k) { STEP_MS = 1000 / D.PHYS.hz / (k || 1); },
    },
  };
})();
