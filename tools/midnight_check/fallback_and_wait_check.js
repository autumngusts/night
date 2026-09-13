// ============================================================================
// midnight（即時制擴張版）2026-09-13 第7批 回歸測試
// （Playwright ＋ Firebase Local Emulator）。
// ============================================================================
// 對應使用者當日提出的3項：
//   ① debug主控台的「立即縮圈」要真的產生下一階段的縮圈行為（原本一次跳到整天最末端，
//      shrink1/hold/shrink2三段全被跳過，看不到任何縮圈動作）
//   ② 進入樓層的等待時間要在資訊欄 banner 呈現讀條（J堡壘的等待是5秒，但讀條寫死用
//      1秒，中間4秒畫面空白；中途加入／後補領獎的2秒等待原本只有一行文字）
//   ③ 劇本與地圖對不上時，樓層／王戰的抽選要亂數退回，不能整體放棄導致卡死
//
// 使用前準備（跟 emulator_sync_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node fallback_and_wait_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const META_WAIT_MS = 20000;

const results = [];
function assert(cond, label, detail) {
  results.push({ label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label + (cond || detail === undefined ? "" : "　→ " + JSON.stringify(detail)));
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

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  const pageErrors = [];
  page.on("pageerror", (e) => {
    pageErrors.push(e.message);
    console.log("  [pageerror] " + e.message);
  });

  try {
    await enableEmulatorFlag(page);
    console.log("=== 建立 midnight 測試場（連本機 emulator） ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await page.click("#midnight-lobby-slots .midnight-slot-empty button");
    await page.fill("#midnight-lobby-passcode-input", "1234");
    await page.click("#btn-midnight-lobby-join");
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().characters[window.PriTestMidnight._debugState().myTokenId], {
      timeout: META_WAIT_MS,
    });

    // ------------------------------------------------------------------
    // ① 立即縮圈：每按一次推進「一個階段」，而不是直接跳到整天末端
    // ------------------------------------------------------------------
    console.log("=== ① 立即縮圈逐段推進 ===");
    await page.evaluate(async () => {
      const D = window.PriTestMidnight._debugState();
      await window.PriTestGameStorage.rtSet(D.gameId, "cloud", "meta/testMode", true);
    });
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.testMode === true, { timeout: META_WAIT_MS });

    const stages = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const stageNow = () => M._debugState().phaseInfo.stage;
      const radiusNow = () => M._debugState().phaseInfo.radius;
      const out = [{ stage: stageNow(), radius: radiusNow() }];
      for (let i = 0; i < 4; i++) {
        M._debugForceShrink();
        await new Promise((r) => setTimeout(r, 700));
        out.push({ stage: stageNow(), radius: radiusNow() });
      }
      return out;
    });
    assert(stages[0].stage === "grace", "開局是 grace 階段（測試前提）", stages);
    assert(stages[1].stage === "shrink1", "按第1次：進入 shrink1（真的開始縮圈，不是直接跳到最後）", stages);
    assert(stages[2].stage === "hold", "按第2次：進入 hold", stages);
    assert(stages[3].stage === "shrink2", "按第3次：進入 shrink2", stages);
    assert(stages[4].stage === "waitingForDay2", "按第4次：縮圈跑完，進入等待第二天", stages);
    assert(
      stages[1].radius > stages[2].radius && stages[2].radius > stages[4].radius,
      "半徑逐段真的變小（每一段都看得到縮圈結果）",
      stages.map((s) => s.radius)
    );

    // ------------------------------------------------------------------
    // ② 等待讀條
    // ------------------------------------------------------------------
    console.log("=== ② 等待讀條 ===");
    const waits = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      return {
        castle: M._debugFieldEnterWaitMs("J"),
        normal: M._debugFieldEnterWaitMs("2"),
        bars: ["midnight-field-loading-bar", "midnight-field-invite-bar", "midnight-field-late-join-bar", "midnight-field-late-claim-bar"].map(
          (id) => ({ id, exists: !!document.getElementById(id) })
        ),
      };
    });
    assert(waits.castle === 5000, "J（堡壘）的進入等待是5秒", waits);
    assert(waits.normal === 1000, "一般板塊的進入等待是1秒", waits);
    assert(
      waits.bars.every((b) => b.exists),
      "進入／邀請／中途加入／後補領獎四處都有讀條元素",
      waits.bars
    );

    // 讀條長度跟實際等待同一個來源：把「已經過一半」的狀態做出來，寬度應該落在50%附近。
    const barProgress = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const out = {};
      out.joinHalf = M._debugSetLateWaitProbe("join", 1000); // 2秒等待剩1秒＝50%
      out.joinNearDone = M._debugSetLateWaitProbe("join", 60);
      out.joinCleared = M._debugSetLateWaitProbe("join", null);
      out.claimHalf = M._debugSetLateWaitProbe("claim", 1000);
      out.claimCleared = M._debugSetLateWaitProbe("claim", null);
      return out;
    });
    const pct = (v) => parseFloat(v);
    assert(Math.abs(pct(barProgress.joinHalf) - 50) < 8, "中途加入讀條：剩一半時寬度約50%", barProgress);
    assert(pct(barProgress.joinNearDone) > 90, "中途加入讀條：快結束時接近滿格", barProgress);
    assert(pct(barProgress.joinCleared) === 0, "等待結束後讀條歸零", barProgress);
    assert(Math.abs(pct(barProgress.claimHalf) - 50) < 8, "後補領獎讀條：剩一半時寬度約50%", barProgress);
    assert(pct(barProgress.claimCleared) === 0, "後補領獎讀條結束後歸零", barProgress);

    // ------------------------------------------------------------------
    // ③ 抽選亂數退回
    // ------------------------------------------------------------------
    console.log("=== ③ 抽選亂數退回 ===");
    const fallback = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const a = M._debugRandomEnemyFallback("probe_key_1");
      const aAgain = M._debugRandomEnemyFallback("probe_key_1");
      const b = M._debugRandomEnemyFallback("probe_key_2");
      const boss = M._debugRandomNightBossFallback("probe_boss");
      const bossAgain = M._debugRandomNightBossFallback("probe_boss");
      const Rulebook = window.PriTestBossRulebook;
      return {
        a: a && { familyId: a.familyId, enemyId: a.enemy.id },
        aAgain: aAgain && { familyId: aAgain.familyId, enemyId: aAgain.enemy.id },
        b: b && { familyId: b.familyId, enemyId: b.enemy.id },
        boss,
        bossAgain,
        bossHasData: boss ? !!Rulebook.get(boss) : false,
      };
    });
    assert(!!fallback.a, "敵人亂數退回抽得出一隻真實敵人", fallback.a);
    assert(JSON.stringify(fallback.a) === JSON.stringify(fallback.aAgain), "同一個 seed key 永遠得到同一隻（各裝置結果一致）", fallback);
    assert(JSON.stringify(fallback.a) !== JSON.stringify(fallback.b), "不同 seed key 得到不同結果（不是永遠同一隻）", fallback);
    assert(!!fallback.boss && fallback.boss === fallback.bossAgain, "夜王亂數退回同樣是決定性的", fallback);
    assert(fallback.bossHasData, "退回挑到的夜王一定有規則書資料（否則等於沒解決問題）", fallback);

    // Day3 夜王：把 resolvedNightBossId 換成不存在的劇本，仍然要生出王戰
    const day3 = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const GS = window.PriTestGameStorage;
      await GS.rtSet(D.gameId, "cloud", "fieldTrigger/day3Boss", null);
      await GS.rtSet(D.gameId, "cloud", "meta/resolvedNightBossId", "no_such_scenario_xyz");
      await GS.rtSet(D.gameId, "cloud", "meta/day3StartAt", Date.now());
      await new Promise((r) => setTimeout(r, 1200));
      M._debugRollDay3Boss();
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (M._debugState().fieldTriggers.day3Boss) break;
      }
      const trig = M._debugState().fieldTriggers.day3Boss || null;
      return trig && { enemyId: trig.enemyId, familyId: trig.enemyFamilyId, status: trig.status };
    });
    assert(!!day3, "劇本對不上時，Day3 王戰仍然抽得出夜王（原本是完全沒有敵人、遊戲打不完）", day3);
    if (day3) assert(day3.status === "resolved" && !!day3.enemyId, "抽出來的王戰 trigger 是完整可戰鬥的", day3);

    // 夜之強敵（Day1/Day2）：把劇本換掉之後仍然要抽得出敵人
    const finalCircle = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const GS = window.PriTestGameStorage;
      await GS.rtSet(D.gameId, "cloud", "meta/day3StartAt", null);
      await GS.rtSet(D.gameId, "cloud", "fieldTrigger/finalCircleDay1", null);
      await new Promise((r) => setTimeout(r, 800));
      M._debugRollFinalCircleBoss(1, "finalCircleDay1");
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (M._debugState().fieldTriggers.finalCircleDay1) break;
      }
      const trig = M._debugState().fieldTriggers.finalCircleDay1 || null;
      return trig && { enemyId: trig.enemyId, familyId: trig.enemyFamilyId, level: trig.level, status: trig.status };
    });
    assert(!!finalCircle, "劇本對不上時，夜之強敵仍然抽得出敵人（原本會永遠卡在等待第二天）", finalCircle);
    if (finalCircle) {
      assert(finalCircle.status === "resolved" && !!finalCircle.enemyId, "夜之強敵 trigger 完整可戰鬥", finalCircle);
      assert(finalCircle.level > 1, "等級有退回值（不是掉回預設的1）", finalCircle);
    }

    // 強敵籌碼：所有卡牌／籌碼都套用同一套退回（使用者要求「J以外皆檢查此行為」）
    const strongEnemy = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const GS = window.PriTestGameStorage;
      const pt = (D.map.points || []).filter((p) => p.type === "strong_enemy")[0];
      if (!pt) return { skipped: true };
      await GS.rtSet(D.gameId, "cloud", "fieldTrigger/" + pt.id, null);
      await new Promise((r) => setTimeout(r, 800));
      M._debugRollStrongEnemy(pt);
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (M._debugState().fieldTriggers[pt.id]) break;
      }
      const trig = M._debugState().fieldTriggers[pt.id] || null;
      return trig && { id: pt.id, enemyId: trig.enemyId, status: trig.status };
    });
    if (strongEnemy && strongEnemy.skipped) {
      assert(false, "地圖上有強敵籌碼可測（測試前提）", strongEnemy);
    } else {
      assert(!!strongEnemy && strongEnemy.status === "resolved" && !!strongEnemy.enemyId, "強敵籌碼一定抽得出敵人", strongEnemy);
    }

    assert(pageErrors.length === 0, "整段流程沒有任何 pageerror", pageErrors.slice(0, 3));

    const failed = results.filter((r) => !r.pass);
    console.log("\n==== 結果：" + (results.length - failed.length) + " / " + results.length + " 通過 ====");
    if (failed.length) {
      failed.forEach((f) => console.log("  FAIL: " + f.label));
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("測試中斷：", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
