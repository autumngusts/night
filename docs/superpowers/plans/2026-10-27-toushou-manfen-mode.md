# 東正小遊戲 滿分男模式 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 在東正小遊戲新增第三種模式「滿分男模式」（`config.mode = "manfen"`）：爆料者打出缺點 → 秘密評分 0／2／5／10 → 心理戰（封口費競價亮牌）→ 秘密下注預測群體平均 → 公布並分彩池；結合「帶風向的人」與滿分男專用黑天鵝。

**Architecture：** 規則放在新檔 `toushou_core_manfen.js`（純函式，`window.PriTestToushouManfen`），`toushou_core.js` 的 `newGame()`／`reduce()` 在 manfen 時轉交，並透過 `Core._internal` 提供共用工具（PRNG、洗牌、`settleTarget`…）。畫面放在新檔 `toushou_ui_manfen.js`（`window.PriTestToushouManfenUI`），`toushou.js` 以「工具包 K」把 `el`／`masked`／`dispatch` 等共用元件傳給它。經典與內線模式的程式路徑不變。

**Tech Stack：** Vanilla ES5（IIFE、`var`、`function`，**不可用箭頭函式、let/const、template literal**）、Python 建置（`generate.py`）、Node 單元檢查、Playwright（借用 `tools/midnight_check` 的安裝）。

## Global Constraints

- 規格：`docs/superpowers/specs/2026-10-27-toushou-manfen-mode-design.md`（本計畫 Task 1 會先修正其中三處，見下）。
- 所有對使用者的說明、commit message、新增文件使用**繁體中文**；程式識別字維持英文。
- JS 一律 ES5；所有模組 IIFE 掛在 `window.PriTestToushou*`。
- 隨機性只能來自 `state.rng`（`Core._internal.rand(s)`），同一串 action 在任何裝置結果一致。
- 評分只能是 `0`、`2`、`5`、`10`；預測值以 ×10 整數存放在 `bets[id].predict`（0～100，散戶狂熱時 0～150）。
- CSS class 前綴 `.ts-mf-`，加到 `static_src/css/toushou.css`；不要動 `static_src/style.css`。
- UI 字串前綴 `ts_mf_`，`zh`／`ja`／`en` 三個檔都要加（`site_src/i18n_data_{zh,ja,en}.py`，現有 `ts_` 字串都三語齊全）。遊戲資料（對象、缺點牌、黑天鵝）只有 `C(ja, zh)`，en fallback 至 ja。
- **工作區有其他 session 同時在改 yellow**：每次 commit 只 `git add` 本計畫列出的檔案，不要 `git add -A`、不要動 `site_src/version.py`（版本號在 push 前另外處理）。
- 每次修改 `site_src/`、`static_src/` 後要跑 `py -3 generate.py`。
- 不修改 `database.rules.json` 與其他遊戲的檔案。

---

## 檔案結構

| 檔案 | 職責 | Task |
| --- | --- | --- |
| `docs/toushou_manfen_data_draft.md`（新） | 題庫中文草稿，給使用者審核 | 1 |
| `static_src/toushou_data.js` | 新增 `registerManfenCategory()`、`registerCommonFlaws()`、`MANFEN_CATEGORIES`、`MANFEN_TARGETS`、`FLAW_CARDS`、`MANFEN_SWAN_CARDS`、`MANFEN_SWAN_COMPOSITION`、`MANFEN_CLASSIC_PHRASE` | 2 |
| `static_src/toushou_data_manfen.js`（新） | 6 類別資料＋通用缺點牌（依審核後的草稿） | 2 |
| `static_src/toushou_core.js` | `isManfenMode()`、`newGame`／`reduce` 轉交、匯出 `_internal` | 3 |
| `static_src/toushou_core_manfen.js`（新） | 滿分男規則全部 | 3～6 |
| `tools/toushou_check/manfen_core_check.js`（新） | Node 單元檢查 | 2～6 |
| `site_src/toushou_page.py` | `TOUSHOU_SCRIPTS` 加入三個新 JS | 2、3、8 |
| `static_src/toushou_ui_manfen.js`（新） | 滿分男各階段畫面 | 8 |
| `static_src/toushou.js` | 設定畫面、工具包 `kit()`、轉交 manfen 畫面、`viewKey` | 7、8 |
| `static_src/css/toushou.css` | `.ts-mf-*` 樣式 | 8 |
| `site_src/i18n_data_{zh,ja,en}.py` | `ts_mf_*` 字串 | 7、8 |
| `tools/toushou_check/manfen_ui_check.js`（新） | Playwright 整局檢查 | 9 |

載入順序（`TOUSHOU_SCRIPTS`）：`… toushou_data_ext.js` → `toushou_data_manfen.js` → `toushou_core.js` → `toushou_core_manfen.js` → `toushou_ui_manfen.js` → `toushou.js`。

---

### Task 1：題庫草稿與規格修正（**使用者審核關卡**）

**Files:**
- Create: `docs/toushou_manfen_data_draft.md`
- Modify: `docs/superpowers/specs/2026-10-27-toushou-manfen-mode-design.md`

**Interfaces:**
- Produces：審核通過的草稿，Task 2 依它轉成資料。

- [ ] **Step 1：修正規格的三處（寫計畫時發現與程式結構不合）**

在規格中做以下修改：

1. §3.6 與 §7：預測值不另開 `predict10` 欄位，改為「`bets[id].predict` 存 ×10 整數」，理由：可直接沿用 `settleTarget(bets, avg10, …)`。§7 的 `bets: { [playerId]: { amount, predict10 } }` 改為 `bets: { [playerId]: { amount, predict, chipsBefore } }  // predict 為 ×10 整數`。
2. §7：刪除 `sentence` 欄位，改註明「題目句由 UI 依類別句型＋`flaw.text` 即時組出，不存 state」。
3. §8：載入順序改為 `toushou_core_manfen.js` 在 `toushou_core.js` **之後**（它要用 `Core._internal`；`reduce()` 在執行時才查 `window.PriTestToushouManfen`，所以不需要在前面）。i18n 一列改為「`ts_mf_*` 字串 zh／ja／en 三語（現有 `ts_` 字串皆三語）」。
4. §9 新增一條：「沒有人押注（`bets` 合計 0）時，`mindPot` 依 `mindPaid` 全數退回，避免籌碼消失（`history.refundMind = true`）」。

- [ ] **Step 2：寫題庫草稿**

格式（每類一節，條目用表格，方便審核）：

```markdown
# 東正小遊戲 滿分男模式 題庫草稿

日期：2026-10-27　狀態：待使用者審核（通過後轉成 static_src/toushou_data_manfen.js 並補日文）

## 寫作原則
- 對象的簡介**只寫優點**，具體、有畫面（數字、生活細節），讓人覺得「真的滿分」。
- 缺點要讓評分**真的會分歧**：有人覺得 0 分、有人覺得 10 分的才是好題目。避免人人都扣 10（犯罪、暴力）或人人都 0 的條件。
- 缺點句子接在「但是」後面，不要重複主詞（✕「他每天都要報備」→ ○「每天都要跟你報備行程」）。
- 不寫真實人物、不寫歧視特定族群的內容。

## mf_man 滿分男（句型：他是滿分男，但是{flaw}）

### 對象（40）
| id | 名稱 | 優點簡介 | 標籤 |
| --- | --- | --- | --- |
| mf_man_01 | 溫柔的外科醫師 | 身高 182、年收 400 萬，下班會煮飯，記得你說過的每一件小事 | 高收入、會做飯、細心 |
| … | | | |

### 專屬缺點（32）
| id | 缺點 |
| --- | --- |
| fl_man_01 | 每天都要跟你報備行程 |
| … | |
```

要寫的內容：

| 節 | 類別 id | 句型（zh） | 對象數 | 專屬缺點數 |
| --- | --- | --- | --- | --- |
| 滿分男 | `mf_man` | 他是滿分男，但是{flaw} | 40 | 32 |
| 滿分女 | `mf_woman` | 她是滿分女，但是{flaw} | 40 | 32 |
| 滿分工作 | `mf_job` | 這是滿分工作，但是{flaw} | 40 | 32 |
| 滿分房子 | `mf_home` | 這是滿分房子，但是{flaw} | 40 | 32 |
| 滿分室友 | `mf_roommate` | 他是滿分室友，但是{flaw} | 40 | 32 |
| 滿分旅伴 | `mf_travel` | 他是滿分旅伴，但是{flaw} | 40 | 32 |
| 通用缺點 | （`category: null`） | — | — | 30（id `fl_c01`～`fl_c30`，任何對象都說得通，例：「手機桌布是前任」「講話每句都要加英文」） |

另外寫一節「沿用現有標的」：句型「『{target}』是滿分的，但是{flaw}」，說明現有類別的利空消息牌也可以直接打出。

- [ ] **Step 3：commit 並請使用者審核**

```bash
git add docs/toushou_manfen_data_draft.md docs/superpowers/specs/2026-10-27-toushou-manfen-mode-design.md
git commit -m "docs(toushou): 滿分男模式題庫草稿；規格修正預測值欄位與載入順序"
```

（commit message 結尾加上系統提示的 Co-Authored-By 與 Claude-Session 兩行，之後每個 commit 皆同。）

**停在這裡**：請使用者審核草稿。依回饋修改後再進入 Task 2。Task 3～9 不依賴題庫內容（測試用動態取資料），使用者同意時可以在審核期間先做 Task 3 以後、Task 2 用暫定資料，但 Task 2 的最終資料必須等審核通過。

---

### Task 2：資料層（共用資料＋滿分男題庫）

**Files:**
- Modify: `static_src/toushou_data.js`（在 `SWAN_COMPOSITION` 之後、`window.PriTestToushouData = {` 之前加入；匯出物件加欄位）
- Create: `static_src/toushou_data_manfen.js`
- Modify: `site_src/toushou_page.py`（`"toushou_data_ext.js",` 之後加 `"toushou_data_manfen.js",`）
- Create: `tools/toushou_check/manfen_core_check.js`

**Interfaces:**
- Produces（`window.PriTestToushouData` 新欄位）：
  - `registerManfenCategory(def)`：`def = { id, name: C, phrase: C, targets: [{id,name,summary,tags}], flawCards: [{id,text}] }`
  - `registerCommonFlaws(list)`：`list = [{id, text: C}]`，登錄為 `category: null`
  - `MANFEN_CATEGORIES: [{id, name, phrase}]`、`MANFEN_TARGETS: [{id, category, name, summary, tags, hooks: []}]`、`FLAW_CARDS: [{id, category, text}]`
  - `MANFEN_SWAN_CARDS: [{id, group, name: C, text: C}]`、`MANFEN_SWAN_COMPOSITION: { calm: 5 }`
  - `MANFEN_CLASSIC_PHRASE: C`（含 `{target}`、`{flaw}`）

- [ ] **Step 1：寫失敗的資料檢查**

建立 `tools/toushou_check/manfen_core_check.js`：

```js
// ============================================================================
// toushou 滿分男模式（manfen）的 Node 單元檢查：資料與規則引擎。
// 執行：node tools/toushou_check/manfen_core_check.js
// 規則依據：docs/superpowers/specs/2026-10-27-toushou-manfen-mode-design.md
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SRC = path.join(__dirname, "..", "..", "static_src");
// 載入順序與頁面 TOUSHOU_SCRIPTS 相同
var FILES = [
  "toushou_data.js",
  "toushou_data_sengoku.js",
  "toushou_data_celebrity.js",
  "toushou_data_company.js",
  "toushou_data_region.js",
  "toushou_data_food.js",
  "toushou_data_anime.js",
  "toushou_data_culture.js",
  "toushou_data_taiwan.js",
  "toushou_data_ext.js",
  "toushou_data_manfen.js",
  "toushou_core.js",
  "toushou_core_manfen.js"
].filter(function (f) { return fs.existsSync(path.join(SRC, f)); });

var win = {};
FILES.forEach(function (f) { new Function("window", fs.readFileSync(path.join(SRC, f), "utf8"))(win); });
var D = win.PriTestToushouData;
var Core = win.PriTestToushouCore;
var M = win.PriTestToushouManfen;

var results = { pass: 0, fail: 0 };
function check(name, fn) {
  try { fn(); results.pass++; console.log("  ok   " + name); }
  catch (err) { results.fail++; console.log("  FAIL " + name + "\n       " + (err && err.message)); }
}

var MF_IDS = ["mf_man", "mf_woman", "mf_job", "mf_home", "mf_roommate", "mf_travel"];

check("manfen categories registered in order with phrase containing {flaw}", function () {
  assert.deepStrictEqual(D.MANFEN_CATEGORIES.map(function (c) { return c.id; }), MF_IDS);
  D.MANFEN_CATEGORIES.forEach(function (c) {
    assert.ok(c.phrase.zh.indexOf("{flaw}") >= 0 && c.phrase.ja.indexOf("{flaw}") >= 0, c.id);
    assert.ok(c.name.zh && c.name.ja, c.id);
  });
  assert.ok(D.MANFEN_CLASSIC_PHRASE.zh.indexOf("{target}") >= 0 && D.MANFEN_CLASSIC_PHRASE.zh.indexOf("{flaw}") >= 0);
});

check("manfen categories are not mixed into classic CATEGORIES", function () {
  D.CATEGORIES.forEach(function (c) { assert.ok(MF_IDS.indexOf(c.id) < 0, c.id); });
});

check("each manfen category has exactly 40 targets and 32 own flaw cards, bilingual", function () {
  MF_IDS.forEach(function (id) {
    var ts = D.MANFEN_TARGETS.filter(function (t) { return t.category === id; });
    assert.strictEqual(ts.length, 40, id + " targets " + ts.length);
    ts.forEach(function (t) {
      assert.ok(t.name.zh && t.name.ja && t.summary.zh && t.summary.ja, t.id);
      assert.ok(t.tags.length >= 2 && t.tags.length <= 3, t.id);
    });
    var fs2 = D.FLAW_CARDS.filter(function (f) { return f.category === id; });
    assert.strictEqual(fs2.length, 32, id + " flaws " + fs2.length);
  });
});

check("common flaw cards: exactly 30, category null, bilingual", function () {
  var common = D.FLAW_CARDS.filter(function (f) { return f.category === null; });
  assert.strictEqual(common.length, 30, String(common.length));
  common.forEach(function (f) { assert.ok(f.text.zh && f.text.ja, f.id); });
});

// 只檢查新資料：既有資料的 id 不在本計畫範圍
check("manfen ids are unique and do not collide with classic targets / news cards", function () {
  var classicT = {};
  D.TARGETS.forEach(function (t) { classicT[t.id] = 1; });
  var seen = {};
  D.MANFEN_TARGETS.forEach(function (t) { assert.ok(!seen[t.id] && !classicT[t.id], "dup " + t.id); seen[t.id] = 1; });
  var news = {};
  D.NEWS_CARDS.forEach(function (c) { news[c.id] = 1; });
  seen = {};
  D.FLAW_CARDS.forEach(function (c) { assert.ok(!seen[c.id] && !news[c.id], "dup " + c.id); seen[c.id] = 1; });
});

check("manfen swan deck: 15 events + calm, composition calm 5", function () {
  var ids = D.MANFEN_SWAN_CARDS.map(function (c) { return c.id; });
  assert.deepStrictEqual(ids, ["circuit", "hype", "whale", "fomo", "panic", "lull", "exhausted", "rumor",
    "gag", "extra", "reverse", "trial", "cancel", "upset", "bailout", "calm"]);
  assert.deepStrictEqual(D.MANFEN_SWAN_COMPOSITION, { calm: 5 });
  D.MANFEN_SWAN_CARDS.forEach(function (c) { assert.ok(c.name.zh && c.name.ja && c.text.zh && c.text.ja, c.id); });
});

// ---- 規則引擎（Task 3 起） ----
if (M) {
  // （Task 3～6 的檢查加在這裡）
}

console.log("\n" + results.pass + " passed, " + results.fail + " failed");
process.exit(results.fail ? 1 : 0);
```

- [ ] **Step 2：執行確認失敗**

Run：`node tools/toushou_check/manfen_core_check.js`
Expected：FAIL（`D.MANFEN_CATEGORIES` 為 undefined）。

- [ ] **Step 3：在 `toushou_data.js` 加入共用資料**

在 `var SWAN_COMPOSITION = { calm: 7 }; // 未列出的事件各 1 張` 之後加入：

```js
  // ---------------- 滿分男模式（manfen spec §5、§6） ----------------
  // 專用類別與缺點牌不進入 CATEGORIES／NEWS_CARDS，經典與內線模式看不到。
  var MANFEN_CATEGORIES = [];
  var MANFEN_TARGETS = [];
  var FLAW_CARDS = [];

  // def = { id, name, phrase, targets: [{id,name,summary,tags}], flawCards: [{id,text}] }
  function registerManfenCategory(def) {
    MANFEN_CATEGORIES.push({ id: def.id, name: def.name, phrase: def.phrase });
    (def.targets || []).forEach(function (t) {
      MANFEN_TARGETS.push({ id: t.id, category: def.id, name: t.name, summary: t.summary, tags: t.tags, hooks: [] });
    });
    (def.flawCards || []).forEach(function (f) {
      FLAW_CARDS.push({ id: f.id, category: def.id, text: f.text });
    });
  }

  // 通用缺點牌：任何對象（含現有標的）都能直接打出
  function registerCommonFlaws(list) {
    list.forEach(function (f) { FLAW_CARDS.push({ id: f.id, category: null, text: f.text }); });
  }

  // 現有標的當作滿分對象時的句型
  var MANFEN_CLASSIC_PHRASE = C("「{target}」は満点、でも{flaw}", "「{target}」是滿分的，但是{flaw}");

  // 滿分男黑天鵝：名稱沿用盤勢用語，效果作用於評分與心理戰。group：avg／mind／settle／calm
  var MANFEN_SWAN_CARDS = [
    SW("circuit", "avg", "サーキットブレーカー", "熔斷", "最高と最低の票を1枚ずつ除いて平均", "去掉一張最高分、一張最低分的票再平均"),
    SW("hype", "avg", "テーマ株騒動", "題材炒作", "暴露者の評価は2票分", "爆料者的評分算 2 票"),
    SW("whale", "avg", "大口参入", "主力進場", "賭け金が最も多い人の評価は2票分", "押注額最高的人，評分算 2 票"),
    SW("fomo", "avg", "個人投資家の熱狂", "散戶狂熱", "10点の票は15点として数える（予想上限15.0）", "評 10 分的票算成 15（預測上限 15.0）"),
    SW("panic", "avg", "パニック売り", "恐慌拋售", "2点の票は5点として数える", "評 2 分的票算成 5"),
    SW("lull", "avg", "閑散相場", "量縮盤整", "すべての評価が半分", "所有評分減半"),
    SW("exhausted", "avg", "材料出尽くし", "利多出盡", "平均の代わりに中央値を使う", "改用中位數取代平均"),
    SW("rumor", "avg", "デマ発覚", "謠言破滅", "公開時にランダムで1票が無効になる", "公布時隨機一票作廢"),
    SW("gag", "mind", "箝口令", "封口令", "この題では公開説明禁止", "本題禁止公開解釋"),
    SW("extra", "mind", "臨時株主総会", "股東臨時會", "公開要求の最低額が半分", "要求亮牌的開價下限減半"),
    SW("reverse", "mind", "逆順発言", "逆序發言", "チップが最も少ない人は最初に強制公開", "籌碼最少的人一開始就強制亮牌"),
    SW("trial", "mind", "公開裁判", "全民公審", "暴露者は最初に強制公開", "爆料者一開始就強制亮牌"),
    SW("cancel", "settle", "取引取消", "交易取消", "平均が4.5〜5.5なら全員に賭け金と心理戦の支払いを返却", "平均落在 4.5～5.5 則全員退回押注與心理戰付出"),
    SW("upset", "settle", "大番狂わせ", "爆冷門", "誤差が大きい順に配当", "預測最不準的人拿彩池"),
    SW("bailout", "settle", "救済資金", "紓困加碼", "銀行が彩池の50%を上乗せ", "銀行加碼彩池 50%"),
    SW("calm", "calm", "平穏", "平靜", "何も起きない", "沒有事件")
  ];
  var MANFEN_SWAN_COMPOSITION = { calm: 5 }; // 未列出的事件各 1 張，共 20 張
```

並在匯出物件 `SWAN_COMPOSITION: SWAN_COMPOSITION,` 之後加：

```js
    registerManfenCategory: registerManfenCategory,
    registerCommonFlaws: registerCommonFlaws,
    MANFEN_CATEGORIES: MANFEN_CATEGORIES,
    MANFEN_TARGETS: MANFEN_TARGETS,
    FLAW_CARDS: FLAW_CARDS,
    MANFEN_CLASSIC_PHRASE: MANFEN_CLASSIC_PHRASE,
    MANFEN_SWAN_CARDS: MANFEN_SWAN_CARDS,
    MANFEN_SWAN_COMPOSITION: MANFEN_SWAN_COMPOSITION,
```

- [ ] **Step 4：建立 `static_src/toushou_data_manfen.js`**

依審核通過的草稿，結構如下（每類一個 `registerManfenCategory`；ja 由實作者翻成自然的日文）：

```js
// 東正小遊戲（toushou）滿分男模式題庫：6 個專用類別＋通用缺點牌。
// 內容來源：docs/toushou_manfen_data_draft.md（2026-10-27 起使用者審核）。只放資料，規則在 toushou_core_manfen.js。
(function () {
  "use strict";
  var D = window.PriTestToushouData;
  var C = D.C;

  function T(id, ja, zh, jaSum, zhSum, tags) {
    return { id: id, name: C(ja, zh), summary: C(jaSum, zhSum),
      tags: tags.map(function (p) { return C(p[0], p[1]); }) };
  }
  function F(id, ja, zh) { return { id: id, text: C(ja, zh) }; }

  D.registerManfenCategory({
    id: "mf_man",
    name: C("満点男子", "滿分男"),
    phrase: C("彼は満点男子、でも{flaw}", "他是滿分男，但是{flaw}"),
    targets: [
      T("mf_man_01", "優しい外科医", "溫柔的外科醫師",
        "身長182cm、年収は高く、帰宅後は料理をしてくれて、あなたが話した小さなことも全部覚えている",
        "身高 182、年收 400 萬，下班會煮飯，記得你說過的每一件小事",
        [["高収入", "高收入"], ["料理上手", "會做飯"], ["気配り", "細心"]])
      // …其餘依草稿
    ],
    flawCards: [
      F("fl_man_01", "毎日あなたに行動予定を報告してほしがる", "每天都要跟你報備行程")
      // …其餘依草稿
    ]
  });

  // mf_woman, mf_job, mf_home, mf_roommate, mf_travel 依草稿同樣登錄

  D.registerCommonFlaws([
    F("fl_c01", "スマホの壁紙が元恋人", "手機桌布是前任")
    // …共 30 張，依草稿
  ]);
})();
```

在 `site_src/toushou_page.py` 的 `"toushou_data_ext.js",` 下一行加入：

```python
    # 滿分男模式的題庫（只登錄到 MANFEN_*，不影響經典／內線）
    "toushou_data_manfen.js",
```

- [ ] **Step 5：執行確認通過**

Run：`node --check static_src/toushou_data.js && node --check static_src/toushou_data_manfen.js && node tools/toushou_check/manfen_core_check.js && node tools/toushou_check/core_check.js`
Expected：manfen 檢查 6 passed、0 failed；`core_check.js` 維持全數通過。

- [ ] **Step 6：commit**

```bash
git add static_src/toushou_data.js static_src/toushou_data_manfen.js site_src/toushou_page.py tools/toushou_check/manfen_core_check.js
git commit -m "feat(toushou): 滿分男模式資料（6 類題庫、通用缺點牌、專用黑天鵝牌組）"
```

---

### Task 3：引擎骨架、開局、爆料

**Files:**
- Modify: `static_src/toushou_core.js`
- Create: `static_src/toushou_core_manfen.js`
- Modify: `site_src/toushou_page.py`（`"toushou_core.js",` 之後加 `"toushou_core_manfen.js",`）
- Modify: `tools/toushou_check/manfen_core_check.js`

**Interfaces:**
- Consumes：Task 2 的 `D.MANFEN_*`、`D.FLAW_CARDS`。
- Produces：
  - `Core.isManfenMode(s) -> boolean`
  - `Core._internal = { clone, isInt, rand, shuffle, playerById, drawCard, buildWindDeck, settleTarget, nextTarget }`
  - `M.newGame(config) -> state`（`config = { mode:"manfen", players:[{name,chips}], targets:[{category,name,summary,tags,hooks,custom}], windEnabled, blackSwanEnabled, minBet, seed }`）
  - `M.apply(s, action)`：就地修改已 clone 的 `s`，無效時 `throw new Error(<i18n key>)`
  - `M.pickTargets(mfCats, classicCats, count, seed) -> [target]`
  - `M.manfenCategoryById(id)`、`M.categoryById(id)`（manfen 類別優先，否則 `Core.categoryById`）、`M.flawCardById(id)`（`FLAW_CARDS` 優先，否則 `Core.cardById`）、`M.swanById(id)`
  - `M.blamerFor(s, k) -> playerId`、`M.flawPlayable(s, cardId) -> boolean`、`M.exposeError(s, playerId, cardId, text, edited) -> key|null`
  - action：`{type:"startBetting"}`（reveal_target → `mf_expose`）、`{type:"mfExpose", playerId, cardId|null, edited, text}`（→ `mf_rate`）
  - `s.current` 欄位見下方 `startExpose()`。

- [ ] **Step 1：寫失敗的檢查**

在 `manfen_core_check.js` 的 `if (M) {` 區塊內加入：

```js
  function game(n, opts) {
    opts = opts || {};
    var players = [];
    for (var i = 0; i < n; i++) players.push({ name: "P" + (i + 1), chips: opts.chips || 1000 });
    var targets = M.pickTargets(opts.mfCats || ["mf_man"], opts.classicCats || [], opts.targets || n, 7);
    return Core.newGame({ mode: "manfen", players: players, targets: targets, minBet: opts.minBet || 100,
      windEnabled: !!opts.wind, blackSwanEnabled: !!opts.swan, seed: opts.seed || 12345 });
  }
  function R(s, a) { return Core.reduce(s, a); }
  function playableCard(s, pid) {
    var p = s.players.filter(function (x) { return x.id === pid; })[0];
    return p.hand.filter(function (id) { return M.flawPlayable(s, id); })[0] || null;
  }
  // 開始本題並由爆料者用自訂缺點爆料；event／wind 可指定（把牌放在牌堆頂＝陣列尾端）
  function exposed(s, opts) {
    opts = opts || {};
    s = R(s, { type: "startBetting" });
    if (opts.event) s.mfSwanDeck.push(opts.event);
    if (opts.wind) s.windDeck.push(opts.wind);
    return R(s, { type: "mfExpose", playerId: s.current.blamerId, cardId: null, edited: false, text: "每天都要跟你報備行程" });
  }

  check("newGame manfen: config, hands, blamerOffset, decks only when enabled", function () {
    var s = game(3);
    assert.strictEqual(s.config.mode, "manfen");
    assert.strictEqual(s.phase, "reveal_target");
    assert.strictEqual(s.config.missionsEnabled, false);
    assert.strictEqual(s.config.sectorLinkEnabled, false);
    s.players.forEach(function (p) { assert.strictEqual(p.hand.length, D.HAND_SIZE); });
    assert.ok(s.blamerOffset >= 0 && s.blamerOffset < 3);
    assert.deepStrictEqual(s.windDeck, []);
    assert.deepStrictEqual(s.mfSwanDeck, []);
    var s2 = game(3, { wind: true, swan: true });
    assert.strictEqual(s2.windDeck.length, 5);
    assert.strictEqual(s2.mfSwanDeck.length, 20);
  });

  check("deck pool: common + own-category flaws + classic down-tone news of chosen classic categories", function () {
    var s = game(3, { mfCats: ["mf_man"], classicCats: ["jp_company"], targets: 6 });
    var all = s.deck.concat(s.discard);
    s.players.forEach(function (p) { all = all.concat(p.hand); });
    all.forEach(function (id) {
      var f = D.FLAW_CARDS.filter(function (c) { return c.id === id; })[0];
      if (f) { assert.ok(f.category === null || f.category === "mf_man", id); return; }
      var n = Core.cardById(id);
      assert.ok(n && n.tone === "down" && n.category === "jp_company", id);
    });
  });

  check("classic and insider newGame unaffected (no blamerOffset / mfSwanDeck)", function () {
    var t = Core.pickRandomTargets(["jp_company"], 2, 1);
    var c = Core.newGame({ players: [{ name: "a", chips: 1000 }, { name: "b", chips: 1000 }], targets: t, minBet: 100, seed: 5 });
    assert.strictEqual(c.config.mode, "classic");
    assert.strictEqual(c.blamerOffset, undefined);
    assert.strictEqual(c.mfSwanDeck, undefined);
  });

  check("blamer rotates by seat from blamerOffset", function () {
    var s = game(3, { targets: 3 });
    for (var k = 0; k < 3; k++) assert.strictEqual(M.blamerFor(s, k), s.players[(k + s.blamerOffset) % 3].id);
    s = R(s, { type: "startBetting" });
    assert.strictEqual(s.phase, "mf_expose");
    assert.strictEqual(s.current.blamerId, M.blamerFor(s, 0));
  });

  check("expose: only the blamer, playable rule, text required, card replaced", function () {
    var s = R(game(3), { type: "startBetting" });
    var b = s.current.blamerId;
    var other = s.players.filter(function (p) { return p.id !== b; })[0].id;
    assert.strictEqual(M.exposeError(s, other, null, "x", false), "ts_err_not_your_turn");
    assert.strictEqual(M.exposeError(s, b, null, "  ", false), "ts_err_empty_news");
    var card = playableCard(s, b);
    assert.ok(card, "blamer should hold a playable flaw (common cards are always playable)");
    var s2 = R(s, { type: "mfExpose", playerId: b, cardId: card, edited: false, text: "報備" });
    var me = s2.players.filter(function (p) { return p.id === b; })[0];
    assert.strictEqual(me.hand.length, D.HAND_SIZE);
    assert.ok(s2.discard.indexOf(card) >= 0);
    assert.deepStrictEqual(s2.current.flaw, { cardId: card, edited: false, text: "報備" });
    assert.strictEqual(s2.phase, "mf_rate");
  });

  check("flawPlayable: other manfen category flaw needs edit", function () {
    var s = R(game(2, { mfCats: ["mf_man"] }), { type: "startBetting" });
    var foreign = D.FLAW_CARDS.filter(function (f) { return f.category === "mf_job"; })[0].id;
    assert.strictEqual(M.flawPlayable(s, foreign), false);
    var common = D.FLAW_CARDS.filter(function (f) { return f.category === null; })[0].id;
    assert.strictEqual(M.flawPlayable(s, common), true);
  });

  check("expose draws swan and wind; neutral wind has no holder", function () {
    var s = exposed(game(3, { wind: true, swan: true }), { event: "hype", wind: "up" });
    assert.strictEqual(s.current.event, "hype");
    assert.strictEqual(s.current.windCard, "up");
    assert.ok(s.players.some(function (p) { return p.id === s.current.windHolder; }));
    var s2 = exposed(game(3, { wind: true }), { wind: "neutral" });
    assert.strictEqual(s2.current.windCard, "neutral");
    assert.strictEqual(s2.current.windHolder, null);
    var s3 = exposed(game(3));
    assert.strictEqual(s3.current.event, null);
    assert.strictEqual(s3.current.windCard, null);
  });

  check("all players broke at startBetting -> final", function () {
    var s = game(2);
    s.players.forEach(function (p) { p.chips = 0; });
    s = R(s, { type: "startBetting" });
    assert.strictEqual(s.phase, "final");
  });
```

- [ ] **Step 2：執行確認失敗**

Run：`node tools/toushou_check/manfen_core_check.js`
Expected：資料檢查 ok；`if (M)` 區塊因 `M` 為 undefined 而略過 → 改成先讓它失敗：暫時在區塊外加 `check("manfen engine loaded", function () { assert.ok(M); });`，確認 FAIL 後保留這條（之後一直會 ok）。

- [ ] **Step 3：修改 `toushou_core.js`**

1. `function isInsiderMode(s) …` 下一行加：

```js
  function isManfenMode(s) { return !!s.config && s.config.mode === "manfen"; }

  // 滿分男模式的規則在 toushou_core_manfen.js（載入在本檔之後），執行時才取用
  function manfen() {
    var M = window.PriTestToushouManfen;
    if (!M) throw new Error("ts_err_phase");
    return M;
  }
```

2. `function newGame(config) {` 的第一行加：

```js
    if (config.mode === "manfen") return manfen().newGame(config);
```

3. `reduce()` 的 `var s = clone(state);` 之後加：

```js
    if (isManfenMode(s)) {
      manfen().apply(s, action);
      return s;
    }
```

4. 匯出物件 `isInsiderMode: isInsiderMode,` 之後加：

```js
    isManfenMode: isManfenMode,
    // 給 toushou_core_manfen.js 用的共用工具（不是公開 API）
    _internal: {
      clone: clone,
      isInt: isInt,
      rand: rand,
      shuffle: shuffle,
      playerById: playerById,
      drawCard: drawCard,
      buildWindDeck: buildWindDeck,
      settleTarget: settleTarget,
      nextTarget: nextTarget
    },
```

- [ ] **Step 4：建立 `static_src/toushou_core_manfen.js`（骨架＋開局＋爆料）**

```js
// 東正小遊戲（toushou）滿分男模式規則引擎。純邏輯，不碰 DOM。
// toushou_core.js 的 newGame／reduce 在 config.mode === "manfen" 時轉交到這裡；
// apply(s, action) 直接修改已經深複製過的 s，無效 action 時 throw new Error(<i18n key>)。
// 規則依據：docs/superpowers/specs/2026-10-27-toushou-manfen-mode-design.md
(function () {
  "use strict";

  var D = window.PriTestToushouData;
  var Core = window.PriTestToushouCore;
  var I = Core._internal;
  var clone = I.clone;
  var isInt = I.isInt;
  var rand = I.rand;
  var shuffle = I.shuffle;
  var playerById = I.playerById;
  var drawCard = I.drawCard;

  var RATINGS = [0, 2, 5, 10];
  var WIND_RATINGS = { up: [0, 2], down: [5, 10] }; // 帶風向者只能往指定方向評（spec §3.4）

  // ---------------- 資料查詢 ----------------

  function manfenCategoryById(id) {
    for (var i = 0; i < D.MANFEN_CATEGORIES.length; i++) if (D.MANFEN_CATEGORIES[i].id === id) return D.MANFEN_CATEGORIES[i];
    return null;
  }

  function categoryById(id) { return manfenCategoryById(id) || Core.categoryById(id); }

  // 缺點牌優先；現有類別的利空消息牌也會進牌堆，所以找不到時查 NEWS_CARDS
  function flawCardById(id) {
    for (var i = 0; i < D.FLAW_CARDS.length; i++) if (D.FLAW_CARDS[i].id === id) return D.FLAW_CARDS[i];
    return Core.cardById(id);
  }

  function swanById(id) {
    for (var i = 0; i < D.MANFEN_SWAN_CARDS.length; i++) if (D.MANFEN_SWAN_CARDS[i].id === id) return D.MANFEN_SWAN_CARDS[i];
    return null;
  }

  function pickTargets(mfCats, classicCats, count, seed) {
    var holder = { rng: seed >>> 0 };
    var pool = D.MANFEN_TARGETS.filter(function (t) { return mfCats.indexOf(t.category) >= 0; })
      .concat(D.TARGETS.filter(function (t) { return classicCats.indexOf(t.category) >= 0; }));
    return shuffle(holder, pool).slice(0, count).map(function (t) {
      return {
        category: t.category,
        name: clone(t.name),
        summary: clone(t.summary || null),
        tags: clone(t.tags || []),
        hooks: clone(t.hooks || []),
        custom: false,
        sourceId: t.id
      };
    });
  }

  function buildSwanDeck(holder) {
    var arr = [];
    D.MANFEN_SWAN_CARDS.forEach(function (c) {
      var k = D.MANFEN_SWAN_COMPOSITION[c.id] || 1;
      for (var i = 0; i < k; i++) arr.push(c.id);
    });
    return shuffle(holder, arr);
  }

  // ---------------- 開局 ----------------

  function newGame(config) {
    var s = {
      version: 1,
      phase: "reveal_target",
      config: {
        mode: "manfen",
        // 依賴股價的規則在本模式不生效（spec §2）
        missionsEnabled: false,
        windEnabled: !!config.windEnabled,
        minBet: config.minBet,
        deltaMode: "host",
        voteCap: 100,
        blackSwanEnabled: !!config.blackSwanEnabled,
        sectorLinkEnabled: false
      },
      players: [],
      deck: [],
      discard: [],
      windDeck: [],
      swanDeck: [],
      mfSwanDeck: [],
      targets: [],
      targetIndex: 0,
      current: null,
      history: [],
      lastSettlement: null,
      missionsSeen: {},
      rng: config.seed >>> 0
    };
    config.players.forEach(function (p, i) {
      s.players.push({ id: "p" + i, name: p.name, chips: p.chips, hand: [], mission: null });
    });
    config.targets.forEach(function (t, i) {
      s.targets.push({ id: "t" + i, category: t.category, name: t.name, summary: t.summary || null,
        tags: t.tags || [], hooks: t.hooks || [], custom: !!t.custom });
    });
    // 牌池＝通用缺點牌＋本局類別的專屬缺點牌＋本局現有類別的利空消息牌（spec §3.3）
    var cats = [];
    s.targets.forEach(function (t) { if (cats.indexOf(t.category) < 0) cats.push(t.category); });
    var pool = D.FLAW_CARDS.filter(function (c) { return c.category === null || cats.indexOf(c.category) >= 0; })
      .map(function (c) { return c.id; })
      .concat(D.NEWS_CARDS.filter(function (c) { return c.tone === "down" && c.category !== null && cats.indexOf(c.category) >= 0; })
        .map(function (c) { return c.id; }));
    var k = Math.max(1, Math.ceil(s.players.length * 6 / pool.length));
    var ids = [];
    for (var c = 0; c < k; c++) ids = ids.concat(pool);
    s.deck = shuffle(s, ids);
    for (var r = 0; r < D.HAND_SIZE; r++) {
      s.players.forEach(function (p) {
        var card = drawCard(s);
        if (card) p.hand.push(card);
      });
    }
    s.blamerOffset = Math.floor(rand(s) * s.players.length);
    if (s.config.windEnabled) s.windDeck = I.buildWindDeck(s);
    if (s.config.blackSwanEnabled) s.mfSwanDeck = buildSwanDeck(s);
    return s;
  }

  function blamerFor(s, k) {
    return s.players[(k + (s.blamerOffset || 0)) % s.players.length].id;
  }

  // ---------------- 爆料（spec §3.3） ----------------

  function startExpose(s) {
    if (!s.players.some(function (p) { return p.chips > 0; })) {
      s.phase = "final";
      s.current = null;
      return;
    }
    s.current = {
      blamerId: blamerFor(s, s.targetIndex),
      flaw: null,
      event: null,
      windCard: null,
      windHolder: null,
      ratings: {},
      revealed: {},
      requests: [],
      pendingRequest: null,
      mindPaid: {},
      mindPot: 0,
      bettors: [],
      bets: {},
      pot: 0,
      news: []
    };
    s.phase = "mf_expose";
  }

  // 通用缺點牌、同類別的缺點牌、同類別的利空消息牌可直接打出；其他只能改寫
  function flawPlayable(s, cardId) {
    var card = flawCardById(cardId);
    var target = s.targets[s.targetIndex];
    if (!card || !target) return false;
    if (card.tone !== undefined) return card.tone === "down" && card.category === target.category;
    return card.category === null || card.category === target.category;
  }

  function exposeError(s, playerId, cardId, text, edited) {
    if (s.phase !== "mf_expose" || !s.current || s.current.blamerId !== playerId) return "ts_err_not_your_turn";
    if (cardId !== null && cardId !== undefined) {
      var p = playerById(s, playerId);
      if (p.hand.indexOf(cardId) < 0) return "ts_err_card";
      if (!edited && !flawPlayable(s, cardId)) return "ts_err_card_mismatch";
    }
    if (typeof text !== "string" || !text.trim()) return "ts_err_empty_news";
    return null;
  }

  function expose(s, a) {
    var cardId = a.cardId === undefined ? null : a.cardId;
    var err = exposeError(s, a.playerId, cardId, a.text, !!a.edited);
    if (err) throw new Error(err);
    if (cardId !== null) {
      var p = playerById(s, a.playerId);
      p.hand.splice(p.hand.indexOf(cardId), 1);
      s.discard.push(cardId);
      var drawn = drawCard(s);
      if (drawn) p.hand.push(drawn);
    }
    var c = s.current;
    c.flaw = { cardId: cardId, edited: cardId !== null && !!a.edited, text: a.text.trim() };
    if (s.config.blackSwanEnabled) {
      if (!s.mfSwanDeck || !s.mfSwanDeck.length) s.mfSwanDeck = buildSwanDeck(s);
      c.event = s.mfSwanDeck.pop();
    }
    if (s.config.windEnabled) {
      // 帶風向的人（spec §4）：中立＝本題沒有，但畫面一律只說「可能有」
      if (!s.windDeck.length) s.windDeck = I.buildWindDeck(s);
      c.windCard = s.windDeck.pop();
      if (c.windCard !== "neutral") c.windHolder = s.players[Math.floor(rand(s) * s.players.length)].id;
    }
    s.phase = "mf_rate";
  }

  // ---------------- reducer 入口 ----------------

  function need(s, phase) { if (s.phase !== phase) throw new Error("ts_err_phase"); }

  function apply(s, action) {
    switch (action.type) {
      case "startBetting": need(s, "reveal_target"); startExpose(s); break;
      case "mfExpose": need(s, "mf_expose"); expose(s, action); break;
      case "nextTarget": need(s, "settle"); I.nextTarget(s); break;
      default: throw new Error("ts_err_phase");
    }
  }

  window.PriTestToushouManfen = {
    RATINGS: RATINGS,
    newGame: newGame,
    apply: apply,
    pickTargets: pickTargets,
    manfenCategoryById: manfenCategoryById,
    categoryById: categoryById,
    flawCardById: flawCardById,
    swanById: swanById,
    blamerFor: blamerFor,
    flawPlayable: flawPlayable,
    exposeError: exposeError
  };
})();
```

在 `site_src/toushou_page.py` 的 `"toushou_core.js",` 下一行加 `"toushou_core_manfen.js",`。

- [ ] **Step 5：執行確認通過**

Run：`node --check static_src/toushou_core.js && node --check static_src/toushou_core_manfen.js && node tools/toushou_check/manfen_core_check.js && node tools/toushou_check/core_check.js`
Expected：全部 ok、0 failed。

- [ ] **Step 6：commit**

```bash
git add static_src/toushou_core.js static_src/toushou_core_manfen.js site_src/toushou_page.py tools/toushou_check/manfen_core_check.js
git commit -m "feat(toushou): 滿分男模式引擎骨架（開局、爆料者輪替、爆料與風向／黑天鵝抽牌）"
```

---

### Task 4：秘密評分與進入心理戰

**Files:**
- Modify: `static_src/toushou_core_manfen.js`
- Modify: `tools/toushou_check/manfen_core_check.js`

**Interfaces:**
- Produces：`M.allowedRatings(s, pid) -> number[]`、`M.pendingRaters(s) -> playerId[]`（座位順序）、`M.rateError(s, pid, value) -> key|null`；action `{type:"mfRate", playerId, value}`；全員評完 → `phase = "mf_mind"`，`reverse`／`trial` 時 `current.revealed[pid] = "forced"`。

- [ ] **Step 1：寫失敗的檢查**（加在 `if (M) {` 區塊內 Task 3 檢查之後）

```js
  function rateAll(s, fn) {
    M.pendingRaters(s).forEach(function (pid, i) {
      s = R(s, { type: "mfRate", playerId: pid, value: fn ? fn(pid, i, s) : M.allowedRatings(s, pid)[0] });
    });
    return s;
  }

  check("rating: only 0/2/5/10, once per player, seat order pending", function () {
    var s = exposed(game(3));
    assert.deepStrictEqual(M.pendingRaters(s), ["p0", "p1", "p2"]);
    assert.strictEqual(M.rateError(s, "p0", 3), "ts_err_mf_rating");
    s = R(s, { type: "mfRate", playerId: "p1", value: 5 });
    assert.strictEqual(M.rateError(s, "p1", 5), "ts_err_not_your_turn");
    assert.deepStrictEqual(M.pendingRaters(s), ["p0", "p2"]);
    assert.strictEqual(s.phase, "mf_rate");
  });

  check("wind holder rating restricted: up -> 0/2, down -> 5/10; others free", function () {
    var s = exposed(game(3, { wind: true }), { wind: "up" });
    var h = s.current.windHolder;
    assert.deepStrictEqual(M.allowedRatings(s, h), [0, 2]);
    assert.strictEqual(M.rateError(s, h, 5), "ts_err_mf_rating");
    var other = s.players.filter(function (p) { return p.id !== h; })[0].id;
    assert.deepStrictEqual(M.allowedRatings(s, other), [0, 2, 5, 10]);
    var s2 = exposed(game(3, { wind: true }), { wind: "down" });
    assert.deepStrictEqual(M.allowedRatings(s2, s2.current.windHolder), [5, 10]);
  });

  check("all rated -> mf_mind; no forced reveal without event", function () {
    var s = rateAll(exposed(game(3)));
    assert.strictEqual(s.phase, "mf_mind");
    assert.deepStrictEqual(s.current.revealed, {});
  });

  check("trial forces blamer reveal; reverse forces poorest (seat tiebreak)", function () {
    var s = rateAll(exposed(game(3, { swan: true }), { event: "trial" }));
    var rv = {}; rv[s.current.blamerId] = "forced";
    assert.deepStrictEqual(s.current.revealed, rv);
    var g = game(3, { swan: true });
    g.players[2].chips = 300; g.players[1].chips = 300;
    s = rateAll(exposed(g, { event: "reverse" }));
    assert.deepStrictEqual(s.current.revealed, { p1: "forced" });
  });
```

- [ ] **Step 2：執行確認失敗**

Run：`node tools/toushou_check/manfen_core_check.js`
Expected：新的 4 條 FAIL（`M.pendingRaters is not a function`）。

- [ ] **Step 3：實作**（在 `// ---------------- reducer 入口` 之前加入）

```js
  // ---------------- 秘密評分（spec §3.4） ----------------

  function allowedRatings(s, pid) {
    var c = s.current;
    if (c && c.windHolder === pid && WIND_RATINGS[c.windCard]) return WIND_RATINGS[c.windCard].slice();
    return RATINGS.slice();
  }

  function pendingRaters(s) {
    if (s.phase !== "mf_rate" || !s.current) return [];
    var r = s.current.ratings;
    return s.players.filter(function (p) { return !Object.prototype.hasOwnProperty.call(r, p.id); })
      .map(function (p) { return p.id; });
  }

  function rateError(s, pid, value) {
    if (pendingRaters(s).indexOf(pid) < 0) return "ts_err_not_your_turn";
    if (allowedRatings(s, pid).indexOf(value) < 0) return "ts_err_mf_rating";
    return null;
  }

  function rate(s, a) {
    var err = rateError(s, a.playerId, a.value);
    if (err) throw new Error(err);
    s.current.ratings[a.playerId] = a.value;
    if (!pendingRaters(s).length) enterMind(s);
  }

  // 評分鎖定後進入心理戰；逆序發言／全民公審在此強制亮牌（免費，spec §3.5）
  function enterMind(s) {
    var c = s.current;
    s.phase = "mf_mind";
    var forced = null;
    if (c.event === "reverse") {
      forced = s.players.map(function (p, i) { return { id: p.id, chips: p.chips, seat: i }; })
        .sort(function (a, b) { return a.chips - b.chips || a.seat - b.seat; })[0].id;
    } else if (c.event === "trial") {
      forced = c.blamerId;
    }
    if (forced) c.revealed[forced] = "forced";
  }
```

`apply()` 的 switch 加：

```js
      case "mfRate": need(s, "mf_rate"); rate(s, action); break;
```

匯出物件加 `allowedRatings: allowedRatings, pendingRaters: pendingRaters, rateError: rateError,`。

- [ ] **Step 4：執行確認通過**

Run：`node --check static_src/toushou_core_manfen.js && node tools/toushou_check/manfen_core_check.js`
Expected：全部 ok。

- [ ] **Step 5：commit**

```bash
git add static_src/toushou_core_manfen.js tools/toushou_check/manfen_core_check.js
git commit -m "feat(toushou): 滿分男模式秘密評分（帶風向者限制、逆序發言／全民公審強制亮牌）"
```

---

### Task 5：心理戰（封口費競價）

**Files:**
- Modify: `static_src/toushou_core_manfen.js`
- Modify: `tools/toushou_check/manfen_core_check.js`

**Interfaces:**
- Produces：
  - `M.requestMin(s) -> int`：`max(1, ceil(minBet / (event === "extra" ? 4 : 2)))`
  - `M.requestError(s, from, to, offer)`、`M.respondError(s, pid, choice)`、`M.raiseError(s, pid, offer)` → key|null
  - action：`{type:"mfRequest", from, to, offer}`、`{type:"mfRespond", playerId, choice:"reveal"|"refuse"}`、`{type:"mfRaise", playerId, offer}`、`{type:"mfDrop", playerId}`、`{type:"mfEndMind"}`
  - `current.pendingRequest = { from, to, offers: [int], awaitingRaise: bool } | null`
  - `current.requests[] = { from, to, offers, outcome: "revealed"|"refused" }`
  - `mfEndMind` → `current.bettors`＝籌碼 > 0 的玩家（座位順序），`phase = "bet"`；沒有人可下注時直接結算（Task 6 的 `settle(s)`；本 Task 先呼叫，Task 6 實作）。

- [ ] **Step 1：寫失敗的檢查**

```js
  function chipsOf(s) { var o = {}; s.players.forEach(function (p) { o[p.id] = p.chips; }); return o; }
  function totalChips(s) {
    var n = s.current ? s.current.mindPot + s.current.pot : 0;
    s.players.forEach(function (p) { n += p.chips; });
    return n;
  }
  function mind(opts) { return rateAll(exposed(game(3, opts), opts)); }

  check("requestMin: half of minBet, quarter with extra", function () {
    assert.strictEqual(M.requestMin(mind()), 50);
    assert.strictEqual(M.requestMin(mind({ swan: true, event: "extra" })), 25);
  });

  check("request validation", function () {
    var s = mind();
    assert.strictEqual(M.requestError(s, "p0", "p0", 50), "ts_err_mf_request_self");
    assert.strictEqual(M.requestError(s, "p0", "p1", 49), "ts_err_mf_offer");
    assert.strictEqual(M.requestError(s, "p0", "p1", 1001), "ts_err_mf_offer");
    assert.strictEqual(M.requestError(s, "p0", "p1", 50.5), "ts_err_int");
    assert.strictEqual(M.requestError(s, "p0", "p1", 50), null);
  });

  check("reveal: requester pays offer into mindPot, target revealed, chips conserved", function () {
    var s = mind();
    var before = totalChips(s);
    s = R(s, { type: "mfRequest", from: "p0", to: "p1", offer: 80 });
    assert.strictEqual(M.requestError(s, "p2", "p0", 50), "ts_err_mf_request_pending");
    assert.strictEqual(M.respondError(s, "p0", "reveal"), "ts_err_mf_not_target");
    s = R(s, { type: "mfRespond", playerId: "p1", choice: "reveal" });
    assert.strictEqual(s.current.revealed.p1, "paid");
    assert.strictEqual(s.current.mindPot, 80);
    assert.deepStrictEqual(s.current.mindPaid, { p0: 80 });
    assert.strictEqual(chipsOf(s).p0, 920);
    assert.deepStrictEqual(s.current.requests, [{ from: "p0", to: "p1", offers: [80], outcome: "revealed" }]);
    assert.strictEqual(s.current.pendingRequest, null);
    assert.strictEqual(totalChips(s), before);
    assert.strictEqual(M.requestError(s, "p0", "p2", 50), "ts_err_mf_request_used");
    assert.strictEqual(M.requestError(s, "p2", "p1", 50), "ts_err_mf_request_revealed");
  });

  check("refuse -> raise -> refuse: both pay each round; request closed", function () {
    var s = mind();
    var before = totalChips(s);
    s = R(s, { type: "mfRequest", from: "p0", to: "p1", offer: 60 });
    s = R(s, { type: "mfRespond", playerId: "p1", choice: "refuse" });
    assert.strictEqual(s.current.pendingRequest.awaitingRaise, true);
    assert.strictEqual(s.current.mindPot, 120);
    assert.strictEqual(M.raiseError(s, "p1", 100), "ts_err_mf_not_requester");
    assert.strictEqual(M.raiseError(s, "p0", 60), "ts_err_mf_offer");
    s = R(s, { type: "mfRaise", playerId: "p0", offer: 100 });
    s = R(s, { type: "mfRespond", playerId: "p1", choice: "refuse" });
    assert.strictEqual(s.current.mindPot, 320);
    assert.deepStrictEqual(s.current.mindPaid, { p0: 160, p1: 160 });
    assert.deepStrictEqual(s.current.requests, [{ from: "p0", to: "p1", offers: [60, 100], outcome: "refused" }]);
    assert.strictEqual(s.current.revealed.p1, undefined);
    assert.strictEqual(totalChips(s), before);
  });

  check("drop after refusal closes as refused; raise then reveal", function () {
    var s = mind();
    s = R(s, { type: "mfRequest", from: "p0", to: "p1", offer: 60 });
    s = R(s, { type: "mfRespond", playerId: "p1", choice: "refuse" });
    s = R(s, { type: "mfDrop", playerId: "p0" });
    assert.strictEqual(s.current.requests[0].outcome, "refused");
    s = R(s, { type: "mfRequest", from: "p1", to: "p2", offer: 50 });
    s = R(s, { type: "mfRespond", playerId: "p2", choice: "refuse" });
    s = R(s, { type: "mfRaise", playerId: "p1", offer: 70 });
    s = R(s, { type: "mfRespond", playerId: "p2", choice: "reveal" });
    assert.strictEqual(s.current.revealed.p2, "paid");
    assert.deepStrictEqual(s.current.requests[1].offers, [50, 70]);
  });

  check("target cannot refuse without enough chips", function () {
    var g = game(3);
    g.players[1].chips = 40;
    var s = rateAll(exposed(g));
    s = R(s, { type: "mfRequest", from: "p0", to: "p1", offer: 50 });
    assert.strictEqual(M.respondError(s, "p1", "refuse"), "ts_err_mf_refuse_chips");
    assert.strictEqual(M.respondError(s, "p1", "reveal"), null);
  });

  check("end mind: blocked while pending; bettors = players with chips", function () {
    var s = mind();
    s = R(s, { type: "mfRequest", from: "p0", to: "p1", offer: 50 });
    assert.throws(function () { R(s, { type: "mfEndMind" }); }, /ts_err_mf_pending_open/);
    s = R(s, { type: "mfRespond", playerId: "p1", choice: "reveal" });
    s.players[2].chips = 0;
    s = R(s, { type: "mfEndMind" });
    assert.strictEqual(s.phase, "bet");
    assert.deepStrictEqual(s.current.bettors, ["p0", "p1"]);
  });
```

- [ ] **Step 2：執行確認失敗**

Run：`node tools/toushou_check/manfen_core_check.js`
Expected：新的 7 條 FAIL。

- [ ] **Step 3：實作**（`enterMind` 之後加入）

```js
  // ---------------- 心理戰：封口費競價（spec §3.5） ----------------

  function requestMin(s) {
    var div = s.current && s.current.event === "extra" ? 4 : 2;
    return Math.max(1, Math.ceil(s.config.minBet / div));
  }

  function lastOffer(r) { return r.offers[r.offers.length - 1]; }

  function payMind(s, pid, x) {
    var c = s.current;
    playerById(s, pid).chips -= x;
    c.mindPot += x;
    c.mindPaid[pid] = (c.mindPaid[pid] || 0) + x;
  }

  function closeRequest(c, outcome) {
    var r = c.pendingRequest;
    c.requests.push({ from: r.from, to: r.to, offers: r.offers.slice(), outcome: outcome });
    c.pendingRequest = null;
  }

  function requestError(s, from, to, offer) {
    if (s.phase !== "mf_mind" || !s.current) return "ts_err_phase";
    var c = s.current;
    if (c.pendingRequest) return "ts_err_mf_request_pending";
    var pf = playerById(s, from);
    if (!pf || !playerById(s, to)) return "ts_err_not_your_turn";
    if (from === to) return "ts_err_mf_request_self";
    if (c.requests.some(function (r) { return r.from === from; })) return "ts_err_mf_request_used";
    if (c.revealed[to]) return "ts_err_mf_request_revealed";
    if (!isInt(offer)) return "ts_err_int";
    if (offer < requestMin(s) || offer > pf.chips) return "ts_err_mf_offer";
    return null;
  }

  function request(s, a) {
    var err = requestError(s, a.from, a.to, a.offer);
    if (err) throw new Error(err);
    s.current.pendingRequest = { from: a.from, to: a.to, offers: [a.offer], awaitingRaise: false };
  }

  function respondError(s, pid, choice) {
    var r = s.current && s.current.pendingRequest;
    if (s.phase !== "mf_mind" || !r || r.awaitingRaise) return "ts_err_phase";
    if (pid !== r.to) return "ts_err_mf_not_target";
    if (choice !== "reveal" && choice !== "refuse") return "ts_err_phase";
    if (choice === "refuse" && playerById(s, r.to).chips < lastOffer(r)) return "ts_err_mf_refuse_chips";
    return null;
  }

  // 亮牌：要求者付 X；拒絕：雙方各付 X（要求本身就要花錢）。第 1 次被拒絕可加價一次。
  function respond(s, a) {
    var err = respondError(s, a.playerId, a.choice);
    if (err) throw new Error(err);
    var c = s.current;
    var r = c.pendingRequest;
    var x = lastOffer(r);
    payMind(s, r.from, x);
    if (a.choice === "reveal") {
      c.revealed[r.to] = "paid";
      closeRequest(c, "revealed");
      return;
    }
    payMind(s, r.to, x);
    if (r.offers.length >= 2) closeRequest(c, "refused");
    else r.awaitingRaise = true;
  }

  function raiseError(s, pid, offer) {
    var r = s.current && s.current.pendingRequest;
    if (s.phase !== "mf_mind" || !r || !r.awaitingRaise) return "ts_err_phase";
    if (pid !== r.from) return "ts_err_mf_not_requester";
    if (!isInt(offer)) return "ts_err_int";
    if (offer <= lastOffer(r) || offer > playerById(s, r.from).chips) return "ts_err_mf_offer";
    return null;
  }

  function raise(s, a) {
    var err = raiseError(s, a.playerId, a.offer);
    if (err) throw new Error(err);
    var r = s.current.pendingRequest;
    r.offers.push(a.offer);
    r.awaitingRaise = false;
  }

  function drop(s, a) {
    var r = s.current.pendingRequest;
    if (!r || !r.awaitingRaise) throw new Error("ts_err_phase");
    if (a.playerId !== r.from) throw new Error("ts_err_mf_not_requester");
    closeRequest(s.current, "refused");
  }

  function endMind(s) {
    var c = s.current;
    if (c.pendingRequest) throw new Error("ts_err_mf_pending_open");
    c.bettors = s.players.filter(function (p) { return p.chips > 0; }).map(function (p) { return p.id; });
    if (!c.bettors.length) { settle(s); return; }
    s.phase = "bet";
  }
```

暫時在 Task 6 之前補一個 `function settle(s) { throw new Error("ts_err_phase"); }`（Task 6 取代）。

`apply()` switch 加：

```js
      case "mfRequest": need(s, "mf_mind"); request(s, action); break;
      case "mfRespond": need(s, "mf_mind"); respond(s, action); break;
      case "mfRaise": need(s, "mf_mind"); raise(s, action); break;
      case "mfDrop": need(s, "mf_mind"); drop(s, action); break;
      case "mfEndMind": need(s, "mf_mind"); endMind(s); break;
```

匯出物件加 `requestMin: requestMin, requestError: requestError, respondError: respondError, raiseError: raiseError,`。

- [ ] **Step 4：執行確認通過**

Run：`node --check static_src/toushou_core_manfen.js && node tools/toushou_check/manfen_core_check.js`
Expected：全部 ok。

- [ ] **Step 5：commit**

```bash
git add static_src/toushou_core_manfen.js tools/toushou_check/manfen_core_check.js
git commit -m "feat(toushou): 滿分男模式心理戰（封口費競價亮牌、加價、籌碼守恆）"
```

---

### Task 6：下注、群體平均、結算

**Files:**
- Modify: `static_src/toushou_core_manfen.js`
- Modify: `tools/toushou_check/manfen_core_check.js`

**Interfaces:**
- Produces：
  - `M.predictMax(s) -> 100 | 150`、`M.betError(s, pid, amount, predict10) -> key|null`
  - action `{type:"placeBet", playerId, amount, predict}`（predict 為 ×10 整數）；全員下注完 → `settle(s)`
  - `history[i]`／`lastSettlement`：`{ mode:"manfen", targetId, category, name, tags, summary, blamerId, flaw, event, windCard, windHolder, ratings, revealed, requests, mindPaid, mindPot, tally: [{playerId, rating, value, weight, voided, removed}], median, avg10, finalPrice (= avg10), pot, bets, ranks, payouts, news: [], cancelled, refundMind, bonus, startPrice:null, sectorFrom:null, gap:null, rumorIndex:null, rumorDelta:null }`
  - `phase = "settle"`；之後 `nextTarget` 沿用。

- [ ] **Step 1：寫失敗的檢查**

```js
  // 指定每人評分 → 結束心理戰 → 依 bets 下注（{pid: [amount, predict10]}）
  // ratings 沒指定的人（或帶風向者）用 allowedRatings 的第一個值
  function playRound(s, ratings, bets, opts) {
    opts = opts || {};
    s = exposed(s, opts);
    s = rateAll(s, function (pid, i, cur) {
      return ratings[pid] !== undefined ? ratings[pid] : M.allowedRatings(cur, pid)[0];
    });
    if (opts.beforeEnd) s = opts.beforeEnd(s);
    s = R(s, { type: "mfEndMind" });
    s.current.bettors.forEach(function (pid) {
      var b = bets[pid] || [100, 50];
      s = R(s, { type: "placeBet", playerId: pid, amount: b[0], predict: b[1] });
    });
    return s;
  }
  var R3 = { p0: 0, p1: 5, p2: 10 };

  check("bet: predict range 0..100, 150 with fomo", function () {
    var s = R(rateAll(exposed(game(3))), { type: "mfEndMind" });
    assert.strictEqual(M.betError(s, "p0", 100, 101), "ts_err_mf_predict_range");
    assert.strictEqual(M.betError(s, "p0", 100, 100), null);
    assert.strictEqual(M.betError(s, "p0", 50, 50), "ts_err_bet_min");
    var f = R(rateAll(exposed(game(3, { swan: true }), { event: "fomo" })), { type: "mfEndMind" });
    assert.strictEqual(M.predictMax(f), 150);
    assert.strictEqual(M.betError(f, "p0", 100, 150), null);
  });

  check("plain average (×10, round half up) and pot split via settleTarget", function () {
    // (0 + 50 + 100) / 3 = 50
    var s = playRound(game(3), R3, { p0: [100, 50], p1: [100, 40], p2: [100, 90] });
    var h = s.lastSettlement;
    assert.strictEqual(s.phase, "settle");
    assert.strictEqual(h.mode, "manfen");
    assert.strictEqual(h.avg10, 50);
    assert.strictEqual(h.finalPrice, 50);
    assert.strictEqual(h.pot, 300);
    assert.deepStrictEqual(h.ranks, { p0: 1, p1: 2, p2: 3 });
    assert.deepStrictEqual(h.payouts, { p0: 210, p1: 90, p2: 0 });
    // (0 + 2 + 2)/3 = 13.33 -> 13；(2 + 5)/2 = 35；0 + 5 + 10 + 10 = 62.5 -> 63
    assert.strictEqual(playRound(game(3), { p0: 0, p1: 2, p2: 2 }, {}).lastSettlement.avg10, 13);
    assert.strictEqual(playRound(game(2), { p0: 2, p1: 5 }, {}).lastSettlement.avg10, 35);
    assert.strictEqual(playRound(game(4), { p0: 0, p1: 5, p2: 10, p3: 10 }, {}).lastSettlement.avg10, 63);
  });

  check("wind holder counts 2 votes; hype and whale stack +1 each", function () {
    var s = exposed(game(3, { wind: true }), { wind: "down" });
    var h = s.current.windHolder;
    var ratings = {}; s.players.forEach(function (p) { ratings[p.id] = p.id === h ? 10 : 0; });
    s = rateAll(s, function (pid) { return ratings[pid]; });
    s = R(s, { type: "mfEndMind" });
    s.current.bettors.forEach(function (pid) { s = R(s, { type: "placeBet", playerId: pid, amount: 100, predict: 50 }); });
    // (100×2 + 0 + 0) / 4 = 50
    assert.strictEqual(s.lastSettlement.avg10, 50);
    var row = s.lastSettlement.tally.filter(function (r) { return r.playerId === h; })[0];
    assert.strictEqual(row.weight, 2);
  });

  check("hype: blamer +1 vote; whale: top bettor(s) +1", function () {
    var g = game(3, { swan: true });
    var s = playRound(g, R3, {}, { event: "hype" });
    var b = s.lastSettlement.blamerId;
    s.lastSettlement.tally.forEach(function (r) { assert.strictEqual(r.weight, r.playerId === b ? 2 : 1); });
    s = playRound(game(3, { swan: true }), R3, { p0: [100, 0], p1: [100, 0], p2: [300, 0] }, { event: "whale" });
    // (0 + 50 + 100×2) / 4 = 62.5 -> 63
    assert.strictEqual(s.lastSettlement.avg10, 63);
  });

  check("fomo / panic / lull change vote values", function () {
    assert.strictEqual(playRound(game(3, { swan: true }), R3, {}, { event: "fomo" }).lastSettlement.avg10, 67); // (0+50+150)/3
    assert.strictEqual(playRound(game(3, { swan: true }), { p0: 2, p1: 2, p2: 5 }, {}, { event: "panic" }).lastSettlement.avg10, 50);
    assert.strictEqual(playRound(game(3, { swan: true }), R3, {}, { event: "lull" }).lastSettlement.avg10, 25); // (0+25+50)/3
  });

  check("circuit removes one highest and one lowest (needs >= 3 votes)", function () {
    var s = playRound(game(4, { swan: true }), { p0: 0, p1: 2, p2: 5, p3: 10 }, {}, { event: "circuit" });
    assert.strictEqual(s.lastSettlement.avg10, 35); // (20 + 50) / 2
    var removed = s.lastSettlement.tally.filter(function (r) { return r.removed; }).map(function (r) { return r.playerId; });
    assert.deepStrictEqual(removed, ["p0", "p3"]);
    var same = playRound(game(3, { swan: true }), { p0: 5, p1: 5, p2: 5 }, {}, { event: "circuit" });
    assert.strictEqual(same.lastSettlement.avg10, 50);
    assert.strictEqual(same.lastSettlement.tally.filter(function (r) { return r.removed; }).length, 2);
    var two = playRound(game(2, { swan: true }), { p0: 0, p1: 10 }, {}, { event: "circuit" });
    assert.strictEqual(two.lastSettlement.avg10, 50);
  });

  check("exhausted uses weighted median", function () {
    assert.strictEqual(playRound(game(3, { swan: true }), { p0: 0, p1: 2, p2: 10 }, {}, { event: "exhausted" }).lastSettlement.avg10, 20);
    var s = playRound(game(4, { swan: true }), { p0: 0, p1: 2, p2: 5, p3: 10 }, {}, { event: "exhausted" });
    assert.strictEqual(s.lastSettlement.avg10, 35); // (20+50)/2
    assert.strictEqual(s.lastSettlement.median, true);
  });

  check("rumor voids exactly one vote, deterministic for same seed", function () {
    var a = playRound(game(3, { swan: true }), R3, {}, { event: "rumor" });
    var b = playRound(game(3, { swan: true }), R3, {}, { event: "rumor" });
    var va = a.lastSettlement.tally.filter(function (r) { return r.voided; });
    assert.strictEqual(va.length, 1);
    assert.deepStrictEqual(a.lastSettlement, b.lastSettlement);
  });

  check("mindPot joins the pot; chips conserved through settle", function () {
    var s = game(3);
    var before = 3000;
    s = playRound(s, R3, { p0: [100, 50], p1: [100, 40], p2: [100, 90] }, { beforeEnd: function (x) {
      x = R(x, { type: "mfRequest", from: "p2", to: "p0", offer: 60 });
      x = R(x, { type: "mfRespond", playerId: "p0", choice: "refuse" });
      // 被拒絕後處於「等待加價」，結束心理戰前要先放棄
      return R(x, { type: "mfDrop", playerId: "p2" });
    } });
    // p0、p2 各付 60
    assert.strictEqual(s.lastSettlement.pot, 300 + 120);
    var total = 0; s.players.forEach(function (p) { total += p.chips; });
    assert.strictEqual(total, before);
  });

  check("cancel refunds bets and mind payments when avg in 45..55", function () {
    var s = playRound(game(3, { swan: true }), R3, { p0: [100, 0] }, { event: "cancel", beforeEnd: function (x) {
      x = R(x, { type: "mfRequest", from: "p1", to: "p2", offer: 50 });
      return R(x, { type: "mfRespond", playerId: "p2", choice: "reveal" });
    } });
    var h = s.lastSettlement;
    assert.strictEqual(h.cancelled, true);
    assert.deepStrictEqual(h.ranks, {});
    s.players.forEach(function (p) { assert.strictEqual(p.chips, 1000); });
  });

  check("upset pays the worst predictor; bailout adds 50% (incl. mindPot)", function () {
    var u = playRound(game(3, { swan: true }), R3, { p0: [100, 50], p1: [100, 40], p2: [100, 90] }, { event: "upset" });
    assert.strictEqual(u.lastSettlement.ranks.p2, 1);
    var b = playRound(game(3, { swan: true }), R3, {}, { event: "bailout" });
    assert.strictEqual(b.lastSettlement.bonus, 150);
    assert.strictEqual(b.lastSettlement.pot, 450);
  });

  check("no bettors: mind payments refunded, nobody ranked", function () {
    var s = exposed(game(2));
    s = rateAll(s);
    s = R(s, { type: "mfRequest", from: "p0", to: "p1", offer: 50 });
    s = R(s, { type: "mfRespond", playerId: "p1", choice: "reveal" });
    // p0 已付 50（mindPaid.p0 = 50）；之後全員籌碼歸零 → 沒有人能下注
    s.players.forEach(function (p) { p.chips = 0; });
    s = R(s, { type: "mfEndMind" });
    assert.strictEqual(s.phase, "settle");
    assert.strictEqual(s.lastSettlement.refundMind, true);
    assert.strictEqual(s.players[0].chips, 50);
  });

  check("full game: 3 players x 3 subjects, rotation, then final; deterministic", function () {
    function run() {
      var s = game(3, { wind: true, swan: true, targets: 3 });
      for (var k = 0; k < 3; k++) {
        assert.strictEqual(s.phase, "reveal_target");
        s = playRound(s, {}, {}); // 啟用帶風向時不能固定評分，全部用 allowedRatings 的第一個值
        assert.strictEqual(s.lastSettlement.blamerId, M.blamerFor(s, k));
        s = R(s, { type: "nextTarget" });
      }
      return s;
    }
    var a = run();
    assert.strictEqual(a.phase, "final");
    assert.strictEqual(a.history.length, 3);
    assert.deepStrictEqual(Core.evaluateMissions(a), []);
    assert.strictEqual(Core.finalStandings(a).length, 3);
    assert.deepStrictEqual(run(), a);
  });
```

- [ ] **Step 2：執行確認失敗**

Run：`node tools/toushou_check/manfen_core_check.js`
Expected：新的檢查 FAIL（`M.betError is not a function` 等）。

- [ ] **Step 3：實作**（取代暫時的 `settle`，加在 `endMind` 之後）

```js
  // ---------------- 下注（spec §3.6） ----------------

  function predictMax(s) { return s.current && s.current.event === "fomo" ? 150 : 100; }

  // 押注額規則沿用經典模式；預測為群體平均 ×10 的整數
  function betError(s, pid, amount, predict) {
    var e = Core.betError(s, pid, amount, predict);
    if (e) return e;
    if (predict > predictMax(s)) return "ts_err_mf_predict_range";
    return null;
  }

  function placeBet(s, a) {
    var err = betError(s, a.playerId, a.amount, a.predict);
    if (err) throw new Error(err);
    var p = playerById(s, a.playerId);
    s.current.bets[a.playerId] = { amount: a.amount, predict: a.predict, chipsBefore: p.chips };
    p.chips -= a.amount;
    s.current.pot += a.amount;
    if (!Core.pendingBettors(s).length) settle(s);
  }

  // ---------------- 群體平均（spec §3.7、§5 A 類） ----------------
  // 順序：作廢（rumor）→ 票值修正（fomo／panic／lull）→ 去極值（circuit）→ 平均或中位數（exhausted）

  function tally(s) {
    var c = s.current;
    var ev = c.event;
    var rows = s.players.filter(function (p) { return Object.prototype.hasOwnProperty.call(c.ratings, p.id); })
      .map(function (p) {
        return { playerId: p.id, rating: c.ratings[p.id], value: c.ratings[p.id] * 10, weight: 1, voided: false, removed: false };
      });
    if (ev === "rumor" && rows.length > 1) rows[Math.floor(rand(s) * rows.length)].voided = true;
    var maxBet = 0;
    Object.keys(c.bets).forEach(function (id) { if (c.bets[id].amount > maxBet) maxBet = c.bets[id].amount; });
    rows.forEach(function (r) {
      if (ev === "fomo" && r.rating === 10) r.value = 150;
      if (ev === "panic" && r.rating === 2) r.value = 50;
      if (ev === "lull") r.value = r.value / 2; // 0／20／50／100 減半後仍是整數
      if (c.windHolder === r.playerId) r.weight += 1;
      if (ev === "hype" && c.blamerId === r.playerId) r.weight += 1;
      if (ev === "whale" && maxBet > 0 && c.bets[r.playerId] && c.bets[r.playerId].amount === maxBet) r.weight += 1;
    });
    var live = rows.filter(function (r) { return !r.voided; });
    if (ev === "circuit" && live.length >= 3) {
      var hi = live[0];
      var lo = live[0];
      live.forEach(function (r) {
        if (r.value > hi.value) hi = r;
        if (r.value < lo.value) lo = r;
      });
      if (hi === lo) lo = live[1]; // 全部同分：去掉座位最前的兩張
      hi.removed = true;
      lo.removed = true;
      live = live.filter(function (r) { return !r.removed; });
    }
    var avg10;
    if (ev === "exhausted") {
      var list = [];
      live.forEach(function (r) { for (var k = 0; k < r.weight; k++) list.push(r.value); });
      list.sort(function (a, b) { return a - b; });
      var m = list.length;
      avg10 = !m ? 0 : (m % 2 ? list[(m - 1) / 2] : Math.floor((list[m / 2 - 1] + list[m / 2] + 1) / 2));
    } else {
      var sum = 0;
      var w = 0;
      live.forEach(function (r) { sum += r.value * r.weight; w += r.weight; });
      avg10 = w ? Math.floor((2 * sum + w) / (2 * w)) : 0; // 四捨五入（值皆非負）
    }
    return { rows: rows, avg10: avg10, median: ev === "exhausted" };
  }

  // ---------------- 結算（spec §3.7、§5 C 類） ----------------

  function settle(s) {
    var c = s.current;
    var target = s.targets[s.targetIndex];
    var seat = s.players.map(function (p) { return p.id; });
    var tl = tally(s);
    var cancelled = c.event === "cancel" && tl.avg10 >= 45 && tl.avg10 <= 55;
    var betSum = 0;
    seat.forEach(function (id) { if (c.bets[id]) betSum += c.bets[id].amount; });
    var bonus = 0;
    var refundMind = false;
    var r;
    if (cancelled || betSum === 0) {
      // 交易取消，或沒有人押注：押注與心理戰付出全數退回，沒有名次
      r = { pot: 0, ranks: {}, payouts: {} };
      seat.forEach(function (id) {
        var back = (c.bets[id] ? c.bets[id].amount : 0) + (c.mindPaid[id] || 0);
        if (back > 0) { r.payouts[id] = back; r.pot += back; }
      });
      refundMind = !cancelled && c.mindPot > 0;
    } else {
      if (c.event === "bailout") bonus = Math.floor((betSum + c.mindPot) * 0.5);
      // settleTarget 會把 opts.bonus 加進彩池：這裡用它帶入心理戰累積＋紓困加碼
      r = I.settleTarget(c.bets, tl.avg10, seat, { reverse: c.event === "upset", bonus: bonus + c.mindPot });
    }
    Object.keys(r.payouts).forEach(function (id) { playerById(s, id).chips += r.payouts[id]; });
    var entry = {
      mode: "manfen",
      targetId: target.id,
      category: target.category,
      name: target.name,
      tags: target.tags,
      summary: target.summary,
      blamerId: c.blamerId,
      flaw: c.flaw,
      event: c.event,
      windCard: c.windCard,
      windHolder: c.windHolder,
      ratings: c.ratings,
      revealed: c.revealed,
      requests: c.requests,
      mindPaid: c.mindPaid,
      mindPot: c.mindPot,
      tally: tl.rows,
      median: tl.median,
      avg10: tl.avg10,
      finalPrice: tl.avg10, // 共用畫面／任務判定讀 finalPrice
      pot: r.pot,
      bets: c.bets,
      ranks: r.ranks,
      payouts: r.payouts,
      news: [],
      cancelled: cancelled,
      refundMind: refundMind,
      bonus: bonus,
      startPrice: null,
      sectorFrom: null,
      gap: null,
      rumorIndex: null,
      rumorDelta: null
    };
    s.history.push(entry);
    s.lastSettlement = clone(entry);
    s.phase = "settle";
  }
```

`apply()` switch 加 `case "placeBet": need(s, "bet"); placeBet(s, action); break;`；匯出加 `predictMax: predictMax, betError: betError,`。

- [ ] **Step 4：執行確認通過**

Run：`node --check static_src/toushou_core_manfen.js && node tools/toushou_check/manfen_core_check.js && node tools/toushou_check/core_check.js`
Expected：全部 ok。手算核對：彩池 300、3 位參與者 → 比例 70/30；誤差 p0＝0、p1＝10、p2＝40 → p0 210、p1 90、p2 0。

- [ ] **Step 5：commit**

```bash
git add static_src/toushou_core_manfen.js tools/toushou_check/manfen_core_check.js
git commit -m "feat(toushou): 滿分男模式下注、群體平均（票權與黑天鵝修正）與結算"
```

---

### Task 7：設定畫面與 i18n（設定相關）

**Files:**
- Modify: `static_src/toushou.js`
- Modify: `site_src/i18n_data_zh.py`、`site_src/i18n_data_ja.py`、`site_src/i18n_data_en.py`（加在 `"ts_insider_uneven"` 那一行之後）

**Interfaces:**
- Consumes：`M.pickTargets`、`M.categoryById`、`D.MANFEN_CATEGORIES`。
- Produces：設定畫面 DOM id：`#ts-game-mode` 多一個 `manfen` 選項；`.ts-mf-cat`（專用類別勾選）、`.ts-cat`（manfen 時代表「也加入的現有類別」）、`#ts-mf-uneven`、`#ts-wind`、`#ts-swan`（manfen 時沿用同 id，文字不同）；manfen 時不出現 `#ts-missions`、`#ts-sector`、`#ts-delta-mode`、`#ts-vote-cap`。

- [ ] **Step 1：加 i18n（三語）**

zh：

```python
    "ts_game_mode_manfen": "滿分男模式",
    "ts_game_mode_manfen_desc": "爆料者替滿分對象加一個缺點，每人秘密評分扣 0／2／5／10 分，再押注預測全場的平均扣分。可以花籌碼要求別人亮牌，對方也能付封口費拒絕。猜得最接近平均的人瓜分彩池。",
    "ts_mf_categories": "滿分題庫",
    "ts_mf_classic_categories": "也加入現有標的類別",
    "ts_mf_wind_enabled": "啟用帶風向的人（風向卡）",
    "ts_mf_swan_enabled": "啟用滿分男黑天鵝卡",
    "ts_mf_uneven": "題數不是人數的倍數，每人當爆料者的次數會不平均",
    "ts_err_setup_mf_categories": "請至少勾選 1 個類別",
```

ja：

```python
    "ts_game_mode_manfen": "満点男子モード",
    "ts_game_mode_manfen_desc": "暴露者が満点の相手に欠点を1つ加え、全員がこっそり 0／2／5／10 点の減点を選び、全体の平均減点を予想して賭けます。チップを払って他の人に公開を求められ、相手は口止め料で断ることもできます。平均に最も近い人がポットを分け合います。",
    "ts_mf_categories": "満点お題",
    "ts_mf_classic_categories": "既存の銘柄カテゴリも加える",
    "ts_mf_wind_enabled": "風向き役を使う（風向きカード）",
    "ts_mf_swan_enabled": "満点男子用ブラックスワンカードを使う",
    "ts_mf_uneven": "お題の数が人数の倍数ではないため、暴露者の回数が偏ります",
    "ts_err_setup_mf_categories": "カテゴリを1つ以上選んでください",
```

en：

```python
    "ts_game_mode_manfen": "Perfect Partner",
    "ts_game_mode_manfen_desc": "The exposer adds one flaw to a perfect subject. Everyone secretly deducts 0/2/5/10 points, then bets on the group's average deduction. You can pay chips to make someone reveal, and they can pay hush money to refuse. The closest guesses split the pot.",
    "ts_mf_categories": "Perfect subjects",
    "ts_mf_classic_categories": "Also add existing target categories",
    "ts_mf_wind_enabled": "Use the influencer (wind cards)",
    "ts_mf_swan_enabled": "Use Perfect Partner black swan cards",
    "ts_mf_uneven": "The number of subjects is not a multiple of the player count, so exposer turns will be uneven",
    "ts_err_setup_mf_categories": "Pick at least one category",
```

- [ ] **Step 2：修改 `toushou.js` 設定相關**

1. 檔頭註解加一行：`//           docs/superpowers/specs/2026-10-27-toushou-manfen-mode-design.md（滿分男模式）`
2. `var Storage = window.PriTestGameStorage;` 之後加：

```js
  var M = window.PriTestToushouManfen;
```

3. `newDraft()` 回傳物件的 `categories:` 之後加：

```js
      mfCategories: D.MANFEN_CATEGORIES.map(function (c) { return c.id; }),
      mfClassicCategories: [],
```

4. `randomizeTargets()` 改為：

```js
  function randomizeTargets() {
    var count = draft.targetCountMode === "players" ? draft.players.length : draft.targetCount;
    if (draft.mode === "manfen") {
      if (!draft.mfCategories.length && !draft.mfClassicCategories.length) {
        draft.error = t("ts_err_setup_mf_categories");
        return;
      }
      draft.targets = M.pickTargets(draft.mfCategories, draft.mfClassicCategories, count, newSeed());
    } else {
      if (!draft.categories.length) {
        draft.error = t("ts_err_setup_categories");
        return;
      }
      draft.targets = Core.pickRandomTargets(draft.categories, count, newSeed());
    }
    draft.error = draft.targets.length < count ? t("ts_err_setup_pool", { n: draft.targets.length }) : "";
  }
```

5. `buildConfig()`：把 `var insider = draft.mode === "insider";` 改為

```js
    var classic = draft.mode !== "insider" && draft.mode !== "manfen";
```

並把函式內的 `!insider` 全部換成 `classic`，`mode: insider ? "insider" : "classic",` 換成 `mode: classic ? "classic" : draft.mode,`。

6. 模式切換時清空已抽的標的（類別池不同）：`gameModeSel` 的 onchange 改為

```js
      onchange: function (e) { draft.mode = e.target.value; draft.targets = []; render(); } });
```

並把 `["classic", "insider"].forEach` 改為 `["classic", "insider", "manfen"].forEach`。

7. `renderSetup()`：`var insider = draft.mode === "insider";` 下一行加 `var manfen = draft.mode === "manfen";`。把類別勾選區塊（`var cats = el("div", …` 到 `box.appendChild(cats);`）改為：

```js
    // 類別勾選：一組 checkbox（classic／insider＝draft.categories；manfen 的現有類別＝draft.mfClassicCategories）
    function catBoxes(label, list, cls, getSel, setSel) {
      var wrap = el("div", { class: "ts-field" }, [label]);
      list.forEach(function (c) {
        wrap.appendChild(el("label", {}, [el("input", {
          class: cls, type: "checkbox", value: c.id, checked: getSel().indexOf(c.id) >= 0,
          onchange: function (e) {
            if (e.target.checked) setSel(getSel().concat([c.id]));
            else setSel(getSel().filter(function (x) { return x !== c.id; }));
          }
        }), lt(c.name)]));
      });
      return wrap;
    }
    if (manfen) {
      box.appendChild(catBoxes(t("ts_mf_categories"), D.MANFEN_CATEGORIES, "ts-mf-cat",
        function () { return draft.mfCategories; }, function (v) { draft.mfCategories = v; }));
      box.appendChild(catBoxes(t("ts_mf_classic_categories"), D.CATEGORIES, "ts-cat",
        function () { return draft.mfClassicCategories; }, function (v) { draft.mfClassicCategories = v; }));
    } else {
      box.appendChild(catBoxes(t("ts_categories"), D.CATEGORIES, "ts-cat",
        function () { return draft.categories; }, function (v) { draft.categories = v; }));
    }
```

8. 「新增標的」按鈕與標的列的類別 `<select>`：manfen 時選項為專用類別＋現有類別。把 `#ts-btn-add-target` 的 onclick 預設類別改成

```js
          var defCat = manfen ? (draft.mfCategories[0] || D.MANFEN_CATEGORIES[0].id) : (draft.categories[0] || D.CATEGORIES[0].id);
          draft.targets.push({ category: defCat, name: "", tags: [], custom: true });
```

`catSel` 的選項迴圈改為 `(manfen ? D.MANFEN_CATEGORIES.concat(D.CATEGORIES) : D.CATEGORIES).forEach(…)`。

9. 把 `if (insider) { … } else { …四個勾選… }` 改為：

```js
    var tCount = draft.targets.length ||
      (draft.targetCountMode === "players" ? draft.players.length : draft.targetCount);
    var uneven = tCount % draft.players.length !== 0;
    if (insider) {
      // 內線人依座位輪替（每個標的換一人），標的數不是人數的倍數時次數會不平均
      if (uneven) box.appendChild(el("p", { id: "ts-insider-uneven", class: "ts-error", text: t("ts_insider_uneven") }));
    } else if (manfen) {
      // 爆料者同樣依座位輪替；任務卡、板塊連動、加減分方式不適用（manfen spec §2）
      if (uneven) box.appendChild(el("p", { id: "ts-mf-uneven", class: "ts-error", text: t("ts_mf_uneven") }));
      box.appendChild(el("label", { class: "ts-field" }, [el("input", {
        id: "ts-wind", type: "checkbox", checked: draft.windEnabled,
        onchange: function (e) { draft.windEnabled = e.target.checked; }
      }), t("ts_mf_wind_enabled")]));
      box.appendChild(el("label", { class: "ts-field" }, [el("input", {
        id: "ts-swan", type: "checkbox", checked: draft.blackSwanEnabled,
        onchange: function (e) { draft.blackSwanEnabled = e.target.checked; }
      }), t("ts_mf_swan_enabled")]));
    } else {
      // 經典模式：保留原本 else 區塊裡的 #ts-missions、#ts-wind、#ts-swan、#ts-sector 四個勾選框，程式碼原封不動搬進來
    }
```

10. 加減分方式與每票上限：`if (!insider) box.appendChild(… modeSel …)` 改成 `if (!insider && !manfen)`；`if (!insider && draft.deltaMode === "vote")` 改成 `if (!insider && !manfen && draft.deltaMode === "vote")`。

- [ ] **Step 3：建置並手動確認**

Run：`node --check static_src/toushou.js && py -3 generate.py`
Expected：建置成功。開 `py -3 -m http.server 8941 --directory dist`，到 `/toushou/index.html`：選「滿分男模式」→ 出現兩組類別、帶風向／黑天鵝兩個勾選，沒有任務卡／板塊連動／加減分方式；按「隨機產生」會抽出滿分對象。

- [ ] **Step 4：既有 UI 檢查維持通過**

Run（server 開著）：`node tools/toushou_check/ui_check.js && node tools/toushou_check/insider_ui_check.js`
Expected：皆通過。

- [ ] **Step 5：commit**

```bash
git add static_src/toushou.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(toushou): 設定畫面新增滿分男模式（專用題庫、帶風向／黑天鵝選項）"
```

---

### Task 8：滿分男各階段畫面

**Files:**
- Create: `static_src/toushou_ui_manfen.js`
- Modify: `static_src/toushou.js`（`kit()`、`renderGame`、`renderFinal`、`viewKey`）
- Modify: `site_src/toushou_page.py`（`"toushou.js",` 之前加 `"toushou_ui_manfen.js",`）
- Modify: `static_src/css/toushou.css`（檔尾加）
- Modify: `site_src/i18n_data_{zh,ja,en}.py`

**Interfaces:**
- Consumes：Task 3～6 的 `M.*`、`Core.pendingBettors`。
- Produces：
  - `window.PriTestToushouManfenUI = { render(K) -> Node, review(K, h) -> Node }`
  - 工具包 `K = { state(), ui, el, t, lt, P, dispatch, render, owns, masked, waiting, errorLine, hostButton, playerName, playerOf, currentTarget, intOf }`
  - DOM id（Task 9 會用）：`#ts-btn-start-betting`、`#ts-mf-sentence`、`#ts-mf-blamer`、`#ts-swan-badge`、`#ts-mf-wind-maybe`、`#ts-btn-release`、`.ts-btn-play`、`#ts-news-text`、`.ts-mf-rate[data-value]`、`#ts-mf-wind-status`、`#ts-mf-req-from`、`#ts-mf-req-to`、`#ts-mf-req-offer`、`#ts-btn-mf-request`、`#ts-btn-mf-reveal`、`#ts-btn-mf-refuse`、`#ts-mf-raise-offer`、`#ts-btn-mf-raise`、`#ts-btn-mf-drop`、`#ts-btn-mf-end-mind`、`#ts-mf-revealed`、`#ts-mf-mind-pot`、`#ts-bet-amount`、`#ts-bet-predict`、`#ts-btn-confirm-bet`、`#ts-mf-avg`、`#ts-settle-table`、`#ts-btn-next-target`、`#ts-btn-reveal`（遮蔽，沿用）

- [ ] **Step 1：加 i18n（三語）**

zh（`ts_err_*` 放在同一區即可）：

```python
    "ts_mf_subject_heading": "第 {i}／{total} 題　{category}",
    "ts_mf_blamer_is": "本題爆料者：{name}",
    "ts_btn_mf_start": "開始爆料",
    "ts_mf_expose_heading": "{name} 請爆料：替他加一個缺點",
    "ts_wait_mf_expose": "等待 {name} 爆料…",
    "ts_mf_flaw_hand": "缺點手牌",
    "ts_mf_flaw_custom": "自訂缺點",
    "ts_mf_wind_maybe": "本題可能有一位帶風向的人",
    "ts_mf_rate_heading": "{name} 的秘密評分",
    "ts_mf_rate_hint": "這個缺點對你來說要扣幾分？",
    "ts_mf_wind_you_up": "你是帶風向的人（利多）：只能評 0 或 2，你的評分算 2 票",
    "ts_mf_wind_you_down": "你是帶風向的人（利空）：只能評 5 或 10，你的評分算 2 票",
    "ts_mf_wind_you_none": "你不是帶風向的人",
    "ts_mf_rating_n": "扣 {n} 分",
    "ts_wait_mf_rate": "秘密評分中（{done}／{total}）",
    "ts_mf_mind_heading": "心理戰",
    "ts_mf_mind_hint": "可以公開解釋自己的評分，也可以花籌碼要求別人亮牌；對方可以付同額封口費拒絕",
    "ts_mf_gag_hint": "封口令：本題禁止公開解釋",
    "ts_mf_revealed_list": "已亮牌",
    "ts_mf_revealed_item": "{name}：扣 {n} 分",
    "ts_mf_revealed_forced": "（強制）",
    "ts_mf_none_revealed": "還沒有人亮牌",
    "ts_mf_request_from": "要求者",
    "ts_mf_request_to": "要求對象",
    "ts_mf_request_offer": "開價（最少 {min}）",
    "ts_btn_mf_request": "要求亮牌",
    "ts_mf_pending": "{from} 開價 {offer}，要求 {to} 亮牌",
    "ts_btn_mf_reveal": "亮牌",
    "ts_btn_mf_refuse": "付 {offer} 封口費拒絕",
    "ts_mf_refused_raise": "{to} 拒絕了。{from} 要加價再要求一次嗎？",
    "ts_mf_raise_offer": "加價（必須大於 {min}）",
    "ts_btn_mf_raise": "加價",
    "ts_btn_mf_drop": "放棄",
    "ts_wait_mf_respond": "等待 {name} 回應…",
    "ts_wait_mf_raise": "等待 {name} 決定是否加價…",
    "ts_mf_request_log_revealed": "{from} → {to}：開價 {offers}，亮牌",
    "ts_mf_request_log_refused": "{from} → {to}：開價 {offers}，拒絕",
    "ts_mf_mind_pot": "心理戰累積進彩池：{n}",
    "ts_btn_mf_end_mind": "結束心理戰，開始下注",
    "ts_mf_predict": "預測群體平均扣分（0.0～{max}）",
    "ts_mf_settle_avg": "群體平均：扣 {avg} 分",
    "ts_mf_wind_reveal_up": "帶風向的人：{name}（利多）",
    "ts_mf_wind_reveal_down": "帶風向的人：{name}（利空）",
    "ts_mf_wind_reveal_none": "本題沒有帶風向的人",
    "ts_mf_col_rating": "評分",
    "ts_mf_col_weight": "票數",
    "ts_mf_voided": "（作廢）",
    "ts_mf_removed": "（去極值）",
    "ts_mf_rumor_note": "謠言破滅：{name} 的票作廢",
    "ts_mf_median_note": "利多出盡：以中位數計算",
    "ts_mf_cancel_note": "交易取消：平均落在 4.5～5.5，全員退回押注與心理戰付出",
    "ts_mf_refund_note": "沒有人押注，心理戰付出全數退回",
    "ts_err_mf_rating": "這個分數不能選",
    "ts_err_mf_request_self": "不能要求自己亮牌",
    "ts_err_mf_request_used": "本題已經發起過要求",
    "ts_err_mf_request_revealed": "對方已經亮牌",
    "ts_err_mf_request_pending": "還有一筆要求尚未處理",
    "ts_err_mf_offer": "開價不在允許範圍內",
    "ts_err_mf_refuse_chips": "籌碼不足以付封口費",
    "ts_err_mf_not_target": "只有被要求的人可以回應",
    "ts_err_mf_not_requester": "只有要求者可以加價或放棄",
    "ts_err_mf_pending_open": "請先處理完進行中的要求",
    "ts_err_mf_predict_range": "預測值超出範圍",
```

ja：

```python
    "ts_mf_subject_heading": "第 {i}／{total} 題　{category}",
    "ts_mf_blamer_is": "この題の暴露者：{name}",
    "ts_btn_mf_start": "暴露を始める",
    "ts_mf_expose_heading": "{name} さん、欠点を1つ加えてください",
    "ts_wait_mf_expose": "{name} さんの暴露を待っています…",
    "ts_mf_flaw_hand": "欠点の手札",
    "ts_mf_flaw_custom": "自作の欠点",
    "ts_mf_wind_maybe": "この題には風向き役が1人いるかもしれません",
    "ts_mf_rate_heading": "{name} さんの秘密評価",
    "ts_mf_rate_hint": "この欠点はあなたにとって何点の減点？",
    "ts_mf_wind_you_up": "あなたは風向き役（強気）：0 か 2 しか選べず、評価は2票分になります",
    "ts_mf_wind_you_down": "あなたは風向き役（弱気）：5 か 10 しか選べず、評価は2票分になります",
    "ts_mf_wind_you_none": "あなたは風向き役ではありません",
    "ts_mf_rating_n": "{n} 点減点",
    "ts_wait_mf_rate": "秘密評価中（{done}／{total}）",
    "ts_mf_mind_heading": "心理戦",
    "ts_mf_mind_hint": "自分の評価を説明してもいいし、チップを払って他の人に公開を求めてもかまいません。相手は同額の口止め料で断れます",
    "ts_mf_gag_hint": "箝口令：この題では公開説明禁止",
    "ts_mf_revealed_list": "公開済み",
    "ts_mf_revealed_item": "{name}：{n} 点減点",
    "ts_mf_revealed_forced": "（強制）",
    "ts_mf_none_revealed": "まだ誰も公開していません",
    "ts_mf_request_from": "要求する人",
    "ts_mf_request_to": "相手",
    "ts_mf_request_offer": "提示額（最低 {min}）",
    "ts_btn_mf_request": "公開を要求",
    "ts_mf_pending": "{from} が {offer} で {to} に公開を要求",
    "ts_btn_mf_reveal": "公開する",
    "ts_btn_mf_refuse": "口止め料 {offer} を払って断る",
    "ts_mf_refused_raise": "{to} が断りました。{from} は値上げしてもう一度要求しますか？",
    "ts_mf_raise_offer": "値上げ額（{min} より大きく）",
    "ts_btn_mf_raise": "値上げ",
    "ts_btn_mf_drop": "あきらめる",
    "ts_wait_mf_respond": "{name} さんの返事を待っています…",
    "ts_wait_mf_raise": "{name} さんが値上げするか待っています…",
    "ts_mf_request_log_revealed": "{from} → {to}：提示 {offers}、公開",
    "ts_mf_request_log_refused": "{from} → {to}：提示 {offers}、拒否",
    "ts_mf_mind_pot": "心理戦でポットに入った額：{n}",
    "ts_btn_mf_end_mind": "心理戦を終えて賭けへ",
    "ts_mf_predict": "全体の平均減点を予想（0.0～{max}）",
    "ts_mf_settle_avg": "全体の平均：{avg} 点減点",
    "ts_mf_wind_reveal_up": "風向き役：{name}（強気）",
    "ts_mf_wind_reveal_down": "風向き役：{name}（弱気）",
    "ts_mf_wind_reveal_none": "この題に風向き役はいませんでした",
    "ts_mf_col_rating": "評価",
    "ts_mf_col_weight": "票数",
    "ts_mf_voided": "（無効）",
    "ts_mf_removed": "（除外）",
    "ts_mf_rumor_note": "デマ発覚：{name} の票は無効",
    "ts_mf_median_note": "材料出尽くし：中央値で計算",
    "ts_mf_cancel_note": "取引取消：平均が 4.5～5.5 のため、賭け金と心理戦の支払いを全員に返却",
    "ts_mf_refund_note": "誰も賭けなかったため、心理戦の支払いを全額返却",
    "ts_err_mf_rating": "この点数は選べません",
    "ts_err_mf_request_self": "自分には要求できません",
    "ts_err_mf_request_used": "この題ではすでに要求しました",
    "ts_err_mf_request_revealed": "相手はすでに公開しています",
    "ts_err_mf_request_pending": "処理中の要求があります",
    "ts_err_mf_offer": "提示額が範囲外です",
    "ts_err_mf_refuse_chips": "口止め料を払うチップが足りません",
    "ts_err_mf_not_target": "要求された人だけが返事できます",
    "ts_err_mf_not_requester": "要求した人だけが値上げ・取り下げできます",
    "ts_err_mf_pending_open": "処理中の要求を先に終えてください",
    "ts_err_mf_predict_range": "予想値が範囲外です",
```

en：

```python
    "ts_mf_subject_heading": "Subject {i}/{total}  {category}",
    "ts_mf_blamer_is": "Exposer: {name}",
    "ts_btn_mf_start": "Start exposing",
    "ts_mf_expose_heading": "{name}, add one flaw",
    "ts_wait_mf_expose": "Waiting for {name} to expose a flaw…",
    "ts_mf_flaw_hand": "Flaw cards",
    "ts_mf_flaw_custom": "Custom flaw",
    "ts_mf_wind_maybe": "There may be an influencer in this round",
    "ts_mf_rate_heading": "{name}'s secret rating",
    "ts_mf_rate_hint": "How many points does this flaw cost for you?",
    "ts_mf_wind_you_up": "You are the influencer (bullish): only 0 or 2, and your rating counts twice",
    "ts_mf_wind_you_down": "You are the influencer (bearish): only 5 or 10, and your rating counts twice",
    "ts_mf_wind_you_none": "You are not the influencer",
    "ts_mf_rating_n": "-{n}",
    "ts_wait_mf_rate": "Secret rating ({done}/{total})",
    "ts_mf_mind_heading": "Mind games",
    "ts_mf_mind_hint": "Explain your rating if you like, or pay chips to make someone reveal theirs. They can refuse by paying the same amount as hush money",
    "ts_mf_gag_hint": "Gag order: no public explanations this round",
    "ts_mf_revealed_list": "Revealed",
    "ts_mf_revealed_item": "{name}: -{n}",
    "ts_mf_revealed_forced": " (forced)",
    "ts_mf_none_revealed": "Nobody has revealed yet",
    "ts_mf_request_from": "Requester",
    "ts_mf_request_to": "Target",
    "ts_mf_request_offer": "Offer (min {min})",
    "ts_btn_mf_request": "Demand reveal",
    "ts_mf_pending": "{from} offers {offer} to make {to} reveal",
    "ts_btn_mf_reveal": "Reveal",
    "ts_btn_mf_refuse": "Pay {offer} hush money",
    "ts_mf_refused_raise": "{to} refused. Will {from} raise and ask again?",
    "ts_mf_raise_offer": "Raise (more than {min})",
    "ts_btn_mf_raise": "Raise",
    "ts_btn_mf_drop": "Give up",
    "ts_wait_mf_respond": "Waiting for {name} to respond…",
    "ts_wait_mf_raise": "Waiting for {name} to decide on a raise…",
    "ts_mf_request_log_revealed": "{from} → {to}: offered {offers}, revealed",
    "ts_mf_request_log_refused": "{from} → {to}: offered {offers}, refused",
    "ts_mf_mind_pot": "Paid into the pot during mind games: {n}",
    "ts_btn_mf_end_mind": "End mind games and bet",
    "ts_mf_predict": "Predicted group average (0.0-{max})",
    "ts_mf_settle_avg": "Group average: -{avg}",
    "ts_mf_wind_reveal_up": "Influencer: {name} (bullish)",
    "ts_mf_wind_reveal_down": "Influencer: {name} (bearish)",
    "ts_mf_wind_reveal_none": "There was no influencer this round",
    "ts_mf_col_rating": "Rating",
    "ts_mf_col_weight": "Votes",
    "ts_mf_voided": " (void)",
    "ts_mf_removed": " (trimmed)",
    "ts_mf_rumor_note": "Rumor busted: {name}'s vote is void",
    "ts_mf_median_note": "Priced in: the median is used",
    "ts_mf_cancel_note": "Trade cancelled: the average is 4.5-5.5, so all bets and mind-game payments are refunded",
    "ts_mf_refund_note": "Nobody bet, so mind-game payments are refunded",
    "ts_err_mf_rating": "You cannot pick this rating",
    "ts_err_mf_request_self": "You cannot target yourself",
    "ts_err_mf_request_used": "You already made a demand this round",
    "ts_err_mf_request_revealed": "That player has already revealed",
    "ts_err_mf_request_pending": "Another demand is still open",
    "ts_err_mf_offer": "The offer is out of range",
    "ts_err_mf_refuse_chips": "Not enough chips for hush money",
    "ts_err_mf_not_target": "Only the target can respond",
    "ts_err_mf_not_requester": "Only the requester can raise or give up",
    "ts_err_mf_pending_open": "Finish the open demand first",
    "ts_err_mf_predict_range": "The prediction is out of range",
```

- [ ] **Step 2：建立 `static_src/toushou_ui_manfen.js`**

```js
// 東正小遊戲（toushou）滿分男模式的畫面。由 toushou.js 的 renderGame／renderFinal 呼叫。
// 共用元件（el、masked、dispatch…）透過工具包 K 傳入；本檔不保存任何狀態。
// 秘密資訊（評分、帶風向者）存在 state 裡，畫面只在遮蔽畫面或結算後才顯示。
// 規則依據：docs/superpowers/specs/2026-10-27-toushou-manfen-mode-design.md
(function () {
  "use strict";

  var D = window.PriTestToushouData;
  var Core = window.PriTestToushouCore;
  var M = window.PriTestToushouManfen;

  function fmt10(v) { return (v / 10).toFixed(1); }

  // "5.0" → 50；不是小數一位以內的數字時回傳 NaN
  function parse10(str) {
    var n = Number(str);
    if (str === "" || !isFinite(n)) return NaN;
    var v = Math.round(n * 10);
    return Math.abs(n * 10 - v) < 1e-6 ? v : NaN;
  }

  function flawText(K, cardId) {
    var card = M.flawCardById(cardId);
    if (!card) return cardId;
    var tg = K.currentTarget();
    return K.lt(card.text).split("{target}").join(tg ? K.lt(tg.name) : "");
  }

  // 題目句：專用類別用該類別句型，現有標的用共用句型
  function sentence(K, target, flaw) {
    var cat = M.manfenCategoryById(target.category);
    var phrase = K.lt(cat ? cat.phrase : D.MANFEN_CLASSIC_PHRASE);
    return phrase.split("{target}").join(K.lt(target.name)).split("{flaw}").join(flaw);
  }

  function swanBadge(K, id) {
    var card = M.swanById(id);
    if (!card) return null;
    return K.el("p", { id: "ts-swan-badge", class: "ts-swan-badge" }, [
      K.el("strong", { text: K.t("ts_swan_heading") + K.P("：") + K.lt(card.name) }), K.P("　") + K.lt(card.text)]);
  }

  function revealedList(K, info) {
    var s = K.state();
    var ul = K.el("ul", { id: "ts-mf-revealed", class: "ts-mf-revealed" });
    s.players.forEach(function (p) {
      var how = info.revealed[p.id];
      if (!how) return;
      ul.appendChild(K.el("li", { "data-player": p.id, text: K.t("ts_mf_revealed_item", { name: p.name, n: info.ratings[p.id] }) +
        (how === "forced" ? K.t("ts_mf_revealed_forced") : "") }));
    });
    if (!ul.childNodes.length) return K.el("p", { id: "ts-mf-revealed", class: "ts-hooks", text: K.t("ts_mf_none_revealed") });
    return K.el("div", {}, [K.el("h3", { text: K.t("ts_mf_revealed_list") }), ul]);
  }

  // 對象卡：info＝state.current（進行中）或 lastSettlement（結算）或 null（翻出時）
  function subjectCard(K, target, info) {
    var s = K.state();
    var cat = M.categoryById(target.category);
    var tags = K.el("div", { class: "ts-tags" });
    (target.tags || []).forEach(function (tg) { tags.appendChild(K.el("span", { text: K.lt(tg) })); });
    var blamer = info ? info.blamerId : M.blamerFor(s, s.targetIndex);
    var settled = !!(info && info.mode === "manfen");
    return K.el("section", { class: "ts-panel ts-target-card ts-mf-card" }, [
      K.el("p", { text: K.t("ts_mf_subject_heading", { i: s.targetIndex + 1, total: s.targets.length,
        category: cat ? K.lt(cat.name) : "" }) }),
      K.el("h2", { text: K.lt(target.name) }),
      target.summary ? K.el("p", { class: "ts-summary", text: K.lt(target.summary) }) : null,
      tags,
      K.el("p", { id: "ts-mf-blamer", text: K.t("ts_mf_blamer_is", { name: K.playerName(blamer) }) }),
      info && info.flaw ? K.el("p", { id: "ts-mf-sentence", class: "ts-mf-sentence", text: sentence(K, target, info.flaw.text) }) : null,
      info && info.event ? swanBadge(K, info.event) : null,
      s.config.windEnabled && info && info.flaw && !settled
        ? K.el("p", { id: "ts-mf-wind-maybe", class: "ts-mf-wind", text: K.t("ts_mf_wind_maybe") }) : null,
      info && info.flaw && !settled ? revealedList(K, info) : null
    ]);
  }

  // ---------------- 爆料 ----------------

  function composer(K, pid) {
    var ui = K.ui;
    var me = K.playerOf(pid);
    var textArea = K.el("textarea", { id: "ts-news-text", class: "ts-news-text", "aria-label": K.t("ts_mf_flaw_custom") });
    if (ui.editing !== null) textArea.value = ui.editing;
    textArea.addEventListener("input", function () { ui.editing = textArea.value; });
    var hand = K.el("ul", { class: "ts-hand" });
    me.hand.forEach(function (cardId, idx) {
      var playable = M.flawPlayable(K.state(), cardId);
      var cls = ["ts-down", playable ? "" : "ts-unplayable", ui.selectedCard === idx ? "ts-selected" : ""]
        .filter(Boolean).join(" ");
      hand.appendChild(K.el("li", { "data-card": cardId, class: cls }, [
        K.el("p", { text: flawText(K, cardId) }),
        playable ? K.el("button", { class: "ts-btn-play", type: "button", text: K.t("ts_btn_play"),
          onclick: function () {
            K.dispatch({ type: "mfExpose", playerId: pid, cardId: cardId, edited: false, text: flawText(K, cardId) });
          } }) : null,
        K.el("button", { class: "ts-btn-edit", type: "button", text: K.t("ts_btn_edit"),
          onclick: function () {
            ui.selectedCard = idx;
            ui.editing = flawText(K, cardId);
            ui.error = "";
            ui.skipRestore = true;
            K.render();
          } })
      ]));
    });
    return K.el("section", { class: "ts-panel" }, [
      K.el("h3", { text: K.t("ts_mf_flaw_hand") }),
      K.el("p", { class: "ts-hooks", text: K.t("ts_hand_other_hint") }),
      hand,
      K.el("label", {}, [K.t("ts_mf_flaw_custom"), textArea]),
      K.errorLine(),
      K.el("button", { id: "ts-btn-release", type: "button", class: "ts-primary", text: K.t("ts_btn_release"),
        onclick: function () {
          var text = textArea.value;
          var cardId = ui.selectedCard === null ? null : me.hand[ui.selectedCard];
          var edited = cardId !== null;
          var err = M.exposeError(K.state(), pid, cardId, text, edited);
          if (err) { ui.error = K.t(err); ui.editing = text; K.render(); return; }
          K.dispatch({ type: "mfExpose", playerId: pid, cardId: cardId, edited: edited, text: text });
        } })
    ]);
  }

  function renderExpose(K) {
    var pid = K.state().current.blamerId;
    var name = K.playerName(pid);
    var heading = K.el("h2", { text: K.t("ts_mf_expose_heading", { name: name }) });
    if (!K.owns(pid)) return K.el("div", {}, [heading, K.waiting(K.t("ts_wait_mf_expose", { name: name }))]);
    return K.el("div", {}, [heading, K.masked(pid, function () { return composer(K, pid); })]);
  }

  // ---------------- 秘密評分 ----------------

  function renderRate(K) {
    var s = K.state();
    var pending = M.pendingRaters(s);
    var mine = pending.filter(K.owns);
    var total = s.players.length;
    var progress = K.t("ts_wait_mf_rate", { done: total - pending.length, total: total });
    if (!mine.length) return K.waiting(progress);
    var pid = mine[0];
    return K.masked(pid, function () {
      var cur = K.state();
      var c = cur.current;
      var allowed = M.allowedRatings(cur, pid);
      var holder = c.windHolder === pid;
      var windLine = cur.config.windEnabled ? K.el("p", { id: "ts-mf-wind-status",
        class: holder ? "ts-mf-wind ts-mf-wind-holder" : "ts-mf-wind",
        text: K.t(holder ? "ts_mf_wind_you_" + c.windCard : "ts_mf_wind_you_none") }) : null;
      var btns = K.el("div", { class: "ts-mf-rate-buttons" });
      M.RATINGS.forEach(function (v) {
        btns.appendChild(K.el("button", { class: "ts-mf-rate", type: "button", "data-value": String(v),
          disabled: allowed.indexOf(v) < 0, text: K.t("ts_mf_rating_n", { n: v }),
          onclick: function () { K.dispatch({ type: "mfRate", playerId: pid, value: v }); } }));
      });
      return K.el("section", { class: "ts-panel" }, [
        K.el("h2", { text: K.t("ts_mf_rate_heading", { name: K.playerName(pid) }) }),
        windLine,
        K.el("p", { text: K.t("ts_mf_rate_hint") }),
        btns,
        K.errorLine(),
        K.el("p", { class: "ts-hooks", text: progress })
      ]);
    });
  }

  // ---------------- 心理戰 ----------------

  function requestLog(K, requests) {
    if (!requests || !requests.length) return null;
    var ul = K.el("ul", { id: "ts-mf-request-log", class: "ts-mf-request-log" });
    requests.forEach(function (r) {
      ul.appendChild(K.el("li", { text: K.t("ts_mf_request_log_" + r.outcome, {
        from: K.playerName(r.from), to: K.playerName(r.to), offers: r.offers.join(" → ") }) }));
    });
    return ul;
  }

  function requestForm(K) {
    var s = K.state();
    var c = s.current;
    var min = M.requestMin(s);
    var used = c.requests.map(function (r) { return r.from; });
    var froms = s.players.filter(function (p) { return K.owns(p.id) && used.indexOf(p.id) < 0 && p.chips >= min; });
    var tos = s.players.filter(function (p) { return !c.revealed[p.id]; });
    if (!froms.length || tos.length < 1) return null;
    var fromSel = K.el("select", { id: "ts-mf-req-from", "aria-label": K.t("ts_mf_request_from") });
    froms.forEach(function (p) { fromSel.appendChild(K.el("option", { value: p.id, text: p.name })); });
    var toSel = K.el("select", { id: "ts-mf-req-to", "aria-label": K.t("ts_mf_request_to") });
    tos.forEach(function (p) { toSel.appendChild(K.el("option", { value: p.id, text: p.name })); });
    var offer = K.el("input", { id: "ts-mf-req-offer", type: "number", min: String(min), value: String(min) });
    return K.el("div", { class: "ts-mf-request" }, [
      K.el("label", { class: "ts-field" }, [K.t("ts_mf_request_from"), fromSel]),
      K.el("label", { class: "ts-field" }, [K.t("ts_mf_request_to"), toSel]),
      K.el("label", { class: "ts-field" }, [K.t("ts_mf_request_offer", { min: min }), offer]),
      K.el("button", { id: "ts-btn-mf-request", type: "button", text: K.t("ts_btn_mf_request"),
        onclick: function () {
          var x = K.intOf(offer.value);
          var err = M.requestError(K.state(), fromSel.value, toSel.value, x);
          if (err) { K.ui.error = K.t(err); K.render(); return; }
          K.dispatch({ type: "mfRequest", from: fromSel.value, to: toSel.value, offer: x });
        } })
    ]);
  }

  function pendingBox(K, r) {
    var x = r.offers[r.offers.length - 1];
    var fromN = K.playerName(r.from);
    var toN = K.playerName(r.to);
    if (!r.awaitingRaise) {
      var line = K.el("p", { id: "ts-mf-pending", class: "ts-mf-pending-line", text: K.t("ts_mf_pending", { from: fromN, to: toN, offer: x }) });
      if (!K.owns(r.to)) return K.el("div", {}, [line, K.el("p", { class: "ts-wait-text", text: K.t("ts_wait_mf_respond", { name: toN }) })]);
      return K.el("div", { class: "ts-mf-pending" }, [line,
        K.el("button", { id: "ts-btn-mf-reveal", type: "button", class: "ts-primary", text: K.t("ts_btn_mf_reveal"),
          onclick: function () { K.dispatch({ type: "mfRespond", playerId: r.to, choice: "reveal" }); } }),
        K.el("button", { id: "ts-btn-mf-refuse", type: "button", disabled: K.playerOf(r.to).chips < x,
          text: K.t("ts_btn_mf_refuse", { offer: x }),
          onclick: function () { K.dispatch({ type: "mfRespond", playerId: r.to, choice: "refuse" }); } })
      ]);
    }
    var ask = K.el("p", { id: "ts-mf-pending", class: "ts-mf-pending-line", text: K.t("ts_mf_refused_raise", { from: fromN, to: toN }) });
    if (!K.owns(r.from)) return K.el("div", {}, [ask, K.el("p", { class: "ts-wait-text", text: K.t("ts_wait_mf_raise", { name: fromN }) })]);
    var raise = K.el("input", { id: "ts-mf-raise-offer", type: "number", min: String(x + 1), value: String(x + 1) });
    return K.el("div", { class: "ts-mf-pending" }, [ask,
      K.el("label", { class: "ts-field" }, [K.t("ts_mf_raise_offer", { min: x }), raise]),
      K.el("button", { id: "ts-btn-mf-raise", type: "button", class: "ts-primary", text: K.t("ts_btn_mf_raise"),
        onclick: function () {
          var v = K.intOf(raise.value);
          var err = M.raiseError(K.state(), r.from, v);
          if (err) { K.ui.error = K.t(err); K.render(); return; }
          K.dispatch({ type: "mfRaise", playerId: r.from, offer: v });
        } }),
      K.el("button", { id: "ts-btn-mf-drop", type: "button", text: K.t("ts_btn_mf_drop"),
        onclick: function () { K.dispatch({ type: "mfDrop", playerId: r.from }); } })
    ]);
  }

  function renderMind(K) {
    var c = K.state().current;
    var r = c.pendingRequest;
    return K.el("section", { class: "ts-panel ts-mf-mind" }, [
      K.el("h2", { text: K.t("ts_mf_mind_heading") }),
      K.el("p", { class: "ts-hooks", text: K.t("ts_mf_mind_hint") }),
      c.event === "gag" ? K.el("p", { id: "ts-mf-gag", class: "ts-error", text: K.t("ts_mf_gag_hint") }) : null,
      K.el("p", { id: "ts-mf-mind-pot", text: K.t("ts_mf_mind_pot", { n: c.mindPot }) }),
      r ? pendingBox(K, r) : requestForm(K),
      requestLog(K, c.requests),
      K.errorLine(),
      r ? null : K.hostButton("ts-btn-mf-end-mind", "ts_btn_mf_end_mind", { type: "mfEndMind" })
    ]);
  }

  // ---------------- 下注 ----------------

  function renderBet(K) {
    var s = K.state();
    var pending = Core.pendingBettors(s);
    var mine = pending.filter(K.owns);
    var total = s.current.bettors.length;
    if (!mine.length) return K.waiting(K.t("ts_wait_bets", { done: total - pending.length, total: total }));
    var pid = mine[0];
    var me = K.playerOf(pid);
    return K.masked(pid, function () {
      var min = Math.min(s.config.minBet, me.chips);
      var max = M.predictMax(K.state());
      var amount = K.el("input", { id: "ts-bet-amount", type: "number", min: String(min), max: String(me.chips), value: String(min) });
      var predict = K.el("input", { id: "ts-bet-predict", type: "number", min: "0", max: fmt10(max), step: "0.1", value: "5.0" });
      return K.el("section", { class: "ts-panel" }, [
        K.el("h2", { text: K.t("ts_bet_heading", { name: me.name }) }),
        K.el("p", { text: K.t("ts_bet_chips_left", { n: me.chips, min: min }) }),
        K.el("label", { class: "ts-field" }, [K.t("ts_bet_amount"), amount]),
        K.el("label", { class: "ts-field" }, [K.t("ts_mf_predict", { max: fmt10(max) }), predict]),
        K.errorLine(),
        K.el("button", { id: "ts-btn-confirm-bet", type: "button", class: "ts-primary", text: K.t("ts_btn_confirm_bet"),
          onclick: function () {
            var a = K.intOf(amount.value);
            var p10 = parse10(predict.value);
            var err = M.betError(K.state(), pid, a, p10);
            if (err) { K.ui.error = K.t(err); K.render(); return; }
            K.dispatch({ type: "placeBet", playerId: pid, amount: a, predict: p10 });
          } })
      ]);
    });
  }

  // ---------------- 結算 ----------------

  function settleTable(K, h) {
    var table = K.el("table", { class: "ts-table" });
    table.appendChild(K.el("tr", {}, ["ts_col_player", "ts_mf_col_rating", "ts_mf_col_weight", "ts_col_bet", "ts_col_predict",
      "ts_col_error", "ts_col_rank", "ts_col_payout", "ts_col_profit"].map(function (k) { return K.el("th", { text: K.t(k) }); })));
    K.state().players.forEach(function (p) {
      var row = h.tally.filter(function (r) { return r.playerId === p.id; })[0];
      var b = h.bets[p.id];
      var pay = h.payouts[p.id] || 0;
      var profit = pay - (b ? b.amount : 0) - (h.mindPaid[p.id] || 0);
      var rating = row ? String(row.rating) + (row.voided ? K.t("ts_mf_voided") : (row.removed ? K.t("ts_mf_removed") : "")) : "—";
      table.appendChild(K.el("tr", { "data-player": p.id }, [p.name, rating, row ? row.weight : "—",
        b ? b.amount : "—", b ? fmt10(b.predict) : "—", b ? fmt10(Math.abs(b.predict - h.avg10)) : "—",
        h.ranks[p.id] === undefined ? "—" : h.ranks[p.id], pay, (profit > 0 ? "+" : "") + profit]
        .map(function (v) { return K.el("td", { text: String(v) }); })));
    });
    return table;
  }

  function settleBody(K, h) {
    var s = K.state();
    var notes = [];
    if (s.config.windEnabled) {
      notes.push(h.windHolder ? K.t("ts_mf_wind_reveal_" + h.windCard, { name: K.playerName(h.windHolder) })
        : K.t("ts_mf_wind_reveal_none"));
    }
    h.tally.forEach(function (r) { if (r.voided) notes.push(K.t("ts_mf_rumor_note", { name: K.playerName(r.playerId) })); });
    if (h.median) notes.push(K.t("ts_mf_median_note"));
    if (h.cancelled) notes.push(K.t("ts_mf_cancel_note"));
    if (h.refundMind) notes.push(K.t("ts_mf_refund_note"));
    if (h.bonus) notes.push(K.t("ts_bailout_note", { n: h.bonus }));
    if (h.event === "upset") notes.push(K.t("ts_upset_note"));
    var ul = K.el("ul", { class: "ts-settle-notes" });
    notes.forEach(function (x) { ul.appendChild(K.el("li", { text: x })); });
    return K.el("div", {}, [
      K.el("p", { id: "ts-mf-avg", class: "ts-mf-avg", text: K.t("ts_mf_settle_avg", { avg: fmt10(h.avg10) }) +
        K.P("　") + K.t("ts_pot", { n: h.pot }) }),
      notes.length ? ul : null,
      K.el("div", { id: "ts-settle-table", class: "ts-table-wrap" }, [settleTable(K, h)]),
      requestLog(K, h.requests)
    ]);
  }

  function renderSettle(K) {
    var s = K.state();
    var h = s.lastSettlement;
    var last = s.targetIndex + 1 >= s.targets.length;
    return K.el("section", { class: "ts-panel" }, [
      K.el("h2", { text: K.t("ts_settle_heading", { name: K.lt(h.name) }) }),
      settleBody(K, h),
      K.errorLine(),
      K.el("div", { class: "ts-actions" }, [
        K.hostButton("ts-btn-next-target", last ? "ts_btn_to_final" : "ts_btn_next_target", { type: "nextTarget" })
      ])
    ]);
  }

  // 整局結算的回顧（每題一個 <details>）
  function review(K, h) {
    var card = h.event ? M.swanById(h.event) : null;
    return K.el("details", {}, [
      K.el("summary", { text: K.lt(h.name) + K.P("　") + K.t("ts_mf_settle_avg", { avg: fmt10(h.avg10) }) +
        (card && h.event !== "calm" ? K.P("　［") + K.lt(card.name) + K.P("］") : "") }),
      h.flaw ? K.el("p", { class: "ts-mf-sentence", text: sentence(K, { category: h.category, name: h.name }, h.flaw.text) }) : null,
      settleBody(K, h)
    ]);
  }

  function render(K) {
    var s = K.state();
    var phase = s.phase;
    var settled = phase === "settle";
    var wrap = K.el("div", {});
    wrap.appendChild(subjectCard(K, K.currentTarget(), settled ? s.lastSettlement : s.current));
    if (phase === "reveal_target") wrap.appendChild(K.hostButton("ts-btn-start-betting", "ts_btn_mf_start", { type: "startBetting" }));
    else if (phase === "mf_expose") wrap.appendChild(renderExpose(K));
    else if (phase === "mf_rate") wrap.appendChild(renderRate(K));
    else if (phase === "mf_mind") wrap.appendChild(renderMind(K));
    else if (phase === "bet") wrap.appendChild(renderBet(K));
    else if (settled) wrap.appendChild(renderSettle(K));
    return wrap;
  }

  window.PriTestToushouManfenUI = { render: render, review: review };
})();
```

- [ ] **Step 3：修改 `toushou.js`**

1. `var M = window.PriTestToushouManfen;` 下一行加 `var MUI = window.PriTestToushouManfenUI;`。
2. `function errorLine()` 之前加工具包：

```js
  // 滿分男模式畫面（toushou_ui_manfen.js）用的共用元件
  function kit() {
    return {
      state: function () { return state; },
      ui: ui,
      el: el, t: t, lt: lt, P: P,
      dispatch: dispatch, render: render,
      owns: owns, masked: masked, waiting: waiting, errorLine: errorLine, hostButton: hostButton,
      playerName: playerName, playerOf: playerOf, currentTarget: currentTarget, intOf: intOf
    };
  }
```

3. `renderGame()`：把

```js
    if (phase === "missions") {
      wrap.appendChild(renderMissions());
    } else {
```

改為

```js
    if (phase === "missions") {
      wrap.appendChild(renderMissions());
    } else if (Core.isManfenMode(state)) {
      wrap.appendChild(MUI.render(kit()));
    } else {
```

4. `renderFinal()` 的 `state.history.forEach(function (h) {` 第一行加：

```js
      if (h.mode === "manfen") { review.appendChild(MUI.review(kit(), h)); return; }
```

5. `viewKey()` 的陣列加三項（放在 `ui.revealedFor` 之前）：

```js
      c && c.ratings ? Object.keys(c.ratings).length : "",
      c && c.requests ? c.requests.length : "",
      c && c.pendingRequest ? c.pendingRequest.offers.length + (c.pendingRequest.awaitingRaise ? "r" : "") : "",
```

6. `site_src/toushou_page.py`：`"toushou.js",` 之前加 `"toushou_ui_manfen.js",`。

- [ ] **Step 4：CSS（`static_src/css/toushou.css` 檔尾）**

```css
/* ===== 滿分男模式（manfen） ===== */
.ts-mf-sentence {
  font-size: 1.2rem;
  font-weight: bold;
  padding: 0.6rem 0.8rem;
  border-left: 4px solid #c0392b;
  background: rgba(192, 57, 43, 0.08);
}
.ts-mf-wind { color: #7a5c00; }
.ts-mf-wind-holder { font-weight: bold; padding: 0.4rem 0.6rem; background: rgba(241, 196, 15, 0.18); border-radius: 6px; }
.ts-mf-rate-buttons { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.75rem 0; }
.ts-mf-rate { min-width: 5.5rem; padding: 0.75rem 1rem; font-size: 1.1rem; font-weight: bold; }
.ts-mf-rate:disabled { opacity: 0.35; }
.ts-mf-revealed { display: flex; flex-wrap: wrap; gap: 0.4rem; list-style: none; padding: 0; }
.ts-mf-revealed li { padding: 0.2rem 0.6rem; border: 1px solid #c0392b; border-radius: 999px; }
.ts-mf-request, .ts-mf-pending { margin: 0.5rem 0; }
.ts-mf-pending-line { font-weight: bold; }
.ts-mf-avg { font-size: 1.2rem; font-weight: bold; }
.ts-mf-request-log { font-size: 0.9rem; }
```

- [ ] **Step 5：建置並手動遊玩**

Run：`node --check static_src/toushou_ui_manfen.js && node --check static_src/toushou.js && py -3 generate.py && py -3 tools/split_css.py --check`
Expected：皆成功（split_css 沒有回報 style.css 混入遊戲樣式）。
開瀏覽器以滿分男模式、3 人、帶風向＋黑天鵝，玩完一題：爆料 → 3 人遮蔽評分（帶風向者看到限制）→ 心理戰要求／拒絕／加價 → 下注 → 結算表顯示評分、票數、平均。手機寬度（375px）下沒有水平捲動。

- [ ] **Step 6：commit**

```bash
git add static_src/toushou_ui_manfen.js static_src/toushou.js static_src/css/toushou.css site_src/toushou_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(toushou): 滿分男模式各階段畫面（爆料、秘密評分、心理戰、下注、結算與回顧）"
```

---

### Task 9：Playwright 整局檢查與回歸

**Files:**
- Create: `tools/toushou_check/manfen_ui_check.js`

**Interfaces:**
- Consumes：Task 7、8 的 DOM id、`window.PriTestToushou._debugState()`。

- [ ] **Step 1：寫檢查腳本**

```js
// ============================================================================
// toushou 滿分男模式 Playwright 整局檢查（單機傳遞）：3 人 × 3 題，啟用帶風向＋黑天鵝。
// 驗證：設定畫面隱藏經典限定選項、爆料者輪替、評分遮蔽與帶風向限制、封口費競價、
// 下注預測小數一位、結算平均與彩池守恆、重新整理還原、整局回顧。
// 前置：py -3 generate.py；py -3 -m http.server 8941 --directory dist
// 執行：node tools/toushou_check/manfen_ui_check.js
// 規則依據：docs/superpowers/specs/2026-10-27-toushou-manfen-mode-design.md
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.TOUSHOU_BASE || "http://localhost:8941/toushou/index.html";

function debugState(page) { return page.evaluate(function () { return window.PriTestToushou._debugState(); }); }
async function revealIfMasked(page) {
  if (await page.locator("#ts-mask").count()) await page.dispatchEvent("#ts-btn-reveal", "click");
}

(async function main() {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  page.on("dialog", function (d) { d.accept(); });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); localStorage.setItem("pritest-lang", "zh"); });
  await page.reload();

  // ---- 設定 ----
  await page.selectOption("#ts-game-mode", "manfen");
  for (var id of ["#ts-missions", "#ts-sector", "#ts-delta-mode"]) {
    assert.strictEqual(await page.locator(id).count(), 0, id + " hidden in manfen mode");
  }
  assert.strictEqual(await page.locator(".ts-mf-cat").count(), 6);
  await page.fill("#ts-player-count", "3");
  await page.dispatchEvent("#ts-player-count", "change");
  await page.check("#ts-wind");
  await page.check("#ts-swan");
  await page.click("#ts-btn-randomize");
  await page.click("#ts-btn-start");

  var s = await debugState(page);
  assert.strictEqual(s.config.mode, "manfen");
  assert.strictEqual(s.targets.length, 3);
  var startTotal = s.players.reduce(function (n, p) { return n + p.chips; }, 0);

  for (var round = 0; round < 3; round++) {
    s = await debugState(page);
    assert.strictEqual(s.phase, "reveal_target");
    await page.dispatchEvent("#ts-btn-start-betting", "click");

    // 爆料：有可直接打出的牌就打出第一張，否則自訂
    await revealIfMasked(page);
    if (await page.locator(".ts-hand li .ts-btn-play").count()) {
      await page.dispatchEvent(".ts-hand li .ts-btn-play >> nth=0", "click");
    } else {
      await page.fill("#ts-news-text", "每天都要跟你報備行程");
      await page.dispatchEvent("#ts-btn-release", "click");
    }
    s = await debugState(page);
    assert.strictEqual(s.phase, "mf_rate");
    assert.ok((await page.textContent("#ts-mf-sentence")).length > 0);
    assert.strictEqual(await page.locator("#ts-mf-wind-maybe").count(), 1);

    // 秘密評分：每人選第一個可按的分數；帶風向者只看到兩顆可按
    for (var k = 0; k < 3; k++) {
      await revealIfMasked(page);
      var cur = await debugState(page);
      var pid = cur.players.filter(function (p) { return !(p.id in cur.current.ratings); })[0].id;
      var enabled = await page.locator(".ts-mf-rate:not([disabled])").count();
      assert.strictEqual(enabled, cur.current.windHolder === pid ? 2 : 4);
      await page.dispatchEvent(".ts-mf-rate:not([disabled]) >> nth=0", "click");
    }
    s = await debugState(page);
    assert.strictEqual(s.phase, "mf_mind");

    // 心理戰：第一題做一次「要求 → 拒絕 → 加價 → 亮牌」
    if (round === 0 && !s.current.revealed.p1) {
      await page.selectOption("#ts-mf-req-from", "p0");
      await page.selectOption("#ts-mf-req-to", "p1");
      await page.fill("#ts-mf-req-offer", "60");
      await page.dispatchEvent("#ts-btn-mf-request", "click");
      await page.dispatchEvent("#ts-btn-mf-refuse", "click");
      await page.fill("#ts-mf-raise-offer", "80");
      await page.dispatchEvent("#ts-btn-mf-raise", "click");
      await page.dispatchEvent("#ts-btn-mf-reveal", "click");
      s = await debugState(page);
      assert.strictEqual(s.current.revealed.p1, "paid");
      assert.strictEqual(s.current.mindPot, 60 + 60 + 80);
      assert.ok((await page.textContent("#ts-mf-revealed")).indexOf("扣") >= 0);
    }

    // 重新整理後回到遮蔽前的同一階段
    await page.reload();
    assert.strictEqual((await debugState(page)).phase, "mf_mind");
    await page.dispatchEvent("#ts-btn-mf-end-mind", "click");

    // 下注：預測 4.5
    s = await debugState(page);
    for (var b = 0; b < s.current.bettors.length; b++) {
      await revealIfMasked(page);
      await page.fill("#ts-bet-predict", "4.5");
      await page.dispatchEvent("#ts-btn-confirm-bet", "click");
    }
    s = await debugState(page);
    assert.strictEqual(s.phase, "settle");
    Object.keys(s.lastSettlement.bets).forEach(function (id) { assert.strictEqual(s.lastSettlement.bets[id].predict, 45); });
    assert.ok(/群體平均/.test(await page.textContent("#ts-mf-avg")));
    assert.strictEqual(await page.locator("#ts-settle-table tr").count(), 4);
    var total = s.players.reduce(function (n, p) { return n + p.chips; }, 0);
    // 只有紓困加碼會讓總籌碼增加
    if (!s.history.some(function (h) { return h.bonus > 0; })) assert.strictEqual(total, startTotal);
    await page.dispatchEvent("#ts-btn-next-target", "click");
  }

  s = await debugState(page);
  assert.strictEqual(s.phase, "final");
  var blamers = s.history.map(function (h) { return h.blamerId; }).sort();
  assert.deepStrictEqual(blamers, ["p0", "p1", "p2"], "each player exposes once");
  assert.strictEqual(await page.locator("#ts-final-table tr").count(), 4);
  assert.strictEqual(await page.locator("details .ts-mf-sentence").count(), 3);

  // 手機寬度不出現水平捲動
  var overflow = await page.evaluate(function () { return document.documentElement.scrollWidth > window.innerWidth; });
  assert.strictEqual(overflow, false);
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("manfen_ui_check passed");
})().catch(function (e) { console.error(e); process.exit(1); });
```

- [ ] **Step 2：執行**

Run（另一個終端 `py -3 -m http.server 8941 --directory dist`）：`py -3 generate.py && node tools/toushou_check/manfen_ui_check.js`
Expected：`manfen_ui_check passed`。失敗時依錯誤修正 Task 7／8 的程式（不要改寬檢查條件）。

- [ ] **Step 3：全部回歸**

Run：
```bash
node tools/toushou_check/core_check.js
node tools/toushou_check/manfen_core_check.js
node tools/toushou_check/ui_check.js
node tools/toushou_check/insider_ui_check.js
node tools/toushou_check/multi_device_check.js
```
Expected：全部通過。`multi_device_check.js` 若需要 Firebase emulator 或網路而無法執行，記錄原因回報，不要略過不提。

- [ ] **Step 4：commit**

```bash
git add tools/toushou_check/manfen_ui_check.js
git commit -m "test(toushou): 滿分男模式 Playwright 整局檢查"
```

- [ ] **Step 5：回報使用者**

以繁體中文回報：完成內容、各檢查結果（附輸出摘要）、尚未 push、版本號建議（新功能 → minor +1，push 前與使用者確認，並注意其他 session 也在改 `site_src/version.py`）。接著提出子專案 2（美術）的設計。
