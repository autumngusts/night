// ============================================================================
// midnight（即時制擴張版）武器詞條 第1批 回歸測試
// （Playwright ＋ Firebase Local Emulator）。
// ============================================================================
// 對應使用者 2026-09-13 的規格：
//   ・房間創立中可以選擇「武器詞條開放」
//   ・開啟後，遊戲中獲得的武器／杖／聖印都帶詞條（初始裝備除外）
//   ・C稀有度1條、其餘2條
//   ・抽選時一併抽出（取得武器當下就擲定數值）
//   ・第一條必定有益、第二條60%機率有益
//   ・裝備欄持有即生效（不需要拿在手上）
//   ・詞條以「武器詳細欄＋卡片徽章」顯示
//
// 量測原則沿用本資料夾既有腳本：期望值從實際資料算回來，不硬編數字。
//
// 使用前準備（跟 emulator_sync_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node weapon_affix_check.js
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
    // 入座並開始遊戲：角色與起始裝備要等 sessionStartAt 之後才建立（見 ensureSpawn()），
    // 詞條的效果驗證需要真實角色，因此這裡走完整開局流程。
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
    // ① 資料模組本身
    // ------------------------------------------------------------------
    console.log("=== ① 詞條資料模組 ===");
    const data = await page.evaluate(() => {
      const A = window.PriTestWeaponAffixes;
      if (!A) return null;
      const all = A.list();
      const ids = all.map((a) => a.id);
      return {
        total: all.length,
        good: A.listByGood(true).length,
        bad: A.listByGood(false).length,
        dup: ids.filter((v, i) => ids.indexOf(v) !== i),
        phase2: all.filter((a) => a.phase === 2).length,
        // 每條都要有名稱與本文，範圍要是合法的 [min,max]
        malformed: all
          .filter((a) => !a.name.ja || !a.name.zh || !A.describe(a, a.range ? a.range[0] : null) || (a.range && a.range[0] > a.range[1]))
          .map((a) => a.id),
        sample: A.describe(A.get("maxHpUp"), 12),
      };
    });
    assert(!!data, "window.PriTestWeaponAffixes 已載入");
    if (data) {
      assert(data.total > 90, "詞條數量符合使用者清單規模", data.total);
      assert(data.dup.length === 0, "沒有重複的詞條 id", data.dup);
      assert(data.malformed.length === 0, "每條詞條都有名稱／本文，數值範圍合法", data.malformed);
      assert(data.good > 0 && data.bad > 0, "有益與有害詞條都存在（第一條必定有益需要兩個池）", data);
      assert(data.sample.indexOf("12") !== -1, "describe() 會把 {v} 換成實際擲定的數值", data.sample);
    }

    // ------------------------------------------------------------------
    // ② 房間選項
    // ------------------------------------------------------------------
    console.log("=== ② 房間選項 ===");
    const optionExists = await page.evaluate(() => {
      const box = document.getElementById("midnight-lobby-weapon-affixes-checkbox");
      return { exists: !!box, checked: box ? box.checked : null, enabled: window.PriTestMidnight._debugState().meta.weaponAffixes || false };
    });
    assert(optionExists.exists, "等待房有「武器詞條開放」勾選框", optionExists);
    assert(optionExists.enabled === false, "預設關閉（不影響既有場次）", optionExists);

    // 關閉時不得產生詞條
    const offRoll = await page.evaluate(() => window.PriTestMidnight._debugGrantAffixes("greatsword_pursuer::probe_off"));
    assert(offRoll === null, "未開啟時取得武器不會產生任何詞條", offRoll);

    // 走真正的 change handler（勾選框此時被等待房畫面隱藏，用 dispatchEvent 觸發，
    // 見 CLAUDE.md §4.6：midnight 一律不用 page.click）。
    await page.evaluate(() => {
      document.getElementById("midnight-lobby-weapon-affixes-checkbox").checked = true;
    });
    await page.dispatchEvent("#midnight-lobby-weapon-affixes-checkbox", "change");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.weaponAffixes === true, { timeout: META_WAIT_MS });
    assert(true, "勾選後 meta.weaponAffixes 透過 RTDB 同步為 true（全場共用）");

    // ------------------------------------------------------------------
    // ③ 抽選規則：C=1條、其餘=2條；第一條必定有益；第二條約60%有益
    // ------------------------------------------------------------------
    console.log("=== ③ 抽選規則 ===");
    const rolls = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const A = window.PriTestWeaponAffixes;
      const out = { c: [], u: [], firstBad: 0, secondGood: 0, secondTotal: 0, valueOutOfRange: [] };
      for (let i = 0; i < 400; i++) {
        ["C", "U"].forEach((rarity) => {
          const list = M._debugRollAffixes(rarity);
          (rarity === "C" ? out.c : out.u).push(list.length);
          list.forEach((entry, idx) => {
            const affix = A.get(entry.id);
            if (idx === 0 && !affix.good) out.firstBad += 1;
            if (idx === 1) {
              out.secondTotal += 1;
              if (affix.good) out.secondGood += 1;
            }
            if (affix.range && (entry.value < affix.range[0] || entry.value > affix.range[1])) out.valueOutOfRange.push(entry.id);
            if (!affix.range && entry.value !== null) out.valueOutOfRange.push(entry.id);
          });
        });
      }
      return out;
    });
    assert(
      rolls.c.every((n) => n === 1),
      "C稀有度固定1條",
      rolls.c.slice(0, 5)
    );
    assert(
      rolls.u.every((n) => n === 2),
      "非C稀有度固定2條",
      rolls.u.slice(0, 5)
    );
    assert(rolls.firstBad === 0, "第一條必定是有益效果（400×2次抽樣全數通過）", rolls.firstBad);
    const secondRatio = rolls.secondGood / rolls.secondTotal;
    assert(
      secondRatio > 0.5 && secondRatio < 0.7,
      `第二條有益的比例落在60%附近（實測 ${(secondRatio * 100).toFixed(1)}%）`,
      { secondGood: rolls.secondGood, secondTotal: rolls.secondTotal }
    );
    assert(rolls.valueOutOfRange.length === 0, "擲定的數值都落在該詞條宣告的範圍內", rolls.valueOutOfRange.slice(0, 5));

    // ------------------------------------------------------------------
    // ④ 取得武器時一併擲定、且不會重抽
    // ------------------------------------------------------------------
    console.log("=== ④ 取得武器時擲定 ===");
    const grant = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const first = M._debugGrantAffixes("greatsword_pursuer::probe1");
      const second = M._debugGrantAffixes("greatsword_pursuer::probe1"); // 同一把再叫一次
      const stored = M._debugCharacterAffixes()["greatsword_pursuer::probe1"];
      return { first, second, stored };
    });
    assert(grant.first && grant.first.length > 0, "取得武器時真的產生了詞條", grant.first);
    assert(grant.second === null, "同一把武器不會重抽（撿回自己丟掉的那把時詞條不變）", grant.second);
    assert(JSON.stringify(grant.stored) === JSON.stringify(grant.first), "詞條存在 c.weaponAffixes[weaponId]", grant);

    // ------------------------------------------------------------------
    // ⑤ 效果：裝備欄持有即生效（不需要拿在手上）
    // 用「最大HP上昇」驗證——它是純數值、可以直接從 selfArenaHpMax() 讀回來比對。
    // ------------------------------------------------------------------
    console.log("=== ⑤ 裝備欄持有即生效 ===");
    const effect = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const before = M._debugSelfHpMax();
      // 直接塞一條已知數值的詞條到一把「持有但不裝備」的武器上
      M._debugSetWeaponAffixes("greatsword_pursuer::probe2", [{ id: "maxHpUp", value: 13 }], { equip: false });
      const afterHeld = M._debugSelfHpMax();
      M._debugSetWeaponAffixes("greatsword_pursuer::probe2", null);
      const afterRemoved = M._debugSelfHpMax();
      return { before, afterHeld, afterRemoved };
    });
    assert(effect.afterHeld === effect.before + 13, "只放在裝備欄（沒拿在手上）的詞條就會生效", effect);
    assert(effect.afterRemoved === effect.before, "移除詞條後數值復原", effect);

    // 有害詞條同樣生效，且「瀕死時最大HP低下」的下限夾在100
    const badEffect = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const before = M._debugSelfHpMax();
      M._debugSetWeaponAffixes("greatsword_pursuer::probe3", [{ id: "maxHpDown", value: 9 }], { equip: false });
      const after = M._debugSelfHpMax();
      M._debugSetWeaponAffixes("greatsword_pursuer::probe3", null);
      return { before, after };
    });
    assert(badEffect.after === badEffect.before - 9, "有害詞條（最大HP低下）同樣生效", badEffect);

    // ------------------------------------------------------------------
    // ⑥ UI：武器格徽章 ＋ 詳細欄詞條列
    // ------------------------------------------------------------------
    console.log("=== ⑥ UI 顯示 ===");
    const ui = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const A = window.PriTestWeaponAffixes;
      const D = M._debugState();
      const c = D.characters[D.myTokenId];
      const wid = (c.weaponIds || [])[0];
      if (!wid) return { skipped: true };
      M._debugSetWeaponAffixes(wid, [
        { id: "maxHpUp", value: 11 },
        { id: "maxFpDown", value: 7 },
      ]);
      document.getElementById("midnight-character-sheet-modal").hidden = false;
      M._debugRenderCharacterSheet();
      const slot = document.querySelector("#midnight-character-sheet-weapons .midnight-sheet-slot");
      const badge = slot ? slot.querySelector(".midnight-sheet-slot-badge") : null;
      M._debugSelectSheetItem("weapon", wid);
      const rows = [...document.querySelectorAll("#midnight-character-sheet-detail .midnight-affix-row")].map((r) => ({
        text: r.textContent,
        good: r.classList.contains("midnight-affix-good"),
        bad: r.classList.contains("midnight-affix-bad"),
        color: getComputedStyle(r).color,
      }));
      const out = {
        badge: badge ? badge.textContent : null,
        rows,
        goodName: A.localizedText(A.get("maxHpUp").name),
        badName: A.localizedText(A.get("maxFpDown").name),
      };
      M._debugSetWeaponAffixes(wid, null);
      document.getElementById("midnight-character-sheet-modal").hidden = true;
      return out;
    });
    if (ui.skipped) {
      assert(false, "角色有起始武器可供測試（測試前提）", ui);
    } else {
      assert(ui.badge === "◈◈", "武器格右下角有「每條一枚◈」的徽章", ui.badge);
      assert(ui.rows.length === 2, "詳細欄列出這把武器的兩條詞條", ui.rows);
      assert(ui.rows[0].text.indexOf(ui.goodName) !== -1, "詞條列顯示詞條名稱", ui.rows[0]);
      assert(ui.rows[0].text.indexOf("11") !== -1, "詞條列顯示取得時擲定的實際數值", ui.rows[0]);
      assert(ui.rows[0].good && ui.rows[1].bad, "有益／有害各自套用不同的 class", ui.rows);
      assert(ui.rows[0].color !== ui.rows[1].color, "有益綠字、有害紅字（實際顏色不同）", ui.rows.map((r) => r.color));
    }

    // ------------------------------------------------------------------
    // ⑦ 第2批尚未接入的詞條：會被抽到、會顯示，但數值不生效
    // ------------------------------------------------------------------
    console.log("=== ⑦ 第2批詞條標注 ===");
    const pending = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const A = window.PriTestWeaponAffixes;
      const ph2 = A.list().filter((a) => a.phase === 2);
      const withValue = ph2.filter((a) => a.range)[0];
      if (!withValue) return { skipped: true, count: ph2.length };
      const before = M._debugAffixTotal(withValue.id);
      M._debugSetWeaponAffixes("greatsword_pursuer::probe4", [{ id: withValue.id, value: 99 }], { equip: false });
      const after = M._debugAffixTotal(withValue.id);
      M._debugSetWeaponAffixes("greatsword_pursuer::probe4", null);
      return { count: ph2.length, id: withValue.id, before, after };
    });
    assert(pending.count > 0, "有被標成第2批的詞條", pending);
    if (!pending.skipped) {
      assert(pending.after === 0 && pending.before === 0, "第2批詞條的數值不會提前生效（affixTotal 一律 0）", pending);
    }

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
