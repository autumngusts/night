// ============================================================================
// katana 美術素材清單匯出：把遊戲資料（刀種・招式卡・覺醒招式）轉成給 GPT 等生成工具用的 JSON。
// 執行：node tools/katana_art/export_manifest.js
// 輸出：docs/katana_art_manifest.json（規格說明見 docs/katana_art_spec.md）；之後執行 build_prompt_book.js 產生參考圖與手冊頁
//   每個刀種：尺寸（以遊戲的理想值為準）、剪影特徵、拵（柄・鍔・護手）、辨識重點、側視與俯視的提示詞
//   每張招式卡與覺醒招式：顏色、特效說明、特效序列圖的提示詞
// 資料以 static_src/katana_data.js 為準；這裡只補「外觀」說明（ART），不重複規則數值。
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..", "..");
var win = {};
new Function("window", fs.readFileSync(path.join(ROOT, "static_src", "katana_data.js"), "utf8"))(win);
var D = win.PriTestKatanaData;

// 外觀補充：en 英文名／era 時代地區／fittings 拵與握把／look 剪影與辨識重點（皆為英文，直接用在提示詞）
var ART = {
  tanto: { en: "tanto (Japanese dagger)", era: "Japan, Kamakura–Edo", fittings: "small round tsuba or none, short silk-wrapped hilt, black lacquer", look: "short straight single-edged blade, no curve, hira-zukuri flat profile" },
  wakizashi: { en: "wakizashi (Japanese companion sword)", era: "Japan, Muromachi–Edo", fittings: "round iron tsuba, gold habaki, diamond silk wrap", look: "medium curved single-edged blade with ridge line (shinogi)" },
  uchigatana: { en: "uchigatana (katana)", era: "Japan, Muromachi–Edo", fittings: "round iron tsuba, gold habaki, diamond silk wrap (tsuka-ito)", look: "classic curved single-edged blade, visible hamon temper line, medium point" },
  tachi: { en: "tachi (Japanese slung sword)", era: "Japan, Heian–Kamakura", fittings: "ornate tachi-style mounts, curved hilt, mokko-shaped tsuba", look: "deeply curved near the hilt (koshi-zori), elegant narrowing toward small point" },
  odachi: { en: "odachi (great sword)", era: "Japan, Nanbokucho", fittings: "very long hilt for two hands, large tsuba", look: "extremely long deeply curved blade, large point" },
  naginata: { en: "naginata (Japanese glaive)", era: "Japan, Heian–Edo", fittings: "long lacquered wooden pole, metal collar", look: "curved blade on a long pole, widening toward the tip, strong tip curve" },
  nagamaki: { en: "nagamaki", era: "Japan, Kamakura–Muromachi", fittings: "very long cord-wrapped hilt as long as the blade", look: "tachi-like blade on an extra-long wrapped hilt" },
  yari: { en: "yari (Japanese spear)", era: "Japan, Muromachi–Edo", fittings: "long straight wooden shaft, metal collar", look: "straight double-edged spearhead with central ridge on a long shaft" },
  longsword: { en: "medieval longsword", era: "Europe, 14th–16th c.", fittings: "straight cross-guard, leather grip, wheel pommel", look: "long straight double-edged blade with fuller, cruciform hilt" },
  broadsword: { en: "basket-hilted broadsword", era: "Europe, 17th–18th c.", fittings: "steel basket hilt, leather grip", look: "straight wide double-edged blade, rounded tip" },
  zweihander: { en: "Zweihänder", era: "Germany, 16th c.", fittings: "huge cross-guard with side rings, parrying hooks (parierhaken), long leather grip", look: "giant straight two-handed blade, unsharpened ricasso" },
  rapier: { en: "rapier", era: "Europe, 16th–17th c.", fittings: "swept hilt with ornate rings, wire-wrapped grip", look: "very long narrow thrusting blade, needle point" },
  sabre: { en: "cavalry sabre", era: "Europe, 18th–19th c.", fittings: "stirrup or three-bar hilt, brass guard", look: "curved single-edged blade with fuller, pointed tip" },
  gladius: { en: "Roman gladius", era: "Rome, 1st c. BC–3rd c. AD", fittings: "bone grip with knuckle ridges, round wooden pommel", look: "short wide straight double-edged blade with long triangular point" },
  jian: { en: "Chinese jian (straight sword)", era: "China, Han–Qing", fittings: "small boat-shaped guard, cord-wrapped wooden grip, tassel", look: "slender straight double-edged blade with central ridge, tapering point" },
  miaodao: { en: "miaodao (long Chinese saber)", era: "China, Ming", fittings: "round disk guard, very long two-handed grip", look: "long slender gently curved single-edged blade" },
  liuyedao: { en: "liuyedao (willow-leaf saber)", era: "China, Ming–Qing", fittings: "oval disk guard, wrapped grip, cap pommel", look: "gently curved single-edged saber with even curve" },
  huanshou: { en: "Han dynasty ring-pommel dao (huanshou dao)", era: "China, Han", fittings: "large iron ring pommel, simple short guard or none, cord-wrapped grip", look: "long straight single-edged blade with a ring at the end of the hilt" },
  hengdao: { en: "Tang dynasty hengdao (straight saber)", era: "China, Tang", fittings: "small disk guard, ornate fittings, P-shaped scabbard mounts", look: "straight single-edged blade, kiriha (chisel) edge, small point" },
  modao: { en: "Tang modao (two-edged pole sword)", era: "China, Tang", fittings: "long wooden shaft-like hilt, metal collar", look: "long straight double-edged blade mounted on a long staff" },
  zhanmadao: { en: "zhanmadao (horse-cutting saber)", era: "China, Song–Ming", fittings: "long two-handed grip, disk guard", look: "very long single-edged blade widening toward the tip, slight forward curve" },
  yanling: { en: "yanlingdao (goose-quill saber)", era: "China, Ming–Qing", fittings: "oval disk guard, wrapped grip", look: "nearly straight blade that curves up only near the tip, false edge on the back of the tip" },
  niuwei: { en: "niuweidao (oxtail saber)", era: "China, Qing", fittings: "disk guard, wrapped grip", look: "single-edged saber whose tip section flares wide like an ox tail" },
  guandao: { en: "guandao (Guan Yu's crescent glaive)", era: "China, Song–Qing", fittings: "long lacquered pole, dragon-head collar, spike at the back of the blade", look: "huge wide crescent blade on a long pole" },
  jiuhuan: { en: "nine-ring broadsword (jiuhuan dao)", era: "China, Qing–modern", fittings: "disk guard, ring pommel", look: "wide single-edged blade with nine iron rings threaded along the spine" },
  guitou: { en: "guitou dao (ghost-head / executioner's saber)", era: "China, Qing", fittings: "heavy disk guard, thick grip", look: "heavy single-edged blade that becomes extremely wide toward a rounded tip" },
  hudie: { en: "butterfly swords (hudie shuang dao)", era: "China, Southern styles, Qing", fittings: "D-shaped knuckle guard, short grip, sold as a pair", look: "short very wide single-edged blades, used as a mirrored pair" },
  shamshir: { en: "Persian shamshir", era: "Persia, 16th–19th c.", fittings: "simple cross-guard, pistol-grip pommel", look: "slender, very deeply curved single-edged blade, needle tip" },
  kilij: { en: "Ottoman kilij", era: "Ottoman Empire, 15th–19th c.", fittings: "cross-guard, angled pistol grip", look: "curved blade whose last third widens (yelman) with a false edge" },
  falchion: { en: "falchion", era: "Europe, 13th–16th c.", fittings: "simple cross-guard, wooden grip", look: "single-edged blade widening toward the tip, cleaver-like" },
  kukri: { en: "Nepalese kukri", era: "Nepal", fittings: "wooden or horn grip with rings, no guard, notch (cho) at the base", look: "inwardly curved heavy blade with bulging belly" },
  khopesh: { en: "Egyptian khopesh", era: "Egypt, Bronze Age", fittings: "integral bronze hilt", look: "sickle-shaped blade, cutting with the outer arc, straight hilt section" },
  shotel: { en: "Ethiopian shotel", era: "Ethiopia", fittings: "simple wooden grip, no guard", look: "nearly semicircular double-edged sickle blade" },
  kris: { en: "Javanese kris", era: "Indonesia", fittings: "carved wooden hilt (pistol-like), wide asymmetrical base (ganja)", look: "wavy double-edged dagger with visible pamor nickel pattern" },
  flamberge: { en: "flamberge", era: "Europe, 16th–17th c.", fittings: "large cross-guard with side rings, ricasso", look: "long two-handed sword with flame-like wavy edges" },
  urumi: { en: "urumi (whip sword)", era: "South India, Kerala", fittings: "small cross-guard, simple grip", look: "extremely thin flexible steel band, coiling like a whip" },
  falcata: { en: "Iberian falcata", era: "Iberia, 5th–1st c. BC", fittings: "hooked hilt shaped like a bird or horse head, closed knuckle guard", look: "forward-curved single-edged blade, heavier toward the tip" },
  yatagan: { en: "Ottoman yatagan", era: "Ottoman Empire, 16th–19th c.", fittings: "no guard, grip with large ear-shaped pommel", look: "forward-curved single-edged blade, slight S-shape" }
};


// ---------------- 提示詞（2026-10-20 改版：直接貼給 ChatGPT 就能用） ----------------
// 原則（第一版實測：GPT 做不出 2048×512、柄卷遮罩、精確中心點，見 docs/katana_art_spec.md §0）：
//   1. 只用 GPT 生圖做得到的尺寸（1024×1024／1536×1024），一次一張；不要求序列圖或遮罩。
//   2. 每段提示詞分成固定區塊：參考圖／主體／一定要看得出來的特徵／構圖／輸出／畫風，GPT 比較不會漏。
//   3. 刀種附遊戲本身畫的參考圖（docs/katana_art/ref/，build_prompt_book.js 產生），請 GPT 照輪廓與位置重畫。
//   4. 柄卷直接畫成淺灰（遊戲依灰色上玩家色），不再另做遮罩。
//   5. 特效與切入圖用純黑背景：遊戲以加算合成疊上去，黑色等於透明，比要求透明背景穩定。

var STYLE_BLADE = "Semi-realistic hand-painted game art. Crisp clean edges, polished steel with subtle blue-grey reflections, warm brass/gold fittings, soft light from the top-left. Keep exactly this style for every weapon in the set.";
var STYLE_VFX = "Luminous Japanese ink-and-light style: a bright white-hot core, glow fading smoothly into the black, a few sharp brush-stroke accents. Keep exactly this style for every effect in the set.";

// 招式卡 10 張：遊戲裡的視覺（英文，直接進提示詞）
var VFX_CARDS = {
  dash: { en: "Dash", visual: "a fast straight lunge: long parallel speed streaks with three or four fading ghost afterimages of a sword trailing behind", color: "#ffffff", colorName: "white" },
  guard: { en: "Guard", visual: "a translucent circular energy barrier like a thin glass dome seen from above, with a brighter rim", color: "#6fa8ff", colorName: "soft blue" },
  spin: { en: "Regain momentum", visual: "a swirling wind ring spiralling inward and tightening, curved air streaks", color: "#d8f3ff", colorName: "pale cyan-white" },
  mikiri: { en: "Parry (mikiri)", visual: "an X-shaped pair of crossing razor-thin slash lines with a small bright flash where they cross, inside a thin dashed ring", color: "#ffffff", colorName: "white" },
  issen: { en: "Single flash cut (issen)", visual: "one perfectly straight, very thin, very bright slash line crossing the frame, with a few sparks and a faint afterimage streak", color: "#ffffff", colorName: "white" },
  iai: { en: "Quick-draw cut (iai)", visual: "a wide crescent slash arc sweeping around the center like a full circular cut, sharp leading edge and a soft fading tail", color: "#ffffff", colorName: "white" },
  momiji: { en: "Maple-leaf cut", visual: "a burst of red and orange maple leaves scattering outward from a central spark", color: "#e2553f", colorName: "maple red-orange" },
  kaika: { en: "Blossom cut", visual: "a radial slash pattern opening like a flower: five or six curved petal-shaped cuts with pink petals bursting out", color: "#ff8fb8", colorName: "blossom pink" },
  rakuou: { en: "Falling cherry blossoms", visual: "a shower of sakura petals falling in a loose circle, each petal with a thin cutting glint", color: "#ffc0d6", colorName: "sakura pink" },
  fubuki: { en: "Blizzard cut", visual: "a ring of swirling snow and sharp ice shards bursting outward, frost crystals at the edge", color: "#cfefff", colorName: "icy white-blue" }
};

// 覺醒招式 35 種：en 英文名／visual 特效畫面／motif 切入圖的象徵圖樣／colorName 主色名稱（色碼取自 D.SPECIALS[].color）
var VFX_SPECIALS = {
  hinokokyu: { en: "Breath of Fire", colorName: "orange flame", visual: "a blade wreathed in roaring orange flames that trail behind it in a curved arc", motif: "a stylized swirling fire pattern in Japanese painting style" },
  tsubame: { en: "Swallow Return", colorName: "pale sky blue", visual: "two quick slash arcs, the second snapping back in the opposite direction like a swallow turning in flight", motif: "a swallow in flight drawn with two curved slash lines" },
  raikiri: { en: "Lightning Cutter", colorName: "electric blue-white", visual: "a jagged lightning bolt striking down the middle with one straight slash cutting through it, crackling branches", motif: "a lightning bolt split by a single straight sword cut" },
  ryusei: { en: "Falling Stars", colorName: "meteor orange", visual: "three burning meteors streaking diagonally down with fiery tails, each ending in a bright impact ring", motif: "three meteors with long fiery tails" },
  uzumon: { en: "Whirlpool Storm", colorName: "pale blue", visual: "a spiral vortex of wind and water pulling inward, slash lines curving along the spiral", motif: "a Japanese whirlpool (uzumaki) crest" },
  fudo: { en: "Immovable Diamond", colorName: "golden yellow", visual: "a solid golden protective aura shaped like a faceted diamond shield around the center, with a faint flame halo behind it", motif: "a golden vajra emblem with a flame halo" },
  getsurin: { en: "Full Moon Ring", colorName: "pale lavender-white", visual: "a perfect full-moon circle of light traced by a sword, leaving a glowing ring path", motif: "a large full moon drawn as one glowing circular slash" },
  jakou: { en: "Serpent Bite", colorName: "green", visual: "an S-curved slash shaped like a snake, ending in two fang-like points with small red droplets", motif: "a coiled serpent formed from a curved slash" },
  mizu: { en: "Water Breathing: Flowing Dance", colorName: "water blue", visual: "a long dragon made of flowing water spiralling in a ring, splashing droplets, Japanese woodblock wave style", motif: "a water dragon made of woodblock-print waves" },
  kaminari: { en: "Thunder Breathing: Thunderclap Flash", colorName: "electric yellow", visual: "a single straight yellow lightning dash across the frame with branching sparks", motif: "a zigzag yellow lightning bolt" },
  honoo: { en: "Flame Breathing: Purgatory", colorName: "deep red-orange", visual: "a huge forward charge of fire shaped like a roaring tiger's head, embers flying", motif: "a blazing fire tiger silhouette" },
  kemono: { en: "Beast Breathing: Tearing Fangs", colorName: "brown", visual: "four jagged saw-tooth claw slashes tearing across like a wild beast's fangs", motif: "four jagged claw marks" },
  mushi: { en: "Insect Breathing: Butterfly Dance", colorName: "violet", visual: "glowing violet butterflies scattering around one fine thrust line, purple sparkle dust", motif: "a glowing violet butterfly" },
  kasumi: { en: "Mist Breathing: Obscuring Clouds", colorName: "misty white", visual: "soft drifting mist clouds with a faint sword slash half hidden inside the fog", motif: "layered drifting mist bands" },
  hana: { en: "Flower Breathing: Peach Whirl", colorName: "peach pink", visual: "a whirl of peach blossom petals following a twisting slash arc", motif: "a peach blossom flower with swirling petals" },
  iwa: { en: "Stone Breathing: Serpentinite", colorName: "stone grey", visual: "the ground shattering in a ring, flying rock fragments and dust, a heavy shockwave circle", motif: "cracked stone slabs breaking apart" },
  kaze: { en: "Wind Breathing: Dust Whirlwind", colorName: "wind green", visual: "a tight green whirlwind seen from above, several sharp slash lines cutting through the wind", motif: "a green whirlwind with slash lines" },
  hebi: { en: "Serpent Breathing: Venom Fangs", colorName: "pale mint green", visual: "a long winding snake-like slash path bending several times, ending in a bite with green poison droplets", motif: "a winding serpent of light" },
  oto: { en: "Sound Breathing: Resounding Slashes", colorName: "gold", visual: "a ring of explosive bursts around the center like firecrackers, each with a short slash mark, sound-wave rings", motif: "explosion bursts with concentric sound-wave rings" },
  koi: { en: "Love Breathing: Swaying Love", colorName: "hot pink", visual: "long flexible whip-like ribbon blades sweeping in wide wavy arcs across almost the whole frame, small heart-shaped sparkles", motif: "flowing pink ribbon-like blades" },
  tsuki: { en: "Moon Breathing: Crescent Moon Blades", colorName: "lavender purple", visual: "dozens of small crescent-moon shaped blades of light flying outward in all directions", motif: "a cluster of crescent moons" },
  hi: { en: "Sun Breathing: Dance", colorName: "golden sun orange", visual: "a blazing sun ring of fire circling the center, rays of light, flames curling along the ring", motif: "a radiant sun disc with a ring of flame" },
  doujigiri: { en: "Doujigiri Yasutsuna, the demon-slaying blade", colorName: "silver", visual: "one heavy silver slash cutting a faint demon-mask shaped shadow in half", motif: "an oni demon mask split by a straight cut" },
  onimaru: { en: "Onimaru Kunitsuna, the demon-repelling blade", colorName: "dark crimson", visual: "a crimson shockwave ring pushing outward with sacred paper talisman strips fluttering", motif: "a crimson ring with sacred talisman strips" },
  mikazuki: { en: "Mikazuki Munechika, the crescent moon blade", colorName: "pale moon gold", visual: "an elegant thin crescent moon of light with a soft sparkle, graceful and calm", motif: "a single elegant crescent moon" },
  odenta: { en: "Odenta Mitsuyo, the illness-banishing blade", colorName: "warm pale gold", visual: "a gentle healing glow rising upward with small floating motes of light", motif: "rising motes of warm healing light" },
  juzumaru: { en: "Juzumaru Tsunetsugu, the prayer-bead blade", colorName: "pure white", visual: "a ring of glowing Buddhist prayer beads expanding outward, holy white light", motif: "a circle of glowing prayer beads" },
  tonbogiri: { en: "Tonbogiri, the dragonfly-cutting spear", colorName: "light cyan", visual: "a long straight spear-thrust line with a dragonfly cut cleanly in two at its tip", motif: "a dragonfly split in half by a spear point" },
  muramasa: { en: "Muramasa, the cursed blade", colorName: "blood crimson", visual: "an ominous crimson aura with dark red smoke tendrils and a sharp blood-red slash", motif: "dark crimson smoke curling around a slash" },
  masamune: { en: "Masamune, the master's blade", colorName: "warm white-gold", visual: "a calm, perfect white-gold aura with one refined clean slash, serene light", motif: "a refined golden temper-line wave" },
  heshikiri: { en: "Heshikiri Hasebe, the press-cutting blade", colorName: "steel blue", visual: "two blades locked edge to edge, steel-blue pressure lines bearing down, sparks squeezed out", motif: "two crossing blades pressing against each other" },
  honebami: { en: "Honebami Toshiro, the bone-eater", colorName: "bone ivory", visual: "a pale ivory slash with small bone-fragment shapes splintering off", motif: "bone fragments scattering from a slash" },
  fudokuniyuki: { en: "Fudo Kuniyuki, the Kurikara dragon blade", colorName: "amber gold", visual: "a golden dragon coiled around an upright sword, light reflecting outward in a protective aura", motif: "a dragon coiled around an upright sword" },
  fudoyukimitsu: { en: "Fudo Yukimitsu, the guardian dagger", colorName: "bright amber", visual: "a bright amber protective dome with short counter-slash flashes on its surface", motif: "a guardian flame halo" },
  ookanehira: { en: "Okanehira, the grand champion blade", colorName: "silver-grey", visual: "a massive wide silver slash arc with a heavy, imposing shockwave", motif: "a broad imposing silver slash" }
};

var COMMON_VFX = [
  { id: "clash_sparks", name: { ja: "鍔迫り合いの火花", zh: "刀刃相接的火花" }, en: "Blade clash sparks", color: "#ffd27a", colorName: "orange-yellow", visual: "a burst of orange and yellow sparks spraying out from one bright contact point, a small white flash at the center" },
  { id: "break", name: { ja: "折れ", zh: "折斷" }, en: "Blade breaking", color: "#dfe6ec", colorName: "steel white", visual: "steel shards flying outward from a central crack flash" },
  { id: "chip", name: { ja: "刃こぼれ", zh: "崩刃" }, en: "Edge chipping", color: "#dfe6ec", colorName: "steel white", visual: "a few tiny steel chips flying off with a small spark" },
  { id: "burn", name: { ja: "灼燒", zh: "灼燒" }, en: "Burning", color: "#ff8a3d", colorName: "flame orange", visual: "small flames licking upward in a loose ring" },
  { id: "bleed", name: { ja: "出血", zh: "出血" }, en: "Bleeding", color: "#e04848", colorName: "red", visual: "stylized red droplets splashing outward from a short slash, graphic and not gory" },
  { id: "poison", name: { ja: "毒", zh: "毒" }, en: "Poison", color: "#b57cff", colorName: "purple", visual: "a purple poison mist cloud with small glittering sparkles" }
];

function lines(arr) { return arr.filter(function (x) { return x !== null; }).join("\n"); }

function curveText(sori) {
  if (sori >= 20) return "Strongly curved blade (the spine curves up toward the tip).";
  if (sori >= 5) return "Gently curved blade.";
  if (sori <= -8) return "The blade curves forward, toward the cutting edge.";
  return "Straight blade.";
}

var NO_BG = "transparent background (if transparency is not possible, use a flat pure #00FF00 green background with nothing else on it)";

function bladeEntry(bt) {
  var art = ART[bt.id] || { en: bt.id, era: "", fittings: "", look: "" };
  var len = Math.round((bt.ideal[0] + bt.ideal[1]) / 2);
  var width = Math.round((bt.width[0] + bt.width[1]) / 2);
  var sori = Math.round((bt.sori[0] + bt.sori[1]) / 2);
  var kasane = (bt.kasane[0] + bt.kasane[1]) / 2;
  var pole = !!bt.shaft || bt.id === "yari";
  var must = [];
  must.push(bt.edges === 2 ? "double-edged (sharp on both sides)" : "single-edged");
  must.push(curveText(sori).replace(/\.$/, "").replace(/^\w/, function (c) { return c.toLowerCase(); }));
  if (bt.profile === "widen") must.push("the blade gets clearly WIDER toward the tip");
  if (bt.profile === "narrow") must.push("the blade gets clearly NARROWER toward the tip");
  if (bt.profile === "kukri") must.push("a bulging belly in the middle of the blade");
  if (bt.wave) must.push("wavy edges with " + bt.wave.count + " waves");
  if (bt.shaft) must.push("mounted on a long pole");
  if (bt.rings) must.push(bt.rings + " metal rings threaded along the spine");
  if (bt.ringPommel) must.push("a large metal ring at the end of the hilt");
  var guardWord = bt.family === "nihonto" ? "round tsuba (guard)" : (bt.id === "hudie" ? "D-shaped knuckle guard" : "guard");
  var name = art.en;
  var weapon = art.look + ". Fittings: " + art.fittings + ".";

  var promptTop = lines([
    "Create ONE image: a top-down game sprite of a " + name + ".",
    "",
    "REFERENCE: I attached a simple silhouette drawn by the game. Keep its outline, proportions and position in the frame exactly; only make it look like finished game art.",
    "The thin grey cross and dotted circle in the reference only mark the image center and how far the tip reaches. Do NOT draw them.",
    "",
    "WEAPON: " + weapon,
    "MUST BE CLEARLY VISIBLE (even when shrunk to 48 px): " + must.join("; ") + ".",
    "",
    "COMPOSITION:",
    "- Seen from directly above, lying perfectly flat. No perspective, no shadow.",
    pole ? "- The spot where the hands hold the pole is exactly at the CENTER of the image. The pole runs to the LEFT; the blade starts a little right of center and its tip ends about 38% of the image width right of the center."
      : "- The " + guardWord + " sits exactly at the CENTER of the image (NOT the middle of the whole weapon).",
    pole ? null : "- The blade points RIGHT; its tip ends about 45% of the image width right of the center, close to the right edge.",
    pole ? null : "- The hilt points LEFT from the center.",
    "- Paint the hilt wrap (grip) plain flat light grey (#C8C8C8), no other colors on it. The game recolors it for each player.",
    "",
    "OUTPUT: square 1024x1024 PNG, " + NO_BG + ". No text or labels, no hands, no table, no scenery, no second copy of the weapon.",
    "",
    "STYLE: " + STYLE_BLADE
  ]);

  var promptSide = lines([
    "Create ONE image: a side-view game illustration of a " + name + " (" + art.era + ").",
    "",
    "REFERENCE: I attached the game's own side-view drawing. Keep its proportions and the direction of the curve.",
    "",
    "WEAPON: " + weapon,
    "Blade about " + len + " cm long and " + width + " mm wide. " + curveText(sori) +
      (bt.ht === "diff" ? " Polished steel with a visible white temper line (hamon) along the cutting edge." : " Uniform polished steel, no temper line."),
    "MUST BE CLEARLY VISIBLE: " + must.join("; ") + ".",
    "",
    "COMPOSITION:",
    "- Perfect side view, orthographic, no perspective. The weapon lies horizontally across the whole image.",
    "- Tip on the RIGHT, hilt on the LEFT." + (bt.edges === 1 ? " Cutting edge facing DOWN, spine facing UP." : ""),
    "- The whole weapon is visible with a small margin at both ends.",
    "- The blade must be fully opaque; do not let the background show through the steel or the temper line.",
    "",
    "OUTPUT: landscape 1536x1024 PNG, " + NO_BG + ". No text or labels, no hands, no scabbard, no stand.",
    "",
    "STYLE: " + STYLE_BLADE
  ]);

  return {
    id: bt.id,
    family: bt.family,
    name: { ja: bt.name.ja, zh: bt.name.zh, en: art.en },
    era: art.era,
    dims: { blade_cm: len, width_mm: width, thickness_mm: kasane, sori_mm: sori, edges: bt.edges },
    shape: { profile: bt.profile || "taper", wave: bt.wave || null, shaft: !!bt.shaft, rings: bt.rings || 0, ringPommel: !!bt.ringPommel,
      heatTreat: bt.ht === "diff" ? "differential (visible hamon line)" : "through-hardened (uniform steel, no hamon)" },
    pole: pole,
    fittings: art.fittings,
    identify: must.join(", "),
    reference: { top: "docs/katana_art/ref/top/" + bt.id + ".png", side: "docs/katana_art/ref/side/" + bt.id + ".png" },
    files: { top: "static_src/katana_art/top/" + bt.id + ".png", side: "static_src/katana_art/side/" + bt.id + ".png" },
    gpt: { top: { size: "1024x1024", background: "transparent" }, side: { size: "1536x1024", background: "transparent" } },
    prompt_top: promptTop,
    prompt_side: promptSide
  };
}

function vfxPrompt(en, visual, color, colorName) {
  return lines([
    "Create ONE image: a game visual effect called \"" + en + "\".",
    "",
    "WHAT IT LOOKS LIKE: " + visual + ".",
    "MAIN COLOR: " + colorName + " (" + color + "), with white-hot highlights.",
    "",
    "COMPOSITION:",
    "- Seen from directly above, centered, filling about 70% of the frame.",
    "- Show the single most intense moment of the effect (the game animates the scaling and fading itself).",
    "",
    "OUTPUT: square 1024x1024, PURE BLACK background (#000000). The game adds it with additive light, so black becomes invisible. No sword, no person, no text, no border.",
    "",
    "STYLE: " + STYLE_VFX
  ]);
}

function cutinPrompt(en, motif, color, colorName) {
  return lines([
    "Create ONE image: a wide banner emblem for the special sword technique \"" + en + "\".",
    "",
    "MOTIF: " + motif + ".",
    "MAIN COLOR: " + colorName + " (" + color + ").",
    "",
    "COMPOSITION:",
    "- Wide horizontal banner. The motif sits in the RIGHT 60% of the image.",
    "- Keep the LEFT 40% empty and dark: the game writes the technique name there.",
    "- A few dynamic brush strokes or speed lines may run across the whole width.",
    "",
    "OUTPUT: landscape 1536x1024, PURE BLACK background (#000000). No text, no letters, no person, no border.",
    "",
    "STYLE: " + STYLE_VFX
  ]);
}

function vfxEntry(id, name, en, color, colorName, visual) {
  return {
    id: id, name: name, en: en, color: color, colorName: colorName, vfx: visual,
    files: { vfx: "static_src/katana_art/vfx/" + id + ".png" },
    gpt: { size: "1024x1024", background: "black" },
    prompt: vfxPrompt(en, visual, color, colorName)
  };
}

var missingVfx = D.SPECIALS.filter(function (sp) { return !VFX_SPECIALS[sp.id]; }).map(function (sp) { return sp.id; })
  .concat(D.ARENA_CARDS.filter(function (c) { return !VFX_CARDS[c.id]; }).map(function (c) { return c.id; }));

var manifest = {
  version: 2,
  generated_from: "static_src/katana_data.js",
  spec: "docs/katana_art_spec.md",
  prompt_book: "docs/katana_art_prompts.html",
  styles: { blade: STYLE_BLADE, vfx: STYLE_VFX },
  blades: D.BLADE_TYPES.map(bladeEntry),
  cards: D.ARENA_CARDS.filter(function (c) { return VFX_CARDS[c.id]; }).map(function (c) {
    var v = VFX_CARDS[c.id];
    return vfxEntry(c.id, { ja: c.name.ja, zh: c.name.zh }, v.en, v.color, v.colorName, v.visual);
  }),
  specials: D.SPECIALS.filter(function (sp) { return VFX_SPECIALS[sp.id]; }).map(function (sp) {
    var v = VFX_SPECIALS[sp.id];
    var e = vfxEntry(sp.id, { ja: sp.name.ja, zh: sp.name.zh }, v.en, sp.color, v.colorName, v.visual);
    e.group = sp.group;
    e.motif = v.motif;
    e.files.cutin = "static_src/katana_art/cutin/" + sp.id + ".png";
    e.gpt_cutin = { size: "1536x1024", background: "black" };
    e.prompt_cutin = cutinPrompt(v.en, v.motif, sp.color, v.colorName);
    return e;
  }),
  common_vfx: COMMON_VFX.map(function (c) { return vfxEntry(c.id, c.name, c.en, c.color, c.colorName, c.visual); })
};

var out = path.join(ROOT, "docs", "katana_art_manifest.json");
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log("wrote", path.relative(ROOT, out), "blades", manifest.blades.length, "cards", manifest.cards.length, "specials", manifest.specials.length, "common", manifest.common_vfx.length);
var missing = D.BLADE_TYPES.filter(function (bt) { return !ART[bt.id]; }).map(function (bt) { return bt.id; });
if (missing.length || missingVfx.length) { console.error("ART／VFX 缺少：", missing.concat(missingVfx).join(",")); process.exit(1); }
