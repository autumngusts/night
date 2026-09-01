// ============================================================================
// 簡化抽選開關與潛在之力星數權限限制現況實測（一次性診斷用，不提交進Git）
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
    const gameId = await page.evaluate(() => window.PriTestGames.create("simplified-draw-smoke", "tricephalos", "local").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);

    // --- 測試1：簡化抽選開關本身 ---
    const btnExists = await page.evaluate(() => !!document.getElementById("btn-simplified-draw-toggle"));
    console.log("按鈕存在：", btnExists);
    if (!btnExists) { console.log("❌ 找不到#btn-simplified-draw-toggle"); ok = false; }

    const beforeToggle = await page.evaluate(() => window.PriTestNightCore.state.simplifiedDrawEnabled);
    await page.evaluate(() => document.getElementById("btn-simplified-draw-toggle").click());
    const afterToggle = await page.evaluate(() => window.PriTestNightCore.state.simplifiedDrawEnabled);
    console.log("切換前:", beforeToggle, "切換後:", afterToggle);
    if (afterToggle === beforeToggle) { console.log("❌ 簡化抽選開關沒有正確切換"); ok = false; }
    else console.log("✅ 簡化抽選開關正確切換");

    // --- 測試2：星數選單權限（未驗證規則書密碼時應disabled） ---
    const starDisabledBefore = await page.evaluate(() => {
      var Core = window.PriTestNightCore;
      var CD = window.PriTestCharacterDrawer;
      var CT = window.PriTestCharacterTypes;
      var typeId = CT && CT.list && CT.list()[0] ? CT.list()[0].id : null;
      var c = CD.newCharacter("測試者1", typeId);
      c.entered = true;
      Core.getRosterCharacters().push(c);
      Core.saveRosterCharacters();
      window.PriTestNightPotentialPower.openPotentialPowerModal(c.id, 2, null, null);
      return document.getElementById("potential-power-star-select").disabled;
    });
    console.log("未驗證規則書密碼時，星數選單disabled：", starDisabledBefore);
    if (!starDisabledBefore) { console.log("❌ 未驗證規則書密碼時，星數選單應該是disabled"); ok = false; }
    else console.log("✅ 未驗證規則書密碼時，星數選單正確disabled");

    // --- 測試3：簡化抽選開啟後，開啟視窗應直接顯示抽選結果 ---
    const simplifiedResult = await page.evaluate(() => {
      var Core = window.PriTestNightCore;
      var CD = window.PriTestCharacterDrawer;
      var CT = window.PriTestCharacterTypes;
      var typeId = CT && CT.list && CT.list()[0] ? CT.list()[0].id : null;
      var c = CD.newCharacter("測試者2", typeId);
      c.entered = true;
      Core.getRosterCharacters().push(c);
      Core.saveRosterCharacters();
      window.PriTestNightPotentialPower.openPotentialPowerModal(c.id, 2, null, null);
      var pp = Core.state.activeDraws.potentialPowerByChar[c.id];
      return {
        hasWeaponResult: !!(pp && pp.weaponResult),
        hasEffectResult: !!(pp && pp.effectResult),
        contentHtml: document.getElementById("potential-power-modal-content").innerHTML.length,
      };
    });
    console.log(JSON.stringify(simplifiedResult));
    if (!simplifiedResult.hasWeaponResult || !simplifiedResult.hasEffectResult) {
      console.log("❌ 簡化抽選開啟後，開新視窗應該直接顯示抽選結果（不用按擲骰）");
      ok = false;
    } else {
      console.log("✅ 簡化抽選開啟後，直接顯示抽選結果，不需要按擲骰");
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
