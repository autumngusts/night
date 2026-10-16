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
| 進階模式 `advanced` | 播放預先做好的題庫包音檔（純樂器、純人聲、變速變調、鼓＋貝斯、八音盒／8bit） |
| 夢想模式 `dream` | 出題者貼 YouTube 連結，App 從影片中段隨機播一小段 |

> 舊版的「進階模式」（抽歌＋指定演唱方式，玩家自己唱）已依使用者指示由新版取代。
> 舊存檔（`state.version === 1`）會被直接捨棄。

---

## 2. 檔案結構

| 檔案 | 內容 |
| --- | --- |
| `site_src/utau_page.py` | 頁面組裝與 script 清單 `UTAU_SCRIPTS`（`generate.py` 也用這份清單複製檔案） |
| `static_src/utau_songs.js` | 歌單目錄（343 首，日本為主）、地區、分類、音檔版本定義 |
| `static_src/utau_pack.js` | 題庫包：讀取 zip、存進 IndexedDB、取出音檔 |
| `static_src/utau_core.js` | 規則引擎（純函式，不碰 DOM／storage，可用 node 測試） |
| `static_src/utau.js` | UI、存讀檔、音檔播放、YouTube 播放器 |
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
clips/<來源雜湊>/speed.m4a
clips/<來源雜湊>/rhythm.m4a
clips/<來源雜湊>/melody.m4a
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
songs.json 一筆
  → 解析歌曲資料（用 node 讀 utau_songs.js 的歌單，id 對得到就自動帶入歌名等欄位）
  → 下載（yt-dlp）或讀本機檔 → 轉成 44.1kHz 立體聲 wav（cache/src/）
  → 決定起點 start（手動指定或自動偵測副歌）
  → 剪出 [start − 1 秒, start + clip + 1 秒]（前後多 1 秒給 Demucs 上下文，成品會剪掉）
  → Demucs htdemucs 分離成 drums / bass / other / vocals
  → 混出各版本 → 淡入淡出＋音量統一 → AAC 編碼
  → 打包成 STORED zip
```

### 6.3 自動偵測副歌（`pick_start`）

沒寫 `start` 時，把全曲以 0.5 秒為單位計算 RMS 音量，在全曲 **25%〜75%** 之間找「接下來 clip 秒平均音量最大」的起點。
副歌通常是全曲最大聲的段落，命中率不錯；但遇到 Bridge 或尾奏最大聲的歌會偏掉，結果會印在畫面上，不滿意就在 `songs.json` 補 `start`。

### 6.4 各版本的做法

| 版本 | 做法 | 備註 |
| --- | --- | --- |
| `original` | 原始片段 | 公布答案用 |
| `instrumental` | drums + bass + other | Demucs 品質穩定 |
| `vocal` | vocals | 人聲 RMS 低於 −40dB（幾乎沒有人聲）時略過 |
| `speed` | ffmpeg `asetrate` 改音高，再用 `atempo` 補回速度 | 依來源雜湊固定為「1.3 倍速＋升 3 半音」或「0.8 倍速＋降 3 半音」 |
| `rhythm` | drums + bass | 高難度 |
| `melody` | 人聲 → 旋律音符 → 重新合成 | 見 6.5；音符少於 4 個時略過 |

所有版本最後都做 0.3 秒淡入淡出，並把音量統一到 RMS 約 −18dBFS（峰值不超過 0.95），避免版本間音量落差太大。

### 6.5 八音盒／8bit 旋律版

1. 人聲轉單聲道、降到 22.05kHz，用 `librosa.pyin`（C2〜C6）逐格估計基頻。
2. 有聲且信心值 > 0.3 的格子四捨五入成 MIDI 音高，再做 5 格中值濾波去掉抖動。
3. 連續同音高合併成一個音符，長度不到 80ms 的丟掉。
4. 整體移八度，讓旋律的中位數落在音色好聽的音域（八音盒約 E5、8bit 約 A4）。
5. 合成（不需要外部合成器或音色庫）：
   - **八音盒**：基音正弦＋2 倍、4 倍泛音，指數衰減（τ = 0.35 秒），每個音至少響 0.6 秒。
   - **8bit**：方波，帶短的起音與收尾。
   - 依來源雜湊決定用哪一種（約 2/3 八音盒、1/3 8bit）。

人聲旋律的音高辨識偶爾會出錯（轉音、和聲、Demucs 殘留的伴奏），這是此版本已知的限制。

### 6.6 沒有做的版本

「歌詞變化版」需要用 AI 讓同一個歌聲唱新的歌詞（歌聲合成／SVC），在本機無法穩定做出可用品質，因此不做。

### 6.7 快取與效能

- 下載與轉檔結果：`cache/src/<雜湊>.wav`
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

- `core_check.js`：歌單完整性（日本 ≥ 200 首、歐美／韓國濃縮）、計分、抽人順序、復原、題庫包抽題與版本篩選、YouTube 網址解析、隨機起點範圍、夢想模式狀態。
- `ui_check.js`：基本模式整局流程；在測試內產生 STORED zip 題庫包並匯入，驗證篩選、播放鍵就緒、偷看答案、原曲音檔內容、重新整理後題庫包仍在；夢想模式的網址輸入、浮動播放器、答案連結；切換日文。
- 實際 YouTube 播放與真的題庫包音檔解碼需要網路與 Chrome，未納入自動測試；2026-10-16 已手動用 Chrome 確認（隨機起點播放並自動停止、AAC 解碼正常）。

---

## 9. 待辦

- 用使用者提供的實際歌曲跑製作工具，確認純人聲與八音盒／8bit 版的實際效果，必要時調整 pYIN 參數或合成音色。
- 視需要加入更多分類或歌單。
