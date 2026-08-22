# 劇本5「天秤の獣」（equilibrious_beast）：場地卡reward陣列與敵人 auto-GM 稽核記錄（2026-08-22）

本文件記錄劇本5〜9結構化計畫（`.superpowers/sdd/2026-08-22-scenario-5-9-enemy-structuring/`）
Phase 1（劇本5）Task 1／Task 2的稽核與實裝內容，格式比照
`docs/combat_move_structuring_scenario3.md`（劇本3稽核記錄，王gnosterをスコープ外とした前例）：
列出對象範圍、參照的規則書出典、判定根據，以及刻意保留GM手動處理（fallback）的項目與理由。

**與元計畫的差異說明**：本Phase原本可能涵蓋劇本5的王（libra）構造化，但**使用者明確指示將
王libra排除於本次範圍外**，後日另行處理。因此本文件僅記錄Task 1（場地卡reward陣列監査）與
Task 2（夜之強敵「王族の幽鬼」構造化）的內容，libra的部分另立一節說明其暫緩理由，不包含任何
構造化內容。

調查方法與劇本2/3稽核相同：先確認 `static_src/scenarios.js` 的劇本5卡片配置與
`static_src/fields_data_*.js` 的varianceTable分岐，再對照 `enemy_auto_gm_data.js`
既有結構化管線（`docs/enemy_damage_rules.md`定義的傷害套用規則），逐行比對規則書原文本文與
程式碼是否一致。本次任務未新增或修改規則文件本身，僅在既有auto-GM覆蓋層架構下新增資料。

---

## 一、Task 1：劇本5（equilibrious_beast）場地卡reward陣列稽核

### 對象範圍

`static_src/scenarios.js` 中 `equilibrious_beast` 為陣列第5項（index 4），
`Scenarios.numberForId("equilibrious_beast")` 回傳 **5**。

劇本5的 `start`／`day1`（9枠）／`day2`（6枠）／`end` 各枠rank列表：

- start: A（♦）／end: A（♣）
- day1: 2（♦）、4（♥）、6（♦）、7（♣）、8（♠）、9（♦）、J（♠）、K（♣）、K（♥）
- day2: 4（♦）、9（♠）、10（♥）、Q（♥，地変）、Q（♦，地変）、Q（♣，地変）
- 涉及rank：A, 2, 4, 6, 7, 8, 9, 10, J, Q, K（**3、5不涉及**）

對應涉及卡片：`a_start`、`a_golden`、`card_2`、`card_4`、`card_6`、`card_7`、`card_8`、
`card_9`、`card_10`、`card_j`、`card_k`、`card_q`。

### 稽核方式

與劇本2/3稽核相同的判定基準：「戦闘遭遇文字含『撃破ルーン：N』（或層內文字明確提及ルーン獲得），
但同floor的`reward[]`陣列缺少對應rune條目」，逐一比對本文數字與陣列內容，僅補齊缺漏，不觸碰
其他劇本專屬分岐的既有內容。

`card_q`「地変」的「腐れ森(1)/(2)/(3)」3分岐是劇本5專屬（劇本1〜4從未涉及此rank Q的地変
內容），本次為首次網羅稽核，落差集中於此處。

### 發現並修補的落差（合計10處，位於 `fields_data_4.js` 的 `card_q` 腐れ森系列）

commit `cc8dd12` 中發現並修補以下10處：

| 檔案:行（修改後） | 分岐／Floor | 補上內容 |
|---|---|---|
| `fields_data_4.js:1910` | 腐れ森(1)／フロア1「崩れた遺跡」 | `rune: 2`（ザコ戦闘撃破ルーン：2） |
| `fields_data_4.js:2097` | 腐れ森(1)／フロア2「秤の商人」 | `rune: 3`（「戦いを仕掛ける」→ボス戦闘撃破ルーン：3） |
| `fields_data_4.js:2167` | 腐れ森(1)／フロア3「強敵との連戦」 | `rune: 8`（ボス戦闘1撃破ルーン：8） |
| `fields_data_4.js:2175` | 腐れ森(1)／フロア3「強敵との連戦」 | `rune: 10`（ボス戦闘2撃破ルーン：10） |
| `fields_data_4.js:2297` | 腐れ森(2)／フロア2「女王蟻と守護者」 | `rune: 4`（ボス戦闘撃破ルーン：4）＋修正既存誤植note（原本錯標「ザコ戦闘撃破」，此floor實際為「ボス戦闘」） |
| `fields_data_4.js:2349` | 腐れ森(2)／フロア3「腐敗の湖に佇むもの」 | `rune: 6`（ボス戦闘撃破ルーン：6） |
| `fields_data_4.js:2438` | 腐れ森(3)／フロア1「小野営地跡」 | `rune: 2`（ザコ戦闘1撃破ルーン：2） |
| `fields_data_4.js:2440` | 腐れ森(3)／フロア1「小野営地跡」 | `rune: 2`（ザコ戦闘2撃破ルーン：2） |
| `fields_data_4.js:2532` | 腐れ森(3)／フロア2「腐った小砦」 | `rune: 2`（ザコ戦闘撃破ルーン：2） |
| `fields_data_4.js:2580` | 腐れ森(3)／フロア3「貴腐騎士」 | `rune: 4`（ボス戦闘撃破ルーン：4） |

以上10處中9處為單純缺少`rune` entry，1處（`fields_data_4.js:2297`附近）額外修正了一個明顯的
既存誤植：該floor的獎勵陣列將タリスマン entry標注為「（ザコ戦闘撃破。人数分クリックして
ください）」，但本文該floor實際只有「ボス戦闘（撃破ルーン：4）」、並無ザコ戦闘描述，故一併
修正note文字為「（ボス戦闘撃破。人数分クリックしてください）」。

另於 `fields_data_2.js`（`card_4`「大野営地(炎2)」フロア2「火の戦車」）補上3處`hpDamage`
entry，對應本文中3個獨立的「HP損害：□□」描述（可計算的□placeholder，非■）：

| 檔案:行（修改後） | 內容 |
|---|---|
| `fields_data_2.js:1114` | `hpDamage: 2`（最初の行為判定失敗時・ランダム2人選出） |
| `fields_data_2.js:1117`附近 | `hpDamage: 2`（弱点を突く試み・再判定失敗時） |
| `fields_data_2.js:1118`附近 | `hpDamage: 2`（弱点を突く試み・失敗時） |

此floor原本的reward陣列僅有`rune:1`（成功ごと）與撃破3輛後的`potentialPower`，本文中3處
「HP損害：□□」皆為可計算數值卻缺少對應entry，故予以補齊。此floor屬於劇本5 day1 pos2（H4）
與day2 pos1（D4）1D決定表（含全6分岐）與day2固定行（狂）共用範圍內。

### 已核對、無落差的卡片／分岐

- `a_start`：劇本2/3稽核時已補完，本次核對無落差。
- `a_golden`：1日目／2日目皆已有正確rune與stoneswordKey，與劇本無關。
- `card_2`：劇本2/3稽核時已補完，本次逐分岐核對（含floor1/floor2）無落差。
- `card_6`：「4～7、10」1D行涵蓋的3分岐（坑道(1)/(2)/(3)），逐分岐核對無落差。
- `card_7`：劇本5專屬固定行（suit♣）僅涉及「湖沼(狂)」1分岐，該分岐已於劇本4稽核（Task10）
  時補完rune，本次核對無落差。
- `card_8`：「3、5、10」共用的2D決定表涵蓋全部8分岐×2 floor，劇本3稽核（Task6）時已全數
  補完，本次逐分岐逐floor機械式核對，無落差。
- `card_9`：「1～7、10」1D行涵蓋的2分岐（封牢(無印)／封牢(森)），核對無落差。
- `card_10`：全劇本共通單一分岐（魔術師塔，diceHandChoice結構），核對無落差。
- `card_j`：「1～7、10」1D行涵蓋的「砦」分岐，floor1〜floor4逐一核對，皆已有正確reward，
  無落差（但參見下節「刻意跳過」第3項）。
- `card_k`：「1～7、10」共通的「教会」單一分岐（含フロア1決定1D的4個子分支），逐子分支核對，
  無落差。

### 刻意跳過、未觸碰的內容

1. **`■`placeholder**：`card_j`、`card_k`、`card_q`腐れ森系列、`card_4`等分岐中大量出現的
   「HP損害：■」「FP損害：■」皆維持原樣，未新增猜測數值（CLAUDE.md §17-19絕對禁止）。
2. **`card_4`「大野営地(炎1)」與「大野営地(雷)」的「初回訪問」樓層**：本文含「HP損害：□□」
   （炎1，可計算）或「HP損害：■」（雷，不可計算），但**整個floor物件從未有`reward[]`欄位**。
   此為codebase既有的一致性慣例——同樣的「初回訪問」樓層模式在`fields_data_2.js`的`card_3`
   （2處）也完全相同，且皆從未在劇本2/3/4任一次稽核中被補上reward陣列，判斷這是既有架構
   刻意的設計（「初回訪問」樓層不透過`floor-reward-modal`追蹤，僅作為フロア1前的描述性
   前導文字），故本次比照既有慣例不新增，避免破壞跨卡片的一致性。記錄為後續可能需要單獨
   確認的項目，但非本Task範圍內的落差。
3. **`card_j`「砦」floor2/floor3的花色分支缺口**：varianceTable「1～7、10」列標示的花色僅
   「♥♦♣」（3種），但劇本5(equilibrious_beast)的day1 pos7實際配置為suit **♠**
   （`scenarios.js:133`），而floor2/floor3目前僅有(♥)/(◇)/(♣)三種花色變體，**沒有(♠)
   變體**。這並非「reward陣列與本文描述不一致」的落差類型，而是「整個分岐內容本身可能
   缺漏」的結構性問題，需要規則書逐字確認才能新增完整的花色分支內容（敵人、獎勵、描述皆
   需要），超出本Task「reward陣列監査」的範圍與授權，**未做任何臆測性新增，僅記錄於此
   供後續Task參考**。
4. **`card_2`「丘の上の大教会」／「水辺の大教会」、`card_k`「崩れた教会」等劇本8/9專屬分岐**：
   不在劇本5的varianceTable涵蓋範圍內，未觸碰。
5. **`card_q`「山嶺」「隠れ都ノクラテオ」「大結晶」「火口」等分岐**：對應其他劇本，不在劇本5
   範圍內，未觸碰。

### 驗證

```
node --check static_src/fields_data_1.js && node --check static_src/fields_data_2.js && node --check static_src/fields_data_3.js && node --check static_src/fields_data_4.js
```
→ 全部通過，無語法錯誤。

```
py -3 generate.py
```
→ `Generated site into D:\work\PriTest\PriTest\dist`，建置成功，經grep確認
`dist/static/fields_data_4.js`與`dist/static/fields_data_2.js`皆已反映修補後內容。

### Commit

```
cc8dd12 fix(fields): 補完劇本5(equilibrious_beast)該當分岐的reward陣列與本文記述落差
```

`git diff --stat`：`static_src/fields_data_2.js | 3 +++`、`static_src/fields_data_4.js | 11 +++++++--`
（2 files changed, 14 insertions(+), 1 deletion(-)）。`fields_data_1.js`／`fields_data_3.js`
於本次稽核未發現落差，無變更。

---

## 二、王(libra)について

劇本5の王 libra の auto-GM 結構化は、**使用者の明示的な指示により今回のスコープ外**とする。
libraに関する構造化データ・auto-GM覆蓋層は本Phaseでは一切追加していない。後日、別途Taskと
して対応予定。

---

## 三、Task 2：劇本5夜之強敵「王族の幽鬼」auto-GM覆蓋層

### 対象敵の特定

- ソース: `static_src/enemies_data_1.js:1356-1422`
- familyId: `grafted`（「接ぎ木系」。base=`[300,300,360,360,420,420,480,480,540,600,660,720,780,840,900]`、
  guardCount:3。同一familyには既存の`grafted_lord`（劇本4で構造化済み）と`grafted_prince`も
  含まれる）
- enemyId: `royal_wraith`（「王族の幽鬼」/「王族的幽鬼」、size:L、resistance:発狂）
- 参照元: `static_src/fields_data_1.js:487-491`（劇本5 Day1「夜之強敵決定表」出目4-5）
- 対象外（既存対応済み、本タスク範囲外）: 百足のデーモン(`centipede_demon`)／戦場の宿将
  (`duke_freydia`)／ティビアの呼び舟(`tibias_summoning_boat`)／公のフレイディア（劇本2/3
  構造化済み）。Day2の坩堝の騎士／神肌の使徒たち／死儀礼の鳥も既存対応済み。

### 構造化內容概要

`static_src/enemy_auto_gm_data.js`の`var DATA = {...}`末尾にキー`"grafted|royal_wraith"`を
追加（85行）。rows6行すべて構造化：

1. **roll1「猛追」**：mod欄「—」のためgroupDamage省略。個別効果「PC人数+1回実行」は可変回数
   のため下記fallback。
2. **roll2「回転殴り＆転移」**（mod±0）：`groupDamage:{modifier:0}`、
   `targetRule:{kind:"frontAggroAtLeast1All"}`（本文「2人分」明記）。「転移」→
   `force_back_row_next_phase`。
3. **roll3「毒吐き」**（mod－120＆「猛毒:1D」）：`groupDamage:{modifier:-120,
   ailmentAccum:[{label:"猛毒",amount:1}]}`、個別効果は
   `individualDamage:[{amount:180, targetRule:{kind:"aggroMax"}, ailmentAccum:[{label:"猛毒",amount:1}]}]`
   （`grafted_lord`「吐き出し」の呪死二重発生と同型）。
4. **roll4「叩きつけ＆転移」**（mod+120）：`groupDamage:{modifier:120}`。スタミナダイス-1は
   `stamina_dice_reduction_next_phase`。転移→`force_back_row_next_phase`。
5. **roll5「爆発光弾」**（mod±0＆「聖:1D」）：`groupDamage:{modifier:0,
   elementAccum:[{label:"聖",amount:1}]}`、個別効果
   `individualDamage:[{amount:180, targetRule:{kind:"aggroAtLeast1All"}, elementAccum:[{label:"聖",amount:1}]}]`
   （`grafted_lord`「地擦り斬撃＆体当たり」と同型の二重発生）。
6. **roll6「死の叫び」**：mod欄「—」のためgroupDamage省略。下記fallback。

`special`フィールドの3能力のうち、〔亡者特効〕（公開情報・常時有効の受動的特性）と
〔弱点:回復〕（PC側の行動がトリガーで出目テーブルに存在しない）はrows[]に含めず、キー直前の
ブロックコメントに完全記録した。〔転移（条件発揮）〕は本文中で「転移」を明記する行
（roll2・roll4）にのみ既存タグ`force_back_row_next_phase`を付与した。

`rollBonusAfterGuardBreak`は設定していない（roll1~6が1-6の全範囲を既にカバーしており、
「行動激化」欄の言及も規則書テキストに存在しないため）。

### GM手動fallbackにした箇所と理由

| roll | 行動 | 類型 | 原因 |
|---|---|---|---|
| roll1 | 猛追 | 部分fallback | 個別効果が「PC人数+1回実行」で可変回数のため、`conditions:["variable_repeat_manual"]`のみを付与し、既存repeat機構（固定回数前提）は使わなかった。猛毒:1（固定値）自体は反映せずコメント記録に留め、rowsの数値には含めていない。（`grafted_lord`「斧連続攻撃」等の既存前例と同一パターン。） |
| roll6 | 死の叫び | 完全fallback（groupDamage省略＋conditions） | 「HP損害:■■■」は■のため数値化不可（CLAUDE.md §19、Global Constraint 1）。`conditions:["unknown_hp_damage_manual","reducible_by_stamina_dice"]`を付与し、`imp_watchdog_gargoyle|hero_gargoyle`「咆哮」と同型のfallbackとした。スタミナダイス消費による軽減もPC側任意選択のため自動計算していない。 |

いずれも数値・効果の捏造を避けるため、既存schema（`rollOverride`／`savingThrow`／既存
`targetRule.kind`）が正確に表現できる範囲のみ自動化し、表現力を超える部分はconditionsタグ＋
コメントでGM手動処理として明記する、という劇本2/3稽核と同一の設計方針を踏襲した。新しい
スキーマ機構は追加していない。

### 驗證

1. `node --check static_src/enemy_auto_gm_data.js` → エラーなし（SYNTAX_OK）。
2. `py -3 generate.py` → `Generated site into D:\work\PriTest\PriTest\dist`（ビルド成功）。
3. Node上での静的動作検証（`window.PriTestEnemyAutoGmData.get('grafted','royal_wraith')`呼び出し）
   → 期待通り6行分のrows（roll1~6）が返り、上表の構造と一致することを確認した。ブラウザでの
   実戦闘操作によるPlaywright動的確認は、本追加が純粋なデータ構造の追加でUI連動ロジックの
   変更を伴わないため省略した（既知の後續項目として次節に記録）。

### Commit

```
28807f7 feat(night): 新增劇本5夜之強敵(王族の幽鬼)的自動化GM結構化資料
fe99504 fix(night): 修正劇本5王族の幽鬼註解中的Global Constraint編號誤植
```

`fe99504`はレビュー指摘対応のfix roundで、`enemy_auto_gm_data.js:2044`（roll1のコメント内）
で誤って引用していた「Global Constraint 6」を、ファイル内の同種ケースで一貫して使われている
「Global Constraint 7」に修正したのみ（コメントのみの変更、コード実行への影響なし）。

---

## 四、既知の後續項目

1. **劇本5の王(libra)は今回未対応**（本文書「二、王(libra)について」参照）。使用者の指示に
   より後日別途Taskとして対応予定。
2. **`card_j`「砦」floor2/floor3のsuit♠変体が欠落している可能性**（本文書「一、刻意跳過」
   第3項参照）。規則書逐字確認のうえ、別途Taskとして敵人・獎勵・描述を新規追加すべきか判断
   する必要がある。
3. **`card_4`「大野営地(炎1)」／「大野営地(雷)」の「初回訪問」樓層に`reward[]`自体が無い件**
   （本文書「一、刻意跳過」第2項参照）：`fields_data_2.js`の`card_3`にも同型の既存パターンが
   あり、劇本2/3/4いずれの稽核でも補完対象とされてこなかった。既存の意図的設計か単なる歴史的
   な見落としかは未確認のまま、本Taskでは既存慣例に合わせて不変更とした。
4. **ブラウザでの実戦闘操作による動的確認は未実施**：Task 2で追加した`royal_wraith`について、
   戦闘UI上での乱戦ダメージ計算のPlaywright確認は行っていない。静的検証
   （構文チェック＋`generate.py`＋Node上での`get()`呼び出し確認）のみ完了。
