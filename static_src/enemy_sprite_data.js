(function () {
  // 敵人 sprite 的動作時間軸定義。
  // 設計文件：docs/superpowers/specs/2026-09-21-midnight-sprite-combat-design.md
  //
  // 8 動作 × 6 幀の sheet を、横6幀 × 縦8動作 で並べる（spec §5.3）。row がそのまま
  // sheet の縦位置になるので、ここの row を変えると既存の sheet 画像が全部ずれる。
  //
  // frameMs × hitFrame ＝ 前搖（プレイヤーが招を読む時間）。使用者明確規格で
  // 0.4~0.7 秒の範囲が指定されているが、各動作への配分は暫定値で、階段2で実図が
  // 入ってから体感に合わせて校正する（spec §12）。tools/sprite_check/sprite_anim_check.js
  // が範囲を強制しているので、校正時もこの区間から外れることはない。
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
