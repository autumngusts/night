// 九華（kyuka）：靜態資料。規則依據 docs/kyuka_design.md。
// 角色頭像沿用 static/images/jikan/ 的 g_ 系列（與百鬼轉珠同一批女生圖鑑的人物，名字沿用）。
// 九九八十一型的型名、稀有度設定、標籤定義都在這裡；規則（抽選、解鎖、成長、型判定）在 kyuka_core.js。
(function () {
  "use strict";

  function n(zh, ja, en) { return { zh: zh, ja: ja, en: en }; }

  // 九項，順時針：魅（聲・美・瑟）→ 身（柔・速・剛）→ 心（心・智・緣），美在正上方
  var ORDER = ["美", "瑟", "聲", "柔", "速", "剛", "心", "智", "緣"];
  var PETAL_ORDER = ["聲", "美", "瑟", "柔", "速", "剛", "心", "智", "緣"];
  var GROUPS = [
    { id: "魅", keys: ["聲", "美", "瑟"] },
    { id: "身", keys: ["柔", "速", "剛"] },
    { id: "心", keys: ["心", "智", "緣"] }
  ];
  var GROUP_OF = {};
  GROUPS.forEach(function (g, gi) { g.keys.forEach(function (k) { GROUP_OF[k] = gi; }); });

  // 稀有度（§3.2、§4、§5）：rate＝抽中機率（%）、floor＝9V 最低值、growth＝每級每項 +1 的機率、visible＝一開始可見的三華數
  var RARITIES = ["N", "R", "SR", "SSR", "UR"];
  var RARITY = {
    N:   { rate: 50, floor: 1,  growth: 0.15, visible: 1 },
    R:   { rate: 30, floor: 5,  growth: 0.17, visible: 1 },
    SR:  { rate: 14, floor: 10, growth: 0.20, visible: 2 },
    SSR: { rate: 5,  floor: 15, growth: 0.22, visible: 3 },
    UR:  { rate: 1,  floor: 20, growth: 0.25, visible: 3 }
  };
  var MAX_LEVEL = 50, MAX_V = 99, PURE_GAP = 25;
  var UNLOCK_AT = [33, 66];   // 親密度門檻：每過一個多解鎖一華

  // 九九八十一型：列＝主（最高）、欄＝副（第二高），欄順序同 ORDER；對角線＝純粹型
  var TYPE81 = {
    美: ["高嶺之花", "迷人", "名媛", "婀娜", "陽光", "傲嬌", "端莊", "冰山美人", "寵兒"],
    瑟: ["尤物", "媚骨", "夜鶯", "舞孃", "小惡魔", "火辣", "御姐", "風情", "交際花"],
    聲: ["仙音", "撩人", "歌姬", "體貼", "爽朗", "熱血", "虔誠", "辯才", "健談"],
    柔: ["優雅", "慵懶", "乖巧", "溫潤", "靈巧", "柔韌", "善良", "文靜", "和氣"],
    速: ["活潑", "調皮", "颯爽", "怪盜", "飛揚", "野性", "衝動", "精靈", "外向"],
    剛: ["凜然", "豪放", "大姐頭", "俐落", "雷霆", "猛虎", "頑強", "霸氣", "俠義"],
    心: ["純潔", "癡情", "真誠", "賢淑", "元氣", "剛毅", "貞德", "慧心", "深情"],
    智: ["知性", "腹黑", "博學", "神秘", "機敏", "果斷", "沉著", "睿智", "聰穎"],
    緣: ["甜美", "多情", "開朗", "天然呆", "瀟灑", "海派", "單純", "玲瓏", "樂天"]
  };

  // 等級（§3.3）與部分項目的稱號
  var GRADES = [
    { g: "S", min: 90 }, { g: "A", min: 75 }, { g: "B", min: 50 }, { g: "C", min: 25 }, { g: "D", min: 1 }
  ];
  var TITLES = {
    美: { S: "傾國", A: "佳人", B: "秀麗", C: "清秀", D: "樸素" },
    瑟: { S: "魔性", A: "妖艷", B: "撩人", C: "微醺", D: "無自覺" },
    心: { S: "不屈", A: "堅毅", B: "沉穩", C: "普通", D: "易碎" }
  };

  // 角色本體（§2）。skill＝固有技能（暫定文案）
  var HEROES = [
    { id: "hozuki",   img: "g_021", rarity: "UR",  name: n("鬼灯", "鬼灯", "Hozuki"),     title: n("與人立約的鬼姬", "人と契りし鬼姫", "Oni Princess of the Pact"),   skill: n("鬼之契：委託失敗時，同行的同伴不會離隊（每次委託一次）", "鬼の契り：依頼失敗時、同行の仲間は離脱しない（依頼ごとに一回）", "Oni Pact: companions never leave after a failed request (once per request)") },
    { id: "kaguya",   img: "g_016", rarity: "UR",  name: n("輝夜", "輝夜", "Kaguya"),     title: n("月之騎士", "月の騎士", "Knight of the Moon"),                       skill: n("月光加護：同行全員的親密度提升 1.5 倍", "月光の加護：同行全員の親密度上昇 1.5 倍", "Moonlight Grace: affection gains ×1.5 for the whole party") },
    { id: "ai",       img: "g_020", rarity: "SSR", name: n("藍", "藍", "Ai"),             title: n("龍神的使者", "龍神の御使い", "Envoy of the Dragon God"),             skill: n("龍神之雨：委託報酬 +20%", "龍神の雨：依頼報酬 +20%", "Dragon Rain: request rewards +20%") },
    { id: "yuzuha",   img: "g_024", rarity: "SSR", name: n("柚葉", "柚葉", "Yuzuha"),     title: n("古樹的代言人", "古樹の代弁者", "Voice of the Old Tree"),            skill: n("古樹之根：升級時的成長率 +5%", "古樹の根：レベルアップ時の成長率 +5%", "Ancient Roots: growth chance +5% on level up") },
    { id: "shion",    img: "g_012", rarity: "SSR", name: n("紫苑", "紫苑", "Shion"),      title: n("半妖的公主", "半妖の姫", "Half-Yokai Princess"),                   skill: n("半妖之血：惡名值帶來的好感下降減半", "半妖の血：悪名による好感度低下が半分", "Yokai Blood: affection loss from infamy is halved") },
    { id: "momiji",   img: "g_014", rarity: "SR",  name: n("紅葉", "紅葉", "Momiji"),     title: n("退魔軍師", "退魔の軍師", "Exorcist Strategist"),                   skill: n("軍略：委託開始時，提示敵人的弱點", "軍略：依頼開始時、敵の弱点を示す", "Tactics: reveals enemy weaknesses at the start of a request") },
    { id: "tsubaki",  img: "g_015", rarity: "SR",  name: n("椿", "椿", "Tsubaki"),       title: n("紅椿的劍客", "紅椿の剣客", "Crimson Camellia Blade"),               skill: n("落椿：戰鬥中第一次受到致命傷時，以 1 點生命存活", "落椿：戦闘で最初の致命傷を HP1 で耐える", "Falling Camellia: survives the first lethal hit with 1 HP") },
    { id: "ruri",     img: "g_004", rarity: "SR",  name: n("瑠璃", "瑠璃", "Ruri"),       title: n("陰陽寮的才女", "陰陽寮の才女", "Onmyo Prodigy"),                    skill: n("式神：委託中可以多選一次選項", "式神：依頼中に選択肢をもう一度選べる", "Shikigami: one extra choice during a request") },
    { id: "amane",    img: "g_007", rarity: "SR",  name: n("天音", "天音", "Amane"),      title: n("神樂舞姬", "神楽の舞姫", "Kagura Dancer"),                          skill: n("神樂：同行全員的壓力每天 −5", "神楽：同行全員のストレスが毎日 −5", "Kagura: party stress −5 each day") },
    { id: "shizuka",  img: "g_028", rarity: "SR",  name: n("静", "静", "Shizuka"),       title: n("結界守", "結界守", "Barrier Warden"),                               skill: n("結界：受到的傷害 −15%", "結界：受けるダメージ −15%", "Barrier: damage taken −15%") },
    { id: "homura",   img: "g_031", rarity: "R",   name: n("焔", "焔", "Homura"),        title: n("火打石的符師", "火打ちの符術師", "Flint Talisman Caster"),         skill: n("火符：戰鬥開始時對敵人造成小傷害", "火符：戦闘開始時に敵へ小ダメージ", "Fire Talisman: small damage to enemies at battle start") },
    { id: "mio",      img: "g_030", rarity: "R",   name: n("澪", "澪", "Mio"),           title: n("水脈的治癒師", "水脈の癒し手", "Waterway Healer"),                skill: n("清流：委託後回復同伴的傷勢", "清流：依頼後に仲間の怪我を回復", "Clear Stream: heals companions after a request") },
    { id: "shione",   img: "g_011", rarity: "R",   name: n("汐音", "汐音", "Shione"),     title: n("潮騷的歌姬", "潮騒の歌姫", "Tide Singer"),                          skill: n("潮騷之歌：聲的判定 +10%", "潮騒の歌：声の判定 +10%", "Song of the Tide: voice checks +10%") },
    { id: "wakaba",   img: "g_013", rarity: "R",   name: n("若葉", "若葉", "Wakaba"),     title: n("森之歌者", "森の歌い手", "Forest Singer"),                          skill: n("新芽：等級 20 以下時經驗值 +30%", "新芽：レベル 20 以下で経験値 +30%", "Sprout: +30% EXP while level 20 or below") },
    { id: "midori",   img: "g_022", rarity: "R",   name: n("翠", "翠", "Midori"),        title: n("山野的獵人", "山野の狩人", "Mountain Huntress"),                     skill: n("獵人之眼：採集委託的稀有素材機率 +10%", "狩人の目：採集依頼のレア素材率 +10%", "Hunter's Eye: rare material chance +10% on gathering") },
    { id: "kureha",   img: "g_009", rarity: "R",   name: n("黒羽", "黒羽", "Kureha"),     title: n("鴉天狗的養女", "烏天狗の養い子", "Ward of the Crow Tengu"),        skill: n("鴉之翼：潛入委託被發現的機率 −10%", "烏の翼：潜入依頼で見つかる確率 −10%", "Crow Wings: −10% chance of being spotted while sneaking") },
    { id: "shirotae", img: "g_025", rarity: "R",   name: n("白妙", "白妙", "Shirotae"),   title: n("人偶使", "人形遣い", "Puppeteer"),                                   skill: n("人偶替身：一次委託中替同伴承受一次傷害", "人形の身代わり：依頼中に一度仲間の代わりに被弾", "Puppet Decoy: takes one hit for a companion per request") },
    { id: "akane",    img: "g_000", rarity: "N",   name: n("朱音", "朱音", "Akane"),      title: n("見習巫女", "見習い巫女", "Apprentice Miko"),                        skill: n("見習：訓練時的經驗值 +10%", "見習い：訓練時の経験値 +10%", "Apprentice: +10% EXP from training") },
    { id: "shizuku",  img: "g_001", rarity: "N",   name: n("雫", "雫", "Shizuku"),       title: n("泉之巫女", "泉の巫女", "Spring Miko"),                              skill: n("泉水：每天回復少量壓力", "泉の水：毎日ストレスを少し回復", "Spring Water: recovers a little stress each day") },
    { id: "sakura",   img: "g_003", rarity: "N",   name: n("桜", "桜", "Sakura"),        title: n("花守", "花守", "Blossom Keeper"),                                   skill: n("花守：送禮時親密度 +2", "花守：贈り物で親密度 +2", "Blossom Keeper: +2 affection from gifts") },
    { id: "kosuzu",   img: "g_023", rarity: "N",   name: n("小雀", "小雀", "Kosuzu"),     title: n("茶屋的招牌娘", "茶屋の看板娘", "Teahouse Darling"),                 skill: n("招牌娘：公會的委託數 +1", "看板娘：ギルドの依頼数 +1", "Teahouse Darling: one more request on the board") },
    { id: "hikari",   img: "g_002", rarity: "N",   name: n("光", "光", "Hikari"),        title: n("曉之巫女", "暁の巫女", "Dawn Miko"),                                skill: n("曉光：早上出發的委託成功率 +5%", "暁光：朝出発の依頼成功率 +5%", "Dawn Light: +5% success on morning requests") },
    { id: "himari",   img: "g_008", rarity: "N",   name: n("陽葵", "陽葵", "Himari"),     title: n("機關師", "からくり技師", "Karakuri Tinker"),                         skill: n("機關：開鎖與陷阱判定 +10%", "からくり：解錠と罠の判定 +10%", "Karakuri: lockpicking and trap checks +10%") },
    { id: "yoi",      img: "g_005", rarity: "N",   name: n("夜宵", "夜宵", "Yoi"),        title: n("宵之魔女", "宵の魔女", "Witch of Dusk"),                            skill: n("宵闇：夜晚的委託成功率 +5%", "宵闇：夜の依頼成功率 +5%", "Dusk: +5% success on night requests") },
    { id: "oboro",    img: "g_027", rarity: "N",   name: n("朧", "朧", "Oboro"),         title: n("朧月的忍", "朧月の忍", "Shinobi of the Hazy Moon"),                skill: n("朧：被敵人鎖定的機率 −10%", "朧：敵に狙われる確率 −10%", "Haze: −10% chance of being targeted") }
  ];

  // 標籤（§9）：新增玩法時追加的類別。w(v) 依「招募當下的 9V」決定各值的權重
  var TAGS = [
    { id: "talent", name: n("才藝", "特技", "Talent"), values: [
      { v: "歌", w: function (s) { return 1 + s.聲 / 40; } },
      { v: "舞", w: function (s) { return 1 + s.柔 / 40; } },
      { v: "演", w: function (s) { return 1 + s.瑟 / 50 + s.美 / 80; } },
      { v: "畫", w: function (s) { return 1 + s.智 / 60; } },
      { v: "廚", w: function (s) { return 1 + s.心 / 60; } },
      { v: "琴", w: function (s) { return 1 + s.聲 / 80 + s.智 / 80; } }
    ] },
    { id: "run", name: n("跑法", "脚質", "Running Style"), values: [
      { v: "逃", w: function (s) { return 1 + s.速 / 30; } },
      { v: "先行", w: function (s) { return 1 + s.剛 / 40; } },
      { v: "插入", w: function (s) { return 1 + s.智 / 40; } },
      { v: "追込", w: function (s) { return 1 + s.心 / 40; } }
    ] },
    { id: "role", name: n("職業", "職業", "Role"), values: [
      { v: "前衛", w: function (s) { return 1 + s.剛 / 30; } },
      { v: "斥候", w: function (s) { return 1 + s.速 / 30; } },
      { v: "術者", w: function (s) { return 1 + s.智 / 30; } },
      { v: "補師", w: function (s) { return 1 + s.心 / 30; } },
      { v: "歌巫", w: function (s) { return 1 + s.聲 / 30; } }
    ] }
  ];

  var HERO_BY_ID = {};
  HEROES.forEach(function (h) { HERO_BY_ID[h.id] = h; });

  var api = {
    ORDER: ORDER, PETAL_ORDER: PETAL_ORDER, GROUPS: GROUPS, GROUP_OF: GROUP_OF,
    RARITIES: RARITIES, RARITY: RARITY, MAX_LEVEL: MAX_LEVEL, MAX_V: MAX_V, PURE_GAP: PURE_GAP, UNLOCK_AT: UNLOCK_AT,
    TYPE81: TYPE81, GRADES: GRADES, TITLES: TITLES, HEROES: HEROES, HERO_BY_ID: HERO_BY_ID, TAGS: TAGS
  };
  var root = typeof window !== "undefined" ? window : globalThis;
  root.PriTestKyukaData = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
