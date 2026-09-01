// ============================================================================
// 戰鬥中進度版顯示敵人HP（■圖案）現況實測（一次性診斷用，不提交進Git）
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
    const gameId = await page.evaluate(() => window.PriTestGames.create("hp-squares-smoke", "tricephalos", "local").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById("btn-auto-gm-toggle").click());

    let text = await page.evaluate(() => {
      var Core = window.PriTestNightCore;
      var state = Core.state;
      state.gmFlow.openingPlayed = true;
      state.slots[0] = { code: "C-2", revealed: true };
      state.cardLevels[0] = 0;
      state.focusedIndex = 0;
      state.battle.enemyHpMax[0] = 20;
      state.battle.enemyHpMax[1] = 8;
      for (var i = 0; i < 14; i++) state.battle.enemyHp[i] = true; // row0: 14/20
      for (var i = 20; i < 20 + 3; i++) state.battle.enemyHp[i] = true; // row1: 3/8
      state.actionPhase = "combat";
      state.battle.roundStage = "acting";
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "battleWait";
      Core.saveState();
      Core.renderCurrentLocationStatus();
      var overlay = document.getElementById("location-status-overlay");
      var narrEl = document.getElementById("location-status-narration");
      return {
        overlayHidden: overlay ? overlay.hidden : "no overlay",
        narrExists: !!narrEl,
        narrText: narrEl ? narrEl.textContent : null,
        directCall: Core.getRoundStageNarrationText ? Core.getRoundStageNarrationText() : "no fn",
        actionKind: state.gmFlow.actionKind,
        awaitingOk: state.gmFlow.awaitingOk,
        gmFlowEnabled: state.gmFlowEnabled,
      };
    });
    console.log("debug:", JSON.stringify(text, null, 2));
    text = text.narrText || text.directCall || "";
    console.log("narration:\n" + text);
    if (text.indexOf("敵人目前血量") === -1) {
      console.log("❌ 沒有出現「敵人目前血量」標題");
      ok = false;
    } else {
      console.log("✅ 出現「敵人目前血量」標題");
    }
    const row0Match = /第1排：(■+)/.exec(text);
    const row1Match = /第2排：(■+)/.exec(text);
    console.log("第1排■數：", row0Match ? row0Match[1].length : "找不到");
    console.log("第2排■數：", row1Match ? row1Match[1].length : "找不到");
    if (!row0Match || row0Match[1].length !== 14) {
      console.log("❌ 第1排■數量不正確（應為14）");
      ok = false;
    } else {
      console.log("✅ 第1排■數量正確");
    }
    if (!row1Match || row1Match[1].length !== 3) {
      console.log("❌ 第2排■數量不正確（應為3）");
      ok = false;
    } else {
      console.log("✅ 第2排■數量正確");
    }
    if (/\d+\/\d+/.test(text.split("\n")[0]) || /第1排：\d/.test(text)) {
      console.log("❌ 疑似仍殘留數值格式");
      ok = false;
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
