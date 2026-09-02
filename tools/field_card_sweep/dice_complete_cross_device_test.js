// ============================================================================
// 跨裝置擲骰完成判定修正驗證（一次性診斷用，不提交進Git）
// ============================================================================
// 模擬「另一名玩家在別的裝置擲骰完成」的情境：本分頁只讓角色1本機擲骰，角色2的
// 「已擲骰」狀態改用直接寫入Firebase characters頻道模擬（代表另一台裝置擲骰後同步過來），
// 驗證這個分頁不需要使用者再點一次骰子，roundStage就會自動變成acting。
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const FB_PROJECT = "elden-ring-nightreign";
const TMP_JSON = path.join(__dirname, "_dice_cross_tmp.json");

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
    gameId = await page.evaluate(() => window.PriTestGames.create("dice-cross-smoke", "tricephalos", "cloud").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.firebase && window.firebase.apps.length > 0, { timeout: 15000 });
    await page.waitForFunction(() => window.firebase.auth().currentUser !== null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => document.getElementById("btn-auto-gm-toggle").click());
    await page.waitForTimeout(500);

    const setupInfo = await page.evaluate(() => {
      var Core = window.PriTestNightCore;
      var CD = window.PriTestCharacterDrawer;
      var CT = window.PriTestCharacterTypes;
      var typeId = CT && CT.list && CT.list()[0] ? CT.list()[0].id : null;
      var roster = Core.getRosterCharacters();
      var charA = CD.newCharacter("角色A", typeId);
      charA.entered = true;
      var charB = CD.newCharacter("角色B", typeId);
      charB.entered = true;
      roster.push(charA, charB);
      Core.saveRosterCharacters();
      var state = Core.state;
      state.battle.selectedEnemyIds = ["dragon|great_earth_dragon|1"];
      state.actionPhase = "combat";
      state.battle.roundStage = "awaitingRoll";
      state.battle.combatMode = "normal";
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "battleWait";
      state.gmFlow.battleWaitActive = true;
      Core.saveState();
      Core.renderCurrentLocationStatus();
      Core.renderCharacterRoster();
      return { charAId: charA.id, charBId: charB.id };
    });
    console.log("setup:", JSON.stringify(setupInfo));
    await page.waitForTimeout(2000); // 等待characters/nightState都完成bootstrap push

    // 角色A本機擲骰
    await page.locator("#character-roster-tbody .dice-add-btn", { hasText: "\u{1F3B2}" }).nth(0).click();
    await page.waitForTimeout(800);
    let stageAfterA = await page.evaluate(() => window.PriTestNightCore.state.battle.roundStage);
    console.log("A擲骰後 roundStage =", stageAfterA);
    if (stageAfterA !== "awaitingRoll") {
      console.log("⚠️ A擲骰後就已經是acting（B可能一開始就沒有骰子可擲，或測試前提不成立）");
    }

    // 模擬「角色B在另一台裝置擲骰完成」：直接改Firebase上的characters資料，
    // 不透過這個分頁的任何按鈕操作。
    const charBSnapshot = await page.evaluate((charBId) => {
      var c = window.PriTestNightCore.getRosterCharacters().filter((rc) => rc.id === charBId)[0];
      return JSON.parse(JSON.stringify(c));
    }, setupInfo.charBId);
    charBSnapshot._combatDiceRolled = true;
    charBSnapshot.dicePool = (charBSnapshot.dicePool || []).concat([3, 4]);
    fbSet(`/games/${gameId}/characters/${setupInfo.charBId}`, charBSnapshot);

    await page.waitForTimeout(2000); // 等待subscribeCharacters接收到這筆遠端更新

    const finalState = await page.evaluate(() => {
      var s = window.PriTestNightCore.state;
      return {
        roundStage: s.battle.roundStage,
        actionsHtml: document.getElementById("location-status-actions").innerHTML,
      };
    });
    console.log("角色B「遠端」擲骰完成同步後（本分頁未再操作任何骰子）：");
    console.log("  roundStage =", finalState.roundStage);
    console.log("  actions =", finalState.actionsHtml.slice(0, 200));

    if (finalState.roundStage !== "acting") {
      console.log("❌ 修正未生效：遠端角色擲骰完成同步後，roundStage仍卡在" + finalState.roundStage + "（需要重現的bug）");
      ok = false;
    } else {
      console.log("✅ 修正生效：不需要使用者再點任何骰子，roundStage自動正確變成acting");
    }
    if (!/gm-flow-action-btn/.test(finalState.actionsHtml)) {
      console.log("❌ actions區塊沒有正確出現按鈕");
      ok = false;
    } else {
      console.log("✅ actions區塊正確出現按鈕");
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
