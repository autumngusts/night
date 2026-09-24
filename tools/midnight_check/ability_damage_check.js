// ============================================================================
// Playwright 回歸測試：逐招比對「本文解析出的威力」與「實際打出去的傷害」。
// ============================================================================
// ability_matrix_check.js 只驗「招式能不能正常發動」，刻意沒有驗傷害數值——因為它是用
// 敵人 HP 差值量的，而那個差值會被屬性蓄積跨門檻的**隨機**觸發傷害（51~100／151~200）
// 污染，無法可靠分離。這一支換一條路把那個干擾從根本上拿掉：
//
//   量測點改成 lastPcDamageInfo.rawAmount（applyDamageToFieldEnemyHp() 收到的、還沒套
//   敵人 HP 價值減傷的總傷害）。蓄積觸發傷害走的是 damageTargetKeyDirect()，完全不經過
//   applyDamageToFieldEnemyHp()，所以讀這個欄位天生就看不到蓄積那一發。
//
// 期望值一律從 App 自己算出來，不在腳本裡硬編任何傷害數字（CLAUDE.md §4.7）：
//
//   expected = round(round(value × abilityMult) × soloMult × outgoingMult)
//
//   value        computeMidnightAbilityDamage() 解析本文得到的顯示值
//   abilityMult  CHARACTER_ABILITY_DAMAGE_MULT＝3（使用者明確規格「角色技能技藝總傷害3倍」，
//                刻意只乘在實際傷害上、顯示維持原值，所以 value 裡沒有它）
//   soloMult     soloModeActive()＝participants 只有 1 人時 ×2
//   outgoingMult affixOutgoingDamageMult()＝武器詞條的加成（本測試沒有詞條，是 1）
//
// 乘算順序照 damageCombatTarget()／useCharacterAbility() 的實際寫法，不是自己重推一套。
//
// 走 Firebase Local Emulator。前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node ability_damage_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const WAIT = 20000;

const results = [];
const pageErrors = [];
function assert(cond, label, extra) {
  results.push({ label, pass: !!cond });
  if (!cond) console.log("  [FAIL] " + label + (extra ? "   " + extra : ""));
}

async function enableEmulatorFlag(page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
    } catch (e) {}
  });
}

const click = (page, sel) => page.dispatchEvent(sel, "click"); // CLAUDE.md §4.6

async function joinLobbyAndStart(page) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", "1234");
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: WAIT });
  await click(page, "#btn-midnight-lobby-ready");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: WAIT });
}

async function setupEncounter(page) {
  const pointId = await page.evaluate(() => {
    const s = window.PriTestMidnight._debugState();
    const NON_FIELD = { sorcerer: 1, merchant: 1, strong_enemy: 1, random_event: 1, blessing: 1 };
    const pt = (s.map.points || []).filter((p) => !NON_FIELD[p.type])[0];
    if (!pt) return null;
    const participants = {};
    participants[s.mySlot] = true;
    window.PriTestMidnight._debugSetLocalPos(pt.x + 0.5, pt.y + 0.5);
    return window.PriTestGameStorage.rtSet(s.gameId, "cloud", "fieldTrigger/" + pt.id, {
      status: "resolved",
      participants: participants,
      branchIndex: 0,
      floorIndex: 0,
      level: 1,
      enemyFamilyId: "test",
      enemyId: "test",
    })
      .then(() => window.PriTestGameStorage.rtSet(s.gameId, "cloud", "fieldEnemyHp/" + pt.id, 100000000))
      .then(() => pt.id);
  });
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().activeEncounter, { timeout: 20000 }).catch(() => {});
  const st = await page.evaluate(() => window.PriTestMidnight._debugState());
  return { pointId, activeEncounter: st.activeEncounter };
}

// 時限 buff 會改變乘算（血魂之歌 party-wide ×1.5 等），每次量測前清乾淨，
// 期望值才跟 damageCombatTarget() 當下實際用的乘算一致。
async function resetLingeringBuffs(page) {
  await page.evaluate(() => {
    const s = window.PriTestMidnight._debugState();
    const GS = window.PriTestGameStorage;
    const c = s.characters[s.myTokenId];
    const jobs = [];
    Object.keys(c).forEach((k) => {
      if (/^_.*(Until|ReadyAt)$/.test(k) && typeof c[k] === "number" && c[k] > 0) {
        c[k] = 0;
        jobs.push(GS.rtSet(s.gameId, "cloud", "character/" + s.myTokenId + "/" + k, 0));
      }
    });
    ["bloodSongUntil", "partyNoDamageUntil", "affixHolyGroundUntil"].forEach((k) => {
      jobs.push(GS.rtSet(s.gameId, "cloud", "meta/" + k, null));
    });
    return Promise.all(jobs);
  });
  await page
    .waitForFunction(
      () => {
        const m = window.PriTestMidnight._debugState().meta;
        return !m.bloodSongUntil && !m.partyNoDamageUntil && !m.affixHolyGroundUntil;
      },
      null,
      { timeout: 5000 }
    )
    .catch(() => {});
}

// 一次量測：先讀解析器的輸出算出期望值，再實際使用，最後讀 lastPcDamageInfo。
// 全部在同一個 evaluate 裡做完——lastPcDamageInfo 是 applyDamageToFieldEnemyHp() 一開頭
// 就同步寫好的本地變數（不是等 RTDB 回流），所以不需要等待，也就不會被別的寫入插隊。
async function measure(page, kind) {
  await resetLingeringBuffs(page);
  return page.evaluate(({ kind }) => {
    const M = window.PriTestMidnight;
    M._debugResetMyAbilityCooldowns();
    M._debugSetElementalMarks(9); // 隱者混成魔法的「消耗3屬性痕」門檻，規則書要求，先墊滿
    M._debugSetFp(999);
    const before = M._debugLastPcDamageInfo();
    const info = M._debugAbilityDamageInfo(kind);
    M._debugUseCharacterAbility(kind);
    const after = M._debugLastPcDamageInfo();
    return {
      info: info,
      fired: !!(after && (!before || after.at !== before.at)),
      rawAmount: after ? after.rawAmount : null,
      amount: after ? after.amount : null,
      hpValue: after ? after.hpValue : null,
    };
  }, { kind });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => {
    pageErrors.push(String(e && e.message ? e.message : e));
    console.log("  [PAGE ERROR] " + (e && e.message ? e.message : e));
  });

  try {
    await enableEmulatorFlag(page);
    console.log("=== 開局（emulator） ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: WAIT });
    await joinLobbyAndStart(page);

    const enc = await setupEncounter(page);
    assert(!!enc.activeEncounter, "戰鬥已建立（activeEncounter 生效）");
    if (!enc.activeEncounter) throw new Error("沒有 activeEncounter");

    const types = await page.evaluate(() =>
      window.PriTestCharacterTypes.list().map((t) => ({ id: t.id, name: t.name.zh }))
    );

    console.log("\n角色／種別        招式                 解析值 ×倍率 = 期望     實際     判定");
    console.log("-".repeat(86));

    const unresolved = [];
    let checked = 0;

    for (const t of types) {
      await page.evaluate((id) => window.PriTestMidnight._debugSetTypeAndLevel(id, 3), t.id);
      for (const kind of ["skill", "art"]) {
        const r = await measure(page, kind);
        const i = r.info;
        const label = (t.name + "／" + (kind === "art" ? "技藝" : "技能")).padEnd(16, "　");

        if (i.value === null) {
          // 威力無法自動解算：規則原文交給 GM（CLAUDE.md §19），本來就不該有傷害。
          assert(!r.fired, label + i.abilityId + "：無法解算威力時不應該打出傷害", "rawAmount=" + r.rawAmount);
          unresolved.push(t.name + "／" + kind + "(" + i.abilityId + ")");
          console.log(label + i.abilityId.padEnd(22) + "—（規則原文交 GM）");
          continue;
        }

        const expected = Math.round(Math.round(i.value * i.abilityMult) * i.soloMult * i.outgoingMult);
        const ok = r.fired && r.rawAmount === expected;
        assert(
          ok,
          label + i.abilityId + "：實際傷害＝解析值×倍率",
          "value=" + i.value + " ×" + i.abilityMult + " ×" + i.soloMult + " ×" + i.outgoingMult +
            " ⇒ expected=" + expected + " actual=" + r.rawAmount + (r.fired ? "" : "（沒有打出傷害）")
        );
        checked++;
        console.log(
          label +
            i.abilityId.padEnd(22) +
            String(i.value).padStart(5) +
            " ×" + i.abilityMult + "×" + i.soloMult +
            " = " + String(expected).padStart(6) +
            String(r.rawAmount).padStart(9) +
            "   " + (ok ? "OK" : "NG")
        );
      }
    }

    assert(pageErrors.length === 0, "全程沒有拋出任何 JS 例外", pageErrors.join(" / "));

    console.log("\n可解算威力、已逐招比對：" + checked + " 招");
    console.log("威力交由 GM 判讀規則原文（" + unresolved.length + " 招）：");
    unresolved.forEach((d) => console.log("  " + d));
  } catch (e) {
    console.log("\n[EXCEPTION] " + (e && e.stack ? e.stack : e));
    results.push({ label: "腳本執行中發生例外", pass: false });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n" + "=".repeat(50));
  console.log(results.length - failed.length + " / " + results.length + " 通過");
  if (failed.length) {
    failed.forEach((f) => console.log("  FAIL: " + f.label));
    process.exit(1);
  }
  console.log("全部通過");
})();
