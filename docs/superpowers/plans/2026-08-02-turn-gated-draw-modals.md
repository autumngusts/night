# GM回合限定の抽選系モーダル統合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 獎勵勾選清單／潛在之力／抽選武器／抽選消耗品／抽選飾品の5機能をメインメニューに集約し、`state.turnHolder==="gm"`の間だけ新規に開けるようにした上で、GMが開いて縮小した抽選ウィンドウはクラウド同期経由で全端末に見え、誰でも続きの骰子操作ができるようにする。あわせて戦闘資訊drawerの亂戰傷害をGM回合中のみ表示に変更する。

**Architecture:** 既存の `state.turnHolder`/`.modal.minimized` CSSパターン/`buildSaveData`-`applyLoadedData`-`resetState`の4箇所同期パターンを踏襲する。character_drawer.js（night.jsとは別クロージャ）とnight.js間は、既存の`window.PriTestNightLog`ログ用フックと同型の新規ブリッジ（`window.PriTestDrawStateSync`／`CharacterDrawer.applyRemoteDrawState`）で繋ぐ。骰子ロジック自体（`rollD6`・テーブル参照）は変更せず、各mutation直後にstateへ書き戻すフックのみ追加する。

**Tech Stack:** Vanilla JS（ES5構文、モジュールはIIFE+window公開）、Python（`site_src/*.py`がHTMLを生成、`py -3 generate.py`でビルド）、Playwright（`node`直接実行のE2Eスクリプト、フレームワークなし）、Firebase Realtime Database経由の`GameStorage.pushNightState`/`subscribeNightState`。

## Global Constraints

- 既存の骰子判定ロジック（`rollD6`、`lookupRarityBySum`、各drawテーブル参照）は変更しない。
- 星數(1〜4)の自動（骰子）判定は行わない——ユーザーが明示的に不要と回答済み。現状通りGM手動の`<select>`のまま。
- 本物のユーザー権限・認証システムは導入しない。`state.turnHolder`を可視性ゲートの代替として使う既存方針を踏襲する。
- 新規`state`フィールドは必ず4箇所（default state object literal／`resetState`／`applyLoadedData`／`buildSaveData`）に追加する（本プロジェクトの既存パターン）。
- i18nキーはzh/ja/en 3言語すべてに追加する（`site_src/i18n_data.py`）。
- 全ての変更後、`node --check`と`py -3 generate.py`でビルドが通ることを確認し、既存の全Playwright回帰テスト（`C:\Users\gsha\.claude\jobs\b2b98f4f\tmp\`配下の既存テストスクリプト群）を実行してリグレッションが無いことを確認する。
- `git push`はユーザーから明示指示済み（「結束後push main」）。全タスク完了・全テスト通過後に1回で行う。

---

### Task 1: 獎勵勾選清單ボタンのメインメニュー移動 ＋ 5機能のturnHolderゲート

**Files:**
- Modify: `site_src/night_page.py:21-33`（`#main-menu-list`）, `:52-58`（`#turn-holder-bar`内`#btn-turn-reward-open`）
- Modify: `static_src/night.js`（`renderTurnHolderBar`宣言直後に新規関数を追加、および`renderTurnHolderBar`/`handleTurnHolderToggle`/初期化処理からの呼び出し配線）
- Test: `C:\Users\gsha\.claude\jobs\b2b98f4f\tmp\turn_gate_menu_test.js`（新規）

**Interfaces:**
- Produces: `renderTurnGatedMenuItems()`（night.js内、`state.turnHolder`に応じて5つのボタンの`hidden`を切り替える。他タスクからも呼べるよう`renderTurnHolderBar()`内と`applyLoadedData`後の再描画チェーンに組み込む）

- [ ] **Step 1: `#btn-turn-reward-open`を`#main-menu-list`へ移動**

`site_src/night_page.py`の`#turn-holder-bar`内（:57）から以下の行を削除:
```html
          <button type="button" id="btn-turn-reward-open" data-i18n="turn_reward_open_button"></button>
```
`#main-menu-list`内（:30の`#btn-main-menu-draw-consumable`の直後）に追加:
```html
            <button id="btn-main-menu-draw-consumable" type="button" class="main-menu-item" data-i18n="main_menu_draw_consumable_label"></button>
            <button id="btn-turn-reward-open" type="button" class="main-menu-item" data-i18n="turn_reward_open_button"></button>
```

- [ ] **Step 2: `renderTurnGatedMenuItems()`を追加**

`static_src/night.js`の`renderTurnHolderBar`関数（5517行目）の直前に追加:
```js
  // 獎勵勾選清單／潛在之力／抽選武器・消耗品・飾品の「新規に開く」メインメニュー項目は
  // state.turnHolder==="gm"の間だけ表示する。既に開いて縮小済みのウィンドウ自体は
  // state.activeDraws（Task 2以降）の非null判定で別途表示されるため、ここで隠れるのは
  // あくまで「新規オープン」の入口ボタンのみ。
  function renderTurnGatedMenuItems() {
    var isGmTurn = state.turnHolder !== "players";
    ["btn-turn-reward-open", "btn-potential-power-info", "btn-main-menu-draw-weapon", "btn-main-menu-draw-talisman", "btn-main-menu-draw-consumable"].forEach(
      function (id) {
        var btn = document.getElementById(id);
        if (btn) btn.hidden = !isGmTurn;
      }
    );
  }
```

- [ ] **Step 3: 呼び出し箇所に配線**

`renderTurnHolderBar()`関数の末尾（現在の5544行目`}`の直前）に1行追加:
```js
    renderTurnGatedMenuItems();
```
`subscribeNightState`のコールバック（9013-9027行目）内、`renderUndoButton();`の直後に1行追加:
```js
        renderTurnGatedMenuItems();
```
（`renderTurnHolderBar()`自体もこのコールバックに含まれていないため、同じ箇所に`renderTurnHolderBar();`も追加する——現状バグ：他端末のturnHolder変更がリアルタイムでバーに反映されない）

- [ ] **Step 4: ビルドしてPlaywrightで検証**

```bash
cd /d/work/PriTest/PriTest && node --check static_src/night.js && py -3 generate.py
```
`C:\Users\gsha\.claude\jobs\b2b98f4f\tmp\turn_gate_menu_test.js`を新規作成し、以下を検証:
- 初期状態（`turnHolder:"gm"`）で5ボタンが`#main-menu-list`内に存在し、`hidden`でないこと。
- `#btn-turn-holder-toggle`をクリック→確認ダイアログでOK→`turnHolder`が`"players"`になった後、5ボタンが`hidden`になること。
- 再度トグルして`"gm"`に戻すと5ボタンが再表示されること。
- `#btn-turn-reward-open`が`#main-menu-list`の子要素であること（`#turn-holder-bar`の子でないこと）。

Run: `node "C:\Users\gsha\.claude\jobs\b2b98f4f\tmp\turn_gate_menu_test.js"`
Expected: 全項目`true`、`errors:[]`

- [ ] **Step 5: Commit**

```bash
git add site_src/night_page.py static_src/night.js
git commit -m "feat: 獎勵勾選清單ボタンをメインメニューへ移動し、5つの抽選系機能をGM回合限定表示に"
```

---

### Task 2: `state.activeDraws`の新設と`window.PriTestDrawStateSync`ブリッジ（night.js側）

**Files:**
- Modify: `static_src/night.js:561-594`（state object literal）, `:623-654`付近（`buildSaveData`）, `:1198-1245`（`applyLoadedData`）, `:1257-1289`（`resetState`）
- Modify: `static_src/night.js`（`renderTurnHolderBar`付近に`window.PriTestDrawStateSync`公開コードを追加）

**Interfaces:**
- Produces: `state.activeDraws = { potentialPower: object|null, weapon: object|null, talisman: object|null, consumable: object|null }`
- Produces: `window.PriTestDrawStateSync = { get: function(kind) => object|null, set: function(kind, obj|null) => void }`（`kind`は`"potentialPower"|"weapon"|"talisman"|"consumable"`）。`set`は`state.activeDraws[kind]`へ代入した上で`saveState()`（クラウドpush含む既存の保存関数）を呼ぶ。
- Consumes（Task 4以降）: character_drawer.jsが`window.PriTestDrawStateSync.set(kind, obj)`を呼ぶことで書き戻す。

- [ ] **Step 1: state object literalに追加**

`static_src/night.js:593`（`turnBoardEnabled: true,`の直後）に追加:
```js
    turnBoardEnabled: true, // 主選單から行動留言板機能全体を開閉するフラグ
    // GMが開いて縮小した抽選ウィンドウを全端末で共有するための領域。null=未使用。
    // 中身はcharacter_drawer.jsのweaponRollState/talismanRollState/consumableRollState、
    // またはnight.js内のpotentialPower*変数群と同じ形をした素のJSONオブジェクト。
    activeDraws: { potentialPower: null, weapon: null, talisman: null, consumable: null },
```

- [ ] **Step 2: `buildSaveData`に追加**

`turnBoardEnabled: state.turnBoardEnabled,`（653行目）の直後に追加:
```js
      turnBoardEnabled: state.turnBoardEnabled,
      activeDraws: state.activeDraws,
```

- [ ] **Step 3: `applyLoadedData`に追加**

`state.turnBoardEnabled = ...`（1241行目）の直後に追加:
```js
      state.turnBoardEnabled = typeof data.turnBoardEnabled === "boolean" ? data.turnBoardEnabled : true;
      var loadedDraws = data.activeDraws && typeof data.activeDraws === "object" ? data.activeDraws : {};
      state.activeDraws = {
        potentialPower: loadedDraws.potentialPower || null,
        weapon: loadedDraws.weapon || null,
        talisman: loadedDraws.talisman || null,
        consumable: loadedDraws.consumable || null,
      };
```

- [ ] **Step 4: `resetState`に追加**

`state.turnBoardEnabled = true;`（1286行目）の直後に追加:
```js
    state.turnBoardEnabled = true;
    state.activeDraws = { potentialPower: null, weapon: null, talisman: null, consumable: null };
```

- [ ] **Step 5: `window.PriTestDrawStateSync`を公開**

`renderTurnHolderBar`関数（5517行目）の直前、Task 1で追加した`renderTurnGatedMenuItems`のさらに直前に追加:
```js
  // character_drawer.js（別クロージャ）が抽選の進行中状態をstate.activeDrawsへ書き戻すための
  // ブリッジ。window.PriTestNightLogと同じ「存在確認つきグローバルフック」方式。
  window.PriTestDrawStateSync = {
    get: function (kind) {
      return state.activeDraws[kind] || null;
    },
    set: function (kind, obj) {
      state.activeDraws[kind] = obj || null;
      saveState();
    },
  };
```

- [ ] **Step 6: `saveState`関数名を確認し、無ければ実際の保存関数名に置き換える**

`grep -n "function saveState" static_src/night.js`で実際の関数名を確認する（既存の`turnRewards`保存で使われている関数と同じもの——`handleTurnMessageSend`内で`saveState();`を呼んでいるのでこれが正しい名前のはず）。異なる場合はStep 5のコードを実際の関数名に合わせて修正する。

- [ ] **Step 7: ビルド確認**

```bash
cd /d/work/PriTest/PriTest && node --check static_src/night.js
```

- [ ] **Step 8: Commit**

```bash
git add static_src/night.js
git commit -m "feat: state.activeDrawsとcharacter_drawer.js向け同期ブリッジを新設"
```

---

### Task 3: 潛在之力を`state.activeDraws.potentialPower`経由に移行し、縮小を`.modal.minimized`パターンへ統一

**Files:**
- Modify: `static_src/night.js:6402-6410`（ローカル変数群）, `:6412-6459`（`openPotentialPowerModal`/`closePotentialPowerModal`/`minimizePotentialPowerModal`/`restorePotentialPowerModal`）, `:6468-`（`renderPotentialPowerModal`内の全参照箇所）
- Modify: `site_src/night_page.py:362-385`（`#potential-power-modal`のHTML、縮小ボタンをmodal-floating-close方式に変更）
- Test: `C:\Users\gsha\.claude\jobs\b2b98f4f\tmp\potential_power_sync_test.js`（新規）

**Interfaces:**
- Consumes: `window.PriTestDrawStateSync.get("potentialPower")`/`.set("potentialPower", obj)`（Task 2で新設）
- Produces: `state.activeDraws.potentialPower`の形は既存ローカル変数群と同じキー名の1オブジェクトにまとめる: `{ selectedCharacterId, starCount, weaponResult, effectResult, effectSlotPreview, resolved, minimized, pendingAttributeTag }`（`onResolvedFn`はコールバックなのでシリアライズ対象外、呼び出し元スコープのローカル変数`potentialPowerOnResolvedFnLocal`としてnight.js内に残す＝この1つだけは同期しない）

- [ ] **Step 1: ローカル変数群を1つのヘルパー経由に置き換える**

`static_src/night.js:6402-6410`の9行を以下に置き換える（`potentialPowerOnResolvedFn`はコールバックのため同期対象から除外しローカルに残す）:
```js
  var potentialPowerOnResolvedFn = null; // 同期対象外（関数はJSONにできないため、常にローカルのみ）

  function ppState() {
    if (!state.activeDraws.potentialPower) {
      state.activeDraws.potentialPower = {
        selectedCharacterId: null,
        starCount: 1,
        weaponResult: null,
        effectResult: null,
        effectSlotPreview: null,
        resolved: null,
        minimized: false,
        pendingAttributeTag: null,
      };
    }
    return state.activeDraws.potentialPower;
  }

  function ppSave() {
    window.PriTestDrawStateSync.set("potentialPower", state.activeDraws.potentialPower);
  }
```
以降、旧`potentialPowerSelectedCharacterId`は`ppState().selectedCharacterId`、`potentialPowerStarCount`は`ppState().starCount`、`potentialPowerWeaponResult`は`ppState().weaponResult`、`potentialPowerEffectResult`は`ppState().effectResult`、`potentialPowerEffectSlotPreview`は`ppState().effectSlotPreview`、`potentialPowerResolved`は`ppState().resolved`、`potentialPowerMinimized`は`ppState().minimized`、`potentialPowerPendingAttributeTag`は`ppState().pendingAttributeTag`に読み替える。`static_src/night.js`内でこれら8変数名を参照している全箇所（`grep -n "potentialPowerSelectedCharacterId\|potentialPowerStarCount\|potentialPowerWeaponResult\|potentialPowerEffectResult\|potentialPowerEffectSlotPreview\|potentialPowerResolved\|potentialPowerMinimized\|potentialPowerPendingAttributeTag" static_src/night.js`で洗い出す）を機械的に置換し、代入を行う箇所（`=`で値をセットしている箇所）の直後に`ppSave();`を1行追加する。

- [ ] **Step 2: `openPotentialPowerModal`を書き換え**

```js
  function openPotentialPowerModal(presetCharacterId, presetStarCount, presetAttributeTag, onResolved) {
    var entered = rosterCharacters.filter(function (c) {
      return c.entered;
    });
    if (!entered.length) return;
    var pp = ppState();
    if (presetCharacterId && entered.some(function (c) { return c.id === presetCharacterId; })) {
      pp.selectedCharacterId = presetCharacterId;
    } else if (!entered.some(function (c) { return c.id === pp.selectedCharacterId; })) {
      pp.selectedCharacterId = entered[0].id;
    }
    pp.starCount = presetStarCount || 1;
    pp.weaponResult = null;
    pp.effectResult = null;
    pp.effectSlotPreview = null;
    pp.resolved = null;
    pp.minimized = false;
    pp.pendingAttributeTag = presetAttributeTag || null;
    potentialPowerOnResolvedFn = onResolved || null;
    ppSave();
    document.getElementById("potential-power-modal").hidden = false;
    document.getElementById("potential-power-modal").classList.remove("minimized");
    renderPotentialPowerModal();
  }

  function closePotentialPowerModal() {
    document.getElementById("potential-power-modal").hidden = true;
  }

  function renderPotentialPowerMinimizeButton() {
    var modal = document.getElementById("potential-power-modal");
    var btn = document.getElementById("btn-potential-power-minimize");
    if (!modal || !btn) return;
    var isMinimized = modal.classList.contains("minimized");
    btn.textContent = isMinimized ? "\u{1F5D6}" : "\u{1F5D5}";
    btn.title = window.I18N.t(isMinimized ? "combat_modal_restore_button" : "combat_modal_minimize_button");
  }

  function handlePotentialPowerMinimizeToggle() {
    var modal = document.getElementById("potential-power-modal");
    if (!modal) return;
    modal.classList.toggle("minimized");
    ppState().minimized = modal.classList.contains("minimized");
    ppSave();
    renderPotentialPowerMinimizeButton();
  }
```
`resetPotentialPowerRoll`関数内の代入も同様に`ppState()`経由へ書き換え、末尾に`ppSave();`を追加する。

- [ ] **Step 3: HTML側を修正**

`site_src/night_page.py:362-385`を以下に置き換える（`#btn-potential-power-restore`の別ボタン方式を廃止し、combat-modal/turn-reward-modalと同じ`modal-floating-close`方式に統一）:
```html
    <div id="potential-power-modal" class="modal" hidden>
      <div class="modal-box combat-modal-box">
        <button type="button" class="modal-floating-close" id="btn-potential-power-minimize">&#128469;</button>
        <h2 data-i18n="potential_power_modal_title"></h2>
        <div class="wb-row">
          <label data-i18n="potential_power_character_label"></label>
          <select id="potential-power-character-select"></select>
        </div>
        <div class="wb-row">
          <label data-i18n="potential_power_star_label"></label>
          <select id="potential-power-star-select">
            <option value="1">★</option>
            <option value="2">★★</option>
            <option value="3">★★★</option>
            <option value="4">★★★★</option>
          </select>
        </div>
        <div id="potential-power-modal-content"></div>
        <div class="actions">
          <button id="btn-potential-power-modal-close" type="button" class="primary-btn" data-i18n="close_button"></button>
        </div>
      </div>
    </div>
```
（`#btn-potential-power-restore`ボタン要素ごと削除。night.js側の初期化処理で`document.getElementById("btn-potential-power-restore")`を参照している箇所も削除し、代わりに`document.getElementById("btn-potential-power-minimize").addEventListener("click", handlePotentialPowerMinimizeToggle);`を追加する）

- [ ] **Step 4: `renderPotentialPowerModal`冒頭でminimizeボタン状態も更新**

`renderPotentialPowerModal`関数の先頭（6469行目直後）に追加:
```js
    renderPotentialPowerMinimizeButton();
```
既存の`hasActiveRoll`/`minimizeBtn.hidden`関連コード（旧`btn-potential-power-minimize`をhidden切り替えていた箇所）は削除する（常時表示のfloating-closeボタンに統一するため）。

- [ ] **Step 5: リモート反映時の再描画を配線**

`subscribeNightState`コールバック（Task 1で`renderTurnGatedMenuItems();`を追加した箇所と同じ場所）に追加:
```js
        if (state.activeDraws.potentialPower && document.getElementById("potential-power-modal").hidden) {
          document.getElementById("potential-power-modal").hidden = false;
          document.getElementById("potential-power-modal").classList.toggle("minimized", !!state.activeDraws.potentialPower.minimized);
          renderPotentialPowerModal();
        }
```
（他端末でGMが開いた抽選が非nullになったら、このクライアントでも自動的にモーダルを表示する。既に開いている場合は二重初期化しない）

- [ ] **Step 6: ビルドしてPlaywrightで検証**

```bash
cd /d/work/PriTest/PriTest && node --check static_src/night.js && py -3 generate.py
```
`potential_power_sync_test.js`を新規作成:
- ゲームAをcloudモードで開き、GMとしてキャラを選択し星數2で抽選実行、その後縮小トグル。
- 別のPlaywright `browserContext`（同じ`gameId`のcloudストレージ）で2つ目のページを開き、`state.activeDraws.potentialPower`が同じ内容で同期されており、`#potential-power-modal`が`minimized`クラス付きで表示されていること、かつそこから武器/効果の確定ボタンを押せることを確認する。

- [ ] **Step 7: Commit**

```bash
git add static_src/night.js site_src/night_page.py
git commit -m "feat: 潛在之力をstate.activeDraws経由の跨裝置同期＋.modal.minimizedパターンへ移行"
```

---

### Task 4: character_drawer.js側のブリッジ配線（抽選武器／消耗品／飾品）

**Files:**
- Modify: `static_src/character_drawer.js`（`weaponRollState`/`talismanRollState`/`consumableRollState`関連の全mutation箇所）

**Interfaces:**
- Consumes: `window.PriTestDrawStateSync.get(kind)`/`.set(kind, obj)`（Task 2）
- Produces: `CharacterDrawer.applyRemoteDrawState(kind, data)`（night.jsのsubscribeコールバックから呼ばれ、ローカル変数を上書きして現在マウント中のフィールドを再描画する）

- [ ] **Step 1: 同期ヘルパーを追加**

`character_drawer.js`の`logIfAvailable`関数（既存、この会話の前フェーズで追加済み）の直後に追加:
```js
  function syncDrawStateIfAvailable(kind) {
    if (!window.PriTestDrawStateSync) return;
    var stateVar = kind === "weapon" ? weaponRollState : kind === "talisman" ? talismanRollState : consumableRollState;
    window.PriTestDrawStateSync.set(kind, stateVar);
  }
```

- [ ] **Step 2: 各`resetXxxState`関数の末尾に呼び出しを追加**

`resetWeaponRollState()`（2127-2170行目）の末尾に`syncDrawStateIfAvailable("weapon");`を追加。
`resetTalismanRollState()`（4417-4429行目）の末尾に`syncDrawStateIfAvailable("talisman");`を追加。
`resetConsumableRollState()`（4593-4604行目）の末尾に`syncDrawStateIfAvailable("consumable");`を追加。

- [ ] **Step 3: 各step/確定ボタンのハンドラ末尾に呼び出しを追加**

以下の`click`ハンドラ関数本体の末尾（既存の`renderXxxRollField()`/`renderXxxField()`呼び出しの直後）に、対応する`syncDrawStateIfAvailable(kind)`を1行追加する（骰子ロジック自体は変更しない、末尾に1行足すだけ）:
- Weapon: `character_drawer.js`内、`weaponRollState`の各フィールドを書き換えるボタンハンドラ全て（category選択、favored選択、star選択の`onchange`、`step1Btn`の`click`＝3916-3931行目付近、rarity上書きselect、`item`確定、`skill`確定、最終`resolved`確定）。実装時に`grep -n "st\.\(starCount\|categoryId\|rarity\|item\|resolved\)\s*=" static_src/character_drawer.js`で該当箇所を洗い出し、各代入直後（同じイベントハンドラ関数の末尾）に追加する。
- Talisman: `step1Btn`/`step2Btn`/`step3Btn`（4462-4533行目付近）の各`click`ハンドラ末尾。
- Consumable: `step1Btn`/`step2Btn`（4651-4709行目付近）の各`click`ハンドラ末尾。

- [ ] **Step 4: `applyRemoteDrawState`を追加**

`character_drawer.js`のモジュール公開オブジェクト（`window.PriTestCharacterDrawer = {...}` のプロパティ列挙部分、ファイル末尾付近を`grep -n "window.PriTestCharacterDrawer = {" static_src/character_drawer.js`で特定）に以下の関数を実装として追加し、公開オブジェクトにも列挙する:
```js
  function applyRemoteDrawState(kind, data) {
    if (kind === "weapon") {
      weaponRollState = data;
      if (weaponRollFieldEl && weaponRollFieldEl.dataset.open === "1") renderWeaponRollField();
    } else if (kind === "talisman") {
      talismanRollState = data;
      if (talismanRollFieldEl && talismanRollFieldEl.dataset.open === "1") renderTalismanRollField();
    } else if (kind === "consumable") {
      consumableRollState = data;
      if (consumableRollFieldEl && consumableRollFieldEl.dataset.open === "1") renderConsumableRollField();
    }
  }
```
（`renderWeaponRollField`/`renderTalismanRollField`/`renderConsumableRollField`という関数名は実際のコードで`grep -n "function render.*RollField"`により確認し、異なれば実名に合わせる）

- [ ] **Step 5: night.js側のsubscribeコールバックから呼び出す**

`subscribeNightState`コールバック内に追加:
```js
        ["weapon", "talisman", "consumable"].forEach(function (kind) {
          if (state.activeDraws[kind]) CharacterDrawer.applyRemoteDrawState(kind, state.activeDraws[kind]);
        });
```

- [ ] **Step 6: ビルドして既存の武器/飾品/消耗品抽選のPlaywrightテスト（既存の`main_menu_draw_test.js`等）を再実行し、機能を壊していないことを確認**

```bash
cd /d/work/PriTest/PriTest && node --check static_src/character_drawer.js && node --check static_src/night.js && py -3 generate.py
node "C:\Users\gsha\.claude\jobs\b2b98f4f\tmp\main_menu_draw_test.js"
node "C:\Users\gsha\.claude\jobs\b2b98f4f\tmp\weapon_wizard_reward_test.js"
```
（この2本は既知でまれにフレーキーなため、`FAILED`が出た場合は単独で再実行して切り分ける——既存セッションの確立済み運用）

- [ ] **Step 7: Commit**

```bash
git add static_src/character_drawer.js static_src/night.js
git commit -m "feat: 抽選武器/消耗品/飾品のロール状態をstate.activeDraws経由で跨裝置同期"
```

---

### Task 5: `#item-draw-modal`への縮小トグル追加 ＋ リモート自動表示

**Files:**
- Modify: `site_src/night_page.py:398-406`（`#item-draw-modal`）
- Modify: `static_src/night.js`（`openItemDrawModal`/`closeItemDrawModal`付近、6256-6295行目周辺）
- Test: `C:\Users\gsha\.claude\jobs\b2b98f4f\tmp\item_draw_minimize_sync_test.js`（新規）

**Interfaces:**
- Consumes: Task 4の`state.activeDraws.weapon/talisman/consumable`（非null＝進行中の抽選あり）

- [ ] **Step 1: HTMLに縮小ボタンを追加**

`site_src/night_page.py:398-406`を以下に置き換える:
```html
    <div id="item-draw-modal" class="modal" hidden>
      <div class="modal-box combat-modal-box">
        <button type="button" class="modal-floating-close" id="btn-item-draw-modal-minimize">&#128469;</button>
        <h2 id="item-draw-modal-title"></h2>
        <div id="item-draw-modal-content"></div>
        <div class="actions">
          <button id="btn-item-draw-modal-close" type="button" class="primary-btn" data-i18n="close_button"></button>
        </div>
      </div>
    </div>
```

- [ ] **Step 2: night.jsに縮小ハンドラを追加**

`openItemDrawModal`関数（6256行目）の直前に追加:
```js
  function renderItemDrawModalMinimizeButton() {
    var modal = document.getElementById("item-draw-modal");
    var btn = document.getElementById("btn-item-draw-modal-minimize");
    if (!modal || !btn) return;
    var isMinimized = modal.classList.contains("minimized");
    btn.textContent = isMinimized ? "\u{1F5D6}" : "\u{1F5D5}";
    btn.title = window.I18N.t(isMinimized ? "combat_modal_restore_button" : "combat_modal_minimize_button");
  }

  function handleItemDrawModalMinimizeToggle() {
    var modal = document.getElementById("item-draw-modal");
    if (!modal) return;
    modal.classList.toggle("minimized");
    renderItemDrawModalMinimizeButton();
  }
```
`openItemDrawModal`関数の冒頭（`document.getElementById("item-draw-modal").hidden = false;`のような行の直後）に以下を追加:
```js
    document.getElementById("item-draw-modal").classList.remove("minimized");
    renderItemDrawModalMinimizeButton();
```
初期化処理（9146行目`btn-turn-reward-modal-minimize`の配線コードの近く）に追加:
```js
    document.getElementById("btn-item-draw-modal-minimize").addEventListener("click", handleItemDrawModalMinimizeToggle);
```

- [ ] **Step 3: リモートで進行中の抽選があれば自動的にモーダルを開く**

Task 4のStep 5で追加したforEachブロックの直後（`subscribeNightState`コールバック内）に追加:
```js
        ["weapon", "talisman", "consumable"].some(function (kind) {
          if (!state.activeDraws[kind]) return false;
          var modal = document.getElementById("item-draw-modal");
          if (modal.hidden) {
            modal.hidden = false;
            modal.classList.add("minimized");
            renderItemDrawModalMinimizeButton();
          }
          return true;
        });
```
（weapon/talisman/consumableのいずれか1つでも進行中なら`#item-draw-modal`を縮小状態で自動表示する。既に開いている場合は上書きしない＝ローカルでの縮小/復元操作を尊重する）

- [ ] **Step 4: ビルドしてPlaywrightで検証**

```bash
cd /d/work/PriTest/PriTest && node --check static_src/night.js && py -3 generate.py
```
`item_draw_minimize_sync_test.js`を新規作成し、Task 3のStep 6と同様に2ブラウザコンテキストで武器抽選を開始→縮小→別コンテキストで自動表示・`.modal.minimized`クラス・骰子操作継続が可能なことを確認する。

- [ ] **Step 5: Commit**

```bash
git add site_src/night_page.py static_src/night.js
git commit -m "feat: 抽選武器/消耗品/飾品モーダルに縮小トグルを追加し、リモート進行中抽選を自動表示"
```

---

### Task 6: GM回合限定の設定変更ロック

**Files:**
- Modify: `static_src/night.js`（`renderPotentialPowerModal`内の`starSelect`）
- Modify: `static_src/character_drawer.js`（weapon draw の category/star/rarity上書きselect、`renderWeaponRollField`内）

**Interfaces:**
- Consumes: `window.PriTestTurnHolder`（新規、night.jsが公開する`function() { return state.turnHolder; }`——character_drawer.jsからturnHolderを読むための一方向フック、`PriTestNightLog`/`PriTestDrawStateSync`と同型）

- [ ] **Step 1: night.jsに`window.PriTestTurnHolder`を公開**

Task 2 Step 5の`window.PriTestDrawStateSync`定義の直後に追加:
```js
  window.PriTestTurnHolder = function () {
    return state.turnHolder;
  };
```

- [ ] **Step 2: 潛在之力の星數selectをGM回合限定に**

`renderPotentialPowerModal`内、`starSelect.disabled = !!(potentialPowerWeaponResult || potentialPowerEffectResult);`だった行（Task 3で`ppState().weaponResult`等に置換済み）を以下に変更:
```js
    starSelect.disabled = !!(pp.weaponResult || pp.effectResult) || state.turnHolder === "players";
```

- [ ] **Step 3: 抽選武器のcategory/star/rarity上書きselectをGM回合限定に**

`character_drawer.js`の`renderWeaponRollField`内、`starSelect.disabled = st.rarityConfirmed;`（3910行目付近）を以下に変更:
```js
    starSelect.disabled = st.rarityConfirmed || (window.PriTestTurnHolder && window.PriTestTurnHolder() === "players");
```
同様に、category選択の`<select>`（`grep -n "categoryId.*disabled\|categorySelect" static_src/character_drawer.js`で特定）、rarity上書きの`<select>`（3958-3987行目付近）、および「隨機戰技a/b」に該当する選択UI（`grep -n "skillTableLetter\|skillA\|skillB\|戰技.*[ab]" static_src/character_drawer.js`で該当箇所を特定）についても、それぞれの既存`disabled`条件へ`|| (window.PriTestTurnHolder && window.PriTestTurnHolder() === "players")`を`||`で追記する。骰子を振る・確定するボタン（`step1Btn`等の実行系ボタン）は対象外（disabled条件を追加しない）。

- [ ] **Step 4: ビルドしてPlaywrightで検証**

```bash
cd /d/work/PriTest/PriTest && node --check static_src/night.js static_src/character_drawer.js && py -3 generate.py
```
`turn_gate_menu_test.js`（Task 1で作成）に追記: `turnHolder`を`"players"`にした状態で潛在之力の星數select・武器抽選のcategory/star selectが`disabled`になっており、骰子を振るボタンは`disabled`でないことを確認する。

- [ ] **Step 5: Commit**

```bash
git add static_src/night.js static_src/character_drawer.js
git commit -m "feat: 抽選系の類別/星數/稀有度/戰技選択をGM回合限定に制限"
```

---

### Task 7: 亂戰傷害の非公開化

**Files:**
- Modify: `static_src/night.js:7013-7019`（`renderSelectedEnemies`内）
- Test: `C:\Users\gsha\.claude\jobs\b2b98f4f\tmp\melee_damage_visibility_test.js`（新規）

- [ ] **Step 1: 表示条件に`turnHolder`ゲートを追加**

`static_src/night.js:7013`の
```js
        if (target.withRemove && lvRow && lvRow.dmg != null) {
```
を以下に変更:
```js
        if (target.withRemove && lvRow && lvRow.dmg != null && state.turnHolder !== "players") {
```

- [ ] **Step 2: `renderSelectedEnemies`をturnHolder変更時にも再描画するよう配線**

`handleTurnHolderToggle`関数（5548-5557行目）の`renderTurnHolderBar();`の直前に追加:
```js
    renderSelectedEnemies();
```

- [ ] **Step 3: ビルドしてPlaywrightで検証**

```bash
cd /d/work/PriTest/PriTest && node --check static_src/night.js && py -3 generate.py
```
`melee_damage_visibility_test.js`を新規作成:
- 敵を選択した状態で`turnHolder:"gm"`のとき`#battle-selected-enemies`内に亂戰傷害ラベルの数値が表示されること。
- `turnHolder`を`"players"`に切り替えると同じ箇所から亂戰傷害の数値行が消えること（他のHP等の情報は残ること）。

- [ ] **Step 4: Commit**

```bash
git add static_src/night.js
git commit -m "fix: 亂戰傷害をGM回合中のみ表示にし、玩家回合中は非公開にする"
```

---

### Task 8: i18n追加

**Files:**
- Modify: `site_src/i18n_data.py`（zh/ja/en 3ブロック）

**Interfaces:**
- Produces: 新規キー一覧（値は各言語で適切に翻訳する。既存の`combat_modal_minimize_button`/`combat_modal_restore_button`は使い回すため新規キー不要）

- [ ] **Step 1: 新規キーを洗い出す**

このプランの全タスクを通して、実際に新規i18nキーが必要になるのは以下のみ（他は既存キーの使い回し）:
- なし（`combat_modal_minimize_button`/`combat_modal_restore_button`を`.modal.minimized`統一パターンとして使い回すため、新規追加は不要）。

Task実装中に、上記以外で`window.I18N.t("...")`の未定義キー参照によるコンソールエラーが出た場合のみ、その時点で`grep -n "^ZH = {\|^JA = {\|^EN = {" site_src/i18n_data.py`で3ブロックの開始行を確認し、同一キーをzh/ja/en全てに追加する。

- [ ] **Step 2: ビルドして全ページでコンソールエラーが出ないことを確認**

```bash
cd /d/work/PriTest/PriTest && py -3 generate.py
```

---

### Task 9: 全体回帰テスト・最終確認・push

**Files:** なし（検証のみ）

- [ ] **Step 1: 既存の全Playwright回帰テストを実行**

`C:\Users\gsha\.claude\jobs\b2b98f4f\tmp\`配下の既存テストスクリプト（10角色戦闘テスト、`turn_holder_test.js`、`turn_note_log_summary_minimize_test.js`、`bag_drawer_damage_tag_log_test.js`、`dice_pool_clear_test.js`等）を順に実行し、全て`errors:[]`かつ期待通りの結果であることを確認する。`main_menu_draw_test.js`/`weapon_wizard_reward_test.js`が単発で`FAILED`と出た場合は単独再実行して切り分ける（既知のフレーキーテスト）。

- [ ] **Step 2: 本タスクで新規作成した全Playwrightテストを再実行**

`turn_gate_menu_test.js`、`potential_power_sync_test.js`、`item_draw_minimize_sync_test.js`、`melee_damage_visibility_test.js`を再実行し、全て通ることを確認する。

- [ ] **Step 3: `git status`で全変更がコミット済みであることを確認**

```bash
cd /d/work/PriTest/PriTest && git status --short
git log --oneline -10
```

- [ ] **Step 4: ユーザー指示通り`main`へpush**

```bash
git push origin main
```
