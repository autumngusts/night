// 板塊卡牌の地點圖示を「去背＋暗藍色の裁切」して static_src へ書き出す。
//
//   node tools/field_icon/field_icon_cut.js            # 全部を書き出す
//   node tools/field_icon/field_icon_cut.js field_k    # 1 枚だけ
//   node tools/field_icon/field_icon_cut.js --dry      # 書かずに結果だけ見る
//   node tools/field_icon/field_icon_cut.js --fill=0.2 # 塗り広げの上限を一時的に変える
//   （tools/field_icon で npm run cut）
//
// 入力：photo/midnight/field_icons/*.png（使用者提供の原図。暗藍色の背景つき）
// 出力：static_src/images/icons/fields/*.png（背景を抜いて中身の外接矩形で正方形に切り直す）
//
// 原図は photo/ に残す。map_*.jpg と同じ扱い（static_src のものは photo からの加工物で、
// 元が残っていないと閾値を変えて作り直せなくなる）。
//
// PNG の読み書きは tools/sprite_check/png.js を使い回す。依存ゼロの codec をもう一つ
// 書き起こす理由がない——グループを跨いで require しているのはそのためで、
// 板塊圖示と sprite sheet の間に機能上の関係があるわけではない。
const fs = require("fs");
const path = require("path");
const png = require("../sprite_check/png.js");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC_DIR = path.join(ROOT, "photo", "midnight", "field_icons");
const OUT_DIR = path.join(ROOT, "static_src", "images", "icons", "fields");

// 原図は暗藍色のべた塗りの上に、白い輝きを纏った圖示が乗っている。輝きは背景へ向かって
// 十数 px かけて薄れていくので、色距離で二値に切ると外周に暗藍色の輪が残る
// （使用者の「暗藍色的部分要裁切到」はまさにここ）。
//
// そこで各画素を「圖示の色を不透明度 a で暗藍の上に乗せた結果」と見なして a を解く。
//   obs = a * F + (1 - a) * bg
// F が未知なので解は一意に決まらないが、F が取りうる範囲（0~255）から a の下限が出る：
//   obs_c > bg_c なら a >= (obs_c - bg_c) / (255 - bg_c)   … F_c = 255 のとき最小
//   obs_c < bg_c なら a >= (bg_c - obs_c) / bg_c           … F_c = 0   のとき最小
// 各チャンネルの下限の最大を a とすれば、「暗藍が一切残らない最小の不透明度」になる。
// 薄い輝きは白のまま薄く、背景そのものは a=0。これが色距離の線形ランプより格段に綺麗。
//
// ただし a をそのまま不透明度にすると圖示の本体まで半透明になる（石材の中間色は
// a≈0.5 にしかならない）。本体は不透明でなければ明るい地の上で透けてしまうので、
// 「外周から届くか」で本体と外側を分け、本体は a=1 に固定する。
//
//   ・A_FILL 外周から背景として塗り広げる上限。圖示の縁（明るい輪郭線）は a≈0.55 まで
//            上がるので、ここで塗り広げが止まる。0.7 だと縁を突き抜けて本体まで
//            塗り広がり、圖示全体が半透明になる（実測済み）。
//   ・A_HOLE 塗り広げが届かない内側の隙間でも、これ未満なら暗藍と見なして抜く。
//            暗い圖示（例：夜色の城 a≈0.19）を巻き込まない値にする。
//   ・A_MIN  圧縮ノイズを切る下限。これ未満は完全透明にする。
const A_FILL_DEFAULT = 0.35;
// 暗い圖示は輪郭線も暗く、既定値では塗り広げが輪郭を突き抜けて本体まで広がる
// （夜色の城・魔術師塔・鍛造村がそれ）。そういう図だけ塗り広げの上限を下げる。値は
// --fill= で振って、本体が不透明に残る一番大きい値を採った。
const A_FILL_OVERRIDES = {
  "field_k.png": 0.16,
  "field_10.png": 0.16,
  "field_8.png": 0.14,
};
// 2026-09-22 に追加された 3 枚は、UI のパネルごと切り出した画像なので、四隅に飾り罫
// （鉤括弧）とパネル内側の細い枠線が写り込んでいる。これらは圖示の輝きと繋がって
// しまうことがあり連結成分では落としきれないので、額縁を除いたあと外周のこの割合を
// 問答無用で透明にする。圖示そのものはパネルの中央にあり、ここまで届いていない
// （届いていれば切り出し結果が欠けるので、下の EDGE_MASK を下げれば分かる）。
const EDGE_MASK = {
  "field_7.png": 0.08,
  "field_8.png": 0.08,
  "field_q.png": 0.08,
};
const A_HOLE = 0.12;
const A_MIN = 0.02;
// 輝きの濃さ。1.0 が物理的に正しい（暗藍を抜いたぶんだけ薄くなる）。地圖の上で輝きが
// 消えすぎないよう少しだけ持ち上げる。
const GLOW_GAIN = 1.3;
const MARGIN = 1; // 切り出し後に四辺へ足す余白（px）

// 「暗藍が残らない最小の不透明度」。0~1。
function minAlpha(r, g, b, bg) {
  const obs = [r, g, b];
  let a = 0;
  for (let c = 0; c < 3; c++) {
    const d = obs[c] - bg[c];
    const bound = d >= 0 ? d / Math.max(1, 255 - bg[c]) : -d / Math.max(1, bg[c]);
    if (bound > a) a = bound;
  }
  return a > 1 ? 1 : a;
}

// 背景色は「外周 20% のリングで一番多い色」。四隅の平均では足りない——2026-09-22 に
// 追加された 3 枚は外側に黒い額縁がついていて、隅を取ると真っ黒を背景と誤認する。
// リング全体の最頻色なら、額縁より面積の大きい暗藍のパネル色が採れる。
function backgroundColor(img) {
  const { width: w, height: h, data: d } = img;
  const inX0 = Math.floor(w * 0.2), inY0 = Math.floor(h * 0.2);
  const inX1 = Math.ceil(w * 0.8), inY1 = Math.ceil(h * 0.8);
  const bins = {};
  let best = null, bestN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= inX0 && x < inX1 && y >= inY0 && y < inY1) continue;
      const i = (y * w + x) * 4;
      if (d[i + 3] < 250) continue; // 角丸で透明な部分は数えない
      const key = (d[i] >> 2) + "," + (d[i + 1] >> 2) + "," + (d[i + 2] >> 2);
      const b = bins[key] || (bins[key] = { n: 0, r: 0, g: 0, bl: 0 });
      b.n++; b.r += d[i]; b.g += d[i + 1]; b.bl += d[i + 2];
      if (b.n > bestN) { bestN = b.n; best = b; }
    }
  }
  if (!best) return [0, 0, 0];
  return [best.r / best.n, best.g / best.n, best.bl / best.n];
}

// 外側の額縁を落とす。各辺から内側へ、「その行/列の中央 60% が背景色で埋まっている」
// ところまで進む。額縁の無い原図（最初の 9 枚）は 1 行目で条件を満たすので何も起きない。
function trimFrame(img, bg) {
  const { width: w, height: h, data: d } = img;
  function ratio(fixed, isRow) {
    let n = 0, ok = 0;
    const from = Math.floor((isRow ? w : h) * 0.2);
    const to = Math.ceil((isRow ? w : h) * 0.8);
    for (let v = from; v < to; v++, n++) {
      const i = (isRow ? fixed * w + v : v * w + fixed) * 4;
      if (d[i + 3] >= 250 && minAlpha(d[i], d[i + 1], d[i + 2], bg) < 0.08) ok++;
    }
    return n ? ok / n : 0;
  }
  const LIMIT = Math.floor(Math.min(w, h) * 0.1); // 額縁は多くても 1 割まで
  let top = 0, bottom = h - 1, left = 0, right = w - 1;
  while (top < LIMIT && ratio(top, true) < 0.6) top++;
  while (h - 1 - bottom < LIMIT && ratio(bottom, true) < 0.6) bottom--;
  while (left < LIMIT && ratio(left, false) < 0.6) left++;
  while (w - 1 - right < LIMIT && ratio(right, false) < 0.6) right--;
  if (top === 0 && left === 0 && bottom === h - 1 && right === w - 1) return img;
  const nw = right - left + 1, nh = bottom - top + 1;
  return {
    width: nw,
    height: nh,
    data: png.crop(img, left, top, nw, nh),
    hadAlpha: img.hadAlpha,
    trimmed: [left, top, nw, nh],
  };
}

// 外周から塗り広げて「外側の背景＋輝きの裾」を求める。ここに入らなかった画素が圖示の
// 本体（暗い画素も含む）で、そちらは不透明度 1 に固定する。圖示の内側に閉じ込められた
// 暗藍色（隙間から覗く穴）は塗り広げでは届かないので、cut() 側で a の小ささから拾う。
function floodBackground(img, bg, aFill) {
  const { width: w, height: h, data: d } = img;
  const isBg = new Uint8Array(w * h);
  const stack = [];
  function push(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const k = y * w + x;
    if (isBg[k]) return;
    const i = k * 4;
    if (d[i + 3] < 250) { isBg[k] = 1; stack.push(k); return; } // 元から透明な角丸部分
    if (minAlpha(d[i], d[i + 1], d[i + 2], bg) >= aFill) return;
    isBg[k] = 1;
    stack.push(k);
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const k = stack.pop();
    const x = k % w, y = (k - x) / w;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  // 境界を 1 px 内側へ広げる。塗り広げが止まる縁の画素はまだ「輝き＋暗藍」が混ざって
  // いて、そのまま不透明で残すと圖示のまわりに青灰色の輪として出る。1 px 外側扱いに
  // 回して un-premultiply させると、その輪が本来の明るい縁に戻る。
  const grown = Uint8Array.from(isBg);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (isBg[k]) continue;
      const near =
        (x > 0 && isBg[k - 1]) || (x < w - 1 && isBg[k + 1]) ||
        (y > 0 && isBg[k - w]) || (y < h - 1 && isBg[k + w]);
      if (near) grown[k] = 1;
    }
  }
  return grown;
}

// 残った画素のうち一番大きい塊だけを残す。原図の隅には UI の飾り罫（鉤括弧のような線）
// や、パネルの内側に引かれた細い枠線が入っていることがあり、それも「背景ではない」ので
// 普通に残ってしまう。圖示は必ず一番大きい塊なので、それ以外の島を落とせば消える。
//
// 繋がり判定は CONDUCT 以上の画素だけで行う。パネル全体にかかった極薄のグラデーション
// （alpha 15 前後）を通して飾り罫と圖示が地続きになってしまい、単純な連結では 1 つの島に
// なってしまうため。CONDUCT 未満は目視でほぼ見えない濃さなので、まとめて落とす。
const CONDUCT = 24;
function keepLargestIsland(w, h, data) {
  let faint = 0;
  for (let k = 0; k < w * h; k++) {
    const a = data[k * 4 + 3];
    if (a > 0 && a < CONDUCT) {
      data[k * 4] = data[k * 4 + 1] = data[k * 4 + 2] = data[k * 4 + 3] = 0;
      faint++;
    }
  }
  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || data[start * 4 + 3] === 0) continue;
    const id = sizes.length;
    let n = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const k = stack.pop();
      n++;
      const x = k % w, y = (k - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nk = ny * w + nx;
          if (label[nk] !== -1 || data[nk * 4 + 3] === 0) continue;
          label[nk] = id;
          stack.push(nk);
        }
      }
    }
    sizes.push(n);
  }
  let keep = -1, keepN = 0;
  sizes.forEach(function (n, i) { if (n > keepN) { keepN = n; keep = i; } });
  let dropped = 0;
  for (let k = 0; k < w * h; k++) {
    if (label[k] !== -1 && label[k] !== keep) {
      data[k * 4] = data[k * 4 + 1] = data[k * 4 + 2] = data[k * 4 + 3] = 0;
      dropped++;
    }
  }
  return { islands: sizes.length, dropped: dropped + faint };
}

function cut(img, aFill, edgeMask) {
  const { width: w, height: h, data: src } = img;
  const bg = backgroundColor(img);
  if (edgeMask) {
    // 外周を背景色で塗り潰してから処理する（飾り罫・内枠線ごと消える）。
    const band = Math.round(Math.min(w, h) * edgeMask);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x >= band && x < w - band && y >= band && y < h - band) continue;
        const i = (y * w + x) * 4;
        src[i] = Math.round(bg[0]); src[i + 1] = Math.round(bg[1]); src[i + 2] = Math.round(bg[2]); src[i + 3] = 255;
      }
    }
  }
  const isBg = floodBackground(img, bg, aFill);
  const out = Buffer.alloc(w * h * 4);

  for (let k = 0; k < w * h; k++) {
    const i = k * 4;
    const r = src[i], g = src[i + 1], b = src[i + 2];
    if (src[i + 3] < 250) continue; // 元から透明（角丸）な画素はそのまま透明
    const am = minAlpha(r, g, b, bg);
    // 塗り広げで届いた外側と、届かなくても a が十分小さい画素（＝圖示の隙間から覗く
    // 暗藍）は背景側。それ以外は圖示の本体なので不透明のまま残す。
    const isBackground = isBg[k] === 1 || am < A_HOLE;
    if (!isBackground) {
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
      continue;
    }
    if (am < A_MIN) continue; // 完全透明（out は 0 のまま）
    // 外側は「暗藍が一切残らない最小の不透明度」をそのまま使い、色は un-premultiply で
    // 戻した F にする。これをしないと暗藍が混ざったまま残り、明るい地に置いたときに
    // 輪郭のまわりへ青黒い輪として出る。輝きは薄く白く残る——原図で暗藍の上に見えて
    // いた明るさは、地の色が変われば変わるのが正しい。
    const t = Math.min(1, am * GLOW_GAIN);
    const f = 1 / am;
    for (let c = 0; c < 3; c++) {
      const obs = src[i + c];
      out[i + c] = Math.max(0, Math.min(255, Math.round(bg[c] + (obs - bg[c]) * f)));
    }
    out[i + 3] = Math.round(t * 255);
  }
  const islands = keepLargestIsland(w, h, out);
  return { width: w, height: h, data: out, bg: bg, islands: islands };
}

// 中身の外接矩形で切り、正方形に整える。地圖側は正方形に描くので、ここで正方形に
// 揃えておかないと縦横比が崩れる。余白を透明で足すだけで、絵は動かさない。
function squareTrim(img, alphaFloor) {
  const { width: w, height: h, data: d } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] >= alphaFloor) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error("中身が空（閾値が強すぎる）");
  x0 = Math.max(0, x0 - MARGIN); y0 = Math.max(0, y0 - MARGIN);
  x1 = Math.min(w - 1, x1 + MARGIN); y1 = Math.min(h - 1, y1 + MARGIN);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const side = Math.max(cw, ch);
  const ox = Math.floor((side - cw) / 2), oy = Math.floor((side - ch) / 2);
  const out = Buffer.alloc(side * side * 4);
  for (let y = 0; y < ch; y++) {
    const srcStart = ((y0 + y) * w + x0) * 4;
    d.copy(out, ((oy + y) * side + ox) * 4, srcStart, srcStart + cw * 4);
  }
  return { width: side, height: side, data: out, box: [x0, y0, cw, ch] };
}

// 大きすぎる原図は整数倍で縮める。地圖上では 40px 前後にしかならないので、500px の
// まま持っていても檔案が太るだけ。整数倍の箱平均で済ませる（依存を足さない）。
const MAX_SIDE = 192;
function shrink(img) {
  const f = Math.floor(img.width / MAX_SIDE);
  if (f < 2) return img;
  const nw = Math.floor(img.width / f), nh = Math.floor(img.height / f);
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * img.width + (x * f + dx)) * 4;
          const av = img.data[i + 3];
          // 色はアルファで重み付けして平均する。透明画素の色（0,0,0）を素で混ぜると
          // 縁が黒ずむ。
          r += img.data[i] * av; g += img.data[i + 1] * av; b += img.data[i + 2] * av;
          a += av;
        }
      }
      const o = (y * nw + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round(a / (f * f));
      }
    }
  }
  return { width: nw, height: nh, data: out, factor: f };
}

const args = process.argv.slice(2);
const dry = args.indexOf("--dry") !== -1;
const only = args.filter(function (a) { return a.indexOf("--") !== 0; })[0];
// --fill=0.2 で塗り広げの上限を一時的に上書きする（閾値を振って確かめる用）。
const fillArg = args.filter(function (a) { return a.indexOf("--fill=") === 0; })[0];
const fillOverride = fillArg ? parseFloat(fillArg.split("=")[1]) : null;

if (!fs.existsSync(SRC_DIR)) {
  console.error("原図のフォルダが無い: " + SRC_DIR);
  process.exit(1);
}
if (!dry && !fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs
  .readdirSync(SRC_DIR)
  .filter(function (f) { return /\.png$/i.test(f); })
  .filter(function (f) { return !only || f === only || f === only + ".png"; })
  .sort();

if (!files.length) {
  console.error("対象が無い" + (only ? "（指定: " + only + "）" : ""));
  process.exit(1);
}

files.forEach(function (f) {
  const raw = png.decode(path.join(SRC_DIR, f));
  const aFill = fillOverride || A_FILL_OVERRIDES[f] || A_FILL_DEFAULT;
  const img = trimFrame(raw, backgroundColor(raw));
  const cutImg = cut(img, aFill, EDGE_MASK[f] || 0);
  const trimmed = squareTrim(cutImg, 8);
  const small = shrink(trimmed);
  let opaque = 0, semi = 0;
  for (let i = 3; i < small.data.length; i += 4) {
    if (small.data[i] === 255) opaque++;
    else if (small.data[i] > 0) semi++;
  }
  if (!dry) png.encode(path.join(OUT_DIR, f), small.width, small.height, small.data);
  console.log(
    "  " + (dry ? "DRY " : "書出 ") + f +
    "  " + raw.width + "x" + raw.height +
    (img.trimmed ? " →額縁除去 " + img.width + "x" + img.height : "") +
    " → " + trimmed.width + "x" + trimmed.height +
    (small.factor ? " →1/" + small.factor + " " + small.width + "x" + small.height : "") +
    "  背景 rgb(" + cutImg.bg.map(Math.round).join(",") + ")" +
    "  fill " + aFill +
    "  島 " + cutImg.islands.islands + "（捨 " + cutImg.islands.dropped + "px）" +
    "  不透明 " + opaque + " / 半透明 " + semi
  );
});
console.log(dry ? "（--dry のため書き出していない）" : "出力先: " + path.relative(ROOT, OUT_DIR));
