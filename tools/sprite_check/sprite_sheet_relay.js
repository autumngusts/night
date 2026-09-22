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

const argv = process.argv.slice(2);
const flags = argv.filter(function (a) { return a.indexOf("--") === 0; });
const pos = argv.filter(function (a) { return a.indexOf("--") !== 0; });
const SRC = pos[0];
const SRC_COLS = parseInt(pos[1], 10);
const SRC_ROWS = parseInt(pos[2], 10);
const SHEET_ID = pos[3];
// --rows=detect : 行の境目を等分割ではなく画像から探す。
// --cell=fit    : 出力セルを正方形にせず、絵の外接矩形に合わせる（横長のまま保つ）。
const DETECT_ROWS = flags.indexOf("--rows=detect") !== -1;
const FIT_CELL = flags.indexOf("--cell=fit") !== -1;
// --cols=detect : 列の境目も画像から探す（行ごとに別々に）。
// 攻擊の絵は横に長く、隣の列へはみ出すことがある（fulghor の弓の光条・突進の軌跡）。
// 等分割のままだと、はみ出した部分が列の境目でスパッと切れる。
const DETECT_COLS = flags.indexOf("--cols=detect") !== -1;
// --drop-row=N : 検出した帯が 1 本多いとき、N 本目（0 始まり）を捨てる。
// 生成物に規格外の行が 1 本混ざっていることがある（fulghor は 8 行のはずが 9 帯あった）。
// どの行が余分かは絵を見ないと決められないので、機械では選ばず人が指定する。
const dropArg = flags.filter(function (a) { return a.indexOf("--drop-row=") === 0; })[0];
const DROP_ROW = dropArg ? parseInt(dropArg.split("=")[1], 10) : -1;
// --row-order=0,3,2,1,4,5,7,8 : 検出した帯を、規格の行順（待機/直線/範圍/突刺/重砸/單擊/
// 受擊/死亡）へ並べ直す。生成物の行が規格と違う順で返ってくることがある（fulghor は
// 弓＝直線と突進＝突刺が入れ替わっていた）。余分な帯は書かなければ落ちるので、
// --drop-row= の一般形でもある。
const orderArg = flags.filter(function (a) { return a.indexOf("--row-order=") === 0; })[0];
const ROW_ORDER = orderArg
  ? orderArg.split("=")[1].split(",").map(function (v) { return parseInt(v, 10); })
  : null;
if (ROW_ORDER && ROW_ORDER.length !== 8) {
  console.error("--row-order= は 8 個の帯番号を並べること（受け取った値: " + ROW_ORDER.length + " 個）");
  process.exit(1);
}
if (!SRC || !SRC_COLS || !SRC_ROWS || !SHEET_ID) {
  console.error("usage: node sprite_sheet_relay.js <src.png> <srcCols> <srcRows> <sheetId> [--rows=detect] [--cell=fit]");
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

// ---- 行の境目（2026-09-22 追加）----
// 生成物の行が等間隔に並んでいないことがある。gladius 分裂形態の実測では、8 行の境目が
// y=151/285/431/701/923 と間隔がばらつき（134~270px）、しかも隣り合う行が接していて
// 全体の投影では切れ目が見えなかった。等分割で切ると 1 セルに上の行の尻尾と自分の絵が
// 同居する。
//
// 探し方：列ごとに「その y に絵が無い」かを見て、6 列中いくつが空いているかを数える。
// 行の境目なら多くの列が同時に空く（どこか 1 列が繋がっていても他の列が投票する）。
// 得られた帯が 8 本に満たないときは、高すぎる帯（＝複数行がくっついている）を
// その中の ink 最小位置で割る。最後に必ず 8 本になっているかを確かめる。
// 投票で得た「空いている区間」から帯を作り、n 本になるまで高い帯を割る。
// 行にも列にも使う（軸が違うだけで考え方は同じ）。
function bandsFromVotes(votes, ink, len, need, want, minSize) {
  const gaps = [];
  let st = null;
  for (let v = 0; v < len; v++) {
    const g = votes[v] >= need;
    if (g && st === null) st = v;
    if (!g && st !== null) { gaps.push([st, v - 1]); st = null; }
  }
  if (st !== null) gaps.push([st, len - 1]);
  let bands = [];
  let prev = 0;
  gaps.forEach(function (g) {
    if (g[0] > prev) bands.push([prev, g[0] - 1]);
    prev = g[1] + 1;
  });
  if (prev < len) bands.push([prev, len - 1]);
  bands = bands.filter(function (b) { return b[1] - b[0] + 1 > minSize; });
  if (!bands.length || bands.length > want) return bands;
  const counts = bands.map(function () { return 1; });
  let assigned = bands.length;
  while (assigned < want) {
    let bi = 0, bv = -1;
    bands.forEach(function (b, i) {
      const per = (b[1] - b[0] + 1) / counts[i];
      if (per > bv) { bv = per; bi = i; }
    });
    counts[bi]++;
    assigned++;
  }
  const out = [];
  bands.forEach(function (b, bi) {
    const size = b[1] - b[0] + 1;
    const k = counts[bi];
    if (k === 1) { out.push(b); return; }
    const cuts = [];
    for (let i = 1; i < k; i++) {
      const c = b[0] + Math.round((size * i) / k);
      const win = Math.round((size / k) * 0.25);
      let best = c, bv2 = Infinity;
      for (let v = c - win; v <= c + win; v++) {
        if (v <= b[0] || v >= b[1]) continue;
        if (ink[v] < bv2) { bv2 = ink[v]; best = v; }
      }
      cuts.push(best);
    }
    let start = b[0];
    cuts.forEach(function (c) { out.push([start, c - 1]); start = c; });
    out.push([start, b[1]]);
  });
  return out;
}

// その行の中だけで列の境目を探す。行ごとに絵の幅が違う（待機は細く、薙ぎ払いは横長）
// ので、全行まとめてではなく行ごとに見る。
function detectColBandsIn(y0, y1) {
  const ink = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = y0; y <= y1; y++) if (D[(y * W + x) * 4 + 3] >= T) n++;
    ink[x] = n;
  }
  const votes = new Int32Array(W);
  const th = (y1 - y0 + 1) * 0.004;
  for (let x = 0; x < W; x++) votes[x] = ink[x] <= th ? 1 : 0;
  const bands = bandsFromVotes(votes, ink, W, 1, DST_COLS, Math.round(W * 0.01));
  return bands.length === DST_COLS ? bands : null;
}

function detectRowBands() {
  const colOpen = [];
  for (let c = 0; c < SRC_COLS; c++) {
    const x0 = Math.round(c * cw), x1 = Math.round((c + 1) * cw) - 1;
    const th = (x1 - x0 + 1) * 0.004;
    const open = new Uint8Array(H);
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = x0; x <= x1; x++) if (D[(y * W + x) * 4 + 3] >= T) n++;
      open[y] = n <= th ? 1 : 0;
    }
    colOpen.push(open);
  }
  const votes = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    let v = 0;
    for (let c = 0; c < SRC_COLS; c++) v += colOpen[c][y];
    votes[y] = v;
  }
  const ink = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) if (D[(y * W + x) * 4 + 3] >= T) n++;
    ink[y] = n;
  }
  // 過半数の列が空いている区間を「境目」とみなす
  const need = Math.ceil(SRC_COLS * 0.6);
  const gaps = [];
  let st = null;
  for (let y = 0; y < H; y++) {
    const g = votes[y] >= need;
    if (g && st === null) st = y;
    if (!g && st !== null) { gaps.push([st, y - 1]); st = null; }
  }
  if (st !== null) gaps.push([st, H - 1]);
  // 境目に挟まれた部分が帯
  let bands = [];
  let prev = 0;
  gaps.forEach(function (g) {
    if (g[0] > prev) bands.push([prev, g[0] - 1]);
    prev = g[1] + 1;
  });
  if (prev < H) bands.push([prev, H - 1]);
  bands = bands.filter(function (b) { return b[1] - b[0] + 1 > H * 0.02; });
  if (!bands.length) return null;
  // 1 本だけ多いときは呼び出し側で --drop-row= を選ばせる。2 本以上多いのは切れ目の誤検出。
  if (bands.length > DST_ROWS) return bands;
  // 各帯が何行ぶんかを決める。合計が必ず DST_ROWS になるように、
  // 「1 行あたりが一番高い帯」から順に分割数を増やしていく。
  // 帯の高さは行ごとにばらつくので（実測 91~268px）、最小の帯を単位にして割ると
  // 合計が合わない。合計を固定して割り当てるほうが確実。
  if (bands.length > DST_ROWS) return bands; // 1 本多い。--drop-row= で選ばせる
  const counts = bands.map(function () { return 1; });
  let assigned = bands.length;
  while (assigned < DST_ROWS) {
    let bi = 0, bv = -1;
    bands.forEach(function (b, i) {
      const per = (b[1] - b[0] + 1) / counts[i];
      if (per > bv) { bv = per; bi = i; }
    });
    counts[bi]++;
    assigned++;
  }
  const out = [];
  bands.forEach(function (b, bi) {
    const hgt = b[1] - b[0] + 1;
    const k = counts[bi];
    if (k === 1) { out.push(b); return; }
    // k 行ぶんに割る。各切れ目は理論位置の周り ±25% で ink が最小の y。
    const cuts = [];
    for (let i = 1; i < k; i++) {
      const c = b[0] + Math.round((hgt * i) / k);
      const win = Math.round(hgt / k * 0.25);
      let best = c, bv = Infinity;
      for (let y = c - win; y <= c + win; y++) {
        if (y <= b[0] || y >= b[1]) continue;
        if (ink[y] < bv) { bv = ink[y]; best = y; }
      }
      cuts.push(best);
    }
    let start = b[0];
    cuts.forEach(function (c) { out.push([start, c - 1]); start = c; });
    out.push([start, b[1]]);
  });
  return out;
}

let ROW_BANDS = null;
let droppedBand = null;
let reordered = false;
if (DETECT_ROWS) {
  ROW_BANDS = detectRowBands();
  if (ROW_BANDS && ROW_ORDER) {
    const picked = ROW_ORDER.map(function (i) { return ROW_BANDS[i]; });
    if (picked.some(function (b) { return !b; })) {
      console.error("--row-order= に無い帯番号がある（検出した帯は 0~" + (ROW_BANDS.length - 1) + "）");
      process.exit(1);
    }
    reordered = true;
    ROW_BANDS = picked;
  } else if (ROW_BANDS && DROP_ROW >= 0 && DROP_ROW < ROW_BANDS.length && ROW_BANDS.length > DST_ROWS) {
    droppedBand = ROW_BANDS[DROP_ROW];
    ROW_BANDS = ROW_BANDS.filter(function (_, i) { return i !== DROP_ROW; });
  }
  if (!ROW_BANDS || ROW_BANDS.length !== DST_ROWS) {
    const n = ROW_BANDS ? ROW_BANDS.length : 0;
    console.error("行の境目を " + DST_ROWS + " 本に決められなかった（見つかった帯: " + n + "）。");
    if (n > DST_ROWS) {
      console.error(
        "帯が多い＝規格外の行が混ざっている。どれが余分かを絵で確かめて --drop-row=N を付けること" +
          "（N は 0 始まり、上から数えた帯の番号）。"
      );
      ROW_BANDS.forEach(function (b, i) {
        console.error("  帯 " + i + ": y " + b[0] + "-" + b[1] + "（高さ " + (b[1] - b[0] + 1) + "px）");
      });
    } else {
      console.error("行が重なりすぎている可能性が高い。生成し直すこと。");
    }
    process.exit(1);
  }
}

// r 行目の元画像での範囲。--rows=detect なら検出した帯、そうでなければ等分割。
function rowRange(r) {
  if (ROW_BANDS) return { y0: ROW_BANDS[r][0], y1: ROW_BANDS[r][1] };
  return { y0: Math.round(r * chh), y1: Math.round((r + 1) * chh) - 1 };
}

// r 行 c 列の横方向の範囲。--cols=detect のときは行ごとに検出した境目を使う。
let COL_BANDS = null; // 行ごとの列帯（検出できなかった行は null）
function colRange(c, r) {
  const b = COL_BANDS && COL_BANDS[r];
  if (b) return { x0: b[c][0], x1: b[c][1] };
  return { x0: Math.round(c * cw), x1: Math.round((c + 1) * cw) - 1 };
}

// ---- 隣行からの滲みを落とす ----
// 生成物は 1 体が行の高さに収まりきらず、上下の行へわずかに はみ出していることがある。
// 切り出すとその破片が「自分のセルの上端に張り付いた謎の影」として残る。
// 連結成分を取り、「端に張り付いていて、かつ端の近くだけに収まっている」ものを落とす。
//
// 大きさだけで判定すると外れる。実測（boss_edele 行1）では
//   本体   9093 px（94.8%）y=42-180  ← 上端に接しない
//   滲み    422 px（ 4.4%）y=0-10    ← 上端に接し、上端付近だけに収まる
// で、滲みは 4~5% と「小さい」の閾値に入れづらい。一方で位置は明確に分かれる。
// だから主判定は位置（端から BLEED_BAND 以内に収まっているか）にして、
// 大きさは「本体を絶対に消さない」ための保険として併用する。
//
// 吐息や剣閃のような本体から離れた大きなエフェクトは、縦に広がるので band に収まらず残る。
const BLEED_BAND = 0.22;      // セル高に対する、端からの帯の厚み
const BLEED_MAX_RATIO = 0.20; // 本体を消さないための上限（本体は 90% 超）
let bleedDropped = 0;

function dropBleed(c, r) {
  const cr = colRange(c, r);
  const x0 = cr.x0, x1 = cr.x1;
  const rr = rowRange(r);
  const y0 = rr.y0, y1 = rr.y1;
  const cwid = x1 - x0 + 1, chei = y1 - y0 + 1;
  const seen = new Uint8Array(cwid * chei);
  let total = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (D[(y * W + x) * 4 + 3] >= T) total++;
  }
  if (!total) return;
  const stack = [];
  for (let sy = 0; sy < chei; sy++) {
    for (let sx = 0; sx < cwid; sx++) {
      const si = sy * cwid + sx;
      if (seen[si]) continue;
      if (D[((y0 + sy) * W + x0 + sx) * 4 + 3] < T) { seen[si] = 1; continue; }
      // 幅優先で 1 成分を集める
      const comp = [];
      let touchesTop = false, touchesBottom = false;
      let touchesLeft = false, touchesRight = false;
      let minY = chei, maxY = -1;
      let minX = cwid, maxX = -1;
      stack.length = 0;
      stack.push(si);
      seen[si] = 1;
      while (stack.length) {
        const i = stack.pop();
        const px = i % cwid, py = (i / cwid) | 0;
        comp.push(i);
        if (py === 0) touchesTop = true;
        if (py === chei - 1) touchesBottom = true;
        if (px === 0) touchesLeft = true;
        if (px === cwid - 1) touchesRight = true;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        for (let d = 0; d < 4; d++) {
          const nx = px + (d === 0 ? 1 : d === 1 ? -1 : 0);
          const ny = py + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= cwid || ny >= chei) continue;
          const ni = ny * cwid + nx;
          if (seen[ni]) continue;
          seen[ni] = 1;
          if (D[((y0 + ny) * W + x0 + nx) * 4 + 3] >= T) stack.push(ni);
        }
      }
      // 上下だけでなく左右も見る。隣の列からの食い込みも同じ形で残るため。
      // 剣閃や薙ぎ払いの弧は横に長く伸びるので帯に収まらず、ここでは落ちない。
      const bandY = chei * BLEED_BAND;
      const bandX = cwid * BLEED_BAND;
      const stuckTop = touchesTop && maxY <= bandY;
      const stuckBottom = touchesBottom && minY >= chei - 1 - bandY;
      const stuckLeft = touchesLeft && maxX <= bandX;
      const stuckRight = touchesRight && minX >= cwid - 1 - bandX;
      if ((stuckTop || stuckBottom || stuckLeft || stuckRight) && comp.length < total * BLEED_MAX_RATIO) {
        comp.forEach(function (i) {
          const px = i % cwid, py = (i / cwid) | 0;
          D[((y0 + py) * W + x0 + px) * 4 + 3] = 0;
        });
        bleedDropped += comp.length;
      }
    }
  }
}

if (DETECT_COLS) {
  COL_BANDS = [];
  const failed = [];
  for (let r = 0; r < DST_ROWS; r++) {
    const rr = rowRange(r);
    const b = detectColBandsIn(rr.y0, rr.y1);
    COL_BANDS.push(b);
    if (!b) failed.push(r);
  }
  if (failed.length) {
    console.log("列の境目   : 行 " + failed.join(",") + " は決められず等分割のまま（他の行は検出）");
  }
}

for (let r = 0; r < DST_ROWS; r++) {
  for (let c = 0; c < DST_COLS; c++) dropBleed(c, r);
}

// ---- 各セルの実際の描画範囲 ----
function bboxOf(c, r) {
  const cr = colRange(c, r);
  const x0 = cr.x0, x1 = cr.x1;
  const rr = rowRange(r);
  const y0 = rr.y0, y1 = rr.y1;
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
let maxSide = 0, maxW = 0, maxH = 0, clipped = 0;
const OCCUPANCY_FIT = 0.92; // --cell=fit のときの余白（正方形のときより詰める）
for (let r = 0; r < DST_ROWS; r++) {
  boxes[r] = [];
  for (let c = 0; c < DST_COLS; c++) {
    const b = bboxOf(c, r);
    boxes[r][c] = b;
    if (!b) continue;
    if (Math.max(b.w, b.h) > maxSide) maxSide = Math.max(b.w, b.h);
    if (b.w > maxW) maxW = b.w;
    if (b.h > maxH) maxH = b.h;
    // 元セルの上下端に接していたら、そこで切れている可能性が高い
    const rr = rowRange(r);
    if (b.ty <= rr.y0 || b.by >= rr.y1) clipped++;
  }
}

// 既定は正方形セル（規格）。--cell=fit のときは絵の外接矩形に合わせた横長セルにする
// （2026-09-22 使用者明確規格「分裂形態不用正方形沒關係、保持原圖尺寸」）。どちらでも
// 絵は拡大縮小しない——変えるのはセルの寸法だけ。
let cellW, cellH;
if (FIT_CELL) {
  cellW = Math.ceil(maxW / OCCUPANCY_FIT / 8) * 8;
  cellH = Math.ceil(maxH / OCCUPANCY_FIT / 8) * 8;
} else {
  cellW = cellH = Math.ceil(maxSide / OCCUPANCY / 8) * 8;
}
const cell = cellW; // 既存のログ用（正方形のときの呼び名）
const OW = DST_COLS * cellW;
const OH = DST_ROWS * cellH;
const out = Buffer.alloc(OW * OH * 4, 0);

// 接地の基準：セル下端から少し上げた位置に、各セルのインク最下端を合わせる。
// 行ごとに絵の高さが違っても、ここで下端を揃えるので再生時に上下へ跳ねない
// （使用者明確規格「每個影格高度不同也進行切割保持底部共同標準即可」）。
const GROUND = Math.round(cellH * 0.94);

for (let r = 0; r < DST_ROWS; r++) {
  for (let c = 0; c < DST_COLS; c++) {
    const b = boxes[r][c];
    if (!b) continue;
    const dx = c * cellW + Math.round((cellW - b.w) / 2) - b.lx;
    const dy = r * cellH + GROUND - b.h - b.ty + (b.h - (b.by - b.ty + 1));
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
if (reordered) {
  console.log("行の並べ替え: 帯 " + ROW_ORDER.join(",") + " を規格の行順に割り当てた");
}
if (droppedBand) {
  console.log(
    "余分な行   : 帯 " + DROP_ROW + "（y " + droppedBand[0] + "-" + droppedBand[1] + "）を捨てた"
  );
}
if (ROW_BANDS) {
  console.log(
    "行の境目   : 検出（高さ " +
      ROW_BANDS.map(function (b) { return b[1] - b[0] + 1; }).join("/") +
      "px）"
  );
}
console.log(
  "最大の絵   : " + maxW + "x" + maxH + "px → セル " + cellW + "x" + cellH +
    "（占有 " + (maxW / cellW * 100).toFixed(0) + "% x " + (maxH / cellH * 100).toFixed(0) + "%）"
);
console.log("接地       : 各セル下端から " + (cellH - GROUND) + "px 上で揃えた");
if (bleedDropped) {
  console.log("隣行の滲み : " + bleedDropped + " px を除去（セル端に接した小さい連結成分）");
}
console.log("出力       : " + OW + "x" + OH + " -> " + path.relative(ROOT, dest));
if (clipped) {
  console.log("");
  console.log("⚠ " + clipped + " 個のセルで、絵が元セルの上下端に接していた。");
  console.log("  元画像の時点でそこが切れている可能性が高い（失われた画素はこちらでは戻せない）。");
}
