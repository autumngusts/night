// ============================================================================
// midnight（即時制擴張版・技術驗證片）多裝置同步回歸測試——Firebase Local Emulator版。
// ============================================================================
// 用途：跟multi_device_sync_check.js驗證同樣的3個技術風險點，但完全連本機Firebase
// emulator（Database＋Auth），不連真的Firebase專案、不需要對外網路、不會觸發App Check
// （reCAPTCHA v3）。這是為了解決一個實測到的環境限制：某些沙盒/自動化環境連不上Google
// 的reCAPTCHA驗證服務，導致真的Firebase專案那條路線（multi_device_sync_check.js）在
// 那些環境下會卡在App Check retry、甚至逾時失敗——這不代表功能本身壞掉，只是那個環境連
// 不上reCAPTCHA。改連本機emulator後，不管在什麼環境都能穩定、快速地驗證RTDB讀寫/
// transaction()語意本身有沒有正確運作。
//
// 這支腳本額外驗證了multi_device_sync_check.js沒有涵蓋的第4個風險點：2026-09-05新增的
// 敵人攻擊系統（見static/midnight.js的ENEMY_ATTACK_*常數與updateEnemyAttack()）——直接用
// GameStorage.rtSet()造一個「已解決分歧、敵人存活」的fieldTrigger（跳過邀請/打字機/投票
// 這些既有且沒有變更過的UI流程，那些不是這次要驗證的目標），確認玩家走近該點後
// activeEncounter會生效、敵人攻擊排程/發動/命中判定確實會透過RTDB跑起來。
//
// 使用前準備：
//   1. 於repo根目錄執行 `py -3 generate.py`（或`python generate.py`）產生dist/。
//   2. 啟動本機靜態伺服器：`py -3 -m http.server 8931 --directory dist`
//      （或設定環境變數PRITEST_BASE_URL指到你自己啟動的位址）。
//   3. 於本資料夾執行 `npm install`（僅需安裝一次，會一併裝firebase-tools）。
//   4. 啟動Firebase emulator（Database＋Auth，設定見repo根目錄的firebase.json）：
//        npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//      （--project可以是任何字串，emulator不會真的連上那個Firebase專案，純本機運作；
//      這裡沿用正式專案id純粹是方便跟firebase_config.js對照，沒有實際意義。）
//
// 執行方式：
//   node emulator_sync_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const META_WAIT_MS = 15000;

function assert(cond, label, results) {
  results.push({ label: label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label);
}

// 每個分頁在載入頁面前都要先設好這個sessionStorage旗標，static/game_storage.js的
// rtdbEmulatorEnabled()才會改連emulator、跳過App Check——見該檔案的說明註解。
async function enableEmulatorFlag(page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
    } catch (e) {
      /* 忽略：不支援sessionStorage的環境本來就不是這支腳本的目標環境 */
    }
  });
}

// 加入等待房並準備：midnight.js的lobby流程要求先點空席位開啟表單、填4碼密碼、送出加入，
// 全部已佔用席位都準備好後5秒倒數才會真正寫入meta.sessionStartAt（見maybeTriggerLobbyCountdown
// ／maybeTriggerSessionStart）。session開始後空席位就不能再加入了，所以兩個裝置都必須在
// 這裡先完成加入，才能各自按準備。
async function joinLobby(page, passcode) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", passcode);
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
}

async function readyUp(page) {
  await page.click("#btn-midnight-lobby-ready");
}

// 盡力而為地把角色走到某個座標附近：每一輪讀目前localPos，往目標方向按對應方向鍵一小段
// 時間。不做真正的路徑規劃（不繞牆），純demo測試工具，走不到就回傳false讓呼叫端自行決定
// 要不要略過那個檢查——這個地圖是固定佈局＋牆壁，不保證直線可達。
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
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  const results = [];

  try {
    await enableEmulatorFlag(pageA);
    await enableEmulatorFlag(pageB);

    console.log("=== 建立midnight測試場（裝置A，連本機emulator） ===");
    await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await pageA.click("#btn-midnight-create");
    await pageA.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    const gameUrl = pageA.url();
    console.log("game URL:", gameUrl);

    console.log("=== 裝置B加入同一個測試場 ===");
    await pageB.goto(gameUrl, { waitUntil: "networkidle" });
    await pageB.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });

    console.log("=== 等待房：兩裝置各自加入席位並準備，觸發5秒倒數開局 ===");
    await joinLobby(pageA, "1234");
    await joinLobby(pageB, "5678");
    await readyUp(pageA);
    await readyUp(pageB);
    await pageA.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });
    await pageB.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });

    const stateA = await pageA.evaluate(() => window.PriTestMidnight._debugState());
    const stateB = await pageB.evaluate(() => window.PriTestMidnight._debugState());
    assert(stateA.meta.mapSeed === stateB.meta.mapSeed, "兩裝置收到同一個mapSeed（連emulator）", results);
    assert(!!stateA.meta.sessionStartAt, "兩裝置都順利完成等待房流程、正式開局", results);

    console.log("=== 風險點1：固定地圖佈局＋seed衍生的點位，兩裝置本地算出結果一致 ===");
    const pointsA = await pageA.evaluate((seed) => JSON.stringify(window.PriTestMidnightMap.generateMap(seed).points), stateA.meta.mapSeed);
    const pointsB = await pageB.evaluate((seed) => JSON.stringify(window.PriTestMidnightMap.generateMap(seed).points), stateB.meta.mapSeed);
    assert(pointsA === pointsB, "兩裝置各自算出的地點位置逐一相同", results);

    console.log("=== 風險點2：即時移動同步（連emulator） ===");
    await pageA.focus("body");
    await pageA.keyboard.down("ArrowRight");
    await pageA.waitForTimeout(800);
    await pageA.keyboard.up("ArrowRight");
    await pageA.waitForTimeout(500);
    const aPos = (await pageA.evaluate(() => window.PriTestMidnight._debugState())).localPos;
    const bSeesA = await pageB.evaluate((tokenId) => (window.PriTestMidnight._debugState().remoteTokens || {})[tokenId] || null, stateA.myTokenId);
    const moved = !!bSeesA && Math.abs(bSeesA.x - aPos.x) < 0.5 && Math.abs(bSeesA.y - aPos.y) < 0.5;
    assert(moved, "裝置A移動後，裝置B在1.3秒內看到接近的座標更新（容許lerp誤差）", results);

    console.log("=== 風險點3：併發扣血用transaction()不丟資料（連emulator） ===");
    const beforeTarget = (await pageA.evaluate(() => window.PriTestMidnight._debugState().demoStats.sharedTarget)) || 20;
    await Promise.all([pageA.click("#btn-midnight-attack-shared-target"), pageB.click("#btn-midnight-attack-shared-target")]);
    await pageA.waitForTimeout(800);
    const afterA = (await pageA.evaluate(() => window.PriTestMidnight._debugState())).demoStats.sharedTarget;
    const afterB = (await pageB.evaluate(() => window.PriTestMidnight._debugState())).demoStats.sharedTarget;
    assert(afterA === afterB, "兩裝置最終看到的共用標靶數值一致", results);
    assert(afterA === beforeTarget - 2, "共用標靶正確減少2（兩次攻擊都生效）", results);

    console.log("=== 風險點4（2026-09-05新增）：敵人攻擊系統（連emulator，直接seed fieldTrigger） ===");
    // 略過邀請/打字機/投票這些既有且沒有變更過的UI流程，直接寫一個「已解決分歧、敵人
    // 存活」的fieldTrigger，只驗證這次新增的updateEnemyAttack()整條路徑（排程→發動→
    // 命中/迴避判定）。找地圖上第一個非sorcerer的點，把裝置A走到旁邊。
    const map = await pageA.evaluate((seed) => window.PriTestMidnightMap.generateMap(seed), stateA.meta.mapSeed);
    const pt = (map.points || []).find((p) => p.type !== "sorcerer");
    if (!pt) {
      assert(false, "地圖上找不到非sorcerer的點可供測試（seed本身的問題，不是功能bug）", results);
    } else {
      const reached = await walkNear(pageA, pt.x + 0.5, pt.y + 0.5, 1.5, 120);
      if (!reached) {
        console.log("  [SKIP] 這個測試工具的直線走位沒能在固定佈局的牆壁間走到目標點附近，略過風險點4（非功能性失敗，見腳本頂端說明）");
      } else {
        await pageA.evaluate(
          ({ gameId, pointId }) => {
            const participants = {};
            const slot = window.PriTestMidnight._debugState().mySlot;
            participants[slot] = true;
            return window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pointId, {
              status: "resolved",
              participants: participants,
              branchIndex: 0,
              floorIndex: 0,
              enemyFamilyId: "test",
              enemyId: "test",
            }).then(() => window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/" + pointId, 30));
          },
          { gameId: stateA.gameId, pointId: pt.id }
        );
        await pageA.waitForFunction(
          () => window.PriTestMidnight._debugState().activeEncounter,
          { timeout: 5000 }
        ).catch(() => {});
        const encounterState = await pageA.evaluate(() => window.PriTestMidnight._debugState());
        assert(!!encounterState.activeEncounter, "直接seed的fieldTrigger讓玩家靠近時activeEncounter正確生效", results);

        await pageA.waitForFunction(
          (pointId) => {
            const trig = (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId];
            return trig && trig.nextAttackAt;
          },
          pt.id,
          { timeout: 5000 }
        ).catch(() => {});
        const scheduledState = await pageA.evaluate((pointId) => (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId], pt.id);
        assert(!!(scheduledState && scheduledState.nextAttackAt), "ensureNextAttackScheduled()透過RTDB排出下一次攻擊時間", results);

        await pageA.waitForFunction(
          (pointId) => {
            const trig = (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId];
            return trig && trig.enemyAttack;
          },
          pt.id,
          { timeout: 8000 }
        ).catch(() => {});
        const attackState = await pageA.evaluate((pointId) => (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId], pt.id);
        const attackFired = !!(attackState && attackState.enemyAttack);
        assert(attackFired, "maybeStartEnemyAttack()時間到後透過RTDB真的發動了一次攻擊", results);
        if (attackFired) {
          const targeted = attackState.enemyAttack.targetSlots.indexOf(encounterState.mySlot) !== -1;
          assert(targeted, "唯一參與者（自己）被正確列入這次攻擊的targetSlots", results);
          const beforeHp = (await pageA.evaluate(() => window.PriTestMidnight._debugState().demoStats))[encounterState.myTokenId];
          // 故意不按迴避/防禦，等反應窗口逾時，驗證命中會正確扣血。
          await pageA.waitForFunction(
            () => window.PriTestMidnight._debugState().myIncomingAttack && window.PriTestMidnight._debugState().myIncomingAttack.phase === "done",
            { timeout: 12000 }
          ).catch(() => {});
          const afterHp = (await pageA.evaluate(() => window.PriTestMidnight._debugState().demoStats))[encounterState.myTokenId];
          assert(afterHp !== undefined && (beforeHp === undefined ? 100 : beforeHp) > afterHp, "沒有按迴避/防禦時，反應窗口逾時後正確扣血（見resolveMyIncomingHit的hit分支）", results);

          console.log("=== 風險點4b：這次全程按迴避不扣血（見resolveMyIncomingHit的dodge分支） ===");
          // 一次攻擊可能有1~3擊（ENEMY_ATTACK_HIT_COUNT_WEIGHTS），每一擊各自有自己的
          // window階段，所以要在每次進入window時都按一次迴避，直到這次攻擊整個done為止。
          await pageA.waitForFunction(
            (pointId) => {
              const trig = (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId];
              return trig && trig.enemyAttack;
            },
            pt.id,
            { timeout: 8000 }
          ).catch(() => {});
          const hpBeforeDodge = (await pageA.evaluate(() => window.PriTestMidnight._debugState().demoStats))[encounterState.myTokenId];
          for (let hitAttempt = 0; hitAttempt < 30; hitAttempt++) {
            const st = await pageA.evaluate(() => window.PriTestMidnight._debugState().myIncomingAttack);
            if (!st || st.phase === "done") break;
            if (st.phase === "window") {
              await pageA.click("#btn-midnight-dodge");
            }
            await pageA.waitForTimeout(300);
          }
          await pageA.waitForFunction(
            () => !window.PriTestMidnight._debugState().myIncomingAttack || window.PriTestMidnight._debugState().myIncomingAttack.phase === "done",
            { timeout: 10000 }
          ).catch(() => {});
          const hpAfterDodge = (await pageA.evaluate(() => window.PriTestMidnight._debugState().demoStats))[encounterState.myTokenId];
          assert(hpAfterDodge === hpBeforeDodge, "反應窗口內每一擊都按迴避，整次攻擊都沒有扣血", results);
        }
      }
    }
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
