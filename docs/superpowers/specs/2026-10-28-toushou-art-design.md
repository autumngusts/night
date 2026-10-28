# 東正小遊戲 美術（子專案 2）設計

日期：2026-10-28　分支：`feat/toushou-art`（自 `feat/toushou-manfen` ab2cf42 分出）

## 1. 目標

為東正（toushou）加上美術並全面換膚，三種模式（經典／內線／滿分男）共用：

- 類別插圖 23 張（一般 17 ＋ 滿分男 6）
- 黑天鵝卡插圖 21 張（經典與滿分男同 id 共用）
- 風向卡插圖 3 張
- 整頁「復古拍賣目錄」換膚（含深色模式、375px 無橫捲）

先全部做 SVG，之後可換同名 PNG（見 §5）。**不改任何遊戲規則、reducer、state 結構。**

## 2. 美術方向（使用者決定）

| 項目 | 風格 |
| --- | --- |
| 卡面、頁面、框 | A：復古拍賣行／報紙版畫——米黃紙底、墨線、金框、襯線標題 |
| 人物與插圖主體 | B：綜藝節目／普普漫畫——3px 黑描邊、高飽和色、爆炸框、誇張表情 |

- 滿分男只出現在 6 張滿分男類別封面（扮成該類別），**不做**主持人表情差分，**不做** 240 個對象個別圖。
- 黑天鵝卡每種各自插圖（例：熔斷＝斷路器、恐慌拋售＝驚叫人群、主力進場＝鯨魚、封口令＝膠帶封嘴）。

### 2.1 SVG 繪製規則

- **SVG 內不放 `<text>`**；所有文字（卡名、效果、類別名）用 HTML，支援三語且能放大。
- 卡框（紙底、金框）由 CSS 做，不畫進 SVG，21 張黑天鵝卡外框一致。
- 描邊 `#111` 3px（在 viewBox 座標下）；色盤固定（§2.2），不另加顏色。
- 不放品牌 logo、商標字樣，也不畫成可辨識的真人。日本藝人類＝麥克風＋舞台燈；戰國人物類＝戴頭盔的剪影；企業類＝抽象大樓與股價線。
- 背景透明（紙底由卡片 CSS 提供），在淺色與深色模式下都要看得清楚：主體要有自己的填色，不能只靠黑線。
- 單檔 ≤ 12KB、不得有外部參照（`href` 到外部、`<image>`、`<script>`、`<foreignObject>`）。

### 2.2 色盤

| token | 色碼 | 用途 |
| --- | --- | --- |
| ink | `#111111` | 描邊 |
| paper | `#f8f1e0` | 亮部、白色區 |
| gold | `#b08d3c` | 點綴 |
| red | `#e2423f` | 利空、警示、強調 |
| green | `#18b96b` | 利多 |
| blue | `#2c6cff` | 冷色主體 |
| pink | `#ff4f7b` | 爆炸框、熱鬧 |
| yellow | `#ffd23f` | 光、閃亮 |
| skin | `#ffd8b0` | 膚色 |
| gray | `#9aa3ad` | 中性 |

## 3. 素材清單

圖檔位置 `static_src/images/toushou/<kind>/<id>.svg`。

### 3.1 category（viewBox `0 0 320 200`）

一般 17：`anime_game` `jp_celebrity` `jp_company` `tw_company` `jp_sports` `jp_pop` `washoku` `yoshoku` `taiwan_food` `hokkaido` `tohoku` `kansai` `kanto` `kyushu_okinawa` `sengoku_event` `sengoku_person` `taiwan_spot`

滿分男 6（滿分男本人扮裝；同一角色造型：黑色刺蝟頭、黑框眼鏡、得意露齒笑、胸前「100」徽章）：`mf_man` `mf_woman` `mf_job` `mf_home` `mf_roommate` `mf_travel`

### 3.2 swan（viewBox `0 0 200 160`）

21：`circuit` `hype` `whale` `exhausted` `fomo` `panic` `lull` `momentum` `exright` `shortcover` `gap` `limit` `rumor` `extra` `gag` `reverse` `cancel` `upset` `bailout` `calm` `trial`

### 3.3 wind（viewBox `0 0 200 160`）

3：`up`（綠色上漲箭頭）`down`（紅色下跌箭頭）`neutral`（灰色水平天秤）

每張的構圖說明寫在 `docs/toushou_art_guide.md`（§5）。

## 4. 顯示位置

| 素材 | 位置 |
| --- | --- |
| category | 標的卡最上方插圖區（三模式）；最終回顧每題小縮圖；設定畫面類別勾選清單（32px 圖示） |
| swan | 取代現有 `ts-swan-badge`（`toushou.js` 的 marketInfo、`toushou_ui_manfen.js` 的 `swanBadge`），改成完整卡面：金框＋插圖＋卡名＋效果文字；消息看板與回顧頁提到事件名處加小圖示 |
| wind | 經典：`ts-wind-badge`（輪到發言的股東）改為卡面；滿分男：`ts-mf-wind-status` 的持有者；兩者都在既有 `masked()`／擁有者判斷之內。結算公開後回顧頁顯示 |

### 4.1 保密（不可退化）

- 風向圖只出現在**原本就顯示風向文字**的節點內，跟文字一起被遮蔽。
- 不新增任何依風向而變的公開視覺線索（例：公開卡背顏色、未持有者的 class 差異）。
- `art_check.js` 檢查：非持有者畫面不得出現 `images/toushou/wind/` 的 `<img>`。

## 5. 載入機制（圖檔＋清單）

新模組 `static_src/toushou_art.js`，掛 `window.PriTestToushouArt`：

```js
PNG = { category: {}, swan: {}, wind: {} } // 有 PNG 的 id 設為 1
url(kind, id)        // → "../static/images/toushou/<kind>/<id>.png" 或 ".svg"
img(el, kind, id, cls) // 用呼叫端的 el() 建 <img class=cls alt="" draggable="false">
```

- 在 `site_src/toushou_page.py` 的 script 清單中排在 `toushou_ui_manfen.js` 與 `toushou.js` 之前。
- 換 PNG：放 `<id>.png`（尺寸 = viewBox × 2，例 640×400、400×320），在 `PNG` 加一行。不先試 PNG 再退 SVG（避免 404）。
- `docs/toushou_art_guide.md`：仿 `docs/yellow_art_guide.md`，列每張圖的尺寸、構圖說明、生圖提示詞範本（含風格與色盤描述）。

## 6. 全面換膚

只動 `static_src/css/toushou.css`，以及 toushou 相關 JS（`toushou.js`、`toushou_ui_manfen.js`）的 class 與 DOM 結構。

- CSS 變數定義在 `.ts-wrap`：`--ts-paper` `--ts-paper-2` `--ts-ink` `--ts-gold` `--ts-up` `--ts-down` `--ts-line`；`@media (prefers-color-scheme: dark)` 改為墨底（`#1c1814`）、米色字、金線。
- 面板＝紙底＋墨線外框＋內縮金線；標題襯線字（系統 serif 字族，不載外部字型）。
- 主要按鈕（`.ts-primary`）＝深墨實心「落槌」樣式；次要按鈕＝墨線框。
- 標的卡標題改為「LOT i / n · 類別名」樣式（沿用 `ts_target_heading` 的 i18n 字串內容，只改排版）。
- 消息看板每則做成剪報條（白底、墨線、靜態微旋轉 ±1deg，不做動畫）。
- **字級（使用者要求「略大、看得清楚為主」）**：卡內內文 ≥ 14px、卡名 ≥ 18px、價格／數字 ≥ 22px、行距 1.5；文字對比 ≥ 4.5:1（淺深色皆是）。
- 結算表（經典／內線的結算、滿分男的 9 欄表）在寬度 < 600px 時改為「每位玩家一張小卡」排列，375px 下整頁無橫捲。
- 既有 id（Playwright 檢查用的 `#ts-*`）全部保留。

## 7. 測試

新增 `tools/toushou_check/art_check.js`：

1. **素材完整**：從 `PriTestToushouData`（類別、滿分男類別、黑天鵝、風向）取出所有 id，每個都有 `.svg`；每張 SVG 可解析、viewBox 符合 §3、無 `<text>`／`<image>`／`<script>`／`<foreignObject>`、≤ 12KB。資料中沒有對應的多餘 SVG 也報錯。
2. **375px 走完三模式**（各至少 1 題含結算與最終回顧）：每階段 `document.documentElement.scrollWidth ≤ clientWidth`；卡內文字 computed font-size ≥ 14px、卡名 ≥ 18px；所有 `img` 的 `naturalWidth > 0`。
3. **風向保密**：非持有者畫面不得有 `images/toushou/wind/` 的 `<img>`。
4. 淺色、深色（`page.emulateMedia({ colorScheme: "dark" })`）各截圖存 scratchpad。

既有檢查全部重跑且通過：`core_check`、`manfen_core_check`、`ui_check`、`insider_ui_check`、`multi_device_check`、`manfen_ui_check`；`py -3 tools/split_css.py --check` 通過。

## 8. 執行方式

Subagent-Driven。SVG 每 5–8 張一個 Task；每批完成後產生縮圖總覽頁給使用者看過再進行下一批。滿分男與美術兩分支之後一起合併、一起確認版本號後推送 private。

## 9. 不做的事

- 主持人表情差分、240 個對象個別圖
- 動畫（除既有）、音效、外部字型
- 任何遊戲規則或數值變更
