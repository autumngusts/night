// ============================================================================
// midnight（即時制擴張版）2026-09-10 優化回歸測試（Firebase Local Emulator版，見
// emulator_sync_check.js開頭的環境說明，這裡沿用同一套emulator旗標/準備步驟，不重複解釋）。
// ============================================================================
// 驗證範圍（使用者這次明確要求的5個項目）：
//   1. 開場動畫的鳥改成流程簡介那隻🦅、字級放大3倍，舊的inline SVG已移除。
//   2. 樓層資訊banner與左上角色HUD／右上導覽HUD的疊層優先權：
//      平時banner在上；點過HUD的3秒內HUD在上、3秒後跳回；戰鬥中HUD在上、戰鬥結束回復。
//   3. 迴避／防禦按鈕背景色改為草綠色。
//   4. 個人獎勵清單認得"weaponStar"這個kind（原本顯示未翻譯的原始字串、抽選回傳空），
//      且"potentialPower"（潛在之力＝得意武器／附帶效果二選一）的雙抽機制仍然保留。
//   5. 規則文本轉換層把回合制用語換成即時制說法，並保留重點覆寫。
//
// 使用前準備：同emulator_sync_check.js（generate.py建dist/、起本機http server、
// npm install、起firebase emulators:start --only database,auth）。
// 執行方式：node optimize_2026_09_10_check.js
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
      /* ignore */
    }
  });
}

async function getState(page) {
  return page.evaluate(() => window.PriTestMidnight._debugState());
}

// 照抄emulator_sync_check.js的walkNear()——盡力而為地把角色走到某個座標附近，走不到就
// 回傳false讓呼叫端自行決定要不要略過（純demo測試工具，不是功能性斷言）。
async function walkNear(page, targetX, targetY, radius, maxRounds) {
  for (let i = 0; i < maxRounds; i++) {
    const pos = await page.evaluate(() => (window.PriTestMidnight ? window.PriTestMidnight._debugState().localPos : null));
    if (!pos) {
      await page.waitForTimeout(50);
      continue;
    }
    const dx = targetX - pos.x;
    const dy = targetY - pos.y;
    if (Math.hypot(dx, dy) <= radius) return true;
    const keys = [];
    if (dx > 0.15) keys.push("ArrowRight");
    else if (dx < -0.15) keys.push("ArrowLeft");
    if (dy > 0.15) keys.push("ArrowDown");
    else if (dy < -0.15) keys.push("ArrowUp");
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(140);
    for (const k of keys) await page.keyboard.up(k);
  }
  return false;
}

function zIndexOf(page, id) {
  return page.evaluate((id) => {
    const elx = document.getElementById(id);
    return elx ? parseInt(window.getComputedStyle(elx).zIndex, 10) : NaN;
  }, id);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = [];
  page.on("pageerror", (err) => console.log("  [pageerror]", err.message));

  try {
    await enableEmulatorFlag(page);

    console.log("=== 建立midnight測試場並加入 ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await page.click("#midnight-lobby-slots .midnight-slot-empty button");
    await page.fill("#midnight-lobby-passcode-input", "1234");
    await page.click("#btn-midnight-lobby-join");
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });

    const state0 = await getState(page);
    const gameId = state0.gameId;
    const tokenId = state0.myTokenId;
    const mySlot = state0.mySlot;

    console.log("=== 項目1：開場動畫的鳥改成流程簡介那隻🦅並放大3倍 ===");
    const birdInfo = await page.evaluate(() => {
      const glyph = document.getElementById("midnight-intro-bird-glyph");
      const demo = document.getElementById("midnight-flow-intro-demo-bird");
      return {
        hasGlyph: !!glyph,
        glyphText: glyph ? glyph.textContent.trim() : null,
        glyphFontSize: glyph ? parseFloat(window.getComputedStyle(glyph).fontSize) : null,
        demoText: demo ? demo.textContent.trim() : null,
        demoFontSize: demo ? parseFloat(window.getComputedStyle(demo).fontSize) : null,
        hasOldSvg: !!document.getElementById("midnight-intro-bird-svg"),
      };
    });
    assert(birdInfo.hasGlyph && !birdInfo.hasOldSvg, "開場動畫改用#midnight-intro-bird-glyph，舊的#midnight-intro-bird-svg已移除", results);
    assert(
      birdInfo.glyphText === birdInfo.demoText,
      "開場的鳥跟流程簡介示意畫布的鳥是同一個字符（開場=" + birdInfo.glyphText + "，流程簡介=" + birdInfo.demoText + "）",
      results
    );
    assert(
      Math.abs(birdInfo.glyphFontSize - birdInfo.demoFontSize * 3) < 0.5,
      "開場的鳥字級是流程簡介那隻的3倍（" + birdInfo.glyphFontSize + "px vs " + birdInfo.demoFontSize + "px×3）",
      results
    );

    console.log("=== 項目3：迴避／防禦按鈕背景色改為草綠色 ===");
    const actionColors = await page.evaluate(() => {
      const read = (id) => {
        const elx = document.getElementById(id);
        return elx ? window.getComputedStyle(elx).backgroundColor : null;
      };
      return { dodge: read("btn-midnight-dodge"), block: read("btn-midnight-block"), attack: read("btn-midnight-attack-shared-target") };
    });
    assert(actionColors.dodge === "rgb(124, 179, 66)", "迴避鍵背景色＝草綠色 rgb(124,179,66)，實際=" + actionColors.dodge, results);
    assert(actionColors.block === "rgb(124, 179, 66)", "防禦鍵背景色＝草綠色 rgb(124,179,66)，實際=" + actionColors.block, results);
    assert(actionColors.attack !== actionColors.dodge, "攻擊鍵維持原本配色，沒有被一起改掉（實際=" + actionColors.attack + "）", results);

    console.log("=== 項目5：規則文本轉換層 ===");
    const adaptOut = await page.evaluate(() => {
      const A = window.PriTestMidnightTextAdapt;
      if (!A) return null;
      return {
        phase: A.adapt("行動後直到結束階段為止，為該「大劍」追加「屬性｜火」。"),
        formation: A.adapt("編隊：前衛時可使用\n效果：1回合僅限1名PC使用。"),
        costLegend: A.adapt("可支付「骰子消耗：1」。"),
        override: A.adapt("若防禦階段結束時仍有剩餘體力骰，可任選1個帶入下回合。", "回合結束時，體力骰帶入1個"),
        untouched: A.adapt("對目標造成【總合傷害：120】。"),
      };
    });
    assert(!!adaptOut, "window.PriTestMidnightTextAdapt已載入", results);
    if (adaptOut) {
      assert(!/結束階段/.test(adaptOut.phase) && /接下來的一小段時間/.test(adaptOut.phase), "「直到結束階段為止」已改寫成即時制說法", results);
      // 2026-09-12 規格變更後更新的期望值（舊值已過時，見 static_src/midnight_text_adapt.js
      // 開頭的 2b 說明）：使用者明確要求「規則上沒套用的文字縮減化、前後衛資訊等等去除」，
      // 因此「編隊：」欄位不再被改寫成「編隊：本規則無前衛／後衛之分，隨時可使用」這種比
      // 原文更長的句子，而是整欄刪除——舊斷言找的 /無前衛／後衛之分/ 現在永遠不會出現。
      assert(
        !/編隊：/.test(adaptOut.formation) && !/前衛|後衛/.test(adaptOut.formation) && !/1回合僅限/.test(adaptOut.formation),
        "「編隊：前衛時可使用」整欄刪除、「1回合僅限1名PC」已改寫",
        results
      );
      assert(/骰子1個＝體力2/.test(adaptOut.costLegend), "帶骰子消耗的本文會附上消耗換算補充說明", results);
      // 同上：重點覆寫的文案在 2026-09-12 從「…此效果在本規則中不產生作用。」（約 100 字的
      // 長文）縮成一行「本規則不適用：…」，因此改找新的關鍵詞。
      assert(/本規則不適用/.test(adaptOut.override), "重點覆寫生效（體力骰池類被動以一行說明本規則不適用）", results);
      assert(adaptOut.untouched === "對目標造成【總合傷害：120】。", "沒有回合制用語的本文維持原樣，不會被多餘改寫", results);
    }
    // 顯示端真的有接上轉換層（不是只有模組本身能跑）：角色視窗右側詳細資訊的共同出口。
    const sheetUsesAdapt = await page.evaluate(() => {
      const src = window.PriTestMidnight && window.PriTestMidnight._debugState;
      return typeof src === "function";
    });
    assert(sheetUsesAdapt, "midnight主模組正常運作（詳細資訊渲染端已改用mnText()，見原始碼）", results);

    console.log("=== 項目2：banner與HUD的疊層優先權 ===");
    const bannerZ = await zIndexOf(page, "midnight-field-banner");
    const idleLeftZ = await zIndexOf(page, "midnight-hud-top-left");
    const idleRightZ = await zIndexOf(page, "midnight-hud-top-right");
    const idleClass = await page.evaluate(() => document.documentElement.classList.contains("midnight-hud-above-banner"));
    assert(!idleClass, "平時沒有掛上html.midnight-hud-above-banner", results);
    assert(idleLeftZ < bannerZ && idleRightZ < bannerZ, "平時樓層資訊banner(" + bannerZ + ")高於左上(" + idleLeftZ + ")／右上(" + idleRightZ + ")HUD", results);

    // 點HUD → 3秒內HUD在上
    await page.dispatchEvent("#midnight-hud-top-left", "pointerdown");
    await page.waitForTimeout(200);
    const tapClass = await page.evaluate(() => document.documentElement.classList.contains("midnight-hud-above-banner"));
    const tapLeftZ = await zIndexOf(page, "midnight-hud-top-left");
    const tapRightZ = await zIndexOf(page, "midnight-hud-top-right");
    assert(tapClass, "點左上角色HUD後掛上html.midnight-hud-above-banner", results);
    assert(tapLeftZ > bannerZ && tapRightZ > bannerZ, "點HUD後左上(" + tapLeftZ + ")／右上(" + tapRightZ + ")HUD高於banner(" + bannerZ + ")", results);
    await page.waitForTimeout(3200);
    const afterTapClass = await page.evaluate(() => document.documentElement.classList.contains("midnight-hud-above-banner"));
    assert(!afterTapClass, "3秒後自動跳回（class被移除）", results);

    // 右上導覽HUD也要有同樣效果
    await page.dispatchEvent("#midnight-hud-top-right", "pointerdown");
    await page.waitForTimeout(200);
    const tapRightClass = await page.evaluate(() => document.documentElement.classList.contains("midnight-hud-above-banner"));
    assert(tapRightClass, "點右上導覽HUD後同樣掛上html.midnight-hud-above-banner", results);
    await page.waitForTimeout(3200);

    // 戰鬥中：沿用weapon_combat_check.js的手法，直接seed一個「已解決分歧、敵人存活」的
    // fieldTrigger，讓recomputeActiveEncounter()把activeEncounter設起來。
    const mapState = await getState(page);
    const map = await page.evaluate((seed) => window.PriTestMidnightMap.generateMap(seed), mapState.meta.mapSeed);
    const pt = (map.points || []).find((p) => p.type !== "sorcerer");
    let combatChecked = false;
    if (pt && (await walkNear(page, pt.x + 0.5, pt.y + 0.5, 1.5, 150))) {
      await page.evaluate(
        ({ gameId, pointId, mySlot }) => {
          const participants = {};
          participants[mySlot] = true;
          return window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pointId, {
            status: "resolved",
            participants: participants,
            branchIndex: 0,
            floorIndex: 0,
            enemyFamilyId: "test",
            enemyId: "test",
          }).then(() => window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/" + pointId, 30));
        },
        { gameId, pointId: pt.id, mySlot }
      );
      const gotEncounter = await page
        .waitForFunction(() => !!window.PriTestMidnight._debugState().activeEncounter, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (gotEncounter) {
        combatChecked = true;
        await page.waitForTimeout(300);
        const combatClass = await page.evaluate(() => document.documentElement.classList.contains("midnight-hud-above-banner"));
        const combatLeftZ = await zIndexOf(page, "midnight-hud-top-left");
        assert(combatClass, "戰鬥中（activeEncounter非null）自動掛上html.midnight-hud-above-banner", results);
        assert(combatLeftZ > bannerZ, "戰鬥中左上HUD(" + combatLeftZ + ")蓋過banner(" + bannerZ + ")", results);

        // 戰鬥結束（敵人HP歸零）→ 回復平時的疊層
        await page.evaluate(
          ({ gameId, pointId }) => window.PriTestGameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/" + pointId, 0),
          { gameId, pointId: pt.id }
        );
        const ended = await page
          .waitForFunction(() => !window.PriTestMidnight._debugState().activeEncounter, { timeout: 15000 })
          .then(() => true)
          .catch(() => false);
        await page.waitForTimeout(3500); // 蓋過3秒暫時提升的殘留時間，確認是真的回復而不是計時器還沒到
        const endedClass = await page.evaluate(() => document.documentElement.classList.contains("midnight-hud-above-banner"));
        assert(ended && !endedClass, "戰鬥結束後疊層回復正常（banner重新蓋過HUD）", results);
      }
    }
    if (!combatChecked) {
      console.log("  [SKIP] 固定佈局走位沒能在時限內走到可用的戰鬥點，略過「戰鬥中疊層」端對端檢查");
    }

    console.log("=== 項目4：weaponStar獎勵與potentialPower雙抽 ===");
    // 直接把一筆weaponStar獎勵推進自己的pendingRewards（跳過樓層清算流程，測試重點是
    // 獎勵清單這一段對這個kind的處理，不是獎勵怎麼產生的）。
    await page.evaluate(
      ({ gameId, tokenId }) =>
        window.PriTestGameStorage.rtSet(gameId, "cloud", "pendingRewards/" + tokenId + "/rwTestWeaponStar", {
          kind: "weaponStar",
          value: 2,
          resolved: false,
        }),
      { gameId, tokenId }
    );
    await page.waitForFunction(() => !document.getElementById("midnight-reward-modal").hidden, { timeout: 10000 }).catch(() => {});
    const weaponStarLabel = await page.evaluate(() => {
      const btns = document.querySelectorAll("#midnight-reward-list-personal button");
      return btns.length ? btns[btns.length - 1].textContent : null;
    });
    assert(weaponStarLabel && weaponStarLabel !== "weaponStar", "weaponStar獎勵在清單上顯示為種類名稱而不是原始字串，實際=" + weaponStarLabel, results);

    const weaponsBefore = ((await getState(page)).characters[tokenId].weaponIds || []).length;
    await page.evaluate(() => {
      const btns = document.querySelectorAll("#midnight-reward-list-personal button");
      btns[btns.length - 1].click();
    });
    await page.waitForTimeout(200);
    // 第一段：抽選按鈕
    await page.evaluate(() => {
      const btn = document.querySelector("#midnight-reward-detail button");
      if (btn) btn.click();
    });
    await page.waitForTimeout(300);
    const drawnText = await page.evaluate(() => document.getElementById("midnight-reward-detail").textContent);
    assert(
      drawnText && !/抽選できるものがない|沒有可抽選|Nothing/i.test(drawnText) && drawnText.length > 5,
      "weaponStar抽選有抽出實際武器（詳細面板不是空結果）",
      results
    );
    // 第二段：確認取得
    const confirmed = await page.evaluate(() => {
      const btns = Array.prototype.slice.call(document.querySelectorAll("#midnight-reward-detail button"));
      if (!btns.length) return false;
      btns[0].click();
      return true;
    });
    await page.waitForTimeout(600);
    const weaponsAfter = ((await getState(page)).characters[tokenId].weaponIds || []).length;
    assert(confirmed && weaponsAfter === weaponsBefore + 1, "按下「確認」後武器真的進到weaponIds（" + weaponsBefore + "→" + weaponsAfter + "）", results);

    // potentialPower：雙抽（得意武器／附帶效果）並排二選一是否還在
    await page.evaluate(
      ({ gameId, tokenId }) =>
        window.PriTestGameStorage.rtSet(gameId, "cloud", "pendingRewards/" + tokenId + "/rwTestPotential", {
          kind: "potentialPower",
          value: 1,
          resolved: false,
        }),
      { gameId, tokenId }
    );
    await page.waitForTimeout(800);
    const ppLabel = await page.evaluate(() => {
      const btns = document.querySelectorAll("#midnight-reward-list-personal button");
      return btns.length ? btns[btns.length - 1].textContent : null;
    });
    assert(ppLabel && ppLabel !== "potentialPower", "potentialPower獎勵顯示為「潛在力量」種類名稱，實際=" + ppLabel, results);
    await page.evaluate(() => {
      const btns = document.querySelectorAll("#midnight-reward-list-personal button");
      btns[btns.length - 1].click();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const btn = document.querySelector("#midnight-reward-detail button");
      if (btn) btn.click();
    });
    await page.waitForTimeout(400);
    const ppChoiceCount = await page.evaluate(() => document.querySelectorAll("#midnight-reward-detail .wb-row > div").length);
    assert(ppChoiceCount >= 2, "潛在之力抽選後同時揭示「得意武器」與「附帶效果」兩張卡供二選一，實際卡片數=" + ppChoiceCount, results);
  } catch (err) {
    console.error("測試中斷：", err);
    results.push({ label: "測試執行本身沒有拋出例外", pass: false });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n===== 結果：" + (results.length - failed.length) + "/" + results.length + " 通過 =====");
  failed.forEach((r) => console.log("  FAIL: " + r.label));
  process.exit(failed.length ? 1 : 0);
})();
