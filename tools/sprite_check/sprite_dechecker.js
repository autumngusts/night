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

const argv = process.argv.slice(2);
const flags = argv.filter(function (a) { return a.indexOf("--") === 0; });
const pos = argv.filter(function (a) { return a.indexOf("--") !== 0; });
const SRC = pos[0];
const OUT = pos[1];
// --keep-inner : 外周から辿り着けない「明るい無彩色」は本体として残す。
//   2026-09-22 gnoster で必要になった。あの絵は翅が淡い青白で、ハイライトは色の上では
//   市松と区別がつかない（どちらも無彩色で 250 前後）。色だけで判定すると翅が穴だらけになる。
//   市松は必ず画像の外周と繋がっているので、繋がりを条件に足せば翅の内側は残る。
const KEEP_INNER = flags.indexOf("--keep-inner") !== -1;
if (!SRC || !OUT) {
  console.error("usage: node sprite_dechecker.js <src.png> <out.png> [--keep-inner]");
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

let cleared = 0, softened = 0, kept = 0, rescued = 0;

// 色だけで「市松かもしれない」画素を先に印を付ける。
const LOOKS_BG = 1, LOOKS_EDGE = 2;
const looks = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  const o = i * 4;
  const mx = Math.max(D[o], D[o + 1], D[o + 2]);
  const mn = Math.min(D[o], D[o + 1], D[o + 2]);
  const neutral = mx - mn;
  if (neutral <= BG_NEUTRAL && mn >= BG_LIGHT) looks[i] = LOOKS_BG;
  else if (neutral <= EDGE_NEUTRAL && mn >= EDGE_LIGHT) looks[i] = LOOKS_EDGE;
}

// --keep-inner：外周から「市松に見える画素」だけを辿って塗り広げる。届かなかった
// ものは、色が市松そっくりでも絵の内側にある＝本体（翅のハイライトなど）。
const reachable = new Uint8Array(W * H);
if (KEEP_INNER) {
  const stack = [];
  function push(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (reachable[i] || !looks[i]) return;
    reachable[i] = 1;
    stack.push(i);
  }
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % W, y = (i - x) / W;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
}

// 外周と繋がっていない「市松に見える塊」のうち、中身が本当に市松模様のものは
// 絵に囲まれた背景の窪み（例：腕と胴のあいだ、裾の内側）なので、残すと白い塊になる。
//
// 見分け方は模様の周期。市松は 12px 周期なので、6px ずらすと必ず反対の明度に当たり、
// 差が 20 前後になる。髑髏の顔や翅のハイライトのような絵は滑らかなので差が小さい。
// 大きさや明るさでは分けられない（どちらも明るい無彩色の塊）ので、周期で見る。
const CHECKER_SHIFT = 6;      // 市松の半周期
const CHECKER_DIFF = 8;       // これ以上ずれていれば市松とみなす
const POCKET_MIN = 12;        // これ未満の塊は判定が不安定なので、そのまま残す
let pocketCleared = 0;
if (KEEP_INNER) {
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || !looks[start] || reachable[start]) continue;
    const comp = [];
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      comp.push(i);
      const x = i % W, y = (i - x) / W;
      const nb = [x + 1 < W ? i + 1 : -1, x > 0 ? i - 1 : -1, y + 1 < H ? i + W : -1, y > 0 ? i - W : -1];
      for (let k = 0; k < 4; k++) {
        const ni = nb[k];
        if (ni < 0 || seen[ni] || !looks[ni] || reachable[ni]) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    if (comp.length < POCKET_MIN) continue;
    let pairs = 0, sum = 0;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k];
      const x = i % W;
      if (x + CHECKER_SHIFT >= W) continue;
      const j = i + CHECKER_SHIFT;
      if (!looks[j] || reachable[j]) continue;
      sum += Math.abs(D[i * 4] - D[j * 4]);
      pairs++;
    }
    if (!pairs) continue;
    if (sum / pairs >= CHECKER_DIFF) {
      // 市松そのもの＝絵に囲まれた背景。抜く。
      comp.forEach(function (i) { reachable[i] = 1; });
      pocketCleared += comp.length;
    }
  }
}

for (let i = 0; i < W * H; i++) {
  const o = i * 4;
  const r = D[o], g = D[o + 1], b = D[o + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const neutral = mx - mn;

  if (KEEP_INNER && looks[i] && !reachable[i]) {
    // 市松そっくりだが外周と繋がっていない＝本体。そのまま不透明で残す。
    D[o + 3] = 255;
    kept++;
    rescued++;
    continue;
  }

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
console.log(
  "本体       : " + kept + " px (" + (kept / tot * 100).toFixed(1) + "%)" +
    (KEEP_INNER ? "  うち内側の明色を救済 " + rescued + " px" : "")
);
if (KEEP_INNER) console.log(
  "内側の窪み : " + pocketCleared + " px を市松と判定して除去（6px ずらしの差で判定）"
);
console.log("出力       : " + OUT);
