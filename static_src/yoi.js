// 宵の怪談（yoi）：畫面（設定、遊戲、事件對話框、名指し、結局）與本機存檔。
// 規則全部交給 yoi_core.js（Core.apply）；3D 交給 yoi_3d.js，沒有 WebGL 時用 2D 平面圖。
(function () {
  "use strict";

  var D = window.PriTestYoiData, Core = window.PriTestYoiCore, V3 = window.PriTestYoi3D;
  var app = document.getElementById("yo-app");
  if (!D || !Core || !app) return;

  var SAVE_KEY = "pritest-yoi-save-v1";
  var PREF_KEY = "pritest-yoi-pref";

  function t(k, p) { return window.I18N ? window.I18N.t(k, p) : k; }
  function lang() { return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || "zh"; }
  function L(o) { return o ? (o[lang()] || o.zh || "") : ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load(key) { try { var s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function store(key, v) { try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

  var pref = load(PREF_KEY) || {};
  var setup = { stage: pref.stage || "random", seats: pref.seats || [{ job: "medium", name: "" }, { job: "taoist", name: "" }] };
  var st = null;
  var ui = { floor: 0, view: pref.view || "3d", modal: null, sel: { kaii: null, taboos: [] }, marks: {}, err: "", abandonArm: false, lastCur: null };
  var webgl = V3 && V3.available();
  var view3d = null, mounting = false;
  var els = null;   // 遊戲畫面的固定節點

  // ---------------- 文字工具 ----------------
  function memberName(i) {
    var m = st.members[i];
    return m ? (m.name || L(D.JOB_BY_ID[m.job].name)) : "";
  }
  function roomName(id) { var r = Core.room(st, id); return r ? L(r.name) : id; }
  function hourLabel(idx) { var h = D.HOURS[idx]; return h == null ? "05:00" : (h < 10 ? "0" : "") + h + ":00"; }
  function logText(e) {
    var p = {}, src = e.p || {};
    Object.keys(src).forEach(function (k) { p[k] = src[k]; });
    if (src.who != null) p.who = memberName(src.who);
    if (src.target != null) p.target = memberName(src.target);
    if (src.room) p.room = roomName(src.room);
    if (src.taboo) p.taboo = L(D.TABOO_BY_ID[src.taboo].name);
    if (src.tag) p.tag = L(D.TAG_BY_ID[src.tag].clue);
    if (src.item) p.item = L(D.ITEM_BY_ID[src.item].name);
    if (src.stage) p.stage = L(D.STAGE_BY_ID[src.stage].name);
    if (src.kaii) p.kaii = L(D.KAII_BY_ID[src.kaii].name);
    if (src.hour != null) p.hour = (src.hour < 10 ? "0" : "") + src.hour + ":00";
    if (src.ev) p.ev = t("yo_tier_" + src.tier);
    return t(e.k, p);
  }
  function cardText(c) {
    if (c.k === "tag") return L(D.TAG_BY_ID[c.tag].clue) + "（" + L(D.TAG_BY_ID[c.tag].name) + "）";
    if (c.k === "taboo") return L(D.TABOO_CLUE).replace("{taboo}", L(D.TABOO_BY_ID[c.taboo].name));
    if (c.k === "item") return L(D.ITEM_BY_ID[c.item].name) + "：" + L(D.ITEM_BY_ID[c.item].desc);
    if (c.k === "offering") return t("yo_offering_title");
    return "……";
  }

  // 禁忌狀態：yes（確定）／no（確認無事）／null
  function tabooState(id) {
    if (st.revealed[id] || st.divined[id] === true || st.clues.some(function (c) { return c.k === "taboo" && c.taboo === id; })) return "yes";
    if (st.safe[id] || st.divined[id] === false) return "no";
    return null;
  }

  // ---------------- 存檔 ----------------
  function save() {
    if (!st || st.result) { store(SAVE_KEY, null); return; }
    store(SAVE_KEY, { st: st, marks: ui.marks });
  }
  function savePref() { store(PREF_KEY, { stage: setup.stage, seats: setup.seats, view: ui.view }); }

  // ---------------- 操作 ----------------
  function act(a) {
    var r = Core.apply(st, "local", a);
    ui.err = r.ok ? "" : (t("yo_err_" + r.err) !== "yo_err_" + r.err ? t("yo_err_" + r.err) : t("yo_err_other"));
    if (r.ok) { ui.modal = null; ui.sel = { kaii: null, taboos: [] }; }
    if (st.result) ui.modal = null;
    save();
    render();
  }

  // ---------------- 設定畫面 ----------------
  function renderSetup() {
    destroyView();
    els = null;
    var saved = load(SAVE_KEY), h = [];
    h.push('<div class="yo-hero"><h1 class="yo-title">' + esc(t("yo_title")) + '</h1><p class="yo-intro">' + esc(t("yo_intro")) + "</p></div>");
    if (saved && saved.st && !saved.st.result && D.STAGE_BY_ID[saved.st.stage]) {
      h.push('<div class="yo-panel yo-continue"><span>' + esc(t("yo_saved", { stage: L(D.STAGE_BY_ID[saved.st.stage].name), time: hourLabel(saved.st.hourIdx) })) +
        '</span><button class="yo-btn yo-primary" data-act="continue">' + esc(t("yo_continue")) + "</button></div>");
    }
    h.push('<div class="yo-panel"><h2>' + esc(t("yo_new")) + "</h2>");
    h.push('<h3>' + esc(t("yo_stage")) + '</h3><div class="yo-stages">');
    [{ id: "random", name: null }].concat(D.STAGES).forEach(function (s) {
      var on = setup.stage === s.id;
      h.push('<button class="yo-stage' + (on ? " yo-on" : "") + '" data-act="stage" data-id="' + s.id + '"><b>' +
        esc(s.id === "random" ? "？" : L(s.name)) + "</b><span>" + esc(s.id === "random" ? t("yo_stage_random") : L(s.desc)) + "</span></button>");
    });
    h.push("</div><h3>" + esc(t("yo_party")) + '</h3><div class="yo-seats">');
    setup.seats.forEach(function (seat, i) {
      var job = D.JOB_BY_ID[seat.job] || D.JOBS[0];
      h.push('<div class="yo-seat"><div class="yo-seat-head"><b>' + esc(t("yo_seat", { n: i + 1 })) + "</b>" +
        (setup.seats.length > 1 ? '<button class="yo-link" data-act="seat-del" data-i="' + i + '">' + esc(t("yo_remove")) + "</button>" : "") + "</div>" +
        '<input class="yo-input" data-act="seat-name" data-i="' + i + '" maxlength="12" placeholder="' + esc(t("yo_name_ph")) + '" value="' + esc(seat.name) + '">' +
        '<div class="yo-jobs">');
      D.JOBS.forEach(function (j) {
        h.push('<button class="yo-job' + (j.id === seat.job ? " yo-on" : "") + '" data-act="seat-job" data-i="' + i + '" data-id="' + j.id + '" style="--yo-c:#' + j.color.toString(16) + '">' + esc(L(j.name)) + "</button>");
      });
      h.push('</div><p class="yo-small">' + esc(t("yo_hp")) + " " + job.hp + "・" + esc(t("yo_nerve")) + " " + job.nerve + "　" + esc(L(job.skill)) + "</p></div>");
    });
    h.push("</div>");
    if (setup.seats.length < 4) h.push('<button class="yo-btn" data-act="seat-add">' + esc(t("yo_add")) + "</button> ");
    h.push('<button class="yo-btn yo-primary" data-act="start">' + esc(t("yo_start")) + "</button></div>");
    app.innerHTML = h.join("");
  }

  // ---------------- 遊戲畫面 ----------------
  function buildGameShell() {
    app.innerHTML =
      '<div class="yo-game">' +
      '<div class="yo-top" id="yo-top"></div>' +
      '<div class="yo-main">' +
      '<div class="yo-stagebox"><div class="yo-viewbar" id="yo-viewbar"></div><div class="yo-view" id="yo-view"></div><div class="yo-map" id="yo-map"></div></div>' +
      '<div class="yo-side" id="yo-side"></div>' +
      "</div>" +
      '<div class="yo-book" id="yo-book"></div>' +
      '<div class="yo-modal-host" id="yo-modal"></div>' +
      "</div>";
    els = {
      top: document.getElementById("yo-top"), viewbar: document.getElementById("yo-viewbar"),
      view: document.getElementById("yo-view"), map: document.getElementById("yo-map"),
      side: document.getElementById("yo-side"), book: document.getElementById("yo-book"), modal: document.getElementById("yo-modal")
    };
  }

  function destroyView() { if (view3d) { view3d.dispose(); view3d = null; } }
  function use3d() { return webgl && ui.view === "3d"; }
  function ensureView() {
    if (!use3d()) { destroyView(); els.view.style.display = "none"; els.map.style.display = ""; return; }
    els.view.style.display = ""; els.map.style.display = "none";
    if (view3d || mounting) return;
    mounting = true;
    els.view.innerHTML = '<div class="yo-loading">' + esc(t("yo_3d_loading")) + "</div>";
    V3.mount(els.view, { onRoomClick: onRoomClick }).then(function (v) {
      mounting = false;
      var ld = els && els.view.querySelector(".yo-loading"); if (ld) ld.parentNode.removeChild(ld);
      if (!els || !st) { v.dispose(); return; }
      view3d = v; render();
    }).catch(function () { mounting = false; webgl = false; render(); });
  }

  function moveTargets() {
    if (!st || st.result || st.pending || st.phase !== "act") return {};
    var out = {};
    Core.moveTargets(st, st.cur).forEach(function (x) { out[x.room] = x.dist; });
    return out;
  }
  function onRoomClick(id) {
    var mt = moveTargets();
    if (mt[id]) act({ t: "move", to: id });
  }
  function focusRoom() {
    var p = st.pending;
    if (p && p.kind === "event") return p.room || st.members[p.who].room;
    var m = st.members[st.cur];
    return m ? m.room : null;
  }

  function renderTop() {
    var sg = D.STAGE_BY_ID[st.stage], tier = Core.tierOf(st), h = [];
    h.push('<div class="yo-top-l"><b class="yo-stage-name">' + esc(L(sg.name)) + '</b><span class="yo-clock">' + hourLabel(st.hourIdx) +
      (st.hourIdx === D.USHI_HOUR_INDEX ? ' <em>' + esc(t("yo_time_ushi")) + "</em>" : "") + "</span></div>");
    h.push('<div class="yo-hours">');
    D.HOURS.forEach(function (_, i) { h.push('<i class="' + (i < st.hourIdx ? "yo-past" : i === st.hourIdx ? "yo-now" : "") + (i === D.USHI_HOUR_INDEX ? " yo-ushi" : "") + '"></i>'); });
    h.push("</div>");
    h.push('<div class="yo-dread yo-tier' + tier + '"><span>' + esc(t("yo_dread")) + " " + st.dread + "</span><b>" + esc(t("yo_tier_" + tier)) + "</b></div>");
    h.push('<button class="yo-link yo-abandon" data-act="abandon">' + esc(t(ui.abandonArm ? "yo_abandon_sure" : "yo_abandon")) + "</button>");
    els.top.innerHTML = h.join("");
  }

  function renderViewbar() {
    var h = [];
    [0, 1].forEach(function (f) { h.push('<button class="yo-chip' + (ui.floor === f ? " yo-on" : "") + '" data-act="floor" data-f="' + f + '">' + esc(t("yo_floor_" + f)) + "</button>"); });
    if (webgl) h.push('<span class="yo-sp"></span><button class="yo-chip' + (ui.view === "3d" ? " yo-on" : "") + '" data-act="view" data-v="3d">' + esc(t("yo_view_3d")) +
      '</button><button class="yo-chip' + (ui.view === "2d" ? " yo-on" : "") + '" data-act="view" data-v="2d">' + esc(t("yo_view_2d")) + "</button>");
    h.push('<span class="yo-small yo-muted yo-hint">' + esc(webgl ? t("yo_view_hint") : t("yo_no_webgl")) + "</span>");
    els.viewbar.innerHTML = h.join("");
  }

  function renderMap() {
    var sg = D.STAGE_BY_ID[st.stage], mt = moveTargets(), fr = focusRoom(), h = [];
    [0, 1].forEach(function (f) {
      var rooms = sg.rooms.filter(function (r) { return r.f === f; });
      var w = 0, hh = 0; rooms.forEach(function (r) { w = Math.max(w, r.x + 1); hh = Math.max(hh, r.y + 1); });
      h.push('<div class="yo-floor' + (ui.floor === f ? " yo-on" : "") + '"><div class="yo-floor-name">' + esc(t("yo_floor_" + f)) + '</div><div class="yo-grid" style="grid-template-columns:repeat(' + w + ',1fr)">');
      for (var y = 0; y < hh; y++) for (var x = 0; x < w; x++) {
        var r = rooms.filter(function (q) { return q.x === x && q.y === y; })[0];
        if (!r) { h.push('<div class="yo-cell yo-void"></div>'); continue; }
        var cls = "yo-cell" + (mt[r.id] ? " yo-target" : "") + (r.kekkai ? " yo-kekkai" : "") + (!st.decks[r.id].length ? " yo-empty" : "") + (fr === r.id && st.pending ? " yo-haunt" : "");
        h.push('<button class="' + cls + '" data-act="room" data-room="' + r.id + '"><b>' + esc(L(r.name)) + "</b><span class=\"yo-feat\">" +
          (r.mirror ? "🪞" : "") + (r.water ? "💧" : "") + (r.kekkai ? "⛩" : "") + (st.decks[r.id].length ? "・" + st.decks[r.id].length : "") + '</span><span class="yo-tokens">');
        st.members.forEach(function (m, i) {
          if (m.gone || m.room !== r.id) return;
          h.push('<i class="yo-token' + (i === st.cur && !st.pending ? " yo-cur" : "") + (m.down ? " yo-downed" : "") + '" style="--yo-c:#' + D.JOB_BY_ID[m.job].color.toString(16) + '">' + esc(memberName(i).slice(0, 1)) + "</i>");
        });
        h.push("</span></button>");
      }
      h.push("</div></div>");
    });
    els.map.innerHTML = h.join("");
  }

  function bar(v, max, cls) {
    var h = '<span class="yo-bar ' + cls + '">';
    for (var i = 0; i < max; i++) h += '<i class="' + (i < v ? "yo-full" : "") + '"></i>';
    return h + "</span>";
  }

  function renderSide() {
    var h = [];
    h.push('<div class="yo-members">');
    st.members.forEach(function (m, i) {
      var job = D.JOB_BY_ID[m.job], cur = i === st.cur && st.phase === "act" && !st.pending;
      var items = [];
      D.ITEMS.forEach(function (it) { if (m.items[it.id]) items.push(L(it.name) + "×" + m.items[it.id]); });
      h.push('<div class="yo-member' + (cur ? " yo-cur" : "") + (m.gone ? " yo-gone" : "") + (m.down ? " yo-downed" : "") + '" style="--yo-c:#' + job.color.toString(16) + '">' +
        '<div class="yo-member-head"><i class="yo-dot"></i><b>' + esc(memberName(i)) + "</b>" + (m.name ? '<span class="yo-small yo-muted">' + esc(L(job.name)) + "</span>" : "") +
        (m.gone ? '<em class="yo-tag-bad">' + esc(t("yo_gone")) + "</em>" : m.down ? '<em class="yo-tag-bad">' + esc(t("yo_down")) + "</em>" : "") + "</div>" +
        '<div class="yo-stats"><span>' + esc(t("yo_hp")) + "</span>" + bar(m.hp, m.maxHp, "yo-hpbar") + "<span>" + esc(t("yo_nerve")) + "</span>" + bar(m.nerve, m.maxNerve, "yo-nervebar") + "</div>" +
        '<div class="yo-small yo-muted">' + esc(roomName(m.room)) + (items.length ? "・" + esc(items.join("　")) : "") + (m.usedSkill ? "・" + esc(t("yo_skill_used")) : "") + "</div></div>");
    });
    h.push("</div>");
    h.push('<div class="yo-actions" id="yo-actions">' + actionsHtml() + "</div>");
    els.side.innerHTML = h.join("");
  }

  function btn(label, attrs, disabled, cls) {
    return '<button class="yo-btn' + (cls ? " " + cls : "") + '" ' + attrs + (disabled ? " disabled" : "") + ">" + esc(label) + "</button>";
  }

  function actionsHtml() {
    if (st.result || st.pending || st.phase !== "act") return "";
    var mi = st.cur, m = st.members[mi], r = Core.room(st, m.room), h = [];
    h.push('<div class="yo-turn"><b>' + esc(t("yo_turn", { name: memberName(mi) })) + '</b><span class="yo-ap">' + bar(st.ap, st.apPer, "yo-apbar") + "</span></div>");
    var feats = [];
    if (r.mirror) feats.push(t("yo_feat_mirror"));
    if (r.water) feats.push(t("yo_feat_water"));
    if (r.kekkai) feats.push(t("yo_feat_kekkai"));
    var left = st.decks[m.room].length;
    h.push('<div class="yo-here">' + esc(t("yo_here", { room: L(r.name) })) + (feats.length ? ' <span class="yo-feats">' + esc(feats.join("・")) + "</span>" : "") +
      '<span class="yo-small yo-muted">　' + esc(left ? t("yo_cards_left", { n: left }) : t("yo_cards_none")) + "</span></div>");
    if (ui.err) h.push('<div class="yo-err">' + esc(ui.err) + "</div>");

    h.push('<div class="yo-row"><span class="yo-label">' + esc(t("yo_move")) + "</span>");
    Core.moveTargets(st, mi).forEach(function (x) {
      h.push(btn(t("yo_move_to", { room: roomName(x.room) }) + (x.dist > 1 ? t("yo_move_run") : ""), 'data-act="move" data-room="' + x.room + '"', false, "yo-small-btn"));
    });
    h.push("</div><div class=\"yo-row\">");
    h.push(btn(t("yo_search"), 'data-act="search"', !left, "yo-primary"));
    if (m.job === "reporter") h.push(btn(t("yo_interview"), 'data-act="interview"', !left));
    h.push(btn(t("yo_rest_hp"), 'data-act="rest" data-stat="hp"', m.hp >= m.maxHp));
    h.push(btn(t("yo_rest_nerve"), 'data-act="rest" data-stat="nerve"', m.nerve >= m.maxNerve));
    if (m.job === "taoist" && !m.usedSkill) h.push(btn(t("yo_divine"), 'data-act="open" data-modal="divine"'));
    h.push("</div>");
    var here = Core.membersIn(st, m.room);
    if (m.items.charm > 0) {
      h.push('<div class="yo-row"><span class="yo-label">' + esc(t("yo_ritual")) + "</span>");
      here.forEach(function (i) { h.push(btn(memberName(i), 'data-act="ritual" data-i="' + i + '"', st.members[i].nerve >= st.members[i].maxNerve, "yo-small-btn")); });
      h.push("</div>");
    }
    var downs = here.filter(function (i) { return st.members[i].down; });
    if (downs.length) {
      h.push('<div class="yo-row"><span class="yo-label">' + esc(t("yo_lift")) + "</span>");
      downs.forEach(function (i) { h.push(btn(memberName(i), 'data-act="lift" data-i="' + i + '"', false, "yo-small-btn")); });
      h.push("</div>");
    }
    var k = Core.kekkaiRoom(st);
    if (m.room === k.id && Core.accuseReady(st)) h.push('<div class="yo-row">' + btn(t("yo_accuse"), 'data-act="open" data-modal="accuse"', false, "yo-accuse-btn") + "</div>");
    else h.push('<div class="yo-small yo-muted">' + esc(t("yo_accuse_wait", { room: L(k.name) })) + "</div>");
    h.push('<div class="yo-row yo-end">' + btn(t("yo_pass"), 'data-act="pass"') + "</div>");
    return h.join("");
  }

  function renderBook() {
    var h = [];
    h.push('<div class="yo-panel"><h2>' + esc(t("yo_taboos")) + '</h2><div class="yo-taboos">');
    D.TABOOS.forEach(function (tb) {
      var s = tabooState(tb.id);
      h.push('<span class="yo-taboo' + (s === "yes" ? " yo-yes" : s === "no" ? " yo-no" : "") + '" title="' + esc(t(s === "yes" ? "yo_taboo_yes" : s === "no" ? "yo_taboo_no" : "yo_taboo_unknown")) + '">' + esc(L(tb.name)) + "</span>");
    });
    h.push("</div></div>");

    var cand = {}; Core.candidates(st).forEach(function (c) { cand[c.id] = c; });
    var foundTags = {};
    st.clues.forEach(function (c) { if (c.k === "tag" && !(c.seer && c.fake)) foundTags[c.tag] = 1; });
    h.push('<div class="yo-panel"><h2>' + esc(t("yo_kaii")) + '</h2><div class="yo-kaii-list">');
    D.KAII.forEach(function (k) {
      var c = cand[k.id], out = c.contradicted || ui.marks[k.id];
      h.push('<div class="yo-kaii' + (out ? " yo-out" : "") + '"><div class="yo-kaii-head"><b>' + esc(L(k.name)) + '</b><span class="yo-small yo-muted">' +
        esc(c.contradicted ? t("yo_kaii_ruled_out") : t("yo_kaii_hits", { n: c.tagHits })) + "</span>" +
        '<button class="yo-link" data-act="mark" data-id="' + k.id + '">' + (ui.marks[k.id] ? "↺" : "✕") + "</button></div><div>");
      k.tags.forEach(function (tg) { h.push('<span class="yo-chip-s' + (foundTags[tg] ? " yo-hit" : "") + '">' + esc(L(D.TAG_BY_ID[tg].name)) + "</span>"); });
      h.push('</div><div class="yo-small">');
      h.push(k.taboos.map(function (tb) { var s = tabooState(tb); return '<span class="' + (s === "yes" ? "yo-good" : s === "no" ? "yo-bad" : "") + '">' + esc(L(D.TABOO_BY_ID[tb].name)) + "</span>"; }).join("・"));
      h.push("</div></div>");
    });
    h.push("</div></div>");

    h.push('<div class="yo-panel"><h2>' + esc(t("yo_clues")) + "</h2>");
    if (!st.clues.length) h.push('<p class="yo-muted">' + esc(t("yo_no_clues")) + "</p>");
    else {
      h.push('<ul class="yo-clues">');
      st.clues.forEach(function (c) {
        var mark = c.k === "taboo" ? t("yo_clue_taboo") : c.seer ? (c.fake ? t("yo_clue_fake") : t("yo_clue_true")) : "";
        h.push('<li class="' + (c.seer && c.fake ? "yo-fake" : "") + '"><span class="yo-small yo-muted">' + hourLabel(c.h) + "・" + esc(memberName(c.by)) + "</span> " + esc(cardText(c)) +
          (mark ? ' <em class="yo-mark">' + esc(mark) + "</em>" : "") + "</li>");
      });
      h.push("</ul>");
    }
    h.push("</div>");

    h.push('<div class="yo-panel yo-logp"><h2>' + esc(t("yo_log")) + '</h2><div class="yo-log" id="yo-log">');
    st.log.slice(-60).forEach(function (e) { h.push('<div class="' + (e.k === "yo_log_hour" ? "yo-log-hour" : /taboo|vanish|down|rampage|wipe/.test(e.k) ? "yo-log-bad" : "") + '">' + esc(logText(e)) + "</div>"); });
    h.push("</div></div>");
    els.book.innerHTML = h.join("");
    var lg = document.getElementById("yo-log"); if (lg) lg.scrollTop = lg.scrollHeight;
  }

  // ---------------- 對話框 ----------------
  function modalHtml() {
    if (st.result) return endHtml();
    var p = st.pending;
    if (p && p.kind === "event") return eventHtml(p);
    if (p && p.kind === "offering") {
      return box(t("yo_offering_title"), "<p>" + esc(t("yo_offering_text", { name: memberName(p.who) })) + "</p>" +
        '<div class="yo-opts">' + btn(t("yo_eat"), 'data-act="choose" data-opt="eat"') + btn(t("yo_leave"), 'data-act="choose" data-opt="leave"') + "</div>", "yo-offering");
    }
    if (p && p.kind === "pick") {
      return box(t("yo_pick_title"), '<div class="yo-opts">' + p.cards.map(function (c, i) { return btn(cardText(c), 'data-act="choose" data-opt="' + i + '"', false, "yo-opt"); }).join("") +
        '</div><p class="yo-small yo-muted">' + esc(t("yo_pick_hint")) + "</p>");
    }
    if (ui.modal === "divine") {
      return box(t("yo_divine_title"), '<div class="yo-opts yo-grid-opts">' + D.TABOOS.map(function (tb) {
        return btn(L(tb.name), 'data-act="divine" data-id="' + tb.id + '"', !!tabooState(tb.id));
      }).join("") + "</div>" + '<div class="yo-row yo-end">' + btn(t("yo_cancel"), 'data-act="close"') + "</div>");
    }
    if (ui.modal === "accuse") return accuseHtml();
    return "";
  }
  function box(title, inner, cls) {
    return '<div class="yo-modal' + (cls ? " " + cls : "") + '"><div class="yo-modal-card"><h2>' + esc(title) + "</h2>" + inner + "</div></div>";
  }

  function eventHtml(p) {
    var ev = D.EVENT_BY_ID[p.ev], opts = Core.eventOptions(st), h = [];
    var text = L(ev.text).replace("{who}", p.who != null ? memberName(p.who) : "").replace("{room}", p.room ? roomName(p.room) : "");
    h.push('<p class="yo-ev-text">' + esc(text) + "</p>");
    if (p.who != null) h.push('<p class="yo-small yo-muted">' + esc(t("yo_event_target", { name: memberName(p.who) })) + "</p>");
    h.push('<div class="yo-opts">');
    opts.forEach(function (o) {
      var label, sub = "";
      if (o === "ok") { label = t("yo_opt_ok"); sub = t(ev.hit === "hp" ? "yo_opt_cost_hp" : "yo_opt_cost_nerve", { n: p.tier }); }
      else if (o === "risk") {
        label = L(ev.risk.label);
        sub = t("yo_opt_risk") + (ev.risk.gain === "clue" ? "／" + t("yo_opt_gain_clue") : ev.risk.gain ? "／" + t("yo_opt_gain_" + ev.risk.gain, { n: p.tier }) : "");
        var s = tabooState(ev.risk.taboo);
        if (s) sub += "（" + L(D.TABOO_BY_ID[ev.risk.taboo].name) + "：" + t(s === "yes" ? "yo_taboo_yes" : "yo_taboo_no") + "）";
      } else if (o === "safe") { label = L(ev.safe.label); sub = ev.safe.stat === "none" ? t("yo_opt_cost_none") : t("yo_opt_cost_" + ev.safe.stat, { n: p.tier }); }
      else if (o === "charm") { label = t("yo_opt_charm"); sub = L(D.ITEM_BY_ID.charm.name) + " −1"; }
      else if (o === "battery") { label = t("yo_opt_battery"); sub = L(D.ITEM_BY_ID.battery.name) + " −1"; }
      h.push('<button class="yo-btn yo-opt yo-opt-' + o + '" data-act="choose" data-opt="' + o + '"><b>' + esc(label) + "</b><span>" + esc(sub) + "</span></button>");
    });
    var pi = Core.purifier(st);
    if (pi >= 0) h.push('<button class="yo-btn yo-opt yo-opt-purify" data-act="purify"><b>' + esc(t("yo_purify", { name: memberName(pi) })) + "</b></button>");
    h.push("</div>");
    return box(t("yo_event", { tier: t("yo_tier_" + p.tier) }), h.join(""), "yo-event yo-tier" + p.tier);
  }

  function accuseHtml() {
    var cand = {}; Core.candidates(st).forEach(function (c) { cand[c.id] = c; });
    var h = ['<h3>' + esc(t("yo_accuse_kaii")) + '</h3><div class="yo-opts yo-grid-opts">'];
    D.KAII.forEach(function (k) {
      h.push('<button class="yo-btn yo-pickable' + (ui.sel.kaii === k.id ? " yo-on" : "") + (cand[k.id].contradicted || ui.marks[k.id] ? " yo-dim" : "") + '" data-act="sel-kaii" data-id="' + k.id + '">' + esc(L(k.name)) + "</button>");
    });
    h.push("</div><h3>" + esc(t("yo_accuse_taboos", { need: Core.ACCUSE_NEED })) + '</h3><div class="yo-opts yo-grid-opts">');
    D.TABOOS.forEach(function (tb) {
      var on = ui.sel.taboos.indexOf(tb.id) >= 0;
      h.push('<button class="yo-btn yo-pickable' + (on ? " yo-on" : "") + (tabooState(tb.id) === "no" ? " yo-dim" : "") + '" data-act="sel-taboo" data-id="' + tb.id + '">' + esc(L(tb.name)) + "</button>");
    });
    var ready = ui.sel.kaii && ui.sel.taboos.length === 3;
    h.push('</div><p class="yo-small yo-warn">' + esc(t("yo_accuse_warn")) + '</p><div class="yo-row yo-end">' + btn(t("yo_cancel"), 'data-act="close"') +
      btn(t("yo_accuse_go"), 'data-act="accuse"', !ready, "yo-accuse-btn") + "</div>");
    return box(t("yo_accuse_title"), h.join(""), "yo-accuse");
  }

  function endHtml() {
    var k = D.KAII_BY_ID[st.kaii], alive = st.members.filter(function (m) { return !m.gone; }).length, h = [];
    h.push('<p class="yo-end-text">' + esc(t("yo_result_" + st.result + "_text")) + "</p>");
    h.push('<p class="yo-small">' + esc(t("yo_survivors", { n: alive, total: st.members.length })) + "</p>");
    h.push('<div class="yo-truth"><h3>' + esc(t("yo_truth")) + "：" + esc(L(k.name)) + "</h3><p>" + esc(L(k.lore)) + "</p>" +
      "<p><b>" + esc(t("yo_truth_taboos")) + "</b>：" + esc(k.taboos.map(function (x) { return L(D.TABOO_BY_ID[x].name); }).join("・")) + "</p>" +
      "<p><b>" + esc(t("yo_truth_tags")) + "</b>：" + esc(k.tags.map(function (x) { return L(D.TAG_BY_ID[x].name); }).join("・")) + "</p></div>");
    if (st.clues.length) {
      h.push('<ul class="yo-clues">');
      st.clues.forEach(function (c) { h.push('<li class="' + (c.fake ? "yo-fake" : "") + '">' + esc(cardText(c)) + ' <em class="yo-mark">' + esc(c.fake ? t("yo_clue_fake") : t("yo_clue_true")) + "</em></li>"); });
      h.push("</ul>");
    }
    h.push('<div class="yo-row yo-end">' + btn(t("yo_again"), 'data-act="again"', false, "yo-primary") + "</div>");
    return box(t("yo_result_" + st.result), h.join(""), "yo-result yo-result-" + st.result);
  }

  // ---------------- 主繪製 ----------------
  function render() {
    if (!st) { renderSetup(); return; }
    if (!els) buildGameShell();
    // 輪到不同人、或事件發生時，自動切到那個房間的樓層
    var key = st.pending ? "p" + st.hourIdx + (st.pending.kind) : "c" + st.cur + ":" + st.hourIdx;
    if (key !== ui.lastCur) {
      ui.lastCur = key;
      var fr = focusRoom();
      if (fr) ui.floor = Core.room(st, fr).f;
    }
    renderTop();
    renderViewbar();
    ensureView();
    if (use3d()) {
      if (view3d) {
        var hl = {}, mt = moveTargets();
        Object.keys(mt).forEach(function (k) { hl[k] = true; });
        view3d.update(st, { floor: ui.floor, highlight: hl, current: st.pending ? -1 : st.cur, ghostRoom: st.pending && st.pending.kind === "event" ? focusRoom() : null });
      }
    } else renderMap();
    renderSide();
    renderBook();
    els.modal.innerHTML = modalHtml();
  }

  // ---------------- 事件處理 ----------------
  app.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b || b.disabled || !app.contains(b)) return;
    var a = b.getAttribute("data-act"), id = b.getAttribute("data-id"), i = Number(b.getAttribute("data-i"));
    if (a !== "abandon") ui.abandonArm = false;
    switch (a) {
      case "stage": setup.stage = id; savePref(); render(); break;
      case "seat-job": setup.seats[i].job = id; savePref(); render(); break;
      case "seat-del": setup.seats.splice(i, 1); savePref(); render(); break;
      case "seat-add": if (setup.seats.length < 4) setup.seats.push({ job: D.JOBS[setup.seats.length % D.JOBS.length].id, name: "" }); savePref(); render(); break;
      case "start":
        st = Core.create({ stage: setup.stage === "random" ? null : setup.stage, members: setup.seats.map(function (s) { return { job: s.job, name: s.name.trim() }; }) });
        ui.marks = {}; ui.modal = null; ui.err = ""; ui.lastCur = null;
        save(); render(); break;
      case "continue": {
        var sv = load(SAVE_KEY);
        if (sv && sv.st) { st = sv.st; ui.marks = sv.marks || {}; ui.lastCur = null; render(); }
        break;
      }
      case "again": destroyView(); st = null; els = null; store(SAVE_KEY, null); render(); break;
      case "abandon":
        if (!ui.abandonArm) { ui.abandonArm = true; render(); break; }
        ui.abandonArm = false; destroyView(); st = null; els = null; store(SAVE_KEY, null); render(); break;
      case "floor": ui.floor = Number(b.getAttribute("data-f")); render(); break;
      case "view": ui.view = b.getAttribute("data-v"); savePref(); render(); break;
      case "room": onRoomClick(b.getAttribute("data-room")); break;
      case "move": act({ t: "move", to: b.getAttribute("data-room") }); break;
      case "search": act({ t: "search" }); break;
      case "interview": act({ t: "interview" }); break;
      case "rest": act({ t: "rest", stat: b.getAttribute("data-stat") }); break;
      case "ritual": act({ t: "ritual", target: i }); break;
      case "lift": act({ t: "lift", target: i }); break;
      case "pass": act({ t: "pass" }); break;
      case "divine": act({ t: "divine", taboo: id }); break;
      case "choose": { var o = b.getAttribute("data-opt"); act({ t: "choose", opt: /^\d$/.test(o) ? Number(o) : o }); break; }
      case "purify": act({ t: "purify" }); break;
      case "open": ui.modal = b.getAttribute("data-modal"); ui.sel = { kaii: null, taboos: [] }; render(); break;
      case "close": ui.modal = null; render(); break;
      case "mark": ui.marks[id] = !ui.marks[id]; save(); render(); break;
      case "sel-kaii": ui.sel.kaii = id; render(); break;
      case "sel-taboo": {
        var at = ui.sel.taboos.indexOf(id);
        if (at >= 0) ui.sel.taboos.splice(at, 1); else if (ui.sel.taboos.length < 3) ui.sel.taboos.push(id);
        render(); break;
      }
      case "accuse": act({ t: "accuse", kaii: ui.sel.kaii, taboos: ui.sel.taboos.slice() }); break;
    }
  });
  app.addEventListener("input", function (e) {
    var el = e.target;
    if (el.getAttribute && el.getAttribute("data-act") === "seat-name") { setup.seats[Number(el.getAttribute("data-i"))].name = el.value; savePref(); }
  });
  window.addEventListener("i18n:change", function () { render(); });

  // 測試／除錯用
  window.PriTestYoi = { state: function () { return st; }, act: function (a) { act(a); return st; } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
