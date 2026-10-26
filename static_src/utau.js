// 我不會唱歌（utau）UI。規則全部在 utau_core.js，這裡只負責畫面、輸入、存讀檔與播放。
// 題目遮蔽（ui.revealed）刻意不存進 state：重新整理後回到遮蔽畫面，避免其他人看到題目。
// 進階模式：全體一起猜（沒有出題者），每題由大家挑最多 3 種版本來聽，可公開年代／歌手當提示。
//   音檔從 utau_pack.js（IndexedDB 題庫包）取出。iOS 只允許在點擊當下呼叫 play()，
//   所以每輪一開始就先把音檔放進 <audio>（prepareAudio），按鈕只做同步的 play()。
// 夢想模式：YouTube IFrame Player API。render() 會清空 #ut-app，iframe 一被移動就會重新載入，
//   所以播放器放在 body 底下的浮動卡片（yt.host），用遮罩蓋住畫面讓人看不到影片標題與縮圖。
(function () {
  "use strict";

  var Songs = window.PriTestUtauSongs;
  var Core = window.PriTestUtauCore;
  var Pack = window.PriTestUtauPack;
  var STORAGE_KEY = "pritest-utau-state";
  var CONFIG_KEY = "pritest-utau-config";
  var MIN_PLAYERS = 2;
  var MAX_PLAYERS = 12;
  var MODES = ["basic", "advanced", "dream"];
  var app = document.getElementById("ut-app");
  if (!app) return;

  var state = null;
  var draft = null; // 設定畫面的草稿
  var ui = { revealed: false, aiCorrect: false, correct: {}, error: "", packMsg: "", packBusy: false, clearConfirm: false };
  var packSongs = null; // 這台裝置已匯入的題庫包歌曲（null = 讀取中）
  var packStorage = null; // 瀏覽器儲存空間 { usage, quota, persisted }（null = 讀取中或不支援）

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
      // version 1 是舊版進階模式（玩家照指定方式唱），規則不相容，直接捨棄
      if (!s || s.version !== 2 || !s.config || !s.current) return null;
      // 2026-10-18 以前的進階模式是輪流出題、版本隨機指定，與現在的全體猜題不相容
      if (s.config.mode === "advanced" && !s.current.picked) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  // 上一次的設定（回到設定畫面時沿用；題庫包歌曲不存，每次從 IndexedDB 讀）
  function saveConfig(config) {
    var copy = JSON.parse(JSON.stringify(config));
    delete copy.packSongs;
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(copy)); } catch (e) { /* 忽略 */ }
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
    stopAll();
    state = next;
    resetRoundUi();
    save();
    render();
    window.scrollTo(0, 0);
  }

  // ---------------- 設定畫面 ----------------

  function allCategories() { return Songs.categories.map(function (c) { return c.id; }); }
  function allVariants() { return Songs.variants.map(function (v) { return v.id; }); }

  function newDraft() {
    var prev = loadConfig();
    if (prev && prev.players && prev.players.length >= MIN_PLAYERS) {
      return fitScoreTable({
        mode: MODES.indexOf(prev.mode) >= 0 ? prev.mode : "basic",
        names: prev.players.map(function (p) { return p.name; }),
        aiBonus: prev.aiBonus,
        scoreTable: prev.scoreTable.slice(),
        regions: (prev.regions || []).slice(),
        decades: (prev.decades || []).slice(),
        categories: (prev.categories || allCategories()).slice(),
        // 舊設定可能留著已拿掉的版本（例如 melody），只保留目前清單裡有的
        variants: (prev.variants || allVariants()).filter(function (v) { return allVariants().indexOf(v) >= 0; }),
        clipSeconds: prev.clipSeconds || 12,
        randomSpeed: !!prev.randomSpeed
      });
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
      variants: allVariants(),
      clipSeconds: 12,
      randomSpeed: false
    };
  }

  // 進階模式沒有出題者，計分表多一列：列數對不上時重設為預設值
  function fitScoreTable(d) {
    var rows = Core.guesserCount(d.mode, d.names.length) + 1;
    if (!d.scoreTable || d.scoreTable.length !== rows) d.scoreTable = Core.defaultScoreTable(d.names.length, d.mode);
    return d;
  }

  // 把某一個篩選條件換成單一值後的首數（勾選框旁邊的數字用）
  function countWith(field, value) {
    var cfg = { packSongs: packSongs || [], regions: draft.regions, decades: draft.decades,
      categories: draft.categories, variants: draft.variants };
    cfg[field] = [value];
    return Core.songPool(cfg).length;
  }

  function setPlayerCount(n) {
    n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n));
    if (n === draft.names.length) return;
    while (draft.names.length < n) draft.names.push("");
    draft.names.length = n;
    // 人數變了，答對人數的列數也跟著變：計分表重設為預設值
    draft.scoreTable = Core.defaultScoreTable(n, draft.mode);
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
      variants: draft.variants.slice(),
      packSongs: draft.mode === "advanced" ? (packSongs || []).map(function (s) {
        return { id: s.id, t: s.t, a: s.a, y: s.y, r: s.r, c: s.c, clips: s.clips, variants: s.variants };
      }) : [],
      clipSeconds: Number(draft.clipSeconds) || 0,
      randomSpeed: !!draft.randomSpeed
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

  function refreshPack() {
    if (!Pack) { packSongs = []; return Promise.resolve(); }
    var info = Pack.storageInfo ? Pack.storageInfo().catch(function () { return null; }) : Promise.resolve(null);
    return Promise.all([Pack.list(), info]).then(function (r) {
      packSongs = r[0];
      packStorage = r[1];
    }).catch(function () {
      packSongs = [];
    });
  }

  function formatMb(bytes) {
    return (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0) + " MB";
  }

  // 已用／剩餘空間與「瀏覽器是否承諾不自動清除」；estimate() 不支援時只顯示保留狀態
  function packStorageText() {
    if (!packStorage) return "";
    var parts = [];
    if (packStorage.quota !== null) {
      parts.push(t("ut_pack_storage", { used: formatMb(packStorage.usage),
        free: formatMb(Math.max(0, packStorage.quota - packStorage.usage)) }));
    }
    parts.push(t(packStorage.persisted ? "ut_pack_persisted" : "ut_pack_not_persisted"));
    return parts.join(" ");
  }

  function importPack(file) {
    if (!file) return;
    ui.packBusy = true;
    ui.packMsg = t("ut_pack_importing");
    render();
    Pack.importFile(file).then(function (res) {
      ui.packMsg = t("ut_pack_imported", { added: res.added, total: res.total });
      return refreshPack();
    }).catch(function (e) {
      if (e.message === "ut_err_pack_space" && e.params) {
        ui.packMsg = t("ut_err_pack_space", { need: formatMb(e.params.need), free: formatMb(e.params.free) });
      } else {
        ui.packMsg = t(/^ut_/.test(e.message) ? e.message : "ut_err_pack_format");
      }
      return refreshPack();
    }).then(function () {
      ui.packBusy = false;
      render();
    });
  }

  function renderPackSetup() {
    var adv = el("div", { class: "ut-panel", id: "ut-pack-panel" }, [el("h2", { text: t("ut_pack_heading") })]);
    adv.appendChild(el("p", { id: "ut-pack-status",
      text: packSongs === null ? t("ut_loading") : t("ut_pack_status", { n: packSongs.length }) }));
    if (packStorageText()) adv.appendChild(el("p", { id: "ut-pack-storage", class: "ut-muted", text: packStorageText() }));
    var fileInput = el("input", { type: "file", id: "ut-pack-file", accept: ".zip,application/zip", class: "ut-file", disabled: ui.packBusy });
    fileInput.addEventListener("change", function () { importPack(fileInput.files[0]); });
    adv.appendChild(el("div", { class: "ut-field" }, [
      el("label", { class: "ut-label", for: "ut-pack-file", text: t("ut_pack_import") }),
      fileInput
    ]));
    if (packSongs && packSongs.length) {
      adv.appendChild(el("button", { type: "button", id: "ut-btn-pack-clear", disabled: ui.packBusy,
        text: ui.clearConfirm ? t("ut_pack_clear_confirm") : t("ut_pack_clear"),
        onclick: function () {
          if (!ui.clearConfirm) { ui.clearConfirm = true; render(); return; }
          ui.clearConfirm = false;
          Pack.clear().then(refreshPack).then(function () { ui.packMsg = ""; render(); });
        } }));
    }
    if (ui.packMsg) adv.appendChild(el("p", { id: "ut-pack-msg", class: "ut-muted", text: ui.packMsg }));
    adv.appendChild(el("p", { class: "ut-muted", text: t("ut_pack_hint") }));
    if (!packSongs || !packSongs.length) return adv;

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
    var variantRow = el("div", { class: "ut-field" }, [el("span", { class: "ut-label", text: t("ut_variants") })]);
    Songs.variants.forEach(function (v) {
      var label = checkbox("ut-variant-" + v.id, draft.variants.indexOf(v.id) >= 0,
        t("ut_with_count", { label: lt(v.name), n: countWith("variants", v.id) }), function () {
          toggleIn(draft.variants, v.id); render();
        });
      label.title = lt(v.desc);
      variantRow.appendChild(label);
    });
    adv.appendChild(variantRow);
    var poolSize = Core.songPool(draftConfig()).length;
    adv.appendChild(el("p", { id: "ut-pool-size", class: poolSize ? "ut-muted" : "ut-error",
      text: t("ut_pool_size", { n: poolSize }) }));
    return adv;
  }

  function renderDreamSetup() {
    var panel = el("div", { class: "ut-panel", id: "ut-dream-panel" }, [el("h2", { text: t("ut_dream_heading") })]);
    panel.appendChild(el("div", { class: "ut-field" }, [
      el("label", { for: "ut-clip-seconds", text: t("ut_clip_seconds") }),
      numberInput({ id: "ut-clip-seconds", min: 5, max: 60 }, draft.clipSeconds, function (v) { draft.clipSeconds = v; })
    ]));
    panel.appendChild(el("div", { class: "ut-field" }, [
      checkbox("ut-random-speed", draft.randomSpeed, t("ut_random_speed"), function (ev) { draft.randomSpeed = ev.target.checked; })
    ]));
    panel.appendChild(el("p", { class: "ut-muted", text: t("ut_dream_note") }));
    return panel;
  }

  function renderSetup() {
    if (!draft) draft = newDraft();
    var box = el("div", { class: "ut-setup" });

    // 模式
    var modePanel = el("div", { class: "ut-panel" }, [el("h2", { text: t("ut_mode") })]);
    MODES.forEach(function (m) {
      modePanel.appendChild(el("label", { class: "ut-radio" }, [
        el("input", { type: "radio", name: "ut-mode", id: "ut-mode-" + m, value: m, checked: draft.mode === m,
          onchange: function () { draft.mode = m; fitScoreTable(draft); ui.error = ""; render(); } }),
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

    // 計分（進階模式沒有出題者，也就沒有 AI 加分）
    var group = Core.isGroupMode(draft.mode);
    var guessers = Core.guesserCount(draft.mode, draft.names.length);
    var scorePanel = el("div", { class: "ut-panel" }, [
      el("h2", { text: t("ut_scoring") }),
      el("p", { class: "ut-muted", text: t(group ? "ut_scoring_note_group" : "ut_scoring_note") })
    ]);
    if (!group) {
      scorePanel.appendChild(el("div", { class: "ut-field" }, [
        el("label", { for: "ut-ai-bonus", text: t("ut_ai_bonus") }),
        numberInput({ id: "ut-ai-bonus" }, draft.aiBonus, function (v) { draft.aiBonus = v; })
      ]));
    }
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
      onclick: function () { draft.scoreTable = Core.defaultScoreTable(draft.names.length, draft.mode); render(); } }));
    box.appendChild(scorePanel);

    if (draft.mode === "advanced") box.appendChild(renderPackSetup());
    if (draft.mode === "dream") box.appendChild(renderDreamSetup());

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

  function songLine(song, variantIds) {
    if (!song) return "";
    var line = t("ut_song_line", { title: song.t, artist: song.a, year: song.y });
    var names = (variantIds || []).map(Songs.variant).filter(Boolean).map(function (v) { return lt(v.name); });
    return names.length ? line + t("ut_style_suffix", { style: names.join(t("ut_list_sep")) }) : line;
  }

  function currentPackSong() {
    return state && state.current.songId ? Core.findPackSong(state.config, state.current.songId) : null;
  }

  function renderTopic() {
    if (state.config.mode === "advanced") return renderAdvancedTopic();
    if (state.config.mode === "dream") return renderDreamTopic();
    var panel = el("div", { class: "ut-panel ut-topic", id: "ut-topic" });
    panel.appendChild(el("p", { text: t("ut_basic_hint", { name: nameOf(state.current.singerId) }) }));
    return panel;
  }

  // ---------------- 進階模式：播放題庫包 ----------------

  var audio = { main: new Audio(), answer: new Audio(), keys: { main: null, answer: null }, urls: { main: null, answer: null } };

  // 先把音檔放進 <audio>，讓按鈕在點擊當下就能同步 play()（iOS 的限制）
  function prepareAudio(slot, song, variant) {
    var key = song ? song.id + "|" + variant : null;
    if (audio.keys[slot] === key) return;
    audio.keys[slot] = key;
    audio[slot].pause();
    if (audio.urls[slot]) URL.revokeObjectURL(audio.urls[slot]);
    audio.urls[slot] = null;
    audio[slot].removeAttribute("src");
    if (!key) return;
    Pack.getClip(song, variant).then(function (blob) {
      if (audio.keys[slot] !== key) return;
      if (!blob) { ui.error = t("ut_err_clip_missing"); render(); return; }
      audio.urls[slot] = URL.createObjectURL(blob);
      audio[slot].src = audio.urls[slot];
      render();
    }).catch(function () {
      ui.error = t("ut_err_clip_missing");
      render();
    });
  }

  function playAudio(slot) {
    var other = slot === "main" ? "answer" : "main";
    audio[other].pause();
    audio[slot].currentTime = 0;
    var p = audio[slot].play();
    if (p && p.catch) p.catch(function () { /* 被瀏覽器擋下時再按一次即可 */ });
  }

  function stopAll() {
    audio.main.pause();
    audio.answer.pause();
    stopYt();
  }

  // 主播放器要放的音檔：用了伴奏提示、且目前版本有提示音檔時改播提示音檔（例：中文歌聲 → 歌聲＋伴奏）
  function mainClip(song) {
    var cur = state.current;
    if (!cur.variant) return null;
    var hint = Core.hintClip(cur.variant);
    if (cur.hint && hint && song && (song.variants || []).indexOf(hint) >= 0) return hint;
    return cur.variant;
  }

  function songMeta(song) {
    var region = Songs.region(song.r);
    var category = Songs.category(song.c);
    return song.a + "（" + song.y + (region ? "・" + lt(region.name) : "") + (category ? "・" + lt(category.name) : "") + "）";
  }

  function renderAdvancedTopic() {
    var cur = state.current;
    var song = currentPackSong();
    var clip = mainClip(song);
    prepareAudio("main", clip ? song : null, clip);
    var ready = !!audio.urls.main;
    var info = cur.info || {};
    var panel = el("div", { class: "ut-panel ut-topic", id: "ut-topic" }, [
      el("p", { text: t("ut_group_hint", { n: Core.MAX_PICKS }) })
    ]);

    // 挑版本：已挑的可以隨時切回來重聽；額度用完後沒挑過的版本停用
    var left = Core.picksLeft(state);
    var pickRow = el("div", { class: "ut-toggle-row", id: "ut-pick-row" });
    Core.pickableVariants(state).forEach(function (vid) {
      var v = Songs.variant(vid);
      var picked = cur.picked.indexOf(vid) >= 0;
      var btn = el("button", { type: "button", class: "ut-toggle ut-pick" + (vid === cur.variant ? " ut-on" : ""),
        "data-variant": vid, disabled: !picked && left === 0, "aria-pressed": vid === cur.variant ? "true" : "false",
        text: (picked ? "♪ " : "") + (v ? lt(v.name) : vid),
        onclick: function () { state = Core.pickVariant(state, vid); save(); render(); } });
      if (v) btn.title = lt(v.desc);
      pickRow.appendChild(btn);
    });
    panel.appendChild(pickRow);
    panel.appendChild(el("p", { class: "ut-muted", id: "ut-picks-left", text: t("ut_picks_left", { n: left, max: Core.MAX_PICKS }) }));

    var variant = Songs.variant(cur.variant);
    if (variant) {
      panel.appendChild(el("div", { class: "ut-style-badge", id: "ut-variant-badge", text: lt(variant.name) }));
      panel.appendChild(el("p", { class: "ut-style-desc", text: lt(variant.desc) }));
      panel.appendChild(el("div", { class: "ut-actions" }, [
        el("button", { type: "button", id: "ut-btn-play", class: "ut-primary", disabled: !ready,
          text: ready ? t("ut_btn_play") : t("ut_loading"), onclick: function () {
            playAudio("main"); // 先同步 play()（iOS 只允許在點擊當下播放），再記錄次數
            state = Core.recordPlay(state);
            save();
            render();
          } }),
        el("button", { type: "button", id: "ut-btn-stop", text: t("ut_btn_stop"), onclick: function () { audio.main.pause(); } })
      ]));
    }
    if (Core.hasHint(state)) {
      var until = Core.playsUntilHint(state);
      panel.appendChild(el("div", { class: "ut-actions" }, [
        cur.hint
          ? el("span", { class: "ut-style-badge", id: "ut-hint-on", text: t("ut_hint_on") })
          : el("button", { type: "button", id: "ut-btn-hint", disabled: until > 0,
            text: until > 0 ? t("ut_btn_hint_locked", { n: until }) : t("ut_btn_hint"),
            onclick: function () { state = Core.useHint(state); save(); render(); } })
      ]));
    }
    // 聲庫／角色的使用規約要求標示名稱
    if (cur.variant === "zh_sing") panel.appendChild(el("p", { class: "ut-muted", id: "ut-ai-credit", text: t("ut_ai_credit") }));
    if (cur.variant === "ja_sing") panel.appendChild(el("p", { class: "ut-muted", id: "ut-ai-credit", text: t("ut_vv_credit") }));
    if (/^acap_/.test(cur.variant)) panel.appendChild(el("p", { class: "ut-muted", id: "ut-ai-credit", text: t("ut_" + cur.variant + "_credit") }));

    // 提示：公開年代或歌手
    if (song && !ui.revealed) {
      var hintRow = el("div", { class: "ut-actions", id: "ut-info-hints" });
      hintRow.appendChild(info.decade
        ? el("span", { class: "ut-style-badge", id: "ut-info-decade", text: t("ut_info_decade", { d: Songs.decadeOf(song) }) })
        : el("button", { type: "button", id: "ut-btn-info-decade", text: t("ut_btn_info_decade"),
          onclick: function () { state = Core.useInfoHint(state, "decade"); save(); render(); } }));
      hintRow.appendChild(info.artist
        ? el("span", { class: "ut-style-badge", id: "ut-info-artist", text: t("ut_info_artist", { name: song.a }) })
        : el("button", { type: "button", id: "ut-btn-info-artist", text: t("ut_btn_info_artist"),
          onclick: function () { state = Core.useInfoHint(state, "artist"); save(); render(); } }));
      panel.appendChild(hintRow);
    }

    // 大家都猜完後公布答案
    if (!ui.revealed) {
      panel.appendChild(el("div", { class: "ut-actions" }, [
        el("button", { type: "button", id: "ut-btn-redraw", text: t("ut_btn_redraw"),
          onclick: function () { stopAll(); state = Core.redrawSong(state); save(); render(); } }),
        el("button", { type: "button", id: "ut-btn-reveal", class: "ut-primary", text: t("ut_btn_reveal_answer"),
          onclick: function () { ui.revealed = true; render(); } })
      ]));
      return panel;
    }
    var hasOriginal = !!(song && song.clips && song.clips.original);
    prepareAudio("answer", hasOriginal ? song : null, "original");
    panel.appendChild(el("div", { class: "ut-song-card", id: "ut-song-card" }, [
      el("div", { class: "ut-song-title", text: song ? song.t : "" }),
      el("div", { class: "ut-song-meta", text: song ? songMeta(song) : "" })
    ]));
    if (hasOriginal) {
      panel.appendChild(el("div", { class: "ut-actions" }, [
        el("button", { type: "button", id: "ut-btn-reveal-play", disabled: !audio.urls.answer,
          text: t("ut_btn_play_answer"), onclick: function () { playAudio("answer"); } })
      ]));
    }
    return panel;
  }

  // ---------------- 夢想模式：YouTube ----------------

  var yt = { host: null, player: null, ready: false, loading: false, videoId: null, wanted: null, timer: null,
    playing: false, pendingStart: false, error: null };

  function ytErrorKey(code) {
    if (code === 101 || code === 150) return "ut_err_yt_embed";
    if (code === 100 || code === 2) return "ut_err_yt_notfound";
    return "ut_err_yt_generic";
  }

  function ensureYt(videoId) {
    if (!yt.host) {
      yt.host = el("div", { class: "ut-yt-host", id: "ut-yt-host" }, [
        el("div", { id: "ut-yt-player" }),
        el("div", { class: "ut-yt-cover", id: "ut-yt-cover" })
      ]);
      document.body.appendChild(yt.host);
    }
    yt.host.hidden = false;
    yt.host.querySelector("#ut-yt-cover").textContent = yt.playing ? "♪ ♪ ♪" : "♪";
    yt.wanted = videoId;
    if (!window.YT || !window.YT.Player) {
      if (!yt.loading) {
        yt.loading = true;
        window.onYouTubeIframeAPIReady = function () { ensureYt(yt.wanted); };
        var script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.onerror = function () { yt.error = "ut_err_yt_generic"; render(); };
        document.head.appendChild(script);
      }
      return;
    }
    if (!yt.player) {
      yt.videoId = videoId;
      yt.player = new window.YT.Player("ut-yt-player", {
        width: 200,
        height: 200,
        videoId: videoId,
        playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3 },
        events: {
          onReady: function () { yt.ready = true; render(); },
          onStateChange: onYtState,
          onError: function (e) { yt.error = ytErrorKey(e.data); stopYt(); render(); }
        }
      });
      return;
    }
    if (yt.ready && yt.videoId !== videoId) {
      stopYt();
      yt.error = null;
      yt.videoId = videoId;
      yt.player.cueVideoById(videoId);
    }
  }

  function hideYt() {
    if (!yt.host) return;
    stopYt();
    yt.host.hidden = true;
  }

  function stopYt() {
    if (yt.timer) clearInterval(yt.timer);
    yt.timer = null;
    yt.pendingStart = false;
    if (yt.player && yt.ready && yt.playing) yt.player.pauseVideo();
    yt.playing = false;
  }

  function dreamClip() { return Number(state.config.clipSeconds) || 12; }

  // 影片開始播放後才一定拿得到長度：第一次播放先靜音從頭播，拿到長度再跳到隨機起點
  function onYtState(e) {
    if (e.data !== 1 || !state || !state.current.dream) return;
    var d = state.current.dream;
    var p = yt.player;
    if (!d.title) {
      var data = p.getVideoData ? p.getVideoData() : null;
      if (data && data.title) { state = Core.setDream(state, { title: data.title }); save(); }
    }
    if (yt.pendingStart) {
      yt.pendingStart = false;
      var start = Core.randomStart(p.getDuration(), dreamClip());
      state = Core.setDream(state, { start: start });
      save();
      p.seekTo(start, true);
      p.unMute();
      watchClipEnd(start);
      render();
    }
  }

  function watchClipEnd(start) {
    if (yt.timer) clearInterval(yt.timer);
    yt.timer = setInterval(function () {
      if (!yt.player || yt.pendingStart) return;
      if (yt.player.getCurrentTime() >= start + dreamClip()) { stopYt(); render(); }
    }, 200);
  }

  function playDream(reroll) {
    var d = state.current.dream;
    var p = yt.player;
    if (!p || !yt.ready) return;
    stopYt();
    yt.error = null;
    yt.playing = true;
    if (p.setPlaybackRate) p.setPlaybackRate(d.rate || 1);
    var start = reroll ? null : d.start;
    if (start === null) {
      var dur = p.getDuration ? p.getDuration() : 0;
      if (dur > 0) {
        start = Core.randomStart(dur, dreamClip());
        state = Core.setDream(state, { start: start });
        save();
      }
    }
    if (start === null) {
      yt.pendingStart = true;
      p.mute();
      p.playVideo();
    } else {
      p.unMute();
      p.seekTo(start, true);
      p.playVideo();
      watchClipEnd(start);
    }
    render();
  }

  function renderDreamTopic() {
    var cur = state.current;
    var d = cur.dream;
    var singer = nameOf(cur.singerId);
    var panel = el("div", { class: "ut-panel ut-topic", id: "ut-topic" });
    if (!d.videoId) {
      if (!ui.revealed) {
        panel.appendChild(el("p", { text: t("ut_pass_device", { name: singer }) }));
        panel.appendChild(el("button", { type: "button", id: "ut-btn-reveal", class: "ut-primary",
          text: t("ut_btn_dream_enter", { name: singer }), onclick: function () { ui.revealed = true; render(); } }));
        return panel;
      }
      var input = el("input", { type: "url", id: "ut-dream-url", class: "ut-url-input",
        placeholder: "https://www.youtube.com/watch?v=…", autocomplete: "off" });
      var submit = function () {
        var id = Core.parseYoutubeId(input.value);
        if (!id) { ui.error = t("ut_err_bad_url"); render(); return; }
        ui.error = "";
        ui.revealed = false;
        yt.error = null;
        state = Core.setDream(state, { videoId: id, start: null, title: "" });
        save();
        render();
      };
      input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") submit(); });
      panel.appendChild(el("p", { text: t("ut_dream_url_label") }));
      panel.appendChild(input);
      panel.appendChild(el("p", { class: "ut-error", text: ui.error }));
      panel.appendChild(el("div", { class: "ut-actions" }, [
        el("button", { type: "button", id: "ut-btn-dream-set", class: "ut-primary", text: t("ut_btn_dream_set"), onclick: submit })
      ]));
      return panel;
    }
    var status = yt.error ? t(yt.error) : !yt.ready ? t("ut_loading") : yt.playing ? t("ut_dream_playing") : t("ut_dream_ready");
    panel.appendChild(el("p", { text: t("ut_dream_hint", { name: singer, sec: dreamClip() }) }));
    if (d.rate && d.rate !== 1) {
      panel.appendChild(el("div", { class: "ut-style-badge", id: "ut-rate-badge", text: t("ut_dream_rate", { rate: d.rate }) }));
    }
    panel.appendChild(el("p", { id: "ut-dream-status", class: yt.error ? "ut-error" : "ut-muted", text: status }));
    var blocked = !yt.ready || !!yt.error;
    panel.appendChild(el("div", { class: "ut-actions" }, [
      el("button", { type: "button", id: "ut-btn-dream-play", class: "ut-primary", disabled: blocked,
        text: d.start === null ? t("ut_btn_play") : t("ut_btn_replay_clip"), onclick: function () { playDream(false); } }),
      el("button", { type: "button", id: "ut-btn-dream-reroll", disabled: blocked,
        text: t("ut_btn_reroll"), onclick: function () { playDream(true); } }),
      el("button", { type: "button", id: "ut-btn-stop", text: t("ut_btn_stop"), onclick: function () { stopYt(); render(); } }),
      el("button", { type: "button", id: "ut-btn-dream-reset", text: t("ut_btn_dream_reset"),
        onclick: function () {
          stopYt();
          yt.error = null;
          state = Core.setDream(state, { videoId: null, start: null, title: "" });
          save();
          render();
        } })
    ]));
    return panel;
  }

  // ---------------- 判定與紀錄 ----------------

  function correctIds() {
    return Object.keys(ui.correct).filter(function (id) { return ui.correct[id]; });
  }

  function renderJudge() {
    var cur = state.current;
    var panel = el("div", { class: "ut-panel ut-judge" }, [el("h2", { text: t("ut_judge_heading") })]);

    // 進階模式沒有出題者，AI 答對也沒有人加分
    if (cur.singerId) {
      panel.appendChild(el("div", { class: "ut-field" }, [
        el("span", { class: "ut-label", text: t("ut_ai_question") }),
        el("button", { type: "button", id: "ut-btn-ai", class: "ut-toggle" + (ui.aiCorrect ? " ut-on" : ""),
          "aria-pressed": ui.aiCorrect ? "true" : "false",
          text: ui.aiCorrect ? t("ut_ai_on") : t("ut_ai_off"),
          onclick: function () { ui.aiCorrect = !ui.aiCorrect; render(); } })
      ]));
    }

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
    var info = h.info || {};
    var infoUsed = Core.INFO_HINTS.filter(function (k) { return info[k]; }).map(function (k) { return t("ut_hint_kind_" + k); });
    var parts = [
      h.singerId ? t("ut_hist_round", { n: h.round, name: nameOf(h.singerId) }) : t("ut_hist_round_group", { n: h.round }),
      h.song ? songLine(h.song, h.picked || (h.variant ? [h.variant] : [])) : null,
      h.dream && h.dream.videoId ? t("ut_hist_dream", { title: h.dream.title || h.dream.videoId }) : null,
      h.hint ? t("ut_hist_hint") : null,
      infoUsed.length ? t("ut_hist_info", { list: infoUsed.join(t("ut_list_sep")) }) : null,
      h.singerId ? t("ut_hist_ai", { result: h.aiCorrect ? t("ut_ai_on") : t("ut_ai_off") }) : null,
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
    // 進階模式公布答案時，answer 播放器給本題的原曲用（renderAdvancedTopic），這裡不能動它
    var answerBusy = state.config.mode === "advanced" && ui.revealed;
    if (!h) {
      if (!answerBusy) prepareAudio("answer", null, null);
      return null;
    }
    var answer = null;
    if (state.config.mode === "advanced" && h.songId && !answerBusy) {
      var song = Core.findPackSong(state.config, h.songId);
      var has = !!(song && song.clips && song.clips.original);
      prepareAudio("answer", has ? song : null, "original");
      answer = has ? el("button", { type: "button", id: "ut-btn-play-answer", disabled: !audio.urls.answer,
        text: t("ut_btn_play_answer"), onclick: function () { playAudio("answer"); } }) : null;
    }
    if (state.config.mode === "dream" && h.dream && h.dream.videoId) {
      answer = el("a", { id: "ut-answer-link", href: "https://www.youtube.com/watch?v=" + h.dream.videoId,
        target: "_blank", rel: "noopener", text: t("ut_open_youtube") });
    }
    return el("div", { class: "ut-panel ut-last", id: "ut-last-round" }, [
      el("h2", { text: t("ut_last_round") }),
      el("p", { text: historyText(h) }),
      el("p", { class: "ut-preview", text: deltaText(h) }),
      answer ? el("div", { class: "ut-actions" }, [answer]) : null,
      state.prev ? el("div", { class: "ut-actions" }, [el("button", { type: "button", id: "ut-btn-undo", text: t("ut_btn_undo"),
        onclick: function () { commit(Core.undo(state)); } })]) : null
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
    box.appendChild(el("div", { class: "ut-round-head" }, cur.singerId ? [
      el("h2", { id: "ut-round-title", text: t("ut_round_title", { n: state.round, name: nameOf(cur.singerId) }) }),
      el("p", { class: "ut-muted", text: t("ut_cycle_left", { n: state.queue.length }) })
    ] : [
      el("h2", { id: "ut-round-title", text: t("ut_round_title_group", { n: state.round }) })
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
    var dreamId = state && !state.finished && state.config.mode === "dream" && state.current.dream ? state.current.dream.videoId : null;
    if (dreamId) ensureYt(dreamId);
    else hideYt();
    document.body.classList.toggle("ut-has-player", !!dreamId);
  }

  state = load();
  render();
  refreshPack().then(render);
  window.addEventListener("i18n:change", render);

  // 測試用（tools/utau_check）
  window.PriTestUtau = { _debugState: function () { return state ? JSON.parse(JSON.stringify(state)) : null; } };
})();
