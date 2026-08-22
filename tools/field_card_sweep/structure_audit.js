// ============================================================================
// 全劇本／全板塊 結構化稽核（暫時性 Playwright 腳本，不提交進 Git）
// ============================================================================
// 用途：針對 static_src/scenarios.js 中列出的每一個劇本（10個）、每一天（day1/day2）、
// 每一列固定卡牌，直接把該卡牌塞進板塊0（不跑完整開局流程，加速測試），並在該劇本／
// 該天的 state context 下呼叫既有自動化GM（gmFlowEnabled）的［進入］流程，藉此驗證：
//
//   1. autoResolveBranch 能否根據 varianceTable 自動判斷出正確分岐（不需GM手動選）。
//      若失敗，UI 會落到 actionKind==="branchChoice"（GM手動選分岐畫面）——判定為
//      「此板塊尚未結構化」。
//   2. 樓層文字中引用的敵人（「◯◯(頁碼)/Lv.N」等）是否真的能自動比對成功、加入戰鬥
//      面板。若失敗，autoGmLog 會出現 gm_flow_combat_manual_add_reminder /
//      gm_flow_combat_mob_hp_unresolved_reminder / gm_flow_combat_mob_hp_unknown_reminder
//      文字——判定為「此處引用的敵人尚未在 enemies_data 中設定好」。
//
// 使用前準備、執行方式：同資料夾 sweep.js 開頭說明（先 generate.py 建置＋起本機伺服器
// ＋在本資料夾 npm install）。
//
//   node structure_audit.js
//
// 結果寫入 structure-audit-results.json（已在 .gitignore 的 sweep-results-* pattern
// 之外，執行後請自行避免提交），並在 console 印出彙總。
// ============================================================================

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const SCENARIO_FILTER = process.argv[2] || null; // 例如 "tricephalos"，省略則跑全部劇本

async function setup(page, scenarioId) {
  await page.goto(BASE + "/admin/index.html", { waitUntil: "networkidle" });
  // games.js の MAX_GAMES=5 制限に引っかからないよう、劇本ごとに前回までのテスト用ゲームは
  // 全部消してから作る（本番の save ゲームはこのテストでは一切触らないため安全）。
  await page.evaluate(() => {
    window.PriTestGames.list().forEach((g) => window.PriTestGames.remove(g.id));
  });
  const gameId = await page.evaluate(
    (scenarioId) => window.PriTestGames.create("audit-" + scenarioId + "-" + Date.now(), scenarioId, "local").id,
    scenarioId
  );
  await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
  await page.waitForTimeout(150);
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
    Core.state.boardStarted = true;
    Core.saveState();
  });
  return gameId;
}

async function prepRow(page, scenario, dayNumber, row) {
  await page.evaluate(
    (args) => {
      const Core = window.PriTestNightCore;
      const state = Core.state;
      state.dayNumber = args.dayNumber;
      state.startSuit = args.startSuit;
      state.endSuit = args.endSuit;
      state.slots[0] = { code: args.suit + "-" + args.rank, revealed: true };
      state.cardLevels[0] = 0;
      if (state.floorCleared) delete state.floorCleared["0"];
      if (state.cardFloorRewardGranted) delete state.cardFloorRewardGranted[0];
      if (state.eventChips) state.eventChips[0] = null;
      if (state.eventChipsUsed) state.eventChipsUsed[0] = false;
      if (state.eventChipsData) delete state.eventChipsData[0];
      if (state.freeFloorCleared) delete state.freeFloorCleared[0];
      if (state.gmFlow.resolvedBranchCache) state.gmFlow.resolvedBranchCache = {};
      state.focusedIndex = 0;
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
      if (Core.renderCardLevel) Core.renderCardLevel(0);
      Core.renderCurrentLocationStatus();
    },
    { dayNumber, startSuit: scenario.start.suit, endSuit: scenario.end.suit, suit: row.suit, rank: row.rank }
  );
}

async function autoGmLogLength(page) {
  return page.evaluate(() => (window.PriTestNightCore.state.autoGmLog || []).length);
}

async function autoGmLogSince(page, fromLen) {
  return page.evaluate(
    (fromLen) => (window.PriTestNightCore.state.autoGmLog || []).slice(fromLen).map((e) => (typeof e === "string" ? e : e.text || "")),
    fromLen
  );
}

async function getBannerState(page) {
  return page.evaluate(() => {
    const Core = window.PriTestNightCore;
    const state = Core.state;
    const gf = state.gmFlow;
    const btns = Array.from(document.querySelectorAll("#location-status-actions button")).map((b) => b.textContent);
    return {
      actionKind: gf.actionKind,
      awaitingOk: gf.awaitingOk,
      battleWait: gf.battleWaitActive,
      buttons: btns,
      narration: (gf.narrationText || "").slice(0, 150),
      cardLevel: state.cardLevels[0],
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
    await page.waitForTimeout(50);
    const doneDisabled = await page.evaluate(() => {
      const b = document.getElementById("btn-ability-check-done");
      return !b || b.disabled;
    });
    if (!doneDisabled) await page.evaluate(() => document.getElementById("btn-ability-check-done").click());
    await page.waitForTimeout(60);
    return true;
  }
  if (s.coopModalVisible) {
    await page.evaluate(() => document.querySelectorAll("#cooperative-check-characters button.combat-attack-hit-btn").forEach((b) => !b.disabled && b.click()));
    await page.waitForTimeout(50);
    const confirmDisabled = await page.evaluate(() => {
      const b = document.getElementById("btn-cooperative-check-confirm");
      return !b || b.disabled;
    });
    if (!confirmDisabled) await page.evaluate(() => document.getElementById("btn-cooperative-check-confirm").click());
    await page.waitForTimeout(60);
    return true;
  }
  if (s.tallyModalVisible) {
    await page.evaluate(() => document.querySelectorAll("#branch-tally-characters button.combat-attack-hit-btn").forEach((b) => !b.disabled && b.click()));
    await page.waitForTimeout(50);
    const confirmDisabled = await page.evaluate(() => {
      const b = document.getElementById("btn-branch-tally-confirm");
      return !b || b.disabled;
    });
    if (!confirmDisabled) await page.evaluate(() => document.getElementById("btn-branch-tally-confirm").click());
    await page.waitForTimeout(60);
    return true;
  }
  if (s.breakthroughModalVisible) {
    await page.evaluate(() => document.querySelectorAll("#breakthrough-characters button.combat-attack-hit-btn").forEach((b) => !b.disabled && b.click()));
    await page.waitForTimeout(50);
    const passHidden = await page.evaluate(() => document.getElementById("btn-breakthrough-pass").hidden);
    if (!passHidden) await page.evaluate(() => document.getElementById("btn-breakthrough-pass").click());
    await page.waitForTimeout(60);
    return true;
  }
  if (s.eventChipModalVisible) {
    await page.evaluate(() => {
      const c = document.getElementById("btn-event-chip-modal-close");
      if (c) c.click();
    });
    await page.waitForTimeout(60);
    return true;
  }
  if (s.battleWait) {
    await page.evaluate(() => {
      window.PriTestNightGmFlow.notifyCombatEnded();
      window.PriTestNightCore.saveState();
    });
    await page.waitForTimeout(80);
    return true;
  }
  if (s.actionKind === "chipCombatWait") {
    await page.evaluate(() => {
      window.PriTestNightGmFlow.notifyChipCombatEnded();
      window.PriTestNightCore.saveState();
    });
    await page.waitForTimeout(80);
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
    await page.waitForTimeout(100);
    return clicked;
  }
  if (s.actionKind === "chipCombatResolved") {
    const modalHidden = await page.evaluate(() => document.getElementById("turn-reward-modal").hidden);
    if (!modalHidden) {
      await page.evaluate(() => document.getElementById("btn-turn-reward-modal-close").click());
      await page.waitForTimeout(80);
    }
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(80);
    return true;
  }
  if (s.actionKind === "chipStrongEnemyOffer") {
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /進入強敵戰鬥|強敵戰鬥/.test(b.textContent));
      if (b) b.click();
    });
    await page.waitForTimeout(80);
    return true;
  }
  if (s.actionKind === "chipOffer") {
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(100);
    return true;
  }
  if (s.actionKind === "branchChoice") {
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(80);
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
    await page.waitForTimeout(80);
    return true;
  }
  if (s.actionKind === "combatTrigger") {
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(80);
    return true;
  }
  if (s.actionKind === "floorEnd") {
    const nBtns = s.buttons.length;
    if (nBtns >= 2) {
      await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
      await page.waitForTimeout(120);
      const modalHidden = await page.evaluate(() => document.getElementById("turn-reward-modal").hidden);
      if (!modalHidden) {
        await page.evaluate(() => document.getElementById("btn-turn-reward-modal-close").click());
        await page.waitForTimeout(80);
      }
      for (let pass = 0; pass < 3; pass++) {
        const frOpen = await page.evaluate(() => {
          const el = document.getElementById("floor-reward-modal");
          return el && !el.hidden;
        });
        if (!frOpen) break;
        await page.evaluate(() => document.querySelectorAll("#floor-reward-modal-content button").forEach((b) => !b.disabled && b.click()));
        await page.waitForTimeout(80);
        const dhOpen = await page.evaluate(() => {
          const el = document.getElementById("dice-hand-draw-modal");
          return el && !el.hidden;
        });
        if (dhOpen) {
          await page.evaluate(() => document.getElementById("btn-dice-hand-draw-random") && document.getElementById("btn-dice-hand-draw-random").click());
          await page.waitForTimeout(80);
          await page.evaluate(() => {
            const j = document.getElementById("btn-dice-hand-draw-judge");
            if (j && !j.disabled) j.click();
          });
          await page.waitForTimeout(80);
          await page.evaluate(() => document.getElementById("btn-dice-hand-draw-close") && document.getElementById("btn-dice-hand-draw-close").click());
          await page.waitForTimeout(80);
        }
      }
      await page.evaluate(() => {
        const closeBtn = document.getElementById("btn-floor-reward-modal-close");
        const el = document.getElementById("floor-reward-modal");
        if (closeBtn && el && !el.hidden) closeBtn.click();
      });
      await page.waitForTimeout(80);
      return true;
    }
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(80);
    return true;
  }
  if (s.actionKind === "mapMove" || s.actionKind === "nightAdvance" || s.actionKind === "finalDayBattle") return "terminal:" + s.actionKind;
  if (s.actionKind === "freeFloorChoice") {
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(100);
    return true;
  }
  if (s.buttons.length) {
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(80);
    return true;
  }
  return false;
}

async function runOneRow(page, scenario, dayNumber, row) {
  await prepRow(page, scenario, dayNumber, row);

  const combatResults = [];
  const branchWarnings = [];
  const otherReminders = [];
  let steps = 0;
  const maxSteps = 70;

  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /進入/.test(b.textContent));
    if (b) b.click();
  });
  await page.waitForTimeout(120);

  while (steps < maxSteps) {
    steps++;
    const s = await getBannerState(page);

    if (s.actionKind === "chipOffer" || s.actionKind === "chipStrongEnemyOffer") {
      await driveGenericStep(page, s);
      continue;
    }

    if (s.actionKind === "branchChoice") {
      branchWarnings.push("autoResolveBranch 失敗，落到手動選分岐 (buttons=" + JSON.stringify(s.buttons) + ")");
      await driveGenericStep(page, s);
      continue;
    }

    if (s.actionKind === "combatTrigger") {
      const beforeLen = await autoGmLogLength(page);
      await driveGenericStep(page, s);
      combatResults.push({ pendingSince: beforeLen });
      continue;
    }

    if (s.battleWait && combatResults.length && combatResults[combatResults.length - 1].pendingSince !== undefined) {
      const beforeLen = combatResults[combatResults.length - 1].pendingSince;
      await driveGenericStep(page, s);
      const texts = await autoGmLogSince(page, beforeLen);
      const matched = texts.some((t) => /自動加入戰鬥面板/.test(t));
      const manualAdd = texts.filter((t) => /無法自動比對敵人資料，請對照規則書手動加入/.test(t));
      const mobHpUnresolved = texts.filter((t) => /無法自動比對敵人資料以計算血量/.test(t));
      const mobHpUnknown = texts.filter((t) => /無法自動判定等級補正/.test(t));
      combatResults[combatResults.length - 1] = { matched, manualAdd, mobHpUnresolved, mobHpUnknown, texts };
      continue;
    }

    const r = await driveGenericStep(page, s);
    if (typeof r === "string" && r.startsWith("terminal:")) {
      return { status: "ok:" + r.slice(9), steps, combatResults, branchWarnings, otherReminders, finalCardLevel: (await getBannerState(page)).cardLevel };
    }
    if (!r) {
      return { status: "stuck:" + s.actionKind, steps, combatResults, branchWarnings, otherReminders, finalCardLevel: s.cardLevel, lastNarration: s.narration, lastButtons: s.buttons };
    }
  }
  return { status: "timeout", steps, combatResults, branchWarnings, otherReminders, finalCardLevel: (await getBannerState(page)).cardLevel };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  page.on("dialog", async (d) => {
    await d.accept("night");
  });

  // scenarios.js の SCENARIOS リストは admin ページ側でも読み込まれるので、そこから取得する。
  await page.goto(BASE + "/admin/index.html", { waitUntil: "networkidle" });
  const scenarioList = await page.evaluate(() =>
    window.PriTestScenarios.list()
      .filter((s) => !s.custom)
      .map((s) => ({
        id: s.id,
        name: s.name.zh,
        start: s.start,
        end: s.end,
        day1: s.day1,
        day2: s.day2,
      }))
  );

  console.log("找到", scenarioList.length, "個內建劇本");

  const allResults = [];

  for (const scenario of scenarioList) {
    if (SCENARIO_FILTER && scenario.id !== SCENARIO_FILTER) continue;
    const gameId = await setup(page, scenario.id);
    console.log("\n########## 劇本：" + scenario.name + " (" + scenario.id + ") ##########");

    for (const dayKey of ["day1", "day2"]) {
      const dayNumber = dayKey === "day1" ? 1 : 2;
      const rows = scenario[dayKey] || [];
      for (const row of rows) {
        let result;
        try {
          result = await runOneRow(page, scenario, dayNumber, row);
        } catch (e) {
          result = { status: "error:" + e.message, steps: -1, combatResults: [], branchWarnings: [] };
        }
        const rec = {
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          day: dayNumber,
          pos: row.pos,
          rowName: row.name && row.name.zh,
          code: row.suit + "-" + row.rank,
          ...result,
        };
        allResults.push(rec);
        const flag = rec.branchWarnings.length ? "⚠BRANCH" : String(rec.status).startsWith("ok") ? "OK" : "⚠FLOW:" + rec.status;
        console.log(" [" + dayKey + " pos" + row.pos + "] " + rec.rowName + " (" + rec.code + ") => " + flag);
        if (rec.branchWarnings.length) rec.branchWarnings.forEach((w) => console.log("     " + w));
        (rec.combatResults || []).forEach((cr, i) => {
          if (cr.manualAdd && cr.manualAdd.length) cr.manualAdd.forEach((t) => console.log("     [敵人未設定] " + t));
          if (cr.mobHpUnresolved && cr.mobHpUnresolved.length) cr.mobHpUnresolved.forEach((t) => console.log("     [雜兵HP未設定] " + t));
          if (cr.mobHpUnknown && cr.mobHpUnknown.length) cr.mobHpUnknown.forEach((t) => console.log("     [雜兵等級補正未知] " + t));
        });
      }
    }
  }

  fs.writeFileSync(path.join(__dirname, "structure-audit-results.json"), JSON.stringify(allResults, null, 2));

  console.log("\n\n=== 總彙總 ===");
  console.log("共測試板塊實例數：", allResults.length);

  const branchFails = allResults.filter((r) => (r.branchWarnings || []).length);
  console.log("\n--- 尚未結構化的板塊（autoResolveBranch 失敗，需GM手動選分岐）共 " + branchFails.length + " 筆 ---");
  branchFails.forEach((r) => console.log(" -", r.scenarioName, "day" + r.day, "pos" + r.pos, r.rowName, "(" + r.code + ")"));

  const flowFails = allResults.filter((r) => !String(r.status).startsWith("ok") && !(r.branchWarnings || []).length);
  console.log("\n--- 流程卡住／逾時（可能是其他未結構化問題）共 " + flowFails.length + " 筆 ---");
  flowFails.forEach((r) => console.log(" -", r.scenarioName, "day" + r.day, "pos" + r.pos, r.rowName, "(" + r.code + ") =>", r.status, r.lastNarration || ""));

  const enemyFailSet = new Map();
  allResults.forEach((r) => {
    (r.combatResults || []).forEach((cr) => {
      (cr.manualAdd || []).forEach((t) => {
        const key = t;
        if (!enemyFailSet.has(key)) enemyFailSet.set(key, []);
        enemyFailSet.get(key).push(r.scenarioName + "/day" + r.day + "/pos" + r.pos + " " + r.rowName);
      });
    });
  });
  console.log("\n--- 尚未設定好的敵人（無法自動比對敵人資料）共 " + enemyFailSet.size + " 種文字 ---");
  for (const [text, locs] of enemyFailSet) {
    console.log(" -", text);
    console.log("    出現於：", locs.join(", "));
  }

  const mobHpFailSet = new Map();
  allResults.forEach((r) => {
    (r.combatResults || []).forEach((cr) => {
      (cr.mobHpUnresolved || []).concat(cr.mobHpUnknown || []).forEach((t) => {
        if (!mobHpFailSet.has(t)) mobHpFailSet.set(t, []);
        mobHpFailSet.get(t).push(r.scenarioName + "/day" + r.day + "/pos" + r.pos + " " + r.rowName);
      });
    });
  });
  console.log("\n--- 雜兵HP/等級補正未能自動設定 共 " + mobHpFailSet.size + " 種文字 ---");
  for (const [text, locs] of mobHpFailSet) {
    console.log(" -", text);
    console.log("    出現於：", locs.join(", "));
  }

  await browser.close();
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
