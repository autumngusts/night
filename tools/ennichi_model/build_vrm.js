// ============================================================================
// 緣日樂園：程序化產生 VRM 1.0 角色（技術驗證樣本，2026-11-12）
//   不依賴任何套件，直接用 lathe（旋轉體）拼出 Q 版巫女，寫成 .vrm（= 帶 VRMC_vrm 擴充的 GLB）。
//   內容：
//     * 人形骨架（VRM 必要骨骼 + 馬尾 4 節）、剛性蒙皮（每個零件 100% 綁一根骨）
//     * Face 網格的 morph target → VRM 表情 blink／aa／happy
//     * VRMC_materials_mtoon（動畫風卡通著色＋描邊）
//     * VRMC_springBone（馬尾自然擺動，胸口一顆碰撞球）
//   這是「先用程式產生的替代模型開發、之後再換成 VRoid 正式模型」的那個替代模型；
//   載入端（static_src/ennichi_lab.js）不認得模型是怎麼做的，換成 VRoid 匯出的 .vrm 也一樣能用。
// 用法：node tools/ennichi_model/build_vrm.js
//   輸出 static_src/models/ennichi/<id>.vrm（目前只有 sayo＝巫女小夜）
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..", "..");
var OUT_DIR = path.join(ROOT, "static_src", "models", "ennichi");

// ---------------------------------------------------------------- 顏色（sRGB → linear）
function lin(hex) {
  var n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
}

// ---------------------------------------------------------------- 幾何
// profile：[[半徑, y], ...]，y 由下往上排，繞 Y 軸旋轉；兩端半徑為 0 時自然封口
function lathe(profile, seg) {
  var pos = [], idx = [];
  var rows = profile.length;
  for (var i = 0; i < rows; i++) {
    for (var s = 0; s <= seg; s++) {
      var a = (s / seg) * Math.PI * 2;
      pos.push([profile[i][0] * Math.sin(a), profile[i][1], profile[i][0] * Math.cos(a)]);
    }
  }
  for (i = 0; i < rows - 1; i++) {
    for (s = 0; s < seg; s++) {
      var a0 = i * (seg + 1) + s, a1 = a0 + 1, b0 = a0 + seg + 1, b1 = b0 + 1;
      idx.push(a0, a1, b0, a1, b1, b0); // 外側為正面（逆時針）
    }
  }
  return { pos: pos, idx: idx };
}

// 單位球（半徑 1、中心原點）
function unitSphere(seg, rings) {
  var prof = [];
  for (var i = 0; i <= rings; i++) {
    var t = Math.PI * (1 - i / rings); // 由下而上
    prof.push([Math.sin(t), Math.cos(t)]);
  }
  return lathe(prof, seg);
}

function ellipsoid(c, r, seg, rings) {
  var g = unitSphere(seg || 20, rings || 14);
  g.pos = g.pos.map(function (p) { return [c[0] + p[0] * r[0], c[1] + p[1] * r[1], c[2] + p[2] * r[2]]; });
  return g;
}

// 沿 +X（或 -X）方向的圓柱：用 lathe 沿 Y 做好再轉到 X 軸
function cylinderX(x0, x1, y, z, r0, r1, seg) {
  var g = lathe([[0, 0], [r0, 0], [r1, 1], [0, 1]], seg || 14);
  g.pos = g.pos.map(function (p) { return [x0 + (x1 - x0) * p[1], y + p[0], z + p[2]]; });
  if (x1 > x0) g.idx = flip(g.idx); // 交換 x、y 軸是一次鏡射，方向朝 +X 時要再翻回來
  return g;
}

function flip(idx) {
  var out = [];
  for (var i = 0; i < idx.length; i += 3) out.push(idx[i], idx[i + 2], idx[i + 1]);
  return out;
}

// 繞 Z 軸（正面看的平面）旋轉，用來斜放睫毛、衣領
function rotZ(g, cx, cy, ang) {
  var c = Math.cos(ang), s = Math.sin(ang);
  g.pos = g.pos.map(function (p) {
    var x = p[0] - cx, y = p[1] - cy;
    return [cx + x * c - y * s, cy + x * s + y * c, p[2]];
  });
  return g;
}

function scaleZ(g, cz, k) {
  g.pos = g.pos.map(function (p) { return [p[0], p[1], cz + (p[2] - cz) * k]; });
  return g;
}

function normals(pos, idx) {
  var n = pos.map(function () { return [0, 0, 0]; });
  for (var i = 0; i < idx.length; i += 3) {
    var a = pos[idx[i]], b = pos[idx[i + 1]], c = pos[idx[i + 2]];
    var u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    var f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (var k = 0; k < 3; k++) { var m = n[idx[i + k]]; m[0] += f[0]; m[1] += f[1]; m[2] += f[2]; }
  }
  // 旋轉體的接縫（s=0 與 s=seg）是重複頂點：位置相同的頂點合併法線，避免一條亮線
  var key = {};
  pos.forEach(function (p, i) {
    var k = p.map(function (v) { return v.toFixed(5); }).join(",");
    (key[k] = key[k] || []).push(i);
  });
  Object.keys(key).forEach(function (k) {
    var g = key[k];
    if (g.length < 2) return;
    var s = [0, 0, 0];
    g.forEach(function (i) { s[0] += n[i][0]; s[1] += n[i][1]; s[2] += n[i][2]; });
    g.forEach(function (i) { n[i] = s.slice(); });
  });
  return n.map(function (v) {
    var l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  });
}

// ---------------------------------------------------------------- 骨架（T-pose，模型面向 +Z，角色左手 = +X）
var BONES = [
  // name, parent, world position
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
  // 馬尾（非人形骨，交給 springBone）
  ["hair1", "head", [0, 1.21, -0.13]],
  ["hair2", "hair1", [0, 1.06, -0.15]],
  ["hair3", "hair2", [0, 0.92, -0.16]],
  ["hair4", "hair3", [0, 0.78, -0.16]],
];
var HUMAN = BONES.slice(0, 17).map(function (b) { return b[0]; });
var BONE_INDEX = {};
BONES.forEach(function (b, i) { BONE_INDEX[b[0]] = i; });

// ---------------------------------------------------------------- 角色定義
var CHARACTERS = {
  sayo: {
    name: "Sayo (Ennichi miko, procedural sample)",
    materials: {
      skin: { color: "#ffe6d8", shade: "#f2b2a2" },
      hair: { color: "#2b2233", shade: "#130d1c" },
      white: { color: "#fbfaf8", shade: "#c5c6dc" },
      red: { color: "#d42a3c", shade: "#861527" },
      eye: { color: "#4a1622", shade: "#2c0a12", outline: false },
      iris: { color: "#c0405a", shade: "#8a2238", outline: false },
      shine: { color: "#ffffff", shade: "#ffffff", outline: false },
      mouth: { color: "#d8646c", shade: "#b0444c", outline: false },
      cheek: { color: "#ffb0b0", shade: "#ff9a9a", outline: false },
    },
  },
};

// 每個零件：[mesh（body／face）, material, bone, geometry]
function parts() {
  var P = [];
  function add(mesh, mat, bone, g, role) { P.push({ mesh: mesh, mat: mat, bone: bone, g: g, role: role || mat }); }
  [1, -1].forEach(function (sx) {
    var side = sx > 0 ? "left" : "right";
    // 手臂：白色小袖＋垂下的大袖（巫女服）
    add("body", "white", side + "UpperArm", cylinderX(0.09 * sx, 0.30 * sx, 1.03, 0, 0.052, 0.048));
    add("body", "white", side + "LowerArm", cylinderX(0.285 * sx, 0.445 * sx, 1.03, 0, 0.05, 0.046));
    add("body", "white", side + "LowerArm", ellipsoid([0.36 * sx, 0.95, 0], [0.11, 0.12, 0.034]));
    add("body", "red", side + "LowerArm", ellipsoid([0.36 * sx, 0.835, 0], [0.07, 0.012, 0.03], 16, 6)); // 袖口的紅色袖括り紐
    add("body", "skin", side + "Hand", ellipsoid([0.485 * sx, 1.03, 0], [0.042, 0.03, 0.038]));
    // 白足袋
    add("body", "white", side + "Foot", ellipsoid([0.075 * sx, 0.045, 0.03], [0.045, 0.04, 0.08]));
    // 側髮
    add("body", "hair", "head", ellipsoid([0.15 * sx, 1.17, 0.055], [0.04, 0.12, 0.045]));
    // 臉部（face 網格才有 morph target）
    // 動畫風的大眼：深色眼眶＋亮色虹膜＋高光＋上睫毛
    add("face", "eye", "head", ellipsoid([0.062 * sx, 1.225, 0.147], [0.036, 0.05, 0.013]));
    add("face", "iris", "head", ellipsoid([0.062 * sx, 1.216, 0.157], [0.022, 0.032, 0.006], 16, 10), "eye");
    add("face", "shine", "head", ellipsoid([0.052 * sx, 1.24, 0.162], [0.009, 0.012, 0.004], 10, 6));
    add("face", "hair", "head", rotZ(ellipsoid([0.064 * sx, 1.268, 0.156], [0.044, 0.008, 0.009], 14, 6), 0.064 * sx, 1.268, -0.15 * sx), "lash");
    add("face", "cheek", "head", ellipsoid([0.098 * sx, 1.18, 0.116], [0.026, 0.011, 0.007], 12, 6));
    // 衣領下露出的紅色襦袢（V 字）
    add("body", "red", "chest", rotZ(ellipsoid([0.024 * sx, 1.025, 0.088], [0.008, 0.045, 0.008], 10, 8), 0.024 * sx, 1.025, -0.45 * sx));
  });
  // 頭、脖子
  add("body", "skin", "head", ellipsoid([0, 1.255, 0.005], [0.165, 0.17, 0.16], 28, 20));
  add("body", "skin", "neck", lathe([[0, 1.05], [0.042, 1.05], [0.04, 1.14], [0, 1.14]], 14));
  // 頭髮：頭頂、瀏海、白色髮結、馬尾三段（綁在 springBone 上）
  add("body", "hair", "head", ellipsoid([0, 1.30, -0.03], [0.176, 0.17, 0.166], 28, 20));
  add("body", "hair", "head", ellipsoid([-0.075, 1.35, 0.128], [0.06, 0.065, 0.04]));
  add("body", "hair", "head", ellipsoid([0, 1.355, 0.138], [0.058, 0.068, 0.04]));
  add("body", "hair", "head", ellipsoid([0.075, 1.35, 0.128], [0.06, 0.065, 0.04]));
  add("body", "white", "hair1", ellipsoid([0.04, 1.19, -0.165], [0.045, 0.026, 0.02], 14, 8));
  add("body", "white", "hair1", ellipsoid([-0.04, 1.19, -0.165], [0.045, 0.026, 0.02], 14, 8));
  add("body", "red", "hair1", ellipsoid([0, 1.19, -0.17], [0.02, 0.02, 0.02], 12, 8));
  add("body", "hair", "hair1", ellipsoid([0, 1.12, -0.13], [0.13, 0.13, 0.06]));
  add("body", "hair", "hair2", ellipsoid([0, 0.99, -0.15], [0.10, 0.12, 0.045]));
  add("body", "hair", "hair3", ellipsoid([0, 0.85, -0.16], [0.07, 0.10, 0.035]));
  // 白衣（上半身）、腰
  add("body", "white", "chest", scaleZ(lathe([[0, 0.86], [0.118, 0.86], [0.13, 0.95], [0.12, 1.02], [0.075, 1.07], [0, 1.075]], 22), 0, 0.72));
  add("body", "white", "spine", scaleZ(lathe([[0, 0.76], [0.112, 0.76], [0.118, 0.87], [0, 0.87]], 22), 0, 0.72));
  // 緋袴
  add("body", "red", "hips", scaleZ(lathe([[0, 0.075], [0.235, 0.075], [0.235, 0.11], [0.19, 0.46], [0.145, 0.76], [0.125, 0.865], [0, 0.865]], 26), 0, 0.8));
  add("body", "red", "hips", ellipsoid([0, 0.83, 0.108], [0.055, 0.024, 0.016], 14, 8)); // 前結び
  // 嘴
  add("face", "mouth", "head", ellipsoid([0, 1.152, 0.132], [0.013, 0.006, 0.006], 12, 6));
  return P;
}

// morph target：face 網格各零件的頂點怎麼動
var MORPHS = ["blink", "aa", "happy"];
function morphDelta(part, p, center) {
  var dy = p[1] - center[1], dx = p[0] - center[0];
  var out = { blink: [0, 0, 0], aa: [0, 0, 0], happy: [0, 0, 0] };
  if (part.role === "eye") {
    out.blink = [0, center[1] - 0.012 + dy * 0.1 - p[1], 0];
    out.happy = [0, center[1] + 0.006 + dy * 0.32 - p[1], 0];
  } else if (part.role === "lash") {
    out.blink = [0, -0.046 - dy * 0.5, 0.004];
    out.happy = [0, -0.018, 0.002];
  } else if (part.role === "shine") {
    out.blink = [-dx, center[1] - 0.012 - p[1], -0.004];
    out.happy = [-dx, center[1] + 0.006 - p[1], -0.004];
  } else if (part.role === "mouth") {
    out.aa = [dx * -0.1, dy * 2.4 - 0.004, 0];
    out.happy = [dx * 0.5, dy * 1.2, 0];
  } else if (part.role === "cheek") {
    out.happy = [dx * 0.25, dy * 0.4, 0.002];
  }
  return out;
}

// ---------------------------------------------------------------- glTF 寫出
function GltfWriter() {
  this.json = { asset: { version: "2.0", generator: "PriTest ennichi build_vrm.js" }, buffers: [], bufferViews: [], accessors: [] };
  this.chunks = [];
  this.byteLength = 0;
}
GltfWriter.prototype.view = function (typed, target) {
  var pad = (4 - (this.byteLength % 4)) % 4;
  if (pad) { this.chunks.push(Buffer.alloc(pad)); this.byteLength += pad; }
  var buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
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

function build(id) {
  var def = CHARACTERS[id];
  var W = new GltfWriter();
  var J = W.json;
  var matNames = Object.keys(def.materials);

  // 材質（MToon）
  J.materials = matNames.map(function (m) {
    var d = def.materials[m];
    var c = lin(d.color), sh = lin(d.shade);
    return {
      name: m,
      pbrMetallicRoughness: { baseColorFactor: c.concat(1), metallicFactor: 0, roughnessFactor: 1 },
      extensions: {
        VRMC_materials_mtoon: {
          specVersion: "1.0",
          transparentWithZWrite: false,
          renderQueueOffsetNumber: 0,
          shadeColorFactor: sh,
          shadingShiftFactor: -0.05,
          shadingToonyFactor: 0.92,
          giEqualizationFactor: 0.9,
          matcapFactor: [0, 0, 0],
          parametricRimColorFactor: d.outline === false ? [0, 0, 0] : [0.25, 0.22, 0.3],
          parametricRimFresnelPowerFactor: 4,
          parametricRimLiftFactor: 0,
          rimLightingMixFactor: 1,
          outlineWidthMode: d.outline === false ? "none" : "worldCoordinates",
          outlineWidthFactor: 0.0035,
          outlineColorFactor: lin("#2a1c26"),
          outlineLightingMixFactor: 0.6,
        },
      },
    };
  });

  // 節點：0 = 根，1.. = 骨，最後兩個 = Body／Face 網格
  J.nodes = [{ name: "Root", children: [] }];
  BONES.forEach(function (b) {
    var p = b[2], parent = b[1] ? BONES[BONE_INDEX[b[1]]][2] : [0, 0, 0];
    J.nodes.push({ name: b[0], translation: [p[0] - parent[0], p[1] - parent[1], p[2] - parent[2]] });
  });
  BONES.forEach(function (b, i) {
    var node = i + 1;
    if (b[1]) {
      var par = J.nodes[BONE_INDEX[b[1]] + 1];
      (par.children = par.children || []).push(node);
    } else J.nodes[0].children.push(node);
  });

  // 蒙皮
  var ibm = new Float32Array(BONES.length * 16);
  BONES.forEach(function (b, i) {
    var o = i * 16;
    ibm[o] = ibm[o + 5] = ibm[o + 10] = ibm[o + 15] = 1;
    ibm[o + 12] = -b[2][0]; ibm[o + 13] = -b[2][1]; ibm[o + 14] = -b[2][2];
  });
  J.skins = [{
    inverseBindMatrices: W.accessor(ibm, "MAT4", 5126, BONES.length),
    joints: BONES.map(function (b, i) { return i + 1; }),
    skeleton: 1,
  }];

  // 網格：同一個 mesh 內依材質分 primitive
  var all = parts();
  J.meshes = [];
  ["body", "face"].forEach(function (meshName) {
    var prims = [];
    matNames.forEach(function (m, mi) {
      var ps = all.filter(function (p) { return p.mesh === meshName && p.mat === m; });
      if (!ps.length) return;
      var pos = [], nrm = [], jnt = [], idx = [], morph = MORPHS.map(function () { return []; });
      ps.forEach(function (p) {
        var base = pos.length;
        var n = normals(p.g.pos, p.g.idx);
        var c = [0, 0, 0];
        p.g.pos.forEach(function (v) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; });
        c = c.map(function (v) { return v / p.g.pos.length; });
        p.g.pos.forEach(function (v, i) {
          pos.push(v); nrm.push(n[i]); jnt.push(BONE_INDEX[p.bone]);
          if (meshName === "face") {
            var d = morphDelta(p, v, c);
            MORPHS.forEach(function (name, k) { morph[k].push(d[name]); });
          }
        });
        p.g.idx.forEach(function (i) { idx.push(base + i); });
      });
      var count = pos.length;
      var fPos = new Float32Array(count * 3), fNrm = new Float32Array(count * 3);
      var uJ = new Uint8Array(count * 4), fW = new Float32Array(count * 4);
      for (var i = 0; i < count; i++) {
        fPos.set(pos[i], i * 3); fNrm.set(nrm[i], i * 3);
        uJ[i * 4] = jnt[i]; fW[i * 4] = 1;
      }
      var prim = {
        attributes: {
          POSITION: W.accessor(fPos, "VEC3", 5126, count, 34962, true),
          NORMAL: W.accessor(fNrm, "VEC3", 5126, count, 34962),
          JOINTS_0: W.accessor(uJ, "VEC4", 5121, count, 34962),
          WEIGHTS_0: W.accessor(fW, "VEC4", 5126, count, 34962),
        },
        indices: W.accessor(new Uint16Array(idx), "SCALAR", 5123, idx.length, 34963),
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
    if (meshName === "face") {
      mesh.weights = MORPHS.map(function () { return 0; });
      mesh.extras = { targetNames: MORPHS };
    }
    J.meshes.push(mesh);
    J.nodes.push({ name: mesh.name, mesh: J.meshes.length - 1, skin: 0 });
    J.nodes[0].children.push(J.nodes.length - 1);
  });
  var faceNode = J.nodes.length - 1;
  J.scenes = [{ nodes: [0] }];
  J.scene = 0;

  var humanBones = {};
  HUMAN.forEach(function (name) { humanBones[name] = { node: BONE_INDEX[name] + 1 }; });
  function expr(k) { return { morphTargetBinds: [{ node: faceNode, index: k, weight: 1 }], isBinary: false }; }
  J.extensionsUsed = ["VRMC_vrm", "VRMC_materials_mtoon", "VRMC_springBone"];
  J.extensions = {
    VRMC_vrm: {
      specVersion: "1.0",
      meta: {
        name: def.name,
        version: "0.1",
        authors: ["PriTest"],
        licenseUrl: "https://vrm.dev/licenses/1.0/",
        avatarPermission: "everyone",
        commercialUsage: "personalNonProfit",
        allowExcessivelyViolentUsage: false,
        allowExcessivelySexualUsage: false,
        allowPoliticalOrReligiousUsage: false,
        allowAntisocialOrHateUsage: false,
        creditNotation: "required",
        allowRedistribution: false,
        modification: "prohibited",
      },
      humanoid: { humanBones: humanBones },
      expressions: { preset: { blink: expr(0), aa: expr(1), happy: expr(2) } },
    },
    VRMC_springBone: {
      specVersion: "1.0",
      colliders: [
        { node: BONE_INDEX.chest + 1, shape: { sphere: { offset: [0, 0.02, -0.02], radius: 0.11 } } },
        { node: BONE_INDEX.head + 1, shape: { sphere: { offset: [0, 0.13, 0], radius: 0.16 } } },
      ],
      colliderGroups: [{ name: "body", colliders: [0, 1] }],
      springs: [{
        name: "ponytail",
        joints: ["hair1", "hair2", "hair3", "hair4"].map(function (n) {
          return { node: BONE_INDEX[n] + 1, hitRadius: 0.03, stiffness: 0.9, gravityPower: 0.35, gravityDir: [0, -1, 0], dragForce: 0.35 };
        }),
        colliderGroups: [0],
      }],
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  var out = path.join(OUT_DIR, id + ".vrm");
  var glb = W.glb();
  fs.writeFileSync(out, glb);
  console.log("wrote", path.relative(ROOT, out), (glb.length / 1024).toFixed(1) + " KB");
}

Object.keys(CHARACTERS).forEach(build);
