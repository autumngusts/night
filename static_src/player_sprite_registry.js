(function () {
  // 玩家操作角色の sprite sheet 登錄表。
  // 自動產生: node tools/sprite_check/sprite_player_registry_gen.js --write
  // 不要手動修改——要改分配就去改產生器的 VARIANT_OWN 再重新產生。
  //
  // available は「画像が產出済みか」。false のあいだ midnight_player_sprite.js は
  // 何も表示しない（敵人側と違って代役は立てない——他人の角色の絵が自分の位置に
  // 出るほうが、何も出ないより混乱する）。sprite_pack.js が true に書き換える。
  var SHEETS = [
    { id: "player_tracker", file: "player_tracker.png", available: true },
    { id: "player_guardian", file: "player_guardian.png", available: true },
    { id: "player_iron_eye", file: "player_iron_eye.png", available: true },
    { id: "player_lady", file: "player_lady.png", available: true },
    { id: "player_ruffian", file: "player_ruffian.png", available: true },
    { id: "player_avenger", file: "player_avenger.png", available: true },
    { id: "player_hermit", file: "player_hermit.png", available: true },
    { id: "player_executor", file: "player_executor.png", available: true },
    { id: "player_scholar", file: "player_scholar.png", available: true },
    { id: "player_undertaker", file: "player_undertaker.png", available: true }
  ];

  // 角色類型 id -> sheet id。暗黑／黎明の派生類型は素体と同じ sheet を共用する。
  var TYPE_SHEET = {
    "tracker": "player_tracker",
    "guardian": "player_guardian",
    "iron_eye": "player_iron_eye",
    "lady": "player_lady",
    "ruffian": "player_ruffian",
    "avenger": "player_avenger",
    "hermit": "player_hermit",
    "executor": "player_executor",
    "scholar": "player_scholar",
    "undertaker": "player_undertaker",
    "tracker_dark": "player_tracker",
    "guardian_dawn": "player_guardian",
    "iron_eye_dark": "player_iron_eye",
    "lady_dawn": "player_lady",
    "ruffian_dark": "player_ruffian",
    "avenger_dark": "player_avenger",
    "hermit_dawn": "player_hermit",
    "executor_dark": "player_executor",
    "scholar_dark": "player_scholar",
    "undertaker_dawn": "player_undertaker"
  };

  function listSheets() {
    return SHEETS;
  }

  function getSheet(sheetId) {
    return (
      SHEETS.filter(function (s) {
        return s.id === sheetId;
      })[0] || null
    );
  }

  function sheetIdForType(typeId) {
    return TYPE_SHEET[typeId] || null;
  }

  // 表現層が呼ぶのはこちら。產出済みの sheet のファイル名、無ければ null。
  function sheetFileForType(typeId) {
    var sheet = getSheet(sheetIdForType(typeId));
    if (!sheet || !sheet.available) return null;
    return sheet.file;
  }

  window.PriTestPlayerSpriteRegistry = {
    listSheets: listSheets,
    getSheet: getSheet,
    sheetIdForType: sheetIdForType,
    sheetFileForType: sheetFileForType
  };
})();
