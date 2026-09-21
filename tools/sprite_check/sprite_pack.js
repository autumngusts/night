// 受け入れ検査を通った sheet を「産出済み」として登録表に反映する。
//
//   node tools/sprite_check/sprite_pack.js           # 差分の件数だけ表示
//   node tools/sprite_check/sprite_pack.js --write   # 実際に書き込む
//
// 画像の切り出しは行わない——renderer は CSS の background-position で sheet から
// 直接1幀を切り出すので、切り出し済みファイルは不要（spec §6 の簡略化）。
// この工具がやるのは available フラグの更新だけ。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const V = require("./sprite_verify.js");

const ROOT = path.resolve(__dirname, "..", "..");
const SPRITE_DIR = path.join(ROOT, "static_src", "images", "sprites");
const REG_PATH = path.join(ROOT, "static_src", "enemy_sprite_registry.js");

const present = fs.existsSync(SPRITE_DIR)
  ? fs.readdirSync(SPRITE_DIR).filter(function (f) {
      return /\.png$/i.test(f) && V.verifyFile(path.join(SPRITE_DIR, f)).ok;
    })
  : [];

// 載入登錄表並取得預期筆數。此斷言防護無聲失敗：若登錄表格式變化
// （例如改引號、增加欄位、改排版），regex 可能會匹配 0 筆，但檔案仍包含資料。
// 沒有此檢查的話，工具會靜默印出「変更 0 件」，無法區分「真的沒圖片」與「格式不符」，
// 使用者會完全沒有警告。此斷言確保格式不符時會明確失敗。
function loadRegistry() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "static_src", "enemy_sprite_registry.js"), "utf8"),
    sandbox,
    { filename: "enemy_sprite_registry.js" }
  );
  return sandbox.window.PriTestEnemySpriteRegistry;
}

const R = loadRegistry();
const expectedCount = R.listSheets().length;

let src = fs.readFileSync(REG_PATH, "utf8");
let changed = 0;
let matchedCount = 0;
src = src.replace(
  /\{ id: "([^"]+)", file: "([^"]+)", available: (true|false) \}/g,
  function (m, id, file, cur) {
    matchedCount++;
    const next = present.indexOf(file) !== -1;
    if (String(next) !== cur) changed++;
    return '{ id: "' + id + '", file: "' + file + '", available: ' + next + " }";
  }
);

// 正規表示式が予期した件数と合致するか検証する。
if (matchedCount !== expectedCount) {
  console.error(
    "エラー: 登録表の形式が不正です。\n" +
    "  予期：" + expectedCount + " 件（listSheets() による），\n" +
    "  実際：正規表現がマッチした " + matchedCount + " 件\n" +
    "  登録表の形式が変わった可能性があります（引号・欄位・空白）。\n" +
    "  sprite_pack.js の正規表現を現在の形式に合わせて更新してください。"
  );
  process.exit(1);
}

if (process.argv.indexOf("--write") === -1) {
  console.log("合格画像 " + present.length + " 枚 / 更新予定 " + changed + " 件（--write で書き込み）");
  process.exit(0);
}
fs.writeFileSync(REG_PATH, src, "utf8");
console.log("登録表を更新しました（合格 " + present.length + " 枚 / 変更 " + changed + " 件）");
