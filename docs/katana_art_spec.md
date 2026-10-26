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

## 6. 接進遊戲時要做的事

**2026-10-21 已接上（第一批：太刀 `tachi` 的俯視＋側視）**：

* 素材放在 `static_src/katana_art/{top,side}/<id>.png`，`generate.py` 整個複製到 `dist/static/katana_art/`。
  原圖（`photo/tmp/katana/tachi_upon.png`、`tachi_side.png`，透明背景）先整理成規格位置：俯視圖把鍔移到正中央、刀尖在中心右方 45%，輸出 768×768；側視圖裁到不透明範圍、寬 1024。
* `katana.js`：`ART_TOP`（刀種 → 刀尖比例）／`ART_SIDE` 登記有哪些圖；`drawBlade` 有圖就畫圖（依觸及半徑縮放、旋轉，外加玩家色光暈，因為美術刀身比程式剪影細），柄卷的淺灰換成玩家色（`artTopTinted`，依圖＋顏色快取）；載入中或失敗時沿用程式剪影。對刀面板在刀名旁顯示側視小圖（只有自己刀種有圖時）。
* 借圖（下面那條）已實作在 `artTopId`：目前只有太刀的圖，所以**所有刀在對刀場都會用太刀的圖演出**，靠柄色與光暈分辨。之後補上其他刀種的圖就會自動換回各自的圖。
* artifact 預覽版用 `window.PRITEST_KATANA_ART_SRC = { "top/tachi": dataURI }` 覆寫圖片來源。

**2026-10-25 第二批：短刀 `tanto` 的俯視＋側視**：

* 原圖 `photo/tmp/katana/tanto_upon.png`（1254×1254）、`tanto_side.png`（1536×1024，原為 webp）已是透明背景，但外圍有一層 alpha < 32 的淡霧，整理時清成全透明。
  俯視圖依同樣規格輸出 768×768（柄的中線本來就水平，不需轉正）；側視圖裁切後為 1024×116。
* `ART_SIDE` 的值改成「鍔（無鍔時為鎺）中心佔圖寬的比例」（太刀 0.225、短刀 0.22）。刀視角（`katana_arena_pov.js` 的 `sideBlade`）
  原本把側視圖的長寬比與鍔位置寫死成太刀的 1024×144／0.225，改成讀圖片本身的尺寸與 `img.ktGuard`，之後各刀種長寬比不同也不會變形。
* 有圖的刀種有兩種後，「借圖」會從兩張中依刀固定抽一張（同分組優先：日本刀借太刀或短刀）。

**2026-10-25 第三批：脇差 `wakizashi`**，並把整理流程做成工具 `tools/katana_art/import_art.py`：

```bash
py -3 tools/katana_art/import_art.py <id> --top 俯視原圖 --side 側視原圖 [--halo 90] [--tip 0.38] --preview 檢查圖.png
```

* 鍔＝不透明高度最大的欄（鐵鍔、金鍔都適用，不再依顏色找）；水平以柄的中線為準（有反り的刀刀尖本來就不在中線上，不能用刀尖定水平）。
  原圖另存到 `photo/tmp/katana/<id>_upon.png`／`<id>_side.png`，並印出 `ART_SIDE` 要填的鍔比例。
* 脇差側視原圖刀身外有一圈 alpha 30〜75 的白色光暈（去背殘留的柔和陰影），在深色背景會很明顯：加 `--halo 90`
  （alpha < 90 清掉，其餘拉伸回 0〜255，保留邊緣抗鋸齒）。之後的圖先看 `--preview` 的深色底檢查圖再決定要不要加。
* 短刀也改用這支工具重新整理（結果與手工版只差柄的 1.3° 傾斜）。

以下是原本的規劃（特效、切入圖、審查畫面的側視底圖尚未實作）：


* `generate.py` 複製 `static_src/katana_art/`。
* 對刀場：`drawBlade` 有 `top/<id>.png` 時改畫圖片（依觸及半徑縮放、旋轉；1024 圖的中心＝旋轉中心），把接近 `#C8C8C8` 的柄卷像素換成玩家色；沒有圖時沿用程式剪影。
* 特效：`consumeEvents` 依事件以加算合成播放 `vfx/<id>.png`（放大＋淡出），沒有圖時沿用程式特效。
* 切入圖：覺醒招式發動的橫幅改用 `cutin/<id>.png`，左側寫招式名。
* 側視：`bladeSvg` 改用 `side/<id>.png` 底圖＋程式疊加刃文・地鐵模樣・瑕疵。
* **素材不齊時**（使用者指定 2026-10-20）：某個刀種還沒有圖時，從已經有圖的刀種中隨機借一張來演出（同分組優先；同一場對局中同一把刀固定用同一張）。一張圖都沒有時才退回程式繪製。特效、切入圖同理。
* 圖片要預載，載入失敗一律退回程式繪製，不影響遊戲進行。
