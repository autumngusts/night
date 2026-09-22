// 産出された sprite sheet の受け入れ検査。
//
//   node tools/sprite_check/sprite_verify.js
//
// static_src/images/sprites/ を走査し、登録表にある名前か・合法な PNG か・
// 6x8 に割り切れる寸法かを確認する。画像ライブラリは使わず PNG の IHDR だけ読む
// （専案に npm 相依を足さないため、spec §6 の前提）。
//
// 2026-09-22：セルは正方形でなくてもよくなった（使用者明確規格「分裂形態不用正方形沒關係」）。
// 表現層は画像の実寸から 1 格の縦横比を割り出して描くようになっている
// （midnight_sprite.js の cellAspectOf()）。ただし極端に潰れた比は「6x8 で切る前提そのものが
// 間違っている」合図なので、0.4~2.5 倍の外は失格にする。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const SPRITE_DIR = path.join(ROOT, "static_src", "images", "sprites");
const COLS = 6;
const ROWS = 8;

function readPngSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) {
    if (buffer[i] !== sig[i]) return null;
  }
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const ASPECT_MIN = 0.4;  // 1 格の 高さ÷幅 の下限
const ASPECT_MAX = 2.5;  // 同上限

function gridErrorOf(width, height) {
  if (width % COLS !== 0 || height % ROWS !== 0) {
    return "寸法 " + width + "x" + height + " が 6x8 に割り切れない";
  }
  const aspect = (height / ROWS) / (width / COLS);
  if (aspect < ASPECT_MIN || aspect > ASPECT_MAX) {
    return (
      "1 格が " + (width / COLS) + "x" + (height / ROWS) +
      "（縦横比 " + aspect.toFixed(2) + "）。6x8 の切り方そのものが違う可能性が高い"
    );
  }
  return null;
}

function verifyFile(filePath) {
  const errors = [];
  let size = null;
  try {
    size = readPngSize(fs.readFileSync(filePath));
  } catch (e) {
    errors.push("読み込めない: " + e.message);
  }
  if (!errors.length && !size) errors.push("合法な PNG ではない");
  if (size) {
    const gridError = gridErrorOf(size.width, size.height);
    if (gridError) errors.push(gridError);
  }
  return { ok: errors.length === 0, errors: errors, size: size };
}

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

function main() {
  const R = loadRegistry();
  if (!fs.existsSync(SPRITE_DIR)) {
    console.log("static_src/images/sprites/ がまだありません（画像0枚）。fallback で動作します。");
    process.exit(0);
  }
  const files = fs.readdirSync(SPRITE_DIR).filter(function (f) {
    return /\.png$/i.test(f);
  });
  const known = {};
  R.listSheets().forEach(function (s) {
    known[s.file] = s.id;
  });
  let fail = 0;
  files.forEach(function (f) {
    if (!known[f]) {
      console.log("  FAIL " + f + " は登録表にない名前");
      fail++;
      return;
    }
    const r = verifyFile(path.join(SPRITE_DIR, f));
    if (r.ok) console.log("  OK   " + f + " (" + r.size.width + "x" + r.size.height + ")");
    else {
      console.log("  FAIL " + f + " : " + r.errors.join(" / "));
      fail++;
    }
  });
  console.log("\n" + files.length + " 枚中 " + (files.length - fail) + " 枚が合格");
  process.exit(fail === 0 ? 0 : 1);
}

module.exports = { readPngSize: readPngSize, gridErrorOf: gridErrorOf, verifyFile: verifyFile };

if (require.main === module) main();
