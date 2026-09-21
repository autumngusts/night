// 産出された sprite sheet の受け入れ検査。
//
//   node tools/sprite_check/sprite_verify.js
//
// static_src/images/sprites/ を走査し、登録表にある名前か・合法な PNG か・
// 6x8 の正方格に割り切れる寸法かを確認する。画像ライブラリは使わず PNG の IHDR だけ読む
// （専案に npm 相依を足さないため、spec §6 の前提）。
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

function isGridDivisible(width, height) {
  return width % COLS === 0 && height % ROWS === 0 && width / COLS === height / ROWS;
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
  if (size && !isGridDivisible(size.width, size.height)) {
    errors.push("寸法 " + size.width + "x" + size.height + " が 6x8 の正方格に割り切れない");
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

module.exports = { readPngSize: readPngSize, isGridDivisible: isGridDivisible, verifyFile: verifyFile };

if (require.main === module) main();
