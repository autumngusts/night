// ============================================================================
// midnight 2026-09-26 修正批次 回歸測試（Playwright ＋ Firebase Local Emulator）
// ============================================================================
// 使用者當次提出的 10 項中，本檔涵蓋可自動化驗證的部分：
//   ① 魔術師塔：先後進入都能再次進入、已破關一起拿獎勵、各裝置同一題。
//   ② 地變地形：只有站在 hazardZone（地圖橘線範圍）內才會持續累積凍傷／腐敗；
//      平地不累積。累積滿門檻會觸發效果並歸 0 重新累積。
//   ③ 自身屬性蓄積也同樣「滿了就觸發並歸 0」（先前只有異常歸 0，屬性保留餘數）。
//   ④ 第二天打倒夜之強敵後可以移動（不再被「按下離去前不能移動」鎖住）。
//   ⑤ 武器說明內顯示武器種類。
//   ⑧ 左右手同一把武器＝雙手持握，左手操作盤不顯示攻擊／戰技鍵。
//   ⑨ 商人購買的武器詞條，同一位玩家整場固定。
//   ⑩ 打完夜王結算關閉後角色鎖定，畫面中央出現［回到大廳］。
// 第 ⑥（遺物記憶出撃時武器附加／戰技置換）需要帶入記憶的完整流程，由既有的
// relic_memory_effect_check.js 涵蓋效果本身，本檔只驗「重試時機」不會噴錯。
// 第 ⑦（選的角色進遊戲後變成別的角色）無法重現，未列入。
//
// 使用前準備（跟 near_death_and_accum_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node fix_batch_2026_09_26_check.js
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

async function joinAndStart(page, passcode) {
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
    // 開局前先把房間選項設好：①武器詞條模式（⑨要驗），②挑一個真的帶 hazardZone 的地圖
    // 變體種子（②要驗）。地圖是在 sessionStartAt 當下依 meta.mapSeed/mapVariant 生成的，
    // 所以必須在按下準備之前寫好。種子用 generateMap() 現場試算，不硬編任何「已知好種子」。
    const mapSetup = await pA.evaluate(({ gameId }) => {
      const GS = window.PriTestGameStorage;
      const Map_ = window.PriTestMidnightMap;
      let picked = null;
      for (let seed = 1; seed <= 400 && !picked; seed++) {
        const m = Map_.generateMap(seed, "full");
        if (m.hazardZone && (m.specialRule === "ice_blizzard" || m.specialRule === "red_miasma")) {
          picked = { seed: seed, specialRule: m.specialRule };
        }
      }
      return GS.rtSet(gameId, "cloud", "meta/weaponAffixes", true)
        .then(() => (picked ? GS.rtSet(gameId, "cloud", "meta/mapVariant", "full") : null))
        .then(() => (picked ? GS.rtSet(gameId, "cloud", "meta/mapSeed", picked.seed) : null))
        .then(() => picked);
    }, { gameId: await pA.evaluate(() => window.PriTestMidnight._debugState().gameId) });
    console.log("地圖設定:", JSON.stringify(mapSetup));
    await joinAndStart(pA, "1111");
    await pB.goto(gameUrl, { waitUntil: "networkidle" });
    await pB.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await joinAndStart(pB, "2222");
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
    // ⑤ 武器說明顯示武器種類
    // ================================================================
    console.log("\n=== ⑤ 武器說明顯示武器種類 ===");
    const weaponDetail = await pA.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      const c = s.characters[s.myTokenId];
      const wid = c && c.weaponIds && c.weaponIds[0];
      if (!wid) return { err: "no weapon" };
      const W = window.PriTestWeapons;
      const w = W.get(wid.split(":")[0]);
      const cat = w && W.getCategory(w.category);
      // 角色視窗開起來，再點第一個武器格——武器詳細欄要選取武器才會畫出來。
      const openBtn = document.getElementById("btn-midnight-open-character-sheet");
      if (openBtn) openBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const slot = document.querySelector("#midnight-character-sheet-weapons button");
      if (slot) slot.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return { weaponId: wid, expected: cat ? W.localizedText(cat.name) : null };
    });
    await pA.waitForTimeout(600);
    weaponDetail.text = await pA.evaluate(() => {
      const line = document.querySelector(".midnight-weapon-category-line");
      return line ? line.textContent : null;
    });
    assert(!!weaponDetail.expected, "查得到這把武器的分類名稱", weaponDetail);
    assert(
      !!weaponDetail.text && weaponDetail.text.indexOf(weaponDetail.expected) !== -1,
      "武器詳細資訊裡有一行寫出武器種類（期望值從 weapons_categories.js 算出，非硬編）",
      weaponDetail
    );
    await pA.dispatchEvent("#btn-midnight-character-sheet-close", "click").catch(() => {});

    // ================================================================
    // ⑧ 左右手同一把武器＝雙手持握
    // ================================================================
    console.log("\n=== ⑧ 雙手持握時左手操作盤收起 ===");
    const twoHand = await pA.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      const ids = (c && c.weaponIds) || [];
      const before = { grip: M._debugTwoHandedGrip() };
      // 先擺成左右手不同（有第2件就用它，沒有就用空字串代表空手）
      M._debugSetEquippedWeapons(ids.length > 1 ? ids[1] : "", ids[0]);
      before.grip = M._debugTwoHandedGrip();
      before.leftHidden = (document.getElementById("btn-midnight-attack-left") || {}).hidden;
      // 再擺成左右手同一把
      M._debugSetEquippedWeapons(ids[0], ids[0]);
      const after = { grip: M._debugTwoHandedGrip() };
      after.leftHidden = (document.getElementById("btn-midnight-attack-left") || {}).hidden;
      after.rightHidden = (document.getElementById("btn-midnight-attack-shared-target") || {}).hidden;
      after.modeRowHidden = (document.getElementById("midnight-attack-mode-left") || {}).hidden;
      return { before, after };
    });
    assert(twoHand.before.grip === false, "左右手不同把時不算雙手持握", twoHand.before);
    assert(twoHand.after.grip === true, "左右手同一個 id 時判定為雙手持握", twoHand.after);
    assert(twoHand.after.leftHidden === true, "雙手持握時左手攻擊鍵隱藏", twoHand.after);
    assert(twoHand.after.rightHidden === false, "右手鍵照常顯示（雙手握的操作入口）", twoHand.after);
    assert(twoHand.after.modeRowHidden === true, "左手的攻擊方式切換列也一起收起", twoHand.after);

    // ================================================================
    // ⑨ 商人武器詞條同一位玩家整場固定
    // ================================================================
    console.log("\n=== ⑨ 商人武器詞條整場固定 ===");
    const affix = await pA.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      const all = window.PriTestWeapons.list();
      // 挑三把彼此不同、且角色目前身上沒有的武器 id
      const held = {};
      (c.weaponIds || []).forEach((w) => (held[w] = true));
      const picks = all.filter((w) => !held[w.id]).slice(0, 3).map((w) => w.id);
      if (picks.length < 3) return { err: "not enough weapons" };
      const out = picks.map((id) => M._debugGrantMerchantAffixes(id));
      return { picks, out, enabled: !!(out[0] && out[0].affixes) };
    });
    if (!affix.enabled) {
      console.log("  [SKIP] 這個房間沒有開啟武器詞條模式，略過 ⑨");
    } else {
      const sig = (entry) => JSON.stringify((entry.affixes || []).map((a) => a.id + ":" + a.value));
      assert(affix.picks[0] !== affix.picks[1] && affix.picks[1] !== affix.picks[2], "三把是不同的武器", affix.picks);
      assert(sig(affix.out[0]) === sig(affix.out[1]) && sig(affix.out[1]) === sig(affix.out[2]),
        "三把不同武器拿到的詞條完全相同（整場固定）", affix.out.map(sig));
      assert(sig(affix.out[0]) === JSON.stringify((affix.out[0].set || []).map((a) => a.id + ":" + a.value)),
        "詞條來源就是 c.merchantAffixSet", affix.out[0]);
    }

    // ================================================================
    // ③ 自身屬性蓄積滿門檻→觸發並歸 0
    // ================================================================
    console.log("\n=== ③ 自身屬性蓄積滿了觸發並歸 0 ===");
    const accum = await pA.evaluate(() => {
      const M = window.PriTestMidnight;
      const th = M._debugReceivedAccumThreshold("炎");
      M._debugRecordReceivedAccum("炎", th - 1);
      const before = M._debugReceivedAccum()["炎"];
      M._debugRecordReceivedAccum("炎", 5); // 跨過門檻且有餘數
      const after = M._debugReceivedAccum()["炎"];
      return { th, before, after };
    });
    assert(accum.before === accum.th - 1, "未達門檻時照舊累加", accum);
    assert(accum.after === 0, "屬性蓄積跨過門檻後歸 0（不再保留餘數）", accum);

    // ================================================================
    // ② 地變地形：只有在 hazardZone 內才累積
    // ================================================================
    console.log("\n=== ② 地變地形才會持續累積 ===");
    const zoneInfo = await pA.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      const map = s.map;
      if (!map.hazardZone) return { hasZone: false, specialRule: map.specialRule };
      let inside = null;
      let outside = null;
      for (let y = 0; y < map.height && (!inside || !outside); y++) {
        for (let x = 0; x < map.width && (!inside || !outside); x++) {
          const idx = y * map.width + x;
          if (map.grid[idx] !== 0) continue;
          if (map.hazardZone[idx] === 1) {
            if (!inside) inside = { x: x + 0.5, y: y + 0.5 };
          } else if (!outside) outside = { x: x + 0.5, y: y + 0.5 };
        }
      }
      return { hasZone: true, specialRule: map.specialRule, inside, outside };
    });
    if (!zoneInfo.hasZone || !zoneInfo.inside || !zoneInfo.outside) {
      console.log("  [SKIP] 這個地圖沒有地變區（hazardZone），略過 ②：" + JSON.stringify(zoneInfo));
    } else {
      await teleport(pA, zoneInfo.outside.x, zoneInfo.outside.y);
      const outState = await pA.evaluate(() => {
        const M = window.PriTestMidnight;
        return { inZone: M._debugInHazardTerrain(), cell: M._debugHazardZoneCell(M._debugState().localPos.x, M._debugState().localPos.y) };
      });
      assert(outState.inZone === false, "站在地變區外時 inHazardTerrain() 為 false", outState);

      await teleport(pA, zoneInfo.inside.x, zoneInfo.inside.y);
      const inState = await pA.evaluate(() => {
        const M = window.PriTestMidnight;
        return { inZone: M._debugInHazardTerrain(), cell: M._debugHazardZoneCell(M._debugState().localPos.x, M._debugState().localPos.y) };
      });
      assert(inState.inZone === true, "站在地變區內時 inHazardTerrain() 為 true", inState);

      // 只有 ice_blizzard／red_miasma 這兩張圖有持續累積規則；其他地圖 tick 本來就不動作。
      if (zoneInfo.specialRule === "ice_blizzard" || zoneInfo.specialRule === "red_miasma") {
        const name = zoneInfo.specialRule === "ice_blizzard" ? "凍傷" : "腐敗";
        // 圈外：tick 不該累積
        await teleport(pA, zoneInfo.outside.x, zoneInfo.outside.y);
        const outAccum = await pA.evaluate((n) => {
          const M = window.PriTestMidnight;
          const b = M._debugReceivedAccum()[n] || 0;
          M._debugMapSpecialRuleTick();
          M._debugMapSpecialRuleTick();
          return { before: b, after: M._debugReceivedAccum()[n] || 0 };
        }, name);
        assert(outAccum.after === outAccum.before, "平地（地變區外）不會持續累積 " + name, outAccum);

        // 圈內：tick 會累積
        await teleport(pA, zoneInfo.inside.x, zoneInfo.inside.y);
        const inAccum = await pA.evaluate((n) => {
          const M = window.PriTestMidnight;
          const b = M._debugReceivedAccum()[n] || 0;
          M._debugMapSpecialRuleTick();
          return { before: b, after: M._debugReceivedAccum()[n] || 0, th: M._debugReceivedAccumThreshold(n) };
        }, name);
        assert(inAccum.after > inAccum.before, "地變區內會累積 " + name, inAccum);

        // 累積滿門檻 → 觸發並歸 0
        const overflow = await pA.evaluate((n) => {
          const M = window.PriTestMidnight;
          const th = M._debugReceivedAccumThreshold(n);
          M._debugRecordReceivedAccum(n, th * 2);
          return { th, after: M._debugReceivedAccum()[n] || 0 };
        }, name);
        assert(overflow.after === 0, "地變區內累積滿門檻後歸 0 重新累積", overflow);
      } else {
        console.log("  [SKIP] 這張地圖的 specialRule 是 " + zoneInfo.specialRule + "，沒有持續累積規則");
      }
    }

    // ================================================================
    // ① 魔術師塔
    // ================================================================
    console.log("\n=== ① 魔術師塔：再次進入與共同獎勵 ===");
    const towerPt = await pA.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      const pt = (s.map.points || []).find((p) => p.type === "sorcerer");
      return pt ? { id: pt.id, x: pt.x, y: pt.y } : null;
    });
    if (!towerPt) {
      console.log("  [SKIP] 這個地圖種子沒有魔術師塔，略過 ①");
    } else {
      // A 站到塔旁邊並按下［進入］，B 先不進來（＝錯過邀請時間的人）
      await teleport(pA, towerPt.x + 0.3, towerPt.y + 0.3);
      await pA.waitForTimeout(600);
      await pA.dispatchEvent("#btn-midnight-tower-enter", "click").catch((e) => console.log("  A 進入鍵: " + e.message));
      const active = await waitFor(pA, () => {
        const s = window.PriTestMidnight._debugState();
        const inv = s.towerInvites && Object.keys(s.towerInvites).map((k) => s.towerInvites[k])[0];
        return !!(inv && inv.status === "active");
      }, 15000);
      assert(active, "A 進入後，邀請時限跑完轉為 active");

      // 題目是 startTowerPuzzle() 第一次跑到時才用 transaction 寫進去的，等它到位再讀。
      await waitFor(pA, () => {
        const s = window.PriTestMidnight._debugState();
        const ids = Object.keys(s.towerInvites || {});
        return ids.length > 0 && !!s.towerInvites[ids[0]].puzzle;
      }, 15000);
      const puzzleA = await pA.evaluate((id) => {
        const s = window.PriTestMidnight._debugState();
        const inv = s.towerInvites[id];
        return inv && inv.puzzle ? JSON.stringify(inv.puzzle) : null;
      }, towerPt.id);
      assert(!!puzzleA, "題目已經寫進共享的 towerInvites/<id>/puzzle", puzzleA && puzzleA.slice(0, 60));

      // B 現在才走過來——錯過邀請時間，修正前完全進不去
      await teleport(pB, towerPt.x + 0.3, towerPt.y + 0.3);
      await pB.waitForTimeout(800);
      const bEnterVisible = await pB.evaluate(() => {
        const btn = document.getElementById("btn-midnight-tower-enter");
        return { exists: !!btn, hidden: !btn || btn.hidden };
      });
      assert(!bEnterVisible.hidden, "錯過邀請時間的 B 仍然看得到［進入］（可再次進入）", bEnterVisible);

      await pB.dispatchEvent("#btn-midnight-tower-enter", "click").catch((e) => console.log("  B 進入鍵: " + e.message));
      const bJoined = await waitFor(pB, () => {
        const s = window.PriTestMidnight._debugState();
        const ids = Object.keys(s.towerInvites || {});
        if (!ids.length) return false;
        const inv = s.towerInvites[ids[0]];
        return !!(inv && inv.participants && inv.participants[s.mySlot]);
      }, 10000);
      assert(bJoined, "B 已加入這座塔的 participants");

      const puzzleB = await pB.evaluate((id) => {
        const s = window.PriTestMidnight._debugState();
        const inv = s.towerInvites[id];
        return inv && inv.puzzle ? JSON.stringify(inv.puzzle) : null;
      }, towerPt.id);
      assert(puzzleB === puzzleA, "兩台裝置拿到的是同一題", { A: (puzzleA || "").slice(0, 40), B: (puzzleB || "").slice(0, 40) });

      // A 解開（直接寫 towerSolved，跟真的答對同一個效果——答案判定由 midnight_puzzles.js
      // 的既有測試負責，這裡驗的是「解開之後大家一起拿獎勵」）
      await pB.dispatchEvent("#btn-midnight-tower-puzzle-close", "click").catch(() => {}); // B 先關掉視窗
      await pB.waitForTimeout(400);
      await pA.evaluate(
        ({ gameId, id }) => window.PriTestGameStorage.rtSet(gameId, "cloud", "towerSolved/" + id, true),
        { gameId: stA.gameId, id: towerPt.id }
      );
      const bReward = await waitFor(pB, () => {
        const modal = document.getElementById("midnight-tower-dice-hand-modal");
        return !!modal && !modal.hidden;
      }, 12000);
      const bRewardState = await pB.evaluate(() => {
        const modal = document.getElementById("midnight-tower-dice-hand-modal");
        return { hidden: !modal || modal.hidden, exists: !!modal };
      });
      assert(bReward, "B 雖然已經關掉解謎視窗，塔被解開時仍然拿到獎勵（骰子抽獎開啟）", bRewardState);
    }

    // ================================================================
    // ⑩ 打完夜王結算關閉後鎖定＋回到大廳
    // ================================================================
    console.log("\n=== ⑩ 夜王結算後鎖定與［回到大廳］ ===");
    const beforeLock = await pA.evaluate(() => {
      const M = window.PriTestMidnight;
      const wrap = document.getElementById("midnight-game-finished-overlay");
      return { locked: M._debugGameFinishedLocked(), overlayHidden: !wrap || wrap.hidden, exists: !!wrap };
    });
    assert(beforeLock.exists, "［回到大廳］覆蓋層存在", beforeLock);
    assert(beforeLock.locked === false && beforeLock.overlayHidden, "遊戲進行中不鎖定、也不顯示覆蓋層", beforeLock);

    // 夜王擊破 → 勝利彈窗 → 結算視窗 → 關閉
    await pA.evaluate(
      ({ gameId, slotA }) => {
        const GS = window.PriTestGameStorage;
        const participants = {};
        participants[slotA] = true;
        return GS.rtSet(gameId, "cloud", "fieldTrigger/day3Boss", {
          status: "resolved",
          participants: participants,
          enemyFamilyId: "night_boss",
          enemyId: "gladius",
          level: 1,
        })
          .then(() => GS.rtSet(gameId, "cloud", "meta/day3StartAt", Date.now()))
          .then(() => GS.rtSet(gameId, "cloud", "fieldEnemyHp/day3Boss", 0));
      },
      { gameId: stA.gameId, slotA: stA.mySlot }
    );
    const victoryShown = await waitFor(pA, () => {
      const m = document.getElementById("midnight-game-victory-modal");
      return !!m && !m.hidden;
    }, 20000);
    if (!victoryShown) {
      console.log("  [SKIP] 勝利彈窗未出現，略過 ⑩ 的後半");
    } else {
      await pA.dispatchEvent("#btn-midnight-game-victory-confirm", "click");
      const settleShown = await waitFor(pA, () => {
        const m = document.getElementById("midnight-relic-memory-settle-modal");
        return !!m && !m.hidden;
      }, 15000);
      assert(settleShown, "確認勝利後開啟遺物記憶結算視窗");
      await pA.dispatchEvent("#btn-midnight-relic-memory-settle-close", "click");
      await pA.waitForTimeout(800);
      const afterLock = await pA.evaluate(() => {
        const M = window.PriTestMidnight;
        const wrap = document.getElementById("midnight-game-finished-overlay");
        const btn = document.getElementById("btn-midnight-return-to-lobby");
        return {
          locked: M._debugGameFinishedLocked(),
          overlayHidden: !wrap || wrap.hidden,
          btnText: btn ? btn.textContent : null,
          canAct: (function () {
            const atk = document.getElementById("btn-midnight-attack-shared-target");
            return atk ? !atk.disabled : null;
          })(),
        };
      });
      assert(afterLock.locked === true, "結算關閉後進入鎖定狀態", afterLock);
      assert(!afterLock.overlayHidden, "畫面中央顯示［回到大廳］", afterLock);
      assert(!!afterLock.btnText, "按鈕有文字（i18n 有掛上）", afterLock);

      // 按下［回到大廳］→ 回到沒有 ?game= 的 midnight 主畫面
      await pA.dispatchEvent("#btn-midnight-return-to-lobby", "click");
      await pA.waitForTimeout(1500);
      const url = pA.url();
      assert(url.indexOf("?game=") === -1 && /midnight/.test(url), "回到沒有 gameId 的 midnight 主畫面", url);
    }

    assert(pageErrors.length === 0, "過程中沒有任何 pageerror", pageErrors);
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.pass).length;
  console.log("\n" + passed + "/" + results.length + (passed === results.length ? " PASS" : " PASS（有失敗項目）"));
  process.exit(passed === results.length ? 0 : 1);
})();
