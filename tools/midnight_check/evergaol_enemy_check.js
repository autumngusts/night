// ============================================================================
// midnight 2026-09-21 回歸測試：封牢一定產生敵人戰鬥／消耗品抽選不再抽出鑰匙
// （Playwright ＋ Firebase Local Emulator）
// ============================================================================
// 使用前準備（跟 emulator_sync_check.js 完全相同，見該檔開頭）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node evergaol_enemy_check.js
//
// 涵蓋項目：
//   ① card_9 三個分歧（封牢(無印)／封牢(森)／神殿）第 1 層經 maybeAssignFieldEnemy() 都會指派
//      敵人（enemyFamilyId／enemyId／level／fieldEnemyHp>0），不再被當成和平通過直接發獎勵。
//      封牢兩分歧的等級來自「封牢エネミー決定表」的 Lv.4+L補、神殿第 1 層來自「第1階層ボス
//      決定表」的 Lv.6／7+L補。
//   ② 同一個點、同一分歧重跑一次會指派到同一隻敵人（mapSeed 決定性，多裝置各自跑也一致）。
//   ③ 一般具體敵名 bullet 的既有路徑不受影響（scanLinesForEnemyMatches 對比對得到的
//      「敵名(頁)/Lv.N」仍然回傳同一隻）。
//   ④ 共享池／個人清單的隨機消耗品抽選（drawSharedRewardData）候選池排除石劍鑰匙／鍛造石；
//      固定 kind:"stoneswordKey" 仍直接回傳 {value}。
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

async function joinLobby(page, passcode) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", passcode);
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
}

const rtSet = (page, path, value) =>
  page.evaluate(
    ([p, v]) => {
      const s = window.PriTestMidnight._debugState();
      return window.PriTestGameStorage.rtSet(s.gameId, "cloud", p, v);
    },
    [path, value]
  );
const waitFor = (page, fn, arg, timeout) => page.waitForFunction(fn, arg, { timeout: timeout || META_WAIT_MS });

// 對某個地圖點以指定分歧寫入 resolved trigger、跑 maybeAssignFieldEnemy()，回傳指派結果。
async function assignEnemyForBranch(page, pointId, branchIndex) {
  await rtSet(page, "fieldEnemyHp/" + pointId, null);
  await rtSet(page, "fieldMobHp/" + pointId, null);
  await rtSet(page, "fieldTrigger/" + pointId, null);
  await waitFor(page, (id) => !window.PriTestMidnight._debugState().fieldTriggers[id], pointId);
  const slot = await page.evaluate(() => window.PriTestMidnight._debugState().mySlot);
  const participants = {};
  participants[slot] = true;
  await rtSet(page, "fieldTrigger/" + pointId, {
    status: "resolved",
    branchIndex: branchIndex,
    floorIndex: 0,
    choiceIndex: 0,
    participants: participants,
    startedAt: Date.now(),
    resolvedAt: Date.now(),
  });
  await waitFor(
    page,
    (args) => {
      const t = window.PriTestMidnight._debugState().fieldTriggers[args.id];
      return !!t && t.status === "resolved" && t.branchIndex === args.b;
    },
    { id: pointId, b: branchIndex }
  );
  const rewardsBefore = await page.evaluate(() => {
    const s = window.PriTestMidnight._debugState();
    return Object.keys((s.pendingRewards || {})[s.myTokenId] || {}).length;
  });
  await page.evaluate((id) => window.PriTestMidnight._debugAssignFieldEnemy(id, 0), pointId);
  const assigned = await waitFor(
    page,
    (id) => {
      const s = window.PriTestMidnight._debugState();
      const t = s.fieldTriggers[id];
      return !!(t && t.enemyFamilyId && t.enemyId && typeof s.fieldEnemyHp[id] === "number");
    },
    pointId,
    10000
  )
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(500);
  return await page.evaluate(
    (args) => {
      const s = window.PriTestMidnight._debugState();
      const t = s.fieldTriggers[args.id] || null;
      const enemy = t && t.enemyId ? window.PriTestEnemies.get(t.enemyFamilyId, t.enemyId) : null;
      return {
        assigned: args.assigned,
        trig: t,
        hp: s.fieldEnemyHp[args.id],
        enemyKnown: !!enemy,
        rewardsAfter: Object.keys((s.pendingRewards || {})[s.myTokenId] || {}).length,
        rewardsBefore: args.rewardsBefore,
        tileRewardGrantedBy: t ? t.tileRewardGrantedBy || null : null,
      };
    },
    { id: pointId, assigned, rewardsBefore }
  );
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror] " + e.message));

  try {
    await enableEmulatorFlag(page);
    console.log("=== 建立 midnight 測試場（連本機 emulator）並單人開局 ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await joinLobby(page, "1234");
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 25000 });
    await page.waitForFunction(() => {
      const s = window.PriTestMidnight._debugState();
      return !!s.characters[s.myTokenId] && !!s.localPos && !!s.map;
    }, { timeout: META_WAIT_MS });

    const evergaols = await page.evaluate(() => window.PriTestMidnight._debugState().map.points.filter((p) => p.type === "evergaol").map((p) => ({ id: p.id, card: p.card })));
    assert(evergaols.length === 3 && evergaols.every((p) => p.card === "9"), "地圖上有 3 個 card 9 封牢點", evergaols);
    const ptId = evergaols[0].id;
    const branchNames = await page.evaluate(() => window.PriTestFields.get("card_9").branches.map((b) => b.name.zh));

    // ======================================================================
    console.log("\n=== ① card_9 三分歧第 1 層都會指派敵人 ===");
    const firstRun = {};
    for (let b = 0; b < branchNames.length; b++) {
      const r = await assignEnemyForBranch(page, ptId, b);
      firstRun[b] = r;
      assert(r.assigned && r.enemyKnown, "①：" + branchNames[b] + " 指派到敵人資料中存在的敵人", { trig: r.trig, hp: r.hp });
      assert(typeof r.hp === "number" && r.hp > 0, "①：" + branchNames[b] + " fieldEnemyHp 已初始化且 > 0", r.hp);
      const minLevel = /封牢/.test(branchNames[b]) ? 4 : 6;
      assert(r.trig && r.trig.level >= minLevel, "①：" + branchNames[b] + " 等級來自決定表（≥" + minLevel + "，含 L補）", r.trig && r.trig.level);
      assert(!r.tileRewardGrantedBy && r.rewardsAfter === r.rewardsBefore, "①：" + branchNames[b] + " 沒有被當成和平通過直接發獎勵", {
        tileRewardGrantedBy: r.tileRewardGrantedBy,
        before: r.rewardsBefore,
        after: r.rewardsAfter,
      });
      console.log("      → " + branchNames[b] + "：" + (r.trig ? r.trig.enemyFamilyId + "/" + r.trig.enemyId + " Lv." + r.trig.level : "(none)") + "，HP " + r.hp);
    }

    // ======================================================================
    console.log("\n=== ② 同點同分歧重跑 → 同一隻敵人（決定性） ===");
    const rerun = await assignEnemyForBranch(page, ptId, 0);
    assert(
      rerun.trig && firstRun[0].trig && rerun.trig.enemyId === firstRun[0].trig.enemyId && rerun.trig.enemyFamilyId === firstRun[0].trig.enemyFamilyId,
      "②：封牢(無印) 重跑指派到同一隻敵人",
      { first: firstRun[0].trig && firstRun[0].trig.enemyId, again: rerun.trig && rerun.trig.enemyId }
    );
    await rtSet(page, "fieldEnemyHp/" + ptId, null);
    await rtSet(page, "fieldTrigger/" + ptId, null);

    // ======================================================================
    console.log("\n=== ③ 具體敵名 bullet 的既有路徑不受影響 ===");
    const legacy = await page.evaluate(() => {
      const card = window.PriTestFields.get("card_2");
      // 從 card_2 找第一行能比對到具體敵人的 bullet
      let hit = null;
      card.branches.some((br) =>
        br.floors.some((fl) =>
          (fl.lines || []).some((line) => {
            const ja = (line.text && line.text.ja) || "";
            if (!/「[^」]+」/.test(ja)) return false;
            const ref = window.PriTestNightGmFlow.parseCombatEnemyRef(line);
            const m = ref.nameTokens.map((t) => window.PriTestNightGmFlow.resolveCombatEnemyMatch(t)).filter(Boolean)[0];
            if (!m) return false;
            hit = { line, expected: m.enemy.id };
            return true;
          })
        )
      );
      if (!hit) return null;
      const matches = window.PriTestMidnight._debugScanLinesForEnemyMatches([hit.line], "card_2", "probe");
      return { expected: hit.expected, got: matches.map((m) => m.enemy.id) };
    });
    assert(legacy && legacy.got.length === 1 && legacy.got[0] === legacy.expected, "③：具體敵名 bullet 仍回傳同一隻", legacy);
    const noTable = await page.evaluate(() => {
      const card = window.PriTestFields.get("card_9");
      const line = card.branches[0].floors[0].lines.filter((l) => /決定表で決定した/.test((l.text && l.text.ja) || ""))[0];
      return {
        withCard: window.PriTestMidnight._debugScanLinesForEnemyMatches([line], "card_9", "probe").length,
        withoutCard: window.PriTestMidnight._debugScanLinesForEnemyMatches([line], null, "probe").length,
      };
    });
    assert(noTable.withCard === 1 && noTable.withoutCard === 0, "③：決定表引用只在有卡片資料時解析（沒有卡片資料＝原本行為）", noTable);

    // ======================================================================
    console.log("\n=== ④ 隨機消耗品抽選排除鑰匙類道具 ===");
    const draws = await page.evaluate(() => {
      const ids = {};
      for (let i = 0; i < 400; i++) {
        const d = window.PriTestMidnight._debugDrawSharedRewardData({ kind: "consumable" });
        ids[d.itemId] = (ids[d.itemId] || 0) + 1;
      }
      return {
        ids: Object.keys(ids),
        keyHits: (ids.item_stonesword_key || 0) + (ids.item_smithing_stone || 0),
        fixedKey: window.PriTestMidnight._debugDrawSharedRewardData({ kind: "stoneswordKey", value: 1 }),
        named: window.PriTestMidnight._debugDrawSharedRewardData({ kind: "consumable", itemId: "item_warming_stone" }),
        poolSize: window.PriTestConsumables.list().filter((it) => !it.noStackLimit).length,
      };
    });
    assert(draws.keyHits === 0, "④：400 次隨機消耗品抽選都不會抽出石劍鑰匙／鍛造石", draws);
    assert(draws.ids.length >= 10 && draws.ids.length <= draws.poolSize, "④：抽選仍涵蓋一般消耗品（種類數 " + draws.ids.length + "／池 " + draws.poolSize + "）", draws.ids);
    assert(draws.fixedKey && draws.fixedKey.value === 1, "④：固定 kind stoneswordKey 仍直接回傳 {value:1}", draws.fixedKey);
    assert(draws.named && draws.named.itemId === "item_warming_stone", "④：指定 itemId 的消耗品不受影響", draws.named);

    // ======================================================================
    console.log("\n=== ⑤ 進入封牢：沒鑰匙擋下、有鑰匙扣 1 個 ===");
    const keyCount = () =>
      page.evaluate(() => {
        const s = window.PriTestMidnight._debugState();
        const inst = (s.characters[s.myTokenId].consumables || []).filter((i) => i.itemId === "item_stonesword_key")[0];
        return inst ? inst.usesRemaining : 0;
      });
    await rtSet(page, "fieldTrigger/" + ptId, null);
    await waitFor(page, (id) => !window.PriTestMidnight._debugState().fieldTriggers[id], ptId);
    // 先確保沒有鑰匙
    await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const before = M._debugSnapshotMyCharacter();
      s.characters[s.myTokenId].consumables = (s.characters[s.myTokenId].consumables || []).filter((i) => i.itemId !== "item_stonesword_key");
      M._debugSyncMyCharacterChanges(before);
    });
    await waitFor(page, () => {
      const s = window.PriTestMidnight._debugState();
      return !(s.characters[s.myTokenId].consumables || []).some((i) => i.itemId === "item_stonesword_key");
    });
    await page.evaluate((id) => window.PriTestMidnight._debugEnterFieldPoint(id), ptId);
    await page.waitForTimeout(800);
    const trigNoKey = await page.evaluate((id) => window.PriTestMidnight._debugState().fieldTriggers[id] || null, ptId);
    assert(trigNoKey === null, "⑤：沒有石劍鑰匙時按「進入」不會建立 fieldTrigger", trigNoKey);

    await page.evaluate(() => window.PriTestMidnight._debugGrantConsumable("item_stonesword_key", 2));
    await waitFor(page, () => {
      const s = window.PriTestMidnight._debugState();
      const inst = (s.characters[s.myTokenId].consumables || []).filter((i) => i.itemId === "item_stonesword_key")[0];
      return !!inst && inst.usesRemaining === 2;
    });
    const slotNow = await page.evaluate(() => window.PriTestMidnight._debugState().mySlot);
    await page.evaluate((id) => window.PriTestMidnight._debugEnterFieldPoint(id), ptId);
    await waitFor(
      page,
      (args) => {
        const t = window.PriTestMidnight._debugState().fieldTriggers[args.id];
        return !!t && t.status === "inviting" && t.initiatedBy === args.slot;
      },
      { id: ptId, slot: slotNow }
    );
    await page.waitForTimeout(600);
    const afterEnter = await keyCount();
    assert(afterEnter === 1, "⑤：持有 2 把時按「進入」建立邀請並扣 1 把（剩 " + afterEnter + "）", afterEnter);
    const synced = await page.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      const c = s.characters[s.myTokenId];
      const inst = (c.consumables || []).filter((i) => i.itemId === "item_stonesword_key")[0];
      return inst ? inst.usesRemaining : 0;
    });
    assert(synced === 1, "⑤：扣除後角色資料（characters）同步為 1 把", synced);
    // 重複按同一個點（trigger 已存在）不會再扣
    await page.evaluate((id) => window.PriTestMidnight._debugEnterFieldPoint(id), ptId);
    await page.waitForTimeout(600);
    assert((await keyCount()) === 1, "⑤：trigger 已存在時再按不會重複扣鑰匙");
    await rtSet(page, "fieldTrigger/" + ptId, null);
  } catch (e) {
    console.log("  [ERROR] " + (e && e.stack ? e.stack : e));
    results.push({ label: "script error", pass: false });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n=== 結果：" + (results.length - failed.length) + "/" + results.length + " PASS ===");
  failed.forEach((r) => console.log("  FAIL: " + r.label));
  process.exit(failed.length ? 1 : 0);
})();
