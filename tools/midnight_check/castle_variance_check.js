// ============================================================================
// midnight 王城（J）依劇本決定分歧／花色 的 end-to-end 回歸測試（Firebase emulator）
// ============================================================================
// 2026-09-22 劇本×地圖交叉測試（scenario_map_cross_check.js 是純 node 的靜態窮舉）修正後，
// 這支腳本在真實瀏覽器＋emulator 上走一次「選劇本 → 開局 → 傳送進王城 → 進入 → 打字機 →
// 自動選擇 → 指派敵人」，確認：
//   ① 分歧依劇本 varianceTable：劇本 1（♣）→「砦」、劇本 5（♠，砦沒有♠版本→退回花色）→「砦」、
//      劇本 8 →「西の地下砦」或「東の地下砦」。
//   ② 花色變體合併後樓層數是 4（不再是「谷底→(♥)正門→(◇)正門→(♣)正門」）。
//   ③ 砦第 1 層「谷底の地下通路」的「地下エネミー決定表」真的擲出敵人（trig.enemyId 有值）。
//
// 使用前準備（同 emulator_sync_check.js）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8791 --directory dist（或設定 PRITEST_BASE_URL）
//   3. tools/midnight_check/ 執行過一次 npm install
//   4. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//
// 執行方式：node castle_variance_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const META_WAIT_MS = 15000;

function assert(cond, label, results) {
  results.push({ label: label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label);
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

// 劇本 id → 期望的分歧名（ja 前綴）與 J 卡花色（scenarios.js day1/day2 的 J slot）
const CASES = [
  { scenarioId: "tricephalos", label: "劇本1 三首獸（J=♣）", branchPrefixes: ["砦"], suits: ["C"] },
  { scenarioId: "equilibrious_beast", label: "劇本5 夜之魔（J=♠，砦沒有♠版本）", branchPrefixes: ["砦"], suits: ["S"] },
  { scenarioId: "balancers", label: "劇本8 救贖的旗手（J=♥西／◇東）", branchPrefixes: ["西の地下砦", "東の地下砦"], suits: ["H", "D"] },
];

(async () => {
  const browser = await chromium.launch();
  const results = [];

  for (const tc of CASES) {
    const page = await browser.newPage();
    try {
      await enableEmulatorFlag(page);
      console.log("=== " + tc.label + " ===");
      await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
      await page.click("#btn-midnight-create");
      await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
      await page.selectOption("#midnight-lobby-night-boss-select", tc.scenarioId);
      await page.waitForFunction((id) => window.PriTestMidnight._debugState().meta.nightBossId === id, tc.scenarioId, { timeout: 8000 });
      await joinLobby(page, "1234");
      const stateA = await page.evaluate(() => window.PriTestMidnight._debugState());
      await page.click("#btn-midnight-lobby-ready");
      await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });
      await page.evaluate((gameId) => window.PriTestGameStorage.rtSet(gameId, "cloud", "meta/testMode", true), stateA.gameId);
      await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.testMode, { timeout: 10000 });

      // ① 分歧／花色（純查詢，不動 state）
      const variant = await page.evaluate(() => {
        const M = window.PriTestMidnight;
        const pt = M._debugCastlePoint();
        const v = M._debugResolveFieldVariant(pt);
        const card = window.PriTestFields.get("card_j");
        return { branchIndex: v.branchIndex, suitCode: v.suitCode, branchJa: card.branches[v.branchIndex].name.ja, floorTitles: M._debugEffectiveFloorTitles(pt), floorCount: M._debugFieldFloorCount(pt) };
      });
      assert(tc.branchPrefixes.some((p) => variant.branchJa.indexOf(p) === 0), "分歧依劇本決定：" + variant.branchJa + "（期望 " + tc.branchPrefixes.join("／") + "）", results);
      assert(tc.suits.indexOf(variant.suitCode) !== -1, "花色取自劇本 J 卡：" + variant.suitCode + "（期望 " + tc.suits.join("／") + "）", results);
      // ② 花色變體合併：4 層、標題不重複、同一花色
      assert(variant.floorCount === 4, "合併花色變體後樓層數 4（實際 " + variant.floorCount + "）：" + variant.floorTitles.join(" → "), results);
      const usedSymbols = variant.floorTitles.map((t) => (/^\s*[（(]([♠♥◇♦♣])[）)]/.exec(t) || [])[1]).filter(Boolean);
      assert(new Set(usedSymbols).size <= 1, "帶單一花色標記的樓層全部同花色（" + (usedSymbols.join("") || "無") + "）", results);
      assert(new Set(variant.floorTitles).size === variant.floorTitles.length, "走到的樓層標題沒有重複", results);

      // ③ 真的進入王城：傳送到王城重心、按「進入」、等指派敵人
      await page.evaluate(() => {
        const M = window.PriTestMidnight;
        const pt = M._debugCastlePoint();
        M._debugSetLocalPos(pt.x, pt.y);
      });
      await page.waitForFunction(() => !!window.PriTestMidnight._debugState().nearbyCastlePoint, { timeout: 8000 });
      await page.evaluate(() => window.PriTestMidnight._debugEnterCastle());
      await page.waitForFunction(() => {
        const trig = (window.PriTestMidnight._debugState().fieldTriggers || {}).castle_j;
        return trig && trig.status === "inviting";
      }, { timeout: 8000 });
      // CLAUDE.md §4.6：midnight 的 HUD 用 dispatchEvent，不用 page.click（開場敘述遮罩會攔截點擊）
      const forceBtn = page.locator('#midnight-field-invite-status [data-role="force-enter"]');
      if (await forceBtn.count()) await page.dispatchEvent('#midnight-field-invite-status [data-role="force-enter"]', "click");
      await page.waitForFunction(() => {
        const trig = (window.PriTestMidnight._debugState().fieldTriggers || {}).castle_j;
        return trig && trig.status !== "inviting" && typeof trig.branchIndex === "number";
      }, { timeout: 15000 });
      const trigActive = await page.evaluate(() => window.PriTestMidnight._debugState().fieldTriggers.castle_j);
      assert(trigActive.branchIndex === variant.branchIndex && (trigActive.floorIndex || 0) === 0, "fieldTrigger 的 branchIndex 與查詢結果一致、從第 0 層開始", results);
      // 打字機（56ms × 字數）＋ 3 秒自動選擇 ＋ 指派：砦第 1 層敘述約 100 字，給 40 秒
      await page.waitForFunction(() => {
        const trig = (window.PriTestMidnight._debugState().fieldTriggers || {}).castle_j;
        return trig && trig.status === "resolved" && !!trig.enemyId;
      }, { timeout: 40000 }).catch(() => {});
      const trigResolved = await page.evaluate(() => window.PriTestMidnight._debugState().fieldTriggers.castle_j);
      assert(trigResolved && trigResolved.status === "resolved", "第 1 層敘述播完後自動 resolved", results);
      assert(!!(trigResolved && trigResolved.enemyId), "第 1 層（" + variant.floorTitles[0] + "）的決定表擲出敵人：" + (trigResolved && trigResolved.enemyId) + " Lv" + (trigResolved && trigResolved.level), results);
    } catch (err) {
      console.error("FATAL:", err);
      results.push({ label: tc.label + "：腳本拋出未預期例外：" + err.message, pass: false });
    } finally {
      await page.close();
    }
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n=== 結果彙總 ===");
  console.log(results.length + "項檢查，" + failed.length + "項失敗");
  if (failed.length) failed.forEach((f) => console.log("  [FAIL] " + f.label));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
