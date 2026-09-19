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

console.log("[登録：隨機事件由来 event_rulebook.js]");
const ids = G.list().map((g) => g.id);
const fromEvents = [
  "night_grace", // event_rulebook.js:579 夜の勢力
  "knowledge", // event_rulebook.js:668 虫の大量発生
  "unhealing_wound", // event_rulebook.js:817 襲撃・忌み鬼（PC死亡分支）
  "blessing_king", // event_rulebook.js:826 襲撃・忌み鬼
  "beast_hunt", // event_rulebook.js:1091 三つ首の獣
  "cold_mirage", // event_rulebook.js:1178 霧の裂け目
  "world_peace", // event_rulebook.js:1227 安寧者たち
  "fused_life", // event_rulebook.js:857 襲撃・兆し
];
fromEvents.forEach((id) => ok(ids.includes(id), "登録あり: " + id));

console.log("[登録：場地卡由来 fields_data_*.js]");
const fromFields = [
  "rotten_forest", // fields_data_4.js:2288/2503/2771 腐れ森
  "mountain_peak", // fields_data_4.js:2895 氷雪の山嶺
  "great_cavern", // fields_data_4.js:3613 大空洞
  "hidden_city", // fields_data_4.js:3804 隠れ都ノクラテオ
  "great_rune_mirage", // fields_data_3.js:2619 大ルーンの虚像
];
fromFields.forEach((id) => ok(ids.includes(id), "登録あり: " + id));

const expected = fromEvents.concat(fromFields);
ok(ids.length === expected.length, "恩寵は" + expected.length + "種 (実際 " + ids.length + ")");
ok(
  G.list().every((g) => g.src && /^(event_rulebook|fields_data_)/.test(g.src)),
  "全恩寵が規則原文の出典(src)を持つ"
);

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

console.log("[場地卡由来の数値]");
// 「□」の個数がそのまま格数（既存前例 midnight.js lowHpThreshold の「規則書の□□□＝3」）。
// 最大HP/FPの加算は「格」単位のまま（midnight側で ×10 されるので二重に掛けない）。
ok(G.value("rotten_forest", "maxHpBonus", "night") === 2, "腐れ森 最大HP+□□=+2格");
ok(G.value("rotten_forest", "maxHpBonus", "midnight") === 2, "腐れ森 格数はモード非依存（midnight側で×10）");
ok(G.value("rotten_forest", "rotImmune", "night") === true, "腐れ森 耐性:腐敗");
ok(G.value("mountain_peak", "frostbiteAccumMaxBonus", "night") === 4, "山嶺 凍傷蓄積最大+4");
ok(G.value("mountain_peak", "frostbiteDamageReduce", "night") === 1, "山嶺 凍傷HP損害軽減 night=1");
ok(G.value("mountain_peak", "frostbiteDamageReduce", "midnight") === 10, "山嶺 凍傷HP損害軽減 midnight=10");
ok(G.value("mountain_peak", "staminaDiceFace", "night") === 3, "山嶺 追加スタミナダイス=骰子點數3");
ok(G.value("mountain_peak", "blizzardVisionImmune", "night") === true, "山嶺 吹雪の視界を無効化");
ok(G.value("great_cavern", "artsRecoverOnFlaskEmpty", "night") === 1, "大空洞 聖杯瓶0でアーツ+1回復");
ok(G.value("great_cavern", "crystalCurseImmune", "night") === true, "大空洞 結晶の呪気を無効化");
ok(G.value("hidden_city", "wanderingBlessingMaxBonus", "night") === 1, "隠れ都 さまよう祝福の上限+1");
ok(G.value("hidden_city", "revivedMaxHpBonus", "night") === 1, "隠れ都 蘇生後 最大HP+□=+1格");
ok(G.value("hidden_city", "revivedMaxFpBonus", "night") === 1, "隠れ都 蘇生後 最大FP+□=+1格");
ok(G.value("hidden_city", "revivedRestoreAllUses", "night") === true, "隠れ都 蘇生後 使用回数を全回復");
ok(G.value("great_rune_mirage", "artsMaxUsesBonus", "night") === 1, "大ルーンの虚像 アーツ最大使用回数+1");
ok(G.value("great_rune_mirage", "nonUndertakerOncePerTurn", "night") === true, "大ルーンの虚像 葬儀屋以外は1ターン1回");

console.log("[1:10 換算の一貫性]");
// ダメージ量そのものを持つ欄位は、すべて midnight = night × 10 になっていること。
[
  ["unhealing_wound", "extraHpDamage"],
  ["cold_mirage", "survivalHp"],
  ["mountain_peak", "frostbiteDamageReduce"],
].forEach(([id, key]) => {
  const n = G.value(id, key, "night");
  const m = G.value(id, key, "midnight");
  ok(m === n * 10, id + "." + key + " midnight(" + m + ") = night(" + n + ") x10");
});

console.log("[呼び出し側との id 整合]");
// midnight.js / night.js / character_drawer.js が使っている恩寵idが graces.js に実在するか。
// id をリネームしたときや GRACE_* 定数を打ち間違えたときに、静かに「恩寵を持っていない」
// 扱いになって効果が丸ごと死ぬのを防ぐ（value() も get() も未知idでは null を返すだけなので
// 実行時エラーにならず気づけない）。
const idSet = new Set(ids);
const callers = [
  ["static_src/midnight.js", /var GRACE_[A-Z_]+ = "([a-z_]+)"/g],
  ["static_src/night.js", /Graces\.(?:has|value|get)\(\s*c\s*,\s*"([a-z_]+)"|Graces\.(?:value|get)\(\s*"([a-z_]+)"/g],
  ["static_src/character_drawer.js", /Graces\.(?:has|value|get)\(\s*(?:c\s*,\s*)?"([a-z_]+)"/g],
];
// night.js/character_drawer.js の第1引数が文字列でないケース（has(c, "id")）も拾えるよう、
// 素直に「引用符つきの既知id候補」を総当たりで数える方式も併用する。
callers.forEach(([file, re]) => {
  const src = fs.readFileSync(path.resolve(__dirname, "..", "..", file), "utf8");
  const found = new Set();
  let m;
  while ((m = re.exec(src)) !== null) {
    const id = m[1] || m[2];
    if (id) found.add(id);
  }
  if (!found.size) {
    ok(false, file + " から恩寵idを1つも抽出できなかった（正規表現が腐っている）");
    return;
  }
  const unknown = [...found].filter((id) => !idSet.has(id));
  ok(unknown.length === 0, file + " が使う恩寵id " + found.size + "件はすべて graces.js に実在" + (unknown.length ? "（未定義: " + unknown.join(", ") + "）" : ""));
});

console.log("[名前が規則原文と一致するか]");
// 恩寵の名稱は規則書本文（event_rulebook.js／fields_data_*.js）に「」付きで必ず出てくる。
// ここがずれていても実行時エラーにはならず、ただ画面の表示が規則書と食い違うだけなので
// 気づけない——実際、統合時に「融合する命」の中国語名が原文の「融合的生命」ではなく
// 「融合之命」になっていたのを、この照合で見つけた（2026-09-19に修正）。
const ruleText = ["event_rulebook.js", "fields_data_1.js", "fields_data_2.js", "fields_data_3.js", "fields_data_4.js"]
  .map((f) => fs.readFileSync(path.resolve(__dirname, "..", "..", "static_src", f), "utf8"))
  .join("\n");
G.list().forEach((g) => {
  ok(ruleText.indexOf("「" + g.name.ja + "」") !== -1, g.id + " の日本語名「" + g.name.ja + "」が規則原文にある");
  ok(ruleText.indexOf("「" + g.name.zh + "」") !== -1, g.id + " の中国語名「" + g.name.zh + "」が規則原文にある");
});

console.log("[腐れ森の恩寵の獲得判定]");
// fields_data_4.js:2268「PCの代表ひとりが1Dする。出目が『5以上』だった場合は獲得。
// 『4以下』ならこのフロアには無く、このフィールド以外で発生したとき出目を『+2』（累積）」。
const ACQ = G.value("rotten_forest", "acquisition", "night");
ok(!!ACQ, "rotten_forest に獲得手順が登録されている");
ok(ACQ.dice === 1 && ACQ.target === 5, "1D で 5以上なら獲得");
ok(ACQ.bonusPerFailedFieldElsewhere === 2, "失敗した他フィールド1つにつき +2");
// night.js 側：累積は「他のフィールドでの失敗」だけを数えること（同じ場所で振り直さない）。
const nightSrc = fs.readFileSync(path.resolve(__dirname, "..", "..", "static_src", "night.js"), "utf8");
ok(/function rottenForestSeekBonus/.test(nightSrc), "累積ボーナスの算出がある");
ok(/if \(slot !== here\) bonus \+= step/.test(nightSrc), "今いるフィールドでの失敗は加算しない");
ok(/if \(\(state\.rottenForestSeekFailedSlots \|\| \{\}\)\[here\]\) return;/.test(nightSrc), "同じフィールドで振り直せない");

console.log(fail === 0 ? "\n=== 全テスト通過 ===" : "\n=== 失敗 " + fail + " 件 ===");
process.exit(fail === 0 ? 0 : 1);
