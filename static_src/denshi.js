// 電子守衛（denshi）：畫面。規則在 denshi_core.js、3D 在 denshi_3d.js、連線在 denshi_net.js。
//
// 「場次」（sess）把單機與連線包成同一個介面：
//   sess.s＝目前的整局狀態、sess.pid＝自己、sess.send(意圖)、sess.host＝要不要跑模擬。
//   單機：send 直接 Core.applyIntent；連線房主：套用後廣播；連線其他人：送意圖給房主，畫面用房主廣播的快照。
(function () {
  "use strict";

  var D = window.PriTestDenshiData, Core = window.PriTestDenshiCore, V3 = window.PriTestDenshi3D, Net = window.PriTestDenshiNet;
  var app = document.getElementById("ds-app");
  if (!app) return;
  var SAVE_KEY = "pritest-denshi-save", PREF_KEY = "pritest-denshi-pref", NAME_KEY = "pritest-denshi-name", PROG_KEY = "pritest-denshi-progress";
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
    ["cleared", "best", "stars", "ach", "combo", "evo"].forEach(function (k) { if (!pg[k] || typeof pg[k] !== "object") pg[k] = {}; });
    return pg;
  }
  function totalStars(pg) { var n = 0; Object.keys(pg.stars || {}).forEach(function (k) { n += pg.stars[k] || 0; }); return n; }
  // 依戰役星數解鎖的內容（每日挑戰不套用，大家條件相同）
  function myUnl() {
    var st = totalStars(progress()), u = {};
    D.UNLOCKS.forEach(function (x) { if (st >= x.stars) u[x.id] = 1; });
    return u;
  }
  function soloPlayers() { return [{ pid: "me", name: lsGet(NAME_KEY), role: ui.role }]; }
  function rolePicker(value, onpick) {
    return el("div", { class: "ds-field" }, [t("ds_role"), seg(Object.keys(D.ROLES).map(function (k) { return [k, D.ROLES[k].icon + " " + L(D.ROLES[k].name)]; }), value, onpick),
      el("p", { class: "ds-small ds-muted ds-full" }, [L(D.ROLES[value] ? D.ROLES[value].desc : D.ROLES.general.desc)])]);
  }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else e.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return e;
  }
  function btn(label, onclick, cls, attrs) {
    var a = { type: "button", class: cls || "ds-btn", onclick: onclick };
    Object.keys(attrs || {}).forEach(function (k) { a[k] = attrs[k]; });
    return el("button", a, [label]);
  }
  function panel(title, children, cls) { return el("section", { class: "ds-panel " + (cls || "") }, [title ? el("h2", null, [title]) : null].concat(children)); }
  function hex(c) { return "#" + ("000000" + c.toString(16)).slice(-6); }
  function fmt(n) { return n >= 100 ? String(Math.round(n)) : n >= 10 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(2).replace(/0$/, "").replace(/\.0$/, ""); }

  var p0 = pref();
  var ui = {
    screen: "home", mode: null, pi: 0, rot: 0, bt: null, sel: 0, hover: null, paused: false, speed: 1, room: null,
    setup: { map: p0.map === undefined ? -1 : p0.map, waves: p0.waves === undefined ? 30 : p0.waves, diff: p0.diff || "normal" },
    camp: { diff: p0.cdiff || "normal" }, toast: [], lastFx: -1, recorded: false, quality: p0.quality || "high",
    role: D.ROLES[p0.role] ? p0.role : "general", board: null, boardKey: "", boardStop: null
  };
  var sess = null, view3 = null, acc = 0, lastSave = 0, lastPush = 0, dirty = false, panelSig = "";

  // ---------------- 場次 ----------------
  function soloSession(s) {
    return {
      solo: true, pid: "me", host: true, s: s,
      send: function (it) { var ok = Core.applyIntent(this.s, "me", it); if (ok) { dirty = true; saveSolo(); } return ok; }
    };
  }
  function netSession(room) {
    var se = {
      solo: false, room: room, pid: room.pid, s: null,
      get host() { return room.isHost(); },
      send: function (it) {
        if (room.isHost()) { var ok = this.s && Core.applyIntent(this.s, room.pid, it); if (ok) { dirty = true; pushState(true); } return ok; }
        room.sendIntent(it);
        return true;
      }
    };
    if (room.wrap && room.wrap.s) se.s = Core.restore(room.wrap.s);
    return se;
  }
  function saveSolo() { if (sess && sess.solo && sess.s) { lsSet(SAVE_KEY, sess.s.end ? null : Core.serialize(sess.s, true)); lastSave = Date.now(); } }
  function pushState(now) {
    if (!ui.room || !ui.room.isHost() || !sess || !sess.s) return;
    var tnow = Date.now();
    if (!now && tnow - lastPush < 250) return;
    lastPush = tnow;
    ui.room.writeState(Core.serialize(sess.s));
  }
  function me() { return sess && sess.s && sess.s.players[sess.pid]; }

  // ---------------- 畫面切換 ----------------
  function go(screen) {
    if (view3) { view3.dispose(); view3 = null; }
    if (screen !== "daily" && ui.boardStop) { ui.boardStop(); ui.boardStop = null; ui.boardKey = ""; }
    refs = {};
    ui.screen = screen;
    render();
  }
  function render() {
    if (ui.screen === "game") { renderGame(); return; }
    if (view3) { view3.dispose(); view3 = null; }
    app.innerHTML = "";
    app.appendChild(topBar());
    if (ui.screen === "home") renderHome();
    else if (ui.screen === "setup") renderSetup();
    else if (ui.screen === "campaign") renderCampaign();
    else if (ui.screen === "codex") renderCodex();
    else if (ui.screen === "lobby") renderLobby();
    else if (ui.screen === "daily") renderDaily();
    else if (ui.screen === "ach") renderAch();
  }
  function topBar() {
    return el("div", { class: "ds-top" }, [
      el("h1", { class: "ds-title" }, ["⚡ " + t("ds_title")]),
      ui.room ? el("span", { class: "ds-roomtag" }, ["👥 " + t("ds_room_tag", { n: ui.room.list().length })]) : null,
      ui.screen !== "home" ? btn(t("ds_back"), function () { if (ui.room && ui.screen === "game") go("lobby"); else if (ui.room) { leaveRoom(); go("home"); } else go("home"); }, "ds-link") : null
    ]);
  }

  // ---------------- 首頁 ----------------
  function renderHome() {
    var pg = progress(), saved = Core.restore(lsGet(SAVE_KEY) || "null");
    app.appendChild(el("div", { class: "ds-hero" }, [
      el("div", { class: "ds-hero-art" }, [heroSvg()]),
      el("p", { class: "ds-intro" }, [t("ds_intro")])
    ]));
    app.appendChild(panel(null, [
      el("div", { class: "ds-menu" }, [
        saved ? btn(t("ds_continue", { map: L(D.MAPS[saved.map].name), w: saved.wave }), function () { startSolo(saved); }, "ds-big ds-primary") : null,
        btn("🎲 " + t("ds_menu_random"), function () { go("setup"); }, "ds-big" + (saved ? "" : " ds-primary")),
        btn("🗺️ " + t("ds_menu_campaign"), function () { go("campaign"); }, "ds-big"),
        btn("👥 " + t("ds_menu_coop"), function () { enterRoom(null); }, "ds-big"),
        btn("📅 " + t("ds_menu_daily"), function () { go("daily"); }, "ds-big"),
        btn("🏅 " + t("ds_menu_ach"), function () { go("ach"); }, "ds-big"),
        btn("📖 " + t("ds_menu_codex"), function () { go("codex"); }, "ds-big")
      ]),
      el("p", { class: "ds-muted ds-small" }, [t("ds_home_meta", { g: pg.games || 0, w: pg.wins || 0, c: Object.keys(pg.cleared || {}).length }) + "・⭐" + totalStars(pg) + "・🏅" + Object.keys(pg.ach).length + "/" + D.ACHIEVEMENTS.length])
    ]));
    app.appendChild(panel(t("ds_how_title"), [el("ol", { class: "ds-rules" }, [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return el("li", null, [t("ds_help_" + i)]); }))]));
  }
  function heroSvg() {
    var svg = '<svg viewBox="0 0 320 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="dsg" x1="0" x2="1"><stop offset="0" stop-color="#0b3a29"/><stop offset="1" stop-color="#140f2e"/></linearGradient></defs>' +
      '<rect width="320" height="110" rx="10" fill="url(#dsg)"/>' +
      '<g stroke="#c9a646" stroke-width="2" fill="none" opacity=".55"><path d="M0 30h60l12 12h70"/><path d="M0 80h90l14-14h80l10 10h126"/><path d="M180 20h60l10 10h70"/></g>' +
      '<g fill="#3cffb0"><circle cx="142" cy="42" r="4"/><circle cx="184" cy="66" r="4"/><circle cx="240" cy="20" r="4"/></g>' +
      '<rect x="262" y="38" width="38" height="38" rx="4" fill="#cfd5dc"/><rect x="273" y="49" width="16" height="16" fill="#3cffb0"/>' +
      '<g transform="translate(70 52)"><rect x="-12" y="8" width="24" height="8" rx="2" fill="#30343b"/><rect x="-9" y="-6" width="18" height="14" fill="#8a96a4"/><rect x="6" y="-3" width="20" height="4" fill="#b8c0c8"/></g>' +
      '<g transform="translate(150 70)"><rect x="-4" y="-26" width="8" height="34" fill="#c87533"/><ellipse cx="0" cy="-28" rx="12" ry="5" fill="#e4e8ee"/><path d="M8 -30l14 -8l-6 10l12 -4" stroke="#bfe0ff" stroke-width="2" fill="none"/></g>' +
      '<g fill="#4cff7a"><ellipse cx="30" cy="80" rx="8" ry="5"/><ellipse cx="14" cy="80" rx="8" ry="5"/></g><rect x="210" y="56" width="10" height="10" fill="none" stroke="#35e0ff" stroke-width="2"/></svg>';
    return el("div", { html: svg });
  }

  // ---------------- 單機設定（隨機地圖） ----------------
  function mapSelect(value, onchange, allowRandom) {
    var sel = el("select", { class: "ds-input", onchange: function (e) { onchange(+e.target.value); } }, (allowRandom ? [el("option", { value: "-1" }, [t("ds_map_random")])] : []).concat(D.MAPS.map(function (m, i) {
      return el("option", { value: String(i) }, [(i + 1) + ". " + L(m.name) + "（" + L(m.mech) + "）"]);
    })));
    sel.value = String(value);
    return sel;
  }
  function seg(options, value, onpick) {
    return el("div", { class: "ds-seg" }, options.map(function (o) { return btn(o[1], function () { onpick(o[0]); }, "ds-btn" + (o[0] === value ? " ds-on" : "")); }));
  }
  function setupFields(cfg, onchange, withCampaign) {
    var rows = [];
    if (withCampaign) rows.push(el("label", { class: "ds-field" }, [t("ds_mode"), seg([["random", t("ds_mode_random")], ["campaign", t("ds_mode_campaign")]], cfg.mode || "random", function (v) { cfg.mode = v; if (v === "campaign" && cfg.map < 0) cfg.map = 0; onchange(); })]));
    rows.push(el("label", { class: "ds-field" }, [t("ds_map"), mapSelect(cfg.map, function (v) { cfg.map = v; onchange(); }, cfg.mode !== "campaign")]));
    if (cfg.map >= 0) rows.push(el("p", { class: "ds-hint ds-small" }, ["⚙️ " + L(D.MAPS[cfg.map].mech) + "：" + L(D.MAPS[cfg.map].mdesc)]));
    if (cfg.mode !== "campaign") rows.push(el("label", { class: "ds-field" }, [t("ds_waves"), seg([[20, t("ds_waves_n", { n: 20 })], [30, t("ds_waves_n", { n: 30 })], [0, t("ds_waves_endless")]], cfg.waves, function (v) { cfg.waves = v; onchange(); })]));
    rows.push(el("label", { class: "ds-field" }, [t("ds_diff"), seg(Object.keys(D.DIFFS).map(function (k) { return [k, L(D.DIFFS[k].name)]; }), cfg.diff, function (v) { cfg.diff = v; onchange(); })]));
    return rows;
  }
  function renderSetup() {
    var cfg = ui.setup;
    app.appendChild(panel(t("ds_menu_random"), setupFields(cfg, function () { setPref({ map: cfg.map, waves: cfg.waves, diff: cfg.diff }); render(); }).concat([
      rolePicker(ui.role, function (v) { ui.role = v; setPref({ role: v }); render(); }),
      unlockNote(),
      el("p", { class: "ds-muted ds-small" }, [t("ds_random_note")]),
      el("div", { class: "ds-actions ds-next" }, [btn(t("ds_start"), function () {
        lsSet(SAVE_KEY, null);
        startSolo(Core.newGame({ seed: Core.newSeed(), mode: "random", map: cfg.map, waves: cfg.waves, diff: cfg.diff, players: soloPlayers(), unl: myUnl() }));
      }, "ds-big ds-primary")])
    ])));
  }

  // ---------------- 戰役（十大地圖） ----------------
  function campaignSeed(i) { return 1000 + i * 7919; }
  function renderCampaign() {
    var pg = progress(), cfg = ui.camp;
    app.appendChild(panel(t("ds_menu_campaign"), [
      el("p", { class: "ds-muted" }, [t("ds_campaign_note")]),
      el("label", { class: "ds-field" }, [t("ds_diff"), seg(Object.keys(D.DIFFS).map(function (k) { return [k, L(D.DIFFS[k].name)]; }), cfg.diff, function (v) { cfg.diff = v; setPref({ cdiff: v }); render(); })]),
      rolePicker(ui.role, function (v) { ui.role = v; setPref({ role: v }); render(); }),
      el("p", { class: "ds-small" }, ["⭐ " + t("ds_stars_total", { n: totalStars(pg), m: D.MAPS.length * 3 }) + "　" + t("ds_star_rule")]),
      el("div", { class: "ds-maps" }, D.MAPS.map(function (m, i) {
        var open = i === 0 || (pg.cleared && pg.cleared[D.MAPS[i - 1].id]), done = pg.cleared && pg.cleared[m.id];
        return el("div", { class: "ds-map" + (open ? "" : " ds-locked") + (done ? " ds-done" : ""), style: "--ds-mc:" + hex(m.glow) + ";--ds-mb:" + hex(m.board) }, [
          el("div", { class: "ds-map-no" }, [String(i + 1)]),
          el("h3", null, [L(m.name), done ? " " + "⭐".repeat(pg.stars[m.id] || 1) : ""]),
          el("p", { class: "ds-map-mech" }, ["⚙️ " + L(m.mech)]),
          el("p", { class: "ds-small" }, [L(m.mdesc)]),
          pg.best && pg.best[m.id] ? el("p", { class: "ds-small ds-muted" }, [t("ds_best", { n: pg.best[m.id] })]) : null,
          open ? btn(t("ds_play"), function () {
            lsSet(SAVE_KEY, null);
            startSolo(Core.newGame({ seed: campaignSeed(i), mode: "campaign", map: i, waves: 20, diff: cfg.diff, players: soloPlayers(), unl: myUnl() }));
          }, "ds-btn ds-primary") : el("p", { class: "ds-small ds-muted" }, ["🔒 " + t("ds_locked")])
        ]);
      }))
    ]));
  }

  function unlockNote() {
    var u = myUnl(), names = D.UNLOCKS.filter(function (x) { return u[x.id]; }).map(function (x) { return L(x.name); });
    return names.length ? el("p", { class: "ds-small ds-hint" }, ["🔓 " + t("ds_unlocked_now", { n: names.join("、") })]) : null;
  }

  // ---------------- 每日挑戰 ----------------
  function dailyCfg() {
    var key = Net.dailyKey(), seed = Net.dailySeed(key);
    var o = { rs: seed };
    // 跟 Core 一樣的 mulberry32：決定今天的地圖與額外混搭機制
    function r() { o.rs = (o.rs + 0x6D2B79F5) >>> 0; var x = o.rs; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }
    var map = Math.floor(r() * D.MAPS.length);
    var pool = D.MIXABLE.filter(function (id) { return id !== D.MAPS[map].id; });
    return { key: key, seed: seed, map: map, mix: pool[Math.floor(r() * pool.length)] };
  }
  function startDaily() {
    var c = dailyCfg();
    var s = Core.newGame({ seed: c.seed, mode: "daily", map: c.map, waves: 20, diff: "normal", players: soloPlayers(), unl: {}, daily: c.key });
    s.mix = [c.mix];
    lsSet(SAVE_KEY, null);
    startSolo(s);
  }
  function mapName(id) { var m = D.MAPS.filter(function (x) { return x.id === id; })[0]; return m ? L(m.name) + "・" + L(m.mech) : id; }
  function renderDaily() {
    var c = dailyCfg(), pg = progress(), m = D.MAPS[c.map];
    var mine = pg.daily && pg.daily[c.key];
    app.appendChild(panel("📅 " + t("ds_menu_daily") + "・" + c.key, [
      el("p", null, [t("ds_daily_note")]),
      el("div", { class: "ds-map", style: "--ds-mc:" + hex(m.glow) + ";--ds-mb:" + hex(m.board) }, [
        el("h3", null, [L(m.name)]),
        el("p", { class: "ds-map-mech" }, ["⚙️ " + L(m.mech) + "：" + L(m.mdesc)]),
        el("p", { class: "ds-map-mech" }, ["➕ " + t("ds_daily_mix", { n: mapName(c.mix) })])
      ]),
      rolePicker(ui.role, function (v) { ui.role = v; setPref({ role: v }); render(); }),
      el("p", { class: "ds-small" }, [mine ? t("ds_daily_mine", { n: mine }) : t("ds_daily_none")]),
      el("div", { class: "ds-actions ds-next" }, [btn(t("ds_start"), startDaily, "ds-big ds-primary")])
    ]));
    var boardBox = el("div", null, [el("p", { class: "ds-muted ds-small" }, [t("ds_connecting")])]);
    app.appendChild(panel("🏆 " + t("ds_board"), [boardBox]));
    function draw(list) {
      boardBox.innerHTML = "";
      if (!list) { boardBox.appendChild(el("p", { class: "ds-muted ds-small" }, [t("ds_board_offline")])); return; }
      if (!list.length) { boardBox.appendChild(el("p", { class: "ds-muted ds-small" }, [t("ds_board_empty")])); return; }
      var myPid = Net.myPid();
      boardBox.appendChild(el("ol", { class: "ds-board" }, list.slice(0, 50).map(function (e) {
        var r = D.ROLES[e.role];
        return el("li", { class: e.pid === myPid ? "ds-me" : "" }, [el("b", null, [e.name || t("ds_noname")]), " " + (r ? r.icon : "") + "　" + t("ds_board_row", { s: e.score, w: e.wave, hp: e.hp })]);
      })));
    }
    if (ui.boardKey !== c.key) {
      if (ui.boardStop) ui.boardStop();
      ui.board = undefined; ui.boardKey = c.key;
      try { ui.boardStop = Net.dailyWatch(c.key, function (list) { ui.board = list; if (ui.screen === "daily") draw(list); }); } catch (e) { ui.board = null; }
      setTimeout(function () { if (ui.board === undefined && ui.screen === "daily") draw(null); }, 8000);
    }
    if (ui.board !== undefined) draw(ui.board);
  }

  // ---------------- 成就與解鎖 ----------------
  function renderAch() {
    var pg = progress(), st = totalStars(pg);
    app.appendChild(panel("⭐ " + t("ds_unlocks"), [
      el("p", null, [t("ds_stars_total", { n: st, m: D.MAPS.length * 3 }) + "　" + t("ds_star_rule")]),
      el("div", { class: "ds-cards" }, D.UNLOCKS.map(function (u) {
        var ok = st >= u.stars;
        return el("div", { class: "ds-card" + (ok ? " ds-got" : " ds-dim") }, [el("b", null, [(ok ? "🔓 " : "🔒 ") + L(u.name)]), el("span", { class: "ds-cost" }, ["⭐" + u.stars]), el("p", { class: "ds-small" }, [L(u.desc)])]);
      })),
      el("p", { class: "ds-small ds-muted" }, [D.MAPS.map(function (m, i) { return (i + 1) + "." + L(m.name) + " " + (pg.stars[m.id] ? "⭐".repeat(pg.stars[m.id]) : "—"); }).join("　")])
    ]));
    app.appendChild(panel("🏅 " + t("ds_menu_ach") + "（" + Object.keys(pg.ach).length + "/" + D.ACHIEVEMENTS.length + "）", [
      el("div", { class: "ds-cards" }, D.ACHIEVEMENTS.map(function (a) {
        var ok = pg.ach[a.id];
        return el("div", { class: "ds-card" + (ok ? " ds-got" : " ds-dim") }, [el("b", null, [a.icon + " " + L(a.name)]), ok ? el("span", { class: "ds-cost" }, ["✅"]) : null, el("p", { class: "ds-small" }, [L(a.desc)])]);
      })),
      el("p", { class: "ds-small ds-muted" }, [t("ds_ach_combo", { n: Object.keys(pg.combo).length, m: D.COMBOS.length }) + "・" + t("ds_ach_evo", { n: Object.keys(pg.evo).length })])
    ]));
  }

  // ---------------- 圖鑑 ----------------
  function statLine(def, lv, skipBasic, eff) {
    var b = eff || def.lv[lv], out = [];
    if (!skipBasic) {
      if (b.dmg) out.push((def.kind === "beam" ? t("ds_st_dps") : t("ds_st_dmg")) + " " + fmt(b.dmg));
      if (b.rate && def.kind !== "beam" && def.kind !== "aura") out.push(t("ds_st_rate") + " " + fmt(b.rate) + "/s");
      if (b.range) out.push(t("ds_st_range") + " " + fmt(b.range));
    }
    if (b.splash) out.push(t("ds_st_splash") + " " + fmt(b.splash));
    if (b.slow) out.push(t("ds_st_slow") + " " + Math.round(b.slow * 100) + "%");
    if (b.chain) out.push(t("ds_st_chain") + " " + b.chain);
    if (b.pierce) out.push(t("ds_st_pierce") + " " + (b.pierce >= 99 ? "∞" : b.pierce));
    if (b.buff) out.push(t("ds_st_buff") + " +" + Math.round(b.buff * 100) + "%");
    if (b.rbuff) out.push(t("ds_st_rbuff") + " +" + b.rbuff);
    if (b.income) out.push(t("ds_st_income") + " +" + b.income);
    if (b.freezeN) out.push(t("ds_st_freeze", { n: b.freezeN, s: b.freezeT }));
    return out.join("・");
  }
  function renderCodex() {
    var cats = [["base", t("ds_cat_base")], ["evo", t("ds_cat_evo")], ["elec", t("ds_cat_elec")]];
    app.appendChild(panel(t("ds_codex_towers"), cats.map(function (c) {
      return el("div", null, [el("h3", null, [c[1]]), el("div", { class: "ds-cards" }, Object.keys(D.TOWERS).filter(function (k) { return D.TOWERS[k].cat === c[0]; }).map(function (k) {
        var d = D.TOWERS[k];
        return el("div", { class: "ds-card" }, [
          el("b", null, [d.icon + " " + L(d.name)]), el("span", { class: "ds-cost" }, ["💠" + d.cost]),
          d.from ? el("div", { class: "ds-small ds-muted" }, [t("ds_from", { n: L(D.TOWERS[d.from].name) })]) : null,
          el("p", { class: "ds-small" }, [L(d.desc)]),
          el("p", { class: "ds-small ds-muted" }, [(d.dtype === "kin" ? t("ds_kin") : t("ds_en")) + (d.air ? "・" + t("ds_air_ok") : d.kind === "shell" ? "・" + t("ds_air_no") : "")]),
          el("p", { class: "ds-small ds-mono" }, ["Lv1 " + statLine(d, 0)]),
          el("p", { class: "ds-small ds-mono" }, ["Lv" + d.lv.length + " " + statLine(d, d.lv.length - 1)])
        ]);
      }))]);
    })));
    app.appendChild(panel("🔗 " + t("ds_codex_combos"), [el("p", { class: "ds-small ds-muted" }, [t("ds_combo_note")]), el("div", { class: "ds-cards" }, D.COMBOS.map(function (c) {
      return el("div", { class: "ds-card", style: "border-left:4px solid #ffd04a" }, [el("b", null, [L(c.name)]), el("p", { class: "ds-small" }, [L(c.desc)])]);
    }))]));
    app.appendChild(panel("🧑‍🤝‍🧑 " + t("ds_codex_roles"), [el("div", { class: "ds-cards" }, Object.keys(D.ROLES).map(function (k) {
      var r = D.ROLES[k];
      return el("div", { class: "ds-card" }, [el("b", null, [r.icon + " " + L(r.name)]), el("p", { class: "ds-small" }, [L(r.desc)])]);
    })), el("h3", null, [t("ds_codex_skills")]), el("div", { class: "ds-cards" }, Object.keys(D.SKILLS).map(function (k) {
      var sk = D.SKILLS[k];
      return el("div", { class: "ds-card" }, [el("b", null, [sk.icon + " " + L(sk.name) + "（" + sk.key + "）"]), el("span", { class: "ds-cost" }, ["⏱" + sk.cd + "s"]), el("p", { class: "ds-small" }, [L(sk.desc)])]);
    })), el("p", { class: "ds-small ds-muted" }, [t("ds_net_note")])]));
    app.appendChild(panel(t("ds_codex_enemies"), [el("div", { class: "ds-cards" }, Object.keys(D.ENEMIES).map(function (k) {
      var e = D.ENEMIES[k];
      return el("div", { class: "ds-card", style: "border-left:4px solid " + hex(e.color) }, [
        el("b", null, [L(e.name), e.boss ? " 👑" : ""]),
        el("p", { class: "ds-small" }, [L(e.desc)]),
        el("p", { class: "ds-small ds-muted ds-mono" }, ["HP " + e.hp + (e.shield ? "・🛡" + e.shield : "") + (e.armor ? "・" + t("ds_armor") + e.armor : "") + "・" + t("ds_speed") + e.spd + (e.from ? "・" + t("ds_from_wave", { n: e.from }) : "")])
      ]);
    }))]));
    app.appendChild(panel(t("ds_codex_maps"), [el("div", { class: "ds-cards" }, D.MAPS.map(function (m, i) {
      return el("div", { class: "ds-card", style: "border-left:4px solid " + hex(m.glow) }, [el("b", null, [(i + 1) + ". " + L(m.name)]), el("p", { class: "ds-small" }, ["⚙️ " + L(m.mech) + "：" + L(m.mdesc)])]);
    }))]));
    app.appendChild(panel(t("ds_codex_mods"), [el("div", { class: "ds-cards" }, Object.keys(D.MODS).map(function (k) {
      var m = D.MODS[k];
      return el("div", { class: "ds-card", style: "border-left:4px solid " + hex(m.color) }, [el("b", null, [m.icon + " " + L(m.name) + (m.lock ? " 🔒" : "")]), el("p", { class: "ds-small" }, [L(m.desc)])]);
    })), el("p", { class: "ds-small ds-muted" }, [t("ds_mods_note")])]));
  }

  // ---------------- 遊戲畫面 ----------------
  function startSolo(s) {
    if (ui.room) leaveRoom();
    sess = soloSession(s);
    resetGameUi();
    saveSolo();
    go("game");
  }
  function resetGameUi() {
    setMode(null); ui.sel = 0; ui.bt = null; ui.pi = 0; ui.rot = 0; ui.hover = null; ui.paused = false; ui.lastFx = -1; ui.recorded = false; ui.toast = [];
    acc = 0; panelSig = "";
    var p = me();
    if (p && p.pieces.length) setMode("piece");
  }

  var refs = {}, viewToken = 0;
  function renderGame() {
    var s = sess && sess.s;
    if (!s) { app.innerHTML = ""; app.appendChild(topBar()); app.appendChild(panel(null, [el("p", { class: "ds-muted" }, [t("ds_connecting")])])); return; }
    if (refs.stage && refs.stage.isConnected && refs.side && refs.side.isConnected) { panelSig = ""; updatePanel(); return; }
    app.innerHTML = "";
    app.appendChild(topBar());
    var m = D.MAPS[s.map];
    refs = {};
    refs.hud = el("div", { class: "ds-hud" });
    refs.stage = el("div", { class: "ds-stage" }, [
      refs.toast = el("div", { class: "ds-toasts" }),
      el("div", { class: "ds-cam" }, [
        btn("⟲", function () { if (view3) view3.rotate(-Math.PI / 8); }, "ds-iconbtn", { title: t("ds_cam_rot") }),
        btn("⟳", function () { if (view3) view3.rotate(Math.PI / 8); }, "ds-iconbtn", { title: t("ds_cam_rot") }),
        btn("＋", function () { if (view3) view3.zoom(0.85); }, "ds-iconbtn"),
        btn("－", function () { if (view3) view3.zoom(1.18); }, "ds-iconbtn"),
        btn("⌂", function () { if (view3) view3.resetCam(); }, "ds-iconbtn", { title: t("ds_cam_reset") }),
        btn("📘", function () {
          var lg = app.querySelector(".ds-legend");
          if (!lg) return;
          lg.open = true; setPref({ legend: 1 });
          try { lg.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) { lg.scrollIntoView(); }
        }, "ds-iconbtn", { title: t("ds_legend"), id: "ds-legend-btn" })
      ]),
      refs.mech = el("div", { class: "ds-mechtag", style: "--ds-mc:" + hex(m.glow) }, [mechText(s)]),
      refs.skills = el("div", { class: "ds-skills" }, Object.keys(D.SKILLS).map(function (k) {
        var sk = D.SKILLS[k];
        var b = el("button", { type: "button", class: "ds-skill", "data-skill": k, title: L(sk.name) + "：" + L(sk.desc), onclick: function () { useSkill(k); } }, [
          el("span", { class: "ds-skill-ic" }, [sk.icon]), el("span", { class: "ds-skill-n" }, [L(sk.name)]), el("kbd", null, [sk.key]), el("i", { class: "ds-skill-cd" })
        ]);
        return b;
      })),
      refs.pop = el("div", { class: "ds-pop", hidden: true }),
      refs.endBox = el("div", { class: "ds-endbox", hidden: true })
    ]);
    refs.side = el("div", { class: "ds-side" });
    app.appendChild(refs.hud);
    app.appendChild(el("div", { class: "ds-game" }, [refs.stage, refs.side]));
    app.appendChild(el("p", { class: "ds-small ds-muted ds-keys" }, [t("ds_keys")]));
    updateHud();
    updatePanel();
    if (!V3.available()) { refs.stage.appendChild(el("p", { class: "ds-center" }, [t("ds_no_webgl")])); return; }
    var loadingMsg = el("p", { class: "ds-center ds-loading" }, [t("ds_loading3d")]);
    var stage = refs.stage, token = ++viewToken;
    stage.appendChild(loadingMsg);
    V3.load().then(function () {
      // 載入期間畫面可能被重建過（連線狀態變化）：只讓最後一次、而且還掛在頁面上的舞台建立 3D
      if (ui.screen !== "game" || token !== viewToken || !stage.isConnected || view3) return;
      loadingMsg.remove();
      view3 = V3.create(stage, {
        quality: ui.quality,
        getState: function () { return sess && sess.s; },
        getUi: ghostInfo,
        onCell: onCell,
        onHover: function (c) { ui.hover = c; },
        onFrame: onFrame
      });
    }, function () { loadingMsg.textContent = t("ds_no_webgl"); });
  }

  function mechText(s) {
    var m = D.MAPS[s.map];
    return "⚙️ " + L(m.name) + "・" + L(m.mech) + (s.mix && s.mix.length ? "　➕ " + s.mix.map(function (id) { var mm = D.MAPS.filter(function (x) { return x.id === id; })[0]; return mm ? L(mm.mech) : id; }).join("・") : "");
  }
  // 待放置的懸浮視窗：跟著殘影在畫面上的位置；內容只在狀態改變時重建（避免按鈕被每影格重建吃掉點擊）
  var popKey = "";
  function updatePopup(s, p) {
    var pop = refs.pop;
    if (!pop) return;
    var picking = ui.pick && s.pl && s.pl[ui.pick] && s.phase === "build";
    var at = picking ? ui.pickAt : ui.pending, show = at && p && !s.end && (picking || (ui.mode === "piece" && p.pieces[ui.pi]) || (ui.mode === "build" && ui.bt));
    if (!show) { if (!pop.hidden) { pop.hidden = true; popKey = ""; } return; }
    if (picking) {
      var rec = s.pl[ui.pick], ntw = rec.cells.filter(function (ci) { return Core.towerAt(s, ci % Core.W, Math.floor(ci / Core.W)); }).length;
      var pkey = "pick|" + ui.pick + "|" + ntw + "|" + window.I18N.getLang();
      if (pkey !== popKey) {
        popKey = pkey;
        pop.innerHTML = "";
        pop.appendChild(el("div", { class: "ds-pop-t" }, [t("ds_pick_title")]));
        pop.appendChild(el("div", { class: "ds-pop-info" }, [[t("ds_pick_note")].concat(ntw ? [t("ds_pick_towers", { n: ntw })] : []).join(" ")]));
        pop.appendChild(el("div", { class: "ds-pop-b" }, [
          btn("↺ " + t("ds_pick_btn"), function () { pickupNow(ui.pick); }, "ds-btn ds-primary", { id: "ds-pop-pick" }),
          btn("✕", function () { ui.pick = 0; }, "ds-btn", { id: "ds-pop-cancel" })
        ]));
      }
      pop.hidden = false;
      placePop(pop, at);
      return;
    }
    var ok, why = "", title, cost = 0, info;
    if (ui.mode === "piece") {
      var gc = pieceGhost(s, p, at);
      ok = gc.ok; why = gc.why ? t("ds_place_" + gc.why) : "";
      title = t("ds_pop_piece");
      var info = [];
      if (gc.paths) {
        // 最短路徑長度變化（只列下一波會出怪的入口）
        var used = Core.waveSpawns(s, s.phase === "wave" ? s.wave : s.wave + 1);
        gc.paths.forEach(function (pp, i) {
          if (s.spawns.length > 1 && !used[i]) return;
          var a = Core.pathFrom(s, s.spawns[i][0], s.spawns[i][1]).length - 1, b = pp.length - 1;
          info.push((s.spawns.length > 1 ? t("ds_pop_gate", { n: i + 1 }) : "") + t("ds_pop_path", { a: a, b: b, d: (b - a >= 0 ? "+" : "") + (b - a) }));
        });
      }
      var pmods = p.pieces[ui.pi].m || {};
      var mcount = {};
      Object.keys(pmods).forEach(function (k) { mcount[pmods[k]] = (mcount[pmods[k]] || 0) + 1; });
      Object.keys(mcount).forEach(function (k) { var md = D.MODS[k]; if (md) info.push(md.icon + " " + L(md.name) + (mcount[k] > 1 ? " ×" + mcount[k] : "") + "：" + L(md.desc)); });
    } else {
      cost = D.TOWERS[ui.bt].cost;
      ok = canBuildAt(s, at[0], at[1]) && p.cash >= cost;
      why = !s.fo[Core.idx(at[0], at[1])] ? t("ds_need_found") : Core.towerAt(s, at[0], at[1]) ? t("ds_pop_occupied") : p.cash < cost ? t("ds_no_cash") : "";
      title = D.TOWERS[ui.bt].icon + " " + L(D.TOWERS[ui.bt].name) + "　💠" + cost;
    }
    info = info || [];
    var key = [ui.mode, ui.bt, ui.pi, ui.rot, at.join(","), ok, why, info.join(";"), window.I18N.getLang()].join("|");
    if (key !== popKey) {
      popKey = key;
      pop.innerHTML = "";
      pop.appendChild(el("div", { class: "ds-pop-t" }, [title]));
      if (why) pop.appendChild(el("div", { class: "ds-pop-why" }, [why]));
      info.forEach(function (x) { pop.appendChild(el("div", { class: "ds-pop-info" }, [x])); });
      pop.appendChild(el("div", { class: "ds-pop-b" }, [
        btn("✔ " + t("ds_pop_place"), confirmPending, "ds-btn ds-primary", { id: "ds-pop-place", disabled: ok ? null : true }),
        ui.mode === "piece" ? btn("↻ " + t("ds_rotate"), function () { ui.rot = (ui.rot + 1) % 4; panelSig = ""; }, "ds-btn", { id: "ds-pop-rot" }) : null,
        btn("✕", function () { ui.pending = null; }, "ds-btn", { id: "ds-pop-cancel", title: t("ds_pop_cancel") })
      ]));
    }
    pop.hidden = false;
    placePop(pop, at);
  }
  function placePop(pop, at) {
    var pt = view3 && view3.project(at[0] + 0.5, at[1] + 0.5, 0.9);
    if (!pt) return;
    var W2 = refs.stage.clientWidth, w = pop.offsetWidth, h = pop.offsetHeight;
    var x = Math.max(4, Math.min(W2 - w - 4, pt.x - w / 2)), y = pt.y - h - 18;
    if (y < 4) y = pt.y + 30;   // 太靠上就改放在殘影下方
    pop.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
  }
  function pickupNow(id) {
    var s = sess && sess.s, rec = s && s.pl && s.pl[id];
    if (!rec) return;
    sess.send({ a: "pickup", id: id });
    ui.pick = 0; ui.sel = 0;
    var p = me();
    if (sess.solo || sess.host) {
      // 拿回手上後直接進入放置模式，殘影停在原位置、原方向，方便微調
      setMode("piece"); ui.pi = p.pieces.length - 1; ui.rot = rec.r; ui.pending = [rec.x, rec.y]; ui.hover = [rec.x, rec.y];
    } else setMode(null);
    panelSig = "";
  }
  function confirmPending() {
    var s = sess && sess.s, p = me(), at = ui.pending;
    if (!s || !p || !at) return;
    if (ui.mode === "piece" && p.pieces[ui.pi]) {
      var gc = pieceGhost(s, p, at);
      if (!gc.ok) { toast(t("ds_place_" + gc.why), "bad"); return; }
      sess.send({ a: "place", i: ui.pi, r: ui.rot, x: at[0], y: at[1] });
      ui.pi = 0; ui.pending = null;
      // 還有方塊就繼續放置模式（連線的非房主要等房主回傳才知道剩幾塊，先退出）
      if ((!sess.solo && !sess.host) || !me().pieces.length) { setMode(null); ui.hover = null; }
    } else if (ui.mode === "build" && ui.bt) {
      if (!canBuildAt(s, at[0], at[1]) || p.cash < D.TOWERS[ui.bt].cost) return;
      sess.send({ a: "build", x: at[0], y: at[1], t: ui.bt });
      ui.pending = null;
      if (me().cash < D.TOWERS[ui.bt].cost) setMode(null);
    }
    panelSig = "";
  }

  function useSkill(k) {
    var s = sess && sess.s, p = me();
    if (!s || !p) return;
    if (s.phase !== "wave") { toast(t("ds_skill_wave_only"), "bad"); return; }
    if ((p.cd[k] || 0) > s.time) { toast(t("ds_skill_cd", { n: Math.ceil(p.cd[k] - s.time) }), "bad"); return; }
    sess.send({ a: "skill", k: k });
  }
  function updateSkills(s, p) {
    if (!refs.skills || !p) return;
    Array.prototype.forEach.call(refs.skills.children, function (b) {
      var k = b.getAttribute("data-skill"), left = Math.max(0, (p.cd[k] || 0) - s.time), full = Core.skillCd(s, p, k);
      var ready = s.phase === "wave" && left <= 0;
      b.classList.toggle("ds-ready", ready);
      b.classList.toggle("ds-wait", s.phase !== "wave" || left > 0);
      var bar = b.lastChild, pct = left > 0 ? Math.round(left / full * 100) + "%" : "0%";
      if (bar.style.height !== pct) bar.style.height = pct;
      var tt = left > 0 ? Math.ceil(left) + "s" : "";
      if (bar.textContent !== tt) bar.textContent = tt;
    });
  }

  // 預覽（3D 每影格呼叫）
  function ghostInfo() {
    var s = sess && sess.s, out = { sel: ui.sel, hover: ui.hover };
    if (!s) return out;
    var p = me();
    if (s.phase === "build" && !s.end) out.nextSpawns = Core.waveSpawns(s, s.wave + 1);
    // 使用者指定 2026-11-05：點一下只產生殘影（ui.pending），按懸浮視窗的「放置」才真的放；
    // 砲塔殘影用虛線畫出射程；波次進行中（正式入侵）不再顯示任何射程圈
    var at = ui.pending || ui.hover, wave = s.phase === "wave";
    if (ui.mode === "piece" && p && p.pieces[ui.pi] && at) {
      var gc = pieceGhost(s, p, at);
      out.ghost = gc.cells; out.ghostOk = gc.ok;
      if (gc.paths) { out.ghostPaths = gc.paths; out.ghostPathKey = gc.key; }
    } else if (ui.mode === "build" && ui.bt && at) {
      var can = canBuildAt(s, at[0], at[1]);
      out.towerGhost = { ty: ui.bt, x: at[0], y: at[1], ok: can };
      var st = Core.stats(s, { ty: ui.bt, lv: 0, x: at[0], y: at[1], o: sess.pid });
      if (st.range && !wave) out.range = { x: at[0], y: at[1], r: st.range, bad: !can, ghost: true };
    }
    if (ui.pick) {
      var rec = s.pl && s.pl[ui.pick];
      if (!rec || s.phase !== "build") ui.pick = 0; else out.pickCells = rec.cells;
    }
    if (ui.sel && !out.range && !wave) {
      var tw = Core.towerById(s, ui.sel);
      if (tw) { var st2 = Core.stats(s, tw); if (st2.range) out.range = { x: tw.x, y: tw.y, r: st2.range }; }
    }
    return out;
  }

  var ghostCache = { key: "" };
  function pieceGhost(s, p, at) {
    var key = s.gv + "|" + ui.pi + "|" + ui.rot + "|" + at.join(",") + "|" + JSON.stringify(p.pieces[ui.pi]) + "|" + s.enemies.length;
    if (key !== ghostCache.key || s.phase === "wave") {
      var cells = Core.pieceCells(p.pieces[ui.pi], ui.rot, at[0], at[1]), why = Core.checkPlace(s, cells);
      ghostCache = { key: key, cells: cells, ok: !why, why: why, paths: why ? null : Core.previewPaths(s, cells) };
    }
    return ghostCache;
  }
  function canBuildAt(s, x, y) { return !!s.fo[Core.idx(x, y)] && !Core.towerAt(s, x, y); }
  function setMode(mode) { ui.mode = mode; ui.pending = null; }

  // 點電路板：只產生殘影（待放置），真正放置在懸浮視窗按「放置」
  function onCell(x, y) {
    var s = sess && sess.s, p = me();
    if (!s || !p || s.end) return;
    ui.pick = 0;
    // 地基上本來就不能放方塊：放置模式下點到自己這回合放的方塊，就當作要「拿起」
    var plAt = Core.placementAt(s, x, y);
    if (ui.mode === "piece" && plAt && s.pl[plAt].o === sess.pid && !Core.towerAt(s, x, y)) { ui.pending = null; ui.pick = plAt; ui.pickAt = [x, y]; return; }
    if (ui.mode === "piece" && p.pieces[ui.pi]) { ui.pending = [x, y]; ui.hover = [x, y]; return; }
    var tw = Core.towerAt(s, x, y);
    if (ui.mode === "build" && ui.bt) {
      if (tw) { ui.sel = tw.id; setMode(null); panelSig = ""; return; }
      ui.pending = [x, y]; ui.hover = [x, y];
      return;
    }
    if (tw) { ui.sel = tw.id; setMode(null); }
    else if (s.fo[Core.idx(x, y)]) {
      ui.sel = 0;
      var pid = Core.placementAt(s, x, y);
      if (pid && s.pl[pid].o === sess.pid) { ui.pick = pid; ui.pickAt = [x, y]; }
      else toast(t("ds_pick_tower"), "");
    }
    else ui.sel = 0;
    panelSig = "";
  }

  function onFrame(dt) {
    var s = sess && sess.s;
    if (!s) return;
    if (sess.host && !ui.paused && !s.end) {
      acc += dt * (s.speed || 1);
      var n = 0;
      while (acc >= STEP && n++ < 12) { Core.step(s, STEP); acc -= STEP; }
      if (acc > STEP * 4) acc = 0;
      var phaseChanged = s.phase !== ui.lastPhase;
      ui.lastPhase = s.phase;
      if (sess.solo) { if (Date.now() - lastSave > 4000 || phaseChanged || (dirty && s.phase === "build")) { saveSolo(); dirty = false; } }
      else if (dirty || phaseChanged || s.end) { pushState(true); dirty = false; }
      else if (s.phase === "wave" || (s.auto && s.autoT > 0)) pushState(false);
    }
    readFx(s);
    updateHud();
    updatePanel();
    if (s.end && !ui.recorded) recordEnd(s);
    updateLive(s);
  }

  function readFx(s) {
    var maxId = 0;
    s.fx.forEach(function (f) { if (f.id > maxId) maxId = f.id; });
    if (ui.lastFx < 0 || maxId < ui.lastFx) { ui.lastFx = maxId; return; }
    s.fx.forEach(function (f) {
      if (f.id <= ui.lastFx) return;
      if (f.k === "wave") toast(t(Core.bossOf(f.w) ? "ds_toast_boss" : "ds_toast_wave", { n: f.w }), "big");
      else if (f.k === "clear") toast(t("ds_toast_clear", { n: f.w }), "good");
      else if (f.k === "surge") toast(t("ds_toast_surge"), "warn");
      else if (f.k === "leak") toast(t("ds_toast_leak", { n: f.n }), "bad");
      else if (f.k === "emp") toast(t("ds_toast_emp"), "warn");
      else if (f.k === "mix") toast(t("ds_toast_mix", { n: mapName(f.id) }), "big");
      else if (f.k === "phase") toast(t("ds_toast_phase" + f.n), "big");
      else if (f.k === "eat") toast(t("ds_toast_eat"), "warn");
      else if (f.k === "split") toast(t("ds_toast_split"), "warn");
      else if (f.k === "skill") { var sp = s.players[f.o], sk = D.SKILLS[f.s]; if (sk) toast(sk.icon + " " + (sp && s.order.length > 1 ? (sp.name || t("ds_noname")) + "：" : "") + L(sk.name), "good"); }
    });
    ui.lastFx = maxId;
  }
  function toast(msg, cls) {
    if (!refs.toast) return;
    var last = refs.toast.lastChild;
    if (last && last.textContent === msg) return;
    var n = el("div", { class: "ds-toast ds-t-" + (cls || "n") }, [msg]);
    refs.toast.appendChild(n);
    while (refs.toast.children.length > 4) refs.toast.removeChild(refs.toast.firstChild);
    setTimeout(function () { n.classList.add("ds-out"); }, 1800);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 2300);
  }

  // HUD：只改文字，不重建（避免點擊被吃掉）
  function updateHud() {
    var s = sess && sess.s, p = me();
    if (!s || !refs.hud) return;
    var parts = [
      ["🌊", t("ds_hud_wave", { w: s.wave, n: s.waves ? s.waves : "∞" })],
      ["💠", p ? String(p.cash) : "-"],
      ["❤️", s.hp + "/" + s.mhp],
      ["☠️", String(s.kills)]
    ];
    if (Core.has(s, "psu")) parts.push(["🔌", t("ds_hud_volt", { v: Math.round(s.m.volt * 100) }) + (s.m.surgeU > s.time ? " ⚡" : "")]);
    if (Core.has(s, "aicore")) parts.push(["🧠", t("ds_hud_res", { k: Math.round(s.m.res.kin * 100), e: Math.round(s.m.res.en * 100) })]);
    if (s.phase === "wave") parts.push(["👾", t("ds_hud_left", { n: s.enemies.length + s.wq.length })]);
    else if (s.auto && s.autoT > 0) parts.push(["⏱", t("ds_hud_auto", { n: Math.ceil(s.autoT) })]);
    if (p) parts.push([D.ROLES[p.role] ? D.ROLES[p.role].icon : "", L((D.ROLES[p.role] || D.ROLES.general).name)]);
    updateSkills(s, p);
    updatePopup(s, p);
    var mt = mechText(s);
    if (refs.mech && refs.mech.textContent !== mt) refs.mech.textContent = mt;
    var txt = parts.map(function (x) { return x[0] + " " + x[1]; }).join("　");
    if (refs.hud.textContent !== txt) {
      refs.hud.innerHTML = "";
      parts.forEach(function (x, i) { refs.hud.appendChild(el("span", { class: "ds-hudi" + (i === 2 && s.hp <= 5 ? " ds-danger" : "") }, [x[0] + " " + x[1]])); });
    }
  }
  function updateLive(s) {
    if (refs.selStats && ui.sel) {
      var tw = Core.towerById(s, ui.sel);
      if (tw) { var tx = t("ds_tw_record", { d: Math.round(tw.dmg || 0), k: tw.kills || 0 }) + (tw.oh ? "・🔥" + t("ds_overheat") : tw.heat > 0.05 ? "・🌡" + Math.round(tw.heat * 100) + "%" : "") + (Core.offline(s, tw) ? "・📵" + t("ds_offline") : "") + (Core.grounded(s, tw) ? "・⏚" : "") + (tw.chg > s.time ? "・⚡" + t("ds_charged") : ""); if (refs.selStats.textContent !== tx) refs.selStats.textContent = tx; }
    }
    if (s.end && refs.endBox && refs.endBox.hidden) showEnd(s);
  }

  // 側欄：簽章變了才重建
  function updatePanel() {
    var s = sess && sess.s, p = me();
    if (!s || !refs.side) return;
    var tw = ui.sel && Core.towerById(s, ui.sel);
    if (ui.sel && !tw) ui.sel = 0;
    var aff = p ? D.BUILD_ORDER.map(function (k) { return p.cash >= D.TOWERS[k].cost ? 1 : 0; }).join("") : "";
    var sig = [s.phase, s.wave, s.end ? 1 : 0, ui.mode, ui.pi, ui.rot, ui.bt, ui.sel, aff, p ? JSON.stringify(p.pieces) : "", p ? p.ready : "", p ? (p.cash >= Core.buyCost(p) ? 1 : 0) + "" + (p.cash >= 15 ? 1 : 0) : "",
      tw ? tw.ty + tw.lv + tw.mode + (p && p.cash >= (Core.upgradeCost(tw, p) || 1e9) ? 1 : 0) + (D.TOWERS[tw.ty].evo ? D.TOWERS[tw.ty].evo.map(function (k) { return p && p.cash >= Core.evoCost(k, p) ? 1 : 0; }).join("") : "") + (s.tv || 0) + "g" + s.gv : "",
      p ? p.role : "", s.wave === 0 ? 1 : 0, s.pl ? Object.keys(s.pl).join(".") : "",
      s.auto, s.speed, ui.paused, s.order.map(function (k) { return k + s.players[k].ready; }).join(","), sess.host ? 1 : 0, window.I18N.getLang()].join("|");
    if (sig === panelSig) return;
    panelSig = sig;
    var side = refs.side;
    side.innerHTML = "";
    refs.selStats = null;
    if (!p) { side.appendChild(panel(null, [el("p", { class: "ds-muted" }, [t("ds_joining")])])); return; }
    side.appendChild(wavePanel(s, p));
    if (s.wave === 0 && !s.end) side.appendChild(panel(null, [rolePicker(p.role, function (v) { sess.send({ a: "role", r: v }); ui.role = v; setPref({ role: v }); if (ui.room) ui.room.update({ role: v }); panelSig = ""; })]));
    side.appendChild(piecePanel(s, p));
    side.appendChild(tw ? towerPanel(s, p, tw) : buildPanel(s, p));
    if (s.order.length > 1) side.appendChild(playersPanel(s));
    side.appendChild(legendPanel(s));
  }

  function wavePanel(s, p) {
    var kids = [];
    if (s.phase === "build" && !s.end) {
      var nw = s.wave + 1, pv = Core.wavePreview(s, nw), boss = Core.bossOf(nw);
      kids.push(el("div", { class: "ds-next-wave" }, [el("b", null, [t(boss ? "ds_next_boss" : "ds_next_wave", { n: nw })])].concat(Object.keys(pv).map(function (k) {
        var e = D.ENEMIES[k];
        return el("span", { class: "ds-chip", style: "border-color:" + hex(e.color), title: L(e.desc) }, [L(e.name) + " ×" + pv[k] + (e.fly ? " ✈" : "")]);
      }))));
      if (sess.solo) kids.push(el("div", { class: "ds-actions" }, [btn("▶ " + t("ds_start_wave"), function () { sess.send({ a: "ready", v: true }); }, "ds-btn ds-primary ds-grow", { id: "ds-start-wave" })]));
      else kids.push(el("div", { class: "ds-actions" }, [
        btn(p.ready ? "✅ " + t("ds_ready_on") : "▶ " + t("ds_ready"), function () { sess.send({ a: "ready", v: !p.ready }); }, "ds-btn ds-grow" + (p.ready ? "" : " ds-primary"), { id: "ds-start-wave" }),
        sess.host ? btn(t("ds_force_start"), function () { s.order.forEach(function (k) { Core.applyIntent(s, k, { a: "ready", v: true }); }); dirty = true; pushState(true); }, "ds-btn") : null
      ]));
    }
    var ctl = [];
    if (sess.host) {
      ctl.push(seg([[1, "×1"], [2, "×2"], [3, "×3"]], s.speed || 1, function (v) { s.speed = v; dirty = true; pushState(true); panelSig = ""; }));
      if (sess.solo) ctl.push(btn(ui.paused ? "▶ " + t("ds_resume") : "⏸ " + t("ds_pause"), function () { ui.paused = !ui.paused; panelSig = ""; }, "ds-btn" + (ui.paused ? " ds-on" : "")));
    }
    ctl.push(el("label", { class: "ds-check" }, [el("input", { type: "checkbox", checked: s.auto ? true : null, onchange: function (e) { sess.send({ a: "auto", v: e.target.checked }); } }), " " + t("ds_auto")]));
    kids.push(el("div", { class: "ds-actions" }, ctl));
    return panel(null, kids, "ds-wavep");
  }

  function pieceCanvas(pc, rot, active) {
    var cells = Core.rotCells(pc.c, rot), mw = 0, mh = 0;
    cells.forEach(function (c) { mw = Math.max(mw, c[0] + 1); mh = Math.max(mh, c[1] + 1); });
    var S = 15, cv = el("canvas", { width: String(5 * S + 4), height: String(5 * S + 4), class: "ds-piece-cv" });
    var g = cv.getContext && cv.getContext("2d");
    if (!g) return cv;
    var ox = (5 - mw) * S / 2 + 2, oy = (5 - mh) * S / 2 + 2;
    // 特殊格的索引要跟著旋轉後的格子
    cells.forEach(function (c, i) {
      var mod = pc.m && pc.m[i];
      g.fillStyle = active ? "#3cd39a" : "#7d8b96";
      g.fillRect(ox + c[0] * S, oy + c[1] * S, S - 1, S - 1);
      g.fillStyle = "rgba(212,166,64,0.9)";
      g.fillRect(ox + c[0] * S, oy + c[1] * S, 3, 3);
      if (mod) {
        g.fillStyle = hex(D.MODS[mod].color);
        g.fillRect(ox + c[0] * S + 2, oy + c[1] * S + 2, S - 5, S - 5);
        g.fillStyle = "#111"; g.font = "bold 9px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(D.MODS[mod].icon, ox + c[0] * S + S / 2 - 0.5, oy + c[1] * S + S / 2);
      }
    });
    return cv;
  }
  function piecePanel(s, p) {
    var kids = [el("h3", null, [t("ds_pieces", { n: p.pieces.length })])];
    if (!p.pieces.length) kids.push(el("p", { class: "ds-small ds-muted" }, [t("ds_no_pieces")]));
    kids.push(el("div", { class: "ds-pieces" }, p.pieces.map(function (pc, i) {
      var on = ui.mode === "piece" && ui.pi === i;
      var mods = Object.keys(pc.m || {}).map(function (k) { return D.MODS[pc.m[k]].icon + L(D.MODS[pc.m[k]].name); });
      return el("button", { type: "button", class: "ds-piece" + (on ? " ds-on" : ""), title: mods.join("、"), onclick: function () {
        if (on) ui.rot = (ui.rot + 1) % 4; else { setMode("piece"); ui.pi = i; ui.sel = 0; }
        panelSig = "";
      } }, [pieceCanvas(pc, on ? ui.rot : 0, on), mods.length ? el("span", { class: "ds-piece-mod" }, [mods.join(" ")]) : null]);
    })));
    var act = [];
    if (ui.mode === "piece" && p.pieces[ui.pi]) {
      act.push(btn("↻ " + t("ds_rotate"), function () { ui.rot = (ui.rot + 1) % 4; panelSig = ""; }, "ds-btn"));
      act.push(btn("🎲 " + t("ds_reroll", { c: Core.rerollCost(p) }), function () { sess.send({ a: "reroll", i: ui.pi }); panelSig = ""; }, "ds-btn", { disabled: p.cash < Core.rerollCost(p) ? true : null }));
      act.push(btn("🗑 " + t("ds_drop"), function () { sess.send({ a: "drop", i: ui.pi }); ui.pi = 0; if (p.pieces.length <= 1) setMode(null); panelSig = ""; }, "ds-btn"));
    }
    if (p.pieces.length < 3) act.push(btn("➕ " + t("ds_buy_piece", { c: Core.buyCost(p) }), function () { sess.send({ a: "buy" }); panelSig = ""; }, "ds-btn", { disabled: p.cash < Core.buyCost(p) ? true : null }));
    kids.push(el("div", { class: "ds-actions" }, act));
    if (ui.mode === "piece") kids.push(el("p", { class: "ds-small ds-hint" }, [t("ds_piece_hint")]));
    return panel(null, kids);
  }
  function buildPanel(s, p) {
    var kids = [el("h3", null, [t("ds_build")])];
    kids.push(el("div", { class: "ds-towers" }, D.BUILD_ORDER.map(function (k, i) {
      var d = D.TOWERS[k], on = ui.mode === "build" && ui.bt === k;
      return el("button", { type: "button", class: "ds-tw" + (on ? " ds-on" : "") + (d.cat === "elec" ? " ds-elec" : ""), disabled: p.cash < d.cost ? true : null, title: L(d.desc), onclick: function () {
        if (on) { setMode(null); ui.bt = null; } else { setMode("build"); ui.bt = k; ui.sel = 0; }
        panelSig = "";
      } }, [el("span", { class: "ds-tw-ic" }, [d.icon]), el("span", { class: "ds-tw-n" }, [L(d.name)]), el("span", { class: "ds-tw-c" }, ["💠" + d.cost]), el("kbd", null, [String(i + 1)])]);
    })));
    if (ui.mode === "build" && ui.bt) {
      var d = D.TOWERS[ui.bt];
      kids.push(el("div", { class: "ds-desc" }, [el("b", null, [d.icon + " " + L(d.name)]), el("p", { class: "ds-small" }, [L(d.desc)]), el("p", { class: "ds-small ds-mono" }, [statLine(d, 0)]), el("p", { class: "ds-small ds-hint" }, [t("ds_build_hint")])]));
    } else kids.push(el("p", { class: "ds-small ds-muted" }, [t("ds_build_note")]));
    return panel(null, kids);
  }
  function towerPanel(s, p, tw) {
    var d = D.TOWERS[tw.ty], st = Core.stats(s, tw), mine = tw.o === sess.pid, kids = [];
    var mod = s.fm[Core.idx(tw.x, tw.y)];
    kids.push(el("div", { class: "ds-tw-head" }, [el("b", null, [d.icon + " " + L(d.name)]), el("span", { class: "ds-chip" }, [(d.cat === "evo" ? "E" : "Lv") + (tw.lv + 1)]), btn("✕", function () { ui.sel = 0; panelSig = ""; }, "ds-link")]));
    kids.push(el("p", { class: "ds-small" }, [L(d.desc)]));
    var lines = [];
    if (st.dmg) lines.push((d.kind === "beam" ? t("ds_st_dps") : t("ds_st_dmg")) + " " + fmt(st.dmg) + (st.dm > 1.001 ? " (+" + Math.round((st.dm - 1) * 100) + "%)" : st.dm < 0.999 ? " (" + Math.round((st.dm - 1) * 100) + "%)" : ""));
    if (st.rate && ["beam", "aura", "support", "eco"].indexOf(d.kind) < 0) lines.push(t("ds_st_rate") + " " + fmt(st.rate) + "/s");
    if (st.range) lines.push(t("ds_st_range") + " " + fmt(st.range));
    var extra = statLine(d, tw.lv, true, st);
    kids.push(el("p", { class: "ds-small ds-mono" }, [lines.concat(extra ? [extra] : []).join("・")]));
    if (mod) kids.push(el("p", { class: "ds-small" }, [D.MODS[mod].icon + " " + L(D.MODS[mod].name) + "：" + L(D.MODS[mod].desc)]));
    kids.push(el("p", { class: "ds-small " + (st.net > 0 ? "ds-good" : "ds-muted") }, [st.net > 0 ? "⚡ " + t("ds_net_on", { n: Math.round(st.net * 100) }) : "🔌 " + t("ds_net_off")]));
    Core.combosOf(s, tw).forEach(function (x) { kids.push(el("p", { class: "ds-small ds-combo" }, ["🔗 " + L(x.c.name) + "：" + L(x.c.desc)])); });
    var maybe = D.COMBOS.filter(function (c) { return (c.a.indexOf(tw.ty) >= 0 || c.b.indexOf(tw.ty) >= 0) && !Core.combosOf(s, tw).some(function (x) { return x.c.id === c.id; }); });
    if (maybe.length) kids.push(el("p", { class: "ds-small ds-muted" }, ["💡 " + t("ds_combo_hint", { n: maybe.map(function (c) { var other = c.a.indexOf(tw.ty) >= 0 ? c.b : c.a; return other.map(function (k) { return L(D.TOWERS[k].name); }).join("／") + "→" + L(c.name); }).join("、") })]));
    var plid = Core.placementAt(s, tw.x, tw.y);
    if (plid && s.pl[plid].o === sess.pid) kids.push(el("div", { class: "ds-actions" }, [btn("↺ " + t("ds_pick_btn"), function () { pickupNow(plid); }, "ds-btn", { id: "ds-tw-pick" }), el("span", { class: "ds-small ds-muted" }, [t("ds_pick_note")])]));
    refs.selStats = el("p", { class: "ds-small ds-muted" }, [""]);
    kids.push(refs.selStats);
    if (!mine) { var op = s.players[tw.o]; kids.push(el("p", { class: "ds-small ds-muted" }, [t("ds_owner", { n: op ? op.name || t("ds_noname") : "?" })])); }
    if (["support", "eco", "aura"].indexOf(d.kind) < 0) kids.push(el("div", { class: "ds-field" }, [t("ds_target"), seg([["first", t("ds_t_first")], ["last", t("ds_t_last")], ["strong", t("ds_t_strong")], ["near", t("ds_t_near")]], tw.mode || "first", function (v) { sess.send({ a: "mode", id: tw.id, m: v }); panelSig = ""; })]));
    if (mine) {
      var act = [], uc = Core.upgradeCost(tw, p);
      if (uc) act.push(btn("⬆ " + t("ds_upgrade", { c: uc }), function () { sess.send({ a: "up", id: tw.id }); panelSig = ""; }, "ds-btn ds-primary", { disabled: p.cash < uc ? true : null, id: "ds-up" }));
      act.push(btn("💱 " + t("ds_sell", { c: Core.refundOf(s, tw) }), function () { sess.send({ a: "sell", id: tw.id }); ui.sel = 0; panelSig = ""; }, "ds-btn", { id: "ds-sell" }));
      kids.push(el("div", { class: "ds-actions" }, act));
      if (uc) kids.push(el("p", { class: "ds-small ds-muted ds-mono" }, ["→ " + statLine(d, tw.lv + 1)]));
      if (d.cat === "base" && tw.lv === d.lv.length - 1) {
        kids.push(el("h3", null, ["🔬 " + t("ds_evolve")]));
        kids.push(el("div", { class: "ds-evos" }, d.evo.map(function (k) {
          var e = D.TOWERS[k];
          return el("div", { class: "ds-evo" }, [
            el("b", null, [e.icon + " " + L(e.name)]),
            el("p", { class: "ds-small" }, [L(e.desc)]),
            el("p", { class: "ds-small ds-mono" }, [statLine(e, 0)]),
            btn(t("ds_evolve_btn", { c: Core.evoCost(k, p) }), function () { sess.send({ a: "evo", id: tw.id, to: k }); panelSig = ""; }, "ds-btn ds-primary", { disabled: p.cash < Core.evoCost(k, p) ? true : null, "data-evo": k })
          ]);
        })));
      } else if (d.cat === "base") kids.push(el("p", { class: "ds-small ds-muted" }, [t("ds_evolve_note")]));
    }
    return panel(null, kids, "ds-twp");
  }
  // 格子說明（遊戲中隨時可以展開；展開狀態記在偏好裡）
  function legendPanel(s) {
    var m = D.MAPS[s.map];
    function sw(col, extra) { return el("i", { class: "ds-sw" + (extra ? " " + extra : ""), style: "background:" + col }); }
    var rows = Object.keys(D.MODS).filter(function (k) { return !D.MODS[k].lock || (s.unl && s.unl[D.MODS[k].lock]); }).map(function (k) {
      var md = D.MODS[k];
      return el("li", null, [sw(hex(md.color)), el("b", null, [md.icon + " " + L(md.name)]), "：" + L(md.desc)]);
    });
    var more = [
      [hex(m.glow), t("ds_lg_power")],
      ["#3cffb0", t("ds_lg_ghost")],
      ["#ff3d7f", t("ds_lg_path")],
      ["#ffd04a", t("ds_lg_pick")],
      ["#ff1a3a", t("ds_lg_bad")]
    ].map(function (r) { return el("li", null, [sw(r[0]), r[1]]); });
    var d = el("details", { class: "ds-panel ds-legend", open: pref().legend ? true : null, ontoggle: function (e) { setPref({ legend: e.target.open ? 1 : 0 }); } }, [
      el("summary", null, ["📘 " + t("ds_legend")]),
      el("p", { class: "ds-small ds-muted" }, [t("ds_lg_mods_note")]),
      el("ul", { class: "ds-lg" }, rows),
      el("ul", { class: "ds-lg" }, more)
    ]);
    return d;
  }
  function playersPanel(s) {
    return panel(null, [el("h3", null, [t("ds_players")]), el("ul", { class: "ds-plist" }, s.order.map(function (k) {
      var p = s.players[k];
      return el("li", null, [el("i", { class: "ds-dot", style: "background:" + hex(D.PLAYER_COLORS[p.ci]) }), (p.name || t("ds_noname")) + (k === sess.pid ? t("ds_you") : "") + "・💠" + p.cash + "・☠️" + p.kills + (s.phase === "build" ? (p.ready ? " ✅" : " …") : "")]);
    }))]);
  }

  function recordEnd(s) {
    ui.recorded = true;
    if (sess.solo) lsSet(SAVE_KEY, null);
    var pg = progress(), m = D.MAPS[s.map];
    pg.games = (pg.games || 0) + 1;
    if (s.end.win) pg.wins = (pg.wins || 0) + 1;
    pg.best = pg.best || {}; pg.cleared = pg.cleared || {};
    pg.best[m.id] = Math.max(pg.best[m.id] || 0, s.end.score);
    if (s.end.win && s.mode === "campaign") {
      pg.cleared[m.id] = 1;
      var star = s.hp >= 15 ? 3 : s.hp >= 8 ? 2 : 1;
      pg.stars[m.id] = Math.max(pg.stars[m.id] || 0, star);
      ui.lastStars = star;
    } else ui.lastStars = 0;
    // 成就
    var rec = s.rec || { boss: {}, evo: {}, combo: {} }, before = Object.keys(pg.ach).length, got = [];
    Object.keys(rec.combo || {}).forEach(function (k) { pg.combo[k] = 1; });
    Object.keys(rec.evo || {}).forEach(function (k) { pg.evo[k] = 1; });
    function gain(id, cond) { if (cond && !pg.ach[id]) { pg.ach[id] = 1; got.push(id); } }
    gain("first_win", s.end.win);
    ["kernel", "daemon", "singularity"].forEach(function (b) { gain("boss_" + b, rec.boss && rec.boss[b]); });
    gain("combo", Object.keys(pg.combo).length > 0);
    gain("combo_all", Object.keys(pg.combo).length >= D.COMBOS.length);
    gain("evo_all", Object.keys(pg.evo).length >= 8);
    gain("net20", (rec.net || 0) >= 20);
    gain("skills", (rec.skills || 0) >= 10);
    gain("perfect", s.end.win && s.leaks === 0);
    gain("endless40", !s.waves && s.end.wave >= 40);
    gain("campaign", Object.keys(pg.cleared).length >= D.MAPS.length);
    gain("stars30", totalStars(pg) >= 30);
    gain("daily", s.mode === "daily");
    gain("coop", s.end.win && s.order.length > 1);
    ui.newAch = got;
    void before;
    if (s.mode === "daily" && sess.solo) {
      pg.daily = pg.daily || {};
      pg.daily[s.daily] = Math.max(pg.daily[s.daily] || 0, s.end.score);
      var me0 = s.players.me;
      try { Net.dailySubmit(s.daily, { name: lsGet(NAME_KEY) || "", score: s.end.score, wave: s.end.wave, hp: s.hp, role: me0 ? me0.role : "" }); } catch (e) { /* 離線就只記在本機 */ }
    }
    lsSet(PROG_KEY, JSON.stringify(pg));
  }
  function showEnd(s) {
    var box = refs.endBox;
    box.hidden = false;
    box.innerHTML = "";
    var next = s.mode === "campaign" && s.end.win && s.map < D.MAPS.length - 1 ? s.map + 1 : -1;
    box.appendChild(el("div", { class: "ds-endcard " + (s.end.win ? "ds-win" : "ds-lose") }, [
      el("h2", null, [s.end.win ? "🏆 " + t("ds_win") : "💥 " + t("ds_lose")]),
      el("p", null, [t("ds_end_stats", { w: s.end.wave, k: s.kills, hp: s.hp, sc: s.end.score })]),
      ui.lastStars ? el("p", { class: "ds-stars" }, ["⭐".repeat(ui.lastStars) + "☆".repeat(3 - ui.lastStars)]) : null,
      ui.newAch && ui.newAch.length ? el("div", { class: "ds-newach" }, [el("b", null, [t("ds_new_ach")])].concat(ui.newAch.map(function (id) { var a = D.ACHIEVEMENTS.filter(function (x) { return x.id === id; })[0]; return el("div", null, [a.icon + " " + L(a.name)]); }))) : null,
      s.mode === "daily" ? el("p", { class: "ds-small" }, [t("ds_daily_sent")]) : null,
      s.order.length > 1 ? el("ul", { class: "ds-plist" }, s.order.map(function (k) { var p = s.players[k]; return el("li", null, [(p.name || t("ds_noname")) + "：" + t("ds_end_player", { d: Math.round(p.dmg), k: p.kills })]); })) : null,
      el("div", { class: "ds-actions" }, [
        sess.solo && next >= 0 ? btn(t("ds_next_map", { n: L(D.MAPS[next].name) }), function () { startSolo(Core.newGame({ seed: campaignSeed(next), mode: "campaign", map: next, waves: 20, diff: s.diff, players: soloPlayers(), unl: myUnl() })); }, "ds-btn ds-primary") : null,
        sess.solo && s.mode === "daily" ? btn(t("ds_board"), function () { go("daily"); }, "ds-btn ds-primary") : null,
        sess.solo ? btn(t("ds_again"), function () { if (s.mode === "daily") { startDaily(); return; } startSolo(Core.newGame({ seed: s.mode === "campaign" ? s.seed : Core.newSeed(), mode: s.mode, map: s.mode === "campaign" ? s.map : ui.setup.map, waves: s.waves, diff: s.diff, players: soloPlayers(), unl: myUnl() })); }, "ds-btn") : null,
        ui.room ? btn(t("ds_back_lobby"), function () { if (ui.room.isHost()) ui.room.backToLobby(); go("lobby"); }, "ds-btn ds-primary") : btn(t("ds_back_home"), function () { go("home"); }, "ds-btn")
      ])
    ]));
  }

  // ---------------- 鍵盤 ----------------
  document.addEventListener("keydown", function (e) {
    if (ui.screen !== "game" || !sess || !sess.s) return;
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    var p = me();
    if (!p) return;
    if (e.key === "r" || e.key === "R") { if (ui.mode === "piece") { ui.rot = (ui.rot + 1) % 4; panelSig = ""; } }
    else if (e.key === "Enter") { if (ui.pending) { e.preventDefault(); confirmPending(); } }
    else if (e.key === "Escape" && ui.pending) { ui.pending = null; }
    else if (e.key === "Escape") { setMode(null); ui.bt = null; ui.sel = 0; panelSig = ""; }
    else if (e.key === " ") { e.preventDefault(); if (sess.s.phase === "build") sess.send({ a: "ready", v: sess.solo ? true : !p.ready }); }
    else if (e.key === "q" || e.key === "Q") { if (view3) view3.rotate(-Math.PI / 8); }
    else if (e.key === "e" || e.key === "E") { if (view3) view3.rotate(Math.PI / 8); }
    else if (e.key === "f" || e.key === "F") { if (p.pieces.length) { setMode("piece"); ui.pi = (ui.mode === "piece" ? (ui.pi + 1) : 0) % p.pieces.length; ui.sel = 0; panelSig = ""; } }
    else if (/^[1-9]$/.test(e.key)) { var k = D.BUILD_ORDER[+e.key - 1]; if (k) { setMode("build"); ui.bt = k; ui.sel = 0; panelSig = ""; } }
    else if (/^[zxcZXC]$/.test(e.key)) { var sk = { z: "emp", x: "oc", c: "fix" }[e.key.toLowerCase()]; useSkill(sk); }
    else if (e.key === "u" || e.key === "U") { if (ui.sel) sess.send({ a: "up", id: ui.sel }); panelSig = ""; }
  });

  // ---------------- 合作連線 ----------------
  function roomUrl(id) { return window.location.href.split(/[?#]/)[0] + "?room=" + id; }
  function enterRoom(roomId) {
    if (!Net) return;
    if (ui.room) leaveRoom();
    var room = Net.open({
      roomId: roomId, name: lsGet(NAME_KEY), role: ui.role, cfg: { mode: "random", map: -1, waves: 30, diff: "normal" },
      onChange: function () { onRoomChange(); },
      onIntent: function (pid, it) {
        if (!room.isHost() || !sess || !sess.s) return;
        if (Core.applyIntent(sess.s, pid, it)) { dirty = true; pushState(true); }
      },
      onState: function (w) {
        if (!sess || sess.room !== room) return;
        var s = Core.restore(w.s);
        if (!s) return;
        if (!room.isHost() || !sess.s) sess.s = s;
      }
    });
    ui.room = room;
    sess = netSession(room);
    try { window.history.replaceState(null, "", roomUrl(room.id)); } catch (e) { /* 改不了網址也沒關係 */ }
    go("lobby");
  }
  var joinSent = 0;
  function onRoomChange() {
    var room = ui.room;
    if (!room) return;
    if (!sess.s && room.wrap && room.wrap.s) sess.s = Core.restore(room.wrap.s);
    var st = room.status();
    if (st === "game" && ui.screen === "lobby" && sess.s && !sess.s.end && ui.autoJoin) { ui.autoJoin = false; resetGameUi(); go("game"); return; }
    if (st === "lobby" && ui.screen === "game") { go("lobby"); return; }
    // 自己還不在這一局裡：請房主把我加進去
    if (ui.screen === "game" && sess.s && !sess.s.players[sess.pid] && Date.now() - joinSent > 3000) { joinSent = Date.now(); sess.send({ a: "join", name: lsGet(NAME_KEY) || room.me.name || "", role: ui.role }); }
    if (ui.screen === "lobby") render();
    else if (ui.screen === "game" && !view3) render();
  }
  function leaveRoom() {
    if (ui.room) { ui.room.close(); ui.room = null; }
    sess = null;
    try { if (window.location.search.indexOf("room=") >= 0) window.history.replaceState(null, "", window.location.href.split(/[?#]/)[0]); } catch (e) { /* 同上 */ }
  }
  function renderLobby() {
    var room = ui.room;
    if (!room) { go("home"); return; }
    if (room.missing) { app.appendChild(panel(t("ds_menu_coop"), [el("p", null, [t("ds_room_missing")]), btn(t("ds_back_home"), function () { leaveRoom(); go("home"); })])); return; }
    if (!room.loaded) { app.appendChild(panel(t("ds_menu_coop"), [el("p", { class: "ds-muted" }, [t("ds_connecting")])])); return; }
    var host = room.isHost(), url = roomUrl(room.id);
    var qr = el("canvas", { class: "ds-qr" });
    try { window.PriTestQRCode.renderToCanvas(qr, url, { level: "L", scale: 4, margin: 2 }); } catch (e) { qr = null; }
    app.appendChild(panel(t("ds_menu_coop"), [
      el("div", { class: "ds-lobby" }, [
        qr,
        el("div", null, [
          el("p", null, [t("ds_room_share")]),
          el("input", { class: "ds-input ds-url", readonly: true, value: url, onclick: function (e) { e.target.select(); } }),
          el("div", { class: "ds-actions" }, [btn(t("ds_copy"), function () { try { navigator.clipboard.writeText(url); } catch (e) { /* 不支援就手動複製 */ } }, "ds-btn")])
        ])
      ]),
      el("label", { class: "ds-field" }, [t("ds_name") + " ", el("input", { class: "ds-input", maxlength: "16", value: lsGet(NAME_KEY), onchange: function (e) { var v = e.target.value.trim(); lsSet(NAME_KEY, v); room.update({ name: v }); if (sess.s && sess.s.players[sess.pid]) sess.send({ a: "name", name: v }); } })])
    ]));
    var list = room.list(), s = sess.s;
    app.appendChild(panel(t("ds_players"), [
      el("ul", { class: "ds-plist" }, list.map(function (p) { var r = D.ROLES[p.role] || D.ROLES.general; return el("li", null, [(p.cid === room.meta.host ? "👑 " : "") + (p.name || t("ds_noname")) + (p.cid === room.cid ? t("ds_you") : "") + "・" + r.icon + L(r.name)]); })),
      rolePicker(room.me.role || ui.role, function (v) { ui.role = v; setPref({ role: v }); room.update({ role: v }); if (sess.s && sess.s.players[sess.pid] && sess.s.wave === 0) sess.send({ a: "role", r: v }); render(); }),
      list.length > 4 ? el("p", { class: "ds-warn ds-small" }, [t("ds_room_full")]) : null
    ]));
    var cfg = room.cfg || {};
    app.appendChild(panel(t("ds_room_cfg"), [
      host ? el("div", null, setupFields(cfg, function () { room.setCfg(cfg); render(); }, true)) : el("p", { class: "ds-small" }, [t("ds_cfg_view", { m: cfg.map >= 0 ? L(D.MAPS[cfg.map].name) : t("ds_map_random"), w: cfg.mode === "campaign" ? 20 : cfg.waves ? cfg.waves : "∞", d: L((D.DIFFS[cfg.diff] || D.DIFFS.normal).name) })]),
      el("p", { class: "ds-small ds-muted" }, [t("ds_coop_note")]),
      host ? el("div", { class: "ds-actions ds-next" }, [
        s && !s.end ? btn(t("ds_resume_coop"), function () { room.startGame(Core.serialize(s)); resetGameUi(); go("game"); }, "ds-big ds-primary") : null,
        btn(t("ds_start_coop"), function () {
          var ps = list.slice(0, 4).map(function (p) { return { pid: p.pid, name: p.name, role: p.role }; });
          var camp = cfg.mode === "campaign";
          var ns = Core.newGame({ seed: camp ? campaignSeed(cfg.map) : Core.newSeed(), mode: camp ? "campaign" : "random", map: cfg.map, waves: camp ? 20 : cfg.waves, diff: cfg.diff, players: ps, unl: myUnl() });
          sess.s = ns;
          room.startGame(Core.serialize(ns));
          resetGameUi();
          go("game");
        }, "ds-big" + (s && !s.end ? "" : " ds-primary"))
      ]) : el("div", null, [
        el("p", { class: "ds-muted" }, [room.status() === "game" ? t("ds_game_running") : t("ds_wait_host")]),
        room.status() === "game" && s ? btn(t("ds_join_game"), function () { resetGameUi(); go("game"); }, "ds-big ds-primary") : null
      ])
    ]));
    ui.autoJoin = !host;
  }

  window.addEventListener("i18n:change", function () {
    panelSig = "";
    if (ui.screen !== "game") { render(); return; }
    var s = sess && sess.s;
    if (s && refs.mech) refs.mech.textContent = mechText(s);
    if (refs.skills) Array.prototype.forEach.call(refs.skills.children, function (b) { var sk = D.SKILLS[b.getAttribute("data-skill")]; b.children[1].textContent = L(sk.name); });
    if (s && s.end && refs.endBox) showEnd(s);
    updatePanel();
  });

  // 測試用（Playwright）
  window.PriTestDenshi = { ui: ui, view: function () { return view3; }, state: function () { return sess && sess.s; }, send: function (it) { return sess && sess.send(it); }, step: function (n) { for (var i = 0; i < (n || 1); i++) Core.step(sess.s, STEP); } };

  var rid = Net && Net.roomFromUrl(window.location.href);
  if (rid && Net.validRoomId(rid)) enterRoom(rid);
  else render();
})();
