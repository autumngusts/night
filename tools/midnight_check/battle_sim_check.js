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
//      切到對應攻擊動畫、被打時 hurt、HP 歸零時 death（hold 在最後一幀）
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
      return { hidden: st.hidden, bg: st.style.backgroundImage, w: st.offsetWidth, h: st.offsetHeight, anim: window.PriTestMidnightSprite.currentAnimId() };
    });
    assert(!!stage0 && !stage0.hidden, "#midnight-enemy-sprite-stage 已 mount 且顯示", stage0);
    assert(!!stage0 && stage0.bg.indexOf(sheetInfo.file) !== -1, "舞台 background-image 指向該 sheet", stage0);
    assert(!!stage0 && stage0.w > 0 && stage0.h === stage0.w, "舞台有實際尺寸且為正方形（cellPx 推算成立）", stage0);
    assert(!!stage0 && stage0.anim === "idle", "初始播放 idle", stage0);
    const imgOk = await pageA.evaluate((f) => new Promise((res) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = "../static/images/sprites/" + f; }), sheetInfo.file);
    assert(!!imgOk && imgOk.w === (imgOk.h / 8) * 6, "sheet 圖片可被瀏覽器解碼且為 6×8 格", imgOk);
    // idle 6 幀 × 200ms：1.5 秒內 background-position 至少要換過 3 種值
    const idlePositions = await pageA.evaluate(() => new Promise((res) => {
      const seen = {};
      const st = document.querySelector("#midnight-enemy-sprite-stage");
      const t = setInterval(() => { seen[st.style.backgroundPosition] = true; }, 30);
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
    // HP 墊到 1 再打一擊 → death 並 hold 在最後一幀
    await pageA.evaluate((gameId) => window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/battleSim", 1), sA.gameId);
    await waitFor(pageA, () => window.PriTestMidnight._debugState().fieldEnemyHp.battleSim === 1);
    await waitFor(pageA, () => window.PriTestMidnightSprite.currentAnimId() === "idle", null, 8000);
    await tapAttack(pageA); // 一般攻擊是 mousedown→mouseup（bindAttackHoldInput()），不是 click
    await waitFor(pageA, () => window.PriTestMidnightSprite.currentAnimId() === "death", null, 5000);
    await pageA.waitForTimeout(1300); // death 6 幀 × 160ms ＝ 960ms，之後 hold
    const deathState = await pageA.evaluate(() => ({ anim: window.PriTestMidnightSprite.currentAnimId(), pos: document.querySelector("#midnight-enemy-sprite-stage").style.backgroundPosition, hp: window.PriTestMidnight._debugState().fieldEnemyHp.battleSim }));
    assert(deathState.hp === 0 && deathState.anim === "death", "HP 歸零後播放 death 並 hold（不回 idle）", deathState);
    // 敵人死亡後遭遇面板會收起、舞台 offsetWidth 變 0，不能再用 backgroundPosition() 反算；
    // 直接從實際值反推格寬：x 必須是 5 格（frame 5）、y 必須是 7 格（row 7）。
    const posM = /^-(\d+)px -(\d+)px$/.exec(deathState.pos) || [];
    const cellFromX = posM[1] ? parseInt(posM[1], 10) / 5 : NaN;
    const cellFromY = posM[2] ? parseInt(posM[2], 10) / 7 : NaN;
    assert(cellFromX > 0 && cellFromX === cellFromY, "death hold 在最後一幀（row 7, frame 5，格寬 " + cellFromX + "px）", deathState.pos);
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

    console.log("=== ⑥ 逃離後不會卡死：候選重現並走［進入戰鬥］流程 ===");
    // 真的按遭遇面板右上的［逃離戰鬥］（CLAUDE.md §4.6：HUD 每幀重繪，用 dispatchEvent）。
    await pageA.dispatchEvent("#btn-midnight-flee-battle", "click");
    await waitFor(pageA, () => {
      const s = window.PriTestMidnight._debugState();
      return !s.activeEncounter && !!(s.fieldTriggers.battleSim.participants || {})["2"] && !(s.fieldTriggers.battleSim.participants || {})["1"];
    });
    assert(true, "逃離後 activeEncounter 清空、自己從 participants 移除、對方仍在");
    await waitFor(pageA, () => !document.querySelector("#midnight-enter-battle-prompt").hidden, null, 5000);
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
