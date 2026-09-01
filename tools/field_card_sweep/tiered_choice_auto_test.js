// ============================================================================
// 樓層獎勵tieredChoice自動判定現況實測（一次性診斷用，不提交進Git）
// ============================================================================
// 用card_2大教會(1)分岐フロア1的「忍んで切り抜ける（成功）」/「ザコ戦闘（撃破）」
// tieredChoice為例：
//   1. 模擬routeLabels=["忍んで切り抜ける","成功"]，驗證自動判定選中tier0（聖印:★）
//   2. 模擬routeLabels=[]（無資料，例如從規則書「獲得」按鈕直接進入），驗證退回手動選擇
//   3. 模擬routeLabels=["忍んで切り抜ける"]（只有部分片段），驗證不會誤判為tier0
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
    const gameId = await page.evaluate(() => window.PriTestGames.create("tiered-auto-smoke", "tricephalos", "local").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      var Core = window.PriTestNightCore;
      var CD = window.PriTestCharacterDrawer;
      var CT = window.PriTestCharacterTypes;
      var typeId = CT && CT.list && CT.list()[0] ? CT.list()[0].id : null;
      var c = CD.newCharacter("測試者1", typeId);
      c.entered = true;
      Core.getRosterCharacters().push(c);
      Core.saveRosterCharacters();

      var Fields = window.PriTestFields;
      var FB = window.PriTestNightFloorBreakthrough;
      var card = Fields.get("card_2");
      var floor = card.branches[0].floors[0]; // 大教会（1）フロア1
      var entry = floor.reward[0]; // tieredChoice

      function testCase(routeLabels) {
        Core.state.floorRewardObtained = {};
        Core.state.turnRewards = [];
        Core.state.gmFlow.pendingFloorEndRouteLabels = routeLabels;
        var container = document.createElement("div");
        FB.renderFloorRewardSection(container, floor);
        return {
          html: container.innerHTML,
          turnRewardsCount: Core.state.turnRewards.length,
          turnRewardKinds: Core.state.turnRewards.map(function (r) { return r.kind; }),
        };
      }

      var case1 = testCase(["潛行通過", "成功"]);
      var case2 = testCase([]);
      var case3 = testCase(["潛行通過"]);

      return { entryTiers: entry.tiers.map(function (t) { return Fields.localizedText(t.label); }), case1: case1, case2: case2, case3: case3 };
    });

    console.log("段落清單：", JSON.stringify(result.entryTiers));
    console.log("\n案例1（完整比對「忍んで切り抜ける」+「成功」）：");
    console.log("  turnRewards：", JSON.stringify(result.case1.turnRewardKinds));
    console.log("  是否含自動判定文字：", result.case1.html.indexOf("已依實際採取的路線自動判定") !== -1);
    if (result.case1.turnRewardKinds.indexOf("weapon") === -1) {
      console.log("❌ 案例1應該自動套用tier0（聖印:★），但沒有發放");
      ok = false;
    } else {
      console.log("✅ 案例1正確自動套用tier0");
    }

    console.log("\n案例2（無routeLabels資料，應退回手動選擇）：");
    console.log("  turnRewards：", JSON.stringify(result.case2.turnRewardKinds));
    console.log("  是否出現手動下拉選單：", result.case2.html.indexOf("<select>") !== -1 || result.case2.html.indexOf('class="tiered-choice-row"') !== -1);
    if (result.case2.turnRewardKinds.length !== 0) {
      console.log("❌ 案例2不應該自動發放任何獎勵（沒有資料時應該手動）");
      ok = false;
    } else {
      console.log("✅ 案例2正確不自動發放，交由GM手動選擇");
    }

    console.log("\n案例3（只有部分片段「忍んで切り抜ける」，缺「成功」，應退回手動）：");
    console.log("  turnRewards：", JSON.stringify(result.case3.turnRewardKinds));
    if (result.case3.turnRewardKinds.length !== 0) {
      console.log("❌ 案例3不應該自動發放任何獎勵（片段不完整時應該保守退回手動，避免誤判）");
      ok = false;
    } else {
      console.log("✅ 案例3正確保守退回手動選擇，沒有誤判");
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
