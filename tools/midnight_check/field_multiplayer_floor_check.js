// ============================================================================
// midnight（即時制擴張版）板塊樓層推進 **多人** 回歸測試（Playwright ＋ Firebase
// Local Emulator）。
// ============================================================================
// 針對 2026-09-12 使用者回報：
//   「多人遊戲下，1 人進入板塊後，打贏第一層領完獎勵，banner 沒出現進入下層的選項，
//     而是出現探索會合，導致卡死在第一層永遠無法探索下去」
//
// 既有的 field_floor_progress_check.js 是**單人**腳本，涵蓋不到「場上還有其他玩家、
// 但只有 1 人是這個板塊的 participant」這個組合，因此另外開這一支。
//
// 涵蓋範圍（使用者要求「包含坑道的所有板塊都測試」）：
//   ① 資料層：全部卡牌×分歧，確認 min(卡面 floorCount, 分歧實際 floors 長度) 之後
//      不會出現「打不到的幽靈樓層」（card_6 坑道分歧3 只有 1 層、card_q 多個分歧只有
//      3 層，都是歷史上的卡關來源）。這一段純資料、跑得很快，一次掃完全部板塊。
//   ② 執行期：雙裝置實跑地圖上「每一種卡牌」各 1 個點的第 1 層，確認踏破後
//      fieldTrigger 有被清掉、floorIndex 有推進、兩台裝置都回到「進入」而不是卡在
//      「參加探索（探索會合）」。
//
// 使用前準備（跟 emulator_sync_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node field_multiplayer_floor_check.js
//
// 走位說明：本腳本用「直接改寫 localPos 的 x/y」當傳送，而不是像
// field_floor_progress_check.js 那樣按方向鍵走過去——要在一支腳本裡跑完地圖上的每一種
// 卡牌，用鍵盤走位會慢到不可行，而且固定牆壁佈局下常常走不到。localPos 是
// _debugState() 直接回傳的同一個物件參考，沒有按鍵時 updateMovement() 不會覆寫它。
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

async function teleport(page, x, y) {
  await page.evaluate(
    (p) => {
      const pos = window.PriTestMidnight._debugState().localPos;
      pos.x = p.x;
      pos.y = p.y;
    },
    { x, y }
  );
  await page.waitForTimeout(250);
}

// 共享池獎勵：**走真正的抽選→投票流程**，不是直接寫 resolvedBy。
// 這一段就是使用者回報那個卡關 bug 的所在地——maybeResolveSharedRewardVote() 要「全體
// participants 都投完票」才會決定得主，而這個判定原本沒有任何時限。既有的
// field_floor_progress_check.js 直接寫 resolvedBy，正好把這條路徑整個繞過去，所以一直
// 測不出來。回傳「這個點這一層有幾筆共享池獎勵、最後有沒有全部 resolvedBy」。
async function resolveSharedRewardsViaUi(page, pointId) {
  const ids = await page.evaluate((id) => {
    const trig = (window.PriTestMidnight._debugState().fieldTriggers || {})[id] || {};
    return Object.keys(trig.sharedRewards || {}).filter((rid) => !trig.sharedRewards[rid].resolvedBy);
  }, pointId);
  if (!ids.length) return { count: 0, allResolved: true };
  // 獎勵清單彈窗是「有未解決獎勵就自動彈出」，沒有固定的開啟鍵，而且被關掉之後
  // （rewardModalDismissed）就再也點不到列上的按鈕。因此這裡改呼叫 midnight.js 為此開出的
  // 兩個 debug 入口——它們就是那兩顆按鈕的 onclick 所呼叫的同一個 revealSharedReward()／
  // voteSharedReward()，得主判定仍由每幀輪詢的 maybeResolveAllSharedRewardVotes() 負責。
  await page.evaluate(
    (args) => {
      const M = window.PriTestMidnight;
      args.ids.forEach((rid) => M._debugRevealSharedReward(args.pointId, rid));
    },
    { pointId, ids }
  );
  await page.waitForTimeout(600);
  await page.evaluate(
    (args) => {
      const M = window.PriTestMidnight;
      args.ids.forEach((rid) => M._debugVoteSharedReward(args.pointId, rid, "take"));
    },
    { pointId, ids }
  );
  // 等每幀輪詢的 maybeResolveAllSharedRewardVotes() 把得主決定出來
  await page
    .waitForFunction(
      (id) => {
        const trig = (window.PriTestMidnight._debugState().fieldTriggers || {})[id] || {};
        return Object.keys(trig.sharedRewards || {}).every((rid) => !!trig.sharedRewards[rid].resolvedBy);
      },
      pointId,
      { timeout: 8000 }
    )
    .catch(() => {});
  const left = await page.evaluate((id) => {
    const trig = (window.PriTestMidnight._debugState().fieldTriggers || {})[id] || {};
    return Object.keys(trig.sharedRewards || {}).filter((rid) => !trig.sharedRewards[rid].resolvedBy);
  }, pointId);
  return { count: ids.length, allResolved: left.length === 0, left };
}

// 個人待領取清單：這條路徑不是本次 bug 的所在（也沒有「全員投票」的門檻），直接寫
// resolved 讓閘門開起來即可，UI 驗證交給 optimize_2026_09_12_check.js。
async function resolvePersonalRewards(page, gameId, pointId) {
  const personal = await page.evaluate((id) => {
    const D = window.PriTestMidnight._debugState();
    const out = [];
    Object.keys(D.pendingRewards || {}).forEach((tokenId) => {
      const list = D.pendingRewards[tokenId] || {};
      Object.keys(list).forEach((rid) => {
        if (!list[rid].resolved && list[rid].sourcePointId === id) out.push({ tokenId, id: rid });
      });
    });
    return out;
  }, pointId);
  if (!personal.length) return personal;
  await page.evaluate(
    (args) => {
      const GS = window.PriTestGameStorage;
      return Promise.all(
        args.personal.map((e) => GS.rtSet(args.gameId, "cloud", "pendingRewards/" + e.tokenId + "/" + e.id + "/resolved", true))
      );
    },
    { gameId, personal }
  );
  await page.waitForTimeout(300);
  return personal;
}

async function resolveFloorRewards(page, gameId, pointId) {
  const shared = await resolveSharedRewardsViaUi(page, pointId);
  const personal = await resolvePersonalRewards(page, gameId, pointId);
  return { shared, personal };
}

async function closeRewardModal(page) {
  await page.evaluate(() => {
    const m = document.getElementById("midnight-reward-modal");
    const close = document.getElementById("btn-midnight-reward-close");
    if (m && !m.hidden && close) close.click();
  });
}

// 跑完某個點的 1 層：P1 進入 → 立即進入 → 打字機 → （有敵人就直接把 HP 設成 0）→
// 解決獎勵 → 等 fieldProgress 推進。回傳推進後的 progress。
async function runFloorCycle(p1, gameId, pt, label) {
  const prior = await p1.evaluate((id) => (window.PriTestMidnight._debugState().fieldProgress || {})[id], pt.id);
  const priorFloorIndex = prior ? prior.floorIndex : -1;

  await closeRewardModal(p1);
  await p1.waitForFunction(() => !document.getElementById("btn-midnight-field-enter").hidden, { timeout: 8000 });
  await p1.dispatchEvent("#btn-midnight-field-enter", "click");
  // 不等滿 10 秒邀請時限：按「立即進入」把 inviteDeadline 改成現在（跟玩家操作同一顆按鈕）
  await p1.waitForFunction(
    (id) => {
      const t = (window.PriTestMidnight._debugState().fieldTriggers || {})[id];
      return !!(t && t.status === "inviting");
    },
    pt.id,
    { timeout: 8000 }
  );
  await p1.evaluate(() => {
    const btn = document.querySelector("#midnight-field-invite-status [data-role=force-enter]");
    if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await p1.waitForFunction(
    (id) => {
      const t = (window.PriTestMidnight._debugState().fieldTriggers || {})[id];
      return !!(t && t.status !== "inviting");
    },
    pt.id,
    { timeout: 20000 }
  );
  await p1.waitForFunction(
    (id) => !!(window.PriTestMidnight._debugState().fieldTypewriterDoneFor || {})[id],
    pt.id,
    { timeout: 25000 }
  );
  // 分歧投票：單一 participant 也要等 FIELD_VOTE_TIME_LIMIT_MS 的 fallback（或和平通過）。
  // 等待條件必須是「resolved **且已指派敵人**」而不是只等 resolved——maybeAssignFieldEnemy()
  // 是在 resolve transaction 的 .then() 才寫 enemyFamilyId，只等 status 會在敵人還沒指派好
  // 的瞬間就往下跑，於是下面的「把 HP 設成 0」什麼都沒做，敵人一直活著、樓層永遠不推進
  // （這是腳本自己的時序 bug，第一版實測讓 card 2/5/6 誤報失敗）。和平通過的樓層沒有敵人，
  // 靠 fieldProgress 已推進這個條件收尾。
  await p1.waitForFunction(
    (args) => {
      const s = window.PriTestMidnight._debugState();
      const t = (s.fieldTriggers || {})[args.pointId];
      const p = (s.fieldProgress || {})[args.pointId];
      return !!((t && t.status === "resolved" && t.enemyFamilyId) || (p && p.floorIndex > args.priorFloorIndex));
    },
    { pointId: pt.id, priorFloorIndex },
    { timeout: 45000 }
  );
  const trigNow = await p1.evaluate((id) => (window.PriTestMidnight._debugState().fieldTriggers || {})[id], pt.id);
  if (trigNow && trigNow.enemyFamilyId) {
    await p1.evaluate(
      (a) => window.PriTestGameStorage.rtSet(a.gameId, "cloud", "fieldEnemyHp/" + a.pointId, 0),
      { gameId, pointId: pt.id }
    );
    await p1.waitForTimeout(500);
  }
  const rewardInfo = await resolveFloorRewards(p1, gameId, pt.id);
  await p1.waitForFunction(
    (args) => {
      const p = (window.PriTestMidnight._debugState().fieldProgress || {})[args.pointId];
      return !!p && typeof p.floorIndex === "number" && p.floorIndex > args.priorFloorIndex;
    },
    { pointId: pt.id, priorFloorIndex },
    { timeout: 30000 }
  ).catch(() => {});
  const rewardInfo2 = await resolveFloorRewards(p1, gameId, pt.id);
  await closeRewardModal(p1);
  return {
    priorFloorIndex,
    sharedSeen: rewardInfo.shared.count + rewardInfo2.shared.count,
    sharedAllResolved: rewardInfo.shared.allResolved && rewardInfo2.shared.allResolved,
    progress: await p1.evaluate((id) => (window.PriTestMidnight._debugState().fieldProgress || {})[id], pt.id),
  };
}

(async () => {
  const browser = await chromium.launch();
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();
  [p1, p2].forEach((pg, i) => pg.on("pageerror", (e) => console.log(`  [pageerror P${i + 1}] ` + e.message)));

  try {
    await enableEmulatorFlag(p1);
    await enableEmulatorFlag(p2);

    // ---------------- ① 資料層：全板塊×全分歧的幽靈樓層掃描 ----------------
    console.log("=== ① 全板塊資料層：不得出現打不到的幽靈樓層 ===");
    await p1.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    const ghosts = await p1.evaluate(() => {
      const F = window.PriTestFields;
      const bad = [];
      F.list().forEach((card) => {
        const declared = typeof card.floorCount === "number" ? card.floorCount : 0;
        (card.branches || []).forEach((b, i) => {
          const bn = (b.floors || []).length;
          const count = bn && declared ? Math.min(declared, bn) : bn || declared || 1;
          for (let fi = 0; fi < count; fi++) {
            if (!(b.floors || [])[fi]) bad.push(`${card.id}#${i}:${fi}`);
          }
        });
      });
      return { bad, cards: F.list().length };
    });
    assert(ghosts.cards >= 14, "掃到全部卡牌資料", ghosts);
    assert(ghosts.bad.length === 0, "全部卡牌×分歧在 min(卡面, 分歧) 之後都沒有幽靈樓層", ghosts.bad.slice(0, 10));

    // ---------------- 建立雙人場 ----------------
    console.log("=== 建立雙人測試場 ===");
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
      return { gameId: s.gameId, mySlot: s.mySlot, points: s.map.points };
    });
    const slot2 = await p2.evaluate(() => window.PriTestMidnight._debugState().mySlot);
    assert(!!slot2 && slot2 !== st.mySlot, "兩台裝置各自佔到不同席位", { p1: st.mySlot, p2: slot2 });
    // 封牢（card 9 / evergaol）要持有石劍鑰匙才進得去，先發一把給 P1，讓這一型也能測到。
    await p1.evaluate(() => window.PriTestMidnight._debugGrantConsumable("item_stonesword_key", 1));
    await p1.waitForTimeout(300);

    // ---------------- ①-b 共享池獎勵卡死：不依賴地圖種子的定點回歸 ----------------
    // 使用者回報的卡關根因：共享池獎勵的「全員投完票才決定得主」**完全沒有時限**。
    // 獎勵清單是「有未解決獎勵就自動彈出」、沒有任何重新開啟的入口，玩家一旦按了關閉
    // 就再也叫不出那顆［拿取］；參加者中途離線也一樣。只要有一票投不出來：
    // resolvedBy 永遠不寫 → fieldRewardGateOpen() 永遠 false →
    // maybeClearFieldTriggerAfterRewardGate() 永遠不清空 fieldTrigger → 樓層永久卡死，
    // 其他玩家靠近時看到的就一直是「參加探索／準備會合中…」。
    // 下面每張卡牌的實跑會不會碰到共享池獎勵取決於地圖種子，所以這裡人工 seed 一筆，
    // 確保這個回歸點每次都真的被測到。兩個情境各測一次：
    //   ①有人正常投票 → 立刻決定得主
    //   ②完全沒有人動作（沒人按抽選、沒人投票）→ 逾時後系統自動收尾，不得永久卡住
    console.log("=== ①-b 共享池獎勵定點回歸（人工 seed）===");
    async function seedSharedRewardProbe(pointId, extra) {
      await p1.evaluate(
        (a) => {
          const GS = window.PriTestGameStorage;
          const D = window.PriTestMidnight._debugState();
          const participants = {};
          participants[D.mySlot] = true;
          const entry = { kind: "rune", value: 5, resolved: false };
          Object.keys(a.extra || {}).forEach((k) => (entry[k] = a.extra[k]));
          return GS.rtSet(a.gameId, "cloud", "fieldTrigger/" + a.pointId, {
            status: "resolved",
            initiatedBy: D.mySlot,
            startedAt: Date.now(),
            inviteDeadline: Date.now(),
            enterAt: Date.now(),
            branchIndex: 0,
            floorIndex: 0,
            participants: participants,
            sharedRewards: { srwProbe: entry },
          });
        },
        { gameId: st.gameId, pointId, extra: extra || {} }
      );
      await p1.waitForFunction(
        (id) => !!(window.PriTestMidnight._debugState().fieldTriggers || {})[id],
        pointId,
        { timeout: 8000 }
      );
    }
    async function waitProbeResolved(pointId, timeout) {
      return p1
        .waitForFunction(
          (id) => {
            const t = (window.PriTestMidnight._debugState().fieldTriggers || {})[id] || {};
            return !!(t.sharedRewards && t.sharedRewards.srwProbe && t.sharedRewards.srwProbe.resolvedBy);
          },
          pointId,
          { timeout }
        )
        .then(() => true)
        .catch(() => false);
    }
    async function clearProbe(pointId) {
      await p1.evaluate(
        (a) => window.PriTestGameStorage.rtSet(a.gameId, "cloud", "fieldTrigger/" + a.pointId, null),
        { gameId: st.gameId, pointId }
      );
      await p1.waitForTimeout(300);
    }

    const probeA = "sharedreward_probe_vote";
    await seedSharedRewardProbe(probeA);
    await p1.evaluate((id) => window.PriTestMidnight._debugRevealSharedReward(id, "srwProbe"), probeA);
    await p1.waitForTimeout(500);
    await p1.evaluate((id) => window.PriTestMidnight._debugVoteSharedReward(id, "srwProbe", "take"), probeA);
    assert(await waitProbeResolved(probeA, 10000), "共享池獎勵：參加者投完票後立刻決定得主");
    await clearProbe(probeA);

    // 情境②：完全沒有人動作。把 deadline 直接塞成「已經過期」，避免測試真的等 45 秒；
    // 驗的是「逾時之後系統會自己揭示並判定」這條路徑存在，不是時間長度本身。
    const probeB = "sharedreward_probe_timeout";
    await seedSharedRewardProbe(probeB, { revealDeadline: Date.now() - 1000, voteDeadline: Date.now() - 1000 });
    const timedOutResolved = await waitProbeResolved(probeB, 15000);
    const probeBState = await p1.evaluate((id) => {
      const t = (window.PriTestMidnight._debugState().fieldTriggers || {})[id] || {};
      return (t.sharedRewards || {}).srwProbe || null;
    }, probeB);
    assert(
      timedOutResolved,
      "共享池獎勵：沒有任何人按抽選／投票時，逾時後系統自動收尾（樓層不會永久卡死）",
      probeBState
    );
    await clearProbe(probeB);

    // 地圖上每一種卡牌各取 1 個點（含坑道 card_6）
    const NON_FIELD = { sorcerer: true, merchant: true, strong_enemy: true, random_event: true, blessing: true };
    const byCard = {};
    st.points.forEach((pt) => {
      if (NON_FIELD[pt.type]) return;
      if (!pt.card) return;
      if (!byCard[pt.card]) byCard[pt.card] = pt;
    });
    const targets = Object.keys(byCard).sort();
    console.log("  地圖上可測的卡牌：" + targets.join("、"));
    assert(targets.length >= 3, "地圖上至少有 3 種可測的板塊", targets);
    assert(targets.indexOf("6") !== -1, "地圖上有坑道（card 6，使用者點名要測的板塊）", targets);
    let sharedVoteFloors = 0;

    // ---------------- ② 執行期：每一種卡牌跑 1 層 ----------------
    for (const card of targets) {
      const pt = byCard[card];
      console.log(`\n=== ② 卡牌 ${card}（${pt.type}／${pt.id}）雙人樓層推進 ===`);
      // P1 傳送到點上並進入；P2 先待在遠處，等 P1 進去之後再靠過來（重現使用者情境：
      // 1 人進板塊、其他人在外面）。
      await teleport(p1, pt.x + 0.5, pt.y + 0.5);
      await teleport(p2, pt.x + 0.5, pt.y + 6.5);
      const enterable = await p1
        .waitForFunction(() => !document.getElementById("btn-midnight-field-enter").hidden, { timeout: 6000 })
        .then(() => true)
        .catch(() => false);
      if (!enterable) {
        console.log("    （這個點目前不可進入——可能是未解鎖的 Q 或缺鑰匙的封牢，略過）");
        continue;
      }
      const cycle = await runFloorCycle(p1, st.gameId, pt, card);
      assert(
        cycle.progress && cycle.progress.floorIndex > cycle.priorFloorIndex,
        `卡牌 ${card}：第 1 層踏破後 fieldProgress.floorIndex 有推進`,
        cycle
      );
      if (cycle.sharedSeen > 0) {
        sharedVoteFloors++;
        // 共享池獎勵必須靠真正的「抽選→拿取」流程走完並決定得主，閘門才會開、樓層才推得動。
        assert(cycle.sharedAllResolved, `卡牌 ${card}：共享池獎勵靠投票流程全部決定得主`, cycle);
      }
      // P2 在 P1 打完之後才靠過來
      await teleport(p2, pt.x + 0.5, pt.y + 0.5);
      await p2.waitForTimeout(800);

      const cleared = !!(cycle.progress && cycle.progress.cleared);
      // 核心斷言：還有下一層時，兩台裝置都必須回到「可以進入下一層」，
      // 不可以有任何一台卡在「參加探索（探索會合）」。
      const view = async (pg) =>
        pg.evaluate((id) => {
          const D = window.PriTestMidnight._debugState();
          const hidden = (elId) => {
            const e = document.getElementById(elId);
            return !e || e.hidden;
          };
          return {
            trig: (D.fieldTriggers || {})[id] || null,
            progress: (D.fieldProgress || {})[id] || null,
            enterVisible: !hidden("midnight-field-enter-prompt") && !hidden("btn-midnight-field-enter"),
            lateJoinVisible: !hidden("midnight-field-late-join-prompt"),
            bannerVisible: !hidden("midnight-field-banner"),
            nearbyLateJoin: !!D.nearbyLateJoinPoint,
          };
        }, pt.id);

      const okP1 = await p1
        .waitForFunction(
          (a) => {
            const D = window.PriTestMidnight._debugState();
            const p = (D.fieldProgress || {})[a.id] || {};
            if (p.cleared) return true;
            const btn = document.getElementById("btn-midnight-field-enter");
            const prompt = document.getElementById("midnight-field-enter-prompt");
            return !!(prompt && !prompt.hidden && btn && !btn.hidden);
          },
          { id: pt.id },
          { timeout: 15000 }
        )
        .then(() => true)
        .catch(() => false);
      const v1 = await view(p1);
      assert(okP1, `卡牌 ${card}：P1（進入者）踏破後回到「進入下一層」，沒有卡住`, v1);

      const okP2 = await p2
        .waitForFunction(
          (a) => {
            const D = window.PriTestMidnight._debugState();
            const p = (D.fieldProgress || {})[a.id] || {};
            if (p.cleared) return true;
            const prompt = document.getElementById("midnight-field-enter-prompt");
            const btn = document.getElementById("btn-midnight-field-enter");
            const lateJoin = document.getElementById("midnight-field-late-join-prompt");
            return !!(prompt && !prompt.hidden && btn && !btn.hidden && lateJoin && lateJoin.hidden);
          },
          { id: pt.id },
          { timeout: 15000 }
        )
        .then(() => true)
        .catch(() => false);
      const v2 = await view(p2);
      assert(okP2, `卡牌 ${card}：P2（沒進去的另一名玩家）看到的是「進入」而不是卡死的「參加探索」`, v2);

      if (!cleared) {
        assert(!v1.trig, `卡牌 ${card}：舊的 fieldTrigger 已被清空（下一層才進得去）`, v1.trig);
      }
    }

    console.log("\n（實跑中實際碰到共享池獎勵的樓層數：" + sharedVoteFloors + "）");

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
