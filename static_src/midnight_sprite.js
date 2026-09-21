(function () {
  // midnight（即時制）的敵人 sprite 表現層。
  // 設計文件：docs/superpowers/specs/2026-09-21-midnight-sprite-combat-design.md
  //
  // 跟判定層完全分離（spec §4）——這裡只知道「現在該顯示哪一幀」，完全不參與命中判定；
  // 反過來判定層只讀 enemy_sprite_data.js 的 hitFrame，不碰圖片。所以就算一張圖都還沒
  // 產出，遊戲照樣成立。
  //
  // 從 sheet 切出單幀是靠 CSS 的 background-position（不另外產出切好的檔案），所以
  // cellPx 必須由顯示框的實際寬度推算、不能寫死：桌機與手機的框寬不同，但共用同一張 sheet。
  var S = window.PriTestEnemySprite;
  var R = window.PriTestEnemySpriteRegistry;

  var stageEl = null;
  var current = null; // { animId: string, startAt: number }
  var cellPx = 0;

  function sheetFileFor(familyId, enemyId, isBoss) {
    if (!R) return null;
    var id = isBoss ? R.sheetIdForBoss(enemyId) : R.sheetIdForEnemy(familyId, enemyId);
    if (!id) return null;
    var sheet = R.getSheet(id);
    if (!sheet || !sheet.available) return null;
    return sheet.file;
  }

  function frameIndexAt(animId, elapsedMs) {
    var a = S.getAnim(animId);
    if (!a || elapsedMs < 0) return null;
    var idx = Math.floor(elapsedMs / a.frameMs);
    if (a.loop) return idx % a.frameCount;
    if (idx >= a.frameCount) return a.hold ? a.frameCount - 1 : null;
    return idx;
  }

  function backgroundPosition(animId, frameIndex, px) {
    var a = S.getAnim(animId);
    if (!a) return "0px 0px";
    return -(frameIndex * px) + "px " + -(a.row * px) + "px";
  }

  // ---- 以下是 DOM 操作。跟上面的純函式不同，check 腳本驗不到（要 Playwright），
  // 手動確認步驟見計畫的 Task 6 Step 6。----
  //
  // DOM 所有權：這個模組只擁有自己建立的 #midnight-enemy-sprite-stage，絕不去動
  // #midnight-field-encounter-image（那是 midnight.js 的）。夜王分支對名冊裡沒有立繪的
  // 敵人（nameless，劇本10専用）是刻意把 <img> 藏起來的，這裡若順手翻它的 hidden，
  // 就會把前一隻敵人殘留的 src 或空 src 露出來。img 的可見性一律交給呼叫端決定。
  //
  // 2026-09-21 使用者明確規格改版：sprite 不再取代插圖，而是「背景仍舊顯示元圖片，
  // 產生的點陣圖敵人顯示在圖片的頂層」。舞台用 position:absolute 疊在 <img> 正上方
  // （堆疊順序見 style.css 同選擇器的說明），所以呼叫端在 sprite 顯示時也不再去藏 <img>。

  function mount(wrapEl) {
    if (!wrapEl || stageEl) return;
    stageEl = wrapEl.ownerDocument.createElement("div");
    stageEl.id = "midnight-enemy-sprite-stage";
    stageEl.hidden = true;
    wrapEl.insertBefore(stageEl, wrapEl.firstChild);
  }

  function showStatic() {
    if (stageEl) stageEl.hidden = true;
    current = null;
  }

  // sheet 是橫6幀 × 縱8動作，以顯示框的一邊當作1格的實際尺寸。
  // 視窗縮放／手機轉向後框寬會變，所以要能重算；但 backgroundSize 只在寬度真的變了
  // 才寫回 DOM，避免每一影格都觸發樣式重算。
  function syncCellPx() {
    if (!stageEl) return;
    var px = stageEl.offsetWidth || 128;
    if (px === cellPx) return;
    cellPx = px;
    stageEl.style.backgroundSize = S.SHEET_COLS * cellPx + "px " + S.SHEET_ROWS * cellPx + "px";
  }

  // 回傳 true＝sprite 舞台已顯示（疊在插圖之上）；
  // 回傳 false＝顯示不了（例如 stageEl 還沒 mount），呼叫端要改叫 showStatic() 收掉舞台。
  // 不論回傳什麼，呼叫端都不該去動 <img> 的 hidden——插圖一律留著當背景。
  function showSprite(sheetFile, staticPrefix) {
    if (!stageEl) return false;
    stageEl.style.backgroundImage =
      "url(" + (staticPrefix || "../static/") + "images/sprites/" + sheetFile + ")";
    stageEl.hidden = false;
    syncCellPx();
    playAnim("idle", Date.now());
    return true;
  }

  function playAnim(animId, startAt) {
    if (!S.getAnim(animId)) return;
    current = { animId: animId, startAt: startAt };
  }

  function tick(now) {
    if (!stageEl || stageEl.hidden || !current) return;
    syncCellPx();
    var idx = frameIndexAt(current.animId, now - current.startAt);
    if (idx === null) {
      playAnim("idle", now);
      idx = 0;
    }
    stageEl.style.backgroundPosition = backgroundPosition(current.animId, idx, cellPx);
  }

  window.PriTestMidnightSprite = {
    sheetFileFor: sheetFileFor,
    frameIndexAt: frameIndexAt,
    backgroundPosition: backgroundPosition,
    mount: mount,
    showStatic: showStatic,
    showSprite: showSprite,
    playAnim: playAnim,
    tick: tick
  };
})();
