/* イヌスノー（狗雪）數值表：docs/inusnow_design.md。所有數值都是「暫定」，試玩後再調整。
   規則核心（terrain／phys／core）只從這裡讀數值，不要把數字寫死在程式裡。 */
(function (root) {
  "use strict";

  function C(ja, zh, en) { return { ja: ja, zh: zh, en: en || ja }; }

  var D = {};

  // 物理（設計 §3）：固定步長 1/60 秒
  D.PHYS = {
    hz: 60,
    g: 9.8,
    kAir: 0.0085,          // 空氣阻力係數（每單位質量）；蹲低時 ×(1 − crouchDrag)
    crouchDrag: 0.45,
    crouchRate: 4,         // 蹲低的變化速度（每秒）
    turnBase: 2.4,         // 低速時的最大轉向速度（rad/s）；實際＝turnBase ÷ (1 + 速度 ÷ turnSpeedRef)
    turnSpeedRef: 15,
    crouchTurn: 0.4,       // 蹲低時轉向 ×(1 − crouchTurn × crouch)
    gripAccel: 16,         // 刻滑時能消掉的最大側向速度（m/s²）
    skidDecel: 7,          // 超過抓地時的橫滑減速（m/s²，依超出比例）
    carveLoss: 0.002,      // 刻滑轉向時的速度損失（每 1 m/s 側向修正）
    vOllie: 2.6,           // 起跳的向上速度（m/s）
    takeoffGap: 0.12,      // 地面往下掉超過這個高度（m）就離地
    spinRate: 2.6,         // 空中轉體速度（圈／秒的 2π 倍以 rad/s 表示前的係數：rad/s）
    landClean: 0.866,      // 落地：板子與速度方向的 |cos| ≥ 0.866（30°）＝乾淨
    landSketchy: 0.5,      // ≥ 0.5（60°）＝不穩；更小＝摔倒
    sketchyKeep: 0.6,      // 不穩落地保留的速度
    fallSteps: 90,         // 摔倒停頓（步）
    fallKeep: 0.2,         // 摔倒保留的速度
    startSpeed: 6,         // 出發的初速（m/s，從出發門蹬出去）
    blurPasses: 2,         // 地形載入時 3×3 平均模糊的次數（壓雪後的平順坡面）
  };

  // 能力 1～100 → 乘數 0.85～1.15（暫定）
  D.STAT_LO = 0.85;
  D.STAT_SPAN = 0.3;

  // 雪質（設計 §6；第 1 階段只用壓雪）
  D.SNOW = {
    groomed: { mu: 0.045, grip: 1.0, name: C("圧雪", "壓雪", "Groomed") },
    powder: { mu: 0.07, grip: 0.85, name: C("パウダー", "粉雪", "Powder") },
    ice: { mu: 0.03, grip: 0.65, name: C("アイスバーン", "冰面", "Ice") },
    spring: { mu: 0.08, grip: 0.9, name: C("春雪", "春雪", "Spring snow") },
  };

  // 大曲道（設計 §4.1）
  D.GATES = {
    first: 45,             // 第一座旗門距離起點（m）
    endMargin: 45,         // 最後一座旗門距離終點至少（m）
    spacingMin: 25,
    spacingMax: 30,
    offsetMin: 0.1,        // 轉彎旗竿的側向偏移＝雪道寬 ×（offsetMin～offsetMax），不超過 maxOffset
    offsetMax: 0.28,
    maxOffset: 0.35,
    width: 8,              // 兩根旗竿之間的寬度（m）
    perfect: { dist: 0.5, mult: 1.03, chainStep: 0.01, chainMax: 1.06 },
    startS: 6,             // 出發點（距離雪道起點 m）
    finishMargin: 12,      // 終點線距離雪道終點（m）
    offCourse: 60,         // 離雪道邊緣超過這個距離＝失格（m）
    stopSec: 8,            // 速度 < stopSpeed 持續這麼久＝失格
    stopSpeed: 0.5,
    maxSec: 180,
  };

  // 犬種（設計 §5.1；第 2 階段補到 24 種）。能力：平衡、力量、勇氣、技巧、體型、耐寒（1～100）
  // look：外觀參數（耳 0 立耳／1 垂耳、尾 0 捲尾／1 直尾／2 短尾、吻長、腿長、身長、毛色 2 色、fluff 蓬毛 0～1）
  // nose：嗅覺量表的累積倍率（0.8～1.3；只用在嗅覺與外觀，設計 §5.1）
  function B(id, ja, zh, en, st, look, nose) {
    var a = st.split(",").map(Number);
    return { id: id, name: C(ja, zh, en), stats: { bal: a[0], pow: a[1], brv: a[2], tec: a[3], siz: a[4], cld: a[5] }, look: look, nose: nose };
  }
  D.BREEDS = [
    B("shiba", "柴犬", "柴犬", "Shiba Inu", "70,55,75,70,35,70", { ear: 0, tail: 0, snout: 0.9, leg: 0.9, body: 0.9, size: 0.85, c1: "#c8742c", c2: "#f6ead8" }, 1.05),
    B("akita", "秋田犬", "秋田犬", "Akita", "65,75,70,55,70,80", { ear: 0, tail: 0, snout: 1.0, leg: 1.0, body: 1.05, size: 1.1, c1: "#d98a3c", c2: "#fbf3e6" }, 1.0),
    B("husky", "シベリアン・ハスキー", "西伯利亞哈士奇", "Siberian Husky", "60,70,80,60,60,95", { ear: 0, tail: 1, snout: 1.05, leg: 1.05, body: 1.0, size: 1.0, c1: "#5d6670", c2: "#f4f6f8" }, 1.0),
    B("corgi", "コーギー", "柯基", "Corgi", "80,50,65,75,30,55", { ear: 0, tail: 2, snout: 0.9, leg: 0.55, body: 1.1, size: 0.75, c1: "#d4883a", c2: "#ffffff" }, 0.95),
    B("bernese", "バーニーズ", "伯恩山犬", "Bernese Mountain Dog", "55,85,55,45,90,90", { ear: 1, tail: 1, snout: 1.0, leg: 1.0, body: 1.15, size: 1.25, c1: "#1e1a18", c2: "#c66a2c", fluff: 0.5 }, 1.2),
    B("golden", "ゴールデン・レトリバー", "黃金獵犬", "Golden Retriever", "65,70,60,60,75,70", { ear: 1, tail: 1, snout: 1.05, leg: 1.0, body: 1.05, size: 1.15, c1: "#d9a650", c2: "#f0d49a", fluff: 0.4 }, 1.15),
    B("border", "ボーダー・コリー", "邊境牧羊犬", "Border Collie", "75,60,70,90,50,65", { ear: 1, tail: 1, snout: 1.05, leg: 1.0, body: 1.0, size: 0.95, c1: "#181818", c2: "#f6f6f6" }, 1.1),
    B("hokkaido", "北海道犬", "北海道犬", "Hokkaido", "75,65,85,60,50,95", { ear: 0, tail: 0, snout: 0.95, leg: 0.95, body: 0.95, size: 0.95, c1: "#e8dcc6", c2: "#fbf7ef" }, 1.1),
    // 第 2 階段追加 16 種（能力總和約 330～390、各有長短；設計 §5.1）
    B("kai", "甲斐犬", "甲斐犬", "Kai Ken", "72,60,85,65,40,68", { ear: 0, tail: 0, snout: 0.95, leg: 0.95, body: 0.95, size: 0.9, c1: "#2b221c", c2: "#5a4636" }, 1.1),
    B("shikoku", "四国犬", "四國犬", "Shikoku", "70,65,80,65,45,65", { ear: 0, tail: 0, snout: 0.95, leg: 0.95, body: 0.95, size: 0.92, c1: "#a5623a", c2: "#e9d6c0" }, 1.05),
    B("kishu", "紀州犬", "紀州犬", "Kishu Ken", "70,65,75,60,50,70", { ear: 0, tail: 0, snout: 0.95, leg: 1.0, body: 0.95, size: 0.95, c1: "#f4efe6", c2: "#ffffff" }, 1.05),
    B("spitz", "日本スピッツ", "日本狐狸犬", "Japanese Spitz", "65,45,60,75,35,85", { ear: 0, tail: 0, snout: 0.8, leg: 0.85, body: 0.9, size: 0.8, c1: "#ffffff", c2: "#f3f3f3", fluff: 1 }, 0.95),
    B("stbernard", "セント・バーナード", "聖伯納", "Saint Bernard", "45,85,50,40,95,75", { ear: 1, tail: 1, snout: 1.1, leg: 1.05, body: 1.2, size: 1.35, c1: "#9a4e24", c2: "#ffffff", fluff: 0.3 }, 1.3),
    B("gshepherd", "ジャーマン・シェパード", "德國牧羊犬", "German Shepherd", "70,75,70,70,65,40", { ear: 0, tail: 1, snout: 1.15, leg: 1.1, body: 1.05, size: 1.15, c1: "#2a1f16", c2: "#c98a45" }, 1.25),
    B("labrador", "ラブラドール", "拉布拉多", "Labrador Retriever", "65,70,60,55,70,60", { ear: 1, tail: 1, snout: 1.05, leg: 1.0, body: 1.05, size: 1.12, c1: "#e3c48b", c2: "#f1dfb8" }, 1.2),
    B("samoyed", "サモエド", "薩摩耶", "Samoyed", "60,60,55,60,60,95", { ear: 0, tail: 0, snout: 0.95, leg: 1.0, body: 1.0, size: 1.05, c1: "#fbfbf7", c2: "#ffffff", fluff: 1 }, 1.0),
    B("malamute", "アラスカン・マラミュート", "阿拉斯加雪橇犬", "Alaskan Malamute", "50,85,55,40,80,80", { ear: 0, tail: 0, snout: 1.05, leg: 1.05, body: 1.1, size: 1.25, c1: "#6b6460", c2: "#f7f5f2", fluff: 0.6 }, 1.0),
    B("jack", "ジャック・ラッセル", "傑克羅素梗", "Jack Russell Terrier", "75,45,95,80,20,40", { ear: 1, tail: 2, snout: 0.95, leg: 0.8, body: 0.9, size: 0.68, c1: "#ffffff", c2: "#a6693a" }, 1.15),
    B("dachshund", "ダックスフンド", "臘腸犬", "Dachshund", "85,45,75,70,20,40", { ear: 1, tail: 1, snout: 1.2, leg: 0.45, body: 1.35, size: 0.7, c1: "#8a4a22", c2: "#b0683a" }, 1.25),
    B("frenchie", "フレンチ・ブルドッグ", "法國鬥牛犬", "French Bulldog", "65,70,70,55,35,35", { ear: 0, tail: 2, snout: 0.55, leg: 0.75, body: 0.95, size: 0.78, c1: "#3a3432", c2: "#e9e1d6" }, 0.8),
    B("poodle", "トイ・プードル", "玩具貴賓", "Toy Poodle", "85,35,60,95,15,40", { ear: 1, tail: 2, snout: 0.95, leg: 0.9, body: 0.85, size: 0.62, c1: "#9b5a34", c2: "#b87448", fluff: 1 }, 1.0),
    B("schnauzer", "ミニチュア・シュナウザー", "迷你雪納瑞", "Miniature Schnauzer", "75,45,70,80,25,55", { ear: 1, tail: 2, snout: 1.0, leg: 0.85, body: 0.9, size: 0.7, c1: "#7a7f86", c2: "#d9dcdf" }, 1.1),
    B("pyrenees", "グレート・ピレニーズ", "大白熊犬", "Great Pyrenees", "55,80,50,45,90,70", { ear: 1, tail: 1, snout: 1.0, leg: 1.05, body: 1.15, size: 1.3, c1: "#fbf8f0", c2: "#ffffff", fluff: 0.9 }, 1.05),
    B("taiwan", "台湾犬", "台灣犬", "Taiwan Dog", "75,65,85,75,45,30", { ear: 0, tail: 0, snout: 1.0, leg: 1.05, body: 0.95, size: 0.95, c1: "#1d1a18", c2: "#3a3430" }, 1.15),
  ];

  // CPU 選手名冊（設計 §5.2）：24 隻。lv 1～5；style：steady 穩健／std 標準／dash 衝刺／trick 特技
  function P(id, breed, ja, zh, en, lv, style) { return { id: id, breed: breed, name: C(ja, zh, en), lv: lv, style: style }; }
  D.CPU = [
    P("c0", "shiba", "ポチ", "波奇", "Pochi", 2, "std"),
    P("c1", "akita", "ハナ", "花花", "Hana", 3, "steady"),
    P("c2", "husky", "フブキ", "吹雪", "Fubuki", 5, "dash"),
    P("c3", "corgi", "モモ", "桃桃", "Momo", 1, "trick"),
    P("c4", "bernese", "ゲン", "阿源", "Gen", 3, "steady"),
    P("c5", "golden", "ソラ", "天空", "Sora", 2, "std"),
    P("c6", "border", "リン", "凜", "Rin", 5, "trick"),
    P("c7", "hokkaido", "ハヤテ", "疾風", "Hayate", 4, "dash"),
    P("c8", "kai", "ムサシ", "武藏", "Musashi", 4, "std"),
    P("c9", "shikoku", "テツ", "阿鐵", "Tetsu", 3, "dash"),
    P("c10", "kishu", "ユキ", "小雪", "Yuki", 2, "steady"),
    P("c11", "spitz", "ミゾレ", "霙", "Mizore", 3, "trick"),
    P("c12", "stbernard", "クマ", "熊熊", "Kuma", 1, "steady"),
    P("c13", "gshepherd", "レオ", "里歐", "Leo", 4, "std"),
    P("c14", "labrador", "キナコ", "黃豆粉", "Kinako", 2, "std"),
    P("c15", "samoyed", "ルナ", "露娜", "Luna", 3, "trick"),
    P("c16", "malamute", "アズキ", "紅豆", "Azuki", 2, "dash"),
    P("c17", "jack", "チョコ", "巧克力", "Choco", 4, "trick"),
    P("c18", "dachshund", "マル", "丸子", "Maru", 1, "std"),
    P("c19", "frenchie", "ココ", "可可", "Coco", 2, "dash"),
    P("c20", "poodle", "サクラ", "櫻", "Sakura", 5, "steady"),
    P("c21", "schnauzer", "ハチ", "小八", "Hachi", 3, "std"),
    P("c22", "pyrenees", "シロ", "小白", "Shiro", 4, "steady"),
    P("c23", "taiwan", "カイ", "阿凱", "Kai", 5, "dash"),
  ];

  // CPU 的 AI（設計 §5.2、§17.2、§17.4）
  D.CPU_AI = {
    aggrBase: 0.16, aggrLv: 0.05,       // 暫定（2026-11-21）：自動駕駛在 aggr ≥ 0.6 容易漏門，CPU 壓在 0.1～0.5
    styleAggr: { steady: -0.05, std: 0, dash: 0.05, trick: 0 },
    aggrMax: 0.5,
    vary: 0.05,            // 每座旗門 aggr ±0.05
    missK: 0.02,           // 每座旗門失誤機率＝missK ×(6 − 等級)
    missDrop: 0.2,         // 失誤時這座旗門 aggr −0.2
    delayBase: 6,          // 輸入延遲＝delayBase − 等級（步）
    slopeSpin: [360, 540, 720, 900, 1080],   // 等級 1～5 的目標轉體
    styleGrab: { steady: 1, std: 2, dash: 4, trick: 5 },
    field: 7,              // 比賽模式：玩家＋7 隻 CPU
    ghostsShown: 3,        // 比賽中同時顯示最近的 3 隻
  };

  // Slopestyle（設計 §17.2）
  D.SLOPE = {
    order: ["box", "rail", "kickerS", "kickerM", "kickerL", "rail"],
    first: 60, gapMin: 70, gapMax: 90, finishAfter: 60, lateral: 4, sizeVar: 0.1,
    maxSec: 150,
    kicker: { S: { L: 6, H: 1.2, W: 6 }, M: { L: 9, H: 2.0, W: 7 }, L: { L: 12, H: 3.0, W: 8 } },
    rail: { len: 8, w: 0.3, top: 0.6 },
    box: { len: 6, w: 0.6, top: 0.6 },
    ramp: { L: 2, H: 0.6, W: 1.6 },
    catchW: 0.4,           // 滑桿寬度外 ±0.4 m 內可以上桿
    catchBelow: 0.35, catchAbove: 0.7,
    grindMu: 0.02,
    unstableKeep: 0.7,
    spinOnDeg: 160,
    spinMul: 3.0,          // Slopestyle 的轉體速度倍率（只在 Slopestyle 用；大曲道維持 PHYS.spinRate）
    grabSteps: 18, shakeSteps: 18,
    spinD: { 0: 10, 180: 20, 360: 35, 540: 50, 720: 65, 900: 78, 1080: 88, 1260: 95, 1440: 100 },
    railD: { fifty: 25, slide: 35, spin: 15 },
    grab: 8, bite: 12, heightK: 4, heightMax: 20, bark: 5, shake: 5,
    sketchy: 0.6, repeat: 0.6, runK: 1.1, judges: 3, judgeVar: 3,
    featReach: 6,          // 起跳點在地形唇口前後幾公尺內才算在這個地形上做的技巧
  };

  // Snowboard Cross（設計 §17.4）
  D.CROSS = {
    riders: 6, laneGap: 1.6, startS: 4,
    drop: { L: 15, H: 2.0, W: 14 },
    rollerGroups: [2, 3], rollers: [3, 5], rollerA: [0.8, 1.4], rollerLen: [8, 12],
    banks: [3, 5], bank: { B: 2.5, inset: 6, dw: 5, len: 34, fade: 4 },
    kickers: [2, 3],       // 2026-11-21：Cross 的跳台用 S／M（L 在低速時會擋住），只放在坡度 ≥ 6° 的地方
    softMargin: 2, softPush: 4, softSlow: 0.02,
    radius: 0.6, bump: 0.97, airRel: 4,
    look: 6, passShift: 2,
    maxSec: 180, finishMargin: 12,
  };

  // S2 興奮度（Zoomies，設計 §17.5）
  D.ZOOM = {
    max: 100, perfect: 12, trick: 8, land: 4, landMinAir: 20, fastMs: 60 / 3.6, fastPerSec: 2, pass: 6, fall: -25,
    steps: 240, accel: 3, turn: 0.6, grip: 0.85, straight: 60,
  };

  // G1 溝痕（設計 §17.6）
  D.RUT = { add: 18, max: 255, minD: 0.15, turn: 0.3, cosLimit: 0.9397, decel: 1.5, pull: 2 };

  // M2 自由滑行（設計 §17.8）
  D.FREE = {
    bones: 20, spots: 3, boneR: 2.5, spotR: 8, liftR: 25, rideSec: 3,
    stampStart: 50, stampEnd: 50, stampOn: 0.8, stampMinLen: 150,   // 150 m 以下的連絡道不發雪道章（2026-11-21）
    treeR: 0.8, treeMax: 2600, treeBand: 200, treeCell: 20, knockSpeed: 3,
  };

  // 第一批雪場（設計 §2.2；資料在 static/inusnow/data/<id>.json）
  D.RESORTS = ["happo", "yakebitai", "teine", "hirafu", "zao", "nozawa", "naeba", "rusutsu"];

  D.SAVE_KEY = "pritest-inusnow-save-v1";

  root.PriTestInusnowData = D;
  if (typeof module !== "undefined" && module.exports) module.exports = D;
})(typeof window !== "undefined" ? window : globalThis);
