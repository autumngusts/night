// ============================================================================
// 基礎附帶效果（CharacterDrawer 的 24 種）的 midnight 換算回歸測試（2026-09-25 使用者明確規格）。
// A 段：不需要 emulator，用假角色直接驗計算點（耐性上限、仇恨倍率、雙手／雙刀戰技+5、常數）。
// B 段：emulator 實機（每30秒回復、物理減傷、防禦成功回復、致命一擊、復歸恢復技藝）。
// 前置：generate.py、http.server 8791；B 段另需 firebase emulators（PRITEST_EMU_PORT）。
// 執行：PRITEST_EMU_PORT=9010 node tools/midnight_check/attached_effects_check.js
// 期望值一律從規格常數推（CLAUDE.md §4.7），不硬編傷害。
// ============================================================================
const { chromium } = require("playwright");
const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const EMU_PORT = process.env.PRITEST_EMU_PORT || "9000";
const WAIT = 20000;

let fails = 0;
const assert = (c, l, d) => {
  console.log((c ? "  [PASS] " : "  [FAIL] ") + l + (c || d === undefined ? "" : "　→ " + JSON.stringify(d)));
  if (!c) fails++;
};

async function partA(browser) {
  console.log("=== A：計算點 ===");
  const page = await browser.newPage();
  await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
  const r = await page.evaluate(() => {
    const MN = window.PriTestMidnight;
    const W = window.PriTestWeapons;
    const dagger = W.list().filter((w) => w.category === "dagger");
    const d1 = dagger[0].id;
    const d2 = dagger[1].id;
    const staff = W.list().filter((w) => w.category === "staff")[0].id;
    const base = MN._debugAttachedEffects({ learnedAttachedEffects: [] });
    return {
      base,
      status: MN._debugAttachedEffects({ learnedAttachedEffects: ["status_resist"], statusResistChoice: { ja: "猛毒", zh: "猛毒" } }),
      element: MN._debugAttachedEffects({ learnedAttachedEffects: ["element_resist"], elementResistChoice: { ja: "炎", zh: "火" } }),
      notLearned: MN._debugAttachedEffects({ learnedAttachedEffects: [], statusResistChoice: { ja: "猛毒", zh: "猛毒" } }),
      easy: MN._debugAttachedEffects({ learnedAttachedEffects: ["easy_target"] }),
      hard: MN._debugAttachedEffects({ learnedAttachedEffects: ["hard_target"] }),
      twoHand: MN._debugAttachedEffects({ learnedAttachedEffects: ["two_hand_up"], equippedWeaponIds: [d1] }, d1),
      twoHandTwo: MN._debugAttachedEffects({ learnedAttachedEffects: ["two_hand_up"], equippedWeaponIds: [d1, d2] }, d1),
      dual: MN._debugAttachedEffects({ learnedAttachedEffects: ["dual_wield_up"], equippedWeaponIds: [d1, d2] }, d1),
      dualOne: MN._debugAttachedEffects({ learnedAttachedEffects: ["dual_wield_up"], equippedWeaponIds: [d1] }, d1),
      stack: MN._debugAttachedEffects({ learnedAttachedEffects: ["two_hand_up", "arts_dmg"], equippedWeaponIds: [d1] }, d1),
      staffSolo: MN._debugAttachedEffects({ learnedAttachedEffects: ["two_hand_up"], equippedWeaponIds: [staff] }, staff),
    };
  });
  const T0 = r.base.thresholds;
  const diff = (x) => Object.keys(T0).filter((k) => x.thresholds[k] !== T0[k]).map((k) => k + ":" + T0[k] + "→" + x.thresholds[k]);
  assert(JSON.stringify(diff(r.status)) === JSON.stringify(["猛毒:" + T0["猛毒"] + "→" + (T0["猛毒"] + 1)]), "狀態異常耐性（選猛毒）→ 只有猛毒蓄積上限 +1", diff(r.status));
  assert(JSON.stringify(diff(r.element)) === JSON.stringify(["炎:" + T0["炎"] + "→" + (T0["炎"] + 1)]), "屬性耐性（選炎/火）→ 只有炎蓄積上限 +1", diff(r.element));
  assert(diff(r.notLearned).length === 0, "沒習得時選擇值不生效");
  assert(Math.abs(r.easy.aggroMult - (r.base.aggroMult + 0.1)) < 1e-9, "容易被盯上 → 仇恨 +10%", r.easy.aggroMult);
  assert(Math.abs(r.hard.aggroMult - (r.base.aggroMult - 0.1)) < 1e-9, "不易被盯上 → 仇恨 −10%", r.hard.aggroMult);
  assert(r.twoHand.artBonus === 5 && r.twoHandTwo.artBonus === 0, "雙手持握強化：只裝1把 → 戰技 +5；裝2把 → 0", [r.twoHand.artBonus, r.twoHandTwo.artBonus]);
  assert(r.dual.artBonus === 5 && r.dualOne.artBonus === 0, "雙刀持握強化：同類近戰2把 → 戰技 +5；1把 → 0", [r.dual.artBonus, r.dualOne.artBonus]);
  assert(r.stack.artBonus === 10, "戰技傷害+5 與雙手持握強化各自 +5（合計 10）", r.stack.artBonus);
  assert(r.twoHand.sorceryBonus === 0 && r.staffSolo.sorceryBonus === 0, "「戰技」+5 不套用在魔術");
  const k = r.base.consts;
  assert(k.interval === 30000 && k.regen === 10 && k.guardHeal === 0.5 && k.guardCounter === 15 && k.crit === 10 && k.physCut === 10, "規格常數（30秒／10／50%／+15／+10／HP價值+10）", k);
  assert(
    JSON.stringify(k.auto.map((a) => a.id + ":" + a.name + (a.twoHitAggro ? "+aggro" : ""))) === JSON.stringify(["sprint_fire:炎", "walk_lightning:雷", "time_gem:魔+aggro"]),
    "每30秒自動屬性：疾跑火焰=炎／步行落雷=雷／輝石=魔＋2hit仇恨",
    k.auto
  );
  await page.close();
}

async function newEmuPage(browser) {
  const page = await browser.newPage();
  await page.addInitScript((port) => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
      window.sessionStorage.setItem("pritestRtdbEmulatorPort", port);
    } catch (e) {}
  }, EMU_PORT);
  page.on("pageerror", (e) => {
    console.log("  [pageerror] " + e.message);
    fails++;
  });
  return page;
}

async function partB(browser) {
  console.log("=== B：實機（emulator） ===");
  const page = await newEmuPage(browser);
  await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
  await page.click("#btn-midnight-create");
  await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: WAIT });
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", "1234");
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: WAIT });
  await page.dispatchEvent("#btn-midnight-lobby-ready", "click");
  await page.waitForFunction(() => {
    const d = window.PriTestMidnight._debugState();
    return d.meta.sessionStartAt && d.characters[d.myTokenId] && typeof d.demoStats[d.myTokenId] === "number";
  }, { timeout: 30000 });
  await page.waitForTimeout(11000); // 開局10秒進場動畫（期間暫停類邏輯）
  // 開局時 demoStat＝HP 上限。量傷害一律從上限開始，否則回復會被夾回上限、量錯。
  const MAXHP = await page.evaluate(() => { const d = window.PriTestMidnight._debugState(); return d.demoStats[d.myTokenId]; });

  const setLearned = (ids) =>
    page.evaluate(async (ids) => {
      const d = window.PriTestMidnight._debugState();
      d.characters[d.myTokenId].learnedAttachedEffects = ids;
      await window.PriTestGameStorage.rtSet(d.gameId, "cloud", "character/" + d.myTokenId + "/learnedAttachedEffects", ids);
    }, ids);
  const setHp = (v) =>
    page.evaluate(async (v) => {
      const d = window.PriTestMidnight._debugState();
      await window.PriTestGameStorage.rtSet(d.gameId, "cloud", "demoStat/" + d.myTokenId, v);
    }, v);
  const hp = () => page.evaluate(() => { const d = window.PriTestMidnight._debugState(); return d.demoStats[d.myTokenId]; });
  const hitDrop = async (kind, amount, shield) => {
    await setHp(MAXHP);
    await page.waitForFunction((m) => { const d = window.PriTestMidnight._debugState(); return d.demoStats[d.myTokenId] === m; }, MAXHP, { timeout: WAIT });
    const eff = await page.evaluate(({ kind, amount, shield }) => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      if (shield) {
        const W = window.PriTestWeapons;
        const sh = W.list().filter((w) => (W.getCategory(w.category) || {}).isShield)[0];
        c.weaponIds = (c.weaponIds || []).concat([sh.id]);
        c.equippedWeaponIdL = sh.id;
        c.equippedWeaponIdR = null;
      }
      s.stamina.current = s.stamina.max;
      return M._debugResolveIncomingHit(kind, "", amount);
    }, { kind, amount, shield });
    await page.waitForTimeout(1200);
    return { kind: eff, drop: MAXHP - (await hp()) };
  };

  // 物理減傷+：同一擊有／沒有 phys_cut 的承受傷害比
  await setLearned([]);
  const noCut = await hitDrop("hit", 600, false);
  await setLearned(["phys_cut"]);
  const withCut = await hitDrop("hit", 600, false);
  assert(noCut.drop > 0 && withCut.drop === Math.round(noCut.drop * 0.9), "物理減傷+：物理攻擊傷害 ×0.9（" + noCut.drop + "→" + withCut.drop + "）", [noCut, withCut]);

  // 防禦成功時HP回復：先扣再回覆該傷害的50%
  await setLearned([]);
  const blockNo = await hitDrop("block", 600, true);
  await setLearned(["guard_hp_regen"]);
  const blockYes = await hitDrop("block", 600, true);
  assert(
    blockNo.kind === "block" && blockNo.drop > 0 && blockYes.drop === blockNo.drop - Math.round(blockNo.drop * 0.5),
    "防禦成功時HP回復：承受 " + blockNo.drop + " 後回覆 " + Math.round(blockNo.drop * 0.5) + "（淨扣 " + blockYes.drop + "）",
    [blockNo, blockYes]
  );

  // 復歸時恢復技藝
  await setLearned(["arts_revive_regen"]);
  await page.evaluate(async () => {
    const d = window.PriTestMidnight._debugState();
    await window.PriTestGameStorage.rtSet(d.gameId, "cloud", "character/" + d.myTokenId + "/_artCooldownUntil", Date.now() + 600000);
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.PriTestMidnight._debugFinishRevive(null, false));
  await page.waitForTimeout(1200);
  const artCd = await page.evaluate(() => { const d = window.PriTestMidnight._debugState(); return d.characters[d.myTokenId]._artCooldownUntil; });
  assert(!artCd, "復歸時恢復技藝：瀕死復歸 → 技藝冷卻歸零", artCd);

  // 每30秒回復 HP10／FP10
  await setLearned(["hp_regen", "fp_regen"]);
  await setHp(MAXHP - 50);
  await page.evaluate(() => { const s = window.PriTestMidnight._debugState(); s.fp && (s.fp.current = 0); });
  await page.waitForTimeout(1000);
  const hpBefore = await hp();
  console.log("    （等待 31 秒…）");
  await page.waitForTimeout(31000);
  const hpAfter = await hp();
  assert(hpAfter - hpBefore === 10, "HP持續回復：30秒後 HP +10（" + hpBefore + "→" + hpAfter + "）");
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await partA(browser);
    if (process.env.PRITEST_SKIP_EMU !== "1") await partB(browser);
  } catch (e) {
    console.error(e);
    fails++;
  } finally {
    await browser.close();
  }
  console.log(fails ? fails + " FAIL" : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
