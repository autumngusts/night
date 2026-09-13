// ============================================================================
// midnight（即時制擴張版）2026-09-13 修正三件套 回歸測試
// （Playwright ＋ Firebase Local Emulator）
// ============================================================================
// 對應使用者當次回報的三點：
//   ① 隊友瀕死時，倒地倒數的時限也要顯示在「隊友資訊 HUD」（席位卡片），採圓盤狀倒數。
//      → renderOccupiedSlotCard() 建立 .midnight-near-death-dial，逐幀由
//        updateNearDeathDials() 寫入 --nd-pct 與剩餘秒數。
//   ② 敵人蓄積值超過門檻並觸發效果後，不可以繼續掛著 17/16；計算過一次就扣掉門檻值，
//      下一次從 1/16 重新算。
//      → maybeTriggerAttributeAccum() 改成「用扣除的 transaction 本身當併發閘門」，
//        並把累計觸發次數另外記在 attributeAccumTriggers（遺物「〜達成的歡喜」改讀它）。
//        自身承受側（recordReceivedAttributeAccum）同一條規則。
//   ③ 瀕死逾時被流浪祝福傳送到祝福點時，等同逃離這場戰鬥：要從 trig.participants 移除，
//      不可以人已經飛走、隊友打完之後還在遠端領到獎勵清單。回到板塊後，戰鬥還在就重新
//      參戰、戰鬥已結束就走既有的後補領獎（late-claim）。
//      → leaveEncounterAsFled()（[逃離戰鬥] 與自動復活共用）。
//
// 使用前準備（跟 field_multiplayer_floor_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node near_death_and_accum_check.js
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

// 直接改寫 localPos 當傳送（沿用 field_multiplayer_floor_check.js 的既有手法：localPos 是
// _debugState() 回傳的同一個物件參考，沒有按鍵時 updateMovement() 不會覆寫它）。
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

function accumOf(state, targetKey, name) {
  return ((state.attributeAccum || {})[targetKey] || {})[name];
}

function triggersOf(state, targetKey, name) {
  return ((state.attributeAccumTriggers || {})[targetKey] || {})[name];
}

(async () => {
  const browser = await chromium.launch();
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();
  const pageErrors = [];
  [p1, p2].forEach((pg, i) =>
    pg.on("pageerror", (e) => {
      pageErrors.push(`P${i + 1}: ` + e.message);
      console.log(`  [pageerror P${i + 1}] ` + e.message);
    })
  );

  try {
    await enableEmulatorFlag(p1);
    await enableEmulatorFlag(p2);

    console.log("=== 建立雙人測試場 ===");
    await p1.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await p1.click("#btn-midnight-create");
    await p1.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    const gameUrl = p1.url();
    await joinLobby(p1, "1111");
    await p2.goto(gameUrl, { waitUntil: "networkidle" });
    await p2.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await joinLobby(p2, "2222");
    await p1.click("#btn-midnight-lobby-ready");
    await p2.click("#btn-midnight-lobby-ready");
    await p1.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });
    await p2.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });
    const st = await p1.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return { gameId: s.gameId, mySlot: s.mySlot, myTokenId: s.myTokenId, points: s.map.points };
    });
    const st2 = await p2.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return { mySlot: s.mySlot, myTokenId: s.myTokenId };
    });
    assert(!!st2.mySlot && st2.mySlot !== st.mySlot, "兩台裝置各自佔到不同席位", { p1: st.mySlot, p2: st2.mySlot });
    const threshold = await p1.evaluate(() => window.PriTestMidnight._debugAttributeStatusThreshold());
    assert(threshold === 16, "門檻值仍是使用者規格的 16（規則書 8 點 ×2）", threshold);

    // ================================================================
    // ② 屬性/異常蓄積：觸發後扣掉門檻值，而不是一直掛著 17/16
    // ================================================================
    console.log("\n=== ② 蓄積值觸發後扣除門檻值 ===");
    // 沒有 activeEncounter 時 targetKey 是 "sharedTarget"（見 currentAttributeAccumTargetKey()）。
    const targetKey = await p1.evaluate(() => window.PriTestMidnight._debugAttributeAccumTargetKey());
    assert(targetKey === "sharedTarget", "戰鬥外的蓄積目標 key 是 sharedTarget", targetKey);

    // 門檻以下：照舊單純累加，不觸發也不扣除。
    await p1.evaluate(() => window.PriTestMidnight._debugRecordAttributeAccum("魔", 9));
    await p1.waitForTimeout(700);
    let s1 = await p1.evaluate(() => window.PriTestMidnight._debugState());
    assert(accumOf(s1, "sharedTarget", "魔") === 9, "未達門檻時照舊累加（9/16）", accumOf(s1, "sharedTarget", "魔"));
    assert(triggersOf(s1, "sharedTarget", "魔") === undefined, "未達門檻時沒有任何觸發紀錄", triggersOf(s1, "sharedTarget", "魔"));

    // 9 + 8 = 17 → 觸發 1 次、剩 1（使用者原話：「敵人仍然殘留 17/16…下一次重新計算成為 1/16」）
    await p1.evaluate(() => window.PriTestMidnight._debugRecordAttributeAccum("魔", 8));
    await p1.waitForFunction(() => {
      const s = window.PriTestMidnight._debugState();
      return (((s.attributeAccum || {}).sharedTarget || {})["魔"]) === 1 &&
        (((s.attributeAccumTriggers || {}).sharedTarget || {})["魔"]) === 1;
    }, null, { timeout: 8000 }).catch(() => {});
    s1 = await p1.evaluate(() => window.PriTestMidnight._debugState());
    assert(accumOf(s1, "sharedTarget", "魔") === 1, "屬性跨過門檻後扣掉 16，17→1（不再殘留 17/16）", accumOf(s1, "sharedTarget", "魔"));
    assert(triggersOf(s1, "sharedTarget", "魔") === 1, "累計觸發次數 +1", triggersOf(s1, "sharedTarget", "魔"));

    // 另一台裝置也要看到同一個結果（共享 state，且觸發資格是 transaction 搶到的人）
    const s2 = await p2.evaluate(() => window.PriTestMidnight._debugState());
    assert(accumOf(s2, "sharedTarget", "魔") === 1, "另一台裝置看到的蓄積值同樣是 1", accumOf(s2, "sharedTarget", "魔"));

    // 一次灌 33（=2×16+1）：屬性可同時觸發多次，扣掉 32 之後剩 1
    // 蓄積值與觸發次數是兩筆先後送出的 transaction，等待條件必須把兩筆都包含進去
    // （只等蓄積值的話，觸發次數偶爾還沒回寫，斷言會偶發失敗——實測過）。
    await p1.evaluate(() => window.PriTestMidnight._debugRecordAttributeAccum("炎", 33));
    await p1.waitForFunction(() => {
      const s = window.PriTestMidnight._debugState();
      return (((s.attributeAccum || {}).sharedTarget || {})["炎"]) === 1 &&
        (((s.attributeAccumTriggers || {}).sharedTarget || {})["炎"]) === 2;
    }, null, { timeout: 8000 }).catch(() => {});
    s1 = await p1.evaluate(() => window.PriTestMidnight._debugState());
    assert(accumOf(s1, "sharedTarget", "炎") === 1, "一次超過 2 倍門檻時扣掉 2×16，33→1", accumOf(s1, "sharedTarget", "炎"));
    assert(triggersOf(s1, "sharedTarget", "炎") === 2, "同一次灌入觸發 2 次（屬性可超額多次發動）", triggersOf(s1, "sharedTarget", "炎"));

    // 狀態異常維持 docs §7.4：發動後歸零、超過分切り捨て（不是扣門檻）
    await p1.evaluate(() => window.PriTestMidnight._debugRecordAttributeAccum("出血", 20));
    await p1.waitForFunction(() => {
      const s = window.PriTestMidnight._debugState();
      return (((s.attributeAccum || {}).sharedTarget || {})["出血"]) === 0 &&
        (((s.attributeAccumTriggers || {}).sharedTarget || {})["出血"]) === 1;
    }, null, { timeout: 8000 }).catch(() => {});
    s1 = await p1.evaluate(() => window.PriTestMidnight._debugState());
    assert(accumOf(s1, "sharedTarget", "出血") === 0, "狀態異常觸發後仍然歸零（docs §7.4，不是扣門檻）", accumOf(s1, "sharedTarget", "出血"));
    assert(triggersOf(s1, "sharedTarget", "出血") === 1, "狀態異常一次只算 1 發", triggersOf(s1, "sharedTarget", "出血"));

    // 觸發後可以重新累積到下一次（舊版的本地計數殘留會讓第二次永遠不觸發）
    await p1.evaluate(() => window.PriTestMidnight._debugRecordAttributeAccum("魔", 16));
    await p1.waitForFunction(() => {
      const s = window.PriTestMidnight._debugState();
      return (((s.attributeAccumTriggers || {}).sharedTarget || {})["魔"]) === 2 &&
        (((s.attributeAccum || {}).sharedTarget || {})["魔"]) === 1;
    }, null, { timeout: 8000 }).catch(() => {});
    s1 = await p1.evaluate(() => window.PriTestMidnight._debugState());
    assert(triggersOf(s1, "sharedTarget", "魔") === 2, "扣除後重新累積仍會再次觸發（1+16=17→再扣 16）", triggersOf(s1, "sharedTarget", "魔"));
    assert(accumOf(s1, "sharedTarget", "魔") === 1, "第二次觸發後同樣只剩 1", accumOf(s1, "sharedTarget", "魔"));

    // 自身承受側（敵人→自己，本地 only）同一條規則
    const received = await p1.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugRecordReceivedAccum("魔", 17);
      M._debugRecordReceivedAccum("出血", 17);
      return M._debugState().receivedAttributeAccum;
    });
    assert(received["魔"] === 1, "自身承受側：屬性同樣扣掉門檻，17→1", received);
    assert(received["出血"] === 0, "自身承受側：異常維持歸零", received);

    // ================================================================
    // ① 隊友瀕死倒數圓盤
    // ================================================================
    console.log("\n=== ① 隊友資訊 HUD 的倒地倒數圓盤 ===");
    await p1.evaluate(() => window.PriTestMidnight._debugTriggerNearDeath());
    await p2.waitForFunction(
      (tokenId) => {
        const c = (window.PriTestMidnight._debugState().characters || {})[tokenId];
        return !!(c && c.nearDeath && c.nearDeath.active);
      },
      st.myTokenId,
      { timeout: 10000 }
    );
    await p2.waitForTimeout(400);
    const dials2 = await p2.evaluate(() => window.PriTestMidnight._debugNearDeathDials());
    const dialForP1 = dials2.filter((d) => d.tokenId === st.myTokenId)[0];
    assert(!!dialForP1, "隊友（P2）的席位卡片上長出瀕死倒數圓盤", dials2);
    if (dialForP1) {
      const pct = parseFloat(dialForP1.pct);
      const sec = parseInt(dialForP1.text, 10);
      assert(!dialForP1.hidden, "圓盤處於顯示狀態", dialForP1);
      assert(pct > 0 && pct <= 100, "--nd-pct 是 0〜100 的剩餘百分比（圓盤角度）", dialForP1.pct);
      assert(sec >= 1 && sec <= 15, "圓盤中央顯示剩餘秒數（1〜15）", dialForP1.text);
    }
    // 倒數會隨時間減少（逐幀更新，不是只畫一次的靜態值）
    await p2.waitForTimeout(2200);
    const dialsLater = await p2.evaluate(() => window.PriTestMidnight._debugNearDeathDials());
    const laterForP1 = dialsLater.filter((d) => d.tokenId === st.myTokenId)[0];
    if (dialForP1 && laterForP1) {
      assert(parseFloat(laterForP1.pct) < parseFloat(dialForP1.pct), "圓盤角度隨時間遞減（逐幀更新）", {
        before: dialForP1.pct,
        after: laterForP1.pct,
      });
      assert(parseInt(laterForP1.text, 10) < parseInt(dialForP1.text, 10), "中央秒數隨時間遞減", {
        before: dialForP1.text,
        after: laterForP1.text,
      });
    }
    // 自己這台裝置的席位卡片上也看得到同一顆圓盤（席位卡片是同一套渲染路徑）
    const dials1 = await p1.evaluate(() => window.PriTestMidnight._debugNearDeathDials());
    assert(dials1.filter((d) => d.tokenId === st.myTokenId).length === 1, "瀕死者自己的畫面上也有同一顆圓盤", dials1);
    // 收尾：清掉瀕死狀態，避免 15 秒逾時吃掉流浪祝福影響後續段落
    await p1.evaluate(
      (a) => window.PriTestGameStorage.rtSet(a.gameId, "cloud", "character/" + a.tokenId + "/nearDeath", null),
      { gameId: st.gameId, tokenId: st.myTokenId }
    );
    await p1.waitForTimeout(600);

    // ================================================================
    // ③ 自動復活＝逃離戰鬥：離開 participants、獎勵不再遠端入手
    // ================================================================
    console.log("\n=== ③ 瀕死自動復活＝逃離戰鬥（強敵籌碼點） ===");
    const strongPt = st.points.filter((pt) => pt.type === "strong_enemy")[0];
    assert(!!strongPt, "地圖上有強敵籌碼點可供測試", strongPt && strongPt.id);
    if (strongPt) {
      await teleport(p1, strongPt.x + 0.5, strongPt.y + 0.5);
      await teleport(p2, strongPt.x + 0.5, strongPt.y + 0.5);
      await p1.evaluate((pt) => window.PriTestMidnight._debugRollStrongEnemy(pt), strongPt);
      await p1.waitForFunction(
        (id) => {
          const t = (window.PriTestMidnight._debugState().fieldTriggers || {})[id];
          return !!(t && t.status === "resolved" && t.enemyFamilyId);
        },
        strongPt.id,
        { timeout: 15000 }
      );
      // 兩人都按［進入戰鬥］（強敵籌碼的按鈕直接寫 participants，見 handleStrongEnemyEnterClick）
      await p1.dispatchEvent("#btn-midnight-strong-enemy-enter", "click");
      await p2.dispatchEvent("#btn-midnight-strong-enemy-enter", "click");
      const bothIn = await p1
        .waitForFunction(
          (a) => {
            const t = (window.PriTestMidnight._debugState().fieldTriggers || {})[a.id] || {};
            const ps = t.participants || {};
            return !!(ps[a.s1] && ps[a.s2]);
          },
          { id: strongPt.id, s1: st.mySlot, s2: st2.mySlot },
          { timeout: 15000 }
        )
        .then(() => true)
        .catch(() => false);
      assert(bothIn, "兩名玩家都成為這場戰鬥的 participant", bothIn);
      // 進入戰鬥要先跑完 5 秒識別資訊準備（BATTLE_PREP_DURATION_MS）
      const inBattle = await p1
        .waitForFunction(() => !!window.PriTestMidnight._debugState().activeEncounter, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      assert(inBattle, "P1 正式進入戰鬥（activeEncounter 成立）", inBattle);

      // 瀕死 → 把倒數期限改成已過 → 每幀的 updateNearDeathState() 觸發強制復歸
      await p1.evaluate(() => window.PriTestMidnight._debugTriggerNearDeath());
      await p1.waitForFunction(
        (tokenId) => {
          const c = (window.PriTestMidnight._debugState().characters || {})[tokenId];
          return !!(c && c.nearDeath && c.nearDeath.active);
        },
        st.myTokenId,
        { timeout: 10000 }
      );
      const posBefore = await p1.evaluate(() => {
        const p = window.PriTestMidnight._debugState().localPos;
        return { x: p.x, y: p.y };
      });
      await p1.evaluate(
        (a) => window.PriTestGameStorage.rtSet(a.gameId, "cloud", "character/" + a.tokenId + "/nearDeath/deadlineAt", Date.now() - 1),
        { gameId: st.gameId, tokenId: st.myTokenId }
      );
      const revived = await p1
        .waitForFunction(
          (tokenId) => {
            const c = (window.PriTestMidnight._debugState().characters || {})[tokenId];
            return !c || !c.nearDeath;
          },
          st.myTokenId,
          { timeout: 20000 }
        )
        .then(() => true)
        .catch(() => false);
      assert(revived, "倒數結束後自動復活（流浪祝福）", revived);
      await p1.waitForTimeout(1200);

      const posAfter = await p1.evaluate(() => {
        const p = window.PriTestMidnight._debugState().localPos;
        return { x: p.x, y: p.y };
      });
      assert(posAfter.x !== posBefore.x || posAfter.y !== posBefore.y, "復活後被傳送到祝福點（離開戰鬥所在地）", { posBefore, posAfter });

      const afterRevive = await p1.evaluate((id) => {
        const D = window.PriTestMidnight._debugState();
        return {
          participants: ((D.fieldTriggers || {})[id] || {}).participants || {},
          activeEncounter: D.activeEncounter ? D.activeEncounter.id : null,
        };
      }, strongPt.id);
      assert(!afterRevive.participants[st.mySlot], "核心修正：復活＝逃離戰鬥，自己已從 participants 移除", afterRevive.participants);
      assert(!!afterRevive.participants[st2.mySlot], "留在原地的隊友仍是 participant", afterRevive.participants);
      assert(afterRevive.activeEncounter === null, "自己的 activeEncounter 已解除", afterRevive.activeEncounter);

      // 使用者規格的另一半：「重新跑到板塊，仍在戰鬥則參與戰鬥」——敵人還活著時跑回來，
      // 應該重新看得到進入戰鬥的入口，按下去就重新成為 participant。
      await teleport(p1, strongPt.x + 0.5, strongPt.y + 0.5);
      const canRejoin = await p1
        .waitForFunction(() => {
          const btn = document.getElementById("btn-midnight-strong-enemy-enter");
          return !!(btn && !btn.hidden);
        }, null, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      assert(canRejoin, "敵人還活著時跑回板塊，重新出現［進入戰鬥］", canRejoin);
      if (canRejoin) {
        await p1.dispatchEvent("#btn-midnight-strong-enemy-enter", "click");
        const rejoined = await p1
          .waitForFunction(
            (a) => {
              const t = (window.PriTestMidnight._debugState().fieldTriggers || {})[a.id] || {};
              return !!((t.participants || {})[a.slot]);
            },
            { id: strongPt.id, slot: st.mySlot },
            { timeout: 15000 }
          )
          .then(() => true)
          .catch(() => false);
        assert(rejoined, "重新加入後又回到 participants（可以繼續參戰）", rejoined);
        await p1.waitForFunction(() => !!window.PriTestMidnight._debugState().activeEncounter, { timeout: 20000 }).catch(() => {});
        // 這次改用玩家主動按［逃離戰鬥］——跟自動復活共用同一支 leaveEncounterAsFled()，
        // 效果必須一樣（離開 participants、之後要重新加入才算數）。
        await p1.dispatchEvent("#btn-midnight-flee-battle", "click");
        const fledOut = await p1
          .waitForFunction(
            (a) => {
              const t = (window.PriTestMidnight._debugState().fieldTriggers || {})[a.id] || {};
              return !((t.participants || {})[a.slot]);
            },
            { id: strongPt.id, slot: st.mySlot },
            { timeout: 15000 }
          )
          .then(() => true)
          .catch(() => false);
        assert(fledOut, "主動按［逃離戰鬥］同樣會離開 participants", fledOut);
      }
      // 離開板塊，讓 P2 獨自打完
      await teleport(p1, strongPt.x + 0.5, strongPt.y + 8.5);

      // 等 P2 也收到 participants 的變更，再由 P2 打倒敵人
      await p2.waitForFunction(
        (a) => {
          const t = (window.PriTestMidnight._debugState().fieldTriggers || {})[a.id] || {};
          return !((t.participants || {})[a.slot]);
        },
        { id: strongPt.id, slot: st.mySlot },
        { timeout: 15000 }
      );
      await p2.evaluate(
        (a) => window.PriTestGameStorage.rtSet(a.gameId, "cloud", "fieldEnemyHp/" + a.pointId, 0),
        { gameId: st.gameId, pointId: strongPt.id }
      );
      await p2.waitForFunction(
        (tokenId) => Object.keys((window.PriTestMidnight._debugState().pendingRewards || {})[tokenId] || {}).length > 0,
        st2.myTokenId,
        { timeout: 20000 }
      );
      await p1.waitForTimeout(1500);
      const rewardView = await p1.evaluate(
        (a) => {
          const D = window.PriTestMidnight._debugState();
          return {
            mine: Object.keys((D.pendingRewards || {})[a.mine] || {}).length,
            other: Object.keys((D.pendingRewards || {})[a.other] || {}).length,
            shared: window.PriTestMidnight._debugCollectSharedRewards(),
            modalHidden: document.getElementById("midnight-reward-modal").hidden,
          };
        },
        { mine: st.myTokenId, other: st2.myTokenId }
      );
      assert(rewardView.mine === 0, "核心修正：飛走的玩家沒有拿到這場戰鬥的獎勵", rewardView);
      assert(rewardView.other > 0, "留下來打完的隊友照常拿到獎勵", rewardView);
      assert(rewardView.shared.length === 0, "飛走的玩家也看不到共享池清單（不能在遠端領取）", rewardView.shared);
      assert(rewardView.modalHidden, "飛走的玩家畫面上不會自動彈出獎勵清單", rewardView.modalHidden);

      // 跑回板塊 → 戰鬥已結束 → 出現後補領獎（late-claim）
      await teleport(p1, strongPt.x + 0.5, strongPt.y + 0.5);
      const lateClaimOk = await p1
        .waitForFunction(
          (id) => {
            const D = window.PriTestMidnight._debugState();
            const box = document.getElementById("midnight-field-late-claim-prompt");
            return !!(D.nearbyLateClaimPoint && D.nearbyLateClaimPoint.id === id && box && !box.hidden);
          },
          strongPt.id,
          { timeout: 15000 }
        )
        .then(() => true)
        .catch(() => false);
      const lateDiag = await p1.evaluate((id) => {
        const D = window.PriTestMidnight._debugState();
        const trig = (D.fieldTriggers || {})[id] || null;
        return {
          mySlot: D.mySlot,
          localPos: D.localPos,
          autoFly: D.autoFly,
          nearbyStrongEnemy: D.nearbyStrongEnemy ? D.nearbyStrongEnemy.id : null,
          nearbyLateClaimPoint: D.nearbyLateClaimPoint ? D.nearbyLateClaimPoint.id : null,
          trigStatus: trig && trig.status,
          participants: trig && trig.participants,
          claimedBy: trig && trig.claimedBy,
          hp: (D.fieldEnemyHp || {})[id],
          lateClaimPromptHidden: document.getElementById("midnight-field-late-claim-prompt").hidden,
        };
      }, strongPt.id);
      assert(lateClaimOk, "跑回板塊後出現後補領獎（戰鬥已結束的情況）", lateDiag);
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
