// ============================================================================
// 劇本2「咬噬之顎／gaping_jaw」與劇本3「知性之蟲／sentient_pest」
// 全流程 playthrough 測試（day1 → day2 → day3 夜之王戰鬥）
// ============================================================================
// 用途：延伸既有 scenario_playthrough.js（僅測劇本1 day1）與 structure_audit.js
// （逐板塊獨立測試、不跨天）的做法，實際跑一次完整劇本流程：
//
//   1. dealScenarioInitial() 開局，發day1固定9張卡。
//   2. 依序把每個板塊的 focusedIndex 直接指過去（跟 scenario_playthrough.js 相同，
//      不模拟實際地圖移動——地圖移動/隣接規則由 sweep.js 另外覆蓋），驅動自動化GM
//      （autoResolveBranch、戰鬥觸發自動加入戰場、事件籌碼自動解決）直到該板塊「已無
//      更多內容」（mapMove/nightAdvance/finalDayBattle）。
//   3. 全部day1板塊跑完後，點擊主按鈕開啟「留下的卡牌」抽屜，自動選擇
//      keepCardsTarget() 張、送出，進入day2，重複步驟2跑完day2全部板塊。
//   4. day2跑完後，點擊主按鈕（此時會直接呼叫advanceToFinalNightDirect，進入day3），
//      確認會出現「finalDayBattle」提示、夜之王會被自動加入戰場（ensureNight3BossInBattle）、
//      且該夜之王的自動化GM資料（boss_auto_gm_data.js）已結構化。
//
// 另外，每次戰鬥觸發都會diff state.battle.selectedEnemyIds（觸發前後差集），記錄
// 這次自動加入戰場的實際敵人key，用於盤點劇本2/3實際會遇到、且尚未結構化的敵人
// （對照window.PriTestAutoGm.isStructured）。
//
// 使用前準備、執行方式：同資料夾 sweep.js 開頭說明（先 generate.py 建置＋本機HTTP
// 伺服器＋本資料夾 npm install）。
//
//   node scenario23_full_playthrough.js              # 兩個劇本都跑
//   node scenario23_full_playthrough.js gaping_jaw   # 只跑劇本2
//
// 結果寫入 scenario23-playthrough-results.json（未加入git，執行後請自行避免提交）。
// ============================================================================

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const SCENARIO_FILTER = process.argv[2] || null;
const SCENARIOS = ["gaping_jaw", "sentient_pest"].filter((s) => !SCENARIO_FILTER || s === SCENARIO_FILTER);

async function setup(page, scenarioId) {
  page.on("dialog", async (d) => {
    await d.accept("night");
  });
  await page.goto(BASE + "/admin/index.html", { waitUntil: "networkidle" });
  await page.evaluate(() => window.PriTestGames.list().forEach((g) => window.PriTestGames.remove(g.id)));
  const gameId = await page.evaluate(
    (scenarioId) => window.PriTestGames.create("s23-" + scenarioId + "-" + Date.now(), scenarioId, "local").id,
    scenarioId
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
  // 開局：劇本モードなのでbtn-primary-actionはdealScenarioInitial()を直接呼ぶ。
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
async function selectedEnemyIds(page) {
  return page.evaluate(() => (window.PriTestNightCore.state.battle && window.PriTestNightCore.state.battle.selectedEnemyIds) || []);
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
      dayNumber: state.dayNumber,
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
    await page.evaluate(() => {
      window.PriTestNightGmFlow.notifyChipCombatEnded();
      window.PriTestNightCore.saveState();
    });
    await page.waitForTimeout(100);
    return true;
  }
  if (!s.awaitingOk) {
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
  const combatResults = [];
  const branchWarnings = [];
  const newEnemiesSeen = [];
  let steps = 0;
  const maxSteps = 60;

  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /進入/.test(b.textContent));
    if (b) b.click();
  });
  await page.waitForTimeout(150);

  while (steps < maxSteps) {
    steps++;
    const s = await getBannerState(page);

    if (s.actionKind === "chipOffer" || s.actionKind === "chipStrongEnemyOffer") {
      await driveGenericStep(page, s);
      continue;
    }
    if (s.actionKind === "branchChoice") {
      branchWarnings.push("autoResolveBranch 失敗 (buttons=" + JSON.stringify(s.buttons) + ")");
      await driveGenericStep(page, s);
      continue;
    }
    if (s.actionKind === "combatTrigger") {
      const beforeLen = await autoGmLogLength(page);
      const beforeIds = await selectedEnemyIds(page);
      await driveGenericStep(page, s);
      combatResults.push({ pendingSince: beforeLen, beforeIds });
      continue;
    }
    if (s.battleWait && combatResults.length && combatResults[combatResults.length - 1].pendingSince !== undefined) {
      const beforeLen = combatResults[combatResults.length - 1].pendingSince;
      const beforeIds = combatResults[combatResults.length - 1].beforeIds || [];
      await driveGenericStep(page, s);
      const texts = await autoGmLogSince(page, beforeLen);
      const afterIds = await selectedEnemyIds(page);
      const addedIds = afterIds.filter((id) => beforeIds.indexOf(id) === -1);
      const matched = texts.some((t) => /自動加入戰鬥面板/.test(t));
      const manualAdd = texts.filter((t) => /無法自動比對敵人資料，請對照規則書手動加入/.test(t));
      combatResults[combatResults.length - 1] = { matched, manualAdd, addedIds, texts };
      newEnemiesSeen.push(...addedIds);
      continue;
    }

    const r = await driveGenericStep(page, s);
    if (typeof r === "string" && r.startsWith("terminal:")) {
      return { status: "ok:" + r.slice(9), steps, combatResults, branchWarnings, newEnemiesSeen, finalCardLevel: (await getBannerState(page)).cardLevel };
    }
    if (!r) {
      return { status: "stuck:" + s.actionKind, steps, combatResults, branchWarnings, newEnemiesSeen, lastNarration: s.narration, lastButtons: s.buttons };
    }
  }
  return { status: "timeout", steps, combatResults, branchWarnings, newEnemiesSeen };
}

async function advanceToDay2(page) {
  // 主按鈕 -> keep-drawerが開く（day1が終わっていれば）。keepCardsTarget()枚を自動選択して送信する。
  await page.evaluate(() => document.getElementById("btn-primary-action").click());
  await page.waitForTimeout(150);
  const opened = await page.evaluate(() => document.getElementById("keep-drawer").classList.contains("open"));
  if (!opened) return { ok: false, reason: "keep-drawer-not-open" };
  const info = await page.evaluate(() => {
    const target = window.PriTestNightCore ? null : null;
    return null;
  });
  await page.evaluate(() => {
    // keepCardsTarget()枚を、埋まっているスロットから先頭順に選ぶ（既存のrenderKeepGridと
    // 同じクリックイベント経由、内部状態を直接いじらない）。
    const buttons = Array.from(document.querySelectorAll("#keep-grid .mini-card"));
    let needed = 0;
    const submitBtn = document.getElementById("btn-keep-submit");
    // targetはbtn-keep-submitがdisabled=falseになる条件から逆算できないため、
    // keep-countのテキストから読む（例:「已選擇 0 / 3」）。
    const countText = document.getElementById("keep-count").textContent || "";
    const m = /\/\s*(\d+)/.exec(countText) || /(\d+)\s*\/?\s*\D*$/.exec(countText);
    needed = m ? parseInt(m[1], 10) : 3;
    let picked = 0;
    for (const btn of buttons) {
      if (picked >= needed) break;
      if (btn.disabled || btn.classList.contains("locked") || btn.classList.contains("terrain-locked")) continue;
      btn.click();
      picked++;
    }
  });
  await page.waitForTimeout(100);
  const submitDisabled = await page.evaluate(() => document.getElementById("btn-keep-submit").disabled);
  if (submitDisabled) return { ok: false, reason: "submit-still-disabled" };
  await page.evaluate(() => document.getElementById("btn-keep-submit").click());
  await page.waitForTimeout(200);
  return { ok: true };
}

async function advanceToDay3(page) {
  await page.evaluate(() => document.getElementById("btn-primary-action").click());
  await page.waitForTimeout(200);
  return getBannerState(page);
}

async function runScenario(page, scenarioId) {
  const gameId = await setup(page, scenarioId);
  const allEnemiesSeen = new Set();
  const report = { scenarioId, gameId, day1: [], day2: [], day3: null };

  const slotCount = await page.evaluate(() => window.PriTestNightCore.SLOT_COUNT);

  console.log("\n########## " + scenarioId + " day1 ##########");
  for (let idx = 0; idx < slotCount; idx++) {
    let result;
    try {
      result = await runOneSlot(page, idx);
    } catch (e) {
      result = { status: "error:" + e.message };
    }
    (result.newEnemiesSeen || []).forEach((id) => allEnemiesSeen.add(id));
    report.day1.push({ idx, ...result });
    console.log(" [day1 slot" + idx + "] => " + result.status, "steps=" + result.steps);
    (result.branchWarnings || []).forEach((w) => console.log("     ⚠ " + w));
    (result.combatResults || []).forEach((cr) => {
      if (cr.manualAdd && cr.manualAdd.length) cr.manualAdd.forEach((t) => console.log("     [敵人未設定] " + t));
    });
  }

  console.log("\n-- advancing to day2 --");
  const adv = await advanceToDay2(page);
  report.day1ToDay2 = adv;
  if (!adv.ok) {
    console.log("!! FAILED to advance to day2:", adv.reason);
    fs.writeFileSync(path.join(__dirname, "scenario23-playthrough-results.json"), JSON.stringify(report, null, 2));
    return report;
  }

  console.log("\n########## " + scenarioId + " day2 ##########");
  for (let idx = 0; idx < slotCount; idx++) {
    let result;
    try {
      result = await runOneSlot(page, idx);
    } catch (e) {
      result = { status: "error:" + e.message };
    }
    (result.newEnemiesSeen || []).forEach((id) => allEnemiesSeen.add(id));
    report.day2.push({ idx, ...result });
    console.log(" [day2 slot" + idx + "] => " + result.status, "steps=" + result.steps);
    (result.branchWarnings || []).forEach((w) => console.log("     ⚠ " + w));
    (result.combatResults || []).forEach((cr) => {
      if (cr.manualAdd && cr.manualAdd.length) cr.manualAdd.forEach((t) => console.log("     [敵人未設定] " + t));
    });
  }

  console.log("\n-- advancing to day3 (final night boss battle) --");
  const day3State = await advanceToDay3(page);
  const bossCheck = await page.evaluate(() => {
    const Core = window.PriTestNightCore;
    const game = Core.getGame();
    const AutoGm = window.PriTestAutoGm;
    const key = game && game.night3BossId ? "boss|" + game.night3BossId : null;
    return {
      dayNumber: Core.state.dayNumber,
      night3BossId: game && game.night3BossId,
      bossKeyStructured: key ? AutoGm.isStructured(key) : false,
      selectedEnemyIds: (Core.state.battle && Core.state.battle.selectedEnemyIds) || [],
    };
  });
  report.day3 = { day3State, bossCheck };
  console.log(" dayNumber:", bossCheck.dayNumber, "night3BossId:", bossCheck.night3BossId, "structured:", bossCheck.bossKeyStructured);
  console.log(" actionKind:", day3State.actionKind, "narration:", day3State.narration);
  console.log(" selectedEnemyIds:", JSON.stringify(bossCheck.selectedEnemyIds));

  // 進度確認：finalDayBattleボタン（開啟夜王戰鬥）を押して、実際に戦場へ夜之王が入るか確認する。
  if (day3State.actionKind === "finalDayBattle") {
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(200);
    const afterOpen = await page.evaluate(() => {
      const Core = window.PriTestNightCore;
      return {
        actionPhase: Core.state.actionPhase,
        selectedEnemyIds: (Core.state.battle && Core.state.battle.selectedEnemyIds) || [],
        battleDrawerOpen: document.getElementById("battle-drawer").classList.contains("open") || true,
      };
    });
    report.day3.afterOpenFinalBattle = afterOpen;
    console.log(" 開啟夜王戰鬥後 selectedEnemyIds:", JSON.stringify(afterOpen.selectedEnemyIds), "actionPhase:", afterOpen.actionPhase);
  }

  const enemyStructureCheck = await page.evaluate((ids) => {
    const AutoGm = window.PriTestAutoGm;
    return ids.map((id) => ({ id, structured: AutoGm.isStructured(id) }));
  }, Array.from(allEnemiesSeen));
  report.allEnemiesSeen = enemyStructureCheck;
  console.log("\n-- 全部遇到的敵人 key（去重） --");
  enemyStructureCheck.forEach((e) => console.log("  ", e.id, e.structured ? "✅已結構化" : "❌未結構化"));

  fs.writeFileSync(path.join(__dirname, "scenario23-playthrough-results.json"), JSON.stringify(report, null, 2));
  return report;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  const allReports = [];
  for (const scenarioId of SCENARIOS) {
    const report = await runScenario(page, scenarioId);
    allReports.push(report);
  }

  console.log("\n\n=== 總彙總 ===");
  allReports.forEach((r) => {
    const day1Fails = r.day1.filter((x) => !String(x.status).startsWith("ok"));
    const day2Fails = (r.day2 || []).filter((x) => !String(x.status).startsWith("ok"));
    const reachedDay3 = r.day3 && r.day3.bossCheck && r.day3.bossCheck.dayNumber === 3;
    console.log(
      r.scenarioId + ":",
      "day1 fails=" + day1Fails.length,
      "day2 fails=" + day2Fails.length,
      "reached day3=" + reachedDay3,
      "boss structured=" + (r.day3 && r.day3.bossCheck && r.day3.bossCheck.bossKeyStructured)
    );
  });

  fs.writeFileSync(path.join(__dirname, "scenario23-playthrough-results.json"), JSON.stringify(allReports, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
