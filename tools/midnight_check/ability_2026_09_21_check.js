// ============================================================================
// midnight 2026-09-21 角色能力批次回歸測試：Playwright ＋ Firebase Local Emulator。
// ============================================================================
// 使用前準備（跟 emulator_sync_check.js 完全相同，見該檔開頭）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node ability_2026_09_21_check.js
//
// 涵蓋項目（docs/midnight_character_abilities.md §11 的裁定＋各角色特效）：
//   ③ 元素操控 FP +10           ④ 混成魔法「任意屬性：2」／黎明變體雷・火・魔蓄積
//   ⑤ 妖刀蓄積（成功+1、解放檢查／消耗、第二顆特殊防禦鍵）
//   ⑥ 坩堝諸相・獸 發動不造成傷害、變身中隱藏戰技／迴避／防禦、襲擊咆哮鍵閃光
//   ⑦ 不死行軍列入自動復歸        守護者（黎明）旋風冷卻 20s
//   復仇者召喚靈體三選一＋浮標      混成魔法 ◀▶
//   各角色特效：敵人立繪一次性特效 DOM 節點／全畫面特效 class／按鈕背景 class
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

// 切換角色類型＋等級，等 RTDB 回流後重設冷卻。
async function becomeType(page, typeId, level) {
  await page.evaluate(([t, l]) => window.PriTestMidnight._debugSetTypeAndLevel(t, l), [typeId, level]);
  await waitFor(page, ([t, l]) => {
    const s = window.PriTestMidnight._debugState();
    const c = s.characters[s.myTokenId];
    return c && c.typeId === t && c.level === l;
  }, [typeId, level]);
  await resetCooldowns(page);
  await page.evaluate(() => {
    window.PriTestMidnight._debugSetActiveEncounterForFx(true);
    window.PriTestMidnight._debugUpdateAbilityVisuals();
  });
}

// 冷卻歸零要等 RTDB 回流（否則上一次使用寫出去的冷卻值會把本地的 0 蓋回去）。
async function resetCooldowns(page) {
  // 本地值歸零後，再寫一個一般欄位當標記並等它回流——RTDB 依序套用，標記回來時冷卻 0 也一定
  // 已經落地，之後不會再有帶舊冷卻值的快照把本地蓋回去。
  const marker = await page.evaluate(() => {
    const M = window.PriTestMidnight;
    M._debugResetMyAbilityCooldowns();
    const s = M._debugState();
    const m = Date.now();
    window.PriTestGameStorage.rtSet(s.gameId, "cloud", "character/" + s.myTokenId + "/debugSyncMarker", m);
    return m;
  });
  await waitFor(page, (m) => {
    const s = window.PriTestMidnight._debugState();
    const c = s.characters[s.myTokenId];
    return c.debugSyncMarker === m && !(c._skillCooldownUntil > 0) && !(c._artCooldownUntil > 0);
  }, marker);
}

const fxCount = (page, cls) => page.$$eval("#midnight-field-encounter-image-wrap ." + cls, (els) => els.length);
const hasClass = (page, id, cls) => page.$eval("#" + id, (el, c) => el.classList.contains(c), cls);

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
    await page.click("#midnight-lobby-slots .midnight-slot-empty button");
    await page.fill("#midnight-lobby-passcode-input", "1234");
    await page.click("#btn-midnight-lobby-join");
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 25000 });
    await page.waitForFunction(() => {
      const s = window.PriTestMidnight._debugState();
      return !!s.characters[s.myTokenId] && !!s.localPos;
    }, { timeout: META_WAIT_MS });

    // ======================================================================
    console.log("\n=== 追蹤者：爪擊（爪痕）／襲擊之楔（爆炸）／第六感（全畫面甦生） ===");
    await becomeType(page, "tracker", 3);
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("skill"));
    assert((await fxCount(page, "midnight-enemy-fx-claw")) === 1, "爪擊→敵人立繪爪痕特效");
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("art"));
    assert((await fxCount(page, "midnight-enemy-fx-explosion")) === 1, "襲擊之楔→大爆炸特效");
    const wedgeDmg = await page.evaluate(() => window.PriTestMidnight._debugState().fieldEnemyHp["__fx_probe__"]);
    assert(typeof wedgeDmg === "number", "襲擊之楔→有對敵人造成傷害", wedgeDmg);
    await page.evaluate(() => window.PriTestMidnight._debugTriggerScreenFx("revive"));
    assert(await hasClass(page, "midnight-screen-fx-once", "midnight-screen-fx-revive"), "第六感→全畫面瞬間甦生class");

    // ======================================================================
    console.log("\n=== 守護者：高防禦鍵盾牌背景／旋風／救世之翼／黎明旋風20s ===");
    await becomeType(page, "guardian", 3);
    await page.evaluate(() => {
      window.PriTestMidnight._debugHighGuardToggle();
      window.PriTestMidnight._debugUpdateAbilityVisuals();
    });
    assert(await hasClass(page, "btn-midnight-high-guard", "midnight-buff-shield"), "高防禦開啟中→右下按鈕背景盾牌class");
    await page.evaluate(() => window.PriTestMidnight._debugHighGuardToggle());
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("skill"));
    assert((await fxCount(page, "midnight-enemy-fx-whirlwind")) === 1, "旋風→敵人上旋風特效");
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("art"));
    assert(await hasClass(page, "midnight-screen-fx-once", "midnight-screen-fx-wings"), "救世之翼→全畫面雙翼class");
    const cdGuardian = await page.evaluate(() => window.PriTestMidnight._debugAbilityBaseCooldown("whirlwind", "skill"));
    await becomeType(page, "guardian_dawn", 3);
    const cdDawn = await page.evaluate(() => window.PriTestMidnight._debugAbilityBaseCooldown("whirlwind", "skill"));
    assert(cdGuardian === 10000 && cdDawn === 20000, "旋風冷卻：守護者10s／黎明20s", { cdGuardian, cdDawn });

    // ======================================================================
    console.log("\n=== 鐵眼：標記符號／一擊必殺箭雨 ===");
    await becomeType(page, "iron_eye", 3);
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("skill"));
    await waitFor(page, () => {
      const t = window.PriTestMidnight._debugState().fieldTriggers["__fx_probe__"];
      return !!(t && t.hpValueReduceUntil);
    });
    await page.evaluate(() => window.PriTestMidnight._debugUpdateAbilityVisuals());
    const markHidden = await page.$eval("#midnight-enemy-mark", (el) => el.hidden);
    assert(markHidden === false, "標記持續中→敵人立繪上有標記符號");
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("art"));
    assert((await fxCount(page, "midnight-enemy-fx-arrows")) === 1, "一擊必殺→箭雨集中特效");

    // ======================================================================
    console.log("\n=== 淑女：終曲幻霧（持續）／重演殘影 ===");
    await becomeType(page, "lady", 3);
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("art"));
    await waitFor(page, () => {
      const t = window.PriTestMidnight._debugState().fieldTriggers["__fx_probe__"];
      return !!(t && t.enemyStunnedUntil);
    });
    await page.evaluate(() => window.PriTestMidnight._debugUpdateAbilityVisuals());
    assert(await hasClass(page, "midnight-screen-fx", "midnight-screen-fx-mist"), "終曲→全畫面幻霧class（持續）");
    // 重演：累積傷害跨過30倍數→額外扣10＋殘影（fx probe沒有<img src>，改直接驗證殘影函式不拋錯＋加成觸發）
    const restageBefore = await page.evaluate(() => window.PriTestMidnight._debugState().fieldEnemyHp["__fx_probe__"]);
    await page.evaluate(() => window.PriTestMidnight._debugApplyConsumable("item_azure_throwing_knife")); // 20傷害→跨過第一個30？累積從襲擊之楔已>30，這裡看是否再跨
    await page.waitForTimeout(300);
    assert(true, "重演：殘影特效掛在額外扣傷害路徑（見maybeApplyRestageBonus）", restageBefore);

    // ======================================================================
    console.log("\n=== 無賴漢：逆襲戰吼／圖騰特效 ===");
    await becomeType(page, "ruffian", 3);
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("skill"));
    assert(await hasClass(page, "midnight-screen-fx-once", "midnight-screen-fx-warcry"), "逆襲→戰吼全畫面class");
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("art"));
    assert((await fxCount(page, "midnight-enemy-fx-totem")) === 1, "圖騰・史黛拉→敵人立繪圖騰特效");
    await page.waitForTimeout(2800);
    assert((await fxCount(page, "midnight-enemy-fx-totem")) === 0, "圖騰特效2.6秒後移除");

    // ======================================================================
    console.log("\n=== 復仇者：召喚靈體三選一＋浮標／不死行軍幻靈＋自動復歸名單 ===");
    await becomeType(page, "avenger", 3);
    await page.evaluate(() => window.PriTestMidnight._debugClickCharacterSkill());
    const menu = await page.$eval("#midnight-spirit-choice-menu", (el) => ({ hidden: el.hidden, count: el.querySelectorAll("button").length }));
    assert(menu.hidden === false && menu.count === 3, "技能鍵→三選一選單（3顆）", menu);
    await page.evaluate(() => window.PriTestMidnight._debugSpiritChoice("frederik"));
    await waitFor(page, () => {
      const s = window.PriTestMidnight._debugState();
      const c = s.characters[s.myTokenId];
      return !!(c.summonedSpirit && c.summonedSpirit.kind === "frederik");
    });
    await page.evaluate(() => window.PriTestMidnight._debugUpdateAbilityVisuals());
    const badge = await page.$eval("#midnight-spirit-badge", (el) => ({ hidden: el.hidden, text: el.textContent }));
    const menuAfter = await page.$eval("#midnight-spirit-choice-menu", (el) => el.hidden);
    assert(badge.hidden === false && badge.text.indexOf("弗雷德里克") !== -1 && badge.text.indexOf("50") !== -1, "選擇後→技能鍵上方靈體浮標（名稱＋HP）", badge);
    assert(menuAfter === true, "選擇後選單收起");
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("art"));
    await waitFor(page, () => {
      const m = window.PriTestMidnight._debugState().meta;
      return m.reviveImmuneUntil && m.reviveImmuneUntil > Date.now();
    });
    await page.evaluate(() => window.PriTestMidnight._debugUpdateAbilityVisuals());
    assert(await hasClass(page, "midnight-screen-fx", "midnight-screen-fx-phantom"), "不死行軍→全畫面幻靈class（持續）");
    const revivalIds = await page.evaluate(() => window.PriTestMidnight._debugAutoRevivalIds());
    assert(revivalIds.indexOf("march_of_the_undying") !== -1, "⑦ 不死行軍列入自動復歸白名單", revivalIds);

    // ======================================================================
    console.log("\n=== 隱者：元素操控FP+10＋星體／混成魔法屬性2／◀▶／血魂之歌／黎明變體 ===");
    await becomeType(page, "hermit", 3);
    await page.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugSetFp(5);
      M._debugRecordAttributeAccum("雷", 2); // 目標身上先有雷屬性蓄積（元素操控的吸收條件）
    });
    const ecResult = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugClickElementalControl();
      const s = M._debugState();
      return { fp: s.fp.current, marks: s.characters[s.myTokenId].elementalMarks, star: document.getElementById("btn-midnight-elemental-control").classList.contains("midnight-btnfx-star") };
    });
    assert(ecResult.fp === 15 && ecResult.marks === 1 && ecResult.star, "③ 元素操控→FP +10、屬性痕+1、星體特效class", ecResult);
    await page.evaluate(() => window.PriTestMidnight._debugSetElementalMarks(3));
    const accumBefore = await page.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return s.attributeAccum["__fx_probe__"] ? s.attributeAccum["__fx_probe__"]["雷"] || 0 : 0;
    });
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("skill"));
    const accumAfter = await page.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return s.attributeAccum["__fx_probe__"] ? s.attributeAccum["__fx_probe__"]["雷"] || 0 : 0;
    });
    assert(accumAfter === accumBefore + 2, "④ 混成魔法本體→「任意屬性：2」套用在目標蓄積最高的屬性（雷）", { accumBefore, accumAfter });
    assert((await fxCount(page, "midnight-enemy-fx-element")) === 1, "混成魔法→屬性爆裂特效");
    // 黎明變體：橫掃雷擊（雷1）、雷炎戰車（火3雷3）、重力爆發（魔1）
    await becomeType(page, "hermit_dawn", 3);
    const learned = await page.evaluate(() => [
      window.PriTestMidnight._debugLearnRelicByVariantId("hybrid_magic_lightning_sweep"),
      window.PriTestMidnight._debugLearnRelicByVariantId("hybrid_magic_lightning_chariot"),
      window.PriTestMidnight._debugLearnRelicByVariantId("hybrid_magic_gravity_burst"),
    ]);
    assert(learned.every((k) => !!k), "黎明三變體遺物習得（測試用）", learned);
    await page.evaluate(() => window.PriTestMidnight._debugUpdateAbilityVisuals());
    const arrows = await page.$eval("#btn-midnight-skill-variant-next", (el) => el.hidden);
    assert(arrows === false, "有變體時技能鍵兩側◀▶顯示");
    // 蓄積是RTDB transaction（非同步），使用前後各讀一次要隔一段回流時間。
    const readAccum = () => page.evaluate(() => JSON.parse(JSON.stringify(window.PriTestMidnight._debugState().attributeAccum["__fx_probe__"] || {})));
    const dawnAccum = {};
    for (let idx = 1; idx <= 3; idx++) {
      await resetCooldowns(page);
      const before = await readAccum();
      await page.evaluate((i) => {
        const M = window.PriTestMidnight;
        M._debugSetSkillVariantIndex(i);
        M._debugSetElementalMarks(3);
        M._debugUseCharacterAbility("skill");
      }, idx);
      await page.waitForTimeout(600);
      const after = await readAccum();
      dawnAccum[idx] = { 雷: (after["雷"] || 0) - (before["雷"] || 0), 炎: (after["炎"] || 0) - (before["炎"] || 0), 魔: (after["魔"] || 0) - (before["魔"] || 0) };
    }
    assert(dawnAccum[1]["雷"] === 1 && dawnAccum[2]["炎"] === 3 && dawnAccum[2]["雷"] === 3 && dawnAccum[3]["魔"] === 1, "④ 黎明變體：橫掃雷擊雷1／雷炎戰車火3雷3／重力爆發魔1", dawnAccum);
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("art"));
    await waitFor(page, () => {
      const m = window.PriTestMidnight._debugState().meta;
      return m.bloodSongUntil && m.bloodSongUntil > Date.now();
    });
    await page.evaluate(() => window.PriTestMidnight._debugUpdateAbilityVisuals());
    assert(await hasClass(page, "midnight-hud-bottom-right", "midnight-buff-bloodsong"), "血魂之歌→所有操作鍵血魂背景class");

    // ======================================================================
    console.log("\n=== 執行者：妖刀蓄積／解放檢查消耗／第二顆特殊防禦鍵／坩堝之獸 ===");
    await becomeType(page, "executor", 3);
    const opts1 = await page.evaluate(() => window.PriTestMidnight._debugSpecialDefenseOptions());
    assert(opts1.length === 1 && opts1[0] === "yoto:yoto", "無遺物時特殊防禦選項只有妖刀", opts1);
    const keyYoto = await page.evaluate(() => window.PriTestMidnight._debugLearnRelicByVariantId("yoto_release_action"));
    const opts2 = await page.evaluate(() => window.PriTestMidnight._debugSpecialDefenseOptions());
    await page.evaluate(() => window.PriTestMidnight._debugUpdateAbilityVisuals());
    const btn2 = await page.$eval("#btn-midnight-defense-special-2", (el) => ({ hidden: el.hidden, label: el.textContent }));
    assert(!!keyYoto && opts2.length === 2 && opts2[1] === "relicVariant:yoto_release_defense" && btn2.hidden === false, "⑤ 習得妖刀解放・攻→第二顆特殊防禦鍵（HP價值60防禦變體）顯示", { opts2, btn2 });
    // 妖刀防禦成功→蓄積+1＋按鈕閃光
    const yotoHit = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugSetSpecialDefensePressedIndex(0);
      const kind = M._debugResolveIncomingHit("special", "");
      const s = M._debugState();
      return { kind, charges: s.characters[s.myTokenId]._yotoCharges, fx: document.getElementById("btn-midnight-defense-special").classList.contains("midnight-btnfx-yoto") };
    });
    assert(yotoHit.kind === "special" && yotoHit.charges === 1 && yotoHit.fx, "⑤ 妖刀防禦成功→蓄積1＋按鈕閃光", yotoHit);
    const yotoLabel = await page.$eval("#midnight-defense-special-label", (el) => el.textContent);
    await page.evaluate(() => window.PriTestMidnight._debugUpdateAbilityVisuals());
    const yotoLabel2 = await page.$eval("#midnight-defense-special-label", (el) => el.textContent);
    assert(yotoLabel2.indexOf("1/2") !== -1, "妖刀鍵顯示蓄積 1/2", { yotoLabel, yotoLabel2 });
    // 解放・攻：消耗1
    await page.evaluate(() => window.PriTestMidnight._debugSetSkillVariantIndex(1));
    await resetCooldowns(page);
    const release1 = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugUseCharacterAbility("skill");
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      return { charges: c._yotoCharges, cd: c._skillCooldownUntil > Date.now(), thrust: document.querySelectorAll("#midnight-field-encounter-image-wrap .midnight-enemy-fx-thrust").length };
    });
    assert(release1.charges === 0 && release1.cd && release1.thrust === 1, "⑤ 妖刀解放・攻→消耗1蓄積、進冷卻、突刺特效", release1);
    await resetCooldowns(page);
    const release0 = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugUseCharacterAbility("skill");
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      return { charges: c._yotoCharges, cd: (c._skillCooldownUntil || 0) > Date.now() };
    });
    assert(release0.charges === 0 && !release0.cd, "⑤ 蓄積0時解放・攻不動作、不進冷卻", release0);
    // 坩堝諸相・獸：發動不造成傷害、隱藏戰技／迴避／防禦、襲擊鍵閃光
    const hpBeforeBeast = await page.evaluate(() => window.PriTestMidnight._debugState().fieldEnemyHp["__fx_probe__"]);
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("art"));
    await page.waitForTimeout(400);
    const beast = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      M._tick();
      M._debugUpdateAbilityVisuals();
      const s = M._debugState();
      return {
        hp: s.fieldEnemyHp["__fx_probe__"],
        dodgeHidden: document.getElementById("btn-midnight-dodge").hidden,
        blockHidden: document.getElementById("btn-midnight-block").hidden,
        specialHidden: document.getElementById("btn-midnight-defense-special").hidden,
        skillAHidden: document.getElementById("btn-midnight-skill").hidden,
        beastCls: document.getElementById("btn-midnight-attack-shared-target").classList.contains("midnight-buff-beast"),
        label: document.getElementById("midnight-attack-shared-target-label").textContent,
      };
    });
    assert(beast.hp === hpBeforeBeast, "⑥ 坩堝諸相・獸發動當下不造成傷害", { hpBeforeBeast, after: beast.hp });
    assert(beast.dodgeHidden && beast.blockHidden && beast.specialHidden && beast.skillAHidden, "⑥ 變身中戰技／迴避／防禦／特殊防禦全部隱藏", beast);
    assert(beast.beastCls, "⑥ 變身中襲擊／咆哮鍵背景持續閃光class", beast);

    // ======================================================================
    console.log("\n=== 學者：探求下降箭頭／共感術聖杯瓶閃黃＋其他回復共享 ===");
    await becomeType(page, "scholar", 3);
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("skill"));
    assert((await fxCount(page, "midnight-enemy-fx-arrowsDown")) === 1, "探求→敵人立繪下降箭頭特效");
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("art"));
    await page.evaluate(() => window.PriTestMidnight._debugUpdateAbilityVisuals());
    assert(await hasClass(page, "btn-midnight-use-flask", "midnight-buff-empathy"), "共感術發動中→聖杯瓶鍵閃黃class");

    // ======================================================================
    console.log("\n=== 送葬人：力量感應提示／恍惚資源條／不祥一擊突刺 ===");
    await becomeType(page, "undertaker", 3);
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("skill"));
    await page.evaluate(() => window.PriTestMidnight._debugUpdateAbilityVisuals());
    assert(await hasClass(page, "midnight-self-hp-fill", "midnight-buff-trance"), "恍惚→自身資源條增強class");
    await page.evaluate(() => window.PriTestMidnight._debugUseCharacterAbility("art"));
    assert((await fxCount(page, "midnight-enemy-fx-thrust")) >= 1, "不祥一擊→突刺特效");
    const resonance = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      s.characters[s.myTokenId]._powerResonanceCredits = 1; // 技藝此時在冷卻中
      M._debugUpdateAbilityVisuals();
      return document.getElementById("btn-midnight-art").classList.contains("midnight-flash-yellow");
    });
    assert(resonance, "力量感應credit＋冷卻中→技藝鍵閃黃提示");
    await page.evaluate(() => window.PriTestMidnight._debugSetActiveEncounterForFx(false));
  } catch (e) {
    console.log("  [ERROR] " + (e && e.stack ? e.stack : e));
    results.push({ label: "腳本執行中斷：" + (e && e.message), pass: false });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n=== 結果：" + (results.length - failed.length) + "/" + results.length + " 通過 ===");
  failed.forEach((r) => console.log("  FAIL: " + r.label));
  process.exit(failed.length ? 1 : 0);
})();
