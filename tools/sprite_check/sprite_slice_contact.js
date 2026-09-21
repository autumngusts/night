// 生成サービスが返してきた「1 体 1 ポーズを並べた集合圖（名鑑）」を、個々のスプライトに切り出す。
//
//   node tools/sprite_check/sprite_slice_contact.js <src.png> <outDir>
//
// 「sprite sheet」と頼むと 6×8 のアニメーション表ではなく名鑑が返ってくることがある。
// 絵そのものは使えるので、まず 1 体ずつに分解する。分解したポーズを
// sprite_sheet_from_pose.js に渡せば規格準拠の sheet になる。
//
// やること:
//   1. alpha を正規化する（生成物は背景 0~4 / キャラ 245~254 で、完全不透明が 1px も無い）
//   2. 行帯 → 各行の列帯、の順に連結成分で切る
//   3. 1 体ずつ PNG に書き出し、寸法の一覧を出す
const path = require("path");
const fs = require("fs");
const { decode, encode } = require(path.join(__dirname, "png.js"));

const SRC = process.argv[2];
const OUT = process.argv[3];
const T = 128; // 「キャラの本体」とみなす alpha 閾値（二峰性の谷）

const img = decode(SRC);
const { width: W, height: H, data: D } = img;

// ---- 1. alpha 正規化 ----
// 4 → 0、250 → 255 の線形で伸ばす。単純な二値化だと輪郭のアンチエイリアスが死ぬので避ける。
const LO = 4, HI = 250;
let bumped = 0;
for (let i = 3; i < D.length; i += 4) {
  const a = D[i];
  let v = Math.round(((a - LO) / (HI - LO)) * 255);
  if (v < 0) v = 0;
  if (v > 255) v = 255;
  if (v !== a) bumped++;
  D[i] = v;
}
console.log("alpha 正規化: " + bumped + " px を書き換え（背景→完全透明、本体→完全不透明）");

// ---- 2. 帯の検出 ----
function runsOf(profile) {
  const out = [];
  let s = -1;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] > 0) { if (s < 0) s = i; }
    else if (s >= 0) { out.push([s, i - 1]); s = -1; }
  }
  if (s >= 0) out.push([s, profile.length - 1]);
  return out;
}

const rowProf = new Array(H).fill(0);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) if (D[(y * W + x) * 4 + 3] >= T) rowProf[y]++;
}
const rowBands = runsOf(rowProf);

// ---- 3. 切り出し ----
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const manifest = [];
let n = 0;

rowBands.forEach(function (rb, ri) {
  const colProf = new Array(W).fill(0);
  for (let y = rb[0]; y <= rb[1]; y++) {
    for (let x = 0; x < W; x++) if (D[(y * W + x) * 4 + 3] >= T) colProf[x]++;
  }
  runsOf(colProf).forEach(function (cb, ci) {
    // その 1 体だけの実際の上下端を取り直す（行帯は行全体の和なので上下に余白が残る）
    let top = rb[1], bot = rb[0];
    for (let y = rb[0]; y <= rb[1]; y++) {
      for (let x = cb[0]; x <= cb[1]; x++) {
        if (D[(y * W + x) * 4 + 3] >= T) { if (y < top) top = y; if (y > bot) bot = y; break; }
      }
    }
    const w = cb[1] - cb[0] + 1;
    const h = bot - top + 1;
    if (w < 12 || h < 12) return; // ノイズ片は捨てる
    const buf = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      const src = ((top + y) * W + cb[0]) * 4;
      D.copy(buf, y * w * 4, src, src + w * 4);
    }
    const name = "r" + String(ri).padStart(2, "0") + "c" + String(ci).padStart(2, "0") + ".png";
    encode(path.join(OUT, name), w, h, buf);
    manifest.push({ name: name, row: ri, col: ci, x: cb[0], y: top, w: w, h: h });
    n++;
  });
});

fs.writeFileSync(path.join(OUT, "_manifest.json"), JSON.stringify(manifest, null, 1), "utf8");
console.log("切り出し: " + n + " 体 -> " + OUT);

const ws = manifest.map(function (m) { return m.w; });
const hs = manifest.map(function (m) { return m.h; });
const mm = function (a) { return Math.min.apply(null, a) + "~" + Math.max.apply(null, a); };
console.log("幅の範囲: " + mm(ws) + " px / 高さの範囲: " + mm(hs) + " px");
console.log("正方形(w===h)の個体数: " + manifest.filter(function (m) { return m.w === m.h; }).length);
