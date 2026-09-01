// ============================================================================
// 跨裝置同步顯示視窗（獎勵清單／突破判定／樓層獎勵）現況實測（一次性診斷用，不提交進Git）
// ============================================================================
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const FB_PROJECT = "elden-ring-nightreign";
const TMP_JSON = path.join(__dirname, "_reward_sync_tmp.json");

function fbSet(dbPath, jsonValue) {
  fs.writeFileSync(TMP_JSON, JSON.stringify(jsonValue));
  execFileSync("firebase", ["database:set", dbPath, TMP_JSON, "--project", FB_PROJECT, "-f"], { stdio: "pipe", shell: true });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("dialog", async (d) => { await d.accept("night"); });
  let ok = true;
  let gameId = null;
  try {
    await page.goto(BASE + "/admin/index.html", { waitUntil: "networkidle" });
    gameId = await page.evaluate(() => window.PriTestGames.create("reward-sync-smoke", "tricephalos", "cloud").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.firebase && window.firebase.apps.length > 0, { timeout: 15000 });
    await page.waitForFunction(() => window.firebase.auth().currentUser !== null, { timeout: 15000 });
    await page.waitForTimeout(2500); // bootstrap push

    // --- 測試1：turn-reward-modal 全裝置自動開啟 ---
    console.log("\n--- 測試 turn-reward-modal ---");
    fbSet(`/games/${gameId}/nightState/activeDraws/turnRewardAutoOpen`, true);
    await page.waitForTimeout(1500);
    let trHidden = await page.evaluate(() => document.getElementById("turn-reward-modal").hidden);
    console.log("turnRewardAutoOpen=true後 hidden =", trHidden);
    if (trHidden !== false) { console.log("❌ turn-reward-modal 沒有自動開啟"); ok = false; }
    else console.log("✅ turn-reward-modal 自動開啟成功");
    fbSet(`/games/${gameId}/nightState/activeDraws/turnRewardAutoOpen`, false);
    await page.waitForTimeout(1500);
    trHidden = await page.evaluate(() => document.getElementById("turn-reward-modal").hidden);
    console.log("turnRewardAutoOpen=false後 hidden =", trHidden);
    if (trHidden !== true) { console.log("❌ turn-reward-modal 沒有自動關閉"); ok = false; }
    else console.log("✅ turn-reward-modal 自動關閉成功");

    // --- 測試2：breakthrough-modal 全裝置自動開啟+骰子資料同步 ---
    console.log("\n--- 測試 breakthrough-modal ---");
    const fakeBreakthrough = {
      slotIndex: null,
      mode: "generic",
      moveTarget: null,
      characters: { "char-fake-1": { stat: "luck", dice: [3, 5, 6], rerollPending: false } },
      revealed: false,
      minimized: false,
    };
    fbSet(`/games/${gameId}/nightState/activeDraws/breakthrough`, fakeBreakthrough);
    await page.waitForTimeout(1500);
    const bkResult = await page.evaluate(() => {
      var modalHidden = document.getElementById("breakthrough-modal").hidden;
      var sumLabel = document.getElementById("breakthrough-sum-label").textContent;
      return { modalHidden, sumLabel };
    });
    console.log("breakthrough result:", JSON.stringify(bkResult));
    if (bkResult.modalHidden !== false) { console.log("❌ breakthrough-modal 沒有自動開啟"); ok = false; }
    else console.log("✅ breakthrough-modal 自動開啟成功");
    if (bkResult.sumLabel.indexOf("14") === -1) { console.log("❌ 骰子總和(3+5+6=14)沒有正確顯示"); ok = false; }
    else console.log("✅ 遠端骰子資料正確渲染（總和14）");

    // 縮小
    fakeBreakthrough.minimized = true;
    fbSet(`/games/${gameId}/nightState/activeDraws/breakthrough`, fakeBreakthrough);
    await page.waitForTimeout(1500);
    const bkMin = await page.evaluate(() => ({
      modalHidden: document.getElementById("breakthrough-modal").hidden,
      restoreHidden: document.getElementById("btn-breakthrough-restore").hidden,
    }));
    console.log("縮小後:", JSON.stringify(bkMin));
    if (bkMin.modalHidden !== true || bkMin.restoreHidden !== false) { console.log("❌ 縮小狀態沒有正確同步"); ok = false; }
    else console.log("✅ 縮小狀態正確同步");

    // 清除
    fbSet(`/games/${gameId}/nightState/activeDraws/breakthrough`, null);
    await page.waitForTimeout(1500);
    const bkClosed = await page.evaluate(() => ({
      modalHidden: document.getElementById("breakthrough-modal").hidden,
      restoreHidden: document.getElementById("btn-breakthrough-restore").hidden,
    }));
    console.log("清除後:", JSON.stringify(bkClosed));
    if (bkClosed.modalHidden !== true || bkClosed.restoreHidden !== true) { console.log("❌ 關閉狀態沒有正確同步"); ok = false; }
    else console.log("✅ 關閉狀態正確同步");
  } catch (err) {
    console.log("EXCEPTION:", err.message);
    ok = false;
  } finally {
    if (gameId) {
      try {
        await page.evaluate((gid) => window.PriTestGames.remove(gid), gameId);
        await page.waitForTimeout(1000);
      } catch (e) {}
    }
    await browser.close();
    try { fs.unlinkSync(TMP_JSON); } catch (e) {}
  }
  console.log(ok ? "\n=== 總結：通過 ===" : "\n=== 總結：發現問題 ===");
  process.exit(ok ? 0 : 1);
})();
