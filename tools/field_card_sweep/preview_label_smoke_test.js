// ============================================================================
// 進度版顯示優化（進入新板塊「（預覽）」標籤／敘述隱藏「→」選擇項標記）現況實測
// （一次性診斷用，不提交進Git）
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
    const gameId = await page.evaluate(() => window.PriTestGames.create("preview-smoke", "tricephalos", "local").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById("btn-auto-gm-toggle").click());

    await page.evaluate(() => {
      var Core = window.PriTestNightCore;
      var state = Core.state;
      state.dayNumber = 1;
      state.startSuit = "clubs";
      state.slots[0] = { code: "C-2", revealed: true };
      state.cardLevels[0] = 0;
      state.focusedIndex = 0;
      state.gmFlow.openingPlayed = true;
      state.gmFlow.awaitingOk = false;
      state.gmFlow.narrationText = null;
      state.gmFlow.actionKind = "ok";
      Core.saveState();
      Core.renderCurrentLocationStatus();
    });
    await page.waitForTimeout(150);
    const btnInfo = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("#location-status-actions button")).map((b) => b.textContent);
    });
    console.log("按鈕清單：", btnInfo);
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /進入/.test(b.textContent));
      if (b) b.click();
    });
    await page.waitForTimeout(150);

    const result = await page.evaluate(() => {
      var state = window.PriTestNightCore.state;
      return { narrationText: state.gmFlow.narrationText, actionKind: state.gmFlow.actionKind };
    });
    console.log("actionKind:", result.actionKind);
    console.log("narrationText:\n" + result.narrationText);

    if (!result.narrationText || result.narrationText.indexOf("（預覽）") !== 0) {
      console.log("❌ 第一行不是「（預覽）」");
      ok = false;
    } else {
      console.log("✅ 第一行是「（預覽）」");
    }
    if (/[（(]→/.test(result.narrationText)) {
      console.log("❌ 敘述中仍殘留「（→...）」標記");
      ok = false;
    } else {
      console.log("✅ 敘述中沒有「（→...）」標記殘留");
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
