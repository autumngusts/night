// 魔王城的防衛戰（maou）：地圖、魔物娘（部下）的能力、敵人、關卡。2026-11-11 依使用者需求新增（塔防＋魔物娘＋18 禁）。
// 你是剛繼任的魔王。勇者軍團分 12 章進攻，把部下配置在城內的台座上擋住他們。
// 部下全員是外表為成年女性的魔族（活了幾百年），頭像用 images/jikan/ 的 g_000〜g_059 奇幻系列。
(function () {
  "use strict";

  var COLS = 14, ROWS = 9, TILE = 48;
  // 路徑（格子中心的折線）：城門（左上）→ 王座（右下）
  var PATH = [[-1, 1], [4, 1], [4, 6], [8, 6], [8, 2], [12, 2], [12, 7], [13, 7]];
  var THRONE = [13, 7];
  var CHAPTERS = 12;
  var THRONE_HP = 20;

  // 部下的類型（攻擊方式）
  // range＝射程（格）、dmg、rate＝每秒攻擊次數、kind：phys／magic（法師敵人抗魔 50%）
  var TYPES = {
    charm: { name: "魅惑", range: 2.4, dmg: 4, rate: 1.0, kind: "magic", desc: "命中的敵人緩速 45%。" },
    drain: { name: "吸血", range: 1.5, dmg: 14, rate: 1.1, kind: "phys", desc: "近戰。每造成 120 傷害，王座回復 1。" },
    bow: { name: "弓術", range: 3.4, dmg: 9, rate: 1.2, kind: "phys", desc: "射程最長的單體攻擊。" },
    fire: { name: "龍炎", range: 2.6, dmg: 16, rate: 0.55, kind: "magic", splash: 1.0, desc: "範圍傷害。" },
    curse: { name: "詛咒", range: 2.8, dmg: 6, rate: 0.8, kind: "magic", splash: 0.8, desc: "範圍詛咒：敵人受到的傷害 +35%（3 秒）。" },
    claw: { name: "利爪", range: 1.5, dmg: 7, rate: 2.6, kind: "phys", desc: "近戰，攻擊非常快（怕重甲）。" },
    illusion: { name: "幻術", range: 2.4, dmg: 5, rate: 0.7, kind: "magic", desc: "30% 讓敵人迷路往回走 1.2 秒（首領無效）。" },
    knight: { name: "黑騎", range: 1.6, dmg: 12, rate: 0.9, kind: "phys", pierce: 0.5, desc: "近戰，無視一半護甲，每 3 擊暈眩 0.6 秒。" },
    support: { name: "祝福", range: 1.6, dmg: 3, rate: 1.0, kind: "magic", desc: "周圍 1.6 格內的部下傷害 +25%（自己的攻擊很弱）。" },
    gatling: { name: "連射", range: 3.0, dmg: 4, rate: 4.0, kind: "phys", desc: "超高速連射（怕重甲）。" }
  };
  // 部下：join＝第幾章加入；skill＝奧義（羈絆第 2 段故事後解鎖）
  var GIRLS = [
    { id: "lilith", name: "莉莉絲", title: "魅魔", type: "charm", img: "g_012.webp", color: "#d08bff", join: 1, skill: "魅惑之吻", skillDesc: "全場敵人緩速 60%，4 秒。" },
    { id: "sylph", name: "希兒", title: "精靈弓手", type: "bow", img: "g_022.webp", color: "#8fe08a", join: 1, skill: "星落箭雨", skillDesc: "全場敵人受到 40 傷害。" },
    { id: "rose", name: "蘿絲", title: "暗黑騎士", type: "knight", img: "g_014.webp", color: "#e0505a", join: 1, skill: "黑騎突擊", skillDesc: "3 格內的敵人暈眩 2 秒。" },
    { id: "fang", name: "芬", title: "狼人", type: "claw", img: "g_000.webp", color: "#e0a060", join: 2, skill: "月下長嚎", skillDesc: "全體部下攻速 ×2，5 秒。" },
    { id: "ignis", name: "伊格妮絲", title: "龍娘", type: "fire", img: "g_021.webp", color: "#ff7040", join: 3, skill: "龍息", skillDesc: "2.5 格內的敵人受到 150 傷害。" },
    { id: "vera", name: "薇拉", title: "吸血鬼", type: "drain", img: "g_027.webp", color: "#a04080", join: 4, skill: "血之盛宴", skillDesc: "3 格內的敵人受到 60 傷害，王座回復 2。" },
    { id: "kuzu", name: "葛葉", title: "九尾狐", type: "illusion", img: "g_046.webp", color: "#ffb070", join: 5, skill: "千狐幻術", skillDesc: "全場非首領的敵人被推回 3 格。" },
    { id: "morgan", name: "摩根", title: "魔女", type: "curse", img: "g_005.webp", color: "#9a6aff", join: 6, skill: "大詛咒", skillDesc: "全場敵人被詛咒 6 秒。" },
    { id: "dryad", name: "希爾薇", title: "樹精", type: "support", img: "g_013.webp", color: "#9adf70", join: 7, skill: "生命之樹", skillDesc: "王座回復 5。" },
    { id: "zero", name: "零", title: "機巧人偶", type: "gatling", img: "g_011.webp", color: "#5fd6d6", join: 8, skill: "全彈發射", skillDesc: "隨機對敵人造成共 200 傷害。" }
  ];
  var UPGRADE = [0, 60, 120, 200, 300]; // 升到 Lv2〜5 的金幣
  var LV_MULT = 1.3;

  // 敵人：hp、armor（物理減傷）、speed（格／秒）、gold、resist（魔法減傷）、heal（每秒治療周圍）、boss
  var ENEMIES = {
    soldier: { name: "士兵", ic: "⚔", hp: 30, armor: 0, speed: 1.0, gold: 3, color: "#c8c8d0" },
    rogue: { name: "盜賊", ic: "🗡", hp: 22, armor: 0, speed: 1.8, gold: 4, color: "#9ad07a" },
    knight: { name: "重甲騎士", ic: "🛡", hp: 70, armor: 5, speed: 0.7, gold: 7, color: "#8aa0c8" },
    priest: { name: "神官", ic: "✝", hp: 40, armor: 0, speed: 0.9, gold: 8, heal: 4, color: "#fff2b0" },
    mage: { name: "法師", ic: "🔮", hp: 45, armor: 0, speed: 0.9, gold: 8, resist: 0.5, color: "#b090ff" },
    captain: { name: "聖騎士隊長", ic: "⚜", hp: 380, armor: 6, speed: 0.6, gold: 60, boss: 1, color: "#ffd060" },
    hero: { name: "勇者", ic: "👑", hp: 1800, armor: 7, speed: 0.55, gold: 200, boss: 1, regen: 6, color: "#ffef80" }
  };
  // 每章的敵人：[類型, 數量, 間隔秒, 開始秒]；hpMult 隨章數成長
  var WAVES = [
    null,
    { name: "斥候部隊", g: [["soldier", 8, 1.4, 0]] },
    { name: "盜賊團", g: [["soldier", 10, 1.2, 0], ["rogue", 5, 1.0, 6]] },
    { name: "重甲先鋒", g: [["soldier", 10, 1.1, 0], ["knight", 4, 2.2, 5]] },
    { name: "神官隨行", g: [["soldier", 12, 1.0, 0], ["knight", 4, 2.0, 4], ["priest", 3, 3.0, 8]] },
    { name: "混成部隊", g: [["rogue", 10, 0.8, 0], ["knight", 6, 1.8, 6], ["priest", 3, 3.0, 10]] },
    { name: "聖騎士隊長", g: [["soldier", 14, 0.9, 0], ["knight", 5, 2.0, 4], ["captain", 1, 1, 18]] },
    { name: "魔法兵團", g: [["mage", 10, 1.2, 0], ["soldier", 12, 0.9, 3], ["priest", 3, 3.0, 10]] },
    { name: "夜襲", g: [["rogue", 18, 0.6, 0], ["mage", 6, 1.4, 8], ["knight", 6, 1.6, 12]] },
    { name: "王國正規軍", g: [["knight", 8, 1.6, 0], ["priest", 3, 3.0, 5], ["mage", 6, 1.4, 9], ["soldier", 14, 0.8, 14]] },
    { name: "雙隊長", g: [["soldier", 20, 0.7, 0], ["captain", 1, 1, 10], ["mage", 8, 1.2, 14], ["captain", 1, 1, 24]] },
    { name: "總攻擊前夜", g: [["rogue", 18, 0.6, 0], ["knight", 10, 1.4, 6], ["priest", 4, 2.6, 10], ["mage", 8, 1.2, 15]] },
    { name: "勇者降臨", g: [["soldier", 18, 0.7, 0], ["knight", 8, 1.5, 6], ["priest", 4, 2.5, 10], ["captain", 2, 8, 16], ["hero", 1, 1, 30]] }
  ];
  // 難度：一般敵人隨章數加速成長；首領另外用較緩的倍率（見 maou.js 的 spawn）
  function hpMult(ch) { var k = ch - 1; return 1 + 0.22 * k + 0.012 * k * k; }
  function bossMult(ch) { return 1 + 0.12 * (ch - 1); }
  function deployCap(ch) { return Math.min(8, 3 + Math.floor((ch + 1) / 2)); }

  window.PriTestMaouData = { COLS: COLS, ROWS: ROWS, TILE: TILE, PATH: PATH, THRONE: THRONE, CHAPTERS: CHAPTERS, THRONE_HP: THRONE_HP,
    TYPES: TYPES, GIRLS: GIRLS, UPGRADE: UPGRADE, LV_MULT: LV_MULT, ENEMIES: ENEMIES, WAVES: WAVES, hpMult: hpMult, bossMult: bossMult, deployCap: deployCap,
    BOND_LINE: [25, 55], BOND_PACT: 85 };
})();
