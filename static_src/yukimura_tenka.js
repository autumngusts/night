// 大名幸村（yukimura）新模式「天下布武」：資料與規則（2026-11-06 依使用者需求新增）。
// 使用者需求：
//   ・新模式能帶入原本的本陣強化數值（D.META 照樣套用）
//   ・參考其他倖存者遊戲大幅更新玩法與搭配：天命（開局／中盤選規則卡）、流派共鳴（同流派武器湊數量）、
//     升級時的封印（Banish）／略過（Skip）、軍令（限時任務）、精英詞綴、逆鱗（自願加難度換報酬）
//   ・新本陣「軍略樹」類似天賦樹（前置節點、分支）
//   ・出陣帶的符文放進固定大小的格子，每個符文形狀不同，要想辦法拼滿（整列／整欄／全滿有額外加成）
//   ・新模式打到新幣別「軍功 🎖️」強化新本陣
// 只放資料與純函式；模擬中的掛勾由 yukimura_core.js 在 s.mode === "tenka" 時呼叫。
(function () {
  "use strict";

  var D = window.PriTestYukimuraData;
  var C = D.C;

  // ---------------- 流派（攻擊方式的分類；同流派湊 2／3／4 把得到共鳴）----------------
  var SCHOOLS = [
    { k: "ken", icon: "⚔️", color: 0xc0262d, name: C("劍豪", "剣豪"), arches: ["tachi", "yari", "naginata", "kusarigama", "kiba"],
      tiers: [[["might", 0.08]], [["area", 0.12], ["armor", 1]], [["might", 0.2], ["critDmg", 0.3]]], desc: C("近戰重擊。滿階：近戰擊中時 20% 機率追加一道斬擊", "近接の重撃。最大段階：近接命中時 20% で追撃の斬撃") },
    { k: "kyu", icon: "🏹", color: 0x3a7ad0, name: C("弓馬", "弓馬"), arches: ["yumi", "teppo", "tessen", "yanoame"],
      tiers: [[["pspd", 0.15]], [["crit", 0.06], ["pspd", 0.1]], [["amount", 1], ["crit", 0.08]]], desc: C("遠距射擊。滿階：投射數 +1", "遠距離射撃。最大段階：投射数 +1") },
    { k: "nin", icon: "🥷", color: 0x5a5a6a, name: C("忍術", "忍術"), arches: ["shuriken", "kunai", "makibishi", "horoku"],
      tiers: [[["cdr", 0.05]], [["speed", 0.1], ["crit", 0.05]], [["cdr", 0.08], ["luck", 0.2]]], desc: C("快速連擊。滿階：擊殺時 10% 機率重置一把武器的冷卻", "素早い連撃。最大段階：撃破時 10% で武器 1 つの冷却を即時完了") },
    { k: "onmyo", icon: "☯️", color: 0x9a5ad0, name: C("陰陽", "陰陽"), arches: ["ofuda", "shikigami", "hamaya", "juzu"],
      tiers: [[["dur", 0.12]], [["elem", 0.2], ["regen", 0.3]], [["dur", 0.2], ["might", 0.12]]], desc: C("咒術結界。滿階：每 12 秒張開結界，3 秒內受到傷害減半", "呪術の結界。最大段階：12 秒ごとに結界、3 秒間被ダメージ半減") },
    { k: "tenko", icon: "🌩️", color: 0x30b0c0, name: C("天候", "天候"), arches: ["kaminari", "kaen", "tsurara"],
      tiers: [[["elem", 0.15]], [["elem", 0.25], ["area", 0.08]], [["elem", 0.4], ["might", 0.1]]], desc: C("元素之力。滿階：異常狀態的敵人受到傷害 +25%", "元素の力。最大段階：状態異常の敵への与ダメージ +25%") },
    { k: "gunryaku", icon: "🚩", color: 0xd0a030, name: C("軍略", "軍略"), arches: ["horagai", "hata", "taiko", "ozutsu"],
      tiers: [[["knock", 0.2]], [["area", 0.1], ["maxHp", 20]], [["might", 0.15], ["armor", 2]]], desc: C("號令全軍。滿階：采配累積速度 +50%", "全軍に号令。最大段階：采配の溜まりが +50%") }
  ];
  var SCHOOL_OF = {};
  SCHOOLS.forEach(function (sc, i) { sc.i = i; sc.arches.forEach(function (a) { SCHOOL_OF[a] = sc.k; }); });
  var SCHOOL = {};
  SCHOOLS.forEach(function (sc) { SCHOOL[sc.k] = sc; });
  var TIER_N = [2, 3, 4];

  // ---------------- 天命（開局與第 1/3、2/3 時各選一張；改變規則）----------------
  var ARCANA = [
    { k: "hyakki", icon: "👹", name: C("百鬼夜行", "百鬼夜行"), desc: C("敵人出現 +35%，經驗值 +40%、軍功掉落 +30%", "敵の出現 +35%、経験値 +40%、軍功 +30%"), st: [["growth", 0.4]] },
    { k: "ikki", icon: "🗡️", name: C("一騎當千", "一騎当千"), desc: C("攻擊力 +50%，但最大體力 -30%", "攻撃力 +50%、ただし最大体力 -30%"), st: [["might", 0.5]] },
    { k: "tenpen", icon: "🌩️", name: C("天變地異", "天変地異"), desc: C("每 6 秒在身邊劈下 6 道天雷", "6 秒ごとに周囲へ天雷 6 本") },
    { k: "kajiba", icon: "🔥", name: C("火事場", "火事場"), desc: C("體力越低攻擊越強（最多 +80%）", "体力が低いほど攻撃力アップ（最大 +80%）") },
    { k: "ougon", icon: "💰", name: C("黃金律", "黄金律"), desc: C("金錢 +80%，金錢加成的一半也算進攻擊力", "金銭 +80%、金銭ボーナスの半分が攻撃力にも"), st: [["greed", 0.8]] },
    { k: "kage", icon: "👥", name: C("影分身", "影分身"), desc: C("投射數 +1，持續時間 -15%", "投射数 +1、持続時間 -15%"), st: [["amount", 1], ["dur", -0.15]] },
    { k: "fudo", icon: "🪨", name: C("不動明王", "不動明王"), desc: C("停下腳步時攻擊 +40%、防禦 +4", "立ち止まると攻撃 +40%、防御 +4") },
    { k: "fuurin", icon: "🌬️", name: C("風林火山", "風林火山"), desc: C("移動速度 +25%、冷卻 -10%；移動中攻擊 +15%", "移動速度 +25%、冷却 -10%、移動中は攻撃 +15%"), st: [["speed", 0.25], ["cdr", 0.1]] },
    { k: "ruten", icon: "🔮", name: C("萬物流轉", "万物流転"), desc: C("異常強化 +60%；每次命中 15% 機率附加隨機異常", "状態異常強化 +60%、命中時 15% でランダム異常"), st: [["elem", 0.6]] },
    { k: "chikei", icon: "🩸", name: C("血之盟約", "血の盟約"), desc: C("擊殺回復 +0.25，體力回復停止", "撃破回復 +0.25、自然回復が止まる"), st: [["steal", 0.25]] },
    { k: "hagun", icon: "🎯", name: C("破軍星", "破軍星"), desc: C("會心率 +15%、會心傷害 +60%", "会心率 +15%、会心ダメージ +60%"), st: [["crit", 0.15], ["critDmg", 0.6]] },
    { k: "tenun", icon: "🍀", name: C("天運", "天運"), desc: C("幸運 +50%；寶箱多升級一件", "幸運 +50%、宝箱でさらに 1 つ強化"), st: [["luck", 0.5]] },
    { k: "senkyaku", icon: "🧲", name: C("千客萬來", "千客万来"), desc: C("拾取範圍 ×2，經驗值 +15%", "回収範囲 ×2、経験値 +15%"), st: [["magnet", 1], ["growth", 0.15]] },
    { k: "bakuen", icon: "💥", name: C("爆炎連鎖", "爆炎連鎖"), desc: C("敵人被打倒時 30% 機率爆炸，波及周圍", "撃破時 30% で爆発し周囲を巻き込む") },
    { k: "hyogoku", icon: "❄️", name: C("冰獄", "氷獄"), desc: C("命中 25% 機率凍結；凍結的敵人受到傷害 +30%", "命中時 25% で凍結、凍結した敵への与ダメージ +30%") },
    { k: "bushin", icon: "🏯", name: C("武神", "武神"), desc: C("武器等級合計每 1 級，攻擊力 +1.5%", "武器レベル合計 1 につき攻撃力 +1.5%") }
  ];
  var ARC = {};
  ARCANA.forEach(function (a, i) { a.i = i; ARC[a.k] = a; });

  // ---------------- 符文（polyomino；出陣時拼進固定大小的符文格）----------------
  // shape：格子座標 [x, y]。旋轉 90° 倍數。越大塊效果越強；同列／同欄填滿、全格填滿有額外加成。
  var SHAPES = {
    o1: [[0, 0]],
    i2: [[0, 0], [1, 0]],
    i3: [[0, 0], [1, 0], [2, 0]],
    l3: [[0, 0], [0, 1], [1, 1]],
    i4: [[0, 0], [1, 0], [2, 0], [3, 0]],
    o4: [[0, 0], [1, 0], [0, 1], [1, 1]],
    t4: [[0, 0], [1, 0], [2, 0], [1, 1]],
    s4: [[1, 0], [2, 0], [0, 1], [1, 1]],
    z4: [[0, 0], [1, 0], [1, 1], [2, 1]],
    l4: [[0, 0], [0, 1], [0, 2], [1, 2]],
    j4: [[1, 0], [1, 1], [1, 2], [0, 2]],
    p5: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]],
    u5: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
    x5: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
    v5: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
    w5: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]]
  };
  // r：稀有度 1〜3；sp：特殊效果（在 core 掛勾）
  var RUNES = [
    { k: "bu", shape: "o1", r: 1, icon: "武", color: 0xc0262d, name: C("武之符", "武の符"), st: [["might", 0.04]] },
    { k: "ju", shape: "o1", r: 1, icon: "壽", color: 0x2a9a50, name: C("壽之符", "寿の符"), st: [["maxHp", 8]] },
    { k: "soku", shape: "i2", r: 1, icon: "速", color: 0x3a7ad0, name: C("速之符", "速の符"), st: [["speed", 0.06], ["pspd", 0.08]] },
    { k: "kin", shape: "i2", r: 1, icon: "金", color: 0xd0a030, name: C("金之符", "金の符"), st: [["greed", 0.15]] },
    { k: "gaku", shape: "i2", r: 1, icon: "學", color: 0x7a5ad0, name: C("學之符", "学の符"), st: [["growth", 0.06]] },
    { k: "kou", shape: "l3", r: 1, icon: "甲", color: 0x6a6a7a, name: C("甲之符", "甲の符"), st: [["armor", 1.5]] },
    { k: "kiri", shape: "i3", r: 1, icon: "霧", color: 0x80a0b0, name: C("霧之符", "霧の符"), st: [["dur", 0.12], ["area", 0.05]] },
    { k: "kai", shape: "l3", r: 1, icon: "回", color: 0x30b070, name: C("回之符", "回の符"), st: [["regen", 0.35]] },
    { k: "taka", shape: "i3", r: 2, icon: "鷹", color: 0xa07030, name: C("鷹之符", "鷹の符"), st: [["crit", 0.06]] },
    { k: "tou", shape: "t4", r: 2, icon: "刀", color: 0xd04040, name: C("刀之符", "刀の符"), st: [["might", 0.1], ["critDmg", 0.15]] },
    { k: "en", shape: "s4", r: 2, icon: "圓", color: 0x4060d0, name: C("圓之符", "円の符"), st: [["area", 0.12]] },
    { k: "hayagane", shape: "z4", r: 2, icon: "鐘", color: 0x50a0d0, name: C("早鐘之符", "早鐘の符"), st: [["cdr", 0.06]] },
    { k: "fuku", shape: "o4", r: 2, icon: "福", color: 0x40b040, name: C("福之符", "福の符"), st: [["luck", 0.15], ["magnet", 0.2]] },
    { k: "doku", shape: "l4", r: 2, icon: "毒", color: 0x7ab030, name: C("毒之符", "毒の符"), st: [["elem", 0.2]], sp: "doku" },
    { k: "honoo", shape: "j4", r: 2, icon: "炎", color: 0xe06020, name: C("炎之符", "炎の符"), st: [["might", 0.05]], sp: "honoo" },
    { k: "kyuu", shape: "i4", r: 2, icon: "吸", color: 0xa02040, name: C("吸魂之符", "吸魂の符"), st: [["steal", 0.06]], sp: "kyuu" },
    { k: "rai", shape: "t4", r: 2, icon: "雷", color: 0xe0d040, name: C("雷之符", "雷の符"), st: [["crit", 0.03]], sp: "rai" },
    { k: "haisui", shape: "p5", r: 3, icon: "背", color: 0x902020, name: C("背水之符", "背水の符"), st: [["maxHp", 10]], sp: "haisui" },
    { k: "fudo", shape: "u5", r: 3, icon: "不", color: 0x705030, name: C("不動之符", "不動の符"), st: [["armor", 2]], sp: "fudo" },
    { k: "renzan", shape: "w5", r: 3, icon: "連", color: 0xd06090, name: C("連斬之符", "連斬の符"), st: [["might", 0.05]], sp: "renzan" },
    { k: "bunshin", shape: "x5", r: 3, icon: "分", color: 0x6040a0, name: C("分身之符", "分身の符"), st: [["amount", 1]] },
    { k: "tenka", shape: "v5", r: 3, icon: "天", color: 0xe0b020, name: C("天下之符", "天下の符"), st: [["might", 0.12], ["growth", 0.08], ["greed", 0.15]] }
  ];
  var RUNE = {};
  RUNES.forEach(function (r, i) { r.i = i; RUNE[r.k] = r; });
  var RUNE_SP = {
    doku: C("命中 15% 機率中毒", "命中時 15% で毒"),
    honoo: C("命中 15% 機率灼燒", "命中時 15% で炎上"),
    kyuu: C("每擊殺 40 隻回復 6 體力", "40 体撃破ごとに体力 6 回復"),
    rai: C("會心時 25% 機率在目標落雷", "会心時 25% で対象に落雷"),
    haisui: C("體力 40% 以下時攻擊 +35%", "体力 40% 以下で攻撃 +35%"),
    fudo: C("停下腳步時防禦 +3、攻擊 +15%", "立ち止まると防御 +3・攻撃 +15%"),
    renzan: C("連斬加成上限 30% → 60%", "連斬ボーナス上限 30% → 60%")
  };
  // 拼格加成：每填滿一列／一欄、全部填滿
  var LINE_BONUS = [["might", 0.02], ["maxHp", 4]];
  var PERFECT_BONUS = [["might", 0.1], ["cdr", 0.04], ["luck", 0.1], ["growth", 0.05]];

  // ---------------- 新本陣「軍略樹」（軍功強化；前置節點 lv ≥ 1 才能點）----------------
  // eff：能力 [k, v/lv]；或特殊 sp：board（符文格 +1 列／欄）、arcN（天命多一個選項）、ban（封印次數）、skip（略過次數）、
  //       rr（重抽次數）、rev（影武者）、startW（開局多一把隨機武器）、startLv（起始武器 +1 級）、medal（軍功 +%）、
  //       quest（軍令報酬 +%）、elite（精英多掉寶箱機率）、school（流派共鳴門檻 -1，最多 1）
  var TREE = [
    { id: "root", x: 3, y: 0, max: 1, cost: 10, req: [], icon: "🏯", name: C("本丸", "本丸"), eff: ["might", 0.03] },
    // 武（左）
    { id: "b1", x: 1, y: 1, max: 5, cost: 20, req: ["root"], icon: "⚔️", name: C("鍛刀", "鍛刀"), eff: ["might", 0.03] },
    { id: "b2", x: 0, y: 2, max: 3, cost: 40, req: ["b1"], icon: "🎯", name: C("鷹眼", "鷹の目"), eff: ["crit", 0.03] },
    { id: "b3", x: 1, y: 2, max: 3, cost: 40, req: ["b1"], icon: "💥", name: C("砥礪", "研ぎ澄まし"), eff: ["critDmg", 0.1] },
    { id: "b4", x: 0, y: 3, max: 3, cost: 70, req: ["b2", "b3"], icon: "🌀", name: C("大太刀", "大太刀"), eff: ["area", 0.05] },
    { id: "b5", x: 1, y: 3, max: 1, cost: 120, req: ["b3"], icon: "🗡️", name: C("家傳名刀", "家伝の名刀"), sp: "startLv" },
    { id: "b6", x: 0, y: 4, max: 1, cost: 300, req: ["b4"], icon: "✳️", name: C("千手觀音", "千手観音"), eff: ["amount", 1] },
    { id: "b7", x: 1, y: 4, max: 1, cost: 220, req: ["b5"], icon: "🎒", name: C("備品倉", "備品蔵"), sp: "startW" },
    // 守（中左）
    { id: "g1", x: 2, y: 1, max: 5, cost: 20, req: ["root"], icon: "❤️", name: C("兵糧倉", "兵糧蔵"), eff: ["maxHp", 8] },
    { id: "g2", x: 2, y: 2, max: 3, cost: 45, req: ["g1"], icon: "🛡️", name: C("石垣", "石垣"), eff: ["armor", 1] },
    { id: "g3", x: 2, y: 3, max: 3, cost: 60, req: ["g2"], icon: "💚", name: C("湯治場", "湯治場"), eff: ["regen", 0.2] },
    { id: "g4", x: 2, y: 4, max: 2, cost: 400, req: ["g3"], icon: "🥷", name: C("影武者之里", "影武者の里"), sp: "rev" },
    // 智（中右）
    { id: "c1", x: 4, y: 1, max: 5, cost: 20, req: ["root"], icon: "📈", name: C("藩校", "藩校"), eff: ["growth", 0.04] },
    { id: "c2", x: 4, y: 2, max: 3, cost: 50, req: ["c1"], icon: "🎲", name: C("易者", "易者"), sp: "rr" },
    { id: "c3", x: 3, y: 2, max: 3, cost: 60, req: ["c1", "g1"], icon: "🚫", name: C("禁制", "禁制"), sp: "ban" },
    { id: "c4", x: 3, y: 3, max: 3, cost: 60, req: ["c3"], icon: "⏭️", name: C("見送", "見送り"), sp: "skip" },
    { id: "c5", x: 4, y: 3, max: 1, cost: 250, req: ["c2"], icon: "🎴", name: C("天文方", "天文方"), sp: "arcN" },
    { id: "c6", x: 3, y: 4, max: 1, cost: 350, req: ["c4", "c5"], icon: "☯️", name: C("兵法皆傳", "兵法皆伝"), sp: "school" },
    { id: "c7", x: 4, y: 4, max: 3, cost: 90, req: ["c5"], icon: "⏱️", name: C("軍師", "軍師"), eff: ["cdr", 0.02] },
    // 財（右）
    { id: "z1", x: 5, y: 1, max: 5, cost: 20, req: ["root"], icon: "💰", name: C("樂市樂座", "楽市楽座"), eff: ["greed", 0.08] },
    { id: "z2", x: 6, y: 2, max: 3, cost: 40, req: ["z1"], icon: "🧲", name: C("小荷駄隊", "小荷駄隊"), eff: ["magnet", 0.15] },
    { id: "z3", x: 5, y: 2, max: 3, cost: 50, req: ["z1"], icon: "🍀", name: C("神社奉納", "神社奉納"), eff: ["luck", 0.06] },
    { id: "z4", x: 6, y: 3, max: 5, cost: 60, req: ["z2"], icon: "🎖️", name: C("論功行賞", "論功行賞"), sp: "medal" },
    { id: "z5", x: 5, y: 3, max: 3, cost: 70, req: ["z3"], icon: "📜", name: C("軍令狀", "軍令状"), sp: "quest" },
    { id: "z6", x: 5, y: 4, max: 3, cost: 90, req: ["z5"], icon: "🎁", name: C("戰利品", "戦利品"), sp: "elite" },
    { id: "z7", x: 6, y: 4, max: 1, cost: 160, req: ["z4"], icon: "👣", name: C("早馬", "早馬"), eff: ["speed", 0.08] },
    // 符文格（底部，連到三條線）
    { id: "r1", x: 2, y: 5, max: 1, cost: 80, req: ["g2"], icon: "🔲", name: C("符文格・擴張一", "符文枠・拡張一"), sp: "board" },
    { id: "r2", x: 3, y: 5, max: 1, cost: 200, req: ["r1", "c4"], icon: "🔲", name: C("符文格・擴張二", "符文枠・拡張二"), sp: "board" },
    { id: "r3", x: 4, y: 5, max: 1, cost: 450, req: ["r2", "c7"], icon: "🔲", name: C("符文格・擴張三", "符文枠・拡張三"), sp: "board" },
    { id: "r4", x: 3, y: 6, max: 1, cost: 900, req: ["r3", "b6", "z6"], icon: "🏯", name: C("天下人", "天下人"), eff: ["might", 0.1] }
  ];
  var NODE = {};
  TREE.forEach(function (n) { NODE[n.id] = n; });
  var SP_TEXT = {
    board: C("符文格擴大一格（4×4 → 5×4 → 5×5 → 6×5）", "符文枠を広げる（4×4 → 5×4 → 5×5 → 6×5）"),
    arcN: C("選天命時多一個選項", "天命の選択肢 +1"),
    ban: C("升級時可封印選項 +1 次（之後不再出現）", "レベルアップ選択肢の封印 +1 回"),
    skip: C("升級時可略過 +1 次（得到少量錢與回復）", "レベルアップのスキップ +1 回"),
    rr: C("升級重抽 +1 次", "引き直し +1 回"),
    rev: C("影武者復活 +1 次", "影武者の復活 +1 回"),
    startW: C("開局多帶一把隨機武器", "開始時に武器をもう 1 つ"),
    startLv: C("起始武器從 Lv2 開始", "初期武器が Lv2 から"),
    medal: C("軍功 +12%／級", "軍功 +12%／Lv"),
    quest: C("軍令報酬 +30%／級", "軍令の報酬 +30%／Lv"),
    elite: C("精英掉寶箱機率 +10%／級", "精鋭の宝箱率 +10%／Lv"),
    school: C("流派共鳴的門檻 -1（2 把就到第二階）", "流派共鳴の必要数 -1")
  };
  var BOARD_SIZES = [[4, 4], [5, 4], [5, 5], [6, 5]];

  // ---------------- 逆鱗（自願加難度；軍功與符文更好）----------------
  var HEAT_MAX = 5;
  function heatMul(h) { return { hp: 1 + 0.2 * h, dmg: 1 + 0.12 * h, rate: 1 + 0.08 * h, medal: 1 + 0.25 * h }; }

  // ---------------- 精英詞綴 ----------------
  var AFFIX = [
    { k: "swift", icon: "💨", name: C("迅速", "迅速") },
    { k: "iron", icon: "🛡️", name: C("堅牢", "堅牢") },
    { k: "regen", icon: "💚", name: C("再生", "再生") },
    { k: "split", icon: "🧬", name: C("分裂", "分裂") },
    { k: "blast", icon: "💣", name: C("自爆", "自爆") }
  ];

  // ---------------- 軍令（限時任務）----------------
  var QUESTS = [
    { k: "kill", icon: "⚔️", name: C("殲滅令：時限內擊殺 {n} 隻", "殲滅令：時間内に {n} 体撃破") },
    { k: "elite", icon: "👹", name: C("討伐令：打倒 {n} 隻精英", "討伐令：精鋭を {n} 体撃破") },
    { k: "nohit", icon: "🛡️", name: C("無傷令：{n} 秒內不受傷", "無傷令：{n} 秒間被弾なし") },
    { k: "gold", icon: "💰", name: C("徵收令：收集 {n} 錢", "徴収令：銭を {n} 集める") }
  ];
  var QUEST = {};
  QUESTS.forEach(function (q) { QUEST[q.k] = q; });

  // ---------------- 純函式：形狀、拼格 ----------------
  function rotate(cells, rot) {
    var out = cells.map(function (c) { return [c[0], c[1]]; });
    for (var r = 0; r < ((rot | 0) % 4 + 4) % 4; r++) out = out.map(function (c) { return [-c[1], c[0]]; });
    var mx = Infinity, my = Infinity;
    out.forEach(function (c) { if (c[0] < mx) mx = c[0]; if (c[1] < my) my = c[1]; });
    return out.map(function (c) { return [c[0] - mx, c[1] - my]; });
  }
  function runeCells(runeK, rot) { var r = RUNE[runeK]; return r ? rotate(SHAPES[r.shape], rot) : []; }
  function boardSize(tree) {
    var n = 0;
    TREE.forEach(function (nd) { if (nd.sp === "board" && (tree && tree[nd.id] | 0) > 0) n++; });
    return BOARD_SIZES[Math.min(n, BOARD_SIZES.length - 1)];
  }
  // placed：[{ u（背包 uid）, k, x, y, rot }]；回傳 { grid（每格放的 index 或 -1）, ok, filled, lines, perfect }
  function evalBoard(placed, size) {
    var W = size[0], H = size[1], grid = [], i;
    for (i = 0; i < W * H; i++) grid.push(-1);
    var ok = true, filled = 0;
    (placed || []).forEach(function (p, pi) {
      runeCells(p.k, p.rot).forEach(function (c) {
        var x = p.x + c[0], y = p.y + c[1];
        if (x < 0 || y < 0 || x >= W || y >= H || grid[y * W + x] >= 0) { ok = false; return; }
        grid[y * W + x] = pi; filled++;
      });
    });
    var lines = 0, x, y, full;
    for (y = 0; y < H; y++) { full = true; for (x = 0; x < W; x++) if (grid[y * W + x] < 0) full = false; if (full) lines++; }
    for (x = 0; x < W; x++) { full = true; for (y = 0; y < H; y++) if (grid[y * W + x] < 0) full = false; if (full) lines++; }
    return { grid: grid, ok: ok, filled: filled, lines: lines, perfect: filled === W * H, W: W, H: H };
  }
  function canPlace(placed, size, k, x, y, rot, skipIndex) {
    var b = evalBoard(placed.filter(function (_, i) { return i !== skipIndex; }), size);
    var cells = runeCells(k, rot);
    for (var i = 0; i < cells.length; i++) {
      var cx = x + cells[i][0], cy = y + cells[i][1];
      if (cx < 0 || cy < 0 || cx >= b.W || cy >= b.H) return false;
      if (b.grid[cy * b.W + cx] >= 0) return false;
    }
    return true;
  }

  // ---------------- 出陣時帶進對局的「軍略」：從存檔整理成精簡物件（放進 P.meta.tk）----------------
  function loadout(tp) {
    tp = tp || {};
    var tree = tp.tree || {}, size = boardSize(tree);
    var placed = (tp.board || []).filter(function (p) { return RUNE[p.k]; });
    var b = evalBoard(placed, size);
    if (!b.ok) placed = [];   // 壞掉的配置不帶
    return { tree: tree, runes: placed.map(function (p) { return p.k; }), lines: b.ok ? b.lines : 0, perfect: b.ok && b.perfect ? 1 : 0, heat: tp.heat | 0 };
  }
  function treeSp(tree, sp) {
    var n = 0;
    TREE.forEach(function (nd) { if (nd.sp === sp) n += tree && tree[nd.id] | 0; });
    return n;
  }

  // 能力加成（calcStats 裡呼叫）：軍略樹、符文、拼格、天命、流派共鳴
  function applyStats(P, add, schoolCounts) {
    var tk = P.meta && P.meta.tk;
    if (tk) {
      TREE.forEach(function (nd) { var lv = tk.tree && tk.tree[nd.id] | 0; if (lv && nd.eff) add(nd.eff[0], nd.eff[1] * lv); });
      (tk.runes || []).forEach(function (k) { var r = RUNE[k]; if (r) (r.st || []).forEach(function (b) { add(b[0], b[1]); }); });
      for (var l = 0; l < (tk.lines | 0); l++) LINE_BONUS.forEach(function (b) { add(b[0], b[1]); });
      if (tk.perfect) PERFECT_BONUS.forEach(function (b) { add(b[0], b[1]); });
    }
    (P.arc || []).forEach(function (k) { var a = ARC[k]; if (a && a.st) a.st.forEach(function (b) { add(b[0], b[1]); }); });
    var tiers = schoolTiers(P, schoolCounts);
    Object.keys(tiers).forEach(function (sk) {
      var sc = SCHOOL[sk];
      for (var t = 0; t < tiers[sk]; t++) sc.tiers[t].forEach(function (b) { add(b[0], b[1]); });
    });
  }
  function schoolCounts(P) {
    var c = {};
    (P.W || []).forEach(function (w) { var W = D.WEAPONS[w.id]; var sk = W && SCHOOL_OF[D.ARCHES[W.a].k]; if (sk) c[sk] = (c[sk] || 0) + 1; });
    return c;
  }
  function schoolTiers(P, counts) {
    var c = counts || schoolCounts(P), out = {}, minus = P.meta && P.meta.tk ? Math.min(1, treeSp(P.meta.tk.tree, "school")) : 0;
    Object.keys(c).forEach(function (sk) {
      var t = 0;
      TIER_N.forEach(function (need, i) { if (c[sk] >= need - minus) t = i + 1; });
      if (t) out[sk] = t;
    });
    return out;
  }
  // 這名玩家的特殊旗標（每次 calcStats 更新，命中時直接讀）
  function flags(P) {
    var f = {}, tk = P.meta && P.meta.tk;
    (tk && tk.runes || []).forEach(function (k) { var r = RUNE[k]; if (r && r.sp) f[r.sp] = (f[r.sp] || 0) + 1; });
    (P.arc || []).forEach(function (k) { f["a_" + k] = 1; });
    var tiers = schoolTiers(P);
    Object.keys(tiers).forEach(function (sk) { if (tiers[sk] >= 3) f["s_" + sk] = 1; });
    return f;
  }

  window.PriTestYukimuraTenka = {
    SCHOOLS: SCHOOLS, SCHOOL: SCHOOL, SCHOOL_OF: SCHOOL_OF, TIER_N: TIER_N, ARCANA: ARCANA, ARC: ARC, SHAPES: SHAPES, RUNES: RUNES, RUNE: RUNE, RUNE_SP: RUNE_SP,
    LINE_BONUS: LINE_BONUS, PERFECT_BONUS: PERFECT_BONUS, TREE: TREE, NODE: NODE, SP_TEXT: SP_TEXT, BOARD_SIZES: BOARD_SIZES, HEAT_MAX: HEAT_MAX, heatMul: heatMul,
    AFFIX: AFFIX, QUESTS: QUESTS, QUEST: QUEST,
    rotate: rotate, runeCells: runeCells, boardSize: boardSize, evalBoard: evalBoard, canPlace: canPlace, loadout: loadout, treeSp: treeSp,
    applyStats: applyStats, schoolCounts: schoolCounts, schoolTiers: schoolTiers, flags: flags
  };
})();
