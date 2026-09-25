// ============================================================================
// midnight 2026-09-25 回歸測試：瀕死隊友救起／夜之強敵・夜王的重新加入
// （Playwright ＋ Firebase Local Emulator）
// ============================================================================
// 使用者明確規格（2026-09-25）：
//   ・「救起同在戰鬥的瀕死隊友，該隊友也爬起回復半血，繼續這場戰鬥」
//   ・「在進行夜之強敵戰鬥與夜王要能回到此戰鬥」
//
// 涵蓋項目：
//   ① 隊友救起：夜之強敵戰鬥中 B 瀕死 → A 的席位卡片出現 ⚠ 與［指定］按鈕
//      （isRevivalDamageEligible() 對「同一場 fieldTrigger 的 participants」放行）
//      → 累積到 required → B 的 nearDeath 清除、HP 回到「上限的一半」、
//      **activeEncounter 仍然是同一場夜之強敵**（原地繼續，不被傳送）。
//   ② 夜之強敵的重新加入：B 瀕死 15 秒逾時 → finishRevive(,true) 把人傳送到祝福點並
//      leaveEncounterAsFled()（2026-09-13 既有規格「當下在戰鬥時需等於逃離戰鬥」）
//      → 修正後逃離旗標會在下一影格自行清掉、長出 pendingBattleReentry
//      → 按［進入戰鬥］讀條 3 秒後重新回到同一場夜之強敵，且重新列入 participants。
//   ③ 夜王（day3Boss）的重新加入：同一條路徑對夜王也成立。
//
// 這裡驗的是 2026-09-25 修正的 consumeFledStateForPositionlessEncounter()。修正前，
// updateFinalCircleBoss()／updateDay3Boss() 的候選是位置無關的（永遠不為 null），
// recomputeActiveEncounter() 只有在「完全沒有候選」時才會清 fledEncounterIds，
// 因此一旦離開就永遠回不去，［進入戰鬥］按鈕也永遠不會出現。
//
// 使用前準備（跟 near_death_and_accum_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node boss_rejoin_check.js
//
// 期望值一律從 _debugState()／既有常數算出來，不硬編（CLAUDE.md §4.7）。
// 按鈕一律用 dispatchEvent，不用 page.click（CLAUDE.md §4.6）。
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const META_WAIT_MS = 20000;
const BATTLE_ENTER_LOADING_MS = 3000; // midnight.js の同名定数（[進入戰鬥]の読み込み）
const BATTLE_PREP_DURATION_MS = 5000; // midnight.js の同名定数（識別資訊準備）

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

// localPos を直接書き換えて瞬間移動する（near_death_and_accum_check.js と同じ手法：
// localPos は _debugState() が返すのと同一の物件参照で、キー入力が無い限り
// updateMovement() に上書きされない）。
async function teleport(page, x, y) {
  await page.evaluate(
    (p) => {
      const pos = window.PriTestMidnight._debugState().localPos;
      pos.x = p.x;
      pos.y = p.y;
    },
    { x, y }
  );
  await page.waitForTimeout(300);
}

function state(page) {
  return page.evaluate(() => window.PriTestMidnight._debugState());
}

// activeEncounter が指定の id になるまで待つ（初回遭遇は識別資訊準備の 5 秒があるため輪詢）。
async function waitForEncounter(page, id, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || BATTLE_PREP_DURATION_MS + 12000);
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => {
      const x = window.PriTestMidnight._debugState();
      return {
        ae: x.activeEncounter && x.activeEncounter.id,
        pending: x.pendingBattleReentry && x.pendingBattleReentry.id,
        fled: Object.keys(x.fledEncounterIds || {}),
      };
    });
    if (last.ae === id) return { ok: true, last };
    await page.waitForTimeout(500);
  }
  return { ok: false, last };
}

// characters[token] に対する条件が満たされるまで輪詢する（waitForFunction は引数を1つ
// しか渡せず、この検査は「他人の tokenId」を必要とするため素直に輪詢で書く）。
async function waitForToken(page, tokenId, predicate, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 10000);
  const src = predicate.toString();
  while (Date.now() < deadline) {
    const ok = await page.evaluate(
      ({ token, fnSrc }) => {
        // eslint-disable-next-line no-new-func
        const fn = new Function("return (" + fnSrc + ")")();
        return !!fn(window.PriTestMidnight._debugState().characters[token]);
      },
      { token: tokenId, fnSrc: src }
    );
    if (ok) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

// ある値が期待値になるまで輪詢し、最後に観測した値も返す（失敗時の診断用）。
async function waitForValue(page, getter, expected, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 10000);
  const src = getter.toString();
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate((fnSrc) => {
      // eslint-disable-next-line no-new-func
      return new Function("return (" + fnSrc + ")")()();
    }, src);
    if (last === expected) return { ok: true, last };
    await page.waitForTimeout(300);
  }
  return { ok: false, last };
}

async function waitFor(page, fn, timeoutMs) {
  return page
    .waitForFunction(fn, null, { timeout: timeoutMs || 10000 })
    .then(() => true)
    .catch(() => false);
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

    console.log("=== 建立雙人測試場 ===");
    await pA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await pA.click("#btn-midnight-create");
    await pA.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    const gameUrl = pA.url();
    await joinLobby(pA, "1111");
    await pB.goto(gameUrl, { waitUntil: "networkidle" });
    await pB.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await joinLobby(pB, "2222");
    await pA.click("#btn-midnight-lobby-ready");
    await pB.click("#btn-midnight-lobby-ready");
    await pA.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });
    await pB.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });

    const stA = await pA.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return { gameId: s.gameId, mySlot: s.mySlot, myTokenId: s.myTokenId };
    });
    const stB = await pB.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return { mySlot: s.mySlot, myTokenId: s.myTokenId };
    });
    assert(!!stB.mySlot && stB.mySlot !== stA.mySlot, "兩台裝置各自佔到不同席位", { A: stA.mySlot, B: stB.mySlot });

    // ================================================================
    // 前提：推進到 waitingForDay2，建立一場夜之強敵（finalCircleDay1）
    // ================================================================
    console.log("\n=== 前提：推進到 waitingForDay2 並開啟夜之強敵戰鬥 ===");
    await pA.evaluate(
      ({ gameId }) => {
        const st = window.PriTestMidnight._debugState();
        // 往前推 40 分鐘，足以跨過 day1 的所有縮圈階段（同 optimize_2026_09_10b_check.js）。
        return window.PriTestGameStorage.rtSet(gameId, "cloud", "meta/sessionStartAt", st.meta.sessionStartAt - 40 * 60 * 1000);
      },
      { gameId: stA.gameId }
    );
    const reachedWaiting =
      (await waitFor(pA, () => {
        const st = window.PriTestMidnight._debugState();
        return st.phaseInfo && st.phaseInfo.stage === "waitingForDay2";
      }, 20000)) &&
      (await waitFor(pB, () => {
        const st = window.PriTestMidnight._debugState();
        return st.phaseInfo && st.phaseInfo.stage === "waitingForDay2";
      }, 20000));
    if (!reachedWaiting) {
      const s = await state(pA);
      console.log("  [SKIP] 未能推進到 waitingForDay2（目前 stage=" + (s.phaseInfo && s.phaseInfo.stage) + "），略過整支測試");
    } else {
      // 縮圈の中心へ両者を移動させる。ここを省くと二人とも圈外に立ったままになり、
      // 圈外の継続ダメージ（demoStat の transaction）が復歸時の HP 書き込みと競合して
      // 「復歸後 HP＝上限の半分」の検証が不安定になる（実測で発生）。
      // 夜之強敵は本来この最終小圓の中で戦うものなので、位置としても正しい。
      const center = await pA.evaluate(() => {
        const st = window.PriTestMidnight._debugState();
        return st.phaseInfo && st.phaseInfo.finalCenter ? { x: st.phaseInfo.finalCenter.x, y: st.phaseInfo.finalCenter.y } : null;
      });
      assert(!!center, "讀得到最終小圓的中心座標", center);
      if (center) {
        await teleport(pA, center.x, center.y);
        await teleport(pB, center.x, center.y);
      }
      await pA.evaluate(
        ({ gameId, slotA, slotB }) => {
          const GS = window.PriTestGameStorage;
          const participants = {};
          participants[slotA] = true;
          participants[slotB] = true;
          return GS.rtSet(gameId, "cloud", "fieldTrigger/finalCircleDay1", {
            status: "resolved",
            participants: participants,
            // 招式 note に個別傷害が明記された実データの敵ではなく、ここは「戰鬥が成立するか」
            // だけを見るので既存テストと同じダミーでよい（傷害は一切検証しない）。
            enemyFamilyId: "test",
            enemyId: "test",
            level: 10,
          }).then(() => GS.rtSet(gameId, "cloud", "fieldEnemyHp/finalCircleDay1", 500));
        },
        { gameId: stA.gameId, slotA: stA.mySlot, slotB: stB.mySlot }
      );
      const inA = await waitForEncounter(pA, "finalCircleDay1");
      const inB = await waitForEncounter(pB, "finalCircleDay1");
      assert(inA.ok && inB.ok, "兩台都進入同一場夜之強敵（activeEncounter=finalCircleDay1）", { A: inA.last, B: inB.last });

      if (inA.ok && inB.ok) {
        // ============================================================
        // ① 救起同在戰鬥的瀕死隊友：爬起、回半血、繼續這場戰鬥
        // ============================================================
        console.log("\n=== ① 救起同在戰鬥的瀕死隊友 ===");
        // HP 上限は finishRevive() が使うのと同じ selfArenaHpMax() から取る
        //（＝期望値をデータから算出する、CLAUDE.md §4.7）。
        // 「瀕死直前の現在HPが上限のはず」という当て方は不可、ここは waitingForDay2 まで
        // 時間を進めた状態＝縮圈外の継続ダメージが入っているため実測で 144/150 とずれる。
        const hpMaxB = await pB.evaluate(() => window.PriTestMidnight._debugArenaHpMax());
        assert(typeof hpMaxB === "number" && hpMaxB > 0, "取得 B 的 HP 上限（selfArenaHpMax）", hpMaxB);

        await pB.evaluate(() => window.PriTestMidnight._debugTriggerNearDeath());
        const seenDowned = await waitForToken(pA, stB.myTokenId, (c) => !!(c && c.nearDeath && c.nearDeath.active), 10000);
        assert(seenDowned, "A 的畫面上看得到 B 已瀕死（characters[B].nearDeath.active）");

        // 席位卡片上的 ⚠ 與［指定］按鈕：isRevivalDamageEligible() 對「同一場戰鬥的
        // participants」放行，所以夜之強敵戰鬥中也必須出現。
        const rescueUi = await pA.evaluate(() => ({
          warn: document.querySelectorAll(".midnight-slot-warning-badge").length,
          designate: document.querySelectorAll(".midnight-slot-designate-btn").length,
        }));
        assert(rescueUi.warn > 0, "A 的席位卡片出現瀕死 ⚠ 警示", rescueUi);
        assert(rescueUi.designate > 0, "A 的席位卡片出現［指定］按鈕（＝同場戰鬥可施放復歸傷害）", rescueUi);

        // 累積到 required：required 直接從 B 的 nearDeath 讀回來，不硬編 60/90/120。
        const required = await pA.evaluate((token) => {
          const c = window.PriTestMidnight._debugState().characters[token];
          return c && c.nearDeath ? c.nearDeath.required : null;
        }, stB.myTokenId);
        assert(typeof required === "number" && required > 0, "讀得到 B 的復歸所需總量 required", required);
        await pA.evaluate(
          ({ token, amount }) => window.PriTestMidnight._debugApplyRevivalProgress(token, amount),
          { token: stB.myTokenId, amount: required }
        );

        const revived = await waitFor(pB, () => {
          const s = window.PriTestMidnight._debugState();
          const c = s.characters[s.myTokenId];
          return !c || !c.nearDeath || !c.nearDeath.active;
        }, 10000);
        assert(revived, "B 從瀕死復歸（nearDeath 已清除）");

        // finishRevive() は「nearDeath を消す」と「demoStat を書く」が別々の書き込みで、
        // 後者のほうが少し遅れて届く。nearDeath が消えた瞬間に HP を読むと復歸前の値を
        // 拾ってしまうので（実測で 144／149 を拾った）、HP の到着そのものを待つ。
        const halfExpected = Math.round(hpMaxB / 2); // finishRevive(, false) と同じ式
        const hpLanded = await waitForValue(
          pB,
          () => {
            const s = window.PriTestMidnight._debugState();
            return s.demoStats[s.myTokenId];
          },
          halfExpected,
          10000
        );
        assert(hpLanded.ok, "B 復歸後 HP＝上限的一半（" + halfExpected + "）", hpLanded.last);

        const afterB = await pB.evaluate(() => {
          const s = window.PriTestMidnight._debugState();
          return {
            hp: s.demoStats[s.myTokenId],
            ae: s.activeEncounter && s.activeEncounter.id,
            fled: Object.keys(s.fledEncounterIds || {}),
          };
        });
        assert(afterB.ae === "finalCircleDay1", "B 復歸後仍在同一場夜之強敵（原地繼續這場戰鬥）", afterB);
        assert(afterB.fled.indexOf("finalCircleDay1") === -1, "隊友救起不算逃離戰鬥（fledEncounterIds 沒有這場）", afterB);

        // ============================================================
        // ② 夜之強敵：瀕死逾時也留在同一場戰鬥
        // ============================================================
        // 2026-09-25 規格變更（CLAUDE.md §4.7）：舊期望值是「逾時＝逃離這場戰鬥」
        //（2026-09-13「瀕死後自動復活後飛往祝福沒問題，但是當下在戰鬥時需等於逃離戰鬥」）。
        // 使用者 2026-09-25 明確規格「夜之強敵戰鬥中 救起瀕死的隊友，該隊友需要在同一場
        // 戰鬥站起繼續戰鬥」，且實測回報的症狀正是「救起後被踢出戰鬥畫面／被傳送到祝福」
        // ——隊友還在補復歸傷害、15 秒先到就走 forceReviveOnTimeout()。因此夜之強敵／夜王
        // 戰鬥中的逾時復歸改為原地站起：不離開 participants、不傳送。一般板塊戰鬥維持舊
        // 規則，由 near_death_and_accum_check.js 第③節繼續把關。
        console.log("\n=== ② 夜之強敵：瀕死逾時也留在同一場戰鬥 ===");
        const posBefore = await pB.evaluate(() => {
          const s = window.PriTestMidnight._debugState();
          return { x: s.localPos.x, y: s.localPos.y };
        });
        await pB.evaluate(() => window.PriTestMidnight._debugTriggerNearDeath());
        await pB.waitForTimeout(800);
        // 逾時：把自己的 deadlineAt 推到過去，updateNearDeathState() 會走
        // forceReviveOnTimeout() → 消耗流浪祝福 → finishRevive(,true) → leaveEncounterAsFled()。
        await pB.evaluate(() => {
          const s = window.PriTestMidnight._debugState();
          return window.PriTestGameStorage.rtSet(
            s.gameId,
            "cloud",
            "character/" + s.myTokenId + "/nearDeath/deadlineAt",
            Date.now() - 1000
          );
        });
        const revivedByTimeout = await waitFor(pB, () => {
          const s = window.PriTestMidnight._debugState();
          const c = s.characters[s.myTokenId];
          return !c || !c.nearDeath || !c.nearDeath.active;
        }, 15000);
        assert(revivedByTimeout, "B 逾時後被流浪祝福救起");

        const afterTimeout = await pB.evaluate(() => {
          const s = window.PriTestMidnight._debugState();
          return {
            ae: s.activeEncounter && s.activeEncounter.id,
            fled: Object.keys(s.fledEncounterIds || {}),
            x: s.localPos.x,
            y: s.localPos.y,
            hp: s.demoStats[s.myTokenId],
            hpMax: window.PriTestMidnight._debugArenaHpMax(),
          };
        });
        assert(afterTimeout.ae === "finalCircleDay1", "逾時復歸後仍在同一場夜之強敵（原地站起，不再被踢出戰鬥）", afterTimeout);
        assert(afterTimeout.fled.indexOf("finalCircleDay1") === -1, "逾時復歸不再把這場王戰標成已逃離", afterTimeout);
        assert(
          afterTimeout.x === posBefore.x && afterTimeout.y === posBefore.y,
          "沒有被傳送到祝福點（留在原地）",
          { before: posBefore, after: { x: afterTimeout.x, y: afterTimeout.y } }
        );
        assert(afterTimeout.hp === afterTimeout.hpMax, "逾時復歸仍是全回血（這一段規格沒有改）", afterTimeout);

        const stillParticipant = await pA.evaluate(() => {
          const trig = window.PriTestMidnight._debugState().fieldTriggers.finalCircleDay1;
          return trig && trig.participants ? Object.keys(trig.participants).length : 0;
        });
        assert(stillParticipant === 2, "B 仍留在 finalCircleDay1 的 participants（獎勵資格保留）", stillParticipant);

        // ============================================================
        // ②b 夜之強敵：萬一真的離開了，仍要能重新加入
        // ============================================================
        // 這一段驗的是 consumeFledStateForPositionlessEncounter()：這種遭遇的候選是位置
        // 無關的，修正前逃離旗標永遠清不掉、pendingBattleReentry 永遠是 null、
        //［進入戰鬥］永遠不會出現。逾時路徑現在已經不會離開王戰（見上一節），所以改用
        // 直接入口重現「已經離開」的狀態。
        console.log("\n=== ②b 夜之強敵：離開後仍能重新加入 ===");
        await pB.evaluate(() => window.PriTestMidnight._debugLeaveEncounterAsFled("finalCircleDay1"));
        const leftFight = await waitFor(pB, () => {
          const s = window.PriTestMidnight._debugState();
          return !s.activeEncounter || s.activeEncounter.id !== "finalCircleDay1";
        }, 10000);
        assert(leftFight, "B 離開了夜之強敵戰鬥（前提成立）");

        const removedFromParticipants = await waitFor(pA, () => {
          const s = window.PriTestMidnight._debugState();
          const trig = s.fieldTriggers.finalCircleDay1;
          return !!trig && (!trig.participants || Object.keys(trig.participants).length === 1);
        }, 10000);
        assert(removedFromParticipants, "離開時會從 participants 移除（既有規格，關係到獎勵資格）");
        const promptBack = await waitFor(pB, () => {
          const s = window.PriTestMidnight._debugState();
          return !!s.pendingBattleReentry && s.pendingBattleReentry.id === "finalCircleDay1";
        }, 10000);
        const pbState = await pB.evaluate(() => {
          const s = window.PriTestMidnight._debugState();
          const wrap = document.getElementById("midnight-enter-battle-prompt");
          return {
            pending: s.pendingBattleReentry && s.pendingBattleReentry.id,
            fled: Object.keys(s.fledEncounterIds || {}),
            promptHidden: !wrap || wrap.hidden,
          };
        });
        assert(promptBack, "逃離旗標自行清除，重新長出 pendingBattleReentry=finalCircleDay1", pbState);
        assert(pbState.fled.indexOf("finalCircleDay1") === -1, "fledEncounterIds 不再卡住這場戰鬥", pbState);
        assert(!pbState.promptHidden, "上方資訊欄的［進入戰鬥］提示確實顯示出來", pbState);

        // 按下［進入戰鬥］（dispatchEvent，CLAUDE.md §4.6）→ 讀條 3 秒後回到戰鬥。
        await pB.dispatchEvent("#btn-midnight-enter-battle", "click");
        await pB.waitForTimeout(BATTLE_ENTER_LOADING_MS + 1500);
        const rejoined = await waitForEncounter(pB, "finalCircleDay1", 10000);
        assert(rejoined.ok, "按下［進入戰鬥］後回到同一場夜之強敵", rejoined.last);
        const backInParticipants = await waitFor(pA, () => {
          const trig = window.PriTestMidnight._debugState().fieldTriggers.finalCircleDay1;
          return !!(trig && trig.participants && Object.keys(trig.participants).length === 2);
        }, 10000);
        assert(backInParticipants, "B 重新列入 finalCircleDay1 的 participants");

        // ============================================================
        // ③ 夜王（day3Boss）：離開後同樣要能回到此戰鬥
        // ============================================================
        console.log("\n=== ③ 夜王：離開後重新加入 ===");
        await pA.evaluate(
          ({ gameId, slotA, slotB }) => {
            const GS = window.PriTestGameStorage;
            const participants = {};
            participants[slotA] = true;
            participants[slotB] = true;
            // 夜之強敵を畳んでから夜王へ（候選優先序では夜王が最優先なので順序自体は不問だが、
            // 「前のテストの戦闘がまだ生きている」状態を残さない）。
            return GS.rtSet(gameId, "cloud", "fieldEnemyHp/finalCircleDay1", 0)
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
          { gameId: stA.gameId, slotA: stA.mySlot, slotB: stB.mySlot }
        );
        const inDay3 = await waitForEncounter(pB, "day3Boss");
        assert(inDay3.ok, "B 進入夜王戰鬥（activeEncounter=day3Boss）", inDay3.last);

        if (inDay3.ok) {
          await pB.evaluate(() => window.PriTestMidnight._debugLeaveEncounterAsFled("day3Boss"));
          const leftDay3 = await waitFor(pB, () => {
            const s = window.PriTestMidnight._debugState();
            return !s.activeEncounter || s.activeEncounter.id !== "day3Boss";
          }, 10000);
          assert(leftDay3, "B 離開了夜王戰鬥");

          const day3PromptBack = await waitFor(pB, () => {
            const s = window.PriTestMidnight._debugState();
            return !!s.pendingBattleReentry && s.pendingBattleReentry.id === "day3Boss";
          }, 10000);
          const d3State = await pB.evaluate(() => {
            const s = window.PriTestMidnight._debugState();
            return { pending: s.pendingBattleReentry && s.pendingBattleReentry.id, fled: Object.keys(s.fledEncounterIds || {}) };
          });
          assert(day3PromptBack, "夜王也會自行清除逃離旗標並長出 pendingBattleReentry=day3Boss", d3State);

          await pB.dispatchEvent("#btn-midnight-enter-battle", "click");
          await pB.waitForTimeout(BATTLE_ENTER_LOADING_MS + 1500);
          const rejoinedDay3 = await waitForEncounter(pB, "day3Boss", 10000);
          assert(rejoinedDay3.ok, "按下［進入戰鬥］後回到夜王戰鬥", rejoinedDay3.last);
        }
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
