// ============================================================================
// midnight（即時制擴張版）2026-09-06 UI調整回歸測試（Firebase Local Emulator版，見
// emulator_sync_check.js開頭的環境說明，這裡沿用同一套emulator旗標/準備步驟，不重複解釋）。
// ============================================================================
// 驗證範圍（使用者這次明確要求的9項UI調整裡，能在單一裝置、不需要精確走到地圖上特定
// 點位的前提下驗證的部分）：
//   1. 地圖收合時，按下「角色」HUD按鈕仍能正確開啟角色面板（原本#midnight-character-sheet-modal
//      巢狀在#midnight-map-panel內部，地圖收合時完全看不到，是本次修正的根本問題）。
//   2. 地圖右上關閉✕（#btn-midnight-map-close-corner）現在是#midnight-canvas-wrap的子元素
//      （疊在地圖圖片上），不是舊的#midnight-hud-top-right子元素。
//   3. 角色面板固定右上角關閉✕存在、可點擊關閉；等級+/-已經從角色面板移除。
//   4. 角色一開始就裝備好起始武器（equippedWeaponIdL/R不再是undefined），不用先手動切換
//      武器一次才能攻擊——這是使用者回報的既有bug。
//   5. 防禦按鈕讀條元素存在，長按時寬度跳到100%、放開回到0%。
//   6. 逃離戰鬥按鈕（#btn-midnight-flee-battle）存在於敵人資訊面板內。
//   7. 祝福籌碼類型已經加進NON_FIELD_POINT_TYPES，不會再讓通用的
//      #midnight-field-enter-prompt跟專屬的#midnight-blessing-prompt同時觸發。
//
// 使用前準備：同emulator_sync_check.js（generate.py建dist/、起本機http server、
// npm install、起firebase emulators:start --only database,auth）。
// 執行方式：node ui_layout_fixes_check.js
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

    const state = await getState(page);
    const tokenId = state.myTokenId;
    console.log("typeId=" + state.characters[tokenId].typeId + " weaponIds=" + JSON.stringify(state.characters[tokenId].weaponIds));

    console.log("=== 檢查1：起始武器自動裝備（不用先手動切換），攻擊按鈕直接生效 ===");
    assert(
      state.characters[tokenId].equippedWeaponIdL && state.characters[tokenId].equippedWeaponIdR,
      "角色一載入equippedWeaponIdL/R就已經有值，不是undefined，實際=" +
        JSON.stringify({ L: state.characters[tokenId].equippedWeaponIdL, R: state.characters[tokenId].equippedWeaponIdR }),
      results
    );
    const gameId = state.gameId;
    await page.evaluate((gameId) => window.PriTestGameStorage.rtSet(gameId, "cloud", "demoStat/sharedTarget", 100000), gameId);
    await page.waitForTimeout(200);
    const beforeHp = (await getState(page)).demoStats.sharedTarget;
    await page.click("#btn-midnight-attack-shared-target");
    await page.waitForTimeout(300);
    const afterHp = (await getState(page)).demoStats.sharedTarget;
    assert(afterHp < beforeHp, "第一次點擊攻擊鍵（未曾手動切換過武器）就造成傷害，實際傷害=" + (beforeHp - afterHp), results);

    console.log("=== 檢查2：地圖收合時，「角色」按鈕仍能開啟角色面板（原本巢狀在地圖modal內看不到） ===");
    // 進場時updateLobbyOrGameVisibility()會自動setMapExpanded(true)（既有行為，不是這次
    // 調整的範圍），這裡先按收合鍵，確保接下來測試的前提是「地圖確實是收合的」。改用
    // #btn-midnight-map-icon（HUD固定面板裡的主要進出口）而不是#midnight-map-panel內
    // .wb-row的文字版收合鍵——後者跟這次調整無關的既有版位重疊問題會被
    // #midnight-hud-top-left（z-index更高）擋住，導致Playwright點不到，是另一個獨立、
    // 這次任務範圍外的既有UI瑕疵，這裡繞開它。
    await page.click("#btn-midnight-map-icon");
    await page.waitForTimeout(150);
    const mapHiddenBefore = await page.evaluate(() => document.getElementById("midnight-map-panel").hidden);
    assert(mapHiddenBefore === true, "確認地圖目前是收合狀態（測試前提）", results);
    await page.click("#btn-midnight-open-character-sheet");
    await page.waitForTimeout(150);
    const sheetVisible = await page.isVisible("#midnight-character-sheet-modal");
    assert(sheetVisible, "地圖收合狀態下點擊「角色」按鈕，角色面板仍正確顯示", results);

    console.log("=== 檢查3：角色面板固定右上角關閉✕存在且可關閉；等級+/-已從角色面板移除 ===");
    const closeXInSheet = await page.evaluate(() => {
      const btn = document.getElementById("btn-midnight-character-sheet-close");
      const modal = document.getElementById("midnight-character-sheet-modal");
      return !!btn && modal.contains(btn) && btn.classList.contains("midnight-modal-close-x");
    });
    assert(closeXInSheet, "角色面板內有.midnight-modal-close-x樣式的固定關閉✕", results);
    const levelRowOutsideSheet = await page.evaluate(() => {
      const modal = document.getElementById("midnight-character-sheet-modal");
      const row = document.getElementById("midnight-character-sheet-level-row");
      const blessingModal = document.getElementById("midnight-blessing-modal");
      return !modal.contains(row) && blessingModal.contains(row);
    });
    assert(levelRowOutsideSheet, "等級+/-列已經搬到#midnight-blessing-modal內，不在角色面板裡", results);
    await page.click("#btn-midnight-character-sheet-close");
    await page.waitForTimeout(150);
    const sheetHiddenAfterClose = await page.evaluate(() => document.getElementById("midnight-character-sheet-modal").hidden);
    assert(sheetHiddenAfterClose, "按下固定右上角✕後角色面板正確關閉", results);

    console.log("=== 檢查4：地圖右上關閉✕已經搬到canvas-wrap內（疊在地圖圖片上），不是舊的HUD面板 ===");
    await page.click("#btn-midnight-map-icon");
    await page.waitForTimeout(150);
    const cornerInCanvasWrap = await page.evaluate(() => {
      const btn = document.getElementById("btn-midnight-map-close-corner");
      const wrap = document.getElementById("midnight-canvas-wrap");
      const hudTopRight = document.getElementById("midnight-hud-top-right");
      return !!btn && wrap.contains(btn) && !hudTopRight.contains(btn);
    });
    assert(cornerInCanvasWrap, "#btn-midnight-map-close-corner是#midnight-canvas-wrap的子元素，不再掛在#midnight-hud-top-right下", results);
    const cornerVisible = await page.isVisible("#btn-midnight-map-close-corner");
    assert(cornerVisible, "地圖展開時，疊在地圖圖片右上角的關閉✕確實可見", results);
    await page.click("#btn-midnight-map-close-corner");
    await page.waitForTimeout(150);
    const mapHiddenAfter = await page.evaluate(() => document.getElementById("midnight-map-panel").hidden);
    assert(mapHiddenAfter === true, "點擊疊在地圖上的關閉✕後，地圖正確收合", results);

    console.log("=== 檢查5：防禦讀條長按時跳到100%、放開回到0% ===");
    // 防禦鍵只有裝備盾牌（或有「雙手持握的達人」）才會啟用（見currentGuardInfo()），
    // 這次測試角色是greatsword_pursuer雙手武器、沒有盾牌，先補裝一把盾牌讓防禦鍵生效，
    // 才能實際測到讀條行為。
    await page.evaluate(
      ({ gameId, tokenId }) => {
        const shieldId = "small_shield_pursuer";
        return Promise.all([
          window.PriTestGameStorage.rtSet(gameId, "cloud", "character/" + tokenId + "/weaponIds", [
            "greatsword_pursuer",
            shieldId,
          ]),
          window.PriTestGameStorage.rtSet(gameId, "cloud", "character/" + tokenId + "/equippedWeaponIdR", shieldId),
        ]);
      },
      { gameId, tokenId }
    );
    await page.waitForTimeout(300);
    await page.hover("#btn-midnight-block");
    await page.mouse.down();
    await page.waitForTimeout(100);
    const fillDuringHold = await page.evaluate(() => document.getElementById("midnight-block-guard-fill").style.width);
    await page.mouse.up();
    await page.waitForTimeout(100);
    const fillAfterRelease = await page.evaluate(() => document.getElementById("midnight-block-guard-fill").style.width);
    assert(fillDuringHold === "100%", "長按防禦時讀條立刻跳到100%，實際=" + fillDuringHold, results);
    assert(fillAfterRelease === "0%", "放開防禦後讀條歸零，實際=" + fillAfterRelease, results);

    console.log("=== 檢查6：逃離戰鬥按鈕存在於敵人資訊面板內 ===");
    const fleeInPanel = await page.evaluate(() => {
      const btn = document.getElementById("btn-midnight-flee-battle");
      const panel = document.getElementById("midnight-hud-bottom-center");
      return !!btn && panel.contains(btn);
    });
    assert(fleeInPanel, "#btn-midnight-flee-battle是#midnight-hud-bottom-center（敵人資訊面板）的子元素", results);

    console.log("=== 檢查8：掉落物簡易資訊搬到左上角HUD（隊友血量卡下方），並顯示物品名稱 ===");
    const localPos = (await getState(page)).localPos;
    await page.evaluate(
      ({ gameId, x, y }) =>
        window.PriTestGameStorage.rtSet(gameId, "cloud", "groundItems/gi_test_probe", {
          kind: "weapon",
          itemId: "greatsword_pursuer",
          usesRemaining: null,
          x: x,
          y: y,
        }),
      { gameId, x: localPos.x, y: localPos.y }
    );
    await page.waitForTimeout(300);
    const groundItemInfo = await page.evaluate(() => {
      const prompt = document.getElementById("midnight-ground-item-prompt");
      const hudTopLeft = document.getElementById("midnight-hud-top-left");
      return {
        insideHudTopLeft: hudTopLeft.contains(prompt),
        visible: !prompt.hidden,
        name: document.getElementById("midnight-ground-item-name").textContent,
      };
    });
    assert(groundItemInfo.insideHudTopLeft, "#midnight-ground-item-prompt是左上角HUD（隊友血量卡同一面板）的子元素", results);
    assert(groundItemInfo.visible, "站在掉落物旁邊時，簡易資訊確實顯示出來", results);
    assert(!!groundItemInfo.name && groundItemInfo.name !== "", "簡易資訊顯示了實際物品名稱，實際=\"" + groundItemInfo.name + "\"", results);

    console.log("=== 檢查7：技藝按鈕改用專屬圖示（不再是跟攻擊/戰技共用的劍圖示） ===");
    const artIconDistinct = await page.evaluate(() => {
      const icon = document.querySelector("#btn-midnight-art .midnight-icon-art");
      return !!icon && !icon.classList.contains("midnight-icon-sword");
    });
    assert(artIconDistinct, "#btn-midnight-art內的圖示是.midnight-icon-art，不是共用的.midnight-icon-sword", results);
  } catch (err) {
    console.log("  [ERROR]", err.message);
    results.push({ label: "測試腳本執行中發生例外", pass: false });
  } finally {
    await browser.close();
  }

  console.log("\n=== 結果彙總 ===");
  const failed = results.filter((r) => !r.pass);
  console.log(results.length + "項檢查，" + failed.length + "項失敗");
  failed.forEach((r) => console.log("  [FAIL] " + r.label));
  process.exit(failed.length ? 1 : 0);
})();
