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
const SEED_FIXED = "m00000000000000a1";
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

  // 2026-09-25 固定配置遺物：劇本定為「三つ首の獣」→ 擊敗夜王時另外得「獣の夜」。
  // DB 裡先放一件同樣的「獣の夜」（不同 memId），驗證「有相同物品則不儲存兩件」。
  await adminPut("relicMemories/" + CODE + "/" + SEED_FIXED, {
    memId: SEED_FIXED,
    size: "m",
    fixedId: "relic_beast_night",
    effects: [{ id: "rm_hit_stamina_regen", value: 2 }, { id: "rm_infuse_fire" }],
    createdAt: 1,
    favorite: true,
    source: "fixed",
  });
  // 用真實判定來源墊出遊戲內容：踏破 3 個板塊、第一／二天夜之強敵、夜王（同 emulator_check 的 restartSection）。
  await pageA.evaluate((g) => {
    const GS = window.PriTestGameStorage;
    const d = window.PriTestMidnight._debugState();
    GS.rtSet(g, "cloud", "meta/resolvedNightBossId", "tricephalos");
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
      return ["tiles1", "day1", "day2", "boss", "fixed"].every((k) => r.seen[k]);
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
      // 固定配置遺物的效果是指定的（含 relicOnly、不在抽選池），不列入這項檢查。
      bad: r.earned
        .filter((m) => !m.fixedId)
        .flatMap((m) => (m.effects || []).map((e) => e.id).filter((id) => !drawable[id] || !wired[id] || CD.attachedEffectById(id))),
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
  assert(got.groupDup === 0, "同一顆記憶內，每個互斥組（出擊武器／結晶雫／里程碑／出擊道具／盧恩）各最多一條");
  const fixedGot = got.earned.filter((m) => m.fixedId);
  assert(
    fixedGot.length === 1 && fixedGot[0].fixedId === "relic_beast_night" && fixedGot[0].favorite === true && fixedGot[0].size === "m",
    "三つ首の獣擊敗夜王 → 另外獲得固定遺物「獣の夜」×1（自動最愛）"
  );

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
  const normal = got.earned.filter((m) => !m.fixedId);
  assert(
    storedIds.length === normal.length + 1 && normal.every((m) => stored[m.memId] && stored[m.memId].size === m.size),
    "Firebase：一般記憶全部存入，內容一致（" + storedIds.length + "＝" + normal.length + "＋既有固定遺物 1）"
  );
  const beasts = storedIds.filter((id) => stored[id].fixedId === "relic_beast_night");
  assert(beasts.length === 1 && beasts[0] === SEED_FIXED, "已有「獣の夜」→ 不儲存第二件（DB 仍只有原本那件）");
  const settleStatus = await pageA.evaluate(() => document.getElementById("midnight-relic-memory-settle-status").textContent);
  const dupText = await pageA.evaluate(() => window.I18N.t("midnight_relic_memory_fixed_duplicate", { count: 1 }));
  assert(settleStatus.indexOf(dupText) !== -1, "結算狀態顯示固定遺物未重複存入（" + settleStatus + "）");

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
  // 2026-09-25：第二顆同樣帶「最大HP上昇」（stackable:false），驗證不可疊加的標示與①②③。
  const KNOWN2 = "m00000000000000f2";
  await adminPut("relicMemories/" + CODE + "/" + KNOWN2, {
    memId: KNOWN2,
    size: "m",
    effects: [{ id: "rm_max_hp_up", value: 30 }, { id: "rm_max_fp_up", value: 10 }],
    createdAt: Date.now() - 1000,
    favorite: false,
    source: "tiles",
  });
  const total = prev.storedIds.length + 2;
  const pick = [KNOWN, KNOWN2, prev.storedIds[0]];
  const extra = prev.storedIds[1];
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
    const lobby = await pageA.evaluate((ids) => {
      const rowOf = (id) => document.querySelector('#midnight-lobby-relic-memory-list input[data-mem-id="' + id + '"]').parentNode.textContent;
      return { rows: ids.map(rowOf), dup: window.I18N.t("midnight_relic_memory_effect_duplicated") };
    }, pick);
    assert(
      lobby.rows[0].indexOf("①") === 0 && lobby.rows[1].indexOf("②") === 0 && lobby.rows[2].replace(/^★ /, "").indexOf("③") === 0,
      "等待房依勾選順序標註①②③"
    );
    assert(lobby.rows[0].indexOf(lobby.dup) === -1, "①（先勾選）的最大HP上昇 沒有「不可疊加」標示");
    assert(lobby.rows[1].indexOf("最大HP上昇（30）" + lobby.dup) !== -1 || lobby.rows[1].indexOf(lobby.dup) !== -1, "②的最大HP上昇 標示「不可疊加，此條未發動」（" + lobby.rows[1] + "）");
    const secondDupCount = lobby.rows[1].split(lobby.dup).length - 1;
    assert(secondDupCount === 1, "②只有重複的那一條被標示（最大FP上昇 不標，實得 " + secondDupCount + " 處）");
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
  const both = await pageA.evaluate(() => {
    const MN = window.PriTestMidnight;
    const loadout = MN._debugRelicMemory().loadout.filter((m) => /^m00000000000000f[12]$/.test(m.memId));
    return MN._debugRelicMemoryStats(loadout).hpMax - MN._debugRelicMemoryStats([]).hpMax;
  });
  assert(both === 20, "兩顆都帶最大HP上昇（20、30）→ 不可疊加，只算帶入順序第一顆的 20（實得 " + both + "）");
  assert(Math.abs(r.physMult / r.physBase - 1.05) < 1e-9, "已知記憶「物理攻撃力上昇 5%」→ 物理攻擊倍率 ×1.05（實得 " + r.physMult / r.physBase + "）");

  await pageA.dispatchEvent("#btn-midnight-open-character-sheet", "click");
  await pageA.waitForSelector("#midnight-character-sheet-relic-memories button", { timeout: WAIT });
  const slots = await pageA.$$("#midnight-character-sheet-relic-memories button");
  assert(slots.length === 3, "角色視窗顯示 3 格遺物記憶");
  const slotTexts = await pageA.$$eval("#midnight-character-sheet-relic-memories button", (els) => els.map((e) => e.textContent));
  assert(/^①/.test(slotTexts[0]) && /^②/.test(slotTexts[1]) && /^③/.test(slotTexts[2]), "角色視窗格子標註①②③（" + slotTexts.join(" ") + "）");
  await pageA.dispatchEvent("#midnight-character-sheet-relic-memories button:nth-child(2)", "click");
  await pageA.waitForTimeout(300);
  const detail = await pageA.evaluate(() => ({
    text: document.getElementById("midnight-character-sheet-detail").textContent,
    dup: window.I18N.t("midnight_relic_memory_effect_duplicated"),
  }));
  assert(detail.text.indexOf(detail.dup) !== -1, "角色視窗②的詳細顯示「不可疊加，此條未發動」");

  // ---- 固定配置遺物「アイテムの効果が周囲の味方にも発動」（2026-09-25）：A 用道具 → 同一戰場的 B 得 20% ----
  console.log("  -- 道具效果分給同一戰場的友軍（20%）--");
  const SHARE_MEM = [{ memId: "mshare", size: "s", effects: [{ id: "rm_item_effect_to_allies" }] }];
  const slotsAB = [
    await pageA.evaluate(() => window.PriTestMidnight._debugState().mySlot),
    await pageB.evaluate(() => window.PriTestMidnight._debugState().mySlot),
  ];
  const shareCount = await pageA.evaluate(
    (a) => window.PriTestMidnight._debugRelicMemoryShareItem(a.mem, "item_hero_meat_chunk", a.slots),
    { mem: SHARE_MEM, slots: slotsAB }
  );
  assert(shareCount === 1, "A 使用勇者の肉塊 → 分享給同一戰場的 1 名隊友（不含自己，實得 " + shareCount + "）");
  await pageB.waitForFunction(() => window.PriTestMidnight._debugConsumableBuffs().attack.hit1 > 0, { timeout: WAIT });
  const meatB = await pageB.evaluate(() => window.PriTestMidnight._debugConsumableBuffs());
  assert(
    meatB.attack.hit1 === 1 && meatB.attack.hit2 === 2 && meatB.skill === 1,
    "B 收到 20% 的勇者の肉塊：攻擊 +1／+2、戰技 +1（完整版 +5／+10／+5，實得 " + JSON.stringify(meatB.attack) + "／" + meatB.skill + "）"
  );
  await pageA.evaluate((a) => window.PriTestMidnight._debugRelicMemoryShareItem(a.mem, "item_perfume_acid_spray", a.slots), { mem: SHARE_MEM, slots: slotsAB });
  await pageB.waitForFunction(() => window.PriTestMidnight._debugConsumableBuffs().acid > 0, { timeout: WAIT });
  assert((await pageB.evaluate(() => window.PriTestMidnight._debugConsumableBuffs().acid)) === 2, "B 收到 20% 的酸の噴霧：敵傷害 −2（完整版 −12）");
  const noMem = await pageA.evaluate((a) => window.PriTestMidnight._debugRelicMemoryShareItem([], "item_hero_meat_chunk", a.slots), { slots: slotsAB });
  assert(noMem === 0, "沒帶這條遺物記憶時不分享");
  const offensive = await pageA.evaluate((a) => window.PriTestMidnight._debugRelicMemoryShareItem(a.mem, "item_throwing_pot", a.slots), { mem: SHARE_MEM, slots: slotsAB });
  assert(offensive === 0, "攻擊敵人的道具（投擲壺）不分享");
  const soloShare = await pageA.evaluate((a) => window.PriTestMidnight._debugRelicMemoryShareItem(a.mem, "item_hero_meat_chunk", [a.slots[0]]), { mem: SHARE_MEM, slots: slotsAB });
  assert(soloShare === 0, "戰場上只有自己時沒有分享對象");
  // 鐵壺：20% 效果＝HP 損害減少 20%，不是完全免傷。
  const ironB = await pageB.evaluate(() => window.PriTestMidnight._debugRelicMemoryApplySharedItem("item_perfume_iron_pot_spray", 0.2, false));
  assert(ironB.ironPotImmune === false && Math.abs(ironB.ironPotPartial - 0.2) < 1e-9, "B 收到 20% 的鐵壺：不免傷，HP 損害 −20%");
  // 自己用的完整版不會被友軍分享的 20% 蓋掉。
  await pageB.evaluate(() => window.PriTestMidnight._debugApplyConsumable("item_hero_meat_chunk"));
  await pageA.evaluate((a) => window.PriTestMidnight._debugRelicMemoryShareItem(a.mem, "item_hero_meat_chunk", a.slots), { mem: SHARE_MEM, slots: slotsAB });
  await pageB.waitForTimeout(1500);
  const fullB = await pageB.evaluate(() => window.PriTestMidnight._debugConsumableBuffs().attack);
  assert(fullB.hit1 === 5 && fullB.hit2 === 10, "B 自己用了完整版勇者の肉塊後，再收到 20% 分享不會降級（實得 " + JSON.stringify(fullB) + "）");
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
