// 「透過」が市松模様として画素に焼き込まれた PNG から、その市松を剥がして
// 本物のアルファチャンネルに戻す。
//
//   node tools/sprite_check/sprite_dechecker.js <src.png> <out.png>
//
// 実際に起きたこと：生成サービスが color type 2（RGB、アルファ無し）で返してきた。
// 画面上は透過に見えるが、それは画像ビューアが描く市松ではなく、画素として焼き込まれた
// 市松そのもの。そのまま使うと戰鬥画面に灰色の格子が出る。
//
// 剥がし方：市松の位相を予測して引き算する、という手は使えない。この生成物は
// 1086px 幅に対して市松が 12px 角＝90.5 周期と半端で、拡大縮小を経ているため位相が
// 一定でない。代わりに色で判定する——市松は必ず「無彩色かつ明るい」（R≒G≒B、全チャンネル
// 210 以上）。この絵柄は黄土・褐・金・暗紫で、無彩色の明色はまず現れない。
//
// 輪郭のアンチエイリアス部分は市松と本体の中間色になっているので、中間帯は
// 部分アルファに割り当てたうえで下地の白を差し引く（そうしないと輪郭に白い縁が残る）。
const path = require("path");
const fs = require("fs");
const { decode, encode } = require(path.join(__dirname, "png.js"));

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error("usage: node sprite_dechecker.js <src.png> <out.png>");
  process.exit(1);
}

// 完全に市松とみなす境界
const BG_NEUTRAL = 8;   // max-min がこれ以下なら無彩色
const BG_LIGHT = 208;   // min がこれ以上なら明るい
// ここから下は「中間帯」＝輪郭のアンチエイリアス
const EDGE_NEUTRAL = 20;
const EDGE_LIGHT = 150;
const CHECKER_BASE = 243; // 白 254 と灰 232 の中間。下地を差し引くときの推定値

const img = decode(SRC);
const { width: W, height: H, data: D } = img;

let cleared = 0, softened = 0, kept = 0;

for (let i = 0; i < W * H; i++) {
  const o = i * 4;
  const r = D[o], g = D[o + 1], b = D[o + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const neutral = mx - mn;

  if (neutral <= BG_NEUTRAL && mn >= BG_LIGHT) {
    D[o + 3] = 0;
    cleared++;
    continue;
  }

  if (neutral <= EDGE_NEUTRAL && mn >= EDGE_LIGHT) {
    // 中間帯：明るいほど市松寄り＝透明寄り。
    let a = 1 - (mn - EDGE_LIGHT) / (BG_LIGHT - EDGE_LIGHT);
    if (a < 0) a = 0;
    if (a > 1) a = 1;
    if (a <= 0.02) {
      D[o + 3] = 0;
      cleared++;
      continue;
    }
    // 下地の白を差し引く（un-premultiply）。やらないと輪郭に白い縁が残る。
    for (let k = 0; k < 3; k++) {
      const v = (D[o + k] - (1 - a) * CHECKER_BASE) / a;
      D[o + k] = Math.max(0, Math.min(255, Math.round(v)));
    }
    D[o + 3] = Math.round(a * 255);
    softened++;
    continue;
  }

  D[o + 3] = 255;
  kept++;
}

encode(OUT, W, H, D);

const tot = W * H;
console.log("入力       : " + W + "x" + H + "  アルファ" + (img.hadAlpha ? "あり" : "なし（RGB）"));
console.log("市松を除去 : " + cleared + " px (" + (cleared / tot * 100).toFixed(1) + "%)");
console.log("輪郭を軟化 : " + softened + " px (" + (softened / tot * 100).toFixed(1) + "%)");
console.log("本体       : " + kept + " px (" + (kept / tot * 100).toFixed(1) + "%)");
console.log("出力       : " + OUT);
