// 煉金術士（atelier）：數值表與規則資料。規則依據 docs/atelier_design.md；標示「暫定」的數值都集中在這裡。
(function () {
  "use strict";
  var data = {
    // §3 屬性（5 種）。icon 是色覺友善用的圖形（B15），棋盤格與素材都會同時顯示顏色與圖形
    ELEMENTS: [
      { id: "fire", color: "#e0523a", icon: "▲" },
      { id: "ice", color: "#3a7be0", icon: "◆" },
      { id: "bolt", color: "#e0b83a", icon: "✦" },
      { id: "wind", color: "#3ab36a", icon: "●" },
      { id: "spirit", color: "#9a5ae0", icon: "✚" }
    ],
    // 色相（0～360）→ 屬性；from > to 表示跨過 0 度
    HUE_SECTORS: [
      { from: 330, to: 40, el: "fire" },
      { from: 40, to: 75, el: "bolt" },
      { from: 75, to: 165, el: "wind" },
      { from: 165, to: 260, el: "ice" },
      { from: 260, to: 330, el: "spirit" }
    ],
    ACHROMATIC_SAT: 0.15,            // 飽和度低於此值 → 靈（無彩色）
    CATEGORY_BY_ELEMENT: { fire: "mineral", bolt: "mineral", ice: "liquid", wind: "plant", spirit: "essence" },
    SHADOW_VAL: 0.25,                // 明度低於此值 → 影
    CRYSTAL_VAL: 0.85, CRYSTAL_SAT: 0.3,   // 明度高、飽和度低 → 結晶
    CATEGORIES: ["liquid", "plant", "mineral", "essence", "crystal", "shadow"],

    // §2 採色（O1、C1、O5、O6）
    SRC_SIZE: 32,                    // 照片縮成 32×32 再分析
    GRID: 8,                         // 形狀判定用的 8×8 格
    K: 5,                            // k-means 取 5 個主色
    KMEANS_ITER: 8,
    MIN_FRAC: 0.03,                  // 面積少於 3% 的色塊捨棄
    PICK_MAX: 3,                     // 一次採色最多選 3 色
    SHAPE_MIN: 1, SHAPE_MAX: 6,      // 素材形狀 1～6 格（暫定）
    SHAPE_SCALE: 10,                 // 格數＝round(1 + 面積比 × 10)（暫定）
    PURITY_RANGE: 40,                // 與最近傳統色的 ΔE 超過 40 視為純度 0（暫定）
    BASKET_MAX: 6,                   // 採集籃（O5，暫定）
    BASKET_REFILL_MS: 20 * 60000,    // 每 20 分回復 1（暫定）
    MAT_MAX: 60,                     // 素材箱上限（暫定）

    // §4 調和（蘇菲範圍：形狀、旋轉、覆蓋、同色格、加成格、最後一推、品質依釜）
    BONUS: 2, BONUS_MATCH: 4,        // 加成格：一般 +2、同色 +4（暫定）
    FINAL_PUSH_RATE: 0.5,            // 最後一推：量表 × 佔比 × 0.5（暫定）
    COOLDOWN_MS: 10 * 60000,         // C11 大釜冷卻 10 分（暫定）
    MAX_TRAITS: 3,
    TRAIT_CAP_BASE: 10, TRAIT_CAP_PER_LV: 5,   // C4 特性成本上限＝10＋等級×5（暫定）
    EXP_PER_LV: 100, LV_MAX: 20,
    EXP_PER_SYNTH: 30,
    AFF_PER_SYNTH: 2, AFF_PER_TASK: 10, AFF_HINT: 30,

    // 錬金釜。pattern：. 一般格、小寫＝該屬性的色格、大寫＝同色加成格、* 無色加成格
    // 屬性代號：f 火、i 冰、b 雷、w 風、s 靈
    CAULDRONS: {
      copper: {
        name: { zh: "銅之大釜", ja: "銅の大釜", en: "Copper Cauldron" },
        qualityPerCell: 0.6, unlock: null, affinity: ["heal", "ink", "neutral"],
        pattern: ["f.*.i", ".F.I.", "*.s.*", ".W.B.", "w.*.b"]
      },
      // 第 2 階段（C5）：依等級與灰燼解鎖；affinity＝擅長的配方，量表 ×AFFINITY_MULT
      iron: {
        name: { zh: "鐵之大釜", ja: "鉄の大釜", en: "Iron Cauldron" },
        qualityPerCell: 0.8, unlock: { lv: 2, ash: 10 }, affinity: ["bomb", "pigment"],
        pattern: ["*.f.*", ".F*B.", "f*.*b", ".B*F.", "*.b.*"]
      },
      glass: {
        name: { zh: "玻璃之釜", ja: "ガラスの釜", en: "Glass Cauldron" },
        qualityPerCell: 0.4, unlock: { lv: 3, ash: 20 }, affinity: ["frost", "heal", "charm"],
        pattern: ["i.w.i.", ".I..W.", "w.s.s.", ".s.s.w", ".W..I.", ".i.w.i"]
      },
      star: {
        name: { zh: "星之釜", ja: "星の釜", en: "Star Cauldron" },
        qualityPerCell: 0.5, unlock: { lv: 4, ash: 40 }, affinity: ["lamp", "prism", "shade"],
        pattern: ["s..*..s", ".b...b.", "..S.S..", "*..*..*", "..S.S..", ".b...b.", "s..*..s"]
      }
    },
    CAULDRON_ORDER: ["copper", "iron", "glass", "star"],
    AFFINITY_MULT: 1.2,              // 擅長的配方：量表 ×1.2（暫定）
    CAULDRON_LV_MAX: 3,
    CAULDRON_UPGRADE_ASH: [10, 25],  // B6：Lv1→2、Lv2→3 的灰燼（暫定）
    CAULDRON_LV_QUALITY: 0.1,        // 每升 1 級，品質上升率 +0.1（暫定）
    SHELF_STEP: 20, SHELF_ASH: [8, 16, 30],   // B6 素材箱擴充：每級 +20，共 3 級（暫定）
    ASH_LOW_QUALITY: 30, ASH_FAIL_BONUS: 2,   // C10：品質未滿 30 的成品另外 +2 灰燼（暫定）
    // 配方：needs＝各素材格要求的類別（* 任意）；gauges＝量表與門檻（第 n 段達成就是效果 Lv n）
    RECIPES: [
      { id: "heal", lv: 1, cat: "liquid", needs: ["liquid", "plant", "*"],
        name: { zh: "治癒藥水", ja: "いやしの薬", en: "Healing Draught" },
        gauges: [
          { el: "wind", steps: [{ at: 6, kind: "heal", n: 20 }, { at: 12, kind: "heal", n: 40 }, { at: 20, kind: "heal", n: 70 }] },
          { el: "ice", steps: [{ at: 8, kind: "cleanse", n: 1 }, { at: 16, kind: "cleanse", n: 2 }] }
        ] },
      { id: "ink", lv: 1, cat: "essence", needs: ["*", "*"],
        name: { zh: "色彩墨水", ja: "いろどりインク", en: "Color Ink" },
        gauges: [
          { el: "spirit", steps: [{ at: 5, kind: "value", n: 30 }, { at: 10, kind: "value", n: 60 }, { at: 16, kind: "value", n: 100 }] },
          { el: "fire", steps: [{ at: 6, kind: "dye", n: 1 }, { at: 12, kind: "dye", n: 2 }] }
        ] },
      { id: "neutral", lv: 1, cat: "liquid", needs: ["liquid", "mineral", "*"],
        name: { zh: "中和劑", ja: "中和剤", en: "Neutralizer" },
        gauges: [
          { el: "ice", steps: [{ at: 6, kind: "value", n: 20 }, { at: 12, kind: "value", n: 45 }, { at: 20, kind: "value", n: 80 }] },
          { el: "bolt", steps: [{ at: 8, kind: "speed", n: 1 }, { at: 16, kind: "speed", n: 2 }] }
        ] },
      { id: "bomb", lv: 2, cat: "mineral", idea: { made: "neutral" }, needs: ["mineral", "essence", "*"],
        name: { zh: "色彩炸彈", ja: "いろどり爆弾", en: "Color Bomb" },
        gauges: [
          { el: "fire", steps: [{ at: 8, kind: "dmg", n: 30 }, { at: 16, kind: "dmg", n: 60 }, { at: 24, kind: "dmg", n: 100 }] },
          { el: "bolt", steps: [{ at: 8, kind: "stun", n: 1 }, { at: 18, kind: "stun", n: 2 }] }
        ] },
      { id: "lamp", lv: 3, cat: "crystal", idea: { seenCount: 20 }, needs: ["crystal", "mineral", "*", "*"],
        name: { zh: "結晶燈", ja: "結晶ランプ", en: "Crystal Lamp" },
        gauges: [
          { el: "bolt", steps: [{ at: 10, kind: "light", n: 1 }, { at: 20, kind: "light", n: 2 }, { at: 30, kind: "light", n: 3 }] },
          { el: "spirit", steps: [{ at: 10, kind: "value", n: 50 }, { at: 22, kind: "value", n: 120 }] }
        ] },
      { id: "charm", lv: 3, cat: "plant", idea: { seenEl: { el: "wind", n: 5 } }, needs: ["plant", "essence", "*", "*"],
        name: { zh: "風之護符", ja: "風のお守り", en: "Wind Charm" },
        gauges: [
          { el: "wind", steps: [{ at: 10, kind: "guard", n: 10 }, { at: 20, kind: "guard", n: 20 }, { at: 30, kind: "guard", n: 35 }] },
          { el: "spirit", steps: [{ at: 10, kind: "speed", n: 1 }, { at: 22, kind: "speed", n: 2 }] }
        ] },
      // 第 2 階段（C3 配方發想）新增
      { id: "pigment", lv: 2, cat: "mineral", idea: { seenCount: 12 }, needs: ["mineral", "*"],
        name: { zh: "顏料塊", ja: "顔料のかたまり", en: "Pigment Cake" },
        gauges: [
          { el: "fire", steps: [{ at: 6, kind: "dye", n: 1 }, { at: 12, kind: "dye", n: 2 }, { at: 18, kind: "dye", n: 3 }] },
          { el: "bolt", steps: [{ at: 8, kind: "value", n: 40 }, { at: 16, kind: "value", n: 80 }] }
        ] },
      { id: "frost", lv: 2, cat: "crystal", idea: { seenEl: { el: "ice", n: 6 } }, needs: ["crystal", "liquid", "*"],
        name: { zh: "冰晶", ja: "氷晶", en: "Frost Crystal" },
        gauges: [
          { el: "ice", steps: [{ at: 8, kind: "freeze", n: 1 }, { at: 16, kind: "freeze", n: 2 }, { at: 24, kind: "freeze", n: 3 }] },
          { el: "spirit", steps: [{ at: 10, kind: "value", n: 50 }, { at: 20, kind: "value", n: 100 }] }
        ] },
      { id: "shade", lv: 3, cat: "shadow", idea: { seen: "sumi" }, needs: ["shadow", "plant", "*", "*"],
        name: { zh: "影之斗篷", ja: "影のマント", en: "Shade Cloak" },
        gauges: [
          { el: "spirit", steps: [{ at: 10, kind: "guard", n: 15 }, { at: 20, kind: "guard", n: 30 }, { at: 30, kind: "guard", n: 50 }] },
          { el: "wind", steps: [{ at: 10, kind: "speed", n: 1 }, { at: 22, kind: "speed", n: 2 }] }
        ] },
      { id: "prism", lv: 4, cat: "crystal", idea: { quality: { recipe: "lamp", n: 60 } }, needs: ["crystal", "essence", "*", "*"],
        name: { zh: "稜鏡", ja: "プリズム", en: "Prism" },
        gauges: [
          { el: "bolt", steps: [{ at: 12, kind: "light", n: 2 }, { at: 24, kind: "light", n: 3 }, { at: 36, kind: "light", n: 4 }] },
          { el: "spirit", steps: [{ at: 12, kind: "value", n: 80 }, { at: 26, kind: "value", n: 200 }] }
        ] }
    ],
    // O9 成品再投入：成品當素材時的形狀（依格數）
    ITEM_SHAPES: {
      3: [[0, 0], [1, 0], [0, 1]],
      4: [[0, 0], [1, 0], [2, 0], [1, 1]],
      5: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
      6: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]
    },
    // 特性（C4）：cost＝成本；quality＝品質加值；boost＝效果數值 +%
    TRAITS: {
      morning_dew: { cost: 6, quality: 5, name: { zh: "朝露", ja: "朝露", en: "Morning Dew" } },
      dusk: { cost: 6, boost: 10, name: { zh: "黃昏", ja: "黄昏", en: "Dusk" } },
      night: { cost: 8, boost: 15, name: { zh: "夜之帳", ja: "夜の帳", en: "Nightfall" } },
      hue_grace: { cost: 10, quality: 8, name: { zh: "色之恩惠", ja: "色の恵み", en: "Hue's Grace" } },
      hue_blessing: { cost: 18, boost: 25, name: { zh: "色之祝福", ja: "色の祝福", en: "Hue's Blessing" } },
      vivid: { cost: 12, quality: 10, name: { zh: "鮮豔", ja: "あざやか", en: "Vivid" } },
      daily_hue: { cost: 8, boost: 15, name: { zh: "今日之色", ja: "今日の色", en: "Color of the Day" } }
    },
    // O4 時間特性（JST 小時，含 from、不含 to；from > to 表示跨午夜）
    TIME_TRAITS: [
      { from: 5, to: 9, trait: "morning_dew" },
      { from: 17, to: 19, trait: "dusk" },
      { from: 22, to: 4, trait: "night" }
    ],
    RARITY_TRAIT: { 2: "hue_grace", 3: "hue_blessing" },
    VIVID_QUALITY: 80,

    // ---------- 第 2 階段 ----------
    DEX_EXP: 5,                      // C2 圖鑑：第一次拍到某個傳統色，經驗 +5（暫定）
    DEX_GROUPS: ["red", "orange", "yellow", "green", "blue", "purple", "brown", "mono"],
    DAILY_TOLERANCE: 20,             // O3 每日色彩：ΔE 20 以內也算拍到（暫定）
    DAILY_EXP: 50,
    STREAK_STEP: 1, STREAK_CAP: 10,  // C9 連續採色：每天 +1 品質，最多 +10；中斷時減半（暫定）
    WB_VALID_MS: 30 * 60000,         // O2 白平衡校正：30 分內有效（暫定）
    WB_QUALITY_MULT: 1.1,
    WB_GAIN_MIN: 0.5, WB_GAIN_MAX: 2,
    SUBLIMATE_N: 3, SUBLIMATE_BONUS: 8   // B9 素材升華：同屬性 3 個 → 1 個，品質＝最高者＋8（暫定）
  };
  if (typeof module !== "undefined" && module.exports) module.exports = data;
  else window.PriTestAtelierData = data;
})();
