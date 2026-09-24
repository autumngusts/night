# 敵人 sprite 規格

設計文件：`docs/superpowers/specs/2026-09-21-midnight-sprite-combat-design.md`

## sheet 佈局

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

## 命名

- 一般敵人（系統的代表圖，同系統共用）：`family_<familyId>_a.png` ／ `family_<familyId>_b.png`
- 個別敵人專屬圖：`enemy_<familyId>_<enemyId>.png`
- 夜王：`boss_<bossId>.png`
- 放置位置：`static_src/images/sprites/`

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
