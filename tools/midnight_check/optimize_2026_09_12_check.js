// ============================================================================
// midnight（即時制擴張版）2026-09-12 優化第 4 批回歸測試（Playwright ＋ Firebase
// Local Emulator）。對應使用者當日提出的 4 項規格：
//   1. 消耗品獲得時基本拿到 2 個（原使用次數 2 → 2 個、3 → 3 個）；一格最多堆疊 6 個，
//      超過就換格，全滿則把剩餘數量丟到地上；商人購買改成「先看效果、再按［確定購買］」。
//   2. 獎勵清單不得再出現未翻譯的英文 kind 字串；多顆按鈕並排要有間距；「揭示」改「抽選」
//      且抽選鍵帶微閃黃提示。
//   3. 獎勵取得的武器／杖／聖印，其戰技（魔術・祈禱）在抽選當下就決定，不留到鍛造台。
//   4. 手機版底部操作按鈕壓低高度。
//
// 使用前準備（跟 emulator_sync_check.js 完全相同，見該檔開頭）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node optimize_2026_09_12_check.js
//
// 測試手法沿用 consumable_talisman_runtime_check.js：透過 midnight.js 的 _debug* 入口
// 直接呼叫內部函式並讀回結果，不逐一點按 UI（CLAUDE.md §4.6 也明確禁止對持續重繪的
// HUD 使用 page.click）。純 CSS／DOM 結構的項目（2 的間距、4 的按鈕高度）則直接讀
// getComputedStyle，期望值從 style.css 實際寫入的數值算回來，不硬編一份第二來源。
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
  page.on("pageerror", (e) => console.log("  [pageerror] " + e.message));

  try {
    await enableEmulatorFlag(page);
    console.log("=== 建立 midnight 測試場（連本機 emulator） ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });

    console.log("=== 等待房：加入席位並準備，觸發開局 ===");
    await joinLobby(page, "1234");
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 25000 });
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().characters[window.PriTestMidnight._debugState().myTokenId], {
      timeout: META_WAIT_MS,
    });

    // ------------------------------------------------------------------
    // 項目 1-a：獲得個數＝max(2, 規則書使用次數)
    // 期望值直接從 consumables.js 的 uses 欄位算回來（CLAUDE.md §4.7 原則 1：
    // 能從資料算出來就不要硬編），只有「基本 2 個」這條規則本身是硬編的常數。
    // ------------------------------------------------------------------
    console.log("=== 1-a 消耗品獲得個數 ===");
    const acquire = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      return window.PriTestConsumables.list().map((item) => ({
        id: item.id,
        uses: item.uses,
        noStackLimit: !!item.noStackLimit,
        got: M._debugConsumableAcquireCount(item.id),
      }));
    });
    acquire.forEach((row) => {
      const expected = row.noStackLimit ? 1 : Math.max(2, row.uses || 1);
      assert(row.got === expected, `獲得個數 ${row.id}（uses=${row.uses}）＝${expected}`, row);
    });
    assert(
      acquire.some((r) => r.uses === 3 && r.got === 3),
      "使用次數 3 的消耗品確實獲得 3 個",
      acquire.filter((r) => r.uses === 3)
    );
    assert(
      acquire.some((r) => r.uses === 1 && !r.noStackLimit && r.got === 2),
      "使用次數 1 的消耗品（調香瓶類）改為獲得 2 個",
      acquire.filter((r) => r.uses === 1)
    );

    // ------------------------------------------------------------------
    // 項目 1-b：一格最多 6 個、滿了換格、全滿丟地上
    // ------------------------------------------------------------------
    console.log("=== 1-b 堆疊上限 6／溢出換格／全滿落地 ===");
    const stack = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      c.consumables = []; // 清空後再灌，避免受初始配發道具影響
      const stackMax = M._debugConsumableStackMax();
      const slotCount = 4; // 角色面板消耗品欄格數（CONSUMABLE_SLOT_COUNT）
      const id = "item_hero_meat_chunk";
      const steps = [];
      // ① 先放 6 個 → 應該只佔 1 格、該格 6 個、沒有溢出
      steps.push({ tag: "fill-one-slot", r: M._debugGrantConsumable(id, stackMax) });
      // ② 再放 1 個 → 第 1 格已滿，應該另開第 2 格
      steps.push({ tag: "overflow-to-new-slot", r: M._debugGrantConsumable(id, 1) });
      // ③ 灌到 4 格全滿再多給 5 個 → 多的要變成地上的掉落物
      const need = slotCount * stackMax - (stackMax + 1);
      steps.push({ tag: "fill-all-slots", r: M._debugGrantConsumable(id, need) });
      const groundBefore = Object.keys(M._debugState().groundItems || {}).length;
      steps.push({ tag: "drop-to-ground", r: M._debugGrantConsumable(id, 5) });
      return { stackMax, slotCount, steps, groundBefore };
    });
    // 掉落物是先 rtSet 到 RTDB、再由訂閱回呼寫回本地 groundItems，因此要等一下才讀得到
    // （不是同步寫本地變數）。
    await page
      .waitForFunction(
        (before) => Object.keys(window.PriTestMidnight._debugState().groundItems || {}).length > before,
        stack.groundBefore,
        { timeout: 10000 }
      )
      .catch(() => {});
    const groundState = await page.evaluate(() => window.PriTestMidnight._debugState().groundItems || {});
    stack.groundAfter = Object.keys(groundState).length;
    stack.ground = groundState;
    const s1 = stack.steps[0].r;
    assert(s1.consumables.length === 1 && s1.consumables[0].usesRemaining === stack.stackMax && s1.overflow === 0, "6 個疊在同一格、無溢出", s1);
    const s2 = stack.steps[1].r;
    assert(s2.consumables.length === 2 && s2.consumables[1].usesRemaining === 1 && s2.overflow === 0, "第 7 個自動換到第 2 格", s2);
    const s3 = stack.steps[2].r;
    assert(
      s3.consumables.length === stack.slotCount && s3.overflow === 0 && s3.consumables.every((i) => i.usesRemaining === stack.stackMax),
      "4 格各 6 個＝完全填滿且無溢出",
      s3
    );
    const s4 = stack.steps[3].r;
    assert(s4.overflow === 5 && s4.granted === 0, "全滿時剩餘 5 個全部溢出", s4);
    assert(stack.groundAfter === stack.groundBefore + 1, "溢出的數量變成 1 筆地上掉落物", { before: stack.groundBefore, after: stack.groundAfter });
    const droppedEntry = Object.keys(stack.ground || {})
      .map((k) => stack.ground[k])
      .filter((g) => g.kind === "consumable" && g.itemId === "item_hero_meat_chunk")
      .pop();
    assert(droppedEntry && droppedEntry.usesRemaining === 5, "掉落物帶著正確的溢出數量 5", droppedEntry);

    // 屬性標記不同的同一品項不可互相疊加（投擲壺的「X」依取得場地而定）
    console.log("=== 1-b2 屬性標記不同的投擲壺不可疊加 ===");
    const potStack = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      c.consumables = [];
      c.consumableAttributeTags = {};
      M._debugGrantConsumable("item_throwing_pot", 2, "炎");
      const r = M._debugGrantConsumable("item_throwing_pot", 2, "雷");
      return { consumables: r.consumables, tags: c.consumableAttributeTags };
    });
    assert(potStack.consumables.length === 2, "炎壺與雷壺各佔一格，不互相疊加", potStack);

    // ------------------------------------------------------------------
    // 項目 2-a：獎勵清單不再出現英文 kind 字串
    // ------------------------------------------------------------------
    console.log("=== 2-a 獎勵清單翻譯 ===");
    const labels = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const kinds = [
        { kind: "rune", value: 10 },
        { kind: "weaponStar", value: 2 },
        { kind: "consumable" },
        { kind: "talisman" },
        { kind: "potentialPower", value: 1 },
        { kind: "attachedEffect" },
        { kind: "chaliceBonus", value: 1 },
        { kind: "stoneswordKey", value: 1 },
        { kind: "smithingStone", value: 2 },
        { kind: "weaponSkillReroll", value: 1 },
        { kind: "hpDamage", value: 10 },
        { kind: "tieredChoice" },
        { kind: "diceHandChoice" },
        { kind: "bargainReveal" },
        { kind: "note", note: { ja: "ジャ", zh: "中文備註" } },
        { kind: "totallyUnknownKind" },
      ];
      return kinds.map((e) => ({ kind: e.kind, label: M._debugRewardEntryLabel(e) }));
    });
    labels.forEach((row) => {
      assert(row.label && row.label !== row.kind, `kind "${row.kind}" 有翻譯、不是原始英文字串`, row);
      assert(!/^[A-Za-z]+$/.test(row.label), `kind "${row.kind}" 的標籤不是純英文單字`, row);
    });
    assert(labels.filter((r) => r.kind === "note")[0].label === "中文備註", "note 獎勵讀的是 entry.note（雙語物件）而不是不存在的 entry.text", labels);

    // ------------------------------------------------------------------
    // 項目 3：武器／杖／聖印的戰技在抽選當下決定
    // 期望值算法：只有「這把武器確實有 random 戰技枠」時才該有 skillId，因此用
    // CharacterDrawer 既有的 collectWeaponSkillRefs() 回頭確認，不硬編品項清單。
    // ------------------------------------------------------------------
    console.log("=== 3 獎勵武器的戰技當下抽出 ===");
    const weaponDraws = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const CD = window.PriTestCharacterDrawer;
      const W = window.PriTestWeapons;
      function hasRandomSlot(weaponId) {
        const base = weaponId.split("#")[0];
        const w = W.get(base) || W.get(weaponId);
        if (!w) return null;
        const cat = W.getCategory(w.category);
        return CD.collectWeaponSkillRefs(cat, w).some((p) => p.ref.kind === "random");
      }
      const out = [];
      for (let i = 0; i < 25; i++) {
        const d = M._debugComputeRewardDraw({ kind: "weaponStar", value: 1 });
        out.push({ weaponId: d.weaponId, skillId: d.skillId, needsSkill: d.weaponId ? hasRandomSlot(d.weaponId) : null });
      }
      // 指定大分類（聖印）的獎勵也要走同一條路
      const sacred = [];
      for (let i = 0; i < 8; i++) {
        const d = M._debugComputeRewardDraw({ kind: "weaponStar", value: 1, categoryId: "sacred_seal" });
        sacred.push({ weaponId: d.weaponId, skillId: d.skillId, needsSkill: d.weaponId ? hasRandomSlot(d.weaponId) : null });
      }
      // 共享池（多人投票）那條路徑的揭示結果也要含 skillId
      const shared = [];
      for (let i = 0; i < 12; i++) {
        const d = M._debugDrawSharedRewardData({ kind: "weaponStar", value: 1 });
        shared.push({ weaponId: d.weaponId, skillId: d.skillId || null, needsSkill: d.weaponId ? hasRandomSlot(d.weaponId) : null });
      }
      return { out, sacred, shared, categories: W.categories().map((c) => c.id) };
    });
    const personalNeed = weaponDraws.out.filter((r) => r.needsSkill === true);
    assert(personalNeed.length > 0, "25 次個人武器抽選中至少抽到 1 把有 random 戰技枠的武器（否則本項無效）", {
      n: weaponDraws.out.length,
    });
    assert(
      personalNeed.every((r) => !!r.skillId),
      "個人獎勵：有 random 戰技枠的武器，抽選當下就決定了戰技",
      personalNeed.filter((r) => !r.skillId)
    );
    assert(
      weaponDraws.out.filter((r) => r.needsSkill === false).every((r) => !r.skillId),
      "沒有 random 戰技枠的武器不會被硬塞戰技",
      weaponDraws.out.filter((r) => r.needsSkill === false && r.skillId)
    );
    const sharedNeed = weaponDraws.shared.filter((r) => r.needsSkill === true);
    assert(
      sharedNeed.length === 0 || sharedNeed.every((r) => !!r.skillId),
      "共享池揭示結果同樣帶著當下抽出的戰技（所有人看到同一個）",
      sharedNeed.filter((r) => !r.skillId)
    );
    if (weaponDraws.categories.indexOf("sacred_seal") !== -1) {
      const sealNeed = weaponDraws.sacred.filter((r) => r.needsSkill === true);
      assert(
        sealNeed.length === 0 || sealNeed.every((r) => !!r.skillId),
        "指定大分類（聖印）的武器獎勵也在當下抽出祈禱",
        sealNeed.filter((r) => !r.skillId)
      );
    }

    // ------------------------------------------------------------------
    // 項目 5：盾的戰技組成（2026-09-12 使用者依規則書逐面核對後的訂正）
    // 原本的轉錄把 {kind:"random"} 塞滿了幾乎每一面盾的兩個欄位；規則書實際上是
    // 「大部分只有 1 個共通戰技 或 1 個隨機戰技，少部分才是 1 共通＋1 隨機」。
    // 期望值就是使用者給的逐面分類（依骰目），直接寫死在下表——這是規則書內容，
    // 沒有第二個資料來源可以算回來（CLAUDE.md §4.7 原則 1 的例外）。
    // 「共通」＝這面盾固定持有的那一項（固有戰技，或蓄積無効｜X／逆手の戦技ダメージ＋N
    // 這類 note）；「隨機」＝{kind:"random"}。
    // ------------------------------------------------------------------
    console.log("=== 5 盾的戰技組成 ===");
    const shieldSpec = {
      small_shield: {
        small_shield_pursuer: "共通", small_shield_iron_bowl: "共通", small_shield_pale_blue: "隨機",
        small_shield_scripture: "隨機", small_shield_red_thorn: "隨機", small_shield_pillory: "共通",
        small_shield_buckler: "共通", small_shield_iron_round: "隨機", small_shield_gilded_iron: "共通",
        small_shield_snake: "共通", small_shield_frost_iron: "共通", small_shield_crevice: "共通",
        small_shield_incense: "隨機隨機", small_shield_sinner: "共通隨機", small_shield_horn_whirl: "共通隨機",
        small_shield_smoldering: "共通隨機", small_shield_coiled: "共通共通",
      },
      medium_shield: {
        medium_shield_hawk: "隨機", medium_shield_flame_crest: "隨機", medium_shield_round: "隨機",
        medium_shield_eaten_leather: "共通", medium_shield_heater: "隨機", medium_shield_eaten_heater: "隨機",
        medium_shield_capital_of_sun: "隨機", medium_shield_large_leather: "隨機", medium_shield_black_leather: "共通",
        medium_shield_kite: "隨機", medium_shield_locust_kite: "隨機", medium_shield_twin_bird_kite: "隨機",
        medium_shield_brass: "隨機", medium_shield_silver_bird: "共通隨機", medium_shield_beast_man: "隨機",
        medium_shield_carian_knight: "共通隨機", medium_shield_silver: "共通隨機", medium_shield_turtle: "隨機",
      },
      large_shield: {
        large_shield_guardian: "共通", large_shield_wood: "隨機", large_shield_lords_army: "隨機",
        large_shield_manor_tower: "隨機", large_shield_crossed_tree_tower: "隨機",
        large_shield_inverted_hawk_tower: "隨機", large_shield_dragon_tower: "隨機",
        large_shield_iron_thorn: "共通", large_shield_sawtooth: "共通", large_shield_sacred_painting: "隨機",
        large_shield_gold: "隨機", large_shield_holy_tree: "共通", large_shield_eaten_crest: "隨機",
        large_shield_dragon_claw: "共通隨機", large_shield_fingerprint: "共通", large_shield_golden_tree: "共通",
        large_shield_jellyfish: "共通", large_shield_ganmen: "共通", large_shield_single_eye: "共通",
      },
    };
    const shieldActual = await page.evaluate(() => {
      const W = window.PriTestWeapons;
      const out = {};
      ["small_shield", "medium_shield", "large_shield"].forEach((catId) => {
        out[catId] = {};
        W.list()
          .filter((w) => w.category === catId)
          .forEach((it) => {
            const refs = (it.attachedEffect || []).concat(it.reverseArt || []);
            out[catId][it.id] = {
              // 「共通」的實際型態是 innate 或 note，兩者都算 1 個共通項；random 算 1 個隨機項
              shape: refs
                .map((r) => (r.kind === "random" ? "隨機" : "共通"))
                .sort()
                .join(""),
              attachedRandom: (it.attachedEffect || []).some((r) => r.kind === "random"),
              reverseRandom: (it.reverseArt || []).some((r) => r.kind === "random"),
              refs: refs.map((r) => r.kind),
            };
          });
      });
      return out;
    });
    Object.keys(shieldSpec).forEach((catId) => {
      const spec = shieldSpec[catId];
      const actual = shieldActual[catId];
      Object.keys(spec).forEach((id) => {
        const got = actual[id];
        // 期望字串照 sort() 後的順序（「共通」<「隨機」在 zh 的 UTF-16 序中固定），這裡把
        // 期望值也過一次同樣的正規化，避免因為寫的順序不同而誤判。
        const want = spec[id].match(/共通|隨機/g).sort().join("");
        assert(got && got.shape === want, `${catId} ${id} 的戰技組成＝${spec[id]}`, got);
      });
      assert(
        Object.keys(actual).filter((id) => spec[id] === undefined && actual[id].refs.length > 0).length === 0,
        `${catId} 沒有規格外的多餘品項（L 稀有度佔位不含任何 ref）`,
        Object.keys(actual).filter((id) => spec[id] === undefined)
      );
    });
    // 使用者明確指示：只剩 1 個隨機枠時，該枠一律留在逆手戰技欄（reverseArt）。
    const strayAttachedRandom = [];
    Object.keys(shieldActual).forEach((catId) => {
      Object.keys(shieldActual[catId]).forEach((id) => {
        const g = shieldActual[catId][id];
        if (g.attachedRandom && !g.reverseRandom) strayAttachedRandom.push(catId + "/" + id);
      });
    });
    assert(strayAttachedRandom.length === 0, "單一隨機枠一律放在逆手戰技欄，不留在付随効果欄", strayAttachedRandom);
    // 兩個隨機枠的盾只有小盾 R1；兩枠必須分屬 attached／reverse，否則 weaponSkillSlotKey()
    // 會共用同一個儲存鍵而抽出同一個戰技。
    const twoRandom = [];
    Object.keys(shieldActual).forEach((catId) => {
      Object.keys(shieldActual[catId]).forEach((id) => {
        if (shieldActual[catId][id].attachedRandom && shieldActual[catId][id].reverseRandom) twoRandom.push(id);
      });
    });
    assert(
      twoRandom.length === 1 && twoRandom[0] === "small_shield_incense",
      "全部盾之中只有小盾 R1「調香師之盾」是兩隨機戰技",
      twoRandom
    );

    // ------------------------------------------------------------------
    // 項目 6：詳細資訊的文本縮減（2026-09-12 使用者明確規格「簡化 midnight 詳細資訊中
    // 規則上沒套用的文字、縮減化，如『此規則不套用』、前後衛資訊等等去除」）。
    // 直接對全部資料模組的規則本文跑 PriTestMidnightTextAdapt.adapt()，斷言：
    //   ① 轉換後一條都不得殘留「編隊：／隊列：」欄位
    //   ② 不得把本文刪成空字串，也不得留下「，。」「（）」「／）」「　　」這類碎屑
    //   ③ 整體字數必須比規則書原文的「膨脹率」明顯下降（改版前 +52.6%）
    // ------------------------------------------------------------------
    console.log("=== 6 詳細資訊文本縮減 ===");
    const adaptStats = await page.evaluate(() => {
      const A = window.PriTestMidnightTextAdapt;
      const W = window.PriTestWeapons;
      const rows = [];
      const pick = (o) => (o && window.PriTestConsumables.localizedText(o)) || "";
      window.PriTestConsumables.list().forEach((i) => rows.push([pick(i.name), pick(i.body)]));
      window.PriTestTalismans.list().forEach((i) => rows.push([pick(i.name), pick(i.body)]));
      W.list().forEach((w) => {
        const cat = W.getCategory(w.category);
        ((cat && cat.innateSkills) || []).forEach((s) => rows.push([pick(s.name), pick(s.body)]));
      });
      window.PriTestCharacterTypes.list().forEach((t) => {
        []
          .concat(t.skills || [], t.arts || [], t.abilities || [])
          .forEach((a) => rows.push([pick(a.name), pick(a.body)]));
        (t.relicGroups || []).forEach((g) => (g.effects || []).forEach((e) => rows.push([pick(e.name), pick(e.body)])));
      });
      const used = rows.filter((r) => r[1]);
      let orig = 0;
      let out = 0;
      const leftovers = [];
      const debris = [];
      used.forEach(([name, body]) => {
        const got = A.adapt(body, name);
        orig += body.length;
        out += got.length;
        if (/編隊：|隊列：/.test(got)) leftovers.push(name);
        if (!String(got).trim() || /[，、]。|（）|／）|　　|。。/.test(got)) debris.push(name);
      });
      return { count: used.length, orig, out, leftovers, debris };
    });
    assert(adaptStats.count > 500, "掃到足夠多的規則本文（否則本項等於空轉）", { count: adaptStats.count });
    assert(adaptStats.leftovers.length === 0, "轉換後沒有任何一條殘留「編隊：／隊列：」欄位", adaptStats.leftovers.slice(0, 8));
    assert(adaptStats.debris.length === 0, "轉換後沒有被刪空的本文，也沒有留下標點／分隔符碎屑", adaptStats.debris.slice(0, 8));
    const inflation = ((adaptStats.out - adaptStats.orig) / adaptStats.orig) * 100;
    // 改版前是 +52.6%（編隊欄位被換成更長的說明句、四條補充圖例各 44～54 字）。
    // 這裡留 25% 當上限：足以擋住「又把某個欄位改寫成長句」的回頭路，又不會因為日後多加
    // 一兩條圖例就誤報。
    assert(inflation < 25, `轉換後的總字數相對規則書原文的膨脹率 < 25%（實際 ${inflation.toFixed(1)}%，改版前為 +52.6%）`, {
      orig: adaptStats.orig,
      out: adaptStats.out,
    });
    // 逐條抽驗幾個代表性的轉換結果
    const adaptSamples = await page.evaluate(() => {
      const A = window.PriTestMidnightTextAdapt;
      const C = window.PriTestConsumables;
      const meat = C.get("item_hero_meat_chunk");
      const W = window.PriTestWeapons;
      const bash = W.getSkill("art_shield_bash");
      const spear = W.getCategory("spear");
      const backline = ((spear && spear.innateSkills) || []).filter((s) => s.id === "spear_backline_attack")[0];
      return {
        meat: A.adapt(C.localizedText(meat.body), C.localizedText(meat.name)),
        bash: A.adapt(W.localizedText(bash.body), W.localizedText(bash.name)),
        backline: backline ? A.adapt(W.localizedText(backline.body), W.localizedText(backline.name)) : "",
      };
    });
    assert(adaptSamples.meat.indexOf("編隊") === -1 && adaptSamples.meat.indexOf("使用次數：○") === -1, "消耗品本文的編隊／使用次數欄位已移除", adaptSamples.meat);
    assert(adaptSamples.bash.indexOf("短時間內內") === -1, "「1回合內」不再被轉成「短時間內內」疊字", adaptSamples.bash);
    assert(
      adaptSamples.backline.length > 0 && adaptSamples.backline.indexOf("後衛區域") === -1,
      "只由前後衛敘述構成的「後衛可攻擊」改成一行說明，不會被刪成空白",
      adaptSamples.backline
    );

    // ------------------------------------------------------------------
    // 項目 2-b／2-c／1-c：純 DOM／CSS
    // ------------------------------------------------------------------
    console.log("=== 2-b/2-c/1-c 版面與按鈕 ===");
    const ui = await page.evaluate(() => {
      // 造一個跟 renderRewardModal() 產生的結構相同的 li，量它的 gap
      const list = document.getElementById("midnight-reward-list-personal");
      const li = document.createElement("li");
      li.appendChild(document.createElement("button"));
      li.appendChild(document.createElement("button"));
      list.appendChild(li);
      const liStyle = getComputedStyle(li);
      const detail = document.getElementById("midnight-reward-detail");
      const b = document.createElement("button");
      detail.appendChild(b);
      const bStyle = getComputedStyle(b);
      const hint = document.createElement("button");
      hint.className = "midnight-draw-hint";
      document.body.appendChild(hint);
      const hintStyle = getComputedStyle(hint);
      const merchantList = document.getElementById("midnight-merchant-consumable-list");
      const merchantListStyle = merchantList ? getComputedStyle(merchantList) : null;
      const out = {
        liDisplay: liStyle.display,
        liGap: liStyle.columnGap,
        detailBtnMargin: bStyle.marginRight,
        hintAnimation: hintStyle.animationName,
        merchantListDisplay: merchantListStyle ? merchantListStyle.display : null,
        merchantListGap: merchantListStyle ? merchantListStyle.columnGap : null,
        hasMerchantDetailEl: !!document.getElementById("midnight-merchant-consumable-detail"),
        drawButtonText: window.I18N.t("midnight_reward_draw_button"),
        buyButtonText: window.I18N.t("midnight_merchant_consumable_buy_button"),
        lang: window.I18N.getLang(),
      };
      li.remove();
      b.remove();
      hint.remove();
      return out;
    });
    assert(ui.liDisplay === "flex" && parseFloat(ui.liGap) > 0, "獎勵清單同一列的多顆按鈕之間有間距", ui);
    assert(parseFloat(ui.detailBtnMargin) > 0, "獎勵詳細面板的［確認收下］／［丟棄］等按鈕有間距", ui);
    assert(ui.hintAnimation === "midnight-draw-hint-pulse", "抽選按鈕掛得上微閃黃提示動畫", ui);
    assert(ui.merchantListDisplay === "flex" && parseFloat(ui.merchantListGap) > 0, "商人消耗品清單按鈕之間有間距", ui);
    assert(ui.hasMerchantDetailEl, "商人視窗有『先看效果再確定購買』的詳細區塊", ui);
    assert(ui.drawButtonText === "抽選", "共享池與個人清單共用的按鈕文案是「抽選」（原本共享池寫「揭示」）", ui);
    assert(!!ui.buyButtonText && ui.buyButtonText !== "midnight_merchant_consumable_buy_button", "［確定購買］按鈕文案有翻譯", ui);

    // 商人兩段式購買：按下品項只顯示效果，不扣盧恩
    console.log("=== 1-c 商人購買兩段式 ===");
    const merchant = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      c.runes = 10;
      c.consumables = [];
      M._debugOpenMerchant();
      const listEl = document.getElementById("midnight-merchant-consumable-list");
      const firstBtn = listEl.querySelector("button");
      firstBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const detailEl = document.getElementById("midnight-merchant-consumable-detail");
      const afterPick = {
        runes: c.runes,
        consumables: (c.consumables || []).length,
        detailText: detailEl.textContent.trim(),
        hasBuyBtn: !!detailEl.querySelector("button"),
      };
      detailEl.querySelector("button").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const afterBuy = { runes: c.runes, consumables: (c.consumables || []).slice() };
      return { afterPick, afterBuy };
    });
    assert(merchant.afterPick.runes === 10 && merchant.afterPick.consumables === 0, "按下道具只是預覽，尚未扣盧恩也尚未取得", merchant.afterPick);
    assert(merchant.afterPick.detailText.length > 0 && merchant.afterPick.hasBuyBtn, "預覽區顯示效果本文並提供［確定購買］", merchant.afterPick);
    assert(merchant.afterBuy.runes === 9, "按下［確定購買］才扣 1 盧恩", merchant.afterBuy);
    assert(
      merchant.afterBuy.consumables.length === 1 && merchant.afterBuy.consumables[0].usesRemaining >= 2,
      "購買取得的數量套用「基本 2 個」規則",
      merchant.afterBuy
    );

    // ------------------------------------------------------------------
    // 項目 4：手機版按鈕高度
    // ------------------------------------------------------------------
    console.log("=== 4 手機版底部按鈕高度 ===");
    const desktopHeight = await page.evaluate(() => {
      const btn = document.getElementById("btn-midnight-skill");
      btn.hidden = false;
      return btn.getBoundingClientRect().height;
    });
    await page.setViewportSize({ width: 390, height: 780 });
    const mobile = await page.evaluate(() => {
      const btn = document.getElementById("btn-midnight-skill");
      btn.hidden = false;
      const st = getComputedStyle(btn);
      const icon = btn.querySelector(".midnight-icon-sword");
      return {
        height: btn.getBoundingClientRect().height,
        paddingTop: st.paddingTop,
        paddingBottom: st.paddingBottom,
        gap: st.rowGap,
        iconHeight: icon ? getComputedStyle(icon).height : null,
      };
    });
    // 期望值換算自 style.css 的手機版覆寫：padding 0.15rem（＝2.4px @16px 基準）、
    // icon 0.9rem（14.4px）。舊值分別是 0.3rem／1.1rem，因此高度必定低於桌面版。
    assert(parseFloat(mobile.paddingTop) < 4 && parseFloat(mobile.paddingBottom) < 4, "手機版按鈕上下 padding 已縮小（<4px）", mobile);
    assert(parseFloat(mobile.iconHeight) < 16, "手機版按鈕圖示已縮小（<16px）", mobile);
    assert(mobile.height < desktopHeight, "手機版按鈕整體高度低於桌面版", { desktopHeight, mobileHeight: mobile.height });

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
