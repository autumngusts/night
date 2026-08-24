# 劇本3「静寂の鳥籠／沈默の蟲」（sentient_pest）：場地卡reward陣列與敵人 auto-GM 稽核記錄（2026-08-22）

本文件記錄劇本1〜4結構化計畫（`docs/superpowers/plans/2026-08-13-scenario-2-4-card-structuring.md`）
Phase 2（劇本3）Task 6／Task 8的稽核與實裝內容，格式比照
`docs/combat_move_structuring_scenario2.md`（劇本2稽核記錄）：列出對象範圍、參照的規則書出典、
判定根據，以及刻意保留GM手動處理（fallback）的項目與理由。

**與元計畫的差異說明**：元計畫的Task 9原本預定彙整Task 6（reward陣列監査）／Task 7（王gnoster
構造化）／Task 8（夜之強敵5体構造化）三者的內容。但本次使用者明確指示將Task 7（劇本3的王
gnoster）排除於本次範圍外，後日另行處理。因此本文件為縮小版，**僅記錄Task 6與Task 8的內容**，
王gnoster的部分另立一節說明其暫緩理由，不包含任何構造化內容。

調查方法與劇本2稽核相同：先確認 `static_src/scenarios.js` 的劇本3卡片配置與
`static_src/fields_data_*.js` 的varianceTable分岐，再對照 `enemy_auto_gm_data.js`
既有結構化管線（`docs/enemy_damage_rules.md`定義的傷害套用規則），逐行比對規則書原文本文與
程式碼是否一致。本次任務未新增或修改規則文件本身，僅在既有auto-GM覆蓋層架構下新增資料。

---

## 一、Task 6：劇本3（sentient_pest）場地卡reward陣列稽核

### 對象範圍

劇本3（`sentient_pest`，`Scenarios.numberForId("sentient_pest")` 回傳 `3`）的
`start`／`day1`（9枠）／`day2`（6枠）／`end` 各枠rank列表：

- start: A（♥）
- day1: 2（♦）、3（♣）、4（♠）、5（♥）、6（♦）、8（♥）、9（♦）、10（♠）、K（♣）
- day2: 3（♦）、5（♠）、7（♦）、9（♥）、J（♣）、K（♦）
- end: A（♣）

對應涉及卡片：`a_start`、`a_golden`、`card_2`〜`card_10`、`card_j`、`card_k`（不含 `card_q`，
劇本3的卡片配置沒有對應該rank的枠）。

### 稽核方式

與劇本2稽核相同的判定基準：「戦闘遭遇文字含『撃破ルーン：N』（或層內文字明確提及ルーン獲得），
但同floor的`reward[]`陣列缺少對應rune條目」，逐一比對本文數字與陣列內容，僅補齊缺漏，不觸碰
劇本1／劇本2或劇本8/9專屬分岐的既有內容。

`card_8`（rank8、suit H＝鍛冶村）在劇本3對應`varianceTable`的「シナリオ「3、5、10」→
※ランダム決定（ダイス2回）」列，即1D×2完全隨機決定8種分岐（鍛冶村(1)/(2)/(雷1)/(雷2)/(聖)/(血)/
(炎)/(毒)）、16個floor，因此全部須逐一稽核，這是本次稽核落差集中於`card_8`的主因。

### 發現並修補的落差（合計9處，初次實裝＋fix round皆位於 `fields_data_3.js` 的 `card_8` 鍛冶村系列）

初次實裝（commit `7b227c5`）發現並修補9處落差：

| 檔案:行（修改後） | 分岐 | Floor | 補上內容 |
|---|---|---|---|
| `fields_data_3.js:1696` | 鍛冶村(雷2) | フロア1 | `rune: 1`（對應「ザコ戦闘（撃破ルーン：1）」） |
| `fields_data_3.js:1739` | 鍛冶村(雷2) | フロア2 | `rune: 3`（對應「ボス戦闘（撃破ルーン：3）」） |
| `fields_data_3.js:1772-1775` | 鍛冶村(聖) | フロア1 | `rune: 2`（對應「ザコ戦闘（撃破ルーン：2）」） |
| `fields_data_3.js:1817` | 鍛冶村(聖) | フロア2 | `rune: 3`（對應「ボス戦闘（撃破ルーン：3）」） |
| `fields_data_3.js:1866` | 鍛冶村(血) | フロア1 | `rune: 2`（對應「ザコ戦闘（撃破ルーン：2）」） |
| `fields_data_3.js:1909` | 鍛冶村(血) | フロア2 | `rune: 4`（對應「ボス戦闘（撃破ルーン：4）」） |
| `fields_data_3.js:1968-1979` | 鍛冶村(炎) | フロア1 | 基礎 `rune: 1`＋`tieredChoice`條件式加成（比照`fields_data_4.js`既有寫法，對應「モブが増えている場合は撃破ルーン：+1」） |
| `fields_data_3.js:2064` | 鍛冶村(毒) | フロア1 | `rune: 1`（對應「ザコ戦闘（撃破ルーン：1）」） |
| `fields_data_3.js:2107` | 鍛冶村(毒) | フロア2 | `rune: 4`（對應「ボス戦闘（撃破ルーン：4）」） |

fix round（commit `dc8d732`）經審查後追加補齊初次實裝時被遺漏的2處（同樣位於`card_8`鍛冶村系列，
判定基準與上表相同）：

| 檔案:行（修改後） | 分岐 | Floor | 補上內容 |
|---|---|---|---|
| `fields_data_3.js:1497` | 鍛冶村(2) | フロア1 | `rune: 1`（原本`reward[]`只有`consumable`與`hpDamage`兩項） |
| `fields_data_3.js:2016` | 鍛冶村(炎) | フロア2 | `rune: 4`（原本`reward[]`只有`potentialPower`與`weaponSkillReroll`兩項；フロア1的條件式rune於初次實裝已正確補上，僅フロア2被遺漏） |

fix round改用「先分別`grep -n`取得『撃破ルーン』文字行號與`rune` reward entry行號兩份清單、
再依卡片/分岐邊界分組逐一配對」的結構化交叉比對法，取代初次實裝偏人工逐段閱讀的方式，
以降低長段落間漏看的風險。fix round確認除上述2處外，劇本3可及範圍內所有「撃破ルーン」文字皆已
與`reward[]`的`rune` entry一一對應，無其他遺漏。

### 已核對、無落差的卡片／分岐

- `a_start`：劇本3屬「2-7,10」隨機列，3個分岐（小野営地の君主軍／ボロボロの小屋／教会の大ネズミ）皆已有正確rune（劇本2稽核時已一併修補）。
- `a_golden`：1日目／2日目皆已有rune，與劇本無關。
- `card_2`：劇本3屬「2-5,10」隨機列，4個分岐（大教会(1)/(2)/(炎)/(聖)）皆已有正確rune。
- `card_3`：劇本3屬「2-4,6,7,10」隨機列，4個分岐（小砦(1)/(2)/(3)/(魔)）皆已有正確rune。
- `card_4`：劇本3對應固定列（scenario"3"→♠→大野営地(炎2)，非隨機），已有正確rune。
- `card_5`：劇本3的day1/day2皆屬「3,4,6,7,10」全隨機列（1D×2，共9種），逐一稽核9個分岐×2 floor皆已有正確rune（含劇本2稽核時已修補的「遺跡（眠）」條件式rune）。
- `card_6`：劇本3對應固定列（scenario"3"→◇→坑道(3)），已有正確rune。
- `card_7`：劇本3對應固定列（scenario"3"→◇→湖沼(凍)），已有正確rune。
- `card_9`：劇本3對應「1-7,10」列（封牢(無印)/封牢(森)，非「8,9」列的神殿），2分岐皆已有正確rune（`神殿`分岐屬劇本8/9專屬，不在劇本3範圍，未觸碰）。
- `card_10`：無戦闘記述（diceHandChoice寶物表），與劇本無關。
- `card_j`：劇本3對應「1-7,10」列，砦分岐的各floor皆已有正確rune（西/東の地下砦屬劇本8/9專屬，未觸碰）。
- `card_k`：劇本3對應「1-7,10」列（教会，非「8,9」列的大空洞3變體），已有正確rune；崩れた教会等大空洞分岐屬劇本8/9專屬，未觸碰。

### 刻意跳過、未觸碰的內容

- 所有含 `■`／`□`等placeholder的HP/FP損害記述，維持原樣，未新增猜測數值（CLAUDE.md §17-19）。
- 劇本8/9專屬分岐（`神殿`、`西の地下砦`／`東の地下砦`、`崩れた教会`／`崖上の教会`／`商人のいる教会`（大空洞）、`崖上の遺跡（毒）／（血）`、`下層の遺跡`等）存在類似的reward落差，但劇本3的varianceTable明確不含這些分岐，依brief規定不予修改。

### 驗證

```
node --check static_src/fields_data_1.js && node --check static_src/fields_data_2.js && node --check static_src/fields_data_3.js && node --check static_src/fields_data_4.js
```
→ 全部通過，無語法錯誤（初次實裝與fix round皆重新執行過）。

```
py -3 generate.py
```
→ `Generated site into D:\work\PriTest\PriTest\dist`，建置成功（初次實裝與fix round皆確認）。

### Commit

- `7b227c5`：`fix(fields): 補完劇本3(sentient_pest)該當分岐的reward陣列與本文記述落差`（初次實裝，9處）
- `dc8d732`：`fix(fields): 補完劇本3(sentient_pest)鍛冶村系列2處遺漏的reward陣列`（fix round，2處）

---

## 二、王(gnoster)について

劇本3の王 gnoster の auto-GM 結構化（元計畫のTask 7に相当）は、**使用者の明示的な指示により
今回のスコープ外**とする。gnosterに関する構造化データ・auto-GM覆蓋層は本Phaseでは一切追加して
いない。後日、別途Taskとして対応予定。

なお `static_src/boss_auto_gm_data.js:22-23` のヘッダーコメントには劇本2稽核時点で
gnosterを「対象外（未対応）」として列挙したままの記述が残っている（劇本2稽核記録の
「四、既知の後續項目」1.参照）。gnoster対応時に合わせて更新すべき既知項目である。

---

## 三、Task 8：劇本3夜之強敵5体 auto-GM覆蓋層

### 對象一覧

來源：`static_src/fields_data_1.js:463-471`「劇本3 Day1/Day2の夜之強敵決定表」。うち
熔鉄デーモン（`golem_maiden_puppet|molten_iron_demon`、劇本2 Task 3で構造化済み）、
ノクスの竜人兵（`troll_dragonkin_wormface|nox_dragonkin_soldier`、劇本2 Task 4で構造化済み）、
ツリーガード&王都の騎兵（既存`cavalry|tree_guard_capital_cavalry`）は既存entryで対応済みのため
対象外とし、以下5体を新規構造化した。

| # | 敵人（日文） | familyId\|enemyId | 來源檔案:行 |
|---|---|---|---|
| 1 | 百足のデーモン | `crustacean\|centipede_demon` | `enemies_data_2.js:118-183` |
| 2 | 戦場の宿将 | `soldier_knight\|battlefield_veteran` | `enemies_data_2.js:1646-1712` |
| 3 | 爛れた樹霊 | `tree_spirit\|withered_tree_spirit` | `enemies_data_1.js:434-500` |
| 4 | ティビアの呼び舟 | `undead\|tibias_summoning_boat` | `enemies_data_4.js:31-33, 245-310` |
| 5 | 大土竜 | `dragon\|great_earth_dragon` | `enemies_data_1.js:32-117` |

全部以additive方式新增至 `static_src/enemy_auto_gm_data.js` 末尾（旧`};`直前、コミット差分
+326行），未修改任何既有entry。5体すべての`special`テキストを確認したが「行動激化」
（體勢崩潰後`1D＋N`）に該当する記述は無く、`rollBonusAfterGuardBreak`はいずれにも設定していない。
「■」を含む記述はこの5体には出現しなかった。

### 構造化內容概要

- **`centipede_demon`（百足のデーモン）**：rows4行（roll1〜6を4区間でカバー）。
  回転攻撃／つかみかかり（`no_guard`）／炎吐き（`elementAccum:[炎+2]`、`allPCs`）／
  跳躍体当たり（`stamina_dice_reduction_next_phase`）。
- **`battlefield_veteran`（戦場の宿将）**：rows6行すべて構造化。突撃指令＆防御態勢
  （`repeat:2`、`enemy_hp_value_buff`）／斧槍の連撃（`腐敗+1`）／一斉射撃／薙ぎ払い＆再召喚
  （`allPCs`、`mob_hp_full_heal`）／腐敗薙ぎ払い（roll5、下記fallback）／腐敗の嵐
  （無条件`individualDamage`）。
- **`withered_tree_spirit`（爛れた樹霊）**：rows6行すべて構造化。突進／尻尾薙ぎ払い
  （`repeat:2`）／咥え込み＆回り込み（下記fallback）／咆哮＆黄金の柱（`聖+1`個別ダメージ）／
  黄金の爆発＆回り込み（`聖+2`、`force_back_row_next_phase`）／黄金ブレス
  （`聖+1`、`no_guard`＋`reducible_by_stamina_dice`）。
- **`tibias_summoning_boat`（ティビアの呼び舟）**：rows6行すべて構造化。飛沫の一撃＆転移／
  櫂振り回し＆再召喚（`mob_hp_full_heal`）／死に生きる者:暴れまわる＆転移（`repeat:2`、
  `force_back_row_next_phase`）／死に生きる者:掴みかかり＆再召喚（`no_guard`、
  `mob_hp_full_heal`）／死儀礼の鳥:呪霊爆発＆転移（`聖+1`個別ダメージ、
  `force_back_row_next_phase`）／死儀礼の鳥:槍呼び＆再召喚（roll6、下記fallback）。
- **`great_earth_dragon`（大土竜）**：rows6行すべて構造化。剣薙ぎ払い／武器叩きつけ
  （`stamina_dice_reduction_next_phase`）／尻尾振り回し（`reducible_by_stamina_dice`）／
  溶岩吐き＆溶岩の滞留（`炎+1`＋個別180、`lava_pooling_trigger`）／這いずり回り＆溶岩の滞留
  （`repeat:2`、`lava_pooling_trigger`）／立ち上がり剣撃＆溶岩の滞留（`lava_pooling_trigger`）。
  `lava_pooling_trigger`は本Taskで新規追加したconditionsタグ（既存`furnace_flame_trigger`と
  同じ設計思想の遅延・持続効果トリガー記録）。

### GM手動fallbackにした箇所と理由

| 敵人 | 行動 | 類型 | 原因 |
|---|---|---|---|
| `centipede_demon` | 蠢く尻尾／動き回る腕（roll:"—"、追加行動） | 完全fallback（rows[]から除外） | 「体勢崩し発生ターン」「モブHP0以下になったターン」に**追加行動として割り込む**特殊トリガーであり、既存の`rollOverride`/`rollBonusAfterGuardBreak`（いずれも「1D自体の振り方」を変える機構）では表現不可。`demihuman_beastfolk_club\|demihuman_queen_swordmaster`の「棄杖＆流星撃」と同種の前例に倣い、rows配列から除外しコメントでGM手動処理を明記した。 |
| `battlefield_veteran` | 腐敗薙ぎ払い（roll5） | 部分fallback | 全PCプール・敵視分岐DC判定（12/10・フィジカル）で失敗時、個別ダメージ120＋腐敗1Dの組み合わせ。`savingThrow.onFail`は単一`amount`しか読まないため`conditions:["saving_throw_damage_and_ailment_manual"]`（劇本2 Task 4で確立済みのタグを再利用）でGM手動に委ねた。 |
| `withered_tree_spirit` | 咥え込み＆回り込み（roll3） | 部分fallback | 個別効果が「PC人数回実行」（可変回数、Global Constraint 7）のため`conditions:["variable_repeat_manual", "force_back_row_next_phase"]`。 |
| `tibias_summoning_boat` | 死儀礼の鳥:槍呼び＆再召喚（roll6の判定部分） | 部分fallback | 個別効果は「敵視:1以上」のPCのみが対象の判定（全PCプールではなく部分集合）であり、`savingThrow`（全PC対象・敵視分岐DC前提）の構造に合わない。`soldier_knight\|liege_army`「赤雷叩きつけ」の既存前例と同じ判断で、conditionsタグは付与せずコメントのみでGM手動判定に委ねた。 |

いずれも数値・効果の捏造を避けるため、既存schema（`rollOverride`／`rollBonusAfterGuardBreak`／
`savingThrow`／6種`targetRule.kind`）が正確に表現できる範囲のみ自動化し、表現力を超える部分は
conditionsタグ＋コメントでGM手動処理として明記する、という劇本2稽核と同一の設計方針を踏襲した。
新しいスキーマ機構は追加していない（`lava_pooling_trigger`は既存`furnace_flame_trigger`と同じ
「conditionsタグとして記録するのみ」という既存パターンの適用であり、新規機構ではない）。

### 驗證

`node --check static_src/enemy_auto_gm_data.js` → エラー無し。`py -3 generate.py` →
`Generated site into D:\work\PriTest\PriTest\dist`で正常終了、`dist/static/enemy_auto_gm_data.js`に
5体分のキーが反映されていることを確認済み（`grep -c`で5件ヒット）。

ブラウザでの実動作確認（Playwrightによる`window.PriTestEnemyAutoGmData.get()`呼び出し・戦闘UI上
での乱戦ダメージ計算確認）は、環境制約（Windows環境でのPlaywright起動セットアップの往復コストが
本タスクの残り時間に見合わない）により**未実施**。劇本2 Task 3/4の前例に倣い、静的検証
（`node --check` + `generate.py`）のみで完了とした——**既知の後續項目**として次節に記録する。

### Commit

```
1bcaef5 feat(night): 新增劇本3夜之強敵(百足のデーモン等5隻)的自動化GM結構化資料
```

---

## 四、既知の後續項目

1. **劇本3の王(gnoster)は今回未対応**（本文書「二、王(gnoster)について」参照）。使用者の指示に
   より後日別途Taskとして対応予定。対応時は`boss_auto_gm_data.js:22-23`のヘッダーコメントの
   stale記述もあわせて更新すべき。
2. **ブラウザでの実戦闘操作による動的確認は未実施**：Task 8で追加した5体について、
   `window.PriTestEnemyAutoGmData.get()`呼び出しや戦闘UI上での乱戦ダメージ計算のPlaywright
   確認は環境制約により行っていない。静的検証（構文チェック＋ビルド）のみ完了。
3. 元プランのTask 1〜4完了時に記録された劇本2関連の「minor (deferred)」項目
   （`.superpowers/sdd/2026-08-13-scenario-2-4-card-structuring/progress.md`参照）は
   本Phaseのscope外のため、本文書では改めて記載しない。
