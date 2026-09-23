// 2026-09-23 整體稽核で見つかった 2 系統の回帰テスト（純 Node、ブラウザ不要）。
//
//   node tools/midnight_check/pause_and_choice_check.js
//
// ① 暫停閘門（isPaused()）
//    frameInner() から毎影格呼ばれる更新関数のうち、RTDB を書く／敵に傷害を与えるものは
//    暫停中に走ってはいけない。とくに瀕死の 15 秒倒數は、救援手段（隊友の攻擊→復歸傷害）が
//    isPaused() で全部塞がれているのに倒數だけ進んでいたため、「暫停が残り秒数より長い＝
//    その玩家は必ず強制復歸・流浪祝福を 1 つ消費」という状態だった。
//    閘門だけ足して時間戳を平移しないと、今度は「恢復した瞬間にまとめて発火」に化けるので、
//    閘門と shiftMyTimestampsAfterPause() の平移は必ずセットで縛る。
//
// ② 遺物選擇の値の形
//    CharacterDrawer が角色欄位へ書くのは COMMON_SKILL_*_OPTIONS の要素、つまり
//    {ja, zh} の**物件**。midnight 側の relicChoiceMatches() はこれを字串だと思い込んで
//    choice.indexOf(name) を呼んでおり、該当遺物を習得した瞬間から蓄積処理が毎回
//    TypeError で中断していた。実際に両モジュールを読み込んで形を突き合わせる。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");

let failed = 0;
function ok(cond, label) {
  console.log((cond ? "  OK  " : "  NG  ") + " " + label);
  if (!cond) failed++;
}

const mn = fs.readFileSync(path.join(ROOT, "static_src", "midnight.js"), "utf8");

// ---- ① 暫停閘門 ----
console.log("[暫停中に走ってはいけない毎影格更新]");
// 関数名 -> その本体の先頭数行に isPaused() 閘門があること。
// 本体の切り出しは「function 名 (…) {」から次の「\n  }」まで（midnight.js の
// トップレベル関数はすべてインデント 2）。
function bodyOf(name) {
  const head = mn.indexOf("function " + name + "(");
  if (head === -1) return null;
  const end = mn.indexOf("\n  }", head);
  return end === -1 ? mn.slice(head) : mn.slice(head, end);
}

const PAUSE_GATED = [
  ["updateNearDeathState", "瀕死15秒倒數（暫停中は救援できないので倒數も止める）"],
  ["updateSummonedSpirit", "召喚靈體の自動攻擊"],
  ["updateAffixGuardHold", "架盾3秒で発動する詞條の周囲攻擊"],
  ["updateFlaskReading", "聖杯瓶の読み取り完了（起点だけでなく進行中も）"],
  ["updateSorceryHold", "長押し詠唱の成立（起点だけでなく進行中も）"],
];
PAUSE_GATED.forEach(function (pair) {
  const body = bodyOf(pair[0]);
  ok(!!body && body.indexOf("isPaused()") !== -1, pair[0] + "() に isPaused() 閘門がある——" + pair[1]);
});

console.log("[閘門とセットの時間戳平移（無いと恢復した瞬間にまとめて発火する）]");
const shift = bodyOf("shiftMyTimestampsAfterPause") || "";
[
  ["nearDeath", "nearDeath.deadlineAt"],
  ["summonedSpirit", "summonedSpirit.nextAttackAt"],
  ["flaskReadingUntil", "flaskReadingUntil"],
  ["sorceryHoldState", "sorceryHoldState[key]（長押しの起点）"],
  ["blockHoldStartedAt", "blockHoldStartedAt（架盾の起点）"],
  ["affixGuardHoldFiredAt", "affixGuardHoldFiredAt[id]（詞條の本地冷卻）"],
].forEach(function (pair) {
  ok(shift.indexOf(pair[0]) !== -1, "shiftMyTimestampsAfterPause() が " + pair[1] + " を平移している");
});

// ---- ② 遺物選擇の値の形 ----
console.log("[遺物選擇（RELIC_CHOICE_CONFIG_BY_NAME）が実際に保存する値の形]");
// character_drawer.js を素で読み込むと DOM／他モジュールに触れるので、必要最小限の
// スタブだけ載せた sandbox で評価する（他の純 Node チェックと同じやり方）。
function loadCharacterDrawer() {
  const noop = function () {};
  const fakeEl = {
    appendChild: noop, addEventListener: noop, querySelectorAll: function () { return []; },
    querySelector: function () { return null; }, classList: { add: noop, remove: noop, toggle: noop },
    style: {}, dataset: {}, setAttribute: noop, getAttribute: function () { return null; },
  };
  const sandbox = {
    window: {
      PriTestCharacterTypes: { get: function () { return null; }, localizedText: function (v) { return v; } },
      PriTestWeapons: { get: function () { return null; }, list: function () { return []; }, categories: function () { return []; } },
      PriTestTalismans: { get: function () { return null; }, list: function () { return []; } },
      PriTestConsumables: { get: function () { return null; }, list: function () { return []; } },
      PriTestWeaponAffixes: { list: function () { return []; } },
      PriTestWeaponsSkills: {},
      PriTestWeaponRulebook: {},
      PriTestNightPotentialPower: {},
      PriTestNightWeaponRulebook: {},
      PriTestMidnightTextAdapt: { adapt: function (v) { return v; } },
      I18N: { t: function (k) { return k; }, getLang: function () { return "zh"; } },
      localStorage: { getItem: function () { return null; }, setItem: noop, removeItem: noop },
      addEventListener: noop,
    },
    document: {
      getElementById: function () { return null; }, createElement: function () { return Object.create(fakeEl); },
      addEventListener: noop, querySelectorAll: function () { return []; }, querySelector: function () { return null; },
    },
    console: { log: noop, warn: noop, error: noop },
    Math: Math, JSON: JSON, Date: Date, Object: Object, Array: Array, String: String,
    Number: Number, Boolean: Boolean, RegExp: RegExp, isNaN: isNaN, parseInt: parseInt,
    parseFloat: parseFloat, Promise: Promise, setTimeout: setTimeout,
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "static_src", "character_drawer.js"), "utf8"), sandbox, {
    filename: "character_drawer.js",
  });
  return sandbox.window.PriTestCharacterDrawer;
}

const CD = loadCharacterDrawer();
ok(!!CD, "character_drawer.js が読み込める");

// 「屬性蓄積值＋1」を習得した角色を作り、実際に保存される値を見る。
const c = { learnedRelicEffects: [] };
const effect = { name: { zh: "屬性蓄積值＋1", ja: "属性蓄積値＋1" } };
CD.learnRelicEffect(c, { key: "dummy-r1-0", effect: effect }, null);
const saved = c.relicAccumElementChoice;
ok(saved !== undefined && saved !== null, "習得すると relicAccumElementChoice に値が入る");
ok(typeof saved === "object", "保存される値は {ja, zh} の物件（字串ではない）——ここが崩れたら下の比對も作り直す");
ok(typeof saved.ja === "string" && typeof saved.zh === "string", "物件は ja／zh の両方を持つ");

console.log("[midnight.js の relicChoiceMatches() がその形を扱えるか]");
// 関数本体だけ切り出して評価する（midnight.js 全体はブラウザ前提なので読み込めない）。
const matchSrc = bodyOf("relicChoiceMatches");
ok(!!matchSrc, "relicChoiceMatches() が見つかる");
ok(
  matchSrc.indexOf("elementAliases") === -1,
  "存在しない PriTestMidnightTextAdapt.elementAliases を参照していない（匯出されたことが一度もない）"
);
const relicChoiceMatches = vm.runInNewContext("(" + matchSrc + "\n})\n", {});
// ATTRIBUTE_STATUS_ELEMENT_NAMES_JA 側の名稱は ja。炎の zh は「火」なので、
// zh しか見ない実装だと取りこぼす＝ja 一致を必ず拾えること。
ok(relicChoiceMatches({ ja: "炎", zh: "火" }, "炎") === true, "{ja:'炎',zh:'火'} と ja 名「炎」が一致する");
ok(relicChoiceMatches({ ja: "雷", zh: "雷" }, "雷") === true, "{ja:'雷',zh:'雷'} と ja 名「雷」が一致する");
ok(relicChoiceMatches({ ja: "炎", zh: "火" }, "聖") === false, "別の屬性とは一致しない");
ok(relicChoiceMatches("炎", "炎") === true, "純字串の旧データも従来どおり一致する");
ok(relicChoiceMatches(null, "炎") === false, "未選択（null）は一致しない");
// 本命：以前はここで TypeError を投げていた。
let threw = false;
try {
  relicChoiceMatches({ ja: "猛毒", zh: "猛毒" }, "腐敗");
} catch (e) {
  threw = true;
}
ok(!threw, "物件を渡しても例外を投げない（旧実装は choice.indexOf is not a function で落ちていた）");

console.log("");
if (failed) {
  console.log("=== " + failed + " 件 NG ===");
  process.exit(1);
}
console.log("=== 全テスト通過 ===");
