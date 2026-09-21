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
const V = require("./sprite_verify.js");

const ROOT = path.resolve(__dirname, "..", "..");
const SPRITE_DIR = path.join(ROOT, "static_src", "images", "sprites");
const REG_PATH = path.join(ROOT, "static_src", "enemy_sprite_registry.js");

const present = fs.existsSync(SPRITE_DIR)
  ? fs.readdirSync(SPRITE_DIR).filter(function (f) {
      return /\.png$/i.test(f) && V.verifyFile(path.join(SPRITE_DIR, f)).ok;
    })
  : [];

let src = fs.readFileSync(REG_PATH, "utf8");
let changed = 0;
src = src.replace(
  /\{ id: "([^"]+)", file: "([^"]+)", available: (true|false) \}/g,
  function (m, id, file, cur) {
    const next = present.indexOf(file) !== -1;
    if (String(next) !== cur) changed++;
    return '{ id: "' + id + '", file: "' + file + '", available: ' + next + " }";
  }
);

if (process.argv.indexOf("--write") === -1) {
  console.log("合格画像 " + present.length + " 枚 / 更新予定 " + changed + " 件（--write で書き込み）");
  process.exit(0);
}
fs.writeFileSync(REG_PATH, src, "utf8");
console.log("登録表を更新しました（合格 " + present.length + " 枚 / 変更 " + changed + " 件）");
