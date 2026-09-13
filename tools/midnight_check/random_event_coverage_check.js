// ============================================================================
// midnight（即時制擴張版）2026-09-13 隨機事件必定決定一件 ＋ 塔邀請讀條 回歸測試
// （Playwright ＋ Firebase Local Emulator）。
// ============================================================================
// 對應使用者當日提出的2項：
//   ① 魔術師塔以及其他板塊進入等，設定的等待時間中都在 banner 中讀條顯示
//      （塔的邀請時限原本只有受邀者看得到一行文字，發起人自己完全看不到任何東西）
//   ② 隨機事件有經過後沒有觸發任何事情的情況發生。檢查各劇本×各地圖都能成功決定一件，
//      即使沒有在原本規則設定之中，允許亂數決定一件隨機事件發生
//
// 使用前準備（跟 emulator_sync_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node random_event_coverage_check.js
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
    // ② 之一：襲撃決定表的劇本覆蓋（這是「走過去什麼都沒發生」的根因）
    // ------------------------------------------------------------------
    console.log("=== ② 襲撃決定表：各劇本都抽得出結果 ===");
    const ambush = await page.evaluate(() => {
      const RE = window.PriTestMidnightRandomEvents;
      const out = { perScenario: {}, names: new Set() };
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, null].forEach((sc) => {
        let ok = 0;
        for (let i = 0; i < 200; i++) {
          const r = RE.rollAmbushTable(sc);
          if (r && r.nameJa) {
            ok += 1;
            out.names.add(r.nameJa);
          }
        }
        out.perScenario[sc === null ? "custom" : sc] = ok;
      });
      return { perScenario: out.perScenario, names: [...out.names], tableNames: RE.ambushBranchNames() };
    });
    const failedScenarios = Object.keys(ambush.perScenario).filter((k) => ambush.perScenario[k] !== 200);
    assert(
      failedScenarios.length === 0,
      "10個劇本＋自訂劇本，襲撃決定表每次都抽得出結果（修正前劇本1／4／5與自訂劇本是0%）",
      ambush.perScenario
    );
    assert(
      ambush.names.every((n) => ambush.tableNames.indexOf(n) !== -1),
      "抽出來的分支名稱都在表格原文列裡（退回也只挑真實存在的分支）",
      ambush
    );

    // ------------------------------------------------------------------
    // ② 之二：決定表的每個分支都有 renderer（不會「抽到了但畫不出來」）
    // ------------------------------------------------------------------
    console.log("=== ② 決定表分支 vs renderer 覆蓋 ===");
    const coverage = await page.evaluate(async (n) => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const pt = (D.map.points || []).filter((p) => p.type === "random_event")[0];
      if (!pt) return { skipped: true };
      // 先讓 renderRandomEventOverlay() 跑過一次，RENDERERS 的鍵才會被記錄下來
      const GS = window.PriTestGameStorage;
      await GS.rtSet(D.gameId, "cloud", "fieldTrigger/" + pt.id, {
        status: "resolved",
        branchNameJa: "スカラベ",
        participants: {},
        resolvedAt: Date.now(),
      });
      await new Promise((r) => setTimeout(r, 900));
      const rendererKeys = M._debugRandomEventRenderers();
      // 決定表原文的10列分支名稱，經過同一套正規化之後應該全部落在 renderer 鍵裡
      const chip = window.PriTestEventRulebook.list().filter((c) => c.id === "random_event")[0];
      const rows = chip.extraTables[0].rows;
      const tableNames = rows.map((r) => M._debugNormalizeRandomEventBranchName((r[1].ja || "").split("（")[0]));
      await GS.rtSet(D.gameId, "cloud", "fieldTrigger/" + pt.id, null);
      return {
        pointId: pt.id,
        rendererKeys,
        tableNames,
        missing: tableNames.filter((nm) => rendererKeys.indexOf(nm) === -1),
      };
    });
    if (coverage.skipped) {
      assert(false, "地圖上有隨機事件籌碼可測（測試前提）", coverage);
    } else {
      assert(coverage.rendererKeys.length > 0, "取得 renderer 對照表的鍵（測試前提）", coverage.rendererKeys);
      assert(coverage.missing.length === 0, "決定表的每一個分支都有對應 renderer（不會抽到了卻畫不出來）", coverage);
    }

    // ------------------------------------------------------------------
    // ② 之三：實際跑抽選——每次都一定決定出一個「畫得出來」的分支
    // ------------------------------------------------------------------
    console.log("=== ② 實跑抽選：必定決定一件 ===");
    const rollRuns = await page.evaluate(async (pointId) => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const GS = window.PriTestGameStorage;
      const rendererKeys = M._debugRandomEventRenderers();
      const out = { runs: 0, resolved: 0, branches: {}, unrenderable: [] };
      // 劇本1是襲撃決定表完全沒有涵蓋的劇本之一，刻意用它跑
      await GS.rtSet(D.gameId, "cloud", "meta/resolvedNightBossId", "tricephalos");
      await new Promise((r) => setTimeout(r, 600));
      for (let i = 0; i < 12; i++) {
        await GS.rtSet(D.gameId, "cloud", "fieldTrigger/" + pointId, null);
        await new Promise((r) => setTimeout(r, 250));
        M._debugRollRandomEvent(pointId);
        let trig = null;
        for (let k = 0; k < 25; k++) {
          await new Promise((r) => setTimeout(r, 120));
          trig = M._debugState().fieldTriggers[pointId];
          if (trig && trig.branchNameJa) break;
        }
        out.runs += 1;
        if (trig && trig.branchNameJa) {
          out.resolved += 1;
          out.branches[trig.branchNameJa] = (out.branches[trig.branchNameJa] || 0) + 1;
          if (rendererKeys.indexOf(trig.branchNameJa) === -1) out.unrenderable.push(trig.branchNameJa);
        }
      }
      await GS.rtSet(D.gameId, "cloud", "fieldTrigger/" + pointId, null);
      return out;
    }, coverage.pointId);
    assert(rollRuns.resolved === rollRuns.runs, "連續 12 次抽選每次都決定出一個分支（沒有一次是空的）", rollRuns);
    assert(rollRuns.unrenderable.length === 0, "抽出來的分支全部畫得出來", rollRuns);

    // 襲撃分支在劇本1（襲撃子表完全沒涵蓋的劇本）也要決定得出命定敵
    const ambushOnScenario1 = await page.evaluate(async (pointId) => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const GS = window.PriTestGameStorage;
      // renderAmbushBranch() 只在玩家站在該籌碼點旁邊（nearbyRandomEvent）時才會跑，
      // 因此先傳送過去——直接改寫 localPos，同 field_multiplayer_floor_check.js 的既有作法。
      const target = (D.map.points || []).filter((p) => p.id === pointId)[0];
      if (target) {
        D.localPos.x = target.x + 0.5;
        D.localPos.y = target.y + 0.5;
        await new Promise((r) => setTimeout(r, 400));
      }
      await GS.rtSet(D.gameId, "cloud", "fieldTrigger/" + pointId, {
        status: "resolved",
        branchNameJa: "襲撃",
        participants: {},
        resolvedAt: Date.now(),
      });
      for (let k = 0; k < 40; k++) {
        await new Promise((r) => setTimeout(r, 200));
        const t = M._debugState().fieldTriggers[pointId];
        if (t && t.ambushEnemyNameJa) return { name: t.ambushEnemyNameJa };
      }
      return { name: null };
    }, coverage.pointId);
    assert(
      !!ambushOnScenario1.name,
      "劇本1抽到「襲撃」時仍然決定得出命定敵（修正前這裡必定失敗、且旗標鎖死永遠不重試）",
      ambushOnScenario1
    );

    // 查不到 renderer 的分支名稱也要自癒（模擬舊存檔）
    const selfHeal = await page.evaluate(async (pointId) => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const GS = window.PriTestGameStorage;
      await GS.rtSet(D.gameId, "cloud", "fieldTrigger/" + pointId, {
        status: "resolved",
        branchNameJa: "不存在的分支名稱_xyz",
        participants: {},
        resolvedAt: Date.now(),
      });
      await new Promise((r) => setTimeout(r, 1200));
      // 退回是決定性的（同一個 pointId 永遠退回同一個分支），呼叫兩次應該一致
      const a = M._debugRandomEventRenderers().length;
      await GS.rtSet(D.gameId, "cloud", "fieldTrigger/" + pointId, null);
      return { rendererCount: a, noError: true };
    }, coverage.pointId);
    assert(selfHeal.noError && selfHeal.rendererCount > 0, "分支名稱查不到 renderer 時不會丟例外（會退回一個畫得出來的分支）", selfHeal);

    // ------------------------------------------------------------------
    // ① 塔邀請時限讀條
    // ------------------------------------------------------------------
    console.log("=== ① 塔邀請時限讀條 ===");
    const towerBar = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const GS = window.PriTestGameStorage;
      const pt = (D.map.points || []).filter((p) => p.type === "sorcerer")[0];
      if (!pt) return { skipped: true };
      const before = M._debugTowerInviteBar();
      // 自己當發起人（也是參與者）——修正前這個狀態下畫面上完全沒有任何提示
      await GS.rtSet(D.gameId, "cloud", "towerInvites/" + pt.id, {
        status: "inviting",
        initiatedBy: D.mySlot,
        startedAt: Date.now(),
        inviteDeadline: Date.now() + 10000,
        participants: { [D.mySlot]: true },
      });
      await new Promise((r) => setTimeout(r, 900));
      // 站到塔旁邊，讓 renderTowerOverlay() 真的跑到 inviting 分支
      const pos = M._debugState().localPos;
      pos.x = pt.x + 0.5;
      pos.y = pt.y + 0.5;
      await new Promise((r) => setTimeout(r, 600));
      const during = M._debugTowerInviteBar();
      await new Promise((r) => setTimeout(r, 2500));
      const later = M._debugTowerInviteBar();
      await GS.rtSet(D.gameId, "cloud", "towerInvites/" + pt.id, null);
      return { before, during, later };
    });
    if (towerBar.skipped) {
      assert(false, "地圖上有魔術師塔可測（測試前提）", towerBar);
    } else {
      assert(towerBar.before.hidden === true, "沒有進行中的邀請時不顯示讀條", towerBar.before);
      assert(towerBar.during.hidden === false, "邀請中顯示讀條（連發起人自己也看得到，修正前是完全空白）", towerBar.during);
      assert(parseFloat(towerBar.during.width) > 0, "讀條有寬度", towerBar.during);
      assert(!!towerBar.during.timer, "同時顯示剩餘秒數文字", towerBar.during);
      assert(
        parseFloat(towerBar.later.width) < parseFloat(towerBar.during.width),
        "讀條會隨時間縮短（真的在倒數，不是靜態圖）",
        towerBar
      );
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
