// ============================================================================
// docs/midnight_relic_effects_gaps_by_type.md 產生器（純 node，不需要 Playwright／
// emulator）。midnight 尚未接上的遺物效果，依角色類型整理成表單供規劃使用。
// ============================================================================
// 分類與 relic_effect_audit.js 一致：
//   已生效 → ①midnight.js 直接判斷 ②威力補正／最大HP・FP／判定骰的通用解析
//            ③2Hit攻擊的達人（2026-09-11 實作，冷卻10秒版）
//   未接上 → 傷害固定加成／技藝技能強化／聖杯瓶／防禦／Action類／其他／回合制概念
// 分類是依規則本文措辭自動歸類，個別條目可能歸錯，動工前請直接核對該條本文。
//
// 執行方式：node relic_effect_gaps_table.js
// ============================================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.PRITEST_SRC || path.resolve(__dirname, "../../static_src");
const OUT = path.resolve(__dirname, "../../docs/midnight_relic_effects_gaps_by_type.md");

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(SRC, "character_types.js"), "utf8"), sandbox);
const CT = sandbox.window.PriTestCharacterTypes;
const midnightSrc = fs.readFileSync(path.join(SRC, "midnight.js"), "utf8");

const COVERED_BY_GENERIC = /「[^」]+」的威力補正設為「[+＋－-]\d+」|最大(?:HP|FP)|將自身「(?:精神|運氣|體能)[：:]/;
const TURN_BASED = /階段|回合|體力骰|骰子|前衛|後衛|敵視|陣形/;

function classify(e) {
  const zh = (e.name && e.name.zh) || "";
  const ja = (e.name && e.name.ja) || "";
  const body = (e.body && (e.body.zh || e.body.ja)) || "";
  if (midnightSrc.indexOf(zh) !== -1 || (ja && midnightSrc.indexOf(ja) !== -1)) return "OK_direct";
  if (COVERED_BY_GENERIC.test(body)) return "OK_generic";
  if (zh.indexOf("2Hit攻擊的達人") === 0) return "OK_mastery";
  if (e.kind === "Action") return "G_action";
  if (TURN_BASED.test(body)) return "G_turn";
  if (zh.indexOf("技藝強化") !== -1 || zh.indexOf("技能強化") !== -1) return "G_ability";
  if (body.indexOf("防禦") !== -1) return "G_defense";
  if (body.indexOf("聖杯瓶") !== -1) return "G_flask";
  if (/總合傷害|傷害「?[+＋]/.test(body)) return "G_damage";
  return "G_other";
}

const LABEL = {
  G_action: "Action類（沒有發動入口）",
  G_turn: "回合制概念（階段／回合／體力骰／前後衛／敵視）",
  G_ability: "技藝／技能強化",
  G_defense: "防禦相關",
  G_flask: "聖杯瓶相關",
  G_damage: "傷害固定加成",
  G_other: "其他",
};
// 表內排序：好動工的排前面，規則上不適用的（回合制概念）排最後
const ORDER = ["G_damage", "G_ability", "G_flask", "G_defense", "G_action", "G_other", "G_turn"];

let md = `# midnight 遺物效果：尚未接上的缺口一覽（依角色類型）

本表是 \`docs/midnight_relic_effects_audit.md\` 的附表，列出**目前在 midnight 不會發動**的
遺物效果，供規劃要補哪些。已生效的（midnight 直接判斷／威力補正・最大HP FP・判定骰的
通用解析／2026-09-11 實作的 2Hit攻擊的達人）不列在這裡。

- 產生方式：\`cd tools/midnight_check && node relic_effect_gaps_table.js\`（會直接覆寫本檔）
- 分類是依規則本文措辭自動歸類，個別條目可能歸錯，實際動工前請直接核對該條本文。
- 「回合制概念」那一類（最大宗）在規則結構上就不適用即時制，建議的處理是讓
  \`midnight_text_adapt.js\` 的 \`BODY_OVERRIDES\` 標示「本規則中不生效」，而不是實作。

`;

const rows = [];
CT.list().forEach((t) => {
  const items = [];
  (t.relicEffectGroups || []).forEach((g, gi) => {
    (g.effects || []).forEach((e, ei) => {
      if (!e || !e.name) return;
      const cls = classify(e);
      if (cls.indexOf("OK_") === 0) return;
      items.push({
        name: (e.name.zh || e.name.ja || "").trim(),
        kind: e.kind || "",
        cls: cls,
        body: ((e.body && (e.body.zh || e.body.ja)) || "").replace(/\s+/g, " ").slice(0, 70),
      });
    });
  });
  rows.push({ typeId: t.id, typeName: CT.localizedText(t.name), items: items });
});

const totalGaps = rows.reduce((s, r) => s + r.items.length, 0);
md += `**合計 ${totalGaps} 筆未接上**（全部 353 筆中）。\n\n`;
md += "| 角色類型 | 未接上筆數 |\n| --- | --- |\n";
rows.forEach((r) => (md += `| ${r.typeName} | ${r.items.length} |\n`));
md += "\n---\n\n";

rows.forEach((r) => {
  md += `## ${r.typeName}（\`${r.typeId}\`）\n\n`;
  if (!r.items.length) {
    md += "（無）\n\n";
    return;
  }
  md += "| 效果名稱 | kind | 缺口分類 | 規則本文（節錄） |\n| --- | --- | --- | --- |\n";
  r.items
    .slice()
    .sort((a, b) => ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls))
    .forEach((it) => {
      md += `| ${it.name} | ${it.kind} | ${LABEL[it.cls]} | ${it.body} |\n`;
    });
  md += "\n";
});

fs.writeFileSync(OUT, md, "utf8");
console.log(`已輸出 ${OUT}（共 ${totalGaps} 筆未接上）`);
