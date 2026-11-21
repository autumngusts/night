/* イヌスノー（狗雪）畫面流程與存檔（docs/inusnow_design.md §10、§13、§17）。
   畫面：雪場 → 賽事與選手 → 比賽（倒數、滑行、終點）→ 成績（名次、評審、重播、分享碼）。
   賽事：大曲道（練習／比賽）、Slopestyle（練習／比賽）、Snowboard Cross（6 隻）、自由滑行。規則都在 inusnow_core／slope／cross／free.js。 */
(function () {
  "use strict";

  var D = window.PriTestInusnowData;
  var T = window.PriTestInusnowTerrain;
  var Phys = window.PriTestInusnowPhys;
  var Core = window.PriTestInusnowCore;
  var SLP = window.PriTestInusnowSlope;
  var CX = window.PriTestInusnowCross;
  var FR = window.PriTestInusnowFree;
  var Input = window.PriTestInusnowInput;
  var R3 = window.PriTestInusnow3D;
  var Env = window.PriTestInusnowEnv;
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
  function fmtScore(v) { return (v === null || v === undefined) ? "--" : Number(v).toFixed(1); }

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
    screen: "resorts", index: null, resort: null, terrainCache: {}, worldCache: {}, race: null, view: null,
    autopilot: false, msg: "", loop: 0, tab: "resorts",
  };
  var EVENTS = ["gs", "slope", "cross", "free"];
  // P3：外掛的賽事種類（inusnow_ui3.js 登記）與首頁分頁
  var KINDS = {}, SCREENS = {}, HOOKS = {}, TABS = [{ id: "resorts", icon: "🏔", label: "inu_tab_resorts" }];
  var ICON = {
    gs: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 6v36" stroke="currentColor" stroke-width="3"/><path d="M13 7h17l-4 6 4 6H13z" fill="#e2453c"/><path d="M34 18v24" stroke="currentColor" stroke-width="3"/><path d="M35 19h9l-2 4 2 4h-9z" fill="#2a6fd6"/></svg>',
    slope: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M4 40h18c6 0 10-8 14-14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M34 6l2.6 5.4 5.9.8-4.3 4.1 1 5.9L34 19.4l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" fill="#f0a020"/></svg>',
    cross: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M4 12c10 0 10 10 20 10s10 10 20 10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><rect x="8" y="30" width="14" height="4" rx="2" fill="#2a6fd6"/><rect x="26" y="36" width="14" height="4" rx="2" fill="#e2453c"/></svg>',
    free: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M2 42l14-22 8 10 8-14 14 26z" fill="currentColor" opacity=".25"/><path d="M14 42l6-12h-3l5-9h-3l5-9 5 9h-3l5 9h-3l6 12z" fill="#27a35a"/></svg>',
  };
  var FEAT_ICON = { box: "▭", rail: "━", kickerS: "◢", kickerM: "◢", kickerL: "◢" };

  function bestKey(resort, runNo) { return resort + "/gs/" + runNo; }
  function resortInfo(id) {
    var list = (S.index && S.index.resorts) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function eventPiste(info, ev) { return ev === "slope" ? info.slope : ev === "cross" ? info.cross : info.gs; }
  function cpuName(c) { return L(c.name); }

  // ---------------- 畫面：雪場清單 ----------------
  function renderResorts() {
    var html = '<div class="inu-page inu-anim-in"><header class="inu-hero"><div class="inu-hero-snow" aria-hidden="true"></div>'
      + '<div class="inu-hero-mtn" aria-hidden="true"></div><div class="inu-hero-dog" aria-hidden="true"><span></span></div>'
      + '<h1 class="inu-title">' + esc(t("inu_title")) + '</h1><p class="inu-sub">' + esc(t("inu_subtitle")) + "</p>"
      + '<p class="inu-hero-tags"><span>' + esc(t("inu_event_gs")) + "</span><span>" + esc(t("inu_event_slope")) + "</span><span>" + esc(t("inu_event_cross")) + "</span><span>" + esc(t("inu_event_free")) + "</span></p></header>";
    html += tabsHtml();
    var tab = null;
    for (var ti = 0; ti < TABS.length; ti++) if (TABS[ti].id === S.tab && TABS[ti].render) tab = TABS[ti];
    if (tab) {
      html += '<div class="inu-tabbody" id="inu-tabbody"></div>' + aboutHtml() + "</div>";
      app.innerHTML = html;
      bindTabs();
      tab.render(document.getElementById("inu-tabbody"));
      return;
    }
    html += '<h2 class="inu-h2">' + esc(t("inu_pick_resort")) + "</h2>";
    if (!S.index) {
      html += '<p class="inu-muted">' + esc(S.msg || t("inu_loading")) + "</p>";
    } else {
      html += '<div class="inu-resorts">';
      S.index.resorts.forEach(function (r, i) {
        if (D.RESORTS.indexOf(r.id) < 0) return;
        var best = save.best[bestKey(r.id, 0)], sl = save.best[r.id + "/slope"], cx = save.best[r.id + "/cross"], fr = save.free[r.id];
        var hues = [205, 190, 220, 200, 215, 185, 210, 195];
        html += '<button type="button" class="inu-resort" data-resort="' + esc(r.id) + '" style="--hue:' + hues[i % 8] + ";--d:" + (i * 0.05) + 's">'
          + '<span class="inu-resort-art" aria-hidden="true"><i></i><i></i><i></i></span>'
          + '<span class="inu-resort-name">' + esc(L(r.name)) + '</span><span class="inu-resort-pref">' + esc(L(r.pref)) + "</span>"
          + '<span class="inu-resort-piste"><i class="inu-diff inu-diff-' + esc(r.gs.diff) + '"></i>' + esc(t("inu_piste_info", { piste: L(r.gs.name), len: Math.round(r.gs.len), drop: Math.round(r.gs.drop) })) + "</span>"
          + '<span class="inu-resort-badges">'
          + '<span class="inu-badge' + (best ? " is-on" : "") + '">' + ICON.gs + esc(best ? fmtTime(best.time) : "—") + "</span>"
          + '<span class="inu-badge' + (sl ? " is-on" : "") + '">' + ICON.slope + esc(sl ? fmtScore(sl.score) : "—") + "</span>"
          + '<span class="inu-badge' + (cx ? " is-on" : "") + '">' + ICON.cross + esc(cx ? t("inu_place", { n: cx.place }) : "—") + "</span>"
          + '<span class="inu-badge' + (fr && fr.bones && fr.bones.length ? " is-on" : "") + '">' + ICON.free + esc((fr && fr.bones ? fr.bones.length : 0) + "/" + D.FREE.bones) + "</span>"
          + "</span></button>";
      });
      html += "</div>";
    }
    html += aboutHtml() + "</div>";
    app.innerHTML = html;
    bindTabs();
    Array.prototype.forEach.call(app.querySelectorAll(".inu-resort"), function (b) {
      b.addEventListener("click", function () { S.resort = b.getAttribute("data-resort"); S.msg = ""; show("setup"); });
    });
  }

  function tabsHtml() {
    if (TABS.length < 2) return "";
    var coins = typeof save.coins === "number" ? save.coins : null;
    return '<nav class="inu-tabs" role="tablist">' + TABS.map(function (tb) {
      var on = tb.id === S.tab;
      return '<button type="button" role="tab" class="inu-tab' + (on ? " is-on" : "") + '" data-tab="' + tb.id + '" aria-selected="' + on + '"><span class="inu-tab-ico" aria-hidden="true">' + tb.icon + "</span>" + esc(t(tb.label)) + "</button>";
    }).join("") + (coins !== null ? '<span class="inu-coins" title="' + esc(t("inu_coins")) + '"><i aria-hidden="true"></i>' + coins + "</span>" : "") + "</nav>";
  }
  function bindTabs() {
    Array.prototype.forEach.call(app.querySelectorAll(".inu-tab"), function (b) {
      b.addEventListener("click", function () { S.tab = b.getAttribute("data-tab"); S.msg = ""; render(); });
    });
  }
  function aboutHtml() {
    return '<details class="inu-about"><summary>' + esc(t("inu_about")) + "</summary><p>" + esc(t("inu_attr_osm")) + "<br>" + esc(t("inu_attr_gsi")) + '</p><p class="inu-muted">' + esc(t("inu_attr_note")) + "</p></details>";
  }

  function dogFace(b, cls) {
    var L2 = b.look;
    return '<span class="inu-face ' + (cls || "") + ' inu-ear-' + L2.ear + (L2.fluff ? " is-fluffy" : "") + '" style="--c1:' + L2.c1 + ";--c2:" + L2.c2 + '"><i class="inu-face-ear"></i><i class="inu-face-ear"></i><i class="inu-face-head"></i><i class="inu-face-goggle"></i><i class="inu-face-snout"></i></span>';
  }

  // ---------------- 畫面：賽事與選手 ----------------
  function renderSetup() {
    var r = resortInfo(S.resort);
    if (!r) { show("resorts"); return; }
    var st = save.settings, evs = allEvents(), ev = evs.indexOf(st.event) >= 0 ? st.event : "gs";
    var html = '<div class="inu-page inu-anim-in"><button type="button" class="inu-link" data-act="back">← ' + esc(t("inu_back")) + "</button>";
    html += '<div class="inu-setup-head"><h2 class="inu-h2">' + esc(L(r.name)) + "　<small>" + esc(L(r.pref)) + "</small></h2></div>";
    html += '<h3 class="inu-h3">' + esc(t("inu_pick_event")) + '</h3><div class="inu-events">';
    evs.forEach(function (e) {
      var on = e === ev;
      html += '<button type="button" class="inu-event inu-event-' + e + (on ? " is-on" : "") + '" data-event="' + e + '" aria-pressed="' + on + '">' + ICON[e]
        + '<span class="inu-event-name">' + esc(t("inu_event_" + e)) + '</span><span class="inu-event-desc">' + esc(t("inu_event_desc_" + e)) + "</span></button>";
    });
    html += "</div>";
    // 雪道資訊
    var pinfo = eventPiste(r, ev);
    html += '<div class="inu-course">';
    if (ev === "free") {
      html += '<p class="inu-course-line">' + esc(t("inu_free_info")) + "</p>";
      var fr = save.free[S.resort] || {};
      html += '<p class="inu-course-line">' + esc(t("inu_collect", { b: (fr.bones || []).length, bm: D.FREE.bones, s: (fr.spots || []).length, sm: D.FREE.spots, st: (fr.stamps || []).length })) + "</p>";
    } else if (pinfo) {
      html += '<p class="inu-course-line"><i class="inu-diff inu-diff-' + esc(pinfo.diff) + '"></i>' + esc(t("inu_piste_info", { piste: L(pinfo.name) || "—", len: Math.round(pinfo.len), drop: Math.round(pinfo.drop) })) + "</p>";
      if (ev === "slope") html += '<p class="inu-course-feats">' + D.SLOPE.order.map(function (k, i) { return '<span class="inu-feat inu-feat-' + k + '"><b>' + (i + 1) + "</b>" + esc(t("inu_feat_" + k)) + "</span>"; }).join("") + "</p>";
      var bk = ev === "gs" ? save.best[bestKey(S.resort, 0)] : save.best[S.resort + "/" + ev];
      if (bk) html += '<p class="inu-course-best">' + esc(ev === "gs" ? t("inu_best", { time: fmtTime(bk.time) }) : ev === "slope" ? t("inu_best_score", { score: fmtScore(bk.score) }) : t("inu_best_place", { n: bk.place })) + "</p>";
    }
    if (KINDS[ev] && KINDS[ev].setupInfo) html += KINDS[ev].setupInfo(r);
    html += "</div>";
    if (ev === "gs" || ev === "slope") html += opt("mode", t("inu_mode"), [["practice", t("inu_mode_practice")], ["race", t("inu_mode_race")], ["coach", t("inu_mode_coach")]], st.mode);
    if ((ev === "gs" || ev === "slope") && st.mode === "coach") {
      html += '<div class="inu-coachbox"><p class="inu-coach-note">' + esc(t("inu_coach_note")) + "</p>";
      html += opt("coachRoute", t("inu_coach_route"), [["safe", t("inu_route_safe")], ["std", t("inu_route_std")], ["attack", t("inu_route_attack")]], st.coachRoute);
      if (ev === "slope") html += opt("coachSpin", t("inu_coach_spin"), [[360, "360"], [540, "540"], [720, "720"], [1080, "1080"]], st.coachSpin);
      html += opt("coachZoom", t("inu_coach_zoom"), [["auto", t("inu_czoom_straight")], ["last200", t("inu_czoom_last")]], st.coachZoom === "last200" ? "last200" : "auto");
      html += "</div>";
    }
    if (ev === "free" && S.worldLifts && S.worldLifts.resort === S.resort && S.worldLifts.n > 1) {
      html += '<label class="inu-field"><span>' + esc(t("inu_lift_pick")) + '</span><select id="inu-lift">';
      for (var li = 0; li < S.worldLifts.n; li++) html += '<option value="' + li + '"' + (li === (st.lift | 0) ? " selected" : "") + ">" + esc(t("inu_lift_n", { n: li + 1 })) + "</option>";
      html += "</select></label>";
    }
    html += '<h3 class="inu-h3">' + esc(t("inu_pick_dog")) + " <small>" + esc(t("inu_breed_count", { n: D.BREEDS.length })) + '</small></h3><div class="inu-breeds">';
    D.BREEDS.forEach(function (b, i) {
      var on = save.dog.breed === b.id;
      html += '<button type="button" class="inu-breed' + (on ? " is-on" : "") + '" data-breed="' + b.id + '" aria-pressed="' + on + '" style="--d:' + (i * 0.02) + 's">'
        + dogFace(b) + '<span class="inu-breed-name">' + esc(L(b.name)) + "</span>"
        + '<span class="inu-stats">' + ["bal", "pow", "brv", "tec", "siz", "cld"].map(function (k) {
          return '<span class="inu-stat"><em>' + esc(t("inu_stat_" + k)) + '</em><b style="width:' + b.stats[k] + '%"></b></span>';
        }).join("") + "</span></button>";
    });
    html += "</div>";
    html += '<label class="inu-field"><span>' + esc(t("inu_dog_name")) + '</span><input type="text" id="inu-name" maxlength="12" value="' + esc(save.dog.name || "") + '" placeholder="' + esc(L(Core.breed(save.dog.breed).name)) + '"></label>';
    var practice = st.mode !== "race" && st.mode !== "coach";
    if (ev === "gs" && practice) html += opt("runs", t("inu_runs"), [[1, t("inu_runs_1")], [2, t("inu_runs_2")]], st.runs);
    if (ev === "slope" && practice) html += opt("runs", t("inu_runs"), [[1, t("inu_runs_1")], [2, t("inu_runs_best2")]], st.runs);
    if ((ev === "gs" || ev === "slope") && practice) html += opt("ghost", t("inu_ghost"), [[true, t("inu_on")], [false, t("inu_off")]], st.ghost);
    html += condPicker(st);
    html += opt("control", t("inu_control"), [["drag", t("inu_control_drag")], ["tilt", t("inu_control_tilt")]], st.control);
    var help = ev === "gs" ? t("inu_help_gates") : t("inu_help_" + ev);
    html += '<p class="inu-help">' + esc(help) + "<br>" + esc(t(st.control === "tilt" ? "inu_help_tilt" : "inu_help_drag")) + "<br>" + esc(t("inu_help_keys")) + "<br>" + esc(t("inu_help_zoom")) + (ev === "gs" && st.mode === "race" ? "<br>" + esc(t("inu_rut_note")) : "") + "</p>";
    if (S.msg) html += '<p class="inu-msg">' + esc(S.msg) + "</p>";
    html += '<div class="inu-actions"><button type="button" class="inu-primary inu-go" data-act="start">' + esc(t("inu_start")) + "</button>";
    if (ev === "gs") html += '<button type="button" class="inu-secondary" data-act="import">' + esc(t("inu_import")) + "</button>";
    html += "</div>";
    html += aboutHtml() + "</div>";
    app.innerHTML = html;
    Array.prototype.forEach.call(app.querySelectorAll(".inu-event"), function (b) {
      b.addEventListener("click", function () { save.settings.event = b.getAttribute("data-event"); persist(); S.msg = ""; render(); if (save.settings.event === "free") prepWorldLifts(); });
    });
    Array.prototype.forEach.call(app.querySelectorAll(".inu-breed"), function (b) {
      b.addEventListener("click", function () { save.dog.breed = b.getAttribute("data-breed"); persist(); var y = app.querySelector(".inu-page").scrollTop; render(); var pg = app.querySelector(".inu-page"); if (pg) pg.scrollTop = y; });
    });
    Array.prototype.forEach.call(app.querySelectorAll("[data-opt]"), function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-opt"), raw = b.getAttribute("data-val");
        save.settings[k] = raw === "true" ? true : raw === "false" ? false : /^\d+$/.test(raw) ? +raw : raw;
        persist(); S.msg = ""; var y = app.querySelector(".inu-page").scrollTop; render(); var pg = app.querySelector(".inu-page"); if (pg) pg.scrollTop = y;
      });
    });
    var lift = document.getElementById("inu-lift");
    if (lift) lift.addEventListener("change", function () { save.settings.lift = +lift.value; persist(); });
    Array.prototype.forEach.call(app.querySelectorAll("[data-cond]"), function (sel) {
      sel.addEventListener("change", function () {
        var k = sel.getAttribute("data-cond"), cp = save.settings.condPick || {};
        cp[k] = k === "night" ? sel.value === "1" : sel.value;
        save.settings.condPick = cp; persist();
      });
    });
    var name = document.getElementById("inu-name");
    name.addEventListener("change", function () { save.dog.name = name.value.slice(0, 12); persist(); });
    app.querySelector('[data-act="back"]').addEventListener("click", function () { S.msg = ""; show("resorts"); });
    var imp = app.querySelector('[data-act="import"]');
    if (imp) imp.addEventListener("click", importCode);
    app.querySelector('[data-act="start"]').addEventListener("click", function () {
      save.dog.name = name.value.slice(0, 12); persist();
      var go = function () { startRace(S.resort, { event: save.settings.event, mode: save.settings.mode, runs: save.settings.runs }); };
      if (save.settings.control === "tilt") {
        Input.enableTilt().then(function (ok) {
          if (!ok) { save.settings.control = "drag"; persist(); S.msg = t("inu_tilt_denied"); }
          go();
        });
      } else go();
    });
  }
  function allEvents() {
    var out = EVENTS.slice();
    for (var k in KINDS) if (Object.prototype.hasOwnProperty.call(KINDS, k) && KINDS[k].setup) out.push(k);
    return out;
  }
  // 雪況（設計 §18.3）：標準（壓雪・晴・白天）／隨機（地區與月份加權）／指定
  function condPicker(st) {
    if (!Env) return "";
    var h = opt("cond", t("inu_cond"), [["std", t("inu_cond_std")], ["random", t("inu_cond_random")], ["pick", t("inu_cond_pick")]], st.cond || "std");
    if (st.cond === "pick") {
      var cp = st.condPick || {};
      var sel = function (k, list, cur, lab) {
        return '<label class="inu-field inu-field-mini"><span>' + esc(lab) + '</span><select data-cond="' + k + '">' + list.map(function (o) {
          return '<option value="' + esc(String(o[0])) + '"' + (String(o[0]) === String(cur) ? " selected" : "") + ">" + esc(o[1]) + "</option>";
        }).join("") + "</select></label>";
      };
      h += '<div class="inu-condpick">'
        + sel("snow", D.SNOW_ORDER.map(function (k) { return [k, L(D.SNOW[k].name)]; }), cp.snow || "groomed", t("inu_cond_snow"))
        + sel("weather", D.WEATHER_ORDER.map(function (k) { return [k, L(D.WEATHER[k].name)]; }), cp.weather || "clear", t("inu_cond_weather"))
        + sel("night", [["0", t("inu_day")], ["1", t("inu_night")]], cp.night ? "1" : "0", t("inu_cond_time"))
        + "</div>";
    } else if (st.cond !== "random") h += '<p class="inu-help inu-help-tight">' + esc(t("inu_cond_std_note")) + "</p>";
    return h;
  }
  function jstDate() { var d = new Date(Date.now() + 9 * 3600000); return d.toISOString().slice(0, 10); }
  function condFor(resort) {
    var st = save.settings;
    if (!Env || st.cond !== "random" && st.cond !== "pick") return Env ? Env.standard() : null;
    if (st.cond === "pick") { var cp = st.condPick || {}; return { snow: cp.snow || "groomed", weather: cp.weather || "clear", night: !!cp.night, change: null }; }
    return Env.conditions(Core.hash(whenKey() + "|" + resort), resort, +jstDate().slice(5, 7), {});
  }
  var WX_ICON = { clear: "☀", cloudy: "☁", snow: "❄", blizzard: "🌨", fog: "🌫" };
  function condLabel(c) {
    if (!c) return "";
    return (WX_ICON[c.weather] || "") + " " + L(D.WEATHER[c.weather].name) + "・" + L(D.SNOW[c.snow].name) + (c.night ? "・" + t("inu_night") : "");
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
    var HLm = window.PriTestInusnowHighlight, clip = HLm ? HLm.clipOf(raw) : null;
    if (clip && HOOKS.playShared) { HOOKS.playShared(p, clip); return; }
    save.ghostImport = p; save.settings.event = "gs"; save.settings.mode = "practice"; persist();
    S.resort = p.resort; S.msg = t("inu_import_ok"); render();
  }
  // 自由滑行的纜車數（選出發纜車用）：載入地形後才知道
  function prepWorldLifts() {
    var id = S.resort;
    loadTerrain(id).then(function (terrain) {
      var w = worldOf(id, terrain);
      S.worldLifts = { resort: id, n: w.lifts.length };
      if (S.screen === "setup" && S.resort === id && save.settings.event === "free") render();
    }).catch(function () { /* 出發時再顯示錯誤 */ });
  }

  // ---------------- 載入雪場 ----------------
  function loadTerrain(id) {
    if (S.terrainCache[id]) return Promise.resolve(S.terrainCache[id]);
    return fetch(dataDir + id + ".json").then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (json) { return T.load(json); }).then(function (terrain) {
      S.terrainCache = {}; S.terrainCache[id] = terrain;      // 只留一個，省記憶體
      S.worldCache = {};
      return terrain;
    });
  }
  function worldOf(id, terrain) {
    if (!S.worldCache[id]) S.worldCache[id] = FR.makeWorld(terrain);
    return S.worldCache[id];
  }

  // ---------------- 比賽 ----------------
  // opts：{event, mode, runs, runNo, prevTimes, prevScores}
  function startRace(resort, opts) {
    opts = opts || {};
    if (!opts.event) opts.event = "gs";
    var info = resortInfo(resort);
    stopLoop();
    S.screen = "loading";
    var needCpu = (opts.event !== "free" && opts.mode === "race") || opts.event === "cross";
    app.innerHTML = '<div class="inu-loading"><div class="inu-loader" aria-hidden="true"><span class="inu-loader-dog"></span><span class="inu-loader-hill"></span></div>'
      + '<p class="inu-loading-title">' + esc(t("inu_loading_resort", { name: L(info.name) })) + "</p>"
      + '<p class="inu-loading-event">' + ICON[opts.event] + esc(t("inu_event_" + opts.event)) + (needCpu ? "　" + esc(t("inu_sim_cpu")) : "") + "</p>"
      + '<p class="inu-muted inu-attr">' + esc(t("inu_attr_osm")) + "<br>" + esc(t("inu_attr_gsi")) + "</p></div>";
    Promise.all([loadTerrain(resort), R3.load()]).then(function (res) {
      // 讓載入畫面先畫出來（CPU 的模擬會花一點時間）
      return new Promise(function (ok) { setTimeout(function () { ok(res); }, 40); });
    }).then(function (res) {
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
  function whenKey() { var d = new Date(); return d.toISOString().slice(0, 19); }

  function beginRace(resort, terrain, opts) {
    var info = resortInfo(resort), ev = opts.event, mode = opts.mode === "race" ? "race" : opts.mode === "coach" ? "coach" : "practice";
    var dog = opts.dog || Core.breed(save.dog.breed);
    var runNo = opts.runNo || 0;
    var cond = opts.cond || condFor(resort);
    var std = !Env || Env.isStandard(cond);
    var r = { kind: ev, mode: mode, resort: resort, terrain: terrain, opts: opts, runNo: runNo, dog: dog, cond: cond, std: std,
      phase: "count", countLeft: 3, acc: 0, last: 0, paused: false, endAt: 0, evIdx: 0, cpus: null, ghost: null, hud: {}, shakeT: 0, barkT: 0, lastInput: { g: 0 } };
    var vopts = { mode: ev, breed: dog, camera: save.settings.camera, others: [], weather: cond };
    var useCond = std ? null : cond;
    if (ev !== "gs" && ev !== "slope" && mode === "coach") mode = r.mode = "practice";
    var coach = mode === "coach" ? { aggr: D.COACH.routes[save.settings.coachRoute] || D.COACH.routes.std, zoom: save.settings.coachZoom || "auto", cmds: [] } : null;
    r.coach = coach;
    if (KINDS[ev]) {
      KINDS[ev].begin(r, terrain, vopts, info);
    } else if (ev === "gs") {
      var piste = info.gs.piste;
      var seed = opts.seed !== undefined ? opts.seed : opts.pickKey ? Core.pickGsSeed(terrain, piste, resort, opts.pickKey, Core.breed("shiba"))
        : mode !== "practice" ? Core.pickGsSeed(terrain, piste, resort, whenKey(), dog) : Core.courseSeed(resort, piste);
      var ro = { piste: piste, seed: seed, dog: dog, snow: "groomed", runNo: mode !== "practice" ? 0 : runNo, cond: useCond };
      if (mode !== "practice") {
        var field = opts.field || Core.cpuField(seed, D.CPU_AI.field);
        var sim = Core.simGsField(terrain, { piste: piste, seed: seed, snow: "groomed", runNo: 0, cond: useCond }, field, seed);
        r.cpus = sim.cpus;
        ro.rut = sim.rut;
        vopts.others = sim.cpus.map(function (c) { return { breed: Core.breed(c.cpu.breed), ghost: true, name: cpuName(c.cpu) }; });
        vopts.ruts = sim.cpus.map(function (c) { return c.frames; });
        if (coach) { ro.cmds = coach.cmds; r.autoCtl = Core.cpuGsController({ id: "me", breed: dog.id, lv: 3, style: "std" }, (seed ^ Core.hash("coach")) >>> 0, coach); }
      } else if (save.settings.ghost && std) {
        var gsrc = ghostFor(resort, piste, runNo);
        if (gsrc) {
          try {
            var rp = Core.replay(terrain, { piste: piste, seed: gsrc.seed, dog: Core.breed(gsrc.breed), snow: "groomed", runNo: runNo }, gsrc.rec, 1);
            r.ghost = { frames: rp.frames, breed: Core.breed(gsrc.breed) };
            vopts.others = [{ breed: r.ghost.breed, ghost: true, name: t("inu_ghost_label") }];
          } catch (e) { r.ghost = null; }
        }
      }
      r.run = Core.newRun(terrain, ro);
      vopts.piste = piste; vopts.gates = r.run.gates; vopts.finish = r.run.finish;
    } else if (ev === "slope") {
      var sp = info.slope ? info.slope.piste : info.gs.piste;
      var sseed = opts.seed !== undefined ? opts.seed : mode !== "practice" ? Core.raceSeed(resort, whenKey()) : Core.courseSeed(resort, sp);
      var so = { piste: sp, seed: sseed, dog: dog, snow: "groomed", runNo: mode !== "practice" ? 0 : runNo, cond: useCond, cmds: coach ? coach.cmds : null };
      r.run = SLP.newSlope(terrain, so);
      r.autoCtl = coach ? SLP.cpuController({ lv: 4, style: "trick", spinCap: +save.settings.coachSpin || 540, zoom: coach.zoom, cmds: coach.cmds }, (sseed ^ Core.hash("coach")) >>> 0)
        : SLP.cpuController({ lv: 4, style: "trick" }, 7);
      if (mode !== "practice") {
        var sfield = opts.field || Core.cpuField(sseed, D.CPU_AI.field);
        r.cpus = sfield.map(function (c, i) { return SLP.simCpu(terrain, { piste: sp, seed: sseed, snow: "groomed", runNo: 0, cond: useCond }, c, sseed, i); });
        vopts.others = r.cpus.map(function (c) { return { breed: Core.breed(c.cpu.breed), ghost: true, name: cpuName(c.cpu) }; });
      } else if (save.settings.ghost && std) {
        var sb = save.best[resort + "/slope"];
        if (sb && sb.rec && sb.piste === sp && sb.seed === sseed) {
          try {
            var srp = SLP.replay(terrain, { piste: sp, seed: sb.seed, dog: Core.breed(sb.breed), snow: "groomed", runNo: sb.runNo || 0 }, sb.rec, 1);
            r.ghost = { frames: srp.frames, breed: Core.breed(sb.breed) };
            vopts.others = [{ breed: r.ghost.breed, ghost: true, name: t("inu_ghost_label") }];
          } catch (e) { r.ghost = null; }
        }
      }
      vopts.piste = sp; vopts.feats = r.run.feats; vopts.finish = r.run.finish; vopts.terrain = r.run.terrain;
    } else if (ev === "cross") {
      var cp = info.cross ? info.cross.piste : info.gs.piste;
      var cseed = opts.seed !== undefined ? opts.seed : Core.raceSeed(resort, whenKey());
      var cfield = opts.field || Core.cpuField(cseed, D.CROSS.riders - 1);
      var dogs = [dog].concat(cfield.map(function (c) { return Core.breed(c.breed); }));
      r.cross = CX.newCross(terrain, { piste: cp, seed: cseed, snow: "groomed", dogs: dogs, cond: useCond });
      r.ctls = CX.controllers(r.cross, cseed, 0);
      r.autoCtl = CX.cpuController(0, 11);
      r.cpus = cfield;
      vopts.others = cfield.map(function (c) { return { breed: Core.breed(c.breed), ghost: false, name: cpuName(c), scarf: 0x2a6fd6 }; });
      vopts.piste = cp; vopts.feats = r.cross.feats; vopts.finish = r.cross.finish; vopts.terrain = r.cross.terrain; vopts.cuts = r.cross.cuts;
    } else {
      var world = worldOf(resort, terrain);
      var got = save.free[resort] || { bones: [], spots: [], stamps: [] };
      var lift = save.settings.lift | 0;
      if (lift >= world.lifts.length) lift = 0;
      r.world = world;
      r.run = FR.newFree(terrain, world, { dog: dog, snow: "groomed", lift: lift, cond: useCond }, got);
      vopts.world = world; vopts.got = got; vopts.cuts = world.cuts;
      r.phase = "count"; r.countLeft = 1.5;
    }
    S.screen = "race";
    app.innerHTML = raceHtml(r);
    var stage = document.getElementById("inu-stage");
    var view;
    try { view = R3.create(stage, terrain, vopts); } catch (e) {
      if (window.console) console.error(e);
      S.screen = "resorts"; S.msg = t("inu_load_fail"); render(); return;
    }
    S.view = view;
    Input.reset();
    Input.setMode(save.settings.control);
    Input.attach(stage);
    r.prev = Core.frameOf(playerSt(r)); r.cur = r.prev;
    if (r.kind === "cross") { r.oprev = r.cross.riders.slice(1).map(function (x) { return Core.frameOf(x.st); }); r.ocur = r.oprev; }
    S.race = r;
    bindRaceHud(r);
    if (KINDS[r.kind] && KINDS[r.kind].bind) KINDS[r.kind].bind(r);
    if (r.kind === "free") { drawMinimapBase(r); banner(t("inu_event_free"), "is-go"); } else banner("3");
    if (!std) setTimeout(function () { if (S.race === r) toastText(condLabel(cond), "is-blue"); }, 400);
    setTimeout(function () { var h = document.getElementById("inu-help"); if (h) h.classList.add("is-fade"); }, 6000);
    r.last = performance.now();
    S.loop = requestAnimationFrame(frame);
  }

  function playerSt(r) { return KINDS[r.kind] && KINDS[r.kind].st ? KINDS[r.kind].st(r) : r.kind === "cross" ? r.cross.riders[0].st : r.run.st; }

  function raceHtml(r) {
    var k = r.kind;
    var K = KINDS[k];
    var h = '<div class="inu-race inu-race-' + k + (k === "gs" && r.mode === "practice" ? " inu-nozoom" : "") + (r.coach ? " inu-coachmode" : "") + (K && K.noZoom ? " inu-nozoom" : "") + (r.cond && r.cond.night ? " is-night" : "") + '"><div class="inu-stage" id="inu-stage"></div>'
      + '<div class="inu-speedlines" id="inu-speedlines" aria-hidden="true"></div><div class="inu-zoomfx" id="inu-zoomfx" aria-hidden="true"></div>'
      + '<div class="inu-hud"><div class="inu-hud-top"><span class="inu-hud-ev">' + ICON[k] + '<span class="inu-hud-run">'
      + esc(r.opts.label ? r.opts.label : k === "gs" || k === "slope" ? (r.mode !== "practice" ? t("inu_mode_" + r.mode) : t("inu_run_n", { n: r.runNo + 1 })) : t("inu_event_" + k))
      + '</span></span><span class="inu-hud-time" id="inu-time">' + (k === "free" ? "" : "0:00.00") + '</span>'
      + '<span class="inu-hud-sub" id="inu-sub"></span>'
      + (r.cond && !r.std ? '<span class="inu-hud-wx" id="inu-wx">' + esc(condLabel(r.cond)) + "</span>" : "") + "</div>"
      + '<div class="inu-progress" id="inu-progress"><i id="inu-progress-bar"></i></div>'
      + '<div class="inu-hud-right"><button type="button" class="inu-chip" id="btn-inu-camera">' + esc(t("inu_cam")) + '</button><button type="button" class="inu-chip" id="btn-inu-pause">' + esc(t("inu_pause")) + "</button>"
      + (k === "free" ? '<button type="button" class="inu-chip inu-chip-end" id="btn-inu-end">' + esc(t("inu_free_end")) + "</button>" : "") + "</div>"
      + '<ol class="inu-standings" id="inu-standings"></ol>'
      + '<div class="inu-gauge" id="inu-gauge"><svg viewBox="0 0 120 70" aria-hidden="true"><path class="inu-gauge-bg" d="M10 62 A50 50 0 0 1 110 62"/><path class="inu-gauge-fg" id="inu-gauge-arc" d="M10 62 A50 50 0 0 1 110 62"/></svg><b id="inu-speed">0</b><small>km/h</small></div>'
      + '<button type="button" class="inu-zoombtn" id="btn-inu-zoom" aria-label="' + esc(t("inu_zoom")) + '"><span class="inu-zoombone" aria-hidden="true"></span><i id="inu-zoom-fill"></i></button>'
      + (k === "slope" ? '<button type="button" class="inu-actbtn inu-grabbtn" id="btn-inu-grab">' + esc(t("inu_grab")) + '<small id="inu-grab-kind">' + esc(t("inu_grab_1")) + '</small></button><button type="button" class="inu-actbtn inu-barkbtn" id="btn-inu-bark">' + esc(t("inu_bark")) + "</button>" : "")
      + (k === "free" ? '<canvas class="inu-minimap" id="inu-minimap" width="160" height="160"></canvas><button type="button" class="inu-liftbtn" id="btn-inu-lift" hidden>🚡 ' + esc(t("inu_lift_ride")) + "</button>" : "")
      + (k === "cross" || k === "free" ? '<div class="inu-scent" id="inu-scent" title="' + esc(t("inu_scent")) + '"><span class="inu-scent-nose" aria-hidden="true"></span><span class="inu-scent-bar"><i id="inu-scent-fill"></i></span><small>' + esc(t("inu_scent")) + "</small></div>" : "")
      + (k === "gs" ? '<div class="inu-fogarrow" id="inu-fogarrow" hidden aria-hidden="true"><i></i></div>' : "")
      + (r.coach ? '<div class="inu-coachcmds"><button type="button" class="inu-cmd inu-cmd-dash" id="btn-inu-dash"><b>' + esc(t("inu_cmd_dash")) + "</b><small>" + esc(t("inu_cmd_dash_d")) + '</small></button><button type="button" class="inu-cmd inu-cmd-calm" id="btn-inu-calm"><b>' + esc(t("inu_cmd_calm")) + "</b><small>" + esc(t("inu_cmd_calm_d")) + "</small></button></div>" : "")
      + (K && K.html ? K.html(r) : "")
      + '<div class="inu-banner" id="inu-banner"></div><div class="inu-chain" id="inu-chain"></div><div class="inu-trick" id="inu-trick"></div>'
      + '<p class="inu-hud-help" id="inu-help">' + esc(r.coach ? t("inu_help_coach") : K && K.help ? K.help(r) : (k === "gs" ? "" : t("inu_help_" + k) + "　") + t(save.settings.control === "tilt" ? "inu_help_tilt" : "inu_help_drag")) + "</p></div>"
      + '<div class="inu-liftride" id="inu-liftride" hidden><div class="inu-liftride-cable"></div><div class="inu-liftride-chair"><span></span></div><p>' + esc(t("inu_lift_riding")) + "</p></div>"
      + '<div class="inu-pausebox" id="inu-pausebox" hidden><div class="inu-pausecard"><h3>' + esc(t("inu_pause")) + '</h3><button type="button" class="inu-primary" id="btn-inu-resume">' + esc(t("inu_resume")) + '</button><button type="button" class="inu-secondary" id="btn-inu-quit">' + esc(t("inu_quit")) + "</button></div></div></div>";
    return h;
  }

  function bindRaceHud(r) {
    document.getElementById("btn-inu-camera").addEventListener("click", cycleCamera);
    document.getElementById("btn-inu-pause").addEventListener("click", function () { togglePause(); });
    document.getElementById("btn-inu-resume").addEventListener("click", function () { togglePause(false); });
    document.getElementById("btn-inu-quit").addEventListener("click", function () { stopLoop(); show("setup"); });
    document.getElementById("btn-inu-zoom").addEventListener("pointerdown", function (e) { e.stopPropagation(); Input.zoom(); });
    document.getElementById("btn-inu-zoom").addEventListener("click", function (e) { e.stopPropagation(); Input.zoom(); });
    var end = document.getElementById("btn-inu-end");
    if (end) end.addEventListener("click", function () { if (S.race === r) { r.phase = "done"; stopLoop(); showResult(r); } });
    var lift = document.getElementById("btn-inu-lift");
    if (lift) lift.addEventListener("click", function () { rideLift(r); });
    var grab = document.getElementById("btn-inu-grab");
    if (grab) {
      // 按住＝抓板；往上滑＝切換 1～4；長按 0.6 秒＝咬尾
      var kind = 1, y0 = 0, held = 0, timer = 0;
      var setKind = function (k) { kind = k; var el = document.getElementById("inu-grab-kind"); if (el) el.textContent = t("inu_grab_" + k); };
      grab.addEventListener("pointerdown", function (e) {
        e.stopPropagation(); e.preventDefault();
        y0 = e.clientY; held = 1; Input.setGrab(kind); grab.classList.add("is-down");
        clearTimeout(timer);
        timer = setTimeout(function () { if (held) { Input.setGrab(5); grab.classList.add("is-bite"); } }, 600);
      });
      grab.addEventListener("pointermove", function (e) {
        if (!held || y0 - e.clientY < 30) return;
        y0 = e.clientY; setKind(kind % 4 + 1); Input.setGrab(kind);
      });
      var up = function () { held = 0; clearTimeout(timer); Input.setGrab(0); grab.classList.remove("is-down", "is-bite"); };
      grab.addEventListener("pointerup", up); grab.addEventListener("pointercancel", up); grab.addEventListener("pointerleave", up);
    }
    var bark = document.getElementById("btn-inu-bark");
    if (bark) bark.addEventListener("pointerdown", function (e) { e.stopPropagation(); Input.bark(); });
    // 教練模式的指令（設計 §18.2）：各 1 次，生效比送出晚 90 步
    var cmd = function (a, id) {
      var b = document.getElementById(id);
      if (!b) return;
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!r.coach || r.phase !== "run" || b.disabled) return;
        var run = r.run;
        r.coach.cmds.push({ k: run.steps + D.COACH.lead, a: a });
        b.disabled = true; b.classList.add("is-sent");
        toastText(t(a === "dash" ? "inu_cmd_dash_sent" : "inu_cmd_calm_sent"), a === "dash" ? "is-gold" : "is-blue");
      });
    };
    cmd("dash", "btn-inu-dash"); cmd("calm", "btn-inu-calm");
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
    if (KINDS[r.kind] && KINDS[r.kind].noPause) return;      // 房間比賽不能暫停（別人那邊會判斷線）
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
    b.className = "inu-banner";
    void b.offsetWidth;
    b.className = "inu-banner is-show" + (cls ? " " + cls : "");
  }
  function toastText(text, cls) {
    var b = document.getElementById("inu-chain");
    if (!b) return;
    b.textContent = text;
    b.className = "inu-chain" + (cls ? " " + cls : "");
    void b.offsetWidth; b.classList.add("is-pop");
  }
  function trickPopup(name, pts, cls) {
    var b = document.getElementById("inu-trick");
    if (!b) return;
    b.innerHTML = '<span class="inu-trick-name">' + esc(name) + '</span><span class="inu-trick-pts">' + esc(pts) + "</span>";
    b.className = "inu-trick";
    void b.offsetWidth;
    b.className = "inu-trick is-pop" + (cls ? " " + cls : "");
  }

  function trickName(tr) {
    var parts = [];
    if (tr.rail) {
      if (tr.spinOn) parts.push(t("inu_spin_on"));
      parts.push(t(tr.trick === "fifty" ? "inu_rail_fifty" : "inu_rail_slide"));
      if (tr.spinOff) parts.push(t("inu_spin_off"));
    } else {
      parts.push(tr.spin ? String(tr.spin) : t("inu_straight"));
      if (tr.grab) parts.push(t("inu_grab_" + tr.grab));
    }
    if (tr.bark) parts.push(t("inu_trick_bark"));
    if (tr.shake) parts.push(t("inu_trick_shake"));
    return parts.join(" ");
  }

  var STEP_MS = 1000 / D.PHYS.hz;
  function stepOnce(r) {
    var auto = S.autopilot;
    if (KINDS[r.kind]) { KINDS[r.kind].step(r, auto); return; }
    if (r.kind === "gs") {
      var inp = r.coach ? r.autoCtl(r.run) : auto ? Core.autopilot(r.run, 0.5) : Input.sample();
      // 練習模式不發動興奮度：紀錄與第 1 階段的最佳紀錄、幽靈、分享碼保持可以比較（設計 §0.5）
      if (r.mode === "practice") delete inp.z;
      r.lastInput = inp;
      Core.stepRun(r.run, inp);
    } else if (r.kind === "slope") {
      var si = auto || r.coach ? r.autoCtl(r.run) : Input.sample();
      r.lastInput = si;
      SLP.stepSlope(r.run, si);
    } else if (r.kind === "cross") {
      var race = r.cross;
      var pin = auto ? r.autoCtl(race) : Input.sample();
      r.lastInput = pin;
      var ins = r.ctls.map(function (c, k) { return k === 0 ? pin : c(race); });
      CX.stepCross(race, ins);
    } else {
      var fi = auto ? freeAuto(r) : Input.sample();
      r.lastInput = fi;
      FR.stepFree(r.run, fi);
    }
  }
  // 自由滑行的自動駕駛（測試用）：沿最陡的下坡方向
  function freeAuto(r) {
    var st = r.run.st, n = T.normal(r.terrain, st.p[0], st.p[2]);
    var dx = n[0], dz = n[2], l = Math.sqrt(dx * dx + dz * dz) || 1;
    return { s: SLP.steerTo(st, st.p[0] + dx / l * 20, st.p[2] + dz / l * 20, Phys.speed(st)), c: 1, j: 0, g: 0 };
  }
  function playerDone(r) {
    if (KINDS[r.kind]) return KINDS[r.kind].done(r);
    if (r.kind === "cross") return r.cross.riders[0].done || r.cross.status !== "run";
    if (r.kind === "free") return false;
    return r.run.status !== "run";
  }
  function eventsOf(r) { return KINDS[r.kind] && KINDS[r.kind].events ? KINDS[r.kind].events(r) : r.kind === "cross" ? r.cross.events : r.run.events; }
  function stepsOf(r) { return KINDS[r.kind] && KINDS[r.kind].steps ? KINDS[r.kind].steps(r) : r.kind === "cross" ? r.cross.steps : r.run.steps; }
  // G5：比賽中天候變化（設計 §18.5）；畫面 5 秒內切換
  function checkWeather(r) {
    var ch = r.cond && r.cond.change;
    if (!ch || !ch.happen || r.wxChanged || stepsOf(r) < ch.at) return;
    r.wxChanged = true;
    if (S.view && S.view.setWeather) S.view.setWeather(ch.to, r.cond.night, D.ENV.changeFade);
    banner(t("inu_wx_change", { w: L(D.WEATHER[ch.to].name) }), "is-warn");
    var wx = document.getElementById("inu-wx");
    if (wx) wx.textContent = (WX_ICON[ch.to] || "") + " " + L(D.WEATHER[ch.to].name);
  }

  function frame(now) {
    var r = S.race;
    if (!r || S.screen !== "race") return;
    S.loop = requestAnimationFrame(frame);
    var dtMs = now - r.last;
    r.last = now;
    if (dtMs > 250) dtMs = 250;
    var fxInfo = { skid: false };
    if (!r.paused && !r.riding) {
      if (r.phase === "count") {
        r.countLeft -= dtMs / 1000;
        var c = Math.ceil(r.countLeft);
        if (r.kind === "free") { if (r.countLeft <= 0) { r.phase = "run"; r.acc = 0; } }
        else if (c > 0) { if (r.hud.count !== c) { r.hud.count = c; banner(String(c), "is-count"); } }
        else { banner(t("inu_go"), "is-go"); r.phase = "run"; r.acc = 0; }
      } else if (r.phase === "run") {
        r.acc += dtMs;
        var steps = 0;
        while (r.acc >= STEP_MS && steps < 40 && !playerDone(r)) {
          r.acc -= STEP_MS; steps += 1;
          r.prev = r.cur;
          if (r.kind === "cross") r.oprev = r.ocur;
          stepOnce(r);
          r.cur = Core.frameOf(playerSt(r));
          if (r.kind === "cross") r.ocur = r.cross.riders.slice(1).map(function (x) { return Core.frameOf(x.st); });
          handleEvents(r, fxInfo);
          checkWeather(r);
        }
        if (playerDone(r)) endRun(r);
      } else if (r.phase === "end" && now >= r.endAt) {
        r.phase = "done";
        stopLoop();
        showResult(r);
        return;
      }
    }
    // 畫面：物理狀態之間內插
    var a = r.phase === "run" ? Math.min(1, r.acc / STEP_MS) : 1;
    var f = lerpFrame(r.prev, r.cur, a);
    var st = playerSt(r);
    var steps2 = stepsOf(r);
    var oth = null;
    if (KINDS[r.kind] && KINDS[r.kind].others) {
      oth = KINDS[r.kind].others(r, a, f);
    } else if (r.kind === "cross") {
      oth = r.ocur.map(function (c2, i) { return lerpFrame(r.oprev[i], c2, a); });
      fxInfo.others = r.cross.riders.slice(1).map(function (x) { return { fall: x.st.fall > 0, zoom: x.st.zoomT > 0 }; });
    } else if (r.cpus && r.cpus[0] && r.cpus[0].frames) {
      // CPU 幽靈：最近的 3 隻
      var idx = r.phase === "count" ? 0 : steps2;
      var cand = r.cpus.map(function (c3, i) {
        var fr2 = c3.frames[Math.min(c3.frames.length - 1, idx)];
        var dx = fr2[0] - f[0], dz = fr2[2] - f[2];
        return { i: i, d: dx * dx + dz * dz, f: fr2, gone: idx >= c3.frames.length - 1 && c3.status !== "finish" };
      });
      var near = cand.filter(function (x) { return !x.gone; }).sort(function (p, q) { return p.d - q.d; }).slice(0, D.CPU_AI.ghostsShown).map(function (x) { return x.i; });
      oth = cand.map(function (x) { return near.indexOf(x.i) >= 0 ? x.f : null; });
    } else if (r.ghost && r.ghost.frames.length) {
      var gi = r.phase === "count" ? 0 : Math.min(r.ghost.frames.length - 1, steps2);
      oth = [r.ghost.frames[gi]];
    }
    var g = r.lastInput ? r.lastInput.g | 0 : 0;
    if (g === 6) r.barkT = 30;
    if (r.barkT > 0) r.barkT -= 1;
    if (r.shakeT > 0) r.shakeT -= dtMs / 1000;
    fxInfo.grab = st.air && g >= 1 && g <= 4 ? g : 0;
    fxInfo.bite = st.air && g === 5;
    fxInfo.bark = r.barkT > 0;
    fxInfo.shake = r.shakeT > 0;
    fxInfo.fall = st.fall > 0;
    fxInfo.zoom = st.zoomT > 0;
    fxInfo.scent = st.scentShow > 0;
    if (KINDS[r.kind] && KINDS[r.kind].fx) KINDS[r.kind].fx(r, fxInfo);
    if (S.view) S.view.render(f, st.v, oth, dtMs / 1000, fxInfo);
    updateHud(r, st);
  }
  function lerpFrame(p, c, a) {
    var f = [];
    for (var i = 0; i < 8; i++) f[i] = p[i] + (c[i] - p[i]) * (i === 7 ? 0 : a);
    f[7] = c[7];
    return f;
  }

  function handleEvents(r, fxInfo) {
    var ev = eventsOf(r);
    for (var i = r.evIdx; i < ev.length; i++) {
      var e = ev[i];
      if (e.r !== undefined && e.r !== 0) {
        if (e.e === "bump" && e.o === 0 && S.view) S.view.fx("bump");
        continue;
      }
      var st = playerSt(r);
      if (KINDS[r.kind] && KINDS[r.kind].event && KINDS[r.kind].event(r, e, fxInfo)) continue;
      if (e.e === "scent") { toastText(t("inu_scent_ready"), "is-gold"); vibrate(30); continue; }
      if (e.e === "shortcut") { banner(t("inu_shortcut"), "is-zoom"); continue; }
      if (e.e === "perfect") { toastText(e.n > 1 ? t("inu_perfect_chain", { n: e.n }) : t("inu_perfect"), "is-gold"); if (S.view) S.view.gatePassed(r.run.next - 1, true); }
      else if (e.e === "gate") { if (S.view) S.view.gatePassed(r.run.next - 1, false); }
      else if (e.e === "fall") { banner(t("inu_fall"), "is-warn"); if (S.view) S.view.fx("fall"); vibrate(60); }
      else if (e.e === "sketchy") { if (S.view) S.view.fx("sketchy"); }
      else if (e.e === "land") { if (st.airSteps > 20 && S.view) S.view.fx("land"); }
      else if (e.e === "skid") fxInfo.skid = true;
      else if (e.e === "zoom") { banner(t("inu_zoom"), "is-zoom"); if (S.view) S.view.fx("zoom"); vibrate(40); }
      else if (e.e === "trick") {
        var tr = r.run.tricks[e.n];
        trickPopup(trickName(tr), "+" + tr.pts.toFixed(1) + (tr.rep ? "  " + t("inu_trick_rep") : ""), tr.E === 1 ? "is-clean" : tr.E > 0 ? "is-sketchy" : "is-fall");
        if (tr.E > 0 && S.view) S.view.fx("trick");
      }
      else if (e.e === "shake") { r.shakeT = 0.5; var lt = r.run.lastTrick; if (lt) trickPopup(trickName(lt), "+" + lt.pts.toFixed(1), "is-clean"); }
      else if (e.e === "grind") toastText(t("inu_grind"), "is-blue");
      else if (e.e === "railFail") toastText(t("inu_rail_fail"), "is-warn");
      else if (e.e === "pass") toastText(t("inu_pass"), "is-blue");
      else if (e.e === "bump") { if (S.view) S.view.fx("bump"); vibrate(30); }
      else if (e.e === "bone") {
        toastText(t("inu_bone_get", { n: r.run.got.bones.length, max: D.FREE.bones }), "is-gold");
        var bo = r.world.bones[e.n]; if (S.view && bo) S.view.fx("bone", [bo.x, T.height(r.terrain, bo.x, bo.z), bo.z]), S.view.hideBone(bo.id);
        saveFree(r);
      }
      else if (e.e === "spot") { saveFree(r); banner(t("inu_spot_get"), "is-go"); var so = r.world.spots[e.n]; if (S.view && so) S.view.fx("spot", { 0: so.x, 1: T.height(r.terrain, so.x, so.z), 2: so.z, id: so.id }); }
      else if (e.e === "stamp") { saveFree(r); var pj = (r.terrain.json.pistes || []).filter(function (p) { return p.id === e.p; })[0]; toastText(t("inu_stamp_get", { piste: (pj && L(pj.name)) || e.p }), "is-gold"); }
      else if (e.e === "tree") { banner(t("inu_tree"), "is-warn"); if (S.view) S.view.fx("tree"); vibrate(60); }
    }
    r.evIdx = ev.length;
  }
  // 自由滑行的收集：拿到當下就存（從暫停選單離開、關分頁也不會消失）
  function saveFree(r) {
    save.free[r.resort] = { bones: r.run.got.bones.slice(), spots: r.run.got.spots.slice(), stamps: r.run.got.stamps.slice() };
    persist();
  }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 不支援 */ } }

  function updateHud(r, st) {
    var tm = document.getElementById("inu-time");
    if (!tm) return;
    var steps = stepsOf(r);
    var sp = Phys.speed(st) * 3.6;
    var sub = "", prog = 0, K = KINDS[r.kind];
    if (K) {
      var ho = K.hud(r, st);
      if (ho.time !== undefined) tm.textContent = ho.time;
      sub = ho.sub || ""; prog = ho.prog || 0;
    } else if (r.kind === "gs") {
      tm.textContent = fmtTime(r.run.status === "finish" ? r.run.time : steps / D.PHYS.hz);
      sub = t("inu_gate", { n: Math.min(r.run.next, r.run.gates.length), max: r.run.gates.length });
      prog = r.run.gates.length ? r.run.next / r.run.gates.length : 0;
      if (r.cpus) sub += "　" + t("inu_place_live", { n: liveGsRank(r), max: r.cpus.length + 1 });
    } else if (r.kind === "slope") {
      tm.textContent = fmtTime(steps / D.PHYS.hz);
      sub = t("inu_score_now", { v: SLP.runScore(r.run).toFixed(1) });
      var near = r.run.near ? r.run.near.s : 0;
      prog = Math.min(1, near / r.run.finish.s);
    } else if (r.kind === "cross") {
      tm.textContent = fmtTime(steps / D.PHYS.hz);
      var me = r.cross.riders[0];
      sub = t("inu_place_live", { n: me.done ? me.place : me.rank, max: r.cross.riders.length });
      prog = Math.min(1, me.s / r.cross.finish.s);
      if (r.hud.stand !== r.cross.steps - (r.cross.steps % 30)) {
        r.hud.stand = r.cross.steps - (r.cross.steps % 30);
        var ord = CX.rankOrder(r.cross);
        document.getElementById("inu-standings").innerHTML = ord.map(function (k) {
          var nm = k === 0 ? (save.dog.name || t("inu_you")) : cpuName(r.cpus[k - 1]);
          return '<li class="' + (k === 0 ? "is-me" : "") + '"><b>' + (ord.indexOf(k) + 1) + "</b>" + esc(nm) + "</li>";
        }).join("");
      }
    } else {
      var got = r.run.got;
      tm.textContent = "🦴 " + got.bones.length + "/" + D.FREE.bones;
      sub = "📍 " + got.spots.length + "/" + D.FREE.spots + "　🏅 " + got.stamps.length;
      var lb = document.getElementById("btn-inu-lift");
      if (lb) lb.hidden = !(r.run.liftNear >= 0);
      drawMinimap(r);
    }
    if (r.hud.sub !== sub) { r.hud.sub = sub; document.getElementById("inu-sub").textContent = sub; }
    // G2 嗅覺量表
    var sc = document.getElementById("inu-scent-fill");
    if (sc) {
      var sv = Math.round(st.scent || 0);
      if (r.hud.scent !== sv) { r.hud.scent = sv; sc.style.width = sv + "%"; }
      var sb2 = document.getElementById("inu-scent");
      if (sb2) { sb2.classList.toggle("is-full", st.scentShow > 0); sb2.classList.toggle("is-in", st.scentIn >= 0); }
    }
    // 濃霧中看不到下一座旗門：箭頭（設計 §18.3）
    var fa = document.getElementById("inu-fogarrow");
    if (fa && r.run && r.cond) {
      var g2 = r.run.gates[r.run.next], fog = Env && Env.weatherAt(r.cond, steps) === "fog";
      fa.hidden = !(fog && g2 && r.phase === "run");
      if (!fa.hidden) {
        var dx2 = g2.ix - st.p[0], dz2 = g2.iz - st.p[2];
        var ang = Math.atan2(dx2 * st.h[1] - dz2 * st.h[0], dx2 * st.h[0] + dz2 * st.h[1]);
        fa.style.transform = "translateX(-50%) rotate(" + (-ang * 180 / Math.PI).toFixed(0) + "deg)";
      }
    }
    var bar = document.getElementById("inu-progress-bar");
    if (bar && r.kind !== "free") bar.style.width = (prog * 100).toFixed(1) + "%";
    var spd = Math.round(sp);
    if (r.hud.spd !== spd) {
      r.hud.spd = spd;
      document.getElementById("inu-speed").textContent = spd;
      var arc = document.getElementById("inu-gauge-arc");
      if (arc) arc.style.strokeDashoffset = (158 * (1 - Math.min(1, sp / 100))).toFixed(1);
    }
    var lines = document.getElementById("inu-speedlines");
    if (lines) lines.style.opacity = Math.max(0, Math.min(1, (sp - 45) / 45)).toFixed(2);
    var zf = document.getElementById("inu-zoomfx");
    if (zf) zf.classList.toggle("is-on", st.zoomT > 0);
    var zfill = document.getElementById("inu-zoom-fill");
    var zv = st.zoomT > 0 ? st.zoomT / D.ZOOM.steps : st.zoom / D.ZOOM.max;
    var zr = Math.round(zv * 100);
    if (r.hud.zoom !== zr) {
      r.hud.zoom = zr;
      if (zfill) zfill.style.height = zr + "%";
      var zb = document.getElementById("btn-inu-zoom");
      if (zb) { zb.classList.toggle("is-ready", st.zoom >= D.ZOOM.max && st.zoomT === 0); zb.classList.toggle("is-active", st.zoomT > 0); }
      if (st.zoom >= D.ZOOM.max && st.zoomT === 0 && !r.hud.zoomTold) { r.hud.zoomTold = 1; toastText(t("inu_zoom_ready"), "is-gold"); }
      if (st.zoom < D.ZOOM.max) r.hud.zoomTold = 0;
    }
  }
  // 大曲道比賽中的名次：同一座旗門，比 CPU 早通過的才算在前面
  function liveGsRank(r) {
    var n = r.run.next - 1;
    if (n < 0) return r.cpus.length + 1;
    var mine = r.run.gateT[n], ahead = 0;
    r.cpus.forEach(function (c) { if (c.gateT.length > n && c.gateT[n] < mine) ahead += 1; });
    return ahead + 1;
  }

  // ---------------- 自由滑行：小地圖、纜車 ----------------
  function drawMinimapBase(r) {
    var tr = r.terrain, cv = document.createElement("canvas"), W = 320;
    var sc = W / Math.max(tr.sizeX, tr.sizeZ);
    cv.width = Math.ceil(tr.sizeX * sc); cv.height = Math.ceil(tr.sizeZ * sc);
    var g = cv.getContext("2d");
    g.fillStyle = "rgba(220,232,245,.92)"; g.fillRect(0, 0, cv.width, cv.height);
    var col = { novice: "#3cb44b", easy: "#3cb44b", intermediate: "#d23c3c", advanced: "#222", expert: "#222", freeride: "#e08a1e" };
    (tr.json.pistes || []).forEach(function (p) {
      if (FR.isEventPiste(p.id)) return;
      g.strokeStyle = col[p.diff] || "#d23c3c"; g.lineWidth = Math.max(1.5, p.width * sc * 0.5); g.lineCap = "round"; g.globalAlpha = 0.75;
      g.beginPath();
      p.pts.forEach(function (q, i) { if (i) g.lineTo(q[0] * sc, q[1] * sc); else g.moveTo(q[0] * sc, q[1] * sc); });
      g.stroke();
    });
    g.globalAlpha = 1; g.strokeStyle = "#555"; g.lineWidth = 1; g.setLineDash([3, 2]);
    r.world.lifts.forEach(function (l) { g.beginPath(); g.moveTo(l.bottom[0] * sc, l.bottom[1] * sc); g.lineTo(l.top[0] * sc, l.top[1] * sc); g.stroke(); });
    g.setLineDash([]);
    r.mini = { cv: cv, sc: sc };
  }
  function drawMinimap(r) {
    var c = document.getElementById("inu-minimap");
    if (!c || !r.mini) return;
    var g = c.getContext("2d"), m = r.mini, st = r.run.st, W = c.width;
    // 以選手為中心、顯示 ±600 m
    var view = 1200 * m.sc, cx = st.p[0] * m.sc, cz = st.p[2] * m.sc, k = W / view;
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = "#dfe9f4"; g.fillRect(0, 0, W, W);
    g.drawImage(m.cv, -(cx - view / 2) * k, -(cz - view / 2) * k, m.cv.width * k, m.cv.height * k);
    var got = r.run.got;
    r.world.bones.forEach(function (b) {
      g.fillStyle = got.bones.indexOf(b.id) >= 0 ? "rgba(120,130,145,.55)" : "#f0a020";
      g.beginPath(); g.arc((b.x * m.sc - cx) * k + W / 2, (b.z * m.sc - cz) * k + W / 2, 3, 0, Math.PI * 2); g.fill();
    });
    r.world.spots.forEach(function (s) {
      if (got.spots.indexOf(s.id) >= 0) return;
      g.fillStyle = "#ffd400"; g.strokeStyle = "#7a5b00";
      g.beginPath(); g.arc((s.x * m.sc - cx) * k + W / 2, (s.z * m.sc - cz) * k + W / 2, 4, 0, Math.PI * 2); g.fill(); g.stroke();
    });
    g.translate(W / 2, W / 2);
    g.rotate(Math.atan2(-st.h[0], st.h[1]));
    g.fillStyle = "#ff4d2e"; g.strokeStyle = "#fff"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 9); g.lineTo(6, -6); g.lineTo(0, -3); g.lineTo(-6, -6); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  function rideLift(r) {
    if (r.riding || r.run.liftNear < 0) return;
    var idx = r.run.liftNear;
    r.riding = true;
    var box = document.getElementById("inu-liftride");
    if (box) box.hidden = false;
    setTimeout(function () {
      if (S.race !== r) return;
      FR.teleport(r.run, idx);
      r.prev = r.cur = Core.frameOf(r.run.st);
      if (S.view) S.view.teleported();
      r.riding = false;
      r.last = performance.now();
      if (box) box.hidden = true;
    }, S.fastLift ? 50 : D.FREE.rideSec * 1000);
  }

  function endRun(r) {
    r.phase = "end";
    r.endAt = performance.now() + 1700;
    if (KINDS[r.kind] && KINDS[r.kind].end) { KINDS[r.kind].end(r); return; }
    var ok = r.run ? r.run.status === "finish" : true;
    if (r.kind === "cross") {
      // 玩家完賽後，其他選手用模擬一口氣跑完
      var race = r.cross, guard = 0;
      while (race.status === "run" && guard++ < D.CROSS.maxSec * D.PHYS.hz) {
        CX.stepCross(race, r.ctls.map(function (c) { return c ? c(race) : {}; }));
      }
      r.evIdx = race.events.length;
      ok = !race.riders[0].dnf;
    }
    banner(ok ? t("inu_finish") : t("inu_dsq"), ok ? "is-go" : "is-warn");
    if (ok && S.view) S.view.fx("finish");
  }

  // ---------------- 成績 ----------------
  function medal(n) { return n === 1 ? "🥇" : n === 2 ? "🥈" : n === 3 ? "🥉" : ""; }
  function confettiHtml() {
    var h = '<div class="inu-confetti" aria-hidden="true">';
    for (var i = 0; i < 36; i++) h += '<i style="--x:' + Math.floor(Math.random() * 100) + "%;--d:" + (Math.random() * 1.2).toFixed(2) + "s;--c:" + ["#ff4f6d", "#ffc531", "#3aa0ff", "#3ed47a", "#b57bff"][i % 5] + ";--r:" + Math.floor(Math.random() * 360) + 'deg"></i>';
    return h + "</div>";
  }
  function standingsTable(rows) {
    return '<table class="inu-table"><thead><tr><th>#</th><th></th><th>' + esc(t("inu_rider")) + "</th><th>" + esc(rows.col) + "</th><th></th></tr></thead><tbody>"
      + rows.list.map(function (x, i) {
        return '<tr class="' + (x.me ? "is-me" : "") + '" style="--d:' + (i * 0.07) + 's"><td>' + (x.place || "-") + "</td><td>" + medal(x.place) + "</td><td>" + dogFace(x.breed, "is-mini") + esc(x.name) + (x.lv ? ' <small class="inu-lv">Lv' + x.lv + "</small>" : "") + "</td><td>" + esc(x.val) + '</td><td class="inu-muted">' + esc(x.extra || "") + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function countUp(el, to, fmt, ms) {
    if (!el) return;
    var t0 = performance.now();
    function step(now) {
      var k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(to * e);
      if (k < 1 && document.body.contains(el)) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function showResult(r) {
    if (r.opts.after && r.opts.after(r) === true) return;
    if (KINDS[r.kind]) return KINDS[r.kind].result(r);
    if (r.kind === "slope") return showSlopeResult(r);
    if (r.kind === "cross") return showCrossResult(r);
    if (r.kind === "free") return showFreeResult(r);
    var run = r.run, info = resortInfo(r.resort);
    var times = (r.opts.prevTimes || []).slice();
    var newBest = false, diff = null;
    var rec = Core.encode(run.inputs);
    var key = bestKey(r.resort, r.runNo);
    var race = r.mode !== "practice";
    if (run.status === "finish" && !race && r.std) {
      times.push(run.time);
      var b = save.best[key];
      if (b) diff = run.time - b.time;
      if (!b || run.time < b.time) {
        save.best[key] = { time: run.time, rec: rec, breed: save.dog.breed, seed: run.opts.seed, piste: run.opts.piste, at: Date.now() };
        newBest = true;
      }
    }
    var totalRuns = race ? 1 : (r.opts.runs || 1);
    var isLast = r.runNo + 1 >= totalRuns || run.status !== "finish";
    var total = null;
    if (!race && r.std && isLast && run.status === "finish" && totalRuns === 2 && times.length === 2) {
      total = times[0] + times[1];
      var tk = r.resort + "/gs/total";
      if (!save.best[tk] || total < save.best[tk].time) save.best[tk] = { time: total, at: Date.now() };
    }
    var place = 0, table = "";
    if (race) {
      var list = r.cpus.map(function (c) { return { name: cpuName(c.cpu), breed: Core.breed(c.cpu.breed), lv: c.cpu.lv, time: c.time, status: c.status }; });
      list.push({ name: save.dog.name || t("inu_you"), breed: r.dog, me: true, time: run.status === "finish" ? run.time : null, status: run.status });
      list.sort(function (p, q) { return (p.time === null ? 1e9 : p.time) - (q.time === null ? 1e9 : q.time); });
      var winner = list[0].time;
      list.forEach(function (x, i) {
        x.place = x.time === null ? 0 : i + 1;
        x.val = x.time === null ? t("inu_dnf") : fmtTime(x.time);
        x.extra = x.time !== null && winner !== null && i > 0 ? fmtDiff(x.time - winner) : "";
        if (x.me) place = x.place;
      });
      table = standingsTable({ col: t("inu_time"), list: list });
      if (place && r.mode === "race") {
        var bk = r.resort + "/gsrace";
        if (!save.best[bk] || place < save.best[bk].place) save.best[bk] = { place: place, time: run.time, at: Date.now() };
      }
    }
    persist();
    S.screen = "result";
    S.lastRun = { r: r, rec: rec };
    var good = run.status === "finish" && (race ? place && place <= 3 : true);
    var html = '<div class="inu-page inu-result inu-anim-in">' + (good ? confettiHtml() : "") + '<h2 class="inu-h2">' + ICON.gs + esc(t("inu_result")) + "　<small>" + esc(L(info.name)) + "・" + esc(race ? t("inu_mode_" + r.mode) : t("inu_run_n", { n: r.runNo + 1 })) + "</small></h2>";
    if (!r.std) html += '<p class="inu-condline">' + esc(condLabel(r.cond)) + (race ? "" : "　" + esc(t("inu_cond_nobest"))) + "</p>";
    if (run.status === "finish") {
      if (race) html += '<p class="inu-place-big">' + medal(place) + esc(t("inu_place", { n: place })) + "</p>";
      html += '<p class="inu-bigtime" id="inu-bigtime">' + esc(fmtTime(0)) + "</p>";
      if (newBest) html += '<p class="inu-newbest">' + esc(t("inu_new_best")) + "</p>";
      if (diff !== null && !newBest) html += '<p class="inu-muted">' + esc(t("inu_diff_best", { d: fmtDiff(diff) })) + "</p>";
      html += '<p class="inu-muted">' + esc(t("inu_perfect_count", { n: run.perfect })) + "</p>";
      if (total !== null) html += '<p class="inu-total">' + esc(t("inu_total", { time: fmtTime(total) })) + "</p>";
    } else {
      var why = run.reason === "miss" ? t("inu_dsq_miss", { n: run.missGate }) : t("inu_dsq_" + run.reason);
      html += '<p class="inu-bigtime is-dsq">' + esc(t("inu_dsq")) + '</p><p class="inu-muted">' + esc(why) + "</p>";
    }
    if (table) html += '<h3 class="inu-h3">' + esc(t("inu_ranking")) + "</h3>" + table;
    html += '<div class="inu-actions">';
    if (!isLast) html += '<button type="button" class="inu-primary" data-act="next">' + esc(t("inu_next_run")) + "</button>";
    html += '<button type="button" class="' + (isLast ? "inu-primary" : "inu-secondary") + '" data-act="retry">' + esc(t("inu_retry")) + "</button>";
    html += '<button type="button" class="inu-secondary" data-act="replay">' + esc(t("inu_replay")) + "</button>";
    if (HOOKS.highlight && !r.opts.after) html += '<button type="button" class="inu-secondary inu-hlbtn" data-act="hl">✨ ' + esc(t("inu_highlight")) + "</button>";
    if (run.status === "finish" && !race && r.std) html += '<button type="button" class="inu-secondary" data-act="share">' + esc(t("inu_share")) + "</button>";
    if (run.status === "finish" && !race && r.std && HOOKS.shareClip) html += '<button type="button" class="inu-secondary" data-act="shareclip">' + esc(t("inu_hl_share")) + "</button>";
    html += '<button type="button" class="inu-secondary" data-act="setup">' + esc(t("inu_to_setup")) + '</button><button type="button" class="inu-secondary" data-act="resorts">' + esc(t("inu_to_resorts")) + "</button></div></div>";
    app.innerHTML = html;
    if (run.status === "finish") countUp(document.getElementById("inu-bigtime"), run.time, fmtTime, 900);
    var on = function (act, fn) { var bt = app.querySelector('[data-act="' + act + '"]'); if (bt) bt.addEventListener("click", fn); };
    on("next", function () { startRace(r.resort, { event: "gs", mode: "practice", runs: totalRuns, runNo: r.runNo + 1, prevTimes: times }); });
    on("retry", function () { startRace(r.resort, { event: "gs", mode: r.mode, runs: totalRuns }); });
    on("replay", function () { startReplay(r); });
    on("hl", function () { HOOKS.highlight(r); });
    on("shareclip", function () {
      var code = HOOKS.shareClip(r);
      if (!code) return;
      var done = function () { var bt = app.querySelector('[data-act="shareclip"]'); if (bt) bt.textContent = t("inu_share_done"); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, function () { window.prompt(t("inu_hl_share"), code); });
      else window.prompt(t("inu_hl_share"), code);
    });
    on("setup", function () { show("setup"); });
    on("resorts", function () { show("resorts"); });
    on("share", function () {
      var code = Core.shareCode({ resort: r.resort, piste: run.opts.piste, seed: run.opts.seed, runNo: r.runNo, breed: save.dog.breed, rec: rec });
      var done = function () { var bt = app.querySelector('[data-act="share"]'); if (bt) bt.textContent = t("inu_share_done"); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, function () { window.prompt(t("inu_share"), code); });
      else window.prompt(t("inu_share"), code);
    });
  }

  function showSlopeResult(r) {
    var run = r.run, info = resortInfo(r.resort), race = r.mode !== "practice";
    var rec = Core.encode(run.inputs);
    var scores = (r.opts.prevScores || []).slice();
    scores.push(run.final);
    var totalRuns = race ? 1 : (r.opts.runs || 1);
    var isLast = r.runNo + 1 >= totalRuns;
    var bestOf = Math.max.apply(null, scores);
    var newBest = false;
    if (!race && r.std && run.status !== "dsq") {
      var b = save.best[r.resort + "/slope"];
      if (!b || run.final > b.score) {
        save.best[r.resort + "/slope"] = { score: run.final, rec: rec, breed: save.dog.breed, seed: run.opts.seed, piste: run.opts.piste, runNo: run.opts.runNo || 0, at: Date.now() };
        newBest = true;
      }
    }
    var place = 0, table = "";
    if (race) {
      var list = r.cpus.map(function (c) { return { name: cpuName(c.cpu), breed: Core.breed(c.cpu.breed), lv: c.cpu.lv, score: c.score }; });
      list.push({ name: save.dog.name || t("inu_you"), breed: r.dog, me: true, score: run.final });
      list.sort(function (p, q) { return q.score - p.score; });
      list.forEach(function (x, i) { x.place = i + 1; x.val = fmtScore(x.score); if (x.me) place = x.place; });
      table = standingsTable({ col: t("inu_score"), list: list });
      var bk = r.resort + "/sloperace";
      if (r.mode === "race" && (!save.best[bk] || place < save.best[bk].place)) save.best[bk] = { place: place, score: run.final, at: Date.now() };
    }
    persist();
    S.screen = "result";
    var good = run.status !== "dsq" && (race ? place <= 3 : run.final >= 40);
    var html = '<div class="inu-page inu-result inu-anim-in">' + (good ? confettiHtml() : "") + '<h2 class="inu-h2">' + ICON.slope + esc(t("inu_result")) + "　<small>" + esc(L(info.name)) + "・" + esc(t("inu_event_slope")) + "・" + esc(race ? t("inu_mode_" + r.mode) : t("inu_run_n", { n: r.runNo + 1 })) + "</small></h2>";
    if (!r.std) html += '<p class="inu-condline">' + esc(condLabel(r.cond)) + "</p>";
    if (race) html += '<p class="inu-place-big">' + medal(place) + esc(t("inu_place", { n: place })) + "</p>";
    if (run.status === "dsq") html += '<p class="inu-bigtime is-dsq">' + esc(t("inu_dsq")) + '</p><p class="inu-muted">' + esc(t("inu_dsq_off")) + "</p>";
    else html += '<p class="inu-bigscore"><span id="inu-bigscore">0.0</span><small>' + esc(t("inu_points")) + "</small></p>";
    if (newBest) html += '<p class="inu-newbest">' + esc(t("inu_new_best_score")) + "</p>";
    html += '<div class="inu-judges">' + (run.judges || []).map(function (j, i) {
      return '<div class="inu-judge" style="--d:' + (0.3 + i * 0.25) + 's"><span>' + esc(t("inu_judge_n", { n: i + 1 })) + "</span><b>" + fmtScore(j) + "</b></div>";
    }).join("") + "</div>";
    if (totalRuns === 2 && isLast) html += '<p class="inu-total">' + esc(t("inu_best2_total", { v: fmtScore(bestOf) })) + "</p>";
    // 地形別分數
    html += '<h3 class="inu-h3">' + esc(t("inu_feat_table")) + '</h3><ol class="inu-feats">';
    D.SLOPE.order.forEach(function (k, i) {
      var best = null;
      run.tricks.forEach(function (tr) { if (tr.feat === i && (!best || tr.pts > best.pts)) best = tr; });
      html += '<li class="inu-featrow" style="--d:' + (0.5 + i * 0.08) + 's"><span class="inu-feat-ico">' + FEAT_ICON[k] + "</span><span class=\"inu-feat-name\">" + esc(t("inu_feat_" + k)) + '</span><span class="inu-feat-trick">'
        + esc(best ? trickName(best) + (best.E < 1 ? "（" + t(best.E > 0 ? "inu_land_sketchy" : "inu_land_fall") + "）" : "") : t("inu_feat_none")) + '</span><b>' + fmtScore(run.featScore[i]) + "</b></li>";
    });
    html += "</ol>";
    if (table) html += '<h3 class="inu-h3">' + esc(t("inu_ranking")) + "</h3>" + table;
    html += '<div class="inu-actions">';
    if (!isLast) html += '<button type="button" class="inu-primary" data-act="next">' + esc(t("inu_next_run")) + "</button>";
    html += '<button type="button" class="' + (isLast ? "inu-primary" : "inu-secondary") + '" data-act="retry">' + esc(t("inu_retry")) + '</button><button type="button" class="inu-secondary" data-act="replay">' + esc(t("inu_replay")) + "</button>"
      + (HOOKS.highlight && !r.opts.after ? '<button type="button" class="inu-secondary inu-hlbtn" data-act="hl">✨ ' + esc(t("inu_highlight")) + "</button>" : "")
      + '<button type="button" class="inu-secondary" data-act="setup">' + esc(t("inu_to_setup")) + '</button><button type="button" class="inu-secondary" data-act="resorts">' + esc(t("inu_to_resorts")) + "</button></div></div>";
    app.innerHTML = html;
    if (run.status !== "dsq") countUp(document.getElementById("inu-bigscore"), run.final, function (v) { return v.toFixed(1); }, 1100);
    var on = function (act, fn) { var bt = app.querySelector('[data-act="' + act + '"]'); if (bt) bt.addEventListener("click", fn); };
    on("hl", function () { HOOKS.highlight(r); });
    on("next", function () { startRace(r.resort, { event: "slope", mode: "practice", runs: totalRuns, runNo: r.runNo + 1, prevScores: scores }); });
    on("retry", function () { startRace(r.resort, { event: "slope", mode: r.mode, runs: totalRuns }); });
    on("replay", function () { startReplay(r); });
    on("setup", function () { show("setup"); });
    on("resorts", function () { show("resorts"); });
  }

  function showCrossResult(r) {
    var race = r.cross, info = resortInfo(r.resort), me = race.riders[0];
    var list = race.riders.map(function (x, k) {
      var c = k ? r.cpus[k - 1] : null;
      return { name: k ? cpuName(c) : (save.dog.name || t("inu_you")), breed: k ? Core.breed(c.breed) : r.dog, lv: c ? c.lv : 0, me: !k, place: x.place, val: x.dnf ? t("inu_dnf") : fmtTime(x.time) };
    });
    list.sort(function (p, q) { return p.place - q.place; });
    var bk = r.resort + "/cross";
    if (!save.best[bk] || me.place < save.best[bk].place) save.best[bk] = { place: me.place, time: me.time, at: Date.now() };
    persist();
    S.screen = "result";
    var html = '<div class="inu-page inu-result inu-anim-in">' + (me.place <= 3 ? confettiHtml() : "") + '<h2 class="inu-h2">' + ICON.cross + esc(t("inu_result")) + "　<small>" + esc(L(info.name)) + "・" + esc(t("inu_event_cross")) + "</small></h2>";
    html += '<p class="inu-place-big">' + medal(me.place) + esc(t("inu_place", { n: me.place })) + "</p>";
    html += '<p class="inu-bigtime">' + esc(me.dnf ? t("inu_dnf") : fmtTime(me.time)) + "</p>";
    html += '<div class="inu-podium">' + [1, 0, 2].map(function (i) {
      var x = list[i];
      return x ? '<div class="inu-podium-step inu-podium-' + (i + 1) + (x.me ? " is-me" : "") + '">' + dogFace(x.breed) + "<span>" + esc(x.name) + "</span><b>" + (i + 1) + "</b></div>" : "";
    }).join("") + "</div>";
    html += '<h3 class="inu-h3">' + esc(t("inu_ranking")) + "</h3>" + standingsTable({ col: t("inu_time"), list: list });
    html += '<div class="inu-actions"><button type="button" class="inu-primary" data-act="retry">' + esc(t("inu_retry")) + "</button>"
      + (HOOKS.highlight ? '<button type="button" class="inu-secondary inu-hlbtn" data-act="hl">✨ ' + esc(t("inu_highlight")) + "</button>" : "")
      + '<button type="button" class="inu-secondary" data-act="setup">' + esc(t("inu_to_setup")) + '</button><button type="button" class="inu-secondary" data-act="resorts">' + esc(t("inu_to_resorts")) + "</button></div></div>";
    app.innerHTML = html;
    var on = function (act, fn) { var bt = app.querySelector('[data-act="' + act + '"]'); if (bt) bt.addEventListener("click", fn); };
    on("hl", function () { HOOKS.highlight(r); });
    on("retry", function () { startRace(r.resort, { event: "cross" }); });
    on("setup", function () { show("setup"); });
    on("resorts", function () { show("resorts"); });
  }

  function showFreeResult(r) {
    var run = r.run, info = resortInfo(r.resort);
    save.free[r.resort] = { bones: run.got.bones.slice(), spots: run.got.spots.slice(), stamps: run.got.stamps.slice() };
    persist();
    S.screen = "result";
    var got = run.got, ng = run.newGot;
    var html = '<div class="inu-page inu-result inu-anim-in"><h2 class="inu-h2">' + ICON.free + esc(t("inu_free_result")) + "　<small>" + esc(L(info.name)) + "</small></h2>";
    html += '<div class="inu-collect">'
      + '<div class="inu-collect-card"><span>🦴</span><b>' + got.bones.length + "/" + D.FREE.bones + "</b><small>" + esc(t("inu_bones")) + "</small></div>"
      + '<div class="inu-collect-card"><span>📍</span><b>' + got.spots.length + "/" + D.FREE.spots + "</b><small>" + esc(t("inu_spots")) + "</small></div>"
      + '<div class="inu-collect-card"><span>🏅</span><b>' + got.stamps.length + "</b><small>" + esc(t("inu_stamps")) + "</small></div></div>";
    html += '<p class="inu-muted">' + esc(t("inu_free_new", { b: ng.bones, s: ng.spots, st: ng.stamps })) + "</p>";
    html += '<p class="inu-muted">' + esc(t("inu_free_dist", { d: Math.round(run.dist) })) + "　" + esc(t("inu_free_top", { v: Math.round(run.maxSpeed * 3.6) })) + "</p>";
    if (got.stamps.length) {
      html += '<div class="inu-stamps">' + got.stamps.map(function (pid) {
        var p = (r.terrain.json.pistes || []).filter(function (x) { return x.id === pid; })[0];
        return '<span class="inu-stamp">' + esc((p && L(p.name)) || pid) + "</span>";
      }).join("") + "</div>";
    }
    html += '<div class="inu-actions"><button type="button" class="inu-primary" data-act="retry">' + esc(t("inu_free_again")) + '</button><button type="button" class="inu-secondary" data-act="setup">' + esc(t("inu_to_setup")) + '</button><button type="button" class="inu-secondary" data-act="resorts">' + esc(t("inu_to_resorts")) + "</button></div></div>";
    app.innerHTML = html;
    var on = function (act, fn) { var bt = app.querySelector('[data-act="' + act + '"]'); if (bt) bt.addEventListener("click", fn); };
    on("retry", function () { startRace(r.resort, { event: "free" }); });
    on("setup", function () { show("setup"); });
    on("resorts", function () { show("resorts"); });
  }

  // 重播：用同一份紀錄重跑（不存成績），結束後回到成績
  function startReplay(r) {
    var run = r.run, rp, vopts;
    var dog = r.dog;
    if (r.kind === "slope") {
      rp = SLP.replay(r.terrain, run.opts, run.inputs, 1);
      vopts = { mode: "slope", piste: run.opts.piste, feats: rp.run.feats, finish: rp.run.finish, terrain: rp.run.terrain, breed: dog };
    } else {
      rp = Core.replay(r.terrain, run.opts, run.inputs, 1);
      vopts = { mode: "gs", piste: run.opts.piste, gates: run.gates, finish: run.finish, breed: dog };
    }
    vopts.camera = save.settings.camera === "pov" ? "tv" : save.settings.camera;
    S.screen = "race";
    app.innerHTML = '<div class="inu-race"><div class="inu-stage" id="inu-stage"></div><div class="inu-hud"><div class="inu-hud-top"><span class="inu-hud-ev">' + ICON[r.kind] + '<span class="inu-hud-run">' + esc(t("inu_replay")) + '</span></span><span class="inu-hud-time" id="inu-rtime"></span></div>'
      + '<div class="inu-hud-right"><button type="button" class="inu-chip" id="btn-inu-camera">' + esc(t("inu_cam")) + '</button><button type="button" class="inu-chip" id="btn-inu-skip">✕</button></div><div class="inu-replay-badge">REPLAY</div></div></div>';
    var view = R3.create(document.getElementById("inu-stage"), r.terrain, vopts);
    S.view = view;
    var i = 0, last = performance.now(), acc = 0;
    var finished = false;
    var finish = function () { if (finished) return; finished = true; stopLoop(); showResult(Object.assign({}, r, { opts: Object.assign({}, r.opts) })); };
    document.getElementById("btn-inu-camera").addEventListener("click", cycleCamera);
    document.getElementById("btn-inu-skip").addEventListener("click", finish);
    function fr(now) {
      if (S.screen !== "race" || S.view !== view) return;
      S.loop = requestAnimationFrame(fr);
      acc += Math.min(250, now - last); last = now;
      while (acc >= STEP_MS && i < rp.frames.length - 1) { acc -= STEP_MS; i += 1; }
      var f = rp.frames[i];
      var prev = rp.frames[Math.max(0, i - 1)];
      view.render(f, [(f[0] - prev[0]) * 60, (f[1] - prev[1]) * 60, (f[2] - prev[2]) * 60], null, 1 / 60, {});
      var tt = document.getElementById("inu-rtime"); if (tt) tt.textContent = fmtTime(i / D.PHYS.hz);
      if (i >= rp.frames.length - 1) { cancelAnimationFrame(S.loop); S.loop = 0; setTimeout(finish, 800); }
    }
    S.loop = requestAnimationFrame(fr);
  }

  // ---------------- 切換 ----------------
  function show(screen) { stopLoop(); S.screen = screen; render(); }
  function render() {
    if (S.screen === "resorts") renderResorts();
    else if (S.screen === "setup") renderSetup();
    else if (SCREENS[S.screen]) SCREENS[S.screen]();
  }

  window.addEventListener("resize", function () { if (S.view) S.view.resize(); });
  window.addEventListener("i18n:change", function () { if (S.screen === "resorts" || S.screen === "setup" || SCREENS[S.screen]) render(); });

  // P3：外掛畫面（inusnow_ui3.js 等，在本檔之前載入）用的介面
  var UI = {
    S: S, save: function () { return save; }, persist: persist, t: t, L: L, esc: esc, fmtTime: fmtTime, fmtDiff: fmtDiff, fmtScore: fmtScore,
    ICON: ICON, dogFace: dogFace, opt: opt, banner: banner, toastText: toastText, trickPopup: trickPopup, standingsTable: standingsTable,
    medal: medal, confettiHtml: confettiHtml, countUp: countUp, startRace: startRace, show: show, render: render, loadTerrain: loadTerrain,
    worldOf: worldOf, resortInfo: resortInfo, cpuName: cpuName, stopLoop: stopLoop, lerpFrame: lerpFrame, vibrate: vibrate, aboutHtml: aboutHtml,
    condFor: condFor, condLabel: condLabel, jstDate: jstDate, whenKey: whenKey, showResult: showResult, playerSt: playerSt, tabsHtml: tabsHtml, bindTabs: bindTabs,
    step: function () { return STEP_MS; }, R3: R3, Input: Input, app: app, WX_ICON: WX_ICON,
    kind: function (id, def) { KINDS[id] = def; if (def.icon) ICON[id] = def.icon; },
    hook: function (id, fn) { HOOKS[id] = fn; },
    screen: function (id, fn) { SCREENS[id] = fn; },
    tab: function (def) { TABS.push(def); },
  };
  (window.PriTestInusnowExt || []).forEach(function (fn) { try { fn(UI); } catch (e) { if (window.console) console.error(e); } });
  if (Core.migrate && save) {
    var Bt = window.PriTestInusnowBet;
    if (Bt && Bt.refill(save, jstDate())) persist();
  }

  setupNav();
  render();
  fetch(dataDir + "index.json").then(function (r) { return r.json(); }).then(function (idx) {
    S.index = idx; render();
    if (S.screen === "setup" && save.settings.event === "free") prepWorldLifts();
  }).catch(function () { S.msg = t("inu_load_fail"); render(); });

  // 給 Playwright／開發用
  window.PriTestInusnowApp = {
    _debug: {
      state: function () {
        var r = S.race;
        var o = { screen: S.screen, kind: r && r.kind, mode: r && r.mode, phase: r && r.phase, ghost: !!(r && (r.ghost || r.cpus)), best: save.best, free: save.free };
        if (r && r.run) { o.status = r.run.status; o.steps = r.run.steps; o.next = r.run.next; o.gates = r.run.gates.length; o.time = r.run.time; o.score = r.run.final; o.tricks = r.run.tricks ? r.run.tricks.length : 0; o.zoom = r.run.st.zoom; }
        if (r && r.run && r.kind === "free") { o.bones = r.run.got.bones.length; o.liftNear = r.run.liftNear; o.lifts = r.world.lifts.length; }
        if (r && r.cross) { o.status = r.cross.status; o.steps = r.cross.steps; o.place = r.cross.riders[0].place; o.done = r.cross.riders[0].done; }
        if (r && r.cpus) o.cpus = r.cpus.length;
        if (r) { o.cond = r.cond; o.std = r.std; o.coach = r.coach ? r.coach.cmds.length : null; }
        if (r && KINDS[r.kind] && KINDS[r.kind].debug) { var ko = KINDS[r.kind].debug(r); for (var kk in ko) if (Object.prototype.hasOwnProperty.call(ko, kk)) o[kk] = ko[kk]; }
        o.coins = save.coins;
        return o;
      },
      autopilot: function (on) { S.autopilot = !!on; },
      start: function (resort, opts) {
        opts = opts || {};
        if (opts.breed) save.dog.breed = opts.breed;
        if (opts.ghost !== undefined) save.settings.ghost = !!opts.ghost;
        if (opts.condSet) save.settings.cond = opts.condSet;
        S.resort = resort;
        startRace(resort, { event: opts.event || "gs", mode: opts.mode || "practice", runs: opts.runs || 1, cond: opts.cond });
      },
      // 自由滑行：把選手移到纜車山腳站附近（測試坐纜車）
      toLift: function (i) {
        var r = S.race;
        if (!r || r.kind !== "free") return false;
        var lf = r.world.lifts[i || 0];
        r.run.st.p[0] = lf.bottom[0]; r.run.st.p[2] = lf.bottom[1]; r.run.st.p[1] = T.height(r.terrain, lf.bottom[0], lf.bottom[1]);
        r.run.st.v = [0, 0, 0];
        return true;
      },
      fastLift: function (on) { S.fastLift = !!on; },
      sample: function () { return Input.sample(); },
      speedUp: function (k) { STEP_MS = 1000 / D.PHYS.hz / (k || 1); },
      save: function () { return save; },
      setSave: function (o) { for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) save[k] = o[k]; persist(); },
      tab: function (id) { S.tab = id; show("resorts"); },
    },
  };
})();
