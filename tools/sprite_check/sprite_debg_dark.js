// 深色實底（非透明）的動畫表，把背景剝成真正的 alpha，並拿掉左側的標籤欄與行間分隔線。
//
//   node tools/sprite_check/sprite_debg_dark.js <src.png> <out.png> [--label-x=175]
//
// 2026-09-26 追蹤者（暗黑）的 sheet 是這個形式：1024x1536、color type 2（RGB），
// 背景是接近黑的藍灰（約 6,13,15，上下有些微漸層），左側 x<175 寫著「0 待機」之類的
// 行號與說明，行與行之間還有一條 1~2px 的灰藍分隔線。sprite_dechecker.js 是剝「明亮的
// 無彩色市松」的，對這種暗底完全不適用，所以另寫一支。
//
// 剝法：
//   1. 背景色逐行估計（取左端 x<16 的中位數），吸收上下漸層。右端不能用：技藝行的爆炎
//      一路燒到畫面右緣，拿右端估計會把火焰當成背景色。左端只有標籤欄，x<16 是空的。
//   2. 與背景色的距離 d = 各通道差的最大值。從畫面外周開始，只經過 d<=FLOOD 的像素做
//      flood fill，得到「背景區域」。角色本體裡的暗部（斗篷陰影）跟外周不相連，所以
//      即使顏色接近背景也不會被挖空——這跟 dechecker 的 --keep-inner 是同一個考量。
//      例外：刀光弧線／旋轉光環會把一大片背景圍起來（致命一擊、能力行）。與外周不相連、
//      但面積達 ENCLOSED_MIN px 的背景色連通塊也算背景——斗篷的陰影不會有這麼大一片。
//   3. 背景區域 → alpha 0。從背景區域再經 d<SOLID 的像素擴張出去的「半透明帶」（輪郭的
//      抗鋸齒、動作殘影的暗色拖尾、爆炎的煙）依 d 在 FLOOD..SOLID 之間線性給 alpha，並把
//      背景色從顏色裡扣掉（否則輪郭會留一圈藍黑邊）。其餘 → 不透明。
//   4. 分隔線：在 x∈[label-x, W) 中有大量「偏藍的中間灰」的 y 視為分隔線，只清掉那一行裡
//      符合線色的像素（站在線上的腳不受影響）。
//   5. 整個連通塊都落在 x<label-x 的東西刪掉（行號與說明文字）。
const path = require("path");
const { decode, encode } = require(path.join(__dirname, "png.js"));

const argv = process.argv.slice(2);
const flags = argv.filter(function (a) { return a.indexOf("--") === 0; });
const pos = argv.filter(function (a) { return a.indexOf("--") !== 0; });
const SRC = pos[0];
const OUT = pos[1];
const labelArg = flags.filter(function (a) { return a.indexOf("--label-x=") === 0; })[0];
const LABEL_X = labelArg ? parseInt(labelArg.split("=")[1], 10) : 0;
// --soft-depth=N : 半透明帶只從背景區域往內延伸 N px（預設不限）。
//   2026-09-26 守護者（黎明）需要：盔甲是暗灰藍色，跟背景同屬冷色系，下面的 WARM 判定擋不住，
//   不限深度時整個身體被吃成半透明。限制在輪郭附近幾 px，就只剩抗鋸齒的那一圈。
const depthArg = flags.filter(function (a) { return a.indexOf("--soft-depth=") === 0; })[0];
const SOFT_DEPTH = depthArg ? parseInt(depthArg.split("=")[1], 10) : Infinity;
if (!SRC || !OUT) {
  console.error("usage: node sprite_debg_dark.js <src.png> <out.png> [--label-x=N]");
  process.exit(1);
}

const floodArg = flags.filter(function (a) { return a.indexOf("--flood=") === 0; })[0];
// --flood=N : 背景とみなす距離の上限（既定 12）。2026-09-26 淑女（黎明）は本體が暗灰色で
//   背景（18,20,22）とほぼ同色、12 だと体に穴が開くので下げる。
// --ghost=x0-x1:y0-y1 : その矩形の中は「色差＝不透明度」で alpha を付ける（flood の結果を使わない）。
//   2026-09-26 淑女（黎明）の技藝行「自身下降實體的透明度」：3~6 幀は本体が半透明に薄れていく絵で、
//   背景と相連しない暗部を不透明にする通常の処理だと、ただの黒い影に戻ってしまう。
//   色差 GHOST_FULL 以上で不透明、それ未満は比例して透ける。複数指定可。
// --ghost-full=N で変えられる。2026-09-26 鐵眼（暗黑）は光暈の中に本体が立っているので、
//   40 だと本体まで透ける。下げるほど本体は実に、暗い煙は残りやすくなる。
const ghostFullArg = flags.filter(function (a) { return a.indexOf("--ghost-full=") === 0; })[0];
const GHOST_FULL = ghostFullArg ? parseInt(ghostFullArg.split("=")[1], 10) : 40;
const GHOSTS = flags.filter(function (a) { return a.indexOf("--ghost=") === 0; }).map(function (a) {
  const v = a.split("=")[1].split(":");
  const xs = v[0].split("-").map(Number), ys = v[1].split("-").map(Number);
  return { x0: xs[0], x1: xs[1], y0: ys[0], y1: ys[1] };
});
function inGhost(x, y) {
  return GHOSTS.some(function (g) { return x >= g.x0 && x <= g.x1 && y >= g.y0 && y <= g.y1; });
}
// --dark-ink : 背景より暗い画素を「背景に重なった黒」として扱う。黒を不透明度 a で重ねた色は
//   bg*(1-a) なので a = 1 - 輝度/背景輝度 で正確に戻せる。flood／soft で背景・半透明と判定された
//   画素にも適用する（大きいほうの alpha を採る）。
//   2026-09-26 送葬人（黎明）の黒い翼：羽根は背景（14,17,20）より暗い（0~8）ので、色差だけ見ると
//   12~15 しかなく、flood に丸ごと背景として食われていた。
const DARK_INK = flags.indexOf("--dark-ink") !== -1;
const DARK_MARGIN = 4; // 背景雑音（±2）より確実に暗いときだけ
function lum3(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
// --label-box=x0-x1:y0-y1 : その矩形を背景色で塗りつぶす（flood の前）。複数指定可。
//   2026-09-26 執行者（暗黑）の技能行：説明文「閃橘黃光居合斬」の末尾が 1 幀目の人物に接していて、
//   連通塊で判定する --label-x= では消えない。文字の右端（x≈184）と人物の左端（x≈186）の間で切る。
const LABEL_BOXES = flags.filter(function (a) { return a.indexOf("--label-box=") === 0; }).map(function (a) {
  const v = a.split("=")[1].split(":");
  const xs = v[0].split("-").map(Number), ys = v[1].split("-").map(Number);
  return { x0: xs[0], x1: xs[1], y0: ys[0], y1: ys[1] };
});
const FLOOD = floodArg ? parseInt(floodArg.split("=")[1], 10) : 12; // 與背景距離在此以下且與外周相連 → 背景
const SOLID = 40; // 半透明帶的上限：距離到此以上 → 不透明
const WARM = 4;   // R 比 B 高出此值以上＝本體的暖色，不進半透明帶
const ENCLOSED_MIN = 600; // 被圍住的背景色連通塊，達此面積就當背景

const img = decode(SRC);
const W = img.width, H = img.height, D = img.data;

// 1. 逐行背景色
const bg = new Uint8Array(H * 3);
for (let y = 0; y < H; y++) {
  for (let ch = 0; ch < 3; ch++) {
    const vals = [];
    for (let x = 0; x < 16; x++) vals.push(D[(y * W + x) * 4 + ch]);
    vals.sort(function (a, b) { return a - b; });
    bg[y * 3 + ch] = vals[vals.length >> 1];
  }
}
function dist(x, y) {
  const i = (y * W + x) * 4;
  return Math.max(
    Math.abs(D[i] - bg[y * 3]),
    Math.abs(D[i + 1] - bg[y * 3 + 1]),
    Math.abs(D[i + 2] - bg[y * 3 + 2])
  );
}

// 4. 分隔線（先處理，讓 flood fill 能穿過它）
const lineRows = [];
function isLineColor(i) {
  const r = D[i], g = D[i + 1], b = D[i + 2];
  return b >= r + 8 && b > 30 && b < 150;
}
// --lines=149,270,... : 分隔線の y を直に指定する（自動偵測を使わない）。
//   2026-09-26 隱者（黎明）：藍紫色の特效が「偏藍の中間灰」に該当し、特效のある行が丸ごと
//   分隔線と誤判されて 40 萬 px が消えた。指定した y の上下 1px を線として扱う。
const linesArg = flags.filter(function (a) { return a.indexOf("--lines=") === 0; })[0];
const LINES = linesArg ? linesArg.split("=")[1].split(",").map(Number) : null;
if (LINES) LINES.forEach(function (y) { lineRows.push(y); });
for (let y = 0; !LINES && y < H; y++) {
  let n = 0;
  for (let x = LABEL_X; x < W; x++) if (isLineColor((y * W + x) * 4)) n++;
  if (n > (W - LABEL_X) * 0.25) lineRows.push(y);
}
// 線的上下 1px 也常帶淡淡的線色（抗鋸齒）
const lineMask = new Uint8Array(H);
lineRows.forEach(function (y) {
  for (let k = -1; k <= 1; k++) if (y + k >= 0 && y + k < H) lineMask[y + k] = 1;
});
let lineCleared = 0;
for (let y = 0; y < H; y++) {
  if (!lineMask[y]) continue;
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (isLineColor(i) || dist(x, y) <= FLOOD * 2) {
      D[i] = bg[y * 3]; D[i + 1] = bg[y * 3 + 1]; D[i + 2] = bg[y * 3 + 2];
      lineCleared++;
    }
  }
}

LABEL_BOXES.forEach(function (b) {
  for (let y = Math.max(0, b.y0); y <= Math.min(H - 1, b.y1); y++) {
    for (let x = Math.max(0, b.x0); x <= Math.min(W - 1, b.x1); x++) {
      const i = (y * W + x) * 4;
      D[i] = bg[y * 3]; D[i + 1] = bg[y * 3 + 1]; D[i + 2] = bg[y * 3 + 2];
    }
  }
});

// 2. 從外周 flood fill
const isBg = new Uint8Array(W * H);
const stack = [];
function seed(x, y) {
  const p = y * W + x;
  if (!isBg[p] && dist(x, y) <= FLOOD) { isBg[p] = 1; stack.push(p); }
}
for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }
while (stack.length) {
  const p = stack.pop();
  const x = p % W, y = (p / W) | 0;
  if (x > 0) seed(x - 1, y);
  if (x < W - 1) seed(x + 1, y);
  if (y > 0) seed(x, y - 1);
  if (y < H - 1) seed(x, y + 1);
}

// 被圍住的大片背景
let enclosedPx = 0;
{
  const seen = new Uint8Array(W * H);
  const comp = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (isBg[p0] || seen[p0] || dist(p0 % W, (p0 / W) | 0) > FLOOD) continue;
    comp.length = 0;
    const st = [p0];
    seen[p0] = 1;
    while (st.length) {
      const p = st.pop();
      comp.push(p);
      const x = p % W, y = (p / W) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
      for (let k = 0; k < 4; k++) {
        const q = nb[k];
        if (q < 0 || seen[q] || isBg[q]) continue;
        if (dist(q % W, (q / W) | 0) > FLOOD) continue;
        seen[q] = 1;
        st.push(q);
      }
    }
    if (comp.length >= ENCLOSED_MIN) {
      comp.forEach(function (p) { isBg[p] = 1; });
      enclosedPx += comp.length;
    }
  }
}

// 半透明帶：從背景區域往外，只經過 d<SOLID 的像素再做一次 flood fill。
// 輪郭的抗鋸齒、動作殘影的暗色拖尾、爆炎周圍的煙都是「背景色上疊一層淡淡的東西」，
// 跟背景相連、距離小、而且仍是背景的冷色系。
const soft = new Uint8Array(W * H);
{
  // 幅優先で深さを数える（--soft-depth= 用）。深さ無制限なら到達集合は深さ優先と同じ。
  let st = [];
  for (let p = 0; p < W * H; p++) if (isBg[p]) st.push(p);
  for (let depth = 1; st.length && depth <= SOFT_DEPTH; depth++) {
  const next = [];
  for (let si = 0; si < st.length; si++) {
    const p = st[si];
    const x = p % W, y = (p / W) | 0;
    const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
    for (let k = 0; k < 4; k++) {
      const q = nb[k];
      if (q < 0 || isBg[q] || soft[q]) continue;
      if (dist(q % W, (q / W) | 0) >= SOLID) continue;
      // 本體是金褐色（R>B），殘影與煙是背景色系（偏藍或無彩色）。只讓後者進半透明帶，
      // 否則斗篷的暗部會從輪郭一路被吃成半透明（2026-09-26 實測，SOLID=40 時整件斗篷透底）。
      if (D[q * 4] > D[q * 4 + 2] + WARM) continue;
      soft[q] = 1;
      next.push(q);
    }
  }
  st = next;
  }
}

// 3. alpha
const out = Buffer.alloc(W * H * 4);
let bgPx = 0, edgePx = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = y * W + x, i = p * 4;
    if (DARK_INK) {
      const bl = lum3(bg[y * 3], bg[y * 3 + 1], bg[y * 3 + 2]);
      const l = lum3(D[i], D[i + 1], D[i + 2]);
      // 分隔線の上下は線の影で背景より暗いことがある。黒として拾うと細い黒線が残る。
      let nearLine = false;
      for (let k = -2; k <= 2; k++) if (y + k >= 0 && y + k < H && lineMask[y + k]) nearLine = true;
      if (!nearLine && l < bl - DARK_MARGIN && (isBg[p] || soft[p])) {
        const ad = Math.round((1 - l / bl) * 255);
        // 黒を ad で重ねた色から元の色（ほぼ黒）を戻す
        const f = 255 / ad;
        for (let ch = 0; ch < 3; ch++) {
          const b0 = bg[y * 3 + ch];
          const v = Math.round((D[i + ch] - b0 * (1 - ad / 255)) * f);
          out[i + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
        out[i + 3] = ad;
        if (isBg[p]) bgPx++;
        continue;
      }
    }
    if (isBg[p]) { bgPx++; continue; }
    let a = 255;
    if (GHOSTS.length && inGhost(x, y)) {
      a = Math.min(255, Math.round((dist(x, y) / GHOST_FULL) * 255));
      if (a < 8) { out[i + 3] = 0; continue; }
    } else
    if (soft[p]) {
      const d = dist(x, y);
      if (d < SOLID) {
        a = Math.max(1, Math.round(((d - FLOOD) / (SOLID - FLOOD)) * 255));
        edgePx++;
      }
    }
    const f = 255 / a;
    for (let ch = 0; ch < 3; ch++) {
      const b0 = bg[y * 3 + ch];
      let v = Math.round(b0 + (D[i + ch] - b0) * f);
      out[i + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    out[i + 3] = a;
  }
}

// 5. 標籤欄：連通塊整個落在 x<LABEL_X 內的才刪。不能整欄清空——第 1 幀的劍尖往左下伸到
//    x≈150，跟「帶點黃色閃光特效」之類的說明文字在同一個 x 範圍裡交錯；劍尖連著本體，
//    文字則是一字一塊（或幾字一塊）獨立的連通塊。
let labelPx = 0;
if (LABEL_X > 0) {
  const seen = new Uint8Array(W * H);
  const comp = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (seen[p0] || out[p0 * 4 + 3] === 0 || p0 % W >= LABEL_X) continue;
    comp.length = 0;
    let maxX = 0;
    const st = [p0];
    seen[p0] = 1;
    while (st.length) {
      const p = st.pop();
      comp.push(p);
      const x = p % W, y = (p / W) | 0;
      if (x > maxX) maxX = x;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = yy * W + xx;
          if (seen[q] || out[q * 4 + 3] === 0) continue;
          seen[q] = 1;
          st.push(q);
        }
      }
    }
    if (maxX < LABEL_X) {
      comp.forEach(function (p) { out[p * 4 + 3] = 0; });
      labelPx += comp.length;
    }
  }
}

encode(OUT, W, H, out);
console.log("輸入       : " + W + "x" + H);
console.log("分隔線     : y " + lineRows.join(",") + "（清掉 " + lineCleared + " px）");
console.log("標籤欄     : 整塊落在 x<" + LABEL_X + " 的連通塊 " + labelPx + " px 刪除");
console.log("背景       : " + bgPx + " px（" + ((bgPx / (W * H)) * 100).toFixed(1) + "%，其中被圍住的 " + enclosedPx + " px）／輪郭半透明 " + edgePx + " px");
console.log("輸出       : " + OUT);
