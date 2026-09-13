// ============================================================================
// midnight（即時制擴張版）2026-09-13 魔術師塔同步＋獎勵分列＋詞條顯示 回歸測試
// （Playwright ＋ Firebase Local Emulator）。
// ============================================================================
// 對應使用者當日提出的4項：
//   ① 魔術師塔題目要裝置同步，一人解得大家都解出；解謎中也可以先關閉離開此地，
//      回來後題目仍舊保持一致直到解出
//   ② 魔術師塔獲得的多項武器等等，在獎勵清單都要各別分出一列再進行選擇
//      （原本「杖」直接塞進角色、不進清單：清單只看到1件、角色卻多了2件）
//   ③ 解謎時遊戲暫停中無法繼續猜測，直到遊戲正常運行
//   ④ 詞條模式下，獎勵清單抽出武器／杖／聖印就要顯示其詞條
//
// 使用前準備（跟 emulator_sync_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node tower_sync_check.js
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

async function joinAndStart(page, passcode) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", passcode);
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const page2 = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page2.setViewportSize({ width: 1280, height: 900 });
  const pageErrors = [];
  [page, page2].forEach((p) =>
    p.on("pageerror", (e) => {
      pageErrors.push(e.message);
      console.log("  [pageerror] " + e.message);
    })
  );

  try {
    await enableEmulatorFlag(page);
    await enableEmulatorFlag(page2);
    console.log("=== 建立 midnight 測試場（兩台裝置，連本機 emulator） ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    const gameUrl = await page.evaluate(() => location.href);
    await joinAndStart(page, "1111");

    await page2.goto(gameUrl, { waitUntil: "networkidle" });
    await page2.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await joinAndStart(page2, "2222");

    await page.click("#btn-midnight-lobby-ready");
    await page2.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });
    await page2.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });
    for (const p of [page, page2]) {
      await p.waitForFunction(() => !!window.PriTestMidnight._debugState().characters[window.PriTestMidnight._debugState().myTokenId], {
        timeout: META_WAIT_MS,
      });
    }

    // ------------------------------------------------------------------
    // ① 題目裝置同步
    // ------------------------------------------------------------------
    console.log("=== ① 題目裝置同步 ===");
    const towerId = await page.evaluate(() => {
      const pts = window.PriTestMidnight._debugState().map.points || [];
      const t = pts.filter((p) => p.type === "sorcerer")[0];
      return t ? t.id : null;
    });
    assert(!!towerId, "地圖上有魔術師塔可測（測試前提）", towerId);

    // 兩台都列為參與者，然後由其中一台產生題目
    await page.evaluate(async (id) => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      await window.PriTestGameStorage.rtSet(D.gameId, "cloud", "towerInvites/" + id, {
        status: "active",
        initiatedBy: 1,
        startedAt: Date.now(),
        inviteDeadline: Date.now(),
        participants: { 1: true, 2: true },
      });
    }, towerId);
    await page.waitForFunction((id) => !!window.PriTestMidnight._debugState().towerInvites[id], towerId, { timeout: META_WAIT_MS });
    await page2.waitForFunction((id) => !!window.PriTestMidnight._debugState().towerInvites[id], towerId, { timeout: META_WAIT_MS });

    await page.evaluate((id) => window.PriTestMidnight._debugEnsureTowerPuzzle(id), towerId);
    for (const p of [page, page2]) {
      await p.waitForFunction(
        (id) => !!(window.PriTestMidnight._debugState().towerInvites[id] || {}).puzzle,
        towerId,
        { timeout: META_WAIT_MS }
      );
    }
    const puzzles = await Promise.all(
      [page, page2].map((p) => p.evaluate((id) => window.PriTestMidnight._debugState().towerInvites[id].puzzle, towerId))
    );
    assert(JSON.stringify(puzzles[0]) === JSON.stringify(puzzles[1]), "兩台裝置拿到的是同一題（原本各自 generate()，題目完全不同）", puzzles);

    // 第二台也呼叫一次產生：first-writer-wins，題目不得被覆寫
    await page2.evaluate((id) => window.PriTestMidnight._debugEnsureTowerPuzzle(id), towerId);
    await page2.waitForTimeout(800);
    const afterSecondEnsure = await page.evaluate((id) => window.PriTestMidnight._debugState().towerInvites[id].puzzle, towerId);
    assert(JSON.stringify(afterSecondEnsure) === JSON.stringify(puzzles[0]), "第二台再送一次產生請求不會覆寫題目", afterSecondEnsure);

    // 開啟解謎視窗用的是 RTDB 那一題
    const opened = await page.evaluate((id) => window.PriTestMidnight._debugStartTowerPuzzle(id), towerId);
    assert(opened.opened, "解謎視窗開得起來", opened);
    assert(JSON.stringify(opened.puzzle) === JSON.stringify(puzzles[0]), "視窗顯示的就是同步下來的那一題", opened.puzzle);

    // 關閉再開：仍然同一題
    const reopened = await page.evaluate((id) => {
      const M = window.PriTestMidnight;
      M._debugCloseTowerPuzzle(id);
      const closed = document.getElementById("midnight-tower-puzzle-modal").hidden;
      const again = M._debugStartTowerPuzzle(id);
      return { closed, again };
    }, towerId);
    assert(reopened.closed, "按✕可以先關閉解謎視窗（原本沒有關閉鈕）", reopened);
    assert(
      JSON.stringify(reopened.again.puzzle) === JSON.stringify(puzzles[0]),
      "關閉後再回來仍舊是同一題（題目留在 RTDB，直到解出）",
      reopened.again.puzzle
    );

    // ------------------------------------------------------------------
    // ③ 暫停中無法作答
    // ------------------------------------------------------------------
    console.log("=== ③ 暫停中無法作答 ===");
    const beforePause = await page.evaluate(() => window.PriTestMidnight._debugTowerPuzzlePausedState());
    assert(beforePause.buttonCount > 0, "解謎視窗裡有作答按鈕（測試前提）", beforePause);
    assert(beforePause.noteHidden && !beforePause.blocked, "未暫停時作答不受限", beforePause);

    await page.evaluate(async () => {
      const D = window.PriTestMidnight._debugState();
      await window.PriTestGameStorage.rtSet(D.gameId, "cloud", "meta/pause", { pausedAt: Date.now(), totalPausedMs: 0 });
    });
    await page.waitForFunction(() => !!(window.PriTestMidnight._debugState().meta.pause || {}).pausedAt, { timeout: META_WAIT_MS });
    const duringPause = await page.evaluate(() => window.PriTestMidnight._debugTowerPuzzlePausedState());
    assert(duringPause.blocked, "暫停中作答被擋下", duringPause);
    assert(!duringPause.noteHidden, "暫停中顯示「無法作答」說明", duringPause);
    assert(duringPause.allDisabled, "暫停中作答按鈕全部停用", duringPause);

    await page.evaluate(async () => {
      const D = window.PriTestMidnight._debugState();
      await window.PriTestGameStorage.rtSet(D.gameId, "cloud", "meta/pause", null);
    });
    await page.waitForFunction(() => !(window.PriTestMidnight._debugState().meta.pause || {}).pausedAt, { timeout: META_WAIT_MS });
    const afterPause = await page.evaluate(() => window.PriTestMidnight._debugTowerPuzzlePausedState());
    assert(!afterPause.blocked && afterPause.noteHidden, "繼續遊戲後恢復可作答", afterPause);

    // ------------------------------------------------------------------
    // ① 之二：一人解出，大家都解出
    // ------------------------------------------------------------------
    console.log("=== ① 之二 一人解出大家都解出 ===");
    const openOnBoth = await Promise.all([page, page2].map((p) => p.evaluate((id) => window.PriTestMidnight._debugStartTowerPuzzle(id), towerId)));
    assert(
      openOnBoth.every((o) => o.opened),
      "兩台都開著解謎視窗（測試前提）",
      openOnBoth
    );
    await page.evaluate(async (id) => {
      const D = window.PriTestMidnight._debugState();
      await window.PriTestGameStorage.rtSet(D.gameId, "cloud", "towerSolved/" + id, true);
    }, towerId);
    await page2.waitForFunction((id) => !!window.PriTestMidnight._debugState().towerSolved[id], towerId, { timeout: META_WAIT_MS });
    await page2.waitForTimeout(600);
    const page2State = await page2.evaluate(() => ({
      puzzleHidden: document.getElementById("midnight-tower-puzzle-modal").hidden,
      diceShown: !document.getElementById("midnight-tower-dice-hand-modal").hidden,
    }));
    assert(page2State.puzzleHidden, "別人解開後，自己的解謎視窗自動關閉（原本會一直開著還能繼續作答）", page2State);
    assert(page2State.diceShown, "自己那一份12骰牌型獎勵也照樣拿得到", page2State);

    // ------------------------------------------------------------------
    // ② 塔獎勵在清單各別分出一列
    // ------------------------------------------------------------------
    console.log("=== ② 塔獎勵分列 ===");
    const towerRewards = await page.evaluate(async (id) => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const GS = window.PriTestGameStorage;
      await GS.rtSet(D.gameId, "cloud", "pendingRewards/" + D.myTokenId, null);
      await new Promise((r) => setTimeout(r, 600));
      const weaponsBefore = (M._debugState().characters[D.myTokenId].weaponIds || []).length;
      // straight 牌型：規格上有 staffStar×1 ＋ weaponStar×2 ＋ 消耗品×1
      const specs = M._debugTowerRewardSpecs("straight");
      M._debugTowerDiceConfirm(id, [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6]);
      await new Promise((r) => setTimeout(r, 1200));
      const S = M._debugState();
      const list = S.pendingRewards[D.myTokenId] || {};
      const rows = Object.keys(list).map((k) => ({
        kind: list[k].kind,
        categoryId: list[k].categoryId || null,
        label: M._debugRewardEntryLabel(list[k]),
      }));
      return { specs: specs.map((x) => x.kind), rows, weaponsBefore, weaponsAfter: (S.characters[D.myTokenId].weaponIds || []).length };
    }, towerId);
    const weaponRows = towerRewards.rows.filter((r) => r.kind === "weaponStar");
    assert(weaponRows.length === 3, "3件武器類獎勵各自成為獨立一列（杖×1＋武器×2）", towerRewards.rows);
    assert(
      weaponRows.filter((r) => r.categoryId === "staff").length === 1,
      "其中一列是指定大分類的「杖」（原本直接塞進角色、不進清單）",
      weaponRows
    );
    assert(
      weaponRows.some((r) => r.categoryId === "staff" && r.label !== weaponRows.filter((x) => !x.categoryId)[0].label),
      "指定大分類的那一列在清單上標得出是什麼（兩列武器不會長得一模一樣）",
      weaponRows.map((r) => r.label)
    );
    assert(
      towerRewards.weaponsAfter === towerRewards.weaponsBefore,
      "確認獎勵前角色的武器數不變（沒有任何武器被背景直接塞進去）",
      towerRewards
    );

    // ------------------------------------------------------------------
    // ④ 詞條模式下，獎勵清單抽出武器就顯示詞條
    // ------------------------------------------------------------------
    console.log("=== ④ 獎勵清單顯示詞條 ===");
    const affixInDraw = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const GS = window.PriTestGameStorage;
      // 先關著詞條模式：不該有詞條
      await GS.rtSet(D.gameId, "cloud", "meta/weaponAffixes", false);
      await new Promise((r) => setTimeout(r, 700));
      const off = M._debugComputeRewardDraw({ kind: "weaponStar", value: 2 });
      // 開啟詞條模式
      await GS.rtSet(D.gameId, "cloud", "meta/weaponAffixes", true);
      await new Promise((r) => setTimeout(r, 700));
      const on = M._debugComputeRewardDraw({ kind: "weaponStar", value: 2 });
      const staff = M._debugComputeRewardDraw({ kind: "weaponStar", value: 2, categoryId: "staff" });
      const shared = M._debugDrawSharedRewardData({ kind: "weaponStar", value: 2 });
      return { off, on, staff, shared };
    });
    assert(affixInDraw.off.affixes === null, "詞條模式關閉時，抽選結果不帶詞條", affixInDraw.off);
    assert(!!affixInDraw.on.affixes && affixInDraw.on.affixes.length > 0, "詞條模式開啟時，按下［抽選］當下就擲好詞條", affixInDraw.on);
    assert(!!affixInDraw.staff.affixes && affixInDraw.staff.affixes.length > 0, "杖（指定大分類）同樣會擲出詞條", affixInDraw.staff);
    assert(!!affixInDraw.shared.affixes && affixInDraw.shared.affixes.length > 0, "共享池揭示時也一併擲好詞條（所有人看到同一組）", affixInDraw.shared);

    // 詳細欄真的把那組詞條畫出來（武器還沒進背包也看得到）
    const affixRows = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const draft = M._debugComputeRewardDraw({ kind: "weaponStar", value: 2 });
      const count = M._debugRenderWeaponSheetDetailWithAffixes("midnight-reward-detail", draft.weaponId, draft.affixes);
      const withoutOverride = M._debugRenderWeaponSheetDetailWithAffixes("midnight-reward-detail", draft.weaponId, null);
      return { drawn: draft.affixes.length, count, withoutOverride };
    });
    assert(affixRows.count === affixRows.drawn, "武器詳細欄列出抽選當下擲好的每一條詞條", affixRows);
    assert(affixRows.withoutOverride === 0, "沒有傳入時不會誤顯示（尚未入手的武器角色身上沒有詞條紀錄）", affixRows);

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
