// ============================================================================
// midnight（即時制擴張版）戰技／魔術／祈禱 **傷害解算** 回歸測試
// （Playwright ＋ Firebase Local Emulator）。
// ============================================================================
// 對應 2026-09-12 使用者回報：「檢查戰技是否都有正確套用效果，或是傷害。例如血之斬擊
// 好像沒有看到敵人扣血，其他戰技一併檢查」。
//
// 查出來的三類問題（都已修正，以下各有對應斷言）：
//   ①「威力：25＋神秘補正」句型：加算對象是「特定屬性的威力補正」而不是「戰技威力」，
//     原本整條解算鏈都接不住 → 血之斬擊（刀／雙劍各1條）完全不會扣敵人血。
//   ② 中文轉錄錯誤：輝石彗粒的中文本文寫成「威力：２５」（全形數字）、「FP1」（應為
//     FP■＝10）、效果句殘缺。消耗與傷害解析吃的是**已經 localizedText() 過的本文**
//     （見 midnight.js の castWeaponSkillEntry()），所以中文玩家整招 0 傷害、FP 也少扣，
//     日文玩家卻正常——同一個 game state 因 UI 語言而算出不同結果。
//   ③「【總合傷害：（此階段中，曾造成過一次以上總合傷害的PC人數）×20】」（軍旗之下）：
//     沒有「依人數相乘」的句型支援 → 一直是 0 傷害。
//
// 使用前準備（跟 emulator_sync_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node weapon_skill_damage_check.js
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
    await joinLobby(page, "1234");
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().characters[window.PriTestMidnight._debugState().myTokenId], {
      timeout: META_WAIT_MS,
    });

    // ------------------------------------------------------------------
    // ① 中／日文本的解析結果必須一致
    // 消耗與傷害都吃 localizedText() 過的本文，所以一旦中文轉錄跟日文原文對不上，
    // 中文玩家就會算出不同的數字（輝石彗粒就是這樣整招變成 0 傷害）。這一段把每一條
    // 招式的 ja／zh 本文各跑一次解算鏈，兩邊結果必須相同。
    // ------------------------------------------------------------------
    console.log("=== ① 中／日文本的消耗與傷害解析結果一致 ===");
    const langDiff = await page.evaluate(() => {
      const CD = window.PriTestCharacterDrawer;
      const W = window.PriTestWeapons;
      const rows = [];
      const all = W.allSkills();
      Object.keys(all).forEach((k) => rows.push({ id: k, name: all[k].name, body: all[k].body }));
      W.categories().forEach((cat) => {
        (cat.innateSkills || []).forEach((s) => rows.push({ id: s.id, name: s.name, body: s.body }));
      });
      function parse(text) {
        let dmg = CD.statCorrectionSkillPowerValue(text, { typeId: null }, null);
        if (!dmg) dmg = CD.artSkillPowerValue(text, 0);
        if (!dmg) dmg = CD.fixedSkillPowerValue(text);
        if (!dmg) dmg = CD.bareGuardSymbolSkillValue(text);
        const cost = CD.parseActionCost ? CD.parseActionCost(text) : null;
        return {
          dmg: dmg ? dmg.value + "/" + (dmg.symbol || "") : null,
          cost: cost ? JSON.stringify(cost) : null,
        };
      }
      const bad = [];
      rows.forEach((r) => {
        if (!r.body || !r.body.ja || !r.body.zh) return;
        const ja = parse(r.body.ja);
        const zh = parse(r.body.zh);
        if (ja.dmg !== zh.dmg || ja.cost !== zh.cost) bad.push({ id: r.id, name: r.name.zh, ja, zh });
      });
      return { total: rows.length, bad };
    });
    assert(langDiff.total > 300, "掃到全部招式本文", { total: langDiff.total });
    assert(langDiff.bad.length === 0, "每一條招式的中／日文本都解析出相同的消耗與傷害", langDiff.bad.slice(0, 6));

    // ------------------------------------------------------------------
    // ② 血之斬擊：「威力：25＋神秘補正」必須算得出傷害
    // 期望值從資料算回來（CLAUDE.md §4.7 原則1）：25（本文印字）＋該角色的神秘威力補正，
    // 不硬編最終數字。
    // ------------------------------------------------------------------
    console.log("=== ② 血之斬擊（威力：N＋神秘補正）===");
    const bloodSlash = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const CD = window.PriTestCharacterDrawer;
      const W = window.PriTestWeapons;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      // 找一把近戰武器（非盾／杖／聖印）當載體；戰技本身的威力不依賴武器分類。
      const weapon = W.list().filter((w) => {
        const cat = W.getCategory(w.category);
        return cat && !cat.isShield && cat.id !== "staff" && cat.id !== "sacred_seal";
      })[0];
      c.weaponIds = (c.weaponIds || []).concat([weapon.id]);
      const all = W.allSkills();
      const key = Object.keys(all).filter((k) => all[k].name.zh === "血之斬擊")[0];
      const body = W.localizedText(all[key].body);
      const printed = parseInt(/威力[：:]\s*(-?\d+)/.exec(body)[1], 10);
      const arcane = CD.statPowerModValue(c, "arcane", weapon.id);
      return {
        body: body,
        printed: printed,
        arcane: arcane,
        got: M._debugSkillDamage(weapon.id, body),
        weaponId: weapon.id,
      };
    });
    assert(!!bloodSlash.got, "血之斬擊算得出傷害（修好之前是 null＝敵人完全不扣血）", bloodSlash);
    if (bloodSlash.got) {
      // computeMidnightSkillDamage() 還會加上護符／遺物／消耗品的固定加成，剛開局時都是 0，
      // 因此這裡可以直接比對基礎值；用 >= 保險，避免日後某個預設加成讓等號失效。
      assert(
        bloodSlash.got.value >= bloodSlash.printed + bloodSlash.arcane,
        `血之斬擊的傷害＝本文印字 ${bloodSlash.printed} ＋神秘威力補正 ${bloodSlash.arcane}（實際 ${bloodSlash.got.value}）`,
        bloodSlash
      );
    }

    // ------------------------------------------------------------------
    // ③ 輝石彗粒：中文轉錄修正後必須跟日文算出同樣的傷害與消耗
    // ------------------------------------------------------------------
    console.log("=== ③ 輝石彗粒（中文轉錄修正）===");
    const shard = await page.evaluate(() => {
      const W = window.PriTestWeapons;
      const CD = window.PriTestCharacterDrawer;
      const all = W.allSkills();
      const key = Object.keys(all).filter((k) => all[k].name.zh === "輝石彗粒")[0];
      const b = all[key].body;
      return {
        zh: b.zh,
        zhDmg: CD.artSkillPowerValue(b.zh, 0),
        jaDmg: CD.artSkillPowerValue(b.ja, 0),
        zhCost: CD.parseActionCost(b.zh),
        jaCost: CD.parseActionCost(b.ja),
      };
    });
    assert(!!shard.zhDmg, "輝石彗粒的中文本文算得出傷害（原本是全形數字「２５」導致 0 傷害）", shard);
    assert(shard.zhDmg && shard.jaDmg && shard.zhDmg.value === shard.jaDmg.value, "輝石彗粒中／日文本的傷害一致", shard);
    assert(JSON.stringify(shard.zhCost) === JSON.stringify(shard.jaCost), "輝石彗粒中／日文本的消耗一致（原本中文寫成 FP1、應為 FP■）", shard);
    assert(!/[０-９]/.test(shard.zh), "輝石彗粒的中文本文沒有殘留全形數字", shard.zh);

    // ------------------------------------------------------------------
    // ④ 軍旗之下：「（造成過傷害的PC人數）×20」
    // 沒有進行中的戰鬥時，人數下限取 1（規則語意包含使用者自己），因此期望值＝20。
    // ------------------------------------------------------------------
    console.log("=== ④ 軍旗之下（依人數相乘）===");
    const banner = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const W = window.PriTestWeapons;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      const cat = W.getCategory("halberd");
      const skill = ((cat && cat.innateSkills) || []).filter((x) => x.id === "halberd_under_the_banner")[0];
      if (!skill) return null;
      const weapon = W.list().filter((w) => w.category === "halberd")[0];
      c.weaponIds = (c.weaponIds || []).concat([weapon.id]);
      const body = W.localizedText(skill.body);
      const mult = parseInt(/[×xX]\s*(\d+)/.exec(body)[1], 10);
      return { body: body, mult: mult, got: M._debugSkillDamage(weapon.id, body) };
    });
    assert(!!banner && !!banner.got, "軍旗之下算得出傷害（修好之前是 null＝0 傷害）", banner);
    if (banner && banner.got) {
      assert(banner.got.value === banner.mult, `軍旗之下：尚無人造成傷害時＝1人×${banner.mult}（實際 ${banner.got.value}）`, banner);
    }

    // ------------------------------------------------------------------
    // ⑤ 全招式解算率：算不出傷害的，必須全部是「本文根本沒有傷害數值」的效果類
    // 這一條是防回頭路的守門——之後若有人再把某個會造成傷害的句型改壞，數量會對不上。
    // ------------------------------------------------------------------
    console.log("=== ⑤ 全招式解算率 ===");
    const coverage = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const W = window.PriTestWeapons;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      const carrier = W.list().filter((w) => {
        const cat = W.getCategory(w.category);
        return cat && !cat.isShield && cat.id !== "staff" && cat.id !== "sacred_seal";
      })[0];
      c.weaponIds = (c.weaponIds || []).concat([carrier.id]);
      const rows = [];
      const all = W.allSkills();
      Object.keys(all).forEach((k) => rows.push({ id: k, name: all[k].name.zh, kind: all[k].kind, body: W.localizedText(all[k].body) }));
      W.categories().forEach((cat) => {
        (cat.innateSkills || []).forEach((s2) =>
          rows.push({ id: s2.id, name: s2.name.zh, kind: s2.kind, body: W.localizedText(s2.body) })
        );
      });
      const unresolved = [];
      rows.forEach((r) => {
        // 走 midnight 真正使用的整條解算鏈（含只存在於 midnight.js 的
        // damagedPcCountSkillValue()），而不是只挑 CharacterDrawer 的幾支來拼。
        if (!M._debugSkillDamage(carrier.id, r.body)) unresolved.push(r);
      });
      // 「應該要有傷害卻算不出來」＝本文裡明寫了【總合傷害：<數字或威力>】、或有「威力：N」
      // 欄位，卻仍然解不出值的條目。純 buff／被動（2Hit傷害+5、HP回復…）不算。
      const shouldHaveDamage = unresolved.filter((r) => {
        if (/威力[：:]\s*(無|なし)/.test(r.body)) return false; // 明寫「威力：無」
        const hasPowerField = /威力[：:]\s*[0-9０-９]/.test(r.body);
        const dealsDamage = /(?:造成|与える)[^。]*【(?:総合ダメージ|總合傷害)/.test(r.body);
        return hasPowerField || dealsDamage;
      });
      return { total: rows.length, unresolved: unresolved.length, shouldHaveDamage: shouldHaveDamage.map((r) => r.name + "（" + r.id + "）") };
    });
    console.log(`    招式總數 ${coverage.total}／算不出傷害 ${coverage.unresolved} 條（多數是純 buff・被動）`);
    // 切腹：規則書本文（ja/zh 都是）只寫「【總合傷害：威力＋▲】」卻沒有任何「威力：N」欄位，
    // 屬於規則書本身沒有給值的情況——依 CLAUDE.md §19 不自行發明數值，維持顯示規則原文由
    // GM/玩家判斷。這是目前唯一的已知例外，因此白名單只允許它。
    const KNOWN_UNRESOLVABLE = ["切腹"];
    const unexpected = coverage.shouldHaveDamage.filter((n) => !KNOWN_UNRESOLVABLE.some((k) => n.indexOf(k) === 0));
    assert(unexpected.length === 0, "沒有「本文明寫會造成傷害、卻算不出數值」的招式（切腹除外，規則書本身沒給威力）", unexpected);

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
