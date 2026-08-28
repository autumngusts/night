# 全樓層板塊reward陣列完全稽核＋劇本3-4回歸確認 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **並行実行に関する重要な注意**：Task 1〜4は互いに独立（別ファイル・共有state無し）であり、`docs/superpowers/specs/2026-08-25-all-floor-tiles-reward-audit-design.md` の決定事項3により、**4つとも同時に並行dispatchする**（1タスクずつ順番に実行しない）。各タスクは `Agent` ツールを `isolation: "worktree"` で1メッセージ内に4回並行呼び出しして開始する。Task 5（統合）はTask 1〜4全部の完了後、Task 6・7（Playwright）はTask 5完了後、Task 8（push）はTask 6・7完了後という順序依存がある。

**Goal:** `fields_data_1.js`〜`fields_data_4.js` の全カード・全ブランチ・全フロアについて、本文（`lines`）記述と構造化 `reward` 配列のズレ（獎勵の記述漏れ・誤ったkind・相互排他分岐の未`tieredChoice`化等）を補完し、劇本1〜10全部の自動化GM（獎勵清單自動push）が本文の記述通りに動作するようにする。完了後、劇本3（`sentient_pest`）・劇本4（`augur`）をPlaywrightで実機回歸確認し、`auto-allMap` ブランチを `private` 遠端のみへpushする。

**Architecture:** 既存の「reward配列＝獎勵清單へのソースデータ、`night_floor_breakthrough.js`/`night_gm_flow.js`が読み取り専用で消費する」という設計（`docs/superpowers/specs/2026-08-10-floor-reward-turn-reward-integration-design.md`）は変更しない。今回はデータ監査のみで、ロジックコードは一切変更しない。4ファイルは内容的に独立しているため、Task 1〜4は4つの`Agent`（`isolation:"worktree"`）へ並行dispatchし、それぞれが自分のファイル内の全カードを走査してcommitする。完了後、コーディネーター（本セッション）が4つのworktreeの変更を`all-enemy`ブランチへ統合する。

**Tech Stack:** Vanilla ES5 JS（データオブジェクトのみ、ロジック無し）。検証は`node --check`（構文）、`py -3 generate.py`（ビルド）、Playwrightの使い捨てスクリプト（コミットしない）。

## Global Constraints

- 修正範囲は `fields_data_1.js`〜`_4.js` の `reward` 配列のみ。`enemy_auto_gm_data.js`／`boss_auto_gm_data.js`（敵人の自動化GM構造化）は対象外——見つけても変更しない。
- `night_floor_breakthrough.js`／`night_gm_flow.js` 等のロジックコードは変更しない。既存の `reward` 配列の型（`kind`の種類、`perPerson`、`tieredChoice`/`diceHandChoice`の構造）を厳守する。
- `■`（HP損害等の裁定が必要な値）は自力で数値化しない（CLAUDE.md §19）。該当箇所は`hpDamage`/`note`のままGM判断に残す。
- 修正が不要なカード・ブランチは変更しない（無理に差分を作らない）。
- 各commitは1カード or 1ブランチ単位を目安に、既存commit（`674529d`, `d1e9345`, `fc17ca6`等）と同じ粒度・同じメッセージパターンに揃える。
- 修正後は必ず対象ファイルで `node --check static_src/fields_data_N.js` を実行してエラーが無いことを確認してからcommitする。
- Playwright検証スクリプトは使い捨てで、リポジトリにコミットしない。Admin操作は`window.prompt`パスワード`night`のdialog処理が必須（CLAUDE.md §4.1）。
- 最終pushは `private` 遠端のみ（`origin`へは推送しない）。

---

## 監査基準（Task 1〜4共通、詳細は各Taskからこのセクションを参照）

各ブランチの各フロアについて、`lines` 配列中のテキスト（`L(depth, label, text, bullet)`の第3引数）を読み、以下のパターンを本文中に見つけたら、対応する `reward` 配列エントリの有無・値を確認する：

| 本文の記述パターン（例） | 対応すべき`reward`エントリ |
|---|---|
| 「撃破ルーン：N」「盧恩：N」 | `{ kind: "rune", value: N, note: C("（撃破ルーン）", "（擊破盧恩）") }` |
| 「武器:★」を1つ獲得 | `{ kind: "weaponStar", value: 1 }` |
| 「射撃武器:★」 | `{ kind: "weaponStar", value: 1, categoryId: RANGED_GROUP_CATEGORY }` |
| 「盾:★」 | `{ kind: "weaponStar", value: 1, categoryId: SHIELD_GROUP_CATEGORY }` |
| 「聖印:★」 | `{ kind: "weaponStar", value: 1, categoryId: "sacred_seal" }` |
| 消耗品を獲得 | `{ kind: "consumable", value: N }` |
| 護符を獲得 | `{ kind: "talisman", value: N }` |
| 「潜在する力:★」「気力覚醒」 | `{ kind: "potentialPower", perPerson: true, value: 1 }`（PC個別付与の場合`perPerson:true`） |
| 「石剣の鍵」 | `{ kind: "stoneswordKey", value: N }`（個別付与なら`perPerson:true`） |
| 「鍛石」 | `{ kind: "smithingStone", value: N }`（個別付与なら`perPerson:true`） |
| 「聖杯瓶」関連の増減 | `{ kind: "chaliceBonus", value: N }` |
| 戦技の再抽選 | `{ kind: "weaponSkillReroll" }` |
| HP損害・■を含む記述 | `{ kind: "hpDamage", ... }`（数値を自力で確定しない） |
| GM判断が必要な記述（地図オープン等） | `{ kind: "note", note: C(ja, zh) }` |
| ダイス手役で報酬が変わる | `{ kind: "diceHandChoice", hands: [...] }` |
| **相互排他な分岐**（「(→A)(→B)」の選択肢・分岐で、実際に発生するのはどちらか一方のみ）の獎勵が同一`reward`配列にフラットに並んでいる | `{ kind: "tieredChoice", tierLabel: C(...), tiers: [{ label: C(...), rewards: [...] }, ...] }` へ統一する（`fc17ca6`参照） |

**判断に迷ったら変更しない**：本文の記述が曖昧、あるいは既存の`reward`配列がすでに正しく対応している場合は変更不要。過剰な「念のため追加」は行わない。

**参考にすべき既存commit（実際のdiffパターン）**：
- `674529d`, `d1e9345`, `7b227c5`, `dc8d732`, `dd84eb7`, `cc8dd12`, `3560734`, `3e97bad`, `d02252c`, `c474794` — 記述漏れの`rune`等の追加パターン。
- `fc17ca6` — 相互排他分岐の`tieredChoice`統一パターン。
- `c474794` — 誤って`tieredChoice`化された箇所を通常配列へ戻す逆パターンもある（機械的に「分岐があれば必ずtieredChoice」ではなく、本当に相互排他かを本文で確認すること）。

これらは `git show <hash>` で確認できる。

---

### Task 1: `fields_data_1.js` の全カード監査（カードA・2、劇本1〜10該当分岐）

**Files:**
- Modify: `static_src/fields_data_1.js`（1796行、カード`a_start`・`a_golden`・`card_2`を含む）

**Interfaces:**
- Consumes: なし（他Taskと独立、共有state無し）
- Produces: なし（Task 5がgit統合時に本Taskのcommit群を取り込む）

- [ ] **Step 1: worktreeでの作業前提を確認**

本Taskは`isolation:"worktree"`の`Agent`として実行される想定。作業開始時に以下を実行し、worktreeが`all-enemy`ブランチから正しく作成されていることを確認する：

```bash
git status
git log --oneline -3
```

Expected: `all-enemy`相当のブランチ上、`static_src/fields_data_1.js`が存在すること。

- [ ] **Step 2: カード一覧を確認**

```bash
grep -n '^\s*id:' static_src/fields_data_1.js
```

Expected: `a_start`（25行目付近）、`a_golden`（253行目付近）、`card_2`（561行目付近）の3件。

- [ ] **Step 3: `a_start`カードの全ブランチを監査**

`static_src/fields_data_1.js`の25〜252行目（`a_start`カード全体）を読み、上記「監査基準」表に従って各`branches[].floors[].lines`と`reward`を突き合わせる。ズレを見つけたら`reward`配列を修正する。

修正例（本文に「撃破ルーン：1」とあるが`reward`に対応する`rune`エントリが無い場合、`d1e9345`の実例）：

```js
              reward: [
                { kind: "weaponStar", value: 1, categoryId: "sacred_seal", note: C("（ザコ戦闘撃破・聖印1）", "（雜兵戰鬥擊破・聖印1）") },
                { kind: "weaponStar", value: 1, categoryId: "sacred_seal", note: C("（ザコ戦闘撃破・聖印2）", "（雜兵戰鬥擊破・聖印2）") },
                { kind: "rune", value: 1, note: C("（撃破ルーン）", "（擊破盧恩）") },
              ],
```

修正がなければこのStepは変更なしで次へ進む。

- [ ] **Step 4: `node --check`で構文確認**

```bash
node --check static_src/fields_data_1.js
```

Expected: エラーなく終了する。

- [ ] **Step 5: `a_start`の修正をcommit（修正が無ければスキップ）**

```bash
git add static_src/fields_data_1.js
git commit -m "fix(fields): 補完出發地點(a_start)カードのreward陣列與本文記述落差"
```

- [ ] **Step 6: `a_golden`カードの全ブランチを監査**

253〜560行目（`a_golden`＝黄金樹の帳カード）を読み、Step 3と同じ手順で監査・修正。`node --check`後、修正があればcommit：

```bash
git add static_src/fields_data_1.js
git commit -m "fix(fields): 補完黄金樹の帳(a_golden)カードのreward陣列與本文記述落差"
```

- [ ] **Step 7: `card_2`カードの全ブランチを監査**

561〜1796行目（`card_2`）を読み、同じ手順で監査・修正。`node --check`後、修正があればcommit：

```bash
git add static_src/fields_data_1.js
git commit -m "fix(fields): 補完card_2的reward陣列與本文記述落差"
```

- [ ] **Step 8: 最終確認**

```bash
node --check static_src/fields_data_1.js
git log --oneline -10
```

Expected: 構文エラー無し。Step 5/6/7で作成したcommitが履歴に並んでいること（修正が無かったカードはcommit無しでよい）。

---

### Task 2: `fields_data_2.js` の全カード監査（カード3・4・5）

**Files:**
- Modify: `static_src/fields_data_2.js`（2739行、`card_3`・`card_4`・`card_5`を含む）

**Interfaces:**
- Consumes: なし（Task 1・3・4と独立）
- Produces: なし

- [ ] **Step 1: worktree前提確認**

```bash
git status
git log --oneline -3
```

- [ ] **Step 2: カード一覧を確認**

```bash
grep -n '^\s*id:' static_src/fields_data_2.js
```

Expected: `card_3`（25行目付近）、`card_4`（622行目付近）、`card_5`（1362行目付近）の3件。

- [ ] **Step 3: `card_3`カードを監査**

25〜621行目を読み、「監査基準」表に従って`branches[].floors[].reward`を本文と突き合わせ、ズレを修正する。`node --check static_src/fields_data_2.js`後、修正があれば：

```bash
git add static_src/fields_data_2.js
git commit -m "fix(fields): 補完card_3的reward陣列與本文記述落差"
```

- [ ] **Step 4: `card_4`カードを監査**

622〜1361行目を読み、同じ手順。`node --check`後、修正があれば：

```bash
git add static_src/fields_data_2.js
git commit -m "fix(fields): 補完card_4的reward陣列與本文記述落差"
```

- [ ] **Step 5: `card_5`カードを監査**

1362〜2739行目を読み、同じ手順。`node --check`後、修正があれば：

```bash
git add static_src/fields_data_2.js
git commit -m "fix(fields): 補完card_5的reward陣列與本文記述落差"
```

- [ ] **Step 6: 最終確認**

```bash
node --check static_src/fields_data_2.js
git log --oneline -10
```

---

### Task 3: `fields_data_3.js` の全カード監査（カード6・7・8・9）

**Files:**
- Modify: `static_src/fields_data_3.js`（2473行、`card_6`・`card_7`・`card_8`・`card_9`を含む）

**Interfaces:**
- Consumes: なし（Task 1・2・4と独立）
- Produces: なし

- [ ] **Step 1: worktree前提確認**

```bash
git status
git log --oneline -3
```

- [ ] **Step 2: カード一覧を確認**

```bash
grep -n '^\s*id:' static_src/fields_data_3.js
```

Expected: `card_6`（25行目付近）、`card_7`（406行目付近）、`card_8`（1264行目付近）、`card_9`（2128行目付近）の4件。

- [ ] **Step 3: `card_6`カードを監査**

25〜405行目を読み、「監査基準」表に従って監査・修正。`node --check static_src/fields_data_3.js`後、修正があれば：

```bash
git add static_src/fields_data_3.js
git commit -m "fix(fields): 補完card_6的reward陣列與本文記述落差"
```

- [ ] **Step 4: `card_7`カードを監査**

406〜1263行目を読み、同じ手順。`node --check`後、修正があれば：

```bash
git add static_src/fields_data_3.js
git commit -m "fix(fields): 補完card_7的reward陣列與本文記述落差"
```

- [ ] **Step 5: `card_8`カードを監査**

1264〜2127行目を読み、同じ手順。`node --check`後、修正があれば：

```bash
git add static_src/fields_data_3.js
git commit -m "fix(fields): 補完card_8的reward陣列與本文記述落差"
```

- [ ] **Step 6: `card_9`カードを監査**

2128〜2473行目を読み、同じ手順。`node --check`後、修正があれば：

```bash
git add static_src/fields_data_3.js
git commit -m "fix(fields): 補完card_9的reward陣列與本文記述落差"
```

- [ ] **Step 7: 最終確認**

```bash
node --check static_src/fields_data_3.js
git log --oneline -10
```

---

### Task 4: `fields_data_4.js` の全カード監査（カード10・J・K・Q）

**Files:**
- Modify: `static_src/fields_data_4.js`（3605行、`card_10`・`card_j`・`card_k`・`card_q`を含む）

**Interfaces:**
- Consumes: なし（Task 1・2・3と独立）
- Produces: なし

- [ ] **Step 1: worktree前提確認**

```bash
git status
git log --oneline -3
```

- [ ] **Step 2: カード一覧を確認**

```bash
grep -n '^\s*id:' static_src/fields_data_4.js
```

Expected: `card_10`（25行目付近）、`card_j`（193行目付近）、`card_k`（1458行目付近）、`card_q`（1813行目付近）の4件（134〜193行目付近の`sevenDice`/`large`/`small`/`straight`は`diceHandChoice`の役定義でカードではないため対象外）。

- [ ] **Step 3: `card_10`カードを監査**

25〜192行目を読み、「監査基準」表に従って監査・修正。`node --check static_src/fields_data_4.js`後、修正があれば：

```bash
git add static_src/fields_data_4.js
git commit -m "fix(fields): 補完card_10的reward陣列與本文記述落差"
```

- [ ] **Step 4: `card_j`カードを監査**

193〜1457行目を読み、同じ手順（`diceHandChoice`の`hands[].rewards`もこの範囲に含まれる場合、同じ監査基準を適用する）。`node --check`後、修正があれば：

```bash
git add static_src/fields_data_4.js
git commit -m "fix(fields): 補完card_j的reward陣列與本文記述落差"
```

- [ ] **Step 5: `card_k`カードを監査**

1458〜1812行目を読み、同じ手順。`node --check`後、修正があれば：

```bash
git add static_src/fields_data_4.js
git commit -m "fix(fields): 補完card_k的reward陣列與本文記述落差"
```

- [ ] **Step 6: `card_q`カードを監査**

1813〜3605行目を読み、同じ手順。`node --check`後、修正があれば：

```bash
git add static_src/fields_data_4.js
git commit -m "fix(fields): 補完card_q的reward陣列與本文記述落差"
```

- [ ] **Step 7: 最終確認**

```bash
node --check static_src/fields_data_4.js
git log --oneline -10
```

---

### Task 5: worktreeの統合とビルド確認

**Files:**
- Modify: なし（git統合作業のみ）

**Interfaces:**
- Consumes: Task 1〜4の各worktreeブランチ（それぞれ`fields_data_1.js`〜`_4.js`のいずれか1つのみを変更したcommit群）
- Produces: `all-enemy`ブランチ上に4ファイル分の監査commitが統合された状態

本Taskはコーディネーター（本セッション、worktree外）が実行する。Task 1〜4のAgentから返されたworktreeパス・ブランチ名を使う。

- [ ] **Step 1: 各worktreeのブランチ名を確認**

```bash
git worktree list
```

Expected: Task 1〜4に対応する4つのworktreeエントリが表示される。

- [ ] **Step 2: 各worktreeブランチを`all-enemy`へ順番にマージ**

4ファイルはそれぞれ独立しているため、コンフリクトは発生しない想定。1つずつ確認しながらマージする：

```bash
git checkout all-enemy
git merge --no-ff <task1-branch> -m "merge: 統合card A/2的reward陣列稽核(fields_data_1.js)"
git merge --no-ff <task2-branch> -m "merge: 統合card 3-5的reward陣列稽核(fields_data_2.js)"
git merge --no-ff <task3-branch> -m "merge: 統合card 6-9的reward陣列稽核(fields_data_3.js)"
git merge --no-ff <task4-branch> -m "merge: 統合card 10/J/K/Q的reward陣列稽核(fields_data_4.js)"
```

（`<taskN-branch>`は実際のworktreeブランチ名に置き換える）

- [ ] **Step 3: コンフリクトが発生した場合の対応**

各Agentが同じファイル内の別カード範囲のみを触っている前提だが、万一コンフリクトが出た場合は、`git status`で該当箇所を確認し、両方の変更内容（本文とreward配列の対応）を読んで正しい方を採用する。不明な場合は作業を中断してユーザーに確認する。

- [ ] **Step 4: 統合後のビルド確認**

```bash
node --check static_src/fields_data_1.js
node --check static_src/fields_data_2.js
node --check static_src/fields_data_3.js
node --check static_src/fields_data_4.js
py -3 generate.py
```

Expected: すべてエラーなく完走する。

- [ ] **Step 5: worktreeの後片付け**

```bash
git worktree list
git worktree remove <task1-worktree-path>
git worktree remove <task2-worktree-path>
git worktree remove <task3-worktree-path>
git worktree remove <task4-worktree-path>
```

---

### Task 6: Playwrightで劇本3（sentient_pest）を回歸確認

**Files:**
- Create: 使い捨てPlaywrightスクリプト（コミットしない。`C:\Users\gsha\AppData\Local\Temp\claude\D--work-PriTest-PriTest\137026d6-042c-4254-823f-27311f95d088\scratchpad\test_scenario3.js`等、スクラッチパッド配下に作成）

**Interfaces:**
- Consumes: Task 5完了後の`dist/`（`py -3 generate.py`済みのビルド成果物）
- Produces: なし（検証のみ）

- [ ] **Step 1: ローカルサーバー起動**

```bash
py -3 generate.py
python -m http.server 8000 --directory dist
```

（バックグラウンド実行）

- [ ] **Step 2: Playwrightスクリプトを作成**

以下の内容でスクラッチパッド配下に`test_scenario3.js`を作成する：

```js
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push("pageerror: " + err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("console.error: " + msg.text());
  });
  page.on("dialog", async (dialog) => {
    await dialog.accept("night");
  });

  await page.goto("http://localhost:8000/admin/index.html");
  await page.waitForTimeout(500);

  const gameId = await page.evaluate(() => {
    return window.PriTestGames.create("scenario3-test", "sentient_pest", "local").id;
  });
  console.log("gameId:", gameId);

  await page.goto("http://localhost:8000/night/index.html?game=" + gameId);
  await page.waitForTimeout(1000);

  // 自動朗讀機能があれば無効化（設定UIの有無を確認してから、無ければstateフラグで直接OFF）
  await page.evaluate(() => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  });

  // 進度版・盤面が正常にレンダリングされているか確認
  const bodyText = await page.evaluate(() => document.body.innerText.length);
  console.log("body text length:", bodyText);

  console.log("errors:", JSON.stringify(errors, null, 2));
  await browser.close();
})();
```

- [ ] **Step 3: スクリプトを実行**

```bash
node <scratchpad>/test_scenario3.js
```

Expected: `errors`配列が空、`gameId`が`g[0-9a-f]{32}`形式で出力される。

- [ ] **Step 4: 実際のフィールド進行操作を追加して再実行**

Step 2のスクリプトを拡張し、盤面の初期3マス（出發地點に隣接）のいずれかへ`[進入]`相当のボタンをクリックし、フロア突破判定・獎勵確定（`[領取獎勵]`等のボタン）まで最低1フロア分進行させる。ボタンのセレクタは`page.locator`でテキストマッチ（例：`page.getByText("進入")`）を使い、要素が見つからない場合はその旨をログに出して次へ進む（要素構造は実行して初めて確定するため、事前に厳密なセレクタを決め打ちしない）。

実行後、`errors`配列が空であることを確認する。

- [ ] **Step 5: 結果を記録し、スクリプトを破棄**

検証が完了したらスクリプトファイルを削除する（コミットしない）：

```bash
rm <scratchpad>/test_scenario3.js
```

---

### Task 7: Playwrightで劇本4（augur）を回歸確認

**Files:**
- Create: 使い捨てPlaywrightスクリプト（コミットしない）

**Interfaces:**
- Consumes: Task 5完了後の`dist/`
- Produces: なし（検証のみ）

- [ ] **Step 1: Task 6と同じ手順で、scenarioIdのみ`"augur"`に変更したスクリプトを作成・実行**

Task 6のStep 2のスクリプトを流用し、以下の行のみ変更する：

```js
window.PriTestGames.create("scenario4-test", "augur", "local").id;
```

- [ ] **Step 2: 実行してエラー無しを確認**

```bash
node <scratchpad>/test_scenario4.js
```

Expected: `errors`配列が空。

- [ ] **Step 3: フィールド進行操作を含めて再実行（Task 6 Step 4と同じ方法）**

最低1フロア分の進行（進入→突破判定 or フロアイベント進行→獎勵確定）を行い、エラー無しを確認する。

- [ ] **Step 4: スクリプトを破棄**

```bash
rm <scratchpad>/test_scenario4.js
```

---

### Task 8: `auto-allMap`ブランチを作成し`private`遠端へpush

**Files:**
- Modify: なし（git操作のみ）

**Interfaces:**
- Consumes: Task 5〜7が全て完了し、`all-enemy`ブランチがビルド・回歸確認済みであること
- Produces: `private`遠端上の`auto-allMap`ブランチ

- [ ] **Step 1: 現在のブランチとコミット漏れが無いことを確認**

```bash
git status
git log --oneline -20
```

Expected: 未commitの変更が無いこと（`docs/superpowers/plans/2026-08-24-night-lord-edele-gnoster-auto-gm.md`等、本タスク以前からの既存untrackedファイルがあれば、それらは本タスクの対象外として触れない）。

- [ ] **Step 2: `auto-allMap`ブランチを作成**

```bash
git checkout -b auto-allMap
```

- [ ] **Step 3: `private`遠端のみへpush**

```bash
git push private auto-allMap
```

Expected: pushが成功し、`private`遠端に`auto-allMap`ブランチが作成される。`origin`へは何もpushしない。

- [ ] **Step 4: push結果を確認**

```bash
git log private/auto-allMap --oneline -5
```

Expected: 直近のcommit履歴が`private/auto-allMap`に反映されていること。

---

## Self-Review メモ

- 設計文書の決定事項1〜5すべてに対応するTaskがある：決定事項1（劇本1〜10全部）→Task 1〜4が全カード網羅、決定事項2（reward配列のみ）→Global Constraintsで明記、決定事項3（4ファイル並行dispatch）→ヘッダーの並行実行注意書き、決定事項4（劇本3-4 Playwright）→Task 6・7、決定事項5（private限定push）→Task 8。
- Task 1〜4の行番号範囲はTaskどうしで重複が無いことを`grep -n '^\s*id:'`の実行結果から確認済み。
- Task 6・7のPlaywrightスクリプトはUI要素の正確なセレクタを事前に確定できないため、「見つからなければログに出して次へ進む」という許容を明記し、確定できる検証項目（コンソールエラー0件、gameId形式）を主軸に据えた。
