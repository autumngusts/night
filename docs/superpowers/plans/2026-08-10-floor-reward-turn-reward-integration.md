# フロア獎勵の獎勵清單統合＋劇本1データ監査 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** フロアの構造化獎勵（`floor.reward`）のうち「戦利品」種別を、GMの手動確定を経ずに既存の獎勵清單（`state.turnRewards`）へ自動pushし、`diceHandChoice`（役判定式報酬）を専用抽選視窗として切り出し、劇本1（`tricephalos`）の全フロアで記述とデータのズレを解消する。

**Architecture:** `night_floor_breakthrough.js`にfloor.rewardの「戦利品／GM判断」分類ロジックと、既存の獎勵清單API（`night.js`の`claimTurnReward`等）へ変換してpushするヘルパーを新設する。`openFloorRewardModal`が呼ばれた瞬間に戦利品エントリを自動push、GM判断エントリのみモーダル表示、という単一のフックポイントに集約することで、自動化GMフロー・GMの手動閲覧のどちらの経路からも同じ挙動になる。

**Tech Stack:** Vanilla ES5 JS（`static_src/*.js`、IIFE + `window.PriTest*`名前空間）、Python生成の静的HTML（`site_src/*.py`）、`localStorage` + 任意でFirebase Realtime Database同期。自動テストフレームワークは存在しない — 検証は`node --check`（構文）とPlaywrightの使い捨てスクリプト（コミットしない）。

## Global Constraints

- ビルドは`py -3 generate.py`（Windows）。`static_src/`または`site_src/`を編集したら必ず再実行する。
- JSはES5のみ（`const`/`let`/アロー関数/テンプレートリテラル禁止、`var`と`function`式のみ）。
- i18n文字列は`site_src/i18n_data_zh.py`/`_ja.py`/`_en.py`の3ファイル全てに追加する（`zh`が既定言語）。
- 新規モジュール変数・関数は既存のIIFEクロージャ内に置き、`window.PriTestNightCore`/`window.PriTestNightFloorBreakthrough`等の既存の名前空間経由でのみ他モジュールへ公開する。
- Playwright検証スクリプトは使い捨てで、リポジトリにコミットしない（`docs/scenario_flow_rules.md`と同じ既存方針）。
- 対象範囲は劇本1（`tricephalos`）のみ。他劇本のフォールバック依存はそのまま残す。

---

### Task 1: 獎勵清單コアの拡張（`night.js`）

**Files:**
- Modify: `static_src/night.js:8038-8047`（`TURN_REWARD_KINDS`定義部）
- Modify: `static_src/night.js:8264-8304`（`claimTurnReward`のweapon/potentialPower分岐、weaponSkillReroll分岐を追加）
- Modify: `static_src/night.js:11098-11138`（`window.PriTestNightCore`エクスポート）
- Modify: `site_src/i18n_data_zh.py:1014` 付近、`site_src/i18n_data_ja.py:1014` 付近、`site_src/i18n_data_en.py:1014` 付近（`turn_reward_kind_weaponSkillReroll`追加）

**Interfaces:**
- Produces: `window.PriTestNightCore.pushTurnRewards(rewardObjs)`（`rewardObjs`は`{id, kind, targetCharacterId, value, claimed, categoryId?, attributeTag?}`の配列）、`window.PriTestNightCore.TURN_REWARD_ANY_TARGET_VALUE`（`"__any__"`）、`window.PriTestNightCore.TURN_REWARD_SHARED_TARGET_VALUE`（`"__shared__"`）— Task 2で使用。

- [ ] **Step 1: `TURN_REWARD_KINDS`に`weaponSkillReroll`を追加**

`static_src/night.js:8038`の

```js
  var TURN_REWARD_KINDS = ["weapon", "consumable", "talisman", "potentialPower", "stoneswordKey", "smithingStone", "chaliceBonus", "rune", "buriedTreasure"];
```

を

```js
  var TURN_REWARD_KINDS = ["weapon", "consumable", "talisman", "potentialPower", "weaponSkillReroll", "stoneswordKey", "smithingStone", "chaliceBonus", "rune", "buriedTreasure"];
```

へ置き換える。

- [ ] **Step 2: `claimTurnReward`のweapon/potentialPower分岐を拡張し、weaponSkillReroll分岐を追加**

`static_src/night.js:8268-8303`の

```js
    if (reward.kind === "weapon") {
      minimizeSelf();
      openItemDrawModal("weapon", target.id, {
        starCount: reward.value,
        onGranted: function () {
          finish("log_turn_reward_claim_generic", { kind: window.I18N.t("turn_reward_kind_weapon"), character: target.name });
        },
      });
      return;
    }
    if (reward.kind === "consumable") {
      minimizeSelf();
      openItemDrawModal("consumable", target.id, {
        grantCount: reward.value,
        onGranted: function () {
          finish("log_turn_reward_claim_generic", { kind: window.I18N.t("turn_reward_kind_consumable"), character: target.name });
        },
      });
      return;
    }
    if (reward.kind === "talisman") {
      minimizeSelf();
      openItemDrawModal("talisman", target.id, {
        onGranted: function () {
          finish("log_turn_reward_claim_generic", { kind: window.I18N.t("turn_reward_kind_talisman"), character: target.name });
        },
      });
      return;
    }
    if (reward.kind === "potentialPower") {
      minimizeSelf();
      window.PriTestNightPotentialPower.openPotentialPowerModal(target.id, reward.value, null, function () {
        finish("log_turn_reward_claim_generic", { kind: window.I18N.t("turn_reward_kind_potentialPower"), character: target.name });
      });
      return;
    }
  }
```

を

```js
    if (reward.kind === "weapon") {
      minimizeSelf();
      openItemDrawModal("weapon", target.id, {
        starCount: reward.value,
        categoryId: reward.categoryId || null,
        attributeTag: reward.attributeTag ? window.PriTestFields.localizedText(reward.attributeTag) : null,
        onGranted: function () {
          finish("log_turn_reward_claim_generic", { kind: window.I18N.t("turn_reward_kind_weapon"), character: target.name });
        },
      });
      return;
    }
    if (reward.kind === "consumable") {
      minimizeSelf();
      openItemDrawModal("consumable", target.id, {
        grantCount: reward.value,
        onGranted: function () {
          finish("log_turn_reward_claim_generic", { kind: window.I18N.t("turn_reward_kind_consumable"), character: target.name });
        },
      });
      return;
    }
    if (reward.kind === "talisman") {
      minimizeSelf();
      openItemDrawModal("talisman", target.id, {
        onGranted: function () {
          finish("log_turn_reward_claim_generic", { kind: window.I18N.t("turn_reward_kind_talisman"), character: target.name });
        },
      });
      return;
    }
    if (reward.kind === "potentialPower") {
      minimizeSelf();
      var ppAttributeTag = reward.attributeTag ? window.PriTestFields.localizedText(reward.attributeTag) : null;
      window.PriTestNightPotentialPower.openPotentialPowerModal(target.id, reward.value, ppAttributeTag, function () {
        finish("log_turn_reward_claim_generic", { kind: window.I18N.t("turn_reward_kind_potentialPower"), character: target.name });
      });
      return;
    }
    if (reward.kind === "weaponSkillReroll") {
      minimizeSelf();
      window.PriTestNightCore.openWeaponSkillRerollModal(target.id, function () {
        finish("log_turn_reward_claim_generic", { kind: window.I18N.t("turn_reward_kind_weaponSkillReroll"), character: target.name });
      });
      return;
    }
  }
```

へ置き換える。

- [ ] **Step 3: `pushTurnRewards`ヘルパーを新設**

`static_src/night.js:8443`の`handleTurnRewardAdd`関数の直後（閉じ`}`の次の空行）に以下を追加する：

```js
  // 他モジュール（night_floor_breakthrough.js等）が組み立てた獎勵清單アイテムを一括pushする。
  // 個々の項目の形は既存のGM手動追加（handleTurnRewardAdd）と同一（{id,kind,targetCharacterId,value,claimed,...}）。
  function pushTurnRewards(rewardObjs) {
    if (!rewardObjs || !rewardObjs.length) return;
    rewardObjs.forEach(function (r) {
      state.turnRewards.push(r);
    });
    saveState();
    var modal = document.getElementById("turn-reward-modal");
    if (modal && !modal.hidden) renderTurnRewardModal();
  }
```

- [ ] **Step 4: `window.PriTestNightCore`へ新規APIをエクスポート**

`static_src/night.js:11115`の

```js
    restoreTurnRewardModalIfMinimized: restoreTurnRewardModalIfMinimized,
```

の直後に以下を追加する：

```js
    pushTurnRewards: pushTurnRewards,
    TURN_REWARD_ANY_TARGET_VALUE: TURN_REWARD_ANY_TARGET_VALUE,
    TURN_REWARD_SHARED_TARGET_VALUE: TURN_REWARD_SHARED_TARGET_VALUE,
```

- [ ] **Step 5: i18nキー追加**

`site_src/i18n_data_zh.py:1014`の`"turn_reward_kind_buriedTreasure": "埋藏的寶物（1D×3自動抽選）",`の直後に：

```python
    "turn_reward_kind_weaponSkillReroll": "戰技的鍛冶台",
```

`site_src/i18n_data_ja.py:1014`の同キーの直後に：

```python
    "turn_reward_kind_weaponSkillReroll": "戦技の鍛冶台",
```

`site_src/i18n_data_en.py:1014`の同キーの直後に：

```python
    "turn_reward_kind_weaponSkillReroll": "Weapon Skill Reroll",
```

- [ ] **Step 6: 構文チェックとビルド**

```bash
node --check static_src/night.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 7: Commit**

```bash
git add static_src/night.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(night): 獎勵清單にweaponSkillRerollと武器/潛在之力の追加フィールドを追加"
```

---

### Task 2: フロア獎勵→獎勵清單の自動push統合（`night_floor_breakthrough.js`）

**Files:**
- Modify: `static_src/night_floor_breakthrough.js:75-81`（`openFloorRewardModal`）
- Modify: `static_src/night_floor_breakthrough.js:143-183`（`floorHasAnyReward`の直後〜`appendRuneGrantRowIfDetected`を新ヘルパー群に置き換え）
- Modify: `static_src/night_floor_breakthrough.js:194`（`renderFloorRewardOption`冒頭に早期returnガード追加）
- Delete: `static_src/night_floor_breakthrough.js`内の`renderFloorRewardOption`の`rune`/`chaliceBonus`/`consumable`/`talisman`/`weaponStar`/`stoneswordKey`/`smithingStone`（2箇所）/`potentialPower`/`weaponSkillReroll`分岐（旧297-653行相当）
- Modify: `static_src/night_floor_breakthrough.js:839-866`（`renderFloorRewardSection`）
- Modify: `static_src/night_floor_breakthrough.js:1316-1330`付近（`window.PriTestNightFloorBreakthrough`エクスポート）
- Modify: `site_src/i18n_data_zh.py`/`_ja.py`/`_en.py`（`log_floor_reward_auto_pushed`追加）

**Interfaces:**
- Consumes: Task 1の`window.PriTestNightCore.pushTurnRewards`/`TURN_REWARD_ANY_TARGET_VALUE`/`TURN_REWARD_SHARED_TARGET_VALUE`。
- Produces: `window.PriTestNightFloorBreakthrough.isLootRewardKind(kind)`、`.floorHasJudgmentReward(floor)`、`.floorAutoLootTurnRewards(floor, entered)` — Task 3で`tieredChoice`/`diceHandChoice`の確定後の再帰pushに使用。

- [ ] **Step 1: 分類・変換ヘルパーを新設**

`static_src/night_floor_breakthrough.js:146`（`floorHasAnyReward`関数の閉じ`}`の直後）に以下を追加する：

```js
  // 「戦利品」種別：GMの分岐選択を伴わず、確定した瞬間にそのまま獎勵清單
  // （state.turnRewards）へpushしてよい種類。残り（hpDamage/tieredChoice/diceHandChoice/
  // bargainReveal/note）はGM判断が必要なため、従来通りfloor-reward-modal内で解決する。
  var LOOT_REWARD_KINDS = [
    "rune",
    "weaponStar",
    "consumable",
    "talisman",
    "potentialPower",
    "stoneswordKey",
    "smithingStone",
    "chaliceBonus",
    "weaponSkillReroll",
  ];
  function isLootRewardKind(kind) {
    return LOOT_REWARD_KINDS.indexOf(kind) !== -1;
  }

  function floorHasJudgmentReward(floor) {
    var reward = (floor && floor.reward) || [];
    return reward.some(function (entry) {
      return !isLootRewardKind(entry.kind);
    });
  }

  var turnRewardIdCounter = 0;
  function makeTurnRewardId(suffix) {
    turnRewardIdCounter++;
    return "tr" + Date.now() + "_" + turnRewardIdCounter + "_" + suffix;
  }

  // floor.rewardの「戦利品」エントリ1件を、state.turnRewardsへpushする1件以上の
  // オブジェクトへ変換する（実際のpushはfloorAutoLootTurnRewards/pushTurnRewardsが行う）。
  function floorRewardEntryToTurnRewards(entry, entered, idSuffix) {
    var Core = window.PriTestNightCore;
    if (entry.kind === "rune" || entry.kind === "chaliceBonus") {
      return [
        {
          id: makeTurnRewardId(idSuffix),
          kind: entry.kind,
          targetCharacterId: Core.TURN_REWARD_SHARED_TARGET_VALUE,
          value: entry.value,
          claimed: false,
        },
      ];
    }
    if (entry.kind === "stoneswordKey" || entry.kind === "smithingStone") {
      var total = entry.perParty ? entry.value * entered.length : entry.value;
      return [{ id: makeTurnRewardId(idSuffix), kind: entry.kind, targetCharacterId: null, value: total, claimed: false }];
    }
    if (entry.kind === "potentialPower" || entry.kind === "weaponSkillReroll") {
      return entered.map(function (c, i) {
        return {
          id: makeTurnRewardId(idSuffix + "_" + i),
          kind: entry.kind,
          targetCharacterId: c.id,
          value: entry.value || 1,
          attributeTag: entry.attributeTag || null,
          claimed: false,
        };
      });
    }
    if (entry.kind === "weaponStar") {
      return [
        {
          id: makeTurnRewardId(idSuffix),
          kind: "weapon",
          targetCharacterId: Core.TURN_REWARD_ANY_TARGET_VALUE,
          value: entry.value,
          categoryId: entry.categoryId || null,
          attributeTag: entry.attributeTag || null,
          claimed: false,
        },
      ];
    }
    if (entry.kind === "consumable" || entry.kind === "talisman") {
      return [
        {
          id: makeTurnRewardId(idSuffix),
          kind: entry.kind,
          targetCharacterId: Core.TURN_REWARD_ANY_TARGET_VALUE,
          value: entry.value || 1,
          claimed: false,
        },
      ];
    }
    return [];
  }

  // フロア終端で確定している「戦利品」を一括で獎勵清單へ積む配列を組み立てる。reward配列に
  // rune種別が無いのに本文に「擊破盧恩：N」がある（規則書の記述とデータのズレ）場合は、
  // フォールバック検出分もあわせて積む。二重pushは__rewardKeyベースのフラグで防ぐ。
  function floorAutoLootTurnRewards(floor, entered) {
    var Core = window.PriTestNightCore;
    var reward = (floor && floor.reward) || [];
    var results = [];
    var hasRuneReward = reward.some(function (entry) {
      return entry.kind === "rune";
    });
    reward.forEach(function (entry, entryIndex) {
      if (!isLootRewardKind(entry.kind)) return;
      var pushKey = floor.__rewardKey ? floor.__rewardKey + "_pushed_" + entryIndex : null;
      if (pushKey && Core.state.floorRewardObtained && Core.state.floorRewardObtained[pushKey]) return;
      var objs = floorRewardEntryToTurnRewards(entry, entered, (floor.__rewardKey || "floor") + "_" + entryIndex);
      if (!objs.length) return;
      if (pushKey) {
        if (!Core.state.floorRewardObtained) Core.state.floorRewardObtained = {};
        Core.state.floorRewardObtained[pushKey] = true;
      }
      results = results.concat(objs);
    });
    if (!hasRuneReward) {
      var detectedAmount = parseRuneAmountFromText(floorLineText(floor));
      if (detectedAmount) {
        var detectedKey = floor.__rewardKey ? floor.__rewardKey + "_detectedRune_pushed" : null;
        var alreadyDetected = !!(detectedKey && Core.state.floorRewardObtained && Core.state.floorRewardObtained[detectedKey]);
        if (!alreadyDetected) {
          if (detectedKey) {
            if (!Core.state.floorRewardObtained) Core.state.floorRewardObtained = {};
            Core.state.floorRewardObtained[detectedKey] = true;
          }
          results.push({
            id: makeTurnRewardId((floor.__rewardKey || "floor") + "_detectedRune"),
            kind: "rune",
            targetCharacterId: Core.TURN_REWARD_SHARED_TARGET_VALUE,
            value: detectedAmount,
            claimed: false,
          });
        }
      }
    }
    return results;
  }
```

- [ ] **Step 2: 旧`appendRuneGrantRowIfDetected`を削除**

`static_src/night_floor_breakthrough.js`から、Step 1で追加したブロックの直後に元々あった以下の関数全体（`検出した盧恩獎勵を...`というコメント込み、旧148-183行相当）を削除する：

```js
  // 検出した盧恩獎勵を、対象コンテナへ「數値入力（GMが微調整可）＋獲得ボタン」の1行として
  // 追加する。stateKeyを渡すとmarkFloorRewardObtainedと同じ仕組みで一度きりの獲得に制限する。
  function appendRuneGrantRowIfDetected(container, text, stateKey) {
    var amount = parseRuneAmountFromText(text);
    if (!amount) return;
    var already = !!(stateKey && window.PriTestNightCore.state.floorRewardObtained && window.PriTestNightCore.state.floorRewardObtained[stateKey]);
    var row = document.createElement("div");
    row.className = "wb-row rune-grant-row";
    var label = document.createElement("span");
    label.className = "threat-ref-body";
    label.textContent = window.I18N.t("rune_grant_detected_label");
    row.appendChild(label);
    var input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.value = String(amount);
    if (already) input.disabled = true;
    row.appendChild(input);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "primary-btn";
    btn.textContent = window.I18N.t("rune_grant_button");
    if (already) {
      btn.disabled = true;
      btn.classList.add("field-reward-obtained");
    }
    btn.addEventListener("click", function () {
      var value = parseInt(input.value, 10) || 0;
      if (value <= 0) return;
      grantRuneToAllEntered(value);
      input.disabled = true;
      window.PriTestNightCore.markFloorRewardObtained(btn, null, stateKey);
    });
    row.appendChild(btn);
    container.appendChild(row);
  }
```

（`parseRuneAmountFromText`/`RUNE_AMOUNT_RE`/`floorLineText`/`grantRuneToAllEntered`は他所（`floorHasAnyReward`・チャットの`/rune`コマンド）から引き続き使われるため削除しない。）

- [ ] **Step 3: `renderFloorRewardOption`に早期returnガードを追加し、戦利品分岐を削除**

`renderFloorRewardOption`関数の冒頭

```js
  function renderFloorRewardOption(container, entry, entered, floorKey, entryIndex) {
    var Consumables = window.PriTestConsumables;
```

を

```js
  function renderFloorRewardOption(container, entry, entered, floorKey, entryIndex) {
    // 戦利品はopenFloorRewardModal内で自動的に獎勵清單へpush済みのため、ここには表示しない。
    if (isLootRewardKind(entry.kind)) return;
    var Consumables = window.PriTestConsumables;
```

へ変更する。続けて、同関数内の以下の`if (entry.kind === "...")`ブロックを**全て削除**する（`kind`が`rune`/`chaliceBonus`/`consumable`/`talisman`/`weaponStar`/`stoneswordKey`/`smithingStone`（`perPerson`有無の2ブロック）/`potentialPower`/`weaponSkillReroll`のもの。それぞれ`if (entry.kind === "X") { ... return; }`の形で、直前のガードにより実行到達しなくなったコード）。`hpDamage`/`tieredChoice`/`diceHandChoice`/`bargainReveal`/`note`の分岐と、共通で使われる`makeTargetSelect`/`noteText`はそのまま残す。`resolvedAttributeTag`変数（`weaponStar`/`potentialPower`削除後どこからも参照されなくなる）も削除する。

削除後、関数は「冒頭ガード → `Consumables`/`noteText`/`makeTargetSelect`定義 → `hpDamage` → `tieredChoice` → `diceHandChoice` → `bargainReveal` → `note`」の順になる。

- [ ] **Step 4: `renderFloorRewardSection`を簡略化**

```js
  function renderFloorRewardSection(container, floor) {
    container.innerHTML = "";
    var reward = (floor && floor.reward) || [];
    // 本文（lines[]）に「擊破盧恩：N」の記述があるのに、reward配列側にrune種別の項目が
    // 用意されていない（＝規則書の記述とボタンがズレている）場合を検出する。reward配列自体が
    // 空のフロアでも、この検出だけで報酬欄を出せるようにする（#9）。
    var hasRuneReward = reward.some(function (entry) {
      return entry.kind === "rune";
    });
    var detectedRuneAmount = !hasRuneReward ? parseRuneAmountFromText(floorLineText(floor)) : 0;
    if (!reward.length && !detectedRuneAmount) return;
    var entered = window.PriTestNightCore.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    if (!entered.length) return;

    var title = document.createElement("h5");
    title.textContent = window.I18N.t("floor_reward_title");
    container.appendChild(title);

    reward.forEach(function (entry, entryIndex) {
      renderFloorRewardOption(container, entry, entered, floor.__rewardKey, entryIndex);
    });
    if (detectedRuneAmount) {
      var detectedKey = floor.__rewardKey ? floor.__rewardKey + "_detectedRune" : null;
      appendRuneGrantRowIfDetected(container, "擊破盧恩：" + detectedRuneAmount, detectedKey);
    }
  }
```

を

```js
  function renderFloorRewardSection(container, floor) {
    container.innerHTML = "";
    if (!floorHasJudgmentReward(floor)) return;
    var entered = window.PriTestNightCore.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    if (!entered.length) return;

    var title = document.createElement("h5");
    title.textContent = window.I18N.t("floor_reward_title");
    container.appendChild(title);

    ((floor && floor.reward) || []).forEach(function (entry, entryIndex) {
      renderFloorRewardOption(container, entry, entered, floor.__rewardKey, entryIndex);
    });
  }
```

へ置き換える（`renderFloorRewardOption`は戦利品を自前でスキップするため、GM判断エントリだけが実際に描画される）。

- [ ] **Step 5: `openFloorRewardModal`で戦利品を自動push**

```js
  function openFloorRewardModal(floor) {
    floorRewardModalFloor = floor;
    document.getElementById("rulebook-modal").hidden = true;
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
    document.getElementById("rulebook-modal").hidden = true;
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
    if (!floorHasJudgmentReward(floor)) return;
    floorRewardModalFloor = floor;
    document.getElementById("floor-reward-modal").hidden = false;
    document.getElementById("btn-floor-reward-restore").hidden = true;
    renderFloorRewardSection(document.getElementById("floor-reward-modal-content"), floor);
  }
```

へ置き換える（GM判断エントリが無ければモーダル自体を開かない＝GMは何もクリックしなくてよい）。

- [ ] **Step 6: エクスポートを更新**

`static_src/night_floor_breakthrough.js`の`window.PriTestNightFloorBreakthrough`定義から

```js
    appendRuneGrantRowIfDetected: appendRuneGrantRowIfDetected,
```

を削除し、代わりに以下を追加する：

```js
    isLootRewardKind: isLootRewardKind,
    floorHasJudgmentReward: floorHasJudgmentReward,
    floorRewardEntryToTurnRewards: floorRewardEntryToTurnRewards,
    floorAutoLootTurnRewards: floorAutoLootTurnRewards,
```

- [ ] **Step 7: i18nキー追加**

`site_src/i18n_data_zh.py`の`"log_floor_reward_rune": ...`の直後に：

```python
    "log_floor_reward_auto_pushed": "已自動將以下獎勵加入獎勵清單：{items}",
```

`site_src/i18n_data_ja.py`の同キー直後に：

```python
    "log_floor_reward_auto_pushed": "以下の獎勵を自動的に獎勵清單へ追加しました：{items}",
```

`site_src/i18n_data_en.py`の同キー直後に：

```python
    "log_floor_reward_auto_pushed": "Automatically added the following to the reward list: {items}",
```

- [ ] **Step 8: 構文チェックとビルド**

```bash
node --check static_src/night_floor_breakthrough.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 9: Playwright動作確認（使い捨てスクリプト、コミットしない）**

`admin`から`storageMode:"local"`でゲームを作成し、劇本を`tricephalos`に設定して`night/index.html?game=<id>`を開く。キャラクターを1体roster登録して`entered`をtrueにし、`state.slots`の該当板塊を`a_start`（出發地點）へ合わせた上で、`window.PriTestNightFloorBreakthrough.openFloorRewardModal`をロースター経由の実データ（`window.PriTestFields.list()`から`a_start`の`branches[0].floors[0]`、reward配列が`weaponStar`×2のみ＝戦利品のみ）で直接呼び出し、以下を確認する：

```js
// ブラウザコンテキストで実行
var floor = window.PriTestFields.list().filter(function (f) { return f.id === "a_start"; })[0].branches[0].floors[0];
floor.__rewardKey = "a_start_0_0"; // night_rulebook.jsが通常付与するキーを模擬
window.PriTestNightFloorBreakthrough.openFloorRewardModal(floor);
var pushed = window.PriTestNightCore.state.turnRewards.filter(function (r) { return r.kind === "weapon"; });
console.log("pushed weapon rewards:", pushed.length); // 期待値: 2
console.log("floor-reward-modal hidden:", document.getElementById("floor-reward-modal").hidden); // 期待値: true（戦利品のみなので開かない）
```

Expected: `pushed weapon rewards: 2`、`floor-reward-modal hidden: true`。

- [ ] **Step 10: Commit**

```bash
git add static_src/night_floor_breakthrough.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(night): フロア戦利品獎勵を獎勵清單へ自動push、GM判断系のみモーダル表示に変更"
```

---

### Task 3: `diceHandChoice`専用抽選視窗

**Files:**
- Modify: `site_src/night_page.py`（`item-draw-modal`の直後に`dice-hand-draw-modal`を追加）
- Modify: `static_src/night_floor_breakthrough.js`（`diceHandChoice`分岐を専用モーダル起動に変更、判定結果の`rewards[]`をTask2のヘルパーでpush）
- Modify: `static_src/night.js`（新モーダルの開閉/縮小/復元イベントリスナー登録）
- Modify: `site_src/i18n_data_zh.py`/`_ja.py`/`_en.py`（新規UI文言）

**Interfaces:**
- Consumes: Task 2の`isLootRewardKind`/`floorRewardEntryToTurnRewards`、`window.PriTestNightCore.pushTurnRewards`。
- Produces: `window.PriTestNightFloorBreakthrough.openDiceHandDrawModal(entry, entered)`（`entry`は`floor.reward`内の`diceHandChoice`エントリ）。

- [ ] **Step 1: モーダルHTMLを追加**

`site_src/night_page.py`の`item-draw-modal`ブロック（`<button id="btn-item-draw-modal-restore" ...></button>`の行）の直後に以下を追加する：

```html
    <div id="dice-hand-draw-modal" class="modal" hidden>
      <div class="modal-box combat-modal-box">
        <h2 data-i18n="dice_hand_draw_modal_title"></h2>
        <p class="threat-ref-body" id="dice-hand-draw-label"></p>
        <div id="dice-hand-draw-select-group" class="dice-hand-select-group"></div>
        <div class="actions">
          <button id="btn-dice-hand-draw-random" type="button" data-i18n="dice_hand_draw_random_button"></button>
          <button id="btn-dice-hand-draw-judge" type="button" class="primary-btn" data-i18n="floor_reward_dice_hand_judge_button"></button>
        </div>
        <p id="dice-hand-draw-result" class="threat-ref-body"></p>
        <div id="dice-hand-draw-result-list"></div>
        <div class="actions">
          <button id="btn-dice-hand-draw-minimize" type="button" data-i18n="potential_power_minimize_button"></button>
          <button id="btn-dice-hand-draw-close" type="button" class="danger-btn" data-i18n="leave_button"></button>
        </div>
      </div>
    </div>
    <button id="btn-dice-hand-draw-restore" type="button" class="potential-power-restore-btn" data-i18n="dice_hand_draw_restore_button" hidden></button>
```

- [ ] **Step 2: `diceHandChoice`を専用モーダル起動へ置き換え**

`static_src/night_floor_breakthrough.js`の`renderFloorRewardOption`内、`if (entry.kind === "diceHandChoice") { ... }`ブロック全体（12個のセレクタ・判定ボタン・役判定ロジックをインライン描画していた既存コード）を、以下へ置き換える：

```js
    if (entry.kind === "diceHandChoice") {
      var diceHandRow = document.createElement("div");
      diceHandRow.className = "wb-row";
      var diceHandBtn = document.createElement("button");
      diceHandBtn.type = "button";
      diceHandBtn.className = "primary-btn";
      diceHandBtn.textContent = window.I18N.t("floor_reward_dice_hand_label", { count: entry.diceCount || 12 }) + noteText;
      diceHandBtn.addEventListener("click", function () {
        minimizeFloorRewardModal();
        openDiceHandDrawModal(entry, entered);
      });
      diceHandRow.appendChild(diceHandBtn);
      container.appendChild(diceHandRow);
      return;
    }
```

同ファイル内に新規関数`openDiceHandDrawModal`/`closeDiceHandDrawModal`/`minimizeDiceHandDrawModal`/`restoreDiceHandDrawModal`を、`openFloorRewardModal`と同じ並びの箇所（`closeFloorRewardModal`/`minimizeFloorRewardModal`/`restoreFloorRewardModal`定義の直後）に追加する：

```js
  var diceHandDrawEntry = null; // { entry, entered } — 縮小/復元のために保持
  var diceHandDrawSelects = [];

  function buildDiceHandDrawSelects(diceCount) {
    var group = document.getElementById("dice-hand-draw-select-group");
    group.innerHTML = "";
    diceHandDrawSelects = [];
    for (var i = 0; i < diceCount; i++) {
      var dieSelect = document.createElement("select");
      dieSelect.className = "dice-hand-die-select";
      [1, 2, 3, 4, 5, 6].forEach(function (v) {
        var opt = document.createElement("option");
        opt.value = String(v);
        opt.textContent = String(v);
        dieSelect.appendChild(opt);
      });
      diceHandDrawSelects.push(dieSelect);
      group.appendChild(dieSelect);
    }
  }

  function judgeDiceHand(entry, values) {
    var counts = [0, 0, 0, 0, 0, 0, 0];
    values.forEach(function (v) {
      counts[v]++;
    });
    var maxCount = Math.max(counts[1], counts[2], counts[3], counts[4], counts[5], counts[6]);
    var lowCount = counts[1] + counts[2] + counts[3];
    var highCount = counts[4] + counts[5] + counts[6];
    var isStraight = counts[1] > 0 && counts[2] > 0 && counts[3] > 0 && counts[4] > 0 && counts[5] > 0 && counts[6] > 0;
    var matchedId = null;
    if (maxCount >= 7) matchedId = "sevenDice";
    else if (lowCount === 0) matchedId = "large";
    else if (highCount === 0) matchedId = "small";
    else if (isStraight) matchedId = "straight";
    return (entry.hands || []).filter(function (h) {
      return h.id === matchedId;
    })[0] || null;
  }

  function openDiceHandDrawModal(entry, entered) {
    diceHandDrawEntry = { entry: entry, entered: entered };
    var diceCount = entry.diceCount || 12;
    document.getElementById("dice-hand-draw-label").textContent = window.I18N.t("floor_reward_dice_hand_label", { count: diceCount });
    buildDiceHandDrawSelects(diceCount);
    document.getElementById("dice-hand-draw-result").textContent = "";
    document.getElementById("dice-hand-draw-result-list").innerHTML = "";
    document.getElementById("btn-dice-hand-draw-judge").disabled = false;
    document.getElementById("dice-hand-draw-modal").hidden = false;
    document.getElementById("btn-dice-hand-draw-restore").hidden = true;
  }

  function closeDiceHandDrawModal() {
    document.getElementById("dice-hand-draw-modal").hidden = true;
    document.getElementById("btn-dice-hand-draw-restore").hidden = true;
    diceHandDrawEntry = null;
    restoreFloorRewardModalIfMinimized();
  }

  function minimizeDiceHandDrawModal() {
    document.getElementById("dice-hand-draw-modal").hidden = true;
    document.getElementById("btn-dice-hand-draw-restore").hidden = false;
  }

  function restoreDiceHandDrawModal() {
    document.getElementById("btn-dice-hand-draw-restore").hidden = true;
    document.getElementById("dice-hand-draw-modal").hidden = false;
  }

  function handleDiceHandDrawRandom() {
    diceHandDrawSelects.forEach(function (s) {
      s.value = String(1 + Math.floor(Math.random() * 6));
    });
  }

  function handleDiceHandDrawJudge() {
    if (!diceHandDrawEntry) return;
    var values = diceHandDrawSelects.map(function (s) {
      return parseInt(s.value, 10);
    });
    var matchedHand = judgeDiceHand(diceHandDrawEntry.entry, values);
    diceHandDrawSelects.forEach(function (s) {
      s.disabled = true;
    });
    document.getElementById("btn-dice-hand-draw-judge").disabled = true;
    var handLabelText = matchedHand ? window.PriTestFields.localizedText(matchedHand.label) : window.I18N.t("floor_reward_dice_hand_result_none");
    document.getElementById("dice-hand-draw-result").textContent = window.I18N.t("floor_reward_dice_hand_result", { dice: values.join("、"), hand: handLabelText });
    window.PriTestNightLog("log_floor_reward_dice_hand", { dice: values.join("、"), hand: handLabelText });
    if (matchedHand) {
      var pushed = [];
      (matchedHand.rewards || []).forEach(function (sub, subIndex) {
        pushed = pushed.concat(floorRewardEntryToTurnRewards(sub, diceHandDrawEntry.entered, "diceHand_" + Date.now() + "_" + subIndex));
      });
      if (pushed.length) {
        window.PriTestNightCore.pushTurnRewards(pushed);
        window.PriTestNightLog("log_floor_reward_auto_pushed", {
          items: pushed
            .map(function (r) {
              return window.I18N.t("turn_reward_kind_" + r.kind);
            })
            .join("、"),
        });
      }
      var resultList = document.getElementById("dice-hand-draw-result-list");
      var resultP = document.createElement("p");
      resultP.className = "threat-ref-body";
      resultP.textContent = window.I18N.t("log_floor_reward_auto_pushed", {
        items: pushed
          .map(function (r) {
            return window.I18N.t("turn_reward_kind_" + r.kind);
          })
          .join("、"),
      });
      resultList.appendChild(resultP);
    }
  }
```

`renderFloorRewardOption`内で参照している`minimizeFloorRewardModal`はモジュール内で既存関数、新規追加した`closeDiceHandDrawModal`が呼ぶ`restoreFloorRewardModalIfMinimized`は既存の`restoreFloorRewardModal`をラップする新規1行関数として追加する（`floor-reward-modal`が縮小中だった場合のみ復元、既存の`restoreTurnRewardModalIfMinimized`と同じパターン）：

```js
  function restoreFloorRewardModalIfMinimized() {
    var restoreBtn = document.getElementById("btn-floor-reward-restore");
    if (restoreBtn && !restoreBtn.hidden) restoreFloorRewardModal();
  }
```

- [ ] **Step 3: `window.PriTestNightFloorBreakthrough`エクスポートに追加**

```js
    openDiceHandDrawModal: openDiceHandDrawModal,
    closeDiceHandDrawModal: closeDiceHandDrawModal,
    minimizeDiceHandDrawModal: minimizeDiceHandDrawModal,
    restoreDiceHandDrawModal: restoreDiceHandDrawModal,
    handleDiceHandDrawRandom: handleDiceHandDrawRandom,
    handleDiceHandDrawJudge: handleDiceHandDrawJudge,
```

- [ ] **Step 4: イベントリスナー登録**

`static_src/night.js`のDOMContentLoadedハンドラ内、`document.getElementById("btn-item-draw-modal-close").addEventListener(...)`の付近に以下を追加する：

```js
    document.getElementById("btn-dice-hand-draw-random").addEventListener("click", window.PriTestNightFloorBreakthrough.handleDiceHandDrawRandom);
    document.getElementById("btn-dice-hand-draw-judge").addEventListener("click", window.PriTestNightFloorBreakthrough.handleDiceHandDrawJudge);
    document.getElementById("btn-dice-hand-draw-minimize").addEventListener("click", window.PriTestNightFloorBreakthrough.minimizeDiceHandDrawModal);
    document.getElementById("btn-dice-hand-draw-close").addEventListener("click", window.PriTestNightFloorBreakthrough.closeDiceHandDrawModal);
    document.getElementById("btn-dice-hand-draw-restore").addEventListener("click", window.PriTestNightFloorBreakthrough.restoreDiceHandDrawModal);
```

- [ ] **Step 5: i18nキー追加**

`site_src/i18n_data_zh.py`/`_ja.py`/`_en.py`それぞれに以下を追加する（`floor_reward_dice_hand_judge_button`等の既存キーの近くに配置）：

zh:
```python
    "dice_hand_draw_modal_title": "役判定式獎勵",
    "dice_hand_draw_random_button": "隨機擲骰",
    "dice_hand_draw_restore_button": "役判定進行中",
```

ja:
```python
    "dice_hand_draw_modal_title": "役判定式報酬",
    "dice_hand_draw_random_button": "隨機擲骰",
    "dice_hand_draw_restore_button": "役判定進行中",
```

en:
```python
    "dice_hand_draw_modal_title": "Dice Hand Reward",
    "dice_hand_draw_random_button": "Random Roll",
    "dice_hand_draw_restore_button": "Dice Hand In Progress",
```

- [ ] **Step 6: 構文チェックとビルド**

```bash
node --check static_src/night_floor_breakthrough.js
node --check static_src/night.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 7: Playwright動作確認（使い捨てスクリプト）**

`fields_data_4.js`の`diceHandChoice`を含むフロア（魔術師塔、`static_src/fields_data_4.js:128`付近）を実際に開き、`#dice-hand-draw-modal`が表示される→「隨機擲骰」→「判定」→`window.PriTestNightCore.state.turnRewards`に該当役の`rewards[]`分だけ新規項目が追加されることを確認する。

- [ ] **Step 8: Commit**

```bash
git add site_src/night_page.py static_src/night_floor_breakthrough.js static_src/night.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(night): diceHandChoiceを専用抽選視窗として切り出し、判定結果を獎勵清單へ自動push"
```

---

### Task 4: 劇本1（tricephalos）データ監査ツールの作成と実行

**Files:**
- Create: `<scratchpad>/audit_tricephalos_rewards.js`（コミットしない、使い捨て監査スクリプト）

**Interfaces:**
- Produces: 標準出力へ「劇本1で実際に使われる分岐のうち、本文に撃破盧恩/獲得の記述があるがreward配列に対応エントリが無いフロア」の一覧（`card.id` / `branch.name` / `floor.label` / 検出したテキスト）。Task 5はこの出力を入力として使う。

- [ ] **Step 1: 監査スクリプトを作成**

```js
// audit_tricephalos_rewards.js — 劇本1(tricephalos)の全フロアについて、本文の
// 「擊破盧恩／獲得」記述とreward配列の突き合わせギャップを洗い出す使い捨て監査スクリプト。
// 実行: node audit_tricephalos_rewards.js  （PriTestルート直下から相対パスでstatic_srcを読む）
var fs = require("fs");
var path = require("path");
var root = path.resolve(__dirname, "../../.."); // このファイルをscratchpad直下に置く前提のパス調整は実行時に確認・修正する

global.window = global;
global.window.PriTestCharacterDrawer = {};
["fields_data_1.js", "fields_data_2.js", "fields_data_3.js", "fields_data_4.js", "fields.js"].forEach(function (f) {
  var code = fs.readFileSync(path.join(root, "static_src", f), "utf8");
  // eslint-disable-next-line no-eval
  eval(code);
});
var scenariosCode = fs.readFileSync(path.join(root, "static_src", "scenarios.js"), "utf8");
// scenarios.jsはwindow.PriTestScenarios名前空間へ登録するIIFE、同様にevalする。
eval(scenariosCode);

var Fields = window.PriTestFields;
var Scenarios = window.PriTestScenarios;
var scenario = Scenarios.list().filter(function (s) {
  return s.id === "tricephalos";
})[0];

function localizedText(v) {
  return v && (v.ja || v.zh) ? v.ja || v.zh : "";
}

function findVarianceBranchForScenario1(fieldEntry) {
  if (!fieldEntry.varianceTable) return fieldEntry.branches;
  var row = fieldEntry.varianceTable.rows.filter(function (r) {
    return localizedText(r[0]).split(/[,、]/).indexOf("1") !== -1 || localizedText(r[0]) === "1";
  })[0];
  if (!row) return fieldEntry.branches; // 分岐なし/該当行なしはそのまま全branchesを対象にする
  var branchName = localizedText(row[row.length - 1]).split(/[／\/]/)[0];
  return fieldEntry.branches.filter(function (b) {
    return localizedText(b.name).indexOf(branchName) !== -1;
  });
}

var RUNE_RE = /(?:擊破盧恩|撃破ルーン)[：:]\s*([+＋]?\d+)/g;
function detectedRuneAmount(floor) {
  var text = (floor.lines || [])
    .map(function (l) {
      return localizedText(l.text);
    })
    .join("\n");
  var total = 0;
  var m;
  var re = new RegExp(RUNE_RE.source, "g");
  while ((m = re.exec(text))) total += parseInt(m[1].replace(/[＋+]/g, ""), 10) || 0;
  return total;
}

var cardPositions = ["start"].concat(
  scenario.day1.map(function (p) { return p; }),
  scenario.day2.map(function (p) { return p; }),
  ["end"]
);

var gaps = [];
Fields.list().forEach(function (fieldEntry) {
  var branches = findVarianceBranchForScenario1(fieldEntry);
  branches.forEach(function (branch) {
    (branch.floors || []).forEach(function (floor) {
      var hasRuneReward = (floor.reward || []).some(function (e) {
        return e.kind === "rune";
      });
      var amount = detectedRuneAmount(floor);
      if (amount && !hasRuneReward) {
        gaps.push({
          card: fieldEntry.id,
          branch: localizedText(branch.name),
          floor: localizedText(floor.label),
          detectedAmount: amount,
        });
      }
    });
  });
});

console.log(JSON.stringify(gaps, null, 2));
console.log("Total gaps:", gaps.length);
```

- [ ] **Step 2: 実行**

```bash
node "C:\Users\gsha\AppData\Local\Temp\claude\D--work-PriTest-PriTest\31b9c8e4-236a-4c5f-94bd-08d2083ddc98\scratchpad\audit_tricephalos_rewards.js"
```

Expected: エラーなく終了し、`gaps`のJSON配列（0件の可能性も含む）と`Total gaps: N`が出力される。`root`のパス解決に失敗する場合は、スクリプト冒頭の`path.resolve(__dirname, ...)`をリポジトリルートの絶対パスへ直接書き換えて再実行する。

**Note:** `findVarianceBranchForScenario1`はカード名の部分一致というヒューリスティックであり、`varianceTable`の書式ゆれ（列の順序・スート表記等）によっては劇本1に該当しない分岐を拾う／逆に見落とす可能性がある。Step 2の出力をそのまま鵜呑みにせず、Task 5で1件ずつ`fields_data_*.js`の該当箇所を目視確認してから直す。

---

### Task 5: 監査で見つかったギャップの修正

**Files:**
- Modify: Task 4の出力に列挙された`card`に応じて`static_src/fields_data_1.js`〜`fields_data_4.js`のいずれか

**Interfaces:**
- Consumes: Task 4の`audit_tricephalos_rewards.js`実行結果（`gaps`配列）。

- [ ] **Step 1: 各ギャップについて該当フロアの`reward`配列に`rune`エントリを追記**

Task 4出力の各項目について、`card`/`branch`/`floor`を手がかりに該当する`fields_data_*.js`内の該当`floors[]`要素を特定し、既存パターン（例：`static_src/fields_data_1.js:928-932`の

```js
              reward: [
                { kind: "weaponStar", value: 1, categoryId: "sacred_seal", note: C("（行為判定成功時）", "（行為判定成功時）") },
                { kind: "hpDamage", value: 1, note: C("（行為判定失敗時・ランダム2回）", "（行為判定失敗時・隨機2次）") },
                { kind: "rune", value: 1, note: C("（行為判定失敗時）", "（行為判定失敗時）") },
              ],
```

のような形）に倣い、`{ kind: "rune", value: <detectedAmount>, note: C("（撃破ルーン）", "（擊破盧恩）") }`を`reward`配列へ追加する。値は本文中の実際の数値（Task 4の`detectedAmount`）と一致させる。

- [ ] **Step 2: 監査スクリプトを再実行しギャップ0件を確認**

```bash
node "C:\Users\gsha\AppData\Local\Temp\claude\D--work-PriTest-PriTest\31b9c8e4-236a-4c5f-94bd-08d2083ddc98\scratchpad\audit_tricephalos_rewards.js"
```

Expected: `Total gaps: 0`（劇本1に該当する分岐について）。

- [ ] **Step 3: 構文チェックとビルド**

```bash
node --check static_src/fields_data_1.js
node --check static_src/fields_data_2.js
node --check static_src/fields_data_3.js
node --check static_src/fields_data_4.js
py -3 generate.py
```

Expected: 全てエラーなく終了する。

- [ ] **Step 4: Commit**

```bash
git add static_src/fields_data_1.js static_src/fields_data_2.js static_src/fields_data_3.js static_src/fields_data_4.js
git commit -m "fix(fields): 劇本1(tricephalos)の該当分岐で本文とreward配列がズレていた撃破盧恩を補完"
```

---

### Task 6: 統合Playwright検証（雜兵戰鬥→獎勵清單自動投入のE2E確認）

**Files:**
- なし（検証のみ、コード変更なし）

- [ ] **Step 1: ビルドとローカルサーバー起動**

```bash
py -3 generate.py
python -m http.server 8000 --directory dist
```

- [ ] **Step 2: Playwright使い捨てスクリプトでE2E確認**

`admin/index.html`で`window.PriTestGames.create("audit-test", "tricephalos", "local")`によりゲームを作成し、`night/index.html?game=<id>`を開く。キャラクターを1体作成して`entered`をtrueにする。`state.slots`を`a_start`（出發地點、`♥`スート＝劇本1の「小野営地の君主軍」分岐）に合わせ、自動化GM（`state.gmFlowEnabled`）をONにして進度版を進め、「ザコ戦闘（撃破ルーン：1）」トリガーの[雜兵戰鬥]ボタンを押し、`Enemies.search`で追加された敵の全HP行を0にする（`window.PriTestNightCore.state.battle`を直接操作するか、戦闘modalから通常攻撃を繰り返す）。以下を確認する：

```js
// ブラウザコンテキストで、戦闘終了直後〜GM敘述の[領取獎勵]（floorEndゲート）クリック後に実行
var turnRewards = window.PriTestNightCore.state.turnRewards;
console.log("weapon rewards:", turnRewards.filter(function (r) { return r.kind === "weapon"; }).length); // 期待値: 2（武器:★1つ、射撃武器:★1つ）
console.log("floor-reward-modal opened:", !document.getElementById("floor-reward-modal").hidden); // 期待値: false
```

Expected: `weapon rewards: 2`、`floor-reward-modal opened: false`（戦利品のみのフロアなのでGMは獎勵清單を開くだけで済み、個別ボタン操作は不要）。獎勵清單（`#turn-reward-modal`）を開き、pushされた2件の武器項目それぞれで「獲得」ボタンを押すと武器抽選ウィザードが正しく開くことも確認する。

- [ ] **Step 3: 既存の主要フローに回帰が無いことを確認**

`hpDamage`/`bargainReveal`/`note`を含む既知のフロア（例：`static_src/fields_data_1.js:919-932`の「瓦礫の広間」）を開き、`floor-reward-modal`が引き続き表示され、`hpDamage`のHP適用ボタンが動作することを確認する。
