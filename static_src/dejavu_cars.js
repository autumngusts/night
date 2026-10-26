// DÉJÀ VU 山道下坡（dejavu）：擴充車款（2026-10-26 第六批，62 → 300 款）。在 dejavu_data.js 之後、dejavu_core.js 之前載入。
// 跟 dejavu_data.js 一樣是「風格化的近似值」，只用來讓各車有不同個性，不是原廠數據。
// 為了好維護，每台車只寫 [id, 車名, 驅動, kW, kg, 極速, 車種]（必要時再加覆寫物件），
// 抓地／煞車／操控／空阻／下壓力由車種（CLASSES）推算，操控再依車重微調（重車比較鈍）。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestDejavuData;
  if (!D) return;

  // 車種：o 老車（80 年代以前）、k 輕自動車、h 鋼炮／性能房車、s 跑車、g GT／重型性能車、x 超跑、r 賽道特化／極速超跑、
  //       l 輕量賽道玩具（Caterham、Ariel 這類）、e 電動房車、u SUV／休旅／貨車（純娛樂）
  var CLASSES = {
    o: { grip: 0.93, brk: 0.93, hdl: 1.08, cda: 0.64, cla: 0 },
    k: { grip: 0.94, brk: 0.95, hdl: 1.16, cda: 0.55, cla: 0 },
    h: { grip: 1.0, brk: 1.0, hdl: 1.04, cda: 0.66, cla: 0.05 },
    s: { grip: 1.01, brk: 1.0, hdl: 1.07, cda: 0.63, cla: 0.05 },
    g: { grip: 1.03, brk: 1.03, hdl: 0.97, cda: 0.66, cla: 0.1 },
    x: { grip: 1.08, brk: 1.08, hdl: 1.01, cda: 0.61, cla: 0.22 },
    r: { grip: 1.12, brk: 1.11, hdl: 1.04, cda: 0.64, cla: 0.35 },
    l: { grip: 1.05, brk: 1.03, hdl: 1.18, cda: 0.7, cla: 0.1 },
    e: { grip: 1.03, brk: 1.0, hdl: 0.93, cda: 0.58, cla: 0, ev: true },
    u: { grip: 0.96, brk: 0.96, hdl: 0.88, cda: 0.82, cla: 0 }
  };
  D.CAR_CLASSES = ["o", "k", "h", "s", "g", "x", "r", "l", "e", "u"];

  var NEW_BRANDS = [
    { id: "lexus", name: "Lexus" }, { id: "daihatsu", name: "Daihatsu" }, { id: "mini", name: "MINI" },
    { id: "dodge", name: "Dodge" }, { id: "kia", name: "Kia" }, { id: "peugeot", name: "Peugeot" }, { id: "renault", name: "Renault" },
    { id: "abarth", name: "Abarth" }, { id: "lancia", name: "Lancia" }, { id: "maserati", name: "Maserati" },
    { id: "aston", name: "Aston Martin" }, { id: "jaguar", name: "Jaguar" }, { id: "koenigsegg", name: "Koenigsegg" },
    { id: "pagani", name: "Pagani" }, { id: "bugatti", name: "Bugatti" }, { id: "rimac", name: "Rimac" },
    { id: "caterham", name: "Caterham" }, { id: "ariel", name: "Ariel" }, { id: "xiaomi", name: "Xiaomi" },
    { id: "byd", name: "BYD" }, { id: "lucid", name: "Lucid" }, { id: "dmc", name: "DeLorean" }
  ];
  // 「Custom」維持在最後一個
  var custom = D.BRANDS.pop();
  NEW_BRANDS.forEach(function (b) { D.BRANDS.push(b); });
  D.BRANDS.push(custom);

  function r2(x) { return Math.round(x * 100) / 100; }
  function add(brand, rows) {
    rows.forEach(function (a) {
      var c = CLASSES[a[6]];
      var car = {
        id: a[0], brand: brand, name: a[1], drive: a[2], kw: a[3], kg: a[4], vmax: a[5], cls: a[6],
        grip: c.grip, brk: c.brk, hdl: r2(Math.max(0.82, Math.min(1.22, c.hdl - (a[4] - 1300) * 0.00006))), cda: c.cda, cla: c.cla
      };
      if (c.ev) car.ev = true;
      var ov = a[7];
      if (ov) Object.keys(ov).forEach(function (k) { car[k] = ov[k]; });
      D.CARS.push(car);
    });
  }

  add("toyota", [
    ["ae85", "Corolla Levin (AE85)", "FR", 61, 930, 175, "o"],
    ["ae101", "Corolla Levin GT-APEX (AE101)", "FF", 118, 1060, 205, "h"],
    ["ae111", "Sprinter Trueno BZ-R (AE111)", "FF", 121, 1080, 210, "h"],
    ["ep91", "Starlet Glanza V (EP91)", "FF", 99, 930, 200, "h"],
    ["ta22", "Celica 1600GT (TA22)", "FR", 85, 940, 190, "o"],
    ["ma70", "Supra 3.0GT Turbo (MA70)", "FR", 172, 1550, 235, "g"],
    ["aw11", "MR2 (AW11)", "MR", 96, 1000, 200, "o"],
    ["zzw30", "MR-S (ZZW30)", "MR", 103, 970, 200, "s"],
    ["jzx90", "Mark II Tourer V (JZX90)", "FR", 206, 1490, 245, "g"],
    ["jzx100", "Chaser Tourer V (JZX100)", "FR", 206, 1510, 250, "g"],
    ["altezza", "Altezza RS200 (SXE10)", "FR", 154, 1350, 225, "s"],
    ["crown", "Crown Athlete (S210)", "FR", 232, 1600, 240, "g"],
    ["t2000gt", "2000GT", "FR", 110, 1120, 220, "o"],
    ["grcorolla", "GR Corolla", "4WD", 224, 1470, 230, "h"],
    ["hiace", "HiAce Super GL", "FR", 107, 1950, 170, "u"]
  ]);
  add("lexus", [
    ["lfa", "LFA", "FR", 412, 1480, 325, "x"],
    ["rcf", "RC F", "FR", 351, 1765, 270, "g"],
    ["isf", "IS F", "FR", 311, 1700, 270, "g"],
    ["gsf", "GS F", "FR", 351, 1830, 270, "g"],
    ["lc500", "LC 500", "FR", 351, 1940, 270, "g"],
    ["rz450e", "RZ 450e", "4WD", 230, 2100, 160, "e"]
  ]);
  add("honda", [
    ["ef8", "CR-X SiR (EF8)", "FF", 110, 900, 200, "h"],
    ["ef9", "Civic SiR (EF9)", "FF", 118, 990, 205, "h"],
    ["eg6", "Civic SiR-II (EG6)", "FF", 125, 1050, 210, "h"],
    ["ep3", "Civic Type R (EP3)", "FF", 158, 1190, 235, "h"],
    ["fd2", "Civic Type R (FD2)", "FF", 165, 1270, 240, "h", { grip: 1.02 }],
    ["fl5", "Civic Type R (FL5)", "FF", 243, 1430, 275, "h", { grip: 1.06, cla: 0.2 }],
    ["dc5", "Integra Type R (DC5)", "FF", 162, 1180, 235, "h"],
    ["bb6", "Prelude SiR (BB6)", "FF", 162, 1290, 230, "s"],
    ["cl7", "Accord Euro R (CL7)", "FF", 162, 1360, 235, "h"],
    ["na2", "NSX Type R (NA2)", "MR", 213, 1270, 275, "x", { cla: 0.12 }],
    ["beat", "Beat", "MR", 47, 760, 140, "k"],
    ["s660", "S660", "MR", 47, 830, 140, "k"]
  ]);
  add("mazda", [
    ["sa22c", "Savanna RX-7 (SA22C)", "FR", 96, 1020, 200, "o"],
    ["nb8c", "Roadster (NB)", "FR", 107, 1030, 205, "s"],
    ["nc", "MX-5 (NC)", "FR", 125, 1100, 215, "s"],
    ["ndrf", "MX-5 RF", "FR", 135, 1100, 220, "s"],
    ["fdspirit", "RX-7 Spirit R (FD3S)", "FR", 206, 1270, 260, "s", { grip: 1.04 }],
    ["cosmo", "Eunos Cosmo 20B", "FR", 206, 1610, 255, "g"],
    ["mps3", "Mazda3 MPS", "FF", 191, 1460, 250, "h"],
    ["az1", "Autozam AZ-1", "MR", 47, 720, 140, "k"]
  ]);
  add("nissan", [
    ["s30", "Fairlady 240Z (S30)", "FR", 110, 1010, 210, "o"],
    ["kpgc10", "Skyline 2000GT-R (KPGC10)", "FR", 118, 1120, 200, "o"],
    ["s13", "Silvia K's (S13)", "FR", 129, 1170, 225, "s"],
    ["sileighty", "Sileighty", "FR", 151, 1200, 235, "s"],
    ["s14", "Silvia K's (S14)", "FR", 162, 1240, 235, "s"],
    ["a31", "Cefiro (A31)", "FR", 151, 1300, 225, "s"],
    ["hcr32", "Skyline GTS-t Type M (HCR32)", "FR", 158, 1310, 230, "s"],
    ["r33", "Skyline GT-R (R33)", "4WD", 206, 1530, 250, "g"],
    ["z32", "Fairlady Z (Z32)", "FR", 206, 1570, 250, "g"],
    ["z33", "Fairlady Z (Z33)", "FR", 206, 1450, 250, "s"],
    ["rz34", "Fairlady Z (RZ34)", "FR", 298, 1590, 250, "g"],
    ["gtir", "Pulsar GTI-R", "4WD", 169, 1220, 230, "h"],
    ["k12", "March 12SR (K12)", "FF", 81, 1000, 185, "h"],
    ["r35nismo", "GT-R NISMO (R35)", "4WD", 441, 1720, 315, "x"],
    ["leafnismo", "Leaf NISMO", "FF", 110, 1600, 150, "e"],
    ["notenismo", "Note e-POWER NISMO", "FF", 100, 1250, 160, "e"]
  ]);
  add("subaru", [
    ["gdb", "Impreza WRX STI (GDB)", "4WD", 206, 1430, 250, "h"],
    ["grb", "Impreza WRX STI (GRB)", "4WD", 227, 1480, 255, "h"],
    ["s22b", "Impreza 22B STi", "4WD", 206, 1270, 250, "h", { grip: 1.04 }],
    ["b4", "Legacy B4 RSK", "4WD", 206, 1430, 245, "g"],
    ["svx", "Alcyone SVX", "4WD", 177, 1620, 240, "g"],
    ["zd8", "BRZ (ZD8)", "FR", 174, 1270, 226, "s"]
  ]);
  add("mitsubishi", [
    ["evo4", "Lancer Evolution IV", "4WD", 206, 1350, 245, "h"],
    ["evo5", "Lancer Evolution V", "4WD", 206, 1360, 245, "h"],
    ["evo6", "Lancer Evolution VI TME", "4WD", 206, 1360, 245, "h", { grip: 1.02 }],
    ["evo8", "Lancer Evolution VIII MR", "4WD", 206, 1400, 250, "h", { grip: 1.02 }],
    ["evo10", "Lancer Evolution X", "4WD", 221, 1530, 250, "h"],
    ["gto", "GTO Twin Turbo", "4WD", 206, 1700, 250, "g"],
    ["fto", "FTO GPX", "FF", 147, 1170, 225, "s"]
  ]);
  add("suzuki", [
    ["zc31s", "Swift Sport (ZC31S)", "FF", 92, 1060, 200, "h"],
    ["altoworks", "Alto Works (HA36S)", "FF", 47, 670, 150, "k"],
    ["keiworks", "Kei Works", "FF", 47, 760, 145, "k"],
    ["cara", "Cara", "MR", 47, 720, 140, "k"],
    ["jimny", "Jimny Sierra", "4WD", 75, 1090, 145, "u"]
  ]);
  add("daihatsu", [
    ["copen", "Copen GR SPORT", "FF", 47, 850, 150, "k"],
    ["mira", "Mira TR-XX", "FF", 47, 650, 150, "k"],
    ["storia", "Storia X4", "4WD", 88, 840, 180, "h"],
    ["charade", "Charade GTti", "FF", 74, 820, 185, "h"]
  ]);
  add("benz", [
    ["sl300", "300SL Gullwing", "FR", 160, 1300, 260, "o"],
    ["c63", "C63 AMG (W204)", "FR", 336, 1730, 280, "g"],
    ["cla45", "AMG CLA 45 S", "4WD", 310, 1675, 270, "h"],
    ["sl55", "SL55 AMG (R230)", "FR", 380, 1880, 300, "g"],
    ["sls", "SLS AMG", "FR", 420, 1620, 317, "x"],
    ["gtbs", "AMG GT Black Series", "FR", 537, 1520, 325, "r"],
    ["amgone", "AMG ONE", "4WD", 782, 1695, 352, "r"],
    ["eqs53", "AMG EQS 53", "4WD", 560, 2650, 220, "e"],
    ["g63", "AMG G 63", "4WD", 430, 2560, 220, "u"]
  ]);
  add("bmw", [
    ["b2002", "2002 Turbo", "FR", 125, 1080, 211, "o"],
    ["m1", "M1", "MR", 204, 1300, 262, "o"],
    ["e36", "M3 (E36)", "FR", 236, 1460, 250, "s"],
    ["e46csl", "M3 CSL (E46)", "FR", 265, 1385, 250, "s", { grip: 1.04 }],
    ["e92", "M3 (E92)", "FR", 309, 1655, 280, "g"],
    ["f80", "M3 (F80)", "FR", 317, 1560, 280, "g"],
    ["m2c", "M2 Competition (F87)", "FR", 302, 1575, 280, "s"],
    ["g87", "M2 (G87)", "FR", 338, 1725, 285, "g"],
    ["e39", "M5 (E39)", "FR", 294, 1720, 250, "g"],
    ["f90", "M5 Competition (F90)", "4WD", 460, 1940, 305, "g"],
    ["z4m", "Z4 M Coupé", "FR", 252, 1420, 250, "s"],
    ["m1c", "1 Series M Coupé", "FR", 250, 1495, 250, "s"],
    ["i8", "i8", "4WD", 275, 1535, 250, "g"]
  ]);
  add("mini", [
    ["mini1275", "Mini Cooper 1275S", "FF", 57, 650, 160, "o", { hdl: 1.2 }],
    ["r53", "Cooper S (R53)", "FF", 125, 1140, 225, "h"],
    ["f56gp", "John Cooper Works GP (F56)", "FF", 225, 1255, 265, "h"]
  ]);
  add("porsche", [
    ["p944", "944 Turbo", "FR", 184, 1300, 260, "o"],
    ["p930", "911 Turbo (930)", "RR", 221, 1335, 260, "o"],
    ["p959", "959", "4WD", 331, 1450, 317, "x"],
    ["p964rs", "911 Carrera RS (964)", "RR", 191, 1230, 260, "s"],
    ["p993", "911 Turbo (993)", "4WD", 300, 1500, 290, "g"],
    ["p996gt3", "911 GT3 (996)", "RR", 265, 1350, 302, "s", { grip: 1.05 }],
    ["p997rs", "911 GT3 RS (997)", "RR", 331, 1370, 310, "x"],
    ["p992rs", "911 GT3 RS (992)", "RR", 386, 1450, 296, "r", { cla: 0.5 }],
    ["p991gt2", "911 GT2 RS (991)", "RR", 515, 1470, 340, "r"],
    ["cgt", "Carrera GT", "MR", 450, 1380, 330, "x"],
    ["p918", "918 Spyder", "4WD", 652, 1675, 345, "r"],
    ["spyder", "718 Boxster Spyder", "MR", 309, 1420, 300, "s", { grip: 1.07 }],
    ["p911t", "911 Carrera T (992)", "RR", 283, 1470, 291, "s"]
  ]);
  add("tesla", [
    ["roadster08", "Roadster (2008)", "MR", 185, 1235, 201, "e", { hdl: 1.02 }],
    ["m3lr", "Model 3 Long Range", "4WD", 324, 1840, 233, "e"],
    ["myp", "Model Y Performance", "4WD", 340, 2000, 250, "u", { ev: true }],
    ["cyber", "Cybertruck Cyberbeast", "4WD", 630, 3100, 210, "u", { ev: true }]
  ]);
  add("audi", [
    ["sportq", "Sport quattro", "4WD", 225, 1300, 250, "o"],
    ["rs2", "RS2 Avant", "4WD", 232, 1600, 262, "g"],
    ["rs4b7", "RS 4 (B7)", "4WD", 309, 1650, 250, "g"],
    ["rs6", "RS 6 Avant (C8)", "4WD", 441, 2075, 305, "g"],
    ["ttrs", "TT RS (8S)", "4WD", 294, 1450, 280, "s"],
    ["r8v8", "R8 V8 (Gen1)", "4WD", 309, 1560, 301, "x"],
    ["etrongt", "RS e-tron GT", "4WD", 475, 2350, 250, "e"]
  ]);
  add("vw", [
    ["golf1", "Golf GTI (Mk1)", "FF", 81, 810, 182, "o"],
    ["golf2", "Golf GTI 16V (Mk2)", "FF", 102, 960, 200, "h"],
    ["corrado", "Corrado VR6", "FF", 140, 1270, 235, "h"],
    ["r32mk5", "Golf R32 (Mk5)", "4WD", 184, 1510, 250, "h"],
    ["scirocco", "Scirocco R", "FF", 195, 1350, 250, "h"],
    ["polo", "Polo GTI (AW)", "FF", 152, 1290, 238, "h"],
    ["upgti", "up! GTI", "FF", 85, 1070, 197, "h"]
  ]);
  add("ferrari", [
    ["f308", "308 GTB", "MR", 188, 1090, 252, "o"],
    ["f288", "288 GTO", "MR", 294, 1160, 304, "x"],
    ["testa", "Testarossa", "MR", 287, 1500, 290, "o"],
    ["f50", "F50", "MR", 382, 1230, 325, "x"],
    ["f355", "F355 Berlinetta", "MR", 280, 1350, 295, "x"],
    ["f360cs", "360 Challenge Stradale", "MR", 313, 1180, 300, "x"],
    ["f430s", "430 Scuderia", "MR", 375, 1250, 320, "x"],
    ["enzo", "Enzo Ferrari", "MR", 485, 1365, 350, "r"],
    ["f458", "458 Italia", "MR", 419, 1380, 325, "x"],
    ["f458sp", "458 Speciale", "MR", 445, 1290, 325, "r"],
    ["f12", "F12berlinetta", "FR", 545, 1630, 340, "x"],
    ["laferrari", "LaFerrari", "MR", 708, 1255, 350, "r"],
    ["f8", "F8 Tributo", "MR", 530, 1435, 340, "x"],
    ["f812", "812 Superfast", "FR", 588, 1630, 340, "x"],
    ["sf90", "SF90 Stradale", "4WD", 735, 1570, 340, "r"],
    ["f296", "296 GTB", "MR", 610, 1470, 330, "x"],
    ["roma", "Roma", "FR", 456, 1570, 320, "g"]
  ]);
  add("lamborghini", [
    ["miura", "Miura P400 SV", "MR", 283, 1245, 290, "o"],
    ["countach", "Countach LP400", "MR", 276, 1065, 290, "o"],
    ["diablo", "Diablo SV", "MR", 390, 1530, 320, "x"],
    ["murci", "Murciélago LP640", "4WD", 471, 1665, 340, "x"],
    ["gallardo", "Gallardo LP570-4 Superleggera", "4WD", 419, 1340, 325, "x"],
    ["svj", "Aventador SVJ", "4WD", 566, 1525, 350, "r"],
    ["sto", "Huracán STO", "MR", 470, 1340, 310, "r"],
    ["revuelto", "Revuelto", "4WD", 747, 1772, 350, "r"],
    ["urus", "Urus Performante", "4WD", 490, 2150, 306, "u"]
  ]);
  add("mclaren", [
    ["mf1", "F1", "MR", 461, 1140, 386, "x", { cla: 0.12 }],
    ["p1", "P1", "MR", 673, 1450, 350, "r"],
    ["senna", "Senna", "MR", 588, 1200, 340, "r", { cla: 0.55 }],
    ["m600lt", "600LT", "MR", 441, 1250, 328, "r"],
    ["m765lt", "765LT", "MR", 563, 1340, 330, "r"],
    ["artura", "Artura", "MR", 500, 1500, 330, "x"],
    ["mgt", "GT", "MR", 456, 1530, 326, "g"]
  ]);
  add("alpine", [
    ["a110old", "A110 1600S (1971)", "RR", 92, 700, 210, "o", { hdl: 1.16 }],
    ["a110r", "A110 R", "MR", 221, 1082, 285, "x"],
    ["a290", "A290", "FF", 160, 1480, 170, "e"]
  ]);
  add("lotus", [
    ["elise1", "Elise S1", "MR", 88, 725, 200, "l"],
    ["l340r", "340R", "MR", 132, 658, 210, "l"],
    ["esprit", "Esprit V8", "MR", 260, 1380, 282, "g"],
    ["evora", "Evora GT", "MR", 309, 1430, 303, "s"],
    ["emira", "Emira V6", "MR", 298, 1460, 290, "s"],
    ["evija", "Evija", "4WD", 1470, 1680, 350, "r", { ev: true }]
  ]);
  add("alfa", [
    ["gtaj", "GTA 1300 Junior", "FR", 81, 760, 175, "o"],
    ["a147gta", "147 GTA", "FF", 184, 1360, 246, "h"],
    ["a8c", "8C Competizione", "FR", 331, 1585, 292, "x"]
  ]);
  add("ford", [
    ["gt40", "GT40 Mk I", "MR", 250, 1000, 280, "o"],
    ["sierra", "Sierra RS Cosworth", "FR", 150, 1220, 240, "o"],
    ["escortcos", "Escort RS Cosworth", "4WD", 166, 1275, 232, "h"],
    ["fiestast", "Fiesta ST (Mk7)", "FF", 147, 1160, 232, "h"],
    ["focusst", "Focus ST (Mk4)", "FF", 206, 1450, 250, "h"],
    ["fgt05", "GT (2005)", "MR", 410, 1520, 330, "x"],
    ["fgt17", "GT (2017)", "MR", 482, 1385, 347, "x"],
    ["gt500", "Mustang Shelby GT500", "FR", 566, 1880, 290, "g"]
  ]);
  add("chevrolet", [
    ["c2", "Corvette Sting Ray (C2)", "FR", 268, 1440, 230, "o"],
    ["c5z06", "Corvette Z06 (C5)", "FR", 287, 1415, 275, "s"],
    ["c6zr1", "Corvette ZR1 (C6)", "FR", 476, 1510, 330, "x"],
    ["c7z06", "Corvette Z06 (C7)", "FR", 485, 1600, 300, "x"],
    ["c8z06", "Corvette Z06 (C8)", "MR", 500, 1560, 312, "x"],
    ["zl1", "Camaro ZL1 1LE", "FR", 485, 1750, 290, "g"]
  ]);
  add("dodge", [
    ["viper1", "Viper RT/10", "FR", 298, 1490, 266, "o"],
    ["viperacr", "Viper ACR (VX)", "FR", 481, 1530, 285, "r"],
    ["hellcat", "Challenger SRT Hellcat", "FR", 527, 2000, 320, "g"]
  ]);
  add("hyundai", [
    ["i20n", "i20 N", "FF", 150, 1190, 230, "h"],
    ["velostern", "Veloster N", "FF", 202, 1400, 250, "h"],
    ["elantran", "Elantra N", "FF", 206, 1450, 250, "h"]
  ]);
  add("kia", [
    ["stinger", "Stinger GT", "4WD", 272, 1830, 270, "g"],
    ["ev6gt", "EV6 GT", "4WD", 430, 2200, 260, "e"]
  ]);
  add("peugeot", [
    ["p205", "205 GTI 1.9", "FF", 94, 880, 205, "h"],
    ["p106", "106 Rallye", "FF", 75, 865, 190, "h"],
    ["p208", "208 GTi", "FF", 153, 1160, 230, "h"]
  ]);
  add("renault", [
    ["r5t2", "R5 Turbo 2", "MR", 118, 970, 200, "o"],
    ["cliov6", "Clio V6", "MR", 187, 1400, 245, "s"],
    ["clio18", "Clio R.S. 18", "FF", 162, 1204, 230, "h"],
    ["meganer", "Mégane R.S. Trophy-R", "FF", 221, 1306, 262, "h", { grip: 1.05 }]
  ]);
  add("abarth", [
    ["a695ss", "695 SS (1964)", "RR", 28, 500, 140, "o"],
    ["a595", "595 Competizione", "FF", 132, 1110, 225, "h"],
    ["a124", "124 Spider", "FR", 125, 1060, 232, "s"]
  ]);
  add("lancia", [
    ["stratos", "Stratos HF Stradale", "MR", 140, 980, 230, "o", { hdl: 1.12 }],
    ["l037", "Rally 037 Stradale", "MR", 151, 1170, 220, "o"],
    ["delta", "Delta HF Integrale Evoluzione", "4WD", 158, 1340, 220, "h"]
  ]);
  add("maserati", [
    ["mc20", "MC20", "MR", 463, 1475, 325, "x"],
    ["gtmc", "GranTurismo MC Stradale", "FR", 338, 1800, 301, "g"]
  ]);
  add("aston", [
    ["db5", "DB5", "FR", 210, 1500, 230, "o"],
    ["vantage", "Vantage (2018)", "FR", 375, 1630, 314, "g"],
    ["dbs", "DBS Superleggera", "FR", 533, 1690, 340, "g"],
    ["valkyrie", "Valkyrie", "MR", 865, 1270, 350, "r", { cla: 0.7 }]
  ]);
  add("jaguar", [
    ["etype", "E-Type Series 1", "FR", 198, 1230, 240, "o"],
    ["xj220", "XJ220", "MR", 404, 1470, 340, "x"],
    ["ftyper", "F-Type R", "4WD", 423, 1700, 300, "g"]
  ]);
  add("koenigsegg", [
    ["ccx", "CCX", "MR", 601, 1456, 350, "x"],
    ["agera", "Agera RS", "MR", 865, 1395, 350, "r"],
    ["jesko", "Jesko", "MR", 954, 1420, 350, "r"]
  ]);
  add("pagani", [
    ["zondaf", "Zonda F", "MR", 442, 1230, 345, "x"],
    ["huayrabc", "Huayra BC", "MR", 588, 1218, 350, "r"]
  ]);
  add("bugatti", [
    ["veyron", "Veyron 16.4", "4WD", 736, 1888, 407, "x"],
    ["chiron", "Chiron Super Sport", "4WD", 1176, 1995, 440, "r", { cla: 0.25 }]
  ]);
  add("rimac", [["nevera", "Nevera", "4WD", 1427, 2300, 412, "r", { ev: true }]]);
  add("caterham", [
    ["seven170", "Seven 170", "FR", 63, 440, 168, "l"],
    ["seven620", "Seven 620R", "FR", 231, 610, 250, "l"]
  ]);
  add("ariel", [["atom4", "Atom 4", "MR", 239, 595, 260, "l"]]);
  add("xiaomi", [["su7max", "SU7 Max", "4WD", 495, 2205, 265, "e"]]);
  add("byd", [["u9", "Yangwang U9", "4WD", 960, 2475, 309, "x", { ev: true }]]);
  add("lucid", [["airsap", "Air Sapphire", "4WD", 920, 2375, 330, "e"]]);
  add("dmc", [["dmc12", "DMC-12", "RR", 97, 1230, 175, "o"]]);

  // 第一～三批的車沒有寫車種：依數據粗分，只用來在車庫篩選
  D.CARS.forEach(function (c) {
    if (c.cls) return;
    c.cls = c.ev ? "e" : c.kw >= 440 || (c.kw >= 340 && c.kg <= 1500) ? "x" : c.kg <= 800 ? "k" : c.drive === "FF" || c.drive === "4WD" && c.kw < 320 ? "h" : c.kg >= 1600 ? "g" : "s";
  });
})();
