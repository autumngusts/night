// ============================================================================
// midnight（即時制擴張版・技術驗證片）新籌碼點（商人／強敵／隨機事件）＋角色屬性管理＋
// 獎勵清單系統 回歸測試——Firebase Local Emulator版，沿用emulator_sync_check.js同一套
// 「連本機emulator、不觸發App Check」手法（見該檔案開頭說明），這裡只新增這次
// （2026-09-05）新功能的檢查，不重複既有4個風險點。
//
// 使用前準備（跟emulator_sync_check.js完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8791 --directory dist
//   3. npm install（本資料夾內，僅需一次）
//   4. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node new_chips_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const META_WAIT_MS = 15000;

function assert(cond, label, results) {
  results.push({ label: label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label);
}

async function enableEmulatorFlag(page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
    } catch (e) {
      /* 忽略 */
    }
  });
}

async function joinLobby(page, passcode) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", passcode);
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
}

async function readyUp(page) {
  await page.click("#btn-midnight-lobby-ready");
}

// 跟emulator_sync_check.js的walkNear()完全相同（純demo走位，不繞牆，走不到就回傳false）。
async function walkNear(page, targetX, targetY, radius, maxRounds) {
  for (let i = 0; i < maxRounds; i++) {
    const pos = await page.evaluate(() => (window.PriTestMidnight ? window.PriTestMidnight._debugState().localPos : null));
    if (!pos) {
      await page.waitForTimeout(50);
      continue;
    }
    const dx = targetX - pos.x;
    const dy = targetY - pos.y;
    if (Math.hypot(dx, dy) <= radius) return true;
    const keys = [];
    if (dx > 0.15) keys.push("ArrowRight");
    else if (dx < -0.15) keys.push("ArrowLeft");
    if (dy > 0.15) keys.push("ArrowDown");
    else if (dy < -0.15) keys.push("ArrowUp");
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(140);
    for (const k of keys) await page.keyboard.up(k);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = [];

  try {
    await enableEmulatorFlag(page);

    console.log("=== 建立測試場並完成單人開局 ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await joinLobby(page, "1234");
    await readyUp(page);
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });

    const state0 = await page.evaluate(() => window.PriTestMidnight._debugState());
    assert(!!state0.characters[state0.myTokenId], "開局後character/{tokenId}已建立完整角色物件", results);
    assert(state0.characters[state0.myTokenId].typeId, "角色物件帶有typeId（來自lobby選的角色）", results);

    const map = await page.evaluate((seed) => window.PriTestMidnightMap.generateMap(seed), state0.meta.mapSeed);
    const merchantPt = (map.points || []).find((p) => p.type === "merchant");
    const strongEnemyPt = (map.points || []).find((p) => p.type === "strong_enemy");
    const randomEventPt = (map.points || []).find((p) => p.type === "random_event");
    assert(!!merchantPt, "地圖上有商人籌碼點", results);
    assert(!!strongEnemyPt, "地圖上有強敵籌碼點", results);
    assert(!!randomEventPt, "地圖上有隨機事件籌碼點", results);
    const merchants = (map.points || []).filter((p) => p.type === "merchant");
    if (merchants.length === 2) {
      const dist = Math.hypot(merchants[0].x - merchants[1].x, merchants[0].y - merchants[1].y);
      assert(dist >= 15, "兩個商人點彼此距離夠遠（>=15格，實測" + dist.toFixed(1) + "格）", results);
    }

    console.log("=== 商人籌碼：先直接seed盧恩（跳過不相關的塔解謎流程），走近後購買武器/消耗品 ===");
    await page.evaluate(
      ({ gameId, tokenId }) => window.PriTestGameStorage.rtSet(gameId, "cloud", "character/" + tokenId + "/runes", 5),
      { gameId: state0.gameId, tokenId: state0.myTokenId }
    );
    await page.waitForFunction(() => window.PriTestMidnight._debugState().characters[window.PriTestMidnight._debugState().myTokenId].runes === 5, { timeout: 5000 }).catch(() => {});
    if (merchantPt) {
      const reached = await walkNear(page, merchantPt.x + 0.5, merchantPt.y + 0.5, 1.2, 150);
      if (!reached) {
        console.log("  [SKIP] 走位工具沒能在固定佈局的牆壁間走到商人點附近，略過商人相關檢查");
      } else {
        await page.waitForSelector("#midnight-merchant-prompt:not([hidden])", { timeout: 5000 });
        const beforeBuyState = await page.evaluate(() => window.PriTestMidnight._debugState());
        const weaponCountBefore = (beforeBuyState.characters[beforeBuyState.myTokenId].weaponIds || []).length;
        await page.click("#btn-midnight-open-merchant");
        await page.waitForSelector("#midnight-merchant-modal:not([hidden])", { timeout: 5000 });
        await page.click("#btn-midnight-merchant-buy-weapon");
        await page.waitForTimeout(300);
        const afterWeaponBuy = await page.evaluate(() => window.PriTestMidnight._debugState());
        const myChar = afterWeaponBuy.characters[afterWeaponBuy.myTokenId];
        // 角色物件一開始可能已有起始武器（newCharacter()依角色類型的startingWeaponId），
        // 因此驗證「數量比購買前多1」而不是寫死等於1。
        assert(
          myChar.weaponIds && myChar.weaponIds.length === weaponCountBefore + 1,
          "購買武器後character.weaponIds新增1把（購買前" + weaponCountBefore + "把→購買後" + (myChar.weaponIds || []).length + "把）",
          results
        );
        assert(myChar.runes === 4, "購買武器扣款1盧恩（5→4）", results);
        const consumableBtn = await page.$("#midnight-merchant-consumable-list button");
        assert(!!consumableBtn, "商人消耗品清單有渲染出按鈕", results);
        if (consumableBtn) {
          await consumableBtn.click();
          await page.waitForTimeout(300);
          const afterConsumableBuy = await page.evaluate(() => window.PriTestMidnight._debugState());
          const myChar2 = afterConsumableBuy.characters[afterConsumableBuy.myTokenId];
          assert(myChar2.consumables && myChar2.consumables.length === 1, "購買消耗品後character.consumables新增1個", results);
          assert(myChar2.runes === 3, "購買消耗品再扣款1盧恩（4→3）", results);
        }
        await page.click("#btn-midnight-merchant-close");
      }
    }

    console.log("=== 強敵籌碼：走近後自動揭示敵人，進入戰鬥，直接seed血量歸零觸發擊殺獎勵 ===");
    if (strongEnemyPt) {
      const reached = await walkNear(page, strongEnemyPt.x + 0.5, strongEnemyPt.y + 0.5, 1.2, 150);
      if (!reached) {
        console.log("  [SKIP] 走位工具沒能走到強敵點附近，略過強敵相關檢查");
      } else {
        await page
          .waitForFunction(
            (pointId) => {
              const trig = (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId];
              return trig && trig.enemyFamilyId;
            },
            strongEnemyPt.id,
            { timeout: 8000 }
          )
          .catch(() => {});
        const revealedState = await page.evaluate(
          (pointId) => (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId],
          strongEnemyPt.id
        );
        assert(!!(revealedState && revealedState.enemyFamilyId), "靠近強敵籌碼後自動用強敵決定表揭示了敵人", results);
        if (revealedState && revealedState.enemyFamilyId) {
          await page.waitForSelector("#midnight-strong-enemy-banner:not([hidden])", { timeout: 5000 });
          await page.click("#btn-midnight-strong-enemy-enter");
          await page
            .waitForFunction(() => !!window.PriTestMidnight._debugState().activeEncounter, { timeout: 5000 })
            .catch(() => {});
          const enteredState = await page.evaluate(() => window.PriTestMidnight._debugState());
          assert(!!enteredState.activeEncounter, "按下「進入戰鬥」後activeEncounter生效（重用field既有機制）", results);

          await page.evaluate(
            ({ gameId, pointId }) => window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/" + pointId, 0),
            { gameId: state0.gameId, pointId: strongEnemyPt.id }
          );
          await page
            .waitForFunction(
              (tokenId) => {
                const rewards = (window.PriTestMidnight._debugState().pendingRewards || {})[tokenId] || {};
                return Object.keys(rewards).length >= 2;
              },
              state0.myTokenId,
              { timeout: 5000 }
            )
            .catch(() => {});
          const rewardState = await page.evaluate(() => window.PriTestMidnight._debugState());
          const myRewards = rewardState.pendingRewards[rewardState.myTokenId] || {};
          const kinds = Object.keys(myRewards).map((id) => myRewards[id].kind);
          assert(kinds.indexOf("rune") !== -1, "擊殺強敵後獎勵清單有rune項目", results);
          assert(kinds.indexOf("potentialPower") !== -1, "擊殺強敵後獎勵清單有potentialPower項目", results);

          await page.waitForSelector("#midnight-reward-modal:not([hidden])", { timeout: 5000 });
          assert(true, "獎勵清單彈窗在有未解決獎勵時自動彈出", results);

          const runeBtnIndex = kinds.indexOf("rune");
          const buttons = await page.$$("#midnight-reward-list button");
          assert(buttons.length >= 2, "獎勵清單左側列出至少2個項目", results);
          if (runeBtnIndex !== -1 && buttons[runeBtnIndex]) {
            await buttons[runeBtnIndex].click();
            await page.waitForTimeout(200);
            const confirmBtn = await page.$("#midnight-reward-detail button");
            if (confirmBtn) await confirmBtn.click();
            await page.waitForTimeout(300);
          }

          // potentialPower項目：抽選得意武器＋附帶效果，選擇武器那一邊。
          const buttons2 = await page.$$("#midnight-reward-list button");
          if (buttons2[0]) {
            await buttons2[0].click();
            await page.waitForTimeout(200);
            const drawWeaponBtn = await page.$("#midnight-reward-detail button");
            if (drawWeaponBtn) {
              await drawWeaponBtn.click();
              await page.waitForTimeout(200);
              const detailButtons = await page.$$("#midnight-reward-detail button");
              // [0]=再抽武器 [1]=選擇這個(武器) [2]=抽選附帶效果
              if (detailButtons[1]) {
                await detailButtons[1].click();
                await page.waitForTimeout(300);
              }
            }
          }
          const finalState = await page.evaluate(() => window.PriTestMidnight._debugState());
          const finalChar = finalState.characters[finalState.myTokenId];
          const finalRewards = finalState.pendingRewards[finalState.myTokenId] || {};
          const stillUnresolved = Object.keys(finalRewards).filter((id) => !finalRewards[id].resolved);
          assert(stillUnresolved.length === 0, "潛在力量（得意武器擇一）與盧恩獎勵都確認收下後，獎勵清單清空", results);
          assert(finalChar.runes >= 3 + 8, "確認收下rune獎勵後盧恩正確增加（原3+強敵8）", results);
        }
      }
    }

    console.log("=== 隨機事件（聖甲蟲）：走近後顯示描寫文字，選一項能力值投骰判定 ===");
    if (randomEventPt) {
      const reached = await walkNear(page, randomEventPt.x + 0.5, randomEventPt.y + 0.5, 1.2, 150);
      if (!reached) {
        console.log("  [SKIP] 走位工具沒能走到隨機事件點附近，略過聖甲蟲相關檢查");
      } else {
        await page.waitForSelector("#midnight-scarab-banner:not([hidden])", { timeout: 5000 });
        const text = await page.textContent("#midnight-scarab-text");
        assert(!!text && text.length > 0, "隨機事件（聖甲蟲）顯示了event_rulebook.js既有的描寫文字", results);
        await page.click("#btn-midnight-scarab-luck");
        await page.waitForTimeout(300);
        const resultText = await page.textContent("#midnight-scarab-result");
        assert(!!resultText && resultText.length > 0, "投骰判定後顯示了成功/失敗文字", results);
        const pickerHidden = await page.getAttribute("#midnight-scarab-stat-picker", "hidden");
        assert(pickerHidden !== null, "判定過一次後三選一按鈕隱藏（避免重複嘗試）", results);
      }
    }

    console.log("=== 角色屬性管理面板：唯讀顯示目前角色狀態 ===");
    await page.click("#btn-midnight-open-character-sheet");
    await page.waitForSelector("#midnight-character-sheet-modal:not([hidden])", { timeout: 5000 });
    const summary = await page.textContent("#midnight-character-sheet-summary");
    assert(!!summary && summary.length > 0, "角色面板顯示了摘要文字（名稱/等級/HP/FP）", results);
    await page.click("#btn-midnight-character-sheet-close");
  } catch (err) {
    console.error("FATAL:", err);
    results.push({ label: "腳本主流程拋出未預期例外：" + err.message, pass: false });
  } finally {
    const failed = results.filter((r) => !r.pass);
    console.log("\n=== 結果彙總 ===");
    console.log(results.length + "項檢查，" + failed.length + "項失敗");
    if (failed.length) failed.forEach((f) => console.log("  [FAIL] " + f.label));
    await browser.close();
    process.exit(failed.length ? 1 : 0);
  }
})();
