# 劇本2「顎の激戦」（gaping_jaw）：場地卡reward陣列與敵人／王 auto-GM 稽核記錄（2026-08-13）

本文件記錄劇本1〜4結構化計畫（`docs/superpowers/plans/2026-08-13-scenario-2-4-card-structuring.md`）
Phase 1（劇本2）Task 1〜4的稽核與實裝內容，格式比照
`docs/combat_move_structuring_scenario1_and_classes.md` 的劇本1敵人稽核部分：列出對象範圍、
參照的規則書出典、判定根據，以及刻意保留GM手動處理（fallback）的項目與理由。

調查方法與劇本1稽核相同：先確認 `static_src/scenarios.js` 的劇本2卡片配置與
`static_src/fields_data_*.js` 的varianceTable分岐，再對照 `enemy_auto_gm_data.js`／
`boss_auto_gm_data.js` 既有結構化管線（`docs/enemy_damage_rules.md`定義的傷害套用規則），
逐行比對規則書原文本文與程式碼是否一致。本次任務未新增或修改規則文件本身，僅在既有
auto-GM覆蓋層架構下新增資料。

---

## 一、Task 1：劇本2場地卡reward陣列稽核

### 對象範圍

劇本2（`gaping_jaw`，`scenarios.js`陣列索引1）可及的全部卡片：`a_start`、`a_golden`、
`card_2`〜`card_7`、`card_9`、`card_10`、`card_j`、`card_k`（共14張）。其中 `a_start`、
`card_2`、`card_3`、`card_4`、`card_5`(day2)、`card_9` 對劇本2而言是varianceTable的
「1D隨機」分岐而非固定花色，因此該行列出的整組分岐全部屬劇本2可及範圍，需全數audit——
這是本次稽核落差數量（31處）遠高於劇本1稽核（16處）的主因，並非scope判定不確定。

### 稽核方式

以「戦闘遭遇文字含『撃破ルーン：N』（或層內文字明確提及ルーン獲得），但同floor的
`reward[]`陣列缺少對應rune條目」為判定基準，逐一比對本文數字與陣列內容，僅補齊缺漏，
不觸碰劇本1或劇本8/9專屬分岐的既有內容。

### 發現並修補的落差（合計31處）

| 檔案 | 處數 | 涵蓋卡片 |
|---|---|---|
| `static_src/fields_data_1.js` | 6 | `a_start`（2）、`card_2`（4） |
| `static_src/fields_data_2.js` | 21 | `card_3`（6）、`card_4`（7）、`card_5`（8） |
| `static_src/fields_data_3.js` | 4 | `card_6`（2）、`card_7`（2） |

詳細逐項清單（floor位置、修改後行號、補上的rune值）見
`.superpowers/sdd/2026-08-13-scenario-2-4-card-structuring/task-1-report.md` 第3節，
此處摘要代表性案例：

- `card_2` 大教会（2）フロア1：`fields_data_1.js:771` 補 `rune:1`；フロア2：`fields_data_1.js:817-819` 補 `rune:3`。
- `card_4` 大野営地(雷)フロア2：`fields_data_2.js:1223` 補 `rune:4`（對應本文「撃破ルーン：4」）。
- `card_5` 遺跡（眠）フロア2：`fields_data_2.js:2150` 補**基礎** `rune:3`——原本陣列只有「つがい撃破時」條件式追加的`rune:2`，缺少無條件的基礎3。修補後兩者並存（基礎3＋條件2＝規則書「3+2=5」邏輯），未改動既有欄位語意。
- `card_6`／`card_7`：`fields_data_3.js` 共4處，坑道(2)與湖沼(毒)各2 floor。

### 已核對、無落差的floor

`a_golden`（1日目／2日目）、`card_2`（大教会(1)／(聖)）、`card_3`（小砦(1)）、
`card_4`（大野営地(1)／(炎1)）、`card_5`（遺跡（無印）／（聖））、`card_9`（封牢系列，
與劇本1共用分岐先前已修補）、`card_10`（無戦闘記述）、`card_j`（砦，與劇本1共用先前已修補）、
`card_k`（教会，先前已修補）——全數已核對reward陣列與本文一致，未修改。

### 刻意跳過、未觸碰的內容

- 所有含 `HP損害：■`、`FP損害：■`、`HP損害：□□`（無明確combat/floor breakthrough對應reward慣例）等既有placeholder，維持原樣，未新增猜測數值，符合CLAUDE.md §17-19。
- 劇本8/9專屬分岐（`丘の上の大教会`、`崖上の遺跡`系列、`地下砦`系列、`神殿`、大空洞教會3變體等）存在相同性質的reward落差，但劇本2的varianceTable明確不含這些分岐，依brief規定不予修改。**已知後續項目**：若之後執行劇本8/9稽核，應一併處理這些已標記位置（見task-1-report.md §3末段「明確跳過」清單）。

### 驗證

`node --check` 通過 `fields_data_1.js`〜`fields_data_3.js`（`fields_data_4.js`作對照未修改）；
`py -3 generate.py` 建置成功。

---

## 二、Task 2：edele（劇本2夜之王）auto-GM覆蓋層

### 對象

`static_src/boss_auto_gm_data.js` 新增 `"edele"` key，比照既有 `maris`／`gladius` 的
formAware/固定王schema（王城戦用，`groupDamage.value`直接值，非通常敵人的`.modifier`）。

### 結構內容（`boss_auto_gm_data.js:170-230`）

`rollBonusAfterGuardBreak: 4`（體勢崩潰後改用「1D＋4」判定，既有1〜10表範圍已完全涵蓋，
不需額外新增行）。5行涵蓋出目1〜10：

| 出目 | 行動名 | groupDamage | targetRule | 備註 |
|---|---|---|---|---|
| 1〜2 | 噛みつき | `value:1080` | `frontAggroAtLeast1All` | 本文明記「3人分」（已含N人分的合計值，與gladius/maris同一慣例） |
| 3〜4 | 突進 | `value:1260` | `allPCs` | **見下方「已知限制1」** |
| 5〜6 | 拘束噛みつき | `value:600` | `aggroMax` | `conditions:["no_guard","enemy_hp_value_debuff"]`（HP價值－10、最低10） |
| 7〜8 | 雷噛みつき | `value:1080, elementAccum:[雷2]` | `frontAll`（既定） | `conditions:["enemy_hp_value_buff"]`（HP價值＋10、最高100） |
| 9〜10 | 地擦り雷光 | `value:600, elementAccum:[雷1]` | `frontAll`（既定） | 附帶`individualDamage:[240, frontAggroAtLeast1All, elementAccum:雷1]` |

### 已知限制1：「突進」（出目3〜4）的加重分配 → GM手動fallback

本文：乱戦ダメージはPC全員が対象だが、「敵視：1以上」の前衛のみ「2人分」を負担する
加重分配。既存6種`targetRule.kind`（`frontAggroAtLeast1All`／`aggroAtLeast1All`／
`frontAll`／`aggroMax`／`frontAggroMaxAll`／`allPCs`）中，`allPCs`前提是均等割り，無法
表達「對象是PC全員、但其中特定子集合負擔雙倍份額」的加重分配。為避免捏造一個schema
未涵蓋的分配方式，本行的`groupDamage.value:1260`與`targetRule:{kind:"allPCs"}`維持
**對象範圍正確**（自動化部分），加重細節則記錄為
`conditions:["manual_weighted_split_front_aggro_double"]`，交由GM依本文手動重新分配。
這是Global Constraint相關限制中「有明確數值但既有schema無法精確表達分配規則」的典型案例，
與Task 3/4中數個敵人行的`accum_target_mismatch_manual`同屬「目標群不吻合既定6種kind」
性質，但此處連傷害總量的分配比例本身都超出schema表達力，故較Task 3/4的「伴隨效果fallback」
更進一步，整個targetRule的精確度打了折扣（僅範圍正確，非分配正確）。

### 已知限制2：「毒吐き」（無出目，特殊能力自動發動）→ 完全排除於rows[]

「猛毒の吐瀉」是由特殊能力觸發（本回合任一PC以「状態異常：猛毒」對此敵人造成HP損害時
自動發動），**不透過擲骰觸發**，因此性質上不屬於`rows[]`（`rollMin`/`rollMax`區間）所能
表達的對象。發動條件（追蹤「本回合是否有猛毒PC造成HP損害」）目前night.js未實作對應的
狀態追蹤機制。比照`gladius`「形態変化」（`form_change_at_end_phase`，同樣是非擲骰觸發的
特殊能力，交由GM手動觸發）的既有前例，本次同樣選擇**完全不放入`rows[]`**，而是在
`edele` entry末尾以註解完整記錄發動條件與內容（乱戦ダメージ840＋猛毒2D、對象「敵視：
1以上」PC全員（0人時前衛）、ガード不可、HP價值－10、體勢崩し後戦闘終了まで不再發動），
供GM對照規則書手動處理。

### 驗證

`node --check static_src/boss_auto_gm_data.js` 通過；`py -3 generate.py` 建置成功；
已確認`dist/static/boss_auto_gm_data.js`含`"edele"`key。

---

## 三、Task 3/4：劇本2「夜之強敵決定表」10體敵人 auto-GM覆蓋層

### 對象一覧

來源：`fields_data_1.js:452-456`「夜の強敵決定表」（劇本2 Day 1／Day 2 共10體，
`soldier_knight|crucible_knight`（坩堝の騎士）已於劇本1既有entry涵蓋，本次未觸碰）。

| # | 敵人（日文） | familyId\|enemyId | 來源檔案:行 | Task |
|---|---|---|---|---|
| 1 | 貪食ドラゴン | `dragon\|gluttonous_dragon` | `enemies_data_1.js:118-184` | 3 |
| 2 | 夜の騎兵たち | `cavalry\|night_cavalry` | `enemies_data_3.js:1430-1496` | 3 |
| 3 | 英雄のガーゴイル | `imp_watchdog_gargoyle\|hero_gargoyle` | `enemies_data_4.js:1378-1443` | 3 |
| 4 | 熔鉄デーモン | `golem_maiden_puppet\|molten_iron_demon` | `enemies_data_4.js:892-958` | 3 |
| 5 | ミミズ顔たち | `troll_dragonkin_wormface\|worm_faces` | `enemies_data_4.js:1758-1822` | 3 |
| 6 | 公のフレイディア | `crustacean\|duke_freydia` | `enemies_data_2.js:52-117` | 4 |
| 7 | 古竜 | `dragon\|ancient_dragon` | `enemies_data_1.js:186-251` | 4 |
| 8 | 僻地の宿将 | `soldier_knight\|remote_veteran` | `enemies_data_2.js:1714-1779` | 4 |
| 9 | ノクスの竜人兵 | `troll_dragonkin_wormface\|nox_dragonkin_soldier` | `enemies_data_4.js:1694-1756` | 4 |
| 10 | 死儀礼の鳥 | `death_bird_raven\|death_ritual_bird` | `enemies_data_1.js:977-1062` | 4 |

全部以additive方式新增至 `static_src/enemy_auto_gm_data.js`（Task 3新增於
`enemy_auto_gm_data.js:749-1126`，Task 4接續新增於`:1127-1449`），共62行roll區間，
未修改任何既有entry。`rollBonusAfterGuardBreak`（行動激化）逐一以`special`欄位與
全域`行動激化`關鍵字交叉確認：**10體中唯一具有此能力的是`molten_iron_demon`**
（`rollBonusAfterGuardBreak:4`，`enemies_data_4.js:955`），其餘9體皆無此機構。

### GM手動fallback（Global Constraint 6：既有6種`targetRule.kind`／savingThrow前提
不足以表達的行）一覽

以下為10體共62行roll區間中，因規則書描述超出既有schema表達力而**整行或部分**改用
`conditions[]`+註解交由GM手動處理的項目（「部分fallback」指`groupDamage`本身可自動
但伴隨效果不可；「完全fallback」指整行皆無`groupDamage`/`individualDamage`）：

| 敵人 | 行動 | 類型 | 原因 |
|---|---|---|---|
| `gluttonous_dragon` | 酸吐き出し（roll6） | 部分fallback | 「最大HP:-□（最低值1）、2回實行、3回累積上限」是max-stat持續性debuff，非HP損害欄位可承載 → `max_hp_penalty_manual` |
| `night_cavalry` | フレイル振り回し＆駆け抜け（roll4） | 部分fallback | 「敵視:1以上PC全員」承受出血1D，對象與乱戦ダメージ對象（前衛均等割り）不同 → `accum_target_mismatch_manual` |
| `hero_gargoyle` | 両刃剣回転攻撃（roll2） | 完全fallback | 「PC人数回実行」為可變次數，不可用固定repeat表示（Global Constraint 7） → `variable_repeat_manual` |
| `hero_gargoyle` | 衝撃波＆跳躍（roll5） | 部分fallback | 個別判定僅限「敵視:最大」單一PC，不符合savingThrow「全PC池」前提 |
| `hero_gargoyle` | 咆哮（roll6） | 完全fallback | 「HP損害:■■■」含`■`不可數值化（Global Constraint 1） → `unknown_hp_damage_manual` |
| `molten_iron_demon` | 炎爆発＆炉の炎（roll6） | 部分fallback | 判定失敗效果「HP損害:■■」含`■`；且savingThrow.onFail現有實作不套用elementAccum/ailmentAccum → `unknown_hp_damage_manual` |
| `molten_iron_demon` | 炎の連撃＆炉の炎（roll7〜8） | 完全fallback | 「PC人数回実行」可變次數 → `variable_repeat_manual` |
| `worm_faces` | 腕薙ぎ払い（roll3） | 部分fallback | 「呪死:2」對象「敵視:1以上PC全員」與前衛均等割り的乱戦對象不同 → `accum_target_mismatch_manual` |
| `worm_faces` | 死の瘴気（roll6） | 完全fallback | 判定失敗效果為純異常蓄積（呪死1D），savingThrow.onFail不支援 → `saving_throw_ailment_only_manual` |
| `duke_freydia` | 酸吐き（roll2） | 完全fallback | 全PC池・敵視分岐DC判定，失敗效果同時含HP損害＋猛毒3蓄積，savingThrow.onFail僅讀`amount` → `saving_throw_damage_and_ailment_manual`（本次新增tag） |
| `duke_freydia` | 子蜘蛛の牙（roll3） | 完全fallback | 「PC人數回實行」可變次數 → `variable_repeat_manual` |
| `ancient_dragon` | 空中旋回＆滞空（roll3） | 完全fallback | PC全員同一DC判定、「半數以上失敗」的**集團閾值**觸發時間流逝，不符合savingThrow之個別PC判定前提 → `majority_fail_time_loss_manual`（本次新增tag） |
| `ancient_dragon` | 地を這う赤雷（roll4） | 完全fallback | 全PC池・敵視分岐DC判定，失敗效果含HP損害＋雷1D → `saving_throw_damage_and_ailment_manual` |
| `ancient_dragon` | 赤雷叩きつけ（roll5） | 完全fallback | 個別判定僅「敵視:1以上」子集合（非全PC池），不符合savingThrow前提；比照既有`bell_bearing_hunter`「盾撃」先例純註解交由GM |
| `remote_veteran` | 氷嵐の剣技（roll5） | 部分fallback | 「敵視:1以上PC全員」被凍傷1D，對象群未限定前衛，與群傷對象（前衛敵視1以上）可能不同 → `accum_target_mismatch_manual` |
| `remote_veteran` | 冷気の嵐（roll6） | 完全fallback | 全PC池・敵視分岐DC判定，失敗效果含HP損害＋凍傷1D → `saving_throw_damage_and_ailment_manual` |
| `nox_dragonkin_soldier` | 氷の吐息（roll6） | 完全fallback | 全PC池・敵視分岐DC判定，失敗效果僅凍傷1D（無HP損害） → `saving_throw_ailment_only_manual` |
| `death_ritual_bird` | 槍呼び＆飛び退き（roll5） | 部分fallback | 「敵視:1以上PC全員」被炎1D＋凍傷1D，對象群比群傷對象（PC全員）更窄 → `accum_target_mismatch_manual` |
| `death_ritual_bird` | 古き死の怨霊（roll6） | 完全fallback | 「PC人數回實行」可變次數 → `variable_repeat_manual` |

上記のうち **`saving_throw_damage_and_ailment_manual`**、**`majority_fail_time_loss_manual`**、
**`mob_hp_full_heal`**（`remote_veteran`「薙ぎ払い＆再召喚」のモブHP全回復、敵方自身機制で
PC効果ではないため）、**`guard_cost_penalty`**（`nox_dragonkin_soldier`「両腕叩きつけ」の
ガードコスト+1、HP損害を伴わない防御コストペナルティのため）は本Task 3/4で新規追加した
conditionsタグ。いずれも該当箇所のコード注釈に理由を記載済み。

### 全自動化された行の設計判断（代表例）

- `groupDamage`のmod値に付随する属性/状態異常表記が、本文の個別判定失敗効果と**数値・種別が
  完全一致**する場合（例：`ancient_dragon`「地を這う赤雷」、`remote_veteran`「冷気の嵐」、
  `nox_dragonkin_soldier`「氷槍＆飛び退き」）は、同一効果の要約表記とみなし、
  `groupDamage.elementAccum`/`ailmentAccum`へ**重複して**掛けない、という保守的解釈を採用。
  これは規則書が明記していない「無条件の群体蓄積」を捏造しないための判断であり、Task 3
  報告・Task 4報告双方のコード注釈に記載済み。
- `soldier_knight|remote_veteran`「雷の蹴撃」、`troll_dragonkin_wormface|worm_faces`
  「吐き出し」等、mod欄の固定値と個別ダメージの骰子値が**数値・種別とも異なる**場合は、
  独立した2つの効果として両方を構造化（`groupDamage.elementAccum`＋別枠の
  `individualDamage[].elementAccum`）。

### 既存entryとの刻意な差異（Task 3で導入、既存entryは変更していない）

- **「PC人数回実行」**：既存の`imp_watchdog_gargoyle|returning_tree_watchdog`、
  `strong_type|loathed_demon`は可変次数を「条件を満たす全員が各1回」と解釈し
  `individualDamage`へ固定repeatとして書き込んでいた（【要確認】注記付き）。本Task
  3/4のGlobal Constraint 7に従い、新規追加分はすべて`conditions:["variable_repeat_manual"]`
  へfallbackし、この解釈を踏襲していない。
- **「■」記法**：既存の`demihuman_beastfolk_club|demihumans`は「HP損害:■■■」を
  `individualDamage.amount:3`へ数値化していた。本Task 3/4のGlobal Constraint 1に従い、
  新規追加分の「■」は一律`unknown_hp_damage_manual`等でfallbackし、数値化していない。

これら2点の相違は新規追加箇所のコード注釈内に明記済み。既存（劇本1関連）entryへの
遡及修正は本Taskのscope外のため未実施——**既知の後續項目**：将来、規則書でこの解釈差を
統一すべきと判断された場合、旧entry側の見直しが必要。

### 修補ラウンド：`molten_iron_demon`の`rollBonusAfterGuardBreak`欠落

Task 3のself-review後、reviewerの指摘により`golem_maiden_puppet|molten_iron_demon`が
`rollBonusAfterGuardBreak:4`（行動激化、`enemies_data_4.js:955`）の宣言を欠いていたことが
判明。欠落したままだと`rollMin:7〜8`／`9〜10`の2行（全体の1/3）が通常時（1D6=1〜6）には
到達不可能な死行になってしまう問題だった。既存の`demihuman_beastfolk_club|
demihuman_queen_swordmaster`と同一機構のため、同じ形式で`rollBonusAfterGuardBreak:4`を
追加し、修補後は`node --check`／`py -3 generate.py`／`dist`内grep確認済み（commit
`8567fa3..bcb9710`のfix round 1/5、詳細は`.superpowers/sdd/.../task-3-report.md`修補報告節）。

### 驗證

Task 3：`node --check static_src/enemy_auto_gm_data.js` 通過、`py -3 generate.py` 成功、
`dist/static/enemy_auto_gm_data.js`確認5個新key寫入。Task 4：同樣`node --check`／
`py -3 generate.py`成功。両Task共に**未執行**瀏覽器/Playwright動態驗證（brief記載の
理想的検証手順だが、両Task報告とも時間・環境制約により静的検証（構文チェック＋ビルド）
のみ実施と明記——**既知の後續項目**：ブラウザでの実戦闘操作による動的確認は未実施。

---

## 四、既知の後續項目（Task 1〜4のprogress.md ledgerより抽出）

以下はTask 1〜4完了時点でSDD ledger（`.superpowers/sdd/2026-08-13-scenario-2-4-card-structuring/progress.md`）
に "minor (deferred)" として記録された、本Phaseのscope外だが将来の参照のため記録する項目：

1. **`boss_auto_gm_data.js:22-23`のヘッダーコメント**：edeleを対象外（未対応）として列挙したままの記述が
   本Task 2完了後もstale。gnoster（劇本3の王、Task 7で対応予定）追加時に合わせて更新すべき。
2. **`enemy_auto_gm_data.js`の旧entry（劇本1関連）の数値解釈不整合**：
   `imp_watchdog_gargoyle|returning_tree_watchdog:181-185`、`strong_type|loathed_demon:640-644`、
   `demihuman_beastfolk_club|demihumans:193-197`が「PC人数回実行」／`■`をGlobal
   Constraintと異なる解釈で数値化済み（上記三章参照）。最終レビュー時にtriageすべき項目として
   flagされたが、本Phaseでは修正されていない。
3. **`enemy_auto_gm_data.js:1-34`のスキーマ凡例コメント**：現在使用中の全`conditions[]`タグ
   （例：`saving_throw_damage_and_ailment_manual`、`majority_fail_time_loss_manual`、
   `mob_hp_full_heal`、`guard_cost_penalty`）を列挙していない。将来の一貫性・発見性のため、
   まとめて追記するクリーンアップが望ましい。
4. **`soldier_knight|red_lion_knights`「アローレイン」行（`enemy_auto_gm_data.js:342-349`）**：
   `savingThrow.onFail`で付随する「魔2」蓄積が無言でdropされ、manual-fallbackタグも付いていない
   （本Task以前から存在する既知のギャップ、Task 4レビュー時に発見されたが本Phaseの導入分では
   なく修正もされていない）。

---

## 五、最終ビルド検証（Task 5）

Task 1〜4の全変更（`fields_data_1.js`〜`fields_data_3.js`のreward補完、
`boss_auto_gm_data.js`のedele追加、`enemy_auto_gm_data.js`の10体追加）を対象に、
`py -3 generate.py`を実行し、エラーなくビルドが完了することを確認した（実行結果は
`.superpowers/sdd/2026-08-13-scenario-2-4-card-structuring/task-5-report.md`参照）。
これでPhase 1（劇本2）の全Task完了。
