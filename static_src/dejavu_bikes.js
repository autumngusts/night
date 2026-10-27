// DÉJÀ VU 山道下坡（dejavu）：機車 100 款（2026-10-27 第十一批）。在 dejavu_cars.js 之後、dejavu_core.js 之前載入。
// 台灣常見的速克達／檔車約 35 款＋各廠有名的重機約 65 款。跟汽車一樣是「風格化的近似值」，不是原廠數據。
// 機車的驅動一律是 "MC"（見 dejavu_data.js 的 DRIVE_INFO）；kg 是車重（不含騎士），carStats 會另外加上騎士體重。
// 每台只寫 [id, 車名, kW, kg, 極速, 車種]（必要時再加覆寫物件），抓地／煞車／操控／空阻由車種（BIKE_CLASSES）推算。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestDejavuData;
  if (!D) return;

  // 車種：sc 速克達、ms 輕檔車／小型檔車、ss 仿賽（超跑機車）、nk 街車、cr 美式／巡航、ad 多功能／旅行、em 電動機車
  var BIKE_CLASSES = {
    sc: { grip: 0.86, brk: 0.86, hdl: 1.14, cda: 0.42, cla: 0 },
    ms: { grip: 0.9, brk: 0.88, hdl: 1.16, cda: 0.44, cla: 0 },
    ss: { grip: 1.04, brk: 1.01, hdl: 1.18, cda: 0.3, cla: 0.02 },
    nk: { grip: 1.0, brk: 0.99, hdl: 1.18, cda: 0.46, cla: 0 },
    cr: { grip: 0.84, brk: 0.9, hdl: 0.88, cda: 0.6, cla: 0 },
    ad: { grip: 0.94, brk: 0.95, hdl: 1.04, cda: 0.56, cla: 0 },
    em: { grip: 0.86, brk: 0.86, hdl: 1.12, cda: 0.42, cla: 0, ev: true }
  };
  D.BIKE_CLASSES = ["sc", "ms", "ss", "nk", "cr", "ad", "em"];
  D.CAR_CLASSES = (D.CAR_CLASSES || []).concat(D.BIKE_CLASSES);

  // 機車廠牌（bike: true，車庫的廠牌選單會標上 🏍；id 加 mc_ 前綴，避免跟同名的汽車廠混在一起）
  var BIKE_BRANDS = [
    { id: "mc_kymco", name: "KYMCO 光陽" }, { id: "mc_sym", name: "SYM 三陽" }, { id: "mc_yamaha", name: "Yamaha" },
    { id: "mc_gogoro", name: "Gogoro" }, { id: "mc_pgo", name: "PGO 摩特動力" }, { id: "mc_aeon", name: "Aeon 宏佳騰" },
    { id: "mc_honda", name: "Honda" }, { id: "mc_suzuki", name: "Suzuki" }, { id: "mc_kawasaki", name: "Kawasaki" },
    { id: "mc_ducati", name: "Ducati" }, { id: "mc_bmw", name: "BMW Motorrad" }, { id: "mc_aprilia", name: "Aprilia" },
    { id: "mc_ktm", name: "KTM" }, { id: "mc_triumph", name: "Triumph" }, { id: "mc_harley", name: "Harley-Davidson" },
    { id: "mc_mv", name: "MV Agusta" }
  ];
  var custom = D.BRANDS.pop();
  BIKE_BRANDS.forEach(function (b) { b.bike = true; D.BRANDS.push(b); });
  D.BRANDS.push(custom);

  function r2(x) { return Math.round(x * 100) / 100; }
  function add(brand, rows) {
    rows.forEach(function (a) {
      var c = BIKE_CLASSES[a[5]];
      var bike = {
        id: "b_" + a[0], brand: brand, name: a[1], drive: "MC", bike: true, kw: a[2], kg: a[3], vmax: a[4], cls: a[5],
        // 越重越鈍（美式巡航車本來就慢吞吞）
        grip: c.grip, brk: c.brk, hdl: r2(Math.max(0.82, Math.min(1.22, c.hdl - (a[3] - 180) * 0.0004))), cda: c.cda, cla: c.cla
      };
      if (c.ev) bike.ev = true;
      var ov = a[6];
      if (ov) Object.keys(ov).forEach(function (k) { bike[k] = ov[k]; });
      D.CARS.push(bike);
    });
  }

  // ---- 台灣常見 ----
  add("mc_kymco", [
    ["gp125", "GP 125", 6.8, 110, 95, "sc"],
    ["many110", "Many 110", 5.6, 99, 85, "sc"],
    ["like150", "Like 150", 8.9, 115, 105, "sc"],
    ["vjr125", "VJR 125", 7, 112, 100, "sc"],
    ["racings", "雷霆 S 150 (Racing S)", 10.6, 129, 115, "sc"],
    ["krv", "KRV 180", 12.7, 143, 120, "sc"],
    ["dtx360", "DTX 360", 21.5, 196, 140, "sc"],
    ["xciting", "Xciting S 400", 26.5, 199, 150, "sc"],
    ["ak550", "AK 550", 39.4, 226, 175, "sc"],
    ["ktr", "KTR 150", 10, 127, 115, "ms"]
  ]);
  add("mc_sym", [
    ["woo", "WOO 115", 5.8, 97, 85, "sc"],
    ["mica", "4MICA 125", 6.6, 108, 90, "sc"],
    ["fnx", "FNX 125", 7.5, 114, 100, "sc"],
    ["jetsl", "JET SL 125", 9, 121, 110, "sc"],
    ["jetsr", "JET SR 125", 8.9, 120, 110, "sc"],
    ["mmbcu", "MMBCU 158", 11.5, 135, 115, "sc"],
    ["drgbt", "DRG BT 158", 11.6, 136, 120, "sc"],
    ["maxsym", "MAXSYM TL 508", 33.8, 216, 170, "sc"],
    ["wolf", "野狼傳奇 125 (Wolf)", 7, 118, 100, "ms"]
  ]);
  add("mc_yamaha", [
    ["jog", "JOG 125", 6.2, 95, 90, "sc"],
    ["limi", "LIMI 125", 6, 96, 90, "sc"],
    ["cygnus", "新勁戰 六代 (Cygnus Gryphus)", 9, 125, 110, "sc"],
    ["bws", "BWS 125", 9, 127, 105, "sc"],
    ["force", "FORCE 2.0 155", 11.3, 128, 120, "sc"],
    ["augur", "AUGUR 155", 11.3, 130, 120, "sc"],
    ["xmax", "XMAX 300", 20.6, 179, 140, "sc"],
    ["tmax", "TMAX 560", 35, 220, 170, "sc"],
    ["r15", "YZF-R15 V4", 13.5, 141, 140, "ms"],
    ["r3", "YZF-R3", 30.9, 169, 185, "ss", { grip: 0.98, cda: 0.34 }],
    ["r7", "YZF-R7", 54, 188, 220, "ss"],
    ["r1m", "YZF-R1M", 147, 202, 299, "ss"],
    ["mt09", "MT-09", 87.5, 189, 230, "nk"],
    ["mt10", "MT-10", 122, 212, 260, "nk"],
    ["xsr900", "XSR900", 87.5, 193, 225, "nk"],
    ["tenere", "Ténéré 700", 54, 205, 195, "ad"],
    ["vmax", "VMAX 1700", 147, 310, 220, "cr"]
  ]);
  add("mc_gogoro", [
    ["delight", "Gogoro 2 Delight", 6.4, 110, 85, "em"],
    ["s2", "Gogoro S2", 7.6, 118, 92, "em"],
    ["supersport", "Gogoro SuperSport", 7.6, 122, 95, "em"]
  ]);
  add("mc_pgo", [["tigra", "Tigra 200", 12, 126, 120, "sc"]]);
  add("mc_aeon", [["ai1", "Ai-1 Sport", 7.6, 117, 92, "em"]]);
  add("mc_suzuki", [["address", "Address 125", 6.9, 109, 95, "sc"]]);
  add("mc_honda", [
    ["dio", "Dio 110", 6, 96, 85, "sc"],
    ["pcx", "PCX 160", 11.8, 131, 115, "sc"],
    ["adv160", "ADV 160", 11.8, 133, 115, "sc"],
    ["cub", "Super Cub C125", 7, 110, 100, "ms"],
    ["grom", "Grom (MSX125)", 7.4, 103, 95, "ms"],
    // ---- 重機 ----
    ["nsr250", "NSR250R (MC21)", 33, 141, 210, "ss", { hdl: 1.22 }],
    ["cbr650r", "CBR650R", 70, 207, 220, "ss"],
    ["cbr1000", "CBR1000RR-R Fireblade SP", 160, 201, 299, "ss"],
    ["cb650r", "CB650R", 70, 203, 215, "nk"],
    ["africa", "CRF1100L Africa Twin", 75, 231, 200, "ad"],
    ["rebel1100", "Rebel 1100", 64, 223, 190, "cr"],
    ["goldwing", "Gold Wing Tour", 93, 390, 190, "cr"]
  ]);
  add("mc_suzuki", [
    ["gsxr150", "GSX-R150", 14, 131, 140, "ms"],
    ["gsx8s", "GSX-8S", 61, 202, 210, "nk"],
    ["katana", "KATANA", 112, 215, 245, "nk"],
    ["gsxr1000", "GSX-R1000R", 149, 203, 299, "ss"],
    ["busa", "Hayabusa (2021)", 140, 264, 299, "ss", { cda: 0.28 }],
    ["vstrom", "V-Strom 1050DE", 79, 252, 210, "ad"]
  ]);
  add("mc_kawasaki", [
    ["ninja400", "Ninja 400", 33, 168, 190, "ss", { grip: 0.98, cda: 0.34 }],
    ["zx4rr", "Ninja ZX-4RR", 57, 188, 230, "ss"],
    ["zx6r", "Ninja ZX-6R", 95, 198, 260, "ss"],
    ["zx10rr", "Ninja ZX-10RR", 150, 207, 299, "ss"],
    ["h2", "Ninja H2", 170, 238, 330, "ss"],
    ["h2r", "Ninja H2R", 228, 216, 360, "ss", { cla: 0.06 }],
    ["zh2", "Z H2", 147, 240, 290, "nk"],
    ["z900rs", "Z900RS", 82, 215, 225, "nk"],
    ["z1", "Z1 900 (1972)", 60, 230, 210, "nk", { grip: 0.9, brk: 0.86 }],
    ["vulcans", "Vulcan S", 45, 229, 190, "cr"]
  ]);
  add("mc_ducati", [
    ["d916", "916", 84, 195, 260, "ss", { grip: 0.98 }],
    ["desmosedici", "Desmosedici RR", 147, 171, 310, "ss"],
    ["v2", "Panigale V2", 114, 200, 280, "ss"],
    ["v4r", "Panigale V4 R", 160, 194, 310, "ss", { cla: 0.05 }],
    ["sfv4", "Streetfighter V4 S", 153, 199, 290, "nk", { cla: 0.03 }],
    ["monster", "Monster SP", 82, 186, 240, "nk"],
    ["scrambler", "Scrambler Icon", 54, 189, 190, "nk", { grip: 0.94 }],
    ["diavel", "Diavel V4", 124, 236, 270, "cr", { grip: 0.92 }],
    ["multipp", "Multistrada V4 Pikes Peak", 125, 229, 270, "ad", { grip: 0.98 }]
  ]);
  add("mc_bmw", [
    ["s1000rr", "S 1000 RR", 154, 197, 303, "ss"],
    ["m1000rr", "M 1000 RR", 157, 192, 314, "ss", { cla: 0.05 }],
    ["r1300gs", "R 1300 GS", 107, 237, 225, "ad"],
    ["r18", "R 18", 67, 345, 180, "cr"],
    ["ce04", "CE 04", 31, 231, 120, "em"]
  ]);
  add("mc_aprilia", [
    ["rs660", "RS 660", 74, 183, 240, "ss"],
    ["rsv4", "RSV4 Factory", 160, 202, 305, "ss", { cla: 0.04 }],
    ["tuono", "Tuono V4 Factory", 129, 209, 280, "nk"]
  ]);
  add("mc_ktm", [
    ["duke390", "390 Duke", 33, 165, 170, "nk"],
    ["rc390", "RC 390", 33, 172, 180, "ss", { grip: 0.98, cda: 0.34 }],
    ["sduke", "1390 Super Duke R EVO", 140, 212, 290, "nk"],
    ["sadv", "1290 Super Adventure R", 118, 240, 250, "ad"]
  ]);
  add("mc_triumph", [
    ["daytona675", "Daytona 675R", 94, 184, 260, "ss"],
    ["speedtriple", "Speed Triple 1200 RS", 132, 199, 270, "nk"],
    ["bonneville", "Bonneville T120", 59, 236, 190, "cr", { hdl: 1.0 }],
    ["rocket3", "Rocket 3 R", 132, 291, 220, "cr"]
  ]);
  add("mc_harley", [
    ["fatboy", "Fat Boy 114", 69, 317, 180, "cr"],
    ["streetglide", "Street Glide", 78, 375, 180, "cr"],
    ["livewire", "LiveWire One", 75, 251, 177, "em", { grip: 0.96, brk: 0.95, hdl: 1.0, cda: 0.46 }]
  ]);
  add("mc_mv", [
    ["f4rc", "F4 RC", 151, 175, 300, "ss"],
    ["brutale", "Brutale 1000 RR", 153, 186, 300, "nk"]
  ]);
})();
