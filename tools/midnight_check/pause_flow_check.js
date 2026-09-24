// ============================================================================
// Playwright 回歸測試：2026-09-23 暫停閘門修正的實機驗證。
// ============================================================================
// 驗證對象（全部是這次補上 isPaused() 閘門＋暫停平移的項目）：
//   T1 瀕死15秒倒數      updateNearDeathState()
//   T2 聖杯瓶讀取         updateFlaskReading()
//   T3 長按詠唱           updateSorceryHold()
//   T4 六個計時的平移量   shiftMyTimestampsAfterPause()
//   T5 召喚靈體的自動攻擊 updateSummonedSpirit()   ← 需要真的戰鬥，見下方說明
//   T6 架盾詞條的周圍攻擊 updateAffixGuardHold()
//
// T1〜T3 都是「把到期時刻縮短 → 暫停 → 空等超過該時刻 → 斷言沒有發生 → 恢復 → 斷言
// 剩餘時間被完整補回」。修正前這三項在暫停中照樣到期，T1 更會直接消耗一次流浪祝福。
//
// 走 Firebase Local Emulator（見 tools/midnight_check/emulator_sync_check.js 的說明），
// 不連正式專案、不觸發 App Check／reCAPTCHA。
//
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：
//   node pause_flow_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const WAIT = 20000;

const results = [];
function assert(cond, label, extra) {
  results.push({ label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label + (extra ? "   " + extra : ""));
}

// game_storage.js の rtdbEmulatorEnabled() が見る旗標。ページ読み込み前に仕込む。
async function enableEmulatorFlag(page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
    } catch (e) {}
  });
}

const S = (page) => page.evaluate(() => window.PriTestMidnight._debugState());

// CLAUDE.md §4.6：midnight の HUD は毎影格再描画されるので page.click() は stable 待ちで
// 詰まる。必ず dispatchEvent を使う。
const click = (page, sel) => page.dispatchEvent(sel, "click");

async function joinLobbyAndStart(page) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", "1234");
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: WAIT });
  await click(page, "#btn-midnight-lobby-ready");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: WAIT });
}

async function pauseGame(page) {
  await click(page, "#btn-midnight-pause-game");
  await page.waitForFunction(
    () => {
      const p = window.PriTestMidnight._debugState().meta.pause;
      return !!(p && p.pausedAt);
    },
    { timeout: WAIT }
  );
}

// 「繼續遊戲」を押してから RESUME_COUNTDOWN_MS(3秒) の倒數が終わり、
// maybeFinalizeResume() が meta.pause を畳んで totalPausedMs を加算するまで待つ。
// 平移（shiftMyTimestampsAfterPause）はその瞬間に走る。
async function resumeGame(page) {
  await click(page, "#btn-midnight-resume-game");
  await page.waitForFunction(
    () => {
      const p = window.PriTestMidnight._debugState().meta.pause;
      return !p || !p.pausedAt;
    },
    { timeout: WAIT }
  );
}

// 直接 seed 一個「已解決分歧、敵人存活、沒有雜兵」的 fieldTrigger，把角色瞬移過去，
// 等 BATTLE_PREP_DURATION_MS（5秒）過後 activeEncounter 生效。
// 刻意不建立 fieldMobHp——有雜兵的話 damageCombatTarget() 會先打雜兵池（fieldMobHp），
// 這裡要觀察的是 fieldEnemyHp 的變化。
async function setupEncounter(page) {
  const pointId = await page.evaluate(() => {
    const s = window.PriTestMidnight._debugState();
    // 「板塊卡牌」型的點＝NON_FIELD_POINT_TYPES 以外的 type（見 midnight.js 的
    // updateNearbyFieldPoint()）。地圖上沒有 type:"field"，這裡要用排除法挑。
    const NON_FIELD = { sorcerer: 1, merchant: 1, strong_enemy: 1, random_event: 1, blessing: 1 };
    const pt = (s.map.points || []).filter((p) => !NON_FIELD[p.type])[0];
    if (!pt) return null;
    const participants = {};
    participants[s.mySlot] = true;
    window.PriTestMidnight._debugSetLocalPos(pt.x + 0.5, pt.y + 0.5);
    return window.PriTestGameStorage.rtSet(s.gameId, "cloud", "fieldTrigger/" + pt.id, {
      status: "resolved",
      participants: participants,
      branchIndex: 0,
      floorIndex: 0,
      level: 1,
      enemyFamilyId: "test",
      enemyId: "test",
    })
      .then(() => window.PriTestGameStorage.rtSet(s.gameId, "cloud", "fieldEnemyHp/" + pt.id, 100000))
      .then(() => pt.id);
  });
  await page
    .waitForFunction(() => !!window.PriTestMidnight._debugState().activeEncounter, { timeout: 20000 })
    .catch(() => {});
  const st = await page.evaluate(() => window.PriTestMidnight._debugState());
  return { pointId, activeEncounter: st.activeEncounter };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  [PAGE ERROR] " + e.message));

  try {
    await enableEmulatorFlag(page);

    console.log("=== 開局（emulator） ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: WAIT });
    await joinLobbyAndStart(page);
    console.log("game URL:", page.url());

    // ------------------------------------------------------------------
    // T1 瀕死倒數
    // ------------------------------------------------------------------
    console.log("\n=== T1 瀕死倒數在暫停中凍結 ===");
    await page.evaluate(() => window.PriTestMidnight._debugTriggerNearDeath());
    await page.waitForFunction(
      () => {
        const s = window.PriTestMidnight._debugState();
        const nd = s.characters[s.myTokenId] && s.characters[s.myTokenId].nearDeath;
        return !!(nd && nd.active);
      },
      { timeout: WAIT }
    );
    // 15秒まるごと待つと遅いので、deadlineAt を 4 秒後に縮める（RTDB 経由＝本番と同じ経路）。
    await page.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return window.PriTestGameStorage.rtSet(
        s.gameId,
        "cloud",
        "character/" + s.myTokenId + "/nearDeath/deadlineAt",
        Date.now() + 4000
      );
    });
    await page.waitForFunction(
      () => {
        const s = window.PriTestMidnight._debugState();
        const nd = s.characters[s.myTokenId].nearDeath;
        return nd && nd.deadlineAt - Date.now() < 5000;
      },
      { timeout: WAIT }
    );

    await pauseGame(page);
    console.log("  暫停中，空等 6 秒（deadline 只剩約 4 秒＝修正前必定逾時）…");
    await page.waitForTimeout(6000);

    let st = await S(page);
    let nd = st.characters[st.myTokenId].nearDeath;
    assert(!!(nd && nd.active), "暫停中：仍然維持瀕死（沒有被強制復歸）");
    assert(!!(nd && !nd.timedOut), "暫停中：nearDeath.timedOut 沒有被標記");
    assert(!st.meta.gameFailurePending, "暫停中：沒有觸發遊戲失敗（流浪祝福沒有被消耗）");
    const overdueMs = Date.now() - (nd ? nd.deadlineAt : 0);
    assert(overdueMs > 0, "（前提確認）暫停期間確實已經越過原本的 deadline", "超過 " + overdueMs + "ms");

    await resumeGame(page);
    st = await S(page);
    nd = st.characters[st.myTokenId].nearDeath;
    const remainAfter = nd ? nd.deadlineAt - Date.now() : -1;
    assert(!!(nd && nd.active), "恢復後：瀕死仍在（沒有在恢復瞬間被一次補發）");
    assert(remainAfter > 1500, "恢復後：剩餘倒數被完整補回", "剩餘 " + remainAfter + "ms");

    // 後片付け：この先のテストに瀕死の行動制限を持ち込まない。
    await page.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return window.PriTestGameStorage.rtSet(s.gameId, "cloud", "character/" + s.myTokenId + "/nearDeath", null);
    });
    await page.waitForFunction(
      () => {
        const s = window.PriTestMidnight._debugState();
        const n = s.characters[s.myTokenId].nearDeath;
        return !n || !n.active;
      },
      { timeout: WAIT }
    );

    // ------------------------------------------------------------------
    // T2 聖杯瓶讀取（FLASK_READ_MS = 1000）
    // ------------------------------------------------------------------
    console.log("\n=== T2 聖杯瓶讀取在暫停中凍結 ===");
    await pauseGame(page);
    await page.evaluate(() => window.PriTestMidnight._debugSetFlaskReading(true));
    const flaskBefore = (await S(page)).flaskReadingUntil;
    await page.waitForTimeout(2500); // FLASK_READ_MS の 2 倍以上
    st = await S(page);
    assert(st.flaskReadingUntil !== null, "暫停中：讀取沒有結算（flaskReadingUntil 仍存在）");
    assert(st.flaskReadingUntil === flaskBefore, "暫停中：到期時刻沒有被動過");
    await resumeGame(page);
    st = await S(page);
    // 恢復直後は「平移されて再び未来にある」か、平移後の残り(約1秒)を待って結算済みか。
    // 平移が効いていれば、恢復の瞬間には必ずまだ未来にある。
    assert(
      st.flaskReadingUntil === null || st.flaskReadingUntil > flaskBefore,
      "恢復後：到期時刻被往後平移（不是用暫停前的舊值立刻結算）",
      "before=" + flaskBefore + " after=" + st.flaskReadingUntil
    );

    // ------------------------------------------------------------------
    // T3 長按詠唱（SORCERY_CAST_HOLD_MS = 2000）
    // ------------------------------------------------------------------
    console.log("\n=== T3 長按詠唱在暫停中不成立 ===");
    await pauseGame(page);
    await page.evaluate(() => window.PriTestMidnight._debugSetSorceryHold("R", true));
    const holdBefore = (await S(page)).sorceryHoldState.R;
    await page.waitForTimeout(3500); // SORCERY_CAST_HOLD_MS を超える
    st = await S(page);
    assert(st.sorceryHoldState.R !== undefined, "暫停中：長按沒有成立（key 還留在 sorceryHoldState）");
    assert(st.sorceryHoldState.R === holdBefore, "暫停中：長按起點沒有被動過");
    await resumeGame(page);
    st = await S(page);
    assert(
      st.sorceryHoldState.R === undefined || st.sorceryHoldState.R > holdBefore,
      "恢復後：長按起點被往後平移（進度在暫停中凍結）",
      "before=" + holdBefore + " after=" + st.sorceryHoldState.R
    );
    await page.evaluate(() => window.PriTestMidnight._debugSetSorceryHold("R", false));

    // ------------------------------------------------------------------
    // T4 平移量本身（六個計時，直接呼叫 shiftMyTimestampsAfterPause）
    // ------------------------------------------------------------------
    console.log("\n=== T4 shiftMyTimestampsAfterPause() 涵蓋六個計時 ===");
    const shift = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      const now = Date.now();
      const DELTA = 5000;
      const pausedAt = now - 1000; // 「1秒前に暫停が始まった」体で平移する

      // 六つとも「暫停開始より後に期限が来る／暫停開始より前に始まっている」状態を作る。
      c.nearDeath = { active: true, downedAt: now - 500, deadlineAt: now + 3000, progress: 0, required: 100 };
      c.summonedSpirit = { kind: "helen", hp: 10, maxHp: 10, dmg: 1, nextAttackAt: now + 2000 };
      M._debugSetFlaskReading(true);
      M._debugSetSorceryHold("R", true);
      M._debugSetBlockHolding(true);

      const before = {
        nearDeath: c.nearDeath.deadlineAt,
        spirit: c.summonedSpirit.nextAttackAt,
        flask: M._debugState().flaskReadingUntil,
        sorcery: M._debugState().sorceryHoldState.R,
      };
      M._debugShiftMyTimestampsAfterPause(pausedAt, DELTA);
      const after = {
        nearDeath: c.nearDeath.deadlineAt,
        spirit: c.summonedSpirit.nextAttackAt,
        flask: M._debugState().flaskReadingUntil,
        sorcery: M._debugState().sorceryHoldState.R,
      };

      // 後片付け
      c.nearDeath = null;
      c.summonedSpirit = null;
      M._debugSetFlaskReading(false);
      M._debugSetSorceryHold("R", false);
      M._debugSetBlockHolding(false);
      return { before, after, DELTA };
    });
    ["nearDeath", "spirit", "flask", "sorcery"].forEach((k) => {
      const d = shift.after[k] - shift.before[k];
      assert(d === shift.DELTA, "平移 " + k + " 正好 +" + shift.DELTA + "ms", "實際 +" + d + "ms");
    });

    // ------------------------------------------------------------------
    // T5 召喚靈體（SPIRIT_ATTACK_INTERVAL_MS = 6000）
    // ------------------------------------------------------------------
    // 靈體要有 activeEncounter 才會攻擊，所以這一段要先造一場真的戰鬥：
    // 直接 seed 一個「已解決分歧、敵人存活」的 fieldTrigger（沿用 emulator_sync_check.js
    // 既有作法，跳過邀請/打字機/投票那些不是這次驗證目標的 UI 流程），把角色瞬移到該點，
    // 等過了 BATTLE_PREP_DURATION_MS（5秒識別資訊準備）activeEncounter 才會生效。
    console.log("\n=== T5 召喚靈體在暫停中不攻擊 ===");
    const encounter = await setupEncounter(page);
    assert(!!encounter.activeEncounter, "戰鬥已建立（activeEncounter 生效）", "point=" + encounter.pointId);

    if (encounter.activeEncounter) {
      // 復仇者 Lv3：技能＝召喚靈體（skills[0].id === "spirit_summon"，習得等級2）。
      await page.evaluate(() => window.PriTestMidnight._debugSetTypeAndLevel("avenger", 3));
      await page.evaluate(() => window.PriTestMidnight._debugResetMyAbilityCooldowns());
      await page.evaluate(() => window.PriTestMidnight._debugSpiritChoice("sebastian"));
      await page.waitForFunction(
        () => {
          const s = window.PriTestMidnight._debugState();
          const sp = s.characters[s.myTokenId].summonedSpirit;
          return !!(sp && sp.hp > 0);
        },
        { timeout: WAIT }
      );
      const spiritNow = await page.evaluate(() => {
        const s = window.PriTestMidnight._debugState();
        return s.characters[s.myTokenId].summonedSpirit;
      });
      assert(spiritNow.kind === "sebastian", "召喚到指定的靈體", "kind=" + spiritNow.kind + " hp=" + spiritNow.hp + " dmg=" + spiritNow.dmg);

      await pauseGame(page);
      let snap = await S(page);
      const hpBeforePause = snap.fieldEnemyHp[encounter.pointId];
      const nextAtBeforePause = snap.characters[snap.myTokenId].summonedSpirit.nextAttackAt;
      console.log("  暫停中，空等 9 秒（攻擊間隔 6 秒＝修正前至少打 1 次）…");
      await page.waitForTimeout(9000);

      snap = await S(page);
      const spiritPaused = snap.characters[snap.myTokenId].summonedSpirit;
      assert(
        snap.fieldEnemyHp[encounter.pointId] === hpBeforePause,
        "暫停中：靈體沒有攻擊（敵人HP完全沒變）",
        "HP " + hpBeforePause + " → " + snap.fieldEnemyHp[encounter.pointId]
      );
      assert(spiritPaused.nextAttackAt === nextAtBeforePause, "暫停中：下次攻擊時刻沒有被動過");
      assert(Date.now() > nextAtBeforePause, "（前提確認）暫停期間確實已經越過原本的攻擊時刻");

      await resumeGame(page);
      snap = await S(page);
      const spiritResumed = snap.characters[snap.myTokenId].summonedSpirit;
      assert(
        spiritResumed.nextAttackAt > nextAtBeforePause,
        "恢復後：下次攻擊時刻被往後平移（不是在恢復瞬間連打補發）",
        "before=" + nextAtBeforePause + " after=" + spiritResumed.nextAttackAt
      );

      // 反面確認：閘門沒有把正常運作也一起擋掉——不暫停時靈體照樣打。
      const hpBeforeNormal = (await S(page)).fieldEnemyHp[encounter.pointId];
      console.log("  未暫停，等一個攻擊間隔…");
      await page
        .waitForFunction(
          ({ pointId, hp }) => window.PriTestMidnight._debugState().fieldEnemyHp[pointId] < hp,
          { pointId: encounter.pointId, hp: hpBeforeNormal },
          { timeout: 15000 }
        )
        .catch(() => {});
      const hpAfterNormal = (await S(page)).fieldEnemyHp[encounter.pointId];
      assert(hpAfterNormal < hpBeforeNormal, "未暫停時：靈體照常攻擊（敵人HP下降）", hpBeforeNormal + " → " + hpAfterNormal);

      // ----------------------------------------------------------------
      // T6 架盾詞條的周圍攻擊（AFFIX_GUARD_HOLD_TRIGGER_MS = 3000）
      // ----------------------------------------------------------------
      // _debugRunAffixGuardHold(heldMs) 會直接呼叫 updateAffixGuardHold()，所以暫停閘門
      // 有沒有生效可以不用等真實時間，一次呼叫就看得出來。
      console.log("\n=== T6 架盾詞條在暫停中不發動 ===");
      // 詞條「walkBurn」的傷害＝威力補正 intelligence（見 AFFIX_WALK_ATTACKS／
      // affixPowerModDamage()）。復仇者的 intelligence 是 0，打出來會是 0 傷害＝什麼都
      // 觀察不到，所以先換成 intelligence 有值的隱者（hermit, int=10）。
      await page.evaluate(() => window.PriTestMidnight._debugSetTypeAndLevel("hermit", 3));
      await page.evaluate(() => {
        const s = window.PriTestMidnight._debugState();
        return window.PriTestGameStorage.rtSet(s.gameId, "cloud", "meta/weaponAffixes", true);
      });
      await page.waitForFunction(() => !!window.PriTestMidnight._debugState().meta.weaponAffixes, { timeout: WAIT });
      await page.evaluate(() =>
        window.PriTestMidnight._debugSetWeaponAffixes("greatsword_pursuer::probeGuard", [{ id: "walkBurn", value: 1 }], { equip: true })
      );
      const riderDmg = await page.evaluate(() => window.PriTestMidnight._debugAffixRiderDamage("intelligence"));
      assert(riderDmg > 0, "（前提確認）詞條的周圍攻擊有可解算的傷害", "damage=" + riderDmg);

      // 先在未暫停狀態確認它真的會打（否則下面的「沒打」毫無意義）。
      await page.evaluate(() => window.PriTestMidnight._debugResetAffixGuardHoldCooldowns());
      const hpBeforeHold = (await S(page)).fieldEnemyHp[encounter.pointId];
      await page.evaluate(() => window.PriTestMidnight._debugRunAffixGuardHold(5000));
      await page.waitForTimeout(600);
      const hpAfterHold = (await S(page)).fieldEnemyHp[encounter.pointId];
      assert(hpAfterHold < hpBeforeHold, "未暫停時：架盾3秒的詞條攻擊確實生效", hpBeforeHold + " → " + hpAfterHold);

      await pauseGame(page);
      await page.evaluate(() => window.PriTestMidnight._debugResetAffixGuardHoldCooldowns());
      const hpBeforePausedHold = (await S(page)).fieldEnemyHp[encounter.pointId];
      await page.evaluate(() => window.PriTestMidnight._debugRunAffixGuardHold(5000));
      await page.waitForTimeout(600);
      const hpAfterPausedHold = (await S(page)).fieldEnemyHp[encounter.pointId];
      assert(
        hpAfterPausedHold === hpBeforePausedHold,
        "暫停中：架盾詞條沒有發動（敵人HP完全沒變）",
        hpBeforePausedHold + " → " + hpAfterPausedHold
      );
      await resumeGame(page);
    }
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
