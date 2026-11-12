// ============================================================================
// 緣日樂園 Blender 版：依立繪（jikan n_022，小夜）畫的五官貼圖（2026-11-12）
//   參考立繪的特徵：上眼皮睫毛粗、眼尾微微上揚（つり目）、紅色虹膜上深下淺＋下方反光、
//   兩顆高光、細眉、極小的鼻影與嘴。尺寸與 build_sayo.py 的 FACE_BOX／EYE_* 對應：
//     臉部貼圖 512²：x∈[-0.16, 0.16]、y∈[1.06, 1.38]（u 往 +x、v 往下）
//     眼睛／眼皮／嘴巴 256²：面片半寬 EYE_H；眼皮面片高 LID_UP（= 46px）
// ============================================================================
"use strict";

var SAYO = {
  skin: "#ffece4",
  hair: "#2b2024",
  brow: "#3a2830",
  iris: ["#2a0610", "#6a1424", "#c23a4c", "#ff8a96"],
};

// 臉部貼圖：眉、腮紅、鼻影
function faceSvg(c) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">' +
    '<defs><radialGradient id="b"><stop offset="0" stop-color="#ff8e98" stop-opacity=".55"/><stop offset="1" stop-color="#ff8e98" stop-opacity="0"/></radialGradient></defs>' +
    '<rect width="512" height="512" fill="' + c.skin + '"/>' +
    '<ellipse cx="378" cy="304" rx="48" ry="22" fill="url(#b)"/><ellipse cx="134" cy="304" rx="48" ry="22" fill="url(#b)"/>' +
    // 斜線狀的害羞紅暈（立繪常見的畫法）
    '<g stroke="#ff8e98" stroke-width="2" opacity=".45" stroke-linecap="round">' +
    '<path d="M362,300 L370,292"/><path d="M374,302 L382,294"/><path d="M386,304 L394,296"/>' +
    '<path d="M118,304 L126,296"/><path d="M130,302 L138,294"/><path d="M142,300 L150,292"/></g>' +
    '<path d="M298,166 Q338,148 384,160" fill="none" stroke="' + c.brow + '" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M214,166 Q174,148 128,160" fill="none" stroke="' + c.brow + '" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M254,274 Q260,283 255,290" fill="none" stroke="#d9988a" stroke-width="3" stroke-linecap="round"/>' +
    "</svg>";
}

// 左眼（+x，外眼角在右、微微上揚）
var ALMOND = "M36,146 C52,98 102,74 140,74 C180,74 210,92 228,118 C214,158 170,184 120,182 C84,180 54,166 36,146 Z";
function eyeSvg(c) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">' +
    "<defs>" +
    '<linearGradient id="i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c.iris[0] + '"/><stop offset=".35" stop-color="' + c.iris[1] + '"/><stop offset=".75" stop-color="' + c.iris[2] + '"/><stop offset="1" stop-color="' + c.iris[3] + '"/></linearGradient>' +
    '<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a1828" stop-opacity=".55"/><stop offset=".4" stop-color="#3a1828" stop-opacity="0"/></linearGradient>' +
    '<clipPath id="a"><path d="' + ALMOND + '"/></clipPath>' +
    "</defs>" +
    '<path d="' + ALMOND + '" fill="#fcf8f8"/>' +
    '<g clip-path="url(#a)">' +
    '<ellipse cx="132" cy="128" rx="46" ry="56" fill="url(#i)" stroke="#1a0408" stroke-width="3"/>' +
    '<ellipse cx="132" cy="160" rx="28" ry="13" fill="#ff9aa6" opacity=".35"/>' +
    '<ellipse cx="132" cy="134" rx="16" ry="24" fill="#12030a"/>' +
    '<rect x="0" y="60" width="256" height="140" fill="url(#s)"/>' +
    '<circle cx="112" cy="102" r="11" fill="#fff"/><circle cx="146" cy="96" r="3" fill="#fff" opacity=".7"/>' +
    '<circle cx="152" cy="152" r="5" fill="#fff" opacity=".9"/>' +
    "</g>" +
    '<path d="M88,180 C130,190 186,180 222,150" fill="none" stroke="#7a3a44" stroke-width="3" stroke-linecap="round" opacity=".55"/>' +
    "</svg>";
}

// 眼皮：上睫毛（粗、外眼角有翹起的睫毛）以上是皮膚色、以下透明；雙眼皮線畫在眼皮上，閉眼時一起往下
function lidSvg(c) {
  var lash = "M30,192 C48,142 100,116 140,116 C182,116 214,136 232,162 L248,150";
  return '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">' +
    '<path d="M0,0 L256,0 L256,154 L248,150 L232,162 C214,136 182,116 140,116 C100,116 48,142 30,192 L0,198 Z" fill="' + c.skin + '"/>' +
    '<path d="M70,106 C112,86 178,90 220,118" fill="none" stroke="#c79090" stroke-width="3" stroke-linecap="round" opacity=".6"/>' +
    '<path d="' + lash + '" fill="none" stroke="#1e1016" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M224,150 L252,136 L242,164 Z" fill="#1e1016"/>' +
    '<path d="M206,136 L226,120 L222,142 Z" fill="#1e1016"/>' +
    '<path d="M36,180 L24,186 L36,190 Z" fill="#1e1016"/>' +
    "</svg>";
}

function mouthSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">' +
    '<path d="M98,124 Q128,140 158,124 Q128,134 98,124 Z" fill="#c04656"/>' +
    '<path d="M98,124 Q128,140 158,124" fill="none" stroke="#8a2a38" stroke-width="5" stroke-linecap="round"/>' +
    "</svg>";
}

// 頭髮：髮束的 uv 是（斷面一圈, 髮根→髮尾）。髮根附近一條較亮的光澤帶（立繪的「天使環」）＋細的髮絲紋
function hairSvg(c) {
  var streaks = "";
  for (var i = 0; i < 16; i++) {
    var x = 4 + i * 8 + (i % 3) * 2;
    streaks += '<path d="M' + x + ',0 L' + (x + 2) + ',256" stroke="#000" stroke-opacity=".18" stroke-width="1.2"/>';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 128 256" preserveAspectRatio="none">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + c.hair + '"/><stop offset=".16" stop-color="' + c.hair + '"/>' +
    '<stop offset=".24" stop-color="#6e5a66"/><stop offset=".3" stop-color="#4a3a44"/><stop offset=".38" stop-color="' + c.hair + '"/>' +
    '<stop offset="1" stop-color="#22181c"/></linearGradient></defs>' +
    '<rect width="128" height="256" fill="url(#g)"/>' + streaks + "</svg>";
}

module.exports = { SAYO: SAYO, faceSvg: faceSvg, eyeSvg: eyeSvg, lidSvg: lidSvg, mouthSvg: mouthSvg, hairSvg: hairSvg };
