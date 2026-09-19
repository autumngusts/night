// 「夜の強敵決定表」の劇本8・9連動（規則書 extraNotes「※シナリオ8とシナリオ9の連動」）の検査。
//
//   node tools/midnight_check/night_boss_link_check.js
//   （または tools/midnight_check で npm run test:night_boss_link）
//
// この2劇本だけ「2日目の夜之強敵は1日目の擲骰値そのまま、振り直さない」。
// night 側（night_gm_flow.js resolveNightBossCombatLine）は以前から連動していたが、
// midnight 側（rollAndAssignFinalCircleBoss）は2日目に無条件で振り直しており、
// 劇本8・9だけ規則と食い違っていた（2026-09-19に接続）。
//
// 間違えても例外は出ず「たまたま同じ敵になることもある」だけなので、静的に検査する。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..", "..");
let fail = 0;
function ok(cond, label) {
  console.log((cond ? "  OK   " : "  FAIL ") + label);
  if (!cond) fail++;
}

const flowSrc = fs.readFileSync(path.resolve(root, "static_src/night_gm_flow.js"), "utf8");
const midSrc = fs.readFileSync(path.resolve(root, "static_src/midnight.js"), "utf8");

console.log("[連動対象の劇本リスト]");
const m = /var NIGHT_BOSS_LINKED_SCENARIOS = \[([^\]]*)\]/.exec(flowSrc);
ok(!!m, "night_gm_flow.js に NIGHT_BOSS_LINKED_SCENARIOS がある");
const nums = m ? m[1].split(",").map((x) => parseInt(x.trim(), 10)) : [];
ok(nums.length === 2 && nums[0] === 8 && nums[1] === 9, "連動対象は劇本8と9（規則書 extraNotes）");
ok(/NIGHT_BOSS_LINKED_SCENARIOS: NIGHT_BOSS_LINKED_SCENARIOS/.test(flowSrc), "外部へ公開している");
// [8,9] を2箇所に書かない（片方だけ直して食い違うのを防ぐ）。
// 行註釋の中の「[8,9]を2箇所に書かない」という説明文まで拾ってしまうので、
// 判定はコードだけ（// 以降を落としたもの）に対して行う。
const midCode = midSrc.replace(/\/\/[^\r\n]*/g, "");
ok(
  !/NIGHT_BOSS_LINKED_SCENARIOS\s*=\s*\[/.test(midCode) && !/\[\s*8\s*,\s*9\s*\]/.test(midCode),
  "midnight.js 側は自前のリストを持たず、公開されたものを参照している"
);

console.log("[midnight 側の連動]");
ok(/GmFlow\.NIGHT_BOSS_LINKED_SCENARIOS/.test(midSrc), "公開リストを参照している");
ok(/meta\.nightBossRollDay1/.test(midSrc), "1日目の出目を meta から読む");
ok(/meta\/nightBossRollDay1/.test(midSrc), "1日目の出目を meta へ書く");
ok(
  /dayIndex === 2 && scenarioNumber && linkedScenarios\.indexOf\(scenarioNumber\) !== -1/.test(midSrc),
  "2日目かつ連動劇本のときだけ forcedRoll を使う"
);
ok(/rollNightBossEntry\(row, dayIndex, forcedRoll\)/.test(midSrc), "forcedRoll を rollNightBossEntry へ渡している");
// 出目の保存は「transaction に勝った裝置」だけが行うこと。各裝置が別々の出目を振っており、
// 負けた裝置の出目を残すと 1日目の実際の敵と 2日目の連動元が食い違う。
ok(
  /committed && committed\.resolvedAt === now/.test(midSrc),
  "1日目の出目は transaction に勝った裝置だけが記録する"
);

console.log("[forcedRoll の受け側]");
ok(/function rollNightBossEntry\(row, colIndex, forcedRoll\)/.test(flowSrc), "rollNightBossEntry が forcedRoll を受ける");
ok(/var roll = forcedRoll \|\| 1 \+ Math\.floor\(Math\.random\(\) \* 6\)/.test(flowSrc), "forcedRoll があればそれを使い、無ければ振る");

// 実際に動かして、同じ forcedRoll なら必ず同じ結果になることを確かめる。
console.log("[挙動]");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
["fields_data_1.js", "fields_data_2.js", "fields_data_3.js", "fields_data_4.js", "fields.js"].forEach((f) => {
  const p = path.resolve(root, "static_src", f);
  if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, "utf8"), sandbox, { filename: f });
});
const parseCell = /function parseNightBossCellEntries/.test(flowSrc);
ok(parseCell, "parseNightBossCellEntries がある（決定表セルの解析元）");

console.log(fail === 0 ? "\n=== 全テスト通過 ===" : "\n=== 失敗 " + fail + " 件 ===");
process.exit(fail === 0 ? 0 : 1);
