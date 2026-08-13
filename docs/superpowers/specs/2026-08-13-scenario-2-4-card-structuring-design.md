# 劇本2~4 卡牌結構化 設計

## Context

現在のカード関連データは3つの独立した層に分かれている：

| 層 | 内容 | ファイル | 現状 |
|---|---|---|---|
| 層A：卡牌盤面配置 | 各劇本のday1/day2の花色・点数→場地名 | `scenarios.js` | 10劇本すべて完成済み（劇本2~4含む） |
| 層B：場地/樓層敘述＋reward陣列 | 各カードの本文とreward配列 | `fields_data_1~4.js` | 本文は跨劇本共用でほぼ完成。ただし本文とreward配列の整合監査は劇本1（`tricephalos`）のみ実施済み（`docs/superpowers/specs/2026-08-10-floor-reward-turn-reward-integration-design.md` 決定事項6、26件補完） |
| 層C：敵人/王の自動化GM覆蓋層 | 出目→傷害/対象の計算可能構造データ | `enemy_auto_gm_data.js`、`boss_auto_gm_data.js` | 劇本1の敵4種＋gladius（劇本1王）＋maris（劇本4王、出目1~8のみの試作）しか構造化されていない |

`auto_gm.js` の `isStructured(key)` は層Cのデータ有無だけを見るゲートであり、`night.js`/`night_gm_flow.js` 側のロジックは全劇本共通。層Cのデータが揃えば、既存UIが自動的に自動化GMモードへ切り替わる（コード変更不要）。

対象は劇本2（`gaping_jaw`、王 `edele`）、劇本3（`sentient_pest`、王 `gnoster`）、劇本4（`augur`、王 `maris`）の3劇本とし、層B・層Cの両方をフルスコープで対応する（劇本5~10は対象外、完了後の展開候補）。

## 決定事項（ユーザー承認済み）

1. **層B reward監査**：`gaping_jaw`/`sentient_pest`/`augur` それぞれについて、`Scenarios.numberForId()` が返す劇本番号を使い `fields_data_*.js` の各カードの `varianceTable` から該当劇本が実際に選ぶ分岐（branch）を特定し、その配下の全フロアで `lines[]` 本文と `reward[]` 配列を突き合わせ、記述はあるが構造化データが無い箇所を正式な `reward[]` エントリとして追記する（劇本1監査と同じ方式）。対象外（他劇本のみが選ぶ分岐）は変更しない。
2. **層C・王のauto-GM覆蓋層**：`boss_auto_gm_data.js` に `edele`・`gnoster` を新規追加し、`maris` を試作（出目1~8）から完成させる。3体とも **出目1~12を完全網羅**する（gladiusと同水準）。データ源は `night_boss_rulebook.js` の既存 `actions[]` テキスト（HP/Guard/招式は既に構造化済み）を、`docs/enemy_damage_rules.md` の傷害適用優先順位・notation文法に従って `rows[]`（`rollMin`/`rollMax`/`groupDamage`/`individualDamage`/`targetRule`/`conditions`等）へ変換する。
3. **層C・夜之強敵auto-GM覆蓋層**：`fields_data_1.js` の `a_golden.extraTables[0]`（夜の強敵決定表）から劇本2/3/4のDay1/Day2列に列挙されている敵を抽出し、`enemies.js`/`enemies_data_1~4.js` の既存規則書テキストと照合しながら `enemy_auto_gm_data.js` へ覆蓋層データを追加する。劇本5等と重複する敵（例：`crucible_knight`）は既存データを再利用し、重複作業を避ける。
4. **監査記録文書**：劇本ごとに個別文書を作成する（`docs/combat_move_structuring_scenario2.md`、`scenario3`、`scenario4`）。形式は `docs/combat_move_structuring_scenario1_and_classes.md` の劇本部分（敵人+王の稽核記録）を踏襲する。
5. **実行順序**：劇本2→劇本3→劇本4（maris完成）の順で逐次実行する。理由：`boss_auto_gm_data.js`／`enemy_auto_gm_data.js` は3劇本で共有される単一ファイルであり、並行編集はマージ衝突のリスクがある。逐次実行により劇本ごとに個別commit＋ビルド検証ができ、リスクを抑えられる。

## 実装方針（概要、詳細は実装計画で確定）

### A. 層B reward監査（劇本ごとに実施）

- 対象カード：`scenarios.js` の `gaping_jaw`/`sentient_pest`/`augur` の `day1`（9枠）＋`day2`（6枠）＋`start`/`end`。
- 各カードについて `fields_data_*.js` 内の対応カードの `varianceTable.rows` から、劇本番号（2/3/4）に一致する行を特定し、選ばれる `branches[]` のインデックスを確定する。
- 確定した分岐の全 `floors[].lines[]` を精読し、「擊破盧恩：N」「獲得」等の報酬記述を `floors[].reward[]` と突き合わせる。記述はあるが対応エントリが無い箇所のみ追記する（劇本1監査と同じ粒度）。
- `□`/`▲`/`◆`/`■` を含む記述は `docs/enemy_damage_rules.md` の解釈規則に従う。`■` は固定値が確認できない限り数値化せず、既存のGM手動処理フォールバック（`lines.push(...)` によるrulebook本文表示）を維持する。

### B. 層C・王のauto-GM覆蓋層（`boss_auto_gm_data.js`）

- `edele`/`gnoster` を新規キーとして追加。`night_boss_rulebook.js` の当該王の `actions[]`（招式テキスト、HP/Guard構造は既存）を精読し、gladiusの `rows[]` 実装パターンに倣って出目範囲ごとの `groupDamage`/`individualDamage`/`targetRule`/`conditions` を構造化する。
- `maris` は既存の出目1~8データを踏襲しつつ、出目9~12を同じ方式で追加する。
- 傷害数値の算出は `docs/enemy_damage_rules.md` §2/§5（`▲`/`◆`の意味、Guard Reduction、5段階適用優先順位）に厳密に従う。規則書原文が曖昧、または `■` で確認不能な箇所は構造化せず、GM手動対応のフォールバックに委ねる。

### C. 層C・夜之強敵auto-GM覆蓋層（`enemy_auto_gm_data.js`）

- `fields_data_1.js` の `a_golden.extraTables[0]` から劇本2/3/4それぞれのDay1/Day2列に列挙される敵名を抽出する。
- 各敵について `enemies.js`/`enemies_data_1~4.js` の既存規則書テキスト（技/HP/攻撃データ）を確認し、既存の `enemy_auto_gm_data.js` キー（`familyId|enemyId`）形式で `rows[]` を追加する。
- 既に別劇本用に構造化済みの敵（`crucible_knight` 等）は重複作成せず、既存エントリを流用する。

### D. 監査記録文書

- `docs/combat_move_structuring_scenario2.md`／`scenario3.md`／`scenario4.md` を新規作成し、各劇本の敵人・王の稽核内容（対象、規則書参照箇所、判定の根拠、未確定事項）を記録する。

## 検証方法

1. 変更した各JSファイルに対して `node --check` を実行する。
2. `py -3 generate.py` でビルドし、`dist/` が正常生成されることを確認する。
3. 劇本ごとに以下をPlaywright（または手動ブラウザ操作）で検証する：
   - Admin経由でテスト用ゲームを作成し、当該劇本を選択する。
   - `auto_gm.js` の `isStructured()` が王・対象敵に対して `true` を返し、UIが自動化GMモード（自動擲骰・自動算傷）で動作すること。
   - 王戦闘で出目1~12それぞれについて期待通りの傷害・対象選択が計算されること（少なくとも境界値と中間値をサンプル確認）。
   - 層B側は、監査で追記したreward箇所を含むフロアへ実際に到達し、獎勵清單（`state.turnRewards`）へ正しくpushされることを確認する。
4. コンソールエラーが出ていないことを確認する。
5. 既存の劇本1回帰（Playwrightスクリプトがあれば）に影響が無いことを確認する。

## 対象外（スコープ外）

- 劇本5~10のデータ構造化（本作業完了後の展開候補、今回は対象外）。
- `docs/scenario_flow_rules.md` §10に記載の「隨機籌碼の解決」「突破/登攀判定の合否自動判定」の実装（本件とは別スコープ）。
- 強敵籌碼（`event_rulebook.js` の `extraTables`）自体の決定表構造の変更（既に全劇本共通で実装済み、対象外）。
- `night.js`/`night_gm_flow.js`/`auto_gm.js` のロジック変更（層Cのデータが揃えば既存パイプラインがそのまま機能するため、原則コード変更は不要。ただし監査中に既存パターンでは表現できない特殊ルールが見つかった場合は都度報告し、CLAUDE.mdの方針（fake ability entry等の既存機構の再利用）に従って個別判断する）。
