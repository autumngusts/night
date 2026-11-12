# 緣日樂園 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出「緣日樂園」（7 四季神社祭典＋6 遊樂園工房）的 MVP：春季 28 天、神社參道上的 8 種遊樂設施＋4 種攤位＋設施、工房生產鏈、客人 AI（需求、尋路、排隊、搭乘、消費）、murmur（碎碎念）、日循環與口碑，以及 3D 樂園畫面（看板人物群眾＋VRM 巫女小夜）。

**Architecture:** 規則全部是純函式，狀態是一個可 JSON 化的物件 `s`；所有玩家操作經由 `Core.applyIntent(s, it)`，時間推進經由 `Core.tick(s, 分鐘數)`（內部每遊戲分鐘呼叫一次 `Sim.step` 與 `Core.workshopStep`）。模擬是固定步長（1 遊戲分鐘）、種子亂數，Node 可以直接重播檢查。畫面分兩層：`ennichi.js`（HUD、面板、2D 小地圖放置）與 `ennichi_3d.js`（three.js 樂園、動畫、群眾、murmur 氣泡），3D 只讀 `s`、不改規則。

**Tech Stack:** Vanilla ES5 IIFE（`window.PriTestEnnichi*`）、three.js r149（`static/vendor/three.min.js`）＋`static/vendor/ennichi_vrm.js`（GLTFLoader／OrbitControls／Bloom／three-vrm 3.5.5，已在樣本階段建好）、Python `generate.py` 建置、Node 檢查腳本、Playwright。

**Spec:** `docs/ennichi_rules.md`（§1〜§7 遊戲規則、§8〜§9 人物呈現與技術、§10 開發階段）

**範圍：** 本計畫只做規格 §10 的「MVP」。v1（四季循環、季末祭典日、宣傳、原創商品設計、主要角色 VRM、夜景）、v2（刺激區、妖怪區、拉線雲霄飛車、合作商品、常客劇情、土地擴張）、v3（大型活動、門前町、狐狸列車、多人合作）各自另寫計畫。人物呈現樣本（`ennichi_lab.js`、Blender 管線）依使用者指示（2026-11-12）**暫停**，本計畫只把樣本頁搬到 `ennichi/lab/`，不再修改它的內容。

## Global Constraints

- 所有說明文件、commit message、程式註解中的說明用**繁體中文**；識別字維持英文。
- JS 一律 ES5（`var`、`function`；不用箭頭函式／class／let／const／template literal），每個檔案是 IIFE，掛在 `window.PriTestEnnichi*`。
- 遊戲專屬前綴：CSS class／id `en-`、i18n 鍵 `en_`、命名空間 `PriTestEnnichi`。不得修改其他遊戲的 JS／CSS（CLAUDE.md §5.2.1）。
- 遊戲樣式只放 `static_src/css/ennichi.css`；UI 字串放 `site_src/i18n_ennichi.py`（zh、ja；en 只放標題與首頁卡片）；遊戲資料文字放 `static_src/ennichi_data.js` 的 `C(zh, ja)`。
- 立繪一律沿用 `static/images/jikan/`（使用者指定 2026-11-12）；murmur 頭像用 `n_000`〜`n_031`（制服頭像，不暴露）。
- 全年齡內容：murmur 的戀愛類只寫心動程度。
- 模擬必須是決定性的：只能用 `Core.rnd(s)`／`Core.rint(s, n)` 取亂數，不得用 `Math.random`（3D 的純視覺效果除外）。
- 每次修改 `site_src/` 或 `static_src/` 後執行 `py -3 generate.py`；JS 修改後至少 `node --check static_src/<file>.js`。
- Playwright 觸發按鈕一律用 `page.dispatchEvent(sel, "click")`（HUD 每幀重繪，`page.click` 會逾時，CLAUDE.md §4.6）。
- 推送：`git push -u private starv-stage3d`（`origin` 已停用；本工作指定分支 `starv-stage3d`）。完成時 `site_src/version.py` 遞增 minor，commit message 註明版本。
- commit message 結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## 檔案結構

| 檔案 | 職責 | Task |
| --- | --- | --- |
| `site_src/ennichi_page.py` | 遊戲頁 `build_ennichi_html()`＋樣本頁 `build_ennichi_lab_html()`、`ENNICHI_SCRIPTS`、`ENNICHI_LAB_SCRIPTS` | 1 |
| `site_src/i18n_ennichi.py` | UI 字串（之後各 Task 追加）、`ENNICHI_PROJECT` | 1、10、11 |
| `generate.py`、`site_src/i18n_data.py`、`site_src/projects.py` | 註冊 | 1 |
| `static_src/css/ennichi.css` | 樣式（樣本頁的 `.en-` 樣式保留） | 1、11 |
| `static_src/ennichi_data.js` | 地圖、物品、配方、機器、建物、客群、常數 | 2 |
| `static_src/ennichi_core.js` | 新局、亂數、地圖與建造、倉庫、市場、工房、日循環、`applyIntent`、`tick`、存檔 | 3、4、7 |
| `static_src/ennichi_sim.js` | 客人：生成、需求、尋路、排隊、搭乘、攤位、設施、磨損故障、髒亂 | 5、6 |
| `static_src/ennichi_murmur.js` | murmur 範本、產生、今日話題 | 6 |
| `static_src/ennichi_crowd.js` | 看板人物圖集＋群眾 InstancedBufferGeometry（從 `ennichi_lab.js` 抽出，遊戲與樣本頁共用） | 9 |
| `static_src/ennichi_3d.js` | 3D 樂園：地面、步道、建物、設施動畫、群眾、小夜、murmur 氣泡 | 10 |
| `static_src/ennichi.js` | 畫面：標題、HUD、面板、小地圖放置、murmur 牆、跟拍、日結算、季末總結 | 11 |
| `tools/ennichi_check/core_check.js` | Node 規則檢查 | 2〜7 |
| `tools/ennichi_check/sim.js` | 28 天平衡模擬（機器人經營） | 8 |
| `tools/ennichi_check/ui_check.js` | Playwright 瀏覽器檢查 | 12 |

腳本載入順序（`ENNICHI_SCRIPTS`）：
`ennichi_data.js` → `ennichi_murmur.js` → `ennichi_core.js` → `ennichi_sim.js` → `ennichi_crowd.js` → `ennichi_3d.js` → `ennichi.js`
（`three.min.js` 與 `ennichi_vrm.js` 由 `ennichi.js` 進入遊戲時動態載入，比照樣本頁。）

**關於 Task 10、11：** 規則層（Task 2〜8）附完整程式與測試；3D（Task 10）與畫面（Task 11）以「介面合約」描述——函式簽名、造型與動畫對照表、選擇器表、i18n 鍵、版面規則——由實作者依合約撰寫，並以 Task 12 的瀏覽器檢查驗收。兩者大量沿用 `ennichi_lab.js` 已驗證過的程式（燈光、Bloom、招牌、摩天輪、murmur 氣泡）。

## 狀態 `s`（Task 3 建立；之後只增加欄位，不改名）

```
{ v: 1, seed, rs,                       // 種子與亂數狀態
  day: 1, phase: "plan"|"open"|"close"|"season", min: 540,   // 遊戲時間（分鐘，540 = 9:00）
  cash, rep: 0, fee,                    // 資金、口碑點數、入園費
  tiles: [0|1],                         // 地圖：0 草地、1 步道（長度 W×H，index = y*W+x）
  occ: [0|sid],                         // 每格被哪個建物佔用
  structs: { sid: Struct }, nextId, mapVer,
  ware: { itemId: n },                  // 倉庫
  machines: [ { type, rid, t } ],       // 工房機器；t = null 待機、數字 = 已加工分鐘
  guests: [ Guest ], nextGid,
  dirt: 0,                              // 髒亂度（當天累積、打烊歸零）
  today: Today|null, history: [ Summary ], photos: [ "n_000", ... ] }

Struct = { id, type, x, y, wear: 0, broken: false, price, q: [gid], riders: [gid], t: 0, fixes: 0 }
Guest  = { id, type, outfit, photo, x, y, state, sid, need: { fun, hunger, thirst, toilet, fatigue },
           hap, cash, patience, wait, t, leaving, spent, rides }
Today  = { guests: 0, left: 0, rev: 0, fees: 0, hapSum: 0, hapN: 0, sns: 0, made: {}, spawn: [ 分鐘 ],
           murmurs: [ Murmur ], topics: { key: n } }
Summary = { day, guests, rev, avgHap, repDelta, sns, topTopics: [ [key, n] ] }
Murmur = { t, day, gid, photo, type, text: { zh, ja }, topic }
```

---

### Task 1: 骨架與建置註冊（樣本頁搬到 `ennichi/lab/`）

**Files:**
- Modify: `site_src/ennichi_page.py`、`generate.py`（`build_pages()`、copy 清單、`main()` 清除清單已有 `ennichi`）、`site_src/projects.py`、`site_src/i18n_ennichi.py`、`site_src/i18n_data.py`、`static_src/css/ennichi.css`
- Create: `static_src/ennichi.js`（暫時骨架）

**Interfaces:**
- Produces: `ENNICHI_SCRIPTS`、`ENNICHI_LAB_SCRIPTS = ("ennichi_lab.js",)`、`build_ennichi_html()`、`build_ennichi_lab_html()`；遊戲頁根元素
  `<div id="en-game" data-three-src data-vendor-src data-model="../static/models/ennichi/sayo_blender.vrm" data-model-crowd="../static/models/ennichi/sayo.vrm" data-jikan="../static/images/jikan/">`；
  樣本頁維持 `#en-app`（`ennichi_lab.js` 不改），網址 `ennichi/lab/index.html`。
- `ENNICHI_PROJECT`（zh／ja／en 的 `project_ennichi_name`、`project_ennichi_desc`）。

- [ ] **Step 1: 改寫頁面模組**

`site_src/ennichi_page.py` 整檔改成：

```python
"""緣日樂園（ennichi）的頁面。

遊戲頁 ennichi/index.html：神社遊樂園經營（規格 docs/ennichi_rules.md，計畫 docs/superpowers/plans/2026-11-12-ennichi-mvp.md）。
規則在 static/ennichi_data.js → ennichi_murmur.js → ennichi_core.js → ennichi_sim.js，
畫面在 ennichi_crowd.js（看板人物）→ ennichi_3d.js（three.js 樂園）→ ennichi.js（HUD、面板）。
樣本頁 ennichi/lab/index.html：人物呈現技術驗證（VRM 近景、看板人物、murmur、立繪），2026-11-12 起暫停修改。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

ENNICHI_SCRIPTS: tuple[str, ...] = (
    "ennichi_data.js",
    "ennichi_murmur.js",
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
- copy 清單的 `*ENNICHI_SCRIPTS,` 下一行加 `*ENNICHI_LAB_SCRIPTS,`
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

`site_src/i18n_ennichi.py` 末尾加（並在 `site_src/i18n_data.py` 的 import 與三個語言字典加上 `ENNICHI_PROJECT`，比照 `CHAMP_PROJECT`）：

```python
ENNICHI_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_ennichi_name": "緣日樂園", "project_ennichi_desc": "神社遊樂園經營：在老工房把木材、鐵料加工成零件與章魚燒，蓋旋轉木馬、摩天輪、金魚撈攤位；看客人排隊、搭乘、碎碎念，用口碑讓沒落的小神社熱鬧起來"},
    "ja": {"project_ennichi_name": "縁日遊園", "project_ennichi_desc": "神社の遊園地経営：古い工房で木材や鉄を部品やたこ焼きに加工し、メリーゴーランド・観覧車・金魚すくいを建てる。お客さんの行列やつぶやきを眺め、口コミで寂れた神社をにぎやかに"},
    "en": {"project_ennichi_name": "Ennichi Park", "project_ennichi_desc": "Run a shrine-side amusement park: turn lumber and iron into parts and takoyaki in the old workshop, build carousels, a Ferris wheel and goldfish stalls, and watch guests queue, ride and murmur"},
}
```

- [ ] **Step 3: 遊戲頁骨架**

`static_src/ennichi.js`：

```js
// ============================================================================
// 緣日樂園：畫面（HUD、面板、小地圖、murmur 牆）。Task 11 會整檔改寫；這裡先放骨架確認建置。
// ============================================================================
(function () {
  "use strict";
  var root = document.getElementById("en-game");
  if (!root) return;
  root.innerHTML = '<h1 class="en-title" data-i18n="en_title"></h1>';
  if (window.I18N) window.I18N.applyI18n();
})();
```

`site_src/i18n_ennichi.py` 三個語言各加 `"en_title"`：zh `"緣日樂園"`、ja `"縁日遊園"`、en `"Ennichi Park"`。

- [ ] **Step 4: 建置並確認**

Run: `py -3 generate.py && ls dist/ennichi dist/ennichi/lab && py -3 tools/split_css.py --check`
Expected: `Generated site into ...`；`dist/ennichi/index.html`、`dist/ennichi/lab/index.html` 都存在；split_css 無輸出、exit 0。
再開 `py -3 -m http.server 8962 --directory dist`，瀏覽器確認 `ennichi/lab/index.html` 樣本仍能載入（VRM、群眾、murmur），`ennichi/index.html` 顯示標題，首頁有「緣日樂園」卡片。

- [ ] **Step 5: Commit**

```bash
git add site_src/ennichi_page.py site_src/projects.py site_src/i18n_ennichi.py site_src/i18n_data.py generate.py static_src/ennichi.js
git commit -m "feat(ennichi): 遊戲頁骨架與首頁登錄，樣本頁移到 ennichi/lab/"
```

---

### Task 2: 資料——地圖、物品、配方、機器、建物、客群

**Files:**
- Create: `static_src/ennichi_data.js`、`tools/ennichi_check/core_check.js`

**Interfaces:**
- Produces（`window.PriTestEnnichiData`，以下簡稱 `D`）：
  - `D.C(zh, ja)`；`D.MAP = { W: 32, H: 20, TILE: 2, GATE: { x: 0, y: 10 }, UNLOCK_X: 22, SHRINE: { x: 26, y: 8, w: 4, h: 4 } }`
  - 時間：`D.DAY_START = 540`、`D.DAY_END = 1020`、`D.LAST_ENTRY = 900`、`D.SEASON_DAYS = 28`
  - 經濟：`D.START_CASH = 3000`、`D.ENTRY_FEE = 200`、`D.PATH_COST = 10`、`D.WARE_CAP = 300`、`D.MACHINE_SLOTS = 8`、`D.REFUND = 0.5`
  - `D.POP_LEVELS = [0, 50, 150, 300, 600]`（口碑點數門檻 → 人氣 Lv1〜5）
  - `D.ITEMS[id] = { kind: "mat"|"part"|"food"|"drink"|"goods", buy?, sell?, fill?: { need: n }, joy?, name }`
  - `D.MACHINES[type] = { cost, name }`、`D.RECIPES[rid] = { m: 機器type, in: {item: n}, out: {item: n}, t: 分鐘 }`
  - `D.BUILD[type] = { kind: "ride"|"stall"|"facility"|"deco"|"shrine", w, h, cash, parts: {item: n}, lv, name, ... }`
    - ride：`cap, cycle, price, thrill, charm, photo, wear, fix: {item: n}`
    - stall：`sells: [itemId]`
    - facility：`serves: "fatigue"|"toilet"|"trash"`、`cap`、`time`
    - deco：`joy`（周圍 2 格內每分鐘心情加成）
  - `D.GUESTS = [{ id, w, cash: [min, max], pref: { thrill, charm, photo }, patience, name }]`
  - `D.NEED_RATE = { fun, hunger, thirst, toilet, fatigue }`、`D.NEED_TO = { fun: ["ride", "shrine"], hunger: ["food"], thirst: ["drink"], toilet: ["toilet"], fatigue: ["fatigue"] }`
  - `D.GUEST_SPEED = 2`（格／分鐘）、`D.OUTFITS = 4`（看板圖集的服裝列數）、`D.PHOTOS`（`n_000`〜`n_031`）
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
["ennichi_data.js", "ennichi_murmur.js", "ennichi_core.js", "ennichi_sim.js"].forEach(function (f) {
  var p = path.join(SRC, f);
  if (fs.existsSync(p)) eval.call(global, fs.readFileSync(p, "utf8"));
});
var D = window.PriTestEnnichiData;

// ---------------- 1. 資料完整性 ----------------
(function () {
  var items = Object.keys(D.ITEMS);
  Object.keys(D.RECIPES).forEach(function (rid) {
    var r = D.RECIPES[rid];
    assert.ok(D.MACHINES[r.m], rid + " 的機器不存在：" + r.m);
    Object.keys(r.in).concat(Object.keys(r.out)).forEach(function (k) { assert.ok(D.ITEMS[k], rid + " 的物品不存在：" + k); });
    assert.ok(r.t > 0, rid + " 加工時間 > 0");
  });
  // 每個零件、商品都至少有一條配方做得出來；原料都能買
  items.forEach(function (k) {
    var it = D.ITEMS[k];
    if (it.kind === "mat") assert.ok(it.buy > 0, k + " 要有買價");
    else assert.ok(Object.keys(D.RECIPES).some(function (r) { return D.RECIPES[r].out[k]; }), k + " 沒有配方");
    if (it.kind === "food" || it.kind === "drink" || it.kind === "goods") assert.ok(it.sell > 0, k + " 要有售價");
  });
  var rides = 0, stalls = 0;
  Object.keys(D.BUILD).forEach(function (t) {
    var b = D.BUILD[t];
    assert.ok(b.w >= 1 && b.h >= 1 && b.lv >= 1 && b.lv <= 5, t + " 尺寸／等級");
    Object.keys(b.parts || {}).forEach(function (k) { assert.ok(D.ITEMS[k], t + " 的零件不存在：" + k); });
    if (b.kind === "ride") {
      rides++;
      assert.ok(b.cap > 0 && b.cycle > 0 && b.price >= 0 && b.wear > 0, t + " 搭乘數值");
      Object.keys(b.fix).forEach(function (k) { assert.ok(D.ITEMS[k], t + " 的修理零件不存在：" + k); });
    }
    if (b.kind === "stall") {
      stalls++;
      b.sells.forEach(function (k) { assert.ok(["food", "drink", "goods"].indexOf(D.ITEMS[k].kind) >= 0, t + " 賣的不是商品：" + k); });
    }
  });
  assert.strictEqual(rides, 8, "MVP 設施 8 種（規格 §10）");
  assert.strictEqual(stalls, 4, "MVP 攤位 4 種");
  assert.ok(D.BUILD.shrine && D.BUILD.shrine.kind === "shrine", "神社本殿");
  var w = D.GUESTS.reduce(function (a, g) { return a + g.w; }, 0);
  assert.ok(Math.abs(w - 1) < 1e-9, "客群權重合計 1");
  // 開局倉庫剛好夠蓋旋轉木馬（教學的第一步）
  Object.keys(D.BUILD.merry.parts).forEach(function (k) { assert.ok((D.START_WARE[k] || 0) >= D.BUILD.merry.parts[k], "開局零件不夠蓋旋轉木馬：" + k); });
  assert.strictEqual(D.PHOTOS.length, 32);
  console.log("1. 資料 OK");
})();
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: FAIL（`Cannot read properties of undefined (reading 'RECIPES')`）

- [ ] **Step 3: 寫資料**

`static_src/ennichi_data.js`：

```js
// ============================================================================
// 緣日樂園：遊戲資料（規格 docs/ennichi_rules.md §4〜§7；MVP 範圍見計畫 2026-11-12-ennichi-mvp.md）。
// 只放資料與常數，規則在 ennichi_core.js／ennichi_sim.js。
// ============================================================================
(function () {
  "use strict";
  function C(zh, ja) { return { zh: zh, ja: ja || zh }; }
  var D = { C: C };

  // 地圖：32×20 格（1 格 = 2 m）。入口在左邊中央，參道一路通到右邊的神社本殿；x ≥ UNLOCK_X 是 v2 擴張用的土地（MVP 不能蓋）
  D.MAP = { W: 32, H: 20, TILE: 2, GATE: { x: 0, y: 10 }, UNLOCK_X: 22, SHRINE: { x: 26, y: 8, w: 4, h: 4 } };
  D.DAY_START = 540; // 9:00
  D.DAY_END = 1020; // 17:00 閉園（客人開始離場）
  D.LAST_ENTRY = 900; // 15:00 以後不再進場
  D.SEASON_DAYS = 28;
  D.START_CASH = 3000;
  D.ENTRY_FEE = 200;
  D.PATH_COST = 10;
  D.WARE_CAP = 300;
  D.MACHINE_SLOTS = 8;
  D.REFUND = 0.5;
  D.POP_LEVELS = [0, 50, 150, 300, 600];
  D.GUEST_SPEED = 2;
  D.OUTFITS = 4;

  D.ITEMS = {
    // 原料（市場購買）
    wood: { kind: "mat", buy: 10, name: C("原木", "原木") },
    iron: { kind: "mat", buy: 15, name: C("鐵料", "鉄材") },
    copper: { kind: "mat", buy: 25, name: C("銅線", "銅線") },
    glass: { kind: "mat", buy: 12, name: C("玻璃", "ガラス") },
    cloth: { kind: "mat", buy: 12, name: C("布料", "布") },
    sugar: { kind: "mat", buy: 5, name: C("砂糖", "砂糖") },
    flour: { kind: "mat", buy: 5, name: C("麵粉", "小麦粉") },
    octopus: { kind: "mat", buy: 20, name: C("章魚", "タコ") },
    apple: { kind: "mat", buy: 8, name: C("蘋果", "りんご") },
    // 零件（工房加工）
    plank: { kind: "part", name: C("木板", "板材") },
    carving: { kind: "part", name: C("雕刻木件", "彫刻パーツ") },
    metal: { kind: "part", name: C("金屬零件", "金属部品") },
    frame: { kind: "part", name: C("鋼骨架", "鉄骨フレーム") },
    motor: { kind: "part", name: C("馬達", "モーター") },
    bulb: { kind: "part", name: C("燈泡", "電球") },
    canvas: { kind: "part", name: C("帆布", "帆布") },
    // 商品（攤位販售）
    takoyaki: { kind: "food", sell: 300, fill: { hunger: 45 }, name: C("章魚燒", "たこ焼き") },
    ringoame: { kind: "food", sell: 250, fill: { hunger: 15, fun: 10 }, name: C("蘋果糖", "りんご飴") },
    wataame: { kind: "food", sell: 200, fill: { hunger: 10, fun: 10 }, name: C("棉花糖", "わたあめ") },
    ramune: { kind: "drink", sell: 150, fill: { thirst: 55 }, name: C("彈珠汽水", "ラムネ") },
    omamori: { kind: "goods", sell: 500, joy: 12, name: C("限定御守", "限定お守り") },
  };

  D.MACHINES = {
    saw: { cost: 200, name: C("製材機", "製材機") },
    carve: { cost: 300, name: C("雕刻台", "彫刻台") },
    press: { cost: 300, name: C("沖壓機", "プレス機") },
    weld: { cost: 500, name: C("焊接台", "溶接台") },
    wind: { cost: 600, name: C("繞線機", "巻線機") },
    kiln: { cost: 400, name: C("燈泡爐", "電球炉") },
    sew: { cost: 300, name: C("縫紉台", "ミシン台") },
    kitchen: { cost: 300, name: C("鐵板灶", "鉄板かまど") },
    candy: { cost: 300, name: C("糖果鍋", "飴鍋") },
    bottle: { cost: 400, name: C("裝瓶機", "瓶詰め機") },
    craft: { cost: 400, name: C("御守工坊", "お守り工房") },
  };

  D.RECIPES = {
    plank: { m: "saw", in: { wood: 1 }, out: { plank: 2 }, t: 3 },
    carving: { m: "carve", in: { plank: 2 }, out: { carving: 1 }, t: 6 },
    metal: { m: "press", in: { iron: 1 }, out: { metal: 1 }, t: 3 },
    frame: { m: "weld", in: { metal: 3 }, out: { frame: 1 }, t: 8 },
    motor: { m: "wind", in: { copper: 2, metal: 1 }, out: { motor: 1 }, t: 10 },
    bulb: { m: "kiln", in: { glass: 1 }, out: { bulb: 2 }, t: 4 },
    canvas: { m: "sew", in: { cloth: 2 }, out: { canvas: 1 }, t: 5 },
    takoyaki: { m: "kitchen", in: { flour: 1, octopus: 1 }, out: { takoyaki: 6 }, t: 5 },
    ringoame: { m: "candy", in: { sugar: 1, apple: 1 }, out: { ringoame: 4 }, t: 4 },
    wataame: { m: "candy", in: { sugar: 1 }, out: { wataame: 5 }, t: 3 },
    ramune: { m: "bottle", in: { glass: 1, sugar: 1 }, out: { ramune: 6 }, t: 4 },
    omamori: { m: "craft", in: { cloth: 1 }, out: { omamori: 3 }, t: 6 },
  };

  D.BUILD = {
    shrine: { kind: "shrine", w: 4, h: 4, cash: 0, parts: {}, lv: 1, fun: 20, photo: 2, name: C("神社本殿", "本殿") },
    // 和風遊樂區
    merry: { kind: "ride", w: 4, h: 4, cash: 800, parts: { carving: 6, metal: 6, canvas: 1, motor: 1, bulb: 10 }, lv: 1, cap: 12, cycle: 4, price: 300, thrill: 1, charm: 3, photo: 2, wear: 4, fix: { metal: 2 }, name: C("唐獅子旋轉木馬", "唐獅子メリーゴーランド") },
    cups: { kind: "ride", w: 3, h: 3, cash: 600, parts: { metal: 8, frame: 1, motor: 1 }, lv: 1, cap: 8, cycle: 3, price: 250, thrill: 2, charm: 2, photo: 1, wear: 5, fix: { metal: 2 }, name: C("茶碗咖啡杯", "茶碗コーヒーカップ") },
    chairs: { kind: "ride", w: 4, h: 4, cash: 900, parts: { frame: 2, metal: 6, motor: 1, canvas: 1 }, lv: 2, cap: 12, cycle: 4, price: 350, thrill: 3, charm: 1, photo: 1, wear: 6, fix: { metal: 3 }, name: C("紙風車旋轉飛椅", "風車ブランコ") },
    wheel: { kind: "ride", w: 6, h: 6, cash: 2000, parts: { frame: 6, metal: 10, motor: 2, bulb: 20 }, lv: 3, cap: 24, cycle: 10, price: 500, thrill: 1, charm: 2, photo: 3, wear: 3, fix: { metal: 3, bulb: 2 }, name: C("燈籠摩天輪", "灯籠観覧車") },
    // 參道緣日區（攤位遊戲：小容量、短週期）
    kingyo: { kind: "ride", w: 2, h: 2, cash: 150, parts: { plank: 4, canvas: 1 }, lv: 1, cap: 4, cycle: 3, price: 200, thrill: 0, charm: 2, photo: 1, wear: 2, fix: { plank: 1 }, name: C("金魚撈", "金魚すくい") },
    shateki: { kind: "ride", w: 2, h: 2, cash: 150, parts: { plank: 4, metal: 2 }, lv: 1, cap: 3, cycle: 2, price: 200, thrill: 1, charm: 1, photo: 0, wear: 2, fix: { plank: 1 }, name: C("射擊攤", "射的") },
    wanage: { kind: "ride", w: 2, h: 2, cash: 100, parts: { plank: 4 }, lv: 1, cap: 4, cycle: 2, price: 150, thrill: 0, charm: 1, photo: 0, wear: 1, fix: { plank: 1 }, name: C("套圈圈", "輪投げ") },
    omikuji: { kind: "ride", w: 2, h: 2, cash: 120, parts: { plank: 3, carving: 1 }, lv: 1, cap: 2, cycle: 1, price: 100, thrill: 0, charm: 2, photo: 2, wear: 1, fix: { plank: 1 }, name: C("抽籤所", "おみくじ所") },
    // 攤位
    takoyakiSt: { kind: "stall", w: 2, h: 2, cash: 120, parts: { plank: 4, canvas: 1 }, lv: 1, sells: ["takoyaki"], name: C("章魚燒攤", "たこ焼き屋") },
    ameSt: { kind: "stall", w: 2, h: 2, cash: 120, parts: { plank: 4, canvas: 1 }, lv: 1, sells: ["ringoame", "wataame"], name: C("糖果攤", "飴屋") },
    ramuneSt: { kind: "stall", w: 2, h: 2, cash: 100, parts: { plank: 4 }, lv: 1, sells: ["ramune"], name: C("汽水攤", "ラムネ屋") },
    juyo: { kind: "stall", w: 2, h: 2, cash: 150, parts: { plank: 4, carving: 1 }, lv: 2, sells: ["omamori"], name: C("授與所", "授与所") },
    // 設施與裝飾
    bench: { kind: "facility", w: 1, h: 1, cash: 30, parts: { plank: 2 }, lv: 1, serves: "fatigue", cap: 2, time: 5, name: C("長椅", "ベンチ") },
    toilet: { kind: "facility", w: 2, h: 2, cash: 200, parts: { plank: 6 }, lv: 1, serves: "toilet", cap: 3, time: 2, name: C("廁所", "トイレ") },
    trash: { kind: "facility", w: 1, h: 1, cash: 20, parts: { metal: 1 }, lv: 1, serves: "trash", cap: 0, time: 0, name: C("垃圾桶", "ゴミ箱") },
    lantern: { kind: "deco", w: 1, h: 1, cash: 40, parts: { bulb: 2, plank: 1 }, lv: 1, joy: 0.06, name: C("石燈籠", "石灯籠") },
    flower: { kind: "deco", w: 1, h: 1, cash: 20, parts: {}, lv: 1, joy: 0.04, name: C("花圃", "花壇") },
  };

  // 客群（規格 §5.1；MVP 先 6 種，外國觀光客與御宅族在 v1／v2）
  D.GUESTS = [
    { id: "family", w: 0.25, cash: [1500, 3000], pref: { thrill: 0.2, charm: 1, photo: 0.4 }, patience: 25, name: C("親子", "親子") },
    { id: "couple", w: 0.2, cash: [1500, 2500], pref: { thrill: 0.4, charm: 0.6, photo: 1 }, patience: 30, name: C("情侶", "カップル") },
    { id: "student", w: 0.2, cash: [600, 1200], pref: { thrill: 0.8, charm: 0.5, photo: 0.4 }, patience: 20, name: C("學生", "学生") },
    { id: "thrill", w: 0.1, cash: [1000, 2000], pref: { thrill: 1, charm: 0.1, photo: 0.2 }, patience: 35, name: C("刺激派", "絶叫派") },
    { id: "photo", w: 0.15, cash: [1000, 2000], pref: { thrill: 0.2, charm: 0.6, photo: 1 }, patience: 25, name: C("拍照派", "映え派") },
    { id: "elder", w: 0.1, cash: [1000, 2000], pref: { thrill: 0, charm: 0.8, photo: 0.3 }, patience: 40, name: C("老人家", "お年寄り") },
  ];

  // 需求每分鐘增加量（0〜100）；需求 → 可以滿足它的建物分類（stall 依販售商品的 kind 判斷 food／drink）
  D.NEED_RATE = { fun: 0.3, hunger: 0.2, thirst: 0.25, toilet: 0.15, fatigue: 0.12 };
  D.NEED_TO = { fun: ["ride", "shrine"], hunger: ["food"], thirst: ["drink"], toilet: ["toilet"], fatigue: ["fatigue"] };

  D.PHOTOS = [];
  for (var i = 0; i < 32; i++) D.PHOTOS.push("n_" + (i < 10 ? "00" : "0") + i);

  // 開局：倉庫裡剛好夠蓋一座旋轉木馬＋兩個攤位＋幾張長椅；工房有 4 台機器
  D.START_WARE = { plank: 24, carving: 6, metal: 10, canvas: 3, motor: 1, bulb: 10, flour: 10, octopus: 10, sugar: 10, glass: 6 };
  D.START_MACHINES = ["saw", "carve", "press", "kitchen"];

  window.PriTestEnnichiData = D;
})();
```

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/ennichi_data.js && node tools/ennichi_check/core_check.js`
Expected: `1. 資料 OK`

- [ ] **Step 5: Commit**

```bash
git add static_src/ennichi_data.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 遊戲資料（地圖、物品、配方、機器、建物、客群）與檢查腳本"
```

---

### Task 3: 核心——新局、亂數、地圖與建造、倉庫、市場、存檔

**Files:**
- Create: `static_src/ennichi_core.js`
- Modify: `tools/ennichi_check/core_check.js`

**Interfaces:**
- Consumes: `D.*`
- Produces（`window.PriTestEnnichiCore`，之後 Task 繼續擴充同一物件）：
  - `newGame({ seed }) -> s`（欄位見本計畫開頭「狀態 `s`」）
  - `rnd(s) -> [0,1)`、`rint(s, n) -> 0..n-1`、`pickW(s, list) -> list 的一個元素（依 .w 權重）`
  - `ti(x, y) -> index`、`inMap(x, y)`、`isPath(s, x, y)`、`entranceOf(st) -> { x, y }`（建物底邊中央的下一格）
  - `popLevel(s) -> 1..5`
  - `have(s, map) -> bool`、`take(s, map)`、`give(s, map)`、`wareTotal(s)`
  - `canBuild(s, type, x, y) -> { ok, err }`（err：`"phase"|"level"|"bounds"|"locked"|"occupied"|"entrance"|"parts"|"cash"`）
  - `build(s, type, x, y) -> { ok, err, sid }`、`demolish(s, sid) -> bool`
  - `setPath(s, x, y, on) -> bool`
  - `buy(s, item, n) -> bool`、`addMachine(s, type) -> bool`、`setRecipe(s, mi, rid) -> bool`、`setPrice(s, sid, price) -> bool`、`setFee(s, fee) -> bool`
  - `serialize(s) -> string`、`restore(str) -> s|null`

- [ ] **Step 1: 追加失敗的測試**

```js
// ---------------- 2. 新局、地圖、建造、倉庫、市場、存檔 ----------------
var Core = window.PriTestEnnichiCore;
(function () {
  var s = Core.newGame({ seed: 7 });
  var M = D.MAP;
  assert.strictEqual(s.phase, "plan"); assert.strictEqual(s.day, 1); assert.strictEqual(s.cash, D.START_CASH);
  assert.strictEqual(s.tiles.length, M.W * M.H);
  // 參道：入口到神社前一格都是步道；神社已經蓋好
  for (var x = 0; x < M.SHRINE.x; x++) assert.ok(Core.isPath(s, x, M.GATE.y), "參道 " + x);
  var shrine = Object.keys(s.structs).map(function (k) { return s.structs[k]; }).filter(function (st) { return st.type === "shrine"; })[0];
  assert.ok(shrine, "有神社");
  assert.deepStrictEqual(s.ware.plank, D.START_WARE.plank);
  assert.strictEqual(s.machines.length, D.START_MACHINES.length);
  assert.strictEqual(s.photos.length, 32);
  // 亂數可重播
  var a = Core.newGame({ seed: 99 }), b = Core.newGame({ seed: 99 });
  assert.deepStrictEqual([Core.rnd(a), Core.rnd(a), Core.rint(a, 10)], [Core.rnd(b), Core.rnd(b), Core.rint(b, 10)]);
  // 建造：入口要接步道；不能重疊；不能蓋在未開放的土地
  assert.strictEqual(Core.canBuild(s, "merry", 4, 5).err, "entrance", "入口(6,9) 不是步道");
  var r = Core.canBuild(s, "merry", 4, 6); // 4×4，入口 (6,10) 在參道上
  assert.ok(r.ok, JSON.stringify(r));
  r = Core.build(s, "merry", 4, 6);
  assert.ok(r.ok && r.sid);
  assert.strictEqual(s.cash, D.START_CASH - D.BUILD.merry.cash);
  assert.strictEqual(s.ware.carving || 0, D.START_WARE.carving - D.BUILD.merry.parts.carving);
  assert.strictEqual(Core.canBuild(s, "kingyo", 5, 8).err, "occupied");
  assert.strictEqual(Core.canBuild(s, "kingyo", 23, 8).err, "locked", "x≥UNLOCK_X 是擴張用地");
  assert.strictEqual(Core.canBuild(s, "kingyo", 31, 19).err, "bounds");
  assert.strictEqual(Core.canBuild(s, "wheel", 10, 4).err, "level", "摩天輪要人氣 Lv3");
  assert.strictEqual(Core.canBuild(s, "cups", 10, 7).err, "parts", "開局沒有鋼骨架");
  assert.deepStrictEqual(Core.entranceOf(s.structs[r.sid]), { x: 6, y: 10 });
  // 步道：鋪一格扣錢；建物的入口格不能拆
  var cash = s.cash;
  assert.ok(Core.setPath(s, 6, 11, true)); assert.strictEqual(s.cash, cash - D.PATH_COST);
  assert.ok(!Core.setPath(s, 6, 10, false), "入口格不能拆");
  // 拆除：退一半現金、空出格子
  cash = s.cash;
  assert.ok(Core.demolish(s, r.sid));
  assert.strictEqual(s.cash, cash + Math.floor(D.BUILD.merry.cash * D.REFUND));
  assert.ok(Core.canBuild(s, "kingyo", 5, 8).ok);
  // 市場：只有原料能買；倉庫上限
  cash = s.cash;
  assert.ok(Core.buy(s, "wood", 5)); assert.strictEqual(s.cash, cash - 50); assert.strictEqual(s.ware.wood, 5);
  assert.ok(!Core.buy(s, "plank", 1), "零件不能買");
  assert.ok(!Core.buy(s, "wood", D.WARE_CAP), "超過倉庫上限");
  // 機器與配方
  assert.ok(Core.addMachine(s, "weld"));
  assert.ok(Core.setRecipe(s, s.machines.length - 1, "frame"));
  assert.ok(!Core.setRecipe(s, s.machines.length - 1, "plank"), "焊接台不能製材");
  // 人氣等級
  s.rep = 160; assert.strictEqual(Core.popLevel(s), 3);
  // 存檔
  var t = Core.restore(Core.serialize(s));
  assert.deepStrictEqual(t, s);
  assert.strictEqual(Core.restore("{bad"), null);
  console.log("2. 核心（地圖、建造、倉庫）OK");
})();
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: `1. 資料 OK` 後 FAIL（`Cannot read properties of undefined (reading 'newGame')`）

- [ ] **Step 3: 寫核心**

`static_src/ennichi_core.js`：

```js
// ============================================================================
// 緣日樂園：核心規則（純函式；狀態 s 可 JSON 化）。
//   新局、亂數、地圖與建造、倉庫、市場、工房（Task 4）、日循環與 applyIntent／tick（Task 7）、存檔。
//   客人模擬在 ennichi_sim.js；murmur 在 ennichi_murmur.js。
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

  // ---- 倉庫
  function wareTotal(s) { var n = 0; for (var k in s.ware) n += s.ware[k]; return n; }
  function have(s, map) { for (var k in map) if ((s.ware[k] || 0) < map[k]) return false; return true; }
  function take(s, map) { for (var k in map) { s.ware[k] = (s.ware[k] || 0) - map[k]; if (!s.ware[k]) delete s.ware[k]; } }
  function give(s, map) { for (var k in map) s.ware[k] = (s.ware[k] || 0) + map[k]; }

  function shuffled(s, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = rint(s, i + 1), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  function newGame(opt) {
    var s = {
      v: 1, seed: opt.seed | 0, rs: opt.seed | 0,
      day: 1, phase: "plan", min: D.DAY_START,
      cash: D.START_CASH, rep: 0, fee: D.ENTRY_FEE,
      tiles: [], occ: [], structs: {}, nextId: 1, mapVer: 1,
      ware: {}, machines: [], guests: [], nextGid: 1,
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
    s.photos = shuffled(s, D.PHOTOS);
    return s;
  }

  function place(s, type, x, y) {
    var b = D.BUILD[type], sid = s.nextId++;
    s.structs[sid] = { id: sid, type: type, x: x, y: y, wear: 0, broken: false, price: b.price || 0, q: [], riders: [], t: 0, fixes: 0 };
    for (var yy = y; yy < y + b.h; yy++) for (var xx = x; xx < x + b.w; xx++) s.occ[ti(xx, yy)] = sid;
    s.mapVer++;
    return sid;
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
    return { ok: true, err: null, sid: place(s, type, x, y) };
  }

  function demolish(s, sid) {
    var st = s.structs[sid];
    if (!st || st.type === "shrine" || s.phase !== "plan") return false;
    var b = D.BUILD[st.type];
    for (var yy = st.y; yy < st.y + b.h; yy++) for (var xx = st.x; xx < st.x + b.w; xx++) s.occ[ti(xx, yy)] = 0;
    s.cash += Math.floor(b.cash * D.REFUND);
    delete s.structs[sid];
    s.mapVer++;
    return true;
  }

  function isEntranceTile(s, x, y) {
    for (var k in s.structs) { var e = entranceOf(s.structs[k]); if (e.x === x && e.y === y) return true; }
    return false;
  }

  function setPath(s, x, y, on) {
    if (s.phase !== "plan" || !inMap(x, y) || x >= M.UNLOCK_X && !(y === M.GATE.y && x < M.SHRINE.x)) return false;
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
    give(s, (function () { var o = {}; o[item] = n; return o; })());
    return true;
  }

  function addMachine(s, type) {
    var m = D.MACHINES[type];
    if (!m || s.phase !== "plan" || s.machines.length >= D.MACHINE_SLOTS || s.cash < m.cost) return false;
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
    rnd: rnd, rint: rint, pickW: pickW, ti: ti, inMap: inMap, isPath: isPath, entranceOf: entranceOf, popLevel: popLevel,
    wareTotal: wareTotal, have: have, take: take, give: give,
    newGame: newGame, canBuild: canBuild, build: build, demolish: demolish, setPath: setPath,
    buy: buy, addMachine: addMachine, setRecipe: setRecipe, setPrice: setPrice, setFee: setFee,
    serialize: serialize, restore: restore,
  };
})();
```

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/ennichi_core.js && node tools/ennichi_check/core_check.js`
Expected: `1. 資料 OK`、`2. 核心（地圖、建造、倉庫）OK`

- [ ] **Step 5: Commit**

```bash
git add static_src/ennichi_core.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 核心——新局、亂數、地圖與建造、倉庫、市場、存檔"
```

---

### Task 4: 工房生產

**Files:**
- Modify: `static_src/ennichi_core.js`、`tools/ennichi_check/core_check.js`

**Interfaces:**
- Consumes: `have`、`take`、`give`、`wareTotal`
- Produces: `Core.workshopStep(s)`：每遊戲分鐘呼叫一次。每台機器：`t === null` 且有配方、原料足夠、倉庫放得下產出 → 扣原料、`t = 0`；`t !== null` → `t++`，`t >= r.t` → 產出進倉庫、`s.today.made[產物] += n`（`s.today` 為 null 時不記）、`t = null`。
- 規格差異（寫進規格 §7.1）：MVP 的工房是「機器直接從倉庫取料、產出放回倉庫」，輸送帶與格子配置延後到 v1。

- [ ] **Step 1: 追加失敗的測試**

```js
// ---------------- 3. 工房 ----------------
(function () {
  var s = Core.newGame({ seed: 3 });
  s.ware = { wood: 2, iron: 1 };
  s.machines = [{ type: "saw", rid: "plank", t: null }, { type: "press", rid: "metal", t: null }, { type: "weld", rid: "frame", t: null }];
  s.today = { made: {} };
  Core.workshopStep(s); // 製材機開工：用掉 1 原木
  assert.strictEqual(s.ware.wood, 1); assert.strictEqual(s.machines[0].t, 0);
  assert.strictEqual(s.machines[2].t, null, "焊接台缺料不開工");
  for (var i = 0; i < 3; i++) Core.workshopStep(s);
  assert.strictEqual(s.ware.plank, 2, "3 分鐘後產出 2 木板");
  assert.strictEqual(s.today.made.plank, 2);
  assert.strictEqual(s.machines[0].t, null, "產出那一分鐘歸零待機，下一分鐘才取料");
  Core.workshopStep(s);
  assert.strictEqual(s.machines[0].t, 0, "下一分鐘取第 2 根原木開工"); assert.strictEqual(s.ware.wood || 0, 0);
  // 倉庫滿了不開工
  var t = Core.newGame({ seed: 4 });
  t.ware = { wood: D.WARE_CAP };
  t.machines = [{ type: "saw", rid: "plank", t: null }];
  Core.workshopStep(t);
  assert.strictEqual(t.machines[0].t, null, "放不下產出（+2−1 會超過上限）就不開工");
  console.log("3. 工房 OK");
})();
```

規則：**每台機器每分鐘只做一件事**——加工中就推進、完成那一分鐘產出並歸 `null`；待機的下一分鐘才取料。

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: FAIL（`Core.workshopStep is not a function`）

- [ ] **Step 3: 實作**

在 `ennichi_core.js` 的 `serialize` 之前加入，並加進匯出物件：

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

匯出物件加 `workshopStep: workshopStep,`。

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/ennichi_core.js && node tools/ennichi_check/core_check.js`
Expected: `3. 工房 OK`

- [ ] **Step 5: 規格同步並 Commit**

`docs/ennichi_rules.md` §7.1 第一點後加一行：`* MVP：機器直接從倉庫取料、產出放回倉庫（沒有輸送帶）；格子配置與輸送帶在 v1。`

```bash
git add static_src/ennichi_core.js tools/ennichi_check/core_check.js docs/ennichi_rules.md
git commit -m "feat(ennichi): 工房生產（倉庫取料、加工、產出）"
```

---

### Task 5: 客人——生成、需求、尋路、選目的地

**Files:**
- Create: `static_src/ennichi_sim.js`
- Modify: `tools/ennichi_check/core_check.js`

**Interfaces:**
- Consumes: `Core.rnd/rint/pickW/ti/inMap/isPath/entranceOf`、`D.GUESTS/NEED_RATE/NEED_TO/GUEST_SPEED/MAP`
- Produces（`window.PriTestEnnichiSim`）：
  - `distField(s, key) -> Int16Array`：從 `key` 的目標格（`"gate"` 或建物 sid 的入口）沿步道 BFS 的距離；不可達 = -1。以 `s.mapVer` 作快取（模組內變數，不進存檔）。
  - `arrivals(s) -> number`：今日來客數 `round((30 + rep × 0.6) × (週末 ? 1.8 : 1))`；週末 = `day % 7` 為 6 或 0。
  - `spawnSchedule(s) -> [分鐘]`：`arrivals` 個介於 `DAY_START`〜`LAST_ENTRY` 的整數分鐘，排序。
  - `spawn(s) -> Guest`：在入口生成（扣 `fee` 進 `s.cash`、`today.fees`），`type` 依 `pickW`、`outfit = rint(D.OUTFITS)`、`photo = s.photos[id % 32]`、`need` 每項 `rint(30)`、`hap = 60`、`cash` 依客群區間、`patience` 依客群。
  - `kindOf(st) -> "ride"|"shrine"|"food"|"drink"|"fatigue"|"toilet"|"trash"|"deco"`
  - `choose(s, g) -> sid|null`：取最急迫的需求（值最大者；全部 < 30 則視為 `fun`），在滿足它的建物中依 `score = 偏好×50 − 距離×1.5 − 排隊人數×3 + rnd×10` 選最高；`broken` 的設施與不可達者排除；選不到 → `null`。
  - `moveToward(s, g, key) -> bool`：沿距離場走 `GUEST_SPEED` 格，抵達目標格回傳 true。
  - `needsTick(s, g)`：每分鐘需求增加（依 `NEED_RATE`，上限 100），`fatigue` 在走路時再 +0.05；髒亂讓心情 `hap -= dirt × 0.002`；`hap` 夾在 0〜100。
- `Guest.state`：`"walk"|"queue"|"ride"|"rest"|"toilet"|"leave"`

- [ ] **Step 1: 追加失敗的測試**

```js
// ---------------- 4. 客人：生成、尋路、選目的地 ----------------
var Sim = window.PriTestEnnichiSim;
function freshPark(seed) {
  var s = Core.newGame({ seed: seed || 11 });
  Core.build(s, "merry", 4, 6);         // 入口 (6,10)
  Core.build(s, "takoyakiSt", 10, 8);   // 入口 (11,10)
  Core.build(s, "bench", 14, 9);        // 入口 (14,10)
  return s;
}
(function () {
  var s = freshPark();
  var gate = Sim.distField(s, "gate");
  assert.strictEqual(gate[Core.ti(0, 10)], 0); assert.strictEqual(gate[Core.ti(5, 10)], 5);
  assert.strictEqual(gate[Core.ti(5, 5)], -1, "草地不可走");
  var merryId = Object.keys(s.structs).filter(function (k) { return s.structs[k].type === "merry"; })[0];
  var f = Sim.distField(s, merryId);
  assert.strictEqual(f[Core.ti(6, 10)], 0); assert.strictEqual(f[Core.ti(0, 10)], 6);
  // 快取：同一個 mapVer 回傳同一個陣列；改地圖後重算
  assert.strictEqual(Sim.distField(s, "gate"), gate);
  Core.setPath(s, 3, 11, true);
  assert.notStrictEqual(Sim.distField(s, "gate"), gate);
  // 來客數與排程
  assert.strictEqual(Sim.arrivals(s), 30);
  s.day = 6; s.rep = 100; assert.strictEqual(Sim.arrivals(s), Math.round(90 * 1.8));
  s.day = 1; s.rep = 0;
  var sch = Sim.spawnSchedule(s);
  assert.strictEqual(sch.length, 30);
  assert.ok(sch.every(function (m, i) { return m >= D.DAY_START && m <= D.LAST_ENTRY && (i === 0 || m >= sch[i - 1]); }));
  // 生成：入口、繳入園費
  s.today = { guests: 0, fees: 0, rev: 0, murmurs: [], topics: {} };
  var cash = s.cash, g = Sim.spawn(s);
  assert.deepStrictEqual([g.x, g.y], [0, 10]);
  assert.strictEqual(s.cash, cash + s.fee); assert.strictEqual(s.today.fees, s.fee);
  assert.ok(D.PHOTOS.indexOf(g.photo) >= 0);
  // 選目的地：肚子餓 → 章魚燒攤；累 → 長椅；想玩 → 旋轉木馬
  g.need = { fun: 0, hunger: 90, thirst: 0, toilet: 0, fatigue: 0 };
  assert.strictEqual(s.structs[Sim.choose(s, g)].type, "takoyakiSt");
  g.need = { fun: 0, hunger: 0, thirst: 0, toilet: 0, fatigue: 90 };
  assert.strictEqual(s.structs[Sim.choose(s, g)].type, "bench");
  g.need = { fun: 80, hunger: 0, thirst: 0, toilet: 0, fatigue: 0 };
  assert.ok(["merry", "shrine"].indexOf(s.structs[Sim.choose(s, g)].type) >= 0);
  g.need = { fun: 0, hunger: 0, thirst: 90, toilet: 0, fatigue: 0 };
  assert.strictEqual(Sim.choose(s, g), null, "沒有汽水攤");
  // 走路：每分鐘 2 格
  g.need = { fun: 0, hunger: 90, thirst: 0, toilet: 0, fatigue: 0 };
  g.sid = Sim.choose(s, g);
  assert.ok(!Sim.moveToward(s, g, g.sid)); assert.strictEqual(g.x, 2);
  for (var i = 0; i < 10 && !Sim.moveToward(s, g, g.sid); i++);
  assert.deepStrictEqual([g.x, g.y], [11, 10], "到達章魚燒攤入口");
  // 需求與心情
  var h = g.need.hunger; Sim.needsTick(s, g); assert.ok(g.need.hunger > h);
  console.log("4. 客人（生成、尋路、選目的地）OK");
})();
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: FAIL（`Cannot read properties of undefined (reading 'distField')`）

- [ ] **Step 3: 實作**

`static_src/ennichi_sim.js`（Task 6 會在同一檔案追加 `step`）：

```js
// ============================================================================
// 緣日樂園：客人模擬（固定步長，1 次 = 1 遊戲分鐘；只用 Core.rnd 取亂數，可重播）。
//   生成、需求、尋路（步道上的距離場）、選目的地（Task 5）
//   排隊、搭乘、攤位、設施、磨損故障、髒亂、離場、step（Task 6）
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
  function arrivals(s) { return Math.round((30 + s.rep * 0.6) * (isWeekend(s.day) ? 1.8 : 1)); }
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
      need: { fun: Core.rint(s, 30), hunger: Core.rint(s, 30), thirst: Core.rint(s, 30), toilet: Core.rint(s, 30), fatigue: Core.rint(s, 30) },
      hap: 60, cash: gt.cash[0] + Core.rint(s, gt.cash[1] - gt.cash[0] + 1), patience: gt.patience,
      wait: 0, t: 0, leaving: false, spent: 0, rides: 0,
    };
    s.cash += s.fee; g.cash -= s.fee;
    if (s.today) { s.today.fees += s.fee; s.today.guests++; }
    s.guests.push(g);
    return g;
  }

  function kindOf(st) {
    var b = D.BUILD[st.type];
    if (b.kind === "stall") return D.ITEMS[b.sells[0]].kind === "drink" ? "drink" : "food";
    if (b.kind === "facility") return b.serves;
    return b.kind;
  }

  function guestType(g) { for (var i = 0; i < D.GUESTS.length; i++) if (D.GUESTS[i].id === g.type) return D.GUESTS[i]; return D.GUESTS[0]; }

  function prefScore(g, st) {
    var b = D.BUILD[st.type], p = guestType(g).pref;
    if (b.kind === "ride" || b.kind === "shrine") return ((b.thrill || 0) * p.thrill + (b.charm || 0) * p.charm + (b.photo || 0) * p.photo) / 3;
    return 1;
  }

  function urgentNeed(g) {
    var best = "fun", v = -1;
    for (var k in g.need) if (g.need[k] > v) { v = g.need[k]; best = k; }
    return v < 30 ? "fun" : best;
  }

  function choose(s, g) {
    var need = urgentNeed(g), kinds = D.NEED_TO[need], best = null, bestScore = -1e9;
    for (var k in s.structs) {
      var st = s.structs[k];
      if (st.broken || kinds.indexOf(kindOf(st)) < 0) continue;
      var f = distField(s, k), d = f[Core.ti(g.x, g.y)];
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
    distField: distField, arrivals: arrivals, spawnSchedule: spawnSchedule, spawn: spawn,
    kindOf: kindOf, guestType: guestType, prefScore: prefScore, urgentNeed: urgentNeed,
    choose: choose, moveToward: moveToward, needsTick: needsTick, isWeekend: isWeekend,
  };
})();
```

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/ennichi_sim.js && node tools/ennichi_check/core_check.js`
Expected: `4. 客人（生成、尋路、選目的地）OK`

- [ ] **Step 5: Commit**

```bash
git add static_src/ennichi_sim.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 客人生成、需求、步道尋路與選目的地"
```

---

### Task 6: 排隊、搭乘、攤位、設施、故障、髒亂、離場＋murmur

**Files:**
- Create: `static_src/ennichi_murmur.js`
- Modify: `static_src/ennichi_sim.js`、`tools/ennichi_check/core_check.js`

**Interfaces:**
- Consumes: Task 5 的所有函式、`Core.have/take/rnd/rint`
- Produces:
  - `window.PriTestEnnichiMurmur`：
    - `TYPES = ["impression", "complaint", "need", "recommend", "sns", "gossip", "season", "love", "rival"]`（與樣本頁的 `en_mm_*` 字串鍵一致）
    - `say(s, g, type, topic, ctx) -> Murmur`：依 `type` 與 `topic` 挑範本（`Core.rint`），把 `{ride}`／`{food}`／`{item}` 換成 `ctx` 的 `C()` 名稱，推進 `s.today.murmurs`（上限 300，超過丟最舊）、`s.today.topics[topic]++`；`s.today` 為 null 時回傳 null。
    - `topTopics(s, n) -> [[topic, count]]`
  - `Sim.step(s)`：一遊戲分鐘的完整推進（見下方實作），由 `Core.tick` 呼叫。
  - 狀態轉移：
    - `walk`：`leaving` → 往 `"gate"` 走，到達即移除並 `finishGuest`；否則沒有 `sid` → `choose`（選不到且最急需求 ≥ 70 → `need` murmur、`hap -= 3`，改去逛：`sid = shrine`）；到達 `sid` 入口 → `arrive`
    - `arrive`：ride → `queue`（推進 `st.q`、`wait = 0`）；shrine → `fun −= 20`、`hap += 3`、20% `impression`（topic `shrine`）；stall → `buyAt`；fatigue → `rest`（`t = 5`）；toilet → `toilet`（`t = 2`）
    - `buyAt`：找第一個倉庫有貨且客人付得起的商品 → 扣 1、`cash/rev/spent`、`fill` 套用到需求、`hap += 3 + (goods 的 joy)`；吃完周圍 5 格（曼哈頓距離，以攤位入口計）沒有垃圾桶 → `dirt += 1`、20% `complaint`（topic `litter`）；全部賣完 → 30% `complaint`（topic `soldout`）、`hap -= 5`
    - ride 每分鐘：`st.t > 0` → `t--`，歸 0 時放出 riders（`fun −= 45 + 10×偏好`、`hap += 6 + 8×偏好 − 4×(wait/patience)`、`rides++`；25% `impression`（topic = 設施 type）；拍照派且 `photo ≥ 2` 且 `hap > 75` → 30% `sns`，`today.sns++`）；`wear += def.wear`，`wear ≥ 100` → `broken`，排隊者全部 `complaint`（topic `broken`）並離隊
    - ride 空檔：`riders` 空且 `q` 有人 → 依序上車最多 `cap` 人，付不起票價者離隊並 30% `complaint`（topic `expensive`），`st.t = cycle`
    - 排隊者每分鐘 `wait++`，`wait > patience` → 離隊、`hap -= 8`、40% `complaint`（topic `queue`）
    - `rest`／`toilet`：`t--`，歸 0 → `fatigue` 或 `toilet` 歸 0、`hap += 2`
    - 離場條件：`min ≥ DAY_END`、`hap < 15`、`fatigue ≥ 100`、`cash < 100` → `leaving = true`
    - `finishGuest`：`today.hapSum += hap`、`today.hapN++`；`hap ≥ 80` → 15% `recommend`（topic `recommend`）
    - 走在裝飾附近（2 格內的 lantern／flower）：`hap += joy`

- [ ] **Step 1: 追加失敗的測試**

```js
// ---------------- 5. 排隊、搭乘、攤位、設施、故障、murmur ----------------
var Murmur = window.PriTestEnnichiMurmur;
function openToday(s) { s.phase = "open"; s.min = D.DAY_START; s.today = { guests: 0, left: 0, rev: 0, fees: 0, hapSum: 0, hapN: 0, sns: 0, made: {}, spawn: [], murmurs: [], topics: {} }; }
function sid(s, type) { return +Object.keys(s.structs).filter(function (k) { return s.structs[k].type === type; })[0]; }
(function () {
  var s = freshPark(21); openToday(s);
  // murmur
  var g = Sim.spawn(s);
  var m = Murmur.say(s, g, "complaint", "queue", { ride: D.BUILD.merry.name });
  assert.ok(m.text.zh.length > 0 && m.text.zh.indexOf("{") < 0, "範本的變數都有換掉");
  assert.strictEqual(s.today.topics.queue, 1);
  assert.deepStrictEqual(Murmur.topTopics(s, 1), [["queue", 1]]);
  // 搭乘：排隊 → 上車 → 一輪後下車、付票價、樂趣下降、磨損
  var merry = s.structs[sid(s, "merry")];
  g.need = { fun: 90, hunger: 0, thirst: 0, toilet: 0, fatigue: 0 };
  g.sid = merry.id; g.x = 6; g.y = 10; g.cash = 5000;
  Sim.step(s);
  assert.strictEqual(g.state, "queue", "到達入口先排隊（設施在客人之前處理）");
  Sim.step(s);
  assert.strictEqual(g.state, "ride", "下一分鐘上車");
  assert.strictEqual(merry.riders.length, 1);
  for (var i = 0; i < D.BUILD.merry.cycle; i++) Sim.step(s);
  assert.strictEqual(g.state, "walk"); assert.ok(g.need.fun < 90); assert.strictEqual(g.rides, 1);
  assert.strictEqual(merry.wear, D.BUILD.merry.wear);
  assert.ok(s.today.rev >= merry.price);
  // 故障：wear ≥ 100 → broken、排隊者抱怨離隊、選目的地會排除
  merry.wear = 99; merry.q = [g.id]; g.state = "queue"; g.sid = merry.id;
  merry.riders = []; merry.t = 0;
  var g2 = Sim.spawn(s); g2.cash = 5000; g2.x = 6; g2.y = 10; g2.sid = merry.id; g2.need.fun = 90;
  Sim.step(s); // g 上車，一輪後 wear 會超過 100
  for (i = 0; i < D.BUILD.merry.cycle; i++) Sim.step(s);
  assert.ok(merry.broken, "磨損到 100 故障");
  assert.strictEqual(merry.q.length, 0);
  assert.notStrictEqual(g2.state, "queue", "排隊者被請出隊伍");
  g.need = { fun: 90, hunger: 0, thirst: 0, toilet: 0, fatigue: 0 }; g.sid = null;
  var pick = Sim.choose(s, g);
  assert.ok(pick === null || s.structs[pick].type !== "merry", "故障的設施不會被選");
  // 攤位：有貨就賣，賣完抱怨
  var t = freshPark(22); openToday(t);
  var c = Sim.spawn(t); c.cash = 5000; c.need.hunger = 90; c.x = 11; c.y = 10; c.sid = sid(t, "takoyakiSt");
  t.ware.takoyaki = 1;
  Sim.step(t);
  assert.strictEqual(t.ware.takoyaki || 0, 0); assert.ok(c.need.hunger < 90); assert.strictEqual(t.today.rev, D.ITEMS.takoyaki.sell);
  assert.ok(t.dirt >= 1, "附近沒有垃圾桶 → 髒亂");
  var c2 = Sim.spawn(t); c2.cash = 5000; c2.need.hunger = 90; c2.x = 11; c2.y = 10; c2.sid = sid(t, "takoyakiSt");
  var hap = c2.hap; Sim.step(t);
  assert.ok(c2.hap < hap, "賣完了心情下降");
  // 排隊太久 → 離隊
  var u = freshPark(23); openToday(u);
  var mm = u.structs[sid(u, "merry")]; mm.riders = [999]; mm.t = 50; // 一直有人在坐
  var w = Sim.spawn(u); w.cash = 5000; w.x = 6; w.y = 10; w.sid = mm.id; w.need.fun = 90;
  for (i = 0; i <= w.patience + 1; i++) Sim.step(u);
  assert.strictEqual(mm.q.indexOf(w.id), -1, "超過耐心離隊");
  // 離場：閉園時間後走回入口就消失，記錄滿意度
  u.min = D.DAY_END;
  for (i = 0; i < 40 && u.guests.length; i++) { Sim.step(u); u.min++; }
  assert.strictEqual(u.guests.length, 0); assert.ok(u.today.hapN >= 1);
  console.log("5. 搭乘、攤位、故障、murmur OK");
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
    },
    complaint: {
      queue: [C("{ride}排了好久……不排了", "{ride}、並びすぎ……もういいや"), C("隊伍都沒在動耶", "列が全然進まない")],
      broken: [C("{ride}突然停了！？", "{ride}止まっちゃった！？"), C("故障了啦，好可惜", "故障だって、残念")],
      expensive: [C("{ride}好貴……", "{ride}高いなあ……")],
      soldout: [C("{food}賣完了……", "{food}売り切れ……"), C("想吃的都沒了", "食べたいもの全部売り切れ")],
      litter: [C("垃圾桶好少，竹籤要丟哪", "ゴミ箱少なすぎ、串どこに捨てるの"), C("地上好多垃圾……", "地面にゴミが……")],
    },
    need: {
      hunger: [C("肚子好餓，附近沒有吃的", "お腹すいた、食べるとこない")],
      thirst: [C("好想喝冷飲，這附近都沒有賣", "冷たい飲み物ほしい、売ってない")],
      toilet: [C("廁所在哪裡啦——", "トイレどこー！")],
      fatigue: [C("走好累，想找張長椅坐一下", "歩き疲れた、ベンチ座りたい")],
      fun: [C("好像沒什麼好玩的……", "遊ぶものあんまりないね……")],
    },
    recommend: { recommend: [C("下次一定要帶朋友來！", "今度は友達も連れてくる！"), C("這裡比想像中好玩", "思ったより楽しかった")] },
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

在 `ennichi_sim.js` 的匯出物件之前加入：

```js
  function chance(s, p) { return Core.rnd(s) < p; }
  function mm(s, g, type, topic, ctx) { if (window.PriTestEnnichiMurmur) window.PriTestEnnichiMurmur.say(s, g, type, topic, ctx); }
  function byId(s, gid) { for (var i = 0; i < s.guests.length; i++) if (s.guests[i].id === gid) return s.guests[i]; return null; }
  function clampHap(g) { g.hap = Math.max(0, Math.min(100, g.hap)); }

  function nearTrash(s, x, y) {
    for (var k in s.structs) {
      var st = s.structs[k];
      if (st.type !== "trash") continue;
      if (Math.abs(st.x - x) + Math.abs(st.y - y) <= 5) return true;
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

  function buyAt(s, g, st) {
    var b = D.BUILD[st.type], sold = false;
    for (var i = 0; i < b.sells.length && !sold; i++) {
      var id = b.sells[i], it = D.ITEMS[id];
      if ((s.ware[id] || 0) < 1 || g.cash < it.sell) continue;
      s.ware[id]--; if (!s.ware[id]) delete s.ware[id];
      g.cash -= it.sell; g.spent += it.sell; s.cash += it.sell; s.today.rev += it.sell;
      for (var n in it.fill || {}) g.need[n] = Math.max(0, g.need[n] - it.fill[n]);
      g.hap += 3 + (it.joy || 0);
      if (it.kind === "goods" && guestType(g).id === "photo" && chance(s, 0.3)) { mm(s, g, "sns", "goods", { item: it.name }); s.today.sns++; }
      if (it.kind !== "goods") {
        var e = Core.entranceOf(st);
        if (!nearTrash(s, e.x, e.y)) { s.dirt += 1; if (chance(s, 0.2)) mm(s, g, "complaint", "litter", {}); }
      }
      sold = true;
    }
    if (!sold) { g.hap -= 5; if (chance(s, 0.3)) mm(s, g, "complaint", "soldout", { food: D.ITEMS[b.sells[0]].name }); }
    clampHap(g);
  }

  function arrive(s, g) {
    var st = s.structs[g.sid];
    if (!st) { g.sid = null; return; }
    var k = kindOf(st);
    if (k === "ride") {
      if (st.broken) { g.sid = null; return; }
      st.q.push(g.id); g.state = "queue"; g.wait = 0;
      return;
    }
    if (k === "shrine") {
      g.need.fun = Math.max(0, g.need.fun - 20); g.hap += 3; clampHap(g);
      if (chance(s, 0.2)) mm(s, g, "impression", "shrine", {});
    } else if (k === "food" || k === "drink") buyAt(s, g, st);
    else if (k === "fatigue") { g.state = "rest"; g.t = D.BUILD[st.type].time; return; }
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
    if (st.broken) return;
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
        if (g.type === "photo" && b.photo >= 2 && g.hap > 75 && chance(s, 0.3)) { mm(s, g, "sns", "photo", { ride: b.name }); s.today.sns++; }
      });
      st.riders = [];
      st.wear += b.wear;
      if (st.wear >= 100) { breakDown(s, st); return; }
    }
    if (!st.riders.length && st.q.length) {
      while (st.q.length && st.riders.length < b.cap) {
        var g = byId(s, st.q.shift());
        if (!g) continue;
        if (g.cash < st.price) {
          g.state = "walk"; g.sid = null; g.hap -= 4; clampHap(g);
          if (chance(s, 0.3)) mm(s, g, "complaint", "expensive", { ride: b.name });
          continue;
        }
        g.cash -= st.price; g.spent += st.price; s.cash += st.price; s.today.rev += st.price;
        g.state = "ride"; st.riders.push(g.id);
      }
      if (st.riders.length) st.t = b.cycle;
    }
  }

  function finishGuest(s, g) {
    s.today.hapSum += g.hap; s.today.hapN++; s.today.left++;
    if (g.hap >= 80 && chance(s, 0.15)) mm(s, g, "recommend", "recommend", {});
  }

  function guestStep(s, g) {
    needsTick(s, g);
    if (!g.leaving && (s.min >= D.DAY_END || g.hap < 15 || g.need.fatigue >= 100 || g.cash < 100)) {
      g.leaving = true;
      if (g.state === "queue") { var st0 = s.structs[g.sid]; if (st0) st0.q = st0.q.filter(function (x) { return x !== g.id; }); g.state = "walk"; }
    }
    if (g.state === "queue") {
      g.wait++;
      if (g.wait > g.patience) {
        var st = s.structs[g.sid];
        if (st) st.q = st.q.filter(function (x) { return x !== g.id; });
        g.state = "walk"; g.sid = null; g.hap -= 8; clampHap(g);
        if (chance(s, 0.4)) mm(s, g, "complaint", "queue", { ride: st ? D.BUILD[st.type].name : null });
      }
      return;
    }
    if (g.state === "ride") return;
    if (g.state === "rest" || g.state === "toilet") {
      if (--g.t <= 0) {
        if (g.state === "rest") g.need.fatigue = 0; else g.need.toilet = 0;
        g.hap += 2; clampHap(g); g.state = "walk"; g.sid = null;
      }
      return;
    }
    // walk
    g.hap += decoJoy(s, g); clampHap(g);
    if (g.leaving) {
      if (moveToward(s, g, "gate")) { g.state = "leave"; }
      return;
    }
    if (!g.sid) {
      g.sid = choose(s, g);
      if (!g.sid) {
        var need = urgentNeed(g);
        if (g.need[need] >= 70) { g.hap -= 3; clampHap(g); if (chance(s, 0.3)) mm(s, g, "need", need, {}); }
        for (var k in s.structs) if (s.structs[k].type === "shrine") g.sid = s.structs[k].id; // 沒得選就去參拜
      }
    }
    if (g.sid && moveToward(s, g, g.sid)) arrive(s, g);
  }

  // 一遊戲分鐘：生客 → 設施運轉 → 客人行動 → 移除離場者
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

匯出物件加 `step: step, rideStep: rideStep, buyAt: buyAt, arrive: arrive, breakDown: breakDown,`。

- [ ] **Step 5: 執行確認通過**

Run: `node --check static_src/ennichi_murmur.js && node --check static_src/ennichi_sim.js && node tools/ennichi_check/core_check.js`
Expected: `5. 搭乘、攤位、故障、murmur OK`

- [ ] **Step 6: Commit**

```bash
git add static_src/ennichi_murmur.js static_src/ennichi_sim.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 排隊、搭乘、攤位、設施、故障、髒亂、離場與 murmur"
```

---

### Task 7: 日循環——開園、tick、打烊結算、口碑、修理、季末、applyIntent

**Files:**
- Modify: `static_src/ennichi_core.js`、`tools/ennichi_check/core_check.js`

**Interfaces:**
- Consumes: `Sim.step/spawnSchedule`、`Murmur.topTopics`、`workshopStep`
- Produces:
  - `Core.openDay(s) -> bool`：`plan` → `open`；`min = DAY_START`；`s.today = { guests:0, left:0, rev:0, fees:0, hapSum:0, hapN:0, sns:0, made:{}, spawn: Sim.spawnSchedule(s), murmurs:[], topics:{} }`
  - `Core.tick(s, n)`：`open` 時跑 n 分鐘；每分鐘 `Sim.step(s)`、`workshopStep(s)`、`min++`；`min ≥ DAY_END` 且沒有客人，或 `min ≥ DAY_END + 90` → `closeDay(s)` 並停止
  - `Core.closeDay(s) -> Summary`：強制移除殘留客人（照常記滿意度）；`avgHap = hapN ? round(hapSum/hapN) : 0`；`repDelta = round((avgHap − 55) × hapN / 40) + sns`；`rep = max(0, rep + repDelta)`；推進 `history`；`dirt = 0`；所有 ride 的 `q/riders/t` 清空；`phase = "close"`
  - `Core.repair(s, sid) -> bool`：`plan` 時，用 `fix` 零件把 `wear` 歸 0、`broken = false`、`fixes++`
  - `Core.nextDay(s)`：`close` → `day++`；`day > SEASON_DAYS` → `phase = "season"`，否則 `plan`
  - `Core.applyIntent(s, it) -> { ok, err }`，`it.a` 對應：`build {type,x,y}`、`demolish {sid}`、`path {x,y,on}`、`buy {item,n}`、`machine {type}`、`recipe {mi,rid}`、`price {sid,price}`、`fee {fee}`、`repair {sid}`、`open`、`next`
  - `Core.seasonResult(s) -> { guests, rev, avgHap, rep, level }`

- [ ] **Step 1: 追加失敗的測試**

```js
// ---------------- 6. 日循環、結算、修理、季末 ----------------
(function () {
  var s = freshPark(31);
  s.ware.takoyaki = 50;
  assert.ok(Core.applyIntent(s, { a: "open" }).ok);
  assert.strictEqual(s.phase, "open"); assert.ok(s.today.spawn.length > 0);
  assert.ok(!Core.applyIntent(s, { a: "build", type: "bench", x: 15, y: 9 }).ok, "營業中不能蓋");
  Core.tick(s, D.DAY_END - D.DAY_START + 120);
  assert.strictEqual(s.phase, "close"); assert.strictEqual(s.guests.length, 0);
  var sum = s.history[0];
  assert.strictEqual(sum.day, 1); assert.ok(sum.guests > 0); assert.ok(sum.rev >= 0);
  assert.ok(sum.avgHap >= 0 && sum.avgHap <= 100);
  assert.strictEqual(s.rep, Math.max(0, sum.repDelta));
  assert.ok(s.today.murmurs.length > 0, "一整天至少有幾句 murmur");
  // 修理
  var merry = s.structs[sid(s, "merry")];
  merry.wear = 100; merry.broken = true;
  assert.ok(Core.applyIntent(s, { a: "next" }).ok); assert.strictEqual(s.phase, "plan"); assert.strictEqual(s.day, 2);
  s.ware.metal = 5;
  assert.ok(Core.applyIntent(s, { a: "repair", sid: merry.id }).ok);
  assert.ok(!merry.broken && merry.wear === 0); assert.strictEqual(s.ware.metal, 3);
  // 決定性：同種子、同操作 → 同結果
  function run(seed) { var t = freshPark(seed); Core.applyIntent(t, { a: "open" }); Core.tick(t, 600); return Core.serialize(t); }
  assert.strictEqual(run(77), run(77));
  // 季末
  s.day = D.SEASON_DAYS; s.phase = "close";
  Core.nextDay(s); assert.strictEqual(s.phase, "season");
  var res = Core.seasonResult(s);
  assert.ok(res.guests >= sum.guests && res.level >= 1);
  assert.strictEqual(Core.applyIntent(s, { a: "bogus" }).err, "unknown");
  console.log("6. 日循環、結算、修理、季末 OK");
})();
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/ennichi_check/core_check.js`
Expected: FAIL（`Core.applyIntent is not a function`）

- [ ] **Step 3: 實作**

在 `ennichi_core.js` 的 `serialize` 之前加入，並把下列函式加入匯出物件：

```js
  // ---- 日循環
  function openDay(s) {
    if (s.phase !== "plan") return false;
    var Sim = window.PriTestEnnichiSim;
    s.phase = "open"; s.min = D.DAY_START; s.guests = [];
    s.today = { guests: 0, left: 0, rev: 0, fees: 0, hapSum: 0, hapN: 0, sns: 0, made: {}, spawn: Sim.spawnSchedule(s), murmurs: [], topics: {} };
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
    var Murmur = window.PriTestEnnichiMurmur;
    var sum = { day: s.day, guests: t.guests, rev: t.rev + t.fees, avgHap: avg, repDelta: delta, sns: t.sns, topTopics: Murmur ? Murmur.topTopics(s, 3) : [] };
    s.history.push(sum);
    s.dirt = 0;
    for (var k in s.structs) { var st = s.structs[k]; st.q = []; st.riders = []; st.t = 0; }
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
    var g = 0, rev = 0, hs = 0, hn = 0;
    s.history.forEach(function (h) { g += h.guests; rev += h.rev; hs += h.avgHap * h.guests; hn += h.guests; });
    return { guests: g, rev: rev, avgHap: hn ? Math.round(hs / hn) : 0, rep: s.rep, level: popLevel(s) };
  }

  function applyIntent(s, it) {
    var ok;
    switch (it && it.a) {
      case "build": return build(s, it.type, it.x, it.y);
      case "demolish": ok = demolish(s, it.sid); break;
      case "path": ok = setPath(s, it.x, it.y, !!it.on); break;
      case "buy": ok = buy(s, it.item, it.n); break;
      case "machine": ok = addMachine(s, it.type); break;
      case "recipe": ok = setRecipe(s, it.mi, it.rid); break;
      case "price": ok = setPrice(s, it.sid, it.price); break;
      case "fee": ok = setFee(s, it.fee); break;
      case "repair": ok = repair(s, it.sid); break;
      case "open": ok = openDay(s); break;
      case "next": ok = nextDay(s); break;
      default: return { ok: false, err: "unknown" };
    }
    return { ok: ok, err: ok ? null : "rejected" };
  }
```

匯出物件加：`openDay: openDay, tick: tick, closeDay: closeDay, repair: repair, nextDay: nextDay, seasonResult: seasonResult, applyIntent: applyIntent,`。

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/ennichi_core.js && node tools/ennichi_check/core_check.js`
Expected: 1〜6 全部 OK

- [ ] **Step 5: Commit**

```bash
git add static_src/ennichi_core.js tools/ennichi_check/core_check.js
git commit -m "feat(ennichi): 日循環、打烊結算與口碑、修理、季末、applyIntent"
```

---

### Task 8: 28 天平衡模擬（機器人經營）

**Files:**
- Create: `tools/ennichi_check/sim.js`

**Interfaces:**
- Consumes: `Core.*`、`Sim.*`、`D.*`
- Produces: 終端機輸出每天一行 `day guests rev avgHap rep cash` ＋ 最後的斷言。若斷言失敗，調整 `ennichi_data.js` 的數值（只調數值、不改規則），並在該數值旁註明理由。

- [ ] **Step 1: 寫模擬腳本**

```js
// ============================================================================
// 緣日樂園 28 天平衡模擬：一個「合理但不完美」的機器人經營春季。
// 執行：node tools/ennichi_check/sim.js [種子]
// 目標（MVP 的手感基準）：不會破產、來客會成長、平均心情 50〜85、第 28 天前人氣到 Lv3、murmur 類型至少 5 種。
// ============================================================================
"use strict";
var fs = require("fs"), path = require("path"), assert = require("assert");
global.window = global;
var SRC = path.join(__dirname, "..", "..", "static_src");
["ennichi_data.js", "ennichi_murmur.js", "ennichi_core.js", "ennichi_sim.js"].forEach(function (f) { eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8")); });
var D = window.PriTestEnnichiData, Core = window.PriTestEnnichiCore;
var seed = +(process.argv[2] || 2026);
var s = Core.newGame({ seed: seed });

function act(a) { return Core.applyIntent(s, a).ok; }
// 第二條街：x=21 往下接到 y=17，再沿 y=17 往左。建物入口一律在底邊中央，
// 所以上排蓋在參道上方（y = 10 − h）、下排蓋在第二條街上方（y = 17 − h，佔 y 11〜16）。
var ROWS = [D.MAP.GATE.y, 17];
function layStreets() {
  for (var y = D.MAP.GATE.y + 1; y <= 17; y++) Core.setPath(s, 21, y, true);
  for (var x = 1; x <= 20; x++) Core.setPath(s, x, 17, true);
}
var PLAN = ["merry", "takoyakiSt", "ramuneSt", "bench", "trash", "toilet", "kingyo", "wanage", "ameSt", "omikuji", "shateki",
  "trash", "bench", "lantern", "cups", "juyo", "chairs", "lantern", "wheel", "flower"];
function tryPlace(type) {
  var b = D.BUILD[type];
  for (var r = 0; r < ROWS.length; r++) {
    for (var x = 1; x + b.w <= 21; x++) if (act({ a: "build", type: type, x: x, y: ROWS[r] - b.h })) return true;
  }
  return false;
}
function setupMachines() {
  var want = ["weld", "wind", "kiln", "sew", "bottle", "candy", "craft"];
  want.forEach(function (m) { if (!s.machines.some(function (x) { return x.type === m; })) act({ a: "machine", type: m }); });
  s.machines.forEach(function (m, i) {
    var r = { saw: "plank", carve: "carving", press: "metal", weld: "frame", wind: "motor", kiln: "bulb", sew: "canvas", kitchen: "takoyaki", candy: "ringoame", bottle: "ramune", craft: "omamori" }[m.type];
    act({ a: "recipe", mi: i, rid: r });
  });
}
function restock() {
  var want = { wood: 30, iron: 30, copper: 10, glass: 15, cloth: 12, sugar: 15, flour: 15, octopus: 15, apple: 8 };
  for (var k in want) { var n = want[k] - (s.ware[k] || 0); if (n > 0 && s.cash > 1500) act({ a: "buy", item: k, n: n }); }
}

var types = {};
layStreets();
console.log("day guests   rev avgHap  rep   cash");
for (var d = 1; d <= D.SEASON_DAYS; d++) {
  for (var k in s.structs) if (s.structs[k].broken || s.structs[k].wear > 60) act({ a: "repair", sid: +k });
  setupMachines();
  while (PLAN.length && tryPlace(PLAN[0])) PLAN.shift();
  restock();
  act({ a: "open" });
  Core.tick(s, 1000);
  s.today.murmurs.forEach(function (m) { types[m.type] = 1; });
  var h = s.history[s.history.length - 1];
  console.log([h.day, h.guests, h.rev, h.avgHap, s.rep, s.cash].map(function (v) { return String(v).padStart(5); }).join(" "));
  act({ a: "next" });
}
var res = Core.seasonResult(s);
console.log("season", JSON.stringify(res), "murmur types", Object.keys(types).join(","));
assert.ok(s.cash > 0, "沒有破產");
assert.ok(s.history[27].guests > s.history[0].guests, "來客成長");
assert.ok(res.avgHap >= 50 && res.avgHap <= 85, "平均心情 50〜85：" + res.avgHap);
assert.ok(res.level >= 3, "季末人氣 Lv3 以上：Lv" + res.level);
assert.ok(Object.keys(types).length >= 5, "murmur 類型至少 5 種");
console.log("sim OK");
```

- [ ] **Step 2: 執行並調整數值直到通過**

Run: `node tools/ennichi_check/sim.js && node tools/ennichi_check/sim.js 7 && node tools/ennichi_check/sim.js 99`
Expected: 三個種子都印出 `sim OK`。
不通過時只調 `ennichi_data.js` 的數值（例如 `D.GUESTS[*].cash`、`D.NEED_RATE`、設施 `price`／`wear`、`D.START_CASH`），在改動處註明「依 sim.js 調整：原值 → 新值，理由」。不得為了通過而改斷言門檻。

- [ ] **Step 3: Commit**

```bash
git add tools/ennichi_check/sim.js static_src/ennichi_data.js
git commit -m "test(ennichi): 28 天平衡模擬並調整初始數值"
```

---

### Task 9: 共用群眾模組 `ennichi_crowd.js`（從樣本頁抽出）

**Files:**
- Create: `static_src/ennichi_crowd.js`
- Modify: `static_src/ennichi_lab.js`（改用共用模組；行為不變）、`site_src/ennichi_page.py`（`ENNICHI_LAB_SCRIPTS = ("ennichi_crowd.js", "ennichi_lab.js")`）

**Interfaces:**
- Produces（`window.PriTestEnnichiCrowd`；依賴全域 `THREE` 與 `PriTestEnnichiVendor`，呼叫時才存取）：
  - `OUTFITS`（4 套：`{ top, bottom, hair }`，與 `ennichi_lab.js` 現有的相同）
  - `CELL = 192`、`DIRS = 8`、`FRAMES = 4`、`SIZE = 1.55`
  - `restPose(vrm)`、`walkPose(vrm, phase, amp)`（從 lab 原封搬移）
  - `buildAtlas(renderer, vrm) -> THREE.Texture`（含每格 `springBoneManager.reset()`）
  - `create(scene, tex, maxN) -> crowd`；`crowd.set(i, x, y, z, dirIndex, row, scale)`、`crowd.count(n)`、`crowd.mesh`
  - `dirIndex(heading, camX, camZ, x, z) -> 0..7`（`round((heading − atan2(camX−x, camZ−z)) / (π/4))` 取 mod 8）

- [ ] **Step 1: 抽出模組**

從 `static_src/ennichi_lab.js` 把 `OUTFITS`、`ATLAS_*`、`BILL_SIZE`、`restPose`、`walkPose`、`recolor`、`buildAtlas`、`buildCrowd` 的著色器與幾何搬到 `ennichi_crowd.js`，改成以參數傳入 `renderer`／`scene`（不讀 lab 的模組變數）。`create()` 回傳的物件：

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
      set: function (i, x, y, z, dir, row, scale) {
        iPos.setXYZ(i, x, y, z); iCell.setXY(i, dir, row); iScale.setX(i, scale);
      },
      count: function (n) { geo.instanceCount = n; iPos.needsUpdate = true; iCell.needsUpdate = true; iScale.needsUpdate = true; },
    };
  }
```

`material(tex, fog)` 用 lab 現有的 vertex／fragment shader（含 `c.rgb /= c.a` 與霧），`uGrid = (DIRS, FRAMES × OUTFITS.length)`、`uSize = SIZE`。

- [ ] **Step 2: 樣本頁改用共用模組並確認行為不變**

`ennichi_lab.js` 刪掉被搬走的函式，改呼叫 `window.PriTestEnnichiCrowd.*`；`updateCrowd` 改用 `crowd.set(...)`＋`crowd.count(guestCount)`。

Run: `node --check static_src/ennichi_crowd.js && node --check static_src/ennichi_lab.js && py -3 generate.py`
再用暫時的 Playwright 腳本（不提交）開 `ennichi/lab/index.html`：等 `PriTestEnnichiLab._report().ready`，確認 `_report().atlas` 有值、`_state().guests === 120`、沒有 `pageerror`。

- [ ] **Step 3: Commit**

```bash
git add static_src/ennichi_crowd.js static_src/ennichi_lab.js site_src/ennichi_page.py
git commit -m "refactor(ennichi): 看板人物圖集與群眾抽成共用模組 ennichi_crowd.js"
```

---

### Task 10: 3D 樂園 `ennichi_3d.js`

**Files:**
- Create: `static_src/ennichi_3d.js`
- Modify: `site_src/i18n_ennichi.py`（無；3D 不含文字）、`static_src/css/ennichi.css`（3D 舞台與 murmur 氣泡沿用 `.en-stage`／`.en-overlay`／`.en-bubble`）

**Interfaces:**
- Consumes: `D.MAP/BUILD`、`Core.entranceOf`、`PriTestEnnichiCrowd`、`PriTestEnnichiVendor`
- Produces（`window.PriTestEnnichi3D`）：
  - `init(stageEl, opts) -> Promise`：`opts = { modelUrl, crowdModelUrl }`；建立 renderer／scene／OrbitControls／Bloom（沿用樣本頁的設定：`ColorManagement.legacyMode = false`、HalfFloat 合成目標、`GammaCorrectionShader`）、載入兩個 VRM（小夜站在本殿前、群眾圖集用程式版）。
  - `sync(s, alpha)`：依 `s` 重建或更新場景。`s.mapVer` 改變時重建地面步道（`InstancedMesh`）與所有建物；每幀更新設施動畫、客人位置（前一次與這一次模擬位置之間依 `alpha` 內插）。
  - `pickTile(clientX, clientY) -> { x, y } | null`（射線打地面平面）
  - `ghost(type, x, y, ok)`：放置預覽（綠／紅半透明方塊），`ghost(null)` 隱藏
  - `focusGuest(gid|null)`：鏡頭跟拍
  - `bubble(m)`：在說話客人頭上顯示 murmur 氣泡 4.8 秒（同樣本頁的 `spawnBubble`）
  - `tileToWorld(x, y) -> { x, z }`：格子中心 = `((x + 0.5) × TILE − W×TILE/2, (y + 0.5) × TILE − H×TILE/2)`
- 建物的程序化造型（全部 three.js 基本形狀，設施以 `group.userData.spin` 等欄位在 `sync` 裡動畫）：

| type | 造型 | 動畫 |
| --- | --- | --- |
| shrine | 拜殿（樣本頁的 box＋四角錐屋頂＋發光門）＋前方鳥居 | 無 |
| merry | 圓台（Cylinder）＋12 根柱＋獅子（Box＋Sphere 頭）＋圓錐帳篷頂＋燈泡圈（InstancedMesh 發光） | 整組繞 Y 轉，獅子上下 |
| cups | 圓盤＋8 個茶碗（Lathe 杯形，抹茶綠） | 圓盤轉、杯子自轉 |
| chairs | 中柱＋頂部風車＋12 條鏈＋座椅 | 頂部轉、座椅依轉速外甩 |
| wheel | 樣本頁的摩天輪（環、輻條、48 燈），加 24 個車廂 | 繞 Z 轉，車廂保持水平 |
| kingyo／shateki／wanage／omikuji | 攤位箱＋屋頂＋CanvasTexture 招牌（樣本頁的 `signMaterial`） | 無 |
| takoyakiSt／ameSt／ramuneSt／juyo | 同上，招牌文字取 `D.BUILD[type].name.ja` | 無 |
| bench／toilet／trash／lantern／flower | 小物件（lantern 發光） | lantern 微閃 |

- 故障設施：在建物上方加紅色「×」標記，動畫停止。
- 客人：`crowd.set(i, wx, 0.02, wz, dir, outfit × FRAMES + frame, 0.9 + (gid % 7) × 0.025)`；`state === "ride"` 的客人不畫（視為在設施上），`queue` 的客人沿入口往外排成一列（每人 0.6 m）。

- [ ] **Step 1: 實作 `ennichi_3d.js`**

依上表實作。檔頭註解寫明：只讀 `s`、不呼叫 `Core.applyIntent`；客人位置內插需要的前一幀位置由 `sync` 自己保存（`prev[gid] = {x, y}`）。

- [ ] **Step 2: 語法與單獨載入檢查**

Run: `node --check static_src/ennichi_3d.js`
暫時的 Playwright 腳本（不提交）在 `ennichi/index.html` 執行：

```js
await page.evaluate(async function () {
  var s = window.PriTestEnnichiCore.newGame({ seed: 1 });
  window.PriTestEnnichiCore.build(s, "merry", 4, 6);
  await window.PriTestEnnichi3D.init(document.querySelector("#en-stage"), { modelUrl: "../static/models/ennichi/sayo_blender.vrm", crowdModelUrl: "../static/models/ennichi/sayo.vrm" });
  window.PriTestEnnichi3D.sync(s, 1);
});
```

Expected: 沒有 `pageerror`；截圖看得到參道、本殿、旋轉木馬。

- [ ] **Step 3: Commit**

```bash
git add static_src/ennichi_3d.js static_src/css/ennichi.css
git commit -m "feat(ennichi): 3D 樂園（地面步道、程序化設施與動畫、群眾、小夜、murmur 氣泡）"
```

---

### Task 11: 畫面 `ennichi.js`

**Files:**
- Modify: `static_src/ennichi.js`（整檔改寫）、`static_src/css/ennichi.css`、`site_src/i18n_ennichi.py`

**Interfaces:**
- Consumes: `Core.*`、`Sim.*`、`Murmur.*`、`PriTestEnnichi3D.*`、`D.*`
- Produces（`window.PriTestEnnichiGame`，供測試）：`_state() -> s`、`_intent(it) -> { ok, err }`、`_speed() -> 1|2|4|0`
- 存檔：`localStorage["pritest-ennichi-save"]`（每次 `applyIntent` 成功、打烊、換日後寫入；讀寫包 try/catch）
- 時間：營業中每真實 0.4 秒推進 1 遊戲分鐘 × 速度（1／2／4；0 = 暫停）；3D 以 `requestAnimationFrame` 內插
- 選擇器（測試與樣式共用，不得改名）：

| 選擇器 | 用途 |
| --- | --- |
| `#en-title-screen`、`#en-btn-new`、`#en-btn-continue` | 標題畫面 |
| `#en-hud`、`#en-hud-day`、`#en-hud-time`、`#en-hud-cash`、`#en-hud-rep`、`#en-hud-guests` | HUD |
| `#en-btn-open`、`#en-btn-pause`、`#en-btn-speed-1`、`#en-btn-speed-2`、`#en-btn-speed-4` | 開園與速度 |
| `#en-stage` | 3D 舞台（`PriTestEnnichi3D.init` 的掛載點） |
| `#en-minimap`（canvas，每格 10px） | 2D 小地圖：顯示步道／建物／客人點；放置模式下點擊格子＝放置 |
| `#en-tab-build`、`#en-tab-work`、`#en-tab-park`、`#en-tab-murmur` | 側欄分頁 |
| `[data-build="<type>"]`、`#en-btn-path`、`#en-btn-unpath`、`#en-btn-cancel` | 建造（選了之後在 3D 或小地圖點格子） |
| `[data-buy="<item>"]`（每按一次買 10） | 市場 |
| `[data-machine="<type>"]`、`select[data-recipe="<machineIndex>"]` | 工房 |
| `[data-struct="<sid>"]`、`#en-struct-panel`、`#en-btn-repair`、`#en-btn-demolish`、`#en-price-input` | 設施資訊 |
| `#en-fee-input` | 入園費 |
| `#en-murmur-wall`、`[data-mm-filter="<type>"]` | murmur 牆（沿用樣本頁的 `.en-wall-item` 樣式） |
| `#en-follow-panel` | 跟拍（點 3D 客人或 murmur → 顯示需求條、心情、今日行程） |
| `#en-day-summary`、`#en-btn-next-day` | 日結算（來客、營收、平均心情、口碑變化、今日話題前三、SNS 次數） |
| `#en-season-summary`、`#en-btn-restart` | 季末總結 |

- 建造錯誤訊息：`en_err_<err>`（`phase／level／bounds／locked／occupied／entrance／parts／cash`）顯示在面板下方 3 秒。
- 新增 i18n 鍵（zh／ja）：`en_new`、`en_continue`、`en_open`、`en_pause`、`en_day`、`en_cash`、`en_rep`、`en_level`、`en_guests`、`en_tab_build`、`en_tab_work`、`en_tab_park`、`en_tab_murmur`、`en_path`、`en_unpath`、`en_cancel`、`en_market`、`en_warehouse`、`en_machines`、`en_add_machine`、`en_recipe`、`en_repair`、`en_demolish`、`en_price`、`en_fee`、`en_wear`、`en_broken`、`en_queue`、`en_summary_title`、`en_summary_guests`、`en_summary_rev`、`en_summary_hap`、`en_summary_rep`、`en_summary_topics`、`en_summary_sns`、`en_next_day`、`en_season_title`、`en_restart`、`en_follow`、`en_need_fun`、`en_need_hunger`、`en_need_thirst`、`en_need_toilet`、`en_need_fatigue`、`en_hap`、`en_err_phase`、`en_err_level`、`en_err_bounds`、`en_err_locked`、`en_err_occupied`、`en_err_entrance`、`en_err_parts`、`en_err_cash`、`en_topic_<topic>`（queue、broken、expensive、soldout、litter、shrine、recommend、photo、goods、各設施 type 用設施名）
- 版面：桌機為「3D 舞台（左、主）＋側欄（右 320px）」；寬度 < 860px 時側欄移到舞台下方，HUD 縮成兩行；小地圖固定在側欄頂端。

- [ ] **Step 1: 實作畫面與字串**

依上表實作。進入遊戲（新遊戲或繼續）時才動態載入 `three.min.js` → `ennichi_vrm.js`（比照 `ennichi_lab.js` 的 `loadScript`），再 `PriTestEnnichi3D.init`。3D 初始化失敗時仍可用小地圖遊玩（顯示一行錯誤訊息）。

- [ ] **Step 2: 檢查**

Run: `node --check static_src/ennichi.js && py -3 generate.py && py -3 tools/split_css.py --check`
Expected: 無錯誤；split_css exit 0。

- [ ] **Step 3: Commit**

```bash
git add static_src/ennichi.js static_src/css/ennichi.css site_src/i18n_ennichi.py
git commit -m "feat(ennichi): 遊戲畫面（HUD、建造、工房、設施、murmur 牆、跟拍、日結算、季末）"
```

---

### Task 12: 瀏覽器檢查 `ui_check.js`

**Files:**
- Create: `tools/ennichi_check/ui_check.js`

**Interfaces:**
- Consumes: Task 11 的選擇器、`window.PriTestEnnichiGame._state/_intent/_speed`

- [ ] **Step 1: 寫檢查腳本**

```js
// ============================================================================
// 緣日樂園（ennichi）的瀏覽器檢查（Playwright）。先 py -3 generate.py，再起本機伺服器：
//   py -3 -m http.server 8962 --directory dist
//   node tools/ennichi_check/ui_check.js
// 流程：標題 → 新遊戲 → 小地圖放置旋轉木馬與章魚燒攤 → 市場買料 → 開園 4 倍速跑完一天
//       → 日結算 → 下一天 → 修理 → 重新整理後「繼續」讀回同一天 → 手機寬度無橫向捲動。
// 觸發一律 dispatchEvent（HUD 每幀重繪，page.click 會逾時）；小地圖是靜態 canvas，用 page.mouse 點格子。
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
  assert.strictEqual(s.phase, "plan"); assert.strictEqual(s.day, 1);

  // 小地圖放置：旋轉木馬（4×4，左上 (4,6)，入口 (6,10)）、章魚燒攤（2×2，左上 (10,8)）
  await act(page, "#en-tab-build");
  await act(page, "[data-build=\"merry\"]"); await clickTile(page, 4, 6);
  await act(page, "[data-build=\"takoyakiSt\"]"); await clickTile(page, 10, 8);
  s = await st(page);
  var types = Object.keys(s.structs).map(function (k) { return s.structs[k].type; });
  assert.ok(types.indexOf("merry") >= 0 && types.indexOf("takoyakiSt") >= 0, "放置成功：" + types.join(","));
  // 放在不合法的位置會顯示錯誤、不會扣錢
  var cash = s.cash;
  await act(page, "[data-build=\"kingyo\"]"); await clickTile(page, 5, 7);
  assert.strictEqual((await st(page)).cash, cash, "重疊時不扣錢");
  await act(page, "#en-btn-cancel");

  // 市場：買章魚與麵粉；工房鐵板灶做章魚燒
  await act(page, "#en-tab-work");
  await act(page, "[data-buy=\"octopus\"]"); await act(page, "[data-buy=\"flour\"]");
  s = await st(page);
  assert.ok(s.ware.octopus >= 10 && s.ware.flour >= 10);

  // 開園，4 倍速跑到日結算
  await act(page, "#en-btn-open");
  await act(page, "#en-btn-speed-4");
  await page.evaluate(function () { window.PriTestEnnichiGame._fast = 40; }); // 測試用：每次推進 40 遊戲分鐘
  await page.screenshot({ path: path.join(SHOTS, "open.png") });
  await page.waitForSelector("#en-day-summary", { timeout: 120000 });
  s = await st(page);
  assert.strictEqual(s.phase, "close"); assert.ok(s.history[0].guests > 0);
  assert.ok((await page.$$("#en-murmur-wall .en-wall-item")).length > 0, "murmur 牆有內容");
  await page.screenshot({ path: path.join(SHOTS, "summary.png") });
  await act(page, "#en-btn-next-day");
  s = await st(page);
  assert.strictEqual(s.day, 2); assert.strictEqual(s.phase, "plan");

  // 修理：把旋轉木馬磨損墊高，從設施面板修理（先讓倉庫有零件）
  await page.evaluate(function () {
    var g = window.PriTestEnnichiGame, s = g._state();
    for (var k in s.structs) if (s.structs[k].type === "merry") { s.structs[k].wear = 100; s.structs[k].broken = true; }
    s.ware.metal = 5;
  });
  var merrySid = Object.keys(s.structs).filter(function (k) { return s.structs[k].type === "merry"; })[0];
  await act(page, "#en-tab-park");
  await act(page, "[data-struct=\"" + merrySid + "\"]");
  await act(page, "#en-btn-repair");
  s = await st(page);
  assert.ok(!s.structs[merrySid].broken, "修好了");

  // 讀檔
  await page.reload();
  await act(page, "#en-btn-continue");
  await page.waitForSelector("#en-hud", { timeout: 60000 });
  s = await st(page);
  assert.strictEqual(s.day, 2, "讀回第 2 天");

  // 手機寬度
  var m = await (await browser.newContext(pw.devices["iPhone 13"])).newPage();
  m.on("pageerror", function (e) { errors.push("mobile: " + e.message); });
  await m.goto(BASE);
  await m.dispatchEvent("#en-btn-new", "click"); // 新的瀏覽器環境沒有存檔
  await m.waitForSelector("#en-hud", { timeout: 60000 });
  var over = await m.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  assert.ok(over <= 0, "手機無橫向捲動：" + over);
  await m.screenshot({ path: path.join(SHOTS, "mobile.png") });

  assert.deepStrictEqual(errors, [], "沒有 JS 錯誤：\n" + errors.join("\n"));
  console.log("ui OK");
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
```

`_fast`：`ennichi.js` 的時間迴圈每次推進 `max(速度, _fast || 0)` 遊戲分鐘（只給測試用，預設 undefined）。Task 11 實作時要加上這個欄位；若 Task 11 已完成，本 Task 一併補上並在 `ennichi.js` 註明用途。

- [ ] **Step 2: 執行**

Run:
```bash
py -3 generate.py
py -3 -m http.server 8962 --directory dist   # 另一個終端機
node tools/ennichi_check/ui_check.js
```
Expected: `ui OK`；`tools/ennichi_check/shots/` 有 `open.png`、`summary.png`、`mobile.png`。
把 `tools/ennichi_check/shots/` 加進 `.gitignore`（比照其他遊戲的 shots，若已有萬用規則則略過）。

- [ ] **Step 3: Commit**

```bash
git add tools/ennichi_check/ui_check.js .gitignore static_src/ennichi.js
git commit -m "test(ennichi): Playwright 瀏覽器檢查（放置、市場、營業一天、修理、讀檔、手機）"
```

---

### Task 13: 收尾——規格、版本、推送

**Files:**
- Modify: `docs/ennichi_rules.md`、`site_src/version.py`、`CLAUDE.md`（若有新的測試注意事項）

- [ ] **Step 1: 規格同步**

`docs/ennichi_rules.md`：
- 標題下的狀態說明加一行：「MVP（2026-xx-xx）已實作：§2 日循環（春季 28 天）、§4 的參道區＋和風遊樂區 8 種設施與 4 種攤位、§5.1〜§5.4、§6.3 的人氣等級、§7.1（倉庫直連，無輸送帶）、§7.2 的餐飲與御守」，並把對應條目的 📝 改成 ✅。
- §10 的 MVP 列標 ✅，註明計畫檔 `docs/superpowers/plans/2026-11-12-ennichi-mvp.md`。

- [ ] **Step 2: 全部檢查**

Run:
```bash
node tools/ennichi_check/core_check.js
node tools/ennichi_check/sim.js
py -3 generate.py
node tools/ennichi_check/ui_check.js
```
Expected: `1〜6 OK`、`sim OK`、`ui OK`。

- [ ] **Step 3: 版本與推送**

`site_src/version.py` 遞增 minor（例：`2.55.3` → `2.56.0`），再 `py -3 generate.py`。

```bash
git add docs/ennichi_rules.md site_src/version.py
git commit -m "feat(ennichi): v2.56.0 緣日樂園 MVP（春季 28 天、8 設施、工房、客人 AI、murmur、3D 樂園）"
git push -u private starv-stage3d
```

---

## 自我檢查（撰寫時已對照規格）

- 規格 §2 時間結構：Task 7（開園／營業／打烊、28 天、週末 ×1.8）。季末祭典日屬 v1，MVP 以季末總結代替（Task 7 `seasonResult`、Task 11 `#en-season-summary`）。
- §3 角色：MVP 只有小夜站在本殿前（Task 10）；好感度與常客劇情在 v1／v2。
- §4 設施：8 種＋共通數值、磨損故障修理（Task 2、6、7）；季節換裝、升級 Lv2〜3 在 v1。
- §5 客人：客群 6 種、需求 5 項、可見行為（走、排隊、搭乘中隱藏）、murmur 9 類中的 5 類（impression／complaint／need／recommend／sns）＋今日話題（Task 5、6、10、11）；gossip／season／love／rival 範本在 v1 加入（`TYPES` 已預留）。跟拍（Task 11）。
- §6：人氣等級 Lv1〜5 與解鎖（Task 3 `popLevel`、`canBuild` 的 level）；宣傳與活動日在 v1、土地擴張在 v2（`UNLOCK_X` 已預留）。
- §7：工房（倉庫直連，Task 4，規格同步）、餐飲＋御守（Task 2）。原創商品設計與合作商品在 v1／v2。
- §8〜§9：沿用 `ennichi_vrm.js` 與樣本頁的群眾技術（Task 9、10）。
- 型別一致性：`Struct`／`Guest`／`Today`／`Summary`／`Murmur` 欄位在開頭定義，各 Task 使用同名欄位；`Core.applyIntent` 的動作名稱在 Task 7 定義、Task 8／11／12 使用相同字串。
