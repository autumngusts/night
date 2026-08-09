(function () {
  var Games = window.PriTestGames;
  var Scenarios = window.PriTestScenarios;
  var NightBosses = window.PriTestNightBosses;
  var BossRulebook = window.PriTestBossRulebook;

  function requireAdmin() {
    var ok = Games.checkAdminPassword(window.I18N.t("admin_password_prompt"));
    if (!ok) {
      alert(window.I18N.t("admin_password_wrong"));
      window.location.href = "../index.html";
    }
  }

  function renderScenarioSelect() {
    var select = document.getElementById("scenario-select");
    var current = select.value;
    select.innerHTML = "";
    var customOpt = document.createElement("option");
    customOpt.value = "";
    customOpt.textContent = window.I18N.t("scenario_custom_option");
    select.appendChild(customOpt);
    Scenarios.list().forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = Scenarios.localizedName(s.name);
      select.appendChild(opt);
    });
    if (current) select.value = current;
  }

  function renderGameList() {
    var games = Games.list();
    var list = document.getElementById("game-list");
    list.innerHTML = "";

    if (games.length === 0) {
      var empty = document.createElement("li");
      empty.className = "game-empty";
      empty.textContent = window.I18N.t("admin_no_games");
      list.appendChild(empty);
    }

    games.forEach(function (game) {
      var li = document.createElement("li");
      li.className = "game-row";

      var info = document.createElement("div");
      info.className = "game-info";
      var name = document.createElement("strong");
      name.textContent = game.name;
      var date = document.createElement("span");
      date.className = "game-date";
      date.textContent = new Date(game.createdAt).toLocaleString();
      info.appendChild(name);
      info.appendChild(date);
      var scenario = game.scenarioId ? Scenarios.get(game.scenarioId) : null;
      if (scenario) {
        var badge = document.createElement("span");
        badge.className = "game-date";
        badge.textContent = window.I18N.t("scenario_badge_label") + window.I18N.t("colon_separator") + Scenarios.localizedName(scenario.name);
        info.appendChild(badge);
      }

      var storageBadge = document.createElement("span");
      storageBadge.className = "game-date";
      storageBadge.textContent =
        game.storageMode === "cloud" ? window.I18N.t("storage_mode_cloud_badge") : window.I18N.t("storage_mode_local_badge");
      info.appendChild(storageBadge);

      var bossRow = document.createElement("div");
      bossRow.className = "game-boss-row";
      var bossLabel = document.createElement("label");
      bossLabel.textContent = window.I18N.t("night3_boss_label");
      var bossSelect = document.createElement("select");
      var noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = window.I18N.t("night3_boss_none_option");
      bossSelect.appendChild(noneOpt);
      NightBosses.list().forEach(function (b) {
        var opt = document.createElement("option");
        opt.value = b.id;
        // 選択肢が長すぎて管理画面のレイアウトを崩さないよう、英題(b.title)＋現在の表示言語の
        // 名称のみに短縮する（b.titleは9体全て一意であることを確認済み）。
        var label = b.title;
        var localized = BossRulebook ? BossRulebook.get(b.id) : null;
        if (localized && localized.name) {
          var lang = window.I18N ? window.I18N.getLang() : "zh";
          label += "（" + (lang === "ja" ? localized.name.ja : localized.name.zh) + "）";
        }
        opt.textContent = label;
        bossSelect.appendChild(opt);
      });
      bossSelect.value = game.night3BossId || "";
      bossSelect.addEventListener("change", function () {
        Games.update(game.id, { night3BossId: bossSelect.value || null });
      });
      bossLabel.appendChild(bossSelect);
      bossRow.appendChild(bossLabel);
      // シナリオに対応する「真正」の最終夜の王（scenarios.jsのbossId）が分かっている場合、
      // GMが上のセレクトで別のボスに変更していても、いつでもワンクリックで正解へ戻せる
      // ようにする（bossSelectの選択肢自体は自由変更を妨げない——「画像は外部で差し替え
      // 可能」という運用は維持しつつ、シナリオ番号との対応はここで明示する）。
      if (scenario && scenario.bossId) {
        var resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.className = "boss-reset-btn";
        resetBtn.textContent = window.I18N.t("night3_boss_reset_button");
        resetBtn.title = window.I18N.t("night3_boss_reset_button_title", {
          boss: (function () {
            var localized = BossRulebook ? BossRulebook.get(scenario.bossId) : null;
            if (!localized || !localized.name) return scenario.bossId;
            var lang = window.I18N ? window.I18N.getLang() : "zh";
            return lang === "ja" ? localized.name.ja : localized.name.zh;
          })(),
        });
        resetBtn.addEventListener("click", function () {
          Games.update(game.id, { night3BossId: scenario.bossId });
          bossSelect.value = scenario.bossId;
        });
        bossRow.appendChild(resetBtn);
      }
      info.appendChild(bossRow);

      var actions = document.createElement("div");
      actions.className = "game-actions";

      var openBtn = document.createElement("a");
      openBtn.className = "primary-btn";
      openBtn.href = "../characters/index.html?game=" + encodeURIComponent(game.id);
      openBtn.textContent = window.I18N.t("admin_open_button");

      var shareBtn = document.createElement("button");
      shareBtn.type = "button";
      shareBtn.textContent = window.I18N.t("share_button");
      shareBtn.addEventListener("click", function () {
        openShareModal(game.id);
      });

      var deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "danger-btn";
      deleteBtn.textContent = window.I18N.t("admin_delete_button");
      deleteBtn.addEventListener("click", function () {
        if (!window.confirm(window.I18N.t("admin_confirm_delete", { name: game.name }))) return;
        Games.remove(game.id);
        renderGameList();
      });

      actions.appendChild(openBtn);
      actions.appendChild(shareBtn);

      if (game.storageMode !== "cloud") {
        var cloudifyBtn = document.createElement("button");
        cloudifyBtn.type = "button";
        cloudifyBtn.textContent = window.I18N.t("admin_cloudify_button");
        cloudifyBtn.addEventListener("click", function () {
          if (Games.list().length >= Games.MAX_GAMES) {
            alert(window.I18N.t("admin_max_games", { max: Games.MAX_GAMES }));
            return;
          }
          if (!window.confirm(window.I18N.t("admin_cloudify_confirm", { name: game.name }))) return;
          var newGame = Games.cloudifyGame(game.id);
          if (newGame) {
            alert(window.I18N.t("admin_cloudify_success", { name: newGame.name }));
            renderGameList();
          }
        });
        actions.appendChild(cloudifyBtn);
      }

      actions.appendChild(deleteBtn);

      li.appendChild(info);
      li.appendChild(actions);
      list.appendChild(li);
    });

    var addBtn = document.getElementById("btn-add-game");
    addBtn.disabled = games.length >= Games.MAX_GAMES;
  }

  function shareUrlFor(bundle) {
    var encoded = Games.utf8ToBase64Url(JSON.stringify(bundle));
    var base = window.location.href.split("#")[0];
    return base + "#import=" + encoded;
  }

  // クラウド保存ゲームは実際のgameIdへの直リンクを共有する（他端末はcharacters.js/night.jsの
  // 「未知のgameIdならFirebaseからmeta取得して登録」フローに乗り、以後はリアルタイム同期される）。
  // ローカル専用ゲームは同期先のサーバーが無いため、従来通り現在のセーブ内容を1回限りのJSON
  // スナップショットとして#import=リンクに埋め込む（互いの変更は自動で反映されない）。
  function openShareModal(gameId) {
    var game = Games.get(gameId);
    if (!game) return;
    var isCloud = game.storageMode === "cloud";
    var url;
    if (isCloud) {
      url = new URL("../characters/index.html?game=" + encodeURIComponent(gameId), window.location.href).href;
    } else {
      var bundle = Games.exportGame(gameId);
      if (!bundle) return;
      url = shareUrlFor(bundle);
    }

    document.getElementById("share-url-input").value = url;
    document.getElementById("share-cloud-note").hidden = !isCloud;
    document.getElementById("share-local-note").hidden = isCloud;

    var canvas = document.getElementById("share-qr-canvas");
    var note = document.getElementById("share-oversize-note");
    var result = window.PriTestQRCode.renderToCanvas(canvas, url, { level: "L", scale: 6, margin: 3 });
    if (result) {
      canvas.hidden = false;
      note.hidden = true;
    } else {
      canvas.hidden = true;
      note.hidden = false;
    }

    document.getElementById("share-modal").hidden = false;
  }

  function closeShareModal() {
    document.getElementById("share-modal").hidden = true;
  }

  function handleImportFromHash() {
    var hash = window.location.hash;
    if (hash.indexOf("#import=") !== 0) return;
    var encoded = hash.slice("#import=".length);
    // インポート後にURLへ再度残らないよう、先にhashを消しておく
    history.replaceState(null, "", window.location.pathname + window.location.search);

    var bundle;
    try {
      bundle = JSON.parse(Games.base64UrlToUtf8(encoded));
    } catch (e) {
      alert(window.I18N.t("share_import_invalid"));
      return;
    }
    if (!bundle || !bundle.game || typeof bundle.game.name !== "string") {
      alert(window.I18N.t("share_import_invalid"));
      return;
    }
    if (Games.list().length >= Games.MAX_GAMES) {
      alert(window.I18N.t("share_import_full", { max: Games.MAX_GAMES }));
      return;
    }
    if (!window.confirm(window.I18N.t("share_import_confirm", { name: bundle.game.name }))) return;
    var newGame = Games.importGame(bundle);
    if (newGame) {
      alert(window.I18N.t("share_import_success", { name: newGame.name }));
      renderGameList();
    }
  }

  function handleAddGame() {
    var games = Games.list();
    if (games.length >= Games.MAX_GAMES) {
      alert(window.I18N.t("admin_max_games", { max: Games.MAX_GAMES }));
      return;
    }
    var name = window.prompt(window.I18N.t("admin_new_game_prompt"));
    if (!name) return;
    var scenarioId = document.getElementById("scenario-select").value || null;
    var wantsCloud = window.confirm(window.I18N.t("admin_cloud_confirm"));
    Games.create(name.trim(), scenarioId, wantsCloud ? "cloud" : "local");
    renderGameList();
  }

  document.addEventListener("DOMContentLoaded", function () {
    requireAdmin();
    renderScenarioSelect();
    renderGameList();
    handleImportFromHash();
    document.getElementById("btn-add-game").addEventListener("click", handleAddGame);
    document.getElementById("btn-share-close").addEventListener("click", closeShareModal);
    document.getElementById("btn-share-copy").addEventListener("click", function () {
      var input = document.getElementById("share-url-input");
      input.select();
      input.setSelectionRange(0, input.value.length);
      navigator.clipboard
        .writeText(input.value)
        .then(function () {
          alert(window.I18N.t("share_copied"));
        })
        .catch(function () {
          document.execCommand("copy");
        });
    });
    window.addEventListener("i18n:change", function () {
      renderScenarioSelect();
      renderGameList();
    });
  });
})();
