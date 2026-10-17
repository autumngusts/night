# 武俠合成／和風合成（gousei）遊戲設計

本文件整理自設計書 `docs/superpowers/specs/2026-10-16-gousei-design.md` 與實作，不另創規則。

---

## 1. 遊戲規則（使用者指定）

### 1.1 主題與初始物體

| 主題 | id | 初始物體（階段 0） |
| --- | --- | --- |
| 中國武俠風 | `wuxia` | 金、木、水、火、土 |
| 日本和風 | `wafu` | 火、水、雷、風、土 |

每個主題 5,000 種以上物體（不含初始物體與廢料）。物體名稱有 `zh`／`ja`，`en` fallback 至 `ja`。

### 1.2 發任務

以 `seed` 的確定性亂數（`Core.dealTargets`）為每位玩家發 3 張任務：

* 中階 ×1：階段 3〜4（`MID_TIERS`）
* 高階 ×2：階段 5〜7（`HIGH_TIERS`）
* 全體玩家任務不重複；不含初始物體與廢料。

### 1.3 提示

任務卡只顯示**物體名稱、分類、階段**，不顯示配方。因此配方必須「看名字就能聯想」。

### 1.4 組合必有結果（廢料規則）

* 配方表有的組合 → 該結果。
* 配方表沒有的組合 → 依組合 key 的 FNV-1a 雜湊選一個廢料（同組合永遠同結果）。
* 任一材料是廢料 → 必為廢料（廢料不能當捷徑）。
* 廢料也會進入共用池子。

### 1.5 回合、達成與勝利

* 共用池子；初始物體永遠在池子裡。
* 依座位順序，每一輪每人合成**一次**。
* **只有在自己的回合親手合出自己的任務物才算達成**；已在池子中、或別人合出的不算。
* 全員可見「○○ 達成 n/3」，但不公開是哪一張。
* 最先 3/3 的玩家立即獲勝。
* 可復原上一次合成（只保留一層）。

### 1.6 兩種模式

| 模式 | 合成 | 查看任務 |
| --- | --- | --- |
| 同一裝置 `shared` | 共用裝置 | 每回合開頭顯示「請交給 ○○」交接畫面，點擊後顯示／可隱藏自己的任務 |
| 分別裝置 `split` | 共用裝置 | 共用裝置顯示各玩家的參加 QR；手機開啟後只顯示自己的任務。不同步 |

人數 2〜8。

---

## 2. 檔案結構與載入順序

| 檔案 | 責任 |
| --- | --- |
| `site_src/gousei_page.py` | 頁面組裝；`GOUSEI_SCRIPTS`、`GOUSEI_DATA_FILES` |
| `static_src/gousei_core.js` | 規則引擎 `window.PriTestGouseiCore`（純函式，不碰 DOM／storage） |
| `static_src/gousei.js` | UI `window.PriTestGousei` |
| `static_src/gousei_data_<theme>.js` | 主題資料（建置產物，提交進 Git） |
| `tools/gousei_data/<theme>/*.json` | 原始資料 |
| `tools/gousei_data/build.py` | 驗證、計算階段、輸出資料檔 |

Script 載入順序：`qrcode.js` → `gousei_core.js` → `gousei.js`。

主題資料很大，不放進 script 清單：選定主題後由 `gousei.js` 動態插入 `<script>` 載入，網址從 `#gs-app` 的 `data-src-<theme>` 屬性取得（含 `asset_url` 快取雜湊），資料掛在 `window.PriTestGouseiData[themeId]`。

---

## 3. 狀態與存檔

存檔 key：`localStorage["pritest-gousei-state"]`。

```text
state = {
  version, themeId, seed, mode,
  players: [{ id: "p1", name, targets: [中階, 高階, 高階], done: [] }],
  pool: [物體 id],
  round, turn, log: [entry], winner, prev
}
entry = { round, playerId, a, b, result, isNew, achieved }
```

* `prev` 是上一步的 state（自身 `prev` 為 `null`），所以只能復原一層。
* `ui.revealed`／`ui.handoff` **刻意不存檔**：重新整理後一律回到交接畫面，避免下一位或旁人看到任務。
* 同一裝置模式復原時回到「被復原的玩家」的交接畫面，不讓下一位看到前一位的任務。

---

## 4. 分別裝置模式

* 參加網址：`?join=<theme>.<seed>.<count>.<index>`（`Core.joinParam`／`Core.parseJoin`）。
* 手機以 `Core.dealTargets(theme, seed, count)[index]` 自行算出自己的任務，不同步、不存檔。
* 共用裝置仍可由 seed 算出全員任務，用於自動判定達成，但不顯示內容。
* 格式不合法或人數／編號超出範圍時顯示錯誤（`#gs-join.gs-error`）。

---

## 5. 資料製作

### 5.1 原始資料格式

`tools/gousei_data/<theme>/` 底下：

* `theme.json`：`id`、`name`、`basics`（初始物體）、`junk`（廢料，約 20 種）、`categories`、`min_items`。
* `core.json`：`{"category": "core", "items": [{"id", "zh", "ja", "cat"}], "recipes": [...]}`，各分類的入口物體（階段 1〜3）。
* `<category>.json`：`{"category": "<cat>", "items": [{"id", "zh", "ja"}], "recipes": [["a", "b", "結果"]]}`。

輸出格式：`items` 為 `[id, zh, ja, category, tier]`；`recipes` 為 `{"a|b": 結果}`（key 依 id 排序）。

### 5.2 階段

```text
tier(初始物體) = 0
tier(c) = min over 配方 (a,b→c) of ( max(tier(a), tier(b)) + 1 )
```

由 `build.py` 以固定點迭代計算，不手寫。

### 5.3 驗證規則（`build.py`）

1. id 為小寫英數與底線，主題內唯一；必須有 zh 與 ja 名稱。
2. zh、ja 名稱在主題內各自不可重複（含初始物體與廢料）。
3. 配方引用的物體必須存在；結果不可是初始物體或廢料；材料不可是廢料。
4. 同一組材料（不分順序）只能對應一個結果。
5. 分類檔的配方：結果屬於本分類；至少一個材料屬於本分類；材料只能來自本檔、`core.json` 或初始物體。
6. 每個物體都必須能從初始物體合成出來。
7. 非 `--skeleton` 時：物體數 ≥ `min_items`、階段 3〜4 ≥ 200、階段 5〜7 ≥ 400。

### 5.4 `build.py` 用法

```bash
py -3 tools/gousei_data/build.py              # 建置全部主題
py -3 tools/gousei_data/build.py wafu         # 只建置一個主題
py -3 tools/gousei_data/build.py --check      # 只驗證、不輸出
py -3 tools/gousei_data/build.py --skeleton   # 不檢查總數與階段分布
```

Windows 主控台若出現 `cp932` 編碼錯誤，先設定 `PYTHONIOENCODING=utf-8`。

### 5.5 分類檔撰寫原則

* 配方以「看名字就能聯想」為最高原則（例：金+火→熔金、刀+雷→雷切、狐+火→狐火）；不要沒有語意的湊數組合。
* 至少一個材料屬於本分類；只引用本檔、core 與初始物體，讓分類檔彼此獨立、可平行製作。
* 機械式派生名稱（上品／下品等）最多一成。
* 用多層合成鏈做出深度，確保中階與高階都有足夠候選。

### 5.6 新增物體的流程

1. 在對應分類檔加物體與至少一條配方。
2. `py -3 tools/gousei_data/build.py <theme> --check` 直到 0 個錯誤。
3. `py -3 tools/gousei_data/build.py <theme>` 輸出資料檔。
4. `py -3 generate.py`。

---

## 6. 驗證

```bash
node tools/gousei_check/core_check.js
py -3 -m unittest tools/gousei_data/test_build.py
py -3 tools/gousei_data/build.py --check
py -3 generate.py
py -3 -m http.server 8943 --directory dist   # 另一個終端
node tools/gousei_check/ui_check.js
```

`ui_check.js` 借用 `tools/midnight_check` 的 Playwright，涵蓋同一裝置的交接／任務顯示／合成／復原／重新整理／親手達成／日文切換，以及分別裝置的 QR、手機任務一致性與無效連結。

---

## 7. 範圍外

* 使用 Yahoo! JAPAN 文字解析 API 的進階版（需要中繼伺服器與 AppID 保管）。
* 裝置間同步（Firebase）。
