// 少女藥師的獨語（yakushi）：畫面、存檔、操作。
// 結構：ui 狀態物件 → render() 依 ui.screen 分派 → #ys-app 上單一委派 click handler（依 data-ys-* 分派）。
// Task 11 加實驗室／圖鑑、Task 12 加推理板／指認／結局／獨語帖／人物：
//   在 SCREENS 加畫面函式、在 ACTIONS 加 data-ys-act 處理器、在 onClick 的 switch 加按鈕 id 即可。
(function () {
  "use strict";
  var KEY = "pritest-yakushi-save";
  var Core = window.PriTestYakushiCore, Cast = window.PriTestYakushiCast;

  function t(k, p) { return window.I18N ? window.I18N.t(k, p) : k; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // ===== 存檔 =====
  var state = load();
  function load() {
    var s;
    try { s = Core.normalizeSave(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return Core.newSave(); }
    Object.keys(s.cases).forEach(function (id) {
      var c = s.cases[id];
      if (!c || typeof c !== "object") { delete s.cases[id]; return; }
      if (c.run != null && !validRun(id, c.run)) delete c.run;
    });
    return s;
  }
  // 壞檔／手改檔的 run 一律丟棄，避免畫面整個壞掉
  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  function validRun(id, r) {
    var def = Core.getCase(id);
    if (!def || !isObj(r)) return false;
    if (!Array.isArray(r.cards) || !isObj(r.done) || !isObj(r.identified) || !isObj(r.tested) || !isObj(r.patients) || !isObj(r.board)) return false;
    if (typeof r.hours !== "number" || typeof r.stamina !== "number" || typeof r.trust !== "number") return false;
    if (["investigate", "board", "accuse", "done"].indexOf(r.phase) < 0) return false;
    return def.places.some(function (p) { return p.id === r.place; });
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  // ===== UI 狀態（不存檔）=====
  // screen: title | story | investigate | board | lab
  var ui = { screen: "title", caseId: null, story: null, spotText: "", hoursOutShown: false };
  var appEl = null;

  function curRun() { return ui.caseId && state.cases[ui.caseId] ? state.cases[ui.caseId].run || null : null; }
  function curDef() { return ui.caseId ? Core.getCase(ui.caseId) : null; }
  function done() { save(); render(); }

  // ===== 劇情播放器 =====
  function playLines(lines, doneCb) {
    if (!lines || !lines.length) { doneCb(); return; }
    ui.story = { lines: lines, i: 0, done: doneCb };
    ui.screen = "story";
    render();
  }
  function storyAdvance() {
    var s = ui.story; if (!s) return;
    s.i++;
    if (s.i >= s.lines.length) storyFinish(); else render();
  }
  function storyFinish() { var s = ui.story; ui.story = null; if (s) s.done(); }

  // ===== 畫面 =====
  function bestOf(id) { var c = state.cases[id]; return c && c.best ? c.best : null; }

  function screenTitle() {
    var h = '<div class="ys-head"><h2 class="ys-title">' + esc(t("ys_title")) + '</h2></div><div class="ys-cases">';
    Core.CASE_ORDER.forEach(function (id) {
      var def = Core.getCase(id);
      if (!def) return;
      var unlocked = state.unlocked.indexOf(id) >= 0;
      var hasRun = state.cases[id] && state.cases[id].run && state.cases[id].run.phase !== "done";
      var best = bestOf(id);
      h += '<div class="ys-case-row"><button type="button" class="ys-btn ys-btn-main" data-ys-case="' + esc(id) + '"' + (unlocked ? "" : " disabled") + ">" +
        '<span class="ys-case-name">' + esc(def.title) + "</span>" +
        '<span class="ys-case-sub">' + esc(unlocked ? t(hasRun ? "ys_continue" : "ys_new") : t("ys_case_locked")) + "</span></button>" +
        (best ? '<span class="ys-best">' + esc(t("ys_best", { r: best })) + "</span>" : "") + "</div>";
    });
    h += '</div><div class="ys-row">' +
      '<button type="button" class="ys-btn" id="ys-open-book">' + esc(t("ys_book")) + "</button>" +
      '<button type="button" class="ys-btn" id="ys-open-journal">' + esc(t("ys_journal")) + "</button>" +
      '<button type="button" class="ys-btn" id="ys-open-cast">' + esc(t("ys_cast")) + "</button></div>" +
      '<div class="ys-row"><button type="button" class="ys-btn ys-btn-quiet" id="ys-reset">' + esc(t("ys_reset")) + "</button></div>" +
      '<p class="ys-disclaimer">' + esc(t("ys_disclaimer")) + "</p>";
    return h;
  }

  function screenStory() {
    var s = ui.story; if (!s) return "";
    var ln = s.lines[s.i] || {};
    var who = ln.who ? (Cast.get(ln.who) ? Cast.get(ln.who).name : ln.who) : t("ys_narrator");
    return '<div class="ys-story-box"><div id="ys-story"><span class="ys-who' + (ln.who ? "" : " ys-who-narr") + '">' + esc(who) + "</span>" +
      '<p class="ys-line">' + esc(ln.text) + "</p></div>" +
      '<div class="ys-row"><button type="button" class="ys-btn ys-btn-main" id="ys-story-next">' + esc(t("ys_next")) + "</button>" +
      '<button type="button" class="ys-btn ys-btn-quiet" id="ys-story-skip">' + esc(t("ys_skip")) + "</button></div></div>";
  }

  function cardHtml(def, id) {
    var info = Core.cardInfo(def, id); if (!info) return "";
    return '<li class="ys-card ys-card-' + esc(info.kind) + '" data-ys-card="' + esc(id) + '"><span class="ys-card-kind">' +
      esc(t("ys_kind_" + info.kind)) + '</span><b class="ys-card-name">' + esc(info.name) + '</b><span class="ys-card-text">' + esc(info.text) + "</span></li>";
  }

  function screenInvestigate() {
    var run = curRun(), def = curDef();
    if (!run || !def) { ui.screen = "title"; return screenTitle(); }
    var h = '<div class="ys-bar"><span id="ys-hours">' + esc(t("ys_hours", { n: run.hours })) + '</span><span id="ys-stamina">' + esc(t("ys_stamina", { n: run.stamina })) + "</span></div>";
    h += '<div class="ys-tabs">';
    def.places.forEach(function (p) {
      h += '<button type="button" class="ys-tab' + (p.id === run.place ? " ys-on" : "") + '" data-ys-place="' + esc(p.id) + '">' + esc(p.name) + "</button>";
    });
    h += '</div><div class="ys-spots">';
    var place = null;
    def.places.forEach(function (p) { if (p.id === run.place) place = p; });
    (place ? place.spots : []).forEach(function (sp) {
      var isDone = !!run.done[sp.id], open = Core.spotOpen(run, sp);
      h += '<button type="button" class="ys-btn ys-spot' + (isDone ? " ys-done" : "") + '" data-ys-spot="' + esc(sp.id) + '"' + (open || isDone ? "" : " disabled") + ">" + esc(sp.label) + "</button>";
    });
    h += '</div><p id="ys-spot-text" class="ys-spot-text">' + esc(ui.spotText) + "</p>";
    h += '<h3 class="ys-sub">' + esc(t("ys_cards")) + '</h3><ul id="ys-cards" class="ys-cards">';
    run.cards.forEach(function (c) { h += cardHtml(def, c); });
    h += "</ul>";
    h += '<div class="ys-row"><button type="button" class="ys-btn" id="ys-open-lab">' + esc(t("ys_lab")) + "</button>" +
      '<button type="button" class="ys-btn ys-btn-main" id="ys-to-board">' + esc(t("ys_to_board")) + "</button>" +
      '<button type="button" class="ys-btn ys-btn-quiet" id="ys-back-title">' + esc(t("ys_back_title")) + "</button></div>";
    return h;
  }

  // Task 12 會取代這個暫時的推理板
  function screenBoard() {
    return '<div id="ys-board"><p>' + esc(t("ys_board_soon")) + '</p><div class="ys-row"><button type="button" class="ys-btn ys-btn-quiet" id="ys-back-title">' + esc(t("ys_back_title")) + "</button></div></div>";
  }
  // Task 11 會取代這個暫時的實驗室
  function screenLab() {
    return '<div id="ys-lab"><p>' + esc(t("ys_lab_soon")) + '</p><div class="ys-row"><button type="button" class="ys-btn" data-ys-act="lab-close">' + esc(t("ys_close")) + "</button></div></div>";
  }

  var SCREENS = { title: screenTitle, story: screenStory, investigate: screenInvestigate, board: screenBoard, lab: screenLab };

  function render() {
    if (!appEl) return;
    var run = curRun();
    // 調查中時辰用完 → 先顯示一句再切推理板
    if (ui.screen === "investigate" && run && run.phase === "board") {
      if (run.hours === 0 && !ui.hoursOutShown) {
        ui.hoursOutShown = true;
        playLines([{ who: null, text: t("ys_hours_out") }], function () { ui.screen = "board"; render(); });
        return;
      }
      ui.screen = "board";
    }
    var html;
    try { html = (SCREENS[ui.screen] || screenTitle)(); } catch (e) {
      if (window.console && console.warn) console.warn("yakushi render failed", e);
      ui.screen = "title"; ui.story = null; html = screenTitle();
    }
    appEl.innerHTML = html;
  }

  // ===== 操作 =====
  function spotTextOf(spotId) {
    var def = curDef(), out = "";
    if (def) def.places.forEach(function (p) { p.spots.forEach(function (sp) { if (sp.id === spotId) out = sp.text; }); });
    return out;
  }
  function openCase(id) {
    ui.caseId = id; ui.spotText = ""; ui.hoursOutShown = false;
    var c = state.cases[id], run = c && c.run;
    if (run && run.phase !== "done") {
      ui.hoursOutShown = true;
      ui.screen = run.phase === "investigate" ? "investigate" : "board";
      render(); return;
    }
    run = Core.startCase(state, id);
    if (run.error) return;
    save();
    var def = Core.getCase(id);
    playLines((def.story && def.story.intro) || [], function () { ui.screen = "investigate"; done(); });
  }

  // data-ys-act 處理器（Task 11、12 在此追加）
  var ACTIONS = {
    "lab-close": function () { ui.screen = "investigate"; render(); }
  };

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest("button, [data-ys-act], [data-ys-card]") : null;
    if (!el || !appEl.contains(el) || el.disabled) return;
    var d = el.dataset, run = curRun();
    if (d.ysCase) { openCase(d.ysCase); return; }
    if (d.ysPlace && run) { Core.move(run, d.ysPlace); ui.spotText = ""; done(); return; }
    if (d.ysSpot && run) {
      var r = Core.visit(run, d.ysSpot);
      if (r.ok) ui.spotText = r.text;
      else if (r.error === "done") ui.spotText = spotTextOf(d.ysSpot);
      if (r.ok && run.phase === "board" && run.hours === 0) { // 先看完這一處的描述，再顯示時辰用完
        save();
        playLines([{ who: null, text: r.text }], function () { ui.screen = "investigate"; render(); });
        return;
      }
      done(); return;
    }
    if (d.ysAct && ACTIONS[d.ysAct]) { ACTIONS[d.ysAct](el); return; }
    switch (el.id) {
      case "ys-story-next": storyAdvance(); break;
      case "ys-story-skip": storyFinish(); break;
      case "ys-open-lab": ui.screen = "lab"; render(); break;
      case "ys-to-board": if (run) { Core.toBoard(run); ui.hoursOutShown = true; ui.screen = "board"; done(); } break;
      case "ys-back-title": ui.screen = "title"; ui.story = null; render(); break;
      case "ys-reset":
        if (window.confirm(t("ys_reset_confirm"))) { state = Core.newSave(); ui.caseId = null; save(); render(); }
        break;
      default: break; // ys-open-book / journal / cast 由 Task 11、12 接上
    }
  }

  function boot() {
    appEl = document.getElementById("ys-app");
    if (!appEl) return;
    appEl.addEventListener("click", onClick);
    render();
  }
  window.PriTestYakushi = {
    _debugState: function () { return state; },
    _debugRun: function () { return curRun(); }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
