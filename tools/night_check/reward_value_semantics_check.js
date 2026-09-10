// ============================================================================
// night（回合制）獎勵清單：各 kind 的 value 語意回歸測試
// ============================================================================
// 背景（2026-09-10 使用者明確確認）：「潛在之力★★」＝「★2 稀有度」**一次**抽選。
// `kind: "potentialPower"` 的 value 是決定武器稀有度時要擲的 D6 顆數（跟 weaponStar 相同），
// **不是抽選次數**。舊版 night_floor_breakthrough.js 把它跟 consumable/talisman 一樣依 value
// 拆成 N 筆 value:1，等於把 ★2 降成兩次 ★1 抽選，稀有度期望值被改掉。
//
// 這支腳本用 node 直接載入建置後的 dist/static/night_floor_breakthrough.js（純 IIFE，只需要
// 極少量的 window/document stub），驗證 floorRewardEntryToTurnRewards() 對三種容易搞混的
// kind 的處理，避免這個錯誤在未來被「順手改回去」：
//   - potentialPower：value＝★數 → 每人 1 筆、value 保持原值（不可拆）。
//   - weaponSkillReroll：value＝可再抽選的次數 → 每人拆成 value 筆 value:1。
//   - weaponStar：value＝★數 → 正規化成 kind:"weapon"，value 保持原值。
//
// 使用前準備：先執行 `python generate.py` 產生 dist/。
// 執行方式：node tools/night_check/reward_value_semantics_check.js
// ============================================================================

const path = require("path");

const DIST_MODULE = path.resolve(__dirname, "../../dist/static/night_floor_breakthrough.js");

const results = [];
function assert(cond, label) {
  results.push({ label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label);
}

// night_floor_breakthrough.js 是瀏覽器端 IIFE，載入時只會讀 window/document，不會真的操作 DOM
// （實際的 DOM 存取都在函式內部、被呼叫時才發生）。這裡給最小 stub 讓它能在 node 下載入。
global.window = {
  PriTestNightCore: {
    TURN_REWARD_SHARED_TARGET_VALUE: "__shared__",
    TURN_REWARD_ANY_TARGET_VALUE: "__any__",
  },
};
global.document = {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, toggle() {} }, appendChild() {} }),
};

require(DIST_MODULE);
const FB = global.window.PriTestNightFloorBreakthrough;
if (!FB || typeof FB.floorRewardEntryToTurnRewards !== "function") {
  console.error("載入失敗：window.PriTestNightFloorBreakthrough.floorRewardEntryToTurnRewards 不存在（dist/ 是否已建置？）");
  process.exit(1);
}

const entered = [{ id: "c1" }, { id: "c2" }];
const brief = (objs) => objs.map((o) => ({ kind: o.kind, target: o.targetCharacterId, value: o.value }));

console.log("=== potentialPower：value＝★數，一次抽選，不可依 value 拆項 ===");
const pp = brief(FB.floorRewardEntryToTurnRewards({ kind: "potentialPower", perPerson: true, value: 2 }, entered, "pp"));
console.log("  " + JSON.stringify(pp));
assert(pp.length === entered.length, "潛在之力★2：每位參加者各 1 筆（共 " + entered.length + " 筆），實際 " + pp.length + " 筆");
assert(
  pp.every((o) => o.value === 2),
  "潛在之力★2：每筆 value 維持 2（★數），沒有被降成 1"
);
assert(
  pp.every((o) => o.kind === "potentialPower") && pp.map((o) => o.target).join(",") === "c1,c2",
  "潛在之力★2：kind 維持 potentialPower，且逐一指定給每位參加者"
);

console.log("=== weaponSkillReroll：value＝次數，仍要拆成每次 1 筆 ===");
const rr = brief(FB.floorRewardEntryToTurnRewards({ kind: "weaponSkillReroll", value: 2 }, entered, "rr"));
console.log("  " + JSON.stringify(rr));
assert(rr.length === entered.length * 2, "戰技再抽選 x2：拆成每人 2 筆（共 4 筆），實際 " + rr.length + " 筆");
assert(
  rr.every((o) => o.value === 1),
  "戰技再抽選 x2：拆開後每筆 value 為 1"
);

console.log("=== weaponStar：value＝★數，正規化成 kind:\"weapon\" ===");
const ws = brief(FB.floorRewardEntryToTurnRewards({ kind: "weaponStar", value: 2 }, entered, "ws"));
console.log("  " + JSON.stringify(ws));
assert(ws.length === 1 && ws[0].kind === "weapon", "武器★2：轉成單筆 kind:\"weapon\"，實際 " + JSON.stringify(ws));
assert(ws[0] && ws[0].value === 2, "武器★2：value 維持 2（★數）");

console.log("=== consumable：value＝個數，仍要拆成每個 1 筆 ===");
const cs = brief(FB.floorRewardEntryToTurnRewards({ kind: "consumable", value: 3 }, entered, "cs"));
console.log("  " + JSON.stringify(cs));
assert(cs.length === 3 && cs.every((o) => o.value === 1), "消耗品 x3：拆成 3 筆 value:1，實際 " + cs.length + " 筆");

const failed = results.filter((r) => !r.pass);
console.log("\n===== 結果：" + (results.length - failed.length) + "/" + results.length + " 通過 =====");
failed.forEach((r) => console.log("  FAIL: " + r.label));
process.exit(failed.length ? 1 : 0);
