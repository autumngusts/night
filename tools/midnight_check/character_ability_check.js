// ============================================================================
// midnight（即時制擴張版）角色能力真正接入——回歸測試（Firebase Local Emulator版，見
// emulator_sync_check.js開頭的環境說明，這裡沿用同一套emulator旗標/準備步驟，不重複解釋）。
// ============================================================================
// 驗證範圍（2026-09-05角色能力真正接入milestone）：
//   1. 角色技藝/技能（type.skills[0]/type.arts[0]，沒有uses欄位的類型，如隱者混成魔法）
//      使用時不再永遠顯示「無剩餘次數」，且傷害＝fixedSkillPowerValue()解算值。
//   2. 角色面板等級提升（CharacterDrawer.tryLevelUp）：盧恩費用＝目前等級+1，等級與盧恩
//      正確連動。
//   3. 角色面板遺物效果習得（relicMaxLearnable/relicCandidateFor/learnRelicEffect）：
//      擲骰後出現候選、點擊「習得」寫回learnedRelicEffects。
//   4. 遺物效果驅動的替代技藝/技能切換：習得帶variantEntry的遺物效果後，角色面板技能
//      欄位出現切換選項，切換後使用技能鍵確實改打新entry（傷害數值不同）。
//
// 使用前準備：同emulator_sync_check.js（generate.py建dist/、起本機http server、
// npm install、起firebase emulators:start --only database,auth）。
// 執行方式：node character_ability_check.js
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

async function joinLobby(page, passcode) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", passcode);
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
}

async function readyUp(page) {
  await page.click("#btn-midnight-lobby-ready");
}

async function setCharacterFields(page, gameId, tokenId, fields) {
  await page.evaluate(
    ({ gameId, tokenId, fields }) => {
      const GS = window.PriTestGameStorage;
      const jobs = Object.keys(fields).map((key) => GS.rtSet(gameId, "cloud", "character/" + tokenId + "/" + key, fields[key]));
      return Promise.all(jobs);
    },
    { gameId, tokenId, fields }
  );
  await page.waitForTimeout(300);
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
    await joinLobby(page, "1234");
    await readyUp(page);
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });

    let state = await getState(page);
    const gameId = state.gameId;
    const tokenId = state.myTokenId;
    console.log("gameId=" + gameId + " tokenId=" + tokenId);

    console.log("=== 準備：角色類型設為隱者（hermit），確認技能本文沒有uses欄位 ===");
    await setCharacterFields(page, gameId, tokenId, { typeId: "hermit", level: 1, runes: 100, learnedRelicEffects: [] });
    const typeCheck = await page.evaluate(() => {
      const type = window.PriTestCharacterTypes.get("hermit");
      return { skillUses: (type.skills || [])[0] && (type.skills || [])[0].uses };
    });
    assert(typeCheck.skillUses === undefined, "確認隱者skill[0]沒有uses欄位（本次要修正的既有缺陷前提）", results);

    console.log("=== 檢查1：角色技能（混成魔法）使用不再卡在「無剩餘次數」，傷害=fixedSkillPowerValue ===");
    // 先把共用標靶血量墊高（比照weapon_combat_check.js的既有寫法），避免傷害超過目前血量
    // 時被floor在0，導致單純的「before-after」減法斷言失真。
    await page.evaluate((gameId) => window.PriTestGameStorage.rtSet(gameId, "cloud", "demoStat/sharedTarget", 100000), gameId);
    await page.waitForTimeout(200);
    // 2026-09-08使用者明確要求「混成魔法＝消耗3屬性痕」＝midnightAbilityPrecondition()の
    // elementalMarks>=3チェック（本文にもともと「消去『屬性痕』的『3個』」と書かれていたが
    // 当時は実装されていなかった）。門檻不足時は静かに何もしない仕様なので、この前提を
    // 満たさないまま押しても扣血0になる。本検査は2026-09-05時点で書かれており前提が
    // 無かったため、ここで屬性痕を積んでから使う。
    await setCharacterFields(page, gameId, tokenId, { elementalMarks: 3 });
    const expectedBase = await page.evaluate(() => {
      const type = window.PriTestCharacterTypes.get("hermit");
      const body = window.PriTestCharacterTypes.localizedText(type.skills[0].body);
      return window.PriTestCharacterDrawer.fixedSkillPowerValue(body);
    });
    console.log("  期望基礎技能傷害：", JSON.stringify(expectedBase));
    // 2026-09-10使用者明確規格「角色技能技藝的總傷害3倍」＝midnight.jsの
    // CHARACTER_ABILITY_DAMAGE_MULT。表示（toast）は原値のまま、damageCombatTarget()へ渡す値
    // だけ×3される仕様なので、実際に削れるHPはfixedSkillPowerValue()の3倍になる。
    // この検査は2026-09-05時点で書かれており倍率導入前の原値を期待していたため追随する。
    const CHARACTER_ABILITY_DAMAGE_MULT = 3;
    const expectedSkillDamage = expectedBase.value * CHARACTER_ABILITY_DAMAGE_MULT;
    let before = (await getState(page)).demoStats.sharedTarget;
    before = before === undefined ? 20 : before;
    const skillBtnState = await page.evaluate(() => {
      const b = document.getElementById("btn-midnight-character-skill");
      const D = window.PriTestMidnight._debugState();
      const c = D.characters[D.myTokenId];
      return {
        hidden: b.hidden,
        disabled: b.disabled,
        label: (b.textContent || "").replace(/\s+/g, " ").trim(),
        cooldownUntil: c ? c._skillCooldownUntil || null : null,
        now: Date.now(),
        fp: D.fp.current,
        stamina: D.stamina.current,
      };
    });
    console.log("  技能鍵の状態:", JSON.stringify(skillBtnState));
    await page.dispatchEvent("#btn-midnight-character-skill", "click");
    await page.waitForTimeout(400);
    let after = (await getState(page)).demoStats.sharedTarget;
    assert(
      after === before - expectedSkillDamage,
      "混成魔法造成傷害＝fixedSkillPowerValue(" +
        expectedBase.value +
        ")×CHARACTER_ABILITY_DAMAGE_MULT(" +
        CHARACTER_ABILITY_DAMAGE_MULT +
        ")＝" +
        expectedSkillDamage +
        "（實際扣=" +
        (before - after) +
        "、不是卡在無次數）",
      results
    );

    console.log("=== 檢查2：角色面板等級提升（盧恩費用＝目前等級+1） ===");
    // 2026-09-06使用者明確要求「只有使用祝福後才能提升等級，不再在自己的角色卡中隨時升級」
    // ＝blessingLevelUpAvailableがfalseの間は「+」ボタンがdisabledのまま（title＝
    // midnight_level_up_needs_blessing_note）。この検査は2026-09-05時点の仕様で書かれており、
    // 前提条件を満たしていなかったため click が30秒タイムアウトしてスクリプト全体が落ちていた。
    // HUDの「使用祝福」ボタン（btn-midnight-hud-blessing-day1）はfinalCircleBossDefeated(1)
    // ——fieldTrigger/finalCircleDay1がresolved かつ fieldEnemyHp/finalCircleDay1<=0——が
    // 成立して初めて効くので、その状態をseedしてから押す（dispatchEventで押すのは、HUDの
    // 表示条件は本検査の対象外＝ボタンが非表示でもhandlerの前提は満たされているため）。
    await page.evaluate((gameId) => {
      const GS = window.PriTestGameStorage;
      return GS.rtSet(gameId, "cloud", "fieldTrigger/finalCircleDay1", { status: "resolved", enemyFamilyId: "boss", enemyId: "boss" }).then(() =>
        GS.rtSet(gameId, "cloud", "fieldEnemyHp/finalCircleDay1", 0)
      );
    }, gameId);
    await page.waitForTimeout(500);
    await page.dispatchEvent("#btn-midnight-hud-blessing-day1", "click");
    await page.waitForTimeout(400);
    // さらに2026-09-06の別変更で、等級の±列（#midnight-character-sheet-level-row）は
    // 角色面板から #midnight-blessing-modal の中へ移設された（使用者明確要求「平常在角色
    // 視窗中取消等級兩側的+-號」）。HUDの使用祝福は2026-09-10からその祝福視窗も開くので、
    // 「+」は角色面板ではなく開いた祝福視窗の中で押す。
    const blessingOpen = await page.evaluate(() => !document.getElementById("midnight-blessing-modal").hidden);
    console.log("  祝福視窗が開いたか:", blessingOpen);
    const plusEnabled = await page.evaluate(() => {
      const b = document.getElementById("btn-midnight-sheet-level-plus");
      return { disabled: b.disabled, title: b.title };
    });
    console.log("  使用祝福後の「+」ボタン:", JSON.stringify(plusEnabled));
    assert(plusEnabled.disabled === false, "使用祝福後，祝福視窗內的「+」升級鍵解除disabled", results);
    for (let i = 0; i < 3; i++) {
      await page.click("#btn-midnight-sheet-level-plus");
      await page.waitForTimeout(150);
    }
    const afterLevelUp = await getState(page);
    const c = afterLevelUp.characters[tokenId];
    assert(c.level === 4, "連續升級3次後等級＝4（期望值），實際=" + c.level, results);
    assert(c.runes === 100 - (2 + 3 + 4), "盧恩正確扣除（2+3+4=9），實際剩餘=" + c.runes, results);

    console.log("=== 檢查3：遺物效果習得（擲骰→候選→習得寫回learnedRelicEffects） ===");
    // 祝福視窗を閉じてから角色面板を開く（遺物効果の擲骰/習得UIは角色面板側にある。
    // 祝福視窗は全画面オーバーレイなので開いたままだと角色面板のボタンを押せない）。
    await page.click("#btn-midnight-blessing-close");
    await page.waitForTimeout(200);
    await page.dispatchEvent("#btn-midnight-open-character-sheet", "click"); // nudgeアニメーションでstable待ちが永久にタイムアウトするためdispatchEventで押す
    await page.waitForTimeout(200);
    const learnedBefore = (afterLevelUp.characters[tokenId].learnedRelicEffects || []).length;
    await page.click("#btn-midnight-sheet-relic-roll");
    await page.waitForTimeout(200);
    const candidateCount = await page.evaluate(
      () => document.querySelectorAll("#midnight-character-sheet-relic-candidates .midnight-relic-candidate-card").length
    );
    assert(candidateCount > 0, "擲骰後出現至少1張候選卡，實際=" + candidateCount, results);
    await page.click("#midnight-character-sheet-relic-candidates .midnight-relic-candidate-card button:last-child");
    await page.waitForTimeout(300);
    const afterLearn = await getState(page);
    const learnedAfter = (afterLearn.characters[tokenId].learnedRelicEffects || []).length;
    assert(learnedAfter === learnedBefore + 1, "習得後learnedRelicEffects+1，實際=" + learnedBefore + "→" + learnedAfter, results);

    console.log("=== 檢查4：遺物效果驅動的替代技能切換（直接寫入「冷氣風暴」relic key再驗證切換）===");
    const frostStormKey = await page.evaluate(() => {
      const type = window.PriTestCharacterTypes.get("hermit");
      let foundKey = null;
      (type.relicEffectGroups || []).forEach((g, gi) => {
        (g.effects || []).forEach((e, ei) => {
          if (e.variantEntry && e.variantEntry.id === "hybrid_magic_frost_storm") {
            foundKey = window.PriTestCharacterDrawer.relicEffectKey(type.id, gi, ei);
          }
        });
      });
      return foundKey;
    });
    assert(!!frostStormKey, "找到「冷氣風暴」遺物效果的relicEffectKey：" + frostStormKey, results);
    await page.evaluate(
      ({ gameId, tokenId, key, existing }) => {
        const next = existing.concat([key]);
        return window.PriTestGameStorage.rtSet(gameId, "cloud", "character/" + tokenId + "/learnedRelicEffects", next);
      },
      { gameId, tokenId, key: frostStormKey, existing: afterLearn.characters[tokenId].learnedRelicEffects || [] }
    );
    await page.waitForTimeout(300);
    await page.click("#btn-midnight-character-sheet-close");
    await page.dispatchEvent("#btn-midnight-open-character-sheet", "click"); // nudgeアニメーションでstable待ちが永久にタイムアウトするためdispatchEventで押す
    await page.waitForTimeout(200);
    // 2026-09-12修正：選項数は「基礎＋習得済みvariantEntryの数」なので、検査3でランダムに
    // 習得した遺物効果がたまたまvariantEntryを持っていると3個以上になる（実測3個）。
    // 固定数ではなく「2個以上あり、その中に冷氣風暴の選択肢がある」で判定する。
    const variantButtons = await page.evaluate(() =>
      Array.prototype.map.call(document.querySelectorAll("#midnight-character-sheet-skills button"), (b) => (b.textContent || "").replace(/\s+/g, " ").trim())
    );
    console.log("  技能欄位の選択肢:", JSON.stringify(variantButtons));
    const frostIndex = variantButtons.findIndex((t) => t.indexOf("冷氣風暴") !== -1 || t.indexOf("フロストストーム") !== -1 || t.indexOf("冷気") !== -1);
    assert(
      variantButtons.length >= 2 && frostIndex !== -1,
      "技能欄位出現基礎＋冷氣風暴變體的選項（實際=" + variantButtons.length + "個：" + variantButtons.join("／") + "）",
      results
    );
    // 冷氣風暴の選択肢を押して切り替える（固定でindex1を押すと、上記の通り別の変体が
    // 入ったときに違う技能へ切り替わってしまう）。
    await page.evaluate((i) => document.querySelectorAll("#midnight-character-sheet-skills button")[i].click(), frostIndex === -1 ? 1 : frostIndex);
    await page.waitForTimeout(200);
    await page.click("#btn-midnight-character-sheet-close");
    // 検査1で技能を実際に使ったので、技能は60秒（SKILL_COOLDOWN_MS）の冷却中かつ屬性痕も
    // 3個消費済み。ここは「変体へ切り替わったか」を見る検査なので、冷却と屬性痕を
    // リセットしてから押す（旧版は検査1が失敗して技能を使えていなかったため、この前提が
    // 隠れていた）。
    await setCharacterFields(page, gameId, tokenId, { _skillCooldownUntil: 0, elementalMarks: 3 });
    const expectedVariant = await page.evaluate(() => {
      const type = window.PriTestCharacterTypes.get("hermit");
      let variantEntry = null;
      (type.relicEffectGroups || []).forEach((g) => {
        (g.effects || []).forEach((e) => {
          if (e.variantEntry && e.variantEntry.id === "hybrid_magic_frost_storm") variantEntry = e.variantEntry;
        });
      });
      const body = window.PriTestCharacterTypes.localizedText(variantEntry.body);
      return window.PriTestCharacterDrawer.fixedSkillPowerValue(body);
    });
    console.log("  期望變體技能傷害：", JSON.stringify(expectedVariant));
    // 検査1と同じくCHARACTER_ABILITY_DAMAGE_MULT（×3）を掛ける。
    const expectedVariantDamage = expectedVariant.value * CHARACTER_ABILITY_DAMAGE_MULT;
    let beforeVariant = (await getState(page)).demoStats.sharedTarget;
    await page.click("#btn-midnight-character-skill");
    await page.waitForTimeout(300);
    let afterVariant = (await getState(page)).demoStats.sharedTarget;
    assert(
      afterVariant === beforeVariant - expectedVariantDamage,
      "切換後使用技能鍵造成的傷害＝變體「冷氣風暴」的" +
        expectedVariant.value +
        "×" +
        CHARACTER_ABILITY_DAMAGE_MULT +
        "＝" +
        expectedVariantDamage +
        "（非基礎值30×3），實際扣血=" +
        (beforeVariant - afterVariant),
      results
    );

    console.log("=== 檢查5：博聞強識（學者暗影被動）——消耗品等級2效果 ===");
    // 換成學者暗影（有carried_knowledge被動），給1個火花香水快速使用消耗品。
    await setCharacterFields(page, gameId, tokenId, {
      typeId: "scholar_dark",
      consumables: [{ id: "inst1", itemId: "item_perfume_spark_aroma", usesRemaining: 1 }],
    });
    await page.waitForTimeout(300);
    const beforeSpark = await getState(page);
    const beforeAccum = (beforeSpark.attributeAccum && beforeSpark.attributeAccum.sharedTarget && beforeSpark.attributeAccum.sharedTarget["炎"]) || 0;
    await page.click("#btn-midnight-use-consumable");
    await page.waitForTimeout(300);
    const afterSpark = await getState(page);
    const afterAccum = (afterSpark.attributeAccum && afterSpark.attributeAccum.sharedTarget && afterSpark.attributeAccum.sharedTarget["炎"]) || 0;
    assert(
      afterAccum === beforeAccum + 3,
      "有博聞強識時，火花香水套用等級2數值（炎+3，非等級1的+1），實際增加=" + (afterAccum - beforeAccum),
      results
    );

    console.log("\n=== 結果總覽 ===");
    const failCount = results.filter((r) => !r.pass).length;
    results.forEach((r) => console.log((r.pass ? "[PASS] " : "[FAIL] ") + r.label));
    console.log(failCount === 0 ? "\n全部通過" : "\n有 " + failCount + " 項失敗");
    process.exitCode = failCount === 0 ? 0 : 1;
  } catch (err) {
    console.error("測試腳本本身出錯：", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
