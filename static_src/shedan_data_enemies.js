// 射彈宇宙（shedan）：敵人（規則文件 §6）。第 1 階段先放星區 1 的 16 種；星區 2、3 在第 3 階段補齊到 50 種。
// trait 是特性的鍵，效果在第 3 階段實作（第 1 階段只用基本數值）。
// 基本數值（暫定）：小 HP 300／攻 25／倒數 2；中 700／40／3；大 1500／70／4，個別再調整。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestShedanData || (typeof require === "function" ? require("./shedan_data.js") : null);
  var C3 = D.C3;

  var BASE = { s: { hp: 300, atk: 25, cd: 2 }, m: { hp: 700, atk: 40, cd: 3 }, l: { hp: 1500, atk: 70, cd: 4 } };

  // [id, sector, zh, ja, en, size, trait, weak[], resist[], 覆寫數值]
  var ROWS = [
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
    ["scout_mother", 1, "偵察母機", "偵察母機", "Scout Carrier", "l", "summon", ["plasma"], [], { hp: 1300 }]
  ];

  D.register("enemies", ROWS.map(function (r) {
    var b = BASE[r[5]], o = r[9] || {};
    return {
      id: r[0], sector: r[1], name: C3(r[2], r[3], r[4]), size: r[5], trait: r[6],
      weak: r[7], resist: r[8],
      hp: o.hp || b.hp, atk: o.atk || b.atk, cd: o.cd || b.cd
    };
  }));

  if (typeof module !== "undefined" && module.exports) module.exports = D.ENEMIES;
})();
