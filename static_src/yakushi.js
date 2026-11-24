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
  // screen: title | story | investigate | board | lab | book
  var ui = { screen: "title", caseId: null, story: null, spotText: "", hoursOutShown: false,
    lab: "identify", evidence: null, tagsOff: {}, pickHerb: null, testResult: null, patient: null, meds: [], remedyResult: "",
    bookCat: "poison", bookQ: "", bookHerb: null, bookFrom: "title",
    selCard: null, boardFeedback: "", accuseReply: "", ending: null };
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

  // ===== 推理板／指認 =====
  var SLOT_KEYS = ["who", "what", "how", "why"];
  function cardName(def, id) { var i = id && Core.cardInfo(def, id); return i ? i.name : ""; }
  function whoName(def, who) {   // who 可能是人物 id 或卡片 id；都不是就不顯示，絕不外露 id
    if (!who) return "";
    var c = Cast.get(who);
    return c ? c.name : cardName(def, who);
  }
  function slotHtml(def, run, slot, label) {
    var id = run.board[slot];
    return '<button type="button" class="ys-btn ys-slot' + (id ? " ys-filled" : "") + '" data-ys-slot="' + slot + '"><span class="ys-slot-label">' + esc(label) + "</span>" +
      '<b class="ys-slot-card">' + esc(id ? cardName(def, id) : "＋") + "</b></button>";
  }
  function screenBoard() {
    var run = curRun(), def = curDef();
    if (!run || !def || run.phase === "done") { ui.screen = "title"; return screenTitle(); }
    if (run.phase === "accuse") return screenAccuse(run, def);
    var h = '<div id="ys-board"><div class="ys-bar"><span id="ys-hours">' + esc(t("ys_hours", { n: run.hours })) + "</span></div>" +
      '<div class="ys-slots">';
    SLOT_KEYS.forEach(function (k) { h += slotHtml(def, run, k, t("ys_slot_" + k)); });
    if (def.deep) h += slotHtml(def, run, "deep", def.deep.label + " " + t("ys_deep_hint"));
    h += '</div><h3 class="ys-sub">' + esc(t("ys_cards")) + '</h3><div class="ys-tabs">';
    run.cards.forEach(function (c) {
      var used = SLOT_KEYS.concat(["deep"]).some(function (k) { return run.board[k] === c; });
      h += '<button type="button" class="ys-btn ys-board-card' + (ui.selCard === c ? " ys-selected" : "") + (used ? " ys-used" : "") + '" data-ys-board-card="' + esc(c) + '">' + esc(cardName(def, c)) + "</button>";
    });
    h += '</div><p id="ys-board-feedback" class="ys-spot-text">' + esc(ui.boardFeedback) + "</p>" +
      '<div class="ys-row"><button type="button" class="ys-btn ys-btn-main" id="ys-submit">' + esc(t("ys_submit")) + "</button>" +
      (run.phase === "investigate" ? '<button type="button" class="ys-btn" id="ys-board-back">' + esc(t("ys_board_back")) + "</button>" : "") +
      '<button type="button" class="ys-btn ys-btn-quiet" id="ys-back-title">' + esc(t("ys_back_title")) + "</button></div></div>";
    return h;
  }
  function screenAccuse(run, def) {
    var r = Core.currentRebuttal(run), who = r ? whoName(def, r.who) : "";
    var h = '<div id="ys-accuse"><h2 class="ys-sub">' + esc(t("ys_accuse")) + '</h2><p id="ys-accuse-claim" class="ys-spot-text">' +
      (who ? "<b>" + esc(who) + "</b>　" : "") + esc(r ? r.claim : "") + '</p><p id="ys-trust" class="ys-note">' + esc(t("ys_trust", { n: run.trust })) +
      '</p><p id="ys-accuse-reply" class="ys-note">' + esc(ui.accuseReply) + '</p><h3 class="ys-sub">' + esc(t("ys_present")) + '</h3><div class="ys-tabs">';
    run.cards.forEach(function (c) {
      h += '<button type="button" class="ys-btn ys-board-card" data-ys-present="' + esc(c) + '">' + esc(cardName(def, c)) + "</button>";
    });
    h += "</div>";
    if (def.deep) {
      h += '<h3 class="ys-sub">' + esc(def.deep.label) + ' <small class="ys-small">' + esc(t("ys_deep_hint")) + '</small></h3><div class="ys-tabs">';
      def.deep.options.forEach(function (o) {
        if (run.cards.indexOf(o.card) < 0) return;
        h += '<button type="button" class="ys-btn ys-board-card' + (run.board.deep === o.card ? " ys-selected" : "") + '" data-ys-deep-pick="' + esc(o.card) + '">' + esc(cardName(def, o.card)) + "</button>";
      });
      h += '<button type="button" class="ys-btn ys-btn-quiet' + (run.board.deep ? "" : " ys-selected") + '" data-ys-deep-pick="">' + esc(t("ys_deep_none")) + "</button></div>";
    }
    return h + "</div>";
  }
  function boardClick(d, run, def) {
    if (!run || !def) return false;
    if (d.ysBoardCard !== undefined) { ui.selCard = ui.selCard === d.ysBoardCard ? null : d.ysBoardCard; render(); return true; }
    if (d.ysSlot) {
      if (ui.selCard && run.cards.indexOf(ui.selCard) >= 0) {
        if (d.ysSlot !== "deep") SLOT_KEYS.forEach(function (k) { if (k !== d.ysSlot && run.board[k] === ui.selCard) Core.placeCard(run, k, null); });
        Core.placeCard(run, d.ysSlot, ui.selCard); ui.selCard = null;
      } else Core.placeCard(run, d.ysSlot, null);
      done(); return true;
    }
    if (d.ysDeepPick !== undefined) { Core.placeCard(run, "deep", d.ysDeepPick || null); done(); return true; }
    if (d.ysPresent) {
      var r = Core.currentRebuttal(run), res = Core.present(run, d.ysPresent);
      if (!res.ok) return true;
      if (res.hit) {
        ui.accuseReply = res.reply || "";
        if (res.done) {
          save();
          startEnding(res.reply ? [{ who: r && Cast.get(r.who) ? r.who : null, text: res.reply }] : []);
          return true;
        }
      } else ui.accuseReply = t(res.reset ? "ys_accuse_reset" : "ys_present_miss");
      done(); return true;
    }
    return false;
  }

  // ===== 結案 =====
  function startEnding(prefix) {
    var def = curDef(), run = curRun(); if (!def || !run) return;
    var st = def.story || {}, opt = Core.deepOption(def, run);
    var lines = (prefix || []).concat(st.truth || [], opt ? opt.monologue || [] : [], st.outro || [], def.monologue || []);
    ui.ending = { rating: null };
    playLines(lines, finishEnding);
  }
  function finishEnding() {
    var run = curRun();
    if (!run || run.phase !== "done" || !ui.ending || ui.ending.rating) return;   // 只結算一次
    var res = Core.finish(state, run);
    if (res.error) return;
    ui.ending.rating = res.rating;
    ui.screen = "ending"; done();
  }
  function screenEnding() {
    if (!ui.ending || !ui.ending.rating) { ui.screen = "title"; return screenTitle(); }
    return '<div class="ys-head"><h2 class="ys-title">' + esc(curDef() ? curDef().title : "") + '</h2></div><p id="ys-rating" class="ys-rating">' +
      esc(t("ys_rating", { r: ui.ending.rating })) + '</p><div class="ys-row"><button type="button" class="ys-btn ys-btn-main" id="ys-ending-back">' + esc(t("ys_ending_back")) + "</button></div>";
  }

  // ===== 獨語帖／人物圖鑑 =====
  function linesHtml(lines) {
    return (lines || []).map(function (ln) {
      var who = ln.who && Cast.get(ln.who) ? Cast.get(ln.who).name : "";
      return '<p class="ys-line">' + (who ? '<span class="ys-who">' + esc(who) + "</span>　" : "") + esc(ln.text) + "</p>";
    }).join("");
  }
  function screenJournal() {
    var h = '<h2 class="ys-sub">' + esc(t("ys_journal")) + '</h2><div id="ys-journal">', any = false;
    Core.CASE_ORDER.forEach(function (cid) {
      var def = Core.getCase(cid); if (!def) return;
      var body = "";
      Object.keys(state.monologues).forEach(function (k) {
        if (k.indexOf(cid + ":") !== 0) return;
        var sub = k.slice(cid.length + 1), lines = null;
        if (sub === "main") lines = def.monologue;
        else if (def.deep) {
          if (sub === "none") lines = def.deep.none;
          else def.deep.options.forEach(function (o) { if (o.key === sub) lines = o.monologue; });
        }
        if (lines && lines.length) body += '<div class="ys-mono">' + linesHtml(lines) + "</div>";
      });
      if (body) { any = true; h += '<h3 class="ys-sub">' + esc(def.title) + "</h3>" + body; }
    });
    if (!any) h += '<p class="ys-note">' + esc(t("ys_journal_empty")) + "</p>";
    return h + '</div><div class="ys-row"><button type="button" class="ys-btn" id="ys-journal-close">' + esc(t("ys_close")) + "</button></div>";
  }
  function screenCast() {
    var h = '<h2 class="ys-sub">' + esc(t("ys_cast")) + '</h2><div id="ys-cast" class="ys-cast">';
    Cast.list().forEach(function (c) {
      if (!state.castSeen[c.id]) { h += '<div class="ys-cast-item ys-silhouette"><b>' + esc(t("ys_unknown")) + "</b></div>"; return; }
      h += '<div class="ys-cast-item"><b>' + esc(c.name) + '</b> <small class="ys-small">' + esc(c.role) + '</small><p class="ys-note">' + esc(c.desc) + "</p>";
      (c.notes || []).forEach(function (n) {
        if (n.after == null || (state.cases[n.after] && state.cases[n.after].cleared)) h += '<p class="ys-note ys-cast-note">' + esc(n.text) + "</p>";
      });
      h += "</div>";
    });
    return h + '</div><div class="ys-row"><button type="button" class="ys-btn" id="ys-cast-close">' + esc(t("ys_close")) + "</button></div>";
  }
  // ===== 工作台（鑑定／試藥／調藥）=====
  var Herbs = window.PriTestYakushiHerbs;
  function herbName(id) { var h = Herbs && Herbs.get(id); return h ? h.name : id; }
  function evidenceList() {
    var run = curRun(), def = curDef(), out = [];
    if (!run || !def) return out;
    run.cards.forEach(function (c) { var d = def.cards[c]; if (d && d.herb && d.kind === "evidence") out.push(c); });
    return out;
  }
  function labEvidence() {
    var list = evidenceList();
    if (list.indexOf(ui.evidence) < 0) ui.evidence = list[0] || null;
    return ui.evidence;
  }
  function checkedTags(ev) {
    var run = curRun(), off = ui.tagsOff[ev] || [];
    return Core.evidenceTags(run, ev).filter(function (x) { return off.indexOf(x) < 0; });
  }
  function evidencePicker() {
    var def = curDef(), cur = labEvidence(), list = evidenceList();
    if (!list.length) return '<p class="ys-note">' + esc(t("ys_no_evidence")) + "</p>";
    var h = '<h3 class="ys-sub">' + esc(t("ys_pick_evidence")) + '</h3><div class="ys-tabs">';
    list.forEach(function (id) {
      h += '<button type="button" class="ys-tab' + (id === cur ? " ys-on" : "") + '" data-ys-evidence="' + esc(id) + '">' + esc(def.cards[id].name) + "</button>";
    });
    return h + "</div>";
  }
  function labIdentify() {
    var run = curRun(), ev = labEvidence(), h = evidencePicker();
    if (!ev) return h;
    var tags = Core.evidenceTags(run, ev), on = checkedTags(ev);
    if (run.identified[ev]) h += '<p id="ys-identified" class="ys-note">' + esc(t("ys_identified", { name: herbName(run.identified[ev]) })) + "</p>";
    h += '<h3 class="ys-sub">' + esc(t("ys_tags")) + '</h3><div class="ys-tags">';
    tags.forEach(function (tg) {
      var c = on.indexOf(tg) >= 0;
      h += '<button type="button" class="ys-chip' + (c ? " ys-on" : "") + '" aria-pressed="' + c + '" data-ys-tag="' + esc(tg) + '">' + esc(tg.replace(/^onset:/, "")) + "</button>";
    });
    var cands = Core.candidates(on);
    h += '</div><h3 class="ys-sub">' + esc(t("ys_candidates", { n: cands.length })) + "</h3>";
    var g = cands.length ? cands[0].group : null;
    if (cands.length >= 2 && g && cands.every(function (x) { return x.group === g; })) h += '<p class="ys-note ys-lookalike">' + esc(t("ys_lookalike")) + "</p>";
    h += '<div class="ys-tabs">';
    cands.forEach(function (x) {
      h += '<button type="button" class="ys-tab' + (ui.pickHerb === x.id ? " ys-on" : "") + '" data-ys-herb="' + esc(x.id) + '">' + esc(x.name) + "</button>";
    });
    h += '</div><div class="ys-row"><button type="button" class="ys-btn ys-btn-main" id="ys-identify-confirm"' + (ui.pickHerb && cands.some(function (x) { return x.id === ui.pickHerb; }) ? "" : " disabled") + ">" + esc(t("ys_identify")) + "</button></div>";
    return h;
  }
  function labTest() {
    var run = curRun(), ev = labEvidence(), h = evidencePicker();
    if (!ev) return h;
    h += '<div class="ys-tabs">';
    Herbs.METHODS.forEach(function (m) {
      h += '<button type="button" class="ys-btn' + ((ev + "|" + m) in run.tested ? " ys-done" : "") + '" data-ys-test="' + esc(m) + '">' + esc(t("ys_m_" + m)) + "</button>";
    });
    h += '</div><div id="ys-test-result" class="ys-spot-text">';
    var tr = ui.testResult;
    if (tr && tr.ev === ev) {
      h += esc(tr.text == null ? t("ys_no_reaction") : tr.text);
      if (tr.collapsed) h += "<br><b>" + esc(t("ys_collapse")) + "</b>";
    }
    return h + "</div>";
  }
  function labRemedy() {
    var run = curRun(), def = curDef(), h = '<h3 class="ys-sub">' + esc(t("ys_patients")) + '</h3><div class="ys-tabs">';
    (def.patients || []).forEach(function (p) {
      var st = run.patients[p.id] || { level: 0 };
      var note = st.cured ? t("ys_patient_cured") : st.lost ? t("ys_patient_lost") : t("ys_patient_state", { lv: st.level });
      h += '<button type="button" class="ys-tab' + (ui.patient === p.id ? " ys-on" : "") + '" data-ys-patient="' + esc(p.id) + '">' + esc(p.name) +
        ' <small class="ys-small">' + esc(note) + "</small></button>";
    });
    h += '</div><h3 class="ys-sub">' + esc(t("ys_medbox")) + '</h3><div class="ys-tags">';
    (def.medicineBox || []).forEach(function (id) {
      var c = ui.meds.indexOf(id) >= 0;
      h += '<button type="button" class="ys-chip' + (c ? " ys-on" : "") + '" aria-pressed="' + c + '" data-ys-med="' + esc(id) + '">' + esc(herbName(id)) + "</button>";
    });
    var st2 = ui.patient && run.patients[ui.patient], can = st2 && !st2.cured && !st2.lost && ui.meds.length >= 1;
    h += '</div><div class="ys-row"><button type="button" class="ys-btn ys-btn-main" id="ys-remedy-give"' + (can ? "" : " disabled") + ">" + esc(t("ys_remedy_give")) + "</button></div>" +
      '<p id="ys-remedy-result" class="ys-spot-text">' + esc(ui.remedyResult || "") + "</p>" +
      '<p class="ys-disclaimer">' + esc(t("ys_disclaimer")) + "</p>";
    return h;
  }
  function screenLab() {
    var run = curRun();
    if (!run) { ui.screen = "title"; return screenTitle(); }
    var h = '<div class="ys-bar"><span id="ys-hours">' + esc(t("ys_hours", { n: run.hours })) + '</span><span id="ys-stamina">' + esc(t("ys_stamina", { n: run.stamina })) + "</span></div>";
    h += '<div class="ys-tabs">';
    ["identify", "test", "remedy"].forEach(function (k) {
      h += '<button type="button" class="ys-tab' + (ui.lab === k ? " ys-on" : "") + '" data-ys-lab="' + k + '">' + esc(t("ys_lab_" + k)) + "</button>";
    });
    h += '</div><div id="ys-lab">' + (ui.lab === "test" ? labTest() : ui.lab === "remedy" ? labRemedy() : labIdentify()) +
      '</div><div class="ys-row"><button type="button" class="ys-btn ys-btn-quiet" id="ys-open-book-lab">' + esc(t("ys_book")) + "</button>" +
      '<button type="button" class="ys-btn" id="ys-lab-close">' + esc(t("ys_close")) + "</button></div>";
    return h;
  }

  // ===== 藥材圖鑑 =====
  function groupName(g) {
    if (!g) return "";
    var k = "ys_group_" + g, v = t(k);
    return v && v !== k ? v : "";   // 沒有名稱就不顯示，絕不外露群組 id
  }
  function bookList() {
    var q = (ui.bookQ || "").trim(), herbs = q ? Herbs.search(q).filter(function (x) { return state.herbsSeen[x.id]; }) : Herbs.byCat(ui.bookCat), h = "";
    herbs.forEach(function (x) {
      var seen = !!state.herbsSeen[x.id];
      h += '<button type="button" class="ys-btn ys-book-item' + (ui.bookHerb === x.id ? " ys-on" : "") + '" data-ys-book-herb="' + esc(x.id) + '">' +
        (seen ? esc(x.name) : '<span class="ys-silhouette">' + esc(t("ys_unknown")) + "</span>" + (groupName(x.group) ? ' <small class="ys-small">' + esc(groupName(x.group)) + "</small>" : "")) + "</button>";
    });
    return h;
  }
  function bookDetail() {
    var x = ui.bookHerb && Herbs.get(ui.bookHerb);
    if (!x) return "";
    if (!state.herbsSeen[x.id]) return '<p class="ys-note">' + esc(t("ys_book_unseen")) + (groupName(x.group) ? " " + esc(groupName(x.group)) : "") + "</p>";
    var h = '<h3 class="ys-sub">' + esc(x.name) + "</h3>";
    if (x.alias && x.alias.length) h += '<p class="ys-note">' + esc(t("ys_book_alias")) + "：" + esc(x.alias.join("、")) + "</p>";
    if (x.lore) h += '<p class="ys-line">' + esc(x.lore) + "</p>";
    if (x.distinguish) h += '<p class="ys-note">' + esc(t("ys_book_distinguish")) + "：" + esc(x.distinguish) + "</p>";
    h += '<ul class="ys-cards">';
    Herbs.METHODS.forEach(function (m) {
      if (x.tests && x.tests[m]) h += '<li class="ys-card"><span class="ys-card-kind">' + esc(t("ys_m_" + m)) + '</span><span class="ys-card-text">' + esc(x.tests[m]) + "</span></li>";
    });
    return h + "</ul>";
  }
  function screenBook() {
    var h = '<h2 class="ys-sub">' + esc(t("ys_book")) + '</h2><div class="ys-tabs">';
    Herbs.CATS.forEach(function (c) {
      h += '<button type="button" class="ys-tab' + (ui.bookCat === c && !ui.bookQ ? " ys-on" : "") + '" data-ys-cat="' + c + '">' + esc(t("ys_cat_" + c)) + "</button>";
    });
    h += '</div><input type="search" id="ys-book-search" class="ys-input" placeholder="' + esc(t("ys_search")) + '" value="' + esc(ui.bookQ) + '">' +
      '<div id="ys-book-list" class="ys-book-list">' + bookList() + '</div><div id="ys-book-detail">' + bookDetail() + "</div>" +
      '<p class="ys-disclaimer">' + esc(t("ys_disclaimer")) + '</p><div class="ys-row"><button type="button" class="ys-btn" id="ys-book-close">' + esc(t("ys_close")) + "</button></div>";
    return h;
  }

  var SCREENS = { title: screenTitle, story: screenStory, investigate: screenInvestigate, board: screenBoard, lab: screenLab, book: screenBook,
    ending: screenEnding, journal: screenJournal, cast: screenCast };

  function render() {
    if (!appEl) return;
    var run = curRun();
    // 調查中時辰用完 → 先顯示一句再切推理板
    if ((ui.screen === "investigate" || ui.screen === "lab") && run && run.phase === "board") {
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
  function resetLabUi() {
    ui.lab = "identify"; ui.evidence = null; ui.tagsOff = {}; ui.pickHerb = null; ui.testResult = null;
    ui.patient = null; ui.meds = []; ui.remedyResult = "";
  }
  function openCase(id) {
    ui.caseId = id; ui.spotText = ""; ui.hoursOutShown = false;
    resetLabUi();
    var c = state.cases[id], run = c && c.run;
    ui.selCard = null; ui.boardFeedback = ""; ui.accuseReply = ""; ui.ending = null;
    if (run && run.phase === "done") { startEnding([]); return; }   // 結案中途離開：回來接著播
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

  function labClick(d, run) {
    if (!run) return false;
    if (d.ysLab) { ui.lab = d.ysLab; ui.remedyResult = ""; render(); return true; }
    if (d.ysEvidence) {
      if (ui.evidence !== d.ysEvidence) { delete ui.tagsOff[d.ysEvidence]; ui.pickHerb = null; ui.testResult = null; }
      ui.evidence = d.ysEvidence; render(); return true;
    }
    if (d.ysTag && ui.evidence) {
      var off = ui.tagsOff[ui.evidence] = ui.tagsOff[ui.evidence] || [], i = off.indexOf(d.ysTag);
      if (i >= 0) off.splice(i, 1); else off.push(d.ysTag);
      render(); return true;
    }
    if (d.ysHerb) { ui.pickHerb = d.ysHerb; render(); return true; }
    if (d.ysTest && ui.evidence) {
      var r = Core.runTest(run, ui.evidence, d.ysTest);
      ui.testResult = r.ok ? { ev: ui.evidence, text: r.text, collapsed: r.collapsed } : null;
      done(); return true;
    }
    if (d.ysPatient) { ui.patient = d.ysPatient; ui.remedyResult = ""; render(); return true; }
    if (d.ysMed) {
      var j = ui.meds.indexOf(d.ysMed);
      if (j >= 0) ui.meds.splice(j, 1); else if (ui.meds.length < 3) ui.meds.push(d.ysMed);
      render(); return true;
    }
    return false;
  }
  function bookClick(d) {
    if (d.ysCat) { ui.bookCat = d.ysCat; ui.bookQ = ""; ui.bookHerb = null; render(); return true; }
    if (d.ysBookHerb) { ui.bookHerb = d.ysBookHerb; render(); return true; }
    return false;
  }

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
    if (ui.screen === "lab" && labClick(d, run)) return;
    if (ui.screen === "book" && bookClick(d)) return;
    if (ui.screen === "board" && boardClick(d, run, curDef())) return;
    if (d.ysAct && ACTIONS[d.ysAct]) { ACTIONS[d.ysAct](el); return; }
    switch (el.id) {
      case "ys-story-next": storyAdvance(); break;
      case "ys-story-skip": storyFinish(); break;
      case "ys-open-lab": ui.screen = "lab"; ui.remedyResult = ""; render(); break;
      case "ys-lab-close": ui.screen = "investigate"; render(); break;
      case "ys-open-book": case "ys-open-book-lab":
        ui.bookFrom = ui.screen === "lab" ? "lab" : "title"; ui.screen = "book"; render(); break;
      case "ys-book-close": ui.screen = ui.bookFrom === "lab" && curRun() ? "lab" : "title"; render(); break;
      case "ys-identify-confirm":
        if (run && ui.evidence && ui.pickHerb && Core.identify(run, ui.evidence, ui.pickHerb).ok) ui.pickHerb = null;
        done(); break;
      case "ys-remedy-give":
        if (run && ui.patient) {
          var rr = Core.giveRemedy(run, ui.patient, ui.meds.slice());
          if (rr.ok) { ui.remedyResult = t(rr.cured ? "ys_cured" : rr.lost ? "ys_lost" : "ys_worse"); ui.meds = []; }
        }
        done(); break;
      case "ys-to-board":
        if (run && window.confirm(t("ys_to_board_confirm"))) { Core.toBoard(run); ui.hoursOutShown = true; ui.screen = "board"; done(); }
        break;
      case "ys-board-back": if (run && run.phase === "investigate") { ui.screen = "investigate"; render(); } break;
      case "ys-submit":
        if (run) {
          var sr = Core.submit(run);
          ui.boardFeedback = sr.error ? t("ys_board_empty") : t("ys_board_result", { n: sr.correct });
          if (!sr.error && sr.correct === 4) ui.accuseReply = "";
        }
        done(); break;
      case "ys-ending-back": ui.ending = null; ui.screen = "title"; render(); break;
      case "ys-open-journal": ui.screen = "journal"; render(); break;
      case "ys-open-cast": ui.screen = "cast"; render(); break;
      case "ys-journal-close": case "ys-cast-close": ui.screen = "title"; render(); break;
      case "ys-back-title": ui.screen = "title"; ui.story = null; render(); break;
      case "ys-reset":
        if (window.confirm(t("ys_reset_confirm"))) { state = Core.newSave(); ui.caseId = null; ui.ending = null; resetLabUi(); ui.bookHerb = null; ui.bookQ = ""; save(); render(); }
        break;
      default: break;
    }
  }

  function boot() {
    appEl = document.getElementById("ys-app");
    if (!appEl) return;
    appEl.addEventListener("click", onClick);
    appEl.addEventListener("input", function (e) {
      if (!e.target || e.target.id !== "ys-book-search") return;
      ui.bookQ = e.target.value; ui.bookHerb = null;
      var l = document.getElementById("ys-book-list"), dt = document.getElementById("ys-book-detail");
      if (l) l.innerHTML = bookList();
      if (dt) dt.innerHTML = "";
    });
    render();
  }
  window.PriTestYakushi = {
    _debugState: function () { return state; },
    _debugRun: function () { return curRun(); }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
