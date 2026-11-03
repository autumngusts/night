// 繩文帝國（jomon）：靜態資料 —— 9 個時代、建築、5 種兵種（＋野獸／民兵／箭塔）、強化研究、
// 時代建築（升時代時二選一）、5 個文明（飛鳥時代起選擇）、NPC 討伐目標。
// 參照世紀帝國 2／4 的玩法：生產村民採集、蓋房子擴充人口、人口達標才能升時代。
// 規則總覽見 docs/jomon_game_design.md；所有數值都在這裡或 jomon_core.js 開頭，調整時請一併更新該文件。
// 這是全新的獨立小遊戲，與 night/midnight 的 TRPG 規則無關。
(function () {
  "use strict";

  function C(ja, zh) {
    return { ja: ja, zh: zh };
  }

  function lang() {
    return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || "zh";
  }

  // en 沿用專案慣例 fallback 到 ja（§6）
  function localizedText(obj) {
    if (!obj) return "";
    if (typeof obj === "string") return obj;
    var l = lang();
    if (l === "zh") return obj.zh || obj.ja || "";
    return obj[l] || obj.ja || obj.zh || "";
  }

  var RESOURCES = ["food", "wood", "stone", "gold"];
  var RESOURCE_ICONS = { food: "🍖", wood: "🪵", stone: "🪨", gold: "🪙" };
  // 市場換算價值（1 單位相當於多少「食物」）
  var RESOURCE_VALUE = { food: 1, wood: 1, stone: 1.5, gold: 2 };
  var GOLD_AGE = 2; // 古墳時代起才能採金

  // ---------------- 時代 ----------------
  // popToNext：使用者指定的升級人口門檻（300 / 750 / 1800 / 4000 / 10000 / 25000 / 50000 / 100000）
  // houseCap：每棟住居的人口上限；capMult：採集據點／水田容量倍率；tcBatch：村落中心每輪生產村民數
  var AGES = [
    { id: "jomon", name: C("縄文時代", "繩文時代"), era: C("約1万6千年前〜", "約一萬六千年前〜"), popToNext: 300, cost: { food: 3000, wood: 1500, stone: 500 }, time: 30, houseCap: 5, capMult: 1, tcBatch: 1, maxTC: 3, sky: 0x9fd0ef },
    { id: "yayoi", name: C("弥生時代", "彌生時代"), era: C("紀元前10世紀頃〜", "西元前十世紀左右〜"), popToNext: 750, cost: { food: 15000, wood: 5000, stone: 2500 }, time: 40, houseCap: 8, capMult: 1.5, tcBatch: 2, maxTC: 4, sky: 0x9fd0ef },
    { id: "kofun", name: C("古墳時代", "古墳時代"), era: C("3世紀中頃〜", "三世紀中葉〜"), popToNext: 1800, cost: { food: 50000, wood: 12000, stone: 6000, gold: 3000 }, time: 50, houseCap: 12, capMult: 2.5, tcBatch: 3, maxTC: 5, sky: 0xa6d2ea },
    { id: "asuka", name: C("飛鳥時代", "飛鳥時代"), era: C("6世紀末〜", "六世紀末〜"), popToNext: 4000, cost: { food: 120000, wood: 30000, stone: 15000, gold: 12000 }, time: 60, houseCap: 18, capMult: 4, tcBatch: 4, maxTC: 6, sky: 0xa9d4ec },
    { id: "nara", name: C("奈良時代", "奈良時代"), era: C("710年〜", "西元710年〜"), popToNext: 10000, cost: { food: 300000, wood: 70000, stone: 30000, gold: 30000 }, time: 70, houseCap: 28, capMult: 6, tcBatch: 6, maxTC: 7, sky: 0xaed6ee },
    { id: "heian", name: C("平安時代", "平安時代"), era: C("794年〜", "西元794年〜"), popToNext: 25000, cost: { food: 900000, wood: 200000, stone: 80000, gold: 90000 }, time: 80, houseCap: 40, capMult: 10, tcBatch: 8, maxTC: 8, sky: 0xb2d6f0 },
    { id: "kamakura", name: C("鎌倉時代", "鎌倉時代"), era: C("1185年〜", "西元1185年〜"), popToNext: 50000, cost: { food: 2500000, wood: 600000, stone: 250000, gold: 300000 }, time: 90, houseCap: 60, capMult: 16, tcBatch: 11, maxTC: 9, sky: 0xaccfe8 },
    { id: "sengoku", name: C("戦国時代", "戰國時代"), era: C("1467年〜", "西元1467年〜"), popToNext: 100000, cost: { food: 7000000, wood: 1500000, stone: 600000, gold: 700000 }, time: 100, houseCap: 90, capMult: 25, tcBatch: 15, maxTC: 10, sky: 0xa8c8e0 },
    { id: "edo", name: C("江戸時代", "江戶時代"), era: C("1603年〜", "西元1603年〜"), popToNext: null, cost: null, time: 0, houseCap: 140, capMult: 40, tcBatch: 20, maxTC: 12, sky: 0xb4d8f2 },
  ];
  var CIV_AGE = 3; // 升上飛鳥時代時選擇文明

  // ---------------- 建築 ----------------
  // cost 會乘上 (1 + costGrowth × 時代)；housing 為額外人口上限（住居另依時代計算）
  var BUILDINGS = [
    { id: "house", icon: "🛖", name: C("住居", "住居"), desc: C("人口上限を増やす（時代が進むほど 1 棟あたりの人数が増える）", "增加人口上限（時代越後面，每棟能住的人越多）"), cost: { wood: 30 }, costGrowth: 0.9, time: 6, age: 0 },
    { id: "tc", icon: "🏯", name: C("ムラの中心", "村落中心"), desc: C("村人を生産する。人口上限＋20×容量倍率、全資源の集積所を兼ねる", "生產村民；人口上限＋20×容量倍率，同時是所有資源的集散地"), cost: { wood: 250, stone: 100 }, costGrowth: 0.8, time: 30, age: 0 },
    { id: "foodcamp", icon: "🧺", name: C("貯蔵穴", "儲糧窖"), desc: C("食料の集積所。採集者の上限を超えると効率が落ちる", "食物集散地；採集者超過容量時效率下降"), cost: { wood: 50 }, costGrowth: 0.5, time: 10, age: 0 },
    { id: "woodcamp", icon: "🪓", name: C("木材置き場", "伐木場"), desc: C("木材の集積所", "木材集散地"), cost: { wood: 50 }, costGrowth: 0.5, time: 10, age: 0 },
    { id: "minecamp", icon: "⛏️", name: C("採掘場", "採掘場"), desc: C("石材・金の集積所", "石材與金的集散地"), cost: { wood: 60 }, costGrowth: 0.5, time: 12, age: 0 },
    { id: "paddy", icon: "🌾", name: C("水田", "水田"), desc: C("稲作。食料採集者が水田で働くと採集速度 1.5 倍", "稻作；在水田工作的食物採集者速度 ×1.5"), cost: { wood: 60 }, costGrowth: 0.5, time: 10, age: 1 },
    { id: "barracks", icon: "🛡️", name: C("兵舎", "兵營"), desc: C("槍兵・剣兵を訓練", "訓練槍兵、劍兵"), cost: { wood: 150 }, costGrowth: 0.6, time: 20, age: 0 },
    { id: "archery", icon: "🎯", name: C("射場", "射場"), desc: C("弓兵を訓練", "訓練弓兵"), cost: { wood: 150 }, costGrowth: 0.6, time: 20, age: 0 },
    { id: "stable", icon: "🐎", name: C("厩", "馬廄"), desc: C("騎兵を訓練", "訓練騎兵"), cost: { wood: 200, stone: 50 }, costGrowth: 0.6, time: 25, age: 2 },
    { id: "workshop", icon: "⚙️", name: C("工房", "工房"), desc: C("攻城兵器を製作", "製作攻城兵器"), cost: { wood: 300, stone: 100 }, costGrowth: 0.6, time: 30, age: 3 },
    { id: "tower", icon: "🗼", name: C("物見櫓", "望樓"), desc: C("村が襲われたとき矢を射かける（倒されない弓兵 3 体分）", "村子被襲擊時放箭（相當於 3 名不會陣亡的弓兵）"), cost: { wood: 80, stone: 60 }, costGrowth: 0.6, time: 15, age: 1 },
    { id: "market", icon: "🏮", name: C("市", "市集"), desc: C("資源を交換できる（1 つあれば利用可）", "可以交換資源（蓋一座就能用）"), cost: { wood: 200 }, costGrowth: 0.4, time: 25, age: 1, max: 1 },
  ];

  // 柵（城壁）等級：每級守備兵 HP +20%
  var WALL_LEVELS = [
    null,
    { name: C("木の柵", "木柵"), cost: { wood: 300 }, age: 0 },
    { name: C("環濠と柵", "環濠與木柵"), cost: { wood: 1200, stone: 300 }, age: 1 },
    { name: C("土塁", "土壘"), cost: { wood: 3000, stone: 2000 }, age: 3 },
    { name: C("築地塀", "夯土牆"), cost: { wood: 8000, stone: 8000, gold: 2000 }, age: 4 },
    { name: C("石垣", "石垣"), cost: { stone: 40000, gold: 10000 }, age: 6 },
    { name: C("総構え", "總構"), cost: { wood: 60000, stone: 120000, gold: 30000 }, age: 7 },
  ];

  // ---------------- 兵種 ----------------
  // 每升一個時代：攻擊／HP ×(1 + 0.3 × 時代)，費用 ×(1 + 0.25 × 時代)，名稱依時代變化
  var UNIT_CLASSES = ["spear", "infantry", "archer", "cavalry", "siege"];
  var UNITS = {
    spear: {
      id: "spear", icon: "🔱", building: "barracks", age: 0, atk: 4, hp: 30, cost: { food: 35, wood: 25 },
      note: C("騎兵に強い", "克制騎兵"),
      names: [C("石槍の狩人", "石槍獵人"), C("木槍兵", "木槍兵"), C("鉾兵", "矛兵"), C("衛士", "衛士"), C("防人", "防人"), C("薙刀兵", "薙刀兵"), C("郎党", "郎黨"), C("長槍足軽", "長槍足輕"), C("槍組", "槍組")],
    },
    infantry: {
      id: "infantry", icon: "⚔️", building: "barracks", age: 1, atk: 6, hp: 40, cost: { food: 55, wood: 15 },
      note: C("槍兵・攻城兵器に強い", "克制槍兵與攻城兵器"),
      names: [C("石斧の戦士", "石斧戰士"), C("銅剣兵", "銅劍兵"), C("鉄剣兵", "鐵劍兵"), C("大刀兵", "大刀兵"), C("兵士", "兵士"), C("武者", "武者"), C("太刀武者", "太刀武者"), C("打刀足軽", "打刀足輕"), C("番方", "番方")],
    },
    archer: {
      id: "archer", icon: "🏹", building: "archery", age: 0, atk: 5, hp: 25, cost: { food: 30, wood: 45 },
      note: C("剣兵・槍兵に強い", "克制劍兵與槍兵"),
      names: [C("縄文の弓手", "繩文弓手"), C("弓兵", "弓兵"), C("靫負", "靫負"), C("弩手", "弩手"), C("射手", "射手"), C("弓取り", "弓取"), C("弓武者", "弓武者"), C("鉄砲足軽", "鐵砲足輕"), C("鉄砲組", "鐵砲組")],
    },
    cavalry: {
      id: "cavalry", icon: "🐎", building: "stable", age: 2, atk: 7, hp: 60, cost: { food: 80, gold: 40 },
      note: C("弓兵・攻城兵器に強い、槍兵に弱い", "克制弓兵與攻城兵器，怕槍兵"),
      names: [C("騎兵", "騎兵"), C("騎兵", "騎兵"), C("騎馬兵", "騎馬兵"), C("騎兵", "騎兵"), C("騎射兵", "騎射兵"), C("騎馬武者", "騎馬武者"), C("坂東武者", "坂東武者"), C("騎馬隊", "騎馬隊"), C("騎馬組", "騎馬組")],
    },
    siege: {
      id: "siege", icon: "🪨", building: "workshop", age: 3, atk: 14, hp: 50, cost: { wood: 150, gold: 80 },
      note: C("城塞を崩す（防御を無視）。野戦は苦手", "攻破城塞（無視防禦）；不擅長野戰"),
      names: [C("破城槌", "破城槌"), C("破城槌", "破城槌"), C("破城槌", "破城槌"), C("投石機", "投石機"), C("投石機", "投石機"), C("投石機", "投石機"), C("石弓", "石弓"), C("大筒", "大筒"), C("大砲", "大砲")],
    },
  };
  // 非玩家用的特殊兵種
  var SPECIAL_UNITS = {
    beast: { id: "beast", icon: "🐗", atk: 3, hp: 24, names: [C("獣", "野獸")] },
    militia: { id: "militia", icon: "🧑‍🌾", atk: 1, hp: 10, names: [C("村人", "村民")] },
    tower: { id: "tower", icon: "🗼", atk: 5, hp: 0, names: [C("物見櫓", "望樓")] },
  };

  // 相剋倍率：COUNTERS[攻擊方][防守方]
  var COUNTERS = {
    spear: { cavalry: 2.5, beast: 1.5, siege: 1.2 },
    infantry: { spear: 1.5, siege: 2, archer: 1.2 },
    archer: { infantry: 1.5, spear: 1.5, beast: 1.3 },
    cavalry: { archer: 2, siege: 2, militia: 1.5 },
    siege: { spear: 0.6, infantry: 0.6, archer: 0.6, cavalry: 0.6, beast: 0.6 },
    beast: { militia: 1.5 },
    tower: { infantry: 1.3, spear: 1.3 },
  };

  // ---------------- 文明（升上飛鳥時代時選擇） ----------------
  // mods：與研究、時代建築共用同一套加成鍵（見 jomon_core.js 的 MOD_KEYS）
  var CIVS = [
    {
      id: "yamato", icon: "⛩️", color: 0xc0392b, name: C("大和", "大和"),
      desc: C("王権を築いた畿内の勢力。村人の生産と住居が得意で、時代を進めやすい", "建立王權的畿內勢力；擅長生產村民與住居，升時代較快"),
      mods: { tcSpeed: 0.25, housing: 0.15, ageCost: -0.15 },
      unique: { id: "toneri", base: "infantry", icon: "🗡️", name: C("舎人", "舍人"), atkMul: 1.2, hpMul: 1.4, costMul: 1.2, note: C("大王に仕える重装の近衛兵", "侍奉大王的重裝近衛兵") },
    },
    {
      id: "torai", icon: "📜", color: 0x2e86c1, name: C("渡来", "渡來"),
      desc: C("大陸から技術を伝えた渡来人。研究が安く速く、石材・金の採集が得意", "從大陸傳來技術的渡來人；研究便宜又快，擅長採石與採金"),
      mods: { techCost: -0.25, researchSpeed: 0.3, "gather.stone": 0.2, "gather.gold": 0.2 },
      unique: { id: "dohei", base: "archer", icon: "🎯", name: C("弩兵", "弩兵"), atkMul: 1.45, hpMul: 1.1, costMul: 1.25, note: C("強力な弩で敵陣を射抜く", "以強弩射穿敵陣") },
    },
    {
      id: "emishi", icon: "🐎", color: 0x27ae60, name: C("蝦夷", "蝦夷"),
      desc: C("東北の馬と狩猟の民。食料と騎兵に優れ、遠征の行軍が速い", "東北的馬與狩獵之民；食物與騎兵出色，遠征行軍快"),
      mods: { "gather.food": 0.15, "atk.cavalry": 0.2, "hp.cavalry": 0.2, travel: -0.25 },
      unique: { id: "kisha", base: "cavalry", icon: "🏇", name: C("蝦夷騎射", "蝦夷騎射"), atkMul: 1.3, hpMul: 1.15, costMul: 1.15, extraCounters: { infantry: 1.4 }, note: C("馬上から弓を射る。剣兵にも強い", "馬上射箭，對劍兵也有優勢") },
    },
    {
      id: "ryukyu", icon: "⛵", color: 0xf39c12, name: C("琉球", "琉球"),
      desc: C("南の海を結ぶ交易の民。市の手数料が安く、遠征の戦利品と交易収入が多い", "連結南方海洋的交易之民；市集手續費低，遠征戰利品與貿易收入多"),
      mods: { marketFee: -0.6, loot: 0.4, tradeIncome: 1 },
      unique: { id: "tiijii", base: "infantry", icon: "🥋", name: C("手の使い手", "唐手家"), atkMul: 1.5, hpMul: 1.0, costMul: 0.8, note: C("素手の武術。安くて攻撃が鋭い", "徒手武術；便宜而攻擊犀利") },
    },
    {
      id: "hayato", icon: "🛡️", color: 0x8e44ad, name: C("隼人", "隼人"),
      desc: C("南九州の勇猛な民。守りが固く、兵の HP が高い", "南九州的勇猛之民；防守堅固，士兵 HP 高"),
      mods: { defense: 0.5, "hp.all": 0.15 },
      unique: { id: "hayatoShield", base: "spear", icon: "🛡️", name: C("隼人の盾兵", "隼人盾兵"), atkMul: 1.1, hpMul: 1.7, costMul: 1.15, note: C("渦巻き文様の大盾で前線を支える", "以渦紋大盾撐住前線") },
    },
  ];

  // ---------------- 時代建築（AoE4 風：升時代時二選一） ----------------
  // 依「升上的那個時代」分組；model 為 3D 場景用的模型 id
  var LANDMARKS = {
    yayoi: [
      { id: "kangou", model: "kangou", name: C("環濠集落", "環濠聚落"), desc: C("村を濠で囲む。防御＋30%、住居＋10%", "以壕溝圍住村子；防禦＋30%、住居＋10%"), mods: { defense: 0.3, housing: 0.1 } },
      { id: "takayuka", model: "takayuka", name: C("高床倉庫群", "高床倉庫群"), desc: C("米を蓄える。食料＋15%、水田の収容＋30%", "儲存稻米；食物＋15%、水田容量＋30%"), mods: { "gather.food": 0.15, paddyCap: 0.3 } },
    ],
    kofun: [
      { id: "zenpoukoen", model: "kofun", name: C("前方後円墳", "前方後圓墳"), desc: C("大王の権威。以後の時代の費用−20%、自然増加＋40%", "大王的權威；之後升時代的費用−20%、自然增加＋40%"), mods: { ageCost: -0.2, birth: 0.4 } },
      { id: "tekki", model: "forge", name: C("鍛冶の里", "鍛冶之里"), desc: C("鉄器を量産。全軍の攻撃＋10%、木材・石材＋10%", "量產鐵器；全軍攻擊＋10%、木材與石材＋10%"), mods: { "atk.all": 0.1, "gather.wood": 0.1, "gather.stone": 0.1 } },
    ],
    asuka: [
      { id: "asukadera", model: "pagoda", name: C("飛鳥寺", "飛鳥寺"), desc: C("仏教と学問。研究速度＋30%、研究費用−10%", "佛教與學問；研究速度＋30%、研究費用−10%"), mods: { researchSpeed: 0.3, techCost: -0.1 } },
      { id: "miyake", model: "granary", name: C("屯倉", "屯倉"), desc: C("朝廷の直轄地。食料＋10%、村人の生産＋25%", "朝廷直轄地；食物＋10%、村民生產＋25%"), mods: { "gather.food": 0.1, tcSpeed: 0.25 } },
    ],
    nara: [
      { id: "daibutsu", model: "daibutsuden", name: C("大仏殿", "大佛殿"), desc: C("鎮護国家。自然増加 2 倍", "鎮護國家；自然增加 ×2"), mods: { birth: 1 } },
      { id: "heijokyo", model: "gate", name: C("平城京", "平城京"), desc: C("碁盤目の都。住居＋25%", "棋盤格的京城；住居＋25%"), mods: { housing: 0.25 } },
    ],
    heian: [
      { id: "byodoin", model: "phoenix", name: C("平等院鳳凰堂", "平等院鳳凰堂"), desc: C("極楽浄土の姿。全資源の採集＋10%", "極樂淨土之姿；所有資源採集＋10%"), mods: { "gather.all": 0.1 } },
      { id: "bushidan", model: "yakata", name: C("武士団の館", "武士團之館"), desc: C("武士の台頭。全軍の HP＋15%、訓練速度＋30%", "武士興起；全軍 HP＋15%、訓練速度＋30%"), mods: { "hp.all": 0.15, trainSpeed: 0.3 } },
    ],
    kamakura: [
      { id: "hachimangu", model: "shrine", name: C("鶴岡八幡宮", "鶴岡八幡宮"), desc: C("武家の守り神。戦利品＋30%、攻撃＋10%", "武家守護神；戰利品＋30%、攻擊＋10%"), mods: { loot: 0.3, "atk.all": 0.1 } },
      { id: "bakufu", model: "bakufu", name: C("幕府", "幕府"), desc: C("武家政権。防御＋40%、遠征の行軍−15%", "武家政權；防禦＋40%、遠征行軍−15%"), mods: { defense: 0.4, travel: -0.15 } },
    ],
    sengoku: [
      { id: "tenshu", model: "castle", name: C("天守", "天守"), desc: C("城郭の誕生。防御＋50%、攻撃＋10%", "城郭誕生；防禦＋50%、攻擊＋10%"), mods: { defense: 0.5, "atk.all": 0.1 } },
      { id: "rakuichi", model: "market", name: C("楽市楽座", "樂市樂座"), desc: C("自由な商い。市の手数料半減、金＋25%", "自由交易；市集手續費減半、金＋25%"), mods: { marketFee: -0.5, "gather.gold": 0.25 } },
    ],
    edo: [
      { id: "edojo", model: "bigcastle", name: C("江戸城", "江戶城"), desc: C("天下泰平。全資源＋15%", "天下太平；所有資源＋15%"), mods: { "gather.all": 0.15 } },
      { id: "gokaido", model: "road", name: C("五街道", "五街道"), desc: C("全国をつなぐ。遠征の行軍−30%、戦利品＋30%", "連結全國；遠征行軍−30%、戰利品＋30%"), mods: { travel: -0.3, loot: 0.3 } },
    ],
  };

  // ---------------- 研究（強化） ----------------
  // cost 為基準價，實際費用 × TECH_AGE_COST[研究所屬時代]（後期經濟規模大，研究也跟著變貴）；civ：只有該文明能研究
  var TECH_AGE_COST = [1, 2, 5, 8, 12, 25, 50, 100, 150];
  function T(id, age, name, desc, cost, time, mods, civ) {
    var k = TECH_AGE_COST[age];
    var scaled = {};
    Object.keys(cost).forEach(function (r) {
      scaled[r] = cost[r] * k;
    });
    return { id: id, age: age, name: name, desc: desc, cost: scaled, time: time, mods: mods, civ: civ || null };
  }
  var TECHS = [
    T("doki", 0, C("縄文土器", "繩文土器"), C("煮炊きで食料＋15%", "烹煮使食物＋15%"), { food: 100, wood: 50 }, 20, { "gather.food": 0.15 }),
    T("sekifu", 0, C("磨製石斧", "磨製石斧"), C("木材＋15%", "木材＋15%"), { food: 100, wood: 60 }, 20, { "gather.wood": 0.15 }),
    T("kokuyoseki", 0, C("黒曜石の交易", "黑曜石交易"), C("石材＋20%", "石材＋20%"), { food: 120, wood: 80 }, 20, { "gather.stone": 0.2 }),
    T("yumiya", 0, C("弓矢の改良", "改良弓箭"), C("弓兵の攻撃＋20%", "弓兵攻擊＋20%"), { food: 150, wood: 100 }, 25, { "atk.archer": 0.2 }),
    T("kizuna", 0, C("ムラの絆", "村落羈絆"), C("自然増加＋50%", "自然增加＋50%"), { food: 200 }, 25, { birth: 0.5 }),
    T("kaizuka", 0, C("貝塚の知恵", "貝塚智慧"), C("集積所の容量＋25%", "集散地容量＋25%"), { food: 150, wood: 100 }, 25, { campCap: 0.25 }),

    T("inasaku", 1, C("稲作の改良", "改良稻作"), C("水田の採集＋20%", "水田採集＋20%"), { food: 400, wood: 300 }, 30, { paddy: 0.2 }),
    T("seidou", 1, C("青銅器", "青銅器"), C("全軍の攻撃＋15%", "全軍攻擊＋15%"), { food: 500, wood: 300, stone: 200 }, 35, { "atk.all": 0.15 }),
    T("tategine", 1, C("竪杵と臼", "豎杵與臼"), C("村人の生産＋20%", "村民生產＋20%"), { food: 500, wood: 200 }, 30, { tcSpeed: 0.2 }),
    T("kuwa", 1, C("木製の鍬", "木製鋤頭"), C("木材＋15%、食料＋10%", "木材＋15%、食物＋10%"), { food: 400, wood: 400 }, 30, { "gather.wood": 0.15, "gather.food": 0.1 }),

    T("tetsunougu", 2, C("鉄製農具", "鐵製農具"), C("食料＋20%", "食物＋20%"), { food: 1200, wood: 600, gold: 200 }, 40, { "gather.food": 0.2 }),
    T("katchu", 2, C("短甲", "短甲"), C("全軍の HP＋20%", "全軍 HP＋20%"), { food: 1000, stone: 300, gold: 300 }, 40, { "hp.all": 0.2 }),
    T("uma", 2, C("馬の飼育", "養馬"), C("騎兵の攻撃・HP＋20%", "騎兵攻擊與 HP＋20%"), { food: 1200, gold: 300 }, 40, { "atk.cavalry": 0.2, "hp.cavalry": 0.2 }),
    T("kinzan", 2, C("砂金採り", "淘金"), C("金＋25%", "金＋25%"), { food: 800, wood: 800 }, 40, { "gather.gold": 0.25 }),
    T("dobokugijutsu", 2, C("土木技術", "土木技術"), C("集積所・水田の容量＋25%", "集散地與水田容量＋25%"), { wood: 1200, stone: 500 }, 40, { campCap: 0.25, paddyCap: 0.25 }),

    T("bukkyo", 3, C("仏教伝来", "佛教傳來"), C("自然増加＋60%", "自然增加＋60%"), { food: 3000, gold: 1000 }, 50, { birth: 0.6 }),
    T("kawara", 3, C("瓦葺き", "瓦葺"), C("住居＋20%", "住居＋20%"), { wood: 2500, stone: 1500 }, 50, { housing: 0.2 }),
    T("heitan", 3, C("兵站", "兵站"), C("遠征の行軍−20%、訓練速度＋20%", "遠征行軍−20%、訓練速度＋20%"), { food: 3000, wood: 1500 }, 50, { travel: -0.2, trainSpeed: 0.2 }),
    T("ritsuryo", 3, C("律令", "律令"), C("全資源＋10%", "所有資源＋10%"), { food: 3000, wood: 2000, gold: 1000 }, 55, { "gather.all": 0.1 }),

    T("konden", 4, C("墾田永年私財法", "墾田永年私財法"), C("食料＋25%、水田の収容＋30%", "食物＋25%、水田容量＋30%"), { food: 8000, wood: 4000, gold: 1500 }, 60, { "gather.food": 0.25, paddyCap: 0.3 }),
    T("chusen", 4, C("鋳銭", "鑄錢"), C("金＋30%、石材＋20%", "金＋30%、石材＋20%"), { food: 6000, stone: 3000, gold: 1000 }, 60, { "gather.gold": 0.3, "gather.stone": 0.2 }),
    T("sakimori", 4, C("防人の制", "防人制度"), C("防御＋30%、槍兵の HP＋25%", "防禦＋30%、槍兵 HP＋25%"), { food: 6000, wood: 3000, gold: 1500 }, 60, { defense: 0.3, "hp.spear": 0.25 }),
    T("ekisei", 4, C("駅制", "驛制"), C("遠征の行軍−15%、集積所の容量＋20%", "遠征行軍−15%、集散地容量＋20%"), { food: 5000, wood: 5000 }, 60, { travel: -0.15, campCap: 0.2 }),

    T("shoen", 5, C("荘園", "莊園"), C("全資源＋15%", "所有資源＋15%"), { food: 20000, wood: 10000, gold: 5000 }, 70, { "gather.all": 0.15 }),
    T("bugei", 5, C("武芸", "武藝"), C("全軍の攻撃＋20%", "全軍攻擊＋20%"), { food: 15000, gold: 8000 }, 70, { "atk.all": 0.2 }),
    T("ooyoroi", 5, C("大鎧", "大鎧"), C("全軍の HP＋20%、騎兵の HP＋20%", "全軍 HP＋20%、騎兵 HP＋20%"), { food: 15000, stone: 5000, gold: 8000 }, 70, { "hp.all": 0.2, "hp.cavalry": 0.2 }),
    T("shinden", 5, C("寝殿造", "寢殿造"), C("住居＋20%", "住居＋20%"), { wood: 20000, stone: 8000 }, 70, { housing: 0.2 }),

    T("nimousaku", 6, C("二毛作", "二期作"), C("食料＋25%、水田の採集＋25%", "食物＋25%、水田採集＋25%"), { food: 40000, wood: 20000, gold: 10000 }, 80, { "gather.food": 0.25, paddy: 0.25 }),
    T("kibamusha", 6, C("騎馬武者の鍛錬", "騎馬武者鍛鍊"), C("騎兵の攻撃・HP＋25%", "騎兵攻擊與 HP＋25%"), { food: 40000, gold: 20000 }, 80, { "atk.cavalry": 0.25, "hp.cavalry": 0.25 }),
    T("za", 6, C("座と市", "座與市"), C("金＋25%、木材＋15%", "金＋25%、木材＋15%"), { food: 30000, wood: 30000 }, 80, { "gather.gold": 0.25, "gather.wood": 0.15 }),
    T("kamikaze", 6, C("神風の祈り", "神風祈禱"), C("防御＋40%", "防禦＋40%"), { food: 30000, gold: 15000 }, 80, { defense: 0.4 }),

    T("teppo", 7, C("鉄砲伝来", "鐵砲傳來"), C("弓兵（鉄砲）の攻撃＋40%", "弓兵（鐵砲）攻擊＋40%"), { food: 60000, wood: 30000, gold: 40000 }, 90, { "atk.archer": 0.4 }),
    T("kenchi", 7, C("検地", "檢地"), C("全資源＋15%", "所有資源＋15%"), { food: 80000, wood: 40000, gold: 20000 }, 90, { "gather.all": 0.15 }),
    T("chikujo", 7, C("築城術", "築城術"), C("防御＋50%、攻城兵器の攻撃＋30%", "防禦＋50%、攻城兵器攻擊＋30%"), { wood: 50000, stone: 80000 }, 90, { defense: 0.5, "atk.siege": 0.3 }),
    T("yarifusuma", 7, C("槍衾", "槍衾"), C("槍兵の攻撃・HP＋30%", "槍兵攻擊與 HP＋30%"), { food: 60000, wood: 40000 }, 90, { "atk.spear": 0.3, "hp.spear": 0.3 }),

    T("shinden_kaihatsu", 8, C("新田開発", "新田開發"), C("食料＋30%", "食物＋30%"), { food: 200000, wood: 100000 }, 100, { "gather.food": 0.3 }),
    T("sankin", 8, C("参勤交代", "參勤交代"), C("遠征の行軍−20%、全資源＋10%", "遠征行軍−20%、所有資源＋10%"), { food: 200000, gold: 100000 }, 100, { travel: -0.2, "gather.all": 0.1 }),

    // 文明專屬研究
    T("yamato_shisei", 3, C("氏姓制度", "氏姓制度"), C("村人の生産＋30%", "村民生產＋30%"), { food: 3000, gold: 800 }, 45, { tcSpeed: 0.3 }, "yamato"),
    T("yamato_kaishin", 5, C("大化の改新", "大化革新"), C("全資源＋15%、住居＋10%", "所有資源＋15%、住居＋10%"), { food: 15000, wood: 8000, gold: 5000 }, 70, { "gather.all": 0.15, housing: 0.1 }, "yamato"),
    T("torai_chuzo", 3, C("鋳造技術", "鑄造技術"), C("全軍の攻撃＋15%", "全軍攻擊＋15%"), { food: 2000, stone: 1500, gold: 800 }, 45, { "atk.all": 0.15 }, "torai"),
    T("torai_kanseki", 5, C("漢籍", "漢籍"), C("研究費用−15%、全資源＋10%", "研究費用−15%、所有資源＋10%"), { food: 12000, gold: 6000 }, 70, { techCost: -0.15, "gather.all": 0.1 }, "torai"),
    T("emishi_kita", 3, C("北の名馬", "北方名馬"), C("騎兵の HP＋25%、行軍−10%", "騎兵 HP＋25%、行軍−10%"), { food: 3000, gold: 1000 }, 45, { "hp.cavalry": 0.25, travel: -0.1 }, "emishi"),
    T("emishi_kari", 5, C("狩猟の民", "狩獵之民"), C("食料＋25%", "食物＋25%"), { food: 10000, wood: 8000 }, 70, { "gather.food": 0.25 }, "emishi"),
    T("ryukyu_shinryo", 3, C("万国津梁", "萬國津梁"), C("交易収入 2 倍", "貿易收入 ×2"), { food: 2500, wood: 2500 }, 45, { tradeIncome: 1 }, "ryukyu"),
    T("ryukyu_ti", 5, C("手の鍛錬", "手之鍛鍊"), C("剣兵の攻撃＋30%", "劍兵攻擊＋30%"), { food: 12000, gold: 5000 }, 70, { "atk.infantry": 0.3 }, "ryukyu"),
    T("hayato_tate", 3, C("隼人の盾", "隼人之盾"), C("全軍の HP＋15%", "全軍 HP＋15%"), { food: 2500, wood: 2000, gold: 800 }, 45, { "hp.all": 0.15 }, "hayato"),
    T("hayato_yamajiro", 5, C("南九州の山城", "南九州山城"), C("防御＋60%", "防禦＋60%"), { wood: 12000, stone: 10000 }, 70, { defense: 0.6 }, "hayato"),
  ];

  // ---------------- NPC 討伐目標 ----------------
  // army：等級 0 的基準兵力（兵種→數量）；每被討伐一次等級 +1，兵力 ×1.5、戰利品 ×1.4，冷卻後再出現
  // tier：敵兵的時代強度（同玩家兵種的時代倍率）；fort：城塞防禦（攻擊方傷害 ÷(1+fort)，攻城兵器可抵銷）
  // reward：等級 0 的戰利品；captives：擊倒的敵兵中有幾成成為俘虜加入村子（人口）
  // 實際兵力 × TARGET_ARMY_SCALE；戰利品 × REWARD_AGE[時代]（約等於該時代 1〜2 分鐘的食物收入）
  var TARGET_ARMY_SCALE = 0.7;
  var REWARD_AGE = [3, 8, 20, 30, 40, 50, 60, 70, 60];
  function N(id, age, icon, name, desc, dist, tier, army, fort, reward, captives, cooldown, statMul) {
    var a = {};
    Object.keys(army).forEach(function (c) {
      a[c] = Math.max(1, Math.round(army[c] * TARGET_ARMY_SCALE));
    });
    var rw = {};
    Object.keys(reward).forEach(function (r) {
      rw[r] = reward[r] * REWARD_AGE[age];
    });
    return { id: id, age: age, icon: icon, name: name, desc: desc, dist: dist, tier: tier, army: a, fort: fort, reward: rw, captives: captives, cooldown: cooldown, statMul: statMul || 1 };
  }
  var TARGETS = [
    N("boar", 0, "🐗", C("猪の群れ", "野豬群"), C("森の猪。肉がたっぷり", "森林裡的野豬，肉很多"), 25, 0, { beast: 6 }, 0, { food: 350 }, 0, 60),
    N("bear", 0, "🐻", C("ヒグマの縄張り", "棕熊地盤"), C("一頭でも手強い", "就算只有一頭也很難纏"), 40, 0, { beast: 3 }, 0, { food: 600, stone: 100 }, 0, 120, 3.5),
    N("mura", 0, "🛖", C("隣のムラ", "鄰村"), C("同じ縄文のムラ。勝てば人々が加わる", "同樣是繩文的村落；打贏的話村民會加入"), 50, 0, { spear: 10, archer: 6 }, 0, { food: 300, wood: 300, stone: 150 }, 0.5, 120),
    N("kangou", 1, "🏘️", C("対岸の環濠集落", "對岸的環濠聚落"), C("濠と柵に守られたムラ", "有壕溝與木柵保護的村落"), 70, 1, { spear: 30, infantry: 20, archer: 25 }, 0.3, { food: 1200, wood: 800, stone: 400 }, 0.5, 150),
    N("kaizoku1", 1, "🚣", C("海の向こうの漂着者", "海那邊的漂流者"), C("舟で現れた武装集団", "乘船出現的武裝集團"), 60, 1, { infantry: 35, archer: 30 }, 0, { food: 800, wood: 1200, stone: 300 }, 0.3, 150),
    N("gozoku", 2, "🏯", C("地方豪族の居館", "地方豪族居館"), C("鉄の武器を持つ豪族", "持有鐵製武器的豪族"), 90, 2, { spear: 70, infantry: 60, archer: 50, cavalry: 20 }, 0.4, { food: 3000, wood: 2000, stone: 1000, gold: 500 }, 0.4, 180),
    N("tsuchigumo", 2, "🕷️", C("山の土蜘蛛", "山中的土蜘蛛"), C("朝廷に従わない山の民", "不服朝廷的山民"), 80, 2, { spear: 50, archer: 90 }, 0.2, { food: 2000, wood: 3000, stone: 1500, gold: 300 }, 0.4, 180),
    N("emishi_toride", 3, "🏕️", C("北の砦", "北方要塞"), C("騎兵の多い北方の砦", "騎兵眾多的北方要塞"), 120, 3, { cavalry: 150, archer: 150, spear: 80 }, 0.5, { food: 8000, wood: 5000, stone: 3000, gold: 2000 }, 0.35, 200),
    N("kaizoku2", 3, "🏴‍☠️", C("瀬戸内の海賊", "瀨戶內海盜"), C("船を操る海の荒くれ者", "駕船的海上暴徒"), 100, 3, { infantry: 200, archer: 180 }, 0.2, { food: 6000, wood: 8000, gold: 3000 }, 0.3, 200),
    N("hanran", 4, "🔥", C("国司への反乱軍", "反抗國司的叛軍"), C("重税に怒った大軍", "因重稅而憤怒的大軍"), 130, 4, { spear: 500, infantry: 400, archer: 300, cavalry: 150 }, 0.3, { food: 20000, wood: 12000, stone: 6000, gold: 5000 }, 0.4, 240),
    N("bando", 5, "🏹", C("坂東の兵", "坂東之兵"), C("東国の荒武者たち", "東國的猛武者們"), 150, 5, { cavalry: 900, archer: 900, infantry: 600 }, 0.4, { food: 50000, wood: 25000, stone: 12000, gold: 15000 }, 0.35, 260),
    N("suigun", 5, "⛵", C("西海の水軍", "西海水軍"), C("海を支配する水軍", "支配海洋的水軍"), 140, 5, { archer: 1200, infantry: 1000, spear: 400 }, 0.3, { food: 40000, wood: 40000, gold: 18000 }, 0.3, 260),
    N("mongol", 6, "🐉", C("元の大船団", "元朝大船團"), C("海を渡ってきた大軍。勝てば莫大な戦利品", "渡海而來的大軍；打贏可得巨額戰利品"), 180, 6, { infantry: 3000, archer: 3500, cavalry: 1500, siege: 300 }, 0.2, { food: 150000, wood: 80000, stone: 40000, gold: 60000 }, 0.25, 360),
    N("akuto", 6, "🗡️", C("悪党の城", "惡黨之城"), C("山城にこもる悪党", "固守山城的惡黨"), 150, 6, { spear: 2000, infantry: 2500, archer: 1500 }, 0.7, { food: 90000, wood: 50000, stone: 40000, gold: 30000 }, 0.35, 300),
    N("daimyo_e", 7, "🏯", C("東国の大名", "東國大名"), C("騎馬軍団で名高い", "以騎馬軍團聞名"), 200, 7, { cavalry: 7000, spear: 4000, archer: 4000 }, 0.6, { food: 300000, wood: 150000, stone: 80000, gold: 100000 }, 0.35, 400),
    N("daimyo_w", 7, "🏯", C("西国の大名", "西國大名"), C("鉄砲を揃えた大軍", "備齊鐵砲的大軍"), 210, 7, { archer: 8000, spear: 6000, infantry: 3000, siege: 500 }, 0.7, { food: 320000, wood: 160000, stone: 100000, gold: 120000 }, 0.35, 400),
    N("ikki", 7, "🙏", C("一向一揆", "一向一揆"), C("寺にこもる門徒の大軍", "據守寺院的門徒大軍"), 180, 7, { spear: 9000, infantry: 6000, archer: 3000 }, 0.8, { food: 280000, wood: 120000, stone: 80000, gold: 60000 }, 0.45, 400),
    N("kurofune", 8, "⚓", C("黒船", "黑船"), C("海の彼方からの黒い蒸気船", "來自遠洋的黑色蒸汽船"), 240, 8, { archer: 15000, infantry: 10000, siege: 3000 }, 0.5, { food: 900000, wood: 500000, stone: 300000, gold: 400000 }, 0.2, 600),
  ];

  // 來襲的敵人名稱（依時代）
  var RAIDERS = [
    C("山の民の略奪隊", "山民掠奪隊"),
    C("他のムラの襲撃者", "他村的襲擊者"),
    C("豪族の兵", "豪族之兵"),
    C("海賊の上陸部隊", "海盜登陸部隊"),
    C("反乱軍", "叛軍"),
    C("盗賊団", "盜賊團"),
    C("悪党の一団", "惡黨集團"),
    C("敵国の侵攻軍", "敵國侵攻軍"),
    C("浪人の一揆", "浪人一揆"),
  ];

  function ageIndex(id) {
    for (var i = 0; i < AGES.length; i++) if (AGES[i].id === id) return i;
    return -1;
  }
  function building(id) {
    for (var i = 0; i < BUILDINGS.length; i++) if (BUILDINGS[i].id === id) return BUILDINGS[i];
    return null;
  }
  function tech(id) {
    for (var i = 0; i < TECHS.length; i++) if (TECHS[i].id === id) return TECHS[i];
    return null;
  }
  function civ(id) {
    for (var i = 0; i < CIVS.length; i++) if (CIVS[i].id === id) return CIVS[i];
    return null;
  }
  function target(id) {
    for (var i = 0; i < TARGETS.length; i++) if (TARGETS[i].id === id) return TARGETS[i];
    return null;
  }
  function landmark(id) {
    var keys = Object.keys(LANDMARKS);
    for (var k = 0; k < keys.length; k++) {
      var list = LANDMARKS[keys[k]];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    }
    return null;
  }

  window.PriTestJomonData = {
    RESOURCES: RESOURCES,
    RESOURCE_ICONS: RESOURCE_ICONS,
    RESOURCE_VALUE: RESOURCE_VALUE,
    GOLD_AGE: GOLD_AGE,
    AGES: AGES,
    CIV_AGE: CIV_AGE,
    BUILDINGS: BUILDINGS,
    WALL_LEVELS: WALL_LEVELS,
    UNIT_CLASSES: UNIT_CLASSES,
    UNITS: UNITS,
    SPECIAL_UNITS: SPECIAL_UNITS,
    COUNTERS: COUNTERS,
    CIVS: CIVS,
    LANDMARKS: LANDMARKS,
    TECHS: TECHS,
    TARGETS: TARGETS,
    RAIDERS: RAIDERS,
    localizedText: localizedText,
    ageIndex: ageIndex,
    building: building,
    tech: tech,
    civ: civ,
    target: target,
    landmark: landmark,
  };
})();
