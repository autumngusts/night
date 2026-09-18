// 恩寵（static_src/graces.js）の回歸測試。
//
// graces.js は night.js と midnight.js が共用する単一資料來源なので、ここが壊れると
// 両モードの恩寵が同時に死ぬ。ブラウザもFirebaseも要らない純粋なデータ／関数なので、
// 他のcheckスクリプトと違ってPlaywright無しで走る。
//
//   node tools/midnight_check/graces_check.js
//   （または tools/midnight_check で npm run test:graces）
//
// 検証するのは次の4点：
//   ① 規則書142頁の恩寵8種がすべて登録されているか（event_rulebook.js に恩寵として
//      書かれているのは 579/668/817/826/857/1091/1178/1227 の8件）
//   ② 保存形状が物件map（{id:true}）であること——付与を id 単位の rtSet で行うための前提
//   ③ v0.9.0以前の舊旗標（_nightBlessing 等）を読み取り相容していること
//   ④ night/midnight のHP刻度 1:10 換算が値として正しく引けること
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const gracesPath = path.resolve(__dirname, "..", "..", "static_src", "graces.js");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(gracesPath, "utf8"), sandbox, { filename: "graces.js" });

const G = sandbox.window.PriTestGraces;
let fail = 0;
function ok(cond, label) {
  console.log((cond ? "  OK   " : "  FAIL ") + label);
  if (!cond) fail++;
}

console.log("[登録]");
const ids = G.list().map((g) => g.id);
const expected = [
  "night_grace", // event_rulebook.js:579 夜の勢力
  "knowledge", // event_rulebook.js:668 虫の大量発生
  "unhealing_wound", // event_rulebook.js:817 襲撃・忌み鬼（PC死亡分支）
  "blessing_king", // event_rulebook.js:826 襲撃・忌み鬼
  "beast_hunt", // event_rulebook.js:1091 三つ首の獣
  "cold_mirage", // event_rulebook.js:1178 霧の裂け目
  "world_peace", // event_rulebook.js:1227 安寧者たち
  "fused_life", // event_rulebook.js:857 襲撃・兆し
];
ok(ids.length === expected.length, "恩寵は" + expected.length + "種 (実際 " + ids.length + ")");
expected.forEach((id) => ok(ids.includes(id), "登録あり: " + id));

console.log("[保存形式]");
const c = {};
ok(G.grant(c, "beast_hunt") === true, "grant で付与できる");
ok(G.grant(c, "beast_hunt") === false, "二重付与は false");
ok(c.graces && c.graces.beast_hunt === true, "c.graces は物件map {id:true}");
ok(!Array.isArray(c.graces), "陣列ではない（id単位rtSetの前提）");
ok(G.has(c, "beast_hunt") === true, "has が true");
ok(G.has(c, "cold_mirage") === false, "未所持は false");
ok(G.grant(c, "not_a_grace") === false, "未知idは付与されない");
ok(G.revoke(c, "beast_hunt") === true, "revoke できる");
ok(G.has(c, "beast_hunt") === false, "revoke 後は false");

console.log("[舊旗標相容]");
ok(G.has({ _nightBlessing: true }, "night_grace") === true, "_nightBlessing -> night_grace");
ok(G.has({ _fusedLife: true }, "fused_life") === true, "_fusedLife -> fused_life");
ok(G.has({ _insectKnowledgeBlessing: true }, "knowledge") === true, "_insectKnowledgeBlessing -> knowledge");
const legacy = { _nightBlessing: true };
G.revoke(legacy, "night_grace");
ok(G.has(legacy, "night_grace") === false, "revoke は舊旗標も落とす");

console.log("[モード別数値]");
ok(G.value("cold_mirage", "survivalHp", "night") === 1, "冷たい蜃気楼 night=1");
ok(G.value("cold_mirage", "survivalHp", "midnight") === 10, "冷たい蜃気楼 midnight=10");
ok(G.value("unhealing_wound", "extraHpDamage", "night") === 1, "癒えぬ傷 night=1");
ok(G.value("unhealing_wound", "extraHpDamage", "midnight") === 10, "癒えぬ傷 midnight=10");
ok(G.value("blessing_king", "powerModPerBlessing", "night") === 2, "祝福王 night=祝福数x2");
ok(G.value("blessing_king", "powerModPerBlessing", "midnight") === 1, "祝福王 midnight=地点数x1");
ok(G.value("blessing_king", "powerModMax", "midnight") === 10, "祝福王 midnight上限=10");
ok(JSON.stringify(G.value("world_peace", "selfRevivalFaces", "midnight")) === "[1,2]", "安寧 出目[1,2]は両モード共通");
ok(G.value("world_peace", "selfRevivalDamage", "night") === 120, "安寧 復帰ダメージ120");
ok(G.value("world_peace", "revivedHit1Bonus", "midnight") === 5, "安寧 復帰後1Hit+5");
ok(G.value("world_peace", "revivedHit2Bonus", "midnight") === 10, "安寧 復帰後2Hit+10");
ok(G.value("world_peace", "revivedSkillBonus", "midnight") === 5, "安寧 復帰後スキル+5");
ok(G.value("knowledge", "successFaces", "night").length === 1, "知の集約 成功出目1種");
ok(G.value("beast_hunt", "diceFaceFrom", "night") === 2 && G.value("beast_hunt", "diceFaceTo", "night") === 5, "獣の狩り 2->5");
ok(G.value("beast_hunt", "nope", "night") === null, "未定義キーは null");

console.log(fail === 0 ? "\n=== 全テスト通過 ===" : "\n=== 失敗 " + fail + " 件 ===");
process.exit(fail === 0 ? 0 : 1);
