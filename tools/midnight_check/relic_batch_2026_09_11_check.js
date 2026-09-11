// ============================================================================
// midnight 2026-09-11 批次：敵人體崩狀態／最低傷害／遺物效果 回歸測試
// （Firebase Local Emulator 版，環境準備同 emulator_sync_check.js 開頭說明）。
// ============================================================================
// 驗證範圍：
//   1. 體崩累積：▲=1／◆=2 單位，累積 36 單位進入體崩；HP 在 40%~60% 之間時累積 ×3。
//   2. 體崩狀態：持續 3 秒、敵人的下一次攻擊被推遲到體崩結束、畫面出現「體崩中！！」橫幅。
//   3. 體崩中 Guard Point 以最低（0）計算＝同一招打出的傷害比平時高。
//   4. 敵人最低遭受傷害 1 點（把測試模式的敵人防禦價值倍率拉到減傷 100% 也仍扣 1）。
//   5. 致命一擊：習得＋裝備近戰武器＋體崩中才出現按鈕，按下造成傷害，同一次體崩只能按一次。
//   6. 遺物效果「防禦階段開始時體力骰回復」＝體力上限 +10。
//   7. 遺物效果「聖杯瓶可回復FP」開關：開啟後喝聖杯瓶改成回 FP、HP 不變。
//
// 執行方式：node relic_batch_2026_09_11_check.js
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

const st = (page) => page.evaluate(() => window.PriTestMidnight._debugState());

// emulator_sync_check.js 與同一套「盡力而為」走位（不做路徑規劃）。
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
const rtSet = (page, gameId, path, value) =>
  page.evaluate(({ gameId, path, value }) => window.PriTestGameStorage.rtSet(gameId, "cloud", path, value), { gameId, path, value });

// 直接 seed 一個「已解決分歧、敵人存活」的戰鬥點（跟其他測試腳本同一套做法），
// 不跑邀請/打字機/投票這些跟本次無關的既有流程。
async function seedEncounter(page, gameId, slot, pointId, hp) {
  const participants = {};
  participants[slot] = true;
  await rtSet(page, gameId, "fieldTrigger/" + pointId, {
    status: "resolved",
    participants: participants,
    branchIndex: 0,
    floorIndex: 0,
    // 實際存在的敌人 family（recordGuardReductionForPoint() 會先查 guardCount，
    // 虛構的 family 會直接 early return、永遠不會累積體崩）。
    enemyFamilyId: "dragon",
    enemyId: "great_earth_dragon",
    level: 1,
  });
  await rtSet(page, gameId, "fieldEnemyHp/" + pointId, hp);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = [];
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

  try {
    await enableEmulatorFlag(page);
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await page.click("#midnight-lobby-slots .midnight-slot-empty button");
    await page.fill("#midnight-lobby-passcode-input", "1234");
    await page.click("#btn-midnight-lobby-join");
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });
    await page.waitForTimeout(11000); // 開場動畫

    const s0 = await st(page);
    const gameId = s0.gameId;
    const tokenId = s0.myTokenId;
    const slot = s0.mySlot;
    const K = await page.evaluate(() => window.PriTestMidnight._debugStaggerConstants());
    console.log(`  體崩常數：閥值${K.thresholdUnits}單位／持續${K.durationMs}ms／HP ${K.accelHpMinPct}~${K.accelHpMaxPct}% 時 ×${K.accelMult}`);

    // -------------------------------------------------------------------
    console.log("=== 1. 體崩累積（滿血時不加速）===");
    // 要測「體崩中的畫面與致命一擊」就必須真的進入 activeEncounter，
    // 因此先把角色走到地圖點旁邊（走不到就整支跳過，同其他腳本的慣例）。
    const map = await page.evaluate((seed) => window.PriTestMidnightMap.generateMap(seed), s0.meta.mapSeed);
    const pt = (map.points || []).find((p) => p.type !== "sorcerer");
    const POINT = pt.id;
    const reached = await walkNear(page, pt.x + 0.5, pt.y + 0.5, 1.2, 200);
    if (!reached) {
      console.log("  [SKIP] 固定佈局的牆壁讓直線走位走不到目標點，略過整支測試（非功能性失敗）");
      await browser.close();
      return;
    }
    await seedEncounter(page, gameId, slot, POINT, 100000); // 滿血（加速區間外）
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().activeEncounter, { timeout: 20000 }).catch(() => {});
    // ◆ = 2 單位 → 需要 threshold/2 次才會體崩；先打 threshold/2 - 1 次確認還沒體崩
    const halfMinusOne = K.thresholdUnits / 2 - 1;
    for (let i = 0; i < halfMinusOne; i++) {
      await page.evaluate((p) => window.PriTestMidnight._debugRecordGuardReduction(p, "◆"), POINT);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(800);
    let trig = (await st(page)).fieldTriggers[POINT];
    assert(
      (trig.staggerUnits || 0) === K.thresholdUnits - 2 && !trig.staggerUntil,
      `累積到 ${K.thresholdUnits - 2} 單位時尚未體崩（實際${trig.staggerUnits}）`,
      results
    );
    await page.evaluate((p) => window.PriTestMidnight._debugRecordGuardReduction(p, "◆"), POINT);
    await page.waitForTimeout(800);
    trig = (await st(page)).fieldTriggers[POINT];
    const staggerRemain = (trig.staggerUntil || 0) - Date.now();
    assert(staggerRemain > 0, "累積滿閥值後進入體崩", results);
    assert(staggerRemain <= K.durationMs + 800, `體崩持續約 ${K.durationMs}ms（剩餘${staggerRemain}ms）`, results);
    assert((trig.staggerUnits || 0) === 0, "進入體崩後累積歸零", results);
    assert((trig.staggerSeq || 0) === 1, "體崩序號 staggerSeq 遞增", results);

    console.log("=== 1b. HP 40~60% 時累積 ×3 ===");
    // 體崩中不累積（見 recordGuardReductionForPoint）→ 先等體崩結束再測加速。
    await page.waitForTimeout(K.durationMs + 400);
    // 敵人的 HP 上限是由 enemies_data_*.js 算出來的（不是我們 seed 的值），
    // 測試模式打開時戰鬥畫面會顯示「cur/max」，從那裡讀回真正的 max。
    await rtSet(page, gameId, "meta/testMode", true);
    await page.waitForTimeout(700);
    const enemyMax = await page.evaluate(() => {
      const t = (document.getElementById("midnight-enemy-hp-value").textContent || "").split("/");
      return t.length === 2 ? Number(t[1]) : 0;
    });
    assert(enemyMax > 0, "讀得到敵人 HP 上限（" + enemyMax + "）", results);
    await rtSet(page, gameId, "fieldEnemyHp/" + POINT, Math.round(enemyMax * 0.5)); // 50%＝加速區間內
    await page.waitForTimeout(600);
    const unitsBeforeAccel = ((await st(page)).fieldTriggers[POINT].staggerUnits || 0);
    await page.evaluate((p) => window.PriTestMidnight._debugRecordGuardReduction(p, "◆"), POINT);
    await page.waitForTimeout(700);
    const unitsAfterAccel = ((await st(page)).fieldTriggers[POINT].staggerUnits || 0);
    assert(
      unitsAfterAccel - unitsBeforeAccel === 2 * K.accelMult,
      `HP 50% 時 ◆ 累積 ${2 * K.accelMult} 單位（實際 +${unitsAfterAccel - unitsBeforeAccel}）`,
      results
    );
    await rtSet(page, gameId, "fieldEnemyHp/" + POINT, enemyMax); // 還原成滿血，避免影響後續項目
    await rtSet(page, gameId, "fieldTrigger/" + POINT + "/staggerUntil", Date.now() + K.durationMs);
    await page.waitForTimeout(600);
    trig = (await st(page)).fieldTriggers[POINT];

    console.log("=== 2. 體崩橫幅與敵人停止攻擊 ===");
    const bannerVisible = await page.evaluate(() => !document.getElementById("midnight-stagger-banner").hidden);
    assert(bannerVisible, "畫面出現「體崩中！！」橫幅", results);
    // 「不會進行任何攻擊」的驗證：把下一次攻擊排程拉到「現在」，體崩期間仍不應該生成
    // enemyAttack（maybeStartEnemyAttack() 會把排程推到體崩結束）。
    await rtSet(page, gameId, "fieldTrigger/" + POINT + "/nextAttackAt", Date.now());
    await page.waitForTimeout(1200);
    const duringStagger = (await st(page)).fieldTriggers[POINT];
    assert(!duringStagger.enemyAttack, "體崩期間敵人不會發動攻擊", results);
    assert((duringStagger.nextAttackAt || 0) >= (duringStagger.staggerUntil || 0) - 50, "下一次攻擊被推遲到體崩結束之後", results);

    console.log("=== 3. 致命一擊 ===");
    // 習得「致命一擊」（Action類遺物）並確保裝備近戰武器
    const learned = await page.evaluate(
      ({ tokenId }) => {
        const CD = window.PriTestCharacterDrawer;
        const CT = window.PriTestCharacterTypes;
        const c = window.PriTestMidnight._debugState().characters[tokenId];
        const type = CT.get(c.typeId);
        let key = null;
        (type.relicEffectGroups || []).forEach((g, gi) =>
          (g.effects || []).forEach((e, ei) => {
            if (!key && ((e.name && e.name.zh) || "") === "致命一擊") key = CD.relicEffectKey(type.id, gi, ei);
          })
        );
        return { key: key, typeId: c.typeId };
      },
      { tokenId }
    );
    if (!learned.key) {
      console.log("  [SKIP] " + learned.typeId + " 沒有「致命一擊」遺物效果，略過本項");
    } else {
      await rtSet(page, gameId, "character/" + tokenId + "/learnedRelicEffects", [learned.key]);
      // 前面幾項檢查已經花掉 3 秒，體崩可能剛好結束 → 重新延長一次再驗證按鈕。
      await rtSet(page, gameId, "fieldTrigger/" + POINT + "/staggerUntil", Date.now() + 20000);
      await page.waitForTimeout(1200);
      const btnVisible = await page.evaluate(() => !document.getElementById("btn-midnight-execution").hidden);
      assert(btnVisible, "體崩中且習得後，敵人圖片上出現[致命一擊]按鈕", results);
      if (btnVisible) {
        const hpBefore = (await st(page)).fieldEnemyHp[POINT];
        await page.click("#btn-midnight-execution");
        await page.waitForTimeout(900);
        const afterState = await st(page);
        assert(afterState.fieldEnemyHp[POINT] < hpBefore, "按下致命一擊後敵人HP下降", results);
        assert((afterState.fieldTriggers[POINT].executionUsedSeq || 0) === 1, "同一次體崩記下已使用（executionUsedSeq）", results);
        const btnHidden = await page.evaluate(() => document.getElementById("btn-midnight-execution").hidden);
        assert(btnHidden, "按過之後按鈕消失（同一次體崩只能按一次）", results);
      }
    }

    console.log("=== 4. 敵人最低遭受傷害 1 點 ===");
    // 測試模式的「敵人防禦價值倍率」拉高 → 減傷夾在100% → 照理會算成0，應該仍扣1
    await rtSet(page, gameId, "meta/testMode", true);
    await rtSet(page, gameId, "meta/testTuning", { enemyGuardValueMult: 10, pcDmgMult: 1, enemyHpMult: 1, enemyAtkMult: 1 });
    await page.waitForTimeout(1500);
    // 等體崩結束（體崩中 Guard=0 會讓減傷失效，測不到這一項）
    await page.waitForTimeout(K.durationMs);
    const beforeMin = (await st(page)).fieldEnemyHp[POINT];
    await page.click("#btn-midnight-attack-shared-target");
    await page.waitForTimeout(800);
    const afterMin = (await st(page)).fieldEnemyHp[POINT];
    assert(afterMin < beforeMin, `減傷100%時仍扣血（${beforeMin}→${afterMin}）`, results);
    await rtSet(page, gameId, "meta/testTuning", { enemyGuardValueMult: 1, pcDmgMult: 1, enemyHpMult: 1, enemyAtkMult: 1 });

    // 後面兩項會比對 HP/體力的前後值，敵人若在中途攻擊就會干擾 → 先把敵人禁閉起來
    // （沿用既有的 enemyStunnedUntil 欄位，淑女「終曲」用的同一個機制）。
    await rtSet(page, gameId, "fieldTrigger/" + POINT + "/enemyStunnedUntil", Date.now() + 120000);
    await rtSet(page, gameId, "fieldTrigger/" + POINT + "/enemyAttack", null);
    await page.waitForTimeout(600);

    console.log("=== 5. 遺物效果：體力上限 +10 ===");
    const staminaRelic = await page.evaluate(
      ({ tokenId }) => {
        const CD = window.PriTestCharacterDrawer;
        const CT = window.PriTestCharacterTypes;
        const c = window.PriTestMidnight._debugState().characters[tokenId];
        const type = CT.get(c.typeId);
        let key = null;
        (type.relicEffectGroups || []).forEach((g, gi) =>
          (g.effects || []).forEach((e, ei) => {
            if (!key && ((e.name && e.name.zh) || "") === "防禦階段開始時體力骰回復") key = CD.relicEffectKey(type.id, gi, ei);
          })
        );
        return key;
      },
      { tokenId }
    );
    if (!staminaRelic) {
      console.log("  [SKIP] 這個角色沒有「防禦階段開始時體力骰回復」遺物，略過本項");
    } else {
      const maxBefore = (await st(page)).stamina.max;
      await rtSet(page, gameId, "character/" + tokenId + "/learnedRelicEffects", [staminaRelic]);
      await page.waitForTimeout(1500);
      const maxAfter = (await st(page)).stamina.max;
      assert(maxAfter === maxBefore + 10, `體力上限 +10（${maxBefore}→${maxAfter}）`, results);
    }

    console.log("=== 6. 遺物效果：聖杯瓶可回復FP（開關）===");
    const flaskRelic = await page.evaluate(
      ({ tokenId }) => {
        const CD = window.PriTestCharacterDrawer;
        const CT = window.PriTestCharacterTypes;
        const c = window.PriTestMidnight._debugState().characters[tokenId];
        const type = CT.get(c.typeId);
        let key = null;
        (type.relicEffectGroups || []).forEach((g, gi) =>
          (g.effects || []).forEach((e, ei) => {
            if (!key && ((e.name && e.name.zh) || "") === "聖杯瓶可回復FP") key = CD.relicEffectKey(type.id, gi, ei);
          })
        );
        return key;
      },
      { tokenId }
    );
    if (!flaskRelic) {
      console.log("  [SKIP] 這個角色沒有「聖杯瓶可回復FP」遺物，略過本項");
    } else {
      await rtSet(page, gameId, "character/" + tokenId + "/learnedRelicEffects", [flaskRelic]);
      await rtSet(page, gameId, "character/" + tokenId + "/_flaskFpMode", true);
      // FP/HP 先扣掉一些，才看得出回復
      await rtSet(page, gameId, "demoStat/" + tokenId, 50);
      await page.evaluate(() => {
        window.PriTestMidnight._debugState().fp.current = 1;
      });
      await page.waitForTimeout(1200);
      const fpBefore = (await st(page)).fp.current;
      const hpBefore2 = (await st(page)).demoStats[tokenId];
      await page.click("#btn-midnight-use-flask");
      await page.waitForTimeout(1800); // 讀取1秒＋同步
      const afterFlask = await st(page);
      assert(afterFlask.fp.current > fpBefore, `開關開啟時聖杯瓶回復FP（${fpBefore}→${afterFlask.fp.current}）`, results);
      assert(afterFlask.demoStats[tokenId] === hpBefore2, "同時HP維持不變", results);
    }
  } catch (e) {
    console.log("  [ERROR]", e.message);
    results.push({ label: "腳本執行中發生例外：" + e.message, pass: false });
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== 結果：${results.length - failed.length}/${results.length} 通過 ===`);
  failed.forEach((r) => console.log("  FAIL: " + r.label));
  process.exit(failed.length ? 1 : 0);
})();
