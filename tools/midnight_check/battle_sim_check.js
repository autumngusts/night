// ============================================================================
// midnight 2026-09-22 回歸測試：等待房「產生戰鬥模擬」（Playwright ＋ Firebase Local Emulator）
// ============================================================================
// 使用前準備（跟 emulator_sync_check.js 完全相同，見該檔開頭）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node battle_sim_check.js
//
// 涵蓋項目（使用者明確規格「在創立房間新增一個產生戰鬥模擬 需要輸入nightnight密碼
// 如此可以測試戰鬥點陣圖的動畫效果 閃避方式」）：
//   ① 密碼錯誤／取消 → meta.battleSim 不寫入
//   ② 密碼 nightnight → meta.battleSim 寫入 {enemyFamilyId, enemyId, level}，且抽中的敵人
//      每一招都能算出傷害（個別／亂戰），按鈕文字切換成「取消」
//   ③ 兩台裝置都看到同一個 meta.battleSim（房間設定共用）
//   ④ 開局後不用走到任何地圖點：fieldTrigger/battleSim 自動建立（participants＝全部席位、
//      HP 由 enemyRealHpMax() 算出）、5 秒識別資訊準備後兩台都進入 activeEncounter
//   ⑤ 敵人攻擊排程照既有 pipeline 跑起來（nextAttackAt → enemyAttack）
//   ⑥ 逃離後不會卡死：候選重新出現時走既有的［進入戰鬥］讀條流程重新加入
//   ⑦ 再按一次按鈕（取消）→ meta.battleSim 清空（取消不需要密碼）
//   ⑧（2026-09-22 第2批）抽中的敵人必須有已產出的 sprite sheet（registry available:true）
//   ⑨（同上）開局不播靈鳥進場動畫、地圖維持收合
//   ⑩（同上）勾選點陣圖戰鬥模式後，戰鬥中 sprite 舞台真的顯示、idle 循環在動、敵人出招時
//      切到對應攻擊動畫、被打時 hurt、HP 歸零時右上角小視窗播 death（hold 在最後一幀後自動隱藏）；sheet 已預載
//   ⑪（2026-09-22 第3批，使用者明確規格「可以指定打哪一隻以及甚麼敵人種類」）等待房兩個下拉：
//      種類＝隨機／各系統／夜王，個體依種類重建、有專屬 sheet 的加註；指定夜王後 meta.battleSim
//      帶 bossForm:"fused"／Lv.16／animCycle，兩台的下拉都回填並鎖定
//   ⑫（同上「有個選項可以讓敵人連續播放不同動作的動畫」）開局後 trigger 帶 bossForm、HP＝bossHpMax、
//      舞台用 boss sheet、8 個動作依序循環且面板標籤跟著變；關掉勾選後循環停止、標籤隱藏
//   ⑬（2026-09-22 第4批「房間一開始不顯示戰鬥模擬至連續播放，需按下測試模式成功後才在本地顯示」）
//      三列一開始隱藏；A 輸入密碼開測試模式後顯示；B 同步到 meta.testMode=true 仍隱藏；關掉再開要重輸密碼
//   ⑭（2026-09-22 第5批「在每次T的時間點時 畫面上開始計時 記錄我每次按下迴避後確切的花費時間」）
//      戰鬥模擬中面板顯示迴避計時；自己被鎖定時建碼表、T 後正數跑動；按下（pointerdown→click）即停並
//      記一筆「放開／按下／判定」；沒按則在換下一下時補記逾時
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const META_WAIT_MS = 20000;
const PASSWORD = "nightnight";

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

const waitFor = (page, fn, arg, timeout) => page.waitForFunction(fn, arg, { timeout: timeout || META_WAIT_MS });
const state = (page) => page.evaluate(() => window.PriTestMidnight._debugState());

// 一般攻擊鍵綁的是 mousedown/mouseup（長按會開特殊攻擊選單），CLAUDE.md §4.6：用 dispatchEvent。
async function tapAttack(page) {
  await page.dispatchEvent("#btn-midnight-attack-shared-target", "mousedown");
  await page.waitForTimeout(60);
  await page.dispatchEvent("#btn-midnight-attack-shared-target", "mouseup");
}

// 按下按鈕會跳 window.prompt：一次性掛 dialog handler 回答指定內容（null＝取消）。
async function clickBattleSim(page, answer) {
  page.once("dialog", async (dialog) => {
    if (answer === null) await dialog.dismiss();
    else await dialog.accept(answer);
  });
  await page.click("#btn-midnight-lobby-battle-sim");
}

// 2026-09-22 第4批（使用者明確規格「房間一開始不顯示戰鬥模擬至連續播放，需按下測試模式成功後
// 才在本地顯示」）：戰鬥模擬三列包在 #midnight-lobby-test-tools，要這台裝置自己輸入測試模式
// 密碼成功才顯示。用真的勾選框＋prompt 走一遍（rtSet meta/testMode 只會同步 meta、不會設本機旗標）。
async function unlockTestMode(page) {
  page.once("dialog", async (dialog) => {
    await dialog.accept(PASSWORD);
  });
  await page.check("#midnight-lobby-test-mode-checkbox");
  await waitFor(page, () => !document.querySelector("#midnight-lobby-test-tools").hidden);
}

(async () => {
  const browser = await chromium.launch();
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  [pageA, pageB].forEach((p, i) => p.on("pageerror", (e) => console.log("  [pageerror " + "AB"[i] + "] " + e.message)));

  try {
    await enableEmulatorFlag(pageA);
    await enableEmulatorFlag(pageB);
    console.log("=== 建立 midnight 測試場（連本機 emulator） ===");
    await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await pageA.click("#btn-midnight-create");
    await waitFor(pageA, () => window.PriTestMidnight && window.PriTestMidnight._debugState().meta);
    const gameUrl = pageA.url();
    await pageB.goto(gameUrl, { waitUntil: "networkidle" });
    await waitFor(pageB, () => window.PriTestMidnight && window.PriTestMidnight._debugState().meta);
    await joinLobby(pageA, "1234");
    await joinLobby(pageB, "5678");
    // 點陣圖戰鬥模式（動畫顯示的前提，使用者明確規格「需要在等待房勾選才生效」）
    await pageA.check("#midnight-lobby-sprite-mode-checkbox");
    await waitFor(pageA, () => window.PriTestMidnight._debugState().meta.spriteMode === true);
    await waitFor(pageB, () => window.PriTestMidnight._debugState().meta.spriteMode === true);

    console.log("=== ⑬ 戰鬥模擬三列只在本機輸入測試模式密碼後顯示 ===");
    const toolsInit = await pageA.$eval("#midnight-lobby-test-tools", (e) => e.hidden);
    assert(toolsInit === true, "房間一開始 #midnight-lobby-test-tools 隱藏", toolsInit);
    await unlockTestMode(pageA);
    assert(true, "裝置A輸入密碼開啟測試模式後三列顯示");
    await waitFor(pageB, () => window.PriTestMidnight._debugState().meta.testMode === true);
    await pageB.waitForTimeout(300);
    const toolsB = await pageB.evaluate(() => ({ hidden: document.querySelector("#midnight-lobby-test-tools").hidden, unlocked: window.PriTestMidnight._debugState().testModeUnlockedLocally, testMode: window.PriTestMidnight._debugState().meta.testMode }));
    assert(toolsB.hidden && !toolsB.unlocked && toolsB.testMode, "裝置B同步到 meta.testMode=true 但沒輸入過密碼 → 三列仍隱藏（本機才看得到）", toolsB);
    // 關掉測試模式 → A 的三列也收起；再開一次（要再輸入密碼）→ 重新顯示
    await pageA.uncheck("#midnight-lobby-test-mode-checkbox");
    await waitFor(pageA, () => document.querySelector("#midnight-lobby-test-tools").hidden);
    assert(true, "關掉測試模式後三列收起");
    await unlockTestMode(pageA);
    assert(true, "重新開啟測試模式（再輸入密碼）後三列重新顯示");
    // ⑭ 要等自己被鎖定好幾次攻擊：把敵人攻擊倍率歸零，避免中途被打到瀕死（瀕死中不會被鎖定、也按不了迴避）。
    await pageA.evaluate((gameId) => window.PriTestGameStorage.rtSet(gameId, "cloud", "meta/testTuning/enemyAtkMult", 0), (await state(pageA)).gameId);
    await waitFor(pageA, () => (window.PriTestMidnight._debugState().meta.testTuning || {}).enemyAtkMult === 0);

    console.log("=== ① 密碼錯誤／取消都不會寫入 meta.battleSim ===");
    const hintBefore = await pageA.textContent("#midnight-lobby-battle-sim-status");
    const btnBefore = await pageA.textContent("#btn-midnight-lobby-battle-sim");
    assert(btnBefore === "產生戰鬥模擬", "初始按鈕文字為「產生戰鬥模擬」", btnBefore);
    assert(!!hintBefore && hintBefore.indexOf("密碼") !== -1, "初始狀態列顯示需輸入密碼的說明", hintBefore);
    await clickBattleSim(pageA, "wrong");
    await pageA.waitForTimeout(600);
    assert(!(await state(pageA)).meta.battleSim, "密碼錯誤 → meta.battleSim 未寫入");
    await clickBattleSim(pageA, null);
    await pageA.waitForTimeout(600);
    assert(!(await state(pageA)).meta.battleSim, "取消 prompt → meta.battleSim 未寫入");

    console.log("=== ② 密碼 nightnight → 寫入 meta.battleSim ===");
    await clickBattleSim(pageA, PASSWORD);
    await waitFor(pageA, () => !!(window.PriTestMidnight._debugState().meta.battleSim || {}).enemyFamilyId);
    const sim = (await state(pageA)).meta.battleSim;
    console.log("  抽中的敵人:", JSON.stringify(sim));
    assert(!!sim.enemyFamilyId && !!sim.enemyId && sim.level === 1, "meta.battleSim 含 enemyFamilyId／enemyId／level=1", sim);
    const enemyOk = await pageA.evaluate((s) => {
      const INDIVIDUAL = /個別(?:ダメージ|傷害)[:：]\+?(\d+)/; // midnight.js 同一條判定
      const GROUP = /乱戦|亂戰/;
      const data = window.PriTestEnemies.get(s.enemyFamilyId, s.enemyId);
      if (!data) return { exists: false };
      const actions = data.enemy.actions || [];
      const allParse = actions.length > 0 && actions.every((a) => {
        const ja = (a.note && a.note.ja) || "";
        const zh = (a.note && a.note.zh) || "";
        return INDIVIDUAL.test(ja) || INDIVIDUAL.test(zh) || GROUP.test(ja) || GROUP.test(zh);
      });
      return { exists: true, allParse, name: window.PriTestEnemies.localizedText(data.enemy.name) };
    }, sim);
    assert(enemyOk.exists, "抽中的敵人存在於 enemies_data", enemyOk);
    assert(enemyOk.allParse, "抽中的敵人每一招都能算出傷害（迴避才看得出差別）", enemyOk);
    console.log("=== ⑧ 抽中的敵人必須有已產出的 sprite sheet ===");
    const sheetInfo = await pageA.evaluate((s) => {
      const R = window.PriTestEnemySpriteRegistry;
      const id = R.sheetIdForEnemy(s.enemyFamilyId, s.enemyId);
      const sheet = id ? R.getSheet(id) : null;
      return { id, available: !!(sheet && sheet.available), file: sheet && sheet.file, sheetFileFor: window.PriTestMidnightSprite.sheetFileFor(s.enemyFamilyId, s.enemyId, false) };
    }, sim);
    assert(!!sheetInfo.id && sheetInfo.available, "登錄表有對應 sheet 且 available:true", sheetInfo);
    assert(sheetInfo.sheetFileFor === sheetInfo.file, "sheetFileFor() 會回傳該 sheet 檔名（＝戰鬥中會疊 sprite）", sheetInfo);
    const sheetHttp = await pageA.evaluate((f) => fetch("../static/images/sprites/" + f).then((r) => r.status), sheetInfo.file);
    assert(sheetHttp === 200, "sheet 圖檔已隨 generate.py 複製到 dist（HTTP 200）", sheetHttp);
    await waitFor(pageA, () => document.querySelector("#btn-midnight-lobby-battle-sim").textContent === "取消戰鬥模擬");
    const statusAfter = await pageA.textContent("#midnight-lobby-battle-sim-status");
    assert(statusAfter.indexOf(enemyOk.name) !== -1 && statusAfter.indexOf("Lv.1") !== -1, "狀態列顯示敵人名稱與等級", statusAfter);

    console.log("=== ③ 兩台裝置共用同一個 meta.battleSim ===");
    await waitFor(pageB, (id) => (window.PriTestMidnight._debugState().meta.battleSim || {}).enemyId === id, sim.enemyId);
    assert(true, "裝置B收到同一隻敵人的 meta.battleSim");
    const btnB = await pageB.textContent("#btn-midnight-lobby-battle-sim");
    assert(btnB === "取消戰鬥模擬", "裝置B的按鈕也切換成「取消戰鬥模擬」", btnB);

    console.log("=== ④ 開局後自動建立 fieldTrigger/battleSim 並進入戰鬥 ===");
    await pageA.click("#btn-midnight-lobby-ready");
    await pageB.click("#btn-midnight-lobby-ready");
    await waitFor(pageA, () => window.PriTestMidnight._debugState().meta.sessionStartAt);
    await waitFor(pageB, () => window.PriTestMidnight._debugState().meta.sessionStartAt);
    console.log("=== ⑨ 不播靈鳥進場動畫、地圖不展開 ===");
    await pageA.waitForTimeout(700); // 讓幾個影格跑過去（一般房間此時 intro overlay 已顯示、地圖已展開）
    const openState = await pageA.evaluate(() => ({
      introHidden: document.querySelector("#midnight-intro-overlay").hidden,
      mapPanelHidden: document.querySelector("#midnight-map-panel").hidden,
      mapExpanded: window.PriTestMidnight._debugState().mapExpanded,
      canvasOpacity: document.querySelector("#midnight-canvas").style.opacity,
      sinceStart: Date.now() - window.PriTestMidnight._debugState().meta.sessionStartAt,
    }));
    assert(openState.introHidden && openState.sinceStart < 10000, "開局 10 秒內 intro overlay 仍是隱藏（沒有靈鳥飛行說明）", openState);
    assert(!openState.mapExpanded && openState.mapPanelHidden, "地圖沒有展開（mapExpanded=false、地圖面板隱藏）", openState);
    assert(openState.canvasOpacity === "", "canvas 沒有套進場淡入", openState);
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      return !!(s.fieldTriggers.battleSim && typeof s.fieldEnemyHp.battleSim === "number");
    });
    const sA = await state(pageA);
    const trig = sA.fieldTriggers.battleSim;
    assert(trig.status === "resolved" && trig.enemyFamilyId === sim.enemyFamilyId && trig.enemyId === sim.enemyId, "trigger 內容與 meta.battleSim 一致", trig);
    assert(!!(trig.participants && trig.participants["1"] && trig.participants["2"]), "participants 一開始就是全部席位", trig.participants);
    const expectedHp = await pageA.evaluate((t) => window.PriTestMidnight._debugEnemyRealHpMax(t), trig);
    assert(sA.fieldEnemyHp.battleSim === expectedHp && expectedHp > 0, "HP 由 enemyRealHpMax() 算出（" + expectedHp + "）", sA.fieldEnemyHp.battleSim);
    // 5 秒識別資訊準備（BATTLE_PREP_DURATION_MS）之後才會成為 activeEncounter，逾時要 > 5 秒。
    await waitFor(pageA, () => (window.PriTestMidnight._debugState().activeEncounter || {}).id === "battleSim", null, 15000);
    await waitFor(pageB, () => (window.PriTestMidnight._debugState().activeEncounter || {}).id === "battleSim", null, 15000);
    assert(true, "兩台裝置都在不移動的情況下進入 activeEncounter=battleSim");
    const panelShown = await pageA.evaluate(() => !document.querySelector("#midnight-field-encounter").hidden);
    const shownName = await pageA.textContent("#midnight-field-encounter-name");
    assert(panelShown && shownName === enemyOk.name, "遭遇面板顯示抽中的敵人名稱", shownName);

    console.log("=== ⑩ sprite 舞台顯示且動畫真的在跑 ===");
    const stage0 = await pageA.evaluate(() => {
      const st = document.querySelector("#midnight-enemy-sprite-stage");
      if (!st) return null;
      // 2026-09-22（910f842 之後）：sheet 背景改貼在舞台內的 .midnight-sprite-face（橫長單格對應），舞台本身沒有 background
      const face = st.querySelector(".midnight-sprite-face");
      return { hidden: st.hidden, bg: face ? face.style.backgroundImage : "", w: st.offsetWidth, h: st.offsetHeight, anim: window.PriTestMidnightSprite.currentAnimId() };
    });
    assert(!!stage0 && !stage0.hidden, "#midnight-enemy-sprite-stage 已 mount 且顯示", stage0);
    assert(!!stage0 && stage0.bg.indexOf(sheetInfo.file) !== -1, "舞台 background-image 指向該 sheet", stage0);
    assert(!!stage0 && stage0.w > 0 && stage0.h === stage0.w, "舞台有實際尺寸且為正方形（cellPx 推算成立）", stage0);
    assert(!!stage0 && stage0.anim === "idle", "初始播放 idle", stage0);
    const imgOk = await pageA.evaluate((f) => new Promise((res) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = "../static/images/sprites/" + f; }), sheetInfo.file);
    // 910f842 之後 sheet 的單格可以不是正方形（橫長單格），只驗「能切成 6 欄 × 8 列」，不再要求 w/6 == h/8。
    assert(!!imgOk && imgOk.w % 6 === 0 && imgOk.h % 8 === 0, "sheet 圖片可被瀏覽器解碼且能切成 6×8 格", imgOk);
    // idle 6 幀 × 200ms：1.5 秒內 background-position 至少要換過 3 種值
    const idlePositions = await pageA.evaluate(() => new Promise((res) => {
      const seen = {};
      const face = document.querySelector("#midnight-enemy-sprite-stage .midnight-sprite-face");
      const t = setInterval(() => { seen[face.style.backgroundPosition] = true; }, 30);
      setTimeout(() => { clearInterval(t); res(Object.keys(seen)); }, 1500);
    }));
    assert(idlePositions.length >= 3, "idle 循環中 background-position 持續變化（" + idlePositions.length + " 種）", idlePositions);
    // 敵人出招 → 攻擊動畫。攻擊間隔 2~4 秒、動畫約 1 秒，連續採樣 12 秒收集出現過的 animId。
    const animsSeen = await pageA.evaluate(() => new Promise((res) => {
      const seen = {};
      const t = setInterval(() => { seen[window.PriTestMidnightSprite.currentAnimId()] = true; }, 25);
      setTimeout(() => { clearInterval(t); res(Object.keys(seen)); }, 12000);
    }));
    const ATTACK_ANIMS = ["line", "area", "thrust", "slam", "single"];
    assert(animsSeen.some((a) => ATTACK_ANIMS.indexOf(a) !== -1), "敵人出招期間播放了攻擊動畫（" + animsSeen.join("/") + "）", animsSeen);
    const atkAnim = (await state(pageA)).fieldTriggers.battleSim.enemyAttack;
    if (atkAnim) {
      const expectedAnim = await pageA.evaluate((a) => window.PriTestEnemyActionAnimMap.resolve(a.actionName, a.dmgKind), atkAnim);
      assert(animsSeen.indexOf(expectedAnim) !== -1, "最近一招對照表解出的動畫（" + expectedAnim + "）確實播過", animsSeen);
    }
    // 玩家攻擊 → hurt（只在 idle 時插入）。先等 idle 再打。
    await waitFor(pageA, () => window.PriTestMidnightSprite.currentAnimId() === "idle", null, 8000);
    const hpBeforeHit = (await state(pageA)).fieldEnemyHp.battleSim;
    await tapAttack(pageA); // 一般攻擊是 mousedown→mouseup（bindAttackHoldInput()），不是 click
    const hurtSeen = await pageA.evaluate(() => new Promise((res) => {
      const seen = {};
      const t = setInterval(() => { seen[window.PriTestMidnightSprite.currentAnimId()] = true; }, 15);
      setTimeout(() => { clearInterval(t); res(Object.keys(seen)); }, 1500);
    }));
    await waitFor(pageA, (hp) => window.PriTestMidnight._debugState().fieldEnemyHp.battleSim < hp, hpBeforeHit, 5000);
    assert(hurtSeen.indexOf("hurt") !== -1, "玩家命中後播放 hurt（" + hurtSeen.join("/") + "）", hurtSeen);
    // HP 墊到 1 再打一擊 → 右上角死亡小視窗（2026-09-22 使用者明確規格「在右上角縮小比較小的
    // 視窗播放死亡動畫」）：主舞台隨戰鬥面板一起收掉，death 改在 #midnight-enemy-death-popup
    // 播放（掛在 #midnight-hud-top-right 最後一格），播完＋停留後自動隱藏。兩台裝置都看得到。
    await pageA.evaluate((gameId) => window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/battleSim", 1), sA.gameId);
    await waitFor(pageA, () => window.PriTestMidnight._debugState().fieldEnemyHp.battleSim === 1);
    await waitFor(pageA, () => window.PriTestMidnightSprite.currentAnimId() === "idle", null, 8000);
    const preloadedBefore = await pageA.evaluate((f) => !!document.querySelector("#midnight-enemy-sprite-stage") && performance.getEntriesByType("resource").some((e) => e.name.indexOf("images/sprites/" + f) !== -1), sheetInfo.file);
    assert(preloadedBefore, "sheet 在進戰鬥前已被預載（resource timing 有紀錄）", preloadedBefore);
    await tapAttack(pageA); // 一般攻擊是 mousedown→mouseup（bindAttackHoldInput()），不是 click
    const popupOk = (page) => waitFor(page, () => {
      const p = document.querySelector("#midnight-enemy-death-popup");
      return !!p && !p.hidden && p.offsetWidth > 0;
    }, null, 5000);
    await popupOk(pageA);
    await popupOk(pageB);
    const popupA = await pageA.evaluate(() => {
      const p = document.querySelector("#midnight-enemy-death-popup");
      const hud = document.querySelector("#midnight-hud-top-right");
      const face = p.querySelector(".midnight-sprite-face"); // 同主舞台：背景在 face 上
      return { bg: face ? face.style.backgroundImage : "", w: p.offsetWidth, inHud: p.parentElement === hud && hud.lastElementChild === p, panelHidden: document.querySelector("#midnight-field-encounter").hidden, stageHidden: document.querySelector("#midnight-enemy-sprite-stage").hidden, hp: window.PriTestMidnight._debugState().fieldEnemyHp.battleSim };
    });
    assert(popupA.hp === 0 && popupA.bg.indexOf(sheetInfo.file) !== -1, "HP 歸零後右上角小視窗用同一張 sheet 播放", popupA);
    assert(popupA.inHud && popupA.w > 0, "小視窗掛在 #midnight-hud-top-right 最後一格（不蓋內容）", popupA);
    assert(popupA.panelHidden && popupA.stageHidden, "戰鬥面板與主舞台已收起（主舞台不再空轉）", popupA);
    await pageA.waitForTimeout(1100); // death 6 幀 × 160ms ＝ 960ms → 之後 hold 在最後一幀
    const holdPos = await pageA.evaluate(() => document.querySelector("#midnight-enemy-death-popup .midnight-sprite-face").style.backgroundPosition);
    const posM = /^-(\d+)px -(\d+)px$/.exec(holdPos) || [];
    const cellFromX = posM[1] ? parseInt(posM[1], 10) / 5 : NaN;
    const cellFromY = posM[2] ? parseInt(posM[2], 10) / 7 : NaN;
    // 910f842 之後單格可為非正方形：格高＝round(格寬×cellAspectOf(sheet))，跟 midnight_sprite.js 同一條換算。
    const cellAspect = await pageA.evaluate((f) => window.PriTestMidnightSprite.cellAspectOf(f), sheetInfo.file);
    assert(cellFromX > 0 && cellFromY === Math.round(cellFromX * cellAspect), "小視窗 death hold 在最後一幀（row 7, frame 5，格寬 " + cellFromX + "px、格高 " + cellFromY + "px）", { holdPos, cellAspect });
    await waitFor(pageA, () => document.querySelector("#midnight-enemy-death-popup").hidden, null, 3000);
    assert(true, "停留後小視窗自動隱藏");
    // 死亡後 activeEncounter 結束；後續 ⑤⑥ 需要活著的敵人，把 HP 回滿並重新進入。
    await pageA.evaluate((args) => window.PriTestGameStorage.rtSet(args.gameId, "cloud", "fieldEnemyHp/battleSim", args.hp), { gameId: sA.gameId, hp: expectedHp });
    await waitFor(pageA, () => (window.PriTestMidnight._debugState().activeEncounter || {}).id === "battleSim", null, 15000);
    await waitFor(pageB, () => (window.PriTestMidnight._debugState().activeEncounter || {}).id === "battleSim", null, 15000);

    console.log("=== ⑤ 敵人攻擊排程沿用既有 pipeline ===");
    await waitFor(pageA, () => !!(window.PriTestMidnight._debugState().fieldTriggers.battleSim || {}).nextAttackAt, null, 8000).catch(() => {});
    assert(!!(await state(pageA)).fieldTriggers.battleSim.nextAttackAt, "ensureNextAttackScheduled() 排出 nextAttackAt");
    await waitFor(pageA, () => !!(window.PriTestMidnight._debugState().fieldTriggers.battleSim || {}).enemyAttack, null, 10000).catch(() => {});
    const atk = (await state(pageA)).fieldTriggers.battleSim.enemyAttack;
    assert(!!atk, "maybeStartEnemyAttack() 發動了一次攻擊", atk);
    if (atk) assert(atk.dmgAmount > 0, "這一招算得出傷害（dmgAmount>0）", atk);

    console.log("=== ⑭ 戰鬥模擬迴避計時：T 起算、按下即停並記錄、沒按補記逾時 ===");
    const timerBoxShown = await pageA.evaluate(() => {
      const b = document.querySelector("#midnight-battle-sim-dodge-timer");
      return { hidden: b.hidden, text: document.querySelector("#midnight-battle-sim-dodge-timer-now").textContent };
    });
    assert(!timerBoxShown.hidden && timerBoxShown.text.indexOf("迴避計時") === 0, "戰鬥模擬＋點陣圖模式下計時區塊顯示", timerBoxShown);
    // 等到自己成為目標且這一下的碼表開始（目標是隨機的，可能要等好幾次攻擊）
    await waitFor(pageA, () => !!window.PriTestMidnight._debugState().battleSimDodgeTimer, null, 40000);
    const tmr0 = (await state(pageA)).battleSimDodgeTimer;
    assert(tmr0.stoppedAt === null && typeof tmr0.hitAt === "number", "自己被鎖定時建立碼表（hitAt＝T、尚未停止）", tmr0);
    // 等過 T 再 0.15 秒，模擬「按下→放開」：pointerdown 記按下、click 記放開並停錶
    await pageA.waitForFunction((hitAt) => Date.now() >= hitAt + 150, tmr0.hitAt, { timeout: 10000 });
    const runningText = await pageA.textContent("#midnight-battle-sim-dodge-timer-now");
    assert(/T\+0\.\d{3}s/.test(runningText), "T 之後碼表顯示正數（" + runningText + "）", runningText);
    // 2026-09-22 使用者明確規格「改成按下的時間」：按下（pointerdown）在 Perfect 帶內、
    // 故意按住 0.4 秒再放開（click）——判定必須以按下為準＝Perfect；若以放開為準會落到 Good。
    await pageA.dispatchEvent("#btn-midnight-dodge", "pointerdown");
    await pageA.waitForTimeout(400);
    await pageA.dispatchEvent("#btn-midnight-dodge", "click");
    await waitFor(pageA, () => (window.PriTestMidnight._debugState().battleSimDodgeLog || []).length >= 1, null, 3000);
    const log1 = (await state(pageA)).battleSimDodgeLog[0];
    const m1 = /按下 T\+(\d\.\d{3})s（放開 T\+(\d\.\d{3})s）→ (Perfect|Great|Good|Bad) (\d+)%/.exec(log1);
    assert(!!m1 && log1.indexOf("第" + (tmr0.hitIndex + 1) + "下") !== -1, "第1筆紀錄含第幾下、按下／放開兩個時間與判定（" + log1 + "）", log1);
    if (m1) {
      const press = parseFloat(m1[1]);
      const release = parseFloat(m1[2]);
      assert(press >= 0.15 && press < 0.35 && release - press >= 0.35, "按下落在 Perfect 帶、放開比按下晚 ≥0.35s", { press, release });
      assert(m1[3] === "Perfect" && m1[4] === "100", "判定以「按下」為準 → Perfect 100%（以放開為準會是 Good）", { press, release, grade: m1[3] });
    }
    // 迴避成功度提示（實際判定的顯示）也必須是 Perfect
    await waitFor(pageA, () => !document.querySelector("#midnight-dodge-grade").hidden, null, 2000).catch(() => {});
    const gradeShown = await pageA.textContent("#midnight-dodge-grade");
    assert(gradeShown === "Perfect", "迴避鍵上方的成功度提示＝Perfect（實際判定用了按下時刻）", gradeShown);
    // 沒按的情況：等下一個碼表出現，放著不按直到它換掉，應補記「逾時」
    await waitFor(pageA, (k) => { const t = window.PriTestMidnight._debugState().battleSimDodgeTimer; return !!t && t.key !== k; }, tmr0.key, 40000);
    const tmr1 = (await state(pageA)).battleSimDodgeTimer;
    await waitFor(pageA, (k) => { const t = window.PriTestMidnight._debugState().battleSimDodgeTimer; return !t || t.key !== k; }, tmr1.key, 15000);
    const logTop = (await state(pageA)).battleSimDodgeLog[0];
    assert(logTop.indexOf("未按（逾時") !== -1 && logTop.indexOf("第" + (tmr1.hitIndex + 1) + "下") !== -1, "沒按時補記逾時（" + logTop + "）", logTop);

    console.log("=== ⑥ 逃離後不會卡死：候選重現並走［進入戰鬥］流程 ===");
    // 真的按遭遇面板右上的［逃離戰鬥］（CLAUDE.md §4.6：HUD 每幀重繪，用 dispatchEvent）。
    await pageA.dispatchEvent("#btn-midnight-flee-battle", "click");
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      return !s.activeEncounter && !!(s.fieldTriggers.battleSim.participants || {})["2"] && !(s.fieldTriggers.battleSim.participants || {})["1"];
    });
    assert(true, "逃離後 activeEncounter 清空、自己從 participants 移除、對方仍在");
    await waitFor(pageA, () => !document.querySelector("#midnight-enter-battle-prompt").hidden, null, 5000).catch(async (e) => {
      const dbg = await pageA.evaluate(() => { const s = window.PriTestMidnight._debugState(); return { ae: s.activeEncounter, nbs: s.nearbyBattleSim, nfp: s.nearbyFieldPoint, nd3: s.nearbyDay3Boss, ncp: s.nearbyCastlePoint, nfcb: s.nearbyFinalCircleBoss, fled: s.fledEncounterIds, pend: s.pendingBattleReentry, trig: s.fieldTriggers.battleSim, hp: s.fieldEnemyHp.battleSim, mySlot: s.mySlot, autoFly: s.autoFly, keys: Object.keys(s) }; });
      console.log("  [DEBUG ⑥] " + JSON.stringify(dbg));
      throw e;
    });
    assert(true, "上方資訊欄顯示既有的［進入戰鬥］提示（pendingBattleReentry）");
    await pageA.dispatchEvent("#btn-midnight-enter-battle", "click");
    await waitFor(pageA, () => (window.PriTestMidnight._debugState().activeEncounter || {}).id === "battleSim", null, 10000);
    assert(!!(await state(pageA)).fieldTriggers.battleSim.participants["1"], "讀條後重新加入 participants 並回到戰鬥");

    console.log("=== ⑦ 取消不需要密碼（回到等待房前的設定路徑）===");
    // 開局後等待房已隱藏，但 handler 本身不看畫面；直接 dispatch 驗證取消路徑不彈 prompt。
    let dialogOpened = false;
    pageB.once("dialog", async (d) => {
      dialogOpened = true;
      await d.dismiss();
    });
    await pageB.dispatchEvent("#btn-midnight-lobby-battle-sim", "click");
    await waitFor(pageB, () => !window.PriTestMidnight._debugState().meta.battleSim);
    assert(!dialogOpened, "取消時沒有跳出密碼 prompt");
    assert(true, "meta.battleSim 已清空");

    // ---- 第3批：另開一場乾淨的房間（trigger/battleSim 只在第一次建立，改指定對象要從等待房重來）----
    console.log("=== ⑪ 指定敵人種類／個體（新房間） ===");
    await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await pageA.click("#btn-midnight-create");
    await waitFor(pageA, () => window.PriTestMidnight && window.PriTestMidnight._debugState().meta);
    const gameUrl2 = pageA.url();
    await pageB.goto(gameUrl2, { waitUntil: "networkidle" });
    await waitFor(pageB, () => window.PriTestMidnight && window.PriTestMidnight._debugState().meta);
    await joinLobby(pageA, "1234");
    await joinLobby(pageB, "5678");
    await pageA.check("#midnight-lobby-sprite-mode-checkbox");
    await waitFor(pageB, () => window.PriTestMidnight._debugState().meta.spriteMode === true);
    await unlockTestMode(pageA); // 新房間＝新頁面，本機旗標歸零，要重新輸入密碼三列才顯示
    const selInit = await pageA.evaluate(() => {
      const kind = document.querySelector("#midnight-lobby-battle-sim-kind-select");
      const enemy = document.querySelector("#midnight-lobby-battle-sim-enemy-select");
      const values = Array.from(kind.options).map((o) => o.value);
      return { kindCount: kind.options.length, families: window.PriTestEnemies.listFamilies().length, hasBoss: values.indexOf("night_boss") !== -1, first: values[0], enemyHidden: enemy.hidden, disabled: kind.disabled };
    });
    assert(selInit.first === "" && selInit.kindCount === selInit.families + 2 && selInit.hasBoss, "種類下拉＝隨機＋" + selInit.families + "個系統＋夜王", selInit);
    assert(selInit.enemyHidden && !selInit.disabled, "種類為隨機時個體下拉隱藏、下拉未鎖定", selInit);
    // 選一個系統：個體下拉重建成該系統的每一隻＋隨機，有專屬 sheet 的加註
    await pageA.selectOption("#midnight-lobby-battle-sim-kind-select", "cavalry");
    await pageA.waitForTimeout(200);
    const selFam = await pageA.evaluate(() => {
      const enemy = document.querySelector("#midnight-lobby-battle-sim-enemy-select");
      const opts = Array.from(enemy.options).map((o) => ({ v: o.value, t: o.textContent }));
      const fam = window.PriTestEnemies.allEnemies().filter((r) => r.familyId === "cavalry");
      const own = (id) => !!window.PriTestMidnightSprite.sheetFileFor("cavalry", id, false);
      const suffix = window.I18N.t("midnight_lobby_battle_sim_own_sprite_suffix");
      const marksOk = opts.slice(1).every((o) => (o.t.indexOf(suffix) !== -1) === own(o.v));
      return { hidden: enemy.hidden, count: opts.length, famCount: fam.length, first: opts[0].v, marksOk, sample: opts.slice(0, 3) };
    });
    assert(!selFam.hidden && selFam.count === selFam.famCount + 1 && selFam.first === "", "選系統後個體下拉＝隨機＋該系統 " + selFam.famCount + " 隻", selFam);
    assert(selFam.marksOk, "有專屬 sheet 的個體才加註「專屬點陣圖」", selFam);
    // 選夜王：個體下拉＝隨機＋10 隻夜王
    await pageA.selectOption("#midnight-lobby-battle-sim-kind-select", "night_boss");
    await pageA.waitForTimeout(200);
    const selBoss = await pageA.evaluate(() => {
      const enemy = document.querySelector("#midnight-lobby-battle-sim-enemy-select");
      return { count: enemy.options.length, bosses: window.PriTestBossRulebook.list().length, hasGladius: Array.from(enemy.options).some((o) => o.value === "gladius") };
    });
    assert(selBoss.count === selBoss.bosses + 1 && selBoss.hasGladius, "選夜王後個體下拉＝隨機＋" + selBoss.bosses + " 隻夜王", selBoss);
    await pageA.selectOption("#midnight-lobby-battle-sim-enemy-select", "gladius");
    await pageA.check("#midnight-lobby-battle-sim-anim-cycle-checkbox");
    await clickBattleSim(pageA, PASSWORD);
    await waitFor(pageA, () => (window.PriTestMidnight._debugState().meta.battleSim || {}).enemyId === "gladius");
    const simBoss = (await state(pageA)).meta.battleSim;
    assert(simBoss.enemyFamilyId === "night_boss" && simBoss.bossForm === "fused" && simBoss.level === 16 && simBoss.animCycle === true, "meta.battleSim＝{night_boss, gladius, Lv.16, fused, animCycle:true}", simBoss);
    const bossName = await pageA.evaluate(() => window.PriTestEnemies.localizedText(window.PriTestBossRulebook.get("gladius").name));
    await waitFor(pageA, (n) => document.querySelector("#midnight-lobby-battle-sim-status").textContent.indexOf(n) !== -1, bossName);
    assert(true, "狀態列顯示夜王名稱「" + bossName + "」");
    await waitFor(pageB, () => (window.PriTestMidnight._debugState().meta.battleSim || {}).enemyId === "gladius");
    await pageB.waitForTimeout(200);
    const lockedB = await pageB.evaluate(() => {
      const kind = document.querySelector("#midnight-lobby-battle-sim-kind-select");
      const enemy = document.querySelector("#midnight-lobby-battle-sim-enemy-select");
      const cb = document.querySelector("#midnight-lobby-battle-sim-anim-cycle-checkbox");
      return { kind: kind.value, enemy: enemy.value, disabled: kind.disabled && enemy.disabled, cycle: cb.checked };
    });
    assert(lockedB.kind === "night_boss" && lockedB.enemy === "gladius" && lockedB.disabled && lockedB.cycle, "裝置B的下拉回填成夜王／gladius 並鎖定、勾選框同步", lockedB);

    console.log("=== ⑫ 夜王模擬開戰＋8 個動作循環 ===");
    await pageA.click("#btn-midnight-lobby-ready");
    await pageB.click("#btn-midnight-lobby-ready");
    await waitFor(pageA, () => window.PriTestMidnight._debugState().meta.sessionStartAt);
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      return !!(s.fieldTriggers.battleSim && typeof s.fieldEnemyHp.battleSim === "number");
    });
    const sBoss = await state(pageA);
    const trigBoss = sBoss.fieldTriggers.battleSim;
    assert(trigBoss.enemyFamilyId === "night_boss" && trigBoss.enemyId === "gladius" && trigBoss.bossForm === "fused" && trigBoss.level === 16, "trigger 帶 bossForm:\"fused\"（跟 Day3 夜王同形）", trigBoss);
    const bossHp = await pageA.evaluate((t) => window.PriTestMidnight._debugEnemyRealHpMax(t), trigBoss);
    assert(sBoss.fieldEnemyHp.battleSim === bossHp && bossHp > 0, "HP 走夜王分流 bossHpMax()（" + bossHp + "）", sBoss.fieldEnemyHp.battleSim);
    await waitFor(pageA, () => (window.PriTestMidnight._debugState().activeEncounter || {}).id === "battleSim", null, 15000);
    const bossPanel = await pageA.evaluate(() => ({
      name: document.querySelector("#midnight-field-encounter-name").textContent,
      bg: document.querySelector("#midnight-enemy-sprite-stage .midnight-sprite-face").style.backgroundImage,
      hidden: document.querySelector("#midnight-enemy-sprite-stage").hidden,
    }));
    assert(bossPanel.name === bossName && !bossPanel.hidden && bossPanel.bg.indexOf("boss_gladius.png") !== -1, "面板顯示夜王名稱、舞台用 boss_gladius.png", bossPanel);
    // 一輪約 9.3 秒（idle 2 圈 2400 ＋ line 1020 ＋ area 900 ＋ thrust 840 ＋ slam 1050 ＋ single 900 ＋ hurt 540 ＋ death 960+700）；
    // 採樣 11 秒，動作要照 listAnims() 順序出現、每一個都出現過，且標籤跟著動作走。
    const cycleSeen = await pageA.evaluate(() => new Promise((res) => {
      const order = [];
      const labels = {};
      let last = null;
      const t = setInterval(() => {
        const a = window.PriTestMidnightSprite.currentAnimId();
        const lbl = document.querySelector("#midnight-battle-sim-anim-label");
        if (a !== last) { order.push(a); last = a; }
        if (lbl && !lbl.hidden) labels[a] = lbl.textContent;
        // 攻擊／受擊事件確實有發生但沒有蓋掉循環：順便記錄期間有沒有 enemyAttack
        }, 20);
      setTimeout(() => { clearInterval(t); res({ order, labels, cycle: window.PriTestMidnight._debugState().battleSimAnimCycle }); }, 11000);
    }));
    const ANIM_ORDER = await pageA.evaluate(() => window.PriTestEnemySprite.listAnims().map((a) => a.id));
    const seenAll = ANIM_ORDER.every((id) => cycleSeen.order.indexOf(id) !== -1);
    assert(seenAll, "11 秒內 8 個動作全部播過（" + cycleSeen.order.join("→") + "）", cycleSeen.order);
    // 順序檢查：把採樣到的序列對照 listAnims() 順序，相鄰兩個必須是循環中的「下一個」
    const orderOk = cycleSeen.order.every((id, i) => i === 0 || ANIM_ORDER.indexOf(id) === (ANIM_ORDER.indexOf(cycleSeen.order[i - 1]) + 1) % ANIM_ORDER.length);
    assert(orderOk, "動作嚴格依 listAnims() 順序循環，沒有被攻擊／受擊動畫插隊", cycleSeen.order);
    assert(!!cycleSeen.cycle && typeof cycleSeen.cycle.index === "number", "_debugState().battleSimAnimCycle 有進度", cycleSeen.cycle);
    const labelOk = ANIM_ORDER.every((id, i) => (cycleSeen.labels[id] || "").indexOf((i + 1) + "/" + ANIM_ORDER.length) !== -1 && (cycleSeen.labels[id] || "").indexOf(id) !== -1);
    assert(labelOk, "面板標籤顯示「n/8」與動作 id，且跟播放中的動作一致", cycleSeen.labels);
    // 關掉勾選（開局後等待房隱藏，handler 不看畫面）：循環停止、標籤隱藏、恢復由攻擊管線驅動
    await pageB.evaluate(() => {
      const cb = document.querySelector("#midnight-lobby-battle-sim-anim-cycle-checkbox");
      cb.checked = false;
      cb.dispatchEvent(new Event("change"));
    });
    await waitFor(pageA, () => window.PriTestMidnight._debugState().meta.battleSim.animCycle === false);
    await pageA.waitForTimeout(300);
    const cycleOff = await pageA.evaluate(() => ({ cycle: window.PriTestMidnight._debugState().battleSimAnimCycle, labelHidden: document.querySelector("#midnight-battle-sim-anim-label").hidden }));
    assert(cycleOff.cycle === null && cycleOff.labelHidden, "關掉勾選後循環清空、標籤隱藏", cycleOff);
  } catch (e) {
    console.log("  [ERROR] " + (e && e.stack ? e.stack : e));
    results.push({ label: "腳本例外中止", pass: false });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log("");
  console.log("=== 結果：" + (results.length - failed.length) + "/" + results.length + " 通過 ===");
  if (failed.length) {
    failed.forEach((r) => console.log("  FAIL: " + r.label));
    process.exit(1);
  }
})();
