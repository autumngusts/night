// ============================================================================
// midnight 遺物效果稽核腳本（純 node，不需要 Playwright／emulator）。
// docs/midnight_relic_effects_audit.md 的統計數字由這支腳本產生，改動
// midnight.js／character_drawer.js／character_types.js 後可重跑確認狀況有沒有變。
// ============================================================================
// 做兩件事：
//   ① 呼叫可達性分析：以「midnight.js 直接呼叫的 CharacterDrawer.*」為起點，對
//      character_drawer.js 的模組層級函式做傳遞閉包，找出「midnight 執行得到、且會讀取
//      c.learnedRelicEffects 的函式」與「完全執行不到的」。後者就是確定的缺口。
//   ② 依規則本文措辭把 353 筆遺物效果分成 10 類，統計各類筆數。
//      （這是輔助分類，個別條目可能歸錯類，詳見文件開頭的「重要限制」。）
//
// 執行方式：node relic_effect_audit.js
// ============================================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.PRITEST_SRC || path.resolve(__dirname, "../../static_src");
const midnightSrc = fs.readFileSync(path.join(SRC, "midnight.js"), "utf8");
const drawerSrc = fs.readFileSync(path.join(SRC, "character_drawer.js"), "utf8");

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(SRC, "character_types.js"), "utf8"), sandbox);
const CT = sandbox.window.PriTestCharacterTypes;
const types = CT.list();

// ---- ① 呼叫可達性 ----------------------------------------------------------
const declRe = /^  function\s+(\w+)/gm;
const decls = [];
let dm;
while ((dm = declRe.exec(drawerSrc))) decls.push({ index: dm.index, name: dm[1] });
const spans = {};
decls.forEach((d, i) => {
  spans[d.name] = drawerSrc.slice(d.index, i + 1 < decls.length ? decls[i + 1].index : drawerSrc.length);
});
const names = Object.keys(spans);
const RELIC_RE = /learnedRelicEffects|relicEffectGroups|findLearnedActionRelic|countLearnedActionRelics|countLearnedRelicEffectsByName|findLearnedRelicEffectByName/;
const relicFns = names.filter((n) => RELIC_RE.test(spans[n]));
const entry = new Set(
  (midnightSrc.match(/(?:CharacterDrawer|CD|window\.PriTestCharacterDrawer)\.(\w+)/g) || []).map((s) => s.split(".").pop()).filter((n) => spans[n])
);
const seen = new Set();
const stack = [...entry];
while (stack.length) {
  const n = stack.pop();
  if (seen.has(n)) continue;
  seen.add(n);
  names.forEach((m) => {
    if (m !== n && new RegExp("\\b" + m + "\\s*\\(").test(spans[n])) stack.push(m);
  });
}
const reachable = relicFns.filter((n) => seen.has(n)).sort();
const unreachable = relicFns.filter((n) => !seen.has(n)).sort();

console.log("=== ① 呼叫可達性 ===");
console.log("midnight 直接呼叫的 CharacterDrawer 函式:", entry.size);
console.log("傳遞閉包可達的函式:", seen.size);
console.log(`會讀遺物效果、且 midnight 執行得到（${reachable.length}）:\n  ` + reachable.join(", "));
console.log(`會讀遺物效果、但 midnight 完全執行不到（${unreachable.length}）:\n  ` + unreachable.join(", "));

// ---- ② 規則本文分類 --------------------------------------------------------
// midnight.js 直接以名稱判斷的效果（名稱直接出現在 midnight.js 原始碼中）
function directlyHandled(name) {
  return !!name && midnightSrc.indexOf(name) !== -1;
}
const COVERED_BY_GENERIC = /「[^」]+」的威力補正設為「[+＋－-]\d+」|最大(?:HP|FP)|將自身「(?:精神|運氣|體能)[：:]/;
const TURN_BASED = /階段|回合|體力骰|骰子|前衛|後衛|敵視|陣形/;

const buckets = {};
const samples = {};
let total = 0;
types.forEach((t) => {
  (t.relicEffectGroups || []).forEach((g) => {
    (g.effects || []).forEach((e) => {
      if (!e || !e.name) return;
      total++;
      const zh = e.name.zh || "";
      const ja = e.name.ja || "";
      const body = (e.body && (e.body.zh || e.body.ja)) || "";
      let k;
      if (directlyHandled(zh) || directlyHandled(ja)) k = "① midnight.js 直接判斷";
      else if (COVERED_BY_GENERIC.test(body)) k = "② 通用被動解析（威力補正／最大HP・FP／判定骰）";
      // 2026-09-11 追加的既有管線：2Hit攻擊的達人（findTwoHitMasteryOverride）、
      // variantEntry（learnedVariantEntries：混成魔法的4變體・妖刀解放・冰塊之棺等）、
      // 發現力＋（CharacterDrawer.potentialPowerDrawWeapon 內部就有判斷）。
      else if (zh.indexOf("2Hit攻擊的達人") === 0) k = "③ 2Hit攻擊的達人（消耗覆寫，冷卻10秒）";
      else if (e.variantEntry) k = "③ variantEntry（角色面板可切換的替代招式）";
      else if (zh === "發現力＋") k = "③ CharacterDrawer 內建（潛在之力稀有度骰+1）";
      else if (e.kind === "Action") k = "③ Action類（只有跳躍／衝刺有入口）";
      else if (TURN_BASED.test(body)) k = "④ 回合制概念（即時制不適用）";
      else if (zh.indexOf("2Hit攻擊的達人") !== -1 || zh.indexOf("1Hit攻擊") !== -1) k = "⑤ 攻擊消耗變更";
      else if (zh.indexOf("技藝強化") !== -1 || zh.indexOf("技能強化") !== -1) k = "⑥ 角色技藝／技能強化";
      else if (body.indexOf("防禦") !== -1) k = "⑦ 防禦相關被動";
      else if (body.indexOf("聖杯瓶") !== -1) k = "⑧ 聖杯瓶相關";
      else if (/總合傷害|傷害「?[+＋]/.test(body)) k = "⑨ 傷害固定加成";
      else k = "⑩ 其他未分類";
      buckets[k] = (buckets[k] || 0) + 1;
      samples[k] = samples[k] || [];
      if (samples[k].length < 4) samples[k].push(zh || ja);
    });
  });
});
console.log(`\n=== ② 規則本文分類（共 ${total} 筆 / ${types.length} 個角色類型）===`);
Object.keys(buckets)
  .sort()
  .forEach((k) => console.log(`  ${String(buckets[k]).padStart(3)} ${k}　例：${samples[k].join("、")}`));
