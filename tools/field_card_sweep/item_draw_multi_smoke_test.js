// ============================================================================
// 武器/飾品/消耗品抽選多人獨立化現況實測（一次性診斷用，不提交進Git）
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
    const gameId = await page.evaluate(() => window.PriTestGames.create("item-draw-multi-smoke", "tricephalos", "local").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      var Core = window.PriTestNightCore;
      var CD = window.PriTestCharacterDrawer;
      var CT = window.PriTestCharacterTypes;
      var typeId = CT && CT.list && CT.list()[0] ? CT.list()[0].id : null;
      var charA = CD.newCharacter("角色A", typeId);
      charA.entered = true;
      var charB = CD.newCharacter("角色B", typeId);
      charB.entered = true;
      Core.getRosterCharacters().push(charA, charB);
      Core.saveRosterCharacters();

      var out = {};

      // --- 武器抽選：A開始並選「否」（非潛在力量），B也開始，確認A的選擇不受影響 ---
      var fieldA = document.createElement("div");
      CD.openWeaponRollInline(fieldA, charA.id, null);
      var mapAfterA = JSON.parse(JSON.stringify(Core.state.activeDraws.weaponByChar));
      var fieldB = document.createElement("div");
      CD.openWeaponRollInline(fieldB, charB.id, null);
      var mapAfterB = JSON.parse(JSON.stringify(Core.state.activeDraws.weaponByChar));
      out.weapon = {
        aExistsAfterA: !!mapAfterA[charA.id],
        aStillExistsAfterB: !!mapAfterB[charA.id],
        bExists: !!mapAfterB[charB.id],
        bothDistinctEntries: mapAfterB[charA.id] !== mapAfterB[charB.id],
      };

      // --- 飾品抽選：同樣測試 ---
      var fieldA2 = document.createElement("div");
      CD.openTalismanRollInline(fieldA2, charA.id, null);
      var talA = JSON.parse(JSON.stringify(Core.state.activeDraws.talismanByChar));
      var fieldB2 = document.createElement("div");
      CD.openTalismanRollInline(fieldB2, charB.id, null);
      var talB = JSON.parse(JSON.stringify(Core.state.activeDraws.talismanByChar));
      out.talisman = {
        aExistsAfterA: !!talA[charA.id],
        aStillExistsAfterB: !!talB[charA.id],
        bExists: !!talB[charB.id],
      };

      // --- 消耗品抽選：同樣測試 ---
      var fieldA3 = document.createElement("div");
      CD.openConsumableRollInline(fieldA3, charA.id, 1, null);
      var conA = JSON.parse(JSON.stringify(Core.state.activeDraws.consumableByChar));
      var fieldB3 = document.createElement("div");
      CD.openConsumableRollInline(fieldB3, charB.id, 1, null);
      var conB = JSON.parse(JSON.stringify(Core.state.activeDraws.consumableByChar));
      out.consumable = {
        aExistsAfterA: !!conA[charA.id],
        aStillExistsAfterB: !!conB[charA.id],
        bExists: !!conB[charB.id],
      };

      // --- listPendingDrawEntries 應該列出全部6筆（3種x2角色）---
      out.pendingCount = CD.listPendingDrawEntries().length;

      return out;
    });

    console.log(JSON.stringify(result, null, 2));

    ["weapon", "talisman", "consumable"].forEach(function (kind) {
      var r = result[kind];
      if (!r.aExistsAfterA) { console.log("❌ [" + kind + "] A開始抽選後應該有資料"); ok = false; }
      if (!r.aStillExistsAfterB) { console.log("❌ [" + kind + "] B開始抽選後，A的資料被洗掉了！"); ok = false; }
      if (!r.bExists) { console.log("❌ [" + kind + "] B的資料不存在"); ok = false; }
      if (r.aExistsAfterA && r.aStillExistsAfterB && r.bExists) console.log("✅ [" + kind + "] 兩角色資料互不干擾");
    });

    if (result.pendingCount !== 6) {
      console.log("❌ listPendingDrawEntries應該回傳6筆（3種x2角色），實際：" + result.pendingCount);
      ok = false;
    } else {
      console.log("✅ listPendingDrawEntries正確列出全部6筆進行中抽選");
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
