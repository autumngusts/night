# 約跑（runpo）第 1 階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出可以實際玩的約跑核心：GPS 結算（含模擬移動）、移動方式判定（乘車事件最多）、模擬御所、親密度（距離遞減、個性偏好、連續約跑、每日倍率、7 天自然增加）、吃醋事件、G1 稱呼、「型的主 × 6 段」門檻劇情。

**Architecture:** 規則全部放在純函式的 `runpo_core.js`（不碰 DOM、不讀寫 localStorage，之後照著移植成 Go）。數值表放 `runpo_data.js`，台詞與劇情放 `runpo_text.js`。畫面、`localStorage`、`navigator.geolocation` 只在 `runpo.js`。成員沿用九華的個體（`PriTestKyukaCore.pull()`、`type81()`），**只讀，不修改九華的檔案**。

**Tech Stack:** Vanilla ES5 IIFE、Python 產生靜態 HTML（`generate.py`）、Node `assert` 的規則檢查、Playwright 的畫面檢查。

## Global Constraints

- 規則依據：`docs/runpo_design.md`（§1～§3、§11、§14 的第 1 階段）。數值都是「暫定」，集中在 `runpo_data.js`，不要散落在程式裡。
- 前綴：JS `window.PriTestRunpo*`、i18n 鍵 `rp_`、CSS class／id `rp-`。遊戲樣式只放 `static_src/css/runpo.css`，**不要加進 `style.css`**。
- 不接任何外部 API。不防作弊（任何時速都接受）。
- 吃醋只是事件：**不能補救、沒有 bonus**，不改變任何數值。
- 存檔鍵 `pritest-runpo-save-v1`；讀檔一律 try/catch，壞檔就重建。結算後**刪除行程座標**，只留方格 ID。
- 日期一律用 JST（UTC+9）。
- 首頁 test 分頁只顯示、不能點（`"link": False`），要自己輸入 `/runpo` 進入（比照 kyuka）。
- 版本 `2.80.0`（`site_src/version.py`；2026-11-20 改：2.75.0～2.79.0 已被煉金術士使用，執行時若又有其他版本先推送，就再遞增 minor）。只推 `private`（`git push private main`），不要碰 `origin`。
- 回覆、註解、文件、commit message 用繁體中文。

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `static_src/runpo_data.js` | 數值表：移動方式、距離遞減、倍率、門檻、偏好 |
| `static_src/runpo_text.js` | 台詞：移動事件、吃醋、稱呼、劇情 54 段（zh／ja） |
| `static_src/runpo_core.js` | 規則：距離、移動方式、親密度、結算、吃醋、解籤、模擬移動 |
| `static_src/runpo.js` | 畫面、存檔、GPS、模擬面板 |
| `static_src/css/runpo.css` | 樣式（含九華花紋需要的 `--ky-*` 變數） |
| `site_src/runpo_page.py` | 頁面 |
| `site_src/i18n_runpo.py` | UI 字串 |
| `tools/runpo_check/core_check.js` | 規則檢查（Node） |
| `tools/runpo_check/text_check.js` | 台詞完整性檢查（Node） |
| `tools/runpo_check/ui_check.js` | 畫面檢查（Playwright） |

## 介面

```js
// runpo_core.js → window.PriTestRunpoCore（Node：module.exports）
Core.haversineKm(a, b) → km                       // a, b = {lat, lon}
Core.modeForSpeed(kmh) → "walk"|"jog"|"bike"|"ride"|"shinkansen"|"plane"
Core.tripSegments(points) → [{km, kmh, mode}]     // points = [{t, lat, lon}]
Core.dominantMode(segments) → mode（沒有距離時 "walk"）
Core.resolveRide(mode, rng) → "rail"|"car"|mode
Core.jstDate(ms) → "YYYY-MM-DD"；Core.jstHour(ms) → 0..23；Core.dayDiff(d1, d2) → 整數天
Core.hash(str) → uint32（FNV-1a）
Core.dailyMultiplier(dateStr) → 0.7|1.0|1.3
Core.kmToBond(km) → 0..SETTLE_CAP
Core.mainOf(inst) → "美"…"緣"；Core.preferenceOf(inst) → "plan"|"night"|...
Core.prefMatches(pref, ctx) → bool               // ctx = {km, mode, startHour, endHour, minutes, newPlace, planHit}
Core.streakMult(n) → 1.0..1.5
Core.naturalAffection(acquiredAt, now) → 0..100
Core.affection(member, now) → 0..100 整數
Core.callStage(aff) → 0..3
Core.storyStage(member, now) → 0..6（目前解鎖到第幾段）
Core.cellId(lat, lon) → "3568_13976"
Core.newMember(inst, now) → member
Core.newSave(now, rng) → save（3 位成員）
Core.draw(save, now, rng) → member|null（今天已經解籤則 null）
Core.startTrip(save, uid, point, now) → {jealous: bool}
Core.checkpoint(save, point)
Core.settle(save, endPoint, now, rng, opts) → result   // opts = {mode: "rail"|"car"}（手動改乘車方式）
Core.dailyOpen(save, now) → {jealousUid}|null
Core.call(member, now, lang, player) → 稱呼字串
Core.fmt(template, vars) → 字串
Core.simulatePoints(startMs, km, minutes) → [{t, lat, lon}, {t, lat, lon}]

// member
{ uid, inst, acquiredAt, earned, lastDate, streak, streakDate, dates, km, jealousDate }
// save
{ v: 1, player: "", members: [member], trip: null|{uid, startedAt, points}, cells: [cellId],
  lastDraw: "", lastOpen: "", log: [{date, uid, km, mode, add}], offsetMs: 0 }
// result
{ uid, km, minutes, mode, rawMode, base, prefOk, prefMult, streak, streakMult, daily, add,
  affBefore, affAfter, callBefore, callAfter, storyBefore, storyAfter, events: [eventId], jealousDeparture: bool }
```

---

### Task 1: 頁面骨架與登記

**Files:**
- Create: `site_src/runpo_page.py`, `site_src/i18n_runpo.py`, `static_src/css/runpo.css`, `static_src/runpo.js`（暫時只顯示標題）, `static_src/runpo_data.js`, `static_src/runpo_text.js`, `static_src/runpo_core.js`（暫時都是空的 IIFE）
- Modify: `generate.py`（import、`GAME_I18N_PREFIXES`、copy list、建 `dist/runpo/index.html`、line 396 的清單）、`site_src/i18n_data.py`（import 並合併 zh／ja／en）、`site_src/projects.py`（PROJECTS 與 test 分頁）、`tools/split_css.py`（`GAMES` 加 `"runpo": ("rp-",)`）

**Interfaces:**
- Produces: `RUNPO_SCRIPTS = ("kyuka_data.js", "kyuka_core.js", "kyuka_crest.js", "runpo_data.js", "runpo_text.js", "runpo_core.js", "runpo.js")`；copy list 只加 runpo 自己的 4 個檔案（`RUNPO_OWN_SCRIPTS`），九華的檔案已經由 `KYUKA_SCRIPTS` 複製。

- [ ] **Step 1: 寫頁面**

```python
"""約跑（runpo）的頁面。規則依據 docs/runpo_design.md。

GPS 結算的步行約會：出發時從模擬御所選 1 人，回來結算時依距離增加親密度。
成員沿用九華的個體（kyuka_data.js／kyuka_core.js／kyuka_crest.js，只讀）。
static/runpo_data.js（數值）→ runpo_text.js（台詞）→ runpo_core.js（規則）→ runpo.js（畫面、存檔、GPS）。
2026-11-19 依使用者需求新增；首頁 test 分頁只顯示、不能點，要自己輸入 /runpo 進入。
"""

from __future__ import annotations

from site_src.layout import page_shell

RUNPO_OWN_SCRIPTS: tuple[str, ...] = ("runpo_data.js", "runpo_text.js", "runpo_core.js", "runpo.js")
RUNPO_SCRIPTS: tuple[str, ...] = ("kyuka_data.js", "kyuka_core.js", "kyuka_crest.js", *RUNPO_OWN_SCRIPTS)


def build_runpo_html() -> str:
    body = """    <div id="rp-app" class="rp-wrap" data-img="../static/images/jikan/">
      <noscript>這個頁面需要 JavaScript。</noscript>
    </div>
"""
    return page_shell(
        title="約跑",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=RUNPO_SCRIPTS,
        extra_styles=("css/runpo.css",),
        extra_i18n=("i18n/runpo.js",),
    )
```

- [ ] **Step 2: 字串檔**（比照 `i18n_kyuka.py` 的 `_ROWS` 寫法，輸出 `RUNPO_ZH／RUNPO_JA／RUNPO_EN／RUNPO_PROJECT`）

```python
RUNPO_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_runpo_name": "約跑", "project_runpo_desc": "GPS 步行約會：從御所選一位約跑對象，走得越遠親密度越高；搭電車、開車也有專屬劇情"},
    "ja": {"project_runpo_name": "はしりデート", "project_runpo_desc": "GPS でおさんぽデート。御所から一人を誘って出発、歩いた距離で親密度アップ。電車や車にも専用エピソード"},
    "en": {"project_runpo_name": "Runpo", "project_runpo_desc": "GPS walking dates: pick a partner from your court, walk farther for more affection; trains and cars have their own stories"},
}
```

  `_ROWS` 先放 `("rp_title", "約跑", "はしりデート", "Runpo")`，其餘字串在 Task 6 補齊。

- [ ] **Step 3: 樣式骨架**：`runpo.css` 開頭定義 `.rp-wrap` 的色彩變數，並**複製** `kyuka.css` 裡花紋用到的 `--ky-gold`、`--ky-bud`、`--ky-g0`～`--ky-g2`、`--ky-N`～`--ky-UR` 到 `.rp-wrap`（花紋 SVG 用 `var(--ky-gold)` 等，不載入 kyuka.css）。手機直式優先，桌機置中最寬 46rem。
- [ ] **Step 4: 登記**：`generate.py` 的 import、`GAME_I18N_PREFIXES["runpo"] = ("rp_",)`、copy list 加 `*RUNPO_OWN_SCRIPTS`、建置 `dist/runpo/index.html`、line 396 的清單加 `"runpo"`；`i18n_data.py` 三個語言都合併 `**RUNPO_xx, **RUNPO_PROJECT["xx"]`；`projects.py` 加卡片（`"link": False`，註解「使用者指定 2026-11-19」）並放進 test 分頁；`split_css.py` 加前綴。
- [ ] **Step 5: 建置並確認**

Run: `py -3 generate.py; py -3 tools/split_css.py --check`
Expected: 沒有錯誤；`dist/runpo/index.html` 存在，`dist/static/i18n/runpo.js` 存在；split_css 檢查通過。

- [ ] **Step 6: Commit**

```bash
git add site_src/runpo_page.py site_src/i18n_runpo.py static_src/css/runpo.css static_src/runpo*.js generate.py site_src/i18n_data.py site_src/projects.py tools/split_css.py
git commit -m "feat(runpo): 約跑頁面骨架與登記"
```

---

### Task 2: 數值表與距離、移動方式

**Files:**
- Modify: `static_src/runpo_data.js`, `static_src/runpo_core.js`
- Create: `tools/runpo_check/core_check.js`

**Interfaces:**
- Produces: `Core.haversineKm`、`Core.modeForSpeed`、`Core.tripSegments`、`Core.dominantMode`、`Core.resolveRide`、`Core.simulatePoints`、`Core.cellId`、`Core.jstDate`、`Core.jstHour`、`Core.dayDiff`、`Core.hash`

- [ ] **Step 1: 數值表**（`runpo_data.js`，之後的 Task 共用）

```js
// 約跑（runpo）：數值表。規則依據 docs/runpo_design.md；標示暫定的數值都集中在這裡。
(function () {
  "use strict";
  var data = {
    // §2 移動方式：時速未滿 maxKmh 就是這一種（由小到大）
    MODES: [
      { id: "walk", maxKmh: 7 },
      { id: "jog", maxKmh: 12 },
      { id: "bike", maxKmh: 25 },
      { id: "ride", maxKmh: 120 },
      { id: "shinkansen", maxKmh: 300 },
      { id: "plane", maxKmh: Infinity }
    ],
    RAIL_SHARE: 0.7,                 // ride 判定為電車的機率（其餘為開車）
    RIDE_MODES: ["rail", "car", "shinkansen", "plane"],
    // §3.2 距離遞減（暫定）：每 km 的親密度
    KM_TIERS: [
      { upTo: 1, rate: 6 },
      { upTo: 3, rate: 3 },
      { upTo: 10, rate: 1 },
      { upTo: Infinity, rate: 0.3 }
    ],
    SETTLE_CAP: 15,                  // 每次結算的基礎值上限（暫定）
    PREF_MULT: 1.3,                  // 個性偏好符合（暫定）
    STREAK_STEP: 0.1, STREAK_MAX: 1.5,
    DAILY_MULTS: [0.7, 1.0, 1.3],    // 與 RMD gosho 每日倍率相同的三種值
    NATURAL_DAYS: 7,                 // 自然增加：7 天到 100（RMD gosho_intimacy）
    JEALOUS_DAYS: 3,
    START_MEMBERS: 3,
    CALL_AT: [33, 66, 100],          // G1 稱呼：0～32／33～65／66～99／100
    STORY_GATES: [                   // §3.3 門檻劇情（暫定）
      { aff: 10, dates: 1 }, { aff: 25, dates: 2 }, { aff: 40, dates: 4 },
      { aff: 60, dates: 6 }, { aff: 80, dates: 9 }, { aff: 100, dates: 12 }
    ],
    // §3.2 個性偏好：由型的主決定
    PREF_BY_MAIN: { "柔": "short", "速": "long", "剛": "jog", "心": "morning", "瑟": "night", "緣": "ride", "智": "explore", "美": "plan", "聲": "chat" },
    EVENTS_PER_MODE: { walk: 1, jog: 1, bike: 1, rail: 2, car: 1, shinkansen: 2, plane: 1 },
    LOG_MAX: 50,
    ORIGIN: { lat: 35.6812, lon: 139.7671 }   // 模擬移動的起點（東京站）
  };
  if (typeof module !== "undefined" && module.exports) module.exports = data;
  else window.PriTestRunpoData = data;
})();
```

- [ ] **Step 2: 寫失敗的測試**（`tools/runpo_check/core_check.js` 開頭與第一批測試）

```js
// ============================================================================
// 約跑（runpo）規則核心檢查（不需要瀏覽器）。規則依據 docs/runpo_design.md。
// 執行：node tools/runpo_check/core_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
global.PriTestKyukaData = require(path.join(SRC, "kyuka_data.js"));
global.PriTestKyukaCore = require(path.join(SRC, "kyuka_core.js"));
global.PriTestRunpoData = require(path.join(SRC, "runpo_data.js"));
global.PriTestRunpoText = require(path.join(SRC, "runpo_text.js"));
var C = require(path.join(SRC, "runpo_core.js"));
var D = global.PriTestRunpoData;

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }
function near(a, b, eps) { assert(Math.abs(a - b) <= (eps || 1e-6), a + " ≉ " + b); }
var T0 = Date.UTC(2026, 10, 19, 0, 0, 0);   // JST 2026-11-19 09:00

test("haversine：東京站→新宿站約 6.1 km", function () {
  near(C.haversineKm({ lat: 35.6812, lon: 139.7671 }, { lat: 35.6896, lon: 139.7006 }), 6.06, 0.1);
});

test("時速決定移動方式（邊界值屬於下一級）", function () {
  assert.strictEqual(C.modeForSpeed(0), "walk");
  assert.strictEqual(C.modeForSpeed(6.99), "walk");
  assert.strictEqual(C.modeForSpeed(7), "jog");
  assert.strictEqual(C.modeForSpeed(12), "bike");
  assert.strictEqual(C.modeForSpeed(25), "ride");
  assert.strictEqual(C.modeForSpeed(120), "shinkansen");
  assert.strictEqual(C.modeForSpeed(300), "plane");
});

test("逐段計算：模擬 3 km／30 分＝時速 6 的散步", function () {
  var pts = C.simulatePoints(T0, 3, 30);
  var segs = C.tripSegments(pts);
  assert.strictEqual(segs.length, 1);
  near(segs[0].km, 3, 0.01);
  near(segs[0].kmh, 6, 0.05);
  assert.strictEqual(C.dominantMode(segs), "walk");
});

test("整趟的移動方式＝距離最長的那一種；沒有距離時是散步", function () {
  assert.strictEqual(C.dominantMode([{ km: 1, mode: "walk" }, { km: 20, mode: "ride" }, { km: 0.5, mode: "walk" }]), "ride");
  assert.strictEqual(C.dominantMode([]), "walk");
});

test("時間差為 0 的足跡點不會除以 0", function () {
  var segs = C.tripSegments([{ t: T0, lat: 35, lon: 139 }, { t: T0, lat: 35, lon: 139 }]);
  assert.strictEqual(segs[0].km, 0);
  assert.strictEqual(segs[0].mode, "walk");
});

test("乘車：約 70% 電車、30% 開車；其他方式不變", function () {
  var rng = global.PriTestKyukaCore.makeRng(7), rail = 0, N = 20000;
  for (var i = 0; i < N; i++) if (C.resolveRide("ride", rng) === "rail") rail++;
  near(rail / N, D.RAIL_SHARE, 0.02);
  assert.strictEqual(C.resolveRide("walk", rng), "walk");
});

test("JST 日期與時刻；天數差", function () {
  assert.strictEqual(C.jstDate(Date.UTC(2026, 10, 18, 15, 0, 0)), "2026-11-19");   // UTC 15:00 = JST 隔天 0:00
  assert.strictEqual(C.jstHour(Date.UTC(2026, 10, 18, 15, 0, 0)), 0);
  assert.strictEqual(C.dayDiff("2026-11-16", "2026-11-19"), 3);
});

test("方格 ID：小數 2 位", function () {
  assert.strictEqual(C.cellId(35.6812, 139.7671), "3568_13977");
  assert.strictEqual(C.cellId(-0.004, 0.004), "0_0");
});
```

  檔尾：`console.log("\n" + passed + " passed");`

- [ ] **Step 3: 跑測試確認失敗**

Run: `node tools/runpo_check/core_check.js`
Expected: FAIL（`C.haversineKm is not a function`）

- [ ] **Step 4: 實作**（`runpo_core.js` 的前半；後續 Task 繼續往同一個 IIFE 加函式，最後一起 export）

```js
// 約跑（runpo）：規則核心。不碰 DOM、不讀寫 localStorage；畫面（runpo.js）只呼叫這裡。
// 規則依據 docs/runpo_design.md。將來移植到 RMD 時照這個檔案改寫成 Go。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestRunpoData, T = root.PriTestRunpoText, K = root.PriTestKyukaCore;
  var DAY = 86400000, JST = 9 * 3600000;

  function haversineKm(a, b) {
    var R = 6371, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function modeForSpeed(kmh) {
    for (var i = 0; i < D.MODES.length; i++) if (kmh < D.MODES[i].maxKmh) return D.MODES[i].id;
    return "plane";
  }
  function tripSegments(points) {
    var out = [];
    for (var i = 1; i < points.length; i++) {
      var km = haversineKm(points[i - 1], points[i]);
      var hours = (points[i].t - points[i - 1].t) / 3600000;
      var kmh = hours > 0 ? km / hours : 0;
      out.push({ km: km, kmh: kmh, mode: modeForSpeed(kmh) });
    }
    return out;
  }
  function dominantMode(segments) {
    var sum = {}, best = "walk", bestKm = 0;
    segments.forEach(function (s) { sum[s.mode] = (sum[s.mode] || 0) + s.km; });
    Object.keys(sum).forEach(function (m) { if (sum[m] > bestKm) { bestKm = sum[m]; best = m; } });
    return best;
  }
  function resolveRide(mode, rng) { return mode === "ride" ? (rng() < D.RAIL_SHARE ? "rail" : "car") : mode; }
  function jstDate(ms) { return new Date(ms + JST).toISOString().slice(0, 10); }
  function jstHour(ms) { return new Date(ms + JST).getUTCHours(); }
  function dayDiff(d1, d2) { return Math.round((Date.parse(d2) - Date.parse(d1)) / DAY); }
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function cellId(lat, lon) { return Math.round(lat * 100) + "_" + Math.round(lon * 100); }
  // 模擬移動：從 ORIGIN 往正北走 km，花 minutes 分鐘（1 段）
  function simulatePoints(startMs, km, minutes) {
    var o = D.ORIGIN;
    return [{ t: startMs, lat: o.lat, lon: o.lon }, { t: startMs + minutes * 60000, lat: o.lat + km / 111.195, lon: o.lon }];
  }
```

  `cellId(-0.004, 0.004)` 的 `Math.round(-0.4)` 是 `-0`，字串化為 `"0"`，符合測試。

- [ ] **Step 5: 跑測試確認通過**

Run: `node tools/runpo_check/core_check.js`
Expected: 8 passed

- [ ] **Step 6: Commit**

```bash
git add static_src/runpo_data.js static_src/runpo_core.js tools/runpo_check/core_check.js
git commit -m "feat(runpo): 數值表、距離與移動方式判定"
```

---

### Task 3: 親密度計算

**Files:**
- Modify: `static_src/runpo_core.js`, `tools/runpo_check/core_check.js`

**Interfaces:**
- Consumes: Task 2 的 `jstDate`、`hash`
- Produces: `dailyMultiplier`、`kmToBond`、`mainOf`、`preferenceOf`、`prefMatches`、`streakMult`、`naturalAffection`、`affection`、`callStage`、`storyStage`

- [ ] **Step 1: 寫失敗的測試**

```js
test("距離遞減：1 km＝6、3 km＝12、10 km＝19 但上限 15、0 km＝0", function () {
  near(C.kmToBond(0), 0);
  near(C.kmToBond(1), 6);
  near(C.kmToBond(2), 9);
  near(C.kmToBond(3), 12);
  near(C.kmToBond(5), 14);
  near(C.kmToBond(10), 15);
  near(C.kmToBond(500), 15);
});

test("每日倍率：只會是 0.7／1.0／1.3，同一天相同，一年內三種都出現", function () {
  var seen = {};
  for (var i = 0; i < 365; i++) {
    var d = C.jstDate(T0 + i * 86400000), m = C.dailyMultiplier(d);
    assert(D.DAILY_MULTS.indexOf(m) >= 0);
    assert.strictEqual(C.dailyMultiplier(d), m);
    seen[m] = true;
  }
  assert.strictEqual(Object.keys(seen).length, 3);
});

function instWithMain(main) {
  var v = {};
  global.PriTestKyukaData.ORDER.forEach(function (k) { v[k] = 10; });
  v[main] = 90;
  return { v: v, rarity: "N", affection: 0, order: [0, 1, 2] };
}

test("偏好由型的主決定（九種都有）", function () {
  Object.keys(D.PREF_BY_MAIN).forEach(function (main) {
    assert.strictEqual(C.mainOf(instWithMain(main)), main);
    assert.strictEqual(C.preferenceOf(instWithMain(main)), D.PREF_BY_MAIN[main]);
  });
});

test("偏好的符合條件", function () {
  var base = { km: 3, mode: "walk", startHour: 12, endHour: 13, minutes: 30, newPlace: false, planHit: false };
  function ctx(o) { var c = {}; Object.keys(base).forEach(function (k) { c[k] = base[k]; }); Object.keys(o).forEach(function (k) { c[k] = o[k]; }); return c; }
  assert(C.prefMatches("short", ctx({ km: 2 })) && !C.prefMatches("short", ctx({ km: 2.01 })));
  assert(C.prefMatches("long", ctx({ km: 5 })) && !C.prefMatches("long", ctx({ km: 4.9 })));
  assert(C.prefMatches("jog", ctx({ mode: "jog" })) && !C.prefMatches("jog", ctx({ mode: "walk" })));
  assert(C.prefMatches("morning", ctx({ startHour: 5 })) && C.prefMatches("morning", ctx({ startHour: 8 })) && !C.prefMatches("morning", ctx({ startHour: 9 })));
  assert(C.prefMatches("night", ctx({ endHour: 19 })) && C.prefMatches("night", ctx({ endHour: 1 })) && !C.prefMatches("night", ctx({ endHour: 2 })) && !C.prefMatches("night", ctx({ endHour: 18 })));
  ["rail", "car", "shinkansen", "plane"].forEach(function (m) { assert(C.prefMatches("ride", ctx({ mode: m }))); });
  assert(!C.prefMatches("ride", ctx({ mode: "bike" })));
  assert(C.prefMatches("explore", ctx({ newPlace: true })) && !C.prefMatches("explore", ctx({})));
  assert(C.prefMatches("plan", ctx({ planHit: true })) && !C.prefMatches("plan", ctx({})));
  assert(C.prefMatches("chat", ctx({ minutes: 60 })) && !C.prefMatches("chat", ctx({ minutes: 59 })));
});

test("連續約跑：1 天 1.0、2 天 1.1、6 天以上 1.5", function () {
  near(C.streakMult(0), 1); near(C.streakMult(1), 1); near(C.streakMult(2), 1.1);
  near(C.streakMult(5), 1.4); near(C.streakMult(6), 1.5); near(C.streakMult(30), 1.5);
});

test("自然增加：7 天到 100；親密度＝自然＋earned，上限 100、取整數", function () {
  near(C.naturalAffection(T0, T0), 0);
  near(C.naturalAffection(T0, T0 + 3.5 * 86400000), 50);
  near(C.naturalAffection(T0, T0 + 30 * 86400000), 100);
  assert.strictEqual(C.affection({ acquiredAt: T0, earned: 12.7 }, T0 + 86400000), 27);   // 14.28 + 12.7 = 26.98 → 27
  assert.strictEqual(C.affection({ acquiredAt: T0, earned: 90 }, T0 + 6 * 86400000), 100);
});

test("稱呼 4 階：0／33／66／100", function () {
  assert.strictEqual(C.callStage(0), 0); assert.strictEqual(C.callStage(32), 0);
  assert.strictEqual(C.callStage(33), 1); assert.strictEqual(C.callStage(66), 2);
  assert.strictEqual(C.callStage(99), 2); assert.strictEqual(C.callStage(100), 3);
});

test("門檻劇情：親密度與次數兩個條件都要達成，而且依序解鎖", function () {
  var m = { acquiredAt: T0, earned: 0, dates: 0 };
  assert.strictEqual(C.storyStage(m, T0), 0);
  m.earned = 30; m.dates = 1;
  assert.strictEqual(C.storyStage(m, T0), 1);       // 第 2 段要 2 次
  m.dates = 20;
  assert.strictEqual(C.storyStage(m, T0), 2);       // 第 3 段要親密度 40
  m.earned = 100;
  assert.strictEqual(C.storyStage(m, T0), 6);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node tools/runpo_check/core_check.js`
Expected: FAIL（`C.kmToBond is not a function`）

- [ ] **Step 3: 實作**（加在 Task 2 的函式後面）

```js
  function dailyMultiplier(dateStr) { return D.DAILY_MULTS[hash(dateStr + "|runpo") % D.DAILY_MULTS.length]; }
  function kmToBond(km) {
    var left = km, prev = 0, sum = 0;
    for (var i = 0; i < D.KM_TIERS.length && left > 0; i++) {
      var span = Math.min(left, D.KM_TIERS[i].upTo - prev);
      sum += span * D.KM_TIERS[i].rate; left -= span; prev = D.KM_TIERS[i].upTo;
    }
    return Math.min(D.SETTLE_CAP, sum);
  }
  function mainOf(inst) { return K.type81(inst.v).main; }
  function preferenceOf(inst) { return D.PREF_BY_MAIN[mainOf(inst)]; }
  function prefMatches(pref, c) {
    switch (pref) {
      case "short": return c.km <= 2;
      case "long": return c.km >= 5;
      case "jog": return c.mode === "jog";
      case "morning": return c.startHour >= 5 && c.startHour <= 8;
      case "night": return c.endHour >= 19 || c.endHour <= 1;
      case "ride": return D.RIDE_MODES.indexOf(c.mode) >= 0;
      case "explore": return !!c.newPlace;
      case "plan": return !!c.planHit;
      case "chat": return c.minutes >= 60;
    }
    return false;
  }
  function streakMult(n) { return n <= 1 ? 1 : Math.min(D.STREAK_MAX, Math.round((1 + D.STREAK_STEP * (n - 1)) * 100) / 100); }
  function naturalAffection(acquiredAt, now) { return Math.max(0, Math.min(100, (now - acquiredAt) / (D.NATURAL_DAYS * DAY) * 100)); }
  function affection(m, now) { return Math.min(100, Math.round(naturalAffection(m.acquiredAt, now) + m.earned)); }
  function callStage(aff) { var n = 0; D.CALL_AT.forEach(function (t) { if (aff >= t) n++; }); return n; }
  function storyStage(m, now) {
    var aff = affection(m, now), n = 0;
    for (var i = 0; i < D.STORY_GATES.length; i++) {
      if (aff >= D.STORY_GATES[i].aff && m.dates >= D.STORY_GATES[i].dates) n++; else break;
    }
    return n;
  }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node tools/runpo_check/core_check.js`
Expected: 16 passed

- [ ] **Step 5: Commit**

```bash
git add static_src/runpo_core.js tools/runpo_check/core_check.js
git commit -m "feat(runpo): 親密度（距離遞減、偏好、連續約跑、每日倍率、自然增加、稱呼與劇情門檻）"
```

---

### Task 4: 御所、行程、結算、吃醋

**Files:**
- Modify: `static_src/runpo_core.js`, `tools/runpo_check/core_check.js`

**Interfaces:**
- Consumes: Task 2～3 的全部函式；`K.pull(rng)`（九華）；`T.EVENTS[mode]`（Task 5 的台詞，id 陣列即可測試，這裡先只依賴 `T.EVENTS[mode].length`）
- Produces: `newMember`、`newSave`、`draw`、`startTrip`、`checkpoint`、`settle`、`dailyOpen`、`fmt`、`call`，以及最後的 export

- [ ] **Step 1: 寫失敗的測試**

```js
var rng = global.PriTestKyukaCore.makeRng(123);
function fresh() { return C.newSave(T0, global.PriTestKyukaCore.makeRng(5)); }
function trip(save, uid, km, minutes, startMs) {
  var pts = C.simulatePoints(startMs, km, minutes);
  C.startTrip(save, uid, pts[0], startMs);
  return C.settle(save, pts[1], pts[1].t, rng, {});
}

test("新存檔：3 位成員、各自的個體、今天取得", function () {
  var s = fresh();
  assert.strictEqual(s.members.length, D.START_MEMBERS);
  assert.strictEqual(new Set(s.members.map(function (m) { return m.uid; })).size, 3);
  s.members.forEach(function (m) { assert.strictEqual(m.lastDate, "2026-11-19"); assert.strictEqual(m.earned, 0); });
});

test("解籤：一天一次", function () {
  var s = fresh();
  assert(C.draw(s, T0, rng));
  assert.strictEqual(C.draw(s, T0 + 3600000, rng), null);
  assert(C.draw(s, T0 + 86400000, rng));
  assert.strictEqual(s.members.length, 5);
});

test("結算：距離、方式、加到 earned、座標刪除、方格記錄、次數與累計距離", function () {
  var s = fresh(), m = s.members[0];
  var r = trip(s, m.uid, 3, 30, T0);
  near(r.km, 3, 0.01);
  assert.strictEqual(r.mode, "walk");
  near(r.base, 12, 0.05);
  near(r.add, Math.round(r.base * r.prefMult * r.streakMult * r.daily * 10) / 10, 1e-9);
  near(m.earned, r.add, 1e-9);
  assert.strictEqual(s.trip, null);
  assert.strictEqual(s.cells.length, 1);
  assert.strictEqual(m.dates, 1);
  near(m.km, r.km, 1e-9);
  assert.strictEqual(r.events.length, D.EVENTS_PER_MODE.walk);
});

test("結算的倍率：偏好符合 ×1.3，否則 ×1", function () {
  var s = fresh(), m = s.members[0];
  var r = trip(s, m.uid, 3, 30, T0);
  near(r.prefMult, r.prefOk ? D.PREF_MULT : 1);
});

test("earned 上限 100", function () {
  var s = fresh(), m = s.members[0];
  m.earned = 99.5;
  trip(s, m.uid, 3, 30, T0);
  assert.strictEqual(m.earned, 100);
});

test("連續約跑：同一人連續 3 天 → 第 3 天 ×1.2；中斷一天重來；同一天第 2 次不增加", function () {
  var s = fresh(), m = s.members[0];
  trip(s, m.uid, 1, 15, T0);
  near(trip(s, m.uid, 1, 15, T0 + 3600000).streakMult, 1);        // 同一天
  near(trip(s, m.uid, 1, 15, T0 + 86400000).streakMult, 1.1);
  near(trip(s, m.uid, 1, 15, T0 + 2 * 86400000).streakMult, 1.2);
  near(trip(s, m.uid, 1, 15, T0 + 4 * 86400000).streakMult, 1);    // 中斷
});

test("乘車：60 km／60 分 → 電車或開車；可以手動改；電車事件 2 個", function () {
  var s = fresh(), m = s.members[0];
  var pts = C.simulatePoints(T0, 60, 60);
  C.startTrip(s, m.uid, pts[0], T0);
  var r = C.settle(s, pts[1], pts[1].t, rng, { mode: "rail" });
  assert.strictEqual(r.rawMode, "ride");
  assert.strictEqual(r.mode, "rail");
  assert.strictEqual(r.events.length, D.EVENTS_PER_MODE.rail);
});

test("打卡：中途足跡點也算進距離", function () {
  var s = fresh(), m = s.members[0];
  C.startTrip(s, m.uid, { t: T0, lat: 35, lon: 139 }, T0);
  C.checkpoint(s, { t: T0 + 600000, lat: 35.01, lon: 139 });
  var r = C.settle(s, { t: T0 + 1200000, lat: 35, lon: 139 }, T0 + 1200000, rng, {});
  near(r.km, 2.22, 0.02);   // 去 1.11 km 再回來 1.11 km
});

test("吃醋：冷落 3 天以上，出發時有事件；沒有任何數值變化", function () {
  var s = fresh(), m = s.members[1];
  var later = T0 + 3 * 86400000;
  var before = JSON.stringify(m);
  var res = C.startTrip(s, m.uid, C.simulatePoints(later, 1, 15)[0], later);
  assert.strictEqual(res.jealous, true);
  assert.strictEqual(JSON.stringify(m), before);
  s.trip = null;
  assert.strictEqual(C.startTrip(s, m.uid, C.simulatePoints(T0, 1, 15)[0], T0 + 2 * 86400000).jealous, false);
});

test("每日開啟：最被冷落（≥3 天）的一位，每天最多 1 次", function () {
  var s = fresh();
  s.members[0].lastDate = "2026-11-10";
  s.members[1].lastDate = "2026-11-14";
  var day = T0 + 86400000;   // 11-20
  assert.strictEqual(C.dailyOpen(s, day).jealousUid, s.members[0].uid);
  assert.strictEqual(C.dailyOpen(s, day + 3600000), null);
  var r = C.dailyOpen(s, day + 86400000);
  assert.strictEqual(r.jealousUid, s.members[0].uid);   // 還是最被冷落的
  var s2 = fresh();
  assert.deepStrictEqual(C.dailyOpen(s2, T0), { jealousUid: null });
});

test("稱呼與模板", function () {
  assert.strictEqual(C.fmt("{a}和{b}", { a: "甲", b: "乙" }), "甲和乙");
  assert.strictEqual(C.fmt("{x}", {}), "{x}");
  var s = fresh(), m = s.members[0];
  assert(C.call(m, T0, "ja", "タロウ").indexOf("タロウ") >= 0);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node tools/runpo_check/core_check.js`
Expected: FAIL（`C.newSave is not a function`）

- [ ] **Step 3: 實作**

```js
  function newMember(inst, now) {
    return { uid: inst.uid, inst: inst, acquiredAt: now, earned: 0, lastDate: jstDate(now),
      streak: 0, streakDate: "", dates: 0, km: 0, jealousDate: "" };
  }
  function newSave(now, rng) {
    var s = { v: 1, player: "", members: [], trip: null, cells: [], lastDraw: "", lastOpen: "", log: [], offsetMs: 0 };
    for (var i = 0; i < D.START_MEMBERS; i++) s.members.push(newMember(K.pull(rng, null, i + 1), now));
    return s;
  }
  function find(save, uid) { for (var i = 0; i < save.members.length; i++) if (save.members[i].uid === uid) return save.members[i]; return null; }
  function draw(save, now, rng) {
    var today = jstDate(now);
    if (save.lastDraw === today) return null;
    save.lastDraw = today;
    var m = newMember(K.pull(rng, null, save.members.length + 1), now);
    save.members.push(m);
    return m;
  }
  function neglectDays(m, today) { return dayDiff(m.lastDate, today); }
  function startTrip(save, uid, point, now) {
    var m = find(save, uid);
    save.trip = { uid: uid, startedAt: now, points: [point] };
    return { jealous: !!m && neglectDays(m, jstDate(now)) >= D.JEALOUS_DAYS };
  }
  function checkpoint(save, point) { if (save.trip) save.trip.points.push(point); }
  function pickEvents(mode, n, rng) {
    var pool = (T && T.EVENTS && T.EVENTS[mode]) || [], out = [], used = {};
    for (var i = 0; i < n && out.length < pool.length; i++) {
      var k;
      do { k = Math.floor(rng() * pool.length); } while (used[k]);
      used[k] = true; out.push(pool[k].id);
    }
    return out;
  }
  function settle(save, endPoint, now, rng, opts) {
    opts = opts || {};
    var trip = save.trip, m = find(save, trip.uid);
    var segs = tripSegments(trip.points.concat([endPoint]));
    var km = segs.reduce(function (a, s) { return a + s.km; }, 0);
    var rawMode = dominantMode(segs);
    var mode = rawMode === "ride" ? (opts.mode === "rail" || opts.mode === "car" ? opts.mode : resolveRide(rawMode, rng)) : rawMode;
    var today = jstDate(now), cell = cellId(endPoint.lat, endPoint.lon);
    var newPlace = save.cells.indexOf(cell) < 0;
    if (newPlace) save.cells.push(cell);
    var c = { km: km, mode: mode, startHour: jstHour(trip.startedAt), endHour: jstHour(now),
      minutes: (now - trip.startedAt) / 60000, newPlace: newPlace, planHit: false };
    // 連續約跑：昨天也約過 +1；今天已約過不變；否則從 1 開始
    if (m.streakDate !== today) {
      m.streak = m.streakDate && dayDiff(m.streakDate, today) === 1 ? m.streak + 1 : 1;
      m.streakDate = today;
    }
    var base = kmToBond(km), prefOk = prefMatches(preferenceOf(m.inst), c);
    var prefMult = prefOk ? D.PREF_MULT : 1, sMult = streakMult(m.streak), daily = dailyMultiplier(today);
    var add = Math.round(base * prefMult * sMult * daily * 10) / 10;
    var affBefore = affection(m, now), storyBefore = storyStage(m, now);
    m.earned = Math.min(100, m.earned + add);
    m.dates++; m.km += km; m.lastDate = today;
    var affAfter = affection(m, now);
    save.trip = null;   // 刪除座標（§11）
    save.log.unshift({ date: today, uid: m.uid, km: Math.round(km * 100) / 100, mode: mode, add: add });
    if (save.log.length > D.LOG_MAX) save.log.length = D.LOG_MAX;
    return { uid: m.uid, km: km, minutes: c.minutes, mode: mode, rawMode: rawMode, base: base,
      prefOk: prefOk, prefMult: prefMult, streak: m.streak, streakMult: sMult, daily: daily, add: add,
      affBefore: affBefore, affAfter: affAfter, callBefore: callStage(affBefore), callAfter: callStage(affAfter),
      storyBefore: storyBefore, storyAfter: storyStage(m, now),
      events: pickEvents(mode, D.EVENTS_PER_MODE[mode] || 1, rng) };
  }
  function dailyOpen(save, now) {
    var today = jstDate(now);
    if (save.lastOpen === today) return null;
    save.lastOpen = today;
    var worst = null, worstDays = D.JEALOUS_DAYS - 1;
    save.members.forEach(function (m) {
      var d = neglectDays(m, today);
      if (d > worstDays) { worst = m; worstDays = d; }
    });
    if (worst) worst.jealousDate = today;
    return { jealousUid: worst ? worst.uid : null };
  }
  function fmt(s, vars) { return String(s).replace(/\{(\w+)\}/g, function (all, k) { return vars[k] != null ? vars[k] : all; }); }
  function call(m, now, lang, player) {
    var st = callStage(affection(m, now)), L = lang === "ja" ? "ja" : "zh";
    var tpl = st === 3 ? T.CALL_INTIMATE[mainOf(m.inst)][L] : T.CALL[st][L];
    return fmt(tpl, { p: player });
  }

  var api = {
    haversineKm: haversineKm, modeForSpeed: modeForSpeed, tripSegments: tripSegments, dominantMode: dominantMode,
    resolveRide: resolveRide, jstDate: jstDate, jstHour: jstHour, dayDiff: dayDiff, hash: hash, cellId: cellId,
    simulatePoints: simulatePoints, dailyMultiplier: dailyMultiplier, kmToBond: kmToBond, mainOf: mainOf,
    preferenceOf: preferenceOf, prefMatches: prefMatches, streakMult: streakMult, naturalAffection: naturalAffection,
    affection: affection, callStage: callStage, storyStage: storyStage, newMember: newMember, newSave: newSave,
    find: find, draw: draw, startTrip: startTrip, checkpoint: checkpoint, settle: settle, dailyOpen: dailyOpen,
    fmt: fmt, call: call
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.PriTestRunpoCore = api;
})();
```

  注意：`settle` 在吃醋時**不改任何數值**（吃醋只由 `startTrip`／`dailyOpen` 回報）。`dailyOpen` 只寫 `jealousDate`（記錄顯示過），不影響親密度。

- [ ] **Step 4: 先放最小台詞讓測試能跑**：`runpo_text.js` 先放 `EVENTS`（每種方式至少 `EVENTS_PER_MODE` 個 `{id}`）、`CALL`（4 階）、`CALL_INTIMATE`（9 個主），內容在 Task 5 補齊。

- [ ] **Step 5: 跑測試確認通過**

Run: `node tools/runpo_check/core_check.js`
Expected: 27 passed

- [ ] **Step 6: Commit**

```bash
git add static_src/runpo_core.js static_src/runpo_text.js tools/runpo_check/core_check.js
git commit -m "feat(runpo): 模擬御所、行程與結算、連續約跑、吃醋事件"
```

---

### Task 5: 台詞與劇情（zh／ja）

**Files:**
- Modify: `static_src/runpo_text.js`
- Create: `tools/runpo_check/text_check.js`

**Interfaces:**
- Produces（`window.PriTestRunpoText`）：

```js
{
  EVENTS: { walk: [ev], jog: [ev], bike: [ev], rail: [ev], car: [ev], shinkansen: [ev], plane: [ev] },
  // ev = { id: "rail_sleep", zh: "...", ja: "..." }，可用 {name}（她）、{call}（她怎麼叫你）
  JEALOUS: { depart: [{zh, ja}], open: [{zh, ja}] },
  CALL: [ {zh, ja} ×4 ],               // 第 4 個不使用（100 改用 CALL_INTIMATE）
  CALL_INTIMATE: { "美": {zh, ja}, ... 9 個主 },
  STORIES: { "美": [story ×6], ... 9 個主 }, // story = { title: {zh, ja}, lines: {zh: [..], ja: [..]} }
  PREF_LABEL: { short: {zh, ja}, ... 9 種 },
  MODE_LABEL: { walk: {zh, ja}, ..., rail, car }
}
```

- [ ] **Step 1: 寫失敗的檢查**（`text_check.js`）

```js
// 約跑（runpo）台詞完整性檢查。執行：node tools/runpo_check/text_check.js
"use strict";
var path = require("path"), assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
var T = require(path.join(SRC, "runpo_text.js"));
var D = require(path.join(SRC, "runpo_data.js"));
var MAINS = Object.keys(D.PREF_BY_MAIN);
var MIN = { walk: 6, jog: 5, bike: 4, rail: 12, car: 6, shinkansen: 4, plane: 3 };   // 電車最多（使用者指定）
var passed = 0;
function test(n, f) { f(); passed++; console.log("ok - " + n); }
function both(o, where) { assert(o && o.zh && o.ja, where + " 缺 zh／ja"); }
function noUnknownVars(s, where) {
  (s.match(/\{(\w+)\}/g) || []).forEach(function (v) { assert(["{name}", "{call}", "{p}"].indexOf(v) >= 0, where + " 未知變數 " + v); });
}

test("移動事件：每種方式的數量、電車最多、id 不重複、雙語", function () {
  var ids = {};
  Object.keys(MIN).forEach(function (m) {
    assert(T.EVENTS[m].length >= MIN[m], m + " 只有 " + T.EVENTS[m].length);
    T.EVENTS[m].forEach(function (e) {
      assert(!ids[e.id], "重複 " + e.id); ids[e.id] = true;
      both(e, e.id); noUnknownVars(e.zh, e.id); noUnknownVars(e.ja, e.id);
    });
  });
  Object.keys(MIN).forEach(function (m) { if (m !== "rail") assert(T.EVENTS.rail.length > T.EVENTS[m].length); });
});

test("吃醋：出發與每日開啟各至少 4 句", function () {
  assert(T.JEALOUS.depart.length >= 4 && T.JEALOUS.open.length >= 4);
  T.JEALOUS.depart.concat(T.JEALOUS.open).forEach(function (j, i) { both(j, "jealous " + i); });
});

test("稱呼：4 階＋9 種暱稱，都含 {p}", function () {
  assert.strictEqual(T.CALL.length, 4);
  T.CALL.forEach(function (c, i) { both(c, "call " + i); assert(c.zh.indexOf("{p}") >= 0 && c.ja.indexOf("{p}") >= 0); });
  MAINS.forEach(function (m) { both(T.CALL_INTIMATE[m], "intimate " + m); });
});

test("劇情：9 個主 × 6 段，每段有標題與至少 3 行、雙語行數相同", function () {
  MAINS.forEach(function (m) {
    assert.strictEqual(T.STORIES[m].length, 6, m);
    T.STORIES[m].forEach(function (s, i) {
      var w = m + " 第 " + (i + 1) + " 段";
      both(s.title, w);
      assert(s.lines.zh.length >= 3, w);
      assert.strictEqual(s.lines.zh.length, s.lines.ja.length, w + " 行數不同");
      s.lines.zh.concat(s.lines.ja).forEach(function (l) { noUnknownVars(l, w); });
    });
  });
});

test("偏好與移動方式的標籤", function () {
  Object.keys(D.PREF_BY_MAIN).forEach(function (m) { both(T.PREF_LABEL[D.PREF_BY_MAIN[m]], "pref"); });
  ["walk", "jog", "bike", "rail", "car", "shinkansen", "plane"].forEach(function (m) { both(T.MODE_LABEL[m], m); });
});

console.log("\n" + passed + " passed");
```

- [ ] **Step 2: 跑檢查確認失敗**

Run: `node tools/runpo_check/text_check.js`
Expected: FAIL（事件數量不足、缺劇情）

- [ ] **Step 3: 撰寫內容**。原則：
  - 每句都是她和「你」約會中的一個小場景，用 `{name}`、`{call}` 帶入。電車事件涵蓋：車窗風景、換乘迷路、靠在肩上睡著、坐過站、車站便當、坐到終點站、擠滿的電車、雨天的車廂、夕陽的鐵橋、月台的自動販賣機、末班前的空車廂、對號座位。開車事件涵蓋：她選音樂、休息站、塞車聊天、想學開車、迷路、得來速。
  - 吃醋只表現情緒，不提供任何補救選項。
  - 劇情 6 段依親密度遞進：初次約跑 → 熟悉 → 透露自己 → 依賴 → 告白前夕 → 親密度 100。每個主的內容要表現那一項能力（例：聲＝邊走邊哼歌、瑟＝夜晚的撩撥、智＝路上的雜學）。**不寫 ns 內容**。
  - 範例（格式）：

```js
rail: [
  { id: "rail_sleep", zh: "電車搖啊搖，{name}的頭慢慢靠到你肩上。「……{call}，到了再叫我。」", ja: "電車に揺られて、{name}の頭がそっと肩に乗った。「……{call}、着いたら起こしてね」" },
  // ……
],
STORIES: {
  "聲": [
    { title: { zh: "早晨的哼歌", ja: "朝のハミング" },
      lines: { zh: ["{name}邊走邊哼著不知名的旋律。", "「啊，被{call}聽到了？」她紅著臉停下來。", "「……下次，想讓你聽完整的。」"],
               ja: ["{name}は歩きながら知らないメロディを口ずさんでいる。", "「あ、{call}に聞かれちゃった？」頬を赤くして立ち止まる。", "「……今度、ちゃんと最後まで聞いてほしいな」"] } },
    // ……共 6 段
  ],
  // ……共 9 個主
}
```

  - `CALL` 範例：`{ zh: "{p}先生", ja: "{p}さん" }`、`{ zh: "{p}", ja: "{p}くん" }`、`{ zh: "阿{p}", ja: "{p}" }`；`CALL_INTIMATE["瑟"] = { zh: "親愛的{p}", ja: "ダーリン" }` 這類依主而變的暱稱（暱稱可以不含 `{p}`）。

- [ ] **Step 4: 跑兩支檢查**

Run: `node tools/runpo_check/text_check.js; node tools/runpo_check/core_check.js`
Expected: 5 passed；27 passed

- [ ] **Step 5: Commit**

```bash
git add static_src/runpo_text.js tools/runpo_check/text_check.js
git commit -m "feat(runpo): 移動事件（電車最多）、吃醋、稱呼與型的主×6 段劇情"
```

---

### Task 6: 畫面、存檔、GPS、模擬面板

**Files:**
- Modify: `static_src/runpo.js`, `static_src/css/runpo.css`, `site_src/i18n_runpo.py`
- Create: `tools/runpo_check/ui_check.js`

**Interfaces:**
- Consumes: Task 2～5 的全部 `Core.*`、`Text.*`；`PriTestKyukaData.HERO_BY_ID`、`PriTestKyukaCrest.forInstance(inst, {size, mini})`
- Produces: `window.PriTestRunpo = { _debugState: function () { return save; } }`（給 Playwright 讀）

- [ ] **Step 1: 寫失敗的畫面檢查**（`ui_check.js`，比照 `tools/kyuka_check/ui_check.js` 的開頭與 Playwright 載入方式；port 8972）

```js
// 約跑（runpo）Playwright 流程檢查：
//   初次開啟 3 位成員 → 模擬移動 3 km／30 分 → 結算畫面（距離、方式、親密度增加）→ 存檔沒有座標
//   → 時間 +3 天後重開：吃醋事件 → 選被冷落的人出發：出發吃醋事件
//   → GPS：設定位置出發 → 移動 1.1 km、時間 +15 分 → 打卡 → 回到原點、+15 分 → 結算約 2.2 km、散步
//   → 解籤一天一次 → 角色詳細（花紋、偏好、劇情列表）→ 語言切換 → 手機寬度不橫向捲動 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8972 --directory dist
// 執行：node tools/runpo_check/ui_check.js
"use strict";
var path = require("path"), assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;
var BASE = (process.env.RUNPO_ROOT || "http://localhost:8972/") + "runpo/index.html";

(async function () {
  var browser = await chromium.launch();
  var ctx = await browser.newContext({ geolocation: { latitude: 35.6812, longitude: 139.7671 }, permissions: ["geolocation"] });
  var page = await ctx.newPage(), errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  async function state() { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestRunpo._debugState())); }); }

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-runpo-save-v1"); });
  await page.reload();
  var s = await state();
  assert.strictEqual(s.members.length, 3);
  var uid0 = s.members[0].uid;

  // 模擬移動
  await page.click("#rp-dev-toggle");
  await page.selectOption("#rp-dev-partner", uid0);
  await page.fill("#rp-dev-km", "3");
  await page.fill("#rp-dev-min", "30");
  await page.click("#rp-dev-run");
  await page.waitForSelector("#rp-result");
  assert((await page.textContent("#rp-result-km")).indexOf("3.0") >= 0);
  s = await state();
  assert.strictEqual(s.trip, null);
  assert(!/"lat"/.test(JSON.stringify(s)), "結算後存檔不應留有座標");
  assert(s.members[0].earned > 0);
  await page.click("#rp-result-close");

  // +3 天：每日開啟的吃醋事件（模擬面板仍是打開的；重新載入後 ui.dev 回到關閉）
  await page.click("#rp-dev-day");
  await page.click("#rp-dev-day");
  await page.click("#rp-dev-day");
  await page.reload();
  await page.waitForSelector("#rp-jealous");
  await page.click("#rp-jealous-close");

  // 選被冷落的人出發 → 出發的吃醋事件（GPS）
  var uid1 = (await state()).members[1].uid;
  await page.click('[data-rp-depart="' + uid1 + '"]');
  await page.waitForSelector("#rp-jealous");
  await page.click("#rp-jealous-close");
  await ctx.setGeolocation({ latitude: 35.6912, longitude: 139.7671 });
  await page.click("#rp-dev-toggle");
  await page.click("#rp-dev-15m");
  await page.click("#rp-checkpoint");
  await ctx.setGeolocation({ latitude: 35.6812, longitude: 139.7671 });
  await page.click("#rp-dev-15m");
  await page.click("#rp-settle");
  await page.waitForSelector("#rp-result");
  assert((await page.textContent("#rp-result-km")).indexOf("2.2") >= 0);
  assert.strictEqual((await state()).log[0].mode, "walk");
  await page.click("#rp-result-close");

  // 解籤一天一次
  await page.click("#rp-draw");
  assert.strictEqual((await state()).members.length, 4);
  assert(await page.isDisabled("#rp-draw"));

  // 角色詳細
  await page.click('[data-rp-detail="' + uid0 + '"]');
  await page.waitForSelector("#rp-detail svg");
  await page.waitForSelector("#rp-detail-pref");
  await page.waitForSelector("#rp-detail-stories");
  await page.click("#rp-detail-close");

  // 語言、手機寬度
  await page.evaluate(function () { window.I18N.setLang("ja"); });
  assert((await page.textContent(".rp-title")).indexOf("はしりデート") >= 0);
  await page.setViewportSize({ width: 375, height: 800 });
  var overflow = await page.evaluate(function () { return document.documentElement.scrollWidth > window.innerWidth; });
  assert(!overflow, "手機寬度橫向捲動");
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("ui_check ok");
})().catch(function (e) { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 跑檢查確認失敗**

Run: `py -3 generate.py; node tools/runpo_check/ui_check.js`（另一個終端機先跑 `py -3 -m http.server 8972 --directory dist`）
Expected: FAIL（找不到 `window.PriTestRunpo`）

- [ ] **Step 3: 實作 `runpo.js`**。結構（比照 `kyuka.js` 的 `t()`、`lang()`、`esc()`、`load()`、`persist()`、`render()`、`i18n:change` 重繪）：

```js
// 約跑（runpo）：畫面、本機存檔、GPS、模擬面板。規則全部交給 runpo_core.js。
(function () {
  "use strict";
  var Core = window.PriTestRunpoCore, T = window.PriTestRunpoText, KD = window.PriTestKyukaData, Crest = window.PriTestKyukaCrest;
  var app = document.getElementById("rp-app");
  if (!Core || !T || !KD || !Crest || !app) return;
  var SAVE_KEY = "pritest-runpo-save-v1";
  var IMG = app.getAttribute("data-img") || "../static/images/jikan/";
  var rng = window.PriTestKyukaCore.makeRng();

  function now() { return Date.now() + (save ? save.offsetMs || 0 : 0); }   // 模擬面板的時間位移
  function t(k, p) { return window.I18N ? window.I18N.t(k, p) : k; }
  function lang() { return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || "zh"; }
  function L(o) { return o ? (o[lang()] || o.zh || "") : ""; }   // en 退回 zh
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load() { try { var s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

  var save = load();
  if (!save || save.v !== 1 || !save.members) { save = null; save = Core.newSave(Date.now(), rng); persist(); }
  var ui = { result: null, jealous: null, detail: null, dev: false, error: "" };

  function player() { return save.player || (lang() === "ja" ? "あなた" : "你"); }
  function vars(m) {
    var h = KD.HERO_BY_ID[m.inst.heroId];
    return { name: L(h.name), call: Core.call(m, now(), lang(), player()), p: player() };
  }
  function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }

  function gps(cb) {
    if (!navigator.geolocation) { ui.error = t("rp_gps_unsupported"); render(); return; }
    navigator.geolocation.getCurrentPosition(
      function (pos) { cb({ t: now(), lat: pos.coords.latitude, lon: pos.coords.longitude }); },
      function () { ui.error = t("rp_gps_failed"); render(); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }
  function depart(uid) {
    gps(function (pt) {
      var r = Core.startTrip(save, uid, pt, now());
      persist();
      if (r.jealous) ui.jealous = { uid: uid, kind: "depart", line: pick(T.JEALOUS.depart) };
      render();
    });
  }
  function checkpointNow() { gps(function (pt) { Core.checkpoint(save, pt); persist(); render(); }); }
  function settleNow(modeOverride) {
    gps(function (pt) { ui.result = Core.settle(save, pt, now(), rng, { mode: modeOverride }); persist(); render(); });
  }
  function simulate(uid, km, minutes) {
    var end = now(), pts = Core.simulatePoints(end - minutes * 60000, km, minutes);
    var r = Core.startTrip(save, uid, pts[0], pts[0].t);
    ui.result = Core.settle(save, pts[1], end, rng, {});
    ui.result.jealousDeparture = r.jealous;
    persist(); render();
  }
  // 每天第一次開啟
  var opened = Core.dailyOpen(save, now());
  persist();
  if (opened && opened.jealousUid) ui.jealous = { uid: opened.jealousUid, kind: "open", line: pick(T.JEALOUS.open) };

  // ---------------- 畫面 ----------------
  // render() 依序輸出：
  //  1. 標題 .rp-title（rp_title）、今日倍率（Core.dailyMultiplier(Core.jstDate(now()))）
  //  2. 行程區：
  //     - 沒有行程：提示「從下面選一位約跑對象」
  //     - 行程中：她的名字、出發時刻、足跡點數；按鈕 #rp-checkpoint、#rp-settle（乘車時的手動改法放在結算畫面）
  //  3. 成員卡片（親密度高的在前）：頭像（IMG + hero.img + ".webp"）、名字、稀有度、型名（PriTestKyukaCore.type81(inst.v).name）、
  //     親密度條（Core.affection）、偏好標籤（T.PREF_LABEL[Core.preferenceOf(inst)]）、連續天數、幾天沒約；
  //     按鈕 [data-rp-depart=uid]（行程中 disabled）、[data-rp-detail=uid]
  //  4. #rp-draw 解籤（save.lastDraw === 今天時 disabled）
  //  5. 紀錄（save.log 前 10 筆）
  //  6. 模擬面板：#rp-dev-toggle 開關；#rp-dev-partner（select）、#rp-dev-km、#rp-dev-min、#rp-dev-run；
  //     #rp-dev-15m（offsetMs += 15 分）、#rp-dev-day（offsetMs += 1 天）、#rp-dev-reset（清除存檔，按兩次確認）、玩家名稱輸入
  //  7. 疊層（同時最多一個，依序 jealous → result → detail）：
  //     #rp-jealous：她的頭像＋ Core.fmt(L(line), vars(m))；#rp-jealous-close。沒有任何選項（不能補救）。
  //     #rp-result：#rp-result-km（km.toFixed(1)＋" km"）、移動方式（T.MODE_LABEL）、時間、
  //        基礎值 × 偏好 × 連續 × 今日倍率 ＝ +add、親密度 before → after、稱呼改變時顯示新稱呼、
  //        新解鎖的劇情（storyBefore < storyAfter）、事件文字（T.EVENTS[mode] 依 id 找）；
  //        rawMode === "ride" 時顯示「電車／開車」切換：改選時把 m.earned 不變，只改 log[0].mode 與事件（重新 pickEvents 不需要，事件依新方式從 T.EVENTS 抽）；
  //        #rp-result-close
  //     #rp-detail：Crest.forInstance(inst 的副本且 affection＝Core.affection(m, now()), {size: 220, labels: true, values: true})、
  //        #rp-detail-pref、累計距離、次數、#rp-detail-stories（6 段：已解鎖的可展開閱讀，未解鎖顯示條件）；#rp-detail-close
  //  8. ui.error 有內容時顯示錯誤列（GPS 失敗時提示改用模擬面板）
  function render() { /* 依上面的順序組 HTML 字串，app.innerHTML = html，再綁事件 */ }

  window.addEventListener("i18n:change", function () { render(); });
  window.PriTestRunpo = { _debugState: function () { return save; } };
  render();
})();
```

  乘車方式的手動切換只改**顯示與紀錄**（`save.log[0].mode`、事件），親密度已經在結算時算好不重算；`ride` 偏好在電車、開車都符合，所以結果相同。

- [ ] **Step 4: 補齊 `i18n_runpo.py` 的 UI 字串**（`rp_` 開頭，zh／ja／en 三欄；畫面上所有固定文字都要有鍵，例如 `rp_today_mult`、`rp_depart`、`rp_checkpoint`、`rp_settle`、`rp_draw`、`rp_draw_done`、`rp_gps_unsupported`、`rp_gps_failed`、`rp_result_title`、`rp_affection`、`rp_streak`、`rp_neglect_days`、`rp_dev_title`、`rp_dev_run`、`rp_dev_15m`、`rp_dev_day`、`rp_dev_reset`、`rp_story_locked`、`rp_close`）。
- [ ] **Step 5: 樣式**（`runpo.css`，只用 `rp-` 前綴）：卡片、親密度條、疊層（固定定位、可捲動）、手機 375px 不橫向捲動。
- [ ] **Step 6: 跑全部檢查**

Run: `py -3 generate.py; py -3 tools/split_css.py --check; node --check static_src/runpo.js; node tools/runpo_check/core_check.js; node tools/runpo_check/text_check.js; node tools/runpo_check/ui_check.js`
Expected: 全部通過，`ui_check ok`

- [ ] **Step 7: 實機確認**：手機開啟（GitHub Pages 部署後或區網），允許定位 → 出發 → 走一段 → 結算，確認距離合理。
- [ ] **Step 8: Commit**

```bash
git add static_src/runpo.js static_src/css/runpo.css site_src/i18n_runpo.py tools/runpo_check/ui_check.js
git commit -m "feat(runpo): 約跑畫面、GPS 出發／打卡／結算、模擬面板與畫面檢查"
```

---

### Task 7: 版本與推送

- [ ] **Step 1:** `site_src/version.py` 的 `VERSION = "2.80.0"`
- [ ] **Step 2:** 再跑一次 Task 6 Step 6 的全部檢查
- [ ] **Step 3: Commit 並推送**

```bash
git add site_src/version.py docs/runpo_design.md docs/superpowers/plans/2026-11-19-runpo-phase1.md
git commit -m "feat(runpo): v2.80.0 約跑第 1 階段：GPS 結算、模擬御所、親密度、吃醋、乘車事件、劇情"
git push private main
```

---

## 自我檢查（對照 docs/runpo_design.md 第 1 階段）

| 設計 | Task |
|---|---|
| §1 GPS 結算、打卡、逐段距離、座標結算後刪除、模擬移動 | 2、4、6 |
| §2 移動方式、電車 70%、手動改、電車事件最多 | 2、4、5、6 |
| §3.1 模擬御所、3 位起始、每日解籤、自然增加 7 天 | 3、4、6 |
| §3.2 距離遞減、上限 15、偏好 9 種、連續約跑、每日倍率、吃醋（不能補救） | 3、4、5、6 |
| §3.3 54 段劇情與解鎖門檻、G1 稱呼 4 階 | 3、5、6 |
| §11 方格 ID | 2、4 |
| 第 2 階段以後（E1 計畫、地點、天氣、B1、mapmon……） | 不在本計畫；「美」的偏好在本階段永遠不符合（`planHit: false`） |
