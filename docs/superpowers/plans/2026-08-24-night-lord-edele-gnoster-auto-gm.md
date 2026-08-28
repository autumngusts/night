# 夜之王エデレ／グノスター自動化GM構造化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 夜之王「エデレ」「グノスター」の `boss_auto_gm_data.js` 構造化データを新規追加し、既存の `enemy_auto_gm_data.js` 内4体（死儀礼の鳥・古龍・王族的幽鬼・ミミズ顔たち）の記述を規則書原文・使用者裁定と照合して修正する。この過程で `auto_gm.js`/`night.js` 側に4つの新しい汎用機構（加重乱戦ダメージ配分・savingThrowの対象絞り込みと属性/異常onFail対応・敵視最大エリア判定・複数回複数対象乱戦ダメージ）と、条件タグ `force_back_row_next_phase` の実行時適用、公開情報特殊能力の公開盤表示を追加する。

**Architecture:** 既存の加算的オーバーレイ設計（`enemy_auto_gm_data.js`/`boss_auto_gm_data.js`が読み取り専用の構造化データ、`auto_gm.js`が計算専用の純粋関数群、`night.js`側`handleAutoGmRollClick`が唯一のstate書き込み元）を崩さない。新しいtargetRule.kind・savingThrowフィールド・conditionsタグは既存のswitch/if-elseチェーンに追加するだけで、新しい特殊アーキテクチャは作らない。`static_src/private/main`ブランチ（リモート`private/main`）に既に試作されていたedele/gnosterの構造化データをベースラインとして採用し、その上に本セッション（`all-enemy`ブランチ、以下"our"）で確立された精緻化パターン（`elementAccum`/`ailmentAccum`固定値化、`force_back_row_next_phase`タグ）を適用し、さらに今回の新機構で自動化範囲を広げる。

**Tech Stack:** Vanilla ES5 JS（IIFE + `window.PriTest*`名前空間）。自動テストフレームワークなし——検証は`node --check`（構文）、`py -3 generate.py`（ビルド）、Playwrightの使い捨てスクリプト（コミットしない）。

## Global Constraints

- ビルドは`py -3 generate.py`（Windows）。`static_src/`を編集したら必ず再実行する。
- JSはES5のみ（`const`/`let`/アロー関数/テンプレートリテラル禁止、`var`と`function`式のみ）。既存コードのスタイルに合わせる。
- `■`は自動計算しない（CLAUDE.md §19）。ただし今回**唯一の例外**：`royal_wraith`出目6「死の叫び」の`HP損害:■■■`は、使用者の明示的裁定により「実際に描かれた■の個数（3）をリテラルな固定ダメージ値として採用する」（Task 11、この1箇所限定の裁定であり、他の■表記に一般適用しない）。
- `elementAccum`/`ailmentAccum`の「Xd」表記解釈：使用者裁定により、技能の本文側に別途「擲骰」等の追加指示が無い限り、`属性名:XD`は`属性名:X`の固定蓄積値と同じ意味として扱ってよい（Task 1でdocsに明記してから、Task 8/9の新規データで適用する。既存の`enemy_auto_gm_data.js`内で既に「Xdは属性ダイスのためGM手動」としている箇所への遡及適用は本Planのスコープ外）。
- `conditions`配列は元々コード内ドキュメント用タグであり実行時には一切読まれない（`night.js`/`night_gm_flow.js`grep確認済み、0件）。今回`force_back_row_next_phase`のみ実行時適用を追加する（Task 5）。他のconditionsタグ（`no_guard`、`enemy_hp_value_buff`等）は本Planでは実行時適用を追加せず、既存どおりコメント目的のみで据え置く。
- 各タスクの完了時に`node --check`対象ファイルと`py -3 generate.py`を実行し、エラーが無いことを確認してからコミットする。
- Playwright検証スクリプトは使い捨てで、リポジトリにコミットしない。Admin操作は`window.prompt`パスワード`night`のdialog処理が必須（CLAUDE.md §4.1）。

---

### Task 1: docs/enemy_damage_rules.md に「Xd固定蓄積値」解釈を補足

**Files:**
- Modify: `docs/enemy_damage_rules.md`（§1「ダメージ表記の基本文法」末尾、または§2直前に新設小節）

**Interfaces:**
- Consumes: なし（ドキュメントのみ）
- Produces: 以降のTaskが参照する解釈基準のドキュメント上の所在（`docs/enemy_damage_rules.md` §1.1）

- [ ] **Step 1: 該当箇所を確認**

`docs/enemy_damage_rules.md`の36行目付近（§1末尾、"### ダメージ分類と発生源"の前）を確認する。

- [ ] **Step 2: 新しい小節を追記**

36行目の直後（`### ダメージ分類と発生源`の手前）に以下を挿入する：

```markdown
### 1.1 「Xd」表記と固定蓄積値の同一視（使用者裁定、2026-08-24）

属性蓄積値／状態異常蓄積値の表記には`属性名:X`（固定値）と`属性名:XD`（ダイス指定）の
両方が現れるが、**技能の本文側に別途「◯◯個のダイスを振る」等の明示的な擲骰指示が無い限り、
両者は同じ「蓄積値X」を意味するものとして扱ってよい**（使用者裁定）。

- 例：「雷:2」と「雷:2D」は、技能本文が別途「振る」ことを指示していなければ、どちらも
  「雷の蓄積値を2与える」という同じ意味。
- 本裁定は、`elementAccum`/`ailmentAccum`として固定値で自動化してよい範囲を、従来の
  「Xの数字表記のみ」から「XD表記も含む」へ広げる。
- 適用範囲：本裁定は2026-08-24以降に新規追加・修正するデータ（本Planの`boss_auto_gm_data.js`
  edele/gnoster、および`enemy_auto_gm_data.js`の該当修正箇所）に適用する。それ以前から
  存在する「Xdは属性ダイスのためGM手動」というコメント付きの既存箇所への遡及適用は、
  今回のスコープ外（将来別Taskで検討）。
```

- [ ] **Step 3: 目次には追加不要（既存§1の子項目のため見出し番号のみ確認）**

`docs/enemy_damage_rules.md`冒頭の目次（12-22行目）はセクション単位のみなので変更不要。

- [ ] **Step 4: Commit**

```bash
git add docs/enemy_damage_rules.md
git commit -m "docs(enemy-damage): 補充「Xd蓄積表記=固定值X」的使用者裁定解釋"
```

---

### Task 2: auto_gm.js に新targetRule「加重PC全員対象」を実装

**Files:**
- Modify: `static_src/auto_gm.js`（`splitGroupShares`の直後に新関数を追加、`window.PriTestAutoGm`のexportに追加）
- Modify: `static_src/night.js:8929-8943`（`handleAutoGmRollClick`内、`targetRule`が`weightRule`を持つ場合の分岐）

**Interfaces:**
- Consumes: `AutoGm.resolveTargets`（既存、`static_src/auto_gm.js:253`）
- Produces: `AutoGm.resolveWeightedTargets(targetRule, battleState, rosterCount)` → `[{index, weight}]`、`AutoGm.splitGroupSharesWeighted(total, weightedTargets)` → `[share, ...]`（`weightedTargets`と同じ順序）

- [ ] **Step 1: `auto_gm.js`に加重解決ロジックを追加**

`static_src/auto_gm.js`の`splitGroupShares`関数（242-248行）の直後に挿入：

```js
  // 「乱戦ダメージはPC全員が対象、ただし◯◯条件を満たすPCはn人分の加重を受ける」パターン
  // （edele「突進」等）：targetRule.weightRuleが指定されている場合、resolveTargetsで得た
  // 候補のうち、weightRule.kindの条件を満たすPCはweightRule.weight、それ以外は1として
  // 各PCの重みを返す。
  function matchesWeightCondition(kind, battleState, idx) {
    var aggro = (battleState.aggro && battleState.aggro[idx]) || 0;
    var front = !!(battleState.front && battleState.front[idx]);
    if (kind === "frontAggroAtLeast1") return front && aggro >= 1;
    return false;
  }

  function resolveWeightedTargets(targetRule, battleState, rosterCount) {
    var candidates = resolveTargets(targetRule, battleState, rosterCount);
    var weightRule = targetRule.weightRule;
    return candidates.map(function (idx) {
      var weight = weightRule && matchesWeightCondition(weightRule.kind, battleState, idx) ? weightRule.weight : 1;
      return { index: idx, weight: weight };
    });
  }

  // 加重版のsplitGroupShares：合計重みで傷害池を割り、各対象の重み分を掛けて配分する
  // （通常のsplitGroupSharesは全員重み1固定の特殊ケースに相当）。
  function splitGroupSharesWeighted(total, weightedTargets) {
    var totalWeight = weightedTargets.reduce(function (sum, t) {
      return sum + t.weight;
    }, 0);
    if (!totalWeight) return weightedTargets.map(function () { return 0; });
    var unit = total / totalWeight;
    return weightedTargets.map(function (t) {
      return unit * t.weight;
    });
  }
```

- [ ] **Step 2: exportに追加**

`static_src/auto_gm.js`末尾の`window.PriTestAutoGm = {...}`（349-359行）に以下2行を追加：

```js
    resolveWeightedTargets: resolveWeightedTargets,
    splitGroupSharesWeighted: splitGroupSharesWeighted,
```

- [ ] **Step 3: `night.js`の呼び出し側を加重対応に修正**

`static_src/night.js:8929-8943`の

```js
      if (result.structuredRow.targetRule) {
        var groupTargets = AutoGm.resolveTargets(result.structuredRow.targetRule, state.battle, entered.length);
        // 「N人份」の加重配分（現状は対象全員が同一重みのため均等割りと数学的に同値、
        // auto_gm.jsのsplitGroupShares参照）：対象が複数いる場合は傷害池を人数で分ける。
        var shares = AutoGm.splitGroupShares(groupResult.total, groupTargets.length);
        groupTargets.forEach(function (idx, shareIdx) {
          var input = document.getElementById("enemy-damage-group-" + entered[idx].id);
          if (input) input.value = String(Math.round(shares[shareIdx]));
          queueAttributeAccum(idx, result.structuredRow.groupDamage.elementAccum);
          queueAttributeAccum(idx, result.structuredRow.groupDamage.ailmentAccum);
        });
        if (groupTargets.length > 1) {
          breakdownParts.push(window.I18N.t("auto_gm_split_note", { count: groupTargets.length, each: Math.round(shares[0]) }));
        }
      }
```

を以下に置き換える：

```js
      if (result.structuredRow.targetRule) {
        var groupTargets = AutoGm.resolveTargets(result.structuredRow.targetRule, state.battle, entered.length);
        var shares;
        if (result.structuredRow.targetRule.weightRule) {
          // 「乱戦ダメージはPC全員対象、◯◯条件のPCはn人分の加重」パターン（edele「突進」等）。
          var weighted = AutoGm.resolveWeightedTargets(result.structuredRow.targetRule, state.battle, entered.length);
          shares = AutoGm.splitGroupSharesWeighted(groupResult.total, weighted);
        } else {
          // 「N人份」の加重配分（対象全員が同一重みのため均等割りと数学的に同値、
          // auto_gm.jsのsplitGroupShares参照）：対象が複数いる場合は傷害池を人数で分ける。
          shares = AutoGm.splitGroupShares(groupResult.total, groupTargets.length);
        }
        groupTargets.forEach(function (idx, shareIdx) {
          var input = document.getElementById("enemy-damage-group-" + entered[idx].id);
          if (input) input.value = String(Math.round(shares[shareIdx]));
          queueAttributeAccum(idx, result.structuredRow.groupDamage.elementAccum);
          queueAttributeAccum(idx, result.structuredRow.groupDamage.ailmentAccum);
        });
        if (groupTargets.length > 1) {
          breakdownParts.push(window.I18N.t("auto_gm_split_note", { count: groupTargets.length, each: Math.round(shares[0]) }));
        }
      }
```

- [ ] **Step 4: 構文チェック**

```bash
node --check static_src/auto_gm.js
node --check static_src/night.js
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 5: Node上でのユニット的検証（使い捨てスクリプト、コミットしない）**

`node`で以下を評価し、加重配分が正しいか確認する（`splitGroupSharesWeighted(1260, [{index:0,weight:2},{index:1,weight:1},{index:2,weight:1}])` → `[630, 315, 315]`）：

```bash
node -e "
global.window = {};
require('./static_src/auto_gm.js');
var AutoGm = window.PriTestAutoGm;
var shares = AutoGm.splitGroupSharesWeighted(1260, [{index:0,weight:2},{index:1,weight:1},{index:2,weight:1}]);
console.log(JSON.stringify(shares));
"
```

Expected: `[630,315,315]`。

- [ ] **Step 6: Commit**

```bash
git add static_src/auto_gm.js static_src/night.js
git commit -m "feat(night): 新增加重乱戦傷害配分機制(targetRule.weightRule)供edele「突進」等使用"
```

---

### Task 3: auto_gm.js の savingThrow を拡張（対象絞り込み＋onFailの属性/異常蓄積対応）

**Files:**
- Modify: `static_src/auto_gm.js:317-347`（`resolveSavingThrow`）
- Modify: `static_src/night.js:8980-9005`（`handleAutoGmRollClick`内、savingThrow結果処理）

**Interfaces:**
- Consumes: 既存の`resolveSavingThrow`シグネチャは変更しない（呼び出し側の引数は同じ）
- Produces: `savingThrow.targetFilter`（省略可、`{kind:"aggroAtLeast1"}`のみサポート）指定時、判定対象PCを絞り込む。`savingThrow.onFail.elementAccum`/`ailmentAccum`（省略可）が`night.js`側で反映されるようになる。

- [ ] **Step 1: `resolveSavingThrow`に対象絞り込みを追加**

`static_src/auto_gm.js:317-347`の

```js
  function resolveSavingThrow(savingThrow, rosterCharacters, battleState, CharacterTypes, CharacterDrawer) {
    var entered = (rosterCharacters || []).filter(function (c) {
      return c.entered;
    });
    return entered.map(function (c, idx) {
```

を

```js
  function resolveSavingThrow(savingThrow, rosterCharacters, battleState, CharacterTypes, CharacterDrawer) {
    var entered = (rosterCharacters || []).filter(function (c) {
      return c.entered;
    });
    // targetFilterが指定されている場合（例：「敵視:1以上」PCのみが判定を行う「赤雷叩きつけ」型）、
    // 条件を満たさないPCはそもそも判定対象に含めない（全PCプール前提のtargetByConditionとは
    // 別の絞り込み軸）。indexは元のentered配列上のインデックスを維持する。
    var filterKind = savingThrow.targetFilter && savingThrow.targetFilter.kind;
    var filtered = entered
      .map(function (c, idx) {
        return { c: c, idx: idx };
      })
      .filter(function (pair) {
        if (!filterKind) return true;
        var aggro = (battleState && battleState.aggro && battleState.aggro[pair.idx]) || 0;
        if (filterKind === "aggroAtLeast1") return aggro >= 1;
        return true;
      });
    return filtered.map(function (pair) {
      var c = pair.c;
      var idx = pair.idx;
```

そして、そのすぐ後に続く既存の本体（`var aggro = ...`から`return {...}`まで）はそのまま維持し、関数末尾の`});`と`}`もそのまま（`entered.map`が`filtered.map`に変わっただけで、コールバック本体・戻り値の`index: idx`は変更不要——`idx`は`pair.idx`から取得した「元のentered配列上のインデックス」なのでこれまでと同じ意味を保つ）。

- [ ] **Step 2: `night.js`のsavingThrow結果処理にelementAccum/ailmentAccumを追加**

`static_src/night.js:8998-9002`の

```js
        if (!r.passed) {
          var failResult = AutoGm.computeIndividualDamage(st.onFail, state.rollEffects);
          var input = document.getElementById("enemy-damage-individual-" + entered[r.index].id);
          if (input) input.value = String(failResult.total);
        }
```

を

```js
        if (!r.passed) {
          var failResult = AutoGm.computeIndividualDamage(st.onFail, state.rollEffects);
          var input = document.getElementById("enemy-damage-individual-" + entered[r.index].id);
          if (input) input.value = String(failResult.total);
          queueAttributeAccum(r.index, st.onFail.elementAccum);
          queueAttributeAccum(r.index, st.onFail.ailmentAccum);
        }
```

に置き換える。

- [ ] **Step 3: 構文チェック**

```bash
node --check static_src/auto_gm.js
node --check static_src/night.js
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 4: Node上での検証（使い捨て）**

`targetFilter`が正しく絞り込むことを、モックの`rosterCharacters`/`battleState`で確認する：

```bash
node -e "
global.window = { PriTestCharacterTypes: null };
require('./static_src/auto_gm.js');
var AutoGm = window.PriTestAutoGm;
var roster = [{entered:true,name:'A',typeId:null},{entered:true,name:'B',typeId:null},{entered:true,name:'C',typeId:null}];
var battle = { aggro: [1,0,1], front:[true,true,false] };
var st = { stat:'physical', targetFilter:{kind:'aggroAtLeast1'}, targetByCondition:[{condition:{kind:'default'},target:11}], onFail:{amount:120} };
var results = AutoGm.resolveSavingThrow(st, roster, battle, null, null);
console.log(results.map(function(r){return r.name;}));
"
```

Expected: `[ 'A', 'C' ]`（`aggro>=1`のA・Cのみが対象、Bは除外される）。

- [ ] **Step 5: Commit**

```bash
git add static_src/auto_gm.js static_src/night.js
git commit -m "feat(night): savingThrow新增targetFilter(對象絞り込み)與onFail屬性/異常蓄積支援"
```

---

### Task 4: auto_gm.js に新targetRule「敵視最大人数が多いエリア」＋「後衛全員」を実装

**Files:**
- Modify: `static_src/auto_gm.js:253-292`（`resolveTargets`）

**Interfaces:**
- Consumes: なし
- Produces: 新しい`targetRule.kind`値 `"majorityAreaAggroMax"`（敵視最大PCが多い方のエリア全員、同数ならランダム）と `"backAll"`（後衛全員、既存`"frontAll"`の対称形）を`resolveTargets`がサポートするようになる。

- [ ] **Step 1: `resolveTargets`に2つの新kindを追加**

`static_src/auto_gm.js:253-272`の

```js
  function resolveTargets(targetRule, battleState, rosterCount) {
    if (!targetRule || !battleState) return [];
    var candidates = [];
    for (var i = 0; i < rosterCount; i++) {
      var aggro = (battleState.aggro && battleState.aggro[i]) || 0;
      var front = !!(battleState.front && battleState.front[i]);
      if (targetRule.kind === "frontAggroAtLeast1All") {
        if (front && aggro >= 1) candidates.push(i);
      } else if (targetRule.kind === "aggroAtLeast1All") {
        if (aggro >= 1) candidates.push(i);
      } else if (targetRule.kind === "frontAll") {
        // ユーザー確認済みの既定ルール: 行動本文に亂戰傷害の分配対象が明記されていない場合、
        // 前衛の全員で均等割りする（規則書「乱戦ダメージ：n人」の一般ルールに対する既定値）。
        if (front) candidates.push(i);
      } else if (targetRule.kind === "aggroMax" || targetRule.kind === "frontAggroMaxAll") {
        if (targetRule.kind === "aggroMax" || front) candidates.push(i);
      } else if (targetRule.kind === "allPCs") {
        candidates.push(i);
      }
    }
```

を

```js
  function resolveTargets(targetRule, battleState, rosterCount) {
    if (!targetRule || !battleState) return [];
    // 「敵視:最大のPCが多いエリア（前衛/後衛）全員」パターン（gnoster「潜航＆毒液」等）：
    // 他のkindのように1PCずつ判定するループでは表現できない（先に全体の敵視最大値と
    // 前衛/後衛の人数比較が必要）ため、専用の早期returnで処理する。
    if (targetRule.kind === "majorityAreaAggroMax") {
      var allAggro = [];
      for (var a = 0; a < rosterCount; a++) allAggro.push((battleState.aggro && battleState.aggro[a]) || 0);
      var maxAggroValue = allAggro.length ? Math.max.apply(null, allAggro) : 0;
      var maxAggroIdxs = [];
      for (var b = 0; b < rosterCount; b++) if (allAggro[b] === maxAggroValue) maxAggroIdxs.push(b);
      var frontCount = 0;
      var backCount = 0;
      maxAggroIdxs.forEach(function (idx) {
        if (battleState.front && battleState.front[idx]) frontCount++;
        else backCount++;
      });
      var chooseFront = frontCount === backCount ? Math.random() < 0.5 : frontCount > backCount;
      var areaResult = [];
      for (var d = 0; d < rosterCount; d++) {
        var isFrontD = !!(battleState.front && battleState.front[d]);
        if (isFrontD === chooseFront) areaResult.push(d);
      }
      return areaResult;
    }
    var candidates = [];
    for (var i = 0; i < rosterCount; i++) {
      var aggro = (battleState.aggro && battleState.aggro[i]) || 0;
      var front = !!(battleState.front && battleState.front[i]);
      if (targetRule.kind === "frontAggroAtLeast1All") {
        if (front && aggro >= 1) candidates.push(i);
      } else if (targetRule.kind === "aggroAtLeast1All") {
        if (aggro >= 1) candidates.push(i);
      } else if (targetRule.kind === "frontAll") {
        // ユーザー確認済みの既定ルール: 行動本文に亂戰傷害の分配対象が明記されていない場合、
        // 前衛の全員で均等割りする（規則書「乱戦ダメージ：n人」の一般ルールに対する既定値）。
        if (front) candidates.push(i);
      } else if (targetRule.kind === "backAll") {
        if (!front) candidates.push(i);
      } else if (targetRule.kind === "aggroMax" || targetRule.kind === "frontAggroMaxAll") {
        if (targetRule.kind === "aggroMax" || front) candidates.push(i);
      } else if (targetRule.kind === "allPCs") {
        candidates.push(i);
      }
    }
```

（以降270-292行の`aggroMax`最大値絞り込み・fallback処理はそのまま変更不要）

- [ ] **Step 2: 構文チェック**

```bash
node --check static_src/auto_gm.js
```

Expected: エラーなく終了する。

- [ ] **Step 3: Node上での検証（使い捨て）**

```bash
node -e "
global.window = {};
require('./static_src/auto_gm.js');
var AutoGm = window.PriTestAutoGm;
var battle = { aggro:[2,2,2,0], front:[true,false,false,true] };
// 敵視最大(2)のPCは index0,1,2。前衛はindex0のみ(1人)、後衛はindex1,2(2人) → 後衛の方が多い→後衛全員が対象
var result = AutoGm.resolveTargets({kind:'majorityAreaAggroMax'}, battle, 4);
console.log(JSON.stringify(result));
"
```

Expected: `[1,2]`（後衛の全員 = front配列で`false`のindex、この例では1と2。index3は`front[3]=true`のため前衛であり後衛ではない）。

- [ ] **Step 4: Commit**

```bash
git add static_src/auto_gm.js
git commit -m "feat(night): 新增targetRule.kind「majorityAreaAggroMax」與「backAll」供gnoster「潜航＆毒液」使用"
```

---

### Task 5: `force_back_row_next_phase` の実行時適用

**Files:**
- Modify: `static_src/night.js:8873-9042`（`handleAutoGmRollClick`、conditions検出とフラグセット）
- Modify: `static_src/night.js:10425-10493`（`setActionPhase`の`phase === "combat"`新規突入ブロック、フラグ消費）
- Modify: `static_src/night.js`（`createBattleState`相当の初期化箇所、新フィールド`forceBackRowNextPhase`をfalseで初期化）

**Interfaces:**
- Consumes: `state.battle.front`/`back`/`positionLocked`（既存）
- Produces: `state.battle.forceBackRowNextPhase`（bool、新設）。`structuredRow.conditions`に`"force_back_row_next_phase"`が含まれる行が確定されると次の「戰鬥フェイズ新規突入」でentered全員が強制的に後衛へ固定される。

- [ ] **Step 1: battle state初期化に新フィールドを追加**

`static_src/night.js`内で`state.battle`オブジェクトの初期値を定義している箇所（`pendingDefenseElementAccum: {}`が定義されている関数、739-762行付近と同じ初期化ブロック）を探し、その中に以下を追加する：

```js
      // 「次のアクションフェイズ開始時、PC全員が骰目に関わらず後衛へ強制配置される」特殊能力
      // （死儀礼の鳥「飛び退き」等、conditions:["force_back_row_next_phase"]）用の1回限りフラグ。
      // handleAutoGmRollClickが該当行を確定した時にtrueへ、setActionPhase("combat")新規突入時に
      // 消費してfalseへ戻す。
      forceBackRowNextPhase: false,
```

（挿入位置は`pendingDefenseElementAccum: {}`の直後、`defenseRollPreviewText: null`の手前を推奨——既存の防禦フェイズ関連フィールド群と隣接させる）

- [ ] **Step 2: `handleAutoGmRollClick`でconditionsを検出してフラグを立てる**

`static_src/night.js`の`handleAutoGmRollClick`関数内、`var groupResult = AutoGm.computeGroupDamage(...)`の直後（8898行の直後）に追加：

```js
    // 「次のアクションフェイズ開始時、PC全員が骰目に関わらず後衛へ強制配置される」特殊能力
    // （死儀礼の鳥「飛び退き」、王族的幽鬼「転移」、古龍「滞空」等）：本文を確認したところ
    // 対象は常に「PC全員」（乱戦ダメージの対象者に限らない）のため、行内容に依らず戦闘全体の
    // 1回限りフラグとして立てるだけでよい。
    if (result.structuredRow.conditions && result.structuredRow.conditions.indexOf("force_back_row_next_phase") !== -1) {
      state.battle.forceBackRowNextPhase = true;
    }
```

- [ ] **Step 3: `setActionPhase`の新回合突入ブロックでフラグを消費**

`static_src/night.js:10440-10445`の

```js
      if (isNewRoundFromDefense) {
        state.battle.positionLocked = new Array(BATTLE_SLOT_COUNT).fill(false);
        // 新しい回合の開始（防禦→戰鬥）でも、額外／防禦フェイズ突入時と同様に前回合の
        // 確定行動（点線枠）を一括で消去する（ユーザー確認済みの行動階段フロー仕様）。
        clearAllPendingActionBoxes();
      }
```

を

```js
      if (isNewRoundFromDefense) {
        state.battle.positionLocked = new Array(BATTLE_SLOT_COUNT).fill(false);
        // 新しい回合の開始（防禦→戰鬥）でも、額外／防禦フェイズ突入時と同様に前回合の
        // 確定行動（点線枠）を一括で消去する（ユーザー確認済みの行動階段フロー仕様）。
        clearAllPendingActionBoxes();
        // 特殊能力「飛び退き／転移／滞空」等（conditions:["force_back_row_next_phase"]）：
        // 前回合のディフェンスフェイズでこの効果が発動していれば、entered全員をこの新しい
        // 戰鬥フェイズの開始時点で強制的に後衛へ固定する（positionLockedをtrueにして、
        // これから振る骰子による自動前後衛判定=syncDiceStatusToBattleで上書きされないように
        // する——本文の「骰目に関わらず後衛配置」を反映）。
        if (state.battle.forceBackRowNextPhase) {
          rosterCharacters.forEach(function (c, idx) {
            if (!c.entered || idx >= BATTLE_SLOT_COUNT) return;
            state.battle.front[idx] = false;
            state.battle.back[idx] = true;
            state.battle.positionLocked[idx] = true;
          });
          state.battle.forceBackRowNextPhase = false;
          addLog("log_force_back_row_next_phase");
        }
      }
```

- [ ] **Step 4: i18nキー`log_force_back_row_next_phase`を3言語に追加**

`site_src/i18n_data_zh.py`に追加（既存の`log_*`キー群の近くに挿入、既存の書式に合わせる）：

```python
    "log_force_back_row_next_phase": "特殊能力效果發揮：新回合開始時，PC全員強制配置於後衛。",
```

`site_src/i18n_data_ja.py`：

```python
    "log_force_back_row_next_phase": "特殊能力の効果発揮：新しい回合の開始時、PC全員が強制的に後衛へ配置されました。",
```

`site_src/i18n_data_en.py`（英語データが無ければ既存の他`log_*`キーのfallback方針に合わせて`zh`と同内容の直訳、または既存英語キーが無い場合はこのファイルへの追加自体を既存の他ログキーと同じ扱いで行う——実装前に`grep -n "log_dice_pool_cleared_new_round"`で3ファイルへの既存追加パターンを確認してから追記する）：

```python
    "log_force_back_row_next_phase": "Special ability triggered: all PCs are forced to the back row at the start of the new round.",
```

- [ ] **Step 5: 構文チェックとビルド**

```bash
node --check static_src/night.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 6: Playwright動作確認（使い捨てスクリプト）**

`admin/index.html`で`window.PriTestGames.create("t2","tricephalos","local")`によりゲームを作成し、`night/index.html?game=<id>`を開く。戦闘を開始し、`state.battle.selectedEnemyIds`へ`"death_bird_raven|death_ritual_bird|1"`を追加、ディフェンスフェイズでAutoGM擲骰が出目2または5の行に当たるまで擲骰（またはブラウザコンテキストで`Math.random`をモックして固定）、確定後に新しい戰鬥フェイズへ進んだ時点で以下を確認：

```js
// ブラウザコンテキストで実行
console.log(window.PriTestNightCore ? "core exposed" : "check state via other means");
```

（`PriTestNightCore`のexport有無は既存コードで要確認——無ければ`localStorage`の`pritest-night-state-<gameId>`を読み、`battle.front`/`battle.back`が全員`false`/`true`になっていることを確認する。）

Expected: 該当行確定後、次の戰鬥フェイズ開始時に`battle.front`全員`false`、`battle.back`全員`true`。

- [ ] **Step 7: Commit**

```bash
git add static_src/night.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(night): 實裝conditions「force_back_row_next_phase」的執行時自動套用"
```

---

### Task 6: 複数回・複数対象の乱戦ダメージ（`groupDamage.sequence`）を実装

**Files:**
- Modify: `static_src/night.js:8917-8944`（`handleAutoGmRollClick`内、`groupResult`処理部分）

**Interfaces:**
- Consumes: `AutoGm.resolveTargets`（既存）、`AutoGm.splitGroupShares`（既存）
- Produces: `groupDamage.sequence`（配列、各要素`{targetRule}`）が指定された行では、`groupDamage.value`/`modifier`から算出した1回分のダメージ（`groupResult.perHit`）を、`sequence`の各要素のtargetRuleで解決した対象へ順に適用し、同一PCが複数回対象になった場合は合算する。既存の単一`targetRule`処理とは排他（`groupDamage.sequence`がある行では`groupDamage.repeat`は使わない）。

- [ ] **Step 1: `handleAutoGmRollClick`にsequence分岐を追加**

`static_src/night.js:8917`の`if (groupResult) {`ブロック開始直後（`groupBreakdown`の`breakdownParts.push`の後、既存の`if (result.structuredRow.targetRule) {`の**前**）に、`groupDamage.sequence`優先の分岐を挿入する。具体的には、既存コード：

```js
      breakdownParts.push(groupBreakdown);
      if (result.structuredRow.targetRule) {
```

を

```js
      breakdownParts.push(groupBreakdown);
      if (result.structuredRow.groupDamage.sequence) {
        // 「乱戦ダメージがN回発生し、それぞれ異なる対象を持つ」パターン（gnoster「合体突進」：
        // 1回目は前衛全員、2回目は後衛全員、3回目は敵視1以上全員）。既存のgroupDamage.repeat
        // （同一対象へのN回）とは異なり対象が回ごとに変わるため、専用ロジックで処理する。
        // 各回は「その回の対象で1回分(perHit)を均等割り」、同一PCが複数回対象になれば合算する。
        var seqTotals = {};
        result.structuredRow.groupDamage.sequence.forEach(function (seq) {
          var seqTargets = AutoGm.resolveTargets(seq.targetRule, state.battle, entered.length);
          var seqShares = AutoGm.splitGroupShares(groupResult.perHit, seqTargets.length);
          seqTargets.forEach(function (idx, shareIdx) {
            seqTotals[idx] = (seqTotals[idx] || 0) + seqShares[shareIdx];
          });
        });
        Object.keys(seqTotals).forEach(function (idxKey) {
          var idx = parseInt(idxKey, 10);
          var input = document.getElementById("enemy-damage-group-" + entered[idx].id);
          if (input) input.value = String(Math.round(seqTotals[idx]));
          queueAttributeAccum(idx, result.structuredRow.groupDamage.elementAccum);
          queueAttributeAccum(idx, result.structuredRow.groupDamage.ailmentAccum);
        });
      } else if (result.structuredRow.targetRule) {
```

（残りの`else if`ブロック本体は既存のまま、末尾の閉じ`}`の数が合うように既存コードの構造を保つ）

- [ ] **Step 2: 構文チェック**

```bash
node --check static_src/night.js
```

Expected: エラーなく終了する。

- [ ] **Step 3: Commit**

```bash
git add static_src/night.js
git commit -m "feat(night): 新增groupDamage.sequence機制供gnoster「合体突進」等多次不同對象的亂戰傷害使用"
```

---

### Task 7: 公開情報の特殊能力を公開盤に表示

**Files:**
- Modify: `static_src/night.js:11425-11430`（`extractWeakness`の直後に新関数追加）
- Modify: `static_src/night.js:11552-11555`（`renderSelectedEnemies`、通常エネミー分岐）
- Modify: `site_src/i18n_data_zh.py` / `_ja.py` / `_en.py`（新規ラベルキー`enemy_public_special_label`）

**Interfaces:**
- Consumes: `enemy.special`（既存フィールド、`C(ja,zh)`形式）
- Produces: `extractPublicSpecialNames(specialField, T)` → `string[]`（`〔◯◯〕`のうち直後に「公開情報」または「公開資訊」を含む段落の見出し名一覧）

- [ ] **Step 1: `extractPublicSpecialNames`を追加**

`static_src/night.js:11425-11430`の`extractWeakness`関数の直後に追加：

```js
  // enemy.specialテキスト中、直後に「公開情報／公開資訊」という語を伴う〔◯◯〕見出しを
  // すべて抽出する（例："〔亡者特効〕公開情報。..."）。docs/combat_flow_rules.md §4の
  // 「追加ルールはあらかじめプレイヤーへ公開しておく」に対応——弱点と同様、公開盤の
  // エネミーchipに常時表示することで、GMが公開情報の提示漏れを防ぐ。
  function extractPublicSpecialNames(specialField, T) {
    if (!specialField) return [];
    var text = T(specialField);
    var names = [];
    var re = /〔([^〕]+)〕([^〔]*)/g;
    var m;
    while ((m = re.exec(text))) {
      if (m[2].indexOf("公開情報") !== -1 || m[2].indexOf("公開資訊") !== -1) {
        names.push(m[1]);
      }
    }
    return names;
  }
```

- [ ] **Step 2: `renderSelectedEnemies`のstatLineに追加表示**

`static_src/night.js:11552-11555`の

```js
        var weakness = extractWeakness(item.info.enemy.special, T);
        if (weakness) {
          statParts.push(window.I18N.t("enemy_weakness_label") + window.I18N.t("colon_separator") + weakness);
        }
```

を

```js
        var weakness = extractWeakness(item.info.enemy.special, T);
        if (weakness) {
          statParts.push(window.I18N.t("enemy_weakness_label") + window.I18N.t("colon_separator") + weakness);
        }
        var publicSpecials = extractPublicSpecialNames(item.info.enemy.special, T);
        if (publicSpecials.length) {
          statParts.push(window.I18N.t("enemy_public_special_label") + window.I18N.t("colon_separator") + publicSpecials.join("、"));
        }
```

に置き換える。

- [ ] **Step 3: i18nキー追加**

`site_src/i18n_data_zh.py`：

```python
    "enemy_public_special_label": "公開特殊能力",
```

`site_src/i18n_data_ja.py`：

```python
    "enemy_public_special_label": "公開特殊能力",
```

`site_src/i18n_data_en.py`：

```python
    "enemy_public_special_label": "Public Special",
```

（挿入位置は既存の`enemy_weakness_label`キーの直後、3ファイルとも同じ相対位置に揃える）

- [ ] **Step 4: 構文チェックとビルド**

```bash
node --check static_src/night.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 5: Node上での検証（使い捨て）**

```bash
node -e "
var text = { ja: '〔亡者特効〕公開情報。このエネミーは「死に生きる者」である（亡者特効が有効）。\n〔飛び退き（条件発揮）〕次のアクションフェイズ開始時、PC全員はスタミナダイスの出目にかかわらず後衛に配置される。', zh: '' };
function T(f) { return f.ja; }
function extractPublicSpecialNames(specialField, T) {
  if (!specialField) return [];
  var s = T(specialField);
  var names = [];
  var re = /〔([^〕]+)〕([^〔]*)/g;
  var m;
  while ((m = re.exec(s))) {
    if (m[2].indexOf('公開情報') !== -1 || m[2].indexOf('公開資訊') !== -1) names.push(m[1]);
  }
  return names;
}
console.log(JSON.stringify(extractPublicSpecialNames(text, T)));
"
```

Expected: `["亡者特効"]`（「飛び退き」は公開情報の語を含まないため除外される）。

- [ ] **Step 6: Playwright動作確認**

死儀礼の鳥を戦場へ追加し、`#board-side-enemies`または`#battle-selected-enemies`のchip内テキストに「公開特殊能力：亡者特効」が含まれることを確認する。

- [ ] **Step 7: Commit**

```bash
git add static_src/night.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(night): 公開盤新增顯示敵人「公開情報」特殊能力名稱(如死儀禮之鳥「亡者特效」)"
```

---

### Task 8: `boss_auto_gm_data.js` に「夜の爵、エデレ」を追加

**Files:**
- Modify: `static_src/boss_auto_gm_data.js`

**Interfaces:**
- Consumes: Task 2の`targetRule.weightRule`、Task 1の「Xd=固定値X」裁定
- Produces: `BossAutoGmData.get("edele")`が非nullを返すようになる

規則書原文（`static_src/night_boss_rulebook.js:93-155`、既に確認済み）：
- 1~2「噛みつき」：`1080`、`frontAggroAtLeast1All`（「敵視:1以上」前衛全員「3人分」）
- 3~4「突進」：`1260`、PC全員対象・前衛かつ敵視1以上PCのみ2人分加重
- 5~6「拘束噛みつき」：`600`、`aggroMax`単体、ガード不可、次アクションフェイズ終了までHP価値-10（最低10）
- 7~8「雷噛みつき」：`1080`＋「雷:2D」→固定値2、既定ルール（`frontAll`）、次アクションフェイズ終了までHP価値+10（最高100）
- 9~10「地擦り雷光」：乱戦`600`＋既定ルール、個別`240`＋「雷:1D」→固定値1、`frontAggroAtLeast1All`
- 特殊トリガー行「毒吐き」：出目に紐づかない強制発動（PCが猛毒でHP損害を与えた瞬間）のためrows外注記のみ

- [ ] **Step 1: 既存コメント（22-23行目）を更新**

`static_src/boss_auto_gm_data.js:22-23`の

```js
  // - 他の7体（fulghor/harmonia/gnoster/caligo/libra/edele/stragedes）は、多形態
  //   （harmonia等）や二段階ロール表（stragedes等）など固有ルールを持つため今回は対象外。
```

を

```js
  // - edele（夜の爵、エデレ）・gnoster（夜の識、グノスター）も単一形態＋
  //   rollBonusAfterGuardBreak方式（maris/gladiusと同型）で構造化済み（2026-08-24追加）。
  // - 他の5体（fulghor/harmonia/caligo/libra/stragedes）は、多形態（harmonia等）や
  //   二段階ロール表（stragedes等）など固有ルールを持つため今回は対象外。
```

に置き換える。

- [ ] **Step 2: `edele`エントリを追加**

`static_src/boss_auto_gm_data.js`の`"gladius": {...}`エントリの閉じ`},`（169行目）の直後、`};`（`DATA`オブジェクトの閉じ、171行目）の**前**に挿入：

```js
    "edele": {
      // 「夜の爵、エデレ」（劇本2、night_boss_rulebook.js:93-155）：単一形態。特殊能力「行動激化」
      // （體勢崩し発生後、戦闘終了まで「1D」ではなく「1D＋4」で判定）はrollBonusAfterGuardBreak:4
      // （既存1~10表がこの範囲を完全にカバーするため追加行は不要、maris/gladiusと同型）。
      //
      // 【対象範囲外・既知の制限】特殊能力「猛毒の吐瀉」（PCが「状態異常：猛毒」でHP損害を
      // 与えた瞬間、そのターンの防禦フェイズは1Dを振らず自動的に「毒吐き」を強制実行する。
      // 「体勢崩し」発生後は無効）は、通常の出目テーブルの外側で発生する条件付き強制行動で、
      // night.js側は「PCが猛毒でHP損害を与えたか」を追跡していないため既存機構では自動化
      // できない（gladiusの「形態変化」と同種の未対応パターン）。GMが状態異常「猛毒」での
      // HP損害発生を確認した回だけ、下記rows未収録の「毒吐き」を手動適用すること：
      // 乱戦ダメージ840＆「猛毒：2D」（Task1裁定により固定値2）、対象は「敵視：1以上」全員
      // （該当者無しなら前衛）、ガード不可、次アクションフェイズ終了までHP価値－10（最低10）。
      rollBonusAfterGuardBreak: 4,
      rows: [
        {
          // 「噛みつき」（出目1~2）：「敵視：1以上」で前衛のPC全員は「乱戦ダメージ：3人分」を
          // 割り振られる（本文に明記、gladius/marisと同じ規約で本文の数値は既にN人分込みの
          // 合計値）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { value: 1080 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「突進」（出目3~4）：乱戦ダメージはPC全員が対象（本文に明記）、「敵視：1以上」の
          // 前衛のPCのみ「2人分」の加重を負担する。Task2で新設したtargetRule.weightRuleで
          // 自動配分する（total 1260を、前衛かつ敵視1以上のPCは重み2、それ以外は重み1で
          // 按分——例：対象4人中1人が加重対象なら 1260/(2+1+1+1)=252、加重対象は504）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { value: 1260 },
          targetRule: { kind: "allPCs", weightRule: { kind: "frontAggroAtLeast1", weight: 2 } },
        },
        {
          // 「拘束噛みつき」（出目5~6）：「敵視：最大」のPC1体のみ対象。ガード不可。次の
          // アクションフェイズ終了まで敵に「HP価値：－10（最低10）」する（enemy_hp_value_debuff、
          // buffの逆方向タグ、記録用のみで現時点ではコードから消費されない）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { value: 600 },
          targetRule: { kind: "aggroMax" },
          conditions: ["no_guard", "enemy_hp_value_debuff"],
        },
        {
          // 「雷噛みつき」（出目7~8）：対象の明記が無いため既定ルール（前衛均等割り）。
          // 「雷：2D」はTask1裁定によりelementAccum固定値2として構造化する。次のアクション
          // フェイズ終了まで、エネミーに「HP価値：＋10（最高100）」する。
          rollMin: 7,
          rollMax: 8,
          groupDamage: { value: 1080, elementAccum: [{ label: "雷", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「地擦り雷光」（出目9~10）：乱戦ダメージは対象の明記が無いため既定ルール
          // （前衛均等割り）、mod欄の「雷：1D」はTask1裁定によりelementAccum固定値1。
          // 個別効果：「敵視：1以上」で前衛のPC全員に【個別ダメージ：240】＋「雷：1D」
          // （固定値1、本文の個別効果側にも同じ蓄積が明記）。
          rollMin: 9,
          rollMax: 10,
          groupDamage: { value: 600, elementAccum: [{ label: "雷", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            { amount: 240, targetRule: { kind: "frontAggroAtLeast1All" }, elementAccum: [{ label: "雷", amount: 1 }] },
          ],
        },
      ],
    },
```

- [ ] **Step 3: 構文チェックとビルド**

```bash
node --check static_src/boss_auto_gm_data.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 4: Node上での検証（使い捨て）**

```bash
node -e "
global.window = {};
require('./static_src/boss_auto_gm_data.js');
var data = window.PriTestBossAutoGmData.get('edele');
console.log('rows:', data.rows.length, 'rollBonusAfterGuardBreak:', data.rollBonusAfterGuardBreak);
console.log('row3-4 weightRule:', JSON.stringify(data.rows[1].targetRule));
"
```

Expected: `rows: 5 rollBonusAfterGuardBreak: 4`、`row3-4 weightRule: {"kind":"allPCs","weightRule":{"kind":"frontAggroAtLeast1","weight":2}}`。

- [ ] **Step 5: Playwright動作確認**

`night/index.html?game=<id>`で戦場へ`"boss|edele"`を編入（`ensureNight3BossInBattle`相当のテストフックが無い場合は`state.battle.selectedEnemyIds.push("boss|edele")`を直接操作してから`renderSelectedEnemies()`を呼ぶ）、AutoGM擲骰UIでこのボスを選び、出目3~4に固定（`Math.random`モック）した状態で確定し、進度版に「突進」の乱戦ダメージ内訳と加重配分の注記が表示されることを確認する。

- [ ] **Step 6: Commit**

```bash
git add static_src/boss_auto_gm_data.js
git commit -m "feat(night): 新增夜之王「エデレ(艾德蕾)」的自動化GM結構化資料"
```

---

### Task 9: `boss_auto_gm_data.js` に「夜の識、グノスター」を追加

**Files:**
- Modify: `static_src/boss_auto_gm_data.js`

**Interfaces:**
- Consumes: Task 3の`savingThrow`拡張、Task 4の`majorityAreaAggroMax`/`backAll`、Task 6の`groupDamage.sequence`、Task 1の「Xd=固定値X」裁定
- Produces: `BossAutoGmData.get("gnoster")`が非nullを返すようになる

規則書原文（`static_src/night_boss_rulebook.js:158-206`、既に確認済み）：
- 1「押しつぶし＆毒牙の鱗粉」：乱戦無し、個別`120`＋「猛毒:2D」→固定値2、`aggroMax`
- 2「連続挟み込み＆誘導弾」：乱戦無し、個別①`180`（PC人数回実行、既存解釈=対象全員1回ずつ）`frontAggroAtLeast1All`、個別②`120`＋「魔:1D」→固定値1、`aggroMax`
- 3「瓦礫隆起＆掴み攻撃」：乱戦`1020`、`frontAll`、個別`240`＋「猛毒:2D」→固定値2、`aggroMax`、ガード不可
- 4「硬化＆魔力弾の雨」：乱戦`600`、`frontAll`、個別はsavingThrow（敵視1以上→目標12／それ以外→目標10、運試し=luck）、失敗者に`240`＋「魔:2D」→固定値2、次アクションフェイズ終了までHP価値+20（最大100）
- 5「叫び＆滞空」：乱戦無し、個別HP損害「■×4」「■×2」は■のため自動化不可（GM手動）。後衛全員「猛毒:1D」→固定値1＋次アクションフェイズ体力骰-1は自動化可能（HP損害を伴わないためconditionsに留めず、individualDamageのailmentAccumのみで表現できないか要検討——本Taskでは対象がHP損害を伴わない「後衛全員」という別集団のため、conditionsに記録しGM手動としつつ、A/B算出テキストのみ自動生成する新規対応をStep 2で行う）
- 6「潜航＆毒液」：乱戦`900`、Task4の`majorityAreaAggroMax`。個別（対象外PC全員に猛毒:1D）はHP損害を伴わないため引き続きconditions
- 7「光の柱＆毒まき散らし」：乱戦`600`＋「魔:2D」→固定値2、`aggroMax`。個別（対象外PC全員に`120`＋猛毒）は「対象以外全員」という新規targetRuleが必要なためGM手動のまま
- 8「合体突進」：乱戦`360`＋「魔:1D」→固定値1、Task6の`groupDamage.sequence`（`frontAll`→`backAll`→`aggroAtLeast1All`）

- [ ] **Step 1: `gnoster`エントリを追加**

`static_src/boss_auto_gm_data.js`のTask 8で追加した`"edele": {...}`エントリの閉じ`},`の直後、`};`の**前**に挿入：

```js
    "gnoster": {
      // 「夜の識、グノスター」（劇本3、night_boss_rulebook.js:158-206）：単一形態。特殊能力
      // 「行動激化」（體勢崩し発生後、戦闘終了まで「1D」ではなく「1D＋2」で判定）は
      // rollBonusAfterGuardBreak:2（marisと同型、出目レンジは1D6=1~6を+2シフトした3~8まで
      // 対応、出目7・8はいずれも體勢崩し後のみ到達）。
      //
      // 【対象範囲外・既知の制限】特殊能力「毒性の卵」（PCがこのエネミーからの猛毒蓄積で
      // HP損害を受けると「毒性の卵」状態になる）は、猛毒によるHP損害発生の追跡と新しい
      // PC状態異常フラグの新設が必要で、既存のnight.js側の状態管理には対応する仕組みが
      // 無いため今回のスコープ外（GMが規則書パネル参照の上で手動管理する）。
      rollBonusAfterGuardBreak: 2,
      rows: [
        {
          // 「押しつぶし＆毒牙の鱗粉」：乱戦ダメージ列が「—」のため乱戦ダメージ無し。個別効果：
          // 「敵視：最大」のPC1体に個別ダメージ120＋「猛毒：2D」（Task1裁定によりailmentAccum
          // 固定値2）。
          rollMin: 1,
          rollMax: 1,
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "猛毒", amount: 2 }] }],
        },
        {
          // 「連続挟み込み＆誘導弾」：乱戦ダメージ列が「—」のため乱戦ダメージ無し。個別効果
          // （PC人数回実行、既存の「PC人数回実行」解釈を踏襲＝対象全員に1回ずつ）：「敵視：1以上」
          // で前衛のPC全員に個別ダメージ180。個別効果：「敵視：最大」のPC1体に個別ダメージ120＋
          // 「魔：1D」（Task1裁定によりelementAccum固定値1）。
          rollMin: 2,
          rollMax: 2,
          individualDamage: [
            { amount: 180, targetRule: { kind: "frontAggroAtLeast1All" } },
            { amount: 120, targetRule: { kind: "aggroMax" }, elementAccum: [{ label: "魔", amount: 1 }] },
          ],
        },
        {
          // 「瓦礫隆起＆掴み攻撃」：乱戦ダメージの対象明記が本文に無いため既定ルール
          // （前衛均等割り）。個別ダメージ240を「敵視：最大」のPC1体に、ガード不可
          // （「猛毒：2D」はTask1裁定によりailmentAccum固定値2）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { value: 1020 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "猛毒", amount: 2 }] }],
          conditions: ["no_guard"],
        },
        {
          // 「硬化＆魔力弾の雨」：乱戦ダメージの対象明記が本文に無いため既定ルール（前衛均等割り）。
          // 個別効果はTask3で拡張したsavingThrow（敵視:1以上→目標12／それ以外→目標10、運試し=luck、
          // 全PCプール対象のためtargetFilterは指定しない）、失敗者に個別ダメージ240＋「魔：2D」
          // （Task1裁定によりonFail.elementAccum固定値2）。次のアクションフェイズ終了まで、
          // エネミーに「HP価値：＋20（最大100）」する。
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
          // 「叫び＆滞空」：乱戦ダメージ列が「—」のため乱戦ダメージ無し。個別効果のHP損害が
          // 「■×4」「■×2」表記（CLAUDE.md §19、規則書のcontext依存プレースホルダー）のため
          // 数値そのものは自動計算しない。ただし対象群A（「敵視：1以上」PC全員、前後衛問わず）
          // とB（それ以外の前衛PC）の算出はauto_gm.js側のtargetRuleで機械的に決まるため、
          // night.js側でA/Bの実名リストを組み立てて進度版へ出力する（Task9 Step2参照、
          // individualDamage自体は設定しない＝■は依然GM手動）。後衛全員「猛毒：1D」
          // （Task1裁定によりailmentAccum固定値1）と次アクションフェイズ開始時スタミナ
          // ダイス1個減少は、HP損害を伴わずgroupDamage/individualDamageの対象集団（A/B）とも
          // 異なる第三の集団（後衛全員）のため、既存targetRule語彙では同時に表現できず
          // conditionsで記録してGM手動反映する。
          rollMin: 5,
          rollMax: 5,
          conditions: ["unknown_hp_damage_manual_with_target_breakdown", "back_row_poison_1d_manual"],
        },
        {
          // 「潜航＆毒液」：Task4で新設したtargetRule.kind「majorityAreaAggroMax」で自動決定
          // （「敵視：最大」のPCが多いエリア全員、同数ならランダム）。個別効果（対象外PC全員に
          // 「猛毒：1D」）はHP損害を伴わずgroupDamageの対象と相補的な集団のため、既存の
          // individualDamage（amount必須）には構造化できず、conditionsで記録してGM手動反映する。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { value: 900 },
          targetRule: { kind: "majorityAreaAggroMax" },
          conditions: ["accum_target_mismatch_manual"],
        },
        {
          // 「光の柱＆毒まき散らし」：乱戦ダメージは「敵視：最大」のPC1体のみが対象、「魔：2D」は
          // Task1裁定によりelementAccum固定値2。個別効果（乱戦ダメージの対象にならなかったPC
          // 全員に個別ダメージ120＋猛毒）は「対象以外全員」という既存targetRule語彙に無い
          // 複合条件のため、individualDamageは設定せずconditionsでGM手動判定に委ねる。出目7・8は
          // 體勢崩し後（1D6+2＝3~8）のみ到達。
          rollMin: 7,
          rollMax: 7,
          groupDamage: { value: 600, elementAccum: [{ label: "魔", amount: 2 }] },
          targetRule: { kind: "aggroMax" },
          conditions: ["accum_target_mismatch_manual"],
        },
        {
          // 「合体突進」：Task6で新設したgroupDamage.sequenceで自動化。乱戦ダメージ360が
          // 1回目=前衛全員、2回目=後衛全員、3回目=「敵視：1以上」全員の順で発生し、同一PCが
          // 複数回対象になれば合算される。「魔：1D」はTask1裁定によりelementAccum固定値1。
          rollMin: 8,
          rollMax: 8,
          groupDamage: {
            value: 360,
            elementAccum: [{ label: "魔", amount: 1 }],
            sequence: [
              { targetRule: { kind: "frontAll" } },
              { targetRule: { kind: "backAll" } },
              { targetRule: { kind: "aggroAtLeast1All" } },
            ],
          },
        },
      ],
    },
```

- [ ] **Step 2: 「叫び＆滞空」のA/B対象内訳を進度版へ出力する処理を追加**

`static_src/night.js`の`handleAutoGmRollClick`関数内、Task 5で追加した`force_back_row_next_phase`検出コードの直後に追加：

```js
    // gnoster「叫び＆滞空」（rollMin:5, rollMax:5）専用：HP損害の数値自体は■のため自動計算
    // しないが、対象群A（「敵視:1以上」PC全員、前後衛問わず）とB（それ以外の前衛PC）の実名は
    // 機械的に決まるため、規則書本文の穴埋め文を組み立てて進度版へ追記する。
    if (result.enemyKey === "boss|gnoster" && result.rollValue === 5) {
      var groupA = AutoGm.resolveTargets({ kind: "aggroAtLeast1All" }, state.battle, entered.length).map(function (idx) {
        return entered[idx].name;
      });
      var allFrontIdx = AutoGm.resolveTargets({ kind: "frontAll" }, state.battle, entered.length);
      var groupB = allFrontIdx
        .filter(function (idx) {
          return groupA.indexOf(entered[idx].name) === -1;
        })
        .map(function (idx) {
          return entered[idx].name;
        });
      breakdownParts.push(
        window.I18N.t("auto_gm_gnoster_scream_breakdown", { groupA: groupA.join("、") || "—", groupB: groupB.join("、") || "—" })
      );
    }
```

- [ ] **Step 3: i18nキー`auto_gm_gnoster_scream_breakdown`を3言語に追加**

`site_src/i18n_data_zh.py`：

```python
    "auto_gm_gnoster_scream_breakdown": "個別效果：{groupA}承受「HP損害：■×4」，{groupB}承受「HP損害：■×2」，每消耗1個體力骰可減輕「■」。",
```

`site_src/i18n_data_ja.py`：

```python
    "auto_gm_gnoster_scream_breakdown": "個別効果：{groupA}は「HP損害：■×4」を、{groupB}は「HP損害：■×2」を被る。スタミナダイス1個消費ごとに「■」だけ軽減可。",
```

`site_src/i18n_data_en.py`：

```python
    "auto_gm_gnoster_scream_breakdown": "Individual effect: {groupA} take HP damage: ■×4, {groupB} take HP damage: ■×2 (reduce by ■ per stamina die spent).",
```

- [ ] **Step 4: 構文チェックとビルド**

```bash
node --check static_src/boss_auto_gm_data.js static_src/night.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 5: Node上での検証（使い捨て）**

```bash
node -e "
global.window = {};
require('./static_src/boss_auto_gm_data.js');
var data = window.PriTestBossAutoGmData.get('gnoster');
console.log('rows:', data.rows.length, 'rollBonusAfterGuardBreak:', data.rollBonusAfterGuardBreak);
console.log('row8 sequence len:', data.rows[7].groupDamage.sequence.length);
"
```

Expected: `rows: 8 rollBonusAfterGuardBreak: 2`、`row8 sequence len: 3`。

- [ ] **Step 6: Playwright動作確認**

戦場へ`"boss|gnoster"`を編入し、出目8（合体突進）に固定して確定、entered各PCの乱戦ダメージ入力欄に前衛/後衛/敵視1以上の重複を反映した合算値が入ることを確認する。次に出目5（叫び＆滞空）に固定して確定し、進度版に「個別效果：{A}承受...{B}承受...」の文言が実際のPC名で出力されることを確認する。

- [ ] **Step 7: Commit**

```bash
git add static_src/boss_auto_gm_data.js static_src/night.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(night): 新增夜之王「グノスター(格諾斯特)」的自動化GM結構化資料"
```

---

### Task 10: `enemy_auto_gm_data.js` 古龍(`dragon|ancient_dragon`)にsavingThrow拡張を適用

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js:1218-1242`（roll4「地を這う赤雷」・roll5「赤雷叩きつけ」）

**Interfaces:**
- Consumes: Task 3の`savingThrow.targetFilter`と`onFail.elementAccum`/`ailmentAccum`

- [ ] **Step 1: roll4「地を這う赤雷」にsavingThrowを追加**

`static_src/enemy_auto_gm_data.js:1218-1230`の

```js
        {
          // 「地を這う赤雷」：乱戦ダメージ修正－120（「—」ではないため発生、本文に乱戦ダメージの
          // 対象明記なし）。既定ルール（前衛均等割り）。個別効果は全PCプール・敵視分岐DCの判定
          // （敵視:1以上→目標12、それ以外→目標10、フィジカル）で、失敗したPCに【個別ダメージ:
          // 240】＋「雷:1D」を与える。mod欄の「雷:1D」はこの個別判定の失敗時効果と数値が一致する
          // ため二重計上を避けてgroupDamageには付随させず、判定・ダメージ・蓄積のすべてを
          // GM手動処理に委ねる（saving_throw_damage_and_ailment_manual）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          conditions: ["saving_throw_damage_and_ailment_manual"],
        },
```

を

```js
        {
          // 「地を這う赤雷」：乱戦ダメージ修正－120（「—」ではないため発生、本文に乱戦ダメージの
          // 対象明記なし）。既定ルール（前衛均等割り）。個別効果は全PCプール・敵視分岐DCの判定
          // （敵視:1以上→目標12、それ以外→目標10、フィジカル）で、失敗したPCに【個別ダメージ:
          // 240】＋「雷:1D」を与える。mod欄の「雷:1D」はこの個別判定の失敗時効果と数値が一致する
          // ため二重計上を避けてgroupDamageには付随させない。2026-08-24：Task3で拡張した
          // savingThrow.onFail.elementAccumにより、「雷:1D」をTask1裁定の固定値1として自動化
          // する（以前はamountしか反映できなかったため手動処理としていた）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          savingThrow: {
            stat: "physical",
            targetByCondition: [
              { condition: { kind: "aggroAtLeast1" }, target: 12 },
              { condition: { kind: "default" }, target: 10 },
            ],
            onFail: { amount: 240, elementAccum: [{ label: "雷", amount: 1 }] },
          },
        },
```

- [ ] **Step 2: roll5「赤雷叩きつけ」にsavingThrow（targetFilter付き）を追加**

`static_src/enemy_auto_gm_data.js:1231-1242`の

```js
        {
          // 「赤雷叩きつけ」：乱戦ダメージ修正±0（「—」ではないため発生）。既定ルール（前衛均等
          // 割り）。個別効果は「敵視:1以上」のPCのみが対象の判定（11|フィジカル、全PCプールでは
          // なく敵視1以上のみに絞られた部分集合）で、失敗したPCに【個別ダメージ:120】＋「雷:1D」を
          // 与える。対象が全PCプールではなく敵視条件で絞られた部分集合のためsavingThrow（全PC
          // 対象・敵視分岐DC前提）は使わず、本文をそのままGM手動判定に委ねる（conditionsも無し、
          // 数値を捏造しない）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
```

を

```js
        {
          // 「赤雷叩きつけ」：乱戦ダメージ修正±0（「—」ではないため発生）。既定ルール（前衛均等
          // 割り）。個別効果は「敵視:1以上」のPCのみが対象の判定（11|フィジカル、全PCプールでは
          // なく敵視1以上のみに絞られた部分集合）で、失敗したPCに【個別ダメージ:120】＋「雷:1D」を
          // 与える。2026-08-24：Task3で拡張したsavingThrow.targetFilterにより、対象を「敵視:1以上」
          // のみへ絞り込んだ判定として自動化する（以前は全PCプール前提のsavingThrowでは表現
          // できなかったため手動処理としていた）。「雷:1D」はTask1裁定により固定値1。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          savingThrow: {
            stat: "physical",
            targetFilter: { kind: "aggroAtLeast1" },
            targetByCondition: [{ condition: { kind: "default" }, target: 11 }],
            onFail: { amount: 120, elementAccum: [{ label: "雷", amount: 1 }] },
          },
        },
```

- [ ] **Step 3: 構文チェックとビルド**

```bash
node --check static_src/enemy_auto_gm_data.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 4: Playwright動作確認**

`dragon|ancient_dragon|<level>`を戦場へ追加し、出目4・5それぞれに固定して確定、entered中「敵視:0」のPC（roll5では対象外）が判定対象から除外され、対象PCの個別ダメージ欄に120（roll5）/240（roll4）が入り、`pendingDefenseElementAccum`に雷1が記録されることを確認する。

- [ ] **Step 5: Commit**

```bash
git add static_src/enemy_auto_gm_data.js
git commit -m "feat(fields): 古龍「地を這う赤雷」「赤雷叩きつけ」套用savingThrow擴充自動化判定與雷蓄積"
```

---

### Task 11: `enemy_auto_gm_data.js` 王族的幽鬼(`grafted|royal_wraith`)出目6を修正

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js:2092-2101`（roll6「死の叫び」）

**Interfaces:**
- Consumes: なし

- [ ] **Step 1: roll6を修正**

`static_src/enemy_auto_gm_data.js:2092-2101`の

```js
        {
          // 「死の叫び」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果：
          // 「敵視:1以上」のPC全員に「HP損害:■■■」を与える（■は数値未確定のプレースホルダの
          // ため自動計算しない／Global Constraint 1）。スタミナダイス1個を消費するごとに
          // 「HP損害:■」を軽減してもよいのはPC側の任意選択のため自動計算しない
          // （imp_watchdog_gargoyle|hero_gargoyle「咆哮」と同型、reducible_by_stamina_dice）。
          rollMin: 6,
          rollMax: 6,
          conditions: ["unknown_hp_damage_manual", "reducible_by_stamina_dice"],
        },
```

を

```js
        {
          // 「死の叫び」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果：
          // 「敵視:1以上」のPC全員に「HP損害:■■■」を与える。■は本来数値未確定のプレースホルダ
          // （CLAUDE.md §19）だが、2026-08-24使用者裁定によりこの1箇所限定で「実際に描かれた
          // ■の個数（3）をそのまま固定ダメージ値として採用する」方針を採る（他の■表記への
          // 一般適用ではない、docs/superpowers/plans/2026-08-24-night-lord-edele-gnoster-auto-gm.md
          // 参照）。スタミナダイス1個を消費するごとに「HP損害:■」を軽減してもよいのはPC側の
          // 任意選択のため、軽減量自体は自動計算しない（reducible_by_stamina_dice）。
          rollMin: 6,
          rollMax: 6,
          individualDamage: [{ amount: 3, targetRule: { kind: "aggroAtLeast1All" } }],
          conditions: ["reducible_by_stamina_dice"],
        },
```

- [ ] **Step 2: 構文チェックとビルド**

```bash
node --check static_src/enemy_auto_gm_data.js
py -3 generate.py
```

Expected: どちらもエラーなく終了する。

- [ ] **Step 3: Playwright動作確認**

`grafted|royal_wraith|<level>`を戦場へ追加し、出目6に固定して確定、敵視1以上のPC全員の個別ダメージ欄に`3`（＋Time Loss等の加算があれば加算後の値）が入ることを確認する。

- [ ] **Step 4: Commit**

```bash
git add static_src/enemy_auto_gm_data.js
git commit -m "fix(fields): 王族的幽鬼「死の叫び」依使用者裁定將■■■解析為固定傷害值3"
```

---

### Task 12: 死儀礼の鳥／古龍／王族的幽鬼／ミミズ顔たちの既存データ確認（新機構との統合、変更不要の想定）

**Files:**
- 変更なし想定（`static_src/enemy_auto_gm_data.js:1027-1088, 1189-1254, 1386-1451, 2037-2103`は確認のみ）

**Interfaces:**
- Consumes: Task 5の`force_back_row_next_phase`実行時適用

- [ ] **Step 1: 死儀礼の鳥のconditionsが既に正しいことを再確認**

`static_src/enemy_auto_gm_data.js:1386-1451`（`death_bird_raven|death_ritual_bird`）を読み、roll2・roll5に`conditions: ["force_back_row_next_phase"]`が既に付与されていることを確認する（Task 8着手前の調査で確認済み——1402行目・1441行目）。データ変更は不要。

- [ ] **Step 2: ミミズ顔たちのailmentAccum固定値化が既に正しいことを再確認**

`static_src/enemy_auto_gm_data.js:1027-1088`（`troll_dragonkin_wormface|worm_faces`）を読み、roll4（掴みかかり、`ailmentAccum:[{label:"呪死",amount:1}]`）・roll5（吐き出し、個別`ailmentAccum:[{label:"呪死",amount:2}]`）が既にTask1裁定と同じ「Xd→固定値X」の形で構造化済みであることを確認する（調査済み——1062行目、1073行目）。データ変更は不要。

- [ ] **Step 3: 古龍roll3「空中旋回＆滞空」・roll6「炎ブレス＆滞空」が既に正しいことを再確認**

`static_src/enemy_auto_gm_data.js:1207-1217`（roll3）・`1243-1252`（roll6）を読み、両方とも`conditions`に`"force_back_row_next_phase"`が既に含まれ（1216行目・1251行目）、roll6は`groupDamage.elementAccum:[{label:"炎",amount:2}]`で「炎:2D」を固定値化済み（1249行目）であることを確認する（"private/main"版にはこの2点が欠けていたが、本ブランチのour版は既に対応済み——調査で確認済み）。データ変更は不要。

- [ ] **Step 4: 王族的幽鬼roll3「毒吐き」のailmentAccum固定値化が既に正しいことを再確認**

`static_src/enemy_auto_gm_data.js:2059-2069`（`grafted|royal_wraith`roll3）を読み、`groupDamage.ailmentAccum:[{label:"猛毒",amount:1}]`・`individualDamage[0].ailmentAccum:[{label:"猛毒",amount:1}]`の両方が既にTask1裁定と同じ固定値化済みであることを確認する（2066行目・2068行目で確認済み）。データ変更は不要。

- [ ] **Step 5: Playwright統合確認：死儀礼の鳥のforce_back_row_next_phaseが実戦闘で動作することを確認**

`death_bird_raven|death_ritual_bird|<level>`を戦場へ追加し、Task 5で実装した機構がこのデータに対しても正しく動くことをE2Eで確認する：出目2または5に固定して確定→防禦フェイズを抜けて新しい戰鬥フェイズへ進む→entered全員が`battle.front=false`/`battle.back=true`になっていることを確認する（Task 5 Step 6と同じ手順、対象敵をこちらに変えて再実行）。

- [ ] **Step 6: この結果をコミットメッセージ無しで完了とする**

このTaskはコード変更が無いため、`git commit`は不要（確認のみで完了）。確認結果に食い違いがあれば、この時点で該当箇所を修正し個別にコミットする。

---

### Task 13: 全体統合検証

**Files:**
- 変更なし（検証のみ）

- [ ] **Step 1: 全体構文チェック**

```bash
node --check static_src/auto_gm.js
node --check static_src/night.js
node --check static_src/boss_auto_gm_data.js
node --check static_src/enemy_auto_gm_data.js
```

Expected: すべてエラーなく終了する。

- [ ] **Step 2: フルビルド**

```bash
py -3 generate.py
```

Expected: `Generated site into ...\dist`、エラーなし。

- [ ] **Step 3: ローカルサーバ起動とPlaywright総合シナリオ**

```bash
python -m http.server 8000 --directory dist
```

Playwrightで以下を1セッション内に通す（password dialog処理を含む）：
1. Adminで新規ゲーム作成（`storageMode:"local"`）。
2. `night/index.html?game=<id>`を開き、戦闘を開始。
3. `"boss|edele"`を編入し、出目1~2・3~4・5~6・7~8・9~10の5パターンをそれぞれ擲骰確定し、進度版の内訳表示にエラーが出ないこと・加重配分（3~4）が正しく機能することを確認。
4. `"boss|gnoster"`を編入し、出目1~8の8パターンをそれぞれ擲骰確定し、savingThrow（4）・■手動フォールバックのA/B内訳（5）・majorityAreaAggroMax（6）・sequence合算（8）がいずれもエラーなく動作することを確認。
5. `dragon|ancient_dragon`・`grafted|royal_wraith`・`death_bird_raven|death_ritual_bird`をそれぞれ戦場へ追加し、修正した出目（古龍4/5、王族的幽鬼6、死儀礼の鳥2/5）を確定してエラーが出ないことを確認。

Expected: いずれの手順でもJavaScriptエラー（コンソール）が発生しないこと。

- [ ] **Step 4: 最終まとめコミット（必要な場合のみ）**

Step 3で発見した細かい修正がある場合はこの時点で個別にコミットする。問題が無ければこのTaskはコミット不要（既存の各Taskコミットで完結している）。
