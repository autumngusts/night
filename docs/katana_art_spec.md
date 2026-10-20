# 神前鍛刀對決 美術素材規格（給 GPT 等生成工具）

目前遊戲裡的刀與特效全部由程式繪製：審查・刀鞘用側視 SVG（`bladeSvg`），對刀場用俯視剪影（`drawBlade`）。本文件說明要另外製作美術時，交給生成工具的資料與交付格式。

**實際要用的是手冊頁 `docs/katana_art_prompts.html`**（瀏覽器直接打開）：每張圖一張卡片，有參考圖、一鍵複製的提示詞、要選的尺寸與背景、存檔名稱與檢查清單。本文件是它背後的規格說明。

---

## 0. 第二版的改動（2026-10-20，依實測結果）

第一版用 GPT 產出的 `tanto` 測試圖（`static_src/images/tmp/tanto_game_assets.zip`）暴露了幾個問題，規格因此改成「生成工具確實做得到的」：

| 第一版要求 | 實測結果 | 第二版 |
| --- | --- | --- |
| 俯視圖鍔在正中央 | 整把刀置中，鍔偏左（x≈197／512） | 附遊戲畫的參考圖，十字線標中心、虛線圓標刀尖位置；提示詞明寫「鍔在中心，不是整把刀置中」 |
| 柄卷另出一張灰階遮罩 | 變成放大的彩色柄，還帶「（柄部）」字樣 | **不再做遮罩**；俯視圖的柄卷直接畫成淺灰 `#C8C8C8`，遊戲依灰色上玩家色 |
| 2048×512、512×512 | 生成工具不支援這些尺寸 | 只用 GPT 支援的 **1024×1024**（俯視・特效）與 **1536×1024**（側視・切入圖） |
| 透明背景 | 去背吃到刀身與刃文、邊緣有雜點 | 不能透明時改用純綠 `#00FF00` 再去背；提示詞要求刀身不透明 |
| 特效 8 格序列圖 | 生成工具很難畫出連續一致的格子 | **一張最強烈的瞬間**，純黑背景；放大・淡出由遊戲做 |
| 覺醒招式提示詞放招式說明 | 規則文字（「耐久回復 30%」）畫不出來 | 每個招式寫英文的視覺描述（`VFX_SPECIALS`） |

---

## 1. 產生方式

```bash
node tools/katana_art/export_manifest.js      # 遊戲資料 → docs/katana_art_manifest.json（提示詞）
py -3 generate.py
py -3 -m http.server 8944 --directory dist
node tools/katana_art/build_prompt_book.js    # 參考圖 docs/katana_art/ref/ ＋ 手冊頁 docs/katana_art_prompts.html
```

* 刀種的外觀（英文名・時代・拵・輪廓）寫在 `export_manifest.js` 的 `ART`；招式的視覺寫在 `VFX_CARDS`／`VFX_SPECIALS`／`COMMON_VFX`。新增刀種或招式而沒補這些表時，匯出會報錯停止。
* 參考圖用遊戲本身的繪圖輸出（`window.PriTestKatana._artRef`），所以參考圖的輪廓與位置就是遊戲裡的樣子。

---

## 2. 素材一覽與交付格式

| 種類 | 數量 | GPT 尺寸 | 背景 | 參考圖 | 存檔位置 |
| --- | --- | --- | --- | --- | --- |
| 俯視圖（對刀場） | 38 | 1024×1024 | 透明（或純綠再去背） | `docs/katana_art/ref/top/<id>.png` | `static_src/katana_art/top/<id>.png` |
| 側視圖（審查・刀鞘） | 38 | 1536×1024 | 透明（或純綠再去背） | `docs/katana_art/ref/side/<id>.png` | `static_src/katana_art/side/<id>.png` |
| 招式特效 | 51（招式卡 10＋覺醒 35＋共通 6） | 1024×1024 | 純黑 | 無 | `static_src/katana_art/vfx/<id>.png` |
| 覺醒招式切入圖 | 35 | 1536×1024 | 純黑 | 無 | `static_src/katana_art/cutin/<id>.png` |

### 俯視圖（辨識度最重要，建議先做）

* 正上方俯視、無透視、無陰影。**鍔（護手）在畫面正中央**；刀尖朝右、離中心約畫面寬 45%；柄朝左。
* 長柄兵器（薙刀・長卷・槍・陌刀・關刀）：**握持點在中心**，長柄往左，刀尖約在中心右方 38%。
* 柄卷畫成平塗淺灰 `#C8C8C8`，不要花紋顏色（遊戲依這個灰色換成玩家色）。
* 縮到 48px 仍要分得出刀種：彎直、寬窄變化、刀背環、波刃、長柄、護手形狀。
* 參考圖的十字線與虛線圓只是位置標記，不要畫出來。

### 側視圖

* 正側面、正交投影；刀尖朝右、柄在左；**單刃刀刃朝下、刀背朝上**（與遊戲 SVG 一致）。
* 差異淬火的刀種畫白色刃文帶；整體淬火的不畫。刀身必須完全不透明。
* 刃文、地鐵模樣、瑕疵是每把刀鍛出來才決定的，接進遊戲時仍由程式疊加。

### 招式特效

* 一張「最強烈的瞬間」，正上方俯視、置中、約佔畫面七成。
* **純黑背景**：遊戲用加算合成（`lighter`）疊上去，黑色等於透明。
* 不畫刀、人物、文字（居合的「斬」、看破的「見切」由遊戲寫）。主色照各招式的 `color`。

### 覺醒招式切入圖

* 橫幅，象徵圖樣放在右側 6 成，**左側 4 成留空**給遊戲寫招式名。純黑背景、沒有任何文字。

---

## 3. 提示詞的寫法

每段提示詞都是固定區塊（英文），GPT 比較不會漏條件：

```
Create ONE image: <主體>.
REFERENCE: <參考圖要照什麼>            ← 刀種才有
WEAPON / WHAT IT LOOKS LIKE: <外觀>
MUST BE CLEARLY VISIBLE: <辨識重點>
COMPOSITION: <位置・方向・取景>
OUTPUT: <尺寸・背景・不要的東西>
STYLE: <整組共用的畫風，一字不改>
```

畫風（整組固定，避免每張風格不同）：

* 刀：`Semi-realistic hand-painted game art. Crisp clean edges, polished steel with subtle blue-grey reflections, warm brass/gold fittings, soft light from the top-left.`
* 特效・切入圖：`Luminous Japanese ink-and-light style: a bright white-hot core, glow fading smoothly into the black, a few sharp brush-stroke accents.`

不符合時用一句英文修正即可，例如 `Redo it. The guard must be exactly at the center of the image.`、`Redo it with the hilt wrap in plain light grey.`。

---

## 4. 對刀中的辨識度原則

1. **剪影優先**：一眼分得出刀種（彎刀 vs 直劍、寬 vs 細、有無長柄、刀背環、波刃）。
2. **玩家色在柄**：柄卷的淺灰由遊戲換成玩家色，同刀種也分得出是誰的。
3. **分組有固定的拵風格**：日本刀＝圓鍔＋金色鎺；中華＝圓盤護手／環首；西洋＝十字護手；冷門＝各自特殊造型。
4. **招式顏色固定**：覺醒招式各有固定色（`D.SPECIALS[].color`），光環、斬痕、切入橫幅都用同色。

---

## 5. 選配：3D 模型

* glTF 2.0（.glb），單位公尺，原點在護手中心，**刀尖朝 +X、刀背朝 +Y**，刃朝 −Y。
* 網格分開：`blade`、`guard`、`hilt`（玩家色材質）、`pommel`，長柄兵器加 `shaft`。刀身 2〜5k tris、全體 15k 以下。
* PBR 2048²：BaseColor、Metallic/Roughness、Normal。尺寸照 manifest 的 `dims`。

---

## 6. 接進遊戲時要做的事（尚未實作）

* `generate.py` 複製 `static_src/katana_art/`。
* 對刀場：`drawBlade` 有 `top/<id>.png` 時改畫圖片（依觸及半徑縮放、旋轉；1024 圖的中心＝旋轉中心），把接近 `#C8C8C8` 的柄卷像素換成玩家色；沒有圖時沿用程式剪影。
* 特效：`consumeEvents` 依事件以加算合成播放 `vfx/<id>.png`（放大＋淡出），沒有圖時沿用程式特效。
* 切入圖：覺醒招式發動的橫幅改用 `cutin/<id>.png`，左側寫招式名。
* 側視：`bladeSvg` 改用 `side/<id>.png` 底圖＋程式疊加刃文・地鐵模樣・瑕疵。
* 圖片要預載，載入失敗一律退回程式繪製，不影響遊戲進行。
