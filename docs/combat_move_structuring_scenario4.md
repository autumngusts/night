# 劇本4「幻書の使者」（augur）：場地卡reward陣列與敵人 auto-GM 稽核記錄（2026-08-22）

本文件記錄劇本1〜4結構化計畫（`docs/superpowers/plans/2026-08-13-scenario-2-4-card-structuring.md`）
Phase 3（劇本4）Task 10／Task 12的稽核與實裝內容，格式比照
`docs/combat_move_structuring_scenario3.md`（劇本3稽核記錄）：列出對象範圍、參照的規則書出典、
判定根據，以及刻意保留GM手動處理（fallback）的項目與理由。

**與元計畫的差異說明**：元計畫的Task 13原本預定彙整Task 10（reward陣列監査）／Task 11（王maris
精度監査）／Task 12（夜之強敵3体構造化）三者的內容。但本次使用者明確指示將Task 11（劇本4的王
maris的精度監査，含出目3/4的睡眠蓄積漏れ修正等）排除於本次範圍外，後日另行處理。因此本文件為
縮小版，**僅記錄Task 10與Task 12的內容**，王marisの部分另立一節說明其暫緩理由，不包含任何精度
監査或修正內容（maris本身已有既存試作結構化資料，見下）。

調查方法與劇本2/3稽核相同：先確認 `static_src/scenarios.js` 的劇本4卡片配置與
`static_src/fields_data_*.js` 的varianceTable分岐，再對照 `enemy_auto_gm_data.js`／
`boss_auto_gm_data.js` 既有結構化管線（`docs/enemy_damage_rules.md`定義的傷害套用規則），
逐行比對規則書原文本文與程式碼是否一致。本次任務未新增或修改規則文件本身，僅在既有auto-GM
覆蓋層架構下新增資料。

---

## 一、Task 10：劇本4（augur）場地卡reward陣列稽核

### 對象範圍

`static_src/scenarios.js:91-117` 確認 `augur` 條目陣列順序（0始まり）為
`tricephalos`(0)→`gaping_jaw`(1)→`sentient_pest`(2)→`augur`(3)，`numberForId(id)` 回傳 `i + 1`，
故 `Scenarios.numberForId("augur")` 為 **4**。

劇本4的 `start`／`day1`（9枠）／`day2`（6枠）／`end` 各枠rank列表：

- start: A（♥）／end: A（♦）
- day1: 2（♦）、3（♠）、4（♣）、5（♠）、6（♣）、7（♥）、8（♥）、J（♦）、K（♣）
- day2: 3（♣）、5（♦）、8（♠）、9（♣）、9（♥）、K（♦）
- 該当rank: A, 2, 3, 4, 5, 6, 7, 8, 9, J, K（**10とQは該当なし**——劇本4的卡片配置沒有對應
  該rank的枠）。

對應涉及卡片：`a_start`、`a_golden`、`card_2`〜`card_9`、`card_j`、`card_k`（不含`card_10`／
`card_q`）。

`static_src/night_floor_breakthrough.js:38-66`（`resolveFieldEntryForSlot`）確認盤面的場地卡
僅以 `cardLabel === card.rank` 解析（與scenarios.js的`name`顯示標籤無關），因此`card_3`
的劇本4顯示名「小塔（隨機）」實際仍對應`fields_data_2.js`的`card_3`（內部名「小砦」）——
此為既有資料轉寫上的特徵，與reward陣列稽核無關，本Task未變更。

### 稽核方式

與劇本2/3稽核相同的判定基準：「戰鬥遭遇文字含『撃破ルーン：N』（或層內文字明確提及ルーン
獲得），但同floor的`reward[]`陣列缺少對應rune條目」，逐一比對本文數字與陣列內容，僅補齊缺漏，
不觸碰劇本1〜3或劇本8/9專屬分岐的既有內容。針對每張卡先鎖定`varianceTable.rows`中「シナリオ」
列含4的行，再機械式逐一核對該行涵蓋的全部分岐。

### 發現並修補的落差（合計8處，皆位於`fields_data_3.js`的`card_7`湖沼系列）

`card_7`的varianceTable「4,6,7,10」行以1D決定涵蓋毒/腐/凍/睡/狂/血共6分岐。其中「毒」
（劇本2固定行已補完）與「凍」（劇本3固定行已補完）以外的**腐／睡／狂／血4分岐，在過去任何
Task中都不曾被「1D隨機」行納入稽核對象**，本次是首次網羅稽核。

| 檔案:行（修改後） | 分岐 | Floor | 補上內容 |
|---|---|---|---|
| `fields_data_3.js:640` | 湖沼(腐) | フロア1 | `rune: 1`（對應「ザコ戦闘（撃破ルーン：1）」） |
| `fields_data_3.js:717` | 湖沼(腐) | フロア2 | `rune: 3`（對應「ボス戦闘（撃破ルーン：3）」） |
| `fields_data_3.js:925` | 湖沼(睡) | フロア1 | `rune: 1`（對應「ザコ戦闘（撃破ルーン：1）」） |
| `fields_data_3.js:997` | 湖沼(睡) | フロア2 | `rune: 4`（對應「ボス戦闘（撃破ルーン：4）」） |
| `fields_data_3.js:1071` | 湖沼(狂) | フロア1 | `rune: 1`（對應「ザコ戦闘（撃破ルーン：1）」） |
| `fields_data_3.js:1139` | 湖沼(狂) | フロア2 | `rune: 4`（對應「ボス戦闘（撃破ルーン：4）」） |
| `fields_data_3.js:1198` | 湖沼(血) | フロア1 | `rune: 1`（對應「ザコ戦闘（撃破ルーン：1）」） |
| `fields_data_3.js:1253` | 湖沼(血) | フロア2 | `rune: 4`（對應「ボス戦闘（撃破ルーン：4）」） |

以上8處均為新增`{ kind: "rune", value: N, note: C("（撃破ルーン）", "（擊破盧恩）") }`的1行。

### 已核對、無落差的卡片／分岐

- `a_start`：3分岐（小野営地の君主軍／ボロボロの小屋／教会の大ネズミ），劇本2/3稽核時已修補。
- `a_golden`：1日目／2日目，皆已有正確rune。
- `card_2`：4分岐（大教会(1)/(2)/(炎)/(聖)），劇本2/3稽核時已修補。
- `card_3`：4分岐（小砦(1)/(2)/(3)/(魔)），劇本2/3稽核時已修補。
- `card_4`：大野営地(雷) 固定分岐，劇本2稽核（Task1）時已補完`rune:4`。
- `card_5`：9分岐（無印/魔/雷/聖/毒/血/凍/眠/死）×2 floor，劇本3稽核（Task6）時已全數補完。
- `card_6`：3分岐（坑道(1)/(2)/(3)），全部核對皆已有正確rune。
- `card_8`：8分岐（1/2/雷1/雷2/聖/血/炎/毒）×2 floor，劇本3稽核（Task6）時已全數補完。
- `card_9`：2分岐（封牢(無印)／封牢(森)），劇本3稽核時已補完。
- `card_j`：砦分岐，劇本2稽核時已補完。
- `card_k`：教会分岐，劇本2/3稽核時已補完。

全部依照「找到一個branch的落差後，機械式核對同卡片剩餘全部branch」原則（劇本3 Task6教訓）進行，
`card_6`／`card_7`／`card_8`皆逐分岐與本文對照。

### 刻意跳過、未觸碰的內容

- `HP損害：■`／`FP損害：■`／`HP損害：□□`等既存placeholder記述維持原樣，未新增猜測數值
  （CLAUDE.md §17-19）。
- 劇本8/9專屬分岐（`神殿`、`西の地下砦`／`東の地下砦`、大空洞的教会3變體、`倒れた大結晶`等）
  不在劇本4的varianceTable涵蓋範圍內，即使存在類似落差也未於本Task觸碰
  （與劇本2/3稽核記錄相同的既知後續項目）。
- `card_3`的scenarios.js顯示名「小塔（隨機）」與fields_data內部名「小砦」的不一致，屬顯示標籤
  問題而非reward結構化範圍，本Task未變更，僅記錄於此。

### 驗證

```
node --check static_src/fields_data_1.js && node --check static_src/fields_data_2.js && node --check static_src/fields_data_3.js && node --check static_src/fields_data_4.js
```
→ 全部通過，無語法錯誤。

```
py -3 generate.py
```
→ `Generated site into D:\work\PriTest\PriTest\dist`，建置成功。`dist/static/fields_data_3.js`
反映修補後內容，經`grep`確認。

### Commit

```
dd84eb7 fix(fields): 補完劇本4(augur)該當分岐的reward陣列與本文記述落差
```

`git diff --stat`：`static_src/fields_data_3.js | 8 ++++++++`（1 file changed, 8 insertions(+)）。
其餘3個fields_data檔案於本次augur稽核未發現落差，無變更。

---

## 二、王(maris)について

劇本4の王 maris の精度監査（元計畫のTask 11に相当、出目3/4の睡眠蓄積漏れ修正等）は、
**使用者の明示的な指示により今回のスコープ外**とする。

`static_src/boss_auto_gm_data.js:13, 25-` に既存の記述の通り、marisは既にgladiusと並んで
**試作（プロトタイプ）として出目1〜8（全行）が構造化済み**である
（`rollBonusAfterGuardBreak: 2`による「行動激化」対応も既存）。ただし同ヘッダーコメント
（`boss_auto_gm_data.js:11-22`）はgladiusとmarisのみを対象範囲として明記しており、
規則書原文との逐行精度監査（本文の数値・条件と構造化データの一致確認）は行われていない。
本Phaseではこの精度監査・修正を実施せず、**後日別途Taskとして対応予定**とする。

---

## 三、Task 12：劇本4夜之強敵3体 auto-GM覆蓋層

### 對象一覧

來源：`static_src/fields_data_1.js:474-482`「劇本4 Day1/Day2の夜之強敵決定表」。以下3体を
新規構造化した。

| # | 敵人（日文） | familyId\|enemyId | 來源檔案:行 |
|---|---|---|---|
| 1 | 接ぎ木の君主 | `grafted\|grafted_lord` | `enemies_data_1.js:1292-1355`（family定義: 1236-1246） |
| 2 | 神肌の使徒たち | `strong_type\|divine_skin_apostles` | `enemies_data_3.js:1027-1093`（family定義: 639-649） |
| 3 | 降る星の成獣 | `rock_spirit_beast\|falling_star_beast` | `enemies_data_1.js:657-720`（family定義: 503-513） |

全部以additive方式新增至 `static_src/enemy_auto_gm_data.js` 末尾（`dragon|great_earth_dragon`
の直後、`var DATA`閉じ直前、+239行），未修改任何既有entry。3体すべて`rollBonusAfterGuardBreak`
に該当する「行動激化」記載は無いため設定していない。

### 構造化內容概要

- **`grafted_lord`（接ぎ木の君主）**：rows6行すべて構造化。転がりジャンプ斬り
  （`stamina_dice_reduction_next_phase`）／風飛ばし（`individualDamage`、`aggroMax`対象2回
  実行）／アースシーカー（`savingThrow`、soldier_knight|red_lion_knights「アローレイン」と
  同型）／地擦り斬撃＆体当たり（`聖+1`個別ダメージ＋`stamina_dice_reduction_next_phase`）／
  尻尾薙ぎ払い＆叩きつけ（`repeat:2`）／斧連続攻撃（roll6、下記fallback）。
- **`divine_skin_apostles`（神肌の使徒たち）**：rows6行すべて構造化。両刃剣乱舞
  （`frontAggroMaxAll`、soldier_knight|crucible_knight「薙ぎ払い」と同型）／連続突き
  （`individualDamage`、`distribution:"rotate"`）／黒炎投げ（roll3、下記fallback）／連携攻撃
  （`repeat:2`）／肉弾戦車（`no_guard`）／黒炎の乱舞（`炎+1`個別ダメージ、
  `black_flame_corrosion_trigger`）。special「黒炎の侵蝕（条件発揮）」あり。
- **`falling_star_beast`（降る星の成獣）**：rows6行すべて構造化。突進＆重力岩破壊
  （`gravity_rock_break_trigger`）／跳躍回転体当たり＆重力岩破壊（roll2、下記fallback）／
  尻尾薙ぎ払い（`enemy_hp_value_buff`）／ハサミ振り回し＆重力岩生成（`repeat:2`、
  `gravity_rock_generate_trigger`）／重力雷落とし（roll5、下記fallback）／重力操作＆重力岩生成
  （`allPCs`、`魔+2`、`no_guard`）。special「隕鉄特効」／「重力岩生成（条件発揮）」／
  「重力岩破壊（条件発揮）」あり。

### GM手動fallbackにした箇所と理由

| 敵人 | 行動 | 類型 | 原因 |
|---|---|---|---|
| `grafted_lord` | 斧連続攻撃（roll6） | 部分fallback | mod「—」でPC人数回実行（Global Constraint 7の可変回数）のため`conditions:["variable_repeat_manual","reducible_by_stamina_dice"]`でGM手動に委ねた。 |
| `divine_skin_apostles` | 黒炎投げ（roll3） | 部分fallback | 乱戦ダメージ対象が「後衛（後衛不在時のみ前衛）」であり、既存6種の`targetRule.kind`（前衛／全体／敵視条件の組合せ）のいずれにも該当しない。`targetRule`省略、`conditions:["back_row_target_manual","accum_target_mismatch_manual","black_flame_corrosion_trigger"]`でGM手動に委ねた。 |
| `falling_star_beast` | 跳躍回転体当たり＆重力岩破壊（roll2） | 部分fallback | 対象が「敵視最大のPCが存在するエリア全員」というエリア多数決型で、既存kindはPC個人条件のみを扱うため表現不可。`targetRule`省略、`conditions:["aggro_area_target_manual","gravity_rock_break_trigger"]`。strong_type\|loathed_demon「転移＆杖撃」と同種の前例を踏襲。 |
| `falling_star_beast` | 重力雷落とし（roll5） | 部分fallback | mod「—」でPC人数回実行（Global Constraint 7の可変回数）のため`conditions:["variable_repeat_manual"]`でGM手動に委ねた。 |

いずれも数値・効果の捏造を避けるため、既存schema（`groupDamage`／`individualDamage`／
`savingThrow`／6種`targetRule.kind`）が正確に表現できる範囲のみ自動化し、表現力を超える部分は
conditionsタグ＋コメントでGM手動処理として明記する、という劇本2/3稽核と同一の設計方針を踏襲した。
新規conditionsタグ5種（`back_row_target_manual`／`aggro_area_target_manual`／
`black_flame_corrosion_trigger`／`gravity_rock_generate_trigger`／`gravity_rock_break_trigger`）
はいずれも既存`furnace_flame_trigger`と同じ「conditionsタグとして記録するのみ」という既存
パターンの適用であり、新しいtargetRule.kindやスキーマ機構は追加していない。

### 驗證

`node --check static_src/enemy_auto_gm_data.js` → エラー無し。`py -3 generate.py` →
`Generated site into D:\work\PriTest\PriTest\dist`で正常終了、`dist/static/enemy_auto_gm_data.js`
に3体分のキー（grafted_lord/divine_skin_apostles/falling_star_beast）が反映されていることを
`grep -c`で確認済み（3件ヒット）。

ブラウザでの実動作確認（Playwrightによる`window.PriTestEnemyAutoGmData.get()`呼び出し・戦闘UI上
での乱戦ダメージ計算確認）は、環境制約（Windows環境でのPlaywright起動セットアップの往復コストが
本タスクの残り時間に見合わない）により**未実施**。劇本2/3の前例に倣い、静的検証
（`node --check` + `generate.py`）のみで完了とした——**既知の後續項目**として次節に記録する。

### Commit

```
024a99c feat(night): 新增劇本4夜之強敵(接ぎ木の君主等3隻)的自動化GM結構化資料
```

---

## 四、既知の後續項目

1. **劇本4の王(maris)の精度監査は今回未対応**（本文書「二、王(maris)について」参照）。maris
   自体は既存の試作結構化データ（`boss_auto_gm_data.js`）を持つが、規則書原文との逐行精度監査
   （出目3/4の睡眠蓄積漏れ修正等）は使用者の指示により後日別途Taskとして対応予定。
2. `fields_data_2.js:2434` 崖上の遺跡（血）の「撃破ルーン：2」reward漏れは劇本8/9専属分岐の
   ため、augurのvarianceTable範囲外——将来の劇本8/9タスクで対応。
3. **ブラウザでの実戦闘操作による動的確認は未実施**：Task 12で追加した3体について、
   `window.PriTestEnemyAutoGmData.get()`呼び出しや戦闘UI上での乱戦ダメージ計算のPlaywright
   確認は環境制約により行っていない。静的検証（構文チェック＋ビルド）のみ完了。
4. `card_3`のscenarios.js表示名「小塔」とfields_data内部名「小砦」の不一致（Task 10参照）。
   reward結構化とは無関係だが、将来UIの表示名確認をする際は注意が必要。
5. 元プランのTask 1〜4／Task 6／Task 8完了時に記録された既存の「minor (deferred)」項目
   （`.superpowers/sdd/2026-08-13-scenario-2-4-card-structuring/progress.md`参照）は
   本Phaseのscope外のため、本文書では改めて記載しない。
