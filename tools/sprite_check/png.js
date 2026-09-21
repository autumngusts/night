// 依存なしの PNG 読み書き（8bit RGBA / 非インターレース）。
// 切り出しと検査に必要な最小限だけ。
const zlib = require("zlib");
const fs = require("fs");

function decode(file) {
  const b = fs.readFileSync(file);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const depth = b[24];
  const ctype = b[25];
  const interlace = b[28];
  // ctype 6 = RGBA、2 = RGB（アルファ無し）。生成サービスは後者を返すことがあり、
  // その場合「透過」は市松模様として画素に焼き込まれている。読めないと判別もできないので
  // どちらも受ける。RGB は読み込み時に alpha=255 を足して RGBA に揃える。
  if (depth !== 8 || (ctype !== 6 && ctype !== 2) || interlace !== 0) {
    throw new Error("only 8bit RGB/RGBA non-interlaced supported (got depth=" + depth + " ctype=" + ctype + ")");
  }
  const srcBpp = ctype === 6 ? 4 : 3;
  let off = 8;
  const idat = [];
  while (off < b.length - 8) {
    const len = b.readUInt32BE(off);
    const type = b.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") idat.push(b.subarray(off + 8, off + 8 + len));
    if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = srcBpp;
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const bb = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v = v + a;
      else if (ft === 2) v = v + bb;
      else if (ft === 3) v = v + ((a + bb) >> 1);
      else if (ft === 4) {
        const pp = a + bb - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
        v = v + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c);
      }
      cur[x] = v & 0xff;
    }
  }
  if (srcBpp === 4) return { width: w, height: h, data: px, hadAlpha: true };
  // RGB → RGBA（alpha は全て 255）。呼び出し側が「元からアルファが無かった」ことを
  // 判別できるよう hadAlpha を返す。
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += 3) {
    rgba[i * 4] = px[j];
    rgba[i * 4 + 1] = px[j + 1];
    rgba[i * 4 + 2] = px[j + 2];
    rgba[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data: rgba, hadAlpha: false };
}

const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encode(file, w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ])
  );
}

function crop(img, x0, y0, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= img.height) continue;
    const srcStart = (sy * img.width + x0) * 4;
    img.data.copy(out, y * w * 4, srcStart, srcStart + w * 4);
  }
  return out;
}

module.exports = { decode, encode, crop };
