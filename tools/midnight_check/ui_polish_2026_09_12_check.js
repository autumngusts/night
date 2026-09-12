// ============================================================================
// midnight（即時制擴張版）2026-09-12 UI 優化第 5 批 回歸測試
// （Playwright ＋ Firebase Local Emulator）。
// ============================================================================
// 對應使用者當日提出的 6 項：
//   ① 抽選視窗與角色視窗：右邊詳細資訊 side 占比再拉長
//   ② 遺物效果抽選時不超過畫面、保持在角色視窗內、可滾輪往下看全部
//   ③ 角色視窗各個按鈕補上 padding（遺物效果貼得過近）
//   ④ 對敵人的屬性傷害／異常狀態顯示方式美化
//   ⑤ 戰鬥按鈕文字用跑馬燈來回跑（長文字會來回顯示）
//   ⑥ 使用異常狀態招式時，對敵人的刀光四周產生符合異常狀態的特效
//
// 量測原則沿用本資料夾既有腳本：期望值盡量從實際版面算回來（例如「詳細欄比清單欄寬」
// 而不是硬編像素），只有「哪個 class／CSS 變數要存在」這種結構性條件才直接斷言。
//
// 使用前準備（跟 emulator_sync_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node ui_polish_2026_09_12_check.js
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

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  page.on("pageerror", (e) => console.log("  [pageerror] " + e.message));

  try {
    await enableEmulatorFlag(page);
    console.log("=== 建立 midnight 測試場（連本機 emulator） ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await joinLobby(page, "1234");
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().characters[window.PriTestMidnight._debugState().myTokenId], {
      timeout: META_WAIT_MS,
    });

    // ------------------------------------------------------------------
    // ① 右側詳細資訊的占比
    // ------------------------------------------------------------------
    console.log("=== ① 詳細資訊 side 占比 ===");
    await page.evaluate(() => {
      const m = document.getElementById("midnight-character-sheet-modal");
      if (m) m.hidden = false;
    });
    await page.waitForTimeout(300);
    const sheetWidths = await page.evaluate(() => {
      const r = (id) => {
        const e = document.getElementById(id);
        return e ? e.getBoundingClientRect().width : 0;
      };
      return { list: r("midnight-character-sheet-list"), detail: r("midnight-character-sheet-detail"), box: r("midnight-character-sheet-box") };
    });
    assert(
      sheetWidths.detail > sheetWidths.list,
      "角色視窗：右側詳細欄比左側清單欄寬（改版前是 60/40，詳細比清單窄）",
      sheetWidths
    );

    await page.evaluate(() => {
      const m = document.getElementById("midnight-character-sheet-modal");
      if (m) m.hidden = true;
      const r = document.getElementById("midnight-reward-modal");
      if (r) r.hidden = false;
    });
    await page.waitForTimeout(300);
    const rewardWidths = await page.evaluate(() => {
      const r = (id) => {
        const e = document.getElementById(id);
        return e ? e.getBoundingClientRect().width : 0;
      };
      return { list: r("midnight-reward-list-wrap"), detail: r("midnight-reward-detail"), box: r("midnight-reward-box") };
    });
    assert(rewardWidths.detail > rewardWidths.list, "抽選視窗：右側詳細欄比左側清單欄寬", rewardWidths);
    await page.evaluate(() => {
      const r = document.getElementById("midnight-reward-modal");
      if (r) r.hidden = true;
    });

    // ------------------------------------------------------------------
    // ② 遺物效果抽選區塊不得超出角色視窗，且自己可捲動
    // 灌進大量候補卡片，確認：區塊高度不超過視窗、overflow-y 可捲、
    // 下方的清單/詳細兩欄仍然留得住高度（沒有被擠成 0）。
    // ------------------------------------------------------------------
    console.log("=== ② 遺物效果抽選區塊可捲動、不超出視窗 ===");
    const relicBlock = await page.evaluate(() => {
      const m = document.getElementById("midnight-character-sheet-modal");
      if (m) m.hidden = false;
      const block = document.getElementById("midnight-sheet-relic-learn-block");
      const cands = document.getElementById("midnight-character-sheet-relic-candidates");
      if (!block || !cands) return null;
      block.hidden = false;
      // 灌 12 張長卡片模擬「候補很多」的情況
      cands.innerHTML = "";
      for (let i = 0; i < 12; i++) {
        const d = document.createElement("div");
        d.textContent = "候補效果 " + (i + 1) + "：這是一段夠長的規則本文，用來把區塊撐高以驗證捲動行為是否正確。";
        cands.appendChild(d);
      }
      return true;
    });
    assert(!!relicBlock, "找得到遺物效果抽選區塊與候補容器");
    await page.waitForTimeout(300);
    const relicMetrics = await page.evaluate(() => {
      const g = (id) => document.getElementById(id);
      const block = g("midnight-sheet-relic-learn-block");
      const box = g("midnight-character-sheet-box");
      const split = g("midnight-character-sheet-split");
      const st = getComputedStyle(block);
      const br = block.getBoundingClientRect();
      const boxr = box.getBoundingClientRect();
      return {
        overflowY: st.overflowY,
        scrollable: block.scrollHeight > block.clientHeight + 1,
        blockBottom: br.bottom,
        boxBottom: boxr.bottom,
        viewportHeight: window.innerHeight,
        splitHeight: split.getBoundingClientRect().height,
      };
    });
    assert(relicMetrics.overflowY === "auto" || relicMetrics.overflowY === "scroll", "遺物效果區塊自己可以捲動（overflow-y）", relicMetrics);
    assert(relicMetrics.scrollable, "候補很多時該區塊確實產生了可捲動的內容（不是整個撐開）", relicMetrics);
    assert(relicMetrics.blockBottom <= relicMetrics.boxBottom + 1, "區塊沒有超出角色視窗的範圍", relicMetrics);
    assert(relicMetrics.blockBottom <= relicMetrics.viewportHeight + 1, "區塊沒有超出畫面", relicMetrics);
    assert(relicMetrics.splitHeight > 50, "下方的清單／詳細兩欄仍然保有高度（沒有被擠掉）", relicMetrics);

    // ------------------------------------------------------------------
    // ③ 角色視窗按鈕的間距
    // ------------------------------------------------------------------
    console.log("=== ③ 角色視窗按鈕間距 ===");
    const gaps = await page.evaluate(() => {
      const ids = [
        "midnight-character-sheet-relic-candidates",
        "midnight-character-sheet-skills",
        "midnight-character-sheet-arts",
        "midnight-character-sheet-abilities",
        "midnight-character-sheet-relics",
        "midnight-character-sheet-effects",
      ];
      const out = {};
      ids.forEach((id) => {
        const e = document.getElementById(id);
        if (!e) return;
        const st = getComputedStyle(e);
        out[id] = { display: st.display, gap: parseFloat(st.columnGap) || 0 };
      });
      // detail 欄裡的按鈕
      const detail = document.getElementById("midnight-character-sheet-detail");
      const b = document.createElement("button");
      b.textContent = "x";
      detail.appendChild(b);
      const bst = getComputedStyle(b);
      out.detailButton = { marginTop: parseFloat(bst.marginTop), marginRight: parseFloat(bst.marginRight), paddingLeft: parseFloat(bst.paddingLeft) };
      b.remove();
      return out;
    });
    Object.keys(gaps).forEach((id) => {
      if (id === "detailButton") return;
      assert(gaps[id].display === "flex" && gaps[id].gap > 0, `${id} 的項目之間有間距`, gaps[id]);
    });
    assert(gaps.detailButton.marginTop > 0 && gaps.detailButton.marginRight > 0, "詳細欄裡的按鈕有上／右間距", gaps.detailButton);
    assert(gaps.detailButton.paddingLeft > 0, "詳細欄裡的按鈕本身有內距", gaps.detailButton);
    await page.evaluate(() => {
      const m = document.getElementById("midnight-character-sheet-modal");
      if (m) m.hidden = true;
    });

    // ------------------------------------------------------------------
    // ④ 屬性／異常狀態顯示美化
    // ------------------------------------------------------------------
    console.log("=== ④ 屬性／異常狀態顯示 ===");
    const accum = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const GS = window.PriTestGameStorage;
      // 直接寫進 attributeAccum 的共用標靶 key，再叫一次 render（不需要真的打一場）
      const key = M._debugAttributeAccumTargetKey();
      await GS.rtSet(D.gameId, "cloud", "attributeAccum/" + key, { 炎: 4, 睡眠: 9, 出血: 16 });
      await new Promise((r) => setTimeout(r, 600));
      M._debugRenderAttributeAccumNote();
      const note = document.getElementById("midnight-attribute-accum-note");
      const chips = [...note.querySelectorAll(".midnight-accum-chip")].map((c) => {
        const st = getComputedStyle(c);
        return {
          text: c.textContent,
          color: st.color,
          borderColor: st.borderTopColor,
          pct: c.style.getPropertyValue("--accum-pct"),
          hasIcon: !!c.querySelector(".midnight-accum-chip-icon"),
          hasValue: !!c.querySelector(".midnight-accum-chip-value"),
        };
      });
      return { chips, threshold: M._debugAttributeStatusThreshold() };
    });
    assert(accum.chips.length === 3, "3 種蓄積各自渲染成一枚徽章", accum.chips);
    assert(
      accum.chips.every((c) => c.hasIcon && c.hasValue),
      "每一枚徽章都有屬性符號與「目前值/門檻」數字",
      accum.chips
    );
    assert(
      new Set(accum.chips.map((c) => c.color)).size === accum.chips.length,
      "不同屬性／異常用不同顏色（改版前全部是同一種黃字）",
      accum.chips.map((c) => c.color)
    );
    assert(
      accum.chips.some((c) => c.text.indexOf("/" + accum.threshold) !== -1),
      `數字顯示成「目前值/${accum.threshold}」`,
      accum.chips
    );
    assert(
      accum.chips.every((c) => parseFloat(c.pct) > 0),
      "每一枚徽章都帶有進度條百分比（--accum-pct）",
      accum.chips
    );

    // ------------------------------------------------------------------
    // ⑤ 戰鬥按鈕跑馬燈
    // ------------------------------------------------------------------
    console.log("=== ⑤ 戰鬥按鈕跑馬燈 ===");
    const marquee = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const btn = document.getElementById("btn-midnight-skill");
      btn.hidden = false;
      const label = document.getElementById("midnight-skill-a-label");
      // 短文字：不該掛跑馬燈
      M._debugSetCombatButtonLabel(label, "攻擊");
      const shortState = {
        hasClass: label.classList.contains("midnight-marquee"),
        anim: getComputedStyle(label.firstElementChild).animationName,
      };
      // 長文字：必須掛上跑馬燈，且位移量為負（往左跑）、時間有依長度換算
      M._debugSetCombatButtonLabel(label, "戰技(非常非常長的魔術名稱測試用字串ABCDEFG)");
      const inner = label.firstElementChild;
      const longState = {
        hasClass: label.classList.contains("midnight-marquee"),
        anim: getComputedStyle(inner).animationName,
        direction: getComputedStyle(inner).animationDirection,
        iteration: getComputedStyle(inner).animationIterationCount,
        shift: inner.style.getPropertyValue("--mq-shift"),
        duration: inner.style.getPropertyValue("--mq-duration"),
        title: label.title,
        overflowHidden: getComputedStyle(label).overflow,
      };
      return { shortState, longState };
    });
    assert(!marquee.shortState.hasClass, "短文字不掛跑馬燈（不會無謂地動來動去）", marquee.shortState);
    assert(marquee.longState.hasClass, "長文字掛上跑馬燈", marquee.longState);
    assert(marquee.longState.anim === "midnight-marquee-bounce", "跑馬燈動畫確實生效", marquee.longState);
    assert(marquee.longState.direction === "alternate", "動畫方向是 alternate＝來回跑（不是單向循環）", marquee.longState);
    assert(marquee.longState.iteration === "infinite", "跑馬燈持續循環", marquee.longState);
    assert(parseFloat(marquee.longState.shift) < 0, "位移量是負值（文字往左跑出被截掉的部分）", marquee.longState);
    assert(parseFloat(marquee.longState.duration) >= 2.4, "動畫時間依文字長度換算、且不短於下限", marquee.longState);
    assert(marquee.longState.title.length > 0, "完整文字仍保留在 title（hover 可看）", marquee.longState);
    assert(marquee.longState.overflowHidden === "hidden", "外層仍然是裁切視窗，文字不會跑出按鈕", marquee.longState);

    // ------------------------------------------------------------------
    // ⑥ 異常狀態命中特效
    // ------------------------------------------------------------------
    console.log("=== ⑥ 異常狀態命中特效 ===");
    const ailment = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const fx = document.getElementById("midnight-enemy-ailment-effect");
      const mark = document.getElementById("midnight-enemy-ailment-mark");
      if (!fx) return null;
      const out = { exists: true, beforeHidden: fx.hidden };
      // 沒有 activeEncounter 時不該觸發（跟刀光同一個守衛）
      M._debugTriggerEnemyAilmentEffect("炎");
      out.withoutEncounterHidden = fx.hidden;
      // 模擬戰鬥中
      M._debugSetActiveEncounterForFx(true);
      M._debugTriggerEnemyAilmentEffect("炎");
      const fireColor = fx.style.getPropertyValue("--ailment-color");
      out.fire = { hidden: fx.hidden, color: fireColor, mark: mark ? mark.textContent : null, anim: getComputedStyle(fx).animationName };
      M._debugTriggerEnemyAilmentEffect("凍傷");
      out.frost = { color: fx.style.getPropertyValue("--ailment-color"), mark: mark ? mark.textContent : null };
      M._debugSetActiveEncounterForFx(false);
      return out;
    });
    assert(!!ailment, "敵人圖片上有異常狀態特效層（#midnight-enemy-ailment-effect）");
    if (ailment) {
      assert(ailment.withoutEncounterHidden, "不在戰鬥中（沒有 activeEncounter）時不觸發特效", ailment);
      assert(!ailment.fire.hidden, "戰鬥中施加屬性／異常時特效會顯示", ailment.fire);
      assert(ailment.fire.anim === "midnight-enemy-ailment-burst", "特效動畫確實生效", ailment.fire);
      assert(!!ailment.fire.mark, "特效中央有屬性符號", ailment.fire);
      assert(
        ailment.fire.color && ailment.frost.color && ailment.fire.color !== ailment.frost.color,
        "不同異常狀態用不同顏色（炎 vs 凍傷）",
        ailment
      );
      assert(ailment.fire.mark !== ailment.frost.mark, "不同異常狀態用不同符號", ailment);
    }

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
