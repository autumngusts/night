(function () {
  // 玩家操作角色 sprite 的動作時間軸定義。
  // 規格：tools/sprite_spec.md「玩家操作角色 sheet（2026-09-24 使用者明確規格）」
  // 設計文件：docs/superpowers/specs/2026-09-21-midnight-sprite-combat-design.md
  //
  // 敵人版（enemy_sprite_data.js）是 6×8、行＝招式類別；玩家版是 6×10、行＝玩家的操作。
  // **兩者是不同的 sheet 規格，不要共用 SHEET_ROWS**——row 直接就是該動作在 sheet 上的
  // 縱向位置，混用會讓每一格都錯位。
  //
  // 敵人版的 hitFrame 是判定層要用的（前搖幾秒後命中，玩家照動畫讀招）。玩家側沒有這層
  // 需求：玩家的命中與資源消耗在按下按鈕的當下就由 midnight.js 結算完了，sprite 純粹是
  // 事後的表現。因此這裡不放 hitFrame，維持「表現層不參與判定」的三層解耦（設計文件 §4）。
  var SHEET_COLS = 6;
  var SHEET_ROWS = 10;

  // priority：同時有多個動作要播時，數字大的贏（見 midnight_player_sprite.js 的 playAnim()）。
  // 死亡 > 受擊 > 招式 > 迴避 > 待機。受擊要能打斷招式（被打到卻還在揮刀會看不出挨打），
  // 但死亡之後不再被任何東西打斷。
  var ANIMS = [
    { id: "idle", row: 0, frameCount: 6, frameMs: 200, loop: true, hold: false, priority: 0 },
    { id: "dodge", row: 1, frameCount: 6, frameMs: 70, loop: false, hold: false, priority: 2 },
    { id: "hurt", row: 2, frameCount: 6, frameMs: 80, loop: false, hold: false, priority: 8 },
    { id: "death", row: 3, frameCount: 6, frameMs: 170, loop: false, hold: true, priority: 9 },
    { id: "attack1", row: 4, frameCount: 6, frameMs: 80, loop: false, hold: false, priority: 4 },
    { id: "attack2", row: 5, frameCount: 6, frameMs: 90, loop: false, hold: false, priority: 5 },
    { id: "critical", row: 6, frameCount: 6, frameMs: 120, loop: false, hold: false, priority: 7 },
    { id: "ability", row: 7, frameCount: 6, frameMs: 140, loop: false, hold: false, priority: 6 },
    { id: "skill", row: 8, frameCount: 6, frameMs: 130, loop: false, hold: false, priority: 6 },
    { id: "arts", row: 9, frameCount: 6, frameMs: 150, loop: false, hold: false, priority: 6 }
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

  function animTotalMs(animId) {
    var a = getAnim(animId);
    if (!a) return 0;
    return a.frameMs * a.frameCount;
  }

  function animPriority(animId) {
    var a = getAnim(animId);
    return a ? a.priority : -1;
  }

  window.PriTestPlayerSprite = {
    SHEET_COLS: SHEET_COLS,
    SHEET_ROWS: SHEET_ROWS,
    listAnims: listAnims,
    getAnim: getAnim,
    animTotalMs: animTotalMs,
    animPriority: animPriority
  };
})();
