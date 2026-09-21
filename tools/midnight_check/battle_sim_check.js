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
