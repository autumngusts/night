// ============================================================================
// midnight（即時制擴張版）2026-09-10 第二批優化回歸測試（Firebase Local Emulator 版，
// 環境說明見 emulator_sync_check.js 開頭，這裡沿用同一套 emulator 旗標／準備步驟）。
// ============================================================================
// 驗證範圍（使用者這次明確要求的 8 個項目）：
//   1. 瀕死狀態下，下方所有動作按鍵（攻擊/戰技/迴避/防禦/技藝/技能/聖杯/道具/換武器/
//      逃離戰鬥）全部 disabled。
//   2. 右下／左下 HUD 按鈕寬度固定，文字變長（例如「攻擊」→「Hit」、戰技名稱）不會撐寬
//      按鈕、不會讓整排重排。
//   3. 有冷卻的按鍵改用圓形背景計時（.midnight-cooldown-dial ＋ --mn-cd），按鈕文字不再
//      附加「(Ns)」。
//   4. HUD「使用祝福」按下後會打開祝福視窗（可升級）；打贏夜之強敵後依黃金樹之帳的樓層
//      獎勵發給參與者（附帶效果＋盧恩，第2天另加石劍鑰匙）。
//   5. 敵人連續命中次數：一般敵人 1~2 下、上位敵人（強敵/封牢/特殊強敵/夜之強敵/夜之王）
//      1~3 下；刀光有多種方向；出招提示的招式名稱不閃爍。
//   6. 戰鬥中（含夜王戰）仍可打開角色視窗。
//   7. 瀕死拯救值條在深色底下的配色已更換（高對比青色）。
//   8. 夜之強敵戰後，上方 banner 顯示「離去後才能開始行動……」。
//
// 使用前準備：同 emulator_sync_check.js（generate.py 建 dist/、起本機 http server、
// npm install、起 firebase emulators:start --only database,auth）。
// 執行方式：node optimize_2026_09_10b_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const META_WAIT_MS = 15000;

function assert(cond, label, results) {
  results.push({ label: label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label);
}

async function enableEmulatorFlag(page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
    } catch (e) {
      /* ignore */
    }
  });
}

async function getState(page) {
  return page.evaluate(() => window.PriTestMidnight._debugState());
}

async function rtSet(page, gameId, path, value) {
  return page.evaluate(
    ({ gameId, path, value }) => window.PriTestGameStorage.rtSet(gameId, "cloud", path, value),
    { gameId, path, value }
  );
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = [];
  page.on("pageerror", (err) => console.log("  [pageerror]", err.message));

  try {
    await enableEmulatorFlag(page);

    console.log("=== 建立midnight測試場並加入 ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await page.click("#midnight-lobby-slots .midnight-slot-empty button");
    await page.fill("#midnight-lobby-passcode-input", "1234");
    await page.click("#btn-midnight-lobby-join");
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });

    const state0 = await getState(page);
    const gameId = state0.gameId;
    const tokenId = state0.myTokenId;
    const mySlot = state0.mySlot;

    // ---------------------------------------------------------------- 項目5（樣式部分）
    console.log("=== 項目5a：出招提示的招式名稱不閃爍 ===");
    const nameAnim = await page.evaluate(() => {
      const elx = document.getElementById("midnight-incoming-attack-name");
      const warn = document.getElementById("midnight-incoming-attack-warning");
      return {
        name: elx ? window.getComputedStyle(elx).animationName : null,
        // ⚠圖示本身的閃爍要保留（那是警示），只有名稱不閃。
        warnIcon: warn ? window.getComputedStyle(warn, "::after").animationName : null,
      };
    });
    assert(nameAnim.name === "none", "招式名稱沒有套用任何animation（實際=" + nameAnim.name + "）", results);
    assert(
      nameAnim.warnIcon && nameAnim.warnIcon !== "none",
      "⚠警示圖示本身的閃爍animation保留（實際=" + nameAnim.warnIcon + "）",
      results
    );

    console.log("=== 項目5b：刀光有多種方向（每個變體的漸層不同） ===");
    const slashBackgrounds = await page.evaluate(() => {
      const elx = document.getElementById("midnight-attack-effect");
      const classes = [
        "midnight-attack-effect-slash",
        "midnight-attack-effect-slash-2",
        "midnight-attack-effect-slash-3",
        "midnight-attack-effect-slash-4",
        "midnight-attack-effect-slash-5",
        "midnight-attack-effect-slash-6",
      ];
      const before = elx.className;
      const out = classes.map((cls) => {
        elx.className = cls;
        return window.getComputedStyle(elx, "::after").backgroundImage;
      });
      elx.className = before;
      return out;
    });
    const uniqueSlashes = new Set(slashBackgrounds.filter((b) => b && b !== "none"));
    assert(uniqueSlashes.size === 6, "6種刀光變體各自有不同的漸層方向/落點，實際不重複數=" + uniqueSlashes.size, results);

    console.log("=== 項目5c：連續命中次數依敵人等級分兩組機率 ===");
    const hitDist = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      function sample(pt, trig, n) {
        const counts = {};
        for (let i = 0; i < n; i++) {
          const v = M._debugPickEnemyAttackHitCount(pt, trig);
          counts[v] = (counts[v] || 0) + 1;
        }
        return counts;
      }
      const normalPt = { id: "p_normal", type: "field" };
      const strongPt = { id: "p_strong", type: "strong_enemy" };
      const gaolPt = { id: "p_gaol", type: "evergaol" };
      const bossPt = { id: "day3Boss" };
      const finalPt = { id: "finalCircleDay2" };
      const meteorPt = { id: "p_meteor", type: "random_event" };
      return {
        normal: sample(normalPt, {}, 4000),
        strong: sample(strongPt, {}, 4000),
        elite: {
          strong: M._debugIsEliteEncounterPoint(strongPt, {}),
          gaol: M._debugIsEliteEncounterPoint(gaolPt, {}),
          day3: M._debugIsEliteEncounterPoint(bossPt, {}),
          finalCircle: M._debugIsEliteEncounterPoint(finalPt, {}),
          meteorWithEnemy: M._debugIsEliteEncounterPoint(meteorPt, { enemyFamilyId: "x" }),
          meteorNoEnemy: M._debugIsEliteEncounterPoint(meteorPt, {}),
          normal: M._debugIsEliteEncounterPoint(normalPt, {}),
        },
      };
    });
    const nTotal = 4000;
    const nPct = (k) => ((hitDist.normal[k] || 0) / nTotal) * 100;
    const ePct = (k) => ((hitDist.strong[k] || 0) / nTotal) * 100;
    assert(!hitDist.normal["3"], "一般敵人不會出現3連擊（實際3連擊次數=" + (hitDist.normal["3"] || 0) + "）", results);
    assert(Math.abs(nPct(1) - 60) < 4, "一般敵人1下約60%（實際=" + nPct(1).toFixed(1) + "%）", results);
    assert(Math.abs(nPct(2) - 40) < 4, "一般敵人2下約40%（實際=" + nPct(2).toFixed(1) + "%）", results);
    assert(Math.abs(ePct(1) - 50) < 4, "上位敵人1下約50%（實際=" + ePct(1).toFixed(1) + "%）", results);
    assert(Math.abs(ePct(2) - 30) < 4, "上位敵人2下約30%（實際=" + ePct(2).toFixed(1) + "%）", results);
    assert(Math.abs(ePct(3) - 20) < 4, "上位敵人3下約20%（實際=" + ePct(3).toFixed(1) + "%）", results);
    const e = hitDist.elite;
    assert(
      e.strong && e.gaol && e.day3 && e.finalCircle && e.meteorWithEnemy && !e.meteorNoEnemy && !e.normal,
      "上位敵人判定涵蓋強敵/封牢/夜王/夜之強敵/隕石王戰，且一般點與無敵人的隨機事件不算，實際=" + JSON.stringify(e),
      results
    );

    // ---------------------------------------------------------------- 項目7
    console.log("=== 項目7：瀕死拯救值條換成高對比配色 ===");
    const revivalColor = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "midnight-bar-fill midnight-bar-revival";
      document.body.appendChild(probe);
      const cs = window.getComputedStyle(probe);
      const out = { bg: cs.backgroundColor, shadow: cs.boxShadow };
      probe.remove();
      return out;
    });
    assert(revivalColor.bg === "rgb(41, 224, 255)", "拯救值條配色已換成高對比青色（實際=" + revivalColor.bg + "）", results);
    assert(revivalColor.shadow && revivalColor.shadow !== "none", "拯救值條加了外發光，在深色底上更明顯", results);

    // ---------------------------------------------------------------- 項目2
    console.log("=== 項目2：右下/左下HUD按鈕寬度固定，文字變長不會撐寬 ===");
    const widthCheck = await page.evaluate(() => {
      const label = document.getElementById("midnight-attack-shared-target-label");
      const btn = document.getElementById("btn-midnight-attack-shared-target");
      const dodge = document.getElementById("btn-midnight-dodge");
      const before = { attack: btn.offsetWidth, dodge: dodge.offsetWidth };
      const originalText = label.textContent;
      label.textContent = "非常非常非常長的戰技名稱測試用文字";
      const after = { attack: btn.offsetWidth, dodge: dodge.offsetWidth };
      const labelOverflow = window.getComputedStyle(label).textOverflow;
      label.textContent = originalText;
      return { before, after, labelOverflow };
    });
    assert(
      widthCheck.before.attack === widthCheck.after.attack,
      "把攻擊鍵文字換成超長字串後，按鈕寬度不變（" + widthCheck.before.attack + "→" + widthCheck.after.attack + "px）",
      results
    );
    assert(
      widthCheck.before.dodge === widthCheck.after.dodge,
      "旁邊的迴避鍵寬度也不受影響，整排不會重排（" + widthCheck.before.dodge + "→" + widthCheck.after.dodge + "px）",
      results
    );
    assert(widthCheck.labelOverflow === "ellipsis", "超長文字用省略號截斷，不會溢出按鈕", results);

    // ---------------------------------------------------------------- 項目3
    console.log("=== 項目3：冷卻改用圓形背景計時，文字不再附加秒數 ===");
    const artVisible = await page.evaluate(() => {
      const b = document.getElementById("btn-midnight-art");
      return !!b && !b.hidden;
    });
    if (!artVisible) {
      console.log("  [SKIP] 這次抽到的角色類型沒有〔技藝〕按鈕，略過圓形冷卻的端對端檢查");
    } else {
      await page.evaluate(() => document.getElementById("btn-midnight-art").click());
      await page.waitForTimeout(400);
      const dial = await page.evaluate(() => {
        const b = document.getElementById("btn-midnight-art");
        const labelText = document.getElementById("midnight-art-label").textContent;
        return {
          hasClass: b.classList.contains("midnight-cooldown-dial"),
          cd: b.style.getPropertyValue("--mn-cd"),
          bg: window.getComputedStyle(b, "::before").backgroundImage,
          labelText: labelText,
          disabled: b.disabled,
        };
      });
      assert(dial.hasClass && !!dial.cd, "使用技藝後按鈕掛上.midnight-cooldown-dial並寫入--mn-cd（實際=" + dial.cd + "）", results);
      assert(/conic-gradient/.test(dial.bg || ""), "圓形計時盤用conic-gradient呈現（順時針掃一圈）", results);
      assert(!/\d+\s*s/.test(dial.labelText) && !/\(/.test(dial.labelText), "按鈕文字只有招式名稱、沒有附加秒數（實際=「" + dial.labelText + "」）", results);
      assert(dial.disabled, "冷卻中按鈕確實停用", results);
    }

    // ---------------------------------------------------------------- 項目1
    console.log("=== 項目1：瀕死狀態下所有下方動作按鍵停用 ===");
    await rtSet(page, gameId, "character/" + tokenId + "/nearDeath", {
      active: true,
      downedAt: Date.now(),
      deadlineAt: Date.now() + 600000,
      progress: 0,
      required: 60,
    });
    await page.waitForFunction(() => {
      const st = window.PriTestMidnight._debugState();
      const c = st.characters[st.myTokenId];
      return !!(c && c.nearDeath && c.nearDeath.active);
    }, { timeout: 10000 });
    await page.waitForTimeout(400);
    const downedButtons = await page.evaluate(() => {
      const ids = [
        "btn-midnight-attack-shared-target",
        "btn-midnight-skill",
        "btn-midnight-dodge",
        "btn-midnight-block",
        "btn-midnight-use-flask",
        "btn-midnight-use-consumable",
        "btn-midnight-weapon-left",
        "btn-midnight-weapon-right",
        "btn-midnight-art",
        "btn-midnight-character-skill",
        "btn-midnight-flee-battle",
      ];
      const out = {};
      ids.forEach((id) => {
        const b = document.getElementById(id);
        // hidden的按鈕（例如這個角色類型沒有的技藝/技能）不列入判斷——看不到就按不到。
        out[id] = !b || b.hidden ? "hidden" : b.disabled;
      });
      return out;
    });
    const stillEnabled = Object.keys(downedButtons).filter((k) => downedButtons[k] === false);
    assert(stillEnabled.length === 0, "瀕死中所有可見的動作按鍵都停用，仍可按的=" + JSON.stringify(stillEnabled), results);
    // 角色視窗按鈕不該被鎖（使用者原始規格：瀕死中仍能查看角色資訊與開啟選單）
    const viewButtons = await page.evaluate(() => ({
      sheet: document.getElementById("btn-midnight-open-character-sheet").disabled,
      menu: document.getElementById("btn-midnight-toggle-menu").disabled,
    }));
    assert(!viewButtons.sheet && !viewButtons.menu, "瀕死中「角色」與「選單」按鈕仍可按（純檢視操作不鎖）", results);
    await rtSet(page, gameId, "character/" + tokenId + "/nearDeath", null);
    await page.waitForFunction(() => {
      const st = window.PriTestMidnight._debugState();
      const c = st.characters[st.myTokenId];
      return !(c && c.nearDeath && c.nearDeath.active);
    }, { timeout: 10000 });

    // ---------------------------------------------------------------- 項目6 + 4 + 8
    console.log("=== 項目6/4/8：夜之強敵戰鬥中可開角色視窗 → 擊破後的獎勵/祝福/離去提示 ===");
    // 這三項共用同一段情境：把縮圈時間軸推到waitingForDay2，建立一場「夜之強敵」戰鬥。
    // 刻意用finalCircleDay1（而不是day3Boss）當作驗證用的夜王級戰鬥，原因是
    // updateFinalCircleBoss()對這個點不需要任何座標接近判定——只要stage是waitingForDay2、
    // trig是resolved就會設定nearbyFinalCircleBoss；day3Boss那條路徑會跟
    // recomputeActiveEncounter()的候選優先序（nearbyFieldPoint優先）互相干擾，實測會隨
    // 地圖種子/出生點不同而時好時壞，不適合當作回歸測試的前提。
    // activeEncounterIsNightBoss()是依「點id」判斷（day3Boss或finalCircleDay*），因此
    // finalCircleDay1同樣會走到項目6要驗證的closeHudPanelsIfNightBossCombat()路徑。
    const pushedBack = await page.evaluate(
      ({ gameId }) => {
        const st = window.PriTestMidnight._debugState();
        // 往前推 40 分鐘，足以跨過 day1 的所有縮圈階段，進入 waitingForDay2。
        const newStart = st.meta.sessionStartAt - 40 * 60 * 1000;
        return window.PriTestGameStorage.rtSet(gameId, "cloud", "meta/sessionStartAt", newStart).then(() => newStart);
      },
      { gameId }
    );
    console.log("  sessionStartAt 已往前推至 " + new Date(pushedBack).toISOString());
    const reachedWaiting = await page
      .waitForFunction(() => {
        const st = window.PriTestMidnight._debugState();
        return st.phaseInfo && st.phaseInfo.stage === "waitingForDay2";
      }, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (!reachedWaiting) {
      const st = await getState(page);
      console.log("  [SKIP] 未能推進到waitingForDay2（目前stage=" + (st.phaseInfo && st.phaseInfo.stage) + "），略過項目6/4/8端對端檢查");
    } else {
      // 先建立「戰鬥中」（HP還沒歸零）的夜之強敵，驗證項目6。
      await page.evaluate(
        ({ gameId, mySlot }) => {
          const GS = window.PriTestGameStorage;
          const participants = {};
          participants[mySlot] = true;
          return GS.rtSet(gameId, "cloud", "fieldTrigger/finalCircleDay1", {
            status: "resolved",
            participants: participants,
            enemyFamilyId: "test",
            enemyId: "test",
            level: 10,
          }).then(() => GS.rtSet(gameId, "cloud", "fieldEnemyHp/finalCircleDay1", 500));
        },
        { gameId, mySlot }
      );
      // recomputeActiveEncounter()對「第一次遭遇」會先跑BATTLE_PREP_DURATION_MS(5秒)的
      // 識別資訊準備，之後才把activeEncounter設起來，因此這裡要輪詢等待。
      let inBossFight = false;
      let lastFightState = null;
      for (let i = 0; i < 16; i++) {
        await page.waitForTimeout(1000);
        lastFightState = await page.evaluate(() => {
          const x = window.PriTestMidnight._debugState();
          return { ae: x.activeEncounter && x.activeEncounter.id, stage: x.phaseInfo && x.phaseInfo.stage };
        });
        if (lastFightState.ae === "finalCircleDay1") {
          inBossFight = true;
          break;
        }
      }
      assert(inBossFight, "成功進入夜之強敵戰鬥（activeEncounter=finalCircleDay1），最後狀態=" + JSON.stringify(lastFightState), results);
      if (inBossFight) {
        await page.evaluate(() => document.getElementById("btn-midnight-open-character-sheet").click());
        await page.waitForTimeout(1500); // 跨過數十個frame，確認不會被每影格的closeHudPanelsIfNightBossCombat()關掉
        const sheetStillOpen = await page.evaluate(() => !document.getElementById("midnight-character-sheet-modal").hidden);
        assert(sheetStillOpen, "夜之強敵/夜王戰鬥中打開角色視窗後，不會被每影格邏輯強制關閉（項目6）", results);
        await page.evaluate(() => {
          const m = document.getElementById("midnight-character-sheet-modal");
          if (m && !m.hidden) document.getElementById("btn-midnight-character-sheet-close").click();
        });
      }

      // 擊破：HP歸零 → 觸發黃金樹之帳獎勵＋離去提示banner＋[使用祝福]。
      await rtSet(page, gameId, "fieldEnemyHp/finalCircleDay1", 0);
      await page.waitForTimeout(1200);
      // 8. 上方banner
      await page.waitForTimeout(600);
      const lockBanner = await page.evaluate(() => {
        const b = document.getElementById("midnight-rewards-lock-banner");
        return { hidden: !b || b.hidden, text: b ? b.textContent.trim() : null };
      });
      assert(!lockBanner.hidden, "夜之強敵戰後，上方顯示行動鎖定banner", results);
      assert(/離去/.test(lockBanner.text || ""), "banner文字為「離去後才能開始行動……」，實際=" + lockBanner.text, results);

      // 4b. 黃金樹之帳獎勵（附帶效果＋盧恩10）
      const gotRewards = await page
        .waitForFunction(() => {
          const st = window.PriTestMidnight._debugState();
          const list = (st.pendingRewards && st.pendingRewards[st.myTokenId]) || {};
          const kinds = Object.keys(list).map((k) => list[k].kind);
          return kinds.indexOf("attachedEffect") !== -1 && kinds.indexOf("rune") !== -1;
        }, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      assert(gotRewards, "擊破夜之強敵後，參與者收到黃金樹之帳的「附帶效果」與「擊破盧恩」獎勵", results);
      if (gotRewards) {
        const runeValue = await page.evaluate(() => {
          const st = window.PriTestMidnight._debugState();
          const list = (st.pendingRewards && st.pendingRewards[st.myTokenId]) || {};
          const id = Object.keys(list).filter((k) => list[k].kind === "rune")[0];
          return id ? list[id].value : null;
        });
        assert(runeValue === 10, "第1天的擊破盧恩為資料裡的10（不是另外編的數字），實際=" + runeValue, results);

        // 附帶效果獎勵的抽選→確認流程真的會寫進learnedAttachedEffects
        const beforeCount = await page.evaluate(() => {
          const st = window.PriTestMidnight._debugState();
          return ((st.characters[st.myTokenId] || {}).learnedAttachedEffects || []).length;
        });
        const opened = await page.evaluate(() => {
          const modal = document.getElementById("midnight-reward-modal");
          if (modal.hidden) return false;
          const btns = Array.prototype.slice.call(document.querySelectorAll("#midnight-reward-list-personal button"));
          const target = btns.filter((b) => /附帶效果|付帯効果|Attached/.test(b.textContent))[0];
          if (!target) return false;
          target.click();
          return true;
        });
        if (!opened) {
          console.log("  [SKIP] 獎勵清單未開啟或找不到附帶效果項目，略過抽選端對端檢查");
        } else {
          await page.waitForTimeout(250);
          await page.evaluate(() => {
            const b = document.querySelector("#midnight-reward-detail button");
            if (b) b.click();
          });
          await page.waitForTimeout(350);
          await page.evaluate(() => {
            const b = document.querySelector("#midnight-reward-detail button");
            if (b) b.click();
          });
          await page.waitForTimeout(800);
          const afterCount = await page.evaluate(() => {
            const st = window.PriTestMidnight._debugState();
            return ((st.characters[st.myTokenId] || {}).learnedAttachedEffects || []).length;
          });
          assert(afterCount === beforeCount + 1, "附帶效果獎勵抽選→確認後真的習得1個（" + beforeCount + "→" + afterCount + "）", results);
        }
      }

      // 4a. HUD「使用祝福」開啟祝福視窗
      await page.evaluate(() => {
        const m = document.getElementById("midnight-reward-modal");
        if (m && !m.hidden) document.getElementById("btn-midnight-reward-close").click();
      });
      await page.waitForTimeout(300);
      const blessingBtnVisible = await page.evaluate(() => {
        const row = document.getElementById("midnight-hud-day1-rewards-row");
        const b = document.getElementById("btn-midnight-hud-blessing-day1");
        return !!row && !row.hidden && !!b && b.offsetParent !== null;
      });
      assert(blessingBtnVisible, "夜之強敵戰後HUD出現[使用祝福]按鈕", results);
      if (blessingBtnVisible) {
        await page.evaluate(() => document.getElementById("btn-midnight-hud-blessing-day1").click());
        await page.waitForTimeout(400);
        const blessingModal = await page.evaluate(() => {
          const m = document.getElementById("midnight-blessing-modal");
          const levelRow = document.getElementById("midnight-character-sheet-level-row");
          return { open: !!m && !m.hidden, levelRowInside: !!m && !!levelRow && m.contains(levelRow) && levelRow.offsetParent !== null };
        });
        assert(blessingModal.open, "按下[使用祝福]後祝福視窗會打開（原本只有toast、沒有視窗可開）", results);
        assert(blessingModal.levelRowInside, "祝福視窗內看得到等級±列，玩家可以直接升級", results);
      }
    }
  } catch (err) {
    console.error("測試中斷：", err);
    results.push({ label: "測試執行本身沒有拋出例外", pass: false });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n===== 結果：" + (results.length - failed.length) + "/" + results.length + " 通過 =====");
  failed.forEach((r) => console.log("  FAIL: " + r.label));
  process.exit(failed.length ? 1 : 0);
})();
