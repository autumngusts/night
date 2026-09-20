// ============================================================================
// midnight 2026-09-20 審查修正（H1〜L8）回歸測試：Playwright ＋ Firebase Local Emulator。
// ============================================================================
// 使用前準備（跟 emulator_sync_check.js 完全相同，見該檔開頭）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node review_2026_09_20_check.js
//
// 涵蓋項目（能在 emulator 上穩定重現的部分）：
//   H1  隊友對我的 character/ 子路徑寫入不再洗掉本地 buff（勇者的肉塊）
//   M1  effectiveGuardCount()：顯示與破防共用、含 L補正
//   M17 red/ice 週期蓄積走恩寵免疫／護符無效化過濾鏈
//   M18 戰鬥結束在 red/ice 地圖保留腐敗／凍傷
//   M5  血魂之歌回復量 = BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT
//   M11 putItemOnGround() 帶 affixes
//   L1  parseSkillBodyAccums()「XD」＝固定 X（句中有「振」才擲）
//   L4  歩く霊廟複製武器拿到枝番 id、戰技／詞條複製
//   L6  暫停結束後 _xxxUntil 平移
//   M2  接管席位搬 pendingRewards
//   H3  夜の勢力：兩台同時偵測 HP=0，最終輪獎勵只發一次
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

const state = (page) => page.evaluate(() => window.PriTestMidnight._debugState());
const rtSet = (page, path, value) =>
  page.evaluate(
    ([p, v]) => {
      const s = window.PriTestMidnight._debugState();
      return window.PriTestGameStorage.rtSet(s.gameId, "cloud", p, v);
    },
    [path, value]
  );
const waitFor = (page, fn, arg, timeout) => page.waitForFunction(fn, arg, { timeout: timeout || META_WAIT_MS });

(async () => {
  const browser = await chromium.launch();
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  for (const p of [pageA, pageB]) p.on("pageerror", (e) => console.log("  [pageerror] " + e.message));

  try {
    await enableEmulatorFlag(pageA);
    await enableEmulatorFlag(pageB);
    console.log("=== 建立 midnight 測試場（裝置A，連本機 emulator） ===");
    await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await pageA.click("#btn-midnight-create");
    await pageA.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    const gameUrl = pageA.url();
    console.log("=== 裝置B加入 ===");
    await pageB.goto(gameUrl, { waitUntil: "networkidle" });
    await pageB.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });

    console.log("=== 等待房：兩裝置加入並準備 ===");
    await joinLobby(pageA, "1234");
    await joinLobby(pageB, "5678");
    await pageA.click("#btn-midnight-lobby-ready");
    await pageB.click("#btn-midnight-lobby-ready");
    await pageA.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 25000 });
    for (const p of [pageA, pageB]) {
      await p.waitForFunction(() => {
        const s = window.PriTestMidnight._debugState();
        return !!s.characters[s.myTokenId];
      }, { timeout: META_WAIT_MS });
    }
    const sA = await state(pageA);
    const sB = await state(pageB);
    const tokenA = sA.myTokenId;
    const tokenB = sB.myTokenId;

    // ======================================================================
    console.log("\n=== H1：隊友子路徑寫入不洗掉本地 buff ===");
    await pageA.evaluate(() => window.PriTestMidnight._debugApplyConsumable("item_hero_meat_chunk"));
    const heroBefore = await pageA.evaluate(() => window.PriTestMidnight._debugConsumableBuffs());
    // 裝置B對A的角色寫一個子路徑（模擬隊友發盧恩／恩寵），A 會收到一份「沒有 _heroMeatUntil」的快照
    await rtSet(pageB, "character/" + tokenA + "/runes", 7);
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      return s.characters[s.myTokenId].runes === 7;
    });
    await pageA.waitForTimeout(300);
    const heroAfter = await pageA.evaluate(() => window.PriTestMidnight._debugConsumableBuffs());
    assert(heroBefore.attack.hit1 === 5 && heroAfter.attack.hit1 === 5 && heroAfter.attack.hit2 === 10, "H1：隊友寫入 runes 後勇者的肉塊 buff 仍在", { heroBefore, heroAfter });
    // 自己的子路徑寫入（消耗品 transaction 那一類）同樣不洗掉
    await pageA.evaluate(() => window.PriTestMidnight._debugSetTalismans([]));
    await pageA.waitForTimeout(400);
    const heroAfter2 = await pageA.evaluate(() => window.PriTestMidnight._debugConsumableBuffs());
    assert(heroAfter2.attack.hit1 === 5, "H1：自己的子路徑寫入後 buff 仍在", heroAfter2);
    // 但快照裡有的鍵仍以快照為準（隊友幫我歸零冷卻）
    await pageA.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      s.characters[s.myTokenId]._artCooldownUntil = Date.now() + 999999;
    });
    await rtSet(pageB, "character/" + tokenA + "/_artCooldownUntil", 0);
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      return s.characters[s.myTokenId]._artCooldownUntil === 0;
    });
    assert(true, "H1：快照裡有的 _ 欄位（隊友歸零的冷卻）以快照為準");

    // ======================================================================
    console.log("\n=== R1：整份覆寫改為子路徑差異同步（runes走transaction、純本地欄位不上RTDB） ===");
    await rtSet(pageA, "character/" + tokenA + "/runes", 10);
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      return s.characters[s.myTokenId].runes === 10;
    });
    // A 本地扣 3 盧恩＋改 talismanIds＋設純本地 buff，B 同時對 A 的 runes 做 +5 transaction
    const r1 = await Promise.all([
      pageA.evaluate(() => {
        const M = window.PriTestMidnight;
        const s = M._debugState();
        const c = s.characters[s.myTokenId];
        const before = M._debugSnapshotMyCharacter();
        c.runes -= 3;
        c.talismanIds = ["talisman_greed"];
        c._heroMeatUntil = Date.now() + 99999;
        M._debugSyncMyCharacterChanges(before);
        return true;
      }),
      pageB.evaluate((t) => {
        const s = window.PriTestMidnight._debugState();
        return window.PriTestGameStorage.rtTransaction(s.gameId, "cloud", "character/" + t + "/runes", (cur) => (cur || 0) + 5);
      }, tokenA),
    ]);
    void r1;
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      return s.characters[s.myTokenId].runes === 12;
    });
    const r1Raw = await pageA.evaluate(async () => {
      const s = window.PriTestMidnight._debugState();
      const snap = await window.firebase.database().ref("games/" + s.gameId + "/rtState/character/" + s.myTokenId).once("value");
      const v = snap.val() || {};
      return { runes: v.runes, talismanIds: v.talismanIds, hasHeroMeat: v._heroMeatUntil !== undefined, localHeroMeat: s.characters[s.myTokenId]._heroMeatUntil > Date.now() };
    });
    assert(r1Raw.runes === 12, "R1：A 扣3 與 B 加5 同時發生，RTDB runes＝10−3+5＝12（不互相覆蓋）", r1Raw);
    assert(Array.isArray(r1Raw.talismanIds) && r1Raw.talismanIds[0] === "talisman_greed", "R1：變動的欄位（talismanIds）有寫上去", r1Raw);
    assert(!r1Raw.hasHeroMeat && r1Raw.localHeroMeat, "R1：純本地 _heroMeatUntil 沒被推上 RTDB、本地仍在", r1Raw);
    await pageA.evaluate(() => window.PriTestMidnight._debugSetTalismans([]));

    // ======================================================================
    console.log("\n=== 個人獎勵清單：抽選結果 persist、確認時重新編枝番 id ===");
    const rwId = "rwdraw" + Date.now();
    await rtSet(pageA, "pendingRewards/" + tokenA + "/" + rwId, { kind: "weapon", value: 1, resolved: false });
    await waitFor(pageA, ([t, id]) => !!((window.PriTestMidnight._debugState().pendingRewards || {})[t] || {})[id], [tokenA, rwId]);
    const drawn = await pageA.evaluate((id) => {
      const s = window.PriTestMidnight._debugState();
      return window.PriTestMidnight._debugDrawPersonalReward(id, s.pendingRewards[s.myTokenId][id]);
    }, rwId);
    assert(drawn && drawn.weaponId && drawn.weaponId.indexOf("::") === -1, "抽選：drawn 有 catalog weaponId（無枝番）", drawn);
    await waitFor(pageA, ([t, id]) => {
      const e = ((window.PriTestMidnight._debugState().pendingRewards || {})[t] || {})[id];
      return !!(e && e.drawn && e.drawn.weaponId);
    }, [tokenA, rwId]);
    const rebuilt = await pageA.evaluate((id) => {
      const s = window.PriTestMidnight._debugState();
      const e = s.pendingRewards[s.myTokenId][id];
      return window.PriTestMidnight._debugDraftFromDrawn(e, e.drawn);
    }, rwId);
    assert(rebuilt.weaponId === drawn.weaponId && rebuilt.skillId === (drawn.skillId || null), "重新整理後可從 pendingRewards/{id}/drawn 還原同一結果", { drawn, rebuilt });
    // 先讓自己持有同 catalog 的一把，再確認收下 → 應拿到 "::2" 而不是撞 id
    const confirmRes = await pageA.evaluate(([id, base]) => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      if (c.weaponIds.indexOf(base) === -1) c.weaponIds.push(base);
      const before = c.weaponIds.slice();
      M._debugConfirmRewardEntry(id);
      const added = c.weaponIds.filter((w) => before.indexOf(w) === -1);
      const dup = c.weaponIds.filter((w, i) => c.weaponIds.indexOf(w) !== i);
      return { added, dup };
    }, [rwId, drawn.weaponId]);
    assert(confirmRes.added.length === 1 && confirmRes.added[0].indexOf("::") !== -1 && confirmRes.dup.length === 0, "確認收下時依持有狀況編枝番 id、不撞名", confirmRes);

    // ======================================================================
    console.log("\n=== R5：発狂地帯「発狂：2D／3D」＝固定 2／3 ===");
    const r5 = await pageA.evaluate(() => [window.PriTestMidnight._debugMadnessFixedAccum(2), window.PriTestMidnight._debugMadnessFixedAccum(3)]);
    assert(r5[0] === 2 && r5[1] === 3, "R5：XD 視為固定 X", r5);

    // ======================================================================
    console.log("\n=== M1：effectiveGuardCount ===");
    const g = await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      return {
        start: M._debugEffectiveGuardCount(3, 0, 2),
        atMax: M._debugEffectiveGuardCount(3, 3, 2),
        broken: M._debugEffectiveGuardCount(3, 5, 2),
        noL: M._debugEffectiveGuardCount(3, 3, 0),
      };
    });
    assert(g.start === 3 && g.atMax === 2 && g.broken === 0 && g.noL === 0, "M1：clamp(guardMax+lBonus−reduceBy, 0, guardMax)", g);

    // ======================================================================
    console.log("\n=== M17：週期蓄積走護符無效化過濾鏈 ===");
    const m17 = await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugSetTalismans(["talisman_immune_horn_charm"]); // 猛毒／腐敗無效
      const rotBlocked = M._debugFilterReceivedAccumAmount("腐敗", 4);
      M._debugSetTalismans([]);
      const rotFree = M._debugFilterReceivedAccumAmount("腐敗", 4);
      M._debugSetTalismans(["talisman_sturdy_horn_charm"]); // 出血／凍傷無效
      const frostBlocked = M._debugFilterReceivedAccumAmount("凍傷", 4);
      M._debugSetTalismans([]);
      return { rotBlocked, rotFree, frostBlocked };
    });
    assert(m17.rotBlocked === 0 && m17.rotFree === 4 && m17.frostBlocked === 0, "M17：護符無效化在共用過濾鏈生效", m17);

    // ======================================================================
    console.log("\n=== M18：戰鬥結束在 red/ice 地圖保留腐敗／凍傷 ===");
    const m18 = await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      const out = {};
      M._debugSetMapSpecialRule("red_miasma");
      M._debugState().receivedAttributeAccum["腐敗"] = 5;
      M._debugState().receivedAttributeAccum["炎"] = 3;
      M._debugOnEncounterEnded();
      out.red = JSON.parse(JSON.stringify(M._debugState().receivedAttributeAccum));
      M._debugSetMapSpecialRule("ice_blizzard");
      M._debugState().receivedAttributeAccum["凍傷"] = 6;
      M._debugState().receivedAttributeAccum["腐敗"] = 5;
      M._debugOnEncounterEnded();
      out.ice = JSON.parse(JSON.stringify(M._debugState().receivedAttributeAccum));
      M._debugSetMapSpecialRule(null);
      M._debugState().receivedAttributeAccum["凍傷"] = 6;
      M._debugOnEncounterEnded();
      out.plain = JSON.parse(JSON.stringify(M._debugState().receivedAttributeAccum));
      return out;
    });
    assert(m18.red["腐敗"] === 5 && m18.red["炎"] === undefined, "M18：red 地圖保留腐敗、清掉其他", m18.red);
    assert(m18.ice["凍傷"] === 6 && m18.ice["腐敗"] === undefined, "M18：ice 地圖保留凍傷、清掉其他", m18.ice);
    assert(Object.keys(m18.plain).length === 0, "M18：一般地圖全部清空", m18.plain);

    // ======================================================================
    console.log("\n=== M5／L1／M11 ===");
    const misc = await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      return {
        bloodSong: M._debugBloodSongRegenAmount(),
        fixedD: M._debugParseSkillBodyAccums("エネミーに「雷：2D」を与える。"),
        rolledD: M._debugParseSkillBodyAccums("ダイスを2個振る。エネミーに「雷：2D」を与える。"),
        plain: M._debugParseSkillBodyAccums("エネミーに「炎：3」を与える。"),
      };
    });
    assert(misc.bloodSong === 10, "M5：血魂之歌回復量＝10（□刻度）", misc.bloodSong);
    assert(misc.fixedD.length === 1 && misc.fixedD[0].value === 2, "L1：「雷：2D」無「振」＝固定 2", misc.fixedD);
    assert(misc.rolledD.length === 1 && misc.rolledD[0].value >= 2 && misc.rolledD[0].value <= 12, "L1：句中有「振」才擲骰", misc.rolledD);
    assert(misc.plain.length === 1 && misc.plain[0].value === 3, "L1：固定值路徑不變", misc.plain);

    await pageA.evaluate(() => {
      window.PriTestMidnight._debugPutItemOnGround({ kind: "weapon", itemId: "test_weapon", affixes: [{ id: "x", value: 1 }] });
    });
    await waitFor(pageA, () => {
      const gi = window.PriTestMidnight._debugState().groundItems || {};
      return Object.keys(gi).some((k) => gi[k].itemId === "test_weapon");
    });
    const ground = await pageA.evaluate(() => {
      const gi = window.PriTestMidnight._debugState().groundItems || {};
      const id = Object.keys(gi).filter((k) => gi[k].itemId === "test_weapon")[0];
      return { id, data: gi[id] };
    });
    assert(ground.data && Array.isArray(ground.data.affixes) && ground.data.affixes[0].id === "x", "M11：掉落物帶著 affixes", ground.data);
    await rtSet(pageA, "groundItems/" + ground.id, null); // 清掉，避免干擾下面的撿取測試
    await waitFor(pageA, (id) => !(window.PriTestMidnight._debugState().groundItems || {})[id], ground.id);

    // ======================================================================
    console.log("\n=== L4：歩く霊廟複製武器 ===");
    const l4 = await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      const first = c.weaponIds[0];
      c.weaponRandomSkills = c.weaponRandomSkills || {};
      c.weaponRandomSkills[first] = "skill_dummy";
      c.weaponAffixes = c.weaponAffixes || {};
      c.weaponAffixes[first] = [{ id: "aff", value: 2 }];
      const before = c.weaponIds.length;
      // 讓「隨機挑一把」一定挑到 first：暫時只留一把
      const saved = c.weaponIds.slice();
      c.weaponIds = [first];
      M._debugMausoleumCopy("test_mausoleum_" + Date.now());
      const copy = c.weaponIds.filter((id) => id !== first)[0];
      const out = {
        copy,
        base: window.PriTestCharacterDrawer.baseWeaponId(copy),
        skill: copy && c.weaponRandomSkills[copy],
        affix: copy && c.weaponAffixes[copy],
        first,
      };
      c.weaponIds = saved.concat(copy ? [copy] : []);
      return out;
    });
    assert(l4.copy && l4.copy !== l4.first && l4.base === window_base(l4.first), "L4：複製品是枝番 id（同 base）", l4);
    assert(l4.skill === "skill_dummy" && l4.affix && l4.affix[0].id === "aff", "L4：戰技／詞條跟著複製", l4);

    // 撿取地上武器同樣改用枝番（使用者確認一併處理）：把自己已持有的 base 丟到地上再撿
    const pickup = await pageA.evaluate(async () => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      const CD = window.PriTestCharacterDrawer;
      const W = window.PriTestWeapons;
      // 挑一把有 random 戰技枠的武器（assignWeaponRandomSkill() 只對有 random 枠的武器寫入）
      const withRandom = W.list().filter((w) => {
        const cat = W.getCategory(w.category);
        return cat && !cat.isShield && CD.collectWeaponSkillRefs(cat, w).some((p) => p.ref && p.ref.kind === "random");
      })[0];
      const base = withRandom.id;
      if (c.weaponIds.indexOf(base) === -1) {
        c.weaponIds.push(base);
        window.PriTestGameStorage.rtSet(s.gameId, "cloud", "character/" + s.myTokenId + "/weaponIds", c.weaponIds);
      }
      const before = c.weaponIds.slice();
      M._debugPutItemOnGround({ kind: "weapon", itemId: base, randomSkillId: "skill_pick", affixes: [{ id: "pk", value: 1 }] });
      return { base, before };
    });
    await waitFor(pageA, (b) => {
      const s = window.PriTestMidnight._debugState();
      return !!s.nearbyGroundItem && s.nearbyGroundItem.data.itemId === b && s.nearbyGroundItem.data.randomSkillId === "skill_pick";
    }, pickup.base);
    await pageA.dispatchEvent("#btn-midnight-pickup-ground-item", "click");
    await pageA.waitForTimeout(800);
    const pickupAfter = await pageA.evaluate((base) => {
      const s = window.PriTestMidnight._debugState();
      const c = s.characters[s.myTokenId];
      const CD = window.PriTestCharacterDrawer;
      const newIds = c.weaponIds.filter((id) => CD.baseWeaponId(id) === base);
      const dup = c.weaponIds.filter((id, i) => c.weaponIds.indexOf(id) !== i);
      const branched = newIds.filter((id) => id.indexOf("::") !== -1);
      return { count: newIds.length, dup, branched, skill: branched.map((id) => (c.weaponRandomSkills || {})[id]), affix: branched.map((id) => (c.weaponAffixes || {})[id]) };
    }, pickup.base);
    assert(pickupAfter.dup.length === 0 && pickupAfter.branched.length >= 1, "撿取：撞名武器拿到枝番 id、沒有重複 id", pickupAfter);
    assert(pickupAfter.skill.indexOf("skill_pick") !== -1 && pickupAfter.affix.some((a) => a && a[0] && a[0].id === "pk"), "撿取：戰技／詞條寫在新 id 底下", pickupAfter);

    // ======================================================================
    console.log("\n=== L6：暫停結束後時間戳平移 ===");
    const l6 = await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      const now = Date.now();
      c._heroMeatUntil = now + 5000;
      c._artCooldownUntil = now + 100000;
      c._spiritHornReadyAt = now + 3000;
      c._greaseUntil = now - 1000; // 已過期，不該動
      M._debugShiftMyTimestampsAfterPause(now, 20000);
      return {
        hero: c._heroMeatUntil - now,
        art: c._artCooldownUntil - now,
        horn: c._spiritHornReadyAt - now,
        grease: c._greaseUntil - now,
      };
    });
    assert(l6.hero === 25000 && l6.art === 120000 && l6.horn === 23000 && l6.grease === -1000, "L6：未過期的 Until/ReadyAt 平移暫停時長、已過期不動", l6);

    // ======================================================================
    console.log("\n=== L2：防禦成功也承受蓄積，只有遺物免除 ===");
    // 前提：守護者（guardian）＋裝備盾牌，才能真的走到 block 分支
    const relicKey = await pageA.evaluate(() => {
      const CD = window.PriTestCharacterDrawer;
      const type = window.PriTestCharacterTypes.get("guardian");
      let found = null;
      (type.relicEffectGroups || []).forEach((g, gi) =>
        (g.effects || []).forEach((e, ei) => {
          if (!found && (e.name && e.name.zh) === "防禦成功時異常狀態蓄積無效") found = CD.relicEffectKey(type.id, gi, ei);
        })
      );
      return found;
    });
    await rtSet(pageA, "character/" + tokenA + "/typeId", "guardian");
    await rtSet(pageA, "character/" + tokenA + "/learnedRelicEffects", []);
    await pageA.waitForTimeout(800);
    const l2NoRelic = await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      const W = window.PriTestWeapons;
      const shield = W.list().filter((w) => (W.getCategory(w.category) || {}).isShield)[0];
      c.weaponIds = (c.weaponIds || []).concat(c.weaponIds.indexOf(shield.id) === -1 ? [shield.id] : []);
      c.equippedWeaponIdL = shield.id;
      c.equippedWeaponIdR = null;
      s.stamina.current = s.stamina.max;
      M._debugSetTalismans([]);
      s.receivedAttributeAccum["猛毒"] = 0;
      s.receivedAttributeAccum["炎"] = 0;
      const kind = M._debugResolveIncomingHit("block", "猛毒:2 炎:2");
      return { kind, poison: s.receivedAttributeAccum["猛毒"] || 0, fire: s.receivedAttributeAccum["炎"] || 0 };
    });
    assert(l2NoRelic.kind === "block" && l2NoRelic.poison === 2 && l2NoRelic.fire === 2, "L2：無遺物時防禦成功仍承受異常／屬性蓄積", l2NoRelic);
    await rtSet(pageA, "character/" + tokenA + "/learnedRelicEffects", relicKey ? [relicKey] : []);
    await pageA.waitForTimeout(800);
    const l2Relic = await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      const W = window.PriTestWeapons;
      const shield = W.list().filter((w) => (W.getCategory(w.category) || {}).isShield)[0];
      c.equippedWeaponIdL = shield.id;
      c.equippedWeaponIdR = null;
      s.stamina.current = s.stamina.max;
      s.receivedAttributeAccum["猛毒"] = 0;
      s.receivedAttributeAccum["炎"] = 0;
      const kind = M._debugResolveIncomingHit("block", "猛毒:2 炎:2");
      const hitKind = M._debugResolveIncomingHit("hit", "猛毒:2");
      return { kind, hitKind, poison: s.receivedAttributeAccum["猛毒"] || 0, fire: s.receivedAttributeAccum["炎"] || 0 };
    });
    assert(!!relicKey && l2Relic.kind === "block" && l2Relic.fire === 2 && l2Relic.poison === 2, "L2：持有「防禦成功時異常狀態蓄積無效」→防禦時異常免除、屬性照常；完全命中仍承受異常", l2Relic);
    await rtSet(pageA, "character/" + tokenA + "/learnedRelicEffects", []);

    // ======================================================================
    console.log("\n=== H3：夜の勢力最終輪獎勵只發一次（兩台同時偵測 HP=0） ===");
    const ptId = "test_nightforce_" + Date.now();
    const slotA = sA.mySlot;
    const slotB = sB.mySlot;
    const participants = {};
    participants[slotA] = true;
    participants[slotB] = true;
    const trig = {
      status: "resolved",
      branchNameJa: "夜の勢力",
      enemyFamilyId: "dummy_family",
      enemyId: "dummy",
      level: 1,
      requiredRounds: 1,
      completedRounds: 0,
      participants,
      resolvedAt: Date.now(),
    };
    await rtSet(pageA, "fieldTrigger/" + ptId, trig);
    await rtSet(pageA, "fieldEnemyHp/" + ptId, 0);
    for (const p of [pageA, pageB]) {
      await waitFor(p, (id) => window.PriTestMidnight._debugState().fieldEnemyHp[id] === 0 && !!window.PriTestMidnight._debugState().fieldTriggers[id], ptId);
    }
    // 兩台同時走真正的 maybeAdvanceNightForceRound()：修正前每台都會發一次獎（2倍）。
    await Promise.all([pageA, pageB].map((p) => p.evaluate((id) => window.PriTestMidnight._debugMaybeAdvanceNightForceRound(id), ptId)));
    await waitFor(pageA, (id) => (window.PriTestMidnight._debugState().fieldTriggers[id] || {}).completedRounds === 1, ptId);
    await pageA.waitForTimeout(800);
    const h3 = await pageA.evaluate(([a, b]) => {
      const pr = window.PriTestMidnight._debugState().pendingRewards || {};
      const count = (t) => Object.keys(pr[t] || {}).filter((k) => pr[t][k].kind === "rune" && pr[t][k].value === 7).length;
      return { a: count(a), b: count(b) };
    }, [tokenA, tokenB]);
    assert(h3.a === 1 && h3.b === 1, "H3：兩台同時偵測，每位參加者只拿到 1 份盧恩7", h3);
    // 第三台若在 completedRounds=1 之後才看到，不會再推進一輪
    await pageB.evaluate((id) => window.PriTestMidnight._debugMaybeAdvanceNightForceRound(id), ptId);
    await pageB.waitForTimeout(500);
    const h3b = await pageA.evaluate(([a, id]) => {
      const s = window.PriTestMidnight._debugState();
      const pr = s.pendingRewards || {};
      return { a: Object.keys(pr[a] || {}).filter((k) => pr[a][k].kind === "rune" && pr[a][k].value === 7).length, rounds: s.fieldTriggers[id].completedRounds };
    }, [tokenA, ptId]);
    assert(h3b.a === 1 && h3b.rounds === 1, "H3：最終輪結算後再偵測不會重複發獎", h3b);

    // ======================================================================
    console.log("\n=== M2：接管席位搬 pendingRewards ===");
    await rtSet(pageA, "pendingRewards/" + tokenB + "/rwtest1", { kind: "rune", value: 3, resolved: false });
    await waitFor(pageA, (t) => {
      const pr = window.PriTestMidnight._debugState().pendingRewards || {};
      return !!(pr[t] && pr[t].rwtest1);
    }, tokenB);
    // 裝置A接管裝置B的席位
    await pageA.evaluate((slot) => window.PriTestMidnight._debugTakeover(slot), slotB);
    await waitFor(pageA, ([a, b]) => {
      const pr = window.PriTestMidnight._debugState().pendingRewards || {};
      return !!(pr[a] && pr[a].rwtest1) && !(pr[b] && pr[b].rwtest1);
    }, [tokenA, tokenB]).catch(() => {});
    const m2 = await pageA.evaluate(([a, b]) => {
      const pr = window.PriTestMidnight._debugState().pendingRewards || {};
      return { mine: !!(pr[a] && pr[a].rwtest1), old: !!(pr[b] && pr[b].rwtest1), oldRune7Kept: Object.keys(pr[a] || {}).filter((k) => pr[a][k].kind === "rune" && pr[a][k].value === 7).length };
    }, [tokenA, tokenB]);
    assert(m2.mine && !m2.old, "M2：接管後未領獎勵清單搬到新 token、舊 token 清掉", m2);
    assert(m2.oldRune7Kept === 2, "M2：新 token 原有清單與舊 token 清單合併（各 1 份盧恩7 → 2 份）", m2);

    // ======================================================================
    const failed = results.filter((r) => !r.pass);
    console.log("\n=== 結果：" + (results.length - failed.length) + "/" + results.length + " 通過 ===");
    if (failed.length) {
      failed.forEach((f) => console.log("  FAILED: " + f.label));
      process.exitCode = 1;
    }
  } catch (e) {
    console.error("[ERROR]", e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();

function window_base(id) {
  const idx = String(id || "").indexOf("::");
  return idx === -1 ? id : id.slice(0, idx);
}
