// ============================================================================
// midnight 2026-09-21 功能批次回歸測試：Playwright ＋ Firebase Local Emulator。
// ============================================================================
// 使用前準備（跟 emulator_sync_check.js 完全相同，見該檔開頭）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node feature_2026_09_21_check.js
//
// 涵蓋項目：
//   ①  測試模式下可調整縮圈兩個時間點（meta.phaseTiming，預設 8 + 5，只在 testMode 生效）
//   ②  隨機事件 banner 納入固定置頂群組（position:fixed／TOP_BANNER_IDS／事件名稱列／折疊鈕）
//   ③  左下消耗品卡片 ◀▶ 切換選取道具（quickConsumableIndex）
//   ④  個人消耗品獎勵滿格時只剩［丟棄］；騰出空間後［確認收下］即時回來
//   ④' 共享池得主武器欄／護符欄已滿時掉在腳邊（不再硬塞超過上限）
//   ⑤  戰鬥面板 #midnight-hud-bottom-center 捲軸隱藏（攻擊特效溢出不再閃出捲軸）
//   ⑥  塗脂使用取得時記錄的固定屬性／持續型效果後放覆蓋不相加／溫石自身 HoT 覆蓋
//   ⑦  消耗品使用動畫（格子上升／水晶碎裂／治癒粒子／蓄積徽章消散）、持續型常駐視覺 class、
//       刀類／瓶壺兩種投擲飛法、瓶壺落地屬性爆裂、扇投暗器多段連閃
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
  pageA.on("pageerror", (e) => console.log("  [pageerror] " + e.message));

  try {
    await enableEmulatorFlag(pageA);
    console.log("=== 建立 midnight 測試場（連本機 emulator） ===");
    await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await pageA.click("#btn-midnight-create");
    await pageA.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });

    // ======================================================================
    console.log("\n=== ①（等待房）測試模式縮圈時間點輸入框 ===");
    const rowHiddenBefore = await pageA.$eval("#midnight-lobby-phase-timing-row", (el) => el.hidden);
    assert(rowHiddenBefore === true, "①：未開測試模式時輸入框列隱藏");
    const defaultTiming = await pageA.evaluate(() => window.PriTestMidnight._debugPhaseTiming());
    assert(defaultTiming.graceMs === 8 * 60000 && defaultTiming.holdMs === 5 * 60000, "①：預設 8 + 5 分鐘", defaultTiming);
    await rtSet(pageA, "meta/testMode", true); // 略過密碼 prompt，直接寫 meta
    await waitFor(pageA, () => !document.getElementById("midnight-lobby-phase-timing-row").hidden);
    assert(true, "①：開測試模式後輸入框列顯示");
    const inputDefaults = await pageA.evaluate(() => ({
      grace: document.getElementById("midnight-lobby-phase-grace-input").value,
      hold: document.getElementById("midnight-lobby-phase-hold-input").value,
    }));
    assert(inputDefaults.grace === "8" && inputDefaults.hold === "5", "①：輸入框預填 8／5", inputDefaults);
    await pageA.fill("#midnight-lobby-phase-grace-input", "0.5");
    await pageA.fill("#midnight-lobby-phase-hold-input", "0.25");
    await waitFor(pageA, () => {
      const m = window.PriTestMidnight._debugState().meta;
      return m.phaseTiming && m.phaseTiming.graceMin === 0.5 && m.phaseTiming.holdMin === 0.25;
    });
    assert(true, "①：輸入寫入 meta.phaseTiming {graceMin:0.5, holdMin:0.25}");
    const tunedTiming = await pageA.evaluate(() => window.PriTestMidnight._debugPhaseTiming());
    assert(tunedTiming.graceMs === 30000 && tunedTiming.holdMs === 15000, "①：phaseGraceMs／phaseHoldMs 改讀 meta", tunedTiming);
    assert(
      tunedTiming.boundaries[0] === 30000 && tunedTiming.boundaries[1] === 65000 && tunedTiming.boundaries[2] === 80000 && tunedTiming.totalMs === 100000,
      "①：階段邊界＝30s／65s／80s／100s（shrink1 35s、shrink2 20s 不變）",
      tunedTiming
    );
    const stages = await pageA.evaluate(() => [29000, 31000, 79000, 81000, 100001].map((t) => window.PriTestMidnight._debugComputeDayStage(t)));
    assert(
      stages[0] === "grace" && stages[1] === "shrink1" && stages[2] === "hold" && stages[3] === "shrink2" && stages[4] === "done",
      "①：computeDayStage() 依調整後的時間點分段",
      stages
    );
    // 負數不寫入
    await pageA.fill("#midnight-lobby-phase-grace-input", "-3");
    await pageA.waitForTimeout(300);
    const negTiming = await pageA.evaluate(() => window.PriTestMidnight._debugState().meta.phaseTiming.graceMin);
    assert(negTiming === 0.5, "①：負數輸入被忽略，meta 維持 0.5", negTiming);
    // 關掉測試模式→仍維持新設定（2026-09-22使用者明確規格「即使關掉測試模式也是按照新設定
    // 之時間點」；舊期望「回到 8 + 5」已過時）。輸入框列本身仍隨測試模式隱藏。
    await rtSet(pageA, "meta/testMode", false);
    await waitFor(pageA, () => document.getElementById("midnight-lobby-phase-timing-row").hidden);
    const offTiming = await pageA.evaluate(() => window.PriTestMidnight._debugPhaseTiming());
    assert(offTiming.graceMs === 30000 && offTiming.holdMs === 15000, "①：關閉測試模式後仍套用 0.5 + 0.25（meta.phaseTiming 永久生效）", offTiming);
    await rtSet(pageA, "meta/phaseTiming", null);
    await waitFor(pageA, () => window.PriTestMidnight._debugPhaseTiming().graceMs === 8 * 60000);
    assert(true, "①：清掉 meta.phaseTiming 後回到預設 8 + 5");

    // ======================================================================
    console.log("\n=== 等待房：加入並準備，進入遊戲 ===");
    await joinLobby(pageA, "1234");
    await pageA.click("#btn-midnight-lobby-ready");
    await pageA.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 25000 });
    await pageA.waitForFunction(() => {
      const s = window.PriTestMidnight._debugState();
      return !!s.characters[s.myTokenId] && !!s.localPos;
    }, { timeout: META_WAIT_MS });

    // ======================================================================
    console.log("\n=== ② 隨機事件 banner 納入固定置頂群組 ===");
    const bannerIds = await pageA.evaluate(() => window.PriTestMidnight._debugTopBannerIds());
    assert(bannerIds.indexOf("midnight-random-event-banner") !== -1 && bannerIds.indexOf("midnight-scarab-banner") !== -1, "②：TOP_BANNER_IDS 含隨機事件／聖甲蟲 banner", bannerIds);
    const bannerCss = await pageA.evaluate(() => {
      const out = {};
      ["midnight-random-event-banner", "midnight-scarab-banner", "midnight-field-banner"].forEach((id) => {
        const cs = getComputedStyle(document.getElementById(id));
        out[id] = { position: cs.position, zIndex: cs.zIndex };
      });
      return out;
    });
    assert(
      bannerCss["midnight-random-event-banner"].position === "fixed" && bannerCss["midnight-scarab-banner"].position === "fixed",
      "②：兩個隨機事件 banner 都是 position:fixed（跟一般板塊 banner 同組）",
      bannerCss
    );
    assert(bannerCss["midnight-random-event-banner"].zIndex === bannerCss["midnight-field-banner"].zIndex, "②：z-index 跟一般板塊 banner 相同", bannerCss);
    const hasCollapseBtn = await pageA.$eval("#midnight-random-event-banner", (el) => !!el.querySelector(".midnight-top-banner-collapse-btn"));
    assert(hasCollapseBtn, "②：隨機事件 banner 有右上折疊鈕");
    const goddessName = await pageA.evaluate(() => window.PriTestMidnight._debugRandomEventBranchDisplayName("女神像"));
    assert(goddessName === "女神像", "②：分支名稱雙語查表（zh）", goddessName);
    // 模擬「靠近一個已決定為女神像的隨機事件點」：寫 fieldTrigger 後在同一個 evaluate 內設定並讀取
    const rePtId = "re_probe_2026_09_21";
    await rtSet(pageA, "fieldTrigger/" + rePtId, { status: "resolved", branchNameJa: "女神像", participants: {}, resolvedAt: Date.now() });
    await waitFor(pageA, (id) => !!window.PriTestMidnight._debugState().fieldTriggers[id], rePtId);
    const bannerProbe = await pageA.evaluate((id) => {
      const M = window.PriTestMidnight;
      M._debugSetNearbyRandomEvent({ id: id, type: "random_event", x: 0, y: 0 });
      const banner = document.getElementById("midnight-random-event-banner");
      const out = {
        hidden: banner.hidden,
        name: document.getElementById("midnight-random-event-name").textContent,
        text: document.getElementById("midnight-random-event-text").textContent.length,
        actionHidden: document.getElementById("midnight-random-event-action").hidden,
      };
      M._debugSetNearbyRandomEvent(null);
      out.hiddenAfter = document.getElementById("midnight-random-event-banner").hidden;
      return out;
    }, rePtId);
    assert(bannerProbe.hidden === false && bannerProbe.name === "女神像" && bannerProbe.text > 0, "②：靠近時 banner 顯示事件名稱＋敘述", bannerProbe);
    assert(bannerProbe.actionHidden === false, "②：判定按鈕（抽取）顯示在 banner 內", bannerProbe);
    assert(bannerProbe.hiddenAfter === true, "②：離開後 banner 收起", bannerProbe);
    await rtSet(pageA, "fieldTrigger/" + rePtId, null);

    // ======================================================================
    console.log("\n=== ③ 消耗品卡片 ◀▶ 切換 ===");
    // 先清空消耗品欄，再放 3 種不同道具
    await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const before = M._debugSnapshotMyCharacter();
      s.characters[s.myTokenId].consumables = [];
      M._debugSyncMyCharacterChanges(before);
    });
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      return (s.characters[s.myTokenId].consumables || []).length === 0;
    });
    await pageA.evaluate(() => window.PriTestMidnight._tick());
    const cycleDisabledEmpty = await pageA.$eval("#btn-midnight-consumable-next", (el) => el.disabled);
    assert(cycleDisabledEmpty === true, "③：沒有道具時 ▶ 停用");
    await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugGrantConsumable("item_warming_stone", 2);
      M._debugGrantConsumable("item_shard_of_starlight", 2);
      M._debugGrantConsumable("item_throwing_dagger", 3);
    });
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      return (s.characters[s.myTokenId].consumables || []).length === 3;
    });
    await pageA.evaluate(() => window.PriTestMidnight._tick());
    const q0 = await pageA.evaluate(() => window.PriTestMidnight._debugQuickConsumable());
    assert(q0.index === 0 && q0.itemId === "item_warming_stone", "③：初始選取第 0 格", q0);
    const cycleEnabled = await pageA.$eval("#btn-midnight-consumable-next", (el) => el.disabled);
    assert(cycleEnabled === false, "③：3 格時 ▶ 可按");
    await pageA.dispatchEvent("#btn-midnight-consumable-next", "click");
    const q1 = await pageA.evaluate(() => window.PriTestMidnight._debugQuickConsumable());
    const label1 = await pageA.$eval("#midnight-consumable-label", (el) => el.textContent);
    const index1 = await pageA.$eval("#midnight-consumable-index", (el) => ({ hidden: el.hidden, text: el.textContent }));
    assert(q1.index === 1 && q1.itemId === "item_shard_of_starlight", "③：▶ 後選取第 1 格", q1);
    assert(label1.indexOf("星光") !== -1 && label1.indexOf("x2") !== -1, "③：卡片文字顯示第 1 格道具與數量", label1);
    assert(index1.hidden === false && index1.text === "2/3", "③：第N格／共M格小字", index1);
    await pageA.dispatchEvent("#btn-midnight-consumable-next", "click");
    await pageA.dispatchEvent("#btn-midnight-consumable-next", "click");
    const qWrap = await pageA.evaluate(() => window.PriTestMidnight._debugQuickConsumable());
    assert(qWrap.index === 0, "③：▶ 循環回到第 0 格", qWrap);
    await pageA.dispatchEvent("#btn-midnight-consumable-prev", "click");
    const qPrev = await pageA.evaluate(() => window.PriTestMidnight._debugQuickConsumable());
    assert(qPrev.index === 2 && qPrev.itemId === "item_throwing_dagger", "③：◀ 從第 0 格循環到最後一格", qPrev);
    // 使用目前選取的道具（第 2 格投擲短劍，沒有 activeEncounter 時只扣次數）
    await pageA.dispatchEvent("#btn-midnight-use-consumable", "click");
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      const list = s.characters[s.myTokenId].consumables || [];
      return list.length === 3 && list[2].usesRemaining === 2;
    });
    assert(true, "③：使用鍵作用在選取中的那一格（投擲短劍 3→2）");
    // 陣列縮短時索引夾回範圍：把第 2 格整個拿掉
    await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const before = M._debugSnapshotMyCharacter();
      s.characters[s.myTokenId].consumables = s.characters[s.myTokenId].consumables.slice(0, 2);
      M._debugSyncMyCharacterChanges(before);
    });
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      return (s.characters[s.myTokenId].consumables || []).length === 2;
    });
    const qClamp = await pageA.evaluate(() => window.PriTestMidnight._debugQuickConsumable());
    assert(qClamp.index === 1 && qClamp.itemId === "item_shard_of_starlight", "③：持有數變少時索引夾回最後一格", qClamp);

    // ======================================================================
    console.log("\n=== ④ 個人消耗品獎勵滿格只剩［丟棄］ ===");
    // 4 格塞滿（每格 6 個，4 種不同品項）→ 第 5 種完全放不下
    await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const before = M._debugSnapshotMyCharacter();
      s.characters[s.myTokenId].consumables = [];
      M._debugSyncMyCharacterChanges(before);
    });
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      return (s.characters[s.myTokenId].consumables || []).length === 0;
    });
    await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      ["item_warming_stone", "item_shard_of_starlight", "item_turtle_neck_pickle", "item_bitter_medicine"].forEach((id) => M._debugGrantConsumable(id, 6));
    });
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      const list = s.characters[s.myTokenId].consumables || [];
      return list.length === 4 && list.every((i) => i.usesRemaining === 6);
    });
    const rewardId = "rw_probe_full_2026_09_21";
    const sA = await state(pageA);
    await pageA.evaluate(() => window.PriTestMidnight._debugSetRewardModalDismissed(false));
    await rtSet(pageA, "pendingRewards/" + sA.myTokenId + "/" + rewardId, { kind: "consumable", itemId: "item_hero_meat_chunk", resolved: false, drawn: { itemId: "item_hero_meat_chunk" } });
    await waitFor(pageA, (id) => {
      const s = window.PriTestMidnight._debugState();
      return !!(s.pendingRewards && s.pendingRewards[s.myTokenId] && s.pendingRewards[s.myTokenId][id]);
    }, rewardId);
    await pageA.evaluate(() => window.PriTestMidnight._debugRenderRewardModal());
    const modalOpen = await pageA.$eval("#midnight-reward-modal", (el) => !el.hidden);
    assert(modalOpen, "④：獎勵清單自動彈出");
    const detailFull = await pageA.$eval("#midnight-reward-detail", (el) => {
      const btns = Array.prototype.map.call(el.querySelectorAll("button"), (b) => b.textContent);
      return { warning: !!el.querySelector(".warning-text"), buttons: btns };
    });
    assert(detailFull.warning && detailFull.buttons.length === 1 && detailFull.buttons[0] === "丟棄", "④：滿格時只有［丟棄］一顆按鈕＋黃字提示", detailFull);
    // 即時騰出空間：把第 4 格整個拿掉（模擬在角色面板丟棄）→ 不重新整理，［確認收下］回來
    await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const before = M._debugSnapshotMyCharacter();
      s.characters[s.myTokenId].consumables = s.characters[s.myTokenId].consumables.slice(0, 3);
      M._debugSyncMyCharacterChanges(before);
    });
    await waitFor(pageA, () => {
      const btns = Array.prototype.map.call(document.querySelectorAll("#midnight-reward-detail button"), (b) => b.textContent);
      return btns.indexOf("確認收下") !== -1;
    });
    const detailFreed = await pageA.$eval("#midnight-reward-detail", (el) => ({
      warning: !!el.querySelector(".warning-text"),
      buttons: Array.prototype.map.call(el.querySelectorAll("button"), (b) => b.textContent),
    }));
    assert(!detailFreed.warning && detailFreed.buttons.indexOf("確認收下") !== -1 && detailFreed.buttons.indexOf("丟棄") !== -1, "④：騰出空間後［確認收下］／［丟棄］都回來、黃字消失", detailFreed);
    // 清掉這筆
    await rtSet(pageA, "pendingRewards/" + sA.myTokenId + "/" + rewardId, null);
    // 武器／護符也比照（使用者2026-09-21追加確認）：武器欄塞滿6把後，武器獎勵只剩［丟棄］
    const pickMelee = () => {
      const W = window.PriTestWeapons;
      return W.list().filter((w) => {
        const cat = W.getCategory(w.category);
        return cat && !cat.isShield && !cat.isRanged && cat.id !== "staff" && cat.id !== "sacred_seal";
      })[0].id;
    };
    const weaponCatalogId0 = await pageA.evaluate(pickMelee);
    await pageA.evaluate((wid) => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const before = M._debugSnapshotMyCharacter();
      const c = s.characters[s.myTokenId];
      c.weaponIds = [];
      for (let i = 0; i < 6; i++) c.weaponIds.push(window.PriTestCharacterDrawer.makeWeaponInstanceId(wid, c));
      M._debugSyncMyCharacterChanges(before);
    }, weaponCatalogId0);
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      return (s.characters[s.myTokenId].weaponIds || []).length === 6;
    });
    const weaponRewardId = "rw_probe_weapon_full_2026_09_21";
    await pageA.evaluate(() => window.PriTestMidnight._debugSetRewardModalDismissed(false));
    await rtSet(pageA, "pendingRewards/" + sA.myTokenId + "/" + weaponRewardId, { kind: "weapon", value: 1, resolved: false, drawn: { weaponId: weaponCatalogId0 } });
    await waitFor(pageA, (id) => {
      const s = window.PriTestMidnight._debugState();
      return !!(s.pendingRewards[s.myTokenId] && s.pendingRewards[s.myTokenId][id]);
    }, weaponRewardId);
    await pageA.evaluate(() => window.PriTestMidnight._debugRenderRewardModal());
    const weaponDetailFull = await pageA.$eval("#midnight-reward-detail", (el) => ({
      warning: !!el.querySelector(".warning-text"),
      buttons: Array.prototype.map.call(el.querySelectorAll("button"), (b) => b.textContent),
    }));
    assert(weaponDetailFull.warning && weaponDetailFull.buttons.indexOf("丟棄") !== -1 && weaponDetailFull.buttons.indexOf("確認收下") === -1, "④：武器欄滿格時武器獎勵也只剩［丟棄］", weaponDetailFull);
    await rtSet(pageA, "pendingRewards/" + sA.myTokenId + "/" + weaponRewardId, null);

    // ======================================================================
    console.log("\n=== ④' 共享池得主武器／護符欄滿時掉在腳邊 ===");
    const weaponCatalogId = await pageA.evaluate(pickMelee);
    await pageA.evaluate((wid) => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const before = M._debugSnapshotMyCharacter();
      const c = s.characters[s.myTokenId];
      c.weaponIds = [];
      for (let i = 0; i < 6; i++) c.weaponIds.push(window.PriTestCharacterDrawer.makeWeaponInstanceId(wid, c));
      c.talismanIds = ["talisman_companion_jar", "talisman_perfumers"];
      M._debugSyncMyCharacterChanges(before);
    }, weaponCatalogId);
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      const c = s.characters[s.myTokenId];
      return (c.weaponIds || []).length === 6 && (c.talismanIds || []).length === 2;
    });
    const groundBefore = Object.keys((await state(pageA)).groundItems || {}).length;
    const grantWeapon = await pageA.evaluate((wid) => window.PriTestMidnight._debugApplyDrawnSharedReward({ kind: "weapon" }, { weaponId: wid, skillId: null, affixes: null }), weaponCatalogId);
    const grantTalisman = await pageA.evaluate(() => window.PriTestMidnight._debugApplyDrawnSharedReward({ kind: "talisman" }, { talismanId: "talisman_companion_jar" }));
    await waitFor(pageA, (n) => Object.keys(window.PriTestMidnight._debugState().groundItems || {}).length >= n + 2, groundBefore);
    const groundAfter = await pageA.evaluate(() => {
      const g = window.PriTestMidnight._debugState().groundItems || {};
      return Object.keys(g).map((k) => g[k].kind);
    });
    assert(grantWeapon.weaponCount === 6 && grantTalisman.talismanCount === 2, "④'：持有量維持 6／2，沒有硬塞超過上限", { grantWeapon, grantTalisman });
    assert(groundAfter.indexOf("weapon") !== -1 && groundAfter.indexOf("talisman") !== -1, "④'：武器與護符各掉了一件在地上", groundAfter);

    // ======================================================================
    console.log("\n=== ⑤ 戰鬥面板捲軸隱藏 ===");
    const centerCss = await pageA.evaluate(() => {
      const cs = getComputedStyle(document.getElementById("midnight-hud-bottom-center"));
      return { overflowX: cs.overflowX, overflowY: cs.overflowY, scrollbarWidth: cs.scrollbarWidth };
    });
    assert(centerCss.overflowX === "hidden" && centerCss.overflowY === "auto" && centerCss.scrollbarWidth === "none", "⑤：overflow-x hidden／overflow-y auto／scrollbar-width none", centerCss);

    // ======================================================================
    console.log("\n=== ⑥ 塗脂固定屬性／持續型覆蓋規則 ===");
    // 左手先空手（追蹤者初始左手是盾，塗脂會優先塗盾），右手主武器塗上取得時記錄的「雷」
    await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const before = M._debugSnapshotMyCharacter();
      const c = s.characters[s.myTokenId];
      c.equippedWeaponIdL = "";
      c.equippedWeaponIdR = c.weaponIds[0];
      c.consumables = [];
      M._debugSyncMyCharacterChanges(before);
    });
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      const c = s.characters[s.myTokenId];
      return c.equippedWeaponIdL === "" && (c.consumables || []).length === 0;
    });
    const greaseGrant = await pageA.evaluate(() => window.PriTestMidnight._debugGrantConsumable("item_grease", 2, "雷"));
    const greaseInstId = greaseGrant.consumables[0].id;
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      return (s.characters[s.myTokenId].consumables || []).length === 1;
    });
    await pageA.evaluate(() => window.PriTestMidnight._tick());
    const greaseLabel = await pageA.$eval("#midnight-consumable-label", (el) => el.textContent);
    assert(greaseLabel.indexOf("塗脂（雷）") !== -1, "⑥：卡片顯示塗脂（雷）", greaseLabel);
    await pageA.evaluate((instId) => window.PriTestMidnight._debugApplyConsumable("item_grease", instId), greaseInstId);
    const greaseBuff = await pageA.evaluate(() => window.PriTestMidnight._debugConsumableBuffs().grease);
    assert(greaseBuff.weaponId && greaseBuff.elementRef && greaseBuff.elementRef.ja === "雷", "⑥：塗脂使用後武器附帶取得時指定的屬性（雷），不需選擇", greaseBuff);
    // 沒有記錄屬性的塗脂維持預設「炎」
    await pageA.evaluate(() => window.PriTestMidnight._debugApplyConsumable("item_grease", null));
    const greaseDefault = await pageA.evaluate(() => window.PriTestMidnight._debugConsumableBuffs().grease.elementRef);
    assert(greaseDefault && greaseDefault.ja === "炎", "⑥：無屬性記錄的塗脂維持預設炎", greaseDefault);
    // 持續型覆蓋：勇者的肉塊連用兩次，到期時間＝第二次＋10s（不相加）
    const heroT1 = await pageA.evaluate(() => {
      window.PriTestMidnight._debugApplyConsumable("item_hero_meat_chunk");
      const s = window.PriTestMidnight._debugState();
      return s.characters[s.myTokenId]._heroMeatUntil;
    });
    await pageA.waitForTimeout(400);
    const heroT2 = await pageA.evaluate(() => {
      const t0 = Date.now();
      window.PriTestMidnight._debugApplyConsumable("item_hero_meat_chunk");
      const s = window.PriTestMidnight._debugState();
      return { until: s.characters[s.myTokenId]._heroMeatUntil, t0 };
    });
    assert(heroT2.until > heroT1 && heroT2.until - heroT2.t0 <= 10000 + 50, "⑥：持續型後放覆蓋前一個，時間不相加（勇者的肉塊）", { heroT1, heroT2 });
    // 溫石：自身HoT重用時覆蓋（只剩1筆），隊友那筆不覆蓋——單人場只有自己，驗證自身覆蓋
    await pageA.evaluate(() => {
      window.PriTestMidnight._debugApplyConsumable("item_warming_stone");
      window.PriTestMidnight._debugApplyConsumable("item_warming_stone");
    });
    const hot = await pageA.evaluate(() => window.PriTestMidnight._debugHealOverTime());
    const hotSelf = hot.filter((e) => e.tokenId === sA.myTokenId);
    assert(hotSelf.length === 1, "⑥：溫石自身持續回復重用時只剩1筆（覆蓋不疊加）", hot);

    // ======================================================================
    console.log("\n=== ⑦ 消耗品使用動畫／持續型常駐視覺 ===");
    // 使用當下的一次性動畫：龜首漬→卡片上升class＋體力條閃光；星光→格子外粒子＋FP條閃光
    const turtleFx = await pageA.evaluate(() => {
      window.PriTestMidnight._debugApplyConsumable("item_turtle_neck_pickle");
      return {
        rise: document.getElementById("btn-midnight-use-consumable").classList.contains("midnight-card-rise-play"),
        bar: document.getElementById("midnight-self-stamina-fill").classList.contains("midnight-bar-flash"),
      };
    });
    assert(turtleFx.rise && turtleFx.bar, "⑦：龜首漬→消耗品格上升動畫＋體力條閃光", turtleFx);
    const shardFx = await pageA.evaluate(() => {
      window.PriTestMidnight._debugApplyConsumable("item_shard_of_starlight");
      return {
        particles: document.querySelectorAll("#midnight-consumable-fx .midnight-card-particle-crystal").length,
        bar: document.getElementById("midnight-self-fp-fill").classList.contains("midnight-bar-flash"),
      };
    });
    assert(shardFx.particles >= 6 && shardFx.bar, "⑦：星光的碎片→格子外水晶碎片＋FP條閃光", shardFx);
    // 苔藥：先墊一點自身猛毒蓄積，使用後徽章分身播消散
    const bitterFx = await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugRecordReceivedAccum("猛毒", 2);
      M._tick();
      const chipBefore = !!document.querySelector('#midnight-self-accum-note .midnight-accum-chip[data-accum-name="猛毒"]');
      M._debugApplyConsumable("item_bitter_medicine");
      return {
        chipBefore,
        clone: document.querySelectorAll(".midnight-dissolve-clone").length,
        heal: document.querySelectorAll("#midnight-consumable-fx .midnight-card-particle-heal").length,
      };
    });
    assert(bitterFx.chipBefore && bitterFx.clone === 1 && bitterFx.heal >= 6, "⑦：苔藥→治癒粒子＋蓄積徽章消散分身", bitterFx);
    // 持續型常駐視覺（每幀依_xxxUntil）：勇者的肉塊／塗脂／酸之噴霧／鐵壺／高揚之香／溫石
    await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugApplyConsumable("item_hero_meat_chunk");
      M._debugApplyConsumable("item_perfume_acid_spray");
      M._debugApplyConsumable("item_perfume_iron_pot_spray");
      M._debugApplyConsumable("item_perfume_uplifting_aroma");
      M._debugApplyConsumable("item_warming_stone");
    });
    await waitFor(pageA, () => {
      const m = window.PriTestMidnight._debugState().meta;
      return m.partyUpliftUntil && m.partyUpliftUntil > Date.now();
    });
    const buffVis = await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugUpdateConsumableBuffVisuals();
      const cls = (id) => Array.prototype.slice.call(document.getElementById(id).classList);
      const s = M._debugState();
      const myCard = document.querySelector('#midnight-hud-top-left .midnight-slot-card[data-token-id="' + s.myTokenId + '"]');
      return {
        attack: cls("btn-midnight-attack-shared-target"),
        skill: cls("btn-midnight-skill"),
        dodge: cls("btn-midnight-dodge"),
        block: cls("btn-midnight-block"),
        sheetBtn: cls("btn-midnight-open-character-sheet"),
        rightPanel: cls("midnight-hud-bottom-right"),
        weaponR: cls("btn-midnight-weapon-right"),
        weaponRColor: document.getElementById("btn-midnight-weapon-right").style.getPropertyValue("--buff-color"),
        attackIcon: document.getElementById("btn-midnight-attack-shared-target").style.getPropertyValue("--buff-icon"),
        card: myCard ? Array.prototype.slice.call(myCard.classList) : null,
      };
    });
    assert(buffVis.attack.indexOf("midnight-buff-rise") !== -1 && buffVis.skill.indexOf("midnight-buff-rise") !== -1, "⑦：勇者的肉塊→攻擊／戰技鍵上升符號class", buffVis);
    assert(buffVis.attack.indexOf("midnight-buff-element") !== -1 && buffVis.attackIcon.indexOf("✸") !== -1, "⑦：塗脂（炎）→右手攻擊鍵屬性符號class＋--buff-icon", buffVis);
    assert(buffVis.weaponR.indexOf("midnight-buff-plated") !== -1 && buffVis.weaponRColor !== "", "⑦：塗脂→右手武器卡片鍍色", buffVis);
    assert(buffVis.dodge.indexOf("midnight-buff-shield") !== -1 && buffVis.block.indexOf("midnight-buff-shield") !== -1, "⑦：酸之噴霧／鐵壺→迴避／防禦鍵盾牌背景class", buffVis);
    assert(buffVis.sheetBtn.indexOf("midnight-buff-iron") !== -1, "⑦：鐵壺→「角色」鍵鐵化class", buffVis);
    assert(buffVis.rightPanel.indexOf("midnight-buff-rise-party") !== -1, "⑦：高揚之香→右下操作區上升符號class", buffVis);
    assert(buffVis.card && buffVis.card.indexOf("midnight-buff-heal") !== -1 && buffVis.card.indexOf("midnight-buff-uplift") !== -1 && buffVis.card.indexOf("midnight-buff-iron") !== -1, "⑦：自身席位卡片 治癒／亮起／鐵化 class", buffVis);
    // 到期後全部消失：把時間戳撥回過去再更新一次
    const buffOff = await pageA.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      c._heroMeatUntil = 0;
      c._greaseUntil = 0;
      c._acidSprayUntil = 0;
      c._ironPotUntil = 0;
      s.meta.partyUpliftUntil = 0;
      M._debugUpdateConsumableBuffVisuals();
      const has = (id, cls) => document.getElementById(id).classList.contains(cls);
      return {
        rise: has("btn-midnight-attack-shared-target", "midnight-buff-rise"),
        element: has("btn-midnight-attack-shared-target", "midnight-buff-element"),
        shield: has("btn-midnight-dodge", "midnight-buff-shield"),
        iron: has("btn-midnight-open-character-sheet", "midnight-buff-iron"),
        party: has("midnight-hud-bottom-right", "midnight-buff-rise-party"),
        plated: has("btn-midnight-weapon-right", "midnight-buff-plated"),
      };
    });
    assert(!buffOff.rise && !buffOff.element && !buffOff.shield && !buffOff.iron && !buffOff.party && !buffOff.plated, "⑦：時限到期後常駐視覺全部消失", buffOff);
    // 投擲：刀類／瓶壺兩種飛法，瓶壺落地屬性爆裂，扇投暗器10段連閃
    await pageA.evaluate(() => window.PriTestMidnight._debugSetActiveEncounterForFx(true));
    const throwBlade = await pageA.evaluate(() => {
      window.PriTestMidnight._debugApplyConsumable("item_throwing_dagger");
      const e = document.getElementById("midnight-consumable-throw-effect");
      return { hidden: e.hidden, cls: Array.prototype.slice.call(e.classList), dy: e.style.getPropertyValue("--throw-dy") };
    });
    assert(!throwBlade.hidden && throwBlade.cls.indexOf("midnight-throw-blade") !== -1 && throwBlade.dy !== "", "⑦：投擲短劍→刀類飛行（起點寫入--throw-dx/dy）", throwBlade);
    await pageA.waitForTimeout(650);
    const throwPot = await pageA.evaluate(() => {
      window.PriTestMidnight._debugSetActiveEncounterForFx(true); // 每幀recomputeActiveEncounter()會把假遭遇清掉，使用前再設一次
      window.PriTestMidnight._debugApplyConsumable("item_perfume_poison_spray");
      const e = document.getElementById("midnight-consumable-throw-effect");
      return { cls: Array.prototype.slice.call(e.classList), color: e.style.getPropertyValue("--throw-color") };
    });
    assert(throwPot.cls.indexOf("midnight-throw-pot") !== -1 && throwPot.color === "#4ecb6b", "⑦：毒之噴霧→瓶壺飛行＋毒色", throwPot);
    await pageA.waitForTimeout(600);
    const burst = await pageA.evaluate(() => {
      const b = document.getElementById("midnight-throw-burst");
      return { hidden: b.hidden, play: b.classList.contains("midnight-throw-burst-play"), mark: document.getElementById("midnight-throw-burst-mark").textContent, color: b.style.getPropertyValue("--burst-color") };
    });
    assert(!burst.hidden && burst.play && burst.mark === "☣" && burst.color === "#4ecb6b", "⑦：瓶壺落地→毒屬性爆裂（符號＋顏色）", burst);
    await pageA.waitForTimeout(700);
    const shurikenFlash = await pageA.evaluate(async () => {
      window.PriTestMidnight._debugSetActiveEncounterForFx(true);
      window.PriTestMidnight._debugApplyConsumable("item_folding_shuriken");
      const hit = document.getElementById("midnight-enemy-hit-effect");
      let plays = 0;
      let lastAnim = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 1500) {
        await new Promise((r) => setTimeout(r, 15));
        window.PriTestMidnight._debugSetActiveEncounterForFx(true); // triggerMultiSlash()每段都檢查activeEncounter
        if (hit.hidden) continue;
        const anims = hit.getAnimations();
        const a = anims[0];
        if (a && a !== lastAnim) {
          plays += 1;
          lastAnim = a;
        }
      }
      return plays;
    });
    assert(shurikenFlash >= 5, "⑦：扇投暗器落地後多段連閃（觀測到≥5次動畫重播）", shurikenFlash);
    await pageA.evaluate(() => window.PriTestMidnight._debugSetActiveEncounterForFx(false));
  } catch (e) {
    console.log("  [ERROR] " + (e && e.stack ? e.stack : e));
    results.push({ label: "腳本執行中斷：" + (e && e.message), pass: false });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n=== 結果：" + (results.length - failed.length) + "/" + results.length + " 通過 ===");
  failed.forEach((r) => console.log("  FAIL: " + r.label));
  process.exit(failed.length ? 1 : 0);
})();
