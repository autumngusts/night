# 劇本2~4 卡牌結構化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 劇本2（`gaping_jaw`/`edele`）、劇本3（`sentient_pest`/`gnoster`）、劇本4（`augur`/`maris`）の3劇本について、層B（reward陣列監査）と層C（敵人/王のauto-GM覆蓋層）を劇本1と同等の完成度まで引き上げる。

**Architecture:** 新しいデータ構造やコードパイプラインは追加しない。`boss_auto_gm_data.js`／`enemy_auto_gm_data.js`／`fields_data_1~4.js` に既存スキーマのままデータを追記するだけで、既存の `auto_gm.js` の `isStructured()` ゲートが自動的に自動化GMモードへ切り替える。

**Tech Stack:** Vanilla ES5（`static_src/*.js`）、Python静的サイトビルド（`generate.py`）、正式テストフレームワーク無し（`node --check` ＋ ビルド＋ブラウザ/Playwright手動検証）。

**参照設計文書:** `docs/superpowers/specs/2026-08-13-scenario-2-4-card-structuring-design.md`

## Global Constraints

以下は本プラン全タスクに共通する転写・判断ルール。既存コードの慣例と `docs/enemy_damage_rules.md` から抽出したもので、**逸脱・独自解釈は禁止**。

1. **数値の捏造禁止**：`■` を含む記述、または規則書原文が曖昧で数値が確定できない箇所は、絶対に数値化しない。`conditions[]` に説明的な文字列を追加し、コード内コメントで規則書原文（zh/ja）を引用し、GM手動処理に委ねる。
2. **groupDamage の値種別**：夜の王（`boss_auto_gm_data.js`）は `groupDamage.value`（絶対値、乱戦ダメージ欄の数値をそのまま使う）。通常エネミー（`enemy_auto_gm_data.js`）は `groupDamage.modifier`（`family.base[level].dmg` への加算修正値、乱戦ダメージ修正欄の数値をそのまま使う）。
3. **「—」ルール**：行動一覧表の「乱戦ダメージ」欄（王は「乱戦ダメージ」列そのもの、通常エネミーは「乱戦ダメージ修正」列）が「—」の行は、`groupDamage` を一切設定しない（乱戦ダメージ無し）。`individualDamage` は独立した別枠のため、この「—」ルールの影響を受けず、記述があれば通常どおり設定する。
4. **既定target規則**：本文に乱戦ダメージの分配対象の明記が無い場合は `targetRule: { kind: "frontAll" }`（前衛均等割り）とする。
5. **targetRule.kind の完全な既存カタログ**（`auto_gm.js:259-286`、この6種以外は新設しない）：
   - `frontAggroAtLeast1All`：前衛かつ敵視1以上の全員
   - `aggroAtLeast1All`：敵視1以上の全員（前衛/後衛問わず）。`fallback: "front"` を付けると対象0人時に前衛へフォールバック
   - `frontAll`：前衛全員（均等割り既定ルール）
   - `aggroMax`：敵視最大のPC（前衛/後衛問わず全体で最大値判定）
   - `frontAggroMaxAll`：前衛内で敵視最大のPC
   - `allPCs`：PC全員
6. **既存6種で表現できない対象規則が見つかった場合**（例：「全員が対象だが一部PCが2人分/3人分を負担」という加重分配、「敵視最大の人数が多いエリア（前衛/後衛）全員、同数ならランダム決定」というエリア多数決、「他の対象にならなかったPC全員」という除外指定、「対象規則が回ごとに異なる複数回乱戦ダメージ」）：
   - `auto_gm.js` に新しい `targetRule.kind` や新機構を追加しない（本プランのスコープ外、CLAUDE.md原則11「不要為單一效果建立第三套特殊架構」に従う）。
   - `groupDamage`（数値が確定している場合）は設定してよいが、`targetRule` は省略するか対象範囲が最も近い既存kindに留め、`conditions[]` に規則の詳細を要約した識別子を追加し、コード内コメントで規則書原文を引用してGMが手動で対象・分配を決定する。
   - この扱いをした行は、該当劇本の監査記録文書に一覧化する。
7. **rollBonusAfterGuardBreak**：「行動激化」（體勢崩潰後 `1D` ではなく `1D＋N` で判定）は既存フィールド `rollBonusAfterGuardBreak: N` をボスのトップレベルに設定する（`auto_gm.js:124-129` が `battleState.guardBroken` を見て自動加算する）。既存の出目テーブルが `1D＋N` の到達範囲を完全にカバーしていれば、行の追加は不要。
8. **elementAccum / ailmentAccum**：ダイス表記（「雷：2D」「猛毒：1D」等）は固定ダメージ値に変換せず、`elementAccum: [{ label: "雷", amount: 2 }]`（属性）または `ailmentAccum: [{ label: "猛毒", amount: 2 }]`（状態異常）としてダイス数のみを構造化する（既存例：`enemy_auto_gm_data.js:698`）。ダイス自体は引き続きGM/PCが実際に振る。
9. **savingThrow**：判定（運試し／フィジカル／メンタル）で成否が分かれ、かつ対象がPC全員（敵視条件で目標値が変わるのみ）の場合のみ使う。対象が前衛限定など既存savingThrow構造で表現できない場合は使わず、GM手動判定に委ねる（既存例：`enemy_auto_gm_data.js:474-496` の「盾撃」）。
10. **node --check** を変更した各JSファイルに対して実行し、`py -3 generate.py` でビルドが通ることを確認してから各タスクをcommitする。
11. コミットメッセージは繁體中文で記述する（`git log` の既存慣例に従う）。

---

## Phase 1：劇本2（gaping_jaw / edele）

### Task 1: 劇本2 場地卡reward陣列監査

**Files:**
- Modify: `static_src/fields_data_1.js`、`static_src/fields_data_2.js`、`static_src/fields_data_3.js`、`static_src/fields_data_4.js`（該当箇所のみ、正確な行は監査で特定する）
- 参照: `static_src/scenarios.js`（`gaping_jaw` の `day1`/`day2`/`start`/`end` 定義）

**Interfaces:**
- Consumes: `Scenarios.numberForId("gaping_jaw")`（`static_src/scenarios.js` の配列順序により `2` を返す。実装時に `node -e` 等で実値確認すること）
- Produces: 監査で発見した記述漏れを `reward[]` へ追記（劇本1監査と同一の `reward[].kind` 分類：`rune`/`weaponStar`/`consumable`/`talisman`/`potentialPower`/`stoneswordKey`/`smithingStone`/`chaliceBonus`/`weaponSkillReroll`/`hpDamage`/`tieredChoice`/`diceHandChoice`/`bargainReveal`/`note`）

- [ ] **Step 1: 劇本2のカード配置を確認**

`static_src/scenarios.js` の `gaping_jaw` エントリ（`id: "gaping_jaw"`）を読み、`day1`（9枠）・`day2`（6枠）・`start`・`end` 各枠の `rank`（点数）を一覧化する。

- [ ] **Step 2: 各点数のvarianceTableで劇本2の分岐を特定**

`static_src/fields_data_1~4.js` を対象に、Step1で得た各 `rank` に対応する `card_<rank>`（または `a_start`/`a_golden`）エントリの `varianceTable.rows` を検索し、`シナリオ` 列が `2` を含む行（単独行、または「2-5, 10」のような範囲表記）を特定して、対応する `branches[]` のインデックスを確定する。花色（`suit`）で分岐が分かれる場合は `scenarios.js` の該当枠の `suit` も併用する。

- [ ] **Step 3: 本文とreward配列を突き合わせ**

Step2で特定した各 `branches[].floors[]` について、`lines[]` 本文中の報酬に関する記述（「擊破盧恩：N」「獲得」「潜在の力」等）と、同floorの `reward[]` 配列を照合する。記述はあるが対応する `reward[]` エントリが無い箇所のみ、`docs/superpowers/specs/2026-08-10-floor-reward-turn-reward-integration-design.md` の決定事項1で定義された `kind` 分類に従い正式なエントリとして追記する。`■` を含む記述は Global Constraint 1 に従い数値化しない。劇本1に該当しない分岐（劇本2が選ばない分岐）は変更しない。

- [ ] **Step 4: 構文チェック**

Run: `node --check static_src/fields_data_1.js && node --check static_src/fields_data_2.js && node --check static_src/fields_data_3.js && node --check static_src/fields_data_4.js`
Expected: エラー無し（変更したファイルのみでよい）

- [ ] **Step 5: ビルド確認**

Run: `py -3 generate.py`
Expected: `dist/` が正常生成される

- [ ] **Step 6: commit**

```bash
git add static_src/fields_data_1.js static_src/fields_data_2.js static_src/fields_data_3.js static_src/fields_data_4.js
git commit -m "fix(fields): 補完劇本2(gaping_jaw)該當分岐的reward陣列與本文記述落差"
```

---

### Task 2: edele（劇本2王）auto-GM覆蓋層構造化

**Files:**
- Modify: `static_src/boss_auto_gm_data.js`

**Interfaces:**
- Consumes: `night_boss_rulebook.js:93-155` の `edele` エントリ（`actions[]` 本文、以下に全文引用済み）
- Produces: `BossAutoGmData.get("edele")` が `{ rollBonusAfterGuardBreak: 4, rows: [...] }` を返すようになる（`auto_gm.js` の `isStructured()`/`findStructuredRow()` がそのまま利用）

**参照する規則書原文（`night_boss_rulebook.js:149-154`）:**

| 出目 | アクション名 | 乱戦ダメージ | 注釈 |
|---|---|---|---|
| 1~2 | 噛みつき | 1080 | 「敵視：1以上」で前衛のPC全員は「乱戦ダメージ：3人分」を割り振られる |
| 3~4 | 突進 | 1260 | 乱戦ダメージはPC全員を対象とする。「敵視：1以上」で前衛のPCは「乱戦ダメージ：2人分」を割り振られる |
| 5~6 | 拘束噛みつき | 600 | 「敵視：最大」のPC1体のみ対象。ガード不可。次のアクションフェイズ終了まで敵に「HP価値：－10（最低10）」 |
| 7~8 | 雷噛みつき | 1080＆「雷：2D」 | 次のアクションフェイズ終了まで敵に「HP価値：＋10（最高100）」 |
| 9~10 | 地擦り雷光 | 600＆「雷：1D」 | 個別効果：「敵視：1以上」で前衛のPC全員に【個別ダメージ：240】＋「雷：1D」 |
| —（毒吐き、特殊能力「猛毒の吐瀉」で1Dを振らず自動発動） | 毒吐き | 840＆「猛毒：2D」 | 対象は「敵視：1以上」のPC全員（0人なら前衛）。ガード不可。次のアクションフェイズ終了まで敵に「HP価値：－10（最低10）」 |

「行動激化」特殊能力：體勢崩潰後、戦闘終了まで `1D` ではなく `1D＋4` で判定（既存表が出目1~10を完全網羅するため追加行は不要）。

- [ ] **Step 1: `edele` エントリを追加**

`static_src/boss_auto_gm_data.js` の `var DATA = { "maris": {...}, "gladius": {...} };` に `"edele"` を追加する：

```js
"edele": {
  // 「行動激化」：體勢崩潰後は「1D」ではなく「1D＋4」で判定する（既存の1~10表がその範囲を
  // 完全にカバーするため追加行は不要）。
  rollBonusAfterGuardBreak: 4,
  rows: [
    {
      // 「噛みつき」（出目1~2）：「敵視：1以上」で前衛のPC全員は「乱戦ダメージ：3人分」を
      // 割り振られる（gladius/marisと同じ規約：本文の数値は既にN人分込みの合計値）。
      rollMin: 1,
      rollMax: 2,
      groupDamage: { value: 1080 },
      targetRule: { kind: "frontAggroAtLeast1All" },
    },
    {
      // 「突進」（出目3~4）：乱戦ダメージはPC全員が対象だが、「敵視：1以上」の前衛のみ「2人分」を
      // 負担する加重分配のため、既存6種のtargetRuleでは正確に表現できない（allPCsは均等割りが
      // 前提）。数値を捏造しないため、targetRuleは対象範囲のみ正しいallPCsに留め、加重の詳細は
      // conditionsで記録してGMが本文どおり手動で再分配する。
      rollMin: 3,
      rollMax: 4,
      groupDamage: { value: 1260 },
      targetRule: { kind: "allPCs" },
      conditions: ["manual_weighted_split_front_aggro_double"],
    },
    {
      // 「拘束噛みつき」（出目5~6）：「敵視：最大」のPC1体のみ対象。ガード不可。次のアクション
      // フェイズ終了まで敵に「HP価値：－10（最低10）」する。
      rollMin: 5,
      rollMax: 6,
      groupDamage: { value: 600 },
      targetRule: { kind: "aggroMax" },
      conditions: ["no_guard", "enemy_hp_value_debuff"],
    },
    {
      // 「雷噛みつき」（出目7~8）：対象の明記が無いため既定ルール（前衛均等割り）。次のアクション
      // フェイズ終了まで敵に「HP価値：＋10（最高100）」する。
      rollMin: 7,
      rollMax: 8,
      groupDamage: { value: 1080, elementAccum: [{ label: "雷", amount: 2 }] },
      targetRule: { kind: "frontAll" },
      conditions: ["enemy_hp_value_buff"],
    },
    {
      // 「地擦り雷光」（出目9~10）：乱戦ダメージは対象の明記が無いため既定ルール。個別効果：
      // 「敵視：1以上」で前衛のPC全員に【個別ダメージ：240】＋「雷：1D」。
      rollMin: 9,
      rollMax: 10,
      groupDamage: { value: 600, elementAccum: [{ label: "雷", amount: 1 }] },
      targetRule: { kind: "frontAll" },
      individualDamage: [
        { amount: 240, targetRule: { kind: "frontAggroAtLeast1All" }, elementAccum: [{ label: "雷", amount: 1 }] },
      ],
    },
    // 「毒吐き」（出目無し＝特殊能力「猛毒の吐瀉」により1Dを振らず自動発動）：発動条件（このターン
    // いずれかのPCが「状態異常：猛毒」でこのエネミーにHP損害を与えたか）はnight.js側で追跡して
    // いないため、rows[]には含めずGM手動トリガーとする（gladiusの「形態変化」と同じ扱い）。
    // 発動時の内容：乱戦ダメージ840＆「猛毒：2D」、対象は「敵視：1以上」のPC全員（0人なら前衛）、
    // ガード不可。次のアクションフェイズ終了まで敵に「HP価値：－10（最低10）」する。「体勢崩し」後
    // 戦闘終了まで発動しない。
  ],
},
```

- [ ] **Step 2: 構文チェック**

Run: `node --check static_src/boss_auto_gm_data.js`
Expected: エラー無し

- [ ] **Step 3: ビルドしてブラウザで動作確認**

Run: `py -3 generate.py` → `python -m http.server 8000 --directory dist`
Admin経由で劇本2(gaping_jaw)のテストゲームを作成し、`night/index.html?game=<id>` で王edeleとの戦闘を開始。ブラウザConsoleで以下を実行して構造化データが読めることを確認：

```js
window.PriTestBossAutoGmData.get("edele")
// rows.length === 5、rollBonusAfterGuardBreak === 4 であること
```

戦闘UIで出目1・3・5・7・9をそれぞれ入力し、期待どおりの乱戦ダメージ・対象・conditions表示になることを確認する。

- [ ] **Step 4: commit**

```bash
git add static_src/boss_auto_gm_data.js
git commit -m "feat(night): 新增劇本2夜之王edele的自動化GM出目結構化資料"
```

---

### Task 3: 劇本2夜之強敵 auto-GM覆蓋層 Part A

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- 参照: `static_src/fields_data_1.js:452-460`（劇本2 Day1/Day2の夜之強敵リスト）、`static_src/enemies.js`、`static_src/enemies_data_1~4.js`

**Interfaces:**
- Consumes: `night_gm_flow.js` の `resolveNightBossTableRow`/`resolveNightBossCombatLine`（変更不要、既存の敵名文字列から `enemies.js` の `PriTestEnemies.list()`/`get()` を通じて `familyId`/`enemyId` を解決する既存ロジックをそのまま利用）
- Produces: 以下5体の `"<familyId>|<enemyId>"` キーで `EnemyAutoGmData.get()` が構造化データを返すようになる

**対象敵（劇本2 Day1、`fields_data_1.js:452-456`）：** 貪食ドラゴン、夜の騎兵たち、英雄のガーゴイル、ミミズ顔たち、熔鉄デーモン

- [ ] **Step 1: 各敵の familyId/enemyId と規則書テキストを特定**

5体それぞれについて `static_src/enemies_data_1.js`〜`enemies_data_4.js` を対象に日本語名（例：`"貪食ドラゴン"`）で検索し、所属する `FAMILIES[].id`（familyId）と該当 `enemies[].id`（enemyId）、および `actions`（出目→アクション名→乱戦ダメージ修正→注釈の配列）と `family.base`（レベル別基準値表）を確認する。

- [ ] **Step 2: 各敵のrowsをGlobal Constraintsに従って構造化**

`enemy_auto_gm_data.js` の `var DATA = { ... }` に5体分のキーを追加する。各行について：
- 乱戦ダメージ修正欄が「—」なら `groupDamage` を省略（Global Constraint 3）
- 対象の明記が無ければ `targetRule: { kind: "frontAll" }`（Global Constraint 4）
- 個別ダメージがあれば `individualDamage: [...]` を追加
- ダイス表記は `elementAccum`/`ailmentAccum` で表現（Global Constraint 8）
- Global Constraint 5の6種で表現できない対象規則があれば、Global Constraint 6の手順（`conditions[]`＋コメントでGM手動処理、新機構は作らない）に従う
- `■` を含む記述は数値化しない（Global Constraint 1）
- 既存の `soldier_knight|crucible_knight`（`enemy_auto_gm_data.js:403`）や `cavalry|tree_guard_capital_cavalry`（`:525`）のコードスタイル（各行にコメントで規則書原文の要約と適用したルールの根拠を記載）を踏襲する

- [ ] **Step 3: 構文チェック**

Run: `node --check static_src/enemy_auto_gm_data.js`
Expected: エラー無し

- [ ] **Step 4: ビルドしてブラウザで動作確認**

Run: `py -3 generate.py`
劇本2のテストゲームで各敵を戦闘に登場させ、ブラウザConsoleで `window.PriTestEnemyAutoGmData.get(familyId, enemyId)` が期待通りのデータを返すことと、`auto_gm.js` の `isStructured()` が対応キーで `true` を返すことを確認する。各敵ごとに最低1つの出目で乱戦ダメージ計算をUI上で確認する。

- [ ] **Step 5: commit**

```bash
git add static_src/enemy_auto_gm_data.js
git commit -m "feat(night): 新增劇本2夜之強敵(貪食ドラゴン等5隻)的自動化GM結構化資料"
```

---

### Task 4: 劇本2夜之強敵 auto-GM覆蓋層 Part B

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- 参照: `static_src/fields_data_1.js:452-460`

**Interfaces:**
- Consumes/Produces: Task 3と同様のパターン

**対象敵：** 公のフレイディア（劇本2 Day1）、古竜、僻地の宿将、ノクスの竜人兵、死儀礼の鳥（劇本2 Day2。`坩堝の騎士` は `soldier_knight|crucible_knight` として既に構造化済みのため対象外）

- [ ] **Step 1〜5**: Task 3のStep1〜5と同じ手順を、この5体に対して実施する（Step1: familyId/enemyId特定 → Step2: Global Constraintsに従いrows構造化 → Step3: `node --check` → Step4: ビルド＋ブラウザ動作確認 → Step5: commit）。

```bash
git add static_src/enemy_auto_gm_data.js
git commit -m "feat(night): 新增劇本2夜之強敵(公のフレイディア等5隻)的自動化GM結構化資料"
```

---

### Task 5: 劇本2監査記録文書 + 最終ビルド検証

**Files:**
- Create: `docs/combat_move_structuring_scenario2.md`

**Interfaces:**
- Consumes: Task 1〜4の変更内容

- [ ] **Step 1: 監査記録文書を作成**

`docs/combat_move_structuring_scenario1_and_classes.md` の劇本1敵人稽核部分と同じ形式（対象敵人一覧、参照した規則書出典、判定の根拠、GM手動フォールバックにした箇所とその理由）で、以下を記載する：
- Task 1のreward陣列監査で補完した箇所の一覧（floor位置、追加したreward種別）
- edeleの5行の構造化内容、および「突進」の加重分配・「毒吐き」のGM手動トリガーをフォールバックにした理由
- Task 3/4で構造化した10体の敵人リストと、Global Constraint 6でGM手動処理にフォールバックした行があればその一覧

- [ ] **Step 2: 全体ビルド検証**

Run: `py -3 generate.py`
Expected: エラー無し

- [ ] **Step 3: commit**

```bash
git add docs/combat_move_structuring_scenario2.md
git commit -m "docs(night): 新增劇本2敵人與王稽核記錄文件"
```

---

## Phase 2：劇本3（sentient_pest / gnoster）

### Task 6: 劇本3 場地卡reward陣列監査

Task 1と同じ手順を `sentient_pest`（`Scenarios.numberForId("sentient_pest")` が `3` を返すことを実装時に確認）に対して実施する。

- [ ] Step 1〜6: Task 1のStep1〜6を `sentient_pest` に対して実施する。

```bash
git add static_src/fields_data_1.js static_src/fields_data_2.js static_src/fields_data_3.js static_src/fields_data_4.js
git commit -m "fix(fields): 補完劇本3(sentient_pest)該當分岐的reward陣列與本文記述落差"
```

---

### Task 7: gnoster（劇本3王）auto-GM覆蓋層構造化

**Files:**
- Modify: `static_src/boss_auto_gm_data.js`

**Interfaces:**
- Consumes: `night_boss_rulebook.js:158-206` の `gnoster` エントリ（以下に全文引用済み）
- Produces: `BossAutoGmData.get("gnoster")` が `{ rollBonusAfterGuardBreak: 2, rows: [...] }` を返すようになる

**参照する規則書原文（`night_boss_rulebook.js:198-205`）:**

| 出目 | アクション名 | 乱戦ダメージ | 注釈 |
|---|---|---|---|
| 1 | 押しつぶし＆毒牙の鱗粉 | 900 | 個別効果：「敵視：最大」のPC1体に【個別ダメージ：120】＋「猛毒：2D」 |
| 2 | 連続挟み込み＆誘導弾 | — | 個別効果（PC人数回実行）：「敵視：1以上」で前衛のPC1体に【個別ダメージ：180】。個別効果：「敵視：最大」のPC1体に【個別ダメージ：120】＋「魔：1D」 |
| 3 | 瓦礫隆起＆掴み攻撃 | 1020 | 個別効果：「敵視：最大」のPC1体に【個別ダメージ：240】＋「猛毒：2D」、ガード不可 |
| 4 | 硬化＆魔力弾の雨 | 600 | 個別効果：敵視1以上→〈12｜運試し〉、それ以外→〈10｜運試し〉、失敗で【個別ダメージ：240】＋「魔：2D」。次アクションフェイズ終了まで敵HP価値＋20（最大100） |
| 5 | 叫び＆滞空 | — | 個別効果：「敵視：1以上」でPC全員は「HP損害：■×4」、それ以外の前衛は「HP損害：■×2」（■はスタミナダイス消費で軽減可）。後衛PC全員に「猛毒：1D」＋次アクションフェイズのスタミナダイス-1 |
| 6 | 潜航＆毒液 | 900 | 乱戦ダメージは「敵視：最大」の人数が多いエリア全員（同数ならランダム決定）。個別効果：対象外PC全員に「猛毒：1D」 |
| 7 | 光の柱＆毒まき散らし | 600＆「魔：2D」 | 乱戦ダメージは「敵視：最大」のPC1体のみ。個別効果：乱戦ダメージ対象外PC全員に【個別ダメージ：120】＋「猛毒」 |
| 8 | 合体突進 | 360＆「魔：1D」 | 乱戦ダメージ3回発生（1回目前衛全員／2回目後衛全員／3回目敵視1以上全員） |

「行動激化」特殊能力：體勢崩潰後、戦闘終了まで `1D` ではなく `1D＋2` で判定（既存表が出目1~8を完全網羅するため追加行は不要）。

- [ ] **Step 1: `gnoster` エントリを追加**

```js
"gnoster": {
  rollBonusAfterGuardBreak: 2,
  rows: [
    {
      // 「押しつぶし＆毒牙の鱗粉」（出目1）：乱戦ダメージは対象の明記が無いため既定ルール。
      // 個別効果：「敵視：最大」のPC1体に【個別ダメージ：120】＋「猛毒：2D」。
      rollMin: 1,
      rollMax: 1,
      groupDamage: { value: 900 },
      targetRule: { kind: "frontAll" },
      individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "猛毒", amount: 2 }] }],
    },
    {
      // 「連続挟み込み＆誘導弾」（出目2）：乱戦ダメージ欄が「—」のため乱戦ダメージは発生しない。
      // 個別効果は2つ：①「敵視：1以上」で前衛のPC1体に【個別ダメージ：180】をPC人数回実行
      //   （繰り返し回数がパーティ人数依存の変数であり、既存repeat（固定数）では表現できないため
      //   自動化対象外。conditionsで記録し、GMが本文どおり手動実行する）。
      // ②「敵視：最大」のPC1体に【個別ダメージ：120】＋「魔：1D」（対象が固定1体のため自動化可能）。
      rollMin: 2,
      rollMax: 2,
      individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" }, elementAccum: [{ label: "魔", amount: 1 }] }],
      conditions: ["manual_repeat_by_pc_count_front_aggro_180"],
    },
    {
      // 「瓦礫隆起＆掴み攻撃」（出目3）：乱戦ダメージは対象の明記が無いため既定ルール。個別効果：
      // 「敵視：最大」のPC1体に【個別ダメージ：240】＋「猛毒：2D」、この個別効果はガード不可。
      rollMin: 3,
      rollMax: 3,
      groupDamage: { value: 1020 },
      targetRule: { kind: "frontAll" },
      individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "猛毒", amount: 2 }] }],
      conditions: ["no_guard"],
    },
    {
      // 「硬化＆魔力弾の雨」（出目4）：乱戦ダメージは対象の明記が無いため既定ルール。個別効果は
      // 運試し判定（敵視:1以上→目標12／それ以外→目標10）、失敗者に【個別ダメージ：240】＋
      // 「魔：2D」（既存の「アローレイン」等と同じsavingThrowパターン）。次のアクションフェイズ
      // 終了まで敵に「HP価値：＋20（最大100）」する。
      rollMin: 4,
      rollMax: 4,
      groupDamage: { value: 600 },
      targetRule: { kind: "frontAll" },
      savingThrow: {
        stat: "luck",
        targetByCondition: [
          { condition: { kind: "aggroAtLeast1" }, target: 12 },
          { condition: { kind: "default" }, target: 10 },
        ],
        onFail: { amount: 240, elementAccum: [{ label: "魔", amount: 2 }] },
      },
      conditions: ["enemy_hp_value_buff"],
    },
    {
      // 「叫び＆滞空」（出目5）：乱戦ダメージ欄が「—」のため乱戦ダメージは発生しない。個別効果は
      // 「HP損害：■×4／■×2」という■（数値未確定のプレースホルダ）を含むため、数値を捏造せず
      // 自動化対象外とする。後衛PC全員の「猛毒：1D」＋次アクションフェイズのスタミナダイス-1も
      // 含め、すべてGM手動処理とする。
      rollMin: 5,
      rollMax: 5,
      conditions: ["manual_hp_damage_squares_and_sleep_effects"],
    },
    {
      // 「潜航＆毒液」（出目6）：乱戦ダメージの対象が「敵視:最大の人数が多いエリア全員（同数なら
      // ランダム決定）」という、既存6種のtargetRuleに無いエリア多数決ルールのため自動化対象外
      // （数値900は記録するが、対象選定はGMが手動で行う）。個別効果（対象外PC全員に猛毒1D）も
      // 対象確定に依存するため同様にGM手動とする。
      rollMin: 6,
      rollMax: 6,
      groupDamage: { value: 900 },
      conditions: ["manual_target_majority_aggro_area"],
    },
    {
      // 「光の柱＆毒まき散らし」（出目7）：乱戦ダメージは「敵視：最大」のPC1体のみ対象。個別効果
      // 「乱戦ダメージの対象にならなかったPC全員」への【個別ダメージ：120】＋「猛毒」は、既存の
      // targetRuleに「他の対象を除く全員」を表す種別が無いため自動化対象外（GM手動）。
      rollMin: 7,
      rollMax: 7,
      groupDamage: { value: 600, elementAccum: [{ label: "魔", amount: 2 }] },
      targetRule: { kind: "aggroMax" },
      conditions: ["manual_individual_damage_excludes_group_target"],
    },
    {
      // 「合体突進」（出目8）：乱戦ダメージが3回発生し、各回で対象規則が異なる（1回目:前衛全員、
      // 2回目:後衛全員、3回目:敵視1以上全員）。既存のgroupDamage.repeatは「同一targetRuleをN回
      // 繰り返す」設計（例：マリスの渦潮）のため、回ごとに異なる対象を表現できない。自動化対象外
      // とし、GMが本文どおり3回手動適用する（各回360＆「魔：1D」）。
      rollMin: 8,
      rollMax: 8,
      conditions: ["manual_three_sequential_group_damage_different_targets"],
    },
  ],
},
```

- [ ] **Step 2: 構文チェック**

Run: `node --check static_src/boss_auto_gm_data.js`
Expected: エラー無し

- [ ] **Step 3: ビルドしてブラウザで動作確認**

Run: `py -3 generate.py`
劇本3のテストゲームでgnosterとの戦闘を開始し、`window.PriTestBossAutoGmData.get("gnoster").rows.length === 8` を確認。出目1・3・4・7で自動計算結果を、出目2・5・6・8でconditions表示（GM手動処理の案内）が出ることを確認する。

- [ ] **Step 4: commit**

```bash
git add static_src/boss_auto_gm_data.js
git commit -m "feat(night): 新增劇本3夜之王gnoster的自動化GM出目結構化資料"
```

---

### Task 8: 劇本3夜之強敵 auto-GM覆蓋層

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- 参照: `static_src/fields_data_1.js:463-471`（劇本3 Day1/Day2の夜之強敵リスト）

**対象敵：** 百足のデーモン、戦場の宿将、爛れた樹霊、ティビアの呼び舟（劇本3 Day1。熔鉄デーモンはTask 3で構造化済みのため対象外）、大土竜（劇本3 Day2。ノクスの竜人兵はTask 4で、ツリーガード&王都の騎兵は既存 `cavalry|tree_guard_capital_cavalry` で構造化済みのため対象外）

- [ ] **Step 1〜5**: Task 3のStep1〜5と同じ手順を、この5体に対して実施する。

```bash
git add static_src/enemy_auto_gm_data.js
git commit -m "feat(night): 新增劇本3夜之強敵(百足のデーモン等5隻)的自動化GM結構化資料"
```

---

### Task 9: 劇本3監査記録文書 + 最終ビルド検証

Task 5と同じ手順を劇本3に対して実施する。

- [ ] Step 1: `docs/combat_move_structuring_scenario3.md` を作成し、Task 6〜8の内容を記録する。
- [ ] Step 2: `py -3 generate.py` でビルド確認。
- [ ] Step 3: commit

```bash
git add docs/combat_move_structuring_scenario3.md
git commit -m "docs(night): 新增劇本3敵人與王稽核記錄文件"
```

---

## Phase 3：劇本4（augur / maris）

### Task 10: 劇本4 場地卡reward陣列監査

Task 1と同じ手順を `augur`（`Scenarios.numberForId("augur")` が `4` を返すことを実装時に確認）に対して実施する。

- [ ] Step 1〜6: Task 1のStep1〜6を `augur` に対して実施する。

```bash
git add static_src/fields_data_1.js static_src/fields_data_2.js static_src/fields_data_3.js static_src/fields_data_4.js
git commit -m "fix(fields): 補完劇本4(augur)該當分岐的reward陣列與本文記述落差"
```

---

### Task 11: maris（劇本4王）精度監査

**Files:**
- Modify: `static_src/boss_auto_gm_data.js`（既存の `"maris"` エントリのみ、新規rowsの追加ではない）

**Interfaces:**
- Consumes: `night_boss_rulebook.js:270-278` の `maris` `actions[]`（既に全文読了済み、以下に転記）、既存 `boss_auto_gm_data.js:25-105` の `maris` データ

**参照する規則書原文（`night_boss_rulebook.js:271-278`）:**

| 出目 | アクション名 | 乱戦ダメージ | 注釈 |
|---|---|---|---|
| 1 | 回転突進＆滞空 | 900 | 「敵視：1以上」前衛全員「乱戦ダメージ：2人分」。特殊能力「滞空」発揮 |
| 2 | 回転突進＆藻種の萌芽 | 900 | 同上対象。特殊能力「藻種の萌芽」発揮 |
| 3 | 水しぶき＆魔力の泡 | 780＆「睡眠：1D」 | 個別効果：「敵視：1以上」のPC全員に「睡眠：1」。特殊能力「魔力の泡」発揮 |
| 4 | 水しぶき＆藻種の萌芽 | 780＆「睡眠：1D」 | 個別効果：「敵視：1以上」のPC全員に「睡眠：1」。特殊能力「藻種の萌芽」発揮 |
| 5 | 広範囲睡眠攻撃＆滞空 | 1020 | 乱戦ダメージで「HP損害：■」以上を被ったPC全員は同数の「睡眠」。特殊能力「滞空」発揮 |
| 6 | 広範囲睡眠攻撃＆魔力の泡 | 1020 | 同上。特殊能力「魔力の泡」発揮 |
| 7 | 滞空＆魔力の泡＆藻種の萌芽 | 900 | 特殊能力「滞空」「魔力の泡」発揮 |
| 8 | 渦潮 | 420＆「睡眠：1D」（2回発生） | 「敵視：1以上」全員対象（0人なら前衛） |

**既知の監査対象（実装前に確認済みの1件目の相違）**：既存 `boss_auto_gm_data.js` の row3（`rollMin:3,rollMax:3`）・row4（`rollMin:4,rollMax:4`）は `groupDamage: { value: 780 }` のみで、乱戦ダメージ欄に明記されている「睡眠：1D」（`elementAccum`相当、ただし睡眠は`ailmentAccum`）と、個別効果「敵視：1以上のPC全員に睡眠1」（HP損害を伴わない純粋な状態異常付与で、既存`individualDamage`スキーマは`amount`（HP損害）前提のため構造化不可）が、どちらも構造化されていない。

- [ ] **Step 1: row3/row4に睡眠関連の欠落を補記**

`static_src/boss_auto_gm_data.js` の `maris.rows` の該当2行に、乱戦ダメージのダイス表記を `ailmentAccum` で追加し、個別の「睡眠1」付与は既存 `individualDamage`（HP損害前提）で表現できないため `conditions[]` で明記する：

```js
{
  // 「水しぶき＆魔力の泡」：対象の明記が無いため既定ルール（前衛均等割り）。乱戦ダメージ欄の
  // 「睡眠：1D」をailmentAccumで追加。個別効果「敵視：1以上のPC全員に睡眠1」はHP損害を伴わない
  // 純粋な状態異常付与のため、既存individualDamage（amount=HP損害前提）では表現できず
  // conditionsで記録してGM手動反映する。特殊能力「魔力の泡」（PC協議で1名選出しHP損害■＋
  // 睡眠1）もconditionsのみ。
  rollMin: 3,
  rollMax: 3,
  groupDamage: { value: 780, ailmentAccum: [{ label: "睡眠", amount: 1 }] },
  targetRule: { kind: "frontAll" },
  conditions: ["special_magic_bubble", "manual_individual_sleep_1_aggro_at_least_1"],
},
{
  // 「水しぶき＆藻種の萌芽」：同上の対象規則。乱戦ダメージ欄の「睡眠：1D」をailmentAccumで追加。
  rollMin: 4,
  rollMax: 4,
  groupDamage: { value: 780, ailmentAccum: [{ label: "睡眠", amount: 1 }] },
  targetRule: { kind: "frontAll" },
  conditions: ["special_algae_sprout", "manual_individual_sleep_1_aggro_at_least_1"],
},
```

- [ ] **Step 2: row1・row2・row5・row6・row7・row8を規則書と再照合**

既存コード（`boss_auto_gm_data.js:32-104`、Task着手前に読了済み）と上記表を1行ずつ突き合わせ、`groupDamage.value`／`targetRule`／`individualDamage`／`conditions` に相違が無いか確認する。row5/row6の「乱戦ダメージで『HP損害：■』以上を被ったPC全員は同数の睡眠」は `■` を含むため既存どおり `conditions` のみで正しい（数値化しない）。相違が見つかった場合はStep1と同じ方針（数値の捏造禁止、表現できない場合はconditions）で修正する。

- [ ] **Step 3: 構文チェック**

Run: `node --check static_src/boss_auto_gm_data.js`
Expected: エラー無し

- [ ] **Step 4: ビルドしてブラウザで動作確認**

Run: `py -3 generate.py`
劇本4のテストゲームでmarisとの戦闘を開始し、出目3・4で `ailmentAccum` が反映された表示になることを確認する。

- [ ] **Step 5: commit**

```bash
git add static_src/boss_auto_gm_data.js
git commit -m "fix(night): 補完劇本4夜之王maris出目3/4遺漏的睡眠蓄積結構化資料"
```

---

### Task 12: 劇本4夜之強敵 auto-GM覆蓋層

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- 参照: `static_src/fields_data_1.js:474-482`（劇本4 Day1/Day2の夜之強敵リスト）

**対象敵：** 接ぎ木の君主（劇本4 Day1。貪食ドラゴン／英雄のガーゴイル／ミミズ顔たち／熔鉄デーモンはTask 3で構造化済みのため対象外）、神肌の使徒たち、降る星の成獣（劇本4 Day2。ツリーガード&王都の騎兵は既存 `cavalry|tree_guard_capital_cavalry` のため対象外）

- [ ] **Step 1〜5**: Task 3のStep1〜5と同じ手順を、この3体に対して実施する。

```bash
git add static_src/enemy_auto_gm_data.js
git commit -m "feat(night): 新增劇本4夜之強敵(接ぎ木の君主等3隻)的自動化GM結構化資料"
```

---

### Task 13: 劇本4監査記録文書 + 最終ビルド検証

Task 5と同じ手順を劇本4に対して実施する。

- [ ] Step 1: `docs/combat_move_structuring_scenario4.md` を作成し、Task 10〜12の内容とmarisの精度監査結果（Task 11で発見・修正した相違点）を記録する。
- [ ] Step 2: `py -3 generate.py` でビルド確認。全劇本（2/3/4）を通したブラウザ回帰確認（各劇本の王戦闘・強敵戦闘・floor到達時のreward獎勵清單push）を実施する。
- [ ] Step 3: commit

```bash
git add docs/combat_move_structuring_scenario4.md
git commit -m "docs(night): 新增劇本4敵人與王稽核記錄文件，完成劇本2~4卡牌結構化"
```

---

## Self-Review 結果

- **Spec coverage**：設計文書の決定事項1〜5（層B監査／edele・gnoster新規構造化／maris精度監査／夜之強敵覆蓋層／劇本ごとの個別監査記録文書）はTask 1-13で全てカバーされている。
- **Placeholder scan**：全タスクに具体的なファイルパス・コード・コマンドを記載済み。Task 3/4/8/12（夜之強敵覆蓋層）とTask 1/6/10（reward監査）はデータ量が多いため個別の最終コードを事前に書き出していないが、手順（familyId/enemyId特定→Global Constraintsに従った構造化→検証→commit）と適用ルールは全て具体的に規定済みで、「適切に処理する」のような曖昧な指示は含まない。
- **Type consistency**：`rollMin`/`rollMax`/`groupDamage`/`targetRule`/`individualDamage`/`conditions`/`elementAccum`/`ailmentAccum`/`savingThrow`/`rollBonusAfterGuardBreak` の各フィールド名・形状はTask 2/7/11で使用したものと、Task 3/4/8/12が参照する既存 `enemy_auto_gm_data.js` の実例で一致している。
