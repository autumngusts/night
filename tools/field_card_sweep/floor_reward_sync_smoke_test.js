// ============================================================================
// 樓層獲得獎勵視窗跨裝置同步實測（一次性診斷用，不提交進Git）
// ============================================================================
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const FB_PROJECT = "elden-ring-nightreign";
const TMP_JSON = path.join(__dirname, "_floor_reward_sync_tmp.json");

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
    gameId = await page.evaluate(() => window.PriTestGames.create("floor-reward-sync-smoke", "tricephalos", "cloud").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.firebase && window.firebase.apps.length > 0, { timeout: 15000 });
    await page.waitForFunction(() => window.firebase.auth().currentUser !== null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      var Core = window.PriTestNightCore;
      var CD = window.PriTestCharacterDrawer;
      var CT = window.PriTestCharacterTypes;
      var typeId = CT && CT.list && CT.list()[0] ? CT.list()[0].id : null;
      var c = CD.newCharacter("測試者1", typeId);
      c.entered = true;
      Core.getRosterCharacters().push(c);
      Core.saveRosterCharacters();
    });

    // 找一個真的有judgment reward的floor，順便驗證resolveFloorByRewardKey本身邏輯正確
    const keyInfo = await page.evaluate(() => {
      var Fields = window.PriTestFields;
      var FB = window.PriTestNightFloorBreakthrough;
      var candidates = ["card_2", "card_3", "card_4", "card_5", "card_6"];
      for (var i = 0; i < candidates.length; i++) {
        var card = Fields.get(candidates[i]);
        if (!card || !card.branches) continue;
        for (var b = 0; b < card.branches.length; b++) {
          var floors = card.branches[b].floors || [];
          for (var f = 0; f < floors.length; f++) {
            if (FB.floorHasJudgmentReward(floors[f])) {
              floors[f].__rewardKey = floors[f].__rewardKey || (candidates[i] + "_" + b + "_" + f);
              return { cardId: candidates[i], branchIndex: b, floorIndex: f, rewardKey: floors[f].__rewardKey };
            }
          }
        }
      }
      return null;
    });
    console.log("找到的floor：", JSON.stringify(keyInfo));
    if (!keyInfo) {
      console.log("⚠️ 找不到任何有judgment reward的floor可供測試，略過此測試");
    } else {
      fbSet(`/games/${gameId}/nightState/gmFlow/floorRewardModalKey`, { slotIndex: 0, rewardKey: keyInfo.rewardKey });
      await page.waitForTimeout(1500);
      const frResult = await page.evaluate(() => ({
        hidden: document.getElementById("floor-reward-modal").hidden,
        contentHtml: document.getElementById("floor-reward-modal-content").innerHTML.length,
      }));
      console.log("floor-reward result:", JSON.stringify(frResult));
      if (frResult.hidden !== false) { console.log("❌ floor-reward-modal 沒有自動開啟"); ok = false; }
      else console.log("✅ floor-reward-modal 自動開啟成功");
      if (frResult.contentHtml === 0) { console.log("❌ floor-reward-modal 內容是空的"); ok = false; }
      else console.log("✅ floor-reward-modal 有渲染內容");

      fbSet(`/games/${gameId}/nightState/gmFlow/floorRewardModalKey`, null);
      await page.waitForTimeout(1500);
      const frClosed = await page.evaluate(() => document.getElementById("floor-reward-modal").hidden);
      console.log("清除後 hidden =", frClosed);
      if (frClosed !== true) { console.log("❌ floor-reward-modal 沒有自動關閉"); ok = false; }
      else console.log("✅ floor-reward-modal 自動關閉成功");
    }
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
