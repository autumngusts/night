// ============================================================================
// 場地卡（板塊）自動化 GM 全面迴歸測試
// ============================================================================
// 用途：對 static_src/fields_data_*.js 中每一張場地卡的每一個分岐（varianceTable
// 決定出的內容，例如「大教會（1）」「封牢(森)」「神殿」等），透過 Playwright 實際
// 操作瀏覽器、走一遍自動化 GM（gmFlowEnabled）流程，驗證：
//
//   1. normal 模式：不使用突破判定，正常一層一層敘述、領獎勵，最終應該正確判定
//      「全踏破」（cardLevels 變成 null）並且自動進入地圖移動步驟。
//   2. breakthrough 模式：用板塊的［突破］按鈕跳過第一層（不算真踏破），其餘樓層
//      走正常流程真的打完。驗證即使最後仍有樓層「未全踏破」，也應該能正常進入
//      地圖移動步驟（不能卡住、也不能誤判全踏破）。
//
// 使用前準備：
//   1. 於 repo 根目錄執行 `py -3 generate.py`（或 `python generate.py`）產生 dist/。
//   2. 啟動本機伺服器：`py -3 -m http.server 8791 --directory dist`
//      （或設定環境變數 PRITEST_BASE_URL 指到你自己啟動的位址）。
//   3. 於本資料夾執行 `npm install`（僅需安裝一次，用來取得 playwright 套件）。
//
// 執行方式：
//   node sweep.js normal              # 對全部場地卡跑「正常流程」
//   node sweep.js breakthrough        # 對全部場地卡跑「突破+籌碼事件交疊」流程
//   node sweep.js normal card_9       # 只測 card_9（封牢／神殿）這一張卡
//
// 注意：這是開發者手動執行的迴歸測試工具，不是 CI 自動跑的測試套件（專案本身
// 沒有正式 test runner）。跑完的結果會寫成 sweep-results-<mode>.json（已加入
// .gitignore，不會被提交）。
// ============================================================================

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const MODE = process.argv[2] || "normal"; // "normal" | "breakthrough"
const CARD_FILTER = process.argv[3] || null; // 例如 "card_9"，只測單一場地卡；省略則測全部

const results = [];

async function setup(page) {
  page.on("dialog", async (d) => {
    await d.accept("night");
  });
  await page.goto(BASE + "/admin/index.html", { waitUntil: "networkidle" });
  const gameId = await page.evaluate(() => window.PriTestGames.create("sweep-" + Date.now(), null, "local").id);
  await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
  await page.waitForTimeout(200);
  // 開啟自動化 GM
  await page.evaluate(() => document.getElementById("btn-auto-gm-toggle").click());
  // 準備 2 名「已入場」的測試角色 + 充足的道具數量，讓需要角色/道具的判定與選項都能走到
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
  return gameId;
}

// 重置指定板塊（數字 0-8）或起點/終點（"start"/"end"）與自動化 GM 的暫時性狀態，
// 讓同一個瀏覽器分頁可以重複用來測試下一個分岐，不必每次都重新建立遊戲。
async function resetSlotAndGmFlow(page, idx) {
  await page.evaluate((idx) => {
    const Core = window.PriTestNightCore;
    const state = Core.state;
    if (typeof idx === "number") {
      state.slots[idx] = null;
      state.cardLevels[idx] = 0;
      if (state.floorCleared) delete state.floorCleared[String(idx)];
      if (state.cardFloorRewardGranted) delete state.cardFloorRewardGranted[idx];
      if (state.eventChips) state.eventChips[idx] = null;
      if (state.eventChipsUsed) state.eventChipsUsed[idx] = false;
      if (state.eventChipsData) delete state.eventChipsData[idx];
      if (state.freeFloorCleared) delete state.freeFloorCleared[idx];
    } else if (idx === "start") {
      state.startChecks = { one: false, all: false };
      state.startDefeated = false;
    } else if (idx === "end") {
      state.endChecks = { one: false, all: false };
    }
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
    state.gmFlow.resolvedBranchCache = {};
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
    // 關掉上一次測試可能留下的任何 modal
    ["ability-check-modal", "cooperative-check-modal", "branch-tally-modal", "turn-reward-modal", "breakthrough-modal", "floor-reward-modal"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    Core.saveState();
    if (typeof idx === "number" && Core.renderCardLevel) Core.renderCardLevel(idx);
    Core.renderCurrentLocationStatus();
  }, idx);
}

function suitForCycle(n) {
  const suits = ["S", "H", "D", "C"];
  return suits[n % 4];
}

async function getBannerState(page) {
  return page.evaluate(() => {
    const Core = window.PriTestNightCore;
    const state = Core.state;
    const gf = state.gmFlow;
    const btns = Array.from(document.querySelectorAll("#location-status-actions button")).map((b) => b.textContent);
    const idx = state.focusedIndex;
    const cardLevel =
      typeof idx === "number"
        ? state.cardLevels[idx]
        : idx === "start"
        ? state.startChecks && state.startChecks.all
          ? null
          : 0
        : idx === "end"
        ? state.endChecks && state.endChecks.all
          ? null
          : 0
        : null;
    return {
      actionKind: gf.actionKind,
      awaitingOk: gf.awaitingOk,
      battleWait: gf.battleWaitActive,
      buttons: btns,
      narration: (gf.narrationText || "").slice(0, 150),
      cardLevel,
      walkBranchIndex: gf.walk ? gf.walk.branchIndex : null,
      walkFloorIndex: gf.walk ? gf.walk.floorIndex : null,
      abilityModalVisible: !document.getElementById("ability-check-modal").hidden,
      coopModalVisible: !document.getElementById("cooperative-check-modal").hidden,
      tallyModalVisible: !document.getElementById("branch-tally-modal").hidden,
      breakthroughModalVisible: !document.getElementById("breakthrough-modal").hidden,
    };
  });
}

// 單一步驟的通用分派：依目前狀態（哪個 modal 開著、或 gmFlow.actionKind 是什麼）
// 採取一個合理的自動化動作。回傳 {progressed, terminal, reason} 供呼叫端判斷。
async function driveStep(page, s, opts) {
  opts = opts || {};

  if (s.abilityModalVisible) {
    await page.evaluate(() => {
      document.querySelectorAll("#ability-check-characters button").forEach((b) => {
        if (!b.disabled) b.click();
      });
    });
    await page.waitForTimeout(60);
    const doneDisabled = await page.evaluate(() => {
      const b = document.getElementById("btn-ability-check-done");
      return !b || b.disabled;
    });
    if (!doneDisabled) {
      await page.evaluate(() => document.getElementById("btn-ability-check-done").click());
      await page.waitForTimeout(80);
    }
    return { progressed: true };
  }
  if (s.coopModalVisible) {
    await page.evaluate(() => {
      document.querySelectorAll("#cooperative-check-characters button.combat-attack-hit-btn").forEach((b) => {
        if (!b.disabled) b.click();
      });
    });
    await page.waitForTimeout(60);
    const confirmDisabled = await page.evaluate(() => {
      const b = document.getElementById("btn-cooperative-check-confirm");
      return !b || b.disabled;
    });
    if (!confirmDisabled) {
      await page.evaluate(() => document.getElementById("btn-cooperative-check-confirm").click());
      await page.waitForTimeout(80);
    }
    return { progressed: true };
  }
  if (s.tallyModalVisible) {
    await page.evaluate(() => {
      document.querySelectorAll("#branch-tally-characters button.combat-attack-hit-btn").forEach((b) => {
        if (!b.disabled) b.click();
      });
    });
    await page.waitForTimeout(60);
    const confirmDisabled = await page.evaluate(() => {
      const b = document.getElementById("btn-branch-tally-confirm");
      return !b || b.disabled;
    });
    if (!confirmDisabled) {
      await page.evaluate(() => document.getElementById("btn-branch-tally-confirm").click());
      await page.waitForTimeout(80);
    }
    return { progressed: true };
  }
  if (s.breakthroughModalVisible) {
    // 每位入場角色都擲一次骰，然後合格通過（breakthroughPass:false 可改成不合格）
    await page.evaluate(() => {
      document.querySelectorAll("#breakthrough-characters button.combat-attack-hit-btn").forEach((b) => {
        if (!b.disabled) b.click();
      });
    });
    await page.waitForTimeout(60);
    const passHidden = await page.evaluate(() => document.getElementById("btn-breakthrough-pass").hidden);
    if (!passHidden) {
      await page.evaluate((pass) => document.getElementById(pass ? "btn-breakthrough-pass" : "btn-breakthrough-fail").click(), opts.breakthroughPass !== false);
      await page.waitForTimeout(80);
    }
    return { progressed: true };
  }

  if (s.battleWait) {
    await page.evaluate(() => {
      window.PriTestNightGmFlow.notifyCombatEnded();
      window.PriTestNightCore.saveState();
    });
    await page.waitForTimeout(100);
    return { progressed: true };
  }

  if (!s.awaitingOk) {
    // 閒置狀態：不是［進入］/［突破］的預設畫面，就是真的卡住了——交給呼叫端判斷
    return { progressed: false, idle: true };
  }

  if (s.actionKind === "chipStrongEnemyOffer") {
    const clicked = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /樓層事件|事件/.test(b.textContent));
      if (b) {
        b.click();
        return true;
      }
      return false;
    });
    await page.waitForTimeout(100);
    return { progressed: clicked };
  }
  if (s.actionKind === "chipOffer") {
    const wantUse = !!opts.useChips;
    const clicked = await page.evaluate((wantUse) => {
      const btns = Array.from(document.querySelectorAll("#location-status-actions button"));
      const b = wantUse ? btns[0] : btns[btns.length - 1];
      if (b) {
        b.click();
        return true;
      }
      return false;
    }, wantUse);
    await page.waitForTimeout(100);
    return { progressed: clicked };
  }
  if (s.actionKind === "branchChoice") {
    const clicked = await page
      .evaluate((wantName) => {
        const btns = Array.from(document.querySelectorAll("#location-status-actions button"));
        let idx = -1;
        if (wantName) idx = btns.findIndex((b) => b.textContent.trim() === wantName);
        if (idx === -1 || idx >= btns.length) idx = 0;
        btns[idx].click();
        return btns[idx].textContent;
      }, opts.branchName || null)
      .catch(() => null);
    await page.waitForTimeout(100);
    return { progressed: true, picked: clicked };
  }
  if (s.actionKind === "lineChoice") {
    const clicked = await page.evaluate((preferKey) => {
      const btns = Array.from(document.querySelectorAll("#location-status-actions button"));
      if (!btns.length) return null;
      let idx = -1;
      if (preferKey) idx = btns.findIndex((b) => /石剣の鍵|石劍鑰匙/.test(b.textContent));
      if (idx === -1) {
        // 避免選到只是「離開此地」而不推進樓層的選項
        idx = btns.findIndex((b) => !/移動|離去|立ち去/.test(b.textContent));
      }
      if (idx === -1) idx = 0;
      btns[idx].click();
      return btns[idx].textContent;
    }, true);
    await page.waitForTimeout(100);
    return { progressed: !!clicked, picked: clicked };
  }
  if (s.actionKind === "combatTrigger") {
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(100);
    return { progressed: true };
  }
  if (s.actionKind === "floorEnd") {
    const nBtns = s.buttons.length;
    if (nBtns >= 2) {
      await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
      await page.waitForTimeout(150);
      const modalHidden = await page.evaluate(() => document.getElementById("turn-reward-modal").hidden);
      if (!modalHidden) {
        await page.evaluate(() => {
          const closeBtn = document.getElementById("btn-turn-reward-modal-close");
          if (closeBtn) closeBtn.click();
        });
        await page.waitForTimeout(100);
      }
      // 若同時開啟需要 GM 判斷的樓層獎勵 modal（tieredChoice／diceHandChoice 等），
      // 把裡面能點的按鈕都點過幾輪（有些種類確認後才會出現後續按鈕），最後再用
      // modal 自己的關閉鈕把它關掉，pendingRewardWindows 才會真正清空。
      for (let pass = 0; pass < 3; pass++) {
        const frModalOpen = await page.evaluate(() => {
          const el = document.getElementById("floor-reward-modal");
          return el && !el.hidden;
        });
        if (!frModalOpen) break;
        await page.evaluate(() => {
          document.querySelectorAll("#floor-reward-modal-content button").forEach((b) => {
            if (!b.disabled) b.click();
          });
        });
        await page.waitForTimeout(100);
        // diceHandChoice 種類的獎勵會另外開一個獨立的抽選 modal
        const dhOpen = await page.evaluate(() => {
          const el = document.getElementById("dice-hand-draw-modal");
          return el && !el.hidden;
        });
        if (dhOpen) {
          await page.evaluate(() => {
            const r = document.getElementById("btn-dice-hand-draw-random");
            if (r) r.click();
          });
          await page.waitForTimeout(100);
          await page.evaluate(() => {
            const j = document.getElementById("btn-dice-hand-draw-judge");
            if (j && !j.disabled) j.click();
          });
          await page.waitForTimeout(100);
          await page.evaluate(() => {
            const c = document.getElementById("btn-dice-hand-draw-close");
            if (c) c.click();
          });
          await page.waitForTimeout(100);
        }
      }
      await page.evaluate(() => {
        const closeBtn = document.getElementById("btn-floor-reward-modal-close");
        const el = document.getElementById("floor-reward-modal");
        if (closeBtn && el && !el.hidden) closeBtn.click();
      });
      await page.waitForTimeout(100);
      return { progressed: true };
    }
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(100);
    return { progressed: true };
  }
  if (s.actionKind === "mapMove") {
    return { progressed: false, terminal: true, reason: "mapMove" };
  }
  if (s.actionKind === "nightAdvance") {
    return { progressed: false, terminal: true, reason: "nightAdvance" };
  }
  if (s.actionKind === "finalDayBattle") {
    return { progressed: false, terminal: true, reason: "finalDayBattle" };
  }
  if (s.actionKind === "freeFloorChoice") {
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(120);
    return { progressed: true };
  }
  // 其餘 actionKind（playerPickCheck／representativePickCheck／openEndedTallyCheck／
  // conditionalCooperativeChoice／multiStatIndividualCheck 觸發鈕等）直接按進度版上
  // 第一顆按鈕即可推進——這些的判定 modal 已經在上面幾個 xxxModalVisible 分支處理過。
  if (s.buttons.length) {
    await page.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await page.waitForTimeout(100);
    return { progressed: true };
  }
  return { progressed: false, stuck: true };
}

async function runOneBranch(page, entry, branchIndex, branch, mode) {
  const idx = entry.id === "a_start" ? "start" : entry.id === "a_golden" ? "end" : 0;
  await resetSlotAndGmFlow(page, idx);
  if (typeof idx === "number") {
    const suit = suitForCycle(branchIndex);
    await page.evaluate(
      (args) => {
        const Core = window.PriTestNightCore;
        Core.state.slots[args.idx] = { code: args.suit + "-" + args.rank, revealed: true };
        Core.state.cardLevels[args.idx] = 0;
        Core.saveState();
        Core.renderBoard();
      },
      { idx, suit, rank: entry.cardLabel }
    );
  }

  const log = [];
  let steps = 0;
  const maxSteps = 90;
  let breakthroughUsed = false;

  while (steps < maxSteps) {
    steps++;
    let s = await getBannerState(page);

    if (!s.awaitingOk && !s.battleWait && !s.abilityModalVisible && !s.coopModalVisible && !s.tallyModalVisible && !s.breakthroughModalVisible) {
      // 閒置狀態（顯示［進入］/［突破］的預設畫面）
      if (s.buttons.length === 0) {
        log.push({ step: steps, note: "idle 狀態下沒有任何按鈕，判定為卡住", s });
        return { status: "stuck-idle", steps, log, finalCardLevel: s.cardLevel };
      }
      if (mode === "breakthrough" && !breakthroughUsed) {
        const hasBreakthrough = await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /突破/.test(b.textContent));
          return !!b;
        });
        if (hasBreakthrough) {
          await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /突破/.test(b.textContent));
            b.click();
          });
          await page.waitForTimeout(120);
          await page.evaluate((branchIndex) => {
            const bs = document.getElementById("breakthrough-branch-select");
            const fs = document.getElementById("breakthrough-floor-select");
            if (bs && !bs.hidden) {
              bs.value = String(branchIndex);
              bs.dispatchEvent(new Event("change"));
            }
            if (fs && !fs.hidden) fs.value = "0";
          }, branchIndex);
          breakthroughUsed = true;
          log.push({ step: steps, note: "開啟突破判定 modal，準備跳過此樓層" });
          continue;
        }
      }
      const clicked = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /進入/.test(b.textContent));
        if (b) {
          b.click();
          return true;
        }
        return false;
      });
      if (!clicked) {
        log.push({ step: steps, note: "找不到［進入］按鈕", s });
        return { status: "stuck-no-enter", steps, log, finalCardLevel: s.cardLevel };
      }
      await page.waitForTimeout(120);
      continue;
    }

    if (s.actionKind === "branchChoice") {
      const r = await driveStep(page, s, { branchName: branch.name });
      log.push({ step: steps, actionKind: s.actionKind, picked: r.picked });
      continue;
    }

    if (mode === "breakthrough" && s.breakthroughModalVisible) {
      await driveStep(page, s, { breakthroughPass: true });
      log.push({ step: steps, note: "突破判定：擲骰並判定合格" });
      continue;
    }

    const r = await driveStep(page, s, { useChips: mode === "breakthrough" });
    if (r.terminal) {
      log.push({ step: steps, note: "到達終點：" + r.reason });
      const finalS = await getBannerState(page);
      return { status: "ok:" + r.reason, steps, log, finalCardLevel: finalS.cardLevel };
    }
    if (!r.progressed) {
      log.push({ step: steps, note: "無法推進，actionKind=" + s.actionKind, buttons: s.buttons, narration: s.narration });
      return { status: "stuck:" + s.actionKind, steps, log, finalCardLevel: s.cardLevel };
    }
    log.push({ step: steps, actionKind: s.actionKind });
  }
  return { status: "timeout", steps, log, finalCardLevel: (await getBannerState(page)).cardLevel };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await setup(page);

  const inv = await page.evaluate(() => {
    return window.PriTestFields.list().map((e) => ({
      id: e.id,
      name: e.name && e.name.zh,
      cardLabel: e.cardLabel,
      branches: (e.branches || []).map((b, bi) => ({
        index: bi,
        name: b.name && b.name.zh,
        freeFloorOrder: !!b.freeFloorOrder,
        floors: b.floors ? b.floors.length : null,
      })),
    }));
  });

  for (const entry of inv) {
    if (CARD_FILTER && entry.id !== CARD_FILTER) continue;
    for (const branch of entry.branches) {
      const label =
        entry.id + " / " + branch.name + " (b" + branch.index + ", floors=" + branch.floors + (branch.freeFloorOrder ? ", freeFloorOrder" : "") + ")";
      let result;
      try {
        result = await runOneBranch(page, entry, branch.index, branch, MODE);
      } catch (e) {
        result = { status: "error:" + e.message, steps: -1, log: [] };
      }
      const rec = { entry: entry.id, name: entry.name, branchIndex: branch.index, branchName: branch.name, floors: branch.floors, mode: MODE, ...result };
      results.push(rec);
      console.log((result.status.startsWith("ok") ? "PASS" : "FAIL") + " | " + label + " => " + result.status + " (steps=" + result.steps + ", cardLevel=" + JSON.stringify(result.finalCardLevel) + ")");
    }
  }

  fs.writeFileSync(path.join(__dirname, "sweep-results-" + MODE + ".json"), JSON.stringify(results, null, 2));
  const fails = results.filter((r) => !r.status.startsWith("ok"));
  console.log("\n=== SUMMARY (" + MODE + ") ===");
  console.log("total:", results.length, "pass:", results.length - fails.length, "fail:", fails.length);
  if (fails.length) {
    console.log("\nFailures:");
    fails.forEach((f) => console.log(" -", f.entry, f.branchName, "=>", f.status));
  }

  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
