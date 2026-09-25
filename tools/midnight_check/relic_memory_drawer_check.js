// 遺物記憶：帶入效果是否反映到既有附帶效果計算（不需 Firebase）。
// 前置：python generate.py；python -m http.server 8791 --directory dist
const { chromium } = require("playwright");
const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let fails = 0;
  const assert = (c, l) => { console.log((c ? "  [PASS] " : "  [FAIL] ") + l); if (!c) fails++; };
  try {
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    const r = await page.evaluate(() => {
      const CD = window.PriTestCharacterDrawer;
      const typeId = window.PriTestCharacterTypes.list()[0].id;
      const c = CD.newCharacter("t", typeId);
      const baseHp = CD.totalFlatMaxStatBonus(c, "hp");
      // 舊格式（純字串陣列）：2026-09-25 的範圍接線之前產生、已保存在 Firebase 的記憶。
      // 相容路徑必須照樣生效，不需要資料遷移。
      c.relicMemoryLoadout = [{ memId: "m1", size: "m", effects: ["max_hp_up", "arts_dmg"] }];
      const withMem = CD.totalFlatMaxStatBonus(c, "hp");
      const art = CD.attachedSkillDamageBonus(c, "art");
      c.learnedAttachedEffects = ["max_hp_up"];
      const dedup = CD.totalFlatMaxStatBonus(c, "hp");
      const ids = CD.activeAttachedEffectIds(c);

      // 新格式（{ id, value }）：2026-09-25 起 newMemory() 產生的形狀。效果的判定只看 id，
      // value 是擲定的數值（附帶效果那 24 種沒有 range，所以實際上不會帶 value；這裡
      // 刻意塞一個值，確認多出來的欄位不會讓判定失效）。
      const c2 = CD.newCharacter("t2", typeId);
      const base2 = CD.totalFlatMaxStatBonus(c2, "hp");
      c2.relicMemoryLoadout = [{ memId: "m2", size: "m", effects: [{ id: "max_hp_up", value: 7 }, { id: "arts_dmg" }] }];
      const modernHp = CD.totalFlatMaxStatBonus(c2, "hp");
      const modernArt = CD.attachedSkillDamageBonus(c2, "art");
      const modernIds = CD.activeAttachedEffectIds(c2);

      // 混用兩種格式，加上壞掉的項目（null／沒有 id）——一律略過，不丟例外。
      const c3 = CD.newCharacter("t3", typeId);
      const base3 = CD.totalFlatMaxStatBonus(c3, "hp");
      c3.relicMemoryLoadout = [{ memId: "m3", size: "l", effects: ["max_hp_up", { id: "arts_dmg" }, null, {}] }];
      const mixedHp = CD.totalFlatMaxStatBonus(c3, "hp");
      const mixedIds = CD.activeAttachedEffectIds(c3);

      // 2026-09-25 的池擴充：抽選池 = 24 種附帶效果 ＋ 遺物記憶目錄可抽選的效果。
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      const pool = window.PriTestMidnight._debugRelicMemoryPool();

      // 目錄效果的 stackable 要能從 catalog 查到（character_drawer 的可選查詢）。
      const catStackTrue = CAT.drawableEffects().filter((e) => e.stackable === true)[0];
      const catStackFalse = CAT.drawableEffects().filter((e) => e.stackable === false)[0];
      const c4 = CD.newCharacter("t4", typeId);
      c4.relicMemoryLoadout = [
        { memId: "m4a", size: "m", effects: [{ id: catStackTrue.id }, { id: catStackFalse.id }] },
        { memId: "m4b", size: "m", effects: [{ id: catStackTrue.id }, { id: catStackFalse.id }] },
      ];
      const catIds = CD.activeAttachedEffectIds(c4);

      return {
        baseHp, withMem, art, dedup, ids,
        base2, modernHp, modernArt, modernIds,
        base3, mixedHp, mixedIds,
        pool,
        catalogEffects: CAT.EFFECTS.length,
        catalogDrawable: CAT.drawableEffects().length,
        stackTrueCount: catIds.filter((x) => x === catStackTrue.id).length,
        stackFalseCount: catIds.filter((x) => x === catStackFalse.id).length,
        stackTrueId: catStackTrue.id,
        stackFalseId: catStackFalse.id,
        all: CD.allAttachedEffectIds().length,
        hasAssign: typeof CD.assignAttachedResistChoiceIfNeeded === "function",
        hasEffectId: typeof CD.relicMemoryEffectId === "function",
      };
    });
    assert(r.withMem === r.baseHp + 1, "舊格式：帶入 max_hp_up → 最大HP +1");
    assert(r.art === 5, "舊格式：帶入 arts_dmg → 戰技傷害 +5");
    assert(r.dedup === r.baseHp + 1, "習得＋帶入同一效果（非 stackable）只算 1 次");
    assert(r.ids.filter((x) => x === "max_hp_up").length === 1, "activeAttachedEffectIds 去重");
    assert(r.modernHp === r.base2 + 1, "新格式 { id, value }：帶入 max_hp_up → 最大HP +1");
    assert(r.modernArt === 5, "新格式 { id, value }：帶入 arts_dmg → 戰技傷害 +5");
    assert(r.modernIds.indexOf("max_hp_up") !== -1 && r.modernIds.indexOf("arts_dmg") !== -1,
      "新格式：兩條效果都進了 activeAttachedEffectIds");
    assert(r.mixedHp === r.base3 + 1, "新舊格式混用仍正確（壞掉的項目略過，不丟例外）");
    assert(r.mixedIds.length === 2, "混用時只取出 2 條有效效果（得到 " + r.mixedIds.join("／") + "）");
    assert(r.all === 24, "allAttachedEffectIds 共 24 種");
    assert(r.hasAssign, "匯出 assignAttachedResistChoiceIfNeeded");
    assert(r.hasEffectId, "匯出 relicMemoryEffectId（新舊格式的 id 取用點）");

    // ---- 抽選池的擴充（2026-09-25，設計文件 10.1／10.9 第 6 點）----
    assert(r.catalogEffects === 419, "遺物記憶目錄共 419 條效果");
    assert(
      // 2026-09-25 使用者明確說明 24 種附帶效果與遺物記憶互無關連，池只剩目錄（舊期望值是 24 ＋ 目錄）。
      r.pool.size === r.catalogDrawable,
      "抽選池 = 目錄可抽選的 " + r.catalogDrawable + " 條（實得 " + r.pool.size + "）"
    );
    assert(r.pool.attached === 0, "池裡不含 24 種附帶效果（實得 " + r.pool.attached + "）");
    assert(r.pool.withRange > 100, "池中 " + r.pool.withRange + " 條帶數值範圍（會擲值）");
    assert(r.pool.exclusive > 0, "池中 " + r.pool.exclusive + " 條角色專用效果（不排除，只壓第 2 條機率）");
    assert(
      // 2026-09-25 使用者明確規格「初始武器帶屬性 帶戰技 等等／結晶雫 一個遺物記憶只能一條」
      // 新增 exclusiveGroup（舊期望值只有 isExclusive,rangeOf）。
      r.pool.opts.join(",") === "exclusiveGroup,isExclusive,rangeOf",
      "newMemory 的 opts 帶了 exclusiveGroup／isExclusive／rangeOf（得到 " + r.pool.opts.join(",") + "）"
    );

    // ---- 目錄效果的 stackable 由 catalog 查（character_drawer 的可選查詢）----
    assert(
      r.stackTrueCount === 2,
      "目錄中 stackable:true 的效果（" + r.stackTrueId + "）帶入 2 顆記憶 → 算 2 次"
    );
    assert(
      r.stackFalseCount === 1,
      "目錄中 stackable:false 的效果（" + r.stackFalseId + "）帶入 2 顆記憶 → 只算 1 次"
    );
  } finally {
    await browser.close();
  }
  console.log(fails ? fails + " FAIL" : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
