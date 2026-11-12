// ============================================================================
// 緣日樂園：遊戲資料（規格 docs/ennichi_rules.md §4.4〜§4.6、§5、§6.4、§7.3）。
// 只放資料與常數，規則在 ennichi_core.js／ennichi_sim.js。
// 生產鏈：原料（市場）→ 第一層 基礎材料 → 第二層 通用零件 → 第三層 專用模組 →（組裝期）大型設施；
//         一般設施只用第二層以下的零件。層級＝配方深度（D.tierOf）。
// ============================================================================
(function () {
  "use strict";
  function C(zh, ja) { return { zh: zh, ja: ja || zh }; }
  var D = { C: C };

  // 地圖：32×20 格（1 格 = 2 m）。入口在左邊中央，參道一路通到右邊的神社本殿；x ≥ UNLOCK_X 是 v2 擴張用地
  D.MAP = { W: 32, H: 20, TILE: 2, GATE: { x: 0, y: 10 }, UNLOCK_X: 22, SHRINE: { x: 26, y: 8, w: 4, h: 4 } };
  D.DAY_START = 540; // 9:00
  D.DAY_END = 1020; // 17:00 閉園（客人開始離場）
  D.LAST_ENTRY = 900; // 15:00 以後不再進場
  D.SEASON_DAYS = 28;
  D.START_CASH = 5000;
  D.ENTRY_FEE = 200;
  D.PATH_COST = 10;
  D.WARE_CAP = 400;
  D.MACHINE_SLOTS = 14; // 人氣每升 1 級 +2
  D.MACHINE_SLOTS_PER_LV = 2;
  D.REFUND = 0.5;
  D.POP_LEVELS = [0, 50, 150, 300, 600];
  D.GUEST_SPEED = 2;
  D.OUTFITS = 4;
  D.QSTALL_RANGE = 3;
  D.TICKET_FACTOR = 2;
  // 樂園容量（來客上限）＝ base ＋ 完工遊樂設施的座位數（cap 合計）× perSeat ＋ 完工攤位／排隊屋台／設施數 × perShop
  D.CAPACITY = { base: 20, perSeat: 5, perShop: 8 };
  // 口碑：每天 round((平均心情 − base) × mood) ＋ min(SNS, snsMax)，整體限制在 ±dayMax
  D.REP = { base: 55, mood: 1, snsMax: 5, dayMax: 20 };
  // 心情扣分：賣完、買不起（錢不夠）、需求 ≥ 70 卻沒有對應設施（每位客人冷卻 noFacilityCd 分鐘才再扣）
  D.MOOD = { soldout: 5, pricey: 2, noFacility: 2, noFacilityCd: 30 };

  function mat(buy, zh, ja) { return { kind: "mat", buy: buy, name: C(zh, ja) }; }
  function part(zh, ja) { return { kind: "part", name: C(zh, ja) }; }
  function mod(zh, ja) { return { kind: "module", name: C(zh, ja) }; }
  function upg(zh, ja) { return { kind: "upgrade", name: C(zh, ja) }; }

  D.ITEMS = {
    // 原料（14）
    wood: mat(10, "原木", "原木"), bamboo: mat(8, "竹", "竹"), iron: mat(15, "鐵料", "鉄材"), copper: mat(25, "銅料", "銅材"),
    kozo: mat(10, "楮樹皮", "楮"), glassraw: mat(12, "玻璃料", "ガラス原料"), clay: mat(8, "陶土", "陶土"), urushi: mat(30, "生漆", "生漆"),
    pigment: mat(15, "顏料", "顔料"), cloth: mat(12, "布料", "布"), sugar: mat(5, "砂糖", "砂糖"), flour: mat(5, "麵粉", "小麦粉"),
    octopus: mat(20, "章魚", "タコ"), apple: mat(8, "蘋果", "りんご"),
    // 第一層（9）
    plank: part("木板", "板材"), strip: part("竹條", "竹ひご"), sheet: part("金屬板", "金属板"), wire: part("銅線", "銅線"),
    washi: part("和紙", "和紙"), pane: part("玻璃板", "板ガラス"), bisque: part("素燒坯", "素焼き"), paint: part("彩漆", "色漆"), canvas: part("帆布", "帆布"),
    // 第二層（8）
    frame: part("鋼骨架", "鉄骨フレーム"), gear: part("齒輪", "歯車"), chain: part("鏈條", "チェーン"), pole: part("鍍金柱", "金メッキ柱"),
    motor: part("馬達", "モーター"), bulb: part("燈泡", "電球"), carving: part("雕刻木件", "彫刻パーツ"), seat: part("座椅", "座席"),
    // 第三層：專用模組（12）
    lion: mod("彩繪唐獅子", "彩色唐獅子"), lionPost: mod("獅子柱組", "獅子柱ユニット"), tent: mod("帳篷頂棚", "テント屋根"),
    turntable: mod("迴轉台", "回転台"), cup: mod("茶碗杯座", "茶碗カップ"), windmill: mod("風車頂篷", "風車屋根"),
    swing: mod("吊椅", "吊り椅子"), tower: mod("飛椅塔", "ブランコ塔"), cabin: mod("摩天輪車廂", "観覧車ゴンドラ"),
    rim: mod("輪框段", "リム材"), hub: mod("主軸機組", "主軸ユニット"), lanterns: mod("燈籠串", "提灯つなぎ"),
    // 改裝模組（4）
    nightLanterns: upg("夜光燈籠串", "夜光提灯つなぎ"), fastTurntable: upg("高速迴轉台", "高速回転台"),
    goldLion: upg("金箔唐獅子", "金箔唐獅子"), glassCabin: upg("全景玻璃車廂", "パノラマゴンドラ"),
    // 商品（7）
    takoyaki: { kind: "food", sell: 300, fill: { hunger: 45 }, name: C("章魚燒", "たこ焼き") },
    ringoame: { kind: "food", sell: 250, fill: { hunger: 15, fun: 10 }, name: C("蘋果糖", "りんご飴") },
    wataame: { kind: "food", sell: 200, fill: { hunger: 10, fun: 10 }, name: C("棉花糖", "わたあめ") },
    ramune: { kind: "drink", sell: 150, fill: { thirst: 55 }, name: C("彈珠汽水", "ラムネ") },
    omamori: { kind: "goods", sell: 500, joy: 12, fill: { fun: 20 }, name: C("限定御守", "限定お守り") },
    ema: { kind: "goods", sell: 300, joy: 6, fill: { fun: 15 }, name: C("繪馬", "絵馬") },
    kasa: { kind: "goods", sell: 400, joy: 2, fill: { dry: 100 }, umbrella: true, name: C("和傘", "和傘") },
  };

  D.MACHINES = {
    saw: { cost: 200, name: C("製材機", "製材機") }, press: { cost: 300, name: C("沖壓機", "プレス機") },
    draw: { cost: 400, name: C("拉線機", "伸線機") }, paper: { cost: 300, name: C("和紙工坊", "和紙工房") },
    glass: { cost: 400, name: C("玻璃爐", "ガラス炉") }, kiln: { cost: 400, name: C("陶窯", "陶窯") },
    lacquer: { cost: 400, name: C("漆工房", "漆工房") }, sew: { cost: 300, name: C("縫紉台", "ミシン台") },
    weld: { cost: 500, name: C("焊接台", "溶接台") }, lathe: { cost: 500, name: C("車床", "旋盤") },
    wind: { cost: 600, name: C("繞線機", "巻線機") }, carve: { cost: 300, name: C("雕刻台", "彫刻台") },
    wood: { cost: 300, name: C("木工台", "木工台") }, assembly: { cost: 800, name: C("組裝台", "組立台") },
    griddle: { cost: 300, name: C("鐵板灶", "鉄板かまど") }, sweets: { cost: 400, name: C("甜品台", "甘味台") },
    craft: { cost: 400, name: C("御守工坊", "お守り工房") },
  };

  function R(m, inp, n, t) { return { m: m, in: inp, n: n, t: t }; }
  var RAW = {
    // 第一層
    plank: R("saw", { wood: 1 }, 2, 3), strip: R("saw", { bamboo: 1 }, 3, 3), sheet: R("press", { iron: 1 }, 1, 3),
    wire: R("draw", { copper: 1 }, 2, 3), washi: R("paper", { kozo: 1 }, 2, 4), pane: R("glass", { glassraw: 1 }, 1, 4),
    bisque: R("kiln", { clay: 1 }, 1, 5), paint: R("lacquer", { urushi: 1, pigment: 1 }, 2, 5), canvas: R("sew", { cloth: 2 }, 1, 5),
    // 第二層
    frame: R("weld", { sheet: 3 }, 1, 8), gear: R("lathe", { sheet: 1 }, 2, 4), chain: R("lathe", { sheet: 2 }, 1, 5),
    pole: R("lathe", { sheet: 1, paint: 1 }, 1, 6), motor: R("wind", { wire: 2, sheet: 1 }, 1, 10), bulb: R("glass", { pane: 1, wire: 1 }, 2, 5),
    carving: R("carve", { plank: 2 }, 1, 6), seat: R("wood", { plank: 2, canvas: 1 }, 1, 6),
    // 第三層：專用模組
    lion: R("lacquer", { carving: 2, paint: 1 }, 1, 8), lionPost: R("assembly", { lion: 1, pole: 1 }, 1, 4),
    tent: R("assembly", { canvas: 2, strip: 4, frame: 1 }, 1, 6), turntable: R("assembly", { gear: 3, frame: 1, motor: 1 }, 1, 8),
    cup: R("kiln", { bisque: 1, paint: 1, gear: 1 }, 1, 6), windmill: R("assembly", { canvas: 2, strip: 4, gear: 1 }, 1, 6),
    swing: R("assembly", { seat: 1, chain: 2 }, 1, 4), tower: R("weld", { frame: 2, chain: 1, motor: 1 }, 1, 10),
    cabin: R("assembly", { frame: 1, pane: 2, paint: 1 }, 1, 8), rim: R("weld", { frame: 1, chain: 1 }, 1, 6),
    hub: R("assembly", { motor: 2, gear: 4 }, 1, 10), lanterns: R("paper", { washi: 2, strip: 2, bulb: 1 }, 1, 6),
    // 改裝模組
    nightLanterns: R("paper", { lanterns: 1, bulb: 2, paint: 1 }, 1, 6), fastTurntable: R("assembly", { turntable: 1, motor: 1, gear: 2 }, 1, 8),
    goldLion: R("lacquer", { lion: 1, paint: 2 }, 1, 8), glassCabin: R("glass", { cabin: 1, pane: 2 }, 1, 6),
    // 商品
    takoyaki: R("griddle", { flour: 1, octopus: 1 }, 6, 5), ringoame: R("sweets", { sugar: 1, apple: 1 }, 4, 4),
    wataame: R("sweets", { sugar: 1 }, 5, 3), ramune: R("sweets", { pane: 1, sugar: 1 }, 6, 4),
    omamori: R("craft", { cloth: 1, washi: 1 }, 3, 6), ema: R("craft", { plank: 1, paint: 1 }, 4, 5), kasa: R("paper", { washi: 2, strip: 3 }, 2, 6),
  };
  D.RECIPES = {};
  Object.keys(RAW).forEach(function (k) {
    var o = {}; o[k] = RAW[k].n;
    D.RECIPES[k] = { m: RAW[k].m, in: RAW[k].in, out: o, t: RAW[k].t };
  });

  var tierCache = {};
  D.tierOf = function (id) {
    if (tierCache[id] != null) return tierCache[id];
    var it = D.ITEMS[id], r = D.RECIPES[id], t = 0;
    if (it && it.kind !== "mat" && r) for (var k in r.in) t = Math.max(t, D.tierOf(k) + 1);
    tierCache[id] = t;
    return t;
  };

  function slot(m, n, eff) { return { mod: m, n: n, eff: eff }; }
  D.BUILD = {
    shrine: { kind: "shrine", w: 4, h: 4, cash: 0, parts: {}, lv: 1, fun: 20, photo: 2, name: C("神社本殿", "本殿") },
    // 大型設施（第三層模組＋組裝期）
    merry: { kind: "ride", large: true, days: 1, w: 4, h: 4, cash: 500, lv: 1, parts: { lionPost: 6, tent: 1, turntable: 1, lanterns: 2 },
      cap: 12, cycle: 4, price: 300, thrill: 1, charm: 3, photo: 2, wear: 4, fix: { gear: 2 },
      slots: { light: slot("nightLanterns", 2, { charm: 1, photo: 1 }), drive: slot("fastTurntable", 1, { thrill: 1, wearMul: 1.5 }), deco: slot("goldLion", 2, { charm: 1, price: 50 }) },
      name: C("唐獅子旋轉木馬", "唐獅子メリーゴーランド") },
    cups: { kind: "ride", large: true, days: 1, w: 3, h: 3, cash: 400, lv: 1, parts: { cup: 6, turntable: 1 },
      cap: 8, cycle: 3, price: 250, thrill: 2, charm: 2, photo: 1, wear: 5, fix: { gear: 2 },
      slots: { drive: slot("fastTurntable", 1, { thrill: 1, wearMul: 1.5 }) },
      name: C("茶碗咖啡杯", "茶碗コーヒーカップ") },
    chairs: { kind: "ride", large: true, days: 1, wind: true, w: 4, h: 4, cash: 600, lv: 2, parts: { windmill: 1, swing: 8, tower: 1 },
      cap: 12, cycle: 4, price: 350, thrill: 3, charm: 1, photo: 1, wear: 6, fix: { chain: 2 },
      slots: { light: slot("nightLanterns", 2, { charm: 1, photo: 1 }) },
      name: C("紙風車旋轉飛椅", "風車ブランコ") },
    wheel: { kind: "ride", large: true, days: 2, wind: true, w: 6, h: 6, cash: 1200, lv: 3, parts: { cabin: 8, rim: 8, hub: 1, lanterns: 4 },
      cap: 24, cycle: 10, price: 500, thrill: 1, charm: 2, photo: 3, wear: 3, fix: { chain: 2, bulb: 4 },
      slots: { cabin: slot("glassCabin", 8, { photo: 1, price: 100 }), light: slot("nightLanterns", 4, { charm: 1 }) },
      name: C("燈籠摩天輪", "灯籠観覧車") },
    // 參道緣日區（一般設施：第二層以下）
    kingyo: { kind: "ride", w: 2, h: 2, cash: 100, lv: 1, parts: { plank: 4, pane: 2 }, cap: 4, cycle: 3, price: 200, thrill: 0, charm: 2, photo: 1, wear: 2, fix: { plank: 2 }, name: C("金魚撈", "金魚すくい") },
    shateki: { kind: "ride", w: 2, h: 2, cash: 100, lv: 1, parts: { plank: 4, gear: 2 }, cap: 3, cycle: 2, price: 200, thrill: 1, charm: 1, photo: 0, wear: 2, fix: { plank: 2 }, name: C("射擊攤", "射的") },
    wanage: { kind: "ride", w: 2, h: 2, cash: 80, lv: 1, parts: { plank: 4, strip: 6 }, cap: 4, cycle: 2, price: 150, thrill: 0, charm: 1, photo: 0, wear: 1, fix: { plank: 2 }, name: C("套圈圈", "輪投げ") },
    omikuji: { kind: "ride", w: 2, h: 2, cash: 100, lv: 1, parts: { plank: 3, carving: 1, washi: 4 }, cap: 2, cycle: 1, price: 100, thrill: 0, charm: 2, photo: 2, wear: 1, fix: { plank: 2 }, name: C("抽籤所", "おみくじ所") },
    // 攤位
    takoyakiSt: { kind: "stall", w: 2, h: 2, cash: 100, lv: 1, parts: { plank: 4, canvas: 1, sheet: 1 }, sells: ["takoyaki"], name: C("章魚燒攤", "たこ焼き屋") },
    ameSt: { kind: "stall", w: 2, h: 2, cash: 100, lv: 1, parts: { plank: 4, canvas: 1 }, sells: ["ringoame", "wataame"], name: C("糖果攤", "飴屋") },
    ramuneSt: { kind: "stall", w: 2, h: 2, cash: 100, lv: 1, parts: { plank: 4, pane: 2 }, sells: ["ramune"], name: C("汽水攤", "ラムネ屋") },
    kasaSt: { kind: "stall", w: 2, h: 2, cash: 100, lv: 1, parts: { plank: 4, canvas: 1 }, sells: ["kasa"], name: C("和傘攤", "和傘屋") },
    juyo: { kind: "stall", w: 2, h: 2, cash: 150, lv: 2, parts: { plank: 4, carving: 2, paint: 1 }, sells: ["omamori", "ema"], name: C("授與所", "授与所") },
    qstall: { kind: "qstall", w: 1, h: 1, cash: 60, lv: 1, parts: { plank: 2, canvas: 1 }, sells: ["ramune", "wataame", "takoyaki"], name: C("排隊屋台", "行列屋台") },
    // 設施與裝飾
    bench: { kind: "facility", w: 1, h: 1, cash: 30, lv: 1, parts: { plank: 3 }, serves: "fatigue", cap: 2, time: 5, name: C("長椅", "ベンチ") },
    toilet: { kind: "facility", w: 2, h: 2, cash: 200, lv: 1, parts: { plank: 6, bisque: 2 }, serves: "toilet", cap: 3, time: 2, name: C("廁所", "トイレ") },
    trash: { kind: "facility", w: 1, h: 1, cash: 20, lv: 1, parts: { strip: 3 }, serves: "trash", cap: 0, time: 0, name: C("垃圾桶", "ゴミ箱") },
    shelter: { kind: "facility", w: 2, h: 2, cash: 150, lv: 1, parts: { plank: 4, canvas: 2, strip: 4 }, serves: "shelter", cap: 6, time: 5, name: C("休憩棚", "休憩所") },
    lanternPost: { kind: "deco", w: 1, h: 1, cash: 40, lv: 1, parts: { bulb: 2, washi: 2, strip: 2 }, joy: 0.06, name: C("燈籠柱", "灯籠柱") },
    flower: { kind: "deco", w: 1, h: 1, cash: 20, lv: 1, parts: {}, joy: 0.04, name: C("花圃", "花壇") },
  };

  // 依 sim.js 調整（2026-11-12）：客群預算 原值 親子 1500〜3000／情侶 1500〜2500／學生 600〜1200／其餘 1000〜2000
  //   → 新值 約 ×0.4（學生 300〜600）。理由：預算太多時客人錢花不完、免費參拜無限加心情，
  //   四個種子的季平均心情都在 94（目標 50〜85）；調整後 76〜78。
  D.GUESTS = [
    { id: "family", w: 0.25, cash: [600, 1200], pref: { thrill: 0.2, charm: 1, photo: 0.4 }, patience: 25, name: C("親子", "親子") },
    { id: "couple", w: 0.2, cash: [600, 1000], pref: { thrill: 0.4, charm: 0.6, photo: 1 }, patience: 30, name: C("情侶", "カップル") },
    { id: "student", w: 0.2, cash: [300, 600], pref: { thrill: 0.8, charm: 0.5, photo: 0.4 }, patience: 20, name: C("學生", "学生") },
    { id: "thrill", w: 0.1, cash: [400, 800], pref: { thrill: 1, charm: 0.1, photo: 0.2 }, patience: 35, name: C("刺激派", "絶叫派") },
    { id: "photo", w: 0.15, cash: [400, 800], pref: { thrill: 0.2, charm: 0.6, photo: 1 }, patience: 25, name: C("拍照派", "映え派") },
    { id: "elder", w: 0.1, cash: [400, 800], pref: { thrill: 0, charm: 0.8, photo: 0.3 }, patience: 40, name: C("老人家", "お年寄り") },
  ];

  D.NEED_RATE = { fun: 0.3, hunger: 0.2, thirst: 0.25, toilet: 0.15, fatigue: 0.12, dry: 0 };
  D.NEED_TO = { fun: ["ride", "shrine", "goods"], hunger: ["food"], thirst: ["drink"], toilet: ["toilet"], fatigue: ["fatigue", "shelter"], dry: ["kasa", "shelter"] };

  D.WEATHER = {
    sun: { w: 0.45, arrive: 1, thirst: 1.3, hunger: 1, name: C("晴", "晴れ") },
    cloud: { w: 0.3, arrive: 1, thirst: 1, hunger: 1, name: C("陰", "くもり") },
    rain: { w: 0.18, arrive: 0.6, thirst: 0.6, hunger: 1.2, wet: true, name: C("雨", "雨") },
    wind: { w: 0.07, arrive: 0.85, thirst: 1, hunger: 1, stop: true, name: C("強風", "強風") },
  };

  D.WISH = { MAX: 3, CHANCE: 0.1, EXPIRE: 7, SELL_N: 30, QUEUE_OK: 10, REWARD: { build: 15, upgrade: 15, sell: 10, queue: 12, shelter: 12 }, PENALTY: 3 };

  D.PHOTOS = [];
  for (var i = 0; i < 32; i++) D.PHOTOS.push("n_" + (i < 10 ? "00" : "0") + i);

  // 開局：夠開 2 個攤位＋2 個攤位遊戲＋長椅；旋轉木馬的生產線要自己建（第一個目標）
  D.START_WARE = { plank: 30, canvas: 4, sheet: 6, pane: 4, gear: 2, strip: 8, wood: 20, iron: 10, urushi: 4, pigment: 4, flour: 10, octopus: 10, sugar: 10, cloth: 6 };
  D.START_MACHINES = ["saw", "press", "carve", "wood", "lacquer", "griddle"];

  window.PriTestEnnichiData = D;
})();
