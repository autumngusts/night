(function () {
  // midnight（即時制）の敵 sprite 表現層。
  // 設計文件：docs/superpowers/specs/2026-09-21-midnight-sprite-combat-design.md
  //
  // 判定層とは完全に分離している（spec §4）——ここは「今どの幀を見せるか」しか知らず、
  // 命中判定には一切関与しない。逆に判定層は enemy_sprite_data.js の hitFrame だけを
  // 読み、画像には触らない。だから画像が1枚も無くてもゲームは成立する。
  //
  // sheet からの切り出しは CSS の background-position で行う（切り出し済みファイルは
  // 作らない）。cellPx は表示枠の実寸から算出する。
  var S = window.PriTestEnemySprite;
  var R = window.PriTestEnemySpriteRegistry;

  var stageEl = null;
  var imgEl = null;
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

  // ---- 以下は DOM 操作。純函式部分（上）と違い check スクリプトでは検証できない
  // （Playwright が要る）。手動確認の手順は計画の Task 6 Step 6 を参照。----

  function mount(wrapEl) {
    if (!wrapEl || stageEl) return;
    imgEl = wrapEl.querySelector("#midnight-field-encounter-image");
    stageEl = wrapEl.ownerDocument.createElement("div");
    stageEl.id = "midnight-enemy-sprite-stage";
    stageEl.hidden = true;
    wrapEl.insertBefore(stageEl, wrapEl.firstChild);
  }

  function showStatic() {
    if (stageEl) stageEl.hidden = true;
    if (imgEl) imgEl.hidden = false;
    current = null;
  }

  function showSprite(sheetFile, staticPrefix) {
    if (!stageEl) return;
    stageEl.style.backgroundImage =
      "url(" + (staticPrefix || "../static/") + "images/sprites/" + sheetFile + ")";
    stageEl.hidden = false;
    if (imgEl) imgEl.hidden = true;
    // sheet は横6幀 × 縦8動作。表示枠の一辺を1格の実寸として扱う。
    cellPx = stageEl.offsetWidth || 128;
    stageEl.style.backgroundSize = S.SHEET_COLS * cellPx + "px " + S.SHEET_ROWS * cellPx + "px";
    playAnim("idle", Date.now());
  }

  function playAnim(animId, startAt) {
    if (!S.getAnim(animId)) return;
    current = { animId: animId, startAt: startAt };
  }

  function tick(now) {
    if (!stageEl || stageEl.hidden || !current) return;
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
