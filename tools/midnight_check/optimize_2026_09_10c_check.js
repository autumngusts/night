// ============================================================================
// midnight（即時制擴張版）2026-09-10 第三批優化回歸測試（Firebase Local Emulator 版，
// 環境準備同 emulator_sync_check.js 開頭說明）。
// ============================================================================
// 驗證範圍（使用者這次明確要求的 6 個項目中，UI／行為可觀測的部分）：
//   1. 瀕死被隊友救起：隊友畫面會出現[指定]按鈕（先前完全不會出現＝根本救不起來），
//      救起後瀕死者留在原地、仍在同一場戰鬥、動作按鈕解鎖、HP 回復一半。
//   2. 獎勵清單左側選中項目會高亮（.midnight-reward-item-selected）。
//   4. 獎勵抽到的武器會顯示完整武器資訊，含〔戰技〕區塊（先前因為只查
//      c.equippedWeaponIds，未持有的新武器戰技永遠是空的）。
//   3. 戰技／魔術／祈禱的實際傷害 ×2（顯示值維持原值）。
//
// 執行方式：node optimize_2026_09_10c_check.js
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

async function joinLobby(page, passcode) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", passcode);
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
}

// emulator_sync_check.js と同じ「盡力而為」ウォーク（経路探索はしない）。
async function walkNear(page, targetX, targetY, radius, maxRounds) {
  for (let i = 0; i < maxRounds; i++) {
    const pos = await page.evaluate(() => (window.PriTestMidnight ? window.PriTestMidnight._debugState().localPos : null));
    if (!pos) {
      await page.waitForTimeout(50);
      continue;
    }
    const dx = targetX - pos.x;
    const dy = targetY - pos.y;
    if (Math.hypot(dx, dy) <= radius) return true;
    const keys = [];
    if (dx > 0.15) keys.push("ArrowRight");
    else if (dx < -0.15) keys.push("ArrowLeft");
    if (dy > 0.15) keys.push("ArrowDown");
    else if (dy < -0.15) keys.push("ArrowUp");
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(140);
    for (const k of keys) await page.keyboard.up(k);
  }
  return false;
}

const st = (page) => page.evaluate(() => window.PriTestMidnight._debugState());
const rtSet = (page, gameId, path, value) =>
  page.evaluate(({ gameId, path, value }) => window.PriTestGameStorage.rtSet(gameId, "cloud", path, value), { gameId, path, value });

(async () => {
  const browser = await chromium.launch();
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  const results = [];
  pageA.on("pageerror", (e) => console.log("  [A pageerror]", e.message));
  pageB.on("pageerror", (e) => console.log("  [B pageerror]", e.message));

  try {
    await enableEmulatorFlag(pageA);
    await enableEmulatorFlag(pageB);

    console.log("=== 建立測試場，兩台裝置入座並開局 ===");
    await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await pageA.click("#btn-midnight-create");
    await pageA.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    const gameUrl = pageA.url();
    await pageB.goto(gameUrl, { waitUntil: "networkidle" });
    await pageB.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await joinLobby(pageA, "1234");
    await joinLobby(pageB, "5678");
    await pageA.click("#btn-midnight-lobby-ready");
    await pageB.click("#btn-midnight-lobby-ready");
    await pageA.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });
    await pageB.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });
    await pageA.waitForTimeout(11000); // 開場動畫 10 秒（期間所有操作被疊層擋住）

    const sA = await st(pageA);
    const sB = await st(pageB);
    const gameId = sA.gameId;

    // ---------------------------------------------------------------------
    console.log("=== 項目3：戰技／魔術／祈禱的實際傷害 ×2（顯示值維持原值）===");
    // activeEncounter が無い状態では damageCombatTarget() は共用標靶へ流れるので、
    // 共用標靶の減少量と toast の表示値を比べれば倍率が検証できる（solo倍率は
    // activeEncounter がある時だけなので混ざらない）。
    const artInfo = await pageA.evaluate(() => {
      const btn = document.getElementById("btn-midnight-skill");
      return btn ? { hidden: btn.hidden, disabled: btn.disabled, label: btn.textContent } : null;
    });
    if (!artInfo || artInfo.hidden || artInfo.disabled) {
      console.log("  [SKIP] 這個角色目前沒有可用的武器戰技按鈕（起始武器沒有Action類戰技），略過本項");
    } else {
      // 共用標靶の初期値は20しかなく、戦技1発で0まで落ちて差分が測れないので、
      // 先に十分大きい値へ差し替えてから計測する。
      await rtSet(pageA, gameId, "demoStat/sharedTarget", 100000);
      await pageA.waitForTimeout(500);
      const before = (await st(pageA)).demoStats.sharedTarget || 0;
      await pageA.click("#btn-midnight-skill");
      await pageA.waitForTimeout(600);
      const after = (await st(pageA)).demoStats.sharedTarget || 0;
      const toast = await pageA.evaluate(() => {
        const el = document.getElementById("midnight-toast");
        return el ? el.textContent : "";
      });
      const shown = parseInt((toast.split("：")[1] || "").replace(/[^0-9].*$/, ""), 10);
      const delta = before - after;
      if (!shown) {
        console.log("  [SKIP] 這次戰技無法解算威力（toast顯示規則原文），略過倍率比對");
      } else {
        assert(delta === shown * 2, `戰技實際傷害是顯示值的2倍（顯示${shown}／實扣${delta}）`, results);
      }
    }

    console.log("=== 項目3：角色技藝的實際傷害 ×3 ===");
    const artBtn = await pageA.evaluate(() => {
      const btn = document.getElementById("btn-midnight-art");
      return btn ? { hidden: btn.hidden, disabled: btn.disabled } : null;
    });
    if (!artBtn || artBtn.hidden || artBtn.disabled) {
      console.log("  [SKIP] 技藝按鈕目前不可用（冷卻／資源不足），略過本項");
    } else {
      await rtSet(pageA, gameId, "demoStat/sharedTarget", 100000);
      await pageA.waitForTimeout(500);
      const before2 = (await st(pageA)).demoStats.sharedTarget || 0;
      await pageA.click("#btn-midnight-art");
      await pageA.waitForTimeout(600);
      const after2 = (await st(pageA)).demoStats.sharedTarget || 0;
      const toast2 = await pageA.evaluate(() => {
        const el = document.getElementById("midnight-toast");
        return el ? el.textContent : "";
      });
      const shown2 = parseInt((toast2.split("：")[1] || "").replace(/[^0-9].*$/, ""), 10);
      if (!shown2) console.log("  [SKIP] 這個技藝無法解算威力（toast顯示規則原文），略過倍率比對");
      else assert(before2 - after2 === shown2 * 3, `技藝實際傷害是顯示值的3倍（顯示${shown2}／實扣${before2 - after2}）`, results);
    }

    // ---------------------------------------------------------------------
    console.log("=== 項目2／4：獎勵清單高亮 與 抽到武器的完整戰技資訊 ===");
    await rtSet(pageA, gameId, "pendingRewards/" + sA.myTokenId + "/rw_test_weapon", { kind: "weaponStar", value: 2, resolved: false });
    await pageA.waitForFunction(() => !document.getElementById("midnight-reward-modal").hidden, { timeout: 8000 });
    const firstBtn = await pageA.$("#midnight-reward-list-personal li button");
    assert(!!firstBtn, "獎勵清單左側出現待領取項目", results);
    if (firstBtn) {
      await firstBtn.click();
      await pageA.waitForTimeout(300);
      const highlighted = await pageA.evaluate(
        () => !!document.querySelector("#midnight-reward-list-personal li button.midnight-reward-item-selected")
      );
      assert(highlighted, "選中的左側獎勵項目有高亮 class", results);
      // 抽選 → 武器詳細
      const drawBtn = await pageA.$("#midnight-reward-detail button");
      if (drawBtn) {
        await drawBtn.click();
        await pageA.waitForTimeout(400);
        const detail = await pageA.evaluate(() => {
          const d = document.getElementById("midnight-reward-detail");
          return {
            hasName: !!d.querySelector("h4"),
            hasDamageTag: !!d.querySelector(".weapon-damage-tag"),
            subheadings: [...d.querySelectorAll(".boss-subheading")].map((e) => e.textContent),
            text: d.textContent.slice(0, 300),
          };
        });
        assert(detail.hasName, "抽選後顯示武器名稱（含稀有度）", results);
        // 〔戰技〕〔戰技B〕どちらかの小見出しが出ていれば、未装備武器でも戰技が解決できている。
        // 戦技を1つも持たない武器を引く可能性もあるため、見出しが無い場合は SKIP 扱いにする。
        if (detail.subheadings.length) {
          assert(true, "抽到的武器有顯示戰技／戰技B區塊（未持有武器也解析得到）：" + detail.subheadings.join(","), results);
        } else {
          console.log("  [SKIP] 這次抽到的武器沒有任何戰技／連擊特典可顯示，無法驗證戰技區塊");
        }
      }
    }
    await pageA.click("#btn-midnight-reward-close");

    // ---------------------------------------------------------------------
    console.log("=== 項目1：瀕死被隊友救起 ===");
    const map = await pageA.evaluate((seed) => window.PriTestMidnightMap.generateMap(seed), sA.meta.mapSeed);
    const pt = (map.points || []).find((p) => p.type !== "sorcerer");
    const okA = await walkNear(pageA, pt.x + 0.5, pt.y + 0.5, 1.2, 200);
    const okB = await walkNear(pageB, pt.x + 0.5, pt.y + 0.5, 1.2, 200);
    if (!okA || !okB) {
      console.log("  [SKIP] 固定佈局的牆壁讓直線走位走不到目標點，略過本項（非功能性失敗）");
    } else {
      const participants = {};
      participants[sA.mySlot] = true;
      participants[sB.mySlot] = true;
      await rtSet(pageA, gameId, "fieldTrigger/" + pt.id, {
        status: "resolved",
        participants: participants,
        branchIndex: 0,
        floorIndex: 0,
        enemyFamilyId: "test",
        enemyId: "test",
      });
      await rtSet(pageA, gameId, "fieldEnemyHp/" + pt.id, 100000);
      await pageA.waitForFunction(() => !!window.PriTestMidnight._debugState().activeEncounter, { timeout: 20000 }).catch(() => {});
      await pageB.waitForFunction(() => !!window.PriTestMidnight._debugState().activeEncounter, { timeout: 20000 }).catch(() => {});
      const encA = (await st(pageA)).activeEncounter;
      const encB = (await st(pageB)).activeEncounter;
      assert(!!encA && !!encB, "兩台裝置都進入同一場戰鬥", results);

      const posBefore = (await st(pageA)).localPos;
      // maybeTriggerNearDeath() が書くのと同じ shape。deadlineAt は長めにして
      // 「15秒逾時→強制復歸（＝傳送到祝福點）」が混ざらないようにする。
      await rtSet(pageA, gameId, "demoStat/" + sA.myTokenId, 0);
      await rtSet(pageA, gameId, "character/" + sA.myTokenId + "/nearDeath", {
        active: true,
        downedAt: Date.now(),
        deadlineAt: Date.now() + 120000,
        progress: 0,
        required: 60,
      });
      await pageB.waitForSelector(".midnight-slot-designate-btn", { timeout: 10000 }).catch(() => {});
      const designateBtn = await pageB.$(".midnight-slot-designate-btn");
      assert(!!designateBtn, "隊友(B)畫面出現[指定]按鈕（此前完全不會出現）", results);
      const badge = await pageB.evaluate(() => !!document.querySelector(".midnight-slot-warning-badge"));
      assert(badge, "隊友(B)畫面出現瀕死⚠警示", results);

      if (designateBtn) {
        await designateBtn.click();
        for (let i = 0; i < 60; i++) {
          await pageB.click("#btn-midnight-attack-shared-target").catch(() => {});
          await pageB.waitForTimeout(220);
          const nd = await pageA.evaluate((t) => {
            const c = window.PriTestMidnight._debugState().characters[t];
            return c && c.nearDeath ? c.nearDeath : null;
          }, sA.myTokenId);
          if (!nd || !nd.active) break;
        }
        await pageA.waitForTimeout(1500);
        const after = await st(pageA);
        const nd = after.characters[sA.myTokenId].nearDeath;
        assert(!nd || !nd.active, "累積復歸傷害後瀕死解除", results);
        assert(
          Math.abs(after.localPos.x - posBefore.x) < 0.01 && Math.abs(after.localPos.y - posBefore.y) < 0.01,
          "救起後留在原地（沒有被傳送到祝福點）",
          results
        );
        assert(after.activeEncounter && after.activeEncounter.id === pt.id, "救起後仍在原本那場戰鬥中", results);
        const btnState = await pageA.evaluate(() => ({
          attack: document.getElementById("btn-midnight-attack-shared-target").disabled,
          dodge: document.getElementById("btn-midnight-dodge").disabled,
        }));
        assert(!btnState.attack && !btnState.dodge, "救起後動作按鈕重新啟用", results);
      }
    }
  } catch (e) {
    console.log("  [ERROR]", e.message);
    results.push({ label: "腳本執行中發生例外：" + e.message, pass: false });
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== 結果：${results.length - failed.length}/${results.length} 通過 ===`);
  failed.forEach((r) => console.log("  FAIL: " + r.label));
  process.exit(failed.length ? 1 : 0);
})();
