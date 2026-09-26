# sprite 規格

敵人（6×8）與玩家操作角色（6×10）兩套。行的意義不同，生成時**不要混在同一個會話**。

設計文件：`docs/superpowers/specs/2026-09-21-midnight-sprite-combat-design.md`

## sheet 佈局（敵人）

- 橫 6 幀 × 縱 8 動作的單張 PNG
- 縱向列順序（**不可更動**，與 `static_src/enemy_sprite_data.js` 的 `row` 一一對應）：
  0 待機／1 直線／2 範圍／3 突刺／4 重砸／5 單擊／6 受擊／7 死亡
- 各列的動作內容（2026-09-23 使用者明確規格，`sprite_prompt.js` 的 `ROWS` 與此一致）：

  | 列 | id | 內容 |
  | --- | --- | --- |
  | 0 | idle | 待機循環 |
  | 1 | line | 直線遠程：沿直線延伸出去的吐息／光束／波 |
  | 2 | area | 大範圍橫掃 |
  | 3 | thrust | 向前突刺 |
  | 4 | slam | **跳起後重砸地面**（中段影格在空中，最後幾格是落地衝擊＋裂地揚塵） |
  | 5 | single | **遠程 shoot**：瞄準單一遠方目標射出一發飛行道具，不進近身 |
  | 6 | hurt | 受擊後仰 |
  | 7 | death | 倒地死亡 |

  1 與 5 都是遠距離，差別在「沿直線延伸的持續效果」對「單發瞄準射擊」——prompt 必須寫清楚，
  否則生成端會把兩列畫成同一種東西。
- 背景透明
- 角色一律**朝左**繪製（朝右由 CSS `scaleX(-1)` 翻轉）
- 單格為正方形。尺寸暫定 128×128（sheet 768×1024），階段 2 由第一組實圖定案後回填此處

## 每行第一格＝前搖（2026-09-21 使用者明確規格）

**每一行的第 1 格（最左）只畫前搖，不畫招式圖。**

- 前搖＝動作發生之前的蓄力姿勢：武器向後拉、重心下沉、張口、魔力只聚在手上。
- 第 1 格不得出現任何「招式已經發生」的東西：刀光、武器殘影、飛行道具、光束、
  槍口閃光、魔法陣、衝擊波、揚塵、命中閃光。
- 招式圖從第 2 格開始出現，在第 4~5 格達到最大。
- 待機行的第 1 格是中立站姿；受擊／死亡行的第 1 格是身體還沒反應的前一瞬間。

理由在判定層：`enemy_sprite_data.js` 的 `hitFrame` 是 3~4，第 1 格必定落在前搖之中。
若第 1 格就畫出招式，玩家看到的是「已經打到了」，設計文件 §8.1 的「前搖 0.4~0.7 秒之內
讀招並按下迴避」就不成立。`sprite_anim_check.js` 會檢查 `hitFrame` 不為 0，
`sprite_prompt.js` 的 `FRAME_RULE` 則把同一條規則寫進生成 prompt，兩邊成對。

## 畫風（2026-09-21 使用者提供參考圖後細化）

參考圖：持大鐮刀的羊頭惡魔立繪（使用者提供）。60 組必須是同一個畫風，所以 prompt 骨架
集中寫在 `tools/sprite_check/sprite_prompt.js` 的 `STYLE` 常數——**不要在個別 sheet 上
另外加畫風詞**，那正是畫風散掉的起點（spec §11）。

要的：

- 手繪感的**抗鋸齒**點陣圖，有柔和的 dither 漸層與 sub-pixel 上色
- 描邊是暗赭色（umber），**不是純黑**，而且在受光面會變細或斷開
- 左上單一暖色光源，陰影偏冷色
- 低彩度土系配色：黃土／褐／赭的本體，奶白的毛髮，灰紫的金屬
- 誇張但好讀的剪影：頭、角、武器放大，四肢細長
- 角色佔單格高度約 80%、置中

不要的（多數生成服務一聽到 pixel art 就會端出來的東西）：

- 硬邊 1-bit、NES 風的平塗
- 純黑描邊
- 高彩度
- 現代 flat-vector 風的「假點陣圖」
- 接地影、背景物件、外框、文字
- 同一張 sheet 裡各格的色調不一致

**實務建議**：除了上面這段文字 prompt，直接把參考圖當作 style reference／image prompt
一併餵給生成服務，60 組之間的同一性會穩定很多。文字描述能鎖住的只有大方向，
線寬與色階這種細節還是靠圖對圖最準。

## 玩家操作角色 sheet（2026-09-24 使用者明確規格）

敵人 sheet 是 6×8、行的意義固定在 `enemy_sprite_data.js` 的 `ANIMS`。**玩家角色是另一套**，
不要跟敵人版混在同一個會話裡生成。

- 橫 **6** 幀（跟敵人版相同，第 1 格一樣是前搖）× 縱 **10** 動作
- 縱向列順序（使用者指定，以追蹤者為例）：

  | row | 意義 | 是否逐角色不同 |
  | --- | --- | --- |
  | 0 | 待機 | 否 |
  | 1 | 迴避（翻滾／墊步／瞬移…） | **是** |
  | 2 | 受擊 | 否 |
  | 3 | 死亡 | 否 |
  | 4 | 1hit（基本攻擊） | **是**（揮／刺／射／施法都有） |
  | 5 | 2hit／蓄力 | **是**（不一定是 row 4 的加重版） |
  | 6 | 致命一擊 | **是**（橫砍／直戳／連斬…） |
  | 7 | 能力（被動） | **是** |
  | 8 | 技能 | **是** |
  | 9 | 技藝 | **是** |

  2026-09-24 第二版：初版是 13 行（多了 跳躍攻擊／遠程／防禦）。使用者重送追蹤者行序時
  把那三行拿掉，因此縮成 10 行。已寫好的那三行描述保留在 `sprite_prompt.js` 的
  `PLAYER_ROW_ART`（`jump`／`ranged`／`guard` 欄位）但不再輸出，要加回來不必重問角色。

- 畫風契約與敵人版**完全相同**（配色、光源、描邊、佔格高度），只有兩處必須換：
  版面 `6 columns x 8 rows` → `6 columns x 10 rows`；剪影那一句原文是寫給怪物的
  「oversized head, horns and weapon」，玩家角色是人型、沒有角，改成人型英雄的講法。
  兩者站在同一個畫面上，其餘全部照舊才不會像兩套素材。

- **朝向是唯一的例外（2026-09-25 實測）**：2026-09-24 產出的那一批玩家圖全部是**朝右**
  （箭矢、火球、刀光都往右飛），跟敵人版的朝左相反。戰鬥畫面是「玩家在左、敵人在右」
  （見下方 §接入），所以這個朝向剛好讓兩邊自然對望，`midnight_player_sprite.js` 因此
  **不做 `scaleX(-1)` 翻轉**。若之後重新生成玩家圖，要嘛維持朝右，要嘛同時改渲染器——
  兩者必須成對，否則角色會背對敵人。

- prompt 產生：
  ```
  node tools/sprite_check/sprite_prompt.js --format=player-preamble   # 會話最初貼 1 次
  node tools/sprite_check/sprite_prompt.js --format=player            # 1 角色 1 則訊息
  ```
  武器／盾／被動／技能／技藝的**名稱**由 `character_types.js` 讀出，不另抄一份；
  「這一招畫成什麼樣子」是美術判斷、資料推不出來，因此留 `<...>` 佔位由人填，
  填好的寫回 `sprite_prompt.js` 的 `PLAYER_ROW_ART`（追蹤者已有完整範本）。

### 已知風險：多行單張

敵人版只有 8 行就已經會遇到「行が 7 本しか描かれていない」（見下方疑難排解表）。玩家版
10 行比它更高，仍要在切片時確認 `--row-bands`。初版的 13 行風險更大，縮到 10 行之後已經
緩解不少，但第一批實圖回來時仍要先數行數再繼續。

## 命名

- 一般敵人（系統的代表圖，同系統共用）：`family_<familyId>_a.png` ／ `family_<familyId>_b.png`
- 個別敵人專屬圖：`enemy_<familyId>_<enemyId>.png`
- 夜王：`boss_<bossId>.png`
- 玩家操作角色：`player_<typeId>.png`（`typeId` は `character_types.js` の id）
- 放置位置：`static_src/images/sprites/`（敵人・玩家とも同じ場所。行数はファイル名の
  `player_` 接頭辞で見分ける——`sprite_verify.js` の `rowsOf()`）

### 什麼時候該用 `enemy_*`（2026-09-23）

`sheetIdForEnemy()` 會優先回傳專屬圖，未產出時退回系統圖。新增專屬圖時：

1. 若這隻是該系統變體的**唯一成員**，或該變體**還沒有圖**
   → 不要開專屬 sheet，直接把圖放進系統 sheet（`family_*`）。
   否則同一張絵會存成兩份，而且系統 sheet 會變成沒有任何敵人引用的死檔。
2. 其餘情況（系統圖已經是別隻敵人的絵）→ 在
   `tools/sprite_check/sprite_registry_gen.js` 的 `ENEMY_OWN` 加入
   `"<familyId>/<enemyId>"`，重新產生登錄表。

系統 sheet 仍然是全系統成員的代役來源，所以 `sprite_prompt.js` 產生系統 sheet 的
prompt 時，成員一覽仍包含已有專屬圖的敵人。

## 驗收流程

1. `node tools/sprite_check/sprite_prompt.js <sheetId>` 取得該組的生成 prompt
2. 在外部服務生成，用 `sprite_sheet_relay.js` 切成規格 sheet（見下）
3. `node tools/sprite_check/sprite_verify.js` 檢查檔名在登錄表內、為合法 PNG、寬高可整除為 6×8 的正方格
4. `node tools/sprite_check/sprite_pack.js --write` 把登錄表的 `available` 更新為 true
5. `py -3 generate.py` 重新建置

### 取材（`sprite_sheet_relay.js`）的預設與例外

一般情況：

```bash
node tools/sprite_check/sprite_sheet_relay.js <src.png> 6 8 <sheetId> --rows=detect --cols=detect --cell=fit
```

生成物的行通常不是等間隔（絵が上下へはみ出す）ので、等分割ではなく偵測に任せる。

**偵測が壊れる場合**（2026-09-23 のバッチで 3 枚）：

| 症状 | 対処 |
| --- | --- |
| 行が 7 本しか描かれていない | `--row-bands=` で 8 本を直に指定。足りない動作は他の行と同じ範囲を 2 度書いて使い回す |
| 隣り合う行が接していて切れ目が見えない | `--row-bands=` で内側の切れ目を自分で決める |
| 規格外の行が 1 本余分 | `--drop-row=N`（偵測は成功している場合） |
| 行の順序が規格と違う | `--row-order=`（同上） |

`--row-bands=` は偵測を完全に置き換えるので、`--drop-row=` ／ `--row-order=` が効かない
（＝偵測そのものが壊れている）ときの最後の手段。

**切り終わったら必ず `sprite_verify.js` の警告を見る。**「極端に薄い格」が出ていたら
行の切り方を間違えている可能性が高い——寸法だけでは、刀先だけの帯を 1 行として
切ってしまった sheet が素通りする。

## 玩家 sheet の切り出し実績（2026-09-25、`photo/enemyPic/0924/`）

登錄表は自動生成：

```bash
node tools/sprite_check/sprite_player_registry_gen.js --write   # static_src/player_sprite_registry.js
node tools/sprite_check/sprite_verify.js                        # 6x10 として検査される
node tools/sprite_check/sprite_pack.js --write                  # available を更新（敵人・玩家の両方）
```

切り出しは敵人版と同じ `sprite_sheet_relay.js` に **`--dst-rows=10`** を足すだけ。

### 生成物が 2 バッチに分かれていた

| バッチ | 寸法 | 1 格 | 行数 | 角色 |
| --- | --- | --- | --- | --- |
| A | 971×1620 | 162×162（正方） | **10**（規格どおり） | 追跡者・學者・守護者・鐵眼・無賴漢・隱者 |
| B | 1086×1448 | 181×145 | **12** | 執行者・復仇者・淑女・葬儀 |

B バッチの 12 行は、2026-09-24 第二版で削った 13 行版の名残で、規格の 10 行に
**`jump`（跳躍攻擊）と `ranged`（遠程）が 1 本ずつ混ざっている**。帯の順序は

```
0 待機 / 1 迴避 / 2 受擊 / 3 死亡 / 4 1hit / 5 2hit /
6 跳躍攻擊(規格外) / 7 致命一擊 / 8 能力 / 9 技能 / 10 技藝 / 11 遠程(規格外)
```

なので `--row-order=0,1,2,3,4,5,7,8,9,10` で 6 と 11 を落とす。

実際に使ったコマンド（透明が市松として焼き込まれている ctype=2 の画像は先に
`sprite_dechecker.js` を通す。鐵眼だけは最初からアルファ付きなので素通し）：

```bash
# A バッチ（偵測に任せて 10 帯。無賴漢・隱者は隣接行が 1 か所くっついているが自動分割で足りる）
node tools/sprite_check/sprite_dechecker.js photo/enemyPic/0924/追跡者.png clean/tracker.png
node tools/sprite_check/sprite_sheet_relay.js clean/tracker.png 6 10 player_tracker --dst-rows=10 --rows=detect --cols=detect

# B バッチ（規格外の 2 行を落とす）
node tools/sprite_check/sprite_sheet_relay.js clean/lady.png 6 10 player_lady   --dst-rows=10 --rows=detect --cols=detect --row-order=0,1,2,3,4,5,7,8,9,10

# 執行者だけは帯 9 に 技能＋技藝 がくっついて 1 本に見える（11 帯しか検出されない）ので
# --row-bands= で 1194 のあたりを自分で割る
# 2026-09-25 修正：旧値 15-133,173-241,... は帯を絵の上下端ぎりぎりに取っていて、迴避 1・6 幀目の
# 立ち姿の頭が切れていた。帯の境目を行間の谷（ink≒0 の y）の中央に取り直した。
# 帯 6（跳躍攻擊）と帯 11（遠程）は規格外なので帯の外に残してある。
node tools/sprite_check/sprite_sheet_relay.js clean/executor.png 6 10 player_executor --dst-rows=10 --cols=detect   --row-bands=0-146,147-261,262-406,407-496,497-625,626-748,870-978,979-1091,1092-1194,1195-1303
```

**復仇者は `--keep-inner` が要る。** この角色は白銀の衣で、`sprite_dechecker.js` の
「明るい無彩色＝市松」という判定が衣そのものを食う。`--keep-inner`（外周と繋がっていない
明色は本体として残す）を付けても、まだ衣に半透明の抜けが残っている——B バッチのままで
使うならここが既知の劣化点で、971×1620 で生成し直すのが本筋。

## 玩家 sprite の接入先（2026-09-25）

| 層 | ファイル |
| --- | --- |
| 資料（動作時間軸） | `static_src/player_sprite_data.js`（`window.PriTestPlayerSprite`） |
| 登錄表 | `static_src/player_sprite_registry.js`（自動生成） |
| 表現 | `static_src/midnight_player_sprite.js`（`window.PriTestMidnightPlayerSprite`） |
| 接線 | `static_src/midnight.js` の `playMySpriteAnim()`／`updatePlayerSprites()` |
| 版面 | `static_src/style.css` の `#midnight-player-sprite-stage` |
| 回歸測試 | `tools/midnight_check/player_sprite_check.js` |

- 表示は `meta.spriteMode`（點陣圖模式）の房間のみ、かつ戰鬥中（`activeEncounter`）のみ。
- 同房全員を敵人插圖の**左寄り**に横排（使用者明確規格 2026-09-25）。插圖の枠の外には
  出せない——祖先の `#midnight-hud-bottom-center` が `overflow-x: hidden` なので、
  外へ出した面は丸ごと切り落とされる。
- 動作の同期は `character/<tokenId>/_spriteAnim = { id, n }` の**通し番号**だけ。
  受擊と死亡は同期しない（HP＝`demoStats` と `nearDeath` が既に全端に届いているので、
  各端がその変化を見て鳴らす）。

## 變體角色的專屬 sheet（2026-09-26，追蹤者（暗黑））

素材：`photo/enemyPic/0926/追跡者_暗黑.png`（1024×1536、RGB）。跟 0924 批的形式完全不同：

- 背景是**深藍黑實底**（約 6,13,15），不是市松 → `sprite_dechecker.js` 不適用
- 左側 x<180 有「0 待機」之類的行號與說明文字，行與行之間有 1~2px 分隔線
- 每行幀數不一（待機 6／1hit・2hit・致命一擊・技能 5／技藝 3 幀＋一整團爆炎），
  刀光與揚塵把相鄰幀連成一塊 → `sprite_sheet_relay.js` 的偵測切不出 6 欄

處理（兩支新工具）：

```bash
# 1. 剝暗底＋刪標籤＋刪分隔線（標籤只刪「整塊落在 x<180」的連通塊，連著本體的劍尖保留）
node tools/sprite_check/sprite_debg_dark.js photo/enemyPic/0926/追跡者_暗黑.png clean/tracker_dark.png --label-x=180
# 2. 依規格檔逐格切割（切點由人看圖決定）
node tools/sprite_check/sprite_sheet_cells.js clean/tracker_dark.png tools/sprite_check/cells/player_tracker_dark.json
```

`cells/player_tracker_dark.json` 的決定：

- 格子 240px：本體 sheet 的待機人物約佔格高 0.51~0.57，暗黑版待機高 131px → 240。
  不照 relay「最大的絵決定格子」，否則爆炎會把格子撐大、人物在畫面上縮小一倍多。
- 每行以原圖分隔線的 y 當地面，整行共用；不逐幀拉到地面（能力行的空翻要保持離地）。
- 幀數不足的行，最後一幀重複（停格）。
- 技藝行 4~6 幀：爆炎一團寬 440px，以 240px 視窗由左往右掃過（576／680／783 起），
  呈現「爆炸往前方推進」。超出格子的部分裁掉。

登錄：`sprite_player_registry_gen.js` 的 `VARIANT_OWN` 加 `tracker_dark: true` → 重新產生登錄表。
其他 `_dark`／`_dawn` 變體仍共用素體 sheet。

### 守護者（黎明）（2026-09-26）

素材：`photo/enemyPic/0926/守護者_黎明.png`（1024×1536、RGB、暗底，形式同追蹤者（暗黑））。

```bash
node tools/sprite_check/sprite_debg_dark.js photo/enemyPic/0926/守護者_黎明.png clean/guardian_dawn.png --label-x=180 --soft-depth=3
node tools/sprite_check/sprite_sheet_cells.js clean/guardian_dawn.png tools/sprite_check/cells/player_guardian_dawn.json
```

- **`--soft-depth=3` 是必要的**：盔甲是暗灰藍色，跟背景同屬冷色系，`WARM` 判定擋不住，
  不限深度時整個身體被吃成半透明。
- 原圖有 **11 行**（0~10）。行的對應（2026-09-26 使用者明確規格「7取消，8為能力，9為技能，10為技藝」）：

  | sheet 行 | 意義 | 原圖行 |
  | --- | --- | --- |
  | 0~6 | 待機～致命一擊 | 0~6（照搬） |
  | 7 | 能力 | 8（盾牌光芒擴散） |
  | 8 | 技能 | 9（斧頭旋風） |
  | 9 | 技藝 | 10（禁忌：張翼飛升後猛擊） |

  原圖第 7 行（盾牌蓄力發光）不使用。
- 格子 240px：技藝行（原圖 10）每幀高約 240px，224 會裁掉一大截；240 時待機佔格高 0.51，
  剛好與本體守護者相同。技藝行下方沒有分隔線，地面取爆炎的底部 y=1515，前兩幀的飛升姿勢保持離地。
- 第 0 行 6 幀，其餘 5 幀＋停格。

### 淑女（黎明）（2026-09-26）

素材：`photo/enemyPic/0926/淑女_黎明.png`（1224×1285、RGB、暗灰底 約 18,20,22，行間分隔線極淡）。

```bash
node tools/sprite_check/sprite_debg_dark.js photo/enemyPic/0926/淑女_黎明.png clean/lady_dawn.png \
  --label-x=220 --flood=4 --soft-depth=2 --ghost=565-1223:1115-1284
node tools/sprite_check/sprite_sheet_cells.js clean/lady_dawn.png tools/sprite_check/cells/player_lady_dawn.json
```

- **`--flood=4`**：本體是暗灰色，與背景的色差很小，預設 12 會把身體挖出洞。背景雜訊實測只有 0~3。
- **`--label-x=220`**：技藝行的說明「自身下降實體的透明度」超出 x=200。
- **`--ghost=`**：技藝行「揮動披風並且自身下降實體的透明度」的 3~6 幀是逐漸變透明的殘影。
  一般處理會把它變成不透明的黑影，所以在該矩形內改成「色差＝不透明度」（色差 40 以上不透明）。
- 格子 208px（待機佔格高約 0.53，與本體淑女 0.54 相近）。受擊行 5 幀＋停格，其餘 6 幀。
- 2hit 行第 3 幀的刀光尾巴伸到 x≈745，切點放在 750（切在 680 會把刀光尾巴分到第 4 格）。

### 鐵眼（暗黑）（2026-09-26）

素材：`photo/enemyPic/0926/鐵眼_暗黑.png`（1024×1536、RGB、深藍底＋分隔線，形式同追蹤者（暗黑））。

```bash
node tools/sprite_check/sprite_debg_dark.js photo/enemyPic/0926/鐵眼_暗黑.png clean/iron_eye_dark.png \
  --label-x=180 --soft-depth=3 --ghost-full=24 \
  --ghost=700-1023:540-666 --ghost=720-1023:672-817 --ghost=780-1023:822-969 \
  --ghost=300-1023:975-1133 --ghost=480-1023:1138-1275 --ghost=320-1023:1280-1535
node tools/sprite_check/sprite_sheet_cells.js clean/iron_eye_dark.png tools/sprite_check/cells/player_iron_eye_dark.json
```

- 本體是暗灰褐色：不限 soft 深度時全身透底，所以 `--soft-depth=3`。
- 但這樣一來鷹眼光暈、蓄力箭、射擊光束周圍的暗煙會變成大塊黑底 → 特效區域另外用 `--ghost=`
  （色差＝不透明度）。區域內的本體也會跟著變淡，`--ghost-full=24`（預設 40）是兩者的折衷。
- 格子 232px（待機佔格高約 0.59，與本體鐵眼 0.60 相同）。
- 幀數：待機・受擊・死亡 6 幀，其餘 5 幀＋停格；技藝只有 2 幀＋一整道光束。
- 1hit 第 5 幀（飛行中的箭）與 2hit 第 5 幀（命中的光圈）比格子寬，視窗取右側（保住箭頭與光圈）。
- 技藝 3~6 幀：光束寬約 520px，以 232px 視窗由左往右掃過（499／596／690／785 起），呈現射擊往前推進。

### 無賴漢（暗黑）（2026-09-26）

素材：`photo/enemyPic/0926/無賴漢_暗黑.png`（1024×1536、RGB、深藍底＋分隔線）。

```bash
node tools/sprite_check/sprite_debg_dark.js photo/enemyPic/0926/無賴漢_暗黑.png clean/ruffian_dark.png --label-x=215 --soft-depth=3
node tools/sprite_check/sprite_sheet_cells.js clean/ruffian_dark.png tools/sprite_check/cells/player_ruffian_dark.json
```

- 原圖有 **11 行**（0~6、「7」兩次、8、9），而且**標籤比圖往下錯一行**。依**圖的內容**對應：

  | sheet 行 | 意義 | 原圖（上數第幾帶，0 始） | 圖的內容 |
  | --- | --- | --- | --- |
  | 0~6 | 待機～致命一擊 | 0~6 | 照搬 |
  | —— | 不使用 | 7（標籤「7 能力」） | 高舉特大武器砸地（像跳躍攻擊的續招） |
  | 7 | 能力 | 8（標籤「7 技能」） | 白色護盾展開後消散 |
  | 8 | 技能 | 9（標籤「8 技藝」） | 吼叫腳踩地板、環狀衝擊 |
  | 9 | 技藝 | 10（標籤「9 技藝」） | 蹲下炸出巨大岩壁 |

- `--label-x=215`：「前方」「大」兩字在 x=200 附近與分隔線殘片相連，200 刪不掉。
- 格子 208px（待機佔格高約 0.62，與本體無賴漢 0.62 相同）。
- 技藝行下方沒有分隔線，地面取岩壁底部 y=1519。

### 送葬人（黎明）（2026-09-26）

素材：`photo/enemyPic/0926/葬儀屋_黎明.png`（971×1619、RGB、深藍灰底＋分隔線）。

```bash
node tools/sprite_check/sprite_debg_dark.js photo/enemyPic/0926/葬儀屋_黎明.png clean/undertaker_dawn.png --label-x=175 --dark-ink
node tools/sprite_check/sprite_sheet_cells.js clean/undertaker_dawn.png tools/sprite_check/cells/player_undertaker_dawn.json
```

- 本體是白袍（暖色），預設設定即可。
- **`--dark-ink`**：能力「四周展開黑色翅膀」、技藝「展開黑色翅膀旋轉刺向前方」的羽毛比背景（14,17,20）更暗，
  色差只有 12~15，不加這個選項會被當成背景整片吃掉。加了之後，比背景暗的像素以
  alpha＝1−亮度/背景亮度 還原成半透明的黑。分隔線上下 2px 不套用（線的陰影會變成細黑線）。
- 格子 272px（待機佔格高 0.48，與本體送葬人 0.47 相同——本體這隻本來就畫得比較小）。全部 10 行都是 6 幀。
- 致命一擊第 6 幀原圖就只有飛出去的棍棒（沒有人物），照原樣保留。

### 執行者（暗黑）（2026-09-26）

素材：`photo/enemyPic/0926/執行者_暗黑.png`（1024×1536、RGB、深藍底＋分隔線）。

```bash
node tools/sprite_check/sprite_debg_dark.js photo/enemyPic/0926/執行者_暗黑.png clean/executor_dark.png \
  --label-x=180 --label-box=0-184:1170-1245 --soft-depth=3 --ghost-full=24 \
  --ghost=560-1023:667-813 --ghost=250-1023:817-959 --ghost=255-1023:964-1115 \
  --ghost=300-1023:1119-1259 --ghost=265-1023:1263-1432
node tools/sprite_check/sprite_sheet_cells.js clean/executor_dark.png tools/sprite_check/cells/player_executor_dark.json
```

- **`--label-box=`**：技能行的說明「閃橘黃光居合斬」末尾（x≈184）緊貼第 1 幀人物（x≈186），
  連通塊判定刪不掉，改用矩形直接清空。
- 橘黃色的刀光、妖狐、變身火焰周圍的暗煙：比照鐵眼（暗黑）用 `--ghost=`＋`--ghost-full=24`。
- 格子 264px（待機佔格高 0.50，與本體執行者相同）。技能行 5 幀＋停格，其餘 6 幀。
- 致命一擊／能力行的第 1 格切點放在 256（人物右端 255）；262 會混入第 2 幀的刀光碎片。

### 學者（暗黑）（2026-09-26）

素材：`photo/enemyPic/0926/學者_暗黑.png`（1024×1536、RGB、深藍底＋分隔線）。

```bash
node tools/sprite_check/sprite_debg_dark.js photo/enemyPic/0926/學者_暗黑.png clean/scholar_dark.png \
  --label-x=175 --label-box=0-163:1415-1432 --ghost-full=24 \
  --ghost=400-1023:814-976 --ghost=300-1023:980-1132 --ghost=300-1023:1136-1280 --ghost=300-1023:1283-1535
node tools/sprite_check/sprite_sheet_cells.js clean/scholar_dark.png tools/sprite_check/cells/player_scholar_dark.json
```

- 本體是暖色長袍，soft 深度不用限制（預設即可）。
- `--label-box=`：技藝行的說明「身後產生懷錶圓盤」的「圓盤」與第 1 幀的劍尖相連。
- 致命一擊～技藝的爆炸、閃光、懷錶圓盤周圍的暗煙用 `--ghost=`＋`--ghost-full=24`。
- 格子 256px（待機佔格高 0.51，與本體學者 0.52 相同）。
- 致命一擊：第 1〜2 幀之後是一整片寬約 610px 的爆炸（炎雷聖魔等塵暴），以 256px 視窗由左往右掃過
  （409／535／655／768 起）。
- 能力第 4 幀的書本伸進第 5 幀的爆炸裡，切點放在 765（747 會把書切掉一半）。
- 能力、技能、技藝各 5 幀＋停格，其餘 6 幀。技藝行下方沒有分隔線，地面取第 1 幀腳底 y=1457。

### 復仇者（暗黑）（2026-09-26）

素材：`photo/enemyPic/0926/復仇者_暗黑.png`（1024×1536、RGB、偏青的深色底 約 1,12,13＋分隔線）。

```bash
node tools/sprite_check/sprite_debg_dark.js photo/enemyPic/0926/復仇者_暗黑.png clean/avenger_dark.png \
  --label-x=190 --label-box=0-212:1399-1417 --soft-depth=3 --ghost-full=24 \
  --ghost=300-1023:818-976 --ghost=300-1023:979-1132 --ghost=450-1023:1136-1295 --ghost=450-1023:1298-1461
node tools/sprite_check/sprite_sheet_cells.js clean/avenger_dark.png tools/sprite_check/cells/player_avenger_dark.json
```

- 黑色長裙（約 22,22,23）與偏青的背景主要靠 R 通道區分（差約 20），預設 flood=12 就分得開；
  裙子不是暖色，所以要 `--soft-depth=3`。
- 黃金圖紋、豎琴光弦、白色煙霧用 `--ghost=`。光暈周圍仍留一圈暗色（與裙子色差相近，
  再提高 `--ghost-full` 裙子會變透明），當作暗黑系的氣場保留。
- `--label-box=`：技藝行說明末尾「色煙霧」與第 1 幀人物相連。
- 翻滾行下方的分隔線（y 276〜277）比偵測到的線（274〜275）低一點、沒被清掉，而且與煙塵相連；
  cells 的各行範圍取「線的下一行 +3 ～ 下一條線 −1」，把線排除在外。
- 格子 240px（待機佔格高 0.55，與本體復仇者相同）。
- 技藝：2 幀＋白色煙霧中的 2 個姿勢；煙霧中的第 1 個姿勢寬 334px，取以人物為中心的 240px 視窗。
  第 4 格之後停格。翻滾、致命一擊、能力、技能 5 幀＋停格。

### 隱者（黎明）（2026-09-26）

素材：`photo/enemyPic/0926/隱者_黎明.png`（1024×1536、RGB、深色底＋分隔線）。

```bash
node tools/sprite_check/sprite_debg_dark.js photo/enemyPic/0926/隱者_黎明.png clean/hermit_dawn.png \
  --label-x=170 --lines=56,149,270,323,402,532,666,810,813,952,1110,1269 \
  --label-box=0-206:1203-1225 --label-box=0-205:1369-1387
node tools/sprite_check/sprite_sheet_cells.js clean/hermit_dawn.png tools/sprite_check/cells/player_hermit_dawn.json
```

- **`--lines=` 是必要的**：藍紫色特效（順移殘影、藍光、隕石、藍色雨片、星痕）符合「偏藍的中間灰」，
  自動偵測會把特效所在的整段 y 當成分隔線，清掉 40 萬 px。分隔線的 y 由「整列 B−R 平均值的局部峰」
  找出（149〜1269），另外加上待機／受擊行穿過人物的淡色裝飾線（56、323）與 810 線的下緣（813）。
- `--label-box=`：技能行「向前方」、技藝行「色枝斑」與人物／法杖相連。
- 本體是暖色紅袍，soft 深度不限；藍紫特效的暗部自然成為半透明，不需要 `--ghost=`。
- 格子 232px（待機佔格高 0.63，與本體隱者 0.64 相近）。
- 1hit 最後的藍光飛彈、技藝最後的紅色技枝圖騰比格子寬，各取以飛彈頭／人物為中心的 232px 視窗。
- 待機、受擊、死亡 6 幀；順移、1hit、2hit、致命一擊、能力、技能 5 幀＋停格；技藝 4 幀＋停格。
