# 遺物記憶（Relic Memory）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 在 midnight 加入「遺物記憶」：遊戲中隊伍共通條件累積、結束時以 5 位記憶密碼存到 Firebase、下次開房於等待房選最多 3 個帶入並套用附帶效果。

**Architecture：** 純函式（大小擲骰、效果抽選、100 上限合併、里程碑計算）獨立成 `static_src/midnight_relic_memory.js`，可用 node 直接測。Firebase 存取在 `game_storage.js` 新增 `relicMemories/<CODE>` 專用的薄 API。效果套用只在 `character_drawer.js` 新增一支 `activeAttachedEffectIds(c)`，所有「判定效果」的讀取點改讀它。midnight.js 只負責接線（獲得事件、等待房 UI、角色視窗、放棄投票、結算視窗）。

**Tech Stack：** Vanilla ES5 IIFE、Python 產生靜態 HTML、Firebase RTDB compat SDK、Playwright（`tools/midnight_check/`）＋Firebase Local Emulator。

設計文件：`docs/superpowers/specs/2026-09-24-relic-memory-design.md`

## Global Constraints

- JavaScript 一律 ES5（`var`、`function`，不用箭頭函式／`let`／`const`／template literal），IIFE 掛到 `window.PriTest*`。測試腳本（Node／Playwright）不受此限。
- 使用者可見文字全部走 i18n：`site_src/i18n_data_zh.py`／`i18n_data_ja.py`／`i18n_data_en.py` 三檔同時新增，key 前綴 `midnight_relic_memory_`。
- 記憶密碼格式：`^[A-Z0-9]{5}$`；有效序號 20 組，只存在 Firebase `relicMemoryCodes/<CODE>: true`，**不提交進 Git**。
- 每個密碼最多 100 個記憶；超過時從 `favorite !== true` 中 `createdAt` 最舊者丟棄。
- 大小：`s`＝1 效果、`m`＝2 效果、`l`＝3 效果；同一記憶內效果不重複；效果池＝`ATTACHED_EFFECT_BLOCKS` 全部 id。
- 獲得表（隊伍共通、全員各 1 個）：開局 小×1；板塊踏破每 3 個 → 小80%/中20%；強敵擊殺每 3 隻 → 小80%/中20%；第一天夜之強敵 → 中60%/大40%；第二天夜之強敵 → 中×1＋(中60%/大40%)；夜王 → 大×1＋50% 再大×1。
- 戰鬥模擬房（`battleSimEnabled()`）不產生獲得，但可帶入。
- 重複效果：`stackable !== true` 的附帶效果只算 1 次（此版全部未設 `stackable`）。
- 修改 `site_src/` 或 `static_src/` 後必須 `python generate.py`（Windows 可 `py -3 generate.py`）。
- 新 JS 檔必須同時加到 `generate.py` 的 copy list 與 `site_src/midnight_page.py` 的 `extra_scripts`（放在 `midnight.js` 之前）。
- midnight 的 Playwright 腳本觸發按鈕一律 `page.dispatchEvent(sel, "click")`（CLAUDE.md §4.6）。
- commit message 用繁體中文，結尾附：
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01RiEWhKA1XHtg3Vqq78Xyq4
  ```

## 對設計文件的一處修正

設計文件 §6.3 寫「選擇結果寫入 `character/<token>/relicMemorySelection`」。但等待房階段角色物件尚未建立（`character/<token>` 是開局時才由 `updateLobbyOrGameVisibility()` 建立），因此改寫到 **`players/<slot>/relicMemoryLoadout`**（陣列，最多 3 個 `{memId,size,effects}`），開局時 `newCharacterForSlot(slot)` 複製成 `c.relicMemoryLoadout`。Task 7 會同步修正設計文件。

## 檔案結構

| 檔案 | 動作 | 職責 |
| --- | --- | --- |
| `static_src/midnight_relic_memory.js` | 新增 | 純函式：大小擲骰、效果抽選、記憶物件產生、里程碑 key、100 上限合併、密碼驗證 |
| `static_src/character_drawer.js` | 修改 | `activeAttachedEffectIds(c)`；計算系讀取點改用它；匯出 `allAttachedEffectIds`／`assignAttachedResistChoiceIfNeeded` |
| `static_src/game_storage.js` | 修改 | `relicMemoryRead`／`relicMemoryTransaction`／`relicMemorySet` |
| `database.rules.json` | 修改 | `relicMemoryCodes`、`relicMemories/$code` |
| `static_src/midnight.js` | 修改 | 獲得事件、等待房面板、角色視窗列、放棄投票、結算視窗、除錯 hook |
| `site_src/midnight_page.py` | 修改 | 新 HTML 區塊＋script |
| `static_src/style.css` | 修改 | 新區塊樣式 |
| `site_src/i18n_data_{zh,ja,en}.py` | 修改 | 新字串 |
| `generate.py` | 修改 | copy list |
| `tools/midnight_check/relic_memory_unit_check.js` | 新增 | node 單元測試（純函式） |
| `tools/midnight_check/relic_memory_drawer_check.js` | 新增 | Playwright：效果套用 |
| `tools/midnight_check/relic_memory_emulator_check.js` | 新增 | Playwright＋emulator：儲存、獲得、帶入、放棄、結算 |
| `tools/midnight_check/package.json` | 修改 | 新 scripts |

---

### Task 1：純函式模組 `midnight_relic_memory.js`

**Files:**
- Create: `static_src/midnight_relic_memory.js`
- Create: `tools/midnight_check/relic_memory_unit_check.js`
- Modify: `generate.py`（copy list，`"midnight_text_adapt.js",` 之後）
- Modify: `site_src/midnight_page.py`（`extra_scripts`，`"midnight_text_adapt.js",` 之後）
- Modify: `tools/midnight_check/package.json`

**Interfaces:**
- Produces（`window.PriTestMidnightRelicMemory`）：
  - `SIZE_EFFECT_COUNT`：`{ s: 1, m: 2, l: 3 }`
  - `MAX_STORED`：`100`
  - `MAX_LOADOUT`：`3`
  - `isValidCode(code: string) → boolean`
  - `normalizeCode(raw: string) → string`（trim＋toUpperCase）
  - `grantSizes(kind: "start"|"tiles"|"strong"|"day1"|"day2"|"boss", rand: () => number) → Array<"s"|"m"|"l">`
  - `rollEffects(size, effectIds: string[], rand) → string[]`（互不重複）
  - `newMemory(size, effectIds, source, rand, now: number) → { memId, size, effects, createdAt, favorite: false, source }`
  - `milestoneGrantKeys(tilesCleared: number, strongKilled: number) → string[]`（`["tiles1","tiles2",...,"strong1",...]`）
  - `grantKindOfKey(key: string) → string`（`"tiles3"→"tiles"`、`"day1"→"day1"`）
  - `mergeIntoStore(store: object|null, newMems: object[], cap: number) → { store, added: number, discarded: number, rejected: number }`
  - `sortedMemories(store: object|null) → object[]`（最愛在前，再依 createdAt 新→舊）

- [ ] **Step 1：寫失敗的單元測試**

`tools/midnight_check/relic_memory_unit_check.js`：

```js
// 遺物記憶純函式單元測試（不需瀏覽器）：node relic_memory_unit_check.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "../../static_src/midnight_relic_memory.js"), "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const RM = sandbox.window.PriTestMidnightRelicMemory;

let fails = 0;
function assert(cond, label) {
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label);
  if (!cond) fails++;
}
function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}
const IDS = ["a", "b", "c", "d", "e"];

assert(RM.isValidCode("ABC1E"), "ABC1E 有效");
assert(!RM.isValidCode("abc1e"), "小寫無效");
assert(!RM.isValidCode("ABCD"), "4 位無效");
assert(RM.normalizeCode(" abc1e ") === "ABC1E", "normalizeCode 去空白轉大寫");

assert(JSON.stringify(RM.grantSizes("start", seq([0.99]))) === '["s"]', "start 固定小");
assert(JSON.stringify(RM.grantSizes("tiles", seq([0.79]))) === '["s"]', "tiles 0.79 → 小");
assert(JSON.stringify(RM.grantSizes("tiles", seq([0.8]))) === '["m"]', "tiles 0.8 → 中");
assert(JSON.stringify(RM.grantSizes("strong", seq([0.1]))) === '["s"]', "strong 同 tiles");
assert(JSON.stringify(RM.grantSizes("day1", seq([0.59]))) === '["m"]', "day1 0.59 → 中");
assert(JSON.stringify(RM.grantSizes("day1", seq([0.6]))) === '["l"]', "day1 0.6 → 大");
assert(JSON.stringify(RM.grantSizes("day2", seq([0.6]))) === '["m","l"]', "day2 = 中 + (0.6→大)");
assert(JSON.stringify(RM.grantSizes("boss", seq([0.49]))) === '["l","l"]', "boss 0.49 → 大大");
assert(JSON.stringify(RM.grantSizes("boss", seq([0.5]))) === '["l"]', "boss 0.5 → 大");

const eff = RM.rollEffects("l", IDS, seq([0, 0, 0, 0.5, 0.99]));
assert(eff.length === 3 && new Set(eff).size === 3, "大＝3 個互不重複");
assert(RM.rollEffects("s", IDS, seq([0.3])).length === 1, "小＝1 個");

const mem = RM.newMemory("m", IDS, "tiles", Math.random, 1000);
assert(/^m[0-9a-f]{16}$/.test(mem.memId), "memId 格式");
assert(mem.size === "m" && mem.effects.length === 2 && mem.favorite === false && mem.createdAt === 1000 && mem.source === "tiles", "newMemory 欄位");

assert(JSON.stringify(RM.milestoneGrantKeys(7, 3)) === '["tiles1","tiles2","strong1"]', "milestone 7 板塊 3 強敵");
assert(RM.milestoneGrantKeys(2, 2).length === 0, "未滿 3 不發");
assert(RM.grantKindOfKey("tiles3") === "tiles" && RM.grantKindOfKey("day2") === "day2", "grantKindOfKey");

// 100 上限：放 99 舊（第 0 個是最愛）＋ 3 新 → 丟 2 個最舊非最愛
const store = {};
for (let i = 0; i < 99; i++) store["m" + String(i).padStart(16, "0")] = { memId: "m" + String(i).padStart(16, "0"), size: "s", effects: ["a"], createdAt: i, favorite: i === 0, source: "start" };
const add = [1, 2, 3].map((n) => ({ memId: "mnew" + n, size: "s", effects: ["a"], createdAt: 1000 + n, favorite: false, source: "start" }));
const r = RM.mergeIntoStore(store, add, 100);
assert(Object.keys(r.store).length === 100, "合併後剛好 100");
assert(r.added === 3 && r.discarded === 2 && r.rejected === 0, "added 3 / discarded 2");
assert(!!r.store["m0000000000000000"], "最愛（最舊）未被丟");
assert(!r.store["m0000000000000001"] && !r.store["m0000000000000002"], "丟掉最舊的 2 個非最愛");

// 全部是最愛時新記憶放不下
const favStore = {};
for (let i = 0; i < 100; i++) favStore["f" + i] = { memId: "f" + i, size: "s", effects: ["a"], createdAt: i, favorite: true, source: "start" };
const r2 = RM.mergeIntoStore(favStore, add, 100);
assert(r2.added === 0 && r2.rejected === 3 && Object.keys(r2.store).length === 100, "最愛佔滿 → rejected 3");

const sorted = RM.sortedMemories({ x: { memId: "x", createdAt: 5, favorite: false }, y: { memId: "y", createdAt: 1, favorite: true }, z: { memId: "z", createdAt: 9, favorite: false } });
assert(sorted.map((m) => m.memId).join() === "y,z,x", "sortedMemories：最愛優先、再新→舊");

console.log(fails ? "\n" + fails + " FAIL" : "\nALL PASS");
process.exit(fails ? 1 : 0);
```

`tools/midnight_check/package.json` 的 `scripts` 加一行：
```json
"test:relic_memory_unit": "node relic_memory_unit_check.js",
```

- [ ] **Step 2：執行確認失敗**

Run: `cd tools/midnight_check && node relic_memory_unit_check.js`
Expected: `ENOENT ... midnight_relic_memory.js`

- [ ] **Step 3：實作模組**

`static_src/midnight_relic_memory.js`：

```js
// 遺物記憶（2026-09-24新增，設計文件 docs/superpowers/specs/2026-09-24-relic-memory-design.md）：
// 純函式層——大小擲骰、效果抽選、里程碑計算、100 上限合併。不碰 DOM／Firebase／角色物件，
// 由 midnight.js 呼叫；可直接在 node 以 vm 載入測試（tools/midnight_check/relic_memory_unit_check.js）。
(function () {
  "use strict";

  var SIZE_EFFECT_COUNT = { s: 1, m: 2, l: 3 };
  var MAX_STORED = 100;
  var MAX_LOADOUT = 3;
  var CODE_RE = /^[A-Z0-9]{5}$/;
  var MILESTONE_STEP = 3; // 板塊踏破／強敵擊殺每 3 個發一次

  function isValidCode(code) {
    return typeof code === "string" && CODE_RE.test(code);
  }

  function normalizeCode(raw) {
    return String(raw || "").replace(/\s+/g, "").toUpperCase();
  }

  function smallOrMid(rand) {
    return rand() < 0.8 ? "s" : "m";
  }

  function midOrLarge(rand) {
    return rand() < 0.6 ? "m" : "l";
  }

  // 使用者明確規格的獲得表（見設計文件 §3）。
  function grantSizes(kind, rand) {
    if (kind === "start") return ["s"];
    if (kind === "tiles" || kind === "strong") return [smallOrMid(rand)];
    if (kind === "day1") return [midOrLarge(rand)];
    if (kind === "day2") return ["m", midOrLarge(rand)];
    if (kind === "boss") return rand() < 0.5 ? ["l", "l"] : ["l"];
    return [];
  }

  function rollEffects(size, effectIds, rand) {
    var pool = effectIds.slice();
    var n = Math.min(SIZE_EFFECT_COUNT[size] || 1, pool.length);
    var out = [];
    for (var i = 0; i < n; i++) {
      var idx = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  function randomHex16(rand) {
    var s = "";
    for (var i = 0; i < 16; i++) s += Math.floor(rand() * 16).toString(16);
    return s;
  }

  function newMemory(size, effectIds, source, rand, now) {
    return {
      memId: "m" + randomHex16(rand),
      size: size,
      effects: rollEffects(size, effectIds, rand),
      createdAt: now,
      favorite: false,
      source: source,
    };
  }

  function milestoneGrantKeys(tilesCleared, strongKilled) {
    var keys = [];
    var i;
    for (i = 1; i <= Math.floor(tilesCleared / MILESTONE_STEP); i++) keys.push("tiles" + i);
    for (i = 1; i <= Math.floor(strongKilled / MILESTONE_STEP); i++) keys.push("strong" + i);
    return keys;
  }

  function grantKindOfKey(key) {
    return String(key).replace(/[0-9]+$/, function (m) {
      return /^day/.test(key) ? m : "";
    });
  }

  function toList(store) {
    return Object.keys(store || {}).map(function (k) {
      return store[k];
    });
  }

  // 追加 newMems，超過 cap 時從非最愛的最舊者開始丟；非最愛全丟光仍超過（最愛佔滿）時，
  // 新記憶中放不下的部分不存入（rejected）。不修改傳入的 store。
  function mergeIntoStore(store, newMems, cap) {
    var next = {};
    toList(store).forEach(function (m) {
      next[m.memId] = m;
    });
    var added = 0;
    var discarded = 0;
    var rejected = 0;
    newMems.forEach(function (m) {
      var count = Object.keys(next).length;
      if (count >= cap) {
        var victims = toList(next)
          .filter(function (x) {
            return x.favorite !== true;
          })
          .sort(function (a, b) {
            return (a.createdAt || 0) - (b.createdAt || 0);
          });
        if (!victims.length) {
          rejected++;
          return;
        }
        delete next[victims[0].memId];
        discarded++;
      }
      next[m.memId] = m;
      added++;
    });
    return { store: next, added: added, discarded: discarded, rejected: rejected };
  }

  function sortedMemories(store) {
    return toList(store).sort(function (a, b) {
      if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  window.PriTestMidnightRelicMemory = {
    SIZE_EFFECT_COUNT: SIZE_EFFECT_COUNT,
    MAX_STORED: MAX_STORED,
    MAX_LOADOUT: MAX_LOADOUT,
    isValidCode: isValidCode,
    normalizeCode: normalizeCode,
    grantSizes: grantSizes,
    rollEffects: rollEffects,
    newMemory: newMemory,
    milestoneGrantKeys: milestoneGrantKeys,
    grantKindOfKey: grantKindOfKey,
    mergeIntoStore: mergeIntoStore,
    sortedMemories: sortedMemories,
  };
})();
```

注意 `mergeIntoStore` 的 rejected 情境：新加入的記憶本身 `favorite:false`，所以「最愛佔滿」時第一個新記憶進來前 victims 為空 → rejected；這符合測試。但若 store 有 99 最愛＋0 非最愛，第一個新記憶會進（count 99 < 100），第二個時 victims＝剛加入的第一個 → 會丟掉剛加的。這是可接受的邊界（丟最舊非最愛），不特別處理。

`generate.py` copy list 在 `"midnight_text_adapt.js",` 後加 `"midnight_relic_memory.js",`；`site_src/midnight_page.py` 的 `extra_scripts` 在 `"midnight_text_adapt.js",` 後加：

```python
            # 2026-09-24新增：遺物記憶純函式層（見設計文件
            # docs/superpowers/specs/2026-09-24-relic-memory-design.md），midnight.js 會讀
            # window.PriTestMidnightRelicMemory，必須排在它之前。沒有其他相依。
            "midnight_relic_memory.js",
```

- [ ] **Step 4：執行確認通過**

Run: `node --check static_src/midnight_relic_memory.js && cd tools/midnight_check && node relic_memory_unit_check.js`
Expected: `ALL PASS`

- [ ] **Step 5：建置並 commit**

```bash
python generate.py
git add static_src/midnight_relic_memory.js tools/midnight_check/relic_memory_unit_check.js tools/midnight_check/package.json generate.py site_src/midnight_page.py
git commit -m "feat(midnight): 遺物記憶純函式模組（大小擲骰／效果抽選／100上限合併）"
```

---

### Task 2：附帶效果的有效清單 `activeAttachedEffectIds(c)`

**Files:**
- Modify: `static_src/character_drawer.js`（`attachedEffectById` 之後新增 helper；讀取點 約 737／3989／4210／4559；匯出區 約 7340）
- Modify: `static_src/midnight.js:6086`、`:6098`
- Create: `tools/midnight_check/relic_memory_drawer_check.js`
- Modify: `tools/midnight_check/package.json`

**Interfaces:**
- Consumes：角色物件的 `c.learnedAttachedEffects: string[]`、`c.relicMemoryLoadout: Array<{memId,size,effects:string[]}>`（Task 4 寫入）。
- Produces（`window.PriTestCharacterDrawer`）：
  - `activeAttachedEffectIds(c) → string[]`（learned ＋ loadout 效果；`stackable !== true` 者去重）
  - `allAttachedEffectIds() → string[]`（`ATTACHED_EFFECT_BLOCKS` 攤平的全部 id）
  - `assignAttachedResistChoiceIfNeeded(c, effectId)`（既有函式，新增匯出）

- [ ] **Step 1：寫失敗的 Playwright 檢查**

`tools/midnight_check/relic_memory_drawer_check.js`：

```js
// 遺物記憶：帶入效果是否反映到既有附帶效果計算（不需 Firebase）。
// 前置：python generate.py；python -m http.server 8791 --directory dist
const { chromium } = require("playwright");
const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let fails = 0;
  const assert = (c, l) => { console.log((c ? "  [PASS] " : "  [FAIL] ") + l); if (!c) fails++; };
  try {
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    const r = await page.evaluate(() => {
      const CD = window.PriTestCharacterDrawer;
      const typeId = window.PriTestCharacterTypes.list()[0].id;
      const c = CD.newCharacter("t", typeId);
      const baseHp = CD.totalFlatMaxStatBonus(c, "hp");
      c.relicMemoryLoadout = [{ memId: "m1", size: "m", effects: ["max_hp_up", "arts_dmg"] }];
      const withMem = CD.totalFlatMaxStatBonus(c, "hp");
      const art = CD.attachedSkillDamageBonus(c, "art");
      c.learnedAttachedEffects = ["max_hp_up"];
      const dedup = CD.totalFlatMaxStatBonus(c, "hp");
      const ids = CD.activeAttachedEffectIds(c);
      return { baseHp, withMem, art, dedup, ids, all: CD.allAttachedEffectIds().length, hasAssign: typeof CD.assignAttachedResistChoiceIfNeeded === "function" };
    });
    assert(r.withMem === r.baseHp + 1, "帶入 max_hp_up → 最大HP +1");
    assert(r.art === 5, "帶入 arts_dmg → 戰技傷害 +5");
    assert(r.dedup === r.baseHp + 1, "習得＋帶入同一效果（非 stackable）只算 1 次");
    assert(r.ids.filter((x) => x === "max_hp_up").length === 1, "activeAttachedEffectIds 去重");
    assert(r.all === 24, "allAttachedEffectIds 共 24 種");
    assert(r.hasAssign, "匯出 assignAttachedResistChoiceIfNeeded");
  } finally {
    await browser.close();
  }
  console.log(fails ? fails + " FAIL" : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
```

注意：若 `window.PriTestCharacterTypes.list` 不存在，改用該模組實際的列舉函式（先 `grep -n "list:\|all:" static_src/character_types.js` 確認匯出名稱再寫）。`totalFlatMaxStatBonus(c, "hp")` 的 statKey 以 `MAX_STAT_LABELS` 實際 key 為準（`grep -n "MAX_STAT_LABELS = " static_src/character_drawer.js`）。

package.json 加 `"test:relic_memory_drawer": "node relic_memory_drawer_check.js",`

- [ ] **Step 2：執行確認失敗**

Run: `python generate.py && (python -m http.server 8791 --directory dist &) && cd tools/midnight_check && node relic_memory_drawer_check.js`
Expected: FAIL（`CD.activeAttachedEffectIds is not a function`）

- [ ] **Step 3：實作 helper 並替換讀取點**

在 `character_drawer.js` 的 `attachedEffectById` 之後加入：

```js
  // 遺物記憶（2026-09-24）：「目前生效中的附帶效果」＝習得的learnedAttachedEffects＋
  // midnight帶入的遺物記憶（c.relicMemoryLoadout[].effects）。可否重複計算由效果定義上的
  // stackable旗標決定（使用者之後逐一指定，預設不可）：不可疊加者同id只留1個。
  // 習得上限／置換／習得UI仍只看learnedAttachedEffects，這支只給「判定效果」的讀取點用。
  function activeAttachedEffectIds(c) {
    if (!c) return [];
    var ids = (c.learnedAttachedEffects || []).slice();
    (c.relicMemoryLoadout || []).forEach(function (mem) {
      (mem && mem.effects ? mem.effects : []).forEach(function (id) {
        ids.push(id);
      });
    });
    var seen = {};
    return ids.filter(function (id) {
      var effect = attachedEffectById(id);
      if (effect && effect.stackable === true) return true;
      if (seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  function allAttachedEffectIds() {
    var out = [];
    ATTACHED_EFFECT_BLOCKS.forEach(function (block) {
      block.forEach(function (e) {
        out.push(e.id);
      });
    });
    return out;
  }
```

替換讀取點（只換「判定效果」的，不換習得 UI／上限）：
- 約 737（aggro 合計）：`(c && c.learnedAttachedEffects ? c.learnedAttachedEffects : []).forEach(` → `activeAttachedEffectIds(c).forEach(`
- 約 3989（`attachedFlatMaxStatBonus`）：`(c.learnedAttachedEffects || []).forEach(` → `activeAttachedEffectIds(c).forEach(`
- 約 4210（`attachedSkillDamageBonus`）：`(c.learnedAttachedEffects || []).indexOf(id)` → `activeAttachedEffectIds(c).indexOf(id)`
- 約 4559（`computeWeaponDamage` 的 attached 迴圈）：`(c.learnedAttachedEffects || []).forEach(` → `activeAttachedEffectIds(c).forEach(`

替換前先 `grep -n "learnedAttachedEffects" static_src/character_drawer.js` 確認行號；504／560／590／621／663／3283／3303／3314〜3322 是習得 UI／抽選，**不要改**。

`midnight.js` 約 6086、6098：
```js
      var jumpAtkUpBonus = CharacterDrawer.activeAttachedEffectIds(c).indexOf("jump_atk_up") !== -1 ? 10 : 0;
```
```js
      var dashAtkUpBonus = CharacterDrawer.activeAttachedEffectIds(c).indexOf("dash_atk_up") !== -1 ? 10 : 0;
```
（先確認該函式內 CharacterDrawer 的區域變數名稱，`midnight.js` 多處用 `CD` 或 `window.PriTestCharacterDrawer`，照該處既有寫法。）

匯出區加：
```js
    activeAttachedEffectIds: activeAttachedEffectIds,
    allAttachedEffectIds: allAttachedEffectIds,
    assignAttachedResistChoiceIfNeeded: assignAttachedResistChoiceIfNeeded,
```

- [ ] **Step 4：執行確認通過**

Run: `node --check static_src/character_drawer.js && node --check static_src/midnight.js && python generate.py && cd tools/midnight_check && node relic_memory_drawer_check.js`
Expected: `ALL PASS`

- [ ] **Step 5：commit**

```bash
git add static_src/character_drawer.js static_src/midnight.js tools/midnight_check/relic_memory_drawer_check.js tools/midnight_check/package.json
git commit -m "feat(midnight): 附帶效果改讀activeAttachedEffectIds，納入帶入的遺物記憶"
```

---

### Task 3：Firebase 儲存 API ＋ 安全規則

**Files:**
- Modify: `static_src/game_storage.js`（`rtSetWithOnDisconnect` 之後新增 3 函式＋匯出）
- Modify: `database.rules.json`
- Create: `tools/midnight_check/relic_memory_emulator_check.js`（本 Task 只寫儲存段，Task 4〜6 再往後加段落）
- Modify: `tools/midnight_check/package.json`

**Interfaces:**
- Produces（`window.PriTestGameStorage`）：
  - `relicMemoryRead(code) → Promise<{ ok: true, value: object|null } | { ok: false, error: string }>`
  - `relicMemoryTransaction(code, updateFn) → Promise<{ ok: true, value: object|null } | { ok: false, error: string }>`
  - `relicMemorySet(code, memId, value|null) → Promise<{ ok: boolean, error?: string }>`
- 權限被拒時 `error` 為 `"denied"`（Firebase 錯誤 `code` 含 `PERMISSION_DENIED` 或 message 含 `permission_denied`），其餘為 `"network"`。

- [ ] **Step 1：寫失敗的 emulator 檢查（儲存段）**

`tools/midnight_check/relic_memory_emulator_check.js`：

```js
// ============================================================================
// 遺物記憶 emulator 回歸測試（Firebase Local Emulator，不連正式專案）。
// 前置：
//   1. python generate.py
//   2. python -m http.server 8791 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node relic_memory_emulator_check.js
// ============================================================================
const { chromium } = require("playwright");
const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const EMU = "http://127.0.0.1:9000";
const NS = "elden-ring-nightreign-default-rtdb";
const TEST_CODE = "TST01";
const META_WAIT_MS = 15000;

let fails = 0;
const assert = (c, l) => { console.log((c ? "  [PASS] " : "  [FAIL] ") + l); if (!c) fails++; };

// emulator 的 owner token 可以繞過規則，只用來佈置測試資料（正式環境對應 Console 手動匯入）。
async function adminPut(pathStr, value) {
  const res = await fetch(`${EMU}/${pathStr}.json?ns=${NS}`, {
    method: "PUT",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error("adminPut failed " + res.status);
}

async function enableEmulatorFlag(page) {
  await page.addInitScript(() => {
    try { window.sessionStorage.setItem("pritestRtdbEmulator", "1"); } catch (e) {}
  });
}

async function storageSection(page) {
  console.log("=== 儲存 API ＋ 規則 ===");
  await adminPut("relicMemoryCodes", { [TEST_CODE]: true });
  await adminPut("relicMemories/" + TEST_CODE, null);
  const r = await page.evaluate(async (code) => {
    const GS = window.PriTestGameStorage;
    const empty = await GS.relicMemoryRead(code);
    const bad = await GS.relicMemoryRead("ZZZZZ");
    const tx = await GS.relicMemoryTransaction(code, (cur) => Object.assign({}, cur || {}, { mA: { memId: "mA", size: "s", effects: ["attack_dmg"], createdAt: 1, favorite: false, source: "start" } }));
    const fav = await GS.relicMemorySet(code, "mA", { memId: "mA", size: "s", effects: ["attack_dmg"], createdAt: 1, favorite: true, source: "start" });
    const after = await GS.relicMemoryRead(code);
    const del = await GS.relicMemorySet(code, "mA", null);
    const afterDel = await GS.relicMemoryRead(code);
    return { empty, bad, tx, fav, after, del, afterDel };
  }, TEST_CODE);
  assert(r.empty.ok && r.empty.value === null, "有效密碼、尚無資料 → ok/null");
  assert(!r.bad.ok && r.bad.error === "denied", "未登錄密碼 → denied");
  assert(r.tx.ok && r.tx.value && r.tx.value.mA, "transaction 寫入");
  assert(r.fav.ok && r.after.value.mA.favorite === true, "relicMemorySet 更新最愛");
  assert(r.del.ok && r.afterDel.value === null, "relicMemorySet(null) 刪除");
}

(async () => {
  const browser = await chromium.launch();
  const pageA = await browser.newPage();
  try {
    await enableEmulatorFlag(pageA);
    await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await storageSection(pageA);
    // Task 4〜6 在這裡往下加段落
  } catch (e) {
    console.error(e);
    fails++;
  } finally {
    await browser.close();
  }
  console.log(fails ? fails + " FAIL" : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
```

package.json 加 `"test:relic_memory_emulator": "node relic_memory_emulator_check.js",`

- [ ] **Step 2：執行確認失敗**

Run（emulator 與 http server 已啟動）：`cd tools/midnight_check && node relic_memory_emulator_check.js`
Expected: FAIL（`GS.relicMemoryRead is not a function`）

- [ ] **Step 3：實作儲存 API 與規則**

`game_storage.js`，放在 `rtSetWithOnDisconnect` 定義之後：

```js
  // ---- 遺物記憶（2026-09-24，設計文件 docs/superpowers/specs/2026-09-24-relic-memory-design.md）----
  // 跟 games/<gameId> 完全分開的頂層節點 relicMemories/<CODE>：玩家用 5 位記憶密碼跨房間保存
  // 遺物記憶。只有 relicMemoryCodes/<CODE> 存在（管理者在 Console 匯入的 20 組序號）時規則才
  // 放行讀寫，無效密碼會收到 PERMISSION_DENIED——呼叫端以 error==="denied" 判斷「密碼無效」。
  // 一律走 cloud（不看 storageMode），因為這個資料本來就不屬於任何一局遊戲。
  function relicMemoryErrorKind(err) {
    var s = String((err && (err.code || err.message)) || "").toLowerCase();
    return s.indexOf("permission") !== -1 ? "denied" : "network";
  }

  function relicMemoryRef(code, memId) {
    var p = "relicMemories/" + code + (memId ? "/" + memId : "");
    return window.firebase.database().ref(p);
  }

  function relicMemoryRead(code) {
    return ensureCloudReady("cloud")
      .then(function () {
        return relicMemoryRef(code).once("value");
      })
      .then(function (snap) {
        return { ok: true, value: snap.val() };
      })
      .catch(function (err) {
        return { ok: false, error: relicMemoryErrorKind(err) };
      });
  }

  function relicMemoryTransaction(code, updateFn) {
    return ensureCloudReady("cloud")
      .then(function () {
        return relicMemoryRef(code).transaction(updateFn);
      })
      .then(function (result) {
        return { ok: !!(result && result.committed), value: result ? result.snapshot.val() : null };
      })
      .catch(function (err) {
        return { ok: false, error: relicMemoryErrorKind(err) };
      });
  }

  function relicMemorySet(code, memId, value) {
    return ensureCloudReady("cloud")
      .then(function () {
        return relicMemoryRef(code, memId).set(value);
      })
      .then(function () {
        return { ok: true };
      })
      .catch(function (err) {
        return { ok: false, error: relicMemoryErrorKind(err) };
      });
  }
```

匯出加：
```js
    relicMemoryRead: relicMemoryRead,
    relicMemoryTransaction: relicMemoryTransaction,
    relicMemorySet: relicMemorySet,
```

`database.rules.json`：在 `"games": {...}` 之後、同層加入：

```json
    "relicMemoryCodes": {
      ".read": false,
      ".write": false
    },
    "relicMemories": {
      ".read": false,
      ".write": false,
      "$code": {
        ".read": "auth != null && root.child('relicMemoryCodes').child($code).exists()",
        ".write": "auth != null && root.child('relicMemoryCodes').child($code).exists()",
        ".validate": "$code.matches(/^[A-Z0-9]{5}$/)",
        "$memId": {
          ".validate": "$memId.matches(/^m[0-9a-f]{16}$/)"
        }
      }
    }
```

（`$memId` 只接受正式格式 `m`＋16位小寫hex；不額外放寬測試用短 id ——review第一輪發現「測試pattern是正式pattern的superset，正式格式檢查形同虛設」，因此改為單一嚴格pattern。測試 fixture 一律使用合法格式的 memId（例如 `m00000000000000a1`），並新增一筆「不合法 memId 應被拒絕」的斷言。）emulator 會在啟動時讀 `firebase.json` 指到的規則；改完規則需重啟 emulator（或用 owner token PUT `.settings/rules.json` 即時套用到執行中的 emulator）。

- [ ] **Step 4：執行確認通過**

Run: `node --check static_src/game_storage.js && python generate.py`，重啟 emulator 後 `cd tools/midnight_check && node relic_memory_emulator_check.js`
Expected: 儲存段 5 項 PASS

- [ ] **Step 5：commit**

```bash
git add static_src/game_storage.js database.rules.json tools/midnight_check/relic_memory_emulator_check.js tools/midnight_check/package.json
git commit -m "feat(midnight): 遺物記憶的Firebase儲存API與安全規則"
```

---

### Task 4：遊戲中獲得（開局小×1、里程碑、夜之強敵、夜王）

**Files:**
- Modify: `static_src/midnight.js`
  - `newCharacterForSlot()`（約 2960）
  - `enterGameAsLateJoiner()`（約 3897）
  - `handleRestartCycle()`（約 23101）
  - `frameInner()`（約 23964 `updateGameVictoryModal();` 之後）
  - `window.PriTestMidnight`（約 24236）加除錯 hook
- Modify: `site_src/i18n_data_{zh,ja,en}.py`
- Modify: `tools/midnight_check/relic_memory_emulator_check.js`

**Interfaces:**
- Consumes：`PriTestMidnightRelicMemory.grantSizes/newMemory/milestoneGrantKeys/grantKindOfKey`、`CharacterDrawer.allAttachedEffectIds()`。
- Produces：
  - RTDB `meta/relicMemoryGrants/<grantKey>: { kind, at }`（grantKey：`tiles1..`、`strong1..`、`day1`、`day2`、`boss`）
  - 角色欄位 `c.relicMemory: { earned: Memory[], seen: { <grantKey>: true } }`（單一子節點，對應
    RTDB `character/<token>/relicMemory`；fix round 1改為單一子節點，見下方 Step 3(c) 之後的更新說明）
  - `window.PriTestMidnight._debugRelicMemory() → { earned, seen, grants }`

- [ ] **Step 1：寫失敗的檢查段**

在 `relic_memory_emulator_check.js` 加入函式與呼叫（建立房間、加入、開局後檢查）：

```js
async function joinLobby(page, passcode) {
  await page.dispatchEvent("#midnight-lobby-slots .midnight-slot-empty button", "click");
  await page.fill("#midnight-lobby-passcode-input", passcode);
  await page.dispatchEvent("#btn-midnight-lobby-join", "click");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
}

async function createAndStart(pageA, pageB, beforeReady) {
  await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
  await pageA.dispatchEvent("#btn-midnight-create", "click");
  await pageA.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
  const url = pageA.url();
  await pageB.goto(url, { waitUntil: "networkidle" });
  await pageB.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
  await joinLobby(pageA, "1234");
  await joinLobby(pageB, "5678");
  if (beforeReady) await beforeReady();
  await pageA.dispatchEvent("#btn-midnight-lobby-ready", "click");
  await pageB.dispatchEvent("#btn-midnight-lobby-ready", "click");
  for (const p of [pageA, pageB]) {
    await p.waitForFunction(() => {
      const d = window.PriTestMidnight._debugState();
      return d.meta.sessionStartAt && d.characters && d.characters[d.myTokenId];
    }, { timeout: 25000 });
  }
  return url;
}

async function grantSection(pageA, pageB) {
  console.log("=== 遊戲中獲得 ===");
  const startA = await pageA.evaluate(() => window.PriTestMidnight._debugRelicMemory());
  assert(startA.earned.length === 1 && startA.earned[0].size === "s" && startA.earned[0].source === "start", "開局小×1");
  // 直接寫入 grant（里程碑判定本身由 milestoneGrantKeys 單元測試涵蓋）
  const gid = await pageA.evaluate(() => window.PriTestMidnight._debugState().gameId);
  await pageA.evaluate((g) => window.PriTestGameStorage.rtSet(g, "cloud", "meta/relicMemoryGrants/day2", { kind: "day2", at: Date.now() }), gid);
  for (const p of [pageA, pageB]) {
    await p.waitForFunction(() => window.PriTestMidnight._debugRelicMemory().earned.length === 3, { timeout: 8000 }).catch(() => {});
  }
  const a = await pageA.evaluate(() => window.PriTestMidnight._debugRelicMemory());
  const b = await pageB.evaluate(() => window.PriTestMidnight._debugRelicMemory());
  assert(a.earned.length === 3 && b.earned.length === 3, "day2 事件 → 兩人各 +2（中＋中/大）");
  assert(a.earned[1].size === "m" && a.seen.day2 === true, "day2 第一個固定中、已標記 seen");
  // 同一事件再寫一次不應重複發
  await pageA.evaluate((g) => window.PriTestGameStorage.rtSet(g, "cloud", "meta/relicMemoryGrants/day2", { kind: "day2", at: Date.now() + 1 }), gid);
  await pageA.waitForTimeout(1500);
  const a2 = await pageA.evaluate(() => window.PriTestMidnight._debugRelicMemory());
  assert(a2.earned.length === 3, "同一 grantKey 不重複發放");
}
```

主流程改為：

```js
  const pageB = await browser.newPage();
  await enableEmulatorFlag(pageB);
  await storageSection(pageA);
  await createAndStart(pageA, pageB);
  await grantSection(pageA, pageB);
```

（`pageB` 的 `enableEmulatorFlag` 必須在 `goto` 前呼叫。背景分頁 rAF 可能被節流：`waitForFunction` 之前若需要推進，可在 evaluate 裡呼叫 `window.PriTestMidnight._tick()`。）

- [ ] **Step 2：執行確認失敗**

Run: `cd tools/midnight_check && node relic_memory_emulator_check.js`
Expected: FAIL（`_debugRelicMemory is not a function`）

- [ ] **Step 3：實作**

(a) `newCharacterForSlot(slot)` 在 `c.flaskMax = FLASK_MAX_DEFAULT;` 之後加：

```js
    // 遺物記憶（2026-09-24，設計文件§3／§4）：開局必得小×1（戰鬥模擬房不獲得）；
    // 等待房選好的帶入記憶（players/<slot>/relicMemoryLoadout）複製到角色上，效果由
    // CharacterDrawer.activeAttachedEffectIds()統一讀取。耐性類效果用既有的隨機選擇。
    var RM = window.PriTestMidnightRelicMemory;
    var CDr = window.PriTestCharacterDrawer;
    c.relicMemory = { earned: [], seen: {} };
    if (RM && !battleSimEnabled()) {
      c.relicMemory.earned.push(RM.newMemory("s", CDr.allAttachedEffectIds(), "start", Math.random, Date.now()));
    }
    c.relicMemoryLoadout = ((p && p.relicMemoryLoadout) || []).slice(0, RM ? RM.MAX_LOADOUT : 3);
    c.relicMemoryLoadout.forEach(function (mem) {
      (mem.effects || []).forEach(function (eid) {
        CDr.assignAttachedResistChoiceIfNeeded(c, eid);
      });
    });
```

（fix round 1，2026-09-24 review：`c.relicMemoryEarned`／`c.relicMemoryGrantSeen` 兩個 top-level
欄位改成單一子節點 `c.relicMemory = { earned, seen }`，原因見下方 Step 3(c) 之後的說明。）

(b) `enterGameAsLateJoiner(slot)`：在建立 `initialChar` 後、transaction 前加入（中途加入只取之後的事件）：

```js
    Object.keys((meta && meta.relicMemoryGrants) || {}).forEach(function (k) {
      initialChar.relicMemory.seen[k] = true;
    });
```

(c) 新增區塊（放在 `updateGameVictoryModal` 定義附近）：

```js
  // ---- 遺物記憶：隊伍共通的獲得事件（2026-09-24，設計文件§3.1；fix round 1改用單一子節點）----
  // meta/relicMemoryGrants/<key> 以 transaction first-writer-wins 追加（每個 key 只會寫一次）；
  // 每台裝置只替自己的角色擲大小與效果，寫進 character/<token>/relicMemory.earned，並在
  // character/<token>/relicMemory.seen 標記已處理。relicMemoryGrantAttempted 只是本地節流。
  var relicMemoryGrantAttempted = {};
  var relicMemoryProcessing = false;

  function countClearedTiles() {
    return Object.keys(fieldProgress || {}).filter(function (pid) {
      return fieldProgress[pid] && fieldProgress[pid].cleared === true;
    }).length;
  }

  function countKilledStrongEnemies() {
    return (map && map.points ? map.points : []).filter(function (pt) {
      if (pt.type !== "strong_enemy") return false;
      var trig = fieldTriggers[pt.id];
      var hp = fieldEnemyHp[pt.id];
      return !!trig && trig.status === "resolved" && hp !== undefined && hp <= 0;
    }).length;
  }

  function tryAppendRelicMemoryGrant(key, kind) {
    if (relicMemoryGrantAttempted[key]) return;
    if (meta.relicMemoryGrants && meta.relicMemoryGrants[key]) return;
    relicMemoryGrantAttempted[key] = true;
    GameStorage.rtTransaction(gameId, "cloud", "meta/relicMemoryGrants/" + key, function (cur) {
      return cur === null ? { kind: kind, at: Date.now() } : cur;
    });
  }

  function updateRelicMemoryGrants() {
    var RM = window.PriTestMidnightRelicMemory;
    if (!RM || !meta || !meta.sessionStartAt || battleSimEnabled()) return;
    RM.milestoneGrantKeys(countClearedTiles(), countKilledStrongEnemies()).forEach(function (key) {
      tryAppendRelicMemoryGrant(key, RM.grantKindOfKey(key));
    });
    if (finalCircleBossDefeated(1)) tryAppendRelicMemoryGrant("day1", "day1");
    if (finalCircleBossDefeated(2)) tryAppendRelicMemoryGrant("day2", "day2");
    if (day3BossDefeated()) tryAppendRelicMemoryGrant("boss", "boss");
    processMyRelicMemoryGrants();
  }

  function processMyRelicMemoryGrants() {
    var RM = window.PriTestMidnightRelicMemory;
    var c = myTokenId ? characters[myTokenId] : null;
    if (!RM || !c || !mySlot || relicMemoryProcessing) return;
    var grants = meta.relicMemoryGrants || {};
    var seen = (c.relicMemory && c.relicMemory.seen) || {};
    var pending = Object.keys(grants).filter(function (k) {
      return !seen[k];
    });
    if (!pending.length) return;
    relicMemoryProcessing = true;
    var effectIds = window.PriTestCharacterDrawer.allAttachedEffectIds();
    GameStorage.rtTransaction(gameId, "cloud", "character/" + myTokenId + "/relicMemory", function (cur) {
      var s = (cur && cur.seen) || {};
      var earned = (cur && cur.earned) || [];
      earned = earned.slice();
      Object.keys(grants).forEach(function (k) {
        if (s[k]) return;
        s[k] = true;
        RM.grantSizes(grants[k].kind, Math.random).forEach(function (size) {
          earned.push(RM.newMemory(size, effectIds, grants[k].kind, Math.random, Date.now()));
        });
      });
      return { earned: earned, seen: s };
    }).then(function (after) {
      relicMemoryProcessing = false;
      if (after) showToast(window.I18N.t("midnight_relic_memory_gained_toast"));
    });
  }
```

**fix round 1（2026-09-24 review，取代上面這段原本的說明）**：原本這裡讓 `processMyRelicMemoryGrants()`
對整個 `character/<token>` 做 transaction，理由是「分兩個子路徑各自 transaction 會有 seen 已寫但
earned 沒寫的不一致」。但 review 在 emulator 上重現出：`character/<token>` 底下還有 consumables／
`_artCooldownUntil` 等其他子路徑，戰鬥中每秒都有好幾筆一般 `rtSet()` 在寫；當這些 `set()` 跟
`transaction()` 同時作用在同一個節點時，Firebase SDK 會丟出 `Error: set`、transaction 直接失敗
（下一影格重試，戰鬥密集時可能長時間吃不到，偏偏這正是強敵／夜王擊殺這類 grant 最常觸發的時候）。
修法：改成只對 `character/<token>/relicMemory` 這一個專屬子節點做 transaction（`earned`／`seen`
仍然綁在同一次 transaction 裡更新，維持原子性，只是範圍縮小到不會再跟其他子路徑寫入互撞）。
`LOCAL_ONLY_CHARACTER_FIELD_RE` 的 `_` 開頭本地欄位不在 RTDB 上，不受影響。

在 `frameInner()` 的 `updateGameVictoryModal();` 之後加：

```js
    updateRelicMemoryGrants(); // 2026-09-24遺物記憶：隊伍共通獲得事件
```

(d) `handleRestartCycle()` 末尾加：

```js
    // 遺物記憶：meta 整個覆寫已清掉 relicMemoryGrants；角色上的獲得紀錄也一併重置
    // （重新開始一輪＝重新累積，開局小×1 重新發）。只有寫 players 內各席位的 token。
    relicMemoryGrantAttempted = {};
    occupiedSlots().forEach(function (slot) {
      var tok = players[slot] && players[slot].tokenId;
      if (!tok) return;
      var RM = window.PriTestMidnightRelicMemory;
      var start = RM && !battleSimEnabled() ? [RM.newMemory("s", window.PriTestCharacterDrawer.allAttachedEffectIds(), "start", Math.random, Date.now())] : [];
      GameStorage.rtSet(gameId, "cloud", "character/" + tok + "/relicMemory", { earned: start, seen: null });
    });
```

（fix round 1：兩個 `rtSet` 改成一個，寫到單一子節點 `character/<tok>/relicMemory`；`seen: null`
在寫入時會被 RTDB 省略掉這個鍵，效果等同重設成空物件，讀回來時 `processMyRelicMemoryGrants()` 的
`(cur && cur.seen) || {}` 會正確落到 `{}`。）

（先 `grep -n "function occupiedSlots" static_src/midnight.js` 確認存在；players 席位上的 token 欄位名以 `players[slot].tokenId` 為準，先 grep 確認。）

(e) `window.PriTestMidnight` 加：

```js
    // 純測試用：遺物記憶目前狀態（見relic_memory_emulator_check.js）。
    _debugRelicMemory: function () {
      var c = myTokenId ? characters[myTokenId] : null;
      return {
        earned: (c && c.relicMemory && c.relicMemory.earned) || [],
        seen: (c && c.relicMemory && c.relicMemory.seen) || {},
        loadout: (c && c.relicMemoryLoadout) || [],
        grants: (meta && meta.relicMemoryGrants) || {},
      };
    },
```

(f) i18n 三檔加：

| key | zh | ja | en |
| --- | --- | --- | --- |
| `midnight_relic_memory_gained_toast` | 獲得了遺物記憶 | 遺物の記憶を獲得した | Obtained a Relic Memory |

- [ ] **Step 4：執行確認通過**

Run: `node --check static_src/midnight.js && python generate.py && cd tools/midnight_check && node relic_memory_emulator_check.js`
Expected: 儲存段＋獲得段全部 PASS

- [ ] **Step 5：commit**

```bash
git add static_src/midnight.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py tools/midnight_check/relic_memory_emulator_check.js
git commit -m "feat(midnight): 遺物記憶的遊戲中獲得（開局／里程碑／夜之強敵／夜王）"
```

---

### Task 5：等待房選擇帶入＋角色視窗「遺物記憶」列

**Files:**
- Modify: `site_src/midnight_page.py`（`#midnight-lobby-ready-row` 之後加面板；角色視窗消耗品 section 之後加一列）
- Modify: `static_src/midnight.js`（等待房面板邏輯、`renderLobby()` 呼叫、`renderCharacterSheet()`、`renderCharacterSheetDetail()`、初始化時綁定事件）
- Modify: `static_src/style.css`
- Modify: `site_src/i18n_data_{zh,ja,en}.py`
- Modify: `tools/midnight_check/relic_memory_emulator_check.js`

**Interfaces:**
- Consumes：`GameStorage.relicMemoryRead/relicMemorySet`、`RM.sortedMemories/isValidCode/normalizeCode/MAX_LOADOUT`。
- Produces：RTDB `players/<slot>/relicMemoryLoadout: Array<{memId,size,effects}>`；角色視窗 selection kind `"relicMemory"`（ref＝memId）；共用 helper `relicMemorySummaryText(mem) → string`、`renderRelicMemoryEffectDetail(container, mem)`（Task 6 結算視窗也用）。

- [ ] **Step 1：寫失敗的檢查段**

```js
async function loadoutSection(browser) {
  console.log("=== 等待房帶入 ＋ 角色視窗 ===");
  await adminPut("relicMemories/" + TEST_CODE, {
    m000000000000000a: { memId: "m000000000000000a", size: "m", effects: ["max_hp_up", "arts_dmg"], createdAt: 1, favorite: false, source: "tiles" },
    m000000000000000b: { memId: "m000000000000000b", size: "s", effects: ["attack_dmg"], createdAt: 2, favorite: false, source: "start" },
  });
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  await enableEmulatorFlag(pageA);
  await enableEmulatorFlag(pageB);
  await createAndStart(pageA, pageB, async () => {
    await pageA.fill("#midnight-lobby-relic-memory-code-input", TEST_CODE.toLowerCase());
    await pageA.dispatchEvent("#btn-midnight-lobby-relic-memory-load", "click");
    await pageA.waitForSelector("#midnight-lobby-relic-memory-list input[type=checkbox]", { timeout: 8000 });
    const boxes = await pageA.$$("#midnight-lobby-relic-memory-list input[type=checkbox]");
    assert(boxes.length === 2, "讀取後列出 2 個記憶");
    await pageA.dispatchEvent('#midnight-lobby-relic-memory-list input[data-mem-id="m000000000000000a"]', "click");
    await pageA.waitForFunction(() => {
      const d = window.PriTestMidnight._debugState();
      const p = d.players[d.mySlot];
      return p && p.relicMemoryLoadout && p.relicMemoryLoadout.length === 1;
    }, { timeout: 5000 });
  });
  const r = await pageA.evaluate(() => {
    const d = window.PriTestMidnight._debugState();
    const c = d.characters[d.myTokenId];
    return {
      loadout: window.PriTestMidnight._debugRelicMemory().loadout,
      hpBonus: window.PriTestCharacterDrawer.attachedFlatMaxStatBonus
        ? window.PriTestCharacterDrawer.attachedFlatMaxStatBonus(c, "hp")
        : window.PriTestCharacterDrawer.totalFlatMaxStatBonus(c, "hp"),
      art: window.PriTestCharacterDrawer.attachedSkillDamageBonus(c, "art"),
    };
  });
  assert(r.loadout.length === 1 && r.loadout[0].memId === "m000000000000000a", "開局後角色帶入選定記憶");
  assert(r.art === 5, "帶入效果生效（戰技+5）");
  await pageA.dispatchEvent("#btn-midnight-open-character-sheet", "click");
  await pageA.waitForSelector("#midnight-character-sheet-relic-memories button", { timeout: 5000 });
  await pageA.dispatchEvent("#midnight-character-sheet-relic-memories button", "click");
  const detail = await pageA.textContent("#midnight-character-sheet-detail");
  assert(detail.indexOf("HP") !== -1 || detail.length > 10, "角色視窗點選記憶 → 右側顯示效果");
  await pageA.close();
  await pageB.close();
}
```

主流程在 `grantSection` 之後加 `await loadoutSection(browser);`。

- [ ] **Step 2：執行確認失敗**

Expected: FAIL（找不到 `#midnight-lobby-relic-memory-code-input`）

- [ ] **Step 3：實作**

(a) `midnight_page.py`，在 `#midnight-lobby-ready-row` 的 `</div>` 之後：

```html
        <!-- 遺物記憶（2026-09-24，設計文件§6.3）：只在自己有席位、尚未開局時顯示。
             密碼只存在本地localStorage（便利用），選擇結果寫players/<slot>/relicMemoryLoadout，
             開局時由newCharacterForSlot()複製到角色上。見static/midnight.jsの
             renderLobbyRelicMemoryPanel()。 -->
        <div id="midnight-lobby-relic-memory" hidden>
          <h4 data-i18n="midnight_relic_memory_title"></h4>
          <div class="wb-row">
            <input type="text" id="midnight-lobby-relic-memory-code-input" maxlength="5" autocomplete="off">
            <button type="button" id="btn-midnight-lobby-relic-memory-load" data-i18n="midnight_relic_memory_load_button"></button>
            <button type="button" id="btn-midnight-lobby-relic-memory-edit" data-i18n="midnight_relic_memory_edit_button" hidden></button>
          </div>
          <p id="midnight-lobby-relic-memory-status" class="threat-ref-body"></p>
          <div id="midnight-lobby-relic-memory-list"></div>
        </div>
```

角色視窗，在消耗品 section 之後：

```html
                <div class="midnight-sheet-section" id="midnight-character-sheet-relic-memory-section" hidden>
                  <h4 data-i18n="midnight_relic_memory_title"></h4>
                  <div id="midnight-character-sheet-relic-memories" class="midnight-sheet-slots"></div>
                </div>
```

(b) `midnight.js` 共用顯示 helper（放在結算／等待房區塊之前）：

```js
  // ---- 遺物記憶的顯示helper（等待房／角色視窗／結算視窗共用）----
  function relicMemorySizeLabel(size) {
    return window.I18N.t("midnight_relic_memory_size_" + size);
  }

  function relicMemorySummaryText(mem) {
    var CD = window.PriTestCharacterDrawer;
    var CT = window.PriTestCharacterTypes;
    var names = (mem.effects || []).map(function (id) {
      var e = CD.attachedEffectById(id);
      return e ? CT.localizedText(e.name) : id;
    });
    return relicMemorySizeLabel(mem.size) + "｜" + names.join("／");
  }

  function renderRelicMemoryEffectDetail(container, mem) {
    var CD = window.PriTestCharacterDrawer;
    var CT = window.PriTestCharacterTypes;
    var head = document.createElement("h4");
    head.textContent = window.I18N.t("midnight_relic_memory_title") + "（" + relicMemorySizeLabel(mem.size) + "）";
    container.appendChild(head);
    (mem.effects || []).forEach(function (id) {
      var e = CD.attachedEffectById(id);
      if (!e) return;
      var name = CT.localizedText(e.name);
      var p = document.createElement("p");
      p.textContent = name + "：" + mnText(CT.localizedText(e.body), name);
      container.appendChild(p);
    });
  }
```

(c) 等待房面板：

```js
  // ---- 遺物記憶：等待房面板（2026-09-24，設計文件§6.3）----
  var RELIC_MEMORY_CODE_STORAGE_KEY = "pritest-midnight-relic-memory-code";
  var lobbyRelicMemoryStore = null; // 讀取成功後的 relicMemories/<CODE> 快照
  var lobbyRelicMemoryCode = null;
  var lobbyRelicMemoryEditMode = false;

  function renderLobbyRelicMemoryPanel() {
    var panel = el("midnight-lobby-relic-memory");
    if (!panel) return;
    panel.hidden = !mySlot || !!(meta && meta.sessionStartAt);
    if (panel.hidden) return;
    var input = el("midnight-lobby-relic-memory-code-input");
    if (!input.value && !lobbyRelicMemoryCode) {
      try {
        input.value = window.localStorage.getItem(RELIC_MEMORY_CODE_STORAGE_KEY) || "";
      } catch (e) {}
    }
    el("btn-midnight-lobby-relic-memory-edit").hidden = !lobbyRelicMemoryStore;
    el("btn-midnight-lobby-relic-memory-edit").textContent = window.I18N.t(
      lobbyRelicMemoryEditMode ? "midnight_relic_memory_edit_done_button" : "midnight_relic_memory_edit_button"
    );
    renderLobbyRelicMemoryList();
  }

  function myLobbyLoadout() {
    var p = mySlot ? players[mySlot] : null;
    return (p && p.relicMemoryLoadout) || [];
  }

  function renderLobbyRelicMemoryList() {
    var RM = window.PriTestMidnightRelicMemory;
    var list = el("midnight-lobby-relic-memory-list");
    list.innerHTML = "";
    if (!lobbyRelicMemoryStore) return;
    var chosen = {};
    myLobbyLoadout().forEach(function (m) {
      chosen[m.memId] = true;
    });
    var chosenCount = Object.keys(chosen).length;
    RM.sortedMemories(lobbyRelicMemoryStore).forEach(function (mem) {
      var row = document.createElement("label");
      row.className = "midnight-relic-memory-row";
      var box = document.createElement("input");
      box.type = "checkbox";
      box.setAttribute("data-mem-id", mem.memId);
      box.checked = !!chosen[mem.memId];
      box.disabled = !box.checked && chosenCount >= RM.MAX_LOADOUT;
      box.addEventListener("click", function () {
        toggleLobbyRelicMemory(mem);
      });
      row.appendChild(box);
      var text = document.createElement("span");
      text.textContent = (mem.favorite ? "★ " : "") + relicMemorySummaryText(mem);
      row.appendChild(text);
      if (lobbyRelicMemoryEditMode) {
        var favBtn = document.createElement("button");
        favBtn.type = "button";
        favBtn.className = "midnight-relic-memory-fav";
        favBtn.textContent = mem.favorite ? "★" : "☆";
        favBtn.addEventListener("click", function (ev) {
          ev.preventDefault();
          updateStoredRelicMemory(mem.memId, Object.assign({}, mem, { favorite: !mem.favorite }));
        });
        row.appendChild(favBtn);
        var delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "danger-btn midnight-relic-memory-del";
        delBtn.textContent = window.I18N.t("midnight_relic_memory_delete_button");
        delBtn.addEventListener("click", function (ev) {
          ev.preventDefault();
          if (chosen[mem.memId]) toggleLobbyRelicMemory(mem);
          updateStoredRelicMemory(mem.memId, null);
        });
        row.appendChild(delBtn);
      }
      list.appendChild(row);
    });
  }
```

（`Object.assign` 是 ES2015；本專案 ES5 風格，改用手動複製：`var copy = {}; Object.keys(mem).forEach(function (k) { copy[k] = mem[k]; }); copy.favorite = !mem.favorite;`。實作時採這個寫法。）

```js
  function toggleLobbyRelicMemory(mem) {
    if (!mySlot) return;
    var RM = window.PriTestMidnightRelicMemory;
    var cur = myLobbyLoadout().slice();
    var idx = -1;
    cur.forEach(function (m, i) {
      if (m.memId === mem.memId) idx = i;
    });
    if (idx !== -1) cur.splice(idx, 1);
    else if (cur.length < RM.MAX_LOADOUT) cur.push({ memId: mem.memId, size: mem.size, effects: mem.effects.slice() });
    GameStorage.rtSet(gameId, "cloud", "players/" + mySlot + "/relicMemoryLoadout", cur.length ? cur : null);
  }

  function updateStoredRelicMemory(memId, value) {
    if (!lobbyRelicMemoryCode) return;
    GameStorage.relicMemorySet(lobbyRelicMemoryCode, memId, value).then(function (res) {
      if (!res.ok) {
        el("midnight-lobby-relic-memory-status").textContent = window.I18N.t("midnight_relic_memory_error_" + res.error);
        return;
      }
      if (value === null) delete lobbyRelicMemoryStore[memId];
      else lobbyRelicMemoryStore[memId] = value;
      renderLobbyRelicMemoryList();
    });
  }

  function handleLobbyRelicMemoryLoad() {
    var RM = window.PriTestMidnightRelicMemory;
    var code = RM.normalizeCode(el("midnight-lobby-relic-memory-code-input").value);
    var status = el("midnight-lobby-relic-memory-status");
    if (!RM.isValidCode(code)) {
      status.textContent = window.I18N.t("midnight_relic_memory_error_format");
      return;
    }
    status.textContent = window.I18N.t("midnight_relic_memory_loading");
    GameStorage.relicMemoryRead(code).then(function (res) {
      if (!res.ok) {
        status.textContent = window.I18N.t("midnight_relic_memory_error_" + res.error);
        lobbyRelicMemoryStore = null;
        renderLobbyRelicMemoryPanel();
        return;
      }
      lobbyRelicMemoryCode = code;
      lobbyRelicMemoryStore = res.value || {};
      try {
        window.localStorage.setItem(RELIC_MEMORY_CODE_STORAGE_KEY, code);
      } catch (e) {}
      status.textContent = window.I18N.t("midnight_relic_memory_loaded", {
        count: Object.keys(lobbyRelicMemoryStore).length,
        max: RM.MAX_LOADOUT,
      });
      renderLobbyRelicMemoryPanel();
    });
  }

  function handleLobbyRelicMemoryEditToggle() {
    lobbyRelicMemoryEditMode = !lobbyRelicMemoryEditMode;
    renderLobbyRelicMemoryPanel();
  }
```

`renderLobby()` 的結尾呼叫 `renderLobbyRelicMemoryPanel();`。事件綁定放在既有 `btn-midnight-lobby-ready` 綁定附近：

```js
      el("btn-midnight-lobby-relic-memory-load").addEventListener("click", handleLobbyRelicMemoryLoad);
      el("btn-midnight-lobby-relic-memory-edit").addEventListener("click", handleLobbyRelicMemoryEditToggle);
```

(d) 角色視窗：`renderCharacterSheet()` 的消耗品 `renderInventorySlots(...)` 之後：

```js
    // 遺物記憶（2026-09-24，設計文件§6.1）：只顯示帶入中的記憶，沒有帶入時整列隱藏。
    var memSection = el("midnight-character-sheet-relic-memory-section");
    var memBox = el("midnight-character-sheet-relic-memories");
    var loadout = c.relicMemoryLoadout || [];
    memSection.hidden = loadout.length === 0;
    memBox.innerHTML = "";
    loadout.forEach(function (mem) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = relicMemorySizeLabel(mem.size);
      if (characterSheetSelection && characterSheetSelection.kind === "relicMemory" && characterSheetSelection.ref === mem.memId) {
        btn.classList.add("midnight-sheet-slot-selected");
      }
      btn.addEventListener("click", function () {
        selectCharacterSheetItem("relicMemory", mem.memId);
      });
      memBox.appendChild(btn);
    });
```

`renderCharacterSheetDetail()` 在 `sel.kind === "attached"` 分支之後加：

```js
    } else if (sel.kind === "relicMemory") {
      var mem = (c.relicMemoryLoadout || []).filter(function (m) {
        return m.memId === sel.ref;
      })[0];
      if (!mem) return;
      renderRelicMemoryEffectDetail(detail, mem);
```

(e) CSS（`style.css` 末尾）：

```css
/* 遺物記憶（2026-09-24） */
#midnight-lobby-relic-memory { margin-top: 12px; }
#midnight-lobby-relic-memory-code-input { width: 7em; text-transform: uppercase; letter-spacing: 0.15em; }
#midnight-lobby-relic-memory-list { max-height: 40vh; overflow-y: auto; }
.midnight-relic-memory-row { display: flex; align-items: center; gap: 6px; padding: 4px 0; }
.midnight-relic-memory-row span { flex: 1; }
.midnight-relic-memory-fav, .midnight-relic-memory-del { flex: none; }
```

(f) i18n 三檔：

| key | zh | ja | en |
| --- | --- | --- | --- |
| `midnight_relic_memory_title` | 遺物記憶 | 遺物の記憶 | Relic Memory |
| `midnight_relic_memory_size_s` | 小 | 小 | Small |
| `midnight_relic_memory_size_m` | 中 | 中 | Medium |
| `midnight_relic_memory_size_l` | 大 | 大 | Large |
| `midnight_relic_memory_load_button` | 讀取記憶 | 記憶を読み込む | Load |
| `midnight_relic_memory_edit_button` | 編輯模式 | 編集モード | Edit |
| `midnight_relic_memory_edit_done_button` | 完成編輯 | 編集を終える | Done |
| `midnight_relic_memory_delete_button` | 刪除 | 削除 | Delete |
| `midnight_relic_memory_loading` | 讀取中… | 読み込み中… | Loading… |
| `midnight_relic_memory_loaded` | 共 {count} 個記憶，最多可帶入 {max} 個 | 記憶 {count} 件（最大 {max} 件まで持ち込み可） | {count} memories (bring up to {max}) |
| `midnight_relic_memory_error_format` | 記憶密碼為 5 位大寫英數字 | 記憶パスワードは英大文字・数字 5 桁です | The code must be 5 uppercase letters/digits |
| `midnight_relic_memory_error_denied` | 此記憶密碼無效 | この記憶パスワードは無効です | Invalid code |
| `midnight_relic_memory_error_network` | 連線失敗，請稍後再試 | 通信に失敗しました。時間をおいて再試行してください | Connection failed, please retry |

- [ ] **Step 4：執行確認通過**

Run: `node --check static_src/midnight.js && python generate.py && cd tools/midnight_check && node relic_memory_emulator_check.js`
Expected: 前段＋帶入段全部 PASS

- [ ] **Step 5：commit**

```bash
git add static_src/midnight.js static_src/style.css site_src/midnight_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py tools/midnight_check/relic_memory_emulator_check.js
git commit -m "feat(midnight): 等待房選擇遺物記憶帶入＋角色視窗遺物記憶列"
```

---

### Task 6：放棄遊戲投票＋結算視窗（保存）

**Files:**
- Modify: `site_src/midnight_page.py`（HUD 放棄按鈕、失敗彈窗放棄按鈕、投票彈窗、結算彈窗）
- Modify: `static_src/midnight.js`（`handleGameVictoryConfirmClick()`、投票邏輯、結算邏輯、`frameInner()`、事件綁定）
- Modify: `static_src/style.css`
- Modify: `site_src/i18n_data_{zh,ja,en}.py`
- Modify: `tools/midnight_check/relic_memory_emulator_check.js`

**Interfaces:**
- Consumes：`relicMemorySummaryText`（Task 5）、`GameStorage.relicMemoryTransaction`（Task 3）、`RM.mergeIntoStore/MAX_STORED`（Task 1）、`occupiedSlots()`（既有）。
- Produces：RTDB `meta/abandonVote: { proposedBy: <slot>, at, votes: { <slot>: true|false } }`、`meta/gameAbandonedAt: number`。

- [ ] **Step 1：寫失敗的檢查段**

```js
async function abandonSection(browser) {
  console.log("=== 放棄投票 ＋ 結算保存 ===");
  await adminPut("relicMemories/" + TEST_CODE, null);
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  await enableEmulatorFlag(pageA);
  await enableEmulatorFlag(pageB);
  await createAndStart(pageA, pageB);

  // 反對 → 取消
  await pageA.dispatchEvent("#btn-midnight-hud-abandon", "click");
  await pageA.dispatchEvent("#btn-midnight-abandon-confirm-yes", "click");
  await pageB.waitForSelector("#midnight-abandon-vote-modal:not([hidden])", { timeout: 8000 });
  await pageB.dispatchEvent("#btn-midnight-abandon-vote-no", "click");
  await pageA.waitForFunction(() => !window.PriTestMidnight._debugState().meta.abandonVote, { timeout: 8000 });
  assert(!(await pageA.evaluate(() => window.PriTestMidnight._debugState().meta.gameAbandonedAt)), "有人反對 → 投票取消、遊戲繼續");

  // 全員同意 → 結算
  await pageA.dispatchEvent("#btn-midnight-hud-abandon", "click");
  await pageA.dispatchEvent("#btn-midnight-abandon-confirm-yes", "click");
  await pageB.waitForSelector("#midnight-abandon-vote-modal:not([hidden])", { timeout: 8000 });
  await pageB.dispatchEvent("#btn-midnight-abandon-vote-yes", "click");
  for (const p of [pageA, pageB]) {
    await p.waitForSelector("#midnight-relic-memory-settle-modal:not([hidden])", { timeout: 8000 });
  }
  const rows = await pageA.$$("#midnight-relic-memory-settle-list li");
  assert(rows.length >= 1, "結算視窗列出本局獲得（至少開局小×1）");

  await pageA.fill("#midnight-relic-memory-settle-code-input", TEST_CODE);
  await pageA.dispatchEvent("#btn-midnight-relic-memory-settle-save", "click");
  await pageA.waitForFunction(() => document.getElementById("btn-midnight-relic-memory-settle-save").disabled, { timeout: 8000 });
  const stored = await pageA.evaluate((code) => window.PriTestGameStorage.relicMemoryRead(code), TEST_CODE);
  assert(stored.ok && Object.keys(stored.value || {}).length === rows.length, "保存後 Firebase 件數＝本局獲得件數");

  await pageB.fill("#midnight-relic-memory-settle-code-input", "ZZZZZ");
  await pageB.dispatchEvent("#btn-midnight-relic-memory-settle-save", "click");
  await pageB.waitForFunction(() => document.getElementById("midnight-relic-memory-settle-status").textContent.length > 0, { timeout: 8000 });
  assert(!(await pageB.evaluate(() => document.getElementById("btn-midnight-relic-memory-settle-save").disabled)), "無效密碼 → 顯示錯誤、可再試");
  await pageA.close();
  await pageB.close();
}
```

主流程在 `loadoutSection` 之後加 `await abandonSection(browser);`。

- [ ] **Step 2：執行確認失敗**

Expected: FAIL（找不到 `#btn-midnight-hud-abandon`）

- [ ] **Step 3：實作**

(a) HTML。HUD 的 `#btn-midnight-restart-cycle` 後：

```html
            <!-- 放棄遊戲（2026-09-24，遺物記憶設計文件§5）：全員同意制，見
                 static/midnight.jsのhandleAbandonProposeClick()。 -->
            <button type="button" id="btn-midnight-hud-abandon" class="danger-btn" data-i18n="midnight_abandon_button"></button>
```

失敗彈窗 `#btn-midnight-game-failure-confirm` 後：

```html
            <button type="button" id="btn-midnight-game-failure-abandon" class="danger-btn" data-i18n="midnight_abandon_button"></button>
```

勝利彈窗之後新增三個彈窗：

```html
        <!-- 放棄遊戲：提案前的本地確認 -->
        <div id="midnight-abandon-confirm-modal" hidden>
          <div class="midnight-relic-memory-box">
            <p data-i18n="midnight_abandon_confirm_body"></p>
            <div class="wb-row">
              <button type="button" id="btn-midnight-abandon-confirm-yes" class="danger-btn" data-i18n="midnight_abandon_confirm_yes"></button>
              <button type="button" id="btn-midnight-abandon-confirm-no" data-i18n="midnight_abandon_confirm_no"></button>
            </div>
          </div>
        </div>
        <!-- 放棄遊戲：全員投票（meta.abandonVote存在且自己尚未投票時顯示） -->
        <div id="midnight-abandon-vote-modal" hidden>
          <div class="midnight-relic-memory-box">
            <p id="midnight-abandon-vote-text"></p>
            <p id="midnight-abandon-vote-progress" class="threat-ref-body"></p>
            <div class="wb-row">
              <button type="button" id="btn-midnight-abandon-vote-yes" class="danger-btn" data-i18n="midnight_abandon_vote_yes"></button>
              <button type="button" id="btn-midnight-abandon-vote-no" data-i18n="midnight_abandon_vote_no"></button>
            </div>
          </div>
        </div>
        <!-- 遺物記憶結算（設計文件§6.2）：勝利彈窗確認後或meta.gameAbandonedAt成立時顯示 -->
        <div id="midnight-relic-memory-settle-modal" hidden>
          <div class="midnight-relic-memory-box">
            <h3 data-i18n="midnight_relic_memory_settle_title"></h3>
            <ul id="midnight-relic-memory-settle-list"></ul>
            <div class="wb-row">
              <input type="text" id="midnight-relic-memory-settle-code-input" maxlength="5" autocomplete="off">
              <button type="button" id="btn-midnight-relic-memory-settle-save" data-i18n="midnight_relic_memory_save_button"></button>
            </div>
            <p id="midnight-relic-memory-settle-status" class="threat-ref-body"></p>
            <button type="button" id="btn-midnight-relic-memory-settle-close" data-i18n="midnight_relic_memory_settle_close_button"></button>
          </div>
        </div>
```

(b) JS：

```js
  // ---- 放棄遊戲（2026-09-24，遺物記憶設計文件§5）：全員同意制 ----
  // 提案者寫 meta/abandonVote（transaction，已有進行中的投票就不覆蓋）並自動投同意；
  // 每位已佔用席位的玩家看到投票彈窗。全員同意 → 任一裝置 transaction 寫 meta/gameAbandonedAt；
  // 任一人反對 → 清除 abandonVote。判定每影格由 updateAbandonVote() 做。
  function handleAbandonProposeClick() {
    el("midnight-abandon-confirm-modal").hidden = false;
  }

  function handleAbandonConfirmNo() {
    el("midnight-abandon-confirm-modal").hidden = true;
  }

  function handleAbandonConfirmYes() {
    el("midnight-abandon-confirm-modal").hidden = true;
    if (!mySlot) return;
    var slot = mySlot;
    GameStorage.rtTransaction(gameId, "cloud", "meta/abandonVote", function (cur) {
      if (cur) return cur;
      var votes = {};
      votes[slot] = true;
      return { proposedBy: slot, at: Date.now(), votes: votes };
    });
  }

  function castAbandonVote(agree) {
    if (!mySlot) return;
    GameStorage.rtSet(gameId, "cloud", "meta/abandonVote/votes/" + mySlot, agree);
  }

  var abandonFinalizeAttempted = false;
  function updateAbandonVote() {
    var modal = el("midnight-abandon-vote-modal");
    var vote = meta && meta.abandonVote;
    if (!vote || meta.gameAbandonedAt) {
      modal.hidden = true;
      abandonFinalizeAttempted = false;
      return;
    }
    var votes = vote.votes || {};
    var slots = occupiedSlots();
    var anyNo = slots.some(function (s) {
      return votes[s] === false;
    });
    if (anyNo) {
      GameStorage.rtTransaction(gameId, "cloud", "meta/abandonVote", function (cur) {
        return cur && cur.at === vote.at ? null : cur;
      });
      modal.hidden = true;
      return;
    }
    var yesCount = slots.filter(function (s) {
      return votes[s] === true;
    }).length;
    if (slots.length > 0 && yesCount === slots.length && !abandonFinalizeAttempted) {
      abandonFinalizeAttempted = true;
      GameStorage.rtTransaction(gameId, "cloud", "meta/gameAbandonedAt", function (cur) {
        return cur === null ? Date.now() : cur;
      });
    }
    modal.hidden = !mySlot || votes[mySlot] !== undefined;
    var proposer = players[vote.proposedBy];
    el("midnight-abandon-vote-text").textContent = window.I18N.t("midnight_abandon_vote_text", {
      name: proposer ? proposer.name : vote.proposedBy,
    });
    el("midnight-abandon-vote-progress").textContent = window.I18N.t("midnight_abandon_vote_progress", {
      yes: yesCount,
      total: slots.length,
    });
  }
```

結算：

```js
  // ---- 遺物記憶結算（2026-09-24，設計文件§6.2）----
  var relicMemorySettleOpen = false; // 本地：已開過就不再自動開（關閉後不重開）
  var relicMemorySettleDismissed = false;
  var relicMemorySettleSaved = false;

  function openRelicMemorySettle() {
    if (relicMemorySettleOpen || relicMemorySettleDismissed || !mySlot) return;
    relicMemorySettleOpen = true;
    var c = characters[myTokenId];
    var list = el("midnight-relic-memory-settle-list");
    list.innerHTML = "";
    ((c && c.relicMemory && c.relicMemory.earned) || []).forEach(function (mem) {
      var li = document.createElement("li");
      li.textContent = relicMemorySummaryText(mem);
      list.appendChild(li);
    });
    var input = el("midnight-relic-memory-settle-code-input");
    try {
      if (!input.value) input.value = window.localStorage.getItem(RELIC_MEMORY_CODE_STORAGE_KEY) || "";
    } catch (e) {}
    el("midnight-relic-memory-settle-status").textContent = "";
    el("btn-midnight-relic-memory-settle-save").disabled = relicMemorySettleSaved || !list.children.length;
    el("midnight-relic-memory-settle-modal").hidden = false;
  }

  function handleRelicMemorySettleSave() {
    var RM = window.PriTestMidnightRelicMemory;
    var status = el("midnight-relic-memory-settle-status");
    var btn = el("btn-midnight-relic-memory-settle-save");
    var code = RM.normalizeCode(el("midnight-relic-memory-settle-code-input").value);
    if (!RM.isValidCode(code)) {
      status.textContent = window.I18N.t("midnight_relic_memory_error_format");
      return;
    }
    var c = characters[myTokenId];
    var earned = (c && c.relicMemory && c.relicMemory.earned) || []; // fix round 1：欄位改在c.relicMemory子節點下
    if (!earned.length) return;
    btn.disabled = true;
    status.textContent = window.I18N.t("midnight_relic_memory_saving");
    var summary = null;
    GameStorage.relicMemoryTransaction(code, function (cur) {
      summary = RM.mergeIntoStore(cur, earned, RM.MAX_STORED);
      return summary.store;
    }).then(function (res) {
      if (!res.ok) {
        btn.disabled = false;
        status.textContent = window.I18N.t("midnight_relic_memory_error_" + (res.error || "network"));
        return;
      }
      relicMemorySettleSaved = true;
      try {
        window.localStorage.setItem(RELIC_MEMORY_CODE_STORAGE_KEY, code);
      } catch (e) {}
      status.textContent = window.I18N.t("midnight_relic_memory_saved", {
        added: summary.added,
        discarded: summary.discarded,
        rejected: summary.rejected,
      });
    });
  }

  function handleRelicMemorySettleClose() {
    el("midnight-relic-memory-settle-modal").hidden = true;
    relicMemorySettleOpen = false;
    relicMemorySettleDismissed = true;
    // 放棄遊戲後關閉＝離開這場遊戲，回到midnight起始畫面（不帶?game=）。
    if (meta && meta.gameAbandonedAt) window.location.href = window.location.pathname;
  }

  function updateRelicMemorySettle() {
    if (meta && meta.gameAbandonedAt) openRelicMemorySettle();
  }
```

`handleGameVictoryConfirmClick()` 末尾加 `openRelicMemorySettle();`。

`frameInner()` 在 `updateRelicMemoryGrants();` 之後加：

```js
    updateAbandonVote();
    updateRelicMemorySettle();
```

事件綁定（放在 `btn-midnight-game-victory-confirm` 綁定旁）：

```js
    el("btn-midnight-hud-abandon").addEventListener("click", handleAbandonProposeClick);
    el("btn-midnight-game-failure-abandon").addEventListener("click", handleAbandonProposeClick);
    el("btn-midnight-abandon-confirm-yes").addEventListener("click", handleAbandonConfirmYes);
    el("btn-midnight-abandon-confirm-no").addEventListener("click", handleAbandonConfirmNo);
    el("btn-midnight-abandon-vote-yes").addEventListener("click", function () { castAbandonVote(true); });
    el("btn-midnight-abandon-vote-no").addEventListener("click", function () { castAbandonVote(false); });
    el("btn-midnight-relic-memory-settle-save").addEventListener("click", handleRelicMemorySettleSave);
    el("btn-midnight-relic-memory-settle-close").addEventListener("click", handleRelicMemorySettleClose);
```

`handleRestartCycle()` 已經整個覆寫 meta（abandonVote／gameAbandonedAt 隨之清除）；另在末尾加 `relicMemorySettleOpen = false; relicMemorySettleDismissed = false; relicMemorySettleSaved = false;`。

戰鬥模擬房也有 HUD；模擬房沒有獲得，但放棄仍可用，結算視窗會因 `earned` 為空而保存鍵 disabled——可接受。

(c) CSS：

```css
#midnight-abandon-confirm-modal, #midnight-abandon-vote-modal, #midnight-relic-memory-settle-modal {
  position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.6);
}
#midnight-abandon-confirm-modal[hidden], #midnight-abandon-vote-modal[hidden], #midnight-relic-memory-settle-modal[hidden] { display: none; }
.midnight-relic-memory-box { background: var(--panel-bg, #1c1c22); color: inherit; padding: 16px; border-radius: 8px; max-width: min(520px, 92vw); max-height: 86vh; overflow-y: auto; }
#midnight-relic-memory-settle-list { padding-left: 1.2em; }
#midnight-relic-memory-settle-code-input { width: 7em; text-transform: uppercase; letter-spacing: 0.15em; }
```

（先 `grep -n "#midnight-game-victory-modal" static_src/style.css` 對照既有彈窗的 z-index／背景變數，採同一組值，不自創顏色。）

(d) i18n 三檔：

| key | zh | ja | en |
| --- | --- | --- | --- |
| `midnight_abandon_button` | 放棄遊戲 | ゲームを放棄 | Abandon game |
| `midnight_abandon_confirm_body` | 要向全員提議放棄這場遊戲嗎？需要全員同意。 | 全員にゲームの放棄を提案しますか？全員の同意が必要です。 | Propose abandoning this game? Everyone must agree. |
| `midnight_abandon_confirm_yes` | 提議放棄 | 放棄を提案 | Propose |
| `midnight_abandon_confirm_no` | 取消 | キャンセル | Cancel |
| `midnight_abandon_vote_text` | {name} 提議放棄這場遊戲，是否同意？ | {name} がゲームの放棄を提案しました。同意しますか？ | {name} proposed abandoning the game. Agree? |
| `midnight_abandon_vote_progress` | 同意 {yes}／{total} | 同意 {yes}／{total} | Agreed {yes}/{total} |
| `midnight_abandon_vote_yes` | 同意 | 同意する | Agree |
| `midnight_abandon_vote_no` | 反對 | 反対する | Disagree |
| `midnight_relic_memory_settle_title` | 遺物記憶結算 | 遺物の記憶・精算 | Relic Memory Results |
| `midnight_relic_memory_save_button` | 存入記憶密碼 | 記憶パスワードに保存 | Save to code |
| `midnight_relic_memory_saving` | 保存中… | 保存中… | Saving… |
| `midnight_relic_memory_saved` | 已保存 {added} 個（因上限丟棄 {discarded} 個，最愛已滿未存入 {rejected} 個） | {added} 件保存しました（上限により {discarded} 件破棄、お気に入りで満杯のため {rejected} 件未保存） | Saved {added} (discarded {discarded} over limit, {rejected} not saved: favorites full) |
| `midnight_relic_memory_settle_close_button` | 關閉 | 閉じる | Close |

- [ ] **Step 4：執行確認通過**

Run: `node --check static_src/midnight.js && python generate.py && cd tools/midnight_check && node relic_memory_emulator_check.js`
Expected: 全部段落 PASS

- [ ] **Step 5：commit**

```bash
git add static_src/midnight.js static_src/style.css site_src/midnight_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py tools/midnight_check/relic_memory_emulator_check.js
git commit -m "feat(midnight): 放棄遊戲全員投票＋遺物記憶結算保存"
```

---

### Task 7：序號產生、文件同步、版本號、回歸

**Files:**
- Modify: `docs/superpowers/specs/2026-09-24-relic-memory-design.md`（§6.3 改為 `players/<slot>/relicMemoryLoadout`）
- Modify: `site_src/version.py`（`1.2.0` → `1.3.0`，新功能遞增 minor）
- 序號：只輸出到 scratchpad，**不提交**

- [ ] **Step 1：產生 20 組序號與匯入 JSON（不進 Git）**

在 scratchpad 執行：

```bash
node -e "const c=require('crypto');const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const s=new Set();while(s.size<20){let x='';for(let i=0;i<5;i++)x+=A[c.randomInt(A.length)];s.add(x);}const o={};[...s].forEach(k=>o[k]=true);console.log(JSON.stringify(o,null,2));" > "$SCRATCH/relicMemoryCodes.json"
```

（字元集排除 `0/O/1/I` 避免誤讀，仍符合 `^[A-Z0-9]{5}$`。）把 20 組序號與匯入方式（Firebase Console → Realtime Database → `relicMemoryCodes` 節點 → Import JSON）交給使用者。

- [ ] **Step 2：同步設計文件**

§6.3 最後一點改為：「選擇結果寫入 `players/<slot>/relicMemoryLoadout`（等待房階段角色物件尚未建立），開局時由 `newCharacterForSlot()` 複製成 `c.relicMemoryLoadout`。」

- [ ] **Step 3：版本號**

`site_src/version.py`：`VERSION = "1.3.0"`

- [ ] **Step 4：全部回歸**

```bash
python generate.py
node --check static_src/midnight_relic_memory.js static_src/character_drawer.js static_src/game_storage.js static_src/midnight.js
cd tools/midnight_check
node relic_memory_unit_check.js
node relic_memory_drawer_check.js
node relic_memory_emulator_check.js
node emulator_sync_check.js
node late_join_check.js
```

Expected：新腳本 ALL PASS；既有 `emulator_sync_check.js`／`late_join_check.js` 結果與改動前相同（改動前先跑一次記錄基準，若既有腳本原本就有失敗項，只比對差異）。

- [ ] **Step 5：commit**

```bash
git add docs/superpowers/specs/2026-09-24-relic-memory-design.md site_src/version.py
git commit -m "feat(midnight): v1.3.0 遺物記憶（累積／記憶密碼保存／帶入最多3個／放棄遊戲投票）"
```

- [ ] **Step 6：交付說明（給使用者）**

1. 20 組序號＋`relicMemoryCodes.json`。
2. 需手動執行 `firebase deploy --only database`（規則不會隨 GitHub Actions 部署）。
3. 規則部署前，正式環境讀寫 `relicMemories` 一律被拒（結算／等待房會顯示「此記憶密碼無效」）。
4. 附帶效果中目前 midnight 尚未實作判定的效果（例如 `hp_regen`、`crit_up` 等只在 night.js 有判定者），帶入後同樣不會生效——這是既有範圍，未在本次擴充。
5. `stackable` 指定待使用者提出。
