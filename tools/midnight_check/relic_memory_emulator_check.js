// ============================================================================
// 遺物記憶 emulator 回歸測試（Firebase Local Emulator，不連正式專案）。
// 前置：
//   1. python generate.py
//   2. python -m http.server 8791 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node relic_memory_emulator_check.js
// 本機環境備註：這台機器 9000 port 被 IntelliJ IDEA 佔用，emulator 的 database 改跑在
// 9010（auth 仍是 9099）。用環境變數 PRITEST_EMU_PORT 覆寫（預設 "9000"），並透過
// enableEmulatorFlag()把同一個 port 寫進 sessionStorage，讓頁面內的
// game_storage.js（pritestRtdbEmulatorPort override）連到同一個 emulator。
// ============================================================================
const { chromium } = require("playwright");
const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const EMU_PORT = process.env.PRITEST_EMU_PORT || "9000";
const EMU = "http://127.0.0.1:" + EMU_PORT;
const NS = "elden-ring-nightreign-default-rtdb";
const TEST_CODE = "TST01";
const META_WAIT_MS = 15000;

let fails = 0;
const assert = (c, l) => { console.log((c ? "  [PASS] " : "  [FAIL] ") + l); if (!c) fails++; };

// emulator 的 owner token 可以繞過規則，只用來佈置測試資料（正式環境對應 Console 手動匯入）。
async function adminPut(pathStr, value) {
  const res = await fetch(`${EMU}/${pathStr}.json?ns=${NS}`, {
    method: "PUT",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error("adminPut failed " + res.status);
}

// 讓執行中的 emulator 套用目前 repo 版本的 database.rules.json（避免忘記重啟 emulator
// 而繼續吃舊規則；正式環境仍是各自 firebase deploy --only database / Console 貼上）。
async function pushRules() {
  const fs = require("fs");
  const path = require("path");
  const rulesPath = path.join(__dirname, "..", "..", "database.rules.json");
  const rules = fs.readFileSync(rulesPath, "utf8");
  const res = await fetch(`${EMU}/.settings/rules.json?ns=${NS}`, {
    method: "PUT",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: rules,
  });
  if (!res.ok) throw new Error("pushRules failed " + res.status);
}

async function enableEmulatorFlag(page) {
  await page.addInitScript((port) => {
    try { window.sessionStorage.setItem("pritestRtdbEmulator", "1"); } catch (e) {}
    try { window.sessionStorage.setItem("pritestRtdbEmulatorPort", port); } catch (e) {}
  }, EMU_PORT);
}

// 正式規則只允許 m+16位小寫hex（database.rules.json的$memId .validate），測試fixture一律
// 用合法格式，不再用"mA"之類的短id（短id曾經是規則裡專門為測試開的例外，第一輪review後
// 已收緊為只有正式格式，這裡的fixture跟著改，並新增一筆「不合法memId應該被拒絕」的斷言）。
const VALID_MEM_ID = "m00000000000000a1";
const INVALID_MEM_ID = "mBAD";

async function storageSection(page) {
  console.log("=== 儲存 API ＋ 規則 ===");
  await adminPut("relicMemoryCodes", { [TEST_CODE]: true });
  await adminPut("relicMemories/" + TEST_CODE, null);
  const r = await page.evaluate(async (args) => {
    const GS = window.PriTestGameStorage;
    const code = args.code;
    const memId = args.memId;
    const badMemId = args.badMemId;
    const empty = await GS.relicMemoryRead(code);
    const bad = await GS.relicMemoryRead("ZZZZZ");
    const tx = await GS.relicMemoryTransaction(code, (cur) => Object.assign({}, cur || {}, { [memId]: { memId: memId, size: "s", effects: ["attack_dmg"], createdAt: 1, favorite: false, source: "start" } }));
    const fav = await GS.relicMemorySet(code, memId, { memId: memId, size: "s", effects: ["attack_dmg"], createdAt: 1, favorite: true, source: "start" });
    const after = await GS.relicMemoryRead(code);
    const badMemIdSet = await GS.relicMemorySet(code, badMemId, { memId: badMemId, size: "s", effects: ["attack_dmg"], createdAt: 1, favorite: false, source: "start" });
    const del = await GS.relicMemorySet(code, memId, null);
    const afterDel = await GS.relicMemoryRead(code);
    return { empty, bad, tx, fav, after, badMemIdSet, del, afterDel };
  }, { code: TEST_CODE, memId: VALID_MEM_ID, badMemId: INVALID_MEM_ID });
  assert(r.empty.ok && r.empty.value === null, "有效密碼、尚無資料 → ok/null");
  assert(!r.bad.ok && r.bad.error === "denied", "未登錄密碼 → denied");
  assert(r.tx.ok && r.tx.value && r.tx.value[VALID_MEM_ID], "transaction 寫入");
  assert(r.fav.ok && r.after.value[VALID_MEM_ID].favorite === true, "relicMemorySet 更新最愛");
  assert(!r.badMemIdSet.ok, "不合法memId（非m+16位hex）→ relicMemorySet ok:false");
  assert(r.del.ok && r.afterDel.value === null, "relicMemorySet(null) 刪除");
}

// 注意：等待房（尚未開局）的按鈕改用page.click()、不用dispatchEvent()——CLAUDE.md §4.6的
// dispatchEvent建議是針對「開局後每影格重繪的HUD按鈕」（page.click()的stable檢查在持續
// 重繪的元素上會逾時）。等待房沒有這個問題，既有的multi_device_sync_check.js／
// late_join_check.js都用page.click()成功。實測發現這裡若改用dispatchEvent()，背景分頁
// （pageB從未bringToFront）在「A剛加入、RTDB把players推播給B、B的onPlayersReceived
// 觸發renderLobby()整段重建#midnight-lobby-slots」這個時間點附近呼叫，
// 有時會在事件真正送達前元素已被替換掉，導致表單沒有顯示、後續page.fill()逾時
// （in-page的element.click()或page.click()因為有內建的重試/actionability等待，不受影響）。
async function joinLobby(page, passcode) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", passcode);
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
}

async function createAndStart(pageA, pageB, beforeReady) {
  await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
  await pageA.click("#btn-midnight-create");
  await pageA.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
  const url = pageA.url();
  await pageB.goto(url, { waitUntil: "networkidle" });
  await pageB.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
  await joinLobby(pageA, "1234");
  await joinLobby(pageB, "5678");
  if (beforeReady) await beforeReady();
  await pageA.click("#btn-midnight-lobby-ready");
  await pageB.click("#btn-midnight-lobby-ready");
  for (const p of [pageA, pageB]) {
    await p.waitForFunction(() => {
      const d = window.PriTestMidnight._debugState();
      return d.meta.sessionStartAt && d.characters && d.characters[d.myTokenId];
    }, { timeout: 25000 });
  }
  return url;
}

async function grantSection(pageA, pageB) {
  console.log("=== 遊戲中獲得 ===");
  const startA = await pageA.evaluate(() => window.PriTestMidnight._debugRelicMemory());
  assert(startA.earned.length === 1 && startA.earned[0].size === "s" && startA.earned[0].source === "start", "開局小×1");
  // 直接寫入 grant（里程碑判定本身由 milestoneGrantKeys 單元測試涵蓋）
  const gid = await pageA.evaluate(() => window.PriTestMidnight._debugState().gameId);
  await pageA.evaluate((g) => window.PriTestGameStorage.rtSet(g, "cloud", "meta/relicMemoryGrants/day2", { kind: "day2", at: Date.now() }), gid);
  for (const p of [pageA, pageB]) {
    await p.waitForFunction(() => window.PriTestMidnight._debugRelicMemory().earned.length === 3, { timeout: 8000 }).catch(() => {});
  }
  const a = await pageA.evaluate(() => window.PriTestMidnight._debugRelicMemory());
  const b = await pageB.evaluate(() => window.PriTestMidnight._debugRelicMemory());
  assert(a.earned.length === 3 && b.earned.length === 3, "day2 事件 → 兩人各 +2（中＋中/大）");
  assert(a.earned[1].size === "m" && a.seen.day2 === true, "day2 第一個固定中、已標記 seen");
  // 同一事件再寫一次不應重複發
  await pageA.evaluate((g) => window.PriTestGameStorage.rtSet(g, "cloud", "meta/relicMemoryGrants/day2", { kind: "day2", at: Date.now() + 1 }), gid);
  await pageA.waitForTimeout(1500);
  const a2 = await pageA.evaluate(() => window.PriTestMidnight._debugRelicMemory());
  assert(a2.earned.length === 3, "同一 grantKey 不重複發放");

  // fix round 1回歸（2026-09-24 review）：processMyRelicMemoryGrants()原本對整個
  // character/<token>做transaction，跟同一節點底下consumables／冷卻等其他子路徑的一般
  // rtSet()同時發生時，Firebase SDK的set()會讓transaction()丟出「Error: set」失敗、grant被
  // 跳過（下一影格重試）。改成只對character/<token>/relicMemory這個專屬子節點transaction後，
  // 兩者不應該再互相碰撞——同一次evaluate裡，一邊寫入新的grant key、一邊對兩位玩家各自的
  // _artCooldownUntil（既有resetAbilityCooldowns()會用到的真實子路徑）連續rtSet幾次製造race，
  // 驗證grant仍然在幾秒內正確套用（earned剛好+1，不因為transaction失敗而卡住）。
  await pageA.evaluate((g) => {
    var GS = window.PriTestGameStorage;
    var tok = window.PriTestMidnight._debugState().myTokenId;
    GS.rtSet(g, "cloud", "meta/relicMemoryGrants/tiles1", { kind: "tiles", at: Date.now() });
    for (var i = 0; i < 5; i++) GS.rtSet(g, "cloud", "character/" + tok + "/_artCooldownUntil", Date.now() + i);
  }, gid);
  await pageB.evaluate((g) => {
    var GS = window.PriTestGameStorage;
    var tok = window.PriTestMidnight._debugState().myTokenId;
    for (var i = 0; i < 5; i++) GS.rtSet(g, "cloud", "character/" + tok + "/_artCooldownUntil", Date.now() + i);
  }, gid);
  for (const p of [pageA, pageB]) {
    await p.waitForFunction(() => window.PriTestMidnight._debugRelicMemory().earned.length === 4, { timeout: 8000 }).catch(() => {});
  }
  const raceA = await pageA.evaluate(() => window.PriTestMidnight._debugRelicMemory());
  const raceB = await pageB.evaluate(() => window.PriTestMidnight._debugRelicMemory());
  assert(
    raceA.earned.length === 4 && raceB.earned.length === 4,
    "跟其他子路徑rtSet同時race時，relicMemory transaction仍成功套用grant（fix round 1回歸）"
  );
}

// final review C1／I2／I3（2026-09-24）：重新開始一輪的回歸。
// 在已開局、已有 grants（day2／tiles1）的遊戲裡，墊出「3 個已踏破板塊＋day1 最終圈已擊敗」
// 讓 tiles1／day1 真的由判定邏輯發出，再以 dispatchEvent 觸發 #btn-midnight-restart-cycle（handleRestartCycle）。
// 修正前：fieldProgress／finalCircleDay1 不會被 restart 清掉，新一輪第一影格就重新發 tiles1／day1，
// 兩人 earned 會 >1（且非按下 restart 的 B 裝置因為本地節流旗標沒重置，行為還不一致）。
// 修正後：新 meta 帶 relicMemoryBaseline，兩人都只剩開局小×1。
async function restartSection(pageA, pageB) {
  console.log("=== 重新開始一輪（基準／各裝置本地旗標重置） ===");
  const errors = [];
  pageA.on("pageerror", (e) => errors.push("A:" + e.message));
  pageB.on("pageerror", (e) => errors.push("B:" + e.message));
  const gid = await pageA.evaluate(() => window.PriTestMidnight._debugState().gameId);
  await pageA.evaluate((g) => {
    const GS = window.PriTestGameStorage;
    const d = window.PriTestMidnight._debugState();
    const NON = { sorcerer: 1, merchant: 1, strong_enemy: 1, random_event: 1, blessing: 1 };
    const pts = d.map.points.filter((p) => !NON[p.type]).slice(0, 3);
    pts.forEach((p) => GS.rtSet(g, "cloud", "fieldProgress/" + p.id, { branchIndex: 0, floorIndex: 0, cleared: true }));
    GS.rtSet(g, "cloud", "fieldTrigger/finalCircleDay1", { status: "resolved", participants: {} });
    GS.rtSet(g, "cloud", "fieldEnemyHp/finalCircleDay1", 0);
  }, gid);
  for (const p of [pageA, pageB]) {
    await p.waitForFunction(() => {
      const r = window.PriTestMidnight._debugRelicMemory();
      return r.grants.day1 && r.seen.day1 && r.grants.tiles1 && r.seen.tiles1;
    }, { timeout: 10000 }).catch(() => {});
  }
  const pre = await pageB.evaluate(() => window.PriTestMidnight._debugRelicMemory());
  assert(!!pre.grants.day1 && pre.earned.length > 1, "restart 前：day1 已由判定邏輯發出、earned > 1（前置條件）");
  // 重新開始鍵平時只在 day3 顯示；dispatchEvent 不檢查可見性，直接觸發真正的 handler。
  await pageA.dispatchEvent("#btn-midnight-restart-cycle", "click");
  for (const p of [pageA, pageB]) {
    await p.waitForFunction(() => {
      const d = window.PriTestMidnight._debugState();
      return d.meta.relicMemoryBaseline && window.PriTestMidnight._debugRelicMemory().earned.length === 1;
    }, { timeout: 10000 }).catch(() => {});
  }
  await pageA.waitForTimeout(2500); // 讓幾個影格跑過，確認不會又被重發
  for (const [label, p] of [["A", pageA], ["B", pageB]]) {
    const r = await p.evaluate(() => {
      const d = window.PriTestMidnight._debugState();
      return { rm: window.PriTestMidnight._debugRelicMemory(), baseline: d.meta.relicMemoryBaseline || null };
    });
    assert(Object.keys(r.rm.grants).length === 0, label + "：restart 後 meta.relicMemoryGrants 為空（未被重發）");
    assert(r.rm.earned.length === 1 && r.rm.earned[0].source === "start", label + "：restart 後 earned 只剩開局小×1");
    assert(!!r.baseline && r.baseline.tiles >= 3 && r.baseline.day1 === true, label + "：meta.relicMemoryBaseline 記錄了 tiles/day1 基準");
  }
  assert(errors.length === 0, "restart 過程無 pageerror" + (errors.length ? "：" + errors.join(" | ") : ""));
}

// Task 5：等待房選擇帶入＋角色視窗「遺物記憶」列。
// 固定寫入3個合法格式的記憶（m+16位小寫hex），在等待房開局前選其中1個帶入，驗證：
// 1) 等待房讀取／勾選會即時反映到players/<slot>/relicMemoryLoadout；
// 2) fix round 1回歸（2026-09-24 review）：快速連續切換兩個不同記憶（同一次evaluate內
//    背靠背click，中間不await任何RTDB round-trip）不會遺失其中一個——
//    toggleLobbyRelicMemory()原本從本地快取的players[mySlot]算出新陣列再rtSet()整值覆寫，
//    這種情境下第二次切換送出時可能還沒收到第一次的RTDB回音，會用舊陣列蓋掉剛送出的
//    第一次選擇（lost update）。改用GameStorage.rtTransaction()後，兩次切換都會各自從
//    Firebase當下真正的cur算增減，兩個都應該保留下來；
// 3) 開局後newCharacterForSlot()把選定的記憶複製到角色上，效果透過
//    CharacterDrawer.activeAttachedEffectIds()生效（這裡用戰技傷害+5驗證）；
// 4) 角色視窗消耗品之後的「遺物記憶」列可以點選、右側detail正確顯示效果說明。
//
// 等待房（尚未開局）的按鈕/checkbox改用page.click()、不用dispatchEvent()——理由跟
// joinLobby()註解一致：背景分頁在renderLobby()整段重建#midnight-lobby-slots附近呼叫
// dispatchEvent()，有時會在事件真正送達前元素已被替換掉。快速連續切換的兩下例外：
// 那裡刻意用page.evaluate()內的原生element.click()（見下方說明），因為要讓兩次點擊在
// 同一個JS tick內背靠背送出、之間不能有任何await/round-trip，才能重現race。
async function loadoutSection(browser) {
  console.log("=== 等待房帶入 ＋ 角色視窗 ===");
  await adminPut("relicMemories/" + TEST_CODE, {
    m000000000000000a: { memId: "m000000000000000a", size: "m", effects: ["max_hp_up", "arts_dmg"], createdAt: 1, favorite: false, source: "tiles" },
    m000000000000000b: { memId: "m000000000000000b", size: "s", effects: ["attack_dmg"], createdAt: 2, favorite: false, source: "start" },
    m000000000000000c: { memId: "m000000000000000c", size: "s", effects: ["sorcery_dmg"], createdAt: 3, favorite: false, source: "start" },
  });
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  await enableEmulatorFlag(pageA);
  await enableEmulatorFlag(pageB);
  await createAndStart(pageA, pageB, async () => {
    await pageA.fill("#midnight-lobby-relic-memory-code-input", TEST_CODE.toLowerCase());
    await pageA.click("#btn-midnight-lobby-relic-memory-load");
    await pageA.waitForSelector("#midnight-lobby-relic-memory-list input[type=checkbox]", { timeout: 8000 });
    const boxes = await pageA.$$("#midnight-lobby-relic-memory-list input[type=checkbox]");
    assert(boxes.length === 3, "讀取後列出 3 個記憶");
    await pageA.click('#midnight-lobby-relic-memory-list input[data-mem-id="m000000000000000a"]');
    await pageA.waitForFunction(() => {
      const d = window.PriTestMidnight._debugState();
      const p = d.players[d.mySlot];
      return p && p.relicMemoryLoadout && p.relicMemoryLoadout.length === 1;
    }, { timeout: 5000 });

    // fix round 1回歸：background頁不涉入這段（只有pageA在操作），在同一次page.evaluate()
    // 裡對b／c兩個checkbox背靠背呼叫原生.click()（不是await分開送出的page.click()），
    // 模擬「兩次切換幾乎同時發生、第二次送出時還沒收到第一次RTDB回音」的情境。
    await pageA.evaluate(() => {
      document.querySelector('#midnight-lobby-relic-memory-list input[data-mem-id="m000000000000000b"]').click();
      document.querySelector('#midnight-lobby-relic-memory-list input[data-mem-id="m000000000000000c"]').click();
    });
    await pageA.waitForFunction(() => {
      const d = window.PriTestMidnight._debugState();
      const p = d.players[d.mySlot];
      return p && p.relicMemoryLoadout && p.relicMemoryLoadout.length === 3;
    }, { timeout: 5000 });
    const afterDouble = await pageA.evaluate(() => {
      const d = window.PriTestMidnight._debugState();
      return d.players[d.mySlot].relicMemoryLoadout.map((m) => m.memId);
    });
    assert(
      afterDouble.indexOf("m000000000000000a") !== -1 &&
        afterDouble.indexOf("m000000000000000b") !== -1 &&
        afterDouble.indexOf("m000000000000000c") !== -1,
      "快速連續切換兩個不同記憶都成功寫入、沒有lost update（fix round 1回歸：toggleLobbyRelicMemory改用rtTransaction）"
    );

    // 還原成只選a，讓後面「開局後角色帶入選定記憶」等既有斷言維持原本預期——同樣用背靠背
    // click()製造race，驗證反向（取消勾選）一樣不會漏掉其中一個。
    await pageA.evaluate(() => {
      document.querySelector('#midnight-lobby-relic-memory-list input[data-mem-id="m000000000000000b"]').click();
      document.querySelector('#midnight-lobby-relic-memory-list input[data-mem-id="m000000000000000c"]').click();
    });
    await pageA.waitForFunction(() => {
      const d = window.PriTestMidnight._debugState();
      const p = d.players[d.mySlot];
      return p && p.relicMemoryLoadout && p.relicMemoryLoadout.length === 1 && p.relicMemoryLoadout[0].memId === "m000000000000000a";
    }, { timeout: 5000 });
  });
  const r = await pageA.evaluate(() => {
    const d = window.PriTestMidnight._debugState();
    const c = d.characters[d.myTokenId];
    return {
      loadout: window.PriTestMidnight._debugRelicMemory().loadout,
      hpBonus: window.PriTestCharacterDrawer.attachedFlatMaxStatBonus
        ? window.PriTestCharacterDrawer.attachedFlatMaxStatBonus(c, "hp")
        : window.PriTestCharacterDrawer.totalFlatMaxStatBonus(c, "hp"),
      art: window.PriTestCharacterDrawer.attachedSkillDamageBonus(c, "art"),
    };
  });
  assert(r.loadout.length === 1 && r.loadout[0].memId === "m000000000000000a", "開局後角色帶入選定記憶");
  assert(r.art === 5, "帶入效果生效（戰技+5）");
  await pageA.dispatchEvent("#btn-midnight-open-character-sheet", "click");
  await pageA.waitForSelector("#midnight-character-sheet-relic-memories button", { timeout: 5000 });
  await pageA.dispatchEvent("#midnight-character-sheet-relic-memories button", "click");
  const detail = await pageA.textContent("#midnight-character-sheet-detail");
  assert(detail.indexOf("HP") !== -1 || detail.length > 10, "角色視窗點選記憶 → 右側顯示效果");
  await pageA.close();
  await pageB.close();
}

// Task 6：放棄遊戲全員投票＋遺物記憶結算保存。
async function abandonSection(browser) {
  console.log("=== 放棄投票 ＋ 結算保存 ===");
  await adminPut("relicMemories/" + TEST_CODE, null);
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  await enableEmulatorFlag(pageA);
  await enableEmulatorFlag(pageB);
  await createAndStart(pageA, pageB);

  // fix round 1（2026-09-24 review）：z-index回歸——原本三個新彈窗z-index是2000，落在
  // #midnight-game-failure-modal（不透明背景、z-index 2100）底下，導致從失敗彈窗按「放棄
  // 遊戲」時，本地確認彈窗被失敗彈窗蓋住點不到。
  // 注意：不能直接手動改DOM的.hidden——#midnight-game-failure-modal的顯示由
  // updateGameFailureModal()每影格依meta.gameFailurePending覆寫（見static/midnight.js），
  // 手動設的.hidden=false會在下一影格被真正的狀態蓋回去，測不到z-index問題（實測過會
  // 誤判PASS）。改成透過GameStorage.rtSet()寫真正的meta.gameFailurePending＝true，
  // 讓失敗彈窗用它原本的正常途徑顯示，再從它按放棄提議，用
  // document.elementFromPoint()在確認彈窗「提議放棄」按鈕中心點檢查最上層元素確實是它
  // （或被它包含），驗證疊放順序正確；驗證完用「取消」關掉確認彈窗，並把
  // meta.gameFailurePending寫回false，避免影響後面的測試。用pageB操作，不干擾pageA
  // 後續的投票/結算流程。
  const gid = await pageB.evaluate(() => window.PriTestMidnight._debugState().gameId);
  await pageB.evaluate((g) => window.PriTestGameStorage.rtSet(g, "cloud", "meta/gameFailurePending", true), gid);
  await pageB.waitForSelector("#midnight-game-failure-modal:not([hidden])", { timeout: 8000 });
  await pageB.dispatchEvent("#btn-midnight-game-failure-abandon", "click");
  await pageB.waitForSelector("#midnight-abandon-confirm-modal:not([hidden])", { timeout: 8000 });
  const onTop = await pageB.evaluate(() => {
    const btn = document.getElementById("btn-midnight-abandon-confirm-yes");
    const rect = btn.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !!top && (top === btn || btn.contains(top));
  });
  assert(onTop, "失敗彈窗開著時從其放棄按鈕提議，確認彈窗仍蓋在最上層可點擊（z-index回歸）");
  await pageB.dispatchEvent("#btn-midnight-abandon-confirm-no", "click");
  await pageB.evaluate((g) => window.PriTestGameStorage.rtSet(g, "cloud", "meta/gameFailurePending", false), gid);
  await pageB.waitForFunction(() => document.getElementById("midnight-game-failure-modal").hidden === true, { timeout: 8000 });

  // final review I4：投票逾時（60 秒）→ 任一裝置清除 abandonVote、遊戲繼續。
  const slotA = await pageA.evaluate(() => window.PriTestMidnight._debugState().mySlot);
  await pageA.evaluate((args) => window.PriTestGameStorage.rtSet(args.g, "cloud", "meta/abandonVote", {
    proposedBy: args.slot, at: Date.now() - 61000, votes: { [args.slot]: true },
  }), { g: gid, slot: slotA });
  await pageA.waitForFunction(() => !!window.PriTestMidnight._debugState().meta.abandonVote, { timeout: 8000 }).catch(() => {});
  await pageA.waitForFunction(() => !window.PriTestMidnight._debugState().meta.abandonVote, { timeout: 8000 }).catch(() => {});
  const afterTimeout = await pageA.evaluate(() => window.PriTestMidnight._debugState().meta);
  assert(!afterTimeout.abandonVote && !afterTimeout.gameAbandonedAt, "投票超過 60 秒 → abandonVote 被清除、gameAbandonedAt 未設定（I4 逾時）");

  // final review M6：沒有進行中的投票時按同意 → 不可寫出沒有 proposedBy/at 的孤兒投票。
  await pageB.dispatchEvent("#btn-midnight-abandon-vote-yes", "click");
  await pageB.waitForTimeout(1500);
  assert(!(await pageA.evaluate(() => window.PriTestMidnight._debugState().meta.abandonVote)), "無進行中投票時投同意 → meta.abandonVote 維持 null（M6 孤兒投票）");

  // 反對 → 取消
  await pageA.dispatchEvent("#btn-midnight-hud-abandon", "click");
  await pageA.dispatchEvent("#btn-midnight-abandon-confirm-yes", "click");
  await pageB.waitForSelector("#midnight-abandon-vote-modal:not([hidden])", { timeout: 8000 });
  // final review I4：已投票者（提案者A）不被全螢幕遮罩擋住；尚未投票的B仍是阻擋式彈窗。
  await pageA.waitForSelector("#midnight-abandon-vote-modal:not([hidden])", { timeout: 8000 });
  const centerHit = async (p) => p.evaluate(() => {
    const modal = document.getElementById("midnight-abandon-vote-modal");
    const top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return !!top && (top === modal || modal.contains(top));
  });
  assert(!(await centerHit(pageA)), "已投票者（A）畫面中央不被投票彈窗遮罩擋住（I4 非阻擋）");
  assert(await centerHit(pageB), "尚未投票者（B）仍是阻擋式投票彈窗");
  assert(await pageA.evaluate(() => !document.getElementById("btn-midnight-abandon-vote-withdraw").hidden), "提案者看得到「撤回提議」按鈕");
  assert(await pageB.evaluate(() => document.getElementById("btn-midnight-abandon-vote-withdraw").hidden), "非提案者看不到「撤回提議」按鈕");
  assert(/\d/.test(await pageA.textContent("#midnight-abandon-vote-progress")) && (await pageA.textContent("#midnight-abandon-vote-progress")).indexOf("{sec}") === -1, "進度列顯示剩餘秒數");
  await pageB.dispatchEvent("#btn-midnight-abandon-vote-no", "click");
  await pageA.waitForFunction(() => !window.PriTestMidnight._debugState().meta.abandonVote, { timeout: 8000 });
  assert(!(await pageA.evaluate(() => window.PriTestMidnight._debugState().meta.gameAbandonedAt)), "有人反對 → 投票取消、遊戲繼續");

  // final review I4：提案者撤回
  await pageA.dispatchEvent("#btn-midnight-hud-abandon", "click");
  await pageA.dispatchEvent("#btn-midnight-abandon-confirm-yes", "click");
  await pageA.waitForFunction(() => !!window.PriTestMidnight._debugState().meta.abandonVote, { timeout: 8000 });
  await pageA.dispatchEvent("#btn-midnight-abandon-vote-withdraw", "click");
  await pageA.waitForFunction(() => !window.PriTestMidnight._debugState().meta.abandonVote, { timeout: 8000 }).catch(() => {});
  assert(!(await pageA.evaluate(() => window.PriTestMidnight._debugState().meta.abandonVote)), "提案者撤回 → abandonVote 清除");
  await pageB.waitForFunction(() => document.getElementById("midnight-abandon-vote-modal").hidden, { timeout: 8000 }).catch(() => {});

  // 全員同意 → 結算
  await pageA.dispatchEvent("#btn-midnight-hud-abandon", "click");
  await pageA.dispatchEvent("#btn-midnight-abandon-confirm-yes", "click");
  await pageB.waitForSelector("#midnight-abandon-vote-modal:not([hidden])", { timeout: 8000 });
  await pageB.dispatchEvent("#btn-midnight-abandon-vote-yes", "click");
  for (const p of [pageA, pageB]) {
    await p.waitForSelector("#midnight-relic-memory-settle-modal:not([hidden])", { timeout: 8000 });
  }
  const rows = await pageA.$$("#midnight-relic-memory-settle-list li");
  assert(rows.length >= 1, "結算視窗列出本局獲得（至少開局小×1）");

  await pageA.fill("#midnight-relic-memory-settle-code-input", TEST_CODE);
  await pageA.dispatchEvent("#btn-midnight-relic-memory-settle-save", "click");
  await pageA.waitForFunction(() => document.getElementById("btn-midnight-relic-memory-settle-save").disabled, { timeout: 8000 });
  assert(
    (await pageA.textContent("#btn-midnight-relic-memory-settle-save")) === (await pageA.evaluate(() => window.I18N.t("midnight_relic_memory_saved_button"))),
    "保存成功後按鈕文字改為「已保存」（M9）"
  );
  const stored = await pageA.evaluate((code) => window.PriTestGameStorage.relicMemoryRead(code), TEST_CODE);
  assert(stored.ok && Object.keys(stored.value || {}).length === rows.length, "保存後 Firebase 件數＝本局獲得件數");

  await pageB.fill("#midnight-relic-memory-settle-code-input", "ZZZZZ");
  await pageB.dispatchEvent("#btn-midnight-relic-memory-settle-save", "click");
  await pageB.waitForFunction(() => document.getElementById("midnight-relic-memory-settle-status").textContent.length > 0, { timeout: 8000 });
  assert(!(await pageB.evaluate(() => document.getElementById("btn-midnight-relic-memory-settle-save").disabled)), "無效密碼 → 顯示錯誤、可再試");
  await pageA.close();
  await pageB.close();
}

(async () => {
  await pushRules();
  const browser = await chromium.launch();
  const pageA = await browser.newPage();
  try {
    await enableEmulatorFlag(pageA);
    await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await storageSection(pageA);
    const pageB = await browser.newPage();
    await enableEmulatorFlag(pageB);
    await createAndStart(pageA, pageB);
    await grantSection(pageA, pageB);
    await restartSection(pageA, pageB);
    await loadoutSection(browser);
    await abandonSection(browser);
  } catch (e) {
    console.error(e);
    fails++;
  } finally {
    await browser.close();
  }
  console.log(fails ? fails + " FAIL" : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
