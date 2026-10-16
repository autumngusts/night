// 東正小遊戲（toushou）UI。規則全部在 toushou_core.js，這裡只負責畫面、輸入、存讀檔與雲端同步。
// 傳遞遮蔽（ui.revealedFor 等）刻意不存進 state：重新整理後回到遮蔽畫面，避免洩漏秘密資訊。
// 規則依據：docs/superpowers/specs/2026-10-15-toushou-game-design.md
//           docs/superpowers/specs/2026-10-15-toushou-multidevice-design.md（多裝置連線）
//
// 統一模型：每台裝置「擁有」一或多個座位（mySeats()）。
//   單機模式＝擁有全部座位；連線模式＝自己認領的座位＋（主持人）未被認領的座位。
//   擁有多個座位時，需要保密的步驟用遮蔽畫面輪流操作。
(function () {
  "use strict";

  var D = window.PriTestToushouData;
  var Core = window.PriTestToushouCore;
  var Storage = window.PriTestGameStorage;
  var STORAGE_KEY = "pritest-toushou-state";
  var ROOM_KEY = "pritest-toushou-room";
  var CLIENT_KEY = "pritest-toushou-client";
  var app = document.getElementById("ts-app");
  if (!app) return;

  var state = null;
  var draft = null; // 設定畫面的草稿（不存檔）
  var lastConfig = null; // 「同設定再玩一局」用（單機）
  // room：連線模式時 { id, hostId, seats, loaded, missing, unsubscribe }；單機為 null
  var room = null;
  var clientId = loadClientId();
  var ui = { revealedFor: null, editing: null, selectedCard: null, error: "", busy: false, skipRestore: false };

  function t(key, params) { return window.I18N.t(key, params); }
  function lang() { return window.I18N.getLang(); }
  function lt(obj) { return D.text(obj, lang()); }
  // 組字串用的標點：中文／日文用全形，英文改成半形
  var PUNCT_EN = { "：": ": ", "、": ", ", "（": " (", "）": ")", "　": "  ", "［": " [", "］": "]" };
  function P(str) {
    if (lang() !== "en") return str;
    return str.replace(/[：、（）　［］]/g, function (ch) { return PUNCT_EN[ch]; });
  }
  function targetName(target) { return lt(target.name); }
  function targetTags(target) { return (target.tags || []).map(lt); }
  function newSeed() { return Math.floor(Math.random() * 4294967296); }

  function randomHex(bytes) {
    var arr = new Uint8Array(bytes);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    return Array.prototype.map.call(arr, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
  }

  function loadClientId() {
    var id = null;
    try { id = localStorage.getItem(CLIENT_KEY); } catch (e) { /* 忽略 */ }
    if (!id) {
      id = "c" + randomHex(8);
      try { localStorage.setItem(CLIENT_KEY, id); } catch (e) { /* 忽略：本次分頁內仍可用 */ }
    }
    return id;
  }

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

  // ---------------- 本機存檔 ----------------

  function saveLocal() {
    if (room) return; // 連線模式的 state 在雲端
    try {
      if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* 私密模式等：只是不存檔 */ }
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.version !== 1 || !s.players || !s.phase) return null;
      if (!s.missionsSeen) s.missionsSeen = {}; // 第 1 階段的舊存檔沒有這個欄位
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

  // ---------------- 座位與權限 ----------------

  function isHost() { return !room || room.hostId === clientId; }

  function mySeats() {
    if (!state) return [];
    return state.players.map(function (p) { return p.id; }).filter(function (id) {
      if (!room) return true;
      var owner = room.seats[id];
      return owner === clientId || (!owner && room.hostId === clientId);
    });
  }

  function owns(playerId) { return mySeats().indexOf(playerId) >= 0; }

  // ---------------- dispatch（本機／雲端共用入口） ----------------

  function dispatch(action) {
    if (ui.busy) return;
    if (!room) {
      try {
        state = Core.reduce(state, action);
      } catch (e) {
        ui.error = errText(e.message);
        render();
        return;
      }
      resetUi();
      saveLocal();
      render();
      return;
    }
    // 連線模式：在雲端目前的 state 上執行同一個 reduce（transaction 保證同時操作不互相覆蓋）
    var errKey = null;
    ui.busy = true;
    Storage.rtTransaction(room.id, "cloud", "toushou/stateJson", function (cur) {
      if (!cur) { errKey = "ts_err_room_gone"; return undefined; }
      try {
        var next = Core.reduce(JSON.parse(cur), action);
        errKey = null;
        return JSON.stringify(next);
      } catch (e) {
        errKey = e.message;
        return undefined; // 中止 transaction
      }
    }).then(function (committed) {
      ui.busy = false;
      if (errKey || committed === null) {
        ui.error = errText(errKey || "ts_err_network");
        render();
        return;
      }
      state = JSON.parse(committed);
      resetUi();
      render();
    });
  }

  // 錯誤訊息：投票上限的 key 需要 {cap}
  function errText(key) {
    return t(key, { cap: state && state.config ? state.config.voteCap : 100 });
  }

  // ---------------- 連線：房間 ----------------

  function roomUrl(id) {
    return window.location.origin + window.location.pathname + "?room=" + id;
  }

  function enterRoom(id) {
    leaveRoomSubscription();
    room = { id: id, hostId: null, seats: {}, loaded: false, missing: false, unsubscribe: null };
    state = null;
    resetUi();
    try { localStorage.setItem(ROOM_KEY, id); } catch (e) { /* 忽略 */ }
    if (window.history && window.history.replaceState) window.history.replaceState(null, "", "?room=" + id);
    room.unsubscribe = Storage.rtSubscribe(id, "cloud", "toushou", function (v) {
      if (!room || room.id !== id) return;
      room.loaded = true;
      if (!v || !v.stateJson) {
        room.missing = true;
        state = null;
      } else {
        room.missing = false;
        room.hostId = v.hostId;
        room.seats = v.seats || {};
        state = JSON.parse(v.stateJson);
      }
      render({ remote: true });
    });
    render();
  }

  function leaveRoomSubscription() {
    if (room && room.unsubscribe) room.unsubscribe();
  }

  function leaveRoom() {
    leaveRoomSubscription();
    room = null;
    state = loadLocal();
    resetUi();
    try { localStorage.removeItem(ROOM_KEY); } catch (e) { /* 忽略 */ }
    if (window.history && window.history.replaceState) window.history.replaceState(null, "", window.location.pathname);
    render();
  }

  function createRoom(config) {
    var id = Storage.generateCloudGameId();
    var initial = Core.newGame(config);
    ui.busy = true;
    render();
    Storage.rtSet(id, "cloud", "toushou", { stateJson: JSON.stringify(initial), hostId: clientId, seats: {} })
      .then(function () {
        ui.busy = false;
        enterRoom(id);
      });
  }

  function claimSeat(playerId) {
    Storage.rtTransaction(room.id, "cloud", "toushou/seats/" + playerId, function (cur) {
      if (cur && cur !== clientId) return undefined;
      return clientId;
    }).then(function (v) {
      if (v !== clientId) { ui.error = t("ts_err_seat_taken"); render(); }
    });
  }

  function releaseSeat(playerId) {
    Storage.rtSet(room.id, "cloud", "toushou/seats/" + playerId, null);
  }

  function endRoom() {
    // 主持人放棄本局：刪除房間，其他裝置會看到「房間已結束」
    var id = room.id;
    Storage.rtSet(id, "cloud", "toushou", null).then(leaveRoom);
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
      blackSwanEnabled: false,
      sectorLinkEnabled: false,
      online: false,
      minBet: 100,
      minBetEdited: false,
      deltaMode: "host",
      deltaModeEdited: false,
      voteCap: 100,
      error: ""
    };
  }

  function intOf(v) {
    var n = Number(v);
    return v !== "" && v !== null && isFinite(n) && Math.floor(n) === n ? n : NaN;
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
    var voteCap = intOf(draft.voteCap);
    if (draft.deltaMode === "vote" && !(voteCap >= 10 && voteCap <= 200)) return { error: "ts_err_setup_vote_cap" };
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
        blackSwanEnabled: draft.blackSwanEnabled,
        sectorLinkEnabled: draft.sectorLinkEnabled,
        minBet: minBet,
        deltaMode: draft.deltaMode,
        voteCap: draft.deltaMode === "vote" ? voteCap : 100,
        seed: newSeed()
      }
    };
  }

  function startLocalGame(config) {
    lastConfig = config;
    state = Core.newGame(config);
    resetUi();
    saveLocal();
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
    box.appendChild(el("label", { class: "ts-field" }, [el("input", {
      id: "ts-swan", type: "checkbox", checked: draft.blackSwanEnabled,
      onchange: function (e) { draft.blackSwanEnabled = e.target.checked; }
    }), t("ts_swan_enabled")]));
    box.appendChild(el("label", { class: "ts-field" }, [el("input", {
      id: "ts-sector", type: "checkbox", checked: draft.sectorLinkEnabled,
      onchange: function (e) { draft.sectorLinkEnabled = e.target.checked; }
    }), t("ts_sector_enabled")]));
    box.appendChild(el("label", { class: "ts-field" }, [t("ts_min_bet"), el("input", {
      id: "ts-min-bet", type: "number", min: "1", value: String(draft.minBet),
      oninput: function (e) { draft.minBet = e.target.value; draft.minBetEdited = true; }
    })]));
    box.appendChild(el("label", { class: "ts-field" }, [el("input", {
      id: "ts-online", type: "checkbox", checked: draft.online,
      onchange: function (e) {
        draft.online = e.target.checked;
        if (!draft.deltaModeEdited) draft.deltaMode = draft.online ? "vote" : "host";
        render();
      }
    }), t("ts_online_mode")]));
    if (draft.online) box.appendChild(el("p", { class: "ts-hooks", text: t("ts_online_hint") }));
    var modeSel = el("select", { id: "ts-delta-mode", "aria-label": t("ts_delta_mode"),
      onchange: function (e) { draft.deltaMode = e.target.value; draft.deltaModeEdited = true; render(); } });
    ["host", "vote"].forEach(function (m) {
      modeSel.appendChild(el("option", { value: m, selected: draft.deltaMode === m, text: t("ts_delta_mode_" + m) }));
    });
    box.appendChild(el("label", { class: "ts-field" }, [t("ts_delta_mode"), modeSel]));
    if (draft.deltaMode === "vote") {
      box.appendChild(el("label", { class: "ts-field" }, [t("ts_vote_cap"), el("input", {
        id: "ts-vote-cap", type: "number", min: "10", max: "200", value: String(draft.voteCap),
        oninput: function (e) { draft.voteCap = e.target.value; }
      })]));
    }

    box.appendChild(el("p", { id: "ts-setup-error", class: "ts-error", text: draft.error || "" }));
    box.appendChild(el("button", { id: "ts-btn-start", type: "button", class: "ts-primary", disabled: ui.busy,
      text: t(draft.online ? "ts_btn_create_room" : "ts_btn_start"),
      onclick: function () {
        var r = buildConfig();
        if (r.error) { draft.error = t(r.error); render(); return; }
        draft.error = "";
        if (draft.online) createRoom(r.config);
        else startLocalGame(r.config);
      } }));
    return box;
  }

  // ---------------- 遊戲中共用元件 ----------------

  function playerName(id) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === id) return state.players[i].name;
    return id;
  }

  function playerOf(id) { return state.players.filter(function (p) { return p.id === id; })[0]; }

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

  // 遮蔽畫面：這台裝置擁有多個座位時，先顯示「請交給 ○○」，確認後呼叫 content()。
  // 只擁有一個座位（自己的手機）時不需要遮蔽。
  function masked(playerId, content) {
    if (mySeats().length <= 1 || ui.revealedFor === playerId) return content();
    var name = playerName(playerId);
    return el("div", { id: "ts-mask", class: "ts-panel ts-mask" }, [
      el("h2", { text: t("ts_handoff", { name: name }) }),
      el("p", { text: t("ts_handoff_hint") }),
      el("button", { id: "ts-btn-reveal", type: "button", class: "ts-primary", text: t("ts_btn_i_am", { name: name }),
        onclick: function () { ui.revealedFor = playerId; ui.error = ""; ui.skipRestore = true; render(); } })
    ]);
  }

  function waiting(text) {
    return el("section", { class: "ts-panel ts-waiting" }, [el("p", { class: "ts-wait-text", text: text })]);
  }

  function swanName(id) {
    var c = Core.swanById(id);
    return c ? lt(c.name) : id;
  }

  function signed(v) { return v > 0 ? "+" + v : String(v); }

  function newsBoard(news, eventId) {
    if (!news.length) return el("p", { id: "ts-news-board", text: t("ts_news_none") });
    var ul = el("ul", { id: "ts-news-board", class: "ts-news-board" });
    news.forEach(function (n) {
      var sign = n.delta > 0 ? "+" + n.delta : String(n.delta);
      var tag = n.cardId === null ? t("ts_custom_tag") : (n.edited ? t("ts_edited_tag") : "");
      ul.appendChild(el("li", { class: n.delta > 0 ? "ts-up" : (n.delta < 0 ? "ts-down" : "") }, [
        el("strong", { text: playerName(n.playerId) }),
        n.wind ? " [" + windLabel(n.wind) + "]" : "",
        tag ? " (" + tag + ")" : "",
        // 有價格事件時，主行顯示事件前的價格，事件後的價格另起一行
        P("：") + n.text + P("　") + sign + " → " + (n.priceEvent ? n.priceBeforeEvent : n.priceAfter),
        n.votes ? el("div", { class: "ts-vote-detail", text: t("ts_news_votes", {
          list: Object.keys(n.votes).map(function (id) {
            var v = n.votes[id];
            return playerName(id) + " " + (v > 0 ? "+" + v : String(v));
          }).join(P("、")),
          avg: String(Math.round(n.avg * 10) / 10)
        }) + (n.windZeroed ? P("（") + t("ts_news_wind_zeroed") + P("）") : "") }) : null,
        n.rawDelta !== undefined && eventId ? el("div", { class: "ts-news-mod", text: t("ts_news_modified", {
          raw: signed(n.rawDelta), final: signed(n.delta), event: swanName(eventId) }) }) : null,
        n.priceEvent ? el("div", { class: "ts-news-mod", text: t("ts_news_price_event", {
          event: swanName(n.priceEvent), price: n.priceAfter }) }) : null
      ]));
    });
    return ul;
  }

  // 黑天鵝事件與起始價（info＝state.current、lastSettlement 或下注前的預覽）
  function marketInfo(info) {
    if (!info) return null;
    var box = el("div", { class: "ts-market-info" });
    if (info.sectorFrom !== null && info.sectorFrom !== undefined) {
      box.appendChild(el("p", { id: "ts-start-price", text: t("ts_start_price", { n: info.startPrice }) + P("（") +
        t("ts_sector_note", { prev: info.sectorFrom }) + P("）") }));
    }
    if (info.event) {
      var card = Core.swanById(info.event);
      var n = info.order ? info.order.length : (info.news ? info.news.length : state.players.length);
      var desc = card ? lt(card.text).split("{k}").join(String(Math.ceil(n / 2))) : "";
      if (info.event === "gap" && info.gap !== null && info.gap !== undefined) {
        desc += P("（") + t("ts_gap_note", { gap: signed(info.gap) }) + P("）");
      }
      box.appendChild(el("p", { id: "ts-swan-badge", class: "ts-swan-badge" }, [
        el("strong", { text: t("ts_swan_heading") + P("：") + swanName(info.event) }), P("　") + desc]));
    }
    return box.childNodes.length ? box : null;
  }

  function targetCard(target, price, news, info) {
    var cat = Core.categoryById(target.category);
    var tags = el("div", { class: "ts-tags" });
    targetTags(target).forEach(function (tg) { tags.appendChild(el("span", { text: tg })); });
    var hooks = (target.hooks || []).map(lt);
    return el("section", { class: "ts-panel ts-target-card" }, [
      el("p", { text: t("ts_target_heading", { i: state.targetIndex + 1, total: state.targets.length }) +
        P("　") + (cat ? lt(cat.name) : "") }),
      el("h2", { text: targetName(target) }),
      target.summary ? el("p", { class: "ts-summary", text: lt(target.summary) }) : null,
      tags,
      hooks.length ? el("p", { class: "ts-hooks", text: t("ts_hooks") + P("：") + hooks.join(P("、")) }) : null,
      el("p", {}, [t("ts_price") + P("："), el("span", { id: "ts-price", class: "ts-price", text: String(price) })]),
      marketInfo(info),
      el("h3", { text: t("ts_news_board") }),
      newsBoard(news || [], info && info.event)
    ]);
  }

  function errorLine() {
    return el("p", { id: "ts-game-error", class: "ts-error", text: ui.error || "" });
  }

  // ---------------- 房間面板（連線模式） ----------------

  function renderRoomPanel() {
    var seats = room.seats;
    var noSeat = state.players.every(function (p) { return seats[p.id] !== clientId; });
    var anyFree = state.players.some(function (p) { return !seats[p.id]; });
    var list = el("ul", { id: "ts-seat-list", class: "ts-seat-list" });
    state.players.forEach(function (p) {
      var owner = seats[p.id];
      var status;
      var btn = null;
      if (owner === clientId) {
        status = t("ts_seat_mine");
        btn = el("button", { class: "ts-btn-release", type: "button", "data-player": p.id, text: t("ts_seat_release"),
          onclick: function () { releaseSeat(p.id); } });
      } else if (owner) {
        status = t("ts_seat_taken");
      } else {
        status = t("ts_seat_free");
        btn = el("button", { class: "ts-btn-claim", type: "button", "data-player": p.id, text: t("ts_seat_claim"),
          onclick: function () { claimSeat(p.id); } });
      }
      list.appendChild(el("li", { "data-player": p.id }, [el("strong", { text: p.name }), P("　") + status + P("　"), btn]));
    });
    var url = roomUrl(room.id);
    var canvas = el("canvas", { id: "ts-room-qr", class: "ts-room-qr" });
    window.PriTestQRCode.renderToCanvas(canvas, url, { level: "L", scale: 4, margin: 2 });
    var details = el("details", { id: "ts-room-panel", class: "ts-panel", open: noSeat || (isHost() && anyFree) }, [
      el("summary", { text: t("ts_room_heading") + (isHost() ? P("（") + t("ts_you_are_host") + P("）") : "") }),
      noSeat ? el("p", { class: "ts-hooks", text: t(isHost() ? "ts_host_seat_hint" : "ts_pick_seat") }) : null,
      list,
      el("p", { class: "ts-hooks", text: t("ts_room_link") }),
      el("input", { id: "ts-room-url", type: "text", readonly: true, value: url, class: "ts-room-url" }),
      canvas
    ]);
    return details;
  }

  // ---------------- 各階段畫面 ----------------

  function renderMissions() {
    var pending = Core.pendingMissionViewers(state);
    var mine = pending.filter(owns);
    if (!mine.length) {
      return waiting(t("ts_wait_missions", { done: state.players.length - pending.length, total: state.players.length }));
    }
    var pid = mine[0];
    var p = playerOf(pid);
    return masked(pid, function () {
      var def = null;
      D.MISSIONS.forEach(function (m) { if (m.id === p.mission.id) def = m; });
      return el("section", { class: "ts-panel" }, [
        el("h2", { text: t("ts_mission_heading") + (mySeats().length > 1 ? P("（") + p.name + P("）") : "") }),
        el("p", { id: "ts-mission-text", text: fillParams(Core.missionText(p.mission.id), p.mission.params) }),
        el("p", { text: t("ts_mission_reward", { n: def ? def.reward : 0 }) }),
        el("button", { id: "ts-btn-hide", type: "button", class: "ts-primary", text: t("ts_btn_done_hide"),
          onclick: function () { dispatch({ type: "missionSeen", playerId: pid }); } })
      ]);
    });
  }

  function renderBet() {
    var pending = Core.pendingBettors(state);
    var mine = pending.filter(owns);
    var skipped = state.players.filter(function (p) { return state.current.bettors.indexOf(p.id) < 0; })
      .map(function (p) { return p.name; });
    var info = skipped.length ? el("p", { text: t("ts_skipped_broke", { names: skipped.join(P("、")) }) }) : null;
    var total = state.current.bettors.length;
    if (!mine.length) {
      return el("div", {}, [info, waiting(t("ts_wait_bets", { done: total - pending.length, total: total }))]);
    }
    var pid = mine[0];
    var me = playerOf(pid);
    var body = masked(pid, function () {
      var min = Math.min(state.config.minBet, me.chips);
      var amount = el("input", { id: "ts-bet-amount", type: "number", min: String(min), max: String(me.chips), value: String(min) });
      var predict = el("input", { id: "ts-bet-predict", type: "number", min: "0",
        value: String(state.current.startPrice || D.START_PRICE) });
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
    var me = playerOf(pid);
    var windBadge = state.current.wind
      ? el("p", {}, [t("ts_wind") + P("："), el("span", { id: "ts-wind-badge", class: "ts-wind-badge", text: windLabel(state.current.wind) })])
      : null;
    var heading = el("h2", { text: t("ts_news_heading", { role: role, name: me.name }) });
    if (!owns(pid)) return el("div", {}, [heading, windBadge, waiting(t("ts_wait_news", { name: me.name }))]);
    var gagged = Core.gagActive(state);
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
          gagged ? null : el("button", { class: "ts-btn-edit", type: "button", text: t("ts_btn_edit"),
            onclick: function () {
              ui.selectedCard = idx;
              ui.editing = cardText(cardId);
              ui.error = "";
              ui.skipRestore = true;
              render();
            } })
        ]));
      });
      return el("section", { class: "ts-panel" }, [
        el("h3", { text: t("ts_hand") }),
        el("p", { class: "ts-hooks", text: t("ts_hand_other_hint") }),
        hand,
        gagged ? el("p", { id: "ts-gag-hint", class: "ts-error", text: t("ts_gag_hint") }) : null,
        gagged ? null : el("label", {}, [t("ts_news_custom"), textArea]),
        errorLine(),
        gagged ? null : el("button", { id: "ts-btn-release", type: "button", class: "ts-primary", text: t("ts_btn_release"),
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
    var news = el("p", {}, [el("strong", { text: playerName(pending.playerId) }),
      state.current.wind ? " [" + windLabel(state.current.wind) + "]" : "", P("：") + pending.text]);
    if (state.config.deltaMode === "vote") return renderVoteBallot(news);
    if (!isHost()) {
      return el("section", { class: "ts-panel" }, [news, el("p", { class: "ts-wait-text", text: t("ts_wait_vote") })]);
    }
    var delta = el("input", { id: "ts-delta", type: "number", step: "1", value: "0" });
    return el("section", { class: "ts-panel" }, [
      news,
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

  // 全員投票：自己擁有的座位依序秘密投票（多座位時遮蔽輪流），其他人只看到進度
  function renderVoteBallot(news) {
    var pendingIds = Core.pendingVoters(state);
    var total = state.players.length;
    var mine = pendingIds.filter(owns);
    var voted = total - pendingIds.length;
    // 單機時主持人擁有全部座位，不會有人卡住，所以只在連線模式顯示
    var skipBtn = room && isHost() && voted > 0 && pendingIds.length > 0
      ? el("button", { id: "ts-btn-skip-voters", type: "button", text: t("ts_btn_skip_voters"),
          onclick: function () { dispatch({ type: "skipPendingVoters" }); } })
      : null;
    var progress = t("ts_wait_votes", { done: voted, total: total });
    if (!mine.length) {
      return el("section", { class: "ts-panel" }, [news, el("p", { class: "ts-wait-text", text: progress }), errorLine(), skipBtn]);
    }
    var pid = mine[0];
    var cap = state.config.voteCap;
    var body = masked(pid, function () {
      var input = el("input", { id: "ts-vote-value", type: "number", step: "1", min: String(-cap), max: String(cap), value: "0" });
      return el("div", {}, [
        el("h3", { text: t("ts_vote_cast_heading", { name: playerName(pid) }) }),
        el("label", { class: "ts-field" }, [t("ts_vote_value", { cap: cap }), input]),
        errorLine(),
        el("button", { id: "ts-btn-cast-vote", type: "button", class: "ts-primary", text: t("ts_btn_cast_vote"),
          onclick: function () {
            var v = intOf(input.value);
            var err = Core.voteError(state, pid, v);
            if (err) { ui.error = errText(err); render(); return; }
            dispatch({ type: "castVote", playerId: pid, value: v });
          } })
      ]);
    });
    return el("section", { class: "ts-panel" }, [news, body, el("p", { class: "ts-hooks", text: progress }), skipBtn]);
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
      table.appendChild(el("tr", {}, [p.name, b.amount, b.predict, Math.abs(b.predict - h.finalPrice),
        h.ranks[p.id] === undefined ? "—" : h.ranks[p.id], pay,
        (profit > 0 ? "+" : "") + profit].map(function (v) { return el("td", { text: String(v) }); })));
    });
    return table;
  }

  function hostButton(id, textKey, action) {
    if (!isHost()) return el("p", { class: "ts-wait-text", text: t("ts_wait_host") });
    return el("button", { id: id, type: "button", class: "ts-primary", text: t(textKey),
      onclick: function () { dispatch(action); } });
  }

  function settleNotes(h) {
    var lines = [];
    if (h.rumorIndex !== null && h.rumorIndex !== undefined) {
      var rn = h.news[h.rumorIndex];
      lines.push(t("ts_rumor_note", { name: playerName(rn.playerId), text: rn.text, delta: signed(-h.rumorDelta) }));
    }
    if (h.cancelled) lines.push(t("ts_cancel_note"));
    if (h.bonus) lines.push(t("ts_bailout_note", { n: h.bonus }));
    if (h.event === "upset") lines.push(t("ts_upset_note"));
    if (!lines.length) return null;
    var ul = el("ul", { class: "ts-settle-notes" });
    lines.forEach(function (x) { ul.appendChild(el("li", { text: x })); });
    return ul;
  }

  function renderSettle() {
    var h = state.lastSettlement;
    var last = state.targetIndex + 1 >= state.targets.length;
    return el("section", { class: "ts-panel" }, [
      el("h2", { text: t("ts_settle_heading", { name: lt(h.name) }) }),
      el("p", { text: t("ts_final_price", { n: h.finalPrice }) + P("　") + t("ts_pot", { n: h.pot }) }),
      settleNotes(h),
      el("div", { id: "ts-settle-table", class: "ts-table-wrap" }, [settleTable(h)]),
      errorLine(),
      el("div", { class: "ts-actions" }, [
        hostButton("ts-btn-next-target", last ? "ts_btn_to_final" : "ts_btn_next_target", { type: "nextTarget" })
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
        missionList.appendChild(el("li", { text: p.name + P("：") + fillParams(Core.missionText(r.missionId), r.params) +
          P("（") + t(r.achieved ? "ts_mission_achieved" : "ts_mission_failed") + P("）") }));
      });
    }
    var review = el("div", {}, [el("h3", { text: t("ts_history_heading") })]);
    state.history.forEach(function (h) {
      review.appendChild(el("details", {}, [
        el("summary", { text: lt(h.name) + P("　") + t("ts_final_price", { n: h.finalPrice }) +
          (h.event && h.event !== "calm" ? P("　［") + swanName(h.event) + P("］") : "") }),
        marketInfo(h),
        newsBoard(h.news, h.event),
        settleNotes(h),
        el("div", { class: "ts-table-wrap" }, [settleTable(h)])
      ]));
    });
    return el("section", { class: "ts-panel" }, [
      el("h2", { text: t("ts_final_heading") }),
      el("div", { id: "ts-final-table", class: "ts-table-wrap" }, [table]),
      missionList,
      review,
      el("div", { class: "ts-actions" }, [
        !room && lastConfig ? el("button", { id: "ts-btn-replay", type: "button", class: "ts-primary", text: t("ts_btn_replay"),
          onclick: function () {
            var cfg = JSON.parse(JSON.stringify(lastConfig));
            cfg.seed = newSeed();
            startLocalGame(cfg);
          } }) : null,
        el("button", { id: "ts-btn-back-setup", type: "button", text: t("ts_btn_back_setup"),
          onclick: function () {
            if (room) { leaveRoom(); return; }
            state = null; resetUi(); saveLocal(); render();
          } })
      ])
    ]);
  }

  function renderGame() {
    var wrap = el("div", {});
    if (room) wrap.appendChild(renderRoomPanel());
    var phase = state.phase;
    if (phase === "final") {
      wrap.appendChild(renderFinal());
      return wrap;
    }
    if (phase === "missions") {
      wrap.appendChild(renderMissions());
    } else {
      var settled = phase === "settle";
      var info = settled ? state.lastSettlement : state.current;
      if (!info && state.config.sectorLinkEnabled) {
        // 下注前預覽板塊連動的起始價（startBetting 時以同一函式決定）
        var sp = Core.sectorStartPrice(state, currentTarget().category);
        info = { startPrice: sp.price, sectorFrom: sp.from, price: sp.price };
      }
      var price = settled ? state.lastSettlement.finalPrice : (info ? info.price : D.START_PRICE);
      var news = settled ? state.lastSettlement.news : (state.current ? state.current.news : []);
      wrap.appendChild(targetCard(currentTarget(), price, news, info));
      if (phase === "reveal_target") {
        wrap.appendChild(hostButton("ts-btn-start-betting", "ts_btn_start_betting", { type: "startBetting" }));
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
    var actions = el("div", { class: "ts-actions" });
    if (isHost()) {
      actions.appendChild(el("button", { id: "ts-btn-abandon", type: "button", text: t("ts_btn_abandon"),
        onclick: function () {
          if (!window.confirm(t("ts_confirm_abandon"))) return;
          if (room) { endRoom(); return; }
          state = null; resetUi(); saveLocal(); render();
        } }));
    } else {
      actions.appendChild(el("button", { id: "ts-btn-leave-room", type: "button", text: t("ts_btn_leave_room"), onclick: leaveRoom }));
    }
    wrap.appendChild(actions);
    return wrap;
  }

  function renderRoomStatus() {
    if (!room.loaded) return waiting(t("ts_room_connecting"));
    return el("section", { class: "ts-panel" }, [
      el("p", { id: "ts-room-gone", text: t("ts_room_gone") }),
      el("button", { id: "ts-btn-back-setup", type: "button", text: t("ts_btn_back_setup"), onclick: leaveRoom })
    ]);
  }

  // ---------------- 重繪（保留輸入中的內容） ----------------

  // 遠端更新會整個重繪；畫面「位置」沒變時，把輸入框的內容與焦點還原，避免打字打到一半被清掉。
  function viewKey() {
    if (!state) return "setup";
    var c = state.current;
    return [state.phase, state.targetIndex, c ? c.turnIndex : "", ui.revealedFor, ui.selectedCard].join("|");
  }

  function captureInputs() {
    var values = {};
    Array.prototype.forEach.call(app.querySelectorAll("input[id], textarea[id]"), function (node) {
      if (node.type !== "checkbox" && node.type !== "radio") values[node.id] = node.value;
    });
    var active = document.activeElement;
    return { key: viewKey(), values: values, focus: active && active.id && app.contains(active) ? active.id : null };
  }

  function restoreInputs(snap) {
    if (!snap || snap.key !== viewKey()) return;
    Object.keys(snap.values).forEach(function (id) {
      var node = document.getElementById(id);
      if (node && !node.readOnly) node.value = snap.values[id];
    });
    if (snap.focus) {
      var f = document.getElementById(snap.focus);
      if (f) f.focus();
    }
  }

  var lastHtml = null;

  // opts.remote：由其他裝置的更新觸發。這台裝置要顯示的內容完全沒變時（例如別人下注、自己正在填表），
  // 不重建 DOM——避免打字中途輸入框被換掉造成游標跳動或重複輸入。
  // 跳過時舊節點的事件處理仍然有效：它們讀的是模組層的 state（已更新），畫面相同代表 pid 等也相同。
  function render(opts) {
    var node = room && !state ? renderRoomStatus() : (state ? renderGame() : renderSetup());
    var holder = document.createElement("div");
    holder.appendChild(node);
    var html = holder.innerHTML;
    if (opts && opts.remote && html === lastHtml) return;
    var snap = state && !ui.skipRestore ? captureInputs() : null;
    ui.skipRestore = false;
    app.innerHTML = "";
    app.appendChild(node);
    lastHtml = html;
    restoreInputs(snap);
  }

  window.PriTestToushou = {
    _debugState: function () { return state ? JSON.parse(JSON.stringify(state)) : null; },
    _debugRoom: function () { return room ? { id: room.id, hostId: room.hostId, seats: room.seats, clientId: clientId } : null; },
    _reset: function () { draft = null; if (room) leaveRoom(); state = null; resetUi(); saveLocal(); render(); }
  };

  window.addEventListener("i18n:change", render);

  var params = new URLSearchParams(window.location.search);
  var roomParam = params.get("room");
  var savedRoom = null;
  try { savedRoom = localStorage.getItem(ROOM_KEY); } catch (e) { /* 忽略 */ }
  if (roomParam && /^g[0-9a-f]{32}$/.test(roomParam)) {
    enterRoom(roomParam);
  } else if (savedRoom && /^g[0-9a-f]{32}$/.test(savedRoom)) {
    enterRoom(savedRoom);
  } else {
    state = loadLocal();
    render();
  }
})();
