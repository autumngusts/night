// 依規格檔逐格指定切割範圍，組成規格準拠的 sheet（6 欄 × N 列）。
//
//   node tools/sprite_check/sprite_sheet_cells.js <src.png> <spec.json>
//
// sprite_sheet_relay.js 靠「偵測」決定行列的境目。2026-09-26 的追蹤者（暗黑）sheet
// 偵測派不上用場：
//   ・每行的幀數不一樣（待機 6 幀，1hit／2hit／技能 5 幀，技藝 3 幀＋一整團爆炎）
//   ・刀光、揚塵、殘影把相鄰的幀連成一塊（致命一擊 5 幀裡有 4 幀連在一起）
//   ・爆炎寬 440px，照 relay 的「最大的絵決定格子」會把格子撐到 500px 以上，
//     人物在畫面上會比其他角色小一倍多
// 所以改由人看圖決定切點，寫進 spec.json（tools/sprite_check/cells/<sheetId>.json）。
//
// spec 格式：
//   {
//     "sheetId": "player_tracker_dark",
//     "cell": 240,                      // 正方格（midnight_player_sprite.js 以寬推高）
//     "rows": [
//       { "y0": 0, "y1": 152, "ground": 153,
//         "cols": [[178,272], [320,416], ...6 個] }, ...
//     ]
//   }
//   ・cols 可以重複同一範圍（幀數不足時重複最後一幀＝停格）。
//   ・ground 是該行在原圖上的地面 y。整行共用同一條地面對齊到格子的 GROUND，
//     不逐幀把絵的最下端拉到地面——能力行的空翻是離地的，逐幀對齊會把它按回地上。
//
// 水平：切出範圍內的絵外接矩形置中；比格子寬的（爆炎）則保留切出範圍的左端對齊格子左端，
// 超出格子的部分裁掉。絵一律不縮放（點陣圖再取樣會糊）。
const path = require("path");
const fs = require("fs");
const { decode, encode } = require(path.join(__dirname, "png.js"));

const SRC = process.argv[2];
const SPEC = process.argv[3];
if (!SRC || !SPEC) {
  console.error("usage: node sprite_sheet_cells.js <src.png> <spec.json>");
  process.exit(1);
}
const ROOT = path.resolve(__dirname, "..", "..");
const COLS = 6;
const T = 128;

const spec = JSON.parse(fs.readFileSync(SPEC, "utf8"));
const CELL = spec.cell;
if (!(CELL > 0) || CELL % 8 !== 0) {
  console.error("cell は 8 の倍数の正整数（受け取った値: " + CELL + "）");
  process.exit(1);
}
spec.rows.forEach(function (row, r) {
  if (!row.cols || row.cols.length !== COLS) {
    console.error("行 " + r + " の cols は " + COLS + " 個（受け取った値: " + (row.cols ? row.cols.length : 0) + "）");
    process.exit(1);
  }
});

const img = decode(SRC);
const W = img.width, H = img.height, D = img.data;
const ROWS = spec.rows.length;
const OW = COLS * CELL, OH = ROWS * CELL;
const out = Buffer.alloc(OW * OH * 4, 0);
const GROUND = Math.round(CELL * 0.94); // relay と同じ接地位置

const warns = [];
spec.rows.forEach(function (row, r) {
  row.cols.forEach(function (cr, c) {
    const x0 = Math.max(0, cr[0]), x1 = Math.min(W - 1, cr[1]);
    const y0 = Math.max(0, row.y0), y1 = Math.min(H - 1, row.y1);
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
    if (rx < 0) { warns.push("行 " + r + " 欄 " + c + " が空"); return; }
    const bw = rx - lx + 1;
    const dx = bw <= CELL ? c * CELL + Math.round((CELL - bw) / 2) - lx : c * CELL - lx;
    const dy = r * CELL + GROUND - row.ground;
    let cut = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const s = (y * W + x) * 4;
        if (D[s + 3] === 0) continue;
        const tx = x + dx, ty2 = y + dy;
        // 自分のセルの外へは書かない（隣の幀を汚さない）
        if (tx < c * CELL || tx >= (c + 1) * CELL || ty2 < r * CELL || ty2 >= (r + 1) * CELL) {
          if (D[s + 3] >= T) cut++;
          continue;
        }
        const d = (ty2 * OW + tx) * 4;
        out[d] = D[s];
        out[d + 1] = D[s + 1];
        out[d + 2] = D[s + 2];
        out[d + 3] = D[s + 3];
      }
    }
    if (cut) warns.push("行 " + r + " 欄 " + c + "：格子外に出た " + cut + " px を裁切（" + bw + "x" + (by - ty + 1) + "）");
  });
});

const dest = path.join(ROOT, "static_src", "images", "sprites", spec.sheetId + ".png");
fs.mkdirSync(path.dirname(dest), { recursive: true });
encode(dest, OW, OH, out);
console.log("元画像 : " + W + "x" + H);
console.log("セル   : " + CELL + "x" + CELL + "、接地は下端から " + (CELL - GROUND) + "px");
console.log("出力   : " + OW + "x" + OH + " -> " + path.relative(ROOT, dest));
warns.forEach(function (w) { console.log("  " + w); });
