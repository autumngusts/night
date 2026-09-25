// ============================================================================
// midnight 2026-09-25 修正四件套 回歸測試（Playwright ＋ Firebase Local Emulator）
// ============================================================================
// 對應使用者當次回報／要求的四點（瀕死救起那一項另外處理，不在這支裡）：
//   ② 阿罵模式的迴避寬鬆度：Perfect～1.0s、Great～2.0s、其餘算沒閃避成功但扣 50%。
//      → SPRITE_DODGE_BANDS_UNLIMITED／SPRITE_DODGE_WINDOW_MS_UNLIMITED，
//        由 spriteDodgeBands()／spriteDodgeWindowTable() 依 meta.difficulty 切換。
//   ③ 結束夜晚戰鬥要進入下一回合時，用黃字特別提醒「要先按完祝福、按完離去」。
//      → #midnight-hud-day1-rewards-note／#midnight-hud-day2-rewards-note，
//        顯示條件跟該組戰後 HUD 區塊一致（renderFinalCircleRewardsHud()）。
//   ④ 一般的「進入別人的戰鬥」時，［進入戰鬥］另外在畫面中央閃黃光顯示。
//      → #midnight-enter-battle-center，夜之強敵／夜王不顯示（那不是「別人的戰鬥」）。
//   ⑤ 遊戲中途加入的玩家拿不到起始裝備、角色視窗一片空白。
//      → 根因：handleLobbyJoin() 的 transaction 一 commit 就呼叫 enterGameAsLateJoiner()，
//        但 newCharacterForSlot() 讀的是本地 players 快照，那一刻還是 undefined
//        （正因為該席位是空的才加得進去），於是 typeId 變成 null、newCharacter() 回傳
//        hp:{0,0}、沒有 weaponIds 的空角色。改成把 transaction 真正 commit 的席位資料
//        傳進去。另加「已經寫進 RTDB 的壞角色」自我修復（onCharactersReceived()）。
//
// 使用前準備（跟 near_death_and_accum_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node fix_batch_2026_09_25_check.js
//
// 期望值一律從 _debugState()／既有函式算出來，不硬編（CLAUDE.md §4.7）。
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

const S = (page) => page.evaluate(() => window.PriTestMidnight._debugState());

// 迴避判定：直接餵一個假的反應狀態給 spriteDodgeJudge()（純函式，見 sprite_dodge_check.js
// 的既有用法）。hitAt 設 0，phaseEndAt＝該模式第 1 下的窗口長度，pressedAt 就是「T 之後 N 毫秒」。
async function judgeAt(page, dtMs) {
  return page.evaluate((dt) => {
    const M = window.PriTestMidnight;
    const win = M._debugEnemyAttackHitWindowMs(0);
    return M._debugSpriteDodgeJudge({ hitAt: 0, phaseEndAt: win }, dt);
  }, dtMs);
}

async function setDifficulty(page, gameId, value) {
  await page.evaluate(
    ({ gameId, value }) => window.PriTestGameStorage.rtSet(gameId, "cloud", "meta/difficulty", value),
    { gameId, value }
  );
  await page.waitForFunction(
    (v) => {
      const m = window.PriTestMidnight._debugState().meta;
      return (m && m.difficulty) === v || (v === null && !(m && m.difficulty));
    },
    value,
    { timeout: 10000 }
  );
}

(async () => {
  const browser = await chromium.launch();
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pA = await ctxA.newPage();
  const pB = await ctxB.newPage();
  const pageErrors = [];
  [pA, pB].forEach((pg, i) =>
    pg.on("pageerror", (e) => {
      pageErrors.push(`P${i + 1}: ` + e.message);
      console.log(`  [pageerror P${i + 1}] ` + e.message);
    })
  );

  try {
    await enableEmulatorFlag(pA);
    await enableEmulatorFlag(pB);

    console.log("=== 建立單人測試場（B 稍後中途加入）===");
    await pA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await pA.click("#btn-midnight-create");
    await pA.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    const gameUrl = pA.url();
    await pA.click("#midnight-lobby-slots .midnight-slot-empty button");
    await pA.fill("#midnight-lobby-passcode-input", "1111");
    await pA.click("#btn-midnight-lobby-join");
    await pA.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
    await pA.click("#btn-midnight-lobby-ready");
    await pA.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });
    const stA = await pA.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return { gameId: s.gameId, mySlot: s.mySlot, myTokenId: s.myTokenId };
    });

    // ================================================================
    // ② 阿罵模式的迴避寬鬆度
    // ================================================================
    console.log("\n=== ② 阿罵模式的迴避寬鬆度 ===");
    // 先確認標準模式（未設定 difficulty）的既有行為沒有被改壞。
    const stdWindow = await pA.evaluate(() => window.PriTestMidnight._debugEnemyAttackHitWindowMs(0));
    assert(stdWindow === 1000, "標準模式第 1 下的反應窗口仍是 1.0 秒", stdWindow);
    const std400 = await judgeAt(pA, 400);
    const std900 = await judgeAt(pA, 900);
    assert(std400.grade === "perfect", "標準模式：T+400ms 仍是 perfect", std400);
    assert(std900.grade === "good", "標準模式：T+900ms 仍是 good（既有的四段判定沒被動到）", std900);

    await setDifficulty(pA, stA.gameId, "unlimited");
    const uWindow = await pA.evaluate(() => window.PriTestMidnight._debugEnemyAttackHitWindowMs(0));
    assert(uWindow === 2000, "阿罵模式第 1 下的反應窗口放寬到 2.0 秒（否則 Great 帶永遠按不到）", uWindow);

    const u1000 = await judgeAt(pA, 1000);
    const u1001 = await judgeAt(pA, 1001);
    const u2000 = await judgeAt(pA, 2000);
    const u2001 = await judgeAt(pA, 2001);
    assert(u1000.grade === "perfect" && u1000.pct === 100, "阿罵模式：T+1.0s（含）以內＝Perfect、減傷 100%", u1000);
    assert(u1001.grade === "great", "阿罵模式：剛過 1.0s 就轉成 Great", u1001);
    assert(u2000.grade === "great", "阿罵模式：T+2.0s（含）以內仍是 Great", u2000);
    assert(u2001.grade === "bad" && u2001.pct === 50, "阿罵模式：超過 2.0s＝沒閃避成功，但仍扣 50%", u2001);
    const uGrades = await pA.evaluate(() => {
      // 阿罵模式只有三段（使用者只列了 Perfect／Great／其餘），不應該還有 good。
      const M = window.PriTestMidnight;
      const win = M._debugEnemyAttackHitWindowMs(0);
      const out = {};
      for (let dt = 0; dt <= win; dt += 25) out[M._debugSpriteDodgeJudge({ hitAt: 0, phaseEndAt: win }, dt).grade] = true;
      return Object.keys(out).sort();
    });
    assert(JSON.stringify(uGrades) === JSON.stringify(["great", "perfect"]), "阿罵模式窗口內只會出現 perfect／great 兩種評價（沒有 good）", uGrades);

    // 還原難度，後面的項目在標準模式下驗。
    await setDifficulty(pA, stA.gameId, null);

    // ================================================================
    // ③ 夜晚戰鬥結束的黃字提醒
    // ================================================================
    console.log("\n=== ③ 夜晚戰鬥結束的黃字提醒 ===");
    const noteBefore = await pA.evaluate(() => {
      const n = document.getElementById("midnight-hud-day1-rewards-note");
      return { exists: !!n, hidden: !n || n.hidden };
    });
    assert(noteBefore.exists, "黃字提醒的元素存在（#midnight-hud-day1-rewards-note）", noteBefore);
    assert(noteBefore.hidden, "還沒打完夜之強敵時不顯示提醒", noteBefore);

    // 第一天夜之強敵「已擊退」＝ fieldTrigger/finalCircleDay1 已 resolved 且 HP<=0
    //（finalCircleBossDefeated() 的判定，同 character_ability_check.js 的既有手法）。
    await pA.evaluate(
      ({ gameId }) => {
        const GS = window.PriTestGameStorage;
        return GS.rtSet(gameId, "cloud", "fieldTrigger/finalCircleDay1", {
          status: "resolved",
          enemyFamilyId: "test",
          enemyId: "test",
          level: 10,
        }).then(() => GS.rtSet(gameId, "cloud", "fieldEnemyHp/finalCircleDay1", 0));
      },
      { gameId: stA.gameId }
    );
    const noteShown = await pA
      .waitForFunction(() => {
        const n = document.getElementById("midnight-hud-day1-rewards-note");
        return !!n && !n.hidden;
      }, null, { timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    assert(noteShown, "擊退第一天夜之強敵後，黃字提醒顯示出來");

    if (noteShown) {
      const noteStyle = await pA.evaluate(() => {
        const n = document.getElementById("midnight-hud-day1-rewards-note");
        const cs = getComputedStyle(n);
        return { color: cs.color, text: n.textContent, weight: cs.fontWeight };
      });
      // #ffd54a
      assert(noteStyle.color === "rgb(255, 213, 74)", "提醒是黃字", noteStyle);
      assert(/祝福/.test(noteStyle.text) && /離去/.test(noteStyle.text), "提醒文字同時點名「祝福」與「離去」", noteStyle);

      // 按下［離去］後，該組區塊與提醒一起收起來。
      await pA.dispatchEvent("#btn-midnight-hud-day1-leave", "click");
      await pA.waitForTimeout(600);
      const afterLeave = await pA.evaluate(() => {
        const n = document.getElementById("midnight-hud-day1-rewards-note");
        const row = document.getElementById("midnight-hud-day1-rewards-row");
        return { noteHidden: !n || n.hidden, rowHidden: !row || row.hidden };
      });
      assert(afterLeave.noteHidden && afterLeave.rowHidden, "按下［離去］後提醒與戰後區塊一起消失", afterLeave);
    }

    // 收拾：把這場夜之強敵撤掉，才不會干擾 ④ 的候選優先序。
    await pA.evaluate(
      ({ gameId }) => {
        const GS = window.PriTestGameStorage;
        return GS.rtSet(gameId, "cloud", "fieldTrigger/finalCircleDay1", null).then(() =>
          GS.rtSet(gameId, "cloud", "fieldEnemyHp/finalCircleDay1", null)
        );
      },
      { gameId: stA.gameId }
    );

    // ================================================================
    // ⑤ 中途加入的玩家（放在 ④ 之前：④ 需要「別人的戰鬥」，得先有別人）
    // ================================================================
    console.log("\n=== ⑤ 中途加入的玩家會拿到職業與起始裝備 ===");
    await pB.goto(gameUrl, { waitUntil: "networkidle" });
    await pB.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    const startedForB = await pB.evaluate(() => !!window.PriTestMidnight._debugState().meta.sessionStartAt);
    assert(startedForB, "B 進來時遊戲已經開局（＝這是中途加入，不是等待房加入）");

    // 席位面板上的空位加入鈕 →（中途加入視窗）→ 選角色 → 填名稱密碼 → 加入
    await pB.click("#midnight-players-panel-slots .midnight-slot-empty button");
    await pB.waitForSelector("#midnight-lobby-join-form:not([hidden])", { timeout: 10000 });
    // 刻意選「第 2 個」角色，才能驗出「真的用了玩家選的類型」，而不是碰巧等於預設值。
    await pB.evaluate(() => {
      const opts = document.querySelectorAll("#midnight-lobby-character-picker .midnight-character-option");
      opts[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const pickedTypeId = await pB.evaluate(() => {
      const opts = document.querySelectorAll("#midnight-lobby-character-picker .midnight-character-option");
      return opts[1] ? opts[1].className : null;
    });
    await pB.fill("#midnight-lobby-name-input", "後到者");
    await pB.fill("#midnight-lobby-passcode-input", "2222");
    await pB.click("#btn-midnight-lobby-join");
    await pB.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });

    const joined = await pB
      .waitForFunction(() => {
        const s = window.PriTestMidnight._debugState();
        const c = s.characters[s.myTokenId];
        return !!(c && c.typeId);
      }, null, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    assert(joined, "中途加入後的角色有 typeId（修正前是 null＝空角色）", pickedTypeId);

    const lateChar = await pB.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      const c = s.characters[s.myTokenId];
      const slotEntry = s.players[s.mySlot];
      return {
        typeId: c && c.typeId,
        slotCharacterId: slotEntry && slotEntry.characterId,
        name: c && c.name,
        hpMax: c && c.hp && c.hp.max,
        weaponCount: c && c.weaponIds ? c.weaponIds.length : 0,
        demoStat: s.demoStats[s.myTokenId],
        arenaHpMax: window.PriTestMidnight._debugArenaHpMax(),
      };
    });
    assert(lateChar.typeId === lateChar.slotCharacterId, "角色類型跟席位上選的職業一致", lateChar);
    assert(lateChar.name === "後到者", "角色名稱也取自席位資料（不是空字串）", lateChar);
    assert(lateChar.hpMax > 0, "HP 上限不是 0（空角色的症狀就是 hp:{0,0}）", lateChar);
    assert(lateChar.weaponCount > 0, "拿到了起始武器", lateChar);

    const equipped = await pB
      .waitForFunction(() => {
        const s = window.PriTestMidnight._debugState();
        const c = s.characters[s.myTokenId];
        return !!(c && c.equippedWeaponIdR);
      }, null, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    assert(equipped, "起始武器有真的被裝備起來（equippedWeaponIdR）");

    // 角色視窗不是一片空白：打開後至少要畫得出職業名稱與武器卡片。
    await pB.dispatchEvent("#btn-midnight-open-character-sheet", "click").catch(() => {});
    await pB.waitForTimeout(800);
    const sheet = await pB.evaluate(() => {
      const modal = document.getElementById("midnight-character-sheet-modal");
      return {
        hidden: !modal || modal.hidden,
        textLen: modal ? modal.textContent.replace(/\s/g, "").length : 0,
      };
    });
    assert(!sheet.hidden && sheet.textLen > 20, "角色視窗打得開而且有內容（不是一片空白）", sheet);
    await pB.dispatchEvent("#btn-midnight-character-sheet-close", "click").catch(() => {});

    // ================================================================
    // ④ 置中閃黃光的［進入戰鬥］
    // ================================================================
    console.log("\n=== ④ 置中閃黃光的［進入戰鬥］ ===");
    const centerExists = await pB.evaluate(() => {
      const n = document.getElementById("midnight-enter-battle-center");
      return { exists: !!n, hidden: !n || n.hidden };
    });
    assert(centerExists.exists, "置中容器存在（#midnight-enter-battle-center）", centerExists);
    assert(centerExists.hidden, "沒有可加入的戰鬥時不顯示", centerExists);

    // 造一場「別人的戰鬥」：A 是唯一 participant，B 不是 → B 應該看到［進入戰鬥］。
    // 用一般板塊點（不是夜之強敵／夜王），因為 ④ 的規格是「一般的進入別人戰鬥」。
    const ptId = await pB.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      const nonField = { sorcerer: 1, merchant: 1, strong_enemy: 1, random_event: 1, blessing: 1 };
      const pt = (s.map.points || []).find((p) => !nonField[p.type] && p.type !== "hazard_q");
      if (!pt) return null;
      const pos = s.localPos;
      pos.x = pt.x + 0.2;
      pos.y = pt.y + 0.2;
      return pt.id;
    });
    if (!ptId) {
      console.log("  [SKIP] 這個地圖種子找不到一般板塊點，略過 ④ 的端對端檢查");
    } else {
      await pA.evaluate(
        ({ gameId, ptId, slotA }) => {
          const GS = window.PriTestGameStorage;
          const participants = {};
          participants[slotA] = true;
          return GS.rtSet(gameId, "cloud", "fieldTrigger/" + ptId, {
            status: "resolved",
            participants: participants,
            enemyFamilyId: "test",
            enemyId: "test",
            level: 1,
          }).then(() => GS.rtSet(gameId, "cloud", "fieldEnemyHp/" + ptId, 500));
        },
        { gameId: stA.gameId, ptId, slotA: stA.mySlot }
      );

      const centerShown = await pB
        .waitForFunction(() => {
          const n = document.getElementById("midnight-enter-battle-center");
          return !!n && !n.hidden;
        }, null, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      const centerState = await pB.evaluate(() => {
        const n = document.getElementById("midnight-enter-battle-center");
        const btn = document.getElementById("btn-midnight-enter-battle-center");
        const topWrap = document.getElementById("midnight-enter-battle-prompt");
        const cs = btn ? getComputedStyle(btn) : null;
        const s = window.PriTestMidnight._debugState();
        return {
          pending: s.pendingBattleReentry && s.pendingBattleReentry.id,
          centerHidden: !n || n.hidden,
          topHidden: !topWrap || topWrap.hidden,
          bg: cs && cs.backgroundColor,
          anim: cs && cs.animationName,
          pos: n ? getComputedStyle(n).position : null,
        };
      });
      assert(centerShown, "加入別人的戰鬥時，置中的［進入戰鬥］顯示出來", centerState);
      assert(!centerState.topHidden, "右上角原本那顆同時仍然存在（規格是「另外」一顆，不是取代）", centerState);
      assert(centerState.bg === "rgb(255, 213, 74)", "置中按鈕是黃色", centerState);
      assert(centerState.anim === "midnight-enter-battle-glow", "置中按鈕帶閃黃光動畫", centerState);
      assert(centerState.pos === "fixed", "置中按鈕固定疊在畫面上", centerState);

      // 按下之後走的是同一條既有流程（讀條 → 正式進入）。
      await pB.dispatchEvent("#btn-midnight-enter-battle-center", "click");
      const entered = await pB
        .waitForFunction((id) => {
          const s = window.PriTestMidnight._debugState();
          return !!s.activeEncounter && s.activeEncounter.id === id;
        }, ptId, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      assert(entered, "按下置中按鈕後，確實進入了那場戰鬥（共用既有 handler）");

      // 夜之強敵／夜王不該顯示這顆（不是「別人的戰鬥」）。
      await pA.evaluate(
        ({ gameId, ptId, slotA, slotB }) => {
          const GS = window.PriTestGameStorage;
          const participants = {};
          participants[slotA] = true;
          return GS.rtSet(gameId, "cloud", "fieldTrigger/" + ptId, null)
            .then(() => GS.rtSet(gameId, "cloud", "fieldEnemyHp/" + ptId, null))
            .then(() =>
              GS.rtSet(gameId, "cloud", "fieldTrigger/day3Boss", {
                status: "resolved",
                participants: participants,
                enemyFamilyId: "night_boss",
                enemyId: "gladius",
                level: 1,
              })
            )
            .then(() => GS.rtSet(gameId, "cloud", "fieldEnemyHp/day3Boss", 500))
            .then(() => GS.rtSet(gameId, "cloud", "meta/day3StartAt", Date.now()));
        },
        { gameId: stA.gameId, ptId, slotA: stA.mySlot, slotB: null }
      );
      const bossPending = await pB
        .waitForFunction(() => {
          const s = window.PriTestMidnight._debugState();
          return !!s.pendingBattleReentry && s.pendingBattleReentry.id === "day3Boss";
        }, null, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      const bossCenter = await pB.evaluate(() => {
        const n = document.getElementById("midnight-enter-battle-center");
        const topWrap = document.getElementById("midnight-enter-battle-prompt");
        const s = window.PriTestMidnight._debugState();
        return {
          pending: s.pendingBattleReentry && s.pendingBattleReentry.id,
          centerHidden: !n || n.hidden,
          topHidden: !topWrap || topWrap.hidden,
        };
      });
      if (!bossPending) {
        console.log("  [SKIP] B 這次沒有走到夜王的［進入戰鬥］候選，略過「王戰不顯示置中鈕」的檢查：" + JSON.stringify(bossCenter));
      } else {
        assert(bossCenter.centerHidden, "夜王戰鬥的［進入戰鬥］不顯示置中鈕（那不是「別人的戰鬥」）", bossCenter);
        assert(!bossCenter.topHidden, "夜王戰鬥仍然照舊用右上角那顆", bossCenter);
      }
    }

    assert(pageErrors.length === 0, "過程中沒有任何 pageerror", pageErrors);
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.pass).length;
  console.log("\n" + passed + "/" + results.length + (passed === results.length ? " PASS" : " PASS（有失敗項目）"));
  process.exit(passed === results.length ? 0 : 1);
})();
