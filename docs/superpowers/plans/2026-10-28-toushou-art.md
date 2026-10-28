# 東正 美術（子專案 2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為東正加上 47 張 SVG 美術（類別 23、黑天鵝 21、風向 3）並把整頁換成「復古拍賣目錄」風，三模式共用、手機好讀。

**Architecture:** 新模組 `toushou_art.js` 依 PNG 清單回傳圖檔網址；`toushou.js` 提供 `artImg`／`swanCard`／`windCard` 共用元件並透過 `kit()` 給 `toushou_ui_manfen.js`。全部視覺由 `css/toushou.css` 的 CSS 變數控制（淺／深色）。測試：`art_check.js`（素材完整性＋縮圖總覽截圖）與 `art_assert.js`（嵌進既有三支 UI 檢查的版面斷言）。

**Tech Stack:** Vanilla ES5 IIFE、Python 靜態建置（`py -3 generate.py`）、手寫 SVG、Playwright（從 `tools/midnight_check/node_modules` 解析）。

## Global Constraints

- 規格：`docs/superpowers/specs/2026-10-28-toushou-art-design.md`（以下 §x 指規格章節）。
- **不改任何遊戲規則、reducer、state 結構**（`toushou_core*.js`、`toushou_data*.js` 不動）。
- SVG 規則（§2.1）：無 `<text>`／`<image>`／`<script>`／`<foreignObject>`／外部 `href`；描邊 `#111` 3px；背景透明；單檔 ≤ 12KB；不放品牌 logo、商標字樣，不畫成可辨識的真人。
- viewBox：category＝`0 0 320 200`；swan、wind＝`0 0 200 160`。
- 色盤只用（§2.2）：`#111111` `#f8f1e0` `#b08d3c` `#e2423f` `#18b96b` `#2c6cff` `#ff4f7b` `#ffd23f` `#ffd8b0` `#9aa3ad`（另可用 `#ffffff`、`none`、`fill-opacity`）。
- 字級（§6）：卡內內文 ≥ 14px、卡名 ≥ 18px、價格／數字 ≥ 22px、行距 1.5；對比 ≥ 4.5:1。
- 375px 整頁無橫捲；既有 `#ts-*` id 全部保留。
- 滿分男的風向是秘密：風向圖只能在持有者本人的畫面出現（經典模式的風向本來就公開，無此限制）。
- 圖檔路徑：`static_src/images/toushou/<kind>/<id>.svg`。
- commit 只 `git add` 該 Task 列出的檔案，**不用 `git add -A`**（另一個 session 在改 yellow）。不動 `site_src/version.py`。不 push。
- 測試前置：`py -3 generate.py`；`py -3 -m http.server 8941 --directory dist`（用完務必停掉伺服器）。
- Playwright：會重繪的元素一律 `page.dispatchEvent(sel, "click")`。

## 檔案結構

| 檔案 | 責任 |
| --- | --- |
| `static_src/toushou_art.js`（新） | PNG 清單、`url()`、`img()` |
| `static_src/images/toushou/{category,swan,wind}/*.svg`（新，47 張） | 美術本體 |
| `site_src/toushou_page.py` | script 順序加入 `toushou_art.js` |
| `static_src/toushou.js` | `artImg`／`swanCard`／`windCard`、各畫面掛圖、表格 `data-label` |
| `static_src/toushou_ui_manfen.js` | 滿分男畫面掛圖、改用 `K.swanCard` |
| `static_src/css/toushou.css` | 換膚、深色、卡面、窄螢幕表格 |
| `tools/toushou_check/art_check.js`（新） | 素材完整性＋縮圖總覽 |
| `tools/toushou_check/art_assert.js`（新） | 版面斷言 helper |
| `tools/toushou_check/{ui,insider_ui,manfen_ui}_check.js` | 呼叫 `assertArt` |
| `docs/toushou_art_guide.md`（新） | 尺寸、構圖、生圖提示詞 |

---

### Task 1: 載入模組、素材檢查工具、風向卡 3 張

**Files:**
- Create: `static_src/toushou_art.js`
- Create: `tools/toushou_check/art_check.js`
- Create: `static_src/images/toushou/wind/up.svg`、`down.svg`、`neutral.svg`
- Modify: `site_src/toushou_page.py`（`TOUSHOU_SCRIPTS`）

**Interfaces:**
- Produces: `window.PriTestToushouArt = { PNG, url(kind, id), img(el, kind, id, cls) }`；`node tools/toushou_check/art_check.js [--allow-missing]`，環境變數 `TOUSHOU_BASE`（預設 `http://localhost:8941/toushou/index.html`）、`TOUSHOU_OUT`（截圖輸出資料夾，預設 `os.tmpdir()`）。

- [ ] **Step 1: 寫 `tools/toushou_check/art_check.js`**

```js
// ============================================================================
// toushou 美術素材檢查：資料中的每個類別／黑天鵝／風向 id 都要有 SVG，且 SVG 符合規格；
// 另外產生縮圖總覽（淺色／深色）截圖，給使用者確認畫風。
// 前置：py -3 generate.py；py -3 -m http.server 8941 --directory dist
// 執行：node tools/toushou_check/art_check.js [--allow-missing]
//   --allow-missing：分批繪製期間用，缺圖只列出、不算失敗（其他規格錯誤仍算失敗）
// 規則依據：docs/superpowers/specs/2026-10-28-toushou-art-design.md §2.1／§3
// ============================================================================
"use strict";
var fs = require("fs");
var os = require("os");
var path = require("path");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.TOUSHOU_BASE || "http://localhost:8941/toushou/index.html";
var OUT = process.env.TOUSHOU_OUT || os.tmpdir();
var ALLOW_MISSING = process.argv.indexOf("--allow-missing") >= 0;
var IMG_DIR = path.join(__dirname, "..", "..", "static_src", "images", "toushou");
var VIEWBOX = { category: "0 0 320 200", swan: "0 0 200 160", wind: "0 0 200 160" };
var MAX_BYTES = 12 * 1024;
var FORBIDDEN = [/<text[\s>]/i, /<image[\s>]/i, /<script[\s>]/i, /<foreignObject[\s>]/i, /href\s*=\s*["'](?!#)/i];

(async function main() {
  var browser = await chromium.launch();
  var problems = [];
  var missing = [];
  try {
    var page = await browser.newPage();
    await page.goto(BASE);
    var ids = await page.evaluate(function () {
      var D = window.PriTestToushouData;
      function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
      return {
        category: uniq(D.CATEGORIES.map(function (c) { return c.id; }).concat(D.MANFEN_CATEGORIES.map(function (c) { return c.id; }))),
        swan: uniq(D.SWAN_CARDS.map(function (c) { return c.id; }).concat(D.MANFEN_SWAN_CARDS.map(function (c) { return c.id; }))),
        wind: Object.keys(D.WIND_COMPOSITION)
      };
    });
    Object.keys(VIEWBOX).forEach(function (kind) {
      var dir = path.join(IMG_DIR, kind);
      var files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(function (f) { return /\.svg$/.test(f); }) : [];
      files.forEach(function (f) {
        if (ids[kind].indexOf(f.replace(/\.svg$/, "")) < 0) problems.push(kind + "/" + f + ": no matching id in data");
      });
      ids[kind].forEach(function (id) {
        var file = path.join(dir, id + ".svg");
        if (!fs.existsSync(file)) { missing.push(kind + "/" + id); return; }
        var src = fs.readFileSync(file, "utf8");
        var bytes = Buffer.byteLength(src);
        if (bytes > MAX_BYTES) problems.push(kind + "/" + id + ": " + bytes + " bytes > " + MAX_BYTES);
        var m = /<svg[^>]*\bviewBox\s*=\s*"([^"]+)"/.exec(src);
        if (!m || m[1] !== VIEWBOX[kind]) problems.push(kind + "/" + id + ": viewBox must be \"" + VIEWBOX[kind] + "\"");
        if (!/xmlns\s*=\s*"http:\/\/www\.w3\.org\/2000\/svg"/.test(src)) problems.push(kind + "/" + id + ": missing xmlns");
        FORBIDDEN.forEach(function (re) { if (re.test(src)) problems.push(kind + "/" + id + ": forbidden " + re); });
      });
    });

    // 縮圖總覽：用瀏覽器實際載入每張圖（確認可解析），再截圖
    var dirUrl = BASE.replace(/toushou\/index\.html$/, "static/images/toushou/");
    var html = "<style>body{margin:12px;font:12px sans-serif;background:#efe4c8}" +
      "@media (prefers-color-scheme: dark){body{background:#1c1814;color:#f3ead7}}" +
      "h2{margin:12px 0 4px}.g{display:flex;flex-wrap:wrap;gap:8px}.c{width:170px;text-align:center}" +
      ".c img{width:160px;height:auto;background:#f8f1e0;border:1px solid #111}</style>";
    Object.keys(VIEWBOX).forEach(function (kind) {
      html += "<h2>" + kind + "</h2><div class=g>";
      ids[kind].forEach(function (id) {
        if (missing.indexOf(kind + "/" + id) >= 0) return;
        html += "<div class=c><img data-id='" + kind + "/" + id + "' src='" + dirUrl + kind + "/" + id + ".svg'><div>" + id + "</div></div>";
      });
      html += "</div>";
    });
    await page.setContent(html);
    await page.waitForLoadState("networkidle");
    var broken = await page.$$eval("img", function (imgs) {
      return imgs.filter(function (i) { return !i.complete || !i.naturalWidth; }).map(function (i) { return i.getAttribute("data-id"); });
    });
    broken.forEach(function (id) { problems.push(id + ": failed to load/parse in browser"); });
    await page.screenshot({ path: path.join(OUT, "toushou-art-gallery-light.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: path.join(OUT, "toushou-art-gallery-dark.png"), fullPage: true });
  } finally {
    await browser.close();
  }
  if (missing.length) console.log("missing (" + missing.length + "): " + missing.join(", "));
  problems.forEach(function (p) { console.log("FAIL " + p); });
  console.log("gallery: " + path.join(OUT, "toushou-art-gallery-light.png") + " / -dark.png");
  var failed = problems.length > 0 || (!ALLOW_MISSING && missing.length > 0);
  console.log(failed ? "art_check FAILED" : "art_check OK");
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 建置並執行，確認失敗**

Run: `py -3 generate.py`，背景啟動 `py -3 -m http.server 8941 --directory dist`，`node tools/toushou_check/art_check.js`
Expected: `missing (47): ...`、`art_check FAILED`

- [ ] **Step 3: 寫 `static_src/toushou_art.js`**

```js
// 東正小遊戲（toushou）的美術素材：依 PNG 清單決定讀 .png 或 .svg。
// 圖檔放在 static_src/images/toushou/<kind>/<id>.svg（kind：category／swan／wind）。
// 換成 PNG：放同名 <id>.png（尺寸＝viewBox×2），再在下面的 PNG 清單加一行。不先試 PNG 再退 SVG，避免 404。
// 規格與構圖：docs/toushou_art_guide.md、docs/superpowers/specs/2026-10-28-toushou-art-design.md
(function () {
  "use strict";

  var DIR = "../static/images/toushou/";
  var PNG = { category: {}, swan: {}, wind: {} };

  function url(kind, id) {
    return DIR + kind + "/" + id + (PNG[kind] && PNG[kind][id] ? ".png" : ".svg");
  }

  // el 由呼叫端傳入（toushou.js 的 DOM helper），本檔不另寫 DOM 工具
  function img(el, kind, id, cls) {
    return el("img", { class: cls || "", src: url(kind, id), alt: "", draggable: "false" });
  }

  window.PriTestToushouArt = { PNG: PNG, url: url, img: img };
})();
```

- [ ] **Step 4: 在 `site_src/toushou_page.py` 的 `TOUSHOU_SCRIPTS` 加入 `toushou_art.js`**

放在 `"toushou_core_manfen.js",` 之後、`"toushou_ui_manfen.js",` 之前：

```python
    "toushou_core_manfen.js",
    # 美術素材（類別插圖、黑天鵝、風向卡）的網址；UI 之前載入
    "toushou_art.js",
    "toushou_ui_manfen.js",
```

- [ ] **Step 5: 畫風向卡 3 張**（viewBox `0 0 200 160`，規則見 Global Constraints）

- `wind/up.svg`：綠色（`#18b96b`）粗大上升箭頭，黑描邊，箭頭後方黃色（`#ffd23f`）放射爆炸框，箭身右下 2–3 條速度線。
- `wind/down.svg`：紅色（`#e2423f`）粗大下墜箭頭，黑描邊，下方地面龜裂線，旁邊 2 滴藍色（`#2c6cff`）冷汗。
- `wind/neutral.svg`：灰色（`#9aa3ad`）天秤，兩端秤盤水平，支柱金色（`#b08d3c`），兩側各一條水平虛線。

檔頭格式（每張 SVG 都用這個骨架）：

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 160" stroke="#111" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
  <!-- 圖形 -->
</svg>
```

- [ ] **Step 6: 重新建置並執行 `node tools/toushou_check/art_check.js --allow-missing`**

Expected: `missing (44)`（只剩 category 23＋swan 21）、無 `FAIL`、`art_check OK`。用 Read 打開 `toushou-art-gallery-light.png` 與 `-dark.png` 目視三張風向卡：主體清楚、深色背景下也看得見。

- [ ] **Step 7: 確認既有頁面沒壞**

Run: `node tools/toushou_check/ui_check.js` 與 `node tools/toushou_check/manfen_ui_check.js`
Expected: 兩支皆 OK（只多載入一支 JS）。

- [ ] **Step 8: Commit**

```bash
git add static_src/toushou_art.js site_src/toushou_page.py tools/toushou_check/art_check.js static_src/images/toushou/wind/up.svg static_src/images/toushou/wind/down.svg static_src/images/toushou/wind/neutral.svg
git commit -m "feat(toushou): 美術載入模組、素材檢查工具、風向卡 SVG"
```

---

### Task 2: 類別插圖 第 1 批（9 張）

**Files:** Create `static_src/images/toushou/category/<id>.svg`（下列 9 個）

**Interfaces:** Consumes Task 1 的 `art_check.js --allow-missing`。

viewBox `0 0 320 200`，主體置中、左右留 16 以上邊距（畫面會被裁成 16:10 以外比例時仍完整）。普普漫畫風：黑描邊 3px、色塊平塗、可加爆炸框／放射線／星芒（星芒用 `<path>`，不用文字字元）。**不放文字、品牌、可辨識真人。**

| id | 構圖 |
| --- | --- |
| `anime_game` | 遊戲手把（藍）＋後方粉紅爆炸框＋漫畫對話框（框內只有「!」形狀的 path） |
| `jp_celebrity` | 中央立式麥克風，兩道黃色聚光燈光錐，周圍星芒 |
| `jp_company` | 三棟藍色辦公大樓剪影，前方綠色上漲鋸齒股價線＋箭頭 |
| `tw_company` | 圓形半導體晶圓（格狀晶片紋）＋右側階梯式高塔剪影（一般化造型） |
| `jp_sports` | 棒球（紅縫線）＋斜放球棒，球後方速度線，黃色衝擊星 |
| `jp_pop` | 粉紅應援螢光棒交叉＋音符 3 個（音符用 path） |
| `washoku` | 木製壽司台上 2 貫握壽司（橙色魚片、白飯）＋一雙筷子 |
| `yoshoku` | 蛋包飯（黃，番茄醬波浪線紅）＋旁邊漢堡排冒熱氣 |
| `taiwan_food` | 珍珠奶茶杯（粗吸管、底部黑珍珠）＋右側蒸籠內 3 顆小籠包冒熱氣 |

- [ ] **Step 1:** 依上表畫 9 張 SVG（骨架同 Task 1 Step 5，viewBox 改 `0 0 320 200`）。
- [ ] **Step 2:** `py -3 generate.py`，啟動伺服器，`node tools/toushou_check/art_check.js --allow-missing`。Expected：無 `FAIL`、`art_check OK`、missing 數＝35。
- [ ] **Step 3:** Read 兩張總覽截圖目視：每張一眼看得出類別、深色下清楚、描邊粗細一致。不滿意就修。
- [ ] **Step 4: Commit**

```bash
git add static_src/images/toushou/category/anime_game.svg static_src/images/toushou/category/jp_celebrity.svg static_src/images/toushou/category/jp_company.svg static_src/images/toushou/category/tw_company.svg static_src/images/toushou/category/jp_sports.svg static_src/images/toushou/category/jp_pop.svg static_src/images/toushou/category/washoku.svg static_src/images/toushou/category/yoshoku.svg static_src/images/toushou/category/taiwan_food.svg
git commit -m "feat(toushou): 類別插圖第 1 批（9 張）"
```

> 控制者：本批完成後把總覽截圖給使用者看（SendUserFile），畫風確認後才派 Task 3。

---

### Task 3: 類別插圖 第 2 批（8 張）

**Files:** Create `static_src/images/toushou/category/<id>.svg`（下列 8 個）

規則同 Task 2，並**對齊 Task 2 已完成的 9 張的描邊、色塊與構圖密度**（先 Read 其中 2–3 張 SVG 原始碼）。

| id | 構圖 |
| --- | --- |
| `hokkaido` | 雪山（白頂藍身）＋前方紅色大螃蟹舉鉗，飄雪點 |
| `tohoku` | 金黃稻田波浪＋紅蘋果 2 顆，遠方雪山 |
| `kansai` | 盤中 6 顆章魚燒（醬汁、柴魚片）＋後方小鳥居 |
| `kanto` | 細高電波塔剪影（一般化造型）＋前方擁擠電車車廂，人頭剪影塞滿窗 |
| `kyushu_okinawa` | 冒煙火山＋前方藍色海浪與紅色扶桑花 |
| `sengoku_event` | 兩把交叉武士刀＋後方兩面旗指物（直式旗，無字無家紋）＋火焰 |
| `sengoku_person` | 武士頭盔（兜）正面剪影，金色前立月牙，面部留暗影不畫五官 |
| `taiwan_spot` | 夜市紅燈籠串＋遠方山稜線＋一盞升空天燈 |

- [ ] **Step 1:** 畫 8 張。
- [ ] **Step 2:** 建置、`art_check.js --allow-missing`。Expected：無 `FAIL`、missing＝27。
- [ ] **Step 3:** 目視總覽，17 張一般類別風格一致。
- [ ] **Step 4: Commit**

```bash
git add static_src/images/toushou/category/hokkaido.svg static_src/images/toushou/category/tohoku.svg static_src/images/toushou/category/kansai.svg static_src/images/toushou/category/kanto.svg static_src/images/toushou/category/kyushu_okinawa.svg static_src/images/toushou/category/sengoku_event.svg static_src/images/toushou/category/sengoku_person.svg static_src/images/toushou/category/taiwan_spot.svg
git commit -m "feat(toushou): 類別插圖第 2 批（8 張）"
```

> 控制者：完成後給使用者看總覽。

---

### Task 4: 滿分男類別封面（6 張）

**Files:** Create `static_src/images/toushou/category/mf_man.svg`、`mf_woman.svg`、`mf_job.svg`、`mf_home.svg`、`mf_roommate.svg`、`mf_travel.svg`

**滿分男角色固定造型（6 張必須是同一個人）：** 黑色刺蝟頭（尖刺 5–6 根）、黑框方眼鏡、得意露齒笑（白牙一排）、膚色 `#ffd8b0`、胸前金色圓形徽章上用 path 畫出「100」字形（不是 `<text>`）、身後粉紅爆炸框。人物佔畫面左 60%，右側放類別道具。

先畫 `mf_man` 定案角色，其他 5 張從 `mf_man` 複製頭部 path 再換服裝與道具：

| id | 扮裝與道具 |
| --- | --- |
| `mf_man` | 藍西裝紅領帶，嘴叼紅玫瑰，眨一隻眼，周圍閃光 |
| `mf_woman` | 戴金色長捲髮假髮＋粉紅洋裝＋珍珠項鍊，眼鏡和刺蝟頭從假髮下露出（搞笑反串），手比愛心 |
| `mf_job` | 西裝＋識別證掛繩，提著塞滿鈔票（綠色長方形）爆出來的公事包 |
| `mf_home` | 雙手高舉巨大金色鑰匙，右側一棟小洋房 |
| `mf_roommate` | 圍裙＋鍋鏟，腋下夾枕頭，嘴叼牙刷 |
| `mf_travel` | 墨鏡推到頭頂、巨大登山背包，手拿護照（無字），右上一架飛機 |

- [ ] **Step 1:** 畫 6 張。
- [ ] **Step 2:** 建置、`art_check.js --allow-missing`。Expected：無 `FAIL`、missing＝21（只剩 swan）。
- [ ] **Step 3:** 目視總覽：6 張一看就是同一個角色。
- [ ] **Step 4: Commit**

```bash
git add static_src/images/toushou/category/mf_man.svg static_src/images/toushou/category/mf_woman.svg static_src/images/toushou/category/mf_job.svg static_src/images/toushou/category/mf_home.svg static_src/images/toushou/category/mf_roommate.svg static_src/images/toushou/category/mf_travel.svg
git commit -m "feat(toushou): 滿分男類別封面（6 張）"
```

> 控制者：完成後給使用者看總覽。

---

### Task 5: 黑天鵝卡 第 1 批（11 張）

**Files:** Create `static_src/images/toushou/swan/<id>.svg`（下列 11 個）

viewBox `0 0 200 160`。卡框由 CSS 提供，SVG 只畫中央插圖，主體佔 70% 左右，留邊。普普漫畫風，與風向卡（Task 1）一致。

| id | 構圖 |
| --- | --- |
| `circuit` | 配電箱開關被紅色閃電劈斷，火花四濺 |
| `hype` | 粉紅大聲公噴出火焰與星芒 |
| `whale` | 藍色鯨魚躍出水面，噴出金色硬幣 |
| `exhausted` | 洩氣的綠色氣球垂頭，旁邊小小的下彎箭頭 |
| `fomo` | 一群手（膚色）從下方伸向一枚升空火箭 |
| `panic` | 三張驚叫臉（大張嘴、冷汗）擠在一起，後方紅色下墜箭頭 |
| `lull` | 平直的灰色走勢線上，一隻蝸牛慢慢爬，滾草經過 |
| `momentum` | 雪球從斜坡滾下越滾越大（三段大小），速度線 |
| `exright` | 剪刀剪開一張金色票券（虛線切口） |
| `shortcover` | 一隻熊（灰）冒冷汗、倒退著跑，手抱一疊綠色股票 |
| `gap` | 兩根 K 棒之間斷開一段空白，空白處畫閃電狀裂縫 |

- [ ] **Step 1:** 畫 11 張。
- [ ] **Step 2:** 建置、`art_check.js --allow-missing`。Expected：無 `FAIL`、missing＝10。
- [ ] **Step 3:** 目視總覽。
- [ ] **Step 4: Commit**

```bash
git add static_src/images/toushou/swan/circuit.svg static_src/images/toushou/swan/hype.svg static_src/images/toushou/swan/whale.svg static_src/images/toushou/swan/exhausted.svg static_src/images/toushou/swan/fomo.svg static_src/images/toushou/swan/panic.svg static_src/images/toushou/swan/lull.svg static_src/images/toushou/swan/momentum.svg static_src/images/toushou/swan/exright.svg static_src/images/toushou/swan/shortcover.svg static_src/images/toushou/swan/gap.svg
git commit -m "feat(toushou): 黑天鵝卡插圖第 1 批（11 張）"
```

> 控制者：完成後給使用者看總覽。

---

### Task 6: 黑天鵝卡 第 2 批（10 張）

**Files:** Create `static_src/images/toushou/swan/<id>.svg`（下列 10 個）

規則同 Task 5，先 Read Task 5 的 2–3 張 SVG 對齊風格。

| id | 構圖 |
| --- | --- |
| `limit` | 溫度計，上下各一條粗紅色天花板／地板橫槓夾住水銀柱 |
| `rumor` | 側臉嘴巴耳語，對話框裂成兩半 |
| `extra` | 法槌敲在會議桌上，桌邊三張空椅子，衝擊線 |
| `gag` | 一張嘴被兩條黑色膠帶打叉封住，旁邊冒汗 |
| `reverse` | 兩個首尾相接的粗圓弧箭頭（逆時針），中央小問號形 path |
| `cancel` | 一張合約紙上蓋著巨大紅色 X 印章 |
| `upset` | 烏龜越過終點線舉雙手，兔子在後面跌倒 |
| `bailout` | 降落傘吊著一袋金色錢袋緩緩落下 |
| `calm` | 平靜海面、半顆太陽、一杯冒熱氣的茶 |
| `trial` | 金色天秤居中、上方聚光燈，下方一排舉著乾草叉的剪影群眾 |

- [ ] **Step 1:** 畫 10 張。
- [ ] **Step 2:** 建置、`node tools/toushou_check/art_check.js`（**不加** `--allow-missing`）。Expected：`art_check OK`、無 missing。
- [ ] **Step 3:** 目視總覽（47 張全部）。
- [ ] **Step 4: Commit**

```bash
git add static_src/images/toushou/swan/limit.svg static_src/images/toushou/swan/rumor.svg static_src/images/toushou/swan/extra.svg static_src/images/toushou/swan/gag.svg static_src/images/toushou/swan/reverse.svg static_src/images/toushou/swan/cancel.svg static_src/images/toushou/swan/upset.svg static_src/images/toushou/swan/bailout.svg static_src/images/toushou/swan/calm.svg static_src/images/toushou/swan/trial.svg
git commit -m "feat(toushou): 黑天鵝卡插圖第 2 批（10 張），素材齊全"
```

> 控制者：完成後給使用者看總覽。

---

### Task 7: 換膚＋經典／內線畫面掛圖

**Files:**
- Create: `tools/toushou_check/art_assert.js`
- Modify: `static_src/css/toushou.css`
- Modify: `static_src/toushou.js`
- Modify: `tools/toushou_check/ui_check.js`、`tools/toushou_check/insider_ui_check.js`

**Interfaces:**
- Consumes: `window.PriTestToushouArt.img(el, kind, id, cls)`。
- Produces（`toushou.js` 內，並加進 `kit()`）：
  - `artImg(kind, id, cls)` → `<img>`
  - `swanCard(id, desc, cardOverride)` → `<section id="ts-swan-badge" class="ts-swan-badge ts-card ts-card-swan">`，內含 `.ts-card-kicker`（`ts_swan_heading`）、`.ts-card-art`（swan 圖）、`.ts-card-name`（卡名）、`.ts-card-text`（desc）
  - `windCard(w)` → `<div class="ts-card ts-card-wind ts-wind-<w>">`，內含 `.ts-card-kicker`（`ts_wind`）、`.ts-card-art`（wind 圖）、`<span id="ts-wind-badge" class="ts-wind-badge ts-card-name">`（`windLabel(w)`）
  - `tdl(label, v)` → `<td data-label=label>`（窄螢幕表格用）
- Produces（`art_assert.js`）：`module.exports = { assertArt: async function (page, label) }`

- [ ] **Step 1: 寫 `tools/toushou_check/art_assert.js`**

```js
// toushou 美術版面斷言（給 ui_check／insider_ui_check／manfen_ui_check 在各階段呼叫）。
// 規則依據：docs/superpowers/specs/2026-10-28-toushou-art-design.md §6／§7
"use strict";
var assert = require("assert");

async function assertArt(page, label) {
  await page.waitForLoadState("networkidle");
  var r = await page.evaluate(function () {
    var de = document.documentElement;
    var app = document.getElementById("ts-app");
    function px(sel) {
      return Array.prototype.map.call(app.querySelectorAll(sel), function (n) {
        return { sel: sel, size: parseFloat(getComputedStyle(n).fontSize), text: n.textContent.slice(0, 20) };
      });
    }
    return {
      scroll: de.scrollWidth, client: de.clientWidth,
      broken: Array.prototype.filter.call(app.querySelectorAll("img"), function (i) { return !i.complete || !i.naturalWidth; })
        .map(function (i) { return i.getAttribute("src"); }),
      text: px(".ts-card-text, .ts-target-card p, .ts-news-board li"),
      names: px(".ts-card-name, .ts-target-card h2"),
      nums: px(".ts-price")
    };
  });
  assert.ok(r.scroll <= r.client, label + ": horizontal scroll (" + r.scroll + " > " + r.client + ")");
  assert.deepStrictEqual(r.broken, [], label + ": images failed to load");
  r.text.forEach(function (x) { assert.ok(x.size >= 14, label + ": " + x.sel + " '" + x.text + "' font " + x.size + "px < 14"); });
  r.names.forEach(function (x) { assert.ok(x.size >= 18, label + ": " + x.sel + " '" + x.text + "' font " + x.size + "px < 18"); });
  r.nums.forEach(function (x) { assert.ok(x.size >= 22, label + ": " + x.sel + " '" + x.text + "' font " + x.size + "px < 22"); });
}

module.exports = { assertArt: assertArt };
```

- [ ] **Step 2: 在 `ui_check.js`、`insider_ui_check.js` 接上斷言（先讓它失敗）**

1. 兩支的 `browser.newPage(...)` 改為 `{ viewport: { width: 375, height: 800 } }`（原本若已有 viewport 參數就改寬度）。
2. 檔頭 require 區加：`var assertArt = require("./art_assert").assertArt;`
3. 在每個階段畫面完成渲染、做完該階段既有斷言之後，加 `await assertArt(page, "<階段名>");`。至少涵蓋：設定畫面、reveal_target、（經典）news／discuss／vote／bet、（內線）insider_stake／insider_narrate／bet、settle、final（final 時先把所有 `<details>` 打開：`await page.$$eval("details", function (ds) { ds.forEach(function (d) { d.open = true; }); });`）。
4. 若 375px 寬讓既有斷言失敗（例如元素被擋住），修測試的操作方式（改用 dispatchEvent），**不要放寬斷言**。

Run: 建置、啟動伺服器、`node tools/toushou_check/ui_check.js`
Expected: FAIL（現在字級不足或結算表橫捲）。

- [ ] **Step 3: 改 `static_src/css/toushou.css`——變數與換膚**

在檔案開頭（第一個規則之前）加入變數；並把既有規則中的寫死顏色（`#ccc` `#999` `#ddd` `#c0392b` `#2e8b57` `#4a8fd8` `#8a2be2` `#7a5c00` 等）改成對應變數：

```css
/* ===== 換膚：復古拍賣目錄（docs/superpowers/specs/2026-10-28-toushou-art-design.md §6） ===== */
.ts-wrap {
  --ts-paper: #f8f1e0;
  --ts-paper-2: #efe4c8;
  --ts-ink: #2b2118;
  --ts-gold: #8a6a1f;      /* 文字用金：對 paper 對比 ≥ 4.5 */
  --ts-gold-line: #b08d3c; /* 線條用金 */
  --ts-up: #11784a;
  --ts-down: #b3261e;
  --ts-line: #2b2118;
  --ts-clip: #ffffff;
  --ts-accent: #2c6cff;
  font-size: 16px;
  line-height: 1.5;
  color: var(--ts-ink);
  background: var(--ts-paper-2);
  padding: 0.75rem;
  border-radius: 4px;
}
@media (prefers-color-scheme: dark) {
  .ts-wrap {
    --ts-paper: #2a241d;
    --ts-paper-2: #1c1814;
    --ts-ink: #f3ead7;
    --ts-gold: #e0bf6a;
    --ts-gold-line: #b08d3c;
    --ts-up: #4fd08f;
    --ts-down: #ff7a70;
    --ts-line: #c9b88f;
    --ts-clip: #3a3229;
    --ts-accent: #7fa6ff;
  }
}
.ts-wrap h1, .ts-wrap h2, .ts-wrap h3 { font-family: Georgia, "Noto Serif TC", "Noto Serif JP", "Songti TC", serif; }
.ts-panel {
  background: var(--ts-paper);
  border: 2px solid var(--ts-line);
  outline: 1px solid var(--ts-gold-line);
  outline-offset: -6px;
  border-radius: 2px;
  padding: 1rem;
  margin-bottom: 1rem;
}
.ts-wrap button {
  font: inherit;
  min-height: 2.5rem;
  padding: 0.4rem 0.9rem;
  border: 2px solid var(--ts-line);
  background: transparent;
  color: var(--ts-ink);
  border-radius: 2px;
  cursor: pointer;
}
.ts-wrap .ts-primary {
  background: var(--ts-ink);
  color: var(--ts-paper);
  font-weight: bold;
  letter-spacing: 0.1em;
  padding: 0.5rem 1.4rem;
}
.ts-wrap input, .ts-wrap select, .ts-wrap textarea {
  font: inherit;
  color: var(--ts-ink);
  background: var(--ts-clip);
  border: 1px solid var(--ts-line);
  border-radius: 2px;
}
.ts-target-card > p:first-of-type { letter-spacing: 0.15em; color: var(--ts-gold); text-align: center; font-weight: bold; }
.ts-target-card h2 { text-align: center; font-size: 1.5rem; }
.ts-price { font-size: 1.75rem; font-weight: bold; font-variant-numeric: tabular-nums; }
/* 消息看板：剪報條 */
.ts-news-board li {
  background: var(--ts-clip);
  border: 1px solid var(--ts-line);
  border-left: 5px solid var(--ts-line);
  padding: 0.4rem 0.6rem;
  margin: 0.4rem 0;
  font-size: 1rem;
  transform: rotate(-0.6deg);
}
.ts-news-board li:nth-child(even) { transform: rotate(0.6deg); }
.ts-news-board li.ts-up { border-left-color: var(--ts-up); }
.ts-news-board li.ts-down { border-left-color: var(--ts-down); }
/* 卡面（黑天鵝／風向）：紙底＋墨框＋金線，插圖在中，卡名與文字是 HTML */
.ts-card {
  background: var(--ts-paper);
  border: 2px solid var(--ts-line);
  outline: 1px solid var(--ts-gold-line);
  outline-offset: -6px;
  padding: 0.75rem;
  margin: 0.75rem auto;
  max-width: 20rem;
  text-align: center;
}
.ts-card-kicker { display: block; font-size: 0.875rem; letter-spacing: 0.2em; color: var(--ts-gold); font-weight: bold; }
.ts-card-art { display: block; width: 100%; max-width: 15rem; height: auto; margin: 0.4rem auto; }
.ts-card-name { display: block; font-size: 1.25rem; font-weight: bold; font-family: Georgia, "Noto Serif TC", "Noto Serif JP", serif; }
.ts-card-text { display: block; font-size: 1rem; margin-top: 0.25rem; }
.ts-wind-up .ts-card-name { color: var(--ts-up); }
.ts-wind-down .ts-card-name { color: var(--ts-down); }
/* 類別插圖 */
.ts-cat-art { display: block; width: 100%; max-width: 24rem; height: auto; margin: 0.25rem auto 0.5rem; background: var(--ts-clip); border: 1px solid var(--ts-line); }
.ts-cat-icon { width: 2rem; height: 1.25rem; object-fit: contain; vertical-align: middle; margin-right: 0.25rem; }
.ts-cat-thumb { width: 3rem; height: 1.875rem; object-fit: cover; vertical-align: middle; margin-right: 0.4rem; border: 1px solid var(--ts-line); }
.ts-swan-icon { width: 1.5rem; height: 1.2rem; vertical-align: middle; margin: 0 0.15rem; }
/* 結算表：窄螢幕改成每位玩家一張小卡 */
@media (max-width: 599px) {
  .ts-table, .ts-table tbody, .ts-table tr, .ts-table td { display: block; width: 100%; }
  .ts-table tr.ts-head { display: none; }
  .ts-table tr { border: 1px solid var(--ts-line); background: var(--ts-clip); margin: 0.5rem 0; padding: 0.25rem 0.5rem; box-sizing: border-box; }
  .ts-table td { display: flex; justify-content: space-between; gap: 0.5rem; border: none; padding: 0.15rem 0; text-align: right; white-space: normal; }
  .ts-table td::before { content: attr(data-label); font-weight: bold; text-align: left; }
  .ts-table td:first-child { font-weight: bold; font-size: 1.1rem; }
  .ts-table td:first-child::before { content: none; }
}
```

刪除舊的 `.ts-panel`、`.ts-price`、`.ts-news-board li`、`.ts-swan-badge`、`.ts-wind-badge` 規則中被上面取代的部分（同一屬性不要定義兩次）。`.ts-hooks` 的 `font-size: 0.9em; opacity: 0.8` 改為 `font-size: 0.95rem; color: var(--ts-ink); opacity: 0.85`，確認對比仍 ≥ 4.5（深色、淺色都算）。

- [ ] **Step 4: 改 `static_src/toushou.js`——共用元件**

在檔頭取模組處加 `var Art = window.PriTestToushouArt;`，在 `swanName` 附近加：

```js
  // 美術（toushou_art.js）：類別插圖／黑天鵝卡／風向卡。卡名與效果文字用 HTML（三語、可放大）
  function artImg(kind, id, cls) { return Art.img(el, kind, id, cls); }

  function swanCard(id, desc, cardOverride) {
    var card = cardOverride || Core.swanById(id);
    return el("section", { id: "ts-swan-badge", class: "ts-swan-badge ts-card ts-card-swan" }, [
      el("span", { class: "ts-card-kicker", text: t("ts_swan_heading") }),
      artImg("swan", id, "ts-card-art"),
      el("strong", { class: "ts-card-name", text: card ? lt(card.name) : id }),
      desc ? el("span", { class: "ts-card-text", text: desc }) : null
    ]);
  }

  function windCard(w) {
    return el("div", { class: "ts-card ts-card-wind ts-wind-" + w }, [
      el("span", { class: "ts-card-kicker", text: t("ts_wind") }),
      artImg("wind", w, "ts-card-art"),
      el("span", { id: "ts-wind-badge", class: "ts-wind-badge ts-card-name", text: windLabel(w) })
    ]);
  }

  // 表格儲存格；data-label 給窄螢幕的「每位玩家一張小卡」排版顯示欄名
  function tdl(label, v) { return el("td", { "data-label": label, text: String(v) }); }
```

`Core.swanById` 只查經典的 `SWAN_CARDS`；滿分男的黑天鵝效果文字不同，所以 `swanCard` 的完整簽名是 `swanCard(id, desc, cardOverride)`：有傳 `cardOverride`（滿分男端傳 `M.swanById(id)` 的結果）就用它的名稱，否則用 `Core.swanById(id)`。程式改為 `var card = cardOverride || Core.swanById(id);`。

把 `artImg`、`swanCard`、`windCard`、`tdl` 加進 `kit()` 回傳的物件。

- [ ] **Step 5: 改 `static_src/toushou.js`——掛到各畫面**

1. `marketInfo()`：`box.appendChild(el("p", { id: "ts-swan-badge", ... }))` 改為 `box.appendChild(swanCard(info.event, desc));`。
2. `targetCard()`：`el("p", { text: t("ts_target_heading", ...) ... })` 之後、`el("h2", ...)` 之前插入 `artImg("category", target.category, "ts-cat-art")`。
3. `renderNews()`：`windBadge` 改為 `state.current.wind ? windCard(state.current.wind) : null`。
4. `newsBoard()`：`n.wind ? " [" + windLabel(n.wind) + "]" : ""` 保持文字不變；`ts-news-mod` 兩處在文字前加小圖示——第一處用 `artImg("swan", eventId, "ts-swan-icon")`，第二處用 `artImg("swan", n.priceEvent, "ts-swan-icon")`（把 `text:` 改成子節點陣列 `[artImg(...), t(...)]`）。
5. `catBoxes()`（`renderSetup` 內）：每個 label 的子節點改為 `[checkbox, artImg("category", c.id, "ts-cat-icon"), lt(c.name)]`。
6. `renderFinal()` 經典／內線回顧：`<summary>` 改為子節點 `[artImg("category", h.category, "ts-cat-thumb"), 原文字]`（history 記錄本來就有 `category` 欄位，見 `toushou_core.js` 585／701 行）。
7. `settleTable()`：表頭 `tr` 加 `class: "ts-head"`；每列改用 `tdl(t(<對應欄 key>), v)`。`renderFinal()` 的總表同樣處理。
8. 確認 `renderDiscuss()`（約 958 行）的風向文字維持原樣（純文字，不需要卡面）。

- [ ] **Step 6: 建置、跑測試**

Run: `py -3 generate.py`，啟動伺服器，依序 `node tools/toushou_check/ui_check.js`、`node tools/toushou_check/insider_ui_check.js`、`node tools/toushou_check/multi_device_check.js`、`node tools/toushou_check/core_check.js`、`py -3 tools/split_css.py --check`
Expected: 全部 OK。失敗時修 CSS／DOM，不放寬斷言。

- [ ] **Step 7: 截圖目視**

寫一支臨時 Playwright 腳本（放 scratchpad，不 commit）：375px、淺色與深色各一次，走到經典模式的 reveal_target、news（有風向）、settle、final，各截一張到 scratchpad。Read 截圖確認：紙底金框、卡面置中、字夠大、深色可讀、結算為小卡排列。

- [ ] **Step 8: Commit**

```bash
git add tools/toushou_check/art_assert.js static_src/css/toushou.css static_src/toushou.js tools/toushou_check/ui_check.js tools/toushou_check/insider_ui_check.js
git commit -m "feat(toushou): 拍賣目錄風換膚；經典／內線畫面加上類別插圖、黑天鵝與風向卡面"
```

---

### Task 8: 滿分男畫面掛圖＋保密斷言

**Files:**
- Modify: `static_src/toushou_ui_manfen.js`
- Modify: `static_src/css/toushou.css`（只在需要時補 `.ts-mf-*`）
- Modify: `tools/toushou_check/manfen_ui_check.js`

**Interfaces:**
- Consumes: `K.artImg(kind, id, cls)`、`K.swanCard(id, desc, cardOverride)`、`K.windCard(w)`、`K.tdl(label, v)`（Task 7）；`assertArt(page, label)`（Task 7）。

- [ ] **Step 1: 在 `manfen_ui_check.js` 加斷言（先讓它失敗）**

1. require `./art_assert` 的 `assertArt`，在每個階段既有斷言之後呼叫（reveal_target、mf_expose、mf_rate、mf_mind、bet、settle、final；final 先打開所有 `<details>`）。
2. 在 `assertNoWindLeak()` 末尾加：

```js
  // 風向卡圖只能在持有者本人的評分畫面出現（規格 §4.1）
  if (!allowDirectionWords) {
    var windImgs = await page.$$eval("#ts-app img", function (imgs) {
      return imgs.map(function (i) { return i.getAttribute("src"); }).filter(function (s) { return /images\/toushou\/wind\//.test(s); });
    });
    assert.deepStrictEqual(windImgs, [], label + ": wind card image leaked");
  }
```

3. 在持有者看到 `#ts-mf-wind-status` 的地方（約 145 行）加斷言：持有者畫面有且只有 1 張 `img[src*="images/toushou/wind/' + 持有的 windCard + '"]`；非持有者畫面（約 154 行）0 張。

Run: 建置、伺服器、`node tools/toushou_check/manfen_ui_check.js`
Expected: FAIL（字級或結算表橫捲，或缺圖）。

- [ ] **Step 2: 改 `static_src/toushou_ui_manfen.js`**

1. `swanBadge(K, id)` 改為 `return card ? K.swanCard(id, K.lt(card.text), card) : null;`（`card = M.swanById(id)`）。
2. `subjectCard()`：標題 `<p>` 之後、`<h2>` 之前插入 `K.artImg("category", target.category, "ts-cat-art")`（`target.category` 可能是 `mf_*` 或一般類別 id，兩者都有圖）。
3. 評分畫面 `windLine`（約 148–151 行）：保持 `#ts-mf-wind-status` 的 `<p>` 與文字**完全不變**；只在 `holder` 為真時，在它後面多放 `K.windCard(c.windCard)`。卡片裡的 `#ts-wind-badge` id 與經典重複不會同時出現（不同模式），但為保險在 manfen 呼叫後把該 span 的 id 移除：`var wc = K.windCard(c.windCard); var b = wc.querySelector("#ts-wind-badge"); if (b) b.removeAttribute("id");`。
4. 結算表（約 312–324 行）：表頭 `tr` 加 `class: "ts-head"`，每格改 `K.tdl(K.t(<欄 key>), v)`。
5. `review(K, h)`：回顧 `<summary>`（或標題節點）前加 `K.artImg("category", <該題類別>, "ts-cat-thumb")`；類別用 `h.category`（`toushou_core_manfen.js` 451 行已寫入）。結算公開的回顧中，若 `h.windHolder` 有值，在風向揭曉那行旁加 `K.artImg("wind", h.windCard, "ts-swan-icon")`。

- [ ] **Step 3: 建置、跑全部測試**

Run: `py -3 generate.py`，伺服器，`manfen_ui_check.js`（連跑 3 次）、`manfen_core_check.js`、`ui_check.js`、`insider_ui_check.js`、`multi_device_check.js`、`core_check.js`、`art_check.js`、`py -3 tools/split_css.py --check`
Expected: 全部 OK。

- [ ] **Step 4: 截圖目視**（臨時腳本放 scratchpad）：滿分男 reveal_target、持有者評分畫面、settle、final，淺／深色。

- [ ] **Step 5: Commit**

```bash
git add static_src/toushou_ui_manfen.js static_src/css/toushou.css tools/toushou_check/manfen_ui_check.js
git commit -m "feat(toushou): 滿分男畫面加上封面、黑天鵝與風向卡面；風向圖保密檢查"
```

---

### Task 9: 美術說明文件

**Files:** Create `docs/toushou_art_guide.md`

- [ ] **Step 1:** 先 Read `docs/yellow_art_guide.md` 了解既有格式，再寫 `docs/toushou_art_guide.md`（繁體中文），包含：
  1. 檔案位置、命名（`<kind>/<id>.svg|png`）、PNG 尺寸（category 640×400、swan／wind 400×320，透明背景）。
  2. 換 PNG 步驟：放檔 → `static_src/toushou_art.js` 的 `PNG.<kind>.<id> = 1` → `py -3 generate.py` → `node tools/toushou_check/art_check.js`。
  3. 風格總則（§2）、色盤表（§2.2）、禁止事項（品牌、真人、文字）。
  4. 47 張逐張表格：id、中文名（從 i18n／資料取）、構圖說明（照 Task 1–6 的表）。
  5. 生圖提示詞範本（英文，一段共用風格前綴＋每張的構圖句），例：`Flat pop-art comic illustration, thick black 3px outlines, saturated flat colors (pink #ff4f7b, yellow #ffd23f, blue #2c6cff, green #18b96b, red #e2423f), no text, no logos, transparent background, centered subject, 16:10.` 再接該張構圖。滿分男 6 張另附角色固定描述。
- [ ] **Step 2: Commit**

```bash
git add docs/toushou_art_guide.md
git commit -m "docs(toushou): 美術說明與生圖提示詞"
```
