// 射彈宇宙（shedan）：角色 30 人（規則文件 §4.1～§4.3、§5）。initial = 一開始就能用的 8 人。
// trait（射擊特性）／friend（友情技）／skill（技能）都寫成「類型＋參數」，由 shedan_combat.js 依類型分派。
// 頭像 static/images/jikan/g_###.webp。數值依特性：標準 攻 100／HP 250／量表 20；重量大 115／280／22；速度快、輕量 90／230／18（暫定）。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestShedanData || (typeof require === "function" ? require("./shedan_data.js") : null);
  var C3 = D.C3;

  var STATS = {
    standard: { atk: 100, hp: 250, gauge: 20, mass: 1, speed: 1 },
    heavy: { atk: 115, hp: 280, gauge: 22, mass: 1.6, speed: 0.9 },
    fast: { atk: 90, hp: 230, gauge: 18, mass: 0.9, speed: 1.1 },
    light: { atk: 90, hp: 220, gauge: 18, mass: 0.7, speed: 1.1 },
    pierce: { atk: 105, hp: 235, gauge: 20, mass: 1, speed: 1 },
    big: { atk: 110, hp: 290, gauge: 22, mass: 1.3, speed: 0.85 }
  };

  function f(kind, zh, ja, en, p) { var o = p || {}; o.kind = kind; o.name = C3(zh, ja, en); return o; }

  // [id, zh, ja, en, element, statKind, initial, trait, friend, skill]
  var ROWS = [
    // ---- 恆星 ----
    ["ignis", "伊格妮", "イグニ", "Ignis", "solar", "standard", true,
      { kind: "none" },
      f("cross", "十字雷射", "クロスレーザー", "Cross Laser", { mult: 0.8, width: 24 }),
      f("hitBlast", "熾核", "熾核", "Blazing Core", { radius: 60, mult: 0.5 })],
    ["flare", "閃焰", "フレア", "Flare", "solar", "fast", true,
      { kind: "none" },
      f("bolts", "火球", "ファイアボール", "Fireballs", { n: 3, mult: 0.6 }),
      f("firstHits", "耀斑", "フレア", "Solar Flare", { n: 5, mult: 2 })],
    ["pyra", "焰鈴", "ホムラ", "Pyra", "solar", "pierce", false,
      { kind: "pierce" },
      f("blast", "爆炎環", "爆炎環", "Flame Ring", { radius: 120, mult: 1.0 }),
      f("stopBlast", "超新星", "超新星", "Supernova", { radius: 200, mult: 3 })],
    ["corona", "日冕", "コロナ", "Corona", "solar", "heavy", false,
      { kind: "push", dist: 12 },
      f("push", "太陽風", "太陽風", "Solar Wind", { range: 180, dist: 60, mult: 0.4 }),
      f("forceBurn", "日珥", "プロミネンス", "Prominence", { burnMult: 2 })],
    ["helio", "赫利", "ヘリオ", "Helio", "solar", "standard", false,
      { kind: "spark", radius: 40, mult: 0.3 },
      f("markAll", "熱浪", "熱波", "Heat Wave", { el: "solar" }),
      f("chainBoost", "恆星爐", "恒星炉", "Star Forge", { per: 0.25 })],
    // ---- 冰彗 ----
    ["rime", "霜苓", "シモレイ", "Rime", "comet", "heavy", true,
      { kind: "push", dist: 12 },
      f("bolts", "冰錐散射", "氷錐散射", "Icicle Spread", { n: 5, mult: 0.6 }),
      f("hitSlow", "絕對零度", "絶対零度", "Absolute Zero", { n: 1 })],
    ["sleet", "雪砂", "ユキスナ", "Sleet", "comet", "standard", false,
      { kind: "split", n: 2, mult: 0.4 },
      f("iceWall", "冰牆", "氷壁", "Ice Wall", { len: 160, offset: 60 }),
      f("markAll", "冰河", "氷河", "Glacier Flow", { el: "comet" })],
    ["tail", "長尾", "ナガオ", "Tail", "comet", "fast", false,
      { kind: "frostTrail", range: 20 },
      f("beam", "彗尾掃射", "彗尾掃射", "Tail Sweep", { aim: "horizontal", mult: 1.0, width: 24 }),
      f("pierce", "彗星衝", "彗星突進", "Comet Dash", {})],
    ["glacier", "冰岬", "ヒョウコウ", "Glacier", "comet", "standard", false,
      { kind: "wallFreeze", range: 80 },
      f("shield", "冰晶護盾", "氷晶の盾", "Crystal Shield", { ratio: 0.3 }),
      f("slowAll", "永凍", "永久凍土", "Permafrost", { n: 1 })],
    // ---- 雷漿 ----
    ["volta", "沃爾塔", "ヴォルタ", "Volta", "plasma", "fast", true,
      { kind: "none" },
      f("chain", "連鎖閃電", "連鎖稲妻", "Chain Lightning", { n: 4, range: 160, mult: 0.7 }),
      f("multiArc", "過載", "過負荷", "Overload", { n: 3 })],
    ["arc", "亞克", "アーク", "Arc", "plasma", "standard", false,
      { kind: "wallArc", range: 160, mult: 0.4 },
      f("net", "雷網", "雷網", "Thunder Net", { range: 200, mult: 0.6 }),
      f("wallStorm", "磁暴", "磁気嵐", "Magnetic Storm", { mult: 0.3 })],
    ["tesla", "泰絲", "テスラ", "Tesla", "plasma", "standard", false,
      { kind: "hitArc", range: 120, mult: 0.3 },
      f("zoneAt", "球狀閃電", "球電", "Ball Lightning", { radius: 90, mult: 0.5, turns: 1 }),
      f("capacitor", "電容", "コンデンサ", "Capacitor", { ratio: 0.3 })],
    ["ion", "離子", "イオン", "Ion", "plasma", "light", false,
      { kind: "none" },
      f("beam", "離子砲", "イオン砲", "Ion Cannon", { aim: "nearest", mult: 1.0, width: 24 }),
      f("redirect", "電漿推進", "プラズマ推進", "Plasma Thrust", {})],
    // ---- 引力 ----
    ["orbit", "環月", "カンゲツ", "Orbit", "gravity", "standard", true,
      { kind: "wallPull", range: 150, ratio: 0.25 },
      f("wellAt", "小型引力井", "小型重力井戸", "Mini Well", { radius: 140 }),
      f("wellAtLaunch", "事件視界", "事象の地平線", "Event Horizon", { radius: 140 })],
    ["well", "深井", "フカイ", "Well", "gravity", "heavy", false,
      { kind: "none" },
      f("meteor", "隕石墜落", "隕石落とし", "Meteor Drop", { n: 3, mult: 1.0 }),
      f("killCollapse", "坍縮核", "崩縮核", "Collapse Core", { pull: 200, radius: 120, mult: 1.5 })],
    ["tidal", "潮汐", "チョウセキ", "Tidal", "gravity", "standard", false,
      { kind: "hitPull", range: 150, ratio: 0.4 },
      f("push", "潮汐波", "潮汐波", "Tidal Wave", { range: 180, dist: 60, mult: 0.4 }),
      f("hitVuln", "潮汐鎖", "潮汐ロック", "Tidal Lock", { mult: 0.3 })],
    ["lens", "透鏡", "レンズ", "Lens", "gravity", "standard", false,
      { kind: "wellBoost", mult: 2 },
      f("beam", "重力透鏡", "重力レンズ", "Gravity Lens", { aim: "nearest", mult: 1.0, width: 24 }),
      f("deflect", "偏折", "偏向", "Deflection", { air: 0.3, pull: 30 })],
    // ---- 星雲 ----
    ["mist", "霧帆", "キリホ", "Mist", "nebula", "pierce", true,
      { kind: "pierceFirst" },
      f("blast", "腐蝕霧", "腐食の霧", "Corrosive Mist", { radius: 120, mult: 1.0, mark: "nebula" }),
      f("markAll", "星雲帷幕", "星雲の帳", "Nebula Veil", { el: "nebula" })],
    ["spore", "孢子", "ホウシ", "Spore", "nebula", "standard", false,
      { kind: "markSpread", range: 80 },
      f("blast", "孢子雲", "胞子雲", "Spore Cloud", { radius: 120, mult: 1.0, mark: "nebula" }),
      f("spreadBoost", "增殖", "増殖", "Proliferate", { range: 160 })],
    ["veil", "紗幕", "シャマク", "Veil", "nebula", "standard", false,
      { kind: "pierce" },
      f("blast", "毒霧壁", "毒霧の壁", "Toxic Screen", { radius: 120, mult: 1.0, mark: "nebula" }),
      f("conceal", "隱蔽", "隠蔽", "Conceal", { mult: 1.3 })],
    ["drift", "星漂", "セイヒョウ", "Drift", "nebula", "big", false,
      { kind: "big", radius: 30 },
      f("blast", "星塵吹拂", "星塵の風", "Stardust Gust", { radius: 120, mult: 1.0 }),
      f("grow", "星雲膨脹", "星雲膨張", "Nebula Swell", { mult: 1.6 })],
    // ---- 光子 ----
    ["lumen", "流明", "ルーメン", "Lumen", "photon", "standard", true,
      { kind: "noDecay" },
      f("bolts", "光束追蹤彈", "追尾光弾", "Homing Light", { n: 3, mult: 0.6 }),
      f("lightspeed", "光速", "光速", "Lightspeed", { speed: 1.5, air: 0.67 })],
    ["prism", "稜鏡", "プリズム", "Prism", "photon", "standard", false,
      { kind: "randomMark" },
      f("bolts", "七彩雷射", "七色レーザー", "Rainbow Lasers", { n: 7, mult: 0.6, randomEl: true }),
      f("refract", "折射", "屈折", "Refraction", {})],
    ["halo", "光環", "ハロー", "Halo", "photon", "standard", false,
      { kind: "heal", ratio: 0.005 },
      f("heal", "光環治療", "光輪の癒し", "Halo Heal", { ratio: 0.05 }),
      f("sanctuary", "聖域", "聖域", "Sanctuary", { per: 10, ratio: 0.05 })],
    ["beam", "光束", "ビーム", "Beam", "photon", "standard", false,
      { kind: "laser", mult: 0.8, width: 24 },
      f("beam", "光束砲", "ビーム砲", "Beam Cannon", { aim: "nearest", mult: 1.5, width: 24 }),
      f("focus", "聚焦", "集束", "Focus", { mult: 5 })],
    // ---- 虛空 ----
    ["nox", "諾克斯", "ノクス", "Nox", "void", "standard", true,
      { kind: "none" },
      f("strike", "虛空爪", "虚空の爪", "Void Claw", { mult: 2.5 }),
      f("devour", "吞噬", "捕食", "Devour", { mult: 2 })],
    ["abyss", "深淵", "シンエン", "Abyss", "void", "standard", false,
      { kind: "gaugeDrain", n: 1 },
      f("voidGate", "虛空門", "虚空の門", "Void Gate", { range: 200, ratio: 0.2 }),
      f("abyssKill", "深淵", "深淵", "Abyss", { gauge: 5 })],
    ["echo", "回音", "エコー", "Echo", "void", "standard", false,
      { kind: "echoMark", range: 40, radius: 50, mult: 0.5 },
      f("blast", "回音波", "反響波", "Echo Wave", { radius: 120, mult: 1.0 }),
      f("echo", "回聲", "残響", "Reverb", {})],
    ["umbra", "本影", "アンブラ", "Umbra", "void", "standard", false,
      { kind: "execute", ratio: 0.05 },
      f("strike", "暗影斬", "影斬り", "Shadow Slash", { mult: 2.5 }),
      f("execute", "處決", "処刑", "Execution", { threshold: 0.3, mult: 3 })],
    ["null", "零", "ヌル", "Null", "void", "standard", false,
      { kind: "markToTrue", mult: 0.5 },
      f("blast", "歸零波", "ゼロ波", "Null Wave", { radius: 120, mult: 1.0, clearMarks: true }),
      f("nullify", "歸零", "無効化", "Nullify", { turns: 2 })]
  ];

  D.register("heroes", ROWS.map(function (r, i) {
    var s = STATS[r[5]];
    return {
      id: r[0], name: C3(r[1], r[2], r[3]), element: r[4],
      atk: s.atk, hp: s.hp, gauge: s.gauge, mass: s.mass, speed: s.speed,
      img: "g_" + ("00" + (40 + i)).slice(-3) + ".webp",
      initial: r[6], trait: r[7], friend: r[8], skill: r[9]
    };
  }));

  if (typeof module !== "undefined" && module.exports) module.exports = D.HEROES;
})();
