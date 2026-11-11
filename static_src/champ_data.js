// 冠軍教練（champ）：靜態資料。12 個起始地區、7 個聯賽、5 個位置、100 位英雄、5 種戰術、羈絆組合、約會地點、個性、選手名。
// 規則在 champ_core.js；畫面在 champ.js；3D 重播在 champ_3d.js。這裡只放數值與雙語文字（C(zh, ja)）。2026-11-11 依使用者需求新增。
(function () {
  "use strict";

  function C(zh, ja) { return { zh: zh, ja: ja || zh }; }
  function L(o) {
    if (!o) return "";
    if (typeof o === "string") return o;
    var lang = window.I18N && window.I18N.getLang ? window.I18N.getLang() : "zh";
    return o[lang] || o.zh || o.ja || "";
  }

  // ---------------- 位置 ----------------
  var ROLES = ["top", "jg", "mid", "adc", "sup"];
  var ROLE = {
    top: { name: C("上路", "トップ"), icon: "🛡", w: { mech: 0.2, lane: 0.3, fight: 0.25, macro: 0.1, mental: 0.15 } },
    jg: { name: C("打野", "ジャングル"), icon: "🌲", w: { mech: 0.2, lane: 0.1, fight: 0.25, macro: 0.3, mental: 0.15 } },
    mid: { name: C("中路", "ミッド"), icon: "✦", w: { mech: 0.3, lane: 0.25, fight: 0.2, macro: 0.1, mental: 0.15 } },
    adc: { name: C("下路", "ボット"), icon: "🏹", w: { mech: 0.35, lane: 0.25, fight: 0.2, macro: 0.05, mental: 0.15 } },
    sup: { name: C("輔助", "サポート"), icon: "✚", w: { mech: 0.1, lane: 0.2, fight: 0.25, macro: 0.3, mental: 0.15 } }
  };
  var STATS = ["mech", "lane", "fight", "macro", "mental"];
  var STAT = {
    mech: C("操作", "操作"), lane: C("對線", "対面"), fight: C("團戰", "集団戦"), macro: C("運營", "マクロ"), mental: C("心態", "メンタル")
  };

  // ---------------- 起始地區 ----------------
  // diff：難度（low＝韓國・中國；mid＝台灣・北美・西歐；high＝其餘）。str：該地區聯賽的平均實力。
  // league：所屬聯賽（LEAGUES）。str：該國選手的平均實力（新人、引退補充用）。sponsor：每週贊助收入（K）。fund：起始資金（K）。
  // start：起始一軍相對聯賽平均的實力差；scout：新人素質相對聯賽平均。
  var REGIONS = [
    { id: "tw", abbr: "TW", name: C("台灣", "台湾"), lore: C("傳聞台灣隊伍曾在草創時期拿過一次世界冠軍——但紀錄早已散失，只剩老玩家口中的傳說。重新找回當年的榮景吧。", "台湾チームは創成期に一度世界王者になったという噂がある――記録は失われ、古参ファンの語り草だけが残る。あの栄光をもう一度。"), diff: "mid", str: 66, league: "tj", sponsor: 120, fund: 900, start: 1, scout: -2,
      cities: ["Taipei Morning Star", "Kaohsiung Harbor", "Taichung Skylark", "Tainan Phoenix", "Hsinchu Breeze", "Taoyuan Comet", "Keelung Rain", "Hualien Wave"],
      names: ["張家瑜", "黃詩涵", "吳宜蓁", "劉品妍", "蔡佳穎", "楊子晴", "許芷瑄", "鄭雅筑", "謝語彤", "洪若涵", "林沛綺", "陳昕妤"] },
    { id: "jp", abbr: "JP", name: C("日本", "日本"), lore: C("與台灣同屬台日聯賽。後起之秀，但熱情的粉絲與職人精神正在醞釀奇蹟。", "台湾と同じ台日リーグ。後発だが、熱いファンと職人気質が奇跡を育てている。"), diff: "high", str: 61, league: "tj", sponsor: 95, fund: 550, start: -1, scout: -3,
      cities: ["Tokyo Sakura", "Osaka Kitsune", "Nagoya Shachi", "Fukuoka Swallow", "Sapporo Snow", "Sendai Tanabata", "Kyoto Miko", "Kobe Pearl"],
      names: ["佐藤 美咲", "鈴木 陽菜", "高橋 結衣", "田中 さくら", "伊藤 葵", "渡辺 凛", "山本 芽依", "中村 ひなた", "小林 楓", "加藤 莉子", "吉田 澪", "松本 杏"] },
    { id: "kr", abbr: "KR", name: C("韓國", "韓国"), lore: C("一流選手多到滿出來的強權。王朝隊伍 Seoul Starlight 擁有當代超一流中路 Taker，拿下過最多冠軍。你從中段隊伍出發——拿下國際大獎，或許就會有機緣被王朝隊挖角。", "一流選手があふれる強豪地域。王朝 Seoul Starlight には当代最強のミッド Taker が在籍し、最多の優勝を誇る。あなたは中堅チームから――国際タイトルを取れば、王朝から声がかかるかもしれない。"), diff: "low", str: 76, league: "kr", sponsor: 190, fund: 1500, start: 3.5, scout: 3,
      cities: ["Seoul Starlight", "Busan Tide", "Incheon Aurora", "Daegu Phoenix", "Gwangju Lilies", "Daejeon Comet", "Suwon Valkyrie", "Ulsan Blossom"],
      names: ["金智妍", "朴秀彬", "李夏恩", "崔允瑞", "鄭佳仁", "姜睿琳", "尹書雅", "韓智友", "宋多恩", "林娜妍", "徐敏智", "吳采媛"] },
    { id: "cn", abbr: "CN", name: C("中國", "中国"), lore: C("冠軍爭奪的熱門賽區，許多隊伍都擁有一流選手，常與韓國殺得難分難解。", "優勝争いの常連地域。多くのチームが一流選手を抱え、韓国とはいつも互角の勝負。"), diff: "low", str: 75, league: "cn", sponsor: 185, fund: 1450, start: 4, scout: 3,
      cities: ["Shanghai Dragoness", "Beijing Moonlight", "Chengdu Bamboo", "Shenzhen Spark", "Hangzhou Lotus", "Wuhan Storm", "Xi'an Jade", "Chongqing Flame"],
      names: ["林語晴", "蘇沐瑤", "葉欣妍", "陳思彤", "王雨萱", "趙夢琪", "周婉清", "唐詩涵", "許靈汐", "何夢瑤", "沈清歡", "江晚吟"] },
    { id: "vn", abbr: "VN", name: C("越南", "ベトナム"), lore: C("亞洲區的熱血代表。只有一個世界賽名額，每一場都是決戰。", "アジア地域の熱き代表。世界大会枠は 1 つ、すべてが決戦。"), diff: "high", str: 63, league: "asia", sponsor: 90, fund: 520, start: -1, scout: -2,
      cities: ["Hanoi Lotus", "Saigon Comet", "Da Nang Wave", "Hue Lantern", "Hai Phong Storm", "Can Tho River", "Nha Trang Coral", "Da Lat Mist"],
      names: ["Nguyễn Thu Hà", "Trần Mai Anh", "Lê Ngọc Lan", "Phạm Thảo Vy", "Hoàng Minh Thư", "Vũ Bảo Ngọc", "Đặng Khánh Linh", "Bùi Gia Hân", "Đỗ Phương Uyên", "Hồ Thanh Trúc", "Ngô Tuyết Mai", "Dương Hải Yến"] },
    { id: "ru", abbr: "RU", name: C("俄羅斯", "ロシア"), lore: C("編入歐洲聯賽。嚴寒鍛鍊出的冷靜運營是武器。", "欧州リーグ所属。極寒が鍛えた冷静なマクロが武器。"), diff: "high", str: 60, league: "eu", sponsor: 90, fund: 520, start: -1, scout: -3,
      cities: ["Moscow Snowfall", "St. Petersburg Swan", "Kazan Firebird", "Novosibirsk Aurora", "Yekaterinburg Gem", "Sochi Sun", "Vladivostok Tide", "Samara Star"],
      names: ["Anastasia Volkova", "Daria Sokolova", "Ekaterina Morozova", "Polina Lebedeva", "Sofia Kozlova", "Alina Novikova", "Viktoria Orlova", "Ksenia Pavlova", "Maria Fedorova", "Yulia Smirnova", "Vera Belova", "Irina Zaitseva"] },
    { id: "mn", abbr: "MN", name: C("蒙古", "モンゴル"), lore: C("亞洲區的新興勢力。草原上長大的選手們有驚人的韌性。", "アジア地域の新興勢力。草原育ちの選手たちは驚くほどタフ。"), diff: "high", str: 55, league: "asia", sponsor: 75, fund: 450, start: 0, scout: -2,
      cities: ["Ulaanbaatar Steppe", "Darkhan Eagles", "Erdenet Wolves", "Khovd Horizon", "Gobi Wind", "Orkhon Spirit", "Altai Snow", "Kharkhorin Sky"],
      names: ["Anujin Batbayar", "Saran Gantulga", "Nomin Erdene", "Khulan Bold", "Oyun Tsetseg", "Enkhjin Bat", "Solongo Dorj", "Misheel Ganbold", "Uyanga Purev", "Tsolmon Altan", "Narantsetseg Bayar", "Ariunaa Sukh"] },
    { id: "naw", abbr: "NAW", name: C("北美西岸", "北米西海岸"), lore: C("北美選手饒富創意，總能拚出框架外的玩法——比賽中有機會打出意想不到的奇招。", "北米の選手は創造力豊かで、型破りなプレーを生み出す――試合中に予想外の奇策が飛び出すことも。"), diff: "mid", str: 66, league: "na", sponsor: 140, fund: 950, start: 1, scout: -1, creative: true,
      cities: ["LA Starlets", "SF Fog", "Seattle Rain", "Portland Roses", "San Diego Waves", "Vegas Neon", "Phoenix Sunbirds", "Sacramento Gold"],
      names: ["Emily Carter", "Chloe Nguyen", "Madison Park", "Ava Ramirez", "Olivia Chen", "Harper Lee", "Sophia Kim", "Riley Brooks", "Zoe Martinez", "Lily Tanaka", "Nora Hayes", "Mia Delgado"] },
    { id: "nae", abbr: "NAE", name: C("北美東岸", "北米東海岸"), lore: C("北美選手饒富創意，總能拚出框架外的玩法——比賽中有機會打出意想不到的奇招。", "北米の選手は創造力豊かで、型破りなプレーを生み出す――試合中に予想外の奇策が飛び出すことも。"), diff: "mid", str: 66, league: "na", sponsor: 135, fund: 920, start: 1, scout: -1, creative: true,
      cities: ["New York Skyline", "Boston Clovers", "Miami Flamingos", "Atlanta Peach", "Toronto Maple", "Philadelphia Bell", "DC Monarchs", "Montreal Lune"],
      names: ["Abigail Walsh", "Emma Rossi", "Grace O'Brien", "Hannah Cohen", "Natalie Brooks", "Samantha Hill", "Brianna Scott", "Kayla Johnson", "Megan Price", "Leah Morgan", "Claire Dubois", "Audrey Fox"] },
    { id: "sa", abbr: "SA", name: C("南美洲", "南米"), lore: C("南美聯賽只有一個世界賽名額。熱情的觀眾讓主場永遠沸騰。", "南米リーグの世界大会枠は 1 つ。情熱的な観客でホームはいつも沸騰。"), diff: "high", str: 58, league: "sa", sponsor: 85, fund: 500, start: -1, scout: -2,
      cities: ["São Paulo Samba", "Rio Carnaval", "Buenos Aires Tango", "Santiago Andes", "Lima Condors", "Bogotá Esmeralda", "Montevideo Sol", "Quito Volcán"],
      names: ["Valentina Silva", "Camila Rocha", "Isabela Costa", "Luciana Pérez", "Martina Gómez", "Gabriela Souza", "Sofía Herrera", "Mariana Lopes", "Julieta Díaz", "Renata Alves", "Paula Ríos", "Bianca Torres"] },
    { id: "weu", abbr: "WEU", name: C("西歐", "西欧"), lore: C("草創時期的前王者——第一屆世界冠軍就是歐洲隊伍。如今被中韓超越，需要再次找回過去的榮景。", "創成期の元王者――第 1 回世界大会を制したのは欧州だった。中韓に追い越された今、かつての栄光を取り戻せ。"), diff: "mid", str: 69, league: "eu", sponsor: 150, fund: 1000, start: 1, scout: 0,
      cities: ["Paris Lumière", "Berlin Valkyrie", "Madrid Flamenco", "London Rose", "Milan Moda", "Amsterdam Tulip", "Lisbon Fado", "Brussels Iris"],
      names: ["Léa Dubois", "Clara Schmidt", "Sofia Romano", "Emma de Vries", "Lucía García", "Hannah Müller", "Chloé Laurent", "Giulia Bianchi", "Nora Jansen", "Inès Martín", "Freya Larsen", "Elodie Petit"] },
    { id: "eeu", abbr: "EEU", name: C("東歐", "東欧"), lore: C("編入歐洲聯賽。在西歐強隊的陰影下尋找突破口。", "欧州リーグ所属。西欧強豪の影で突破口を探す。"), diff: "high", str: 60, league: "eu", sponsor: 88, fund: 520, start: -1, scout: -2,
      cities: ["Warsaw Mermaid", "Prague Golden", "Budapest Danube", "Bucharest Lynx", "Belgrade White", "Kyiv Sunflower", "Sofia Rosa", "Zagreb Comet"],
      names: ["Zofia Kowalska", "Ewa Nowak", "Tereza Nováková", "Ana Popescu", "Mila Horvat", "Katarzyna Wójcik", "Elena Ionescu", "Petra Kovács", "Nina Petrović", "Iveta Dvořáková", "Maja Zielińska", "Lenka Svobodová"] }
  ];
  var REGION = {};
  REGIONS.forEach(function (r) { REGION[r.id] = r; });

  // ---------------- 聯賽（括號＝世界大賽種子數，合計 16） ----------------
  // members：由哪些國家組成、各幾隊（合計 8 隊）。str：聯賽平均實力。
  var LEAGUES = [
    { id: "cn", name: C("中國", "中国"), seeds: 3, str: 75, members: [["cn", 8]] },
    { id: "kr", name: C("韓國", "韓国"), seeds: 3, str: 75, members: [["kr", 8]] },
    { id: "tj", name: C("台日", "台日"), seeds: 2, str: 64, members: [["tw", 4], ["jp", 4]] },
    { id: "asia", name: C("亞洲區", "アジア"), seeds: 1, str: 60, members: [["vn", 4], ["mn", 4]] },
    { id: "na", name: C("北美", "北米"), seeds: 3, str: 66, members: [["naw", 4], ["nae", 4]] },
    { id: "sa", name: C("南美", "南米"), seeds: 1, str: 58, members: [["sa", 8]] },
    { id: "eu", name: C("歐洲", "欧州"), seeds: 3, str: 68, members: [["weu", 4], ["eeu", 2], ["ru", 2]] }
  ];
  var LEAGUE = {};
  LEAGUES.forEach(function (l) { LEAGUE[l.id] = l; });

  // 韓國的王朝隊伍與當代超一流中路 Taker（從韓國開始時無法直接帶領；拿下國際大獎後才有機緣轉隊）
  var DYNASTY = { region: "kr", name: "Seoul Starlight", boost: 8,
    star: { handle: "Taker", name: "李相熙", role: "mid", target: 96, age: 24, trait: "calm" } };

  // 歷屆世界冠軍（遊戲開始前的歷史）
  var HALL = [
    { s: 1, team: "Paris Lumière", lg: "eu" },
    { s: 2, team: C("台灣隊伍（紀錄遺失，僅存傳聞）", "台湾チーム（記録喪失、噂のみ）"), lg: "tj", rumor: true },
    { s: 3, team: "Seoul Starlight", lg: "kr" },
    { s: 4, team: "Busan Tide", lg: "kr" },
    { s: 5, team: "Seoul Starlight", lg: "kr" },
    { s: 6, team: "Shanghai Dragoness", lg: "cn" },
    { s: 7, team: "Seoul Starlight（Taker）", lg: "kr" },
    { s: 8, team: "Beijing Moonlight", lg: "cn" },
    { s: 9, team: "Seoul Starlight（Taker）", lg: "kr" }
  ];
  var DIFF = {
    low: { name: C("低", "低"), cls: "low" },
    mid: { name: C("中", "中"), cls: "mid" },
    high: { name: C("高", "高"), cls: "high" }
  };

  // 選手 ID（遊戲內暱稱）
  var HANDLES = ["Mochi", "Luna", "Yuzu", "Kiwi", "Peach", "Nova", "Rin", "Sora", "Hana", "Aria", "Nyx", "Echo", "Pixel", "Vivi", "Kira", "Momo",
    "Lumi", "Ember", "Frost", "Iris", "Lyra", "Mint", "Nami", "Ruby", "Saki", "Tofu", "Vega", "Wisp", "Yuki", "Zephyr", "Blitz", "Cocoa",
    "Daisy", "Gale", "Halo", "Ivy", "Koi", "Lotus", "Mika", "Neon", "Opal", "Pudding", "Quill", "Rose", "Sable", "Tiara", "Umi", "Velvet",
    "Willow", "Xia", "Yume", "Zuzu", "Astra", "Bloom", "Cherry", "Dew", "Elle", "Glow", "Honey", "Ichigo", "Jade", "Kuro", "Lala", "Melon",
    "Nimbus", "Orca", "Pepper", "Raven", "Snow", "Tsuki", "Ume", "Viola", "Wren", "Yoru", "Zinnia", "Akari", "Bambi", "Clover", "Dove", "Fern",
    "Gem", "Hime", "Juno", "Kai", "Lily", "Maple", "Nana", "Olive", "Poppy", "Riko", "Shiro", "Tea", "Uta", "Mirai", "Sena", "Aoi"];

  // ---------------- 英雄（100，每個位置 20） ----------------
  // tags：engage 開團／cc 控制／peel 保護／poke 消耗／burst 爆發／dive 突進／split 分推／scale 後期／early 前期／sustain 續戰
  // curve：[前期, 中期, 後期] 1〜5。color：3D 重播的代表色。
  function H(id, role, zh, ja, tags, curve, color) { return { id: id, role: role, name: C(zh, ja), tags: tags, curve: curve, color: color }; }
  var HEROES = [
    H("t_valk", "top", "鋼盾女武神", "鋼盾のヴァルキリー", ["engage", "cc", "peel"], [3, 4, 3], 0xc0c8d8),
    H("t_blade", "top", "緋刃劍姬", "緋刃の剣姫", ["split", "burst"], [4, 4, 3], 0xe0384a),
    H("t_rose", "top", "荊棘薔薇", "茨の薔薇", ["sustain", "peel"], [2, 3, 4], 0xd0508a),
    H("t_wolf", "top", "銀狼騎士", "銀狼騎士", ["dive", "early"], [5, 3, 2], 0x9aa8c0),
    H("t_titan", "top", "岩之巨人", "岩の巨人", ["engage", "cc"], [2, 4, 4], 0x8a7a5a),
    H("t_monk", "top", "拳聖修女", "拳聖シスター", ["early", "dive", "burst"], [4, 4, 2], 0xf0c060),
    H("t_lancer", "top", "龍槍騎士", "竜槍の騎士", ["split", "scale"], [2, 3, 5], 0x4a70c8),
    H("t_witch", "top", "咒縛魔女", "呪縛の魔女", ["poke", "cc"], [3, 4, 3], 0x8a48c8),
    H("t_guard", "top", "聖堂守衛", "聖堂の守護者", ["peel", "sustain"], [3, 3, 4], 0xf0e0a0),
    H("t_ronin", "top", "浪人劍豪", "浪人剣豪", ["split", "burst", "scale"], [3, 3, 5], 0x5a6a8a),

    H("j_fox", "jg", "九尾妖狐", "九尾の妖狐", ["early", "burst", "dive"], [5, 4, 2], 0xff8a3a),
    H("j_shadow", "jg", "暗影刺客", "影の刺客", ["burst", "dive"], [4, 4, 3], 0x40305a),
    H("j_bear", "jg", "戰熊薩滿", "戦熊シャーマン", ["engage", "cc", "early"], [4, 4, 2], 0x8a5a3a),
    H("j_vine", "jg", "森林德魯伊", "森のドルイド", ["cc", "sustain", "peel"], [3, 3, 4], 0x4aa84a),
    H("j_hawk", "jg", "鷹眼獵手", "鷹の目の狩人", ["poke", "early"], [4, 3, 3], 0xb08a4a),
    H("j_queen", "jg", "蜂后", "女王蜂", ["early", "dive"], [5, 3, 2], 0xf0c020),
    H("j_golem", "jg", "古代魔像", "古代ゴーレム", ["engage", "cc"], [2, 4, 4], 0x7a8a9a),
    H("j_reaper", "jg", "死神鐮刀", "死神の大鎌", ["scale", "burst"], [2, 4, 5], 0x6a2a4a),
    H("j_wind", "jg", "疾風舞者", "疾風の踊り子", ["dive", "engage"], [3, 4, 3], 0x60d0c0),
    H("j_moon", "jg", "月光獵人", "月光の狩人", ["split", "scale"], [3, 3, 4], 0xa0b0f0),

    H("m_star", "mid", "星辰魔導師", "星辰の魔導師", ["poke", "scale"], [2, 4, 5], 0x7080ff),
    H("m_flame", "mid", "炎之魔女", "炎の魔女", ["burst", "cc"], [3, 4, 4], 0xff5020),
    H("m_ice", "mid", "冰晶女王", "氷晶の女王", ["cc", "peel", "poke"], [3, 4, 4], 0x90e0ff),
    H("m_assn", "mid", "夜刃", "夜刃", ["burst", "dive", "early"], [4, 4, 3], 0x303050),
    H("m_clock", "mid", "時空術士", "時空術士", ["scale", "cc"], [2, 3, 5], 0xd0b070),
    H("m_storm", "mid", "雷霆巫女", "雷霆の巫女", ["poke", "burst"], [3, 4, 3], 0xf0f060),
    H("m_dancer", "mid", "劍舞姬", "剣舞姫", ["dive", "burst", "split"], [3, 4, 4], 0xff80b0),
    H("m_sage", "mid", "符文賢者", "ルーンの賢者", ["peel", "sustain"], [3, 3, 4], 0x60a0a0),
    H("m_void", "mid", "虛空觀測者", "虚空の観測者", ["poke", "scale"], [2, 4, 5], 0x8040a0),
    H("m_puppet", "mid", "人偶師", "人形遣い", ["engage", "cc"], [3, 5, 3], 0xc07090),

    H("a_arrow", "adc", "精靈弓手", "エルフの射手", ["poke", "sustain"], [3, 4, 4], 0x70c070),
    H("a_gun", "adc", "雙槍少女", "二丁拳銃の少女", ["early", "burst"], [4, 4, 3], 0xe07040),
    H("a_cannon", "adc", "重砲公主", "重砲の姫君", ["scale", "poke"], [2, 3, 5], 0xd0a040),
    H("a_frost", "adc", "霜弓射手", "霜弓の射手", ["cc", "poke"], [3, 4, 4], 0xa0d8ff),
    H("a_hunter", "adc", "賞金獵人", "賞金稼ぎ", ["early", "burst"], [5, 3, 2], 0xa05030),
    H("a_crow", "adc", "鴉之射手", "鴉の射手", ["burst", "dive"], [3, 4, 4], 0x303040),
    H("a_sniper", "adc", "狙擊精英", "狙撃エリート", ["poke"], [3, 4, 4], 0x6a8a60),
    H("a_blood", "adc", "血月獵手", "血月の狩人", ["sustain", "scale"], [2, 4, 5], 0xb02030),
    H("a_spark", "adc", "火花機工", "火花メカニック", ["early", "poke"], [4, 4, 3], 0xffa020),
    H("a_angel", "adc", "天弓聖女", "天弓の聖女", ["scale"], [1, 3, 5], 0xfff0c0),

    H("s_heal", "sup", "治癒聖女", "癒しの聖女", ["peel", "sustain"], [2, 4, 4], 0xf8f0d0),
    H("s_hook", "sup", "鎖鏈獄卒", "鎖の獄卒", ["engage", "cc"], [4, 4, 3], 0x6a6a7a),
    H("s_bard", "sup", "吟遊詩人", "吟遊詩人", ["cc", "engage"], [3, 4, 4], 0xc0a0e0),
    H("s_shield", "sup", "盾之巫女", "盾の巫女", ["peel"], [3, 4, 4], 0xe0e0ff),
    H("s_bunny", "sup", "兔耳偶像", "うさ耳アイドル", ["sustain", "peel", "poke"], [3, 3, 4], 0xffb0d0),
    H("s_tide", "sup", "潮汐巫女", "潮汐の巫女", ["engage", "cc"], [3, 5, 3], 0x3070d0),
    H("s_lantern", "sup", "燈籠魂使", "灯籠の魂使い", ["cc", "peel"], [3, 4, 4], 0xffd080),
    H("s_war", "sup", "戰吼女傑", "雄叫びの女傑", ["engage", "early"], [4, 4, 2], 0xc04030),
    H("s_mage", "sup", "星詠法師", "星詠みの法師", ["poke", "burst"], [4, 4, 3], 0x80a0ff),
    H("s_angel", "sup", "守護天使", "守護天使", ["peel", "scale"], [2, 3, 5], 0xfff8e0),
    // ---- 2026-11-11 追加：每個位置 20 位（雙方共用的完整無懼選角撐得到 Bo5） ----
    H("t_paladin", "top", "曙光聖騎", "曙光の聖騎士", ["engage", "peel", "sustain"], [3, 4, 3], 0xf8e070),
    H("t_berserk", "top", "狂戰少女", "狂戦士の少女", ["early", "burst", "split"], [5, 3, 2], 0xc03020),
    H("t_samurai", "top", "紅葉武士", "紅葉の武士", ["split", "burst"], [3, 4, 4], 0xe06030),
    H("t_druid", "top", "熊之德魯伊", "熊のドルイド", ["sustain", "engage"], [3, 3, 4], 0x7a5a30),
    H("t_knight", "top", "黑薔薇騎士", "黒薔薇の騎士", ["dive", "burst"], [4, 4, 3], 0x502040),
    H("t_giant", "top", "冰原巨人", "氷原の巨人", ["engage", "cc", "peel"], [2, 4, 4], 0x90c0e0),
    H("t_duelist", "top", "決鬥家", "決闘者", ["split", "scale"], [3, 3, 5], 0xd0d0e0),
    H("t_mech", "top", "機甲少女", "メカ少女", ["poke", "sustain"], [3, 4, 3], 0x70a0b0),
    H("t_vamp", "top", "血族伯爵", "吸血の伯爵", ["sustain", "scale"], [2, 3, 5], 0x901830),
    H("t_shaman", "top", "雷鳴薩滿", "雷鳴のシャーマン", ["cc", "early"], [4, 4, 2], 0x4060e0),
    H("j_ninja", "jg", "影忍", "影忍", ["early", "burst", "dive"], [5, 4, 2], 0x282838),
    H("j_panther", "jg", "黑豹獵人", "黒豹の狩人", ["burst", "dive"], [4, 4, 3], 0x303020),
    H("j_ent", "jg", "古樹守護者", "古樹の守り手", ["engage", "cc", "sustain"], [2, 4, 4], 0x507030),
    H("j_spider", "jg", "蛛后", "蜘蛛の女王", ["early", "burst"], [5, 3, 2], 0x602060),
    H("j_dragon", "jg", "龍騎姬", "竜騎姫", ["engage", "dive"], [3, 4, 4], 0xd04020),
    H("j_sprite", "jg", "森林精靈", "森の精霊", ["poke", "cc"], [3, 4, 3], 0x80e080),
    H("j_rogue", "jg", "盜賊公主", "盗賊の姫", ["split", "burst"], [3, 4, 3], 0xa08040),
    H("j_lava", "jg", "熔岩泰坦", "溶岩の巨神", ["engage", "cc"], [2, 4, 4], 0xff6020),
    H("j_owl", "jg", "夜梟", "夜梟", ["scale", "dive"], [2, 4, 5], 0x6a5a8a),
    H("j_cat", "jg", "貓又", "猫又", ["early", "dive", "split"], [4, 4, 3], 0xf0a0c0),
    H("m_song", "mid", "風之歌姬", "風の歌姫", ["poke", "cc"], [3, 4, 4], 0x80f0d0),
    H("m_dark", "mid", "影魔導", "影の魔導師", ["burst", "scale"], [2, 4, 5], 0x402060),
    H("m_foxfire", "mid", "狐火巫女", "狐火の巫女", ["burst", "dive"], [4, 4, 3], 0xff9040),
    H("m_alch", "mid", "鍊金術士", "錬金術師", ["poke", "sustain"], [3, 4, 4], 0x60c060),
    H("m_grav", "mid", "重力魔女", "重力の魔女", ["cc", "engage"], [3, 4, 4], 0x5040a0),
    H("m_blood", "mid", "血魔法師", "血の魔法使い", ["sustain", "burst"], [3, 4, 4], 0xa01040),
    H("m_priest", "mid", "光之大祭司", "光の大司祭", ["poke", "peel"], [2, 4, 4], 0xfff0a0),
    H("m_mirror", "mid", "鏡像幻術師", "鏡像の幻術師", ["burst", "split"], [3, 4, 4], 0xc0e0ff),
    H("m_msword", "mid", "魔劍士", "魔剣士", ["dive", "burst", "early"], [4, 4, 3], 0x6060c0),
    H("m_abyss", "mid", "深淵女王", "深淵の女王", ["scale", "cc"], [2, 3, 5], 0x203060),
    H("a_wind", "adc", "風行者", "風の旅人", ["poke", "early"], [4, 4, 3], 0x90e0b0),
    H("a_icebow", "adc", "冰晶弩手", "氷晶の弩手", ["cc", "scale"], [2, 4, 5], 0xb0e8ff),
    H("a_spear", "adc", "雷槍少女", "雷槍の少女", ["burst", "poke"], [3, 4, 4], 0xf0e040),
    H("a_pirate", "adc", "海賊船長", "海賊船長", ["early", "sustain"], [4, 4, 3], 0x8a4a2a),
    H("a_meteor", "adc", "流星弓", "流星の弓", ["scale", "poke"], [2, 3, 5], 0xa0a0ff),
    H("a_shade", "adc", "影之射手", "影の射手", ["burst", "dive"], [3, 4, 4], 0x403050),
    H("a_chem", "adc", "化學狂人", "マッドケミスト", ["poke", "sustain"], [3, 4, 4], 0x80ff40),
    H("a_xbow", "adc", "弩騎士", "弩騎士", ["sustain", "peel"], [3, 4, 4], 0x8090a0),
    H("a_fairy", "adc", "妖精射手", "妖精の射手", ["early", "poke"], [4, 4, 2], 0xffc0f0),
    H("a_breath", "adc", "龍息砲手", "竜息の砲手", ["scale", "burst"], [2, 4, 5], 0xe05030),
    H("s_nun", "sup", "修女", "シスター", ["peel", "sustain"], [2, 4, 4], 0x303040),
    H("s_rope", "sup", "繩索使", "縄使い", ["engage", "cc", "early"], [4, 4, 3], 0xb08050),
    H("s_bell", "sup", "鈴音巫女", "鈴音の巫女", ["cc", "peel"], [3, 4, 4], 0xff6070),
    H("s_dance", "sup", "舞姬", "舞姫", ["sustain", "poke"], [3, 4, 3], 0xffa0c0),
    H("s_stone", "sup", "石像守衛", "石像の番人", ["engage", "peel"], [3, 4, 4], 0x909080),
    H("s_time", "sup", "時之魔女", "時の魔女", ["cc", "scale"], [2, 4, 5], 0xc0a060),
    H("s_fox", "sup", "狐仙", "狐仙", ["poke", "burst"], [4, 3, 3], 0xffb060),
    H("s_shieldk", "sup", "盾騎士", "盾騎士", ["engage", "peel", "early"], [4, 4, 3], 0x6080c0),
    H("s_starsaint", "sup", "星辰聖女", "星辰の聖女", ["peel", "scale"], [2, 3, 5], 0xe0e0ff),
    H("s_lucky", "sup", "招財貓", "招き猫", ["sustain", "peel"], [3, 4, 3], 0xffe0a0)
  ];
  var HERO = {};
  HEROES.forEach(function (h) { HERO[h.id] = h; });

  var TAG = {
    engage: C("開團", "仕掛け"), cc: C("控制", "CC"), peel: C("保護", "ピール"), poke: C("消耗", "ポーク"), burst: C("爆發", "バースト"),
    dive: C("突進", "ダイブ"), split: C("分推", "スプリット"), scale: C("後期", "レイト"), early: C("前期", "序盤"), sustain: C("續戰", "継戦")
  };

  // 羈絆組合：同隊同時選到兩位時全時段加成
  var SYNERGIES = [
    { a: "t_valk", b: "m_flame", name: C("盾與烈焰", "盾と烈火") },
    { a: "j_bear", b: "m_puppet", name: C("熊與人偶", "熊と人形") },
    { a: "s_hook", b: "a_gun", name: C("鎖鏈連擊", "チェーンコンボ") },
    { a: "s_heal", b: "a_cannon", name: C("移動砲台", "移動砲台") },
    { a: "s_angel", b: "a_angel", name: C("雙天使", "ダブルエンジェル") },
    { a: "j_fox", b: "m_assn", name: C("暗夜雙刃", "闇夜の双刃") },
    { a: "s_tide", b: "m_flame", name: C("漩渦烈焰", "渦潮と烈火") },
    { a: "s_shield", b: "a_blood", name: C("血盾", "血の盾") },
    { a: "t_titan", b: "a_frost", name: C("冰封巨岩", "氷封の巨岩") },
    { a: "j_golem", b: "m_ice", name: C("永凍要塞", "永久凍土の要塞") },
    { a: "s_bunny", b: "a_spark", name: C("偶像演唱會", "アイドルライブ") },
    { a: "t_ronin", b: "j_moon", name: C("分推雙刃", "スプリット双刃") },
    { a: "s_war", b: "j_queen", name: C("前期入侵", "序盤インベード") },
    { a: "m_star", b: "a_sniper", name: C("遠程星砲", "遠距離星砲") },
    { a: "s_lantern", b: "a_arrow", name: C("燈下精靈", "灯火とエルフ") },
    { a: "t_monk", b: "j_wind", name: C("疾風拳舞", "疾風拳舞") },
    { a: "m_clock", b: "s_bard", name: C("時之樂章", "時の楽章") },
    { a: "t_lancer", b: "m_void", name: C("虛空龍槍", "虚空竜槍") },
    { a: "t_paladin", b: "s_nun", name: C("聖光庇護", "聖光の加護") },
    { a: "j_ninja", b: "m_foxfire", name: C("影與狐火", "影と狐火") },
    { a: "s_rope", b: "a_pirate", name: C("海賊繩索", "海賊ロープ") },
    { a: "s_time", b: "a_meteor", name: C("流星時刻", "流星の刻") },
    { a: "j_lava", b: "m_grav", name: C("熔岩重力井", "溶岩重力井") },
    { a: "t_giant", b: "a_icebow", name: C("冰河時代", "氷河期") },
    { a: "s_bell", b: "a_spear", name: C("鈴與雷", "鈴と雷") },
    { a: "t_samurai", b: "j_cat", name: C("武士與貓", "侍と猫") },
    { a: "s_starsaint", b: "a_breath", name: C("星龍守護", "星竜の加護") },
    { a: "m_alch", b: "a_chem", name: C("瘋狂實驗室", "マッドラボ") },
    { a: "j_dragon", b: "s_shieldk", name: C("龍與盾", "竜と盾") },
    { a: "s_lucky", b: "a_fairy", name: C("幸運妖精", "幸運の妖精") }
  ];

  // ---------------- 戰術 ----------------
  // likes：吻合的英雄標籤。phase：各時段的加成。beats：克制的戰術（每種克制 2 種、被 2 種克制）。
  var TACTICS = [
    { id: "early", name: C("前期壓制入侵", "序盤インベード"), icon: "⚔", likes: ["early", "dive", "burst"], phase: { early: 2.2, mid: 0.4, late: -1.6 }, beats: ["protect", "siege"],
      desc: C("一級就入侵野區、前十分鐘頻繁抓人，在對手成形前滾雪球。後期乏力。", "レベル1からインベード、序盤10分でガンクを重ね、相手が育つ前に雪だるま式に有利を広げる。終盤は弱い。") },
    { id: "fight", name: C("團戰開團", "集団戦エンゲージ"), icon: "💥", likes: ["engage", "cc", "dive"], phase: { early: 0, mid: 1.8, late: 0.8 }, beats: ["early", "split"],
      desc: C("五人抱團，在小龍與先鋒前主動開團，用控制鏈一波帶走。", "5人でまとまり、ドラゴンやヘラルド前で積極的に仕掛け、CC チェーンで一気に崩す。") },
    { id: "protect", name: C("保C後期", "キャリー守護"), icon: "👑", likes: ["peel", "scale", "sustain"], phase: { early: -1.4, mid: 0.2, late: 2.4 }, beats: ["fight", "siege"],
      desc: C("前期穩健發育，全隊圍繞下路 C 位保護輸出，後期一波定勝負。", "序盤は安全に育ち、ボットのキャリーを全員で守って終盤の一戦で決める。") },
    { id: "split", name: C("分推運營", "スプリットプッシュ"), icon: "🧭", likes: ["split", "scale", "poke"], phase: { early: 0, mid: 1.0, late: 1.2 }, beats: ["protect", "early"],
      desc: C("一人單帶牽制，其餘四人拖延，用兵線與視野拉開地圖差距。", "1人がサイドで引きつけ、4人で時間を稼ぎ、ウェーブと視界でマップを広く使う。") },
    { id: "siege", name: C("消耗速推", "ポーク＆シージ"), icon: "🏰", likes: ["poke", "sustain", "early"], phase: { early: 0.8, mid: 1.6, late: 0 }, beats: ["fight", "split"],
      desc: C("用遠程技能消耗塔下，拿到先鋒後連拔外塔，用經濟壓垮對手。", "遠距離スキルでタワー下を削り、ヘラルドから外タワーを連続で折って経済差で押し潰す。") }
  ];
  var TACTIC = {};
  TACTICS.forEach(function (t) { TACTIC[t.id] = t; });

  // ---------------- 關鍵會戰（重播的場景） ----------------
  // loc：3D 地圖上的位置代號（champ_3d.js）。phase：用哪個時段的實力比。swing：勝方取得的經濟差（K）。k：勝方擊殺數上限。
  var MOMENTS = {
    invade: { name: C("一級入侵", "Lv1 インベード"), loc: "jungle", phase: "early", swing: 1.5, k: 2, min: [1, 3] },
    gank: { name: C("下路 Gank", "ボットガンク"), loc: "bot", phase: "early", swing: 2.2, k: 3, min: [4, 8] },
    drake: { name: C("小龍團戰", "ドラゴン集団戦"), loc: "dragon", phase: "early", swing: 3, k: 4, min: [9, 15], obj: "dragon" },
    herald: { name: C("先鋒爭奪", "ヘラルド争奪"), loc: "baron", phase: "mid", swing: 3, k: 3, min: [11, 15], obj: "herald" },
    midfight: { name: C("中路遭遇戰", "ミッド遭遇戦"), loc: "mid", phase: "mid", swing: 3.5, k: 4, min: [15, 22] },
    baron: { name: C("巴龍團戰", "バロン集団戦"), loc: "baron", phase: "late", swing: 5, k: 5, min: [22, 30], obj: "baron" },
    elder: { name: C("遠古巨龍決戰", "エルダードラゴン決戦"), loc: "dragon", phase: "late", swing: 6, k: 5, min: [30, 38], obj: "elder" },
    siege: { name: C("高地推進", "ハイグラウンド攻め"), loc: "base", phase: "late", swing: 0, k: 5, min: [0, 0], obj: "nexus" }
  };

  // ---------------- 個性 ----------------
  var TRAITS = [
    { id: "hot", name: C("熱血", "熱血"), likes: ["karaoke", "amuse"], grow: 1.0, mental: 0, swing: 1.3, statBias: "fight",
      lines: [C("「教練！今天也要燃燒起來！」", "「コーチ！今日も燃えていこう！」"), C("「下一場我一定會打爆對面！你看著吧！」", "「次の試合、絶対ぶっ飛ばすから！見ててよ！」"), C("「跟你在一起……心臟跳得比團戰還快。」", "「あなたといると……集団戦より心臓がうるさいの。」")] },
    { id: "calm", name: C("冷靜", "クール"), likes: ["aquarium", "cafe"], grow: 1.0, mental: 2, swing: 0.7, statBias: "macro",
      lines: [C("「數據我看過了。教練的判斷，我信。」", "「データは見ました。コーチの判断を信じます。」"), C("「……其實，我不討厭這樣聊天。」", "「……実は、こうして話すのは嫌いじゃないです。」"), C("「只有在你面前，我才不用那麼冷靜。」", "「あなたの前でだけは、冷静でいなくていいんです。」")] },
    { id: "natural", name: C("天然", "天然"), likes: ["amuse", "cafe"], grow: 1.05, mental: 0, swing: 1.1, statBias: "mech",
      lines: [C("「欸？今天要練什麼？我剛剛在想晚餐……」", "「えっ？今日何練習するの？夕ご飯のこと考えてた……」"), C("「教練好像我家的貓，看到就很安心～」", "「コーチってうちの猫みたい、見てると安心する～」"), C("「我想一直、一直跟你一起打比賽喔。」", "「ずっとずっと、あなたと一緒に試合したいな。」")] },
    { id: "tsun", name: C("傲嬌", "ツンデレ"), likes: ["shopping", "night"], grow: 1.0, mental: 1, swing: 1.0, statBias: "lane", dateMul: 1.3, talkMul: 0.6,
      lines: [C("「哼，不是因為你是教練我才聽的喔！」", "「ふん、コーチだから言うこと聞いてるわけじゃないんだからね！」"), C("「……謝、謝謝你今天陪我。只是順便說一下！」", "「……き、今日はありがと。ついでに言っただけ！」"), C("「笨蛋……我早就只看著你了啦。」", "「バカ……とっくにあなたしか見てないのに。」")] },
    { id: "hard", name: C("努力家", "努力家"), likes: ["cafe", "cinema"], grow: 1.25, mental: 1, swing: 0.9, statBias: "lane",
      lines: [C("「我還可以再練一小時！」", "「あと1時間練習できます！」"), C("「教練幫我看的錄影，我全部筆記起來了。」", "「コーチが見てくれたリプレイ、全部ノートにまとめました。」"), C("「我變強的理由……有一半是你喔。」", "「私が強くなりたい理由……半分はあなたです。」")] },
    { id: "confident", name: C("自信家", "自信家"), likes: ["shopping", "night"], grow: 1.0, mental: 3, swing: 1.0, statBias: "mech",
      lines: [C("「放心，C 位交給我就好。」", "「安心して、キャリーは私に任せて。」"), C("「能讓我願意聽話的，只有你喔。」", "「私が言うこと聞くのは、あなただけだよ。」"), C("「世界冠軍的獎盃，我要和你一起舉。」", "「世界大会のトロフィー、あなたと一緒に掲げたい。」")] },
    { id: "shy", name: C("害羞", "恥ずかしがり"), likes: ["cinema", "aquarium"], grow: 1.05, mental: -2, swing: 1.1, statBias: "macro", dateMul: 1.2,
      lines: [C("「那、那個……早安，教練。」", "「あ、あの……おはようございます、コーチ。」"), C("「跟你說話的時候，好像沒那麼緊張了。」", "「あなたと話してると、少し緊張しなくなりました。」"), C("「請、請一直待在我看得到的地方……」", "「ず、ずっと見えるところにいてください……」")] },
    { id: "lady", name: C("大小姐", "お嬢様"), likes: ["night", "onsen"], grow: 1.0, mental: 1, swing: 0.9, statBias: "fight", dislikes: ["karaoke"],
      lines: [C("「教練，本小姐今天狀態可是完美的。」", "「コーチ、わたくし今日のコンディションは完璧ですわ。」"), C("「你是第一個讓我願意排隊買可麗餅的人。」", "「クレープの列に並んでもいいと思えたのは、あなたが初めてですわ。」"), C("「這份心意，可不是金錢能買到的喔。」", "「この気持ちは、お金では買えませんのよ。」")] }
  ];
  var TRAIT = {};
  TRAITS.forEach(function (t) { TRAIT[t.id] = t; });

  // ---------------- 約會 ----------------
  var DATE_SPOTS = [
    { id: "cafe", name: C("咖啡廳", "カフェ"), icon: "☕", cost: 3, mood: 10, aff: 4, text: C("在常去的咖啡廳分享了一塊草莓蛋糕。", "いつものカフェでいちごケーキを半分こした。") },
    { id: "karaoke", name: C("KTV", "カラオケ"), icon: "🎤", cost: 4, mood: 12, aff: 4, text: C("在 KTV 唱到喉嚨沙啞，最後一首是合唱。", "カラオケで声が枯れるまで歌い、最後はデュエット。") },
    { id: "cinema", name: C("電影院", "映画館"), icon: "🎬", cost: 5, mood: 10, aff: 5, text: C("看了一部愛情電影，散場時她的眼角有點紅。", "恋愛映画を観た。終わった時、彼女の目元が少し赤かった。") },
    { id: "aquarium", name: C("水族館", "水族館"), icon: "🐠", cost: 8, mood: 14, aff: 6, text: C("在水族館的大水槽前，藍色的光映在她臉上。", "水族館の大水槽の前、青い光が彼女の頬を照らした。") },
    { id: "night", name: C("夜景餐廳", "夜景レストラン"), icon: "🌃", cost: 10, mood: 15, aff: 7, text: C("在能看見整座城市燈火的餐廳吃了晚餐。", "街の灯りが一望できるレストランでディナー。") },
    { id: "amuse", name: C("遊樂園", "遊園地"), icon: "🎡", cost: 12, mood: 18, aff: 7, text: C("搭了雲霄飛車，最後在摩天輪頂端看夕陽。", "ジェットコースターに乗り、最後は観覧車のてっぺんで夕日を見た。") },
    { id: "shopping", name: C("購物", "ショッピング"), icon: "🛍", cost: 15, mood: 16, aff: 6, text: C("逛了一整天街，送了她一條小小的項鍊。", "一日中ショッピング、小さなネックレスをプレゼントした。") },
    { id: "onsen", name: C("溫泉旅行", "温泉旅行"), icon: "♨", cost: 20, mood: 22, aff: 8, text: C("週末的溫泉小旅行，泡完湯一起喝了咖啡牛奶。", "週末の温泉小旅行。湯上がりに一緒にコーヒー牛乳を飲んだ。") },
    { id: "books", name: C("書店", "本屋"), icon: "📚", cost: 3, mood: 9, aff: 5, text: C("在書店角落各自挑了一本書，交換推薦。", "本屋の片隅でお互いに一冊ずつ選んで、おすすめを交換した。") },
    { id: "catcafe", name: C("貓咪咖啡廳", "猫カフェ"), icon: "🐈", cost: 5, mood: 13, aff: 5, text: C("貓咪跳到她腿上睡著了，她一動也不敢動。", "猫が彼女の膝で眠ってしまい、彼女は身動きが取れなくなった。") },
    { id: "beach", name: C("海邊", "海辺"), icon: "🌊", cost: 6, mood: 15, aff: 6, text: C("赤腳走在沙灘上，浪花打濕了褲腳。", "裸足で砂浜を歩き、波しぶきで裾が濡れた。") },
    { id: "arcade", name: C("電玩中心", "ゲームセンター"), icon: "🕹", cost: 4, mood: 13, aff: 5, text: C("在電玩中心對決格鬥遊戲，她不服輸地連投了十個硬幣。", "ゲーセンで格ゲー対決、負けず嫌いの彼女はコインを十枚も入れた。") },
    { id: "planet", name: C("天文館", "プラネタリウム"), icon: "🌌", cost: 7, mood: 14, aff: 7, text: C("在天文館的星空下，她小聲說起小時候的夢想。", "プラネタリウムの星空の下、彼女は小さな声で子どもの頃の夢を話した。") },
    { id: "fireworks", name: C("煙火大會", "花火大会"), icon: "🎆", cost: 9, mood: 18, aff: 8, text: C("穿著浴衣看煙火，最大的那朵綻放時她握住了你的袖子。", "浴衣で花火大会へ。一番大きな花火が開いた瞬間、彼女があなたの袖をつかんだ。") }
  ];
  var DATE_SPOT = {};
  DATE_SPOTS.forEach(function (d) { DATE_SPOT[d.id] = d; });
  // 飯店談心：好感 50 以上、2 點。每次聽她說一章身世小故事（champ_story.js 的 STORIES），三章讀完解開心結。
  var HOTEL = { cost: 30, ap: 2, mood: 25, aff: 8, needAff: 50, scandal: 0.1 };

  // ---------------- 訓練 ----------------
  var FOCUS = [
    { id: "mech", icon: "🎮", name: C("操作特訓", "操作特訓"), stat: "mech" },
    { id: "lane", icon: "⚔", name: C("對線練習", "対面練習"), stat: "lane" },
    { id: "fight", icon: "💥", name: C("團戰演練", "集団戦演習"), stat: "fight" },
    { id: "macro", icon: "🗺", name: C("運營研究", "マクロ研究"), stat: "macro" },
    { id: "mental", icon: "🧘", name: C("心理輔導", "メンタルケア"), stat: "mental" },
    { id: "hero", icon: "📚", name: C("英雄池擴充", "チャンプ練習"), stat: null },
    { id: "rest", icon: "🛌", name: C("休養", "休養"), stat: null }
  ];
  var FOCUS_BY_ID = {};
  FOCUS.forEach(function (f) { FOCUS_BY_ID[f.id] = f; });

  // 調子（5 段）
  var COND = [
    { v: -2, name: C("絕不調", "絶不調"), icon: "⬇", cls: "c-2" },
    { v: -1, name: C("不調", "不調"), icon: "↘", cls: "c-1" },
    { v: 0, name: C("普通", "普通"), icon: "➡", cls: "c0" },
    { v: 1, name: C("好調", "好調"), icon: "↗", cls: "c1" },
    { v: 2, name: C("絕好調", "絶好調"), icon: "⬆", cls: "c2" }
  ];

  window.PriTestChampData = {
    C: C, L: L,
    ROLES: ROLES, ROLE: ROLE, STATS: STATS, STAT: STAT,
    REGIONS: REGIONS, REGION: REGION, DIFF: DIFF, HANDLES: HANDLES, LEAGUES: LEAGUES, LEAGUE: LEAGUE, DYNASTY: DYNASTY, HALL: HALL,
    HEROES: HEROES, HERO: HERO, TAG: TAG, SYNERGIES: SYNERGIES,
    TACTICS: TACTICS, TACTIC: TACTIC, MOMENTS: MOMENTS,
    TRAITS: TRAITS, TRAIT: TRAIT,
    DATE_SPOTS: DATE_SPOTS, DATE_SPOT: DATE_SPOT, HOTEL: HOTEL,
    FOCUS: FOCUS, FOCUS_BY_ID: FOCUS_BY_ID, COND: COND,
    PHOTO_N: 175
  };
})();
