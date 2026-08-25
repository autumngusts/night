# 全樓層板塊reward陣列の完全稽核＋劇本3-4 Playwright回歸確認 設計

## Context

`fields_data_1.js`〜`fields_data_4.js`（計約10,613行）は、フィールドカード（`id: "a_start"`, `"a_golden"`, `"card_2"`〜`"card_10"`, `"card_j"`, `"card_k"`, `"card_q"`）のデータベースであり、各カードは `varianceTable` で「劇本（シナリオ）→ブランチ」の対応を持つ。ブランチ・フロアのデータ自体はカード側に一元管理されており、劇本ごとにファイルが分かれているわけではない（同じブランチが複数の劇本から参照されることがある）。

各フロアは `lines`（本文、`【突破判定】【描写】` 等の見出しつき段落）と `reward`（構造化された獎勵配列）の2系統を持つ。`night_floor_breakthrough.js` の `handleFloorEndRewardClick` は `reward` 配列のみを見て獎勵清單（`state.turnRewards`）へ自動push・GM判断モーダル表示を行うため、本文に獎勵の記述があるのに `reward` 配列に対応するエントリが無い箇所は「自動化GMが獎勵を見落とす」バグになる（`docs/superpowers/specs/2026-08-10-floor-reward-turn-reward-integration-design.md` で確立した設計）。

これまでのcommit履歴で劇本1〜7（tricephalos/gaping_jaw/sentient_pest/augur/equilibrious_beast/darkdrift_knight/fissure_in_the_fog）の該当分岐について、本文とreward配列のズレを補完する監査が計10件実施済み（674529d, fc17ca6, d1e9345, 7b227c5, dc8d732, dd84eb7, cc8dd12, 3560734, 3e97bad, d02252c, c474794）。劇本8〜10（balancers/dreglord/night_aspect）は未監査。

今回はユーザー確認により、**劇本1〜10全部を対象に再監査**する（既監査分も含め漏れが無いか再確認）。ただし対象は `floor.reward` 配列のみ（敵人の `enemy_auto_gm_data.js` 構造化は対象外）。

## 決定事項（ユーザー承認済み）

1. **対象範囲**：劇本1〜10全部（`scenarios.js` の10エントリ）。実質的には `fields_data_1.js`〜`_4.js` の全カード・全ブランチ・全フロアの `reward` 配列を本文と突き合わせる網羅監査になる（劇本単位ではなくカード単位で1回ずつ監査すれば、全劇本を自動的にカバーする）。
2. **監査範囲は `floor.reward` 配列のみ**。`enemy_auto_gm_data.js`（savingThrow/elementAccum等の敵人自動化GM構造化）は対象外。
3. **並行実行方針**：`fields_data_1.js`〜`_4.js` の4ファイルを4つの独立agentへ並行dispatchする（各ファイル1500〜3600行あり、1agent通しでは精度が落ちるリスクがあるため）。各agentは独自のgit worktreeで作業する。
4. **Playwright回歸確認**：劇本3（sentient_pest）・劇本4（augur）を対象に、実際にゲームを作成して進行させ、フロア進行・獎勵付与・戦闘トリガーにコンソールエラーが出ないことを確認する。自動朗讀（read-aloud/TTS機能があれば）はOFFにする。
5. **push先**：新規ブランチ `auto-allMap` を作成し、`private` 遠端のみへpush（`origin` へは推送しない）。

## 監査基準（既存commitの踏襲）

各ブランチの各フロアについて、`lines` 本文中の以下の記述を走査し、対応する `reward` 配列エントリの有無・値の正確性を確認する：

- 「撃破盧恩：N」「盧恩：N」→ `{ kind: "rune", value: N }`
- 「武器：★」「射撃武器：★」「盾：★」「聖印：★」等 → `{ kind: "weaponStar", value, categoryId? }`
- 消耗品名の明記 → `{ kind: "consumable", ... }`
- 護符の明記 → `{ kind: "talisman", ... }`
- 「気力覚醒」→ `{ kind: "potentialPower" }`
- 「石剣の鍵」→ `{ kind: "stoneswordKey", perPerson? }`
- 「鍛石」→ `{ kind: "smithingStone", perPerson? }`
- 「聖杯瓶」関連 → `{ kind: "chaliceBonus" }`
- 戦技再抽選 → `{ kind: "weaponSkillReroll" }`
- 相互排他的な分岐報酬（「いずれか1つ」等）→ 平坦な配列ではなく `tieredChoice` で統一されているか
- 役判定（ダイス手役）による報酬 → `diceHandChoice` で構造化されているか
- HP損害・GM裁量が必要な記述（`■` 等）→ `hpDamage`/`note` としてGM判断に残し、自動loot化しない（`■` を自力で数値化しない、CLAUDE.md §19）
- `perPerson: true` の smithingStone/stoneswordKey は個別push対象外（既存仕様どおり）

修正は最小限：本文とreward配列のズレのみを補完し、無関係なリファクタリングは行わない。

## 実装方針

### A. 4agent並行監査（worktree isolation）

- `Agent`（`isolation: "worktree"`）を4回、1メッセージ内で並行呼び出しする。各agentへは対象ファイル（`fields_data_1.js`〜`_4.js` のいずれか1つ）、監査基準（上記）、参考にすべき既存commit例（`674529d`, `d1e9345` 等の diff）を明示する。
- 各agentは対象ファイル内の全カード・全ブランチ・全フロアを走査し、ズレを見つけたら `node --check static_src/fields_data_N.js` で構文確認のうえ、既存の commit message パターン（`fix(fields): 補完◯◯的reward陣列與本文記述落差` 等）に沿って複数回に分けてcommitする（1カードあるいは1ブランチ単位を目安に、既存の粒度を踏襲）。
- 修正が0件のカード・ブランチはそのままでよい（無理に変更を作らない）。

### B. 統合

- 4つのworktree成果を、コーディネーター（本セッション）が `all-enemy` ブランチへ順次 `git merge` または `git cherry-pick` で取り込む。
- 取り込み後、`node --check static_src/fields_data_1.js static_src/fields_data_2.js static_src/fields_data_3.js static_src/fields_data_4.js` と `py -3 generate.py` を実行し、エラーが無いことを確認する。

### C. Playwright回歸確認（劇本3・劇本4）

- 使い捨てPlaywrightスクリプトで、Admin経由（password: `night`のdialog処理必須）でscenarioId `sentient_pest`（劇本3）・`augur`（劇本4）のゲームをそれぞれ作成。
- `night/index.html?game=<id>` を開き、自動朗讀機能があれば無効化した上で、可能な範囲でフィールド進入・フロア突破判定・獎勵確定・戦闘トリガーを実際に操作し、コンソールエラー（`read_console_messages` 相当、またはPlaywrightの `page.on("console")`/`page.on("pageerror")`）が出ないことを確認する。
- Playwrightスクリプトはコミットしない（使い捨て）。

### D. push

- 全樓層板塊の監査・統合・Playwright確認が完了した後、`auto-allMap` ブランチを作成し、`private` 遠端のみへpush（`origin` へは推送しない）。ユーザーの明示的許可がある操作のため、pushの実行前に最終確認は不要（本設計で承認済み）。

## 検証方法

1. 各agentのcommit後、対象ファイルの `node --check`。
2. 統合後、`py -3 generate.py` がエラー無く完走すること。
3. Playwrightで劇本3・劇本4を進行させ、コンソールエラー・`window.PriTestGames`未定義等の異常が発生しないこと。
4. 監査によるreward配列の追加・修正が、既存の `floor.reward` 構造（`kind` の型、`perPerson`、`tieredChoice`/`diceHandChoice` の使い分け）を壊していないこと（`night_floor_breakthrough.js` 側のロジック変更は本タスクの範囲外のため、データ形式を厳守する）。

## 対象外（スコープ外）

- `enemy_auto_gm_data.js`／`boss_auto_gm_data.js` 側の敵人自動化GM構造化（savingThrow/elementAccum等）。
- `night_floor_breakthrough.js`／`night_gm_flow.js` 側のロジック変更（既存の獎勵清單統合パイプラインをそのまま使う）。
- 劇本3・4以外のシナリオのPlaywright実機回歸テスト（監査自体は劇本1〜10全部が対象だが、実機確認は劇本3-4に限定）。
- `origin` 遠端へのpush。
