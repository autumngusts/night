// 繩文帝國（jomon）：「世界」的靜態資料 —— AI 勢力、時代事件、任務、資源儲量設定。
// 規則在 jomon_world.js（勢力成長、外交、事件抉擇、任務判定）與 jomon_core.js（資源儲量、戰鬥）。
// 說明見 docs/jomon_game_design.md §13〜§17。
(function () {
  "use strict";

  function C(ja, zh) {
    return { ja: ja, zh: zh };
  }

  // ---------------- 資源儲量（使用者採用的提案 4：資源會枯竭、要擴張領地） ----------------
  // 每個資源點的儲量＝base × richness × 時代容量倍率；木材與獵物（非水田的食物）會再生，石材與金不會。
  // 儲量用完時，該資源採集效率剩 DEPLETED_EFF（要走很遠才找得到）。家鄉的 richness＝1。
  var DEPOSITS = {
    food: { base: 12000, regen: 5, label: C("獲物・木の実", "獵物與果實") },
    wood: { base: 30000, regen: 9, label: C("森", "森林") },
    stone: { base: 18000, regen: 0, label: C("石切り場", "採石場") },
    gold: { base: 14000, regen: 0, label: C("金山", "金山") },
  };
  var DEPLETED_EFF = 0.35;

  // ---------------- AI 勢力（使用者採用的提案 6） ----------------
  // angle：在地圖上的方向（x = cos、z = sin；北方是 −z）；mix：軍隊編成權重；appearAge：哪個時代開始登場
  // territory：滅國後併入的領地
  var FACTIONS = [
    {
      id: "yamabito", icon: "⛰️", color: 0x6d4c41, angle: -Math.PI / 2, dist: 110, appearAge: 1,
      name: C("北嶺の山の民", "北嶺山民"),
      desc: C("北の山々に住む狩猟の民。弓と騎馬が得意", "住在北方山中的狩獵之民；擅長弓與騎馬"),
      mix: { spear: 0.8, archer: 1.4, cavalry: 1.3, infantry: 0.6 },
      territory: { resource: "wood", richness: 2, name: C("北嶺の森", "北嶺之森") },
    },
    {
      id: "nishi", icon: "🏯", color: 0x8e44ad, angle: Math.PI, dist: 130, appearAge: 1,
      name: C("西の豪族連合", "西方豪族聯盟"),
      desc: C("西の平野を治める豪族たち。槍と剣の歩兵が中心", "治理西方平原的豪族們；以槍與劍的步兵為主"),
      mix: { spear: 1.3, infantry: 1.3, archer: 0.8, cavalry: 0.7, siege: 0.3 },
      territory: { resource: "stone", richness: 2, name: C("西の石山", "西方石山") },
    },
    {
      id: "minami", icon: "🌊", color: 0x1f77b4, angle: Math.PI / 2, dist: 120, appearAge: 2,
      name: C("南の海の民", "南方海民"),
      desc: C("南の海辺を行き来する民。弓と軽装の兵が多い", "往來南方海邊的人們；弓兵與輕裝步兵多"),
      mix: { archer: 1.4, infantry: 1.2, spear: 0.6 },
      territory: { resource: "food", richness: 2, name: C("南の浜", "南方海濱") },
    },
    {
      id: "shima", icon: "⛵", color: 0x16a085, angle: 0, dist: 160, appearAge: 4,
      name: C("海の彼方の島国", "海外島國"),
      desc: C("海を渡って現れる強国。攻城兵器も持ち込む", "渡海而來的強國；還會帶攻城兵器"),
      mix: { infantry: 1.2, archer: 1.2, cavalry: 0.5, siege: 0.5 },
      territory: { resource: "gold", richness: 2, name: C("島の金山", "島上金山") },
    },
  ];

  // ---------------- 時代事件（使用者採用的提案 7） ----------------
  // 效果描述（jomon_world.js 的 applyEffect 解讀）：
  //   res: { 資源: 秒數 }        ＝得到「目前每秒產量 × 秒數」（至少 30 × 容量倍率）；負數＝失去
  //   cost: { 資源: 秒數 }       ＝支付（付不起的選項不能選）
  //   mods: {...}, dur: 秒       ＝限時加成
  //   villagers / soldiers / houses: 比例（例 -0.02）
  //   deposit: { 資源: 比例 }    ＝目前儲量增減；rich: { 資源: 倍率 } ＝永久增加家鄉儲量倍率
  //   relation: 數值（所有勢力）；truce: 秒（所有勢力停戰）
  //   raid: { mult, delay, name } ＝ delay 秒後來一次大規模襲擊
  //   chance: { p, yes: {...}, no: {...} }
  function E(id, minAge, maxAge, icon, title, desc, choices, once) {
    return { id: id, minAge: minAge, maxAge: maxAge, icon: icon, title: title, desc: desc, choices: choices, once: !!once };
  }
  function O(label, desc, effect) {
    return { label: label, desc: desc, effect: effect };
  }
  var EVENTS = [
    E("hosaku", 0, 8, "🌾", C("豊作", "豐收"), C("今年は実りが多い。どう使う？", "今年收成很好，要怎麼運用？"), [
      O(C("蓄える", "囤積起來"), C("食料＋90 秒分", "食物＋90 秒的產量"), { res: { food: 90 } }),
      O(C("収穫祭", "舉辦收穫祭"), C("食料−20 秒分、3 分間 自然増加 2 倍", "食物−20 秒產量；3 分鐘內自然增加 ×2"), { cost: { food: 20 }, mods: { birth: 1 }, dur: 180 }),
    ]),
    E("umisachi", 0, 8, "🐟", C("大漁", "大漁"), C("川と海に魚の群れが押し寄せた", "河與海湧來大批魚群"), [
      O(C("総出で漁", "全村出動捕魚"), C("食料＋120 秒分、90 秒間 木材−30%", "食物＋120 秒產量；90 秒內木材−30%"), { res: { food: 120 }, mods: { "gather.wood": -0.3 }, dur: 90 }),
      O(C("手の空いた者だけ", "有空的人去就好"), C("食料＋40 秒分", "食物＋40 秒產量"), { res: { food: 40 } }),
    ]),
    E("hyochaku", 0, 3, "🛶", C("漂着した舟", "漂流的小船"), C("見知らぬ人々を乗せた舟が浜に流れ着いた", "載著陌生人的小船漂到了海邊"), [
      O(C("助けて迎え入れる", "救助並接納"), C("食料−20 秒分、村人＋3%", "食物−20 秒產量；村民＋3%"), { cost: { food: 20 }, villagers: 0.03 }),
      O(C("積み荷を奪う", "搶走貨物"), C("木材＋60 秒分、石材＋40 秒分", "木材＋60 秒、石材＋40 秒產量"), { res: { wood: 60, stone: 40 } }),
    ]),
    E("jishin", 0, 8, "🌋", C("地震", "地震"), C("大きな揺れが村を襲った", "強烈的搖晃襲擊了村子"), [
      O(C("すぐに修理", "立刻修繕"), C("木材−40 秒分、石材−30 秒分", "木材−40 秒、石材−30 秒產量"), { cost: { wood: 40, stone: 30 } }),
      O(C("そのままにする", "先不管"), C("住居が 4% 倒壊", "4% 的住居倒塌"), { houses: -0.04 }),
    ]),
    E("kaji", 0, 8, "🔥", C("山火事", "山林大火"), C("村のそばの森が燃えている！", "村子附近的森林著火了！"), [
      O(C("総出で消す", "全村滅火"), C("60 秒間 全資源の採集−25%", "60 秒內所有採集−25%"), { mods: { "gather.all": -0.25 }, dur: 60 }),
      O(C("焼き畑にする", "順勢燒墾"), C("森の埋蔵量−30%、食料＋60 秒分", "森林儲量−30%；食物＋60 秒產量"), { deposit: { wood: -0.3 }, res: { food: 60 } }),
    ]),
    E("shintaku", 0, 8, "⛩️", C("神託", "神諭"), C("巫女が神のお告げを受けた", "巫女得到了神的啟示"), [
      O(C("お告げに従う", "遵從神諭"), C("60%：5 分間 全資源＋25%／40%：2 分間 全資源−10%", "60%：5 分鐘所有資源＋25%／40%：2 分鐘所有資源−10%"), { chance: { p: 0.6, yes: { mods: { "gather.all": 0.25 }, dur: 300 }, no: { mods: { "gather.all": -0.1 }, dur: 120 } } }),
      O(C("聞き流す", "當作沒聽到"), C("何も起きない", "什麼都不會發生"), {}),
    ]),
    E("ooyuki", 0, 8, "❄️", C("大雪", "大雪"), C("例年にない大雪が降り積もった", "下了一場罕見的大雪"), [
      O(C("薪を配る", "分發柴薪"), C("木材−30 秒分", "木材−30 秒產量"), { cost: { wood: 30 } }),
      O(C("耐えしのぐ", "咬牙撐過"), C("3 分間 全資源−15%、行軍＋40%", "3 分鐘所有資源−15%、行軍＋40%"), { mods: { "gather.all": -0.15, travel: 0.4 }, dur: 180 }),
    ]),
    E("toraijin", 1, 5, "📜", C("渡来人の来訪", "渡來人來訪"), C("海の向こうから技術を持つ人々がやって来た", "來自海外、身懷技術的人們到來"), [
      O(C("迎え入れる", "接納他們"), C("村人＋1%、5 分間 研究速度＋30%", "村民＋1%；5 分鐘內研究速度＋30%"), { villagers: 0.01, mods: { researchSpeed: 0.3 }, dur: 300 }),
      O(C("追い返す", "請他們離開"), C("5 分間 防御＋20%", "5 分鐘內防禦＋20%"), { mods: { defense: 0.2 }, dur: 300 }),
    ]),
    E("shokunin", 1, 8, "🔨", C("流れの職人", "流浪工匠"), C("腕のいい職人が仕事を探している", "手藝很好的工匠在找工作"), [
      O(C("雇う", "雇用"), C("食料−40 秒分、5 分間 研究費用−25%", "食物−40 秒產量；5 分鐘內研究費用−25%"), { cost: { food: 40 }, mods: { techCost: -0.25 }, dur: 300 }),
      O(C("断る", "婉拒"), C("何も起きない", "什麼都不會發生"), {}),
    ]),
    E("ekibyo", 2, 8, "🤒", C("疫病", "疫病"), C("村で病が広がり始めた", "疫病開始在村裡擴散"), [
      O(C("病人を隔離", "隔離病人"), C("食料−40 秒分、村人−1%", "食物−40 秒產量；村民−1%"), { cost: { food: 40 }, villagers: -0.01 }),
      O(C("祈祷に頼る", "祈求神明"), C("50%：被害なし／50%：村人−4%", "50%：沒事／50%：村民−4%"), { chance: { p: 0.5, yes: {}, no: { villagers: -0.04 } } }),
    ]),
    E("kinko", 2, 8, "🪙", C("金鉱の発見", "發現金礦"), C("山で新しい金の鉱脈が見つかった", "在山裡發現了新的金礦脈"), [
      O(C("掘り進める", "開採"), C("家の金山の埋蔵量が永久に＋50%", "家鄉金山儲量永久＋50%"), { rich: { gold: 0.5 } }),
      O(C("神に奉納する", "獻給神社"), C("6 分間 全資源＋10%", "6 分鐘內所有資源＋10%"), { mods: { "gather.all": 0.1 }, dur: 360 }),
    ]),
    E("shisetsu", 3, 8, "🎎", C("他国の使節", "他國使節"), C("周りの勢力から使節がやって来た", "周邊勢力派來了使節"), [
      O(C("もてなす", "盛情款待"), C("食料−30 秒分、金−20 秒分、全勢力との関係＋25", "食物−30 秒、金−20 秒產量；與所有勢力關係＋25"), { cost: { food: 30, gold: 20 }, relation: 25 }),
      O(C("追い返す", "驅逐出境"), C("5 分間 全軍の攻撃＋10%、全勢力との関係−15", "5 分鐘內全軍攻擊＋10%；與所有勢力關係−15"), { mods: { "atk.all": 0.1 }, dur: 300, relation: -15 }),
    ]),
    E("ikki", 5, 8, "✊", C("一揆", "一揆"), C("重い年貢に怒った農民が立ち上がった", "不滿重稅的農民起來反抗"), [
      O(C("年貢を減らす", "減輕年貢"), C("食料−60 秒分", "食物−60 秒產量"), { cost: { food: 60 } }),
      O(C("鎮圧する", "鎮壓"), C("兵−3%、村人−2%", "士兵−3%、村民−2%"), { soldiers: -0.03, villagers: -0.02 }),
    ]),
    E("genko", 6, 6, "🐉", C("元寇の知らせ", "元寇來襲的消息"), C("大陸の大軍が海を渡って攻めてくるという", "據說大陸的大軍要渡海來攻"), [
      O(C("海の守りを固める", "加強海防"), C("石材−40 秒分、7 分間 防御＋60%。2 分後に大軍が来る", "石材−40 秒產量；7 分鐘內防禦＋60%。2 分鐘後大軍來襲"), { cost: { stone: 40 }, mods: { defense: 0.6 }, dur: 420, raid: { mult: 2.5, delay: 120, name: C("元の大軍", "元朝大軍") } }),
      O(C("兵の士気を上げる", "鼓舞士氣"), C("7 分間 全軍の攻撃＋25%。2 分後に大軍が来る", "7 分鐘內全軍攻擊＋25%。2 分鐘後大軍來襲"), { mods: { "atk.all": 0.25 }, dur: 420, raid: { mult: 2.5, delay: 120, name: C("元の大軍", "元朝大軍") } }),
    ], true),
    E("nanbansen", 7, 8, "⛵", C("南蛮船の来航", "南蠻船來航"), C("見慣れない大きな船が港に入ってきた", "一艘陌生的大船駛入港口"), [
      O(C("交易する", "與之交易"), C("木材−30 秒分、金＋80 秒分", "木材−30 秒產量；金＋80 秒產量"), { cost: { wood: 30 }, res: { gold: 80 } }),
      O(C("鉄砲を買う", "購買鐵砲"), C("金−40 秒分、5 分間 弓兵の攻撃＋40%", "金−40 秒產量；5 分鐘內弓兵攻擊＋40%"), { cost: { gold: 40 }, mods: { "atk.archer": 0.4 }, dur: 300 }),
    ]),
  ];

  // ---------------- 任務（使用者採用的提案 9：讓開局更快有成就感，之後也一路給目標） ----------------
  // type：houses / pop / tc / techs / conquer（param＝目標 id）/ soldiers / age / paddy / territories /
  //       raidsWon / scouted / peace（簽訂停戰或和約的次數）/ destroyed / wall
  // reward 會 × QUEST_SCALE[任務所屬時代 age]
  var QUEST_SCALE = [1, 3, 8, 20, 40, 80, 160, 300, 500];
  function Q(id, age, type, param, reward) {
    return { id: id, age: age, type: type, param: param, reward: reward };
  }
  var QUESTS = [
    Q("q_house", 0, "houses", 4, { wood: 120 }),
    Q("q_pop20", 0, "pop", 20, { food: 150 }),
    Q("q_tech1", 0, "techs", 1, { food: 200, wood: 100 }),
    Q("q_boar", 0, "conquer", "boar", { food: 250 }),
    Q("q_tc2", 0, "tc", 2, { wood: 200, stone: 100 }),
    Q("q_pop60", 0, "pop", 60, { food: 300, wood: 200 }),
    Q("q_sold10", 0, "soldiers", 10, { food: 200, wood: 200 }),
    Q("q_mura", 0, "conquer", "mura", { food: 300, stone: 200 }),
    Q("q_pop150", 0, "pop", 150, { food: 500, wood: 400, stone: 100 }),
    Q("q_age1", 0, "age", 1, { food: 800, wood: 500 }),
    Q("q_paddy", 1, "paddy", 10, { wood: 300 }),
    Q("q_raid1", 1, "raidsWon", 1, { food: 300, wood: 200 }),
    Q("q_scout", 1, "scouted", 1, { food: 300 }),
    Q("q_terr1", 1, "territories", 1, { stone: 300 }),
    Q("q_age2", 1, "age", 2, { food: 500, wood: 300, stone: 200 }),
    Q("q_wall2", 2, "wall", 2, { stone: 300 }),
    Q("q_peace", 2, "peace", 1, { food: 300, gold: 100 }),
    Q("q_age3", 2, "age", 3, { food: 500, wood: 300, gold: 200 }),
    Q("q_terr3", 3, "territories", 3, { food: 400, stone: 200 }),
    Q("q_tech25", 3, "techs", 25, { food: 400, gold: 200 }),
    Q("q_age4", 3, "age", 4, { food: 500, wood: 300, gold: 300 }),
    Q("q_destroy1", 4, "destroyed", 1, { food: 500, gold: 400 }),
    Q("q_age5", 4, "age", 5, { food: 500, wood: 300, gold: 300 }),
    Q("q_terr6", 5, "territories", 6, { food: 500, stone: 400 }),
    Q("q_age6", 5, "age", 6, { food: 500, wood: 300, gold: 300 }),
    Q("q_destroy2", 6, "destroyed", 2, { food: 500, gold: 500 }),
    Q("q_age7", 6, "age", 7, { food: 500, wood: 300, gold: 300 }),
    Q("q_pop100k", 7, "pop", 100000, { food: 500, gold: 500 }),
    Q("q_destroy4", 7, "destroyed", 4, { food: 800, gold: 800 }),
  ];

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  window.PriTestJomonWorldData = {
    DEPOSITS: DEPOSITS,
    DEPLETED_EFF: DEPLETED_EFF,
    FACTIONS: FACTIONS,
    EVENTS: EVENTS,
    QUESTS: QUESTS,
    QUEST_SCALE: QUEST_SCALE,
    faction: function (id) {
      return byId(FACTIONS, id);
    },
    event: function (id) {
      return byId(EVENTS, id);
    },
    quest: function (id) {
      return byId(QUESTS, id);
    },
  };
})();
