// DÉJÀ VU 山道下坡（dejavu）：靜態資料（車輛、固定山路、路段零件、季節、輪胎）。規則／物理在 dejavu_core.js。
// 車輛規格是「風格化的近似值」，只拿來讓各車有不同個性，不是原廠數據。
//   kw＝最大馬力（kW）、kg＝車重、grip＝底盤＋原廠胎的抓地係數、brk＝煞車、hdl＝操控（車手失誤幅度÷hdl）、
//   cda／cla＝空阻／下壓力面積（m²）、vmax＝極速（km/h）、ev＝電動車（全轉速區間都是最大出力）
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;

  function C(zh, ja, en) { return { zh: zh, ja: ja, en: en || ja }; }

  var BRANDS = [
    { id: "toyota", name: "Toyota" },
    { id: "honda", name: "Honda" },
    { id: "mazda", name: "Mazda" },
    { id: "nissan", name: "Nissan" },
    { id: "subaru", name: "Subaru" },
    { id: "mitsubishi", name: "Mitsubishi" },
    { id: "suzuki", name: "Suzuki" },
    { id: "benz", name: "Mercedes-Benz" },
    { id: "bmw", name: "BMW" },
    { id: "porsche", name: "Porsche" },
    { id: "tesla", name: "Tesla" },
    { id: "audi", name: "Audi" },
    { id: "vw", name: "Volkswagen" },
    { id: "ferrari", name: "Ferrari" },
    { id: "lamborghini", name: "Lamborghini" },
    { id: "mclaren", name: "McLaren" },
    { id: "alpine", name: "Alpine" },
    { id: "lotus", name: "Lotus" },
    { id: "alfa", name: "Alfa Romeo" },
    { id: "ford", name: "Ford" },
    { id: "chevrolet", name: "Chevrolet" },
    { id: "hyundai", name: "Hyundai" },
    { id: "custom", name: "Custom" }
  ];

  var CARS = [
    { id: "ae86", brand: "toyota", name: "Sprinter Trueno AE86", drive: "FR", kw: 96, kg: 940, grip: 0.95, brk: 0.95, hdl: 1.18, cda: 0.62, cla: 0, vmax: 200 },
    { id: "a80", brand: "toyota", name: "Supra RZ (A80)", drive: "FR", kw: 206, kg: 1510, grip: 1.0, brk: 1.0, hdl: 0.98, cda: 0.66, cla: 0.05, vmax: 260 },
    { id: "gr86", brand: "toyota", name: "GR86", drive: "FR", kw: 173, kg: 1270, grip: 1.0, brk: 1.0, hdl: 1.1, cda: 0.64, cla: 0.05, vmax: 226 },
    { id: "gryaris", brand: "toyota", name: "GR Yaris", drive: "4WD", kw: 200, kg: 1280, grip: 1.03, brk: 1.02, hdl: 1.08, cda: 0.66, cla: 0.05, vmax: 230 },
    { id: "ek9", brand: "honda", name: "Civic Type R (EK9)", drive: "FF", kw: 136, kg: 1070, grip: 0.98, brk: 0.98, hdl: 1.12, cda: 0.62, cla: 0, vmax: 225 },
    { id: "fk8", brand: "honda", name: "Civic Type R (FK8)", drive: "FF", kw: 228, kg: 1390, grip: 1.06, brk: 1.05, hdl: 1.05, cda: 0.66, cla: 0.2, vmax: 272 },
    { id: "s2000", brand: "honda", name: "S2000", drive: "FR", kw: 184, kg: 1250, grip: 1.02, brk: 1.0, hdl: 1.06, cda: 0.63, cla: 0.05, vmax: 240 },
    { id: "nsx", brand: "honda", name: "NSX (NA1)", drive: "MR", kw: 206, kg: 1370, grip: 1.04, brk: 1.03, hdl: 1.08, cda: 0.58, cla: 0.1, vmax: 270 },
    { id: "fc3s", brand: "mazda", name: "RX-7 (FC3S)", drive: "FR", kw: 151, kg: 1240, grip: 0.98, brk: 0.98, hdl: 1.08, cda: 0.62, cla: 0, vmax: 240 },
    { id: "fd3s", brand: "mazda", name: "RX-7 (FD3S)", drive: "FR", kw: 206, kg: 1280, grip: 1.02, brk: 1.0, hdl: 1.1, cda: 0.6, cla: 0.05, vmax: 255 },
    { id: "nd", brand: "mazda", name: "MX-5 (ND)", drive: "FR", kw: 135, kg: 1010, grip: 0.98, brk: 0.97, hdl: 1.15, cda: 0.6, cla: 0, vmax: 219 },
    { id: "r32", brand: "nissan", name: "Skyline GT-R (R32)", drive: "4WD", kw: 206, kg: 1430, grip: 1.01, brk: 1.0, hdl: 1.0, cda: 0.68, cla: 0.05, vmax: 250 },
    { id: "s15", brand: "nissan", name: "Silvia Spec-R (S15)", drive: "FR", kw: 184, kg: 1240, grip: 1.0, brk: 1.0, hdl: 1.08, cda: 0.64, cla: 0.05, vmax: 245 },
    { id: "r35", brand: "nissan", name: "GT-R (R35)", drive: "4WD", kw: 419, kg: 1750, grip: 1.08, brk: 1.08, hdl: 0.96, cda: 0.7, cla: 0.2, vmax: 315 },
    { id: "gc8", brand: "subaru", name: "Impreza WRX STi (GC8)", drive: "4WD", kw: 206, kg: 1260, grip: 1.0, brk: 1.0, hdl: 1.06, cda: 0.66, cla: 0.1, vmax: 240 },
    { id: "vab", brand: "subaru", name: "WRX STI (VAB)", drive: "4WD", kw: 227, kg: 1490, grip: 1.03, brk: 1.02, hdl: 1.02, cda: 0.68, cla: 0.15, vmax: 255 },
    { id: "brz", brand: "subaru", name: "BRZ", drive: "FR", kw: 173, kg: 1270, grip: 1.0, brk: 1.0, hdl: 1.1, cda: 0.64, cla: 0.05, vmax: 226 },
    { id: "evo3", brand: "mitsubishi", name: "Lancer Evolution III", drive: "4WD", kw: 199, kg: 1260, grip: 1.0, brk: 1.0, hdl: 1.05, cda: 0.66, cla: 0.15, vmax: 240 },
    { id: "evo9", brand: "mitsubishi", name: "Lancer Evolution IX", drive: "4WD", kw: 206, kg: 1400, grip: 1.03, brk: 1.02, hdl: 1.04, cda: 0.68, cla: 0.15, vmax: 250 },
    { id: "swift", brand: "suzuki", name: "Swift Sport", drive: "FF", kw: 103, kg: 970, grip: 0.96, brk: 0.96, hdl: 1.1, cda: 0.64, cla: 0, vmax: 210 },
    { id: "evo2", brand: "benz", name: "190E 2.5-16 Evo II", drive: "FR", kw: 173, kg: 1340, grip: 1.0, brk: 1.0, hdl: 0.98, cda: 0.64, cla: 0.15, vmax: 250 },
    { id: "a45", brand: "benz", name: "AMG A45 S", drive: "4WD", kw: 310, kg: 1630, grip: 1.04, brk: 1.04, hdl: 0.98, cda: 0.7, cla: 0.1, vmax: 270 },
    { id: "amggt", brand: "benz", name: "AMG GT", drive: "FR", kw: 390, kg: 1645, grip: 1.08, brk: 1.08, hdl: 0.96, cda: 0.66, cla: 0.2, vmax: 310 },
    { id: "e30", brand: "bmw", name: "M3 (E30)", drive: "FR", kw: 147, kg: 1200, grip: 0.99, brk: 1.0, hdl: 1.08, cda: 0.64, cla: 0.05, vmax: 235 },
    { id: "g80", brand: "bmw", name: "M3 Competition (G80)", drive: "FR", kw: 375, kg: 1730, grip: 1.06, brk: 1.06, hdl: 0.97, cda: 0.68, cla: 0.1, vmax: 290 },
    { id: "gt3", brand: "porsche", name: "911 GT3", drive: "RR", kw: 375, kg: 1435, grip: 1.1, brk: 1.1, hdl: 1.02, cda: 0.64, cla: 0.3, vmax: 318 },
    { id: "m3p", brand: "tesla", name: "Model 3 Performance", drive: "4WD", ev: true, kw: 340, kg: 1850, grip: 1.03, brk: 1.0, hdl: 0.94, cda: 0.58, cla: 0, vmax: 261 },
    { id: "plaid", brand: "tesla", name: "Model S Plaid", drive: "4WD", ev: true, kw: 750, kg: 2160, grip: 1.04, brk: 1.0, hdl: 0.88, cda: 0.56, cla: 0, vmax: 322 },
    // ---- 第三批（2026-10-26）：擴充到 60 款以上 ----
    { id: "st205", brand: "toyota", name: "Celica GT-Four (ST205)", drive: "4WD", kw: 188, kg: 1380, grip: 0.99, brk: 0.98, hdl: 1.02, cda: 0.66, cla: 0.1, vmax: 245 },
    { id: "sw20", brand: "toyota", name: "MR2 GT-S (SW20)", drive: "MR", kw: 180, kg: 1270, grip: 1.0, brk: 0.99, hdl: 1.04, cda: 0.62, cla: 0.05, vmax: 245 },
    { id: "a90", brand: "toyota", name: "GR Supra (A90)", drive: "FR", kw: 285, kg: 1520, grip: 1.05, brk: 1.04, hdl: 1.0, cda: 0.64, cla: 0.1, vmax: 250 },
    { id: "dc2", brand: "honda", name: "Integra Type R (DC2)", drive: "FF", kw: 147, kg: 1080, grip: 0.99, brk: 0.99, hdl: 1.13, cda: 0.62, cla: 0, vmax: 230 },
    { id: "nc1", brand: "honda", name: "NSX (NC1)", drive: "4WD", kw: 427, kg: 1780, grip: 1.08, brk: 1.08, hdl: 1.0, cda: 0.62, cla: 0.15, vmax: 307 },
    { id: "na6", brand: "mazda", name: "Eunos Roadster (NA)", drive: "FR", kw: 88, kg: 940, grip: 0.94, brk: 0.94, hdl: 1.17, cda: 0.6, cla: 0, vmax: 195 },
    { id: "rx8", brand: "mazda", name: "RX-8 Type S", drive: "FR", kw: 177, kg: 1310, grip: 1.0, brk: 1.0, hdl: 1.08, cda: 0.63, cla: 0.05, vmax: 240 },
    { id: "rps13", brand: "nissan", name: "180SX Type X", drive: "FR", kw: 151, kg: 1220, grip: 0.97, brk: 0.97, hdl: 1.06, cda: 0.63, cla: 0, vmax: 235 },
    { id: "r34", brand: "nissan", name: "Skyline GT-R V-spec II (R34)", drive: "4WD", kw: 206, kg: 1560, grip: 1.03, brk: 1.02, hdl: 1.0, cda: 0.68, cla: 0.15, vmax: 255 },
    { id: "z34", brand: "nissan", name: "Fairlady Z (Z34)", drive: "FR", kw: 247, kg: 1500, grip: 1.02, brk: 1.01, hdl: 1.0, cda: 0.66, cla: 0.05, vmax: 250 },
    { id: "cappuccino", brand: "suzuki", name: "Cappuccino", drive: "FR", kw: 47, kg: 700, grip: 0.93, brk: 0.95, hdl: 1.2, cda: 0.5, cla: 0, vmax: 160 },
    { id: "m4csl", brand: "bmw", name: "M4 CSL (G82)", drive: "FR", kw: 405, kg: 1625, grip: 1.09, brk: 1.08, hdl: 1.0, cda: 0.68, cla: 0.2, vmax: 307 },
    { id: "gt4", brand: "porsche", name: "718 Cayman GT4", drive: "MR", kw: 309, kg: 1420, grip: 1.08, brk: 1.07, hdl: 1.1, cda: 0.62, cla: 0.2, vmax: 304 },
    { id: "turbos", brand: "porsche", name: "911 Turbo S", drive: "4WD", kw: 478, kg: 1640, grip: 1.09, brk: 1.09, hdl: 1.0, cda: 0.64, cla: 0.2, vmax: 330 },
    { id: "taycan", brand: "porsche", name: "Taycan Turbo S", drive: "4WD", ev: true, kw: 560, kg: 2300, grip: 1.06, brk: 1.04, hdl: 0.92, cda: 0.58, cla: 0.05, vmax: 260 },
    { id: "r8", brand: "audi", name: "R8 V10 performance", drive: "4WD", kw: 456, kg: 1595, grip: 1.09, brk: 1.08, hdl: 1.02, cda: 0.62, cla: 0.2, vmax: 331 },
    { id: "rs3", brand: "audi", name: "RS 3 Sportback", drive: "4WD", kw: 294, kg: 1570, grip: 1.04, brk: 1.03, hdl: 0.98, cda: 0.66, cla: 0.05, vmax: 290 },
    { id: "gti", brand: "vw", name: "Golf GTI (Mk8)", drive: "FF", kw: 180, kg: 1430, grip: 1.0, brk: 1.0, hdl: 1.02, cda: 0.65, cla: 0, vmax: 250 },
    { id: "golfr", brand: "vw", name: "Golf R (Mk8)", drive: "4WD", kw: 235, kg: 1500, grip: 1.02, brk: 1.02, hdl: 1.0, cda: 0.66, cla: 0.05, vmax: 270 },
    { id: "f40", brand: "ferrari", name: "F40", drive: "MR", kw: 352, kg: 1250, grip: 1.02, brk: 1.0, hdl: 0.96, cda: 0.6, cla: 0.15, vmax: 324 },
    { id: "f488", brand: "ferrari", name: "488 GTB", drive: "MR", kw: 492, kg: 1475, grip: 1.09, brk: 1.09, hdl: 1.02, cda: 0.62, cla: 0.25, vmax: 330 },
    { id: "huracan", brand: "lamborghini", name: "Hurac\u00e1n EVO", drive: "4WD", kw: 470, kg: 1420, grip: 1.1, brk: 1.09, hdl: 1.0, cda: 0.62, cla: 0.25, vmax: 325 },
    { id: "m570s", brand: "mclaren", name: "570S", drive: "MR", kw: 419, kg: 1440, grip: 1.08, brk: 1.08, hdl: 1.04, cda: 0.6, cla: 0.2, vmax: 328 },
    { id: "m720s", brand: "mclaren", name: "720S", drive: "MR", kw: 530, kg: 1420, grip: 1.1, brk: 1.1, hdl: 1.02, cda: 0.6, cla: 0.3, vmax: 341 },
    { id: "a110", brand: "alpine", name: "A110 S", drive: "MR", kw: 220, kg: 1110, grip: 1.03, brk: 1.02, hdl: 1.14, cda: 0.6, cla: 0.05, vmax: 260 },
    { id: "elise", brand: "lotus", name: "Elise Sport", drive: "MR", kw: 100, kg: 870, grip: 1.0, brk: 0.99, hdl: 1.18, cda: 0.58, cla: 0.05, vmax: 205 },
    { id: "exige", brand: "lotus", name: "Exige Sport 380", drive: "MR", kw: 280, kg: 1110, grip: 1.08, brk: 1.06, hdl: 1.12, cda: 0.62, cla: 0.25, vmax: 286 },
    { id: "a4c", brand: "alfa", name: "4C", drive: "MR", kw: 177, kg: 1000, grip: 1.01, brk: 1.0, hdl: 1.1, cda: 0.6, cla: 0.05, vmax: 258 },
    { id: "giulia", brand: "alfa", name: "Giulia Quadrifoglio", drive: "FR", kw: 375, kg: 1620, grip: 1.05, brk: 1.05, hdl: 1.0, cda: 0.64, cla: 0.05, vmax: 307 },
    { id: "mustang", brand: "ford", name: "Mustang GT", drive: "FR", kw: 336, kg: 1750, grip: 1.0, brk: 0.98, hdl: 0.92, cda: 0.72, cla: 0.05, vmax: 250 },
    { id: "focusrs", brand: "ford", name: "Focus RS", drive: "4WD", kw: 257, kg: 1550, grip: 1.02, brk: 1.01, hdl: 1.0, cda: 0.67, cla: 0.05, vmax: 266 },
    { id: "c8", brand: "chevrolet", name: "Corvette Stingray (C8)", drive: "MR", kw: 369, kg: 1530, grip: 1.06, brk: 1.05, hdl: 0.98, cda: 0.62, cla: 0.1, vmax: 312 },
    { id: "i30n", brand: "hyundai", name: "i30 N", drive: "FF", kw: 206, kg: 1430, grip: 1.0, brk: 1.0, hdl: 1.02, cda: 0.65, cla: 0.05, vmax: 250 },
    { id: "ioniq5n", brand: "hyundai", name: "IONIQ 5 N", drive: "4WD", ev: true, kw: 478, kg: 2200, grip: 1.05, brk: 1.03, hdl: 0.93, cda: 0.66, cla: 0.05, vmax: 260 }
  ];

  // 自製車：滑桿範圍（drive 由玩家選）
  var CUSTOM = {
    base: { id: "custom", brand: "custom", name: "Custom", drive: "FR", kw: 160, kg: 1200, grip: 1.0, brk: 1.0, hdl: 1.0, cda: 0.64, cla: 0.05, vmax: 250 },
    range: {
      kw: [60, 500, 5], kg: [700, 2200, 10], grip: [0.9, 1.15, 0.01], brk: [0.9, 1.15, 0.01], hdl: [0.85, 1.2, 0.01], vmax: [180, 320, 5]
    }
  };

  var DRIVES = ["FF", "FR", "MR", "RR", "4WD"];

  // 驅動方式：share＝驅動輪的載重比例（出彎牽引）、bal＝橫向抓地修正、tol＝甩尾還救得回來的極限倍率、
  // low＝低抓地路面（冬天、雨天）額外加成
  var DRIVE_INFO = {
    FF: { share: 0.62, bal: 0.98, tol: 1.07, low: 1.0 },
    FR: { share: 0.55, bal: 1.0, tol: 1.1, low: 1.0 },
    MR: { share: 0.6, bal: 1.03, tol: 1.06, low: 1.0 },
    RR: { share: 0.64, bal: 0.99, tol: 1.07, low: 1.0 },
    "4WD": { share: 1.0, bal: 1.0, tol: 1.08, low: 1.08 }
  };

  // 輪胎×季節的抓地倍率
  var TIRES = {
    sport: { name: C("運動胎", "スポーツタイヤ", "Sport"), spring: 1.0, summer: 1.0, autumn: 1.0, winter: 0.85, wet: 1.0 },
    soft: { name: C("軟胎（高抓地）", "ソフト（ハイグリップ）", "Soft"), spring: 1.05, summer: 1.08, autumn: 1.05, winter: 0.72, wet: 0.95 },
    hard: { name: C("硬胎（穩定）", "ハード（安定）", "Hard"), spring: 0.96, summer: 0.97, autumn: 0.96, winter: 0.85, wet: 1.0 },
    snow: { name: C("雪胎", "スタッドレス", "Snow"), spring: 0.86, summer: 0.8, autumn: 0.87, winter: 1.3, wet: 1.0 }
  };
  var TIRE_IDS = ["sport", "soft", "hard", "snow"];

  // 季節：mu＝路面基本抓地、rain＝下雨機率、leaf／ice＝落葉／結冰路段（每公里幾處）、sigma＝車手失誤放大
  var SEASONS = {
    spring: { name: C("春", "春", "Spring"), mu: 0.98, rain: 0.45, leaf: 0, ice: 0, sigma: 1.0 },
    summer: { name: C("夏", "夏", "Summer"), mu: 1.0, rain: 0, leaf: 0, ice: 0, sigma: 1.0 },
    autumn: { name: C("秋", "秋", "Autumn"), mu: 0.98, rain: 0, leaf: 2.6, ice: 0, sigma: 1.05 },
    winter: { name: C("冬", "冬", "Winter"), mu: 0.62, rain: 0, leaf: 0, ice: 2.4, sigma: 1.3 }
  };
  var SEASON_IDS = ["spring", "summer", "autumn", "winter"];

  // 車手風格（比賽中也可以隨時切換＝戰略）：f＝敢用到抓地極限的幾成、sigma＝每個彎的入彎速度誤差（標準差）、
  // pass＝每秒嘗試超車的機率、block＝自己在前面時，後車超車機率的倍率（防守跑線）
  var STYLES = {
    calm: { name: C("保守", "慎重", "Steady"), f: 0.92, sigma: 0.01, pass: 0.25, block: 1 },
    balanced: { name: C("均衡", "バランス", "Balanced"), f: 0.955, sigma: 0.018, pass: 0.5, block: 1 },
    attack: { name: C("全力", "全開", "All-out"), f: 0.98, sigma: 0.03, pass: 0.85, block: 1 },
    defend: { name: C("防守", "ブロック", "Defend"), f: 0.945, sigma: 0.016, pass: 0.2, block: 0.3 }
  };
  var STYLE_IDS = ["calm", "balanced", "attack", "defend"];

  // 改裝點數（市售車）／每項上限
  var UPGRADE_POINTS = 6;
  var UPGRADE_MAX = 4;
  var UPGRADES = ["eng", "wt", "brk", "hdl"];

  // 特殊路面（路段的 sf）：mu＝抓地倍率、winter＝冬天再乘、dry＝不受雨雪影響（隧道；值＝冬天的倍率，抵銷積雪）
  //   code 從 1 開始，對應 SURFACE_IDS 的順序（buildTrack 的 tr.sp 存 code）
  var SURFACES = {
    gravel: { code: 1, mu: 0.72 },
    gutter: { code: 2, mu: 1.15 },
    tunnel: { code: 3, mu: 1, dry: 1.35 },
    bridge: { code: 4, mu: 1, winter: 0.8 }
  };
  var SURFACE_IDS = ["gravel", "gutter", "tunnel", "bridge"];

  // 路段零件（玩家輪流挑選；L／R 會鏡像角度）
  //   S＝直線 len；C＝彎道 ang（度，正＝左彎）、r（半徑 m）；坡度寫死的段（例如盲坡）不受玩家選的坡度影響
  var PIECES = [
    { id: "straight_s", segs: [["S", 100]] },
    { id: "straight_l", segs: [["S", 260]] },
    { id: "sweep", segs: [["C", 45, 140]] },
    { id: "medium", segs: [["C", 75, 60]] },
    { id: "tight", segs: [["C", 90, 28]] },
    { id: "hairpin", segs: [["C", 172, 14]] },
    { id: "s_curve", segs: [["C", 50, 70], ["S", 20], ["C", -50, 70]] },
    { id: "double_hairpin", segs: [["C", 172, 14], ["S", 55], ["C", -172, 14]] },
    { id: "kink", segs: [["C", 15, 300]] },
    { id: "long_sweep", segs: [["C", 120, 110]] },
    { id: "hairpin_wide", segs: [["C", 180, 28]] },
    { id: "chicane", segs: [["C", 35, 25], ["C", -70, 25], ["C", 35, 25]] },
    { id: "decreasing", segs: [["C", 40, 90], ["C", 50, 40], ["C", 50, 20]] },
    { id: "increasing", segs: [["C", 50, 20], ["C", 50, 40], ["C", 40, 90]] },
    { id: "esses", segs: [["C", 40, 60], ["C", -40, 60], ["C", 40, 60], ["C", -40, 60]] },
    { id: "triple_hairpin", segs: [["C", 172, 14], ["S", 50], ["C", -172, 14], ["S", 50], ["C", 172, 14]] },
    { id: "spiral", segs: [["C", 340, 32]] },
    // ---- 第三批：起伏、特殊路面、複合彎 ----
    { id: "crest", segs: [["S", 70, -6], ["S", 70, 12]] },                                 // 盲坡：爬上去才看得到後面
    { id: "dip", segs: [["S", 60, 12], ["S", 60, -6]] },                                   // 窪地：衝下去再拉起來
    { id: "dive", segs: [["C", 60, 80, 14], ["S", 140, 14]] },                             // 急降彎
    { id: "gutter_hairpin", segs: [["C", 175, 13, null, "gutter"]] },                      // 溝落髮夾：內側排水溝可以「掛」住，過彎更快
    { id: "gravel", segs: [["S", 160, null, "gravel"]] },                                  // 碎石路
    { id: "gravel_corner", segs: [["C", 90, 40, null, "gravel"]] },                        // 碎石彎
    { id: "tunnel", segs: [["S", 240, null, "tunnel"]] },                                  // 隧道：沒有雨雪
    { id: "tunnel_curve", segs: [["C", 70, 120, null, "tunnel"], ["S", 60, null, "tunnel"]] },
    { id: "bridge", segs: [["S", 180, 0, "bridge"]] },                                     // 橋：冬天先結冰
    { id: "snake", segs: [["C", 35, 45], ["C", -45, 45], ["C", 45, 45], ["C", -45, 45], ["C", 45, 45], ["C", -35, 45]] },
    { id: "fishhook", segs: [["S", 280], ["C", 165, 16]] },                                // 魚鉤：長直線直接接髮夾
    { id: "carousel", segs: [["C", 210, 42]] },                                            // 迴旋彎：超過 180° 的大 U
    { id: "double_apex", segs: [["C", 70, 38], ["S", 25], ["C", 70, 38]] },                // 雙頂點
    { id: "switchback", segs: [["C", 172, 13, 12], ["S", 35, 12], ["C", -172, 13, 12], ["S", 35, 12], ["C", 172, 13, 12], ["S", 35, 12], ["C", -172, 13, 12]] },
    { id: "cliff_run", segs: [["C", 25, 160], ["S", 120], ["C", -30, 140], ["S", 120], ["C", 25, 160]] } // 斷崖高速段
  ];

  // 組合技：連續放下的零件符合標籤順序就成立（標籤見 dejavu_core.js 的 pieceTags）；只是命名與展示，不影響物理
  var COMBOS = [
    { id: "hairpin_hell", seq: ["hp", "hp", "hp"] },
    { id: "late_brake", seq: ["ls", "hp"] },
    { id: "top_speed", seq: ["ls", "ls"] },
    { id: "rollercoaster", seq: ["cr", "cr"] },
    { id: "blind_hairpin", seq: ["cr", "hp"] },
    { id: "rally", seq: ["gv", "gv"] },
    { id: "dark_hairpin", seq: ["tn", "hp"] },
    { id: "snake_pit", seq: ["sn", "sn"] },
    { id: "sky_loop", seq: ["br", "sp"] },
    { id: "high_speed_ring", seq: ["fa", "fa", "fa"] }
  ];
  var GRADES = [-5, 0, 5, 9, 13]; // 上坡段／平／緩下／陡下／極陡（%）

  // 固定山路（風格化，非實際測量）：w＝路寬、g＝預設坡度（%，下坡為正）、cat＝"touge"（山道，預設）／"mfg"（MF Ghost 風格公路賽）、
  // scene＝路邊景觀（預設山林；"lake" 湖、"sea" 海）、water＝水在行進方向的哪一側（1 左、-1 右）
  // 段格式：["S", 長度, 坡度?]、["C", 角度, 半徑, 坡度?]
  var COURSES = [
    {
      id: "akina", name: C("秋名山", "秋名山", "Akina"), w: 6.5, g: 7,
      desc: C("著名的五連續髮夾彎，前段高速、後段考驗煞車與甩尾", "有名な五連ヘアピン。前半は高速、後半はブレーキとドリフト勝負", "Famous five consecutive hairpins"),
      segs: [["S", 200], ["C", 35, 180], ["S", 150], ["C", -60, 90], ["S", 120], ["C", 90, 35], ["S", 90], ["C", -80, 45], ["S", 260],
        ["C", 170, 14, 9], ["S", 70, 9], ["C", -170, 14, 9], ["S", 70, 9], ["C", 170, 15, 9], ["S", 60, 9], ["C", -170, 14, 9], ["S", 70, 9], ["C", 165, 15, 9],
        ["S", 200], ["C", -50, 120], ["S", 150], ["C", 70, 50], ["S", 110], ["C", -90, 30], ["S", 240], ["C", 45, 150], ["S", 120], ["C", -30, 200], ["S", 150]]
    },
    {
      id: "myogi", name: C("妙義山", "妙義山", "Myogi"), w: 6.5, g: 7,
      desc: C("中速技術彎連續，中段一條長直線後接兩個大髮夾", "テクニカルな中速コーナーの連続。中盤の長いストレートの先に大きなヘアピン", "Technical mid-speed corners, a long straight into two hairpins"),
      segs: [["S", 180], ["C", 60, 70], ["S", 100], ["C", -75, 45], ["S", 90], ["C", 90, 30], ["S", 60], ["C", -120, 22], ["S", 220], ["C", 45, 120], ["S", 160],
        ["C", -170, 16, 9], ["S", 80, 9], ["C", 160, 18, 9], ["S", 260], ["C", -60, 80], ["S", 120], ["C", 80, 40], ["S", 90], ["C", -90, 35], ["S", 200], ["C", 50, 100], ["S", 150]]
    },
    {
      id: "haruna", name: C("榛名山", "榛名山", "Haruna"), w: 7, g: 7, scene: "lake", water: 1,
      desc: C("從湖畔出發的下坡，前段高速、後段髮夾彎", "湖畔からスタートするダウンヒル。前半高速、後半ヘアピン", "Downhill from the lakeside: fast first half, hairpins later"),
      segs: [["S", 220], ["C", 30, 200], ["S", 180], ["C", -50, 120], ["S", 150], ["C", 70, 60], ["S", 120], ["C", -90, 40], ["S", 100], ["C", 170, 15, 9], ["S", 70, 9],
        ["C", -165, 16, 9], ["S", 80], ["C", 100, 30], ["S", 200], ["C", -40, 160], ["S", 140], ["C", 60, 70], ["S", 180]]
    },
    {
      id: "usui", name: C("碓冰", "碓氷", "Usui"), w: 5.5, g: 6,
      desc: C("路窄彎多，幾乎沒有超車點，前車就是一道牆", "狭くてコーナーだらけ。抜きどころがほぼない", "Narrow and twisty, almost nowhere to pass"),
      segs: [["S", 120], ["C", 80, 25], ["S", 40], ["C", -90, 22], ["S", 50], ["C", 100, 20], ["S", 40], ["C", -70, 30], ["S", 60], ["C", 120, 18], ["S", 35],
        ["C", -110, 20], ["S", 70], ["C", 85, 25], ["S", 40], ["C", -95, 22], ["S", 90], ["C", 130, 16], ["S", 40], ["C", -80, 28], ["S", 60], ["C", 90, 24],
        ["S", 50], ["C", -100, 20], ["S", 120], ["C", 60, 40], ["S", 80], ["C", -75, 30], ["S", 100]]
    },
    {
      id: "akagi", name: C("赤城", "赤城", "Akagi"), w: 8, g: 6,
      desc: C("路寬、長直線多的高速山路，有兩個大髮夾", "道幅が広く長いストレートが多い高速峠。大きなヘアピンが二つ", "Wide, fast, long straights"),
      segs: [["S", 350], ["C", 30, 250], ["S", 300], ["C", -60, 100], ["S", 200], ["C", 90, 45], ["S", 250], ["C", -170, 18], ["S", 300], ["C", 45, 160], ["S", 280],
        ["C", -80, 60], ["S", 220], ["C", 170, 16], ["S", 350], ["C", -40, 200], ["S", 250], ["C", 70, 70], ["S", 300]]
    },
    {
      id: "hakone", name: C("箱根七曲", "箱根七曲り", "Hakone Nanamagari"), w: 6, g: 10,
      desc: C("陡坡上連續七個彎，煞車與車重決勝負", "急勾配に七つの連続コーナー。ブレーキと車重が勝負", "Seven bends on a steep grade"),
      segs: [["S", 150], ["C", 40, 120], ["S", 100], ["C", 160, 15, 11], ["S", 45, 11], ["C", -160, 15, 11], ["S", 45, 11], ["C", 165, 14, 11], ["S", 50, 11],
        ["C", -155, 16, 11], ["S", 45, 11], ["C", 160, 15, 11], ["S", 50, 11], ["C", -165, 14, 11], ["S", 45, 11], ["C", 160, 15, 11], ["S", 150], ["C", -50, 100],
        ["S", 200], ["C", 60, 80], ["S", 150]]
    },
    // ---- MF Ghost 風格的公路賽場（cat: "mfg"；風格化，不是實際路線） ----
    {
      id: "odawara", cat: "mfg", name: C("小田原派克峰", "小田原パイクスピーク", "Odawara Pikes Peak"), w: 8, g: 9,
      desc: C("寬闊收費公路的陡下坡，高速彎一路連到底", "広い有料道路の急な下り。高速コーナーが延々と続く", "Steep downhill on a wide toll road, fast sweepers all the way"),
      segs: [["S", 400], ["C", 35, 220], ["S", 300], ["C", -50, 160], ["S", 250], ["C", 70, 90], ["S", 200], ["C", -90, 70], ["S", 300], ["C", 40, 200], ["S", 350],
        ["C", -120, 50], ["S", 200], ["C", 60, 120], ["S", 300], ["C", -30, 260], ["S", 300]]
    },
    {
      id: "ashinoko", cat: "mfg", name: C("蘆之湖 GT", "芦ノ湖GT", "Ashinoko GT"), w: 7.5, g: 5, scene: "lake", water: -1,
      desc: C("沿著湖岸的高速段，接上山腰的急髮夾", "湖岸沿いの高速区間から山腹のきついヘアピンへ", "Fast lakeside run into a tight mountainside hairpin"),
      segs: [["S", 250], ["C", 45, 140], ["S", 200], ["C", -80, 60], ["S", 150], ["C", 100, 40], ["S", 120], ["C", -60, 90], ["S", 280], ["C", 30, 250], ["S", 200],
        ["C", -150, 25], ["S", 150], ["C", 90, 50], ["S", 220], ["C", -45, 150], ["S", 250]]
    },
    {
      id: "manazuru", cat: "mfg", name: C("真鶴半島", "ザ・ペニンシュラ真鶴", "The Peninsula Manazuru"), w: 6, g: 4, scene: "sea", water: -1,
      desc: C("海岸邊的窄路，連續急彎，幾乎沒有喘息", "海沿いの狭い道。きついコーナーが息つく暇なく続く", "Narrow coastal road with relentless tight corners"),
      segs: [["S", 150], ["C", 70, 35], ["S", 80], ["C", -60, 40], ["S", 100], ["C", 110, 25], ["S", 60], ["C", -90, 30], ["S", 120], ["C", 50, 60], ["S", 90],
        ["C", -120, 22], ["S", 70], ["C", 80, 35], ["S", 110], ["C", -70, 40], ["S", 150], ["C", 100, 28], ["S", 120]]
    },
    {
      id: "atami", cat: "mfg", name: C("熱海海濱雙線", "シーサイドダブルレーン", "Seaside Double Lane"), w: 9.5, g: 3, scene: "sea", water: -1,
      desc: C("海邊的雙線道，路寬能並排，極速與超車的戰場", "海沿いの片側二車線。並走できる道幅で最高速と追い抜きの勝負", "Wide seaside dual carriageway: top speed and overtaking"),
      segs: [["S", 500], ["C", 25, 300], ["S", 400], ["C", -40, 220], ["S", 350], ["C", 60, 150], ["S", 300], ["C", -35, 250], ["S", 450], ["C", 90, 80], ["S", 300],
        ["C", -50, 180], ["S", 400]]
    }
  ];

  var COLORS = ["#e8e8e8", "#d33a2c", "#2f6fd6", "#f2c230", "#2e9e5b", "#8e44ad", "#ff7f27", "#222222", "#19b5c9", "#ff6fae", "#8bc34a", "#8d6e63"];
  var MAX_CARS = 12;

  root.PriTestDejavuData = {
    C: C, BRANDS: BRANDS, CARS: CARS, CUSTOM: CUSTOM, DRIVES: DRIVES, DRIVE_INFO: DRIVE_INFO,
    TIRES: TIRES, TIRE_IDS: TIRE_IDS, SEASONS: SEASONS, SEASON_IDS: SEASON_IDS, STYLES: STYLES, STYLE_IDS: STYLE_IDS,
    UPGRADE_POINTS: UPGRADE_POINTS, UPGRADE_MAX: UPGRADE_MAX, UPGRADES: UPGRADES,
    PIECES: PIECES, GRADES: GRADES, SURFACES: SURFACES, SURFACE_IDS: SURFACE_IDS, COMBOS: COMBOS, COURSES: COURSES, COLORS: COLORS, MAX_CARS: MAX_CARS,
    car: function (id) { for (var i = 0; i < CARS.length; i++) if (CARS[i].id === id) return CARS[i]; return null; },
    course: function (id) { for (var i = 0; i < COURSES.length; i++) if (COURSES[i].id === id) return COURSES[i]; return null; },
    piece: function (id) { for (var i = 0; i < PIECES.length; i++) if (PIECES[i].id === id) return PIECES[i]; return null; }
  };
})();
