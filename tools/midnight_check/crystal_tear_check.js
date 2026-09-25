// ============================================================================
// 結晶雫（2026-09-25 第 7 期，設計文件 §10.16）
// ----------------------------------------------------------------------------
// 驗三件事：
//   1. 換算表（RM_CRYSTAL_TEARS）與目錄對得起來——目錄 22 條 startFlask，21 條要有實作，
//      剩下的「細枝の割れ雫」要被 d 旗標排除在抽選池外（使用者明確指示「不能抽到 建檔」）。
//   2. 每一條雫生效時，實際計算點算出來的值會變（不是只有旗標在動）。期望值一律從換算表
//      自己的 value 推出來，不硬編（CLAUDE.md §4.7 原則 1）。
//   3. 「只能存在一件」：帶入多顆含雫的記憶時只挑到第一條。
//
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8791 --directory dist
// 執行：node crystal_tear_check.js
// ============================================================================
const { chromium } = require("playwright");
const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let fails = 0;
  const assert = (c, l) => {
    console.log((c ? "  [PASS] " : "  [FAIL] ") + l);
    if (!c) fails++;
  };
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  try {
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });

    // ------------------------------------------------------------------ 換算表
    const info = await page.evaluate(() => window.PriTestMidnight._debugCrystalTears());
    console.log("-- 換算表 RM_CRYSTAL_TEARS（" + info.count + " 條）--");

    assert(info.count === 21, "實作 21 條（目錄 22 條 startFlask 扣掉不接的細枝，實得 " + info.count + "）");
    assert(info.catalogFlaskIds.length === 22, "目錄有 22 條 startFlask（實得 " + info.catalogFlaskIds.length + "）");

    const notInCatalog = info.rows.filter((r) => !r.effectExists);
    assert(notInCatalog.length === 0, "表上每一條的效果 id 都存在於目錄" + (notInCatalog.length ? "：" + notInCatalog.map((r) => r.id).join("、") : ""));

    const wrongKind = info.rows.filter((r) => r.effectExists && r.catalogKind !== "startFlask");
    assert(wrongKind.length === 0, "表上每一條在目錄裡的 kind 都是 startFlask" + (wrongKind.length ? "：" + wrongKind.map((r) => r.id).join("、") : ""));

    const notDrawable = info.rows.filter((r) => !r.drawable);
    assert(notDrawable.length === 0, "已實作的 21 條都抽得到" + (notDrawable.length ? "：" + notDrawable.map((r) => r.id).join("、") : ""));

    const noNote = info.rows.filter((r) => !r.note);
    assert(noNote.length === 0, "每一條在目錄上都有換算說明（角色視窗就是顯示這段）" + (noNote.length ? "：" + noNote.map((r) => r.id).join("、") : ""));

    const noName = info.rows.filter((r) => !r.name || r.name.indexOf("出撃時") === 0);
    assert(noName.length === 0, "每一條都解析得出雫本身的名稱（不是整句「出撃時に…を持つ」）" + (noName.length ? "：" + noName.map((r) => r.id).join("、") : ""));

    // 目錄有、表上沒有的那一條必須剛好是細枝，而且必須抽不到。
    const implemented = new Set(info.rows.map((r) => r.id));
    const missing = info.catalogFlaskIds.filter((id) => !implemented.has(id));
    assert(missing.length === 1 && missing[0] === "rm_start_twiggy_cracked_tear", "沒實作的剛好只有細枝の割れ雫（實得 " + JSON.stringify(missing) + "）");

    const twiggyDrawable = await page.evaluate(() =>
      window.PriTestMidnightRelicMemoryCatalog.drawableEffectIds().indexOf("rm_start_twiggy_cracked_tear")
    );
    assert(twiggyDrawable === -1, "細枝の割れ雫不在抽選池裡（使用者明確指示「不能抽到 建檔」）");

    // ------------------------------------------------------------- 「只能存在一件」
    console.log("");
    console.log("-- 只能存在一件 --");
    const picked = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const mk = (memId, ids) => ({ memId: memId, size: "m", effects: ids.map((id) => ({ id: id })) });
      return {
        none: MN._debugCrystalTears([mk("m1", ["rm_max_hp_up"])]).picked,
        one: MN._debugCrystalTears([mk("m1", ["rm_max_hp_up", "rm_start_leaden_hardtear"])]).picked,
        two: MN._debugCrystalTears([mk("m1", ["rm_start_leaden_hardtear"]), mk("m2", ["rm_start_crimson_crystal_tear"])]).picked,
      };
    });
    assert(picked.none === "", "沒有任何雫效果時挑不到（實得 " + JSON.stringify(picked.none) + "）");
    assert(picked.one === "rm_start_leaden_hardtear", "記憶裡有一條雫 → 挑到它（實得 " + picked.one + "）");
    assert(picked.two === "rm_start_leaden_hardtear", "帶入兩顆各有一條雫 → 只取帶入順序的第一條（實得 " + picked.two + "）");

    // ---------------------------------------------------------------- 實際計算點
    console.log("");
    console.log("-- 生效時各計算點的實得值 --");
    const probe = await page.evaluate((ids) => {
      const MN = window.PriTestMidnight;
      const out = { base: MN._debugCrystalTearCompute(null) };
      ids.forEach((id) => {
        out[id] = MN._debugCrystalTearCompute(id);
      });
      return out;
    }, info.rows.map((r) => r.id));

    const base = probe.base;
    const val = (id) => info.rows.filter((r) => r.id === id)[0].value;

    // 緋溢れの結晶雫：最大HP+30（flat）
    assert(
      probe.rm_start_crimson_overflow_tear.hpMax === base.hpMax + val("rm_start_crimson_overflow_tear"),
      "緋溢れの結晶雫 → 最大HP +" + val("rm_start_crimson_overflow_tear") + "（" + base.hpMax + " → " + probe.rm_start_crimson_overflow_tear.hpMax + "）"
    );

    // 真珠色の硬雫：HP價值+20
    assert(
      probe.rm_start_opaline_hardtear.guardBonusPct === base.guardBonusPct + val("rm_start_opaline_hardtear"),
      "真珠色の硬雫 → HP價值 +" + val("rm_start_opaline_hardtear") + "（實得 " + probe.rm_start_opaline_hardtear.guardBonusPct + "）"
    );

    // 斑彩色の硬雫：蓄積上限+2
    assert(
      probe.rm_start_iridescent_hardtear.accumThreshold === base.accumThreshold + val("rm_start_iridescent_hardtear"),
      "斑彩色の硬雫 → 蓄積觸發門檻 +" + val("rm_start_iridescent_hardtear") + "（" + base.accumThreshold + " → " + probe.rm_start_iridescent_hardtear.accumThreshold + "）"
    );

    // 鉛色の硬雫：減傷20%
    assert(
      probe.rm_start_leaden_hardtear.damageCutPct === val("rm_start_leaden_hardtear") && base.damageCutPct === 0,
      "鉛色の硬雫 → 減傷 " + val("rm_start_leaden_hardtear") + "%（基準 0，實得 " + probe.rm_start_leaden_hardtear.damageCutPct + "）"
    );

    // 緑湧きの結晶雫：20秒60 → 每秒3
    const greenRow = info.rows.filter((r) => r.id === "rm_start_greenburst_crystal_tear")[0];
    const expectRegen = greenRow.value / (greenRow.ms / 1000);
    assert(
      near(probe.rm_start_greenburst_crystal_tear.staminaRegenPerSec, expectRegen) && base.staminaRegenPerSec === 0,
      "緑湧きの結晶雫 → 體力回復 " + greenRow.value + "/" + greenRow.ms / 1000 + "s = " + expectRegen + "/秒（實得 " + probe.rm_start_greenburst_crystal_tear.staminaRegenPerSec + "）"
    );

    // 青色の秘雫：FP消耗0
    assert(probe.rm_start_cerulean_hidden_tear.noFpCost && !base.noFpCost, "青色の秘雫 → FP消耗歸零旗標成立");

    // 岩棘の割れ雫：20%機率
    assert(
      probe.rm_start_stonebarb_cracked_tear.staggerPct === val("rm_start_stonebarb_cracked_tear") && base.staggerPct === 0,
      "岩棘の割れ雫 → 攻擊帶▲的機率 " + val("rm_start_stonebarb_cracked_tear") + "%（實得 " + probe.rm_start_stonebarb_cracked_tear.staggerPct + "）"
    );

    // 真珠色の泡雫：限一次減傷80%（consumeCrystalTearOnceCut 會當場消耗）
    assert(
      probe.rm_start_opaline_bubbletear.onceCut === val("rm_start_opaline_bubbletear") && base.onceCut === 0,
      "真珠色の泡雫 → 一次性減傷 " + val("rm_start_opaline_bubbletear") + "%（實得 " + probe.rm_start_opaline_bubbletear.onceCut + "）"
    );

    // 風の結晶雫：受到傷害 +20%
    assert(
      near(probe.rm_start_winged_crystal_tear.incomingMult, base.incomingMult * (1 + val("rm_start_winged_crystal_tear") / 100)),
      "風の結晶雫 → 受到傷害倍率 ×" + (1 + val("rm_start_winged_crystal_tear") / 100) + "（" + base.incomingMult + " → " + probe.rm_start_winged_crystal_tear.incomingMult + "）"
    );

    // 大棘／連棘：只對蓄力／2hit 加，一般攻擊不變
    const bigBarb = probe.rm_start_greatbarb_cracked_tear;
    assert(
      near(bigBarb.chargeMult, base.chargeMult + val("rm_start_greatbarb_cracked_tear") / 100) && near(bigBarb.plainMult, base.plainMult),
      "大棘の割れ雫 → 蓄力攻擊 +" + val("rm_start_greatbarb_cracked_tear") + "%、一般攻擊不變（實得 charge " + bigBarb.chargeMult + " / plain " + bigBarb.plainMult + "）"
    );
    const spiked = probe.rm_start_spiked_cracked_tear;
    assert(
      near(spiked.twoHitMult, base.twoHitMult + val("rm_start_spiked_cracked_tear") / 100) && near(spiked.plainMult, base.plainMult),
      "連棘の割れ雫 → 2hit攻擊 +" + val("rm_start_spiked_cracked_tear") + "%、一般攻擊不變（實得 twoHit " + spiked.twoHitMult + " / plain " + spiked.plainMult + "）"
    );

    // 纏いの割れ雫 4 種：只對自己那一個屬性加
    const flame = probe.rm_start_flame_shrouding_cracked_tear;
    assert(
      near(flame.fireMult, base.fireMult + val("rm_start_flame_shrouding_cracked_tear") / 100) && near(flame.magicMult, base.magicMult),
      "炎纏いの割れ雫 → 炎屬性 +" + val("rm_start_flame_shrouding_cracked_tear") + "%、魔屬性不變（實得 fire " + flame.fireMult + " / magic " + flame.magicMult + "）"
    );
    const magic = probe.rm_start_magic_shrouding_cracked_tear;
    assert(
      near(magic.magicMult, base.magicMult + val("rm_start_magic_shrouding_cracked_tear") / 100) && near(magic.fireMult, base.fireMult),
      "魔力纏いの割れ雫 → 魔屬性 +" + val("rm_start_magic_shrouding_cracked_tear") + "%、炎屬性不變（實得 magic " + magic.magicMult + " / fire " + magic.fireMult + "）"
    );

    // 沒有雫時，上面每一個計算點都必須是乾淨的基準值（不能讓沒拿雫的人吃到）。
    assert(
      base.damageCutPct === 0 && base.staggerPct === 0 && base.onceCut === 0 && !base.noFpCost && base.staminaRegenPerSec === 0,
      "沒有雫時所有雫專屬的加成都是 0"
    );

    // 一次性／等觸發型的雫不該污染這些持續型計算點（它們走各自的觸發路徑）。
    const oneShots = ["rm_start_crimson_crystal_tear", "rm_start_cerulean_crystal_tear", "rm_start_ruptured_crystal_tear", "rm_start_crimson_bubbletear"];
    const polluted = oneShots.filter(
      (id) =>
        probe[id].hpMax !== base.hpMax ||
        probe[id].guardBonusPct !== base.guardBonusPct ||
        probe[id].damageCutPct !== 0 ||
        !near(probe[id].plainMult, base.plainMult)
    );
    assert(polluted.length === 0, "一次性／等觸發型的雫不會污染持續型計算點" + (polluted.length ? "：" + polluted.join("、") : ""));

    // ---------------------------------------------------------------- 接入覆蓋率
    console.log("");
    console.log("-- 接入覆蓋率 --");
    const wired = await page.evaluate(() => window.PriTestMidnight._debugRelicMemoryWiredIds());
    const wiredSet = new Set(wired);
    const notWired = info.rows.filter((r) => !wiredSet.has(r.id));
    assert(notWired.length === 0, "21 條都被算進「已接入」清單" + (notWired.length ? "：" + notWired.map((r) => r.id).join("、") : ""));
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
