// ============================================================================
// 潛在之力跨裝置還原清單（多角色堆疊）現況實測（一次性診斷用，不提交進Git）
// ============================================================================
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const FB_PROJECT = "elden-ring-nightreign";
const TMP_JSON = path.join(__dirname, "_pp_cross_tmp.json");

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
    gameId = await page.evaluate(() => window.PriTestGames.create("pp-cross-smoke", "tricephalos", "cloud").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.firebase && window.firebase.apps.length > 0, { timeout: 15000 });
    await page.waitForFunction(() => window.firebase.auth().currentUser !== null, { timeout: 15000 });
    await page.waitForTimeout(2500);

    // 模擬遠端：兩位角色各自有一筆縮小中的潛在之力抽選
    const fakeMap = {
      "char-A": { starCount: 2, weaponResult: { item: { name: { zh: "測試劍" } }, favoredName: "測試劍", categoryId: "sword", rarity: "R" }, effectResult: null, effectSlotPreview: null, resolved: null, minimized: true, pendingAttributeTag: null },
      "char-B": { starCount: 1, weaponResult: null, effectResult: null, effectSlotPreview: null, resolved: null, minimized: true, pendingAttributeTag: null },
    };
    fbSet(`/games/${gameId}/nightState/activeDraws/potentialPowerByChar`, fakeMap);
    await page.waitForTimeout(1500);

    const chipResult = await page.evaluate(() => {
      var list = document.getElementById("potential-power-restore-list");
      var chips = Array.from(list.querySelectorAll(".potential-power-restore-chip")).map((b) => b.textContent);
      return { hidden: list.hidden, chipCount: chips.length, chips: chips };
    });
    console.log(JSON.stringify(chipResult, null, 2));
    if (chipResult.hidden !== false || chipResult.chipCount !== 2) {
      console.log("❌ 應該顯示2個還原按鈕");
      ok = false;
    } else {
      console.log("✅ 正確顯示2個獨立的還原按鈕（char-A、char-B各一個）");
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
