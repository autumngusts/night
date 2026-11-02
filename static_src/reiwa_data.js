// 令和之野望（reiwa）：靜態資料 —— 東北地方 30 座城池、8 個勢力、16 位武將、8 種兵種的循環相剋表。
// 這是全新的獨立小遊戲，與 night/midnight 的 TRPG 規則無關；武將為「真實大名姓氏＋原創數值」的混合設定，
// 地圖座標為示意用的簡化佈局，不是精確地理位置。
(function () {
  "use strict";

  function C(ja, zh) {
    return { ja: ja, zh: zh };
  }

  // 8 種兵種，依「克制下一個、被上一個克制」排成一個環：
  // 弓兵→水軍→忍兵→具足兵→槍兵→騎馬兵→薙刀兵→鐵砲兵→（回到弓兵）
  var TROOP_ORDER = [
    "archer",
    "navy",
    "ninja",
    "ashigaru",
    "spear",
    "cavalry",
    "naginata",
    "gun",
  ];

  var TROOP_TYPES = {
    archer: {
      id: "archer",
      icon: "🏹",
      name: C("弓兵", "弓兵"),
      beats: "navy",
      note: C(
        "岸辺から水軍の上陸を射すくめる",
        "岸防弓矢壓制水軍登陸"
      ),
    },
    navy: {
      id: "navy",
      icon: "⚓",
      name: C("水軍", "水軍"),
      beats: "ninja",
      note: C(
        "沿岸を巡回し忍兵の潜入路を断つ",
        "沿岸巡邏切斷忍兵的潛入路線"
      ),
    },
    ninja: {
      id: "ninja",
      icon: "🥷",
      name: C("忍兵", "忍兵"),
      beats: "ashigaru",
      note: C(
        "夜襲で具足兵の陣列を乱す",
        "夜襲擾亂具足兵的陣列"
      ),
    },
    ashigaru: {
      id: "ashigaru",
      icon: "🛡️",
      name: C("具足兵", "具足兵"),
      beats: "spear",
      note: C(
        "重い甲冑で突きに耐え槍兵へ肉薄する",
        "重甲硬抗突刺、逼近槍兵肉搏"
      ),
    },
    spear: {
      id: "spear",
      icon: "🔱",
      name: C("槍兵", "槍兵"),
      beats: "cavalry",
      note: C(
        "長柄の陣で騎馬の突進を止める",
        "長柄陣型遏止騎馬衝鋒"
      ),
    },
    cavalry: {
      id: "cavalry",
      icon: "🏇",
      name: C("騎馬兵", "騎馬兵"),
      beats: "naginata",
      note: C(
        "機動力で薙刀兵の側面に回り込む",
        "機動迂迴，繞至薙刀兵轉身不及的側面"
      ),
    },
    naginata: {
      id: "naginata",
      icon: "⚔️",
      name: C("薙刀兵", "薙刀兵"),
      beats: "gun",
      note: C(
        "接近戦で装填の隙を突いて鉄砲兵を斬る",
        "近身戰砍殺來不及裝填的鐵砲兵"
      ),
    },
    gun: {
      id: "gun",
      icon: "🔥",
      name: C("鐵砲兵", "鐵砲兵"),
      beats: "archer",
      note: C(
        "射程と威力で弓兵を圧倒する",
        "射程與火力壓制弓兵"
      ),
    },
  };

  // 8 個勢力（真實大名姓氏，數值與武將為原創設定）
  // temperament：AI 的性格傾向（reiwa_core.js 的 TEMPERAMENT_PROFILES 依此決定攻擊門檻／出兵比例／外交積極度等）
  //   aggressive（好戰）／balanced（穩健）／cautious（保守，優先自保）／diplomatic（長於外交，傾向結盟）
  var FACTIONS = {
    tsugaru: {
      id: "tsugaru",
      name: C("津軽氏", "津輕氏"),
      color: "#4f8fd1",
      capital: "ao_hirosaki",
      generals: ["tsugaru_tamenobu", "tsugaru_nobutake"],
      temperament: "cautious",
    },
    nanbu: {
      id: "nanbu",
      name: C("南部氏", "南部氏"),
      color: "#3f9b5c",
      capital: "iw_morioka",
      generals: ["nanbu_harumasa", "nanbu_nobunao"],
      temperament: "balanced",
    },
    akita: {
      id: "akita",
      name: C("秋田氏（安東氏）", "秋田氏（安東氏）"),
      color: "#c9a227",
      capital: "ak_akita",
      generals: ["akita_chikasue", "akita_sanesue"],
      temperament: "diplomatic",
    },
    mogami: {
      id: "mogami",
      name: C("最上氏", "最上氏"),
      color: "#b25fb0",
      capital: "ya_yamagata",
      generals: ["mogami_yoshiaki", "mogami_moritou"],
      temperament: "aggressive",
    },
    date: {
      id: "date",
      name: C("伊達氏", "伊達氏"),
      color: "#d1483f",
      capital: "mi_sendai",
      generals: ["date_masamune", "date_katakura"],
      temperament: "aggressive",
    },
    kasai: {
      id: "kasai",
      name: C("葛西氏", "葛西氏"),
      color: "#7a6a53",
      capital: "mi_ishinomaki",
      generals: ["kasai_harunobu"],
      temperament: "cautious",
    },
    ashina: {
      id: "ashina",
      name: C("蘆名氏", "蘆名氏"),
      color: "#4fb3a9",
      capital: "fu_aizu",
      generals: ["ashina_moriuji", "ashina_moritaka"],
      temperament: "balanced",
    },
    soma: {
      id: "soma",
      name: C("相馬氏", "相馬氏"),
      color: "#8a6fd1",
      capital: "fu_soma",
      generals: ["soma_moritane"],
      temperament: "cautious",
    },
  };

  var FACTION_ORDER = [
    "tsugaru",
    "nanbu",
    "akita",
    "mogami",
    "date",
    "kasai",
    "ashina",
    "soma",
  ];

  // 武將：leadership（統率，影響可帶兵量與防禦）／valor（武勇，影響正面交戰威力）
  // ／strategy（知略，影響伐掠奇襲與外交成功率）／politics（政治，影響內政效率）
  // aptitude：武將親自出征時，該兵種所在格 +25% 有效戰力
  var GENERALS = {
    tsugaru_tamenobu: {
      id: "tsugaru_tamenobu",
      faction: "tsugaru",
      name: C("津軽為信", "津輕為信"),
      stats: { leadership: 7, valor: 6, strategy: 8, politics: 6 },
      aptitude: "ninja",
    },
    tsugaru_nobutake: {
      id: "tsugaru_nobutake",
      faction: "tsugaru",
      name: C("津軽信建", "津輕信建"),
      stats: { leadership: 5, valor: 5, strategy: 6, politics: 7 },
      aptitude: "archer",
    },
    nanbu_harumasa: {
      id: "nanbu_harumasa",
      faction: "nanbu",
      name: C("南部晴政", "南部晴政"),
      stats: { leadership: 7, valor: 6, strategy: 5, politics: 6 },
      aptitude: "cavalry",
    },
    nanbu_nobunao: {
      id: "nanbu_nobunao",
      faction: "nanbu",
      name: C("南部信直", "南部信直"),
      stats: { leadership: 6, valor: 6, strategy: 7, politics: 6 },
      aptitude: "spear",
    },
    akita_chikasue: {
      id: "akita_chikasue",
      faction: "akita",
      name: C("秋田愛季", "秋田愛季"),
      stats: { leadership: 8, valor: 6, strategy: 7, politics: 7 },
      aptitude: "navy",
    },
    akita_sanesue: {
      id: "akita_sanesue",
      faction: "akita",
      name: C("秋田実季", "秋田實季"),
      stats: { leadership: 5, valor: 5, strategy: 6, politics: 7 },
      aptitude: "ashigaru",
    },
    mogami_yoshiaki: {
      id: "mogami_yoshiaki",
      faction: "mogami",
      name: C("最上義光", "最上義光"),
      stats: { leadership: 8, valor: 8, strategy: 7, politics: 6 },
      aptitude: "gun",
    },
    mogami_moritou: {
      id: "mogami_moritou",
      faction: "mogami",
      name: C("氏家守棟", "氏家守棟"),
      stats: { leadership: 6, valor: 5, strategy: 6, politics: 8 },
      aptitude: "naginata",
    },
    date_masamune: {
      id: "date_masamune",
      faction: "date",
      name: C("伊達政宗", "伊達政宗"),
      stats: { leadership: 9, valor: 8, strategy: 8, politics: 7 },
      aptitude: "gun",
    },
    date_katakura: {
      id: "date_katakura",
      faction: "date",
      name: C("片倉景綱", "片倉景綱"),
      stats: { leadership: 7, valor: 6, strategy: 8, politics: 7 },
      aptitude: "spear",
    },
    kasai_harunobu: {
      id: "kasai_harunobu",
      faction: "kasai",
      name: C("葛西晴信", "葛西晴信"),
      stats: { leadership: 5, valor: 5, strategy: 5, politics: 6 },
      aptitude: "navy",
    },
    ashina_moriuji: {
      id: "ashina_moriuji",
      faction: "ashina",
      name: C("蘆名盛氏", "蘆名盛氏"),
      stats: { leadership: 8, valor: 7, strategy: 6, politics: 7 },
      aptitude: "ashigaru",
    },
    ashina_moritaka: {
      id: "ashina_moritaka",
      faction: "ashina",
      name: C("蘆名盛隆", "蘆名盛隆"),
      stats: { leadership: 5, valor: 5, strategy: 5, politics: 6 },
      aptitude: "naginata",
    },
    soma_moritane: {
      id: "soma_moritane",
      faction: "soma",
      name: C("相馬盛胤", "相馬盛胤"),
      stats: { leadership: 6, valor: 7, strategy: 6, politics: 5 },
      aptitude: "cavalry",
    },
  };

  // profile 影響初始兵力構成的比例權重（依 TROOP_ORDER 順序）；在 reiwa_core.js 依 kokudaka 換算成實際人數
  var PROFILE_WEIGHTS = {
    capital: [1, 1, 1, 1, 1, 1, 1, 1],
    coastal: [1.5, 3, 1, 1, 0.5, 0.5, 0.5, 1],
    mountain: [1, 0.3, 2.5, 1, 0.5, 0.3, 1.5, 1],
    plain: [0.8, 0.3, 0.5, 1.2, 1.5, 2, 1, 1.5],
  };

  var KOKUDAKA_BY_PROFILE = {
    capital: 90,
    coastal: 55,
    mountain: 45,
    plain: 60,
  };

  // 30 座城池：id／顯示名稱／所屬令制國（示意分區）／座標（示意佈局，非精確地理）／初始勢力／profile
  var NODES = [
    { id: "ao_hirosaki", name: C("弘前", "弘前"), region: "aomori", x: 150, y: 30, faction: "tsugaru", profile: "capital" },
    { id: "ao_aomori", name: C("青森", "青森"), region: "aomori", x: 190, y: 15, faction: "tsugaru", profile: "coastal" },
    { id: "ao_hachinohe", name: C("八戸", "八戶"), region: "aomori", x: 250, y: 55, faction: "nanbu", profile: "coastal" },

    { id: "iw_morioka", name: C("盛岡", "盛岡"), region: "iwate", x: 230, y: 150, faction: "nanbu", profile: "capital" },
    { id: "iw_ichinohe", name: C("一戸", "一戶"), region: "iwate", x: 260, y: 110, faction: "nanbu", profile: "mountain" },
    { id: "iw_kuji", name: C("久慈", "久慈"), region: "iwate", x: 280, y: 140, faction: "nanbu", profile: "mountain" },
    { id: "iw_hanamaki", name: C("花巻", "花卷"), region: "iwate", x: 220, y: 195, faction: "nanbu", profile: "plain" },
    { id: "iw_mizusawa", name: C("水沢", "水澤"), region: "iwate", x: 210, y: 235, faction: "nanbu", profile: "plain" },

    { id: "ak_akita", name: C("久保田（秋田）", "久保田（秋田）"), region: "akita", x: 110, y: 140, faction: "akita", profile: "capital" },
    { id: "ak_odate", name: C("大館", "大館"), region: "akita", x: 140, y: 80, faction: "akita", profile: "mountain" },
    { id: "ak_kakunodate", name: C("角館", "角館"), region: "akita", x: 150, y: 150, faction: "akita", profile: "mountain" },
    { id: "ak_yokote", name: C("横手", "橫手"), region: "akita", x: 130, y: 200, faction: "akita", profile: "plain" },
    { id: "ak_yurihonjo", name: C("由利本荘", "由利本莊"), region: "akita", x: 80, y: 190, faction: "akita", profile: "coastal" },

    { id: "ya_yamagata", name: C("山形", "山形"), region: "yamagata", x: 140, y: 300, faction: "mogami", profile: "capital" },
    { id: "ya_shinjo", name: C("新庄", "新莊"), region: "yamagata", x: 110, y: 245, faction: "mogami", profile: "mountain" },
    { id: "ya_tendo", name: C("天童", "天童"), region: "yamagata", x: 160, y: 280, faction: "mogami", profile: "plain" },
    { id: "ya_yonezawa", name: C("米沢", "米澤"), region: "yamagata", x: 150, y: 350, faction: "mogami", profile: "plain" },
    { id: "ya_tsuruoka", name: C("鶴岡（庄内）", "鶴岡（庄內）"), region: "yamagata", x: 70, y: 250, faction: "mogami", profile: "coastal" },

    { id: "mi_sendai", name: C("仙台", "仙台"), region: "miyagi", x: 220, y: 290, faction: "date", profile: "capital" },
    { id: "mi_natori", name: C("名取", "名取"), region: "miyagi", x: 210, y: 320, faction: "date", profile: "plain" },
    { id: "mi_shiroishi", name: C("白石", "白石"), region: "miyagi", x: 200, y: 350, faction: "date", profile: "plain" },
    { id: "mi_ishinomaki", name: C("石巻", "石卷"), region: "miyagi", x: 260, y: 270, faction: "kasai", profile: "capital" },
    { id: "mi_kesennuma", name: C("気仙沼", "氣仙沼"), region: "miyagi", x: 280, y: 235, faction: "kasai", profile: "coastal" },

    { id: "fu_aizu", name: C("会津若松", "會津若松"), region: "fukushima", x: 160, y: 390, faction: "ashina", profile: "capital" },
    { id: "fu_koriyama", name: C("郡山", "郡山"), region: "fukushima", x: 210, y: 400, faction: "ashina", profile: "plain" },
    { id: "fu_shirakawa", name: C("白河", "白河"), region: "fukushima", x: 200, y: 440, faction: "ashina", profile: "mountain" },
    { id: "fu_fukushima", name: C("福島", "福島"), region: "fukushima", x: 220, y: 370, faction: "date", profile: "plain" },
    { id: "fu_nihonmatsu", name: C("二本松", "二本松"), region: "fukushima", x: 195, y: 375, faction: "date", profile: "plain" },
    { id: "fu_soma", name: C("相馬", "相馬"), region: "fukushima", x: 260, y: 360, faction: "soma", profile: "capital" },
    { id: "fu_iwaki", name: C("いわき", "磐城"), region: "fukushima", x: 270, y: 410, faction: "soma", profile: "coastal" },
  ];

  // 鄰接關係（雙向），決定伐掠／移動可達範圍
  var EDGES = [
    ["ao_hirosaki", "ao_aomori"],
    ["ao_aomori", "ao_hachinohe"],
    ["ao_hirosaki", "ao_hachinohe"],
    ["ao_hirosaki", "ak_odate"],
    ["ao_hachinohe", "iw_ichinohe"],

    ["iw_morioka", "iw_ichinohe"],
    ["iw_morioka", "iw_kuji"],
    ["iw_morioka", "iw_hanamaki"],
    ["iw_ichinohe", "iw_kuji"],
    ["iw_hanamaki", "iw_mizusawa"],
    ["iw_morioka", "ak_kakunodate"],
    ["iw_ichinohe", "ak_odate"],
    ["iw_mizusawa", "mi_kesennuma"],

    ["ak_akita", "ak_odate"],
    ["ak_akita", "ak_kakunodate"],
    ["ak_akita", "ak_yokote"],
    ["ak_akita", "ak_yurihonjo"],
    ["ak_kakunodate", "ak_yokote"],
    ["ak_yokote", "ak_yurihonjo"],
    ["ak_yurihonjo", "ya_tsuruoka"],
    ["ak_yokote", "ya_shinjo"],

    ["ya_yamagata", "ya_shinjo"],
    ["ya_yamagata", "ya_tendo"],
    ["ya_yamagata", "ya_yonezawa"],
    ["ya_yamagata", "ya_tsuruoka"],
    ["ya_tendo", "ya_yonezawa"],
    ["ya_shinjo", "ya_tsuruoka"],
    ["ya_tendo", "mi_sendai"],
    ["ya_yonezawa", "fu_aizu"],

    ["mi_sendai", "mi_natori"],
    ["mi_sendai", "mi_shiroishi"],
    ["mi_sendai", "mi_ishinomaki"],
    ["mi_natori", "mi_shiroishi"],
    ["mi_ishinomaki", "mi_kesennuma"],
    ["mi_shiroishi", "fu_fukushima"],
    ["mi_natori", "fu_soma"],

    ["fu_aizu", "fu_koriyama"],
    ["fu_aizu", "fu_shirakawa"],
    ["fu_koriyama", "fu_shirakawa"],
    ["fu_koriyama", "fu_fukushima"],
    ["fu_koriyama", "fu_nihonmatsu"],
    ["fu_fukushima", "fu_nihonmatsu"],
    ["fu_soma", "fu_iwaki"],
    ["fu_soma", "fu_nihonmatsu"],
    ["fu_iwaki", "fu_koriyama"],
  ];

  function buildAdjacency() {
    var map = {};
    NODES.forEach(function (n) {
      map[n.id] = [];
    });
    EDGES.forEach(function (e) {
      map[e[0]].push(e[1]);
      map[e[1]].push(e[0]);
    });
    return map;
  }

  var ADJACENCY = buildAdjacency();

  function lang() {
    return window.I18N ? window.I18N.getLang() : "zh";
  }

  function localizedText(field) {
    if (!field) return "";
    if (typeof field === "string") return field;
    var l = lang();
    return field[l] || field.zh || field.ja || field.en || "";
  }

  function nodeById(id) {
    return NODES.filter(function (n) {
      return n.id === id;
    })[0] || null;
  }

  function neighborsOf(id) {
    return (ADJACENCY[id] || []).slice();
  }

  function factionById(id) {
    return FACTIONS[id] || null;
  }

  function generalById(id) {
    return GENERALS[id] || null;
  }

  function generalsOfFaction(factionId) {
    var f = FACTIONS[factionId];
    if (!f) return [];
    return f.generals.map(function (gid) {
      return GENERALS[gid];
    });
  }

  function troopType(id) {
    return TROOP_TYPES[id] || null;
  }

  // typeA 對 typeB 的相剋倍率（typeA 視角）：克制 1.5／被克制約 0.667／無關 1
  function matchupMultiplier(typeA, typeB) {
    if (typeA === typeB) return 1;
    var a = TROOP_TYPES[typeA];
    if (a && a.beats === typeB) return 1.5;
    var b = TROOP_TYPES[typeB];
    if (b && b.beats === typeA) return 1 / 1.5;
    return 1;
  }

  window.PriTestReiwaData = {
    TROOP_ORDER: TROOP_ORDER,
    TROOP_TYPES: TROOP_TYPES,
    FACTIONS: FACTIONS,
    FACTION_ORDER: FACTION_ORDER,
    GENERALS: GENERALS,
    NODES: NODES,
    EDGES: EDGES,
    PROFILE_WEIGHTS: PROFILE_WEIGHTS,
    KOKUDAKA_BY_PROFILE: KOKUDAKA_BY_PROFILE,
    localizedText: localizedText,
    nodeById: nodeById,
    neighborsOf: neighborsOf,
    factionById: factionById,
    generalById: generalById,
    generalsOfFaction: generalsOfFaction,
    troopType: troopType,
    matchupMultiplier: matchupMultiplier,
  };
})();
