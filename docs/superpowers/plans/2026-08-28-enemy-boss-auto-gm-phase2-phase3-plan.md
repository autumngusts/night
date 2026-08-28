# 一般敵人・夜之強敵 自動化GM對應 Phase 2/3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **前提**：本Planは`docs/superpowers/plans/2026-08-26-enemy-boss-auto-gm-master-plan.md`のPhase 2・Phase 3を詳細タスク化したものである。Phase 1（夜王10体）は既に実装・merge完了済み（`docs/enemy_auto_gm_coverage_audit.md` 2026-08-28更新版を参照）。本Planの対象は`enemy_auto_gm_data.js`（一般敵人と同形式）に構造化する劇本8/9夜之強敵8体（Phase 2）＋一般敵人103体（Phase 3）、合計111体。

**Goal:** `enemy_auto_gm_data.js`に未対応の111体（劇本8/9夜之強敵8体＋一般敵人103体）を、既存38体と同じ`"familyId|enemyId"`キー形式・`rows`配列パターンで構造化し、「全ての敵人が自動化GM対応済み」の状態を達成する。

**Architecture:** 既存の加算的オーバーレイ設計を踏襲する：`enemy_auto_gm_data.js`は読み取り専用の構造化データ、`auto_gm.js`が計算専用の純粋関数群（`resolveTargets`/`resolveWeightedTargets`/`computeGroupDamage`/`computeIndividualDamage`/`resolveSavingThrow`等）、`night.js`側の擲骰オーバーレイUIが唯一のstate書き込み元。新規のstate機構・計算関数は**既存に相当パターンが無い場合のみ**最小限追加してよい（Global Constraints参照）。

**Tech Stack:** Vanilla ES5 JS（IIFE + `window.PriTest*`名前空間）。自動テストフレームワークなし——検証は`node --check`（構文）、`py -3 generate.py`（ビルド）、Node使い捨てスクリプトでの`window.PriTestEnemyAutoGmData`読み出し確認。

## Global Constraints

- `■`は自動計算しない（CLAUDE.md §19）。数値未確定のHP損害は`conditions: ["unknown_hp_damage_manual"]`で記録し、amountに架空の数値を入れない。
- `Xd`表記（「炎:1D」等）は、本文に別途「振る」指示が無い限り固定蓄積値Xと同一視してよい（`docs/enemy_damage_rules.md` §1.1、2026-08-24ユーザー裁定）。
- 「PC人数回実行」「PC人数+1回実行」等、パーティ人数に依存する可変回数は、既存の`repeat`（固定回数専用）を使わず`conditions: ["variable_repeat_manual"]`でGM手動処理に委ねる（`enemy_auto_gm_data.js`内の劇本2ブロック — 713〜748行目 — で確立済みの最新方針。同ファイル内のより古いエントリが異なる解釈をしていても、そちらは変更しない）。
- 本文に乱戦ダメージの対象記述が無く、`mod`が「—」でない場合は既定ルール`targetRule: { kind: "frontAll" }`（前衛均等割り）を適用する（`soldier_knight|crucible_knight`等で確立済みの標準解釈）。`mod`が「—」の場合は乱戦ダメージ自体を発生させない（`groupDamage`フィールドを省略）。
- 「敵視:最大」「敵視:1以上」等の対象条件は既存の`targetRule.kind`語彙（下記チートシート）にマッピングする。既存語彙で表現できない新パターンが出た場合のみ、`auto_gm.js`の`resolveTargets`に新kindを追加してよい（gnoster/harmoniaの`majorityAreaAggroMax`・`aggroAtLeast1`と同様の先例に倣う）。
- 既存に対応する機構が無い特殊能力（ターンをまたぐ遅延効果、エンドフェイズ起点の自動処理、モブHP連動の固定行動、PC側の回避コスト変更など）は、`rows`に組み込まず、該当行または該当敵エントリ冒頭の`//`コメントとして規則書原文をそのまま記録し、GM手動運用に委ねる（既存の`libra`「モブHP滞留魔法陣」・`nameless`「浮遊」トリガー行と同じ扱い）。
- 各Taskの完了時に`node --check static_src/enemy_auto_gm_data.js`と`py -3 generate.py`を実行し、エラーが無いことを確認してからコミットする。
- Playwright／claude-in-chrome検証スクリプトは使い捨てで、リポジトリにコミットしない。

### `targetRule.kind` チートシート（`auto_gm.js`の`resolveTargets`が既にサポートする値）

| 本文表現 | kind |
|---|---|
| 前衛のPC全員（既定・対象記述なし） | `frontAll` |
| 後衛のPC全員 | `backAll` |
| PC全員（前衛/後衛問わず） | `allPCs` |
| 「敵視:1以上」で前衛のPC全員 | `frontAggroAtLeast1All` |
| 「敵視:1以上」のPC全員（前衛/後衛問わず） | `aggroAtLeast1All` |
| 「敵視:最大」のPC1体（乱戦とは別枠の個別対象） | `aggroMax`（`individualDamage[].targetRule`で使用） |
| 前衛の中で「敵視:最大」のPC全員 | `frontAggroMaxAll` |
| 「敵視:最大」のPCが多いエリア（前衛/後衛）全員 | `majorityAreaAggroMax` |

「N人分」の加重対象は、対象群が単一の`targetRule`から解決される場合は均等割りと数学的に同一のため、上記kindをそのまま使えばよい（`splitGroupShares`が対象人数で均等割りする）。対象群の一部だけがN人分になる混在パターンのみ`targetRule.weightRule: { kind, weight }`を使う（`frontAggroAtLeast1`/`aggroAtLeast1`の2種のみ既存対応）。

### `conditions` タグ語彙（`enemy_auto_gm_data.js` 713〜748行目で確立済み。新規タグは必要な場合のみ追加）

`variable_repeat_manual` / `unknown_hp_damage_manual` / `accum_target_mismatch_manual` / `max_hp_penalty_manual` / `saving_throw_ailment_only_manual` / `no_guard` / `no_evade` / `force_back_row_next_phase` / `enemy_hp_value_buff` / `guard_hp_value_penalty` / `stamina_dice_reduction_next_phase`

---

## Phase 2: 劇本8「balancers」・劇本9「dreglord」夜之強敵 8体

`enemy_auto_gm_data.js`に追記する（`boss_auto_gm_data.js`ではない）。各Taskは1体＝1つの`"familyId|enemyId"`エントリを追加する自己完結タスク。

### Task 1: `death_bird_raven|wounded_demon`（傷ついたデーモン＆うろ底のデーモン）

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- Reference: `static_src/enemies_data_1.js:1101-1166`

**規則書原文**（`size: LL`、`resistance: 炎・猛毒・凍傷・睡眠・発狂`）：

- 特殊能力〔2回行動〕：1回のディフェンスフェイズに「1D（傷ついたデーモン）」と「1D+6（うろ底のデーモン）」で2回のアクション決定を行い、両方を実行する。下記rows表は1〜12の統一表になっており、GM側の運用は「既存の擲骰オーバーレイUIに1回目は出目そのまま（1〜6）、2回目は出目+6した値（7〜12）」を**2回連続で入力**すれば両方の結果を得られる——新規のdual-roll機構は追加不要、この運用方法をエントリ冒頭コメントに明記するのみでよい。
- 特殊能力〔行動激化〕：体勢崩しが発生せず、代わりに戦闘終了まで「2回行動」を失う（片方のみ実行）。PCが「生き残った側」を選び、以後そちらのアクションを総合ダメージ+300／個別ダメージ+120して決定——ターンをまたぐ状態遷移でrowsモデルでは表現不可のため、エントリ冒頭コメントに規則書原文をそのまま記録しGM手動運用とする。
- 出目1~2「炎爪ひっかき」：`mod: "－300＆「炎:1D」"`。「敵視:1以上」で前衛全員「乱戦ダメージ:2人分」→ `groupDamage: { modifier: -300, elementAccum: {ja:"炎", value:1} }`, `targetRule: { kind: "frontAggroAtLeast1All" }`（elementAccumの正確なフィールド名は既存の対応済みエントリ——例:`dragon|great_earth_dragon`等で「炎:1D」を含む行——を`Read`して実際のプロパティ名・値形式を確認してから合わせること）。
- 出目3~4「跳躍叩きつけ」：`mod: "－480"`。個別効果：「敵視:最大」PC1体に個別ダメージ60＋炎1D → `groupDamage: { modifier: -480 }`, `targetRule: { kind: "frontAll" }`（対象記述なし既定）, `individualDamage: [{ amount: 60, targetRule: { kind: "aggroMax" } }]`（炎1Dの付与は既存の`individualDamage`のelementAccum相当フィールドがあれば追加、無ければconditionsコメントへ）。
- 出目5~6「火球」：`mod: "—"`（乱戦なし）。個別効果（PC人数回実行）：「敵視:1以上」PC1体に個別60＋炎2D → `conditions: ["variable_repeat_manual"]`のみ（既存パターンに倣いamountは構造化しない）。
- 出目7~8「毒爪ひっかき」：`mod: "－420＆「猛毒:1D」"`。前衛の中で「敵視:最大」全員「乱戦ダメージ:3人分」→ `groupDamage: { modifier: -420 }`, `targetRule: { kind: "frontAggroMaxAll" }`。
- 出目9~10「跳躍叩きつけ」：`mod: "－600"`。次アクションフェイズ開始時PC全員後衛配置 → `groupDamage: { modifier: -600 }`, `targetRule: { kind: "frontAll" }`, `conditions: ["force_back_row_next_phase"]`。
- 出目11~12「毒のブレス」：`mod: "—"`。個別効果：PC全員〈11|フィジカル〉、失敗者に個別60＋猛毒2D → `savingThrow: { stat: "physical", targetByCondition: [{ condition: { kind: "default" }, target: 11 }], onFail: { amount: 60 } }`。猛毒2Dはconditionsコメントへ記録（`saving_throw_ailment_only_manual`はHP損害を伴わない場合専用のため、ここはHP損害ありなので使わず、コメントのみで足りる）。

- [ ] **Step 1: `static_src/enemies_data_1.js:1101-1166`を`Read`で確認し、既存の`elementAccum`実装済みエントリ（例:`dragon|great_earth_dragon`または既存38体のうち炎属性を含むエントリ）を1つ探して正確なフィールド名を確認する**
- [ ] **Step 2: `enemy_auto_gm_data.js`へ`"death_bird_raven|wounded_demon"`エントリを追加**（上記マッピングに従い、エントリ冒頭に「2回行動」の運用方法コメントと「行動激化」原文コメントを記載）
- [ ] **Step 3: `node --check static_src/enemy_auto_gm_data.js`**
- [ ] **Step 4: Node使い捨て検証**

```bash
node -e "
global.window = {};
require('./static_src/enemy_auto_gm_data.js');
var d = window.PriTestEnemyAutoGmData.get('death_bird_raven', 'wounded_demon');
console.log('rows:', d.rows.length);
"
```

Expected: `rows: 6`

- [ ] **Step 5: Commit**

```bash
git add static_src/enemy_auto_gm_data.js
git commit -m "feat(night): 新增劇本8夜之強敵(傷ついたデーモン＆うろ底のデーモン)的自動化GM結構化資料"
```

---

### Task 2: `death_bird_raven|demon_prince`（デーモンの王子）

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- Reference: `static_src/enemies_data_1.js:1168-1228`

**規則書原文**（`size: LL`、`resistance: 炎・猛毒・凍傷・睡眠・発狂`）：

- GM運用note：このエネミーは進行中シナリオで「傷ついたデーモン＆うろ底のデーモン」を撃破した場合にのみ登場可能（シナリオ進行条件、`night.js`側のGM向けnoteとしてエントリ冒頭コメントに記載するのみ、機構化不要）。
- 特殊能力〔依り代〕：戦闘開始時、プレイヤーが「傷ついたデーモン」と「うろ底のデーモン」のどちらを記録しているか確認し、「うろ底のデーモン」なら`rollOverride`相当（アクション決定を「1D+4」で行う）——既存の`rollOverride: "halfIfNoMobs"`と同種の単一値変換だが判定条件が異なる。`auto_gm.js`の`rollOverride`分岐（118行目付近）に新しい条件文字列（例：`"plus4IfHollowVariant"`）を追加する必要がある。GM向けフラグとして`state.battle`側に「うろ底のデーモン」判定を保持する既存欄が無いため、追加せずコメントのみに留めるか、既存の`rollOverride`パターンに倣い新規追加するかは実装時に判断（Global Constraintsの「既存に無ければ最小限追加してよい」例外に該当）。
- 出目1~2「炎の隕石」：`mod: "－120＆「炎:1D」"`。個別効果（PC人数回実行）：「敵視:1以上」PC1体に個別120＋炎1D → `groupDamage: { modifier: -120 }`, `targetRule: { kind: "frontAll" }`（対象記述なし既定）, `conditions: ["variable_repeat_manual"]`。
- 出目3~4「浮遊火球＆突進」：`mod: "±0"`。個別効果（PC人数+1回実行）：PC協議で任意対象、1体が「HP損害:■」＋炎1D → `groupDamage: { modifier: 0 }`, `targetRule: { kind: "frontAll" }`, `conditions: ["variable_repeat_manual", "unknown_hp_damage_manual"]`（■のため二重タグ）。
- 出目5「跳躍叩きつけ」：`mod: "＋240"`。「敵視:1以上」で前衛全員「乱戦ダメージ:2人分」、次アクションフェイズ開始時PC全員後衛配置 → `groupDamage: { modifier: 240 }`, `targetRule: { kind: "frontAggroAtLeast1All" }`, `conditions: ["force_back_row_next_phase"]`。
- 出目6「両腕掴み」：`mod: "±0"`。個別効果：「敵視:最大」PC1体に個別300、ガード不可 → `groupDamage: { modifier: 0 }`, `targetRule: { kind: "frontAll" }`, `individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }]`, `conditions: ["no_guard"]`。
- 出目7~8「毒の瘴気」：`mod: "＋120＆「猛毒:1D」"`。個別効果：「敵視:1以上」全員〈11|運試し〉、失敗者に個別120＋猛毒1D → `groupDamage: { modifier: 120 }`, `targetRule: { kind: "frontAll" }`, `savingThrow: { stat: "luck", targetFilter: { kind: "aggroAtLeast1" }, targetByCondition: [{ condition: { kind: "default" }, target: 11 }], onFail: { amount: 120 } }`（`stat`の実際のプロパティ名——`luck`か`fortune`等——は既存の「運試し」を使うエントリを`Read`して確認すること）。猛毒1Dはコメント。
- 出目9~10「熱戦爆発」：`mod: "－300＆「猛毒:1D」"`。乱戦対象は「敵視:1以上」全員（対象0人なら前衛にフォールバック）、乱戦ダメージ2回発生 → `groupDamage: { modifier: -300, repeat: 2 }`, `targetRule: { kind: "aggroAtLeast1All" }`（フォールバック動作は既存の`resolveTargets`が対象0件時にどう振る舞うか実装時に確認し、無ければconditionsへ原文注記）。

- [ ] **Step 1〜5**: Task 1と同じ手順（`enemies_data_1.js:1168-1228`を`Read`確認 → 実装 → `node --check` → Node検証（`rows: 8`）→ commit）。「うろ底のデーモン」判定の`rollOverride`拡張要否を実装時に判断し、報告に明記する。

commit message: `feat(night): 新增劇本8夜之強敵(デーモンの王子)的自動化GM結構化資料`

---

### Task 3: `warrior_swordsman|divine_beast_warriors`（神獣の戦士たち＋モブ2）

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- Reference: `static_src/enemies_data_3.js:504-568`

**規則書原文**（`size: M`、`resistance: 雷`）：

- 特殊能力〔闇の中〕：撃破ルーン+2、戦闘1ターン目のみHP価値-20、ディフェンスフェイズ不行動、代わりにアクションフェイズでPCより先に行動——ターン依存の特殊タイミングのためrows化せず、エントリ冒頭コメントに原文記録（GM手動）。
- 特殊能力〔闇に紛れる（条件発揮）〕：全PCが次アクションフェイズ開始時〈11|メンタル〉、失敗でスタミナダイス黒目→白丸——既存の汎用state機構が無いため`conditions: ["dark_veil_note"]`のような新規タグ（またはコメントのみ）で記録し、機構化しない。
- 出目1「円刃剣の舞」：`mod: "±0＆「出血:1D」"`。個別効果：「敵視:最大」PC1体に個別60＋出血1D → `groupDamage: { modifier: 0 }`, `targetRule: { kind: "frontAll" }`, `individualDamage: [{ amount: 60, targetRule: { kind: "aggroMax" } }]`。
- 出目2「短剣投擲」：`mod: "－60＆「出血:1D」"`。乱戦対象はPC全員、「敵視:1以上」で前衛全員「乱戦ダメージ:2人分」→ `groupDamage: { modifier: -60 }`, `targetRule: { kind: "allPCs", weightRule: { kind: "frontAggroAtLeast1", weight: 2 } }`（PC全員が対象母集団で一部が2人分の加重を受ける混在パターン——`resolveWeightedTargets`の使用例として実装時に既存コードで同種の使用箇所があるか確認）。
- 出目3「奇襲＆闇に紛れる」：`mod: "＋120＆「出血:1D」"`。「敵視:最大」PC1体は〈12|メンタル〉、失敗でこの乱戦ダメージにディフェンス不可、闇に紛れる発揮 → `groupDamage: { modifier: 120 }`, `targetRule: { kind: "frontAll" }`, `conditions: ["no_evade_defense_check_manual"]`（判定失敗時のみ防御不可という条件分岐は既存機構に無いため新規タグでGM手動）。
- 出目4「噛みつき＆闇に紛れる」：`mod: "±0"`。「敵視:最大」全員は次アクションフェイズ開始時後衛配置、闇に紛れる発揮 → `groupDamage: { modifier: 0 }`, `targetRule: { kind: "frontAll" }`, `conditions: ["force_back_row_next_phase"]`（対象が「敵視:最大」全員のみで通常の`force_back_row_next_phase`はPC全員対象の先例——`imp_watchdog_gargoyle|hero_gargoyle`——と対象範囲が異なるため、コメントで対象PCを限定する旨を明記）。
- 出目5「雷大剣連撃＆角降ろし」：`mod: "＋120＆「雷:1D」"`。個別効果：「敵視:1以上」全員に個別180 → `groupDamage: { modifier: 120 }`, `targetRule: { kind: "frontAll" }`, `individualDamage: [{ amount: 180, targetRule: { kind: "aggroAtLeast1All" } }]`。
- 出目6「雷槍」：`mod: "±0"`。個別効果：「敵視:最大」PC1体に個別120＋雷2D → `groupDamage: { modifier: 0 }`, `targetRule: { kind: "frontAll" }`, `individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }]`。

- [ ] **Step 1〜5**: 同パターン（`enemies_data_3.js:504-568`確認 → 実装 → 検証`rows: 6` → commit）。

commit message: `feat(night): 新增劇本8夜之強敵(神獣の戦士たち＋モブ2)的自動化GM結構化資料`

---

### Task 4: `strong_type|blood_lord`（血の君主）

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- Reference: `static_src/enemies_data_3.js:1095-1159`

**規則書原文**（`size: L`、`resistance: 炎・発狂`）：

- 特殊能力〔捧げる呪い〕：体勢崩し直後のディフェンスフェイズはアクション決定の1Dを振らず自動的に「数え上げる呪い」（出目「—」の行）を実行——`night_gm_flow.js`側にトリガー行の既存処理パターンがあるか確認し（gnosterの「毒吐き」トリガー行と同型）、`rows`外の特殊トリガーとしてエントリ冒頭コメントに記録。
- 特殊能力〔血の君主の歓喜〕：ディフェンスフェイズでPCが出血でHP損害を受けるごとに、最もHP減少しているHP行に「HP回復:□□」（□は解析可能、`sumMaxStatDeltaFromText`/`countHealSquares`相当ではなく敵HP側の回復——既存に敵HP自動回復のトリガー機構が無ければコメントのみ）。
- 特殊能力〔行動激化〕：体勢崩し後、戦闘終了まで`1D+4` → `rollBonusAfterGuardBreak: 4`。
- 出目1~2「槍突進」：`mod: "＋180"`。「敵視:1以上」で前衛全員「乱戦ダメージ:2人分」→ `groupDamage: { modifier: 180 }`, `targetRule: { kind: "frontAggroAtLeast1All" }`。
- 出目3~4「血の飛沫」：`mod: "－120＆「出血:1D」"`。個別効果：「敵視:1以上」全員に個別120＋出血1D → `groupDamage: { modifier: -120 }`, `targetRule: { kind: "frontAll" }`, `individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" } }]`。
- 出目5~6「血炎の爪痕」：`mod: "±0＆「炎:1D」＆「出血:1D」"`。個別効果：「敵視:最大」PC1体に個別180＋炎1D＋出血1D → `groupDamage: { modifier: 0 }`, `targetRule: { kind: "frontAll" }`, `individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }]`。
- 出目7~8「血炎の槍撃＆槍の幻影」：`mod: "±0＆「炎:1D」＆「出血:1D」"`。「敵視:1以上」で前衛全員「乱戦ダメージ:2人分」、個別効果：1D判定で前衛or後衛に出血1D → `groupDamage: { modifier: 0 }`, `targetRule: { kind: "frontAggroAtLeast1All" }`, `conditions: ["variable_repeat_manual"]`（1D分岐による追加出血効果は既存機構に無いため注記のみ）。
- 出目9~10「血炎の飛沫」：`mod: "－180"`。個別効果：「敵視:1以上」全員〈11|フィジカル〉、失敗者に個別120＋炎1D＋出血1D → `groupDamage: { modifier: -180 }`, `targetRule: { kind: "frontAll" }`, `savingThrow: { stat: "physical", targetFilter: { kind: "aggroAtLeast1" }, targetByCondition: [{ condition: { kind: "default" }, target: 11 }], onFail: { amount: 120 } }`。
- 出目「—」（トリガー専用）「数え上げる呪い」：`mod: "－300＆「出血:1D」"`。乱戦対象PC全員、乱戦ダメージ3回発生 → rows外のコメントとして記録（`〔捧げる呪い〕`発動時のみ使用、GM手動発動）。

- [ ] **Step 1〜5**: 同パターン（`enemies_data_3.js:1095-1159`確認 → `rollBonusAfterGuardBreak: 4`込みで実装 → 検証`rows: 6`（出目「—」トリガー行はrows外なので6行） → commit）。

commit message: `feat(night): 新增劇本8夜之強敵(血の君主)的自動化GM結構化資料`

---

### Task 5: `big_dog_bear|rune_bear`（ルーンベア）

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- Reference: `static_src/enemies_data_3.js:1964-2001`

**規則書原文**（`size: L`、`resistance: 発狂`、8体中で最もシンプル）：

- 特殊能力〔HP価値:+10〕：常に「HP価値:+10（最大100）」→ `conditions: ["enemy_hp_value_buff_permanent"]`（既存`enemy_hp_value_buff`は「次アクションフェイズ終了まで」の一時バフ用のため、常時適用は別タグとする）。
- 出目1~2「腕振り回し」：`mod: "±0"`。個別効果：「敵視:1以上」全員は次アクションフェイズ獲得スタミナダイス1個減少 → `groupDamage: { modifier: 0 }`, `targetRule: { kind: "frontAll" }`, `conditions: ["stamina_dice_reduction_next_phase"]`。
- 出目3~4「のしかかり」：`mod: "＋120"`。回避時ダイスコスト半減（PC側処理、コメントのみ）→ `groupDamage: { modifier: 120 }`, `targetRule: { kind: "frontAll" }`, `conditions: ["halved_evade_cost_note"]`。
- 出目5~6「ベアハッグ」：`mod: "—"`。個別効果：「敵視:最大」PC1体に個別300、ガード不可 → `individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }]`, `conditions: ["no_guard"]`（`groupDamage`省略、modが「—」のため）。

- [ ] **Step 1〜5**: 同パターン（`enemies_data_3.js:1964-2001`確認 → 実装 → 検証`rows: 3` → commit）。

commit message: `feat(night): 新增劇本9夜之強敵(ルーンベア)的自動化GM結構化資料`

---

### Task 6: `soldier_knight|death_knight`（死の騎士）

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- Reference: `static_src/enemies_data_2.js:1264-1297`

**規則書原文**（`size: M`、`resistance: 炎・出血・発狂`、特殊能力の記載なし・行動激化なし）：

- 出目1~2「瞬雷・双斧」：`mod: "＋120＆「雷:1D」"`。個別効果：PC全員〈11|フィジカル〉、失敗で雷1D（HP損害を伴わないailmentのみの失敗効果）→ `groupDamage: { modifier: 120 }`, `targetRule: { kind: "frontAll" }`, `conditions: ["saving_throw_ailment_only_manual"]`（savingThrowのonFailはamount専用のため、HP損害を伴わないこのケースはsavingThrow機構を使わずコメント記録——Global Constraints参照）。
- 出目3~4「騎士の雷槍」：`mod: "－60＆「雷:2D」"`。個別効果：「敵視:1以上」全員に個別60＋雷1D、回避時ダイスコスト半減 → `groupDamage: { modifier: -60 }`, `targetRule: { kind: "frontAll" }`, `individualDamage: [{ amount: 60, targetRule: { kind: "aggroAtLeast1All" } }]`, `conditions: ["halved_evade_cost_note"]`。
- 出目5~6「薙ぎ払い＆掴み攻撃」：`mod: "－120"`。個別効果：「敵視:最大」PC1体に個別240、ガード不可 → `groupDamage: { modifier: -120 }`, `targetRule: { kind: "frontAll" }`, `individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }]`, `conditions: ["no_guard"]`。

- [ ] **Step 1〜5**: 同パターン（`enemies_data_2.js:1264-1297`確認 → 実装 → 検証`rows: 3` → commit）。

commit message: `feat(night): 新增劇本9夜之強敵(死の騎士)的自動化GM結構化資料`

---

### Task 7: `rock_spirit_beast|sacred_beast_lion_dance`（神獣獅子舞）

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- Reference: `static_src/enemies_data_1.js:590-654`

**規則書原文**（`size: L`、`resistance: 発狂`）：

- 特殊能力〔弱点:猛毒＆出血＆腐敗〕：公開情報（既存の敵special表示に反映する仕組みがあれば利用、無ければコメントのみ——boss/enemy双方でこの手の「弱点公開情報」は既存のUIに専用欄が無いため`special`フィールド相当があるか実装時に確認）。
- 特殊能力〔行動激化〕：体勢崩し後、戦闘終了まで`1D+2` → `rollBonusAfterGuardBreak: 2`。
- 出目1~2「突撃」：`mod: "＋120"`。「敵視:1以上」で前衛全員「乱戦ダメージ:2人分」→ `groupDamage: { modifier: 120 }`, `targetRule: { kind: "frontAggroAtLeast1All" }`。
- 出目3~4「神獣竜巻」：`mod: "＋120"`。個別効果：「敵視:最大」全員は次アクションフェイズ獲得スタミナダイス2個減少 → `groupDamage: { modifier: 120 }`, `targetRule: { kind: "frontAll" }`, `conditions: ["stamina_dice_reduction_next_phase"]`。
- 出目5「雷の槍」：`mod: "—"`。個別効果（PC人数回実行）：「敵視:1以上」PC1体に個別120＋雷1D → `conditions: ["variable_repeat_manual"]`。
- 出目6「広範囲降雷」：`mod: "—"`。個別効果：「敵視:1以上」全員〈12|運試し〉・それ以外〈10|運試し〉、失敗者に個別180＋雷2D → `savingThrow: { stat: "luck", targetByCondition: [{ condition: { kind: "aggroAtLeast1" }, target: 12 }, { condition: { kind: "default" }, target: 10 }], onFail: { amount: 180 } }`。
- 出目7「神獣霜踏み」：`mod: "－120＆「凍傷:2D」"`。回避時ダイスコスト半減 → `groupDamage: { modifier: -120 }`, `targetRule: { kind: "frontAll" }`, `conditions: ["halved_evade_cost_note"]`。
- 出目8「神獣の舞」：`mod: "±0＆「魔:1D」＆「雷:1D」＆「凍傷:1D」"`。個別効果：「敵視:最大」PC1体に個別120＋魔1D → `groupDamage: { modifier: 0 }`, `targetRule: { kind: "frontAll" }`, `individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }]`。

- [ ] **Step 1〜5**: 同パターン（`enemies_data_1.js:590-654`確認 → `rollBonusAfterGuardBreak: 2`込みで実装 → 検証`rows: 8` → commit）。

commit message: `feat(night): 新增劇本9夜之強敵(神獣獅子舞)的自動化GM結構化資料`

---

### Task 8: `soldier_knight|knight_alutrius`（騎士アルトリウス）

**Files:**
- Modify: `static_src/enemy_auto_gm_data.js`
- Reference: `static_src/enemies_data_2.js:1522-1580`

**規則書原文**（`size: M`、`resistance: null`）：

- 特殊能力〔モブ1追加＆固定行動〕：戦闘開始時HP枠に「モブ1」追加（最大HP:PC人数×2）、アクション決定時「モブHP:□以上」なら1Dを振らず自動的に「影の貴人の群れ」（出目「—」の行）を実行——モブHP自動追加は`night_gm_flow.js`の既存パターン（Task 6 stragedes「亡者召喚」で確認予定の仕組み）を再利用できるか確認。できなければコメントのみ。
- 特殊能力〔行動激化〕：体勢崩し後、戦闘終了まで`1D+1` → `rollBonusAfterGuardBreak: 1`。
- 特殊能力〔深淵纏い（条件発揮）〕：PC全員が戦闘終了までこのエネミーの乱戦/個別ダメージを受けるごとに追加で「HP損害:■」＋敵側は■軽減、最大2回累積——■を含み複雑な累積のため`conditions: ["unknown_hp_damage_manual"]`＋コメントで原文記録。
- 出目1~2「連撃」：`mod: "－300"`。乱戦ダメージ2回発生 → `groupDamage: { modifier: -300, repeat: 2 }`, `targetRule: { kind: "frontAll" }`。
- 出目3~4「縦回転斬り」：`mod: "—"`。個別効果（PC人数回実行）：「敵視:1以上」PC1体に個別180、HP損害■以上で次フェイズ獲得スタミナダイス1個減少 → `conditions: ["variable_repeat_manual"]`。
- 出目5「跳躍突き刺し」：`mod: "＋180"`。乱戦ガード不可 → `groupDamage: { modifier: 180 }`, `targetRule: { kind: "frontAll" }`, `conditions: ["no_guard"]`。
- 出目6「飛び退き＆深淵纏い」：`mod: "－120"`。深淵纏い発揮、次アクションフェイズPC全員後衛配置 → `groupDamage: { modifier: -120 }`, `targetRule: { kind: "frontAll" }`, `conditions: ["force_back_row_next_phase"]`。
- 出目7「咆哮連撃＆深淵纏い」：`mod: "＋120"`。深淵纏い発揮、個別効果：「敵視:最大」PC1体に個別300 → `groupDamage: { modifier: 120 }`, `targetRule: { kind: "frontAll" }`, `individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }]`。
- 出目「—」（モブHP依存トリガー）「影の貴人の群れ」：`mod: "－120"`。乱戦ガードコスト+1、回避時ダイスコスト半減 → rows外のコメントとして記録（モブHP存在時のみ自動発動、GM手動判定）。

- [ ] **Step 1〜5**: 同パターン（`enemies_data_2.js:1522-1580`確認 → `rollBonusAfterGuardBreak: 1`込みで実装 → 検証`rows: 6`（出目「—」トリガー行除く） → commit）。モブHP自動追加機構の再利用可否は実装時に確認し報告に明記。

commit message: `feat(night): 新增劇本9夜之強敵(騎士アルトリウス)的自動化GM結構化資料`

---

### Phase 2 統合・検証タスク

- [ ] **統合Task: worktreeの統合とビルド確認**（各worktreeブランチを順次merge、`node --check`→`py -3 generate.py`確認）
- [ ] **統合Task: Playwright/claude-in-chromeでの回帰確認**（劇本8「balancers」・劇本9「dreglord」でゲームを作成し、自動化GM UIで新規対応8体それぞれを選択、出目を送って擲骰オーバーレイが正しく機能する（コンソールエラー無し）ことを確認）
- [ ] **統合Task: 最終whole-branchレビュー**
- [ ] **統合Task: push**（`private`遠端の新規ブランチへpush。`origin`へは推送しない）

---

## Phase 3: 一般敵人 103体（family別バッチ、24バッチ）

各バッチは1家族（family）＝1Task。既存パターン（既に対応済みの同家族または類似家族のエントリ、Phase 1/2で確立した`targetRule`/`conditions`語彙）を再利用し、`enemy_auto_gm_data.js`へ追記する。**各敵の実際の出目・本文は`rows`構造化時に必ず対象ファイルを`Read`で直接確認すること**（本Planでは分量の都合上、家族単位の対象一覧とファイル位置のみを記載し、Phase 1/2のような出目本文の事前転記は行っていない）。

### 実装手順テンプレート（全24バッチ共通）

- [ ] **Step 1**: バッチ対象の各敵IDについて、下記ファイル:行範囲を`Read`で確認し、`actions`配列（`roll`/`name`/`mod`/`note`）と`special`（特殊能力）を把握する。
- [ ] **Step 2**: 各行を「Global Constraints」のチートシート・タグ語彙に従い`rows`へマッピングする。`mod`が「—」なら`groupDamage`省略。対象記述なしは`frontAll`。可変回数は`variable_repeat_manual`。■は`unknown_hp_damage_manual`。行動激化があれば`rollBonusAfterGuardBreak`。ターンまたぎ/エンドフェイズ起点/モブ連動の特殊能力はrows外コメントへ。
- [ ] **Step 3**: `enemy_auto_gm_data.js`へ`"familyId|enemyId"`エントリを追加（バッチ内の全敵を1回のファイル編集でまとめてよい）。
- [ ] **Step 4**: `node --check static_src/enemy_auto_gm_data.js`。
- [ ] **Step 5**: Node使い捨て検証（`window.PriTestEnemyAutoGmData.get(family, enemyId)`で`rows`件数を確認）。
- [ ] **Step 6**: `git commit -m "feat(night): 新增<family>科(<代表敵名>等N體)的自動化GM結構化資料"`。

### バッチ一覧（family・対象数・ファイル位置）

| # | family | 對象數 | 對象一覧（enemyId — file:line） |
|---|---|---|---|
| 1 | `dragon` | 3 | hill_wyvern — enemies_data_1.js:253／mountain_ice_dragon — :293／lava_earth_dragon — :333 |
| 2 | `tree_spirit` | 1 | golden_tree_avatar — enemies_data_1.js:395 |
| 3 | `rock_spirit_beast` | 4 | golden_hippo — enemies_data_1.js:523／dark_offspring — :724／dark_offspring_withered — :764／ancestral_spirit — :804 |
| 4 | `rat_basilisk` | 3 | big_rats — enemies_data_1.js:862／finger_bugs — :896／basilisks — :936 |
| 5 | `death_bird_raven` | 1 | giant_raven — enemies_data_1.js:1064 |
| 6 | `grafted` | 1 | grafted_prince — enemies_data_1.js:1256 |
| 7 | `crustacean` | 3 | big_crabs — enemies_data_2.js:186／big_ants — :223／big_crayfish — :260 |
| 8 | `attacker_warrior`（全体未対応） | 5 | night_assassin — enemies_data_2.js:318／night_executioner — :358／night_fallen — :398／night_destroyer — :438／night_blasphemer — :478 |
| 9 | `formless_other`（全体未対応） | 7 | reflection_trolls — enemies_data_2.js:539／omen — :579／silver_drops — :619／spider_scorpions — :656／mud_men — :693／man_bats — :730／miranda_flowers — :767 |
| 10 | `attacker_mage`（全体未対応） | 5 | night_hunter — enemies_data_2.js:828／night_idol — :868／night_thief — :908／night_witch — :948／night_liar — :988 |
| 11 | `soldier_knight`（残り） | 9 | cuckoo_knights — enemies_data_2.js:1084／corrupted_knight — :1120／madfire_knights — :1156／fire_knights — :1300／messmer_soldiers — :1336／hound_knight — :1372／raya_lucaria_soldiers — :1408／mausoleum_knight — :1444／leyndell_knights — :1484 |
| 12 | `dog_wolf` | 2 | stray_dogs — enemies_data_3.js:52／wolf — :85 |
| 13 | `warrior_swordsman`（残り） | 10 | stoneskin_kings — enemies_data_3.js:142／loathsome_crushers — :182／divine_bird_warrior — :218／black_blade_assassin — :248／zamor_ancient_hero — :288／blood_noble — :324／nox_warriors — :364／cursed_swordsman — :394／grave_warden_duelist — :434／exiled_soldier — :470 |
| 14 | `strong_type`（残り） | 7 | omen_children — enemies_data_3.js:659／pumpkin_helm_madman — :696／black_flame_sinners — :736／blood_demons — :813／tuning_demon — :853／fire_monk_warrior — :893／purple_ogre_chief — :930 |
| 15 | `cavalry`（残り） | 4 | royal_capital_cavalry — enemies_data_3.js:1183／kaiden_mercenary — :1220／carian_royal_guard — :1257／dragon_tree_guard — :1498 |
| 16 | `demihuman_beastfolk_club`（残り） | 4 | hybrids — enemies_data_3.js:1623／lion_hybrids — :1657／farum_azula_beastmen — :1728／rot_kindred — :1762 |
| 17 | `big_dog_bear`（残り） | 2 | consort_red_wolf — enemies_data_3.js:1887／huge_dog — :1927 |
| 18 | `undead`（残り） | 5 | falling_hawk_corps — enemies_data_4.js:52／rotten_undead — :89／skeletons — :126／graveyard_shades — :166／wraith_servants — :206 |
| 19 | `crystal_puppet`（全体未対応） | 4 | living_jars — enemies_data_4.js:335／stone_diggers — :372／crystal_people — :406／puppet_soldiers — :446 |
| 20 | `mage_messenger`（残り） | 6 | meteor_scavengers — enemies_data_4.js:504／glintstone_sorcerers — :544／interrogators — :615／perfumers — :652／sinners — :689／war_sorcerers — :726 |
| 21 | `golem_maiden_puppet`（残り） | 2 | kidnapper_maiden_puppets — enemies_data_4.js:816／fire_chariot_ganmen — :853 |
| 22 | `commoner`（全体未対応） | 5 | shadow_nobles — enemies_data_4.js:1018／wandering_nobles — :1058／mad_flame_folk — :1092／citizens — :1129／watchers — :1166 |
| 23 | `imp_watchdog_gargoyle`（残り） | 2 | black_blade_kindred — enemies_data_4.js:1298／grave_guardian_birds — :1338 |
| 24 | `troll_dragonkin_wormface`（残り） | 6 | knight_troll — enemies_data_4.js:1466／headless_trolls — :1506／mad_flame_troll — :1543／snowfield_trolls — :1580／troll — :1620／dragonkin_soldier — :1657 |
| 25 | `page_lowly_soldier`（全体未対応） | 2 | upper_pages — enemies_data_4.js:1850／lowly_soldiers — enemies_data_4.js:1887 |

（合計103体、25バッチ。優先着手候補：`attacker_warrior`・`attacker_mage`・`formless_other`・`crystal_puppet`・`commoner`・`page_lowly_soldier`は科全体が未対応のため、既存の参照可能な近似パターンが同科内に無い点に注意——他科の既存対応済みエントリの`targetRule`/`conditions`語彙を汎用パターンとして参照すること。）

### Phase 3 統合・検証タスク

- [ ] **統合Task: 25バッチ完了後のビルド確認**（`node --check`→`py -3 generate.py`）
- [ ] **統合Task: Playwright/claude-in-chromeでの抽出回帰確認**（各劇本の夜之強敵決定表からランダムに数体選び、自動化GM UIで動作確認）
- [ ] **統合Task: 最終whole-branchレビュー**
- [ ] **統合Task: `docs/enemy_auto_gm_coverage_audit.md`を更新**（③一般敵人セクションを「149体中149体対応済み」に更新）
- [ ] **統合Task: push**（`private`遠端のみ）

---

## Self-Review メモ

- Phase 2（8体）はPhase 1（夜王）と同水準——本文原文の逐語転記＋既存`targetRule`/`conditions`語彙への具体的マッピング——で詳細化した。曖昧な箇所（`demon_prince`の「うろ底のデーモン」判定、`divine_beast_warriors`の混在加重対象、`wounded_demon`の2回行動運用）は、既存コードで確立された解釈慣行（対象記述なし→`frontAll`、可変回数→`variable_repeat_manual`）に従いつつ、実装者が原文を`Read`で再確認すべき箇所として明記した——CLAUDE.md §19「■不得自行發明數值」の原則を優先し、数値を捏造していない。
- Phase 3（103体・25バッチ）は分量上、Phase 1/2と同じ逐語転記は行わず、家族・対象敵ID・正確なfile:line位置＋共通実装手順テンプレートのみを記載した。これは既存master planのPhase 2/3が採用していた「対象一覧とアプローチのみ、着手時に詳細確認」という方針を踏襲したものであり、各バッチ実装時に対象ファイルを`Read`して原文を確認する手順をStep 1として明記することで、数値の捏造を防いでいる。
- 新規`conditions`タグ（`enemy_hp_value_buff_permanent`、`halved_evade_cost_note`、`no_evade_defense_check_manual`等）は、Global Constraintsの既存語彙で表現できない場合のみ導入するよう指示し、無制限な新規タグ乱立を避けている。
- `rollOverride`の新条件文字列追加（Task 2）、`targetRule.weightRule`の混在対象パターン（Task 3）は、Global Constraintsが許容する「既存に無ければ最小限追加してよい」例外に該当する旨を明記した。
