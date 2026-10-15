// 東正小遊戲（toushou）UI。規則全部在 toushou_core.js，這裡只負責畫面、輸入與存讀檔。
// 傳遞遮蔽（ui.revealedFor 等）刻意不存進 state：重新整理後回到遮蔽畫面，避免洩漏秘密資訊。
// 規則依據：docs/superpowers/specs/2026-10-15-toushou-game-design.md
(function () {
  "use strict";

  var D = window.PriTestToushouData;
  var Core = window.PriTestToushouCore;
  var STORAGE_KEY = "pritest-toushou-state";
  var app = document.getElementById("ts-app");
  if (!app) return;

  var state = null;
  var draft = null; // 設定畫面的草稿（不存檔）
  var lastConfig = null; // 「同設定再玩一局」用
  var ui = { revealedFor: null, missionIndex: 0, editing: null, selectedCard: null, error: "" };

  function t(key, params) { return window.I18N.t(key, params); }
  function lang() { return window.I18N.getLang(); }
  function lt(obj) { return D.text(obj, lang()); }
  function targetName(target) { return lt(target.name); }
  function targetTags(target) { return (target.tags || []).map(lt); }
  function newSeed() { return Math.floor(Math.random() * 4294967296); }

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
      if (!s || s.version !== 1 || !s.players || !s.phase) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function resetUi() {
    ui.revealedFor = null;
    ui.editing = null;
    ui.selectedCard = null;
    ui.error = "";
  }

  function dispatch(action) {
    try {
      state = Core.reduce(state, action);
    } catch (e) {
      ui.error = t(e.message);
      render();
      return false;
    }
    resetUi();
    save();
    render();
    return true;
  }

  function quitGame() {
    state = null;
    resetUi();
    save();
    render();
  }

  // ---------------- 設定畫面 ----------------

  function newDraft() {
    var players = [];
    for (var i = 0; i < 4; i++) players.push({ name: t("ts_player_default", { n: i + 1 }), chips: 1000 });
    return {
      players: players,
      chipsMode: "same",
      chipsSame: 1000,
      targetCountMode: "players",
      targetCount: 4,
      categories: D.CATEGORIES.map(function (c) { return c.id; }),
      targets: [],
      missionsEnabled: true,
      windEnabled: false,
      minBet: 100,
      minBetEdited: false,
      error: ""
    };
  }

  function intOf(v) {
    var n = Number(v);
    return v !== "" && isFinite(n) && Math.floor(n) === n ? n : NaN;
  }

  function syncMinBet() {
    if (draft.minBetEdited) return;
    var chips = intOf(draft.chipsSame);
    draft.minBet = Core.defaultMinBet(draft.chipsMode, chips >= 1 ? chips : 1000);
  }

  function setPlayerCount(n) {
    n = Math.max(2, Math.min(10, n));
    while (draft.players.length < n) {
      draft.players.push({ name: t("ts_player_default", { n: draft.players.length + 1 }), chips: draft.chipsSame });
    }
    draft.players.length = n;
  }

  function randomizeTargets() {
    var count = draft.targetCountMode === "players" ? draft.players.length : draft.targetCount;
    if (!draft.categories.length) {
      draft.error = t("ts_err_setup_categories");
      return;
    }
    draft.targets = Core.pickRandomTargets(draft.categories, count, newSeed());
    draft.error = draft.targets.length < count ? t("ts_err_setup_pool", { n: draft.targets.length }) : "";
  }

  function buildConfig() {
    if (draft.players.some(function (p) { return !String(p.name).trim(); })) return { error: "ts_err_setup_names" };
    var chips = draft.players.map(function (p) {
      return draft.chipsMode === "same" ? intOf(draft.chipsSame) : intOf(p.chips);
    });
    if (chips.some(function (c) { return !(c >= 1); })) return { error: "ts_err_setup_chips" };
    var minBet = intOf(draft.minBet);
    if (!(minBet >= 1)) return { error: "ts_err_setup_chips" };
    if (!draft.targets.length) randomizeTargets();
    if (!draft.targets.length || draft.targets.some(function (tg) { return !lt(tg.name).trim(); })) {
      return { error: "ts_err_setup_targets" };
    }
    return {
      config: {
        players: draft.players.map(function (p, i) { return { name: String(p.name).trim(), chips: chips[i] }; }),
        targets: draft.targets.map(function (tg) {
          return { category: tg.category, name: tg.name, summary: tg.summary || null, tags: tg.tags,
            hooks: tg.hooks || [], custom: !!tg.custom };
        }),
        missionsEnabled: draft.missionsEnabled,
        windEnabled: draft.windEnabled,
        minBet: minBet,
        seed: newSeed()
      }
    };
  }

  function startGame(config) {
    lastConfig = config;
    state = Core.newGame(config);
    resetUi();
    ui.missionIndex = 0;
    save();
    render();
  }

  // 手動修改標的時，資料標的轉成純字串的自訂標的（簡介／切入點不再適用）
  function makeCustom(tg) {
    if (tg.custom) return;
    tg.name = lt(tg.name);
    tg.tags = (tg.tags || []).map(lt);
    tg.summary = null;
    tg.hooks = [];
    tg.custom = true;
  }

  function renderSetup() {
    if (!draft) {
      draft = newDraft();
      syncMinBet();
    }
    var box = el("section", { class: "ts-panel" }, [el("h2", { text: t("ts_setup_heading") })]);

    box.appendChild(el("label", { class: "ts-field" }, [
      t("ts_player_count"),
      el("input", {
        id: "ts-player-count", type: "number", min: "2", max: "10", value: String(draft.players.length),
        onchange: function (e) { setPlayerCount(intOf(e.target.value) || 2); render(); }
      })
    ]));

    box.appendChild(el("div", { class: "ts-field" }, [
      t("ts_chips_mode"),
      el("label", {}, [el("input", {
        type: "radio", name: "ts-chips-mode", value: "same", checked: draft.chipsMode === "same",
        onchange: function () { draft.chipsMode = "same"; syncMinBet(); render(); }
      }), t("ts_chips_same")]),
      el("label", {}, [el("input", {
        type: "radio", name: "ts-chips-mode", value: "each", checked: draft.chipsMode === "each",
        onchange: function () { draft.chipsMode = "each"; syncMinBet(); render(); }
      }), t("ts_chips_each")]),
      draft.chipsMode === "same" ? el("input", {
        id: "ts-chips-same", type: "number", min: "1", value: String(draft.chipsSame), "aria-label": t("ts_chips"),
        oninput: function (e) {
          draft.chipsSame = e.target.value;
          syncMinBet();
          var mb = document.getElementById("ts-min-bet");
          if (mb && !draft.minBetEdited) mb.value = String(draft.minBet);
        }
      }) : null
    ]));

    var list = el("ol", { class: "ts-player-list" });
    draft.players.forEach(function (p) {
      list.appendChild(el("li", {}, [
        el("input", { class: "ts-player-name", type: "text", value: p.name, "aria-label": t("ts_player_name"),
          oninput: function (e) { p.name = e.target.value; } }),
        draft.chipsMode === "each" ? el("input", { class: "ts-player-chips", type: "number", min: "1",
          value: String(p.chips), "aria-label": t("ts_chips"),
          oninput: function (e) { p.chips = e.target.value; } }) : null
      ]));
    });
    box.appendChild(list);

    var cats = el("div", { class: "ts-field" }, [t("ts_categories")]);
    D.CATEGORIES.forEach(function (c) {
      cats.appendChild(el("label", {}, [el("input", {
        class: "ts-cat", type: "checkbox", value: c.id, checked: draft.categories.indexOf(c.id) >= 0,
        onchange: function (e) {
          if (e.target.checked) draft.categories.push(c.id);
          else draft.categories = draft.categories.filter(function (x) { return x !== c.id; });
        }
      }), lt(c.name)]));
    });
    box.appendChild(cats);

    box.appendChild(el("div", { class: "ts-field" }, [
      t("ts_target_count"),
      el("label", {}, [el("input", {
        type: "checkbox", checked: draft.targetCountMode === "players",
        onchange: function (e) { draft.targetCountMode = e.target.checked ? "players" : "custom"; render(); }
      }), t("ts_target_count_players")]),
      draft.targetCountMode === "custom" ? el("input", {
        id: "ts-target-count", type: "number", min: "1", max: "20", value: String(draft.targetCount),
        oninput: function (e) { draft.targetCount = Math.max(1, Math.min(20, intOf(e.target.value) || 1)); }
      }) : null,
      el("button", { id: "ts-btn-randomize", type: "button", text: t("ts_btn_randomize"),
        onclick: function () { randomizeTargets(); render(); } }),
      el("button", { id: "ts-btn-add-target", type: "button", text: t("ts_btn_add_target"),
        onclick: function () {
          draft.targets.push({ category: draft.categories[0] || D.CATEGORIES[0].id, name: "", tags: [], custom: true });
          render();
        } })
    ]));

    var tlist = el("ol", { class: "ts-target-list" });
    draft.targets.forEach(function (tg, idx) {
      var catSel = el("select", { class: "ts-target-cat", "aria-label": t("ts_categories"),
        onchange: function (e) { tg.category = e.target.value; } });
      D.CATEGORIES.forEach(function (c) {
        catSel.appendChild(el("option", { value: c.id, selected: c.id === tg.category, text: lt(c.name) }));
      });
      tlist.appendChild(el("li", { class: "ts-target-row" }, [
        el("input", { class: "ts-target-name", type: "text", value: lt(tg.name), "aria-label": t("ts_target_name"),
          oninput: function (e) { makeCustom(tg); tg.name = e.target.value; } }),
        catSel,
        el("input", { class: "ts-target-tags", type: "text", value: (tg.tags || []).map(lt).join(", "),
          "aria-label": t("ts_target_tags"),
          oninput: function (e) {
            makeCustom(tg);
            tg.tags = e.target.value.split(/[,，、]/).map(function (x) { return x.trim(); }).filter(Boolean);
          } }),
        el("button", { class: "ts-target-del", type: "button", text: t("ts_btn_delete"),
          onclick: function () { draft.targets.splice(idx, 1); render(); } })
      ]));
    });
    box.appendChild(el("div", {}, [el("p", { text: t("ts_targets") }), tlist]));

    box.appendChild(el("label", { class: "ts-field" }, [el("input", {
      id: "ts-missions", type: "checkbox", checked: draft.missionsEnabled,
      onchange: function (e) { draft.missionsEnabled = e.target.checked; }
    }), t("ts_missions_enabled")]));
    box.appendChild(el("label", { class: "ts-field" }, [el("input", {
      id: "ts-wind", type: "checkbox", checked: draft.windEnabled,
      onchange: function (e) { draft.windEnabled = e.target.checked; }
    }), t("ts_wind_enabled")]));
    box.appendChild(el("label", { class: "ts-field" }, [t("ts_min_bet"), el("input", {
      id: "ts-min-bet", type: "number", min: "1", value: String(draft.minBet),
      oninput: function (e) { draft.minBet = e.target.value; draft.minBetEdited = true; }
    })]));

    box.appendChild(el("p", { id: "ts-setup-error", class: "ts-error", text: draft.error || "" }));
    box.appendChild(el("button", { id: "ts-btn-start", type: "button", class: "ts-primary", text: t("ts_btn_start"),
      onclick: function () {
        var r = buildConfig();
        if (r.error) { draft.error = t(r.error); render(); return; }
        draft.error = "";
        startGame(r.config);
      } }));
    return box;
  }

  // ---------------- 遊戲中共用元件 ----------------

  function playerName(id) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === id) return state.players[i].name;
    return id;
  }

  function currentTarget() { return state.targets[state.targetIndex]; }

  // 牌面文字：{target} 代入目前標的名稱
  function cardText(cardId) {
    var card = Core.cardById(cardId);
    if (!card) return cardId;
    var target = currentTarget();
    return lt(card.text).split("{target}").join(target ? targetName(target) : "");
  }

  function fillParams(textObj, params) {
    var s = lt(textObj);
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (k === "category") {
        var c = Core.categoryById(v);
        if (c) v = lt(c.name);
      }
      s = s.split("{" + k + "}").join(String(v));
    });
    return s;
  }

  function windLabel(w) { return w ? t("ts_wind_" + w) : ""; }

  // 遮蔽畫面：未確認身分時顯示「請交給 ○○」，確認後呼叫 content()
  function masked(playerId, content) {
    if (ui.revealedFor === playerId) return content();
    var name = playerName(playerId);
    return el("div", { id: "ts-mask", class: "ts-panel ts-mask" }, [
      el("h2", { text: t("ts_handoff", { name: name }) }),
      el("p", { text: t("ts_handoff_hint") }),
      el("button", { id: "ts-btn-reveal", type: "button", class: "ts-primary", text: t("ts_btn_i_am", { name: name }),
        onclick: function () { ui.revealedFor = playerId; ui.error = ""; render(); } })
    ]);
  }

  function newsBoard(news) {
    if (!news.length) return el("p", { id: "ts-news-board", text: t("ts_news_none") });
    var ul = el("ul", { id: "ts-news-board", class: "ts-news-board" });
    news.forEach(function (n) {
      var sign = n.delta > 0 ? "+" + n.delta : String(n.delta);
      var tag = n.cardId === null ? t("ts_custom_tag") : (n.edited ? t("ts_edited_tag") : "");
      ul.appendChild(el("li", { class: n.delta > 0 ? "ts-up" : (n.delta < 0 ? "ts-down" : "") }, [
        el("strong", { text: playerName(n.playerId) }),
        n.wind ? " [" + windLabel(n.wind) + "]" : "",
        tag ? " (" + tag + ")" : "",
        "：" + n.text + "　" + sign + " → " + n.priceAfter
      ]));
    });
    return ul;
  }

  function targetCard(target, price, news) {
    var cat = Core.categoryById(target.category);
    var tags = el("div", { class: "ts-tags" });
    targetTags(target).forEach(function (tg) { tags.appendChild(el("span", { text: tg })); });
    var hooks = (target.hooks || []).map(lt);
    return el("section", { class: "ts-panel ts-target-card" }, [
      el("p", { text: t("ts_target_heading", { i: state.targetIndex + 1, total: state.targets.length }) +
        "　" + (cat ? lt(cat.name) : "") }),
      el("h2", { text: targetName(target) }),
      target.summary ? el("p", { class: "ts-summary", text: lt(target.summary) }) : null,
      tags,
      hooks.length ? el("p", { class: "ts-hooks", text: t("ts_hooks") + "：" + hooks.join("、") }) : null,
      el("p", {}, [t("ts_price") + "：", el("span", { id: "ts-price", class: "ts-price", text: String(price) })]),
      el("h3", { text: t("ts_news_board") }),
      newsBoard(news || [])
    ]);
  }

  function errorLine() {
    return el("p", { id: "ts-game-error", class: "ts-error", text: ui.error || "" });
  }

  // ---------------- 各階段畫面 ----------------

  function renderMissions() {
    var p = state.players[ui.missionIndex];
    return masked(p.id, function () {
      var def = null;
      D.MISSIONS.forEach(function (m) { if (m.id === p.mission.id) def = m; });
      return el("section", { class: "ts-panel" }, [
        el("h2", { text: t("ts_mission_heading") }),
        el("p", { id: "ts-mission-text", text: fillParams(Core.missionText(p.mission.id), p.mission.params) }),
        el("p", { text: t("ts_mission_reward", { n: def ? def.reward : 0 }) }),
        el("button", { id: "ts-btn-hide", type: "button", class: "ts-primary", text: t("ts_btn_done_hide"),
          onclick: function () {
            ui.revealedFor = null;
            if (ui.missionIndex + 1 >= state.players.length) {
              ui.missionIndex = 0;
              dispatch({ type: "missionsDone" });
            } else {
              ui.missionIndex += 1;
              render();
            }
          } })
      ]);
    });
  }

  function renderBet() {
    var pid = Core.nextBettor(state);
    var me = state.players.filter(function (p) { return p.id === pid; })[0];
    var skipped = state.players.filter(function (p) { return state.current.bettors.indexOf(p.id) < 0; })
      .map(function (p) { return p.name; });
    var info = skipped.length ? el("p", { text: t("ts_skipped_broke", { names: skipped.join("、") }) }) : null;
    var body = masked(pid, function () {
      var min = Math.min(state.config.minBet, me.chips);
      var amount = el("input", { id: "ts-bet-amount", type: "number", min: String(min), max: String(me.chips), value: String(min) });
      var predict = el("input", { id: "ts-bet-predict", type: "number", min: "0", value: String(D.START_PRICE) });
      return el("section", { class: "ts-panel" }, [
        el("h2", { text: t("ts_bet_heading", { name: me.name }) }),
        el("p", { text: t("ts_bet_chips_left", { n: me.chips, min: min }) }),
        el("label", { class: "ts-field" }, [t("ts_bet_amount"), amount]),
        el("label", { class: "ts-field" }, [t("ts_bet_predict"), predict]),
        errorLine(),
        el("button", { id: "ts-btn-confirm-bet", type: "button", class: "ts-primary", text: t("ts_btn_confirm_bet"),
          onclick: function () {
            var a = intOf(amount.value);
            var pr = intOf(predict.value);
            var err = Core.betError(state, pid, a, pr);
            if (err) { ui.error = t(err); render(); return; }
            dispatch({ type: "placeBet", playerId: pid, amount: a, predict: pr });
          } })
      ]);
    });
    return el("div", {}, [info, body]);
  }

  function renderNews() {
    var pid = Core.currentShareholder(state);
    var role = lt(Core.roleFor(currentTarget().category));
    var me = state.players.filter(function (p) { return p.id === pid; })[0];
    var windBadge = state.current.wind
      ? el("p", {}, [t("ts_wind") + "：", el("span", { id: "ts-wind-badge", class: "ts-wind-badge", text: windLabel(state.current.wind) })])
      : null;
    var heading = el("h2", { text: t("ts_news_heading", { role: role, name: me.name }) });
    var body = masked(pid, function () {
      var textArea = el("textarea", { id: "ts-news-text", class: "ts-news-text", "aria-label": t("ts_news_custom") });
      if (ui.editing !== null) textArea.value = ui.editing;
      textArea.addEventListener("input", function () { ui.editing = textArea.value; });
      var hand = el("ul", { class: "ts-hand" });
      me.hand.forEach(function (cardId, idx) {
        var card = Core.cardById(cardId);
        var playable = Core.cardPlayable(state, cardId);
        var cls = [card ? "ts-" + card.tone : "", playable ? "" : "ts-unplayable", ui.selectedCard === idx ? "ts-selected" : ""]
          .filter(Boolean).join(" ");
        hand.appendChild(el("li", { "data-card": cardId, class: cls }, [
          el("p", { text: cardText(cardId) }),
          playable ? el("button", { class: "ts-btn-play", type: "button", text: t("ts_btn_play"),
            onclick: function () {
              dispatch({ type: "releaseNews", playerId: pid, cardId: cardId, edited: false, text: cardText(cardId) });
            } }) : null,
          el("button", { class: "ts-btn-edit", type: "button", text: t("ts_btn_edit"),
            onclick: function () {
              ui.selectedCard = idx;
              ui.editing = cardText(cardId);
              ui.error = "";
              render();
            } })
        ]));
      });
      return el("section", { class: "ts-panel" }, [
        el("h3", { text: t("ts_hand") }),
        el("p", { class: "ts-hooks", text: t("ts_hand_other_hint") }),
        hand,
        el("label", {}, [t("ts_news_custom"), textArea]),
        errorLine(),
        el("button", { id: "ts-btn-release", type: "button", class: "ts-primary", text: t("ts_btn_release"),
          onclick: function () {
            var text = textArea.value;
            var cardId = ui.selectedCard === null ? null : me.hand[ui.selectedCard];
            var edited = cardId !== null;
            var err = Core.newsError(state, pid, cardId, text, edited);
            if (err) { ui.error = t(err); ui.editing = text; render(); return; }
            dispatch({ type: "releaseNews", playerId: pid, cardId: cardId, edited: edited, text: text });
          } })
      ]);
    });
    return el("div", {}, [heading, windBadge, body]);
  }

  function renderVote() {
    var pending = state.current.pending;
    var delta = el("input", { id: "ts-delta", type: "number", step: "1", value: "0" });
    return el("section", { class: "ts-panel" }, [
      el("p", {}, [el("strong", { text: playerName(pending.playerId) }),
        state.current.wind ? " [" + windLabel(state.current.wind) + "]" : "", "：" + pending.text]),
      el("h3", { text: t("ts_vote_heading") }),
      el("label", { class: "ts-field" }, [t("ts_delta"), delta]),
      errorLine(),
      el("button", { id: "ts-btn-apply-delta", type: "button", class: "ts-primary", text: t("ts_btn_apply_delta"),
        onclick: function () {
          var d = intOf(delta.value);
          var err = Core.deltaError(state, d);
          if (err) { ui.error = t(err); render(); return; }
          dispatch({ type: "applyDelta", delta: d });
        } })
    ]);
  }

  function settleTable(h) {
    var table = el("table", { class: "ts-table" });
    table.appendChild(el("tr", {}, ["ts_col_player", "ts_col_bet", "ts_col_predict", "ts_col_error", "ts_col_rank", "ts_col_payout", "ts_col_profit"]
      .map(function (k) { return el("th", { text: t(k) }); })));
    state.players.forEach(function (p) {
      var b = h.bets[p.id];
      if (!b) return;
      var pay = h.payouts[p.id] || 0;
      var profit = pay - b.amount;
      table.appendChild(el("tr", {}, [p.name, b.amount, b.predict, Math.abs(b.predict - h.finalPrice), h.ranks[p.id], pay,
        (profit > 0 ? "+" : "") + profit].map(function (v) { return el("td", { text: String(v) }); })));
    });
    return table;
  }

  function renderSettle() {
    var h = state.lastSettlement;
    var last = state.targetIndex + 1 >= state.targets.length;
    return el("section", { class: "ts-panel" }, [
      el("h2", { text: t("ts_settle_heading", { name: lt(h.name) }) }),
      el("p", { text: t("ts_final_price", { n: h.finalPrice }) + "　" + t("ts_pot", { n: h.pot }) }),
      el("div", { id: "ts-settle-table", class: "ts-table-wrap" }, [settleTable(h)]),
      el("div", { class: "ts-actions" }, [
        el("button", { id: "ts-btn-next-target", type: "button", class: "ts-primary",
          text: t(last ? "ts_btn_to_final" : "ts_btn_next_target"),
          onclick: function () { dispatch({ type: "nextTarget" }); } })
      ])
    ]);
  }

  function renderFinal() {
    var standings = Core.finalStandings(state);
    var missions = {};
    Core.evaluateMissions(state).forEach(function (r) { missions[r.playerId] = r; });
    var table = el("table", { class: "ts-table" });
    table.appendChild(el("tr", {}, ["ts_col_rank", "ts_col_player", "ts_col_chips", "ts_col_bonus", "ts_col_total"]
      .map(function (k) { return el("th", { text: t(k) }); })));
    standings.forEach(function (r) {
      table.appendChild(el("tr", {}, [r.rank, r.name, r.chips, r.bonus, r.total]
        .map(function (v) { return el("td", { text: String(v) }); })));
    });
    var missionList = null;
    if (state.config.missionsEnabled) {
      missionList = el("ul", { id: "ts-final-missions" });
      state.players.forEach(function (p) {
        var r = missions[p.id];
        if (!r) return;
        missionList.appendChild(el("li", { text: p.name + "：" + fillParams(Core.missionText(r.missionId), r.params) +
          "（" + t(r.achieved ? "ts_mission_achieved" : "ts_mission_failed") + "）" }));
      });
    }
    var review = el("div", {}, [el("h3", { text: t("ts_history_heading") })]);
    state.history.forEach(function (h) {
      review.appendChild(el("details", {}, [
        el("summary", { text: lt(h.name) + "　" + t("ts_final_price", { n: h.finalPrice }) }),
        newsBoard(h.news),
        el("div", { class: "ts-table-wrap" }, [settleTable(h)])
      ]));
    });
    return el("section", { class: "ts-panel" }, [
      el("h2", { text: t("ts_final_heading") }),
      el("div", { id: "ts-final-table", class: "ts-table-wrap" }, [table]),
      missionList,
      review,
      el("div", { class: "ts-actions" }, [
        lastConfig ? el("button", { id: "ts-btn-replay", type: "button", class: "ts-primary", text: t("ts_btn_replay"),
          onclick: function () {
            var cfg = JSON.parse(JSON.stringify(lastConfig));
            cfg.seed = newSeed();
            startGame(cfg);
          } }) : null,
        el("button", { id: "ts-btn-back-setup", type: "button", text: t("ts_btn_back_setup"), onclick: quitGame })
      ])
    ]);
  }

  function renderGame() {
    var wrap = el("div", {});
    var phase = state.phase;
    if (phase === "final") {
      wrap.appendChild(renderFinal());
      return wrap;
    }
    if (phase === "missions") {
      wrap.appendChild(renderMissions());
    } else {
      var settled = phase === "settle";
      var price = settled ? state.lastSettlement.finalPrice : (state.current ? state.current.price : D.START_PRICE);
      var news = settled ? state.lastSettlement.news : (state.current ? state.current.news : []);
      wrap.appendChild(targetCard(currentTarget(), price, news));
      if (phase === "reveal_target") {
        wrap.appendChild(el("button", { id: "ts-btn-start-betting", type: "button", class: "ts-primary",
          text: t("ts_btn_start_betting"), onclick: function () { dispatch({ type: "startBetting" }); } }));
      } else if (phase === "bet") {
        wrap.appendChild(renderBet());
      } else if (phase === "news") {
        wrap.appendChild(renderNews());
      } else if (phase === "vote") {
        wrap.appendChild(renderVote());
      } else if (settled) {
        wrap.appendChild(renderSettle());
      }
    }
    wrap.appendChild(el("div", { class: "ts-actions" }, [
      el("button", { id: "ts-btn-abandon", type: "button", text: t("ts_btn_abandon"),
        onclick: function () {
          if (!window.confirm(t("ts_confirm_abandon"))) return;
          quitGame();
        } })
    ]));
    return wrap;
  }

  function render() {
    app.innerHTML = "";
    app.appendChild(state ? renderGame() : renderSetup());
  }

  window.PriTestToushou = {
    _debugState: function () { return state ? JSON.parse(JSON.stringify(state)) : null; },
    _reset: function () { draft = null; quitGame(); }
  };

  window.addEventListener("i18n:change", render);
  state = load();
  render();
})();
