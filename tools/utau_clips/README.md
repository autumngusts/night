# 我不會唱歌：進階模式題庫包製作工具

把 YouTube 連結（或本機音檔）轉成「題庫包」zip，在遊戲的進階模式匯入後離線播放。

- 音檔**不進 Git、不上網**：題庫包只存在匯入那台裝置的瀏覽器（IndexedDB）裡。
- `.venv/`、`cache/`、`out/` 都已加入 `.gitignore`。
- 注意：下載 YouTube 音訊違反 YouTube 服務條款，請只用於私人聚會，不要散布題庫包。

## 每首歌會做出的版本

| 版本 | 做法 |
| --- | --- |
| 原曲 `original` | 剪下的那一段，結算後「播放原曲」公布答案用 |
| 純樂器 `instrumental` | Demucs 去掉人聲 |
| 純人聲 `vocal` | Demucs 只留人聲（幾乎沒有人聲的曲子會略過） |
| 只有旋律樂器 `other` | Demucs 的 other（拿掉人聲、鼓、貝斯；幾乎沒有的曲子會略過） |
| 極端變快 `speed` | 1.5 倍速＋升 6 半音 |
| 8bit 旋律 `chip` | 人聲旋律用 CREPE 辨識成音符，再用柔和的方波音色（8bit 遊戲風）演奏（幾乎沒有人聲的曲子會略過） |
| 人聲倒放 `vocal_rev` | 伴奏正常、人聲倒著放（幾乎沒有人聲的曲子會略過） |
| 只有鼓＋貝斯 `rhythm` | Demucs 的 drums＋bass |
| 整段倒放 `reverse` | 原曲片段倒著放 |
| 中文歌聲 `zh_sing` | DiffSinger 聲庫用中文填詞唱原曲旋律，只有歌聲（需要 `lyrics.json` 與 `models/`） |
| 中文歌聲＋伴奏 `zh_sing_inst` | 遊戲中 `zh_sing` 播放 5 次後可用的提示，不是獨立題目 |
| 日文歌聲 `ja_sing` | 華語歌的日文填詞由 VOICEVOX 角色演唱（男 玄野武宏／女 四国めたん），只有歌聲 |
| 日文歌聲＋伴奏 `ja_sing_inst` | `ja_sing` 的提示（同上） |

依難度由易到難大致是：純樂器 → 純人聲 → 只有旋律樂器 → 極端變快 → 8bit 旋律 → 人聲倒放 → 鼓＋貝斯 → 整段倒放。
主持人可以在遊戲設定畫面勾選要用哪些版本。

「歌詞變化版」以 DiffSinger 中文填詞實現（`zh_sing`，見下方「中文版」）。

## 安裝（第一次）

```bash
py -3 -m venv tools/utau_clips/.venv
tools/utau_clips/.venv/Scripts/python.exe -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu
tools/utau_clips/.venv/Scripts/python.exe -m pip install demucs torchcrepe yt-dlp imageio-ffmpeg soundfile librosa numpy
tools/utau_clips/.venv/Scripts/python.exe -m pip install onnxruntime pyyaml pypinyin edge-tts faster-whisper
```

- ffmpeg 用 `imageio-ffmpeg` 附帶的執行檔，不需要另外安裝。
- 不需要顯示卡：只對剪下來的片段做音源分離，CPU 一首約 10〜30 秒。第一次執行會下載 Demucs 模型（約 80MB）。

## 使用方式

### 1. 決定要做哪些歌、找 YouTube 網址（`find_urls.py`）

```bash
# 從歌單加入「日本・動漫」的歌，並自動搜尋網址
tools/utau_clips/.venv/Scripts/python.exe tools/utau_clips/find_urls.py --region ja --category anime
# 其他例子
... find_urls.py --decade 1990 --decade 2000      # 依年代加入
... find_urls.py --id ja:紅蓮華 --id ja:Lemon      # 指定歌曲
... find_urls.py --all --limit 50                 # 整份歌單，這次先搜 50 首
... find_urls.py                                  # 不加入新歌，只搜尋清單裡還沒有網址的歌
... find_urls.py --redo ja:異邦人                  # 重新搜尋某首
```

- 只搜尋、不下載。每首搜尋兩次（一般搜尋＋「Provided to YouTube by」），挑最像官方原曲音源的結果：
  確定是原唱的頻道優先（頻道名稱含歌手名，或官方頻道說明欄裡出現的羅馬拼音 Topic 頻道），
  Topic 純音訊又優於 MV（沒有 MV 的前奏劇情與對白，副歌偵測較準）；live、翻唱、伴奏、remix、耐久版扣分。
- 結果寫回 `songs.json`：`url`，以及 `_yt`（影片標題、頻道、長度、`warn` 警告）。
- **最後列出的「需要人工確認」一定要聽過**：常見的是別人翻唱的 Topic 音源。不對就自己改 `url`，或用 `--redo` 重搜。
- 每搜一首就存檔，中途中斷不會白搜；已經有 `url` 的歌不會被覆蓋（除非 `--redo`）。

### 2. `songs.json` 的格式

一首一行，可以手動編輯：

```json
[
  { "id": "ja:紅蓮華", "url": "https://www.youtube.com/watch?v=xxxxxxxxxxx" },
  { "id": "ja:Lemon", "url": "https://youtu.be/xxxxxxxxxxx", "start": 62, "skip": ["rhythm"] },
  { "url": "https://youtu.be/xxxxxxxxxxx", "t": "歌名", "a": "歌手", "y": 2024, "r": "ja", "c": "anime" },
  { "id": "ja:測試", "file": "D:/music/test.mp3", "t": "測試", "a": "某人", "y": 2020, "r": "ja", "c": "pop" }
]
```

- `id`：`static_src/utau_songs.js` 歌單裡的 id（`地區:歌名`）。對得到的話歌名、歌手、年份、地區、分類都會自動帶入。
- 歌單裡沒有的歌：自己寫 `t`（歌名）、`a`（歌手）、`y`（年份）、`r`（地區 `ja`/`zh`/`ko`/`en`）、`c`（分類 `anime`/`screen`/`pop`/`idol`/`net`/`classic`）。
- `url`：YouTube 網址，`youtu.be`、`shorts`、`music.youtube.com`、帶 `&t=` 等寫法都可以，製作時會統一成同一支影片。
- `file`：用本機音檔代替 YouTube。
- `start`（秒）：剪哪一段。不寫的話會自動找副歌（音量＋和聲重複度，從副歌第一句開始並對齊拍點），
  並**寫回清單**（同時加上 `"_autoStart": true` 註記），下次製作結果相同，不滿意直接改這個數字。
- `skip`：這首不要放進題庫包的版本，例如 `["rhythm", "vocal_rev"]`（`original` 不能略過）。
  只影響打包，音檔快取照留，之後拿掉 `skip` 不必重做。
- `exclude: true`：審核後決定這首不做（不製作、不打包；留在清單裡，`find_urls.py` 就不會再加回來）。
- 底線開頭的欄位（`_yt`、`_autoStart`）只是給人看的註記，製作工具不會讀。
- 還沒有 `url`／`file` 的歌會被略過，不會讓整批停下來。

### 3. 製作題庫包（`build_pack.py`）

```bash
tools/utau_clips/.venv/Scripts/python.exe tools/utau_clips/build_pack.py
```

選項：`--clip 15`（每段秒數）、`--only ja:紅蓮華`（只處理指定 id，可重複）、`--songs 檔案`、`--out 輸出路徑`、
`--repick`（自動選的起點重新偵測，手動填的不受影響）。

- 速度：CPU 一首約 20 秒（下載＋找副歌＋分離＋8bit 旋律辨識）；做過的歌再跑幾乎不花時間。
- 改了製作方式（`build_pack.py` 的 `RECIPE` 遞增）後，舊成品快取自動失效，重跑會重做。
- 只改 8bit 音色時遞增 `CHIP_VERSION`：重跑只會用快取的人聲重做 `chip`，其他版本照用快取。
- 快取：只留原始下載檔（`cache/dl/`，一首約 4MB）與成品（`cache/clips/`，一首約 1.5MB）。

### 4. 試聽、修正、再打包

- 輸出 `tools/utau_clips/out/utau_pack.zip` 和試聽頁 `out/preview.html`（用瀏覽器直接開）。
- 試聽頁每首一列、每個版本一個播放器；紅底是被 `skip` 排除的版本。
- 某個版本做壞了（人聲殘留伴奏、旋律樂器幾乎聽不到等）→ 在該首加 `skip`；起點不對 → 改 `start`。再跑一次 `build_pack.py`。
  只改 `skip` 不會重做音檔；改 `start` 或 `--clip` 只重做那首。

### 5. 匯入遊戲

在遊戲設定畫面選「進階模式」→「匯入題庫包」選 `utau_pack.zip`。
- 匯入多次會依歌曲 id 合併，所以可以分批做、分批匯入。
- zip 是不壓縮（STORED）格式，請不要自己重新壓縮，瀏覽器端只讀得懂這種格式。

## 中文版（zh_sing）

中文歌聲與它的伴奏提示長 **30 秒**（使用者 2026-10-17 指定），從題目片段的同一個起點另外分離人聲／伴奏（成品資料夾的 `long30/`）；其他版本維持 15 秒。
中文朗讀（`zh_read`）使用者試聽後不採用，已拿掉。

### 聲庫與聲碼器（第一次，放在 `models/`，不進 Git）

```bash
cd tools/utau_clips/models
gh release download v0.4-lynxnet -R RibosomeK/RiaDiffSinger -p "Ria-v0.4-lynxnet.zip"
gh release download v2.7.0 -R yqzhishen/qixuan-diffsinger -p "Qixuan_v2.7.0_DiffSinger_OpenUtau.zip"
gh release download pc-nsf-hifigan-44.1k-hop512-128bin-2025.02 -R openvpi/vocoders -p "*.oudep"
# 解壓縮成 models/ria/、models/qixuan/、models/vocoder/（.oudep 也是 zip）
```

| 聲庫 | 用途 | 使用規約重點 |
| --- | --- | --- |
| Ria／狸安（RibosomeK） | 男歌手的歌（音域 A2〜G#4） | 要標示聲庫名稱；**不可**再用 RVC／SVC 變聲 |
| 綺萱（OpenVPI） | 女歌手的歌（少女聲） | 公開時標示「AI 合成」「綺萱」「DiffSinger」；可作為聲音轉換的輸入（需標示來源） |
| PC-NSF-HiFiGAN 聲碼器（OpenVPI） | 兩者共用 | CC BY-NC-SA 4.0（非商業） |

遊戲畫面在中文歌聲題目會顯示「AI 合成歌聲：Ria／狸安、綺萱（DiffSinger）」。

### 日文歌聲用的 VOICEVOX ENGINE（第一次，約 1.7GB）

```bash
cd tools/utau_clips/models
gh release download 0.25.2 -R VOICEVOX/voicevox_engine -p "voicevox_engine-windows-cpu-0.25.2.7z.001"
../.venv/Scripts/python.exe -m pip install py7zr
../.venv/Scripts/python.exe -c "import py7zr; py7zr.SevenZipFile('voicevox_engine-windows-cpu-0.25.2.7z.001').extractall('voicevox')"
# 解壓後是 models/voicevox/windows-cpu/run.exe
```

- `build_pack.py` 需要時會自動啟動引擎、結束時關閉，不必手動開。
- 角色：原唱 male → 玄野武宏、female → 四国めたん（使用者試聽後指定）。歌唱的音素與時長由 VOICEVOX:波音リツ 的歌唱模型產生。
- 使用規約：要標示「VOICEVOX:角色名」；遊戲畫面在日文歌聲題目會顯示。

### 製作流程

1. 先照平常跑 `build_pack.py`，做出片段。
2. 聽寫歌詞草稿：`tools/utau_clips/.venv/Scripts/python.exe tools/utau_clips/lyrics_draft.py`
   → `lyrics.json` 每首會有 `start`、`clip`（聽寫的秒數，預設 30）、每句的 `t`（開始秒數）與 `ja`（聽寫的原文）。
   - `--region ja` 只做日文歌。已經填好 15 秒的舊資料會保留原本的句子，只補上 15 秒以後的聽寫。
   - 人聲經過大量電子處理的歌（例：Perfume）Whisper 會聽不出來，需要手動填。
3. **在對話中請 Claude** 校對聽寫、填上：
   - `voice`：原唱 `male`／`female`（決定歌聲聲庫）
   - 每句的 `zh`：中文直譯（對照用，方便檢查填詞意思）
   - 每句的 `sing`：中文填詞（歌聲用，一字唱一個音節，字數大約等於原句音節數）
   - 華語歌改填每句的 `ja_sing`：日文填詞（平假名，一個假名唱一個音；避開「っ」等不能單獨成音的字）
4. 再跑一次 `build_pack.py`：有 `sing` 的做 `zh_sing`＋`zh_sing_inst`，有 `ja_sing` 的做 `ja_sing`＋`ja_sing_inst`。
   - 快取在成品資料夾的 `zh-<歌詞雜湊>/`，改了譯詞或填詞只重做那首的中文版。
   - `start` 改過（重選起點）時，`lyrics.json` 的時間軸就對不上了，工具會略過中文版並提示重新聽寫。
- `lyrics.json` 是歌詞與譯詞，有版權疑慮，**不進 Git**。

## 疑難排解

- 搜尋或下載突然全部失敗：YouTube 改版時常讓舊版 yt-dlp 失效，先執行
  `tools/utau_clips/.venv/Scripts/python.exe -m pip install -U yt-dlp`。
