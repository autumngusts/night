// ============================================================================
// midnight（即時制擴張版・技術驗證片）主邏輯。
// ============================================================================
// 這是技術驗證片，範圍見docs之外另存的規劃紀錄（本次milestone明確排除：任何實際戰鬥
// 數值/傷害公式/角色卡整合，只驗證「程式生地圖＋canvas+rAF連續渲染＋即時移動同步＋
// 縮圈錨點計時＋共享數值用RTDB transaction()原子操作」這幾個技術風險點）。
//
// 跟night.js完全分開的獨立state／Firebase資料路徑（games/{gameId}/rtState/...，
// 不是night專屬的nightState/characters），刻意不重用night.js的回合制/DOM格子渲染
// pattern——見規劃紀錄，這裡的地圖是自由座標＋canvas，跟night固定9格棋盤是不同量級的東西。
(function () {
  "use strict";

  var Map_ = window.PriTestMidnightMap;
  var GameStorage = window.PriTestGameStorage;

  var GRID = Map_.GRID_SIZE;
  var CELL = Map_.CELL_PX;
  var MOVE_SPEED = 4.5; // 每秒移動幾格（世界座標）
  var POS_PUSH_INTERVAL_MS = 100; // 位置節流：本地移動即時反應，但只用10Hz的頻率把座標寫進RTDB
  var CIRCLE_DURATION_MS = 120000; // 縮圈總時長：2分鐘（純技術驗證片參數，非最終數值）
  var CIRCLE_GRACE_MS = 5000; // 開局後5秒才開始縮，讓玩家有時間看清地圖
  var DAMAGE_TICK_MS = 1000; // 圈外每1秒扣1點demo存活值
  var LERP_FACTOR = 0.25; // 遠端圖標插值平滑係數（每影格往目標位置靠近的比例）

  var gameId = null;
  var myTokenId = null;
  var myName = null;
  var map = null;
  var meta = null; // { mapSeed, circleStartAt, circleDurationMs, circleStartRadius, circleEndRadius }
  var localPos = null; // { x, y } 本地即時座標（自己的token，zero-latency）
  var remoteTokens = {}; // tokenId -> { x, y, name, color, updatedAt }（來自RTDB）
  var renderedRemotePos = {}; // tokenId -> { x, y }（插值後、實際畫在畫面上的座標）
  var demoStats = {}; // tokenId(或"sharedTarget") -> number
  var keysDown = {};
  var lastFrameTime = null;
  var lastPosPushTime = 0;
  var lastPushedPos = null;
  var lastDamageTickTime = 0;
  var canvas = null;
  var ctx = null;

  function qsGameId() {
    var params = new URLSearchParams(window.location.search);
    return params.get("game");
  }

  function randomTokenId() {
    return "tok" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function el(id) {
    return document.getElementById(id);
  }

  // ---- 建立新測試場：產生gameId＋初始meta（地圖種子、縮圈時間軸錨點），等寫入RTDB
  // 真正完成後才導向帶?game=的網址（讓建立者跟加入者走同一條初始化路徑，不用維護兩套
  // 邏輯）。----
  // 使用者實測發現的bug修正（2026-09-03）：以前這裡呼叫完GameStorage.rtSet()（fire-and-
  // forget，不等待）就立刻window.location.href導頁。但rtSet內部要先依序載入4個Firebase
  // SDK script＋完成匿名登入才會真的送出寫入，這些都還沒完成、頁面就已經因為導頁被整個
  // 摧毀——寫入永遠沒機會真正送到Firebase，導致其他裝置（甚至導頁後的自己）訂閱到的meta
  // 永遠是null，畫面卡在起始畫面看不到地圖（不是AppCheck/reCAPTCHA或Firebase規則的問題，
  // 這兩者在同個repo既有的night雲端遊戲已驗證過不會擋住流程）。改成await rtSet()回傳的
  // Promise，確認真的寫入成功後才導頁。
  function handleCreateClick() {
    var btn = el("btn-midnight-create");
    btn.disabled = true;
    btn.textContent = window.I18N.t("midnight_creating_note");
    var newId = GameStorage.generateCloudGameId();
    var seed = (Math.random() * 0xffffffff) >>> 0;
    var now = Date.now();
    var initialMeta = {
      mapSeed: seed,
      createdAt: now,
      circleStartAt: now + CIRCLE_GRACE_MS,
      circleDurationMs: CIRCLE_DURATION_MS,
      circleStartRadius: GRID * 0.75,
      circleEndRadius: GRID * 0.08,
    };
    GameStorage.rtSet(newId, "cloud", "meta", initialMeta).then(function () {
      window.location.href = "?game=" + encodeURIComponent(newId);
    });
  }

  // ---- 加入既有測試場：訂閱meta，等待地圖種子/縮圈錨點抵達後才真正開始（可能是自己剛
  // 建立、也可能是別人分享連結進來，兩種情況走同一段初始化）。----
  function onMetaReceived(value) {
    if (!value || meta) return; // 已經初始化過就不重複（meta理論上建立後不會再變）
    meta = value;
    map = Map_.generateMap(meta.mapSeed);
    var rand = Math.random;
    var spawn = Map_.findWalkableSpawn(map, rand);
    localPos = { x: spawn.x, y: spawn.y };
    el("midnight-start-screen").hidden = true;
    el("midnight-canvas").hidden = false;
    el("midnight-hud").hidden = false;
    // 自己的demoStat若還不存在（第一次加入），用transaction()初始化成100——用transaction()
    // 而非rtSet，是為了避免「兩台裝置幾乎同時第一次加入、都判斷『目前是null所以要初始化』」
    // 時互相覆寫（雖然這裡兩邊初始化的值原本就相同，但統一走transaction()維持機制一致）。
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
      return cur === null ? 100 : cur;
    });
    startLoop();
  }

  function onTokensReceived(value) {
    remoteTokens = value || {};
  }

  function onDemoStatsReceived(value) {
    demoStats = value || {};
    renderHud();
  }

  // ---- 輸入：held-key連續移動（即時制常見手感——按住方向鍵，角色持續移動），
  // 而不是回合制常見的「點一下走一步」。----
  function bindInput() {
    document.addEventListener("keydown", function (e) {
      keysDown[e.key.toLowerCase()] = true;
    });
    document.addEventListener("keyup", function (e) {
      keysDown[e.key.toLowerCase()] = false;
    });
    el("btn-midnight-attack-shared-target").addEventListener("click", function () {
      GameStorage.rtTransaction(gameId, "cloud", "demoStat/sharedTarget", function (cur) {
        var next = (cur === null ? 20 : cur) - 1;
        return next < 0 ? 0 : next;
      });
    });
  }

  function tryMove(dx, dy) {
    var nx = localPos.x + dx;
    var ny = localPos.y + dy;
    // 分離X/Y軸各自檢查，讓角色可以沿著牆滑動（其中一軸卡牆、另一軸仍可移動），
    // 手感比「整個位移一起被牆擋死」更接近一般即時制動作遊戲。
    if (Map_.isWalkable(map, nx, localPos.y)) localPos.x = nx;
    if (Map_.isWalkable(map, localPos.x, ny)) localPos.y = ny;
  }

  function updateMovement(dtSec) {
    var dx = 0;
    var dy = 0;
    if (keysDown["arrowup"] || keysDown["w"]) dy -= 1;
    if (keysDown["arrowdown"] || keysDown["s"]) dy += 1;
    if (keysDown["arrowleft"] || keysDown["a"]) dx -= 1;
    if (keysDown["arrowright"] || keysDown["d"]) dx += 1;
    if (dx === 0 && dy === 0) return;
    var len = Math.sqrt(dx * dx + dy * dy);
    var step = (MOVE_SPEED * dtSec) / len;
    tryMove(dx * step, dy * step);
  }

  // ---- 節流網路寫入：本地移動每影格都即時反應（zero-latency），但只用10Hz頻率把
  // 座標實際送進RTDB（60Hz送RTDB太貴太頻繁）。其他裝置收到後用lerp插值補間，
  // 掩蓋掉這10Hz之間的網路延遲與更新間隔，讓遠端角色看起來也是平滑移動而非跳格。----
  function maybePushPosition(now) {
    if (now - lastPosPushTime < POS_PUSH_INTERVAL_MS) return;
    if (lastPushedPos && lastPushedPos.x === localPos.x && lastPushedPos.y === localPos.y) return;
    lastPosPushTime = now;
    lastPushedPos = { x: localPos.x, y: localPos.y };
    GameStorage.rtSet(gameId, "cloud", "tokens/" + myTokenId, {
      x: localPos.x,
      y: localPos.y,
      name: myName,
      updatedAt: now,
    });
  }

  function currentCircleRadius(now) {
    var elapsed = now - meta.circleStartAt;
    var progress = elapsed / meta.circleDurationMs;
    if (progress < 0) progress = 0;
    if (progress > 1) progress = 1;
    return meta.circleStartRadius + (meta.circleEndRadius - meta.circleStartRadius) * progress;
  }

  function distanceFromCenter(x, y) {
    var cx = map.width / 2;
    var cy = map.height / 2;
    return Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
  }

  // ---- 縮圈扣血：本地每秒判定一次自己是否在圈外，若是則透過transaction()對自己的
  // demoStat做原子扣血。這是「持續傷害縮圈」規則的技術驗證（非正式數值），也直接沿用
  // 跟共享標靶攻擊按鈕相同的transaction()機制。----
  function maybeApplyCircleDamage(now) {
    if (now - lastDamageTickTime < DAMAGE_TICK_MS) return;
    lastDamageTickTime = now;
    var radius = currentCircleRadius(now);
    if (distanceFromCenter(localPos.x, localPos.y) <= radius) return;
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
      var next = (cur === null ? 100 : cur) - 1;
      return next < 0 ? 0 : next;
    });
  }

  function render(now) {
    var w = canvas.width;
    var h = canvas.height;
    ctx.fillStyle = "#0c0f14";
    ctx.fillRect(0, 0, w, h);

    // 地圖（世界座標→畫面座標：世界原點對齊canvas左上角，1格=CELL像素）
    for (var y = 0; y < map.height; y++) {
      for (var x = 0; x < map.width; x++) {
        var wall = map.grid[y * map.width + x];
        ctx.fillStyle = wall ? "#2a2f3a" : "#1a1e26";
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    map.landmarks.forEach(function (lm) {
      ctx.fillStyle = "#c9a24b";
      ctx.beginPath();
      ctx.arc(lm.x * CELL + CELL / 2, lm.y * CELL + CELL / 2, CELL * 0.3, 0, Math.PI * 2);
      ctx.fill();
    });

    // 縮圈（用錨點時間戳在本地算出目前半徑，不是逐幀網路同步）
    var radius = currentCircleRadius(now);
    var cx = (map.width / 2) * CELL;
    var cy = (map.height / 2) * CELL;
    ctx.strokeStyle = "#7fd1ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * CELL, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(127, 209, 255, 0.06)";
    ctx.fill();

    // 遠端圖標：往最新已知座標插值靠近（lerp），避免每10Hz更新一次時的跳格感。
    Object.keys(remoteTokens).forEach(function (id) {
      if (id === myTokenId) return;
      var target = remoteTokens[id];
      var cur = renderedRemotePos[id] || { x: target.x, y: target.y };
      cur.x += (target.x - cur.x) * LERP_FACTOR;
      cur.y += (target.y - cur.y) * LERP_FACTOR;
      renderedRemotePos[id] = cur;
      drawToken(cur.x, cur.y, "#e0664c", target.name);
    });

    // 自己的圖標：直接畫本地即時座標，zero-latency。
    drawToken(localPos.x, localPos.y, "#5ecb7d", myName);
  }

  function drawToken(x, y, color, name) {
    var px = x * CELL;
    var py = y * CELL;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, CELL * 0.4, 0, Math.PI * 2);
    ctx.fill();
    if (name) {
      ctx.fillStyle = "#e8e8ec";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(name, px, py - CELL * 0.6);
    }
  }

  function renderHud() {
    var mine = demoStats[myTokenId];
    var target = demoStats.sharedTarget;
    el("midnight-hud-self-stat").textContent = window.I18N.t("midnight_hud_self_stat", {
      value: mine === undefined ? "-" : mine,
    });
    el("midnight-hud-target-stat").textContent = window.I18N.t("midnight_hud_target_stat", {
      value: target === undefined ? "-" : target,
    });
  }

  function frame(ts) {
    var now = Date.now();
    var dtSec = lastFrameTime === null ? 0 : Math.min((ts - lastFrameTime) / 1000, 0.1);
    lastFrameTime = ts;
    updateMovement(dtSec);
    maybePushPosition(now);
    maybeApplyCircleDamage(now);
    render(now);
    requestAnimationFrame(frame);
  }

  function startLoop() {
    requestAnimationFrame(frame);
  }

  document.addEventListener("DOMContentLoaded", function () {
    canvas = el("midnight-canvas");
    ctx = canvas.getContext("2d");
    canvas.width = GRID * CELL;
    canvas.height = GRID * CELL;

    gameId = qsGameId();
    myTokenId = randomTokenId();
    myName = window.I18N.t("midnight_default_player_name") + Math.floor(Math.random() * 1000);

    bindInput();

    if (!gameId) {
      el("midnight-start-screen").hidden = false;
      el("btn-midnight-create").addEventListener("click", handleCreateClick);
      return;
    }

    el("midnight-share-link").value = window.location.href;
    GameStorage.rtSubscribe(gameId, "cloud", "meta", onMetaReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "tokens", onTokensReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "demoStat", onDemoStatsReceived);
  });

  // Playwright多裝置測試用の唯一存取窗口（見tools/field_card_sweep）：直接讀取內部
  // state比疊加DOM data屬性更可靠、也不會誤動到正式UI。不對外公開文件化，純測試用。
  window.PriTestMidnight = {
    _debugState: function () {
      return {
        gameId: gameId,
        myTokenId: myTokenId,
        localPos: localPos,
        remoteTokens: remoteTokens,
        demoStats: demoStats,
        meta: meta,
      };
    },
  };
})();
