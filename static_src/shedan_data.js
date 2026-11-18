// 射彈宇宙（shedan）：共用資料與常數（屬性、反應表、場地常數）。
// 角色、敵人、遺物在各自的 shedan_data_*.js，以 register() 掛進來。規則依據 docs/shedan_game_design.md（§1～§3）。
// 瀏覽器掛在 window.PriTestShedanData；Node 測試用 require 載入。
(function () {
  "use strict";

  function C3(zh, ja, en) { return { zh: zh, ja: ja, en: en }; }

  // ---------------- 常數（§1.2，暫定） ----------------
  var C = {
    FIELD_W: 540,
    FIELD_H: 960,
    HERO_R: 22,
    PULL_MAX: 180,
    SPEED_MAX: 22,          // matter.js 速度（每 16.67ms 的位移）；原文件 28，實測穿透風險高，先用 22
    AIR: 0.012,
    REST: 0.95,
    STOP_SPEED: 0.4,
    STOP_STEPS: 20,
    SHOT_MAX_STEPS: 12 * 120, // 每 frame 兩個子步（120 步／秒）
    HIT_GAP_STEPS: 6,
    HIT_STEP: 10,            // 每 10 Hit 倍率 +0.1
    HIT_STEP_BONUS: 0.1,
    WEAK_MULT: 1.5,
    RESIST_MULT: 0.5,
    SPEED_FACTOR_MIN: 0.4,
    CHAIN_RADIUS_MULT: 2.5,
    CHAIN_DMG_RATIO: 0.3,
    MARK_TURNS: 3,
    BURN_RATIO: 0.2,
    ARC_RANGE: 120,
    ARC_RATIO: 0.3,
    GRAVITY_MARK_RANGE: 150,
    VOID_GAUGE_RATIO: 0.3,   // 最大 HP × 30% 轉成技能量表（÷ VOID_GAUGE_DIV 換算成格數）
    VOID_GAUGE_DIV: 100
  };

  // 敵人大小 → 半徑（§6）
  var SIZE_R = { s: 16, m: 26, l: 40 };

  // ---------------- 屬性（§3） ----------------
  var ELEMENTS = ["solar", "comet", "plasma", "gravity", "nebula", "photon", "void"];
  var ELEMENT_INFO = {
    solar: { name: C3("恆星", "恒星", "Solar"), color: "#ff8a3d", icon: "☀" },
    comet: { name: C3("冰彗", "氷彗", "Comet"), color: "#7fd8ff", icon: "❄" },
    plasma: { name: C3("雷漿", "雷漿", "Plasma"), color: "#ffe14d", icon: "⚡" },
    gravity: { name: C3("引力", "引力", "Gravity"), color: "#b07cff", icon: "◉" },
    nebula: { name: C3("星雲", "星雲", "Nebula"), color: "#4fe0a0", icon: "☁" },
    photon: { name: C3("光子", "光子", "Photon"), color: "#fff6c8", icon: "✦" },
    void: { name: C3("虛空", "虚空", "Void"), color: "#7a5cff", icon: "●" }
  };

  // ---------------- 反應（§3） ----------------
  // kind：explode（爆炸）／status（狀態）／zone（區域）／spread（擴散灼燒）／true（真實傷害）／collapse（吸引後爆炸）
  var REACTIONS = {
    steam: { id: "steam", kind: "explode", radius: 160, mult: 3.0, name: C3("蒸氣爆", "蒸気爆発", "Steam Burst") },
    superconduct: { id: "superconduct", kind: "status", name: C3("超導", "超伝導", "Superconduct") },
    ionize: { id: "ionize", kind: "zone", radius: 100, mult: 0.8, turns: 2, name: C3("電離雲", "電離雲", "Ion Cloud") },
    wildfire: { id: "wildfire", kind: "spread", radius: 150, name: C3("燎原", "燎原", "Wildfire") },
    annihilate: { id: "annihilate", kind: "true", mult: 4.0, name: C3("湮滅", "対消滅", "Annihilation") },
    collapse: { id: "collapse", kind: "collapse", pullRadius: 200, radius: 120, mult: 1.5, name: C3("坍縮", "崩縮", "Collapse") },
    resonance: { id: "resonance", kind: "explode", radius: 90, mult: 1.0, name: C3("共鳴", "共鳴", "Resonance") }
  };
  var PAIRS = {
    "comet+solar": "steam",
    "comet+plasma": "superconduct",
    "nebula+plasma": "ionize",
    "nebula+solar": "wildfire",
    "photon+void": "annihilate"
  };

  // 敵人身上的印記 mark、撞擊屬性 hit → 反應（同屬性不反應）
  function reactionFor(mark, hit) {
    if (!mark || !hit || mark === hit) return null;
    if (mark === "gravity" || hit === "gravity") return REACTIONS.collapse;
    var key = [mark, hit].sort().join("+");
    return REACTIONS[PAIRS[key] || "resonance"];
  }

  // ---------------- 註冊（角色、敵人、遺物資料檔） ----------------
  var HEROES = [], ENEMIES = [];
  var HERO_BY_ID = {}, ENEMY_BY_ID = {};
  function register(kind, list) {
    var arr = kind === "heroes" ? HEROES : kind === "enemies" ? ENEMIES : null;
    var map = kind === "heroes" ? HERO_BY_ID : kind === "enemies" ? ENEMY_BY_ID : null;
    if (!arr) throw new Error("unknown kind " + kind);
    list.forEach(function (x) { arr.push(x); map[x.id] = x; });
  }

  function text(obj, lang) {
    if (!obj) return "";
    if (typeof obj === "string") return obj;
    var l = lang || (typeof window !== "undefined" && window.I18N && window.I18N.getLang()) || "zh";
    return obj[l] || obj.zh || "";
  }

  var api = {
    C: C, SIZE_R: SIZE_R, ELEMENTS: ELEMENTS, ELEMENT_INFO: ELEMENT_INFO, REACTIONS: REACTIONS,
    reactionFor: reactionFor, register: register, text: text, C3: C3,
    HEROES: HEROES, ENEMIES: ENEMIES, HERO_BY_ID: HERO_BY_ID, ENEMY_BY_ID: ENEMY_BY_ID
  };
  var root = typeof window !== "undefined" ? window : globalThis;
  root.PriTestShedanData = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
