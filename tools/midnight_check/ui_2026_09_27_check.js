// ============================================================================
// midnight 2026-09-27 UI 批次 回歸測試（Playwright ＋ Firebase Local Emulator）
// ============================================================================
// 使用者明確規格（2 項，第 3 項「刀光與 Perfect 判定的時間差」是診斷不是規格，
// 量測腳本另外放在 sprite_dodge_check.js 既有的迴避判定測試裡）：
//   ①「魔術與祈禱也要在詳細內 標明寫明魔術祈禱的種類」
//      → 角色視窗的武器詳細，杖／聖印的 [戰技] 區塊標題改標「魔術」／「祈禱」，
//        每一條招式也前置同一個詞＝「魔術｜輝剣｜魔術の輝剣」。
//        一般武器維持原本的「戰技」與無前綴。
//   ②「畫面中撿取地上物品的清單 在右上有ー號來縮小清單 還有＋號再次開啟地上清單」
//      → #midnight-ground-item-prompt 右上一顆按鈕切換「－」／「＋」，收起時
//        內容整塊隱藏、按鈕留在原地。
//
// 斷言都讀「畫面上真的長出來的文字與 hidden 狀態」，不比對原始碼字串——
// 只改了資料或 CSS 卻沒真的渲染出來的情況才抓得到。
// 招式名稱／種類名稱一律從 PriTestWeapons 當場算出來當期望值，不硬編
//（CLAUDE.md §4.7 原則 1：期望值能從資料算出來就不要硬編）。
//
// 使用前準備（跟 ui_2026_09_26_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node ui_2026_09_27_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const META_WAIT_MS = 20000;

// 測試用武器。3 把各自涵蓋一種情況：
//   staff_hermit   … 杖、兩招都**沒有** kindLabel → 「魔術｜輝石のつぶて」
//   seal_pebble_a  … 聖印、第 1 招**有** kindLabel → 「祈禱｜王都古竜信仰｜雷の槍」
//   dagger_lady_starter … 一般武器 → 前綴不該出現
const STAFF_ID = "staff_hermit";
const SEAL_ID = "seal_pebble_a";
const DAGGER_ID = "dagger_lady_starter";

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

async function setEquipment(page, gameId, tokenId, fields) {
  await page.evaluate(
    ({ gameId, tokenId, fields }) => {
      const GS = window.PriTestGameStorage;
      return Promise.all(Object.keys(fields).map((k) => GS.rtSet(gameId, "cloud", "character/" + tokenId + "/" + k, fields[k])));
    },
    { gameId, tokenId, fields }
  );
  await page.waitForTimeout(300);
}

// 角色視窗を開いて、指定 weaponId の格子を選び、右側 detail の中身を読む。
// §4.6：HUD は毎影格描き直され、角色鍵には nudge 動畫が付くので page.click() は
// 「stable」を待ち続けて逾時する。必ず dispatchEvent で handler を叩く。
async function readWeaponDetail(page, weaponId) {
  const sheetOpen = await page.evaluate(() => !document.getElementById("midnight-character-sheet-modal").hidden);
  if (!sheetOpen) await page.dispatchEvent("#btn-midnight-open-character-sheet", "click");
  await page.waitForSelector("#midnight-character-sheet-modal:not([hidden])", { timeout: 10000 });
  // 武器格子は renderInventorySlots() が毎回作り直すので、id ではなく並び順で引く。
  const slotIndex = await page.evaluate((wid) => {
    const st = window.PriTestMidnight._debugState();
    const c = st.characters[st.myTokenId];
    return (c.weaponIds || []).indexOf(wid);
  }, weaponId);
  if (slotIndex < 0) return { err: "weapon not in weaponIds", weaponId };
  const container = "#midnight-character-sheet-weapons";
  await page.waitForSelector(container + " .midnight-sheet-slot", { timeout: 10000 });
  await page.evaluate(
    ({ container, slotIndex }) => {
      const slots = document.querySelectorAll(container + " .midnight-sheet-slot");
      if (slots[slotIndex]) slots[slotIndex].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    },
    { container, slotIndex }
  );
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const d = document.getElementById("midnight-character-sheet-detail");
    if (!d) return { err: "no detail" };
    // boss-subheading＝各區塊標題（[戰技]／[戰技B]／[詞條]…）
    const headings = Array.prototype.map.call(d.querySelectorAll(".boss-subheading"), (p) => p.textContent.trim());
    // 招式一條一條的標題行。appendWeaponSheetSkillEntry() が作る行を、
    // 「detail 直下の p のうち boss-subheading 以外」として素直に集める。
    const lines = Array.prototype.map.call(d.querySelectorAll("p, h4, div"), (n) => n.textContent.trim()).filter(Boolean);
    return { headings, lines, text: d.textContent };
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => {
    pageErrors.push(e.message);
    console.log("  [pageerror] " + e.message);
  });

  try {
    await enableEmulatorFlag(page);
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });

    await page.click("#midnight-lobby-slots .midnight-slot-empty button");
    await page.waitForSelector("#midnight-lobby-join-form:not([hidden])", { timeout: 10000 });
    await page.fill("#midnight-lobby-name-input", "種類表示測試");
    await page.fill("#midnight-lobby-passcode-input", "1111");
    await page.click("#btn-midnight-lobby-join");
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });
    await page.waitForTimeout(1500);

    const ids = await page.evaluate(() => {
      const st = window.PriTestMidnight._debugState();
      return { gameId: st.gameId, tokenId: st.myTokenId };
    });

    // 期望値は資料から算出（招式名も種類名も、ここで決め打ちしない）
    const expect = await page.evaluate(
      ({ STAFF_ID, SEAL_ID, DAGGER_ID }) => {
        const W = window.PriTestWeapons;
        const CD = window.PriTestCharacterDrawer;
        const named = (id) => {
          const w = W.get(id);
          return (w.skills || [])
            .filter((ref) => ref.kind === "art")
            .map((ref) => CD.weaponSkillDisplayTitle(CD.resolveWeaponSkillDisplay(ref)));
        };
        return {
          sorceryWord: window.I18N.t("midnight_spell_kind_sorcery"),
          incantWord: window.I18N.t("midnight_spell_kind_incantation"),
          skillWord: window.I18N.t("midnight_character_sheet_skill_a_label"),
          staffTitles: named(STAFF_ID),
          sealTitles: named(SEAL_ID),
          daggerTitles: named(DAGGER_ID),
        };
      },
      { STAFF_ID, SEAL_ID, DAGGER_ID }
    );
    console.log("  期望値（來自 PriTestWeapons／I18N 本身）：" + JSON.stringify(expect));

    // ================================================================
    // ① 魔術／祈禱の種類表示
    // ================================================================
    console.log("\n=== ① 角色視窗の武器詳細に「魔術」「祈禱」を明記 ===");

    await setEquipment(page, ids.gameId, ids.tokenId, {
      weaponIds: [STAFF_ID, SEAL_ID, DAGGER_ID],
      equippedWeaponIdR: STAFF_ID,
      equippedWeaponIds: [STAFF_ID],
    });

    // --- 杖 → 魔術 ---
    const staff = await readWeaponDetail(page, STAFF_ID);
    assert(!staff.err, "杖の詳細が開ける", staff);
    assert(
      (staff.headings || []).indexOf(expect.sorceryWord) >= 0,
      "杖：區塊標題が「" + expect.sorceryWord + "」になっている",
      staff.headings
    );
    assert(
      (staff.headings || []).indexOf(expect.skillWord) < 0,
      "杖：もう「" + expect.skillWord + "」とは書かれていない",
      staff.headings
    );
    expect.staffTitles.forEach((t) => {
      const want = expect.sorceryWord + "｜" + t;
      assert((staff.lines || []).some((l) => l.indexOf(want) === 0), "杖：招式行が「" + want + "」で始まる", (staff.lines || []).slice(0, 12));
    });

    // --- 聖印 → 祈禱（kindLabel を持つ招式は 3 段になる）---
    const seal = await readWeaponDetail(page, SEAL_ID);
    assert(!seal.err, "聖印の詳細が開ける", seal);
    assert(
      (seal.headings || []).indexOf(expect.incantWord) >= 0,
      "聖印：區塊標題が「" + expect.incantWord + "」になっている",
      seal.headings
    );
    expect.sealTitles.forEach((t) => {
      const want = expect.incantWord + "｜" + t;
      assert((seal.lines || []).some((l) => l.indexOf(want) === 0), "聖印：招式行が「" + want + "」で始まる", (seal.lines || []).slice(0, 12));
    });
    // kindLabel を持つ招式では「祈禱｜系統名｜招式名」の 3 段になっていること
    const threeTier = expect.sealTitles.some((t) => t.indexOf("｜") >= 0);
    assert(threeTier, "聖印の測試対象に kindLabel 付きの招式が含まれている（3 段表示を検証できる）", expect.sealTitles);

    // --- 一般武器 → 「戰技」のまま、前綴なし ---
    const dagger = await readWeaponDetail(page, DAGGER_ID);
    assert(!dagger.err, "一般武器の詳細が開ける", dagger);
    assert(
      (dagger.headings || []).indexOf(expect.skillWord) >= 0,
      "一般武器：區塊標題は「" + expect.skillWord + "」のまま",
      dagger.headings
    );
    assert(
      (dagger.text || "").indexOf(expect.sorceryWord + "｜") < 0 && (dagger.text || "").indexOf(expect.incantWord + "｜") < 0,
      "一般武器：魔術／祈禱の前綴は付かない",
      (dagger.lines || []).slice(0, 12)
    );

    await page.dispatchEvent("#btn-midnight-character-sheet-close", "click");
    await page.waitForTimeout(200);

    // ================================================================
    // ② 地上物品清單の折りたたみ
    // ================================================================
    console.log("\n=== ② 掉落物清單の「－」で畳み、「＋」で戻す ===");

    // 自分の足元に掉落物を 1 つ置いて、清單を実際に表示させる。
    // 形は dropInventoryItem() が書くものと同じ（kind/itemId/usesRemaining/x/y/droppedBy/createdAt）。
    await page.evaluate(
      ({ gameId, tokenId }) => {
        const st = window.PriTestMidnight._debugState();
        const pos = st.localPos || { x: 0, y: 0 };
        return window.PriTestGameStorage.rtSet(gameId, "cloud", "groundItems/uiCheckDrop", {
          kind: "consumable",
          itemId: "item_grease",
          usesRemaining: 1,
          x: pos.x,
          y: pos.y,
          droppedBy: tokenId,
          createdAt: Date.now(),
        });
      },
      { gameId: ids.gameId, tokenId: ids.tokenId }
    );
    await page.waitForSelector("#midnight-ground-item-prompt:not([hidden])", { timeout: 10000 });
    assert(true, "掉落物清單が表示されている（折りたたみ鈕を実際の状態で試せる）");

    const before = await page.evaluate(() => {
      const btn = document.getElementById("btn-midnight-ground-item-toggle");
      const content = document.getElementById("midnight-ground-item-content");
      const prompt = document.getElementById("midnight-ground-item-prompt");
      if (!btn || !content || !prompt) return { err: "missing", btn: !!btn, content: !!content };
      const br = btn.getBoundingClientRect();
      const pr = prompt.getBoundingClientRect();
      return {
        label: btn.textContent.trim(),
        contentHidden: content.hidden,
        // 「右上」＝清單の右端寄り・上端寄りにあること
        rightAligned: pr.right - br.right < 12,
        nearTop: br.top - pr.top < 12,
      };
    });
    assert(!before.err, "折りたたみ鈕と内容ブロックが存在する", before);
    assert(before.label === "－", "初期は「－」（縮小できる状態）", before);
    assert(before.contentHidden === false, "初期は中身が見えている", before);
    assert(before.rightAligned, "鈕は清單の右端にある", before);
    assert(before.nearTop, "鈕は清單の上端にある", before);

    await page.dispatchEvent("#btn-midnight-ground-item-toggle", "click");
    await page.waitForTimeout(150);
    const collapsed = await page.evaluate(() => {
      const btn = document.getElementById("btn-midnight-ground-item-toggle");
      const content = document.getElementById("midnight-ground-item-content");
      const prompt = document.getElementById("midnight-ground-item-prompt");
      const br = btn.getBoundingClientRect();
      return {
        label: btn.textContent.trim(),
        contentHidden: content.hidden,
        promptStillVisible: !prompt.hidden,
        // 畳んだあとも「＋」が押せる大きさで残っていること（absolute にすると親が潰れて 0 になる）
        btnW: Math.round(br.width),
        btnH: Math.round(br.height),
      };
    });
    assert(collapsed.label === "＋", "「－」を押すと「＋」に変わる", collapsed);
    assert(collapsed.contentHidden === true, "中身（分頁・名稱・本文・拾取鈕）が隠れる", collapsed);
    assert(collapsed.promptStillVisible, "清單そのものは消えない（＋が残る）", collapsed);
    assert(collapsed.btnW > 0 && collapsed.btnH > 0, "畳んだ後も「＋」が実寸を持つ＝押せる", collapsed);

    await page.dispatchEvent("#btn-midnight-ground-item-toggle", "click");
    await page.waitForTimeout(150);
    const reopened = await page.evaluate(() => {
      const btn = document.getElementById("btn-midnight-ground-item-toggle");
      const content = document.getElementById("midnight-ground-item-content");
      const pickup = document.getElementById("btn-midnight-pickup-ground-item");
      return {
        label: btn.textContent.trim(),
        contentHidden: content.hidden,
        pickupVisible: !!(pickup && pickup.offsetParent !== null),
      };
    });
    assert(reopened.label === "－", "「＋」を押すと「－」に戻る", reopened);
    assert(reopened.contentHidden === false, "中身が戻る", reopened);
    assert(reopened.pickupVisible, "拾取鈕がまた押せる状態に戻っている", reopened);

    // 折りたたみ状態は毎影格走る updateNearbyGroundItem() に上書きされない
    await page.dispatchEvent("#btn-midnight-ground-item-toggle", "click");
    await page.waitForTimeout(1200); // 影格を何十枚か回す
    const persisted = await page.evaluate(() => ({
      label: document.getElementById("btn-midnight-ground-item-toggle").textContent.trim(),
      contentHidden: document.getElementById("midnight-ground-item-content").hidden,
    }));
    assert(persisted.label === "＋" && persisted.contentHidden === true, "畳んだ状態が毎影格の再描画で戻されない", persisted);

    assert(pageErrors.length === 0, "過程中沒有任何 pageerror", pageErrors);
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.pass).length;
  console.log("\n" + passed + "/" + results.length + (passed === results.length ? " PASS" : " PASS（有失敗項目）"));
  process.exit(passed === results.length ? 0 : 1);
})();
