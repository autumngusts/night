# 劇本6「深き影の帰還」（darkdrift_knight）：場地卡reward陣列與敵人 auto-GM 稽核記錄（2026-08-22）

本文件記錄劇本5〜9結構化計畫（`.superpowers/sdd/2026-08-22-scenario-5-9-enemy-structuring/`）
Phase 2（劇本6）Task 4／Task 5的稽核與實裝內容，格式比照
`docs/combat_move_structuring_scenario5.md`（劇本5稽核記錄，王libraをスコープ外とした前例）：
列出對象範圍、參照的規則書出典、判定根據，以及刻意保留GM手動處理（fallback）的項目與理由。

**與元計畫的差異說明**：本Phase原本可能涵蓋劇本6的王（fulghor）構造化，但**使用者明確指示將
王fulghor排除於本次範圍外**，後日另行處理。因此本文件僅記錄Task 4（場地卡reward陣列監査）與
Task 5（夜之強敵「冷たい谷の踊り子」「無名の王」構造化）的內容，fulghor的部分另立一節說明其
暫緩理由，不包含任何構造化內容。

調查方法與劇本2〜5稽核相同：先確認 `static_src/scenarios.js` 的劇本6卡片配置與
`static_src/fields_data_*.js` 的varianceTable分岐，再對照 `enemy_auto_gm_data.js`
既有結構化管線（`docs/enemy_damage_rules.md`定義的傷害套用規則），逐行比對規則書原文本文與
程式碼是否一致。本次任務未新增或修改規則文件本身，僅在既有auto-GM覆蓋層架構下新增資料。

---

## 一、Task 4：劇本6（darkdrift_knight）場地卡reward陣列稽核

### 對象範圍

`static_src/scenarios.js` 中 `darkdrift_knight` 為陣列第6項（index 5），
`Scenarios.numberForId("darkdrift_knight")` 回傳 **6**。

劇本6的 `start`／`day1`（9枠）／`day2`（6枠）／`end` 各枠rank列表：

- start: A（♠）／end: A（♥）
- day1: 3（♦）、4（♦）、5（♠）、6（♣）、7（♥）、8（♦）、9（♠）、10（♦）、K（♥）
- day2: 9（♣）、J（♣）、Q（♠，地変・山頂）、Q（♥，地変・中腹）、Q（♦，地変・麓）、K（♠）
- 涉及rank：A, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K（**2不涉及**）

對應涉及卡片：`a_start`、`a_golden`、`card_3`、`card_4`、`card_5`、`card_6`、`card_7`、
`card_8`、`card_9`、`card_10`、`card_j`、`card_k`、`card_q`。

### 稽核方式

與劇本2〜5稽核相同的判定基準：「戦闘遭遇文字含『撃破ルーン：N』（或層內文字明確提及ルーン獲得
或HP損害），但同floor的`reward[]`陣列缺少對應條目」，逐一比對本文數字與陣列內容，僅補齊缺漏，
不觸碰其他劇本專屬分岐的既有內容。

`card_q`「地変」的「山嶺(山頂)/(中腹)/(麓)」3分岐是劇本6專屬（劇本1〜5從未涉及此rank Q的
地変內容），本次為首次網羅稽核，落差集中於此處。

### 發現並修補的落差（合計7處＋初回commit漏補1處，位於`fields_data_4.js`的`card_q`「山嶺」系列）

初回commit `3560734` 中發現並修補以下6處：

| 檔案:行（修改後） | 分岐／Floor | 補上內容 |
|---|---|---|
| `fields_data_4.js:2639` | 山嶺(山頂)／フロア2「氷竜の縄張り」 | `rune: 15`（ボス戦闘撃破ルーン：15） |
| `fields_data_4.js:2698` | 山嶺(山頂)／フロア4「山頂の恩恵」 | `rune: 15`（同一隻山嶺の氷竜・於フロア4挑戦時的撃破ルーン：15） |
| `fields_data_4.js:2812` | 山嶺(中腹)／フロア3「大鴉の急襲」 | `rune: 3`（ボス戦闘撃破ルーン：3） |
| `fields_data_4.js:2878` | 山嶺(麓)／フロア1「山嶺の分岐路」 | `rune: 2`（左側の道→ザコ戦闘撃破ルーン：2） |
| `fields_data_4.js:2910-2911` | 山嶺(麓)／フロア2「氷山の刺客」 | `hpDamage: 3`（腕試し・合計ダメージ179以下時「HP損害：□□□」）＋`rune: 2`（ザコ戦闘撃破ルーン：2） |
| `fields_data_4.js:2929` | 山嶺(麓)／フロア3「白毛の巨人」 | `rune: 4`（ボス戦闘撃破ルーン：4） |

以上6處中，5處為單純缺少`rune`entry（撃破ルーン文字明確標示但陣列未反映），1處
（山嶺(麓)フロア2）額外補上`hpDamage: 3`，對應本文「HP損害：□□□」（可計算的□placeholder，
非■）。「山嶺(山頂)」的フロア2與フロア4皆對應同一隻「山嶺の氷竜」（Lv.15）——フロア2是
「駆け抜ける失敗後もう一度判定」或「正面挑戦」路線，フロア4是「山頂到達後選擇性回頭挑戦」
路線，兩者皆有各自獨立的「ボス戦闘（撃破ルーン：15）」本文，故各自的floor皆需要獨立的
`rune: 15` entry。

**修正ラウンド（レビュー指摘対応、commit `3e97bad`）**：初回報告で「網羅稽核済み・無落差」と
した山嶺(中腹)分岐の中に、同一判定基準に該当する見落としが1件発見された。

| 檔案:行（修改後） | 分岐／Floor | 補上內容 |
|---|---|---|
| `fields_data_4.js:2795` | 山嶺(中腹)／フロア2「崩れた遺跡」 | `rune: 2`（ザコ戦闘撃破ルーン：2、見落とし分） |

修正時對山嶺(山頂)／山嶺(中腹)／山嶺(麓)3分岐全體重新進行機械稽核：抽出本文中所有
「撃破ルーン：[0-9]+」言及（7件：15、15、2、3、2、2、4）與`reward[]`內所有
`kind:"rune"`entry（修正後7件：15、15、2、3、2、2、4），確認數量與數值完全一致，且各entry
所屬floor區塊正確（無誤插入相鄰floor），確認無其他遺漏。

合計：本Task共發現並修補7處落差（6處於初回commit、1處於修正commit）。

### 已核對、無落差的卡片／分岐

- `a_start`：「2-7、10」1D行涵蓋的3分岐，劇本2/3稽核時已補完，本次核對無落差。
- `a_golden`：1日目／2日目，全劇本共通，已有正確rune（10／15）與stoneswordKey。
- `card_3`：「2～4、6、7、10」1D行涵蓋的4分岐（小砦(1)/(2)/(3)/(魔)），劇本2/3稽核時已補完，
  本次逐分岐逐floor核對無落差。
- `card_4`：「2、6、7」1D行涵蓋的6分岐（大野営地(1)/(2)/(炎1)/(炎2)/(雷)/(狂)），劇本2稽核
  （Task1）與劇本5稽核（Task1，火の戦車hpDamage 3處）時已全數補完，本次逐分岐逐floor核對
  無落差。
- `card_5`：「3、4、6、7、10」全隨機列（1D×2，共9種：無印/魔/雷/聖/毒/血/凍/眠/死），劇本2/3/4
  稽核時已全數補完，本次逐分岐逐floor核對無落差。
- `card_6`：「4～7、10」1D行涵蓋的3分岐（坑道(1)/(2)/(3)），劇本5稽核時已核對無落差，本次
  再核對亦無落差。
- `card_7`：「4、6、7、10」1D行涵蓋的6分岐（湖沼(毒)/(腐)/(凍)/(睡)/(狂)/(血)），劇本4稽核
  （Task10）時已全數補完（8處落差），本次逐分岐逐floor核對無落差。
- `card_8`：劇本6對應固定行（suit無標示，固定為「鍛冶村(雷2)」，屬「3、5、10」共用2D決定表
  8分岐之一），劇本3稽核（Task6）時已補完，本次核對無落差。
- `card_9`：「1～7、10」1D行涵蓋的2分岐（封牢(無印)／封牢(森)），核對無落差。
- `card_10`：全劇本共通單一分岐（魔術師塔，diceHandChoice結構），核對無落差。
- `card_j`：「1～7、10」1D行涵蓋的「砦」分岐，floor1（谷底の地下通路）／floor2（♥/◇/♣三花色
  變體）／floor3（♥/◇/♣三花色變體）／floor4（屋上）全部逐一核對，皆已有正確reward，無落差。
  劇本6實際配置suit為♣，屬既有三花色變體之一，**不存在劇本5稽核時發現的花色分支缺口問題**。
- `card_k`：「1～7、10」共通的「教会」單一分岐（含フロア1決定1D的4個子分支：埋まった女神像／
  瓦礫の山／商人／強敵の予感），逐子分支核對，無落差。

### 刻意跳過、未觸碰的內容

1. **`■`placeholder**：`card_q`「山嶺」系列中大量出現的「HP損害：■」「FP損害：■」（如
   山嶺(山頂)フロア1「崩れる氷塊」、山嶺(中腹)「初回訪問時」、山嶺(麓)「駆け抜ける」等）皆
   維持原樣，未新增猜測數值（CLAUDE.md §17-19絕對禁止）。
2. **「凍傷」「発狂」等異常蓄積數值**：本文中大量出現如「凍傷：2」「凍傷：4」「凍傷：1D」
   等明確或骰值式的異常蓄積描述。經檢查整個`fields_data_1~4.js`現有的`reward[].kind`實際
   使用種類，全庫從未有任何floor把「凍傷／発狂／猛毒」等異常蓄積透過`reward[]`追蹤（異常
   蓄積由`state.battle.attributeStatus`等其他系統管理，不透過場地卡`floor-reward-modal`的
   獎勵按鈕處理）。因此這是既有架構的一致設計，非本Task授權範圍內的落差類型，未新增對應
   entry。
3. **「タイムロス」（時間損耗）數值**：本文中多處「タイムロス：1」的描述，同樣經確認全庫
   `reward[].kind`從未追蹤時間損耗（時間損耗有獨立的state欄位與UI），故未新增。
4. **「凍傷：1D」「與判定差值相同數量的凍傷」等變動數值**：非固定可計算的□/明確整數，
   本來就不屬於CLAUDE.md §17「□」定義的可解析placeholder，維持原樣不處理。
5. **`card_q`「腐れ森」「隠れ都ノクラテオ」「大結晶」「火口」等分岐**：分別對應劇本5/7/8~9/10，
   不在劇本6的varianceTable涵蓋範圍內，未觸碰。
6. **`card_j`「西の地下砦」「東の地下砦」等劇本8/9專屬分岐、`card_k`「崩れた教会」等劇本8/9
   專屬分岐**：不在劇本6範圍內，未觸碰。

### 驗證

```
node --check static_src/fields_data_1.js && node --check static_src/fields_data_2.js && node --check static_src/fields_data_3.js && node --check static_src/fields_data_4.js
```
→ 全部通過，無語法錯誤。

```
py -3 generate.py
```
→ `Generated site into D:\work\PriTest\PriTest\dist`，建置成功。

### Commit

```
3560734 fix(fields): 補完劇本6(darkdrift_knight)該當分岐的reward陣列與本文記述落差
3e97bad fix(fields): 補完劇本6(darkdrift_knight)山嶺(中腹)遺漏的reward陣列
```

`3560734`的`git diff --stat`：`static_src/fields_data_4.js | 15 +++++++++++++--`（1 file
changed, 13 insertions(+), 2 deletions(-)）。`3e97bad`為レビュー指摘対応的fix round（未
amend既有commit，而是新增commit），`git diff --stat`：`static_src/fields_data_4.js | 1 +`
（1 file changed, 1 insertion(+)）。`fields_data_1.js`／`fields_data_2.js`／
`fields_data_3.js`於本次darkdrift_knight稽核未發現落差，無變更。

---

## 二、王(fulghor)について

劇本6の王 fulghor の auto-GM 結構化は、**使用者の明示的な指示により今回のスコープ外**とする。
fulghorに関する構造化データ・auto-GM覆蓋層は本Phaseでは一切追加していない。後日、別途Taskと
して対応予定。

---

## 三、Task 5：劇本6夜之強敵「冷たい谷の踊り子」「無名の王」auto-GM覆蓋層

### 對象敵の特定

- 参照元：`static_src/fields_data_1.js:503-506`（劇本6 Day2「4 冷たい谷の踊り子（215頁）／
  5-6 無名の王（219頁）」出目決定表）
- 敵①：familyId `warrior_swordsman`（`static_src/enemies_data_3.js:123`定義）／enemyId
  `cold_valley_dancer`（「冷たい谷の踊り子」、actions/special原文位於
  `static_src/enemies_data_3.js:570-636`）
- 敵②：familyId `cavalry`（`static_src/enemies_data_3.js:1164`定義）／enemyId
  `unnamed_king`（「無名の王」、actions/special原文位於
  `static_src/enemies_data_3.js:1363-1429`）
- 修正檔案：`static_src/enemy_auto_gm_data.js`（`var DATA = {...}`末尾追加2個key，共
  183行）

### 構造化內容概要——冷たい谷の踊り子（`warrior_swordsman|cold_valley_dancer`）

各6行結構化概要：

1. **roll1「薙ぎ払い」**：`groupDamage.modifier:120`、`targetRule.kind:frontAggroAtLeast1All`
   （本文「敵視:1以上」前衛全員「2人分」明記）。
2. **roll2「叩きつけ＆火走り」**：`groupDamage.modifier:0`／`targetRule:frontAll`（既定）＋
   `individualDamage:[{amount:120, aggroAtLeast1All, elementAccum:炎×1}]`。
3. **roll3「掴みかかり」**：mod欄「—」のためgroupDamage省略。
   `individualDamage:[{amount:300, aggroMax}]`、`conditions:["no_guard"]`（本文明記のガード
   不可）。
4. **roll4「炎爆発」**：`groupDamage:{modifier:0, elementAccum:炎×2}`／`targetRule:frontAll`
   （既定）＋`conditions:["accum_target_mismatch_manual"]`——本文別途「敵視:最大PC1体に炎
   1D」の対象集団が乱戦ダメージ対象と異なるため既存schemaで表現不可、GM手動処理に委ねる。
5. **roll5「双剣叩きつけ」**：`groupDamage:{modifier:180, elementAccum:[魔×1,炎×1]}`、
   `targetRule.kind:frontAggroAtLeast1All`（本文「敵視:1以上」前衛全員「2人分」明記）。
6. **roll6~8「双剣の舞」**：mod欄「—」。個別効果「PC人数+1回実行」が可変回数のため
   `conditions:["variable_repeat_manual"]`のみ設定し、amount/elementAccumはコメントのみに
   記録。rollMin/rollMaxが6を超えるのは体勢崩し後のみ到達可能なため。

`rollBonusAfterGuardBreak: 2`をトップレベルに設定（`special`原文「〔行動激化〕体勢崩し後は
1D+2でアクション決定」、Global Constraint 7の対象そのものと判断）。

### 構造化內容概要——無名の王（`cavalry|unnamed_king`）

各6行結構化概要：

1. **roll1~2「滞空ブレス＆雷の槍」**：`groupDamage:{modifier:0, elementAccum:炎×4}`／
   `targetRule:frontAll`（既定）＋`individualDamage:[{amount:240, aggroMax, elementAccum:
   雷×4}]`。mod欄「炎:4」・個別効果「雷:4」で属性名が異なるが、原文どおり数値・属性名を
   一切変更せず転記。
2. **roll3~4「騎乗薙ぎ払い」**：`groupDamage.modifier:180`、
   `targetRule.kind:frontAggroAtLeast1All`（本文「敵視:1以上」前衛全員「2人分」明記）。
3. **roll5~6「扇形ブレス＆叩きつけ」**：`groupDamage:{modifier:120, elementAccum:炎×3}`、
   `targetRule.kind:allPCs`（本文「乱戦ダメージはすべてのPCを対象とする」明記）＋
   `individualDamage:[{amount:300, aggroMax}]`。
4. **roll7~8「地を這う嵐＆剣槍突き刺し」**：`groupDamage.modifier:120`／`targetRule:frontAll`
   （既定）＋`individualDamage:[{amount:360, aggroMax, elementAccum:雷×2}]`、
   `conditions:["no_guard","mob_hp_trigger_manual"]`（ガード不可明記＋モブHP依存激化フラグ）。
5. **roll9~10「雷光剣槍＆落雷」**：`groupDamage:{modifier:0, elementAccum:雷×4}`／
   `targetRule:frontAll`（既定）。個別効果はPC全員が〈11｜運試し〉判定、失敗者に【個別ダメージ:
   240】＋雷:3——判定失敗時にダメージ＋属性蓄積の両方を伴うため`savingThrow`は使わず
   `conditions:["saving_throw_damage_and_ailment_manual","mob_hp_trigger_manual"]`のみ設定し、
   判定・数値の全文をコメントに記録。
6. **roll11~12「剣槍叩きつけ＆雷光地走り」**：`groupDamage.modifier:240`、
   `targetRule.kind:allPCs`（本文「乱戦ダメージはPC全員を対象とする」）。ただし「敵視:1以上」
   のPC全員は2人分の加重を受けるという、既存6種の`targetRule.kind`では表現できない加重分配
   のため、`conditions:["manual_weighted_split_aggro_double","reducible_by_stamina_dice",
   "mob_hp_trigger_manual"]`で記録しGM手動再分配に委ねる。

**rollMin/rollMaxが通常1D6の範囲（1〜6）を超えて7〜12まで存在する理由**：`special`原文に
明記された「王の威光」（下記参照）による1D+6のアクション決定式が発動して初めて到達可能な
行のため。

#### 「無名の王」のモブHP依存激化（「王の威光」）に関する設計判断——rollBonusAfterGuardBreakではなくconditions[]による扱い

`special`原文：

> 〔王の威光〕モブHPが0以下になると、戦闘終了まで、このエネミーは特殊能力「竜特効」を失い、
> アクション決定は「1D」ではなく「1D+6」で行う。

この行動激化はGlobal Constraint 7が想定する「体勢崩し依存」の`rollBonusAfterGuardBreak`とは
発動条件が根本的に異なる——「体勢崩し（ガードブレイク）」ではなく「モブHPが0以下になる」
という、モブ（雑兵）機構に依存した条件だからである。`rollBonusAfterGuardBreak`フィールドは
ガードブレイク後の激化専用に設計された既存schemaであり、これをモブHP依存の激化に流用すると
発動条件の意味が歪む。そのため本Taskでは：

- `rollBonusAfterGuardBreak`フィールドは**トップレベルに設定しない**（新規トップレベル
  フィールドの新設も行っていない）。
- 代わりに、通常の1D6=1〜6では到達不能で1D+6=7〜12でのみ到達するroll7~8／9~10／11~12の
  各行に`conditions:["mob_hp_trigger_manual"]`を付与し、rows自体は「モブHP0以下後の状態」も
  含めて1〜12の全域をあらかじめ構造化しておく設計とした。
- エントリ直前の専用コメントブロックに、`竜特効`（公開情報・受動特性）、`モブ1追加`（戦闘
  開始時セットアップ）、`王の威光`（発動条件・効果の原文全文、rollBonusAfterGuardBreakを
  使わない理由、`mob_hp_trigger_manual`タグの用途）を日本語原文つきで完全記録し、GMが実際に
  モブHPが0以下になったタイミングを確認したうえで手動でアクション決定式を1D+6に切り替える
  運用とした。

新しい`targetRule.kind`やDATAスキーマのトップレベルフィールドは一切追加していない。

### GM手動fallback箇所と理由の一覧

| 敵 | roll | タグ | 理由 |
|---|---|---|---|
| 冷たい谷の踊り子 | roll4「炎爆発」 | `accum_target_mismatch_manual` | HP損害を伴わない属性蓄積のみの効果で、対象集団（敵視最大PC1体）が乱戦ダメージ対象（前衛均等割り）と異なるため、既存の`groupDamage.elementAccum`にも`individualDamage`（amount必須）にも構造化できない。 |
| 冷たい谷の踊り子 | roll6~8「双剣の舞」 | `variable_repeat_manual` | 個別効果「PC人数+1回実行」がパーティ人数依存の可変回数のため、既存repeat機構（固定回数前提）は使わず可変回数フラグのみ付与。 |
| 冷たい谷の踊り子 | roll3「掴みかかり」 | `no_guard` | 本文に明記されたガード不可の既存タグを流用（新規タグではない）。 |
| 冷たい谷の踊り子 | `special`「〔HP価値:+20〕常に…」 | （rows外・上部コメントのみ） | 恒常的なベース値補正で出目に紐づかないため、rows[]には構造化せず、既存のDATAスキーマにこの種の定数バフを表すフィールドが無い以上、新規フィールドは追加しない方針。 |
| 無名の王 | roll7~8／9~10／11~12 | `mob_hp_trigger_manual` | 上記「王の威光」の設計判断参照。モブHP0以下でのみ到達可能な行のため、GMがトリガー成立を確認したうえで手動運用。 |
| 無名の王 | roll7~8「地を這う嵐＆剣槍突き刺し」 | `no_guard` | 本文に明記されたガード不可の既存タグを流用。 |
| 無名の王 | roll9~10「雷光剣槍＆落雷」 | `saving_throw_damage_and_ailment_manual` | 判定失敗時にダメージ＋属性蓄積の両方を伴う複合効果で、既存`savingThrow`schemaの表現範囲を超えるため。 |
| 無名の王 | roll11~12「剣槍叩きつけ＆雷光地走り」 | `manual_weighted_split_aggro_double`、`reducible_by_stamina_dice` | 「敵視:1以上」のPC全員が2人分の加重を受けるという、既存6種の`targetRule.kind`では表現できない加重分配のため。スタミナダイス消費による軽減もPC側任意選択のため自動計算していない。 |

いずれも数値・効果の捏造を避けるため、既存schema（`rollOverride`／`savingThrow`／既存
`targetRule.kind`）が正確に表現できる範囲のみ自動化し、表現力を超える部分はconditionsタグ＋
コメントでGM手動処理として明記する、という劇本2〜5稽核と同一の設計方針を踏襲した。新しい
スキーマ機構は追加していない。

### 驗證

1. `node --check static_src/enemy_auto_gm_data.js` → エラーなし（SYNTAX_OK）。
2. `py -3 generate.py` → `Generated site into D:\work\PriTest\PriTest\dist`（ビルド成功）。
3. Node上での静的動作検証（`window.PriTestEnemyAutoGmData.get(...)`呼び出し）:
   - `warrior_swordsman|cold_valley_dancer` → `rows=6`、`rollBonusAfterGuardBreak=2`。
   - `cavalry|unnamed_king` → `rows=6`、`rollBonusAfterGuardBreak=undefined`（意図通り、
     モブHP依存激化のため未設定）。
   ブラウザでの実戦闘操作によるPlaywright動的確認は、本追加が純粋なデータ構造の追加で
   `night.js`側のロジック改修を伴わないため省略した（既知の後續項目として次節に記録）。

### Commit

```
c96edc5 feat(night): 新增劇本6夜之強敵(冷たい谷の踊り子、無名の王)的自動化GM結構化資料
```

`1 file changed, 183 insertions(+)`。

---

## 四、既知的後續項目

1. **劇本6的王（fulghor）本次未對應**（本文書「二、王(fulghor)について」參照）。使用者
   明確指示排除於本次範圍外，後日另行以獨立Task處理。
2. **ブラウザでの実戦闘操作による動的確認は未実施**：Task 5で追加した`cold_valley_dancer`
   ／`unnamed_king`について、戦闘UI上での乱戦ダメージ計算のPlaywright確認は行っていない。
   靜態驗證（構文チェック＋`generate.py`＋Node上での`get()`呼び出し確認）のみ完了。必要
   であれば追ってPlaywrightでnight画面上の該当敵人を選択し、行動テーブルが自動表示される
   ことを確認可能。
3. **冷たい谷の踊り子「双剣の舞」（roll6~8）の個別ダメージを部分構造化しなかった判断**：
   個別効果が「PC人数+1回実行」というパーティ人数依存の可変回数のため、既存repeat機構
   （固定回数前提）では正確に表現できない。amount／elementAccum等の具体的数值は捏造を避け
   コメントのみに記録し、`conditions:["variable_repeat_manual"]`によるGM手動処理とした。
   将来的にrepeat機構が可変回数に対応した場合は再検討の余地がある。
4. **`card_q`「山嶺」フロア2/フロア4の「山嶺の氷竜」は同一敵体でありながら独立した2つの
   `rune:15`エントリが存在する件**（本文書「一、Task4」參照）：本文がフロア2・フロア4
   それぞれに独立した「ボス戦闘（撃破ルーン：15）」の記述を持つため、reward陣列稽核の観点
   からは正しい対応だが、実際のゲームプレイ上で同一敵体を2度撃破してルーンを二重取得できて
   しまう可能性があるかどうかは、規則書の探索フロー（両フロアが排他的ルートか否か）の
   別途確認が必要。本Taskの「reward陣列と本文記述の整合性監査」の範囲を超えるため、確認は
   別途Taskに委ねる。
5. **劇本5稽核で発見された`card_j`「砦」floor2/floor3のsuit♠変体欠落問題**は劇本6には
   該当しない（劇本6の`card_j`は既存3花色変体のうち♣で正しくカバーされている）ことを本Task
   で確認済み。参考として記録する。
