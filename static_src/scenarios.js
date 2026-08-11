(function () {
  // シナリオ（副本）ごとの固定カード配置表。
  // 出典: シナリオブック掲載の「ステージ構成に使用するトランプ」表。
  var SCENARIOS = [
    {
      id: "tricephalos",
      name: { zh: "三首獸", ja: "三つ首の獣", en: "Tricephalos" },
      // このシナリオ自体には他シナリオのようなbossName欄が本来無いが（三首獸専用の
      // 固有ボスが規則書に明記されていない）、ユーザー確認済み：実際の最終夜の王は
      // グラディウス固定。night_boss_rulebook.js（BOSSES）のidと対応する。
      bossId: "gladius",
      start: { suit: "H", rank: "A" },
      end: { suit: "D", rank: "A" },
      day1: [
        { pos: 1, suit: "C", rank: "2", name: { zh: "大教會（聖）", ja: "大教会（聖）", en: "Grand Cathedral (Sacred)" } },
        { pos: 2, suit: "D", rank: "3", name: { zh: "小砦（無印）", ja: "小砦（無印）", en: "Small Fort (Plain)" } },
        { pos: 3, suit: "H", rank: "4", name: { zh: "大野營地（1）", ja: "大野営地（1）", en: "Main Camp (1)" } },
        { pos: 4, suit: "S", rank: "5", name: { zh: "遺跡（無印）", ja: "遺跡（無印）", en: "Ruins (Plain)" } },
        { pos: 5, suit: "C", rank: "6", name: { zh: "坑道（1）", ja: "坑道（1）", en: "Tunnel (1)" } },
        { pos: 6, suit: "D", rank: "8", name: { zh: "鍛造村（雷1）", ja: "鍛冶村（雷1）", en: "Smithing Village (Lightning 1)" } },
        { pos: 7, suit: "C", rank: "9", name: { zh: "封牢（無印）", ja: "封牢（無印）", en: "Sealed Prison (Plain)" } },
        { pos: 8, suit: "C", rank: "K", name: { zh: "教會（埋沒女神像）", ja: "教会（埋まった女神像）", en: "Church (Buried Idol)" } },
        { pos: 9, suit: "D", rank: "K", name: { zh: "教會（瓦礫之山）", ja: "教会（瓦礫の山）", en: "Church (Rubble Pile)" } },
      ],
      day2: [
        { pos: 1, suit: "D", rank: "2", name: { zh: "大教會（無印）", ja: "大教会（無印）", en: "Grand Cathedral (Plain)" } },
        { pos: 2, suit: "S", rank: "4", name: { zh: "大野營地（火1）", ja: "大野営地（炎1）", en: "Main Camp (Fire 1)" } },
        { pos: 3, suit: "H", rank: "5", name: { zh: "遺跡（聖）", ja: "遺跡（聖）", en: "Ruins (Sacred)" } },
        { pos: 4, suit: "H", rank: "9", name: { zh: "封牢（無印）", ja: "封牢（無印）", en: "Sealed Prison (Plain)" } },
        { pos: 5, suit: "C", rank: "J", name: { zh: "砦（隨機）", ja: "砦（ランダム）", en: "Fort (Random)" } },
        { pos: 6, suit: "S", rank: "K", name: { zh: "教會（商人）", ja: "教会（商人）", en: "Church (Merchant)" } },
      ],
    },
    {
      id: "gaping_jaw",
      name: { zh: "咬噬之顎", ja: "喰らいつく顎", en: "Gaping Jaw" },
      bossName: { zh: "夜之爵、艾德蕾", ja: "夜の爵、エデレ", en: "Night's Baron, Edele" },
      bossId: "edele",
      relicName: { zh: "爵之夜", ja: "爵の夜", en: "Night of the Baron" },
      start: { suit: "S", rank: "A" },
      end: { suit: "C", rank: "A" },
      day1: [
        { pos: 1, suit: "C", rank: "2", name: { zh: "大教會（隨機）", ja: "大教会（ランダム）", en: "Grand Cathedral (Random)" } },
        { pos: 2, suit: "H", rank: "4", name: { zh: "大野營地（隨機）", ja: "大野営地（ランダム）", en: "Main Camp (Random)" } },
        { pos: 3, suit: "S", rank: "5", name: { zh: "遺跡（毒）", ja: "遺跡（毒）", en: "Ruins (Poison)" } },
        { pos: 4, suit: "C", rank: "6", name: { zh: "坑道（2）", ja: "坑道（2）", en: "Tunnel (2)" } },
        { pos: 5, suit: "D", rank: "7", name: { zh: "湖沼（毒）", ja: "湖沼（毒）", en: "Lake (Poison)" } },
        { pos: 6, suit: "C", rank: "9", name: { zh: "封牢（隨機）", ja: "封牢（ランダム）", en: "Sealed Prison (Random)" } },
        { pos: 7, suit: "H", rank: "10", name: { zh: "魔術師之塔", ja: "魔術師塔", en: "Sorcerer's Tower" } },
        { pos: 8, suit: "D", rank: "K", name: { zh: "教會", ja: "教会", en: "Church" } },
        { pos: 9, suit: "S", rank: "K", name: { zh: "教會", ja: "教会", en: "Church" } },
      ],
      day2: [
        { pos: 1, suit: "H", rank: "2", name: { zh: "大教會（隨機）", ja: "大教会（ランダム）", en: "Grand Cathedral (Random)" } },
        { pos: 2, suit: "D", rank: "3", name: { zh: "小砦（隨機）", ja: "小砦（ランダム）", en: "Small Fort (Random)" } },
        { pos: 3, suit: "C", rank: "4", name: { zh: "大野營地（隨機）", ja: "大野営地（ランダム）", en: "Main Camp (Random)" } },
        { pos: 4, suit: "H", rank: "5", name: { zh: "遺跡（隨機）", ja: "遺跡（ランダム）", en: "Ruins (Random)" } },
        { pos: 5, suit: "S", rank: "9", name: { zh: "封牢（隨機）", ja: "封牢（ランダム）", en: "Sealed Prison (Random)" } },
        { pos: 6, suit: "D", rank: "J", name: { zh: "砦（隨機）", ja: "砦（ランダム）", en: "Fort (Random)" } },
      ],
    },
    {
      id: "sentient_pest",
      name: { zh: "知性之蟲", ja: "知性の蟲", en: "Sentient Pest" },
      bossName: { zh: "夜之織、塔諾斯特", ja: "夜の織、タノスター", en: "Night's Weave, Tanoster" },
      bossId: "gnoster",
      relicName: { zh: "識之夜", ja: "識の夜", en: "Night of Knowledge" },
      start: { suit: "H", rank: "A" },
      end: { suit: "C", rank: "A" },
      day1: [
        { pos: 1, suit: "D", rank: "2", name: { zh: "大教會（隨機）", ja: "大教会（ランダム）", en: "Grand Cathedral (Random)" } },
        { pos: 2, suit: "C", rank: "3", name: { zh: "小塔（隨機）", ja: "小塔（ランダム）", en: "Small Tower (Random)" } },
        { pos: 3, suit: "S", rank: "4", name: { zh: "大野營地（隨機）", ja: "大野営地（ランダム）", en: "Main Camp (Random)" } },
        { pos: 4, suit: "H", rank: "5", name: { zh: "遺跡（隨機）", ja: "遺跡（ランダム）", en: "Ruins (Random)" } },
        { pos: 5, suit: "D", rank: "6", name: { zh: "坑道（3）", ja: "坑道（3）", en: "Tunnel (3)" } },
        { pos: 6, suit: "H", rank: "8", name: { zh: "鍛造村（隨機）", ja: "鍛冶村（ランダム）", en: "Smithing Village (Random)" } },
        { pos: 7, suit: "D", rank: "9", name: { zh: "封牢（隨機）", ja: "封牢（ランダム）", en: "Sealed Prison (Random)" } },
        { pos: 8, suit: "S", rank: "10", name: { zh: "魔術師之塔", ja: "魔術師塔", en: "Sorcerer's Tower" } },
        { pos: 9, suit: "C", rank: "K", name: { zh: "教會", ja: "教会", en: "Church" } },
      ],
      day2: [
        { pos: 1, suit: "D", rank: "3", name: { zh: "小砦（隨機）", ja: "小砦（ランダム）", en: "Small Fort (Random)" } },
        { pos: 2, suit: "S", rank: "5", name: { zh: "遺跡（隨機）", ja: "遺跡（ランダム）", en: "Ruins (Random)" } },
        { pos: 3, suit: "D", rank: "7", name: { zh: "湖沼(凍)", ja: "湖沼(氷)", en: "Lake (Frozen)" } },
        { pos: 4, suit: "H", rank: "9", name: { zh: "封牢（隨機）", ja: "封牢（ランダム）", en: "Sealed Prison (Random)" } },
        { pos: 5, suit: "C", rank: "J", name: { zh: "砦（隨機）", ja: "砦（ランダム）", en: "Fort (Random)" } },
        { pos: 6, suit: "D", rank: "K", name: { zh: "教會", ja: "教会", en: "Church" } },
      ],
    },
    {
      id: "augur",
      name: { zh: "兆頭", ja: "兆し", en: "Augur" },
      bossName: { zh: "深海之夜、瑪莉絲", ja: "深海の夜、マリス", en: "Night of the Deep, Maris" },
      bossId: "maris",
      relicName: { zh: "深海之夜", ja: "深海の夜", en: "Night of the Deep" },
      start: { suit: "H", rank: "A" },
      end: { suit: "D", rank: "A" },
      day1: [
        { pos: 1, suit: "D", rank: "2", name: { zh: "大教會（隨機）", ja: "大教会（ランダム）", en: "Grand Cathedral (Random)" } },
        { pos: 2, suit: "S", rank: "3", name: { zh: "小塔（隨機）", ja: "小塔（ランダム）", en: "Small Tower (Random)" } },
        { pos: 3, suit: "C", rank: "4", name: { zh: "大野營地（雷）", ja: "大野営地（雷）", en: "Main Camp (Lightning)" } },
        { pos: 4, suit: "S", rank: "5", name: { zh: "遺跡（隨機）", ja: "遺跡（ランダム）", en: "Ruins (Random)" } },
        { pos: 5, suit: "C", rank: "6", name: { zh: "坑道（隨機）", ja: "坑道（ランダム）", en: "Tunnel (Random)" } },
        { pos: 6, suit: "H", rank: "7", name: { zh: "湖沼（隨機）", ja: "湖沼（ランダム）", en: "Lake (Random)" } },
        { pos: 7, suit: "H", rank: "8", name: { zh: "鍛造村（隨機）", ja: "鍛冶村（ランダム）", en: "Smithing Village (Random)" } },
        { pos: 8, suit: "D", rank: "J", name: { zh: "砦（隨機）", ja: "砦（ランダム）", en: "Fort (Random)" } },
        { pos: 9, suit: "C", rank: "K", name: { zh: "教會", ja: "教会", en: "Church" } },
      ],
      day2: [
        { pos: 1, suit: "C", rank: "3", name: { zh: "小塔（隨機）", ja: "小塔（ランダム）", en: "Small Tower (Random)" } },
        { pos: 2, suit: "D", rank: "5", name: { zh: "遺跡（隨機）", ja: "遺跡（ランダム）", en: "Ruins (Random)" } },
        { pos: 3, suit: "S", rank: "8", name: { zh: "鍛造村（雷1）", ja: "鍛冶村（雷1）", en: "Smithing Village (Lightning 1)" } },
        { pos: 4, suit: "C", rank: "9", name: { zh: "封牢（隨機）", ja: "封牢（ランダム）", en: "Sealed Prison (Random)" } },
        { pos: 5, suit: "H", rank: "9", name: { zh: "封牢（隨機）", ja: "封牢（ランダム）", en: "Sealed Prison (Random)" } },
        { pos: 6, suit: "D", rank: "K", name: { zh: "教會", ja: "教会", en: "Church" } },
      ],
    },
    {
      id: "equilibrious_beast",
      name: { zh: "調律的魔物", ja: "調律の魔物", en: "Equilibrious Beast" },
      bossName: { zh: "夜之魔、莉絲拉", ja: "夜の魔、リスラ", en: "Night's Devil, Risura" },
      bossId: "libra",
      relicName: { zh: "魔之夜", ja: "魔の夜", en: "Night of the Devil" },
      start: { suit: "D", rank: "A" },
      end: { suit: "C", rank: "A" },
      day1: [
        { pos: 1, suit: "D", rank: "2", name: { zh: "大教會（隨機）", ja: "大教会（ランダム）", en: "Grand Cathedral (Random)" } },
        { pos: 2, suit: "H", rank: "4", name: { zh: "大野營地（隨機）", ja: "大野営地（ランダム）", en: "Main Camp (Random)" } },
        { pos: 3, suit: "D", rank: "6", name: { zh: "坑道（隨機）", ja: "坑道（ランダム）", en: "Tunnel (Random)" } },
        { pos: 4, suit: "C", rank: "7", name: { zh: "湖沼(狂)", ja: "湖沼(狂)", en: "Lake (Madness)" } },
        { pos: 5, suit: "S", rank: "8", name: { zh: "鍛造村（隨機）", ja: "鍛冶村（ランダム）", en: "Smithing Village (Random)" } },
        { pos: 6, suit: "D", rank: "9", name: { zh: "封牢（隨機）", ja: "封牢（ランダム）", en: "Sealed Prison (Random)" } },
        { pos: 7, suit: "S", rank: "J", name: { zh: "砦（隨機）", ja: "砦（ランダム）", en: "Fort (Random)" } },
        { pos: 8, suit: "C", rank: "K", name: { zh: "教會", ja: "教会", en: "Church" } },
        { pos: 9, suit: "H", rank: "K", name: { zh: "教會", ja: "教会", en: "Church" } },
      ],
      day2: [
        { pos: 1, suit: "D", rank: "4", name: { zh: "大野營地（狂）", ja: "大野営地（狂）", en: "Main Camp (Madness)" } },
        { pos: 2, suit: "S", rank: "9", name: { zh: "封牢（隨機）", ja: "封牢（ランダム）", en: "Sealed Prison (Random)" } },
        { pos: 3, suit: "H", rank: "10", name: { zh: "魔術師之塔", ja: "魔術師塔", en: "Sorcerer's Tower" } },
        { pos: 4, suit: "H", rank: "Q", terrain: true, name: { zh: "地變｜腐朽森林(1)", ja: "地変｜腐れ森(1)", en: "Terrain Shift｜Rotten Forest (1)" } },
        { pos: 5, suit: "D", rank: "Q", terrain: true, name: { zh: "地變｜腐朽森林(2)", ja: "地変｜腐れ森(2)", en: "Terrain Shift｜Rotten Forest (2)" } },
        { pos: 6, suit: "C", rank: "Q", terrain: true, name: { zh: "地變｜腐朽森林(3)", ja: "地変｜腐れ森(3)", en: "Terrain Shift｜Rotten Forest (3)" } },
      ],
      note: {
        zh: "「地變」（135頁）會自動與場地列5的3張卡置換配置，無須另外抽選。",
        ja: "「地変」（135頁）は、自動的にフィールドライン5の3枚と入れ替えて配置されることに注意。",
      },
    },
    {
      id: "darkdrift_knight",
      name: { zh: "闇馳騁的獵人", ja: "闇駆ける狩人", en: "Darkdrift Knight" },
      bossName: { zh: "夜光騎士、弗爾戈爾", ja: "夜光の騎士、フルゴール", en: "Knight of Nightglow, Fulgor" },
      bossId: "fulghor",
      relicName: { zh: "獵人之夜", ja: "狩人の夜", en: "Night of the Hunter" },
      start: { suit: "S", rank: "A" },
      end: { suit: "H", rank: "A" },
      day1: [
        { pos: 1, suit: "D", rank: "3", name: { zh: "小砦（隨機）", ja: "小砦（ランダム）", en: "Small Fort (Random)" } },
        { pos: 2, suit: "D", rank: "4", name: { zh: "大野營地（隨機）", ja: "大野営地（ランダム）", en: "Main Camp (Random)" } },
        { pos: 3, suit: "S", rank: "5", name: { zh: "遺跡（隨機）", ja: "遺跡（ランダム）", en: "Ruins (Random)" } },
        { pos: 4, suit: "C", rank: "6", name: { zh: "坑道（隨機）", ja: "坑道（ランダム）", en: "Tunnel (Random)" } },
        { pos: 5, suit: "H", rank: "7", name: { zh: "濕沼（隨機）", ja: "湿沼（ランダム）", en: "Swamp (Random)" } },
        { pos: 6, suit: "D", rank: "8", name: { zh: "鍛造村（雷2）", ja: "鍛冶村（雷2）", en: "Smithing Village (Lightning 2)" } },
        { pos: 7, suit: "S", rank: "9", name: { zh: "封牢（隨機）", ja: "封牢（ランダム）", en: "Sealed Prison (Random)" } },
        { pos: 8, suit: "D", rank: "10", name: { zh: "魔術師之塔", ja: "魔術師塔", en: "Sorcerer's Tower" } },
        { pos: 9, suit: "H", rank: "K", name: { zh: "教會", ja: "教会", en: "Church" } },
      ],
      day2: [
        { pos: 1, suit: "C", rank: "9", name: { zh: "封牢（隨機）", ja: "封牢（ランダム）", en: "Sealed Prison (Random)" } },
        { pos: 2, suit: "C", rank: "J", name: { zh: "砦（隨機）", ja: "砦（ランダム）", en: "Fort (Random)" } },
        { pos: 3, suit: "S", rank: "Q", terrain: true, name: { zh: "地變｜山嶺(山頂)", ja: "地変｜山嶺(山頂)", en: "Terrain Shift｜Mountains (Peak)" } },
        { pos: 4, suit: "H", rank: "Q", terrain: true, name: { zh: "地變｜山嶺(山腰)", ja: "地変｜山嶺(中腹)", en: "Terrain Shift｜Mountains (Midslope)" } },
        { pos: 5, suit: "D", rank: "Q", terrain: true, name: { zh: "地變｜山嶺(山麓)", ja: "地変｜山嶺(麓)", en: "Terrain Shift｜Mountains (Foothills)" } },
        { pos: 6, suit: "S", rank: "K", name: { zh: "教會", ja: "教会", en: "Church" } },
      ],
      note: {
        zh: "「地變」（135頁）會自動與場地列5的3張卡置換配置，無須另外抽選。",
        ja: "「地変」（135頁）は、自動的にフィールドライン5の3枚と入れ替えて配置されることに注意。",
      },
    },
    {
      id: "fissure_in_the_fog",
      name: { zh: "霧之裂縫", ja: "霧の裂け目", en: "Fissure in the Fog" },
      bossName: { zh: "夜之霞、卡里戈", ja: "夜の霞、カリゴ", en: "Night's Haze, Caligo" },
      bossId: "caligo",
      relicName: { zh: "霞之夜", ja: "霞の夜", en: "Night of Haze" },
      start: { suit: "H", rank: "A" },
      end: { suit: "S", rank: "A" },
      day1: [
        { pos: 1, suit: "D", rank: "3", name: { zh: "小砦（隨機）", ja: "小砦（ランダム）", en: "Small Fort (Random)" } },
        { pos: 2, suit: "C", rank: "4", name: { zh: "大野營地（隨機）", ja: "大野営地（ランダム）", en: "Main Camp (Random)" } },
        { pos: 3, suit: "S", rank: "5", name: { zh: "遺跡（隨機）", ja: "遺跡（ランダム）", en: "Ruins (Random)" } },
        { pos: 4, suit: "C", rank: "6", name: { zh: "坑道（隨機）", ja: "坑道（ランダム）", en: "Tunnel (Random)" } },
        { pos: 5, suit: "H", rank: "7", name: { zh: "濕沼（隨機）", ja: "湿沼（ランダム）", en: "Swamp (Random)" } },
        { pos: 6, suit: "D", rank: "8", name: { zh: "鍛造村（隨機）", ja: "鍛冶村（ランダム）", en: "Smithing Village (Random)" } },
        { pos: 7, suit: "D", rank: "9", name: { zh: "封牢（隨機）", ja: "封牢（ランダム）", en: "Sealed Prison (Random)" } },
        { pos: 8, suit: "S", rank: "9", name: { zh: "封牢（隨機）", ja: "封牢（ランダム）", en: "Sealed Prison (Random)" } },
        { pos: 9, suit: "H", rank: "J", name: { zh: "砦（隨機）", ja: "砦（ランダム）", en: "Fort (Random)" } },
      ],
      day2: [
        { pos: 1, suit: "C", rank: "8", name: { zh: "鍛造村（炎）", ja: "鍛冶村（炎）", en: "Smithing Village (Fire)" } },
        { pos: 2, suit: "H", rank: "Q", terrain: true, name: { zh: "地變｜諾克拉提歐(最深處)", ja: "地変｜ノクラテオ(最奥)", en: "Terrain Shift｜Noklateo (Depths)" } },
        { pos: 3, suit: "D", rank: "Q", terrain: true, name: { zh: "地變｜諾克拉提歐(市街地)", ja: "地変｜ノクラテオ(市街地)", en: "Terrain Shift｜Noklateo (City)" } },
        { pos: 4, suit: "C", rank: "Q", terrain: true, name: { zh: "地變｜諾克拉提歐(入口)", ja: "地変｜ノクラテオ(玄関口)", en: "Terrain Shift｜Noklateo (Entrance)" } },
        { pos: 5, suit: "C", rank: "K", name: { zh: "教會", ja: "教会", en: "Church" } },
        { pos: 6, suit: "S", rank: "K", name: { zh: "教會", ja: "教会", en: "Church" } },
      ],
      note: {
        zh: "「地變」（135頁）會自動與場地列5的3張卡置換配置，無須另外抽選。",
        ja: "「地変」（135頁）は、自動的にフィールドライン5の3枚と入れ替えて配置されることに注意。",
      },
    },
    {
      id: "balancers",
      name: { zh: "安寧者們", ja: "安寧者たち", en: "Balancers" },
      bossName: { zh: "救贖的旗手 安寧護器之女、哈爾摩妮亞", ja: "救いの旗手 安寧護器の娘たち、ハルモニア", en: "Herald of Salvation, Harmonia" },
      bossId: "harmonia",
      relicName: { zh: "安寧者的遺志", ja: "安寧者の遺志", en: "Will of the Balancers" },
      start: { suit: "D", rank: "A" },
      end: { suit: "H", rank: "A" },
      fixedLayout: true,
      day1: [
        { pos: 1, suit: "H", rank: "5", name: { zh: "崖上遺跡（血）", ja: "崖上の遺跡（血）", en: "Cliffside Ruins (Blood)" } },
        { pos: 2, suit: "S", rank: "7", name: { zh: "倒下的大結晶", ja: "倒れた大結晶", en: "Fallen Great Crystal" } },
        { pos: 3, suit: "H", rank: "J", name: { zh: "西方地下砦", ja: "西の地下砦", en: "Western Underground Fort" } },
        { pos: 4, suit: "H", rank: "K", name: { zh: "教會（大空洞）", ja: "教会（大空洞）", en: "Church (Great Cavern)" } },
        { pos: 5, suit: "C", rank: "Q", name: { zh: "大結晶", ja: "大結晶", en: "Great Crystal" } },
        { pos: 6, suit: "D", rank: "9", name: { zh: "神殿", ja: "神殿", en: "Temple" } },
        { pos: 7, suit: "D", rank: "2", name: { zh: "水邊的大教會", ja: "水辺の大教会", en: "Waterside Cathedral" } },
        { pos: 8, suit: "D", rank: "J", name: { zh: "東方地下砦", ja: "東の地下砦", en: "Eastern Underground Fort" } },
        { pos: 9, suit: "S", rank: "K", name: { zh: "教會（大空洞）", ja: "教会（大空洞）", en: "Church (Great Cavern)" } },
      ],
      day2: [
        { pos: 1, suit: "H", rank: "2", name: { zh: "丘上遺跡", ja: "丘の上の遺跡", en: "Hilltop Ruins" } },
        { pos: 2, suit: "S", rank: "10", name: { zh: "魔術師之塔", ja: "魔術師塔", en: "Sorcerer's Tower" } },
        { pos: 3, suit: "C", rank: "5", name: { zh: "下層遺跡", ja: "下層の遺跡", en: "Lower Ruins" } },
        { pos: 4, suit: "C", rank: "K", name: { zh: "教會（大空洞）", ja: "教会（大空洞）", en: "Church (Great Cavern)" } },
      ],
      note: {
        zh: "此副本為固定配置，1日目卡片需依原書圖示的位置配置（版面：上排7-8-9／中排4-S-5-E-6／下排1-2-3）。2日目僅可置換4張卡，中間第5格「大結晶」（Q♣）不可被置換。",
        ja: "この副本は固定配置。1日目のカードは原書の図の通りに配置すること（レイアウト：上段7-8-9／中段4-S-5-E-6／下段1-2-3）。2日目は4枚のみ入れ替え可能で、中央5番目の「大結晶」（Q♣）は入れ替え不可。",
      },
    },
    {
      id: "dreglord",
      name: { zh: "瓦礫之王", ja: "瓦礫の王", en: "Dreglord" },
      bossName: { zh: "反叛的斯特拉格達斯（衝動）", ja: "反逆のストラグダス（衝動）", en: "Rebellious Stagumadus (Impulse)" },
      bossId: "stragedes",
      relicName: { zh: "瓦礫之夜", ja: "瓦礫の夜", en: "Night of Rubble" },
      start: { suit: "C", rank: "A" },
      end: { suit: "S", rank: "A" },
      fixedLayout: true,
      day1: [
        { pos: 1, suit: "D", rank: "K", name: { zh: "教會（大空洞）", ja: "教会（大空洞）", en: "Church (Great Cavern)" } },
        { pos: 2, suit: "S", rank: "7", name: { zh: "倒下的大結晶", ja: "倒れた大結晶", en: "Fallen Great Crystal" } },
        { pos: 3, suit: "C", rank: "2", name: { zh: "水邊的大教會", ja: "水辺の大教会", en: "Waterside Cathedral" } },
        { pos: 4, suit: "D", rank: "5", name: { zh: "下層遺跡", ja: "下層の遺跡", en: "Lower Ruins" } },
        { pos: 5, suit: "C", rank: "Q", name: { zh: "大結晶", ja: "大結晶", en: "Great Crystal" } },
        { pos: 6, suit: "S", rank: "J", name: { zh: "西方地下砦", ja: "西の地下砦", en: "Western Underground Fort" } },
        { pos: 7, suit: "C", rank: "J", name: { zh: "東方地下砦", ja: "東の地下砦", en: "Eastern Underground Fort" } },
        { pos: 8, suit: "S", rank: "9", name: { zh: "神殿", ja: "神殿", en: "Temple" } },
        { pos: 9, suit: "S", rank: "K", name: { zh: "教會（大空洞）", ja: "教会（大空洞）", en: "Church (Great Cavern)" } },
      ],
      day2: [
        { pos: 1, suit: "S", rank: "2", name: { zh: "丘上遺跡", ja: "丘の上の遺跡", en: "Hilltop Ruins" } },
        { pos: 2, suit: "C", rank: "10", name: { zh: "魔術師之塔", ja: "魔術師塔", en: "Sorcerer's Tower" } },
        { pos: 3, suit: "S", rank: "5", name: { zh: "崖上遺跡(毒)", ja: "崖上の遺跡(毒)", en: "Cliffside Ruins (Poison)" } },
        { pos: 4, suit: "C", rank: "K", name: { zh: "教會（大空洞）", ja: "教会（大空洞）", en: "Church (Great Cavern)" } },
      ],
      note: {
        zh: "此副本為固定配置，1日目卡片需依原書圖示的位置配置（版面：上排7-8-9／中排4-S-5-E-6／下排1-2-3）。2日目僅可置換4張卡，中間第5格「大結晶」（Q♣）不可被置換。",
        ja: "この副本は固定配置。1日目のカードは原書の図の通りに配置すること（レイアウト：上段7-8-9／中段4-S-5-E-6／下段1-2-3）。2日目は4枚のみ入れ替え可能で、中央5番目の「大結晶」（Q♣）は入れ替え不可。",
      },
    },
    {
      id: "night_aspect",
      name: { zh: "夜之側影", ja: "夜を衆る者", en: "Night Aspect" },
      bossName: { zh: "夜之輪廓、夜之奧梅雷斯", ja: "夜の輪郭、夜のオメレス", en: "Night's Outline, Night Aspect Omerus" },
      // night_boss_rulebook.jsのid（"nameless"）と対応。ただしnight_bosses.js（管理画面の
      // 選択肢・画像）には現時点でnameless用の画像/エントリが無い（要素材追加、別途対応）。
      bossId: "nameless",
      relicName: { zh: "王之夜", ja: "王の夜", en: "Night of the King" },
      start: { suit: "S", rank: "A" },
      end: { suit: "H", rank: "A" },
      day1: [
        { pos: 1, suit: "H", rank: "2", name: { zh: "大教會（隨機）", ja: "大教会（ランダム）", en: "Grand Cathedral (Random)" } },
        { pos: 2, suit: "D", rank: "3", name: { zh: "小塔（隨機）", ja: "小塔（ランダム）", en: "Small Tower (Random)" } },
        { pos: 3, suit: "S", rank: "5", name: { zh: "遺跡（隨機）", ja: "遺跡（ランダム）", en: "Ruins (Random)" } },
        { pos: 4, suit: "C", rank: "6", name: { zh: "坑道（隨機）", ja: "坑道（ランダム）", en: "Tunnel (Random)" } },
        { pos: 5, suit: "C", rank: "7", name: { zh: "沼澤（隨機）", ja: "沼沢（ランダム）", en: "Marsh (Random)" } },
        { pos: 6, suit: "D", rank: "8", name: { zh: "鍛造村（隨機）", ja: "鍛冶村（ランダム）", en: "Smithing Village (Random)" } },
        { pos: 7, suit: "S", rank: "9", name: { zh: "封牢（隨機）", ja: "封牢（ランダム）", en: "Sealed Prison (Random)" } },
        { pos: 8, suit: "H", rank: "10", name: { zh: "魔術師之塔", ja: "魔術師塔", en: "Sorcerer's Tower" } },
        { pos: 9, suit: "C", rank: "J", name: { zh: "砦（隨機）", ja: "砦（ランダム）", en: "Fort (Random)" } },
      ],
      day2: [
        { pos: 1, suit: "H", rank: "9", name: { zh: "封牢（隨機）", ja: "封牢（ランダム）", en: "Sealed Prison (Random)" } },
        { pos: 2, suit: "S", rank: "Q", terrain: true, name: { zh: "地變｜火口(上層)", ja: "地変｜火口(上層)", en: "Terrain Shift｜Crater (Upper)" } },
        { pos: 3, suit: "D", rank: "Q", terrain: true, name: { zh: "地變｜火口(空洞內)", ja: "地変｜火口(空洞内)", en: "Terrain Shift｜Crater (Cavern)" } },
        { pos: 4, suit: "C", rank: "Q", terrain: true, name: { zh: "地變｜火口(最深處)", ja: "地変｜火口(最奥)", en: "Terrain Shift｜Crater (Depths)" } },
        { pos: 5, suit: "S", rank: "K", name: { zh: "教會", ja: "教会", en: "Church" } },
        { pos: 6, suit: "D", rank: "K", name: { zh: "教會", ja: "教会", en: "Church" } },
      ],
      note: {
        zh: "「地變」（135頁）會自動與場地列5的3張卡置換配置，無須另外抽選。",
        ja: "「地変」（135頁）は、自動的にフィールドライン5の3枚と入れ替えて配置されることに注意。",
      },
    },
  ];

  // --- 管理員が自由編輯できる自訂副本（localStorage 保存、ビルド時の固定データとは別枠） ---
  var CUSTOM_KEY = "pritest-custom-scenarios";
  var SLOT_COUNT = 9;

  function loadCustomScenarios() {
    var raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    try {
      var data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function saveCustomScenarios(scenarios) {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(scenarios));
  }

  function emptyCard() {
    return { suit: "S", rank: "A", name: { zh: "", ja: "" } };
  }

  function newScenario() {
    return {
      id: "custom" + Date.now() + Math.floor(Math.random() * 1000),
      custom: true,
      name: { zh: "", ja: "" },
      start: { suit: "S", rank: "A" },
      end: { suit: "S", rank: "A" },
      day1: Array.from({ length: SLOT_COUNT }, emptyCard),
      day2: Array.from({ length: 6 }, emptyCard),
    };
  }

  function createScenario() {
    var customs = loadCustomScenarios();
    var s = newScenario();
    customs.push(s);
    saveCustomScenarios(customs);
    return s;
  }

  function updateScenario(id, patch) {
    var customs = loadCustomScenarios();
    var s = customs.filter(function (c) {
      return c.id === id;
    })[0];
    if (!s) return null;
    Object.keys(patch).forEach(function (key) {
      s[key] = patch[key];
    });
    saveCustomScenarios(customs);
    return s;
  }

  function deleteScenario(id) {
    saveCustomScenarios(
      loadCustomScenarios().filter(function (c) {
        return c.id !== id;
      })
    );
  }

  function isCustom(id) {
    return !SCENARIOS.some(function (s) {
      return s.id === id;
    });
  }

  function list() {
    return SCENARIOS.concat(loadCustomScenarios());
  }

  function localizedName(nameObj) {
    var lang = window.I18N ? window.I18N.getLang() : "zh";
    return nameObj[lang] || nameObj.zh || nameObj.ja || nameObj.en;
  }

  function get(id) {
    return (
      list().filter(function (s) {
        return s.id === id;
      })[0] || null
    );
  }

  // 規則書の「劇本N」表記（1〜10）に対応する番号。SCENARIOS配列の並び順＝規則書の
  // 劇本番号順（ユーザー確認済み、2026-08-11：gaping_jawをtricephalosの直後へ並び替え済み）。
  // 自訂副本（custom scenario）は規則書上の番号を持たないためnull。
  function numberForId(id) {
    for (var i = 0; i < SCENARIOS.length; i++) {
      if (SCENARIOS[i].id === id) return i + 1;
    }
    return null;
  }

  // dayKey: "day1" | "day2" 上の該当カードの情報（あれば）を返す
  function findCardEffect(scenarioId, dayKey, suit, rank) {
    var scenario = get(scenarioId);
    if (!scenario) return null;
    var rows = scenario[dayKey] || [];
    return (
      rows.filter(function (r) {
        return r.suit === suit && r.rank === rank;
      })[0] || null
    );
  }

  window.PriTestScenarios = {
    list: list,
    get: get,
    numberForId: numberForId,
    findCardEffect: findCardEffect,
    localizedName: localizedName,
    createScenario: createScenario,
    updateScenario: updateScenario,
    deleteScenario: deleteScenario,
    isCustom: isCustom,
    SLOT_COUNT: SLOT_COUNT,
  };
})();
