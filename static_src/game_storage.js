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

  // 使用者確認（雲端同步ゲームで再現・修正）：night.js側の1つの操作（例：防禦體力骰が全員分
  // 揃った瞬間）が、短時間に複数回saveState()/saveRosterCharacters()を呼ぶことがある
  // （例：roundStage="acting"への切替で1回、直後にAutoGMの擲骰結果確定で1回）。この2回を
  // そのまま2回別々にpushNightState()/pushCharacters()すると、1回目（＝まだ結果が
  // 確定していない中間状態）と2回目（＝最終状態）が別々にFirebaseへ書き込まれ、
  // subscribeNightState/subscribeCharacters側の.on("value")は「自分自身の書き込みecho」も
  // 含めて毎回コールバックを起動するため、タイミング次第でその中間状態が最終的に画面へ
  // 反映されたまま残ってしまう（＝GMの進度版に敵人の行動が一切表示されないバグの実際の原因）。
  //
  // 呼び出し側（night.js/characters.js）を1つずつ「重複呼び出ししないよう」修正して回るのは
  // 際限が無く、将来のコード追加でも同じ問題が再発しうるため、根本原因であるこの
  // push層自体に短いdebounce（同一パスへの連続呼び出しを1回にまとめる）を設けて解決する。
  // localStorageへの保存（呼び出し側のsaveState/saveRosterCharacters内、この関数の外）は
  // 従来通り常に同期的・即時のまま——ここで遅延させるのはFirebaseへのネットワーク送信のみ。
  var CLOUD_PUSH_DEBOUNCE_MS = 150;
  var pendingNightStatePush = null; // { gameId, storageMode, data, timer }
  var pendingCharactersPush = null; // { gameId, storageMode, characters, timer }

  // 使用者確認：Firebase同步のrace condition対策の一環。単発のネットワーク失敗で
  // Firebase側が古いデータのまま取り残される（＝night.js側のタイムスタンプ判定で拾えるのは
  // 「次に別の変更が起きた時」だけ）のを減らすため、失敗時に1回だけ遅延リトライする。
  var NIGHT_STATE_PUSH_RETRY_MS = 2000;
  function sendNightStatePush(payload, isRetry) {
    ensureCloudReady(payload.storageMode)
      .then(function () {
        window.firebase.database().ref("games/" + payload.gameId + "/nightState").set(payload.data);
      })
      .catch(function (err) {
        console.error("PriTestGameStorage.pushNightState failed", err);
        if (!isRetry) {
          setTimeout(function () {
            sendNightStatePush(payload, true);
          }, NIGHT_STATE_PUSH_RETRY_MS);
        }
      });
  }

  function sendCharactersPush(payload) {
    ensureCloudReady(payload.storageMode)
      .then(function () {
        window.firebase
          .database()
          .ref("games/" + payload.gameId + "/characters")
          .set(charactersArrayToMap(payload.characters));
      })
      .catch(function (err) {
        console.error("PriTestGameStorage.pushCharacters failed", err);
      });
  }

  // 書き込みはfire-and-forget。失敗してもlocalStorageへの保存は既に完了しているため
  // UIをブロックしない（コンソールに警告のみ出す）。
  function pushNightState(gameId, storageMode, data) {
    if (storageMode !== "cloud" || !gameId) return;
    if (pendingNightStatePush && pendingNightStatePush.timer) {
      clearTimeout(pendingNightStatePush.timer);
    }
    pendingNightStatePush = { gameId: gameId, storageMode: storageMode, data: data, timer: null };
    pendingNightStatePush.timer = setTimeout(function () {
      var payload = pendingNightStatePush;
      pendingNightStatePush = null;
      sendNightStatePush(payload);
    }, CLOUD_PUSH_DEBOUNCE_MS);
  }

  function pushCharacters(gameId, storageMode, characters) {
    if (storageMode !== "cloud" || !gameId) return;
    if (pendingCharactersPush && pendingCharactersPush.timer) {
      clearTimeout(pendingCharactersPush.timer);
    }
    pendingCharactersPush = { gameId: gameId, storageMode: storageMode, characters: characters, timer: null };
    pendingCharactersPush.timer = setTimeout(function () {
      var payload = pendingCharactersPush;
      pendingCharactersPush = null;
      sendCharactersPush(payload);
    }, CLOUD_PUSH_DEBOUNCE_MS);
  }

  // ページを閉じる／離脱する瞬間にdebounce待ちの書き込みが残っていた場合のベストエフォート
  // フラッシュ（タイマーを待たず即座に送信を試みる）。unload中の非同期処理はブラウザに
  // よっては完走しない場合があるが、何もしないよりは救済できる可能性が上がる。
  // localStorageへの保存自体は各saveState()/saveRosterCharacters()呼び出し時点で既に
  // 同期的に完了済みのため、この端末自身のデータが失われることはない——影響があるとすれば
  // 他端末（Firebase経由）が最後の1回分の変更を見られないまま、という範囲に留まる。
  function flushPendingCloudPushes() {
    if (pendingNightStatePush && pendingNightStatePush.timer) {
      clearTimeout(pendingNightStatePush.timer);
      var nsPayload = pendingNightStatePush;
      pendingNightStatePush = null;
      sendNightStatePush(nsPayload);
    }
    if (pendingCharactersPush && pendingCharactersPush.timer) {
      clearTimeout(pendingCharactersPush.timer);
      var charPayload = pendingCharactersPush;
      pendingCharactersPush = null;
      sendCharactersPush(charPayload);
    }
  }
  window.addEventListener("pagehide", flushPendingCloudPushes);
  window.addEventListener("beforeunload", flushPendingCloudPushes);

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
