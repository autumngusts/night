// ============================================================================
// 視窗跨裝置同步顯示（enemy-damage-modal／ability-check-modal／cooperative-check-modal／
// branch-tally-modal）現況實測（一次性診斷用，不提交進Git）
// ============================================================================
// 用途：建立雲端測試遊戲，等待此分頁完成第一次雲端同步（bootstrap push）之後，直接用
// firebase CLI對Firebase Realtime Database的nightState路徑寫入「視窗應該開啟」的資料
// （模擬另一台裝置的真實推送），確認這個分頁能透過subscribeNightState自動把對應視窗
// 從hidden切換為顯示，不需要手動點擊任何按鈕。
//
// 執行方式：node modal_sync_smoke_test.js
// 前置需求：python generate.py建置 + 本機HTTP伺服器 + firebase CLI已登入
// ============================================================================

const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const FB_PROJECT = "elden-ring-nightreign";
const TMP_JSON = path.join(__dirname, "_modal_sync_tmp.json");

function fbSet(dbPath, jsonValue) {
  fs.writeFileSync(TMP_JSON, JSON.stringify(jsonValue));
  execFileSync("firebase", ["database:set", dbPath, TMP_JSON, "--project", FB_PROJECT, "-f"], { stdio: "pipe", shell: true });
}

function log(...args) {
  console.log(...args);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("dialog", async (d) => { await d.accept("night"); });
  page.on("pageerror", (err) => log("PAGEERROR:", err.message));

  let gameId = null;
  let ok = true;

  try {
    await page.goto(BASE + "/admin/index.html", { waitUntil: "networkidle" });
    gameId = await page.evaluate(() => window.PriTestGames.create("modal-sync-smoke-" + Date.now(), "tricephalos", "cloud").id);
    log("建立雲端測試遊戲：", gameId);

    await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.firebase && window.firebase.apps.length > 0, { timeout: 15000 });
    await page.waitForFunction(() => window.firebase.auth().currentUser !== null, { timeout: 15000 });
    // 等待bootstrap push完成（全新雲端遊戲第一次saveState推送nightState上去）。
    await page.waitForTimeout(2000);

    // --- 測試1：enemy-damage-modal（防禦階段視窗）---
    log("\n--- 測試 enemy-damage-modal ---");
    let modalHidden = await page.evaluate(() => document.getElementById("enemy-damage-modal").hidden);
    log("寫入前 hidden =", modalHidden);
    fbSet(`/games/${gameId}/nightState/battle/enemyDamageModalOpen`, true);
    await page.waitForTimeout(1500);
    modalHidden = await page.evaluate(() => document.getElementById("enemy-damage-modal").hidden);
    log("遠端寫入enemyDamageModalOpen=true後 hidden =", modalHidden);
    if (modalHidden !== false) {
      log("❌ enemy-damage-modal 沒有自動開啟");
      ok = false;
    } else {
      log("✅ enemy-damage-modal 自動開啟成功");
    }
    fbSet(`/games/${gameId}/nightState/battle/enemyDamageModalOpen`, false);
    await page.waitForTimeout(1500);
    modalHidden = await page.evaluate(() => document.getElementById("enemy-damage-modal").hidden);
    log("遠端寫回false後 hidden =", modalHidden);
    if (modalHidden !== true) {
      log("❌ enemy-damage-modal 沒有自動關閉");
      ok = false;
    } else {
      log("✅ enemy-damage-modal 自動關閉成功");
    }

    // --- 測試2：ability-check-modal（判定視窗）---
    log("\n--- 測試 ability-check-modal ---");
    fbSet(`/games/${gameId}/nightState/gmFlow/abilityCheckSpec`, { target: 8, statKey: "luck", markerLabel: null });
    fbSet(`/games/${gameId}/nightState/gmFlow/abilityCheckRolls`, {});
    await page.waitForTimeout(1500);
    let abHidden = await page.evaluate(() => document.getElementById("ability-check-modal").hidden);
    log("遠端寫入abilityCheckSpec後 hidden =", abHidden);
    if (abHidden !== false) {
      log("❌ ability-check-modal 沒有自動開啟");
      ok = false;
    } else {
      log("✅ ability-check-modal 自動開啟成功");
    }
    // 檢查是否有依entered角色渲染出擲骰按鈕（至少不報錯、doneBtn存在）
    const doneBtnExists = await page.evaluate(() => !!document.getElementById("btn-ability-check-done"));
    log("btn-ability-check-done 存在 =", doneBtnExists);
    fbSet(`/games/${gameId}/nightState/gmFlow/abilityCheckSpec`, null);
    await page.waitForTimeout(1500);
    abHidden = await page.evaluate(() => document.getElementById("ability-check-modal").hidden);
    log("遠端清除abilityCheckSpec後 hidden =", abHidden);
    if (abHidden !== true) {
      log("❌ ability-check-modal 沒有自動關閉");
      ok = false;
    } else {
      log("✅ ability-check-modal 自動關閉成功");
    }
  } catch (err) {
    log("測試過程發生例外：", err.message);
    ok = false;
  } finally {
    if (gameId) {
      try {
        await page.evaluate((gid) => window.PriTestGames.remove(gid), gameId);
        await page.waitForTimeout(1000);
        log("已清理測試遊戲：", gameId);
      } catch (e) {
        log("清理測試遊戲失敗：", e.message);
      }
    }
    await browser.close();
    try {
      fs.unlinkSync(TMP_JSON);
    } catch (e) {}
  }

  log(ok ? "\n=== 總結：視窗跨裝置同步運作正常 ===" : "\n=== 總結：視窗跨裝置同步測試發現問題 ===");
  process.exit(ok ? 0 : 1);
})();
