// 射彈宇宙（shedan）：角色 30 人（規則文件 §5）。initial = 一開始就能用的 8 人。
// trait 是射擊特性的鍵；友情技、技能在第 2 階段補上效果。頭像 static/images/jikan/g_###.webp。
// 數值依特性：標準 攻 100／HP 250／量表 20；重量大 115／280／22；速度快、輕量 90／230／18（暫定）。
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

  // [id, zh, ja, en, element, trait, statKind, initial]
  var ROWS = [
    ["ignis", "伊格妮", "イグニ", "Ignis", "solar", "standard", "standard", true],
    ["flare", "閃焰", "フレア", "Flare", "solar", "fast", "fast", true],
    ["pyra", "焰鈴", "ホムラ", "Pyra", "solar", "pierce", "pierce", false],
    ["corona", "日冕", "コロナ", "Corona", "solar", "heavy", "heavy", false],
    ["helio", "赫利", "ヘリオ", "Helio", "solar", "spark", "standard", false],
    ["rime", "霜苓", "シモレイ", "Rime", "comet", "heavy", "heavy", true],
    ["sleet", "雪砂", "ユキスナ", "Sleet", "comet", "split", "standard", false],
    ["tail", "長尾", "ナガオ", "Tail", "comet", "frostTrail", "fast", false],
    ["glacier", "冰岬", "ヒョウコウ", "Glacier", "comet", "wallFreeze", "standard", false],
    ["volta", "沃爾塔", "ヴォルタ", "Volta", "plasma", "fast", "fast", true],
    ["arc", "亞克", "アーク", "Arc", "plasma", "wallArc", "standard", false],
    ["tesla", "泰絲", "テスラ", "Tesla", "plasma", "hitArc", "standard", false],
    ["ion", "離子", "イオン", "Ion", "plasma", "light", "light", false],
    ["orbit", "環月", "カンゲツ", "Orbit", "gravity", "wallPull", "standard", true],
    ["well", "深井", "フカイ", "Well", "gravity", "heaviest", "heavy", false],
    ["tidal", "潮汐", "チョウセキ", "Tidal", "gravity", "hitPull", "standard", false],
    ["lens", "透鏡", "レンズ", "Lens", "gravity", "wellBoost", "standard", false],
    ["mist", "霧帆", "キリホ", "Mist", "nebula", "pierceFirst", "pierce", true],
    ["spore", "孢子", "ホウシ", "Spore", "nebula", "markSpread", "standard", false],
    ["veil", "紗幕", "シャマク", "Veil", "nebula", "phase", "standard", false],
    ["drift", "星漂", "セイヒョウ", "Drift", "nebula", "big", "big", false],
    ["lumen", "流明", "ルーメン", "Lumen", "photon", "noDecay", "standard", true],
    ["prism", "稜鏡", "プリズム", "Prism", "photon", "randomMark", "standard", false],
    ["halo", "光環", "ハロー", "Halo", "photon", "heal", "standard", false],
    ["beam", "光束", "ビーム", "Beam", "photon", "laser", "standard", false],
    ["nox", "諾克斯", "ノクス", "Nox", "void", "standard", "standard", true],
    ["abyss", "深淵", "シンエン", "Abyss", "void", "gaugeDrain", "standard", false],
    ["echo", "回音", "エコー", "Echo", "void", "echoMark", "standard", false],
    ["umbra", "本影", "アンブラ", "Umbra", "void", "execute", "standard", false],
    ["null", "零", "ヌル", "Null", "void", "markToTrue", "standard", false]
  ];

  D.register("heroes", ROWS.map(function (r, i) {
    var s = STATS[r[6]];
    return {
      id: r[0], name: C3(r[1], r[2], r[3]), element: r[4], trait: r[5],
      atk: s.atk, hp: s.hp, gauge: s.gauge, mass: s.mass, speed: s.speed,
      img: "g_" + ("00" + (40 + i)).slice(-3) + ".webp",
      initial: r[7]
    };
  }));

  if (typeof module !== "undefined" && module.exports) module.exports = D.HEROES;
})();
