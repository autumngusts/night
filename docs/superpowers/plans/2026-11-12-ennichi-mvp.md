# 緣日樂園 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出「緣日樂園」（7 四季神社祭典＋6 遊樂園工房）的 MVP：春季 28 天；8 種遊樂設施＋5 種攤位＋排隊屋台＋設施；**三層生產鏈**（14 原料、17 機器、40 配方）與大型設施的**組裝期**；**模組改裝**；**繪馬許願**；**天氣**；**排隊屋台與整理券**；客人 AI（需求、尋路、排隊、搭乘、消費）、murmur、日循環與口碑；3D 樂園（看板人物群眾＋VRM 巫女小夜）。

**Architecture:** 規則全部是純函式，狀態是一個可 JSON 化的物件 `s`；所有玩家操作經由 `Core.applyIntent(s, it)`，時間推進經由 `Core.tick(s, 分鐘數)`（內部每遊戲分鐘呼叫 `Sim.step` 與 `Core.workshopStep`）。模擬是固定步長（1 遊戲分鐘）、種子亂數，Node 可以直接重播檢查。畫面分兩層：`ennichi.js`（HUD、面板、2D 小地圖放置）與 `ennichi_3d.js`（three.js 樂園），3D 只讀 `s`、不改規則。

**Tech Stack:** Vanilla ES5 IIFE（`window.PriTestEnnichi*`）、three.js r149（`static/vendor/three.min.js`）＋`static/vendor/ennichi_vrm.js`（GLTFLoader／OrbitControls／Bloom／three-vrm 3.5.5，樣本階段已建好）、Python `generate.py` 建置、Node 檢查腳本、Playwright。

**Spec:** `docs/ennichi_rules.md`（§4.4〜§4.6 建造層級、組裝期、改裝；§5.5 天氣；§5.6 排隊屋台與整理券；§6.4 繪馬許願；§7.3 生產鏈；§10 開發階段）

**範圍：** 規格 §10 的 MVP。品質等級（A／B／C）、四季、祭典日、宣傳、員工指派、搬運物流在 v1 以後另寫計畫。人物呈現樣本（`ennichi_lab.js`、Blender 管線）依使用者指示（2026-11-12）暫停，本計畫只把樣本頁搬到 `ennichi/lab/` 並抽出共用的群眾模組。

## Global Constraints

- 所有說明文件、commit message、程式註解中的說明用**繁體中文**；識別字維持英文。
- JS 一律 ES5（`var`、`function`；不用箭頭函式／class／let／const／template literal），每個檔案是 IIFE，掛在 `window.PriTestEnnichi*`。
- 遊戲專屬前綴：CSS class／id `en-`、i18n 鍵 `en_`、命名空間 `PriTestEnnichi`。不得修改其他遊戲的 JS／CSS（CLAUDE.md §5.2.1）。
- 遊戲樣式只放 `static_src/css/ennichi.css`；UI 字串放 `site_src/i18n_ennichi.py`（zh、ja；en 只放標題與首頁卡片）；遊戲資料文字放 `static_src/ennichi_data.js` 的 `C(zh, ja)`。
- **大型設施只能用第三層模組；一般設施只用第二層以下的零件**（規格 §4.4）。`tools/ennichi_check/core_check.js` 的資料檢查會強制這條。
- 立繪一律沿用 `static/images/jikan/`；murmur 與繪馬頭像用 `n_000`〜`n_031`。全年齡內容。
- 模擬必須是決定性的：只能用 `Core.rnd(s)`／`Core.rint(s, n)` 取亂數，不得用 `Math.random`（3D 的純視覺效果除外）。
- 每次修改 `site_src/` 或 `static_src/` 後執行 `py -3 generate.py`；JS 修改後至少 `node --check static_src/<file>.js`。
- Playwright 觸發按鈕一律用 `page.dispatchEvent(sel, "click")`（CLAUDE.md §4.6）。
- 推送：`git push -u private starv-stage3d`。完成時 `site_src/version.py` 遞增 minor，commit message 註明版本。
- commit message 結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## 檔案結構

| 檔案 | 職責 | Task |
| --- | --- | --- |
| `site_src/ennichi_page.py` | 遊戲頁＋樣本頁、`ENNICHI_SCRIPTS`、`ENNICHI_LAB_SCRIPTS` | 1、13 |
| `site_src/i18n_ennichi.py` | UI 字串、`ENNICHI_PROJECT` | 1、15 |
| `generate.py`、`site_src/i18n_data.py`、`site_src/projects.py` | 註冊 | 1 |
| `static_src/css/ennichi.css` | 樣式 | 1、15 |
| `static_src/ennichi_data.js` | 地圖、物品（含層級）、機器、配方、建物（含改裝槽）、客群、天氣、常數 | 2 |
| `static_src/ennichi_murmur.js` | murmur 範本、產生、今日話題 | 7 |
| `static_src/ennichi_wish.js` | 繪馬許願：產生、進度、完成、撤下 | 10 |
| `static_src/ennichi_core.js` | 新局、亂數、地圖與建造（組裝期）、倉庫、市場、工房、改裝、日循環、`applyIntent`、`tick`、存檔 | 3、4、5、11 |
| `static_src/ennichi_sim.js` | 客人：生成、需求、尋路、排隊、搭乘、攤位、設施、故障、髒亂、天氣影響、排隊屋台、整理券 | 6〜9 |
| `static_src/ennichi_crowd.js` | 看板人物圖集＋群眾（從 `ennichi_lab.js` 抽出共用） | 13 |
| `static_src/ennichi_3d.js` | 3D 樂園 | 14 |
| `static_src/ennichi.js` | 畫面 | 15 |
| `tools/ennichi_check/core_check.js` | Node 規則檢查 | 2〜11 |
| `tools/ennichi_check/sim.js` | 28 天平衡模擬（自動排程機器人） | 12 |
| `tools/ennichi_check/ui_check.js` | Playwright 瀏覽器檢查 | 16 |

腳本載入順序（`ENNICHI_SCRIPTS`）：
`ennichi_data.js` → `ennichi_murmur.js` → `ennichi_wish.js` → `ennichi_core.js` → `ennichi_sim.js` → `ennichi_crowd.js` → `ennichi_3d.js` → `ennichi.js`
（`three.min.js` 與 `ennichi_vrm.js` 由 `ennichi.js` 進入遊戲時動態載入。）模組之間在**呼叫時**才取 `window.PriTestEnnichi*`，所以載入順序只影響頂層初始化。

**關於 Task 14、15：** 規則層（Task 2〜12）附完整程式與測試；3D（Task 14）與畫面（Task 15）以「介面合約」描述——函式簽名、造型與動畫對照表、選擇器表、i18n 鍵、版面規則——由實作者依合約撰寫，並以 Task 16 的瀏覽器檢查驗收。兩者大量沿用 `ennichi_lab.js` 已驗證過的程式（燈光、Bloom、招牌、摩天輪、murmur 氣泡）。

## 狀態 `s`（Task 3 建立；之後只增加欄位，不改名）

```
{ v: 1, seed, rs,
  day: 1, phase: "plan"|"open"|"close"|"season", min: 540,
  cash, rep: 0, fee,
  tiles: [0|1], occ: [0|sid], structs: { sid: Struct }, nextId, mapVer,
  ware: { itemId: n }, machines: [ { type, rid, t } ],
  guests: [ Guest ], nextGid,
  weather: [ "sun"|"cloud"|"rain"|"wind" ],   // index = day（0 不用）
  wishes: [ Wish ], nextWish,
  dirt: 0, today: Today|null, history: [ Summary ], photos: [ "n_000", ... ] }

Struct = { id, type, x, y, wear: 0, broken: false, price, q: [gid], riders: [gid], t: 0, fixes: 0,
           build: 剩餘施工天數, mods: { slot: 1 }, ticket: false, link: sid|null,
           waitSum: 0, waitN: 0, lastWait: 0 }
Guest  = { id, type, outfit, photo, x, y, state, sid,
           need: { fun, hunger, thirst, toilet, fatigue, dry },
           hap, cash, patience, wait, t, leaving, spent, rides, kasa: false, ticket: { sid, at }|null }
Today  = { guests, left, rev, fees, hapSum, hapN, sns, made: {}, sales: {}, spawn: [分鐘],
           murmurs: [ Murmur ], topics: { key: n }, weather, closed: [type], wishesDone }
Summary = { day, guests, rev, avgHap, repDelta, sns, weather, wishesDone, topTopics: [ [key, n] ] }
Murmur = { t, day, gid, photo, type, topic, text: { zh, ja } }
Wish   = { id, kind: "build"|"sell"|"upgrade"|"queue"|"shelter", target, n, prog, day, gid, photo, text: { zh, ja }, done }
```

---

### Task 1: 骨架與建置註冊（樣本頁搬到 `ennichi/lab/`）

**Files:**
- Modify: `site_src/ennichi_page.py`、`generate.py`、`site_src/projects.py`、`site_src/i18n_ennichi.py`、`site_src/i18n_data.py`
- Create: `static_src/ennichi.js`（暫時骨架）

**Interfaces:**
- Produces: `ENNICHI_SCRIPTS`、`ENNICHI_LAB_SCRIPTS`、`build_ennichi_html()`、`build_ennichi_lab_html()`；遊戲頁根元素
  `<div id="en-game" data-three-src data-vendor-src data-model="../static/models/ennichi/sayo_blender.vrm" data-model-crowd="../static/models/ennichi/sayo.vrm" data-jikan="../static/images/jikan/">`；
  樣本頁維持 `#en-app`、網址 `ennichi/lab/index.html`；`ENNICHI_PROJECT`。

- [ ] **Step 1: 改寫頁面模組**

`site_src/ennichi_page.py` 整檔改成：

```python
"""緣日樂園（ennichi）的頁面。

遊戲頁 ennichi/index.html：神社遊樂園經營（規格 docs/ennichi_rules.md，計畫 docs/superpowers/plans/2026-11-12-ennichi-mvp.md）。
規則在 static/ennichi_data.js → ennichi_murmur.js → ennichi_wish.js → ennichi_core.js → ennichi_sim.js，
畫面在 ennichi_crowd.js（看板人物）→ ennichi_3d.js（three.js 樂園）→ ennichi.js（HUD、面板）。
樣本頁 ennichi/lab/index.html：人物呈現技術驗證（VRM 近景、看板人物、murmur、立繪），2026-11-12 起暫停修改。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

ENNICHI_SCRIPTS: tuple[str, ...] = (
    "ennichi_data.js",
    "ennichi_murmur.js",
    "ennichi_wish.js",
    "ennichi_core.js",
    "ennichi_sim.js",
    "ennichi_crowd.js",
    "ennichi_3d.js",
    "ennichi.js",
)
ENNICHI_LAB_SCRIPTS: tuple[str, ...] = ("ennichi_lab.js",)


def build_ennichi_html() -> str:
    three_src = asset_url("../static/", "vendor/three.min.js")
    vendor_src = asset_url("../static/", "vendor/ennichi_vrm.js")
    body = f"""    <div class="en-wrap">
      <div id="en-game" data-three-src="{three_src}" data-vendor-src="{vendor_src}"
           data-model="../static/models/ennichi/sayo_blender.vrm"
           data-model-crowd="../static/models/ennichi/sayo.vrm"
           data-jikan="../static/images/jikan/"></div>
    </div>
"""
    return page_shell(
        title="緣日樂園",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=ENNICHI_SCRIPTS,
        extra_styles=("css/ennichi.css",),
        extra_i18n=("i18n/ennichi.js",),
    )


def build_ennichi_lab_html() -> str:
    three_src = asset_url("../../static/", "vendor/three.min.js")
    vendor_src = asset_url("../../static/", "vendor/ennichi_vrm.js")
    body = f"""    <div class="en-wrap">
      <div id="en-app" data-three-src="{three_src}" data-vendor-src="{vendor_src}"
           data-model="../../static/models/ennichi/sayo.vrm"
           data-model-blender="../../static/models/ennichi/sayo_blender.vrm"
           data-jikan="../../static/images/jikan/"></div>
    </div>
"""
    return page_shell(
        title="緣日樂園 樣本",
        body=body,
        static_prefix="../../static/",
        home_href="../../index.html",
        extra_scripts=ENNICHI_LAB_SCRIPTS,
        extra_styles=("css/ennichi.css",),
        extra_i18n=("i18n/ennichi.js",),
    )
```

- [ ] **Step 2: 註冊建置**

`generate.py`：
- import 改成 `from site_src.ennichi_page import ENNICHI_LAB_SCRIPTS, ENNICHI_SCRIPTS, build_ennichi_html, build_ennichi_lab_html`
- copy 清單 `*ENNICHI_SCRIPTS,` 下一行加 `*ENNICHI_LAB_SCRIPTS,`
- `build_pages()` 的 ennichi 區塊改成：

```python
    ennichi_dir = DIST_DIR / "ennichi"
    ennichi_dir.mkdir(parents=True, exist_ok=True)
    (ennichi_dir / "index.html").write_text(build_ennichi_html(), encoding="utf-8")
    (ennichi_dir / "lab").mkdir(parents=True, exist_ok=True)
    (ennichi_dir / "lab" / "index.html").write_text(build_ennichi_lab_html(), encoding="utf-8")
```

`site_src/projects.py` 在 `champ` 之後加：

```python
    {
        "id": "ennichi",
        "href": "ennichi/index.html",
        "name_key": "project_ennichi_name",
        "desc_key": "project_ennichi_desc",
    },
```

`site_src/i18n_ennichi.py` 末尾加，並在 `site_src/i18n_data.py` 的 import 與三個語言字典加上 `ENNICHI_PROJECT`（比照 `CHAMP_PROJECT`）；三個語言各加 `"en_title"`（zh `"緣日樂園"`、ja `"縁日遊園"`、en `"Ennichi Park"`）：

```python
ENNICHI_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_ennichi_name": "緣日樂園", "project_ennichi_desc": "神社遊樂園經營：在老工房把原木、鐵料一層層加工成彩繪唐獅子、摩天輪車廂，組裝旋轉木馬與攤位；看天氣調整生產、實現客人掛在繪馬上的願望，讓沒落的小神社熱鬧起來"},
    "ja": {"project_ennichi_name": "縁日遊園", "project_ennichi_desc": "神社の遊園地経営：古い工房で原木や鉄を何段も加工して彩色唐獅子や観覧車のゴンドラに仕上げ、メリーゴーランドや屋台を組み立てる。天気を見て生産を調整し、絵馬に書かれたお客さんの願いを叶えて寂れた神社をにぎやかに"},
    "en": {"project_ennichi_name": "Ennichi Park", "project_ennichi_desc": "Run a shrine-side amusement park: refine lumber and iron through a three-tier workshop into painted lions and Ferris-wheel cabins, assemble rides and stalls, plan around the weather and grant the wishes guests hang on ema plaques"},
}
```

- [ ] **Step 3: 遊戲頁骨架**

`static_src/ennichi.js`：

```js
// ============================================================================
// 緣日樂園：畫面（HUD、面板、小地圖、murmur 牆）。Task 15 會整檔改寫；這裡先放骨架確認建置。
// ============================================================================
(function () {
  "use strict";
  var root = document.getElementById("en-game");
  if (!root) return;
  root.innerHTML = '<h1 class="en-title" data-i18n="en_title"></h1>';
  if (window.I18N) window.I18N.applyI18n();
})();
```

本 Task 尚未建立的 `ennichi_*.js` 會讓 `generate.py` 複製失敗：先建立內容只有一行註解的空檔 `ennichi_murmur.js`、`ennichi_wish.js`、`ennichi_core.js`、`ennichi_sim.js`、`ennichi_crowd.js`、`ennichi_3d.js`（`// 緣日樂園：<用途>（之後的 Task 實作）`）。

- [ ] **Step 4: 建置並確認**

Run: `py -3 generate.py && ls dist/ennichi dist/ennichi/lab && py -3 tools/split_css.py --check`
Expected: 建置成功、兩個 `index.html` 都存在、split_css exit 0。瀏覽器確認 `ennichi/lab/index.html` 樣本仍能載入、`ennichi/index.html` 顯示標題、首頁有「緣日樂園」卡片。

- [ ] **Step 5: Commit**

```bash
git add site_src/ennichi_page.py site_src/projects.py site_src/i18n_ennichi.py site_src/i18n_data.py generate.py static_src/ennichi*.js
git commit -m "feat(ennichi): 遊戲頁骨架與首頁登錄，樣本頁移到 ennichi/lab/"
```

---

### Task 2: 資料——物品層級、機器、40 條配方、建物與改裝槽、客群、天氣

**Files:**
- Create: `static_src/ennichi_data.js`、`tools/ennichi_check/core_check.js`

**Interfaces:**
- Produces（`window.PriTestEnnichiData`，以下簡稱 `D`）：
  - `D.C(zh, ja)`、`D.tierOf(itemId) -> 0..`（原料 0；其他＝1＋配方輸入的最高層級；有快取）
  - `D.MAP = { W: 32, H: 20, TILE: 2, GATE: { x: 0, y: 10 }, UNLOCK_X: 22, SHRINE: { x: 26, y: 8, w: 4, h: 4 } }`
  - 時間：`DAY_START = 540`、`DAY_END = 1020`、`LAST_ENTRY = 900`、`SEASON_DAYS = 28`
  - 經濟：`START_CASH = 5000`、`ENTRY_FEE = 200`、`PATH_COST = 10`、`WARE_CAP = 400`、`MACHINE_SLOTS = 14`、`MACHINE_SLOTS_PER_LV = 2`、`REFUND = 0.5`、`POP_LEVELS = [0, 50, 150, 300, 600]`
  - `D.ITEMS[id] = { kind: "mat"|"part"|"module"|"upgrade"|"food"|"drink"|"goods", buy?, sell?, fill?: { need: n }, joy?, umbrella?, name }`
  - `D.MACHINES[type] = { cost, name }`；`D.RECIPES[產物 id] = { m, in: {item: n}, out: {item: n}, t }`（配方 key 一律等於產物 id，每個產物只有一條配方）
  - `D.BUILD[type]`：共通 `{ kind, w, h, cash, parts, lv, name }`；
    - `kind: "ride"`：`cap, cycle, price, thrill, charm, photo, wear, fix`，大型設施另有 `large: true, days, slots: { slot: { mod, n, eff: { thrill?, charm?, photo?, price?, wearMul? } } }`，受強風影響的有 `wind: true`
    - `kind: "stall"`：`sells: [itemId]`；`kind: "qstall"`：`sells`（排隊屋台）
    - `kind: "facility"`：`serves: "fatigue"|"toilet"|"trash"|"shelter"`、`cap`、`time`
    - `kind: "deco"`：`joy`；`kind: "shrine"`：`fun, photo`
  - `D.GUESTS`、`D.NEED_RATE = { fun: 0.3, hunger: 0.2, thirst: 0.25, toilet: 0.15, fatigue: 0.12, dry: 0 }`
  - `D.NEED_TO = { fun: ["ride", "shrine", "goods"], hunger: ["food"], thirst: ["drink"], toilet: ["toilet"], fatigue: ["fatigue", "shelter"], dry: ["kasa", "shelter"] }`
  - `D.WEATHER = { sun|cloud|rain|wind: { w, arrive, thirst, hunger, wet?, stop?, name } }`
  - `D.WISH = { MAX: 3, CHANCE: 0.1, EXPIRE: 7, SELL_N: 30, QUEUE_OK: 10, REWARD: { build: 15, upgrade: 15, sell: 10, queue: 12, shelter: 12 }, PENALTY: 3 }`
  - `D.QSTALL_RANGE = 3`、`D.TICKET_FACTOR = 2`、`D.GUEST_SPEED = 2`、`D.OUTFITS = 4`、`D.PHOTOS`
  - `D.START_WARE`、`D.START_MACHINES`

- [ ] **Step 1: 寫失敗的測試**

`tools/ennichi_check/core_check.js`：

```js
// ============================================================================
// 緣日樂園（ennichi）核心規則檢查（不開瀏覽器，直接用 Node 載入 static_src）。
// 執行：node tools/ennichi_check/core_check.js
// 每個 Task 往下追加一段。
// ============================================================================
"use strict";
var fs = require("fs"), path = require("path"), assert = require("assert");
global.window = global;
global.I18N = { getLang: function () { return "zh"; }, t: function (k) { return k; } };
var SRC = path.join(__dirname, "..", "..", "static_src");
["ennichi_data.js", "ennichi_murmur.js", "ennichi_wish.js", "ennichi_core.js", "ennichi_sim.js"].forEach(function (f) {
  eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8"));
});
var D = window.PriTestEnnichiData;

// ---------------- 1. 資料完整性與層級規則 ----------------
(function () {
  var items = Object.keys(D.ITEMS), recipes = Object.keys(D.RECIPES);
  assert.strictEqual(Object.keys(D.MACHINES).length, 17, "機器 17 種");
  assert.strictEqual(recipes.length, 40, "配方 40 條");
  assert.strictEqual(items.filter(function (k) { return D.ITEMS[k].kind === "mat"; }).length, 14, "原料 14 種");
  recipes.forEach(function (rid) {
    var r = D.RECIPES[rid];
    assert.ok(D.MACHINES[r.m], rid + " 的機器不存在：" + r.m);
    assert.ok(r.out[rid] > 0, rid + " 的產物要等於配方 key");
    Object.keys(r.in).concat(Object.keys(r.out)).forEach(function (k) { assert.ok(D.ITEMS[k], rid + " 的物品不存在：" + k); });
    assert.ok(r.t > 0);
  });
  items.forEach(function (k) {
    var it = D.ITEMS[k];
    if (it.kind === "mat") { assert.ok(it.buy > 0, k + " 要有買價"); assert.ok(!D.RECIPES[k], k + " 是原料，不該有配方"); }
    else assert.ok(D.RECIPES[k], k + " 沒有配方");
    if (["food", "drink", "goods"].indexOf(it.kind) >= 0) assert.ok(it.sell > 0, k + " 要有售價");
    if (it.kind === "module" || it.kind === "upgrade") assert.ok(D.tierOf(k) >= 3, k + " 是模組，層級要 ≥ 3：" + D.tierOf(k));
    if (it.kind === "part") assert.ok(D.tierOf(k) >= 1 && D.tierOf(k) <= 2, k + " 是零件，層級 1〜2：" + D.tierOf(k));
  });
  // 每台機器至少有一條配方
  Object.keys(D.MACHINES).forEach(function (m) { assert.ok(recipes.some(function (r) { return D.RECIPES[r].m === m; }), m + " 沒有配方"); });
  // 建物：大型設施只用第三層模組；一般設施只用第二層以下的零件
  var rides = 0, stalls = 0, large = 0;
  Object.keys(D.BUILD).forEach(function (t) {
    var b = D.BUILD[t];
    assert.ok(b.w >= 1 && b.h >= 1 && b.lv >= 1 && b.lv <= 5, t + " 尺寸／等級");
    Object.keys(b.parts).forEach(function (k) {
      assert.ok(D.ITEMS[k], t + " 的材料不存在：" + k);
      if (b.large) assert.strictEqual(D.ITEMS[k].kind, "module", t + " 是大型設施，只能用模組：" + k);
      else assert.ok(D.ITEMS[k].kind === "part" && D.tierOf(k) <= 2, t + " 是一般設施，只能用第二層以下的零件：" + k);
    });
    if (b.kind === "ride") {
      rides++;
      assert.ok(b.cap > 0 && b.cycle > 0 && b.price >= 0 && b.wear > 0, t + " 搭乘數值");
      Object.keys(b.fix).forEach(function (k) { assert.ok(D.ITEMS[k].kind === "part", t + " 的修理零件要是零件：" + k); });
      if (b.large) {
        large++;
        assert.ok(b.days >= 1, t + " 大型設施要有組裝期");
        Object.keys(b.slots).forEach(function (sl) {
          assert.strictEqual(D.ITEMS[b.slots[sl].mod].kind, "upgrade", t + "." + sl + " 的改裝模組");
          assert.ok(b.slots[sl].n >= 1);
        });
      }
    }
    if (b.kind === "stall") { stalls++; b.sells.forEach(function (k) { assert.ok(["food", "drink", "goods"].indexOf(D.ITEMS[k].kind) >= 0, t + " 賣的不是商品：" + k); }); }
  });
  assert.strictEqual(rides, 8, "遊樂設施 8 種（規格 §10）"); assert.strictEqual(large, 4, "大型設施 4 種"); assert.strictEqual(stalls, 5, "攤位 5 種");
  assert.ok(D.BUILD.qstall && D.BUILD.qstall.kind === "qstall" && D.BUILD.shelter.serves === "shelter");
  function sumW(list) { return list.reduce(function (a, g) { return a + g.w; }, 0); }
  assert.ok(Math.abs(sumW(D.GUESTS) - 1) < 1e-9, "客群權重合計 1");
  assert.ok(Math.abs(sumW(Object.keys(D.WEATHER).map(function (k) { return D.WEATHER[k]; })) - 1) < 1e-9, "天氣權重合計 1");
  // 開局倉庫：夠蓋章魚燒攤、糖果攤、金魚撈、套圈圈、長椅（教學的前幾步）；旋轉木馬要自己建生產線
  var need = {};
  ["takoyakiSt", "ameSt", "kingyo", "wanage", "bench"].forEach(function (t) { var p = D.BUILD[t].parts; for (var k in p) need[k] = (need[k] || 0) + p[k]; });
  for (var k in need) assert.ok((D.START_WARE[k] || 0) >= need[k], "開局不夠：" + k);
  assert.ok(Object.keys(D.BUILD.merry.parts).some(function (k) { return !D.START_WARE[k]; }), "旋轉木馬不能一開局就蓋");
  assert.strictEqual(D.PHOTOS.length, 32);
  console.log("1. 資料與層級 OK");
})();
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: FAIL（`Cannot read properties of undefined (reading 'ITEMS')`）

- [ ] **Step 3: 寫資料**

`static_src/ennichi_data.js`：

```js
// ============================================================================
// 緣日樂園：遊戲資料（規格 docs/ennichi_rules.md §4.4〜§4.6、§5、§6.4、§7.3）。
// 只放資料與常數，規則在 ennichi_core.js／ennichi_sim.js。
// 生產鏈：原料（市場）→ 第一層 基礎材料 → 第二層 通用零件 → 第三層 專用模組 →（組裝期）大型設施；
//         一般設施只用第二層以下的零件。層級＝配方深度（D.tierOf）。
// ============================================================================
(function () {
  "use strict";
  function C(zh, ja) { return { zh: zh, ja: ja || zh }; }
  var D = { C: C };

  // 地圖：32×20 格（1 格 = 2 m）。入口在左邊中央，參道一路通到右邊的神社本殿；x ≥ UNLOCK_X 是 v2 擴張用地
  D.MAP = { W: 32, H: 20, TILE: 2, GATE: { x: 0, y: 10 }, UNLOCK_X: 22, SHRINE: { x: 26, y: 8, w: 4, h: 4 } };
  D.DAY_START = 540; // 9:00
  D.DAY_END = 1020; // 17:00 閉園（客人開始離場）
  D.LAST_ENTRY = 900; // 15:00 以後不再進場
  D.SEASON_DAYS = 28;
  D.START_CASH = 5000;
  D.ENTRY_FEE = 200;
  D.PATH_COST = 10;
  D.WARE_CAP = 400;
  D.MACHINE_SLOTS = 14; // 人氣每升 1 級 +2
  D.MACHINE_SLOTS_PER_LV = 2;
  D.REFUND = 0.5;
  D.POP_LEVELS = [0, 50, 150, 300, 600];
  D.GUEST_SPEED = 2;
  D.OUTFITS = 4;
  D.QSTALL_RANGE = 3;
  D.TICKET_FACTOR = 2;

  function mat(buy, zh, ja) { return { kind: "mat", buy: buy, name: C(zh, ja) }; }
  function part(zh, ja) { return { kind: "part", name: C(zh, ja) }; }
  function mod(zh, ja) { return { kind: "module", name: C(zh, ja) }; }
  function upg(zh, ja) { return { kind: "upgrade", name: C(zh, ja) }; }

  D.ITEMS = {
    // 原料（14）
    wood: mat(10, "原木", "原木"), bamboo: mat(8, "竹", "竹"), iron: mat(15, "鐵料", "鉄材"), copper: mat(25, "銅料", "銅材"),
    kozo: mat(10, "楮樹皮", "楮"), glassraw: mat(12, "玻璃料", "ガラス原料"), clay: mat(8, "陶土", "陶土"), urushi: mat(30, "生漆", "生漆"),
    pigment: mat(15, "顏料", "顔料"), cloth: mat(12, "布料", "布"), sugar: mat(5, "砂糖", "砂糖"), flour: mat(5, "麵粉", "小麦粉"),
    octopus: mat(20, "章魚", "タコ"), apple: mat(8, "蘋果", "りんご"),
    // 第一層（9）
    plank: part("木板", "板材"), strip: part("竹條", "竹ひご"), sheet: part("金屬板", "金属板"), wire: part("銅線", "銅線"),
    washi: part("和紙", "和紙"), pane: part("玻璃板", "板ガラス"), bisque: part("素燒坯", "素焼き"), paint: part("彩漆", "色漆"), canvas: part("帆布", "帆布"),
    // 第二層（8）
    frame: part("鋼骨架", "鉄骨フレーム"), gear: part("齒輪", "歯車"), chain: part("鏈條", "チェーン"), pole: part("鍍金柱", "金メッキ柱"),
    motor: part("馬達", "モーター"), bulb: part("燈泡", "電球"), carving: part("雕刻木件", "彫刻パーツ"), seat: part("座椅", "座席"),
    // 第三層：專用模組（12）
    lion: mod("彩繪唐獅子", "彩色唐獅子"), lionPost: mod("獅子柱組", "獅子柱ユニット"), tent: mod("帳篷頂棚", "テント屋根"),
    turntable: mod("迴轉台", "回転台"), cup: mod("茶碗杯座", "茶碗カップ"), windmill: mod("風車頂篷", "風車屋根"),
    swing: mod("吊椅", "吊り椅子"), tower: mod("飛椅塔", "ブランコ塔"), cabin: mod("摩天輪車廂", "観覧車ゴンドラ"),
    rim: mod("輪框段", "リム材"), hub: mod("主軸機組", "主軸ユニット"), lanterns: mod("燈籠串", "提灯つなぎ"),
    // 改裝模組（4）
    nightLanterns: upg("夜光燈籠串", "夜光提灯つなぎ"), fastTurntable: upg("高速迴轉台", "高速回転台"),
    goldLion: upg("金箔唐獅子", "金箔唐獅子"), glassCabin: upg("全景玻璃車廂", "パノラマゴンドラ"),
    // 商品（7）
    takoyaki: { kind: "food", sell: 300, fill: { hunger: 45 }, name: C("章魚燒", "たこ焼き") },
    ringoame: { kind: "food", sell: 250, fill: { hunger: 15, fun: 10 }, name: C("蘋果糖", "りんご飴") },
    wataame: { kind: "food", sell: 200, fill: { hunger: 10, fun: 10 }, name: C("棉花糖", "わたあめ") },
    ramune: { kind: "drink", sell: 150, fill: { thirst: 55 }, name: C("彈珠汽水", "ラムネ") },
    omamori: { kind: "goods", sell: 500, joy: 12, fill: { fun: 20 }, name: C("限定御守", "限定お守り") },
    ema: { kind: "goods", sell: 300, joy: 6, fill: { fun: 15 }, name: C("繪馬", "絵馬") },
    kasa: { kind: "goods", sell: 400, joy: 2, fill: { dry: 100 }, umbrella: true, name: C("和傘", "和傘") },
  };

  D.MACHINES = {
    saw: { cost: 200, name: C("製材機", "製材機") }, press: { cost: 300, name: C("沖壓機", "プレス機") },
    draw: { cost: 400, name: C("拉線機", "伸線機") }, paper: { cost: 300, name: C("和紙工坊", "和紙工房") },
    glass: { cost: 400, name: C("玻璃爐", "ガラス炉") }, kiln: { cost: 400, name: C("陶窯", "陶窯") },
    lacquer: { cost: 400, name: C("漆工房", "漆工房") }, sew: { cost: 300, name: C("縫紉台", "ミシン台") },
    weld: { cost: 500, name: C("焊接台", "溶接台") }, lathe: { cost: 500, name: C("車床", "旋盤") },
    wind: { cost: 600, name: C("繞線機", "巻線機") }, carve: { cost: 300, name: C("雕刻台", "彫刻台") },
    wood: { cost: 300, name: C("木工台", "木工台") }, assembly: { cost: 800, name: C("組裝台", "組立台") },
    griddle: { cost: 300, name: C("鐵板灶", "鉄板かまど") }, sweets: { cost: 400, name: C("甜品台", "甘味台") },
    craft: { cost: 400, name: C("御守工坊", "お守り工房") },
  };

  function R(m, inp, n, t) { return { m: m, in: inp, n: n, t: t }; }
  var RAW = {
    // 第一層
    plank: R("saw", { wood: 1 }, 2, 3), strip: R("saw", { bamboo: 1 }, 3, 3), sheet: R("press", { iron: 1 }, 1, 3),
    wire: R("draw", { copper: 1 }, 2, 3), washi: R("paper", { kozo: 1 }, 2, 4), pane: R("glass", { glassraw: 1 }, 1, 4),
    bisque: R("kiln", { clay: 1 }, 1, 5), paint: R("lacquer", { urushi: 1, pigment: 1 }, 2, 5), canvas: R("sew", { cloth: 2 }, 1, 5),
    // 第二層
    frame: R("weld", { sheet: 3 }, 1, 8), gear: R("lathe", { sheet: 1 }, 2, 4), chain: R("lathe", { sheet: 2 }, 1, 5),
    pole: R("lathe", { sheet: 1, paint: 1 }, 1, 6), motor: R("wind", { wire: 2, sheet: 1 }, 1, 10), bulb: R("glass", { pane: 1, wire: 1 }, 2, 5),
    carving: R("carve", { plank: 2 }, 1, 6), seat: R("wood", { plank: 2, canvas: 1 }, 1, 6),
    // 第三層：專用模組
    lion: R("lacquer", { carving: 2, paint: 1 }, 1, 8), lionPost: R("assembly", { lion: 1, pole: 1 }, 1, 4),
    tent: R("assembly", { canvas: 2, strip: 4, frame: 1 }, 1, 6), turntable: R("assembly", { gear: 3, frame: 1, motor: 1 }, 1, 8),
    cup: R("kiln", { bisque: 1, paint: 1, gear: 1 }, 1, 6), windmill: R("assembly", { canvas: 2, strip: 4, gear: 1 }, 1, 6),
    swing: R("assembly", { seat: 1, chain: 2 }, 1, 4), tower: R("weld", { frame: 2, chain: 1, motor: 1 }, 1, 10),
    cabin: R("assembly", { frame: 1, pane: 2, paint: 1 }, 1, 8), rim: R("weld", { frame: 1, chain: 1 }, 1, 6),
    hub: R("assembly", { motor: 2, gear: 4 }, 1, 10), lanterns: R("paper", { washi: 2, strip: 2, bulb: 1 }, 1, 6),
    // 改裝模組
    nightLanterns: R("paper", { lanterns: 1, bulb: 2, paint: 1 }, 1, 6), fastTurntable: R("assembly", { turntable: 1, motor: 1, gear: 2 }, 1, 8),
    goldLion: R("lacquer", { lion: 1, paint: 2 }, 1, 8), glassCabin: R("glass", { cabin: 1, pane: 2 }, 1, 6),
    // 商品
    takoyaki: R("griddle", { flour: 1, octopus: 1 }, 6, 5), ringoame: R("sweets", { sugar: 1, apple: 1 }, 4, 4),
    wataame: R("sweets", { sugar: 1 }, 5, 3), ramune: R("sweets", { pane: 1, sugar: 1 }, 6, 4),
    omamori: R("craft", { cloth: 1, washi: 1 }, 3, 6), ema: R("craft", { plank: 1, paint: 1 }, 4, 5), kasa: R("paper", { washi: 2, strip: 3 }, 2, 6),
  };
  D.RECIPES = {};
  Object.keys(RAW).forEach(function (k) {
    var o = {}; o[k] = RAW[k].n;
    D.RECIPES[k] = { m: RAW[k].m, in: RAW[k].in, out: o, t: RAW[k].t };
  });

  var tierCache = {};
  D.tierOf = function (id) {
    if (tierCache[id] != null) return tierCache[id];
    var it = D.ITEMS[id], r = D.RECIPES[id], t = 0;
    if (it && it.kind !== "mat" && r) for (var k in r.in) t = Math.max(t, D.tierOf(k) + 1);
    tierCache[id] = t;
    return t;
  };

  function slot(m, n, eff) { return { mod: m, n: n, eff: eff }; }
  D.BUILD = {
    shrine: { kind: "shrine", w: 4, h: 4, cash: 0, parts: {}, lv: 1, fun: 20, photo: 2, name: C("神社本殿", "本殿") },
    // 大型設施（第三層模組＋組裝期）
    merry: { kind: "ride", large: true, days: 1, w: 4, h: 4, cash: 500, lv: 1, parts: { lionPost: 6, tent: 1, turntable: 1, lanterns: 2 },
      cap: 12, cycle: 4, price: 300, thrill: 1, charm: 3, photo: 2, wear: 4, fix: { gear: 2 },
      slots: { light: slot("nightLanterns", 2, { charm: 1, photo: 1 }), drive: slot("fastTurntable", 1, { thrill: 1, wearMul: 1.5 }), deco: slot("goldLion", 2, { charm: 1, price: 50 }) },
      name: C("唐獅子旋轉木馬", "唐獅子メリーゴーランド") },
    cups: { kind: "ride", large: true, days: 1, w: 3, h: 3, cash: 400, lv: 1, parts: { cup: 6, turntable: 1 },
      cap: 8, cycle: 3, price: 250, thrill: 2, charm: 2, photo: 1, wear: 5, fix: { gear: 2 },
      slots: { drive: slot("fastTurntable", 1, { thrill: 1, wearMul: 1.5 }) },
      name: C("茶碗咖啡杯", "茶碗コーヒーカップ") },
    chairs: { kind: "ride", large: true, days: 1, wind: true, w: 4, h: 4, cash: 600, lv: 2, parts: { windmill: 1, swing: 8, tower: 1 },
      cap: 12, cycle: 4, price: 350, thrill: 3, charm: 1, photo: 1, wear: 6, fix: { chain: 2 },
      slots: { light: slot("nightLanterns", 2, { charm: 1, photo: 1 }) },
      name: C("紙風車旋轉飛椅", "風車ブランコ") },
    wheel: { kind: "ride", large: true, days: 2, wind: true, w: 6, h: 6, cash: 1200, lv: 3, parts: { cabin: 8, rim: 8, hub: 1, lanterns: 4 },
      cap: 24, cycle: 10, price: 500, thrill: 1, charm: 2, photo: 3, wear: 3, fix: { chain: 2, bulb: 4 },
      slots: { cabin: slot("glassCabin", 8, { photo: 1, price: 100 }), light: slot("nightLanterns", 4, { charm: 1 }) },
      name: C("燈籠摩天輪", "灯籠観覧車") },
    // 參道緣日區（一般設施：第二層以下）
    kingyo: { kind: "ride", w: 2, h: 2, cash: 100, lv: 1, parts: { plank: 4, pane: 2 }, cap: 4, cycle: 3, price: 200, thrill: 0, charm: 2, photo: 1, wear: 2, fix: { plank: 2 }, name: C("金魚撈", "金魚すくい") },
    shateki: { kind: "ride", w: 2, h: 2, cash: 100, lv: 1, parts: { plank: 4, gear: 2 }, cap: 3, cycle: 2, price: 200, thrill: 1, charm: 1, photo: 0, wear: 2, fix: { plank: 2 }, name: C("射擊攤", "射的") },
    wanage: { kind: "ride", w: 2, h: 2, cash: 80, lv: 1, parts: { plank: 4, strip: 6 }, cap: 4, cycle: 2, price: 150, thrill: 0, charm: 1, photo: 0, wear: 1, fix: { plank: 2 }, name: C("套圈圈", "輪投げ") },
    omikuji: { kind: "ride", w: 2, h: 2, cash: 100, lv: 1, parts: { plank: 3, carving: 1, washi: 4 }, cap: 2, cycle: 1, price: 100, thrill: 0, charm: 2, photo: 2, wear: 1, fix: { plank: 2 }, name: C("抽籤所", "おみくじ所") },
    // 攤位
    takoyakiSt: { kind: "stall", w: 2, h: 2, cash: 100, lv: 1, parts: { plank: 4, canvas: 1, sheet: 1 }, sells: ["takoyaki"], name: C("章魚燒攤", "たこ焼き屋") },
    ameSt: { kind: "stall", w: 2, h: 2, cash: 100, lv: 1, parts: { plank: 4, canvas: 1 }, sells: ["ringoame", "wataame"], name: C("糖果攤", "飴屋") },
    ramuneSt: { kind: "stall", w: 2, h: 2, cash: 100, lv: 1, parts: { plank: 4, pane: 2 }, sells: ["ramune"], name: C("汽水攤", "ラムネ屋") },
    kasaSt: { kind: "stall", w: 2, h: 2, cash: 100, lv: 1, parts: { plank: 4, canvas: 1 }, sells: ["kasa"], name: C("和傘攤", "和傘屋") },
    juyo: { kind: "stall", w: 2, h: 2, cash: 150, lv: 2, parts: { plank: 4, carving: 2, paint: 1 }, sells: ["omamori", "ema"], name: C("授與所", "授与所") },
    qstall: { kind: "qstall", w: 1, h: 1, cash: 60, lv: 1, parts: { plank: 2, canvas: 1 }, sells: ["ramune", "wataame", "takoyaki"], name: C("排隊屋台", "行列屋台") },
    // 設施與裝飾
    bench: { kind: "facility", w: 1, h: 1, cash: 30, lv: 1, parts: { plank: 3 }, serves: "fatigue", cap: 2, time: 5, name: C("長椅", "ベンチ") },
    toilet: { kind: "facility", w: 2, h: 2, cash: 200, lv: 1, parts: { plank: 6, bisque: 2 }, serves: "toilet", cap: 3, time: 2, name: C("廁所", "トイレ") },
    trash: { kind: "facility", w: 1, h: 1, cash: 20, lv: 1, parts: { strip: 3 }, serves: "trash", cap: 0, time: 0, name: C("垃圾桶", "ゴミ箱") },
    shelter: { kind: "facility", w: 2, h: 2, cash: 150, lv: 1, parts: { plank: 4, canvas: 2, strip: 4 }, serves: "shelter", cap: 6, time: 5, name: C("休憩棚", "休憩所") },
    lanternPost: { kind: "deco", w: 1, h: 1, cash: 40, lv: 1, parts: { bulb: 2, washi: 2, strip: 2 }, joy: 0.06, name: C("燈籠柱", "灯籠柱") },
    flower: { kind: "deco", w: 1, h: 1, cash: 20, lv: 1, parts: {}, joy: 0.04, name: C("花圃", "花壇") },
  };

  D.GUESTS = [
    { id: "family", w: 0.25, cash: [1500, 3000], pref: { thrill: 0.2, charm: 1, photo: 0.4 }, patience: 25, name: C("親子", "親子") },
    { id: "couple", w: 0.2, cash: [1500, 2500], pref: { thrill: 0.4, charm: 0.6, photo: 1 }, patience: 30, name: C("情侶", "カップル") },
    { id: "student", w: 0.2, cash: [600, 1200], pref: { thrill: 0.8, charm: 0.5, photo: 0.4 }, patience: 20, name: C("學生", "学生") },
    { id: "thrill", w: 0.1, cash: [1000, 2000], pref: { thrill: 1, charm: 0.1, photo: 0.2 }, patience: 35, name: C("刺激派", "絶叫派") },
    { id: "photo", w: 0.15, cash: [1000, 2000], pref: { thrill: 0.2, charm: 0.6, photo: 1 }, patience: 25, name: C("拍照派", "映え派") },
    { id: "elder", w: 0.1, cash: [1000, 2000], pref: { thrill: 0, charm: 0.8, photo: 0.3 }, patience: 40, name: C("老人家", "お年寄り") },
  ];

  D.NEED_RATE = { fun: 0.3, hunger: 0.2, thirst: 0.25, toilet: 0.15, fatigue: 0.12, dry: 0 };
  D.NEED_TO = { fun: ["ride", "shrine", "goods"], hunger: ["food"], thirst: ["drink"], toilet: ["toilet"], fatigue: ["fatigue", "shelter"], dry: ["kasa", "shelter"] };

  D.WEATHER = {
    sun: { w: 0.45, arrive: 1, thirst: 1.3, hunger: 1, name: C("晴", "晴れ") },
    cloud: { w: 0.3, arrive: 1, thirst: 1, hunger: 1, name: C("陰", "くもり") },
    rain: { w: 0.18, arrive: 0.6, thirst: 0.6, hunger: 1.2, wet: true, name: C("雨", "雨") },
    wind: { w: 0.07, arrive: 0.85, thirst: 1, hunger: 1, stop: true, name: C("強風", "強風") },
  };

  D.WISH = { MAX: 3, CHANCE: 0.1, EXPIRE: 7, SELL_N: 30, QUEUE_OK: 10, REWARD: { build: 15, upgrade: 15, sell: 10, queue: 12, shelter: 12 }, PENALTY: 3 };

  D.PHOTOS = [];
  for (var i = 0; i < 32; i++) D.PHOTOS.push("n_" + (i < 10 ? "00" : "0") + i);

  // 開局：夠開 2 個攤位＋2 個攤位遊戲＋長椅；旋轉木馬的生產線要自己建（第一個目標）
  D.START_WARE = { plank: 30, canvas: 4, sheet: 6, pane: 4, gear: 2, strip: 8, wood: 20, iron: 10, urushi: 4, pigment: 4, flour: 10, octopus: 10, sugar: 10, cloth: 6 };
  D.START_MACHINES = ["saw", "press", "carve", "wood", "lacquer", "griddle"];

  window.PriTestEnnichiData = D;
})();
```

並把 `static_src/ennichi_murmur.js`、`ennichi_wish.js`、`ennichi_core.js`、`ennichi_sim.js` 保持為 Task 1 的空檔（`core_check.js` 會 eval 它們）。

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/ennichi_data.js && node tools/ennichi_check/core_check.js`
Expected: `1. 資料與層級 OK`

- [ ] **Step 5: Commit**

```bash
git add static_src/ennichi_data.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 遊戲資料（三層生產鏈 40 配方、大型設施模組與改裝槽、天氣、繪馬）與檢查腳本"
```

---

### Task 3: 核心——新局、亂數、地圖與建造（組裝期）、倉庫、市場、存檔

**Files:**
- Modify: `static_src/ennichi_core.js`（整檔寫入）、`tools/ennichi_check/core_check.js`

**Interfaces:**
- Consumes: `D.*`
- Produces（`window.PriTestEnnichiCore`，之後 Task 繼續擴充同一物件）：
  - `newGame({ seed }) -> s`（含 `weather[0..SEASON_DAYS]`、`wishes: []`、`nextWish: 1`）
  - `rnd(s)`、`rint(s, n)`、`pickW(s, list)`、`weatherOf(s, day)`
  - `ti(x, y)`、`inMap(x, y)`、`isPath(s, x, y)`、`entranceOf(st)`、`popLevel(s)`、`machineSlots(s)`
  - `have(s, map)`、`take(s, map)`、`give(s, map)`、`wareTotal(s)`
  - `nearRide(s, pos) -> sid|0`（遊樂設施入口在 `QSTALL_RANGE` 內，取最近）
  - `canBuild(s, type, x, y) -> { ok, err }`（err：`phase|level|bounds|locked|occupied|entrance|noride|parts|cash`）
  - `build(s, type, x, y) -> { ok, err, sid }`：Struct 依開頭定義建立，`build = b.days || 0`，排隊屋台 `link = nearRide`
  - `demolish(s, sid) -> bool`：施工中退回材料與現金各 50%（無條件捨去），完工的只退現金 50%
  - `setPath`、`buy`、`addMachine`（上限 `machineSlots`）、`setRecipe`、`setPrice`、`setFee`、`serialize`、`restore`

- [ ] **Step 1: 追加失敗的測試**

```js
// ---------------- 2. 新局、地圖、建造、組裝期、倉庫、市場、存檔 ----------------
var Core = window.PriTestEnnichiCore;
(function () {
  var s = Core.newGame({ seed: 7 }), M = D.MAP;
  assert.strictEqual(s.phase, "plan"); assert.strictEqual(s.cash, D.START_CASH);
  for (var x = 0; x < M.SHRINE.x; x++) assert.ok(Core.isPath(s, x, M.GATE.y), "參道 " + x);
  assert.ok(Object.keys(s.structs).some(function (k) { return s.structs[k].type === "shrine"; }));
  assert.strictEqual(s.machines.length, D.START_MACHINES.length);
  assert.strictEqual(s.weather.length, D.SEASON_DAYS + 1);
  s.weather.slice(1).forEach(function (w) { assert.ok(D.WEATHER[w], "天氣：" + w); });
  assert.strictEqual(Core.weatherOf(s, 3), s.weather[3]);
  var a = Core.newGame({ seed: 99 }), b = Core.newGame({ seed: 99 });
  assert.deepStrictEqual(a.weather, b.weather, "天氣可重播");
  // 一般設施：當天完成
  var r = Core.build(s, "takoyakiSt", 10, 8);
  assert.ok(r.ok); assert.strictEqual(s.structs[r.sid].build, 0);
  // 大型設施：沒有模組不能蓋；有模組就進入施工
  assert.strictEqual(Core.canBuild(s, "merry", 4, 6).err, "parts");
  Core.give(s, D.BUILD.merry.parts);
  assert.strictEqual(Core.canBuild(s, "merry", 4, 5).err, "entrance");
  r = Core.build(s, "merry", 4, 6);
  assert.ok(r.ok); var merry = s.structs[r.sid];
  assert.strictEqual(merry.build, D.BUILD.merry.days, "施工中");
  assert.deepStrictEqual(merry.mods, {}); assert.strictEqual(merry.ticket, false);
  assert.deepStrictEqual(Core.entranceOf(merry), { x: 6, y: 10 });
  assert.strictEqual(Core.canBuild(s, "kingyo", 5, 8).err, "occupied");
  assert.strictEqual(Core.canBuild(s, "kingyo", 23, 8).err, "locked");
  assert.strictEqual(Core.canBuild(s, "kingyo", 31, 19).err, "bounds");
  assert.strictEqual(Core.canBuild(s, "wheel", 10, 4).err, "level");
  // 排隊屋台：附近要有遊樂設施
  assert.strictEqual(Core.canBuild(s, "qstall", 18, 9).err, "noride");
  r = Core.build(s, "qstall", 8, 9); // 入口 (8,10)，旋轉木馬入口 (6,10) 在 2 格內
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(s.structs[r.sid].link, merry.id);
  // 施工中拆除：模組退一半
  var cash = s.cash;
  assert.ok(Core.demolish(s, merry.id));
  assert.strictEqual(s.ware.lionPost, Math.floor(6 * D.REFUND));
  assert.strictEqual(s.cash, cash + Math.floor(D.BUILD.merry.cash * D.REFUND));
  // 步道、市場、機器
  cash = s.cash;
  assert.ok(Core.setPath(s, 6, 11, true)); assert.strictEqual(s.cash, cash - D.PATH_COST);
  assert.ok(Core.buy(s, "wood", 5)); assert.ok(!Core.buy(s, "plank", 1), "零件不能買");
  assert.ok(!Core.buy(s, "wood", D.WARE_CAP), "超過倉庫上限");
  assert.strictEqual(Core.machineSlots(s), D.MACHINE_SLOTS);
  s.rep = 160; assert.strictEqual(Core.popLevel(s), 3); assert.strictEqual(Core.machineSlots(s), D.MACHINE_SLOTS + 2 * D.MACHINE_SLOTS_PER_LV);
  assert.ok(Core.addMachine(s, "assembly"));
  assert.ok(Core.setRecipe(s, s.machines.length - 1, "turntable"));
  assert.ok(!Core.setRecipe(s, s.machines.length - 1, "plank"), "組裝台不能製材");
  var t = Core.restore(Core.serialize(s));
  assert.deepStrictEqual(t, s); assert.strictEqual(Core.restore("{bad"), null);
  console.log("2. 核心（地圖、建造、組裝期、倉庫）OK");
})();
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: FAIL（`Cannot read properties of undefined (reading 'newGame')`）

- [ ] **Step 3: 寫核心**

`static_src/ennichi_core.js`：

```js
// ============================================================================
// 緣日樂園：核心規則（純函式；狀態 s 可 JSON 化）。
//   新局、亂數、地圖與建造（組裝期）、倉庫、市場（Task 3）、工房（Task 4）、改裝（Task 5）、
//   日循環與 applyIntent／tick（Task 11）、存檔。客人在 ennichi_sim.js、murmur 在 ennichi_murmur.js、繪馬在 ennichi_wish.js。
// ============================================================================
(function () {
  "use strict";
  var D = window.PriTestEnnichiData;
  var M = D.MAP;

  // ---- 亂數（mulberry32；狀態存在 s.rs，存檔後可重播）
  function rnd(s) {
    s.rs = (s.rs + 0x6D2B79F5) | 0;
    var t = s.rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rint(s, n) { return Math.floor(rnd(s) * n); }
  function pickW(s, list) {
    var r = rnd(s), acc = 0;
    for (var i = 0; i < list.length; i++) { acc += list[i].w; if (r < acc) return list[i]; }
    return list[list.length - 1];
  }

  // ---- 地圖
  function ti(x, y) { return y * M.W + x; }
  function inMap(x, y) { return x >= 0 && y >= 0 && x < M.W && y < M.H; }
  function isPath(s, x, y) { return inMap(x, y) && s.tiles[ti(x, y)] === 1; }
  function entranceOf(st) {
    var b = D.BUILD[st.type];
    if (st.type === "shrine") return { x: st.x - 1, y: M.GATE.y }; // 本殿的入口在參道盡頭
    return { x: st.x + Math.floor(b.w / 2), y: st.y + b.h };
  }
  function popLevel(s) {
    var lv = 1;
    for (var i = 0; i < D.POP_LEVELS.length; i++) if (s.rep >= D.POP_LEVELS[i]) lv = i + 1;
    return lv;
  }
  function machineSlots(s) { return D.MACHINE_SLOTS + (popLevel(s) - 1) * D.MACHINE_SLOTS_PER_LV; }
  function weatherOf(s, day) { return s.weather[day] || "sun"; }

  // ---- 倉庫
  function wareTotal(s) { var n = 0; for (var k in s.ware) n += s.ware[k]; return n; }
  function have(s, map) { for (var k in map) if ((s.ware[k] || 0) < map[k]) return false; return true; }
  function take(s, map) { for (var k in map) { s.ware[k] = (s.ware[k] || 0) - map[k]; if (!s.ware[k]) delete s.ware[k]; } }
  function give(s, map) { for (var k in map) if (map[k] > 0) s.ware[k] = (s.ware[k] || 0) + map[k]; }
  function one(k, n) { var o = {}; o[k] = n; return o; }

  function shuffled(s, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = rint(s, i + 1), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  function newGame(opt) {
    var s = {
      v: 1, seed: opt.seed | 0, rs: opt.seed | 0,
      day: 1, phase: "plan", min: D.DAY_START, cash: D.START_CASH, rep: 0, fee: D.ENTRY_FEE,
      tiles: [], occ: [], structs: {}, nextId: 1, mapVer: 1,
      ware: {}, machines: [], guests: [], nextGid: 1,
      weather: [], wishes: [], nextWish: 1,
      dirt: 0, today: null, history: [], photos: [],
    };
    for (var i = 0; i < M.W * M.H; i++) { s.tiles.push(0); s.occ.push(0); }
    for (var x = 0; x < M.SHRINE.x; x++) s.tiles[ti(x, M.GATE.y)] = 1;
    place(s, "shrine", M.SHRINE.x, M.SHRINE.y);
    give(s, D.START_WARE);
    D.START_MACHINES.forEach(function (m) {
      var rid = null;
      for (var r in D.RECIPES) if (D.RECIPES[r].m === m) { rid = r; break; }
      s.machines.push({ type: m, rid: rid, t: null });
    });
    var wl = Object.keys(D.WEATHER).map(function (k) { return { id: k, w: D.WEATHER[k].w }; });
    s.weather.push("sun");
    for (var d = 1; d <= D.SEASON_DAYS; d++) s.weather.push(pickW(s, wl).id);
    s.photos = shuffled(s, D.PHOTOS);
    return s;
  }

  function place(s, type, x, y) {
    var b = D.BUILD[type], sid = s.nextId++;
    s.structs[sid] = {
      id: sid, type: type, x: x, y: y, wear: 0, broken: false, price: b.price || 0, q: [], riders: [], t: 0, fixes: 0,
      build: b.days || 0, mods: {}, ticket: false, link: null, waitSum: 0, waitN: 0, lastWait: 0,
    };
    for (var yy = y; yy < y + b.h; yy++) for (var xx = x; xx < x + b.w; xx++) s.occ[ti(xx, yy)] = sid;
    s.mapVer++;
    return sid;
  }

  function nearRide(s, pos) {
    var best = 0, bd = 1e9;
    for (var k in s.structs) {
      var st = s.structs[k];
      if (D.BUILD[st.type].kind !== "ride") continue;
      var e = entranceOf(st), d = Math.abs(e.x - pos.x) + Math.abs(e.y - pos.y);
      if (d <= D.QSTALL_RANGE && d < bd) { bd = d; best = st.id; }
    }
    return best;
  }

  function canBuild(s, type, x, y) {
    var b = D.BUILD[type];
    if (!b || type === "shrine") return { ok: false, err: "bounds" };
    if (s.phase !== "plan") return { ok: false, err: "phase" };
    if (popLevel(s) < b.lv) return { ok: false, err: "level" };
    if (!inMap(x, y) || !inMap(x + b.w - 1, y + b.h - 1)) return { ok: false, err: "bounds" };
    if (x + b.w > M.UNLOCK_X) return { ok: false, err: "locked" };
    for (var yy = y; yy < y + b.h; yy++) for (var xx = x; xx < x + b.w; xx++) {
      if (s.occ[ti(xx, yy)] || s.tiles[ti(xx, yy)] === 1) return { ok: false, err: "occupied" };
    }
    var e = { x: x + Math.floor(b.w / 2), y: y + b.h };
    if (!isPath(s, e.x, e.y) || s.occ[ti(e.x, e.y)]) return { ok: false, err: "entrance" };
    if (b.kind === "qstall" && !nearRide(s, e)) return { ok: false, err: "noride" };
    if (!have(s, b.parts)) return { ok: false, err: "parts" };
    if (s.cash < b.cash) return { ok: false, err: "cash" };
    return { ok: true, err: null };
  }

  function build(s, type, x, y) {
    var c = canBuild(s, type, x, y);
    if (!c.ok) return c;
    var b = D.BUILD[type];
    take(s, b.parts);
    s.cash -= b.cash;
    var sid = place(s, type, x, y);
    if (b.kind === "qstall") s.structs[sid].link = nearRide(s, entranceOf(s.structs[sid]));
    return { ok: true, err: null, sid: sid };
  }

  function demolish(s, sid) {
    var st = s.structs[sid];
    if (!st || st.type === "shrine" || s.phase !== "plan") return false;
    var b = D.BUILD[st.type];
    for (var yy = st.y; yy < st.y + b.h; yy++) for (var xx = st.x; xx < st.x + b.w; xx++) s.occ[ti(xx, yy)] = 0;
    s.cash += Math.floor(b.cash * D.REFUND);
    if (st.build > 0) for (var k in b.parts) give(s, one(k, Math.floor(b.parts[k] * D.REFUND)));
    delete s.structs[sid];
    for (var j in s.structs) if (s.structs[j].link === sid) s.structs[j].link = null;
    s.mapVer++;
    return true;
  }

  function isEntranceTile(s, x, y) {
    for (var k in s.structs) { var e = entranceOf(s.structs[k]); if (e.x === x && e.y === y) return true; }
    return false;
  }

  function setPath(s, x, y, on) {
    if (s.phase !== "plan" || !inMap(x, y) || x >= M.UNLOCK_X) return false;
    var i = ti(x, y);
    if (s.occ[i]) return false;
    if (on) {
      if (s.tiles[i] === 1 || s.cash < D.PATH_COST) return false;
      s.tiles[i] = 1; s.cash -= D.PATH_COST;
    } else {
      if (s.tiles[i] !== 1 || isEntranceTile(s, x, y) || (y === M.GATE.y && x === M.GATE.x)) return false;
      s.tiles[i] = 0;
    }
    s.mapVer++;
    return true;
  }

  function buy(s, item, n) {
    var it = D.ITEMS[item];
    if (!it || it.kind !== "mat" || n <= 0 || s.phase !== "plan") return false;
    if (s.cash < it.buy * n || wareTotal(s) + n > D.WARE_CAP) return false;
    s.cash -= it.buy * n;
    give(s, one(item, n));
    return true;
  }

  function addMachine(s, type) {
    var m = D.MACHINES[type];
    if (!m || s.phase !== "plan" || s.machines.length >= machineSlots(s) || s.cash < m.cost) return false;
    s.cash -= m.cost;
    s.machines.push({ type: type, rid: null, t: null });
    return true;
  }

  function setRecipe(s, mi, rid) {
    var m = s.machines[mi], r = D.RECIPES[rid];
    if (!m || !r || r.m !== m.type) return false;
    m.rid = rid; m.t = null;
    return true;
  }

  function setPrice(s, sid, price) {
    var st = s.structs[sid];
    if (!st || D.BUILD[st.type].kind !== "ride" || price < 0 || price > 2000) return false;
    st.price = Math.round(price / 10) * 10;
    return true;
  }

  function setFee(s, fee) {
    if (s.phase !== "plan" || fee < 0 || fee > 2000) return false;
    s.fee = Math.round(fee / 10) * 10;
    return true;
  }

  function serialize(s) { return JSON.stringify(s); }
  function restore(str) {
    try { var s = JSON.parse(str); return s && s.v === 1 ? s : null; } catch (e) { return null; }
  }

  window.PriTestEnnichiCore = {
    rnd: rnd, rint: rint, pickW: pickW, ti: ti, inMap: inMap, isPath: isPath, entranceOf: entranceOf,
    popLevel: popLevel, machineSlots: machineSlots, weatherOf: weatherOf,
    wareTotal: wareTotal, have: have, take: take, give: give, nearRide: nearRide,
    newGame: newGame, canBuild: canBuild, build: build, demolish: demolish, setPath: setPath,
    buy: buy, addMachine: addMachine, setRecipe: setRecipe, setPrice: setPrice, setFee: setFee,
    serialize: serialize, restore: restore,
  };
})();
```

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/ennichi_core.js && node tools/ennichi_check/core_check.js`
Expected: `1.`、`2.` OK

- [ ] **Step 5: Commit**

```bash
git add static_src/ennichi_core.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 核心——新局、天氣表、地圖與建造（組裝期、排隊屋台連結）、倉庫、市場、存檔"
```

---

### Task 4: 工房生產

**Files:**
- Modify: `static_src/ennichi_core.js`、`tools/ennichi_check/core_check.js`

**Interfaces:**
- Produces: `Core.workshopStep(s)`：每遊戲分鐘一次。每台機器每分鐘只做一件事：待機（`t === null`）且有配方、原料足夠、倉庫放得下（`wareTotal − 輸入 + 產出 ≤ WARE_CAP`）→ 扣原料、`t = 0`；加工中 → `t++`，`t ≥ r.t` → 產出進倉庫、`s.today.made[產物] += n`（`s.today` 為 null 時不記）、`t = null`。

- [ ] **Step 1: 追加失敗的測試**

```js
// ---------------- 3. 工房 ----------------
(function () {
  var s = Core.newGame({ seed: 3 });
  s.ware = { wood: 2, iron: 1 };
  s.machines = [{ type: "saw", rid: "plank", t: null }, { type: "press", rid: "sheet", t: null }, { type: "weld", rid: "frame", t: null }];
  s.today = { made: {} };
  Core.workshopStep(s);
  assert.strictEqual(s.ware.wood, 1); assert.strictEqual(s.machines[0].t, 0);
  assert.strictEqual(s.machines[2].t, null, "焊接台缺料不開工");
  for (var i = 0; i < 3; i++) Core.workshopStep(s);
  assert.strictEqual(s.ware.plank, 2, "3 分鐘後產出 2 木板"); assert.strictEqual(s.today.made.plank, 2);
  assert.strictEqual(s.machines[0].t, null, "產出那一分鐘歸零待機");
  Core.workshopStep(s);
  assert.strictEqual(s.machines[0].t, 0, "下一分鐘取第 2 根原木"); assert.strictEqual(s.ware.wood || 0, 0);
  // 三層：木板 → 雕刻木件 → 彩繪唐獅子
  var t = Core.newGame({ seed: 4 });
  t.ware = { plank: 4, paint: 1 }; t.today = { made: {} };
  t.machines = [{ type: "carve", rid: "carving", t: null }, { type: "lacquer", rid: "lion", t: null }];
  for (i = 0; i < 30; i++) Core.workshopStep(t);
  assert.strictEqual(t.ware.lion, 1, "兩個雕刻木件＋彩漆 → 彩繪唐獅子");
  // 倉庫滿了不開工
  var u = Core.newGame({ seed: 5 });
  u.ware = { wood: D.WARE_CAP }; u.machines = [{ type: "saw", rid: "plank", t: null }];
  Core.workshopStep(u);
  assert.strictEqual(u.machines[0].t, null, "放不下產出就不開工");
  console.log("3. 工房 OK");
})();
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: FAIL（`Core.workshopStep is not a function`）

- [ ] **Step 3: 實作**

在 `ennichi_core.js` 的 `serialize` 之前加入，並加進匯出物件（`workshopStep: workshopStep,`）：

```js
  // ---- 工房：每遊戲分鐘一次。每台機器每分鐘只做一件事（待機→取料開工／加工中→推進、完成產出）
  function workshopStep(s) {
    s.machines.forEach(function (m) {
      var r = m.rid && D.RECIPES[m.rid];
      if (!r) return;
      if (m.t === null) {
        var inN = 0, outN = 0, k;
        for (k in r.in) inN += r.in[k];
        for (k in r.out) outN += r.out[k];
        if (have(s, r.in) && wareTotal(s) - inN + outN <= D.WARE_CAP) { take(s, r.in); m.t = 0; }
        return;
      }
      m.t++;
      if (m.t >= r.t) {
        give(s, r.out);
        if (s.today) for (var o in r.out) s.today.made[o] = (s.today.made[o] || 0) + r.out[o];
        m.t = null;
      }
    });
  }
```

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/ennichi_core.js && node tools/ennichi_check/core_check.js`
Expected: `3. 工房 OK`

- [ ] **Step 5: Commit**

```bash
git add static_src/ennichi_core.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 工房生產（倉庫取料、加工、產出）"
```

---

### Task 5: 模組改裝與實際數值

**Files:**
- Modify: `static_src/ennichi_core.js`、`tools/ennichi_check/core_check.js`

**Interfaces:**
- Produces:
  - `Core.effStats(st) -> { thrill, charm, photo, price, wearMul }`：基本值＋已裝改裝的 `eff`（`price` 為 `st.price` 加總、`wearMul` 相乘）。Sim 的偏好、票價、磨損一律讀這個。
  - `Core.upgrade(s, sid, slot) -> bool`：開園前、完工、該槽存在且未裝、倉庫有 `slot.mod × slot.n` → 扣模組、`st.mods[slot] = 1`。

- [ ] **Step 1: 追加失敗的測試**

```js
// ---------------- 4. 模組改裝 ----------------
function finishAll(s) { for (var k in s.structs) s.structs[k].build = 0; }
(function () {
  var s = Core.newGame({ seed: 8 });
  Core.give(s, D.BUILD.merry.parts);
  var merry = s.structs[Core.build(s, "merry", 4, 6).sid];
  Core.give(s, { nightLanterns: 2, fastTurntable: 1 });
  assert.ok(!Core.upgrade(s, merry.id, "light"), "施工中不能改裝");
  finishAll(s);
  var base = Core.effStats(merry);
  assert.deepStrictEqual(base, { thrill: 1, charm: 3, photo: 2, price: 300, wearMul: 1 });
  assert.ok(!Core.upgrade(s, merry.id, "deco"), "沒有金箔唐獅子");
  assert.ok(!Core.upgrade(s, merry.id, "nope"), "沒有這個槽");
  assert.ok(Core.upgrade(s, merry.id, "light"));
  assert.ok(!s.ware.nightLanterns, "用掉 2 個夜光燈籠串");
  assert.ok(!Core.upgrade(s, merry.id, "light"), "同一槽只能裝一次");
  assert.ok(Core.upgrade(s, merry.id, "drive"));
  var e = Core.effStats(merry);
  assert.deepStrictEqual(e, { thrill: 2, charm: 4, photo: 3, price: 300, wearMul: 1.5 });
  merry.price = 400; assert.strictEqual(Core.effStats(merry).price, 400);
  Core.give(s, { goldLion: 2 }); assert.ok(Core.upgrade(s, merry.id, "deco"));
  assert.strictEqual(Core.effStats(merry).price, 450, "金箔唐獅子 票價 +50");
  // 營業中不能改裝：另蓋一座咖啡杯、完工後在營業中嘗試
  Core.give(s, D.BUILD.cups.parts);
  var cups = s.structs[Core.build(s, "cups", 16, 7).sid];
  finishAll(s); Core.give(s, { fastTurntable: 1 });
  s.phase = "open";
  assert.ok(!Core.upgrade(s, cups.id, "drive"), "營業中不能改裝");
  s.phase = "plan";
  assert.ok(Core.upgrade(s, cups.id, "drive"));
  console.log("4. 模組改裝 OK");
})();
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: FAIL（`Core.upgrade is not a function`）

- [ ] **Step 3: 實作**

加入 `ennichi_core.js` 並匯出 `effStats`、`upgrade`：

```js
  // ---- 改裝：大型設施的改裝槽（規格 §4.6）
  function effStats(st) {
    var b = D.BUILD[st.type];
    var e = { thrill: b.thrill || 0, charm: b.charm || 0, photo: b.photo || 0, price: st.price || 0, wearMul: 1 };
    for (var sl in st.mods) {
      var f = b.slots[sl].eff;
      for (var k in f) {
        if (k === "wearMul") e.wearMul *= f[k];
        else e[k] += f[k];
      }
    }
    return e;
  }

  function upgrade(s, sid, slot) {
    var st = s.structs[sid], b = st && D.BUILD[st.type], sl = b && b.slots && b.slots[slot];
    if (!sl || s.phase !== "plan" || st.build > 0 || st.mods[slot]) return false;
    var need = one(sl.mod, sl.n);
    if (!have(s, need)) return false;
    take(s, need);
    st.mods[slot] = 1;
    return true;
  }
```

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/ennichi_core.js && node tools/ennichi_check/core_check.js`
Expected: `4. 模組改裝 OK`

- [ ] **Step 5: Commit**

```bash
git add static_src/ennichi_core.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 大型設施的模組改裝與實際數值 effStats"
```

---

### Task 6: 客人——生成、需求、尋路、選目的地

**Files:**
- Modify: `static_src/ennichi_sim.js`（整檔寫入）、`tools/ennichi_check/core_check.js`

**Interfaces:**
- Consumes: `Core.rnd/rint/pickW/ti/inMap/isPath/entranceOf/effStats/weatherOf`、`D.*`
- Produces（`window.PriTestEnnichiSim`）：
  - `distField(s, key) -> Int16Array`（`"gate"` 或 sid；`s.mapVer` 快取，不進存檔）
  - `isWeekend(day)`（`day % 7` 為 6 或 0）、`arrivals(s)`＝`round((30 + rep × 0.6) × 週末1.8 × 天氣.arrive)`、`spawnSchedule(s)`
  - `spawn(s) -> Guest`（扣入園費；`need.dry = 0`、`kasa = false`、`ticket = null`）
  - `kindOf(st)`：ride／shrine／qstall／deco；stall 依 `sells[0]`：food→`"food"`、drink→`"drink"`、`umbrella`→`"kasa"`、其他 goods→`"goods"`；facility → `serves`
  - `guestType(g)`、`prefScore(g, st)`（ride／shrine 用 `effStats`；goods 攤位用拍照偏好；其他 1）
  - `urgentNeed(g)`（最大值；全部 < 30 → `"fun"`）
  - `isOpen(s, st)`：`build === 0`、不是 `broken`、不在 `s.today.closed`
  - `choose(s, g) -> sid|null`（只選 `isOpen` 的；score＝偏好×50 − 距離×1.5 − 排隊×3 + rnd×10）
  - `moveToward(s, g, key) -> bool`、`needsTick(s, g)`（Task 8 改寫加入天氣）

- [ ] **Step 1: 追加失敗的測試**

```js
// ---------------- 5. 客人：生成、尋路、選目的地 ----------------
var Sim = window.PriTestEnnichiSim;
function freshPark(seed) {
  var s = Core.newGame({ seed: seed || 11 });
  Core.give(s, D.BUILD.merry.parts);
  Core.build(s, "merry", 4, 6);         // 入口 (6,10)
  Core.build(s, "takoyakiSt", 10, 8);   // 入口 (11,10)
  Core.build(s, "bench", 14, 9);        // 入口 (14,10)
  finishAll(s);
  return s;
}
function sidOf(s, type) { return +Object.keys(s.structs).filter(function (k) { return s.structs[k].type === type; })[0]; }
(function () {
  var s = freshPark();
  var gate = Sim.distField(s, "gate");
  assert.strictEqual(gate[Core.ti(5, 10)], 5); assert.strictEqual(gate[Core.ti(5, 5)], -1);
  assert.strictEqual(Sim.distField(s, sidOf(s, "merry"))[Core.ti(0, 10)], 6);
  assert.strictEqual(Sim.distField(s, "gate"), gate, "快取");
  Core.setPath(s, 3, 11, true); assert.notStrictEqual(Sim.distField(s, "gate"), gate, "改地圖後重算");
  // 來客數（第 1 天的天氣依種子而定 → 固定成晴天檢查公式）
  s.weather[1] = "sun"; assert.strictEqual(Sim.arrivals(s), 30);
  s.weather[1] = "rain"; assert.strictEqual(Sim.arrivals(s), Math.round(30 * 0.6));
  s.day = 6; s.weather[6] = "sun"; s.rep = 100; assert.strictEqual(Sim.arrivals(s), Math.round(90 * 1.8));
  s.day = 1; s.rep = 0; s.weather[1] = "sun";
  var sch = Sim.spawnSchedule(s);
  assert.strictEqual(sch.length, 30);
  assert.ok(sch.every(function (m, i) { return m >= D.DAY_START && m <= D.LAST_ENTRY && (i === 0 || m >= sch[i - 1]); }));
  s.today = { guests: 0, fees: 0, rev: 0, murmurs: [], topics: {}, closed: [], sales: {} };
  var cash = s.cash, g = Sim.spawn(s);
  assert.deepStrictEqual([g.x, g.y], [0, 10]); assert.strictEqual(s.cash, cash + s.fee);
  assert.strictEqual(g.need.dry, 0); assert.strictEqual(g.kasa, false);
  g.need = { fun: 0, hunger: 90, thirst: 0, toilet: 0, fatigue: 0, dry: 0 };
  assert.strictEqual(s.structs[Sim.choose(s, g)].type, "takoyakiSt");
  g.need = { fun: 0, hunger: 0, thirst: 0, toilet: 0, fatigue: 90, dry: 0 };
  assert.strictEqual(s.structs[Sim.choose(s, g)].type, "bench");
  g.need = { fun: 0, hunger: 0, thirst: 90, toilet: 0, fatigue: 0, dry: 0 };
  assert.strictEqual(Sim.choose(s, g), null, "沒有汽水攤");
  // 施工中、停駛的不選
  g.need = { fun: 90, hunger: 0, thirst: 0, toilet: 0, fatigue: 0, dry: 0 };
  s.structs[sidOf(s, "merry")].build = 1;
  assert.strictEqual(s.structs[Sim.choose(s, g)].type, "shrine", "旋轉木馬施工中 → 只能去參拜");
  s.structs[sidOf(s, "merry")].build = 0; s.today.closed = ["merry"];
  assert.strictEqual(s.structs[Sim.choose(s, g)].type, "shrine", "停駛中");
  s.today.closed = [];
  g.need = { fun: 0, hunger: 90, thirst: 0, toilet: 0, fatigue: 0, dry: 0 };
  g.sid = Sim.choose(s, g);
  assert.ok(!Sim.moveToward(s, g, g.sid)); assert.strictEqual(g.x, 2);
  for (var i = 0; i < 10 && !Sim.moveToward(s, g, g.sid); i++);
  assert.deepStrictEqual([g.x, g.y], [11, 10]);
  var h = g.need.hunger; Sim.needsTick(s, g); assert.ok(g.need.hunger > h);
  console.log("5. 客人（生成、尋路、選目的地）OK");
})();
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: FAIL（`Cannot read properties of undefined (reading 'distField')`）

- [ ] **Step 3: 實作**

`static_src/ennichi_sim.js`：

```js
// ============================================================================
// 緣日樂園：客人模擬（固定步長，1 次 = 1 遊戲分鐘；只用 Core.rnd 取亂數，可重播）。
//   生成、需求、尋路（步道上的距離場）、選目的地（Task 6）
//   排隊、搭乘、攤位、設施、故障、髒亂、離場、step（Task 7）；天氣（Task 8）；排隊屋台、整理券（Task 9）
// ============================================================================
(function () {
  "use strict";
  var D = window.PriTestEnnichiData, Core = window.PriTestEnnichiCore, M = D.MAP;
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var cache = { ver: -1, s: null, f: {} };

  function targetOf(s, key) {
    if (key === "gate") return M.GATE;
    var st = s.structs[key];
    return st ? Core.entranceOf(st) : null;
  }

  // 從目標格沿步道做 BFS；客人往距離較小的鄰格走就會到達
  function distField(s, key) {
    if (cache.s !== s || cache.ver !== s.mapVer) cache = { ver: s.mapVer, s: s, f: {} };
    if (cache.f[key]) return cache.f[key];
    var f = new Int16Array(M.W * M.H);
    for (var i = 0; i < f.length; i++) f[i] = -1;
    var t = targetOf(s, key);
    if (t && Core.isPath(s, t.x, t.y)) {
      var qx = [t.x], qy = [t.y], h = 0;
      f[Core.ti(t.x, t.y)] = 0;
      while (h < qx.length) {
        var x = qx[h], y = qy[h++], d = f[Core.ti(x, y)];
        for (var k = 0; k < 4; k++) {
          var nx = x + DIRS[k][0], ny = y + DIRS[k][1];
          if (Core.isPath(s, nx, ny) && f[Core.ti(nx, ny)] < 0) { f[Core.ti(nx, ny)] = d + 1; qx.push(nx); qy.push(ny); }
        }
      }
    }
    cache.f[key] = f;
    return f;
  }

  function isWeekend(day) { var w = day % 7; return w === 6 || w === 0; }
  function arrivals(s) {
    var w = D.WEATHER[Core.weatherOf(s, s.day)];
    return Math.round((30 + s.rep * 0.6) * (isWeekend(s.day) ? 1.8 : 1) * w.arrive);
  }
  function spawnSchedule(s) {
    var n = arrivals(s), out = [];
    for (var i = 0; i < n; i++) out.push(D.DAY_START + Core.rint(s, D.LAST_ENTRY - D.DAY_START + 1));
    return out.sort(function (a, b) { return a - b; });
  }

  function spawn(s) {
    var gt = Core.pickW(s, D.GUESTS), id = s.nextGid++;
    var g = {
      id: id, type: gt.id, outfit: Core.rint(s, D.OUTFITS), photo: s.photos[id % s.photos.length],
      x: M.GATE.x, y: M.GATE.y, state: "walk", sid: null,
      need: { fun: Core.rint(s, 30), hunger: Core.rint(s, 30), thirst: Core.rint(s, 30), toilet: Core.rint(s, 30), fatigue: Core.rint(s, 30), dry: 0 },
      hap: 60, cash: gt.cash[0] + Core.rint(s, gt.cash[1] - gt.cash[0] + 1), patience: gt.patience,
      wait: 0, t: 0, leaving: false, spent: 0, rides: 0, kasa: false, ticket: null,
    };
    s.cash += s.fee; g.cash -= s.fee;
    if (s.today) { s.today.fees += s.fee; s.today.guests++; }
    s.guests.push(g);
    return g;
  }

  function kindOf(st) {
    var b = D.BUILD[st.type];
    if (b.kind === "stall") {
      var it = D.ITEMS[b.sells[0]];
      if (it.kind === "food" || it.kind === "drink") return it.kind;
      return it.umbrella ? "kasa" : "goods";
    }
    if (b.kind === "facility") return b.serves;
    return b.kind;
  }

  function guestType(g) { for (var i = 0; i < D.GUESTS.length; i++) if (D.GUESTS[i].id === g.type) return D.GUESTS[i]; return D.GUESTS[0]; }

  function prefScore(g, st) {
    var b = D.BUILD[st.type], p = guestType(g).pref;
    if (b.kind === "ride" || b.kind === "shrine") {
      var e = b.kind === "ride" ? Core.effStats(st) : { thrill: 0, charm: 0, photo: b.photo };
      return (e.thrill * p.thrill + e.charm * p.charm + e.photo * p.photo) / 3;
    }
    if (kindOf(st) === "goods") return 0.5 + p.photo;
    return 1;
  }

  function urgentNeed(g) {
    var best = "fun", v = -1;
    for (var k in g.need) if (g.need[k] > v) { v = g.need[k]; best = k; }
    return v < 30 ? "fun" : best;
  }

  function isOpen(s, st) {
    return st.build === 0 && !st.broken && !(s.today && s.today.closed.indexOf(st.type) >= 0);
  }

  function choose(s, g) {
    var need = urgentNeed(g), kinds = D.NEED_TO[need], best = null, bestScore = -1e9;
    for (var k in s.structs) {
      var st = s.structs[k];
      if (!isOpen(s, st) || kinds.indexOf(kindOf(st)) < 0) continue;
      var d = distField(s, k)[Core.ti(g.x, g.y)];
      if (d < 0) continue;
      var score = prefScore(g, st) * 50 - d * 1.5 - st.q.length * 3 + Core.rnd(s) * 10;
      if (score > bestScore) { bestScore = score; best = st.id; }
    }
    return best;
  }

  function moveToward(s, g, key) {
    var f = distField(s, key);
    for (var step = 0; step < D.GUEST_SPEED; step++) {
      var d = f[Core.ti(g.x, g.y)];
      if (d === 0) return true;
      if (d < 0) return false;
      for (var k = 0; k < 4; k++) {
        var nx = g.x + DIRS[k][0], ny = g.y + DIRS[k][1];
        if (Core.inMap(nx, ny) && f[Core.ti(nx, ny)] === d - 1) { g.x = nx; g.y = ny; break; }
      }
    }
    return f[Core.ti(g.x, g.y)] === 0;
  }

  function needsTick(s, g) {
    for (var k in D.NEED_RATE) g.need[k] = Math.min(100, g.need[k] + D.NEED_RATE[k]);
    if (g.state === "walk") g.need.fatigue = Math.min(100, g.need.fatigue + 0.05);
    g.hap = Math.max(0, Math.min(100, g.hap - s.dirt * 0.002));
  }

  window.PriTestEnnichiSim = {
    distField: distField, isWeekend: isWeekend, arrivals: arrivals, spawnSchedule: spawnSchedule, spawn: spawn,
    kindOf: kindOf, guestType: guestType, prefScore: prefScore, urgentNeed: urgentNeed, isOpen: isOpen,
    choose: choose, moveToward: moveToward, needsTick: needsTick,
  };
})();
```

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/ennichi_sim.js && node tools/ennichi_check/core_check.js`
Expected: `5. 客人（生成、尋路、選目的地）OK`

- [ ] **Step 5: Commit**

```bash
git add static_src/ennichi_sim.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 客人生成、需求、步道尋路與選目的地"
```

---

### Task 7: 排隊、搭乘、攤位、設施、故障、髒亂、離場＋murmur

**Files:**
- Modify: `static_src/ennichi_murmur.js`（整檔寫入）、`static_src/ennichi_sim.js`、`tools/ennichi_check/core_check.js`

**Interfaces:**
- Produces:
  - `window.PriTestEnnichiMurmur`：`TYPES`（9 類，與樣本頁 `en_mm_*` 一致）、`TEMPLATES`、`say(s, g, type, topic, ctx) -> Murmur|null`、`topTopics(s, n)`
  - `Sim.step(s)`（一遊戲分鐘：生客 → 遊樂設施運轉 → 排隊屋台（Task 9 加入）→ 客人行動 → 移除離場者）
  - `Sim.rideStep(s, st)`、`Sim.buyAt(s, g, st)`、`Sim.arrive(s, g)`、`Sim.breakDown(s, st)`、`Sim.byId(s, gid)`
  - 搭乘結束：`fun −= 45 + 10×偏好`、`hap += 6 + 8×偏好 − 4×min(1, wait/patience)`、25% impression、拍照派且實際 `photo ≥ 2` 且 `hap > 75` 時 30% sns；`wear += def.wear × effStats.wearMul`；`wear ≥ 100` → `breakDown`
  - 上車：依 `effStats(st).price` 收票價；`st.waitSum += g.wait`、`st.waitN++`
  - 攤位：倉庫有貨且付得起 → 售出（`today.sales[item]++`、`fill` 套用、`umbrella` → `g.kasa = true`）；繪馬與 sales 對繪馬許願的呼叫在 Task 10 加入
  - 其他規則同下方程式

- [ ] **Step 1: 追加失敗的測試**

```js
// ---------------- 6. 排隊、搭乘、攤位、故障、murmur ----------------
var Murmur = window.PriTestEnnichiMurmur;
function openToday(s) {
  s.phase = "open"; s.min = D.DAY_START;
  s.today = { guests: 0, left: 0, rev: 0, fees: 0, hapSum: 0, hapN: 0, sns: 0, made: {}, sales: {}, spawn: [], murmurs: [], topics: {}, weather: "cloud", closed: [], wishesDone: 0 };
}
function walker(s, x, y, sid, need) {
  var g = Sim.spawn(s); g.cash = 5000; g.x = x; g.y = y; g.sid = sid;
  g.need = { fun: 0, hunger: 0, thirst: 0, toilet: 0, fatigue: 0, dry: 0 };
  for (var k in need) g.need[k] = need[k];
  return g;
}
(function () {
  var s = freshPark(21); openToday(s);
  var g = Sim.spawn(s);
  var m = Murmur.say(s, g, "complaint", "queue", { ride: D.BUILD.merry.name });
  assert.ok(m.text.zh.length > 0 && m.text.zh.indexOf("{") < 0, "範本的變數都有換掉");
  assert.strictEqual(s.today.topics.queue, 1); assert.deepStrictEqual(Murmur.topTopics(s, 1), [["queue", 1]]);
  // 搭乘
  var merry = s.structs[sidOf(s, "merry")];
  g = walker(s, 6, 10, merry.id, { fun: 90 });
  Sim.step(s); assert.strictEqual(g.state, "queue", "先排隊（設施在客人之前處理）");
  Sim.step(s); assert.strictEqual(g.state, "ride", "下一分鐘上車");
  assert.strictEqual(merry.waitN, 1);
  for (var i = 0; i < D.BUILD.merry.cycle; i++) Sim.step(s);
  assert.strictEqual(g.state, "walk"); assert.ok(g.need.fun < 90); assert.strictEqual(g.rides, 1);
  assert.strictEqual(merry.wear, D.BUILD.merry.wear);
  assert.ok(s.today.rev >= merry.price);
  // 改裝過的磨損倍率
  merry.mods.drive = 1; merry.wear = 0;
  var g3 = walker(s, 6, 10, merry.id, { fun: 90 });
  for (i = 0; i < 2 + D.BUILD.merry.cycle; i++) Sim.step(s);
  assert.strictEqual(merry.wear, D.BUILD.merry.wear * 1.5, "高速迴轉台 磨損 ×1.5");
  delete merry.mods.drive;
  // 故障
  merry.wear = 99; merry.riders = []; merry.t = 0;
  g = walker(s, 6, 10, merry.id, { fun: 90 }); g.state = "queue"; merry.q = [g.id];
  var g2 = walker(s, 6, 10, merry.id, { fun: 90 });
  Sim.step(s);
  for (i = 0; i < D.BUILD.merry.cycle; i++) Sim.step(s);
  assert.ok(merry.broken); assert.strictEqual(merry.q.length, 0); assert.notStrictEqual(g2.state, "queue");
  // 攤位
  var t = freshPark(22); openToday(t);
  var c = walker(t, 11, 10, sidOf(t, "takoyakiSt"), { hunger: 90 });
  t.ware.takoyaki = 1;
  Sim.step(t);
  assert.strictEqual(t.ware.takoyaki || 0, 0); assert.ok(c.need.hunger < 90);
  assert.strictEqual(t.today.rev, D.ITEMS.takoyaki.sell); assert.strictEqual(t.today.sales.takoyaki, 1);
  assert.ok(t.dirt >= 1, "附近沒有垃圾桶 → 髒亂");
  var c2 = walker(t, 11, 10, sidOf(t, "takoyakiSt"), { hunger: 90 });
  var hap = c2.hap; Sim.step(t); assert.ok(c2.hap < hap, "賣完了心情下降");
  // 排隊太久
  var u = freshPark(23); openToday(u);
  var mm = u.structs[sidOf(u, "merry")]; mm.riders = [999]; mm.t = 50;
  var w = walker(u, 6, 10, mm.id, { fun: 90 });
  for (i = 0; i <= w.patience + 1; i++) Sim.step(u);
  assert.strictEqual(mm.q.indexOf(w.id), -1, "超過耐心離隊");
  // 離場
  u.min = D.DAY_END;
  for (i = 0; i < 40 && u.guests.length; i++) { Sim.step(u); u.min++; }
  assert.strictEqual(u.guests.length, 0); assert.ok(u.today.hapN >= 1);
  console.log("6. 搭乘、攤位、故障、murmur OK");
})();
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: FAIL（`Cannot read properties of undefined (reading 'say')`）

- [ ] **Step 3: murmur 模組**

`static_src/ennichi_murmur.js`：

```js
// ============================================================================
// 緣日樂園：murmur（客人的碎碎念，規格 §5.4）。範本依「類型＋話題」挑選，變數：{ride} {food} {item}。
// 文字以 C(zh, ja) 保存；今日話題 = s.today.topics 的計數（打烊後列前三名）。
// ============================================================================
(function () {
  "use strict";
  var D = window.PriTestEnnichiData, C = D.C;
  var TYPES = ["impression", "complaint", "need", "recommend", "sns", "gossip", "season", "love", "rival"];
  var T = {
    impression: {
      _: [C("{ride}好好玩！", "{ride}楽しかった！"), C("{ride}的燈好漂亮……", "{ride}の灯り、きれい……"), C("還想再坐一次{ride}", "もう一回{ride}乗りたい")],
      shrine: [C("參拜完心情好平靜", "お参りしたら落ち着いた"), C("本殿好有氣氛", "本殿、雰囲気あるね")],
      omikuji: [C("抽到大吉了！", "大吉だった！"), C("……是小凶，有點在意", "……小凶。ちょっと気になる")],
      ticket: [C("拿了整理券，先去逛別的", "整理券もらったから先に他を回ろう")],
      qstall: [C("排隊的時候還能買汽水，好貼心", "並んでる間にラムネ買えるの助かる")],
      kasa: [C("買了和傘，雨天也很有氣氛", "和傘買った、雨の日もいい感じ")],
    },
    complaint: {
      queue: [C("{ride}排了好久……不排了", "{ride}、並びすぎ……もういいや"), C("隊伍都沒在動耶", "列が全然進まない")],
      broken: [C("{ride}突然停了！？", "{ride}止まっちゃった！？"), C("故障了啦，好可惜", "故障だって、残念")],
      expensive: [C("{ride}好貴……", "{ride}高いなあ……")],
      soldout: [C("{food}賣完了……", "{food}売り切れ……"), C("想吃的都沒了", "食べたいもの全部売り切れ")],
      litter: [C("垃圾桶好少，竹籤要丟哪", "ゴミ箱少なすぎ、串どこに捨てるの"), C("地上好多垃圾……", "地面にゴミが……")],
      wind: [C("今天風太大，{ride}停駛了", "今日は風が強くて{ride}運休だって")],
      rain: [C("雨好大，都沒地方躲……", "雨すごいのに雨宿りする所がない……")],
    },
    need: {
      hunger: [C("肚子好餓，附近沒有吃的", "お腹すいた、食べるとこない")],
      thirst: [C("好想喝冷飲，這附近都沒有賣", "冷たい飲み物ほしい、売ってない")],
      toilet: [C("廁所在哪裡啦——", "トイレどこー！")],
      fatigue: [C("走好累，想找張長椅坐一下", "歩き疲れた、ベンチ座りたい")],
      fun: [C("好像沒什麼好玩的……", "遊ぶものあんまりないね……")],
      dry: [C("淋濕了……有沒有賣傘的地方", "濡れちゃった……傘売ってないかな")],
    },
    recommend: {
      recommend: [C("下次一定要帶朋友來！", "今度は友達も連れてくる！"), C("這裡比想像中好玩", "思ったより楽しかった")],
      wish: [C("繪馬上的願望實現了！謝謝！", "絵馬のお願い、叶った！ありがとう！")],
    },
    sns: { _: [C("#緣日樂園 {ride}拍起來超好看 ✨", "#縁日遊園 {ride}めっちゃ映える ✨"), C("#緣日樂園 {item}入手！", "#縁日遊園 {item}ゲット！")] },
  };

  function fill(c, ctx) {
    function rep(str, lang) {
      return str.replace("{ride}", ctx.ride ? ctx.ride[lang] : "").replace("{food}", ctx.food ? ctx.food[lang] : "").replace("{item}", ctx.item ? ctx.item[lang] : "");
    }
    return { zh: rep(c.zh, "zh"), ja: rep(c.ja, "ja") };
  }

  function say(s, g, type, topic, ctx) {
    if (!s.today) return null;
    var Core = window.PriTestEnnichiCore;
    var group = T[type] || {}, list = group[topic] || group._ || [C("……", "……")];
    var m = { t: s.min, day: s.day, gid: g ? g.id : 0, photo: g ? g.photo : null, type: type, topic: topic, text: fill(list[Core.rint(s, list.length)], ctx || {}) };
    s.today.murmurs.push(m);
    if (s.today.murmurs.length > 300) s.today.murmurs.shift();
    s.today.topics[topic] = (s.today.topics[topic] || 0) + 1;
    return m;
  }

  function topTopics(s, n) {
    if (!s.today) return [];
    return Object.keys(s.today.topics).map(function (k) { return [k, s.today.topics[k]]; })
      .sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); }).slice(0, n);
  }

  window.PriTestEnnichiMurmur = { TYPES: TYPES, TEMPLATES: T, say: say, topTopics: topTopics };
})();
```

- [ ] **Step 4: 模擬的 step**

在 `ennichi_sim.js` 匯出物件之前加入，並把 `step, rideStep, buyAt, arrive, breakDown, byId, chance, mm, clampHap, guestStep, finishGuest` 加進匯出：

```js
  function chance(s, p) { return Core.rnd(s) < p; }
  function mm(s, g, type, topic, ctx) { if (window.PriTestEnnichiMurmur) window.PriTestEnnichiMurmur.say(s, g, type, topic, ctx); }
  function byId(s, gid) { for (var i = 0; i < s.guests.length; i++) if (s.guests[i].id === gid) return s.guests[i]; return null; }
  function clampHap(g) { g.hap = Math.max(0, Math.min(100, g.hap)); }
  function shrineId(s) { for (var k in s.structs) if (s.structs[k].type === "shrine") return s.structs[k].id; return null; }

  function nearTrash(s, x, y) {
    for (var k in s.structs) {
      var st = s.structs[k];
      if (st.type === "trash" && st.build === 0 && Math.abs(st.x - x) + Math.abs(st.y - y) <= 5) return true;
    }
    return false;
  }

  function decoJoy(s, g) {
    var j = 0;
    for (var k in s.structs) {
      var st = s.structs[k], b = D.BUILD[st.type];
      if (b.kind === "deco" && Math.abs(st.x - g.x) <= 2 && Math.abs(st.y - g.y) <= 2) j += b.joy;
    }
    return j;
  }

  // 賣一件商品（攤位與排隊屋台共用）；回傳賣出的商品 id 或 null
  function sellOne(s, g, list) {
    for (var i = 0; i < list.length; i++) {
      var id = list[i], it = D.ITEMS[id];
      if ((s.ware[id] || 0) < 1 || g.cash < it.sell) continue;
      s.ware[id]--; if (!s.ware[id]) delete s.ware[id];
      g.cash -= it.sell; g.spent += it.sell; s.cash += it.sell; s.today.rev += it.sell;
      s.today.sales[id] = (s.today.sales[id] || 0) + 1;
      for (var n in it.fill || {}) g.need[n] = Math.max(0, g.need[n] - it.fill[n]);
      if (it.umbrella) g.kasa = true;
      g.hap += 3 + (it.joy || 0); clampHap(g);
      return id;
    }
    return null;
  }

  function buyAt(s, g, st) {
    var b = D.BUILD[st.type], id = sellOne(s, g, b.sells);
    if (!id) {
      g.hap -= 5; clampHap(g);
      if (chance(s, 0.3)) mm(s, g, "complaint", "soldout", { food: D.ITEMS[b.sells[0]].name });
      return;
    }
    var it = D.ITEMS[id];
    if (it.umbrella && chance(s, 0.3)) mm(s, g, "impression", "kasa", {});
    if (it.kind === "goods" && g.type === "photo" && chance(s, 0.3)) { mm(s, g, "sns", "goods", { item: it.name }); s.today.sns++; }
    if (it.kind === "food" || it.kind === "drink") {
      var e = Core.entranceOf(st);
      if (!nearTrash(s, e.x, e.y)) { s.dirt += 1; if (chance(s, 0.2)) mm(s, g, "complaint", "litter", {}); }
    }
  }

  function arrive(s, g) {
    var st = s.structs[g.sid];
    if (!st || !isOpen(s, st)) { g.sid = null; return; }
    var k = kindOf(st);
    if (k === "ride") {
      st.q.push(g.id); g.state = "queue"; g.wait = 0;
      return;
    }
    if (k === "shrine") {
      g.need.fun = Math.max(0, g.need.fun - 20); g.hap += 3; clampHap(g);
      if (chance(s, 0.2)) mm(s, g, "impression", "shrine", {});
    } else if (k === "food" || k === "drink" || k === "goods" || k === "kasa") buyAt(s, g, st);
    else if (k === "fatigue" || k === "shelter") { g.state = "rest"; g.t = D.BUILD[st.type].time; return; }
    else if (k === "toilet") { g.state = "toilet"; g.t = D.BUILD[st.type].time; return; }
    g.sid = null;
  }

  function breakDown(s, st) {
    st.broken = true;
    var b = D.BUILD[st.type];
    st.q.concat(st.riders).forEach(function (gid) {
      var g = byId(s, gid);
      if (!g) return;
      g.state = "walk"; g.sid = null; g.hap -= 6; clampHap(g);
      if (chance(s, 0.5)) mm(s, g, "complaint", "broken", { ride: b.name });
    });
    st.q = []; st.riders = []; st.t = 0;
  }

  function rideStep(s, st) {
    var b = D.BUILD[st.type];
    if (!isOpen(s, st)) return;
    var e = Core.effStats(st);
    if (st.t > 0) {
      st.t--;
      if (st.t > 0) return;
      st.riders.forEach(function (gid) {
        var g = byId(s, gid);
        if (!g) return;
        var p = prefScore(g, st);
        g.need.fun = Math.max(0, g.need.fun - 45 - 10 * p);
        g.hap += 6 + 8 * p - 4 * Math.min(1, g.wait / g.patience); clampHap(g);
        g.rides++; g.state = "walk"; g.sid = null;
        if (chance(s, 0.25)) mm(s, g, "impression", st.type, { ride: b.name });
        if (g.type === "photo" && e.photo >= 2 && g.hap > 75 && chance(s, 0.3)) { mm(s, g, "sns", "photo", { ride: b.name }); s.today.sns++; }
      });
      st.riders = [];
      st.wear += b.wear * e.wearMul;
      if (st.wear >= 100) { breakDown(s, st); return; }
    }
    if (!st.riders.length && st.q.length) {
      while (st.q.length && st.riders.length < b.cap) {
        var g = byId(s, st.q.shift());
        if (!g) continue;
        if (g.cash < e.price) {
          g.state = "walk"; g.sid = null; g.hap -= 4; clampHap(g);
          if (chance(s, 0.3)) mm(s, g, "complaint", "expensive", { ride: b.name });
          continue;
        }
        g.cash -= e.price; g.spent += e.price; s.cash += e.price; s.today.rev += e.price;
        st.waitSum += g.wait; st.waitN++;
        g.state = "ride"; st.riders.push(g.id);
      }
      if (st.riders.length) st.t = b.cycle;
    }
  }

  function finishGuest(s, g) {
    s.today.hapSum += g.hap; s.today.hapN++; s.today.left++;
    if (g.hap >= 80 && chance(s, 0.15)) mm(s, g, "recommend", "recommend", {});
  }

  function leaveQueue(s, g) {
    var st = s.structs[g.sid];
    if (st) st.q = st.q.filter(function (x) { return x !== g.id; });
  }

  function guestStep(s, g) {
    needsTick(s, g);
    if (!g.leaving && (s.min >= D.DAY_END || g.hap < 15 || g.need.fatigue >= 100 || g.cash < 100)) {
      g.leaving = true;
      if (g.state === "queue") { leaveQueue(s, g); g.state = "walk"; }
    }
    if (g.state === "queue") {
      g.wait++;
      if (g.wait > g.patience) {
        var st = s.structs[g.sid];
        leaveQueue(s, g);
        g.state = "walk"; g.sid = null; g.hap -= 8; clampHap(g);
        if (chance(s, 0.4)) mm(s, g, "complaint", "queue", { ride: st ? D.BUILD[st.type].name : null });
      }
      return;
    }
    if (g.state === "ride") return;
    if (g.state === "rest" || g.state === "toilet") {
      if (--g.t <= 0) {
        if (g.state === "rest") { g.need.fatigue = 0; g.need.dry = 0; } else g.need.toilet = 0;
        g.hap += 2; clampHap(g); g.state = "walk"; g.sid = null;
      }
      return;
    }
    g.hap += decoJoy(s, g); clampHap(g);
    if (g.leaving) {
      if (moveToward(s, g, "gate")) g.state = "leave";
      return;
    }
    if (!g.sid) {
      g.sid = choose(s, g);
      if (!g.sid) {
        var need = urgentNeed(g);
        if (g.need[need] >= 70) { g.hap -= 3; clampHap(g); if (chance(s, 0.3)) mm(s, g, "need", need, {}); }
        g.sid = shrineId(s); // 沒得選就去參拜
      }
    }
    if (g.sid && moveToward(s, g, g.sid)) arrive(s, g);
  }

  // 一遊戲分鐘：生客 → 遊樂設施運轉 → 客人行動 → 移除離場者
  function step(s) {
    while (s.today.spawn.length && s.today.spawn[0] <= s.min) { s.today.spawn.shift(); spawn(s); }
    for (var k in s.structs) if (D.BUILD[s.structs[k].type].kind === "ride") rideStep(s, s.structs[k]);
    s.guests.forEach(function (g) { guestStep(s, g); });
    s.guests = s.guests.filter(function (g) {
      if (g.state !== "leave") return true;
      finishGuest(s, g);
      return false;
    });
  }
```

- [ ] **Step 5: 執行確認通過**

Run: `node --check static_src/ennichi_murmur.js && node --check static_src/ennichi_sim.js && node tools/ennichi_check/core_check.js`
Expected: `6. 搭乘、攤位、故障、murmur OK`

- [ ] **Step 6: Commit**

```bash
git add static_src/ennichi_murmur.js static_src/ennichi_sim.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 排隊、搭乘（含改裝數值）、攤位、設施、故障、髒亂、離場與 murmur"
```

---

### Task 8: 天氣

**Files:**
- Modify: `static_src/ennichi_sim.js`、`tools/ennichi_check/core_check.js`

**Interfaces:**
- Consumes: `D.WEATHER`、`Core.weatherOf`、`s.today.weather`、`s.today.closed`
- Produces:
  - `Sim.weatherNow(s) -> D.WEATHER 的一項`（`s.today.weather`，沒有 `today` 時用 `weatherOf(s, s.day)`）
  - `needsTick` 改寫：口渴、飢餓乘上天氣倍率；下雨時沒有傘且在走路的客人 `dry += 0.6`，`dry > 50` 時每分鐘 `hap −= 0.03`
  - `Sim.closedFor(s, weatherId) -> [type]`：強風時所有 `wind: true` 的設施 type
  - `choose` 補充：最急需求是 `fun` 而偏好最高的遊樂設施因強風停駛時，10% `complaint`（topic `wind`）；最急需求是 `dry` 且選不到時，30% `complaint`（topic `rain`）

- [ ] **Step 1: 追加失敗的測試**

```js
// ---------------- 7. 天氣 ----------------
(function () {
  var s = freshPark(41); openToday(s);
  s.today.weather = "sun";
  var g = walker(s, 2, 10, null, {});
  Sim.needsTick(s, g); var sunThirst = g.need.thirst;
  s.today.weather = "rain";
  var h = walker(s, 2, 10, null, {});
  Sim.needsTick(s, h);
  assert.ok(h.need.thirst < sunThirst, "雨天比較不渴");
  assert.ok(h.need.dry > 0, "沒有傘會淋濕");
  h.kasa = true; var d = h.need.dry; Sim.needsTick(s, h); assert.strictEqual(h.need.dry, d, "有傘不再淋濕");
  // 淋濕的客人會去買傘或避雨
  Core.give(s, D.BUILD.kasaSt.parts); s.phase = "plan";
  var kasa = Core.build(s, "kasaSt", 16, 8).sid; s.phase = "open";
  var w = walker(s, 2, 10, null, { dry: 90 });
  assert.strictEqual(Sim.choose(s, w), kasa);
  s.ware.kasa = 2; w.x = 17; w.y = 10; w.sid = kasa;
  Sim.step(s);
  assert.ok(w.kasa && w.need.dry === 0, "買到和傘");
  // 強風：飛椅、摩天輪停駛
  assert.deepStrictEqual(Sim.closedFor(s, "wind").sort(), ["chairs", "wheel"]);
  assert.deepStrictEqual(Sim.closedFor(s, "sun"), []);
  console.log("7. 天氣 OK");
})();
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: FAIL（`Sim.closedFor is not a function`）

- [ ] **Step 3: 實作**

在 `ennichi_sim.js` 把 `needsTick` 整個換成下面的版本，並在 `choose` 之前加入 `weatherNow`、`closedFor`；匯出 `weatherNow, closedFor`：

```js
  function weatherNow(s) { return D.WEATHER[s.today ? s.today.weather : Core.weatherOf(s, s.day)] || D.WEATHER.sun; }

  function closedFor(s, weatherId) {
    var w = D.WEATHER[weatherId], out = [];
    if (w && w.stop) for (var t in D.BUILD) if (D.BUILD[t].wind) out.push(t);
    return out;
  }

  function needsTick(s, g) {
    var w = weatherNow(s);
    for (var k in D.NEED_RATE) {
      var r = D.NEED_RATE[k];
      if (k === "thirst") r *= w.thirst;
      if (k === "hunger") r *= w.hunger;
      g.need[k] = Math.min(100, g.need[k] + r);
    }
    if (g.state === "walk") {
      g.need.fatigue = Math.min(100, g.need.fatigue + 0.05);
      if (w.wet && !g.kasa) g.need.dry = Math.min(100, g.need.dry + 0.6);
    }
    if (g.need.dry > 50) g.hap -= 0.03;
    g.hap = Math.max(0, Math.min(100, g.hap - s.dirt * 0.002));
  }
```

`choose` 的結尾（`return best;` 之前）加入：

```js
    if (!best && need === "dry" && Core.rnd(s) < 0.3 && window.PriTestEnnichiMurmur) window.PriTestEnnichiMurmur.say(s, g, "complaint", "rain", {});
    if (need === "fun" && s.today && s.today.closed.length && Core.rnd(s) < 0.1 && window.PriTestEnnichiMurmur) {
      var t = s.today.closed[Core.rint(s, s.today.closed.length)];
      for (var j in s.structs) if (s.structs[j].type === t) { window.PriTestEnnichiMurmur.say(s, g, "complaint", "wind", { ride: D.BUILD[t].name }); break; }
    }
```

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/ennichi_sim.js && node tools/ennichi_check/core_check.js`
Expected: `7. 天氣 OK`

- [ ] **Step 5: Commit**

```bash
git add static_src/ennichi_sim.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 天氣（晴陰雨強風）對需求、淋雨、買傘避雨、停駛的影響"
```

---

### Task 9: 排隊屋台與整理券

**Files:**
- Modify: `static_src/ennichi_sim.js`、`static_src/ennichi_core.js`、`tools/ennichi_check/core_check.js`

**Interfaces:**
- Produces:
  - `Core.setTicket(s, sid, on) -> bool`（遊樂設施；任何階段都可切換）
  - `Sim.qstallStep(s, st)`：`link` 指向的設施開著時，對它隊伍裡 `hunger > 40` 或 `thirst > 40` 的客人各以 10% 機率 `sellOne`（依需求大的那項排序商品）；買到的 `patience += 5`、`hap += 2`；10% murmur（impression、topic `qstall`）
  - 整理券：`arrive` 到遊樂設施時，若 `st.ticket` 且 `st.q.length ≥ cap × TICKET_FACTOR` 且客人沒有票 → `g.ticket = { sid, at: s.min + ceil(q.length / cap) × cycle }`、`g.sid = null`、20% impression（topic `ticket`）；持票客人在 `walk` 時 `s.min ≥ ticket.at` → `g.sid = ticket.sid`；持票到達 → 插到隊伍最前面、`ticket = null`、`wait = 0`
  - `step` 在遊樂設施之後、客人之前執行所有排隊屋台

- [ ] **Step 1: 追加失敗的測試**

```js
// ---------------- 8. 排隊屋台與整理券 ----------------
(function () {
  var s = freshPark(51);
  var merry = s.structs[sidOf(s, "merry")];
  var qs = s.structs[Core.build(s, "qstall", 8, 9).sid];
  assert.strictEqual(qs.link, merry.id);
  openToday(s);
  merry.riders = [999]; merry.t = 200; // 一直在運轉，隊伍不會前進
  s.ware.ramune = 20;
  var g = walker(s, 6, 10, merry.id, { thirst: 90, fun: 90 }); g.state = "queue"; merry.q = [g.id];
  g.patience = 200; // 測試只看屋台販售，不讓客人因排隊太久離開
  var p0 = g.patience;
  for (var i = 0; i < 60 && g.need.thirst > 40; i++) Sim.step(s);
  assert.ok(g.need.thirst <= 40, "排隊時跟屋台買了汽水");
  assert.ok(g.patience > p0, "買到後耐心增加");
  // 整理券
  var t = freshPark(52); openToday(t);
  var mm = t.structs[sidOf(t, "merry")];
  assert.ok(Core.setTicket(t, mm.id, true)); assert.ok(!Core.setTicket(t, sidOf(t, "bench"), true), "只有遊樂設施");
  mm.riders = [999]; mm.t = 30;
  for (i = 0; i < D.BUILD.merry.cap * D.TICKET_FACTOR; i++) { var q = walker(t, 6, 10, null, { fun: 90 }); q.state = "queue"; q.sid = mm.id; mm.q.push(q.id); }
  var k = walker(t, 6, 10, mm.id, { fun: 90 });
  Sim.step(t);
  assert.ok(k.ticket && k.ticket.sid === mm.id && k.state === "walk", "隊伍太長 → 拿整理券");
  t.min = k.ticket.at;
  k.x = 6; k.y = 10; k.sid = null;
  Sim.step(t);
  assert.strictEqual(mm.q[0], k.id, "回來直接排到最前面"); assert.strictEqual(k.ticket, null);
  console.log("8. 排隊屋台與整理券 OK");
})();
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: FAIL（`Core.setTicket is not a function`）

- [ ] **Step 3: 實作**

`ennichi_core.js` 加入並匯出：

```js
  function setTicket(s, sid, on) {
    var st = s.structs[sid];
    if (!st || D.BUILD[st.type].kind !== "ride") return false;
    st.ticket = !!on;
    return true;
  }
```

`ennichi_sim.js`：
1. 加入 `qstallStep`（並匯出）：

```js
  function qstallStep(s, st) {
    var ride = st.link && s.structs[st.link];
    if (st.build > 0 || !ride || !isOpen(s, ride)) return;
    var b = D.BUILD[st.type];
    ride.q.forEach(function (gid) {
      var g = byId(s, gid);
      if (!g || (g.need.hunger <= 40 && g.need.thirst <= 40) || !chance(s, 0.1)) return;
      var order = b.sells.slice().sort(function (a, c) {
        function v(id) { var f = D.ITEMS[id].fill || {}; return (f.thirst || 0) * g.need.thirst + (f.hunger || 0) * g.need.hunger; }
        return v(c) - v(a);
      });
      if (sellOne(s, g, order)) {
        g.patience += 5; g.hap += 2; clampHap(g);
        if (chance(s, 0.1)) mm(s, g, "impression", "qstall", {});
      }
    });
  }
```

2. `arrive` 的 `if (k === "ride") { ... }` 區塊換成：

```js
    if (k === "ride") {
      var b = D.BUILD[st.type];
      if (g.ticket && g.ticket.sid === st.id) {
        st.q.unshift(g.id); g.ticket = null; g.state = "queue"; g.wait = 0;
        return;
      }
      if (st.ticket && !g.ticket && st.q.length >= b.cap * D.TICKET_FACTOR) {
        g.ticket = { sid: st.id, at: s.min + Math.ceil(st.q.length / b.cap) * b.cycle };
        g.sid = null;
        if (chance(s, 0.2)) mm(s, g, "impression", "ticket", {});
        return;
      }
      st.q.push(g.id); g.state = "queue"; g.wait = 0;
      return;
    }
```

3. `guestStep` 的 `if (!g.sid) {` 之前加入：

```js
    if (g.ticket && s.min >= g.ticket.at) g.sid = g.ticket.sid;
```

4. `step` 改成：

```js
  function step(s) {
    while (s.today.spawn.length && s.today.spawn[0] <= s.min) { s.today.spawn.shift(); spawn(s); }
    var k;
    for (k in s.structs) if (D.BUILD[s.structs[k].type].kind === "ride") rideStep(s, s.structs[k]);
    for (k in s.structs) if (D.BUILD[s.structs[k].type].kind === "qstall") qstallStep(s, s.structs[k]);
    s.guests.forEach(function (g) { guestStep(s, g); });
    s.guests = s.guests.filter(function (g) {
      if (g.state !== "leave") return true;
      finishGuest(s, g);
      return false;
    });
  }
```

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/ennichi_sim.js && node --check static_src/ennichi_core.js && node tools/ennichi_check/core_check.js`
Expected: `8. 排隊屋台與整理券 OK`

- [ ] **Step 5: Commit**

```bash
git add static_src/ennichi_sim.js static_src/ennichi_core.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 排隊屋台（向排隊客人販售）與整理券（插隊回來）"
```

---

### Task 10: 繪馬許願

**Files:**
- Modify: `static_src/ennichi_wish.js`（整檔寫入）、`static_src/ennichi_sim.js`、`tools/ennichi_check/core_check.js`

**Interfaces:**
- Consumes: `D.WISH`、`Core.rnd/rint/popLevel`、`Murmur.say`
- Produces（`window.PriTestEnnichiWish`）：
  - `active(s) -> [Wish]`（未完成）
  - `candidates(s, g) -> [{ kind, target, n, text }]`：
    - `build`：目前人氣等級可以蓋、但樂園裡還沒有的遊樂設施或攤位（`shrine`、`qstall` 除外）
    - `sell`：食物與飲料（`n = SELL_N`）
    - `upgrade`：已完工大型設施的空改裝槽（`target = { sid, slot }`）
    - `queue`：昨天平均等待（`lastWait`）> 15 分鐘的遊樂設施（`target = sid`）
    - `shelter`：今天下雨且沒有休憩棚
    - 已經有同 kind＋同 target 的未完成願望者排除
  - `maybeMake(s, g, force) -> Wish|null`：未完成 < `MAX` 且（`force` 或 `rnd < CHANCE`）→ 從候選中 `rint` 挑一個，`id = s.nextWish++`、`day = s.day`、`prog = 0`、`done = false`
  - `progressSale(s, item)`：未完成的 `sell` 願望 `target === item` → `prog++`
  - `check(s)`：達成條件 → `done = true`、`rep += REWARD[kind]`、`today.wishesDone++`（有 today 時）、許願者（若還在園內）或匿名 murmur（recommend、topic `wish`）
    - `build`／`shelter`：存在 `type === target` 且 `build === 0` 的建物；`upgrade`：`structs[sid].mods[slot]`；`sell`：`prog ≥ n`；`queue`：`day > w.day` 且 `structs[sid].lastWait ≤ QUEUE_OK`
  - `expire(s)`：未完成且 `s.day − w.day ≥ EXPIRE` → 移除、`rep = max(0, rep − PENALTY)`
  - `s.wishes` 只保留未完成的與最近 5 個完成的
- Sim 掛勾：參拜（`arrive` 的 shrine 分支）`Wish.maybeMake(s, g, false)`；`buyAt` 賣出繪馬 → `Wish.maybeMake(s, g, true)`；`sellOne` 成功 → `Wish.progressSale(s, id)`

- [ ] **Step 1: 追加失敗的測試**

```js
// ---------------- 9. 繪馬許願 ----------------
var Wish = window.PriTestEnnichiWish;
(function () {
  var s = freshPark(61); openToday(s);
  var g = Sim.spawn(s);
  var cs = Wish.candidates(s, g);
  assert.ok(cs.some(function (c) { return c.kind === "build" && c.target === "kingyo"; }), "可以許願要金魚撈");
  assert.ok(!cs.some(function (c) { return c.kind === "build" && c.target === "merry"; }), "已經有旋轉木馬");
  assert.ok(cs.some(function (c) { return c.kind === "upgrade"; }), "旋轉木馬有空的改裝槽");
  // 強制產生 3 個，第 4 個不會產生
  var made = [];
  for (var i = 0; i < 5; i++) { var w = Wish.maybeMake(s, g, true); if (w) made.push(w); }
  assert.strictEqual(Wish.active(s).length, D.WISH.MAX);
  assert.ok(made.every(function (w) { return w.text.zh.length > 0 && w.text.zh.indexOf("{") < 0; }));
  // 完成「蓋金魚撈」
  s.wishes = []; s.nextWish = 1;
  s.wishes.push({ id: s.nextWish++, kind: "build", target: "kingyo", n: 0, prog: 0, day: s.day, gid: 0, photo: null, text: { zh: "x", ja: "x" }, done: false });
  s.wishes.push({ id: s.nextWish++, kind: "sell", target: "takoyaki", n: 2, prog: 0, day: s.day, gid: 0, photo: null, text: { zh: "x", ja: "x" }, done: false });
  var rep = s.rep;
  s.phase = "plan"; Core.build(s, "kingyo", 16, 8); s.phase = "open";
  Wish.check(s);
  assert.ok(s.wishes[0].done); assert.strictEqual(s.rep, rep + D.WISH.REWARD.build);
  // 賣出 2 份章魚燒完成 sell
  s.ware.takoyaki = 5;
  for (i = 0; i < 2; i++) { var c = walker(s, 11, 10, sidOf(s, "takoyakiSt"), { hunger: 90 }); Sim.step(s); }
  Wish.check(s);
  assert.ok(s.wishes[1].done, "賣出 2 份");
  // 7 天沒完成撤下並扣口碑
  s.wishes.push({ id: s.nextWish++, kind: "build", target: "toilet", n: 0, prog: 0, day: s.day, gid: 0, photo: null, text: { zh: "x", ja: "x" }, done: false });
  rep = s.rep; s.day += D.WISH.EXPIRE;
  Wish.expire(s);
  assert.ok(!s.wishes.some(function (w) { return w.target === "toilet"; })); assert.strictEqual(s.rep, Math.max(0, rep - D.WISH.PENALTY));
  console.log("9. 繪馬許願 OK");
})();
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: FAIL（`Cannot read properties of undefined (reading 'candidates')`）

- [ ] **Step 3: 實作繪馬模組**

`static_src/ennichi_wish.js`：

```js
// ============================================================================
// 緣日樂園：繪馬許願（規格 §6.4）。客人參拜或買繪馬時掛上願望；完成加口碑、7 天沒完成撤下。
// ============================================================================
(function () {
  "use strict";
  var D = window.PriTestEnnichiData, C = D.C;
  var T = {
    build: C("好想在這裡玩{name}！", "ここで{name}がしたい！"),
    sell: C("想吃到{name}～（還差 {n} 份）", "{name}が食べたい〜（あと {n} 個）"),
    upgrade: C("希望{name}可以裝上{mod}", "{name}に{mod}が付いたらいいな"),
    queue: C("{name}可以不要排那麼久嗎……", "{name}の行列、もう少し短くならないかな……"),
    shelter: C("下雨天想要有個躲雨的地方", "雨の日に雨宿りできる場所がほしい"),
  };

  function fill(t, v) {
    function rep(str, lang) {
      return str.replace("{name}", v.name ? v.name[lang] : "").replace("{mod}", v.mod ? v.mod[lang] : "").replace("{n}", v.n != null ? String(v.n) : "");
    }
    return { zh: rep(t.zh, "zh"), ja: rep(t.ja, "ja") };
  }

  function active(s) { return s.wishes.filter(function (w) { return !w.done; }); }

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function candidates(s, g) {
    var Core = window.PriTestEnnichiCore, out = [], have = {}, k;
    for (k in s.structs) have[s.structs[k].type] = 1;
    var lv = Core.popLevel(s);
    for (var t in D.BUILD) {
      var b = D.BUILD[t];
      if ((b.kind === "ride" || b.kind === "stall") && b.lv <= lv && !have[t]) out.push({ kind: "build", target: t, n: 0, text: fill(T.build, { name: b.name }) });
    }
    ["takoyaki", "ringoame", "wataame", "ramune"].forEach(function (id) {
      out.push({ kind: "sell", target: id, n: D.WISH.SELL_N, text: fill(T.sell, { name: D.ITEMS[id].name, n: D.WISH.SELL_N }) });
    });
    for (k in s.structs) {
      var st = s.structs[k], bb = D.BUILD[st.type];
      if (bb.slots && st.build === 0) for (var sl in bb.slots) if (!st.mods[sl]) out.push({ kind: "upgrade", target: { sid: st.id, slot: sl }, n: 0, text: fill(T.upgrade, { name: bb.name, mod: D.ITEMS[bb.slots[sl].mod].name }) });
      if (bb.kind === "ride" && st.lastWait > 15) out.push({ kind: "queue", target: st.id, n: 0, text: fill(T.queue, { name: bb.name }) });
    }
    var wet = s.today && D.WEATHER[s.today.weather] && D.WEATHER[s.today.weather].wet;
    if (wet && !have.shelter) out.push({ kind: "shelter", target: "shelter", n: 0, text: fill(T.shelter, {}) });
    var act = active(s);
    return out.filter(function (c) { return !act.some(function (w) { return w.kind === c.kind && same(w.target, c.target); }); });
  }

  function maybeMake(s, g, force) {
    var Core = window.PriTestEnnichiCore;
    if (active(s).length >= D.WISH.MAX) return null;
    if (!force && Core.rnd(s) >= D.WISH.CHANCE) return null;
    var cs = candidates(s, g);
    if (!cs.length) return null;
    var c = cs[Core.rint(s, cs.length)];
    var w = { id: s.nextWish++, kind: c.kind, target: c.target, n: c.n, prog: 0, day: s.day, gid: g ? g.id : 0, photo: g ? g.photo : null, text: c.text, done: false };
    s.wishes.push(w);
    return w;
  }

  function progressSale(s, item) {
    active(s).forEach(function (w) { if (w.kind === "sell" && w.target === item) w.prog++; });
  }

  function met(s, w) {
    var k;
    if (w.kind === "build" || w.kind === "shelter") {
      for (k in s.structs) if (s.structs[k].type === w.target && s.structs[k].build === 0) return true;
      return false;
    }
    if (w.kind === "upgrade") { var st = s.structs[w.target.sid]; return !!(st && st.mods[w.target.slot]); }
    if (w.kind === "sell") return w.prog >= w.n;
    if (w.kind === "queue") { var q = s.structs[w.target]; return !!(q && s.day > w.day && q.lastWait <= D.WISH.QUEUE_OK); }
    return false;
  }

  function trim(s) {
    var done = s.wishes.filter(function (w) { return w.done; }).slice(-5);
    s.wishes = active(s).concat(done);
  }

  function check(s) {
    var Murmur = window.PriTestEnnichiMurmur;
    active(s).forEach(function (w) {
      if (!met(s, w)) return;
      w.done = true;
      s.rep += D.WISH.REWARD[w.kind];
      if (s.today) s.today.wishesDone++;
      var g = null;
      for (var i = 0; i < s.guests.length; i++) if (s.guests[i].id === w.gid) g = s.guests[i];
      if (Murmur) Murmur.say(s, g || { id: w.gid, photo: w.photo }, "recommend", "wish", {});
    });
    trim(s);
  }

  function expire(s) {
    var keep = [];
    s.wishes.forEach(function (w) {
      if (!w.done && s.day - w.day >= D.WISH.EXPIRE) s.rep = Math.max(0, s.rep - D.WISH.PENALTY);
      else keep.push(w);
    });
    s.wishes = keep;
    trim(s);
  }

  window.PriTestEnnichiWish = { TEMPLATES: T, active: active, candidates: candidates, maybeMake: maybeMake, progressSale: progressSale, check: check, expire: expire };
})();
```

- [ ] **Step 4: Sim 掛勾**

`ennichi_sim.js`：
- `sellOne` 成功的 `return id;` 之前加：`if (window.PriTestEnnichiWish) window.PriTestEnnichiWish.progressSale(s, id);`
- `buyAt` 賣出後（`var it = D.ITEMS[id];` 之後）加：`if (id === "ema" && window.PriTestEnnichiWish) window.PriTestEnnichiWish.maybeMake(s, g, true);`
- `arrive` 的 shrine 分支（`if (chance(s, 0.2)) mm(...shrine...)` 之後）加：`if (window.PriTestEnnichiWish) window.PriTestEnnichiWish.maybeMake(s, g, false);`

- [ ] **Step 5: 執行確認通過**

Run: `node --check static_src/ennichi_wish.js && node --check static_src/ennichi_sim.js && node tools/ennichi_check/core_check.js`
Expected: `9. 繪馬許願 OK`（1〜8 也仍然 OK）

- [ ] **Step 6: Commit**

```bash
git add static_src/ennichi_wish.js static_src/ennichi_sim.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 繪馬許願（產生、進度、完成獎勵、逾期撤下）"
```

---

### Task 11: 日循環——開園、tick、打烊結算、施工進度、修理、季末、applyIntent

**Files:**
- Modify: `static_src/ennichi_core.js`、`tools/ennichi_check/core_check.js`

**Interfaces:**
- Consumes: `Sim.step/spawnSchedule/closedFor`、`Murmur.topTopics`、`Wish.check/expire`、`workshopStep`
- Produces:
  - `openDay(s) -> bool`：`plan` → `open`；`s.today`（開頭 Today 的全部欄位；`weather = weatherOf(s, day)`、`closed = Sim.closedFor(s, weather)`、`spawn = Sim.spawnSchedule(s)`）
  - `tick(s, n)`：`open` 時每分鐘 `Sim.step`、`workshopStep`、`min++`；`min ≥ DAY_END` 且沒有客人也沒有待生成，或 `min ≥ DAY_END + 90` → `closeDay`
  - `closeDay(s) -> Summary`：殘留客人照常記滿意度後移除；`avgHap`；`repDelta = round((avgHap − 55) × hapN / 40) + sns`；遊樂設施 `lastWait = waitN ? round(waitSum / waitN) : 0`、`waitSum = waitN = 0`、`q/riders/t` 清空；**施工中的 `build −1`**；`Wish.check(s)`、`Wish.expire(s)`；`history.push(Summary)`；`dirt = 0`；`phase = "close"`
  - `repair(s, sid)`、`nextDay(s)`、`seasonResult(s) -> { guests, rev, avgHap, rep, level, wishes }`
  - `applyIntent(s, it) -> { ok, err }`：`build {type,x,y}`、`demolish {sid}`、`path {x,y,on}`、`buy {item,n}`、`machine {type}`、`recipe {mi,rid}`、`price {sid,price}`、`fee {fee}`、`repair {sid}`、`upgrade {sid,slot}`、`ticket {sid,on}`、`open`、`next`；`build`／`upgrade` 成功後呼叫 `Wish.check(s)`

- [ ] **Step 1: 追加失敗的測試**

```js
// ---------------- 10. 日循環、施工進度、結算、修理、季末 ----------------
(function () {
  var s = freshPark(31);
  s.ware.takoyaki = 50; s.weather[1] = "sun"; s.weather[2] = "wind";
  // 施工：第 1 天放下咖啡杯（組裝 1 天）→ 第 2 天營業
  Core.give(s, D.BUILD.cups.parts);
  var cups = s.structs[Core.applyIntent(s, { a: "build", type: "cups", x: 16, y: 7 }).sid];
  assert.strictEqual(cups.build, 1);
  assert.ok(Core.applyIntent(s, { a: "open" }).ok);
  assert.strictEqual(s.today.weather, "sun"); assert.deepStrictEqual(s.today.closed, []);
  assert.ok(!Core.applyIntent(s, { a: "build", type: "bench", x: 15, y: 9 }).ok, "營業中不能蓋");
  Core.tick(s, D.DAY_END - D.DAY_START + 120);
  assert.strictEqual(s.phase, "close"); assert.strictEqual(s.guests.length, 0);
  var sum = s.history[0];
  assert.strictEqual(sum.day, 1); assert.ok(sum.guests > 0); assert.strictEqual(sum.weather, "sun");
  assert.ok(s.rep >= Math.max(0, sum.repDelta), "口碑至少加上當天的變化（繪馬完成會再加）");
  assert.ok(s.today.murmurs.length > 0);
  assert.strictEqual(cups.build, 0, "打烊時施工完成");
  var merry = s.structs[sidOf(s, "merry")];
  assert.ok(merry.lastWait >= 0 && merry.waitN === 0);
  // 第 2 天強風：飛椅、摩天輪停駛清單
  assert.ok(Core.applyIntent(s, { a: "next" }).ok); assert.strictEqual(s.day, 2);
  merry.wear = 100; merry.broken = true; s.ware.gear = 5;
  assert.ok(Core.applyIntent(s, { a: "repair", sid: merry.id }).ok); assert.ok(!merry.broken); assert.strictEqual(s.ware.gear, 3);
  Core.give(s, { nightLanterns: 2 });
  assert.ok(Core.applyIntent(s, { a: "upgrade", sid: merry.id, slot: "light" }).ok);
  assert.ok(Core.applyIntent(s, { a: "ticket", sid: merry.id, on: true }).ok);
  Core.applyIntent(s, { a: "open" });
  assert.deepStrictEqual(s.today.closed.sort(), ["chairs", "wheel"]);
  // 決定性
  function run(seed) { var t = freshPark(seed); Core.applyIntent(t, { a: "open" }); Core.tick(t, 600); return Core.serialize(t); }
  assert.strictEqual(run(77), run(77));
  // 季末
  s.phase = "close"; s.day = D.SEASON_DAYS;
  Core.nextDay(s); assert.strictEqual(s.phase, "season");
  var res = Core.seasonResult(s);
  assert.ok(res.guests >= sum.guests && res.level >= 1 && res.wishes >= 0);
  assert.strictEqual(Core.applyIntent(s, { a: "bogus" }).err, "unknown");
  console.log("10. 日循環、施工進度、結算、修理、季末 OK");
})();
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: FAIL（`Core.applyIntent is not a function`）

- [ ] **Step 3: 實作**

`ennichi_core.js` 的 `serialize` 之前加入，並匯出 `setTicket` 以外新增的全部函式（`openDay, tick, closeDay, repair, nextDay, seasonResult, applyIntent`）：

```js
  // ---- 日循環
  function openDay(s) {
    if (s.phase !== "plan") return false;
    var Sim = window.PriTestEnnichiSim, w = weatherOf(s, s.day);
    s.phase = "open"; s.min = D.DAY_START; s.guests = [];
    s.today = {
      guests: 0, left: 0, rev: 0, fees: 0, hapSum: 0, hapN: 0, sns: 0, made: {}, sales: {},
      spawn: Sim.spawnSchedule(s), murmurs: [], topics: {}, weather: w, closed: Sim.closedFor(s, w), wishesDone: 0,
    };
    return true;
  }

  function tick(s, n) {
    var Sim = window.PriTestEnnichiSim;
    for (var i = 0; i < n && s.phase === "open"; i++) {
      Sim.step(s);
      workshopStep(s);
      s.min++;
      if ((s.min >= D.DAY_END && !s.guests.length && !s.today.spawn.length) || s.min >= D.DAY_END + 90) closeDay(s);
    }
  }

  function closeDay(s) {
    var t = s.today;
    s.guests.forEach(function (g) { t.hapSum += g.hap; t.hapN++; t.left++; });
    s.guests = [];
    var avg = t.hapN ? Math.round(t.hapSum / t.hapN) : 0;
    var delta = Math.round((avg - 55) * t.hapN / 40) + t.sns;
    s.rep = Math.max(0, s.rep + delta);
    for (var k in s.structs) {
      var st = s.structs[k];
      st.lastWait = st.waitN ? Math.round(st.waitSum / st.waitN) : 0;
      st.waitSum = 0; st.waitN = 0; st.q = []; st.riders = []; st.t = 0;
      if (st.build > 0) st.build--;
    }
    var Wish = window.PriTestEnnichiWish, Murmur = window.PriTestEnnichiMurmur;
    if (Wish) { Wish.check(s); Wish.expire(s); }
    var sum = { day: s.day, guests: t.guests, rev: t.rev + t.fees, avgHap: avg, repDelta: delta, sns: t.sns, weather: t.weather, wishesDone: t.wishesDone, topTopics: Murmur ? Murmur.topTopics(s, 3) : [] };
    s.history.push(sum);
    s.dirt = 0;
    s.phase = "close";
    return sum;
  }

  function repair(s, sid) {
    var st = s.structs[sid];
    if (!st || s.phase !== "plan") return false;
    var b = D.BUILD[st.type];
    if (b.kind !== "ride" || (!st.broken && !st.wear) || !have(s, b.fix)) return false;
    take(s, b.fix);
    st.wear = 0; st.broken = false; st.fixes++;
    return true;
  }

  function nextDay(s) {
    if (s.phase !== "close") return false;
    s.day++;
    s.phase = s.day > D.SEASON_DAYS ? "season" : "plan";
    s.min = D.DAY_START;
    return true;
  }

  function seasonResult(s) {
    var g = 0, rev = 0, hs = 0, wishes = 0;
    s.history.forEach(function (h) { g += h.guests; rev += h.rev; hs += h.avgHap * h.guests; wishes += h.wishesDone; });
    return { guests: g, rev: rev, avgHap: g ? Math.round(hs / g) : 0, rep: s.rep, level: popLevel(s), wishes: wishes };
  }

  function applyIntent(s, it) {
    var ok, Wish = window.PriTestEnnichiWish;
    switch (it && it.a) {
      case "build": var r = build(s, it.type, it.x, it.y); if (r.ok && Wish) Wish.check(s); return r;
      case "demolish": ok = demolish(s, it.sid); break;
      case "path": ok = setPath(s, it.x, it.y, !!it.on); break;
      case "buy": ok = buy(s, it.item, it.n); break;
      case "machine": ok = addMachine(s, it.type); break;
      case "recipe": ok = setRecipe(s, it.mi, it.rid); break;
      case "price": ok = setPrice(s, it.sid, it.price); break;
      case "fee": ok = setFee(s, it.fee); break;
      case "repair": ok = repair(s, it.sid); break;
      case "upgrade": ok = upgrade(s, it.sid, it.slot); if (ok && Wish) Wish.check(s); break;
      case "ticket": ok = setTicket(s, it.sid, it.on); break;
      case "open": ok = openDay(s); break;
      case "next": ok = nextDay(s); break;
      default: return { ok: false, err: "unknown" };
    }
    return { ok: ok, err: ok ? null : "rejected" };
  }
```

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/ennichi_core.js && node tools/ennichi_check/core_check.js`
Expected: 1〜10 全部 OK

- [ ] **Step 5: Commit**

```bash
git add static_src/ennichi_core.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 日循環、施工進度、打烊結算與口碑、修理、季末、applyIntent"
```

---

### Task 12: 28 天平衡模擬（自動排程機器人）

**Files:**
- Create: `tools/ennichi_check/sim.js`

**Interfaces:**
- Consumes: `Core.*`、`D.*`
- Produces: 每天一行 `day weather guests rev avgHap rep cash built`，最後斷言。斷言失敗時只調 `ennichi_data.js` 的**數值**（客群預算、需求速率、價格、磨損、機器價格、開局倉庫、加工時間），在改動處註明「依 sim.js 調整：原值 → 新值，理由」；不得改斷言門檻或規則。

- [ ] **Step 1: 寫模擬腳本**

```js
// ============================================================================
// 緣日樂園 28 天平衡模擬：機器人用「物料需求展開」自動排程工房，依序蓋設施與改裝。
// 執行：node tools/ennichi_check/sim.js [種子]
// 目標（MVP 的手感基準）：不破產、來客成長、平均心情 50〜85、第 10 天前蓋好旋轉木馬、季末人氣 Lv3 以上、
//                         至少完成 1 個繪馬願望、至少裝上 1 個改裝模組、murmur 類型至少 5 種。
// ============================================================================
"use strict";
var fs = require("fs"), path = require("path"), assert = require("assert");
global.window = global;
var SRC = path.join(__dirname, "..", "..", "static_src");
["ennichi_data.js", "ennichi_murmur.js", "ennichi_wish.js", "ennichi_core.js", "ennichi_sim.js"].forEach(function (f) { eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8")); });
var D = window.PriTestEnnichiData, Core = window.PriTestEnnichiCore;
var seed = +(process.argv[2] || 2026);
var s = Core.newGame({ seed: seed });
function act(a) { return Core.applyIntent(s, a).ok; }

// 第二條街：x=21 往下接到 y=17，再沿 y=17 往左。上排蓋在參道上方（y = 10 − h），下排蓋在第二條街上方（y = 17 − h）
var ROWS = [D.MAP.GATE.y, 17];
function layStreets() {
  for (var y = D.MAP.GATE.y + 1; y <= 17; y++) Core.setPath(s, 21, y, true);
  for (var x = 1; x <= 20; x++) Core.setPath(s, x, 17, true);
}
function tryPlace(type) {
  var b = D.BUILD[type];
  for (var r = 0; r < ROWS.length; r++) for (var x = 1; x + b.w <= 21; x++) if (act({ a: "build", type: type, x: x, y: ROWS[r] - b.h })) return true;
  return false;
}
function tryQstall() {
  for (var k in s.structs) {
    if (s.structs[k].type !== "merry" || s.structs[k].build) continue;
    var e = Core.entranceOf(s.structs[k]);
    for (var dx = -3; dx <= 3; dx++) if (act({ a: "build", type: "qstall", x: e.x + dx, y: e.y - 1 })) return true;
  }
  return false;
}

// 物料需求展開：要做出 want（{item: n}）還缺什麼 → make（{item: 批次數}）、buy（{原料: n}）
function explode(want) {
  var stock = JSON.parse(JSON.stringify(s.ware)), make = {}, buy = {};
  function need(k, n) {
    var use = Math.min(n, stock[k] || 0); stock[k] = (stock[k] || 0) - use; n -= use;
    if (n <= 0) return;
    var it = D.ITEMS[k];
    if (it.kind === "mat") { buy[k] = (buy[k] || 0) + n; return; }
    var r = D.RECIPES[k], batches = Math.ceil(n / r.out[k]);
    make[k] = (make[k] || 0) + batches;
    stock[k] = (stock[k] || 0) + batches * r.out[k] - n;
    for (var i in r.in) need(i, r.in[i] * batches);
  }
  for (var k in want) need(k, want[k]);
  return { make: make, buy: buy };
}

var GOALS = ["takoyakiSt", "ameSt", "kingyo", "wanage", "bench", "trash", "bench", "toilet", "merry", "ramuneSt", "kasaSt", "shelter",
  "trash", "cups", "omikuji", "shateki", "juyo", "chairs", "lanternPost", "lanternPost", "wheel", "flower"];
var UPGRADES = [["merry", "light"], ["merry", "deco"], ["wheel", "cabin"]];
var types = {}, upgraded = 0, merryDay = null;

function planDay() {
  for (var k in s.structs) if (s.structs[k].broken || s.structs[k].wear > 60) act({ a: "repair", sid: +k });
  while (GOALS.length && tryPlace(GOALS[0])) GOALS.shift();
  tryQstall();
  UPGRADES.forEach(function (u) {
    for (var j in s.structs) if (s.structs[j].type === u[0]) { if (act({ a: "upgrade", sid: +j, slot: u[1] })) upgraded++; }
  });
  for (var t in s.structs) if (D.BUILD[s.structs[t].type].kind === "ride") act({ a: "ticket", sid: +t, on: true });
  // 本日目標：下一個要蓋的設施＋修理零件＋第一個改裝＋商品存量
  var want = {};
  function addMap(m, mul) { for (var i in m) want[i] = (want[i] || 0) + m[i] * (mul || 1); }
  if (GOALS.length) addMap(D.BUILD[GOALS[0]].parts);
  addMap({ gear: 2, chain: 2, plank: 4 });
  var u = UPGRADES[0], ub = D.BUILD[u[0]];
  if (ub.slots[u[1]]) addMap((function () { var o = {}; o[ub.slots[u[1]].mod] = ub.slots[u[1]].n; return o; })());
  addMap({ takoyaki: 60, ramune: 40, wataame: 20, kasa: 6, ema: 8 });
  var plan = explode(want);
  // 缺的機器先買；每台機器挑需求最多的配方
  var byM = {};
  for (var r in plan.make) { var m = D.RECIPES[r].m; (byM[m] = byM[m] || []).push(r); }
  Object.keys(byM).forEach(function (m) { if (!s.machines.some(function (x) { return x.type === m; })) act({ a: "machine", type: m }); });
  var used = {};
  s.machines.forEach(function (mc, i) {
    var list = (byM[mc.type] || []).sort(function (a, b) { return plan.make[b] - plan.make[a]; });
    var pick = list.filter(function (x) { return !used[x]; })[0] || list[0];
    if (pick) { used[pick] = 1; act({ a: "recipe", mi: i, rid: pick }); }
  });
  for (var b in plan.buy) if (s.cash > 800) act({ a: "buy", item: b, n: Math.min(plan.buy[b], D.WARE_CAP - Core.wareTotal(s)) });
}

layStreets();
console.log("day wthr guests   rev hap  rep   cash built");
for (var d = 1; d <= D.SEASON_DAYS; d++) {
  planDay();
  act({ a: "open" });
  Core.tick(s, 1000);
  s.today.murmurs.forEach(function (m) { types[m.type] = 1; });
  if (merryDay === null) for (var k in s.structs) if (s.structs[k].type === "merry" && s.structs[k].build === 0) merryDay = d;
  var h = s.history[s.history.length - 1];
  console.log([h.day, h.weather, h.guests, h.rev, h.avgHap, s.rep, s.cash, Object.keys(s.structs).length].map(function (v) { return String(v).padStart(5); }).join(" "));
  act({ a: "next" });
}
var res = Core.seasonResult(s);
console.log("season", JSON.stringify(res), "merryDay", merryDay, "upgraded", upgraded, "murmur types", Object.keys(types).join(","));
assert.ok(s.cash > 0, "沒有破產");
assert.ok(s.history[27].guests > s.history[0].guests, "來客成長");
assert.ok(res.avgHap >= 50 && res.avgHap <= 85, "平均心情 50〜85：" + res.avgHap);
assert.ok(merryDay !== null && merryDay <= 10, "第 10 天前蓋好旋轉木馬：" + merryDay);
assert.ok(res.level >= 3, "季末人氣 Lv3 以上：Lv" + res.level);
assert.ok(res.wishes >= 1, "至少完成 1 個繪馬願望");
assert.ok(upgraded >= 1, "至少裝上 1 個改裝模組");
assert.ok(Object.keys(types).length >= 5, "murmur 類型至少 5 種");
console.log("sim OK");
```

- [ ] **Step 2: 執行並調整數值直到通過**

Run: `node tools/ennichi_check/sim.js && node tools/ennichi_check/sim.js 7 && node tools/ennichi_check/sim.js 99`
Expected: 三個種子都印出 `sim OK`。若機器人的排程本身有明顯缺陷（例如永遠買不起機器），可以修 `sim.js` 的策略，但要在檔頭註解寫明改了什麼。

- [ ] **Step 3: Commit**

```bash
git add tools/ennichi_check/sim.js static_src/ennichi_data.js
git commit -m "test(ennichi): 28 天平衡模擬（物料需求展開排程）並調整初始數值"
```

---

### Task 13: 共用群眾模組 `ennichi_crowd.js`（從樣本頁抽出）

**Files:**
- Create／Modify: `static_src/ennichi_crowd.js`（取代 Task 1 的空檔）
- Modify: `static_src/ennichi_lab.js`（改用共用模組；行為不變）、`site_src/ennichi_page.py`（`ENNICHI_LAB_SCRIPTS = ("ennichi_crowd.js", "ennichi_lab.js")`）

**Interfaces:**
- Produces（`window.PriTestEnnichiCrowd`；呼叫時才存取 `THREE`）：
  - `OUTFITS`（與 `ennichi_lab.js` 現有 4 套相同）、`CELL = 192`、`DIRS = 8`、`FRAMES = 4`、`SIZE = 1.55`
  - `restPose(vrm)`、`walkPose(vrm, phase, amp)`（從 lab 原封搬移）
  - `buildAtlas(renderer, vrm) -> THREE.Texture`（含每格 `humanoid.update()`、`updateMatrixWorld(true)`、`springBoneManager.reset()`）
  - `create(scene, tex, maxN) -> { mesh, set(i, x, y, z, dir, row, scale), count(n) }`
  - `dirIndex(heading, camX, camZ, x, z) -> 0..7`

- [ ] **Step 1: 抽出模組**

從 `static_src/ennichi_lab.js` 把 `OUTFITS`、`ATLAS_*`、`BILL_SIZE`、`restPose`、`walkPose`、`recolor`、`buildAtlas`、群眾的著色器與幾何搬到 `ennichi_crowd.js`，改成以參數傳入 `renderer`／`scene`。`create()`：

```js
  function create(scene, tex, maxN) {
    var base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    var geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.attributes.position);
    geo.setAttribute("uv", base.attributes.uv);
    var iPos = new THREE.InstancedBufferAttribute(new Float32Array(maxN * 3), 3);
    var iCell = new THREE.InstancedBufferAttribute(new Float32Array(maxN * 2), 2);
    var iScale = new THREE.InstancedBufferAttribute(new Float32Array(maxN), 1);
    iPos.setUsage(THREE.DynamicDrawUsage); iCell.setUsage(THREE.DynamicDrawUsage); iScale.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iPos", iPos); geo.setAttribute("iCell", iCell); geo.setAttribute("iScale", iScale);
    geo.instanceCount = 0;
    var mesh = new THREE.Mesh(geo, material(tex, scene.fog));
    mesh.frustumCulled = false;
    scene.add(mesh);
    return {
      mesh: mesh,
      set: function (i, x, y, z, dir, row, scale) { iPos.setXYZ(i, x, y, z); iCell.setXY(i, dir, row); iScale.setX(i, scale); },
      count: function (n) { geo.instanceCount = n; iPos.needsUpdate = true; iCell.needsUpdate = true; iScale.needsUpdate = true; },
    };
  }

  function dirIndex(heading, camX, camZ, x, z) {
    var k = Math.round((heading - Math.atan2(camX - x, camZ - z)) / (Math.PI / 4));
    return ((k % 8) + 8) % 8;
  }
```

`material(tex, fog)` 用 lab 現有的 vertex／fragment shader（含 `c.rgb /= c.a` 與霧），`uGrid = (DIRS, FRAMES × OUTFITS.length)`、`uSize = SIZE`。

- [ ] **Step 2: 樣本頁改用共用模組並確認行為不變**

`ennichi_lab.js` 刪掉被搬走的函式，改呼叫 `window.PriTestEnnichiCrowd.*`。

Run: `node --check static_src/ennichi_crowd.js && node --check static_src/ennichi_lab.js && py -3 generate.py`
暫時的 Playwright 腳本（不提交）開 `ennichi/lab/index.html`：等 `PriTestEnnichiLab._report().ready`，確認 `_report().atlas` 有值、`_state().guests === 120`、沒有 `pageerror`。

- [ ] **Step 3: Commit**

```bash
git add static_src/ennichi_crowd.js static_src/ennichi_lab.js site_src/ennichi_page.py
git commit -m "refactor(ennichi): 看板人物圖集與群眾抽成共用模組 ennichi_crowd.js"
```

---

### Task 14: 3D 樂園 `ennichi_3d.js`

**Files:**
- Modify: `static_src/ennichi_3d.js`（取代空檔）、`static_src/css/ennichi.css`

**Interfaces:**
- Consumes: `D.MAP/BUILD`、`Core.entranceOf/effStats`、`PriTestEnnichiCrowd`、`PriTestEnnichiVendor`
- Produces（`window.PriTestEnnichi3D`）：
  - `init(stageEl, opts) -> Promise`（`opts = { modelUrl, crowdModelUrl }`；renderer／scene／OrbitControls／Bloom 沿用樣本頁設定：`ColorManagement.legacyMode = false`、HalfFloat 合成目標、`GammaCorrectionShader`；小夜站在本殿前；群眾圖集用程式版 VRM）
  - `sync(s, alpha)`：`s.mapVer` 改變或任何 Struct 的 `build`／`mods`／`broken` 改變時重建該建物；每幀更新動畫與客人位置（前一次與這一次模擬位置依 `alpha` 內插）
  - `pickTile(clientX, clientY) -> { x, y } | null`、`ghost(type, x, y, ok)`／`ghost(null)`、`focusGuest(gid|null)`、`bubble(m)`、`tileToWorld(x, y) -> { x, z }`
  - `setWeather(id)`：晴＝藍天、陰＝灰天、雨＝雨滴粒子（`THREE.Points`，往下落、碰地重置）＋地面變暗、強風＝旗幟與燈籠擺動＋停駛設施掛「本日運休」牌
- 建物造型（全部 three.js 基本形狀；動畫以 `group.userData` 驅動）：

| type | 造型 | 動畫 | 改裝後的外觀 |
| --- | --- | --- | --- |
| shrine | 拜殿＋四角錐屋頂＋發光門＋鳥居；旁邊一面繪馬牆（木板，每個未完成願望掛一片小木牌） | 無 | — |
| merry | 圓台＋6 根柱＋唐獅子（Box 身＋Sphere 頭，紅金配色）＋圓錐帳篷＋燈泡圈 | 整組轉、獅子上下 | light：燈泡變暖色發光；deco：其中 2 隻獅子變金色；drive：轉速 ×1.5 |
| cups | 圓盤＋6 個茶碗（Lathe 杯形，抹茶綠） | 圓盤轉、杯子自轉 | drive：轉速 ×1.5 |
| chairs | 中柱＋頂部紙風車＋8 條鏈＋座椅 | 頂部轉、座椅依轉速外甩 | light：鏈上加燈串 |
| wheel | 樣本頁的摩天輪（環、輻條、燈）＋8 個車廂 | 繞 Z 轉、車廂保持水平 | cabin：車廂改成玻璃（透明＋邊框）；light：燈變彩色漸變 |
| kingyo／shateki／wanage／omikuji | 攤位箱＋屋頂＋CanvasTexture 招牌（樣本頁的 `signMaterial`） | 無 | — |
| takoyakiSt／ameSt／ramuneSt／kasaSt／juyo | 同上，招牌文字取 `D.BUILD[type].name.ja`；和傘攤掛幾把傘 | 無 | — |
| qstall | 小推車＋招牌，朝向連結的設施 | 無 | — |
| bench／toilet／trash／shelter／lanternPost／flower | 小物件（shelter 是竹柱＋帆布頂；lanternPost 發光） | lanternPost 微閃 | — |

- 施工中（`build > 0`）：建物只畫地基＋鷹架（細圓柱格子）＋施工圍籬，頂上浮一個「施工中 N」的 Sprite。
- 故障：建物上方紅色「×」標記，動畫停止。
- 客人：`crowd.set(i, wx, 0.02, wz, dir, outfit × FRAMES + frame, 0.9 + (gid % 7) × 0.025)`；`ride` 狀態不畫；`queue` 沿入口往外排成一列（每人 0.6 m）；持傘客人（`kasa`）頭上加一個小傘（InstancedMesh 圓錐）。

- [ ] **Step 1: 實作 `ennichi_3d.js`**

依上表實作。檔頭註解寫明：只讀 `s`、不呼叫 `Core.applyIntent`；內插用的前一幀位置由 `sync` 自己保存。

- [ ] **Step 2: 語法與單獨載入檢查**

Run: `node --check static_src/ennichi_3d.js && py -3 generate.py`
暫時的 Playwright 腳本（不提交）在 `ennichi/index.html` 執行：

```js
await page.evaluate(async function () {
  var C = window.PriTestEnnichiCore, D = window.PriTestEnnichiData;
  var s = C.newGame({ seed: 1 });
  C.give(s, D.BUILD.merry.parts); C.build(s, "merry", 4, 6); C.build(s, "takoyakiSt", 10, 8);
  await window.PriTestEnnichi3D.init(document.querySelector("#en-stage"), { modelUrl: "../static/models/ennichi/sayo_blender.vrm", crowdModelUrl: "../static/models/ennichi/sayo.vrm" });
  window.PriTestEnnichi3D.sync(s, 1);
  window.PriTestEnnichi3D.setWeather("rain");
});
```

Expected: 沒有 `pageerror`；截圖看得到參道、本殿、施工中的旋轉木馬（鷹架）、章魚燒攤、雨滴。

- [ ] **Step 3: Commit**

```bash
git add static_src/ennichi_3d.js static_src/css/ennichi.css
git commit -m "feat(ennichi): 3D 樂園（程序化設施與動畫、施工鷹架、改裝外觀、天氣、群眾、小夜、繪馬牆）"
```

---

### Task 15: 畫面 `ennichi.js`

**Files:**
- Modify: `static_src/ennichi.js`（整檔改寫）、`static_src/css/ennichi.css`、`site_src/i18n_ennichi.py`

**Interfaces:**
- Consumes: `Core.*`、`Sim.*`、`Murmur.*`、`Wish.*`、`PriTestEnnichi3D.*`、`D.*`
- Produces（`window.PriTestEnnichiGame`，供測試）：`_state() -> s`、`_intent(it) -> { ok, err }`、`_speed() -> 0|1|2|4`、`_fast`（測試用：每次推進 `max(速度, _fast || 0)` 遊戲分鐘，預設 undefined）
- 存檔：`localStorage["pritest-ennichi-save"]`（`applyIntent` 成功、打烊、換日後寫入；讀寫包 try/catch）
- 時間：營業中每真實 0.4 秒推進 1 遊戲分鐘 × 速度；3D 以 `requestAnimationFrame` 內插
- 選擇器（測試與樣式共用，不得改名）：

| 選擇器 | 用途 |
| --- | --- |
| `#en-title-screen`、`#en-btn-new`、`#en-btn-continue` | 標題 |
| `#en-hud`、`#en-hud-day`、`#en-hud-time`、`#en-hud-cash`、`#en-hud-rep`、`#en-hud-guests`、`#en-hud-weather` | HUD |
| `#en-forecast`（今天起 3 天的天氣圖示與名稱） | 天氣預報（開園前顯示） |
| `#en-btn-open`、`#en-btn-pause`、`#en-btn-speed-1`、`#en-btn-speed-2`、`#en-btn-speed-4` | 開園與速度 |
| `#en-stage` | 3D 舞台 |
| `#en-minimap`（canvas，每格 10px） | 小地圖：步道／建物（施工中斜線）／客人點；放置模式下點擊格子＝放置 |
| `#en-tab-build`、`#en-tab-work`、`#en-tab-park`、`#en-tab-wish`、`#en-tab-murmur` | 側欄分頁 |
| `[data-build="<type>"]`（顯示所需材料與是否足夠）、`#en-btn-path`、`#en-btn-unpath`、`#en-btn-cancel` | 建造 |
| `[data-buy="<item>"]`（每按一次買 10） | 市場 |
| `#en-warehouse`（依層級分組：原料／第一層／第二層／第三層模組／改裝模組／商品） | 倉庫 |
| `[data-machine="<type>"]`、`select[data-recipe="<machineIndex>"]`、`[data-progress="<machineIndex>"]` | 工房 |
| `#en-recipe-tree`、`[data-tree="<itemId>"]` | 配方樹：點任一物品，顯示它的配方往下展開到原料（含目前庫存） |
| `[data-struct="<sid>"]`、`#en-struct-panel`、`#en-btn-repair`、`#en-btn-demolish`、`#en-price-input`、`#en-ticket-toggle`、`[data-upgrade="<slot>"]` | 設施資訊（磨損、施工剩餘天數、昨天平均等待、改裝槽與需要的模組、整理券開關） |
| `#en-fee-input` | 入園費 |
| `#en-wish-board`、`[data-wish="<id>"]` | 繪馬牆：未完成願望（頭像、內容、進度、剩餘天數）＋最近完成的 |
| `#en-murmur-wall`、`[data-mm-filter="<type>"]` | murmur 牆 |
| `#en-follow-panel` | 跟拍（點 3D 客人或 murmur） |
| `#en-day-summary`、`#en-btn-next-day` | 日結算（天氣、來客、營收、平均心情、口碑變化、完成願望數、今日話題前三、SNS） |
| `#en-season-summary`、`#en-btn-restart` | 季末總結 |

- 建造錯誤訊息：`en_err_<err>`（`phase／level／bounds／locked／occupied／entrance／noride／parts／cash`）顯示 3 秒。
- 新增 i18n 鍵（zh／ja）：`en_new`、`en_continue`、`en_open`、`en_pause`、`en_day`、`en_cash`、`en_rep`、`en_level`、`en_guests`、`en_weather`、`en_forecast`、`en_tab_build`、`en_tab_work`、`en_tab_park`、`en_tab_wish`、`en_tab_murmur`、`en_path`、`en_unpath`、`en_cancel`、`en_market`、`en_warehouse`、`en_tier_0`〜`en_tier_3`、`en_tier_upgrade`、`en_tier_goods`、`en_machines`、`en_add_machine`、`en_recipe`、`en_recipe_tree`、`en_repair`、`en_demolish`、`en_price`、`en_fee`、`en_wear`、`en_broken`、`en_building`（施工中，剩 {n} 天）、`en_queue`、`en_last_wait`、`en_ticket`、`en_upgrade`、`en_upgraded`、`en_wish_title`、`en_wish_days`、`en_wish_done`、`en_summary_title`、`en_summary_guests`、`en_summary_rev`、`en_summary_hap`、`en_summary_rep`、`en_summary_wishes`、`en_summary_topics`、`en_summary_sns`、`en_next_day`、`en_season_title`、`en_restart`、`en_follow`、`en_need_fun`、`en_need_hunger`、`en_need_thirst`、`en_need_toilet`、`en_need_fatigue`、`en_need_dry`、`en_hap`、`en_err_*`（9 個）、`en_topic_<topic>`（queue、broken、expensive、soldout、litter、wind、rain、shrine、recommend、photo、goods、ticket、qstall、kasa、wish；設施 type 的話題直接顯示設施名）
- 版面：桌機「3D 舞台（左）＋側欄（右 340px）」；寬度 < 860px 時側欄移到舞台下方、HUD 縮成兩行；小地圖固定在側欄頂端。

- [ ] **Step 1: 實作畫面與字串**

依上表實作。進入遊戲時才動態載入 `three.min.js` → `ennichi_vrm.js`，再 `PriTestEnnichi3D.init`；3D 失敗時仍可用小地圖遊玩（顯示一行錯誤訊息）。每天開園時呼叫 `PriTestEnnichi3D.setWeather(s.today.weather)`；新的 murmur 呼叫 `bubble(m)`。

- [ ] **Step 2: 檢查**

Run: `node --check static_src/ennichi.js && py -3 generate.py && py -3 tools/split_css.py --check`
Expected: 無錯誤；split_css exit 0。

- [ ] **Step 3: Commit**

```bash
git add static_src/ennichi.js static_src/css/ennichi.css site_src/i18n_ennichi.py
git commit -m "feat(ennichi): 遊戲畫面（HUD、天氣預報、建造、工房與配方樹、設施改裝與整理券、繪馬牆、murmur 牆、日結算、季末）"
```

---

### Task 16: 瀏覽器檢查 `ui_check.js`

**Files:**
- Create: `tools/ennichi_check/ui_check.js`
- Modify: `.gitignore`（加 `tools/ennichi_check/shots/`，若已有萬用規則則略過）

- [ ] **Step 1: 寫檢查腳本**

```js
// ============================================================================
// 緣日樂園（ennichi）的瀏覽器檢查（Playwright）。先 py -3 generate.py，再起本機伺服器：
//   py -3 -m http.server 8962 --directory dist
//   node tools/ennichi_check/ui_check.js
// 流程：標題 → 新遊戲 → 小地圖放置章魚燒攤 → 墊旋轉木馬的模組後放置（施工中）→ 市場買料 → 設定工房配方
//       → 開園 4 倍速跑完一天 → 日結算 → 下一天（旋轉木馬完工）→ 改裝、整理券、修理 → 繪馬牆
//       → 重新整理後「繼續」讀回同一天 → 手機寬度無橫向捲動。
// 觸發一律 dispatchEvent；小地圖是靜態 canvas，用 page.mouse 點格子。
// ============================================================================
"use strict";
var assert = require("assert"), path = require("path");
var pw = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] }));
var BASE = process.env.EN_BASE || "http://localhost:8962/ennichi/index.html";
var SHOTS = path.join(__dirname, "shots");
require("fs").mkdirSync(SHOTS, { recursive: true });

async function act(page, sel) { await page.waitForSelector(sel, { state: "attached", timeout: 20000 }); await page.dispatchEvent(sel, "click"); await page.waitForTimeout(80); }
async function st(page) { return page.evaluate(function () { return window.PriTestEnnichiGame._state(); }); }
async function clickTile(page, x, y) {
  var box = await (await page.$("#en-minimap")).boundingBox();
  await page.mouse.click(box.x + (x + 0.5) * 10, box.y + (y + 0.5) * 10);
  await page.waitForTimeout(80);
}
function sidOf(s, type) { return Object.keys(s.structs).filter(function (k) { return s.structs[k].type === type; })[0]; }

(async function () {
  var browser = await pw.chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  var errors = [];
  var page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("pageerror", function (e) { errors.push(e.message); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () { try { localStorage.removeItem("pritest-ennichi-save"); } catch (e) {} });
  await page.reload();
  await act(page, "#en-btn-new");
  await page.waitForSelector("#en-hud", { timeout: 60000 });
  var s = await st(page);
  assert.strictEqual(s.phase, "plan");
  assert.ok((await page.$$("#en-forecast > *")).length === 3, "顯示 3 天預報");

  // 放置：章魚燒攤（一般設施，當天完成）
  await act(page, "#en-tab-build");
  await act(page, "[data-build=\"takoyakiSt\"]"); await clickTile(page, 10, 8);
  // 旋轉木馬：先墊模組（測試捷徑）再放置 → 施工中
  await page.evaluate(function () { var g = window.PriTestEnnichiGame, D = window.PriTestEnnichiData; window.PriTestEnnichiCore.give(g._state(), D.BUILD.merry.parts); });
  await act(page, "[data-build=\"merry\"]"); await clickTile(page, 4, 6);
  s = await st(page);
  assert.ok(sidOf(s, "takoyakiSt") && sidOf(s, "merry"), "放置成功");
  assert.strictEqual(s.structs[sidOf(s, "merry")].build, 1, "旋轉木馬施工中");
  var cash = s.cash;
  await act(page, "[data-build=\"kingyo\"]"); await clickTile(page, 5, 7);
  assert.strictEqual((await st(page)).cash, cash, "重疊時不扣錢");
  await act(page, "#en-btn-cancel");

  // 工房：買料、配方樹
  await act(page, "#en-tab-work");
  await act(page, "[data-buy=\"octopus\"]"); await act(page, "[data-buy=\"flour\"]");
  s = await st(page); assert.ok(s.ware.octopus >= 10 && s.ware.flour >= 10);
  await act(page, "[data-tree=\"lionPost\"]");
  var tree = await page.textContent("#en-recipe-tree");
  assert.ok(tree.indexOf("原木") >= 0, "獅子柱組的配方樹展開到原木（zh、ja 同字）");

  // 開園跑一天
  await act(page, "#en-btn-open");
  await act(page, "#en-btn-speed-4");
  await page.evaluate(function () { window.PriTestEnnichiGame._fast = 40; });
  await page.screenshot({ path: path.join(SHOTS, "open.png") });
  await page.waitForSelector("#en-day-summary", { timeout: 120000 });
  s = await st(page);
  assert.strictEqual(s.phase, "close"); assert.ok(s.history[0].guests > 0);
  assert.ok((await page.$$("#en-murmur-wall .en-wall-item")).length > 0, "murmur 牆有內容");
  await page.screenshot({ path: path.join(SHOTS, "summary.png") });
  await act(page, "#en-btn-next-day");
  s = await st(page);
  assert.strictEqual(s.day, 2); assert.strictEqual(s.structs[sidOf(s, "merry")].build, 0, "隔天完工");

  // 改裝、整理券、修理
  var merrySid = sidOf(s, "merry");
  await page.evaluate(function (sid) {
    var g = window.PriTestEnnichiGame, s = g._state();
    window.PriTestEnnichiCore.give(s, { nightLanterns: 2, gear: 4 });
    s.structs[sid].wear = 100; s.structs[sid].broken = true;
  }, merrySid);
  await act(page, "#en-tab-park");
  await act(page, "[data-struct=\"" + merrySid + "\"]");
  await act(page, "[data-upgrade=\"light\"]");
  await act(page, "#en-ticket-toggle");
  await act(page, "#en-btn-repair");
  s = await st(page);
  assert.ok(s.structs[merrySid].mods.light, "裝上夜光燈籠串");
  assert.ok(s.structs[merrySid].ticket, "整理券開啟");
  assert.ok(!s.structs[merrySid].broken, "修好了");

  // 繪馬牆
  await page.evaluate(function () { var g = window.PriTestEnnichiGame; window.PriTestEnnichiWish.maybeMake(g._state(), null, true); });
  await act(page, "#en-tab-wish");
  assert.ok((await page.$$("#en-wish-board [data-wish]")).length >= 1, "繪馬牆有願望");

  // 讀檔
  await page.reload();
  await act(page, "#en-btn-continue");
  await page.waitForSelector("#en-hud", { timeout: 60000 });
  s = await st(page);
  assert.strictEqual(s.day, 2, "讀回第 2 天");

  // 手機寬度（新的瀏覽器環境沒有存檔 → 新遊戲）
  var m = await (await browser.newContext(pw.devices["iPhone 13"])).newPage();
  m.on("pageerror", function (e) { errors.push("mobile: " + e.message); });
  await m.goto(BASE);
  await m.dispatchEvent("#en-btn-new", "click");
  await m.waitForSelector("#en-hud", { timeout: 60000 });
  var over = await m.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  assert.ok(over <= 0, "手機無橫向捲動：" + over);
  await m.screenshot({ path: path.join(SHOTS, "mobile.png") });

  assert.deepStrictEqual(errors, [], "沒有 JS 錯誤：\n" + errors.join("\n"));
  console.log("ui OK");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 執行**

Run:
```bash
py -3 generate.py
py -3 -m http.server 8962 --directory dist   # 另一個終端機
node tools/ennichi_check/ui_check.js
```
Expected: `ui OK`；`tools/ennichi_check/shots/` 有 `open.png`、`summary.png`、`mobile.png`。

- [ ] **Step 3: Commit**

```bash
git add tools/ennichi_check/ui_check.js .gitignore
git commit -m "test(ennichi): Playwright 瀏覽器檢查（放置、施工、工房、營業、改裝、整理券、修理、繪馬、讀檔、手機）"
```

---

### Task 17: 收尾——規格、版本、推送

**Files:**
- Modify: `docs/ennichi_rules.md`、`site_src/version.py`、`CLAUDE.md`（若有新的測試注意事項）

- [ ] **Step 1: 規格同步**

`docs/ennichi_rules.md`：
- 標題下加一行：「MVP（完成日期）已實作：§2（春季 28 天）、§4.4〜§4.6、§5.1〜§5.6、§6.3 人氣等級、§6.4、§7.1（倉庫直連）、§7.3」，對應條目的 📝 改成 ✅。
- 若 Task 12 調整了數值，在 §7.3 註明「實際數值以 `ennichi_data.js` 為準（Task 12 平衡調整後）」。
- §10 的 MVP 列標 ✅。

- [ ] **Step 2: 全部檢查**

Run:
```bash
node tools/ennichi_check/core_check.js
node tools/ennichi_check/sim.js && node tools/ennichi_check/sim.js 7 && node tools/ennichi_check/sim.js 99
py -3 generate.py
node tools/ennichi_check/ui_check.js
```
Expected: `1〜10 OK`、三次 `sim OK`、`ui OK`。

- [ ] **Step 3: 版本與推送**

`site_src/version.py` 遞增 minor（例：`2.55.3` → `2.56.0`），再 `py -3 generate.py`。

```bash
git add docs/ennichi_rules.md site_src/version.py
git commit -m "feat(ennichi): v2.56.0 緣日樂園 MVP（三層生產鏈、組裝期、改裝、繪馬、天氣、排隊屋台與整理券、3D 樂園）"
git push -u private starv-stage3d
```

---

## 自我檢查（撰寫時已對照規格）

- §2 時間：Task 11（開園／營業／打烊、28 天、週末 ×1.8）；季末祭典日屬 v1，MVP 以季末總結代替。
- §4.4 建造層級：Task 2 的資料與檢查強制「大型＝只用模組、一般＝第二層以下」。§4.5 組裝期：Task 3（`build`）、Task 11（打烊 −1）、Task 14（鷹架）。§4.6 改裝：Task 5、Task 14（外觀）、Task 15（面板）。§4.3 磨損故障修理：Task 7、Task 11。
- §5 客人：Task 6〜9；§5.5 天氣：Task 3（天氣表）、Task 8、Task 14；§5.6 排隊屋台與整理券：Task 3（連結）、Task 9；murmur 9 類中 MVP 產生 impression／complaint／need／recommend／sns，其餘類型保留在 `TYPES`。
- §6.3 人氣等級與機器槽：Task 3。§6.4 繪馬：Task 10、Task 14（繪馬牆）、Task 15（繪馬分頁）。
- §7.1／§7.3 工房與生產鏈：Task 2、Task 4、Task 12（需求展開排程證明 40 條配方可在 10 天內做出旋轉木馬）、Task 15（配方樹）。
- §8〜§9：沿用 `ennichi_vrm.js` 與樣本頁的群眾技術（Task 13、14）。
- 型別一致性：`Struct`／`Guest`／`Today`／`Summary`／`Murmur`／`Wish` 欄位在開頭定義；`applyIntent` 的動作字串在 Task 11 定義，Task 12、15、16 使用相同字串；測試共用的 `finishAll`、`freshPark`、`sidOf`、`openToday`、`walker` 依序在 Task 5、6、7 定義後，之後的 Task 才使用。
