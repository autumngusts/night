// 武俠合成（gousei）UI。規則全部在 gousei_core.js，這裡只負責畫面、輸入、存讀檔與主題資料載入。
// 主題資料很大（每個主題數千種物體），不在頁面 script 清單裡：選主題時才以 <script> 動態載入，
//   網址從 #gs-app 的 data-src-<theme> 取（帶快取雜湊，見 site_src/gousei_page.py）。
// 同一裝置模式：開局先進「任務確認」畫面（state.confirm），全員輪流查看並隱藏後才正式開始；
//   遊戲中池子下方的各玩家任務一次只能展開一位（ui.revealedFor），刻意不存檔：重新整理後一律隱藏。
// 分別裝置模式：手機開 ?join=<theme.seed.count.index>，只顯示自己的任務，不同步、不存檔（未勾連線同步時）。
// 連線同步（分別裝置＋勾選，2026-10-19）：整局 state 以 JSON 字串放在 Firebase
//   games/<房間 id>/rtState/gousei（沿用 toushou 的做法，現有規則即允許，不需另外部署）。
//   手機開 ?join=...&room=<id> 變成完整遊戲畫面，只有輪到自己才能合成；主機可替任何人操作，
//   復原與新遊戲只有主機能按。所有變更都經 mutate() 在雲端最新 state 上以 transaction 執行。
// 合作模式 coop（使用者指定 2026-11-03）：全隊共同 5 個目標公開顯示（state.coop），任何人合出即達成；
//   依回合數與失敗（廢料）數計算效率得分（Core.coopScore），各主題的最佳紀錄存在 localStorage["pritest-gousei-coop-best"]。
//   可搭配連線同步（和分別裝置一樣用 QR 加入）。
// 語音模式（Web Speech API）：輪到誰就朗讀玩家與池子，每分鐘重複；喊「yo, アキ」→ 提示音 →「A 加 B」直接合成。
(function () {
  "use strict";

  var Core = window.PriTestGouseiCore;
  var STORAGE_KEY = "pritest-gousei-state";
  var ROOM_KEY = "pritest-gousei-room";
  var CLIENT_KEY = "pritest-gousei-client";
  var ROOM_RE = /^g[0-9a-f]{32}$/;
  var Storage = window.PriTestGameStorage;
  var THEMES = ["wuxia", "wafu", "food"];
  var MODES = ["shared", "split", "coop"];
  var COOP_BEST_KEY = "pritest-gousei-coop-best";
  var POOL_LIMIT = 300;
  var LOG_LIMIT = 30;
  var app = document.getElementById("gs-app");
  if (!app) return;

  var themes = {}; // themeId -> Core.indexTheme 結果
  var state = null;
  var draft = { themeId: "wuxia", mode: "shared", names: ["", ""], voice: false, online: false };
  var ui = { revealedFor: null, revealed: false, slots: [null, null], trioChoice: null, lastEntry: null, search: "", cat: "all",
    qrFor: null, confirmNew: false, confirmEnd: false, recipeOpen: {}, hintConfirm: null,
    showMembers: false, joinName: "", newcomer: false, superCtl: false, junkWarn: null, error: "", loading: false, screen: "play", busy: false, playError: "" };
  var join = null;
  // 連線同步的房間：{ id, hostId, me: 手機的玩家編號（主機為 null）, loaded, missing, unsubscribe }
  var room = null;

  // 工作台槽數：theme.data.allowTrio（目前只有世界美食）時可以選 3 種材料，否則固定 2 種。
  function emptySlots() {
    var theme = state && themes[state.themeId];
    var n = theme && theme.data.allowTrio ? 3 : 2;
    var out = [];
    for (var i = 0; i < n; i++) out.push(null);
    return out;
  }

  function t(key, params) { return window.I18N.t(key, params); }

  // ---------------- 超級控制（2026-11-05 使用者指定：輸入密碼 nightnight 可以直接控制其他玩家） ----------------
  // 只存在這個分頁（sessionStorage）。開啟後：任何人的回合都能合成、能指定輪到誰、能替別人加入／離開。
  var SUPER_KEY = "pritest-gousei-super", SUPER_PASS = "nightnight";
  function loadSuper() { try { return sessionStorage.getItem(SUPER_KEY) === "1"; } catch (e) { return false; } }
  function setSuper(on) {
    ui.superCtl = on;
    try { if (on) sessionStorage.setItem(SUPER_KEY, "1"); else sessionStorage.removeItem(SUPER_KEY); } catch (e) { /* 只是記不住 */ }
  }
  ui.superCtl = loadSuper();

  function loadClientId() {
    var id = null;
    try { id = localStorage.getItem(CLIENT_KEY); } catch (e) { /* 忽略 */ }
    if (!id) {
      var arr = new Uint8Array(8);
      (window.crypto || window.msCrypto).getRandomValues(arr);
      id = "c" + Array.prototype.map.call(arr, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
      try { localStorage.setItem(CLIENT_KEY, id); } catch (e) { /* 忽略：本次分頁內仍可用 */ }
    }
    return id;
  }
  var clientId = loadClientId();
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

  // 物體圖示（gousei_art.js；使用者指定 2026-10-26：增加美術、可切換美術風格）。風格是「純文字」時回傳 null
  function artNode(theme, id, size) {
    var A = window.PriTestGouseiArt, it = theme.byId[id];
    if (!A || !it) return null;
    var svg = A.icon(theme.data.id, { id: id, cat: it.cat, tier: it.tier }, itemName(theme, id), size);
    if (!svg) return null;
    var span = el("span", { class: "gs-art" });
    span.innerHTML = svg;
    return span;
  }

  function artStyleSelect(themeId) {
    var A = window.PriTestGouseiArt;
    if (!A) return null;
    var select = el("select", { id: "gs-art-style", title: t("gs_art") }, A.STYLES.map(function (s) {
      return el("option", { value: s, selected: s === A.style(), text: "🎨 " + t("gs_art_" + s + (s === "none" ? "" : "_" + themeId)) });
    }));
    select.addEventListener("change", function () { A.setStyle(select.value); render(); });
    return select;
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
    if (room) return; // 連線模式的 state 在雲端
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
      if (s.mode === "coop" && !s.coop) return null;
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
    player.targets.forEach(function (id) {
      var it = theme.byId[id];
      var done = player.done.indexOf(id) >= 0;
      list.appendChild(el("li", { class: "gs-target" + (done ? " gs-done" : ""), "data-target": id }, [
        el("span", { class: "gs-target-tier", text: t(it.tier <= Core.MID_TIERS[1] ? "gs_tier_mid" : "gs_tier_high") }),
        artNode(theme, id, 40),
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
        text: t("gs_progress", { name: p.name, done: p.done.length, total: p.targets.length }) + (p.left ? t("gs_member_left") : "") }));
    });
    return el("div", { class: "gs-panel" }, [el("h2", { text: t("gs_progress_heading") }), list]);
  }

  // ---------------- 設定畫面 ----------------

  function renderSetup() {
    var box = el("div", { class: "gs-panel" }, [el("h2", { text: t("gs_setup") })]);
    box.appendChild(el("div", { class: "gs-field" }, [el("span", { class: "gs-label", text: t("gs_theme") }),
      radioGroup("gs-theme", THEMES, draft.themeId, "gs_theme_", function (v) { draft.themeId = v; if (draft.mode === "coop") render(); })]));
    box.appendChild(el("div", { class: "gs-field" }, [el("span", { class: "gs-label", text: t("gs_mode") }),
      radioGroup("gs-mode", MODES, draft.mode, "gs_mode_", function (v) { draft.mode = v; render(); })]));
    if (draft.mode === "coop") box.appendChild(coopBestNote(draft.themeId));
    if (draft.mode === "split" || draft.mode === "coop") {
      var online = el("input", { id: "gs-online", type: "checkbox", checked: draft.online,
        onchange: function () { draft.online = online.checked; } });
      box.appendChild(el("div", { class: "gs-field" }, [
        el("label", { class: "gs-check" }, [online, " " + t("gs_online_setup")]),
        el("span", { class: "gs-muted", text: t("gs_online_hint") })
      ]));
    }

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
    box.appendChild(el("p", { class: "gs-muted", text: t(draft.mode === "coop" ? "gs_coop_hint" : "gs_hint") }));
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
    ui.recipeOpen = {};
    ui.hintConfirm = null;
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
      var online = draft.online && (state.mode === "split" || state.mode === "coop");
      // 分別裝置一律先出 QR；合作模式只有連線同步時才需要 QR
      ui.screen = state.mode === "split" || online ? "qr" : "play";
      if (online) { createRoom(state); return; }
      save();
      render();
    });
  }

  // ---------------- 連線同步：房間 ----------------

  function isHost() { return !room || room.hostId === clientId; }
  // 手機只能在自己的回合操作；主機（與離線）可以替任何人操作
  function canAct() { return !room || room.me === null || ui.superCtl || (!!state && state.turn === room.me); }
  // 可以管理座位（加人、請人離開／回來）：離線、主機裝置，或超級控制中
  function canManage() { return !room || room.me === null || ui.superCtl; }

  function createRoom(initial) {
    var id = Storage.generateCloudGameId();
    ui.loading = true;
    render();
    Storage.rtSet(id, "cloud", "gousei", { stateJson: JSON.stringify(initial), hostId: clientId }).then(function () {
      ui.loading = false;
      // 開新局＝放棄本機舊局
      try { localStorage.removeItem(STORAGE_KEY); localStorage.setItem(ROOM_KEY, id); } catch (e) { /* 忽略 */ }
      enterRoom(id, null);
    });
  }

  function enterRoom(id, me) {
    if (room && room.unsubscribe) room.unsubscribe();
    room = { id: id, hostId: null, me: me, loaded: false, missing: false, unsubscribe: null };
    state = null;
    room.unsubscribe = Storage.rtSubscribe(id, "cloud", "gousei", function (v) {
      if (!room || room.id !== id) return;
      room.loaded = true;
      if (!v || !v.stateJson) {
        room.missing = true;
        state = null;
        render();
        return;
      }
      room.missing = false;
      room.hostId = v.hostId;
      applyRemote(JSON.parse(v.stateJson));
    });
    render();
  }

  // 遠端 state 更新：有新的合成就所有裝置都顯示結果；被復原則收起一切
  function applyRemote(next) {
    var before = state;
    state = next;
    if (before && next.log.length > before.log.length) {
      ui.lastEntry = next.log[next.log.length - 1];
      ui.slots = emptySlots();
      ui.trioChoice = null;
      ui.junkWarn = null;
      ui.revealedFor = null;
      ui.playError = "";
    } else if (before && next.log.length < before.log.length) {
      resetTurnUi();
    } else if (!before) {
      ui.slots = emptySlots(); // 剛進房間：先用目前已知的槽數，theme 載入完成後下面還會再修正一次
    }
    ui.slots = ui.slots.map(function (id) { return id && next.pool.indexOf(id) >= 0 ? id : null; });
    if (!themes[next.themeId]) {
      loadTheme(next.themeId, function (err) {
        if (err) ui.error = t("gs_load_failed");
        else ui.slots = emptySlots();
        render();
      });
      return;
    }
    render();
  }

  function leaveRoom() {
    if (room && room.unsubscribe) room.unsubscribe();
    room = null;
    try { localStorage.removeItem(ROOM_KEY); } catch (e) { /* 忽略 */ }
  }

  // 所有改變 state 的操作的共用入口。fn(s) 回傳 { state, entry? }，不合法時 throw（訊息為 i18n key）。
  // 離線：直接套用。連線：在雲端最新 state 上以 transaction 執行（可能重試，fn 必須是純函式）。
  function mutate(fn, done) {
    ui.playError = "";
    if (!room) {
      var r;
      try { r = fn(state); } catch (e) { ui.playError = t(e.message); render(); return; }
      state = r.state;
      save();
      done(r);
      return;
    }
    if (ui.busy) return;
    var last = null, errKey = null;
    ui.busy = true;
    render();
    Storage.rtTransaction(room.id, "cloud", "gousei/stateJson", function (cur) {
      if (!cur) { errKey = "gs_online_gone"; return undefined; }
      try {
        last = fn(JSON.parse(cur));
        errKey = null;
        return JSON.stringify(last.state);
      } catch (e) {
        errKey = e.message;
        return undefined; // 中止 transaction
      }
    }).then(function (committed) {
      ui.busy = false;
      if (errKey || committed === null) {
        ui.playError = t(errKey || "gs_err_network");
        render();
        return;
      }
      state = JSON.parse(committed);
      done(last);
    });
  }

  function resetTurnUi() {
    ui.revealedFor = null;
    ui.slots = emptySlots();
    ui.trioChoice = null;
    ui.lastEntry = null;
    ui.confirmNew = false;
    ui.confirmEnd = false;
    ui.hintConfirm = null;
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
    var formula = itemName(theme, e.a) + " ＋ " + itemName(theme, e.b) + (e.c ? " ＋ " + itemName(theme, e.c) : "") + " →";
    return el("div", { id: "gs-result", class: "gs-panel gs-result" + (e.achieved ? " gs-achieved" : "") }, [
      el("h2", { text: t("gs_result_heading", { name: p.name }) }),
      el("p", { class: "gs-formula", text: formula }),
      el("p", { class: "gs-big gs-result-item", "data-result": e.result }, [artNode(theme, e.result, 120), el("span", { text: itemName(theme, e.result) })]),
      el("p", { class: "gs-muted", text: (theme.junkSet[e.result] ? t("gs_junk_meta") : t("gs_target_meta", { cat: catName(theme, it.cat), tier: it.tier })) + "　" + status }),
      e.otherOption ? el("p", { class: "gs-muted", text: t("gs_trio_other_option", { name: itemName(theme, e.otherOption) }) }) : null,
      e.achieved ? el("p", { class: "gs-big", text: achievedText(p) }) : null,
      state.winner ? null : el("div", { class: "gs-actions" }, [
        el("button", { id: "gs-next", type: "button", class: "gs-primary", text: t("gs_next"), onclick: nextTurn })
      ])
    ]);
  }

  // 「達成任務！（n/總數）」：合作模式算全隊的共同目標
  function achievedText(p) {
    if (state.coop) return t("gs_coop_achieved", { done: state.coop.done.length, total: state.coop.targets.length });
    return t("gs_achieved", { done: p.done.length, total: p.targets.length });
  }

  function nextTurn() {
    resetTurnUi();
    render();
  }

  // allowTrio 的主題（目前只有世界美食）：工作台有 3 槽，填 2 槽＝一般 2 材料合成，填滿 3 槽才走
  // 3 材料合成（Core.combineTrio）；配方剛好有主產物＋副產物時，先讓玩家二選一（ui.trioChoice）才真正送出。
  function renderSlots(theme) {
    var maxSlots = theme.data.allowTrio ? 3 : 2;
    function slot(i) {
      var id = ui.slots[i];
      return el("button", { id: "gs-slot-" + i, type: "button", class: "gs-slot" + (id ? " gs-filled" : ""),
        onclick: function () { ui.slots[i] = null; ui.junkWarn = null; ui.trioChoice = null; render(); } },
        id ? [artNode(theme, id, 40), itemName(theme, id)] : [t("gs_slot_empty")]);
    }
    var filled = ui.slots.filter(function (id) { return id; });
    var ready = filled.length >= 2;
    var slotEls = [];
    for (var i = 0; i < maxSlots; i++) {
      if (i > 0) slotEls.push(el("span", { class: "gs-plus", text: "＋" }));
      slotEls.push(slot(i));
    }
    var actions;
    if (ui.trioChoice) {
      actions = el("div", { id: "gs-trio-choice", class: "gs-junk-warn" }, [
        el("p", { text: t("gs_trio_choose") }),
        el("div", { class: "gs-actions" }, ui.trioChoice.options.map(function (id) {
          return el("button", { type: "button", class: "gs-primary", onclick: function () { doCombine(true, id); } },
            [artNode(theme, id, 40), itemName(theme, id)]);
        }).concat([
          el("button", { id: "gs-trio-choice-cancel", type: "button", text: t("gs_clear"),
            onclick: function () { ui.trioChoice = null; render(); } })
        ]))
      ]);
    } else if (ui.junkWarn) {
      var w = ui.junkWarn;
      actions = el("div", { id: "gs-junk-warn", class: "gs-junk-warn" }, [
        el("p", { text: w.dup ? t("gs_dup_warn_seen", { r: w.results.map(function (id) { return itemName(theme, id); }).join("、") })
            + (w.others && w.others.length ? t("gs_dup_warn_other", { r: w.others.map(function (id) { return itemName(theme, id); }).join("、") }) : "")
          : w.junkMaterial ? t("gs_junk_warn_material")
          : t("gs_junk_warn_seen", { r: itemName(theme, w.result) }) }),
        el("div", { class: "gs-actions" }, [
          el("button", { id: "gs-combine-anyway", type: "button", text: t("gs_junk_warn_go"), onclick: function () { doCombine(true); } }),
          el("button", { id: "gs-junk-warn-cancel", type: "button", class: "gs-primary", text: t("gs_junk_warn_change"),
            onclick: function () { ui.slots = emptySlots(); ui.junkWarn = null; render(); } })
        ])
      ]);
    } else {
      actions = el("div", { class: "gs-actions" }, [
        el("button", { id: "gs-combine", type: "button", class: "gs-primary", disabled: !ready || ui.busy, text: t("gs_combine"), onclick: function () { doCombine(false); } }),
        el("button", { id: "gs-clear", type: "button", text: t("gs_clear"), onclick: function () { ui.slots = emptySlots(); render(); } })
      ]);
    }
    return el("div", { class: "gs-panel gs-workbench" }, [
      el("div", { class: "gs-slots" }, slotEls),
      actions,
      ui.playError ? el("p", { id: "gs-play-error", class: "gs-error", text: ui.playError }) : null
    ]);
  }

  // force＝false 時，已知會合出廢料的組合先提示（見 Core.knownJunk／knownJunkTrio）；語音模式一律直接合成。
  // chosen：3 材料合成剛好有主產物＋副產物時，玩家在 ui.trioChoice 選定的結果；其餘情況不需要。
  function doCombine(force, chosen) {
    var theme = themes[state.themeId];
    ui.confirmNew = false;
    var filled = ui.slots.filter(function (id) { return id; });
    var isTrio = filled.length === 3;
    if (!force) {
      var known = isTrio ? Core.knownJunkTrio(theme, state, filled[0], filled[1], filled[2])
        : Core.knownJunk(theme, state, filled[0], filled[1]);
      if (known) { ui.junkWarn = known; render(); return; }
      // 合作模式：紀錄裡（任何裝置）合過同一組合就先提醒（2026-11-04）
      if (state.coop) {
        var dup = isTrio ? Core.knownCombo(theme, state, filled[0], filled[1], filled[2]) : Core.knownCombo(theme, state, filled[0], filled[1]);
        if (dup) { ui.junkWarn = { dup: true, results: dup.results, others: dup.others }; render(); return; }
      }
    }
    ui.junkWarn = null;
    if (isTrio && chosen == null) {
      var options = Core.combineTrio(theme, filled[0], filled[1], filled[2]).options;
      if (options.length > 1) { ui.trioChoice = { options: options }; render(); return; }
      chosen = options[0];
    }
    ui.trioChoice = null;
    var logLen = state.log.length, me = room ? room.me : null, superOn = !!ui.superCtl;
    mutate(function (s) {
      // 按下之後別台先合成了（紀錄變了）就作廢，請玩家看過新畫面再操作
      if (s.log.length !== logLen) throw new Error("gs_err_stale");
      if (me !== null && s.turn !== me && !superOn) throw new Error("gs_err_turn");
      return isTrio ? Core.applyCombineTrio(theme, s, filled[0], filled[1], filled[2], chosen)
        : Core.applyCombine(theme, s, filled[0], filled[1]);
    }, function (res) {
      ui.lastEntry = res.entry;
      ui.slots = emptySlots();
      ui.trioChoice = null;
      ui.revealedFor = null;
      render();
    });
  }

  function pickItem(id) {
    if (ui.lastEntry || state.winner || !canAct()) return;
    ui.confirmNew = false;
    ui.junkWarn = null;
    ui.trioChoice = null;
    var idx = ui.slots.indexOf(null);
    if (idx >= 0) ui.slots[idx] = id;
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
    // 合作模式：選了材料後，會湊成「紀錄中合過的組合」的物品先調暗（還是可以選，按合成時另有提醒）
    var filled = ui.slots.filter(function (x) { return x; });
    var dim = state.coop && filled.length < (theme.data.allowTrio ? 3 : 2) ? Core.comboPartners(state, filled) : {};
    matched.slice(0, POOL_LIMIT).forEach(function (id) {
      var picked = ui.slots.indexOf(id) >= 0, dimmed = !picked && dim[id];
      // 編號＝池子順序（1 起算），語音可以說「3 加 7」
      list.appendChild(el("button", { type: "button", class: "gs-item gs-cat-" + theme.byId[id].cat + (picked ? " gs-picked" : "") + (dimmed ? " gs-dim" : ""), "data-item": id,
        title: dimmed ? t("gs_dim_hint") : null,
        onclick: function () { pickItem(id); } }, [
        el("span", { class: "gs-item-no", text: String(state.pool.indexOf(id) + 1) }), artNode(theme, id, 34), itemName(theme, id)
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
            mutate(function (s) { return { state: Core.clearJunk(theme, s) }; }, function () {
              ui.junkWarn = null;
              ui.trioChoice = null;
              var n = ui.slots.length;
              var kept = ui.slots.filter(function (id) { return id && !theme.junkSet[id]; });
              while (kept.length < n) kept.push(null);
              ui.slots = kept;
              render();
            });
          } }) : null
      ]),
      el("div", { class: "gs-field" }, [search, select, artStyleSelect(theme.data.id)]),
      list
    ]);
  }

  function renderLog(theme) {
    var list = el("ol", { id: "gs-log", class: "gs-log", reversed: true });
    state.log.slice(-LOG_LIMIT).reverse().forEach(function (e) {
      // 3 材料（世界美食）的紀錄也列出第 3 個材料（2026-11-04）
      list.appendChild(el("li", { text: t(e.c ? "gs_log_entry3" : "gs_log_entry", { round: e.round, name: playerById(e.playerId).name,
        a: itemName(theme, e.a), b: itemName(theme, e.b), c: e.c ? itemName(theme, e.c) : "", r: itemName(theme, e.result) }) + (e.achieved ? t("gs_log_achieved") : "") }));
    });
    return el("details", { class: "gs-panel" }, [el("summary", { text: t("gs_log") }), list]);
  }

  function superButton() {
    return el("div", { class: "gs-actions gs-super" }, [
      ui.superCtl ? el("span", { id: "gs-super-on", class: "gs-badge gs-super-badge", text: "🔑 " + t("gs_super_on") }) : null,
      el("button", { id: "gs-super", type: "button", class: "gs-link", text: ui.superCtl ? t("gs_super_off") : "🔑 " + t("gs_super"),
        onclick: function () {
          if (ui.superCtl) { setSuper(false); render(); return; }
          var pw = window.prompt(t("gs_super_prompt"));
          if (pw === null) return;
          if (pw === SUPER_PASS) { setSuper(true); ui.showMembers = true; }
          else ui.playError = t("gs_super_wrong");
          render();
        } })
    ]);
  }

  // 玩家（座位）：中途加入、離開、回來；超級控制時可以指定輪到誰
  function renderMembers(theme) {
    var manage = canManage(), over = !!state.winner;
    var list = el("ul", { id: "gs-members", class: "gs-members" });
    state.players.forEach(function (p, i) {
      list.appendChild(el("li", { "data-player": p.id, class: (p.left ? "gs-left" : "") + (i === state.turn && !over ? " gs-current" : "") }, [
        el("span", { text: (i === state.turn && !over ? "▶ " : "") + p.name + (p.left ? t("gs_member_left") : "") + (room && room.me === i ? t("gs_member_you") : "") }),
        manage && !over ? el("button", { type: "button", class: "gs-member-btn", "data-seat": String(i), disabled: ui.busy,
          text: t(p.left ? "gs_member_back" : "gs_member_leave"),
          onclick: function () {
            if (!p.left && !window.confirm(t("gs_member_leave_confirm", { name: p.name }))) return;
            mutate(function (s2) { return Core.setLeft(s2, i, !p.left); }, function () { resetTurnUi(); save(); render(); });
          } }) : null,
        ui.superCtl && !over && !p.left && i !== state.turn ? el("button", { type: "button", class: "gs-member-btn", "data-turn": String(i), disabled: ui.busy,
          text: t("gs_member_turn"), onclick: function () {
            mutate(function (s2) { return Core.setTurn(s2, i); }, function () { resetTurnUi(); save(); render(); });
          } }) : null
      ]));
    });
    var box = el("div", { id: "gs-members-panel", class: "gs-panel" }, [el("h2", { text: t("gs_members_heading") }), list]);
    if (manage && !over && state.players.length < Core.MAX_PLAYERS) {
      var nameIn = el("input", { id: "gs-join-name", type: "text", class: "gs-name-input", maxlength: 20, value: ui.joinName,
        placeholder: t("gs_player_default", { n: state.players.length + 1 }), oninput: function (e) { ui.joinName = e.target.value; } });
      box.appendChild(el("div", { class: "gs-actions" }, [nameIn,
        el("button", { id: "gs-join-add", type: "button", disabled: ui.busy, text: "➕ " + t("gs_member_add"), onclick: function () {
          var nm = ui.joinName.trim() || t("gs_player_default", { n: state.players.length + 1 });
          mutate(function (s2) { return Core.addPlayer(theme, s2, nm); }, function () { ui.joinName = ""; save(); render(); });
        } })]));
      if (room) {
        var url = newcomerUrl();
        var canvas = el("canvas", { id: "gs-newjoin-qr", class: "gs-qr" });
        window.PriTestQRCode.renderToCanvas(canvas, url, { level: "L", scale: 4, margin: 2 });
        box.appendChild(el("p", { class: "gs-muted", text: t("gs_member_link_hint") }));
        box.appendChild(canvas);
        box.appendChild(el("input", { id: "gs-newjoin-url", type: "text", readonly: true, value: url, class: "gs-qr-url" }));
      }
    }
    box.appendChild(superButton());
    return box;
  }
  function newcomerUrl() { return window.location.origin + window.location.pathname + "?room=" + room.id + "&newjoin=1"; }

  // 用「中途加入」連結打開的手機：先輸入名字加入，拿到自己的座位
  function renderNewcomer(theme) {
    var full = state.players.length >= Core.MAX_PLAYERS || !!state.winner;
    var nameIn = el("input", { id: "gs-newcomer-name", type: "text", class: "gs-name-input", maxlength: 20, value: ui.joinName,
      oninput: function (e) { ui.joinName = e.target.value; } });
    var seats = el("div", { class: "gs-actions" });
    state.players.forEach(function (p, i) {
      if (!p.left) return;
      seats.appendChild(el("button", { type: "button", "data-reclaim": String(i), disabled: ui.busy, text: t("gs_newcomer_reclaim", { name: p.name }),
        onclick: function () { mutate(function (s2) { return Core.setLeft(s2, i, false); }, function () { takeSeat(i); }); } }));
    });
    app.appendChild(el("div", { id: "gs-newcomer", class: "gs-panel" }, [
      el("h2", { text: t("gs_newcomer_heading") }),
      el("p", { class: "gs-muted", text: t(state.coop ? "gs_newcomer_hint_coop" : "gs_newcomer_hint") }),
      full ? el("p", { class: "gs-error", text: t("gs_join_err_full") }) : el("div", { class: "gs-actions" }, [
        nameIn,
        el("button", { id: "gs-newcomer-join", type: "button", class: "gs-primary", disabled: ui.busy, text: t("gs_newcomer_join"), onclick: function () {
          var nm = ui.joinName.trim() || t("gs_player_default", { n: state.players.length + 1 });
          var idx = null;
          mutate(function (s2) { var r = Core.addPlayer(theme, s2, nm); idx = r.index; return r; }, function () { takeSeat(idx); });
        } })
      ]),
      seats.childNodes.length ? el("p", { class: "gs-muted", text: t("gs_newcomer_reclaim_hint") }) : null,
      seats.childNodes.length ? seats : null,
      ui.playError ? el("p", { class: "gs-error", text: ui.playError }) : null
    ]));
  }
  function takeSeat(i) {
    room.me = i;
    ui.newcomer = false;
    ui.joinName = "";
    // 網址換成這個座位的連結：重新整理還是同一個人
    try { window.history.replaceState(null, "", joinUrl(i)); } catch (e) { /* 改不了網址也沒關係 */ }
    render();
  }

  function renderFooter() {
    var seed = el("p", { class: "gs-muted", text: t("gs_seed", { seed: state.seed }) });
    if (!isHost()) return el("div", {}, [seed]);
    var actions = el("div", { class: "gs-actions" }, [
      el("button", { id: "gs-undo", type: "button", disabled: !state.prev || ui.busy, text: t("gs_undo"), onclick: function () {
        var logLen = state.log.length;
        mutate(function (s) {
          if (s.log.length !== logLen) throw new Error("gs_err_stale");
          var back = Core.undo(s);
          if (!back) throw new Error("gs_err_stale");
          return { state: back };
        }, function () {
          // 復原後所有任務一律收起，避免上一位的任務被下一位看到
          resetTurnUi();
          render();
        });
      } }),
      state.mode === "split" || (state.mode === "coop" && room) ? el("button", { id: "gs-show-qr", type: "button", text: t("gs_qr_button"),
        onclick: function () { ui.screen = "qr"; ui.qrFor = null; render(); } }) : null,
      state.coop && !state.winner ? el("button", { id: "gs-coop-end", type: "button", disabled: ui.busy,
        text: ui.confirmEnd ? t("gs_coop_end_confirm") : t("gs_coop_end"), onclick: function () {
          if (!ui.confirmEnd) { ui.confirmEnd = true; render(); return; }
          ui.confirmEnd = false;
          var logLen = state.log.length;
          mutate(function (s) {
            if (s.log.length !== logLen) throw new Error("gs_err_stale");
            return Core.endCoop(s);
          }, function () { resetTurnUi(); render(); });
        } }) : null,
      el("button", { id: "gs-new-game", type: "button", text: ui.confirmNew ? t("gs_new_game_confirm") : t("gs_new_game"),
        onclick: function () {
          if (!ui.confirmNew) { ui.confirmNew = true; render(); return; }
          // 連線中：刪除房間，手機會看到「這局已結束」
          if (room) { Storage.rtSet(room.id, "cloud", "gousei", null); leaveRoom(); }
          state = null;
          ui.cat = "all";
          ui.search = "";
          resetTurnUi();
          ui.screen = "play";
          save();
          render();
        } })
    ]);
    return el("div", {}, [actions, room ? el("p", { id: "gs-online-note", class: "gs-muted", text: t("gs_online_on") }) : null, seed]);
  }

  function renderPlay(theme) {
    if (state.winner && state.coop) {
      app.appendChild(renderCoopScore(theme));
    } else if (state.winner) {
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
    var phone = room && room.me !== null;
    if (phone) app.appendChild(renderMyTargets(theme));
    else app.appendChild(renderVoiceBar());
    if (ui.lastEntry) app.appendChild(renderResult(theme));
    else if (!state.winner && canAct()) app.appendChild(renderSlots(theme));
    else if (!state.winner) app.appendChild(el("div", { id: "gs-wait", class: "gs-panel" }, [
      el("p", { class: "gs-big", text: t("gs_wait_turn", { name: Core.currentPlayer(state).name }) })
    ]));
    if (!state.winner) app.appendChild(renderPool(theme));
    // 合作：共同目標公開；同一裝置：池子下方可展開各玩家的任務（含進度）；分別裝置：任務在手機上，這裡只顯示進度
    if (state.coop) {
      if (!state.winner) app.appendChild(renderCoopPanel(theme));
    } else if (state.mode === "shared" && !state.winner) {
      app.appendChild(el("div", { class: "gs-panel" }, [el("h2", { text: t("gs_player_targets_heading") }), playerTargetsList(theme)]));
    } else {
      app.appendChild(progressPanel());
    }
    app.appendChild(renderLog(theme));
    // 玩家（中途加入／離開、超級控制）：預設收起
    app.appendChild(el("div", { class: "gs-actions" }, [el("button", { id: "gs-members-toggle", type: "button",
      text: "👥 " + t(ui.showMembers ? "gs_members_hide" : "gs_members_show", { n: Core.activeCount(state), m: state.players.length }),
      onclick: function () { ui.showMembers = !ui.showMembers; render(); } })]));
    if (ui.showMembers) app.appendChild(renderMembers(theme));
    app.appendChild(renderFooter());
  }

  // ---------------- 合作模式 ----------------

  function coopStatsText() {
    var sc = Core.coopScore(state);
    return t("gs_coop_stats", { done: sc.done, total: sc.total, rounds: sc.rounds, fails: sc.fails, combos: sc.combos });
  }

  // 共同目標（公開）＋統計＋各玩家的貢獻
  function renderCoopPanel(theme) {
    var contrib = el("ul", { class: "gs-progress" });
    state.players.forEach(function (p, i) {
      contrib.appendChild(el("li", { class: i === state.turn && !state.winner ? "gs-current" : "", "data-player": p.id,
        text: t("gs_coop_contrib", { name: p.name, n: p.done.length }) }));
    });
    var hints = Core.coopHints(state);
    var list = targetList(theme, { targets: state.coop.targets, done: state.coop.done }, "gs-coop-targets");
    var hinted = state.coop.hinted || [];
    // 點目標：已解鎖 → 開關配方；還有提示次數 → 用 1 次解鎖（按兩次確認）
    Array.prototype.forEach.call(list.childNodes, function (li) {
      var id = li.getAttribute("data-target");
      var unlocked = hinted.indexOf(id) >= 0;
      var canUse = !unlocked && hints.left > 0 && !state.winner;
      if (!unlocked && !canUse) return;
      li.className += " gs-hintable" + (unlocked ? " gs-hint-unlocked" : "");
      var label = unlocked ? t(ui.recipeOpen[id] ? "gs_hint_hide" : "gs_hint_show")
        : (ui.hintConfirm === id ? t("gs_hint_use_confirm") : t("gs_hint_use"));
      li.appendChild(el("button", { type: "button", class: "gs-hint-btn" + (canUse ? " gs-primary" : ""), "data-hint": id,
        disabled: ui.busy, text: label, onclick: function () {
          if (unlocked) { ui.recipeOpen[id] = !ui.recipeOpen[id]; render(); return; }
          if (ui.hintConfirm !== id) { ui.hintConfirm = id; render(); return; }
          ui.hintConfirm = null;
          mutate(function (s) { return Core.useCoopHint(s, id); }, function () {
            ui.recipeOpen[id] = true;
            save();
            render();
          });
        } }));
      if (unlocked && ui.recipeOpen[id]) li.appendChild(recipeTree(theme, id, id, 0));
    });
    return el("div", { id: "gs-coop", class: "gs-panel" }, [
      el("h2", { text: t("gs_coop_heading") }),
      el("p", { id: "gs-coop-stats", class: "gs-coop-stats", text: coopStatsText() }),
      el("p", { id: "gs-coop-hints", class: "gs-coop-hints" + (hints.left ? " gs-hint-ready" : ""),
        text: t(hints.left ? "gs_hint_left" : "gs_hint_none", { n: hints.left, every: Core.HINT_EVERY_FAILS, next: hints.toNext }) }),
      list,
      contrib
    ]);
  }

  // 配方樹：每個材料都可以再點開看它的配方（path 用來記哪些節點展開，純 UI、不存檔）
  var RECIPE_SHOW = 2;
  var RECIPE_DEPTH = 8;
  function recipeTree(theme, id, path, depth) {
    var box = el("div", { class: "gs-recipe", "data-recipe": id });
    var it = theme.byId[id];
    if (it && it.cat === "basic") {
      box.appendChild(el("p", { class: "gs-muted", text: t("gs_hint_basic") }));
      return box;
    }
    var recipes = Core.recipesFor(theme, id, RECIPE_SHOW);
    if (!recipes.length) {
      box.appendChild(el("p", { class: "gs-muted", text: t("gs_hint_no_recipe") }));
      return box;
    }
    recipes.forEach(function (ids, ri) {
      var row = el("div", { class: "gs-recipe-row" }, [
        el("span", { class: "gs-recipe-label", text: t(ri ? "gs_hint_alt" : "gs_hint_recipe") })
      ]);
      var subs = [];
      ids.forEach(function (mat, mi) {
        if (mi) row.appendChild(el("span", { class: "gs-recipe-plus", text: "＋" }));
        var sub = path + "/" + ri + "." + mi + ":" + mat;
        var basic = theme.byId[mat] && theme.byId[mat].cat === "basic";
        var inPool = state.pool.indexOf(mat) >= 0;
        var canOpen = !basic && depth + 1 < RECIPE_DEPTH;
        row.appendChild(el("button", { type: "button", class: "gs-recipe-mat" + (inPool ? " gs-in-pool" : "") + (ui.recipeOpen[sub] ? " gs-open" : ""),
          "data-mat": mat, disabled: !canOpen, title: inPool ? t("gs_hint_in_pool") : "",
          onclick: function () { ui.recipeOpen[sub] = !ui.recipeOpen[sub]; render(); } }, [
          artNode(theme, mat, 24), itemName(theme, mat) + (inPool ? " ✓" : "")
        ]));
        if (ui.recipeOpen[sub] && canOpen) subs.push(recipeTree(theme, mat, sub, depth + 1));
      });
      box.appendChild(row);
      subs.forEach(function (n) { box.appendChild(n); });
    });
    return box;
  }

  function loadCoopBest() {
    try {
      var o = JSON.parse(localStorage.getItem(COOP_BEST_KEY) || "{}");
      return o && typeof o === "object" ? o : {};
    } catch (e) {
      return {};
    }
  }

  // 結束時更新該主題的最佳紀錄（同分時回合少者優先），回傳這一局是否為最佳紀錄。
  // render 時呼叫，同一局重複呼叫不會改變結果。
  function recordCoopBest(sc) {
    var all = loadCoopBest();
    var cur = all[state.themeId];
    var better = !cur || sc.score > cur.score || (sc.score === cur.score && sc.rounds < cur.rounds);
    if (better && sc.score > 0) {
      all[state.themeId] = { score: sc.score, done: sc.done, total: sc.total, rounds: sc.rounds, fails: sc.fails,
        players: state.players.length, seed: state.seed };
      try { localStorage.setItem(COOP_BEST_KEY, JSON.stringify(all)); } catch (e) { /* 私密模式等：只是記不住 */ }
    }
    // 這一局就是最佳紀錄（重畫時也維持「新紀錄」顯示）
    var b = all[state.themeId];
    return !!b && b.seed === state.seed && b.score === sc.score && b.rounds === sc.rounds;
  }

  function coopBestNote(themeId) {
    var b = loadCoopBest()[themeId];
    return el("p", { id: "gs-coop-best", class: "gs-muted", text: b
      ? t("gs_coop_best", { score: b.score, done: b.done, total: b.total, rounds: b.rounds, fails: b.fails, players: b.players })
      : t("gs_coop_best_none") });
  }

  function renderCoopScore(theme) {
    var sc = Core.coopScore(state);
    var isBest = recordCoopBest(sc);
    return el("div", { id: "gs-coop-score", class: "gs-panel" + (sc.complete ? " gs-achieved" : "") }, [
      el("p", { class: "gs-big", text: t(sc.complete ? "gs_coop_clear" : "gs_coop_ended") }),
      el("p", { id: "gs-coop-score-value", class: "gs-coop-score", text: t("gs_coop_score", { score: sc.score }) }),
      el("p", { class: "gs-coop-stats", text: coopStatsText() }),
      el("p", { class: "gs-muted", text: t("gs_coop_formula") }),
      isBest ? el("p", { id: "gs-coop-new-best", class: "gs-big", text: t("gs_coop_new_best") }) : coopBestNote(state.themeId),
      targetList(theme, { targets: state.coop.targets, done: state.coop.done }, "gs-coop-targets"),
      el("ul", { class: "gs-progress" }, state.players.map(function (p) {
        return el("li", { "data-player": p.id, text: t("gs_coop_contrib", { name: p.name, n: p.done.length }) });
      }))
    ]);
  }

  // 連線同步的手機：自己的任務（預設收起）＋輪到自己時的提示
  function seatButton() {
    var me = state.players[room.me];
    if (state.winner || !me) return null;
    return el("button", { id: "gs-my-seat", type: "button", class: me.left ? "gs-primary" : "gs-link", disabled: ui.busy,
      text: t(me.left ? "gs_my_back" : "gs_my_leave"), onclick: function () {
        if (!me.left && !window.confirm(t("gs_my_leave_confirm"))) return;
        var i = room.me;
        mutate(function (s2) { return Core.setLeft(s2, i, !me.left); }, function () { resetTurnUi(); render(); });
      } });
  }
  function renderMyTargets(theme) {
    var me = state.players[room.me];
    if (!me) return el("div", { id: "gs-my-targets", class: "gs-panel" }, [el("p", { class: "gs-error", text: t("gs_join_err_seat") })]);
    if (me.left) {
      return el("div", { id: "gs-my-targets", class: "gs-panel" }, [
        el("h2", { text: t("gs_online_me", { name: me.name }) }),
        el("p", { class: "gs-muted", text: t("gs_my_left") }), seatButton()
      ]);
    }
    var mine = !state.winner && state.turn === room.me;
    if (state.coop) {
      // 合作模式沒有個人任務：共同目標在下方公開，這裡只顯示身分與輪到自己的提示
      return el("div", { id: "gs-my-targets", class: "gs-panel" + (mine ? " gs-current" : "") }, [
        el("h2", { text: t("gs_online_me", { name: me.name }) }),
        mine ? el("p", { class: "gs-big", text: t("gs_your_turn") }) : null,
        seatButton()
      ]);
    }
    var box = el("div", { id: "gs-my-targets", class: "gs-panel" + (mine ? " gs-current" : "") }, [
      el("h2", { text: t("gs_online_me", { name: me.name }) }),
      mine ? el("p", { class: "gs-big", text: t("gs_your_turn") }) : null,
      el("p", { class: "gs-muted", text: t("gs_progress_short", { done: me.done.length, total: me.targets.length }) }),
      el("button", { id: "gs-join-toggle", type: "button", text: t(ui.revealed ? "gs_hide_targets" : "gs_show_targets"),
        onclick: function () { ui.revealed = !ui.revealed; render(); } }),
      seatButton()
    ]);
    if (ui.revealed) box.appendChild(targetList(theme, me, "gs-join-targets"));
    return box;
  }

  // ---------------- 分別裝置：QR 畫面 ----------------
  // 一次只顯示一位玩家的 QR，避免別人順便掃到。手機端只靠 主題.seed.人數.編號 自己算任務。

  function joinUrl(index) {
    return window.location.origin + window.location.pathname + "?join=" + Core.joinParam(state, index) + (room ? "&room=" + room.id : "");
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
    // 遠端更新會整頁重畫：保留搜尋框的焦點與游標
    var active = document.activeElement;
    var caret = active && active.id === "gs-pool-search" ? active.selectionStart : null;
    renderInner();
    if (caret !== null) {
      var input = document.getElementById("gs-pool-search");
      if (input) { input.focus(); try { input.setSelectionRange(caret, caret); } catch (e) { /* 忽略 */ } }
    }
  }

  function renderInner() {
    app.innerHTML = "";
    if (room && (!room.loaded || room.missing || !state)) {
      app.appendChild(el("p", { id: "gs-online-status", class: room.missing ? "gs-error" : "gs-muted",
        text: room.missing ? t("gs_online_gone") : t("gs_online_connecting") }));
      if (room.missing && room.me === null) {
        app.appendChild(el("div", { class: "gs-actions" }, [el("button", { id: "gs-online-leave", type: "button", text: t("gs_new_game"),
          onclick: function () { leaveRoom(); state = null; resetTurnUi(); render(); } })]));
      }
      return;
    }
    if (join && !room) { renderJoin(); return; }
    if (ui.loading && state) { app.appendChild(el("p", { class: "gs-muted", text: t("gs_online_connecting") })); return; }
    if (!state) { renderSetup(); return; }
    var theme = themes[state.themeId];
    if (!theme) {
      app.appendChild(el("p", { class: "gs-muted", text: ui.error || t("gs_loading") }));
      return;
    }
    if (ui.newcomer && room && room.me === null) { renderNewcomer(theme); return; }
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
    if (e.achieved) parts.push(achievedText(p));
    if (state.winner && state.coop) parts.push(t("gs_coop_score", { score: Core.coopScore(state).score }));
    else if (state.winner) parts.push(t("gs_winner", { name: playerById(state.winner).name }));
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
    // 合作模式：合過的組合也要先確認（2026-11-04）
    if (!known && state.coop) { var dup = Core.knownCombo(theme, state, best.a, best.b); if (dup) known = { dup: true, results: dup.results }; }
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
    var junk = known && known.result, dup = known && known.dup;
    if (junk) names.r = itemName(theme, junk);
    if (dup) names.r = known.results.map(function (id) { return itemName(theme, id); }).join("、");
    var kind = dup ? "dup" : junk ? "junk" : "confirm";
    voice.pending = { a: pick.a, b: pick.b };
    voice.status = t("gs_voice_" + kind + "_status", names);
    render();
    speak([t("gs_voice_" + kind + "_q", names)], function () {
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
      var roomId = params.get("room");
      if (!join.invalid) {
        loadTheme(join.themeId, function (err) {
          if (err) join = { invalid: true };
          render();
        });
        if (roomId && ROOM_RE.test(roomId)) enterRoom(roomId, join.index);
      }
      render();
      return;
    }
    // 中途加入的連結：?room=<id>&newjoin=1（先輸入名字拿座位，不會變成主機）
    var nj = params.get("room");
    if (params.has("newjoin") && nj && ROOM_RE.test(nj)) { ui.newcomer = true; enterRoom(nj, null); return; }
    var savedRoom = null;
    try { savedRoom = localStorage.getItem(ROOM_KEY); } catch (e) { /* 忽略 */ }
    if (savedRoom && ROOM_RE.test(savedRoom)) { enterRoom(savedRoom, null); return; }
    state = load();
    if (state) {
      loadTheme(state.themeId, function (err) {
        if (err) ui.error = t("gs_load_failed");
        else ui.slots = emptySlots(); // 重新整理：theme 才剛載入，槽數（2 或 3）要重算
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
    _debugRoom: function () { return room ? { id: room.id, hostId: room.hostId, me: room.me, clientId: clientId } : null; },
    // 測試用：模擬一次語音辨識結果（候選字串陣列）
    _voiceHeard: function (alts, isFinal) { onHeard(alts, isFinal !== false); },
    _pinyinReady: function () { return pinyinState === "ready"; },
    _wakeTemplates: function () { return wakeTemplates(); },
    _voiceOn: function () { return voice.on; }
  };
  init();
})();
