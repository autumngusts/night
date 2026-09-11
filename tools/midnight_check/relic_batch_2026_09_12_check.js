// ============================================================================
// midnight 2026-09-12 批次：A組（異常狀態達成的歡喜）＋B/C組遺物效果 回歸測試
// （Firebase Local Emulator 版，環境準備同 emulator_sync_check.js 開頭說明）。
// ============================================================================
// 驗證範圍（挑「不依賴戰鬥時序、能穩定判定」的項目；傷害加成類的數值驗證留給
// relic_batch_2026_09_11_check.js 既有的體崩/致命一擊流程）：
//   1. 異常狀態達成的歡喜：選定的異常蓄積跨過門檻時，自身 HP/FP 各 +□□（＝20）。
//   2. 盾構戰鬥的達人：刺突系＋盾裝備時體力上限 +10。
//   3. 技能強化（防禦支援）：使用「旋風」後寫入 party-wide 減傷（meta.partyDamageReduce*）。
//   4. 技藝強化（堅陣）：使用「圖騰・史黛拉」後寫入 party-wide HP價值加成（meta.partyGuardBonus*）。
//   5. 混成魔法變體快速切換鈕：習得變體遺物後出現，按下會循環 _selectedSkillVariantIndex。
//
// 執行方式：node relic_batch_2026_09_12_check.js
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

const st = (page) => page.evaluate(() => window.PriTestMidnight._debugState());
const rtSet = (page, gameId, path, value) =>
  page.evaluate(({ gameId, path, value }) => window.PriTestGameStorage.rtSet(gameId, "cloud", path, value), { gameId, path, value });

// 把角色換成指定類型並習得指定名稱的遺物效果（測試前提，不是被測流程本身——
// 習得UI另有 relic_batch_2026_09_11 等腳本涵蓋）。回傳 false＝該類型沒有這個效果。
async function setTypeAndLearn(page, gameId, tokenId, typeId, names) {
  const key = await page.evaluate(
    ({ typeId, names }) => {
      const CD = window.PriTestCharacterDrawer;
      const CT = window.PriTestCharacterTypes;
      const type = CT.get(typeId);
      if (!type) return null;
      let found = null;
      (type.relicEffectGroups || []).forEach((g, gi) =>
        (g.effects || []).forEach((e, ei) => {
          if (!found && names.indexOf((e.name && e.name.zh) || "") !== -1) found = CD.relicEffectKey(type.id, gi, ei);
        })
      );
      return found;
    },
    { typeId, names }
  );
  if (!key) return false;
  await rtSet(page, gameId, "character/" + tokenId + "/typeId", typeId);
  await rtSet(page, gameId, "character/" + tokenId + "/learnedRelicEffects", [key]);
  await page.waitForTimeout(1200);
  return true;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = [];
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

  try {
    await enableEmulatorFlag(page);
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await page.click("#midnight-lobby-slots .midnight-slot-empty button");
    await page.fill("#midnight-lobby-passcode-input", "1234");
    await page.click("#btn-midnight-lobby-join");
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });
    await page.waitForTimeout(11000); // 開場動畫

    const s0 = await st(page);
    const gameId = s0.gameId;
    const tokenId = s0.myTokenId;

    // -------------------------------------------------------------------
    console.log("=== 1. 異常狀態達成的歡喜（HP/FP 各 +20）===");
    const okJoy = await setTypeAndLearn(page, gameId, tokenId, "iron_eye", ["異常狀態達成的歡喜", "狀態異常達成的歡喜"]);
    if (!okJoy) {
      console.log("  [SKIP] iron_eye 沒有這個遺物效果");
    } else {
      await rtSet(page, gameId, "character/" + tokenId + "/relicJoyAilmentChoice", "猛毒");
      await rtSet(page, gameId, "demoStat/" + tokenId, 50);
      await page.evaluate(() => {
        window.PriTestMidnight._debugState().fp.current = 1;
      });
      // 先寫一個未達門檻的值建立基準，再跨過門檻（門檻 16，見 ATTRIBUTE_STATUS_THRESHOLD）
      await rtSet(page, gameId, "attributeAccum/sharedTarget/猛毒", 1);
      await page.waitForTimeout(900);
      const beforeJoy = await st(page);
      await rtSet(page, gameId, "attributeAccum/sharedTarget/猛毒", 16);
      await page.waitForTimeout(1200);
      const afterJoy = await st(page);
      assert(afterJoy.demoStats[tokenId] - beforeJoy.demoStats[tokenId] === 20, `達成時 HP +20（${beforeJoy.demoStats[tokenId]}→${afterJoy.demoStats[tokenId]}）`, results);
      assert(afterJoy.fp.current - beforeJoy.fp.current === 20, `達成時 FP +20（${beforeJoy.fp.current}→${afterJoy.fp.current}）`, results);
      await rtSet(page, gameId, "attributeAccum/sharedTarget/猛毒", null);
    }

    // -------------------------------------------------------------------
    console.log("=== 2. 盾構戰鬥的達人（刺突系＋盾 → 體力上限 +10）===");
    const okShield = await setTypeAndLearn(page, gameId, tokenId, "guardian_dawn", ["盾構戰鬥的達人"]);
    if (!okShield) {
      console.log("  [SKIP] guardian_dawn 沒有這個遺物效果");
    } else {
      const ids = await page.evaluate(() => {
        const W = window.PriTestWeapons;
        const rapier = W.list().filter((w) => w.category === "rapier")[0];
        const shield = W.list().filter((w) => {
          const c = W.getCategory(w.category);
          return c && c.isShield;
        })[0];
        return { rapier: rapier && rapier.id, shield: shield && shield.id };
      });
      // 先只裝刺突武器（不符合條件）→ 再補上盾（符合條件）
      await rtSet(page, gameId, "character/" + tokenId + "/weaponIds", [ids.rapier, ids.shield]);
      await rtSet(page, gameId, "character/" + tokenId + "/equippedWeaponIdR", ids.rapier);
      await rtSet(page, gameId, "character/" + tokenId + "/equippedWeaponIdL", ids.rapier);
      await page.waitForTimeout(1500);
      const maxBefore = (await st(page)).stamina.max;
      await rtSet(page, gameId, "character/" + tokenId + "/equippedWeaponIdL", ids.shield);
      await page.waitForTimeout(1500);
      const maxAfter = (await st(page)).stamina.max;
      assert(maxAfter === maxBefore + 10, `刺突系＋盾時體力上限 +10（${maxBefore}→${maxAfter}）`, results);
    }

    // -------------------------------------------------------------------
    console.log("=== 3. 技能強化（防禦支援）：旋風後 party-wide 減傷 ===");
    const okSupport = await setTypeAndLearn(page, gameId, tokenId, "guardian_dawn", ["技能強化（防禦支援）"]);
    if (!okSupport) {
      console.log("  [SKIP] guardian_dawn 沒有這個遺物效果");
    } else {
      await rtSet(page, gameId, "meta/partyDamageReduceUntil", null);
      await rtSet(page, gameId, "character/" + tokenId + "/_skillCooldownUntil", 0);
      await page.waitForTimeout(1200);
      const skillHidden = await page.evaluate(() => document.getElementById("btn-midnight-character-skill").hidden);
      if (skillHidden) {
        console.log("  [SKIP] 技能按鈕未顯示（角色類型切換後渲染時序），略過本項");
      } else {
        await page.click("#btn-midnight-character-skill");
        await page.waitForTimeout(1200);
        const m = (await st(page)).meta;
        assert((m.partyDamageReduceUntil || 0) > Date.now(), "使用旋風後寫入 party-wide 減傷時限", results);
        assert(m.partyDamageReducePct === 10, `減傷幅度 10%（實際 ${m.partyDamageReducePct}）`, results);
      }
    }

    // -------------------------------------------------------------------
    console.log("=== 4. 技藝強化（堅陣）：圖騰・史黛拉後 party-wide HP價值加成 ===");
    const okFortify = await setTypeAndLearn(page, gameId, tokenId, "ruffian_dark", ["技藝強化（堅陣）"]);
    if (!okFortify) {
      console.log("  [SKIP] ruffian_dark 沒有這個遺物效果");
    } else {
      await rtSet(page, gameId, "meta/partyGuardBonusUntil", null);
      await rtSet(page, gameId, "character/" + tokenId + "/_artCooldownUntil", 0);
      await page.waitForTimeout(1200);
      const artHidden = await page.evaluate(() => document.getElementById("btn-midnight-art").hidden);
      if (artHidden) {
        console.log("  [SKIP] 技藝按鈕未顯示，略過本項");
      } else {
        await page.click("#btn-midnight-art");
        await page.waitForTimeout(1200);
        const m2 = (await st(page)).meta;
        assert((m2.partyGuardBonusUntil || 0) > Date.now(), "使用圖騰・史黛拉後寫入 party-wide HP價值時限", results);
        assert(m2.partyGuardBonusPct === 20, `HP價值加成 +20（實際 ${m2.partyGuardBonusPct}）`, results);
      }
    }

    // -------------------------------------------------------------------
    console.log("=== 5. 混成魔法變體快速切換鈕 ===");
    const okVariant = await setTypeAndLearn(page, gameId, tokenId, "hermit_dawn", ["聖潔燈火"]);
    if (!okVariant) {
      console.log("  [SKIP] hermit_dawn 沒有「聖潔燈火」");
    } else {
      await rtSet(page, gameId, "character/" + tokenId + "/_selectedSkillVariantIndex", 0);
      await page.waitForTimeout(1200);
      const visible = await page.evaluate(() => !document.getElementById("btn-midnight-skill-variant").hidden);
      assert(visible, "習得變體遺物後出現切換鈕", results);
      if (visible) {
        const label = await page.evaluate(() => document.getElementById("btn-midnight-skill-variant").textContent);
        assert(/1\/2/.test(label), `切換鈕顯示目前/總數（${label}）`, results);
        await page.click("#btn-midnight-skill-variant");
        await page.waitForTimeout(1000);
        const idx = (await st(page)).characters[tokenId]._selectedSkillVariantIndex;
        assert(idx === 1, `按下後切到變體（_selectedSkillVariantIndex=${idx}）`, results);
      }
    }

    // -------------------------------------------------------------------
    console.log("=== 6. 靈體代受傷害（陣亡後才扣復仇者）＋靈體消滅時HP/FP回復 ===");
    const okSpirit = await setTypeAndLearn(page, gameId, tokenId, "avenger_dark", ["靈體消滅時HP回復"]);
    if (!okSpirit) {
      console.log("  [SKIP] avenger_dark 沒有「靈體消滅時HP回復」");
    } else {
      // 直接 seed 一隻靈體（召喚流程本身不是這一項的驗證目標）
      await rtSet(page, gameId, "character/" + tokenId + "/summonedSpirit", { kind: "helen", hp: 30, maxHp: 30, dmg: 10, nextAttackAt: Date.now() + 999999 });
      await rtSet(page, gameId, "demoStat/" + tokenId, 100);
      await page.waitForTimeout(1200);
      // 第一次：傷害小於靈體HP → 只扣靈體，自己不動
      const hpBefore = (await st(page)).demoStats[tokenId];
      const absorbed = await page.evaluate(() => window.PriTestMidnight._debugAbsorbDamageWithSpirit(10));
      await page.waitForTimeout(900);
      let s1 = await st(page);
      assert(absorbed === 0, `傷害10全部由靈體吸收（溢出${absorbed}）`, results);
      assert(s1.characters[tokenId].summonedSpirit && s1.characters[tokenId].summonedSpirit.hp === 20, "靈體HP 30→20", results);
      assert(s1.demoStats[tokenId] === hpBefore, "此時復仇者本人HP不變", results);
      // 第二次：傷害超過靈體剩餘HP → 靈體陣亡、溢出的部分回傳給呼叫端
      const overflow = await page.evaluate(() => window.PriTestMidnight._debugAbsorbDamageWithSpirit(35));
      await page.waitForTimeout(1200);
      let s2 = await st(page);
      assert(overflow === 15, `靈體陣亡後溢出15點（實際${overflow}）`, results);
      assert(!s2.characters[tokenId].summonedSpirit, "靈體陣亡後被清除", results);
      // 「靈體消滅時HP回復」＝□□＝20（healSelfHp 走 RTDB transaction，這裡看 demoStat）
      assert(s2.demoStats[tokenId] === hpBefore + 20, `靈體消滅時HP回復+20（${hpBefore}→${s2.demoStats[tokenId]}）`, results);
      await rtSet(page, gameId, "character/" + tokenId + "/summonedSpirit", null);
    }

    // 未習得任何變體的角色不該看到切換鈕
    await rtSet(page, gameId, "character/" + tokenId + "/learnedRelicEffects", []);
    await page.waitForTimeout(1200);
    const hiddenWhenNone = await page.evaluate(() => document.getElementById("btn-midnight-skill-variant").hidden);
    assert(hiddenWhenNone, "沒有習得變體時切換鈕隱藏", results);
  } catch (e) {
    console.log("  [ERROR]", e.message);
    results.push({ label: "腳本執行中發生例外：" + e.message, pass: false });
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== 結果：${results.length - failed.length}/${results.length} 通過 ===`);
  failed.forEach((r) => console.log("  FAIL: " + r.label));
  process.exit(failed.length ? 1 : 0);
})();
