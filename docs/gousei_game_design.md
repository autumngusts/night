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

2026-10-19 起：武俠 8,785 種、和風 8,705 種（各自另加約 2,000 種擴充物體，見 §6.7）。

### 1.1.1 兩主題的區隔（使用者指定，2026-10-19）

兩個主題的物體幾乎互不共用：自然現象、礦物、常見動植物、主食、日常器物、一般稱謂等**兩國共通的東西**可以同名；風格明顯屬於另一邊的不放（例：武俠不放薙刀、火繩銃；和風不放「黃粱一夢」「面壁九年」這類中式說法，改用「一炊之夢」「達磨面壁」）。
武俠可貼近金庸設定（人物、武功、門派、場景、神兵）；和風可使用神明、妖怪、名勝景點、祭典、各地名物。

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
* 合成結果是廢料時，結果畫面顯示「廢料・不能再合成」，不顯示階段（廢料在資料中的階段值為 0，但它不是初始物體，顯示出來會被誤認為還能再合）。
* **清除廢料**（使用者指定，2026-10-19）：池子有廢料時，標題旁出現「清除廢料（N）」，按下後把所有廢料移出池子（`Core.clearJunk`），**不算回合**、不需確認（廢料只能合出廢料，移除不會損失任何可能性）。上一步的快照也一併清掉，復原時廢料不會跑回來；遊戲紀錄保留。
* **已知廢料組合提示**（使用者指定，2026-10-19）：按「合成」時，若遊戲紀錄中同一組合（不分順序）合出過廢料，或任一材料本身是廢料，先在工作台顯示提示（「這個組合之前合過，結果是廢料「X」」），可選「仍要合成」（照常合成、算回合）或「換一組」（清空材料欄）。判斷只看 `state.log`（`Core.knownJunk`），**不看配方表**，所以沒試過的組合不會洩漏有沒有配方；不另存資料，清除廢料後紀錄仍在，仍會提示。語音模式（使用者指定，2026-10-19）：說出的組合合過廢料時，不直接合成，改念「A 加 B 之前合過，結果是廢料「X」，還要合成嗎？」並沿用語音的「對／不對」確認（`askConfirm(pick, known)`）；只靠讀音比對、本來就要確認的情況合併成這一句，不問兩次。語音比對本身排除廢料，所以語音不會遇到「材料是廢料」。

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

### 1.8 物體圖像與美術風格（使用者指定，2026-10-26：「增加美術，武俠合成內美術風格變換」）

* 物體有八千多種，不逐一作畫：`static_src/gousei_art.js` 依**分類圖案**（兵器＝劍、丹藥＝葫蘆、門派＝牌樓、妖怪＝狐面、神佛祭事＝鳥居…，初始物體各有自己的圖案）
  ＋物體 id 的 FNV-1a 雜湊（配色、角度、左右翻轉）＋**階段裝飾**（5 以上光環、8 以上雙環、11 以上星點）＋名稱首字（落款／印文），全部程式畫 SVG。
* 顯示在：池子按鈕（34px）、合成欄（40px）、合成結果（120px，彈出動畫）、任務卡（40px）。
* 池子上方的「🎨 美術風格」下拉選單切換，存在這台瀏覽器（`localStorage["pritest-gousei-art"]`），不進對局狀態、不同步：

| 風格 id | 武俠 | 和風 |
| --- | --- | --- |
| `gongbi`（預設） | 工筆彩繪：絹底、金線、淡彩 | 浮世繪：青海波、粗黑輪廓、藍朱平塗 |
| `ink` | 水墨：宣紙、墨韻圓相、方形朱印 | 墨繪：同上，圓形朱印 |
| `pixel` | 像素（SVG 濾鏡 `#gsa-px` 方塊化） | 同左 |
| `seal` | 印章：朱紅方印陰刻名稱首字 | 家紋：黑圓剪影 |
| `none` | 純文字（原本的樣子） | 同左 |

* 像素濾鏡的範圍必須是 `filterUnits="userSpaceOnUse"` 的整張 100×100；用預設（依圖形外框）時取樣格會落在範圍外，整片空白。
* 檢查：`node tools/gousei_check/art_check.js`（兩個主題 × 5 種風格，圖鑑截圖在 `tools/gousei_check/shots/`）。

---

## 2. 檔案結構與載入順序

| 檔案 | 責任 |
| --- | --- |
| `site_src/gousei_page.py` | 頁面組裝；`GOUSEI_SCRIPTS`、`GOUSEI_DATA_FILES` |
| `static_src/gousei_core.js` | 規則引擎 `window.PriTestGouseiCore`（純函式，不碰 DOM／storage） |
| `static_src/gousei_art.js` | 物體圖像與美術風格 `window.PriTestGouseiArt`（§1.8） |
| `static_src/gousei.js` | UI `window.PriTestGousei` |
| `static_src/gousei_data_<theme>.js` | 主題資料（建置產物，提交進 Git） |
| `static_src/gousei_pinyin.js` | 語音模式的拼音表（`build_pinyin.py` 產物，提交進 Git；開啟語音模式時才動態載入） |
| `tools/gousei_data/<theme>/*.json` | 原始資料 |
| `tools/gousei_data/build.py` | 驗證、計算階段、輸出資料檔 |

Script 載入順序：`firebase_config.js` → `game_storage.js` → `qrcode.js` → `gousei_core.js` → `gousei_art.js` → `gousei.js`（Firebase SDK 只在連線同步時才由 `game_storage.js` 動態載入）。

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

### 4.1 連線同步（使用者指定，2026-10-19）

分別裝置模式開局時可勾「連線同步」：每位玩家用自己的手機看到即時的池子、結果、紀錄與進度，輪到自己時直接在手機上合成。不勾則維持上面的離線玩法。

* 存放位置：Firebase `games/<房間 id>/rtState/gousei = { stateJson, hostId }`。房間 id 是 `PriTestGameStorage.generateCloudGameId()`（`g`＋32 位 hex），沿用 toushou 的做法；現有 `database.rules.json` 已允許 `rtState`，**不需要另外部署規則**。state 存成 JSON 字串，避免 Firebase 把空陣列與 `null` 吃掉。
* 參加網址：`?join=<theme>.<seed>.<count>.<index>&room=<房間 id>`。沒有 `room` 的舊網址仍是離線看任務頁。
* 權限：
  * 手機（`room.me`＝玩家編號）只有輪到自己時才有工作台、能選材料；其他時候顯示「等待 ○○ 合成中」。手機上方是「你是 ○○」與可收合的自己的任務。手機沒有語音、復原、新遊戲與 QR。
  * 主機（`hostId`＝建立房間的裝置，`localStorage["pritest-gousei-client"]`）可替任何人操作；復原與新遊戲只有主機能按。主機按新遊戲會刪除房間，手機顯示「這局已結束」。
* 所有變更（合成、清除廢料、復原）都經 `mutate()`：連線時在雲端最新 state 上以 `rtTransaction` 執行。合成與復原會比對按下時的紀錄筆數，雲端已有新紀錄（例如兩台同時按）就作廢並提示「畫面已更新」，所以同一回合只會成立一次。
* 任何一台合成後，所有裝置都顯示該次結果（`applyRemote()`），各自按「下一位」收起；被復原則全部收起。主機的語音模式也會朗讀別台合成的結果。
* 重新整理：主機以 `localStorage["pritest-gousei-room"]` 回到房間；手機靠網址回到房間。連線模式不寫本機存檔 `pritest-gousei-state`（開連線新局時會清掉本機舊局）。
* 測試：`tools/gousei_check/multi_device_check.js`（Firebase Local Emulator，見 §7）。

---

## 5. 語音模式

設定畫面勾「用語音遊玩」，或遊戲中按「🎤 開啟語音模式」。使用 Web Speech API（Chrome／Edge；需 https 或 localhost、允許麥克風），不另外連外部服務。

* **朗讀**：輪到某玩家時朗讀「輪到 ○○」與池子中的物體（廢料不念，分段朗讀），念完後每 60 秒（`VOICE_REPEAT_MS`）重複；正在等指令時延後。確認畫面、QR 畫面不朗讀。
* **喚醒詞**：喊「yo, アキ」→ 提示音 → 10 秒內（`VOICE_COMMAND_MS`）說「A 加 B」（日文「A プラス B」「A と B」「A たす B」）即直接合成。也可一口氣說「yo アキ 火加水」。即時（interim）辨識結果一出現喚醒詞就先響提示音。
* **備用**：「🎙 直接說」按鈕或空白鍵＝不用喚醒詞，直接響提示音等指令。
* **池子編號**：池子按鈕與朗讀都帶編號（＝池子順序，1 起算），可以說「3 加 7」「三加七」「第三個加第七號」「3番と7番」，也可與名稱混用（「3 加 水」）。廢料的編號不算。數字是辨識最穩定的內容，冷僻名稱建議用編號。
* **確認**：只有兩段都是字面完全一致或編號時才直接合成（`parseVoiceCombo` 的 `exact`）；只靠讀音或近似比對時先問「A 加 B，對嗎？」，說「對／好／是／はい」合成、「不對／取消／違う」重說（`Core.parseYesNo`，否定詞優先），也可按畫面上的按鈕；提問念完 10 秒沒回答就取消。
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
* `x_<category>.json`：擴充檔（`ext.py` 產物，見 §6.7），多一個 `"open": true`。

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
5. 分類檔的配方：結果屬於本分類；至少一個材料屬於本分類；材料只能來自本檔、`core.json` 或初始物體。擴充檔（`"open": true`）只要求結果屬於本分類，材料可以是主題內任何物體。
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

### 6.7 擴充資料（`ext.py`）

約 2,000 種的擴充物體不直接寫 JSON，而是寫在 `tools/gousei_data/<theme>_ext/<category>.txt`，由 `ext.py` 轉成 `tools/gousei_data/<theme>/x_<category>.json`（兩者都提交進 Git；要修改擴充物體時改 `.txt` 再重新轉換，不要手改 `x_*.json`）。

```text
# 一行一個物體；# 之後為註解
郭靖 = 傻小子 + 射鵰 ; 降龍十八掌 + 傻小子
黃蓉 / 黄蓉 = 黃藥師 + 少女
```

* `zh` 或 `zh / ja`；省略 ja 時以 `KANJI_MAP`（只收字形差異，如 氣→気、劍→剣；「龍」不轉）換成日本新字體。
* 等號右邊是一或多組配方，以 `;` 分隔；材料寫 **zh 名稱**，可引用主題內任何物體（含其他擴充檔、可前向引用）。
* id 由 zh 名稱的拼音產生（`x_` 開頭），同名稱永遠同 id：調換行、搬到別的分類檔都不會影響既有存檔。改名則會換 id。
* 名稱不可含空白或數字，也不可整個是漢字數字（語音模式以數字指定池子編號）。
* 分類由檔名決定。輔助用的通用物體（例如武俠的「少年」、和風的「學校」）也要放在正確的分類檔，因為任務卡會顯示分類當提示。
* 新物體若與既有物體是同一個東西（常見徵兆：`build.py` 回報 ja 名稱重複），刪掉新的，引用改指向既有物體。

```bash
py -3 tools/gousei_data/ext.py              # 轉換全部主題的擴充檔
py -3 tools/gousei_data/ext.py wafu         # 只轉換一個主題
py -3 tools/gousei_data/build.py --check    # 轉換後一定要驗證（組合重複、無法合成、ja 重複）
```

武俠另有 `food`（江湖飲食）分類，只在擴充檔中使用。

#### 6.7.1 低階命中率與 `alt.txt`（2026-10-19）

前期的手感取決於「池子裡隨便兩個物體有沒有配方」。原本階段 ≤2 的物體（約 85 種）之間只有約 15% 的組合有配方，第 2〜3 回合後就大多合出廢料。
因此另寫 `<theme>_ext/alt.txt`，替**既有物體**追加配方（不新增物體），由 `ext.py` 輸出成 `x_alt.json`（`category` 為 `core`，結果可屬任何分類）：

```text
雨 = 霧 + 水 ; 雲 + 蒸氣
```

* 等號左邊是既有物體的 zh 名稱，同一物體可以分好幾行寫。
* **結果階段 ≤ 兩材料的最高階段 + 1**：這樣追加配方不會讓任何物體降階，任務（中階 3〜4、高階 5〜7）的分布與難度不變。
* 不得與既有組合重複（`build.py` 會擋）；配方仍要「看名字就能聯想」。

| 主題 | 階段 ≤2 之間的命中率 | 隨機亂合第 10／20／40 回合的命中率 |
| --- | --- | --- |
| 武俠 | 15.0% → 32.6% | 45/36/28% → 58/46/35% |
| 和風 | 15.2% → 31.8% | 47/37/25% → 53/43/33% |

追加配方：武俠 642 條、和風 714 條；改動前後所有物體的階段完全相同。

---

## 7. 驗證

```bash
node tools/gousei_check/core_check.js
py -3 -m unittest tools/gousei_data/test_build.py
py -3 tools/gousei_data/ext.py
py -3 tools/gousei_data/build.py --check
py -3 generate.py
py -3 -m http.server 8943 --directory dist   # 另一個終端
node tools/gousei_check/ui_check.js
# 連線同步（另開終端啟動 emulator）：
#   tools/midnight_check/node_modules/.bin/firebase emulators:start --only database,auth --project elden-ring-nightreign
node tools/gousei_check/multi_device_check.js
```

`ui_check.js` 借用 `tools/midnight_check` 的 Playwright，涵蓋同一裝置的開局任務確認／池子高度／展開任務／合成／復原／重新整理／已知廢料組合提示與清除廢料／親手達成／日文切換、分別裝置的 QR、手機任務一致性與無效連結，以及語音模式（以假的 `SpeechRecognition`／`speechSynthesis` 替身，經 `PriTestGousei._voiceHeard()` 注入辨識結果）。實際麥克風辨識只能人工測試。

---

## 8. 範圍外

* 使用 Yahoo! JAPAN 文字解析 API 的進階版（需要中繼伺服器與 AppID 保管）。
* 裝置間同步（Firebase）。
