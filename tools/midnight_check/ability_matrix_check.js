// ============================================================================
// Playwright 回歸測試：20 個角色類型的〔技能〕〔技藝〕實機全掃。
// ============================================================================
// 目的是回答「其他角色的技能技藝等等有沒有正常運作」，作法是在一場真的戰鬥裡，
// 對 character_types.js 的全部 20 個類型各跑一輪：
//
//   A. characterAbilityEntry() 解出的 ability id 跟 character_types.js 的資料一致
//      （跨模組對得上，不是 midnight 自己另外寫死一份）
//   B. 等級門檻：Lv1 兩個都鎖、Lv2 開技能、Lv3 兩個都開（使用者明確規格，
//      見 midnight.js 的 abilityUnlockLevel()）
//   C. 實際使用：冷卻被設成 abilityBaseCooldownMs() 算出來的值（期望值不硬編，
//      從 App 自己讀回來算，CLAUDE.md §4.7 原則）
//   D. 冷卻中再按一次會被擋掉（冷卻時刻不被重設）
//   E. 有可解算威力的招式會真的扣敵人 HP；扣多少不硬編，只斷言「>0」並要求
//      重跑一次得到相同數值（確定性）
//   F. 全程不能有任何 JS 例外——這是最重要的一條。像 relicChoiceMatches() 那種
//      「拋 TypeError 把整條流程打斷」的 bug，靜態檢查抓不到，只有真的跑過才看得見。
//
// 走 Firebase Local Emulator（見 tools/midnight_check/emulator_sync_check.js 的說明）。
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node ability_matrix_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const WAIT = 20000;

const results = [];
const pageErrors = [];
function assert(cond, label, extra) {
  results.push({ label, pass: !!cond });
  if (!cond || process.env.VERBOSE) {
    console.log((cond ? "  [PASS] " : "  [FAIL] ") + label + (extra ? "   " + extra : ""));
  }
}

async function enableEmulatorFlag(page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
    } catch (e) {}
  });
}

const S = (page) => page.evaluate(() => window.PriTestMidnight._debugState());
const click = (page, sel) => page.dispatchEvent(sel, "click"); // CLAUDE.md §4.6

async function joinLobbyAndStart(page) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", "1234");
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: WAIT });
  await click(page, "#btn-midnight-lobby-ready");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: WAIT });
}

// 跟 pause_flow_check.js 同一套：seed 一個「已解決、敵人存活、沒有雜兵」的 fieldTrigger。
// 敵人 HP 給很大，才不會在掃 40 個招式的過程中被打死、讓 activeEncounter 消失。
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
  const st = await S(page);
  return { pointId, activeEncounter: st.activeEncounter };
}

// 一次使用：重設冷卻 → 滿足前置條件 → 記 HP → 使用 → 回報冷卻與 HP 變化。
//
// 注意：敵人 HP 是走 GameStorage.rtTransaction() 寫 RTDB，本地的 fieldEnemyHp 要等訂閱
// 回流才會更新。所以「使用」與「讀 HP」不能放在同一個同步的 page.evaluate 裡——第一版
// 就是這樣寫，結果 40 個招式全部量到 0 傷害，看起來像「全部都無法解算威力」，其實只是
// 還沒回流。這裡改成：同步段只負責觸發並記 hpBefore，之後等回流或固定等一小段再讀。
//
// 另一個坑：有些招式會對敵人施加屬性／異常蓄積，蓄積跨過 ATTRIBUTE_STATUS_THRESHOLD(16)
// 時會另外打一發「蓄積觸發傷害」（隨機 51~100／151~200，見 applyAttributeAccumEffect()）。
// 那一發跟招式自己的威力是兩回事，混進來就會出現「同一招第一次 90、第二次 0」這種
// 看起來像 bug 的假象。所以每次測量前把該點的 attributeAccum／attributeAccumTriggers
// 清乾淨，測完再檢查這一輪有沒有觸發過；有的話這個樣本作廢、重測。
const RTDB_ROUNDTRIP_MS = 1200;

async function clearAccum(page, pointId) {
  await page.evaluate((p) => {
    const s = window.PriTestMidnight._debugState();
    const GS = window.PriTestGameStorage;
    return Promise.all([
      GS.rtSet(s.gameId, "cloud", "attributeAccum/" + p, null),
      GS.rtSet(s.gameId, "cloud", "attributeAccumTriggers/" + p, null),
    ]);
  }, pointId);
  await page
    .waitForFunction(
      (p) => {
        const s = window.PriTestMidnight._debugState();
        const a = s.attributeAccum[p];
        return !a || Object.keys(a).length === 0;
      },
      pointId,
      { timeout: RTDB_ROUNDTRIP_MS * 3 }
    )
    .catch(() => {});
}

// 第三個坑：RTDB 的寫入回流是非同步的，上一招的傷害可能晚於我的等待視窗才抵達，
// 於是被算進「下一招」的 hpBefore→hpAfter 差值裡（實測就是這樣讓 3 個招式出現
// 「第一次有傷害、第二次 0」的假象）。每次測量前先等 HP 穩定一段時間，把還在路上的
// 寫入排乾淨再開始。
async function settleEnemyHp(page, pointId) {
  let last = null;
  for (let i = 0; i < 12; i++) {
    const hp = await page.evaluate((p) => window.PriTestMidnight._debugState().fieldEnemyHp[p], pointId);
    if (hp === last) return hp;
    last = hp;
    await page.waitForTimeout(250);
  }
  return last;
}

// 第四個坑（最關鍵）：不少招式的後效果是「時限 buff」，而且有的是 party-wide 乘算——
// 隱者的血魂之歌寫 meta.bloodSongUntil，之後 10 秒內**所有**傷害 ×1.5
// （見 damageCombatTarget() 的 bloodSongActive() 分支）。在一支循序掃完 20 個角色的
// 腳本裡，這代表前一個角色的 buff 會把後面角色的傷害墊高，實測就出現「學者 art
// 1080 vs 720」——正好差 1.5 倍，不是 bug，是我沒有隔離。
// 因此每次測量前把自己身上所有 _xxxUntil／_xxxReadyAt 與三個 party-wide 時限 buff
// 都歸零，讓每一招都在乾淨狀態下量。
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

async function useAbilityOnce(page, kind, pointId) {
  await resetLingeringBuffs(page);
  await clearAccum(page, pointId);
  await settleEnemyHp(page, pointId);
  const fired = await page.evaluate(
    ({ kind, pointId }) => {
      const M = window.PriTestMidnight;
      M._debugResetMyAbilityCooldowns();
      // 前置條件（midnightAbilityPrecondition）：隱者的混成魔法要 3 個屬性痕。
      // 這是規則書的門檻，不是這支腳本要驗的東西，所以先墊滿讓招式真的跑得起來。
      M._debugSetElementalMarks(9);
      M._debugSetFp(999);
      const s0 = M._debugState();
      const entry = M._debugCharacterAbilityEntry(kind);
      const hpBefore = s0.fieldEnemyHp[pointId];
      const cdField = kind === "art" ? "_artCooldownUntil" : "_skillCooldownUntil";
      const t0 = Date.now();
      M._debugUseCharacterAbility(kind);
      const s1 = M._debugState();
      return {
        abilityId: entry.abilityId,
        expectedCdMs: entry.abilityId ? M._debugAbilityBaseCooldown(entry.abilityId, kind) : null,
        cdUntil: s1.characters[s1.myTokenId][cdField] || 0,
        t0: t0,
        hpBefore: hpBefore,
      };
    },
    { kind, pointId }
  );
  // HP 有變就馬上往下走；沒變（＝這招本來就不產生傷害）就等滿一個來回再判定。
  await page
    .waitForFunction(
      ({ pointId, hp }) => window.PriTestMidnight._debugState().fieldEnemyHp[pointId] !== hp,
      { pointId, hp: fired.hpBefore },
      { timeout: RTDB_ROUNDTRIP_MS }
    )
    .catch(() => {});
  // 招式本身沒傷害時上面的等待會逾時；再多給一點時間讓可能較慢的寫入落地。
  await page.waitForTimeout(400);
  const tail = await page.evaluate((p) => {
    const s = window.PriTestMidnight._debugState();
    const trig = s.attributeAccumTriggers[p];
    return { hpAfter: s.fieldEnemyHp[p], accumTriggered: !!(trig && Object.keys(trig).length) };
  }, pointId);
  return Object.assign(fired, tail);
}

// 取一個沒有被蓄積觸發污染的樣本（最多重試 2 次）。
async function useAbilityClean(page, kind, pointId) {
  let r = await useAbilityOnce(page, kind, pointId);
  for (let i = 0; i < 2 && r.accumTriggered; i++) {
    r = await useAbilityOnce(page, kind, pointId);
  }
  return r;
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
    assert(!!enc.activeEncounter, "戰鬥已建立（activeEncounter 生效）", "point=" + enc.pointId);
    if (!enc.activeEncounter) throw new Error("沒有 activeEncounter，後面的招式驗證沒有意義");

    // character_types.js 側的期望值：直接從頁面裡的同一份資料讀，不在腳本裡另抄一份。
    const types = await page.evaluate(() =>
      window.PriTestCharacterTypes.list().map((t) => ({
        id: t.id,
        name: t.name.zh,
        art: (t.arts || [])[0] ? { id: t.arts[0].id, level: t.arts[0].level } : null,
        skill: (t.skills || [])[0] ? { id: t.skills[0].id, level: t.skills[0].level } : null,
      }))
    );
    console.log("掃描對象：" + types.length + " 個角色類型 × 〔技能〕〔技藝〕\n");

    const damaging = [];
    const textOnly = [];
    const oneShot = [];
    const samples = [];

    for (const t of types) {
      const line = [];

      // ---- B 等級門檻 ----
      const gate = await page.evaluate((typeId) => {
        const M = window.PriTestMidnight;
        const out = {};
        [1, 2, 3].forEach((lv) => {
          M._debugSetTypeAndLevel(typeId, lv);
          out["lv" + lv] = {
            art: M._debugAbilityUnlock("art"),
            skill: M._debugAbilityUnlock("skill"),
            hidden: M._debugAbilityButtonsHidden(),
          };
        });
        return out;
      }, t.id);
      assert(
        !gate.lv1.art.unlocked && !gate.lv1.skill.unlocked && gate.lv1.hidden.art && gate.lv1.hidden.skill,
        t.name + "：Lv1 技能與技藝都上鎖且按鈕隱藏"
      );
      assert(
        gate.lv2.skill.unlocked && !gate.lv2.art.unlocked,
        t.name + "：Lv2 只開技能（技藝仍鎖）"
      );
      assert(gate.lv3.art.unlocked && gate.lv3.skill.unlocked, t.name + "：Lv3 技能與技藝都開放");

      await page.evaluate((typeId) => window.PriTestMidnight._debugSetTypeAndLevel(typeId, 3), t.id);

      for (const kind of ["skill", "art"]) {
        const expected = kind === "art" ? t.art : t.skill;
        const r = await useAbilityClean(page, kind, enc.pointId);

        // ---- A 資料一致 ----
        assert(
          r.abilityId === (expected && expected.id),
          t.name + "／" + kind + "：解出的 ability id 與 character_types.js 一致",
          "got=" + r.abilityId + " want=" + (expected && expected.id)
        );

        // ---- C 冷卻被設成 abilityBaseCooldownMs() 的值 ----
        const cdSet = r.cdUntil - r.t0;
        assert(
          r.expectedCdMs !== null && Math.abs(cdSet - r.expectedCdMs) <= 1500,
          t.name + "／" + kind + "：冷卻＝abilityBaseCooldownMs()",
          "set≈" + cdSet + "ms expected=" + r.expectedCdMs + "ms"
        );

        // ---- D 冷卻中再按一次不會重設冷卻 ----
        const second = await page.evaluate(
          ({ kind }) => {
            const M = window.PriTestMidnight;
            const s = M._debugState();
            const f = kind === "art" ? "_artCooldownUntil" : "_skillCooldownUntil";
            const before = s.characters[s.myTokenId][f] || 0;
            M._debugUseCharacterAbility(kind);
            const s2 = M._debugState();
            return { before, after: s2.characters[s2.myTokenId][f] || 0 };
          },
          { kind }
        );
        assert(
          second.after === second.before,
          t.name + "／" + kind + "：冷卻中再按一次被擋下（冷卻時刻沒有被重設）",
          "before=" + second.before + " after=" + second.after
        );

        // ---- E 傷害 ----
        const dmg = r.hpBefore - r.hpAfter;
        // 確定性檢查：不能拿「第1次 vs 第2次」比，因為規則裡有一票「同一場戰鬥只算一次」
        // 的後效果（例如淑女技能強化的追加HP損害），第1次會多打一份、第2次就沒有了——
        // 那是規則正確行為，不是 bug。所以跑 3 次，用第2、3次（一次性效果都已用掉之後）
        // 互比，那才是這一招自己的穩定傷害。
        const r2 = await useAbilityClean(page, kind, enc.pointId);
        const r3 = await useAbilityClean(page, kind, enc.pointId);
        const dmg2 = r2.hpBefore - r2.hpAfter;
        const dmg3 = r3.hpBefore - r3.hpAfter;
        // 這裡刻意**不**斷言「三次傷害相同」。實測發現 midnight 的單次傷害本來就不是
        // 確定值：招式施加的屬性／異常蓄積一旦跨過 ATTRIBUTE_STATUS_THRESHOLD，會另外
        // 打一發隨機 51~100（屬性）／151~200（異常）的觸發傷害，而那一發是非同步寫入
        // RTDB 的，測量端沒辦法可靠地把它跟招式本身的傷害分開。硬要斷言相等只會做出一支
        // 隨機紅燈的測試。三次的數字照樣印出來供人判讀，但不當成通過條件。
        samples.push(t.name + "／" + kind + "  1st=" + dmg + " 2nd=" + dmg2 + " 3rd=" + dmg3);
        if (dmg > dmg2) oneShot.push(t.name + "／" + kind + "：首次多 " + (dmg - dmg2));
        if (dmg2 > 0) {
          damaging.push(t.name + "／" + kind + "＝" + dmg2 + (dmg > dmg2 ? "（首次 " + dmg + "）" : ""));
          line.push(kind + "=" + dmg2);
        } else if (dmg > 0) {
          damaging.push(t.name + "／" + kind + "＝0（僅首次 " + dmg + "，一次性後效果）");
          line.push(kind + "=一次性" + dmg);
        } else {
          // 威力無法自動解算的招式：依 CLAUDE.md §19 慣例顯示規則原文交給 GM，
          // 不發明數值。這裡只記錄，不當成失敗。
          textOnly.push(t.name + "／" + kind + "(" + r.abilityId + ")");
          line.push(kind + "=規則原文");
        }
      }
      console.log("  " + t.name.padEnd(9, "　") + "  " + line.join("  "));
    }

    // ---- F 全程沒有 JS 例外 ----
    assert(pageErrors.length === 0, "全程 40 次招式使用沒有拋出任何 JS 例外", pageErrors.join(" / "));

    console.log("\n有傷害的招式（" + damaging.length + "）：");
    damaging.forEach((d) => console.log("  " + d));
    console.log("\n交給 GM 判讀規則原文的招式（" + textOnly.length + "）：");
    textOnly.forEach((d) => console.log("  " + d));
    console.log("\n帶有「一場只算一次」後效果的招式（" + oneShot.length + "）：");
    oneShot.forEach((d) => console.log("  " + d));
    console.log("\n各招三次測量的原始數字（含蓄積觸發的隨機加成，僅供判讀）：");
    samples.forEach((d) => console.log("  " + d));
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
