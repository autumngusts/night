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
    { id: "player_undertaker", file: "player_undertaker.png", available: true },
    { id: "player_tracker_dark", file: "player_tracker_dark.png", available: true },
    { id: "player_guardian_dawn", file: "player_guardian_dawn.png", available: true },
    { id: "player_iron_eye_dark", file: "player_iron_eye_dark.png", available: true },
    { id: "player_lady_dawn", file: "player_lady_dawn.png", available: true },
    { id: "player_ruffian_dark", file: "player_ruffian_dark.png", available: true },
    { id: "player_avenger_dark", file: "player_avenger_dark.png", available: true },
    { id: "player_hermit_dawn", file: "player_hermit_dawn.png", available: true },
    { id: "player_executor_dark", file: "player_executor_dark.png", available: true },
    { id: "player_scholar_dark", file: "player_scholar_dark.png", available: true },
    { id: "player_undertaker_dawn", file: "player_undertaker_dawn.png", available: true }
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
    "tracker_dark": "player_tracker_dark",
    "guardian_dawn": "player_guardian_dawn",
    "iron_eye_dark": "player_iron_eye_dark",
    "lady_dawn": "player_lady_dawn",
    "ruffian_dark": "player_ruffian_dark",
    "avenger_dark": "player_avenger_dark",
    "hermit_dawn": "player_hermit_dawn",
    "executor_dark": "player_executor_dark",
    "scholar_dark": "player_scholar_dark",
    "undertaker_dawn": "player_undertaker_dawn"
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
