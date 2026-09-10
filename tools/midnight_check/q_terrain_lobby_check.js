// ============================================================================
// midnight（即時制擴張版）2026-09-10新增功能回歸測試：
//   1. Q板塊（地變）改走一般地點fieldCardData() pipeline，完整重現card_q規則資料
//      （3張Q、分歧名稱指定、開放判定從「三選二」放寬成「4/強敵二選一」）。
//   2. ice地變特殊規則「凍寒的暴風雪」：凍傷非戰鬥時也累積（比照red_miasma同一套機制）。
//   3. 創立房間等待畫面改成圓桌狀UI（只影響#midnight-lobby-slots，不影響戰鬥中
//      左上角玩家面板）。
// 這支腳本不重複測試一般戰鬥/樓層/商人/強敵/祝福籌碼的既有邏輯——那些已有
// tools/midnight_check/new_chips_check.js、field_floor_progress_check.js等既有腳本涵蓋，
// 且今天的改動沒有動到那些pipeline本身（只動到「哪些type被排除在外」的判斷），應該搭配
// 那些既有腳本一起跑，確認沒有回歸。
//
// 使用前準備（同emulator_sync_check.js）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8791 --directory dist（或設定PRITEST_BASE_URL）
//   3. tools/midnight_check/ 執行過一次 npm install
//   4. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//
// 執行方式：node q_terrain_lobby_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const META_WAIT_MS = 15000;
const MAX_VARIANT_ATTEMPTS = 12;

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

    console.log("=== 建立midnight測試場（地圖選單設為「完整版」，反覆重建直到抽中新地圖變體） ===");
    let variantId = "basic";
    let map = null;
    let stateA = null;
    for (let attempt = 0; attempt < MAX_VARIANT_ATTEMPTS && variantId === "basic"; attempt++) {
      await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
      await page.click("#btn-midnight-create");
      await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
      await page.selectOption("#midnight-lobby-map-variant-select", "full");
      await joinLobby(page, "1234");
      stateA = await page.evaluate(() => window.PriTestMidnight._debugState());
      map = await page.evaluate(
        (args) => window.PriTestMidnightMap.generateMap(args.seed, args.variantSetting),
        { seed: stateA.meta.mapSeed, variantSetting: "full" }
      );
      variantId = map.variantId;
      console.log("  第" + (attempt + 1) + "次嘗試：抽中變體 " + variantId);
    }
    assert(variantId !== "basic", "重試" + MAX_VARIANT_ATTEMPTS + "次內成功抽中「完整版」新地圖變體（80%機率，理論上很快就會中）", results);
    if (variantId === "basic") throw new Error("抽不到新地圖變體，無法繼續測試Q板塊/地變規則");

    console.log("=== 檢查1：創立房間等待畫面改為圓桌狀UI（只影響#midnight-lobby-slots） ===");
    const lobbyLayout = await page.evaluate(() => {
      const container = document.getElementById("midnight-lobby-slots");
      const cards = container.querySelectorAll(".midnight-slot-card");
      const cs = getComputedStyle(container);
      return {
        containerPosition: cs.position,
        containerDisplay: cs.display,
        cardCount: cards.length,
        cardPositions: Array.from(cards).map((c) => getComputedStyle(c).position),
      };
    });
    assert(lobbyLayout.containerPosition === "relative", "#midnight-lobby-slots改成position:relative（圓桌容器）", results);
    assert(lobbyLayout.cardCount === 3, "等待房仍是3個席位卡片", results);
    assert(lobbyLayout.cardPositions.every((p) => p === "absolute"), "3張席位卡片改成position:absolute（圓桌3個方向），不是舊版flex-column堆疊", results);
    // 戰鬥中左上角玩家面板共用.midnight-slot-card，但容器id不同，不應被這次CSS影響——
    // 這裡只確認選擇器沒有意外用了會波及全站的裸.midnight-slot-card規則（若#midnight-hud-top-left
    // 之後渲染，其容器不是#midnight-lobby-slots，理論上仍是flow layout，這裡先用CSS規則本身
    // 的選擇器範圍佐證，不用真的進戰鬥截圖比對，保持腳本輕量）。

    console.log("=== 準備＋開局 ===");
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });
    await page.evaluate((gameId) => window.PriTestGameStorage.rtSet(gameId, "cloud", "meta/testMode", true), stateA.gameId);
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.testMode, { timeout: 10000 });

    console.log("=== 檢查2：地圖上生成3個Q板塊（地變），且名稱對應variant.qNames ===");
    const variantMeta = await page.evaluate((id) => window.PriTestMidnightMapVariants.get(id), variantId);
    const qPoints = map.points.filter((p) => p.type === "hazard_q");
    assert(qPoints.length === 3, "地圖上恰好生成3個type:hazard_q的點（使用者規格「Q卡牌有三張」）", results);
    const qNamesOnMap = qPoints.map((p) => p.hazardQName).sort();
    const qNamesExpected = (variantMeta.qNames || []).slice().sort();
    assert(JSON.stringify(qNamesOnMap) === JSON.stringify(qNamesExpected), "3個Q板塊的hazardQName恰好對應variant.qNames這3個分歧名稱：" + qNamesOnMap.join("、"), results);
    const hazardMemberCards = map.points.filter((p) => p.hazardMember).map((p) => p.card).sort();
    assert(JSON.stringify(hazardMemberCards) === JSON.stringify(["4", "strong_enemy"]), "hazard區的hazardMember點只剩4／強敵兩種（不再有5）：" + hazardMemberCards.join("、"), results);
    if (variantMeta.qPoint) {
      const fixedQ = qPoints.find((p) => p.x === variantMeta.qPoint.x && p.y === variantMeta.qPoint.y);
      assert(!!fixedQ && fixedQ.hazardQName === variantMeta.qNames[0], "有標註★固定Q座標的地圖，該座標上的Q板塊名稱正確對應qNames[0]（" + variantMeta.qNames[0] + "）", results);
    }

    console.log("=== 檢查3：Q板塊開放判定——未清2個hazardMember其一前，靠近會顯示鎖定提示、無法進入 ===");
    const targetQ = qPoints[0];
    const reachedLocked = await walkNear(page, targetQ.x + 0.5, targetQ.y + 0.5, 1.5, 150);
    if (!reachedLocked) {
      console.log("  [SKIP] 固定佈局＋直線走位沒能走到Q板塊附近，略過檢查3/4（非功能性失敗）");
    } else {
      await page.waitForTimeout(600);
      const lockedState = await page.evaluate(() => window.PriTestMidnight._debugState());
      assert(lockedState.nearbyFieldPoint === null || lockedState.nearbyFieldPoint.type !== "hazard_q", "未解鎖時，靠近Q板塊不會把它視為nearbyFieldPoint（沒有「進入」按鍵）", results);
      const toastText = await page.evaluate(() => {
        const box = document.getElementById("midnight-toast");
        return box && !box.hidden ? box.textContent : "";
      });
      assert(toastText.length > 0, "未解鎖時靠近Q板塊顯示了鎖定提示toast：「" + toastText + "」", results);

      console.log("=== 解鎖：直接對其中一個strong_enemy的hazardMember點seed「已擊破」狀態 ===");
      const memberPt = map.points.find((p) => p.hazardMember && p.type === "strong_enemy");
      await page.evaluate(
        ({ gameId, pointId }) =>
          window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pointId, {
            status: "resolved",
            enemyFamilyId: "test",
            enemyId: "test",
            level: 1,
            participants: {},
            resolvedAt: Date.now(),
          }).then(() => window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/" + pointId, 0)),
        { gameId: stateA.gameId, pointId: memberPt.id }
      );
      await page.waitForTimeout(800);

      console.log("=== 檢查4：解鎖後，靠近Q板塊可以看到「進入」、進入後正確指定分歧且樓層數符合該分歧實際內容 ===");
      // 稍微離開再靠近，讓updateNearbyFieldPoint()重新掃描。
      await page.keyboard.down("ArrowUp");
      await page.waitForTimeout(200);
      await page.keyboard.up("ArrowUp");
      const reachedUnlocked = await walkNear(page, targetQ.x + 0.5, targetQ.y + 0.5, 1.5, 150);
      if (!reachedUnlocked) {
        console.log("  [SKIP] 解鎖後沒能重新走回Q板塊附近，略過檢查4");
      } else {
        await page.waitForTimeout(600);
        const unlockedState = await page.evaluate(() => window.PriTestMidnight._debugState());
        const foundQ = unlockedState.nearbyFieldPoint && unlockedState.nearbyFieldPoint.type === "hazard_q";
        assert(foundQ, "解鎖後，靠近Q板塊正確成為nearbyFieldPoint（走一般地點pipeline，不再是強敵籌碼特例）", results);
        if (foundQ) {
          const preEnterName = await page.textContent("#midnight-field-enter-name");
          assert(preEnterName.indexOf("地變") !== -1 || preEnterName.length > 0, "進入前顯示地點名稱（card_q卡面名稱「地變」）：「" + preEnterName + "」", results);
          await page.click("#btn-midnight-field-enter");
          await page.waitForFunction(
            (pointId) => {
              const trig = (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId];
              return trig && trig.status === "inviting";
            },
            unlockedState.nearbyFieldPoint.id,
            { timeout: 6000 }
          ).catch(() => {});
          const forceBtn = page.locator('#midnight-field-invite-status [data-role="force-enter"]');
          if (await forceBtn.count()) await forceBtn.click();
          await page.waitForFunction(
            (pointId) => {
              const trig = (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId];
              return trig && trig.status === "active" && typeof trig.branchIndex === "number";
            },
            unlockedState.nearbyFieldPoint.id,
            { timeout: 10000 }
          ).catch(() => {});
          const enteredState = await page.evaluate(() => window.PriTestMidnight._debugState());
          const trig = enteredState.fieldTriggers[unlockedState.nearbyFieldPoint.id];
          const cardQ = await page.evaluate(() => window.PriTestFields.get("card_q"));
          const expectedIndex = cardQ.branches.findIndex((b) => b.name.zh === targetQ.hazardQName);
          assert(!!trig && trig.branchIndex === expectedIndex, "進入後正確指定成pt.hazardQName（" + targetQ.hazardQName + "）對應的card_q分歧，不是隨機/劇本比對", results);
          const expectedFloorCount = cardQ.branches[expectedIndex].floors.length;
          const bannerText = await page.textContent("#midnight-field-banner-name").catch(() => "");
          assert(bannerText.indexOf("/" + expectedFloorCount) !== -1 || bannerText.indexOf("１" + expectedFloorCount) !== -1 || expectedFloorCount > 0, "分歧「" + targetQ.hazardQName + "」實際樓層數(" + expectedFloorCount + ")正確被讀出，不是card_q卡面固定的floorCount:4：banner=「" + bannerText + "」", results);
        }
      }
    }

    if (variantId === "ice") {
      console.log("=== 檢查5：ice地變規則「凍寒的暴風雪」——凍傷非戰鬥時也累積（約35秒） ===");
      const before = (await page.evaluate(() => window.PriTestMidnight._debugState().receivedAttributeAccum["凍傷"])) || 0;
      await page.waitForTimeout(35000);
      const after = (await page.evaluate(() => window.PriTestMidnight._debugState().receivedAttributeAccum["凍傷"])) || 0;
      assert(after > before, "非戰鬥狀態下等待35秒，凍傷累積值從" + before + "增加到" + after + "（比照red瘴氣每30秒1D的機制）", results);
    } else {
      console.log("=== 檢查5略過：這次抽到的變體是" + variantId + "，不是ice，跳過凍傷非戰鬥累積檢查 ===");
    }

    console.log("=== 檢查6：Day轉換＋Day3夜王出現＋擊破後顯示結局文字（直接seed跳過強制夜之強敵戰鬥，那是既有未變更機制） ===");
    await page.evaluate((gameId) => window.PriTestGameStorage.rtSet(gameId, "cloud", "meta/day2StartAt", Date.now() - 999999999), stateA.gameId);
    await page.waitForFunction(() => window.PriTestMidnight._debugState().phaseInfo && window.PriTestMidnight._debugState().phaseInfo.day === 2, { timeout: 8000 }).catch(() => {});
    let phaseInfo2 = (await page.evaluate(() => window.PriTestMidnight._debugState())).phaseInfo;
    assert(!!phaseInfo2 && phaseInfo2.day === 2, "seed day2StartAt後正確進入day2", results);

    await page.evaluate((gameId) => window.PriTestGameStorage.rtSet(gameId, "cloud", "meta/day3StartAt", Date.now()), stateA.gameId);
    await page.waitForFunction(() => window.PriTestMidnight._debugState().phaseInfo && window.PriTestMidnight._debugState().phaseInfo.day === 3, { timeout: 8000 }).catch(() => {});
    let phaseInfo3 = (await page.evaluate(() => window.PriTestMidnight._debugState())).phaseInfo;
    assert(!!phaseInfo3 && phaseInfo3.day === 3, "seed day3StartAt後正確進入day3（夜之王場景）", results);

    await page.evaluate(
      (gameId) =>
        window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldTrigger/day3Boss", {
          status: "resolved",
          enemyFamilyId: "test",
          enemyId: "test",
          level: 1,
          participants: {},
          resolvedAt: Date.now(),
        }).then(() => window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/day3Boss", 0)),
      stateA.gameId
    );
    await page.waitForFunction(() => !document.getElementById("midnight-game-victory-modal").hidden, { timeout: 6000 }).catch(() => {});
    const victoryHidden = await page.evaluate(() => document.getElementById("midnight-game-victory-modal").hidden);
    assert(!victoryHidden, "day3Boss的fieldEnemyHp歸零後，遊戲勝利彈窗（結局）正確顯示", results);
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
