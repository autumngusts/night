// ============================================================================
// 遺物記憶 完整流程 E2E（Firebase Local Emulator，不連正式專案）。2026-09-25 新增。
// 使用者要求驗證的流程：
//   1. 遊戲結束時依遊戲內容派發遺物記憶（大小、效果都已抽選好）。
//   2. 結算視窗查看內容 → 輸入序號存入 → 存入後清單消失（避免重複存入；reload、換序號都不能再存）。
//   3. 另開一場遊戲，等待房輸入序號 → 看得到上次存入的記憶 → 選最多 3 個帶入 → 效果實際生效。
// 前置：同 relic_memory_emulator_check.js（generate.py、http.server 8791、firebase emulators）。
// 執行：PRITEST_EMU_PORT=9010 node tools/midnight_check/relic_memory_full_flow_check.js
// ============================================================================
const { chromium } = require("playwright");
const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const EMU_PORT = process.env.PRITEST_EMU_PORT || "9000";
const EMU = "http://127.0.0.1:" + EMU_PORT;
const NS = "elden-ring-nightreign-default-rtdb";
const CODE = "FLOW1";
const CODE2 = "FLOW2";
const WAIT = 15000;

let fails = 0;
const assert = (c, l) => {
  console.log((c ? "  [PASS] " : "  [FAIL] ") + l);
  if (!c) fails++;
};

async function adminPut(pathStr, value) {
  const res = await fetch(`${EMU}/${pathStr}.json?ns=${NS}`, {
    method: "PUT",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error("adminPut failed " + res.status);
}

async function adminGet(pathStr) {
  const res = await fetch(`${EMU}/${pathStr}.json?ns=${NS}`, { headers: { Authorization: "Bearer owner" } });
  return res.json();
}

async function pushRules() {
  const fs = require("fs");
  const path = require("path");
  const rules = fs.readFileSync(path.join(__dirname, "..", "..", "database.rules.json"), "utf8");
  const res = await fetch(`${EMU}/.settings/rules.json?ns=${NS}`, {
    method: "PUT",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: rules,
  });
  if (!res.ok) throw new Error("pushRules failed " + res.status);
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.addInitScript((port) => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
      window.sessionStorage.setItem("pritestRtdbEmulatorPort", port);
    } catch (e) {}
  }, EMU_PORT);
  return page;
}

// 等待房按鈕用 page.click()（理由見 relic_memory_emulator_check.js 的 joinLobby() 註解）。
async function joinLobby(page, passcode) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", passcode);
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: WAIT });
}

async function createAndStart(pageA, pageB, beforeReady) {
  await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
  await pageA.click("#btn-midnight-create");
  await pageA.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: WAIT });
  const url = pageA.url();
  await pageB.goto(url, { waitUntil: "networkidle" });
  await pageB.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: WAIT });
  await joinLobby(pageA, "1234");
  await joinLobby(pageB, "5678");
  if (beforeReady) await beforeReady();
  await pageA.click("#btn-midnight-lobby-ready");
  await pageB.click("#btn-midnight-lobby-ready");
  for (const p of [pageA, pageB]) {
    await p.waitForFunction(() => {
      const d = window.PriTestMidnight._debugState();
      return d.meta.sessionStartAt && d.characters && d.characters[d.myTokenId];
    }, { timeout: 25000 });
  }
  return url;
}

const SIZE_N = { s: 1, m: 2, l: 3 };

async function game1(browser) {
  console.log("=== 第 1 場：依遊戲內容派發 → 結算存入 → 消失 ===");
  const pageA = await newPage(browser);
  const pageB = await newPage(browser);
  const url = await createAndStart(pageA, pageB);
  const gid = await pageA.evaluate(() => window.PriTestMidnight._debugState().gameId);

  // 用真實判定來源墊出遊戲內容：踏破 3 個板塊、第一／二天夜之強敵、夜王（同 emulator_check 的 restartSection）。
  await pageA.evaluate((g) => {
    const GS = window.PriTestGameStorage;
    const d = window.PriTestMidnight._debugState();
    const NON = { sorcerer: 1, merchant: 1, strong_enemy: 1, random_event: 1, blessing: 1 };
    d.map.points
      .filter((p) => !NON[p.type])
      .slice(0, 3)
      .forEach((p) => GS.rtSet(g, "cloud", "fieldProgress/" + p.id, { branchIndex: 0, floorIndex: 0, cleared: true }));
    ["finalCircleDay1", "finalCircleDay2", "day3Boss"].forEach((id) => {
      GS.rtSet(g, "cloud", "fieldTrigger/" + id, { status: "resolved", participants: {} });
      GS.rtSet(g, "cloud", "fieldEnemyHp/" + id, 0);
    });
  }, gid);
  for (const p of [pageA, pageB]) {
    await p.waitForFunction(() => {
      const r = window.PriTestMidnight._debugRelicMemory();
      return ["tiles1", "day1", "day2", "boss"].every((k) => r.seen[k]);
    }, { timeout: WAIT });
  }
  const got = await pageA.evaluate(() => {
    const MN = window.PriTestMidnight;
    const CAT = window.PriTestMidnightRelicMemoryCatalog;
    const CD = window.PriTestCharacterDrawer;
    const wired = {};
    MN._debugRelicMemoryWiredIds().forEach((id) => (wired[id] = true));
    const drawable = {};
    CAT.drawableEffectIds().forEach((id) => (drawable[id] = true));
    const r = MN._debugRelicMemory();
    return {
      earned: r.earned,
      bad: r.earned.flatMap((m) => (m.effects || []).map((e) => e.id).filter((id) => !drawable[id] || !wired[id] || CD.attachedEffectById(id))),
      groupDup: r.earned.filter((m) => {
        const seen = {};
        return (m.effects || []).some((e) => {
          const g = CAT.exclusiveGroup(e.id);
          if (!g) return false;
          if (seen[g]) return true;
          seen[g] = true;
          return false;
        });
      }).length,
    };
  });
  const bySource = {};
  got.earned.forEach((m) => (bySource[m.source] = (bySource[m.source] || []).concat(m.size)));
  console.log("    本局獲得：" + JSON.stringify(bySource));
  assert(JSON.stringify(bySource.start) === '["s"]', "開局 小×1");
  assert(bySource.tiles && bySource.tiles.length === 1 && /^[sm]$/.test(bySource.tiles[0]), "踏破 3 板塊 → 1 個（小／中）");
  assert(bySource.day1 && bySource.day1.length === 1 && /^[ml]$/.test(bySource.day1[0]), "第一天夜之強敵 → 1 個（中／大）");
  assert(bySource.day2 && bySource.day2.length === 2 && bySource.day2[0] === "m" && /^[ml]$/.test(bySource.day2[1]), "第二天夜之強敵 → 中＋（中／大）");
  assert(bySource.boss && (bySource.boss.length === 1 || bySource.boss.length === 2) && bySource.boss.every((s) => s === "l"), "夜王 → 大×1（50% 再大×1）");
  assert(
    got.earned.every((m) => (m.effects || []).length === SIZE_N[m.size] && /^m[0-9a-f]{16}$/.test(m.memId)),
    "每顆記憶的效果條數＝大小（小1／中2／大3），memId 格式正確"
  );
  assert(got.bad.length === 0, "抽到的效果全部是遺物記憶目錄中已接入的效果、不含 24 種附帶效果（問題：" + got.bad.join(",") + "）");
  assert(got.groupDup === 0, "同一顆記憶內，出撃時の武器／結晶雫各最多一條");

  // 勝利彈窗 → 結算
  await pageA.waitForSelector("#midnight-game-victory-modal:not([hidden])", { timeout: WAIT });
  await pageA.dispatchEvent("#btn-midnight-game-victory-confirm", "click");
  await pageA.waitForSelector("#midnight-relic-memory-settle-modal:not([hidden])", { timeout: WAIT });
  const rows = await pageA.$$eval("#midnight-relic-memory-settle-list li", (els) => els.map((e) => e.textContent));
  console.log("    結算清單：\n      " + rows.join("\n      "));
  assert(rows.length === got.earned.length, "結算視窗列出全部 " + got.earned.length + " 個（大小＋效果）");

  await pageA.fill("#midnight-relic-memory-settle-code-input", CODE);
  await pageA.dispatchEvent("#btn-midnight-relic-memory-settle-save", "click");
  await pageA.waitForFunction(() => document.getElementById("midnight-relic-memory-settle-list").children.length === 0, { timeout: WAIT });
  assert(true, "存入後清單消失");
  assert(await pageA.evaluate(() => document.getElementById("btn-midnight-relic-memory-settle-save").disabled), "存入後保存按鈕停用");
  const stored = await adminGet("relicMemories/" + CODE);
  const storedIds = Object.keys(stored || {});
  assert(
    storedIds.length === got.earned.length && got.earned.every((m) => stored[m.memId] && stored[m.memId].size === m.size),
    "Firebase 存入件數＝本局獲得件數，內容一致（" + storedIds.length + "）"
  );

  // reload：新分頁會換 tokenId、先變觀戰者，用席位密碼「接管」回原席位（既有設計，角色整份
  // 含 relicMemory.savedIds 會搬到新 token）。勝利彈窗再次出現，確認後結算不能再存（換序號也不行）。
  const slotA = await pageA.evaluate(() => window.PriTestMidnight._debugState().mySlot);
  await pageA.goto(url, { waitUntil: "networkidle" });
  await pageA.waitForFunction((s) => { const d = window.PriTestMidnight._debugState(); return d.players && d.players[s]; }, slotA, { timeout: WAIT });
  await pageA.evaluate((s) => window.PriTestMidnight._debugTakeover(s), slotA);
  await pageA.waitForFunction(() => { const d = window.PriTestMidnight._debugState(); return d.mySlot && d.characters[d.myTokenId]; }, { timeout: WAIT });
  await pageA.waitForSelector("#midnight-game-victory-modal:not([hidden])", { timeout: 25000 });
  await pageA.dispatchEvent("#btn-midnight-game-victory-confirm", "click");
  await pageA.waitForSelector("#midnight-relic-memory-settle-modal:not([hidden])", { timeout: WAIT });
  await pageA.waitForTimeout(1500);
  const after = await pageA.evaluate(() => ({
    rows: document.getElementById("midnight-relic-memory-settle-list").children.length,
    disabled: document.getElementById("btn-midnight-relic-memory-settle-save").disabled,
    status: document.getElementById("midnight-relic-memory-settle-status").textContent,
    expect: window.I18N.t("midnight_relic_memory_already_saved"),
  }));
  assert(after.rows === 0 && after.disabled && after.status === after.expect, "reload 後結算清單為空、按鈕停用、顯示「已經全部保存過了」");
  await pageA.fill("#midnight-relic-memory-settle-code-input", CODE2);
  await pageA.dispatchEvent("#btn-midnight-relic-memory-settle-save", "click");
  await pageA.waitForTimeout(1500);
  assert((await adminGet("relicMemories/" + CODE2)) === null, "換另一組序號也存不進去（沒有重複存入）");

  await pageA.close();
  await pageB.close();
  return { storedIds, stored };
}

async function game2(browser, prev) {
  console.log("=== 第 2 場：輸入序號 → 看到上次的記憶 → 帶入 3 個 → 效果生效 ===");
  // 另外加一顆數值已知的記憶，用來確認「帶入後效果真的改變計算」（HP 上限 +20、物理攻擊 +5%）。
  const KNOWN = "m00000000000000f1";
  await adminPut("relicMemories/" + CODE + "/" + KNOWN, {
    memId: KNOWN,
    size: "m",
    effects: [{ id: "rm_max_hp_up", value: 20 }, { id: "rm_physical_atk_up", value: 5 }],
    createdAt: Date.now(),
    favorite: false,
    source: "tiles",
  });
  const total = prev.storedIds.length + 1;
  const pick = [KNOWN, prev.storedIds[0], prev.storedIds[1]];
  const extra = prev.storedIds[2];
  const pageA = await newPage(browser);
  const pageB = await newPage(browser);
  await createAndStart(pageA, pageB, async () => {
    await pageA.fill("#midnight-lobby-relic-memory-code-input", CODE.toLowerCase());
    await pageA.click("#btn-midnight-lobby-relic-memory-load");
    await pageA.waitForSelector("#midnight-lobby-relic-memory-list input[type=checkbox]", { timeout: WAIT });
    const ids = await pageA.$$eval("#midnight-lobby-relic-memory-list input[type=checkbox]", (els) => els.map((e) => e.getAttribute("data-mem-id")));
    assert(ids.length === total && prev.storedIds.every((id) => ids.indexOf(id) !== -1), "等待房讀取序號 → 列出上次存入的全部記憶（" + ids.length + "）");
    for (let i = 0; i < pick.length; i++) {
      await pageA.click('#midnight-lobby-relic-memory-list input[data-mem-id="' + pick[i] + '"]');
      await pageA.waitForFunction(
        (n) => {
          const d = window.PriTestMidnight._debugState();
          const p = d.players[d.mySlot];
          return p && p.relicMemoryLoadout && p.relicMemoryLoadout.length === n;
        },
        i + 1,
        { timeout: WAIT }
      );
    }
    // 第 4 個不能再選
    await pageA.evaluate((id) => document.querySelector('#midnight-lobby-relic-memory-list input[data-mem-id="' + id + '"]').click(), extra);
    await pageA.waitForTimeout(1500);
    const n = await pageA.evaluate(() => {
      const d = window.PriTestMidnight._debugState();
      return d.players[d.mySlot].relicMemoryLoadout.length;
    });
    assert(n === 3, "最多只能選 3 個（第 4 個選不進去，實得 " + n + "）");
  });
  await pageA.waitForTimeout(1500);
  const r = await pageA.evaluate(() => {
    const MN = window.PriTestMidnight;
    const d = MN._debugState();
    const c = d.characters[d.myTokenId];
    const loadout = MN._debugRelicMemory().loadout;
    const known = loadout.filter((m) => m.memId === "m00000000000000f1");
    const others = loadout.filter((m) => m.memId !== "m00000000000000f1");
    const wired = {};
    MN._debugRelicMemoryWiredIds().forEach((id) => (wired[id] = true));
    return {
      memIds: loadout.map((m) => m.memId),
      unwired: loadout.flatMap((m) => (m.effects || []).map((e) => e.id || e)).filter((id) => !wired[id]),
      // 真實計算點：HP 上限（selfArenaHpMax）與物理攻擊倍率（affixOutgoingDamageMult），只帶已知那顆 vs 不帶。
      hpWith: MN._debugRelicMemoryStats(known).hpMax,
      hpWithout: MN._debugRelicMemoryStats([]).hpMax,
      physMult: MN._debugRelicMemoryOutgoingMult(known, {}),
      physBase: MN._debugRelicMemoryOutgoingMult([], {}),
      othersCount: others.length,
    };
  });
  assert(r.memIds.length === 3 && pick.every((id) => r.memIds.indexOf(id) !== -1), "開局後角色帶入的正是選的 3 個");
  assert(r.unwired.length === 0, "帶入的所有效果都有接入點（未接：" + r.unwired.join(",") + "）");
  assert(r.hpWith - r.hpWithout === 20, "已知記憶「最大HP上昇 20」→ HP 上限 +20（實得 " + (r.hpWith - r.hpWithout) + "）");
  assert(Math.abs(r.physMult / r.physBase - 1.05) < 1e-9, "已知記憶「物理攻撃力上昇 5%」→ 物理攻擊倍率 ×1.05（實得 " + r.physMult / r.physBase + "）");

  await pageA.dispatchEvent("#btn-midnight-open-character-sheet", "click");
  await pageA.waitForSelector("#midnight-character-sheet-relic-memories button", { timeout: WAIT });
  const slots = await pageA.$$("#midnight-character-sheet-relic-memories button");
  assert(slots.length === 3, "角色視窗顯示 3 格遺物記憶");
  await pageA.close();
  await pageB.close();
}

(async () => {
  await pushRules();
  await adminPut("relicMemoryCodes", { TST01: true, [CODE]: true, [CODE2]: true });
  await adminPut("relicMemories/" + CODE, null);
  await adminPut("relicMemories/" + CODE2, null);
  const browser = await chromium.launch();
  try {
    const prev = await game1(browser);
    await game2(browser, prev);
  } catch (e) {
    console.error(e);
    fails++;
  } finally {
    await browser.close();
  }
  console.log(fails ? fails + " FAIL" : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
