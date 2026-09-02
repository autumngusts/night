// ============================================================================
// 「擲完骰未立即判斷進入acting」重現測試（一次性診斷用，不提交進Git）
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
    const gameId = await page.evaluate(() => window.PriTestGames.create("dice-repro", "tricephalos", "local").id);
    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById("btn-auto-gm-toggle").click());

    const setupInfo = await page.evaluate(() => {
      var Core = window.PriTestNightCore;
      var CD = window.PriTestCharacterDrawer;
      var CT = window.PriTestCharacterTypes;
      var typeId = CT && CT.list && CT.list()[0] ? CT.list()[0].id : null;
      var roster = Core.getRosterCharacters();
      var names = [];
      for (var i = 0; i < 2; i++) {
        var c = CD.newCharacter("測試者" + (i + 1), typeId);
        c.entered = true;
        roster.push(c);
        names.push(c.id);
      }
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
      return { charIds: names };
    });
    console.log("setup:", JSON.stringify(setupInfo));

    const btnDump = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".dice-add-btn")).map((b) => ({
        text: b.textContent,
        title: b.title,
        visible: b.offsetParent !== null,
        closestTable: b.closest("table") ? b.closest("table").id : null,
        parentChain: (function () {
          var els = [];
          var el = b;
          for (var i = 0; i < 5 && el; i++) {
            els.push(el.id || el.tagName);
            el = el.parentElement;
          }
          return els.join(" < ");
        })(),
      }));
    });
    console.log("所有.dice-add-btn按鈕：", JSON.stringify(btnDump));

    const diceRollBtnLocator = page.locator("#character-roster-tbody .dice-add-btn", { hasText: "\u{1F3B2}" });
    const diceButtons = await diceRollBtnLocator.count();
    console.log("角色名簿內的擲骰按鈕數量（🎲）：", diceButtons);

    // 角色1擲骰
    await diceRollBtnLocator.nth(0).click();
    await page.waitForTimeout(200);
    let state1 = await page.evaluate(() => {
      var s = window.PriTestNightCore.state;
      return { roundStage: s.battle.roundStage, actionsHtml: document.getElementById("location-status-actions").innerHTML.length };
    });
    console.log("角色1擲骰後：", JSON.stringify(state1));

    // 角色2擲骰（最後一位，理應觸發 awaitingRoll -> acting）
    await diceRollBtnLocator.nth(1).click();
    await page.waitForTimeout(200);
    let state2 = await page.evaluate(() => {
      var s = window.PriTestNightCore.state;
      return {
        roundStage: s.battle.roundStage,
        actionsHtml: document.getElementById("location-status-actions").innerHTML,
      };
    });
    console.log("角色2（最後一位）擲骰後：", JSON.stringify({ roundStage: state2.roundStage, actionsHtmlLen: state2.actionsHtml.length }));
    console.log("actions區塊內容：", state2.actionsHtml.slice(0, 500));

    if (state2.roundStage !== "acting") {
      console.log("❌ 全員擲骰完成後，roundStage沒有正確變成acting（實際：" + state2.roundStage + "）");
      ok = false;
    } else {
      console.log("✅ roundStage正確變成acting");
    }
    const hasActionButtons = /gm-flow-action-btn/.test(state2.actionsHtml);
    if (!hasActionButtons) {
      console.log("❌ actions區塊沒有出現任何按鈕（PC「已完成」按鈕列或[攻擊/防禦]）——即使roundStage已是acting，UI也沒有反映");
      ok = false;
    } else {
      console.log("✅ actions區塊正確出現按鈕");
    }
  } catch (err) {
    console.log("EXCEPTION:", err.message);
    ok = false;
  } finally {
    await browser.close();
  }
  console.log(ok ? "\n=== 總結：未重現到問題（此路徑正常）===" : "\n=== 總結：重現到問題 ===");
})();
