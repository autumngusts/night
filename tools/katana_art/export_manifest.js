// ============================================================================
// katana 美術素材清單匯出：把遊戲資料（刀種・招式卡・覺醒招式）轉成給 GPT 等生成工具用的 JSON。
// 執行：node tools/katana_art/export_manifest.js
// 輸出：docs/katana_art_manifest.json（規格說明見 docs/katana_art_spec.md）
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

// 招式特效說明（英文，直接用在提示詞）
var VFX_CARDS = {
  dash: "fast lunge: motion streaks and 3–4 fading afterimages of the blade",
  guard: "defensive stance: translucent blue circular barrier around the blade",
  spin: "regaining momentum: swirling wind ring that tightens around the blade",
  mikiri: "parry/counter: white dashed ring while armed; on trigger an X-shaped white slash and the word 見切",
  issen: "single flash cut: blade dashes in a straight line leaving a thin bright cut line and afterimages",
  iai: "iai quick-draw: blade sheathed and still for a moment, then a wide white crescent slash arc around it with a brief screen flash and the kanji 斬",
  momiji: "maple-leaf cuts: red and orange maple leaves scatter from every clash",
  kaika: "blossom-opening cut: when two locked blades separate, a flower of pink petals bursts open with a radial slash",
  rakuou: "falling cherry blossoms: a shower of sakura petals falls on the target and keeps slicing it",
  fubuki: "blizzard cut: a ring of swirling snow and ice shards bursts outward, frost on the targets"
};


function bladeEntry(bt) {
  var art = ART[bt.id] || { en: bt.id, era: "", fittings: "", look: "" };
  var len = Math.round((bt.ideal[0] + bt.ideal[1]) / 2);
  var width = Math.round((bt.width[0] + bt.width[1]) / 2);
  var sori = Math.round((bt.sori[0] + bt.sori[1]) / 2);
  var kasane = (bt.kasane[0] + bt.kasane[1]) / 2;
  var feat = [];
  if (bt.edges === 2) feat.push("double-edged"); else feat.push("single-edged");
  if (sori >= 20) feat.push("strong curve (" + sori + " mm)"); else if (sori <= -8) feat.push("forward/inward curve (" + sori + " mm)"); else if (sori < 5) feat.push("straight");
  if (bt.profile) feat.push("profile: " + bt.profile);
  if (bt.wave) feat.push(bt.wave.count + " waves");
  if (bt.shaft) feat.push("mounted on a long pole");
  if (bt.rings) feat.push(bt.rings + " rings on the spine");
  if (bt.ringPommel) feat.push("ring pommel");
  var common = art.en + ", " + art.era + ". " + art.look + ". Fittings: " + art.fittings + ". " +
    "Blade length about " + len + " cm, width " + width + " mm. ";
  return {
    id: bt.id,
    family: bt.family,
    name: { ja: bt.name.ja, zh: bt.name.zh, en: art.en },
    era: art.era,
    dims: { blade_cm: len, width_mm: width, thickness_mm: kasane, sori_mm: sori, edges: bt.edges },
    shape: { profile: bt.profile || "taper", wave: bt.wave || null, shaft: !!bt.shaft, rings: bt.rings || 0, ringPommel: !!bt.ringPommel,
      heatTreat: bt.ht === "diff" ? "differential (visible hamon line)" : "through-hardened (uniform steel, no hamon)" },
    fittings: art.fittings,
    identify: feat.join(", "),
    files: { side: "static/katana_art/side/" + bt.id + ".png", top: "static/katana_art/top/" + bt.id + ".png", topHilt: "static/katana_art/top/" + bt.id + "_hilt.png" },
    prompt_side: "Side-view game asset of a " + common + (bt.ht === "diff" ? "Polished steel with a visible white temper line (hamon) along the edge. " : "Polished uniform steel. ") +
      "Blade pointing right, hilt on the left, " + (bt.edges === 1 ? "cutting edge facing down, spine up. " : "") +
      "Orthographic, no perspective, entire weapon visible with margins, soft studio light from the top-left, no hand, no background, transparent background, 2048x512, realistic illustrated style consistent across the set.",
    prompt_top: "Top-down game sprite of a " + art.en + " lying flat, seen from directly above. " + art.look + ". " +
      "The guard/collar is exactly at the image center and the blade points right toward the edge of the image; the hilt points left. " +
      "Strong readable silhouette at 48 px, clean dark outline, bright steel, no shadow, transparent background, 512x512. " +
      "Paint the hilt wrap in neutral light grey so it can be tinted with the player color."
  };
}

function vfxEntry(id, name, color, desc) {
  return {
    id: id, name: name, color: color || "#ffffff", vfx: desc,
    files: { sheet: "static/katana_art/vfx/" + id + ".png" },
    prompt: "Game VFX sprite sheet, 8 frames in a single horizontal row, each frame 256x256, transparent background, additive-friendly bright core. " +
      "Effect: " + desc + ". Main color " + (color || "#ffffff") + ". Japanese ink-and-light samurai style, top-down view, centered on the frame, no text unless specified, no character."
  };
}

var manifest = {
  version: 1,
  generated_from: "static_src/katana_data.js",
  spec: "docs/katana_art_spec.md",
  blades: D.BLADE_TYPES.map(bladeEntry),
  cards: D.ARENA_CARDS.map(function (c) { return vfxEntry(c.id, { ja: c.name.ja, zh: c.name.zh }, null, VFX_CARDS[c.id] || c.desc.ja); }),
  specials: D.SPECIALS.map(function (sp) {
    return vfxEntry(sp.id, { ja: sp.name.ja, zh: sp.name.zh }, sp.color, "signature technique \"" + sp.name.ja + "\" (" + sp.group + "): " + sp.desc.ja);
  }).map(function (e, i) { e.group = D.SPECIALS[i].group; e.cutin = "static/katana_art/cutin/" + e.id + ".png"; return e; }),
  common_vfx: [
    vfxEntry("clash_sparks", { ja: "鍔迫り合いの火花", zh: "刀刃相接的火花" }, "#ffd27a", "two blades locked edge to edge, a burst of orange and yellow sparks and a bright flash at the contact point"),
    vfxEntry("break", { ja: "折れ", zh: "折斷" }, "#dfe6ec", "a blade snapping: steel shards flying outward and a crack line"),
    vfxEntry("chip", { ja: "刃こぼれ", zh: "崩刃" }, "#dfe6ec", "small steel chips flying off an edge"),
    vfxEntry("burn", { ja: "灼燒", zh: "灼燒" }, "#ff8a3d", "small flames licking around a target"),
    vfxEntry("bleed", { ja: "出血", zh: "出血" }, "#e04848", "stylized red slash droplets"),
    vfxEntry("poison", { ja: "毒", zh: "毒" }, "#b57cff", "purple poison mist and butterfly sparkles")
  ]
};

var out = path.join(ROOT, "docs", "katana_art_manifest.json");
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log("wrote", path.relative(ROOT, out), "blades", manifest.blades.length, "cards", manifest.cards.length, "specials", manifest.specials.length);
var missing = D.BLADE_TYPES.filter(function (bt) { return !ART[bt.id]; }).map(function (bt) { return bt.id; });
if (missing.length) { console.error("ART 缺少：", missing.join(",")); process.exit(1); }
