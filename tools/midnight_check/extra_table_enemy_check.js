// ============================================================================
// 板塊卡片「自身extraTables決定表」敵人引用的窮舉驗證（純 node，不需 Playwright／emulator）
// ============================================================================
// 2026-09-21 使用者回報「封牢使用鑰匙必須一定要產生一個敵人戰鬥，有些劇本配地圖會無法產生
// 隨機敵人」。根因：midnight.js 的 scanLinesForEnemyMatches() 原本只認具體敵名 bullet，
// 「封牢エネミー決定表で決定したエネミー」這類「引用卡片自身 extraTables」的 bullet 永遠
// 查不到敵人 → 被當成和平通過。修正後改用 night_gm_flow.js 既有的
// findExtraTableByBulletLine()＋rollStrongEnemyTable()（新增可注入 rng）解決。
//
// 這支腳本驗證的是「資料面」：對 fields_data_1~4.js 每張卡的每一行，若
// findExtraTableByBulletLine() 找得到表，就把 1D6×1D6 全部 36 種出目餵給
// rollStrongEnemyTable()，確認：
//   ① 每一種出目都解得出條目（表格骰欄格式沒有漏洞）。
//   ② 每個條目的名稱都能用 resolveCombatEnemyMatch() 對到 enemies_data_1~4.js 的敵人
//     （對不到的話 midnight 會退回 randomEnemyMatchFallback()，不會卡死，但那是退回結果，
//     不是規則書表定的敵人——列出來供人工修資料）。
//   ③ rollStrongEnemyTable(table, rng) 給同一個 rng 序列時結果一致（決定性）。
// 另外針對 card_9（封牢／神殿）三個分歧的第 1 層，確認整層掃描一定至少找得到一行決定表引用
// （midnight 對 evergaol 的整層退回掃描依賴這一點）。
//
// 執行：node extra_table_enemy_check.js（有 ② 落空時 exit 1；--md 輸出 Markdown）
// ============================================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.PRITEST_SRC || path.resolve(__dirname, "../../static_src");
const AS_MD = process.argv.indexOf("--md") !== -1;

const stubEl = { style: {}, dataset: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {} } };
const sandbox = {
  window: {},
  console,
  setTimeout,
  clearTimeout,
  document: {
    createElement: () => stubEl,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    body: { appendChild() {} },
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: "node" },
};
sandbox.window.document = sandbox.document;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.addEventListener = () => {};
sandbox.window.I18N = { t: (k) => k, current: () => "zh" };
vm.createContext(sandbox);

[
  "enemies_data_1.js",
  "enemies_data_2.js",
  "enemies_data_3.js",
  "enemies_data_4.js",
  "enemies.js",
  "fields_data_1.js",
  "fields_data_2.js",
  "fields_data_3.js",
  "fields_data_4.js",
  "fields.js",
  "night_gm_flow.js",
].forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), "utf8"), sandbox));

const GmFlow = sandbox.window.PriTestNightGmFlow;
const Fields = sandbox.window.PriTestFields;
if (!GmFlow.findExtraTableByBulletLine) throw new Error("night_gm_flow.js 沒有匯出 findExtraTableByBulletLine——修正已被還原？");

// 固定出目序列 rng：依序回傳 die1/die2 的 [0,1) 值；表格 reroll 行（「振り直す」）會再消耗
// 兩個值，序列用完後退回 0.5（=出目4）避免無限迴圈。
function fixedRng(seq) {
  let i = 0;
  return () => (i < seq.length ? (seq[i++] - 1) / 6 : 0.5);
}

const results = []; // { card, branch, floor, table, missing: [entryJa...], unresolvedDice: [...], entries: n }
let hasFailure = false;

Fields.list().forEach((card) => {
  (card.branches || []).forEach((branch, bi) => {
    (branch.floors || []).forEach((floor, fi) => {
      (floor.lines || []).forEach((line) => {
        const table = GmFlow.findExtraTableByBulletLine(card, line);
        if (!table) return;
        const rec = { card: card.id, branch: branch.name.zh, floor: fi + 1, table: table.title.zh, entries: 0, missing: [], unresolvedDice: [] };
        const seenEntry = {};
        for (let d1 = 1; d1 <= 6; d1++) {
          for (let d2 = 1; d2 <= 6; d2++) {
            const rolled = GmFlow.rollStrongEnemyTable(table, fixedRng([d1, d2]));
            if (!rolled) {
              rec.unresolvedDice.push(d1 + "/" + d2);
              continue;
            }
            const again = GmFlow.rollStrongEnemyTable(table, fixedRng([d1, d2]));
            if (!again || again.entry !== rolled.entry) throw new Error("rollStrongEnemyTable 不是決定性的：" + rec.table + " " + d1 + "/" + d2);
            const ja = rolled.entry.ja || "";
            if (seenEntry[ja]) continue;
            seenEntry[ja] = true;
            rec.entries++;
            const ref = GmFlow.parseCombatEnemyRef({ text: { ja: "「" + ja + "」", zh: "「" + (rolled.entry.zh || "") + "」" } });
            let match = null;
            for (let i = 0; i < ref.nameTokens.length && !match; i++) match = GmFlow.resolveCombatEnemyMatch(ref.nameTokens[i]);
            if (!match) rec.missing.push(ja);
          }
        }
        if (rec.missing.length || rec.unresolvedDice.length) hasFailure = true;
        results.push(rec);
      });
    });
  });
});

// card_9 三分歧第 1 層：整層一定要有至少一行決定表引用
const card9 = Fields.get("card_9");
const card9Missing = [];
(card9.branches || []).forEach((branch) => {
  const floor = branch.floors[0];
  const found = (floor.lines || []).some((line) => !!GmFlow.findExtraTableByBulletLine(card9, line));
  if (!found) card9Missing.push(branch.name.zh);
});
if (card9Missing.length) hasFailure = true;

if (AS_MD) {
  console.log("| 卡 | 分歧 | 層 | 決定表 | 條目數 | 對不到敵人的條目 | 解不出的出目 |");
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  results.forEach((r) => console.log(`| ${r.card} | ${r.branch} | ${r.floor} | ${r.table} | ${r.entries} | ${r.missing.join("、") || "-"} | ${r.unresolvedDice.join(" ") || "-"} |`));
} else {
  results.forEach((r) => {
    const ok = !r.missing.length && !r.unresolvedDice.length;
    console.log(`${ok ? "OK  " : "NG  "} ${r.card} / ${r.branch} / 樓層${r.floor} / ${r.table}：${r.entries} 條目`);
    r.missing.forEach((m) => console.log("      對不到敵人：" + m));
    r.unresolvedDice.forEach((d) => console.log("      解不出出目：" + d));
  });
  if (card9Missing.length) console.log("NG  card_9 第1層沒有任何決定表引用的分歧：" + card9Missing.join("、"));
  else console.log("OK  card_9 三分歧第1層整層掃描都找得到決定表引用");
  console.log(`\n共 ${results.length} 處決定表引用，${results.filter((r) => r.missing.length || r.unresolvedDice.length).length} 處有落空`);
}
process.exit(hasFailure ? 1 : 0);
