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
| 變速變調 `speed` | 依歌曲固定為「1.3 倍速＋升 3 半音」或「0.8 倍速＋降 3 半音」 |
| 只有鼓＋貝斯 `rhythm` | Demucs 的 drums＋bass |
| 八音盒／8bit `melody` | 人聲旋律用 pYIN 轉成音符，再用八音盒或方波（8bit）重新合成；偶爾會轉錯 |

「歌詞變化版」需要 AI 歌聲合成，本機無法穩定做出可用品質，所以沒有做。

## 安裝（第一次）

```bash
py -3 -m venv tools/utau_clips/.venv
tools/utau_clips/.venv/Scripts/python.exe -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu
tools/utau_clips/.venv/Scripts/python.exe -m pip install demucs yt-dlp imageio-ffmpeg soundfile librosa numpy
```

- ffmpeg 用 `imageio-ffmpeg` 附帶的執行檔，不需要另外安裝。
- 不需要顯示卡：只對剪下來的片段做音源分離，CPU 一首約 10〜30 秒。第一次執行會下載 Demucs 模型（約 80MB）。

## 使用方式

1. 在 `songs.json` 加入歌曲：

```json
[
  { "id": "ja:紅蓮華", "url": "https://www.youtube.com/watch?v=xxxxxxxxxxx" },
  { "id": "ja:Lemon", "url": "https://youtu.be/xxxxxxxxxxx", "start": 62 },
  { "url": "https://youtu.be/xxxxxxxxxxx", "t": "歌名", "a": "歌手", "y": 2024, "r": "ja", "c": "anime" },
  { "id": "ja:測試", "file": "D:/music/test.mp3", "t": "測試", "a": "某人", "y": 2020, "r": "ja", "c": "pop" }
]
```

- `id`：`static_src/utau_songs.js` 歌單裡的 id（`地區:歌名`）。對得到的話歌名、歌手、年份、地區、分類都會自動帶入。
- 歌單裡沒有的歌：自己寫 `t`（歌名）、`a`（歌手）、`y`（年份）、`r`（地區 `ja`/`zh`/`ko`/`en`）、`c`（分類 `anime`/`screen`/`pop`/`idol`/`net`/`classic`）。
- `start`（秒）：剪哪一段。不寫的話會自動在全曲 25%〜75% 之間找最大聲的一段（通常是副歌），結果會印在畫面上，不滿意再補 `start`。
- `file`：用本機音檔代替 YouTube。

2. 執行：

```bash
tools/utau_clips/.venv/Scripts/python.exe tools/utau_clips/build_pack.py
```

選項：`--clip 15`（每段秒數）、`--only ja:紅蓮華`（只處理指定 id，可重複）、`--songs 檔案`、`--out 輸出路徑`。

3. 輸出在 `tools/utau_clips/out/utau_pack.zip`。在遊戲設定畫面選「進階模式」→「匯入題庫包」選這個檔案。
   - 匯入多次會依歌曲 id 合併，所以可以分批做、分批匯入。
   - 已處理過的歌會快取在 `cache/`，再跑一次只會處理新的歌（改了 `start` 或 `--clip` 會重做那首）。
   - zip 是不壓縮（STORED）格式，請不要自己重新壓縮，瀏覽器端只讀得懂這種格式。
