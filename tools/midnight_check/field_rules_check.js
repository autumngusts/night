// 場地卡の追加ルール（static_src/field_rules.js）の回歸測試。
//
//   node tools/midnight_check/field_rules_check.js
//   （または tools/midnight_check で npm run test:field_rules）
//
// field_rules.js は「どの追加ルールが存在するか」と「自動適用に必要なパラメータ」だけを
// 持ち、規則原文は fields_data_*.js の branch.specialRule が単一資料來源。だから一番
// 壊れやすいのは**その2つの対応付け**：
//   ① 登録したルールが実在しない（detect が1枚のカードにも当たらない＝死んだ定義）
//   ② detect が別のルールの本文や散文に誤爆する（＝関係ないフィールドで効果が出る）
// この2つを実データ全件に対して突き合わせる。ブラウザもFirebaseも不要。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..", "..");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
["fields_data_1.js", "fields_data_2.js", "fields_data_3.js", "fields_data_4.js", "field_rules.js"].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(root, "static_src", f), "utf8"), sandbox, { filename: f });
});

const FR = sandbox.window.PriTestFieldRules;
let fail = 0;
function ok(cond, label) {
  console.log((cond ? "  OK   " : "  FAIL ") + label);
  if (!cond) fail++;
}

// 全カードの branch.specialRule を集める（fields_data のネストは card > branches）。
const specialRules = [];
[1, 2, 3, 4].forEach((n) => {
  const cards = sandbox.window["PriTestFieldsData" + n] || [];
  cards.forEach((card) => {
    (card.branches || []).forEach((br) => {
      if (br.specialRule) specialRules.push({ file: "fields_data_" + n + ".js", card: card.id || card.name, text: br.specialRule });
    });
  });
});

console.log("[データ規模]");
ok(specialRules.length > 0, "specialRule を持つ branch を " + specialRules.length + " 件検出");
const rules = FR.list();
console.log("  登録ルール数: " + rules.length);

console.log("[① 登録したルールが実在するか]");
rules.forEach((r) => {
  const hits = specialRules.filter((s) => (s.text.ja || "").indexOf(r.detect) !== -1);
  ok(hits.length > 0, r.id + " (" + r.detect + ") は " + hits.length + " 枚のカードで有効");
});

console.log("[② detect の誤爆チェック]");
// あるルールの detect が、別ルールの名前の一部になっていないか（部分一致の共食い）。
rules.forEach((a) => {
  const swallowed = rules.filter((b) => b.id !== a.id && b.detect.indexOf(a.detect) !== -1);
  ok(swallowed.length === 0, a.id + " の detect は他ルール名に埋もれていない" + (swallowed.length ? "（衝突: " + swallowed.map((x) => x.id).join(", ") + "）" : ""));
});

console.log("[③ 実データでの検出結果]");
let detectedTotal = 0;
const perRule = {};
specialRules.forEach((s) => {
  const ids = FR.detect(s.text);
  detectedTotal += ids.length;
  ids.forEach((id) => {
    perRule[id] = (perRule[id] || 0) + 1;
  });
});
ok(detectedTotal > 0, "specialRule 全件から追加ルールを計 " + detectedTotal + " 件検出");
rules.forEach((r) => {
  console.log("    " + (perRule[r.id] || 0) + " 枚 : " + r.id + " / " + r.name.ja);
});
ok(
  rules.every((r) => (perRule[r.id] || 0) > 0),
  "登録した全ルールが実データで1枚以上検出される"
);

console.log("[④ パラメータの整合]");
// ■/□ 由来のHP量は night 1格 : midnight 10 の換算で揃っていること。
const hpKeys = [
  ["lava", "hpDamage"],
  ["ballista", "hpDamageOnFailure"],
];
hpKeys.forEach(([id, key]) => {
  const n = FR.value(id, key, "night");
  const m = FR.value(id, key, "midnight");
  ok(m === n * 10, id + "." + key + " midnight(" + m + ") = night(" + n + ") x10");
});
FR.get("growing_presence").variants.forEach((v) => {
  const amt = v.hpHeal || v.hpDamage;
  ok(amt.midnight === amt.night * 10, "growing_presence." + v.id + " も 1:10 換算");
});
// 状態異常系は「どの異常か」が必ず埋まっていること（空だと黙って何も蓄積しない）。
rules
  .filter((r) => r.kind === "ailmentAccum")
  .forEach((r) => {
    ok(!!r.ailment, r.id + " に対象の状態異常が設定されている（" + r.ailment + "）");
  });
// 行為判定を持つルールは target/stat が揃っていること。
rules.forEach((r) => {
  const checks = r.checks || (r.check ? [r.check] : []);
  checks.forEach((c, i) => {
    ok(typeof c.target === "number" && !!c.stat, r.id + " の判定" + (i + 1) + " は目標値と能力が揃っている");
  });
});

console.log("[⑤ 他モジュールとの参照整合]");
// negatedByGraceId が graces.js に実在するか（恩寵側をリネームしたら気づけるように）。
vm.runInContext(fs.readFileSync(path.join(root, "static_src", "graces.js"), "utf8"), sandbox, { filename: "graces.js" });
const G = sandbox.window.PriTestGraces;
rules
  .filter((r) => r.negatedByGraceId)
  .forEach((r) => {
    ok(!!G.get(r.negatedByGraceId), r.id + " を無効化する恩寵 " + r.negatedByGraceId + " が graces.js に実在");
  });

console.log(fail === 0 ? "\n=== 全テスト通過 ===" : "\n=== 失敗 " + fail + " 件 ===");
process.exit(fail === 0 ? 0 : 1);
