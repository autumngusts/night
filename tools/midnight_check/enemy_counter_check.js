// 防禦反擊型招式的反擊效果檢查。
//
//   node tools/midnight_check/enemy_counter_check.js
//
// 設計文件：docs/superpowers/specs/2026-09-21-midnight-enemy-counter-design.md §7.1
// enemy_counter_rules.js 是純函式模組（不讀遊戲狀態），丟進 vm 沙箱就能直接呼叫。
// midnight.js 那邊的呼叫端（maybeTriggerEnemyCounter 等）依賴 RTDB 與計時器，不在這裡測——
// 由瀏覽器實機確認擔保（設計文件 §7.3）。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(ROOT, "static_src", "enemy_counter_rules.js"), "utf8"),
  sandbox,
  { filename: "enemy_counter_rules.js" }
);
["1", "2", "3", "4"].forEach(function (n) {
  const p = path.join(ROOT, "static_src", "enemies_data_" + n + ".js");
  vm.runInContext(fs.readFileSync(p, "utf8"), sandbox, { filename: "enemies_data_" + n + ".js" });
});

const R = sandbox.window.PriTestEnemyCounterRules;
const FAMILIES = [].concat(
  sandbox.window.PriTestEnemiesData1,
  sandbox.window.PriTestEnemiesData2,
  sandbox.window.PriTestEnemiesData3,
  sandbox.window.PriTestEnemiesData4
);

let failed = 0;
function ok(cond, label) {
  console.log((cond ? "  OK  " : "  NG  ") + " " + label);
  if (!cond) failed++;
}

// ---- 招式名の実データに対する命中集合 ----
console.log("[反擊対象の招式]");
const names = {};
FAMILIES.forEach(function (f) {
  f.enemies.forEach(function (e) {
    (e.actions || []).forEach(function (a) {
      if (!a || !a.name || !a.name.ja) return;
      names[a.name.ja] = (names[a.name.ja] || 0) + 1;
    });
  });
});
const rows = Object.keys(names).reduce(function (s, n) {
  return s + names[n];
}, 0);
ok(rows === 549, "招式は549筆 (実際 " + rows + ")");

const hit = Object.keys(names).filter(function (n) {
  return R.isCounterAction(n);
});
const hitRows = hit.reduce(function (s, n) {
  return s + names[n];
}, 0);
const EXPECT_HIT = [
  "ガードカウンター",
  "ハイガード＆ガードカウンター",
  "バックラーパリィ",
  "弾き＆妖刀解放",
];
ok(hit.length === 4 && hitRows === 6, "対象は4名6筆 (実際 " + hit.length + "名" + hitRows + "筆)");
EXPECT_HIT.forEach(function (n) {
  ok(hit.indexOf(n) !== -1, "対象に含まれる: " + n);
});
const unexpected = hit.filter(function (n) {
  return EXPECT_HIT.indexOf(n) === -1;
});
ok(unexpected.length === 0, "想定外の命中なし" + (unexpected.length ? " (" + unexpected.join("／") + ")" : ""));

// 補標時給了攻擊動畫的「攻擊為主、防禦附隨」複合技不列入對象（設計文件 §3）
console.log("[攻擊主体の複合技は対象外]");
[
  "盾撃",
  "突撃指令＆防御態勢",
  "踏み込み＆盾ガード",
  "時間差攻撃＆黄金の返報",
  "薙ぎ払い＆防御態勢",
  "斧槍振り回し＆防御態勢",
  "斧槍薙ぎ払い＆盾構え",
  "槍突き＆盾ガード",
  "構え斬り",
  "我慢＆薙ぎ払い",
  "突撃指令＆剣聖の見切り",
  "盾構え突き",
  "盾殴り＆黄金の返報",
].forEach(function (n) {
  ok(!R.isCounterAction(n), "対象外: " + n);
});

// 實際執行時傳進來的不是字串，而是 action.name 的多語物件
// （enemyAttack.actionName，見 maybeStartEnemyAttack()）。這裡搞錯的話反擊會永遠不發動，
// 所以用實際資料原本的形狀確認能通過。
console.log("[実データの多言語オブジェクト形状]");
const rawNames = [];
FAMILIES.forEach(function (f) {
  f.enemies.forEach(function (e) {
    (e.actions || []).forEach(function (a) {
      if (a && a.name && a.name.ja) rawNames.push(a.name);
    });
  });
});
const rawHitRows = rawNames.filter(function (o) {
  return R.isCounterAction(o);
});
ok(rawHitRows.length === 6, "action.name オブジェクトをそのまま渡して6筆命中 (実際 " + rawHitRows.length + ")");
ok(
  typeof rawNames[0] === "object",
  "前提確認：action.name は文字列ではなくオブジェクト（" + JSON.stringify(rawNames[0]) + "）"
);
ok(R.isCounterAction({ ja: "ガードカウンター", zh: "格擋反擊" }) === true, "{ja,zh} で ja を見る");
ok(R.isCounterAction({ zh: "格擋反擊" }) === false, "ja が無いオブジェクトは false");

console.log("[異常値の入力]");
ok(R.isCounterAction(null) === false, "null は false");
ok(R.isCounterAction("") === false, "空文字は false");
ok(R.isCounterAction(undefined) === false, "undefined は false");
ok(R.isCounterAction({}) === false, "空オブジェクトは false");

// ---- 反擊傷害 ----
console.log("[反擊傷害は原招式の半分]");
ok(R.counterDamage(120) === 60, "120 -> 60");
ok(R.counterDamage(240) === 120, "240 -> 120");
ok(R.counterDamage(15) === 8, "15 -> 8 (Math.round は上へ)");
ok(R.counterDamage(13) === 7, "13 -> 7");
ok(R.counterDamage(0) === 0, "0 -> 0 (傷害不明の招式、CLAUDE.md §19 で数値を発明しない)");
ok(R.counterDamage(-50) === 0, "負値 -> 0");
ok(R.counterDamage(undefined) === 0, "undefined -> 0");

// ---- 反擊下数 ----
console.log("[反擊下数は1~2各50%]");
ok(R.pickCounterHitCount(0) === 1, "0 -> 1");
ok(R.pickCounterHitCount(0.499) === 1, "0.499 -> 1");
ok(R.pickCounterHitCount(0.5) === 2, "0.5 -> 2");
ok(R.pickCounterHitCount(0.999) === 2, "0.999 -> 2");

// ---- 定数 ----
console.log("[窗口の定数]");
ok(R.COUNTER_WINDOW_MS === 2000, "誘発窗口は2000ms");
ok(R.COUNTER_REACTION_WINDOW_MS === 1000, "反應窗口は1000ms（一般攻擊の2000/2500/3000より短い）");

// ---- midnight.js 那邊的結線（設計文件 §5.4 的「兩處都要改」有沒有守住）----
console.log("[midnight.js の結線]");
const mn = fs.readFileSync(path.join(ROOT, "static_src", "midnight.js"), "utf8");
ok(
  (mn.match(/enemyAttackHitWindowMs\(st\.hitIndex\)/g) || []).length === 0,
  "旧来の enemyAttackHitWindowMs(st.hitIndex) 直呼びは残っていない"
);
ok(
  (mn.match(/incomingHitWindowMs\(st\)/g) || []).length === 3,
  "incomingHitWindowMs(st) は定義1＋呼び出し2＝3箇所（片方だけ直すと1下目1秒/2下目2秒になる）"
);
ok(
  (mn.match(/enemyAttackHitWindowMs\(/g) || []).length === 3,
  "enemyAttackHitWindowMs() は定義1＋incomingHitWindowMs内1＋enemyAttackTotalDurationMs内1＝3箇所"
);
ok(mn.indexOf("maybeTriggerEnemyCounter(pointId);") !== -1, "damageCombatTarget() から誘発判定を呼んでいる");
ok(mn.indexOf("if (!spriteModeEnabled()) return;") !== -1, "spriteMode 未勾選なら発動しない閘門がある");

// 建置側の結線。midnight_page.py に <script> を足しただけでは dist に実ファイルが
// 出力されず、404 でモジュールごと読み込まれない（コピー一覧は generate.py 側が持つ）。
console.log("[建置の結線]");
const pageSrc = fs.readFileSync(path.join(ROOT, "site_src", "midnight_page.py"), "utf8");
const genSrc = fs.readFileSync(path.join(ROOT, "generate.py"), "utf8");
ok(pageSrc.indexOf('"enemy_counter_rules.js"') !== -1, "midnight_page.py の script 一覧に入っている");
ok(genSrc.indexOf('"enemy_counter_rules.js"') !== -1, "generate.py のコピー一覧にも入っている（入れ忘れると dist で 404）");
ok(
  pageSrc.indexOf('"enemy_counter_rules.js"') < pageSrc.indexOf('"midnight.js"'),
  "script 順序が midnight.js より前（後ろだと CounterRules が undefined）"
);

console.log("");
if (failed) {
  console.log("=== " + failed + " 件 NG ===");
  process.exit(1);
}
console.log("=== 全テスト通過 ===");
