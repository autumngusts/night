// 我不會唱歌（utau）UI。規則全部在 utau_core.js，這裡只負責畫面、輸入與存讀檔。
// 題目遮蔽（ui.revealed）刻意不存進 state：重新整理後回到遮蔽畫面，避免其他人看到題目。
(function () {
  "use strict";

  var Songs = window.PriTestUtauSongs;
  var Core = window.PriTestUtauCore;
  var STORAGE_KEY = "pritest-utau-state";
  var CONFIG_KEY = "pritest-utau-config";
  var MIN_PLAYERS = 2;
  var MAX_PLAYERS = 12;
  var app = document.getElementById("ut-app");
  if (!app) return;

  var state = null;
  var draft = null; // 設定畫面的草稿
  var ui = { revealed: false, aiCorrect: false, correct: {}, error: "" };

  function t(key, params) { return window.I18N.t(key, params); }
  function lang() { return window.I18N.getLang(); }
  function lt(obj) { return Songs.text(obj, lang()); }

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

  function fmtDelta(n) { return (n > 0 ? "+" : "") + n; }

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
      if (!s || s.version !== 1 || !s.config || !s.current) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  // 上一次的設定（回到設定畫面時沿用）
  function saveConfig(config) {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch (e) { /* 忽略 */ }
  }

  function loadConfig() {
    try {
      var raw = localStorage.getItem(CONFIG_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function resetRoundUi() {
    ui.revealed = false;
    ui.aiCorrect = false;
    ui.correct = {};
    ui.error = "";
  }

  function commit(next) {
    state = next;
    resetRoundUi();
    save();
    render();
    window.scrollTo(0, 0);
  }

  // ---------------- 設定畫面 ----------------

  function newDraft() {
    var prev = loadConfig();
    if (prev && prev.players && prev.players.length >= MIN_PLAYERS) {
      return {
        mode: prev.mode === "advanced" ? "advanced" : "basic",
        names: prev.players.map(function (p) { return p.name; }),
        aiBonus: prev.aiBonus,
        scoreTable: prev.scoreTable.slice(),
        regions: (prev.regions || []).slice(),
        decades: (prev.decades || []).slice(),
        categories: (prev.categories || allCategories()).slice(),
        styles: (prev.styles || []).slice()
      };
    }
    var count = 4;
    var names = [];
    for (var i = 0; i < count; i++) names.push("");
    return {
      mode: "basic",
      names: names,
      aiBonus: 1,
      scoreTable: Core.defaultScoreTable(count),
      regions: Songs.regions.map(function (r) { return r.id; }),
      decades: Songs.decades(),
      categories: allCategories(),
      styles: Songs.styles.map(function (s) { return s.id; })
    };
  }

  function allCategories() { return Songs.categories.map(function (c) { return c.id; }); }

  // 把某一個篩選條件換成單一值後的首數（勾選框旁邊的數字用）
  function countWith(field, value) {
    var cfg = { regions: draft.regions, decades: draft.decades, categories: draft.categories };
    cfg[field] = [value];
    return Core.songPool(cfg).length;
  }

  function setPlayerCount(n) {
    n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n));
    if (n === draft.names.length) return;
    while (draft.names.length < n) draft.names.push("");
    draft.names.length = n;
    // 人數變了，答對人數的列數也跟著變：計分表重設為預設值
    draft.scoreTable = Core.defaultScoreTable(n);
  }

  function playerName(i) {
    var raw = (draft.names[i] || "").trim();
    return raw || t("ut_player_default", { n: i + 1 });
  }

  function draftConfig() {
    return {
      mode: draft.mode,
      players: draft.names.map(function (_, i) { return { id: "p" + (i + 1), name: playerName(i) }; }),
      aiBonus: Number(draft.aiBonus) || 0,
      scoreTable: draft.scoreTable.map(function (v) { return Number(v) || 0; }),
      regions: draft.regions.slice(),
      decades: draft.decades.slice(),
      categories: draft.categories.slice(),
      styles: draft.styles.slice()
    };
  }

  function toggleIn(list, value) {
    var i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1);
    else list.push(value);
  }

  function checkbox(id, checked, label, onChange) {
    return el("label", { class: "ut-check" }, [
      el("input", { type: "checkbox", id: id, checked: checked, onchange: onChange }),
      label
    ]);
  }

  function numberInput(attrs, value, onInput) {
    var input = el("input", attrs);
    input.type = "number";
    input.value = String(value);
    input.addEventListener("input", function () { onInput(input.value); });
    return input;
  }

  function scoreRowLabel(k, guessers) {
    if (k === 0) return t("ut_score_all_wrong");
    if (k === guessers) return t("ut_score_all_right", { n: k });
    return t("ut_score_n_right", { n: k });
  }

  function renderSetup() {
    if (!draft) draft = newDraft();
    var box = el("div", { class: "ut-setup" });

    // 模式
    var modePanel = el("div", { class: "ut-panel" }, [el("h2", { text: t("ut_mode") })]);
    ["basic", "advanced"].forEach(function (m) {
      modePanel.appendChild(el("label", { class: "ut-radio" }, [
        el("input", { type: "radio", name: "ut-mode", id: "ut-mode-" + m, value: m, checked: draft.mode === m,
          onchange: function () { draft.mode = m; render(); } }),
        el("strong", { text: t("ut_mode_" + m) }),
        el("span", { class: "ut-muted", text: t("ut_mode_" + m + "_desc") })
      ]));
    });
    box.appendChild(modePanel);

    // 玩家
    var playerPanel = el("div", { class: "ut-panel" }, [el("h2", { text: t("ut_players") })]);
    playerPanel.appendChild(el("div", { class: "ut-field" }, [
      el("label", { for: "ut-player-count", text: t("ut_player_count") }),
      numberInput({ id: "ut-player-count", min: MIN_PLAYERS, max: MAX_PLAYERS }, draft.names.length, function () {}),
      el("span", { class: "ut-muted", text: t("ut_player_count_range", { min: MIN_PLAYERS, max: MAX_PLAYERS }) })
    ]));
    playerPanel.querySelector("#ut-player-count").addEventListener("change", function (ev) {
      setPlayerCount(parseInt(ev.target.value, 10) || MIN_PLAYERS);
      render();
    });
    var list = el("ol", { class: "ut-name-list" });
    draft.names.forEach(function (name, i) {
      var input = el("input", { type: "text", class: "ut-name-input", "data-index": i, maxlength: 20,
        placeholder: t("ut_player_default", { n: i + 1 }) });
      input.value = name;
      input.addEventListener("input", function () { draft.names[i] = input.value; });
      list.appendChild(el("li", null, [input]));
    });
    playerPanel.appendChild(list);
    box.appendChild(playerPanel);

    // 計分
    var guessers = draft.names.length - 1;
    var scorePanel = el("div", { class: "ut-panel" }, [
      el("h2", { text: t("ut_scoring") }),
      el("p", { class: "ut-muted", text: t("ut_scoring_note") })
    ]);
    scorePanel.appendChild(el("div", { class: "ut-field" }, [
      el("label", { for: "ut-ai-bonus", text: t("ut_ai_bonus") }),
      numberInput({ id: "ut-ai-bonus" }, draft.aiBonus, function (v) { draft.aiBonus = v; })
    ]));
    var table = el("table", { class: "ut-score-table" });
    for (var k = guessers; k >= 0; k--) {
      (function (k) {
        table.appendChild(el("tr", null, [
          el("th", { text: scoreRowLabel(k, guessers) }),
          el("td", null, [numberInput({ class: "ut-score-input", "data-k": k }, draft.scoreTable[k], function (v) {
            draft.scoreTable[k] = v;
          })])
        ]));
      })(k);
    }
    scorePanel.appendChild(table);
    scorePanel.appendChild(el("button", { type: "button", id: "ut-btn-score-default", text: t("ut_btn_score_default"),
      onclick: function () { draft.scoreTable = Core.defaultScoreTable(draft.names.length); render(); } }));
    box.appendChild(scorePanel);

    // 進階：歌單篩選
    if (draft.mode === "advanced") {
      var adv = el("div", { class: "ut-panel" }, [el("h2", { text: t("ut_song_filter") })]);
      var regionRow = el("div", { class: "ut-field" }, [el("span", { class: "ut-label", text: t("ut_regions") })]);
      Songs.regions.forEach(function (r) {
        regionRow.appendChild(checkbox("ut-region-" + r.id, draft.regions.indexOf(r.id) >= 0,
          t("ut_with_count", { label: lt(r.name), n: countWith("regions", r.id) }), function () {
          toggleIn(draft.regions, r.id); render();
        }));
      });
      adv.appendChild(regionRow);
      var decadeRow = el("div", { class: "ut-field" }, [el("span", { class: "ut-label", text: t("ut_decades") })]);
      Songs.decades().forEach(function (d) {
        decadeRow.appendChild(checkbox("ut-decade-" + d, draft.decades.indexOf(d) >= 0,
          t("ut_with_count", { label: t("ut_decade", { d: d }), n: countWith("decades", d) }), function () {
          toggleIn(draft.decades, d); render();
        }));
      });
      adv.appendChild(decadeRow);
      var catRow = el("div", { class: "ut-field" }, [el("span", { class: "ut-label", text: t("ut_categories") })]);
      Songs.categories.forEach(function (c) {
        catRow.appendChild(checkbox("ut-cat-" + c.id, draft.categories.indexOf(c.id) >= 0,
          t("ut_with_count", { label: lt(c.name), n: countWith("categories", c.id) }), function () {
            toggleIn(draft.categories, c.id); render();
          }));
      });
      adv.appendChild(catRow);
      var styleRow = el("div", { class: "ut-field" }, [el("span", { class: "ut-label", text: t("ut_styles") })]);
      Songs.styles.forEach(function (s) {
        styleRow.appendChild(checkbox("ut-style-" + s.id, draft.styles.indexOf(s.id) >= 0, lt(s.name), function () {
          toggleIn(draft.styles, s.id); render();
        }));
      });
      adv.appendChild(styleRow);
      var poolSize = Core.songPool(draft).length;
      adv.appendChild(el("p", { id: "ut-pool-size", class: poolSize ? "ut-muted" : "ut-error",
        text: t("ut_pool_size", { n: poolSize }) }));
      box.appendChild(adv);
    }

    box.appendChild(el("p", { class: "ut-error", text: ui.error }));
    box.appendChild(el("div", { class: "ut-actions" }, [
      el("button", { type: "button", id: "ut-btn-start", class: "ut-primary", text: t("ut_btn_start"),
        onclick: function () {
          var config = draftConfig();
          var next;
          try {
            next = Core.createGame(config);
          } catch (e) {
            ui.error = t(e.message);
            render();
            return;
          }
          saveConfig(config);
          draft = null;
          commit(next);
        } })
    ]));
    return box;
  }

  // ---------------- 遊戲畫面 ----------------

  function nameOf(id) {
    var players = state.config.players;
    for (var i = 0; i < players.length; i++) if (players[i].id === id) return players[i].name;
    return id;
  }

  function songLine(songId, styleId) {
    var song = Songs.byId(songId);
    if (!song) return "";
    var line = t("ut_song_line", { title: song.t, artist: song.a, year: song.y });
    var style = Songs.style(styleId);
    return style ? line + t("ut_style_suffix", { style: lt(style.name) }) : line;
  }

  function renderTopic() {
    var cur = state.current;
    var singer = nameOf(cur.singerId);
    var panel = el("div", { class: "ut-panel ut-topic", id: "ut-topic" });
    if (state.config.mode !== "advanced") {
      panel.appendChild(el("p", { text: t("ut_basic_hint", { name: singer }) }));
      return panel;
    }
    if (!ui.revealed) {
      panel.appendChild(el("p", { text: t("ut_pass_device", { name: singer }) }));
      panel.appendChild(el("button", { type: "button", id: "ut-btn-reveal", class: "ut-primary",
        text: t("ut_btn_reveal", { name: singer }), onclick: function () { ui.revealed = true; render(); } }));
      return panel;
    }
    var song = Songs.byId(cur.songId);
    var style = Songs.style(cur.style);
    var region = song ? Songs.region(song.r) : null;
    var category = song ? Songs.category(song.c) : null;
    panel.appendChild(el("div", { class: "ut-song-card", id: "ut-song-card" }, [
      el("div", { class: "ut-song-title", text: song ? song.t : "" }),
      el("div", { class: "ut-song-meta", text: song ? song.a + "（" + song.y + (region ? "・" + lt(region.name) : "") + (category ? "・" + lt(category.name) : "") + "）" : "" }),
      style ? el("div", { class: "ut-style-badge", text: lt(style.name) }) : null,
      style ? el("p", { class: "ut-style-desc", text: lt(style.desc) }) : null
    ]));
    panel.appendChild(el("div", { class: "ut-actions" }, [
      el("button", { type: "button", id: "ut-btn-redraw", text: t("ut_btn_redraw"),
        onclick: function () { state = Core.redrawSong(state); save(); render(); } }),
      el("button", { type: "button", id: "ut-btn-hide", class: "ut-primary", text: t("ut_btn_hide"),
        onclick: function () { ui.revealed = false; render(); } })
    ]));
    return panel;
  }

  function correctIds() {
    return Object.keys(ui.correct).filter(function (id) { return ui.correct[id]; });
  }

  function renderJudge() {
    var cur = state.current;
    var panel = el("div", { class: "ut-panel ut-judge" }, [el("h2", { text: t("ut_judge_heading") })]);

    panel.appendChild(el("div", { class: "ut-field" }, [
      el("span", { class: "ut-label", text: t("ut_ai_question") }),
      el("button", { type: "button", id: "ut-btn-ai", class: "ut-toggle" + (ui.aiCorrect ? " ut-on" : ""),
        "aria-pressed": ui.aiCorrect ? "true" : "false",
        text: ui.aiCorrect ? t("ut_ai_on") : t("ut_ai_off"),
        onclick: function () { ui.aiCorrect = !ui.aiCorrect; render(); } })
    ]));

    panel.appendChild(el("p", { class: "ut-label", text: t("ut_who_correct") }));
    var row = el("div", { class: "ut-toggle-row" });
    state.config.players.forEach(function (p) {
      if (p.id === cur.singerId) return;
      var on = !!ui.correct[p.id];
      row.appendChild(el("button", { type: "button", class: "ut-toggle ut-player-toggle" + (on ? " ut-on" : ""),
        "data-player": p.id, "aria-pressed": on ? "true" : "false", text: (on ? "✔ " : "") + p.name,
        onclick: function () { ui.correct[p.id] = !on; render(); } }));
    });
    panel.appendChild(row);

    var deltas = Core.computeDeltas(state.config, cur.singerId, ui.aiCorrect, correctIds());
    var parts = state.config.players.filter(function (p) { return deltas[p.id] !== 0; }).map(function (p) {
      return p.name + " " + fmtDelta(deltas[p.id]);
    });
    panel.appendChild(el("p", { id: "ut-preview", class: "ut-preview",
      text: t("ut_preview", { list: parts.length ? parts.join(t("ut_list_sep")) : t("ut_no_points") }) }));

    panel.appendChild(el("button", { type: "button", id: "ut-btn-settle", class: "ut-primary", text: t("ut_btn_settle"),
      onclick: function () { commit(Core.settle(state, { aiCorrect: ui.aiCorrect, correctIds: correctIds() })); } }));
    return panel;
  }

  function historyText(h) {
    var names = h.correctIds.map(nameOf);
    var parts = [
      t("ut_hist_round", { n: h.round, name: nameOf(h.singerId) }),
      h.songId ? songLine(h.songId, h.style) : null,
      t("ut_hist_ai", { result: h.aiCorrect ? t("ut_ai_on") : t("ut_ai_off") }),
      t("ut_hist_correct", { list: names.length ? names.join(t("ut_list_sep")) : t("ut_nobody") })
    ];
    return parts.filter(Boolean).join(t("ut_hist_sep"));
  }

  function deltaText(h) {
    return state.config.players.filter(function (p) { return h.deltas[p.id] !== 0; }).map(function (p) {
      return p.name + " " + fmtDelta(h.deltas[p.id]);
    }).join(t("ut_list_sep")) || t("ut_no_points");
  }

  function renderLastRound() {
    var h = state.history[state.history.length - 1];
    if (!h) return null;
    return el("div", { class: "ut-panel ut-last", id: "ut-last-round" }, [
      el("h2", { text: t("ut_last_round") }),
      el("p", { text: historyText(h) }),
      el("p", { class: "ut-preview", text: deltaText(h) }),
      state.prev ? el("button", { type: "button", id: "ut-btn-undo", text: t("ut_btn_undo"),
        onclick: function () { commit(Core.undo(state)); } }) : null
    ]);
  }

  function renderScoreboard() {
    var rows = Core.ranking(state);
    var table = el("table", { class: "ut-board", id: "ut-scoreboard" }, [
      el("tr", null, [el("th", { text: t("ut_rank") }), el("th", { text: t("ut_name") }), el("th", { text: t("ut_score") })])
    ]);
    rows.forEach(function (r) {
      table.appendChild(el("tr", { class: state.current && r.id === state.current.singerId && !state.finished ? "ut-current" : null }, [
        el("td", { text: String(r.rank) }),
        el("td", { text: r.name }),
        el("td", { class: "ut-score-cell", "data-player": r.id, text: String(r.score) })
      ]));
    });
    return el("div", { class: "ut-panel" }, [el("h2", { text: t("ut_scoreboard") }), table]);
  }

  function renderHistory() {
    if (!state.history.length) return null;
    var list = el("ol", { class: "ut-history", reversed: true });
    state.history.slice().reverse().forEach(function (h) {
      list.appendChild(el("li", null, [historyText(h), el("br"), el("span", { class: "ut-muted", text: deltaText(h) })]));
    });
    return el("details", { class: "ut-panel" }, [el("summary", { text: t("ut_history", { n: state.history.length }) }), list]);
  }

  function renderGame() {
    var cur = state.current;
    var box = el("div", { class: "ut-game" });
    box.appendChild(el("div", { class: "ut-round-head" }, [
      el("h2", { id: "ut-round-title", text: t("ut_round_title", { n: state.round, name: nameOf(cur.singerId) }) }),
      el("p", { class: "ut-muted", text: t("ut_cycle_left", { n: state.queue.length }) })
    ]));
    [renderTopic(), renderJudge(), renderLastRound(), renderScoreboard(), renderHistory()].forEach(function (node) {
      if (node) box.appendChild(node);
    });
    box.appendChild(el("div", { class: "ut-actions" }, [
      el("button", { type: "button", id: "ut-btn-finish", text: t("ut_btn_finish"),
        onclick: function () { commit(Core.finish(state)); } })
    ]));
    return box;
  }

  // ---------------- 結束畫面 ----------------

  function renderFinal() {
    var rows = Core.ranking(state);
    var top = rows.filter(function (r) { return r.rank === 1; }).map(function (r) { return r.name; });
    var box = el("div", { class: "ut-final" }, [
      el("h2", { text: t("ut_final_heading", { n: state.history.length }) }),
      el("p", { class: "ut-winner", id: "ut-winner", text: t("ut_winner", { list: top.join(t("ut_list_sep")) }) })
    ]);
    box.appendChild(renderScoreboard());
    var history = renderHistory();
    if (history) box.appendChild(history);
    box.appendChild(el("div", { class: "ut-actions" }, [
      el("button", { type: "button", id: "ut-btn-resume", text: t("ut_btn_resume"),
        onclick: function () { var s = JSON.parse(JSON.stringify(state)); s.finished = false; commit(s); } }),
      el("button", { type: "button", id: "ut-btn-replay", class: "ut-primary", text: t("ut_btn_replay"),
        onclick: function () { commit(Core.createGame(state.config)); } }),
      el("button", { type: "button", id: "ut-btn-back-setup", text: t("ut_btn_back_setup"),
        onclick: function () { draft = null; commit(null); } })
    ]));
    return box;
  }

  function render() {
    app.innerHTML = "";
    if (!state) app.appendChild(renderSetup());
    else if (state.finished) app.appendChild(renderFinal());
    else app.appendChild(renderGame());
  }

  state = load();
  render();
  window.addEventListener("i18n:change", render);

  // 測試用（tools/utau_check）
  window.PriTestUtau = { _debugState: function () { return state ? JSON.parse(JSON.stringify(state)) : null; } };
})();
