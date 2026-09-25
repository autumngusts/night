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
// 既定は敵人 sheet の 6x8。2026-09-25：玩家操作角色 sheet（6x10）が加わったので、
// 行数はファイルごとに「どちらの登錄表に載っている名前か」で決める（rowsOf()）。
// 欄は両方とも 6 なので COLS は共通のまま。
const ROWS = 8;
const PLAYER_ROWS = 10;

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

function gridErrorOf(width, height, rows) {
  const r = rows || ROWS;
  const grid = "6x" + r;
  if (width % COLS !== 0 || height % r !== 0) {
    return "寸法 " + width + "x" + height + " が " + grid + " に割り切れない";
  }
  const aspect = (height / r) / (width / COLS);
  if (aspect < ASPECT_MIN || aspect > ASPECT_MAX) {
    return (
      "1 格が " + (width / COLS) + "x" + (height / r) +
      "（縦横比 " + aspect.toFixed(2) + "）。" + grid + " の切り方そのものが違う可能性が高い"
    );
  }
  return null;
}

// ファイル名から行数を決める。玩家 sheet は player_ 接頭辞（登錄表の id と同じ規則）。
function rowsOf(file) {
  return /^player_/.test(path.basename(file)) ? PLAYER_ROWS : ROWS;
}

function verifyFile(filePath, rows) {
  const r = rows || rowsOf(filePath);
  const errors = [];
  let size = null;
  try {
    size = readPngSize(fs.readFileSync(filePath));
  } catch (e) {
    errors.push("読み込めない: " + e.message);
  }
  if (!errors.length && !size) errors.push("合法な PNG ではない");
  if (size) {
    const gridError = gridErrorOf(size.width, size.height, r);
    if (gridError) errors.push(gridError);
  }
  return { ok: errors.length === 0, errors: errors, size: size };
}

// 48 格の中身を見る（2026-09-23 追加）。寸法だけでは「行の切り方を間違えた sheet」が
// 素通りする——実際に起きたのは、生成物が 7 行しか描かれていないのに 8 行へ割ってしまい、
// 1 行ぶんが刀先だけの帯になった件（獅子の混種たち）。寸法は規格どおりなので verify は
// 通り、登錄表にも入り、戦闘で「ほぼ空の受擊動畫」が流れて初めて気づく。
//
// 中位の格と比べて極端に薄い格を警告する。失格にはしない：死亡行の最終幀のように
// 「本来ほとんど消えている格」は正当にありうるし、pack を止めると良品まで入らなくなる。
// 判断は絵を見る人に返し、ここは「どの格を見ればよいか」を指すところまでをやる。
//
// **最終列（第6幀）だけが薄い**のは見逃す（2026-09-23）。遠程招式では「飛び道具だけが
// 画面に残り、本体はもう写っていない」最終幀を生成側が普通に描いてくる——実測で
// 忌み鬼・黄金樹の化身・鈴玉狩りの 3 枚が該当し、どれも元画像の時点でそう描かれていた。
// ここで鳴らし続けると、本当に見たい「行の切り間違い」が警告の山に埋もれる。
// 切り間違いは行ぜんたいが薄くなるので、行の中位でも判定して取りこぼさないようにする。
const WEAK_RATIO = 0.25;

function weakCellsOf(filePath, rows) {
  const ROWS = rows || rowsOf(filePath); // 以下の走査は全部この行数で回す
  let img;
  try {
    img = require("./png.js").decode(filePath);
  } catch (e) {
    return null; // 復号できない形式（verifyFile 側で別途落ちる）
  }
  const cw = img.width / COLS;
  const ch = img.height / ROWS;
  if (cw % 1 || ch % 1) return null;
  const ink = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let n = 0;
      for (let y = r * ch; y < (r + 1) * ch; y++) {
        for (let x = c * cw; x < (c + 1) * cw; x++) {
          if (img.data[(y * img.width + x) * 4 + 3] >= 128) n++;
        }
      }
      ink.push({ n: n, r: r, c: c });
    }
  }
  const median = ink
    .map(function (v) {
      return v.n;
    })
    .sort(function (a, b) {
      return a - b;
    })[Math.floor(ink.length / 2)];
  if (!median) return null;
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    const row = ink.filter(function (v) {
      return v.r === r;
    });
    const rowMedian = row
      .map(function (v) {
        return v.n;
      })
      .sort(function (a, b) {
        return a - b;
      })[Math.floor(COLS / 2)];
    if (rowMedian < median * WEAK_RATIO) {
      out.push("行" + r + "ぜんたい(" + Math.round((rowMedian / median) * 100) + "%)");
      continue; // 行ごと薄いので、その中の格を個別に挙げても意味がない
    }
    row.forEach(function (v) {
      if (v.c === COLS - 1) return; // 最終幀の飛び道具だけの格は正当
      if (v.n < median * WEAK_RATIO) {
        out.push("行" + v.r + "列" + v.c + "(" + Math.round((v.n / median) * 100) + "%)");
      }
    });
  }
  return out;
}

// 敵人・玩家の両方の登錄表を読む。走査対象のディレクトリは 1 つなので、
// 「登錄表にない名前」の判定には両方の file 一覧が要る。
function loadRegistries() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  ["enemy_sprite_registry.js", "player_sprite_registry.js"].forEach(function (f) {
    const p = path.join(ROOT, "static_src", f);
    if (!fs.existsSync(p)) return;
    vm.runInContext(fs.readFileSync(p, "utf8"), sandbox, { filename: f });
  });
  return [sandbox.window.PriTestEnemySpriteRegistry, sandbox.window.PriTestPlayerSpriteRegistry].filter(Boolean);
}

function main() {
  const registries = loadRegistries();
  if (!fs.existsSync(SPRITE_DIR)) {
    console.log("static_src/images/sprites/ がまだありません（画像0枚）。fallback で動作します。");
    process.exit(0);
  }
  const files = fs.readdirSync(SPRITE_DIR).filter(function (f) {
    return /\.png$/i.test(f);
  });
  const known = {};
  registries.forEach(function (R) {
    R.listSheets().forEach(function (s) {
      known[s.file] = s.id;
    });
  });
  let fail = 0;
  let warned = 0;
  files.forEach(function (f) {
    if (!known[f]) {
      console.log("  FAIL " + f + " は登録表にない名前");
      fail++;
      return;
    }
    const rows = rowsOf(f);
    const r = verifyFile(path.join(SPRITE_DIR, f), rows);
    if (r.ok) {
      console.log("  OK   " + f + " (" + r.size.width + "x" + r.size.height + " / 6x" + rows + ")");
      const weak = weakCellsOf(path.join(SPRITE_DIR, f), rows);
      if (weak && weak.length) {
        warned++;
        console.log("  ⚠    " + f + " : 極端に薄い格 " + weak.join("、") + "（行の切り方を確かめること）");
      }
    } else {
      console.log("  FAIL " + f + " : " + r.errors.join(" / "));
      fail++;
    }
  });
  console.log("\n" + files.length + " 枚中 " + (files.length - fail) + " 枚が合格" + (warned ? "（うち " + warned + " 枚に警告）" : ""));
  process.exit(fail === 0 ? 0 : 1);
}

module.exports = { readPngSize: readPngSize, gridErrorOf: gridErrorOf, verifyFile: verifyFile, rowsOf: rowsOf };

if (require.main === module) main();
