// 板塊卡牌の地點圖示（static_src/images/icons/fields/）の回歸測試。
//
//   node tools/field_icon/field_icon_check.js
//   （または tools/field_icon で npm test）
//
// 驗證 5 點：
//   ① midnight.js の FIELD_CARD_ICON_FILES が参照する檔案が実在する
//   ② 参照している card が midnight_map.js の FIELD_CARD_NAMES に実在する
//   ③ 各 PNG が 8bit RGBA の正方形（地圖側は正方形で描くので、比率が崩れると絵が歪む）
//   ④ 暗藍色が残っていない（使用者明確要求「暗藍色的部分要裁切到」）
//   ⑤ 中身が外接矩形で切られている（四辺のどこかに中身が接している）
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const png = require("../sprite_check/png.js");

const ROOT = path.resolve(__dirname, "..", "..");
const ICON_DIR = path.join(ROOT, "static_src", "images", "icons", "fields");

let fail = 0;
function ok(cond, label) {
  console.log((cond ? "  OK   " : "  FAIL ") + label);
  if (!cond) fail++;
}

// midnight.js は IIFE 全体が 2 万行あるので実行はせず、テーブル部分だけ切り出して読む。
const midnightSrc = fs.readFileSync(path.join(ROOT, "static_src", "midnight.js"), "utf8");
const tableMatch = midnightSrc.match(/var FIELD_CARD_ICON_FILES = \{([\s\S]*?)\};/);
if (!tableMatch) {
  console.error("midnight.js に FIELD_CARD_ICON_FILES が見つからない");
  process.exit(1);
}
const FILES = {};
tableMatch[1].replace(/"?([0-9A-Z]+)"?\s*:\s*"([^"]+)"/g, function (_, card, file) {
  FILES[card] = file;
  return "";
});

const mapSandbox = { window: {}, console };
vm.createContext(mapSandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "static_src", "midnight_map.js"), "utf8"), mapSandbox, {
  filename: "midnight_map.js",
});
const NAMES = mapSandbox.window.PriTestMidnightMap.FIELD_CARD_NAMES;

console.log("[登錄]");
const cards = Object.keys(FILES);
ok(cards.length > 0, "FIELD_CARD_ICON_FILES に項目がある (" + cards.length + " 件)");
cards.forEach(function (card) {
  ok(!!NAMES[card], "card " + card + " は FIELD_CARD_NAMES にある" + (NAMES[card] ? "（" + NAMES[card].zh + "）" : ""));
  ok(fs.existsSync(path.join(ICON_DIR, FILES[card])), "檔案あり: " + FILES[card]);
});

console.log("[畫像]");
cards.forEach(function (card) {
  const p = path.join(ICON_DIR, FILES[card]);
  if (!fs.existsSync(p)) return;
  let img;
  try {
    img = png.decode(p);
  } catch (e) {
    ok(false, FILES[card] + " が讀めない: " + e.message);
    return;
  }
  ok(img.width === img.height, FILES[card] + " は正方形 (" + img.width + "x" + img.height + ")");
  ok(img.hadAlpha === true, FILES[card] + " は alpha 通道あり（RGBA）");

  // 暗藍色（原図の背景 rgb(18,27,42) 近辺）が不透明のまま残っていないこと。
  // 完全に 0 を求めると圖示自身の暗い色（夜色の城など）まで弾いてしまうので、
  // 「不透明画素のうち暗藍そのものと言える色」が 1% 未満であることを見る。
  const BG = [19, 27, 42];
  let opaque = 0, navy = 0, minA = 255, maxA = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3];
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
    if (a !== 255) continue;
    opaque++;
    const dr = img.data[i] - BG[0], dg = img.data[i + 1] - BG[1], db = img.data[i + 2] - BG[2];
    if (Math.sqrt(dr * dr + dg * dg + db * db) < 14) navy++;
  }
  const ratio = opaque ? navy / opaque : 0;
  ok(ratio < 0.01, FILES[card] + " に暗藍の殘りがない（不透明画素の " + (ratio * 100).toFixed(2) + "%）");
  ok(minA === 0, FILES[card] + " に完全透明な画素がある（去背されている）");

  // 外接矩形で切られていること：四辺のいずれかに中身（alpha>=8）が接している。
  const w = img.width, h = img.height;
  function rowHas(y) {
    for (let x = 0; x < w; x++) if (img.data[(y * w + x) * 4 + 3] >= 8) return true;
    return false;
  }
  function colHas(x) {
    for (let y = 0; y < h; y++) if (img.data[(y * w + x) * 4 + 3] >= 8) return true;
    return false;
  }
  const MARGIN = 2; // field_icon_cut.js の余白 1px ＋ 正方形化のズレ
  let touch = false;
  for (let d = 0; d <= MARGIN; d++) {
    if (rowHas(d) || rowHas(h - 1 - d) || colHas(d) || colHas(w - 1 - d)) touch = true;
  }
  ok(touch, FILES[card] + " は中身の外接矩形で切られている（余白が " + MARGIN + "px 以内）");
});

console.log("[fallback]");
// 圖示が無い札は數字カードのまま描かれる。全部そろっていることを要求しないのが仕様
// （spec と同じ考え方）なので、ここでは「無い札が存在してもよい」ことだけ明示する。
const missing = Object.keys(NAMES).filter(function (card) {
  return !FILES[card];
});
console.log("  info 圖示が無い札（數字カードのまま）: " + (missing.length ? missing.join(", ") : "なし"));

console.log(fail === 0 ? "\nすべてOK" : "\n" + fail + " 件 FAIL");
process.exit(fail === 0 ? 0 : 1);
