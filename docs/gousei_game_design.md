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
| 同一裝置 `shared` | 共用裝置 | 開局先進「任務確認」畫面：全員任務都隱藏，每人輪流查看再隱藏，全員確認且全部隱藏後才能按「正式開始」。遊戲中池子下方可展開各玩家的任務（一次一位） |
| 分別裝置 `split` | 共用裝置 | 共用裝置顯示各玩家的參加 QR；手機開啟後只顯示自己的任務。不同步 |

人數 2〜8。

### 1.7 版面（使用者指定，2026-10-18）

* 池子是主角：約佔半個畫面（`.gs-pool-list` 最小高度 50vh），物體按鈕字放大；已選入合成欄的物體加框。
* 不再有每回合的交接畫面；任務改放在池子下方的「各玩家任務」區，合成、換人、復原後自動收起。

---

## 2. 檔案結構與載入順序

| 檔案 | 責任 |
| --- | --- |
| `site_src/gousei_page.py` | 頁面組裝；`GOUSEI_SCRIPTS`、`GOUSEI_DATA_FILES` |
| `static_src/gousei_core.js` | 規則引擎 `window.PriTestGouseiCore`（純函式，不碰 DOM／storage） |
| `static_src/gousei.js` | UI `window.PriTestGousei` |
| `static_src/gousei_data_<theme>.js` | 主題資料（建置產物，提交進 Git） |
| `static_src/gousei_pinyin.js` | 語音模式的拼音表（`build_pinyin.py` 產物，提交進 Git；開啟語音模式時才動態載入） |
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
* `state.confirm = { viewed: [玩家 id] }`：只在同一裝置模式的開局確認期間存在，按「正式開始」後刪除（舊存檔沒有此欄位＝已開始）。
* `ui.revealedFor`（目前展開的玩家）**刻意不存檔**：重新整理後一律隱藏，避免下一位或旁人看到任務。
* 復原、合成、換人時所有任務收起，不讓下一位看到前一位的任務。

---

## 4. 分別裝置模式

* 參加網址：`?join=<theme>.<seed>.<count>.<index>`（`Core.joinParam`／`Core.parseJoin`）。
* 手機以 `Core.dealTargets(theme, seed, count)[index]` 自行算出自己的任務，不同步、不存檔。
* 共用裝置仍可由 seed 算出全員任務，用於自動判定達成，但不顯示內容。
* 格式不合法或人數／編號超出範圍時顯示錯誤（`#gs-join.gs-error`）。

---

## 5. 語音模式

設定畫面勾「用語音遊玩」，或遊戲中按「🎤 開啟語音模式」。使用 Web Speech API（Chrome／Edge；需 https 或 localhost、允許麥克風），不另外連外部服務。

* **朗讀**：輪到某玩家時朗讀「輪到 ○○」與池子中的物體（廢料不念，分段朗讀），念完後每 60 秒（`VOICE_REPEAT_MS`）重複；正在等指令時延後。確認畫面、QR 畫面不朗讀。
* **喚醒詞**：喊「yo, アキ」→ 提示音 → 10 秒內（`VOICE_COMMAND_MS`）說「A 加 B」（日文「A プラス B」「A と B」「A たす B」）即直接合成。也可一口氣說「yo アキ 火加水」。即時（interim）辨識結果一出現喚醒詞就先響提示音。
* **備用**：「🎙 直接說」按鈕或空白鍵＝不用喚醒詞，直接響提示音等指令。
* **合成後**：念出結果，念完自動換下一位（不必按「下一位」）；聽不懂時念「請再說一次」並重新等指令。
* **解析**（`Core.detectWake`／`Core.parseVoiceCombo`，純函式）：
  * 片假名轉平假名、去空白標點後比對；去掉「我要／把」「〜吧／を合成して」等口語。
  * 以分隔詞切成兩段，各自找池子中最像的物體（zh／ja 名稱皆可，廢料不列入），相似度＝1−編輯距離／長度，兩段都要 ≥ 0.6。沒說分隔詞時只接受兩段都完全一致。
  * **拼音比對**：辨識只回傳文字，同音字常跑掉（雷加水 → 累家稅）。開啟語音模式時動態載入 `gousei_pinyin.js`（`tools/gousei_data/build_pinyin.py` 以 pypinyin 產生的「無聲調拼音 → 漢字」表，CJK 基本區約 2 萬字、65 KB），`Core.setPinyin()` 後字面與拼音兩種相似度取高者（拼音只扣 0.05，字面一致優先）。拼音做台灣口音寬鬆化：zh/ch/sh≈z/c/s、ing/eng≈in/en、n≈l。分隔詞也比對拼音（jia／jia shang／he／gen／yu，例如「家」「佳」）。
  * 喚醒詞：辨識器會把聽不懂的外語音節換成任意同類音（yo アキ → 幼兒體：a→兒、ki→體），所以以「聲母類別 × 韻母類別」判斷：
    yo（零聲母／y ＋ o 類韻母：有、要、幼、喲）＋ a（零聲母母音：阿、啊、兒、愛）＋ ki（j q x d t g k ＋ i／ei：基、奇、體、地）。
    z c s（子、十）刻意不算，避免「有兒子」「有二十」誤觸。另有字面（「秋」等一般詞彙必須前接 yo）、假名（よあき、ようあき）、英文（yo aki／you a key）判斷。
* **喚醒詞訓練**：「🎯 訓練喚醒詞」→ 提示音後說 3 次，記住實際的辨識結果（每次取前 2 個候選），存在 `localStorage["pritest-gousei-wake"]`（依辨識語言分開，最多 30 筆）。
  之後以音節距離比對（同音 0、同類音 0.5、不像 1）：3 音節以下容許 ≤ 0.5、4 音節以上容許 ≤ 1，朗讀中只接受完全一致。範本可以是任何詞（例如「開始合成」）。
* **回音對策**：朗讀中麥克風可能收到喇叭聲音，朗讀中只接受有 yo 開頭的喚醒詞；等指令時忽略朗讀中的辨識結果。
* 辨識／朗讀語言跟著介面：zh → `zh-TW`，ja → `ja-JP`；en 因物體名稱沒有英文，也用 `ja-JP`。

---

## 6. 資料製作

### 6.1 原始資料格式

`tools/gousei_data/<theme>/` 底下：

* `theme.json`：`id`、`name`、`basics`（初始物體）、`junk`（廢料，約 20 種）、`categories`、`min_items`。
* `core.json`：`{"category": "core", "items": [{"id", "zh", "ja", "cat"}], "recipes": [...]}`，各分類的入口物體（階段 1〜3）。
* `<category>.json`：`{"category": "<cat>", "items": [{"id", "zh", "ja"}], "recipes": [["a", "b", "結果"]]}`。

輸出格式：`items` 為 `[id, zh, ja, category, tier]`；`recipes` 為 `{"a|b": 結果}`（key 依 id 排序）。

### 6.2 階段

```text
tier(初始物體) = 0
tier(c) = min over 配方 (a,b→c) of ( max(tier(a), tier(b)) + 1 )
```

由 `build.py` 以固定點迭代計算，不手寫。

### 6.3 驗證規則（`build.py`）

1. id 為小寫英數與底線，主題內唯一；必須有 zh 與 ja 名稱。
2. zh、ja 名稱在主題內各自不可重複（含初始物體與廢料）。
3. 配方引用的物體必須存在；結果不可是初始物體或廢料；材料不可是廢料。
4. 同一組材料（不分順序）只能對應一個結果。
5. 分類檔的配方：結果屬於本分類；至少一個材料屬於本分類；材料只能來自本檔、`core.json` 或初始物體。
6. 每個物體都必須能從初始物體合成出來。
7. 非 `--skeleton` 時：物體數 ≥ `min_items`、階段 3〜4 ≥ 200、階段 5〜7 ≥ 400。

### 6.4 `build.py` 用法

```bash
py -3 tools/gousei_data/build.py              # 建置全部主題
py -3 tools/gousei_data/build.py wafu         # 只建置一個主題
py -3 tools/gousei_data/build.py --check      # 只驗證、不輸出
py -3 tools/gousei_data/build.py --skeleton   # 不檢查總數與階段分布
```

Windows 主控台若出現 `cp932` 編碼錯誤，先設定 `PYTHONIOENCODING=utf-8`。

### 6.5 分類檔撰寫原則

* 配方以「看名字就能聯想」為最高原則（例：金+火→熔金、刀+雷→雷切、狐+火→狐火）；不要沒有語意的湊數組合。
* 至少一個材料屬於本分類；只引用本檔、core 與初始物體，讓分類檔彼此獨立、可平行製作。
* 機械式派生名稱（上品／下品等）最多一成。
* 用多層合成鏈做出深度，確保中階與高階都有足夠候選。

### 6.6 新增物體的流程

1. 在對應分類檔加物體與至少一條配方。
2. `py -3 tools/gousei_data/build.py <theme> --check` 直到 0 個錯誤。
3. `py -3 tools/gousei_data/build.py <theme>` 輸出資料檔。
4. `py -3 generate.py`。

---

## 7. 驗證

```bash
node tools/gousei_check/core_check.js
py -3 -m unittest tools/gousei_data/test_build.py
py -3 tools/gousei_data/build.py --check
py -3 generate.py
py -3 -m http.server 8943 --directory dist   # 另一個終端
node tools/gousei_check/ui_check.js
```

`ui_check.js` 借用 `tools/midnight_check` 的 Playwright，涵蓋同一裝置的開局任務確認／池子高度／展開任務／合成／復原／重新整理／親手達成／日文切換、分別裝置的 QR、手機任務一致性與無效連結，以及語音模式（以假的 `SpeechRecognition`／`speechSynthesis` 替身，經 `PriTestGousei._voiceHeard()` 注入辨識結果）。實際麥克風辨識只能人工測試。

---

## 8. 範圍外

* 使用 Yahoo! JAPAN 文字解析 API 的進階版（需要中繼伺服器與 AppID 保管）。
* 裝置間同步（Firebase）。
