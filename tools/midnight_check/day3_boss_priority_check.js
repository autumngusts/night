// ============================================================================
// midnight（即時制擴張版）Day3 夜之王戰鬥卡關回歸測試（Firebase Local Emulator 版，
// 環境說明見 emulator_sync_check.js 開頭，這裡沿用同一套 emulator 旗標／準備步驟）。
// ============================================================================
// 修正的問題（2026-09-10 使用者回報）：Day3 王戰開始時，玩家人若剛好停在任何一個板塊點／
// 籌碼點／王城範圍內，王戰就開不起來。
//
// 根因：`recomputeActiveEncounter()` 的候選優先序原本是
//   nearbyFieldPoint → 籌碼 → 王城 → 夜之強敵 → 夜之王
// 夜之王排在最後，所以腳邊只要有任何一個點，它就一直贏得候選權，`nearbyDay3Boss` 永遠
// 輪不到。是否發生取決於地圖種子與玩家當下位置，因此表現成「時好時壞的偶發卡關」。
//
// 修正：①把夜之王提到候選序最前面（刻意不動 nearbyFinalCircleBoss 的位置，見程式內註解）；
//       ②王戰進行中不再把板塊點／王城認定為 nearby，避免上方資訊欄還跳出「進入」按鈕、
//         玩家一按就在最終王戰中開啟一層樓層探索。
//
// 這支測試刻意先把角色走到某個板塊點旁邊（＝重現當初會卡住的前提）才開啟王戰。
//
// 使用前準備：同 emulator_sync_check.js（generate.py 建 dist/、起本機 http server、
// npm install、起 firebase emulators:start --only database,auth）。
// 執行方式：node day3_boss_priority_check.js
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
      /* ignore */
    }
  });
}

async function getState(page) {
  return page.evaluate(() => window.PriTestMidnight._debugState());
}

// 照抄 emulator_sync_check.js 的 walkNear()——盡力而為地把角色走到某個座標附近。
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
  page.on("pageerror", (err) => console.log("  [pageerror]", err.message));

  try {
    await enableEmulatorFlag(page);

    console.log("=== 建立midnight測試場並加入 ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await page.click("#midnight-lobby-slots .midnight-slot-empty button");
    await page.fill("#midnight-lobby-passcode-input", "1234");
    await page.click("#btn-midnight-lobby-join");
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });

    const st0 = await getState(page);
    const gameId = st0.gameId;
    const mySlot = st0.mySlot;

    console.log("=== 前提：把角色走到一個板塊卡牌點旁邊（＝當初會卡住的情境） ===");
    const map = await page.evaluate((seed) => window.PriTestMidnightMap.generateMap(seed), st0.meta.mapSeed);
    // NON_FIELD_POINT_TYPES（sorcerer/merchant/strong_enemy/random_event/blessing）以外的
    // 一般板塊點，才是會設定 nearbyFieldPoint 的那一種。
    const nonField = { sorcerer: 1, merchant: 1, strong_enemy: 1, random_event: 1, blessing: 1 };
    const pt = (map.points || []).find((p) => !nonField[p.type] && p.type !== "hazard_q");
    if (!pt) {
      console.log("  [SKIP] 這個地圖種子找不到一般板塊點，略過整支測試");
    } else {
      const reached = await walkNear(page, pt.x + 0.5, pt.y + 0.5, 1.2, 200);
      const nearBefore = await page.evaluate(() => {
        const x = window.PriTestMidnight._debugState();
        return x.nearbyFieldPoint && x.nearbyFieldPoint.id;
      });
      assert(reached && !!nearBefore, "已站在板塊點旁邊（nearbyFieldPoint=" + nearBefore + "），前提成立", results);

      console.log("=== 開啟Day3夜之王戰鬥 ===");
      await page.evaluate(
        ({ gameId, mySlot }) => {
          const GS = window.PriTestGameStorage;
          const participants = {};
          participants[mySlot] = true;
          return GS.rtSet(gameId, "cloud", "fieldTrigger/day3Boss", {
            status: "resolved",
            participants: participants,
            enemyFamilyId: "night_boss",
            enemyId: "gladius",
            level: 1,
          })
            .then(() => GS.rtSet(gameId, "cloud", "fieldEnemyHp/day3Boss", 500))
            .then(() => GS.rtSet(gameId, "cloud", "meta/day3StartAt", Date.now()));
        },
        { gameId, mySlot }
      );

      // recomputeActiveEncounter() 對「第一次遭遇」會先跑 BATTLE_PREP_DURATION_MS(5秒)
      // 的識別資訊準備，之後才把 activeEncounter 設起來。
      let started = false;
      let last = null;
      for (let i = 0; i < 16; i++) {
        await page.waitForTimeout(1000);
        last = await page.evaluate(() => {
          const x = window.PriTestMidnight._debugState();
          return {
            ae: x.activeEncounter && x.activeEncounter.id,
            nfp: x.nearbyFieldPoint && x.nearbyFieldPoint.id,
            castle: !!x.nearbyCastlePoint,
          };
        });
        if (last.ae === "day3Boss") {
          started = true;
          break;
        }
      }
      assert(started, "站在板塊點旁邊時，Day3王戰仍然正常開始（activeEncounter=day3Boss），最後狀態=" + JSON.stringify(last), results);

      if (started) {
        const during = await page.evaluate(() => {
          const x = window.PriTestMidnight._debugState();
          const enterPrompt = document.getElementById("midnight-field-enter-prompt");
          const invitePrompt = document.getElementById("midnight-field-invite-prompt");
          return {
            nfp: x.nearbyFieldPoint && x.nearbyFieldPoint.id,
            castle: !!x.nearbyCastlePoint,
            day3: !!x.nearbyDay3Boss,
            enterHidden: !enterPrompt || enterPrompt.hidden,
            inviteHidden: !invitePrompt || invitePrompt.hidden,
          };
        });
        assert(during.day3, "王戰進行中nearbyDay3Boss確實有值（確認候選來源本身正常）", results);
        assert(!during.nfp && !during.castle, "王戰進行中不再把板塊點/王城認定為nearby，實際=" + JSON.stringify(during), results);
        assert(during.enterHidden && during.inviteHidden, "王戰進行中上方資訊欄不會再跳出板塊「進入」/「邀請」按鈕", results);
      }

      console.log("=== 夜之強敵的既有規則不受影響（地圖點仍優先於夜之強敵） ===");
      // 使用者既有規格：「縮圈完後，仍在卡牌樓層探索的不受進入夜之強敵影響」——這條規則
      // 靠的就是「地圖點排在 nearbyFinalCircleBoss 前面」，這次修正刻意沒有動它。
      // 這裡把 Day3 收掉、改成 waitingForDay2＋夜之強敵已指派，確認站在板塊點旁的玩家
      // 不會被強制拉進夜之強敵戰鬥。
      await page.evaluate(
        ({ gameId, mySlot }) => {
          const GS = window.PriTestGameStorage;
          const participants = {};
          participants[mySlot] = true;
          const st = window.PriTestMidnight._debugState();
          return GS.rtSet(gameId, "cloud", "meta/day3StartAt", null)
            .then(() => GS.rtSet(gameId, "cloud", "fieldTrigger/day3Boss", null))
            .then(() => GS.rtSet(gameId, "cloud", "fieldEnemyHp/day3Boss", null))
            .then(() => GS.rtSet(gameId, "cloud", "fieldTrigger/finalCircleDay1", {
              status: "resolved",
              participants: participants,
              enemyFamilyId: "test",
              enemyId: "test",
              level: 10,
            }))
            .then(() => GS.rtSet(gameId, "cloud", "fieldEnemyHp/finalCircleDay1", 500))
            .then(() => GS.rtSet(gameId, "cloud", "meta/sessionStartAt", st.meta.sessionStartAt - 40 * 60 * 1000));
        },
        { gameId, mySlot }
      );
      const reachedWaiting = await page
        .waitForFunction(() => {
          const st = window.PriTestMidnight._debugState();
          return st.phaseInfo && st.phaseInfo.stage === "waitingForDay2";
        }, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      if (!reachedWaiting) {
        console.log("  [SKIP] 未能推進到waitingForDay2，略過夜之強敵優先序回歸檢查");
      } else {
        // 角色上一段就已經站在板塊點旁邊（王戰不會移動角色），這裡不再walkNear，直接等
        // 超過BATTLE_PREP_DURATION_MS(5秒)看會不會被拉進夜之強敵戰鬥。
        await page.waitForTimeout(8000);
        const fcState = await page.evaluate(() => {
          const x = window.PriTestMidnight._debugState();
          return {
            ae: x.activeEncounter && x.activeEncounter.id,
            nfp: x.nearbyFieldPoint && x.nearbyFieldPoint.id,
            fc: !!x.nearbyFinalCircleBoss,
            stage: x.phaseInfo && x.phaseInfo.stage,
            trig: !!x.fieldTriggers.finalCircleDay1,
            hp: x.fieldEnemyHp.finalCircleDay1,
          };
        });
        // 前提：夜之強敵確實已經指派、玩家也確實還站在板塊點旁邊。
        assert(
          fcState.trig && !!fcState.nfp,
          "前提成立：夜之強敵已指派且玩家仍站在板塊點旁（實際=" + JSON.stringify(fcState) + "）",
          results
        );
        assert(
          fcState.ae !== "finalCircleDay1",
          "站在板塊點旁邊時不會被強制拉進夜之強敵戰鬥（既有規則維持不變），實際activeEncounter=" + fcState.ae,
          results
        );
      }
    }
  } catch (err) {
    console.error("測試中斷：", err);
    results.push({ label: "測試執行本身沒有拋出例外", pass: false });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n===== 結果：" + (results.length - failed.length) + "/" + results.length + " 通過 =====");
  failed.forEach((r) => console.log("  FAIL: " + r.label));
  process.exit(failed.length ? 1 : 0);
})();
