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
ok(V.isGridDivisible(768, 1024), "768x1024 は 6x8 の正方格 (128x128)");
ok(!V.isGridDivisible(770, 1024), "770x1024 は横が割り切れない");
ok(!V.isGridDivisible(768, 1000), "768x1000 は縦が割り切れない");
ok(!V.isGridDivisible(768, 800), "768x800 は割り切れるが正方形でない (128x100)");

console.log(fail === 0 ? "\nすべてOK" : "\n" + fail + " 件 FAIL");
process.exit(fail === 0 ? 0 : 1);
