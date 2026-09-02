// ============================================================================
// 潛在之力多人獨立抽選現況實測（一次性診斷用，不提交進Git）
// ============================================================================
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const FB_PROJECT = "elden-ring-nightreign";
const TMP_JSON = path.join(__dirname, "_pp_multi_tmp.json");

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
    gameId = await page.evaluate(() => window.PriTestGames.create("pp-multi-smoke", "tricephalos", "local").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);

    // --- 本機測試：兩名角色各自獨立抽選，互不覆蓋 ---
    console.log("--- 測試：本機多角色獨立抽選 ---");
    const localResult = await page.evaluate(() => {
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

      var PP = window.PriTestNightPotentialPower;
      // A 開始抽選並擲骰（不完成）
      PP.openPotentialPowerModal(charA.id, 2, null, null);
      document.querySelector("#potential-power-modal-content button").click(); // 擲骰按鈕
      var mapAfterA = JSON.parse(JSON.stringify(Core.state.activeDraws.potentialPowerByChar));

      // B 也開始抽選（不應影響A的資料）
      PP.openPotentialPowerModal(charB.id, 1, null, null);
      var mapAfterB = JSON.parse(JSON.stringify(Core.state.activeDraws.potentialPowerByChar));

      return {
        charAId: charA.id,
        charBId: charB.id,
        aHasWeaponResultAfterA: !!(mapAfterA[charA.id] && mapAfterA[charA.id].weaponResult),
        aStillHasWeaponResultAfterB: !!(mapAfterB[charA.id] && mapAfterB[charA.id].weaponResult),
        bExists: !!mapAfterB[charB.id],
        bStarCount: mapAfterB[charB.id] ? mapAfterB[charB.id].starCount : null,
      };
    });
    console.log(JSON.stringify(localResult, null, 2));
    if (!localResult.aHasWeaponResultAfterA) { console.log("❌ A擲骰後應該有weaponResult"); ok = false; }
    else console.log("✅ A擲骰後正確有weaponResult");
    if (!localResult.aStillHasWeaponResultAfterB) { console.log("❌ B開始抽選後，A的資料被洗掉了！"); ok = false; }
    else console.log("✅ B開始抽選後，A的資料完全不受影響");
    if (!localResult.bExists || localResult.bStarCount !== 1) { console.log("❌ B的抽選資料不正確"); ok = false; }
    else console.log("✅ B的抽選資料正確獨立存在");
  } catch (err) {
    console.log("EXCEPTION:", err.message);
    ok = false;
  } finally {
    if (gameId) {
      try { await page.evaluate((gid) => window.PriTestGames.remove(gid), gameId); } catch (e) {}
    }
    await browser.close();
    try { fs.unlinkSync(TMP_JSON); } catch (e) {}
  }
  console.log(ok ? "\n=== 總結：通過 ===" : "\n=== 總結：發現問題 ===");
  process.exit(ok ? 0 : 1);
})();
