# フロア獎勵の獎勵清單統合＋劇本1データ監査 設計

## Context

`floor.reward`（`fields_data_*.js`）は各フロアの報酬候補を構造化データとして持つが、実際の確定・付与は `night_floor_breakthrough.js` の `renderFloorRewardOption` が種別ごとに個別実装しており、対象PCへ直接ロースターを書き換える。一方、GMが任意に項目を追加できる独立の「獎勵清單」（`state.turnRewards`、`night.js` の `claimTurnReward`/`renderTurnRewardModal`）が既に存在し、抽選（武器/消耗品/護符/潜在之力）・共有カウンター（石剣の鍵/鍛石）・全體/任意/個別ターゲット選択まで一通り実装済み。この2系統が並存しており、ユーザーから次の3点が「不夠精確」として指摘された：

1. フロア獎勵が獎勵清單を介さず直接ロースターへ適用され、統一管理・記録ができない。
2. 「擊破盧恩：N」の正規表現フォールバック検出（`appendRuneGrantRowIfDetected`）がreward配列と別経路のため、記述とデータのズレを都度検出に頼っており不正確になりやすい。
3. 敵撃破後の自動獲得が、フロア敘述内の雜兵戰鬥／ボス戦闘トリガー（自動化GM Phase 2、`night_gm_flow.js`）に限定されている。

対象範囲は劇本1（`scenarios.js` の `tricephalos`、道1×9カード＋道2×6カード＋起點/終點）に限定し、完成後に他劇本へ展開する。

## 決定事項（ユーザー承認済み）

1. `floor.reward` の各エントリを「戦利品」種別（`rune`/`weaponStar`/`consumable`/`talisman`/`potentialPower`/`stoneswordKey`/`smithingStone`/`chaliceBonus`/`weaponSkillReroll`）と「GM判断が必要」種別（`hpDamage`/`tieredChoice`/`diceHandChoice`/`bargainReveal`/`note`）に分類する。`weaponSkillReroll`（鍛冶村の戦技再抽選）は`potentialPower`と同じ「入場中PCごとに1件」パターンとして扱う。
2. 「戦利品」種別は直接ロースターへ適用せず、`state.turnRewards`（獎勵清單）へpushし、確定処理は既存の `claimTurnReward` にそのまま委譲する（実装を二重化しない）。
3. フロア終端（`handleFloorEndRewardClick`）到達時に「戦利品」エントリを自動で獎勵清單へ全pushし、GM敘述にpush内容を一覧表示する。これは戦闘由来・非戦闘由来を問わず全フロア終端に一律適用する。「GM判断が必要」エントリが残る場合のみ、それらだけを表示する縮小版モーダルを引き続き開く。
4. `appendRuneGrantRowIfDetected`（撃破盧恩の正規表現フォールバック）は残すが、動作を「全員へ直接加算」から「獎勵清單へ `rune`/`__shared__` としてpush」に統一する。
5. **`diceHandChoice`（役判定式報酬）は新規の専用抽選視窗として実装する**。既存のインライン12ダイス選択UI（`floor-reward-modal` 内に埋め込み）を、`item-draw-modal` と同様の独立モーダル（開く/閉じる/縮小/復元、スタッキング型固定ボタン）として切り出す。判定結果（該当する役の `rewards[]`）が確定した瞬間に、それらの「戦利品」エントリを獎勵清單へpushする（決定事項2/3と同じ経路）。ダイス目の入力方式は現行踏襲（物理卓で振った出目をGMが手動入力）に加え、デジタル進行向けの「隨機擲骰」ボタンを追加する。
6. 劇本1のデータ監査：`tricephalos` の各カード位置について `varianceTable` から劇本1該当分岐を特定し、その配下の全フロアで本文記述とreward配列を突き合わせ、記述はあるが構造化データが無い箇所（フォールバック頼み）を正式なreward配列エントリとして `fields_data_1.js` に追記する。

## 実装方針（概要、詳細は実装計画で確定）

### A. 「戦利品」→獎勵清單pushの共通処理

- `night_floor_breakthrough.js` に `floorRewardEntryToTurnRewards(entry, floor)` を新設し、`kind`ごとに `state.turnRewards` へpushする1件以上のオブジェクトを組み立てる：
  - `rune`/`chaliceBonus` → `targetCharacterId: TURN_REWARD_SHARED_TARGET_VALUE`（全體）
  - `weaponStar` → `kind:"weapon"`、`categoryId`/`attributeTag`（未解決の`{ja,zh}`のまま保持）を追加フィールドとして持たせ、`targetCharacterId: TURN_REWARD_ANY_TARGET_VALUE`
  - `consumable`/`talisman`/`stoneswordKey`/`smithingStone` → 既存 `kind` のまま、対象未定は`__any__`、共有カウンター系は対象なし
  - `potentialPower` → 入場中PCごとに1件ずつ、`targetCharacterId` はそのキャラID固定、`attributeTag` を追加フィールドとして保持
  - `weaponSkillReroll` → 入場中PCごとに1件ずつ、`targetCharacterId` はそのキャラID固定（新規 `TURN_REWARD_KINDS` エントリとして追加し、claim時に `openWeaponSkillRerollModal` を呼ぶ）
- `night.js` の `claimTurnReward` を拡張し、`kind==="weapon"` かつ `reward.categoryId`/`reward.attributeTag` がある場合は `openItemDrawModal` へそのまま渡す（`attributeTag` は claim時に `PriTestFields.localizedText` で解決）。`kind==="potentialPower"` は `reward.attributeTag` があれば `openPotentialPowerModal` の第3引数へ渡す（現状 `null` 固定）。
- 二重push防止：`floor.__rewardKey + "_pushed_" + entryIndex` を `state.floorRewardObtained` と同じ辞書に記録する。

### B. フロア終端フローの変更

- `night_gm_flow.js` の `handleFloorEndRewardClick`：`floor.reward` を「戦利品」／「GM判断」に分類し、「戦利品」は`floorRewardEntryToTurnRewards`経由で即座に獎勵清單へpush、push結果をGM敘述（`turnMessages`）へ追記する。「GM判断」エントリが残っていれば、それらのみを表示する `openFloorRewardModal` を引き続き開く。無ければモーダルを開かずゲートを閉じる。
- `night_floor_breakthrough.js` の `renderFloorRewardOption`：`rune`/`weaponStar`/`consumable`/`talisman`/`potentialPower`/`stoneswordKey`/`smithingStone`/`chaliceBonus`/`weaponSkillReroll` 用の直接適用コードは削除し、`hpDamage`/`tieredChoice`/`diceHandChoice`/`bargainReveal`/`note` のみ残す。`tieredChoice`/新設diceHandChoice視窗が内部で解決した `rewards[]`（サブエントリ）は同じ `floorRewardEntryToTurnRewards` を再帰的に呼ぶ。

### C. `diceHandChoice` 専用抽選視窗

- 新規モーダル（例: `#dice-hand-draw-modal`）を `night_page.py` に追加。`item-draw-modal` と同じ開閉/縮小/復元パターン（`minimizeDiceHandDrawModal`/`restoreDiceHandDrawModal`、`btn-dice-hand-draw-modal-restore`）を実装。
- 12個の出目セレクタ＋「隨機擲骰」ボタン（`Math.random()`で一括ランダム設定、物理卓で振った場合はGMが手動で上書き可能）＋「判定」ボタンは既存ロジック（`counts`/`maxCount`/`isStraight`等の役判定）をそのまま移植。
- 判定確定時、該当 `hand.rewards[]` を `floorRewardEntryToTurnRewards` へ渡して獎勵清單へpushし、モーダルを閉じてfloor終端ゲートへ復帰する。

### D. 撃破盧恩フォールバックの統一

- `appendRuneGrantRowIfDetected` のボタン押下時処理を `grantRuneToAllEntered` 直接呼び出しから、`state.turnRewards.push({kind:"rune", targetCharacterId: TURN_REWARD_SHARED_TARGET_VALUE, value, claimed:false})` へ変更する。

### E. 劇本1データ監査

- `scenarios.js` の `tricephalos.day1`/`day2`/`start`/`end` 各カードについて、対応する `fields_data_*.js` の `varianceTable` からシナリオ「1」列の分岐を特定する。
- 特定した分岐配下の全フロアの `lines` 本文（「擊破盧恩：N」「獲得」等の記述）と `reward` 配列を突き合わせ、記述はあるが対応するreward配列エントリが無い箇所を正式データとして追記する。
- 監査対象外（劇本1に該当しない分岐）は変更しない。

### F. i18n

新規UI文言（`dice-hand-draw-modal` の開閉/縮小/復元/隨機擲骰ボタン、フロア終端のpush結果一覧メッセージ）をzh/ja/en 3言語で `site_src/i18n_data_*.py` に追加。

## 検証方法

1. `node --check` 対象ファイル → `py -3 generate.py` ビルド。
2. Playwright新規シナリオ（劇本1・大教會カード等、雜兵戰鬥を含むフロアで検証）：
   - 雜兵戰鬥トリガー→撃破→フロア終端ゲートを閉じた瞬間に、武器/盧恩等が獎勵清單へ自動push（GMのモーダル操作なし）されること。
   - `diceHandChoice` を含むフロアで新モーダルが開閉/縮小/復元でき、「隨機擲骰」または手動入力→判定→該当役の報酬が獎勵清單へpushされること。
   - `hpDamage`/`bargainReveal`/`note` を含むフロアでは、旧来通りfloor-reward-modalが表示され続けること（獎勵清單を経由しない）。
   - 獎勵清單側で `kind:"weapon"` の`categoryId`/`attributeTag`付きアイテムが正しく武器抽選ウィザードに引き継がれること。
3. 既存の全Playwright回帰テストを実行し、リグレッションが無いことを確認。
4. コンソールエラー無し。

## 対象外（スコープ外）

- 劇本1以外の劇本のデータ監査（今回はフォールバックのまま維持）。
- `hpDamage`/`bargainReveal`/`note` の獎勵清單統合（性質上、直接適用/GM記録のまま据え置き）。
- 強敵チット／ランダムチット等、フロア敘述と無関係な戦闘終了時の自動push（`docs/scenario_flow_rules.md` に記載の既存未実装事項、別スコープ）。
