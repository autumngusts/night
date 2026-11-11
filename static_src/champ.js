// 冠軍教練（champ）：畫面。標題／選擇起始地區 → 每週總覽（隊伍、訓練、招募、聯賽、英雄、紀錄）
// → 比賽：BP（無懼選角）→ 戰術 → 賽前確認（選手數值與調子）→ 3D 關鍵會戰重播 → 結果。
// 規則在 champ_core.js；資料在 champ_data.js；3D 在 champ_3d.js。2026-11-11 依使用者需求新增。
(function () {
  "use strict";

  var D = window.PriTestChampData, Core = window.PriTestChampCore, V3 = window.PriTestChamp3D;
  var L = D.L;
  var app = document.getElementById("cc-app");
  if (!app) return;
  var IMG_BASE = app.getAttribute("data-img") || "../static/images/jikan/";

  var ui = { screen: "title", tab: "home", modal: null, flash: null, scene: null, roleFilter: "all", selHero: null, tactic: null,
    aiTimer: null, replay: null, lastGame: null, newRegion: "tw", leagueView: null, heroRole: "top", datePick: false, dateEv: null, story: null, quote: null, ff: null, preLines: null };

  function t(k, p) { return window.I18N ? window.I18N.t("cc_" + k, p) : k; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(k) { k = Math.round(k); return (k < 0 ? "-$" : "$") + (Math.abs(k) >= 1000 ? (Math.abs(k) / 1000).toFixed(2) + "M" : Math.abs(k) + "K"); }
  function photo(p) { return IMG_BASE + Core.photoFile(p.img) + ".webp"; }
  function S() { return Core.get(); }
  function roleName(r) { return L(D.ROLE[r].name); }
  function heroName(id) { return D.HERO[id] ? L(D.HERO[id].name) : "—"; }
  function condOf(v) { return D.COND[v + 2]; }
  function condBadge(p) { var c = condOf(p.cond); return '<span class="cc-cond cc-' + c.cls + '">' + c.icon + " " + esc(L(c.name)) + "</span>"; }
  function bar(v, cls) { return '<span class="cc-bar ' + (cls || "") + '"><i style="width:' + Math.round(Math.max(0, Math.min(100, v))) + '%"></i></span>'; }
  function grade(v) { return v >= 92 ? "S" : v >= 84 ? "A" : v >= 76 ? "B" : v >= 68 ? "C" : v >= 60 ? "D" : "E"; }
  function hearts(a) { var n = a >= 90 ? 4 : a >= 60 ? 3 : a >= 30 ? 2 : a >= 10 ? 1 : 0, s = ""; for (var i = 0; i < 4; i++) s += i < n ? "♥" : "♡"; return '<span class="cc-heart">' + s + "</span>"; }
  function metaBadge(id) { var m = Core.metaTier(id); return m === 2 ? '<span class="cc-meta cc-meta2">🔥T0</span>' : m === 1 ? '<span class="cc-meta cc-meta1">▲</span>' : m === -1 ? '<span class="cc-meta cc-metan">▼</span>' : ""; }
  function flagOf(rid) { var r = D.REGION[rid]; return '<span class="cc-reg">' + esc(r.abbr) + "</span>"; }

  function weekLabel() {
    var s = S(), w = Core.week();
    var y = t("year_n", { n: s.year });
    if (w.k === "pre") return y + "・" + t("wk_pre", { n: w.i + 1 });
    if (w.k === "league") return y + "・" + t("wk_league", { split: t("split_" + w.split), n: w.i + 1 });
    if (w.k === "po") return y + "・" + t("split_" + w.split) + t(w.i === 0 ? "wk_po_sf" : "wk_po_final");
    if (w.k === "break") return y + "・" + t("wk_break");
    if (w.k === "worlds") return y + "・" + (w.i < 3 ? t("wk_wgroup", { n: w.i + 1 }) : t(["wk_wqf", "wk_wsf", "wk_wfinal"][w.i - 3]));
    if (w.k === "msi") return y + "・" + t(["wk_mqf", "wk_msf", "wk_mfinal"][w.i]);
    return y + "・" + t("wk_off");
  }

  // ================= 全體繪製 =================
  function render() {
    if (ui.screen !== "replay" && ui.replay) { ui.replay.dispose(); ui.replay = null; }
    var h = "";
    if (ui.screen === "title") h = renderTitle();
    else if (ui.screen === "new") h = renderNew();
    else if (ui.screen === "hub") h = renderHub();
    else if (ui.screen === "draft") h = renderDraft();
    else if (ui.screen === "tactic") h = renderTactic();
    else if (ui.screen === "pre") h = renderPre();
    else if (ui.screen === "replay") h = renderReplayShell();
    else if (ui.screen === "result") h = renderResult();
    else if (ui.screen === "ff") h = renderFF();
    if (ui.modal) h += renderModal();
    // 對話類視窗一次只顯示一個（約會選項 → 談心故事 → 台詞 → 好感里程碑），關掉後才出現下一個
    if (ui.dateEv) h += renderDateEv();
    else if (ui.story) h += renderStory();
    else if (ui.quote) h += renderQuote();
    if (ui.scene && !ui.dateEv && !ui.story && !ui.quote) h += renderScene();
    if (ui.flash) h += '<div class="cc-toast">' + esc(ui.flash).replace(/\n/g, "<br>") + "</div>";
    app.innerHTML = h;
    if (ui.screen === "replay") startReplay();
    if (ui.screen === "draft") draftTick();
  }
  function flash(msg) {
    ui.flash = msg;
    clearTimeout(flash.tm);
    flash.tm = setTimeout(function () { ui.flash = null; var el = app.querySelector(".cc-toast"); if (el) el.parentNode.removeChild(el); }, 4200);
  }

  // ================= 標題 =================
  function renderTitle() {
    var has = Core.hasSave() && Core.load();
    var h = '<div class="cc-hero-title"><h1>🏆 ' + esc(t("title")) + '</h1><p class="cc-sub">' + esc(t("subtitle")) + "</p></div>";
    h += '<div class="cc-panel"><p class="cc-intro">' + esc(t("intro")) + "</p>";
    h += '<div class="cc-actions">';
    if (!has && Core.oldSave()) h += '<p class="cc-event">' + esc(t("old_save")) + "</p>";
    if (has) h += '<button class="cc-btn cc-primary" data-act="continue">▶ ' + esc(t("continue")) + " — " + esc(S().teams.me.name) + "（" + esc(weekLabel()) + "）</button>";
    h += '<button class="cc-btn' + (has ? "" : " cc-primary") + '" data-act="to-new">✚ ' + esc(t("new_game")) + "</button></div></div>";
    h += '<div class="cc-panel"><h2>' + esc(t("how_title")) + '</h2><ol class="cc-rules">';
    for (var i = 1; i <= 9; i++) h += "<li>" + esc(t("how_" + i)) + "</li>";
    h += "</ol></div>";
    return h;
  }
  function renderNew() {
    var h = '<div class="cc-top"><button class="cc-btn" data-act="to-title">' + esc(t("back")) + "</button><h1 class=\"cc-h1\">" + esc(t("pick_region")) + "</h1></div>";
    h += '<div class="cc-regions">';
    D.REGIONS.forEach(function (r) {
      var d = D.DIFF[r.diff];
      h += '<button class="cc-region' + (ui.newRegion === r.id ? " cc-on" : "") + '" data-act="region" data-id="' + r.id + '">' +
        '<b class="cc-abbr">' + esc(r.abbr) + "</b><span class=\"cc-rname\">" + esc(L(r.name)) + "</span>" +
        '<span class="cc-diff cc-diff-' + d.cls + '">' + esc(t("diff")) + " " + esc(L(d.name)) + "</span>" +
        '<span class="cc-small">' + esc(t("league_of", { lg: L(D.LEAGUE[r.league].name), n: D.LEAGUE[r.league].seeds })) + "・" + esc(t("fund")) + " " + money(r.fund) + "</span></button>";
    });
    h += "</div>";
    var r0 = D.REGION[ui.newRegion];
    h += '<div class="cc-panel">' + (r0.lore ? '<p class="cc-lore">📜 ' + esc(L(r0.lore)) + "</p>" : "") + "<p>" + esc(t("diff_desc_" + r0.diff)) + '</p><label class="cc-field">' + esc(t("team_name")) +
      ' <input id="cc-teamname" maxlength="24" value="' + esc(t("default_team")) + '"></label>' +
      '<div class="cc-actions"><button class="cc-btn cc-primary" data-act="start">' + esc(t("start_career", { region: L(r0.name) })) + "</button></div></div>";
    return h;
  }

  // ================= 總覽（分頁） =================
  var TABS = ["home", "roster", "train", "scout", "league", "heroes", "records"];
  function renderHub() {
    var s = S();
    var h = '<div class="cc-top"><h1 class="cc-h1">' + esc(s.teams.me.name) + " " + flagOf(s.region) + '</h1><span class="cc-week">' + esc(weekLabel()) + "</span></div>";
    h += '<div class="cc-status"><span>💰 ' + money(s.funds) + "</span><span>👥 " + esc(t("fans")) + " " + s.fans.toLocaleString() + "</span><span>⚡ " + esc(t("ap")) + " " + s.ap + "/" + Core.AP_MAX + "</span><span>📦 " + esc(t("patch_n", { n: s.patch })) + "</span><span>🏆 × " + s.trophies.length + "</span></div>";
    h += '<div class="cc-tabs">';
    TABS.forEach(function (k) { h += '<button class="cc-tab' + (ui.tab === k ? " cc-on" : "") + '" data-act="tab" data-id="' + k + '">' + esc(t("tab_" + k)) + "</button>"; });
    h += "</div>";
    if (ui.tab === "home") h += renderHome();
    else if (ui.tab === "roster") h += renderRoster();
    else if (ui.tab === "train") h += renderTrain();
    else if (ui.tab === "scout") h += renderScout();
    else if (ui.tab === "league") h += renderLeague();
    else if (ui.tab === "heroes") h += renderHeroes();
    else h += renderRecords();
    h += '<div class="cc-foot"><button class="cc-btn cc-small" data-act="to-title">' + esc(t("to_title")) + "</button></div>";
    return h;
  }

  function miniCard(p, extra) {
    return '<button class="cc-mini" data-act="open" data-id="' + p.id + '"><img src="' + photo(p) + '" alt="" loading="lazy"><span class="cc-mini-b"><b>' + esc(p.handle) + "</b>" +
      '<span class="cc-small">' + esc(roleName(p.role)) + " OVR " + Core.ovrI(p) + "</span>" + condBadge(p) + (extra || "") + "</span></button>";
  }

  function renderHome() {
    var s = S(), m = Core.myMatch(), h = "";
    if (s.offer) {
      h += '<div class="cc-panel cc-offer"><h2>✉ ' + esc(t("offer_title", { team: Core.teamName(s.offer.from) })) + "</h2><p>" + esc(t("offer_body", { team: Core.teamName(s.offer.from) })) + '</p><div class="cc-actions"><button class="cc-btn cc-primary" data-act="offer-yes">' + esc(t("offer_yes")) + '</button><button class="cc-btn" data-act="offer-no">' + esc(t("offer_no")) + "</button></div></div>";
    }
    if (s.pendingTransfer) h += '<p class="cc-event">✈ ' + esc(t("transfer_pending")) + "</p>";
    h += '<div class="cc-grid2"><div class="cc-panel"><h2>' + esc(t("this_week")) + "</h2>";
    if (m) {
      var opp = Core.team(m.opp);
      h += '<div class="cc-vs"><span class="cc-vs-team">' + esc(s.teams.me.name) + '<small>OVR ' + Core.teamStr("me").toFixed(1) + '</small></span><b>VS</b><span class="cc-vs-team">' + esc(opp.name) + " " + flagOf(opp.region) + "<small>OVR " + Core.teamStr(m.opp).toFixed(1) + "</small></span></div>";
      h += '<p class="cc-center">' + esc(t("stage_" + m.stage)) + "・Bo" + m.bo + "</p>";
      if (s.series && !Core.seriesOver()) {
        h += '<div class="cc-actions cc-center"><button class="cc-btn cc-primary" data-act="resume">▶ ' + esc(t("resume_match", { a: s.series.wins.me, b: s.series.wins.opp })) + "</button></div>";
      } else if (!s.done) {
        h += '<div class="cc-actions cc-center"><button class="cc-btn cc-primary" data-act="match">⚔ ' + esc(t("go_match")) + '</button><button class="cc-btn" data-act="auto">🤖 ' + esc(t("auto_match")) + "</button></div>";
        h += '<p class="cc-small cc-muted cc-center">' + esc(t("prep_hint")) + "</p>";
      } else if (s.series) {
        var win = s.series.wins.me > s.series.wins.opp;
        h += '<p class="cc-result ' + (win ? "cc-win" : "cc-loss") + '">' + esc(t(win ? "series_win" : "series_loss", { a: s.series.wins.me, b: s.series.wins.opp })) + "</p>";
      }
    } else {
      h += "<p>" + esc(t("no_match")) + "</p>";
    }
    h += '<div class="cc-actions cc-center"><button class="cc-btn cc-next" data-act="advance"' + (Core.canAdvance() ? "" : " disabled") + ">" + esc(t("next_week")) + " ▶</button></div>";
    if (s.lastBudget) h += '<p class="cc-small cc-muted cc-center">' + esc(t("budget_line", { inc: money(s.lastBudget.income), wage: money(s.lastBudget.wage) })) + "</p>";
    h += "</div>";
    // 互動
    h += '<div class="cc-panel"><h2>' + esc(t("ap_title")) + ' <span class="cc-ap">⚡' + s.ap + "</span></h2><p class=\"cc-small\">" + esc(t("ap_hint")) + "</p>";
    h += '<div class="cc-actions"><button class="cc-btn" data-act="dinner"' + (s.ap < 1 ? " disabled" : "") + ">🍲 " + esc(t("act_dinner", { cost: 8 + s.roster.length })) + "</button></div>";
    if (s.lastEvent) h += '<p class="cc-event">📣 ' + esc(s.lastEvent) + "</p>";
    h += "</div></div>";
    // 一軍
    h += '<div class="cc-panel"><h2>' + esc(t("lineup")) + '</h2><div class="cc-minis">';
    D.ROLES.forEach(function (r) { var p = Core.person(s.lineup[r]); if (p) h += miniCard(p, hearts(p.aff)); });
    h += "</div></div>";
    // 新聞
    h += '<div class="cc-panel"><h2>' + esc(t("news")) + '</h2><ul class="cc-news">';
    s.news.slice(0, 18).forEach(function (n) { h += '<li class="cc-n-' + esc(n.cls) + '"><span class="cc-muted cc-small">Y' + n.y + "・W" + (n.wk + 1) + "</span> " + esc(n.text) + "</li>"; });
    h += "</ul></div>";
    return h;
  }

  function playerRow(p, starter) {
    var s = S();
    return '<div class="cc-prow' + (starter ? " cc-starter" : "") + '"><button class="cc-pimg" data-act="open" data-id="' + p.id + '"><img src="' + photo(p) + '" alt="" loading="lazy"></button>' +
      '<div class="cc-pinfo"><div><b>' + esc(p.handle) + '</b> <span class="cc-muted cc-small">' + esc(p.name) + "・" + t("age_n", { n: p.age }) + "・" + esc(L(D.TRAIT[p.trait].name)) + "</span> " + (p.region !== s.region ? flagOf(p.region) : "") + "</div>" +
      '<div class="cc-small">OVR <b>' + Core.ovrI(p) + "</b>・" + esc(t("pot")) + " " + grade(p.pot) + "・" + condBadge(p) + "・" + hearts(p.aff) + "</div>" +
      '<div class="cc-small cc-meters">' + esc(t("mood")) + bar(p.mood, "cc-b-mood") + esc(t("fatigue")) + bar(p.fatigue, "cc-b-fat") + "</div></div>" +
      '<div class="cc-pact">' + (starter ? '<span class="cc-tag1">' + esc(t("squad1")) + "</span>" : '<button class="cc-btn cc-small" data-act="promote" data-id="' + p.id + '">' + esc(t("make_starter")) + "</button>") +
      '<button class="cc-btn cc-small" data-act="open" data-id="' + p.id + '">' + esc(t("detail")) + "</button></div></div>";
  }
  function renderRoster() {
    var s = S(), h = '<div class="cc-panel"><h2>' + esc(t("roster_title", { n: s.roster.length })) + '</h2><p class="cc-small cc-muted">' + esc(t("roster_hint")) + "</p>";
    D.ROLES.forEach(function (r) {
      h += '<h3>' + D.ROLE[r].icon + " " + esc(roleName(r)) + "</h3>";
      var st = Core.person(s.lineup[r]);
      if (st) h += playerRow(st, true);
      s.roster.forEach(function (id) { var p = Core.person(id); if (p.role === r && id !== s.lineup[r]) h += playerRow(p, false); });
    });
    return h + "</div>";
  }

  function renderTrain() {
    var s = S(), h = "";
    [1, 2].forEach(function (which) {
      var cur = which === 1 ? s.focus1 : s.focus2;
      h += '<div class="cc-panel"><h2>' + esc(t(which === 1 ? "train1" : "train2")) + '</h2><div class="cc-focus">';
      D.FOCUS.forEach(function (f) {
        h += '<button class="cc-fbtn' + (cur === f.id ? " cc-on" : "") + '" data-act="focus" data-w="' + which + '" data-id="' + f.id + '"><span class="cc-ficon">' + f.icon + "</span>" + esc(L(f.name)) + "</button>";
      });
      h += "</div>";
      var ps = s.roster.map(Core.person).filter(function (p) { return p.squad === which; }), fat = 0;
      ps.forEach(function (p) { fat += p.fatigue; });
      h += '<p class="cc-small">' + esc(t("train_members", { n: ps.length, f: ps.length ? Math.round(fat / ps.length) : 0 })) + "</p></div>";
    });
    h += '<div class="cc-panel"><p class="cc-small">' + esc(t("train_hint")) + "</p></div>";
    return h;
  }

  function renderScout() {
    var s = S(), h = '<div class="cc-panel"><h2>' + esc(t("scout_title")) + '</h2><p class="cc-small cc-muted">' + esc(t("scout_hint", { n: s.roster.length })) + '</p><div class="cc-scouts">';
    if (!s.scouts.length) h += "<p>" + esc(t("scout_none")) + "</p>";
    s.scouts.forEach(function (id) {
      var p = Core.person(id);
      if (!p) return;
      h += '<div class="cc-scard"><img src="' + photo(p) + '" alt="" loading="lazy"><div><b>' + esc(p.handle) + "</b> " + flagOf(p.region) + (p.foreign ? ' <span class="cc-tag1">' + esc(t("foreign")) + "</span>" : "") +
        '<div class="cc-small">' + esc(p.name) + "・" + esc(roleName(p.role)) + "・" + t("age_n", { n: p.age }) + "・" + esc(L(D.TRAIT[p.trait].name)) + "</div>" +
        '<div class="cc-small">OVR <b>' + Core.ovrI(p) + "</b>・" + esc(t("pot")) + " " + (p.known ? "<b>" + grade(p.pot) + "</b>" : "?") + "・" + esc(t("salary")) + " " + money(p.salary) + "/" + esc(t("wk")) + "</div>" +
        '<div class="cc-small">' + esc(t("sig_heroes")) + "：" + Core.topHeroes(p, 2).map(heroName).map(esc).join("、") + "</div>" +
        '<div class="cc-actions">' + (p.known ? "" : '<button class="cc-btn cc-small" data-act="tryout" data-id="' + p.id + '">🔍 ' + esc(t("tryout")) + "</button>") +
        '<button class="cc-btn cc-small cc-primary" data-act="sign" data-id="' + p.id + '">✍ ' + esc(t("sign", { fee: money(Core.signFee(p)) })) + "</button></div></div></div>";
    });
    return h + "</div></div>";
  }

  function teamCell(id) { var tm = Core.team(id); return (id === "me" ? "<b>" : "") + esc(tm.name) + (id === "me" ? "</b>" : ""); }
  function renderLeague() {
    var s = S(), h = "";
    var rid = ui.leagueView || Core.myLg();
    h += '<div class="cc-panel"><div class="cc-row"><h2 class="cc-grow">' + esc(t("league_title")) + '</h2><select data-act="leagueview">';
    D.LEAGUES.forEach(function (r) { h += '<option value="' + r.id + '"' + (r.id === rid ? " selected" : "") + ">" + esc(L(r.name) + "（" + r.seeds + "）") + "</option>"; });
    h += "</select></div>";
    var lg = s.leagues && s.leagues[rid];
    if (!lg || !lg.teams) { h += "<p>" + esc(t("league_none")) + "</p></div>"; }
    else {
      h += '<p class="cc-small">' + esc(t("split_" + lg.split)) + "</p>";
      h += '<table class="cc-table"><tr><th>#</th><th>' + esc(t("team")) + "</th><th>W-L</th><th>" + esc(t("games")) + "</th><th>OVR</th><th>" + esc(t("points")) + "</th></tr>";
      Core.standings(lg).forEach(function (id, i) {
        var r = lg.table[id];
        h += "<tr" + (id === "me" ? ' class="cc-me"' : "") + "><td>" + (i + 1) + "</td><td>" + teamCell(id) + "</td><td>" + r.w + "-" + r.l + "</td><td>" + r.gw + "-" + r.gl + "</td><td>" + Core.teamStr(id).toFixed(1) + "</td><td>" + (s.points[id] || 0) + "</td></tr>";
      });
      h += "</table>";
      if (lg.po) {
        h += "<h3>" + esc(t("playoffs")) + '</h3><div class="cc-bracket">';
        lg.po.sf.forEach(function (pr, i) { h += bracketLine(pr, lg.po.sfRes[i]); });
        if (lg.po.final) h += '<div class="cc-final">' + bracketLine(lg.po.final, lg.po.finalRes) + "</div>";
        if (lg.champ) h += '<p class="cc-gold">🏆 ' + esc(Core.teamName(lg.champ)) + "</p>";
        h += "</div>";
      }
      var mine = lg.results.filter(function (r) { return r.a === "me" || r.b === "me"; }).slice(-8).reverse();
      if (mine.length && rid === Core.myLg()) {
        h += "<h3>" + esc(t("my_results")) + '</h3><ul class="cc-news">';
        mine.forEach(function (r) {
          var me = r.a === "me", wa = me ? r.wa : r.wb, wb = me ? r.wb : r.wa, opp = me ? r.b : r.a;
          h += '<li class="cc-n-' + (wa > wb ? "win" : "loss") + '">' + esc(t("stage_" + r.stage)) + "　vs " + esc(Core.teamName(opp)) + "　" + wa + "-" + wb + "</li>";
        });
        h += "</ul>";
      }
      h += "</div>";
    }
    if (s.msi) h += renderMSI();
    if (s.worlds) h += renderWorlds();
    return h;
  }
  function bracketLine(pr, res) {
    if (!pr || !pr[0]) return "";
    var a = res ? (res.a === pr[0] ? res.wa : res.wb) : "", b = res ? (res.a === pr[0] ? res.wb : res.wa) : "";
    return '<div class="cc-bline"><span class="' + (res && a > b ? "cc-bw" : "") + '">' + teamCell(pr[0]) + " " + flagOf(Core.team(pr[0]).region) + "</span><b>" + (res ? a + " - " + b : "vs") + '</b><span class="' + (res && b > a ? "cc-bw" : "") + '">' + teamCell(pr[1]) + " " + flagOf(Core.team(pr[1]).region) + "</span></div>";
  }
  function renderMSI() {
    var M = S().msi, h = '<div class="cc-panel cc-worlds"><h2>🌐 ' + esc(t("msi")) + "</h2>";
    function res(pr) { var r = M.ko[pr[0] + "|" + pr[1]]; return r ? { a: pr[0], wa: r.wa, wb: r.wb } : null; }
    h += "<h3>" + esc(t("wk_mqf")) + '</h3><div class="cc-bracket">'; M.qf.forEach(function (pr) { h += bracketLine(pr, res(pr)); }); h += "</div>";
    if (M.sf) { h += "<h3>" + esc(t("wk_msf")) + '</h3><div class="cc-bracket">'; M.sf.forEach(function (pr) { h += bracketLine(pr, res(pr)); }); h += "</div>"; }
    if (M.final) h += "<h3>" + esc(t("wk_mfinal")) + '</h3><div class="cc-bracket">' + bracketLine(M.final, res(M.final)) + "</div>";
    if (M.champ) h += '<p class="cc-gold">🏆 ' + esc(Core.teamName(M.champ)) + "</p>";
    return h + "</div>";
  }
  function renderWorlds() {
    var s = S(), W = s.worlds, h = '<div class="cc-panel cc-worlds"><h2>🌏 ' + esc(t("worlds")) + "</h2>";
    h += '<div class="cc-groups">';
    W.groups.forEach(function (g, gi) {
      h += '<div><h3>' + esc(t("group_n", { n: "ABCD".charAt(gi) })) + '</h3><table class="cc-table">';
      Core.groupStandings(g).forEach(function (id) {
        var r = W.table[id];
        h += "<tr" + (id === "me" ? ' class="cc-me"' : "") + "><td>" + flagOf(Core.team(id).region) + " " + teamCell(id) + "</td><td>" + r.w + "-" + r.l + "</td></tr>";
      });
      h += "</table></div>";
    });
    h += "</div>";
    function res(pr) { var r = W.ko[pr[0] + "|" + pr[1]]; return r ? { a: pr[0], wa: r.wa, wb: r.wb } : null; }
    if (W.qf) { h += "<h3>" + esc(t("wk_wqf")) + '</h3><div class="cc-bracket">'; W.qf.forEach(function (pr) { h += bracketLine(pr, res(pr)); }); h += "</div>"; }
    if (W.sf) { h += "<h3>" + esc(t("wk_wsf")) + '</h3><div class="cc-bracket">'; W.sf.forEach(function (pr) { h += bracketLine(pr, res(pr)); }); h += "</div>"; }
    if (W.final) { h += "<h3>" + esc(t("wk_wfinal")) + '</h3><div class="cc-bracket">' + bracketLine(W.final, res(W.final)) + "</div>"; }
    if (W.champ) h += '<p class="cc-gold">🏆 ' + esc(t("world_champ")) + "：" + esc(Core.teamName(W.champ)) + "</p>";
    return h + "</div>";
  }

  function renderHeroes() {
    var s = S(), r = ui.heroRole, h = '<div class="cc-panel"><h2>' + esc(t("heroes_title")) + '</h2><div class="cc-tabs">';
    D.ROLES.forEach(function (k) { h += '<button class="cc-tab' + (r === k ? " cc-on" : "") + '" data-act="herorole" data-id="' + k + '">' + D.ROLE[k].icon + " " + esc(roleName(k)) + "</button>"; });
    h += '</div><p class="cc-small cc-muted">' + esc(t("heroes_hint")) + '</p><div class="cc-hlist">';
    var ps = s.roster.map(Core.person).filter(function (p) { return p.role === r; });
    Core.heroesOfRole(r).forEach(function (hero) {
      var syn = D.SYNERGIES.filter(function (x) { return x.a === hero.id || x.b === hero.id; }).map(function (x) { return L(x.name) + "（" + heroName(x.a === hero.id ? x.b : x.a) + "）"; });
      h += '<div class="cc-hcard" style="--hc:#' + ("00000" + hero.color.toString(16)).slice(-6) + '"><div class="cc-hname">' + esc(L(hero.name)) + " " + metaBadge(hero.id) + "</div>" +
        '<div class="cc-tags">' + hero.tags.map(function (g) { return '<span class="cc-tagc">' + esc(L(D.TAG[g])) + "</span>"; }).join("") + "</div>" +
        '<div class="cc-small">' + esc(t("curve")) + " " + hero.curve.map(function (c) { return "★★★★★".slice(0, c); }).join(" / ") + "</div>" +
        (syn.length ? '<div class="cc-small">🔗 ' + esc(syn.join("、")) + "</div>" : "") +
        '<div class="cc-small">' + ps.map(function (p) { return esc(p.handle) + " " + Math.round(p.mastery[hero.id] || 0); }).join("・") + "</div></div>";
    });
    return h + "</div></div>";
  }

  function renderRecords() {
    var s = S(), h = '<div class="cc-panel"><h2>' + esc(t("trophies")) + "</h2>";
    if (!s.trophies.length) h += '<p class="cc-muted">' + esc(t("no_trophy")) + "</p>";
    else { h += '<div class="cc-trophies">'; s.trophies.forEach(function (tp) { h += '<span class="cc-trophy cc-tr-' + tp.kind + '">🏆 ' + esc(t("year_n", { n: tp.y })) + " " + esc(t("trophy_" + tp.kind)) + "</span>"; }); h += "</div>"; }
    h += "<h3>" + esc(t("history")) + '</h3><ul class="cc-news">';
    s.history.slice().reverse().forEach(function (x) {
      h += "<li>" + esc(t("year_n", { n: x.y })) + " " + esc(x.kind === "worlds" ? t("worlds") + " " + t("wplace_" + x.place) : x.kind === "msi" ? t("msi") + " " + t("wplace_" + x.place) : t("split_" + x.kind) + " " + t("place_n", { n: x.place })) + "</li>";
    });
    h += "</ul><h3>" + esc(t("hall")) + '</h3><ul class="cc-news">';
    (s.worldsHist || []).slice().reverse().forEach(function (x) {
      h += '<li class="' + (x.me ? "cc-n-gold" : "") + '">' + esc(t("season_n", { n: x.s })) + "　" + esc(typeof x.team === "string" ? x.team : L(x.team)) + "（" + esc(L(D.LEAGUE[x.lg].name)) + "）" + (x.rumor ? " ❓" : "") + "</li>";
    });
    h += "</ul><h3>" + esc(t("player_stats")) + '</h3><table class="cc-table"><tr><th>' + esc(t("player")) + "</th><th>" + esc(t("games")) + "</th><th>W%</th><th>KDA</th><th>MVP</th></tr>";
    s.roster.map(Core.person).forEach(function (p) {
      h += "<tr><td>" + esc(p.handle) + "</td><td>" + p.games + "</td><td>" + (p.games ? Math.round(p.wins / p.games * 100) : 0) + "%</td><td>" + ((p.k + p.a) / Math.max(1, p.d)).toFixed(2) + "</td><td>" + p.mvp + "</td></tr>";
    });
    return h + "</table></div>";
  }

  // ================= 選手詳細 =================
  function renderModal() {
    var p = Core.person(ui.modal);
    if (!p) { ui.modal = null; return ""; }
    var s = S(), mine = p.team === "me", tr = D.TRAIT[p.trait];
    var h = '<div class="cc-modal" data-act="close-modal"><div class="cc-mbox" data-stop="1"><button class="cc-x" data-act="close-modal">✕</button>';
    h += '<div class="cc-mhead"><img src="' + photo(p) + '" alt=""><div><h2>' + esc(p.handle) + ' <span class="cc-small cc-muted">' + esc(p.name) + "</span></h2>" +
      "<p>" + flagOf(p.region) + " " + D.ROLE[p.role].icon + " " + esc(roleName(p.role)) + "・" + t("age_n", { n: p.age }) + "・" + esc(L(tr.name)) + "</p>" +
      "<p>OVR <b class=\"cc-big\">" + Core.ovrI(p) + "</b>　" + esc(t("pot")) + " " + grade(p.pot) + "　" + condBadge(p) + "</p>" +
      '<p class="cc-small">' + esc(t("mood")) + bar(p.mood, "cc-b-mood") + " " + esc(t("fatigue")) + bar(p.fatigue, "cc-b-fat") + " " + esc(t("aff")) + " " + hearts(p.aff) + " " + Math.round(p.aff) + "</p>" +
      '<p class="cc-small">' + esc(t("salary")) + " " + money(p.salary) + "/" + esc(t("wk")) + "・" + esc(p.squad === 1 ? t("squad1") : t("squad2")) + "</p></div></div>";
    h += '<div class="cc-stats">';
    D.STATS.forEach(function (k) { h += '<div class="cc-stat"><span>' + esc(L(D.STAT[k])) + "</span>" + bar(p.stats[k], "cc-b-stat") + "<b>" + Math.round(p.stats[k]) + "</b></div>"; });
    h += "</div>";
    h += "<h3>" + esc(t("mastery")) + '</h3><div class="cc-mast">';
    Core.heroesOfRole(p.role).slice().sort(function (a, b) { return (p.mastery[b.id] || 0) - (p.mastery[a.id] || 0); }).forEach(function (hero) {
      h += '<div class="cc-mrow"><span>' + esc(L(hero.name)) + " " + metaBadge(hero.id) + "</span>" + bar(p.mastery[hero.id] || 0, "cc-b-mast") + "<b>" + Math.round(p.mastery[hero.id] || 0) + "</b></div>";
    });
    h += "</div>";
    if (mine) {
      h += '<label class="cc-field">' + esc(t("practice_hero")) + ' <select data-act="practice" data-id="' + p.id + '"><option value="">—</option>';
      Core.heroesOfRole(p.role).forEach(function (hero) { h += '<option value="' + hero.id + '"' + (p.practice === hero.id ? " selected" : "") + ">" + esc(L(hero.name)) + "</option>"; });
      h += "</select></label>";
      h += '<p class="cc-small cc-muted">' + esc(t("record_line", { g: p.games, w: p.wins, kda: ((p.k + p.a) / Math.max(1, p.d)).toFixed(2), mvp: p.mvp })) + "</p>";
      h += "<h3>" + esc(t("interact")) + ' <span class="cc-ap">⚡' + s.ap + "</span></h3><div class=\"cc-actions\">" +
        '<button class="cc-btn" data-act="talk" data-id="' + p.id + '"' + (s.ap < 1 ? " disabled" : "") + ">💬 " + esc(t("act_talk")) + "</button>" +
        '<button class="cc-btn" data-act="coach" data-id="' + p.id + '"' + (s.ap < 1 ? " disabled" : "") + ">📋 " + esc(t("act_coach")) + "</button>" +
        '<button class="cc-btn" data-act="datepick" data-id="' + p.id + '"' + (s.ap < 1 ? " disabled" : "") + ">💕 " + esc(t("act_date")) + "</button>" +
        '<button class="cc-btn cc-hotel" data-act="hotel" data-id="' + p.id + '"' + (s.ap < D.HOTEL.ap || p.aff < D.HOTEL.needAff ? " disabled" : "") + ">🏨 " + esc(t("act_hotel", { cost: money(D.HOTEL.cost) })) + "</button></div>";
      if (p.story) h += '<p class="cc-small">📖 ' + esc(t("story_progress", { title: L(Core.storyOf(p).title), n: Math.min(3, p.chap || 0) })) + "</p>";
      if (p.aff < D.HOTEL.needAff) h += '<p class="cc-small cc-muted">' + esc(t("hotel_locked", { n: D.HOTEL.needAff })) + "</p>";
      if (ui.datePick) {
        h += '<div class="cc-dates">';
        D.DATE_SPOTS.forEach(function (sp) {
          h += '<button class="cc-btn" data-act="date" data-id="' + p.id + '" data-spot="' + sp.id + '"' + (s.funds < sp.cost ? " disabled" : "") + ">" + sp.icon + " " + esc(L(sp.name)) + " <small>" + money(sp.cost) + "</small></button>";
        });
        h += "</div>";
      }
      h += '<div class="cc-actions cc-danger-zone">' + (p.squad === 2 ? '<button class="cc-btn" data-act="promote" data-id="' + p.id + '">' + esc(t("make_starter")) + "</button>" : "") +
        '<button class="cc-btn cc-danger" data-act="release" data-id="' + p.id + '">' + esc(t("release")) + "</button></div>";
    }
    return h + "</div></div>";
  }
  function renderScene() {
    var p = Core.person(ui.scene.pid);
    if (!p) { ui.scene = null; return ""; }
    var lv = ["30", "60", "90"][ui.scene.level];
    return '<div class="cc-modal cc-scene" data-act="close-scene"><div class="cc-sbox"><img src="' + photo(p) + '" alt=""><p class="cc-small cc-gold">♥ ' + esc(t("aff_ms_" + lv, { name: p.handle })) + '</p><p class="cc-line">' + esc(ui.scene.line) + '</p><button class="cc-btn cc-primary" data-act="close-scene">OK</button></div></div>';
  }

  // ================= BP =================
  function draftSideBox(side) {
    var s = S(), d = s.draft, tid = d[side], me = tid === "me";
    var h = '<div class="cc-dside cc-' + side + (me ? " cc-mine" : "") + '"><h3>' + esc(t(side)) + "・" + esc(Core.teamName(tid)) + (me ? " ★" : "") + "</h3>";
    h += '<div class="cc-bans">';
    for (var i = 0; i < 5; i++) { var b = d.bans[side][i]; h += '<span class="cc-banslot">' + (b ? "🚫 " + esc(heroName(b)) : "—") + "</span>"; }
    h += '</div><div class="cc-picks">';
    D.ROLES.forEach(function (r) {
      var p = Core.playerFor(tid, r), hid = d.picks[side][r];
      h += '<div class="cc-pslot' + (hid ? " cc-filled" : "") + '"><img src="' + photo(p) + '" alt="" loading="lazy"><div><span class="cc-small">' + D.ROLE[r].icon + " " + esc(p.handle) + "</span>" +
        "<b>" + (hid ? esc(heroName(hid)) : "…") + "</b>" + (hid ? '<span class="cc-small">' + esc(t("mastery_s")) + " " + Math.round(p.mastery[hid] || 0) + "</span>" : "") + "</div></div>";
    });
    return h + "</div></div>";
  }
  function renderDraft() {
    var s = S(), se = s.series, d = s.draft, turn = Core.draftTurn(), mySide = Core.mySide();
    var myTurn = turn && turn[0] === mySide;
    var h = '<div class="cc-top"><h1 class="cc-h1">' + esc(t("bp_title", { n: se.games.length + 1, bo: se.bo })) + '</h1><span class="cc-week">' + esc(t("series_score", { a: se.wins.me, b: se.wins.opp })) + "</span></div>";
    h += '<div class="cc-turn ' + (myTurn ? "cc-myturn" : "") + '">' + (turn ? esc(t(turn[0])) + " " + esc(t(turn[1] === "ban" ? "ban" : "pick")) + "　" + esc(myTurn ? t("your_turn") : t("opp_thinking")) : esc(t("bp_done"))) + "</div>";
    h += '<div class="cc-draft">' + draftSideBox("blue") + '<div class="cc-dmid">';
    h += '<div class="cc-tabs">';
    ["all"].concat(D.ROLES).forEach(function (k) { h += '<button class="cc-tab' + (ui.roleFilter === k ? " cc-on" : "") + '" data-act="rolefilter" data-id="' + k + '">' + (k === "all" ? esc(t("all")) : D.ROLE[k].icon + " " + esc(roleName(k))) + "</button>"; });
    h += '</div><div class="cc-hgrid">';
    var oppTid = se.opp;
    D.HEROES.forEach(function (hero) {
      if (ui.roleFilter !== "all" && hero.role !== ui.roleFilter) return;
      var taken = Core.heroTaken(hero.id), ok = turn ? (turn[1] === "ban" ? Core.canBan(hero.id) : Core.canPick(turn[0], hero.id)) : false;
      var lockMe = Core.fearlessLocked("me", hero.id);
      var myP = Core.playerFor("me", hero.role), opP = Core.playerFor(oppTid, hero.role);
      var mm = Math.round(myP.mastery[hero.id] || 0), om = Math.round(opP.mastery[hero.id] || 0);
      var cls = "cc-hbtn" + (taken ? " cc-taken" : "") + (!ok ? " cc-dis" : "") + (ui.selHero === hero.id ? " cc-sel" : "");
      h += '<button class="' + cls + '" data-act="hero" data-id="' + hero.id + '"' + (myTurn && ok ? "" : " disabled") + ' style="--hc:#' + ("00000" + hero.color.toString(16)).slice(-6) + '">' +
        '<span class="cc-hb-name">' + esc(L(hero.name)) + "</span>" + metaBadge(hero.id) +
        '<span class="cc-hb-sub">' + D.ROLE[hero.role].icon + " " + esc(t("mine_short")) + " " + mm + (om >= 85 ? ' <i class="cc-sig">' + esc(t("opp_sig")) + "</i>" : "") + "</span>" +
        (taken === "ban" ? '<span class="cc-hb-st">🚫</span>' : taken === "pick" ? '<span class="cc-hb-st">✔</span>' : lockMe ? '<span class="cc-hb-st cc-fl">' + esc(t("fearless_lock")) + "</span>" : "") +
        "</button>";
    });
    h += "</div>";
    if (ui.selHero && myTurn) {
      var sh = D.HERO[ui.selHero];
      h += '<div class="cc-selinfo"><b>' + esc(L(sh.name)) + "</b> " + sh.tags.map(function (g) { return '<span class="cc-tagc">' + esc(L(D.TAG[g])) + "</span>"; }).join("") + "</div>";
    }
    h += '<div class="cc-actions cc-center"><button class="cc-btn cc-primary" data-act="confirm-hero"' + (myTurn && ui.selHero ? "" : " disabled") + ">" + esc(turn && turn[1] === "ban" ? t("confirm_ban") : t("confirm_pick")) + '</button>' +
      '<button class="cc-btn" data-act="suggest"' + (myTurn ? "" : " disabled") + ">💡 " + esc(t("suggest")) + '</button><button class="cc-btn" data-act="auto-rest">🤖 ' + esc(t("auto_rest")) + "</button></div>";
    h += '<p class="cc-small cc-muted">' + esc(t("fearless_hint")) + "</p>";
    if (se.used.length) h += '<p class="cc-small">' + esc(t("used_all")) + "：" + se.used.map(heroName).map(esc).join("、") + "</p>";
    h += murmurPanel(se.murmurs);
    h += "</div>" + draftSideBox("red") + "</div>";
    return h;
  }
  // BP 中的碎碎念：選到英雄時那位選手、被禁掉招牌英雄時的選手
  function addMurmur(list, p, side, text) {
    if (!p || !text) return;
    list.push({ pid: p.id, img: p.img, handle: p.handle, side: side, text: text });
    while (list.length > 6) list.shift();
  }
  function murmurPanel(list) {
    if (!list || !list.length) return "";
    var h = '<div class="cc-murmurs"><h3>💭 ' + esc(t("murmur_title")) + "</h3>";
    list.slice().reverse().forEach(function (m, i) {
      h += '<div class="cc-mm cc-mm-' + m.side + (i === 0 ? " cc-mm-new" : "") + '"><img src="' + IMG_BASE + Core.photoFile(m.img) + '.webp" alt=""><span><b>' + esc(m.handle) + "</b> " + esc(m.text) + "</span></div>";
    });
    return h + "</div>";
  }
  function doDraft(hid) {
    var s = S(), turn = Core.draftTurn();
    if (!turn || !Core.draftAct(hid)) return false;
    var list = s.series.murmurs || (s.series.murmurs = []), hero = D.HERO[hid];
    if (turn[1] === "pick") {
      var tid = Core.teamOfSide(turn[0]), p = Core.playerFor(tid, hero.role), m = p.mastery[hid] || 0;
      var sit = m >= 72 ? "pick_good" : m < 45 ? "pick_bad" : (Math.random() < 0.5 ? "pick_good" : null);
      if (sit && (tid === "me" || Math.random() < 0.6)) addMurmur(list, p, tid === "me" ? "me" : "opp", Core.murmur(p, sit));
    } else {
      ["me", s.series.opp].forEach(function (tid) {
        var p = Core.playerFor(tid, hero.role);
        if (p && (p.mastery[hid] || 0) >= 80) addMurmur(list, p, tid === "me" ? "me" : "opp", Core.murmur(p, "banned"));
      });
    }
    return true;
  }
  function draftTick() {
    var s = S();
    if (!s || !s.draft || ui.screen !== "draft") return;
    if (Core.draftDone()) { clearTimeout(ui.aiTimer); ui.aiTimer = null; ui.screen = "tactic"; ui.tactic = null; render(); return; }
    var turn = Core.draftTurn();
    if (turn[0] === Core.mySide() || ui.aiTimer) return;
    ui.aiTimer = setTimeout(function () {
      ui.aiTimer = null;
      var hid = Core.aiChoose(turn[0]);
      if (!hid) { var all = D.HEROES.filter(function (h) { return turn[1] === "ban" ? Core.canBan(h.id) : Core.canPick(turn[0], h.id); }); hid = all.length ? all[0].id : null; }
      if (hid) doDraft(hid);
      Core.save();
      render();
    }, 520);
  }

  // ================= 戰術 =================
  function compBox(side) {
    var s = S(), d = s.draft, picks = d.picks[side], syn = Core.activeSynergies(picks);
    var h = '<div class="cc-comp cc-' + side + '"><h3>' + esc(t(side)) + "・" + esc(Core.teamName(d[side])) + '</h3><ul class="cc-clist">';
    D.ROLES.forEach(function (r) { h += "<li>" + D.ROLE[r].icon + " " + esc(heroName(picks[r])) + " " + metaBadge(picks[r]) + "</li>"; });
    h += "</ul>" + (syn.length ? '<p class="cc-small">🔗 ' + syn.map(function (x) { return esc(L(x.name)); }).join("、") + "</p>" : "") + "</div>";
    return h;
  }
  function renderTactic() {
    var s = S(), d = s.draft, me = Core.mySide();
    var h = '<div class="cc-top"><h1 class="cc-h1">' + esc(t("tactic_title")) + "</h1></div>";
    h += '<div class="cc-grid2">' + compBox("blue") + compBox("red") + "</div>";
    h += '<div class="cc-panel"><p class="cc-small cc-muted">' + esc(t("tactic_hint")) + '</p><div class="cc-tactics">';
    D.TACTICS.forEach(function (tc) {
      var fit = Core.fitPct(d.picks[me], tc.id);
      h += '<button class="cc-tcard' + (ui.tactic === tc.id ? " cc-on" : "") + '" data-act="tactic" data-id="' + tc.id + '"><b>' + tc.icon + " " + esc(L(tc.name)) + "</b>" +
        '<span class="cc-fit">' + esc(t("fit")) + " " + fit + "%" + bar(fit, "cc-b-fit") + "</span>" +
        '<span class="cc-small">' + esc(L(tc.desc)) + "</span>" +
        '<span class="cc-small">' + esc(t("beats")) + "：" + tc.beats.map(function (b) { return esc(L(D.TACTIC[b].name)); }).join("、") + "</span></button>";
    });
    h += '</div><div class="cc-actions cc-center"><button class="cc-btn cc-primary" data-act="to-pre"' + (ui.tactic ? "" : " disabled") + ">" + esc(t("to_prematch")) + " ▶</button></div></div>";
    return h;
  }

  // ================= 賽前確認 =================
  function renderPre() {
    var s = S(), d = s.draft, me = Core.mySide(), opp = me === "blue" ? "red" : "blue";
    var pr = Core.predict(ui.tactic);
    var h = '<div class="cc-top"><h1 class="cc-h1">' + esc(t("pre_title")) + '</h1><span class="cc-week">' + esc(L(D.TACTIC[ui.tactic].name)) + "</span></div>";
    h += '<div class="cc-panel"><table class="cc-table cc-pre"><tr><th>' + esc(s.teams.me.name) + "</th><th></th><th>" + esc(Core.teamName(s.series.opp)) + "</th></tr>";
    D.ROLES.forEach(function (r) {
      var a = Core.playerFor("me", r), b = Core.playerFor(s.series.opp, r), ha = d.picks[me][r], hb = d.picks[opp][r];
      if (!ui.preLines) ui.preLines = {};
      if (!ui.preLines[a.id]) ui.preLines[a.id] = Core.murmur(a, "pre");
      if (!ui.preLines[b.id]) ui.preLines[b.id] = Core.murmur(b, "pre");
      h += "<tr><td>" + preCell(a, ha) + '<div class="cc-say">💬 ' + esc(ui.preLines[a.id]) + '</div></td><td class="cc-center">' + D.ROLE[r].icon + "</td><td>" + preCell(b, hb) + '<div class="cc-say cc-say-r">💬 ' + esc(ui.preLines[b.id]) + "</div></td></tr>";
    });
    h += "</table>";
    h += '<div class="cc-powers">';
    ["early", "mid", "late"].forEach(function (ph) {
      var a = pr.me[ph], b = pr.opp[ph], pa = Math.round(Math.max(8, Math.min(92, 50 + (a - b) * 6)));
      h += '<div class="cc-pw"><span>' + esc(t("ph_" + ph)) + '</span><span class="cc-pwbar"><i class="cc-pwa" style="width:' + pa + '%"></i></span><span class="cc-small">' + a.toFixed(1) + " : " + b.toFixed(1) + "</span></div>";
    });
    h += '</div><p class="cc-predict">' + esc(t("predict", { p: pr.pct })) + "</p>";
    h += '<div class="cc-actions cc-center"><button class="cc-btn" data-act="back-tactic">' + esc(t("back")) + '</button><button class="cc-btn cc-primary" data-act="play">🎮 ' + esc(t("start_game")) + "</button></div></div>";
    return h;
  }
  function preCell(p, hid) {
    return '<div class="cc-pcell"><img src="' + photo(p) + '" alt="" loading="lazy"><div><b>' + esc(p.handle) + '</b> <span class="cc-small">OVR ' + Core.ovrI(p) + "</span><br>" + condBadge(p) +
      '<br><span class="cc-small">' + esc(heroName(hid)) + "（" + esc(t("mastery_s")) + " " + Math.round(p.mastery[hid] || 0) + "）・" + esc(t("rating")) + " " + Core.matchRating(p, hid).toFixed(1) + "</span></div></div>";
  }

  // ================= 重播 =================
  function momentCaption(m, g) {
    var mySideIsA = true, winMe = m.winner === "A";
    var wk = 0, lk = 0;
    m.kills.forEach(function (k) { if (k.side === m.winner) wk++; else lk++; });
    var who = winMe ? S().teams.me.name : Core.teamName(S().series.opp);
    var key = m.type === "siege" ? "cap_siege" : m.obj ? "cap_obj" : "cap_fight";
    return ("0" + m.min).slice(-2) + ":" + ("0" + m.sec).slice(-2) + "　" + (m.creative ? "💡" + t("creative") + " " : "") + L(D.MOMENTS[m.type].name) + " — " +
      t(key, { team: who, k: wk, l: lk, obj: m.obj ? t("obj_" + m.obj) : "" });
  }
  function renderReplayShell() {
    var g = ui.lastGame;
    var h = '<div class="cc-top"><h1 class="cc-h1">📺 ' + esc(t("replay_title", { n: g.n })) + "</h1></div>";
    h += '<div class="cc-replay"><div id="cc-3d" class="cc-3d"></div><div class="cc-cap" id="cc-cap"></div><ul class="cc-kf" id="cc-kf"></ul><div class="cc-bubble" id="cc-bubble"></div><div class="cc-score" id="cc-score"></div></div>';
    h += '<ol class="cc-mlist" id="cc-mlist"></ol>';
    h += '<div class="cc-actions cc-center"><button class="cc-btn" data-act="rp-next">⏭ ' + esc(t("next_scene")) + '</button><button class="cc-btn cc-primary" data-act="rp-skip">' + esc(t("skip_replay")) + "</button></div>";
    return h;
  }
  function startReplay() {
    var g = ui.lastGame, res = g.res, me = g.mySide, opp = me === "blue" ? "red" : "blue";
    var list = document.getElementById("cc-mlist"), cap = document.getElementById("cc-cap"), kf = document.getElementById("cc-kf"), sc = document.getElementById("cc-score");
    var kA = 0, kB = 0;
    function score() { sc.innerHTML = '<span class="cc-' + me + '">' + esc(S().teams.me.name) + " " + kA + '</span> ⚔ <span class="cc-' + opp + '">' + kB + " " + esc(Core.teamName(S().series.opp)) + "</span>"; }
    score();
    var bub = document.getElementById("cc-bubble"), bubTm = null;
    function say(side, role, sit, text) {
      var p = Core.playerFor(side === "A" ? "me" : S().series.opp, role);
      text = text || Core.murmur(p, sit);
      if (!p || !text || !bub) return;
      bub.className = "cc-bubble cc-bub-" + (side === "A" ? "me" : "opp") + " cc-bub-on";
      bub.innerHTML = '<img src="' + photo(p) + '" alt=""><span><b>' + esc(p.handle) + "</b>" + esc(text) + "</span>";
      clearTimeout(bubTm);
      bubTm = setTimeout(function () { if (bub) bub.className = "cc-bubble"; }, 2300);
    }
    function showMoment(i, m) {
      cap.textContent = momentCaption(m, g);
      if (m.creative) {
        var naRole = null;
        D.ROLES.forEach(function (r) { var p = Core.playerFor(m.creative === "A" ? "me" : S().series.opp, r); if (!naRole && p && D.REGION[p.region].creative) naRole = r; });
        if (naRole) say(m.creative, naRole, null, Core.creativeLine());
      }
      setTimeout(function () {
        if (ui.screen !== "replay") return;
        say("A", D.ROLES[Math.floor(Math.random() * 5)], m.winner === "A" ? "win_fight" : "lose_fight");
      }, m.creative ? 3600 : 4300);
      kf.innerHTML = "";
      var li = document.createElement("li"); li.textContent = momentCaption(m, g); li.className = m.winner === "A" ? "cc-n-win" : "cc-n-loss";
      list.appendChild(li);
    }
    function onKill(k) {
      var picks = k.side === "A" ? g.picks[me] : g.picks[opp], vp = k.side === "A" ? g.picks[opp] : g.picks[me];
      if (k.side === "A") kA++; else kB++;
      score();
      var li = document.createElement("li");
      li.className = k.side === "A" ? "cc-kf-me" : "cc-kf-opp";
      li.textContent = heroName(picks[k.killer]) + "  ⚔  " + heroName(vp[k.victim]);
      kf.appendChild(li);
      while (kf.children.length > 5) kf.removeChild(kf.firstChild);
      var r0 = Math.random();
      if (r0 < 0.35) say(k.side, k.killer, "kill");
      else if (r0 < 0.6) say(k.side === "A" ? "B" : "A", k.victim, "death");
    }
    function done() { ui.screen = "result"; render(); }
    var box = document.getElementById("cc-3d");
    function fallback() {
      // 沒有 WebGL：文字逐幕顯示
      box.innerHTML = '<p class="cc-muted cc-center">' + esc(t("no_webgl")) + "</p>";
      var i = 0;
      ui.replay = { next: function () { if (i >= res.moments.length) { done(); return; } var m = res.moments[i++]; showMoment(i, m); m.kills.forEach(onKill); }, skip: done, dispose: function () {} };
      ui.replay.next();
    }
    if (!V3 || !V3.available()) { fallback(); return; }
    V3.load().then(function () {
      if (ui.screen !== "replay" || !document.getElementById("cc-3d")) return;
      ui.replay = V3.create(box, {});
      ui.replay.play({ moments: res.moments, pickA: g.picks[me], pickB: g.picks[opp], aSide: me }, { onMoment: showMoment, onKill: onKill, onDone: done });
    }).catch(fallback);
  }

  // ================= 結果 =================
  function renderResult() {
    var s = S(), g = ui.lastGame, res = g.res, se = s.series, win = g.winner === "me", me = g.mySide, opp = me === "blue" ? "red" : "blue";
    var h = '<div class="cc-banner ' + (win ? "cc-win" : "cc-loss") + '">' + esc(t(win ? "game_win" : "game_loss")) + '<small>' + esc(t("game_len", { m: res.minutes })) + "</small></div>";
    h += '<p class="cc-center">' + esc(t("series_score", { a: se.wins.me, b: se.wins.opp })) + "　" + esc(t("tactic_vs", { a: L(D.TACTIC[g.myTactic].name), b: L(D.TACTIC[g.oppTactic].name) })) + "</p>";
    h += '<div class="cc-panel"><h3>' + esc(t("key_moments")) + '</h3><ol class="cc-mlist">';
    res.moments.forEach(function (m) { h += '<li class="' + (m.winner === "A" ? "cc-n-win" : "cc-n-loss") + '">' + esc(momentCaption(m, g)) + "</li>"; });
    h += "</ol>";
    h += '<table class="cc-table"><tr><th></th><th>' + esc(s.teams.me.name) + "</th><th>K/D/A</th><th></th><th>" + esc(Core.teamName(se.opp)) + "</th><th>K/D/A</th></tr>";
    D.ROLES.forEach(function (r) {
      var a = res.box.A[r], b = res.box.B[r], pa = Core.playerFor("me", r), pb = Core.playerFor(se.opp, r);
      var mvpA = res.mvp.side === "A" && res.mvp.role === r, mvpB = res.mvp.side === "B" && res.mvp.role === r;
      h += "<tr><td>" + D.ROLE[r].icon + "</td><td>" + esc(pa.handle) + "<br><span class=\"cc-small\">" + esc(heroName(g.picks[me][r])) + "</span>" + (mvpA ? ' <span class="cc-mvp">MVP</span>' : "") + "</td><td>" + a.k + "/" + a.d + "/" + a.a + "</td><td></td><td>" + esc(pb.handle) + "<br><span class=\"cc-small\">" + esc(heroName(g.picks[opp][r])) + "</span>" + (mvpB ? ' <span class="cc-mvp">MVP</span>' : "") + "</td><td>" + b.k + "/" + b.d + "/" + b.a + "</td></tr>";
    });
    h += "</table></div>";
    h += '<div class="cc-panel"><h3>💭 ' + esc(t("murmur_title")) + '</h3><div class="cc-says">';
    D.ROLES.forEach(function (r) {
      var p = Core.playerFor("me", r);
      if (!g.lines) g.lines = {};
      if (!g.lines[r]) g.lines[r] = Core.murmur(p, win ? "victory" : "defeat");
      h += '<div class="cc-mm cc-mm-me"><img src="' + photo(p) + '" alt=""><span><b>' + esc(p.handle) + "</b> " + esc(g.lines[r]) + "</span></div>";
    });
    h += "</div></div>";
    if (Core.seriesOver()) {
      var sw = se.wins.me > se.wins.opp;
      h += '<p class="cc-result ' + (sw ? "cc-win" : "cc-loss") + '">' + esc(t(sw ? "series_win" : "series_loss", { a: se.wins.me, b: se.wins.opp })) + "</p>";
      h += '<div class="cc-actions cc-center"><button class="cc-btn cc-primary" data-act="to-hub">' + esc(t("back_hub")) + "</button></div>";
    } else {
      h += '<div class="cc-actions cc-center"><button class="cc-btn cc-primary" data-act="next-game">' + esc(t("next_game", { n: se.games.length + 1 })) + '</button><button class="cc-btn" data-act="auto-rest">🤖 ' + esc(t("auto_rest")) + "</button></div>";
    }
    return h;
  }

  // ================= 快轉（交給助理教練） =================
  function runAuto() {
    var s = S(), before = s.series ? s.series.games.length : 0;
    clearTimeout(ui.aiTimer); ui.aiTimer = null;
    Core.autoSeries();
    s = S();
    if (!s.series) { ui.screen = "hub"; return; }
    ui.ff = { games: s.series.games.slice(before), opp: s.series.opp, wins: { me: s.series.wins.me, opp: s.series.wins.opp } };
    ui.screen = "ff";
  }
  function renderFF() {
    var ff = ui.ff, d = 0, h = '<div class="cc-top"><h1 class="cc-h1">⏩ ' + esc(t("ff_title")) + "</h1></div>";
    ff.games.forEach(function (g) {
      var me = g.mySide, win = g.winner === "me";
      h += '<div class="cc-panel cc-ff"><h3 class="cc-ffl" style="animation-delay:' + (d += 0.2) + 's">' + esc(t("ff_game", { n: g.n })) + "　" + esc(L(D.TACTIC[g.myTactic].name)) + " vs " + esc(L(D.TACTIC[g.oppTactic].name)) + "</h3><ul class=\"cc-mlist\">";
      g.res.moments.forEach(function (m) {
        h += '<li class="cc-ffl ' + (m.winner === "A" ? "cc-n-win" : "cc-n-loss") + '" style="animation-delay:' + (d += 0.35) + 's">' + esc(momentCaption(m, g)) + "</li>";
        if (Math.random() < 0.7) {
          var p = Core.playerFor("me", D.ROLES[Math.floor(Math.random() * 5)]);
          var line = m.creative === "A" && D.REGION[p.region].creative ? Core.creativeLine() : Core.murmur(p, m.winner === "A" ? "win_fight" : "lose_fight");
          h += '<li class="cc-ffl cc-ffm" style="animation-delay:' + (d += 0.25) + 's"><img src="' + photo(p) + '" alt=""><b>' + esc(p.handle) + "</b> " + esc(line) + "</li>";
        }
      });
      h += '</ul><p class="cc-ffl cc-result ' + (win ? "cc-win" : "cc-loss") + '" style="animation-delay:' + (d += 0.3) + 's">' + esc(t(win ? "game_win" : "game_loss")) + "</p></div>";
      void me;
    });
    var sw = ff.wins.me > ff.wins.opp;
    h += '<p class="cc-ffl cc-result ' + (sw ? "cc-win" : "cc-loss") + '" style="animation-delay:' + (d += 0.4) + 's">' + esc(t(sw ? "series_win" : "series_loss", { a: ff.wins.me, b: ff.wins.opp })) + "</p>";
    h += '<div class="cc-actions cc-center cc-ffl" style="animation-delay:' + (d + 0.2) + 's"><button class="cc-btn cc-primary" data-act="to-hub">' + esc(t("back_hub")) + "</button></div>";
    return h;
  }

  // ================= 約會、談心的視窗 =================
  function renderDateEv() {
    var e = ui.dateEv, p = Core.person(e.pid), ev = window.PriTestChampStory.DATE_EVENTS[e.ev], sp = D.DATE_SPOT[e.spot];
    var h = '<div class="cc-modal cc-scene"><div class="cc-sbox"><img src="' + photo(p) + '" alt=""><p class="cc-small cc-gold">' + sp.icon + " " + esc(L(sp.name)) + "</p><p class=\"cc-line\">" + esc(L(ev.q)) + '</p><div class="cc-opts">';
    ev.o.forEach(function (o, i) { h += '<button class="cc-btn" data-act="date-opt" data-i="' + i + '">' + esc(L(o.t)) + "</button>"; });
    return h + "</div></div></div>";
  }
  function renderStory() {
    var st = ui.story, p = Core.person(st.pid);
    var h = '<div class="cc-modal cc-scene"><div class="cc-sbox cc-storybox"><img src="' + photo(p) + '" alt=""><p class="cc-small cc-gold">🏨 ' + esc(st.chap <= 3 ? t("story_head", { title: st.title, n: st.chap }) : t("story_after")) + "</p>" +
      '<p class="cc-line">' + esc(st.text) + "</p>" + (st.bonus ? '<p class="cc-gold">✨ ' + esc(st.bonus) + "</p>" : "") + (st.scandal ? '<p class="cc-loss cc-small">' + esc(t("hotel_scandal")) + "</p>" : "") +
      '<button class="cc-btn cc-primary" data-act="close-story">OK</button></div></div>';
    return h;
  }
  function renderQuote() {
    var q = ui.quote, p = Core.person(q.pid);
    return '<div class="cc-modal cc-scene" data-act="close-quote"><div class="cc-sbox"><img src="' + photo(p) + '" alt=""><p class="cc-line">' + esc(q.text).replace(/\n/g, "<br>") + '</p><button class="cc-btn cc-primary" data-act="close-quote">OK</button></div></div>';
  }

  // ================= 事件 =================
  function handle(act, el, ev) {
    var id = el.getAttribute("data-id"), s = S(), r;
    switch (act) {
      case "to-title": ui.screen = "title"; ui.modal = null; break;
      case "to-new": ui.screen = "new"; break;
      case "continue": if (Core.load()) { ui.screen = "hub"; ui.tab = "home"; } break;
      case "region": ui.newRegion = id; break;
      case "start":
        if (Core.hasSave() && !window.confirm(t("confirm_overwrite"))) return;
        var nm = (document.getElementById("cc-teamname") || {}).value;
        Core.newGame(ui.newRegion, (nm || "").trim() || t("default_team"));
        ui.screen = "hub"; ui.tab = "home"; break;
      case "tab": ui.tab = id; break;
      case "herorole": ui.heroRole = id; break;
      case "open": ui.modal = id; ui.datePick = false; break;
      case "close-modal": if (ev.target.closest("[data-stop]") && !el.classList.contains("cc-x")) return; ui.modal = null; break;
      case "close-scene": ui.scene = null; break;
      case "promote": r = Core.person(id); if (r) Core.setLineup(r.role, id); break;
      case "focus": Core.setFocus(+el.getAttribute("data-w"), id); break;
      case "tryout": r = Core.scoutReveal(id); if (!r.ok && r.msg) flash(r.msg); break;
      case "sign": r = Core.sign(id); flash(r.ok ? t("signed") : r.msg || ""); break;
      case "release": if (!window.confirm(t("confirm_release"))) return; r = Core.release(id); if (r.ok) ui.modal = null; else if (r.msg) flash(r.msg); break;
      case "talk": r = Core.talk(id); afterAct(r); if (r.ok) ui.quote = { pid: id, text: r.line }; break;
      case "coach": r = Core.coach(id); afterAct(r); break;
      case "datepick": ui.datePick = !ui.datePick; break;
      case "date":
        r = Core.canDate(el.getAttribute("data-spot"));
        if (!r.ok) { flash(r.msg); break; }
        ui.dateEv = { pid: id, spot: el.getAttribute("data-spot"), ev: Core.dateEvent() }; ui.datePick = false; break;
      case "date-opt":
        r = Core.date(ui.dateEv.pid, ui.dateEv.spot, ui.dateEv.ev, +el.getAttribute("data-i"));
        var dpid = ui.dateEv.pid; ui.dateEv = null;
        if (r.ok) ui.quote = { pid: dpid, text: r.msg }; else flash(r.msg);
        if (r.ok && r.scene) ui.scene = { pid: dpid, level: r.scene.level, line: r.scene.line };
        break;
      case "hotel":
        if (!window.confirm(t("confirm_hotel"))) return;
        r = Core.hotel(id);
        if (!r.ok) { flash(r.msg); break; }
        ui.story = { pid: id, title: r.title, chap: r.chap, text: r.text, bonus: r.bonus, scandal: r.scandal };
        if (r.scene) ui.scene = { pid: id, level: r.scene.level, line: r.scene.line };
        break;
      case "close-story": ui.story = null; break;
      case "close-quote": ui.quote = null; break;
      case "offer-yes": Core.answerOffer(true); break;
      case "offer-no": Core.answerOffer(false); break;
      case "dinner": r = Core.teamDinner(); afterAct(r); break;
      case "advance":
        if (Core.advance()) { var w = Core.week(); flash(weekLabel()); if (w.k === "off") ui.tab = "records"; else ui.tab = "home"; }
        break;
      case "match": Core.startSeries(false); ui.screen = "draft"; ui.selHero = null; ui.roleFilter = "all"; break;
      case "resume": ui.screen = Core.draftDone() ? "tactic" : "draft"; break;
      case "auto": runAuto(); break;
      case "auto-rest": runAuto(); break;
      case "rolefilter": ui.roleFilter = id; break;
      case "hero": ui.selHero = id; break;
      case "suggest":
        var turn = Core.draftTurn();
        if (turn) { ui.selHero = Core.aiChoose(turn[0]); if (ui.selHero) ui.roleFilter = turn[1] === "pick" ? D.HERO[ui.selHero].role : "all"; }
        break;
      case "confirm-hero": if (ui.selHero && doDraft(ui.selHero)) { ui.selHero = null; Core.save(); } break;
      case "tactic": ui.tactic = id; break;
      case "to-pre": if (ui.tactic) { ui.screen = "pre"; ui.preLines = null; } break;
      case "back-tactic": ui.screen = "tactic"; break;
      case "play":
        ui.lastGame = Core.playGame(ui.tactic);
        ui.screen = "replay"; break;
      case "rp-next": if (ui.replay) ui.replay.next(); return;
      case "rp-skip": if (ui.replay) ui.replay.skip(); else { ui.screen = "result"; } return;
      case "next-game": ui.screen = "draft"; ui.selHero = null; ui.roleFilter = "all"; ui.tactic = null; break;
      case "to-hub": ui.screen = "hub"; ui.tab = "home"; break;
      default: return;
    }
    render();
  }
  function afterAct(r) {
    if (!r) return;
    if (r.msg) flash(r.msg);
    if (r.ok && r.scene && ui.modal) ui.scene = { pid: ui.modal, level: r.scene.level, line: r.scene.line };
  }
  app.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-act]");
    if (!el || !app.contains(el) || el.tagName === "SELECT") return;
    if (el.disabled) return;
    handle(el.getAttribute("data-act"), el, ev);
  });
  app.addEventListener("change", function (ev) {
    var el = ev.target;
    var act = el.getAttribute && el.getAttribute("data-act");
    if (act === "leagueview") { ui.leagueView = el.value; render(); }
    else if (act === "practice") { Core.setPractice(el.getAttribute("data-id"), el.value); flash(t("practice_set")); render(); }
  });
  window.addEventListener("i18n:change", function () { if (ui.screen !== "replay") render(); });

  // 有存檔時直接回到總覽
  if (Core.hasSave() && Core.load()) {
    ui.screen = "hub";
    var s0 = S();
    if (s0.series && !Core.seriesOver()) ui.screen = "hub";
  }
  render();
})();
