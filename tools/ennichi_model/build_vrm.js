// ============================================================================
// 緣日樂園：程序化產生 VRM 1.0 角色（技術驗證樣本，2026-11-12 第 2 版）
//   不依賴建模軟體，直接用程式拼出巫女小夜，寫成 .vrm（= 帶 VRMC_vrm 擴充的 GLB）。
//   第 2 版（使用者要求「臉型更細緻、眼睛不要動畫式特大但要清楚、服裝更細緻」）：
//     臉：球體雕塑成下巴收尖的臉型＋小鼻樑＋耳朵；五官改為 VRoid 同樣的作法——
//         眉、腮紅畫在臉部貼圖上，眼睛、眼皮、嘴巴是貼著臉的小面片（貼圖＋透明裁切），
//         眨眼＝皮膚色的眼皮（下緣是睫毛）往下滑蓋住眼睛；嘴巴的 aa 是把面片拉開
//     頭髮：瀏海、側髮、後髮、馬尾都是一束一束的髮束（沿曲線掃掠、尾端收尖）
//     服裝：白衣的交領（左衽在上）＋紅色襦袢領、緋袴的褶（打褶的旋轉體）、腰紐與前結、
//           袴的腰板、大袖（3 條彈簧骨鏈，走路揮手時輕微擺動；重力設太大會把袖子扯進身體）、袖括紐、草履
//   貼圖用 SVG 畫好，經 Playwright 轉成 PNG 嵌入 GLB。
//   載入端（static_src/ennichi_lab.js）不認得模型是怎麼做的，換成 VRoid 匯出的 .vrm 也一樣能用。
// 前置：tools/midnight_check 已 npm install（借用其中的 playwright）
// 用法：node tools/ennichi_model/build_vrm.js
//   輸出 static_src/models/ennichi/<id>.vrm（目前只有 sayo＝巫女小夜）
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var ROOT = path.join(__dirname, "..", "..");
var OUT_DIR = path.join(ROOT, "static_src", "models", "ennichi");

// ---------------------------------------------------------------- 小工具
function lin1(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function lin(hex) { var n = parseInt(hex.slice(1), 16); return [lin1((n >> 16) & 255), lin1((n >> 8) & 255), lin1(n & 255)]; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// ---------------------------------------------------------------- 幾何（每個都帶 uv）
// 旋轉體：profile [[半徑, y], ...]（y 由下往上）；rmod(θ, y) 可以讓半徑隨角度變化（例：袴的褶）
function lathe(profile, seg, rmod) {
  var pos = [], uv = [], idx = [];
  var rows = profile.length;
  for (var i = 0; i < rows; i++) {
    for (var s = 0; s <= seg; s++) {
      var a = (s / seg) * Math.PI * 2;
      var r = profile[i][0] * (rmod ? rmod(a, profile[i][1]) : 1);
      pos.push([r * Math.sin(a), profile[i][1], r * Math.cos(a)]);
      uv.push([s / seg, 1 - i / (rows - 1)]);
    }
  }
  for (i = 0; i < rows - 1; i++) {
    for (s = 0; s < seg; s++) {
      var a0 = i * (seg + 1) + s, a1 = a0 + 1, b0 = a0 + seg + 1, b1 = b0 + 1;
      idx.push(a0, a1, b0, a1, b1, b0); // 外側為正面（逆時針）
    }
  }
  return { pos: pos, uv: uv, idx: idx };
}

function sphereProfile(rings) {
  var prof = [];
  for (var i = 0; i <= rings; i++) {
    var t = Math.PI * (1 - i / rings);
    prof.push([Math.sin(t), Math.cos(t)]);
  }
  return prof;
}

function ellipsoid(c, r, seg, rings) {
  var g = lathe(sphereProfile(rings || 14), seg || 20);
  g.pos = g.pos.map(function (p) { return [c[0] + p[0] * r[0], c[1] + p[1] * r[1], c[2] + p[2] * r[2]]; });
  return g;
}

// 超橢球（e < 1 越接近圓角方塊）：袖子、草履、腰板
function superEllipsoid(c, r, e1, e2, segU, segV) {
  function S(v, e) { return Math.sign(v) * Math.pow(Math.abs(v), e); }
  var pos = [], uv = [], idx = [];
  segU = segU || 16; segV = segV || 24;
  for (var i = 0; i <= segU; i++) {
    var u = -Math.PI / 2 + Math.PI * (i / segU);
    for (var j = 0; j <= segV; j++) {
      var v = -Math.PI + 2 * Math.PI * (j / segV);
      pos.push([c[0] + r[0] * S(Math.cos(u), e1) * S(Math.sin(v), e2), c[1] + r[1] * S(Math.sin(u), e1), c[2] + r[2] * S(Math.cos(u), e1) * S(Math.cos(v), e2)]);
      uv.push([j / segV, 1 - i / segU]);
    }
  }
  for (i = 0; i < segU; i++) for (j = 0; j < segV; j++) {
    var a0 = i * (segV + 1) + j, a1 = a0 + 1, b0 = a0 + segV + 1, b1 = b0 + 1;
    idx.push(a0, a1, b0, a1, b1, b0);
  }
  return orient({ pos: pos, uv: uv, idx: idx }, c);
}

// Catmull-Rom 平滑取樣
function spline(pts, n) {
  var out = [];
  for (var k = 0; k <= n; k++) {
    var f = (k / n) * (pts.length - 1), i = Math.min(Math.floor(f), pts.length - 2), t = f - i;
    var p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
    var t2 = t * t, t3 = t2 * t;
    out.push([0, 1, 2].map(function (d) {
      return 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3);
    }));
  }
  return out;
}

// 掃掠：沿曲線拉出扁平的橢圓斷面（髮束、衣領、繩子）。outward(p) 給「表面朝外」的方向，決定斷面的寬邊
function strand(ctrl, width, thick, outward, opts) {
  opts = opts || {};
  var n = opts.samples || 18, ring = opts.ring || 8;
  var pts = spline(ctrl, n);
  var pos = [], uv = [], idx = [], centers = [];
  for (var k = 0; k <= n; k++) {
    var t = k / n, p = pts[k];
    var T = norm(sub(pts[Math.min(k + 1, n)], pts[Math.max(k - 1, 0)]));
    var O = outward(p, t);
    var Wd = norm(cross(O, T));
    var N = norm(cross(T, Wd));
    var w = typeof width === "function" ? width(t) : width, h = typeof thick === "function" ? thick(t) : thick;
    for (var j = 0; j <= ring; j++) {
      var a = (j / ring) * Math.PI * 2;
      pos.push(add(p, add(mul(Wd, Math.cos(a) * w / 2), mul(N, Math.sin(a) * h / 2))));
      uv.push([j / ring, t]);
      centers.push(p);
    }
  }
  for (k = 0; k < n; k++) for (j = 0; j < ring; j++) {
    var a0 = k * (ring + 1) + j, a1 = a0 + 1, b0 = a0 + ring + 1, b1 = b0 + 1;
    idx.push(a0, a1, b0, a1, b1, b0);
  }
  var g = { pos: pos, uv: uv, idx: idx };
  // 依斷面中心判斷正反（每條掃掠只看第一個三角形）
  var A = pos[idx[0]], B = pos[idx[1]], C = pos[idx[2]];
  if (dot(cross(sub(B, A), sub(C, A)), sub(A, centers[idx[0]])) < 0) g.idx = flip(g.idx);
  return g;
}

// 貼在表面上的面片（眼睛、嘴巴）：x、y 的格子，z 由 zAt(x, y) 給
function patch(x0, x1, y0, y1, nx, ny, zAt, mirrorU) {
  var pos = [], uv = [], idx = [];
  for (var j = 0; j <= ny; j++) for (var i = 0; i <= nx; i++) {
    var x = x0 + (x1 - x0) * (i / nx), y = y1 - (y1 - y0) * (j / ny);
    pos.push([x, y, zAt(x, y)]);
    uv.push([mirrorU ? 1 - i / nx : i / nx, j / ny]);
  }
  for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
    var a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b, b, c, d); // 面向 +Z
  }
  return { pos: pos, uv: uv, idx: idx };
}

function flip(idx) {
  var out = [];
  for (var i = 0; i < idx.length; i += 3) out.push(idx[i], idx[i + 2], idx[i + 1]);
  return out;
}

// 封閉、大致凸的形狀：以中心判斷正反
function orient(g, c) {
  var score = 0;
  for (var i = 0; i < g.idx.length; i += 3) {
    var A = g.pos[g.idx[i]], B = g.pos[g.idx[i + 1]], C = g.pos[g.idx[i + 2]];
    score += dot(cross(sub(B, A), sub(C, A)), sub(A, c)) > 0 ? 1 : -1;
  }
  if (score < 0) g.idx = flip(g.idx);
  return g;
}

function mapPos(g, fn) { g.pos = g.pos.map(fn); return g; }
function scaleZ(g, k) { return mapPos(g, function (p) { return [p[0], p[1], p[2] * k]; }); }

// 只留下所有頂點都符合條件的三角形（並重新編號）
function keepTris(g, pred) {
  var map = {}, pos = [], uv = [], idx = [];
  for (var i = 0; i < g.idx.length; i += 3) {
    var tri = [g.idx[i], g.idx[i + 1], g.idx[i + 2]];
    if (!tri.every(function (k) { return pred(g.pos[k]); })) continue;
    tri.forEach(function (k) {
      if (map[k] == null) { map[k] = pos.length; pos.push(g.pos[k]); uv.push(g.uv[k]); }
      idx.push(map[k]);
    });
  }
  return { pos: pos, uv: uv, idx: idx };
}

function normals(pos, idx) {
  var n = pos.map(function () { return [0, 0, 0]; });
  for (var i = 0; i < idx.length; i += 3) {
    var f = cross(sub(pos[idx[i + 1]], pos[idx[i]]), sub(pos[idx[i + 2]], pos[idx[i]]));
    for (var k = 0; k < 3; k++) { var m = n[idx[i + k]]; m[0] += f[0]; m[1] += f[1]; m[2] += f[2]; }
  }
  // 旋轉體接縫上的重複頂點合併法線，避免亮線
  var key = {};
  pos.forEach(function (p, i) { var k = p.map(function (v) { return v.toFixed(5); }).join(","); (key[k] = key[k] || []).push(i); });
  Object.keys(key).forEach(function (k) {
    var g = key[k];
    if (g.length < 2) return;
    var s = [0, 0, 0];
    g.forEach(function (i) { s = add(s, n[i]); });
    g.forEach(function (i) { n[i] = s.slice(); });
  });
  return n.map(norm);
}

// ---------------------------------------------------------------- 頭（雕塑過的臉型）
var HEAD_C = [0, 1.252, 0];
var HEAD_R = [0.150, 0.163, 0.148];
function sculptHead(u, R, C) {
  var x = u[0] * R[0], y = u[1] * R[1], z = u[2] * R[2];
  if (u[1] < 0.15) {
    // 下半臉往下巴收窄：兩頰到下巴是順的 V 字，不是圓球
    var t = Math.min(1, (0.15 - u[1]) / 1.15);
    x *= 1 - 0.40 * Math.pow(t, 1.5);
    z *= u[2] > 0 ? 1 - 0.16 * Math.pow(t, 1.3) : 1 - 0.35 * t;
  }
  if (u[2] > 0) z *= 0.94; // 臉的正面稍平
  if (u[2] < 0 && u[1] > -0.3) z *= 1.07; // 後腦勺飽滿
  if (u[1] < -0.8) y -= 0.006 * (-0.8 - u[1]) / 0.2; // 下巴微尖
  if (u[2] > 0) z += 0.0065 * Math.exp(-(Math.pow(x / 0.010, 2) + Math.pow((y + 0.052) / 0.020, 2))); // 小鼻樑
  return [C[0] + x, C[1] + y, C[2] + z];
}
function headGeom(seg, rings) {
  var g = lathe(sphereProfile(rings), seg);
  return mapPos(g, function (p) { return sculptHead(p, HEAD_R, HEAD_C); });
}
var HEAD = headGeom(56, 40);

// 由正面往 -Z 射線打到頭部表面的 z（放五官、瀏海用）。
// 打在輪廓邊緣外（沒打到）時往中線靠一點再打，避免回傳 -1 拉出一根長刺
function surfaceZ(x, y) {
  for (var k = 0; k < 20; k++) {
    var z = surfaceZRaw(x * Math.pow(0.97, k), y);
    if (z > -1) return z;
  }
  return 0;
}
function surfaceZRaw(x, y) {
  var best = -1;
  var P = HEAD.pos, I = HEAD.idx;
  for (var i = 0; i < I.length; i += 3) {
    var a = P[I[i]], b = P[I[i + 1]], c = P[I[i + 2]];
    if (a[2] < 0 && b[2] < 0 && c[2] < 0) continue;
    var d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-12) continue;
    var l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
    var l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
    var l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    var z = l1 * a[2] + l2 * b[2] + l3 * c[2];
    if (z > best) best = z;
  }
  return best;
}

// ---------------------------------------------------------------- 骨架（T-pose，面向 +Z，角色左手 = +X）
var SLEEVE_X = [0.17, 0.27, 0.37];
var BONES = [
  ["hips", null, [0, 0.72, 0]],
  ["spine", "hips", [0, 0.80, 0]],
  ["chest", "spine", [0, 0.94, 0]],
  ["neck", "chest", [0, 1.06, 0]],
  ["head", "neck", [0, 1.12, 0]],
  ["leftUpperArm", "chest", [0.10, 1.03, 0]],
  ["leftLowerArm", "leftUpperArm", [0.29, 1.03, 0]],
  ["leftHand", "leftLowerArm", [0.46, 1.03, 0]],
  ["rightUpperArm", "chest", [-0.10, 1.03, 0]],
  ["rightLowerArm", "rightUpperArm", [-0.29, 1.03, 0]],
  ["rightHand", "rightLowerArm", [-0.46, 1.03, 0]],
  ["leftUpperLeg", "hips", [0.075, 0.69, 0]],
  ["leftLowerLeg", "leftUpperLeg", [0.075, 0.39, 0]],
  ["leftFoot", "leftLowerLeg", [0.075, 0.07, 0]],
  ["rightUpperLeg", "hips", [-0.075, 0.69, 0]],
  ["rightLowerLeg", "rightUpperLeg", [-0.075, 0.39, 0]],
  ["rightFoot", "rightLowerLeg", [-0.075, 0.07, 0]],
  // 馬尾（髮結在後頸）
  ["hair1", "head", [0, 1.13, -0.15]],
  ["hair2", "hair1", [0, 1.02, -0.165]],
  ["hair3", "hair2", [0, 0.91, -0.17]],
  ["hair4", "hair3", [0, 0.80, -0.165]],
];
var HUMAN_COUNT = 17;
// 大袖：每側 3 條鏈（a＝袖子上緣的支點、b、c＝尾端）
[1, -1].forEach(function (sx) {
  var side = sx > 0 ? "left" : "right";
  SLEEVE_X.forEach(function (x, k) {
    var parent = side + (x < 0.29 ? "UpperArm" : "LowerArm");
    BONES.push([side + "Sleeve" + k + "a", parent, [x * sx, 1.02, 0]]);
    BONES.push([side + "Sleeve" + k + "b", side + "Sleeve" + k + "a", [x * sx, 0.93, 0]]);
    BONES.push([side + "Sleeve" + k + "c", side + "Sleeve" + k + "b", [x * sx, 0.85, 0]]);
  });
});
var HUMAN = BONES.slice(0, HUMAN_COUNT).map(function (b) { return b[0]; });
var BI = {};
BONES.forEach(function (b, i) { BI[b[0]] = i; });

// ---------------------------------------------------------------- 角色與材質
var SAYO = {
  name: "Sayo (Ennichi miko, procedural sample v2)",
  skin: "#ffe9e0", skinShade: "#f4d0c6", // 陰影色太飽和時，夜景大半在陰影裡，整張臉會變橘紅
  hair: "#231c2b", hairShade: "#0f0a16",
  iris: ["#3a0a14", "#9a2234", "#e86a80"],
};

// ---------------------------------------------------------------- 貼圖（SVG）
function faceSvg(c) {
  // 臉部貼圖：x∈[-0.16, 0.16]、y∈[1.06, 1.38] 投影到 512×512（u 往 +x、v 往下）
  return '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">' +
    '<defs><radialGradient id="b"><stop offset="0" stop-color="#ff8f98" stop-opacity=".5"/><stop offset="1" stop-color="#ff8f98" stop-opacity="0"/></radialGradient></defs>' +
    '<rect width="512" height="512" fill="' + c.skin + '"/>' +
    '<ellipse cx="378" cy="300" rx="50" ry="26" fill="url(#b)"/><ellipse cx="134" cy="300" rx="50" ry="26" fill="url(#b)"/>' +
    '<path d="M302,142 Q340,124 380,136" fill="none" stroke="' + c.hair + '" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M210,142 Q172,124 132,136" fill="none" stroke="' + c.hair + '" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M254,284 Q258,292 254,296" fill="none" stroke="#d99a8a" stroke-width="3" stroke-linecap="round"/>' +
    "</svg>";
}
function eyeSvg(c) {
  // 左眼（+x）：外眼角在右。面片寬 0.052 → 256px；眼睛約 0.040 × 0.021
  var almond = "M34,140 C46,92 104,72 150,74 C186,76 214,92 228,112 C232,120 230,130 226,136 C200,176 90,186 34,140 Z";
  return '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">' +
    "<defs>" +
    '<linearGradient id="i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c.iris[0] + '"/><stop offset=".55" stop-color="' + c.iris[1] + '"/><stop offset="1" stop-color="' + c.iris[2] + '"/></linearGradient>' +
    '<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2030" stop-opacity=".45"/><stop offset=".35" stop-color="#3a2030" stop-opacity="0"/></linearGradient>' +
    '<clipPath id="a"><path d="' + almond + '"/></clipPath>' +
    "</defs>" +
    '<path d="' + almond + '" fill="#fbf8f8"/>' +
    '<g clip-path="url(#a)">' +
    '<ellipse cx="130" cy="126" rx="42" ry="50" fill="url(#i)" stroke="#2a0810" stroke-width="2.5"/>' +
    '<ellipse cx="130" cy="132" rx="18" ry="24" fill="#1a0810"/>' +
    '<rect x="0" y="60" width="256" height="130" fill="url(#s)"/>' +
    '<circle cx="113" cy="104" r="10" fill="#fff"/><circle cx="148" cy="150" r="5" fill="#fff" opacity=".8"/>' +
    "</g>" +
    '<path d="M70,64 C110,46 176,50 214,76" fill="none" stroke="#b47f7f" stroke-width="3" stroke-linecap="round" opacity=".55"/>' +
    '<path d="M84,172 C122,182 176,176 214,150" fill="none" stroke="#6a3a44" stroke-width="3" stroke-linecap="round" opacity=".6"/>' +
    "</svg>";
}
// 眼皮：上睫毛以上是皮膚色、以下透明。面片比眼睛面片高 LID_UP（= 46px），同一個世界座標在眼皮貼圖上是眼睛貼圖的 y + 46
// 睜眼時睫毛剛好落在眼眶上緣；眨眼時整片往下滑，睫毛就變成閉眼的線
function lidSvg(c) {
  var lash = "M30,188 C44,138 104,116 150,118 C188,120 216,138 230,158 L244,148";
  return '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">' +
    '<path d="M0,0 L256,0 L256,152 L244,148 L230,158 C216,138 188,120 150,118 C104,116 44,138 30,188 L0,194 Z" fill="' + c.skin + '"/>' +
    '<path d="' + lash + '" fill="none" stroke="#24141c" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M222,150 L246,142 L236,160 Z" fill="#2b1a24"/>' +
    "</svg>";
}
// 眼睛面片的半寬（樣本調整：遠景也要看得到眼睛，但不要動畫式特大）。其餘五官尺寸都依它等比
var EYE_H = 0.031, EYE_X = 0.049, EYE_Y = 1.238;
var EK = EYE_H / 0.028;
var LID_UP = EYE_H * 0.357; // = 貼圖上 46px

function mouthSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">' +
    '<path d="M78,122 Q128,146 178,122 Q128,136 78,122 Z" fill="#b83a4c"/>' +
    '<path d="M78,122 Q128,146 178,122" fill="none" stroke="#7a2030" stroke-width="5" stroke-linecap="round"/>' +
    "</svg>";
}

async function rasterize(svgs) {
  var browser = await chromium.launch();
  var out = {};
  for (var key in svgs) {
    var m = /width="(\d+)"/.exec(svgs[key]);
    var size = +m[1];
    var page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent('<html><body style="margin:0;background:transparent">' + svgs[key] + "</body></html>");
    out[key] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
  }
  await browser.close();
  return out;
}

// ---------------------------------------------------------------- 蒙皮權重
function rigid(bone) { return function () { return [[bone, 1]]; }; }
// 馬尾：依高度在 hair1〜hair4 之間線性混合，彈簧骨轉動時才會順著彎
function ponytailWeights(p) {
  var ys = [1.13, 1.02, 0.91, 0.80], names = ["hair1", "hair2", "hair3", "hair4"];
  if (p[1] >= ys[0]) return [["hair1", 1]];
  for (var i = 0; i < 3; i++) {
    if (p[1] >= ys[i + 1]) { var t = (ys[i] - p[1]) / (ys[i] - ys[i + 1]); return [[names[i], 1 - t], [names[i + 1], t]]; }
  }
  return [["hair3", 1]];
}
// 大袖：上緣跟著手臂，往下依序交給彈簧骨鏈 a → b
function sleeveWeights(side) {
  return function (p) {
    var ax = Math.abs(p[0]), k = 0, best = 9;
    SLEEVE_X.forEach(function (x, i) { if (Math.abs(ax - x) < best) { best = Math.abs(ax - x); k = i; } });
    var arm = side + (ax < 0.29 ? "UpperArm" : "LowerArm");
    var a = side + "Sleeve" + k + "a", b = side + "Sleeve" + k + "b";
    if (p[1] >= 1.0) return [[arm, 1]];
    if (p[1] >= 0.93) { var t = (1.0 - p[1]) / 0.07; return [[arm, 1 - t], [a, t]]; }
    var t2 = Math.min(1, (0.93 - p[1]) / 0.08);
    return [[a, 1 - t2], [b, t2]];
  };
}
function torsoWeights(p) {
  var t = smooth(0.86, 0.92, p[1]);
  return [["spine", 1 - t], ["chest", t]];
}

// ---------------------------------------------------------------- 零件
var TORSO_PROFILE = [[0, 0.80], [0.104, 0.80], [0.106, 0.86], [0.118, 0.93], [0.124, 0.98], [0.118, 1.03], [0.09, 1.065], [0.05, 1.085], [0, 1.09]];
var TORSO_Z = 0.74;
function torsoR(y) {
  for (var i = 0; i < TORSO_PROFILE.length - 1; i++) {
    var a = TORSO_PROFILE[i], b = TORSO_PROFILE[i + 1];
    if (y >= a[1] && y <= b[1]) return a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
  }
  return 0;
}
function torsoZ(x, y) { var r = torsoR(y); return TORSO_Z * Math.sqrt(Math.max(0, r * r - x * x)); }
function outFromAxis(p) { return norm([p[0], 0, p[2] / (TORSO_Z * TORSO_Z)]); }

function parts(c) {
  var P = [];
  function put(mesh, mat, g, weights, role) { P.push({ mesh: mesh, mat: mat, g: g, weights: typeof weights === "string" ? rigid(weights) : weights, role: role || mat }); }

  // --- 頭：臉（有貼圖）與其餘皮膚分開
  var FACE_BOX = { x0: -0.16, x1: 0.16, y0: 1.06, y1: 1.38 };
  var head = { pos: HEAD.pos, uv: HEAD.pos.map(function (p) { return [(p[0] - FACE_BOX.x0) / (FACE_BOX.x1 - FACE_BOX.x0), (FACE_BOX.y1 - p[1]) / (FACE_BOX.y1 - FACE_BOX.y0)]; }), idx: HEAD.idx };
  function isFace(p) { return p[2] > 0.035 && p[1] > 1.07 && p[1] < 1.37 && Math.abs(p[0]) < 0.14; }
  put("body", "face", keepTris(head, isFace), "head");
  // 非臉部的三角形：至少一個頂點不在臉部範圍
  var rest = { pos: head.pos, uv: head.uv, idx: [] };
  for (var i = 0; i < head.idx.length; i += 3) {
    var tri = [head.idx[i], head.idx[i + 1], head.idx[i + 2]];
    if (!tri.every(function (k) { return isFace(head.pos[k]); })) rest.idx.push(tri[0], tri[1], tri[2]);
  }
  put("body", "skin", keepTris(rest, function () { return true; }), "head");
  [1, -1].forEach(function (sx) { put("body", "skin", ellipsoid([0.141 * sx, 1.228, -0.008], [0.01, 0.022, 0.015], 12, 8), "head"); });
  put("body", "skin", lathe([[0, 1.05], [0.036, 1.05], [0.034, 1.13], [0, 1.13]], 16), "neck");

  // --- 五官面片（Face 網格，有 morph）
  [1, -1].forEach(function (sx) {
    var cx = EYE_X * sx, cy = EYE_Y, h = EYE_H;
    put("face", "eye", patch(cx - h, cx + h, cy - h, cy + h, 16, 16, function (x, y) { return surfaceZ(x, y) + 0.0012; }, sx < 0), "head", "eye");
    put("face", "lid", patch(cx - h, cx + h, cy - h + LID_UP, cy + h + LID_UP, 16, 16, function (x, y) { return surfaceZ(x, y) + 0.0019; }, sx < 0), "head", "lid");
  });
  put("face", "mouth", patch(-0.022, 0.022, 1.128, 1.172, 12, 12, function (x, y) { return surfaceZ(x, y) + 0.0012; }), "head", "mouth");

  // --- 頭髮
  var HC = [0, 1.268, -0.008], HR = [0.160, 0.163, 0.160];
  var cap = mapPos(lathe(sphereProfile(36), 48), function (u) { return sculptHead(u, HR, HC); });
  put("body", "hair", keepTris(cap, function (p) { return (p[1] > 1.335 || p[2] < 0.03) && p[1] > 1.10; }), "head");
  var capOut = function (p) { return norm(sub(p, HC)); };
  // 瀏海：一束一束，尾端收尖；兩側的比較長，框住臉
  var BANGS = [[-0.125, 1.235], [-0.1, 1.275], [-0.075, 1.29], [-0.05, 1.30], [-0.025, 1.288], [0, 1.302], [0.025, 1.29], [0.05, 1.298], [0.075, 1.286], [0.1, 1.272], [0.125, 1.232]];
  BANGS.forEach(function (b) {
    var x0 = b[0], ty = b[1];
    var root = [x0 * 0.8, 1.405, surfaceZ(x0 * 0.8, 1.38) - 0.004];
    var mid = [x0, 1.345, surfaceZ(x0, 1.345) + 0.013];
    var tip = [x0 * 1.06, ty, surfaceZ(x0 * 1.06, ty) + 0.007];
    put("body", "hair", strand([root, mid, tip], function (t) { return 0.05 * Math.pow(1 - t, 0.7) + 0.003; }, function (t) { return 0.008 * (1 - t) + 0.002; }, capOut), "head");
  });
  // 側髮（耳前）
  [1, -1].forEach(function (sx) {
    put("body", "hair", strand([[0.118 * sx, 1.35, 0.06], [0.142 * sx, 1.25, 0.07], [0.138 * sx, 1.14, 0.068], [0.122 * sx, 1.05, 0.055]],
      function (t) { return 0.05 * Math.pow(1 - t, 0.6) + 0.005; }, 0.01, capOut), "head");
  });
  // 後髮：從頭頂往後頸的髮束，蓋住後腦與髮結
  for (var k = -3; k <= 3; k++) {
    var bx = k * 0.04;
    put("body", "hair", strand([[bx * 0.8, 1.40, -0.06], [bx, 1.33, -0.16], [bx * 1.05, 1.22, -0.172], [bx * 0.6, 1.12, -0.158]],
      function (t) { return 0.06 * (1 - t * 0.6); }, 0.014, capOut, { samples: 14 }), "head");
  }
  // 馬尾
  [-0.03, -0.012, 0.006, 0.024, 0.04].forEach(function (dx, n) {
    var z0 = -0.152 - (n % 2) * 0.006;
    put("body", "hair", strand([[dx * 0.5, 1.135, z0], [dx * 1.5, 1.04, z0 - 0.014], [dx * 1.3, 0.94, z0 - 0.02], [dx * 0.6, 0.80, z0 - 0.014]],
      function (t) { return 0.05 * Math.pow(1 - t, 0.5) + 0.004; }, 0.014, function () { return [0, 0, -1]; }, { samples: 20 }), ponytailWeights);
  });
  // 髮結：白色丈長（紙）＋紅色水引
  put("body", "white", superEllipsoid([0, 1.13, -0.166], [0.044, 0.02, 0.012], 0.5, 0.5, 10, 16), "hair1");
  put("body", "red", strand([[-0.046, 1.136, -0.17], [0, 1.128, -0.181], [0.046, 1.136, -0.17]], 0.006, 0.006, function () { return [0, 0, -1]; }, { samples: 10, ring: 6 }), "hair1");
  put("body", "red", strand([[-0.046, 1.124, -0.17], [0, 1.132, -0.181], [0.046, 1.124, -0.17]], 0.006, 0.006, function () { return [0, 0, -1]; }, { samples: 10, ring: 6 }), "hair1");

  // --- 白衣（小袖）＋交領
  put("body", "white", scaleZ(lathe(TORSO_PROFILE, 32), TORSO_Z), torsoWeights);
  function collar(sx, inset, zOff, w, mat) {
    // 從後頸繞到胸前、往另一側的腰斜下（sx = 起點那一側）
    var pts = [[0.052 * sx - inset * sx, 1.08, -0.025], [0.056 * sx - inset * sx, 1.062, 0.04]];
    [[0.026, 1.01], [-0.004, 0.96], [-0.036, 0.91], [-0.06, 0.87]].forEach(function (q) {
      var x = q[0] * sx - inset * sx;
      pts.push([x, q[1], torsoZ(x, q[1]) + zOff]);
    });
    put("body", mat, strand(pts, w, 0.006, outFromAxis, { samples: 20, ring: 6 }), torsoWeights);
  }
  collar(1, 0.012, 0.004, 0.012, "accent"); // 紅色襦袢領（內側）
  collar(-1, 0.012, 0.002, 0.012, "accent");
  collar(-1, 0, 0.005, 0.024, "white"); // 右前身（下）
  collar(1, 0, 0.008, 0.024, "white"); // 左前身（上）：左衽在上

  // --- 緋袴：打褶的旋轉體；前面褶深、後面淺
  var HAKAMA = [[0, 0.075], [0.24, 0.075], [0.238, 0.11], [0.20, 0.40], [0.16, 0.66], [0.135, 0.80], [0.122, 0.875], [0, 0.875]];
  put("body", "red", scaleZ(lathe(HAKAMA, 96, function (a, y) {
    var depth = 0.032 * (1 - (y - 0.075) / 0.8) + 0.006;
    var front = Math.cos(a) > 0 ? 1 : 0.45;
    return 1 + depth * front * Math.abs(Math.sin(a * 5));
  }), 0.8), "hips");
  // 腰紐（繞一圈）＋前結（兩個圈、兩條垂帶）＋腰板
  var ring = [];
  for (var a = 0; a <= 24; a++) {
    var th = (a / 24) * Math.PI * 2;
    ring.push([0.126 * Math.sin(th), 0.858, 0.126 * Math.cos(th) * 0.8 + 0.002]);
  }
  put("body", "red", strand(ring, 0.022, 0.008, function (p) { return norm([p[0], 0, p[2]]); }, { samples: 48, ring: 6 }), "hips");
  [1, -1].forEach(function (sx) {
    put("body", "red", strand([[0, 0.858, 0.106], [0.03 * sx, 0.874, 0.118], [0.055 * sx, 0.86, 0.12], [0.03 * sx, 0.846, 0.118], [0, 0.858, 0.108]],
      0.016, 0.006, function () { return [0, 0, 1]; }, { samples: 16, ring: 6 }), "hips");
    put("body", "red", strand([[0.006 * sx, 0.852, 0.112], [0.018 * sx, 0.80, 0.118], [0.024 * sx, 0.74, 0.124]],
      function (t) { return 0.016 - t * 0.004; }, 0.005, function () { return [0, 0, 1]; }, { samples: 10, ring: 6 }), "hips");
  });
  put("body", "red", superEllipsoid([0, 0.88, -0.098], [0.075, 0.035, 0.012], 0.3, 0.3, 10, 16), "hips");

  // --- 手臂（多半藏在袖子裡）、手、大袖、袖括紐
  [1, -1].forEach(function (sx) {
    var side = sx > 0 ? "left" : "right";
    put("body", "white", lathe([[0, 0], [0.048, 0], [0.044, 1], [0, 1]], 14), rigid(side + "UpperArm"));
    P[P.length - 1].g = mapPos(P[P.length - 1].g, function (p) { return [(0.10 + 0.19 * p[1]) * sx, 1.03 + p[0], p[2]]; });
    orient(P[P.length - 1].g, [0.2 * sx, 1.03, 0]);
    put("body", "white", lathe([[0, 0], [0.044, 0], [0.04, 1], [0, 1]], 14), rigid(side + "LowerArm"));
    P[P.length - 1].g = mapPos(P[P.length - 1].g, function (p) { return [(0.28 + 0.17 * p[1]) * sx, 1.03 + p[0], p[2]]; });
    orient(P[P.length - 1].g, [0.36 * sx, 1.03, 0]);
    put("body", "skin", ellipsoid([0.488 * sx, 1.028, 0.002], [0.042, 0.022, 0.034], 14, 10), side + "Hand");
    put("body", "skin", ellipsoid([0.468 * sx, 1.032, 0.034], [0.018, 0.012, 0.014], 10, 6), side + "Hand");
    put("body", "white", superEllipsoid([0.27 * sx, 0.965, 0], [0.135, 0.12, 0.05], 0.3, 0.5, 18, 28), sleeveWeights(side));
    put("body", "red", strand([[0.145 * sx, 0.852, 0.05], [0.27 * sx, 0.848, 0.054], [0.395 * sx, 0.852, 0.05]], 0.008, 0.006, function () { return [0, -1, 0]; }, { samples: 12, ring: 6 }), sleeveWeights(side));
    // 白足袋＋草履（鼻緒是紅色）
    put("body", "white", ellipsoid([0.075 * sx, 0.05, 0.028], [0.042, 0.04, 0.078]), side + "Foot");
    put("body", "sole", superEllipsoid([0.075 * sx, 0.012, 0.03], [0.05, 0.011, 0.098], 0.4, 0.4, 8, 16), side + "Foot");
    put("body", "accent", strand([[0.05 * sx, 0.03, 0.03], [0.075 * sx, 0.07, 0.09], [0.1 * sx, 0.03, 0.03]], 0.008, 0.006, function () { return [0, 1, 0]; }, { samples: 10, ring: 6 }), side + "Foot");
  });
  return P;
}

// 五官的 morph：把面片壓成一條線（閉眼）、往上彎（笑眼）、嘴巴拉開
var MORPHS = ["blink", "aa", "happy"];
function morphTargets(part, p) {
  var out = { blink: [0, 0, 0], aa: [0, 0, 0], happy: [0, 0, 0] };
  function moveTo(x, y, lift) { return [x - p[0], y - p[1], surfaceZ(x, y) + (lift || 0.0012) - p[2]]; }
  var cx = p[0] > 0 ? EYE_X : -EYE_X, cy = EYE_Y, dx = (p[0] - cx) / EYE_H;
  if (part.role === "lid") {
    // 眼皮往下滑：中央多滑一點（閉眼的線比睜眼的弧平）；笑眼是兩端多滑（變成 ^）
    out.blink = moveTo(p[0], p[1] - EK * (0.0135 + 0.012 * (1 - dx * dx)), 0.0019);
    out.happy = moveTo(p[0], p[1] - EK * (0.008 + 0.010 * dx * dx), 0.0019);
  } else if (part.role === "eye") {
    // 眼睛壓扁到眼皮後面（被皮膚色蓋住）
    out.blink = moveTo(p[0], cy + (p[1] - cy) * 0.05);
    out.happy = moveTo(p[0], cy + 0.006 * EK + (p[1] - cy) * 0.05);
  } else if (part.role === "mouth") {
    var my = 1.15, mdx = p[0] / 0.022;
    out.aa = moveTo(p[0] * 0.85, my + (p[1] - my) * 5);
    out.happy = moveTo(p[0] * 1.25, p[1] + 0.002 * mdx * mdx);
  }
  return out;
}

// ---------------------------------------------------------------- glTF 寫出
function GltfWriter() {
  this.json = { asset: { version: "2.0", generator: "PriTest ennichi build_vrm.js" }, buffers: [], bufferViews: [], accessors: [] };
  this.chunks = [];
  this.byteLength = 0;
}
GltfWriter.prototype.view = function (buf, target) {
  var pad = (4 - (this.byteLength % 4)) % 4;
  if (pad) { this.chunks.push(Buffer.alloc(pad)); this.byteLength += pad; }
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  var v = { buffer: 0, byteOffset: this.byteLength, byteLength: buf.length };
  if (target) v.target = target;
  this.chunks.push(buf);
  this.byteLength += buf.length;
  this.json.bufferViews.push(v);
  return this.json.bufferViews.length - 1;
};
GltfWriter.prototype.accessor = function (typed, type, componentType, count, target, minmax) {
  var a = { bufferView: this.view(typed, target), componentType: componentType, count: count, type: type };
  if (minmax) {
    var n = type === "VEC3" ? 3 : 1, mn = [], mx = [];
    for (var k = 0; k < n; k++) { mn.push(Infinity); mx.push(-Infinity); }
    for (var i = 0; i < count; i++) for (k = 0; k < n; k++) {
      var v = typed[i * n + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
    a.min = mn; a.max = mx;
  }
  this.json.accessors.push(a);
  return this.json.accessors.length - 1;
};
GltfWriter.prototype.glb = function () {
  var bin = Buffer.concat(this.chunks);
  var binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  this.json.buffers = [{ byteLength: binPad.length }];
  var js = Buffer.from(JSON.stringify(this.json), "utf8");
  var jsPad = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  var total = 12 + 8 + jsPad.length + 8 + binPad.length;
  var head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  function chunkHead(len, type) { var b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; }
  return Buffer.concat([head, chunkHead(jsPad.length, 0x4e4f534a), jsPad, chunkHead(binPad.length, 0x004e4942), binPad]);
};

function mtoon(opts) {
  return {
    specVersion: "1.0",
    transparentWithZWrite: false,
    renderQueueOffsetNumber: 0,
    shadeColorFactor: opts.shade,
    shadingShiftFactor: opts.shift != null ? opts.shift : -0.05,
    shadingToonyFactor: 0.9,
    giEqualizationFactor: 0.9,
    matcapFactor: [0, 0, 0],
    parametricRimColorFactor: opts.rim || [0, 0, 0],
    parametricRimFresnelPowerFactor: 4,
    parametricRimLiftFactor: 0,
    rimLightingMixFactor: 1,
    outlineWidthMode: opts.outline ? "worldCoordinates" : "none",
    outlineWidthFactor: opts.outline || 0,
    outlineColorFactor: lin("#2a1c26"),
    outlineLightingMixFactor: 0.6,
  };
}

async function build(id, c) {
  var W = new GltfWriter();
  var J = W.json;
  var png = await rasterize({ face: faceSvg(c), eye: eyeSvg(c), mouth: mouthSvg(), lid: lidSvg(c) });
  J.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
  J.images = [];
  J.textures = [];
  ["face", "eye", "mouth", "lid"].forEach(function (k) {
    J.images.push({ name: k, mimeType: "image/png", bufferView: W.view(png[k]) });
    J.textures.push({ sampler: 0, source: J.images.length - 1 });
  });

  var skin = lin(c.skin), skinShade = lin(c.skinShade);
  var MATS = {
    skin: { color: skin, ext: mtoon({ shade: skinShade, outline: 0.0025 }) },
    face: { color: [1, 1, 1], tex: 0, ext: mtoon({ shade: skinShade.map(function (v, i) { return v / skin[i]; }), outline: 0.0025 }) },
    eye: { color: [1, 1, 1], tex: 1, mask: true, ext: mtoon({ shade: [0.88, 0.86, 0.9], shift: -0.4 }) },
    mouth: { color: [1, 1, 1], tex: 2, mask: true, ext: mtoon({ shade: [0.9, 0.85, 0.85], shift: -0.4 }) },
    lid: { color: [1, 1, 1], tex: 3, mask: true, ext: mtoon({ shade: skinShade.map(function (v, i) { return v / skin[i]; }) }) },
    hair: { color: lin(c.hair), ext: mtoon({ shade: lin(c.hairShade), outline: 0.003, rim: [0.25, 0.22, 0.35] }) },
    white: { color: lin("#fbfaf8"), ext: mtoon({ shade: lin("#c3c5dc"), outline: 0.003, rim: [0.2, 0.2, 0.25] }) },
    red: { color: lin("#d22a3c"), ext: mtoon({ shade: lin("#801425"), outline: 0.003, rim: [0.2, 0.1, 0.12] }) },
    accent: { color: lin("#e0303f"), ext: mtoon({ shade: lin("#8a1626"), outline: 0.002 }) },
    sole: { color: lin("#9a7450"), ext: mtoon({ shade: lin("#5a4028"), outline: 0.002 }) },
  };
  var matNames = Object.keys(MATS);
  J.materials = matNames.map(function (m) {
    var d = MATS[m];
    var mat = { name: m, pbrMetallicRoughness: { baseColorFactor: d.color.concat(1), metallicFactor: 0, roughnessFactor: 1 }, extensions: { VRMC_materials_mtoon: d.ext } };
    if (d.tex != null) {
      mat.pbrMetallicRoughness.baseColorTexture = { index: d.tex };
      d.ext.shadeMultiplyTexture = { index: d.tex };
    }
    if (d.mask) { mat.alphaMode = "MASK"; mat.alphaCutoff = 0.5; }
    return mat;
  });

  // 節點：0 = 根，1.. = 骨，最後兩個 = Body／Face 網格
  J.nodes = [{ name: "Root", children: [] }];
  BONES.forEach(function (b) {
    var p = b[2], parent = b[1] ? BONES[BI[b[1]]][2] : [0, 0, 0];
    J.nodes.push({ name: b[0], translation: sub(p, parent) });
  });
  BONES.forEach(function (b, i) {
    if (b[1]) { var par = J.nodes[BI[b[1]] + 1]; (par.children = par.children || []).push(i + 1); }
    else J.nodes[0].children.push(i + 1);
  });
  var ibm = new Float32Array(BONES.length * 16);
  BONES.forEach(function (b, i) {
    var o = i * 16;
    ibm[o] = ibm[o + 5] = ibm[o + 10] = ibm[o + 15] = 1;
    ibm[o + 12] = -b[2][0]; ibm[o + 13] = -b[2][1]; ibm[o + 14] = -b[2][2];
  });
  J.skins = [{ inverseBindMatrices: W.accessor(ibm, "MAT4", 5126, BONES.length), joints: BONES.map(function (b, i) { return i + 1; }), skeleton: 1 }];

  var all = parts(c);
  J.meshes = [];
  var totalVerts = 0;
  ["body", "face"].forEach(function (meshName) {
    var prims = [];
    matNames.forEach(function (m, mi) {
      var ps = all.filter(function (p) { return p.mesh === meshName && p.mat === m; });
      if (!ps.length) return;
      var pos = [], nrm = [], uvs = [], jw = [], idx = [], morph = MORPHS.map(function () { return []; });
      ps.forEach(function (p) {
        var base = pos.length;
        var n = normals(p.g.pos, p.g.idx);
        p.g.pos.forEach(function (v, i) {
          pos.push(v); nrm.push(n[i]); uvs.push(p.g.uv[i]); jw.push(p.weights(v));
          if (meshName === "face") {
            var d = morphTargets(p, v);
            MORPHS.forEach(function (name, k) { morph[k].push(d[name]); });
          }
        });
        p.g.idx.forEach(function (i) { idx.push(base + i); });
      });
      var count = pos.length;
      totalVerts += count;
      var fPos = new Float32Array(count * 3), fNrm = new Float32Array(count * 3), fUv = new Float32Array(count * 2);
      var uJ = new Uint8Array(count * 4), fW = new Float32Array(count * 4);
      for (var i = 0; i < count; i++) {
        fPos.set(pos[i], i * 3); fNrm.set(nrm[i], i * 3); fUv.set(uvs[i], i * 2);
        jw[i].slice(0, 4).forEach(function (pair, k) { uJ[i * 4 + k] = BI[pair[0]]; fW[i * 4 + k] = pair[1]; });
      }
      var prim = {
        attributes: {
          POSITION: W.accessor(fPos, "VEC3", 5126, count, 34962, true),
          NORMAL: W.accessor(fNrm, "VEC3", 5126, count, 34962),
          TEXCOORD_0: W.accessor(fUv, "VEC2", 5126, count, 34962),
          JOINTS_0: W.accessor(uJ, "VEC4", 5121, count, 34962),
          WEIGHTS_0: W.accessor(fW, "VEC4", 5126, count, 34962),
        },
        indices: count > 65535 ? W.accessor(new Uint32Array(idx), "SCALAR", 5125, idx.length, 34963) : W.accessor(new Uint16Array(idx), "SCALAR", 5123, idx.length, 34963),
        material: mi,
      };
      if (meshName === "face") {
        prim.targets = morph.map(function (list) {
          var f = new Float32Array(count * 3);
          list.forEach(function (d, i) { f.set(d, i * 3); });
          return { POSITION: W.accessor(f, "VEC3", 5126, count, 34962, true) };
        });
      }
      prims.push(prim);
    });
    var mesh = { name: meshName === "body" ? "Body" : "Face", primitives: prims };
    if (meshName === "face") { mesh.weights = MORPHS.map(function () { return 0; }); mesh.extras = { targetNames: MORPHS }; }
    J.meshes.push(mesh);
    J.nodes.push({ name: mesh.name, mesh: J.meshes.length - 1, skin: 0 });
    J.nodes[0].children.push(J.nodes.length - 1);
  });
  var faceNode = J.nodes.length - 1;
  J.scenes = [{ nodes: [0] }];
  J.scene = 0;

  var humanBones = {};
  HUMAN.forEach(function (name) { humanBones[name] = { node: BI[name] + 1 }; });
  function expr(k) { return { morphTargetBinds: [{ node: faceNode, index: k, weight: 1 }], isBinary: false }; }
  function joint(name, stiff, grav, drag, r) { return { node: BI[name] + 1, hitRadius: r, stiffness: stiff, gravityPower: grav, gravityDir: [0, -1, 0], dragForce: drag }; }
  var springs = [{ name: "ponytail", joints: ["hair1", "hair2", "hair3", "hair4"].map(function (n) { return joint(n, 0.9, 0.35, 0.35, 0.03); }), colliderGroups: [0] }];
  ["left", "right"].forEach(function (side) {
    SLEEVE_X.forEach(function (x, k) {
      springs.push({ name: side + "Sleeve" + k, joints: ["a", "b", "c"].map(function (s) { return joint(side + "Sleeve" + k + s, 1.0, 0.25, 0.5, 0.035); }), colliderGroups: [] }); // 袖子不接碰撞：手放下時支點貼著身體，碰撞球會把袖子推得扭曲
    });
  });
  J.extensionsUsed = ["VRMC_vrm", "VRMC_materials_mtoon", "VRMC_springBone"];
  J.extensions = {
    VRMC_vrm: {
      specVersion: "1.0",
      meta: {
        name: c.name, version: "0.2", authors: ["PriTest"], licenseUrl: "https://vrm.dev/licenses/1.0/",
        avatarPermission: "everyone", commercialUsage: "personalNonProfit",
        allowExcessivelyViolentUsage: false, allowExcessivelySexualUsage: false, allowPoliticalOrReligiousUsage: false, allowAntisocialOrHateUsage: false,
        creditNotation: "required", allowRedistribution: false, modification: "prohibited",
      },
      humanoid: { humanBones: humanBones },
      expressions: { preset: { blink: expr(0), aa: expr(1), happy: expr(2) } },
    },
    VRMC_springBone: {
      specVersion: "1.0",
      colliders: [
        { node: BI.chest + 1, shape: { sphere: { offset: [0, 0.01, 0], radius: 0.12 } } },
        { node: BI.spine + 1, shape: { sphere: { offset: [0, 0, 0], radius: 0.115 } } },
        { node: BI.hips + 1, shape: { sphere: { offset: [0, -0.12, 0], radius: 0.16 } } },
        { node: BI.hips + 1, shape: { sphere: { offset: [0, -0.32, 0], radius: 0.19 } } },
        { node: BI.head + 1, shape: { sphere: { offset: [0, 0.13, 0], radius: 0.16 } } },
      ],
      colliderGroups: [{ name: "body", colliders: [0, 1, 2, 3, 4] }],
      springs: springs,
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  var out = path.join(OUT_DIR, id + ".vrm");
  var glb = W.glb();
  fs.writeFileSync(out, glb);
  console.log("wrote", path.relative(ROOT, out), (glb.length / 1024).toFixed(1) + " KB,", totalVerts, "verts");
}

build("sayo", SAYO).catch(function (e) { console.error(e); process.exit(1); });
