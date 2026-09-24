// ============================================================================
// 遺物記憶 emulator 回歸測試（Firebase Local Emulator，不連正式專案）。
// 前置：
//   1. python generate.py
//   2. python -m http.server 8791 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node relic_memory_emulator_check.js
// 本機環境備註：這台機器 9000 port 被 IntelliJ IDEA 佔用，emulator 的 database 改跑在
// 9010（auth 仍是 9099）。用環境變數 PRITEST_EMU_PORT 覆寫（預設 "9000"），並透過
// enableEmulatorFlag()把同一個 port 寫進 sessionStorage，讓頁面內的
// game_storage.js（pritestRtdbEmulatorPort override）連到同一個 emulator。
// ============================================================================
const { chromium } = require("playwright");
const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const EMU_PORT = process.env.PRITEST_EMU_PORT || "9000";
const EMU = "http://127.0.0.1:" + EMU_PORT;
const NS = "elden-ring-nightreign-default-rtdb";
const TEST_CODE = "TST01";
const META_WAIT_MS = 15000;

let fails = 0;
const assert = (c, l) => { console.log((c ? "  [PASS] " : "  [FAIL] ") + l); if (!c) fails++; };

// emulator 的 owner token 可以繞過規則，只用來佈置測試資料（正式環境對應 Console 手動匯入）。
async function adminPut(pathStr, value) {
  const res = await fetch(`${EMU}/${pathStr}.json?ns=${NS}`, {
    method: "PUT",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error("adminPut failed " + res.status);
}

// 讓執行中的 emulator 套用目前 repo 版本的 database.rules.json（避免忘記重啟 emulator
// 而繼續吃舊規則；正式環境仍是各自 firebase deploy --only database / Console 貼上）。
async function pushRules() {
  const fs = require("fs");
  const path = require("path");
  const rulesPath = path.join(__dirname, "..", "..", "database.rules.json");
  const rules = fs.readFileSync(rulesPath, "utf8");
  const res = await fetch(`${EMU}/.settings/rules.json?ns=${NS}`, {
    method: "PUT",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: rules,
  });
  if (!res.ok) throw new Error("pushRules failed " + res.status);
}

async function enableEmulatorFlag(page) {
  await page.addInitScript((port) => {
    try { window.sessionStorage.setItem("pritestRtdbEmulator", "1"); } catch (e) {}
    try { window.sessionStorage.setItem("pritestRtdbEmulatorPort", port); } catch (e) {}
  }, EMU_PORT);
}

async function storageSection(page) {
  console.log("=== 儲存 API ＋ 規則 ===");
  await adminPut("relicMemoryCodes", { [TEST_CODE]: true });
  await adminPut("relicMemories/" + TEST_CODE, null);
  const r = await page.evaluate(async (code) => {
    const GS = window.PriTestGameStorage;
    const empty = await GS.relicMemoryRead(code);
    const bad = await GS.relicMemoryRead("ZZZZZ");
    const tx = await GS.relicMemoryTransaction(code, (cur) => Object.assign({}, cur || {}, { mA: { memId: "mA", size: "s", effects: ["attack_dmg"], createdAt: 1, favorite: false, source: "start" } }));
    const fav = await GS.relicMemorySet(code, "mA", { memId: "mA", size: "s", effects: ["attack_dmg"], createdAt: 1, favorite: true, source: "start" });
    const after = await GS.relicMemoryRead(code);
    const del = await GS.relicMemorySet(code, "mA", null);
    const afterDel = await GS.relicMemoryRead(code);
    return { empty, bad, tx, fav, after, del, afterDel };
  }, TEST_CODE);
  assert(r.empty.ok && r.empty.value === null, "有效密碼、尚無資料 → ok/null");
  assert(!r.bad.ok && r.bad.error === "denied", "未登錄密碼 → denied");
  assert(r.tx.ok && r.tx.value && r.tx.value.mA, "transaction 寫入");
  assert(r.fav.ok && r.after.value.mA.favorite === true, "relicMemorySet 更新最愛");
  assert(r.del.ok && r.afterDel.value === null, "relicMemorySet(null) 刪除");
}

(async () => {
  await pushRules();
  const browser = await chromium.launch();
  const pageA = await browser.newPage();
  try {
    await enableEmulatorFlag(pageA);
    await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await storageSection(pageA);
    // Task 4〜6 在這裡往下加段落
  } catch (e) {
    console.error(e);
    fails++;
  } finally {
    await browser.close();
  }
  console.log(fails ? fails + " FAIL" : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
