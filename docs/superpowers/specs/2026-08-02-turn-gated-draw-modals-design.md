# GM回合限定の抽選系モーダル統合設計

## Context

これまでのセッションで `state.turnHolder`（"gm"|"players"）、`state.turnMessages`、`state.turnRewards`、`.modal.minimized` の縮小CSSパターンを構築済み。今回のユーザー要望は、既存の5つの機能（獎勵勾選清單／潛在之力／抽選武器／抽選消耗品／抽選飾品）と、戦闘パネルの亂戰傷害表示を、この turnHolder の仕組みに統合すること。

調査で判明した重要な前提：
- 潛在之力・抽選武器の「星數(1〜4)」は現状すべてGM手動の `<select>` 選択であり、骰子で決定する仕組みはゲーム規則書にも存在しない。ユーザーに確認済みで、**星數の自動判定は行わず、現状通りカテゴリと同時にGMが手動選択する**ことで確定した（当初の要望文言「程式先第一步判定此獲得是多少星」は撤回され、既存の手動選択のままでよいとの回答）。
- 抽選武器／潛在之力／抽選消耗品／抽選飾品の4つの抽選フローの進行中状態は、現状すべて `night.js`／`character_drawer.js` のモジュールスコープのローカル変数にのみ存在し、`state` オブジェクトに一切乗っていない（`buildSaveData`/`applyLoadedData`/cloud sync の対象外）。真のクロス端末同期を実現するには、これらを `state` へ移す新規アーキテクチャが必要。
- 潛在之力には既に `potentialPowerMinimized`/`minimizePotentialPowerModal`/`restorePotentialPowerModal` という独自の縮小機構が存在するが、確立済みの `.modal.minimized` CSSパターンと同一かどうかは実装時に確認・統一する。
- 亂戰傷害の表示は `renderSelectedEnemies` 内で `target.withRemove` フラグにより分岐しており、`#battle-selected-enemies`（戦闘資訊drawer、誰でも開ける）では表示、`#board-side-enemies`（共有ボード側パネル）では非表示という現状。

## 決定事項（ユーザー承認済み）

1. **獎勵勾選清單の開くボタン**を `#turn-holder-bar` から `#main-menu-list` へ移動する。
2. **5機能（獎勵勾選清單／潛在之力／抽選武器／抽選消耗品／抽選飾品）の「新規に開く」メインメニュー項目**は `state.turnHolder === "gm"` の時のみ表示する。ただし、GMが既に開いて縮小した小窓は、GM回合が終わっても**全員に見え続け、誰でも続きの操作（骰子を振る・確定して獲得する）ができる**。ゲートがかかるのは「新規オープン」のみ。
3. **抽選武器／消耗品／飾品**（`#item-draw-modal` 経由の3つ）に、確立済みの `.modal.minimized` CSSパターンで縮小トグルを新設する。潛在之力の既存縮小機構は同パターンに統一する。
4. **跨裝置同步**：新規 `state.activeDraws = { potentialPower, weapon, talisman, consumable }` を新設し、既存の4箇所パターン（default state／resetState／applyLoadedData／buildSaveData）で永続化・クラウド同期する。character_drawer.js は night.js のクロージャ外にあるため、双方向ブリッジを新設する：
   - 書き込み側：`window.PriTestDrawStateSync.set(kind, obj)` を character_drawer.js の各mutation箇所（ロール実行・選択変更・確定など）の後に呼び、night.js側の `state.activeDraws[kind]` へ反映＋永続化＋クラウド送信をトリガーする。
   - 受信側：`subscribeNightState` のリモート更新コールバックから `CharacterDrawer.applyRemoteDrawState(kind, data)` を呼び、character_drawer.js のローカル変数を上書きし、現在マウント中の該当インライン欄があれば再描画する。
   - 既存の骰子ロジック自体（`rollD6`・テーブル参照など）は変更しない。改修は「mutationの後にstateへ書き戻す」フックの追加に留める。
5. **GM回合限定の設定変更**：類別・星數・稀有度の手動上書き・隨機戰技a/b選択などの「設定系」操作は `state.turnHolder !== "gm"` の間 `disabled`。骰子を振る・確定して獲得するという「実行系」操作はGM/玩家問わず常時可能。
6. **亂戰傷害の非公開化**：`withRemove:true` 側の亂戰傷害の数値表示条件に `state.turnHolder === "gm"` を追加し、GM回合中のみ表示、玩家回合中は非表示にする（他のenemy情報の表示は変更しない）。

## 実装方針（概要、詳細は実装計画で確定）

### A. UI配置変更（低リスク）
- `#btn-turn-reward-open` を `site_src/night_page.py` の `#main-menu-list` 内へ移動。
- 5機能の起動ボタン（`#btn-turn-reward-open`, `#btn-potential-power-info`, `#btn-main-menu-draw-weapon`, `#btn-main-menu-draw-talisman`, `#btn-main-menu-draw-consumable`）の表示/非表示を、既存のメインメニュー再描画関数内で `state.turnHolder === "gm"` に応じて `hidden` を切り替える処理を追加。

### B. 縮小機能の統一
- `#potential-power-modal` の既存縮小実装を確認し、`.modal.minimized` パターン（style.cssの既存ルール）へ統一。
- `#main-menu-draw-modal`／`#item-draw-modal` に縮小トグルボタンを新設し、同パターンを適用。

### C. `state.activeDraws` の新設とブリッジ
- night.js: `state.activeDraws` を default state／`resetState`／`applyLoadedData`／`buildSaveData` の4箇所に追加。型は `{ potentialPower: object|null, weapon: object|null, talisman: object|null, consumable: object|null }`。
- night.js: `window.PriTestDrawStateSync = { get(kind), set(kind, obj) }` を公開。`set` 内で `state.activeDraws[kind] = obj` の代入後、既存のsave/cloud-push関数を呼ぶ。
- character_drawer.js: 各ロールstate（`weaponRollState`/`talismanRollState`/`consumableRollState`）のmutation箇所（`resetXxxState`／各step関数／確定関数）の直後に `syncDrawStateIfAvailable(kind)` 相当のフックを追加。
- night.js: `subscribeNightState` のリモート反映コールバック内で `CharacterDrawer.applyRemoteDrawState(kind, state.activeDraws[kind])` を呼び出し、該当インライン欄が開いていれば再描画。
- 潛在之力側（night.js内で完結）は同様に `potentialPowerXxx` ローカル変数群を `state.activeDraws.potentialPower` 経由の読み書きへ置き換える。

### D. GM限定ロックの適用
- 各draw flowの設定系input（類別select、星數select、稀有度上書きselect、隨機戦技a/b関連ボタン）に `disabled = (state.turnHolder !== "gm")` を追加。既存の `rarityConfirmed` 等による disabled 条件とは `||` で共存させる。

### E. 亂戰傷害の非公開化
- `renderSelectedEnemies` 内、`withRemove:true` 側の亂戰傷害表示ブロックに `&& state.turnHolder === "gm"` を追加。

### F. i18n
新規UI文言（縮小/復元ボタンのラベル等、既存の `.modal.minimized` パターンに準拠するもの）を zh/ja/en 3言語で `site_src/i18n_data.py` に追加。

## 検証方法

1. `node --check` → `py -3 generate.py` ビルド。
2. Playwright新規テスト：
   - メインメニューの5項目が `turnHolder` に応じて表示/非表示が切り替わること。
   - 獎勵勾選清單の開くボタンがメインメニュー内にあること。
   - 潛在之力／抽選武器／消耗品／飾品の縮小トグルが機能し、`.modal.minimized` の見た目になること。
   - GMが潛在之力（または抽選武器）で類別・星數を選択→縮小した状態を、別セッション（別localStorage/別ブラウザコンテキスト、cloudモードで再現）から見て、骰子を振る・確定する操作が行えること（`state.activeDraws` 経由の同期を検証）。
   - `turnHolder !== "gm"` の間、類別・星數等のselectが `disabled` になること。
   - 戦闘資訊drawerの亂戰傷害が `turnHolder` に応じて表示/非表示になること。
3. 既存の全Playwright回帰テストを実行し、リグレッションが無いことを確認。
4. コンソールエラー無し。

## 対象外（スコープ外）

- 星數の自動（骰子）判定は行わない（ユーザーが明示的に不要と回答）。
- 本物のユーザー権限・認証システムは導入しない。`turnHolder` を代替の可視性ゲートとして使う、既存の設計方針を踏襲する。
