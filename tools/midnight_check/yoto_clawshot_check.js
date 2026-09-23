// ============================================================================
// Playwright 回歸測試：妖刀的主動釋放窗口，與爪擊「兩邊效果一起執行」。
// ============================================================================
// ① 妖刀（執行者技能 yoto）
//    基礎狀態下按技能鍵沒有效果是**正確的**——本文寫「可代替『防禦』執行」，它是特殊防禦
//    選項。主動釋放要先習得遺物效果，而且是兩種、成本不同（見 YOTO_RELEASE_COST）：
//      妖刀解放・攻 yoto_release_action       消耗蓄積 1，【總合傷害：50+▲】
//      妖刀解放・癒 yoto_release_heal_action  消耗蓄積 2，【總合傷害：100+◆】＋HP回復□×5
//    蓄積本身是「以妖刀防禦成功」時 +1、上限 YOTO_CHARGES_MAX(2)。
//    這裡驗：習得後技能欄出現該變體、切過去後能用、蓄積不足時擋下、用掉後蓄積正確扣除、
//    癒版本額外回 HP。
//
// ② 爪擊（追蹤者技能 claw_shot）
//    2026-09-23 使用者明確規格變更：「一起執行兩邊效果 對敵人扣guard也有主動復歸傷害」。
//    在此之前本文的「任選其一」被實作成「兩邊都不做」（只跳 toast）。這裡驗兩邊都發生：
//      ・對敵人累積 Guard 削減（▲，走 recordGuardReductionForPoint）
//      ・對倒地隊友施加【復歸傷害：40】
//    復歸傷害需要有倒地的隊友，因此這一段開兩個分頁（兩個席位）。
//
// 走 Firebase Local Emulator（見 emulator_sync_check.js 開頭的環境說明）。
// 前置：generate.py 建 dist/、起本機 http server、起 firebase emulators。
// 執行：node yoto_clawshot_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const WAIT = 20000;

const results = [];
function assert(cond, label, extra) {
  results.push({ label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label + (extra ? "   " + extra : ""));
}

async function enableEmulatorFlag(page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
    } catch (e) {}
  });
}

const click = (page, sel) => page.dispatchEvent(sel, "click"); // CLAUDE.md §4.6

async function joinLobby(page, passcode) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", passcode);
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: WAIT });
}

// 真實敵人（查得到 guardCount 才會累積 Guard 削減）、沒有雜兵（免得傷害被雜兵吃掉）。
async function setupEncounter(page, slots) {
  const pointId = await page.evaluate((slots) => {
    const s = window.PriTestMidnight._debugState();
    const NON_FIELD = { sorcerer: 1, merchant: 1, strong_enemy: 1, random_event: 1, blessing: 1 };
    const pt = (s.map.points || []).filter((p) => !NON_FIELD[p.type])[0];
    const participants = {};
    slots.forEach((sl) => (participants[sl] = true));
    return window.PriTestGameStorage.rtSet(s.gameId, "cloud", "fieldTrigger/" + pt.id, {
      status: "resolved",
      participants: participants,
      branchIndex: 0,
      floorIndex: 0,
      level: 1,
      enemyFamilyId: "rat_basilisk",
      enemyId: "big_rats",
    })
      .then(() => window.PriTestGameStorage.rtSet(s.gameId, "cloud", "fieldEnemyHp/" + pt.id, 100000000))
      .then(() => pt.id);
  }, slots);
  return pointId;
}

async function moveTo(page, pointId) {
  await page.evaluate((p) => {
    const s = window.PriTestMidnight._debugState();
    const pt = (s.map.points || []).filter((x) => x.id === p)[0];
    window.PriTestMidnight._debugSetLocalPos(pt.x + 0.5, pt.y + 0.5);
  }, pointId);
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().activeEncounter, { timeout: 20000 }).catch(() => {});
}

const setYotoCharges = (page, n) =>
  page.evaluate((n) => {
    const s = window.PriTestMidnight._debugState();
    s.characters[s.myTokenId]._yotoCharges = n;
    return window.PriTestGameStorage.rtSet(s.gameId, "cloud", "character/" + s.myTokenId + "/_yotoCharges", n);
  }, n);

(async () => {
  const browser = await chromium.launch();
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  pageA.on("pageerror", (e) => console.log("  [PAGE ERROR A] " + e.message));
  pageB.on("pageerror", (e) => console.log("  [PAGE ERROR B] " + e.message));

  try {
    await enableEmulatorFlag(pageA);
    await enableEmulatorFlag(pageB);

    await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await pageA.click("#btn-midnight-create");
    await pageA.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: WAIT });
    const gameUrl = pageA.url();
    await pageB.goto(gameUrl, { waitUntil: "networkidle" });
    await pageB.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: WAIT });

    await joinLobby(pageA, "1234");
    await joinLobby(pageB, "5678");
    await click(pageA, "#btn-midnight-lobby-ready");
    await click(pageB, "#btn-midnight-lobby-ready");
    await pageA.waitForFunction(() => !!window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 25000 });
    await pageB.waitForFunction(() => !!window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 25000 });

    const slots = await pageA.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return Object.keys(s.players || {});
    });
    const pointId = await setupEncounter(pageA, slots);
    await moveTo(pageA, pointId);
    await moveTo(pageB, pointId);
    const encOk = await pageA.evaluate(() => !!window.PriTestMidnight._debugState().activeEncounter);
    assert(encOk, "戰鬥已建立（真實敵人 rat_basilisk/big_rats、2 個席位）");

    // ---------------------------------------------------------------- ①妖刀
    console.log("\n=== ① 妖刀的主動釋放窗口 ===");
    await pageA.evaluate(() => window.PriTestMidnight._debugSetTypeAndLevel("executor", 3));
    await pageA.waitForTimeout(600);

    const baseEntry = await pageA.evaluate(() => window.PriTestMidnight._debugCharacterAbilityEntry("skill"));
    assert(baseEntry.abilityId === "yoto", "未習得遺物時，技能就是基礎「妖刀」", "id=" + baseEntry.abilityId);
    assert(
      (baseEntry.variants || []).length === 0,
      "未習得遺物時沒有可切換的變體（＝沒有主動釋放窗口，只能當特殊防禦用）",
      "variants=" + JSON.stringify(baseEntry.variants)
    );

    // 妖刀解放・攻：消耗蓄積 1
    const learnedAtk = await pageA.evaluate(() => window.PriTestMidnight._debugLearnRelicByVariantId("yoto_release_action"));
    assert(!!learnedAtk, "可以習得遺物效果「妖刀解放・攻」", "key=" + learnedAtk);
    await pageA.waitForTimeout(500);
    const withAtk = await pageA.evaluate(() => window.PriTestMidnight._debugCharacterAbilityEntry("skill"));
    assert(
      (withAtk.variants || []).indexOf("yoto_release_action") !== -1,
      "習得後技能欄出現「妖刀（妖刀解放・攻）」變體",
      JSON.stringify(withAtk.variants)
    );
    await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      const e = M._debugCharacterAbilityEntry("skill");
      M._debugSetSkillVariantIndex(e.variants.indexOf("yoto_release_action") + 1);
    });
    await pageA.waitForTimeout(400);
    const selected = await pageA.evaluate(() => window.PriTestMidnight._debugCharacterAbilityEntry("skill"));
    assert(selected.abilityId === "yoto_release_action", "切換後技能鍵指向解放・攻", "id=" + selected.abilityId);

    // 蓄積 0：擋下、不扣蓄積
    await setYotoCharges(pageA, 0);
    await pageA.waitForTimeout(500);
    let hp0 = await pageA.evaluate((p) => window.PriTestMidnight._debugState().fieldEnemyHp[p], pointId);
    await pageA.evaluate(() => {
      window.PriTestMidnight._debugResetMyAbilityCooldowns();
      window.PriTestMidnight._debugUseCharacterAbility("skill");
    });
    await pageA.waitForTimeout(1200);
    let hp1 = await pageA.evaluate((p) => window.PriTestMidnight._debugState().fieldEnemyHp[p], pointId);
    assert(hp1 === hp0, "妖刀蓄積不足（0）時解放被擋下，敵人沒有受傷", hp0 + " → " + hp1);

    // 蓄積 1：可用，扣 1
    await setYotoCharges(pageA, 1);
    await pageA.waitForTimeout(500);
    hp0 = await pageA.evaluate((p) => window.PriTestMidnight._debugState().fieldEnemyHp[p], pointId);
    await pageA.evaluate(() => {
      window.PriTestMidnight._debugResetMyAbilityCooldowns();
      window.PriTestMidnight._debugUseCharacterAbility("skill");
    });
    await pageA.waitForTimeout(1400);
    hp1 = await pageA.evaluate((p) => window.PriTestMidnight._debugState().fieldEnemyHp[p], pointId);
    let charges = await pageA.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return s.characters[s.myTokenId]._yotoCharges || 0;
    });
    assert(hp1 < hp0, "解放・攻：蓄積足夠時對敵人造成傷害", hp0 + " → " + hp1);
    assert(charges === 0, "解放・攻：消耗妖刀蓄積 1（1 → 0）", "charges=" + charges);

    // 妖刀解放・癒：消耗蓄積 2、額外回 HP。
    // 注意這兩個解放**不屬於同一個角色**：解放・攻在「執行者」(executor) 的遺物表，
    // 解放・癒在「執行者（暗黑）」(executor_dark) 的遺物表（見 character_types.js）。
    // 第一版用 executor 去習得解放・癒，_debugLearnRelicByVariantId() 回 null——那不是
    // 程式漏接，是我挑錯角色。
    await pageA.evaluate(() => window.PriTestMidnight._debugSetTypeAndLevel("executor_dark", 3));
    await pageA.waitForTimeout(600);
    const learnedHeal = await pageA.evaluate(() => window.PriTestMidnight._debugLearnRelicByVariantId("yoto_release_heal_action"));
    assert(!!learnedHeal, "可以在執行者（暗黑）習得遺物效果「妖刀解放・癒」", "key=" + learnedHeal);
    await pageA.waitForTimeout(500);
    await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      const e = M._debugCharacterAbilityEntry("skill");
      M._debugSetSkillVariantIndex(e.variants.indexOf("yoto_release_heal_action") + 1);
    });
    await pageA.waitForTimeout(400);

    // 蓄積 1（不足 2）：擋下
    await setYotoCharges(pageA, 1);
    await pageA.waitForTimeout(500);
    hp0 = await pageA.evaluate((p) => window.PriTestMidnight._debugState().fieldEnemyHp[p], pointId);
    await pageA.evaluate(() => {
      window.PriTestMidnight._debugResetMyAbilityCooldowns();
      window.PriTestMidnight._debugUseCharacterAbility("skill");
    });
    await pageA.waitForTimeout(1200);
    hp1 = await pageA.evaluate((p) => window.PriTestMidnight._debugState().fieldEnemyHp[p], pointId);
    assert(hp1 === hp0, "解放・癒：蓄積只有 1（需要 2）時被擋下", hp0 + " → " + hp1);

    // 蓄積 2：可用，扣 2，並且自己回血
    await setYotoCharges(pageA, 2);
    await pageA.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      // 先把自己打傷，回復才看得出來（滿血時 HP 回復會被上限夾住）。
      return window.PriTestGameStorage.rtSet(s.gameId, "cloud", "demoStat/" + s.myTokenId, 50);
    });
    await pageA.waitForTimeout(900);
    hp0 = await pageA.evaluate((p) => window.PriTestMidnight._debugState().fieldEnemyHp[p], pointId);
    const selfBefore = await pageA.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return s.demoStats[s.myTokenId];
    });
    await pageA.evaluate(() => {
      window.PriTestMidnight._debugResetMyAbilityCooldowns();
      window.PriTestMidnight._debugUseCharacterAbility("skill");
    });
    await pageA.waitForTimeout(1600);
    hp1 = await pageA.evaluate((p) => window.PriTestMidnight._debugState().fieldEnemyHp[p], pointId);
    charges = await pageA.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return s.characters[s.myTokenId]._yotoCharges || 0;
    });
    const selfAfter = await pageA.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return s.demoStats[s.myTokenId];
    });
    assert(hp1 < hp0, "解放・癒：蓄積足夠時對敵人造成傷害", hp0 + " → " + hp1);
    assert(charges === 0, "解放・癒：消耗妖刀蓄積 2（2 → 0）", "charges=" + charges);
    assert(selfAfter > selfBefore, "解放・癒：自身「HP回復：□×5」生效", selfBefore + " → " + selfAfter);

    // ------------------------------------------------------------- ②爪擊
    console.log("\n=== ② 爪擊：兩邊效果一起執行（2026-09-23 規格） ===");
    await pageA.evaluate(() => window.PriTestMidnight._debugSetTypeAndLevel("tracker", 3));
    await pageA.waitForTimeout(600);
    const clawEntry = await pageA.evaluate(() => window.PriTestMidnight._debugCharacterAbilityEntry("skill"));
    assert(clawEntry.abilityId === "claw_shot", "追蹤者技能是爪擊", "id=" + clawEntry.abilityId);

    // B 進入瀕死，當作復歸傷害的對象。
    await pageB.evaluate(() => window.PriTestMidnight._debugTriggerNearDeath());
    await pageB.waitForFunction(
      () => {
        const s = window.PriTestMidnight._debugState();
        const nd = s.characters[s.myTokenId] && s.characters[s.myTokenId].nearDeath;
        return !!(nd && nd.active);
      },
      { timeout: WAIT }
    );
    const bToken = await pageB.evaluate(() => window.PriTestMidnight._debugState().myTokenId);
    await pageA.waitForFunction(
      (tok) => {
        const s = window.PriTestMidnight._debugState();
        const nd = s.characters[tok] && s.characters[tok].nearDeath;
        return !!(nd && nd.active);
      },
      bToken,
      { timeout: WAIT }
    );

    // 前面妖刀那幾發已經把 Guard 削減累到一半，直接量增量會看不清楚。先把這個點的
    // guard 相關欄位歸零，爪擊的 ▲ 才是唯一來源。
    await pageA.evaluate((p) => {
      const s = window.PriTestMidnight._debugState();
      const GS = window.PriTestGameStorage;
      return Promise.all([
        GS.rtSet(s.gameId, "cloud", "fieldTrigger/" + p + "/guardUnits", 0),
        GS.rtSet(s.gameId, "cloud", "fieldTrigger/" + p + "/guardBrokenAt", null),
        GS.rtSet(s.gameId, "cloud", "fieldTrigger/" + p + "/everGuardBroken", null),
      ]);
    }, pointId);
    await pageA.waitForFunction(
      (p) => (window.PriTestMidnight._debugState().fieldTriggers[p] || {}).guardUnits === 0,
      pointId,
      { timeout: 8000 }
    ).catch(() => {});

    const before = await pageA.evaluate(
      ({ p, tok }) => {
        const s = window.PriTestMidnight._debugState();
        const t = s.fieldTriggers[p] || {};
        const nd = s.characters[tok].nearDeath;
        return { guardUnits: t.guardUnits || 0, guardBrokenAt: t.guardBrokenAt || null, progress: nd.progress || 0 };
      },
      { p: pointId, tok: bToken }
    );

    await pageA.evaluate(() => {
      window.PriTestMidnight._debugResetMyAbilityCooldowns();
      window.PriTestMidnight._debugUseCharacterAbility("skill");
    });
    await pageA.waitForTimeout(1800);

    const after = await pageA.evaluate(
      ({ p, tok }) => {
        const s = window.PriTestMidnight._debugState();
        const t = s.fieldTriggers[p] || {};
        const nd = s.characters[tok].nearDeath;
        return { guardUnits: t.guardUnits || 0, guardBrokenAt: t.guardBrokenAt || null, progress: nd ? nd.progress || 0 : null };
      },
      { p: pointId, tok: bToken }
    );

    // ▲＝1 unit（見 recordGuardReductionForPoint()：◆=2、▲=1），所以乾淨狀態下打一次
    // 應該正好 +1。體崩加速倍率只在敵人HP 40~60% 時生效，這裡敵人幾乎滿血，不受影響。
    assert(
      after.guardUnits - before.guardUnits === 1,
      "爪擊：對敵人累積 Guard 削減（▲＝1 unit）",
      "guardUnits " + before.guardUnits + " → " + after.guardUnits
    );
    assert(
      after.progress > before.progress,
      "爪擊：對倒地隊友施加【復歸傷害：40】",
      "progress " + before.progress + " → " + after.progress
    );
    assert(
      after.progress - before.progress === 40,
      "爪擊：復歸傷害數值＝本文的 40（不硬編，來自 parseFixedRevivalDamageValue）",
      "delta=" + (after.progress - before.progress)
    );
  } catch (e) {
    console.log("\n[EXCEPTION] " + (e && e.stack ? e.stack : e));
    results.push({ label: "腳本執行中發生例外", pass: false });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n" + "=".repeat(50));
  console.log(results.length - failed.length + " / " + results.length + " 通過");
  if (failed.length) {
    failed.forEach((f) => console.log("  FAIL: " + f.label));
    process.exit(1);
  }
  console.log("全部通過");
})();
