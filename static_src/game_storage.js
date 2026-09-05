// クラウド保存（雲端保存）の同期抽象化レイヤー。
// storageMode !== "cloud" のときは全関数が即座に何もせず返る＝ローカル専用ゲームでは
// Firebase SDKのロードもネットワーク通信も一切発生しない。
(function () {
  "use strict";

  var FIREBASE_SDK_VERSION = "10.14.1";
  var sdkReadyPromise = null;
  var authReadyPromise = null;
  var appCheckActivated = false;

  // Firebase Local Emulator Suite切替（2026-09-05新增，開發／自動化測試專用）：正式環境
  // （GitHub Pages／使用者手動用真的Firebase專案測試）完全不受影響——這個旗標預設一定是
  // false，只有測試工具自己用sessionStorage明確設定過才會生效（見tools/midnight_check/
  // emulator_sync_check.js）。用sessionStorage而不是URL query string，是因為midnight.js的
  // 「建立測試場」流程會用window.location.href="?game="+id整個蓋掉原本的query string
  // （見static/midnight.js的handleCreateClick()），query string形式的旗標會在那個瞬間
  // 遺失；sessionStorage不受這次導頁影響，同一分頁、同一origin下全程有效。
  // 生效時效果：①database()／auth()改連本機emulator（127.0.0.1，見firebase.json的
  // emulators.database/auth port），完全不會對外連線；②略過App Check（reCAPTCHA v3）
  // 啟用——emulator本來就不會、也不需要驗證App Check token，啟用它只會白白多送一堆
  // 一定會失敗的reCAPTCHA請求。
  function rtdbEmulatorEnabled() {
    try {
      return window.sessionStorage.getItem("pritestRtdbEmulator") === "1";
    } catch (e) {
      return false;
    }
  }

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
        if (rtdbEmulatorEnabled()) {
          // useEmulator()必須在這個app的auth()/database()第一次被實際使用之前呼叫——
          // ensureSdkLoaded()整個Promise鏈完成後才會有任何呼叫端去用它們，順序上沒問題。
          window.firebase.auth().useEmulator("http://127.0.0.1:9099");
          window.firebase.database().useEmulator("127.0.0.1", 9000);
          return;
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

  // 使用者確認（2026-09-01、潛在之力/武器/飾品/消耗品跨裝置抽選race condition修正）：
  // この4つのマップ（state.activeDraws配下、各角色が自分の抽選だけを獨立して書く設計）は
  // 通常の全體.set()上書きから除外し、pushDrawCharEntry()の專用leaf update経路のみで
  // 同期する。理由：saveState()は無關の操作でも頻繁に呼ばれ、その都度「この端末が
  // 呼び出し時点で知っているだけの（他端末が直前に別のcharIdへ追加した分がまだ
  // 反映されていないかもしれない）」スナップショットを丸ごと書き戻していた。2台が
  // ほぼ同時に別々のcharIdへ追加すると、後から書いた側が先の追加を消してしまう
  // （詳細はdocs/combat_flow_rules.md該当箇所）。
  var EXCLUDED_ACTIVE_DRAWS_KEYS = ["potentialPowerByChar", "weaponByChar", "talismanByChar", "consumableByChar"];

  // 使用者確認：Firebaseの複數パスupdate()を薄くラップした汎用ヘルパー。keyはnightState
  // からの相對パス（スラッシュ區切り、例："activeDraws/eventChip"）、valueはそのパスに
  // 書き込む値（nullで該当パスを削除）。updatesの各キーは互いに獨立して書き込まれるため、
  // updatesに含まれないパスは一切変更されない——これを利用して「特定のcharIdのエントリ
  // だけを書く」「特定のmapまるごとだけをnullにする」等、全體.set()上書きの影響範囲を
  // 狭めた書き込みができる。
  function updateNightStatePaths(gameId, storageMode, updates) {
    if (storageMode !== "cloud" || !gameId) return;
    ensureCloudReady(storageMode)
      .then(function () {
        window.firebase.database().ref("games/" + gameId + "/nightState").update(updates);
      })
      .catch(function (err) {
        console.error("PriTestGameStorage.updateNightStatePaths failed", err);
      });
  }

  // 特定の1角色（charId）分のエントリだけをpotentialPowerByChar等へ書く（またはvalue===null
  // で削除する）専用の狭い書き込み経路。上記EXCLUDED_ACTIVE_DRAWS_KEYSの4マップは、通常の
  // pushNightState()からは完全に除外され、この経路でのみFirebaseへ反映される。
  function pushDrawCharEntry(gameId, storageMode, mapKey, charId, value) {
    var updates = {};
    updates["activeDraws/" + mapKey + "/" + charId] = value === undefined ? null : value;
    updateNightStatePaths(gameId, storageMode, updates);
  }

  // midnight（即時制擴張版技術驗證片）専用：games/{gameId}/rtStateへの汎用アクセス。
  // nightState/characters（デバウンス＋丸ごと.update()＋client時間戳LWW、night.js専用の
  // 形式）とは別のトップレベル子ノード（database.rules.jsonのgames/$gameId/rtStateを
  // 参照）。真即時制の要件（頻繁な座標更新、複數端末が同じ値を同時に書き換える共有カウンター）
  // に合わせて、汎用の生パス書き込み・購読・トランザクションの3つだけを薄く提供する——
  // nightState側の複雑な差分/除外ロジックはmidnight側には不要（そもそも別の同期方式を
  // 採用するため）、ここでは意図的にシンプルなまま留める。
  // 使用者實測發現的bug修正（2026-09-03）：回傳ensureCloudReady().then(...)這條Promise鏈
  // （原本是fire-and-forget、不回傳），讓呼叫端能視需要await寫入真正完成。起因是
  // midnight.js的「建立測試場」流程呼叫rtSet()後立刻window.location.href導航到帶?game=
  // 的網址——SDK載入（4個依序的網路script請求）＋匿名登入都還沒完成，整個頁面就被導航
  // 摧毀，實際的Firebase寫入永遠沒有機會真正送出，導致其他裝置訂閱到的meta永遠是null
  // （不是Firebase權限或AppCheck的問題，是呼叫端沒有等寫入完成就跳頁）。
  function rtSet(gameId, storageMode, subPath, value) {
    if (storageMode !== "cloud" || !gameId) return Promise.resolve();
    return ensureCloudReady(storageMode)
      .then(function () {
        return window.firebase
          .database()
          .ref("games/" + gameId + "/rtState/" + subPath)
          .set(value);
      })
      .catch(function (err) {
        console.error("PriTestGameStorage.rtSet failed", err);
      });
  }

  // subPathの値が変わるたびonChange(value)を呼ぶ。戻り値は購読解除用の関数。
  function rtSubscribe(gameId, storageMode, subPath, onChange) {
    if (storageMode !== "cloud" || !gameId) return function () {};
    var refObj = null;
    var listener = function (snap) {
      onChange(snap.val());
    };
    ensureCloudReady(storageMode)
      .then(function () {
        refObj = window.firebase.database().ref("games/" + gameId + "/rtState/" + subPath);
        refObj.on("value", listener);
      })
      .catch(function (err) {
        console.error("PriTestGameStorage.rtSubscribe failed", err);
      });
    return function unsubscribe() {
      if (refObj) refObj.off("value", listener);
    };
  }

  // 使用者確認済みの技術路線（2026-09-03）：共有數值（例：圈外扣血目標的demo存活值）改用
  // Firebase RTDB內建transaction()做原子操作——伺服器端保證多端同時寫入不會互相覆蓋遺失，
  // 跟nightState既有的「整物件覆寫+client時間戳LWW」（會弄丟其中一邊修改）是刻意分開的
  // 不同機制。updateFn(currentValue)是transaction()標準用法：currentValue可能是null（尚未
  // 存在），updateFn必須是純函式、回傳新值，可能因衝突被Firebase重複呼叫以重試。
  function rtTransaction(gameId, storageMode, subPath, updateFn) {
    if (storageMode !== "cloud" || !gameId) return Promise.resolve(null);
    return ensureCloudReady(storageMode)
      .then(function () {
        return window.firebase
          .database()
          .ref("games/" + gameId + "/rtState/" + subPath)
          .transaction(updateFn);
      })
      .then(function (result) {
        return result && result.committed ? result.snapshot.val() : null;
      })
      .catch(function (err) {
        console.error("PriTestGameStorage.rtTransaction failed", err);
        return null;
      });
  }

  function sendNightStatePush(payload, isRetry) {
    ensureCloudReady(payload.storageMode)
      .then(function () {
        var updates = {};
        Object.keys(payload.data).forEach(function (k) {
          if (k === "activeDraws" && payload.data.activeDraws && typeof payload.data.activeDraws === "object") {
            Object.keys(payload.data.activeDraws).forEach(function (subK) {
              if (EXCLUDED_ACTIVE_DRAWS_KEYS.indexOf(subK) === -1) {
                updates["activeDraws/" + subK] = payload.data.activeDraws[subK];
              }
            });
          } else {
            updates[k] = payload.data[k];
          }
        });
        window.firebase.database().ref("games/" + payload.gameId + "/nightState").update(updates);
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
            // 使用者確認：全新建立的雲端遊戲，Firebase上這個路徑一開始是空的，若在這裡
            // 略過空值不呼叫callback（舊行為），night.js側依賴這個callback才會啟動的
            // cloudNightStateSynced旗標就永遠不會變true，導致saveState()永遠不推送——
            // 造成「這場遊戲不管開幾台裝置都無法同步地圖/戰鬥狀態」的死鎖。改為無條件呼叫，
            // 與subscribeCharacters()（本來就沒有這個guard）行為一致，空值(null)一樣要
            // 通知呼叫端（由呼叫端判斷「遠端目前沒有資料」並自行決定要不要用本機資料回填）。
            onRemoteChange(snap.val());
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
    pushDrawCharEntry: pushDrawCharEntry,
    updateNightStatePaths: updateNightStatePaths,
    subscribeNightState: subscribeNightState,
    subscribeCharacters: subscribeCharacters,
    rtSet: rtSet,
    rtSubscribe: rtSubscribe,
    rtTransaction: rtTransaction,
  };
})();
