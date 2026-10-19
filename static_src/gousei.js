// 武俠合成（gousei）UI。規則全部在 gousei_core.js，這裡只負責畫面、輸入、存讀檔與主題資料載入。
// 主題資料很大（每個主題數千種物體），不在頁面 script 清單裡：選主題時才以 <script> 動態載入，
//   網址從 #gs-app 的 data-src-<theme> 取（帶快取雜湊，見 site_src/gousei_page.py）。
// 同一裝置模式：開局先進「任務確認」畫面（state.confirm），全員輪流查看並隱藏後才正式開始；
//   遊戲中池子下方的各玩家任務一次只能展開一位（ui.revealedFor），刻意不存檔：重新整理後一律隱藏。
// 分別裝置模式：手機開 ?join=<theme.seed.count.index>，只顯示自己的任務，不同步、不存檔。
// 語音模式（Web Speech API）：輪到誰就朗讀玩家與池子，每分鐘重複；喊「yo, アキ」→ 提示音 →「A 加 B」直接合成。
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
  var draft = { themeId: "wuxia", mode: "shared", names: ["", ""], voice: false };
  var ui = { revealedFor: null, revealed: false, slots: [null, null], lastEntry: null, search: "", cat: "all",
    qrFor: null, confirmNew: false, junkWarn: null, error: "", loading: false, screen: "play" };
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
    var voiceBox = el("input", { id: "gs-voice-setup", type: "checkbox", checked: draft.voice, disabled: !voiceSupported(),
      onchange: function () { draft.voice = voiceBox.checked; } });
    box.appendChild(el("div", { class: "gs-field" }, [
      el("label", { class: "gs-check" }, [voiceBox, " " + t("gs_voice_setup")]),
      el("span", { class: "gs-muted", text: voiceSupported() ? t("gs_voice_setup_hint") : t("gs_voice_unsupported") })
    ]));
    box.appendChild(el("p", { class: "gs-muted", text: t("gs_hint") }));
    box.appendChild(el("p", { class: "gs-error", text: ui.error }));
    box.appendChild(el("div", { class: "gs-actions" }, [
      el("button", { id: "gs-start", type: "button", class: "gs-primary", disabled: ui.loading,
        text: ui.loading ? t("gs_loading") : t("gs_start"), onclick: startGame })
    ]));
    app.appendChild(box);
  }

  function startGame() {
    // 朗讀與音效需要使用者操作才能啟動，所以在按下「開始遊戲」的當下就開
    if (draft.voice && voiceSupported()) voiceStart();
    ui.loading = true;
    ui.error = "";
    ui.cat = "all";
    ui.search = "";
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
      if (state.mode === "shared") state.confirm = { viewed: [] };
      resetTurnUi();
      ui.screen = state.mode === "split" ? "qr" : "play";
      save();
      render();
    });
  }

  function resetTurnUi() {
    ui.revealedFor = null;
    ui.slots = [null, null];
    ui.lastEntry = null;
    ui.confirmNew = false;
    ui.junkWarn = null;
  }

  // ---------------- 同一裝置：各玩家的隱藏任務 ----------------
  // 開局確認與遊戲中共用。一次只展開一位，展開另一位時前一位自動收起。

  function toggleReveal(id) {
    if (ui.revealedFor === id) {
      ui.revealedFor = null;
    } else {
      ui.revealedFor = id;
      if (state.confirm && state.confirm.viewed.indexOf(id) < 0) { state.confirm.viewed.push(id); save(); }
    }
    ui.confirmNew = false;
    render();
  }

  function playerTargetsList(theme) {
    var list = el("ul", { id: "gs-player-targets", class: "gs-player-targets" });
    state.players.forEach(function (p, i) {
      var open = ui.revealedFor === p.id;
      var current = !state.confirm && !state.winner && i === state.turn;
      var status = state.confirm
        ? (state.confirm.viewed.indexOf(p.id) >= 0 ? el("span", { class: "gs-badge", text: t("gs_confirm_seen") }) : null)
        : el("span", { class: "gs-muted", text: t("gs_progress_short", { done: p.done.length, total: p.targets.length }) });
      var li = el("li", { class: "gs-player-targets-item" + (open ? " gs-open" : "") + (current ? " gs-current" : ""),
        "data-player": p.id }, [
        el("div", { class: "gs-player-targets-head" }, [
          el("strong", { text: p.name }), status,
          el("button", { type: "button", "data-reveal": p.id, class: open ? "gs-primary" : "",
            text: open ? t("gs_hide_targets") : t("gs_show_player_targets"), onclick: function () { toggleReveal(p.id); } })
        ])
      ]);
      if (open) li.appendChild(targetList(theme, p, "gs-targets-" + p.id));
      list.appendChild(li);
    });
    return list;
  }

  function renderConfirm(theme) {
    var total = state.players.length;
    var seen = state.confirm.viewed.length;
    var canStart = seen >= total && !ui.revealedFor;
    var note = canStart ? t("gs_confirm_ready")
      : (seen >= total ? t("gs_confirm_hide_first") : t("gs_confirm_wait", { n: seen, total: total }));
    app.appendChild(el("div", { id: "gs-confirm", class: "gs-panel gs-confirm" }, [
      el("h2", { text: t("gs_confirm_heading") }),
      el("p", { class: "gs-muted", text: t("gs_confirm_hint") }),
      playerTargetsList(theme),
      el("p", { class: "gs-big", text: note }),
      el("div", { class: "gs-actions" }, [
        el("button", { id: "gs-confirm-start", type: "button", class: "gs-primary", disabled: !canStart, text: t("gs_confirm_start"),
          onclick: function () {
            delete state.confirm;
            resetTurnUi();
            save();
            render();
          } })
      ])
    ]));
    app.appendChild(renderFooter());
  }

  // ---------------- 遊戲畫面 ----------------

  function renderResult(theme) {
    var e = ui.lastEntry;
    var p = playerById(e.playerId);
    var it = theme.byId[e.result];
    var status = theme.junkSet[e.result] ? t("gs_result_junk") : (e.isNew ? t("gs_result_new") : t("gs_result_old"));
    return el("div", { id: "gs-result", class: "gs-panel gs-result" + (e.achieved ? " gs-achieved" : "") }, [
      el("h2", { text: t("gs_result_heading", { name: p.name }) }),
      el("p", { class: "gs-formula", text: itemName(theme, e.a) + " ＋ " + itemName(theme, e.b) + " →" }),
      el("p", { class: "gs-big", "data-result": e.result, text: itemName(theme, e.result) }),
      el("p", { class: "gs-muted", text: (theme.junkSet[e.result] ? t("gs_junk_meta") : t("gs_target_meta", { cat: catName(theme, it.cat), tier: it.tier })) + "　" + status }),
      e.achieved ? el("p", { class: "gs-big", text: t("gs_achieved", { done: p.done.length, total: p.targets.length }) }) : null,
      state.winner ? null : el("div", { class: "gs-actions" }, [
        el("button", { id: "gs-next", type: "button", class: "gs-primary", text: t("gs_next"), onclick: nextTurn })
      ])
    ]);
  }

  function nextTurn() {
    resetTurnUi();
    render();
  }

  function renderSlots(theme) {
    function slot(i) {
      var id = ui.slots[i];
      return el("button", { id: "gs-slot-" + i, type: "button", class: "gs-slot" + (id ? " gs-filled" : ""),
        text: id ? itemName(theme, id) : t("gs_slot_empty"),
        onclick: function () { ui.slots[i] = null; ui.junkWarn = null; render(); } });
    }
    var ready = ui.slots[0] && ui.slots[1];
    var w = ui.junkWarn;
    var actions = w ? el("div", { id: "gs-junk-warn", class: "gs-junk-warn" }, [
      el("p", { text: w.junkMaterial ? t("gs_junk_warn_material")
        : t("gs_junk_warn_seen", { r: itemName(theme, w.result) }) }),
      el("div", { class: "gs-actions" }, [
        el("button", { id: "gs-combine-anyway", type: "button", text: t("gs_junk_warn_go"), onclick: function () { doCombine(true); } }),
        el("button", { id: "gs-junk-warn-cancel", type: "button", class: "gs-primary", text: t("gs_junk_warn_change"),
          onclick: function () { ui.slots = [null, null]; ui.junkWarn = null; render(); } })
      ])
    ]) : el("div", { class: "gs-actions" }, [
      el("button", { id: "gs-combine", type: "button", class: "gs-primary", disabled: !ready, text: t("gs_combine"), onclick: function () { doCombine(false); } }),
      el("button", { id: "gs-clear", type: "button", text: t("gs_clear"), onclick: function () { ui.slots = [null, null]; render(); } })
    ]);
    return el("div", { class: "gs-panel gs-workbench" }, [
      el("div", { class: "gs-slots" }, [slot(0), el("span", { class: "gs-plus", text: "＋" }), slot(1)]),
      actions
    ]);
  }

  // force＝false 時，已知會合出廢料的組合先提示（見 Core.knownJunk）；語音模式一律直接合成
  function doCombine(force) {
    var theme = themes[state.themeId];
    ui.confirmNew = false;
    if (!force) {
      var known = Core.knownJunk(theme, state, ui.slots[0], ui.slots[1]);
      if (known) { ui.junkWarn = known; render(); return; }
    }
    ui.junkWarn = null;
    var res = Core.applyCombine(theme, state, ui.slots[0], ui.slots[1]);
    state = res.state;
    ui.lastEntry = res.entry;
    ui.slots = [null, null];
    ui.revealedFor = null;
    save();
    render();
  }

  function pickItem(id) {
    if (ui.lastEntry || state.winner) return;
    ui.confirmNew = false;
    ui.junkWarn = null;
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
      var picked = ui.slots[0] === id || ui.slots[1] === id;
      // 編號＝池子順序（1 起算），語音可以說「3 加 7」
      list.appendChild(el("button", { type: "button", class: "gs-item gs-cat-" + theme.byId[id].cat + (picked ? " gs-picked" : ""), "data-item": id,
        onclick: function () { pickItem(id); } }, [
        el("span", { class: "gs-item-no", text: String(state.pool.indexOf(id) + 1) }), itemName(theme, id)
      ]));
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
    var junkCount = state.pool.filter(function (id) { return theme.junkSet[id]; }).length;
    return el("div", { id: "gs-pool", class: "gs-panel gs-pool" }, [
      el("div", { class: "gs-pool-head" }, [
        el("h2", { text: t("gs_pool", { n: state.pool.length }) }),
        junkCount && !state.winner ? el("button", { id: "gs-clear-junk", type: "button", text: t("gs_clear_junk", { n: junkCount }),
          onclick: function () {
            state = Core.clearJunk(theme, state);
            ui.junkWarn = null;
            if (theme.junkSet[ui.slots[0]]) ui.slots[0] = null;
            if (theme.junkSet[ui.slots[1]]) ui.slots[1] = null;
            if (!ui.slots[0] && ui.slots[1]) ui.slots = [ui.slots[1], null];
            save();
            render();
          } }) : null
      ]),
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
        // 復原後所有任務一律收起，避免上一位的任務被下一位看到
        resetTurnUi();
        save();
        render();
      } }),
      state.mode === "split" ? el("button", { id: "gs-show-qr", type: "button", text: t("gs_qr_button"),
        onclick: function () { ui.screen = "qr"; ui.qrFor = null; render(); } }) : null,
      el("button", { id: "gs-new-game", type: "button", text: ui.confirmNew ? t("gs_new_game_confirm") : t("gs_new_game"),
        onclick: function () {
          if (!ui.confirmNew) { ui.confirmNew = true; render(); return; }
          state = null;
          ui.cat = "all";
          ui.search = "";
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
    app.appendChild(renderVoiceBar());
    if (ui.lastEntry) app.appendChild(renderResult(theme));
    else if (!state.winner) app.appendChild(renderSlots(theme));
    if (!state.winner) app.appendChild(renderPool(theme));
    // 同一裝置：池子下方可展開各玩家的任務（含進度）；分別裝置：任務在手機上，這裡只顯示進度
    if (state.mode === "shared" && !state.winner) {
      app.appendChild(el("div", { class: "gs-panel" }, [el("h2", { text: t("gs_player_targets_heading") }), playerTargetsList(theme)]));
    } else {
      app.appendChild(progressPanel());
    }
    app.appendChild(renderLog(theme));
    app.appendChild(renderFooter());
  }

  // ---------------- 分別裝置：QR 畫面 ----------------
  // 一次只顯示一位玩家的 QR，避免別人順便掃到。手機端只靠 主題.seed.人數.編號 自己算任務。

  function joinUrl(index) {
    return window.location.origin + window.location.pathname + "?join=" + Core.joinParam(state, index);
  }

  function renderQrScreen() {
    var box = el("div", { id: "gs-qr-screen", class: "gs-panel" }, [
      el("h2", { text: t("gs_join_heading") }),
      el("p", { class: "gs-muted", text: t("gs_seed", { seed: state.seed }) })
    ]);
    var buttons = el("div", { class: "gs-actions" });
    state.players.forEach(function (p, i) {
      var showing = ui.qrFor === i;
      buttons.appendChild(el("button", { type: "button", "data-qr-player": String(i), class: showing ? "gs-primary" : "",
        text: showing ? t("gs_join_hide") : t("gs_join_show", { name: p.name }),
        onclick: function () { ui.qrFor = showing ? null : i; render(); } }));
    });
    box.appendChild(buttons);
    if (ui.qrFor !== null) {
      var url = joinUrl(ui.qrFor);
      var canvas = el("canvas", { id: "gs-qr-canvas", class: "gs-qr" });
      window.PriTestQRCode.renderToCanvas(canvas, url, { level: "L", scale: 6, margin: 3 });
      box.appendChild(el("p", { class: "gs-big", text: state.players[ui.qrFor].name }));
      box.appendChild(canvas);
      box.appendChild(el("input", { id: "gs-qr-url", type: "text", readonly: true, value: url, class: "gs-qr-url" }));
    }
    box.appendChild(el("div", { class: "gs-actions" }, [
      el("button", { id: "gs-qr-continue", type: "button", class: "gs-primary", text: t("gs_join_continue"),
        onclick: function () { ui.screen = "play"; ui.qrFor = null; render(); } })
    ]));
    app.appendChild(box);
  }

  // ---------------- 分別裝置：手機看任務頁（?join=） ----------------

  function renderJoin() {
    if (join.invalid) {
      app.appendChild(el("p", { id: "gs-join", class: "gs-error", text: t("gs_join_invalid") }));
      return;
    }
    var theme = themes[join.themeId];
    if (!theme) {
      app.appendChild(el("p", { class: "gs-muted", text: ui.error || t("gs_loading") }));
      return;
    }
    var targets;
    try {
      targets = Core.dealTargets(theme, join.seed, join.count)[join.index];
    } catch (e) {
      app.appendChild(el("p", { id: "gs-join", class: "gs-error", text: t("gs_join_invalid") }));
      return;
    }
    var player = { name: "", targets: targets, done: [] };
    var box = el("div", { id: "gs-join", class: "gs-panel" }, [
      el("h2", { text: t("gs_join_title") }),
      el("p", { class: "gs-muted", text: t("gs_join_player", { n: join.index + 1, count: join.count }) + "　" + t("gs_seed", { seed: join.seed }) }),
      el("button", { id: "gs-join-toggle", type: "button", text: t(ui.revealed ? "gs_hide_targets" : "gs_show_targets"),
        onclick: function () { ui.revealed = !ui.revealed; render(); } })
    ]);
    if (ui.revealed) box.appendChild(targetList(theme, player, "gs-join-targets"));
    box.appendChild(el("p", { class: "gs-muted", text: t("gs_hint") }));
    app.appendChild(box);
  }

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
    if (ui.screen === "qr") renderQrScreen(theme);
    else if (state.confirm) renderConfirm(theme);
    else renderPlay(theme);
    voiceSync();
  }

  // ---------------- 語音模式 ----------------
  // 朗讀：speechSynthesis；辨識：SpeechRecognition（Chrome／Edge，需 https 或 localhost）。
  // 物體名稱沒有英文，en 介面也用日文辨識與朗讀。
  // 朗讀中喇叭的聲音可能被麥克風收到：朗讀中只接受有 yo 開頭的喚醒詞（Core.detectWake 的 strict），
  //   等待指令時則忽略朗讀中的辨識結果。

  var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  var VOICE_REPEAT_MS = 60000;
  var VOICE_COMMAND_MS = 10000;
  var VOICE_ADVANCE_FALLBACK_MS = 20000;
  var VOICE_POOL_CHUNK = 15;
  var WAKE_STORE_KEY = "pritest-gousei-wake";
  var WAKE_TRAIN_COUNT = 3;
  var WAKE_TEMPLATE_LIMIT = 30;
  var voice = { on: false, rec: null, audio: null, speaking: false, speakToken: 0, turnKey: null, spokenEntry: null, training: null, pending: null, pendingTimer: null,
    repeatTimer: null, awaitUntil: 0, awaitTimer: null, advanceTimer: null, status: "", heard: "", error: "" };

  function voiceSupported() { return !!(SpeechRec && window.speechSynthesis); }
  function speechLang() { return lang() === "zh" ? "zh-TW" : "ja-JP"; }

  function setVoiceStatus(text) {
    voice.status = text;
    var node = document.getElementById("gs-voice-status");
    if (node) node.textContent = text;
  }

  function setVoiceHeard(text) {
    voice.heard = text;
    var node = document.getElementById("gs-voice-heard");
    if (node) node.textContent = text ? t("gs_voice_heard", { text: text }) : "";
  }

  function renderVoiceBar() {
    return el("div", { id: "gs-voice", class: "gs-panel gs-voice" + (voice.on ? " gs-voice-on" : "") }, [
      el("div", { class: "gs-actions" }, [
        el("button", { id: "gs-voice-toggle", type: "button", class: voice.on ? "gs-primary" : "", disabled: !voiceSupported(),
          text: t(voice.on ? "gs_voice_off" : "gs_voice_on"),
          onclick: function () { if (voice.on) voiceStop(); else voiceStart(); render(); } }),
        el("span", { id: "gs-voice-status", class: "gs-voice-status", text: voice.on ? voice.status : "" })
      ]),
      voice.on ? el("div", { class: "gs-actions" }, [
        el("button", { id: "gs-voice-train", type: "button", text: t(voice.training ? "gs_voice_train_cancel" : "gs_voice_train"),
          onclick: function () { if (voice.training) stopTraining(); else startTraining(); } }),
        wakeTemplates().length && !voice.training ? el("button", { id: "gs-voice-train-clear", type: "button",
          text: t("gs_voice_train_clear"), onclick: function () { saveWakeTemplates([]); render(); } }) : null,
        el("span", { class: "gs-muted", text: wakeTemplates().length ? t("gs_voice_trained", { n: wakeTemplates().length }) : t("gs_voice_untrained") })
      ]) : null,
      voice.on && voice.pending ? el("div", { class: "gs-actions" }, [
        el("button", { id: "gs-voice-yes", type: "button", class: "gs-primary", text: t("gs_voice_yes"), onclick: function () { answerConfirm(true); } }),
        el("button", { id: "gs-voice-no", type: "button", text: t("gs_voice_no"), onclick: function () { answerConfirm(false); } })
      ]) : null,
      // 喚醒詞叫不出來時的備用：按按鈕或空白鍵直接等「A 加 B」
      voice.on && voiceReady() && !voice.pending ? el("button", { id: "gs-voice-talk", type: "button", class: "gs-primary gs-voice-talk",
        text: t("gs_voice_talk"), onclick: talkNow }) : null,
      el("p", { id: "gs-voice-heard", class: "gs-muted", text: voice.on && voice.heard ? t("gs_voice_heard", { text: voice.heard }) : "" }),
      voice.error ? el("p", { class: "gs-error", text: voice.error })
        : (voiceSupported() ? null : el("p", { class: "gs-muted", text: t("gs_voice_unsupported") }))
    ]);
  }

  function pickVoice() {
    var want = speechLang().toLowerCase();
    var list = window.speechSynthesis.getVoices() || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].lang).toLowerCase().replace("_", "-") === want) return list[i];
    var base = want.split("-")[0];
    for (var j = 0; j < list.length; j++) if (String(list[j].lang).toLowerCase().indexOf(base) === 0) return list[j];
    return null;
  }

  // 依序朗讀多段（長文分段，避免 Chrome 長句朗讀中途停掉）。新的朗讀會取消舊的（speakToken）。
  function speak(parts, onDone) {
    var synth = window.speechSynthesis;
    var token = ++voice.speakToken;
    synth.cancel();
    var i = 0;
    voice.speaking = true;
    function next() {
      if (token !== voice.speakToken || !voice.on) return;
      if (i >= parts.length) {
        voice.speaking = false;
        if (onDone) onDone();
        return;
      }
      var u = new SpeechSynthesisUtterance(parts[i++]);
      u.lang = speechLang();
      var v = pickVoice();
      if (v) u.voice = v;
      u.onend = next;
      u.onerror = next;
      synth.speak(u);
    }
    next();
  }

  function stopSpeaking() {
    voice.speakToken++;
    voice.speaking = false;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function beep() {
    try {
      var ctx = voice.audio;
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) { /* 沒有音效也能玩 */ }
  }

  function clearVoiceTimers() {
    clearTimeout(voice.repeatTimer);
    clearTimeout(voice.awaitTimer);
    clearTimeout(voice.advanceTimer);
    clearTimeout(voice.pendingTimer);
    voice.awaitUntil = 0;
    voice.pending = null;
  }

  function startRecognition() {
    if (!voice.on || voice.rec) return;
    var rec = new SpeechRec();
    rec.lang = speechLang();
    rec.continuous = true;
    // 即時結果只用來提早偵測喚醒詞（先響提示音），指令一律等最終結果
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.onresult = function (ev) {
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var alts = [];
        for (var k = 0; k < ev.results[i].length; k++) alts.push(ev.results[i][k].transcript);
        onHeard(alts, ev.results[i].isFinal);
      }
    };
    rec.onerror = function (ev) {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        voiceStop();
        voice.error = t("gs_voice_denied");
        render();
      }
    };
    // 無聲一陣子後瀏覽器會自己結束辨識：語音模式還開著就重開（切換語言時也靠這裡換 lang）
    rec.onend = function () {
      if (voice.rec === rec) voice.rec = null;
      if (voice.on) setTimeout(startRecognition, 300);
    };
    voice.rec = rec;
    try { rec.start(); } catch (e) { voice.rec = null; }
  }

  function voiceStart() {
    if (!voiceSupported()) return;
    voice.on = true;
    voice.error = "";
    voice.turnKey = null;
    voice.spokenEntry = ui.lastEntry;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !voice.audio) voice.audio = new Ctx();
      if (voice.audio && voice.audio.state === "suspended") voice.audio.resume();
    } catch (e) { voice.audio = null; }
    loadPinyin();
    startRecognition();
  }

  // 拼音表（同音字比對用）很大，開啟語音模式時才載入；載入失敗只是退回字面比對
  var pinyinState = "none";
  function loadPinyin() {
    if (pinyinState !== "none") return;
    function ready() {
      if (!window.PriTestGouseiPinyin) { pinyinState = "none"; return; }
      Core.setPinyin(window.PriTestGouseiPinyin);
      pinyinState = "ready";
    }
    if (window.PriTestGouseiPinyin) { ready(); return; }
    var src = app.getAttribute("data-src-pinyin");
    if (!src) return;
    pinyinState = "loading";
    var tag = document.createElement("script");
    tag.src = src;
    tag.onload = ready;
    tag.onerror = function () { pinyinState = "none"; };
    document.head.appendChild(tag);
  }

  function voiceStop() {
    voice.on = false;
    voice.training = null;
    clearVoiceTimers();
    stopSpeaking();
    voice.turnKey = null;
    voice.status = "";
    voice.heard = "";
    var rec = voice.rec;
    voice.rec = null;
    if (rec) { try { rec.abort(); } catch (e) { /* 已停止 */ } }
  }

  function voiceReady() {
    return voice.on && !voice.training && state && !join && !state.confirm && ui.screen === "play" && !ui.lastEntry && !state.winner &&
      !!themes[state.themeId];
  }

  function announceTurn() {
    var theme = themes[state.themeId];
    var p = Core.currentPlayer(state);
    var names = [];
    state.pool.forEach(function (id, i) { if (!theme.junkSet[id]) names.push((i + 1) + " " + itemName(theme, id)); });
    var parts = [t("gs_voice_turn", { name: p.name }), t("gs_voice_pool", { n: names.length })];
    for (var i = 0; i < names.length; i += VOICE_POOL_CHUNK) parts.push(names.slice(i, i + VOICE_POOL_CHUNK).join("、"));
    parts.push(t("gs_voice_how"));
    clearTimeout(voice.repeatTimer);
    setVoiceStatus(t("gs_voice_reading"));
    speak(parts, function () {
      setVoiceStatus(t("gs_voice_listening"));
      scheduleRepeat();
    });
  }

  // 每一分鐘重複朗讀；正在等指令時延後
  function scheduleRepeat() {
    clearTimeout(voice.repeatTimer);
    voice.repeatTimer = setTimeout(function () {
      if (!voiceReady()) return;
      if (voice.awaitUntil > Date.now() || voice.pending) { scheduleRepeat(); return; }
      announceTurn();
    }, VOICE_REPEAT_MS);
  }

  function speakResult() {
    var theme = themes[state.themeId];
    var e = ui.lastEntry;
    var status = theme.junkSet[e.result] ? t("gs_result_junk") : (e.isNew ? t("gs_result_new") : t("gs_result_old"));
    var parts = [t("gs_voice_result", { a: itemName(theme, e.a), b: itemName(theme, e.b), r: itemName(theme, e.result) }), status];
    var p = playerById(e.playerId);
    if (e.achieved) parts.push(t("gs_achieved", { done: p.done.length, total: p.targets.length }));
    if (state.winner) parts.push(t("gs_winner", { name: playerById(state.winner).name }));
    setVoiceStatus("");
    // 念完自動換下一位（語音模式不必按「下一位」）；朗讀事件沒觸發時以計時器保底
    function advance() {
      clearTimeout(voice.advanceTimer);
      if (ui.lastEntry === e && !state.winner) nextTurn();
    }
    if (!state.winner) voice.advanceTimer = setTimeout(advance, VOICE_ADVANCE_FALLBACK_MS);
    speak(parts, advance);
  }

  // 每次 render 後呼叫：輪到的人（或語言）變了就朗讀；出現新的合成結果就念結果
  function voiceSync() {
    if (!voice.on || voice.training) return;
    if (!state || join || state.confirm || ui.screen !== "play" || !themes[state.themeId]) {
      clearVoiceTimers();
      stopSpeaking();
      voice.turnKey = null;
      return;
    }
    if (ui.lastEntry) {
      if (voice.spokenEntry !== ui.lastEntry) {
        voice.spokenEntry = ui.lastEntry;
        voice.turnKey = null;
        clearVoiceTimers();
        speakResult();
      }
      return;
    }
    if (state.winner) return;
    var key = lang() + ":" + state.round + ":" + state.turn + ":" + state.log.length;
    if (key === voice.turnKey) return;
    voice.turnKey = key;
    clearVoiceTimers();
    announceTurn();
  }

  function waitCommand() {
    clearTimeout(voice.awaitTimer);
    voice.awaitUntil = Date.now() + VOICE_COMMAND_MS;
    setVoiceStatus(t("gs_voice_say_combo"));
    beep();
    voice.awaitTimer = setTimeout(function () {
      voice.awaitUntil = 0;
      if (voiceReady()) setVoiceStatus(t("gs_voice_listening"));
    }, VOICE_COMMAND_MS);
  }

  function tryVoiceCombo(texts) {
    var theme = themes[state.themeId];
    var best = null;
    texts.forEach(function (tx) {
      var r = Core.parseVoiceCombo(theme, state.pool, tx);
      if (r && (!best || r.score > best.score)) best = r;
    });
    if (!best) return false;
    clearVoiceTimers();
    // 語音比對本來就排除廢料，所以這裡只會遇到「合過的組合合出廢料」
    var known = Core.knownJunk(theme, state, best.a, best.b);
    if (best.exact && !known) {
      ui.slots = [best.a, best.b];
      doCombine(true);
    } else {
      askConfirm(best, known);
    }
    return true;
  }

  // 只靠讀音或近似比對的結果：先問「A 加 B，對嗎？」，說「對」才合成。
  // 合過會變廢料的組合改問「之前合過，結果是廢料 X，還要合成嗎？」（與讀音確認合併成一句，不問兩次）
  function askConfirm(pick, known) {
    var theme = themes[state.themeId];
    var names = { a: itemName(theme, pick.a), b: itemName(theme, pick.b) };
    var junk = known && known.result;
    if (junk) names.r = itemName(theme, junk);
    voice.pending = { a: pick.a, b: pick.b };
    voice.status = t(junk ? "gs_voice_junk_status" : "gs_voice_confirm_status", names);
    render();
    speak([t(junk ? "gs_voice_junk_q" : "gs_voice_confirm_q", names)], function () {
      if (!voice.pending) return;
      beep();
      clearTimeout(voice.pendingTimer);
      voice.pendingTimer = setTimeout(function () {
        voice.pending = null;
        if (voiceReady()) { setVoiceStatus(t("gs_voice_listening")); render(); scheduleRepeat(); }
      }, VOICE_COMMAND_MS);
    });
  }

  function answerConfirm(yes) {
    var p = voice.pending;
    if (!p) return;
    clearVoiceTimers();
    stopSpeaking();
    if (yes) {
      ui.slots = [p.a, p.b];
      doCombine(true);
    } else {
      render();
      retryCommand("gs_voice_again");
    }
  }

  function talkNow() {
    if (!voiceReady()) return;
    stopSpeaking();
    clearTimeout(voice.pendingTimer);
    voice.pending = null;
    waitCommand();
  }

  function retryCommand(key) {
    clearTimeout(voice.awaitTimer);
    voice.awaitUntil = 0;
    setVoiceStatus(t(key || "gs_voice_retry"));
    speak([t(key || "gs_voice_retry")], waitCommand);
  }

  // ---- 喚醒詞訓練 ----
  // 辨識器把「yo アキ」寫成什麼因人、因裝置而異（幼兒體、有阿基…）。讓玩家說幾次，記住實際的辨識結果，
  // 之後以拼音距離比對（Core.detectWake 的 templates）。依辨識語言分開存在這台瀏覽器（localStorage）。
  // 也可以藉此換成任何好辨識的詞（例如「開始合成」）。

  function loadWakeStore() {
    try {
      var o = JSON.parse(localStorage.getItem(WAKE_STORE_KEY) || "{}");
      return o && typeof o === "object" ? o : {};
    } catch (e) {
      return {};
    }
  }

  function wakeTemplates() {
    var list = loadWakeStore()[speechLang()];
    return Array.isArray(list) ? list : [];
  }

  function saveWakeTemplates(list) {
    var store = loadWakeStore();
    if (list.length) store[speechLang()] = list.slice(-WAKE_TEMPLATE_LIMIT);
    else delete store[speechLang()];
    try { localStorage.setItem(WAKE_STORE_KEY, JSON.stringify(store)); } catch (e) { /* 私密模式等：只是記不住 */ }
  }

  function startTraining() {
    if (!voice.on) return;
    clearVoiceTimers();
    stopSpeaking();
    voice.training = { samples: [], count: 0 };
    voice.heard = "";
    voice.status = t("gs_voice_train_step", { n: 1, total: WAKE_TRAIN_COUNT });
    beep();
    render();
  }

  function stopTraining() {
    voice.training = null;
    voice.status = "";
    voice.turnKey = null; // 回到遊戲後重新朗讀輪到誰
    render();
  }

  function trainSample(alts) {
    var tr = voice.training;
    // 只取前兩個候選：後面的候選常是無關的字，收進來會增加誤觸
    alts.slice(0, 2).forEach(function (a) {
      var n = Core.normSpeech(a);
      if (n && tr.samples.indexOf(n) < 0) tr.samples.push(n);
    });
    tr.count += 1;
    if (tr.count < WAKE_TRAIN_COUNT) {
      setVoiceStatus(t("gs_voice_train_step", { n: tr.count + 1, total: WAKE_TRAIN_COUNT }));
      beep();
      return;
    }
    var list = wakeTemplates();
    tr.samples.forEach(function (n) { if (list.indexOf(n) < 0) list.push(n); });
    saveWakeTemplates(list);
    voice.training = null;
    voice.turnKey = null;
    voice.heard = "";
    voice.status = t("gs_voice_train_done", { list: tr.samples.join("、") });
    render();
  }

  function onHeard(alts, isFinal) {
    if (voice.on && voice.training) {
      setVoiceHeard(alts[0]);
      if (isFinal !== false) trainSample(alts);
      return;
    }
    if (!voiceReady()) return;
    setVoiceHeard(alts[0]);
    if (voice.pending) {
      if (isFinal === false || voice.speaking) return; // 提問本身的回音
      for (var i = 0; i < alts.length; i++) {
        var yn = Core.parseYesNo(alts[i]);
        if (yn !== null) { answerConfirm(yn); return; }
      }
      tryVoiceCombo(alts); // 直接說了新的組合也可以
      return;
    }
    var awaiting = voice.awaitUntil > Date.now();
    if (isFinal === false) {
      // 即時結果：一聽到喚醒詞就打斷朗讀、響提示音
      if (!awaiting && Core.detectWake(alts[0], voice.speaking, wakeTemplates())) talkNow();
      return;
    }
    var rests = [];
    alts.forEach(function (a) {
      var w = Core.detectWake(a, voice.speaking && !awaiting, wakeTemplates());
      if (w) rests.push(w.rest);
    });
    if (awaiting) {
      if (voice.speaking) return; // 「請再說一次」的回音
      // 即時結果已響過提示音時，最終結果可能還帶著喚醒詞：只取後面的部分
      var texts = rests.length ? rests.filter(function (r) { return r; }) : alts;
      if (!texts.length) return; // 只有喚醒詞：繼續等指令
      if (!tryVoiceCombo(texts)) retryCommand();
      return;
    }
    if (!rests.length) return;
    stopSpeaking();
    // 「yo アキ 火加水」一口氣說完也可以
    var said = rests.filter(function (r) { return r; });
    if (said.length && tryVoiceCombo(said)) return;
    waitCommand();
  }

  function init() {
    var params = new URLSearchParams(window.location.search);
    if (params.has("join")) {
      join = Core.parseJoin(params.get("join")) || { invalid: true };
      if (!join.invalid) {
        loadTheme(join.themeId, function (err) {
          if (err) join = { invalid: true };
          render();
        });
      }
      render();
      return;
    }
    state = load();
    if (state) {
      loadTheme(state.themeId, function (err) {
        if (err) ui.error = t("gs_load_failed");
        render();
      });
    }
    render();
  }

  // 空白鍵＝按住說話（輸入框裡不攔）
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== " " || !voiceReady()) return;
    var tag = ev.target && ev.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
    ev.preventDefault();
    talkNow();
  });

  window.addEventListener("i18n:change", function () {
    // 辨識語言跟著介面切換：abort 後 onend 會用新的 lang 重開
    if (voice.rec) { try { voice.rec.abort(); } catch (e) { /* 已停止 */ } }
    render();
  });
  window.PriTestGousei = {
    _debugState: function () { return state ? JSON.parse(JSON.stringify(state)) : null; },
    _theme: function () { return state ? themes[state.themeId] : null; },
    // 測試用：模擬一次語音辨識結果（候選字串陣列）
    _voiceHeard: function (alts, isFinal) { onHeard(alts, isFinal !== false); },
    _pinyinReady: function () { return pinyinState === "ready"; },
    _wakeTemplates: function () { return wakeTemplates(); },
    _voiceOn: function () { return voice.on; }
  };
  init();
})();
