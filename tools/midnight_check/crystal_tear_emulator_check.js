// ============================================================================
// 結晶雫：實機流程（2026-09-25 第 7 期，設計文件 §10.16）
// ----------------------------------------------------------------------------
// crystal_tear_check.js 驗的是換算表與各計算點的數值（不需要 session）；這一支驗的是
// **實際玩起來的那條路徑**——出撃時取得、左下操作盤 ◀▶ 切換、讀取條走完扣次數、角色視窗
// 顯示、祝福回復後可以再用一次。這些都必須有進行中的 session，所以走 Firebase Local
// Emulator（同 emulator_sync_check.js，見該檔開頭）。
//
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8791 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8791 node crystal_tear_emulator_check.js
//
// 這支測試同時是「本地 buff 欄位被角色資料回流洗掉」這個既有病灶的回歸保險：
// _crystalTear 若沒有列進 LOCAL_ONLY_CHARACTER_FIELD_RE 白名單，「減傷 20% 生效中」
// 那一項會失敗（次數扣掉了但 buff 不見）。
// ============================================================================
const { chromium } = require("playwright");
const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const WAIT = 25000;
const TEAR_ID = "rm_start_leaden_hardtear"; // 鉛色の硬雫（20 秒減傷 20%）——效果最好斷言

let fails = 0;
const assert = (c, l, d) => {
  console.log((c ? "  [PASS] " : "  [FAIL] ") + l + (c || d === undefined ? "" : "　→ " + JSON.stringify(d)));
  if (!c) fails++;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => {
    console.log("  [pageerror] " + e.message);
    fails++;
  });

  try {
    // emulator 的 database port 可用 PRITEST_EMU_PORT 覆寫（同 relic_memory_emulator_check.js；
    // 有些機器 9000 被其他程式佔用，emulator 改跑在別的 port）。
    await page.addInitScript((port) => {
      try {
        window.sessionStorage.setItem("pritestRtdbEmulator", "1");
        if (port) window.sessionStorage.setItem("pritestRtdbEmulatorPort", port);
      } catch (e) {
        /* 忽略 */
      }
    }, process.env.PRITEST_EMU_PORT || "");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: WAIT });
    await page.click("#midnight-lobby-slots .midnight-slot-empty button");
    await page.fill("#midnight-lobby-name-input", "T");
    await page.click("#midnight-lobby-character-picker button");
    await page.fill("#midnight-lobby-passcode-input", "1234");
    await page.click("#btn-midnight-lobby-join");
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: WAIT });

    // 帶入一顆含結晶雫的記憶（等待房的 players/<slot>/relicMemoryLoadout），再開局。
    await page.evaluate((tearId) => {
      const s = window.PriTestMidnight._debugState();
      return window.PriTestGameStorage.rtSet(s.gameId, "cloud", "players/" + s.mySlot + "/relicMemoryLoadout", [
        { memId: "mtear", size: "s", effects: [{ id: tearId }], createdAt: Date.now(), source: "test" },
      ]);
    }, TEAR_ID);
    await page.waitForTimeout(800);
    // CLAUDE.md §4.6：midnight 的 HUD 每幀重繪，一律用 dispatchEvent，不用 page.click。
    await page.dispatchEvent("#btn-midnight-lobby-ready", "click");
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: WAIT });
    await page.waitForFunction(() => !!window.PriTestMidnight._debugCrystalTearState().tearId, { timeout: WAIT });

    console.log("-- 出撃時取得 --");
    const st1 = await page.evaluate(() => window.PriTestMidnight._debugCrystalTearState());
    assert(st1.tearId === TEAR_ID, "帶入的記憶裡那一條雫在出撃時被發下來", st1);
    assert(st1.used === false, "初始是未使用", st1);
    assert(st1.slotCount === 2 && st1.slot === 0, "聖杯瓶卡片變成 2 格、預設仍在聖杯瓶", st1);

    console.log("");
    console.log("-- 操作盤 ◀▶ 切換 --");
    const cycleEnabled = await page.evaluate(() => {
      const p = document.getElementById("btn-midnight-flask-prev");
      const n = document.getElementById("btn-midnight-flask-next");
      return { prev: !p.disabled && !p.hidden, next: !n.disabled && !n.hidden };
    });
    assert(cycleEnabled.prev && cycleEnabled.next, "有雫時兩顆切換鍵都顯示且可按", cycleEnabled);

    const labelFlask = await page.textContent("#midnight-flask-label");
    await page.dispatchEvent("#btn-midnight-flask-next", "click");
    const st2 = await page.evaluate(() => window.PriTestMidnight._debugCrystalTearState());
    const labelTear = await page.textContent("#midnight-flask-label");
    assert(st2.slot === 1, "切到結晶雫那一格", st2);
    assert(labelTear && labelTear !== labelFlask, "卡片品名跟著換成雫名", { labelFlask, labelTear });
    const badge = await page.evaluate(() => {
      const e = document.getElementById("midnight-flask-slot-count");
      return { hidden: e.hidden, text: e.textContent };
    });
    assert(badge.hidden === false && badge.text === "×1", "剩餘次數徽章顯示 ×1", badge);
    // 切回去再切過來，確認是循環而不是單向。
    await page.dispatchEvent("#btn-midnight-flask-prev", "click");
    const st2b = await page.evaluate(() => window.PriTestMidnight._debugCrystalTearState());
    assert(st2b.slot === 0, "◀ 切得回聖杯瓶", st2b);
    await page.dispatchEvent("#btn-midnight-flask-next", "click");

    console.log("");
    console.log("-- 角色視窗 --");
    await page.dispatchEvent("#btn-midnight-open-character-sheet", "click");
    await page.waitForTimeout(400);
    const sheet = await page.evaluate(() => {
      const sec = document.getElementById("midnight-character-sheet-crystal-tear-section");
      return { hidden: sec.hidden, text: document.getElementById("midnight-character-sheet-crystal-tear").textContent };
    });
    const expectNote = await page.evaluate((id) => window.PriTestMidnightRelicMemoryCatalog.effect(id).note, TEAR_ID);
    assert(sheet.hidden === false, "擁有結晶雫時角色視窗顯示該欄（使用者明確規格）");
    assert(sheet.text.indexOf(expectNote) >= 0, "欄內顯示目錄上的換算說明「" + expectNote + "」", sheet);
    await page.dispatchEvent("#btn-midnight-character-sheet-close", "click");
    await page.waitForTimeout(300);

    console.log("");
    console.log("-- 使用（讀取時間如聖杯瓶）--");
    await page.dispatchEvent("#btn-midnight-use-flask", "click");
    const midRead = await page.evaluate(() => window.PriTestMidnight._debugCrystalTearState());
    assert(midRead.used === false, "按下後、讀取條走完前還沒扣使用次數", midRead);
    await page.waitForFunction(() => window.PriTestMidnight._debugCrystalTearState().used === true, { timeout: WAIT });
    await page.waitForTimeout(600); // 讓 rtSet 的回流跑過一輪（本地 buff 被洗掉的話這裡才抓得到）
    const st3 = await page.evaluate(() => window.PriTestMidnight._debugCrystalTearState());
    assert(st3.used === true, "讀取條走完後扣掉使用次數", st3);
    assert(
      st3.active && st3.active.id === TEAR_ID && st3.active.kind === "damageCut" && st3.active.value === 20,
      "效果生效中（且沒有被 character/ 回流洗掉，見檔頭說明）",
      st3.active
    );
    const after = await page.evaluate(() => ({
      badge: document.getElementById("midnight-flask-slot-count").textContent,
      disabled: document.getElementById("btn-midnight-use-flask").disabled,
    }));
    assert(after.badge === "×0" && after.disabled === true, "用完後徽章 ×0、使用鍵鎖住（使用次數 1）", after);

    console.log("");
    console.log("-- 祝福補充 --");
    await page.evaluate(() => window.PriTestMidnight._debugApplyBlessingRestore());
    await page.waitForTimeout(500);
    const st4 = await page.evaluate(() => window.PriTestMidnight._debugCrystalTearState());
    assert(st4.used === false, "回到祝福後可以再使用一次（使用者明確規格）", st4);
    const after2 = await page.evaluate(() => document.getElementById("btn-midnight-use-flask").disabled);
    assert(after2 === false, "使用鍵重新可按");

    // 2026-09-25 使用者明確規格「使用聖杯瓶的按鈕，如果自身沒帶有任何結晶雫則不必顯示切換的作業按鈕」：
    // 沒帶雫的房間，◀▶ 兩顆直接隱藏（舊版是 disabled 灰掉）。
    console.log("");
    console.log("-- 沒帶結晶雫時不顯示切換鍵 --");
    const page2 = await browser.newPage();
    page2.on("pageerror", (e) => {
      console.log("  [pageerror 2] " + e.message);
      fails++;
    });
    await page2.addInitScript((port) => {
      try {
        window.sessionStorage.setItem("pritestRtdbEmulator", "1");
        if (port) window.sessionStorage.setItem("pritestRtdbEmulatorPort", port);
      } catch (e) {
        /* 忽略 */
      }
    }, process.env.PRITEST_EMU_PORT || "");
    await page2.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page2.click("#btn-midnight-create");
    await page2.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: WAIT });
    await page2.click("#midnight-lobby-slots .midnight-slot-empty button");
    await page2.fill("#midnight-lobby-passcode-input", "1234");
    await page2.click("#btn-midnight-lobby-join");
    await page2.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: WAIT });
    await page2.dispatchEvent("#btn-midnight-lobby-ready", "click");
    await page2.waitForFunction(() => !!window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: WAIT });
    await page2.waitForTimeout(1500);
    const noTear = await page2.evaluate(() => ({
      state: window.PriTestMidnight._debugCrystalTearState(),
      prevHidden: document.getElementById("btn-midnight-flask-prev").hidden,
      nextHidden: document.getElementById("btn-midnight-flask-next").hidden,
      useVisible: !!document.getElementById("btn-midnight-use-flask").offsetParent,
    }));
    assert(noTear.state.slotCount === 1, "沒帶雫＝聖杯瓶卡片只有 1 格", noTear.state);
    assert(noTear.prevHidden && noTear.nextHidden, "沒帶雫時 ◀▶ 兩顆都隱藏", noTear);
    assert(noTear.useVisible, "聖杯瓶使用鍵本身照常顯示", noTear);
    await page2.close();
  } catch (e) {
    console.log("  [FAIL] 例外：" + e.message);
    fails++;
  } finally {
    await browser.close();
  }

  console.log("");
  console.log(fails === 0 ? "全部通過" : fails + " 項失敗");
  process.exit(fails === 0 ? 0 : 1);
})();
