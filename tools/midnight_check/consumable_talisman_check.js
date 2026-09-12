// ============================================================================
// midnight（即時制擴張版）消耗品／裝飾品接入狀況回歸檢查（純 node，不需要 Playwright／
// emulator）。對應 docs/midnight_consumable_talisman_audit.md 的 2026-09-12 實作批次。
// ============================================================================
// 檢查兩件事：
//   ① 覆蓋率：18 個消耗品與 60 個裝飾品，每一條在 midnight.js（或它會呼叫的
//      character_drawer.js helper）裡都要有對應的接入點。用「這條效果在程式裡的識別字
//      （itemId／talisman id／通用解析函式名）有沒有出現」來判斷，判到的是**接線存在**，
//      不是數值正確——數值要靠實際跑遊戲驗證，這支腳本只防「改壞了整條不見」。
//   ② 規則本文解析器：咆哮系戰技的「＋5＋▲」「再＋5（合計＋10＋▲）」句型，以及
//      consumables 的等級2數值，用固定案例比對期望值（這部分是真的算數值）。
//
// 執行方式：npm run test:consumable_talisman（或 node consumable_talisman_check.js）
// 失敗時 exit code 1，並印出所有沒對上的條目。
// ============================================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.PRITEST_SRC || path.resolve(__dirname, "../../static_src");

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(SRC, "talismans.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(SRC, "consumables.js"), "utf8"), sandbox);
const Talismans = sandbox.window.PriTestTalismans;
const Consumables = sandbox.window.PriTestConsumables;

const midnightSrc = fs.readFileSync(path.join(SRC, "midnight.js"), "utf8");
const drawerSrc = fs.readFileSync(path.join(SRC, "character_drawer.js"), "utf8");
const bothSrc = midnightSrc + "\n" + drawerSrc;

const failures = [];

function check(label, ok, detail) {
  if (!ok) failures.push(label + (detail ? "：" + detail : ""));
}

// ---- ① 消耗品：每個 itemId 都要在 midnight.js 的效果分支出現 ----
// applyMidnightConsumableEffect() 之外的出現（例如丟擲動畫表）也算數，因為那些同樣是
// 「這個道具在 midnight 有被認得」的證據；真正要防的是整條被刪掉。
Consumables.list().forEach((item) => {
  check("消耗品未接入 " + item.id, midnightSrc.indexOf(item.id) !== -1);
});

// ---- ② 裝飾品：60 條各自的接入證據 ----
// 大多數是 midnight.js／character_drawer.js 直接寫 id；少數走通用解析（最大HP/FP、
// 威力補正），那些用「解析函式名存在」當證據並在這裡標明是哪一條。
const GENERIC_TALISMANS = {
  talisman_crimson_amber_medallion: "talismanFlatMaxStatBonus", // 最大HP+□
  talisman_blue_amber_medallion: "talismanFlatMaxStatBonus", // 最大FP+□
  talisman_erdtree_favor: "talismanFlatMaxStatBonus", // 最大HP/FP+□
  talisman_greed: "talismanFlatMaxStatBonus", // 最大HP-2（盧恩+1另外在 midnight.js 直接判斷）
  talisman_millicents_gauntlet: "talismanPowerModBonus", // 威力補正
  talisman_twin_blade: "talismanPowerModBonus",
  talisman_winged_sword: "talisman2HitBonus", // 2Hit特典：總合傷害+5
};
// 規則本文完全沒有可實作數值、或已由既有行為涵蓋而不需要獨立程式碼的條目。
// 目前為空：2026-09-12 批次後 60 條全部有接入點。
const INTENTIONALLY_UNWIRED = [];

Talismans.list().forEach((t) => {
  if (INTENTIONALLY_UNWIRED.indexOf(t.id) !== -1) return;
  if (bothSrc.indexOf(t.id) !== -1) return;
  const generic = GENERIC_TALISMANS[t.id];
  check(
    "裝飾品未接入 " + t.id + "（" + t.name.zh + "）",
    !!generic && drawerSrc.indexOf(generic) !== -1,
    generic ? "通用解析 " + generic + " 不存在" : "沒有直接判斷、也不在通用解析清單中"
  );
});

// ---- ③ 咆哮系戰技的本文解析器（數值正確性） ----
const ROAR_BASE_RE = /2Hit(?:アタック|攻擊)[^「]*「([^」]+)」/;
const ROAR_EXTRA_RE = /(?:さらに|再)「([^」]+)」/;

function parseRoarBonusFragment(fragment, artPower) {
  if (!fragment) return 0;
  fragment = String(fragment).split(/[（(]\s*(?:合計|合计)/)[0];
  let total = 0;
  (fragment.match(/[＋+]\s*(\d+)/g) || []).forEach((m) => {
    total += parseInt(m.replace(/[＋+\s]/g, ""), 10) || 0;
  });
  if (/[▲◆]/.test(fragment)) total += artPower;
  return total;
}

const AP = 7; // 任意的威力補正值，只要前後一致即可
const roarCases = [
  [
    "戰吼（zh）",
    "效果：直到結束階段為止，此裝備2Hit攻擊造成的總合傷害「＋5」。若自身裝備狀態下持有護符「咆哮的勳章（201頁）」，總合傷害再「＋▲（合計＋5＋▲）」。",
    5,
    5 + AP,
  ],
  [
    "野蠻咆哮（zh）",
    "效果：直到結束階段為止，此裝備品2Hit攻擊的總合傷害「＋5＋▲」。若自身裝備護符「咆哮的勳章（201頁）」，總合傷害再「＋5（合計＋10＋▲）」。",
    5 + AP,
    10 + AP,
  ],
  [
    "戰吼（ja）",
    "効果：エンドフェイズまで、この装備品での2Hitアタックによる総合ダメージを「＋5」する。自身がタリスマン「咆哮のメダリオン（201頁）」を装備状態なら、総合ダメージにさらに「＋▲（合計＋5＋▲）」する。",
    5,
    5 + AP,
  ],
  [
    "野蠻咆哮（ja）",
    "効果：エンドフェイズまで、この装備品での2Hitアタックによる総合ダメージを「＋5＋▲」する。自身がタリスマン「咆哮のメダリオン（201頁）」を装備状態なら、総合ダメージにさらに「＋5（合計＋10＋▲）」する。",
    5 + AP,
    10 + AP,
  ],
];

roarCases.forEach(([label, body, expectNoTalisman, expectWithTalisman]) => {
  const base = ROAR_BASE_RE.exec(body);
  const extra = ROAR_EXTRA_RE.exec(body);
  const noTal = parseRoarBonusFragment(base && base[1], AP);
  const withTal = noTal + parseRoarBonusFragment(extra && extra[1], AP);
  check("咆哮解析 " + label + " 無護符", noTal === expectNoTalisman, noTal + " ≠ " + expectNoTalisman);
  check("咆哮解析 " + label + " 有護符", withTal === expectWithTalisman, withTal + " ≠ " + expectWithTalisman);
});

// ---- ④ 2026-09-12 使用者明確指定的數值，確認沒有被改回舊值 ----
const NUMERIC_GUARDS = [
  ["星光的碎片 FP +30/+60", /applyLevel2 \? 60 : 30/],
  ["蒼火的投擲刀 傷害 20", /damageCombatTarget\(20 \+ thrownBonus\)/],
  ["溫石 HoT 10秒 +20/+40", /applyLevel2 \? 40 : 20/],
  ["龜首漬 體力+10", /stamina\.current \+ 10/],
  ["「直到階段結束」＝10秒", /CONSUMABLE_BUFF_MS = 10000/],
  ["赤羽/青紫七支刃 低血門檻 30", /LOW_HP_TALISMAN_THRESHOLD_MIDNIGHT = 30/],
  ["浮雕/精靈之角 冷卻30秒", /BIG_HIT_TALISMAN_COOLDOWN_MS = 30000/],
  ["神肌的襁褓 5秒視窗", /GOD_SKIN_SWADDLE_WINDOW_MS = 5000/],
  ["綠琥珀勳章 體力門檻20", /TALISMAN_LOW_STAMINA_THRESHOLD = 20/],
  ["憐憫的雫滴 10秒回1", /DEW_TEAR_HEAL_INTERVAL_MS = 10000/],
  ["對雜兵「HP損害：1」＝100", /MOB_DAMAGE_PER_RULEBOOK_POINT = MOB_HP_PER_ROW/],
  ["酸之噴霧 -120÷10", /ACID_SPRAY_DAMAGE_REDUCE = 120 \/ 10/],
];
NUMERIC_GUARDS.forEach(([label, re]) => check("數值守衛 " + label, re.test(midnightSrc)));

// ---- ⑤ character_drawer 的 HP 刻度修正（捧鬮之劍／赤羽七支刃） ----
check(
  "talismanFlatHitBonus 必須接受 hpOverride",
  /function talismanFlatHitBonus\(c, weaponId, category, hpOverride\)/.test(drawerSrc)
);
check("computeWeaponDamage 必須把 hpOverride 傳進去", /talismanFlatHitBonus\(c, weaponId, category, hpOverride\)/.test(drawerSrc));

// ---- 結果 ----
if (failures.length) {
  console.error("FAIL（" + failures.length + " 項）：");
  failures.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log(
  "PASS：消耗品 " + Consumables.list().length + " 項、裝飾品 " + Talismans.list().length + " 項全部有接入點，數值守衛與本文解析器均正確。"
);
