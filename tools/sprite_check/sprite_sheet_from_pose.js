// 単一ポーズの絵 1 枚から、規格準拠の 6 欄 × 8 列 sheet を組み立てる。
//
//   node tools/sprite_check/sprite_sheet_from_pose.js <pose.png> <sheetId>
//
// 何のためのものか：
//   生成サービスに「sprite sheet」と頼むと、往々にして「1 体 1 ポーズを並べた名鑑」が
//   返ってくる（アニメーション表ではなく）。そうなると絵そのものは使えるのに、
//   available を true にできず、セル寸法の校正も表示位置の確認も一切進められない。
//   この工具はその手持ちの 1 ポーズから規格に合う sheet を機械的に組んで、
//   パイプラインの下流（verify → pack → generate → 実機表示）を先に通せるようにする。
//
// **これはアニメーションではない。** 8 列すべて同じポーズが入る（待機列だけ 1px の上下動を
// 付ける）。攻擊/受擊/死亡の動きは 1 枚の絵からは作れないし、無いものを作るべきでもない。
// 本番の素材が来たら差し替える前提の踏み台。
//
// 拡大縮小はしない：点陣圖を再サンプリングすると輪郭が濁る。セル寸法のほうを
// 絵に合わせて決め、中央に置く（規格の「角色佔單格高度約 80%」に合わせる）。
const path = require("path");
const fs = require("fs");
const { decode, encode } = require(path.join(__dirname, "png.js"));

const SRC = process.argv[2];
const SHEET_ID = process.argv[3];
if (!SRC || !SHEET_ID) {
  console.error("usage: node sprite_sheet_from_pose.js <pose.png> <sheetId>");
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..", "..");
const COLS = 6;
const ROWS = 8;
const OCCUPANCY = 0.8; // 規格：角色佔單格高度約 80%
const IDLE_BOB_PX = 1; // 待機列だけの上下動。1 枚の絵から正当化できる最小限。

const pose = decode(SRC);

// セルは正方形。絵の長辺が占有率どおりに収まる最小の 8 の倍数にする。
const need = Math.max(pose.width, pose.height) / OCCUPANCY;
const cell = Math.ceil(need / 8) * 8;
const W = COLS * cell;
const H = ROWS * cell;
const out = Buffer.alloc(W * H * 4, 0);

function blit(dstX, dstY) {
  for (let y = 0; y < pose.height; y++) {
    const ty = dstY + y;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < pose.width; x++) {
      const tx = dstX + x;
      if (tx < 0 || tx >= W) continue;
      const s = (y * pose.width + x) * 4;
      if (pose.data[s + 3] === 0) continue; // 透明はそのまま抜く
      const d = (ty * W + tx) * 4;
      out[d] = pose.data[s];
      out[d + 1] = pose.data[s + 1];
      out[d + 2] = pose.data[s + 2];
      out[d + 3] = pose.data[s + 3];
    }
  }
}

const baseX = Math.round((cell - pose.width) / 2);
const baseY = Math.round((cell - pose.height) / 2);

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    // 待機（row 0）だけ、1 枚の絵から正当化できる範囲の上下動を入れる。
    // 他の列は素直に同じ位置＝止め絵。
    const bob = r === 0 ? Math.round(Math.sin((c / COLS) * Math.PI * 2) * IDLE_BOB_PX) : 0;
    blit(c * cell + baseX, r * cell + baseY + bob);
  }
}

const dest = path.join(ROOT, "static_src", "images", "sprites", SHEET_ID + ".png");
fs.mkdirSync(path.dirname(dest), { recursive: true });
encode(dest, W, H, out);

console.log("元ポーズ : " + pose.width + "x" + pose.height);
console.log("セル寸法 : " + cell + "x" + cell + "（占有率 " + (Math.max(pose.width, pose.height) / cell * 100).toFixed(0) + "%）");
console.log("sheet    : " + W + "x" + H + " -> " + path.relative(ROOT, dest));
console.log("");
console.log("※ 8 列すべて同じポーズ。待機列のみ ±" + IDLE_BOB_PX + "px の上下動。");
console.log("※ 攻擊/受擊/死亡の動きは入っていない——本番素材が来たら差し替えること。");
