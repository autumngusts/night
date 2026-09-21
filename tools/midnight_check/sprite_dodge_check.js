// ============================================================================
// midnight 2026-09-22 回歸測試：點陣圖戰鬥模式的迴避時機判定（Playwright ＋ Firebase Local Emulator）
// ============================================================================
// 使用前準備（跟 emulator_sync_check.js 完全相同，見該檔開頭）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node sprite_dodge_check.js
//
// 使用者明確規格（2026-09-22）：
//   ・紅光 0.5s 後為正式出招時刻 T；T−0.1s 才從 idle 切成攻擊動畫；連擊每一下重播
//   ・（2026-09-22 第 2 版「判定嚴格度更改」）依按下時刻的時間帶判定，帶內線性遞減：
//       [T−0.1, T+0.3] Perfect 100／(T+0.3, T+0.5] Great 99→80／(T+0.5, T+0.75] Good 80→60／
//       (T+0.75, T+W] Bad 59→30
//   ・窗口 1.0／1.5／2.0s（第 1／2／3 下）
//   ・迴避後在迴避鍵上方另外顯示 Perfect／Great／Good／Bad
// 涵蓋項目：
//   ① 純函式：窗口長度、減傷％線性衰減、分級門檻
//   ② 實戰：紅光在 T 前顯示、T 後消失；動畫在 T(k)−0.1s 才切換且每一下各重播一次
//   ③ 實戰：在 T 後立刻按迴避 → Perfect、HP 不減
//   ④ 實戰：在窗口尾端按迴避 → Bad、HP 依線性減傷扣（範圍檢查，CLAUDE.md §4.7 原則）
// 期望值都從 _debug 入口與敵人資料算出，不硬編。
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const META_WAIT_MS = 20000;

const results = [];
function assert(cond, label, detail) {
  results.push({ label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label + (cond || detail === undefined ? "" : "　→ " + JSON.stringify(detail)));
}

const waitFor = (page, fn, arg, timeout) => page.waitForFunction(fn, arg, { timeout: timeout || META_WAIT_MS });
const state = (page) => page.evaluate(() => window.PriTestMidnight._debugState());
const ATTACK_ANIMS = ["line", "area", "thrust", "slam", "single"];

async function currentAttack(page) {
  return page.evaluate(() => (window.PriTestMidnight._debugState().fieldTriggers.battleSim || {}).enemyAttack || null);
}

// 等下一次「新的」enemyAttack 出現（attackId 不同於 prev）
async function waitNextAttack(page, prevId) {
  await waitFor(page, (prev) => {
    const a = (window.PriTestMidnight._debugState().fieldTriggers.battleSim || {}).enemyAttack;
    return !!(a && a.attackId && a.attackId !== prev);
  }, prevId, 15000);
  return currentAttack(page);
}

async function hitAt(page, atk, k) {
  return page.evaluate((a) => window.PriTestMidnight._debugSpriteHitAt(a.atk, a.k), { atk, k });
}

// 等到本機時刻 >= t 再按迴避（mousedown/click 都不是——迴避鍵綁的是 click；CLAUDE.md §4.6 用 dispatchEvent）
async function dodgeAt(page, t) {
  await waitFor(page, (tt) => Date.now() >= tt, t, 15000);
  await page.dispatchEvent("#btn-midnight-dodge", "click");
  return page.evaluate(() => Date.now());
}

async function waitAttackDone(page, attackId) {
  await waitFor(page, (id) => {
    const s = window.PriTestMidnight._debugState();
    const a = (s.fieldTriggers.battleSim || {}).enemyAttack;
    return !a || a.attackId !== id;
  }, attackId, 20000);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror] " + e.message));

  try {
    await page.addInitScript(() => {
      try {
        window.sessionStorage.setItem("pritestRtdbEmulator", "1");
      } catch (e) {
        /* 忽略 */
      }
    });
    console.log("=== 建立點陣圖模式＋戰鬥模擬房（單人） ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await waitFor(page, () => window.PriTestMidnight && window.PriTestMidnight._debugState().meta);
    await page.click("#midnight-lobby-slots .midnight-slot-empty button");
    await page.fill("#midnight-lobby-passcode-input", "1234");
    await page.click("#btn-midnight-lobby-join");
    await waitFor(page, () => !!window.PriTestMidnight._debugState().mySlot);
    await page.check("#midnight-lobby-sprite-mode-checkbox");
    await waitFor(page, () => window.PriTestMidnight._debugState().meta.spriteMode === true);
    page.once("dialog", (d) => d.accept("nightnight"));
    await page.click("#btn-midnight-lobby-battle-sim");
    await waitFor(page, () => !!(window.PriTestMidnight._debugState().meta.battleSim || {}).enemyId);

    console.log("=== ① 純函式 ===");
    const win = await page.evaluate(() => [0, 1, 2].map((k) => window.PriTestMidnight._debugEnemyAttackHitWindowMs(k)));
    assert(win[0] === 1000 && win[1] === 1500 && win[2] === 2000, "點陣圖模式窗口 1.0／1.5／2.0s", win);
    const J = await page.evaluate(() => {
      const st = { hitAt: 10000, phaseEndAt: 11000 }; // W=1.0s
      const f = (dt) => window.PriTestMidnight._debugSpriteDodgeJudge(st, 10000 + dt);
      return { m100: f(-100), p0: f(0), p300: f(300), p301: f(301), p400: f(400), p500: f(500), p501: f(501), p625: f(625), p750: f(750), p751: f(751), p875: f(875), p1000: f(1000), p1500: f(1500) };
    });
    const g = (j) => j.grade + ":" + j.pct;
    assert(g(J.m100) === "perfect:100" && g(J.p0) === "perfect:100" && g(J.p300) === "perfect:100", "[T−0.1, T+0.3] Perfect 100%", J);
    assert(g(J.p301) === "great:99" && g(J.p400) === "great:90" && g(J.p500) === "great:80", "(T+0.3, T+0.5] Great 99→80（中點 90）", J);
    assert(g(J.p501) === "good:80" && g(J.p625) === "good:70" && g(J.p750) === "good:60", "(T+0.5, T+0.75] Good 80→60（中點 70）", J);
    assert(g(J.p751) === "bad:59" && g(J.p875) === "bad:45" && g(J.p1000) === "bad:30", "(T+0.75, T+W] Bad 59→30（W=1.0 中點 45）", J);
    assert(g(J.p1500) === "bad:30", "窗口之後夾在 30%", J);
    const J2 = await page.evaluate(() => window.PriTestMidnight._debugSpriteDodgeJudge({ hitAt: 10000, phaseEndAt: 12000 }, 10875));
    assert(J2.grade === "bad" && J2.pct === 56, "時間帶不隨 W 伸縮：W=2.0 時 T+0.875 仍是 Bad（59→30 的 1/10 處＝56%）", J2);

    console.log("=== 開局進戰鬥（無開場動畫） ===");
    await page.click("#btn-midnight-lobby-ready");
    await waitFor(page, () => (window.PriTestMidnight._debugState().activeEncounter || {}).id === "battleSim", null, 30000);
    // 讓敵人 HP 夠高、玩家不會被打死；並在頁面內掛取樣器（動畫／紅光／playAnim 呼叫）
    await page.evaluate(() => {
      const S = window.PriTestMidnightSprite;
      window.__animCalls = [];
      const orig = S.playAnim;
      S.playAnim = function (id, at) {
        window.__animCalls.push({ id, at, now: Date.now() });
        return orig.apply(this, arguments);
      };
      window.__samples = [];
      setInterval(() => {
        window.__samples.push({ t: Date.now(), anim: S.currentAnimId(), warn: !document.querySelector("#midnight-incoming-attack-warning").hidden });
      }, 10);
    });
    const s0 = await state(page);
    const myToken = s0.myTokenId;
    const hpOf = async () => (await state(page)).demoStats[myToken];
    // 體力先補滿（迴避要體力）
    await page.evaluate(() => { const s = window.PriTestMidnight._debugState(); s.stamina.current = s.stamina.max; });

    console.log("=== ②③ 第一次攻擊：紅光／動畫時序＋T 後立刻迴避＝Perfect ===");
    let atk = await waitNextAttack(page, null);
    let hitCount = atk.hitCount || 1;
    console.log("  招式:", JSON.stringify({ name: atk.actionName && atk.actionName.ja, hits: hitCount, dmg: atk.dmgAmount, kind: atk.dmgKind }));
    const hpBefore1 = await hpOf();
    const T = [];
    for (let k = 0; k < hitCount; k++) T.push(await hitAt(page, atk, k));
    const gradesSeen = [];
    for (let k = 0; k < hitCount; k++) {
      await page.evaluate(() => { const s = window.PriTestMidnight._debugState(); s.stamina.current = s.stamina.max; });
      const pressed = await dodgeAt(page, T[k] + 20);
      await page.waitForTimeout(80);
      gradesSeen.push({ k, lag: pressed - T[k], grade: await page.textContent("#midnight-dodge-grade"), flash: await page.textContent("#midnight-dodge-flash") });
    }
    await waitAttackDone(page, atk.attackId);
    const hpAfter1 = await hpOf();
    assert(gradesSeen.every((g) => g.lag <= 300), "每一下都在 T+0.3s 內按到（Playwright 延遲）", gradesSeen);
    assert(gradesSeen.every((g) => g.grade === "Perfect"), "每一下的成功度都顯示 Perfect", gradesSeen);
    assert(gradesSeen.every((g) => g.flash === "成功迴避"), "「成功迴避」同時顯示", gradesSeen);
    assert(hpAfter1 === hpBefore1, "Perfect 迴避 HP 不減", { before: hpBefore1, after: hpAfter1 });
    const samples = await page.evaluate(() => window.__samples.splice(0));
    const animCalls = await page.evaluate(() => window.__animCalls.splice(0));
    const warnBefore = samples.filter((s) => s.t >= T[0] - 400 && s.t <= T[0] - 150);
    const warnAfter = samples.filter((s) => s.t >= T[0] + 80 && s.t <= T[0] + 300);
    assert(warnBefore.length > 0 && warnBefore.every((s) => s.warn), "T 前 0.15~0.4s 紅光顯示中", warnBefore.length);
    assert(warnAfter.length > 0 && warnAfter.every((s) => !s.warn), "T 後紅光消失", warnAfter.length);
    const idleBefore = samples.filter((s) => s.t >= T[0] - 400 && s.t <= T[0] - 150);
    assert(idleBefore.every((s) => s.anim === "idle"), "T−0.1s 之前（紅光期間）sprite 仍是 idle", idleBefore.map((s) => s.anim));
    const attackAfter = samples.filter((s) => s.t >= T[0] + 30 && s.t <= T[0] + 250);
    assert(attackAfter.length > 0 && attackAfter.every((s) => ATTACK_ANIMS.indexOf(s.anim) !== -1), "T 之後 sprite 已是攻擊動畫", attackAfter.map((s) => s.anim));
    const attackCalls = animCalls.filter((c) => ATTACK_ANIMS.indexOf(c.id) !== -1);
    assert(attackCalls.length === hitCount, "攻擊動畫 playAnim 呼叫次數＝連擊下數（" + hitCount + "）", attackCalls);
    const startOk = attackCalls.every((c, i) => Math.abs(c.at - (T[i] - 100)) <= 1 && c.now >= T[i] - 100 - 5);
    assert(startOk, "每一下的動畫 startAt＝T(k)−0.1s，且不早於該時刻才呼叫", attackCalls.map((c, i) => ({ at: c.at - T[i], called: c.now - T[i] })));

    console.log("=== ④ 第二次攻擊：窗口尾端才按＝Bad、HP 依線性減傷扣 ===");
    atk = await waitNextAttack(page, atk.attackId);
    hitCount = atk.hitCount || 1;
    console.log("  招式:", JSON.stringify({ name: atk.actionName && atk.actionName.ja, hits: hitCount, dmg: atk.dmgAmount, kind: atk.dmgKind }));
    const T2 = [];
    for (let k = 0; k < hitCount; k++) T2.push(await hitAt(page, atk, k));
    const W0 = win[0];
    const hpBefore2 = await hpOf();
    await page.evaluate(() => { const s = window.PriTestMidnight._debugState(); s.stamina.current = s.stamina.max; });
    const pressedLate = await dodgeAt(page, T2[0] + W0 - 150);
    await page.waitForTimeout(80);
    const lateGrade = await page.textContent("#midnight-dodge-grade");
    const expectedPct = (await page.evaluate((a) => window.PriTestMidnight._debugSpriteDodgeJudge({ hitAt: a.hitAt, phaseEndAt: a.hitAt + a.w }, a.pressed), { hitAt: T2[0], w: W0, pressed: pressedLate })).pct;
    // 之後的連擊全部 Perfect 化解，只留下第 1 下的部分傷害
    for (let k = 1; k < hitCount; k++) {
      await page.evaluate(() => { const s = window.PriTestMidnight._debugState(); s.stamina.current = s.stamina.max; });
      await dodgeAt(page, T2[k] + 20);
    }
    await waitAttackDone(page, atk.attackId);
    const hpAfter2 = await hpOf();
    const raw = Math.round((atk.dmgAmount || 0) / 10); // enemyAtkMult=1
    // 按下時刻只知道在 [T+W−150, T+W−150+延遲]，減傷％介於 expectedPct（依實際按下時刻算）附近；
    // 用「依 pressedLate 算出的 pct」直接對照，容許 ±1 的四捨五入差。
    const expectedLoss = Math.round(raw * (1 - expectedPct / 100));
    const loss = hpBefore2 - hpAfter2;
    assert(lateGrade === "Bad", "窗口尾端迴避顯示 Bad（減傷 " + expectedPct + "%）", { lateGrade, expectedPct, lag: pressedLate - T2[0] });
    assert(expectedPct >= 30 && expectedPct < 60, "尾端按下的減傷％落在 Bad 區間 30~59", expectedPct);
    assert(Math.abs(loss - expectedLoss) <= 1, "HP 扣除＝round(原始傷害 " + raw + " ×(1−" + expectedPct + "%))＝" + expectedLoss, { loss, hpBefore2, hpAfter2 });
    console.log("=== ④b 第三次攻擊：T+0.6s 按＝Good、HP 依 Good 帶（80→60）扣 ===");
    atk = await waitNextAttack(page, atk.attackId);
    hitCount = atk.hitCount || 1;
    const T3 = [];
    for (let k = 0; k < hitCount; k++) T3.push(await hitAt(page, atk, k));
    const hpBefore3 = await hpOf();
    await page.evaluate(() => { const s = window.PriTestMidnight._debugState(); s.stamina.current = s.stamina.max; });
    const pressedGood = await dodgeAt(page, T3[0] + 600);
    await page.waitForTimeout(80);
    const goodGrade = await page.textContent("#midnight-dodge-grade");
    const goodJudge = await page.evaluate((a) => window.PriTestMidnight._debugSpriteDodgeJudge({ hitAt: a.hitAt, phaseEndAt: a.hitAt + a.w }, a.pressed), { hitAt: T3[0], w: W0, pressed: pressedGood });
    for (let k = 1; k < hitCount; k++) {
      await page.evaluate(() => { const s = window.PriTestMidnight._debugState(); s.stamina.current = s.stamina.max; });
      await dodgeAt(page, T3[k] + 20);
    }
    await waitAttackDone(page, atk.attackId);
    const hpAfter3 = await hpOf();
    const raw3 = Math.round((atk.dmgAmount || 0) / 10);
    const expectedLoss3 = Math.round(raw3 * (1 - goodJudge.pct / 100));
    assert(goodGrade === "Good" && goodJudge.grade === "good", "T+0.6s 迴避顯示 Good（減傷 " + goodJudge.pct + "%，lag " + (pressedGood - T3[0]) + "ms）", { goodGrade, goodJudge });
    assert(goodJudge.pct >= 60 && goodJudge.pct <= 80, "Good 帶的減傷％在 60~80", goodJudge.pct);
    assert(Math.abs(hpBefore3 - hpAfter3 - expectedLoss3) <= 1, "HP 扣除＝round(" + raw3 + "×(1−" + goodJudge.pct + "%))＝" + expectedLoss3, { loss: hpBefore3 - hpAfter3 });

    console.log("=== ⑤ 連擊：等到 hitCount>=2 的招式，每一下動畫重播、每一下 Perfect ===");
    // 一般敵人 2 下機率 40%，最多等 10 次攻擊；等不到就標示 SKIP（機率性，不是功能失敗）。
    let multi = null;
    let prevId = atk.attackId;
    for (let i = 0; i < 10 && !multi; i++) {
      const a = await waitNextAttack(page, prevId);
      prevId = a.attackId;
      if ((a.hitCount || 1) >= 2) {
        multi = a;
        break;
      }
      // 單擊：Perfect 化解後等它結束
      await page.evaluate(() => { const s = window.PriTestMidnight._debugState(); s.stamina.current = s.stamina.max; });
      await dodgeAt(page, (await hitAt(page, a, 0)) + 20);
      await waitAttackDone(page, a.attackId);
    }
    if (!multi) {
      console.log("  [SKIP] 10 次攻擊都沒抽到連擊（機率性），略過 ⑤");
    } else {
      const hc = multi.hitCount;
      console.log("  招式:", JSON.stringify({ name: multi.actionName && multi.actionName.ja, hits: hc, dmg: multi.dmgAmount }));
      await page.evaluate(() => { window.__animCalls.length = 0; window.__samples.length = 0; });
      const Tm = [];
      for (let k = 0; k < hc; k++) Tm.push(await hitAt(page, multi, k));
      const hpBeforeM = await hpOf();
      const seenM = [];
      for (let k = 0; k < hc; k++) {
        await page.evaluate(() => { const s = window.PriTestMidnight._debugState(); s.stamina.current = s.stamina.max; });
        const pressed = await dodgeAt(page, Tm[k] + 20);
        await page.waitForTimeout(80);
        seenM.push({ k, lag: pressed - Tm[k], grade: await page.textContent("#midnight-dodge-grade") });
      }
      await waitAttackDone(page, multi.attackId);
      const hpAfterM = await hpOf();
      const callsM = (await page.evaluate(() => window.__animCalls.slice())).filter((c) => ATTACK_ANIMS.indexOf(c.id) !== -1);
      assert(Tm[1] - Tm[0] === win[0] && (hc < 3 || Tm[2] - Tm[1] === win[1]), "T(k+1)＝T(k)＋W(k)（1.0／1.5s）", Tm.map((t) => t - Tm[0]));
      assert(callsM.length === hc, "連擊 " + hc + " 下 → 攻擊動畫重播 " + hc + " 次", callsM);
      assert(callsM.every((c, i) => Math.abs(c.at - (Tm[i] - 100)) <= 1), "每一下的重播 startAt＝T(k)−0.1s", callsM.map((c, i) => c.at - Tm[i]));
      const samplesM = await page.evaluate(() => window.__samples.slice());
      // 重播由影格迴圈觸發（rAF 約 16ms 一格），T−0.1s 之後留 40ms 的影格容差再開始檢查。
      const restart = samplesM.filter((s) => s.t >= Tm[1] - 60 && s.t <= Tm[1] + 60);
      assert(restart.length > 0 && restart.every((s) => ATTACK_ANIMS.indexOf(s.anim) !== -1), "第 2 下的 T−0.1s 起 sprite 已切回攻擊動畫", restart.map((s) => s.anim));
      assert(seenM.every((g) => g.grade === "Perfect"), "每一下都 Perfect", seenM);
      assert(hpAfterM === hpBeforeM, "連擊全部 Perfect → HP 不減", { hpBeforeM, hpAfterM });
    }
  } catch (e) {
    console.log("  [ERROR] " + (e && e.stack ? e.stack : e));
    results.push({ label: "腳本例外中止", pass: false });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log("");
  console.log("=== 結果：" + (results.length - failed.length) + "/" + results.length + " 通過 ===");
  if (failed.length) {
    failed.forEach((r) => console.log("  FAIL: " + r.label));
    process.exit(1);
  }
})();
