// ============================================================================
// midnight 迴避タイミング診断：「刀光を見て押したのに Perfect にならない」の原因切り分け
// ============================================================================
// 2026-09-27 使用者回報「有些裝置畫面上出現刀光按下閃避 但是似乎沒有正常在 perfect 的判定
// 可能造成畫面刀光的判定時間有差的因素為何」。
//
// 規格上は T−0.1s に刀光が出て、Perfect 帯は [T−0.1s, T+0.4s]＝**刀光から 500ms** ある
// （SPRITE_DODGE_BANDS）。つまり本来は「見てから押す」で十分間に合う設計。
// にもかかわらず外れる、ということは「刀光が見えた時刻」と「判定に使われる押下時刻」の
// あいだに、規格に書かれていない遅延が積まれているということになる。この道具は
// その遅延を層ごとに分けて実測する：
//
//   ① flashJs    … triggerAttackEffect() が hidden=false にした時刻 −（T−0.1s）
//                   ＝ rAF ループが窗口開始に気づくまでの遅れ（影格 1 枚ぶん以下のはず）
//   ② flashPaint … その直後の rAF コールバック時刻 −（T−0.1s）
//                   ＝ 画素が出る直前。プレイヤーの目に入る時刻はこれ以降
//   ③ press      … midnight 側が実際に記録した dodgePressedAt −（T−0.1s）
//   ④ grade      … その押下が実際に何判定になったか
//
// ページ内で「刀光が見えた瞬間に REACTION_MS 後に迴避を dispatch する」ところまで自動化し、
// Playwright との往復遅延を測定値に混ぜない。REACTION_MS＝0 は「人間の反応時間ゼロ」の
// 理論上限で、ここですでに Perfect を割るならプログラム側の遅延だけで説明がつく。
//
// 端末差をつくるために CDP の Emulation.setCPUThrottlingRate を使う。倍率は
// 実機そのものではないが、「主執行緒が混むとどの層が何 ms 伸びるか」の傾向は再現できる。
//
// 使用前準備（sprite_dodge_check.js と同じ）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node dodge_timing_diag.js
// 任意：REACTION_MS=250 node dodge_timing_diag.js（人間の反応時間ぶんを足して測る）
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const REACTION_MS = Number(process.env.REACTION_MS || 0);
const THROTTLES = (process.env.THROTTLES || "1,4,10,20").split(",").map(Number);
const SAMPLES_PER_RATE = Number(process.env.SAMPLES || 3);
const META_WAIT_MS = 20000;

const waitFor = (page, fn, arg, timeout) => page.waitForFunction(fn, arg, { timeout: timeout || META_WAIT_MS });

// ページ内に常駐させる測定器。刀光（#midnight-attack-effect の hidden=false）を
// MutationObserver で捕まえ、そこから REACTION_MS 後に迴避を投げ、
// midnight 側が記録した押下時刻と判定結果を回収する。
function installProbe(reactionMs) {
  window.__dodgeProbe = { samples: [], armed: false, reactionMs: reactionMs };
  const effect = document.getElementById("midnight-attack-effect");
  const obs = new MutationObserver(() => {
    const P = window.__dodgeProbe;
    if (!P.armed || effect.hidden) return;
    P.armed = false;
    const tJs = Date.now();
    // 次の rAF ＝ この変更が画面に出る直前。ここを「目に入る時刻」の下限として記録する。
    requestAnimationFrame(() => {
      const tPaint = Date.now();
      setTimeout(() => {
        const btn = document.getElementById("btn-midnight-dodge");
        const before = window.PriTestMidnight._debugState();
        const st = before.myIncomingAttack;
        // 迴避鍵は click バインド（CLAUDE.md §4.6）
        if (btn && !btn.disabled && !btn.hidden) btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        const after = window.PriTestMidnight._debugState();
        // 判定は #midnight-dodge-grade を読まない——あの表示は次の影格の
        // advanceIncomingAttackPhase() → resolveMyIncomingHit() で初めて書かれるので、
        // dispatch 直後にはまだ古い値が入っている。判定そのものを計算する純函式を
        // 同じ引数で呼ぶほうが確実（sprite_dodge_check.js が単体テストしているのと同じ関数）。
        const pressed = after.dodgePressedAt || null;
        P.samples.push({
          hitAt: st ? st.hitAt : null,
          windowStartAt: st ? st.windowStartAt : null,
          tJs: tJs,
          tPaint: tPaint,
          pressedAt: pressed,
          grade:
            st && pressed
              ? (function () {
                  const j = window.PriTestMidnight._debugSpriteDodgeJudge(st, pressed);
                  return j.grade + ":" + j.pct;
                })()
              : null,
        });
      }, P.reactionMs);
    });
  });
  obs.observe(effect, { attributes: true, attributeFilter: ["hidden", "class"] });

  // 影格間隔も拾っておく（刀光の遅れが「rAF が回っていない」せいなのかを切り分ける）
  window.__frameGaps = [];
  let last = 0;
  (function loop() {
    const now = Date.now();
    if (last) window.__frameGaps.push(now - last);
    last = now;
    if (window.__frameGaps.length > 4000) window.__frameGaps.shift();
    requestAnimationFrame(loop);
  })();
}

function stats(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  return {
    min: s[0],
    med: s[Math.floor(s.length / 2)],
    max: s[s.length - 1],
    avg: Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10,
  };
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror] " + e.message));
  const cdp = await context.newCDPSession(page);

  const rows = [];
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
    await page.check("#midnight-lobby-test-mode-checkbox");
    await waitFor(page, () => !document.querySelector("#midnight-lobby-test-tools").hidden);
    page.once("dialog", (d) => d.accept("nightnight"));
    await page.click("#btn-midnight-lobby-battle-sim");
    await waitFor(page, () => !!(window.PriTestMidnight._debugState().meta.battleSim || {}).enemyId);
    // ここまでは「部屋に戰鬥模擬を仕込んだ」だけ。ready を押して activeEncounter が
    // battleSim になって初めて敵が殴ってくる（sprite_dodge_check.js と同じ手順）。
    await page.click("#btn-midnight-lobby-ready");
    await waitFor(page, () => (window.PriTestMidnight._debugState().activeEncounter || {}).id === "battleSim", null, 30000);

    console.log("\nREACTION_MS=" + REACTION_MS + "（刀光が見えてから押すまでに足す時間）");
    console.log("Perfect 帯は T−0.1s〜T+0.4s。下の press 列が 500 を超えたら Perfect から落ちる。\n");

    for (const rate of THROTTLES) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      await page.evaluate(installProbe, REACTION_MS);
      await page.waitForTimeout(500);

      const got = [];
      for (let i = 0; i < SAMPLES_PER_RATE; i++) {
        await page.evaluate(() => {
          const s = window.PriTestMidnight._debugState();
          s.stamina.current = s.stamina.max; // 體力切れで迴避が不成立になると測定にならない
          const g = document.getElementById("midnight-dodge-grade");
          if (g) g.textContent = "";
          window.__dodgeProbe.armed = true;
        });
        try {
          await waitFor(page, (n) => window.__dodgeProbe.samples.length > n, got.length, 30000);
        } catch (e) {
          console.log("  rate x" + rate + "：" + (i + 1) + " 本目の攻擊を拾えず（timeout）");
          break;
        }
        const all = await page.evaluate(() => window.__dodgeProbe.samples);
        got.push(all[all.length - 1]);
        await page.waitForTimeout(1500); // 次の攻擊まで待つ（2〜4 秒間隔）
      }

      const gaps = await page.evaluate(() => window.__frameGaps.slice());
      // 各値は「T−0.1s（＝刀光が出るべき時刻／窗口開啟）」を 0 とした相対 ms
      const rel = (s, key) => (s[key] === null || s.windowStartAt === null ? null : s[key] - s.windowStartAt);
      const flashJs = got.map((s) => rel(s, "tJs")).filter((v) => v !== null);
      const flashPaint = got.map((s) => rel(s, "tPaint")).filter((v) => v !== null);
      const press = got.map((s) => rel(s, "pressedAt")).filter((v) => v !== null && v >= 0);
      const grades = got.map((s) => s.grade).filter(Boolean);

      rows.push({ rate, flashJs: stats(flashJs), flashPaint: stats(flashPaint), press: stats(press), frame: stats(gaps), grades });

      console.log(
        "  CPU x" +
          rate +
          "　影格間隔 med=" + (stats(gaps) ? stats(gaps).med : "-") + "ms max=" + (stats(gaps) ? stats(gaps).max : "-") + "ms" +
          "　flashJs=" + JSON.stringify(stats(flashJs)) +
          "　flashPaint=" + JSON.stringify(stats(flashPaint)) +
          "　press=" + JSON.stringify(stats(press)) +
          "　判定=" + JSON.stringify(grades)
      );
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  } finally {
    await browser.close();
  }

  console.log("\n==== まとめ（すべて「T−0.1s＝刀光が出るべき時刻」を 0 とした相対 ms）====");
  console.log("Perfect は press < 500 のあいだ。500 を超えると Great 以下へ落ちる。");
  rows.forEach((r) => {
    console.log(
      "  CPU x" + r.rate +
        "：影格 med " + (r.frame ? r.frame.med : "-") + "ms" +
        "／刀光(JS) " + (r.flashJs ? r.flashJs.med : "-") + "ms" +
        "／刀光(描画直前) " + (r.flashPaint ? r.flashPaint.med : "-") + "ms" +
        "／押下記録 " + (r.press ? r.press.med : "-") + "ms" +
        "　" + r.grades.join(",")
    );
  });
})();
