(function () {
  var GAMES_KEY = "pritest-admin-games";
  var ADMIN_SESSION_KEY = "pritest-admin-session";
  var MAX_GAMES = 5;
  var MAX_CHARACTERS = 10;
  var ADMIN_PASSWORD = "night";

  function listGames() {
    var raw = localStorage.getItem(GAMES_KEY);
    if (!raw) return [];
    try {
      var data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function saveGames(games) {
    localStorage.setItem(GAMES_KEY, JSON.stringify(games));
  }

  function getGame(id) {
    return listGames().filter(function (g) {
      return g.id === id;
    })[0] || null;
  }

  // storageMode: "local"（既定・省略可）または "cloud"。cloudの場合はgameId自体が
  // アクセス制御の鍵になるため、推測困難な長いIDを発行する（GameStorage.generateCloudGameId）。
  function createGame(name, scenarioId, storageMode) {
    var games = listGames();
    if (games.length >= MAX_GAMES) return null;
    var mode = storageMode === "cloud" ? "cloud" : "local";
    var id =
      mode === "cloud" && window.PriTestGameStorage
        ? window.PriTestGameStorage.generateCloudGameId()
        : "g" + Date.now() + Math.floor(Math.random() * 1000);
    // 固定シナリオ（scenarios.jsのSCENARIOS、各エントリのbossId）には、そのシナリオの
    // 最終夜に登場する夜の王が一意に決まっている。作成時点でnight3BossIdを自動で
    // 対応させておき、GMは管理画面のセレクトで後からいつでも手動変更できる（自由シナリオ
    // "custom..."にはbossIdが無いためnullのまま、従来通り手動選択が必要）。
    var scenario = window.PriTestScenarios ? window.PriTestScenarios.get(scenarioId) : null;
    var game = {
      id: id,
      name: name,
      createdAt: Date.now(),
      scenarioId: scenarioId || null,
      night3BossId: (scenario && scenario.bossId) || null,
      storageMode: mode,
    };
    games.push(game);
    saveGames(games);
    pushMetaIfCloud(game);
    return game;
  }

  function updateGame(id, patch) {
    var games = listGames();
    var game = games.filter(function (g) {
      return g.id === id;
    })[0];
    if (!game) return null;
    Object.keys(patch).forEach(function (key) {
      game[key] = patch[key];
    });
    saveGames(games);
    pushMetaIfCloud(game);
    return game;
  }

  function pushMetaIfCloud(game) {
    if (game.storageMode !== "cloud" || !window.PriTestGameStorage) return;
    window.PriTestGameStorage.pushGameMeta(game.id, "cloud", {
      name: game.name,
      createdAt: game.createdAt,
      scenarioId: game.scenarioId || null,
      night3BossId: game.night3BossId || null,
    });
  }

  // 他端末で初めてクラウドゲームのリンクを開いた時、Firebaseから取得したmetaを
  // このローカル端末のゲーム一覧にも登録する（以後は通常のクラウドゲームとして扱われる）。
  // MAX_GAMESの上限は適用しない（共有されたリンクは常に開けるようにする）。
  function registerCloudGame(id, meta) {
    var games = listGames();
    var existing = games.filter(function (g) {
      return g.id === id;
    })[0];
    if (existing) return existing;
    var game = {
      id: id,
      name: (meta && meta.name) || "",
      createdAt: (meta && meta.createdAt) || Date.now(),
      scenarioId: (meta && meta.scenarioId) || null,
      night3BossId: (meta && meta.night3BossId) || null,
      storageMode: "cloud",
    };
    games.push(game);
    saveGames(games);
    return game;
  }

  function deleteGame(id) {
    var target = getGame(id);
    var games = listGames().filter(function (g) {
      return g.id !== id;
    });
    saveGames(games);
    localStorage.removeItem("pritest-night-state-" + id);
    localStorage.removeItem("pritest-characters-" + id);
    if (target && target.storageMode === "cloud" && window.PriTestGameStorage) {
      window.PriTestGameStorage.removeCloudGame(id, "cloud");
    }
  }

  function isAdminAuthenticated() {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1";
  }

  // ブラウザタブを閉じるまで有効な管理員認証。すでに認証済みならプロンプトを出さない。
  function checkAdminPassword(promptText) {
    if (isAdminAuthenticated()) return true;
    var input = window.prompt(promptText);
    var ok = input === ADMIN_PASSWORD;
    if (ok) sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
    return ok;
  }

  function getGameIdFromQuery() {
    var params = new URLSearchParams(window.location.search);
    return params.get("game");
  }

  // --- 他端末との共有（URL／QRコード）用: ゲーム一式をJSONにまとめてbase64url化する ---
  function exportGame(id) {
    var game = getGame(id);
    if (!game) return null;
    var nightStateRaw = localStorage.getItem("pritest-night-state-" + id);
    var charactersRaw = localStorage.getItem("pritest-characters-" + id);
    var bundle = {
      v: 1,
      game: { name: game.name, scenarioId: game.scenarioId || null, night3BossId: game.night3BossId || null },
      nightState: nightStateRaw ? JSON.parse(nightStateRaw) : null,
      characters: charactersRaw ? JSON.parse(charactersRaw) : [],
    };
    return bundle;
  }

  function importGame(bundle) {
    var games = listGames();
    if (games.length >= MAX_GAMES) return null;
    var newId = "g" + Date.now() + Math.floor(Math.random() * 1000);
    var newGame = {
      id: newId,
      name: (bundle.game && bundle.game.name) || "",
      createdAt: Date.now(),
      scenarioId: (bundle.game && bundle.game.scenarioId) || null,
      night3BossId: (bundle.game && bundle.game.night3BossId) || null,
    };
    games.push(newGame);
    saveGames(games);
    if (bundle.nightState) {
      localStorage.setItem("pritest-night-state-" + newId, JSON.stringify(bundle.nightState));
    }
    if (bundle.characters) {
      localStorage.setItem("pritest-characters-" + newId, JSON.stringify(bundle.characters));
    }
    return newGame;
  }

  // ローカル専用ゲームの中身を複製し、新規のクラウドゲームとしてアップロードする。
  // 元のローカルゲームはそのまま残る（ユーザーが必要なら手動で削除する）。
  function cloudifyGame(id) {
    var bundle = exportGame(id);
    if (!bundle) return null;
    var newGame = createGame(bundle.game.name, bundle.game.scenarioId, "cloud");
    if (!newGame) return null;
    if (bundle.game.night3BossId) {
      updateGame(newGame.id, { night3BossId: bundle.game.night3BossId });
    }
    if (window.PriTestGameStorage) {
      if (bundle.nightState) {
        window.PriTestGameStorage.pushNightState(newGame.id, "cloud", bundle.nightState);
      }
      window.PriTestGameStorage.pushCharacters(newGame.id, "cloud", bundle.characters || []);
    }
    return newGame;
  }

  // UTF-8文字列 <-> URLセーフbase64（絵文字/漢字を含んでも安全に変換できる）
  function utf8ToBase64Url(str) {
    var b64 = btoa(unescape(encodeURIComponent(str)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlToUtf8(b64url) {
    var b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    return decodeURIComponent(escape(atob(b64)));
  }

  window.PriTestGames = {
    MAX_GAMES: MAX_GAMES,
    MAX_CHARACTERS: MAX_CHARACTERS,
    list: listGames,
    save: saveGames,
    get: getGame,
    create: createGame,
    update: updateGame,
    remove: deleteGame,
    registerCloudGame: registerCloudGame,
    checkAdminPassword: checkAdminPassword,
    isAdminAuthenticated: isAdminAuthenticated,
    getGameIdFromQuery: getGameIdFromQuery,
    exportGame: exportGame,
    importGame: importGame,
    cloudifyGame: cloudifyGame,
    utf8ToBase64Url: utf8ToBase64Url,
    base64UrlToUtf8: base64UrlToUtf8,
  };
})();
