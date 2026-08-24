# 劇本5~9 場地卡reward陣列監査 + 夜之強敵auto-GM構造化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 劇本5（`equilibrious_beast`）、劇本6（`darkdrift_knight`）、劇本7（`fissure_in_the_fog`）、劇本8（`balancers`）、劇本9（`dreglord`）の5劇本について、層B（reward陣列監査）と層C（敵人のauto-GM覆蓋層）を劇本1~4と同等の完成度まで引き上げる。**夜の王（harmonia／caligo／libra／fulghor／stragedes）の構造化・精度監査は使用者の明示的な指示により本プランのスコープ外**とし、別途後日対応する。

**Architecture:** 新しいデータ構造やコードパイプラインは追加しない。`enemy_auto_gm_data.js`／`fields_data_1~4.js` に既存スキーマのままデータを追記するだけで、既存の `auto_gm.js` の `isStructured()` ゲートが自動的に自動化GMモードへ切り替える。本プランは `docs/superpowers/plans/2026-08-13-scenario-2-4-card-structuring.md`（劇本2~4、Task 7=gnoster・Task 11=maris精度監査を除き完了済み）の直接の後継であり、同じGlobal Constraints・同じ判定基準を踏襲する。

**Tech Stack:** Vanilla ES5（`static_src/*.js`）、Python静的サイトビルド（`generate.py`）、正式テストフレームワーク無し（`node --check` ＋ ビルド＋可能な範囲でブラウザ/Playwright手動検証）。

**参照文書:**
- `docs/enemy_damage_rules.md`（敵傷害規則の転写）
- `docs/combat_move_structuring_scenario2.md`／`docs/combat_move_structuring_scenario3.md`／`docs/combat_move_structuring_scenario4.md`（劇本2~4の完成済み監査記録、フォーマットと判定根拠の直接の前例）
- `static_src/fields_data_1.js:439-553`（「夜の強敵決定表：1日目／2日目」、全劇本共通の単一テーブル。劇本5~9の行はシナリオ列5~9）

## 事前調査で判明した重複関係（重要）

「夜の強敵決定表」は全劇本共通の1つのテーブルであり、同じ敵人が複数の劇本にまたがって登場する。劇本1~4（`enemy_auto_gm_data.js`に既存の27キー）で既に構造化済みの敵人は、劇本5~9のテーブル行に再登場しても**再構造化不要**（1体につき1回構造化すればよい）。事前調査（`static_src/fields_data_1.js:487-551`の該当行を既存27キーおよび劇本1~4で既に対応予定の3体――接ぎ木の君主／神肌の使徒たち／降る星の成獣――と照合）により、劇本5~9で**新規に構造化が必要な敵人は以下の10体のみ**であることを確認済み（各Taskで実装者が改めてfamilyId/enemyIdを確定すること）：

| 敵人名(ja) | 初出シナリオ | 備考 |
|---|---|---|
| 王族の幽鬼 | 劇本5 | |
| 冷たい谷の踊り子 | 劇本6 | 劇本7にも登場するが劇本6で構造化すれば流用可 |
| 無名の王 | 劇本6 | 名前に「王」が付くが夜の王(boss_auto_gm_data.js)ではない通常の夜之強敵 |
| 傷ついたデーモン＆うろ底のデーモン | 劇本8 | 「2回行動」特殊能力あり、下記Task注記参照 |
| 神獣の戦士たち | 劇本8 | 戦闘1ターン目のみディフェンスフェイズで行動しない特殊タイミングあり |
| デーモンの王子 | 劇本8 | GM専用出現条件（同シナリオで「傷ついたデーモン＆うろ底のデーモン」撃破後のみ登場可）あり |
| 血の君主 | 劇本8 | 体勢崩し直後に出目なしで自動実行される追加行動あり |
| ルーンベア | 劇本9 | |
| 死の騎士 | 劇本9 | |
| 神獣獅子舞 | 劇本9 | |
| 騎士アルトリウス | 劇本9 | モブHP条件による固定行動（出目なし）あり |

劇本7（`fissure_in_the_fog`）は、決定表に登場する敵人（熔鉄デーモン／爛れた樹霊／接ぎ木の君主／ティビアの呼び舟／公のフレイディア／ツリーガード&王都の騎兵／神肌の使徒たち／冷たい谷の踊り子）が**全て他の劇本の既存対応で賄われる**ため、本プランでは新規の敵人構造化Taskを設けない（Phase 3でreward陣列監査と、既存対応で全カバーされていることの確認のみ行う）。

## Global Constraints

以下は本プラン全タスクに共通する転写・判断ルール。`docs/superpowers/plans/2026-08-13-scenario-2-4-card-structuring.md`のGlobal Constraintsと同一（劇本1~4で確立済みの既存コードの慣例と`docs/enemy_damage_rules.md`から抽出）。**逸脱・独自解釈は禁止**。

1. **数値の捏造禁止**：`■` を含む記述、または規則書原文が曖昧で数値が確定できない箇所は、絶対に数値化しない。`conditions[]` に説明的な文字列を追加し、コード内コメントで規則書原文（zh/ja）を引用し、GM手動処理に委ねる。
2. **groupDamage の値種別**：通常エネミー（`enemy_auto_gm_data.js`）は `groupDamage.modifier`（`family.base[level].dmg` への加算修正値、乱戦ダメージ修正欄の数値をそのまま使う）。本プランは夜の王を扱わないため`groupDamage.value`（絶対値）パターンは使用しない。
3. **「—」ルール**：行動一覧表の「乱戦ダメージ修正」列が「—」の行は、`groupDamage` を一切設定しない（乱戦ダメージ無し）。`individualDamage` は独立した別枠のため、この「—」ルールの影響を受けず、記述があれば通常どおり設定する。
4. **既定target規則**：本文に乱戦ダメージの分配対象の明記が無い場合は `targetRule: { kind: "frontAll" }`（前衛均等割り）とする。
5. **targetRule.kind の完全な既存カタログ**（`static_src/auto_gm.js:259-286`、この6種以外は新設しない）：
   - `frontAggroAtLeast1All`：前衛かつ敵視1以上の全員
   - `aggroAtLeast1All`：敵視1以上の全員（前衛/後衛問わず）。`fallback: "front"` を付けると対象0人時に前衛へフォールバック
   - `frontAll`：前衛全員（均等割り既定ルール）
   - `aggroMax`：敵視最大のPC（前衛/後衛問わず全体で最大値判定）
   - `frontAggroMaxAll`：前衛内で敵視最大のPC
   - `allPCs`：PC全員
6. **既存6種で表現できない対象規則が見つかった場合**（例：加重分配、エリア多数決、除外指定、後衛限定ターゲット、対象規則が回ごとに異なる複数回乱戦ダメージ、可変回数「PC人数回実行」等）：
   - `auto_gm.js` に新しい `targetRule.kind` や新機構を追加しない（本プランのスコープ外、CLAUDE.md原則11「不要為單一效果建立第三套特殊架構」に従う）。
   - `groupDamage`（数値が確定している場合）は設定してよいが、`targetRule` は省略するか対象範囲が最も近い既存kindに留め、`conditions[]` に規則の詳細を要約した識別子を追加し、コード内コメントで規則書原文を引用してGMが手動で対象・分配を決定する。
   - 出目なしで自動発動する特殊能力（GM専用出現条件、体勢崩し直後の自動追加行動、ターン1限定の特殊タイミング等）も、`rows[]`には含めずGM手動トリガーとしてコードコメントに完全記録する（`gladius`の「形態変化」、`edele`の「毒吐き」、劇本3 Task8の`centipede_demon`追加行動と同じ扱い）。
   - この扱いをした行は、該当劇本の監査記録文書に一覧化する。
7. **rollBonusAfterGuardBreak**：「行動激化」（體勢崩潰後 `1D` ではなく `1D＋N` で判定）は既存フィールド `rollBonusAfterGuardBreak: N` をエネミーのトップレベルに設定する（`auto_gm.js:124-129` が `battleState.guardBroken` を見て自動加算する）。既存の出目テーブルが `1D＋N` の到達範囲を完全にカバーしていれば、行の追加は不要。
8. **elementAccum / ailmentAccum**：ダイス表記（「雷：2D」「猛毒：1D」等）は固定ダメージ値に変換せず、`elementAccum: [{ label: "雷", amount: 2 }]`（属性）または `ailmentAccum: [{ label: "猛毒", amount: 2 }]`（状態異常）としてダイス数のみを構造化する。ダイス自体は引き続きGM/PCが実際に振る。
9. **savingThrow**：判定（運試し／フィジカル／メンタル）で成否が分かれ、かつ対象がPC全員（敵視条件で目標値が変わるのみ）の場合のみ使う。対象が前衛限定など既存savingThrow構造で表現できない場合は使わず、GM手動判定に委ねる。
10. **node --check** を変更した各JSファイルに対して実行し、`py -3 generate.py` でビルドが通ることを確認してから各タスクをcommitする。ブラウザ/Playwright動的確認は理想的だが、劇本2~4の前例（Task 3/4/8/12）に倣い、環境制約で困難な場合は静的検証のみで可（レポートにその旨明記）。
11. コミットメッセージは繁體中文で記述する（`git log` の既存慣例に従う）。
12. **既に構造化済みの敵人の再構造化禁止**：`enemy_auto_gm_data.js`に既存のキー（劇本1~4で追加済みの27キー、および本プランの先行Phaseで追加したキー）と同一のfamilyId/enemyIdが夜の強敵決定表の別の劇本の行に登場した場合、再構造化・重複追加をしない。

---

## Phase 1：劇本5（equilibrious_beast）

### Task 1: 劇本5 場地卡reward陣列監査

**Files:**
- Modify: `static_src/fields_data_1.js`、`static_src/fields_data_2.js`、`static_src/fields_data_3.js`、`static_src/fields_data_4.js`（該当箇所のみ、正確な行は監査で特定する）
- 参照: `static_src/scenarios.js`（`equilibrious_beast` の `day1`/`day2`/`start`/`end` 定義）

**Interfaces:**
- Consumes: `Scenarios.numberForId("equilibrious_beast")`（`static_src/scenarios.js`の配列順序により`5`を返すはずだが、実装時に`static_src/scenarios.js`を目視確認して確定すること）
- Produces: 監査で発見した記述漏れを `reward[]` へ追記（劇本1~4監査と同一の `reward[].kind` 分類：`rune`/`weaponStar`/`consumable`/`talisman`/`potentialPower`/`stoneswordKey`/`smithingStone`/`chaliceBonus`/`weaponSkillReroll`/`hpDamage`/`tieredChoice`/`diceHandChoice`/`bargainReveal`/`note`）

- [ ] **Step 1: 劇本5のカード配置を確認**

`static_src/scenarios.js` の `equilibrious_beast` エントリ（`id: "equilibrious_beast"`）を読み、`day1`・`day2`・`start`・`end` 各枠の `rank`（点数）を一覧化する。

- [ ] **Step 2: 各点数のvarianceTableで劇本5の分岐を特定**

`static_src/fields_data_1~4.js` を対象に、Step1で得た各 `rank` に対応する `card_<rank>`（または `a_start`/`a_golden`）エントリの `varianceTable.rows` を検索し、「シナリオ」列が `5` を含む行（単独行、または範囲表記）を特定して、対応する `branches[]` のインデックスを確定する。花色（`suit`）で分岐が分かれる場合は `scenarios.js` の該当枠の `suit` も併用する。**カードに複数分岐（同じ`varianceTable`行が複数の花色/ランダム決定branchをまとめている場合）があれば、1つを見つけて終わりにせず、必ず同じカードの残り全ての分岐も機械的に確認すること**（劇本3 Task6のレビューで、同じカード内の別branchの見落としが実際に発生した前例あり）。

- [ ] **Step 3: 本文とreward配列を突き合わせ**

Step2で特定した各 `branches[].floors[]` について、`lines[]` 本文中の報酬に関する記述（「擊破盧恩：N」「獲得」「潜在の力」等）と、同floorの `reward[]` 配列を照合する。記述はあるが対応する `reward[]` エントリが無い箇所のみ、正式なエントリとして追記する。`■` を含む記述は Global Constraint 1 に従い数値化しない。劇本5に該当しない分岐（劇本5が選ばない分岐）は変更しない。

- [ ] **Step 4: 構文チェック**

Run: `node --check static_src/fields_data_1.js && node --check static_src/fields_data_2.js && node --check static_src/fields_data_3.js && node --check static_src/fields_data_4.js`
Expected: エラー無し（変更したファイルのみでよい）

- [ ] **Step 5: ビルド確認**

Run: `py -3 generate.py`
Expected: `dist/` が正常生成される

- [ ] **Step 6: commit**

```bash
git add static_src/fields_data_1.js static_src/fields_data_2.js static_src/fields_data_3.js static_src/fields_data_4.js
git commit -m "fix(fields): 補完劇本5(equilibrious_beast)該當分岐的reward陣列與本文記述落差"
```

---

### Task 2: 劇本5夜之強敵「王族の幽鬼」auto-GM覆蓋層構造化

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- 参照: `static_src/fields_data_1.js:487-496`（劇本5 Day1/Day2の夜之強敵リスト）、`static_src/enemies_data_1~4.js`

**対象敵（劇本5 Day1、`fields_data_1.js:487-491`より）：** 王族の幽鬼（百足のデーモン／戦場の宿将／ティビアの呼び舟／公のフレイディアは劇本2/3で構造化済みのため対象外）。Day2の坩堝の騎士／神肌の使徒たち／死儀礼の鳥も全て既存対応済みのため対象外。

- [ ] **Step 1: 王族の幽鬼の familyId/enemyId と規則書テキストを特定**

`static_src/enemies_data_1.js`〜`enemies_data_4.js`を「王族の幽鬼」で検索し、所属する`FAMILIES[].id`（familyId）と該当`enemies[].id`（enemyId）、`actions[]`（出目→アクション名→乱戦ダメージ修正→注釈の配列）、`family.base`（レベル別基準値表）、`special`フィールドを確認する。

- [ ] **Step 2: rowsをGlobal Constraintsに従って構造化**

`enemy_auto_gm_data.js`の`var DATA = {...}`に1体分のキーを追加する。各行について：
- 乱戦ダメージ修正欄が「—」なら`groupDamage`を省略（Global Constraint 3）
- 対象の明記が無ければ`targetRule: { kind: "frontAll" }`（Global Constraint 4）
- 個別ダメージがあれば`individualDamage: [...]`を追加
- ダイス表記は`elementAccum`/`ailmentAccum`で表現（Global Constraint 8）
- Global Constraint 5の6種で表現できない対象規則があれば、Global Constraint 6の手順（`conditions[]`＋コメントでGM手動処理、新機構は作らない）に従う
- `■`を含む記述は数値化しない（Global Constraint 1）
- 既存の`soldier_knight|crucible_knight`や劇本2/3で追加した敵人のコードスタイル（各行にコメントで規則書原文の要約と適用したルールの根拠を記載）を踏襲する
- `special`フィールドに「亡者特効」「弱点:回復」「転移」等の特殊能力があり、それが出目なしで自動発動する類のものであれば、rows[]には含めずコードコメントで完全記録しGM手動対応とする（Global Constraint 6）

- [ ] **Step 3: 構文チェック**

Run: `node --check static_src/enemy_auto_gm_data.js`
Expected: エラー無し

- [ ] **Step 4: ビルド確認（可能ならブラウザ動作確認）**

Run: `py -3 generate.py`
可能であれば、劇本5のテストゲームで王族の幽鬼を戦闘に登場させ、`window.PriTestEnemyAutoGmData.get(familyId, enemyId)`が期待通りのデータを返すことを確認する。困難であれば静的検証のみで可（レポートに明記）。

- [ ] **Step 5: commit**

```bash
git add static_src/enemy_auto_gm_data.js
git commit -m "feat(night): 新增劇本5夜之強敵(王族の幽鬼)的自動化GM結構化資料"
```

---

### Task 3: 劇本5監査記録文書 + ビルド検証

**Files:**
- Create: `docs/combat_move_structuring_scenario5.md`

**Interfaces:**
- Consumes: Task 1〜2の変更内容

- [ ] **Step 1: 監査記録文書を作成**

`docs/combat_move_structuring_scenario3.md`（劇本3の縮小版監査記録、王gnosterをスコープ外とした前例）と同じ形式で、以下を記載する：
- Task 1のreward陣列監査で補完した箇所の一覧（floor位置、追加したreward種別）
- 王（libra、劇本5のボス）は使用者指示により今回のスコープ外である旨
- Task 2で構造化した王族の幽鬼の内容、GM手動フォールバックにした箇所があればその理由

- [ ] **Step 2: 全体ビルド検証**

Run: `py -3 generate.py`
Expected: エラー無し

- [ ] **Step 3: commit**

```bash
git add docs/combat_move_structuring_scenario5.md
git commit -m "docs(night): 新增劇本5敵人稽核記錄文件(王libra暫緩)"
```

---

## Phase 2：劇本6（darkdrift_knight）

### Task 4: 劇本6 場地卡reward陣列監査

Task 1と同じ手順を`darkdrift_knight`（`Scenarios.numberForId("darkdrift_knight")`が`6`を返すことを実装時に確認）に対して実施する。

- [ ] Step 1〜6: Task 1のStep1〜6を`darkdrift_knight`に対して実施する。

```bash
git add static_src/fields_data_1.js static_src/fields_data_2.js static_src/fields_data_3.js static_src/fields_data_4.js
git commit -m "fix(fields): 補完劇本6(darkdrift_knight)該當分岐的reward陣列與本文記述落差"
```

---

### Task 5: 劇本6夜之強敵「冷たい谷の踊り子」「無名の王」auto-GM覆蓋層構造化

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- 参照: `static_src/fields_data_1.js:497-506`（劇本6 Day1/Day2の夜之強敵リスト）

**対象敵：** 冷たい谷の踊り子、無名の王（劇本6 Day2。鈴玉狩り／貪食ドラゴン／夜の騎兵たち／英雄のガーゴイル／ミミズ顔たち／百足のデーモン／忌み鬼／僻地の宿将／ノクスの竜人兵は全て既存対応済みのため対象外）。

**重要な注意点（無名の王）：** 「無名の王」は名前に「王」が付くが、`boss_auto_gm_data.js`が扱う夜の王（Nightlord）とは無関係の通常の夜之強敵である。`竜特効`、モブ1体追加、モブHPが0以下になると「王の威光」が発動して`竜特効`消失＋行動決定が`1D+6`に激化する等、ボス級の重い特殊ルールを持つ。この「モブHP依存の行動激化」はGlobal Constraint 7の`rollBonusAfterGuardBreak`（体勢崩し依存）とは発動条件が異なるため、そのまま流用せず、`conditions[]`＋コメントで発動条件を正確に記録し、GM手動トリガーとして扱うこと（新しいトップレベルフィールドを追加しない）。

- [ ] **Step 1〜5**: Task 2のStep1〜5と同じ手順を、この2体に対して実施する（Step1: familyId/enemyId特定 → Step2: Global Constraintsに従いrows構造化（無名の王は上記注意点に従う）→ Step3: `node --check` → Step4: ビルド＋可能ならブラウザ動作確認 → Step5: commit）。

```bash
git add static_src/enemy_auto_gm_data.js
git commit -m "feat(night): 新增劇本6夜之強敵(冷たい谷の踊り子、無名の王)的自動化GM結構化資料"
```

---

### Task 6: 劇本6監査記録文書 + ビルド検証

Task 3と同じ手順を劇本6に対して実施する。

- [ ] Step 1: `docs/combat_move_structuring_scenario6.md`を作成し、Task 4〜5の内容と、王（fulghor、劇本6のボス）がスコープ外である旨を記載する。
- [ ] Step 2: `py -3 generate.py`でビルド確認。
- [ ] Step 3: commit

```bash
git add docs/combat_move_structuring_scenario6.md
git commit -m "docs(night): 新增劇本6敵人稽核記錄文件(王fulghor暫緩)"
```

---

## Phase 3：劇本7（fissure_in_the_fog）

### Task 7: 劇本7 場地卡reward陣列監査

Task 1と同じ手順を`fissure_in_the_fog`（`Scenarios.numberForId("fissure_in_the_fog")`が`7`を返すことを実装時に確認）に対して実施する。

- [ ] Step 1〜6: Task 1のStep1〜6を`fissure_in_the_fog`に対して実施する。

```bash
git add static_src/fields_data_1.js static_src/fields_data_2.js static_src/fields_data_3.js static_src/fields_data_4.js
git commit -m "fix(fields): 補完劇本7(fissure_in_the_fog)該當分岐的reward陣列與本文記述落差"
```

---

### Task 8: 劇本7夜之強敵カバレッジ確認 + 監査記録文書

**Files:**
- Create: `docs/combat_move_structuring_scenario7.md`

**背景:** `static_src/fields_data_1.js:509-517`（劇本7 Day1/Day2の夜之強敵リスト：熔鉄デーモン／爛れた樹霊／接ぎ木の君主／ティビアの呼び舟／公のフレイディア／ツリーガード&王都の騎兵／神肌の使徒たち／冷たい谷の踊り子）に登場する敵人は、事前調査により**全て劇本1~4またはPhase 2までの既存対応で構造化済み**であることが判明している。そのため本Taskでは新規の`enemy_auto_gm_data.js`変更を行わず、カバレッジの確認と記録のみを行う。

- [ ] **Step 1: 劇本7の夜之強敵8体全てが構造化済みであることを確認**

`static_src/fields_data_1.js:509-517`の8体それぞれについて、日本語名で`static_src/enemies_data_1~4.js`を検索してfamilyId/enemyIdを特定し、`static_src/enemy_auto_gm_data.js`の`var DATA = {...}`に対応するキー（`"<familyId>|<enemyId>"`）が実在することを確認する。1体でも欠けていれば、Task 2/5と同じ手順（Global Constraintsに従った構造化）でそのTaskに追加し、`enemy_auto_gm_data.js`をcommitする（この場合はStep 3のcommitメッセージを「新增劇本7夜之強敵(不足分)的自動化GM結構化資料」のように調整する）。

- [ ] **Step 2: 監査記録文書を作成**

`docs/combat_move_structuring_scenario3.md`と同じ形式で`docs/combat_move_structuring_scenario7.md`を作成し、Task 7のreward陣列監査結果と、Step1で確認した8体のカバレッジ一覧（各敵人がどの劇本のTaskで構造化済みか）を記載する。王（caligo、劇本7のボス）がスコープ外である旨も記載する。

- [ ] **Step 3: ビルド検証 + commit**

Run: `py -3 generate.py`

```bash
git add docs/combat_move_structuring_scenario7.md
git commit -m "docs(night): 新增劇本7敵人稽核記錄文件(全數已於既有劇本結構化,王caligo暫緩)"
```

---

## Phase 4：劇本8（balancers）

### Task 9: 劇本8 場地卡reward陣列監査

Task 1と同じ手順を`balancers`（`Scenarios.numberForId("balancers")`が`8`を返すことを実装時に確認）に対して実施する。**注意：** `docs/combat_move_structuring_scenario4.md`のTask10報告により、`fields_data_2.js:2434`（崖上の遺跡（血）、「撃破ルーン：2」）に既知のreward漏れが劇本8/9専属分岐として記録されている。この分岐が劇本8で選ばれる場合は、本Taskの中で正式に補完すること。

- [ ] Step 1〜6: Task 1のStep1〜6を`balancers`に対して実施する（上記の既知の漏れ箇所を含めて全分岐を確認する）。

```bash
git add static_src/fields_data_1.js static_src/fields_data_2.js static_src/fields_data_3.js static_src/fields_data_4.js
git commit -m "fix(fields): 補完劇本8(balancers)該當分岐的reward陣列與本文記述落差"
```

---

### Task 10: 劇本8夜之強敵4体のauto-GM覆蓋層構造化

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- 参照: `static_src/fields_data_1.js:519-528`（劇本8 Day1/Day2の夜之強敵リスト）

**対象敵：** 傷ついたデーモン＆うろ底のデーモン、神獣の戦士たち（劇本8 Day1）、デーモンの王子、血の君主（劇本8 Day2）。

**重要な注意点（4体とも通常と異なる特殊機構を持つため、実装前に必ず`special`フィールド全文を読むこと）：**

1. **傷ついたデーモン＆うろ底のデーモン**：「2回行動」特殊能力を持ち、1回のディフェンスフェイズに「1D（傷ついたデーモン）」と「1D+6（うろ底のデーモン）」の2つの出目テーブルを同時に参照し、両方を実行する。さらに「行動激化」は通常の`1D+N`ではなく、体勢崩しが発生しない代わりに「2回行動」を喪失し、以降PCが選んだ側のアクションに固定ダメージ加算が付く、という他に類を見ない変則ルール。既存の`rollBonusAfterGuardBreak`（単純な出目シフト）ではこの「2回行動→1回行動＋固定加算」への転化を表現できないため、`rollBonusAfterGuardBreak`は使わず、`actions[]`本文の出目1〜12を1つの`rows[]`として構造化した上で、「2回行動」と「行動激化後の転化」はコードコメントで規則書原文を完全に引用してGM手動対応とする（Global Constraint 6）。
2. **神獣の戦士たち**：戦闘1ターン目のみディフェンスフェイズで行動せず、代わりにアクションフェイズ開始時（PCの行動より先）に行動する特殊タイミングを持つ。`rows[]`自体の構造化は通常通り出目に従って行ってよいが、この特殊タイミングは`conditions[]`＋コメントでGMに明記すること（`auto_gm.js`側にタイミング分岐の新機構を作らない）。
3. **デーモンの王子**：GM専用出現条件（「進行中のシナリオで『傷ついたデーモン＆うろ底のデーモン』を撃破していないと登場不可」）を持つ。これはauto-GMデータの構造化そのものには影響しない（出現条件はGMがシナリオ進行を見て手動判断する事項）が、コードコメントに条件を転記しておくこと。
4. **血の君主**：体勢崩し直後のディフェンスフェイズに、出目を振らず自動的に「数え上げる呪い」を実行する特殊能力を持つ。これは`rows[]`の出目テーブルとは別枠の自動発動行動のため、Global Constraint 6の「出目なしで自動発動する特殊能力」の扱い（rows[]には含めずコメントで完全記録）に従う。

- [ ] **Step 1〜5**: Task 2のStep1〜5と同じ手順を、この4体に対して実施する（Step1: familyId/enemyId特定・`special`全文確認 → Step2: Global Constraintsと上記注意点1〜4に従いrows構造化 → Step3: `node --check` → Step4: ビルド＋可能ならブラウザ動作確認 → Step5: commit）。

```bash
git add static_src/enemy_auto_gm_data.js
git commit -m "feat(night): 新增劇本8夜之強敵(傷ついたデーモン等4隻)的自動化GM結構化資料"
```

---

### Task 11: 劇本8監査記録文書 + ビルド検証

Task 3と同じ手順を劇本8に対して実施する。

- [ ] Step 1: `docs/combat_move_structuring_scenario8.md`を作成し、Task 9〜10の内容と、王（harmonia、劇本8のボス）がスコープ外である旨を記載する。Task 10の4体それぞれのGM手動fallback箇所（特に上記の特殊機構4点）を一覧化すること。
- [ ] Step 2: `py -3 generate.py`でビルド確認。
- [ ] Step 3: commit

```bash
git add docs/combat_move_structuring_scenario8.md
git commit -m "docs(night): 新增劇本8敵人稽核記錄文件(王harmonia暫緩)"
```

---

## Phase 5：劇本9（dreglord）

### Task 12: 劇本9 場地卡reward陣列監査

Task 1と同じ手順を`dreglord`（`Scenarios.numberForId("dreglord")`が`9`を返すことを実装時に確認）に対して実施する。

- [ ] Step 1〜6: Task 1のStep1〜6を`dreglord`に対して実施する。

```bash
git add static_src/fields_data_1.js static_src/fields_data_2.js static_src/fields_data_3.js static_src/fields_data_4.js
git commit -m "fix(fields): 補完劇本9(dreglord)該當分岐的reward陣列與本文記述落差"
```

---

### Task 13: 劇本9夜之強敵4体のauto-GM覆蓋層構造化

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- 参照: `static_src/fields_data_1.js:530-539`（劇本9 Day1/Day2の夜之強敵リスト）

**対象敵：** ルーンベア、死の騎士（劇本9 Day1）、神獣獅子舞、騎士アルトリウス（劇本9 Day2）。

**注意点（騎士アルトリウス）：** モブHPが一定値以上ならアクション決定（出目）なしで「影の貴人の群れ」を自動実行する特殊能力を持つ。Global Constraint 6の「出目なしで自動発動する特殊能力」の扱いに従い、rows[]には含めずコメントで完全記録すること。それ以外の通常出目（行動激化含む）は通常通り構造化してよい。

- [ ] **Step 1〜5**: Task 2のStep1〜5と同じ手順を、この4体に対して実施する。

```bash
git add static_src/enemy_auto_gm_data.js
git commit -m "feat(night): 新增劇本9夜之強敵(ルーンベア等4隻)的自動化GM結構化資料"
```

---

### Task 14: 劇本9監査記録文書 + 全劇本5~9通しビルド検証

**Files:**
- Create: `docs/combat_move_structuring_scenario9.md`

- [ ] Step 1: `docs/combat_move_structuring_scenario9.md`を作成し、Task 12〜13の内容と、王（stragedes、劇本9のボス）がスコープ外である旨を記載する。
- [ ] Step 2: 全体ビルド検証。`py -3 generate.py`を実行しエラー無く完了することを確認する。可能であれば、劇本5〜9それぞれのテストゲームを作成し、各王戦闘（自動化GM無効のまま王手動運用になることを確認）・各夜之強敵戦闘・floor到達時のreward獲得清單pushをブラウザで一通り確認する（環境制約で困難なら静的検証のみで可）。
- [ ] Step 3: commit

```bash
git add docs/combat_move_structuring_scenario9.md
git commit -m "docs(night): 新增劇本9敵人稽核記錄文件，完成劇本5~9夜之強敵結構化(王harmonia/caligo/libra/fulghor/stragedes暫緩)"
```

---

## Self-Review 結果

- **Spec coverage**：使用者要求「所有敵人（夜王除外）」のうち、劇本5〜9で新規構造化が必要な10体の夜之強敵（王族の幽鬼／冷たい谷の踊り子／無名の王／傷ついたデーモン＆うろ底のデーモン／神獣の戦士たち／デーモンの王子／血の君主／ルーンベア／死の騎士／神獣獅子舞／騎士アルトリウス）は全てTask 2/5/10/13でカバーされている。劇本7は新規敵人が存在しないためカバレッジ確認Taskのみとした（Task 8）。各劇本のreward陣列監査（Task 1/4/7/9/12）と監査記録文書（Task 3/6/8/11/14）も全劇本で網羅済み。
- **Placeholder scan**：全タスクに具体的なファイルパス・コマンド・Global Constraint参照を記載済み。データ量が多い夜之強敵構造化Task（2/5/10/13）とreward監査Task（1/4/7/9/12）は、劇本2~4計画のTask 3/4/8/12/1/6/10と同様、個別の最終コードを事前に書き出していないが、手順（familyId/enemyId特定→Global Constraintsに従った構造化→検証→commit）と特殊機構への対処方針（Task10の4体特殊注意点など）は全て具体的に規定済みで、「適切に処理する」のような曖昧な指示は含まない。
- **Type consistency**：`rollMin`/`rollMax`/`groupDamage`/`targetRule`/`individualDamage`/`conditions`/`elementAccum`/`ailmentAccum`/`savingThrow`/`rollBonusAfterGuardBreak`の各フィールド名・形状は、劇本2~4計画で確立し既に`enemy_auto_gm_data.js`に実在する27キーの実例と完全に一致している（本プランは新しいフィールドを一切導入しない）。
