# 全敵人自動化GM對應 Master Plan（夜王／夜之強敵／敵人）

> **2026-08-28 更新：Phase 1（夜王6体：fulghor/caligo/libra/harmonia/stragedes/nameless）は全Task（Task 0〜6）が実装・commit・merge済み（commit `76c915a`〜`4b92d9a`、`node --check`通過確認済み）。夜王10体は全て`boss_auto_gm_data.js`に構造化済み。統合検証Task（Playwright回帰確認・whole-branchレビュー・push）の実施有無は本更新時点で未確認——次にPhase 1の仕上げ確認を行うか、Phase 2/3へ進むかはユーザー判断待ち。詳細は`docs/enemy_auto_gm_coverage_audit.md`（2026-08-28更新版）を参照。**
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **本Planは3フェーズ構成**：Phase 1（夜王6体）はTask単位まで詳細化済みで実行完了。Phase 2（夜之強敵、劇本8/9の8体）・Phase 3（一般敵人111体）は対象一覧とアプローチのみ記載し、着手時に別途詳細タスクへ展開する（今回のセッションでPhase 2/3のいずれかの詳細タスク化・実行に進むかはユーザー確認待ち）。
>
> **並行実行に関する注意**：Phase 1のTask 0（多形態トグルの汎用化）は`night.js`/i18nを変更するロジックタスクであり、他の全Taskの前提となるため**単独で先行実行**する。Task 0完了後、Batch A（Task 1〜3：fulghor/caligo/libra、単一形態）とBatch B（Task 4〜6：harmonia/stragedes/nameless、多形態、Task 0のトグルに依存）に分け、各Batch内は`boss_auto_gm_data.js`という単一ファイルへの追記のみで独立しているため並行worktree dispatch可能（設計文書の決定事項参照）。Batch BはTask 0完了後にのみ開始する。

**Goal:** 夜王9体＋`nameless`（劇本10の実際のボス、`night_bosses.js`名簿には未掲載）のうち未対応の6体（fulghor/caligo/libra/harmonia/stragedes/nameless）に対し、`boss_auto_gm_data.js`の擲骰オーバーレイ（出目→行動→傷害／対象／属性蓄積の自動化）を追加する。多形態ボス（harmonia/stragedes/nameless）については、既存の`bossForm`（gladiusの合体/分裂トグル）を汎用化して再利用し、形態遷移自体はGM手動（既存の運用方針を踏襲、docs/enemy_damage_rules.mdに明記済みの制限）のまま、各形態の行動決定のみ自動化する。

**Architecture:** 既存の加算的オーバーレイ設計（`boss_auto_gm_data.js`が読み取り専用の構造化データ、`auto_gm.js`が計算専用の純粋関数群、`night.js`側`handleAutoGmRollClick`が唯一のstate書き込み元）を踏襲する。Task 0のみ`night.js`の表示ロジック（`renderAutoGmBossFormToggle`）と`site_src/i18n_data_*.py`を変更する——これは「合体/分裂」ラベルが`gladius`専用にハードコードされているのを、`structured.formLabels`（ボスごとの2形態ラベル）で上書きできるよう汎用化するもので、既存のgladius動作（`formLabels`未指定時は従来通り「合体形態／分裂形態」）を壊さない後方互換の拡張。

**Tech Stack:** Vanilla ES5 JS（IIFE + `window.PriTest*`名前空間）。自動テストフレームワークなし——検証は`node --check`（構文）、`py -3 generate.py`（ビルド）、Playwrightまたはclaude-in-chromeの使い捨てスクリプト（コミットしない）。

## Global Constraints

- `■`は自動計算しない（CLAUDE.md §19）。本文に「HP損害：■■」等とあり、既存の類似パターン（`fields_data_*.js`の`hpDamage`ではなく、`boss_auto_gm_data.js`ではその行の`groupDamage`/`individualDamage`に数値がある場合はそのまま数値として構造化し、■のみが単独で出現する箇所——例えばfulghor出目7「腕乱舞」の「HP損害：■■」——は`conditions`配列へ本文原文を記録し、`night.js`側では自動計算せずGM向けリマインドに留める。stragedes出目「—/5」の「HP損害：■■■」も同様）。
- `Xd`表記は、技能本文に別途「振る」指示が無い限り固定蓄積値Xと同一視してよい（`docs/enemy_damage_rules.md` §1.1、2026-08-24ユーザー裁定）。
- 修正範囲は`boss_auto_gm_data.js`のデータ追加＋Task 0の限定的なnight.js/i18n拡張のみ。既存のgladius/maris/edele/gnosterのデータやロジックは変更しない。
- 各Taskの完了時に`node --check`対象ファイルと`py -3 generate.py`を実行し、エラーが無いことを確認してからコミットする。
- commit message規則：`feat(night): 新增夜之王「<ja名>(<zh名>)」的自動化GM結構化資料`（既存のedele/gnosterと同じパターン）。
- Playwright／claude-in-chrome検証スクリプトは使い捨てで、リポジトリにコミットしない。
- 最終push先は`private`遠端の新規ブランチ`auto-allenemy`のみ（`origin`へは推送しない、前回タスクの決定を踏襲）。

---

## Phase 1: 夜王（Night Lords）6体 —— 本セッションで実行

### 前提：既存の実装済み4体との差分認識

`boss_auto_gm_data.js`には`maris`（27〜108行）／`gladius`（109〜171行、`formAware`パターン）／`edele`（172〜240行、`rollBonusAfterGuardBreak`）／`gnoster`（241〜358行、`savingThrow`/`groupDamage.sequence`拡張）が既に構造化済み。新規6体もこれらのパターン・ヘルパーをそのまま再利用し、新しい機構は原則追加しない（Task 0の1件のみ例外）。

### Task 0: 多形態トグルのラベル汎用化（`formLabels`対応）

**Files:**
- Modify: `static_src/night.js`（`renderAutoGmBossFormToggle`関数、8853〜8866行付近）
- Modify: `site_src/i18n_data_zh.py` / `_ja.py` / `_en.py`（新規汎用ラベルキー追加）

**Interfaces:**
- Consumes: `AutoGm.isFormAware(key)`（既存）、`state.battle.bossForm`（既存、値は引き続き`"fused"`/`"split"`の2値のまま——ボス固有の意味付けはラベル側で吸収し、state schemaは変更しない）
- Produces: `boss_auto_gm_data.js`の各エントリに任意で`formLabels: { fused: C(ja1, zh1), split: C(ja2, zh2) }`を持たせられるようになる。未指定時（既存gladius）は現行の「合体形態／分裂形態」にフォールバックする。

- [ ] **Step 1: 現状の`renderAutoGmBossFormToggle`を確認**

`static_src/night.js:8853-8866`を読み、現状を確認する：

```js
  function renderAutoGmBossFormToggle() {
    var formRow = document.getElementById("auto-gm-boss-form-row");
    var btn = document.getElementById("btn-auto-gm-boss-form-toggle");
    if (!formRow || !btn) return;
    var AutoGm = window.PriTestAutoGm;
    var select = document.getElementById("auto-gm-enemy-select");
    var key = select && select.value;
    if (!AutoGm || !key || !AutoGm.isFormAware(key)) {
      formRow.hidden = true;
      return;
    }
    formRow.hidden = false;
    var form = (state.battle && state.battle.bossForm) || "fused";
    btn.textContent = window.I18N.t(form === "split" ? "auto_gm_boss_form_split_label" : "auto_gm_boss_form_fused_label");
  }
```

- [ ] **Step 2: `structured.formLabels`を参照するよう修正**

`AutoGm`が該当キーの構造化データ（`structured`）を取得できるヘルパーが無い場合、`static_src/auto_gm.js`の既存の解決関数（`resolveStructuredData(key)`相当、`isFormAware`の実装を参照して同じ経路を使う）を確認し、`formLabels`を読めるようにする。修正後のコードイメージ：

```js
  function renderAutoGmBossFormToggle() {
    var formRow = document.getElementById("auto-gm-boss-form-row");
    var btn = document.getElementById("btn-auto-gm-boss-form-toggle");
    if (!formRow || !btn) return;
    var AutoGm = window.PriTestAutoGm;
    var select = document.getElementById("auto-gm-enemy-select");
    var key = select && select.value;
    if (!AutoGm || !key || !AutoGm.isFormAware(key)) {
      formRow.hidden = true;
      return;
    }
    formRow.hidden = false;
    var form = (state.battle && state.battle.bossForm) || "fused";
    var structured = AutoGm.getStructuredData ? AutoGm.getStructuredData(key) : null;
    var labels = structured && structured.formLabels;
    if (labels && labels[form]) {
      btn.textContent = window.PriTestFields.localizedText(labels[form]);
    } else {
      btn.textContent = window.I18N.t(form === "split" ? "auto_gm_boss_form_split_label" : "auto_gm_boss_form_fused_label");
    }
  }
```

（`AutoGm.getStructuredData`が既存に無い場合は、`isFormAware`が内部で使っている同じ解決ロジック——`static_src/auto_gm.js`の`isFormAware`実装、13〜42行付近を参照——を`getStructuredData`としてexportに追加する。`window.PriTestFields.localizedText`は既存の`{ja,zh}`オブジェクト解決ヘルパー、`static_src/fields.js`で定義済み）

- [ ] **Step 3: `static_src/auto_gm.js`に`getStructuredData`をexport（既存関数の再利用のみ、新規ロジックなし）**

`isFormAware`関数の実装を確認し（13〜42行付近）、内部で使っている「keyから構造化データを引く」ロジックを別関数`getStructuredData(key)`として切り出し、`isFormAware`からもそれを呼ぶ形にリファクタリングする。`window.PriTestAutoGm`のexportに`getStructuredData: getStructuredData`を追加する。

- [ ] **Step 4: 構文チェック**

```bash
node --check static_src/auto_gm.js
node --check static_src/night.js
```

- [ ] **Step 5: gladiusで後方互換を確認（Node上の使い捨て検証）**

```bash
node -e "
global.window = {};
require('./static_src/boss_auto_gm_data.js');
require('./static_src/auto_gm.js');
var AutoGm = window.PriTestAutoGm;
console.log('gladius formLabels (should be undefined):', AutoGm.getStructuredData('boss|gladius').formLabels);
"
```

Expected: `undefined`（gladiusには`formLabels`を追加しないため、既存のフォールバック文言がそのまま使われることを確認）。

- [ ] **Step 6: Commit**

```bash
git add static_src/night.js static_src/auto_gm.js
git commit -m "feat(night): 多形態夜之王的形態切換按鈕標籤支援formLabels自訂(向下相容gladius既有文言)"
```

---

### Task 1: `fulghor`（夜光の騎士、フルゴール）—— 単一形態、`rollBonusAfterGuardBreak`あり

**Files:**
- Modify: `static_src/boss_auto_gm_data.js`

**規則書原文**（`night_boss_rulebook.js:339-396`）：
- 特殊能力「疾走」：次のアクションフェイズ開始時、最大出目のスタミナダイスが2個以下のPCは後衛配置——`night.js`側に対応する汎用機構が無いため、GM向け`note`として記録するに留める（新規state機構は追加しない）。
- 特殊能力「行動激化」：体勢崩し後、戦闘終了まで`1D`ではなく`1D＋2`で判定 → `rollBonusAfterGuardBreak: 2`
- 特殊能力「回避困難」：ダイスコスト半減の回避ルール——これはPC側の回避処理ロジックの話でGM自動化の対象外（`conditions`にタグのみ記録）
- 出目1「風起こし＆疾走」：乱戦ダメージ1260（対象記述なし→既定の`frontAll`）、個別効果「敵視：最大」PC1体に個別ダメージ240（`targetRule: {kind:"aggroMax"}`）、特殊能力「疾走」発揮（`conditions: ["speed_backrow_note"]`、body注記）
- 出目2「両刃剣乱舞」：乱戦ダメージ1080（`frontAll`）、個別効果（2回実行）：乱戦ダメージ対象となった前衛かつ敵視1以上のPC1体に個別ダメージ180×2回（`individualDamage`配列に同じエントリを2つ、`targetRule: {kind:"frontAggroAtLeast1All"}`を踏まえて対象PCの中から2回分と解釈——具体的な「2回実行、対象は乱戦対象からの絞り込み」の表現は既存の`individualDamage`配列の複数エントリパターンで表現する）
- 出目3「突進斬り上げ＆疾走」：乱戦ダメージ960（`frontAll`）、「敵視：1以上のPCはスタミナダイス1個消費」はPC側処理のため`conditions`にnote、「疾走」発揮
- 出目4「追尾する光の雨」：乱戦ダメージ列は「—」（乱戦ダメージなし）、個別効果：PC全員に個別ダメージ180＋「聖：2」（`targetRule:{kind:"allPCs"}`）、個別効果：敵視1以上のPC全員に個別ダメージ180＋「聖：2」（`targetRule:{kind:"aggroAtLeast1All"}`）——2つの`individualDamage`エントリとして構造化（「回避困難」特殊能力の適用は`conditions`へnote）
- 出目5「聖槍爆発」：乱戦ダメージ1080＋「聖：1D」（Xd=固定値1裁定によりelementAccum固定値1、`frontAll`）、個別効果：敵視1以上PC全員に個別ダメージ300＋「聖：1D」（固定値1）
- 出目6「連続突進＆疾走」：乱戦ダメージ列「—」、個別効果：敵視1以上PC全員に個別ダメージ240、個別効果：敵視最大PC全員に個別ダメージ240（2つの`individualDamage`エントリ）、「疾走」発揮
- 出目7「腕乱舞」：乱戦ダメージ1200（`frontAll`）、個別効果：敵視最大PC全員に「HP損害：■■」——■のみのため自動計算せず`conditions`へ本文記録
- 出目8「腕叩きつけ」：乱戦ダメージ1320（`frontAll`）、個別効果：敵視1以上PC全員が〈11｜フィジカル〉判定、失敗者に個別ダメージ180（`savingThrow`機構、`stat:"physical"`、目標値11、`onFail:{amount:180}`）。「次のアクションフェイズ開始時獲得スタミナダイス1個減少」は既存の汎用state機構が無いためGM向け`note`。

- [ ] **Step 1: worktree前提確認**

```bash
git status
git log --oneline -3
```

- [ ] **Step 2: `fulghor`エントリを実装**

`static_src/boss_auto_gm_data.js`の`DATA`オブジェクトへ、既存の`edele`/`gnoster`と同じ構造で`"fulghor"`キーを追加する（`rollBonusAfterGuardBreak: 2`、`rows`配列に上記出目1〜8を構造化。参考パターンは既存の`edele`/`maris`エントリ）。

- [ ] **Step 3: `node --check`で構文確認**

```bash
node --check static_src/boss_auto_gm_data.js
```

- [ ] **Step 4: Node上での検証（使い捨て）**

```bash
node -e "
global.window = {};
require('./static_src/boss_auto_gm_data.js');
var data = window.PriTestBossAutoGmData.get('fulghor');
console.log('rows:', data.rows.length, 'rollBonusAfterGuardBreak:', data.rollBonusAfterGuardBreak);
"
```

Expected: `rows: 8 rollBonusAfterGuardBreak: 2`

- [ ] **Step 5: Commit**

```bash
git add static_src/boss_auto_gm_data.js
git commit -m "feat(night): 新增夜之王「フルゴール(弗爾格爾)」的自動化GM結構化資料"
```

---

### Task 2: `caligo`（夜の霞、カリゴ）—— 単一形態、`rollBonusAfterGuardBreak`あり

**Files:**
- Modify: `static_src/boss_auto_gm_data.js`

**規則書原文**（`night_boss_rulebook.js:397-451`）：
- 特殊能力「氷霜の戦場」：条件発揮時、前衛PC全員が「凍傷：1D」（固定値1裁定）——各出目行の`conditions`に該当行のみタグ付けし、`elementAccum`は各行の乱戦ダメージ側に含める形で表現（本文が「特殊能力『氷霜の戦場』の効果発揮」と書かれている行のみ適用）
- 特殊能力「行動激化」：`rollBonusAfterGuardBreak: 2`
- 特殊能力「竜特攻」：公開情報（`night_gm_flow.js`の公開情報特殊能力表示の対象——本Taskでは`enemy.special`相当のテキストが無いため対象外、ボスの特殊能力表示は別の仕組み。今回はconditionsコメントのみで良い）
- 出目1「尻尾叩きつけ＆氷霜」：乱戦ダメージ1080＆「凍傷：2」、「敵視：1以上」で前衛のPC全員「乱戦ダメージ：2人分」→ `targetRule: {kind:"frontAggroAtLeast1All"}`、氷霜の戦場発揮
- 出目2「前方ブレス」：乱戦ダメージ960＆「凍傷：2」（`allPCs`）、個別効果：敵視最大PC1体に追加ダメージ240＋「凍傷：2」
- 出目3「足元ブレス＆氷霜」：乱戦ダメージ900＆「凍傷：2」、ガード不可（`conditions:["no_guard"]`）、次アクションフェイズ終了までHP価値+10（`conditions:["enemy_hp_value_buff"]`）、氷霜の戦場発揮
- 出目4「とびかかり＆氷霜」：乱戦ダメージ列は基本記述なし（対象は敵視最大PCが多いエリア全員）＋「敵視：最大」PC全員「乱戦ダメージ：2人分」→ `targetRule: {kind:"majorityAreaAggroMax"}`（gnosterで新設済みの機構を再利用）、金額1140、氷霜の戦場発揮
- 出目5「氷嵐＆氷霜」：乱戦ダメージ1080＆「凍傷：4」（`frontAll`）、「HP損害：■（1点）以上を被ったPCは次アクションフェイズ前衛配置＋エリア移動不可」は■を含む条件付き効果のため自動化せず`conditions`へnote、氷霜の戦場発揮
- 出目6「広範囲氷柱落とし」：このディフェンスフェイズは行動しない、次のディフェンスフェイズ開始時に後衛PC全員へ個別ダメージ420＋「凍傷：2D」（固定値2）を与えてから改めてアクション決定——ターンをまたぐ特殊な発動タイミングのため自動化困難、`rows`には含めず`conditions`コメントとして本文をそのまま記録し、GM手動運用とする（既存のgnoster「毒性の卵」等と同じ「対象範囲外」の扱い）
- 出目7「広範囲冷風＆氷霜」：乱戦ダメージ列「—」、個別効果：敵視1以上PC全員〈12｜運試し〉、それ以外〈10｜運試し〉、失敗者に個別ダメージ300＋「凍傷：3」（`savingThrow`、`targetByCondition`で敵視の有無により目標値を分岐、既存gnosterの実装パターンを参照）。「次アクションフェイズ開始時獲得スタミナダイス2個減少」はGM向けnote。氷霜の戦場発揮
- 出目8「空中連続突進」：乱戦ダメージ列「—」、個別効果（3回実行）：敵視1以上PC1体に個別ダメージ300＋「凍傷：2」（`individualDamage`、`conditions`に「3回実行」を明記）、次アクションフェイズPC全員後衛配置は`force_back_row_next_phase`タグを使用（既存の実行時適用機構をそのまま再利用）

- [ ] **Step 1〜5**: Task 1と同じ手順（worktree確認→実装→`node --check`→Node検証→commit）。

commit message: `feat(night): 新增夜之王「カリゴ(卡利戈)」的自動化GM結構化資料`

---

### Task 3: `libra`（夜の魔、リブラ）—— 単一形態、`rollBonusAfterGuardBreak`なし、モブHP特殊機構あり

**Files:**
- Modify: `static_src/boss_auto_gm_data.js`

**規則書原文**（`night_boss_rulebook.js:281-338`）：
- 特殊能力「発狂の種」「モブHP『滞留魔法陣』の扱い」「魔法陣滞留による行動内容指定」：モブHP（滞留魔法陣）の有無で次のディフェンスフェイズの行動が無条件に決まる（1Dを振らない）という、既存の`rows`ベースの出目決定モデルと根本的に異なる制御フローのため、この3つの特殊能力は`rows`に含めず、`boss_auto_gm_data.js`のエントリ冒頭コメントとしてGM向けに全文記録するに留める（gladiusの分裂/合体のような既存機構への統合は本Taskの範囲外——将来的な拡張候補として明記）。
- **重要**：`libra`には「行動激化」が無いため`rollBonusAfterGuardBreak`は設定しない（出目1〜6の標準6行＋出目なしの特殊トリガー2行のみ）。
- 出目1「錫杖振り回し」：乱戦ダメージ960＆「発狂：1D」（固定値1）、前衛の中で敵視最大PC全員「乱戦ダメージ：2人分」→ `targetRule:{kind:"frontAggroMaxAll"}`（既存kind、要確認——無ければ`aggroMax`＋`front`条件の組み合わせで対応する既存パターンを踏襲）
- 出目2「転移＆錫杖薙ぎ払い」：乱戦ダメージ1080＆「発狂：2」、`targetRule:{kind:"majorityAreaAggroMax"}`（gnoster流用）、次アクションフェイズ終了までHP価値+10（`conditions:["enemy_hp_value_buff"]`）
- 出目3「発狂のつぶて＆発狂の種」：乱戦ダメージ720＆「発狂：1D」（固定値1）、`targetRule:{kind:"aggroAtLeast1All"}`（対象0人ならGMが目視で前衛にフォールバック——`night.js`側の`resolveTargets`が空配列を返した場合の既存フォールバック動作を確認し、無ければ`conditions`にnote）、「発狂の種」特殊能力発揮は`conditions`コメントのみ（モブ機構と連動するため自動化しない）
- 出目4「転移＆魔法陣展開＆発狂の種」：乱戦ダメージ840＆「発狂：2」（対象記述なし→`frontAll`が既定）、個別効果：敵視1以上PC全員〈11｜運試し〉、失敗者に個別ダメージ180＋「発狂：1D」（固定値1）（`savingThrow`）、次アクションフェイズ終了までHP価値+10
- 出目5「狂乱の雲」：乱戦ダメージ列「—」、個別効果：敵視1以上PC〈メンタル｜12〉・それ以外〈メンタル｜10〉、成功者「発狂：1D」（固定値1）・失敗者「発狂：2D」（固定値2）——`savingThrow`は従来「失敗時のみ効果」だが本行は成功/失敗どちらも異なる蓄積を受けるため、`onFail`（2D=2）に加えて成功時用の新規`onPass`相当のフィールドが必要になる可能性がある。既存`resolveSavingThrow`の戻り値（`passed`真偽）を`night.js`側で両方分岐させるだけで対応可能か確認し、`auto_gm.js`側の新規フィールド追加が必要な場合は本Task内で追加してよい（Global Constraints「新機構は原則追加しない」の例外として許容——savingThrowの表現力拡張は複数ボスで再利用される可能性が高いため）。
- 出目6「結跏趺坐＆滞留魔法陣生成＆発狂の種」：HP枠にモブ1（滞留魔法陣）追加、既存モブHPがあれば最大値まで回復、「最大HP：PC人数×2」——これは`enemy.special`のモブHP自動追加機構（`parseMobMaxHpOverride`等、`night_gm_flow.js`）とは別に、ボスの出目に紐づくモブ追加のため、既存の`enemy_auto_gm_data.js`側のモブHP追加パターン（もしあれば）を参照し、無ければ`conditions`へGM向けnoteとして記録する。乱戦ダメージ・傷害欄は「—」につき無し。
- 特殊トリガー行「両腕連続叩きつけ」「逃れ得ぬ発狂の瞳＆発狂の種」：出目に紐づかない強制発動（モブHP状態依存）のため、rows外の別セクション（コメント）として全文記録する（gnosterの「毒吐き」トリガー行と同じ扱い）。

- [ ] **Step 1〜5**: Task 1と同じ手順。ただし出目5の`savingThrow`拡張要否は実装時に`auto_gm.js`の現状を確認してから判断すること（要否・拡張内容を報告に明記する）。

commit message: `feat(night): 新增夜之王「リブラ(利布拉)」的自動化GM結構化資料`

---

### Task 4: `harmonia`（救いの旗手／英雄武器の娘たち）—— 多形態、Task 0のトグルに依存

**Files:**
- Modify: `static_src/boss_auto_gm_data.js`（Task 0完了後のブランチから分岐すること）

**規則書原文**（`night_boss_rulebook.js:452-512`）：
- 特殊能力「形態変化」：HP0到達時、次アクションフェイズ開始時に第二形態へ移行（全HP行・ガード回数最大値回復、属性/状態異常蓄積0）。**この移行の自動検知・自動実行は本Taskの範囲外**（`docs/enemy_damage_rules.md`に既知の制限として明記済み）。GMが`state.battle.bossForm`トグル（Task 0で汎用化済み）を手動で切り替える運用とする。
- 特殊能力「散開」：次アクションフェイズ終了までHP価値+10（`conditions:["enemy_hp_value_buff"]`）
- 特殊能力「生きた娘」：第二形態限定、ディフェンスフェイズ開始ごとに〈11｜メンタル〉、PC半数以上失敗でエネミーHP価値+10＆傷害+120——ディフェンスフェイズ開始時の自動判定という既存の出目行モデルと異なるタイミングのため、`rows`には含めずコメントでGM向けに記録する。
- `formLabels`: `{ fused: C("第一形態", "第一形態"), split: C("第二形態", "第二形態") }`（`fused`=第一形態、`split`=第二形態として内部的に流用。ラベルのみ意味が変わる点をコメントで明記すること）
- **第一形態の出目**（1〜6、`formAware`の`fused`側）：
  - 1~2「個別攻撃＆散開」：乱戦ダメージ600、乱戦ダメージ2回発生（`groupDamage.repeat`相当、既存機構を確認）、散開発揮
  - 3~4「集中攻撃」：乱戦ダメージ列「—」、個別効果（2回実行）：敵視1以上PC全員に個別ダメージ300
  - 5「聖槍の壁」：乱戦ダメージ900、前衛の中で敵視最大PC全員「乱戦ダメージ：2人分」、次アクションフェイズ終了までPC全員エリア移動不可（GM向けnote、既存の汎用state機構なし）
  - 6「掴み攻撃＆散開」：乱戦ダメージ列「—」、個別効果：前衛の中で敵視最大PC1体に個別ダメージ360、ガード不可、散開発揮
- **第二形態の出目**（1〜6、`formAware`の`split`側）：
  - 1~2：（第一形態と同じ行を再利用、規則書の表は「第一形態」列と「第二形態」列を共有する行がある——1~2行は第一形態専用のためこの範囲は第二形態には存在しない。実際には規則書の並びに従うと、第二形態の1~2は「—」（規則書表の「—」列参照）となっており、対応する行が無い。実装時に規則書原文（`night_boss_rulebook.js:504-510`の6行の第一形態列／第二形態列を注意深く突き合わせて、正しい出目範囲マッピングを構築すること——本文をそのまま転記すると誤読しやすいため、実装者は必ず原文の生データ（`night_boss_rulebook.js`の該当行）を`Read`で確認してから構造化する）
  - 1「聖槍の壁」（第二形態の1のみ、第一形態の5と同じ内容を参照）
  - 2「掴み攻撃＆散開」（第二形態の2のみ、第一形態の6と同じ内容）
  - 3~4「瞬間移動＆乱舞」：乱戦ダメージ900、後衛PC全員が対象、敵視1以上PC全員「乱戦ダメージ：2人分」、次アクションフェイズ開始時獲得スタミナダイス1個減少（GM向けnote）
  - 5~6「一斉射撃＆散開」：乱戦ダメージ1200（`allPCs`）、個別効果：敵視最大PC全員に個別ダメージ300、散開発揮

  **重要**：上記の第一形態/第二形態マッピングは規則書原文の表構造の読み取りに基づく暫定整理であり、実装者は必ず`night_boss_rulebook.js:503-511`を直接`Read`して正確な出目対応表を再構築すること（本Planの記述と原文に食い違いがあれば原文を優先する）。

- [ ] **Step 1: worktree前提確認（Task 0完了後のコミットから分岐していることを確認）**

```bash
git log --oneline -5
```

Expected: Task 0のcommit（`formLabels`対応）が履歴に含まれていること。

- [ ] **Step 2: `night_boss_rulebook.js:452-512`を`Read`で直接確認し、正確な出目対応表を構築**

- [ ] **Step 3: `harmonia`エントリを`formAware: true`＋`formLabels`＋`rows`（各rowに`form: "fused"`または`"split"`を付与、既存gladiusの`formAware`実装パターンを参照）で実装**

- [ ] **Step 4〜6**: `node --check`→Node検証（`formAware`/`formLabels`の値を確認）→commit

commit message: `feat(night): 新增夜之王「ハルモニア(哈爾摩尼亞)」的自動化GM結構化資料`

---

### Task 5: `stragedes`（反逆のストラゲス／衝動のストラゲス）—— 多形態、モブ関連特殊能力あり

**Files:**
- Modify: `static_src/boss_auto_gm_data.js`

**規則書原文**（`night_boss_rulebook.js:513-578`）：
- 特殊能力「形態変化」：Task 4と同じ扱い（GM手動トグル）
- 特殊能力「亡者召喚」：HP枠にモブ追加（`最大HP：PC人数×3`、モブHPが既にあれば最下行に追加）——既存のモブHP自動追加パターン（`night_gm_flow.js`の`addAutoMobHpRow`等）が擲骰オーバーレイからも呼べるか確認し、呼べない場合は`conditions`へGM向けnoteとして記録
- 特殊能力「モブ自壊」：エンドフェイズ開始時、モブHP存在時に「モブ損害：■×PC人数」＋PC全員へ「腐敗：同値」——エンドフェイズ起点の自動処理で、■を含むため自動化困難。`rows`には含めず、エントリコメントとして規則書原文を記録するに留める。
- 特殊能力「瓦礫生成」：第二形態移行時に前衛エリアへ「瓦礫」生成——形態遷移自体が手動運用のため、この特殊能力もGM向けnoteに留める。
- 第一形態の出目1~2「横薙ぎ連打」：乱戦ダメージ780、敵視1以上で前衛PC全員「乱戦ダメージ：2人分」、乱戦ダメージ2回発生
- 第一形態の出目3~4「腐敗飛散＆亡者召喚」：乱戦ダメージ列「—」、個別効果：敵視1以上PC1体に個別ダメージ240＋「腐敗：3」を「PC人数」回行う（`individualDamage`の繰り返し回数をPC人数分にする新規パターン——既存に無ければ`conditions`へ「PC人数回実行」の注記に留め、`amount`は1回分のみ構造化する。gnosterの「連続挟み込み＆誘導弾」で採用された「PC人数回実行」解釈——対象全員に1回ずつ——を踏襲できるか本文を確認すること）、「亡者召喚」発揮
- 第一形態の出目5「叩きつけ＆引き寄せ」：乱戦ダメージ1080（`aggroMax`が既定と推定、本文に対象記述なし——`frontAll`か`aggroMax`か実装時に本文全体の文脈から判断）、個別効果：敵視最大PC全員が次アクションフェイズ開始時獲得スタミナダイス2個減少（GM向けnote）
- 第一形態の出目6「腐敗地割れ＆亡者召喚」：乱戦ダメージ1200＆「腐敗：1D」（固定値1）、`allPCs`、「亡者召喚」発揮
- 第二形態の出目1~2「柱張り付き＆突進」：乱戦ダメージ1080、回避時ダイスコスト半減（GM向けnote）、次アクションフェイズ終了までHP価値+10
- 第二形態の出目3~4「腐敗散弾＆跳躍叩きつけ」：乱戦ダメージ840＆「腐敗：2」、個別効果：敵視1以上PC全員に個別ダメージ180＋「腐敗：1D」（固定値1）
- 第二形態の出目5「咆哮＆腐敗噴出」：乱戦ダメージ列「—」、個別効果：前衛PC全員「HP損害：■■■」（■のためGM向けnoteに留める）、個別効果：敵視最大PC1体に個別ダメージ180＋「腐敗：2」
- 第二形態の出目6「薙ぎ払い＆腐敗地割れ」：乱戦ダメージ1080＆「腐敗：2」、個別効果：敵視1以上PC全員〈12｜運試し〉・それ以外〈10｜運試し〉、失敗者に個別ダメージ120＋「腐敗：1D」（固定値1）（`savingThrow`）

- [ ] **Step 1〜6**: Task 4と同じ手順（`night_boss_rulebook.js:513-578`を直接`Read`確認 → `formAware`実装 → 検証 → commit）。

commit message: `feat(night): 新增夜之王「ストラゲス(斯特拉格斯)」的自動化GM結構化資料`

---

### Task 6: `nameless`（夜の輪郭／夜の王、ナメレス）—— 多形態、2D6追加効果決定表あり

**Files:**
- Modify: `static_src/boss_auto_gm_data.js`

**規則書原文**（`night_boss_rulebook.js:579-655`）：
- 特殊能力「形態変化」：Task 4/5と同じ扱い
- 特殊能力「属性による弱体」：エネミーが「属性：聖」で属性損害を受けた場合の反応効果——PC側のダメージ計算に依存するため既存の汎用機構が無く、GM向けnoteに留める
- 特殊能力「追加効果」＋`additionalEffectTable`（2D6×9列の属性/状態異常決定表、`night_boss_rulebook.js:632-645`）：「※追加効果：ND」と記述された箇所は、2顆骰を振って`additionalEffectTable`を参照する。既存の「強敵決定表」（`event_rulebook.js`の`extraTables`、2顆骰×12列）と同型の構造のため、`night_gm_flow.js`の`rollStrongEnemyTable`/`resolveStrongEnemyEntry`パターンを参考に、`boss_auto_gm_data.js`側に`additionalEffectTable`データを持たせ、`auto_gm.js`または`night.js`側に対応する解決関数を追加する必要がある可能性が高い（既存に汎用的な「2D6決定表」ヘルパーがあれば再利用、無ければ本Task内で最小限追加してよい——savingThrow拡張と同様、複数箇所で再利用される可能性が高いためGlobal Constraintsの例外として許容）。
- 特殊能力「浮遊」：次アクションフェイズ終了までHP価値+10、第二形態移行ターンのアクションフェイズはPCの行動制限（GM向けnote）、第二形態移行ターンのディフェンスフェイズは1Dを振らず自動的に「属性爆発＆浮遊」を実行——`libra`の特殊トリガー行と同様、出目に紐づかない強制発動のため`rows`には含めずコメント記録
- 第一形態の出目1~2「直剣突き＆大剣薙ぎ払い」：乱戦ダメージ1200、前衛の中で敵視最大PC全員「乱戦ダメージ：3人分」
- 第一形態の出目3~4「2連斬り＆魔力の刃」：乱戦ダメージ1080＆「魔：2」、個別効果（2回実行）：敵視1以上PC1体に個別ダメージ240
- 第一形態の出目5「咆哮4連斬り」：乱戦ダメージ列「—」、個別効果（4回実行）：敵視1以上PC1体に個別ダメージ180＋「※追加効果：1D」（追加効果決定表を1回参照）
- 第一形態の出目6「とびかかり＆光波2連」：乱戦ダメージ1200＆「追加効果：2D」（追加効果決定表を2回参照）、個別効果：敵視1以上PC全員に個別ダメージ300＋「魔：4」
- 第二形態の出目3~4「属性爆発＆浮遊」：乱戦ダメージ600＆「追加効果：2D」、乱戦ダメージ2回発生・2回目は敵視1以上PC全員が対象（`groupDamage.sequence`機構、gnosterの「合体突進」と同型）、浮遊発揮
- 第二形態の出目5~6「属性剣乱舞＆浮遊」：乱戦ダメージ900＆「追加効果：1D」、個別効果：敵視1以上PC全員〈12｜運試し〉・それ以外〈10｜運試し〉、失敗者に「HP損害：■■」＋「※追加効果：1D」（■のため個別ダメージ部分は自動化せずGM向けnote、追加効果決定表の参照のみ自動化）、浮遊発揮

**注記**：第一形態は5〜6の出目のみ存在（規則書上「5」「6」列に対応、1~2/3~4は前述の通り）。第二形態は「1」「2」の出目が存在しない（規則書原文で「—」）。実装時に`night_boss_rulebook.js:647-654`を必ず直接`Read`して正確な出目範囲を確認すること。

- [ ] **Step 1〜7**: Task 4/5と同じ手順に加え、`additionalEffectTable`の解決機構の要否を判断・実装。`night_boss_rulebook.js:579-655`を直接`Read`確認 → `formAware`＋`additionalEffectTable`実装 → 検証 → commit。

commit message: `feat(night): 新增夜之王「ナメレス(無名者)」的自動化GM結構化資料`

---

### Phase 1 統合・検証タスク

- [ ] **統合Task: worktreeの統合とビルド確認**（Task 5相当、floor監査Planと同じ手順：各worktreeブランチを順次mergeし、コンフリクトがあれば手動解決——同一ファイルへの追記のため軽微なコンフリクトが起こり得る、`node --check`→`py -3 generate.py`確認、worktree片付け）
- [ ] **統合Task: Playwright/claude-in-chromeでの回帰確認**（前回タスクと同じ手法：`sessionStorage`でadmin認証をバイパスし、TTSを無効化、劇本2（gaping_jaw、bossId=edele、比較対象として既存の動作するボス）と、新規対応した6体のうちいずれか（例：劇本8 balancersのharmonia、劇本9 dreglordのstragedes）でゲームを作成し、自動化GM UIでボスを選択、出目を送って擲骰オーバーレイが正しく機能する（コンソールエラー無し、多形態ボスはトグルボタンが正しいラベルで表示される）ことを確認する)
- [ ] **統合Task: 最終whole-branchレビュー**（前回同様、最も能力の高いモデルで実施。特にTask 0の汎用化ロジック変更と、Task 3/5/6の新規機構追加候補——savingThrow拡張・additionalEffectTable解決——が既存機能を壊していないか重点的に確認）
- [ ] **統合Task: push**（`auto-allenemy`ブランチを作成し、`private`遠端のみへpush。Phase 2/3は未実行のため、pushはPhase 1完了分のみとなる）

---

## Phase 2: 夜之強敵（劇本8「balancers」・劇本9「dreglord」）—— 今回のセッションでは未実行、次回詳細計画

対象8体（`docs/enemy_auto_gm_coverage_audit.md` ②節参照）：

| family\|enemyId | 規則書名 | 劇本・日 |
|---|---|---|
| `death_bird_raven\|wounded_demon` | 傷ついたデーモン＆うろ底のデーモン | balancers(8) 1日目 |
| `warrior_swordsman\|divine_beast_warriors` | 神獣の戦士たち＋モブ2 | balancers(8) 1日目 |
| `death_bird_raven\|demon_prince` | デーモンの王子 | balancers(8) 2日目 |
| `strong_type\|blood_lord` | 血の君主 | balancers(8) 2日目 |
| `big_dog_bear\|rune_bear` | ルーンベア | dreglord(9) 1日目 |
| `soldier_knight\|death_knight` | 死の騎士 | dreglord(9) 1日目 |
| `rock_spirit_beast\|sacred_beast_lion_dance` | 神獣獅子舞 | dreglord(9) 2日目 |
| `soldier_knight\|knight_alutrius` | 騎士アルトリウス | dreglord(9) 2日目 |

**アプローチ**：これらは`enemy_auto_gm_data.js`（一般敵人と同じデータ形式）で構造化する（`boss_auto_gm_data.js`の対象外）。既存の劇本1〜7・10の夜之強敵構造化commit（8567fa3等）と同じ粒度・パターンを踏襲する。次回セッション開始時、`enemies.js`/`enemies_data_*.js`から各敵人の規則書原文所在を特定し、本Planと同じ形式でTask化する。

## Phase 3: 一般敵人111体（劇本8/9夜之強敵8体を除く103体）—— 今回のセッションでは未実行、次回詳細計画

**アプローチ**：`docs/enemy_auto_gm_coverage_audit.md` ③節の科（family）別集計を元に、1科（5〜15体程度）を1バッチとして、既存の`enemy_auto_gm_data.js`構造化パターン（`node_type`科等の既存対応済みエントリを参照）に倣ってバッチごとにTask化する。`attacker_warrior`科・`attacker_mage`科・`formless_other`科は全体未対応のため優先着手候補。次回セッション開始時に、科ごとの規則書原文所在（画像/`enemies_data_*.js`内のbody text）を確認し、本Planと同じ粒度でTask化する。

---

## Self-Review メモ

- Task 0〜6はGlobal Constraintsの「■不自動計算」「Xd=固定値」原則を各所で明記し、既存機構（`targetRule.kind`各種、`savingThrow`、`groupDamage.sequence`、`force_back_row_next_phase`、`formAware`）の再利用を優先する方針を貫いている。
- 新規機構（Task 0のformLabels、Task 3のsavingThrow成功時分岐、Task 6のadditionalEffectTable）は、いずれも「既存パターンが無い場合のみ最小限追加してよい」という限定的な例外として明記し、無制限な設計変更を許容しないようにした。
- Task 4/5/6は規則書原文の出目対応表が複雑（第一形態/第二形態で列がずれる）ため、本Planの記述を鵜呑みにせず、実装者が必ず原文を`Read`で再確認するよう明記した（本Planの転記ミスによる誤実装を防ぐガードレール）。
- Phase 2/3は本セッションの実行対象外（ユーザー承認済み）のため、詳細タスク化はせず対象一覧とアプローチのみに留めた——次回セッションで本Planに追記する形で継続する。
