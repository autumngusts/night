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

  // 犬種（設計 §5.1；第 1 階段 8 種）。能力：平衡、力量、勇氣、技巧、體型、耐寒（1～100）
  // look：外觀參數（耳 0 立耳／1 垂耳、尾 0 捲尾／1 直尾／2 短尾、吻長、腿長、身長、毛色 2 色）
  D.BREEDS = [
    { id: "shiba", name: C("柴犬", "柴犬", "Shiba Inu"), stats: { bal: 70, pow: 55, brv: 75, tec: 70, siz: 35, cld: 70 }, look: { ear: 0, tail: 0, snout: 0.9, leg: 0.9, body: 0.9, size: 0.85, c1: "#c8742c", c2: "#f6ead8" } },
    { id: "akita", name: C("秋田犬", "秋田犬", "Akita"), stats: { bal: 65, pow: 75, brv: 70, tec: 55, siz: 70, cld: 80 }, look: { ear: 0, tail: 0, snout: 1.0, leg: 1.0, body: 1.05, size: 1.1, c1: "#d98a3c", c2: "#fbf3e6" } },
    { id: "husky", name: C("シベリアン・ハスキー", "西伯利亞哈士奇", "Siberian Husky"), stats: { bal: 60, pow: 70, brv: 80, tec: 60, siz: 60, cld: 95 }, look: { ear: 0, tail: 1, snout: 1.05, leg: 1.05, body: 1.0, size: 1.0, c1: "#5d6670", c2: "#f4f6f8" } },
    { id: "corgi", name: C("コーギー", "柯基", "Corgi"), stats: { bal: 80, pow: 50, brv: 65, tec: 75, siz: 30, cld: 55 }, look: { ear: 0, tail: 2, snout: 0.9, leg: 0.55, body: 1.1, size: 0.75, c1: "#d4883a", c2: "#ffffff" } },
    { id: "bernese", name: C("バーニーズ", "伯恩山犬", "Bernese Mountain Dog"), stats: { bal: 55, pow: 85, brv: 55, tec: 45, siz: 90, cld: 90 }, look: { ear: 1, tail: 1, snout: 1.0, leg: 1.0, body: 1.15, size: 1.25, c1: "#1e1a18", c2: "#c66a2c" } },
    { id: "golden", name: C("ゴールデン・レトリバー", "黃金獵犬", "Golden Retriever"), stats: { bal: 65, pow: 70, brv: 60, tec: 60, siz: 75, cld: 70 }, look: { ear: 1, tail: 1, snout: 1.05, leg: 1.0, body: 1.05, size: 1.15, c1: "#d9a650", c2: "#f0d49a" } },
    { id: "border", name: C("ボーダー・コリー", "邊境牧羊犬", "Border Collie"), stats: { bal: 75, pow: 60, brv: 70, tec: 90, siz: 50, cld: 65 }, look: { ear: 1, tail: 1, snout: 1.05, leg: 1.0, body: 1.0, size: 0.95, c1: "#181818", c2: "#f6f6f6" } },
    { id: "hokkaido", name: C("北海道犬", "北海道犬", "Hokkaido"), stats: { bal: 75, pow: 65, brv: 85, tec: 60, siz: 50, cld: 95 }, look: { ear: 0, tail: 0, snout: 0.95, leg: 0.95, body: 0.95, size: 0.95, c1: "#e8dcc6", c2: "#fbf7ef" } },
  ];

  // 第一批雪場（設計 §2.2；資料在 static/inusnow/data/<id>.json）
  D.RESORTS = ["happo", "yakebitai", "teine", "hirafu", "zao", "nozawa", "naeba", "rusutsu"];

  D.SAVE_KEY = "pritest-inusnow-save-v1";

  root.PriTestInusnowData = D;
  if (typeof module !== "undefined" && module.exports) module.exports = D;
})(typeof window !== "undefined" ? window : globalThis);
