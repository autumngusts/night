# 自動化GM關聯修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自動化GM（`state.gmFlowEnabled`）関連の6件の不具合・改善要望（開場敘述・新遊戲・翻牌・自動化GM紀錄・戰鬥前情報・獎勵領取フロー）を、`docs/superpowers/specs/2026-08-11-auto-gm-flow-fixes-design.md` の設計どおりに実装する。

**Architecture:** すべて既存の `static_src/night.js`（メインclosure）と `static_src/night_gm_flow.js`（自動化GM敘述フローclosure）への修正。新規ファイルは作らない。既存のexport窓口（`window.PriTestNightCore`）・既存の汎用機構（`pendingRewardWindows`、`activeDraws`＋`subscribeNightState`の跨端末同期パターン、`addAutoGmLog`）を再利用し、新しい仕組みは増やさない。

**Tech Stack:** Vanilla ES5 JS（IIFE + `window.PriTest*`名前空間）、Python生成の静的HTML（`site_src/*.py`）。自動テストフレームワークなし——検証は`node --check`（構文）と、Playwrightの使い捨てスクリプト（コミットしない）。

## Global Constraints

- ビルドは`py -3 generate.py`（Windows）。`static_src/`または`site_src/`を編集したら必ず再実行する。
- JSはES5のみ（`const`/`let`/アロー関数/テンプレートリテラル禁止、`var`と`function`式のみ）。
- i18n文字列は`site_src/i18n_data_zh.py`/`_ja.py`/`_en.py`の3ファイル全てに追加・変更する（`zh`が既定言語）。
- 新規関数は既存のIIFEクロージャ内に置き、他モジュールへ公開する場合は既存の`window.PriTestNightCore`/`window.PriTestNightFloorBreakthrough`等の名前空間経由のみとする。
- Playwright検証スクリプトは使い捨てで、リポジトリにコミットしない（`docs/scenario_flow_rules.md`と同じ既存方針）。スクラッチパスは各タスクで指定するローカル一時ディレクトリを使う。
- 各タスクの完了時に`node --check`対象ファイルと`py -3 generate.py`を実行し、エラーが無いことを確認してからコミットする。

---

### Task 1: 起點鄰接3格の常時翻開（設計書§C）

**Files:**
- Modify: `static_src/night.js:11433`（`submitSelection`内の条件付き呼び出し）
- Modify: `static_src/night.js:11482`付近（`dealScenarioInitial`、新規呼び出し追加）

**Interfaces:**
- Consumes: 既存の`revealStartAdjacentSlots()`（`static_src/night.js:11900`、変更不要——実装済みで板塊番号1,4,7=0-indexed`[0,3,6]`を正しく返す）。

- [ ] **Step 1: `submitSelection`の条件付き呼び出しを無条件化**

`static_src/night.js:11433`の

```js
    if (state.gmFlowEnabled) revealStartAdjacentSlots();
```

を

```js
    revealStartAdjacentSlots();
```

へ置き換える。

- [ ] **Step 2: `dealScenarioInitial`にも呼び出しを追加**

`static_src/night.js:11481-11482`の

```js
    state.focusedIndex = "start";
    state.boardStarted = true;
    renderBoard();
```

を

```js
    state.focusedIndex = "start";
    state.boardStarted = true;
    revealStartAdjacentSlots();
    renderBoard();
```

へ置き換える。

- [ ] **Step 3: 構文チェックとビルド**

```bash
node --check static_src/night.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 4: Playwright動作確認（使い捨てスクリプト）**

`admin/index.html`で`window.PriTestGames.create("t1", "tricephalos", "local")`によりゲームを作成し（`storageMode:"local"`）、`night/index.html?game=<id>`を開く。主選單→設定→［開始］（劇本模式なので`dealScenarioInitial`が呼ばれる）を押した直後に以下を確認する：

```js
// ブラウザコンテキストで実行
var Core = window.PriTestNightCore;
var revealed = [0, 3, 6].map(function (i) { return Core.state.slots[i] && Core.state.slots[i].revealed; });
console.log("slots 1,4,7 revealed:", revealed); // 期待値: [true, true, true]
```

Expected: `[true, true, true]`。

- [ ] **Step 5: Commit**

```bash
git add static_src/night.js
git commit -m "fix(night): 起點鄰接3格の自動翻開を自動GM設定に関わらず常時発火、劇本模式にも適用"
```

---

### Task 2: 開場敘述を自動GMのON/OFFに関わらず常時表示（設計書§A）

**Files:**
- Modify: `static_src/night_gm_flow.js:138-148`（`maybeShowOpeningNarration`）
- Modify: `static_src/night_gm_flow.js:3738-3753`（`renderLocationBanner`冒頭の早期return）
- Modify: `static_src/night.js:10784-10794`（`renderCurrentLocationStatus`の`showForGmFlow`判定）
- Modify: `static_src/night.js:11942-11956`（`handleNewGame`、Task 3と合流するがここでは開場敘述呼び出しのみ追加）

**Interfaces:**
- Consumes: `state.gmFlow.openingPlayed`（既存フラグ、開場を再生済みかどうか）。

- [ ] **Step 1: `maybeShowOpeningNarration`から`gmFlowEnabled`ゲートを外す**

`static_src/night_gm_flow.js:138-148`の

```js
  function maybeShowOpeningNarration() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    if (!state.gmFlowEnabled || state.gmFlow.openingPlayed || state.gmFlow.awaitingOk) return;
    var text = resolveOpeningNarrationText();
    if (!text) return;
    state.gmFlow.narrationText = text;
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "ok";
    Core.saveState();
  }
```

を

```js
  // 自動化GM Phase 2の他の敘述とは異なり、この開場敘述だけはgmFlowEnabledに関わらず
  // 常に一度だけ再生する（ユーザー指定：自動GMのON/OFFに関わらず、劇本の〔開場〕は
  // 必ず進度版で見せる）。renderLocationBanner／renderCurrentLocationStatus側にも
  // 対応するバイパスがある（openingPlayedがfalseのままawaitingOk中は表示を許可）。
  function maybeShowOpeningNarration() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    if (state.gmFlow.openingPlayed || state.gmFlow.awaitingOk) return;
    var text = resolveOpeningNarrationText();
    if (!text) return;
    state.gmFlow.narrationText = text;
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "ok";
    Core.saveState();
  }
```

へ置き換える。

- [ ] **Step 2: `renderLocationBanner`の早期returnに開場バイパスを追加**

`static_src/night_gm_flow.js:3738-3753`の

```js
  function renderLocationBanner(idx, card) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var dialogueEl = document.getElementById("location-status-dialogue");
    var narrationEl = document.getElementById("location-status-narration");
    var actionsEl = document.getElementById("location-status-actions");
    var waitingBadge = document.getElementById("gm-flow-waiting-badge");
    if (!dialogueEl || !narrationEl || !actionsEl) return;
    if (!state.gmFlowEnabled) {
      dialogueEl.classList.remove("has-dialogue");
      narrationEl.textContent = "";
      actionsEl.innerHTML = "";
      lastTypedNarration = null;
      if (waitingBadge) waitingBadge.hidden = true;
      return;
    }
```

を

```js
  function renderLocationBanner(idx, card) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var dialogueEl = document.getElementById("location-status-dialogue");
    var narrationEl = document.getElementById("location-status-narration");
    var actionsEl = document.getElementById("location-status-actions");
    var waitingBadge = document.getElementById("gm-flow-waiting-badge");
    if (!dialogueEl || !narrationEl || !actionsEl) return;
    // 開場敘述（maybeShowOpeningNarration）は自動GMのON/OFFに関わらず一度だけ必ず見せる
    // ため、「まだ再生していない開場を今まさに表示中」の間だけ、以下のgmFlowEnabledゲートを
    // バイパスする。それ以外のactionKind（branchChoice・floorEnd等）は従来通りgmFlowEnabled
    // 必須のまま。
    var showingUnplayedOpening = state.gmFlow.awaitingOk && !state.gmFlow.openingPlayed;
    if (!state.gmFlowEnabled && !showingUnplayedOpening) {
      dialogueEl.classList.remove("has-dialogue");
      narrationEl.textContent = "";
      actionsEl.innerHTML = "";
      lastTypedNarration = null;
      if (waitingBadge) waitingBadge.hidden = true;
      return;
    }
```

へ置き換える。

- [ ] **Step 3: `renderCurrentLocationStatus`の`showForGmFlow`判定に同じバイパスを追加**

`static_src/night.js:10784-10794`の

```js
    var idx = state.focusedIndex;
    // resolveFieldEntryForSlotはidxが数値の板塊に加え、"start"/"end"（出發地點／終點の板塊）も
    // 解決できる——出發地點にも樓層描写・突破判定があるため、進度版にも表示・操作対象にする。
    var card = window.PriTestNightFloorBreakthrough.resolveFieldEntryForSlot(idx);
    // 自動化GM Phase 2：ゲーム開始直後の〔開場〕敘述は、まだどの樓層にもフォーカスしていない
    // （card===null）段階で表示する必要があるため、awaitingOk中はcardが無くてもバナーを出す。
    var showForGmFlow = state.gmFlowEnabled && state.gmFlow.awaitingOk;
    if (!card && !showForGmFlow) {
      overlay.hidden = true;
      return;
    }
```

を

```js
    var idx = state.focusedIndex;
    // resolveFieldEntryForSlotはidxが数値の板塊に加え、"start"/"end"（出發地點／終點の板塊）も
    // 解決できる——出發地點にも樓層描写・突破判定があるため、進度版にも表示・操作対象にする。
    var card = window.PriTestNightFloorBreakthrough.resolveFieldEntryForSlot(idx);
    // 自動化GM Phase 2：ゲーム開始直後の〔開場〕敘述は、まだどの樓層にもフォーカスしていない
    // （card===null）段階で表示する必要があるため、awaitingOk中はcardが無くてもバナーを出す。
    // 開場敘述だけはgmFlowEnabledに関わらず表示する（night_gm_flow.jsのrenderLocationBanner
    // 側の同名バイパスと対になる）。
    var showingUnplayedOpening = state.gmFlow.awaitingOk && !state.gmFlow.openingPlayed;
    var showForGmFlow = (state.gmFlowEnabled && state.gmFlow.awaitingOk) || showingUnplayedOpening;
    if (!card && !showForGmFlow) {
      overlay.hidden = true;
      return;
    }
```

へ置き換える。

- [ ] **Step 4: `handleNewGame`で新しい開場敘述を再生する**

`static_src/night.js:11942-11956`の

```js
  function handleNewGame() {
    if (!checkNewGamePassword()) return;
    var hadBoard = state.boardStarted;
    resetState();
    renderBoard();
    renderLog();
    renderDicePool();
    renderActionPhaseButton();
    renderTurnHolderBar();
    renderTurnBoardToggleButton();
    renderActionPhaseGrid();
    renderLogFloatToggleButton();
    renderLogFloatingBubble();
    if (hadBoard) addLog("log_new_game");
  }
```

を

```js
  function handleNewGame() {
    if (!checkNewGamePassword()) return;
    var hadBoard = state.boardStarted;
    resetState();
    renderBoard();
    renderLog();
    renderDicePool();
    renderActionPhaseButton();
    renderTurnHolderBar();
    renderTurnBoardToggleButton();
    renderActionPhaseGrid();
    renderLogFloatToggleButton();
    renderLogFloatingBubble();
    if (hadBoard) addLog("log_new_game");
    // resetStateでstate.gmFlow.openingPlayedがfalseへ戻るため、ページ再読込を挟まなくても
    // 新しい遊戲の開場敘述をここで再生する（Task 3でこの関数へ角色重置確認も追加される）。
    if (window.PriTestNightGmFlow) {
      window.PriTestNightGmFlow.maybeShowOpeningNarration();
      renderCurrentLocationStatus();
    }
  }
```

へ置き換える。

- [ ] **Step 5: 構文チェックとビルド**

```bash
node --check static_src/night.js
node --check static_src/night_gm_flow.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 6: Playwright動作確認（使い捨てスクリプト）**

`admin/index.html`で`window.PriTestGames.create("t2", "tricephalos", "local")`によりゲームを作成する（`gmFlowEnabled`を明示的にtrueにしない＝デフォルトfalseのまま）。`night/index.html?game=<id>`を開いた直後、`#location-status-narration`のテキスト長がtime経過とともに増加する（打字機再生中）ことを確認する：

```js
// ページ読み込み直後、繰り返しチェック
var el = document.getElementById("location-status-narration");
console.log("gmFlowEnabled:", window.PriTestNightCore.state.gmFlowEnabled); // false のはず
console.log("narration text len:", el ? el.textContent.length : -1); // 0より大きく、時間とともに増える
```

Expected: `gmFlowEnabled: false` でも開場敘述が打字機で表示される。

- [ ] **Step 7: Commit**

```bash
git add static_src/night.js static_src/night_gm_flow.js
git commit -m "feat(night): 劇本の開場敘述を自動GM設定に関わらず常時打字機表示"
```

---

### Task 3: 新遊戲：自動GMトグル維持＋角色重置確認（設計書§B）

**Files:**
- Modify: `static_src/night.js:2199-2280`（`resetState`、`autoGmEnabled`/`gmFlowEnabled`の強制リセット削除）
- Modify: `static_src/night.js:11942`付近（`handleNewGame`直前に`resetCharacterToInitialState`新設、`handleNewGame`本体に確認ダイアログ追加）
- Modify: `site_src/i18n_data_zh.py`/`_ja.py`/`_en.py`（`new_game_reset_characters_confirm`追加）

**Interfaces:**
- Consumes: `CharacterDrawer.newCharacter(name, typeId)`（既存、`static_src/character_drawer.js:5516`）。
- Produces: `resetCharacterToInitialState(c)`（`night.js`内のみで使う非公開関数）。

- [ ] **Step 1: `resetState`から自動GMトグルの強制リセットを削除**

`static_src/night.js:2237`の

```js
    state.autoGmEnabled = false;
    state.autoGmLog = [];
    state.gmFlowEnabled = false;
```

を

```js
    // ユーザー指定：新遊戲を押しても自動化GM機能のON/OFF設定（autoGmEnabled/gmFlowEnabled）は
    // 変更しない——プレイヤーが設定した状態をそのまま維持する。autoGmLogだけは新しい遊戲の
    // 監査ログとしてクリアする。
    state.autoGmLog = [];
```

へ置き換える。

- [ ] **Step 2: `resetCharacterToInitialState`を新設**

`static_src/night.js:11937`の`checkNewGamePassword`関数の直前に以下を追加する：

```js
  // ユーザー指定：新遊戲で「角色状態も剛入場の状態へ戻す」を選んだ場合に使う。
  // CharacterDrawer.newCharacter(name, typeId)が返す「まっさらな同職業角色」の中身で、
  // id／enteredだけを保持したまま完全上書きする（等級1・初期武器のみ・盧恩0・已習得盧恩
  // 效果／附加效果／護符／消耗品／骰子池／執行紀錄が全てクリアされる）。参照を保つため
  // 配列要素を差し替えず、既存オブジェクトをin-placeで書き換える。
  function resetCharacterToInitialState(c) {
    var fresh = CharacterDrawer.newCharacter(c.name, c.typeId);
    var id = c.id;
    var entered = c.entered;
    for (var key in c) {
      if (Object.prototype.hasOwnProperty.call(c, key)) delete c[key];
    }
    for (var freshKey in fresh) {
      if (Object.prototype.hasOwnProperty.call(fresh, freshKey)) c[freshKey] = fresh[freshKey];
    }
    c.id = id;
    c.entered = entered;
  }

```

- [ ] **Step 3: `handleNewGame`に角色重置確認を追加**

Task 2 Step 4で以下の形になっている`handleNewGame`：

```js
  function handleNewGame() {
    if (!checkNewGamePassword()) return;
    var hadBoard = state.boardStarted;
    resetState();
    renderBoard();
    renderLog();
    renderDicePool();
    renderActionPhaseButton();
    renderTurnHolderBar();
    renderTurnBoardToggleButton();
    renderActionPhaseGrid();
    renderLogFloatToggleButton();
    renderLogFloatingBubble();
    if (hadBoard) addLog("log_new_game");
    if (window.PriTestNightGmFlow) {
      window.PriTestNightGmFlow.maybeShowOpeningNarration();
      renderCurrentLocationStatus();
    }
  }
```

を

```js
  function handleNewGame() {
    if (!checkNewGamePassword()) return;
    var hadBoard = state.boardStarted;
    // 既に盤面があった場合（＝本当に「新しい」遊戲を始める場合）のみ、角色重置の要否を確認する。
    // まだ何も始まっていない盤面（hadBoard===false）に対して聞いても意味が無いため対象外。
    if (hadBoard && window.confirm(window.I18N.t("new_game_reset_characters_confirm"))) {
      rosterCharacters
        .filter(function (c) {
          return c.entered;
        })
        .forEach(resetCharacterToInitialState);
      saveRosterCharacters();
      renderCharacterRoster();
    }
    resetState();
    renderBoard();
    renderLog();
    renderDicePool();
    renderActionPhaseButton();
    renderTurnHolderBar();
    renderTurnBoardToggleButton();
    renderActionPhaseGrid();
    renderLogFloatToggleButton();
    renderLogFloatingBubble();
    if (hadBoard) addLog("log_new_game");
    if (window.PriTestNightGmFlow) {
      window.PriTestNightGmFlow.maybeShowOpeningNarration();
      renderCurrentLocationStatus();
    }
  }
```

へ置き換える。

- [ ] **Step 4: i18nキー追加**

`site_src/i18n_data_zh.py:21`の`"new_game_password_prompt": ...,`の直後に：

```python
    "new_game_reset_characters_confirm": "是否要將所有已入場角色的狀態一併重置為剛入場的狀態（等級1、初始配置、清空骰子池與執行紀錄）？",
```

`site_src/i18n_data_ja.py`の同キー直後に：

```python
    "new_game_reset_characters_confirm": "入場済みの角色の状態も、剛入場時（レベル1・初期配置、骰子池と執行紀錄も空）へ一緒にリセットしますか？",
```

`site_src/i18n_data_en.py`の同キー直後に：

```python
    "new_game_reset_characters_confirm": "Also reset all entered characters back to their just-entered state (level 1, starting loadout, cleared dice pool and action log)?",
```

- [ ] **Step 5: 構文チェックとビルド**

```bash
node --check static_src/night.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 6: Playwright動作確認（使い捨てスクリプト）**

ゲームを作成し、キャラクターを1体作成して`entered=true`、`level=5`、`runes=10`に手動で上げてから盤面を開始する（`boardStarted=true`）。`gmFlowEnabled`をtrueにしておく。その後：

```js
// 1. gmFlowEnabled/autoGmEnabledを両方trueにしてから新遊戲を実行し、維持されることを確認
window.PriTestNightCore.state.gmFlowEnabled = true;
window.PriTestNightCore.state.autoGmEnabled = true;
window.PriTestNightCore.saveState();
```

`page.on("dialog", ...)`で最初の`window.prompt`（密碼）に`"night"`、次の`window.confirm`（角色重置確認）に`accept()`を返すよう設定してから、主選單→設定→［新遊戲］をクリックする。実行後：

```js
var Core = window.PriTestNightCore;
console.log("gmFlowEnabled:", Core.state.gmFlowEnabled); // 期待値: true（維持）
console.log("autoGmEnabled:", Core.state.autoGmEnabled); // 期待値: true（維持）
var c = Core.getRosterCharacters()[0];
console.log("level:", c.level, "runes:", c.runes); // 期待値: level:1, runes:0
```

Expected: `gmFlowEnabled`/`autoGmEnabled`は変化せず、角色の`level`は1、`runes`は0に戻る。

- [ ] **Step 7: Commit**

```bash
git add static_src/night.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(night): 新遊戲で自動GM設定を維持、角色を剛入場状態へ戻す確認を追加"
```

---

### Task 4: 戰鬥觸發前の敵情報プレビュー（設計書§E）

**Files:**
- Modify: `static_src/night_gm_flow.js:1035`付近（`buildCombatEnemyPreviewText`新設）
- Modify: `static_src/night_gm_flow.js:2027-2032`（`advanceFieldWalk`の`combatTriggerIndex`分岐）

**Interfaces:**
- Consumes: `collectCombatEnemyLines`、`parseCombatEnemyRef`、`resolveCombatEnemyMatch`、`fieldLevelCorrectionForSlot`（すべて既存、`night_gm_flow.js`同一クロージャ内）。

- [ ] **Step 1: `buildCombatEnemyPreviewText`を新設**

`static_src/night_gm_flow.js:1035`の`resolveCombatEnemyMatch`関数の閉じ`}`の直後（`resolveAndAddCombatEnemies`定義の前）に以下を追加する：

```js
  // 自動化GM 戰鬥自動化：ユーザー指定、［雜兵戰鬥］/［王戰］ボタンを押す前（actionKind===
  // "combatTrigger"の間）に、遭遇する敵の名稱・等級・種族・尺寸・HPを進度版へ先出しする。
  // resolveAndAddCombatEnemiesと違いstate.battleを一切変更しない「読み取り専用」の
  // プレビューで、buildEncounterSummaryText（night.js、戦闘開始後の表示）と同じ項目のみ
  // 出す（防禦次數・HP價值はどちらの関数も元々出力していない）。
  function buildCombatEnemyPreviewText(lines, triggerIndex, slotIndex) {
    var Enemies = window.PriTestEnemies;
    if (!Enemies) return "";
    var collected = collectCombatEnemyLines(lines, triggerIndex);
    var levelBonus = fieldLevelCorrectionForSlot(slotIndex);
    var out = [];
    collected.enemyLines.forEach(function (line) {
      var ref = parseCombatEnemyRef(line);
      ref.nameTokens.forEach(function (token) {
        var match = resolveCombatEnemyMatch(token);
        if (!match) return;
        var level = Math.max(1, (ref.level || 1) + (ref.needsLevelCorrection && levelBonus ? levelBonus : 0));
        var lvRow = (match.familyBase || []).filter(function (lv) {
          return lv.level === level;
        })[0];
        var parts = [
          Enemies.localizedText(match.enemy.name),
          window.I18N.t("enemy_level_label") + window.I18N.t("colon_separator") + level,
          Enemies.localizedText(match.familyName),
          match.enemy.size || "-",
        ];
        if (lvRow && lvRow.hp) {
          parts.push(window.I18N.t("enemy_hp_label") + window.I18N.t("colon_separator") + lvRow.hp);
        }
        out.push(parts.join("　"));
      });
    });
    return out.join("\n");
  }

```

- [ ] **Step 2: `advanceFieldWalk`のcombatTrigger分岐でプレビューを敘述へ追加**

`static_src/night_gm_flow.js:2027-2032`の

```js
    if (combatTriggerIndex !== -1) {
      state.gmFlow.narrationText = blockText;
      state.gmFlow.pendingChoiceLabels = [];
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "combatTrigger";
      state.gmFlow.combatTriggerLabel = combatTriggerTitle(lines[combatTriggerIndex]);
```

を

```js
    if (combatTriggerIndex !== -1) {
      var enemyPreview = buildCombatEnemyPreviewText(lines, combatTriggerIndex, walk.slotIndex);
      state.gmFlow.narrationText = enemyPreview ? blockText + "\n" + enemyPreview : blockText;
      state.gmFlow.pendingChoiceLabels = [];
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "combatTrigger";
      state.gmFlow.combatTriggerLabel = combatTriggerTitle(lines[combatTriggerIndex]);
```

へ置き換える。

- [ ] **Step 3: 構文チェックとビルド**

```bash
node --check static_src/night_gm_flow.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 4: Playwright動作確認（使い捨てスクリプト）**

`tricephalos`劇本でゲームを作成、キャラクター1体を入場させ`gmFlowEnabled=true`にして劇本模式で開始。起點（`a_start`、`startSuit="♥"`で「小野営地の君主軍」分岐）まで進め、［雜兵戰鬥］ボタンが表示された時点（クリック**前**）で：

```js
var Core = window.PriTestNightCore;
console.log("actionKind:", Core.state.gmFlow.actionKind); // 期待値: "combatTrigger"
console.log("narration includes HP:", Core.state.gmFlow.narrationText.indexOf("HP量") !== -1); // 期待値: true
console.log("battle.selectedEnemyIds still empty:", (Core.state.battle.selectedEnemyIds || []).length === 0); // 期待値: true（まだ戦場へ追加していない）
```

Expected: ボタンを押す前から敵の名稱・等級・HP量が敘述に含まれ、かつ`state.battle`はまだ変更されていない。

- [ ] **Step 5: Commit**

```bash
git add static_src/night_gm_flow.js
git commit -m "feat(night): 戰鬥觸發ボタンを押す前に遭遇する敵情報のプレビューを敘述へ追加"
```

---

### Task 5: 樓層獎勵領取フロー ①ボタン名・閃紅字の動的化（設計書§F-1,2）

**Files:**
- Modify: `static_src/night_gm_flow.js:3759`付近（`renderLocationBanner`の`waitingBadge`描画）
- Modify: `site_src/i18n_data_zh.py`/`_ja.py`/`_en.py`（`gm_flow_reward_done_button`の値変更、新規`gm_flow_waiting_badge_claim_reward`/`gm_flow_waiting_badge_reward_pending`追加）

**Interfaces:**
- Consumes: `state.gmFlow.actionKind`、`state.gmFlow.pendingRewardWindows`（Task 6で実際に使われ始めるが、このタスクの時点では常に空配列のため「領取獎勵！」のみ表示される——Task 6完了後に「等待領取完」も実際に出るようになる）。

- [ ] **Step 1: `waitingBadge`のテキストを動的化**

`static_src/night_gm_flow.js:3755-3759`の

```js
    maybeAnnounceFinalDay(); // stateを直接書き換えるだけ（自身はrenderを呼ばない、再帰防止）
    dialogueEl.classList.add("has-dialogue");
    actionsEl.innerHTML = "";
    // [GM等待中]バッジ：折りたたみ時も見えるようにoverlay直下に置いているため、collapsedの
    // 状態に関わらずawaitingOk中は常に点滅させる（＝GMが進度版を開いて対応する必要がある合図）。
    if (waitingBadge) waitingBadge.hidden = !state.gmFlow.awaitingOk;
```

を

```js
    maybeAnnounceFinalDay(); // stateを直接書き換えるだけ（自身はrenderを呼ばない、再帰防止）
    dialogueEl.classList.add("has-dialogue");
    actionsEl.innerHTML = "";
    // [GM等待中]バッジ：折りたたみ時も見えるようにoverlay直下に置いているため、collapsedの
    // 状態に関わらずawaitingOk中は常に点滅させる（＝GMが進度版を開いて対応する必要がある合図）。
    // ユーザー指定：actionKind==="floorEnd"の間は文言を状況に応じて差し替える
    // （未クリック＝「領取獎勵！」、クリック後まだ獎勵清單／樓層獎勵モーダルが未解決＝
    // 「等待領取完」。pendingRewardWindowsへの実際の登録はTask 6で行う）。
    if (waitingBadge) {
      waitingBadge.hidden = !state.gmFlow.awaitingOk;
      if (state.gmFlow.awaitingOk) {
        var badgeKey = "gm_flow_waiting_badge";
        if (state.gmFlow.actionKind === "floorEnd") {
          badgeKey = state.gmFlow.pendingRewardWindows.length > 0 ? "gm_flow_waiting_badge_reward_pending" : "gm_flow_waiting_badge_claim_reward";
        }
        waitingBadge.textContent = window.I18N.t(badgeKey);
      }
    }
```

へ置き換える。

- [ ] **Step 2: i18nキー変更・追加**

`site_src/i18n_data_zh.py:246`の

```python
    "gm_flow_reward_done_button": "獲得完",
```

を

```python
    "gm_flow_reward_done_button": "領取完",
```

へ置き換え、`site_src/i18n_data_zh.py:210`の`"gm_flow_waiting_badge": "GM等待中",`の直後に：

```python
    "gm_flow_waiting_badge_claim_reward": "領取獎勵！",
    "gm_flow_waiting_badge_reward_pending": "等待領取完",
```

`site_src/i18n_data_ja.py:246`の

```python
    "gm_flow_reward_done_button": "受け取り完了",
```

を

```python
    "gm_flow_reward_done_button": "領取完了",
```

へ置き換え、`site_src/i18n_data_ja.py:210`の同キー直後に：

```python
    "gm_flow_waiting_badge_claim_reward": "獎勵を受け取ってください！",
    "gm_flow_waiting_badge_reward_pending": "受け取り完了待ち",
```

`site_src/i18n_data_en.py:246`の

```python
    "gm_flow_reward_done_button": "Done Claiming",
```

を

```python
    "gm_flow_reward_done_button": "Claim Complete",
```

へ置き換え、`site_src/i18n_data_en.py:210`の同キー直後に：

```python
    "gm_flow_waiting_badge_claim_reward": "Claim Reward!",
    "gm_flow_waiting_badge_reward_pending": "Awaiting Claim",
```

- [ ] **Step 3: 構文チェックとビルド**

```bash
node --check static_src/night_gm_flow.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 4: Playwright動作確認（使い捨てスクリプト）**

戦闘勝利後にactionKind==="floorEnd"になった直後、`#gm-flow-waiting-badge`のテキストが「領取獎勵！」（zh）であることを確認する：

```js
console.log(document.getElementById("gm-flow-waiting-badge").textContent); // 期待値: "領取獎勵！"
console.log(document.querySelector("#location-status-actions button:nth-child(2)").textContent); // 期待値: "領取完"
```

- [ ] **Step 5: Commit**

```bash
git add static_src/night_gm_flow.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(night): 獎勵領取ボタン名を「領取完」に変更、閃紅字を状況に応じて動的化"
```

---

### Task 6: 樓層獎勵領取フロー ②非自動進行化＋pendingRewardWindows連動（設計書§F-3,4）

**Files:**
- Modify: `static_src/night_floor_breakthrough.js:75-105`（`openFloorRewardModal`、戻り値を追加）
- Modify: `static_src/night_gm_flow.js:2373-2380`（`handleFloorEndRewardClick`）
- Modify: `static_src/night.js:12078`付近（`window.PriTestNightCore`エクスポートに`openTurnRewardModal`追加）
- Modify: `site_src/i18n_data_zh.py`/`_ja.py`/`_en.py`（`gm_flow_reward_wait_narration`追加）

**Interfaces:**
- Consumes: Task 5で導入した`pendingRewardWindows`連動のバッジ表示。既存`Core.addPendingRewardWindow(id)`/`Core.openTurnRewardModal()`（後者はこのタスクでエクスポート追加）。
- Produces: `openFloorRewardModal(floor)`の戻り値`{lootPushed: boolean, judgmentModalOpened: boolean}`——`night_rulebook.js`の既存呼び出し（`static_src/night_rulebook.js:608`）は戻り値を使っていないため無変更で動作する。

- [ ] **Step 1: `openFloorRewardModal`が戻り値を返すようにする**

`static_src/night_floor_breakthrough.js:75-105`の

```js
  function openFloorRewardModal(floor) {
    var Core = window.PriTestNightCore;
    var entered = Core.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    var lootObjs = floorAutoLootTurnRewards(floor, entered);
    // 規則書ブラウズ経由（night_rulebook.jsの「獲得」ボタン）で呼ばれた場合、戦利品だけの
    // フロアはこの下で早期returnするため、規則書を閉じたままにするとGM側に何も残らない
    // （行動ログしか手掛かりが無い）。閉じる前の表示状態を控えておき、早期return時だけ戻す。
    var rulebookModal = document.getElementById("rulebook-modal");
    var rulebookWasVisible = !!(rulebookModal && !rulebookModal.hidden);
    if (rulebookModal) rulebookModal.hidden = true;
    if (lootObjs.length) {
      Core.pushTurnRewards(lootObjs);
      window.PriTestNightLog("log_floor_reward_auto_pushed", {
        items: lootObjs
          .map(function (r) {
            return window.I18N.t("turn_reward_kind_" + r.kind);
          })
          .join("、"),
      });
    }
    if (!floorHasJudgmentReward(floor)) {
      if (rulebookWasVisible && rulebookModal) rulebookModal.hidden = false;
      return;
    }
    floorRewardModalFloor = floor;
    document.getElementById("floor-reward-modal").hidden = false;
    document.getElementById("btn-floor-reward-restore").hidden = true;
    renderFloorRewardSection(document.getElementById("floor-reward-modal-content"), floor);
  }
```

を

```js
  function openFloorRewardModal(floor) {
    var Core = window.PriTestNightCore;
    var entered = Core.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    var lootObjs = floorAutoLootTurnRewards(floor, entered);
    // 規則書ブラウズ経由（night_rulebook.jsの「獲得」ボタン）で呼ばれた場合、戦利品だけの
    // フロアはこの下で早期returnするため、規則書を閉じたままにするとGM側に何も残らない
    // （行動ログしか手掛かりが無い）。閉じる前の表示状態を控えておき、早期return時だけ戻す。
    var rulebookModal = document.getElementById("rulebook-modal");
    var rulebookWasVisible = !!(rulebookModal && !rulebookModal.hidden);
    if (rulebookModal) rulebookModal.hidden = true;
    if (lootObjs.length) {
      Core.pushTurnRewards(lootObjs);
      window.PriTestNightLog("log_floor_reward_auto_pushed", {
        items: lootObjs
          .map(function (r) {
            return window.I18N.t("turn_reward_kind_" + r.kind);
          })
          .join("、"),
      });
    }
    // 呼び出し元（night_gm_flow.jsのhandleFloorEndRewardClick）が「獎勵清單を開くべきか」
    // 「樓層獎勵ゲート（pendingRewardWindows）を追跡すべきか」を判定できるよう、何が
    // 起きたかを返す。night_rulebook.jsの既存呼び出しは戻り値を使わないため無変更で動く。
    var hasJudgment = floorHasJudgmentReward(floor);
    if (!hasJudgment) {
      if (rulebookWasVisible && rulebookModal) rulebookModal.hidden = false;
      return { lootPushed: lootObjs.length > 0, judgmentModalOpened: false };
    }
    floorRewardModalFloor = floor;
    document.getElementById("floor-reward-modal").hidden = false;
    document.getElementById("btn-floor-reward-restore").hidden = true;
    renderFloorRewardSection(document.getElementById("floor-reward-modal-content"), floor);
    return { lootPushed: lootObjs.length > 0, judgmentModalOpened: true };
  }
```

へ置き換える。

- [ ] **Step 2: `window.PriTestNightCore`エクスポートに`openTurnRewardModal`を追加**

`static_src/night.js:12078`の

```js
    addPendingRewardWindow: addPendingRewardWindow,
```

の直後に以下を追加する：

```js
    openTurnRewardModal: openTurnRewardModal,
```

- [ ] **Step 3: `handleFloorEndRewardClick`を非自動進行化**

`static_src/night_gm_flow.js:2373-2380`の

```js
  function handleFloorEndRewardClick() {
    var Core = window.PriTestNightCore;
    var floor = pendingFloorEndFloor || resolveFloorFromPendingRef(Core.state.gmFlow.pendingFloorEndRef);
    if (floor) window.PriTestNightFloorBreakthrough.openFloorRewardModal(floor);
    closeGmFlowGateAndConsumePendingAdvance();
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }
```

を

```js
  function handleFloorEndRewardClick() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var floor = pendingFloorEndFloor || resolveFloorFromPendingRef(state.gmFlow.pendingFloorEndRef);
    var result = floor ? window.PriTestNightFloorBreakthrough.openFloorRewardModal(floor) : null;
    if (!result || (!result.lootPushed && !result.judgmentModalOpened)) {
      // フロアが解決できなかった、または戦利品もGM判断項目も無かった（finishFieldWalkが
      // floorEndへ遷移する時点でどちらか必ずある想定だが、念のための安全側フォールバック）。
      // 従来通り即座にゲートを閉じて次へ進める。
      closeGmFlowGateAndConsumePendingAdvance();
      Core.saveState();
      Core.renderCurrentLocationStatus();
      return;
    }
    // ユーザー指定：戦利品／GM判断項目のいずれかが実際にモーダルとして開いた場合、
    // ここではゲートを閉じない。獎勵清單・樓層獎勵モーダルの両方が閉じ終わる
    // （＝pendingRewardWindowsが空になる）まで、進度版の敘述は「等待玩家領取完畢」の
    // まま待機し、[領取完]（handleGmFlowOk）が既存のpendingRewardWindowsガードで
    // リマインドを繰り返す。
    if (result.judgmentModalOpened) Core.addPendingRewardWindow("floorReward");
    if (result.lootPushed) {
      Core.openTurnRewardModal();
      Core.addPendingRewardWindow("turnReward");
    }
    state.gmFlow.narrationText = (state.gmFlow.narrationText || "") + "\n" + window.I18N.t("gm_flow_reward_wait_narration");
    lastTypedNarration = null; // 追加した行を含めて必ず打字機を再生する
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }
```

へ置き換える。

- [ ] **Step 4: i18nキー追加**

`site_src/i18n_data_zh.py`の`"gm_flow_reward_done_button": "領取完",`の直後（`gm_flow_`系キーが並ぶ箇所）に：

```python
    "gm_flow_reward_wait_narration": "GM：等待玩家領取完畢。",
```

`site_src/i18n_data_ja.py`の同キー直後に：

```python
    "gm_flow_reward_wait_narration": "GM：プレイヤーが受け取り終えるのを待っています。",
```

`site_src/i18n_data_en.py`の同キー直後に：

```python
    "gm_flow_reward_wait_narration": "GM: Waiting for players to finish claiming.",
```

- [ ] **Step 5: 構文チェックとビルド**

```bash
node --check static_src/night_floor_breakthrough.js
node --check static_src/night_gm_flow.js
node --check static_src/night.js
py -3 generate.py
```

Expected: すべてエラーなく終了する。

- [ ] **Step 6: Playwright動作確認（使い捨てスクリプト）**

`a_start`（戦利品のみ＝武器★2つ+盧恩1、GM判断項目なし）で雜兵戰鬥を撃破し、［領取獎勵］を押した直後：

```js
var Core = window.PriTestNightCore;
console.log("actionKind still floorEnd:", Core.state.gmFlow.actionKind); // 期待値: "floorEnd"（自動で進んでいない）
console.log("turn-reward-modal hidden:", document.getElementById("turn-reward-modal").hidden); // 期待値: false（自動で開いた）
console.log("pendingRewardWindows:", Core.state.gmFlow.pendingRewardWindows); // 期待値: ["turnReward"]
```

続けて［領取完］を数回押しても`actionKind`が変わらないこと（進まないこと）を確認し、その後、獎勵清單内の全項目を「獲得」してから`#btn-turn-reward-modal-close`を押し、再度［領取完］を押すと今度は次のゲート（全踏破敘述）へ進むことを確認する：

```js
document.getElementById("btn-turn-reward-modal-close").click();
console.log("pendingRewardWindows after close:", Core.state.gmFlow.pendingRewardWindows); // 期待値: []
// [領取完]をクリック後
console.log("actionKind after 領取完:", Core.state.gmFlow.actionKind); // 期待値: "ok"（全踏破敘述ゲートへ進んだ）
```

- [ ] **Step 7: Commit**

```bash
git add static_src/night_floor_breakthrough.js static_src/night_gm_flow.js static_src/night.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(night): 樓層獎勵の領取完了を待ってからゲートを進めるよう変更、獎勵清單を自動で開く"
```

---

### Task 7: 獎勵清單「新增」を規則書認證者限定に（設計書§F-5）

**Files:**
- Modify: `static_src/night.js:9001-9013`（`renderTurnRewardAddForm`）

**Interfaces:**
- Consumes: 既存`isRulebookAuthenticated()`（`static_src/night.js:2592`、同一クロージャ内で直接呼べる）。

- [ ] **Step 1: 新增コントロールの活性条件に規則書認證を追加**

`static_src/night.js:9001-9013`の

```js
    var isGmTurn = state.turnHolder === "gm";
    var valueInput = document.getElementById("turn-reward-value-input");
    var addBtn = document.getElementById("btn-turn-reward-add");
    kindSelect.disabled = !isGmTurn;
    targetSelect.disabled = !isGmTurn;
    if (valueInput) {
      valueInput.hidden = kindSelect.value === "buriedTreasure";
      valueInput.disabled = !isGmTurn;
    }
    if (addBtn) {
      addBtn.textContent = window.I18N.t(kindSelect.value === "buriedTreasure" ? "turn_reward_roll_buried_treasure_button" : "turn_reward_add_button");
      addBtn.disabled = !isGmTurn;
    }
```

を

```js
    // ユーザー指定：獎勵清單への手動「新增」は、GM回合中であることに加えて規則書パスワード
    // 認証済み（isRulebookAuthenticated）のユーザーのみ操作可能にする。既存項目の獲得／削除
    // ボタンはこの制限の対象外（renderTurnRewardModal側、誰でも操作可のまま）。
    var canManageTurnRewards = state.turnHolder === "gm" && isRulebookAuthenticated();
    var valueInput = document.getElementById("turn-reward-value-input");
    var addBtn = document.getElementById("btn-turn-reward-add");
    kindSelect.disabled = !canManageTurnRewards;
    targetSelect.disabled = !canManageTurnRewards;
    if (valueInput) {
      valueInput.hidden = kindSelect.value === "buriedTreasure";
      valueInput.disabled = !canManageTurnRewards;
    }
    if (addBtn) {
      addBtn.textContent = window.I18N.t(kindSelect.value === "buriedTreasure" ? "turn_reward_roll_buried_treasure_button" : "turn_reward_add_button");
      addBtn.disabled = !canManageTurnRewards;
    }
```

へ置き換える。

- [ ] **Step 2: 構文チェックとビルド**

```bash
node --check static_src/night.js
py -3 generate.py
```

Expected: エラーなく終了する。

- [ ] **Step 3: Playwright動作確認（使い捨てスクリプト）**

`state.turnHolder = "gm"`のまま、規則書パスワードを未認証の状態で獎勵清單を開き、`#btn-turn-reward-add`が`disabled`であることを確認する。次に`window.PriTestNightCore.checkRulebookPassword`相当（`sessionStorage`へ直接認証フラグを立てる—`static_src/night.js`の`RULEBOOK_SESSION_KEY`定数を使う）で認証済み状態にしてから再描画し、`disabled`が解除されることを確認する：

```js
console.log("add button disabled (before auth):", document.getElementById("btn-turn-reward-add").disabled); // 期待値: true
sessionStorage.setItem("pritest-rulebook-session", "1"); // RULEBOOK_SESSION_KEY（static_src/night.js:27）の実際の値
window.PriTestNightCore.openTurnRewardModal();
console.log("add button disabled (after auth):", document.getElementById("btn-turn-reward-add").disabled); // 期待値: false
```

Expected: 認証前は`disabled:true`、認証後は`disabled:false`。

- [ ] **Step 4: Commit**

```bash
git add static_src/night.js
git commit -m "feat(night): 獎勵清單の新增操作を規則書認證済みユーザー限定に変更"
```

---

### Task 8: 獎勵清單の跨端末自動ポップアップ（設計書§F-6）

**Files:**
- Modify: `static_src/night.js:922`（初期state、`activeDraws`に`turnRewardAutoOpen`追加）
- Modify: `static_src/night.js:2171-2176`（`loadState`migrationの`activeDraws`復元）
- Modify: `static_src/night.js:2272`（`resetState`の`activeDraws`初期化）
- Modify: `static_src/night.js:8898-8929`（`closeTurnRewardModal`、フラグクリア追加）
- Modify: `static_src/night.js:12205`付近（`subscribeNightState`コールバック、他端末での自動オープン追加）
- Modify: `static_src/night_gm_flow.js:2373`付近（`handleFloorEndRewardClick`、フラグセット追加、Task 6で変更した箇所へ追記）

**Interfaces:**
- Consumes: 既存の`state.activeDraws`＋`GameStorage.subscribeNightState`跨端末同期パターン（`potentialPower`と同じ仕組み）。`storageMode !== "cloud"`の場合、`subscribeNightState`自体がno-opのため、この機能はcloud模式でのみ意味を持つ（設計書の対象外事項どおり）。

- [ ] **Step 1: `activeDraws`の3箇所すべてに`turnRewardAutoOpen`を追加**

`static_src/night.js:922`の

```js
    activeDraws: { potentialPower: null, weapon: null, talisman: null, consumable: null },
```

を

```js
    activeDraws: { potentialPower: null, weapon: null, talisman: null, consumable: null, turnRewardAutoOpen: null },
```

へ置き換える。

`static_src/night.js:2171-2176`の

```js
      state.activeDraws = {
        potentialPower: loadedDraws.potentialPower || null,
        weapon: loadedDraws.weapon || null,
        talisman: loadedDraws.talisman || null,
        consumable: loadedDraws.consumable || null,
      };
```

を

```js
      state.activeDraws = {
        potentialPower: loadedDraws.potentialPower || null,
        weapon: loadedDraws.weapon || null,
        talisman: loadedDraws.talisman || null,
        consumable: loadedDraws.consumable || null,
        turnRewardAutoOpen: !!loadedDraws.turnRewardAutoOpen,
      };
```

へ置き換える。

`static_src/night.js:2272`の

```js
    state.activeDraws = { potentialPower: null, weapon: null, talisman: null, consumable: null };
```

を

```js
    state.activeDraws = { potentialPower: null, weapon: null, talisman: null, consumable: null, turnRewardAutoOpen: null };
```

へ置き換える。

- [ ] **Step 2: `closeTurnRewardModal`でフラグをクリア**

`static_src/night.js:8926-8929`の

```js
    modal.hidden = true;
    document.getElementById("btn-turn-reward-restore").hidden = true;
    removePendingRewardWindow("turnReward");
  }
```

を

```js
    modal.hidden = true;
    document.getElementById("btn-turn-reward-restore").hidden = true;
    // 跨端末自動ポップアップ（Task 8）の予約フラグも、実際に閉じられた時点でクリアする
    // （removePendingRewardWindowが内部でsaveState()する——別途saveState呼び出しは不要）。
    state.activeDraws.turnRewardAutoOpen = null;
    removePendingRewardWindow("turnReward");
  }
```

へ置き換える。

- [ ] **Step 3: `subscribeNightState`コールバックで他端末にも自動オープンさせる**

`static_src/night.js:12205`の

```js
        if (!document.getElementById("turn-reward-modal").hidden) renderTurnRewardModal();
```

を

```js
        if (!document.getElementById("turn-reward-modal").hidden) renderTurnRewardModal();
        // Task 8：戦利品自動push起因でstate.activeDraws.turnRewardAutoOpenが立っている間は、
        // まだこの端末でモーダルを開いていなければ自動で開く（potentialPowerの跨端末復元と
        // 同じパターン）。主選單から手動で開いた既存の挙動はこのフラグに依存しないため影響なし。
        if (state.activeDraws.turnRewardAutoOpen && document.getElementById("turn-reward-modal").hidden) {
          openTurnRewardModal();
        }
```

へ置き換える。

- [ ] **Step 4: `handleFloorEndRewardClick`でフラグをセット**

`static_src/night_gm_flow.js`のTask 6で変更した`handleFloorEndRewardClick`内、

```js
    if (result.lootPushed) {
      Core.openTurnRewardModal();
      Core.addPendingRewardWindow("turnReward");
    }
```

を

```js
    if (result.lootPushed) {
      Core.state.activeDraws.turnRewardAutoOpen = true;
      Core.openTurnRewardModal();
      Core.addPendingRewardWindow("turnReward");
    }
```

へ置き換える（この直後に既存の`Core.saveState()`が呼ばれるため、追加の保存呼び出しは不要）。

- [ ] **Step 5: 構文チェックとビルド**

```bash
node --check static_src/night.js
node --check static_src/night_gm_flow.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 6: Playwright動作確認（使い捨てスクリプト、2ページで検証）**

`storageMode:"cloud"`でゲームを作成する必要があるため、Firebase設定が有効な環境でのみ実行可能——ローカル環境でFirebase未設定の場合はこのステップをスキップし、代わりに以下の同一ページ内シミュレーションで確認する：

```js
// ページA相当の操作後を模した状態を直接作り、subscribeNightStateコールバックと同じ
// ロジックを手動で再現して検証する（cloud環境が無い場合の代替確認）。
var Core = window.PriTestNightCore;
Core.state.activeDraws.turnRewardAutoOpen = true;
document.getElementById("turn-reward-modal").hidden = true; // ページBではまだ閉じている想定
// subscribeNightStateコールバック内の新規ロジックと同じ条件分岐を手動実行
if (Core.state.activeDraws.turnRewardAutoOpen && document.getElementById("turn-reward-modal").hidden) {
  Core.openTurnRewardModal();
}
console.log("modal opened:", !document.getElementById("turn-reward-modal").hidden); // 期待値: true
```

cloud環境が利用可能な場合は、2つのPlaywrightページ（同じgameIdでcloud模式のゲームを開く）で、ページAが戦利品を撃破→［領取獎勵］を押した後、ページB側で`turn-reward-modal`が自動的に`hidden:false`になることを確認する。

- [ ] **Step 7: Commit**

```bash
git add static_src/night.js static_src/night_gm_flow.js
git commit -m "feat(night): 樓層戰利品の獎勵清單自動push時、cloud模式で他端末にもモーダルを自動ポップアップ"
```

---

### Task 9: 自動化GM紀錄への決定點記録（設計書§D、決定點部分）

**Files:**
- Modify: `static_src/night_gm_flow.js`（`state.turnMessages.push({text, time, side:"gm"})`パターンの全19箇所を`logGmDecision(text)`経由に統一）

**Interfaces:**
- Produces: `logGmDecision(text)`（`night_gm_flow.js`内の新規非公開ヘルパー）。

- [ ] **Step 1: `logGmDecision`ヘルパーを新設**

`static_src/night_gm_flow.js:100`の`typewriteAppend`関数の閉じ`}`の直後（`// ---- 夜の王〔開場〕の取得（第11項） ----`という見出しコメントの直前）に以下を追加する：

```js
  // ユーザー指定：進度版の選択判断・行為判定結果等（GM留言板state.turnMessagesへ記録される
  // 内容と同一）を、紀錄ドロワーの「自動化GM紀錄」タブ（state.autoGmLog、night.jsの
  // window.PriTestNightAddAutoGmLogフック）へも並行して記録する。単純な[進入]/[OK]等の
  // ページ送りボタンはこの経路を通らないため対象外のまま（turnMessagesへ積まれる内容＝
  // 「実際に何か決まった」瞬間のみが対象になる）。
  function logGmDecision(text) {
    var Core = window.PriTestNightCore;
    Core.state.turnMessages.push({ text: text, time: Date.now(), side: "gm" });
    if (window.PriTestNightAddAutoGmLog) window.PriTestNightAddAutoGmLog(text);
  }

```

- [ ] **Step 2: 19箇所の`state.turnMessages.push({...side:"gm"})`を`logGmDecision(...)`へ置き換える**

以下19箇所それぞれについて、現在の内容（左）を置き換え後の内容（右）へ変更する。`logGmDecision`は内部で`window.PriTestNightCore`を取得するため、呼び出し元に`Core`/`state`変数が無い箇所でもそのまま呼べる。

**2-1. `:1639-1647`（分岐ロール2回目）**

```js
        state.turnMessages.push({
          text: window.I18N.t("gm_flow_branch_roll2_log", {
            roll1: resolved.roll,
            roll2: resolved.roll2,
            name: window.PriTestFields.localizedText(entry.branches[resolved.branchIndex].name),
          }),
          time: Date.now(),
          side: "gm",
        });
```

```js
        logGmDecision(
          window.I18N.t("gm_flow_branch_roll2_log", {
            roll1: resolved.roll,
            roll2: resolved.roll2,
            name: window.PriTestFields.localizedText(entry.branches[resolved.branchIndex].name),
          })
        );
```

**2-2. `:1649-1657`（分岐ロール1回目）**

```js
        state.turnMessages.push({
          text: window.I18N.t("gm_flow_branch_roll_log", {
            roll: resolved.roll,
            name: window.PriTestFields.localizedText(entry.branches[resolved.branchIndex].name),
          }),
          time: Date.now(),
          side: "gm",
        });
```

```js
        logGmDecision(
          window.I18N.t("gm_flow_branch_roll_log", {
            roll: resolved.roll,
            name: window.PriTestFields.localizedText(entry.branches[resolved.branchIndex].name),
          })
        );
```

**2-3. `:2125`（`(→X)`選択決定）**

```js
    state.turnMessages.push({ text: window.I18N.t("gm_flow_choice_picked_log", { label: label }), time: Date.now(), side: "gm" });
```

```js
    logGmDecision(window.I18N.t("gm_flow_choice_picked_log", { label: label }));
```

**2-4. `:2162-2166`（ダイス表ロール）**

```js
    window.PriTestNightCore.state.turnMessages.push({
      text: window.I18N.t("gm_flow_dice_table_roll_log", { roll: roll, name: matched.name }),
      time: Date.now(),
      side: "gm",
    });
```

```js
    logGmDecision(window.I18N.t("gm_flow_dice_table_roll_log", { roll: roll, name: matched.name }));
```

**2-5. `:2212-2216`（戦闘追加ログ）**

```js
      state.turnMessages.push({
        text: window.I18N.t("gm_flow_combat_added_log", { names: addedNames.join("、") }),
        time: Date.now(),
        side: "gm",
      });
```

```js
      logGmDecision(window.I18N.t("gm_flow_combat_added_log", { names: addedNames.join("、") }));
```

**2-6. `:2219`（戦闘追加時のリマインダー）**

```js
      state.turnMessages.push({ text: text, time: Date.now(), side: "gm" });
```

```js
      logGmDecision(text);
```

**2-7. `:2788-2796`（行為判定結果サマリ）**

```js
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_ability_check_summary_log", {
        target: spec.target,
        stat: window.I18N.t("check_stat_" + spec.statKey),
        results: entries.join("、"),
      }),
      time: Date.now(),
      side: "gm",
    });
```

```js
    logGmDecision(
      window.I18N.t("gm_flow_ability_check_summary_log", {
        target: spec.target,
        stat: window.I18N.t("check_stat_" + spec.statKey),
        results: entries.join("、"),
      })
    );
```

**2-8. `:2798-2802`（行為判定失敗リマインダー、1箇所目）**

```js
      state.turnMessages.push({
        text: window.I18N.t("gm_flow_ability_check_fail_reminder_log", { names: failedNames.join("、") }),
        time: Date.now(),
        side: "gm",
      });
```

```js
      logGmDecision(window.I18N.t("gm_flow_ability_check_fail_reminder_log", { names: failedNames.join("、") }));
```

**2-9. `:2871-2875`（多屬性判定サマリ）**

```js
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_multi_stat_check_summary_log", { results: entries.join("、") }),
      time: Date.now(),
      side: "gm",
    });
```

```js
    logGmDecision(window.I18N.t("gm_flow_multi_stat_check_summary_log", { results: entries.join("、") }));
```

**2-10. `:3062-3069`（協力判定サマリ、1箇所目）**

```js
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_cooperative_check_summary_log", {
        sum: poolSum,
        outcome: window.I18N.t(passed ? "ability_check_pass_label" : "ability_check_fail_label"),
      }),
      time: Date.now(),
      side: "gm",
    });
```

```js
    logGmDecision(
      window.I18N.t("gm_flow_cooperative_check_summary_log", {
        sum: poolSum,
        outcome: window.I18N.t(passed ? "ability_check_pass_label" : "ability_check_fail_label"),
      })
    );
```

**2-11. `:3136-3143`（協力判定サマリ、2箇所目——2-10と同じ`text`式だが呼び出し箇所が別関数）**

```js
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_cooperative_check_summary_log", {
        sum: poolSum,
        outcome: window.I18N.t(passed ? "ability_check_pass_label" : "ability_check_fail_label"),
      }),
      time: Date.now(),
      side: "gm",
    });
```

```js
    logGmDecision(
      window.I18N.t("gm_flow_cooperative_check_summary_log", {
        sum: poolSum,
        outcome: window.I18N.t(passed ? "ability_check_pass_label" : "ability_check_fail_label"),
      })
    );
```

**2-12. `:3267-3276`（単人指定判定結果、1箇所目）**

```js
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_player_pick_check_result_log", {
        name: c.name,
        dice: dice.join("+"),
        sum: sum,
        outcome: window.I18N.t(passed ? "ability_check_pass_label" : "ability_check_fail_label"),
      }),
      time: Date.now(),
      side: "gm",
    });
```

```js
    logGmDecision(
      window.I18N.t("gm_flow_player_pick_check_result_log", {
        name: c.name,
        dice: dice.join("+"),
        sum: sum,
        outcome: window.I18N.t(passed ? "ability_check_pass_label" : "ability_check_fail_label"),
      })
    );
```

**2-13. `:3365-3369`（代表者判定サマリ）**

```js
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_representative_pick_summary_log", { results: entries.join("、") }),
      time: Date.now(),
      side: "gm",
    });
```

```js
    logGmDecision(window.I18N.t("gm_flow_representative_pick_summary_log", { results: entries.join("、") }));
```

**2-14. `:3379-3383`（行為判定失敗リマインダー、2箇所目——2-8と同じ`text`式だが呼び出し箇所が別関数）**

```js
      state.turnMessages.push({
        text: window.I18N.t("gm_flow_ability_check_fail_reminder_log", { names: failedNames.join("、") }),
        time: Date.now(),
        side: "gm",
      });
```

```js
      logGmDecision(window.I18N.t("gm_flow_ability_check_fail_reminder_log", { names: failedNames.join("、") }));
```

**2-15. `:3414-3423`（単人指定判定結果、2箇所目——2-12と同じ`text`式だが呼び出し箇所が別関数）**

```js
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_player_pick_check_result_log", {
        name: c.name,
        dice: dice.join("+"),
        sum: sum,
        outcome: window.I18N.t(passed ? "ability_check_pass_label" : "ability_check_fail_label"),
      }),
      time: Date.now(),
      side: "gm",
    });
```

```js
    logGmDecision(
      window.I18N.t("gm_flow_player_pick_check_result_log", {
        name: c.name,
        dice: dice.join("+"),
        sum: sum,
        outcome: window.I18N.t(passed ? "ability_check_pass_label" : "ability_check_fail_label"),
      })
    );
```

**2-16. `:3451-3455`（単人指定判定・離脱ログ）**

```js
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_player_pick_check_leave_log"),
      time: Date.now(),
      side: "gm",
    });
```

```js
    logGmDecision(window.I18N.t("gm_flow_player_pick_check_leave_log"));
```

**2-17. `:3472`（条件付き協力選択の決定ログ）**

```js
    state.turnMessages.push({ text: window.I18N.t("gm_flow_choice_picked_log", { label: option.label }), time: Date.now(), side: "gm" });
```

```js
    logGmDecision(window.I18N.t("gm_flow_choice_picked_log", { label: option.label }));
```

**2-18. `:3682-3689`（分岐ポイント集計・外側サマリ）**

```js
      state.turnMessages.push({
        text: window.I18N.t("gm_flow_branch_tally_outer_summary_log", {
          points: outer.points,
          branch: highBranch ? outer.highLabel : outer.lowLabel,
        }),
        time: Date.now(),
        side: "gm",
      });
```

```js
      logGmDecision(
        window.I18N.t("gm_flow_branch_tally_outer_summary_log", {
          points: outer.points,
          branch: highBranch ? outer.highLabel : outer.lowLabel,
        })
      );
```

**2-19. `:3715-3719`（分岐ポイント集計・内側サマリ）**

```js
      state.turnMessages.push({
        text: window.I18N.t("gm_flow_branch_tally_inner_summary_log", { tier: tierLabel }),
        time: Date.now(),
        side: "gm",
      });
```

```js
      logGmDecision(window.I18N.t("gm_flow_branch_tally_inner_summary_log", { tier: tierLabel }));
```

各箇所を1つずつ変換し、`node --check static_src/night_gm_flow.js`が通ることを最後に確認する（一括置換ではなく、複数行にまたがる`text:`式の閉じ括弧の対応ミスを避けるため、Editツールで1箇所ずつ置換すること）。

- [ ] **Step 3: 構文チェックとビルド**

```bash
node --check static_src/night_gm_flow.js
py -3 generate.py
```

Expected: エラーなく終了する。

- [ ] **Step 4: Playwright動作確認（使い捨てスクリプト）**

戦闘トリガー（雜兵戰鬥）を1回発火させた後：

```js
var Core = window.PriTestNightCore;
console.log("autoGmLog length:", Core.state.autoGmLog.length); // 期待値: 1以上
console.log("last entry:", Core.state.autoGmLog[Core.state.autoGmLog.length - 1].text); // 敵追加ログのテキストが入っていること
```

「紀錄」ドロワーを開き「自動化GM紀錄」タブに同じ内容が表示されることも目視確認する。

- [ ] **Step 5: Commit**

```bash
git add static_src/night_gm_flow.js
git commit -m "feat(night): 進度版の分岐選擇・行為判定結果・戰鬥觸發等を自動化GM紀錄へ記録"
```

---

### Task 10: 自動化GM紀錄への戰鬥ダメージ・屬性蓄積・特殊效果記録（設計書§D、戰鬥部分）

**Files:**
- Modify: `static_src/night.js:2432-2436`（`addAutoGmLog`の直後に`addLogAndAutoGmLog`ヘルパー新設）
- Modify: `static_src/night.js:1442-1486`（`applyGuardedDamageToEnemy`）
- Modify: `static_src/night.js:1602-1740`（屬性/異常トリガー4関数、`addLog`呼び出し計8箇所）
- Modify: `static_src/night.js:1776-1817`（`recordAttributeStatusDealt`）
- Modify: `static_src/night.js:1830-1840`（`addReceivedAttributeStatus`）
- Modify: `static_src/night.js:8542`付近（`finishEnemyDamageRound`）
- Modify: `site_src/i18n_data_zh.py`/`_ja.py`/`_en.py`（`auto_gm_log_attribute_dealt`/`auto_gm_log_attribute_received`追加）

**Interfaces:**
- Produces: `addLogAndAutoGmLog(key, params)`（`night.js`内の新規非公開ヘルパー、既存`addLog`と`addAutoGmLog`の両方を同じi18nキー・paramsで呼ぶ）。

- [ ] **Step 1: `addLogAndAutoGmLog`ヘルパーを新設**

`static_src/night.js:2436`の`addAutoGmLog`関数の閉じ`}`の直後（`window.PriTestNightAddAutoGmLog = addAutoGmLog;`の前）に以下を追加する：

```js
  // 通常のaddLog（TTS対象・state.log）と全く同じi18nキー・paramsで、自動化GM紀錄
  // （state.autoGmLog）へも並行して記録するためのヘルパー。文言のズレを防ぐため、
  // 呼び出し側は1回だけキー・paramsを書けばよい。
  function addLogAndAutoGmLog(key, params) {
    addLog(key, params);
    addAutoGmLog(window.I18N.t(key, params));
  }

```

- [ ] **Step 2: `applyGuardedDamageToEnemy`のaddLog呼び出しを置き換え**

`static_src/night.js:1476-1483`の

```js
    addLog("log_guarded_damage_applied", {
      enemy: enemyDisplayNameForKey(enemyKey),
      damage: totalDamage || 0,
      guardBefore: currentGuard,
      guardAfter: newGuard,
      hpValue: hpValue,
      boxes: hpBoxes,
    });
    saveState();
```

を

```js
    addLogAndAutoGmLog("log_guarded_damage_applied", {
      enemy: enemyDisplayNameForKey(enemyKey),
      damage: totalDamage || 0,
      guardBefore: currentGuard,
      guardAfter: newGuard,
      hpValue: hpValue,
      boxes: hpBoxes,
    });
    saveState();
```

へ置き換える。

- [ ] **Step 3: 屬性/異常トリガー4関数のaddLog呼び出し8箇所を置き換え**

`static_src/night.js:1602-1740`の以下8箇所について、関数名を`addLog`から`addLogAndAutoGmLog`へ変更する（キー・params・呼び出し順序はすべて現状のまま）：

- `:1604` `addLog("log_attribute_status_element_trigger_enemy", { enemy: enemyDisplayNameForKey(enemyKey), label: label });`
- `:1614` `addLog("log_attribute_status_sleep_trigger_enemy", { enemy: enemyDisplayNameForKey(enemyKey) });`
- `:1618` `addLog("log_attribute_status_death_curse_trigger_enemy", { enemy: enemyDisplayNameForKey(enemyKey) });`
- `:1623` `addLog("log_attribute_status_ailment_trigger_enemy", { enemy: enemyDisplayNameForKey(enemyKey), label: label });`
- `:1717` `addLog("log_attribute_status_element_trigger_char", { name: c.name, label: label });`
- `:1729` `addLog("log_attribute_status_sleep_trigger_char", { name: c.name });`
- `:1732` `addLog("log_attribute_status_death_curse_trigger_char", { name: c.name });`
- `:1735` `addLog("log_attribute_status_ailment_trigger_char", { name: c.name, label: label });`

それぞれ関数名の`addLog`部分だけを`addLogAndAutoGmLog`に変更する（例：`addLog("log_attribute_status_element_trigger_enemy", {...})` → `addLogAndAutoGmLog("log_attribute_status_element_trigger_enemy", {...})`）。

- [ ] **Step 4: `recordAttributeStatusDealt`に屬性蓄積ログを追加**

`static_src/night.js:1808-1817`の

```js
    var actor = rosterCharacters.filter(function (rc) {
      return rc.id === characterId;
    })[0];
    if (actor) {
      if (!actor._phaseAttributeGains) actor._phaseAttributeGains = {};
      actor._phaseAttributeGains[label] = (actor._phaseAttributeGains[label] || 0) + value;
    }
    processAttributeStatusEnemyTrigger(enemyKey, label);
  }
```

を

```js
    var actor = rosterCharacters.filter(function (rc) {
      return rc.id === characterId;
    })[0];
    if (actor) {
      if (!actor._phaseAttributeGains) actor._phaseAttributeGains = {};
      actor._phaseAttributeGains[label] = (actor._phaseAttributeGains[label] || 0) + value;
      addAutoGmLog(
        window.I18N.t("auto_gm_log_attribute_dealt", {
          name: actor.name,
          enemy: enemyDisplayNameForKey(enemyKey),
          label: label,
          value: value,
          total: as.enemyAccum[accumKey],
        })
      );
    }
    processAttributeStatusEnemyTrigger(enemyKey, label);
  }
```

へ置き換える。

- [ ] **Step 5: `addReceivedAttributeStatus`に屬性蓄積ログを追加**

`static_src/night.js:1830-1840`の

```js
  function addReceivedAttributeStatus(characterId, label, value) {
    if (!value) return;
    if (!state.battle.attributeStatus) state.battle.attributeStatus = defaultBattleState().attributeStatus;
    var received = state.battle.attributeStatus.received;
    if (!received[characterId]) received[characterId] = {};
    received[characterId][label] = (received[characterId][label] || 0) + value;
    processAttributeStatusCharTrigger(characterId, label);
    saveState();
    saveRosterCharacters();
    renderAttributeStatusList();
  }
```

を

```js
  function addReceivedAttributeStatus(characterId, label, value) {
    if (!value) return;
    if (!state.battle.attributeStatus) state.battle.attributeStatus = defaultBattleState().attributeStatus;
    var received = state.battle.attributeStatus.received;
    if (!received[characterId]) received[characterId] = {};
    received[characterId][label] = (received[characterId][label] || 0) + value;
    var receivedChar = rosterCharacters.filter(function (rc) {
      return rc.id === characterId;
    })[0];
    if (receivedChar) {
      addAutoGmLog(
        window.I18N.t("auto_gm_log_attribute_received", {
          name: receivedChar.name,
          label: label,
          value: value,
          total: received[characterId][label],
        })
      );
    }
    processAttributeStatusCharTrigger(characterId, label);
    saveState();
    saveRosterCharacters();
    renderAttributeStatusList();
  }
```

へ置き換える。

- [ ] **Step 6: `finishEnemyDamageRound`に敵→玩家ダメージのログを追加**

`static_src/night.js:8542`付近の

```js
  function finishEnemyDamageRound(entered) {
    var parts = entered.map(function (c) {
      return c.name + window.I18N.t("colon_separator") + (state.battle.defenseHpLossSummary[c.id] || 0);
    });
    var summaryText = window.I18N.t("gm_flow_battle_defense_result_header") + "\n" + parts.join("\n");
    postSystemTurnMessage(window.I18N.t("gm_flow_battle_defense_result_header") + "　" + parts.join("、"));
    showThreatBroadcast([window.I18N.t("gm_flow_battle_defense_result_header"), parts.join("、")]);
    closeEnemyDamageModal();
```

を

```js
  function finishEnemyDamageRound(entered) {
    var parts = entered.map(function (c) {
      return c.name + window.I18N.t("colon_separator") + (state.battle.defenseHpLossSummary[c.id] || 0);
    });
    var summaryText = window.I18N.t("gm_flow_battle_defense_result_header") + "\n" + parts.join("\n");
    addAutoGmLog(summaryText);
    postSystemTurnMessage(window.I18N.t("gm_flow_battle_defense_result_header") + "　" + parts.join("、"));
    showThreatBroadcast([window.I18N.t("gm_flow_battle_defense_result_header"), parts.join("、")]);
    closeEnemyDamageModal();
```

へ置き換える。

- [ ] **Step 7: i18nキー追加**

`site_src/i18n_data_zh.py`の`"log_attribute_status_resistance_blocked"`キーの近くに：

```python
    "auto_gm_log_attribute_dealt": "{name} 對 {enemy} 累積了 {label}+{value}（合計 {total}）",
    "auto_gm_log_attribute_received": "{name} 受到 {label}+{value}（合計 {total}）",
```

`site_src/i18n_data_ja.py`の同キー近くに：

```python
    "auto_gm_log_attribute_dealt": "{name} が {enemy} へ {label}+{value} 蓄積（合計 {total}）",
    "auto_gm_log_attribute_received": "{name} が {label}+{value} を受けた（合計 {total}）",
```

`site_src/i18n_data_en.py`の同キー近くに：

```python
    "auto_gm_log_attribute_dealt": "{name} accumulated {label}+{value} on {enemy} (total {total})",
    "auto_gm_log_attribute_received": "{name} received {label}+{value} (total {total})",
```

- [ ] **Step 8: 構文チェックとビルド**

```bash
node --check static_src/night.js
py -3 generate.py
```

Expected: エラーなく終了する。

- [ ] **Step 9: Playwright動作確認（使い捨てスクリプト）**

戦闘中にGuard計算機で敵へダメージを適用した後：

```js
var Core = window.PriTestNightCore;
var last = Core.state.autoGmLog[Core.state.autoGmLog.length - 1];
console.log("last autoGmLog entry mentions damage:", last && last.text.indexOf("damage") === -1); // 実際はi18n解決済みの中文/日文文字列になるため、
// 「盧恩」「HP」等のキーワードではなく、直前に確認した敵名(enemyDisplayNameForKey相当)が
// 含まれているかで判定する。
console.log(last);
```

「紀錄」ドロワーの「自動化GM紀錄」タブで、ダメージ確定・屬性蓄積・特殊效果發動のログが実際に増えていくことを目視確認する。

- [ ] **Step 10: Commit**

```bash
git add static_src/night.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(night): 戰鬥ダメージ確定・屬性蓄積・特殊效果發動を自動化GM紀錄へ記録"
```

---

## 全タスク完了後の統合確認

- [ ] **統合Step 1: 全ファイルの構文チェック**

```bash
node --check static_src/night.js
node --check static_src/night_gm_flow.js
node --check static_src/night_floor_breakthrough.js
py -3 generate.py
```

- [ ] **統合Step 2: 既存回帰の再確認**

前セッションで作成した「樓層獎勵の自動push」「reload安全性」のPlaywrightシナリオ（a_start・鍛造村フロア2）を再実行し、Task 1〜10の変更後も壊れていないことを確認する。

- [ ] **統合Step 3: spec更新**

`docs/superpowers/specs/2026-08-11-auto-gm-flow-fixes-design.md`に「実装完了」の注記を追記する。
