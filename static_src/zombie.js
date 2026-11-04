// 末日據點（zombie）：畫面。規則在 zombie_core.js、夜晚模擬在 zombie_night.js、3D 在 zombie_3d.js、連線在 zombie_net.js。
//
// 「場次」（sess）把單機與連線包成同一個介面：
//   sess.s＝目前的整局狀態、sess.pid＝自己、sess.send(意圖)、sess.host＝能不能跑夜晚（單機永遠是）。
//   單機：send 直接 Core.applyIntent 後存檔；連線房主：套用後寫進房間；連線其他人：送意圖給房主，等房主廣播。
(function () {
  "use strict";

  var D = window.PriTestZombieData, Core = window.PriTestZombieCore, Night = window.PriTestZombieNight;
  var Z3 = window.PriTestZombie3D, Net = window.PriTestZombieNet;
  var app = document.getElementById("zm-app");
  if (!app) return;
  var SAVE_KEY = "pritest-zombie-save", PREF_KEY = "pritest-zombie-pref", NAME_KEY = "pritest-zombie-name";

  function t(k, p) {
    var q = {};
    Object.keys(p || {}).forEach(function (x) { var v = p[x]; q[x] = v && typeof v === "object" ? D.L(v) : v; });
    return window.I18N.t(k, q);
  }
  var L = D.L;
  function lsGet(k) { try { return window.localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (e) { /* 存不了也能玩 */ } }
  function pref() { try { return JSON.parse(lsGet(PREF_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function setPref(p) { var o = pref(); Object.keys(p).forEach(function (k) { o[k] = p[k]; }); lsSet(PREF_KEY, JSON.stringify(o)); }

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
  // voters：投了這個選項的玩家（多人投票時顯示在按鈕右邊）
  function btn(label, onclick, cls, attrs, voters) {
    var a = { type: "button", class: cls || "zm-btn", onclick: onclick };
    Object.keys(attrs || {}).forEach(function (k) { a[k] = attrs[k]; });
    var kids = [label];
    if (voters && voters.length && sess && sess.s) kids.push(el("span", { class: "zm-voters" }, ["🗳" + voters.length + " " + voters.map(function (pid) { return pname(sess.s, pid); }).join("、")]));
    return el("button", a, kids);
  }
  function panel(title, children, cls) { return el("section", { class: "zm-panel " + (cls || "") }, [title ? el("h2", null, [title]) : null].concat(children)); }
  function bar(v, max, cls) { return el("span", { class: "zm-bar " + (cls || "") }, [el("i", { style: "width:" + Math.round(Core.clamp(v / max, 0, 1) * 100) + "%" })]); }

  var ui = {
    screen: "home", sel: null, msg: "", live: null, view: null, room: null, trait: "", lobbyMsg: "",
    setup: { city: pref().city || "tw", len: pref().len === 30 ? 30 : 10, base: pref().base || "store", rules: pref().rules || [], special: pref().special || "" }
  };
  var sess = null;

  // ---------------- 場次 ----------------
  function soloSession(s) {
    return {
      solo: true, pid: "me", host: true, s: s,
      send: function (it) { if (Core.applyIntent(this.s, "me", it)) { saveSolo(); afterChange(); return true; } return false; },
      commit: function () { saveSolo(); afterChange(); }
    };
  }
  function saveSolo() { if (sess && sess.solo) lsSet(SAVE_KEY, sess.s.end ? null : JSON.stringify(sess.s)); }
  function netSession(room) {
    return {
      solo: false, room: room, pid: room.pid, get host() { return room.isHost(); }, get s() { return room.wrap && room.wrap.s; },
      send: function (it) {
        if (room.isHost()) { var s = this.s; if (s && Core.applyIntent(s, room.pid, it)) { room.writeState(room.wrap); afterChange(); return true; } return false; }
        room.sendIntent(it); return true;
      },
      commit: function () { if (room.isHost()) room.writeState(room.wrap); afterChange(); }
    };
  }
  function afterChange() {
    var s = sess && sess.s;
    if (s && s.end && !ui.recorded) { ui.recorded = Core.recordRun(s); }
    if (!ui.live) rerenderKeep();
  }
  function me(s) { return (s || sess.s).players.filter(function (p) { return p.pid === sess.pid; })[0] || null; }
  function isMine(v) { return v.owner === sess.pid; }

  // ---------------- 共用畫面 ----------------
  function go(screen) { ui.screen = screen; ui.msg = ""; render(); window.scrollTo(0, 0); }
  function rerenderKeep() { var y = window.scrollY; render(); window.scrollTo(0, y); }
  function render() {
    if (ui.live) return;    // 即時防守中：3D 畫面自己更新，不整頁重畫
    app.innerHTML = "";
    app.appendChild(header());
    var f = SCREENS[ui.screen] || screenHome;
    f();
  }
  function header() {
    return el("div", { class: "zm-top" }, [
      el("h1", { class: "zm-title" }, ["🧟 " + t("zm_title")]),
      ui.room ? el("span", { class: "zm-roomtag" }, ["👥 " + t("zm_room_tag", { n: ui.room.list().length })]) : null,
      ui.screen !== "home" ? btn(t("zm_home"), function () { if (ui.room && ui.screen === "game") go("lobby"); else go("home"); }, "zm-link") : null
    ]);
  }
  function lineText(l) {
    if (!l) return "";
    if (l.c) return L(l.c);
    if (l.card) { var e = D.EVENT_BY_ID[l.card]; return e ? "▶ " + L(e.ch[l.c].t) + votesText(e, l.votes) : ""; }
    if (l.votes && l.ev) { var e2 = D.EVENT_BY_ID[l.ev]; return e2 ? votesText(e2, l.votes).replace(/^（|）$/g, "") : ""; }
    if (l.k === "zm_l_bitten" && sess && l.p.pid !== sess.pid) {
      // 被咬：如果還藏著，其他玩家只看到「被抓了一下」
      var nk = JSON.stringify(l.p.n), v = (sess.s.surv || []).filter(function (x) { return JSON.stringify(x.name) === nk && x.owner === l.p.pid; })[0];
      if (v && v.inf && v.inf.hid) return t("zm_l_bitten_masked", l.p);
    }
    return t(l.k, l.p);
  }
  // 投票紀錄：（房主：選項、客人：選項）
  function votesText(e, votes) {
    if (!votes || !sess || !sess.s || sess.s.players.length < 2) return "";
    var ks = Object.keys(votes);
    if (!ks.length) return "";
    return "（🗳 " + ks.map(function (pid) { var o = e.ch[votes[pid]]; return pname(sess.s, pid) + "：" + (o ? L(o.t) : "?"); }).join("、") + "）";
  }
  function logBox(lines, cls) {
    return el("ul", { class: "zm-log " + (cls || "") }, (lines || []).map(function (l) { var s2 = lineText(l); return s2 ? el("li", null, [s2]) : null; }));
  }

  // ---------------- 首頁 ----------------
  function screenHome() {
    var m = Core.loadMeta(), save = lsGet(SAVE_KEY), dk = Core.dailyKey();
    app.appendChild(panel(null, [
      el("p", { class: "zm-intro" }, [t("zm_intro")]),
      el("div", { class: "zm-menu" }, [
        save ? btn("▶ " + t("zm_continue"), function () { try { startSolo(JSON.parse(save)); } catch (e) { lsSet(SAVE_KEY, null); render(); } }, "zm-big zm-primary") : null,
        btn("🧍 " + t("zm_menu_solo"), function () { go("setup"); }, "zm-big" + (save ? "" : " zm-primary")),
        Net ? btn("👥 " + t("zm_menu_coop"), function () { enterRoom(null); }, "zm-big") : null,
        btn("📅 " + t("zm_menu_daily"), function () { startDaily(); }, "zm-big"),
        btn("🏆 " + t("zm_menu_legacy"), function () { go("legacy"); }, "zm-big"),
        btn("📖 " + t("zm_menu_help"), function () { go("help"); }, "zm-big")
      ]),
      el("p", { class: "zm-small zm-muted" }, [t("zm_home_meta", { p: m.pts, r: m.runs, w: m.wins, b: m.best[dk] || 0 })])
    ]));
  }
  function screenHelp() {
    app.appendChild(panel(t("zm_menu_help"), [el("ul", { class: "zm-rules" }, ["zm_help_1", "zm_help_2", "zm_help_3", "zm_help_4", "zm_help_5", "zm_help_6", "zm_help_7", "zm_help_8"].map(function (k) { return el("li", null, [t(k)]); }))]));
    app.appendChild(panel(t("zm_zombies"), [el("ul", { class: "zm-rules" }, Object.keys(D.ZOMBIES).map(function (k) { var Z = D.ZOMBIES[k]; return el("li", null, [Z.icon + " " + L(Z.name) + "：" + t("zm_zdesc_" + k)]); }))]));
  }

  // ---------------- 設定（單機／房主） ----------------
  function seg(items, cur, onPick, disabled) {
    return el("div", { class: "zm-seg" }, items.map(function (x) {
      return btn(x[1], function () { onPick(x[0]); }, "zm-seg-btn" + (x[0] === cur ? " zm-on" : ""), { disabled: disabled || x[2] });
    }));
  }
  function setupForm(cfg, onChange, disabled, meta) {
    meta = meta || Core.loadMeta();
    return el("div", null, [
      el("h3", null, [t("zm_city")]),
      seg(Object.keys(D.CITIES).map(function (k) { return [k, D.CITIES[k].icon + " " + L(D.CITIES[k].name)]; }), cfg.city, function (v) { cfg.city = v; onChange(); }, disabled),
      el("h3", null, [t("zm_length")]),
      seg([[10, t("zm_len_10")], [30, t("zm_len_30")]], cfg.len, function (v) { cfg.len = v; onChange(); }, disabled),
      el("h3", null, [t("zm_base")]),
      seg(Object.keys(D.BASES).map(function (k) { var B = D.BASES[k], ok = Core.isUnlocked(meta, k); return [k, B.icon + " " + L(B.name) + (ok ? "" : " 🔒"), !ok]; }), cfg.base, function (v) { cfg.base = v; onChange(); }, disabled),
      el("p", { class: "zm-small zm-muted" }, [L(D.BASES[cfg.base].desc)]),
      el("h3", null, [t("zm_rules")]),
      el("div", { class: "zm-rulegrid" }, D.RULE_IDS.map(function (k) {
        var R = D.RULES[k], ok = Core.isUnlocked(meta, k), on = cfg.rules.indexOf(k) >= 0;
        return el("label", { class: "zm-rule" + (on ? " zm-on" : "") + (ok ? "" : " zm-locked") }, [
          el("input", { type: "checkbox", checked: on, disabled: disabled || !ok, onchange: function (e) { cfg.rules = cfg.rules.filter(function (x) { return x !== k; }); if (e.target.checked) cfg.rules.push(k); onChange(); } }),
          el("b", null, [" " + L(R.name) + (ok ? "" : " 🔒") + " ×" + R.mult]), el("small", null, [L(R.desc)])
        ]);
      })),
      el("p", { class: "zm-small" }, [t("zm_rule_mult", { m: ruleMult(cfg.rules) })])
    ]);
  }
  function ruleMult(rules) { var m = 1; rules.forEach(function (r) { m *= D.RULES[r].mult; }); return Math.round(m * 100) / 100; }
  function specialPicker(cur, onPick, meta) {
    meta = meta || Core.loadMeta();
    var items = [["", t("zm_special_none")]].concat(Object.keys(D.SPECIALS).map(function (k) { var ok = Core.isUnlocked(meta, k); return [k, L(D.SPECIALS[k].name) + (ok ? "" : " 🔒"), !ok]; }));
    return seg(items, cur, onPick);
  }
  function screenSetup() {
    var cfg = ui.setup;
    function changed() { setPref({ city: cfg.city, len: cfg.len, base: cfg.base, rules: cfg.rules, special: cfg.special }); rerenderKeep(); }
    app.appendChild(panel(t("zm_menu_solo"), [
      setupForm(cfg, changed),
      el("h3", null, [t("zm_special")]),
      specialPicker(cfg.special, function (v) { cfg.special = v; changed(); }),
      el("p", { class: "zm-small zm-muted" }, [t("zm_special_note")]),
      el("div", { class: "zm-actions" }, [btn(t("zm_start"), function () {
        var s = Core.newGame({ seed: Core.newSeed(), city: cfg.city, len: cfg.len, rules: cfg.rules, base: cfg.base, players: [{ pid: "me", name: "", special: cfg.special }] });
        startSolo(s);
      }, "zm-btn zm-primary zm-big")])
    ]));
  }
  function startSolo(s) {
    leaveRoom(true);
    sess = soloSession(s);
    ui.recorded = null; ui.sel = null;
    saveSolo();
    go("game");
  }
  function startDaily() {
    var key = Core.dailyKey(), o = Core.dailyOpts(key);
    o.players = [{ pid: "me", name: "" }];
    startSolo(Core.newGame(o));
  }

  // ---------------- 傳承 ----------------
  function screenLegacy() {
    var m = Core.loadMeta();
    function row(id, name, desc, cost) {
      var ok = Core.isUnlocked(m, id);
      return el("div", { class: "zm-unlock" + (ok ? " zm-on" : "") }, [
        el("b", null, [name]), el("small", null, [desc]),
        ok ? el("span", { class: "zm-good" }, ["✔ " + t("zm_unlocked")]) : btn(t("zm_unlock_btn", { n: cost }), function () { if (Core.unlock(m, id)) rerenderKeep(); }, "zm-btn", { disabled: m.pts < cost })
      ]);
    }
    var dk = Core.dailyKey();
    app.appendChild(panel(t("zm_menu_legacy"), [
      el("p", null, [t("zm_legacy_pts", { n: m.pts })]),
      el("p", { class: "zm-small zm-muted" }, [t("zm_legacy_note")]),
      el("h3", null, [t("zm_special")]),
      el("div", { class: "zm-unlocks" }, Object.keys(D.SPECIALS).map(function (k) {
        var S = D.SPECIALS[k];
        return row(k, L(S.name), D.STATS.map(function (x) { return L(D.STAT_INFO[x]) + S.stats[x]; }).join(" ") + "・" + S.traits.map(function (x) { return L(D.TRAITS[x].name); }).join("、"), S.cost);
      })),
      el("h3", null, [t("zm_base")]),
      el("div", { class: "zm-unlocks" }, Object.keys(D.BASES).filter(function (k) { return D.BASES[k].cost; }).map(function (k) { var B = D.BASES[k]; return row(k, B.icon + " " + L(B.name), L(B.desc), B.cost); })),
      el("h3", null, [t("zm_rules")]),
      el("div", { class: "zm-unlocks" }, D.RULE_IDS.filter(function (k) { return D.RULES[k].cost; }).map(function (k) { var R = D.RULES[k]; return row(k, L(R.name) + " ×" + R.mult, L(R.desc), R.cost); })),
      el("h3", null, [t("zm_endings")]),
      el("ul", { class: "zm-rules" }, ["rescue", "radio", "cure", "fall", "disband"].map(function (k) { return el("li", null, [(m.endings[k] ? "✔ " : "？ ") + t("zm_end_" + k + "_title") + (m.endings[k] ? "（" + m.endings[k] + "）" : "")]); })),
      el("p", null, [t("zm_daily_best", { d: dk, b: m.best[dk] || 0 })])
    ]));
  }

  // ---------------- 遊戲畫面 ----------------
  function topBar(s) {
    var W = D.WEATHERS[s.weather];
    var items = D.RES.map(function (k) { return el("span", { class: "zm-res", title: L(D.RES_INFO[k].name) }, [D.RES_INFO[k].icon + " " + s.res[k]]); });
    Object.keys(D.ITEMS).forEach(function (k) { if (s.items[k]) items.push(el("span", { class: "zm-res zm-item", title: L(D.ITEMS[k].name) }, [D.ITEMS[k].icon + " " + s.items[k]])); });
    return el("div", { class: "zm-hud" }, [
      el("div", { class: "zm-hud-row" }, [
        el("b", { class: "zm-day" }, [t("zm_day_of", { d: s.day, n: s.len })]),
        el("span", { class: "zm-chip" }, [t("zm_phase_" + s.phase)]),
        el("span", { class: "zm-chip", title: L(W.desc) }, [W.icon + " " + L(W.name)]),
        el("span", { class: "zm-chip" }, [D.CITIES[s.city].icon + " " + L(D.CITIES[s.city].name)]),
        s.daily ? el("span", { class: "zm-chip zm-daily" }, ["📅 " + s.daily]) : null,
        s.rules.length ? el("span", { class: "zm-chip", title: s.rules.map(function (r) { return L(D.RULES[r].name); }).join("、") }, ["☠ ×" + Core.ruleMult(s)]) : null,
        s.dog ? el("span", { class: "zm-chip" }, ["🐕 " + L(s.dog.name)]) : null,
        s.evacIn ? el("span", { class: "zm-chip zm-good" }, ["🚁 " + t("zm_evac_in", { n: s.evacIn })]) : null
      ]),
      el("div", { class: "zm-hud-row" }, items.concat([
        el("span", { class: "zm-res", title: t("zm_morale") }, ["🙂 " + t("zm_morale") + " ", bar(s.morale, 100, "zm-bar-mor"), " " + s.morale]),
        el("span", { class: "zm-res", title: t("zm_heat_note") }, ["🔊 " + t("zm_heat") + " " + Core.heatOf(s)]),
        s.bld.lab || s.research ? el("span", { class: "zm-res" }, ["🧪 " + s.research + "/" + Core.cureNeed(s)]) : null,
        el("span", { class: "zm-res" }, ["🏠 " + s.core + "/" + Core.CORE_HP])
      ]))
    ]);
  }
  function screenGame() {
    var s = sess && sess.s;
    if (!s) { app.appendChild(panel(null, [el("p", { class: "zm-muted" }, [t("zm_waiting_state")])])); return; }
    app.appendChild(topBar(s));
    if (s.phase === "end") return screenEnd(s);
    if (!me(s)) app.appendChild(el("p", { class: "zm-hint" }, [t("zm_spectator")]));
    offlineBar(s);
    if (s.phase === "plan") return screenPlan(s);
    if (s.phase === "explore") return screenExplore(s);
    if (s.phase === "night") return screenNightPrep(s);
    if (s.phase === "dawn") return screenDawn(s);
  }

  // 連線時有人離線：房主可以不等他繼續（規劃、外出投票、清晨都適用）
  function offlinePids(s) {
    if (!ui.room) return [];
    var on = {};
    ui.room.list().forEach(function (p) { on[p.pid] = 1; });
    return s.players.filter(function (p) { return !on[p.pid]; }).map(function (p) { return p.pid; });
  }
  function offlineBar(s) {
    var off = offlinePids(s);
    if (!off.length || ["plan", "explore", "dawn"].indexOf(s.phase) < 0) return;
    app.appendChild(el("div", { class: "zm-hint zm-actions" }, [
      el("span", null, ["📴 " + t("zm_offline", { n: off.map(function (pid) { return pname(s, pid); }).join("、") })]),
      sess.host ? btn(t("zm_skip_offline"), function () { sess.send({ a: "skip", who: off }); }, "zm-btn", { id: "zm-skip-offline" }) : el("span", { class: "zm-small zm-muted" }, [t("zm_skip_offline_host")])
    ]));
  }

  // ---- 規劃 ----
  function survRow(s, v) {
    var mine = isMine(v) && me(s), w = Core.weaponOf(s, v), showInf = v.inf && (isMine(v) || !v.inf.hid);
    var owner = s.players.length > 1 ? (s.players.filter(function (p) { return p.pid === v.owner; })[0] || {}).name || "?" : "";
    var jobs = el("div", { class: "zm-seg zm-jobs" }, D.DAY_JOBS.map(function (j) {
      var dis = !mine || (j === "scavenge" && !Core.canScavenge(v)) || (s.plans[sess.pid] && s.plans[sess.pid].ready);
      return btn(t("zm_job_" + j), function () { sess.send({ a: "assign", sid: v.id, job: j }); }, "zm-seg-btn" + (v.assign === j ? " zm-on" : ""), { disabled: dis, title: t("zm_job_note_" + j) });
    }));
    var free = s.weapons.filter(function (x) { return !s.surv.some(function (o) { return o.alive && o.weapon === x.uid && o !== v; }); });
    var wsel = mine ? el("select", { class: "zm-input zm-wsel", onchange: function (e) { sess.send({ a: "equip", sid: v.id, w: e.target.value }); } },
      [el("option", { value: "" }, [t("zm_no_weapon")])].concat(free.map(function (x) { var W = D.WEAPONS[x.type]; return el("option", { value: x.uid, selected: v.weapon === x.uid }, [W.icon + " " + L(W.name) + "（" + t("zm_dur") + x.dur + "）"]); })))
      : el("span", { class: "zm-small" }, [w ? D.WEAPONS[w.type].icon + " " + L(D.WEAPONS[w.type].name) : ""]);
    var treat = null;
    if (mine && v.inf) {
      treat = el("div", { class: "zm-treat" }, [
        el("b", null, ["🦠 " + t(v.inf.hid ? "zm_inf_hidden" : "zm_inf_known", { d: v.inf.d })]),
        btn("💉 " + t("zm_treat_serum"), function () { sess.send({ a: "treat", sid: v.id, how: "serum" }); }, "zm-btn", { disabled: !s.items.serum }),
        btn("🪚 " + t("zm_treat_amp"), function () { if (window.confirm(t("zm_treat_amp_confirm", { n: v.name }))) sess.send({ a: "treat", sid: v.id, how: "amputate" }); }, "zm-btn"),
        btn("🚪 " + t("zm_treat_exile"), function () { if (window.confirm(t("zm_treat_exile_confirm", { n: v.name }))) sess.send({ a: "treat", sid: v.id, how: "exile" }); }, "zm-btn"),
        v.inf.hid ? btn("📢 " + t("zm_treat_reveal"), function () { sess.send({ a: "treat", sid: v.id, how: "reveal" }); }, "zm-btn") : null,
        el("p", { class: "zm-small zm-muted" }, [t(v.inf.hid ? "zm_inf_hidden_note" : "zm_inf_known_note")])
      ]);
    }
    return el("div", { class: "zm-surv" + (mine ? " zm-mine" : "") + (v.hp <= 3 ? " zm-hurt" : "") }, [
      el("div", { class: "zm-surv-head" }, [
        el("b", null, [L(v.name)]),
        v.job >= 0 ? el("small", { class: "zm-muted" }, [" " + L(D.JOBS[v.job])]) : el("small", { class: "zm-good" }, [" ★"]),
        owner ? el("small", { class: "zm-owner" }, [" 👤" + owner]) : null,
        showInf ? el("span", { class: "zm-inf" }, ["🦠" + v.inf.d + (v.inf.hid ? "🤫" : "")]) : null,
        v.amp ? el("span", { class: "zm-chip" }, ["🦾 " + t("zm_amp")]) : null
      ]),
      el("div", { class: "zm-surv-stats" }, [
        el("span", null, ["❤ ", bar(v.hp, Core.MAX_HP, "zm-bar-hp"), " " + v.hp]),
        el("span", null, ["⚡ ", bar(v.sta, Core.MAX_STA, "zm-bar-sta"), " " + v.sta])
      ].concat(D.STATS.map(function (k) { return el("span", { class: "zm-stat" }, [L(D.STAT_INFO[k]) + " " + Core.stat(v, k)]); }))),
      el("div", { class: "zm-traits" }, v.traits.map(function (tr) {
        var T = D.TRAITS[tr], key = v.id + ":" + tr;
        return btn(T.icon + " " + L(T.name), function () { ui.trait = ui.trait === key ? "" : key; rerenderKeep(); }, "zm-trait" + (ui.trait === key ? " zm-on" : ""), { title: L(T.desc) });
      }).concat([wsel])),
      v.traits.filter(function (tr) { return ui.trait === v.id + ":" + tr; }).map(function (tr) { return el("p", { class: "zm-small zm-traitdesc" }, [L(D.TRAITS[tr].desc)]); })[0] || null,
      jobs, treat
    ]);
  }
  function cityMap(s, sel, onPick, disabled) {
    var ns = "http://www.w3.org/2000/svg";
    function S(tag, a, kids) { var e = document.createElementNS(ns, tag); Object.keys(a || {}).forEach(function (k) { e.setAttribute(k, a[k]); }); (kids || []).forEach(function (c) { e.appendChild(c); }); return e; }
    var svg = S("svg", { viewBox: "-118 -112 236 236", class: "zm-map" });
    [1, 2, 3, 4].forEach(function (rg) { svg.appendChild(S("circle", { cx: 0, cy: 0, r: rg * 23, class: "zm-map-ring" })); });
    var baseG = S("g", { class: "zm-map-base" }, [S("rect", { x: -7, y: -7, width: 14, height: 14, rx: 2 })]);
    svg.appendChild(baseG);
    D.ARCH_IDS.forEach(function (a) {
      var A = D.ARCH[a], d = s.districts[a], ang = d.ang * Math.PI / 180, x = Math.cos(ang) * A.ring * 23, y = Math.sin(ang) * A.ring * 23;
      var g = S("g", { class: "zm-map-node zm-danger-" + A.danger + (sel === a ? " zm-on" : "") + (disabled ? "" : " zm-click"), transform: "translate(" + x.toFixed(1) + "," + y.toFixed(1) + ")", "data-d": a });
      g.appendChild(S("circle", { r: 8.5, opacity: Math.max(0.35, 1 - d.dep * 0.15) }));
      var tx = S("text", { y: 3.5, "text-anchor": "middle", class: "zm-map-icon" }); tx.textContent = A.icon; g.appendChild(tx);
      var lb = S("text", { y: 17, "text-anchor": "middle", class: "zm-map-label" }); lb.textContent = L(Core.districtName(s, a)); g.appendChild(lb);
      if (!disabled) g.addEventListener("click", function () { onPick(sel === a ? "" : a); });
      svg.appendChild(g);
    });
    return svg;
  }
  function districtInfo(s, a) {
    if (!a) return el("p", { class: "zm-muted zm-small" }, [t("zm_pick_district")]);
    var A = D.ARCH[a], d = s.districts[a];
    return el("div", { class: "zm-dinfo" }, [
      el("b", null, [A.icon + " " + L(Core.districtName(s, a))]),
      el("span", null, [" " + t("zm_ring", { n: A.ring }) + "・" + t("zm_danger") + " " + "☠".repeat(A.danger) + "・" + t("zm_visits", { n: d.visits })]),
      el("p", { class: "zm-small" }, [t("zm_loot") + "：" + Object.keys(A.loot).sort(function (x, y) { return A.loot[y] - A.loot[x]; }).map(function (k) { return D.RES_INFO[k].icon; }).join(" ") +
        (A.sp ? " ＋ " + Object.keys(A.sp).map(function (k) { return k === "serum" ? "💉" : k === "part" ? "📻" : k === "weapon" ? "⚔" : k === "rp" ? "🧪" : "🙂"; }).join(" ") : "") +
        (A.ring >= 3 ? "・" + t("zm_needs_car") : "") + (d.dep ? "・" + t("zm_depleted", { n: Math.round(Math.min(70, d.dep * 18)) }) : "")])
    ]);
  }
  function buildPanel(s, plan, mineOk) {
    var opts = [["repair", "🔨 " + t("zm_repair_walls")]].concat(D.BUILD_IDS.map(function (b) {
      var B = D.BUILDINGS[b], lv = s.bld[b], max = lv >= B.max, ok = Core.canBuild(s, b);
      return [b, B.icon + " " + L(B.name) + " Lv" + lv + (max ? " MAX" : " → " + (lv + 1)), !ok];
    }));
    var cur = plan.build || "repair", B = D.BUILDINGS[cur];
    var info = cur === "repair" ? t("zm_repair_note", { min: Math.min.apply(null, s.walls), max: Core.WALL_HP[s.bld.wall] })
      : L(B.desc) + "　" + t("zm_build_cost", { m: B.cost[s.bld[cur]], w: B.work[s.bld[cur]], p: s.prog[cur] ? Math.round(s.prog[cur].w * 10) / 10 : 0 }) + (B.needParts ? "・" + t("zm_needs_parts", { n: B.needParts, h: s.items.part }) : "") + (B.need ? "・" + t("zm_needs_bld", { b: D.BUILDINGS[B.need].name }) : "");
    var rcur = plan.craft || "", R = D.RECIPES[rcur];
    return el("div", { class: "zm-cols" }, [
      el("div", null, [
        el("h3", null, ["🔨 " + t("zm_build_project")]),
        seg(opts, cur, function (v) { sess.send({ a: "build", b: v }); }, !mineOk),
        el("p", { class: "zm-small" }, [info]),
        el("p", { class: "zm-small zm-muted" }, [t("zm_walls_now") + "：", el("span", { class: "zm-walls" }, s.walls.map(function (w) { var r = w / Core.WALL_HP[s.bld.wall]; return el("i", { class: r <= 0 ? "zm-w0" : r < 0.4 ? "zm-w1" : r < 0.8 ? "zm-w2" : "zm-w3", title: Math.round(w) }); }))])
      ]),
      el("div", null, [
        el("h3", null, ["🛠 " + t("zm_craft_project")]),
        seg([["", t("zm_none")]].concat(D.RECIPE_IDS.map(function (r) { var X = D.RECIPES[r]; return [r, X.icon + " " + L(X.name), !Core.canCraft(s, r)]; })), rcur, function (v) { sess.send({ a: "craft", r: v }); }, !mineOk),
        R ? el("p", { class: "zm-small" }, [t("zm_craft_cost", { c: Object.keys(R.cost).map(function (k) { return D.RES_INFO[k].icon + R.cost[k]; }).join(" "), w: R.work }) + (R.need ? "・" + t("zm_needs_bld", { b: D.BUILDINGS[R.need].name }) : "")]) : el("p", { class: "zm-small zm-muted" }, [t("zm_craft_none_note")])
      ])
    ]);
  }
  function screenPlan(s) {
    var plan = s.plans[sess.pid] || { district: "", build: "repair", craft: "" }, mineOk = !!me(s) && !plan.ready;
    if (s.log && s.log.length) app.appendChild(panel(null, [logBox(s.log)], "zm-newsbox"));
    if (s.gate) {
      var e = D.EVENT_BY_ID[s.gate.id];
      var gv = Core.votesOf(s, Core.voteKeyGate(s));
      app.appendChild(panel("🚪 " + t("zm_gate_title"), [
        el("p", { class: "zm-card-text" }, [L(e.text)]),
        voteChoices(s, e, gv, function (o) { return Core.reqOk(s, null, o.req); }, function (i) { sess.send({ a: "gate", c: i }); }),
        voteFooter(s, gv, true, function () { sess.send({ a: "force", k: "gate" }); })
      ], "zm-card"));
    }
    var mine = Core.alive(s).filter(isMine), others = Core.alive(s).filter(function (v) { return !isMine(v); });
    app.appendChild(panel("👥 " + t("zm_survivors") + "（" + Core.alive(s).length + "）", [
      el("p", { class: "zm-small zm-muted" }, [t("zm_plan_note")]),
      el("div", { class: "zm-survs" }, mine.concat(others).map(function (v) { return survRow(s, v); })),
      s.dog ? el("p", { class: "zm-small" }, ["🐕 " + t("zm_dog_note", { n: s.dog.name })]) : null
    ]));
    var team = Core.teamOf(s, sess.pid);
    app.appendChild(panel("🗺 " + t("zm_explore_title"), [
      el("div", { class: "zm-mapbox" }, [
        cityMap(s, plan.district, function (a) { sess.send({ a: "district", d: a }); }, !mineOk),
        el("div", null, [
          districtInfo(s, plan.district),
          el("p", { class: "zm-small" }, [team.length ? t("zm_team", { n: team.map(function (v) { return L(v.name); }).join("、") }) : t("zm_team_none")]),
          team.length && !plan.district ? el("p", { class: "zm-warn zm-small" }, [t("zm_team_no_district")]) : null
        ])
      ])
    ]));
    app.appendChild(panel("🏗 " + t("zm_base_title"), [buildPanel(s, plan, mineOk), bldList(s)]));
    var players = s.players.length > 1 ? el("ul", { class: "zm-plist" }, s.players.map(function (p) { return el("li", null, [(s.plans[p.pid] && s.plans[p.pid].ready ? "✔ " : "… ") + (p.name || t("zm_noname")) + (p.pid === sess.pid ? t("zm_you") : "")]); })) : null;
    app.appendChild(el("div", { class: "zm-actions zm-next" }, [
      players,
      me(s) ? btn(plan.ready ? t("zm_unready") : (team.length ? t("zm_go_explore") : t("zm_go_night")), function () { sess.send({ a: "ready", v: !plan.ready }); }, plan.ready ? "zm-btn" : "zm-btn zm-primary zm-big", { disabled: !!s.gate && !plan.ready }) : null,
      s.gate ? el("span", { class: "zm-warn zm-small" }, [t("zm_gate_first")]) : null
    ]));
  }
  function bldList(s) {
    return el("div", { class: "zm-bldlist" }, D.BUILD_IDS.filter(function (b) { return s.bld[b]; }).map(function (b) { return el("span", { class: "zm-chip", title: L(D.BUILDINGS[b].desc) }, [D.BUILDINGS[b].icon + " " + L(D.BUILDINGS[b].name) + " Lv" + s.bld[b]]); }));
  }
  function reqText(req) {
    if (!req) return "";
    var p = [];
    if (req.g) Object.keys(req.g).forEach(function (k) { p.push(D.RES_INFO[k].icon + req.g[k]); });
    if (req.item) p.push(D.ITEMS[req.item].icon);
    if (req.trait) p.push(D.TRAITS[req.trait].icon + L(D.TRAITS[req.trait].name));
    if (req.stat) p.push(L(D.STAT_INFO[req.stat[0]]) + "≥" + req.stat[1]);
    if (req.dog) p.push("🐕");
    return p.length ? "（" + t("zm_need") + " " + p.join(" ") + "）" : "";
  }

  // ---- 投票（多人時全員一起決定外出事件卡與大門口事件；單機投下去就決定） ----
  function pname(s, pid) { var p = s.players.filter(function (x) { return x.pid === pid; })[0]; return (p && p.name) || t("zm_noname"); }
  function voteChoices(s, card, votes, okFn, onVote) {
    var multi = s.players.length > 1, my = votes[sess.pid];
    return el("div", { class: "zm-choices" }, card.ch.map(function (o, i) {
      var who = Object.keys(votes).filter(function (pid) { return votes[pid] === i; });
      return btn(L(o.t) + reqText(o.req), function () { onVote(i); }, "zm-btn zm-choice" + (my === i ? " zm-on" : ""), { disabled: !me(s) || !okFn(o) }, who);
    }));
  }
  function voteFooter(s, votes, canForce, onForce) {
    if (s.players.length < 2) return null;
    var n = Object.keys(votes).length;
    return el("div", { class: "zm-actions zm-votebar" }, [
      el("span", { class: "zm-small" }, ["🗳 " + t("zm_vote_status", { n: n, m: s.players.length }) + (n ? "：" + Object.keys(votes).map(function (pid) { return pname(s, pid); }).join("、") : "")]),
      el("span", { class: "zm-small zm-muted" }, [t("zm_vote_rule")]),
      canForce && n && me(s) ? btn(t("zm_vote_force"), onForce, "zm-btn", { title: t("zm_vote_force_note") }) : null
    ]);
  }

  // ---- 探索：所有隊伍都列出來，大家都看得到進度、每一隊都能投票 ----
  function exPanel(s, owner) {
    var ex = s.explore[owner], A = D.ARCH[ex.d], card = Core.currentCard(s, owner), mineEx = owner === sess.pid;
    var team = ex.team.map(function (id) { return Core.survById(s, id); }).filter(Boolean);
    var title = A.icon + " " + L(Core.districtName(s, ex.d)) + (s.players.length > 1 ? "・👤" + pname(s, owner) + (mineEx ? t("zm_you") : "") : "") + (ex.done ? " ✔" : "（" + Math.min(ex.step + 1, ex.cards.length) + "/" + ex.cards.length + "）");
    var votes = card ? Core.votesOf(s, Core.voteKeyCard(s, owner)) : {};
    return panel(title, [
      el("p", { class: "zm-small" }, [t("zm_team", { n: team.map(function (v) { return L(v.name) + (v.alive ? "" : "✝"); }).join("、") }) + (ex.noise ? "・🔊" + t("zm_noise", { n: ex.noise }) : "")]),
      logBox(ex.log),
      card ? el("div", { class: "zm-card", "data-ex": owner }, [
        el("p", { class: "zm-card-text" }, [L(card.text)]),
        voteChoices(s, card, votes, function (o) { return Core.reqOk(s, ex, o.req); }, function (i) { sess.send({ a: "answer", ex: owner, c: i }); }),
        voteFooter(s, votes, mineEx, function () { sess.send({ a: "force", k: owner }); })
      ]) : el("p", { class: "zm-good" }, [t("zm_explore_done")])
    ], mineEx ? "zm-ex-mine" : "");
  }
  function screenExplore(s) {
    var owners = Object.keys(s.explore).sort(function (a, b) { return (a === sess.pid ? -1 : 0) - (b === sess.pid ? -1 : 0); });
    if (!s.explore[sess.pid]) app.appendChild(el("p", { class: "zm-hint" }, [t(s.players.length > 1 ? "zm_explore_none_vote" : "zm_explore_none")]));
    else if (s.players.length > 1) app.appendChild(el("p", { class: "zm-hint" }, [t("zm_explore_vote_note")]));
    owners.forEach(function (owner) { app.appendChild(exPanel(s, owner)); });
  }

  // ---- 夜晚 ----
  function screenNightPrep(s) {
    var ns = s.night, live = ui.room && ui.room.wrap && ui.room.wrap.nm === "live";
    if (live && !ui.live) { startLiveView(s, false); return; }
    app.appendChild(panel("🌙 " + t("zm_night_title", { d: s.day }), [
      s.dayLog && s.dayLog.length ? el("div", null, [el("h3", null, [t("zm_day_work")]), logBox(s.dayLog)]) : null,
      // 所有隊伍的收穫都列出來（多人時大家一起看）
      Object.keys(s.explore).length ? el("div", null, [el("h3", null, [t("zm_explore_result")])].concat(Object.keys(s.explore).map(function (owner) {
        var ex = s.explore[owner];
        return el("div", null, [s.players.length > 1 ? el("b", { class: "zm-small" }, ["👤" + pname(s, owner) + "・" + L(Core.districtName(s, ex.d))]) : null, logBox(ex.log.slice(-8))]);
      }))) : null,
      el("h3", null, [t("zm_forecast")]),
      el("p", null, [t("zm_forecast_text", { n: ns.n, h: ns.heat, g: Math.min(ns.guards.length, Night.posts(ns.tower).length), p: Night.posts(ns.tower).length, a: ns.ammo, m: ns.mats })]),
      el("p", { class: "zm-small zm-muted" }, [t("zm_night_note")]),
      sess.host ? el("div", { class: "zm-actions" }, [
        btn("🎮 " + t("zm_night_live"), function () { startLive(); }, "zm-btn zm-primary zm-big", { disabled: !Z3 || !Z3.available() }),
        btn("⏩ " + t("zm_night_auto"), function () { autoNight(); }, "zm-btn zm-big")
      ]) : el("p", { class: "zm-muted" }, [t("zm_wait_host_night")]),
      Z3 && !Z3.available() ? el("p", { class: "zm-small zm-warn" }, [t("zm_no_3d")]) : null
    ]));
  }
  function autoNight() {
    var s = sess.s, sim = Night.create(s.night), res = sim.runToEnd();
    Core.endNight(s, res);
    if (ui.room) ui.room.wrap.nm = "";
    sess.commit();
  }
  // 房主／單機：開始即時防守（跑模擬）
  function startLive() {
    var s = sess.s, sim = Night.create(s.night);
    ui.sim = sim; ui.speed = 1;
    if (ui.room) { ui.room.resetNightCmds(); ui.room.wrap.nm = "live"; ui.room.writeState(ui.room.wrap); }
    startLiveView(s, true);
  }
  // 即時防守的畫面（房主跑模擬；其他人看快照）
  function startLiveView(s, runSim) {
    ui.live = { run: runSim, tool: "shoot", acc: 0, last: performance.now(), lastSnapT: -1, lastPush: 0, ended: false };
    app.innerHTML = "";
    app.appendChild(header());
    var hud = el("div", { class: "zm-nhud" }), stage = el("div", { class: "zm-stage" }, [el("p", { class: "zm-muted zm-center" }, [t("zm_loading_3d")])]), feed = el("div", { class: "zm-feed" });
    var tools = el("div", { class: "zm-tools" });
    stage.appendChild(feed);
    app.appendChild(hud); app.appendChild(stage); app.appendChild(tools);
    ui.live.hud = hud; ui.live.feed = feed; ui.live.tools = tools;
    function toolBtns() {
      tools.innerHTML = "";
      [["shoot", "🎯 " + t("zm_tool_shoot")], ["repair", "🔨 " + t("zm_tool_repair")], ["fire", "🔥 " + t("zm_tool_fire")], ["decoy", "📢 " + t("zm_tool_decoy")]].forEach(function (x) {
        tools.appendChild(btn(x[1], function () { ui.live.tool = x[0]; if (ui.view) ui.view.setTool(x[0]); toolBtns(); }, "zm-btn zm-tool" + (ui.live.tool === x[0] ? " zm-on" : ""), { id: "zm-tool-" + x[0] }));
      });
      tools.appendChild(btn("⟲", function () { if (ui.view) ui.view.rotate(0.4); }, "zm-btn"));
      tools.appendChild(btn("⟳", function () { if (ui.view) ui.view.rotate(-0.4); }, "zm-btn"));
      tools.appendChild(btn("＋", function () { if (ui.view) ui.view.zoom(-6); }, "zm-btn"));
      tools.appendChild(btn("－", function () { if (ui.view) ui.view.zoom(6); }, "zm-btn"));
      if (runSim) {
        tools.appendChild(btn("×" + (ui.speed === 1 ? 2 : 1), function () { ui.speed = ui.speed === 1 ? 2 : 1; toolBtns(); }, "zm-btn", { id: "zm-speed" }));
        tools.appendChild(btn("⏩ " + t("zm_night_skip"), function () { if (ui.sim) { ui.sim.runToEnd(); } }, "zm-btn", { id: "zm-skip" }));
      }
      tools.appendChild(el("p", { class: "zm-small zm-muted zm-toolnote" }, [t("zm_tool_note_" + ui.live.tool)]));
    }
    toolBtns();
    var ns = s.night;
    Z3.load().then(function () {
      if (!ui.live) return;
      stage.innerHTML = ""; stage.appendChild(feed);
      ui.view = Z3.create(stage, { weather: s.weather, city: s.city, light: ns.accMod >= 0.1 || (s.bld.generator && s.res.fuel > 0), tower: ns.tower, quality: pref().q || "high", onCmd: nightCmd });
      ui.view.setTool(ui.live.tool);
      try { hud.scrollIntoView({ block: "start" }); } catch (e) { /* 舊瀏覽器 */ }
      loop();
    }).catch(function () { stage.innerHTML = ""; stage.appendChild(el("p", { class: "zm-warn zm-center" }, [t("zm_no_3d")])); });
  }
  function nightCmd(c) {
    if (ui.live && ui.live.run && ui.sim) { if (ui.sim.cmd(sess.pid, c)) ui.live.okCmd = (ui.live.okCmd || 0) + 1; }
    else if (ui.room) ui.room.sendNightCmd(c);
  }
  function loop() {
    var L2 = ui.live;
    if (!L2 || L2.ended) return;
    L2.raf = requestAnimationFrame(loop);
    var now = performance.now(), dt = Math.min(0.25, (now - L2.last) / 1000);
    L2.last = now;
    var snap;
    if (L2.run) {
      var sim = ui.sim;
      L2.acc += dt * ui.speed;
      while (L2.acc >= Night.DT && !sim.done) { sim.tick(); L2.acc -= Night.DT; }
      snap = sim.snap(L2.lastSnapT);
      if (snap.fx.length) L2.lastSnapT = snap.fx[snap.fx.length - 1].t;
      if (ui.room && now - L2.lastPush > 200) { var full = sim.snap(L2.pushT === undefined ? -1 : L2.pushT); L2.pushT = sim.t; L2.lastPush = now; ui.room.writeSnap(full); }
      if (sim.done && !L2.doneAt) L2.doneAt = now;
      if (L2.doneAt && now - L2.doneAt > 1500) { finishLive(); return; }
    } else {
      snap = ui.room && ui.room.snap;
      var w = ui.room && ui.room.wrap;
      if (!w || w.nm !== "live") { stopLive(); afterChange(); return; }
    }
    if (snap) { if (ui.view) ui.view.setSnap(snap); hudUpdate(snap); }
  }
  function hudUpdate(sn) {
    var L2 = ui.live, key = [sn.c, sn.a, sn.m, sn.mo, sn.de, sn.k, Math.floor(sn.t)].join(",");
    if (L2.hudKey !== key) {
      L2.hudKey = key;
      L2.hud.innerHTML = "";
      L2.hud.appendChild(el("div", { class: "zm-hud-row" }, [
        el("b", null, ["🌙 " + Math.floor(sn.t) + "s"]),
        el("span", { class: "zm-res" }, ["🏠 ", bar(sn.c, sn.cm || 100, "zm-bar-hp"), " " + sn.c]),
        el("span", { class: "zm-res" }, ["🔫 " + sn.a]), el("span", { class: "zm-res" }, ["🧱 " + sn.m]),
        el("span", { class: "zm-res" }, ["🔥 " + sn.mo]), el("span", { class: "zm-res" }, ["📢 " + sn.de]),
        el("span", { class: "zm-res" }, ["💀 " + sn.k + "/" + sn.tot]),
        el("span", { class: "zm-res" }, ["🧟 " + sn.z.length])
      ]));
    }
    // 實況（擊倒巨漢、牆被打破、尖叫……）
    (sn.fx || []).forEach(function (f) {
      if (f.k !== "breach" && f.k !== "scream" && !(f.k === "die" && (f.ty === "brute" || f.ty === "mutant"))) return;
      if (L2.feedSeen && f.t <= L2.feedSeen) return;
      L2.feedSeen = f.t;
      var txt = f.k === "breach" ? t("zm_feed_breach") : f.k === "scream" ? t("zm_feed_scream") : t("zm_feed_kill", { z: D.ZOMBIES[f.ty].name });
      L2.feed.insertBefore(el("div", null, [txt]), L2.feed.firstChild);
      while (L2.feed.childNodes.length > 4) L2.feed.removeChild(L2.feed.lastChild);
    });
  }
  function finishLive() {
    var sim = ui.sim, s = sess.s;
    stopLive();
    if (!sim || !s || s.phase !== "night") { afterChange(); return; }
    Core.endNight(s, sim.result());
    ui.sim = null;
    if (ui.room) { ui.room.wrap.nm = ""; ui.room.clearSnap(); }
    sess.commit();
  }
  function stopLive() {
    if (ui.live) { ui.live.ended = true; cancelAnimationFrame(ui.live.raf); }
    if (ui.view) { ui.view.dispose(); ui.view = null; }
    ui.live = null;
  }

  // ---- 清晨 ----
  function screenDawn(s) {
    var r = s.nightRes;
    app.appendChild(panel("🌅 " + t("zm_dawn_title", { d: s.day }), [
      r ? el("p", { class: "zm-big-line" }, [t(r.overrun ? "zm_dawn_overrun" : "zm_dawn_held", { k: r.kills, t: r.total, c: s.core })]) : null,
      logBox(s.nightLog),
      el("h3", null, [t("zm_dawn_upkeep")]),
      logBox(s.dawnLog)
    ]));
    var acked = s.ack && s.ack[sess.pid];
    app.appendChild(el("div", { class: "zm-actions zm-next" }, [
      s.players.length > 1 ? el("span", { class: "zm-small zm-muted" }, [t("zm_wait_others", { n: s.players.filter(function (p) { return s.ack && s.ack[p.pid]; }).length, m: s.players.length })]) : null,
      me(s) ? btn(t("zm_next_day", { d: s.day + 1 }), function () { sess.send({ a: "ready", v: true }); }, "zm-btn zm-primary zm-big", { disabled: !!acked }) : null
    ]));
  }

  // ---- 結局 ----
  function screenEnd(s) {
    var E = s.end, m = ui.recorded || Core.loadMeta();
    app.appendChild(panel((E.win ? "🏁 " : "☠ ") + t("zm_end_" + E.kind + "_title"), [
      el("p", { class: "zm-end-text" }, [t("zm_end_" + E.kind + "_text", { d: E.day, n: E.alive, city: D.CITIES[s.city].name })]),
      el("p", { class: "zm-big-line" }, [t("zm_score", { n: E.score })]),
      el("ul", { class: "zm-rules" }, [
        el("li", null, [t("zm_stat_days", { n: E.kind === "rescue" ? s.len : E.day })]),
        el("li", null, [t("zm_stat_alive", { n: E.alive, m: s.surv.length })]),
        el("li", null, [t("zm_stat_kills", { n: s.stats.kills })]),
        el("li", null, [t("zm_stat_found", { n: s.stats.found })]),
        el("li", null, [t("zm_stat_legacy", { n: E.legacy, p: m.pts })])
      ]),
      s.nightLog ? logBox(s.nightLog) : null,
      s.dawnLog ? logBox(s.dawnLog) : null,
      el("h3", null, [t("zm_memorial")]),
      el("p", { class: "zm-small" }, [s.surv.filter(function (v) { return !v.alive; }).map(function (v) { return L(v.name) + "（" + t("zm_gone_" + (v.gone || "dead")) + "）"; }).join("、") || t("zm_memorial_none")]),
      el("div", { class: "zm-actions" }, [
        btn(t("zm_menu_legacy"), function () { go("legacy"); }, "zm-btn"),
        ui.room ? (ui.room.isHost() ? btn(t("zm_back_lobby"), function () { ui.room.backToLobby(); go("lobby"); }, "zm-btn zm-primary") : null)
          : btn(t("zm_again"), function () { go("setup"); }, "zm-btn zm-primary")
      ])
    ]));
  }

  // ---------------- 連線 ----------------
  function roomUrl(id) { return window.location.href.split(/[?#]/)[0] + "?room=" + id; }
  function enterRoom(roomId) {
    if (!Net) return;
    leaveRoom(true);
    var meta = Core.loadMeta();
    var room = Net.open({
      roomId: roomId, name: lsGet(NAME_KEY), special: Core.isUnlocked(meta, ui.setup.special) ? ui.setup.special : "",
      cfg: { city: ui.setup.city, len: ui.setup.len, base: ui.setup.base, rules: ui.setup.rules.filter(function (r) { return Core.isUnlocked(meta, r); }) },
      onChange: onRoomChange,
      onIntent: function (pid, it) {
        var w = room.wrap;
        if (!room.isHost() || !w || !w.s) return;
        if (Core.applyIntent(w.s, pid, it)) { room.writeState(w); afterChange(); }
      },
      onNightCmd: function (pid, c) { if (ui.sim && ui.live && ui.live.run) ui.sim.cmd(pid, c); },
      onState: function () { pendingRender(); }
    });
    ui.room = room;
    sess = netSession(room);
    ui.recorded = null;
    // 建房或加入都把網址設成房間網址（leaveRoom 會清掉 ?room=，加入時也要補回來，重新整理才回得到房間）
    try { window.history.replaceState(null, "", roomUrl(room.id)); } catch (e) { /* 改不了網址也沒關係 */ }
    go("lobby");
  }
  var rp = false;
  function pendingRender() { if (rp) return; rp = true; setTimeout(function () { rp = false; onRoomChange(); }, 30); }
  function onRoomChange() {
    var room = ui.room;
    if (!room) return;
    var st = room.status();
    if (st === "game" && ui.screen === "lobby" && room.wrap && room.wrap.s) { ui.screen = "game"; ui.recorded = null; }
    if (st === "lobby" && ui.screen === "game") ui.screen = "lobby";
    var s = room.wrap && room.wrap.s;
    if (s && s.end && !ui.recorded) ui.recorded = Core.recordRun(s);
    if (ui.live) {
      // 房主換人或夜晚結束（看快照的人）：loop 會自己收尾
      return;
    }
    if (ui.screen === "game" && s && s.phase === "night" && room.wrap.nm === "live" && !room.isHost()) { startLiveView(s, false); return; }
    rerenderKeep();
  }
  function leaveRoom(silent) {
    stopLive();
    if (ui.room) { ui.room.close(); ui.room = null; }
    if (sess && !sess.solo) sess = null;
    try { if (window.location.search.indexOf("room=") >= 0) window.history.replaceState(null, "", window.location.href.split(/[?#]/)[0]); } catch (e) { /* 同上 */ }
    if (!silent) go("home");
  }
  function screenLobby() {
    var room = ui.room;
    if (!room) { go("home"); return; }
    if (room.missing) { app.appendChild(panel(t("zm_menu_coop"), [el("p", null, [t("zm_room_missing")]), btn(t("zm_home"), function () { leaveRoom(); })])); return; }
    if (!room.loaded) { app.appendChild(panel(t("zm_menu_coop"), [el("p", { class: "zm-muted" }, [t("zm_connecting")])])); return; }
    var host = room.isHost(), url = roomUrl(room.id), meta = Core.loadMeta();
    var qr = el("canvas", { class: "zm-qr" });
    try { window.PriTestQRCode.renderToCanvas(qr, url, { level: "L", scale: 4, margin: 2 }); } catch (e) { qr = null; }
    app.appendChild(panel("👥 " + t("zm_menu_coop"), [
      el("div", { class: "zm-mapbox" }, [
        qr,
        el("div", null, [
          el("p", null, [t("zm_room_share")]),
          el("input", { class: "zm-input zm-url", readonly: true, value: url, onclick: function (e) { e.target.select(); } }),
          el("div", { class: "zm-actions" }, [
            btn(t("zm_copy"), function () { try { navigator.clipboard.writeText(url); ui.lobbyMsg = t("zm_copied"); } catch (e) { ui.lobbyMsg = ""; } rerenderKeep(); }),
            btn(t("zm_leave"), function () { leaveRoom(); }, "zm-link")
          ]),
          ui.lobbyMsg ? el("p", { class: "zm-good zm-small" }, [ui.lobbyMsg]) : null
        ])
      ])
    ]));
    app.appendChild(panel(t("zm_me"), [
      el("label", null, [t("zm_name") + " ", el("input", { class: "zm-input", id: "zm-name", maxlength: "16", value: lsGet(NAME_KEY), onchange: function (e) { lsSet(NAME_KEY, e.target.value.trim()); room.update({ name: e.target.value.trim() }); } })]),
      el("h3", null, [t("zm_special")]),
      specialPicker(room.me.special || "", function (v) { room.update({ special: v }); rerenderKeep(); }, meta)
    ]));
    var list = room.list(), s = room.wrap && room.wrap.s;
    app.appendChild(panel(t("zm_players") + "（" + list.length + "/4）", [
      el("ul", { class: "zm-plist" }, list.map(function (p) {
        return el("li", null, [(p.cid === room.meta.host ? "👑 " : "") + (p.name || t("zm_noname")) + (p.cid === room.cid ? t("zm_you") : "") + (p.special && D.SPECIALS[p.special] ? "・" + L(D.SPECIALS[p.special].name) : "")]);
      })),
      list.length > 4 ? el("p", { class: "zm-warn zm-small" }, [t("zm_room_full")]) : null
    ]));
    var cfg = room.cfg || {};
    cfg.rules = cfg.rules || [];
    app.appendChild(panel(t("zm_settings"), [
      host ? setupForm(cfg.city ? cfg : (room.cfg = { city: "tw", len: 10, base: "store", rules: [] }), function () { room.setCfg(room.cfg); rerenderKeep(); }, false, meta)
        : el("p", null, [t("zm_lobby_cfg", { c: D.CITIES[cfg.city || "tw"].name, l: cfg.len === 30 ? 30 : 10, b: D.BASES[cfg.base || "store"].name, r: (cfg.rules || []).map(function (x) { return L(D.RULES[x].name); }).join("、") || t("zm_none") })]),
      host ? el("div", { class: "zm-actions" }, [
        btn(s && !s.end ? t("zm_resume_game") : t("zm_start_coop"), function () {
          if (s && !s.end) { room.startGame(room.wrap); go("game"); return; }
          var ps = list.slice(0, 4).map(function (p) { return { pid: p.pid, name: p.name, special: p.special }; });
          var ns2 = Core.newGame({ seed: Core.newSeed(), city: room.cfg.city, len: room.cfg.len, base: room.cfg.base, rules: room.cfg.rules, players: ps });
          room.startGame({ s: ns2, q: {}, nm: "" });
          ui.recorded = null;
          go("game");
        }, "zm-btn zm-primary zm-big", { disabled: !list.length }),
        s && !s.end ? btn(t("zm_new_coop"), function () { room.wrap = null; rerenderKeep(); }, "zm-link") : null
      ]) : el("p", { class: "zm-muted" }, [room.status() === "game" ? t("zm_game_running") : t("zm_wait_host_start")]),
      !host && room.status() === "game" && s ? btn(t("zm_join_view"), function () { go("game"); }, "zm-btn zm-primary") : null
    ]));
  }

  var SCREENS = { home: screenHome, help: screenHelp, setup: screenSetup, legacy: screenLegacy, game: screenGame, lobby: screenLobby };

  // 網址帶 ?room= 直接進房
  var rid = Net && Net.roomFromUrl(window.location.href);
  if (rid && Net.validRoomId(rid)) enterRoom(rid);
  else render();
  window.addEventListener("i18n:change", function () { if (!ui.live) render(); });

  // 測試與除錯用
  window.PriTestZombie = { ui: ui, get sess() { return sess; }, go: go, startSolo: startSolo, startLive: startLive, autoNight: autoNight, nightCmd: nightCmd, enterRoom: enterRoom, render: render };
})();
