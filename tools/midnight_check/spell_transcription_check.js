// ============================================================================
// 杖（魔術）規則書轉錄檢查（純 node，不需要 Playwright／emulator）。
// 2026-09-12 的「魔術全部重讀取」批次——使用者提供了規則書 185〜186 頁附近的
// 「杖｜固有魔術」與「杖｜ランダム魔術（輝石）」全部格子的照片，這支腳本把照片上的
// 數值固定成期望值，之後任何人改動 weapons_skills.js 都能立刻發現轉錄被改壞。
// ============================================================================
// 每一條檢查 4 件事（對應使用者指定的格子讀法
// 「（魔術種類）｜（魔術名稱）／條件／傷害／其他效果」）：
//   ① 名稱（ja）
//   ② 條件＝消耗：骰子成本（CharacterDrawer.parseActionCost → diceKind/sumTotal/
//      diceCountMin）與 FP／HP 成本
//   ③ 傷害＝威力（CharacterDrawer.spellSkillPowerValue，杖是 spell 分支；artPower=0
//      で素の威力だけを見る）
//   ④ 其他效果＝屬性／狀態異常蓄積（midnight.js の parseSkillBodyAccums と同じ句型を
//      ここで独立に検算する。固定値のみ照合し、1D 系は「ダイス表記であること」だけ確認）
//
// 執行方式：npm run test:spell_transcription（或 node spell_transcription_check.js）
// 失敗時 exit code 1，並印出所有對不上的欄位。
// ============================================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.PRITEST_SRC || path.resolve(__dirname, "../../static_src");

const stubEl = { style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {} } };
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
vm.createContext(sandbox);
[
  "weapons_categories.js",
  "weapons_skills.js",
  "weapons_data.js",
  "weapons.js",
  "character_types.js",
  "talismans.js",
  "consumables.js",
  "weapon_rulebook.js",
  "character_drawer.js",
].forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), "utf8"), sandbox));

const SKILLS = sandbox.window.PriTestWeaponsSkills;
const CD = sandbox.window.PriTestCharacterDrawer;

// ---- 期望值（すべて使用者提供の写真から転記）--------------------------------
// dice: "sum:N"＝circled digit 合計 N／"same:N"＝ゾロ N 個／"straight:N"＝連番 N 個
// accum: { 属性名: 固定値 } または { 属性名: "dice" }（1D/2D 表記）
const EXPECT = [
  // ---- 杖｜固有魔術 ----
  { id: "spell_glintstone_pebble", name: "輝石のつぶて", dice: "sum:3", fp: 1, hp: 0, power: 35, accum: { 魔: 2 } },
  { id: "spell_glintstone_arc", name: "輝石のアーク", dice: "sum:3", fp: 1, hp: 0, power: 15, accum: { 魔: 2 }, mobSquareUnknown: true },
  { id: "spell_rock_sling", name: "岩盤砕き", kindLabel: "石掘り", dice: "sum:4", fp: 1, hp: 0, power: 50, accum: { 魔: 4 } },
  { id: "spell_carian_slicer", name: "カーリアの速剣", kindLabel: "カーリア", dice: "sum:1", fp: 1, hp: 0, power: 35, accum: { 魔: 2 } },
  { id: "spell_royal_carian_glintblade", name: "魔術の輝剣", kindLabel: "輝剣", dice: "sum:3", fp: 1, hp: 0, power: 25, accum: { 魔: 3 } },
  // 2026-09-12：規則書の見出しは「魔術（不可視）｜夜の彗星」。種類は名前に埋めず
  // kindLabel フィールドへ移した（他の招式と揃えるため）。
  { id: "spell_night_comet", name: "夜の彗星", kindLabel: "不可視", dice: "sum:6", fp: 2, hp: 0, power: 45, accum: { 魔: 4 } },
  { id: "spell_lava_bolt", name: "溶岩弾", dice: "sum:4", fp: 1, hp: 0, power: 30, accum: { 炎: "dice" } },
  { id: "spell_shattering_crystal", name: "砕け散る結晶", kindLabel: "結晶人", dice: "straight:2", fp: 1, hp: 0, power: 40, accum: { 魔: 4 }, mobSquareUnknown: true },
  { id: "spell_thorns_of_punishment", name: "罰の茨", kindLabel: "茨", dice: "sum:4", fp: 0, hp: 1, power: 10, accum: { 出血: 4 } },
  { id: "spell_azur_comet", name: "彗星アズール", dice: "straight:4", fp: 3, hp: 0, power: 130, accum: { 魔: 6 } },
  { id: "spell_ruinous_meteor", name: "滅びの流星", dice: "sum:6", fp: 2, hp: 0, power: 55, accum: { 魔: 4 } },
  { id: "spell_gravity_bolt", name: "重力弾", kindLabel: "重力", dice: "sum:4", fp: 1, hp: 0, power: 10, accum: { 魔: 2 }, powerPlusArtSymbol: true },
  { id: "spell_ghost_call", name: "怨霊呼び", dice: "sum:6", fp: 2, hp: 0, power: 65, accum: { 魔: 4 } },
  { id: "spell_rennalas_full_moon", name: "レナラの満月", dice: "same:2", fp: 2, hp: 0, power: 60, accum: { 魔: 6 } },
  // ---- 杖｜ランダム魔術（輝石）出目1〜6（出目6は「輝石のアーク」へ戻る）----
  { id: "spell_quick_pebble", name: "輝石の速つぶて", dice: "sum:1", fp: 1, hp: 0, power: 25, accum: { 魔: 2 } },
  { id: "spell_greater_pebble", name: "輝石の大つぶて", dice: "sum:5", fp: 2, hp: 0, power: 40, accum: { 魔: 4 } },
  { id: "spell_comet", name: "ほうき星", dice: "sum:6", fp: 2, hp: 0, power: 45, accum: { 魔: 4 } },
  { id: "spell_glintstone_stars", name: "輝石の流星", dice: "sum:6", fp: 1, hp: 0, power: 45, accum: { 魔: 4 } },
  { id: "spell_swirling_pebble", name: "渦巻くつぶて", dice: "sum:4", fp: 2, hp: 0, power: 25, accum: { 魔: "dice" } },
];

// ---- 検算ヘルパー ----------------------------------------------------------
// midnight.js の SKILL_ACCUM_NAMES / parseSkillBodyAccums と同じ句型。ここでは
// 「何がいくつ書かれているか」を見るだけなので、ダイスは振らず "dice" と表す。
const ACCUM_NAMES = ["炎", "雷", "聖", "魔", "猛毒", "腐敗", "出血", "凍傷", "発狂", "發狂", "睡眠", "呪死", "咒死"];

function parseAccums(body) {
  const out = {};
  const re = new RegExp("(" + ACCUM_NAMES.join("|") + ")[：:]\\s*(\\d+)(D)?(?:\\s*[＋+]\\s*(\\d+))?", "g");
  let m;
  while ((m = re.exec(body))) out[m[1]] = m[3] ? "dice" : parseInt(m[2], 10);
  return out;
}

function diceTag(cost) {
  if (!cost.diceKind) return "none";
  return cost.diceKind === "sum" ? "sum:" + (cost.sumTotal || 0) : cost.diceKind + ":" + cost.diceCountMin;
}

const failures = [];
const fail = (id, field, got, want) => failures.push(`${id} ${field}：實際 ${JSON.stringify(got)} ／ 期望 ${JSON.stringify(want)}`);

EXPECT.forEach((e) => {
  const s = SKILLS[e.id];
  if (!s) return failures.push(`${e.id}：weapons_skills.js 找不到這條`);
  if (s.kind !== "Action") fail(e.id, "kind", s.kind, "Action");
  if (s.name.ja !== e.name) fail(e.id, "name.ja", s.name.ja, e.name);
  // kindLabel（規則書見出しの「（種類）｜」部分）。期望値を書いた条目だけ照合する。
  if (e.kindLabel) {
    const got = s.kindLabel ? s.kindLabel.ja : null;
    if (got !== e.kindLabel) fail(e.id, "kindLabel.ja", got, e.kindLabel);
    if (s.kindLabel && !s.kindLabel.zh) fail(e.id, "kindLabel.zh", "(空)", "有內容");
  }

  // ja／zh 兩個語系都要能解析出同一組數值——midnight 是用目前語言的本文施放的，
  // zh 只寫在一邊或用了解析不到的譯名（例：舊「索羅」）就會造成單一語系的數值bug。
  ["ja", "zh"].forEach((lang) => {
    const body = s.body[lang];
    if (!body) return fail(e.id, "body." + lang, "(空)", "有內容");
    const cost = CD.parseActionCost(body);
    if (diceTag(cost) !== e.dice) fail(e.id, `骰子成本(${lang})`, diceTag(cost), e.dice);
    if (cost.fpCost !== e.fp) fail(e.id, `FP成本(${lang})`, cost.fpCost, e.fp);
    if (cost.hpCost !== e.hp) fail(e.id, `HP成本(${lang})`, cost.hpCost, e.hp);

    const dmg = CD.spellSkillPowerValue(body, 0);
    if (!dmg) fail(e.id, `威力解析(${lang})`, null, e.power);
    else if (dmg.value !== e.power) fail(e.id, `威力(${lang})`, dmg.value, e.power);

    // 重力弾だけ【総合ダメージ：威力＋▲】＝威力補正が総合ダメージに乗る
    if (e.powerPlusArtSymbol && !/威力[＋+]▲/.test(body)) fail(e.id, `威力＋▲表記(${lang})`, "無", "有");

    const accums = parseAccums(body);
    Object.keys(e.accum).forEach((name) => {
      if (!(name in accums)) fail(e.id, `蓄積「${name}」(${lang})`, "無", e.accum[name]);
      else if (accums[name] !== e.accum[name]) fail(e.id, `蓄積「${name}」(${lang})`, accums[name], e.accum[name]);
    });

    // 雜兵への「HP損害：■」は■のままGM手動（CLAUDE.md §19）。□に変わっていたら
    // 誰かが勝手に数値を発明したということなので落とす。
    if (e.mobSquareUnknown && !/HP損害[：:]\s*■/.test(body)) fail(e.id, `雜兵HP損害の■(${lang})`, "無", "■のまま");
  });
});

// ---- ランダム魔術（輝石）決定表：出目1〜6の対応 ----------------------------
// 写真の順：1 輝石の速つぶて／2 輝石の大つぶて／3 ほうき星／4 輝石の流星／
// 5 渦巻くつぶて／6 ※「輝石のアーク（185頁）」
const GLINTSTONE_TABLE_ORDER = [
  "spell_quick_pebble",
  "spell_greater_pebble",
  "spell_comet",
  "spell_glintstone_stars",
  "spell_swirling_pebble",
  "spell_glintstone_arc",
];
const staff = sandbox.window.PriTestWeapons.categories().filter((c) => c.id === "staff")[0];
(staff.namedSkillTables || []).forEach((t) => {
  // 両表とも先頭6行（1・2／1〜6）が輝石魔術の共通枠
  const rows = (t.rows || []).slice(0, 6);
  GLINTSTONE_TABLE_ORDER.forEach((id, i) => {
    if (!rows[i]) return failures.push(`${t.title.ja}：第${i + 1}行が無い`);
    if (rows[i].id !== id) fail(t.title.ja, `第${i + 1}行`, rows[i].id, id);
  });
});

// ---- 杖17本の固有魔術がすべて写真の14条に対応しているか ---------------------
// 写真の「杖｜固有魔術」欄は14条。杖は17本あるが、輝石のつぶては5本で共用され、
// 隠者の杖だけ固有魔術を2つ持つ（輝石のつぶて＋輝石のアーク）ので合計14条で閉じる。
// 「配對」の確認＝①各杖の固有魔術がこの14条のどれかであること
//                ②14条すべてがどこかの杖から参照されていること（余りが無い）
const FIXED_SPELL_IDS = EXPECT.slice(0, 14).map((e) => e.id);
const Weapons = sandbox.window.PriTestWeapons;
const staves = Weapons.list().filter((w) => w.category === "staff");
const usedFixed = new Set();
staves.forEach((w) => {
  const fixed = (w.skills || []).filter((r) => r.kind === "art" || r.kind === "innate");
  if (!fixed.length) return failures.push(`${w.id}（${w.name.ja}）に固有魔術が無い`);
  fixed.forEach((r) => {
    if (FIXED_SPELL_IDS.indexOf(r.id) === -1) fail(w.id, "固有魔術が写真の14条に無い", r.id, FIXED_SPELL_IDS.join("|"));
    else usedFixed.add(r.id);
  });
});
FIXED_SPELL_IDS.forEach((id) => {
  if (!usedFixed.has(id)) failures.push(`${id}（${SKILLS[id] ? SKILLS[id].name.ja : "?"}）はどの杖からも参照されていない`);
});
if (staves.length !== 17) fail("staff", "杖の本数", staves.length, 17);

// ---- 結果 ------------------------------------------------------------------
if (failures.length) {
  console.log(`✗ 杖魔術轉錄檢查：${failures.length} 項不符\n`);
  failures.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log(`✓ 杖魔術轉錄檢查通過：${EXPECT.length} 條魔術 × (ja/zh) 的名稱・消耗・威力・蓄積全部符合照片。`);
console.log(`  ・輝石決定表 出目1〜6 的對應正確（2 個決定表 × 前6列）。`);
console.log(`  ・固有魔術配對：杖 ${staves.length} 本 → 固有魔術 ${usedFixed.size}/${FIXED_SPELL_IDS.length} 條全部被參照，且沒有杖指向14條以外的魔術。`);
