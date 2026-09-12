// ============================================================================
// midnight（即時制擴張版）消耗品／裝飾品 **實機** 回歸測試（Playwright ＋ Firebase
// Local Emulator）。對應 docs/midnight_consumable_talisman_audit.md 的 2026-09-12 批次。
// ============================================================================
// 跟同資料夾的 consumable_talisman_check.js 的分工：
//   consumable_talisman_check.js         純 node 靜態掃描，只確認「接線存在／數值常數沒被改掉」。
//   consumable_talisman_runtime_check.js（本檔）真的開瀏覽器跑遊戲，確認「算出來的數值正確」。
//
// 使用前準備（跟 emulator_sync_check.js 完全相同，見該檔開頭）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node consumable_talisman_runtime_check.js
//
// 測試手法：透過 midnight.js 的 _debug* 入口（見該檔案 window.PriTestMidnight 匯出區）
// 直接呼叫內部純函式並讀回數值，不模擬玩家逐一點按 UI——這一批效果散在攻擊/戰技/防禦/
// 受傷/蓄積 5 條計算鏈上，用 UI 操作沒辦法穩定觸發到每一條，而且要驗的是數值本身。
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

    // ---- 測試用的裝備 helper ----
    // 注意：midnight 的角色資料會被 RTDB 快照覆寫（onCharactersReceived），而
    // _debugSetTalismans() 會 rtSet 觸發一次快照。因此「只在本地改 equippedWeaponIdL」
    // 的設定會在下一個 evaluate 之前被洗掉（實測到的測試腳本陷阱，不是功能 bug——
    // 正式流程的換裝走 setEquippedWeapon()，本來就會 rtSet）。
    // 解法：把裝備動作定義成頁面上的全域函式，每個需要它的 evaluate 開頭都重新呼叫一次。
    await page.evaluate(() => {
      window.__ptEquip = function (kind) {
        const M = window.PriTestMidnight;
        const s = M._debugState();
        const c = s.characters[s.myTokenId];
        const W = window.PriTestWeapons;
        const pick = W.list().filter((w) => {
          const cat = W.getCategory(w.category);
          if (!cat) return false;
          if (kind === "shield") return !!cat.isShield;
          if (kind === "staff") return w.category === "staff";
          return !cat.isShield && !cat.isRanged && cat.id !== "staff" && cat.id !== "sacred_seal";
        })[0];
        if (!pick) return null;
        c.weaponIds = c.weaponIds || [];
        if (c.weaponIds.indexOf(pick.id) === -1) c.weaponIds.push(pick.id);
        c.equippedWeaponIdL = pick.id;
        c.equippedWeaponIdR = null;
        c.equippedWeaponIds = [pick.id];
        return pick.id;
      };
    });

    // ---- 共用：清空護符、把 HP 灌滿，讓每組測試從同一個起點開始 ----
    const reset = async (talismanIds) => {
      await page.evaluate((ids) => {
        const M = window.PriTestMidnight;
        M._debugSetTalismans(ids || []);
        const s = M._debugState();
        const c = s.characters[s.myTokenId];
        c._heroMeatUntil = 0;
        c._acidSprayUntil = 0;
        c._ironPotUntil = 0;
        c._guardValueBonusUntil = 0;
        c._greaseUntil = 0;
        c._greaseWeaponId = null;
        c._roarTwoHitUntil = 0;
      }, talismanIds);
    };

    // ======================================================================
    console.log("\n=== ① 消耗品：數值 ===");
    // 星光的碎片：FP +30（Lv1，角色沒有學者「博聞強識」被動時）
    await reset([]);
    const starlight = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const before = M._debugState().fp.current;
      M._debugApplyConsumable("item_shard_of_starlight");
      const after = M._debugState().fp.current;
      return { before, after, max: M._debugState().fp.max };
    });
    // FP 可能已經滿了（開場灌滿），滿的話回復看不出差異——先扣到 0 再測。
    const starlight2 = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      s.fp.current = 0;
      M._debugApplyConsumable("item_shard_of_starlight");
      return M._debugState().fp.current;
    });
    assert(starlight2 === Math.min(starlight.max, 30), "星光的碎片：FP +30（Lv1）", { got: starlight2, max: starlight.max });

    // 龜首漬：體力 +10
    const turtle = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const st = M._debugStaminaMax();
      // 先把體力壓低，避免撞到上限看不出差異
      M._debugState().stamina.current = 10;
      M._debugApplyConsumable("item_turtle_neck_pickle");
      return { after: M._debugStaminaMax().current, max: st.max };
    });
    assert(Math.round(turtle.after) === 20, "龜首漬：體力 +10", turtle);

    // 勇者的肉塊：10 秒內攻擊 1Hit+5／2Hit+10、戰技 +5
    await reset([]);
    const heroMeat = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const before = M._debugConsumableBuffs();
      M._debugApplyConsumable("item_hero_meat_chunk");
      return { before, after: M._debugConsumableBuffs() };
    });
    assert(
      heroMeat.before.attack.hit1 === 0 && heroMeat.after.attack.hit1 === 5 && heroMeat.after.attack.hit2 === 10 && heroMeat.after.skill === 5,
      "勇者的肉塊：攻擊 1Hit+5／2Hit+10、戰技 +5",
      heroMeat
    );

    // 調香瓶｜酸之噴霧：敵人傷害 -12（規則書 -120 ÷ 10）
    await reset([]);
    const acid = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugApplyConsumable("item_perfume_acid_spray");
      return M._debugConsumableBuffs();
    });
    assert(acid.acid === 12, "調香瓶｜酸之噴霧：敵人傷害 -12", acid);

    // 調香瓶｜鐵壺之香藥：10 秒內不受 HP 損害
    await reset([]);
    const ironPot = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugApplyConsumable("item_perfume_iron_pot_spray");
      return M._debugConsumableBuffs();
    });
    assert(ironPot.ironPot === true, "調香瓶｜鐵壺之香藥：HP 損害免疫生效", ironPot);

    // 塗脂：有盾→盾脂（HP 價值 +10）／無盾但有近戰武器→武器脂
    await reset([]);
    const grease = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugApplyConsumable("item_grease");
      const b = M._debugConsumableBuffs();
      return { guard: b.guard, greaseWeaponId: b.grease.weaponId };
    });
    assert(grease.guard === 10 || !!grease.greaseWeaponId, "塗脂：自動選到盾（HP價值+10）或武器（追加屬性）", grease);

    // 苔藥：清除自身蓄積最高的 1 種異常
    await reset([]);
    const moss = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugRecordReceivedAccum("猛毒", 2);
      const before = JSON.parse(JSON.stringify(M._debugState().receivedAttributeAccum));
      M._debugApplyConsumable("item_bitter_medicine");
      return { before, after: JSON.parse(JSON.stringify(M._debugState().receivedAttributeAccum)) };
    });
    assert(moss.before["猛毒"] === 2 && moss.after["猛毒"] === 0, "苔藥：清除累積中的異常狀態", moss);

    // ======================================================================
    console.log("\n=== ② 護符 A 組：承受屬性／異常減免 ===");
    await reset(["talisman_immune_horn_charm"]);
    const immune = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      Object.keys(s.receivedAttributeAccum).forEach((k) => delete s.receivedAttributeAccum[k]);
      M._debugRecordReceivedAccum("猛毒", 3);
      M._debugRecordReceivedAccum("出血", 3);
      return JSON.parse(JSON.stringify(M._debugState().receivedAttributeAccum));
    });
    assert(!immune["猛毒"] && immune["出血"] === 3, "免疫的角飾：無效化猛毒、不影響出血", immune);

    await reset(["talisman_dappled_horn_charm"]);
    const dappled = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      Object.keys(s.receivedAttributeAccum).forEach((k) => delete s.receivedAttributeAccum[k]);
      M._debugRecordReceivedAccum("出血", 3);
      M._debugRecordReceivedAccum("炎", 3);
      return JSON.parse(JSON.stringify(M._debugState().receivedAttributeAccum));
    });
    assert(dappled["出血"] === 2 && dappled["炎"] === 3, "斑色的角飾：異常 -1、屬性不受影響", dappled);

    await reset(["talisman_dragoncrest_pearl"]);
    const pearl = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      Object.keys(s.receivedAttributeAccum).forEach((k) => delete s.receivedAttributeAccum[k]);
      M._debugRecordReceivedAccum("炎", 3);
      M._debugRecordReceivedAccum("出血", 3);
      return JSON.parse(JSON.stringify(M._debugState().receivedAttributeAccum));
    });
    assert(pearl["炎"] === 2 && pearl["出血"] === 3, "珍珠龍紋章：屬性 -1、異常不受影響", pearl);

    // ======================================================================
    console.log("\n=== ③ 護符 B 組：PC 防禦 HP 價值 ===");
    // 需要裝備盾才有 currentGuardInfo()，先找一把盾裝上。
    const equippedShield = await page.evaluate(() => window.__ptEquip("shield"));
    if (!equippedShield) {
      assert(false, "找得到盾牌資料可供測試", null);
    } else {
      const guard = await page.evaluate(() => {
        const M = window.PriTestMidnight;
        window.__ptEquip("shield");
        M._debugSetTalismans([]);
        const base = M._debugGuardInfo(0);
        M._debugSetTalismans(["talisman_arsenal_charm"]);
        const arsenalFirst = M._debugGuardInfo(0);
        const arsenalSecond = M._debugGuardInfo(1);
        M._debugSetTalismans(["talisman_great_shield"]);
        const greatFirst = M._debugGuardInfo(0);
        const greatSecond = M._debugGuardInfo(1);
        return {
          base: base && base.pct,
          arsenalFirst: arsenalFirst && arsenalFirst.pct,
          arsenalSecond: arsenalSecond && arsenalSecond.pct,
          greatFirst: greatFirst && greatFirst.pct,
          greatSecond: greatSecond && greatSecond.pct,
        };
      });
      const cap = (v) => Math.min(100, v);
      assert(guard.arsenalFirst === cap(guard.base + 10), "樹幽羽護符：第1下 HP價值 +10", guard);
      assert(guard.arsenalSecond === guard.base, "樹幽羽護符：第2下以後不加（規則書「只有第一次」）", guard);
      assert(guard.greatSecond === cap(guard.base + 20), "大盾護符：第2下以後 HP價值 +20", guard);
      assert(guard.greatFirst === guard.base, "大盾護符：第1下不加（規則書「第2次以後」）", guard);
    }

    // ======================================================================
    console.log("\n=== ④ 護符 C／F 組：戰技・魔術・祈禱的加成與消耗 ===");
    // 裝一把杖（魔術）來驗 sorcery 相關的護符。
    const staffId = await page.evaluate(() => window.__ptEquip("staff"));
    if (!staffId) {
      assert(false, "找得到杖類武器可供測試", null);
    } else {
      const spell = await page.evaluate((wid) => {
        const M = window.PriTestMidnight;
        window.__ptEquip("staff");
        const body = "消耗：①①／FP■■　對象：敵人　威力：20＋戰技威力　效果：對對象造成【總合傷害：威力】。";
        M._debugSetTalismans([]);
        const baseCost = M._debugSkillCost(body, wid);
        const baseDmg = M._debugSkillDamage(wid, body);
        M._debugSetTalismans(["talisman_sorcerer_orb"]);
        const orbDmg = M._debugSkillDamage(wid, body);
        M._debugSetTalismans(["talisman_radagons_soreseal"]);
        const radagonCost = M._debugSkillCost(body, wid);
        M._debugSetTalismans(["talisman_primal_glintstone_blade"]);
        const glintOff = M._debugSkillCost(body, wid);
        M._debugSetTalismanToggle("talisman_primal_glintstone_blade", true);
        const glintOn = M._debugSkillCost(body, wid);
        M._debugSetTalismans(["talisman_godfreys_icon"]);
        M._debugSetTalismanToggle("talisman_godfreys_icon", true);
        const godfreyCost = M._debugSkillCost(body, wid);
        const godfreyDmg = M._debugSkillDamage(wid, body);
        return { baseCost, baseDmg, orbDmg, radagonCost, glintOff, glintOn, godfreyCost, godfreyDmg };
      }, staffId);
      assert(spell.orbDmg && spell.baseDmg && spell.orbDmg.value === spell.baseDmg.value + 5, "魔術師球護符：魔術傷害 +5", spell);
      assert(spell.radagonCost.staminaCost === spell.baseCost.staminaCost - 1, "拉塔岡的肖像：魔術消耗體力 -1", spell);
      assert(
        spell.glintOff.fpCost === spell.baseCost.fpCost && spell.glintOff.hpCost === spell.baseCost.hpCost,
        "原輝石之刃：開關關閉（預設）時維持原始消耗",
        spell
      );
      assert(
        spell.glintOn.fpCost === 0 && spell.glintOn.hpCost === spell.baseCost.hpCost + spell.baseCost.fpCost,
        "原輝石之刃：開關打開時 FP 消耗整筆改為 HP",
        spell
      );
      assert(spell.godfreyCost.staminaCost === spell.baseCost.staminaCost + 2, "戈弗雷的肖像：多付 1 顆 1 點（體力 +2）", spell);
      assert(spell.godfreyDmg.value === spell.baseDmg.value + 10, "戈弗雷的肖像：傷害 +10", spell);
    }

    // ======================================================================
    console.log("\n=== ⑤ 護符：捧鬮之劍／赤羽七支刃的 HP 刻度修正 ===");
    // 裝一把近戰武器。
    const meleeId = await page.evaluate(() => window.__ptEquip("melee"));
    if (!meleeId) {
      assert(false, "找得到近戰武器可供測試", null);
    } else {
      const hpScale = await page.evaluate(() => {
        const M = window.PriTestMidnight;
        window.__ptEquip("melee");
        const s = M._debugState();
        const myTokenId = s.myTokenId;
        // 滿血狀態（demoStat 未設定＝滿血）
        s.demoStats[myTokenId] = undefined;
        M._debugSetTalismans([]);
        const base = M._debugSideAttackInfo("L");
        M._debugSetTalismans(["talisman_sword_scorpion_charm"]);
        const fullHp = M._debugSideAttackInfo("L");
        // 掉到 1 點（遠低於 max）→ 捧鬮之劍應該失效
        s.demoStats[myTokenId] = 1;
        const lowHp = M._debugSideAttackInfo("L");
        // 赤羽七支刃：HP ≤ 30 才生效
        M._debugSetTalismans(["talisman_crimson_seven_edge"]);
        const crimsonLow = M._debugSideAttackInfo("L");
        s.demoStats[myTokenId] = undefined;
        const crimsonFull = M._debugSideAttackInfo("L");
        return { base, fullHp, lowHp, crimsonLow, crimsonFull };
      });
      assert(hpScale.fullHp.hit1 === hpScale.base.hit1 + 5, "捧鬮之劍：滿血時 1Hit +5", hpScale);
      assert(hpScale.lowHp.hit1 === hpScale.base.hit1, "捧鬮之劍：非滿血時不生效（修正前恆常生效）", hpScale);
      assert(hpScale.crimsonLow.hit1 === hpScale.base.hit1 + 5, "赤羽的七支刃：HP≤30 時 +5（修正前永不觸發）", hpScale);
      assert(hpScale.crimsonFull.hit1 === hpScale.base.hit1, "赤羽的七支刃：滿血時不生效", hpScale);

      // 大槌護符：2Hit 加上 artPower
      const greathammer = await page.evaluate(() => {
        const M = window.PriTestMidnight;
        window.__ptEquip("melee");
        M._debugSetTalismans([]);
        const base = M._debugSideAttackInfo("L");
        M._debugSetTalismans(["talisman_greathammer"]);
        const withTalisman = M._debugSideAttackInfo("L");
        return { base, withTalisman };
      });
      if (greathammer.base.hit2 === null) {
        console.log("  [SKIP] 這把武器沒有 2Hit，略過大槌護符檢查");
      } else {
        // 護符本文是「2Hit特典：總合傷害+▲」→ 2Hit 多 artPower，1Hit 不變
        assert(
          greathammer.withTalisman.hit2 === greathammer.base.hit2 + greathammer.base.artPower &&
            greathammer.withTalisman.hit1 === greathammer.base.hit1,
          "大槌護符：2Hit 傷害 +▲（artPower），1Hit 不變",
          greathammer
        );
      }

      // 咆哮系戰技 ＋ 咆哮遺物勳章
      const roar = await page.evaluate((wid) => {
        const M = window.PriTestMidnight;
        const equippedId = window.__ptEquip("melee");
        wid = equippedId || wid;
        const body =
          "消耗：FP■　對象：自身　效果：直到結束階段為止，此裝備2Hit攻擊造成的總合傷害「＋5」。若自身裝備狀態下持有護符「咆哮的勳章（201頁）」，總合傷害再「＋▲（合計＋5＋▲）」。";
        M._debugSetTalismans([]);
        const base = M._debugSideAttackInfo("L");
        const noTal = M._debugRoarArtBuff(wid, body);
        const afterNoTal = M._debugSideAttackInfo("L");
        M._debugSetTalismans(["talisman_roar_medallion"]);
        const withTal = M._debugRoarArtBuff(wid, body);
        const afterWithTal = M._debugSideAttackInfo("L");
        return { base, noTal, afterNoTal, withTal, afterWithTal };
      }, meleeId);
      assert(roar.noTal.bonus === 5, "咆哮系戰技（戰吼）：無護符時 2Hit +5", roar);
      assert(roar.withTal.bonus === 5 + roar.base.artPower, "咆哮遺物勳章：戰吼再 +▲（合計 +5+▲）", roar);
      if (roar.base.hit2 !== null) {
        assert(roar.afterWithTal.hit2 === roar.base.hit2 + roar.withTal.bonus, "咆哮 buff 確實加到 2Hit 傷害上", roar);
      }
    }

    // ======================================================================
    console.log("\n=== ⑥ 護符 E 組：體力上限／回復 ===");
    const staminaChecks = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      M._debugSetTalismans([]);
      await wait(120);
      const base = M._debugStaminaMax().max;
      M._debugSetTalismans(["talisman_green_turtle"]);
      await wait(120);
      const turtle = M._debugStaminaMax().max;
      M._debugSetTalismans(["talisman_green_turtle", "talisman_great_goat"]);
      await wait(120);
      const both = M._debugStaminaMax().max;
      M._debugSetTalismans(["talisman_dew_tear"]);
      await wait(120);
      const dew = M._debugStaminaMax().max;
      M._debugSetTalismans([]);
      return { base, turtle, both, dew };
    });
    assert(staminaChecks.turtle === staminaChecks.base + 10, "綠龜護符：體力上限 +10", staminaChecks);
    assert(staminaChecks.both === staminaChecks.base + 20, "綠龜＋大山羊：體力上限 +20（可疊加）", staminaChecks);
    assert(staminaChecks.dew === staminaChecks.base - 10, "憐憫的雫滴：體力上限 -10", staminaChecks);

    // ======================================================================
    console.log("\n=== ⑦ 雜兵血條 UI ===");
    const mobBar = await page.evaluate(() => {
      const row = document.getElementById("midnight-mob-hp-row");
      return { exists: !!row, hiddenWithoutMob: row ? row.hidden : null, fill: !!document.getElementById("midnight-mob-hp-fill") };
    });
    assert(mobBar.exists && mobBar.fill, "雜兵血條元素存在於敵人血條上排", mobBar);
    assert(mobBar.hiddenWithoutMob === true, "沒有雜兵時整列隱藏", mobBar);

    console.log("\n=== ⑧ 掉落物詳細資訊 ===");
    const groundDetail = await page.evaluate(() => {
      const body = document.getElementById("midnight-ground-item-body");
      return { exists: !!body };
    });
    assert(groundDetail.exists, "掉落物提示框有詳細資訊欄位", groundDetail);
  } catch (err) {
    console.error("\n測試過程發生例外：", err && err.message);
    results.push({ label: "測試腳本本身執行完成", pass: false });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n================ 總計 ================");
  console.log("通過 " + (results.length - failed.length) + " / " + results.length);
  if (failed.length) {
    failed.forEach((f) => console.log("  FAIL: " + f.label));
    process.exit(1);
  }
  console.log("全部通過。");
})();
