# 神前鍛刀對決 美術素材規格（給 GPT 等生成工具）

目前遊戲裡的刀全部由程式繪製：審查・刀鞘用側視 SVG（`bladeSvg`），對刀場用俯視剪影（`glyphOf`）。本文件說明若要另外製作美術或 3D 模型，需要準備哪些資料、交付什麼格式，以及可以直接交給 GPT 的提示詞。

**資料來源**：`node tools/katana_art/export_manifest.js` 會從遊戲資料產生 `docs/katana_art_manifest.json`，內含每個刀種、招式卡、覺醒招式的尺寸、外觀說明、檔名與提示詞。**要交給 GPT 的就是這個 JSON**（或其中一筆），本文件是它的說明。新增刀種或招式後重新執行即可更新。

---

## 1. 需要的素材一覽

| 用途 | 內容 | 數量 | 優先度 |
| --- | --- | --- | --- |
| A. 對刀場俯視圖 | 每個刀種一張俯視剪影（＋可上色的柄卷遮罩） | 38 | ★★★（辨識度最關鍵） |
| B. 招式特效序列圖 | 招式卡 7 種＋覺醒招式 35 種＋共通特效 6 種 | 48 | ★★★ |
| C. 覺醒招式切入圖 | 發動時橫幅用的招式字樣／剪影 | 35 | ★★ |
| D. 側視立繪 | 審查畫面・刀鞘卡片用的整把刀 | 38 | ★★ |
| E. 3D 模型（選配） | glTF，之後做 3D 展示或轉盤用 | 38 | ★ |

刀身的**地鐵紋路、刃文、反り、瑕疵是每把刀鍛出來才決定的**，所以美術素材只做「刀種的基本造型與拵」，刃文等仍由程式疊加（見 §6）。

---

## 2. 每個刀種要給生成工具的資料（manifest 的 `blades[]`）

| 欄位 | 說明 | 例（九環刀） |
| --- | --- | --- |
| `id` | 檔名用的英文 id | `jiuhuan` |
| `name` | 日文・中文・英文名稱 | 九環刀／nine-ring broadsword |
| `family` | 分組：nihonto／chinese／famous／rare | `chinese` |
| `era` | 時代・地區（決定拵的風格） | China, Qing–modern |
| `dims` | 刃長 cm、身幅 mm、重（厚度）mm、反り mm、單／雙刃 | 80 cm、53 mm、7 mm、10 mm、單刃 |
| `shape` | 寬窄變化、波刃、長柄、刀背環、環首、熱處理（有無刃文） | widen、9 環 |
| `fittings` | 拵：柄、鍔／護手、柄頭 | disk guard, ring pommel |
| `identify` | 辨識重點（剪影上一定要看得出來的特徵） | single-edged, widen, 9 rings |
| `files` | 交付檔名 | `static/katana_art/top/jiuhuan.png` |
| `prompt_side` / `prompt_top` | 已填好的英文提示詞 | （見 JSON） |

全 38 種的清單見 `docs/katana_game_design.md` §4.1。

---

## 3. 交付格式

### A. 對刀場俯視圖（最重要）

* **512×512 PNG，透明背景**，俯視正上方、無透視、無陰影。
* **旋轉中心＝畫面正中央**：刀劍是護手（鍔）的位置；長柄兵器（槍・薙刀・陌刀・偃月刀）是握持點，刃從中心往右 45% 處開始。
* **刀尖朝右（+x）**、柄朝左。刀尖到中心的距離約佔畫面寬的 45%（遊戲會依刀的觸及距離縮放）。
* **柄卷另出一張灰階遮罩** `<id>_hilt.png`（同尺寸、只有柄卷部分、淺灰），遊戲會用玩家色上色——這是多把同刀種時的主要辨識方式。
* 剪影要在 **48px 縮圖**下仍分得出刀種：反り方向、寬窄、刀背環、長柄、護手形狀要誇張一點。
* 光源固定左上，金屬亮、輪廓深色描邊。

### B. 特效序列圖

* **一列 8 格，每格 256×256，透明背景**（整張 2048×256），俯視、以格子中心為發動點。
* 亮部集中、適合加算合成（遊戲用 `lighter` 疊加）。
* 顏色以 manifest 的 `color` 為主色（覺醒招式各有固定色，見 `D.SPECIALS[].color`）。
* 不要畫人物、不要加文字（文字由遊戲疊加；居合的「斬」、看破的「見切」也由遊戲畫）。
* 時長參考：一般 0.3〜0.5 秒、居合斬弧 0.45 秒、覺醒招式 0.6〜1 秒。

| 招式卡 | 特效 |
| --- | --- |
| 踏進 dash | 疾衝的速度線與 3〜4 個淡出殘影 |
| 守勢 guard | 半透明藍色圓形護罩 |
| 調息 spin | 收束的旋風環 |
| 看破 mikiri | 架勢中白色虛線環；觸發時白色十字斬痕 |
| 一閃 issen | 直線疾衝留下細而亮的斬痕＋殘影 |
| 居合 iai | 納刀靜止 → 一瞬拔刀，周圍一圈白色新月斬弧＋畫面閃白 |
| 楓葉斬 momiji | 每次相接散出紅橙色楓葉 |

覺醒招式 35 種的特效說明在 manifest 的 `specials[].vfx`（取自招式說明），共通特效（刀刃相接火花、折斷、崩刃、灼燒、出血、毒）在 `common_vfx[]`。

### C. 覺醒招式切入圖

* **1024×256 PNG，透明背景**：招式的象徵圖樣（例：火之呼吸＝火焰紋、雷切＝雷光、月之呼吸＝新月群），左側留空給遊戲疊招式名。
* 檔名 `static/katana_art/cutin/<id>.png`。

### D. 側視立繪

* **2048×512 PNG，透明背景**，正側面、無透視。
* 刀尖朝右、柄在左；**單刃刀刃朝下、刀背朝上**（與遊戲 SVG 一致）。
* 差異淬火的刀種（`heatTreat: differential`）畫出白色刃文帶；整體淬火的不畫刃文。
* 刃文、地鐵模樣、瑕疵另由程式疊加時，可再出一版「無刃文」底圖 `<id>_plain.png`。

### E. 3D 模型（選配）

* **glTF 2.0（.glb）**，單位公尺，原點在護手中心，**刀尖朝 +X、刀背朝 +Y**，刃朝 −Y。
* 網格分開：`blade`、`guard`（鍔／護手／鎺）、`hilt`（柄，玩家色材質）、`pommel`、長柄兵器加 `shaft`。
* 面數：刀身 2〜5k tris、全體 15k tris 以下。
* PBR 貼圖 2048²：BaseColor、Metallic/Roughness、Normal；刃文用 Roughness 與 BaseColor 的差異表現（刃文較亮且粗糙度低）。
* 尺寸照 `dims`：刃長、身幅、重（厚度）、反り（刃長方向的弦到刀背最大距離）。

---

## 4. 對刀中的辨識度原則

1. **剪影優先**：一眼分得出刀種（彎刀 vs 直劍、寬 vs 細、有無長柄、刀背環、波刃）。
2. **玩家色在柄**：柄卷遮罩上色＋遊戲畫的耐久環，同刀種也分得出是誰的。
3. **分組有固定的拵風格**：日本刀＝圓鍔＋金色鎺；中華＝圓盤護手／環首／流蘇；西洋＝十字護手；冷門＝各自特殊造型。
4. **招式顏色固定**：覺醒招式各有固定色（`color`），光環、斬痕、切入橫幅都用同色，看顏色就知道是什麼招。

---

## 5. 給 GPT 的使用方式

1. 執行 `node tools/katana_art/export_manifest.js`。
2. 把 `docs/katana_art_manifest.json` 中要做的那一筆（或整份）貼給 GPT，請它依 `prompt_top` / `prompt_side` / `prompt` 產圖。
3. 建議一次先做同一分組的幾把，**固定同一段風格描述**（`realistic illustrated style consistent across the set`），避免畫風不一。
4. 生成工具若無法輸出透明背景：改成「純 #00FF00 背景」，之後去背。
5. 交付後依 `files` 的路徑放到 `static_src/katana_art/…`（目前 `generate.py` 還不會複製這個資料夾，接進遊戲時一併加上，見 §6）。

提示詞範例（俯視，manifest 已自動填好）：

```
Top-down game sprite of a nine-ring broadsword (jiuhuan dao) lying flat, seen from directly above.
wide single-edged blade with nine iron rings threaded along the spine. The guard/collar is exactly at the
image center and the blade points right toward the edge of the image; the hilt points left. Strong readable
silhouette at 48 px, clean dark outline, bright steel, no shadow, transparent background, 512x512.
Paint the hilt wrap in neutral light grey so it can be tinted with the player color.
```

---

## 6. 接進遊戲時要做的事（尚未實作）

* 對刀場：`drawBlade` 有對應的 `top/<id>.png` 時改畫圖片（依觸及半徑縮放、旋轉），柄卷遮罩以玩家色 `multiply` 上色；沒有圖時沿用現在的程式剪影。
* 特效：`consumeEvents` 依事件播放對應的序列圖（加算合成），沒有圖時沿用現在的程式特效。
* 側視：`bladeSvg` 改用底圖＋程式疊加刃文・地鐵模樣・瑕疵。
* 圖片要預載，載入失敗一律退回程式繪製，不影響遊戲進行。
