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
// 2026-09-25：玩家操作角色の登錄表が加わったので、2 つの登錄表を同じ規則で更新する。
// 置き場（SPRITE_DIR）は 1 か所で、どの sheet がどちらの登錄表に属すかは
// ファイル名で決まる（player_* が玩家側、それ以外が敵人側）。
const REGISTRIES = [
  { path: path.join(ROOT, "static_src", "enemy_sprite_registry.js"), global: "PriTestEnemySpriteRegistry" },
  { path: path.join(ROOT, "static_src", "player_sprite_registry.js"), global: "PriTestPlayerSpriteRegistry" }
].filter(function (r) {
  return fs.existsSync(r.path);
});

const present = fs.existsSync(SPRITE_DIR)
  ? fs.readdirSync(SPRITE_DIR).filter(function (f) {
      return /\.png$/i.test(f) && V.verifyFile(path.join(SPRITE_DIR, f)).ok;
    })
  : [];

// 載入登錄表並取得預期筆數。此斷言防護無聲失敗：若登錄表格式變化
// （例如改引號、增加欄位、改排版），regex 可能會匹配 0 筆，但檔案仍包含資料。
// 沒有此檢查的話，工具會靜默印出「変更 0 件」，無法區分「真的沒圖片」與「格式不符」，
// 使用者會完全沒有警告。此斷言確保格式不符時會明確失敗。
function loadRegistry(reg) {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(reg.path, "utf8"), sandbox, { filename: path.basename(reg.path) });
  return sandbox.window[reg.global];
}

const WRITE = process.argv.indexOf("--write") !== -1;
let totalChanged = 0;

REGISTRIES.forEach(function (reg) {
  const R = loadRegistry(reg);
  const expectedCount = R.listSheets().length;

  let src = fs.readFileSync(reg.path, "utf8");
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

  if (matchedCount !== expectedCount) {
    console.error(
      "エラー: " + path.basename(reg.path) + " の形式が不正です。\n" +
        "  予期：" + expectedCount + " 件（listSheets() による），\n" +
        "  実際：正規表現がマッチした " + matchedCount + " 件\n" +
        "  登録表の形式が変わった可能性があります（引号・欄位・空白）。\n" +
        "  sprite_pack.js の正規表現を現在の形式に合わせて更新してください。"
    );
    process.exit(1);
  }

  totalChanged += changed;
  if (!WRITE) {
    console.log("  " + path.basename(reg.path) + " : 更新予定 " + changed + " 件");
    return;
  }
  fs.writeFileSync(reg.path, src, "utf8");
  console.log("  " + path.basename(reg.path) + " : 変更 " + changed + " 件");
});

if (!WRITE) {
  console.log("合格画像 " + present.length + " 枚 / 更新予定 計 " + totalChanged + " 件（--write で書き込み）");
  process.exit(0);
}
console.log("登録表を更新しました（合格 " + present.length + " 枚 / 変更 計 " + totalChanged + " 件）");
