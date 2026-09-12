// ============================================================================
// midnight（即時制擴張版）Q 板塊未解鎖提示的顯示位置 回歸測試
// （Playwright ＋ Firebase Local Emulator）。
// ============================================================================
// 對應 2026-09-12 使用者明確規格：
//   「進入Q板塊若出現還沒資格挑戰的出現文字『你沒資格…』，文字要出現在樓層資訊的
//     banner，不在背景上顯示」
//
// 改版前：updateNearbyFieldPoint() 把未解鎖的 Q 點整個排除在 nearbyFieldPoint 之外，
// 並用 showToast() 顯示那句話——那是浮在地圖背景上的提示，而且上方資訊欄整個空白，
// 玩家靠近 Q 時看不出這個點是什麼、也不知道為什麼沒有「進入」按鍵。
// 改版後：Q 點照常成為 nearbyFieldPoint，#midnight-field-enter-prompt（上方資訊欄，
// TOP_BANNER_IDS 之一）顯示地點名稱＋#midnight-field-enter-note 的黃字說明，
// 並隱藏「進入」按鍵。
//
// 使用前準備（跟 emulator_sync_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node hazard_q_locked_banner_check.js
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

// 直接改寫 localPos 當傳送（見 field_multiplayer_floor_check.js 同一則說明）。
async function teleport(page, x, y) {
  await page.evaluate(
    (p) => {
      const pos = window.PriTestMidnight._debugState().localPos;
      pos.x = p.x;
      pos.y = p.y;
    },
    { x, y }
  );
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror] " + e.message));

  try {
    await enableEmulatorFlag(page);
    console.log("=== 建立 midnight 測試場（連本機 emulator） ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    // Q（地變）板塊只存在於「完整版」的 4 張新地圖（有橘線 hazardZone 的那幾張），
    // 預設的 basic 地圖整張都不會生成 hazard_q 點。等待房的地圖選單要先切到 full，
    // 而且必須在按下「準備完成」之前切（開局那一刻才會依 meta.mapVariant 產生地圖）。
    await page.selectOption("#midnight-lobby-map-variant-select", "full");
    await page.waitForTimeout(600);
    await joinLobby(page, "1234");
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });

    const qPoints = await page.evaluate(() =>
      (window.PriTestMidnight._debugState().map.points || []).filter((p) => p.type === "hazard_q")
    );
    assert(qPoints.length > 0, "地圖上有 Q（地變）板塊點", { n: qPoints.length });
    if (!qPoints.length) throw new Error("no hazard_q point on this map");
    const q = qPoints[0];

    console.log("=== 開局時 Q 尚未解鎖（同區域的卡4／可怖強敵都還沒踏破）===");
    // 先把 toast 清空，之後才能確認「這次靠近沒有再用 toast 顯示那句話」。
    await page.evaluate(() => {
      const t = document.getElementById("midnight-toast");
      if (t) {
        t.textContent = "";
        t.hidden = true;
      }
    });

    await teleport(page, q.x + 0.5, q.y + 0.5);

    const view = await page.evaluate((id) => {
      const D = window.PriTestMidnight._debugState();
      const hidden = (elId) => {
        const e = document.getElementById(elId);
        return !e || e.hidden;
      };
      const text = (elId) => {
        const e = document.getElementById(elId);
        return e ? e.textContent : null;
      };
      return {
        nearbyIsQ: !!(D.nearbyFieldPoint && D.nearbyFieldPoint.id === id),
        enterPromptVisible: !hidden("midnight-field-enter-prompt"),
        enterNoteVisible: !hidden("midnight-field-enter-note"),
        enterNoteText: text("midnight-field-enter-note"),
        enterNameText: text("midnight-field-enter-name"),
        enterButtonHidden: hidden("btn-midnight-field-enter"),
        toastVisible: !hidden("midnight-toast"),
        toastText: text("midnight-toast"),
        lockedText: window.I18N.t("midnight_hazard_q_locked_note"),
      };
    }, q.id);

    assert(view.nearbyIsQ, "未解鎖的 Q 點照樣會成為 nearbyFieldPoint（改版前是整個被排除）", view);
    assert(view.enterPromptVisible, "上方資訊欄（#midnight-field-enter-prompt）有顯示出來", view);
    assert(view.enterNoteVisible, "鎖定說明顯示在上方資訊欄裡（#midnight-field-enter-note）", view);
    assert(view.enterNoteText === view.lockedText, "說明文字就是「你沒資格…」那一句", view);
    assert(!!view.enterNameText, "同時看得到這個 Q 板塊的地點名稱", view);
    assert(view.enterButtonHidden, "未解鎖時不給「進入」按鍵", view);
    assert(!view.toastVisible || view.toastText !== view.lockedText, "那句話不再用背景 toast 顯示", view);

    // 進入閘門的第二道防線：即使直接呼叫 handler 也不能建立 fieldTrigger。
    console.log("=== 直接呼叫進入 handler 也必須被擋下 ===");
    await page.evaluate(() => {
      const btn = document.getElementById("btn-midnight-field-enter");
      if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForTimeout(1200);
    const trigAfter = await page.evaluate((id) => (window.PriTestMidnight._debugState().fieldTriggers || {})[id] || null, q.id);
    assert(!trigAfter, "未解鎖的 Q 不會被建立 fieldTrigger（進不去）", trigAfter);

    // 解鎖後：說明消失、按鍵回來。hazardQUnlocked() 只看「同區域的 hazardMember 點是否
    // 已踏破」，這裡直接把其中一個標記成已全踏破來模擬。
    console.log("=== 解鎖後（同區域已踏破 1 個）===");
    const unlocked = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const GS = window.PriTestGameStorage;
      const D = M._debugState();
      const member = (D.map.points || []).filter((p) => p.hazardMember)[0];
      if (!member) return null;
      await GS.rtSet(D.gameId, "cloud", "fieldProgress/" + member.id, { branchIndex: 0, floorIndex: 9, cleared: true });
      return member.id;
    });
    if (unlocked) {
      const ok = await page
        .waitForFunction(() => {
          const note = document.getElementById("midnight-field-enter-note");
          const btn = document.getElementById("btn-midnight-field-enter");
          return !!(note && note.hidden && btn && !btn.hidden);
        }, null, { timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      assert(ok, "解鎖後鎖定說明收起、「進入」按鍵恢復");
    } else {
      console.log("    （這張地圖沒有 hazardMember 點，略過解鎖後的檢查）");
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
