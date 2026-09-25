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
node tools/sprite_check/sprite_sheet_relay.js clean/executor.png 6 10 player_executor --dst-rows=10 --cols=detect   --row-bands=15-133,173-241,271-383,434-484,507-618,634-746,879-969,986-1084,1098-1192,1196-1298
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
