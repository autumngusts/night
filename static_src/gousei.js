// 武俠合成（gousei）UI。規則全部在 gousei_core.js，這裡只負責畫面、輸入、存讀檔與主題資料載入。
// 主題資料很大（每個主題數千種物體），不在頁面 script 清單裡：選主題時才以 <script> 動態載入，
//   網址從 #gs-app 的 data-src-<theme> 取（帶快取雜湊，見 site_src/gousei_page.py）。
// 任務遮蔽（ui.revealed / ui.handoff）刻意不存進 state：重新整理後回到交接畫面，避免其他人看到任務。
// 分別裝置模式：手機開 ?join=<theme.seed.count.index>，只顯示自己的任務，不同步、不存檔。
(function () {
  "use strict";

  var Core = window.PriTestGouseiCore;
  var STORAGE_KEY = "pritest-gousei-state";
  var THEMES = ["wuxia", "wafu"];
  var MODES = ["shared", "split"];
  var POOL_LIMIT = 300;
  var LOG_LIMIT = 30;
  var app = document.getElementById("gs-app");
  if (!app) return;

  var themes = {}; // themeId -> Core.indexTheme 結果
  var state = null;
  var draft = { themeId: "wuxia", mode: "shared", names: ["", ""] };
  var ui = { handoff: true, revealed: false, slots: [null, null], lastEntry: null, search: "", cat: "all",
    qrFor: null, confirmNew: false, error: "", loading: false, screen: "play" };
  var join = null;

  function t(key, params) { return window.I18N.t(key, params); }
  function lang() { return window.I18N.getLang(); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") node.textContent = v;
      else if (k === "class") node.className = v;
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  // 遊戲資料只有 zh / ja；en 依專案慣例 fallback 至 ja
  function itemName(theme, id) {
    var it = theme.byId[id];
    if (!it) return id;
    return lang() === "zh" ? it.zh : it.ja;
  }

  function catName(theme, catId) {
    if (catId === "basic") return t("gs_cat_basic");
    if (catId === "junk") return t("gs_cat_junk");
    var c = theme.catById[catId];
    if (!c) return catId;
    return lang() === "zh" ? c.zh : c.ja;
  }

  function playerById(id) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === id) return state.players[i];
    return null;
  }

  // ---------------- 主題資料載入 ----------------

  function loadTheme(themeId, cb) {
    if (themes[themeId]) { cb(null, themes[themeId]); return; }
    function ready() {
      var data = window.PriTestGouseiData && window.PriTestGouseiData[themeId];
      if (!data) { cb(new Error("no-data")); return; }
      themes[themeId] = Core.indexTheme(data);
      cb(null, themes[themeId]);
    }
    if (window.PriTestGouseiData && window.PriTestGouseiData[themeId]) { ready(); return; }
    var src = app.getAttribute("data-src-" + themeId);
    if (!src) { cb(new Error("unknown-theme")); return; }
    var s = document.createElement("script");
    s.src = src;
    s.onload = ready;
    s.onerror = function () { cb(new Error("load-failed")); };
    document.head.appendChild(s);
  }

  // ---------------- 存讀檔 ----------------

  function save() {
    try {
      if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* 私密模式等：只是不存檔 */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.version !== 1 || !s.players || !s.pool || THEMES.indexOf(s.themeId) < 0) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  // ---------------- 共用部件 ----------------

  function radioGroup(name, values, current, labelKeyPrefix, onChange) {
    return el("div", { class: "gs-radio" }, values.map(function (v) {
      var input = el("input", { type: "radio", name: name, value: v, checked: v === current,
        onchange: function () { onChange(v); } });
      return el("label", { class: "gs-check" }, [input, " " + t(labelKeyPrefix + v)]);
    }));
  }

  function targetList(theme, player, idPrefix) {
    var list = el("ul", { id: idPrefix, class: "gs-target-list" });
    player.targets.forEach(function (id, i) {
      var it = theme.byId[id];
      var done = player.done.indexOf(id) >= 0;
      list.appendChild(el("li", { class: "gs-target" + (done ? " gs-done" : ""), "data-target": id }, [
        el("span", { class: "gs-target-tier", text: t(i === 0 ? "gs_tier_mid" : "gs_tier_high") }),
        el("strong", { class: "gs-target-name", text: itemName(theme, id) }),
        el("span", { class: "gs-muted", text: t("gs_target_meta", { cat: catName(theme, it.cat), tier: it.tier }) }),
        done ? el("span", { class: "gs-badge", text: t("gs_done") }) : null
      ]));
    });
    return list;
  }

  function progressPanel() {
    var list = el("ul", { class: "gs-progress" });
    state.players.forEach(function (p, i) {
      list.appendChild(el("li", { class: i === state.turn && !state.winner ? "gs-current" : "", "data-player": p.id,
        text: t("gs_progress", { name: p.name, done: p.done.length, total: p.targets.length }) }));
    });
    return el("div", { class: "gs-panel" }, [el("h2", { text: t("gs_progress_heading") }), list]);
  }

  // ---------------- 設定畫面 ----------------

  function renderSetup() {
    var box = el("div", { class: "gs-panel" }, [el("h2", { text: t("gs_setup") })]);
    box.appendChild(el("div", { class: "gs-field" }, [el("span", { class: "gs-label", text: t("gs_theme") }),
      radioGroup("gs-theme", THEMES, draft.themeId, "gs_theme_", function (v) { draft.themeId = v; })]));
    box.appendChild(el("div", { class: "gs-field" }, [el("span", { class: "gs-label", text: t("gs_mode") }),
      radioGroup("gs-mode", MODES, draft.mode, "gs_mode_", function (v) { draft.mode = v; })]));

    var count = el("input", { id: "gs-player-count", type: "number", min: Core.MIN_PLAYERS, max: Core.MAX_PLAYERS,
      value: draft.names.length });
    count.addEventListener("change", function () {
      var n = Math.max(Core.MIN_PLAYERS, Math.min(Core.MAX_PLAYERS, parseInt(count.value, 10) || Core.MIN_PLAYERS));
      while (draft.names.length < n) draft.names.push("");
      draft.names.length = n;
      render();
    });
    box.appendChild(el("div", { class: "gs-field" }, [
      el("label", { for: "gs-player-count", class: "gs-label", text: t("gs_player_count") }), count,
      el("span", { class: "gs-muted", text: t("gs_player_count_range", { min: Core.MIN_PLAYERS, max: Core.MAX_PLAYERS }) })
    ]));
    var names = el("ol", { class: "gs-name-list" });
    draft.names.forEach(function (v, i) {
      var input = el("input", { type: "text", class: "gs-name-input", value: v, maxlength: 20,
        placeholder: t("gs_player_default", { n: i + 1 }) });
      input.addEventListener("input", function () { draft.names[i] = input.value; });
      names.appendChild(el("li", {}, [input]));
    });
    box.appendChild(el("div", { class: "gs-field" }, [el("span", { class: "gs-label", text: t("gs_players") })]));
    box.appendChild(names);
    box.appendChild(el("p", { class: "gs-muted", text: t("gs_hint") }));
    box.appendChild(el("p", { class: "gs-error", text: ui.error }));
    box.appendChild(el("div", { class: "gs-actions" }, [
      el("button", { id: "gs-start", type: "button", class: "gs-primary", disabled: ui.loading,
        text: ui.loading ? t("gs_loading") : t("gs_start"), onclick: startGame })
    ]));
    app.appendChild(box);
  }

  function startGame() {
    ui.loading = true;
    ui.error = "";
    render();
    loadTheme(draft.themeId, function (err, theme) {
      ui.loading = false;
      if (err) { ui.error = t("gs_load_failed"); render(); return; }
      var names = draft.names.map(function (v, i) { return v.trim() || t("gs_player_default", { n: i + 1 }); });
      try {
        state = Core.newGame(theme, { seed: Core.newSeed(Math.random), mode: draft.mode, names: names });
      } catch (e) {
        ui.error = t("gs_not_enough_targets");
        render();
        return;
      }
      resetTurnUi();
      ui.screen = state.mode === "split" ? "qr" : "play";
      save();
      render();
    });
  }

  function resetTurnUi() {
    ui.handoff = true;
    ui.revealed = false;
    ui.slots = [null, null];
    ui.lastEntry = null;
    ui.confirmNew = false;
  }

  // ---------------- 同一裝置：交接畫面 ----------------

  function renderHandoff() {
    var p = Core.currentPlayer(state);
    app.appendChild(el("div", { class: "gs-panel gs-handoff" }, [
      el("h2", { text: t("gs_round_turn", { round: state.round, name: p.name }) }),
      el("p", { class: "gs-big", text: t("gs_handoff", { name: p.name }) }),
      el("button", { id: "gs-handoff-ready", type: "button", class: "gs-primary", text: t("gs_handoff_ready", { name: p.name }),
        onclick: function () { ui.handoff = false; ui.revealed = true; render(); } })
    ]));
    app.appendChild(progressPanel());
  }

  // ---------------- 遊戲畫面 ----------------

  function renderTargetsPanel(theme) {
    var p = Core.currentPlayer(state);
    var panel = el("div", { class: "gs-panel" }, [
      el("h2", { text: t("gs_targets", { name: p.name }) }),
      el("button", { id: "gs-toggle-targets", type: "button", text: t(ui.revealed ? "gs_hide_targets" : "gs_show_targets"),
        onclick: function () { ui.revealed = !ui.revealed; render(); } })
    ]);
    if (ui.revealed) panel.appendChild(targetList(theme, p, "gs-targets"));
    return panel;
  }

  function renderResult(theme) {
    var e = ui.lastEntry;
    var p = playerById(e.playerId);
    var it = theme.byId[e.result];
    var status = theme.junkSet[e.result] ? t("gs_result_junk") : (e.isNew ? t("gs_result_new") : t("gs_result_old"));
    return el("div", { id: "gs-result", class: "gs-panel gs-result" + (e.achieved ? " gs-achieved" : "") }, [
      el("h2", { text: t("gs_result_heading", { name: p.name }) }),
      el("p", { class: "gs-formula", text: itemName(theme, e.a) + " ＋ " + itemName(theme, e.b) + " →" }),
      el("p", { class: "gs-big", "data-result": e.result, text: itemName(theme, e.result) }),
      el("p", { class: "gs-muted", text: t("gs_target_meta", { cat: catName(theme, it.cat), tier: it.tier }) + "　" + status }),
      e.achieved ? el("p", { class: "gs-big", text: t("gs_achieved", { done: p.done.length, total: p.targets.length }) }) : null,
      state.winner ? null : el("div", { class: "gs-actions" }, [
        el("button", { id: "gs-next", type: "button", class: "gs-primary", text: t("gs_next"), onclick: nextTurn })
      ])
    ]);
  }

  function nextTurn() {
    resetTurnUi();
    ui.handoff = state.mode === "shared";
    render();
  }

  function renderSlots(theme) {
    function slot(i) {
      var id = ui.slots[i];
      return el("button", { id: "gs-slot-" + i, type: "button", class: "gs-slot" + (id ? " gs-filled" : ""),
        text: id ? itemName(theme, id) : t("gs_slot_empty"),
        onclick: function () { ui.slots[i] = null; render(); } });
    }
    var ready = ui.slots[0] && ui.slots[1];
    return el("div", { class: "gs-panel gs-workbench" }, [
      el("div", { class: "gs-slots" }, [slot(0), el("span", { class: "gs-plus", text: "＋" }), slot(1)]),
      el("div", { class: "gs-actions" }, [
        el("button", { id: "gs-combine", type: "button", class: "gs-primary", disabled: !ready, text: t("gs_combine"), onclick: doCombine }),
        el("button", { id: "gs-clear", type: "button", text: t("gs_clear"), onclick: function () { ui.slots = [null, null]; render(); } })
      ])
    ]);
  }

  function doCombine() {
    var theme = themes[state.themeId];
    var res = Core.applyCombine(theme, state, ui.slots[0], ui.slots[1]);
    state = res.state;
    ui.lastEntry = res.entry;
    ui.slots = [null, null];
    ui.revealed = false;
    save();
    render();
  }

  function pickItem(id) {
    if (ui.lastEntry || state.winner) return;
    if (!ui.slots[0]) ui.slots[0] = id;
    else ui.slots[1] = id;
    render();
  }

  function fillPoolList(theme, list) {
    list.innerHTML = "";
    var q = ui.search.trim().toLowerCase();
    var matched = state.pool.filter(function (id) {
      var it = theme.byId[id];
      if (ui.cat !== "all" && it.cat !== ui.cat) return false;
      if (!q) return true;
      return it.zh.toLowerCase().indexOf(q) >= 0 || it.ja.toLowerCase().indexOf(q) >= 0;
    });
    matched.slice(0, POOL_LIMIT).forEach(function (id) {
      list.appendChild(el("button", { type: "button", class: "gs-item gs-cat-" + theme.byId[id].cat, "data-item": id,
        text: itemName(theme, id), onclick: function () { pickItem(id); } }));
    });
    if (matched.length > POOL_LIMIT) list.appendChild(el("p", { class: "gs-muted", text: t("gs_pool_more", { n: matched.length - POOL_LIMIT }) }));
  }

  function renderPool(theme) {
    var cats = ["all", "basic"].concat(theme.data.categories.map(function (c) { return c.id; })).concat(["junk"]);
    var select = el("select", { id: "gs-pool-cat" }, cats.map(function (c) {
      return el("option", { value: c, selected: c === ui.cat, text: c === "all" ? t("gs_cat_all") : catName(theme, c) });
    }));
    var list = el("div", { id: "gs-pool-list", class: "gs-pool-list" });
    select.addEventListener("change", function () { ui.cat = select.value; fillPoolList(theme, list); });
    var search = el("input", { id: "gs-pool-search", type: "search", value: ui.search, placeholder: t("gs_search") });
    // 只重畫清單，不重畫整個畫面（避免輸入框失去焦點）
    search.addEventListener("input", function () { ui.search = search.value; fillPoolList(theme, list); });
    fillPoolList(theme, list);
    return el("div", { class: "gs-panel" }, [
      el("h2", { text: t("gs_pool", { n: state.pool.length }) }),
      el("div", { class: "gs-field" }, [search, select]),
      list
    ]);
  }

  function renderLog(theme) {
    var list = el("ol", { id: "gs-log", class: "gs-log", reversed: true });
    state.log.slice(-LOG_LIMIT).reverse().forEach(function (e) {
      list.appendChild(el("li", { text: t("gs_log_entry", { round: e.round, name: playerById(e.playerId).name,
        a: itemName(theme, e.a), b: itemName(theme, e.b), r: itemName(theme, e.result) }) + (e.achieved ? t("gs_log_achieved") : "") }));
    });
    return el("details", { class: "gs-panel" }, [el("summary", { text: t("gs_log") }), list]);
  }

  function renderFooter() {
    var actions = el("div", { class: "gs-actions" }, [
      el("button", { id: "gs-undo", type: "button", disabled: !state.prev, text: t("gs_undo"), onclick: function () {
        var back = Core.undo(state);
        if (!back) return;
        state = back;
        resetTurnUi();
        ui.handoff = false; // 復原後由同一位玩家重來
        ui.revealed = true;
        save();
        render();
      } }),
      state.mode === "split" ? el("button", { id: "gs-show-qr", type: "button", text: t("gs_qr_button"),
        onclick: function () { ui.screen = "qr"; ui.qrFor = null; render(); } }) : null,
      el("button", { id: "gs-new-game", type: "button", text: ui.confirmNew ? t("gs_new_game_confirm") : t("gs_new_game"),
        onclick: function () {
          if (!ui.confirmNew) { ui.confirmNew = true; render(); return; }
          state = null;
          resetTurnUi();
          ui.screen = "play";
          save();
          render();
        } })
    ]);
    return el("div", {}, [actions, el("p", { class: "gs-muted", text: t("gs_seed", { seed: state.seed }) })]);
  }

  function renderPlay(theme) {
    if (state.winner) {
      app.appendChild(el("div", { id: "gs-winner", class: "gs-panel gs-achieved" }, [
        el("p", { class: "gs-big", text: t("gs_winner", { name: playerById(state.winner).name }) })
      ]));
      state.players.forEach(function (p) {
        app.appendChild(el("div", { class: "gs-panel" }, [el("h2", { text: t("gs_targets", { name: p.name }) }), targetList(theme, p, "gs-targets-" + p.id)]));
      });
    } else {
      var p = Core.currentPlayer(state);
      app.appendChild(el("h2", { class: "gs-turn", text: t("gs_round_turn", { round: state.round, name: p.name }) }));
    }
    if (ui.lastEntry) app.appendChild(renderResult(theme));
    else if (!state.winner) {
      if (state.mode === "shared") app.appendChild(renderTargetsPanel(theme));
      app.appendChild(renderSlots(theme));
    }
    app.appendChild(progressPanel());
    if (!state.winner) app.appendChild(renderPool(theme));
    app.appendChild(renderLog(theme));
    app.appendChild(renderFooter());
  }

  // ---------------- 分別裝置：QR 畫面（Task 6 實作） ----------------

  function renderQrScreen() { ui.screen = "play"; render(); }
  function renderJoin() { app.appendChild(el("p", { class: "gs-error", text: t("gs_join_invalid") })); }

  // ---------------- 主畫面 ----------------

  function render() {
    app.innerHTML = "";
    if (join) { renderJoin(); return; }
    if (!state) { renderSetup(); return; }
    var theme = themes[state.themeId];
    if (!theme) {
      app.appendChild(el("p", { class: "gs-muted", text: ui.error || t("gs_loading") }));
      return;
    }
    if (ui.screen === "qr") { renderQrScreen(theme); return; }
    if (state.mode === "shared" && ui.handoff && !ui.lastEntry && !state.winner) { renderHandoff(); return; }
    renderPlay(theme);
  }

  function init() {
    var params = new URLSearchParams(window.location.search);
    if (params.has("join")) {
      join = Core.parseJoin(params.get("join")) || { invalid: true };
      render();
      return;
    }
    state = load();
    if (state) {
      ui.handoff = state.mode === "shared";
      loadTheme(state.themeId, function (err) {
        if (err) ui.error = t("gs_load_failed");
        render();
      });
    }
    render();
  }

  window.addEventListener("i18n:change", render);
  window.PriTestGousei = {
    _debugState: function () { return state ? JSON.parse(JSON.stringify(state)) : null; },
    _theme: function () { return state ? themes[state.themeId] : null; }
  };
  init();
})();
