// 玩家操作角色 sprite sheet の登錄表を生成する。
//
//   node tools/sprite_check/sprite_player_registry_gen.js           # プレビュー
//   node tools/sprite_check/sprite_player_registry_gen.js --write   # 書き出し
//
// 角色類型の一覧は character_types.js から読む（一覧を二重に持たない）。敵人側の
// sprite_registry_gen.js と同じ考え方だが、割当はずっと単純：1 角色類型＝1 sheet。
//
// 暗黑／黎明の派生類型（tracker_dark, guardian_dawn …）は、素体と同じ sheet を使う。
// 規則書では別キャラクター扱いだが、絵としては同じ人物の色違いで、専用 sheet を起こすと
// 20 組ぶん生成し直すことになる。素体の sheet を代役に充てるほうが、無地の静止画に
// 落ちるより明らかに近い——後日 *_dark の絵が用意できたら VARIANT_OWN に足せばよい。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const TYPES_PATH = path.join(ROOT, "static_src", "character_types.js");
const REGISTRY_PATH = path.join(ROOT, "static_src", "player_sprite_registry.js");
const WRITE = process.argv.indexOf("--write") !== -1;

// 自分だけの絵を持つ派生類型。空のあいだは素体の sheet を共用する。
const VARIANT_OWN = {
  // 2026-09-26：追蹤者（暗黑）的專屬 sheet（photo/enemyPic/0926/追跡者_暗黑.png，
  // 切法見 tools/sprite_check/cells/player_tracker_dark.json）。
  tracker_dark: true,
  // 2026-09-26：守護者（黎明）（photo/enemyPic/0926/守護者_黎明.png，cells/player_guardian_dawn.json）。
  guardian_dawn: true,
  // 2026-09-26：淑女（黎明）（photo/enemyPic/0926/淑女_黎明.png，cells/player_lady_dawn.json）。
  lady_dawn: true,
  // 2026-09-26：鐵眼（暗黑）（photo/enemyPic/0926/鐵眼_暗黑.png，cells/player_iron_eye_dark.json）。
  iron_eye_dark: true,
  // 2026-09-26：無賴漢（暗黑）（photo/enemyPic/0926/無賴漢_暗黑.png，cells/player_ruffian_dark.json）。
  ruffian_dark: true,
  // 2026-09-26：送葬人（黎明）（photo/enemyPic/0926/葬儀屋_黎明.png，cells/player_undertaker_dawn.json）。
  undertaker_dawn: true,
  // 2026-09-26：執行者（暗黑）（photo/enemyPic/0926/執行者_暗黑.png，cells/player_executor_dark.json）。
  executor_dark: true,
  // 2026-09-26：學者（暗黑）（photo/enemyPic/0926/學者_暗黑.png，cells/player_scholar_dark.json）。
  scholar_dark: true,
  // 2026-09-26：復仇者（暗黑）（photo/enemyPic/0926/復仇者_暗黑.png，cells/player_avenger_dark.json）。
  avenger_dark: true,
  // 2026-09-26：隱者（黎明）（photo/enemyPic/0926/隱者_黎明.png，cells/player_hermit_dawn.json）。
  hermit_dawn: true
};

function loadTypes() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(TYPES_PATH, "utf8"), sandbox, { filename: "character_types.js" });
  const CT = sandbox.window.PriTestCharacterTypes;
  if (!CT || typeof CT.list !== "function") {
    console.error("character_types.js から window.PriTestCharacterTypes.list() を読めなかった。");
    process.exit(1);
  }
  return CT.list();
}

// 素体の判定：派生類型の id は素体の id に _dark / _dawn が付いたもの。
// 素体そのものが存在しない接尾辞なら、その類型は自前の sheet を持つ扱いにする
// （将来 character_types.js に別の命名が増えても黙って壊れないように）。
const VARIANT_SUFFIX = /_(dark|dawn)$/;

function baseIdOf(typeId, knownIds) {
  const m = VARIANT_SUFFIX.exec(typeId);
  if (!m) return typeId;
  const base = typeId.slice(0, m.index);
  return knownIds[base] ? base : typeId;
}

const types = loadTypes();
const knownIds = {};
types.forEach(function (t) {
  knownIds[t.id] = true;
});

// 既存の登錄表から available を引き継ぐ（sprite_pack.js が立てた検収済みフラグを消さない）。
let existingAvailable = {};
if (fs.existsSync(REGISTRY_PATH)) {
  const src = fs.readFileSync(REGISTRY_PATH, "utf8");
  const re = /\{ id: "([^"]+)", file: "([^"]+)", available: (true|false) \}/g;
  let m;
  while ((m = re.exec(src))) existingAvailable[m[1]] = m[3] === "true";
}

const sheetIds = [];
const seen = {};
const assign = [];
types.forEach(function (t) {
  const owner = VARIANT_OWN[t.id] ? t.id : baseIdOf(t.id, knownIds);
  const sheetId = "player_" + owner;
  if (!seen[sheetId]) {
    seen[sheetId] = true;
    sheetIds.push(sheetId);
  }
  assign.push('    "' + t.id + '": "' + sheetId + '"');
});

const sheets = sheetIds.map(function (id) {
  const available = existingAvailable[id] === true;
  return '    { id: "' + id + '", file: "' + id + '.png", available: ' + available + " }";
});

const out =
  "(function () {\n" +
  "  // 玩家操作角色の sprite sheet 登錄表。\n" +
  "  // 自動產生: node tools/sprite_check/sprite_player_registry_gen.js --write\n" +
  "  // 不要手動修改——要改分配就去改產生器的 VARIANT_OWN 再重新產生。\n" +
  "  //\n" +
  "  // available は「画像が產出済みか」。false のあいだ midnight_player_sprite.js は\n" +
  "  // 何も表示しない（敵人側と違って代役は立てない——他人の角色の絵が自分の位置に\n" +
  "  // 出るほうが、何も出ないより混乱する）。sprite_pack.js が true に書き換える。\n" +
  "  var SHEETS = [\n" +
  sheets.join(",\n") +
  "\n  ];\n\n" +
  "  // 角色類型 id -> sheet id。暗黑／黎明の派生類型は素体と同じ sheet を共用する。\n" +
  "  var TYPE_SHEET = {\n" +
  assign.join(",\n") +
  "\n  };\n\n" +
  "  function listSheets() {\n    return SHEETS;\n  }\n\n" +
  "  function getSheet(sheetId) {\n" +
  "    return (\n      SHEETS.filter(function (s) {\n        return s.id === sheetId;\n      })[0] || null\n    );\n  }\n\n" +
  "  function sheetIdForType(typeId) {\n" +
  "    return TYPE_SHEET[typeId] || null;\n  }\n\n" +
  "  // 表現層が呼ぶのはこちら。產出済みの sheet のファイル名、無ければ null。\n" +
  "  function sheetFileForType(typeId) {\n" +
  "    var sheet = getSheet(sheetIdForType(typeId));\n" +
  "    if (!sheet || !sheet.available) return null;\n" +
  "    return sheet.file;\n  }\n\n" +
  "  window.PriTestPlayerSpriteRegistry = {\n" +
  "    listSheets: listSheets,\n" +
  "    getSheet: getSheet,\n" +
  "    sheetIdForType: sheetIdForType,\n" +
  "    sheetFileForType: sheetFileForType\n" +
  "  };\n" +
  "})();\n";

if (!WRITE) {
  console.log(
    "プレビュー（sheet " + sheets.length + " 組／角色類型 " + assign.length + " 種）。--write で書き出し。"
  );
  sheetIds.forEach(function (id) {
    console.log("  " + id + (existingAvailable[id] ? "（available 維持）" : ""));
  });
  process.exit(0);
}

fs.writeFileSync(REGISTRY_PATH, out, "utf8");
console.log(
  "static_src/player_sprite_registry.js を書き出しました（sheet " +
    sheets.length +
    " 組／角色類型 " +
    assign.length +
    " 種）。"
);
