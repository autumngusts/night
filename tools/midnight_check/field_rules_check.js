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
// 「増大する気配決定表」：ダイス2個（奇偶 × 出目1-6）で10行、重複も抜けも無いこと。
const GP = FR.get("growing_presence").decisionTable;
ok(GP.length === 10, "増大する気配決定表は10行（実際 " + GP.length + "）");
const covered = new Set();
GP.forEach((v) => v.faces.forEach((f) => covered.add(v.parity + ":" + f)));
ok(covered.size === 12, "奇偶×出目1-6の12通りをすべて覆う（実際 " + covered.size + "）");
const dup = [];
const seenFace = new Set();
GP.forEach((v) =>
  v.faces.forEach((f) => {
    const k = v.parity + ":" + f;
    if (seenFace.has(k)) dup.push(k);
    seenFace.add(k);
  })
);
ok(dup.length === 0, "同じ出目に2つの効果が割り当たっていない" + (dup.length ? "（重複: " + dup.join(", ") + "）" : ""));
ok(GP.filter((v) => v.note === "※1").length === 8, "※1（蓄積+1）は8行");
ok(GP.filter((v) => v.note === "※2").length === 2, "※2（HP回復／HP損害）は2行");
// ※1 の対象名は night/midnight で実際に使われている正式ラベルであること
//（表の「毒」→アプリの「猛毒」のような表記ゆれを取りこぼさないため）。
const VALID_LABELS = ["炎", "聖", "魔", "雷", "猛毒", "腐敗", "凍傷", "出血", "発狂", "睡眠", "呪死"];
GP.filter((v) => v.accumLabel).forEach((v) => {
  ok(VALID_LABELS.indexOf(v.accumLabel) !== -1, "※1 の対象「" + v.accumLabel + "」は正式な属性/状態異常ラベル");
});
GP.filter((v) => v.hpHeal || v.hpDamage).forEach((v) => {
  const amt = v.hpHeal || v.hpDamage;
  ok(amt.midnight === amt.night * 10, "growing_presence." + v.id + " も 1:10 換算");
});
// 状態異常系は「どの異常か」が必ず埋まっていること（空だと黙って何も蓄積しない）。
rules
  .filter((r) => r.kind === "ailmentAccum")
  .forEach((r) => {
    ok(!!r.ailment, r.id + " に対象の状態異常が設定されている（" + r.ailment + "）");
  });
// 行為判定を持つルールは「能力」と「目標値（固定値 or ルール側の式）」が揃っていること。
rules.forEach((r) => {
  const checks = r.checks || (r.check ? [r.check] : []);
  checks.forEach((c, i) => {
    const hasTarget = typeof c.target === "number" || typeof r.targetPartySizeOffset === "number";
    ok(hasTarget && !!c.stat, r.id + " の判定" + (i + 1) + " は目標値と能力が揃っている");
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

console.log("[⑥ 結晶の呪気の減衰量]");
// night.js の refreshFieldRuleMaxHp() が使う式：
//   減衰 = max(0, decay - 共鳴する結晶 × easedPerCounter)
//   実際に引く量 = min(減衰, hp.max - minStat)   ← 「最大HPの下限は1」
// データ側がこの式で意図どおりの値になるかを、代表的な入力で確かめる。
const CC = FR.get("crystal_curse");
const decay = -CC.maxHpDelta;
const per = CC.easedPerCounter;
const minStat = CC.minStat;
ok(decay === 3, "減衰量は3（規則書「最大HP：-3」）");
ok(per === 1, "「共鳴する結晶：+1」ごとに1緩和");
function appliedDelta(counter, hpMax) {
  const eased = Math.max(0, decay - counter * per);
  return -Math.min(eased, Math.max(0, hpMax - minStat));
}
ok(appliedDelta(0, 10) === -3, "結晶0 / 最大HP10 → -3");
ok(appliedDelta(1, 10) === -2, "結晶1 / 最大HP10 → -2");
ok(appliedDelta(3, 10) === 0, "結晶3 / 最大HP10 → 0（完全に緩和）");
ok(appliedDelta(5, 10) === 0, "結晶5 / 最大HP10 → 0（マイナスにならない）");
ok(appliedDelta(0, 2) === -1, "最大HP2 → -1 まで（下限1を割らない）");
ok(appliedDelta(0, 1) === 0, "最大HP1 → 0（すでに下限）");

console.log("[⑦ 呼び出し側との id 整合]");
// night.js / midnight.js が使う追加ルールidが field_rules.js に実在するか。
// 未知idでも例外にならず静かに「そのルールは無い」扱いになるので、目視では気づけない。
const ruleIds = new Set(rules.map((r) => r.id));
[
  ["static_src/night.js", /(?:currentFieldHasRule|FieldRules\.(?:has|get|value))\(\s*(?:[A-Za-z_.\[\]]+\s*,\s*)?"([a-z_]+)"/g],
  ["static_src/character_drawer.js", /FieldRules\.(?:has|get|value)\(\s*(?:[A-Za-z_.\[\]]+\s*,\s*)?"([a-z_]+)"/g],
].forEach(([file, re]) => {
  const src = fs.readFileSync(path.resolve(root, file), "utf8");
  const found = new Set();
  let m;
  while ((m = re.exec(src)) !== null) found.add(m[1]);
  const unknown = [...found].filter((id) => !ruleIds.has(id));
  ok(
    unknown.length === 0,
    file + " が使う追加ルールid " + found.size + "件はすべて field_rules.js に実在" + (unknown.length ? "（未定義: " + unknown.join(", ") + "）" : "")
  );
});
// 最大HPの合算経路が外れていないか（外れると減衰が丸ごと効かなくなるが例外は出ない）。
const drawer = fs.readFileSync(path.resolve(root, "static_src/character_drawer.js"), "utf8");
ok(/totalFlatMaxStatBonus[\s\S]{0,400}fieldRuleFlatMaxStatBonus\(c, statKey\)/.test(drawer), "totalFlatMaxStatBonus() が場地ルール分を合算している");
ok(/_fieldRuleMaxHpDelta/.test(fs.readFileSync(path.resolve(root, "static_src/night.js"), "utf8")), "night.js が _fieldRuleMaxHpDelta を書き込んでいる");

console.log("[⑧ 行為判定ヘルパとの結線]");
// night.js の applyFloorDescriptionFieldRules() は、規則書の判定を
// AutoGm.resolveSavingThrow() にそのまま投げる。stat がヘルパの期待するキー
//（type.checkValues のキー）でないと、骰子数0で必ず失敗するのに例外は出ない——
// だから実際にヘルパを動かして、判定が成立することまで確かめる。
vm.runInContext(fs.readFileSync(path.resolve(root, "static_src/character_types.js"), "utf8"), sandbox, { filename: "character_types.js" });
vm.runInContext(fs.readFileSync(path.resolve(root, "static_src/auto_gm.js"), "utf8"), sandbox, { filename: "auto_gm.js" });
const AutoGm = sandbox.window.PriTestAutoGm;
const CharacterTypes = sandbox.window.PriTestCharacterTypes;
const VALID_STATS = ["luck", "physical", "mental"];
ok(!!(AutoGm && AutoGm.resolveSavingThrow), "AutoGm.resolveSavingThrow が使える");

const sampleTypeId = CharacterTypes.list ? CharacterTypes.list()[0].id : "tracker";
const fakeRoster = [
  { id: "a", name: "A", entered: true, typeId: sampleTypeId },
  { id: "b", name: "B", entered: true, typeId: sampleTypeId },
  { id: "c", name: "C", entered: false, typeId: sampleTypeId },
];
rules.forEach((r) => {
  const checks = r.checks || (r.check ? [r.check] : []);
  checks.forEach((chk) => {
    ok(VALID_STATS.indexOf(chk.stat) !== -1, r.id + " の判定能力 " + chk.stat + " は checkValues のキー");
    const type = CharacterTypes.get(sampleTypeId);
    ok(typeof (type.checkValues || {})[chk.stat] === "number", r.id + " の " + chk.stat + " が実際のキャラ種別で引ける");
    if (typeof chk.target !== "number") return; // 迷いの隠れ都は目標値がPC人数依存
    const res = AutoGm.resolveSavingThrow(
      { stat: chk.stat, targetByCondition: [{ condition: { kind: "default" }, target: chk.target }] },
      fakeRoster,
      { aggro: {} },
      CharacterTypes,
      null
    );
    ok(res.length === 2, r.id + " の判定は入場中のPCだけ（2人）に対して行われる");
    ok(
      res.every((x) => x.target === chk.target && x.dice.length > 0 && typeof x.passed === "boolean"),
      r.id + " の判定結果に目標値・出目・成否が揃っている"
    );
  });
});
// 蓄積系は成功・失敗どちらでも量が入る（規則書「成功すれば1を、失敗したら3を被る」）。
rules
  .filter((r) => r.kind === "ailmentAccum" && r.check)
  .forEach((r) => {
    ok(r.onSuccess > 0 && r.onFailure > r.onSuccess, r.id + " は成功" + r.onSuccess + " / 失敗" + r.onFailure);
  });
// 迷いの隠れ都だけは目標値が式なので、固定targetを持っていないことを明示的に確認する
//（うっかり11を固定値として入れ直すと、PC人数が3人以外のとき規則と食い違う）。
const LHC = FR.get("lost_hidden_city");
ok(LHC.targetPartySizeOffset === 8, "迷いの隠れ都の目標値は PC人数+8（加算値としてデータが持つ）");
ok(
  LHC.checks.every((c) => typeof c.target !== "number"),
  "迷いの隠れ都の各判定に固定目標値が残っていない"
);

console.log("[⑨ フロア踏破契機と離脱時の解除]");
// 溶岩：判定なしで「HP損害：■」＝1格。
ok(FR.get("lava").kind === "floorDamage" && FR.value("lava", "hpDamage", "night") === 1, "溶岩はフロア踏破ごとにHP損害1格");
ok(!FR.get("lava").check, "溶岩に行為判定は無い（無条件）");
// 朱い腐敗の瘴気：「腐敗：1D-1（最低値0）」＝取りうる値は 0〜5。
const CRM = FR.get("crimson_rot_miasma").onFloorCleared;
ok(CRM.dice === 1 && CRM.modifier === -1 && CRM.min === 0, "朱い腐敗の瘴気は 1D-1（最低値0）");
const outcomes = [1, 2, 3, 4, 5, 6].map((d) => Math.max(CRM.min, d + CRM.modifier));
ok(outcomes[0] === 0 && outcomes[5] === 5, "出目1→0、出目6→5");
ok(
  outcomes.every((v) => v >= 0),
  "最低値0を下回らない"
);
// 離脱時の解除条件：規則書で「移動先に同じルールが無ければ解除」と書かれているのは
// 朱い腐敗の瘴気と凍てつく吹雪だけ。ほかの蓄積系は無条件でクリアされる。
const condClear = rules
  .filter((r) => r.clearsOnLeaveUnlessSameRule)
  .map((r) => r.id)
  .sort();
ok(
  JSON.stringify(condClear) === JSON.stringify(["crimson_rot_miasma", "freezing_blizzard"]),
  "条件付き解除は朱い腐敗の瘴気／凍てつく吹雪のみ（実際: " + condClear.join(", ") + "）"
);
rules
  .filter((r) => r.kind === "ailmentAccum" && r.check)
  .forEach((r) => {
    ok(!r.clearsOnLeaveUnlessSameRule, r.id + " は移動で無条件にクリアされる");
  });
// night.js が踏破フックを公開し、GMフローから呼ばれていること（外れても例外は出ない）。
const nightSrc = fs.readFileSync(path.resolve(root, "static_src/night.js"), "utf8");
const flowSrc = fs.readFileSync(path.resolve(root, "static_src/night_gm_flow.js"), "utf8");
ok(/applyFieldRulesOnFloorCleared: applyFieldRulesOnFloorCleared/.test(nightSrc), "night.js が踏破フックを公開している");
ok((flowSrc.match(/applyFieldRulesOnFloorCleared\(/g) || []).length === 2, "GMフローの踏破確定2箇所から呼ばれている");
ok(/state\.battle\.attributeStatus\.received = carriedFieldRuleAccum/.test(nightSrc), "戦闘終了の全消去から追加ルール由来の蓄積を守っている");

console.log("[⑩ 吹雪の視界の接線]");
// 規則書が禁じるのは「エネミーを対象とする『アタック』と『スキル（戦技／魔術／祈祷）の
// 使用』」だけ。角色の技能／技藝まで止めてしまうと規則より厳しくなるので、武器由来の
// entry だけを見分けていることを静的に確かめる（実行時は例外を出さず静かに効くため）。
const BV = FR.get("blizzard_vision");
ok(BV.backRowCannotAttack === true && BV.backRowCannotUseSkill === true, "吹雪の視界は後衛のアタックとスキルを禁じる");
ok(BV.negatedByGraceId === "mountain_peak", "山嶺の恩寵で無効化される");
ok(/function blizzardVisionBlocksEnemyAction/.test(nightSrc), "night.js に判定関数がある");
ok(
  /getCharacterBattlePosition\(c\) !== "back"/.test(nightSrc),
  "後衛のときだけ効く（前衛は対象外）"
);
ok(
  /var weaponSkillEntries = CharacterDrawer\.getEquippedWeaponSkillEntries\(c\)/.test(nightSrc),
  "武器由来スキルを別に取り出している"
);
ok(
  /weaponSkillEntries\.indexOf\(entry\) !== -1 && blizzardVisionBlocksEnemyAction\(c, "skill"\)/.test(nightSrc),
  "スキル側は武器由来のentryだけを封じている（角色の技能／技藝は止めない）"
);
// アタック側とスキル側で、それぞれ対応する旗標を読ませていること。
ok(
  /blizzardVisionBlocksEnemyAction\(c, "attack"\)/.test(nightSrc) && /blizzardVisionBlocksEnemyAction\(c, "skill"\)/.test(nightSrc),
  "アタックとスキルを別々に判定している"
);
ok(
  /kind === "skill" \? "backRowCannotUseSkill" : "backRowCannotAttack"/.test(nightSrc),
  "禁止対象は field_rules.js の旗標から引いている"
);

console.log("[⑪ 迷いの隠れ都のタイムロス判定]");
// 規則書：PC1〜2人は1種でも成功すればペナルティなし、PC3〜4人は「PC人数-1」種以上。
// 目標値は固定ではなく X＝PC人数+8。
const REQ = LHC.requiredSuccesses;
ok(REQ[1] === 1 && REQ[2] === 1, "PC1〜2人は1種でよい");
ok(REQ[3] === 2 && REQ[4] === 3, "PC3〜4人は「PC人数-1」種");
[1, 2, 3, 4].forEach((size) => {
  const expected = size <= 2 ? 1 : size - 1;
  ok(REQ[size] === expected, "PC" + size + "人 → 必要成功数 " + expected + "（目標値は " + (size + 8) + "）");
});
ok(LHC.timeLossOnFailure === 1, "満たさなければタイムロス1");
ok(LHC.checks.length === 3, "判定は3種（運試し／フィジカル／メンタル）");
ok(
  LHC.checks.map((c) => c.stat).join(",") === "luck,physical,mental",
  "3種の内訳が規則書どおり"
);
// night.js 側：成功数はGM入力で、割り当ては自動化していないこと。
ok(/lost-hidden-city-successes/.test(nightSrc), "成功した種類数はGM入力（割り当ては自動化しない）");
ok(
  /function lostHiddenCityTarget/.test(nightSrc) && /targetPartySizeOffset/.test(nightSrc),
  "目標値はPC人数＋データの加算値で算出している（コードに8を直書きしない）"
);
ok(/successes >= required/.test(nightSrc), "必要成功数に達したらタイムロスを課さない");

console.log(fail === 0 ? "\n=== 全テスト通過 ===" : "\n=== 失敗 " + fail + " 件 ===");
process.exit(fail === 0 ? 0 : 1);
