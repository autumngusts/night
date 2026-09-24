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
      c.relicMemoryLoadout = [{ memId: "m1", size: "m", effects: ["max_hp_up", "arts_dmg"] }];
      const withMem = CD.totalFlatMaxStatBonus(c, "hp");
      const art = CD.attachedSkillDamageBonus(c, "art");
      c.learnedAttachedEffects = ["max_hp_up"];
      const dedup = CD.totalFlatMaxStatBonus(c, "hp");
      const ids = CD.activeAttachedEffectIds(c);
      return { baseHp, withMem, art, dedup, ids, all: CD.allAttachedEffectIds().length, hasAssign: typeof CD.assignAttachedResistChoiceIfNeeded === "function" };
    });
    assert(r.withMem === r.baseHp + 1, "帶入 max_hp_up → 最大HP +1");
    assert(r.art === 5, "帶入 arts_dmg → 戰技傷害 +5");
    assert(r.dedup === r.baseHp + 1, "習得＋帶入同一效果（非 stackable）只算 1 次");
    assert(r.ids.filter((x) => x === "max_hp_up").length === 1, "activeAttachedEffectIds 去重");
    assert(r.all === 24, "allAttachedEffectIds 共 24 種");
    assert(r.hasAssign, "匯出 assignAttachedResistChoiceIfNeeded");
  } finally {
    await browser.close();
  }
  console.log(fails ? fails + " FAIL" : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
