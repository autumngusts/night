// ============================================================================
// 劇本1（三首獸 / tricephalos）第一天實際盤面 playthrough 測試
// ============================================================================
// 用途：跟 sweep.js（枚舉所有分岐、用自訂無劇本盤面測試）不同，這支腳本改用「真實
// 劇本」開局——固定的9張劇本1第一天卡牌會被實際發到9個板塊、並真的擲出9個籌碼事件
// （state.eventChips，透過rollEventChips()）。用意是驗證：
//
//   1. 有劇本資料時，autoResolveBranch能不能自動判斷出正確分岐（不必GM手動選）。
//   2. 樓層文字中引用各種「◯◯決定表」（封牢エネミー決定表、強敵決定表、地下/屋上
//      エネミー決定表等）時，敵人是否真的能自動比對成功、加入戰鬥面板（而不是
//      落到「無法自動比對敵人資料，請對照規則書手動加入」的提醒）。
//   3. 9個籌碼事件（靈脈／祝福／商人／強敵／隨機）點「使用」後是否都能正常解決
//      （強敵/隨機要能自動擲骰決定出具體內容，不能卡住或報錯）。
//   4. 每張卡牌的樓層全踏破判定、地圖移動銜接是否正確（沿用 sweep.js 的驗證邏輯）。
//
// 使用前準備、執行方式：同 sweep.js 開頭的說明（先 generate.py 建置＋起本機伺服器
// ＋在本資料夾 npm install）。
//
//   node scenario_playthrough.js        # 跑劇本1第一天全部9個板塊
//
// 結果會印出每個板塊：實際分岐是否自動判斷成功、遇到的戰鬥敵人是否自動比對成功、
// 遇到的籌碼事件種類與解決結果、樓層全踏破/地圖移動判定結果。
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const SCENARIO_ID = "tricephalos"; // 規則書「劇本1」

async function setup(page) {
  page.on("dialog", async (d) => {
    await d.accept("night");
  });
  await page.goto(BASE + "/admin/index.html", { waitUntil: "networkidle" });
  const gameId = await page.evaluate(
    (scenarioId) => window.PriTestGames.create("scenario1-" + Date.now(), scenarioId, "local").id,
    SCENARIO_ID
  );
  await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById("btn-auto-gm-toggle").click());
  await page.evaluate(() => {
    const Core = window.PriTestNightCore;
    const CD = window.PriTestCharacterDrawer;
    const CT = window.PriTestCharacterTypes;
    const typeId = CT && CT.list && CT.list()[0] ? CT.list()[0].id : null;
    const roster = Core.getRosterCharacters();
    for (let i = 0; i < 2; i++) {
      const c = CD.newCharacter("測試者" + (i + 1), typeId);
      c.entered = true;
      c.blessingSlots = { current: 2, max: 2 };
      roster.push(c);
    }
    Core.saveRosterCharacters();
    Core.state.stoneswordKeyCount = 99;
    Core.state.smithingStoneCount = 99;
    Core.saveState();
  });
  // 開局：劇本模式下主按鈕會直接呼叫dealScenarioInitial()，把第一天9張固定卡牌
  // 洗到9個板塊、並擲出9個籌碼事件。
  await page.evaluate(() => document.getElementById("btn-primary-action").click());
  await page.waitForTimeout(200);
  return gameId;
}

async function resetGmFlowOnly(page, idx) {
  await page.evaluate((idx) => {
    const Core = window.PriTestNightCore;
    const state = Core.state;
    state.focusedIndex = idx;
    state.gmFlow.walk = null;
    state.gmFlow.awaitingOk = false;
    state.gmFlow.actionKind = "ok";
    state.gmFlow.narrationText = null;
    state.gmFlow.pendingChoiceLabels = [];
    state.gmFlow.battleWaitActive = false;
    state.gmFlow.combatTriggerLabel = null;
    state.gmFlow.pendingFinalFloorSlot = null;
    state.gmFlow.pendingChipCheckSlot = null;
    state.gmFlow.pendingMapMoveSlot = null;
    state.gmFlow.pendingRewardWindows = [];
    state.gmFlow.branchOverrideActive = false;
    state.gmFlow.floorEndRewardOpened = false;
    state.gmFlow.chipOfferSlot = null;
    state.gmFlow.chipOfferContinuation = null;
    state.gmFlow.abilityCheckSpec = null;
    state.gmFlow.cooperativeCheckSpec = null;
    state.gmFlow.branchPointTallySpec = null;
    state.gmFlow.sequentialPairSpec = null;
    state.gmFlow.conditionalCooperativeChoiceSpec = null;
    state.gmFlow.sequentialChainSpec = null;
    state.gmFlow.openEndedTallySpec = null;
    state.gmFlow.representativePickSpec = null;
    state.gmFlow.multiStatCheckSpec = null;
    state.gmFlow.freeFloorOptions = [];
    state.gmFlow.playerPickCheckExcluded = [];
    [
      "ability-check-modal",
      "cooperative-check-modal",
      "branch-tally-modal",
      "turn-reward-modal",
      "breakthrough-modal",
      "floor-reward-modal",
      "event-chip-modal",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }, idx);
}

async function autoGmLogLength(page) {
  return page.evaluate(() => (window.PriTestNightCore.state.autoGmLog || []).length);
}

async function autoGmLogSince(page, fromLen) {
  return page.evaluate((fromLen) => (window.PriTestNightCore.state.autoGmLog || []).slice(fromLen).map((e) => (typeof e === "string" ? e : e.text || "")), fromLen);
}

async function getBannerState(page) {
  return page.evaluate(() => {
    const Core = window.PriTestNightCore;
    const state = Core.state;
    const gf = state.gmFlow;
    const btns = Array.from(document.querySelectorAll("#location-status-actions button")).map((b) => b.textContent);
    const idx = state.focusedIndex;
    return {
      actionKind: gf.actionKind,
      awaitingOk: gf.awaitingOk,
      battleWait: gf.battleWaitActive,
      buttons: btns,
      narration: (gf.narrationText || "").slice(0, 150),
      cardLevel: typeof idx === "number" ? state.cardLevels[idx] : null,
      abilityModalVisible: !document.getElementById("ability-check-modal").hidden,
      coopModalVisible: !document.getElementById("cooperative-check-modal").hidden,
      tallyModalVisible: !document.getElementById("branch-tally-modal").hidden,
      breakthroughModalVisible: !document.getElementById("breakthrough-modal").hidden,
      eventChipModalVisible: !document.getElementById("event-chip-modal").hidden,
    };
  });
}

async function driveGenericStep(page, s) {
  if (s.abilityModalVisible) {
    await page.evaluate(() => document.querySelectorAll("#ability-check-characters button").forEach((b) => !b.disabled && b.click()));
    await page.waitForTimeout(60);
    const doneDisabled = await page.evaluate(() => {
      const b = document.getElementById("btn-ability-check-done");
      return !b || b.disabled;
    });
    if (!doneDisabled) await page.evaluate(() => document.getElementById("btn-ability-check-done").click());
    await page.waitForTimeout(80);
    return true;
  }
  if (s.coopModalVisible) {
    await page.evaluate(() => document.querySelectorAll("#cooperative-check-characters button.combat-attack-hit-btn").forEach((b) => !b.disabled && b.click()));
    await page.waitForTimeout(60);
    const confirmDisabled = await page.evaluate(() => {
      const b = document.getElementById("btn-cooperative-check-confirm");
      return !b || b.disabled;
    });
    if (!confirmDisabled) await page.evaluate(() => document.getElementById("btn-cooperative-check-confirm").click());
    await page.waitForTimeout(80);
    return true;
  }
  if (s.tallyModalVisible) {
    await page.evaluate(() => document.querySelectorAll("#branch-tally-characters button.combat-attack-hit-btn").forEach((b) => !b.disabled && b.click()));
    await page.waitForTimeout(60);
    const confirmDisabled = await page.evaluate(() => {
      const b = document.getElementById("btn-branch-tally-confirm");
      return !b || b.disabled;
    });
    if (!confirmDisabled) await page.evaluate(() => document.getElementById("btn-branch-tally-confirm").click());
    await page.waitForTimeout(80);
    return true;
  }
  if (s.breakthroughModalVisible) {
    await page.evaluate(() => document.querySelectorAll("#breakthrough-characters button.combat-attack-hit-btn").forEach((b) => !b.disabled && b.click()));
    await page.waitForTimeout(60);
    const passHidden = await page.evaluate(() => document.getElementById("btn-breakthrough-pass").hidden);
    if (!passHidden) await page.evaluate(() => document.getElementById("btn-breakthrough-pass").click());
    await page.waitForTimeout(80);
    return true;
  }
  if (s.eventChipModalVisible) {
    await page.evaluate(() => {
      const c = document.getElementById("btn-event-chip-modal-close");
      if (c) c.click();
    });
    await page.waitForTimeout(80);
    return true;
  }
  if (s.battleWait) {
    await page.evaluate(() => {
      window.PriTestNightGmFlow.notifyCombatEnded();
      window.PriTestNightCore.saveState();
    });
    await page.waitForTimeout(100);
    return true;
  }
  if (s.actionKind === "chipCombatWait") {
    // 強敵籌碼戰鬥用的是獨立的戰鬥結束通知（跟樓層戰鬥的notifyCombatEnded不同函式）
    await page.evaluate(() => {
      window.PriTestNightGmFlow.notifyChipCombatEnded();
      window.PriTestNightCore.saveState();
    });
    await page.waitForTimeout(100);
    return true;
  }
  if (!s.awaitingOk) {
    // 閒置狀態（顯示［進入］/［突破］）：多樓層卡牌打完一層後會先回到這個畫面，
    // 需要再按一次［進入］才會繼續敘述下一層——不能直接判定為卡住。
    if (s.buttons.length === 0) return false;
    const clicked = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /進入/.test(b.textContent));
      if (b) {
        b.click();
        return true;
      }
      return false;
    });
    await page.waitForTimeout(120);
    return clicked;
  }
  if (s.actionKind === "chipCombatResolved") {
    // 強敵籌碼擊破後跟樓層戰鬥一樣會開獎勵清單modal，要先關掉pendingRewardWindows才會清空
    const modalHidden = await page.evaluate(() => document.getElementById("turn-reward-modal").hidden);
    if (!modalHidden) {
      await page.evaluate(() => document.getElementById("btn-turn-reward-modal-close").click());
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(100);
    return true;
  }
  if (s.actionKind === "chipStrongEnemyOffer") {
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /進入強敵戰鬥|強敵戰鬥/.test(b.textContent));
      if (b) b.click();
    });
    await page.waitForTimeout(100);
    return true;
  }
  if (s.actionKind === "chipOffer") {
    // 一律點「使用」，讓籌碼事件真的被解決（用意是驗證解決流程，不只是跳過）
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(120);
    return true;
  }
  if (s.actionKind === "branchChoice") {
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(100);
    return true;
  }
  if (s.actionKind === "lineChoice") {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("#location-status-actions button"));
      let idx = btns.findIndex((b) => /石剣の鍵|石劍鑰匙/.test(b.textContent));
      if (idx === -1) idx = btns.findIndex((b) => !/移動|離去|立ち去/.test(b.textContent));
      if (idx === -1) idx = 0;
      btns[idx].click();
    });
    await page.waitForTimeout(100);
    return true;
  }
  if (s.actionKind === "combatTrigger") {
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(100);
    return true;
  }
  if (s.actionKind === "floorEnd") {
    const nBtns = s.buttons.length;
    if (nBtns >= 2) {
      await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
      await page.waitForTimeout(150);
      const modalHidden = await page.evaluate(() => document.getElementById("turn-reward-modal").hidden);
      if (!modalHidden) {
        await page.evaluate(() => document.getElementById("btn-turn-reward-modal-close").click());
        await page.waitForTimeout(100);
      }
      for (let pass = 0; pass < 3; pass++) {
        const frOpen = await page.evaluate(() => {
          const el = document.getElementById("floor-reward-modal");
          return el && !el.hidden;
        });
        if (!frOpen) break;
        await page.evaluate(() => document.querySelectorAll("#floor-reward-modal-content button").forEach((b) => !b.disabled && b.click()));
        await page.waitForTimeout(100);
        const dhOpen = await page.evaluate(() => {
          const el = document.getElementById("dice-hand-draw-modal");
          return el && !el.hidden;
        });
        if (dhOpen) {
          await page.evaluate(() => document.getElementById("btn-dice-hand-draw-random") && document.getElementById("btn-dice-hand-draw-random").click());
          await page.waitForTimeout(100);
          await page.evaluate(() => {
            const j = document.getElementById("btn-dice-hand-draw-judge");
            if (j && !j.disabled) j.click();
          });
          await page.waitForTimeout(100);
          await page.evaluate(() => document.getElementById("btn-dice-hand-draw-close") && document.getElementById("btn-dice-hand-draw-close").click());
          await page.waitForTimeout(100);
        }
      }
      await page.evaluate(() => {
        const closeBtn = document.getElementById("btn-floor-reward-modal-close");
        const el = document.getElementById("floor-reward-modal");
        if (closeBtn && el && !el.hidden) closeBtn.click();
      });
      await page.waitForTimeout(100);
      return true;
    }
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(100);
    return true;
  }
  if (s.actionKind === "mapMove" || s.actionKind === "nightAdvance" || s.actionKind === "finalDayBattle") return "terminal:" + s.actionKind;
  if (s.actionKind === "freeFloorChoice") {
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(120);
    return true;
  }
  if (s.buttons.length) {
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(100);
    return true;
  }
  return false;
}

async function runOneSlot(page, idx) {
  await resetGmFlowOnly(page, idx);
  const cardName = await page.evaluate((idx) => {
    const Core = window.PriTestNightCore;
    const slot = Core.state.slots[idx];
    const card = slot && Core.CARD_BY_CODE[slot.code];
    const entry = card ? window.PriTestNightFloorBreakthrough.resolveFieldEntryForSlot(idx) : null;
    return { code: slot && slot.code, entryName: entry && entry.name && entry.name.zh, chip: Core.state.eventChips[idx] };
  }, idx);

  const combatResults = []; // {beforeLen, matched, texts}
  const chipEvents = [];
  const branchWarnings = [];
  let steps = 0;
  const maxSteps = 60;

  // 進入
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /進入/.test(b.textContent));
    if (b) b.click();
  });
  await page.waitForTimeout(150);

  while (steps < maxSteps) {
    steps++;
    const s = await getBannerState(page);

    if (s.actionKind === "chipOffer" || s.actionKind === "chipStrongEnemyOffer") {
      const before = await autoGmLogLength(page);
      await driveGenericStep(page, s);
      const after = await autoGmLogSince(page, before);
      chipEvents.push({ chip: cardName.chip, kind: s.actionKind, logs: after });
      continue;
    }

    if (s.actionKind === "branchChoice") {
      branchWarnings.push("autoResolveBranch 失敗，落到手動選分岐 (buttons=" + JSON.stringify(s.buttons) + ")");
      await driveGenericStep(page, s);
      continue;
    }

    if (s.actionKind === "combatTrigger") {
      const beforeLen = await autoGmLogLength(page);
      await driveGenericStep(page, s); // -> battleWait
      // 等下一輪迴圈觸發 notifyCombatEnded 後再檢查 log
      combatResults.push({ pendingSince: beforeLen });
      continue;
    }

    if (s.battleWait && combatResults.length && combatResults[combatResults.length - 1].pendingSince !== undefined) {
      const beforeLen = combatResults[combatResults.length - 1].pendingSince;
      await driveGenericStep(page, s); // notifyCombatEnded
      const texts = await autoGmLogSince(page, beforeLen);
      const matched = texts.some((t) => /自動加入戰鬥面板/.test(t));
      const failed = texts.some((t) => /無法自動比對敵人資料/.test(t));
      combatResults[combatResults.length - 1] = { matched, failed, texts };
      continue;
    }

    const r = await driveGenericStep(page, s);
    if (typeof r === "string" && r.startsWith("terminal:")) {
      return { cardName, chip: cardName.chip, chipEvents, combatResults, branchWarnings, status: "ok:" + r.slice(9), steps, finalCardLevel: (await getBannerState(page)).cardLevel };
    }
    if (!r) {
      return { cardName, chip: cardName.chip, chipEvents, combatResults, branchWarnings, status: "stuck:" + s.actionKind, steps, finalCardLevel: s.cardLevel };
    }
  }
  return { cardName, chip: cardName.chip, chipEvents, combatResults, branchWarnings, status: "timeout", steps, finalCardLevel: (await getBannerState(page)).cardLevel };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await setup(page);

  const slotCount = await page.evaluate(() => window.PriTestNightCore.SLOT_COUNT);
  const results = [];
  for (let idx = 0; idx < slotCount; idx++) {
    let result;
    try {
      result = await runOneSlot(page, idx);
    } catch (e) {
      result = { status: "error:" + e.message };
    }
    results.push({ idx, ...result });
    console.log("\n=== slot " + idx + " : " + JSON.stringify(result.cardName) + " ===");
    console.log("status:", result.status, "steps:", result.steps, "finalCardLevel:", result.finalCardLevel);
    if (result.branchWarnings && result.branchWarnings.length) console.log("branch warnings:", result.branchWarnings);
    if (result.chipEvents && result.chipEvents.length) {
      result.chipEvents.forEach((ce) => console.log("chip[" + ce.chip + "/" + ce.kind + "]:", ce.logs.join(" | ")));
    }
    if (result.combatResults && result.combatResults.length) {
      result.combatResults.forEach((cr, i) => console.log("combat#" + i + ":", cr.matched ? "MATCHED" : cr.failed ? "**UNMATCHED**" : "?", JSON.stringify(cr.texts)));
    }
  }

  const combatFails = results.flatMap((r) => (r.combatResults || []).filter((c) => c.failed).map(() => r.idx));
  const branchFails = results.filter((r) => (r.branchWarnings || []).length).map((r) => r.idx);
  const flowFails = results.filter((r) => !String(r.status).startsWith("ok"));
  console.log("\n=== SUMMARY (scenario1 day1) ===");
  console.log("slots:", results.length);
  console.log("floor/mapMove failures:", flowFails.length, flowFails.map((r) => r.idx));
  console.log("branch auto-resolve failures:", branchFails.length, branchFails);
  console.log("enemy match failures:", combatFails.length, combatFails);

  await browser.close();
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
