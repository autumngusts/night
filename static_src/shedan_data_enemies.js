// 射彈宇宙（shedan）：敵人 50 種（規則文件 §6、§6.1）＋ Boss 3 隻（§7、§7.1）＋衍生靶（分裂體、殘影、巨蟒身體）。
// trait 是特性鍵，效果在 shedan_combat.js 依鍵分派。
// 基本數值：小 HP 300／攻 25／倒數 2；中 700／40／3；大 1500／70／4；星區 2 ×1.4、星區 3 ×1.9（HP 與攻擊）。個別覆寫在每列最後。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestShedanData || (typeof require === "function" ? require("./shedan_data.js") : null);
  var C3 = D.C3;

  var BASE = { s: { hp: 300, atk: 25, cd: 2 }, m: { hp: 700, atk: 40, cd: 3 }, l: { hp: 1500, atk: 70, cd: 4 } };
  var SECTOR_MULT = { 1: 1, 2: 1.4, 3: 1.9 };

  // [id, sector, zh, ja, en, size, trait, weak[], resist[], 覆寫（套用星區倍率之前）]
  var ROWS = [
    // ---- 星區 1：碎石帶 ----
    ["spore_drifter", 1, "浮游孢子", "浮遊胞子", "Drift Spore", "s", "swarm", ["solar"], [], { hp: 220 }],
    ["rock_worm", 1, "碎岩蟲", "砕岩虫", "Rubble Worm", "m", "", ["plasma"], ["comet"], null],
    ["sentry_drone", 1, "哨衛無人機", "哨戒ドローン", "Sentry Drone", "s", "quick", ["plasma"], [], { cd: 1, atk: 18 }],
    ["shell_turtle", 1, "岩殼龜", "岩殻亀", "Shell Tortoise", "m", "armored", ["gravity"], [], { hp: 800 }],
    ["hop_shrimp", 1, "跳躍蝦", "跳躍エビ", "Hop Shrimp", "s", "hop", ["comet"], [], null],
    ["magnet_imp", 1, "磁石怪", "磁石魔", "Magnet Imp", "m", "magnet", ["nebula"], ["gravity"], null],
    ["ice_crystal", 1, "冰晶體", "氷晶体", "Ice Crystal", "m", "chill", ["solar"], ["comet"], null],
    ["blast_orb", 1, "自爆球", "自爆球", "Blast Orb", "s", "selfDestruct", [], [], { atk: 90, cd: 3 }],
    ["repair_bot", 1, "修復機", "修復機", "Repair Bot", "m", "repair", ["nebula"], [], { hp: 600 }],
    ["shield_guard", 1, "盾衛", "盾衛", "Shield Guard", "m", "shieldAllies", ["nebula"], [], null],
    ["twin_orb", 1, "雙子球", "双子球", "Twin Orb", "s", "linked", ["photon"], [], null],
    ["ore_crawler", 1, "礦脈蠕", "鉱脈ワーム", "Ore Crawler", "l", "", ["solar"], [], { cd: 5 }],
    ["spin_blade", 1, "迴旋刃", "回旋刃", "Spin Blade", "s", "deflect", [], ["photon"], null],
    ["dust_cloud", 1, "塵埃雲", "塵埃雲", "Dust Cloud", "m", "slow", ["solar"], [], { hp: 550 }],
    ["egg_sac", 1, "卵囊", "卵嚢", "Egg Sac", "m", "spawn", ["solar"], [], { hp: 500, atk: 20 }],
    ["scout_mother", 1, "偵察母機", "偵察母機", "Scout Carrier", "l", "summon", ["plasma"], [], { hp: 1300 }],
    // ---- 星區 2：星雲海 ----
    ["nebula_jelly", 2, "星雲水母", "星雲クラゲ", "Nebula Jelly", "m", "aura", ["plasma"], [], null],
    ["mirror_ship", 2, "鏡面艦", "鏡面艦", "Mirror Frigate", "m", "reflect", ["nebula"], ["photon"], null],
    ["splitter", 2, "分裂體", "分裂体", "Splitter", "m", "split", ["solar"], [], null],
    ["volt_eel", 2, "電鰻", "電気ウナギ", "Volt Eel", "m", "shock", ["comet"], ["plasma"], null],
    ["mist_lurker", 2, "霧隱者", "霧隠れ", "Mist Lurker", "m", "phase", ["photon"], [], { hp: 600 }],
    ["parasite_vine", 2, "寄生藤", "寄生蔓", "Parasite Vine", "s", "parasite", ["solar"], [], { atk: 20 }],
    ["acid_sac", 2, "酸液囊", "酸液嚢", "Acid Sac", "m", "acidPool", ["comet"], ["nebula"], null],
    ["nebula_ray", 2, "星雲魟", "星雲エイ", "Nebula Ray", "l", "glide", ["plasma"], [], null],
    ["symbiote_coral", 2, "共生珊瑚", "共生サンゴ", "Symbiote Coral", "l", "protect", ["gravity"], [], { atk: 40, cd: 5 }],
    ["thundercloud", 2, "雷雲", "雷雲", "Thundercloud", "m", "lightning", ["gravity"], ["plasma"], null],
    ["drift_mine", 2, "漂流水雷", "漂流機雷", "Drift Mine", "s", "mine", [], [], { hp: 200 }],
    ["light_eater", 2, "噬光蟲", "光喰い虫", "Light Eater", "s", "absorbLight", ["void"], ["photon"], null],
    ["spore_nest", 2, "孢子母巢", "胞子の母巣", "Spore Nest", "l", "nest", ["solar"], [], { atk: 40, cd: 5 }],
    ["prism_beast", 2, "稜鏡獸", "プリズム獣", "Prism Beast", "m", "shiftWeak", [], [], null],
    ["escort_boat", 2, "護衛艇", "護衛艇", "Escort Boat", "s", "escort", ["comet"], [], null],
    ["corroder", 2, "腐蝕兵", "腐食兵", "Corroder", "m", "armorBreak", ["photon"], ["nebula"], null],
    ["nebula_serpent", 2, "星雲巨蟒", "星雲大蛇", "Nebula Serpent", "l", "serpent", ["comet"], [], { hp: 1200 }],
    // ---- 星區 3：虛空境 ----
    ["void_eye", 3, "虛空眼", "虚空の眼", "Void Eye", "m", "drainOnDeath", ["photon"], ["void"], null],
    ["shield_mother", 3, "護盾母體", "シールド母体", "Shield Mother", "l", "selfShield", ["nebula"], [], null],
    ["comet_knight", 3, "彗星騎兵", "彗星騎兵", "Comet Knight", "m", "charge", ["gravity"], [], null],
    ["time_shade", 3, "時間幽影", "時の亡霊", "Time Shade", "m", "randomCd", ["plasma"], [], null],
    ["gravity_vortex", 3, "重力漩渦體", "重力渦", "Gravity Vortex", "m", "ownWell", ["plasma"], ["gravity"], null],
    ["antimatter_orb", 3, "反物質球", "反物質球", "Antimatter Orb", "s", "repel", ["void"], [], null],
    ["void_rift", 3, "虛空裂口", "虚空の裂け目", "Void Rift", "m", "rift", ["photon"], [], { atk: 30 }],
    ["mirror_clone", 3, "鏡像分身", "鏡像分身", "Mirror Clone", "m", "mirror", [], [], null],
    ["obsidian_knight", 3, "黑曜騎士", "黒曜騎士", "Obsidian Knight", "l", "explosionOnly", ["solar"], [], null],
    ["entropy_worm", 3, "熵蟲", "エントロピー虫", "Entropy Worm", "s", "entropy", ["solar"], [], null],
    ["binary_star", 3, "引力雙星", "重力連星", "Binary Star", "l", "binary", ["comet"], ["gravity"], { hp: 1100 }],
    ["doom_turret", 3, "終焉砲台", "終焉砲台", "Doom Turret", "m", "doom", ["gravity"], [], { atk: 100, cd: 6 }],
    ["the_forgotten", 3, "遺忘者", "忘却者", "The Forgotten", "m", "oblivion", ["photon"], [], null],
    ["dark_matter", 3, "暗物質塊", "暗黒物質塊", "Dark Matter", "l", "hiddenHp", ["photon"], ["void"], null],
    ["echo_body", 3, "回聲體", "反響体", "Echo Body", "m", "echoSpawn", ["plasma"], [], null],
    ["void_whale", 3, "虛空巨鯨", "虚空鯨", "Void Whale", "l", "devour", ["plasma"], ["void"], { hp: 1800 }],
    ["eclipse_apostle", 3, "星蝕使徒", "星蝕の使徒", "Eclipse Apostle", "l", "eclipse", ["photon"], [], null]
  ];

  function mk(r) {
    var b = BASE[r[5]], o = r[9] || {}, m = SECTOR_MULT[r[1]];
    return {
      id: r[0], sector: r[1], name: C3(r[2], r[3], r[4]), size: r[5], trait: r[6],
      weak: r[7], resist: r[8],
      hp: Math.round((o.hp || b.hp) * m), atk: Math.round((o.atk || b.atk) * m), cd: o.cd || b.cd
    };
  }
  D.register("enemies", ROWS.map(mk));

  // ---------------- 衍生靶（不算在 50 種內） ----------------
  // cd 0 = 不攻擊。hp 由產生時決定的，這裡是預設值。
  var SPAWN_DEFS = {
    splitter_shard: { id: "splitter_shard", sector: 2, name: C3("分裂體（小）", "分裂体（小）", "Splitter Shard"), size: "s", trait: "", weak: ["solar"], resist: [], hp: 300, atk: 25, cd: 2 },
    echo_shade: { id: "echo_shade", sector: 3, name: C3("殘影", "残影", "Echo Shade"), size: "s", trait: "", weak: ["plasma"], resist: [], hp: 1, atk: 20, cd: 2 },
    serpent_body: { id: "serpent_body", sector: 2, name: C3("巨蟒身體", "大蛇の胴", "Serpent Body"), size: "m", r: 22, trait: "serpentBody", weak: ["comet"], resist: [], hp: 700, atk: 0, cd: 0 }
  };

  // ---------------- Boss（§7.1） ----------------
  function part(key, zh, ja, en, dx, dy, r, hp, atk, cd) {
    return { key: key, dx: dx, dy: dy, def: { id: "part_" + key, name: C3(zh, ja, en), size: "l", r: r, trait: "part_" + key, weak: [], resist: [], hp: hp, atk: atk, cd: cd } };
  }
  var BOSSES = [
    {
      id: "mining_carrier", sector: 1, name: C3("礦採母艦", "採掘母艦", "Mining Carrier"),
      body: { id: "mining_carrier", name: C3("礦採母艦", "採掘母艦", "Mining Carrier"), size: "l", r: 56, trait: "bossBody", weak: ["plasma"], resist: ["comet"], hp: 6000, atk: 110, cd: 3 },
      parts: [
        part("drill", "鑽臂", "ドリルアーム", "Drill Arm", -110, 0, 30, 1200, 0, 0),
        part("drill", "鑽臂", "ドリルアーム", "Drill Arm", 110, 0, 30, 1200, 0, 0)
      ]
    },
    {
      id: "nebula_dread", sector: 2, name: C3("星雲巨艦", "星雲巨艦", "Nebula Dreadnought"),
      body: { id: "nebula_dread", name: C3("星雲巨艦", "星雲巨艦", "Nebula Dreadnought"), size: "l", r: 60, trait: "bossBody", weak: ["gravity"], resist: ["nebula"], hp: 9000, atk: 140, cd: 3 },
      parts: [
        part("shieldGen", "護盾產生器", "シールド発生器", "Shield Generator", -120, 0, 26, 1500, 0, 0),
        part("shieldGen", "護盾產生器", "シールド発生器", "Shield Generator", 120, 0, 26, 1500, 0, 0),
        part("turret", "砲塔", "砲塔", "Turret", 0, 100, 26, 1800, 60, 2)
      ]
    },
    {
      id: "void_ark", sector: 3, name: C3("虛空方舟", "虚空の方舟", "Void Ark"),
      body: { id: "void_ark", name: C3("虛空方舟", "虚空の方舟", "Void Ark"), size: "l", r: 64, trait: "bossBody", weak: ["photon"], resist: ["void"], hp: 12000, atk: 170, cd: 3 },
      parts: [
        part("core", "重力核心", "重力コア", "Gravity Core", -140, 20, 24, 1600, 0, 0),
        part("core", "重力核心", "重力コア", "Gravity Core", 140, 20, 24, 1600, 0, 0),
        part("core", "重力核心", "重力コア", "Gravity Core", 0, 130, 24, 1600, 0, 0)
      ]
    }
  ];
  D.SPAWN_DEFS = SPAWN_DEFS;
  D.BOSSES = BOSSES;
  D.BOSS_BY_ID = {};
  BOSSES.forEach(function (x) { D.BOSS_BY_ID[x.id] = x; });

  if (typeof module !== "undefined" && module.exports) module.exports = D.ENEMIES;
})();
