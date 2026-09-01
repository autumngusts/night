// ============================================================================
// 公開盤屬性簡易顯示（造成/承受）現況實測（一次性診斷用，不提交進Git）
// ============================================================================
const { chromium } = require("playwright");
const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("dialog", async (d) => { await d.accept("night"); });
  let ok = true;
  try {
    await page.goto(BASE + "/admin/index.html", { waitUntil: "networkidle" });
    const gameId = await page.evaluate(() => window.PriTestGames.create("attr-summary-smoke", "tricephalos", "local").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      var Core = window.PriTestNightCore;
      var state = Core.state;
      var CD = window.PriTestCharacterDrawer;
      var CT = window.PriTestCharacterTypes;
      var typeId = CT && CT.list && CT.list()[0] ? CT.list()[0].id : null;
      var c = CD.newCharacter("測試者1", typeId);
      c.entered = true;
      Core.getRosterCharacters().push(c);
      Core.saveRosterCharacters();

      var enemyKey = "dragon|great_earth_dragon|1";
      state.battle.selectedEnemyIds = [enemyKey];
      state.battle.attributeStatus.enemyAccum = {};
      state.battle.attributeStatus.enemyAccum[enemyKey + "|火"] = 12;
      state.battle.attributeStatus.received = {};
      state.battle.attributeStatus.received[c.id] = { 猛毒: 3 };
      Core.saveState();
      document.getElementById("btn-attribute-status-info").click();

      var container = document.getElementById("board-side-attribute-summary");
      var dealtEl = document.getElementById("board-side-attribute-dealt");
      var receivedEl = document.getElementById("board-side-attribute-received");
      return {
        enemyKey: enemyKey,
        hidden: container ? container.hidden : "no container",
        dealtText: dealtEl ? dealtEl.textContent : null,
        receivedText: receivedEl ? receivedEl.textContent : null,
      };
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.hidden) {
      console.log("❌ #board-side-attribute-summary 仍是hidden");
      ok = false;
    } else {
      console.log("✅ #board-side-attribute-summary 已顯示");
    }
    if (!result.dealtText || result.dealtText.indexOf("12/") === -1) {
      console.log("❌ 造成的屬性內容不正確");
      ok = false;
    } else {
      console.log("✅ 造成的屬性內容正確");
    }
    if (!result.receivedText || result.receivedText.indexOf("猛毒3/8") === -1) {
      console.log("❌ 承受的屬性內容不正確");
      ok = false;
    } else {
      console.log("✅ 承受的屬性內容正確");
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
