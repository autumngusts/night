// 百鬼轉珠（tama）：畫面（首頁、關卡選擇、隊伍編成、角色一覽、說明、戰鬥、結算）與本機存檔。
// 規則全部交給 tama_core.js；盤面繪製與轉珠操作交給 tama_board.js；妖怪圖交給 tama_art.js。
(function () {
  "use strict";

  var D = window.PriTestTamaData, Core = window.PriTestTamaCore, Board = window.PriTestTamaBoard, Art = window.PriTestTamaArt;
  var app = document.getElementById("tm-app");
  if (!D || !Core || !Board || !Art || !app) return;

  var SAVE_KEY = "pritest-tama-save-v1";
  var IMG = app.getAttribute("data-img") || "../static/images/jikan/";

  function t(k, p) { return window.I18N ? window.I18N.t(k, p) : k; }
  function lang() { return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || "zh"; }
  function L(o) { return o ? (o[lang()] || o.zh || "") : ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load() { try { var s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

  function newSave() {
    var roster = {};
    D.STARTERS.forEach(function (id) { roster[id] = { lv: 1, exp: 0 }; });
    return { v: 1, roster: roster, team: D.STARTERS.slice(), cleared: {} };
  }
  var save = load();
  if (!save || save.v !== 1 || !save.roster) save = newSave();

  var ui = { screen: "home", chapter: "c1", slot: 0, modal: null };
  var bt = null;   // 戰鬥中的執行期狀態

  // ---------------- 文字 ----------------
  function attrName(a) { return t("tm_attr_" + a); }
  function orbName(o) { return t("tm_orb_" + o); }
  function pct(p) { return Math.round(p * 100); }
  function lsText(ls) {
    return ls.map(function (s) {
      switch (s.t) {
        case "atk": return t("tm_ls_atk", { attr: attrName(s.attr), m: s.m });
        case "hp": return t("tm_ls_hp", { m: s.m });
        case "combo": return s.attr ? t("tm_ls_combo_attr", { min: s.min, attr: attrName(s.attr), m: s.m }) : t("tm_ls_combo_all", { min: s.min, m: s.m });
        case "time": return t("tm_ls_time", { s: s.s });
        case "regen": return t("tm_ls_regen", { p: pct(s.p) });
        case "guard": return t("tm_ls_guard", { p: pct(s.p) });
      }
      return "";
    }).join(t("tm_sep"));
  }
  function asText(s, hero) {
    switch (s.t) {
      case "convert": return t("tm_as_convert", { from: orbName(s.from), to: orbName(s.to) });
      case "delay": return t("tm_as_delay", { n: s.n });
      case "nuke": return t("tm_as_nuke", { m: s.m, attr: attrName(hero.attr) });
      case "buff": return t("tm_as_buff", { attr: attrName(s.attr), m: s.m, turns: s.turns });
      case "heal": return t("tm_as_heal", { p: pct(s.p) });
      case "time": return t("tm_as_time", { s: s.s, turns: s.turns });
      case "jamheal": return t("tm_as_jamheal", { p: pct(s.p) });
      case "refresh": return t("tm_as_refresh");
      case "shield": return t("tm_as_shield", { p: pct(s.p), turns: s.turns });
    }
    return "";
  }
  function stars(n) { return new Array(n + 1).join("★"); }
  function portrait(hero, cls) {
    return '<span class="tm-face tm-a-' + hero.attr + (cls ? " " + cls : "") + '"><img src="' + IMG + hero.img + '.webp" alt="" loading="lazy" draggable="false"></span>';
  }
  function owned(id) { return !!save.roster[id]; }
  function stageUnlocked(id) {
    var i = D.STAGE_ORDER.indexOf(id);
    return i === 0 || !!save.cleared[D.STAGE_ORDER[i - 1]];
  }
  function clearedCount() { return D.STAGE_ORDER.filter(function (id) { return save.cleared[id]; }).length; }

  // ---------------- 共用外框 ----------------
  function topbar(title, back) {
    return '<div class="tm-topbar">' + (back ? '<button type="button" class="tm-back" data-act="' + back + '">‹ ' + esc(t("tm_back")) + "</button>" : "<span></span>") +
      '<h2 class="tm-h2">' + esc(title) + "</h2><span></span></div>";
  }

  function render() {
    if (ui.screen === "battle") { renderBattleAll(); return; }
    var html = "";
    if (ui.screen === "home") html = homeHTML();
    else if (ui.screen === "stages") html = stagesHTML();
    else if (ui.screen === "team") html = teamHTML();
    else if (ui.screen === "roster") html = rosterHTML();
    else if (ui.screen === "rules") html = rulesHTML();
    app.innerHTML = '<div class="tm-wrap">' + html + modalHTML() + "</div>";
  }

  // ---------------- 首頁 ----------------
  function homeHTML() {
    var leader = D.HERO_BY_ID[save.team[0]];
    var faces = save.team.map(function (id) { return portrait(D.HERO_BY_ID[id], "tm-face-sm"); }).join("");
    return '<div class="tm-home">' +
      '<div class="tm-logo"><div class="tm-logo-main">' + esc(t("tm_title")) + '</div><div class="tm-logo-sub">' + esc(t("tm_tagline")) + "</div></div>" +
      '<div class="tm-home-leader">' + portrait(leader, "tm-face-xl") + '<div class="tm-home-team">' + faces + "</div></div>" +
      '<div class="tm-home-stat">' + esc(t("tm_progress", { c: clearedCount(), cn: D.STAGE_ORDER.length, h: Object.keys(save.roster).length, hn: D.HEROES.length })) + "</div>" +
      '<div class="tm-menu">' +
      '<button type="button" class="tm-btn tm-btn-main" data-act="go-stages">' + esc(t("tm_menu_play")) + "</button>" +
      '<button type="button" class="tm-btn" data-act="go-team">' + esc(t("tm_menu_team")) + "</button>" +
      '<button type="button" class="tm-btn" data-act="go-roster">' + esc(t("tm_menu_roster")) + "</button>" +
      '<button type="button" class="tm-btn" data-act="go-rules">' + esc(t("tm_menu_rules")) + "</button>" +
      "</div>" +
      '<button type="button" class="tm-link" data-act="reset">' + esc(t("tm_reset")) + "</button>" +
      "</div>";
  }

  // ---------------- 關卡選擇 ----------------
  function stagesHTML() {
    var tabs = D.CHAPTERS.map(function (c) {
      return '<button type="button" class="tm-tab' + (ui.chapter === c.id ? " tm-tab-on" : "") + '" data-act="chapter" data-id="' + c.id + '">' + esc(L(c.name)) + "</button>";
    }).join("");
    var ch = D.CHAPTERS.filter(function (c) { return c.id === ui.chapter; })[0];
    var list = ch.stages.map(function (s) {
      var open = stageUnlocked(s.id), done = !!save.cleared[s.id];
      var foes = {};
      s.waves.forEach(function (w) { w.forEach(function (k) { foes[k] = 1; }); });
      var icons = Object.keys(foes).map(function (k) { return '<span class="tm-mini tm-a-' + D.ENEMIES[k].attr + '">' + Art.enemy(k) + "</span>"; }).join("");
      var rec = s.recruit.map(function (id) { return portrait(D.HERO_BY_ID[id], "tm-face-xs" + (done ? "" : " tm-face-new")); }).join("");
      return '<button type="button" class="tm-stage' + (open ? "" : " tm-locked") + (done ? " tm-done" : "") + '" data-act="stage" data-id="' + s.id + '"' + (open ? "" : " disabled") + ">" +
        '<span class="tm-stage-id">' + s.id + (done ? ' <span class="tm-check">✔</span>' : "") + "</span>" +
        '<span class="tm-stage-foes">' + icons + "</span>" +
        '<span class="tm-stage-meta">' + esc(t("tm_waves", { n: s.waves.length })) + " · EXP " + s.exp + "</span>" +
        '<span class="tm-stage-rec"><span class="tm-small">' + esc(done ? t("tm_recruited") : t("tm_recruit")) + "</span>" + rec + "</span>" +
        (open ? "" : '<span class="tm-lock">🔒</span>') +
        "</button>";
    }).join("");
    var team = save.team.map(function (id) { return portrait(D.HERO_BY_ID[id], "tm-face-xs"); }).join("");
    return topbar(t("tm_menu_play"), "go-home") +
      '<div class="tm-tabs">' + tabs + "</div>" +
      '<div class="tm-stages tm-bg-' + ch.bg + '">' + list + "</div>" +
      '<div class="tm-stage-team"><span class="tm-small">' + esc(t("tm_cur_team")) + "</span>" + team +
      '<button type="button" class="tm-link" data-act="go-team">' + esc(t("tm_menu_team")) + "</button></div>";
  }

  // ---------------- 隊伍編成 ----------------
  function teamHTML() {
    var slots = save.team.map(function (id, i) {
      var h = D.HERO_BY_ID[id];
      return '<button type="button" class="tm-slot' + (ui.slot === i ? " tm-slot-on" : "") + '" data-act="slot" data-i="' + i + '">' +
        portrait(h, "tm-face-md") + '<span class="tm-slot-lv">Lv' + save.roster[id].lv + "</span>" +
        (i === 0 ? '<span class="tm-slot-leader">' + esc(t("tm_leader")) + "</span>" : "") + "</button>";
    }).join("");
    var leader = D.HERO_BY_ID[save.team[0]];
    var stats = teamStats();
    var pool = D.HEROES.filter(function (h) { return owned(h.id); }).map(function (h) {
      var inTeam = save.team.indexOf(h.id);
      return '<button type="button" class="tm-pick' + (inTeam >= 0 ? " tm-pick-in" : "") + '" data-act="pick" data-id="' + h.id + '">' +
        portrait(h, "tm-face-sm") + '<span class="tm-pick-lv">Lv' + save.roster[h.id].lv + "</span>" +
        (inTeam >= 0 ? '<span class="tm-pick-no">' + (inTeam + 1) + "</span>" : "") + "</button>";
    }).join("");
    return topbar(t("tm_menu_team"), "go-home") +
      '<div class="tm-slots">' + slots + "</div>" +
      '<div class="tm-team-info"><div><b>' + esc(t("tm_leader_skill")) + "</b> " + esc(L(leader.name)) + "：" + esc(lsText(leader.ls)) + "</div>" +
      '<div class="tm-small tm-muted">' + esc(t("tm_team_stats", stats)) + "</div>" +
      '<div class="tm-small tm-muted">' + esc(t("tm_team_hint")) + "</div></div>" +
      '<div class="tm-pool">' + pool + "</div>" +
      '<div class="tm-center"><button type="button" class="tm-btn tm-btn-main" data-act="go-stages">' + esc(t("tm_menu_play")) + "</button></div>";
  }
  function teamStats() {
    var st = Core.createBattle("1-1", save.team.map(function (id) { return { id: id, lv: save.roster[id].lv }; }), 1);
    return { hp: st.hpMax, rcv: st.rcvSum, time: (Core.moveTimeMs(st) / 1000).toFixed(1) };
  }

  // ---------------- 角色一覽 ----------------
  function whereRecruit(id) {
    for (var i = 0; i < D.STAGE_ORDER.length; i++) if (D.STAGE_BY_ID[D.STAGE_ORDER[i]].recruit.indexOf(id) >= 0) return D.STAGE_ORDER[i];
    return "";
  }
  function rosterHTML() {
    var cards = D.HEROES.map(function (h) {
      if (!owned(h.id)) {
        return '<div class="tm-card tm-card-lock">' + portrait(h, "tm-face-md tm-face-shadow") +
          '<span class="tm-card-name">？？？</span><span class="tm-small tm-muted">' + esc(t("tm_join_at", { s: whereRecruit(h.id) })) + "</span></div>";
      }
      return '<button type="button" class="tm-card" data-act="hero" data-id="' + h.id + '">' + portrait(h, "tm-face-md") +
        '<span class="tm-card-name">' + esc(L(h.name)) + '</span><span class="tm-small"><span class="tm-star">' + stars(h.rarity) + "</span> Lv" + save.roster[h.id].lv + "</span></button>";
    }).join("");
    return topbar(t("tm_menu_roster"), "go-home") +
      '<div class="tm-small tm-muted tm-center">' + esc(t("tm_roster_count", { n: Object.keys(save.roster).length, all: D.HEROES.length })) + "</div>" +
      '<div class="tm-cards">' + cards + "</div>";
  }
  function heroModalHTML(id) {
    var h = D.HERO_BY_ID[id], r = save.roster[id], s = Core.heroStats(id, r.lv);
    var next = r.lv >= D.MAX_LV ? "MAX" : r.exp + " / " + Core.expToNext(r.lv);
    return '<div class="tm-hero-detail">' + portrait(h, "tm-face-xl") +
      '<div class="tm-hero-name">' + esc(L(h.name)) + ' <span class="tm-attr-tag tm-a-' + h.attr + '">' + esc(attrName(h.attr)) + "</span></div>" +
      '<div class="tm-small tm-muted">' + esc(L(h.title)) + ' · <span class="tm-star">' + stars(h.rarity) + "</span></div>" +
      '<table class="tm-stat"><tr><th>Lv</th><td>' + r.lv + " / " + D.MAX_LV + "</td><th>EXP</th><td>" + next + "</td></tr>" +
      "<tr><th>" + esc(t("tm_hp")) + "</th><td>" + s.hp + "</td><th>" + esc(t("tm_atk")) + "</th><td>" + s.atk + "</td></tr>" +
      "<tr><th>" + esc(t("tm_rcv")) + "</th><td>" + s.rcv + "</td><th>CD</th><td>" + h.as.cd + "</td></tr></table>" +
      '<div class="tm-skill"><b>' + esc(t("tm_leader_skill")) + "</b><br>" + esc(lsText(h.ls)) + "</div>" +
      '<div class="tm-skill"><b>' + esc(t("tm_active_skill")) + "</b>（CD " + h.as.cd + "）<br>" + esc(asText(h.as, h)) + "</div>" +
      "</div>";
  }

  // ---------------- 說明 ----------------
  function rulesHTML() {
    var items = ["tm_rule_1", "tm_rule_2", "tm_rule_3", "tm_rule_4", "tm_rule_5", "tm_rule_6", "tm_rule_7"].map(function (k) { return "<li>" + esc(t(k)) + "</li>"; }).join("");
    var orbs = ["fire", "water", "wood", "light", "dark", "heart", "jam"].map(function (o) {
      var s = Board.ORB_STYLE[o];
      return '<span class="tm-orb-chip" style="background:radial-gradient(circle at 35% 30%,' + s.a + "," + s.b + " 60%," + s.c + ')">' + s.ch + "</span>";
    }).join("");
    return topbar(t("tm_menu_rules"), "go-home") +
      '<div class="tm-rules"><div class="tm-orb-row">' + orbs + "</div><ol>" + items + "</ol>" +
      '<p class="tm-small tm-muted">' + esc(t("tm_rule_adv")) + "</p></div>";
  }

  // ---------------- 對話框 ----------------
  function modalHTML() {
    if (!ui.modal) return "";
    var m = ui.modal, body = "", btns = "";
    if (m.kind === "hero") {
      body = heroModalHTML(m.id);
      btns = '<button type="button" class="tm-btn" data-act="close">' + esc(t("tm_close")) + "</button>";
    } else if (m.kind === "reset") {
      body = "<p>" + esc(t("tm_reset_confirm")) + "</p>";
      btns = '<button type="button" class="tm-btn tm-btn-danger" data-act="reset-yes">' + esc(t("tm_reset")) + '</button><button type="button" class="tm-btn" data-act="close">' + esc(t("tm_cancel")) + "</button>";
    } else if (m.kind === "skill") {
      var mem = bt.st.members[m.i], h = D.HERO_BY_ID[mem.id];
      body = '<div class="tm-skillpop">' + portrait(h, "tm-face-md") + "<div><b>" + esc(L(h.name)) + "</b><br>" + esc(asText(h.as, h)) +
        '<div class="tm-small tm-muted">' + esc(mem.cd > 0 ? t("tm_cd_left", { n: mem.cd }) : t("tm_ready")) + "</div></div></div>";
      btns = (mem.cd === 0 ? '<button type="button" class="tm-btn tm-btn-main" data-act="skill-use">' + esc(t("tm_use")) + "</button>" : "") +
        '<button type="button" class="tm-btn" data-act="close">' + esc(t("tm_cancel")) + "</button>";
    } else if (m.kind === "retreat") {
      body = "<p>" + esc(t("tm_retreat_confirm")) + "</p>";
      btns = '<button type="button" class="tm-btn tm-btn-danger" data-act="retreat-yes">' + esc(t("tm_retreat")) + '</button><button type="button" class="tm-btn" data-act="close">' + esc(t("tm_cancel")) + "</button>";
    } else if (m.kind === "result") {
      body = resultHTML(m);
      btns = m.win
        ? (m.next ? '<button type="button" class="tm-btn tm-btn-main" data-act="next-stage">' + esc(t("tm_next_stage")) + "</button>" : "") +
          '<button type="button" class="tm-btn" data-act="again">' + esc(t("tm_again")) + '</button><button type="button" class="tm-btn" data-act="to-stages">' + esc(t("tm_to_stages")) + "</button>"
        : '<button type="button" class="tm-btn tm-btn-main" data-act="again">' + esc(t("tm_retry")) + '</button><button type="button" class="tm-btn" data-act="to-stages">' + esc(t("tm_to_stages")) + "</button>";
    }
    return '<div class="tm-modal-bg"' + (m.kind === "result" ? "" : ' data-act="close"') + '><div class="tm-modal" data-stop="1">' + body + '<div class="tm-modal-btns">' + btns + "</div></div></div>";
  }
  function resultHTML(m) {
    if (!m.win) return '<div class="tm-result tm-result-lose"><div class="tm-result-title">' + esc(t("tm_lose")) + '</div><p class="tm-small">' + esc(t("tm_lose_hint")) + "</p></div>";
    var ups = m.ups.map(function (u) {
      var h = D.HERO_BY_ID[u.id];
      return '<div class="tm-up">' + portrait(h, "tm-face-xs") + "<span>" + esc(L(h.name)) + "</span><span>Lv" + u.lv + (u.n ? ' <b class="tm-good">↑' + u.n + "</b>" : "") + "</span></div>";
    }).join("");
    var news = m.recruits.map(function (id) {
      var h = D.HERO_BY_ID[id];
      return '<div class="tm-new">' + portrait(h, "tm-face-md") + "<div><b>" + esc(L(h.name)) + '</b> <span class="tm-star">' + stars(h.rarity) + '</span><br><span class="tm-small">' + esc(L(h.title)) + "</span></div></div>";
    }).join("");
    return '<div class="tm-result"><div class="tm-result-title">' + esc(t("tm_win")) + "</div>" +
      '<div class="tm-small">' + esc(t("tm_win_meta", { turns: m.turns, exp: m.exp })) + "</div>" +
      '<div class="tm-ups">' + ups + "</div>" +
      (news ? '<div class="tm-new-title">' + esc(t("tm_new_member")) + "</div>" + news : "") + "</div>";
  }

  // ---------------- 戰鬥 ----------------
  function startBattle(stageId) {
    if (bt && bt.board) bt.board.destroy();
    var team = save.team.map(function (id) { return { id: id, lv: save.roster[id].lv }; });
    var st = Core.createBattle(stageId, team);
    bt = { stageId: stageId, st: st, board: null, busy: false, viewHp: st.hp, view: cloneEnemies(st.enemies) };
    ui.screen = "battle";
    ui.modal = null;
    buildBattle();
  }
  function cloneEnemies(list) { return list.map(function (e) { return { key: e.key, hp: e.hp, hpMax: e.hpMax }; }); }

  function buildBattle() {
    var ch = D.CHAPTERS.filter(function (c) { return c.id === bt.st.stage.chapter; })[0];
    app.innerHTML = '<div class="tm-wrap tm-wrap-battle"><div class="tm-battle tm-bg-' + ch.bg + '">' +
      '<div class="tm-bt-top"><span class="tm-bt-stage" id="tm-bt-stage"></span><button type="button" class="tm-back" data-act="retreat">' + esc(t("tm_retreat")) + "</button></div>" +
      '<div class="tm-enemies" id="tm-enemies"></div>' +
      '<div class="tm-banner" id="tm-banner"></div>' +
      '<div class="tm-team" id="tm-team"></div>' +
      '<div class="tm-hp" id="tm-hp"><div class="tm-hp-fill" id="tm-hp-fill"></div><span class="tm-hp-text" id="tm-hp-text"></span></div>' +
      '<div class="tm-time"><div class="tm-time-fill" id="tm-time-fill"></div></div>' +
      '<div class="tm-board" id="tm-board"></div>' +
      '</div><div id="tm-modal-host"></div></div>';
    bt.board = Board.create(document.getElementById("tm-board"), {
      onRelease: onRelease,
      onTick: function (remain, limit) {
        var el = document.getElementById("tm-time-fill");
        if (el) el.style.width = (remain / limit * 100) + "%";
      }
    });
    bt.board.setBoard(bt.st.board);
    renderBattleAll();
    setReady(true);
  }

  function renderBattleAll() {
    if (!bt) return;
    var st = bt.st;
    var head = document.getElementById("tm-bt-stage");
    if (!head) { buildBattle(); return; }
    head.textContent = st.stage.id + " · " + t("tm_wave", { i: st.waveIdx + 1, n: st.stage.waves.length });
    renderEnemies();
    renderTeam();
    renderHp();
    var mh = document.getElementById("tm-modal-host");
    if (mh) mh.innerHTML = modalHTML();
  }

  function renderEnemies() {
    var st = bt.st, ti = Core.currentTarget(st);
    document.getElementById("tm-enemies").innerHTML = st.enemies.map(function (e, i) {
      var v = bt.view[i] || e, dead = v.hp <= 0, E = D.ENEMIES[e.key];
      return '<button type="button" class="tm-enemy tm-a-' + e.attr + (e.boss ? " tm-boss" : "") + (dead ? " tm-dead" : "") + (i === ti && st.target != null ? " tm-targeted" : "") + '" data-act="target" data-i="' + i + '" id="tm-e' + i + '">' +
        '<span class="tm-enemy-cd">' + esc(t("tm_enemy_cd", { n: e.cd })) + "</span>" +
        (st.target === i ? '<span class="tm-target-mark">▼</span>' : "") +
        '<span class="tm-enemy-art">' + Art.enemy(e.key) + "</span>" +
        '<span class="tm-enemy-name"><i class="tm-dot tm-a-' + e.attr + '"></i>' + esc(L(E.name)) + "</span>" +
        '<span class="tm-ebar"><span class="tm-ebar-fill" style="width:' + (v.hp / v.hpMax * 100) + '%"></span></span>' +
        "</button>";
    }).join("");
  }

  function renderTeam() {
    var st = bt.st;
    document.getElementById("tm-team").innerHTML = st.members.map(function (m, i) {
      var h = D.HERO_BY_ID[m.id];
      return '<button type="button" class="tm-mem' + (m.cd === 0 ? " tm-mem-ready" : "") + '" data-act="member" data-i="' + i + '" id="tm-m' + i + '">' +
        portrait(h, "tm-face-mem") +
        (m.cd > 0 ? '<span class="tm-mem-cd">' + m.cd + "</span>" : '<span class="tm-mem-go">' + esc(t("tm_skill_short")) + "</span>") +
        (i === 0 ? '<span class="tm-mem-lead">L</span>' : "") + "</button>";
    }).join("");
  }

  function renderHp() {
    var st = bt.st;
    var fill = document.getElementById("tm-hp-fill");
    if (!fill) return;
    var r = Math.max(0, bt.viewHp) / st.hpMax;
    fill.style.width = (r * 100) + "%";
    fill.className = "tm-hp-fill" + (r < 0.3 ? " tm-hp-low" : "");
    document.getElementById("tm-hp-text").textContent = Math.max(0, Math.round(bt.viewHp)) + " / " + st.hpMax;
  }

  function setReady(v) {
    bt.busy = !v;
    bt.board.setEnabled(v && !bt.st.over);
    if (v) bt.board.setTimeLimit(Core.moveTimeMs(bt.st));
  }

  function floatText(host, text, cls) {
    if (!host) return;
    var s = document.createElement("span");
    s.className = "tm-float " + (cls || "");
    s.textContent = text;
    host.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 1100);
  }
  function pulse(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms || 400);
  }
  function banner(text) {
    var b = document.getElementById("tm-banner");
    if (!b) return;
    b.textContent = text;
    pulse(b, "tm-banner-on", 1100);
  }

  function onRelease(moved) {
    if (!moved || bt.busy || bt.st.over) return;
    setReady(false);
    var st = bt.st;
    st.board = bt.board.getBoard();
    var res = Core.resolve(st.board, st.rng);
    bt.board.playResolve(res.steps, function () {
      st.board = res.board;
      bt.view = cloneEnemies(st.enemies);
      var events = Core.playerTurn(st, res.groups);
      playEvents(events, afterEvents);
    });
  }

  function afterEvents() {
    if (!bt) return;
    bt.viewHp = bt.st.hp;
    bt.view = cloneEnemies(bt.st.enemies);
    bt.board.setBoard(bt.st.board);
    renderBattleAll();
    if (bt.st.over) { finishBattle(bt.st.over === "win"); return; }
    setReady(true);
  }

  // 依序演出 core 回傳的事件
  function playEvents(events, done) {
    var i = 0;
    function step() {
      if (!bt) return;
      if (i >= events.length) { done(); return; }
      var ev = events[i++], wait = 0;
      switch (ev.t) {
        case "hit":
          var v = bt.view[ev.e];
          if (v) v.hp = Math.max(0, v.hp - ev.dmg);
          var eel = document.getElementById("tm-e" + ev.e);
          if (eel) {
            var bar = eel.querySelector(".tm-ebar-fill");
            if (bar && v) bar.style.width = (v.hp / v.hpMax * 100) + "%";
            pulse(eel, "tm-shake", 300);
            floatText(eel, ev.dmg, "tm-f-" + ev.attr + (ev.adv > 1 ? " tm-f-weak" : ev.adv < 1 ? " tm-f-resist" : ""));
          }
          if (ev.m != null) pulse(document.getElementById("tm-m" + ev.m), "tm-hop", 300);
          wait = 130;
          break;
        case "kill":
          var kel = document.getElementById("tm-e" + ev.e);
          if (kel) kel.classList.add("tm-dead");
          wait = 220;
          break;
        case "heal":
          bt.viewHp = Math.min(bt.st.hpMax, bt.viewHp + ev.amount);
          renderHp();
          floatText(document.getElementById("tm-hp"), "+" + ev.amount, "tm-f-heal");
          wait = 260;
          break;
        case "wave":
          bt.view = cloneEnemies(bt.st.enemies);
          renderEnemies();
          document.getElementById("tm-bt-stage").textContent = bt.st.stage.id + " · " + t("tm_wave", { i: ev.wave + 1, n: bt.st.stage.waves.length });
          banner(t("tm_wave", { i: ev.wave + 1, n: bt.st.stage.waves.length }) + (bt.st.enemies.some(function (e) { return e.boss; }) ? " · " + t("tm_boss") : ""));
          wait = 1000;
          break;
        case "jam":
          bt.board.setBoard(bt.st.board);
          bt.board.flash(ev.cells);
          banner(t("tm_jam"));
          wait = 500;
          break;
        case "attack":
          bt.viewHp = Math.max(0, bt.viewHp - ev.dmg);
          pulse(document.getElementById("tm-e" + ev.e), "tm-lunge", 400);
          pulse(app.querySelector(".tm-battle"), "tm-quake", 400);
          renderHp();
          floatText(document.getElementById("tm-hp"), "−" + ev.dmg, "tm-f-hurt" + (ev.kind === "heavy" ? " tm-f-weak" : ""));
          wait = 480;
          break;
        case "buff":
          banner(t("tm_buff_" + ev.kind));
          wait = 500;
          break;
        case "delay":
          banner(t("tm_delayed", { n: ev.n }));
          wait = 500;
          break;
        case "refresh":
          banner(t("tm_refreshed"));
          wait = 300;
          break;
        case "win":
        case "lose":
          wait = 500;
          break;
      }
      if (wait) setTimeout(step, wait); else step();
    }
    step();
  }

  function useSkill(i) {
    var st = bt.st;
    var before = cloneEnemies(st.enemies);
    var r = Core.useSkill(st, i);
    ui.modal = null;
    renderBattleAll();
    if (!r.ok) return;
    setReady(false);
    bt.view = before;
    renderEnemies();
    pulse(document.getElementById("tm-m" + i), "tm-hop", 300);
    var conv = r.events.filter(function (e) { return e.t === "convert"; })[0];
    function go() { playEvents(r.events, afterEvents); }
    if (r.board) {
      bt.board.setBoard(st.board);
      bt.board.flash(conv ? conv.cells : null, go);
    } else go();
  }

  function finishBattle(win) {
    var s = D.STAGE_BY_ID[bt.stageId], m = { kind: "result", win: win, turns: bt.st.turn, exp: s.exp, ups: [], recruits: [] };
    if (win) {
      save.team.forEach(function (id) {
        var n = Core.gainExp(save.roster[id], s.exp);
        m.ups.push({ id: id, lv: save.roster[id].lv, n: n });
      });
      if (!save.cleared[s.id]) {
        s.recruit.forEach(function (id) { if (!save.roster[id]) { save.roster[id] = { lv: 1, exp: 0 }; m.recruits.push(id); } });
      }
      save.cleared[s.id] = true;
      persist();
      var idx = D.STAGE_ORDER.indexOf(s.id);
      m.next = D.STAGE_ORDER[idx + 1] || null;
    }
    ui.modal = m;
    var mh = document.getElementById("tm-modal-host");
    if (mh) mh.innerHTML = modalHTML();
  }

  function leaveBattle(screen) {
    if (bt && bt.board) bt.board.destroy();
    if (bt) ui.chapter = bt.st.stage.chapter;
    bt = null;
    ui.modal = null;
    ui.screen = screen || "stages";
    render();
  }

  // ---------------- 操作 ----------------
  app.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el || !app.contains(el)) return;
    if (el.classList.contains("tm-modal-bg") && e.target.closest("[data-stop]")) return;
    var act = el.getAttribute("data-act");
    switch (act) {
      case "go-home": ui.screen = "home"; break;
      case "go-stages": ui.screen = "stages"; break;
      case "go-team": ui.screen = "team"; break;
      case "go-roster": ui.screen = "roster"; break;
      case "go-rules": ui.screen = "rules"; break;
      case "chapter": ui.chapter = el.getAttribute("data-id"); break;
      case "stage":
        var sid = el.getAttribute("data-id");
        if (stageUnlocked(sid)) { startBattle(sid); return; }
        break;
      case "slot": ui.slot = +el.getAttribute("data-i"); break;
      case "pick":
        var id = el.getAttribute("data-id"), at = save.team.indexOf(id);
        if (at === ui.slot) break;
        if (at >= 0) save.team[at] = save.team[ui.slot];
        save.team[ui.slot] = id;
        ui.slot = Math.min(4, ui.slot + 1);
        persist();
        break;
      case "hero": ui.modal = { kind: "hero", id: el.getAttribute("data-id") }; break;
      case "reset": ui.modal = { kind: "reset" }; break;
      case "reset-yes": save = newSave(); persist(); ui.modal = null; ui.screen = "home"; break;
      case "close":
        if (ui.modal && ui.modal.kind === "result") return;
        ui.modal = null;
        break;
      // 戰鬥
      case "target":
        if (!bt || bt.busy) return;
        Core.setTarget(bt.st, +el.getAttribute("data-i"));
        renderEnemies();
        return;
      case "member":
        if (!bt || bt.busy || bt.board.busy() || bt.st.over) return;
        ui.modal = { kind: "skill", i: +el.getAttribute("data-i") };
        break;
      case "skill-use": if (bt && ui.modal) { useSkill(ui.modal.i); return; } break;
      case "retreat": if (bt && !bt.busy) ui.modal = { kind: "retreat" }; break;
      case "retreat-yes": leaveBattle("stages"); return;
      case "again": startBattle(bt.stageId); return;
      case "next-stage": var nx = ui.modal && ui.modal.next; if (nx) { ui.chapter = D.STAGE_BY_ID[nx].chapter; startBattle(nx); } return;
      case "to-stages": leaveBattle("stages"); return;
      default: return;
    }
    render();
  });

  window.addEventListener("i18n:change", function () { render(); });
  render();

  // 測試用（Playwright 讀取狀態）
  window.PriTestTama = {
    state: function () { return { screen: ui.screen, save: save, battle: bt ? bt.st : null, busy: bt ? bt.busy : false }; },
    startBattle: startBattle,
    syncBoard: function () { if (bt) bt.board.setBoard(bt.st.board); }
  };
})();
