// ============================================================================
// 樓層獎勵 perPerson 旗標回歸測試（純 node，不需要 Playwright／emulator，也不需要
// 先跑 generate.py——直接讀 static_src/fields_data_1~4.js）。
// ============================================================================
// 背景（2026-09-10 使用者明確指正）：`fields_data_*.js` 的獎勵原本 138 筆全部標成
// `perPerson: true`，等於所有樓層獎勵都按人數發放。規則書實際的判準是措辭：
//   - 「PCはそれぞれ〜を獲得」「PC全員は〜を1つ獲得」→ 每人各一份（perPerson: true）
//   - 「『消耗品』を2つ獲得」這種固定個數 → 全隊總共只有這麼多份（perPerson: false），
//     必須進共享獎勵池由玩家投票決定歸屬。
// 另外，盧恩與聖杯瓶使用回數沿用 night.js 既有分類
// （`TURN_REWARD_ALL_TARGET_KINDS = ["chaliceBonus", "rune"]` ＝全體一律付與），固定
// 視為每人一份。
//
// 這支腳本把「規則書原文 → 應有的 perPerson」重新算一次，跟資料檔實際的旗標比對，
// 不一致就報錯。目的是避免之後有人「順手把旗標改回去」或新增資料時漏標。
// 判定規則必須與 `midnight.js` 的 `isPerPersonRewardEntry()` 既定值表保持一致。
//
// 執行方式：node reward_perperson_check.js
// ============================================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.PRITEST_SRC || path.resolve(__dirname, "../../static_src");

const sandbox = {
  window: { PriTestCharacterDrawer: { RANGED_GROUP_CATEGORY: "__ranged_group__", SHIELD_GROUP_CATEGORY: "__shield_group__" } },
};
vm.createContext(sandbox);
for (const n of [1, 2, 3, 4]) vm.runInContext(fs.readFileSync(path.join(SRC, `fields_data_${n}.js`), "utf8"), sandbox);

// midnight.js の isPerPersonRewardEntry() と同じ既定値テーブル
const DEFAULT_PER_PERSON_KINDS = ["rune", "chaliceBonus", "potentialPower", "attachedEffect"];
const ALWAYS_PER_PERSON = ["rune", "chaliceBonus"];
const PER_PERSON_WORDS = ["それぞれ", "各自", "めいめい", "全員", "1人につき", "一人につき", "PC人数と同じ数", "PC人数分"];
const CARRY_OVER_PREFIXES = ["そうするごとに", "その都度", "そのたび", "そうした場合"];
const KIND_KEYWORDS = {
  weaponStar: ["武器", "聖印", "杖", "盾"],
  weapon: ["武器"],
  consumable: ["消耗品", "消耗アイテム"],
  talisman: ["タリスマン"],
  potentialPower: ["潜在する力"],
  smithingStone: ["鍛石"],
  stoneswordKey: ["石剣の鍵"],
  attachedEffect: ["付帯効果"],
  weaponSkillReroll: ["戦技の鍛冶台", "戦技"],
};
const SKIP_KINDS = ["note", "hpDamage", "bargainReveal", "tieredChoice", "diceHandChoice"];

// 「全員」は配布（PC全員は〜を1つ獲得）と条件（行為判定に全員成功時のみ）の2用法がある。
function hasDistributionWord(text, word) {
  let from = 0;
  for (;;) {
    const i = text.indexOf(word, from);
    if (i === -1) return false;
    const after = text.slice(i + word.length, i + word.length + 4);
    if (!(word === "全員" && /^(が|は|に|も)?(成功|失敗)/.test(after))) return true;
    from = i + word.length;
  }
}

function judgeText(text, kws, kind) {
  let idx = -1;
  for (const k of kws) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(k, from);
      if (i === -1) break;
      // 「潜在する力：★（武器は「炎／-5」を追加）」の“武器”は potentialPower 側の説明
      const pp = text.lastIndexOf("潜在する力", i);
      if ((kind === "weaponStar" || kind === "weapon") && pp !== -1 && i - pp < 30) {
        from = i + k.length;
        continue;
      }
      idx = idx === -1 ? i : Math.min(idx, i);
      break;
    }
  }
  if (idx === -1) return null;
  if (/PC人数と同じ数|PC人数分/.test(text)) return true;
  const before = text.slice(0, idx);
  return PER_PERSON_WORDS.some((w) => hasDistributionWord(before, w));
}

function decide(entry, floorLines) {
  if (ALWAYS_PER_PERSON.indexOf(entry.kind) !== -1) return true;
  const kws = KIND_KEYWORDS[entry.kind] || [];
  let verdict = null;
  floorLines.forEach((line) => {
    const sentences = line.split(/[。\n]/);
    sentences.forEach((s, si) => {
      let v = judgeText(s, kws, entry.kind);
      if (v === null) return;
      if (v === false && CARRY_OVER_PREFIXES.some((p) => s.trim().indexOf(p) === 0)) {
        const prev = sentences[si - 1] || "";
        if (PER_PERSON_WORDS.some((w) => hasDistributionWord(prev, w))) v = true;
      }
      if (v === true) verdict = true;
      else if (verdict === null) verdict = false;
    });
  });
  return verdict === null ? false : verdict;
}

const mismatches = [];
let checked = 0;
for (const n of [1, 2, 3, 4]) {
  (sandbox.window[`PriTestFieldsData${n}`] || []).forEach((card) => {
    (card.branches || []).forEach((branch, bi) => {
      (branch.floors || []).forEach((floor, fi) => {
        const lines = (floor.lines || []).map((l) => (l.text && l.text.ja) || "").filter(Boolean);
        const walk = (list, tag) => {
          (list || []).forEach((entry, ri) => {
            if (entry.kind === "tieredChoice") return (entry.tiers || []).forEach((t, ti) => walk(t.rewards, `${tag}#${ri}t${ti}`));
            if (entry.kind === "diceHandChoice") return (entry.hands || []).forEach((h, hi) => walk(h.rewards, `${tag}#${ri}h${hi}`));
            if (SKIP_KINDS.indexOf(entry.kind) !== -1) return;
            checked++;
            const should = decide(entry, lines);
            const explicit = typeof entry.perPerson === "boolean" ? entry.perPerson : null;
            const effective = explicit === null ? DEFAULT_PER_PERSON_KINDS.indexOf(entry.kind) !== -1 : explicit;
            if (effective !== should) {
              mismatches.push(`fields_data_${n}.js ${card.id} ${tag}#${ri} ${entry.kind}(value=${entry.value}) 目前=${effective ? "perPerson" : "shared"} 規則書=${should ? "perPerson" : "shared"}`);
            }
          });
        };
        walk(floor.reward, `b${bi}f${fi}`);
      });
    });
  });
}

console.log(`檢查了 ${checked} 筆可分流的樓層獎勵。`);
if (mismatches.length) {
  console.log(`[FAIL] ${mismatches.length} 筆與規則書原文不一致：`);
  mismatches.forEach((m) => console.log("  " + m));
  process.exit(1);
}
console.log("[PASS] 全部獎勵的 perPerson 標記與規則書原文一致。");
