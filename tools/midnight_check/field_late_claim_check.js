// midnight（即時制擴張版）樓層推進／後補領獎誤判 回歸測試——Firebase Local Emulator版，
// 沿用 field_floor_progress_check.js／emulator_sync_check.js 同一套「連本機emulator、
// 不觸發App Check」手法與走位工具。
//
// 這支腳本針對 2026-09-10 使用者回報的兩個現象各建立一個最小重現：
//   ① 過完第一層、獎勵領完關閉後，仍然錯誤跳出「後補領取獎勵」（late-claim）提示。
//      根因：參與紀錄原本只是 pushPerPlayerReward() 的 directSlots 副產品，而該函式在
//      「這一層沒有任何 perPerson 戰利品」時直接 return（實際資料裡這種樓層佔多數，
//      例如 card_2 的「大教會（1）」「大教會（炎）」「丘上的大教會」第1層 reward 只有
//      tieredChoice）。樓層推進時 fieldTrigger 被清空，updateNearbyFieldPoint() 就再也
//      查不到「我其實是這一層的 participant」。
//      修正後：maybeAdvanceFieldProgressAfterFloorClear() 無條件把參與席位寫進
//      fieldProgress/{id}/participatedSlots（同一個 ledger 節點，不受 trigger 清空影響）。
//   ② 按「進入下一層」（樓層進度顯示 2/2）後無法真正進入，永久卡住。
//      根因：card.floorCount 與「這個點實際採用的分歧 floors 陣列長度」不一致
//      （fields_data_2.js card_6「坑道」floorCount:2，但分歧「倒下的大結晶（大空洞）」
//      只有 1 層），fieldFloorForTrig() 取到 undefined，maybeAssignFieldEnemy() 的
//      `if (!floor) return` 靜默放棄，樓層永遠不再推進。
//      修正後：fieldFloorCountForCard() 取 min(卡面floorCount, 分歧實際floors長度)。
//
// 使用前準備（跟 field_floor_progress_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8791 --directory dist
//   3. npm install（本資料夾內，僅需一次）
//   4. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node field_late_claim_check.js

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const META_WAIT_MS = 15000;

function assert(cond, label, results) {
  results.push({ label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label);
}

async function enableEmulatorFlag(page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
    } catch (e) {}
  });
}

async function joinLobby(page, passcode) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", passcode);
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
}

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

async function walkNearAny(page, candidates, radius, maxRoundsPerCandidate) {
  const pos0 = await page.evaluate(() => window.PriTestMidnight._debugState().localPos);
  const sorted = candidates
    .slice()
    .sort((a, b) => Math.hypot(a.x - pos0.x, a.y - pos0.y) - Math.hypot(b.x - pos0.x, b.y - pos0.y));
  for (const cand of sorted) {
    const ok = await walkNear(page, cand.x + 0.5, cand.y + 0.5, radius, maxRoundsPerCandidate);
    if (ok) return cand;
  }
  return null;
}

// 跑完「一層」：按進入 → 邀請時限 → 打字機 → 選項判定 → （有敵人就直接把HP seed成0）→
// 等 fieldProgress.floorIndex 真的比進來時前進。等待條件必須跟「進入這個函式當下的舊值」
// 比較（priorFloorIndex），理由見 field_floor_progress_check.js 同名函式的長註解。
async function runOneFloorCycle(page, gameId, pt, results, label) {
  const priorProgress = await page.evaluate((pointId) => (window.PriTestMidnight._debugState().fieldProgress || {})[pointId], pt.id);
  const priorFloorIndex = priorProgress && typeof priorProgress.floorIndex === "number" ? priorProgress.floorIndex : -1;

  await page.waitForFunction(() => !document.getElementById("btn-midnight-field-enter").hidden, { timeout: 8000 });
  await page.click("#btn-midnight-field-enter");
  try {
    await page.waitForFunction(
      (pointId) => {
        const t = (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId];
        return t && t.status !== "inviting";
      },
      pt.id,
      { timeout: 20000 }
    );
  } catch (e) {
    const diag = await page.evaluate((pointId) => {
      const s = window.PriTestMidnight._debugState();
      return {
        nearbyFieldPoint: s.nearbyFieldPoint && s.nearbyFieldPoint.id,
        activeEncounter: s.activeEncounter && s.activeEncounter.id,
        trig: (s.fieldTriggers || {})[pointId] || null,
        progress: (s.fieldProgress || {})[pointId] || null,
        localPos: s.localPos,
        enterBtnHidden: document.getElementById("btn-midnight-field-enter").hidden,
        enterBtnDisabled: document.getElementById("btn-midnight-field-enter").disabled,
        rewardModalOpen: !document.getElementById("midnight-reward-modal").hidden,
      };
    }, pt.id);
    console.log("    [DIAG] 進入後trigger沒出現：" + JSON.stringify(diag));
    throw e;
  }
  await page.waitForFunction(
    (pointId) => !!(window.PriTestMidnight._debugState().fieldTypewriterDoneFor || {})[pointId],
    pt.id,
    { timeout: 30000 }
  );
  await page.waitForFunction(
    (args) => {
      const s = window.PriTestMidnight._debugState();
      const t = (s.fieldTriggers || {})[args.pointId];
      const p = (s.fieldProgress || {})[args.pointId];
      return !!((t && t.status === "resolved" && t.enemyFamilyId) || (p && p.floorIndex > args.priorFloorIndex));
    },
    { pointId: pt.id, priorFloorIndex },
    { timeout: 40000 }
  );
  const trigNow = await page.evaluate((pointId) => (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId], pt.id);
  if (trigNow && trigNow.enemyFamilyId) {
    console.log("    （這一層有敵人：" + trigNow.enemyFamilyId + "/" + trigNow.enemyId + "，直接seed HP=0觸發擊殺）");
    await page.evaluate(
      ({ gameId, pointId }) => window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/" + pointId, 0),
      { gameId, pointId: pt.id }
    );
  } else {
    console.log("    （這一層和平通過，無需戰鬥）");
  }
  await page.waitForFunction(
    (args) => {
      const p = (window.PriTestMidnight._debugState().fieldProgress || {})[args.pointId];
      return !!p && typeof p.floorIndex === "number" && p.floorIndex > args.priorFloorIndex;
    },
    { pointId: pt.id, priorFloorIndex },
    { timeout: 15000 }
  );
  const after = await page.evaluate((pointId) => (window.PriTestMidnight._debugState().fieldProgress || {})[pointId], pt.id);
  console.log(
    "    " + label + " 結束：branchIndex=" + after.branchIndex + " floorIndex=" + after.floorIndex + " cleared=" + after.cleared
  );
  return after;
}

// 領獎清單如果彈出來，全部確認掉（模擬使用者「領完關閉」）。沒有彈出就直接略過。
async function drainRewardModal(page) {
  for (let i = 0; i < 12; i++) {
    const open = await page.evaluate(() => {
      const m = document.getElementById("midnight-reward-modal");
      return !!m && !m.hidden;
    });
    if (!open) return;
    const clicked = await page.evaluate(() => {
      const root = document.getElementById("midnight-reward-modal");
      if (!root) return "none";
      const usable = Array.prototype.slice
        .call(root.querySelectorAll("button"))
        .filter((b) => !b.disabled && b.offsetParent !== null && b.id !== "btn-midnight-reward-close");
      if (usable.length) {
        usable[0].click();
        return "item";
      }
      const close = document.getElementById("btn-midnight-reward-close");
      if (close) {
        close.click();
        return "close";
      }
      return "none";
    });
    if (clicked === "none") return;
    await page.waitForTimeout(300);
  }
  // 迴圈跑滿仍沒關掉時，最後強制關閉（rewardModalDismissed=true），模擬使用者按「關閉」。
  await page.evaluate(() => {
    const close = document.getElementById("btn-midnight-reward-close");
    if (close) close.click();
  });
  await page.waitForTimeout(300);
}

async function lateClaimVisible(page) {
  return await page.evaluate(() => {
    const box = document.getElementById("midnight-field-late-claim-prompt");
    return !!box && box.hidden === false;
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("CONSOLE-ERROR:", msg.text());
  });
  const results = [];
  try {
    await enableEmulatorFlag(page);

    console.log("=== 建立測試場並完成單人開局 ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await joinLobby(page, "1234");
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });

    const state0 = await page.evaluate(() => window.PriTestMidnight._debugState());
    const map = await page.evaluate((seed) => window.PriTestMidnightMap.generateMap(seed), state0.meta.mapSeed);
    const mySlot = state0.mySlot;
    const myTokenId = state0.myTokenId;

    // ---------------- ① 後補領獎誤判 ----------------
    console.log("\n=== ① card2（大教會，floorCount:2）：踏破第1層後不得誤判成延遲入場 ===");
    const card2Points = (map.points || []).filter((p) => p.card === "2");
    assert(card2Points.length > 0, "地圖上找得到card=2的點", results);
    const pt2 = await walkNearAny(page, card2Points, 1.2, 400);
    assert(!!pt2, "走位工具走到card2點附近", results);
    if (!pt2) throw new Error("failed to walk near card2 point");

    // 指定 branchIndex=4（card_2 的「丘上的大教會」）：這個分歧的兩層 reward 都只有
    // tieredChoice、沒有任何 perPerson 戰利品，正是現象①唯一會發作的條件
    // （pushPerPlayerReward() 在 perPerson 為 0 筆時直接 return，於是完全沒留下參與紀錄）。
    // 分歧本身是 mapSeed 決定的，不指定的話每次跑會隨機挑到有 perPerson 獎勵的分歧、
    // 測不到這個 bug。branchIndex 是 App 自己就會寫的欄位（見 maybeAdvanceFieldInvite()），
    // 這裡只是把「第一次進入時會挑到哪個分歧」提前固定，其餘 state 仍由 App 正常建立。
    await page.evaluate(
      ({ gameId, pointId }) => window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldProgress/" + pointId + "/branchIndex", 4),
      { gameId: state0.gameId, pointId: pt2.id }
    );
    await page.waitForFunction(
      (pointId) => {
        const p = (window.PriTestMidnight._debugState().fieldProgress || {})[pointId];
        return !!p && p.branchIndex === 4;
      },
      pt2.id,
      { timeout: 8000 }
    );

    const afterFloor1 = await runOneFloorCycle(page, state0.gameId, pt2, results, "card2 第1層");
    await drainRewardModal(page);
    // 讓 updateNearbyFieldPoint() 至少跑過幾幀（trigger 清空、late-claim 判斷重算）
    await page.waitForTimeout(1200);

    const progressAfter1 = await page.evaluate((pointId) => (window.PriTestMidnight._debugState().fieldProgress || {})[pointId], pt2.id);
    assert(
      !!(progressAfter1.participatedSlots && progressAfter1.participatedSlots[mySlot]),
      "第1層踏破後 fieldProgress.participatedSlots 有記到自己的席位（不論這一層有沒有perPerson獎勵）",
      results
    );
    const trigAfter1 = await page.evaluate((pointId) => (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId], pt2.id);
    assert(!trigAfter1, "第1層踏破後 fieldTrigger 已清空（允許重新按「進入」下一層）", results);
    assert(!(await lateClaimVisible(page)), "第1層踏破後【不會】跳出後補領取獎勵提示（現象①已修正）", results);
    assert(
      !(await page.evaluate((tokenId) => {
        const p = window.PriTestMidnight._debugState().fieldProgress || {};
        return Object.keys(p).some((k) => p[k].claimedBy && p[k].claimedBy[tokenId]);
      }, myTokenId)),
      "沒有任何點被誤標記成「已後補領取」",
      results
    );

    console.log("=== ① 續：按「進入」確實能進入第2層並全踏破 ===");
    const afterFloor2 = await runOneFloorCycle(page, state0.gameId, pt2, results, "card2 第2層");
    await drainRewardModal(page);
    assert(afterFloor2.branchIndex === afterFloor1.branchIndex, "第2層沿用第1層相同的branchIndex", results);
    assert(afterFloor2.floorIndex === 2, "第2層踏破後 floorIndex=2（實際:" + afterFloor2.floorIndex + "）", results);
    assert(afterFloor2.cleared === true, "第2層踏破後 cleared=true（全踏破）", results);
    await page.waitForTimeout(800);
    assert(!(await lateClaimVisible(page)), "全踏破後仍然不會跳出後補領取獎勵提示", results);

    // ---------------- ② 分歧樓層數比卡面短 → 卡樓層 ----------------
    console.log("\n=== ② card6「坑道」分歧「倒下的大結晶（大空洞）」：卡面floorCount=2但只有1層 ===");
    // 這裡刻意先指定 branchIndex=3（card_6 的第4個分歧），因為分歧本身是 mapSeed 決定的，
    // 不指定就無法穩定重現。branchIndex 是 App 自己就會寫的欄位（見
    // maybeAdvanceFieldInvite()/maybeAdvanceFieldProgressAfterFloorClear()），這裡只是把
    // 「這個點第一次進入時會挑到哪個分歧」提前固定下來，不是手工捏造不完整的 state
    // （CLAUDE.md §4.4）——其餘欄位仍由 App 自己在正常流程中建立。
    const card6Points = (map.points || []).filter((p) => p.card === "6");
    assert(card6Points.length > 0, "地圖上找得到card=6（坑道）的點", results);

    const card6ShortBranch = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const pt = (s.map.points || []).find((p) => p.card === "6");
      if (!pt) return null;
      // 用一個帶同樣card、但id不同的假點來問：branchIndex由mapSeed決定，所以這裡直接
      // 讀card_6分歧3的長度跟卡面floorCount做對照說明用。
      const data = window.PriTestFields.get("card_6");
      return {
        cardFloorCount: data.floorCount,
        branch3Floors: data.branches[3].floors.length,
        branch3Name: data.branches[3].name.zh,
      };
    });
    console.log("    card_6 資料對照：" + JSON.stringify(card6ShortBranch));
    assert(
      !!card6ShortBranch && card6ShortBranch.cardFloorCount > card6ShortBranch.branch3Floors,
      "確認測試前提仍成立：card_6卡面floorCount(" +
        (card6ShortBranch && card6ShortBranch.cardFloorCount) +
        ")大於分歧「" +
        (card6ShortBranch && card6ShortBranch.branch3Name) +
        "」的實際樓層數(" +
        (card6ShortBranch && card6ShortBranch.branch3Floors) +
        ")",
      results
    );
    const pt6 = await walkNearAny(page, card6Points, 1.4, 900);
    if (!pt6) {
      console.log("  [SKIP] 走位工具沒能走到任何card6點附近（固定牆壁佈局擋住），略過②");
    } else {
      await page.evaluate(
        ({ gameId, pointId }) => window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldProgress/" + pointId + "/branchIndex", 3),
        { gameId: state0.gameId, pointId: pt6.id }
      );
      await page.waitForFunction(
        (pointId) => {
          const p = (window.PriTestMidnight._debugState().fieldProgress || {})[pointId];
          return !!p && p.branchIndex === 3;
        },
        pt6.id,
        { timeout: 8000 }
      );
      const after6 = await runOneFloorCycle(page, state0.gameId, pt6, results, "card6 第1層（1層分歧）");
      await drainRewardModal(page);
      assert(after6.branchIndex === 3, "card6 沿用指定的短分歧 branchIndex=3", results);
      assert(
        after6.cleared === true,
        "短分歧只有1層時，踏破後直接 cleared=true，不會停在「還有第2層」的幽靈樓層（現象②已修正，實際cleared=" +
          after6.cleared +
          "）",
        results
      );
      await page.waitForTimeout(800);
      // 全踏破後fieldTrigger刻意保留（供地圖圖示判斷已清除，見
      // maybeAdvanceFieldProgressAfterFloorClear()說明），因此renderFieldOverlay()是靠
      // 隱藏整個#midnight-field-enter-prompt容器來擋住再次進入，不是動按鈕本身的hidden。
      const enterHidden = await page.evaluate(() => {
        const box = document.getElementById("midnight-field-enter-prompt");
        const btn = document.getElementById("btn-midnight-field-enter");
        return !box || box.hidden === true || !btn || btn.hidden === true;
      });
      assert(enterHidden, "全踏破後「進入」提示不再顯示（不會再出現一個進不去的下一層）", results);
    }

    // ②-a 靜態不變式：所有「已經決定好分歧」（fieldProgress有branchIndex）的地圖點，
    // 回報的樓層數都不可以超過該分歧 floors 陣列的實際長度——超過就代表存在
    // 「按得下進入、但取不到樓層資料」的幽靈樓層，也就是現象②的成因。直接呼叫被測程式
    // 自己的 fieldFloorCountForCard()（_debugFieldFloorCount），不在測試裡重寫一份判斷。
    // 只檢查已決定分歧的點：還沒進入過的點分歧是mapSeed當下才決定的，拿它跟「所有分歧」
    // 比對沒有意義（不同分歧本來就可以有不同樓層數）。
    const ghostFloors = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const F = window.PriTestFields;
      const s = M._debugState();
      const CARD_IDS = { A: "a_start", Z: "a_golden" };
      const bad = [];
      (s.map.points || []).forEach((pt) => {
        if (!pt.card) return;
        const progress = (s.fieldProgress || {})[pt.id];
        if (!progress || typeof progress.branchIndex !== "number") return;
        const cardId = CARD_IDS[pt.card] || "card_" + String(pt.card).toLowerCase();
        const data = F.get(cardId);
        const branch = data && data.branches && data.branches[progress.branchIndex];
        const len = branch && branch.floors ? branch.floors.length : 0;
        if (!len) return;
        const reported = M._debugFieldFloorCount(pt);
        if (reported > len) {
          bad.push(pt.id + "/" + pt.card + " branch" + progress.branchIndex + " reported=" + reported + " floors=" + len);
        }
      });
      return bad;
    });
    assert(
      ghostFloors.length === 0,
      "已決定分歧的地圖點都沒有「回報樓層數 > 分歧實際樓層數」的幽靈樓層（不合格項：" + JSON.stringify(ghostFloors) + "）",
      results
    );

    // ---------------- ③ HUD 疊層順序 ----------------
    console.log("\n=== ③ 左上/右上 HUD 必須疊在上方樓層資訊欄之上（桌機＋手機寬度各驗一次） ===");
    for (const vp of [
      { width: 1280, height: 800, label: "桌機1280x800" },
      { width: 390, height: 844, label: "手機390x844" },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(400);
      const z = await page.evaluate(() => {
        const val = (id) => {
          const e = document.getElementById(id);
          if (!e) return null;
          return parseInt(window.getComputedStyle(e).zIndex, 10);
        };
        return {
          left: val("midnight-hud-top-left"),
          right: val("midnight-hud-top-right"),
          menu: val("midnight-menu-panel"),
          banner: val("midnight-field-banner"),
          enterPrompt: val("midnight-field-enter-prompt"),
          attackWarn: val("midnight-incoming-attack-warning"),
          rewardModal: val("midnight-reward-modal"),
          charSheet: val("midnight-character-sheet-modal"),
        };
      });
      console.log("    " + vp.label + " z-index: " + JSON.stringify(z));
      assert(z.left > z.banner && z.right > z.banner, vp.label + "：左上/右上HUD z-index 高於樓層資訊欄", results);
      assert(z.left > z.attackWarn && z.right > z.attackWarn, vp.label + "：左上/右上HUD z-index 高於戰鬥攻擊警示疊層", results);
      assert(z.menu === z.right, vp.label + "：選單面板跟右上HUD同層（展開選單不會被資訊欄蓋住）", results);
      assert(
        z.left < z.rewardModal && z.left < z.charSheet,
        vp.label + "：左上/右上HUD 仍低於獎勵清單／角色面板等彈窗（不會戳穿modal）",
        results
      );
      // 實際命中測試：資訊欄（此時應該正顯示著剛全踏破的板塊banner）跟左上/右上HUD
      // 真的有重疊的座標時，document.elementFromPoint()回傳的必須是HUD內部的元素，
      // 不是被資訊欄蓋掉。沒有重疊（桌機寬度通常不會重疊）就SKIP，不硬造失敗。
      const hit = await page.evaluate(() => {
        const banner = ["midnight-field-banner", "midnight-field-enter-prompt", "midnight-field-late-claim-prompt"]
          .map((id) => document.getElementById(id))
          .filter((e) => e && !e.hidden && e.getBoundingClientRect().width > 0)[0];
        if (!banner) return { skip: "沒有正在顯示的上方資訊欄" };
        const br = banner.getBoundingClientRect();
        const out = {};
        ["midnight-hud-top-left", "midnight-hud-top-right"].forEach((id) => {
          const hud = document.getElementById(id);
          if (!hud || hud.hidden) return (out[id] = "hud未顯示");
          const hr = hud.getBoundingClientRect();
          const x = Math.max(br.left, hr.left) + 2;
          const y = Math.max(br.top, hr.top) + 2;
          const overlapW = Math.min(br.right, hr.right) - Math.max(br.left, hr.left);
          const overlapH = Math.min(br.bottom, hr.bottom) - Math.max(br.top, hr.top);
          if (overlapW <= 4 || overlapH <= 4) return (out[id] = "no-overlap");
          const el = document.elementFromPoint(x, y);
          out[id] = el && hud.contains(el) ? "hud-on-top" : "covered-by:" + (el && (el.id || el.className || el.tagName));
        });
        return out;
      });
      console.log("    " + vp.label + " 命中測試: " + JSON.stringify(hit));
      ["midnight-hud-top-left", "midnight-hud-top-right"].forEach((id) => {
        if (!hit || hit.skip || hit[id] === "no-overlap" || hit[id] === "hud未顯示") return;
        assert(hit[id] === "hud-on-top", vp.label + "：" + id + " 與資訊欄重疊處實際命中的是HUD本身", results);
      });
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
