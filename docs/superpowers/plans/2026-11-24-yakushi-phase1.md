# 少女藥師的獨語（yakushi）第 1 階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出可以從頭玩到尾的「少女藥師的獨語」第 1 階段：100 種真實藥材的圖鑑與易混群組、序章＋案 1～3、調查與時辰、鑑定、試藥、調藥、推理板（含深層臆測）、指認、評價、獨語帖、人物圖鑑、存檔，放在首頁「付款」分頁。

**Architecture:** 藥材用 registry（`yakushi_herbs.js`）＋6 個類別資料檔登記；案件是資料（`yakushi_case_*.js`），用 `Core.registerCase()` 登記；規則全部在純函式的 `yakushi_core.js`（不碰 DOM、不讀寫 localStorage）。畫面、存檔、操作只在 `yakushi.js`。新增藥材或案件只加資料檔，不改引擎。

**Tech Stack:** Vanilla ES5 IIFE、Python 產生靜態 HTML（`generate.py`）、Node `assert` 的規則與資料檢查、Playwright 的畫面檢查。

## Global Constraints

- 規則依據：`docs/yakushi_game_design.md`（全文都是第 1 階段範圍）。標示「暫定」的數值集中在 `yakushi_core.js` 檔頭的常數。
- 前綴：JS `window.PriTestYakushi*`、i18n 鍵 `ys_`、CSS class／id `ys-`。遊戲樣式只放 `static_src/css/yakushi.css`，**不要加進 `style.css`**。
- 人物名：卯卯、玄氏、韓當、杜衡、葛婆、月棠、雪鵑、緋桐、秦尚宮、小滿、周太醫。案件、劇情全部原創，不使用任何既有作品的角色名或案件。
- 藥材文字只寫常識（外觀、氣味、症狀、歷史用途、遊戲內分辨法），**不寫劑量、提煉、取得方法**；解方是遊戲規則，圖鑑與調藥畫面固定顯示「遊戲設定，非醫療建議」（`ys_disclaimer`）。
- 第 1 階段只做 zh；i18n 的 ja／en 欄位先填與 zh 相同的字串。劇情與藥材文字直接寫在資料檔（只有 zh）。
- 首頁放「付款」分頁：`page_shell(paid=True)`，`projects.py` 的 `pay` 分頁加 `"yakushi"`。
- 存檔鍵 `pritest-yakushi-save`；讀寫一律 try/catch，壞檔就重建；讀檔一律經過 `Core.normalizeSave()`。
- 載入順序：`yakushi_herbs.js` → `yakushi_herbs_poison.js` → `yakushi_herbs_mineral.js` → `yakushi_herbs_animal.js` → `yakushi_herbs_tonic.js` → `yakushi_herbs_clear.js` → `yakushi_herbs_boudoir.js` → `yakushi_cast.js` → `yakushi_core.js` → `yakushi_case_0.js` → `yakushi_case_1.js` → `yakushi_case_2.js` → `yakushi_case_3.js` → `yakushi.js`。
- Playwright 一律用 `dispatchEvent` 觸發（CLAUDE.md §4.6）；開頁前寫入 `localStorage["pritest-pay-unlocked"]="1"`（CLAUDE.md §4.3.1）。
- 版本：`site_src/version.py` 遞增 minor（目前 `2.86.0` → `2.87.0`；如果該號已被別的推送用掉，就用下一個 minor）。只推 `private`（`git push private main`），不要碰 `origin`。
- 回覆、註解、文件、commit message 用繁體中文；commit 結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `site_src/yakushi_page.py` | 頁面（`build_yakushi_html()`、`YAKUSHI_SCRIPTS`） |
| `site_src/i18n_yakushi.py` | UI 字串（`ys_`）與首頁的 `project_yakushi_*` |
| `static_src/css/yakushi.css` | 樣式（`ys-`） |
| `static_src/yakushi_herbs.js` | 藥材 registry、特徵篩選、搜尋 |
| `static_src/yakushi_herbs_<cat>.js` ×6 | 藥材資料（共 100 種） |
| `static_src/yakushi_cast.js` | 人物資料與獨語評語 |
| `static_src/yakushi_core.js` | 規則：存檔、案件流程、時辰、鑑定、試藥、調藥、推理板、指認、評價、結案 |
| `static_src/yakushi_case_0.js`～`_3.js` | 序章與案 1～3 |
| `static_src/yakushi.js` | 畫面、存檔讀寫、操作 |
| `tools/yakushi_check/herbs_check.js` | registry 與藥材資料檢查（Node） |
| `tools/yakushi_check/core_check.js` | 規則檢查（Node，用測試專用的小案件） |
| `tools/yakushi_check/cases_check.js` | 案件可破關與資料完整性檢查（Node） |
| `tools/yakushi_check/ui_check.js` | 畫面流程檢查（Playwright） |

## 介面

```js
// yakushi_herbs.js → window.PriTestYakushiHerbs（Node：module.exports）
Herbs.CATS = ["poison","mineral","animal","tonic","clear","boudoir"]
Herbs.METHODS = ["look","smell","taste","silver","water","heat","animal"]
Herbs.register(list)            // id 重複時 throw
Herbs.get(id) → herb|null；Herbs.list() → [herb]（登記順）
Herbs.byCat(cat) → [herb]；Herbs.byGroup(groupId) → [herb]
Herbs.tagsOf(herb) → [tag]      // traits.form+smell+taste+symptom，再加 "onset:"+traits.onset
Herbs.filter(tags) → [herb]     // 擁有全部 tags 的藥材
Herbs.search(q) → [herb]        // name 或 alias 含 q

// herb
{ id, name, alias: [], cat, group: groupId|null, danger: 0..3,
  traits: { form: [], smell: [], taste: [], symptom: [], onset: "fast"|"mid"|"slow"|null },
  tests: { look, smell, taste, silver, water, heat, animal },   // 字串或 null
  distinguish: 字串|null, lore: 字串 }

// 資料檔（每個 yakushi_herbs_<cat>.js）：
//   var LIST = [...]; Node 時 module.exports = LIST；root.PriTestYakushiHerbs 存在時 register(LIST)

// yakushi_core.js → window.PriTestYakushiCore（Node：module.exports）
Core.CASE_ORDER = ["case0","case1","case2","case3"]；Core.SLOTS = ["who","what","how","why"]
Core.registerCase(def)；Core.getCase(id) → def|null
Core.newSave() → save；Core.normalizeSave(raw) → save
Core.startCase(save, caseId) → run|{error:"case"|"locked"}
Core.cardInfo(def, cardId) → {id, kind, name, text, tags, of, herb}|null   // "herb:<id>" 也會解析
Core.spotOpen(run, spot) → bool
Core.move(run, placeId) → {ok, cost}|{error:"phase"|"place"}
Core.visit(run, spotId) → {ok, text, gives}|{error:"phase"|"spot"|"place"|"done"|"locked"}
Core.evidenceTags(run, evidenceId) → [tag]
Core.candidates(tags) → [herb]
Core.identify(run, evidenceId, herbId) → {ok}|{error:"phase"|"evidence"|"missing"|"herb"}
Core.runTest(run, evidenceId, method) → {ok, text|null, gives|null, collapsed, repeat}|{error:...}
Core.giveRemedy(run, patientId, herbIds) → {ok, cured, lost}|{error:"phase"|"patient"|"done"|"box"|"count"}
Core.toBoard(run)；Core.placeCard(run, slot, cardId|null) → {ok}|{error}
Core.submit(run) → {correct: 0..4}|{error:"phase"|"empty"}
Core.currentRebuttal(run) → rebuttal|null
Core.present(run, cardId) → {ok, hit, reply, done, reset, trust}|{error}
Core.rating(run) → "S"|"A"|"B"|"C"
Core.deepOption(def, run) → option|null
Core.finish(save, run) → {rating, monologues:[key]}|{error:"phase"}

// run
{ caseId, hours, stamina, trust, place, cards: [cardId], done: {spotId:true}, identified: {evidenceId: herbId},
  tested: {"evidenceId|method": text|null}, patients: {pid: {level, cured, lost}},
  board: {who, what, how, why, deep}, submits, mispresent, accuseFails, accuseStep,
  phase: "investigate"|"board"|"accuse"|"done", result: null|{rating, monologues} }
// save
{ v: 1, unlocked: [caseId], cases: {caseId: {run, best, cleared, last}}, herbsSeen: {herbId:true},
  monologues: {key:true}, castSeen: {castId:true} }

// case def（§10.1 的實作版）
{ id, title, hours, startPlace, cast: [castId], startCards: [],
  places: [{ id, name, spots: [{ id, kind:"look"|"talk", label, cost?, requires?: [cardId], gives: [cardId], text }] }],
  cards: { cardId: { kind:"evidence"|"testimony"|"symptom"|"reaction"|"person", name, text, tags?: [], of?: evidenceId, herb?: herbId } },
  tests: [{ evidence, method, text, gives? }],
  patients: [{ id, name, remedy: [herbId], gives: cardId, text }],
  medicineBox: [herbId],
  solution: { who, what, how, why },
  rebuttals: [{ who, claim, accepts: [cardId], reply }],
  deep: null | { label, options: [{ key, card, monologue: [line] }], none: [line] },
  story: { intro: [line], truth: [line], outro: [line] },
  monologue: [line] }
// line = { who: castId|null, text }

// yakushi_cast.js → window.PriTestYakushiCast
Cast.get(id) → {id, name, role, desc, notes: [{after: caseId|null, text}]}；Cast.list() → [...]

// yakushi.js → window.PriTestYakushi（給 Playwright 讀）
{ _debugState() → save, _debugRun() → run|null }
```

---

### Task 1: 頁面骨架與登記

**Files:**
- Create: `site_src/yakushi_page.py`, `site_src/i18n_yakushi.py`, `static_src/css/yakushi.css`，以及 14 個 JS（先都是空的 IIFE，掛上對應的 `window.PriTestYakushi*`；`yakushi.js` 先只在 `#ys-app` 放「載入中」）
- Modify: `generate.py`（import、`GAME_I18N_PREFIXES` 加 `"yakushi": ("ys_",)`、copy list 加 `*YAKUSHI_SCRIPTS`、建立 `dist/yakushi/index.html`、`main()` 的清單加 `"yakushi"`）、`site_src/i18n_data.py`（import 並在 zh／ja／en 三行最後合併 `**YAKUSHI_ZH, **YAKUSHI_PROJECT["zh"]` 等）、`site_src/projects.py`（PROJECTS 加項目、`pay` 分頁加 `"yakushi"`）、`tools/split_css.py`（`GAMES` 加 `"yakushi": ("ys-",)`）、`CLAUDE.md`（§4.3.1 付款分頁清單、§5.2.1 已分開遊戲清單加 `yakushi`）

**Interfaces:**
- Produces: `YAKUSHI_SCRIPTS`（順序見 Global Constraints）、`build_yakushi_html()`、頁面根元素 `#ys-app`

- [ ] **Step 1: 寫頁面**（`site_src/yakushi_page.py`）

```python
"""少女藥師的獨語（yakushi）的頁面。規則依據 docs/yakushi_game_design.md。

架空中華後宮的推理冒險：調查 → 鑑定 → 試藥／調藥 → 推理板 → 指認。
載入順序：yakushi_herbs.js（registry）→ yakushi_herbs_*.js（6 類藥材）→ yakushi_cast.js（人物）
→ yakushi_core.js（規則）→ yakushi_case_*.js（案件）→ yakushi.js（畫面、存檔）。
2026-11-24 依使用者需求新增；放在首頁「付款」分頁（page_shell(paid=True)）。
"""

from __future__ import annotations

from site_src.layout import page_shell

YAKUSHI_SCRIPTS: tuple[str, ...] = (
    "yakushi_herbs.js",
    "yakushi_herbs_poison.js",
    "yakushi_herbs_mineral.js",
    "yakushi_herbs_animal.js",
    "yakushi_herbs_tonic.js",
    "yakushi_herbs_clear.js",
    "yakushi_herbs_boudoir.js",
    "yakushi_cast.js",
    "yakushi_core.js",
    "yakushi_case_0.js",
    "yakushi_case_1.js",
    "yakushi_case_2.js",
    "yakushi_case_3.js",
    "yakushi.js",
)


def build_yakushi_html() -> str:
    body = """    <div id="ys-app">
      <noscript>這個遊戲需要 JavaScript。</noscript>
    </div>
"""
    return page_shell(
        paid=True,
        title="少女藥師的獨語",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=YAKUSHI_SCRIPTS,
        extra_styles=("css/yakushi.css",),
        extra_i18n=("i18n/yakushi.js",),
    )
```

- [ ] **Step 2: 寫字串檔**（`site_src/i18n_yakushi.py`，先放骨架需要的鍵；之後的 Task 往 `_ROWS` 追加）

```python
"""少女藥師的獨語（yakushi）的 UI 字串。第 1 階段只做 zh，ja／en 先與 zh 相同。
由 i18n_data.py 合併；generate.py 依 ys_ 前綴輸出成 static/i18n/yakushi.js。
劇情、藥材、人物文字放在 static_src/yakushi_*.js 的資料裡。"""

from __future__ import annotations

_ROWS: tuple[tuple[str, str], ...] = (
    ("ys_title", "少女藥師的獨語"),
    ("ys_loading", "載入中…"),
    ("ys_disclaimer", "藥材說明與解方皆為遊戲設定，非醫療建議。"),
)

YAKUSHI_ZH: dict[str, str] = {k: zh for k, zh in _ROWS}
YAKUSHI_JA: dict[str, str] = dict(YAKUSHI_ZH)
YAKUSHI_EN: dict[str, str] = dict(YAKUSHI_ZH)

YAKUSHI_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_yakushi_name": "少女藥師的獨語", "project_yakushi_desc": "藥師養女誤入後宮，用藥材知識與推理，解開後宮、花街與宮外的藥毒事件"},
    "ja": {"project_yakushi_name": "少女藥師的獨語", "project_yakushi_desc": "薬師の養女が後宮へ。薬の知識と推理で後宮・花街・宮外の事件を解く"},
    "en": {"project_yakushi_name": "少女藥師的獨語", "project_yakushi_desc": "An apothecary's daughter solves poison mysteries in the inner palace"},
}
```

- [ ] **Step 3: JS 空殼**（14 檔，各自一個 IIFE；以 `yakushi_core.js` 為例，其餘換掉命名空間；藥材資料檔先放 `var LIST = [];` 並依介面的匯出規則匯出；案件檔 `yakushi_case_*.js` 先在 Node 時 `module.exports = null`、瀏覽器端不登記）

```js
// 少女藥師的獨語（yakushi）：規則核心。不碰 DOM、不讀寫 localStorage。規則依據 docs/yakushi_game_design.md。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var api = {};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PriTestYakushiCore = api;
})();
```

`yakushi.js` 骨架：

```js
// 少女藥師的獨語（yakushi）：畫面、存檔、操作。
(function () {
  "use strict";
  function t(k, p) { return window.I18N ? window.I18N.t(k, p) : k; }
  function boot() {
    var app = document.getElementById("ys-app");
    if (!app) return;
    app.innerHTML = '<p class="ys-loading">' + t("ys_loading") + "</p>";
  }
  window.PriTestYakushi = { _debugState: function () { return null; }, _debugRun: function () { return null; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
```

`static_src/css/yakushi.css` 先放色彩 token：

```css
/* 少女藥師的獨語（yakushi）。所有 class／id 用 ys- 前綴。 */
#ys-app { --ys-paper: #f4ecd8; --ys-ink: #2b2420; --ys-red: #a8322d; --ys-gold: #b8892f; --ys-jade: #4f7a64;
  --ys-line: #cdbf9f; background: var(--ys-paper); color: var(--ys-ink); min-height: 70vh; padding: 12px;
  font-family: "Noto Serif TC", "Songti TC", serif; box-sizing: border-box; max-width: 100%; overflow-x: hidden; }
@media (prefers-color-scheme: dark) {
  #ys-app { --ys-paper: #1f1b17; --ys-ink: #eadfc8; --ys-line: #4a4036; }
}
.ys-loading { text-align: center; opacity: .7; }
```

- [ ] **Step 4: 登記**（`generate.py`、`i18n_data.py`、`projects.py`、`split_css.py`，依 inusnow 的同位置照抄；projects 項目）

```python
    {
        "id": "yakushi",
        "href": "yakushi/index.html",
        "name_key": "project_yakushi_name",
        "desc_key": "project_yakushi_desc",
        # 使用者指定 2026-11-24：放「付款」分頁
    },
```

`generate.py` 建頁：

```python
    yakushi_dir = DIST_DIR / "yakushi"
    yakushi_dir.mkdir(parents=True, exist_ok=True)
    (yakushi_dir / "index.html").write_text(build_yakushi_html(), encoding="utf-8")
```

- [ ] **Step 5: 建置與檢查**

Run: `py -3 generate.py; py -3 tools/split_css.py --check; for f in static_src/yakushi*.js; do node --check $f; done`
Expected: 建置成功；`dist/yakushi/index.html` 存在；`dist/static/i18n/yakushi.js` 含 `ys_title`；split_css 無錯；node --check 全部通過。

- [ ] **Step 6: Commit**

```bash
git add site_src/yakushi_page.py site_src/i18n_yakushi.py static_src/css/yakushi.css static_src/yakushi*.js generate.py site_src/i18n_data.py site_src/projects.py tools/split_css.py CLAUDE.md
git commit -m "feat(yakushi): 少女藥師的獨語 頁面骨架與登記"
```

---

### Task 2: 藥材 registry

**Files:**
- Modify: `static_src/yakushi_herbs.js`
- Test: `tools/yakushi_check/herbs_check.js`（本 Task 先寫 registry 的部分，Task 3／4 追加資料檢查）

**Interfaces:**
- Produces: 介面一節的 `Herbs.*` 全部

- [ ] **Step 1: 寫失敗的測試**（`tools/yakushi_check/herbs_check.js`）

```js
// 少女藥師的獨語（yakushi）藥材 registry 與資料檢查。規則依據 docs/yakushi_game_design.md §4。
// 執行：node tools/yakushi_check/herbs_check.js
"use strict";
var path = require("path"), assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

// ---------- registry（用假資料，不載入真資料） ----------
var Herbs = require(path.join(SRC, "yakushi_herbs.js"));
function fake(id, group, form, onset) {
  return { id: id, name: id, alias: [id + "別名"], cat: "poison", group: group, danger: 1,
    traits: { form: form, smell: [], taste: [], symptom: [], onset: onset }, tests: {}, distinguish: null, lore: "" };
}
Herbs.register([fake("a", "g1", ["黃花", "藤本"], "fast"), fake("b", "g1", ["黃花"], "slow"), fake("c", null, ["根"], null)]);

test("get／list 依登記順", function () {
  assert.strictEqual(Herbs.get("a").id, "a");
  assert.strictEqual(Herbs.get("zz"), null);
  assert.deepStrictEqual(Herbs.list().map(function (h) { return h.id; }), ["a", "b", "c"]);
});
test("id 重複會 throw", function () {
  assert.throws(function () { Herbs.register([fake("a", null, [], null)]); });
});
test("byGroup／byCat", function () {
  assert.deepStrictEqual(Herbs.byGroup("g1").map(function (h) { return h.id; }), ["a", "b"]);
  assert.strictEqual(Herbs.byCat("poison").length, 3);
});
test("tagsOf 含 onset", function () {
  assert.deepStrictEqual(Herbs.tagsOf(Herbs.get("a")), ["黃花", "藤本", "onset:fast"]);
  assert.deepStrictEqual(Herbs.tagsOf(Herbs.get("c")), ["根"]);
});
test("filter：全部 tags 都要有", function () {
  assert.deepStrictEqual(Herbs.filter(["黃花"]).map(function (h) { return h.id; }), ["a", "b"]);
  assert.deepStrictEqual(Herbs.filter(["黃花", "onset:fast"]).map(function (h) { return h.id; }), ["a"]);
  assert.strictEqual(Herbs.filter([]).length, 3);
});
test("search：名稱或別名", function () {
  assert.deepStrictEqual(Herbs.search("b別").map(function (h) { return h.id; }), ["b"]);
});
Herbs._reset();   // 只給測試用：清空 registry，下面的資料檢查重新載入真資料

console.log("\n" + passed + " passed");
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node tools/yakushi_check/herbs_check.js`
Expected: FAIL（`Herbs.register is not a function`）

- [ ] **Step 3: 實作**（`static_src/yakushi_herbs.js`）

```js
// 少女藥師的獨語（yakushi）：藥材 registry。資料由 yakushi_herbs_<cat>.js 登記。規則依據 docs/yakushi_game_design.md §4。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var byId = {}, order = [];
  function register(list) {
    list.forEach(function (h) {
      if (byId[h.id]) throw new Error("yakushi: 藥材 id 重複 " + h.id);
      byId[h.id] = h; order.push(h.id);
    });
  }
  function get(id) { return byId[id] || null; }
  function list() { return order.map(get); }
  function byCat(cat) { return list().filter(function (h) { return h.cat === cat; }); }
  function byGroup(g) { return list().filter(function (h) { return h.group === g; }); }
  function tagsOf(h) {
    var t = h.traits || {};
    var out = [].concat(t.form || [], t.smell || [], t.taste || [], t.symptom || []);
    if (t.onset) out.push("onset:" + t.onset);
    return out;
  }
  function filter(tags) {
    return list().filter(function (h) {
      var own = tagsOf(h);
      return tags.every(function (x) { return own.indexOf(x) >= 0; });
    });
  }
  function search(q) {
    q = String(q || "");
    return list().filter(function (h) {
      return h.name.indexOf(q) >= 0 || (h.alias || []).some(function (a) { return a.indexOf(q) >= 0; });
    });
  }
  function _reset() { byId = {}; order = []; }
  var api = {
    CATS: ["poison", "mineral", "animal", "tonic", "clear", "boudoir"],
    METHODS: ["look", "smell", "taste", "silver", "water", "heat", "animal"],
    register: register, get: get, list: list, byCat: byCat, byGroup: byGroup,
    tagsOf: tagsOf, filter: filter, search: search, _reset: _reset
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PriTestYakushiHerbs = api;
})();
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node tools/yakushi_check/herbs_check.js`
Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add static_src/yakushi_herbs.js tools/yakushi_check/herbs_check.js
git commit -m "feat(yakushi): 藥材 registry 與特徵篩選"
```

---

### Task 3: 藥材資料（毒草、礦石、動物，48 種）

**Files:**
- Modify: `static_src/yakushi_herbs_poison.js`, `static_src/yakushi_herbs_mineral.js`, `static_src/yakushi_herbs_animal.js`
- Test: `tools/yakushi_check/herbs_check.js`（追加資料檢查）

**Interfaces:**
- Consumes: `Herbs.register`、`Herbs.tagsOf`、`Herbs.METHODS`
- Produces: 下表的藥材 id（案件與檢查都用這些 id）

**id 與群組（必須完全一致）：**

| cat | id（名稱）→ group／danger |
|---|---|
| poison | `gouwen` 鉤吻→yellow_vine/3、`chuanwu` 川烏→aconite/3、`caowu` 草烏→aconite/3、`fuzi` 附子→aconite/2、`tianxiong` 天雄→aconite/3、`mantuoluo` 曼陀羅→nightshade/3、`langdang` 莨菪→nightshade/3、`jiazhutao` 夾竹桃→pink_leaf/3、`duqin` 毒芹→umbel/3、`shanglu` 商陸→human_root/2、`lilu` 藜蘆→null/3、`maqianzi` 馬錢子→null/3、`leigongteng` 雷公藤→null/3、`badou` 巴豆→null/3、`banxia` 生半夏→raw_tuber/2、`tiannanxing` 生天南星→raw_tuber/2、`yangzhizhu` 羊躑躅→mad_honey/3、`xiangsizi` 相思子→null/3、`bimazi` 蓖麻子→null/3、`yingsuke` 罌粟殼→null/2、`gansui` 甘遂→null/2、`yuanhua` 芫花→null/2 |
| mineral | `pishuang` 砒霜→white_powder/3、`xionghuang` 雄黃→red_mineral/2、`zhusha` 朱砂→red_mineral/2、`shuiyin` 水銀→null/3、`qiandan` 鉛丹→red_mineral/2、`qianfen` 鉛粉→white_powder/2、`qingfen` 輕粉→null/3、`danfan` 膽礬→null/2、`mingfan` 明礬→white_powder/1、`pengsha` 硼砂→white_powder/1、`mangxiao` 芒硝→white_powder/1、`shigao` 石膏→white_powder/0 |
| animal | `banmao` 斑蝥→null/3、`chansu` 蟾酥→numb_poison/3、`wugong` 蜈蚣→null/2、`quanxie` 全蠍→null/2、`hetun` 河豚→numb_poison/3、`shexiang` 麝香→null/1、`niuhuang` 牛黃→null/0、`shuizhi` 水蛭→null/1、`qishe` 蘄蛇→null/1、`zhenzhu` 珍珠→null/0、`guijia` 龜甲→null/0、`jiangcan` 僵蠶→null/0、`chantui` 蟬蛻→null/0、`xiongdan` 熊膽→null/0 |

**撰寫規則：**
- 每筆都有介面一節的全部欄位；`lore` 2～4 句常識；`distinguish`：有群組的必填（寫怎麼和同群組其他成員分開），沒有群組填 null。
- `traits` 用短標籤（2～8 字），同一個意思全專案只用一種寫法（例：一律寫「口唇發麻」，不要混用「嘴唇麻」）。群組成員的外觀標籤要有共同部分（讓篩選停在群組），再各自有至少一個獨有標籤或不同的 `tests` 結果。
- `tests` 沒有特別反應的方法填 null；`silver` 只有 `pishuang` 填「銀針變黑（因含硫雜質）」，其他一律 null（§4.4「銀針不是萬能」）。
- 禁用字：「劑量」「克」「錢（重量單位）」「服用量」「提煉」「萃取」「購買」。

完整範例（照這個密度寫其他 47 筆）：

```js
// 少女藥師的獨語（yakushi）：毒草（22）。文字只寫常識，不寫劑量、提煉、取得方法（§4.5）。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var LIST = [
    { id: "gouwen", name: "鉤吻", alias: ["斷腸草", "胡蔓藤"], cat: "poison", group: "yellow_vine", danger: 3,
      traits: { form: ["藤本", "黃花", "漏斗狀花冠", "葉對生光滑"], smell: ["無明顯香氣"], taste: [],
        symptom: ["呼吸困難", "肌肉無力", "眩暈"], onset: "fast" },
      tests: { look: "花冠漏斗狀、單朵開，葉面光滑無毛", smell: "幾乎沒有氣味", taste: null, silver: null,
        water: null, heat: null, animal: "雞啄食後很快站不穩" },
      distinguish: "與金銀花同為黃花藤本；金銀花花成對、黃白兩色並有清香，鉤吻無香、花冠漏斗狀。",
      lore: "南方山野常見的藤本毒草，自古就有「斷腸草」之名。外觀與金銀花相近，誤採的故事屢見不鮮。" }
    // ……其餘 21 筆
  ];
  if (typeof module !== "undefined" && module.exports) module.exports = LIST;
  if (root.PriTestYakushiHerbs) root.PriTestYakushiHerbs.register(LIST);
})();
```

- [ ] **Step 1: 追加失敗的資料檢查**（加在 `herbs_check.js` 的 `Herbs._reset();` 之後、結尾 `console.log` 之前）

```js
// ---------- 真資料 ----------
global.PriTestYakushiHerbs = Herbs;
var FILES = ["poison", "mineral", "animal", "tonic", "clear", "boudoir"];
var EXPECT = { poison: 22, mineral: 12, animal: 14, tonic: 18, clear: 18, boudoir: 16 };
var GROUPS = ["aconite", "yellow_vine", "nightshade", "umbel", "human_root", "pink_leaf", "almond",
  "white_powder", "red_mineral", "red_flower", "numb_poison", "fragrant_wood", "raw_tuber", "mad_honey"];
var loaded = [];
FILES.forEach(function (cat) {
  var p = path.join(SRC, "yakushi_herbs_" + cat + ".js");
  if (require("fs").existsSync(p) && require(p).length) loaded.push(cat);   // Task 1 的空殼（0 筆）不算已載入
});
var BANNED = ["劑量", "克", "服用量", "提煉", "萃取", "購買"];

test("已載入類別的數量符合 §4.2", function () {
  loaded.forEach(function (cat) {
    var LIST = require(path.join(SRC, "yakushi_herbs_" + cat + ".js"));
    assert.strictEqual(LIST.length, EXPECT[cat], cat + " 應為 " + EXPECT[cat] + " 種，實際 " + LIST.length);
    LIST.forEach(function (h) { assert.strictEqual(h.cat, cat, h.id + " 的 cat"); });
  });
});
test("前 3 類（毒草、礦石、動物）已有資料", function () {
  ["poison", "mineral", "animal"].forEach(function (c) { assert.ok(loaded.indexOf(c) >= 0, c + " 還沒有資料"); });
});
test("每筆欄位齊全、danger 0..3、group 合法", function () {
  Herbs.list().forEach(function (h) {
    assert.ok(/^[a-z]+$/.test(h.id), h.id);
    assert.ok(h.name && Array.isArray(h.alias) && h.lore, h.id + " 缺 name／alias／lore");
    assert.ok(h.danger >= 0 && h.danger <= 3, h.id + " danger");
    assert.ok(h.group === null || GROUPS.indexOf(h.group) >= 0, h.id + " group " + h.group);
    assert.ok(h.traits && Array.isArray(h.traits.form) && h.traits.form.length > 0, h.id + " traits.form");
    Herbs.METHODS.forEach(function (m) { assert.ok(m in h.tests, h.id + " tests." + m); });
    if (h.group) assert.ok(h.distinguish, h.id + " 有群組卻沒有 distinguish");
  });
});
test("銀針只對砒霜有反應（§4.4）", function () {
  Herbs.list().forEach(function (h) {
    if (h.id === "pishuang") assert.ok(h.tests.silver, "砒霜要有銀針反應");
    else assert.strictEqual(h.tests.silver, null, h.id + " 的 silver 應為 null");
  });
});
test("文字不含劑量、提煉、取得方法（§4.5）", function () {
  Herbs.list().forEach(function (h) {
    var all = JSON.stringify(h);
    BANNED.forEach(function (w) { assert.ok(all.indexOf(w) < 0, h.id + " 含禁用字「" + w + "」"); });
  });
});
test("易混群組：外觀有共同標籤，且兩兩可分辨", function () {
  GROUPS.forEach(function (g) {
    var members = Herbs.byGroup(g);
    if (members.length === 0) return;               // 該群組的類別還沒載入
    var common = Herbs.tagsOf(members[0]).filter(function (tag) {
      return members.every(function (m) { return Herbs.tagsOf(m).indexOf(tag) >= 0; });
    });
    if (members.length >= 2) assert.ok(common.length > 0, g + " 沒有共同標籤，篩選無法停在群組");
    for (var i = 0; i < members.length; i++) for (var j = i + 1; j < members.length; j++) {
      var a = members[i], b = members[j];
      var ta = Herbs.tagsOf(a).sort().join("|"), tb = Herbs.tagsOf(b).sort().join("|");
      var diffTest = Herbs.METHODS.some(function (m) { return (a.tests[m] || null) !== (b.tests[m] || null); });
      assert.ok(ta !== tb || diffTest, g + "：" + a.id + " 與 " + b.id + " 無法分辨");
    }
  });
});
```

（注意：跨類別群組 `human_root`、`pink_leaf`、`umbel`、`red_flower`、`mad_honey`、`almond`、`yellow_vine`、`fragrant_wood` 的另一半在 Task 4，Task 3 結束時只會檢查已載入的成員。）

- [ ] **Step 2: 跑檢查確認失敗**

Run: `node tools/yakushi_check/herbs_check.js`
Expected: FAIL（poison 還沒有資料）

- [ ] **Step 3: 寫 48 筆資料**（依上面的 id 表與撰寫規則）

- [ ] **Step 4: 跑檢查確認通過**

Run: `node tools/yakushi_check/herbs_check.js; node --check static_src/yakushi_herbs_poison.js`
Expected: 全部 ok

- [ ] **Step 5: Commit**

```bash
git add static_src/yakushi_herbs_poison.js static_src/yakushi_herbs_mineral.js static_src/yakushi_herbs_animal.js tools/yakushi_check/herbs_check.js
git commit -m "feat(yakushi): 藥材資料：毒草、礦石、動物 48 種"
```

---

### Task 4: 藥材資料（補益、清熱、香料妝品食材，52 種）

**Files:**
- Modify: `static_src/yakushi_herbs_tonic.js`, `static_src/yakushi_herbs_clear.js`, `static_src/yakushi_herbs_boudoir.js`
- Test: `tools/yakushi_check/herbs_check.js`（追加總數檢查）

**Interfaces:**
- Consumes: Task 2、3
- Produces: 下表的 id

| cat | id（名稱）→ group／danger |
|---|---|
| tonic | `renshen` 人參→human_root/0、`dangshen` 黨參→human_root/0、`huangqi` 黃耆/0、`danggui` 當歸/0、`shudihuang` 熟地黃/0、`gouqizi` 枸杞子/0、`lurong` 鹿茸/0、`ejiao` 阿膠/0、`baizhu` 白朮/0、`fuling` 茯苓/0、`shanyao` 山藥/0、`dazao` 大棗/0、`heshouwu` 何首烏/1、`dongchongxiacao` 冬蟲夏草/0、`rougui` 肉桂/0、`duzhong` 杜仲/0、`suanzaoren` 酸棗仁/0、`lingzhi` 靈芝/0（未標 group 的都是 null） |
| clear | `gancao` 甘草/0、`jinyinhua` 金銀花→yellow_vine/0、`huanglian` 黃連/0、`huangqin` 黃芩/0、`lvdou` 綠豆/0、`fangfeng` 防風/0、`shengjiang` 生薑/0、`banlangen` 板藍根/0、`lianqiao` 連翹/0、`juhua` 菊花/0、`gegen` 葛根/0、`chaihu` 柴胡/0、`dahuang` 大黃/1、`pugongying` 蒲公英/0、`yuxingcao` 魚腥草/0、`jiegeng` 桔梗/0、`mahuang` 麻黃/1、`baimaogen` 白茅根/0 |
| boudoir | `honghua` 紅花→red_flower/1、`fanhonghua` 番紅花→red_flower/1、`yanzhi` 胭脂→red_flower/0、`baizhi` 白芷/0、`huajiao` 花椒/0、`kuxingren` 苦杏仁→almond/2、`tianxingren` 甜杏仁→almond/0、`bohe` 薄荷/0、`chenxiang` 沉香→fragrant_wood/0、`tanxiang` 檀香→fragrant_wood/0、`dingxiang` 丁香/0、`molihua` 茉莉花/0、`taoren` 桃仁→pink_leaf/1、`aiye` 艾葉/0、`fengmi` 蜂蜜→mad_honey/0、`qincai` 芹菜→umbel/0 |

撰寫規則同 Task 3。

- [ ] **Step 1: 追加失敗的總數檢查**（接在 Task 3 的檢查之後）

```js
test("6 類全部載入，共 100 種，14 個群組都至少 2 名成員", function () {
  assert.deepStrictEqual(loaded, FILES);
  assert.strictEqual(Herbs.list().length, 100);
  GROUPS.forEach(function (g) { assert.ok(Herbs.byGroup(g).length >= 2, g + " 成員不足 2"); });
});
```

- [ ] **Step 2: 跑檢查確認失敗**

Run: `node tools/yakushi_check/herbs_check.js`
Expected: FAIL（loaded 只有前 3 類）

- [ ] **Step 3: 寫 52 筆資料**

- [ ] **Step 4: 跑檢查確認通過**

Run: `node tools/yakushi_check/herbs_check.js`
Expected: 全部 ok

- [ ] **Step 5: Commit**

```bash
git add static_src/yakushi_herbs_tonic.js static_src/yakushi_herbs_clear.js static_src/yakushi_herbs_boudoir.js tools/yakushi_check/herbs_check.js
git commit -m "feat(yakushi): 藥材資料：補益、清熱、香料妝品食材 52 種（共 100 種）"
```

---

### Task 5: 規則核心（存檔、案件開始、調查與時辰）

**Files:**
- Modify: `static_src/yakushi_core.js`
- Test: `tools/yakushi_check/core_check.js`

**Interfaces:**
- Consumes: `Herbs.get`、`Herbs.filter`
- Produces: `Core.CASE_ORDER`、`SLOTS`、`registerCase`、`getCase`、`newSave`、`normalizeSave`、`startCase`、`cardInfo`、`spotOpen`、`move`、`visit`、`toBoard`

- [ ] **Step 1: 寫失敗的測試**（`tools/yakushi_check/core_check.js`；用測試專用的小案件 `tcase`，不依賴真案件）

```js
// 少女藥師的獨語（yakushi）規則核心檢查。規則依據 docs/yakushi_game_design.md §5～§8。
// 執行：node tools/yakushi_check/core_check.js
"use strict";
var path = require("path"), assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
var Herbs = require(path.join(SRC, "yakushi_herbs.js"));
global.PriTestYakushiHerbs = Herbs;
["poison", "mineral", "animal", "tonic", "clear", "boudoir"].forEach(function (c) { require(path.join(SRC, "yakushi_herbs_" + c + ".js")); });
var Core = require(path.join(SRC, "yakushi_core.js"));
var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

// 測試專用案件：生半夏混入芋頭（與序章同構，但 id 獨立）
var TCASE = {
  id: "case0", title: "測試", hours: 8, startPlace: "p1", cast: ["maomao"], startCards: [],
  places: [
    { id: "p1", name: "宿舍", spots: [
      { id: "s_sick", kind: "look", label: "看病人", gives: ["sym"], text: "口舌發麻" },
      { id: "s_talk", kind: "talk", label: "問人", requires: ["ev_led"], gives: ["p_eu", "tes_eu"], text: "……" }
    ] },
    { id: "p2", name: "廚房", spots: [
      { id: "s_pot", kind: "look", label: "鍋", gives: ["ev_tu"], text: "芋頭" },
      { id: "s_led", kind: "look", label: "帳", cost: 2, gives: ["ev_led"], text: "帳本" }
    ] }
  ],
  cards: {
    sym: { kind: "symptom", name: "口舌發麻", text: "", tags: [], of: "ev_tu" },
    ev_tu: { kind: "evidence", name: "芋頭", text: "", tags: ["塊莖"], herb: "banxia" },
    ev_led: { kind: "evidence", name: "帳本", text: "" },
    p_eu: { kind: "person", name: "小宦官", text: "" },
    tes_eu: { kind: "testimony", name: "證言", text: "" },
    re_look: { kind: "reaction", name: "細看", text: "", tags: [], of: "ev_tu" },
    tes_pt: { kind: "testimony", name: "病人證言", text: "" }
  },
  tests: [{ evidence: "ev_tu", method: "look", text: "小而圓", gives: "re_look" }],
  patients: [{ id: "pt", name: "阿桃", remedy: ["shengjiang", "gancao"], gives: "tes_pt", text: "" }],
  medicineBox: ["shengjiang", "gancao", "lvdou", "bohe"],
  solution: { who: "p_eu", what: "herb:banxia", how: "tes_eu", why: "ev_led" },
  rebuttals: [
    { who: "eu", claim: "那是芋頭", accepts: ["herb:banxia", "re_look"], reply: "……" },
    { who: "eu", claim: "錢沒少", accepts: ["ev_led"], reply: "……" }
  ],
  deep: { label: "誰教的", options: [{ key: "a", card: "tes_pt", monologue: [{ who: "maomao", text: "A" }] }], none: [{ who: "maomao", text: "N" }] },
  story: { intro: [], truth: [], outro: [] },
  monologue: [{ who: "maomao", text: "M" }]
};
Core.registerCase(TCASE);

test("newSave：只解鎖序章", function () {
  var s = Core.newSave();
  assert.deepStrictEqual(s.unlocked, ["case0"]);
  assert.strictEqual(s.v, 1);
});
test("normalizeSave：壞資料重建、缺欄位補齊", function () {
  assert.deepStrictEqual(Core.normalizeSave(null), Core.newSave());
  var s = Core.normalizeSave({ unlocked: ["case0", "case1"], herbsSeen: { banxia: true } });
  assert.deepStrictEqual(s.unlocked, ["case0", "case1"]);
  assert.deepStrictEqual(s.monologues, {});
  assert.strictEqual(s.herbsSeen.banxia, true);
});
test("startCase：鎖住的案件不能開始", function () {
  var s = Core.newSave();
  assert.deepStrictEqual(Core.startCase(s, "case1"), { error: "locked" });
  assert.deepStrictEqual(Core.startCase(s, "nope"), { error: "case" });
  var r = Core.startCase(s, "case0");
  assert.strictEqual(r.hours, 8); assert.strictEqual(r.place, "p1"); assert.strictEqual(r.phase, "investigate");
  assert.strictEqual(s.cases.case0.run, r);
  assert.deepStrictEqual(r.patients.pt, { level: 0, cured: false, lost: false });
});
test("visit：同場所才能查、扣時辰、不能重複、requires 未滿足會鎖", function () {
  var r = Core.startCase(Core.newSave(), "case0");
  assert.deepStrictEqual(Core.visit(r, "s_pot"), { error: "place" });
  assert.deepStrictEqual(Core.visit(r, "s_talk"), { error: "locked" });
  var v = Core.visit(r, "s_sick");
  assert.ok(v.ok); assert.deepStrictEqual(v.gives, ["sym"]); assert.strictEqual(r.hours, 7);
  assert.deepStrictEqual(Core.visit(r, "s_sick"), { error: "done" });
});
test("move：換場所扣 1，同場所 0；cost 欄位生效", function () {
  var r = Core.startCase(Core.newSave(), "case0");
  assert.deepStrictEqual(Core.move(r, "p1"), { ok: true, cost: 0 });
  assert.deepStrictEqual(Core.move(r, "p2"), { ok: true, cost: 1 });
  Core.visit(r, "s_led");
  assert.strictEqual(r.hours, 5);
  assert.deepStrictEqual(Core.move(r, "zz"), { error: "place" });
});
test("時辰用完強制進入推理板，之後不能調查", function () {
  var r = Core.startCase(Core.newSave(), "case0");
  r.hours = 1;
  Core.visit(r, "s_sick");
  assert.strictEqual(r.hours, 0); assert.strictEqual(r.phase, "board");
  assert.deepStrictEqual(Core.move(r, "p2"), { error: "phase" });
});
test("cardInfo：一般卡與 herb: 卡", function () {
  assert.strictEqual(Core.cardInfo(TCASE, "ev_tu").name, "芋頭");
  var h = Core.cardInfo(TCASE, "herb:banxia");
  assert.strictEqual(h.kind, "herb"); assert.strictEqual(h.herb, "banxia"); assert.strictEqual(h.name, "生半夏");
  assert.strictEqual(Core.cardInfo(TCASE, "zz"), null);
});

console.log("\n" + passed + " passed");
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node tools/yakushi_check/core_check.js`
Expected: FAIL（`Core.registerCase is not a function`）

- [ ] **Step 3: 實作**（`static_src/yakushi_core.js` 換成以下內容；Task 6、7 在 `// ---- 鑑定 ----` 等標記處追加）

```js
// 少女藥師的獨語（yakushi）：規則核心。不碰 DOM、不讀寫 localStorage；畫面（yakushi.js）只呼叫這裡。
// 規則依據 docs/yakushi_game_design.md。案件資料由 yakushi_case_*.js 用 registerCase() 登記。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  function H() { return root.PriTestYakushiHerbs; }

  // ---- 暫定數值（§5～§7） ----
  var START_STAMINA = 3;      // 體力：嚐 danger≥2 的藥材 -1，歸零強制休息
  var COLLAPSE_HOURS = 2;     // 體力歸零休息消耗的時辰
  var START_TRUST = 3;        // 指認時的信任
  var REMEDY_MAX_LEVEL = 3;   // 調藥錯誤惡化到這一級就被太醫接手
  var CASE_ORDER = ["case0", "case1", "case2", "case3"];
  var SLOTS = ["who", "what", "how", "why"];

  var cases = {};
  function registerCase(def) { cases[def.id] = def; }
  function getCase(id) { return cases[id] || null; }

  function newSave() { return { v: 1, unlocked: ["case0"], cases: {}, herbsSeen: {}, monologues: {}, castSeen: {} }; }
  function normalizeSave(raw) {
    var s = newSave();
    if (!raw || typeof raw !== "object") return s;
    if (Array.isArray(raw.unlocked) && raw.unlocked.length) s.unlocked = raw.unlocked.slice();
    ["cases", "herbsSeen", "monologues", "castSeen"].forEach(function (k) {
      if (raw[k] && typeof raw[k] === "object" && !Array.isArray(raw[k])) s[k] = raw[k];
    });
    return s;
  }

  function has(run, cardId) { return run.cards.indexOf(cardId) >= 0; }
  function addCard(run, id) { if (!has(run, id)) run.cards.push(id); }
  function spend(run, n) {
    run.hours = Math.max(0, run.hours - n);
    if (run.hours === 0 && run.phase === "investigate") run.phase = "board";
  }
  function findPlace(def, id) {
    for (var i = 0; i < def.places.length; i++) if (def.places[i].id === id) return def.places[i];
    return null;
  }
  function findSpot(def, spotId) {
    for (var i = 0; i < def.places.length; i++) {
      var sp = def.places[i].spots;
      for (var j = 0; j < sp.length; j++) if (sp[j].id === spotId) return { place: def.places[i], spot: sp[j] };
    }
    return null;
  }

  function startCase(save, caseId) {
    var def = getCase(caseId);
    if (!def) return { error: "case" };
    if (save.unlocked.indexOf(caseId) < 0) return { error: "locked" };
    var run = {
      caseId: caseId, hours: def.hours, stamina: START_STAMINA, trust: START_TRUST, place: def.startPlace,
      cards: (def.startCards || []).slice(), done: {}, identified: {}, tested: {}, patients: {},
      board: { who: null, what: null, how: null, why: null, deep: null },
      submits: 0, mispresent: 0, accuseFails: 0, accuseStep: 0, phase: "investigate", result: null
    };
    (def.patients || []).forEach(function (p) { run.patients[p.id] = { level: 0, cured: false, lost: false }; });
    save.cases[caseId] = save.cases[caseId] || {};
    save.cases[caseId].run = run;
    return run;
  }

  function cardInfo(def, id) {
    if (typeof id !== "string") return null;
    if (id.indexOf("herb:") === 0) {
      var h = H().get(id.slice(5));
      return h ? { id: id, kind: "herb", name: h.name, text: h.lore, tags: H().tagsOf(h), of: null, herb: h.id } : null;
    }
    var c = def.cards[id];
    if (!c) return null;
    return { id: id, kind: c.kind, name: c.name, text: c.text || "", tags: c.tags || [], of: c.of || null, herb: c.herb || null };
  }

  function spotOpen(run, spot) { return (spot.requires || []).every(function (c) { return has(run, c); }); }
  function move(run, placeId) {
    if (run.phase !== "investigate") return { error: "phase" };
    if (!findPlace(getCase(run.caseId), placeId)) return { error: "place" };
    if (run.place === placeId) return { ok: true, cost: 0 };
    run.place = placeId; spend(run, 1);
    return { ok: true, cost: 1 };
  }
  function visit(run, spotId) {
    if (run.phase !== "investigate") return { error: "phase" };
    var f = findSpot(getCase(run.caseId), spotId);
    if (!f) return { error: "spot" };
    if (f.place.id !== run.place) return { error: "place" };
    if (run.done[spotId]) return { error: "done" };
    if (!spotOpen(run, f.spot)) return { error: "locked" };
    run.done[spotId] = true;
    f.spot.gives.forEach(function (c) { addCard(run, c); });
    spend(run, f.spot.cost == null ? 1 : f.spot.cost);
    return { ok: true, text: f.spot.text, gives: f.spot.gives.slice() };
  }
  function toBoard(run) { if (run.phase === "investigate") run.phase = "board"; }

  // ---- 鑑定、試藥、調藥（Task 6） ----

  // ---- 推理板、指認、評價、結案（Task 7） ----

  var api = {
    CASE_ORDER: CASE_ORDER, SLOTS: SLOTS,
    registerCase: registerCase, getCase: getCase, newSave: newSave, normalizeSave: normalizeSave,
    startCase: startCase, cardInfo: cardInfo, spotOpen: spotOpen, move: move, visit: visit, toBoard: toBoard
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PriTestYakushiCore = api;
})();
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node tools/yakushi_check/core_check.js`
Expected: `7 passed`

- [ ] **Step 5: Commit**

```bash
git add static_src/yakushi_core.js tools/yakushi_check/core_check.js
git commit -m "feat(yakushi): 規則核心：存檔、案件開始、調查與時辰"
```

---

### Task 6: 規則核心（鑑定、試藥、調藥）

**Files:**
- Modify: `static_src/yakushi_core.js`（`// ---- 鑑定、試藥、調藥（Task 6） ----` 處、api）
- Test: `tools/yakushi_check/core_check.js`（追加）

**Interfaces:**
- Consumes: Task 5 的 `has`、`addCard`、`spend`、`getCase`、`cardInfo`
- Produces: `Core.evidenceTags`、`candidates`、`identify`、`runTest`、`giveRemedy`

- [ ] **Step 1: 追加失敗的測試**（插在 `console.log` 之前）

```js
function ready() {   // 拿到芋頭與病人症狀的 run
  var r = Core.startCase(Core.newSave(), "case0");
  Core.visit(r, "s_sick"); Core.move(r, "p2"); Core.visit(r, "s_pot");
  return r;
}
test("evidenceTags：證物本身＋of 指向它的卡", function () {
  var r = ready();
  TCASE.cards.sym.tags = ["口舌發麻"];
  assert.deepStrictEqual(Core.evidenceTags(r, "ev_tu").sort(), ["口舌發麻", "塊莖"].sort());
  TCASE.cards.sym.tags = [];
});
test("candidates：真藥材一定在候選裡", function () {
  var ids = Core.candidates(["塊莖"]).map(function (h) { return h.id; });
  assert.ok(ids.indexOf("banxia") >= 0 && ids.indexOf("tiannanxing") >= 0);
});
test("identify：對的不扣時辰、錯的扣 1，都不公開對錯；重鑑定會換卡", function () {
  var r0 = Core.startCase(Core.newSave(), "case0");
  assert.deepStrictEqual(Core.identify(r0, "ev_tu", "banxia"), { error: "missing" });
  assert.deepStrictEqual(Core.identify(r0, "ev_led", "banxia"), { error: "evidence" });
  var r = ready(), h0 = r.hours;
  assert.deepStrictEqual(Core.identify(r, "ev_tu", "zz"), { error: "herb" });
  assert.deepStrictEqual(Core.identify(r, "ev_tu", "tiannanxing"), { ok: true });
  assert.strictEqual(r.hours, h0 - 1);
  assert.ok(r.cards.indexOf("herb:tiannanxing") >= 0);
  assert.deepStrictEqual(Core.identify(r, "ev_tu", "banxia"), { ok: true });
  assert.strictEqual(r.hours, h0 - 1);
  assert.ok(r.cards.indexOf("herb:banxia") >= 0);
  assert.ok(r.cards.indexOf("herb:tiannanxing") < 0);
  assert.strictEqual(r.identified.ev_tu, "banxia");
});
test("runTest：案件指定的結果優先，給反應卡；重複不再扣時辰", function () {
  var r = ready(), h0 = r.hours;
  var t1 = Core.runTest(r, "ev_tu", "look");
  assert.strictEqual(t1.text, "小而圓"); assert.strictEqual(t1.gives, "re_look");
  assert.ok(r.cards.indexOf("re_look") >= 0); assert.strictEqual(r.hours, h0 - 1);
  var t2 = Core.runTest(r, "ev_tu", "look");
  assert.strictEqual(t2.repeat, true); assert.strictEqual(r.hours, h0 - 1);
  assert.deepStrictEqual(Core.runTest(r, "ev_tu", "zz"), { error: "method" });
});
test("runTest：沒有指定就用藥材的 tests；沒有就 null", function () {
  var r = ready();
  var t = Core.runTest(r, "ev_tu", "silver");
  assert.strictEqual(t.text, null);
  var smell = Core.runTest(r, "ev_tu", "smell");
  assert.strictEqual(smell.text, Herbs.get("banxia").tests.smell);
});
test("runTest：嚐 danger≥2 扣體力，歸零休息扣 2 時辰並回滿", function () {
  var r = ready();
  r.stamina = 1; r.hours = 8;
  var t = Core.runTest(r, "ev_tu", "taste");   // 生半夏 danger 2
  assert.strictEqual(t.collapsed, true);
  assert.strictEqual(r.stamina, 3);
  assert.strictEqual(r.hours, 8 - 1 - 2);
});
test("giveRemedy：藥箱限制、1～3 味、對了給證言、錯了惡化並扣時辰、到底就 lost", function () {
  var r = ready();
  assert.deepStrictEqual(Core.giveRemedy(r, "pt", ["renshen"]), { error: "box" });
  assert.deepStrictEqual(Core.giveRemedy(r, "pt", []), { error: "count" });
  var h0 = r.hours;
  var w = Core.giveRemedy(r, "pt", ["lvdou"]);
  assert.deepStrictEqual(w, { ok: true, cured: false, lost: false });
  assert.strictEqual(r.patients.pt.level, 1); assert.strictEqual(r.hours, h0 - 1);
  var ok = Core.giveRemedy(r, "pt", ["gancao", "shengjiang"]);
  assert.deepStrictEqual(ok, { ok: true, cured: true, lost: false });
  assert.ok(r.cards.indexOf("tes_pt") >= 0);
  assert.deepStrictEqual(Core.giveRemedy(r, "pt", ["gancao"]), { error: "done" });
  var r2 = ready(); r2.hours = 8;
  Core.giveRemedy(r2, "pt", ["lvdou"]); Core.giveRemedy(r2, "pt", ["bohe"]);
  assert.strictEqual(Core.giveRemedy(r2, "pt", ["lvdou", "bohe"]).lost, true);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node tools/yakushi_check/core_check.js`
Expected: FAIL（`Core.evidenceTags is not a function`）

- [ ] **Step 3: 實作**（貼在 Task 6 標記處，並把 5 個函式加進 `api`）

```js
  function evidenceTags(run, evidenceId) {
    var def = getCase(run.caseId), out = [];
    function push(tags) { (tags || []).forEach(function (t) { if (out.indexOf(t) < 0) out.push(t); }); }
    if (def.cards[evidenceId]) push(def.cards[evidenceId].tags);
    run.cards.forEach(function (cid) {
      var c = def.cards[cid];
      if (c && c.of === evidenceId) push(c.tags);
    });
    return out;
  }
  function candidates(tags) { return H().filter(tags); }

  function identify(run, evidenceId, herbId) {
    if (run.phase !== "investigate") return { error: "phase" };
    var c = getCase(run.caseId).cards[evidenceId];
    if (!c || !c.herb) return { error: "evidence" };
    if (!has(run, evidenceId)) return { error: "missing" };
    if (!H().get(herbId)) return { error: "herb" };
    var prev = run.identified[evidenceId];
    run.identified[evidenceId] = herbId;
    if (prev && prev !== herbId) {
      var still = Object.keys(run.identified).some(function (e) { return run.identified[e] === prev; });
      if (!still) run.cards = run.cards.filter(function (x) { return x !== "herb:" + prev; });
    }
    addCard(run, "herb:" + herbId);
    if (herbId !== c.herb) spend(run, 1);     // §5.1：錯誤不公開，只多扣 1 時辰
    return { ok: true };
  }

  function runTest(run, evidenceId, method) {
    if (run.phase !== "investigate") return { error: "phase" };
    if (H().METHODS.indexOf(method) < 0) return { error: "method" };
    var def = getCase(run.caseId), c = def.cards[evidenceId];
    if (!c || !c.herb) return { error: "evidence" };
    if (!has(run, evidenceId)) return { error: "missing" };
    var key = evidenceId + "|" + method;
    if (key in run.tested) return { ok: true, text: run.tested[key], gives: null, collapsed: false, repeat: true };
    var entry = (def.tests || []).filter(function (t) { return t.evidence === evidenceId && t.method === method; })[0];
    var herb = H().get(c.herb);
    var text = entry ? entry.text : (herb && herb.tests && herb.tests[method]) || null;
    run.tested[key] = text;
    spend(run, 1);
    var collapsed = false;
    if (method === "taste" && herb && herb.danger >= 2) {
      run.stamina -= 1;
      if (run.stamina <= 0) { run.stamina = START_STAMINA; spend(run, COLLAPSE_HOURS); collapsed = true; }
    }
    var gives = entry && entry.gives ? entry.gives : null;
    if (gives) addCard(run, gives);
    return { ok: true, text: text, gives: gives, collapsed: collapsed, repeat: false };
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    var x = a.slice().sort(), y = b.slice().sort();
    for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  function giveRemedy(run, patientId, herbIds) {
    if (run.phase !== "investigate") return { error: "phase" };
    var def = getCase(run.caseId);
    var p = (def.patients || []).filter(function (x) { return x.id === patientId; })[0];
    if (!p) return { error: "patient" };
    var st = run.patients[patientId];
    if (st.cured || st.lost) return { error: "done" };
    if (!herbIds || herbIds.length < 1 || herbIds.length > 3) return { error: "count" };
    if (!herbIds.every(function (h) { return def.medicineBox.indexOf(h) >= 0; })) return { error: "box" };
    if (sameSet(herbIds, p.remedy)) { st.cured = true; addCard(run, p.gives); return { ok: true, cured: true, lost: false }; }
    st.level += 1;
    if (st.level >= REMEDY_MAX_LEVEL) st.lost = true;
    spend(run, 1);
    return { ok: true, cured: false, lost: st.lost };
  }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node tools/yakushi_check/core_check.js`
Expected: `14 passed`

- [ ] **Step 5: Commit**

```bash
git add static_src/yakushi_core.js tools/yakushi_check/core_check.js
git commit -m "feat(yakushi): 規則核心：鑑定、試藥、調藥"
```

---

### Task 7: 規則核心（推理板、指認、評價、結案）

**Files:**
- Modify: `static_src/yakushi_core.js`（Task 7 標記處、api）
- Test: `tools/yakushi_check/core_check.js`（追加）

**Interfaces:**
- Produces: `Core.placeCard`、`submit`、`currentRebuttal`、`present`、`rating`、`deepOption`、`finish`
- 評價公式（暫定）：`pts = 10 − max(0, submits−1) − mispresent − 2×accuseFails + (hours ≥ 3 ? 1 : 0)`；`≥10` S、`≥8` A、`≥5` B、其他 C
- 獨語 key：沒有 deep 的案件記 `"<caseId>:main"`；有 deep 的記 `"<caseId>:main"` 與 `"<caseId>:<option.key>"`（沒放卡記 `"<caseId>:none"`）

- [ ] **Step 1: 追加失敗的測試**

```js
function atBoard() {
  var r = ready();
  Core.move(r, "p2"); Core.visit(r, "s_led"); Core.move(r, "p1"); Core.visit(r, "s_talk");
  Core.identify(r, "ev_tu", "banxia");
  Core.toBoard(r);
  return r;
}
test("placeCard：只能放持有的卡、格子要合法", function () {
  var r = atBoard();
  assert.deepStrictEqual(Core.placeCard(r, "who", "zz"), { error: "card" });
  assert.deepStrictEqual(Core.placeCard(r, "when", "p_eu"), { error: "slot" });
  assert.deepStrictEqual(Core.placeCard(r, "who", "p_eu"), { ok: true });
  assert.deepStrictEqual(Core.placeCard(r, "who", null), { ok: true });
  assert.strictEqual(r.board.who, null);
});
test("submit：空格不能交；只回饋對幾格；4 格對進入指認", function () {
  var r = atBoard();
  assert.deepStrictEqual(Core.submit(r), { error: "empty" });
  Core.placeCard(r, "who", "p_eu"); Core.placeCard(r, "what", "herb:banxia");
  Core.placeCard(r, "how", "ev_led"); Core.placeCard(r, "why", "tes_eu");
  assert.deepStrictEqual(Core.submit(r), { correct: 2 });
  assert.strictEqual(r.phase, "board");
  Core.placeCard(r, "how", "tes_eu"); Core.placeCard(r, "why", "ev_led");
  assert.deepStrictEqual(Core.submit(r), { correct: 4 });
  assert.strictEqual(r.phase, "accuse"); assert.strictEqual(r.submits, 2);
});
function atAccuse() {
  var r = atBoard();
  Core.placeCard(r, "who", "p_eu"); Core.placeCard(r, "what", "herb:banxia");
  Core.placeCard(r, "how", "tes_eu"); Core.placeCard(r, "why", "ev_led");
  Core.submit(r);
  return r;
}
test("present：對了往下一輪；錯了扣信任；歸零重來", function () {
  var r = atAccuse();
  assert.strictEqual(Core.currentRebuttal(r).claim, "那是芋頭");
  var miss = Core.present(r, "ev_led");
  assert.strictEqual(miss.hit, false); assert.strictEqual(r.trust, 2); assert.strictEqual(r.mispresent, 1);
  assert.strictEqual(Core.present(r, "herb:banxia").hit, true);
  assert.strictEqual(r.accuseStep, 1);
  Core.present(r, "p_eu"); var last = Core.present(r, "p_eu");
  assert.strictEqual(last.reset, true);
  assert.strictEqual(r.accuseStep, 0); assert.strictEqual(r.trust, 3); assert.strictEqual(r.accuseFails, 1);
  Core.present(r, "herb:banxia");
  var done = Core.present(r, "ev_led");
  assert.strictEqual(done.done, true); assert.strictEqual(r.phase, "done");
});
test("rating：公式（暫定）", function () {
  var base = { submits: 1, mispresent: 0, accuseFails: 0, hours: 3 };
  assert.strictEqual(Core.rating(base), "S");
  assert.strictEqual(Core.rating({ submits: 1, mispresent: 0, accuseFails: 0, hours: 2 }), "S");
  assert.strictEqual(Core.rating({ submits: 2, mispresent: 0, accuseFails: 0, hours: 0 }), "A");
  assert.strictEqual(Core.rating({ submits: 2, mispresent: 1, accuseFails: 1, hours: 0 }), "B");
  assert.strictEqual(Core.rating({ submits: 4, mispresent: 2, accuseFails: 1, hours: 0 }), "C");
});
test("deepOption：放對應卡選該項，沒放選 none", function () {
  var r = atAccuse();
  assert.strictEqual(Core.deepOption(TCASE, r).key, "none");
  Core.placeCard(r, "deep", "tes_eu");
  assert.strictEqual(Core.deepOption(TCASE, r).key, "none");
});
test("finish：記評價、解鎖下一案、記圖鑑與獨語與人物", function () {
  var s = Core.newSave();
  var r = Core.startCase(s, "case0");
  Core.visit(r, "s_sick"); Core.move(r, "p2"); Core.visit(r, "s_pot"); Core.visit(r, "s_led");
  Core.move(r, "p1"); Core.visit(r, "s_talk");
  // 病人證言 tes_pt 也拿來放深層臆測
  Core.giveRemedy(r, "pt", ["shengjiang", "gancao"]);
  Core.identify(r, "ev_tu", "banxia");
  assert.deepStrictEqual(Core.finish(s, r), { error: "phase" });
  Core.toBoard(r);
  Core.placeCard(r, "who", "p_eu"); Core.placeCard(r, "what", "herb:banxia");
  Core.placeCard(r, "how", "tes_eu"); Core.placeCard(r, "why", "ev_led"); Core.placeCard(r, "deep", "tes_pt");
  Core.submit(r); Core.present(r, "re_look") ; Core.present(r, "herb:banxia"); Core.present(r, "ev_led");
  var res = Core.finish(s, r);
  assert.strictEqual(res.rating, "A");   // mispresent 1（re_look 沒拿到 → 不持有，算錯）
  assert.deepStrictEqual(res.monologues, ["case0:main", "case0:a"]);
  assert.strictEqual(s.cases.case0.best, "A"); assert.strictEqual(s.cases.case0.cleared, true);
  assert.strictEqual(s.cases.case0.run, null);
  assert.ok(s.unlocked.indexOf("case1") >= 0);
  assert.strictEqual(s.herbsSeen.banxia, true);
  assert.strictEqual(s.monologues["case0:a"], true);
  assert.strictEqual(s.castSeen.maomao, true);
});
```

（`present` 對「不持有的卡」：視為出示錯誤，算 mispresent。上面 finish 測試的 `re_look` 沒有拿到，所以 rating 是 A：10 − 0 − 1 − 0 + (hours≥3 ? 1 : 0)；8 時辰扣 1+1+1+2+1+1=7 剩 1，不加分 → 9 → A。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `node tools/yakushi_check/core_check.js`
Expected: FAIL（`Core.placeCard is not a function`）

- [ ] **Step 3: 實作**（貼在 Task 7 標記處，並把 7 個函式加進 `api`）

```js
  function placeCard(run, slot, cardId) {
    if (run.phase !== "board" && !(slot === "deep" && run.phase === "accuse")) return { error: "phase" };
    if (SLOTS.indexOf(slot) < 0 && slot !== "deep") return { error: "slot" };
    if (cardId !== null && !has(run, cardId)) return { error: "card" };
    run.board[slot] = cardId;
    return { ok: true };
  }
  function submit(run) {
    if (run.phase !== "board") return { error: "phase" };
    if (SLOTS.some(function (s) { return !run.board[s]; })) return { error: "empty" };
    var sol = getCase(run.caseId).solution, n = 0;
    SLOTS.forEach(function (s) { if (run.board[s] === sol[s]) n++; });
    run.submits += 1;
    if (n === 4) { run.phase = "accuse"; run.accuseStep = 0; run.trust = START_TRUST; }
    return { correct: n };
  }
  function currentRebuttal(run) {
    if (run.phase !== "accuse") return null;
    return getCase(run.caseId).rebuttals[run.accuseStep] || null;
  }
  function present(run, cardId) {
    var r = currentRebuttal(run);
    if (!r) return { error: "phase" };
    if (has(run, cardId) && r.accepts.indexOf(cardId) >= 0) {
      run.accuseStep += 1;
      if (run.accuseStep >= getCase(run.caseId).rebuttals.length) run.phase = "done";
      return { ok: true, hit: true, reply: r.reply, done: run.phase === "done", reset: false, trust: run.trust };
    }
    run.mispresent += 1; run.trust -= 1;
    if (run.trust <= 0) {
      run.accuseFails += 1; run.trust = START_TRUST; run.accuseStep = 0;
      return { ok: true, hit: false, reply: null, done: false, reset: true, trust: run.trust };
    }
    return { ok: true, hit: false, reply: null, done: false, reset: false, trust: run.trust };
  }
  function rating(run) {
    var pts = 10 - Math.max(0, run.submits - 1) - run.mispresent - 2 * run.accuseFails + (run.hours >= 3 ? 1 : 0);
    return pts >= 10 ? "S" : pts >= 8 ? "A" : pts >= 5 ? "B" : "C";
  }
  function deepOption(def, run) {
    if (!def.deep) return null;
    var id = run.board.deep;
    for (var i = 0; i < def.deep.options.length; i++) if (id && def.deep.options[i].card === id) return def.deep.options[i];
    return { key: "none", card: null, monologue: def.deep.none };
  }
  function finish(save, run) {
    if (run.phase !== "done") return { error: "phase" };
    var def = getCase(run.caseId), entry = save.cases[run.caseId] || (save.cases[run.caseId] = {});
    var r = rating(run), order = "SABC";
    if (!entry.best || order.indexOf(r) < order.indexOf(entry.best)) entry.best = r;
    entry.cleared = true;
    Object.keys(run.identified).forEach(function (e) {
      var c = def.cards[e];
      if (c && c.herb === run.identified[e]) save.herbsSeen[c.herb] = true;
    });
    var monos = [run.caseId + ":main"];
    var opt = deepOption(def, run);
    if (opt) monos.push(run.caseId + ":" + opt.key);
    monos.forEach(function (k) { save.monologues[k] = true; });
    (def.cast || []).forEach(function (c) { save.castSeen[c] = true; });
    var next = CASE_ORDER[CASE_ORDER.indexOf(run.caseId) + 1];
    if (next && save.unlocked.indexOf(next) < 0) save.unlocked.push(next);
    run.result = { rating: r, monologues: monos };
    entry.last = run.result;
    entry.run = null;
    return run.result;
  }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node tools/yakushi_check/core_check.js`
Expected: `20 passed`（若 finish 測試的時辰計算與註解不符，依實際扣除重新核對註解，不要改公式）

- [ ] **Step 5: Commit**

```bash
git add static_src/yakushi_core.js tools/yakushi_check/core_check.js
git commit -m "feat(yakushi): 規則核心：推理板、指認、評價、結案"
```

---

### Task 8: 人物資料、序章、案件可破關檢查

**Files:**
- Modify: `static_src/yakushi_cast.js`, `static_src/yakushi_case_0.js`
- Create: `tools/yakushi_check/cases_check.js`
- Modify: `docs/yakushi_game_design.md`（§6 序章時辰 6 → 8，見下方說明）

**Interfaces:**
- Consumes: `Herbs.*`、`Core.registerCase`、`Core.cardInfo`、`Herbs.tagsOf`
- Produces: `PriTestYakushiCast.get/list`；`case0` 的 def；`cases_check.js` 會檢查所有已登記的案件

**人物 id：** `maomao` 卯卯、`xuanshi` 玄氏、`handang` 韓當、`duheng` 杜衡、`gepo` 葛婆、`yuetang` 月棠、`xuejuan` 雪鵑、`feitong` 緋桐、`qin` 秦尚宮、`xiaoman` 小滿、`zhou` 周太醫、`liang` 梁昭儀。`desc` 依設計 §3；`notes` 是卯卯的獨語評語，`after: null` 一開始可看，`after: "case1"` 表示通關該案才顯示。

```js
// 少女藥師的獨語（yakushi）：人物。規則依據 docs/yakushi_game_design.md §3。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var LIST = [
    { id: "maomao", name: "卯卯", role: "藥師養女・下女", desc: "在柳巷旁的農村長大，被老藥師杜衡收養。表面冷淡寡言、怕麻煩，一碰到藥和毒就兩眼發亮。",
      notes: [{ after: null, text: "……只要能碰到宮裡的藥庫，當下女也不算太虧。" }] },
    { id: "xuanshi", name: "玄氏", role: "掖庭令", desc: "管理後宮宮人的官員。俊美到不像真人，笑容溫和，卻看不透他在想什麼。",
      notes: [{ after: null, text: "笑得越好看的人越麻煩。這是花街教我的。" },
              { after: "case3", text: "那天他封存證物的手，比平常快了一點。" }] }
    // ……其餘 10 人，每人 1～3 則 notes
  ];
  var byId = {};
  LIST.forEach(function (c) { byId[c.id] = c; });
  var api = { get: function (id) { return byId[id] || null; }, list: function () { return LIST.slice(); } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PriTestYakushiCast = api;
})();
```

**序章資料（完整）**：時辰定為 8（設計 §6 寫 6，但教學要走完 6 個調查點＋1 次試藥＋1 次移動，6 不夠；本 Task 同步把設計文件 §6 改成「序章 8」並在決定記錄加一行）。

```js
// 少女藥師的獨語（yakushi）：序章「芋頭與名冊」（教學）。規則依據 docs/yakushi_game_design.md §9.0。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var L = function (who, text) { return { who: who, text: text }; };
  var DEF = {
    id: "case0", title: "序章　芋頭與名冊", hours: 8, startPlace: "dorm",
    cast: ["maomao", "xiaoman", "qin", "xuanshi"], startCards: [],
    places: [
      { id: "dorm", name: "下女宿舍", spots: [
        { id: "d_sick", kind: "look", label: "看看病倒的同寢", gives: ["sym_numb"],
          text: "阿桃抱著喉嚨，說話含糊。嘴唇和舌頭都在發麻……吃了什麼刺激的東西？" },
        { id: "d_xiaoman", kind: "talk", label: "問小滿", gives: ["tes_xiaoman"],
          text: "「今晚只有芋頭燉菜是新的菜色啦。我嫌黏沒吃，結果就我沒事。」" },
        { id: "d_roommate", kind: "talk", label: "問阿桃", requires: ["tes_roommate"], gives: [],
          text: "阿桃已經能說話了，一直向妳道謝。" }
      ] },
      { id: "kitchen", name: "宮人廚房", spots: [
        { id: "k_pot", kind: "look", label: "查看剩下的燉菜", gives: ["ev_tuber"],
          text: "鍋底還剩幾塊「芋頭」。比平常的芋頭小、也圓了一點。" },
        { id: "k_ledger", kind: "look", label: "翻廚房帳本", gives: ["ev_ledger"],
          text: "這週的芋頭進價只有平常的一半，經手人是採買的小宦官。" },
        { id: "k_eunuch", kind: "talk", label: "問採買的小宦官", requires: ["ev_ledger"], gives: ["p_eunuch", "tes_eunuch"],
          text: "「芋、芋頭就是芋頭！我……我是在城外的野地挖的，省下來的錢……」" }
      ] }
    ],
    cards: {
      sym_numb: { kind: "symptom", name: "口舌發麻、喉嚨腫痛", text: "吃下燉菜後不久，多人口舌發麻、喉嚨腫痛。",
        tags: ["口舌發麻", "喉嚨腫痛", "onset:fast"], of: "ev_tuber" },
      tes_xiaoman: { kind: "testimony", name: "小滿的證言", text: "今晚新菜色只有芋頭燉菜，沒吃的小滿沒事。" },
      ev_tuber: { kind: "evidence", name: "剩下的「芋頭」", text: "比一般芋頭小而圓的塊莖。", tags: ["塊莖"], herb: "banxia" },
      ev_ledger: { kind: "evidence", name: "廚房帳本", text: "這週芋頭進價只有平常一半。" },
      p_eunuch: { kind: "person", name: "採買的小宦官", text: "負責宮人廚房採買的小宦官。" },
      tes_eunuch: { kind: "testimony", name: "小宦官的證言", text: "「芋頭」是他在城外野地挖來的，混在芋頭裡交差。" },
      re_tuber_look: { kind: "reaction", name: "細看：小而圓的塊莖", text: "直徑不到一寸，頂端有凹陷的莖痕，不是芋頭。",
        tags: ["小型塊莖", "頂端凹陷莖痕"], of: "ev_tuber" },
      tes_roommate: { kind: "testimony", name: "阿桃的證言", text: "「那芋頭咬下去刺刺的，像有針在扎舌頭。」",
        tags: ["刺舌感"], of: "ev_tuber" }
    },
    tests: [
      { evidence: "ev_tuber", method: "look", text: "直徑不到一寸，頂端有凹陷的莖痕。這不是芋頭。", gives: "re_tuber_look" }
    ],
    patients: [
      { id: "pt_roommate", name: "同寢的阿桃", remedy: ["shengjiang", "gancao"], gives: "tes_roommate",
        text: "口舌腫脹、說不出話。先讓她把嘴裡的東西漱乾淨，再調點能緩和的東西。" }
    ],
    medicineBox: ["shengjiang", "gancao", "lvdou", "bohe", "dazao"],
    solution: { who: "p_eunuch", what: "herb:banxia", how: "tes_eunuch", why: "ev_ledger" },
    rebuttals: [
      { who: "p_eunuch", claim: "芋頭就是芋頭！宮外的野芋頭也是芋頭！", accepts: ["herb:banxia", "re_tuber_look"],
        reply: "「生、生半夏……？我、我真的不知道……」" },
      { who: "p_eunuch", claim: "帳上的錢我一文都沒有拿！", accepts: ["ev_ledger"],
        reply: "「……只有一點點，真的只有一點點……」" }
    ],
    deep: null,
    story: {
      intro: [L(null, "入宮第三晚。宿舍裡此起彼落的咳嗽聲，吵醒了卯卯。"),
              L("qin", "「有人下毒！誰都不准離開宿舍！」"),
              L("maomao", "（……下毒？不，這個症狀，比較像是吃錯東西。）")],
      truth: [L("maomao", "小宦官把在野地挖到的生半夏當成芋頭，混進採買裡，私吞了差價。"),
              L("maomao", "生半夏不經炮製就入口，會讓口舌發麻、喉嚨腫痛。宮裡的廚子沒見過，才會照芋頭煮。"),
              L("maomao", "這不是下毒，只是貪小便宜。……但貪小便宜，有時候比下毒還可怕。")],
      outro: [L("qin", "「……妳叫什麼名字？」"), L("maomao", "「卯卯。」"),
              L("xuanshi", "「原來如此。是個有意思的下女呢。」"),
              L("maomao", "（那個人是誰？笑得這麼好看的人，一定很麻煩。）")]
    },
    monologue: [L("maomao", "宮裡的人不認得生半夏。這座宮殿的藥庫裡，大概還有很多被當成別的東西的藥吧。")]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = DEF;
  if (root.PriTestYakushiCore) root.PriTestYakushiCore.registerCase(DEF);
})();
```

（`banxia` 的 `traits` 必須包含 `塊莖`、`口舌發麻`、`喉嚨腫痛`、`小型塊莖`、`頂端凹陷莖痕`、`刺舌感`、`onset:fast`；`tiannanxing` 有 `塊莖`、`口舌發麻`、`喉嚨腫痛`，但沒有 `小型塊莖`，改為 `扁球形大塊莖`。如果 Task 3 寫的標籤不同，回去調整藥材資料，讓 cases_check 通過。）

- [ ] **Step 1: 寫失敗的案件檢查**（`tools/yakushi_check/cases_check.js`）

```js
// 少女藥師的獨語（yakushi）案件資料完整性與可破關檢查。規則依據 docs/yakushi_game_design.md §11。
// 執行：node tools/yakushi_check/cases_check.js
"use strict";
var path = require("path"), assert = require("assert"), fs = require("fs");
var SRC = path.join(__dirname, "..", "..", "static_src");
var Herbs = require(path.join(SRC, "yakushi_herbs.js"));
global.PriTestYakushiHerbs = Herbs;
["poison", "mineral", "animal", "tonic", "clear", "boudoir"].forEach(function (c) { require(path.join(SRC, "yakushi_herbs_" + c + ".js")); });
var Cast = require(path.join(SRC, "yakushi_cast.js"));
var Core = require(path.join(SRC, "yakushi_core.js"));
global.PriTestYakushiCore = Core;
var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

var defs = [];
[0, 1, 2, 3].forEach(function (n) {
  var d = require(path.join(SRC, "yakushi_case_" + n + ".js"));
  if (d && d.id) defs.push(d);
});
var REQUIRED = Number(process.env.YS_CASES || 1);   // Task 8：1；Task 9：4

test("已登記案件數 ≥ " + REQUIRED, function () { assert.ok(defs.length >= REQUIRED, "只有 " + defs.length + " 案"); });

test("人物：12 人，案件 cast 都存在", function () {
  assert.strictEqual(Cast.list().length, 12);
  defs.forEach(function (d) { d.cast.forEach(function (c) { assert.ok(Cast.get(c), d.id + " cast " + c); }); });
});

defs.forEach(function (d) {
  // 可取得的卡：查看點（依 requires 迭代）、正確鑑定、試藥、調藥
  function obtainable() {
    var got = {}; (d.startCards || []).forEach(function (c) { got[c] = true; });
    var changed = true;
    while (changed) {
      changed = false;
      d.places.forEach(function (p) { p.spots.forEach(function (s) {
        if ((s.requires || []).every(function (c) { return got[c]; })) s.gives.forEach(function (c) { if (!got[c]) { got[c] = true; changed = true; } });
      }); });
      Object.keys(d.cards).forEach(function (id) {
        var c = d.cards[id];
        if (c.herb && got[id] && !got["herb:" + c.herb]) { got["herb:" + c.herb] = true; changed = true; }
      });
      (d.tests || []).forEach(function (t) { if (t.gives && got[t.evidence] && !got[t.gives]) { got[t.gives] = true; changed = true; } });
      (d.patients || []).forEach(function (p) { if (!got[p.gives]) { got[p.gives] = true; changed = true; } });
    }
    return got;
  }
  var got = obtainable();

  test(d.id + "：所有引用的卡、藥材、場所都存在", function () {
    function card(id) { assert.ok(Core.cardInfo(d, id), d.id + " 卡不存在 " + id); }
    d.places.forEach(function (p) { p.spots.forEach(function (s) { s.gives.forEach(card); (s.requires || []).forEach(card); }); });
    assert.ok(d.places.some(function (p) { return p.id === d.startPlace; }), "startPlace");
    Object.keys(d.cards).forEach(function (id) {
      var c = d.cards[id];
      if (c.herb) assert.ok(Herbs.get(c.herb), id + " herb " + c.herb);
      if (c.of) assert.ok(d.cards[c.of], id + " of " + c.of);
    });
    (d.tests || []).forEach(function (t) { card(t.evidence); if (t.gives) card(t.gives); assert.ok(Herbs.METHODS.indexOf(t.method) >= 0); });
    d.medicineBox.forEach(function (h) { assert.ok(Herbs.get(h), "藥箱 " + h); });
    (d.patients || []).forEach(function (p) {
      card(p.gives);
      p.remedy.forEach(function (h) { assert.ok(d.medicineBox.indexOf(h) >= 0, p.id + " 解方不在藥箱 " + h); });
      assert.ok(p.remedy.length >= 1 && p.remedy.length <= 3);
    });
    Core.SLOTS.forEach(function (s) { card(d.solution[s]); });
    d.rebuttals.forEach(function (r) { r.accepts.forEach(card); });
    if (d.deep) d.deep.options.forEach(function (o) { card(o.card); assert.ok(o.key && o.key !== "main" && o.key !== "none"); });
  });

  test(d.id + "：正解、每輪辯解、深層選項都拿得到（可破關）", function () {
    Core.SLOTS.forEach(function (s) { assert.ok(got[d.solution[s]], d.id + " 正解 " + s + " 拿不到 " + d.solution[s]); });
    d.rebuttals.forEach(function (r, i) {
      assert.ok(r.accepts.some(function (c) { return got[c]; }), d.id + " 第 " + (i + 1) + " 輪辯解沒有可出示的卡");
    });
    if (d.deep) d.deep.options.forEach(function (o) { assert.ok(got[o.card], d.id + " 深層 " + o.key + " 拿不到"); });
    assert.ok(d.rebuttals.length >= 2 && d.rebuttals.length <= 3, "辯解 2～3 輪");
  });

  test(d.id + "：鑑定用的證物，真藥材一定在候選裡且候選停在群組", function () {
    Object.keys(d.cards).forEach(function (id) {
      var c = d.cards[id];
      if (!c.herb) return;
      var tags = (c.tags || []).slice();
      Object.keys(d.cards).forEach(function (k) { if (d.cards[k].of === id) tags = tags.concat(d.cards[k].tags || []); });
      var cand = Herbs.filter(tags).map(function (h) { return h.id; });
      assert.ok(cand.indexOf(c.herb) >= 0, id + "：全部線索標籤下真藥材 " + c.herb + " 不在候選（缺標籤）");
      var only = Herbs.filter(c.tags || []).map(function (h) { return h.id; });
      assert.ok(only.length >= 2, id + "：只靠證物本身就鎖定了，沒有易混的樂趣");
    });
  });

  test(d.id + "：必要行動不超過時辰", function () {
    // 必要行動＝提供正解／辯解第一張可用卡的查看點成本 + 起點以外要去的場所數 + 必要的試藥數
    var needCards = {};
    Core.SLOTS.forEach(function (s) { needCards[d.solution[s]] = true; });
    d.rebuttals.forEach(function (r) { var c = r.accepts.filter(function (x) { return got[x]; })[0]; needCards[c] = true; });
    var spots = {}, places = {};
    function need(cid) {
      if (cid.indexOf("herb:") === 0) {
        var ev = Object.keys(d.cards).filter(function (k) { return "herb:" + d.cards[k].herb === cid; })[0];
        return need(ev);
      }
      d.places.forEach(function (p) { p.spots.forEach(function (s) {
        if (s.gives.indexOf(cid) >= 0 && !spots[s.id]) {
          spots[s.id] = s.cost == null ? 1 : s.cost; places[p.id] = true;
          (s.requires || []).forEach(need);
        }
      }); });
    }
    Object.keys(needCards).forEach(need);
    var tests = (d.tests || []).filter(function (t) { return needCards[t.gives]; }).length;
    var cost = Object.keys(spots).reduce(function (a, k) { return a + spots[k]; }, 0) + Object.keys(places).filter(function (p) { return p !== d.startPlace; }).length + tests;
    assert.ok(cost <= d.hours, d.id + "：必要行動 " + cost + " 超過時辰 " + d.hours);
  });
});

console.log("\n" + passed + " passed");
```

- [ ] **Step 2: 跑檢查確認失敗**

Run: `node tools/yakushi_check/cases_check.js`
Expected: FAIL（`yakushi_case_0.js` 還是空的 → 已登記案件數 0）

- [ ] **Step 3: 寫人物資料與序章**（上面的程式碼；`yakushi_case_1～3.js` 這時仍是匯出 `null` 的空殼：`module.exports = null`，瀏覽器端不登記）

- [ ] **Step 4: 跑檢查確認通過**

Run: `node tools/yakushi_check/cases_check.js; node tools/yakushi_check/herbs_check.js; node tools/yakushi_check/core_check.js`
Expected: 全部 ok

- [ ] **Step 5: 改設計文件 §6 與決定記錄**（「序章 6」→「序章 8」；決定記錄加「序章時辰 8：6 不夠走完教學（2026-11-24 計畫）」）

- [ ] **Step 6: Commit**

```bash
git add static_src/yakushi_cast.js static_src/yakushi_case_0.js static_src/yakushi_case_1.js static_src/yakushi_case_2.js static_src/yakushi_case_3.js tools/yakushi_check/cases_check.js docs/yakushi_game_design.md
git commit -m "feat(yakushi): 人物資料、序章與案件可破關檢查"
```

---

### Task 9: 案 1～3 資料

**Files:**
- Modify: `static_src/yakushi_case_1.js`, `static_src/yakushi_case_2.js`, `static_src/yakushi_case_3.js`
- Possibly modify: 藥材資料檔（補案件需要的標籤）

**Interfaces:**
- Consumes: 序章的格式（Task 8）、設計 §9.1～§9.3
- Produces: `case1`、`case2`、`case3` 的 def

**撰寫規則：**
- 每案時辰 12；3～4 個場所、共 9～12 個查看點與問話；至少 2 個需要鑑定的證物（每個都屬於易混群組）、至少 3 個 `tests` 條目、至少 1 位病人；辯解輪數、正解依下表。
- 每個查看點的 `text` 1～3 句；`story.intro` 6～12 行、`truth` 6～12 行（完整敘述推理過程：誰、何時、用什麼、為什麼、每條線索如何對上）、`outro` 4～8 行；`monologue` 1～3 行。
- 有 deep 的案件：`deep.options` 3 個、`none` 1～2 行；各選項的 `monologue` 2～4 行，**不證實也不否定**。
- 至少放一個「誤導用」的卡（例如會被誤放進推理板的嫌疑人）。

| 案 | 正解（cardId） | 鑑定證物 → herb | 辯解 accepts | deep |
|---|---|---|---|---|
| case1 沉香夜話（梁昭儀宮、香料庫、太醫署、宮女住處） | who `p_maid`（同鄉女官）／what `herb:mantuoluo`／how `ev_fake_incense`（以家鄉好香名義每晚點燃）／why `tes_lover`（心上人被調離京城） | `ev_incense`→`tanxiang`（假沉香，入水會浮）、`ev_ash`→`mantuoluo`（香灰裡的花粉與種子） | ①「那是上好沉香」→`herb:tanxiang`、`re_float` ②「花粉是昭儀自己的花」→`herb:mantuoluo`、`re_seed` ③「我與娘娘情同姊妹」→`tes_lover` | 有：label「是誰教她混花粉的？」，options `consort`（包裝紙來自高位妃嬪宮中的香料鋪＝`ev_wrapper`）、`self`（女官自己的醫書筆記＝`ev_notes`）、`shop`（香料鋪掌櫃＝`tes_shopkeeper`） |
| case2 錦鯉樓的苦杏（宴廳、廚房、雪鵑的房間、杜衡的藥鋪） | who `p_clerk`（帳房）／what `herb:kuxingren`／how `tes_maid`（以家鄉酒名義送進宴席）／why `ev_debt`（挪用公款的字據） | `ev_tea`→`tianxingren`（茶是清白的）、`ev_wine`→`kuxingren` | ①「茶裡就有杏仁」→`herb:tianxingren` ②「酒我沒碰過」→`tes_maid` ③「我與老爺情同父子」→`ev_debt` | 無 |
| case3 端午的黃酒（北市、貧民區、酒坊、藥鋪） | who `p_brewer`（酒坊老闆）／what `herb:xionghuang`／how `re_heat`（溫熱後產生有毒物質）／why `ev_seal_cost`（假冒御用、壓低成本的帳） | `ev_wine_dregs`→`xionghuang`（red_mineral）、`ev_powder`→`mingfan`（酒坊的白色粉末，銀針不變黑，證明不是砒霜，示範銀針不是萬能） | ①「是疫病，不是我的酒」→`tes_patients`、`herb:xionghuang` ②「雄黃酒端午人人喝」→`re_heat` ③「我是御用酒坊」→`ev_seal_cost` | 有：label「真的御用封印從哪裡來？」，options `leak`（宮中有人流出＝`ev_seal`）、`protect_someone`（玄氏包庇某人＝`tes_handang`）、`protect_maomao`（玄氏在保護卯卯＝`tes_xuanshi`） |

- 案 2 的病人：試喝剩酒的小丫頭（remedy 由藥箱中選 2 味，遊戲設定）；案 3 的病人：輕症病人，remedy `["lvdou","gancao"]`；案 1 的病人：梁昭儀，remedy 從藥箱選 2～3 味（遊戲設定，劇情上是「先撤香、通風、再調安神的藥」）。
- 案 3 的 `outro` 最後一行固定為卯卯的獨語：「……這件事，大概還沒結束。」
- 案 2 的 `outro` 要有月棠、雪鵑、緋桐、葛婆的日常戲，以及杜衡欲言又止的一幕（不揭曉過去）。

- [ ] **Step 1: 跑檢查（要求 4 案）確認失敗**

Run: `YS_CASES=4 node tools/yakushi_check/cases_check.js`
Expected: FAIL（只有 1 案）

- [ ] **Step 2: 寫 case1**（照序章格式；寫完先跑一次檢查）

Run: `node tools/yakushi_check/cases_check.js`
Expected: case1 的 4 個檢查都 ok（若「真藥材不在候選」失敗，補藥材的 traits 標籤，不要刪證物標籤）

- [ ] **Step 3: 寫 case2**，跑同一個檢查

- [ ] **Step 4: 寫 case3**，跑同一個檢查

- [ ] **Step 5: 全部檢查通過**

Run: `YS_CASES=4 node tools/yakushi_check/cases_check.js; node tools/yakushi_check/herbs_check.js; node tools/yakushi_check/core_check.js`
Expected: 全部 ok

- [ ] **Step 6: Commit**

```bash
git add static_src/yakushi_case_1.js static_src/yakushi_case_2.js static_src/yakushi_case_3.js static_src/yakushi_herbs_*.js
git commit -m "feat(yakushi): 案 1～3：沉香夜話、錦鯉樓的苦杏、端午的黃酒"
```

---

### Task 10: 畫面（標題、劇情、調查、存檔）

**Files:**
- Modify: `static_src/yakushi.js`, `static_src/css/yakushi.css`, `site_src/i18n_yakushi.py`
- Test: `tools/yakushi_check/ui_check.js`（本 Task 寫前半段）

**Interfaces:**
- Consumes: `Core.*`、`Cast.get`、`Herbs.*`
- Produces: `window.PriTestYakushi._debugState()`、`_debugRun()`；以下 DOM（之後的 Task 與 Playwright 依賴）：

| 畫面 | 元素 |
|---|---|
| 標題 | 案件按鈕 `[data-ys-case="case0"]`（鎖住的有 `disabled`，旁邊顯示最佳評價）；`#ys-open-book`、`#ys-open-journal`、`#ys-open-cast`；`#ys-reset`（confirm 後清存檔） |
| 劇情 | `#ys-story`（目前一行，說話者名＋文字）、`#ys-story-next`、`#ys-story-skip` |
| 調查 | `#ys-hours`（剩餘時辰）、`#ys-stamina`、場所分頁 `[data-ys-place="<id>"]`、查看點 `[data-ys-spot="<id>"]`（已查過加 class `ys-done`；requires 未滿足 `disabled`）、`#ys-spot-text`、卡片清單 `#ys-cards` 內 `[data-ys-card="<id>"]`、`#ys-open-lab`、`#ys-to-board`、`#ys-back-title` |

**行為：**
- `load()`：`try { Core.normalizeSave(JSON.parse(localStorage.getItem(KEY))) } catch → Core.newSave()`；`save()`：`try { localStorage.setItem(KEY, JSON.stringify(state)) } catch {}`；每個操作後都 `save()` 再 `render()`。
- 案件按鈕：有進行中的 `run` 就繼續（直接進調查／推理板／指認，依 `run.phase`）；沒有就 `Core.startCase` → 播 `story.intro` → 調查。
- 劇情播放器：`playLines(lines, done)`，一次顯示一行；說話者用 `Cast.get(who).name`，`who: null` 是旁白；`#ys-story-skip` 直接跳到 `done`。
- 調查畫面在 `run.phase === "board"` 時自動切去推理板（Task 12），時辰用完時先顯示 `ys_hours_out` 再切。
- 全部用 `innerHTML` 重繪，事件用委派（`#ys-app` 上一個 click handler，依 `data-ys-*` 分派）。文字插入前一律 `esc()`。

```js
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
```

新增字串（`_ROWS` 追加）：`ys_case_locked`「尚未解鎖」、`ys_best`「最佳 {r}」、`ys_continue`「繼續」、`ys_new`「開始」、`ys_hours`「剩餘時辰 {n}」、`ys_stamina`「體力 {n}」、`ys_hours_out`「時辰到了，卯卯被叫了回去。」、`ys_next`「下一句」、`ys_skip`「略過」、`ys_to_board`「整理推理」、`ys_lab`「鑑定・試藥・調藥」、`ys_cards`「線索」、`ys_back_title`「回標題」、`ys_book`「藥材圖鑑」、`ys_journal`「獨語帖」、`ys_cast`「人物」、`ys_reset`「清除存檔」、`ys_reset_confirm`「確定清除所有進度？」、`ys_narrator`「旁白」、`ys_kind_evidence`「證物」、`ys_kind_testimony`「證言」、`ys_kind_symptom`「症狀」、`ys_kind_reaction`「反應」、`ys_kind_person`「人物」、`ys_kind_herb`「藥材」。

CSS：宣紙底、墨色字、朱紅強調；卡片用細框＋左側色條（依 kind 分色）；按鈕最小 44px 高；375px 寬不橫向捲動。

- [ ] **Step 1: 寫 Playwright 前半段**（`tools/yakushi_check/ui_check.js`）

```js
// 少女藥師的獨語（yakushi）Playwright 流程檢查。
// 前置：py -3 generate.py ； py -3 -m http.server 8974 --directory dist
// 執行：node tools/yakushi_check/ui_check.js
// 注意（CLAUDE.md §4.6）：畫面整個重繪，一律用 dispatchEvent。
"use strict";
var path = require("path"), assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;
var BASE = (process.env.YAKUSHI_ROOT || "http://localhost:8974/") + "yakushi/index.html";

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 375, height: 800 } }), errors = [];
  await page.addInitScript(function () { try { localStorage.setItem("pritest-pay-unlocked", "1"); } catch (e) {} });
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  async function tap(sel) { await page.dispatchEvent(sel, "click"); }
  async function run() { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestYakushi._debugRun())); }); }
  async function st() { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestYakushi._debugState())); }); }

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-yakushi-save"); });
  await page.reload();
  assert.strictEqual(await page.locator('[data-ys-case="case1"]').isDisabled(), true);

  // 序章：劇情 → 調查
  await tap('[data-ys-case="case0"]');
  await tap("#ys-story-skip");
  var r = await run();
  assert.strictEqual(r.phase, "investigate"); assert.strictEqual(r.hours, 8);
  await tap('[data-ys-spot="d_sick"]');
  r = await run();
  assert.ok(r.cards.indexOf("sym_numb") >= 0); assert.strictEqual(r.hours, 7);
  assert.ok((await page.textContent("#ys-hours")).indexOf("7") >= 0);
  await tap('[data-ys-place="kitchen"]');
  await tap('[data-ys-spot="k_pot"]');
  await tap('[data-ys-spot="k_ledger"]');
  await tap('[data-ys-spot="k_eunuch"]');
  r = await run();
  assert.strictEqual(r.hours, 3);

  // 重新整理後繼續
  await page.reload();
  await tap('[data-ys-case="case0"]');
  r = await run();
  assert.strictEqual(r.hours, 3); assert.strictEqual(r.place, "kitchen");

  // ===== Task 11、12 接在這裡 =====

  var noScroll = await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth; });
  assert.ok(noScroll, "手機寬度出現橫向捲動");
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("ui_check ok");
})().catch(function (e) { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 跑確認失敗**

Run: `py -3 generate.py; (py -3 -m http.server 8974 --directory dist &) ; node tools/yakushi_check/ui_check.js`
Expected: FAIL（找不到 `[data-ys-case="case1"]`）

- [ ] **Step 3: 實作 `yakushi.js` 的標題、劇情、調查與存檔，以及 CSS、字串**

- [ ] **Step 4: 跑確認通過**

Run: `node --check static_src/yakushi.js; py -3 generate.py; node tools/yakushi_check/ui_check.js`
Expected: `ui_check ok`

- [ ] **Step 5: Commit**

```bash
git add static_src/yakushi.js static_src/css/yakushi.css site_src/i18n_yakushi.py tools/yakushi_check/ui_check.js
git commit -m "feat(yakushi): 畫面：標題、劇情、調查與存檔"
```

---

### Task 11: 畫面（藥材圖鑑、鑑定、試藥、調藥）

**Files:**
- Modify: `static_src/yakushi.js`, `static_src/css/yakushi.css`, `site_src/i18n_yakushi.py`
- Test: `tools/yakushi_check/ui_check.js`（接在 Task 10 標記處）

**DOM：**

| 畫面 | 元素 |
|---|---|
| 工作台（`#ys-open-lab` 開啟） | 分頁 `[data-ys-lab="identify"]`、`[data-ys-lab="test"]`、`[data-ys-lab="remedy"]`；`#ys-lab-close` |
| 鑑定 | 證物選擇 `[data-ys-evidence="<id>"]`（只列持有且有 herb 的證物）；特徵勾選 `[data-ys-tag="<tag>"]`（列出 `Core.evidenceTags` 的標籤，預設全勾）；候選 `[data-ys-herb="<id>"]`（`Core.candidates(勾選的標籤)`；候選都在同一群組且 ≥2 時顯示 `ys_lookalike`）；`#ys-identify-confirm`；已鑑定的證物顯示「已鑑定：<名稱>」，可以重鑑定 |
| 試藥 | 同一個證物選擇；驗法按鈕 `[data-ys-test="<method>"]`（做過的加 `ys-done`）；`#ys-test-result`（`text` 為 null 顯示 `ys_no_reaction`；`collapsed` 時顯示 `ys_collapse`） |
| 調藥 | 病人 `[data-ys-patient="<id>"]`（顯示 level、cured／lost）；藥箱 `[data-ys-med="<herbId>"]`（切換選取，最多 3）；`#ys-remedy-give`；`#ys-remedy-result`；底部固定 `ys_disclaimer` |
| 圖鑑（標題與工作台都能開） | 類別分頁 `[data-ys-cat="<cat>"]`、搜尋 `#ys-book-search`、清單 `[data-ys-book-herb="<id>"]`（`herbsSeen` 沒有的顯示剪影「？？？」與群組名）、詳細 `#ys-book-detail`（名稱、別名、lore、distinguish、各驗法結果）、`ys_disclaimer`、`#ys-book-close` |

- 特徵勾選狀態存在 UI 狀態裡（以證物 id 為鍵），重繪與鑑定後都保留，換證物時才重設為全勾。

新增字串：`ys_lab_identify`「鑑定」、`ys_lab_test`「試藥」、`ys_lab_remedy`「調藥」、`ys_pick_evidence`「選擇證物」、`ys_tags`「觀察到的特徵」、`ys_candidates`「候選藥材（{n}）」、`ys_lookalike`「這幾種很像，需要再驗證。」、`ys_identify`「就是它」、`ys_identified`「已鑑定：{name}」、`ys_m_look`「細看」、`ys_m_smell`「嗅」、`ys_m_taste`「嚐」、`ys_m_silver`「銀針」、`ys_m_water`「溶水」、`ys_m_heat`「加熱」、`ys_m_animal`「餵動物」、`ys_no_reaction`「沒有明顯的反應。」、`ys_collapse`「……嚐太多了。卯卯暈了過去，醒來時已經過了兩個時辰。」、`ys_remedy_give`「調好了，給病人」、`ys_cured`「病人好轉了。」、`ys_worse`「病況惡化了……」、`ys_lost`「病人被太醫接手了。」、`ys_close`「關閉」、`ys_unknown`「？？？」、`ys_search`「搜尋藥名」、`ys_cat_poison`「毒草」、`ys_cat_mineral`「礦石・金屬」、`ys_cat_animal`「動物藥・動物毒」、`ys_cat_tonic`「補益」、`ys_cat_clear`「清熱・解毒・解表」、`ys_cat_boudoir`「香料・妝品・食材」。

- [ ] **Step 1: 追加 Playwright**（貼在 `// ===== Task 11、12 接在這裡 =====` 之後）

```js
  // 工作台：試藥（細看）→ 反應卡；鑑定錯一次再改對；調藥錯一次再調對
  await tap("#ys-open-lab");
  await tap('[data-ys-lab="test"]');
  await tap('[data-ys-evidence="ev_tuber"]');
  await tap('[data-ys-test="look"]');
  r = await run();
  assert.ok(r.cards.indexOf("re_tuber_look") >= 0); assert.strictEqual(r.hours, 2);
  assert.ok((await page.textContent("#ys-test-result")).length > 0);

  await tap('[data-ys-lab="identify"]');
  await tap('[data-ys-evidence="ev_tuber"]');
  assert.strictEqual(await page.locator('[data-ys-herb="tiannanxing"]').count(), 0, "細看後天南星應被篩掉");
  await tap('[data-ys-tag="小型塊莖"]');              // 取消勾選這兩個 → 天南星回到候選
  await tap('[data-ys-tag="頂端凹陷莖痕"]');
  await tap('[data-ys-herb="tiannanxing"]');
  await tap("#ys-identify-confirm");
  r = await run();
  assert.strictEqual(r.identified.ev_tuber, "tiannanxing"); assert.strictEqual(r.hours, 1);
  await tap('[data-ys-tag="小型塊莖"]');              // 勾回來（勾選狀態在換證物前會保留）
  await tap('[data-ys-tag="頂端凹陷莖痕"]');
  await tap('[data-ys-herb="banxia"]');
  await tap("#ys-identify-confirm");
  r = await run();
  assert.strictEqual(r.identified.ev_tuber, "banxia"); assert.strictEqual(r.hours, 1);

  await tap('[data-ys-lab="remedy"]');
  await tap('[data-ys-patient="pt_roommate"]');
  await tap('[data-ys-med="shengjiang"]'); await tap('[data-ys-med="gancao"]');
  await tap("#ys-remedy-give");
  r = await run();
  assert.strictEqual(r.patients.pt_roommate.cured, true);
  assert.ok(r.cards.indexOf("tes_roommate") >= 0);
  await tap("#ys-lab-close");

  // 圖鑑：未見過顯示剪影
  await tap("#ys-back-title");
  await tap("#ys-open-book");
  await tap('[data-ys-cat="poison"]');
  assert.ok((await page.textContent('[data-ys-book-herb="gouwen"]')).indexOf("？？？") >= 0);
  await tap("#ys-book-close");
  await tap('[data-ys-case="case0"]');
```

- [ ] **Step 2: 跑確認失敗**

Run: `py -3 generate.py; node tools/yakushi_check/ui_check.js`
Expected: FAIL（找不到 `#ys-open-lab` 對應的工作台）

- [ ] **Step 3: 實作工作台與圖鑑**

- [ ] **Step 4: 跑確認通過**

Run: `node --check static_src/yakushi.js; py -3 generate.py; node tools/yakushi_check/ui_check.js`
Expected: `ui_check ok`

- [ ] **Step 5: Commit**

```bash
git add static_src/yakushi.js static_src/css/yakushi.css site_src/i18n_yakushi.py tools/yakushi_check/ui_check.js
git commit -m "feat(yakushi): 畫面：藥材圖鑑、鑑定、試藥、調藥"
```

---

### Task 12: 畫面（推理板、指認、結案、獨語帖、人物圖鑑）

**Files:**
- Modify: `static_src/yakushi.js`, `static_src/css/yakushi.css`, `site_src/i18n_yakushi.py`
- Test: `tools/yakushi_check/ui_check.js`（追加）

**DOM：**

| 畫面 | 元素 |
|---|---|
| 推理板 | 格子 `[data-ys-slot="who|what|how|why|deep"]`（`deep` 只在 `def.deep` 時出現，標示 `def.deep.label` 與 `ys_deep_hint`）；手上卡片 `[data-ys-board-card="<id>"]`；操作：先點卡片（加 `ys-selected`），再點格子放入；點已放的格子清空；`#ys-submit`；`#ys-board-feedback`（`ys_board_result`）；`#ys-board-back`（`phase` 仍是 investigate 時才有：回調查。注意 `Core.toBoard` 是單向的，所以調查畫面的 `#ys-to-board` 要先 confirm `ys_to_board_confirm`） |
| 指認 | `#ys-accuse-claim`（`Cast.get(r.who).name` 或 card name＋claim）、`#ys-trust`、卡片 `[data-ys-present="<id>"]`、`#ys-accuse-reply`（hit 時顯示 reply；miss 顯示 `ys_present_miss`；reset 顯示 `ys_accuse_reset`）；指認階段也可以改 `deep` 格 |
| 結案 | `#ys-story-skip` 會跳過整段結案劇情直接到評價。依序播 `story.truth` → 深層獨語（`Core.deepOption(def, run).monologue`）→ `story.outro` → `def.monologue`，然後 `Core.finish` 並顯示 `#ys-rating`、`#ys-ending-back` |
| 獨語帖 | `#ys-journal` 列出 `save.monologues` 的每個 key（`"<caseId>:main"` → `def.monologue`；其他 → 對應 option 或 none）、`#ys-journal-close` |
| 人物 | `#ys-cast` 列出 `castSeen` 的人（沒見過的顯示剪影）；`notes` 依 `after`（null 或該案已 cleared）顯示；`#ys-cast-close` |

新增字串：`ys_slot_who`「誰」、`ys_slot_what`「用了什麼」、`ys_slot_how`「怎麼下手」、`ys_slot_why`「為什麼」、`ys_deep_hint`「（可不填。沒有正解。）」、`ys_submit`「提交臆測」、`ys_board_result`「4 格中有 {n} 格正確。」、`ys_to_board_confirm`「整理推理後就不能再調查了，確定嗎？」、`ys_accuse`「指認」、`ys_trust`「信任 {n}」、`ys_present`「出示」、`ys_present_miss`「……這和他說的不相干。」、`ys_accuse_reset`「信任盡失，重新整理思緒。」、`ys_rating`「評價 {r}」、`ys_ending_back`「回標題」、`ys_journal_empty`「還沒有獨語。」、`ys_board_back`「回去調查」。

- [ ] **Step 1: 追加 Playwright**（接在 Task 11 的段落之後）

```js
  // 推理板：故意錯一次（2 格對）→ 改對 → 指認（錯一次）→ 結案
  await tap("#ys-to-board");      // 有 confirm
  // 註：在檔頭 page.on("dialog") 自動 accept
  r = await run();
  assert.strictEqual(r.phase, "board");
  async function put(card, slot) { await tap('[data-ys-board-card="' + card + '"]'); await tap('[data-ys-slot="' + slot + '"]'); }
  await put("p_eunuch", "who"); await put("herb:banxia", "what"); await put("ev_ledger", "how"); await put("tes_eunuch", "why");
  await tap("#ys-submit");
  assert.ok((await page.textContent("#ys-board-feedback")).indexOf("2") >= 0);
  await put("tes_eunuch", "how"); await put("ev_ledger", "why");
  await tap("#ys-submit");
  r = await run();
  assert.strictEqual(r.phase, "accuse");
  await tap('[data-ys-present="sym_numb"]');
  r = await run(); assert.strictEqual(r.trust, 2);
  await tap('[data-ys-present="re_tuber_look"]');
  await tap('[data-ys-present="ev_ledger"]');
  await tap("#ys-story-skip");
  var s = await st();
  assert.strictEqual(s.cases.case0.cleared, true);
  assert.ok(s.unlocked.indexOf("case1") >= 0);
  assert.ok(s.monologues["case0:main"]);
  assert.ok((await page.textContent("#ys-rating")).length > 0);
  await tap("#ys-ending-back");
  assert.strictEqual(await page.locator('[data-ys-case="case1"]').isDisabled(), false);

  await tap("#ys-open-journal");
  assert.ok((await page.textContent("#ys-journal")).length > 10);
  await tap("#ys-journal-close");
  await tap("#ys-open-cast");
  assert.ok((await page.textContent("#ys-cast")).indexOf("卯卯") >= 0);
  await tap("#ys-cast-close");

  // 案 1：有深層格
  await tap('[data-ys-case="case1"]');
  await tap("#ys-story-skip");
  await tap("#ys-to-board");
  assert.strictEqual(await page.locator('[data-ys-slot="deep"]').count(), 1);
```

並在檔頭 `page.on("console", …)` 之後加：

```js
  page.on("dialog", function (d) { d.accept(); });
```

（案 1 沒調查就進推理板，只檢查深層格存在；時辰用完／無卡時的推理板仍可操作。）

- [ ] **Step 2: 跑確認失敗**

Run: `py -3 generate.py; node tools/yakushi_check/ui_check.js`
Expected: FAIL（找不到 `[data-ys-board-card=...]`）

- [ ] **Step 3: 實作推理板、指認、結案、獨語帖、人物圖鑑**

- [ ] **Step 4: 跑確認通過**

Run: `node --check static_src/yakushi.js; py -3 generate.py; node tools/yakushi_check/ui_check.js`
Expected: `ui_check ok`

- [ ] **Step 5: Commit**

```bash
git add static_src/yakushi.js static_src/css/yakushi.css site_src/i18n_yakushi.py tools/yakushi_check/ui_check.js
git commit -m "feat(yakushi): 畫面：推理板、指認、結案、獨語帖、人物圖鑑"
```

---

### Task 13: 收尾（全部檢查、版本、文件、推送）

**Files:**
- Modify: `site_src/version.py`、`docs/yakushi_game_design.md`（檔頭狀態）

- [ ] **Step 1: 全部檢查**

Run:
```bash
for f in static_src/yakushi*.js; do node --check $f || exit 1; done
node tools/yakushi_check/herbs_check.js
node tools/yakushi_check/core_check.js
YS_CASES=4 node tools/yakushi_check/cases_check.js
py -3 tools/split_css.py --check
py -3 generate.py
node tools/yakushi_check/ui_check.js
```
Expected: 全部通過

- [ ] **Step 2: 手動試玩**：桌機與 375px 寬各走一次案 1～3 的正解，確認劇情文字、獨語帖的深層獨語（放不同卡會不同）、人物 notes 的解鎖。

- [ ] **Step 3: 版本與文件**：`VERSION` 遞增 minor；設計文件檔頭改成「**第 1 階段已完成（v<版本>，<日期>）**」。

- [ ] **Step 4: 呼叫 `qa` subagent 驗證**（使用者全域規則：完成前必須跑 qa，傳入變更檔案與意圖；有指摘就修正後再跑）

- [ ] **Step 5: Commit 與推送**

```bash
git add site_src/version.py docs/yakushi_game_design.md
git commit -m "feat(yakushi): v<版本> 少女藥師的獨語 第 1 階段"
git push private main
```
