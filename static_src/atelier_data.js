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
        qualityPerCell: 0.6,
        pattern: ["f.*.i", ".F.I.", "*.s.*", ".W.B.", "w.*.b"]
      }
    },
    // 配方：needs＝各素材格要求的類別（* 任意）；gauges＝量表與門檻（第 n 段達成就是效果 Lv n）
    RECIPES: [
      { id: "heal", lv: 1, needs: ["liquid", "plant", "*"],
        name: { zh: "治癒藥水", ja: "いやしの薬", en: "Healing Draught" },
        gauges: [
          { el: "wind", steps: [{ at: 6, kind: "heal", n: 20 }, { at: 12, kind: "heal", n: 40 }, { at: 20, kind: "heal", n: 70 }] },
          { el: "ice", steps: [{ at: 8, kind: "cleanse", n: 1 }, { at: 16, kind: "cleanse", n: 2 }] }
        ] },
      { id: "ink", lv: 1, needs: ["*", "*"],
        name: { zh: "色彩墨水", ja: "いろどりインク", en: "Color Ink" },
        gauges: [
          { el: "spirit", steps: [{ at: 5, kind: "value", n: 30 }, { at: 10, kind: "value", n: 60 }, { at: 16, kind: "value", n: 100 }] },
          { el: "fire", steps: [{ at: 6, kind: "dye", n: 1 }, { at: 12, kind: "dye", n: 2 }] }
        ] },
      { id: "neutral", lv: 1, needs: ["liquid", "mineral", "*"],
        name: { zh: "中和劑", ja: "中和剤", en: "Neutralizer" },
        gauges: [
          { el: "ice", steps: [{ at: 6, kind: "value", n: 20 }, { at: 12, kind: "value", n: 45 }, { at: 20, kind: "value", n: 80 }] },
          { el: "bolt", steps: [{ at: 8, kind: "speed", n: 1 }, { at: 16, kind: "speed", n: 2 }] }
        ] },
      { id: "bomb", lv: 2, needs: ["mineral", "essence", "*"],
        name: { zh: "色彩炸彈", ja: "いろどり爆弾", en: "Color Bomb" },
        gauges: [
          { el: "fire", steps: [{ at: 8, kind: "dmg", n: 30 }, { at: 16, kind: "dmg", n: 60 }, { at: 24, kind: "dmg", n: 100 }] },
          { el: "bolt", steps: [{ at: 8, kind: "stun", n: 1 }, { at: 18, kind: "stun", n: 2 }] }
        ] },
      { id: "lamp", lv: 3, needs: ["crystal", "mineral", "*", "*"],
        name: { zh: "結晶燈", ja: "結晶ランプ", en: "Crystal Lamp" },
        gauges: [
          { el: "bolt", steps: [{ at: 10, kind: "light", n: 1 }, { at: 20, kind: "light", n: 2 }, { at: 30, kind: "light", n: 3 }] },
          { el: "spirit", steps: [{ at: 10, kind: "value", n: 50 }, { at: 22, kind: "value", n: 120 }] }
        ] },
      { id: "charm", lv: 3, needs: ["plant", "essence", "*", "*"],
        name: { zh: "風之護符", ja: "風のお守り", en: "Wind Charm" },
        gauges: [
          { el: "wind", steps: [{ at: 10, kind: "guard", n: 10 }, { at: 20, kind: "guard", n: 20 }, { at: 30, kind: "guard", n: 35 }] },
          { el: "spirit", steps: [{ at: 10, kind: "speed", n: 1 }, { at: 22, kind: "speed", n: 2 }] }
        ] }
    ],
    // 特性（C4）：cost＝成本；quality＝品質加值；boost＝效果數值 +%
    TRAITS: {
      morning_dew: { cost: 6, quality: 5, name: { zh: "朝露", ja: "朝露", en: "Morning Dew" } },
      dusk: { cost: 6, boost: 10, name: { zh: "黃昏", ja: "黄昏", en: "Dusk" } },
      night: { cost: 8, boost: 15, name: { zh: "夜之帳", ja: "夜の帳", en: "Nightfall" } },
      hue_grace: { cost: 10, quality: 8, name: { zh: "色之恩惠", ja: "色の恵み", en: "Hue's Grace" } },
      hue_blessing: { cost: 18, boost: 25, name: { zh: "色之祝福", ja: "色の祝福", en: "Hue's Blessing" } },
      vivid: { cost: 12, quality: 10, name: { zh: "鮮豔", ja: "あざやか", en: "Vivid" } }
    },
    // O4 時間特性（JST 小時，含 from、不含 to；from > to 表示跨午夜）
    TIME_TRAITS: [
      { from: 5, to: 9, trait: "morning_dew" },
      { from: 17, to: 19, trait: "dusk" },
      { from: 22, to: 4, trait: "night" }
    ],
    RARITY_TRAIT: { 2: "hue_grace", 3: "hue_blessing" },
    VIVID_QUALITY: 80
  };
  if (typeof module !== "undefined" && module.exports) module.exports = data;
  else window.PriTestAtelierData = data;
})();
