// 生成物のグリッドが規格と違うとき、切り直して規格準拠の sheet に組み替える。
//
//   node tools/sprite_check/sprite_sheet_relay.js <src.png> <srcCols> <srcRows> <sheetId>
//
// 実際に起きたこと：動畫表としては正しく返ってきた（同一個体・行＝動作・行の順序も一致）
// のに、グリッドが 7 欄×8 列だった。規格は 6 欄×8 列で、しかもセルは正方形でなければ
// ならない（midnight_sprite.js の syncCellPx() が offsetWidth を縦横兼用するため）。
// 生成し直させるより、こちらで切り直すほうが速いし確実。
//
// 列数の詰め方：**末尾の列を落とす**。等間隔で間引くと hitFrame（enemy_sprite_data.js の
// 各動作に定義された「当たる瞬間の幀」）が別の絵を指してしまう。末尾切りなら先頭から
// hitFrame までの並びがそのまま保たれる。落ちるのは攻擊の余韻部分。
//
// 接地：各セルのインクの最下端を揃える。生成物は接地位置が 0.82~0.99 とばらついていて、
// そのまま並べると再生時に上下へ跳ねる。
//
// 拡大縮小はしない（点陣圖の再サンプリングは輪郭が濁る）。セル寸法のほうを絵に合わせる。
const path = require("path");
const fs = require("fs");
const { decode, encode } = require(path.join(__dirname, "png.js"));

const SRC = process.argv[2];
const SRC_COLS = parseInt(process.argv[3], 10);
const SRC_ROWS = parseInt(process.argv[4], 10);
const SHEET_ID = process.argv[5];
if (!SRC || !SRC_COLS || !SRC_ROWS || !SHEET_ID) {
  console.error("usage: node sprite_sheet_relay.js <src.png> <srcCols> <srcRows> <sheetId>");
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..", "..");
const DST_COLS = 6;
const DST_ROWS = 8;
const OCCUPANCY = 0.8; // 規格：角色佔單格高度約 80%
const T = 128; // 本体とみなす alpha
const ALPHA_LO = 4, ALPHA_HI = 250; // 生成物の alpha は 0~4 / 245~254 に固まる

if (SRC_ROWS !== DST_ROWS) {
  console.error("列（動作）の数は " + DST_ROWS + " でなければならない（受け取った値: " + SRC_ROWS + "）");
  console.error("行の意味が規格と違うので、機械的な切り直しでは直せない。生成し直すこと。");
  process.exit(1);
}

const img = decode(SRC);
const { width: W, height: H, data: D } = img;

// ---- alpha 正規化 ----
let bumped = 0;
for (let i = 3; i < D.length; i += 4) {
  const a = D[i];
  let v = Math.round(((a - ALPHA_LO) / (ALPHA_HI - ALPHA_LO)) * 255);
  if (v < 0) v = 0;
  if (v > 255) v = 255;
  if (v !== a) bumped++;
  D[i] = v;
}

const cw = W / SRC_COLS;
const chh = H / SRC_ROWS;

// ---- 各セルの実際の描画範囲 ----
function bboxOf(c, r) {
  const x0 = Math.round(c * cw), x1 = Math.round((c + 1) * cw) - 1;
  const y0 = Math.round(r * chh), y1 = Math.round((r + 1) * chh) - 1;
  let lx = 1e9, rx = -1, ty = 1e9, by = -1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (D[(y * W + x) * 4 + 3] >= T) {
        if (x < lx) lx = x;
        if (x > rx) rx = x;
        if (y < ty) ty = y;
        if (y > by) by = y;
      }
    }
  }
  return rx < 0 ? null : { lx: lx, rx: rx, ty: ty, by: by, w: rx - lx + 1, h: by - ty + 1 };
}

const boxes = [];
let maxSide = 0, clipped = 0;
for (let r = 0; r < DST_ROWS; r++) {
  boxes[r] = [];
  for (let c = 0; c < DST_COLS; c++) {
    const b = bboxOf(c, r);
    boxes[r][c] = b;
    if (!b) continue;
    if (Math.max(b.w, b.h) > maxSide) maxSide = Math.max(b.w, b.h);
    // 元セルの上下端に接していたら、そこで切れている可能性が高い
    const y0 = Math.round(r * chh), y1 = Math.round((r + 1) * chh) - 1;
    if (b.ty <= y0 || b.by >= y1) clipped++;
  }
}

const cell = Math.ceil(maxSide / OCCUPANCY / 8) * 8;
const OW = DST_COLS * cell;
const OH = DST_ROWS * cell;
const out = Buffer.alloc(OW * OH * 4, 0);

// 接地の基準：セル下端から少し上げた位置に、各セルのインク最下端を合わせる
const GROUND = Math.round(cell * 0.92);

for (let r = 0; r < DST_ROWS; r++) {
  for (let c = 0; c < DST_COLS; c++) {
    const b = boxes[r][c];
    if (!b) continue;
    const dx = c * cell + Math.round((cell - b.w) / 2) - b.lx;
    const dy = r * cell + GROUND - b.h - b.ty + (b.h - (b.by - b.ty + 1));
    for (let y = b.ty; y <= b.by; y++) {
      for (let x = b.lx; x <= b.rx; x++) {
        const s = (y * W + x) * 4;
        if (D[s + 3] === 0) continue;
        const tx = x + dx, ty2 = y + dy;
        if (tx < 0 || tx >= OW || ty2 < 0 || ty2 >= OH) continue;
        const d = (ty2 * OW + tx) * 4;
        out[d] = D[s];
        out[d + 1] = D[s + 1];
        out[d + 2] = D[s + 2];
        out[d + 3] = D[s + 3];
      }
    }
  }
}

const dest = path.join(ROOT, "static_src", "images", "sprites", SHEET_ID + ".png");
fs.mkdirSync(path.dirname(dest), { recursive: true });
encode(dest, OW, OH, out);

console.log("元 sheet   : " + W + "x" + H + "  " + SRC_COLS + "欄x" + SRC_ROWS + "列（セル " + cw.toFixed(1) + "x" + chh.toFixed(1) + "）");
console.log("alpha 正規化: " + bumped + " px");
if (SRC_COLS > DST_COLS) {
  console.log("列の詰め   : 末尾 " + (SRC_COLS - DST_COLS) + " 欄を落として " + DST_COLS + " 欄に（hitFrame を保つため先頭側を残す）");
}
console.log("最大の絵   : " + maxSide + "px → セル " + cell + "x" + cell + "（占有 " + (maxSide / cell * 100).toFixed(0) + "%）");
console.log("接地       : 各セル下端から " + (cell - GROUND) + "px 上で揃えた");
console.log("出力       : " + OW + "x" + OH + " -> " + path.relative(ROOT, dest));
if (clipped) {
  console.log("");
  console.log("⚠ " + clipped + " 個のセルで、絵が元セルの上下端に接していた。");
  console.log("  元画像の時点でそこが切れている可能性が高い（失われた画素はこちらでは戻せない）。");
}
