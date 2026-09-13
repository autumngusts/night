// ============================================================================
// midnight（即時制擴張版）2026-09-13 升級規格變更＋敵視比例制 回歸測試
// （Playwright ＋ Firebase Local Emulator）。
// ============================================================================
// 對應使用者當日提出的4項規格：
//   ① 升級 Lv4／7／10／13 改為體力 +5（終值）
//      —— 原本那三選一輪替的第三格是 blessingSlots，而 blessingSlots 在 midnight
//         完全沒有用途，等於那4次升級是空的
//   ② Lv2 才學到角色招式（技能）、Lv3 才學到角色技藝
//   ③ 「敵視：+1」這類條文，累積速度為自己傷害數值 ×1.1 倍計入累積傷害
//   ④ 亂戰傷害基本不看仇恨；帶有會看敵視的招式才看仇恨。仇恨不再是「最高者直接指定」，
//      改為依造成傷害的比例加權隨機，最高者享有 2 倍權重
//
// 使用前準備（跟 emulator_sync_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node level_and_aggro_check.js
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

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  const pageErrors = [];
  page.on("pageerror", (e) => {
    pageErrors.push(e.message);
    console.log("  [pageerror] " + e.message);
  });

  try {
    await enableEmulatorFlag(page);
    console.log("=== 建立 midnight 測試場（連本機 emulator） ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await page.click("#midnight-lobby-slots .midnight-slot-empty button");
    await page.fill("#midnight-lobby-passcode-input", "1234");
    await page.click("#btn-midnight-lobby-join");
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().characters[window.PriTestMidnight._debugState().myTokenId], {
      timeout: META_WAIT_MS,
    });

    // ------------------------------------------------------------------
    // ① 升級 Lv4/7/10/13 → 體力 +5
    // ------------------------------------------------------------------
    console.log("=== ① 升級體力 ===");
    const staminaByLevel = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const out = {};
      for (let lv = 1; lv <= 15; lv++) out[lv] = M._debugLevelStaminaBonus(lv);
      return out;
    });
    // 期望值直接從規格推：Lv4/7/10/13 各 +5，其餘等級不變（累進）
    const expected = {};
    let acc = 0;
    for (let lv = 1; lv <= 15; lv++) {
      if (lv >= 2 && (lv - 2) % 3 === 2) acc += 5;
      expected[lv] = acc;
    }
    assert(JSON.stringify(staminaByLevel) === JSON.stringify(expected), "各等級的體力加成符合「Lv4/7/10/13 各 +5」", { staminaByLevel, expected });
    assert(staminaByLevel[3] === 0 && staminaByLevel[4] === 5, "Lv3 還沒有加成、Lv4 開始 +5", staminaByLevel);
    assert(staminaByLevel[15] === 20, "Lv15 累計 +20（4 次升級各 +5）", staminaByLevel);

    // 實際的 stamina.max 要跟著變（不是只有 helper 算得出來）
    const staminaMax = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      M._debugSetLevel(1);
      await new Promise((r) => setTimeout(r, 400));
      const lv1 = M._debugStaminaMaxNow();
      M._debugSetLevel(13);
      await new Promise((r) => setTimeout(r, 400));
      const lv13 = M._debugStaminaMaxNow();
      M._debugSetLevel(1);
      await new Promise((r) => setTimeout(r, 400));
      return { lv1, lv13, back: M._debugStaminaMaxNow() };
    });
    assert(staminaMax.lv13 === staminaMax.lv1 + 20, "實際的體力上限在 Lv13 比 Lv1 高 20", staminaMax);
    assert(staminaMax.back === staminaMax.lv1, "等級退回後體力上限也跟著回復", staminaMax);

    // ------------------------------------------------------------------
    // ② 技能 Lv2 / 技藝 Lv3 才習得
    // ------------------------------------------------------------------
    console.log("=== ② 技能/技藝的習得等級 ===");
    const unlockLevels = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      return { skill: M._debugAbilityUnlock("skill").level, art: M._debugAbilityUnlock("art").level };
    });
    assert(unlockLevels.skill === 2, "角色招式（技能）習得等級是 Lv2", unlockLevels);
    assert(unlockLevels.art === 3, "角色技藝習得等級是 Lv3", unlockLevels);

    const gating = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const c = D.characters[D.myTokenId];
      const type = window.PriTestCharacterTypes.get(c.typeId);
      const hasSkill = !!(type.skills || [])[0];
      const hasArt = !!(type.arts || [])[0];
      const snap = {};
      for (const lv of [1, 2, 3]) {
        M._debugSetLevel(lv);
        await new Promise((r) => setTimeout(r, 250));
        snap[lv] = M._debugAbilityButtonsHidden();
      }
      M._debugSetLevel(1);
      return { hasSkill, hasArt, snap, typeId: c.typeId };
    });
    if (!gating.hasSkill || !gating.hasArt) {
      assert(false, "測試角色同時有技能與技藝（測試前提）", gating);
    } else {
      assert(gating.snap[1].skill === true && gating.snap[1].art === true, "Lv1：技能與技藝按鈕都不顯示", gating.snap);
      assert(gating.snap[2].skill === false, "Lv2：技能按鈕出現", gating.snap);
      assert(gating.snap[2].art === true, "Lv2：技藝按鈕仍不顯示", gating.snap);
      assert(gating.snap[3].art === false, "Lv3：技藝按鈕出現", gating.snap);
    }

    // 角色視窗在未達等級時要看得出來「還沒學到」，不是一片空白
    const sheetNote = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      M._debugSetLevel(1);
      document.getElementById("midnight-character-sheet-modal").hidden = false;
      M._debugRenderCharacterSheet();
      await new Promise((r) => setTimeout(r, 250));
      const read = (id) => {
        const e = document.getElementById(id);
        return e ? e.textContent.trim() : null;
      };
      const locked = { arts: read("midnight-character-sheet-arts"), skills: read("midnight-character-sheet-skills") };
      M._debugSetLevel(3);
      M._debugRenderCharacterSheet();
      await new Promise((r) => setTimeout(r, 250));
      const unlocked = { arts: read("midnight-character-sheet-arts"), skills: read("midnight-character-sheet-skills") };
      document.getElementById("midnight-character-sheet-modal").hidden = true;
      M._debugSetLevel(1);
      return { locked, unlocked };
    });
    assert(!!sheetNote.locked.arts && sheetNote.locked.arts.length > 0, "Lv1 的角色視窗在技藝欄顯示「還沒學到」的說明", sheetNote.locked);
    assert(sheetNote.locked.arts !== sheetNote.unlocked.arts, "達到等級後技藝欄改成列出招式本身", sheetNote);

    // ------------------------------------------------------------------
    // ③ 「敵視：+1」的累積倍率
    // ------------------------------------------------------------------
    console.log("=== ③ 敵視累積倍率 ===");
    const aggroMult = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      M._debugSetHighGuardActive(false);
      const base = M._debugAggroAccumMultiplier();
      M._debugSetHighGuardActive(true);
      const withHighGuard = M._debugAggroAccumMultiplier();
      M._debugSetHighGuardActive(false);
      return { base, withHighGuard };
    });
    assert(Math.abs(aggroMult.base - 1) < 1e-9, "沒有任何「敵視：+1」來源時倍率是 1.0", aggroMult);
    assert(Math.abs(aggroMult.withHighGuard - 1.1) < 1e-9, "高防禦發動中（規則書原文附帶「敵視：+1」）時倍率是 1.1", aggroMult);

    // ------------------------------------------------------------------
    // ④ 敵視比例制選目標
    // ------------------------------------------------------------------
    console.log("=== ④ 比例制選目標 ===");
    const dist = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const slots = ["1", "2", "3"];
      const damage = { 1: 100, 2: 50, 3: 50 }; // 最高者是 1
      const counts = { 1: 0, 2: 0, 3: 0 };
      const N = 30000;
      for (let i = 0; i < N; i++) counts[M._debugPickAggroWeightedSlot(damage, slots)] += 1;
      // 期望權重：1 → 100×2 = 200、2 → 50、3 → 50，總計 300
      return { counts, N, expect: { 1: 200 / 300, 2: 50 / 300, 3: 50 / 300 } };
    });
    const ratio = (k) => dist.counts[k] / dist.N;
    assert(Math.abs(ratio(1) - dist.expect[1]) < 0.02, `最高者的命中比例約 ${(dist.expect[1] * 100).toFixed(1)}%（傷害比例 ×2 倍權重）`, dist.counts);
    assert(Math.abs(ratio(2) - dist.expect[2]) < 0.02, "次高者依傷害比例分配", dist.counts);
    assert(Math.abs(ratio(3) - dist.expect[3]) < 0.02, "第三位依傷害比例分配", dist.counts);
    assert(ratio(1) < 1, "最高者不再是「直接指定」（不會 100% 被選中）", dist.counts);

    const edge = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const slots = ["1", "2", "3"];
      const counts = { 1: 0, 2: 0, 3: 0 };
      for (let i = 0; i < 9000; i++) counts[M._debugPickAggroWeightedSlot({}, slots)] += 1;
      const single = {};
      for (let i = 0; i < 500; i++) {
        const s = M._debugPickAggroWeightedSlot({ 2: 40 }, slots);
        single[s] = (single[s] || 0) + 1;
      }
      return { counts, single };
    });
    const uniformOk = [1, 2, 3].every((k) => Math.abs(edge.counts[k] / 9000 - 1 / 3) < 0.03);
    assert(uniformOk, "還沒有人造成過傷害時退回等機率隨機（否則第一擊選不出目標）", edge.counts);
    assert(Object.keys(edge.single).length === 1 && edge.single["2"] === 500, "只有一人造成過傷害時，單體攻擊固定打他（依規格的字面比例：其餘權重為0）", edge.single);

    assert(pageErrors.length === 0, "整段流程沒有任何 pageerror", pageErrors.slice(0, 3));

    const failed = results.filter((r) => !r.pass);
    console.log("\n==== 結果：" + (results.length - failed.length) + " / " + results.length + " 通過 ====");
    if (failed.length) {
      failed.forEach((f) => console.log("  FAIL: " + f.label));
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("測試中斷：", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
