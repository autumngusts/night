(function () {
  // 敵人 sprite 的動作時間軸定義。
  // 設計文件：docs/superpowers/specs/2026-09-21-midnight-sprite-combat-design.md
  //
  // 8 動作 × 6 幀的 sheet，排成橫6幀 × 縱8動作（spec §5.3）。row 直接就是這個動作在
  // sheet 上的縱向位置，所以動到這裡的 row，既有的 sheet 圖片會全部錯位。
  //
  // frameMs × hitFrame ＝ 前搖（玩家讀招的時間）。使用者明確規格指定 0.4~0.7 秒這個
  // 區間，但各動作之間怎麼分配目前是暫定值，要等階段2實圖進來後再照體感校正
  // （spec §12）。tools/sprite_check/sprite_anim_check.js 會強制檢查這個區間，
  // 所以校正時也不會不小心跑出界。
  var SHEET_COLS = 6;
  var SHEET_ROWS = 8;

  var ANIMS = [
    { id: "idle", row: 0, frameCount: 6, frameMs: 200, hitFrame: null, loop: true, hold: false },
    { id: "line", row: 1, frameCount: 6, frameMs: 170, hitFrame: 3, loop: false, hold: false },
    { id: "area", row: 2, frameCount: 6, frameMs: 150, hitFrame: 4, loop: false, hold: false },
    { id: "thrust", row: 3, frameCount: 6, frameMs: 140, hitFrame: 3, loop: false, hold: false },
    { id: "slam", row: 4, frameCount: 6, frameMs: 175, hitFrame: 4, loop: false, hold: false },
    { id: "single", row: 5, frameCount: 6, frameMs: 150, hitFrame: 3, loop: false, hold: false },
    { id: "hurt", row: 6, frameCount: 6, frameMs: 90, hitFrame: null, loop: false, hold: false },
    { id: "death", row: 7, frameCount: 6, frameMs: 160, hitFrame: null, loop: false, hold: true }
  ];

  function listAnims() {
    return ANIMS;
  }

  function getAnim(animId) {
    return (
      ANIMS.filter(function (a) {
        return a.id === animId;
      })[0] || null
    );
  }

  function animHitTimeMs(animId) {
    var a = getAnim(animId);
    if (!a || a.hitFrame === null) return null;
    return a.frameMs * a.hitFrame;
  }

  function animTotalMs(animId) {
    var a = getAnim(animId);
    if (!a) return 0;
    return a.frameMs * a.frameCount;
  }

  window.PriTestEnemySprite = {
    SHEET_COLS: SHEET_COLS,
    SHEET_ROWS: SHEET_ROWS,
    listAnims: listAnims,
    getAnim: getAnim,
    animHitTimeMs: animHitTimeMs,
    animTotalMs: animTotalMs
  };
})();
