// 大名幸村（yukimura）：畫面。規則在 yukimura_core.js、3D 在 yukimura_3d.js、連線在 yukimura_net.js。
//
// 「場次」（sess）把單機與連線包成同一個介面：
//   sess.host＝要不要跑模擬（單機、連線房主）；sess.s＝模擬中的完整狀態；sess.view＝畫面用的狀態（房主就是 s，其他人是快照）
//   sess.send(意圖)：單機直接 Core.applyIntent；房主套用；其他人送給房主。
// 移動：每個人自己算自己的位置（搖桿／鍵盤），連線時每 0.1 秒送給房主；房主用它判定碰撞與拾取。
(function () {
  "use strict";

  var D = window.PriTestYukimuraData, Core = window.PriTestYukimuraCore, V3 = window.PriTestYukimura3D, Net = window.PriTestYukimuraNet;
  var TK = window.PriTestYukimuraTenka, TKUI = window.PriTestYukimuraTenkaUI;   // 新模式「天下布武」
  var app = document.getElementById("yk-app");
  if (!app) return;
  var PREF_KEY = "pritest-yukimura-pref", NAME_KEY = "pritest-yukimura-name", PROG_KEY = "pritest-yukimura-progress";
  var STEP = 1 / 30;
  var L = D.L;

  function t(k, p) { return window.I18N.t(k, p || {}); }
  function lsGet(k) { try { return window.localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (e) { /* 存不了也能玩 */ } }
  function jget(k, d) { try { return JSON.parse(lsGet(k) || "null") || d; } catch (e) { return d; } }
  function pref() { return jget(PREF_KEY, {}); }
  function setPref(p) { var o = pref(); Object.keys(p).forEach(function (k) { o[k] = p[k]; }); lsSet(PREF_KEY, JSON.stringify(o)); }
  function progress() {
    var pg = jget(PROG_KEY, {});
    ["meta", "cleared", "best", "used"].forEach(function (k) { if (!pg[k] || typeof pg[k] !== "object") pg[k] = {}; });
    pg.bank = Number(pg.bank) || 0; pg.games = pg.games | 0; pg.wins = pg.wins | 0; pg.kills = pg.kills | 0;
    return pg;
  }
  function saveProgress(pg) { lsSet(PROG_KEY, JSON.stringify(pg)); }
  // 新模式「天下布武」的存檔：軍功（新幣別）、軍略樹、符文背包與符文格配置
  var TK_KEY = "pritest-yukimura-tenka";
  function tkProgress() {
    var tp = jget(TK_KEY, {});
    if (!tp.tree || typeof tp.tree !== "object") tp.tree = {};
    if (!tp.best || typeof tp.best !== "object") tp.best = {};
    if (!tp.saved || typeof tp.saved !== "object") tp.saved = {};
    if (!Array.isArray(tp.inv)) tp.inv = [];
    if (!Array.isArray(tp.board)) tp.board = [];
    tp.kg = Number(tp.kg) || 0; tp.nu = tp.nu | 0; tp.heat = tp.heat | 0; tp.games = tp.games | 0; tp.wins = tp.wins | 0;
    tp.inv = tp.inv.filter(function (r) { return r && TK.RUNE[r.k]; });
    var have = {};
    tp.inv.forEach(function (r) { have[r.u] = 1; });
    tp.board = tp.board.filter(function (b) { return b && have[b.u] && TK.RUNE[b.k]; });
    // 第一次進入：送 5 個入門符文，讓玩家先試著拼
    if (!tp.starter) { tp.starter = 1; ["bu", "ju", "soku", "kou", "kin"].forEach(function (k) { TKUI.addRune(tp, k); }); lsSet(TK_KEY, JSON.stringify(tp)); }
    return tp;
  }
  function saveTk(tp) { lsSet(TK_KEY, JSON.stringify(tp)); }
  // 救出令的村姑插圖（時間管理大師 jikan 的女生圖）
  var IMG_BASE = app.getAttribute("data-img") || "../static/images/jikan/";
  function musumeSrc(i) { return i === undefined || i === null ? "" : IMG_BASE + TK.musumeImg(i) + ".webp"; }
  // 出陣時帶進對局的 meta：原本的本陣強化＋天下布武的軍略（tk）
  function sortieMeta(mode) {
    var m = {}, pm = progress().meta;
    Object.keys(pm).forEach(function (k) { m[k] = pm[k]; });
    if (mode === "tenka") m.tk = TK.loadout(tkProgress());
    return m;
  }
  function unlockedStage(pg) { var n = 0; for (var i = 0; i < D.STAGES.length; i++) if (pg.cleared[i]) n = i + 1; return Math.min(D.STAGES.length - 1, n); }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k === "style") e.setAttribute("style", v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return e;
  }
  function btn(label, onclick, cls, attrs) {
    var a = { type: "button", class: cls || "yk-btn", onclick: onclick };
    Object.keys(attrs || {}).forEach(function (k) { a[k] = attrs[k]; });
    return el("button", a, [label]);
  }
  function panel(title, children, cls) { return el("section", { class: "yk-panel " + (cls || "") }, [title ? el("h2", null, [title]) : null].concat(children)); }
  function hex(c) { return "#" + ("000000" + (c >>> 0).toString(16)).slice(-6); }
  function mmss(sec) { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ":" + ("0" + (sec % 60)).slice(-2); }
  function seg(items, value, onpick) {
    return el("div", { class: "yk-seg" }, items.map(function (it) { return btn(it[1], function () { onpick(it[0]); }, "yk-btn" + (String(it[0]) === String(value) ? " yk-on" : "")); }));
  }
  function statText(k, v) {
    var s = D.STAT[k];
    if (!s) return "";
    if (s.pct) return L(s.name) + " " + (k === "cdr" ? "-" : "+") + Math.round(v * 100) + "%";
    return L(s.name) + " +" + (Math.round(v * 100) / 100);
  }
  function crestBadge(d, big) {
    return el("span", { class: "yk-crest" + (big ? " yk-crest-big" : ""), style: "background:" + hex(d.color) + ";border-color:" + hex(d.accent) + ";color:" + hex(d.accent) }, [L(d.name).charAt(0)]);
  }
  function weaponName(id, evo) { var W = D.WEAPONS[id]; return evo ? L(D.ARCHES[W.a].evoName) : L(W.name); }

  var p0 = pref();
  var ui = {
    screen: "home", dm: D.DAIMYO[p0.dm] ? p0.dm : 0, stage: p0.stage | 0, map: p0.map === undefined ? -1 : p0.map, diff: p0.diff || "normal",
    dur: p0.dur || 900, quality: p0.quality || (window.innerWidth < 700 ? "low" : "high"), codex: "daimyo", room: null, paused: false, dmFilter: "",
    tkTab: "sortie", tkCtx: {}, mode: p0.mode === "tenka" ? "tenka" : "normal"
  };
  var sess = null, view3 = null;

  // ---------------- 首頁 ----------------
  function render() {
    if (ui.screen !== "game") stopGame();
    app.innerHTML = "";
    // 在房間中暫離（本陣、天下布武、圖鑑、單機設定）：返回鍵改成「回到房間」，上方顯示房間橫幅
    var away = ui.room && AWAY_SCREENS[ui.screen];
    var top = el("div", { class: "yk-top" }, [el("h1", { class: "yk-title" }, [t("yk_title")]), ui.screen !== "home" ? (away ? btn("🔗 " + t("yk_back_room"), backToRoom, "yk-link") : btn(t("yk_back"), goHome, "yk-link")) : null]);
    app.appendChild(top);
    if (away) app.appendChild(roomBanner());
    if (ui.screen === "home") renderHome();
    else if (ui.screen === "setup") renderSetup(false);
    else if (ui.screen === "lobby") renderLobby();
    else if (ui.screen === "codex") renderCodex();
    else if (ui.screen === "meta") renderMeta();
    else if (ui.screen === "tenka") renderTenka();
    else if (ui.screen === "result") renderResult();
  }
  // ---------------- 房間暫離與回來（2026-11-06 使用者：在房間時去本陣再回來要自動連上）----------------
  var AWAY_SCREENS = { meta: 1, tenka: 1, codex: 1, setup: 1 };
  var ROOM_KEY = "pritest-yukimura-room";
  function goAway(screen, tab) {
    if (ui.room && !ui.room.missing) ui.room.update({ aw: 1 });
    ui.screen = screen;
    if (tab) ui.tkTab = tab;
    render();
  }
  function backToRoom() {
    var r = ui.room;
    if (!r) { goHome(); return; }
    r.update({ aw: 0, meta: sortieMeta("tenka") });
    if (r.status() === "game") { startNet(); return; }
    ui.screen = "lobby";
    render();
  }
  function roomBanner() {
    var r = ui.room, inGame = r.status() === "game";
    return el("div", { class: "yk-roombar" }, [
      el("span", null, ["🔗 " + t("yk_room_away", { n: r.list().length })]),
      inGame ? el("strong", { class: "yk-good" }, ["⚔️ " + t("yk_room_ingame")]) : null,
      btn(inGame ? "⚔️ " + t("yk_room_join") : "🔗 " + t("yk_back_room"), backToRoom, "yk-btn yk-primary")
    ]);
  }
  function rememberRoom(id) { lsSet(ROOM_KEY, id ? JSON.stringify({ id: id, t: Date.now() }) : null); }
  function recentRoom() { var o = jget(ROOM_KEY, null); return o && o.id && Date.now() - o.t < 30 * 60 * 1000 ? o.id : null; }
  function goHome() {
    if (ui.room) { ui.room.close(); ui.room = null; rememberRoom(null); }
    if (window.location.search.indexOf("room=") >= 0) window.history.replaceState(null, "", window.location.pathname);
    ui.screen = "home";
    render();
  }
  function renderHome() {
    var pg = progress();
    app.appendChild(el("div", { class: "yk-hero" }, [
      el("div", { class: "yk-hero-art", html: heroSvg() }),
      el("div", null, [el("p", { class: "yk-intro" }, [t("yk_intro")]), el("p", { class: "yk-small yk-muted" }, [t("yk_home_meta", { g: pg.games, w: pg.wins, c: Object.keys(pg.cleared).length, b: Math.floor(pg.bank) })])])
    ]));
    app.appendChild(el("div", { class: "yk-menu" }, [
      btn("⚔️ " + t("yk_menu_solo"), function () { ui.screen = "setup"; render(); }, "yk-big yk-primary-soft"),
      btn("🎴 " + t("yk_menu_tenka"), function () { ui.screen = "tenka"; ui.tkTab = "sortie"; render(); }, "yk-big yk-tk-menu"),
      recentRoom() ? btn("🔗 " + t("yk_room_rejoin", { id: recentRoom().slice(-4) }), function () { openRoom(recentRoom()); }, "yk-big yk-primary-soft") : null,
      btn("🤝 " + t("yk_menu_coop"), function () { openRoom(null); }, "yk-big"),
      btn("🏯 " + t("yk_menu_meta"), function () { ui.screen = "meta"; render(); }, "yk-big"),
      btn("📜 " + t("yk_menu_codex"), function () { ui.screen = "codex"; render(); }, "yk-big")
    ]));
    app.appendChild(panel(t("yk_how_title"), [el("ol", { class: "yk-rules" }, [1, 2, 3, 4, 5, 6, 7].map(function (i) { return el("li", null, [t("yk_help_" + i)]); }))]));
    app.appendChild(el("div", { class: "yk-field" }, [t("yk_quality"), seg([["high", t("yk_q_high")], ["low", t("yk_q_low")]], ui.quality, function (q) { ui.quality = q; setPref({ quality: q }); render(); })]));
  }
  function heroSvg() {
    return '<svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="ykg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2340"/><stop offset="1" stop-color="#7a2a2a"/></linearGradient></defs>' +
      '<rect width="320" height="180" fill="url(#ykg)"/><circle cx="250" cy="48" r="26" fill="#f4e7c0" opacity="0.9"/>' +
      '<path d="M0 150 L60 100 L110 135 L170 80 L230 130 L280 95 L320 125 L320 180 L0 180Z" fill="#141a2a"/>' +
      '<g transform="translate(150 70)"><rect x="-14" y="30" width="28" height="40" fill="#c0262d"/><rect x="-18" y="66" width="36" height="16" fill="#8a1a1e"/><circle cx="0" cy="20" r="12" fill="#e8c8a0"/><path d="M-16 18 A16 16 0 0 1 16 18Z" fill="#1a1a1e"/>' +
      '<path d="M-6 6 L-20 -18 M6 6 L20 -18" stroke="#3a2a1a" stroke-width="3"/><g fill="#e8c547">' + [0, 1, 2, 3, 4, 5].map(function (i) { return '<circle cx="' + ((i % 3 - 1) * 6) + '" cy="' + (10 + Math.floor(i / 3) * 5) + '" r="2.2"/>'; }).join("") + '</g>' +
      '<line x1="18" y1="40" x2="48" y2="-30" stroke="#5a3a22" stroke-width="3"/><path d="M46 -34 L52 -46 L50 -30Z" fill="#dde"/><rect x="-4" y="-40" width="2" height="70" fill="#3a2a1a" transform="translate(-12 10)"/><rect x="-30" y="-30" width="16" height="24" fill="#c0262d" transform="translate(0 10)"/></g>' +
      '<g fill="#2a1a1a" opacity="0.9">' + [30, 60, 240, 280, 300].map(function (x, i) { return '<g transform="translate(' + x + ' ' + (128 + i % 2 * 6) + ')"><rect x="-4" y="0" width="8" height="14"/><circle cx="0" cy="-3" r="4"/><path d="M-7 -4 L0 -10 L7 -4Z"/></g>'; }).join("") + '</g>' +
      '<text x="16" y="34" font-size="26" font-weight="bold" fill="#f4e7c0" font-family="serif">大名幸村</text><text x="18" y="54" font-size="11" fill="#e8c547" font-family="serif">東北十五分間の戦</text></svg>';
  }

  // ---------------- 出陣準備（單機）／大名選擇 ----------------
  function daimyoPicker(value, onpick) {
    var d = D.DAIMYO[value] || D.DAIMYO[0];
    var wrap = el("div", { class: "yk-dmpick" });
    var img = el("img", { class: "yk-portrait", alt: L(d.name) });
    var detail = el("div", { class: "yk-dmdetail" }, [
      el("div", { class: "yk-dmhead" }, [crestBadge(d, true), el("div", null, [el("strong", { class: "yk-dmname" }, [L(d.name)]), el("div", { class: "yk-small yk-muted" }, [L(d.title)])])]),
      el("div", { class: "yk-small" }, [t("yk_dm_start"), " ", D.WEAPONS[d.start].icon, " ", L(D.WEAPONS[d.start].name)]),
      el("div", { class: "yk-small" }, [t("yk_dm_trait"), " ", statText(d.trait[0], d.trait[1])]),
      el("div", { class: "yk-small" }, [t("yk_dm_ult"), " ", D.ULTS[d.ult].icon, " ", L(D.ULTS[d.ult].name), "：", L(D.ULTS[d.ult].desc)])
    ]);
    wrap.appendChild(el("div", { class: "yk-dmtop" }, [img, detail]));
    V3.load().then(function () { var u = V3.portrait(value, 240); if (u) img.src = u; }).catch(function () { img.style.display = "none"; });
    var filter = el("input", { class: "yk-input", placeholder: t("yk_dm_search"), value: ui.dmFilter || "" });
    var grid = el("div", { class: "yk-dmgrid" });
    var kinds = el("div", { class: "yk-seg" });
    function fillKinds() {
      kinds.innerHTML = "";
      [[-1, t("yk_dm_all")]].concat(D.DM_KINDS.map(function (k, i) { return [i, L(k) + "（" + D.DAIMYO.filter(function (x) { return x.k === i; }).length + "）"]; })).forEach(function (it) {
        kinds.appendChild(btn(it[1], function () { ui.dmKind = it[0]; fillKinds(); fill(); }, "yk-btn" + ((ui.dmKind === undefined ? -1 : ui.dmKind) === it[0] ? " yk-on" : "")));
      });
    }
    function fill() {
      grid.innerHTML = "";
      var q = String(filter.value || "").trim(), kd = ui.dmKind === undefined ? -1 : ui.dmKind;
      D.DAIMYO.forEach(function (x) {
        if (kd >= 0 && x.k !== kd) return;
        if (q && (L(x.name) + x.name.ja + x.name.zh + L(x.title)).indexOf(q) < 0) return;
        grid.appendChild(el("button", { type: "button", class: "yk-dmcard" + (x.i === value ? " yk-on" : ""), title: L(x.title), onclick: function () { ui.dmFilter = filter.value; onpick(x.i); } }, [crestBadge(x), el("span", { class: "yk-dmcard-name" }, [L(x.name)]), el("span", { class: "yk-dmcard-w" }, [D.WEAPONS[x.start].icon])]));
      });
    }
    filter.addEventListener("input", fill);
    fillKinds();
    fill();
    wrap.appendChild(el("div", { class: "yk-field" }, [t("yk_dm_count", { n: D.DAIMYO.length }), filter]));
    wrap.appendChild(el("div", { class: "yk-field" }, [kinds]));
    wrap.appendChild(grid);
    return wrap;
  }
  function stagePicker(stage, map, onStage, onMap, maxStage) {
    var wrap = el("div", { class: "yk-stages" });
    D.STAGES.forEach(function (st, i) {
      var locked = i > maxStage;
      var pg = progress();
      var card = el("button", { type: "button", class: "yk-stage" + (i === stage ? " yk-on" : ""), disabled: locked, onclick: function () { onStage(i); }, style: "border-left-color:" + hex(st.color) }, [
        el("div", { class: "yk-stage-h" }, [el("span", { class: "yk-stage-n" }, [t("yk_stage_n", { n: i + 1 })]), " ", D.FEATS[st.feat].icon, " ", el("strong", null, [L(st.name)]), pg.cleared[i] ? el("span", { class: "yk-chip yk-good" }, ["✓ " + L(D.DIFFS[pg.cleared[i]] ? D.DIFFS[pg.cleared[i]].name : D.DIFFS.normal.name)]) : null]),
        el("div", { class: "yk-small yk-muted" }, [locked ? t("yk_locked") : L(st.desc)]),
        el("div", { class: "yk-small" }, [t("yk_boss"), " ", L(D.BOSSES[st.boss].name)])
      ]);
      wrap.appendChild(card);
    });
    var st = D.STAGES[stage];
    var maps = el("div", { class: "yk-field" }, [t("yk_map"), seg([[-1, t("yk_map_random")]].concat(st.maps.map(function (m) { return [m, L(D.MAPS[m].name) + "（" + L(D.PREFS[D.MAPS[m].pref].name) + "）"]; })), map, onMap)]);
    return el("div", null, [wrap, maps]);
  }
  function renderSetup() {
    var pg = progress(), maxSt = unlockedStage(pg);
    if (ui.stage > maxSt) ui.stage = maxSt;
    app.appendChild(panel(t("yk_pick_daimyo"), [daimyoPicker(ui.dm, function (i) { ui.dm = i; setPref({ dm: i }); render(); })]));
    app.appendChild(panel(t("yk_pick_stage"), [
      stagePicker(ui.stage, ui.map, function (i) { ui.stage = i; ui.map = -1; setPref({ stage: i, map: -1 }); render(); }, function (m) { ui.map = Number(m); setPref({ map: ui.map }); render(); }, maxSt),
      el("div", { class: "yk-field" }, [t("yk_diff"), seg(Object.keys(D.DIFFS).map(function (k) { return [k, L(D.DIFFS[k].name)]; }), ui.diff, function (k) { ui.diff = k; setPref({ diff: k }); render(); })]),
      el("div", { class: "yk-field" }, [t("yk_dur"), seg([[900, t("yk_dur_15")], [300, t("yk_dur_5")]], ui.dur, function (k) { ui.dur = Number(k); setPref({ dur: ui.dur }); render(); })]),
      el("p", { class: "yk-small yk-muted" }, [t("yk_dur_note")]),
      el("div", { class: "yk-actions yk-next" }, [ui.room ? btn("🔗 " + t("yk_back_room"), backToRoom, "yk-btn yk-primary") : btn("⚔️ " + t("yk_start"), function () { startSolo("normal"); }, "yk-btn yk-primary")])
    ]));
  }

  // ---------------- 本陣強化 ----------------
  function renderMeta() {
    var pg = progress();
    var rows = D.META.map(function (m) {
      var lv = pg.meta[m.k] | 0, cost = Math.round(m.cost * Math.pow(1.6, lv));
      return el("div", { class: "yk-meta-row" }, [
        el("div", { class: "yk-grow" }, [el("strong", null, [L(m.name)]), " ", el("span", { class: "yk-small yk-muted" }, [m.k === "revive" || m.k === "reroll" ? "" : statText(m.k, m.v) + " / Lv"]), el("div", { class: "yk-pips" }, Array.apply(null, Array(m.max)).map(function (_, i) { return el("span", { class: "yk-pip" + (i < lv ? " yk-pip-on" : "") }); }))]),
        lv >= m.max ? el("span", { class: "yk-chip" }, [t("yk_max")]) : btn("💰 " + cost, function () { var p2 = progress(); if (p2.bank < cost) return; p2.bank -= cost; p2.meta[m.k] = lv + 1; saveProgress(p2); render(); }, "yk-btn", { disabled: pg.bank < cost })
      ]);
    });
    app.appendChild(panel(t("yk_menu_meta"), [el("p", { class: "yk-small" }, [t("yk_meta_note", { b: Math.floor(pg.bank) })])].concat(rows, [
      el("div", { class: "yk-actions" }, [btn(t("yk_meta_reset"), function () { if (!window.confirm(t("yk_meta_reset_q"))) return; var p2 = progress(); var back = 0; D.META.forEach(function (m) { for (var i = 0; i < (p2.meta[m.k] | 0); i++) back += Math.round(m.cost * Math.pow(1.6, i)); }); p2.bank += back; p2.meta = {}; saveProgress(p2); render(); }, "yk-link")])
    ])));
  }

  // ---------------- 新模式「天下布武」：出陣／軍略樹／符文格／說明 ----------------
  function tkCtx() {
    var c = ui.tkCtx;
    c.el = el; c.btn = btn; c.t = t; c.L = L; c.hex = hex; c.statText = statText;
    c.get = tkProgress; c.save = saveTk; c.rerender = render;
    return c;
  }
  function renderTenka() {
    var tp = tkProgress(), pg = progress();
    app.appendChild(el("div", { class: "yk-tk-head" }, [
      el("div", null, [el("strong", { class: "yk-tk-title" }, ["🎴 " + t("yk_menu_tenka")]), el("div", { class: "yk-small yk-muted" }, [t("yk_tk_intro")])]),
      el("div", { class: "yk-tk-wallet" }, [el("span", { class: "yk-chip yk-tk-kg" }, ["🎖️ " + Math.floor(tp.kg)]), el("span", { class: "yk-chip" }, ["💰 " + Math.floor(pg.bank)])])
    ]));
    app.appendChild(el("div", { class: "yk-field" }, [seg([["sortie", "⚔️ " + t("yk_tk_tab_sortie")], ["tree", "🏯 " + t("yk_tk_tab_tree")], ["runes", "🔲 " + t("yk_tk_tab_runes")], ["guide", "📜 " + t("yk_tk_tab_guide")]], ui.tkTab, function (k) { ui.tkTab = k; render(); })]));
    if (ui.tkTab === "tree") { app.appendChild(panel(t("yk_tk_tab_tree"), [el("p", { class: "yk-small" }, [t("yk_tk_tree_note")]), TKUI.Tree(tkCtx())])); return; }
    if (ui.tkTab === "runes") { app.appendChild(panel(t("yk_tk_tab_runes"), [el("p", { class: "yk-small" }, [t("yk_tk_runes_note")]), TKUI.Board(tkCtx())])); return; }
    if (ui.tkTab === "guide") { renderTenkaGuide(); return; }
    // 出陣
    var maxSt = unlockedStage(pg);
    if (ui.stage > maxSt) ui.stage = maxSt;
    var lo = TK.loadout(tp), metaN = 0;
    D.META.forEach(function (m) { metaN += pg.meta[m.k] | 0; });
    var treeN = 0;
    Object.keys(tp.tree).forEach(function (k) { treeN += tp.tree[k] | 0; });
    var hm = TK.heatMul(tp.heat);
    app.appendChild(panel(t("yk_tk_carry_title"), [
      el("ul", { class: "yk-rules" }, [
        el("li", null, [t("yk_tk_carry_meta", { n: metaN })]),
        el("li", null, [t("yk_tk_carry_tree", { n: treeN })]),
        el("li", null, [t("yk_tk_carry_runes", { n: lo.runes.length, l: lo.lines }), lo.perfect ? el("span", { class: "yk-chip yk-good" }, ["🌟 " + t("yk_tk_perfect")]) : null]),
        el("li", null, [t("yk_tk_carry_extra", { b: TK.treeSp(tp.tree, "ban"), s: TK.treeSp(tp.tree, "skip"), a: 3 + Math.min(1, TK.treeSp(tp.tree, "arcN")) })])
      ]),
      el("div", { class: "yk-actions" }, [btn("🏯 " + t("yk_tk_tab_tree"), function () { ui.tkTab = "tree"; render(); }, "yk-btn"), btn("🔲 " + t("yk_tk_tab_runes"), function () { ui.tkTab = "runes"; render(); }, "yk-btn"), btn("🏯 " + t("yk_menu_meta"), function () { ui.screen = "meta"; render(); }, "yk-btn")])
    ]));
    app.appendChild(panel(t("yk_pick_daimyo"), [daimyoPicker(ui.dm, function (i) { ui.dm = i; setPref({ dm: i }); render(); })]));
    app.appendChild(panel(t("yk_pick_stage"), [
      stagePicker(ui.stage, ui.map, function (i) { ui.stage = i; ui.map = -1; setPref({ stage: i, map: -1 }); render(); }, function (m) { ui.map = Number(m); setPref({ map: ui.map }); render(); }, maxSt),
      el("div", { class: "yk-field" }, [t("yk_diff"), seg(Object.keys(D.DIFFS).map(function (k) { return [k, L(D.DIFFS[k].name)]; }), ui.diff, function (k) { ui.diff = k; setPref({ diff: k }); render(); })]),
      el("div", { class: "yk-field" }, [t("yk_dur"), seg([[900, t("yk_dur_15")], [300, t("yk_dur_5")]], ui.dur, function (k) { ui.dur = Number(k); setPref({ dur: ui.dur }); render(); })]),
      el("div", { class: "yk-field" }, [t("yk_tk_heat"), seg([0, 1, 2, 3, 4, 5].map(function (h) { return [h, h ? "🐉" + h : t("yk_tk_heat0")]; }), tp.heat, function (h) { var p2 = tkProgress(); p2.heat = Number(h); saveTk(p2); render(); })]),
      el("p", { class: "yk-small yk-muted" }, [t("yk_tk_heat_note", { hp: Math.round((hm.hp - 1) * 100), d: Math.round((hm.dmg - 1) * 100), m: Math.round((hm.medal - 1) * 100) })]),
      el("div", { class: "yk-actions yk-next" }, [
        ui.room ? btn("🔗 " + t("yk_back_room"), backToRoom, "yk-btn yk-primary") : btn("⚔️ " + t("yk_start"), function () { startSolo("tenka"); }, "yk-btn yk-primary"),
        ui.room ? null : btn("🤝 " + t("yk_menu_coop"), function () { ui.mode = "tenka"; setPref({ mode: "tenka" }); openRoom(null); }, "yk-btn")
      ])
    ]));
  }
  function renderTenkaGuide() {
    var body = [el("ul", { class: "yk-rules" }, [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return el("li", null, [t("yk_tk_help_" + i)]); }))];
    body.push(panel(t("yk_tk_arcana", { n: TK.ARCANA.length }), [el("div", { class: "yk-cxgrid" }, TK.ARCANA.map(function (a) { return el("div", { class: "yk-cx" }, [el("strong", null, [a.icon, " ", L(a.name)]), el("div", { class: "yk-small" }, [L(a.desc)])]); }))]));
    body.push(panel(t("yk_tk_schools"), [el("div", { class: "yk-cxgrid" }, TK.SCHOOLS.map(function (sc) {
      return el("div", { class: "yk-cx", style: "border-left:4px solid " + hex(sc.color) }, [el("strong", null, [sc.icon, " ", L(sc.name)]),
        el("div", { class: "yk-small" }, [sc.arches.map(function (k) { var A = D.ARCHES.filter(function (x) { return x.k === k; })[0]; return A ? A.icon + L(A.name) : k; }).join("・")]),
        el("div", { class: "yk-small" }, sc.tiers.map(function (tier, i) { return el("div", null, [t("yk_tk_tier", { n: TK.TIER_N[i] }), "：", tier.map(function (b) { return statText(b[0], b[1]); }).join("・")]); })),
        el("div", { class: "yk-small yk-muted" }, [L(sc.desc)])]);
    }))]));
    body.push(panel(t("yk_tk_runelist", { n: TK.RUNES.length }), [el("div", { class: "yk-cxgrid" }, TK.RUNES.map(function (r) {
      return el("div", { class: "yk-cx" }, [el("div", { class: "yk-dmhead" }, [el("span", { class: "yk-tk-shape", html: TKUI.shapeSvg(r.k, 0, 11, tkCtx()) }), el("strong", null, [L(r.name)]), el("span", { class: "yk-chip" }, ["★".repeat(r.r)])]), el("div", { class: "yk-small" }, [TKUI.runeDesc(tkCtx(), r.k)])]);
    }))]));
    var sv = tkProgress().saved || {}, svk = Object.keys(sv);
    body.push(panel(t("yk_tk_book", { n: svk.length, m: TK.MUSUME_N }), [el("p", { class: "yk-small yk-muted" }, [t("yk_tk_book_note")]),
      svk.length ? el("div", { class: "yk-tk-faces" }, svk.map(Number).sort(function (a, b) { return a - b; }).map(function (i) { return el("figure", { class: "yk-tk-fig" }, [el("img", { src: musumeSrc(i), alt: "", class: "yk-tk-face-big", loading: "lazy" }), el("figcaption", { class: "yk-small" }, [L(TK.musumeName(i)) + (sv[i] > 1 ? " ×" + sv[i] : "")])]); })) : el("p", { class: "yk-muted" }, [t("yk_tk_book_empty")])]));
    body.push(panel(t("yk_tk_events"), [el("ul", { class: "yk-rules" }, TK.EVENTS.map(function (ev) { return el("li", null, [ev.icon + " " + L(ev.name) + "：" + t("yk_tk_evd_" + ev.k)]); }))]));
    body.push(panel(t("yk_tk_enemies"), [el("div", { class: "yk-cxgrid" }, Object.keys(D.ENEMIES).filter(function (k) { return D.ENEMIES[k].tk; }).map(function (k) {
      var e = D.ENEMIES[k], f = e.f || {};
      return el("div", { class: "yk-cx" }, [el("strong", null, [L(e.name)]), el("div", { class: "yk-small" }, ["HP " + e.hp + "・" + t("yk_speed") + " " + e.spd + (f.charge ? "・" + t("yk_f_charge") : "") + (f.armor ? "・" + t("yk_f_armor") : "")])]);
    }))]));
    body.push(panel(t("yk_tk_affix"), [el("div", { class: "yk-chips" }, TK.AFFIX.map(function (a) { return el("span", { class: "yk-chip" }, [a.icon + " " + L(a.name) + "：" + t("yk_tk_af_" + a.k)]); }))]));
    app.appendChild(panel(t("yk_tk_tab_guide"), body));
  }

  // ---------------- 圖鑑 ----------------
  function renderCodex() {
    var tabs = [["daimyo", t("yk_cx_daimyo")], ["weapons", t("yk_cx_weapons")], ["accs", t("yk_cx_accs")], ["foods", t("yk_cx_foods")], ["enemies", t("yk_cx_enemies")], ["stages", t("yk_cx_stages")], ["skills", t("yk_cx_skills")], ["rules", t("yk_cx_rules")]];
    app.appendChild(el("div", { class: "yk-field" }, [seg(tabs, ui.codex, function (k) { ui.codex = k; render(); })]));
    var c = ui.codex, body = [];
    if (c === "daimyo") {
      body.push(el("p", { class: "yk-small yk-muted" }, [t("yk_dm_count", { n: D.DAIMYO.length })]));
      body.push(el("div", { class: "yk-cxgrid" }, D.DAIMYO.map(function (d) {
        return el("div", { class: "yk-cx" }, [el("div", { class: "yk-dmhead" }, [crestBadge(d), el("div", null, [el("strong", null, [L(d.name)]), " ", el("span", { class: "yk-chip" }, [L(D.DM_KINDS[d.k])]), el("div", { class: "yk-small yk-muted" }, [L(d.title)])])]),
          el("div", { class: "yk-small" }, [D.WEAPONS[d.start].icon, " ", L(D.WEAPONS[d.start].name), "・", statText(d.trait[0], d.trait[1])]),
          el("div", { class: "yk-small" }, [D.ULTS[d.ult].icon, " ", L(D.ULTS[d.ult].name)])]);
      })));
    } else if (c === "weapons") {
      body.push(el("p", { class: "yk-small yk-muted" }, [t("yk_cx_weapons_note", { n: D.WEAPONS.length })]));
      body.push(el("div", { class: "yk-cxgrid" }, D.ARCHES.map(function (a, ai) {
        return el("div", { class: "yk-cx" }, [el("strong", null, [a.icon, " ", L(a.name)]), el("div", { class: "yk-small" }, [L(a.desc)]),
          el("div", { class: "yk-small yk-evo" }, ["★ ", L(a.evoName), "：", t("yk_evo_need", { s: L(D.STAT[a.evo].name) })]),
          el("div", { class: "yk-chips" }, D.VARIANTS.map(function (v, vi) { return el("span", { class: "yk-chip", title: L(v.desc), style: "border-color:" + hex(v.color) }, [L(D.WEAPONS[ai * 10 + vi].name)]); }))]);
      })));
      body.push(panel(t("yk_cx_variants"), [el("div", { class: "yk-cxgrid" }, D.VARIANTS.map(function (v) { return el("div", { class: "yk-cx", style: "border-left:4px solid " + hex(v.color) }, [el("strong", null, [L(v.name), "（", L(D.PREFS[v.pref].name), "）"]), el("div", { class: "yk-small" }, [L(v.desc)])]); }))]));
    } else if (c === "accs") {
      body.push(el("p", { class: "yk-small yk-muted" }, [t("yk_cx_accs_note", { n: D.ACCS.length, c: D.CRAFTS.length, s: D.STATS.length })]));
      body.push(el("div", { class: "yk-cxgrid" }, D.CRAFTS.map(function (cr, ci) {
        return el("div", { class: "yk-cx" }, [el("strong", null, [L(cr.name)]), " ", el("span", { class: "yk-chip" }, [L(D.PREFS[cr.pref].name)]), " ", el("span", { class: "yk-chip yk-r" + cr.r }, ["★".repeat(cr.r)]),
          el("div", { class: "yk-small" }, [t("yk_acc_sec", { s: L(D.STAT[cr.sec].name) })]),
          el("details", null, [el("summary", { class: "yk-small" }, [t("yk_acc_list", { n: D.STATS.length })]), el("div", { class: "yk-small" }, D.STATS.map(function (s, si) { var a = D.ACCS[ci * 20 + si]; return el("div", null, [s.icon, " ", L(a.name), "：", Object.keys(D.accStats(a.id, 1)).map(function (k) { return statText(k, D.accStats(a.id, 1)[k]); }).join("・")]); }))])]);
      })));
    } else if (c === "skills") {
      body.push(el("p", { class: "yk-small yk-muted" }, [t("yk_cx_mods_note", { n: Object.keys(D.MODS).length, m: D.MAX_MOD })]));
      body.push(el("div", { class: "yk-cxgrid" }, Object.keys(D.MODS).map(function (k) { var m = D.MODS[k]; return el("div", { class: "yk-cx" }, [el("strong", null, [m.icon, " ", L(m.name)]), el("div", { class: "yk-small" }, [L(m.desc)]), m.proj ? el("div", { class: "yk-small yk-muted" }, [t("yk_mod_proj")]) : null]); })));
      body.push(panel(t("yk_cx_syn", { n: D.SYNERGY.length }), [el("div", { class: "yk-cxgrid" }, D.SYNERGY.map(function (y) {
        var A = D.ARCHES.filter(function (x) { return x.k === y.a; })[0], B = D.ARCHES.filter(function (x) { return x.k === y.b; })[0];
        var eff = [];
        if (y.give) eff.push(t("yk_syn_give", { w: L(A.name), m: D.MODS[y.give].icon + L(D.MODS[y.give].name) }));
        (y.st || []).forEach(function (b) { eff.push(statText(b[0], b[1])); });
        return el("div", { class: "yk-cx" }, [el("strong", null, ["🤝 ", L(y.name)]), el("div", { class: "yk-small" }, [A.icon + L(A.name) + " ＋ " + B.icon + L(B.name)]), el("div", { class: "yk-small" }, [eff.join("・")])]);
      }))]));
      body.push(panel(t("yk_cx_ulttier"), [el("p", { class: "yk-small" }, [t("yk_ulttier_note")])]));
    } else if (c === "foods") {
      body.push(el("div", { class: "yk-cxgrid" }, D.FOODS.map(function (f) { return el("div", { class: "yk-cx" }, [el("strong", null, [f.icon, " ", L(f.name)]), el("div", { class: "yk-small" }, [foodText(f)])]); })));
    } else if (c === "enemies") {
      body.push(el("div", { class: "yk-cxgrid" }, Object.keys(D.ENEMIES).map(function (k) {
        var e = D.ENEMIES[k], f = e.f || {};
        return el("div", { class: "yk-cx" }, [el("strong", null, [L(e.name), e.tk ? " 🎴" : ""]), el("div", { class: "yk-small" }, ["HP " + e.hp + "・" + t("yk_speed") + " " + e.spd + (f.fly ? "・" + t("yk_f_fly") : "") + (f.ghost ? "・" + t("yk_f_ghost") : "") + (f.ranged ? "・" + t("yk_f_ranged") : "") + (f.charge ? "・" + t("yk_f_charge") : "") + (f.armor ? "・" + t("yk_f_armor") : "") + (f.gold ? "・" + t("yk_f_gold") : "") + (f.split ? "・" + t("yk_f_split") : "")])]);
      })));
      body.push(panel(t("yk_cx_bosses"), [el("div", { class: "yk-cxgrid" }, Object.keys(D.BOSSES).map(function (k) { var b = D.BOSSES[k]; return el("div", { class: "yk-cx" }, [el("strong", null, ["👹 ", L(b.name)]), el("div", { class: "yk-small" }, ["HP " + b.hp + "・" + b.pat.map(function (p) { return t("yk_pat_" + p); }).join("／")])]); }))]));
    } else if (c === "stages") {
      body.push(el("div", { class: "yk-cxgrid" }, D.STAGES.map(function (st, i) {
        return el("div", { class: "yk-cx", style: "border-left:4px solid " + hex(st.color) }, [el("strong", null, [t("yk_stage_n", { n: i + 1 }), " ", D.FEATS[st.feat].icon, " ", L(st.name)]), el("div", { class: "yk-small" }, [L(st.desc)]),
          el("div", { class: "yk-small" }, [t("yk_map"), "：", st.maps.map(function (m) { return L(D.MAPS[m].name); }).join("／")]),
          el("div", { class: "yk-small" }, [t("yk_mid"), "：", st.mid.map(function (m) { return L(D.BOSSES[m].name); }).join("／"), "・", t("yk_boss"), "：", L(D.BOSSES[st.boss].name)])]);
      })));
      body.push(panel(t("yk_cx_maps", { n: D.MAPS.length }), [el("div", { class: "yk-chips" }, D.MAPS.map(function (m) { return el("span", { class: "yk-chip" }, [L(m.name), "・", L(D.PREFS[m.pref].name)]); }))]));
    } else {
      body.push(el("ul", { class: "yk-rules" }, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (i) { return el("li", null, [t("yk_rule_" + i)]); })));
      body.push(panel(t("yk_cx_pref"), [el("div", { class: "yk-cxgrid" }, Object.keys(D.PREFS).map(function (p) { var pr = D.PREFS[p]; return el("div", { class: "yk-cx", style: "border-left:4px solid " + hex(pr.color) }, [el("strong", null, [L(pr.name)]), el("div", { class: "yk-small" }, ["3：" + statText(pr.bonus[0][0], pr.bonus[0][1])]), el("div", { class: "yk-small" }, ["5：" + statText(pr.bonus[0][0], pr.bonus[0][1] * 1.5) + "・" + statText(pr.bonus[1][0], pr.bonus[1][1])])]); }))]));
    }
    app.appendChild(panel(null, body));
  }
  function foodText(f) {
    var e = f.e, out = [];
    if (e.heal) out.push(t("yk_fd_heal", { n: e.heal }));
    if (e.full) out.push(t("yk_fd_full"));
    if (e.magnet) out.push(t("yk_fd_magnet"));
    if (e.inv) out.push(t("yk_fd_inv", { n: e.inv }));
    if (e.speed) out.push(t("yk_fd_speed", { n: e.speed }));
    if (e.might) out.push(t("yk_fd_might", { n: e.might }));
    if (e.armor) out.push(t("yk_fd_armor", { n: e.armor }));
    if (e.freeze) out.push(t("yk_fd_freeze", { n: e.freeze }));
    if (e.nuke) out.push(t("yk_fd_nuke"));
    if (e.gold) out.push(t("yk_fd_gold", { n: e.gold }));
    if (e.xp) out.push(t("yk_fd_xp"));
    if (e.ult) out.push(t("yk_fd_ult", { n: e.ult }));
    if (e.luck) out.push(t("yk_fd_luck", { n: e.luck }));
    if (e.kek) out.push(t("yk_fd_kek", { n: e.kek }));
    if (e.team) out.push(t("yk_fd_team", { n: e.team }));
    if (e.chest) out.push(t("yk_fd_chest"));
    if (e.lv) out.push(t("yk_fd_lv"));
    return out.join("・");
  }

  // ---------------- 多人連線大廳 ----------------
  function myName() { return lsGet(NAME_KEY) || ""; }
  function openRoom(roomId) {
    if (!window.PriTestGameStorage || !window.PriTestGameStorage.rtSet) { window.alert(t("yk_net_unavail")); return; }
    if (ui.room) ui.room.close();
    var pg = progress();
    ui.room = Net.open({
      roomId: roomId, name: myName(), dm: ui.dm, meta: sortieMeta("tenka"),
      cfg: { stage: Math.min(ui.stage, unlockedStage(pg)), map: ui.map, diff: ui.diff, dur: ui.dur, maxStage: unlockedStage(pg), mode: ui.mode, heat: tkProgress().heat },
      onChange: function () { roomChanged(); },
      onSnap: function (o) { if (sess && !sess.host) sess.onSnap(o); },
      onFull: function () { },
      onIntent: function (pid, it) { if (sess && sess.host && sess.s) Core.applyIntent(sess.s, pid, it); },
      onMove: function (pid, mv) { if (sess && sess.host && sess.s) sess.onMove(pid, mv); },
      onHost: function (w) { if (sess && !sess.host) becomeHost(w); }
    });
    rememberRoom(ui.room.id);
    var url = window.location.pathname + "?room=" + ui.room.id;
    window.history.replaceState(null, "", url);
    ui.screen = "lobby";
    render();
  }
  var lastLobbySig = "";
  function roomChanged() {
    var r = ui.room;
    if (!r) return;
    if (r.missing) { ui.screen = "lobby"; render(); return; }
    if (AWAY_SCREENS[ui.screen]) {   // 暫離中：不把人拉進戰場，只更新橫幅（開戰／結束時重畫一次）
      var st = r.status();
      if (st !== ui._awaySt) { ui._awaySt = st; render(); }
      return;
    }
    if (r.status() === "game" && ui.screen !== "game") { startNet(); return; }
    if (r.status() === "lobby" && ui.screen === "game" && sess && !sess.solo) { ui.screen = "lobby"; render(); return; }
    // 房主被交接出去（切到背景後回來、或連線不穩被接手）：改當一般玩家，畫面沿用
    if (ui.screen === "game" && sess && sess.host && !sess.solo && r.meta && !r.isHost()) {
      var mine = sess.s && sess.s.P[r.pid];
      local.me = mine ? { x: mine.x, z: mine.z, fx: mine.fx, fz: mine.fz } : null;
      local.reset = !mine;
      var keepView = sess.s;
      sess = clientSession();
      if (!sess.view) sess.view = keepView;
    }
    if (ui.screen === "lobby") {
      var sig = JSON.stringify([r.list(), r.cfg, r.isHost(), r.loaded]);
      if (sig !== lastLobbySig) { lastLobbySig = sig; render(); }
    }
  }
  function renderLobby() {
    var r = ui.room;
    if (!r) { goHome(); return; }
    if (r.missing) { app.appendChild(panel(t("yk_room_missing"), [btn(t("yk_back"), goHome)])); return; }
    if (!r.loaded) { app.appendChild(panel(null, [el("p", null, [t("yk_connecting")])])); return; }
    var link = window.location.origin + window.location.pathname + "?room=" + r.id;
    var qr = el("div", { class: "yk-qr" });
    try { if (window.QRCode) new window.QRCode(qr, { text: link, width: 140, height: 140 }); } catch (e) { /* 沒有 QR 也能分享網址 */ }
    var nameIn = el("input", { class: "yk-input", value: myName(), maxlength: 16, placeholder: t("yk_name_ph") });
    nameIn.addEventListener("change", function () { lsSet(NAME_KEY, nameIn.value.slice(0, 16)); r.update({ name: nameIn.value.slice(0, 16) }); });
    var cfg = r.cfg || {};
    var host = r.isHost();
    // 在大廳期間改了本陣／軍略樹／符文：重新送出自己的 meta（只在有變時送）
    var myMeta = JSON.stringify(sortieMeta("tenka"));
    if (r.me && r.me.meta !== myMeta) r.update({ meta: JSON.parse(myMeta) });
    app.appendChild(panel(t("yk_lobby"), [
      el("div", { class: "yk-lobby" }, [qr, el("div", { class: "yk-grow" }, [
        el("p", { class: "yk-small" }, [t("yk_share")]), el("input", { class: "yk-input yk-full", value: link, readonly: true, onclick: function (ev) { ev.target.select(); } }),
        el("div", { class: "yk-field" }, [t("yk_name"), nameIn]),
        el("p", { class: "yk-small yk-muted" }, [t("yk_dropin_note")])
      ])]),
      el("h3", null, [t("yk_players", { n: r.list().length })]),
      el("ul", { class: "yk-plist" }, r.list().map(function (p) { var d = D.DAIMYO[p.dm] || D.DAIMYO[0]; return el("li", null, [crestBadge(d), " ", p.name || t("yk_noname"), "（", L(d.name), "）", r.meta && r.meta.host === p.cid ? el("span", { class: "yk-chip" }, ["👑 " + t("yk_host")]) : null, p.away ? el("span", { class: "yk-chip" }, ["☕ " + t("yk_room_away_tag")]) : null]); }))
    ]));
    app.appendChild(el("div", { class: "yk-actions" }, [
      btn("🏯 " + t("yk_menu_meta"), function () { goAway("meta"); }, "yk-btn"),
      btn("🎴 " + t("yk_tk_tab_tree"), function () { goAway("tenka", "tree"); }, "yk-btn"),
      btn("🔲 " + t("yk_tk_tab_runes"), function () { goAway("tenka", "runes"); }, "yk-btn"),
      el("span", { class: "yk-small yk-muted" }, [t("yk_room_away_note")])
    ]));
    app.appendChild(panel(t("yk_pick_daimyo"), [daimyoPicker(ui.dm, function (i) { ui.dm = i; setPref({ dm: i }); r.update({ dm: i }); render(); })]));
    if (host) {
      var maxSt = Math.max(0, cfg.maxStage | 0);
      app.appendChild(panel(t("yk_pick_stage"), [
        stagePicker(cfg.stage | 0, cfg.map === undefined ? -1 : cfg.map, function (i) { r.setCfg(Object.assign({}, cfg, { stage: i, map: -1 })); render(); }, function (m) { r.setCfg(Object.assign({}, cfg, { map: Number(m) })); render(); }, maxSt),
        el("div", { class: "yk-field" }, [t("yk_diff"), seg(Object.keys(D.DIFFS).map(function (k) { return [k, L(D.DIFFS[k].name)]; }), cfg.diff || "normal", function (k) { r.setCfg(Object.assign({}, cfg, { diff: k })); render(); })]),
        el("div", { class: "yk-field" }, [t("yk_dur"), seg([[900, t("yk_dur_15")], [300, t("yk_dur_5")]], cfg.dur || 900, function (k) { r.setCfg(Object.assign({}, cfg, { dur: Number(k) })); render(); })]),
        el("div", { class: "yk-field" }, [t("yk_tk_mode"), seg([["normal", t("yk_mode_normal")], ["tenka", "🎴 " + t("yk_menu_tenka")]], cfg.mode || "normal", function (k) { ui.mode = k; setPref({ mode: k }); r.setCfg(Object.assign({}, cfg, { mode: k })); render(); })]),
        cfg.mode === "tenka" ? el("div", { class: "yk-field" }, [t("yk_tk_heat"), seg([0, 1, 2, 3, 4, 5].map(function (h) { return [h, h ? "🐉" + h : t("yk_tk_heat0")]; }), cfg.heat | 0, function (h) { r.setCfg(Object.assign({}, cfg, { heat: Number(h) })); render(); })]) : null,
        el("div", { class: "yk-actions yk-next" }, [btn("⚔️ " + t("yk_start"), hostStart, "yk-btn yk-primary")])
      ]));
    } else {
      var st = D.STAGES[cfg.stage | 0] || D.STAGES[0];
      app.appendChild(panel(t("yk_pick_stage"), [el("p", null, [t("yk_stage_n", { n: (cfg.stage | 0) + 1 }), " ", L(st.name), "・", L((D.DIFFS[cfg.diff] || D.DIFFS.normal).name), "・", mmss(cfg.dur || 900), cfg.mode === "tenka" ? "・🎴 " + t("yk_menu_tenka") + (cfg.heat ? " 🐉" + cfg.heat : "") : ""]), el("p", { class: "yk-muted" }, [t("yk_wait_host")])]));
    }
  }
  function hostStart() {
    var r = ui.room;
    if (!r || !r.isHost()) return;
    var cfg = r.cfg || {};
    var s = Core.create({ stage: cfg.stage | 0, map: cfg.map === undefined ? -1 : cfg.map, diff: cfg.diff, dur: cfg.dur || 900, seed: (Date.now() & 0x7fffffff), mode: cfg.mode, heat: cfg.heat | 0 });
    if (s.map < 0 || cfg.map < 0) s.map = D.STAGES[s.stage].maps[Math.floor(Math.random() * 2)];
    r.list().forEach(function (p) { if (!p.away) Core.addPlayer(s, p.pid, p.name, p.dm, p.meta); });
    r.startGame(Core.serializeNet(s));
    ui.pendingHostState = s;
  }

  // ---------------- 場次 ----------------
  function startSolo(mode) {
    mode = mode === "tenka" ? "tenka" : "normal";
    var s = Core.create({ stage: ui.stage, map: ui.map, diff: ui.diff, dur: ui.dur, seed: (Date.now() & 0x7fffffff), mode: mode, heat: mode === "tenka" ? tkProgress().heat : 0 });
    if (ui.map < 0) s.map = D.STAGES[ui.stage].maps[Math.floor(Math.random() * 2)];
    s.solo = true;
    var P = Core.addPlayer(s, "me", myName(), ui.dm, sortieMeta(mode));
    P.local = 1;
    sess = { solo: true, host: true, pid: "me", s: s, view: s, send: function (it) { Core.applyIntent(s, "me", it); } };
    beginGame();
  }
  function startNet() {
    var r = ui.room;
    if (!r) return;
    if (r.isHost()) {
      var s = ui.pendingHostState || (r.full && Core.deserialize(r.full.s));
      ui.pendingHostState = null;
      if (!s) { if (!r._fetching) { r._fetching = 1; r.fetchFull(function () { r._fetching = 0; }); } setTimeout(startNet, 300); return; }
      hostSession(s);
    } else {
      sess = clientSession();
    }
    beginGame();
  }
  function hostSession(s) {
    var r = ui.room;
    Core.players(s).forEach(function (P) { P.local = P.pid === r.pid ? 1 : 0; });
    var missing = {}, lastMv = {}, lastN = {};
    sess = {
      solo: false, host: true, pid: r.pid, s: s, view: s, lastSnap: 0, lastFull: 0, lastSync: 0,
      send: function (it) { Core.applyIntent(s, r.pid, it); },
      onMove: function (pid, mv) {
        var P = s.P[pid];
        if (!P || P.local || !mv) return;
        // 同一份位置會在別人更新時重複送來：序號沒變就不算新回報（掛機偵測才準）
        if (mv.n !== undefined && mv.n === lastN[pid]) return;
        lastN[pid] = mv.n;
        lastMv[pid] = performance.now();
        if (P.afk) { P.afk = 0; }
        var x = Number(mv.x), z = Number(mv.z);
        if (!isFinite(x) || !isFinite(z) || P.down) return;
        P.x = Math.max(-D.ARENA, Math.min(D.ARENA, x)); P.z = Math.max(-D.ARENA, Math.min(D.ARENA, z));
        if (isFinite(mv.fx) && isFinite(mv.fz) && (mv.fx || mv.fz)) { P.fx = Number(mv.fx); P.fz = Number(mv.fz); }
      },
      tick: function (dt) {
        var now = performance.now();
        // 中途加入／退出
        if (now - sess.lastSync > 500) {
          sess.lastSync = now;
          var online = {};
          r.list().forEach(function (p) {
            if (p.away && !s.P[p.pid]) return;   // 暫離中的人不加入，回來時才中途加入
            online[p.pid] = 1;
            if (!s.P[p.pid] && s.ph === "play") { var P = Core.addPlayer(s, p.pid, p.name, p.dm, p.meta); P.local = p.pid === r.pid ? 1 : 0; }
          });
          Core.players(s).forEach(function (P) {
            if (P.pid === r.pid) return;
            if (online[P.pid]) { delete missing[P.pid]; return; }
            missing[P.pid] = missing[P.pid] || now;
            if (now - missing[P.pid] > 4000) { Core.removePlayer(s, P.pid); delete missing[P.pid]; }
          });
        }
        // 掛機偵測：2.5 秒沒收到位置（對方切到背景、網路斷）→ 暫時無敵，敵人也不追他
        Core.players(s).forEach(function (P) {
          if (P.local) return;
          if (!lastMv[P.pid]) lastMv[P.pid] = now;
          var afk = now - lastMv[P.pid] > 2500 ? 1 : 0;
          P.afk = afk;
          if (afk) P.iv = Math.max(P.iv, 0.3);
        });
        // 只有自己一個人時不廣播快照；寫入有流量控制（上一筆沒送完就跳過）
        var others = r.list().length > 1;
        // 2026-11-06 多人流量優化：快照越大送得越慢一點（110〜180ms），完整狀態改用精簡版、6 秒一次且和快照錯開
        var gap = 110 + Math.min(70, Math.max(0, ((sess.snapBytes || 0) - 9000) / 100));
        if (others && now - sess.lastSnap > gap && !r.snapBusy()) {
          sess.lastSnap = now;
          var so = Core.snap(s);
          sess.snapBytes = r.writeSnap(so) || sess.snapBytes;
        } else if (others && now - sess.lastFull > 6000 && now - sess.lastSnap > 40) { sess.lastFull = now; r.writeFull(Core.serializeNet(s)); }
      }
    };
    return sess;
  }
  function becomeHost(w) {
    var r = ui.room;
    var s = (w && Core.deserialize(w.s)) || (r.full && Core.deserialize(r.full.s));
    if (!s) return;
    var me = local.me;
    hostSession(s);
    if (s.P[r.pid] && me) { s.P[r.pid].x = me.x; s.P[r.pid].z = me.z; }
    if (view3) { /* 畫面沿用，只是換資料來源 */ }
    toast(t("yk_now_host"));
  }
  function clientSession() {
    var r = ui.room;
    r.resetIntents();
    var prevPos = {}, prevT = 0;
    var c = {
      solo: false, host: false, pid: r.pid, s: null, view: null, lastMove: 0, snapAt: 0,
      send: function (it) { r.sendIntent(it); },
      onSnap: function (o) {
        var v = Core.unsnap(o);
        // 外插推算：記住每個敵人／投射物／敵彈這一份與上一份快照的位置差，畫面依經過時間往前推（最多 0.3 秒）
        var now = performance.now(), gap = prevT ? Math.min(0.5, Math.max(0.05, (v.t - prevT))) : 0.12, np = {};
        [["e", v.E], ["s", v.S], ["b", v.B]].forEach(function (pair) {
          pair[1].forEach(function (x) {
            var key = pair[0] + x.id, pp = prevPos[key];
            x.x0 = x.x; x.z0 = x.z;
            if (pp) { x.vx = (x.x - pp[0]) / gap; x.vz = (x.z - pp[1]) / gap; if (x.vx * x.vx + x.vz * x.vz > 1600) { x.vx = 0; x.vz = 0; } }
            else { x.vx = 0; x.vz = 0; }
            np[key] = [x.x, x.z];
          });
        });
        prevPos = np; prevT = v.t; c.snapAt = now;
        var mine = v.P[r.pid];
        if (mine) {
          if (!local.me || local.reset) { local.me = { x: mine.x, z: mine.z, fx: mine.fx, fz: mine.fz }; local.reset = false; }
          if (mine.down) { local.me.x = mine.x; local.me.z = mine.z; }
        }
        c.view = v;
      },
      tick: function () {
        var now = performance.now();
        if (local.me && now - c.lastMove > 100) {
          c.lastMove = now;
          c.mvN = (c.mvN || 0) + 1;
          r.sendMove({ n: c.mvN, x: Math.round(local.me.x * 100) / 100, z: Math.round(local.me.z * 100) / 100, fx: Math.round(local.me.fx * 100) / 100, fz: Math.round(local.me.fz * 100) / 100 });
        }
      }
    };
    if (r.snap) c.onSnap(r.snap);
    return c;
  }

  // ---------------- 戰場 ----------------
  var local = { me: null, reset: true };
  var input = { jx: 0, jz: 0, keys: {} };
  var hud = null, lastHud = 0, toasts = [], seenMsg = {}, recorded = false;
  function beginGame() {
    ui.screen = "game";
    ui.paused = false;
    recorded = false;
    seenMsg = {};
    local.me = null; local.reset = true;
    app.innerHTML = "";
    stopGame(true);
    var stage = el("div", { class: "yk-stagebox" });
    var box = el("div", { class: "yk-view" });
    stage.appendChild(box);
    hud = buildHud(stage);
    app.appendChild(stage);
    try { stage.scrollIntoView({ block: "start" }); } catch (e) { /* 舊瀏覽器 */ }
    if (!V3.available()) { box.appendChild(el("p", { class: "yk-center" }, [t("yk_no_webgl")])); return; }
    box.appendChild(el("p", { class: "yk-center", id: "yk-loading" }, [t("yk_loading")]));
    V3.load().then(function () {
      var ld = document.getElementById("yk-loading");
      if (ld) ld.parentNode.removeChild(ld);
      if (ui.screen !== "game") return;
      waitView(function () {
        view3 = V3.create(box, { getView: getView, me: sess.pid, quality: ui.quality, onFrame: onFrame });
      });
    }).catch(function () { box.appendChild(el("p", { class: "yk-center" }, [t("yk_no_webgl")])); });
    bindInput(box);
  }
  function waitView(fn) {
    if (sess && sess.view) { fn(); return; }
    setTimeout(function () { if (ui.screen === "game") waitView(fn); }, 150);
  }
  function stopGame(keepSess) {
    if (view3) { view3.destroy(); view3 = null; }
    unbindInput();
    if (!keepSess && sess && sess.solo) sess = null;
  }
  function getView() {
    if (!sess) return null;
    var v = sess.view;
    if (!v) return null;
    if (!sess.host && local.me && v.P[sess.pid]) {
      var P = v.P[sess.pid];
      if (!P.down) { P.x = local.me.x; P.z = local.me.z; P.fx = local.me.fx; P.fz = local.me.fz; }
    }
    if (!sess.host && sess.snapAt) {
      var age = Math.min(0.3, (performance.now() - sess.snapAt) / 1000);
      var ext = function (x) { if (x.x0 !== undefined) { x.x = x.x0 + (x.vx || 0) * age; x.z = x.z0 + (x.vz || 0) * age; } };
      v.E.forEach(ext); v.S.forEach(ext); v.B.forEach(ext);
    }
    return v;
  }
  var acc = 0;
  function onFrame(dt) {
    if (!sess) return;
    var mvx = input.jx, mvz = input.jz;
    var K = input.keys;
    if (K.a || K.arrowleft) mvx -= 1;
    if (K.d || K.arrowright) mvx += 1;
    if (K.w || K.arrowup) mvz -= 1;
    if (K.s || K.arrowdown) mvz += 1;
    if (sess.host) {
      var s = sess.s, me = s.P[sess.pid];
      if (me) { me.mvx = mvx; me.mvz = mvz; }
      if (!ui.paused || !sess.solo) {
        acc += dt;
        var n = 0;
        while (acc >= STEP && n++ < 4) { Core.step(s, STEP); acc -= STEP; }
        if (acc > STEP * 4) acc = 0;
      }
      if (sess.tick) sess.tick(dt);
    } else {
      var v = sess.view, mine = v && v.P[sess.pid];
      if (mine && local.me && !mine.down && !mine.opts && !(mine.pend > 0) && !(mine.arcQ > 0) && !(hud && hud.modal && !hud.modal.classList.contains("yk-hidden")) && v.ph === "play") {
        var tmp = { x: local.me.x, z: local.me.z, fx: local.me.fx, fz: local.me.fz };
        Core.stepMove(v, tmp, mvx, mvz, dt, mine.sp || 4.2);
        local.me.x = tmp.x; local.me.z = tmp.z; local.me.fx = tmp.fx; local.me.fz = tmp.fz;
      }
      sess.tick(dt);
    }
    var now = performance.now();
    if (now - lastHud > 100) { lastHud = now; updateHud(); }
  }

  // ---------------- 輸入：虛擬搖桿＋鍵盤 ----------------
  var bound = null;
  function bindInput(box) {
    unbindInput();
    var joy = el("div", { class: "yk-joy" }, [el("div", { class: "yk-joy-knob" })]);
    box.parentNode.appendChild(joy);
    var knob = joy.firstChild, active = null, ox = 0, oy = 0, R = 55;
    function down(ev) {
      if (active !== null) return;
      if (ev.target.closest && ev.target.closest("button, .yk-modal")) return;
      active = ev.pointerId;
      var rect = box.getBoundingClientRect();
      ox = ev.clientX; oy = ev.clientY;
      joy.style.left = (ev.clientX - rect.left) + "px"; joy.style.top = (ev.clientY - rect.top) + "px";
      joy.classList.add("yk-joy-on");
      knob.style.transform = "translate(-50%,-50%)";
      try { box.setPointerCapture(ev.pointerId); } catch (e) { /* 舊瀏覽器 */ }
      ev.preventDefault();
    }
    function move(ev) {
      if (ev.pointerId !== active) return;
      var dx = ev.clientX - ox, dy = ev.clientY - oy, d = Math.sqrt(dx * dx + dy * dy);
      var k = d > R ? R / d : 1;
      knob.style.transform = "translate(calc(-50% + " + (dx * k) + "px), calc(-50% + " + (dy * k) + "px))";
      var m = Math.min(1, d / R);
      input.jx = d > 4 ? dx / d * m : 0; input.jz = d > 4 ? dy / d * m : 0;
      ev.preventDefault();
    }
    function up(ev) {
      if (ev.pointerId !== active) return;
      active = null; input.jx = 0; input.jz = 0;
      joy.classList.remove("yk-joy-on");
    }
    function kd(ev) {
      var k = String(ev.key || "").toLowerCase();
      if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA")) return;
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].indexOf(k) >= 0) ev.preventDefault();
      input.keys[k] = true;
      var v = getView(), me = v && v.P[sess.pid];
      if (me && me.opts && /^[1-4]$/.test(k)) pickOpt(Number(k) - 1);
      if (k === " " || k === "q") useUlt();
      if (k === "r" && me && me.opts) reroll();
      if ((k === "p" || k === "escape") && sess && sess.solo) togglePause();
    }
    function ku(ev) { input.keys[String(ev.key || "").toLowerCase()] = false; }
    function blur() { input.keys = {}; input.jx = 0; input.jz = 0; }
    box.addEventListener("pointerdown", down);
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerup", up);
    box.addEventListener("pointercancel", up);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    bound = function () {
      box.removeEventListener("pointerdown", down); box.removeEventListener("pointermove", move); box.removeEventListener("pointerup", up); box.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.removeEventListener("blur", blur);
      if (joy.parentNode) joy.parentNode.removeChild(joy);
    };
  }
  function unbindInput() { if (bound) { bound(); bound = null; } input.keys = {}; input.jx = 0; input.jz = 0; }
  function useUlt() { var v = getView(), me = v && v.P[sess.pid]; if (me && me.ult >= 100 && !me.down) sess.send({ t: "ult" }); }
  var sentPick = "";
  function optSig(me) { return JSON.stringify(me.opts) + (me.pend || 0) + ":" + (me.lv || 0) + ":" + (me.bn || 0) + ":" + (me.sk || 0) + ":" + (me.rr || 0) + ":" + (me.arcQ || 0); }
  function pickOpt(i) {
    var v = getView(), me = v && v.P[sess.pid];
    if (!me || !me.opts) return;
    var sig = optSig(me);
    if (!sess.host && sentPick === sig) return;
    sentPick = sig;
    sess.send({ t: "pick", i: i });
    if (!sess.host && hud) { hud.modal.classList.add("yk-hidden"); hud.modalSig = sig; }
    updateHud(true);
  }
  function reroll() { sentPick = ""; sess.send({ t: "reroll" }); }
  // 天下布武：封印（這個選項之後不再出現）／略過（放棄這次升級，得到少量錢與回復）
  function banishOpt(i) { sentPick = ""; sess.send({ t: "banish", i: i }); if (hud) hud.modalSig = ""; }
  function skipLv() {
    var v = getView(), me = v && v.P[sess.pid];
    if (!me || !me.opts) return;
    sess.send({ t: "skip" });
    if (!sess.host && hud) { sentPick = optSig(me); hud.modal.classList.add("yk-hidden"); hud.modalSig = sentPick; }
    updateHud(true);
  }
  function togglePause() { ui.paused = !ui.paused; updateHud(true); }

  // ---------------- HUD ----------------
  function buildHud(stage) {
    var h = {};
    h.root = el("div", { class: "yk-hud" });
    h.xp = el("div", { class: "yk-xpbar" }, [el("div", { class: "yk-xpfill" }), el("span", { class: "yk-xptext" })]);
    h.timer = el("div", { class: "yk-timer" });
    h.info = el("div", { class: "yk-info" });
    h.hp = el("div", { class: "yk-hpbar" }, [el("div", { class: "yk-hpfill" }), el("span", { class: "yk-hptext" })]);
    h.boss = el("div", { class: "yk-bossbar yk-hidden" }, [el("div", { class: "yk-bossfill" }), el("span", { class: "yk-bosstext" })]);
    h.items = el("div", { class: "yk-items" });
    h.team = el("div", { class: "yk-team" });
    h.toast = el("div", { class: "yk-toasts" });
    h.ult = el("button", { type: "button", class: "yk-ult", onclick: function (ev) { ev.stopPropagation(); useUlt(); } }, [el("span", { class: "yk-ult-icon" }), el("span", { class: "yk-ult-pct" })]);
    h.menu = el("div", { class: "yk-hudbtns" }, [
      btn("⏸", function (ev) { ev.stopPropagation(); if (sess && sess.solo) togglePause(); else showMenu(); }, "yk-hbtn"),
      btn("🚪", function (ev) { ev.stopPropagation(); quitGame(); }, "yk-hbtn")
    ]);
    h.feat = el("div", { class: "yk-feat yk-hidden" });
    h.combo = el("div", { class: "yk-combo" });
    h.quest = el("div", { class: "yk-tk-quest yk-hidden" });
    h.modal = el("div", { class: "yk-modal yk-hidden" });
    h.pause = el("div", { class: "yk-modal yk-hidden" });
    h.root.appendChild(h.xp);
    h.root.appendChild(el("div", { class: "yk-hudtop" }, [el("div", { class: "yk-hudleft" }, [h.hp, h.info, h.feat]), h.timer, h.menu]));
    h.root.appendChild(h.boss);
    h.root.appendChild(h.combo);
    h.root.appendChild(h.quest);
    h.root.appendChild(h.items);
    h.root.appendChild(h.team);
    h.root.appendChild(h.toast);
    h.root.appendChild(h.ult);
    h.root.appendChild(h.modal);
    h.root.appendChild(h.pause);
    stage.appendChild(h.root);
    h.itemsSig = ""; h.teamSig = ""; h.modalSig = "";
    return h;
  }
  function showMenu() { toast(t("yk_no_pause_net")); }
  function quitGame() {
    if (!window.confirm(t("yk_quit_q"))) return;
    if (sess && sess.solo) { finishGame(true); return; }
    if (ui.room) { ui.room.close(); ui.room = null; }
    sess = null;
    goHome();
  }
  function toast(text, img) {
    toasts.push({ text: text, img: img || "", t: performance.now() });
    if (toasts.length > 5) toasts.shift();
    if (hud) renderToasts();
  }
  // 內容有變才重畫（每次重畫會讓淡入動畫重播，看起來一直閃）
  var toastSig = "";
  function renderToasts() {
    var now = performance.now();
    toasts = toasts.filter(function (x) { return now - x.t < 4000; });
    var sig = toasts.map(function (x) { return x.t; }).join(",");
    if (sig === toastSig) return;
    toastSig = sig;
    hud.toast.innerHTML = "";
    toasts.forEach(function (x) { hud.toast.appendChild(el("div", { class: "yk-toast" + (x.img ? " yk-toast-img" : "") }, [x.img ? el("img", { src: x.img, alt: "", class: "yk-tk-face" }) : null, x.text])); });
  }
  function msgText(m, v) {
    var P = v.P[m.p], nm = P ? (P.name || L(D.DAIMYO[P.dm].name)) : (m.a && typeof m.a === "string" ? m.a : "");
    var mine = m.p === sess.pid;
    if (m.k === "boss") return "👹 " + t("yk_msg_boss", { n: L(m.a) });
    if (m.k === "mid") return "⚠ " + t("yk_msg_mid", { n: L(m.a) });
    if (m.k === "midkill") return "🎉 " + t("yk_msg_midkill", { n: L(m.a) });
    if (m.k === "join") return "➕ " + t("yk_msg_join", { n: m.a || t("yk_noname") });
    if (m.k === "leave") return "➖ " + t("yk_msg_leave", { n: m.a || t("yk_noname") });
    if (m.k === "down") return "💀 " + t("yk_msg_down", { n: nm });
    if (m.k === "revive") return "💚 " + t("yk_msg_revive", { n: nm });
    if (m.k === "kage") return "🥷 " + t("yk_msg_kage", { n: nm });
    if (m.k === "ult") return D.ULTS[m.a].icon + " " + t("yk_msg_ult", { n: nm, u: L(D.ULTS[m.a].name) });
    if (m.k === "warashi") return "👧 " + t("yk_msg_warashi", { n: nm });
    if (m.k === "feat") return t("yk_feat_" + m.a);
    if (m.k === "wx") return t("yk_wx_" + m.a);
    if (m.k === "bounty") return "💰 " + t("yk_msg_bounty", { e: L((D.ENEMIES[m.a] || {}).name) });
    if (m.k === "btykill") return "🎉 " + t("yk_msg_btykill", { n: nm || t("yk_noname") });
    if (m.k === "renkei") { var Q2 = v.P[m.a]; return "🔥 " + t("yk_msg_renkei", { a: nm, b: Q2 ? (Q2.name || L(D.DAIMYO[Q2.dm].name)) : "" }); }
    if (m.k === "ultup") return "🌟 " + t("yk_msg_ultup", { n: nm, t: m.a });
    if (m.k === "pick" && mine && m.a && m.a.t === "m") return D.MODS[m.a.m].icon + " " + t("yk_msg_mod", { w: L(D.WEAPONS[m.a.id].name), m: L(D.MODS[m.a.m].name) });
    if (m.k === "combo") return "🔥 " + t("yk_msg_combo", { n: nm, c: m.a });
    if (m.k === "arc" && TK.ARC[m.a]) return TK.ARC[m.a].icon + " " + t("yk_tk_msg_arc", { n: nm, a: L(TK.ARC[m.a].name) });
    if (m.k === "tkev") { var ev = TK.EVENTS.filter(function (x) { return x.k === m.a; })[0]; return ev ? ev.icon + " " + t("yk_tk_ev_" + m.a) : ""; }
    if (m.k === "tkev_end") return "🌙 " + t("yk_tk_ev_chizuki_end");
    if (m.k === "arcq") return "🎴 " + t("yk_tk_msg_arcq");
    if (m.k === "kg") return "🎖️ " + t("yk_tk_msg_kg", { n: m.a });
    if (m.k === "qnew" && m.a === "rescue") return "🆘 " + t("yk_tk_msg_rescue_new", { n: L(TK.musumeName(m.c)) });
    if (m.k === "qng" && m.a === "rescue") return "💔 " + t("yk_tk_msg_rescue_ng", { n: L(TK.musumeName(m.b)) });
    if (m.k === "rescued") return "💐 " + t("yk_tk_msg_rescued", { n: L(TK.musumeName(m.a)) });
    if (m.k === "qnew" && TK.QUEST[m.a]) return "📜 " + t("yk_tk_msg_qnew", { q: L(TK.QUEST[m.a].name).replace("{n}", m.b) });
    if (m.k === "qok") return "🎉 " + t("yk_tk_msg_qok", { n: m.b });
    if (m.k === "qng") return "❌ " + t("yk_tk_msg_qng");
    if (m.k === "ban" && mine) return "🚫 " + t("yk_tk_msg_ban");
    if (m.k === "bless") return "⛩ " + t("yk_msg_bless", { n: nm, b: t("yk_bless_" + m.a) });
    if (m.k === "chest" && mine) {
      return "🎁 " + t("yk_msg_chest") + (m.a || []).map(function (r) {
        if (r.t === "evo") return " ★" + weaponName(r.id, true);
        if (r.t === "wu") return " " + L(D.WEAPONS[r.id].name) + "↑";
        if (r.t === "au") return " " + L(D.ACCS[r.id].name) + "↑";
        return "";
      }).join("") + "・💰" + Math.round(m.b || 0);
    }
    if (m.k === "food" && mine) return D.FOODS[m.a].icon + " " + L(D.FOODS[m.a].name) + "：" + foodText(D.FOODS[m.a]);
    return "";
  }
  function updateHud(force) {
    if (!hud || !sess) return;
    var v = getView();
    if (!v) return;
    var me = v.P[sess.pid];
    // 訊息
    (v.msg || []).forEach(function (m) {
      if (seenMsg[m.id]) return;
      seenMsg[m.id] = 1;
      if (v.t - m.t > 6) return;
      var txt = msgText(m, v);
      var mimg = m.k === "rescued" ? musumeSrc(m.a) : m.k === "qnew" && m.a === "rescue" || m.k === "qng" && m.a === "rescue" ? musumeSrc(m.c !== undefined ? m.c : m.b) : "";
      if (txt) toast(txt, mimg);
    });
    renderToasts();
    // 時間
    var remain = v.dur - v.t;
    hud.timer.textContent = remain > 0 ? mmss(remain) : "👹 " + mmss(v.t);
    var tc = "yk-timer" + (remain <= 60 && remain > 0 ? " yk-warn" : "");
    if (hud.timer.className !== tc) hud.timer.className = tc;
    var st = D.STAGES[v.stage];
    if (me) {
      var xpf = me.xn ? Math.min(1, me.xp / me.xn) : 0;
      hud.xp.firstChild.style.width = (xpf * 100) + "%";
      hud.xp.lastChild.textContent = "Lv " + me.lv;
      hud.hp.firstChild.style.width = Math.max(0, me.hp / me.mhp * 100) + "%";
      hud.hp.lastChild.textContent = Math.ceil(me.hp) + " / " + me.mhp;
      var wxk = v.wx && v.wx.k || "clear";
      var info = "⚔️ " + (me.kills || 0) + "　💰 " + Math.floor(me.gold || 0) + (v.mode === "tenka" ? "　🎖️ " + Math.floor(me.kg || 0) + (v.heat ? "　🐉" + v.heat : "") + (v.bm > 0 ? "　🌕" + t("yk_tk_bm") : "") : "") + "　" + D.FEATS[st.feat].icon + " " + t("yk_stage_n", { n: v.stage + 1 }) + (wxk !== "clear" ? "　" + t("yk_wxs_" + wxk) : "") + (me.jin ? "　" + t("yk_jin", { n: me.jin }) : "");
      if (hud.info.textContent !== info) hud.info.textContent = info;
      var u = D.ULTS[D.DAIMYO[me.dm].ult];
      hud.ult.firstChild.textContent = u.icon;
      var tierN = Core.ultTier(me), ultTxt = (me.ult >= 100 ? L(u.name) : Math.floor(me.ult) + "%") + (tierN > 1 ? " ・" + "★".repeat(tierN - 1) : "");
      if (hud.ult.lastChild.textContent !== ultTxt) hud.ult.lastChild.textContent = ultTxt;
      var uc = "yk-ult" + (me.ult >= 100 ? " yk-ult-ready" : "");
      if (hud.ult.className !== uc) hud.ult.className = uc;
      hud.ult.style.setProperty("--yk-ult", (Math.min(100, me.ult) * 3.6) + "deg");
      // 武器與飾品（有變化才重畫）
      var sig = JSON.stringify([me.W, me.A, me.arc || []]);
      if (sig !== hud.itemsSig || force) {
        hud.itemsSig = sig;
        hud.items.innerHTML = "";
        me.W.forEach(function (w) {
          var W = D.WEAPONS[w.id], evoReady = Core.canEvolve(me, w);
          var wm = Core.weaponMods(me, w);
          hud.items.appendChild(el("span", { class: "yk-slot" + (w.evo ? " yk-slot-evo" : evoReady ? " yk-slot-ready" : ""), title: weaponName(w.id, w.evo) + " Lv" + w.lv + (wm.length ? "　" + wm.map(function (m) { return L(D.MODS[m].name); }).join("・") : ""), style: "border-color:" + hex(D.VARIANTS[W.v].color) }, [W.icon, el("b", null, [w.evo ? "★" : String(w.lv)]), wm.length ? el("i", { class: "yk-slot-mods" }, [wm.map(function (m) { return D.MODS[m].icon; }).join("")]) : null]));
        });
        hud.items.appendChild(el("span", { class: "yk-slot-sep" }));
        me.A.forEach(function (a) {
          var A = D.ACCS[a.id];
          hud.items.appendChild(el("span", { class: "yk-slot yk-slot-acc yk-r" + A.r, title: L(A.name) + " Lv" + a.lv }, [D.STATS[A.s].icon, el("b", null, [String(a.lv)])]));
        });
        var pb = Core.prefBonus(me);
        if (pb.length) hud.items.appendChild(el("span", { class: "yk-chip yk-pb" }, [pb.map(function (x) { return "🔗" + L(D.PREFS[x.p].name) + x.n; }).join(" ")]));
        Core.synergies(me).forEach(function (y) { hud.items.appendChild(el("span", { class: "yk-chip yk-pb yk-syn" }, ["🤝" + L(y.name)])); });
        if (v.mode === "tenka") {
          var tiers = Core.schoolTiers(me);
          Object.keys(tiers).forEach(function (sk) { var sc = TK.SCHOOL[sk]; hud.items.appendChild(el("span", { class: "yk-chip yk-pb yk-tk-school", title: L(sc.desc) }, [sc.icon + L(sc.name) + "★".repeat(tiers[sk])])); });
          (me.arc || []).forEach(function (k) { var a = TK.ARC[k]; if (a) hud.items.appendChild(el("span", { class: "yk-chip yk-pb yk-tk-arcchip", title: L(a.desc) }, [a.icon + L(a.name)])); });
        }
      }
      // 選升級
      renderModal(me, v);
    }
    // 首領血條
    var bh = v.bh !== undefined ? v.bh : null, bn = v.bossName, mb = null, mbn = null;
    if (sess.host) {
      v.E.forEach(function (e) { if (e.boss && e.fin) bh = e.hp / e.mhp; else if (e.boss) { mb = e.hp / e.mhp; mbn = e.bn; } });
    } else { mb = v.mb; mbn = v.mbn; }
    if (bh !== null && bh !== undefined && bn) { hud.boss.classList.remove("yk-hidden"); hud.boss.firstChild.style.width = Math.max(0, bh * 100) + "%"; hud.boss.lastChild.textContent = "👹 " + L(bn); }
    else if (mb !== null && mb !== undefined && mbn) { hud.boss.classList.remove("yk-hidden"); hud.boss.firstChild.style.width = Math.max(0, mb * 100) + "%"; hud.boss.lastChild.textContent = "⚠ " + L(mbn); }
    else hud.boss.classList.add("yk-hidden");
    // 關卡特色
    var fe = v.fe || {};
    var ft = "";
    if (fe.on) ft = D.FEATS[fe.k].icon + " " + t("yk_feat_" + fe.k);
    // 正在祠旁祈願：顯示進度
    if (me && !me.down) (v.D || []).forEach(function (d) {
      if (d.k === "hokora" && (d.x - me.x) * (d.x - me.x) + (d.z - me.z) * (d.z - me.z) < 2.4 * 2.4) ft = "⛩ " + t("yk_praying", { n: Math.min(100, Math.round((sess.host ? d.p : d.p) / 3 * 100)) });
    });
    if (ft) { hud.feat.classList.remove("yk-hidden"); if (hud.feat.textContent !== ft) hud.feat.textContent = ft; } else hud.feat.classList.add("yk-hidden");
    // 連斬
    var cbp = me ? Math.round(Core.comboBonus(me) * 100) : 0;
    var cbt = me && me.cb >= 10 ? (cbp > 0 ? t("yk_combo", { n: me.cb, p: cbp }) : t("yk_combo0", { n: me.cb })) : "";
    if (hud.combo.textContent !== cbt) hud.combo.textContent = cbt;
    // 軍令
    var q = v.q, qt = "";
    if (q && q.k === "rescue") qt = "🆘 " + t("yk_tk_q_rescue", { n: L(TK.musumeName(q.img)) }) + "　" + (Math.round((q.h || 0) * 10) / 10) + "/" + q.n + "s　❤️" + (q.hp | 0) + "　⏱" + Math.max(0, Math.ceil(q.T));
    else if (q && TK.QUEST[q.k]) qt = "📜 " + L(TK.QUEST[q.k].name).replace("{n}", q.n) + "　" + (q.k === "nohit" ? Math.floor(q.h) + "/" + q.n + "s" : Math.min(q.n, Math.floor(q.h)) + "/" + q.n) + "　⏱" + Math.max(0, Math.ceil(q.T));
    if (qt) {
      hud.quest.classList.remove("yk-hidden");
      var qimg = q.k === "rescue" ? musumeSrc(q.img) : "";
      if (hud.quest._txt !== qt || hud.quest._img !== qimg) {
        hud.quest._txt = qt; hud.quest._img = qimg;
        hud.quest.innerHTML = "";
        if (qimg) hud.quest.appendChild(el("img", { src: qimg, alt: "", class: "yk-tk-face" }));
        hud.quest.appendChild(document.createTextNode(qt));
      }
    } else hud.quest.classList.add("yk-hidden");
    // 隊伍
    var pids = Object.keys(v.P);
    var tsig = pids.map(function (p) { var P = v.P[p]; return p + Math.round(P.hp / P.mhp * 20) + P.down + P.lv + (P.afk ? "z" : ""); }).join("|");
    if (tsig !== hud.teamSig && pids.length > 1) {
      hud.teamSig = tsig;
      hud.team.innerHTML = "";
      pids.forEach(function (p) {
        var P = v.P[p], d = D.DAIMYO[P.dm];
        hud.team.appendChild(el("div", { class: "yk-tm" + (P.down ? " yk-tm-down" : "") }, [crestBadge(d), el("span", { class: "yk-tm-n" }, [(P.afk ? "💤 " : "") + (P.name || L(d.name)) + " Lv" + P.lv]), el("div", { class: "yk-tm-hp" }, [el("div", { style: "width:" + Math.max(0, P.hp / P.mhp * 100) + "%" })])]));
      });
    } else if (pids.length <= 1) hud.team.innerHTML = "";
    // 暫停
    if (sess.solo && ui.paused) {
      if (hud.pause.classList.contains("yk-hidden")) {
        hud.pause.classList.remove("yk-hidden");
        hud.pause.innerHTML = "";
        hud.pause.appendChild(el("div", { class: "yk-modal-box" }, [el("h2", null, ["⏸ " + t("yk_paused")]), statsBlock(me), el("div", { class: "yk-actions" }, [btn(t("yk_resume"), togglePause, "yk-btn yk-primary"), btn(t("yk_quit"), quitGame, "yk-btn")])]));
      }
    } else hud.pause.classList.add("yk-hidden");
    // 結束
    if (v.ph === "won" || v.ph === "lost") finishGame(false);
  }
  function statsBlock(me) {
    if (!me) return null;
    var st = me.st || Core.calcStats(me, sess.view);
    return el("div", { class: "yk-statgrid" }, D.STATS.map(function (s) {
      var val = st[s.k], base = Core.baseStats()[s.k];
      var txt = s.pct ? (s.k === "cdr" || s.k === "crit" ? Math.round(val * 100) + "%" : "×" + (Math.round(val * 100) / 100)) : String(Math.round(val * 100) / 100);
      return el("span", { class: "yk-small" + (val !== base ? "" : " yk-muted") }, [s.icon, " ", L(s.name), " ", txt]);
    }));
  }
  function optCard(me, o, i) {
    var icon = "", title = "", sub = "", desc = "", cls = "yk-opt";
    if (o.t === "arc") {
      var Ar = TK.ARC[o.k];
      icon = Ar.icon; title = L(Ar.name); sub = t("yk_tk_opt_arc"); desc = L(Ar.desc);
      cls += " yk-tk-opt-arc";
    } else if (o.t === "m") {
      var Wm = D.WEAPONS[o.id], Md = D.MODS[o.m], curm = me.W[o.i];
      icon = Md.icon; title = L(Md.name) + "：" + L(Wm.name);
      sub = t("yk_opt_mod") + "（" + ((curm && curm.mods ? curm.mods.length : 0) + 1) + "/" + D.MAX_MOD + "）";
      desc = L(Md.desc);
      cls += " yk-opt-mod";
    } else if (o.t === "w" || o.t === "wu") {
      var W = D.WEAPONS[o.id], A = D.ARCHES[W.a], V = D.VARIANTS[W.v];
      var cur = o.t === "wu" ? me.W[o.i] : null;
      icon = W.icon; title = L(W.name);
      sub = o.t === "w" ? t("yk_opt_new_w") : "Lv " + cur.lv + " → " + (cur.lv + 1);
      desc = L(W.desc) + (o.t === "wu" ? "　" + t("yk_lvup_" + (cur.lv + 1)) : "") + "　🔗" + L(D.PREFS[V.pref].name);
      if (o.t === "wu" && cur.lv + 1 >= D.MAX_WLV) desc += "　★ " + t("yk_evo_hint", { e: L(A.evoName), s: L(D.STAT[A.evo].name) });
      cls += o.t === "w" ? " yk-opt-new" : "";
    } else if (o.t === "a" || o.t === "au") {
      var Ac = D.ACCS[o.id], cur2 = o.t === "au" ? me.A[o.i] : null, lv = cur2 ? cur2.lv + 1 : 1;
      icon = D.STATS[Ac.s].icon; title = L(Ac.name);
      sub = o.t === "a" ? t("yk_opt_new_a") + " " + "★".repeat(Ac.r) : "Lv " + cur2.lv + " → " + lv;
      var stx = D.accStats(o.id, lv);
      desc = Object.keys(stx).map(function (k) { return statText(k, stx[k]); }).join("・") + "　🔗" + L(D.PREFS[Ac.pref].name);
      var evoFor = D.ARCHES.filter(function (A2) { return A2.evo === D.STATS[Ac.s].k && me.W.some(function (w) { return D.WEAPONS[w.id].a === D.ARCHES.indexOf(A2); }); });
      if (evoFor.length) desc += "　★ " + t("yk_evo_key", { e: L(evoFor[0].evoName) });
      cls += " yk-opt-acc yk-r" + Ac.r;
    } else if (o.t === "heal") { icon = "🍙"; title = t("yk_opt_heal"); }
    else { icon = "💰"; title = t("yk_opt_gold"); }
    return el("button", { type: "button", class: cls, onclick: function (ev) { ev.stopPropagation(); pickOpt(i); } }, [
      el("span", { class: "yk-opt-icon" }, [icon]), el("span", { class: "yk-opt-body" }, [el("strong", null, [title]), el("span", { class: "yk-opt-sub" }, [sub]), el("span", { class: "yk-small" }, [desc])]), el("span", { class: "yk-opt-key" }, [String(i + 1)])
    ]);
  }
  function renderModal(me, v) {
    var m = hud.modal;
    if (!me.opts || me.down || v.ph !== "play") { m.classList.add("yk-hidden"); hud.modalSig = ""; return; }
    var sig = optSig(me);
    if (sig === hud.modalSig) return;
    if (!sess.host && sig === sentPick) return;   // 已送出，等房主的新快照
    hud.modalSig = sig;
    m.classList.remove("yk-hidden");
    m.innerHTML = "";
    var isArc = me.opts[0] && me.opts[0].t === "arc";
    var banRow = null;
    if (!isArc && me.bn > 0) {
      var bans = [];
      me.opts.forEach(function (o, i) { if (o.t === "w" || o.t === "a" || o.t === "m") bans.push(btn("🚫" + (i + 1), function (ev) { ev.stopPropagation(); banishOpt(i); }, "yk-btn yk-tk-ban", { title: t("yk_tk_ban_note") })); });
      if (bans.length) banRow = el("div", { class: "yk-actions" }, [el("span", { class: "yk-small" }, [t("yk_tk_ban", { n: me.bn })])].concat(bans));
    }
    m.appendChild(el("div", { class: "yk-modal-box yk-lvbox" + (isArc ? " yk-tk-arcbox" : "") }, [
      el("h2", null, [isArc ? "🎴 " + t("yk_tk_arc_title") : "⬆ " + t("yk_levelup", { n: me.lv }) + (me.pend > 1 ? "（" + t("yk_more", { n: me.pend - 1 }) + "）" : "")]),
      sess.solo ? null : el("p", { class: "yk-small yk-muted" }, [t("yk_lv_net_note")]),
      el("div", { class: "yk-opts" }, me.opts.map(function (o, i) { return optCard(me, o, i); })),
      banRow,
      el("div", { class: "yk-actions" }, [me.rr > 0 ? btn("🎲 " + t("yk_reroll", { n: me.rr }), function (ev) { ev.stopPropagation(); reroll(); }, "yk-btn") : null,
        !isArc && me.sk > 0 ? btn("⏭️ " + t("yk_tk_skip", { n: me.sk }), function (ev) { ev.stopPropagation(); skipLv(); }, "yk-btn") : null])
    ]));
  }

  // ---------------- 結算 ----------------
  var lastResult = null;
  function finishGame(quit) {
    if (recorded || !sess) return;
    recorded = true;
    var v = getView();
    var me = v && v.P[sess.pid];
    var won = v && v.ph === "won";
    var pg = progress();
    var gold = me ? Math.floor(me.gold) : 0;
    pg.bank += gold;
    pg.games++;
    pg.kills += me ? me.kills | 0 : 0;
    if (won) {
      pg.wins++;
      var rank = { normal: 1, hard: 2, hell: 3 }, prev = pg.cleared[v.stage];
      if (v.dur >= 900 && (!prev || rank[v.diff] > rank[prev])) pg.cleared[v.stage] = v.diff;
    }
    var bkey = v ? v.stage + ":" + v.diff + ":" + v.dur : "";
    if (me && bkey && (!pg.best[bkey] || (pg.best[bkey].won ? 1 : 0) < (won ? 1 : 0) || (pg.best[bkey].won === won && pg.best[bkey].t < v.t))) pg.best[bkey] = { won: won, t: Math.round(v.t), lv: me.lv, k: me.kills };
    if (me) pg.used[me.dm] = (pg.used[me.dm] | 0) + 1;
    saveProgress(pg);
    // 天下布武：結算軍功（新幣別）與符文
    var tkRes = null;
    if (v && v.mode === "tenka" && me) {
      var tp = tkProgress(), heat = v.heat | 0, hm = TK.heatMul(heat);
      var medalMul = hm.medal * (1 + 0.12 * TK.treeSp(tp.tree, "medal")) * (v.dur < 900 ? 0.4 : 1);
      var parts = { run: me.kg || 0, time: Math.floor(v.t / 60) * 3, kills: Math.floor((me.kills || 0) / 150), win: won ? 25 + 10 * v.stage + { normal: 0, hard: 10, hell: 25 }[v.diff] : 0 };
      var kg = Math.round((parts.run + parts.time + parts.kills + parts.win) * medalMul);
      tp.kg += kg; tp.games++;
      if (won) tp.wins++;
      var nR = (won ? 2 : 0) + Math.min(2, Math.floor(v.t / 300)) + (heat >= 3 ? 1 : 0), got = [];
      for (var ri = 0; ri < nR; ri++) { var rk = TKUI.rollRune(Math.random, Math.min(1, heat * 0.15 + v.stage * 0.05 + (won ? 0.15 : 0))); TKUI.addRune(tp, rk); got.push(rk); }
      var tkey = v.stage + ":" + v.diff + ":" + heat;
      if (!tp.best[tkey] || (tp.best[tkey].won ? 1 : 0) < (won ? 1 : 0) || (!!tp.best[tkey].won === won && tp.best[tkey].t < v.t)) tp.best[tkey] = { won: won, t: Math.round(v.t), lv: me.lv };
      saveTk(tp);
      var saved = (v.saved || []).slice();
      tp.saved = tp.saved || {};
      saved.forEach(function (i) { tp.saved[i] = (tp.saved[i] | 0) + 1; });
      saveTk(tp);
      tkRes = { kg: kg, parts: parts, mul: medalMul, runes: got, heat: heat, arc: me.arc || [], saved: saved };
    }
    lastResult = {
      won: won, quit: quit, t: v ? v.t : 0, stage: v ? v.stage : 0, diff: v ? v.diff : "normal", dur: v ? v.dur : 900, gold: gold, tk: tkRes,
      players: v ? Object.keys(v.P).map(function (pid) { var P = v.P[pid]; return { me: pid === sess.pid, name: P.name, dm: P.dm, lv: P.lv, kills: P.kills, cbMax: P.cbMax || 0, dmg: P.dmg, W: P.W, A: P.A }; }) : []
    };
    setTimeout(function () {
      if (ui.room && !sess.solo) {
        if (ui.room.isHost()) ui.room.backToLobby();
      }
      sess = null;
      ui.screen = "result";
      render();
    }, quit ? 0 : 1800);
  }
  function renderResult() {
    var r = lastResult;
    if (!r) { goHome(); return; }
    var st = D.STAGES[r.stage];
    app.appendChild(panel((r.won ? "🏆 " + t("yk_won") : r.quit ? "🚪 " + t("yk_quitted") : "💀 " + t("yk_lost")), [
      el("p", null, [t("yk_stage_n", { n: r.stage + 1 }), " ", L(st.name), "・", L(D.DIFFS[r.diff].name), "・", t("yk_survived", { t: mmss(r.t) })]),
      el("p", null, [t("yk_gold_got", { n: r.gold, b: Math.floor(progress().bank) })]),
      r.tk ? el("div", { class: "yk-tk-result" }, [
        el("p", null, ["🎖️ " + t("yk_tk_kg_got", { n: r.tk.kg, b: Math.floor(tkProgress().kg) })]),
        el("p", { class: "yk-small yk-muted" }, [t("yk_tk_kg_parts", { a: Math.round(r.tk.parts.run), b: r.tk.parts.time, c: r.tk.parts.kills, d: r.tk.parts.win, m: Math.round(r.tk.mul * 100) / 100 })]),
        r.tk.arc.length ? el("p", { class: "yk-small" }, [t("yk_tk_arc_used"), "：", r.tk.arc.map(function (k) { return TK.ARC[k] ? TK.ARC[k].icon + L(TK.ARC[k].name) : ""; }).join("・")]) : null,
        r.tk.saved.length ? el("div", null, [el("p", null, ["💐 " + t("yk_tk_saved_n", { n: r.tk.saved.length })]), el("div", { class: "yk-tk-faces" }, r.tk.saved.map(function (i) { return el("figure", { class: "yk-tk-fig" }, [el("img", { src: musumeSrc(i), alt: L(TK.musumeName(i)), class: "yk-tk-face-big" }), el("figcaption", { class: "yk-small" }, [L(TK.musumeName(i))])]); }))]) : null,
        r.tk.runes.length ? el("div", null, [el("p", null, ["🔲 " + t("yk_tk_runes_got", { n: r.tk.runes.length })]), el("div", { class: "yk-chips" }, r.tk.runes.map(function (k) { var R = TK.RUNE[k]; return el("span", { class: "yk-chip yk-r" + R.r }, [el("span", { class: "yk-tk-shape", html: TKUI.shapeSvg(k, 0, 8, tkCtx()) }), " ", L(R.name)]); }))]) : null
      ]) : null,
      r.won && r.dur >= 900 && r.stage + 1 < D.STAGES.length ? el("p", { class: "yk-good" }, [t("yk_next_unlocked", { n: L(D.STAGES[r.stage + 1].name) })]) : null,
      el("table", { class: "yk-table" }, [el("tr", null, [t("yk_col_name"), t("yk_col_lv"), t("yk_col_kills"), t("yk_col_combo"), t("yk_col_dmg"), t("yk_col_build")].map(function (x) { return el("th", null, [x]); }))].concat(r.players.map(function (p) {
        var d = D.DAIMYO[p.dm];
        return el("tr", { class: p.me ? "yk-me" : "" }, [el("td", null, [crestBadge(d), " ", p.name || L(d.name)]), el("td", null, [String(p.lv)]), el("td", null, [String(p.kills)]), el("td", null, [String(p.cbMax || 0)]), el("td", null, [String(Math.round(p.dmg || 0))]),
          el("td", { class: "yk-small" }, [p.W.map(function (w) { return D.WEAPONS[w.id].icon + (w.evo ? "★" : w.lv); }).join(" ") + "　" + p.A.map(function (a) { return D.STATS[D.ACCS[a.id].s].icon + a.lv; }).join(" ")])]);
      }))),
      el("div", { class: "yk-actions yk-next" }, [
        ui.room ? btn(t("yk_back_lobby"), function () { ui.screen = "lobby"; render(); }, "yk-btn yk-primary") : btn("⚔️ " + t("yk_again"), function () { ui.screen = r.tk ? "tenka" : "setup"; ui.tkTab = "sortie"; if (r.won && r.dur >= 900 && r.stage + 1 < D.STAGES.length) { ui.stage = r.stage + 1; ui.map = -1; setPref({ stage: ui.stage, map: -1 }); } render(); }, "yk-btn yk-primary"),
        btn("🏯 " + t("yk_menu_meta"), function () { goAway("meta"); }, "yk-btn"),
        r.tk ? btn("🎴 " + t("yk_menu_tenka"), function () { goAway("tenka", "tree"); }, "yk-btn") : null,
        btn(t("yk_home"), goHome, "yk-btn")
      ])
    ]));
  }

  // 房主切到背景（手機鎖螢幕、切 App）時瀏覽器會暫停畫面更新，模擬就停了：把房主交給下一位玩家
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden || !sess || !sess.host || sess.solo || !ui.room || ui.screen !== "game") return;
    if (sess.s && sess.s.ph === "play") ui.room.handoff(Core.serializeNet(sess.s));
  });
  window.addEventListener("i18n:change", function () { if (ui.screen !== "game") render(); else if (hud) updateHud(true); });
  // 連結帶 ?room= 就直接進房（遊戲進行中＝中途加入）
  var rid = Net.roomFromUrl(window.location.href);
  if (rid) openRoom(rid); else render();

  window.PriTestYukimura = { _ui: ui, _sess: function () { return sess; }, _local: local, _open: openRoom, _render: render };
})();
