// ============================================================================
// 簡化抽選：武器/飾品/消耗品自動骰完現況實測（一次性診斷用，不提交進Git）
// ============================================================================
const { chromium } = require("playwright");
const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("dialog", async (d) => { await d.accept("night"); });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  let ok = true;
  try {
    await page.goto(BASE + "/admin/index.html", { waitUntil: "networkidle" });
    const gameId = await page.evaluate(() => window.PriTestGames.create("simplified-draw-item-smoke", "tricephalos", "local").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);

    await page.evaluate(() => document.getElementById("btn-simplified-draw-toggle").click());
    const enabled = await page.evaluate(() => window.PriTestNightCore.state.simplifiedDrawEnabled);
    console.log("簡化抽選已開啟：", enabled);
    if (!enabled) { console.log("❌ 簡化抽選開關未開啟"); ok = false; }

    const result = await page.evaluate(() => {
      var Core = window.PriTestNightCore;
      var CD = window.PriTestCharacterDrawer;
      var CT = window.PriTestCharacterTypes;
      var typeId = CT && CT.list && CT.list()[0] ? CT.list()[0].id : null;
      var c = CD.newCharacter("簡化抽選角色", typeId);
      c.entered = true;
      Core.getRosterCharacters().push(c);
      Core.saveRosterCharacters();

      var out = {};

      // --- 武器：開啟inline後應該已自動骰完（不需要按任何按鈕）---
      var fw = document.createElement("div");
      CD.openWeaponRollInline(fw, c.id, null);
      var wst = Core.state.activeDraws.weaponByChar[c.id];
      out.weapon = {
        categoryId: wst && wst.categoryId,
        rarityConfirmed: wst && wst.rarityConfirmed,
        hasItem: !!(wst && wst.item),
      };

      // --- 飾品：同樣 ---
      var ft = document.createElement("div");
      CD.openTalismanRollInline(ft, c.id, null);
      var tst = Core.state.activeDraws.talismanByChar[c.id];
      out.talisman = {
        tableLetter: tst && tst.tableLetter,
        groupIndexSet: tst && tst.groupIndex !== null,
        hasItemOrMiss: !!(tst && (tst.item || tst.itemMissMessage)),
      };

      // --- 消耗品：同樣（需容忍needsReroll重試後最終落在item或miss）---
      var fc = document.createElement("div");
      CD.openConsumableRollInline(fc, c.id, 1, null);
      var cst = Core.state.activeDraws.consumableByChar[c.id];
      out.consumable = {
        groupDieSet: cst && cst.groupDie !== null,
        needsReroll: cst && cst.needsReroll,
        hasItemOrMiss: !!(cst && (cst.item || cst.itemMissMessage)),
      };

      return out;
    });
    console.log(JSON.stringify(result, null, 2));

    if (!result.weapon.categoryId || !result.weapon.rarityConfirmed || !result.weapon.hasItem) {
      console.log("❌ [武器] 簡化抽選後應該已自動決定分類/確認稀有度/取得道具");
      ok = false;
    } else {
      console.log("✅ [武器] 簡化抽選後自動骰完，直接可查看結果");
    }

    if (!result.talisman.tableLetter || !result.talisman.groupIndexSet || !result.talisman.hasItemOrMiss) {
      console.log("❌ [飾品] 簡化抽選後應該已自動決定表/分組/項目");
      ok = false;
    } else {
      console.log("✅ [飾品] 簡化抽選後自動骰完，直接可查看結果");
    }

    if (!result.consumable.groupDieSet || result.consumable.needsReroll || !result.consumable.hasItemOrMiss) {
      console.log("❌ [消耗品] 簡化抽選後應該已自動決定分組並解析出最終項目（不應停在needsReroll）");
      ok = false;
    } else {
      console.log("✅ [消耗品] 簡化抽選後自動骰完，直接可查看結果");
    }
  } catch (err) {
    console.log("EXCEPTION:", err.message);
    ok = false;
  } finally {
    await browser.close();
  }
  console.log(ok ? "\n=== 總結：通過 ===" : "\n=== 總結：發現問題 ===");
  process.exit(ok ? 0 : 1);
})();
