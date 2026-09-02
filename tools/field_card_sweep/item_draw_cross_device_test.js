// ============================================================================
// 武器/飾品/消耗品抽選跨裝置還原清單與本機操作現況實測（一次性診斷用，不提交進Git）
// ============================================================================
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const FB_PROJECT = "elden-ring-nightreign";
const TMP_JSON = path.join(__dirname, "_item_draw_cross_tmp.json");

function fbSet(dbPath, jsonValue) {
  fs.writeFileSync(TMP_JSON, JSON.stringify(jsonValue));
  execFileSync("firebase", ["database:set", dbPath, TMP_JSON, "--project", FB_PROJECT, "-f"], { stdio: "pipe", shell: true });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("dialog", async (d) => { await d.accept("night"); });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  let ok = true;
  let gameId = null;
  try {
    await page.goto(BASE + "/admin/index.html", { waitUntil: "networkidle" });
    gameId = await page.evaluate(() => window.PriTestGames.create("item-draw-cross-smoke", "tricephalos", "cloud").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.firebase && window.firebase.apps.length > 0, { timeout: 15000 });
    await page.waitForFunction(() => window.firebase.auth().currentUser !== null, { timeout: 15000 });
    await page.waitForTimeout(2500);

    // --- 本機開啟武器抽選（真實本機操作）---
    const localOpen = await page.evaluate(() => {
      var Core = window.PriTestNightCore;
      var CD = window.PriTestCharacterDrawer;
      var CT = window.PriTestCharacterTypes;
      var typeId = CT && CT.list && CT.list()[0] ? CT.list()[0].id : null;
      var c = CD.newCharacter("本機角色", typeId);
      c.entered = true;
      Core.getRosterCharacters().push(c);
      Core.saveRosterCharacters();
      Core.openItemDrawModal("weapon", c.id, {});
      return { charId: c.id, modalHidden: document.getElementById("item-draw-modal").hidden };
    });
    console.log("本機開啟武器抽選：", JSON.stringify(localOpen));
    if (localOpen.modalHidden !== false) { console.log("❌ 本機開啟後item-draw-modal應該可見"); ok = false; }
    else console.log("✅ 本機開啟武器抽選視窗正確顯示");

    // --- 模擬遠端：另一名角色也有一筆縮小中的飾品抽選 ---
    const fakeCharId = "remote-char-fake";
    fbSet(`/games/${gameId}/nightState/activeDraws/talismanByChar/${fakeCharId}`, {
      characterId: fakeCharId,
      tableDie: 3,
      tableLetter: "B",
      groupDie: 2,
      groupIndex: 0,
      itemDie: 4,
      item: null,
      itemMissMessage: false,
      resolved: false,
      resolvedMessage: null,
      minimized: true,
    });
    await page.waitForTimeout(2000);

    const restoreListResult = await page.evaluate(() => {
      var list = document.getElementById("item-draw-restore-list");
      var chips = Array.from(list.querySelectorAll(".potential-power-restore-chip")).map((b) => b.textContent);
      return { hidden: list.hidden, chips: chips };
    });
    console.log("還原清單：", JSON.stringify(restoreListResult));
    if (restoreListResult.hidden || restoreListResult.chips.length !== 1) {
      console.log("❌ 應該出現1個遠端飾品抽選的還原按鈕");
      ok = false;
    } else {
      console.log("✅ 正確出現遠端飾品抽選的還原按鈕（本機自己開啟的武器抽選不重複列出）");
    }

    // 確認本機的武器抽選視窗內容沒有被這次遠端同步干擾
    const localStillOpen = await page.evaluate(() => document.getElementById("item-draw-modal").hidden);
    if (localStillOpen !== false) {
      console.log("❌ 本機原本開啟的武器抽選視窗被遠端同步意外關閉了");
      ok = false;
    } else {
      console.log("✅ 本機原本開啟的視窗不受遠端其他角色抽選影響，維持開啟");
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
