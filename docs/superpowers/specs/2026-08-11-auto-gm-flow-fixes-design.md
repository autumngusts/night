# 自動化GM關聯修正（開場敘述・新遊戲・翻牌・紀錄・戰鬥前情報・獎勵領取）設計

## Context

自動化GM（`state.gmFlowEnabled`／`state.autoGmEnabled`、`night_gm_flow.js`）の運用を重ねた結果、ユーザーから7点の不具合・改善要望が挙がった。いずれも「進度版（`#location-status-overlay`）を軸にした自動化GMフロー」に関連するため、1つの設計・実装単位としてまとめて扱う。

1. 開場敘述（世界観データの夜の王〔開場〕）が `state.gmFlowEnabled` の時しか表示されない。
2. 新遊戲を押すと `state.autoGmEnabled`／`state.gmFlowEnabled` が強制的にOFFへリセットされる。また角色（PC）を「剛入場」状態へ戻す手段が無い。
3. 起點に隣接する3格（板塊番号1,4,7）の自動翻開が、自訂模式かつ `gmFlowEnabled` 時にしか発火せず、劇本模式（`dealScenarioInitial`）では未対応。
4. 進度版上の選択・判定・戰鬥ダメージ確定等が「紀錄」ドロワーの「自動化GM紀錄」タブ（`state.autoGmLog`）へほとんど記録されていない。
5. 戰鬥トリガー（[雜兵戰鬥]/[王戰]）ボタンを押す**前**に、遭遇する敵情報（名稱・等級・種族・尺寸・HP）が見えない（押した後にしか出ない）。
6. 樓層獎勵の領取フロー：ボタン名・閃紅字が状況に応じて変わらず、[領取獎勵]を押すと即座に次の処理へ進んでしまい、玩家が実際に獎勵を受け取り終えたかを待たない。また獎勵清單の「新增」ボタンに認証制限が無い。

## 決定事項（ユーザー承認済み）

### A. 開場敘述を常に表示

`maybeShowOpeningNarration()` から `state.gmFlowEnabled` の判定を外し、`submitSelection()`（自訂模式）・`dealScenarioInitial()`（劇本模式）の両方で、カード配置の**前**に必ず呼ぶ。世界観データに対応する開場文が無い場合（`resolveOpeningNarrationText()` が null）は何も起きない（現状通り）。

### B. 新遊戲：自動GMトグル維持＋角色重置確認

- `resetState()` から `state.autoGmEnabled = false` / `state.gmFlowEnabled = false` の強制リセットを削除し、ユーザー設定を維持する。
- `handleNewGame()`：密碼確認後、既に盤面があった場合（`hadBoard`）のみ「是否也要重置角色？」を `window.confirm` で確認する。
- YESの場合、`entered === true` の角色それぞれについて、`CharacterDrawer.newCharacter(c.name, c.typeId)` で生成した「初期配置の同職業角色」の中身で **`id`／`entered` を保持したまま完全上書き**する（等級1・初期武器のみ・盧恩0・已習得盧恩效果／附加效果／護符／消耗品クリア・骰子池／執行紀錄（`pendingActionBoxes`）クリア）。未入場の角色は対象外。

### C. 起點鄰接3格を常時翻開

`revealStartAdjacentSlots()`（既存実装は `pileAdjacentSlotIndices("start")` で正しく `[0,3,6]`＝板塊番号1,4,7を返す、日替わりのstart/end入れ替えにも対応済み）の呼び出し条件から `state.gmFlowEnabled` を外し、`submitSelection()` と `dealScenarioInitial()` の両方で常に呼ぶ。

### D. 自動化GM紀錄への記録範囲

`window.PriTestNightAddAutoGmLog(text)`（既存フック）を以下の確定ポイントに追加する。単純な [進入]/[OK]/[領取完] 等のページ送りボタンはログしない。

**進度版の決定：**
- 分岐選擇（`handleBranchChoiceClick`）／(→X)選擇（`handleLineChoiceClick`）／路線自由の樓層選擇
- 各種行為判定・協力判定確定時の結果（成功/失敗、骰值合計）
- 戰鬥觸發（[雜兵戰鬥]/[王戰]、遭遇した敵情報つき）
- 樓層突破判定・登攀判定の合否確定（`resolveBreakthroughCheck`）
- 籌碼事件の使用/稍後
- 樓層獎勵の領取完了

**戰鬥ダメージ・屬性・特殊效果：**
- 玩家→敵人ダメージ確定（`applyGuardedDamageToEnemy`）：総傷害・破防前後・HP價值・削れたHP格数・対象敵人
- 敵人→玩家ダメージ確定（`handleEnemyDamageConfirmForCharacter`／`finishEnemyDamageRound`）：亂戰傷害・個別傷害・HP價值・各PCのHP損失
- 屬性蓄積（`recordAttributeStatusDealt`＝玩家→敵人、`addReceivedAttributeStatus`＝敵人→玩家）
- 屬性/異常閾値到達による特殊效果發動（`applyAttributeStatusElementTriggerOnEnemy`／`AilmentTriggerOnEnemy`／`ElementTriggerOnChar`／`AilmentTriggerOnChar`）

上記以外の既存 `addLog` 呼び出し（防禦骰の内訳、装備変更等の細かい操作ログ）はミラーしない。

### E. 戰鬥觸發前の敵情報プレビュー

`actionKind === "combatTrigger"`（[雜兵戰鬥]/[王戰] ボタンだけが表示されている状態）の時点で、`collectCombatEnemyLines` が解析した敵行の情報を、`resolveAndAddCombatEnemies`（実際に戦場へ追加・state変更を伴う）を呼ばずに `Enemies.get()` だけで解決するプレビュー関数を新設し、ボタン表示と同時に敘述へ追加する。内容は既存 `buildEncounterSummaryText` と同一項目（名稱・等級・種族・尺寸・HP）。防禦次數・HP價值はそもそも現状も出力されていないため、追加の絞り込みは不要。

### F. 樓層獎勵領取フローの刷新

1. ボタン名変更：「獲得完」→「領取完」（zh/ja/en 3言語）。
2. `.gm-flow-waiting-badge`（閃紅字）のテキストを動的化：
   - `actionKind === "floorEnd"` かつ [領取獎勵] 未クリック：「領取獎勵！」
   - [領取獎勵] クリック後、獎勵清單／樓層獎勵モーダルが未解決の間：「等待領取完」
   - それ以外：現状通り「GM等待中」
3. `handleFloorEndRewardClick`：`closeGmFlowGateAndConsumePendingAdvance()` を呼ばなくする。代わりに：
   - 戦利品が自動pushされた場合、`openTurnRewardModal()` を呼ぶ。
   - GM判断が必要な項目が残る場合、従来通り `openFloorRewardModal` を開く。
   - 敘述へ「等待玩家領取完畢」の行を追加打字する。
   - 開いた獎勵清單／樓層獎勵モーダルを、既存の `pendingRewardWindows` 追跡（`addPendingRewardWindow`/`removePendingRewardWindow`）へ登録する。
4. `handleGmFlowOk`（[領取完]）は既存の `pendingRewardWindows.length > 0` ガードをそのまま利用し、追跡対象が空になるまでリマインドを繰り返す（新規ロジック不要、登録漏れが無いようにするのが本質）。
5. 獎勵清單（`turn-reward-modal`）の「新增」コントロール（種類/對象/數量select、追加ボタン）を、既存の `state.turnHolder === "gm"` 判定に加えて `isRulebookAuthenticated()` も必須にする（両方満たす場合のみ操作可能）。個別項目の「獲得」／「×」ボタンは対象外（現状通り誰でも操作可）。
6. **跨端末自動ポップアップ**：`window.PriTestDrawStateSync` ＋ `state.activeDraws` の既存パターン（`potentialPower` 抽選窗と同じ仕組み）を踏襲し、新規フラグ `state.activeDraws.turnRewardAutoOpen` を追加する。`floorAutoLootTurnRewards` が実際に何か push した時だけ true にし、`subscribeNightState`（cloud 模式のみ有効）のコールバック内で、他端末でもローカルに隠れていれば `openTurnRewardModal()` を呼ぶ。モーダルが閉じられた（`closeTurnRewardModal()`）時点でこのフラグをクリアする。主選單から手動で開く既存の挙動には影響しない（このフラグは「戦利品自動push起因のみ」セットする）。

## 検証方法

1. `node --check` 対象ファイル（`night.js`／`night_gm_flow.js`／`night_floor_breakthrough.js`）→ `py -3 generate.py` ビルド。
2. Playwright使い捨てスクリプトで以下を確認：
   - 新規ゲーム作成直後（`gmFlowEnabled` OFF状態含む）に開場敘述が打字機で表示されること。
   - 板塊配置直後、板塊1,4,7が自動翻開されていること（自訂模式・劇本模式の両方）。
   - 新遊戲実行後、`state.autoGmEnabled`／`gmFlowEnabled` が実行前の値のまま維持されること。角色重置確認でYESを選んだ場合、入場中角色が等級1・初期武器のみに戻ること。NOの場合は変化しないこと。
   - 戰鬥トリガーボタン表示時点（クリック前）で敵情報が敘述に出ていること。
   - 雜兵戰鬥→擊破→[領取獎勵]クリック後、獎勵清單が自動で開き、［領取完］を押しても獎勵清單が開いたまま（または未全部claimed）だと進まないこと。全部claimed後・モーダルを閉じた後に［領取完］が効くこと。
   - `state.autoGmLog` に上記D節の各イベントが記録されること。
3. 既存の回帰確認（前セッションで作成した樓層獎勵自動push・reload安全性のテストが壊れていないこと）。
4. コンソールエラー無し。

## 対象外（スコープ外）

- `local` storageMode（単一端末）における「跨端末自動ポップアップ」：デバイスが1つしか無いため対象外（該当機能はcloud模式でのみ意味を持つ）。
- 既存の細かい `addLog`（通常ログ）呼び出し全件を自動化GM紀錄へミラーすること（D節に列挙した範囲のみ）。
- 強敵／恐るべき強敵チット戰鬥・ランダムチット等、樓層敘述と無関係な戰鬥トリガーへの本設計内容の適用（別スコープ、今回は樓層敘述由来の [雜兵戰鬥]/[王戰] のみ対象）。
