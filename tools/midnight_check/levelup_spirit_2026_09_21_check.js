// ============================================================================
// midnight 2026-09-21 回歸測試：升級時上限與現在值同步增加／復仇者靈體 HP＝格×10
// （Playwright ＋ Firebase Local Emulator）
// ============================================================================
// 使用前準備（跟 emulator_sync_check.js 完全相同，見該檔開頭）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node levelup_spirit_2026_09_21_check.js
//
// 涵蓋項目：
//   ① 升級到 Lv2（HP 格）：競技場 HP 上限 +10，現在值也 +10（例 60/110 → 70/120）
//   ② 升級到 Lv3（FP 格）：FP 上限 +10，現在值 +10
//   ③ 升級到 Lv4（體力格，midnight 專用 +5 終值）：體力上限 +5，現在值 +5
//   ④ 降級 Lv4→Lv3：體力上限／現在值同額 -5
//   ⑤ 復仇者靈體 HP：海倫 20／弗雷德里克 50／賽巴斯汀 60（格×10，不是雜兵的 ×100）
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const META_WAIT_MS = 20000;

const results = [];
function assert(cond, label, detail) {
  results.push({ label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label + (cond || detail === undefined ? "" : "　→ " + JSON.stringify(detail)));
}

// database emulator 的 port（9000 被 IntelliJ 等佔用時用 PRITEST_EMU_PORT 覆寫，同 relic_memory_emulator_check.js）
const EMU_PORT = process.env.PRITEST_EMU_PORT || "9000";

async function enableEmulatorFlag(page) {
  await page.addInitScript((port) => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
      window.sessionStorage.setItem("pritestRtdbEmulatorPort", port);
    } catch (e) {
      /* 忽略 */
    }
  }, EMU_PORT);
}

async function joinLobby(page, passcode) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", passcode);
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
}

const waitFor = (page, fn, arg, timeout) => page.waitForFunction(fn, arg, { timeout: timeout || META_WAIT_MS });

// 冷卻歸零要等 RTDB 回流（同 ability_2026_09_21_check.js 的寫法）。
async function resetCooldowns(page) {
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

async function becomeAvenger(page) {
  await page.evaluate(() => window.PriTestMidnight._debugSetTypeAndLevel("avenger", 3));
  await waitFor(page, () => {
    const s = window.PriTestMidnight._debugState();
    const c = s.characters[s.myTokenId];
    return c && c.typeId === "avenger" && c.level === 3;
  });
  await resetCooldowns(page);
  await page.evaluate(() => {
    const M = window.PriTestMidnight;
    M._debugSetActiveEncounterForFx(true);
    M._debugUpdateAbilityVisuals();
    const s = M._debugState();
    s.fp.current = s.fp.max;
  });
}

// 升級一次並在同一個同步區段內量測 FP／體力的前後值（體力每幀自然回復，必須同步量測）。
async function levelDeltaProbe(page, delta) {
  return await page.evaluate((d) => {
    const M = window.PriTestMidnight;
    const s = M._debugState();
    const c = s.characters[s.myTokenId];
    const before = {
      level: c.level,
      hpMax: M._debugSelfArenaHpMax(),
      fpMax: s.fp.max,
      fpCur: s.fp.current,
      stMax: s.stamina.max,
      stCur: s.stamina.current,
    };
    M._debugLevelDelta(d);
    const s2 = M._debugState();
    const after = {
      level: s2.characters[s2.myTokenId].level,
      hpMax: M._debugSelfArenaHpMax(),
      fpMax: s2.fp.max,
      fpCur: s2.fp.current,
      stMax: s2.stamina.max,
      stCur: s2.stamina.current,
    };
    return { before, after };
  }, delta);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror] " + e.message));

  try {
    await enableEmulatorFlag(page);
    console.log("=== 建立 midnight 測試場（連本機 emulator）並單人開局 ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await joinLobby(page, "1234");
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 25000 });
    await page.waitForFunction(() => {
      const s = window.PriTestMidnight._debugState();
      return !!s.characters[s.myTokenId] && !!s.localPos && typeof s.demoStats[s.myTokenId] === "number";
    }, { timeout: META_WAIT_MS });

    // 準備：盧恩補到 50、HP／FP／體力都扣到「未滿」狀態，才看得出現在值有沒有跟著加
    await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const before = M._debugSnapshotMyCharacter();
      s.characters[s.myTokenId].runes = 50;
      s.characters[s.myTokenId].level = 1;
      M._debugSyncMyCharacterChanges(before);
      s.fp.current = Math.max(0, s.fp.max - 15);
      s.stamina.current = Math.max(0, s.stamina.max - 40);
      const hpMax = M._debugSelfArenaHpMax();
      return window.PriTestGameStorage.rtSet(s.gameId, "cloud", "demoStat/" + s.myTokenId, hpMax - 40);
    });
    await waitFor(page, () => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      return s.characters[s.myTokenId].runes === 50 && s.demoStats[s.myTokenId] === M._debugSelfArenaHpMax() - 40;
    });

    // ======================================================================
    console.log("\n=== ① Lv1→Lv2（HP 格）：上限 +10、現在值 +10 ===");
    const hpBefore = await page.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return { cur: s.demoStats[s.myTokenId], max: window.PriTestMidnight._debugSelfArenaHpMax() };
    });
    const p1 = await levelDeltaProbe(page, 1);
    assert(p1.after.level === 2, "①：等級 1→2", p1);
    assert(p1.after.hpMax === p1.before.hpMax + 10, "①：競技場 HP 上限 +10", p1);
    await waitFor(page, (target) => {
      const s = window.PriTestMidnight._debugState();
      return s.demoStats[s.myTokenId] === target;
    }, hpBefore.cur + 10);
    const hpAfter = await page.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return { cur: s.demoStats[s.myTokenId], max: window.PriTestMidnight._debugSelfArenaHpMax() };
    });
    assert(hpAfter.cur === hpBefore.cur + 10 && hpAfter.max === hpBefore.max + 10, "①：HP " + hpBefore.cur + "/" + hpBefore.max + " → " + hpAfter.cur + "/" + hpAfter.max, { hpBefore, hpAfter });
    assert(p1.after.fpCur === p1.before.fpCur && p1.after.stMax === p1.before.stMax, "①：FP／體力不動", p1);

    // ======================================================================
    console.log("\n=== ② Lv2→Lv3（FP 格）：上限 +10、現在值 +10 ===");
    const p2 = await levelDeltaProbe(page, 1);
    assert(p2.after.level === 3, "②：等級 2→3", p2);
    assert(p2.after.fpMax === p2.before.fpMax + 10 && p2.after.fpCur === p2.before.fpCur + 10, "②：FP " + p2.before.fpCur + "/" + p2.before.fpMax + " → " + p2.after.fpCur + "/" + p2.after.fpMax, p2);
    assert(p2.after.hpMax === p2.before.hpMax && p2.after.stMax === p2.before.stMax, "②：HP／體力上限不動", p2);

    // ======================================================================
    console.log("\n=== ③ Lv3→Lv4（體力格）：上限 +5、現在值 +5 ===");
    const p3 = await levelDeltaProbe(page, 1);
    assert(p3.after.level === 4, "③：等級 3→4", p3);
    assert(p3.after.stMax === p3.before.stMax + 5 && Math.abs(p3.after.stCur - (p3.before.stCur + 5)) < 0.01, "③：體力 " + p3.before.stCur.toFixed(1) + "/" + p3.before.stMax + " → " + p3.after.stCur.toFixed(1) + "/" + p3.after.stMax, p3);
    assert(p3.after.hpMax === p3.before.hpMax && p3.after.fpCur === p3.before.fpCur, "③：HP／FP 不動", p3);

    // ======================================================================
    console.log("\n=== ④ Lv4→Lv3 降級：體力上限／現在值 -5 ===");
    const p4 = await levelDeltaProbe(page, -1);
    assert(p4.after.level === 3, "④：等級 4→3", p4);
    assert(p4.after.stMax === p4.before.stMax - 5 && Math.abs(p4.after.stCur - (p4.before.stCur - 5)) < 0.01, "④：體力同額扣回", p4);

    // ======================================================================
    console.log("\n=== ⑤ 復仇者靈體 HP＝格×10 ===");
    const spiritHp = await page.evaluate(() => window.PriTestMidnight._debugSpiritSummonTypes().map((d) => ({ kind: d.kind, hp: d.maxHp })));
    const expected = { helen: 20, frederik: 50, sebastian: 60 };
    assert(
      spiritHp.length === 3 && spiritHp.every((d) => d.hp === expected[d.kind]),
      "⑤：海倫 20／弗雷德里克 50／賽巴斯汀 60",
      spiritHp
    );

    // ======================================================================
    console.log("\n=== ⑥ 靈體 HP 跨戰鬥保存／祝福補一半／換日補滿 ===");
    await becomeAvenger(page);
    const summon = async (kind) => {
      await resetCooldowns(page);
      await page.evaluate((k) => window.PriTestMidnight._debugSpiritChoice(k), kind);
      await page.waitForTimeout(300);
      return await page.evaluate(() => {
        const s = window.PriTestMidnight._debugState();
        return s.characters[s.myTokenId].summonedSpirit || null;
      });
    };
    const stored = (kind) => page.evaluate((k) => window.PriTestMidnight._debugStoredSpiritHp(k), kind);

    const first = await summon("frederik");
    assert(first && first.kind === "frederik" && first.hp === 50, "⑥：首次召喚弗雷德里克 HP 50/50", first);
    await page.evaluate(() => window.PriTestMidnight._debugAbsorbDamageWithSpirit(30));
    assert((await stored("frederik")) === 20, "⑥：受 30 傷害後保存值 20");
    await page.evaluate(() => window.PriTestMidnight._debugOnEncounterEnded());
    const afterEnd = await page.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return { spirit: s.characters[s.myTokenId].summonedSpirit || null, kept: window.PriTestMidnight._debugStoredSpiritHp("frederik") };
    });
    assert(afterEnd.spirit === null && afterEnd.kept === 20, "⑥：戰鬥結束靈體消失、HP 保持 20（不補滿）", afterEnd);
    await page.evaluate(() => window.PriTestMidnight._debugSetActiveEncounterForFx(true));
    const second = await summon("frederik");
    assert(second && second.hp === 20 && second.maxHp === 50, "⑥：再次召喚從 20/50 開始", second);
    await page.evaluate(() => window.PriTestMidnight._debugAbsorbDamageWithSpirit(20));
    const dead = await page.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return { spirit: s.characters[s.myTokenId].summonedSpirit || null, kept: window.PriTestMidnight._debugStoredSpiritHp("frederik") };
    });
    assert(dead.spirit === null && dead.kept === 0, "⑥：陣亡後保存值 0", dead);
    const blocked = await summon("frederik");
    assert(blocked === null, "⑥：HP 0 的靈體不能召喚（擋在扣 FP 之前）", blocked);
    const helenOk = await summon("helen");
    assert(helenOk && helenOk.kind === "helen" && helenOk.hp === 20, "⑥：其他靈體（海倫 20/20）仍可召喚", helenOk);
    await page.evaluate(() => window.PriTestMidnight._debugAbsorbDamageWithSpirit(5));
    await page.evaluate(() => window.PriTestMidnight._debugOnEncounterEnded());
    const readAll = () =>
      page.evaluate(() => ({
        frederik: window.PriTestMidnight._debugStoredSpiritHp("frederik"),
        helen: window.PriTestMidnight._debugStoredSpiritHp("helen"),
        sebastian: window.PriTestMidnight._debugStoredSpiritHp("sebastian"),
      }));
    const bless1 = await page.evaluate(() => window.PriTestMidnight._debugApplyBlessingRestore("bless_A"));
    const afterBless = await readAll();
    assert(bless1 === true && afterBless.frederik === 25 && afterBless.helen === 20 && afterBless.sebastian === 60, "⑥：祝福休息：弗雷德里克 0→25（上限一半）、海倫 15→20（不超上限）", afterBless);
    // 同一個祝福再用一次：HP/FP/體力照舊回滿，但靈體不再回復
    const bless1Again = await page.evaluate(() => window.PriTestMidnight._debugApplyBlessingRestore("bless_A"));
    const afterBlessAgain = await readAll();
    assert(bless1Again === false && afterBlessAgain.frederik === 25, "⑥：同一個祝福再次使用不再回復靈體（弗雷德里克仍 25）", afterBlessAgain);
    // 另一個祝福籌碼：再回復一次
    const bless2 = await page.evaluate(() => window.PriTestMidnight._debugApplyBlessingRestore("bless_B"));
    const afterBless2 = await readAll();
    assert(bless2 === true && afterBless2.frederik === 50, "⑥：不同祝福籌碼可再回復一次（弗雷德里克 25→50）", afterBless2);
    await page.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugAbsorbDamageWithSpirit(0);
    });
    // 把弗雷德里克再打回去，才看得出換日補滿
    await page.evaluate(() => window.PriTestMidnight._debugSetActiveEncounterForFx(true));
    const third = await summon("frederik");
    await page.evaluate(() => window.PriTestMidnight._debugAbsorbDamageWithSpirit(30));
    await page.evaluate(() => window.PriTestMidnight._debugOnEncounterEnded());
    assert(third && third.hp === 50 && (await stored("frederik")) === 20, "⑥：換日前弗雷德里克 20（受 30 傷）", third);
    await page.evaluate(() => window.PriTestMidnight._debugRestoreSpiritHpOnNewDay());
    const afterDay = await page.evaluate(() => ({
      frederik: window.PriTestMidnight._debugStoredSpiritHp("frederik"),
      helen: window.PriTestMidnight._debugStoredSpiritHp("helen"),
      sebastian: window.PriTestMidnight._debugStoredSpiritHp("sebastian"),
    }));
    assert(afterDay.frederik === 50 && afterDay.helen === 20 && afterDay.sebastian === 60, "⑥：換日：三隻補滿", afterDay);
    await page.evaluate(() => window.PriTestMidnight._debugSetActiveEncounterForFx(true));
    const menuProbe = await page.evaluate(() => {
      window.PriTestMidnight._debugClickCharacterSkill();
      const menu = document.getElementById("midnight-spirit-choice-menu");
      const out = { hidden: menu.hidden, labels: Array.from(menu.querySelectorAll("button")).map((b) => b.textContent + (b.disabled ? "[disabled]" : "")) };
      window.PriTestMidnight._debugClickCharacterSkill();
      return out;
    });
    assert(menuProbe.hidden === false && menuProbe.labels.some((l) => l.indexOf("50/50") !== -1), "⑥：三選一選單顯示保存中的 HP／上限", menuProbe);

    // ======================================================================
    // 2026-09-25 使用者回報「無法主動用召喚靈體來召喚單一靈體」：選單按鈕以前每一幀都重建，
    // 真人點擊（按下→放開跨好幾幀）放開時手指下已經是另一顆按鈕，click 不會觸發。
    // Playwright 的 mouse.click 是同一幀內按下＋放開，所以這裡刻意「按住 150ms 再放開」。
    console.log("\n=== ⑧ 召喚靈體：真人式點擊（按住再放開）也能召喚 ===");
    await page.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugOnEncounterEnded();
      M._debugSetActiveEncounterForFx(true);
      const s = M._debugState();
      s.fp.current = s.fp.max;
    });
    // 這支測試沒走完開場動畫，全螢幕的 #midnight-intro-overlay 會擋住真實滑鼠（dispatchEvent 不受影響），先收掉。
    await page.evaluate(() => {
      const o = document.getElementById("midnight-intro-overlay");
      if (o) o.style.display = "none";
    });
    await resetCooldowns(page);
    await page.dispatchEvent("#btn-midnight-character-skill", "click");
    await page.waitForTimeout(200);
    const stable = await page.evaluate(async () => {
      const first = document.querySelector("#midnight-spirit-choice-menu button");
      await new Promise((r) => setTimeout(r, 150));
      return first === document.querySelector("#midnight-spirit-choice-menu button");
    });
    assert(stable, "⑧：選單開著時按鈕節點不會每一幀被換掉");
    const target = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("#midnight-spirit-choice-menu button"));
      const b = btns.filter((x) => !x.disabled)[0];
      if (!b) return null;
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.textContent };
    });
    if (target) {
      await page.mouse.move(target.x, target.y);
      await page.mouse.down();
      await page.waitForTimeout(150);
      await page.mouse.up();
      await page.waitForTimeout(300);
    }
    const summoned = await page.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      return s.characters[s.myTokenId].summonedSpirit || null;
    });
    assert(!!target && !!summoned && summoned.hp > 0, "⑧：按住 150ms 再放開也能召喚出靈體", { target, summoned });

    // ======================================================================
    // 2026-09-25 使用者明確規格「能力招魂為被動，雜兵死掉能自動多召喚一隻靈體」：
    // 不擲骰必定召喚死靈（HP 3 格、其餘＝海倫），會自動攻擊、不代受傷害、戰鬥結束消失。
    console.log("\n=== ⑨ 死靈術：必定召喚、自動攻擊、不代受、戰鬥結束消失 ===");
    const necro = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      const helen = M._debugSpiritSummonTypes().filter((d) => d.kind === "helen")[0];
      for (let i = 0; i < 6; i++) M._debugTriggerNecromancy();
      const list = (c.deathSpirits || []).map((d) => ({ hp: d.hp, maxHp: d.maxHp, dmg: d.dmg }));
      return { list, level: c.level, helenMaxHp: helen.maxHp, helenRows: helen.maxHp / 2 };
    });
    // 期待値：HP＝3 格（海倫 2 格 → 1 格＝helen.maxHp/2）、傷害＝海倫的 15＋等級×5
    const wantHp = necro.helenRows * 3;
    assert(necro.list.length === 6, "⑨：6 次雜兵歸零 → 6 隻死靈（不擲骰、必定召喚、沒有上限）", necro.list.length);
    assert(necro.list.every((d) => d.hp === wantHp && d.maxHp === wantHp), "⑨：死靈 HP＝3 格（" + wantHp + "）", necro.list[0]);
    assert(necro.list.every((d) => d.dmg === 15 + necro.level * 5), "⑨：死靈傷害＝海倫的 15＋等級×5", necro.list[0]);
    // 浮標由每幀的 renderCharPanel() 重繪，等它追上
    await page.waitForFunction(() => document.getElementById("midnight-spirit-badge").textContent.indexOf("×6") !== -1, null, { timeout: 3000 }).catch(() => {});
    const badgeText = await page.evaluate(() => document.getElementById("midnight-spirit-badge").textContent);
    assert(badgeText.indexOf("×6") !== -1, "⑨：浮標顯示死靈數量", badgeText);
    const attack = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      const before = c.deathSpirits.map((d) => d.nextAttackAt);
      const now = Date.now() + 60000;
      M._debugUpdateDeathSpirits(now);
      return { before, after: c.deathSpirits.map((d) => d.nextAttackAt), now };
    });
    assert(attack.after.every((t) => t > attack.now), "⑨：到點的死靈全部出手（下次攻擊時刻往後排）", attack);
    const absorb = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      const spiritHp = c.summonedSpirit ? c.summonedSpirit.hp : null;
      const deathBefore = c.deathSpirits.map((d) => d.hp).join(",");
      M._debugAbsorbDamageWithSpirit(5);
      return { spiritBefore: spiritHp, spiritAfter: c.summonedSpirit ? c.summonedSpirit.hp : 0, deathBefore, deathAfter: c.deathSpirits.map((d) => d.hp).join(",") };
    });
    assert(absorb.deathBefore === absorb.deathAfter && absorb.spiritAfter < absorb.spiritBefore, "⑨：代受傷害的只有技能靈體（死靈 HP 不變）", absorb);
    const ended = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      M._debugOnEncounterEnded();
      const s = M._debugState();
      return (s.characters[s.myTokenId].deathSpirits || []).length;
    });
    assert(ended === 0, "⑨：戰鬥結束時死靈消失", ended);

    // ======================================================================
    console.log("\n=== ⑦ 第 10 隻夜王 nameless 名簿與圖片 ===");
    const nameless = await page.evaluate(async () => {
      const NB = window.PriTestNightBosses;
      const b = NB.get("nameless");
      const src = b ? NB.imagePath(b, "../static/") : null;
      let status = null;
      if (src) {
        const r = await fetch(new URL(src, location.href).toString(), { method: "GET" });
        status = r.status;
      }
      return { count: NB.list().length, entry: b, src, status, rulebook: !!window.PriTestBossRulebook.get("nameless") };
    });
    assert(nameless.count === 10 && nameless.entry && nameless.entry.image === "nameless.jpg", "⑦：night_bosses.js 名簿 10 隻、含 nameless", nameless);
    assert(nameless.status === 200 && nameless.rulebook, "⑦：nameless.jpg 可載入（HTTP 200）且規則書資料存在", nameless);
  } catch (e) {
    console.log("  [ERROR] " + (e && e.stack ? e.stack : e));
    results.push({ label: "script error", pass: false });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n=== 結果：" + (results.length - failed.length) + "/" + results.length + " PASS ===");
  failed.forEach((r) => console.log("  FAIL: " + r.label));
  process.exit(failed.length ? 1 : 0);
})();
