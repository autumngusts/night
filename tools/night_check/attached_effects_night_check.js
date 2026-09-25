// ============================================================================
// 基礎附帶效果的 night.js 接入回歸測試（2026-09-25 使用者明確規格）。
//   ・狀態異常耐性／屬性耐性：選定的異常／屬性蓄積上限 +1（accumMaxBonusFor）。
//   ・雙手持握強化／雙刀持握強化：「戰技傷害+5」（CharacterDrawer.attachedSkillDamageBonus 帶武器）。
//   ・疾跑時發生火焰／步行時發生落雷／一定時間後產生輝石：系統直接擲 1D 作為屬性蓄積給敵人
//     （不看自動化GM開關，使用者 2026-09-25 明確規格）；沒有敵人時只寫紀錄。
// 前置：python generate.py、python -m http.server 8791 --directory dist
// 執行：NODE_PATH=tools/midnight_check/node_modules node tools/night_check/attached_effects_night_check.js
//（playwright 裝在 tools/midnight_check/node_modules）
// ============================================================================
const { chromium } = require("playwright");
const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";

let fails = 0;
const assert = (c, l, d) => {
  console.log((c ? "  [PASS] " : "  [FAIL] ") + l + (c || d === undefined ? "" : "　→ " + JSON.stringify(d)));
  if (!c) fails++;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("dialog", async (d) => {
    await d.accept("night"); // admin 密碼（CLAUDE.md §4.1）
  });
  page.on("pageerror", (e) => {
    console.log("  [pageerror] " + e.message);
    fails++;
  });
  try {
    await page.goto(BASE + "/admin/index.html", { waitUntil: "networkidle" });
    const gameId = await page.evaluate(() => window.PriTestGames.create("attached-check", "tricephalos", "local").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const Core = window.PriTestNightCore;
      const state = Core.state;
      const CD = window.PriTestCharacterDrawer;
      const CT = window.PriTestCharacterTypes;
      const W = window.PriTestWeapons;
      const c = CD.newCharacter("測試者", CT.list()[0].id);
      c.entered = true;
      Core.getRosterCharacters().push(c);
      Core.saveRosterCharacters();

      // 耐性
      const base = { poison: Core._debugAccumMaxBonusFor(c, "猛毒"), fire: Core._debugAccumMaxBonusFor(c, "火") };
      c.learnedAttachedEffects = ["status_resist", "element_resist"];
      c.statusResistChoice = { ja: "猛毒", zh: "猛毒" };
      c.elementResistChoice = { ja: "炎", zh: "火" };
      const resist = {
        poison: Core._debugAccumMaxBonusFor(c, "猛毒"),
        rot: Core._debugAccumMaxBonusFor(c, "腐敗"),
        fireZh: Core._debugAccumMaxBonusFor(c, "火"),
        fireJa: Core._debugAccumMaxBonusFor(c, "炎"),
        thunder: Core._debugAccumMaxBonusFor(c, "雷"),
      };

      // 戰技+5
      const dagger = W.list().filter((w) => w.category === "dagger");
      c.learnedAttachedEffects = ["two_hand_up"];
      c.equippedWeaponIds = [dagger[0].id];
      const twoHand = CD.attachedSkillDamageBonus(c, "art", dagger[0].id);
      c.learnedAttachedEffects = ["dual_wield_up"];
      c.equippedWeaponIds = [dagger[0].id, dagger[1].id];
      const dual = CD.attachedSkillDamageBonus(c, "art", dagger[0].id);

      // 自動屬性
      const enemyKey = "dragon|great_earth_dragon|1";
      // 沒有敵人 → 只寫紀錄、不動蓄積。
      state.battle.selectedEnemyIds = [];
      state.battle.attributeStatus.enemyAccum = {};
      Core._debugApplyAttachedAutoAttribute(c, "walk_lightning", "雷", "log_walk_lightning_trigger");
      const manual = Object.assign({}, state.battle.attributeStatus.enemyAccum);
      // 自動化GM OFF 也要自動套用（舊期望值是「OFF 時只寫紀錄」，依 2026-09-25 規格改）。
      state.autoGmEnabled = false;
      state.battle.selectedEnemyIds = [enemyKey];
      const got = {};
      [["sprint_fire", "炎", "log_sprint_fire_trigger"], ["walk_lightning", "雷", "log_walk_lightning_trigger"], ["time_gem", "魔", "log_time_gem_trigger"]].forEach(
        (x) => {
          const before = state.battle.attributeStatus.enemyAccum[enemyKey + "|" + x[1]] || 0;
          Core._debugApplyAttachedAutoAttribute(c, x[0], x[1], x[2]);
          got[x[0]] = (state.battle.attributeStatus.enemyAccum[enemyKey + "|" + x[1]] || 0) - before;
        }
      );
      return { base, resist, twoHand, dual, manual, got };
    });
    assert(r.base.poison === 0 && r.base.fire === 0, "沒習得耐性時上限不變");
    assert(r.resist.poison === 1 && r.resist.rot === 0, "狀態異常耐性（選猛毒）→ 猛毒上限 +1、其他不變", r.resist);
    assert(r.resist.fireZh === 1 && r.resist.fireJa === 1 && r.resist.thunder === 0, "屬性耐性（選炎/火）→ 火／炎上限 +1、雷不變", r.resist);
    assert(r.twoHand === 5 && r.dual === 5, "雙手持握強化／雙刀持握強化 → 戰技 +5", [r.twoHand, r.dual]);
    assert(Object.keys(r.manual).length === 0, "沒有敵人 → 只寫紀錄，不動蓄積");
    assert(
      ["sprint_fire", "walk_lightning", "time_gem"].every((k) => r.got[k] >= 1 && r.got[k] <= 6),
      "自動化GM OFF 也自動套用：炎／雷／魔各擲 1D（1〜6）加到敵人蓄積",
      r.got
    );
  } catch (e) {
    console.error(e);
    fails++;
  } finally {
    await browser.close();
  }
  console.log(fails ? fails + " FAIL" : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
