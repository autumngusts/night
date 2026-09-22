// sprite_verify.js の純函式部分の回歸測試。
//
//   node tools/sprite_check/sprite_verify_check.js
//
// 画像がまだ1枚も無い段階でも走らせたいので、PNG ヘッダは実ファイルではなく
// テスト内で組み立てた最小バイト列で検証する（外部相依ゼロ）。
const V = require("./sprite_verify.js");
let fail = 0;
function ok(cond, label) {
  console.log((cond ? "  OK   " : "  FAIL ") + label);
  if (!cond) fail++;
}

function fakePng(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

console.log("[PNG ヘッダの読み取り]");
const size = V.readPngSize(fakePng(768, 1024));
ok(size && size.width === 768 && size.height === 1024, "768x1024 を読める");
ok(V.readPngSize(Buffer.from("not a png at all, just text")) === null, "PNG でなければ null");
ok(V.readPngSize(null) === null, "null なら null");

console.log("[6x8 に割り切れるか]");
ok(!V.gridErrorOf(768, 1024), "768x1024 は 6x8 に割り切れる (128x128)");
ok(!!V.gridErrorOf(770, 1024), "770x1024 は横が割り切れない");
ok(!!V.gridErrorOf(768, 1002), "768x1002 は縦が割り切れない");
// 2026-09-22：正方形でなくてもよくなった（使用者明確規格「分裂形態不用正方形沒關係」）。
// 表現層が画像の実寸から縦横比を読むため（midnight_sprite.js の cellAspectOf()）。
ok(!V.gridErrorOf(768, 800), "768x800 は割り切れれば通る（128x100 の横長セル）");
ok(!V.gridErrorOf(1680, 1280), "1680x1280 は通る（280x160、gladius 分裂形態の実寸）");
// ただし極端な比は「6x8 で切る前提そのものが違う」合図なので弾く。
ok(!!V.gridErrorOf(768, 200), "768x200 は 1 格 128x25 で潰れすぎ（縦横比 0.20）");
ok(!!V.gridErrorOf(768, 3000), "768x3000 は 1 格 128x375 で縦長すぎ（縦横比 2.93）");

console.log(fail === 0 ? "\nすべてOK" : "\n" + fail + " 件 FAIL");
process.exit(fail === 0 ? 0 : 1);
