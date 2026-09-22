// ============================================================================
// midnight 2026-09-22 回歸測試：開局後從空位加入（Playwright ＋ Firebase Local Emulator）
// ============================================================================
// 使用前準備（跟 emulator_sync_check.js 完全相同，見該檔開頭）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node late_join_check.js
//
// 涵蓋項目（使用者明確規格「非遊戲中的裝置 可以點(空位)的加入 並打開選擇腳色頁面視窗來做選擇
// 仍舊要打名稱以及4位數字 在選擇職業 按下加入後即可同步進入遊戲 出身地為有其他玩家周遭的安全地帶
// 仍為lv1開始」）：
//   ① A 單人開局後，B 以觀戰者身份開同一個連結：左上隊伍面板的空位有「加入」鈕，A（已有席位）沒有
//   ② B 按加入 → #midnight-late-join-modal 顯示，等待房的表單／角色詳細節點被搬進視窗
//   ③ 密碼不是 4 位數 → alert、不寫入
//   ④ 填名稱＋4 位數＋選職業 → players/{slot} 寫入、B 立即有 mySlot、視窗關閉、地圖展開
//   ⑤ 出生點在 A 附近（findWalkableSpawnNear 的 ±3 格內）、demoStat／character 建立、Lv.1
//   ⑥ A 的隊伍面板看到 B；B 開始推送位置（tokens/）
//   ⑦ 加入後 B 的空位不再有加入鈕（已有席位）
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

const waitFor = (page, fn, arg, timeout) => page.waitForFunction(fn, arg, { timeout: timeout || META_WAIT_MS });
const state = (page) => page.evaluate(() => window.PriTestMidnight._debugState());

(async () => {
  const browser = await chromium.launch();
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  [pageA, pageB].forEach((p, i) => p.on("pageerror", (e) => console.log("  [pageerror " + "AB"[i] + "] " + e.message)));

  try {
    await enableEmulatorFlag(pageA);
    await enableEmulatorFlag(pageB);
    console.log("=== A 建立房間、單人開局 ===");
    await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await pageA.click("#btn-midnight-create");
    await waitFor(pageA, () => window.PriTestMidnight && window.PriTestMidnight._debugState().meta);
    const gameUrl = pageA.url();
    await pageA.click("#midnight-lobby-slots .midnight-slot-empty button");
    await pageA.fill("#midnight-lobby-passcode-input", "1234");
    await pageA.click("#btn-midnight-lobby-join");
    await waitFor(pageA, () => !!window.PriTestMidnight._debugState().mySlot);
    await pageA.click("#btn-midnight-lobby-ready");
    await waitFor(pageA, () => window.PriTestMidnight._debugState().meta.sessionStartAt);
    await waitFor(pageA, () => !!window.PriTestMidnight._debugState().localPos);
    // A 推送過位置（tokens/）之後 B 才有錨點可用
    await pageA.waitForTimeout(600);

    console.log("=== ① B 以觀戰者身份進入已開局的房間 ===");
    await pageB.goto(gameUrl, { waitUntil: "networkidle" });
    await waitFor(pageB, () => window.PriTestMidnight && window.PriTestMidnight._debugState().meta && window.PriTestMidnight._debugState().meta.sessionStartAt);
    await waitFor(pageB, () => document.querySelectorAll("#midnight-players-panel-slots .midnight-slot-card").length === 3);
    const panelB = await pageB.evaluate(() => ({
      lobbyHidden: document.querySelector("#midnight-lobby").hidden,
      mySlot: window.PriTestMidnight._debugState().mySlot,
      emptyWithJoin: Array.from(document.querySelectorAll("#midnight-players-panel-slots .midnight-slot-empty")).filter((c) => c.querySelector("button")).length,
      emptyTotal: document.querySelectorAll("#midnight-players-panel-slots .midnight-slot-empty").length,
    }));
    assert(panelB.lobbyHidden && !panelB.mySlot, "B 進來直接是遊戲畫面、沒有席位（觀戰者）", panelB);
    assert(panelB.emptyTotal === 2 && panelB.emptyWithJoin === 2, "B 的隊伍面板 2 個空位都有「加入」鈕", panelB);
    const panelA = await pageA.evaluate(() => Array.from(document.querySelectorAll("#midnight-players-panel-slots .midnight-slot-empty")).filter((c) => c.querySelector("button")).length);
    assert(panelA === 0, "A（已有席位）的空位沒有加入鈕", panelA);

    console.log("=== ② 按加入 → 視窗顯示、表單節點搬進來 ===");
    await pageB.click("#midnight-players-panel-slots .midnight-slot-empty button");
    await waitFor(pageB, () => !document.querySelector("#midnight-late-join-modal").hidden);
    const modalB = await pageB.evaluate(() => {
      const host = document.querySelector("#midnight-late-join-form-host");
      const form = document.querySelector("#midnight-lobby-join-form");
      return { formInHost: form.parentElement === host, formHidden: form.hidden, detailInHost: document.querySelector("#midnight-lobby-character-detail").parentElement === host, pickerCount: document.querySelectorAll("#midnight-lobby-character-picker .midnight-character-option").length, targetSlot: form.dataset.targetSlot };
    });
    assert(modalB.formInHost && !modalB.formHidden && modalB.detailInHost, "等待房表單／角色詳細節點已搬進視窗且表單顯示", modalB);
    assert(modalB.pickerCount === 20 && modalB.targetSlot === "2", "職業選擇 20 個選項、目標席位＝2", modalB);
    // 點一個職業 → 角色詳細面板打開
    await pageB.click("#midnight-lobby-character-picker .midnight-character-option:nth-child(3)");
    const detailShown = await pageB.evaluate(() => !document.querySelector("#midnight-lobby-character-detail").hidden);
    assert(detailShown, "選職業後角色詳細面板顯示", detailShown);

    console.log("=== ③ 密碼不是 4 位數 → 不寫入 ===");
    let alerted = false;
    pageB.once("dialog", async (d) => {
      alerted = true;
      await d.dismiss();
    });
    await pageB.fill("#midnight-lobby-name-input", "LateB");
    await pageB.fill("#midnight-lobby-passcode-input", "12");
    await pageB.click("#btn-midnight-lobby-join");
    await pageB.waitForTimeout(400);
    assert(alerted && !(await state(pageB)).players["2"], "密碼 2 位數 → alert、players/2 未寫入", alerted);

    console.log("=== ④ 正常加入 → 立即進場 ===");
    await pageB.fill("#midnight-lobby-passcode-input", "5678");
    await pageB.click("#btn-midnight-lobby-join");
    await waitFor(pageB, () => window.PriTestMidnight._debugState().mySlot === "2");
    await waitFor(pageB, () => document.querySelector("#midnight-late-join-modal").hidden);
    const sB = await state(pageB);
    const pB = sB.players["2"];
    assert(pB && pB.name === "LateB" && pB.passcode === "5678" && pB.tokenId === sB.myTokenId, "players/2 ＝ {LateB, 5678, 自己的 tokenId}", pB);
    assert(sB.mapExpanded === true && !!sB.localPos, "加入後視窗關閉、地圖展開、有本地位置", { mapExpanded: sB.mapExpanded, localPos: sB.localPos });

    console.log("=== ⑤ 出生點在 A 附近、資源建立、Lv.1 ===");
    const posA = (await state(pageA)).localPos;
    const dist = Math.max(Math.abs(sB.localPos.x - posA.x), Math.abs(sB.localPos.y - posA.y));
    assert(dist <= 3.5, "出生點在 A 的 ±3 格內（Chebyshev 距離 " + dist.toFixed(2) + "）", { posA, posB: sB.localPos });
    await waitFor(pageB, () => {
      const s = window.PriTestMidnight._debugState();
      return typeof s.demoStats[s.myTokenId] === "number" && !!s.characters[s.myTokenId];
    });
    const resB = await pageB.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      const c = s.characters[s.myTokenId];
      return { hp: s.demoStats[s.myTokenId], level: c.level, typeId: c.typeId };
    });
    assert(resB.hp > 0 && resB.level === 1, "demoStat>0、角色 Lv.1（" + resB.typeId + "）", resB);

    console.log("=== ⑥⑦ A 看到 B；B 開始推送位置；B 的空位不再有加入鈕 ===");
    await waitFor(pageA, () => !!(window.PriTestMidnight._debugState().players["2"] || {}).tokenId);
    await waitFor(pageA, (tok) => !!window.PriTestMidnight._debugState().remoteTokens[tok], sB.myTokenId, 10000);
    const seenByA = await pageA.evaluate(() => Array.from(document.querySelectorAll("#midnight-players-panel-slots .midnight-slot-card")).map((c) => c.textContent.indexOf("LateB") !== -1));
    assert(seenByA.filter(Boolean).length === 1, "A 的隊伍面板顯示 LateB，且 A 收到 B 的位置（tokens/）", seenByA);
    const joinBtnsAfter = await pageB.evaluate(() => Array.from(document.querySelectorAll("#midnight-players-panel-slots .midnight-slot-empty")).filter((c) => c.querySelector("button")).length);
    assert(joinBtnsAfter === 0, "B 已有席位後，剩下的空位不再顯示加入鈕", joinBtnsAfter);
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
