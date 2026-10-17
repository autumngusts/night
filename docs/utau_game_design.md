# 我不會唱歌／歌わなきゃ（utau）：實作方法與題庫製作方式

本文件記錄小遊戲「我不會唱歌」的規則、程式架構、三種模式的實作方式，以及進階模式題庫包的製作流程。
修改這個遊戲前請先讀本文件；題庫包的操作步驟另見 `tools/utau_clips/README.md`。

---

## 1. 遊戲規則（使用者指定）

### 1.1 回合與出題者

- 每一輪隨機抽一位**出題者**，**一圈抽完之前不會重複**；新的一圈第一位不會與上一位相同。
- 出題者以外的人猜歌名；畫面上切換「AI 有沒有答對」（ON／OFF），並點選答對的玩家。

### 1.2 計分

設定畫面依人數列出計分表 `scoreTable[k]`，`k` = 本輪答對人數（不含出題者、不含 AI）：

| 情況 | 得分 |
| --- | --- |
| `k > 0` | **出題者與每位答對者各得** `scoreTable[k]` |
| `k = 0`（全部答錯） | 只有出題者得 `scoreTable[0]` |
| AI 答對 | 出題者另得 `aiBonus`（預設 1） |

預設計分表：少數人答對 3 分、多數人答對 2 分、全部答對 1 分、全部答錯 0 分（`Core.defaultScoreTable()`）。
可以復原上一輪結算（只保留一層）。

### 1.3 三種模式

| 模式 | 內容 |
| --- | --- |
| 基本模式 `basic` | 出題者自己選歌、自己唱 |
| 進階模式 `advanced` | 播放預先做好的題庫包音檔（純樂器、純人聲、只有旋律樂器、極端變快、8bit 旋律、中文歌聲、日文歌聲、人聲倒放、鼓＋貝斯、整段倒放） |
| 夢想模式 `dream` | 出題者貼 YouTube 連結，App 從影片中段隨機播一小段 |

> 舊版的「進階模式」（抽歌＋指定演唱方式，玩家自己唱）已依使用者指示由新版取代。
> 舊存檔（`state.version === 1`）會被直接捨棄。

---

## 2. 檔案結構

| 檔案 | 內容 |
| --- | --- |
| `site_src/utau_page.py` | 頁面組裝與 script 清單 `UTAU_SCRIPTS`（`generate.py` 也用這份清單複製檔案） |
| `static_src/utau_songs.js` | 歌單目錄（366 首：日本 244〔動漫 96〕、華語 85、韓國 16、歐美 21）、地區、分類、音檔版本定義 |
| `static_src/utau_pack.js` | 題庫包：讀取 zip、存進 IndexedDB、取出音檔 |
| `static_src/utau_core.js` | 規則引擎（純函式，不碰 DOM／storage，可用 node 測試） |
| `static_src/utau.js` | UI、存讀檔、音檔播放、YouTube 播放器 |
| `tools/utau_clips/find_urls.py` | 從歌單挑歌並自動搜尋 YouTube 網址（本機執行） |
| `tools/utau_clips/build_pack.py` | 題庫包製作工具（本機執行） |
| `tools/utau_clips/songs.json` | 製作工具的輸入清單 |
| `tools/utau_check/core_check.js` | 規則引擎的 node 檢查 |
| `tools/utau_check/ui_check.js` | Playwright 整體流程檢查 |

載入順序：`utau_songs.js` → `utau_pack.js` → `utau_core.js` → `utau.js`。

---

## 3. 狀態與存檔

- 遊戲狀態存在 `localStorage["pritest-utau-state"]`，格式版本 `version: 2`。
- 上一次的設定存在 `localStorage["pritest-utau-config"]`（不含題庫包歌曲）。
- `ui.revealed`（題目遮蔽）刻意**不存檔**：重新整理後回到遮蔽畫面，避免題目外洩。

主要欄位：

```js
{
  version: 2,
  config: {
    mode, players: [{ id, name }], aiBonus, scoreTable,
    // 進階模式
    regions, decades, categories, variants, packSongs: [{ id, t, a, y, r, c, clips, variants }],
    // 夢想模式
    clipSeconds, randomSpeed
  },
  scores: { playerId: n },
  queue: [...],            // 本圈還沒出題的人
  usedSongs: [...],        // 進階模式：整池用完前不重複
  round, current: { singerId, songId, variant, dream: { videoId, start, rate, title } },
  history: [{ round, singerId, songId, variant, song, dream, aiCorrect, correctIds, deltas }],
  prev,                    // 上一次結算前的快照（復原用）
  finished
}
```

開始遊戲時會把題庫包歌曲的摘要複製進 `config.packSongs`，讓規則引擎維持純函式、不需要讀 IndexedDB。

---

## 4. 進階模式：播放題庫包

### 4.1 抽題

- 歌曲池 = 題庫包歌曲 × 地區 × 年代 × 分類 × **至少有一個勾選的版本**（`Core.songPool()`）。
- 抽到歌之後，從「這首歌有的、且有勾選的版本」中隨機選一個；`original` 只用於公布答案，不會被抽成題目。
- 整池用完之前不重複。

### 4.2 畫面

- 版本名稱是公開資訊（例如「純樂器」），大家按「▶ 播放」來猜。
- 出題者可按「偷看答案」確認歌名（判定答對用），也可以換一首。
- 結算後，「上一輪」區塊顯示答案，並可「▶ 播放原曲」。

### 4.3 播放實作

- 音檔從 IndexedDB 取出 Blob，轉成 `URL.createObjectURL()` 放進 `<audio>`。
- **iOS 只允許在點擊當下呼叫 `play()`**，而 IndexedDB 讀取是非同步的，所以每一輪一開始就先把音檔放進 `<audio>`（`prepareAudio()`），播放鍵只做同步的 `play()`。音檔就緒前播放鍵是停用狀態。
- 題目用 `audio.main`，答案原曲用 `audio.answer`，兩者互斥播放。

---

## 5. 題庫包格式與儲存

### 5.1 為什麼是「本機題庫包」

使用者指定：音檔**不進 Git、不上網**。原因：

- 網站部署在公開的 GitHub Pages，把剪好的音檔放上去等同公開散布有版權的音樂。
- 下載 YouTube 音訊違反 YouTube 服務條款，只適合私人聚會使用。

因此題庫包是一個 zip 檔，由主持人在遊戲裝置上匯入一次，存進該裝置瀏覽器的 IndexedDB 後即可離線遊玩。

### 5.2 zip 格式

```
manifest.json
clips/<來源雜湊>/original.m4a
clips/<來源雜湊>/instrumental.m4a
clips/<來源雜湊>/vocal.m4a
clips/<來源雜湊>/other.m4a
clips/<來源雜湊>/speed.m4a
clips/<來源雜湊>/chip.m4a
clips/<來源雜湊>/vocal_rev.m4a
clips/<來源雜湊>/rhythm.m4a
clips/<來源雜湊>/reverse.m4a
```

`manifest.json`：

```json
{
  "format": "pritest-utau-pack",
  "version": 1,
  "clipSeconds": 15,
  "songs": [
    { "id": "ja:紅蓮華", "t": "紅蓮華", "a": "LiSA", "y": 2019, "r": "ja", "c": "anime",
      "start": 52.5, "clips": { "original": "clips/ab12cd34ef56/original.m4a", "...": "..." } }
  ]
}
```

- zip 一律用 **STORED（不壓縮）**：音檔本來就壓縮過，壓縮也省不了多少；而且瀏覽器端可以自己解析，不需要外部 unzip 套件。
- 音檔是 AAC（`.m4a`，128kbps）：所有主流瀏覽器（含 iOS Safari）都能播。每段 15 秒約 200〜300KB，一首（6 個版本）約 1〜1.5MB。
- 資料夾名稱用來源網址的 SHA-1 前 12 碼，所以檔名都是 ASCII。

### 5.3 瀏覽器端讀取（`utau_pack.js`）

1. 讀檔尾找 End of Central Directory（`0x06054b50`），取得中央目錄的位置與筆數。
2. 逐筆解析中央目錄（`0x02014b50`），壓縮方法不是 0（STORED）就報錯 `ut_err_pack_compressed`。
3. 再讀每個檔案的本地檔頭（`0x04034b50`）算出資料本體的位置（本地檔頭的檔名／extra 長度可能與中央目錄不同）。
4. 用 `File.slice()` 切出每個音檔，連同歌曲資料寫進 IndexedDB：
   - DB `pritest-utau-pack`，store `songs`（keyPath `id`）與 `clips`（key = zip 內路徑，value = Blob）。
5. 多次匯入以歌曲 id 合併（同 id 以新的覆蓋），可以分批製作、分批匯入。

不支援 ZIP64（超過 4GB 或 65535 個檔案），目前用量遠低於此。

---

## 6. 題庫製作方式（`tools/utau_clips/build_pack.py`）

### 6.1 環境

- 專案內獨立的虛擬環境 `tools/utau_clips/.venv`（不進 Git）。
- 套件：`torch`／`torchaudio` 2.5.1（CPU 版）、`demucs`、`yt-dlp`、`imageio-ffmpeg`、`soundfile`、`librosa`、`numpy`。
- torch 固定 2.5.1：新版 torchaudio 移除了 Demucs 依賴的 I/O backend。程式本身用 `soundfile` 讀寫音檔，只用 Demucs 的模型與 `apply_model`。
- ffmpeg 用 `imageio-ffmpeg` 附帶的執行檔，不需要另外安裝。
- 不需要顯示卡。

### 6.2 處理流程

```
find_urls.py：歌單（依地區／分類／年代）→ songs.json 加入 id → yt-dlp 搜尋 → 寫回 url 與 _yt 審核資訊

songs.json 一筆
  → 解析歌曲資料（用 node 讀 utau_songs.js 的歌單，id 對得到就自動帶入歌名等欄位）
  → 下載（yt-dlp，原始檔留在 cache/dl/）或讀本機檔 → ffmpeg 解碼成 44.1kHz 立體聲（只在記憶體）
  → 決定起點 start（手動指定或自動偵測副歌）
  → 剪出 [start − 1 秒, start + clip + 1 秒]（前後多 1 秒給 Demucs 上下文，成品會剪掉）
  → Demucs htdemucs 分離成 drums / bass / other / vocals
  → 混出各版本 → 淡入淡出＋音量統一 → AAC 編碼
  → 自動偵測的起點寫回 songs.json（`_autoStart: true`）
  → 排除 `skip` 指定的版本 → 打包成 STORED zip
  → 輸出 out/preview.html 試聽頁（直接讀 cache/ 的音檔）
```

### 6.2.1 自動搜尋網址（`find_urls.py`）

手動替幾百首歌找網址是製作題庫最花時間的步驟，所以由工具代勞，人只負責審核有警告的結果。

- 只搜尋不下載（yt-dlp `ytsearchN:`，`extract_flat`）。每首搜尋兩次：`歌手 歌名`（多半是 MV），以及加上
  `"Provided to YouTube by"`（YouTube Music 的 Topic 純音訊說明欄固定有這句，較容易搜到）。合併後評分：
  - 頻道名稱含歌手原文名（官方頻道或 Topic）＝確定原唱，大幅加分；Topic 是純音訊，略優於 MV。
  - Topic 頻道名稱常是羅馬拼音（`Ken Hirai - Topic`），對不上原文歌手名。官方頻道上傳的音源說明欄是
    `歌名 · Ken Hirai`，所以**出現在官方頻道說明欄「· 名稱」裡的 Topic 頻道**也視為原唱。
    只比對「· 名稱」是為了避免 `Provided to YouTube by Walt Disney Records` 這類唱片公司名稱誤中。
  - 其他 Topic 頻道可能是羅馬拼音的原唱、也可能是別人的翻唱，只加少量分數並附警告。
  - 影片標題＝歌名加分、含歌名次之、不含扣分；live、翻唱、伴奏、remix、耐久、THE FIRST TAKE、TV size 等關鍵字（歌名本身沒有時）扣分；
    長度不在 80〜480 秒扣分。
- 結果寫回 `url` 與 `_yt`（標題、頻道、長度、`warn`）。有警告的歌最後列出，需要人工試聽確認。
- 2026-10-16 用 12 首（日本各分類、華語、歐美）實測：官方來源都選對；選到翻唱的 Topic 音源都有附警告。

### 6.2.2 清單欄位與寫回

- `songs.json` 一首一行（`save_entries()`），兩支工具共用讀寫函式。
- YouTube 網址一律先正規化成 `watch?v=<id>`（`normalize_source()`）再算快取雜湊，
  避免 `youtu.be`／`watch?v=` 等不同寫法被當成不同來源而重複下載。
- `start` 沒寫時自動偵測，並寫回清單加註 `_autoStart: true`，讓結果可重現、可直接微調。
- `skip`：只影響打包，快取照樣保留；`original` 不能略過（公布答案要用）。所有題目版本都被略過的歌不放進題庫包。
- 沒有 `url`／`file` 的歌會被略過，不中斷整批。

### 6.3 自動偵測副歌（`pick_start`）

沒寫 `start` 時自動找副歌，結果寫回 `songs.json`（`_autoStart: true`）。以 0.5 秒為一格：

1. **分數＝音量 z 分數＋重複度 z 分數 − 0.6 × 在全曲的位置（0〜1）**。
   重複度：chroma（12 音高的和聲特徵）自相似矩陣中，該片段與全曲其他不重疊位置的最高相似度。副歌大聲、會重複出現；
   「偏好前面」讓分數相近時選第一次完整副歌，而不是轉調後的最後一次副歌。
2. 只在全曲 15%〜80% 之間找，避開前奏、尾奏。
3. 從最高分往前退，退到分數仍在「最高分 − 1」以內的平台開頭（最多 8 秒），讓片段從副歌第一句開始。
4. 對齊到起點前後 1 秒內 onset 最強的拍點（`librosa.beat_track`）。

2026-10-16 驗證：6 首（Get Wild、紅蓮華、瞳をとじて、Lemon、ポリリズム、Let It Go）用 Demucs 取出片段人聲、
以 Whisper（faster-whisper small）辨識歌詞，再和已知副歌比對：

| 方法 | 選到副歌 |
| --- | --- |
| 舊法：25%〜75% 間最大聲 | 3／5（Get Wild 選到主歌、Lemon 選到 C 段；ポリリズム 辨識不出歌詞） |
| 新法（無第 3 步） | 6／6，但 瞳をとじて 從句子中間「描くよ」開始 |
| 新法（含第 3 步，採用） | 6／6，Get Wild「Get wild and tough」、紅蓮華「どうしたって消せない夢も」、瞳をとじて「瞳をとじて 君を描くよ」都從第一句開始 |

演算法改版後，舊的自動起點可以用 `build_pack.py --repick` 重選（只影響 `_autoStart` 的歌，手動填的 `start` 不變）。

### 6.4 各版本的做法

| 版本 | 做法 | 備註 |
| --- | --- | --- |
| `original` | 原始片段 | 公布答案用 |
| `instrumental` | drums + bass + other | Demucs 品質穩定 |
| `vocal` | vocals | 人聲 RMS 低於 −40dB（幾乎沒有人聲）時略過 |
| `other` | other（吉他／鍵盤／弦樂等） | RMS 低於 −40dB 時略過 |
| `speed` | ffmpeg `asetrate` 改音高，再用 `atempo` 補成 1.5 倍速 | 1.5 倍速＋升 6 半音 |
| `chip` | vocals → CREPE 音符 → 柔和方波（50% 方波＋2.5kHz 低通） | 見 6.5.1、6.5.4；音符少於 8 個時略過 |
| `vocal_rev` | instrumental + 倒轉的 vocals | 沒有人聲時略過 |
| `rhythm` | drums + bass | 高難度 |
| `reverse` | 原始片段倒轉 | 最難 |

`static_src/utau_songs.js` 的 `VARIANTS` 依難度由易到難排列，設定畫面照這個順序顯示。
製作方式改變時遞增 `build_pack.py` 的 `RECIPE`，快取資料夾名稱含此版本，舊成品自動失效。
只改 8bit 音色時改遞增 `CHIP_VERSION`：只用快取的 `vocal.m4a` 重做 `chip.m4a`（資料夾內的 `chip-v<版本>` 標記檔），不必重做 Demucs 分離與 AI 歌聲。

所有版本最後都做 0.3 秒淡入淡出，並把音量統一到 RMS 約 −18dBFS（峰值不超過 0.95），避免版本間音量落差太大。

### 6.5 版本的取捨（2026-10-16 使用者試聽後決定）

第一版（RECIPE 1）有「變速變調（1.3 倍＋3 半音或 0.8 倍−3 半音）」與「八音盒／8bit」。使用者試聽回饋：

- 變速太簡單 → 改為 **1.5 倍速＋升 6 半音**（只留變快；0.65 倍＋降 6 半音的放慢版試做後未採用）。
- 八音盒／8bit 聽不出是什麼歌 → 拿掉。原因推測：人聲 pYIN 音高被量化成半音方塊音符，滑音、顫音與節奏感都消失，偶有八度誤判。
- 鼓＋貝斯很難 → 保留，作為高難度選項。
- 試做 8 種候選風格後採用：只有旋律樂器、極端變快、人聲倒放、整段倒放。
  未採用：哼唱（跟著連續音高曲線合成）、隔壁房間（低通＋回音）、極端變慢、小節打亂。

舊題庫包裡的 `melody`／舊 `speed` 匯入後仍存在 IndexedDB，但 `melody` 不在 `VARIANTS` 清單中，設定畫面不會出現、也不會被抽到；
舊設定存檔裡的 `melody` 會在讀回時濾掉。舊包的 `speed` 仍是舊的速度，重新製作並匯入即可更新。

### 6.5.1 8bit 旋律第二版（`chip`，RECIPE 3）

舊版八音盒／8bit 聽不出來的原因，用「原唱真的在唱的時間（人聲 RMS 在最大值 −30dB 內）有多少比例有音符在響」量化後才確定：

| 歌曲 | 舊版（pYIN）覆蓋 | 新版（CREPE）覆蓋 | 新版音準（±1 半音，對照 pYIN 高信心格） | 音符數 舊→新 |
| --- | --- | --- | --- | --- |
| Get Wild | 18% | 64% | 96% | 19 → 69 |
| 紅蓮華 | 25% | 78% | 99% | 18 → 72 |
| 瞳をとじて | 35% | 82% | 99% | 27 → 74 |
| Lemon | 39% | 89% | 100% | 30 → 73 |
| ポリリズム | 42% | 96% | 99% | 19 → 42 |
| Let It Go | 66% | 87% | 99% | 32 → 64 |

pYIN 在快節奏、經 Demucs 分離的人聲上大多數格子信心值很低而被丟掉，大半旋律消失；CREPE（`torchcrepe` full 模型，沿用 Demucs 已裝的 torch）在同樣的片段上有聲判定 79%（pYIN 約 35%）。
做法見 `build_pack.py` 的 `crepe_notes()`／`synth_chip()`。

試做過三種程度：只有主旋律、旋律＋三角波貝斯＋雜訊鼓、再加琶音和弦。使用者試聽後選「只有主旋律」。
另外試過「整段取中位數、以音節切音符」與「對齊估計調性的音階」，音準反而下降（67〜85%），未採用。

### 6.5.2 中文版（`zh_sing`，2026-10-17）

使用者試聽後採用的做法（詳細實驗過程見對話紀錄；程式在 `zh_voice.py`）：

- **歌詞**：`lyrics_draft.py` 用 Whisper medium 聽寫片段人聲（逐字時間戳記斷句）→ `lyrics.json` 草稿 →
  Claude 在對話中校對、翻譯（`zh`）與填詞（`sing`）。譯詞不呼叫外部 API（使用者指定）。
- **`zh_read`（已拿掉）**：edge-tts 台灣語音逐句朗讀＋伴奏。第一批 24 首日文歌試聽後使用者決定不要（2026-10-17）；
  只有朗讀（無伴奏）的版本更早就判定不適合。`zh_voice.read_aloud()` 保留但不再呼叫。
- **長度 30 秒**：使用者試聽第一批後要求中文歌聲（與伴奏提示）拉長到 30 秒；其他版本維持 15 秒。
  `build_pack.long_stems()` 從同一個起點另外分離 30 秒的人聲／伴奏，`lyrics.json` 的 `clip` 記錄該首時間軸長度。
- **`zh_sing`**：DiffSinger（onnxruntime 直接推論，不需要 OpenUtau）。音高用原唱 CREPE 曲線；
  字的起點對到原唱人聲 onset（動態規劃挑 k 個、偏好平均分布與強 onset）。
  時長模型預測音素長度、variance 模型預測氣聲／發聲（／張力）。
  - 節奏準確率（合成歌聲 onset 落在原唱 onset 70ms 內的比例，5 首平均）：對 CREPE 音符起點 72% → 對原唱 onset：Ria 78%、綺萱 83%。
  - 音高與原唱一致（±1 半音、忽略八度）98〜100%。
  - Whisper 聽寫合成歌聲：Ria 多數幾乎逐字正確；綺萱的高音童聲 Whisper 常辨識失敗，無法以此驗證，靠人耳。
- **試過但不採用**：Windows 日文語音逐假名拼接＋WORLD 改音高的「亂替換歌詞」（使用者：完全不適合）；
  模仿知名歌手的聲音（未經本人同意的聲音複製，不做）。

### 6.5.2.1 日文歌聲（`ja_sing`，華語歌用）

- 使用者指定的用途：把華語歌翻成日文來唱（日文歌不做）。日文填詞由 Claude 在對話中撰寫（`lyrics.json` 的 `ja_sing`）。
- VOICEVOX ENGINE（本機 HTTP API，`ja_voice.py`）：樂譜交給 `/sing_frame_audio_query`（VOICEVOX:波音リツ 的歌唱模型）
  產生音素與時長，再把有聲 frame 的 f0 換成原唱 CREPE 曲線，`/frame_synthesis` 用指定角色合成。
- 角色（使用者試聽 ずんだもん／青山龍星／玄野武宏／白上虎太郎／剣崎雌雄／雀松朱司／麒ヶ島宗麟／四国めたん 後指定）：
  男 **玄野武宏**、女 **四国めたん**。
- 2 首實測（晴天、小幸運）：Whisper 聽寫合成歌聲與填詞幾乎一致。
- 長音「ー」不能放進 `ja_sing`：VOICEVOX 的 `/sing_frame_audio_query` 會回 HTTP 400（2026-10-17，姊妹「べいびー」）。
- 第一個假名從片段 0 秒就開始時，樂譜開頭休止只剩 1 格，同一個 API 會回 HTTP 500；`ja_voice.sing()` 讓第一個假名最早從 0.1 秒開始（2026-10-18，說愛你）。

### 6.5.2.2 分批擴充（2026-10-17〜）

使用者指示中文歌聲／日文歌聲「一批一批照這個流程繼續做」，每批約 30 首：
`lyrics_draft.py`（30 秒聽寫）→ `lyrics_phrases.py`（樂句＋逐字時間）→ Claude 填詞到 `cache/fills_bN.py` →
`lyrics_merge.py`（檢查後合併）→ `build_pack.py --split`。

- 第 2、3 批後：中文歌聲 53 首、日文歌聲 21 首。
- 第 4、5 批後：中文歌聲 74 首、日文歌聲 40 首。略過的歌記在 `cache/skip_ids.txt`（不進 Git），選下一批時排除。
- **第 10 批後全部跑完（2026-10-18）**：中文歌聲 131 首（日文歌 130／231、英文歌 1）、日文歌聲 64 首（華語歌 64／85）。
  略過 122 首：多為 2015 年以後的快歌、饒舌、中英混雜或電子處理人聲（Whisper 聽寫失敗或幻覺），以及台語歌與沒有片段的歌。
  要補做這些歌，需要使用者提供正確歌詞（或手動校正 `lyrics.json` 的 `t`／`ja`）後再填詞。
- Whisper 聽寫失敗（幻覺、空白、台語歌）或 Claude 對原詞沒把握的歌**整首略過**，不硬填；
  單句沒把握就用 `end` 留白（該段不唱）。
- 抽查方式：Whisper 聽寫合成歌聲，與填詞比對（第 2、3 批抽 6 首，多數逐字一致）。
- 提示與 `zh_sing` 相同（`hint: "ja_sing_inst"`，播放 5 次後、不扣分）；畫面標示「VOICEVOX:玄野武宏、VOICEVOX:四国めたん」。

### 6.5.3 提示（加上伴奏）

- `utau_songs.js` 的 `VARIANTS` 中，`zh_sing` 帶 `hint: "zh_sing_inst"`；提示音檔不是可勾選的版本，也不會被抽成題目。
- 規則（使用者指定）：**本輪播放滿 5 次**（`Core.HINT_PLAYS`）後才能按「加上伴奏」；**不影響計分**，只在紀錄標示「用了提示」。
- `state.current.plays`／`hint` 每輪（含換一首）歸零；`Core.recordPlay()`、`useHint()`、`hasHint()`、`playsUntilHint()`。
- 播放鍵先同步 `play()` 再記錄次數（iOS 限制）；用了提示後主播放器改載入 `zh_sing_inst`。

### 6.5.4 8bit 音色改為柔和方波（`CHIP_VERSION` 2，2026-10-17）

使用者覺得 25% 脈衝波太刺耳，用同一組音符做了 5 種音色試聽（Get Wild、紅蓮華、Lemon、Let It Go、小幸運、晴天）：

| 候選 | 音色 | 結果 |
| --- | --- | --- |
| A | 25% 脈衝波（舊版） | 不採用 |
| **B** | **50% 方波、起音 12ms、尾音 50ms、2.5kHz 二階低通** | **採用** |
| C | 紅白機三角波（4-bit 階梯） | 不採用 |
| D | B＋回音（Game Boy 風） | 不採用 |
| E | 陶笛（正弦波＋少量 2、3 次泛音、慢起音） | 不採用 |

另外試算過「主旋律清晰度」（原唱在唱的時間內 CREPE periodicity 平均值，347 首中位數 0.71；多人合唱、嘶吼、碎節奏的歌偏低，
例如 Bohemian Rhapsody 0.25、ハレ晴レユカイ 0.36），考慮只替清楚的歌做 8bit。
使用者決定**不設門檻**：只要能做出 8bit（音符 8 個以上）就照做。

### 6.6 沒有做的版本

「歌詞變化版」原本判斷做不出可用品質而未做；之後以 DiffSinger 中文填詞（6.5.2 的 `zh_sing`）實現。

### 6.7 快取與效能

- 下載結果：`cache/dl/<雜湊>.<副檔名>`，只留原始壓縮檔（一首約 4MB）。每次需要時用 ffmpeg 直接解碼到記憶體，
  不另存整首 wav（舊版這樣做，一首約 40MB）。起點已知且成品快取存在時連解碼都跳過，重跑 6 首約 0.4 秒。
- 成品：`cache/clips/<雜湊>-<start>-<clip>/`，再跑一次會直接沿用；改了 `start` 或 `--clip` 才會重做。
- 只對剪下來的片段（約 17 秒）做音源分離，CPU 一首約 10〜30 秒。第一次執行會下載 Demucs 模型（約 80MB）。
- 單首失敗（例如影片不存在）不影響其他首，最後會列出失敗清單。

---

## 7. 夢想模式：YouTube 連結

### 7.1 為什麼不用後端

網站是靜態網頁，瀏覽器不能直接下載 YouTube 音訊。因此夢想模式改用 **YouTube 官方的 IFrame Player API** 嵌入播放，不下載、不需要後端。
代價是無法即時把人聲和伴奏分開，只能播原影片的片段（可另外隨機變速）。

### 7.2 流程

1. 出題者在遮蔽畫面貼上網址 → `Core.parseYoutubeId()` 解析 videoId（支援 `watch?v=`、`youtu.be`、`shorts`、`embed`、`live`、`music.youtube`）。
2. 第一次需要時才動態載入 `https://www.youtube.com/iframe_api`。
3. 按「▶ 播放」：
   - 若已知影片長度：`Core.randomStart()` 在 **15%〜(90% − 播放秒數)** 之間隨機挑起點 → `seekTo` → 播放。
   - 若還不知道長度（cue 之後有時拿不到）：先**靜音**從頭播，進入 PLAYING 狀態後取得長度、算起點、`seekTo`、取消靜音。
4. 每 200ms 檢查 `getCurrentTime()`，到達「起點 + 播放秒數」就暫停（用影片時間判斷，所以變速時也正確）。
5. 開始播放時用 `getVideoData().title` 記下影片標題，結算後在紀錄中顯示，並附「在 YouTube 開啟答案」的連結。
6. 「重播同一段」沿用起點；「換一段」重新抽起點；「出題者重新輸入」清掉連結。
7. 開「隨機變速」時，每輪在 0.75 倍與 1.25 倍之間抽一個（`setPlaybackRate`，音高不變）。

### 7.3 播放器的位置與遮罩

- `render()` 每次都會清空 `#ut-app`，而 iframe 只要在 DOM 中被移除或移動就會重新載入，所以播放器放在 `body` 底下的**浮動卡片**（`#ut-yt-host`，右下角），不跟著畫面重繪。
- YouTube 要求嵌入播放器至少 200×200，所以卡片是 200×200；上面蓋一層不透明遮罩，看不到影片標題與縮圖，也點不到播放器本身。
- 有播放器時 `body` 加上 `ut-has-player`，底部留白避免遮住內容。

### 7.4 已知限制

- 有些影片禁止嵌入（錯誤碼 101／150），會顯示 `ut_err_yt_embed` 請出題者換連結。
- 嵌入的影片可能先播廣告。
- 隨機起點可能落在間奏或對白，可以按「換一段」。

---

## 8. 測試

```bash
py -3 generate.py
py -3 -m http.server 8942 --directory dist
node tools/utau_check/core_check.js
node tools/utau_check/ui_check.js
```

- `core_check.js`：歌單完整性（日本 ≥ 150 首且動漫占 ≥ 35%、歐美／韓國濃縮）、計分、抽人順序、復原、題庫包抽題與版本篩選、YouTube 網址解析、隨機起點範圍、夢想模式狀態。
- `ui_check.js`：基本模式整局流程；在測試內產生 STORED zip 題庫包並匯入，驗證篩選、播放鍵就緒、偷看答案、原曲音檔內容、重新整理後題庫包仍在；夢想模式的網址輸入、浮動播放器、答案連結；切換日文。
- 實際 YouTube 播放與真的題庫包音檔解碼需要網路與 Chrome，未納入自動測試；2026-10-16 已手動用 Chrome 確認（隨機起點播放並自動停止、AAC 解碼正常）。

---

## 9. 待辦

- 視需要加入更多分類或歌單。
