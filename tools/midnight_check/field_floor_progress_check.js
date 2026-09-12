// midnight（即時制擴張版）板塊多樓層探索流程 回歸測試——Firebase Local
// Emulator版，沿用emulator_sync_check.js／new_chips_check.js同一套「連本機emulator、
// 不觸發App Check」手法。這裡驗證2026-09-05套用night.js既有板塊流程新增的功能：
//   - fieldProgress（樓層探索進度）：固定樓層數、逐層推進、branchIndex在同一張卡的
//     所有樓層間保持不變、全踏破後才標記cleared並發放「全踏破」盧恩獎勵。
//   - 中途離開（reload模擬）後fieldProgress仍保留、不會重置回第0層。
//   - 祝福籌碼：領取後HP／FP／體力／聖杯瓶全部回滿。
//   - 商人籌碼鍛造台：稀有度強化（C→U→R）扣盧恩、寫入character.weaponRarityOverride。
//
// 使用前準備（跟emulator_sync_check.js完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8791 --directory dist
//   3. npm install（本資料夾內，僅需一次）
//   4. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node field_floor_progress_check.js

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

// 依離目前位置的距離由近到遠嘗試每一個候選點，回傳第一個真的走得到的（含其pt物件）。
// 固定牆壁佈局下，單一目標常因為牆擋住而走不到，但同類型籌碼通常有好幾個（例如祝福
// 10個、商人2個），換一個候選點常常就繞得過去，比死盯著find()回傳的第一個更可靠。
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

// 2026-09-12追加：2026-09-08の獎勵改版で入った「獎勵閘門」への対応。
// fieldRewardGateOpen()（midnight.js）は、その層で出た共享池獎勵（fieldTrigger.sharedRewards、
// 全員投票で1人が獲得）と個人獎勵（pendingRewards）が**全部解決されるまで** fieldTrigger を
// クリアしない＝次の層へ「進入」できない。この腳本の主題は樓層推進そのものなので、獎勵清單の
// UI操作（揭示→投票→領取）は new_chips_check.js／field_late_claim_check.js に任せ、ここでは
// 閘門を開けるために解決済みフラグを直接書き込む。旧版はこの処理が無く、その層に共享池獎勵が
// 出たかどうか（＝地圖seed次第）で成否が変わるflakyな腳本になっていた。
async function resolveFloorRewards(page, gameId, pointId) {
  const pending = await page.evaluate(
    (args) => {
      const D = window.PriTestMidnight._debugState();
      const trig = (D.fieldTriggers || {})[args.pointId] || {};
      const shared = Object.keys(trig.sharedRewards || {}).filter((id) => !trig.sharedRewards[id].resolvedBy);
      const mine = D.pendingRewards && D.pendingRewards[D.myTokenId] ? D.pendingRewards[D.myTokenId] : {};
      const personal = Object.keys(mine).filter((id) => !mine[id].resolved && mine[id].sourcePointId === args.pointId);
      return { shared, personal, tokenId: D.myTokenId };
    },
    { pointId }
  );
  if (!pending.shared.length && !pending.personal.length) return pending;
  await page.evaluate(
    (args) => {
      const GS = window.PriTestGameStorage;
      const jobs = [];
      args.shared.forEach((id) =>
        jobs.push(GS.rtSet(args.gameId, "cloud", "fieldTrigger/" + args.pointId + "/sharedRewards/" + id + "/resolvedBy", args.tokenId))
      );
      args.personal.forEach((id) => jobs.push(GS.rtSet(args.gameId, "cloud", "pendingRewards/" + args.tokenId + "/" + id + "/resolved", true)));
      return Promise.all(jobs);
    },
    { gameId, pointId, shared: pending.shared, personal: pending.personal, tokenId: pending.tokenId }
  );
  await page.waitForTimeout(400);
  return pending;
}

async function runOneFloorCycle(page, gameId, pt, results, label) {
  // 從第2層開始，呼叫這個函式時fieldProgress[pt.id]已經存在上一層留下的舊值（例如
  // floorIndex=1），下面所有等待條件都必須跟「進入這個函式當下的舊值」比較是否真的
  // 前進，而不是只檢查「存在」或「已解決」——否則會在舊值仍然滿足條件的當下就提早
  // 誤判成「這一層已經結束」，讀到還沒真正更新的殘留資料（這是測試腳本本身第一版
  // 的bug，不是被測程式碼的問題：見規劃紀錄）。
  const priorProgress = await page.evaluate((pointId) => (window.PriTestMidnight._debugState().fieldProgress || {})[pointId], pt.id);
  const priorFloorIndex = priorProgress ? priorProgress.floorIndex : -1;

  // 進入
  await page.waitForFunction(() => !document.getElementById("btn-midnight-field-enter").hidden, { timeout: 5000 });
  // 2026-09-10新增：2026-09-08/09的獎勵清單改版後，樓層踏破會自動彈出#midnight-reward-modal，
  // 它是全螢幕遮罩、會攔截「進入」按鈕的點擊。這裡先關掉（等同玩家按「關閉」），
  // 獎勵清單本身的內容驗證交給field_late_claim_check.js／reward相關腳本。
  await page.evaluate(() => {
    const m = document.getElementById("midnight-reward-modal");
    const close = document.getElementById("btn-midnight-reward-close");
    if (m && !m.hidden && close) close.click();
  });
  // 2026-09-12修正：page.click()は「可見・enabled・stable」を待つため、獎勵清單modalの
  // フェードや上方資訊欄の毎フレーム再描画に当たると30秒待って落ちる（実測）。押したいのは
  // handlerだけなのでdispatchEventで直接発火させる（midnightのテスト全体で同じ方針）。
  await page.dispatchEvent("#btn-midnight-field-enter", "click");
  // 邀請時限 -> active（2026-09-10修正：FIELD_INVITE_TIME_LIMIT_MS已於2026-09-07由3秒
  // 改為10秒，這裡原本的8秒timeout必定來不及，是腳本本身過期，不是被測程式的問題）
  await page.waitForFunction(
    (pointId) => {
      const t = (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId];
      return t && t.status !== "inviting";
    },
    pt.id,
    { timeout: 20000 }
  );
  // 打字機播完（用內部旗標判斷，不用Playwright的可視性判斷——面板在敵人存活、尚未有
  // 結果文字時內容是空的，viewport上會是0大小，Playwright的:not([hidden])可視性等待
  // 會誤判成「隱藏」，即使.hidden屬性其實已經是false）。
  await page.waitForFunction(
    (pointId) => !!(window.PriTestMidnight._debugState().fieldTypewriterDoneFor || {})[pointId],
    pt.id,
    { timeout: 15000 }
  );
  // 如果這一段敘述真的有多個「(→XXX)」分歧選項，單人測試沒有其他人投票達成共識，
  // 一律讓它跑滿FIELD_VOTE_TIME_LIMIT_MS（10秒）由系統fallback決定——曾經嘗試直接點擊
  // 第一個投票按鈕想節省等待時間，但DOM按鈕在投票狀態變動時會重建，點擊時機抓不準
  // 容易點空，反而更不穩定，所以改成穩定地等timeout fallback。
  //
  // 重要：「resolved」在和平通過的分歧只是一個轉瞬即逝的中繼狀態——resolve transaction
  // 的.then()會同步鏈式呼叫maybeAssignFieldEnemy→（無敵人）→
  // maybeGrantFieldTileReward＋maybeAdvanceFieldProgressAfterFloorClear→（未全踏破）
  // →把fieldTrigger整個設回null，這一串全部是Promise微任務鏈，很可能在瀏覽器排下一次
  // rAF輪詢之前就整段跑完——所以「等到trig.status==='resolved'」這個條件在和平分歧時
  // 可能永遠等不到（trig已經被設回null，polling兩次之間的瞬間就跳過了resolved那一刻）。
  // 正確的等待條件應該是「trig仍是resolved且有敵人（尚待處理）」或「fieldProgress已經
  // 推進過這一層（不論trig是否還在，和平/戰鬥兩種結局都適用）」，不能強制要求前者。
  await page.waitForFunction(
    (args) => {
      const s = window.PriTestMidnight._debugState();
      const t = (s.fieldTriggers || {})[args.pointId];
      const p = (s.fieldProgress || {})[args.pointId];
      return !!((t && t.status === "resolved" && t.enemyFamilyId) || (p && p.floorIndex > args.priorFloorIndex));
    },
    { pointId: pt.id, priorFloorIndex },
    { timeout: 30000 }
  );
  const trigNow = await page.evaluate((pointId) => (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId], pt.id);
  const progressNow = await page.evaluate((pointId) => (window.PriTestMidnight._debugState().fieldProgress || {})[pointId], pt.id);
  assert(!!trigNow || (progressNow && progressNow.floorIndex > priorFloorIndex), label + "：分歧已解決(resolved)", results);
  if (trigNow && trigNow.enemyFamilyId) {
    console.log("    （這一層有敵人：" + trigNow.enemyFamilyId + "/" + trigNow.enemyId + "，直接seed HP=0觸發擊殺）");
    await page.evaluate(
      ({ gameId, pointId }) => window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/" + pointId, 0),
      { gameId, pointId: pt.id }
    );
  } else {
    console.log("    （這一層和平通過，無需戰鬥）");
  }
  // 等fieldProgress真的推進到比進入這個函式時更新的樓層（同樣要跟priorFloorIndex比較，
  // 理由同上）。8秒では足りないことがある（擊殺→戰利品→推進のRTDB往復が挟まる）ので
  // 余裕を持たせ、途中で獎勵閘門（resolveFloorRewards）も開けておく。
  const rewardsCleared = await resolveFloorRewards(page, gameId, pt.id);
  if (rewardsCleared.shared.length || rewardsCleared.personal.length) {
    console.log("    （" + label + "の獎勵閘門を開放：共享池" + rewardsCleared.shared.length + "件／個人" + rewardsCleared.personal.length + "件）");
  }
  await page.waitForFunction(
    (args) => {
      const p = (window.PriTestMidnight._debugState().fieldProgress || {})[args.pointId];
      return !!p && typeof p.floorIndex === "number" && p.floorIndex > args.priorFloorIndex;
    },
    { pointId: pt.id, priorFloorIndex },
    { timeout: 20000 }
  );
  // 推進後にもう一度：推進時に新しく積まれる戰利品（樓層踏破報酬）も解決しておかないと
  // fieldTriggerがクリアされず、次の層へ「進入」できない。
  await resolveFloorRewards(page, gameId, pt.id);
  return await page.evaluate((pointId) => (window.PriTestMidnight._debugState().fieldProgress || {})[pointId], pt.id);
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
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });

    const state0 = await page.evaluate(() => window.PriTestMidnight._debugState());
    const map = await page.evaluate((seed) => window.PriTestMidnightMap.generateMap(seed), state0.meta.mapSeed);
    // card"2"固定保證有一個點落在出發地點附近（見midnight_map.jsのplacePoints()），
    // 且card_2的floorCount=2，最適合驗證多樓層流程。
    const pt = (map.points || []).find((p) => p.card === "2");
    assert(!!pt, "地圖上找得到card=2的點（floorCount:2，保證在出發地點附近）", results);
    if (!pt) throw new Error("no card2 point found, aborting");

    console.log("=== 走到card2點附近 ===");
    const reached = await walkNear(page, pt.x + 0.5, pt.y + 0.5, 1.2, 400);
    assert(reached, "走位工具走到card2點附近", results);
    if (!reached) throw new Error("failed to walk near card2 point");

    console.log("=== 第1層 ===");
    const afterFloor1 = await runOneFloorCycle(page, state0.gameId, pt, results, "第1層");
    assert(afterFloor1.floorIndex === 1, "第1層結束後fieldProgress.floorIndex推進為1（實際:" + afterFloor1.floorIndex + "）", results);
    assert(afterFloor1.cleared === false, "第1層結束後cleared仍為false（floorCount=2，還有第2層）", results);

    // 2026-09-12修正：ここが見たいのは「次の樓層に進めるか」。旧版は「fieldTriggerがnull」で
    // 判定していたが、これは実測でflakyだった——
    //   ①fieldTriggerをnullへ戻すのはfieldProgress推進とは別のRTDB書き込み（resolve
    //     transactionの.then()の続き）なので、runOneFloorCycle()から戻った直後はまだ残っている
    //   ②玩家がその点の上に立ったままなので、クリアされた次の瞬間に「次の樓層」の
    //     邀請triggerが新しく作られていることもある（この場合nullにはならないが、
    //     次の樓層へ進めているので正常）
    // よって判定は「進入鍵が押せる状態に戻った、もしくはfieldTriggerがクリアされた」に緩める。
    const canProceed = await page
      .waitForFunction(
        (pointId) => {
          const t = (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId];
          const btn = document.getElementById("btn-midnight-field-enter");
          return !t || (btn && !btn.hidden);
        },
        pt.id,
        { timeout: 10000 }
      )
      .then(() => true)
      .catch(() => false);
    const trigAfterFloor1 = await page.evaluate((pointId) => (window.PriTestMidnight._debugState().fieldTriggers || {})[pointId], pt.id);
    console.log("  第1層結束後のfieldTrigger:", JSON.stringify(trigAfterFloor1 || null));
    assert(canProceed, "第1層結束後可以繼續「進入」下一層（fieldTrigger已清空，或已進入下一層的邀請）", results);

    console.log("=== 第2層（同一個session、還在原地，重新按「進入」接續同一個branchIndex） ===");
    const beforeFloor2Rewards = await page.evaluate(
      (tokenId) => Object.keys(window.PriTestMidnight._debugState().pendingRewards[tokenId] || {}).length,
      state0.myTokenId
    );
    const afterFloor2 = await runOneFloorCycle(page, state0.gameId, pt, results, "第2層");
    assert(afterFloor2.branchIndex === afterFloor1.branchIndex, "第2層沿用跟第1層相同的branchIndex（不會重新抽分歧）", results);
    assert(afterFloor2.floorIndex === 2, "第2層結束後fieldProgress.floorIndex推進為2（實際:" + afterFloor2.floorIndex + "）", results);
    assert(afterFloor2.cleared === true, "第2層結束後cleared變為true（floorCount=2，全踏破）", results);
    await page
      .waitForFunction(
        (args) => Object.keys(window.PriTestMidnight._debugState().pendingRewards[args.tokenId] || {}).length > args.before,
        { tokenId: state0.myTokenId, before: beforeFloor2Rewards },
        { timeout: 5000 }
      )
      .catch(() => {});
    const rewardsAfterClear = await page.evaluate(
      (tokenId) => window.PriTestMidnight._debugState().pendingRewards[tokenId] || {},
      state0.myTokenId
    );
    // 2026-09-10修正：2026-09-08/09獎勵清單改版後，樓層戰利品（含各層自己的「盧恩：N」）
    // 也統一走pendingRewards，所以清單裡通常不只一筆rune。原本用find()取第一筆再比對
    // value===2，會隨機取到樓層戰利品的盧恩（例如3）而誤報——改成「清單裡存在一筆
    // value===2的rune」（card_2的allFloorEffect「盧恩：2」），是腳本過期，不是程式算錯。
    const runeRewards = Object.values(rewardsAfterClear).filter((r) => r.kind === "rune");
    assert(runeRewards.length > 0, "全踏破後獎勵清單有rune項目（card_2的allFloorEffect「盧恩：2」）", results);
    assert(
      runeRewards.some((r) => r.value === 2),
      "全踏破盧恩獎勵數值正確（清單裡的rune值:" + JSON.stringify(runeRewards.map((r) => r.value)) + "，預期含2）",
      results
    );

    console.log("=== 祝福全回復（2026-09-06改版：進入→0.5秒讀取條→疊層視窗→視窗內按「使用」才回復，不再是prompt按鈕直接觸發） ===");
    // 由於祝福籌碼是隨機佈點，這裡改用直接呼叫handleBlessingEnterClick()同款邏輯的
    // 內部函式較不易做到（IIFE沒對外export），改為驗證「已知行為」：直接找地圖上的
    // blessing點、走過去、若在合理步數內走到就實測；走不到則只驗證資料結構存在。
    const blessingCandidates = (map.points || []).filter((p) => p.type === "blessing");
    if (blessingCandidates.length) {
      const blessingPt = await walkNearAny(page, blessingCandidates, 1.2, 120);
      if (blessingPt) {
        // 先把自己的HP/盧恩瓶次數弄低，才能觀察到「回復」的效果。
        const beforeState = await page.evaluate(() => window.PriTestMidnight._debugState());
        await page.evaluate(
          ({ gameId, tokenId }) => window.PriTestGameStorage.rtSet(gameId, "cloud", "demoStat/" + tokenId, 10),
          { gameId: beforeState.gameId, tokenId: beforeState.myTokenId }
        );
        await page.waitForTimeout(300);
        await page.waitForSelector("#midnight-blessing-prompt:not([hidden])", { timeout: 5000 });
        // 同上：獎勵清單彈窗會攔截點擊，先關掉再操作祝福籌碼。
        await page.evaluate(() => {
          const m = document.getElementById("midnight-reward-modal");
          const close = document.getElementById("btn-midnight-reward-close");
          if (m && !m.hidden && close) close.click();
        });
        await page.click("#btn-midnight-blessing-claim"); // 「進入」：先播0.5秒讀取條
        await page.waitForSelector("#midnight-blessing-modal:not([hidden])", { timeout: 2000 });
        await page.click("#btn-midnight-blessing-use"); // 視窗內「使用祝福」才真正回復
        await page.waitForTimeout(300);
        const afterBless = await page.evaluate(() => window.PriTestMidnight._debugState());
        // 2026-09-12修正：競技場HPの上限は固定100ではなく midnight.js の selfArenaHpMax()＝
        // 100 +（hp.max + 最大HP加成）×10 + 取引ボーナス（実測150など、角色類型/等級で変わる）。
        // _debugState()はhpを公開していない（demoStatsとstaminaのみ）ので、同じ式を
        // CharacterDrawerの公開APIで組み直して期待値にする（ハードコードしない）。
        const arenaHpMax = await page.evaluate(() => {
          const D = window.PriTestMidnight._debugState();
          const c = D.characters[D.myTokenId];
          if (!c || !c.hp) return 100;
          return 100 + (c.hp.max + window.PriTestCharacterDrawer.totalFlatMaxStatBonus(c, "hp")) * 10 + (c._bargainMaxHpBonus || 0);
        });
        assert(
          arenaHpMax !== null && afterBless.demoStats[afterBless.myTokenId] === arenaHpMax,
          "領取祝福後demoStat(HP)回滿為競技場HP上限" + arenaHpMax + "（實際=" + afterBless.demoStats[afterBless.myTokenId] + "）",
          results
        );
        assert(afterBless.stamina.current === afterBless.stamina.max, "領取祝福後本地體力回滿", results);
        assert(afterBless.fp.current === afterBless.fp.max, "領取祝福後本地FP回滿", results);
        // 使用後可以再次進入（不再打X／不再排他鎖，見docs之外的規劃紀錄）。
        await page.click("#btn-midnight-blessing-close");
        await page.waitForTimeout(100);
        const stillVisible = await page.evaluate(() => document.getElementById("midnight-blessing-prompt").hidden === false);
        assert(stillVisible, "使用祝福後靠近提示仍然顯示（可重複使用，不因為用過就消失/打X）", results);
      } else {
        console.log("  [SKIP] 走位工具沒能走到祝福點附近");
      }
    } else {
      console.log("  [SKIP] 這張地圖沒有祝福點（機率上不太可能，但保留SKIP分支）");
    }

    console.log("=== 商人鍛造台：seed盧恩+武器，走到商人點測試強化 ===");
    const merchantCandidates = (map.points || []).filter((p) => p.type === "merchant");
    if (merchantCandidates.length) {
      const merchantPt = await walkNearAny(page, merchantCandidates, 1.2, 250);
      if (merchantPt) {
        const beforeState = await page.evaluate(() => window.PriTestMidnight._debugState());
        // 2026-09-12修正：鍛造台には「鍛造石（item_smithing_stone）を持っていること」という
        // 門檻が後から入った（持っていないとリストの代わりに「需持有鍛造石才能使用鍛造台。」
        // だけが出る。門檻そのものの検証は weapon_combat_check.js の検査9が担当）。
        // ここで検証したいのは強化の扣款とweaponRarityOverrideなので、盧恩と一緒に鍛造石も渡す。
        await page.evaluate(
          ({ gameId, tokenId }) => {
            const GS = window.PriTestGameStorage;
            return Promise.all([
              GS.rtSet(gameId, "cloud", "character/" + tokenId + "/runes", 5),
              GS.rtSet(gameId, "cloud", "character/" + tokenId + "/consumables", [
                { id: "forgetest1", itemId: "item_smithing_stone", usesRemaining: 3 },
              ]),
            ]);
          },
          { gameId: beforeState.gameId, tokenId: beforeState.myTokenId }
        );
        await page.waitForTimeout(300);
        await page.waitForSelector("#midnight-merchant-prompt:not([hidden])", { timeout: 5000 });
        await page.dispatchEvent("#btn-midnight-open-merchant", "click"); // 毎フレーム再描画されるHUD上のボタンはpage.click()がstable待ちで逾時する（CLAUDE.md §4.6）
        await page.waitForSelector("#midnight-merchant-modal:not([hidden])", { timeout: 5000 });
        const charBefore = await page.evaluate(() => {
          const s = window.PriTestMidnight._debugState();
          return s.characters[s.myTokenId];
        });
        assert((charBefore.weaponIds || []).length > 0, "角色一開始就有起始武器可供強化測試", results);
        const forgeDom = await page.evaluate(() => {
          const el = document.getElementById("midnight-merchant-forge-list");
          if (!el) return "(#midnight-merchant-forge-list が無い)";
          return Array.prototype.map
            .call(el.querySelectorAll("button"), (b) => (b.textContent || "").replace(/\s+/g, " ").trim() + (b.disabled ? "[disabled]" : ""))
            .join(" ／ ") || "(ボタン0個) html=" + el.innerHTML.replace(/\s+/g, " ").slice(0, 200);
        });
        console.log("  鍛造台のボタン:", forgeDom, " 盧恩=" + charBefore.runes + " 武器=" + JSON.stringify(charBefore.weaponIds));
        const forgeBtn = await page.$("#midnight-merchant-forge-list button:not([disabled])");
        assert(!!forgeBtn, "鍛造台清單有可點擊（未達上限）的強化按鈕", results);
        if (forgeBtn) {
          await forgeBtn.click();
          await page.waitForTimeout(300);
          const charAfter = await page.evaluate(() => {
            const s = window.PriTestMidnight._debugState();
            return s.characters[s.myTokenId];
          });
          // 2026-09-12修正：強化のコストは盧恩ではなく鍛造石になった
          // （handleMerchantForgeWeapon()→consumeSmithingStones()、ボタン文字も「消耗鍛造石N」）。
          // 盧恩は減らないのが正しいので、鍛造石が減ったこと＋盧恩が変わらないことを見る。
          const stonesBefore = (charBefore.consumables || []).reduce((n, e) => n + (e.itemId === "item_smithing_stone" ? e.usesRemaining || 0 : 0), 0);
          const stonesAfter = (charAfter.consumables || []).reduce((n, e) => n + (e.itemId === "item_smithing_stone" ? e.usesRemaining || 0 : 0), 0);
          assert(
            stonesAfter === stonesBefore - 1 && charAfter.runes === charBefore.runes,
            "強化消耗鍛造石1個、盧恩不變（鍛造石 " + stonesBefore + "→" + stonesAfter + "、盧恩 " + charBefore.runes + "→" + charAfter.runes + "）",
            results
          );
          assert(!!(charAfter.weaponRarityOverride && Object.keys(charAfter.weaponRarityOverride).length), "強化後character.weaponRarityOverride有紀錄", results);
          const resultText = await page.textContent("#midnight-merchant-forge-result");
          assert(!!resultText && resultText.length > 0, "強化後顯示結果文字", results);
        }
      } else {
        console.log("  [SKIP] 走位工具沒能走到商人點附近");
      }
    } else {
      console.log("  [SKIP] 這張地圖沒有商人點（不應該發生）");
    }

    console.log("=== 模擬離開再回來（reload頁面），確認card2進度持久保存 ===");
    // 放在最後才reload：reload後token會換新的、需要重新走完整套接管/加入流程才能
    // 再次移動，這裡不深究重連流程，只驗證fieldProgress這個純RTDB資料本身有沒有保留
    // ——所以其他還需要走位的檢查（祝福/商人）都排在reload之前完成。
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta && window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: META_WAIT_MS });
    const afterReload = await page.evaluate(() => window.PriTestMidnight._debugState().fieldProgress || {});
    assert(afterReload[pt.id] && afterReload[pt.id].floorIndex === 2 && afterReload[pt.id].cleared === true, "reload後fieldProgress仍保留全踏破狀態（floorIndex=2, cleared=true）", results);
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
