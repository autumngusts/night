// 射彈宇宙（shedan）：遺物 100 件、套裝 10 種、異常訊號 8 則（規則文件 §9、§10、§10.1、§11.1）。
// 每件遺物＝標籤＋稀有度＋要加進 mods 的值；D.computeMods(ids) 把持有的遺物與達成的套裝加總成一個 mods 物件，
// 戰鬥（shedan_combat.js）、物理、遠征（shedan_run.js）都只讀 mods，不為單一遺物寫獨立流程。
// mods 規則：數字相加、true 取「有任一件就成立」。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestShedanData || (typeof require === "function" ? require("./shedan_data.js") : null);
  var C3 = D.C3;

  var TAGS = ["burst", "gravity", "bounce", "friend", "star", "ghost", "reaction", "skill", "debris", "guard"];
  var TAG_NAMES = {
    burst: C3("爆裂", "爆裂", "Burst"), gravity: C3("引力", "引力", "Gravity"), bounce: C3("反彈", "反射", "Bounce"),
    friend: C3("友情", "友情", "Friendship"), star: C3("星座", "星座", "Constellation"), ghost: C3("殘影", "残影", "Afterimage"),
    reaction: C3("反應", "反応", "Reaction"), skill: C3("技能", "スキル", "Skill"), debris: C3("碎片", "破片", "Debris"),
    guard: C3("守護", "守護", "Guard")
  };

  // [id, zh, ja, en, tags, rarity(c/r/l), mods, 效果說明 zh]
  var ROWS = [
    // ---- 爆裂 ----
    ["fuse", "引信強化", "信管強化", "Fuse Booster", ["burst"], "r", { chainDmg: 0.2 }, "連爆傷害 +20%"],
    ["detonator_chain", "連鎖雷管", "連鎖雷管", "Chain Detonator", ["burst"], "c", { chainGauge: true }, "連爆達 3 層時全隊量表 +3（每發一次）"],
    ["critical_reactor", "臨界反應爐", "臨界反応炉", "Critical Reactor", ["burst", "reaction"], "r", { reactRadius: 0.25 }, "反應爆炸半徑 +25%"],
    ["unstable_core", "不穩定核心", "不安定コア", "Unstable Core", ["burst"], "c", { dmgAll: 0.3, unstable: true }, "全部傷害 +30%，但敵人倒數 −1（最低 1）"],
    ["ground_zero", "爆心標定器", "爆心標定器", "Ground Zero Marker", ["burst"], "c", { firstChainRadius: true }, "每場第一次連爆半徑 ×2"],
    ["shockwave", "衝擊波發生器", "衝撃波発生器", "Shockwave Emitter", ["burst"], "c", { shockwave: true }, "在爆炸範圍內的射出者加速 ×1.15"],
    ["warhead", "誘爆彈頭", "誘爆弾頭", "Detonation Warhead", ["burst"], "c", { warhead: true }, "小型敵人的連爆傷害至少為射出者攻 ×1.5"],
    ["fireworks", "煙火庫", "花火庫", "Fireworks Cache", ["burst"], "l", { fireworks: true }, "每回合第一次連爆時追加 3 發追蹤彈（攻 ×0.5）"],
    ["blast_shards", "爆裂碎片", "爆裂破片", "Blast Shards", ["burst", "debris"], "r", { rockBlast: true }, "爆炸範圍內的小行星立即碎裂"],
    // ---- 引力 ----
    ["micro_singularity", "微型奇點", "微小特異点", "Micro Singularity", ["gravity"], "r", { startWell: true }, "每場開始時隨機位置產生 1 座引力井"],
    ["gravity_anchor", "重力錨", "重力アンカー", "Gravity Anchor", ["gravity"], "c", { anchor: true }, "射出者停止時，120 內敵人被拉近 25%"],
    ["tidal_lock", "潮汐鎖定", "潮汐ロック", "Tidal Lock", ["gravity"], "r", { tidalLock: true }, "本發被拉動過的敵人受傷 +20%"],
    ["slingshot", "彎曲推進器", "スイングバイ推進器", "Slingshot Thruster", ["gravity"], "c", { wellSpeed: true }, "每發第一次進入某座引力井時速度 ×1.1"],
    ["convergence", "聚合場", "収束場", "Convergence Field", ["gravity"], "c", { converge: true }, "敵人回合結束時全部敵人往中心靠攏 30"],
    ["hole_seed", "黑洞種子", "ブラックホールの種", "Black Hole Seed", ["gravity"], "l", { holeSeed: true }, "第 3 回合時在被撞最多的敵人位置產生黑洞"],
    ["mass_amp", "質量增幅器", "質量増幅器", "Mass Amplifier", ["gravity"], "c", { heavyDmg: 0.25 }, "重量 ≥ 1.3 的角色撞擊傷害 +25%"],
    ["accretion", "吸積盤", "降着円盤", "Accretion Disk", ["gravity", "debris"], "r", { debrisWell: true }, "引力井對碎片的力 ×2"],
    ["horizon_scope", "視界觀測儀", "事象観測儀", "Horizon Scope", ["gravity", "star"], "c", { wellStar: true }, "引力井中心視為星點"],
    // ---- 反彈 ----
    ["spring", "彈射彈簧", "射出スプリング", "Launch Spring", ["bounce"], "c", { restitution: 0.05 }, "射出者彈性 +0.05"],
    ["edged_armor", "稜角裝甲", "稜角装甲", "Edged Plating", ["bounce"], "r", { wallAoe: true }, "撞牆時對 60 內敵人造成攻 ×0.3"],
    ["spin_recorder", "迴旋紀錄器", "回旋記録器", "Spin Recorder", ["bounce"], "l", { wallRecorder: true }, "本發撞牆 ≥ 10 次時，結束時全體攻 ×1.0"],
    ["accel_ring", "加速環", "加速リング", "Accelerator Ring", ["bounce"], "c", { speedMult: 0.1 }, "射出速度 +10%"],
    ["elastic_film", "彈性膜", "弾性膜", "Elastic Film", ["bounce"], "c", { elastic: true }, "撞到敵人時的減速降低 30%"],
    ["corner_hunter", "角落獵人", "コーナーハンター", "Corner Hunter", ["bounce"], "r", { cornerHunter: true }, "角落 80 內撞牆時 Hit +2"],
    ["ricochet_calc", "跳彈計算機", "跳弾計算機", "Ricochet Computer", ["bounce"], "c", { bounceAim: true }, "瞄準線顯示第一次反彈"],
    ["resonant_wall", "共振牆", "共振ウォール", "Resonant Walls", ["bounce"], "r", { wallResonance: true }, "撞牆每 5 次全體電擊（攻 ×0.5）"],
    ["mirror_coat", "鏡面塗層", "鏡面コーティング", "Mirror Coating", ["bounce", "guard"], "c", { wallHeal: true }, "撞牆時回復隊伍 HP 0.3%"],
    // ---- 友情 ----
    ["squad_comm", "編隊通訊器", "編隊通信機", "Squad Comms", ["friend"], "r", { friendDmg: 0.25 }, "友情技傷害 +25%"],
    ["bond_circuit", "羈絆電路", "絆回路", "Bond Circuit", ["friend"], "c", { friendGauge: true }, "觸發友情技時射出者量表 +2"],
    ["life_pod", "救生艙", "救命ポッド", "Life Pod", ["friend", "guard"], "l", { lifePod: true }, "每局一次，HP 歸零時以 30% 復活"],
    ["resonance_antenna", "共振天線", "共振アンテナ", "Resonance Antenna", ["friend", "star"], "c", { allyStar: true }, "停住的隊友位置也算星點"],
    ["formation_magnet", "隊形磁鐵", "隊形マグネット", "Formation Magnet", ["friend"], "c", { allyMagnet: true }, "射出者靠近隊友時被吸引"],
    ["relay_thruster", "接力推進", "リレー推進", "Relay Thruster", ["friend"], "r", { relay: true }, "觸發友情技時射出者速度 ×1.2"],
    ["union_signal", "合體訊號", "合体シグナル", "Union Signal", ["friend"], "l", { union: true }, "同一發觸發 3 次友情技時全體攻 ×2"],
    ["kin_resonance", "同屬性共鳴", "同属性共鳴", "Kindred Resonance", ["friend", "reaction"], "r", { friendMark: true }, "友情技附加該隊友的屬性印記"],
    ["backup_drone", "後援無人機", "支援ドローン", "Backup Drone", ["friend"], "c", { backupDrone: true }, "每場第一發額外觸發一次隨機隊員的友情技"],
    // ---- 星座 ----
    ["star_chart", "星圖", "星図", "Star Chart", ["star"], "c", { starRadius: 0.5 }, "星點判定半徑 +50%"],
    ["stargazer", "觀星鏡", "天体望遠鏡", "Stargazer Lens", ["star"], "c", { stargazer: true }, "顯示星點編號與預測連線"],
    ["zodiac", "黃道儀", "黄道儀", "Zodiac Engine", ["star"], "r", { meteorExtra: 3 }, "三角座隕石 +3 顆"],
    ["polaris", "北極星", "北極星", "Polaris", ["star"], "c", { firstShotStar: true }, "每場第一發的星座點亮數 +1"],
    ["starlight_jar", "星光收集瓶", "星明かりの瓶", "Starlight Jar", ["star"], "c", { starGauge: true }, "點亮星點時射出者量表 +1"],
    ["nova_marker", "新星標記", "新星マーカー", "Nova Marker", ["star"], "c", { novaStar: true }, "擊破時 30% 在原地產生星點"],
    ["celestial_globe", "天球儀", "天球儀", "Celestial Globe", ["star"], "r", { arkCharges: 1 }, "方舟座的護盾可以擋 2 次"],
    ["wish_star", "流星許願", "流れ星の願い", "Wishing Star", ["star", "guard"], "r", { wishHeal: true }, "完成星座時回復隊伍 HP 5%"],
    ["star_blast", "星座爆破", "星座爆破", "Constellation Blast", ["star", "burst"], "l", { starBlast: true }, "完成星座時每個點亮星點爆炸"],
    // ---- 殘影 ----
    ["ghost_projector", "殘影投影機", "残影プロジェクター", "Afterimage Projector", ["ghost"], "r", { ghostOn: true }, "每一發都重播上一發的軌跡（殘影傷害攻 ×0.5）"],
    ["double_ghost", "雙重殘影", "二重残影", "Double Afterimage", ["ghost"], "l", { ghostTwice: true }, "殘影重播兩次（需要殘影投影機）"],
    ["afterglow_filter", "殘光濾鏡", "残光フィルター", "Afterglow Filter", ["ghost", "reaction"], "c", { ghostMark: true }, "殘影附加射出者的屬性印記"],
    ["stasis_chip", "時滯晶片", "時滞チップ", "Stasis Chip", ["ghost", "bounce"], "c", { ghostAirless: true }, "殘影存在期間射出者不減速"],
    ["ghost_expand", "殘影擴張", "残影拡張", "Afterimage Expander", ["ghost"], "c", { ghostRadius: 0.5 }, "殘影半徑 ×1.5"],
    ["memory_crystal", "記憶結晶", "記憶結晶", "Memory Crystal", ["ghost"], "r", { ghostMemory: true }, "殘影改為重播本場 Hit 最多的一發"],
    ["phantom_crew", "幽靈隊員", "幽霊隊員", "Phantom Crew", ["ghost", "friend"], "r", { ghostAlly: true }, "殘影撞到隊友也觸發友情技（每發一次）"],
    ["rewind_timer", "回溯計時器", "巻き戻しタイマー", "Rewind Timer", ["ghost"], "c", { ghostKillGauge: true }, "殘影擊破時射出者量表 +2"],
    ["ghost_harvest", "殘影收穫", "残影の収穫", "Afterimage Harvest", ["ghost"], "c", { ghostHit: true }, "殘影計入 Hit 數"],
    // ---- 反應 ----
    ["catalyst", "反應催化劑", "反応触媒", "Reaction Catalyst", ["reaction"], "c", { reactionDmg: 0.2 }, "反應傷害 +20%"],
    ["double_mark", "雙印記", "二重印", "Double Mark", ["reaction"], "l", { doubleMark: true }, "觸發反應後仍留下這一發的印記"],
    ["steam_valve", "蒸氣閥", "蒸気バルブ", "Steam Valve", ["reaction"], "r", { steamRadius: 0.4 }, "蒸氣爆半徑 +40%"],
    ["supercoil", "超導線圈", "超伝導コイル", "Superconducting Coil", ["reaction"], "c", { superLong: true }, "超導持續到下一個敵人回合結束"],
    ["ion_condenser", "電離濃縮", "電離濃縮", "Ion Condenser", ["reaction"], "c", { ionTurns: 1 }, "電離雲持續 +1 回合"],
    ["wildfire_seed", "燎原火種", "燎原の火種", "Wildfire Seed", ["reaction"], "c", { wildfireRadius: 0.5, wildfireBurn: 0.5 }, "燎原範圍 +50%、灼燒傷害 +50%"],
    ["annihilation_lens", "湮滅透鏡", "対消滅レンズ", "Annihilation Lens", ["reaction"], "r", { annihilateDmg: 1 }, "湮滅傷害 +100%"],
    ["collapse_tuner", "坍縮校準", "崩縮チューナー", "Collapse Tuner", ["reaction", "gravity"], "r", { collapsePull: 0.5 }, "坍縮吸引範圍 +50%"],
    ["tuning_fork", "共鳴音叉", "共鳴音叉", "Resonance Fork", ["reaction"], "c", { resonanceDmg: 1 }, "共鳴爆炸傷害 ×2"],
    // ---- 技能 ----
    ["coolant", "冷卻劑", "冷却剤", "Coolant", ["skill"], "c", { gaugeMaxMinus: 3 }, "技能量表上限 −3"],
    ["charged_cell", "充能電池", "充電セル", "Charged Cell", ["skill"], "c", { startGauge: 5 }, "每場開始全隊量表 +5"],
    ["skill_circuit", "技能迴路", "スキル回路", "Skill Circuit", ["skill"], "c", { skillShotDmg: 0.2 }, "發動技能的那一發傷害 +20%"],
    ["overflow_store", "溢流儲存", "オーバーフロー貯蔵", "Overflow Storage", ["skill"], "r", { overflow: true }, "量表可超出上限最多 10"],
    ["emergency_oc", "緊急超頻", "緊急オーバークロック", "Emergency Overclock", ["skill", "guard"], "r", { emergency: true }, "HP 低於 30% 時全隊量表充滿（每場一次）"],
    ["kill_charger", "擊破充能", "撃破チャージ", "Kill Charger", ["skill"], "c", { killGauge: true }, "擊破敵人時射出者量表 +1"],
    ["tactical_sync", "戰術同步", "戦術同期", "Tactical Sync", ["skill", "friend"], "r", { tacticalSync: true }, "技能那一發觸發友情技時，該隊友量表 +3"],
    ["two_stage", "二段技能", "二段スキル", "Two-Stage Skill", ["skill"], "l", { twoStage: true }, "每場一次，技能後量表回到 50%"],
    ["commander_badge", "指揮官徽章", "指揮官徽章", "Commander Badge", ["skill"], "c", { leaderSkill: 0.3 }, "隊長發動技能的那一發傷害 +30%"],
    // ---- 碎片 ----
    ["debris_collector", "碎片收集器", "破片コレクター", "Debris Collector", ["debris"], "c", { debrisExtra: 2 }, "小行星碎片 +2"],
    ["ore_rail", "礦石磁軌", "鉱石レール", "Ore Rail", ["debris"], "c", { debrisLife: 4 }, "碎片存在時間 +4 秒"],
    ["hardened_shards", "硬化碎片", "硬化破片", "Hardened Shards", ["debris"], "c", { debrisMinSpeed: -3 }, "碎片傷害門檻速度 6 → 3"],
    ["asteroid_tow", "小行星牽引", "小惑星牽引", "Asteroid Tow", ["debris"], "c", { rockPull: true }, "每回合開始補 1 顆小行星（最多 4）"],
    ["brittle_ray", "脆化射線", "脆化光線", "Brittle Ray", ["debris"], "c", { rockFragile: true }, "小行星耐久 3 → 1"],
    ["element_ore", "屬性礦晶", "属性鉱晶", "Elemental Ore", ["debris", "reaction"], "c", { debrisMark: true }, "碎片附加射出者屬性印記"],
    ["meteor_hull", "隕鐵外殼", "隕鉄外殻", "Meteoric Hull", ["debris", "guard"], "r", { meteorArmor: true }, "每有 1 顆小行星，受傷 −5%（上限 −20%）"],
    ["shard_storm", "碎片風暴", "破片の嵐", "Shard Storm", ["debris"], "r", { debrisHit: 2 }, "碎片計入 Hit 時 Hit +2"],
    ["impact_drill", "撞擊鑽頭", "衝撃ドリル", "Impact Drill", ["debris"], "l", { drill: true }, "本發每撞碎 1 顆小行星傷害 +15%"],
    // ---- 守護 ----
    ["reinforced_hull", "強化外殼", "強化外殻", "Reinforced Hull", ["guard"], "c", { hpMaxMult: 0.15 }, "隊伍 HP 上限 +15%"],
    ["repair_nanites", "修補奈米", "修復ナノマシン", "Repair Nanites", ["guard"], "c", { healOnWin: 0.05 }, "戰鬥勝利回復 HP 5%"],
    ["deflector", "偏轉護盾", "偏向シールド", "Deflector", ["guard"], "r", { deflector: true }, "每場第一次受傷無效"],
    ["regen_armor", "再生裝甲", "再生装甲", "Regenerative Armor", ["guard"], "c", { regen: true }, "每回合結束回復 HP 1%"],
    ["cushion", "緩衝氣墊", "緩衝エアクッション", "Shock Cushion", ["guard"], "c", { cushion: true }, "單次受傷上限為最大 HP 的 25%"],
    ["taunt_beacon", "嘲諷信標", "挑発ビーコン", "Taunt Beacon", ["guard"], "c", { taunt: true }, "敵人攻擊 20% 落空"],
    ["med_pod", "應急醫療艙", "応急医療ポッド", "Emergency Med Pod", ["guard"], "c", { restBonus: 0.5 }, "休息的回復量 +50%"],
    ["counter_armor", "反擊裝甲", "反撃装甲", "Counter Armor", ["guard", "burst"], "r", { counter: true }, "受到攻擊時攻擊者受到隊伍平均攻擊力"],
    ["time_buffer", "時間緩衝", "時間バッファ", "Time Buffer", ["guard"], "c", { timeBuffer: true }, "每場開始全部敵人倒數 +1"],
    // ---- 無標籤 ----
    ["energy_cell", "能源電池", "エネルギー電池", "Energy Cell", [], "c", { energyMult: 0.2 }, "戰後能源 +20%"],
    ["element_lens", "屬性透鏡", "属性レンズ", "Elemental Lens", [], "r", { weakMultAdd: 0.3 }, "弱點倍率 1.5 → 1.8"],
    ["stardust_absorber", "星塵吸收器", "星塵吸収器", "Stardust Absorber", [], "c", { stardustMult: 0.2 }, "本局結束時星塵 +20%"],
    ["merchant_card", "商人會員卡", "商人会員証", "Merchant Card", [], "c", { shopMult: -0.2 }, "補給站價格 −20%"],
    ["scan_radar", "探測雷達", "探査レーダー", "Scan Radar", [], "c", { radar: true }, "地圖上顯示兩層以後的節點種類"],
    ["drifter_beacon", "漂流者信號器", "漂流者ビーコン", "Drifter Beacon", [], "c", { drifterBoost: true }, "之後的星區漂流者節點 ×2"],
    ["lucky_die", "幸運骰", "幸運のダイス", "Lucky Die", [], "r", { rewardChoices: 1 }, "戰後遺物選項 3 → 4"],
    ["elite_bounty", "精英賞金", "精鋭懸賞金", "Elite Bounty", [], "c", { eliteBounty: 50 }, "擊敗精英時能源 +50"],
    ["stable_thruster", "穩定推進器", "安定スラスター", "Stable Thruster", [], "c", { pullMax: 0.15 }, "力道上限 100% → 115%"],
    ["scavenger_hand", "拾荒者之手", "スカベンジャーの手", "Scavenger's Hand", [], "c", { scavenger: true }, "異常訊號的 HP 損失減半"]
  ];

  var RAR = { c: "common", r: "rare", l: "legendary" };
  var RELICS = ROWS.map(function (r) {
    return { id: r[0], name: C3(r[1], r[2], r[3]), tags: r[4], rarity: RAR[r[5]], mods: r[6], desc: r[7], requires: r[0] === "double_ghost" ? "ghost_projector" : null };
  });
  var RELIC_BY_ID = {};
  RELICS.forEach(function (x) { RELIC_BY_ID[x.id] = x; });

  // ---------------- 套裝（§9）：同標籤 3／5 件 ----------------
  var SETS = {
    burst: { t3: { chainRadius: 0.3 }, t5: { chainDepthBoost: 0.15 }, d3: "連爆半徑 +30%", d5: "連爆每層傷害 +15%" },
    gravity: { t3: { wellRadius: 0.3 }, t5: { collapseDmg: 1 }, d3: "引力井範圍 +30%", d5: "坍縮爆炸傷害 ×2" },
    bounce: { t3: { wallHitBonus: 1 }, t5: { afterWallBoost: true }, d3: "撞牆時 Hit +1", d5: "撞牆後下一次撞擊傷害 +50%" },
    friend: { t3: { friendDmg: 0.4 }, t5: { friendTwice: true }, d3: "友情技傷害 +40%", d5: "每位隊友每發可觸發 2 次" },
    star: { t3: { starsExtra: 1 }, t5: { constellationDouble: true }, d3: "每場星點 +1", d5: "星座效果發動 2 次" },
    ghost: { t3: { ghostDmg: 0.3 }, t5: { ghostAlly: true }, d3: "殘影傷害 +30%", d5: "殘影也會觸發友情技" },
    reaction: { t3: { reactionDmg: 0.3 }, t5: { reactionKeep: true }, d3: "反應傷害 +30%", d5: "觸發反應時不消耗印記（每敵每發一次）" },
    skill: { t3: { gaugeMaxMinus: 3 }, t5: { skillRelay: true }, d3: "技能量表上限 −3", d5: "發動技能後，下一位隊員量表 +50%" },
    debris: { t3: { startRocks: 1 }, t5: { debrisDmg: 1 }, d3: "每場開始多 1 顆小行星", d5: "碎片傷害 ×2" },
    guard: { t3: { hpMaxMult: 0.15 }, t5: { guardRound: true }, d3: "隊伍 HP 上限 +15%", d5: "每回合第一次受傷 −40%" }
  };

  function addMods(m, add) {
    Object.keys(add).forEach(function (k) {
      var v = add[k];
      if (typeof v === "boolean") m[k] = m[k] || v;
      else m[k] = (m[k] || 0) + v;
    });
  }
  function tagCounts(ids) {
    var n = {};
    TAGS.forEach(function (t) { n[t] = 0; });
    ids.forEach(function (id) { var r = RELIC_BY_ID[id]; if (r) r.tags.forEach(function (t) { n[t]++; }); });
    return n;
  }
  // 持有的遺物（id 陣列）→ mods（數字相加、旗標 OR），含達成的套裝
  function computeMods(ids) {
    var m = { relics: {} };
    (ids || []).forEach(function (id) {
      var r = RELIC_BY_ID[id];
      if (!r) return;
      m.relics[id] = true;
      addMods(m, r.mods);
    });
    var n = tagCounts(ids || []);
    m.sets = {};
    TAGS.forEach(function (t) {
      if (n[t] >= 3) addMods(m, SETS[t].t3);
      if (n[t] >= 5) addMods(m, SETS[t].t5);
      m.sets[t] = n[t];
    });
    return m;
  }
  function mod(m, k) { return (m && m[k]) || 0; }

  // ---------------- 異常訊號（§11.1） ----------------
  // effect：{energy, hpPct, maxHpPct, relic:"common"|"rare", gamble, fullGauge, cost}
  function ev(id, zh, en, ja, text, aLabel, a, bLabel, b) {
    return { id: id, name: C3(zh, ja, en), text: text, a: { label: aLabel, fx: a }, b: { label: bLabel, fx: b } };
  }
  var EVENTS = [
    ev("supply_pod", "廢棄補給艙", "Derelict Supply Pod", "廃棄補給ポッド",
      C3("一個漂浮的補給艙，外殼還冒著火花。", "漂う補給ポッド。外殻からまだ火花が散っている。", "A drifting supply pod, its hull still sparking."),
      C3("撬開（普通遺物，HP −10%）", "こじ開ける（普通遺物、HP −10%）", "Pry it open (common relic, HP −10%)"), { relic: "common", hpPct: -0.1 },
      C3("離開", "離れる", "Leave"), {}),
    ev("caravan", "流浪商隊", "Wandering Caravan", "流浪の商隊",
      C3("商隊願意用一件珍品換你的能源。", "商隊が珍品とエネルギーの交換を持ちかけてくる。", "A caravan offers a rare curio for your energy."),
      C3("支付 60 能源（稀有遺物）", "60 エネルギー払う（稀少遺物）", "Pay 60 energy (rare relic)"), { cost: 60, relic: "rare" },
      C3("離開", "離れる", "Leave"), {}),
    ev("dust_storm", "星塵風暴", "Stardust Storm", "星塵の嵐",
      C3("前方是一團閃著光的星塵風暴。", "前方に輝く星塵の嵐。", "A glittering stardust storm blocks the way."),
      C3("穿越（能源 +50，HP −15%）", "突っ切る（エネルギー +50、HP −15%）", "Push through (energy +50, HP −15%)"), { energy: 50, hpPct: -0.15 },
      C3("繞道", "迂回する", "Go around"), {}),
    ev("beacon", "古代信標", "Ancient Beacon", "古代の信標",
      C3("一座還在運作的古代信標。", "まだ動いている古代の信標。", "An ancient beacon, still humming."),
      C3("啟動（回復 20% HP）", "起動する（HP 20% 回復）", "Activate (heal 20%)"), { hpPct: 0.2 },
      C3("拆解（能源 +40）", "分解する（エネルギー +40）", "Salvage (energy +40)"), { energy: 40 }),
    ev("crystal", "共鳴水晶", "Resonant Crystal", "共鳴水晶",
      C3("水晶隨著隊員的心跳共鳴。", "水晶が隊員の鼓動に共鳴している。", "The crystal resonates with your crew's heartbeat."),
      C3("觸碰（下一場開場量表全滿）", "触れる（次の戦闘開始時ゲージ満タン）", "Touch it (full gauges next battle)"), { fullGauge: true },
      C3("打碎（能源 +30）", "砕く（エネルギー +30）", "Shatter it (energy +30)"), { energy: 30 }),
    ev("wreck", "漂流殘骸", "Drifting Wreck", "漂流残骸",
      C3("一艘殘骸裡似乎還有東西。", "残骸の中にまだ何かありそうだ。", "Something may still be inside the wreck."),
      C3("搜索（50%：普通遺物／50%：HP −10%）", "探索する（50%：普通遺物／50%：HP −10%）", "Search (50%: common relic / 50%: HP −10%)"), { gamble: true },
      C3("離開", "離れる", "Leave"), {}),
    ev("black_market", "黑市程式", "Black Market Program", "闇市プログラム",
      C3("一段來路不明的強化程式。", "出所不明の強化プログラム。", "An enhancement program of dubious origin."),
      C3("安裝（稀有遺物，最大 HP −10%）", "インストール（稀少遺物、最大 HP −10%）", "Install (rare relic, max HP −10%)"), { relic: "rare", maxHpPct: -0.1 },
      C3("拒絕", "断る", "Refuse"), {}),
    ev("lost_star", "迷途幼星", "Lost Starling", "迷子の幼星",
      C3("一顆迷路的小星星想跟著你們。", "迷子の小さな星がついて来たがっている。", "A lost little star wants to tag along."),
      C3("收留（最大 HP +8%，能源 −20）", "引き取る（最大 HP +8%、エネルギー −20）", "Adopt (max HP +8%, energy −20)"), { maxHpPct: 0.08, cost: 20 },
      C3("離開", "離れる", "Leave"), {})
  ];

  D.TAGS = TAGS;
  D.TAG_NAMES = TAG_NAMES;
  D.RELICS = RELICS;
  D.RELIC_BY_ID = RELIC_BY_ID;
  D.SETS = SETS;
  D.EVENTS = EVENTS;
  D.computeMods = computeMods;
  D.tagCounts = tagCounts;
  D.mod = mod;

  if (typeof module !== "undefined" && module.exports) module.exports = RELICS;
})();
