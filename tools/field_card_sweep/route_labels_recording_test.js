// ============================================================================
// 路線標籤記錄機制端對端實測（一次性診斷用，不提交進Git）
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
    const gameId = await page.evaluate(() => window.PriTestGames.create("route-record-smoke", "tricephalos", "local").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById("btn-auto-gm-toggle").click());

    await page.evaluate(() => {
      var Core = window.PriTestNightCore;
      var state = Core.state;
      state.gmFlow.openingPlayed = true;
      state.gmFlow.awaitingOk = false;
      state.gmFlow.narrationText = null;
      state.gmFlow.actionKind = "ok";
      state.dayNumber = 1;
      state.startSuit = "clubs";
      // card_2大教会（1）分岐が自動解決されるよう、事前にresolvedBranchCacheを直接指定する
      // （autoResolveBranchの通常経路を経ずに、確実に既知の分岐へ入るため）。
      state.gmFlow.resolvedBranchCache = { "0:C-2": { branchIndex: 0 } };
      state.slots[0] = { code: "C-2", revealed: true };
      state.cardLevels[0] = 0;
      state.focusedIndex = 0;
      Core.saveState();
      Core.renderCurrentLocationStatus();
    });
    await page.waitForTimeout(150);

    // [進入]をクリック→（預覽）敘述→「忍んで切り抜ける/ザコ戦闘」の選択肢まで進む
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /進入/.test(b.textContent));
      if (b) b.click();
    });
    await page.waitForTimeout(150);

    const buttonsBeforeChoice = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#location-status-actions button")).map((b) => b.textContent)
    );
    console.log("進入後的按鈕：", JSON.stringify(buttonsBeforeChoice));

    // 「潛行通過」ボタンをクリック
    const clicked = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => b.textContent === "潛行通過");
      if (b) {
        b.click();
        return true;
      }
      return false;
    });
    console.log("是否成功點擊「潛行通過」：", clicked);
    await page.waitForTimeout(150);

    const walkState = await page.evaluate(() => {
      var walk = window.PriTestNightCore.state.gmFlow.walk;
      return walk ? { floorIndex: walk.floorIndex, routeLabelsByFloor: walk.routeLabelsByFloor } : null;
    });
    console.log("選擇後的walk狀態：", JSON.stringify(walkState));

    if (!clicked) {
      console.log("❌ 沒有找到「潛行通過」按鈕，測試前提不成立（可能分岐/花色設定不對）");
      ok = false;
    } else if (!walkState || !walkState.routeLabelsByFloor || !walkState.routeLabelsByFloor["0"] || walkState.routeLabelsByFloor["0"].indexOf("潛行通過") === -1) {
      console.log("❌ 點擊「潛行通過」後，routeLabelsByFloor沒有正確記錄這個選擇");
      ok = false;
    } else {
      console.log("✅ 點擊「潛行通過」後，routeLabelsByFloor正確記錄了這個選擇：", JSON.stringify(walkState.routeLabelsByFloor));
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
