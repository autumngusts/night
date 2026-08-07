// クラウド保存（雲端保存）の同期抽象化レイヤー。
// storageMode !== "cloud" のときは全関数が即座に何もせず返る＝ローカル専用ゲームでは
// Firebase SDKのロードもネットワーク通信も一切発生しない。
(function () {
  "use strict";

  var FIREBASE_SDK_VERSION = "10.14.1";
  var sdkReadyPromise = null;
  var authReadyPromise = null;
  var appCheckActivated = false;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error("firebase sdk load failed: " + src));
      };
      document.head.appendChild(s);
    });
  }

  function ensureSdkLoaded() {
    if (sdkReadyPromise) return sdkReadyPromise;
    var base = "https://www.gstatic.com/firebasejs/" + FIREBASE_SDK_VERSION + "/";
    sdkReadyPromise = loadScript(base + "firebase-app-compat.js")
      .then(function () {
        // App Check（reCAPTCHA v3）：initializeApp直後、他のSDK（Auth/Database）が実際に
        // リクエストを送る前に有効化する必要があるため、app-compat読み込み直後に行う。
        // site keyが未設定（空文字）の間は何もしない＝App Check未導入時と同じ挙動を保つ。
        return loadScript(base + "firebase-app-check-compat.js");
      })
      .then(function () {
        return loadScript(base + "firebase-auth-compat.js");
      })
      .then(function () {
        return loadScript(base + "firebase-database-compat.js");
      })
      .then(function () {
        if (!window.firebase.apps.length) {
          window.firebase.initializeApp(window.PRITEST_FIREBASE_CONFIG);
        }
        if (window.PRITEST_APPCHECK_SITE_KEY && !appCheckActivated) {
          window.firebase.appCheck().activate(window.PRITEST_APPCHECK_SITE_KEY, true);
          appCheckActivated = true;
        }
      });
    return sdkReadyPromise;
  }

  // storageMode==="cloud" のときだけSDKロード＋匿名認証を行い、完了を待てるPromiseを返す。
  // 2回目以降の呼び出しはキャッシュ済みPromiseを再利用する（多重初期化を防ぐ）。
  function ensureCloudReady(storageMode) {
    if (storageMode !== "cloud") return Promise.resolve(false);
    if (authReadyPromise) return authReadyPromise;
    authReadyPromise = ensureSdkLoaded().then(function () {
      return new Promise(function (resolve, reject) {
        var unsubscribe = window.firebase.auth().onAuthStateChanged(function (user) {
          if (user) {
            unsubscribe();
            resolve(true);
            return;
          }
          window.firebase.auth().signInAnonymously().catch(reject);
        }, reject);
      });
    });
    return authReadyPromise;
  }

  // クラウドゲーム専用の推測困難なID（"g"+32桁hex、128bit相当）。
  // ローカルゲームの既存ID形式（"g"+時刻+3桁乱数）はそのまま使い続ける。
  function generateCloudGameId() {
    var bytes = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    var hex = Array.prototype.map
      .call(bytes, function (b) {
        return b.toString(16).padStart(2, "0");
      })
      .join("");
    return "g" + hex;
  }

  function charactersArrayToMap(characters) {
    var map = {};
    (characters || []).forEach(function (c) {
      if (c && c.id) map[c.id] = c;
    });
    return map;
  }

  function charactersMapToArray(map) {
    if (!map) return [];
    return Object.keys(map).map(function (k) {
      return map[k];
    });
  }

  // 書き込みはfire-and-forget。失敗してもlocalStorageへの保存は既に完了しているため
  // UIをブロックしない（コンソールに警告のみ出す）。
  function pushNightState(gameId, storageMode, data) {
    if (storageMode !== "cloud" || !gameId) return;
    ensureCloudReady(storageMode)
      .then(function () {
        window.firebase.database().ref("games/" + gameId + "/nightState").set(data);
      })
      .catch(function (err) {
        console.error("PriTestGameStorage.pushNightState failed", err);
      });
  }

  function pushCharacters(gameId, storageMode, characters) {
    if (storageMode !== "cloud" || !gameId) return;
    ensureCloudReady(storageMode)
      .then(function () {
        window.firebase
          .database()
          .ref("games/" + gameId + "/characters")
          .set(charactersArrayToMap(characters));
      })
      .catch(function (err) {
        console.error("PriTestGameStorage.pushCharacters failed", err);
      });
  }

  function removeCloudGame(gameId, storageMode) {
    if (storageMode !== "cloud" || !gameId) return;
    ensureCloudReady(storageMode)
      .then(function () {
        window.firebase.database().ref("games/" + gameId).remove();
      })
      .catch(function (err) {
        console.error("PriTestGameStorage.removeCloudGame failed", err);
      });
  }

  function pushGameMeta(gameId, storageMode, meta) {
    if (storageMode !== "cloud" || !gameId) return;
    ensureCloudReady(storageMode)
      .then(function () {
        window.firebase.database().ref("games/" + gameId + "/meta").set(meta);
      })
      .catch(function (err) {
        console.error("PriTestGameStorage.pushGameMeta failed", err);
      });
  }

  // storageModeが不明な状態（他端末で初めてこのgameIdのリンクを開いた時）でも使えるよう、
  // ensureCloudReadyのゲート（storageMode==="cloud"の事前確認）を経由せず直接SDK＋匿名認証を行う。
  // クラウドゲームでなければ単にnullを返す（ローカル専用ゲームの動作には影響しない）。
  function fetchGameMeta(gameId) {
    if (!gameId) return Promise.resolve(null);
    return ensureSdkLoaded()
      .then(function () {
        return new Promise(function (resolve, reject) {
          var unsubscribe = window.firebase.auth().onAuthStateChanged(function (user) {
            if (user) {
              unsubscribe();
              resolve();
              return;
            }
            window.firebase.auth().signInAnonymously().catch(reject);
          }, reject);
        });
      })
      .then(function () {
        return window.firebase.database().ref("games/" + gameId + "/meta").once("value");
      })
      .then(function (snap) {
        return snap.exists() ? snap.val() : null;
      })
      .catch(function (err) {
        console.error("PriTestGameStorage.fetchGameMeta failed", err);
        return null;
      });
  }

  // onRemoteChangeは購読開始直後に現在値で一度呼ばれ（＝初回取得を兼ねる）、
  // 以後は他端末からの変更のたびに呼ばれる。
  function subscribeNightState(gameId, storageMode, onRemoteChange) {
    if (storageMode !== "cloud" || !gameId) return;
    ensureCloudReady(storageMode)
      .then(function () {
        window.firebase
          .database()
          .ref("games/" + gameId + "/nightState")
          .on("value", function (snap) {
            var val = snap.val();
            if (val) onRemoteChange(val);
          });
      })
      .catch(function (err) {
        console.error("PriTestGameStorage.subscribeNightState failed", err);
      });
  }

  function subscribeCharacters(gameId, storageMode, onRemoteChange) {
    if (storageMode !== "cloud" || !gameId) return;
    ensureCloudReady(storageMode)
      .then(function () {
        window.firebase
          .database()
          .ref("games/" + gameId + "/characters")
          .on("value", function (snap) {
            onRemoteChange(charactersMapToArray(snap.val()));
          });
      })
      .catch(function (err) {
        console.error("PriTestGameStorage.subscribeCharacters failed", err);
      });
  }

  window.PriTestGameStorage = {
    generateCloudGameId: generateCloudGameId,
    ensureCloudReady: ensureCloudReady,
    pushGameMeta: pushGameMeta,
    fetchGameMeta: fetchGameMeta,
    removeCloudGame: removeCloudGame,
    pushNightState: pushNightState,
    pushCharacters: pushCharacters,
    subscribeNightState: subscribeNightState,
    subscribeCharacters: subscribeCharacters,
  };
})();
