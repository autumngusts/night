// ============================================================================
// Playwright 回歸測試：2026-09-24 追加的戰鬥特效與攻擊鍵操作模型改版
// ============================================================================
// 使用者指定的 7 項：
//   ① 傷害飄字（敵人血條下方貼右、只寫主要傷害、裝置同步、1 秒內累加、到期消失、不寫0）
//   ② 受擊震動
//   ③ 靜態模式以既有刀光為提示（不做大變動——這裡只確認每一下都有觸發）
//   ④ 原本沒有發動瞬間特效的 10 招補齊
//   ⑤ 攻擊變化型刀光（2Hit＝兩道反向交叉、蓄力／跳躍／衝刺各自變體）
//   ⑤-1 攻擊鍵 ◀ ▶ 切換已裝填攻擊；蓄力改為長按 1.0 秒；未滿放開＝取消
//   ⑥ 遠距武器的投射物
//   ⑦ 擊破演出
//
// 走 Firebase Local Emulator（見 emulator_sync_check.js 開頭的環境說明）。
// 執行：node combat_fx_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const WAIT = 20000;

const results = [];
const pageErrors = [];
function assert(cond, label, extra) {
  results.push({ label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label + (extra ? "   " + extra : ""));
}

// database emulator 的 port（9000 被 IntelliJ 等佔用時用 PRITEST_EMU_PORT 覆寫，同 relic_memory_emulator_check.js）
const EMU_PORT = process.env.PRITEST_EMU_PORT || "9000";

async function enableEmulatorFlag(page) {
  await page.addInitScript((port) => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
      window.sessionStorage.setItem("pritestRtdbEmulatorPort", port);
    } catch (e) {}
  }, EMU_PORT);
}

const click = (page, sel) => page.dispatchEvent(sel, "click"); // CLAUDE.md §4.6
const S = (page) => page.evaluate(() => window.PriTestMidnight._debugState());

async function joinAndStart(page) {
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
    const participants = {};
    participants[s.mySlot] = true;
    window.PriTestMidnight._debugSetLocalPos(pt.x + 0.5, pt.y + 0.5);
    const GS = window.PriTestGameStorage;
    return GS.rtSet(s.gameId, "cloud", "fieldTrigger/" + pt.id, {
      status: "resolved",
      participants: participants,
      branchIndex: 0,
      floorIndex: 0,
      level: 1,
      enemyFamilyId: "rat_basilisk",
      enemyId: "big_rats",
    })
      .then(() => GS.rtSet(s.gameId, "cloud", "fieldEnemyHp/" + pt.id, 100000000))
      .then(() => pt.id);
  });
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().activeEncounter, { timeout: 20000 }).catch(() => {});
  const st = await S(page);
  return { pointId, activeEncounter: st.activeEncounter };
}

// 直接改 RTDB 的敵人 HP 來模擬「有人打出傷害」——飄字刻意是從 fieldEnemyHp 的變化量推得的
// （見 midnight.js 的 accumulateEnemyDamageFloat），所以這樣模擬走的正是實際那條路徑，
// 也同時證明了「裝置同步」：任何裝置看到 HP 下降都會算出同一個數字。
async function dealDamage(page, pointId, amount) {
  await page.evaluate(
    ({ p, amt }) => {
      const s = window.PriTestMidnight._debugState();
      const cur = s.fieldEnemyHp[p];
      return window.PriTestGameStorage.rtSet(s.gameId, "cloud", "fieldEnemyHp/" + p, cur - amt);
    },
    { p: pointId, amt: amount }
  );
  await page.waitForTimeout(500);
}

const floatText = (page) =>
  page.evaluate(() => {
    const e = document.getElementById("midnight-enemy-damage-float");
    // 2026-09-25 規格「不使用彈跳出而使血條等等變形。預留顯示空間」：飄字はもう hidden を
    // 切り替えない（常に高さを保つ）。見えているかは .midnight-damage-float-idle の有無で判定。
    return e && !e.classList.contains("midnight-damage-float-idle") ? e.textContent : null;
  });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => {
    pageErrors.push(String(e && e.message ? e.message : e));
    console.log("  [PAGE ERROR] " + e.message);
  });

  try {
    await enableEmulatorFlag(page);
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: WAIT });
    await joinAndStart(page);
    const enc = await setupEncounter(page);
    assert(!!enc.activeEncounter, "戰鬥已建立");

    // ---------------------------------------------------------------- ① 傷害飄字
    console.log("\n=== ① 傷害飄字 ===");
    assert((await floatText(page)) === null, "尚未造成傷害時不顯示（不寫0）");

    // 2026-09-25 規格「預留顯示空間」：數字出現前後，血條列的位置與面板高度都不變。
    const hpRowBox = () =>
      page.evaluate(() => {
        const row = document.querySelector(".midnight-enemy-hp-row");
        const panel = document.getElementById("midnight-hud-bottom-center");
        const f = document.getElementById("midnight-enemy-damage-float");
        return {
          rowTop: row.getBoundingClientRect().top,
          panelH: panel.getBoundingClientRect().height,
          floatH: f.getBoundingClientRect().height,
        };
      });
    const beforeBox = await hpRowBox();
    assert(beforeBox.floatH > 0, "沒有數字時飄字列仍佔著高度（預留空間）", beforeBox);

    await dealDamage(page, enc.pointId, 120);
    const afterBox = await hpRowBox();
    assert(
      Math.abs(afterBox.rowTop - beforeBox.rowTop) < 0.5 && Math.abs(afterBox.panelH - beforeBox.panelH) < 0.5,
      "數字出現時血條與面板不跳動",
      { before: beforeBox, after: afterBox }
    );
    assert((await floatText(page)) === "120", "打出 120 後顯示 120", "text=" + (await floatText(page)));

    await dealDamage(page, enc.pointId, 35);
    assert((await floatText(page)) === "155", "1 秒內再打 35 → 累加成 155", "text=" + (await floatText(page)));

    // 位置：必須在敵人血條那一列的後面（＝下方），且靠右對齊。
    const layout = await page.evaluate(() => {
      const row = document.querySelector(".midnight-enemy-hp-row");
      const f = document.getElementById("midnight-enemy-damage-float");
      if (!row || !f) return null;
      const rb = row.getBoundingClientRect();
      const fb = f.getBoundingClientRect();
      return { below: fb.top >= rb.top, align: getComputedStyle(f).textAlign, sameParent: row.parentNode === f.parentNode };
    });
    assert(!!layout && layout.below, "飄字在敵人血條下方");

    // 2026-09-25 使用者明確規格「傷害顯示的字體在小0.8倍，不擋住真實血條，真實血條要拉到戰鬥面板的右端」
    const hpLayout = await page.evaluate(() => {
      const panel = document.getElementById("midnight-hud-bottom-center");
      const track = document.querySelector(".midnight-enemy-hp-row .midnight-bar-track");
      const f = document.getElementById("midnight-enemy-damage-float");
      const ps = getComputedStyle(panel);
      const pb = panel.getBoundingClientRect();
      const contentRight = pb.right - parseFloat(ps.paddingRight) - parseFloat(ps.borderRightWidth);
      const tb = track.getBoundingClientRect();
      const fb = f.getBoundingClientRect();
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return {
        trackRight: tb.right,
        trackBottom: tb.bottom,
        contentRight: contentRight,
        floatTop: fb.top,
        floatFontRem: parseFloat(getComputedStyle(f).fontSize) / rem,
      };
    });
    assert(Math.abs(hpLayout.floatFontRem - 1.15 * 0.8) < 0.01, "傷害字體＝舊值 1.15rem 的 0.8 倍", hpLayout.floatFontRem);
    assert(Math.abs(hpLayout.trackRight - hpLayout.contentRight) <= 1, "敵人血條延伸到戰鬥面板右端", hpLayout);
    assert(hpLayout.floatTop >= hpLayout.trackBottom - 0.5, "傷害數字不壓到血條上", hpLayout);
    assert(!!layout && layout.align === "right", "靠右對齊", "text-align=" + (layout && layout.align));

    console.log("  等 1.2 秒（超過累加視窗）…");
    await page.waitForTimeout(1300);
    assert((await floatText(page)) === null, "1 秒沒有補傷害就消失");

    await dealDamage(page, enc.pointId, 40);
    assert((await floatText(page)) === "40", "消失後重新計算（不是接著 155 累加）", "text=" + (await floatText(page)));

    // 回血／無變化不顯示
    await page.evaluate(
      ({ p }) => {
        const s = window.PriTestMidnight._debugState();
        return window.PriTestGameStorage.rtSet(s.gameId, "cloud", "fieldEnemyHp/" + p, s.fieldEnemyHp[p] + 500);
      },
      { p: enc.pointId }
    );
    await page.waitForTimeout(1400);
    assert((await floatText(page)) === null, "敵人回血不會顯示負數或 0");

    // ---------------------------------------------------------------- ⑤-1 攻擊鍵
    console.log("\n=== ⑤-1 攻擊方式切換與蓄力長按 ===");
    const noSpecial = await page.evaluate(() => {
      const r = document.getElementById("midnight-attack-mode-right");
      return r ? r.hidden : null;
    });
    assert(noSpecial === true, "沒有習得跳躍／衝刺時，切換列整個隱藏");

    // 習得跳躍＋衝刺＋蓄力（追蹤者有這三個 Action 型遺物效果）。
    await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      const c = s.characters[s.myTokenId];
      const CD = window.PriTestCharacterDrawer;
      const type = window.PriTestCharacterTypes.get(c.typeId);
      c.learnedRelicEffects = c.learnedRelicEffects || [];
      // 掃過這個角色類型的全部遺物效果，把三種特殊攻擊的 key 直接加進已習得清單
      // （跟 _debugLearnRelicByVariantId 同一種「測試直接塞」作法）。
      const NAMES = ["跳躍攻擊", "ジャンプ攻撃", "衝刺攻擊", "ダッシュ攻撃", "蓄力攻擊", "タメ攻撃"];
      for (let g = 0; g < 12; g++) {
        for (let i = 0; i < 12; i++) {
          const key = c.typeId + "-r" + g + "-" + i;
          const eff = CD.relicEffectForKey ? CD.relicEffectForKey(type, key) : null;
          if (!eff || !eff.name) continue;
          const nm = eff.name.zh || eff.name.ja || "";
          if (NAMES.indexOf(nm) !== -1 && c.learnedRelicEffects.indexOf(key) === -1) c.learnedRelicEffects.push(key);
        }
      }
      // 2026-09-25：新房間改為預設點陣圖模式後，每次出手都會寫 character/<id>/_spriteAnim，
      // RTDB 回傳的角色節點會覆蓋掉只改在記憶體裡的欄位（舊版這裡沒寫回，蓄力後切換列就消失，
      // 造成「可以切回普通攻擊」的假失敗）。所以習得清單也要寫回 RTDB。
      window.PriTestGameStorage.rtSet(s.gameId, "cloud", "character/" + s.myTokenId + "/learnedRelicEffects", c.learnedRelicEffects);
      return c.learnedRelicEffects.length;
    });
    await page.waitForTimeout(400);

    const modeState = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const row = document.getElementById("midnight-attack-mode-right");
      const label = document.getElementById("midnight-attack-mode-label-right");
      return { hidden: row ? row.hidden : null, label: label ? label.textContent : null };
    });
    assert(modeState.hidden === false, "習得特殊攻擊後切換列顯示出來", JSON.stringify(modeState));
    assert(!!modeState.label, "切換列顯示目前裝填的攻擊方式", "label=" + modeState.label);

    const cycled = [];
    for (let i = 0; i < 4; i++) {
      await click(page, "#btn-midnight-attack-mode-next-right");
      await page.waitForTimeout(150);
      cycled.push(await page.evaluate(() => document.getElementById("midnight-attack-mode-label-right").textContent));
    }
    assert(new Set(cycled).size >= 2, "◀ ▶ 能循環切換（出現 2 種以上）", cycled.join(" → "));
    assert(cycled.indexOf(modeState.label) !== -1, "循環一圈會回到原本的那一項", cycled.join(" → "));

    // 蓄力不在切換清單裡（使用者明確選擇「不留」）
    const chargeLabel = await page.evaluate(() => window.I18N.t("midnight_special_attack_charge_label"));
    assert(cycled.indexOf(chargeLabel) === -1, "蓄力不出現在切換清單裡", "清單=" + cycled.join("／"));

    // 長按讀條與到點發動。
    // 2026-09-24 第二次修訂：蓄力門檻 1.0 秒 → 0.5 秒，而且「超過輕點門檻但沒按滿＝取消」
    // 整段拿掉（使用者：「蓄力改為只需按0.5秒，沒有按滿一律是普通攻擊」）。舊版這裡斷言的是
    // 「未滿 1.0 秒放開＝取消、什麼都不做」，那個期望值已經過時，改成驗「沒按滿照樣出手」。
    const CHARGE_MS = 500;

    // 先確認：按住一小段時間後讀條會出現。
    await page.dispatchEvent("#btn-midnight-attack-shared-target", "mousedown");
    await page.waitForTimeout(300);
    const gaugeMid = await page.evaluate(() => {
      const g = document.getElementById("midnight-attack-charge-gauge-right");
      return g ? { hidden: g.hidden, pct: g.style.getPropertyValue("--charge-pct") } : null;
    });
    assert(gaugeMid && gaugeMid.hidden === false, "按住之後顯示蓄力讀條", JSON.stringify(gaugeMid));
    await page.dispatchEvent("#btn-midnight-attack-shared-target", "mouseup");
    await page.waitForTimeout(250);
    assert(
      (await page.evaluate(() => document.getElementById("midnight-attack-charge-gauge-right").hidden)) === true,
      "放開後讀條收掉"
    );

    // 沒按滿＝照常出手（不是取消）。用 lastPcDamageInfo.at 有沒有變動來判斷「這一下有沒有
    // 真的打出去」——它是 applyDamageToFieldEnemyHp() 一開頭就同步寫好的本地欄位。
    //
    // 刻意**不**在這裡另外塞武器。第一版寫了「先塞一把 Weapons.list()[0] 並裝備」，結果把
    // 角色類型原本的起始武器換掉，availableSpecialAttackEntries() 因此解不出任何特殊攻擊，
    // 蓄力永遠不會發動——測出來的「蓄力傷害＝普通傷害」其實是測試自己造成的。角色類型
    // 本來就帶起始武器（追蹤者是 greatsword_pursuer），直接用就好。

    // 比較基準必須是「普通攻擊」：切換列這時停在跳躍攻擊，而跳躍的傷害剛好跟蓄力一樣
    // （跳躍＝1Hit+威力補正、蓄力＝1Hit+10，在這個角色身上同值），拿它當基準會得到
    // 「蓄力沒有比較高」的假失敗。先把裝填切回普通攻擊。
    const normalLabel = await page.evaluate(() => window.I18N.t("midnight_attack_mode_normal_label"));
    for (let i = 0; i < 6; i++) {
      const cur = await page.evaluate(() => document.getElementById("midnight-attack-mode-label-right").textContent);
      if (cur === normalLabel) break;
      await click(page, "#btn-midnight-attack-mode-next-right");
      await page.waitForTimeout(120);
    }
    assert(
      (await page.evaluate(() => document.getElementById("midnight-attack-mode-label-right").textContent)) === normalLabel,
      "可以切回普通攻擊當比較基準"
    );

    async function tapAndSee(holdMs) {
      const before = await page.evaluate(() => {
        const i = window.PriTestMidnight._debugLastPcDamageInfo();
        return i ? i.at : 0;
      });
      await page.evaluate(() => {
        const s = window.PriTestMidnight._debugState();
        s.stamina.current = s.stamina.max; // 體力不足會讓攻擊被擋下，這裡先補滿
      });
      await page.dispatchEvent("#btn-midnight-attack-shared-target", "mousedown");
      await page.waitForTimeout(holdMs);
      await page.dispatchEvent("#btn-midnight-attack-shared-target", "mouseup");
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => {
        const i = window.PriTestMidnight._debugLastPcDamageInfo();
        return i ? { at: i.at, raw: i.rawAmount } : null;
      });
      return { fired: !!after && after.at !== before, raw: after && after.raw };
    }

    const shortTap = await tapAndSee(80);
    assert(shortTap.fired, "輕點（80ms）會打出普通攻擊", "rawAmount=" + shortTap.raw);

    const midTap = await tapAndSee(CHARGE_MS - 180);
    assert(midTap.fired, "按住但沒按滿 0.5 秒放開，照樣打出攻擊（不再是取消）", "rawAmount=" + midTap.raw);

    // 按滿 0.5 秒＝蓄力。蓄力傷害是「1Hit 傷害 +10」，所以一定比剛才的普通攻擊高；
    // 期望值不硬編，直接跟上面量到的普通攻擊比大小。
    const charged = await tapAndSee(CHARGE_MS + 220);
    assert(charged.fired, "按滿 0.5 秒會打出蓄力攻擊", "rawAmount=" + charged.raw);
    assert(
      charged.raw > midTap.raw,
      "蓄力攻擊的傷害高於普通攻擊（本文「1Hit傷害+10」）",
      "普通=" + midTap.raw + " 蓄力=" + charged.raw
    );

    assert(pageErrors.length === 0, "全程沒有 JS 例外", pageErrors.join(" / "));
  } catch (e) {
    console.log("\n[EXCEPTION] " + (e && e.stack ? e.stack : e));
    results.push({ label: "腳本執行中發生例外", pass: false });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n" + "=".repeat(52));
  console.log(results.length - failed.length + " / " + results.length + " 通過");
  if (failed.length) {
    failed.forEach((f) => console.log("  FAIL: " + f.label));
    process.exit(1);
  }
  console.log("全部通過");
})();
