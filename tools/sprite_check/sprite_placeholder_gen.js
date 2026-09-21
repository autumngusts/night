// 占位用 sprite sheet 產生器（2026-09-22）。
//
//   node tools/sprite_check/sprite_placeholder_gen.js <sheetId> [--write]
//   例：node tools/sprite_check/sprite_placeholder_gen.js family_soldier_knight_a --write
//
// 用途：正式美術（tools/sprite_spec.md 的外部生成流程）還沒產出之前，等待房「產生戰鬥模擬」
// 需要至少一組 available:true 的 sheet，才能在實際戰鬥中驗證動畫層（idle→出招→受擊→死亡）
// 與迴避時機。這裡用 png.js 程式化畫一個朝左的騎士剪影，8 列動作各自有可辨識的動態，
// 尺寸／列順序完全依 spec（橫6幀×縱8動作、單格 128px、背景透明、角色朝左）。
//
// **這是占位圖，不是正式美術。** 正式圖產出後直接覆蓋同名檔案、重跑 sprite_verify.js／
// sprite_pack.js 即可，程式碼不用改。顏色大致依 spec 的低彩度土系配色（赭／褐本體、
// 奶白羽飾、灰紫金屬、暗赭描邊），但只是讓占位圖跟未來正式圖的畫面氛圍不要差太多，
// 不是要模仿正式畫風。
//
// 列順序（不可更動，對應 static_src/enemy_sprite_data.js 的 row）：
//   0 idle／1 line／2 area／3 thrust／4 slam／5 single／6 hurt／7 death
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const PNG = require("./png.js");

const ROOT = path.resolve(__dirname, "..", "..");
const SPRITE_DIR = path.join(ROOT, "static_src", "images", "sprites");
const COLS = 6;
const ROWS = 8;
const CELL = 128;

// ---- 調色盤（RGBA）----
const OUTLINE = [82, 46, 22, 255]; // 暗赭描邊
const BODY = [156, 108, 52, 255]; // 赭色本體
const BODY_LIGHT = [198, 150, 84, 255]; // 受光面
const METAL = [128, 116, 148, 255]; // 灰紫金屬
const METAL_LIGHT = [176, 166, 196, 255];
const PLUME = [236, 226, 196, 255]; // 奶白羽飾
const SHADOW = [90, 74, 96, 255]; // 冷色陰影
const FLASH = [240, 200, 140, 255]; // 受擊閃白
const FX = [222, 160, 70, 255]; // 揮擊軌跡／衝擊特效

function makeCanvas() {
  return { w: COLS * CELL, h: ROWS * CELL, px: Buffer.alloc(COLS * CELL * ROWS * CELL * 4, 0) };
}

function put(cv, x, y, c, alpha) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  // 每一幀只能畫在自己的格子裡（renderer 是用 background-position 切格，溢出的像素會
  // 出現在相鄰動作的幀上）。
  const cl = cv.clip;
  if (cl && (x < cl.x0 || y < cl.y0 || x >= cl.x1 || y >= cl.y1)) return;
  const i = (y * cv.w + x) * 4;
  const a = (c[3] / 255) * (alpha === undefined ? 1 : alpha);
  if (a <= 0) return;
  const da = cv.px[i + 3] / 255;
  const oa = a + da * (1 - a);
  for (let k = 0; k < 3; k++) {
    cv.px[i + k] = Math.round((c[k] * a + cv.px[i + k] * da * (1 - a)) / (oa || 1));
  }
  cv.px[i + 3] = Math.round(oa * 255);
}

// 實心圓（帶描邊）
function disc(cv, cx, cy, r, fill, alpha, noOutline) {
  const rr = r + (noOutline ? 0 : 1.5);
  for (let y = Math.floor(cy - rr - 1); y <= Math.ceil(cy + rr + 1); y++) {
    for (let x = Math.floor(cx - rr - 1); x <= Math.ceil(cx + rr + 1); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r) put(cv, x, y, fill, alpha);
      else if (!noOutline && d <= rr) put(cv, x, y, OUTLINE, alpha);
    }
  }
}

// 粗線段（膠囊）：從 (x0,y0) 到 (x1,y1)，半寬 hw
function capsule(cv, x0, y0, x1, y1, hw, fill, alpha, noOutline) {
  const minX = Math.min(x0, x1) - hw - 2;
  const maxX = Math.max(x0, x1) + hw + 2;
  const minY = Math.min(y0, y1) - hw - 2;
  const maxY = Math.max(y0, y1) + hw + 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
      const d = Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t));
      if (d <= hw) put(cv, x, y, fill, alpha);
      else if (!noOutline && d <= hw + 1.5) put(cv, x, y, OUTLINE, alpha);
    }
  }
}

// 圓弧特效（揮擊軌跡）：以 (cx,cy) 為圓心、半徑 r、角度 a0→a1（弧度）
function arc(cv, cx, cy, r, a0, a1, hw, fill, alpha) {
  const steps = Math.max(8, Math.round(Math.abs(a1 - a0) * r));
  for (let i = 0; i < steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const b = a0 + ((a1 - a0) * (i + 1)) / steps;
    capsule(cv, cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(b) * r, cy + Math.sin(b) * r, hw, fill, alpha, true);
  }
}

// ---- 騎士本體 ----
// 角色朝左。p：{ox, oy（整體位移）, lean（上半身前傾，正＝往左）, tilt（整體旋轉弧度）,
//              crouch（蹲低 0~1）, sword:{angle, len}（劍相對肩的角度：0＝水平朝左、-PI/2＝朝上）,
//              shield（是否舉盾）, alpha, flash（受擊閃白 0~1）, lying（倒地 0~1）}
function knight(cv, cellX, cellY, p) {
  const alpha = p.alpha === undefined ? 1 : p.alpha;
  const lying = p.lying || 0;
  // 角色朝左、所有伸展都往左，整體基準點往右挪 10px 才不會讓劍尖碰到格子左緣。
  const cx = cellX + CELL / 2 + 8 + (p.ox || 0);
  const ground = cellY + CELL * 0.86 + (p.oy || 0);
  const crouch = p.crouch || 0;
  const bodyCol = p.flash ? mix(BODY, FLASH, p.flash) : BODY;
  const bodyLight = p.flash ? mix(BODY_LIGHT, FLASH, p.flash) : BODY_LIGHT;
  const metalCol = p.flash ? mix(METAL, FLASH, p.flash) : METAL;

  // 以「腳跟中心」為原點的局部座標 → 套用倒地旋轉（繞腳跟）→ 畫面座標
  const rot = (p.tilt || 0) + lying * (Math.PI / 2);
  function T(lx, ly) {
    // lx：朝左為負；ly：向上為負
    const rx = lx * Math.cos(rot) - ly * Math.sin(rot);
    const ry = lx * Math.sin(rot) + ly * Math.cos(rot);
    return [cx + rx, ground + ry];
  }
  const lean = p.lean || 0;
  const hipY = -34 + crouch * 10;
  const shoulderY = -62 + crouch * 14;
  const headY = -80 + crouch * 16;

  // 影子（倒地時拉長變淡）
  capsule(cv, cx - 16 - lying * 12, ground + 3, cx + 16 + lying * 12, ground + 3, 7, SHADOW, alpha * 0.35 * (1 - lying * 0.5), true);

  // 後腳／前腳
  let a = T(8, hipY);
  let b = T(12 + crouch * 6, 0);
  capsule(cv, a[0], a[1], b[0], b[1], 6, bodyCol, alpha);
  a = T(-6, hipY);
  b = T(-16 - crouch * 8, 0);
  capsule(cv, a[0], a[1], b[0], b[1], 6, bodyLight, alpha);
  // 軀幹
  a = T(0, hipY);
  b = T(-lean, shoulderY);
  capsule(cv, a[0], a[1], b[0], b[1], 13, bodyCol, alpha);
  // 胸甲高光
  a = T(-4 - lean, hipY - 6);
  b = T(-6 - lean, shoulderY + 4);
  capsule(cv, a[0], a[1], b[0], b[1], 5, bodyLight, alpha, true);
  // 頭盔
  const head = T(-6 - lean, headY);
  disc(cv, head[0], head[1], 13, metalCol, alpha);
  // 面罩縫
  a = T(-16 - lean, headY);
  b = T(-8 - lean, headY);
  capsule(cv, a[0], a[1], b[0], b[1], 1.5, OUTLINE, alpha, true);
  // 羽飾（往右後方飄）
  a = T(-2 - lean, headY - 12);
  b = T(14 - lean, headY - 20);
  capsule(cv, a[0], a[1], b[0], b[1], 4, PLUME, alpha);
  // 盾（左臂，朝左）
  if (p.shield !== false) {
    const sh = T(-22 - lean, shoulderY + 12);
    disc(cv, sh[0], sh[1], 14, metalCol, alpha);
    disc(cv, sh[0], sh[1], 6, METAL_LIGHT, alpha, true);
  }
  // 劍（右臂）：從肩出發
  const sw = p.sword || { angle: -Math.PI / 4, len: 40 };
  const shoulder = T(2 - lean, shoulderY + 6);
  const handLx = 2 - lean + Math.cos(sw.angle) * 12;
  const handLy = shoulderY + 6 + Math.sin(sw.angle) * 12;
  const hand = T(handLx, handLy);
  capsule(cv, shoulder[0], shoulder[1], hand[0], hand[1], 5, bodyCol, alpha);
  const tip = T(handLx + Math.cos(sw.angle) * sw.len, handLy + Math.sin(sw.angle) * sw.len);
  capsule(cv, hand[0], hand[1], tip[0], tip[1], 3.5, METAL_LIGHT, alpha);
  // 護手
  disc(cv, hand[0], hand[1], 4.5, metalCol, alpha);
}

function mix(a, b, t) {
  return [0, 1, 2].map(function (i) {
    return Math.round(a[i] * (1 - t) + b[i] * t);
  }).concat([255]);
}

const L = Math.PI; // 「朝左」＝角度 PI（cos=-1）
const UP = -Math.PI / 2;

// ---- 8 列動作，各 6 幀 ----
// 每個函式回傳 (frameIndex) => { knight params, fx(cv, cellX, cellY) }
const ROW_DEFS = [
  // 0 idle：上下呼吸＋劍微微擺動
  function (f) {
    const t = (f / 6) * Math.PI * 2;
    return { oy: Math.sin(t) * 2, sword: { angle: -Math.PI / 4 + Math.sin(t) * 0.06, len: 40 } };
  },
  // 1 line：後拉→往左突進（劍水平）＋直線軌跡；hitFrame=3
  function (f) {
    const seq = [
      { ox: 6, lean: -4, sword: { angle: -Math.PI / 3, len: 40 } },
      { ox: 10, lean: -8, crouch: 0.4, sword: { angle: -Math.PI / 2.2, len: 40 } },
      { ox: -6, lean: 6, sword: { angle: L, len: 44 } },
      { ox: -14, lean: 12, sword: { angle: L, len: 40 }, fx: function (cv, x, y) {
        capsule(cv, x + 14, y + 62, x + 66, y + 62, 3, FX, 0.85, true);
        capsule(cv, x + 10, y + 70, x + 56, y + 70, 2, FX, 0.5, true);
      } },
      { ox: -12, lean: 8, sword: { angle: L, len: 40 }, fx: function (cv, x, y) {
        capsule(cv, x + 20, y + 64, x + 58, y + 64, 2, FX, 0.4, true);
      } },
      { ox: -6, lean: 2, sword: { angle: -Math.PI / 3, len: 40 } },
    ];
    return seq[f];
  },
  // 2 area：劍繞身體掃一圈＋弧形軌跡；hitFrame=4
  function (f) {
    const angle = -Math.PI / 4 + (f / 6) * Math.PI * 2;
    const p = { sword: { angle: angle, len: 46 }, lean: Math.cos(angle) * -4, shield: f < 2 };
    if (f >= 3) {
      p.fx = function (cv, x, y) {
        const cx = x + CELL / 2 + 10;
        const cy = y + CELL * 0.86 - 56;
        arc(cv, cx, cy, 50, angle - Math.PI * 0.9, angle, 3, FX, f === 4 ? 0.9 : 0.5);
      };
    }
    return p;
  },
  // 3 thrust：後坐→長距離直刺（劍拉長）；hitFrame=3
  function (f) {
    const seq = [
      { ox: 4, crouch: 0.3, sword: { angle: L, len: 34 } },
      { ox: 12, crouch: 0.6, lean: -6, sword: { angle: L, len: 34 } },
      { ox: 2, crouch: 0.3, lean: 6, sword: { angle: L, len: 46 } },
      { ox: -8, crouch: 0.2, lean: 14, sword: { angle: L, len: 56 }, fx: function (cv, x, y) {
        disc(cv, x + 16, y + 58, 9, FX, 0.85, true);
        capsule(cv, x + 20, y + 58, x + 40, y + 58, 2, FX, 0.5, true);
      } },
      { ox: -6, crouch: 0.2, lean: 10, sword: { angle: L, len: 52 } },
      { ox: -2, crouch: 0.1, lean: 2, sword: { angle: -Math.PI / 4, len: 40 } },
    ];
    return seq[f];
  },
  // 4 slam：高舉→跳起→砸地＋地面衝擊；hitFrame=4
  function (f) {
    const seq = [
      { sword: { angle: -Math.PI / 2.5, len: 40 }, lean: -4 },
      { sword: { angle: UP + 0.35, len: 30 }, lean: -8, oy: -2, crouch: 0.2 },
      { sword: { angle: UP + 0.5, len: 30 }, lean: -6, oy: -8, crouch: 0.1 },
      { sword: { angle: L + Math.PI / 3, len: 46 }, lean: 8, oy: -6 },
      { sword: { angle: L - Math.PI / 6, len: 50 }, lean: 14, crouch: 0.5, fx: function (cv, x, y) {
        const gy = y + CELL * 0.86;
        capsule(cv, x + 12, gy - 2, x + 52, gy - 2, 3, FX, 0.9, true);
        disc(cv, x + 28, gy - 6, 6, FX, 0.8, true);
        disc(cv, x + 14, gy - 12, 3, FX, 0.6, true);
        disc(cv, x + 46, gy - 14, 3, FX, 0.6, true);
      } },
      { sword: { angle: L - Math.PI / 8, len: 46 }, lean: 8, crouch: 0.3 },
    ];
    return seq[f];
  },
  // 5 single：由上往下的斜劈；hitFrame=3
  function (f) {
    const seq = [
      { sword: { angle: -Math.PI / 2.6, len: 42 }, lean: -4 },
      { sword: { angle: -Math.PI / 1.7, len: 44 }, lean: -8 },
      { sword: { angle: L + Math.PI / 2.4, len: 46 }, lean: 4 },
      { sword: { angle: L + Math.PI / 5, len: 48 }, lean: 12, fx: function (cv, x, y) {
        const cx = x + CELL / 2 + 16;
        const cy = y + CELL * 0.86 - 56;
        arc(cv, cx, cy, 46, -Math.PI * 0.85, -Math.PI * 0.55, 3, FX, 0.9);
      } },
      { sword: { angle: L - Math.PI / 10, len: 46 }, lean: 8 },
      { sword: { angle: -Math.PI / 4, len: 40 }, lean: 0 },
    ];
    return seq[f];
  },
  // 6 hurt：往右彈開＋閃白＋後仰，再站回來
  function (f) {
    const seq = [
      { ox: 2, tilt: 0.08, flash: 0.9, sword: { angle: -Math.PI / 5, len: 40 } },
      { ox: 6, tilt: 0.16, flash: 0.6, lean: -8, sword: { angle: -Math.PI / 6, len: 40 } },
      { ox: 8, tilt: 0.2, flash: 0.3, lean: -10, sword: { angle: -Math.PI / 8, len: 40 } },
      { ox: 6, tilt: 0.12, lean: -6, sword: { angle: -Math.PI / 6, len: 40 } },
      { ox: 3, tilt: 0.06, lean: -3, sword: { angle: -Math.PI / 5, len: 40 } },
      { ox: 2, tilt: 0.0, sword: { angle: -Math.PI / 4, len: 40 } },
    ];
    return seq[f];
  },
  // 7 death：跪下→往右倒地→淡出（最後一幀 hold）
  function (f) {
    const seq = [
      // 倒地是繞腳跟往右轉 90 度，身體會往右伸出約 70px，所以 lying 越大整體越往左推
      // （ox 負值）、並稍微抬高避免貼在格底被切。
      { crouch: 0.4, tilt: 0.1, flash: 0.5, sword: { angle: -Math.PI / 6, len: 40 } },
      { crouch: 0.8, tilt: 0.25, ox: -6, sword: { angle: 0.1, len: 36 }, shield: false },
      { crouch: 0.9, lying: 0.35, ox: -16, sword: { angle: -0.6, len: 36 }, shield: false },
      { crouch: 0.9, lying: 0.7, ox: -30, oy: -12, sword: { angle: -1.2, len: 36 }, shield: false },
      { crouch: 0.9, lying: 1.0, ox: -40, oy: -20, sword: { angle: -1.4, len: 36 }, shield: false, alpha: 0.85 },
      { crouch: 0.9, lying: 1.0, ox: -40, oy: -20, sword: { angle: -1.4, len: 36 }, shield: false, alpha: 0.55 },
    ];
    return seq[f];
  },
];

function loadRegistry() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "static_src", "enemy_sprite_registry.js"), "utf8"),
    sandbox,
    { filename: "enemy_sprite_registry.js" }
  );
  return sandbox.window.PriTestEnemySpriteRegistry;
}

function render() {
  const cv = makeCanvas();
  for (let row = 0; row < ROWS; row++) {
    for (let f = 0; f < COLS; f++) {
      const p = ROW_DEFS[row](f);
      const cellX = f * CELL;
      const cellY = row * CELL;
      cv.clip = { x0: cellX, y0: cellY, x1: cellX + CELL, y1: cellY + CELL };
      if (p.fx) p.fx(cv, cellX, cellY);
      knight(cv, cellX, cellY, p);
    }
  }
  return cv;
}

function main() {
  const args = process.argv.slice(2);
  const sheetId = args.filter(function (a) {
    return a.indexOf("--") !== 0;
  })[0];
  const write = args.indexOf("--write") !== -1;
  if (!sheetId) {
    console.log("usage: node sprite_placeholder_gen.js <sheetId> [--write]");
    process.exit(2);
  }
  const R = loadRegistry();
  const sheet = R.getSheet(sheetId);
  if (!sheet) {
    console.log("登錄表に無い sheetId: " + sheetId);
    process.exit(1);
  }
  const cv = render();
  const out = path.join(SPRITE_DIR, sheet.file);
  if (!write) {
    console.log("(dry run) " + sheet.file + " " + cv.w + "x" + cv.h + " を生成可能。--write で書き込み。");
    return;
  }
  if (!fs.existsSync(SPRITE_DIR)) fs.mkdirSync(SPRITE_DIR, { recursive: true });
  PNG.encode(out, cv.w, cv.h, cv.px);
  console.log("wrote " + path.relative(ROOT, out) + " (" + cv.w + "x" + cv.h + ")");
  console.log("次: node tools/sprite_check/sprite_verify.js && node tools/sprite_check/sprite_pack.js --write");
}

module.exports = { render: render, CELL: CELL, COLS: COLS, ROWS: ROWS };

if (require.main === module) main();
