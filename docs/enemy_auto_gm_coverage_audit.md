# 敵人・夜之強敵・夜王 自動化GM対應状況 稽核記録（2026-08-26 作成／2026-08-28 更新）

## 目的

「所有敵人都能進行自動化戰鬥」（全ての敵人を自動化GM対応にする）プロジェクトの着手前に、`enemy_auto_gm_data.js`（一般敵人）・`boss_auto_gm_data.js`（夜之強敵／夜王）のカバレッジを網羅調査した記録。実行計画は`docs/superpowers/plans/2026-08-26-enemy-boss-auto-gm-master-plan.md`を参照。

**2026-08-28 更新**：Phase 1（夜王6体：fulghor/caligo/libra/harmonia/stragedes/nameless）はcommit `76c915a`〜`4b92d9a`にて全件実装・マージ完了済み。①夜王セクションを更新。②③（Phase 2/3）は前回稽核時点から変化なし（未着手）。

## サマリー

| カテゴリ | 総数 | 対応済み | 未対応 |
|---|---|---|---|
| ① 夜王（Night Lords） | 9体（名簿）＋`nameless`1体（名簿未掲載、規則書には存在） | **10体全て対応済み** | **0体** |
| ② 夜之強敵（劇本1〜10、日別） | 10劇本×2日 | 劇本1〜7・10は既存の一般敵人データで全候補カバー済み | 劇本8「balancers」・劇本9「dreglord」の各日2種＝計8体（未着手） |
| ③ 一般敵人（`enemies_data_1〜4.js`） | 149体 | 38体 | 111体（②の8体を含む、未着手） |

**合計未対応数（実質重複を除く）**：夜王0体＋一般敵人111体（うち劇本8/9夜之強敵8体を含む）＝**111体**（夜王は`enemy_auto_gm_data.js`ではなく`boss_auto_gm_data.js`側の対象のため別カウント）。

## ① 夜王（Night Lords）

`static_src/night_bosses.js`のロースターは9体：`maris`, `fulghor`, `harmonia`, `gladius`, `gnoster`, `caligo`, `libra`, `edele`, `stragedes`。

`static_src/night_boss_rulebook.js`にはこれとは別に`nameless`（「夜の輪郭（第一形態）／夜の王、ナメレス（第二形態）」、580〜672行目）が存在し、`static_src/scenarios.js`の劇本10「night_aspect」の`bossId`が参照している。ただし`night_bosses.js`の画像ロースターには含まれておらず、対応する画像アセット（`static_src/images/bosses/nameless.jpg`）も存在しない（`photo/AFTER/boss/`配下に未整理の写真が10枚あり、10体目の候補である可能性はあるが画像切り出しは本プロジェクトの範囲外）。

`boss_auto_gm_data.js`の構造化データは`night_bosses.js`のロースターに依存しないため、`nameless`の自動化GM対応自体はロースター修正なしで実施可能。ユーザー確認済み：**`nameless`を今回の夜王スコープに含める**（ロースター表示の欠落は別問題として今回は触れない）。

| id | 対応状況 | 規則書データ所在（`night_boss_rulebook.js`） | 備考 |
|---|---|---|---|
| gladius | ✅対応済み | 10〜92行目 | 合体/分裂の多形態、`formAware`で構造化（`boss_auto_gm_data.js` 131行〜） |
| edele | ✅対応済み | 93〜157行目 | 単一形態＋`rollBonusAfterGuardBreak`（194行〜） |
| gnoster | ✅対応済み | 158〜208行目 | 単一形態＋`savingThrow`/`groupDamage.sequence`拡張あり（263行〜） |
| maris | ✅対応済み | 209〜281行目 | 出目1〜8全行構造化（49行〜）、最初の試作対象 |
| fulghor | ✅対応済み（2026-08-28） | 340〜397行目 | `rollBonusAfterGuardBreak: 2`（381行〜、commit `76c915a`） |
| stragedes | ✅対応済み（2026-08-28） | 514〜579行目 | 第一形態／第二形態の多形態ボス（872行〜、commit `07b7bf4`） |
| caligo | ✅対応済み（2026-08-28） | 398〜452行目 | `rollBonusAfterGuardBreak: 2`（508行〜、commit `87d0a84`） |
| harmonia | ✅対応済み（2026-08-28） | 453〜513行目 | 第一形態／第二形態の多形態ボス（774行〜、commit `43cca98`） |
| libra | ✅対応済み（2026-08-28） | 282〜339行目 | モブHP特殊機構あり（649行〜、commit `6e240c3`） |
| nameless | ✅対応済み（2026-08-28） | 580〜672行目 | 第一形態／第二形態の多形態ボス、名簿未掲載だがスコープに含め対応済み（996行〜、commit `0c946ea`＋転記修正`c5fa199`） |

**多形態ボスの実装方針**：`gladius`の`formAware`パターンを踏襲し、`harmonia`/`stragedes`/`nameless`も同パターンで構造化済み。`docs/enemy_damage_rules.md`記載の「第一形態→第二形態の自動移行は未実装」という制限は踏襲され、形態移行は引き続きGM手動運用（`formLabels`対応のトグルボタンで表示のみ切替）。

**夜王10体は全て自動化GM対応完了。残る未対応は②③（劇本8/9夜之強敵8体＋一般敵人103体、計111体）のみ。**

## ② 夜之強敵（1日目・2日目の中ボス）

`fields_data_1.js`（453〜568行目）の「夜の強敵決定表：1日目／2日目」に基づき、各劇本の候補を確認。

劇本1〜7・10の全候補は、既に`enemy_auto_gm_data.js`に構造化済みの一般敵人（38体）と重複しており、対応済み。

未対応は劇本8「balancers」（ボスharmonia）・劇本9「dreglord」（ボスstragedes）のみ：

| 劇本id | 日 | 候補（規則書名） | family\|enemyId |
|---|---|---|---|
| balancers(8) | 1日目 | 傷ついたデーモン＆うろ底のデーモン | `death_bird_raven\|wounded_demon` |
| balancers(8) | 1日目 | 神獣の戦士たち＋モブ2 | `warrior_swordsman\|divine_beast_warriors` |
| balancers(8) | 2日目 | デーモンの王子 | `death_bird_raven\|demon_prince` |
| balancers(8) | 2日目 | 血の君主 | `strong_type\|blood_lord` |
| dreglord(9) | 1日目 | ルーンベア | `big_dog_bear\|rune_bear` |
| dreglord(9) | 1日目 | 死の騎士 | `soldier_knight\|death_knight` |
| dreglord(9) | 2日目 | 神獣獅子舞 | `rock_spirit_beast\|sacred_beast_lion_dance` |
| dreglord(9) | 2日目 | 騎士アルトリウス | `soldier_knight\|knight_alutrius` |

この8体は`enemy_auto_gm_data.js`（一般敵人と同じ構造）で対応する（夜之強敵専用の別データ形式は存在しない）。

## ③ 一般敵人

`enemies_data_1.js`〜`_4.js`：25科・149体。`enemy_auto_gm_data.js`：38体対応済み（`"familyId|enemyId"`キー形式）。

未対応111体のうち、科（family）単位で見ると`attacker_warrior`科（5体）・`attacker_mage`科（5体）・`formless_other`科は全体未対応。上記②の劇本8/9夜之強敵8体もこの111体に含まれる。

## `docs/enemy_damage_rules.md` 実装状況マップからの補足

- 乱戦/個別ダメージ自動算出、属性/状態異常蓄積、耐性無効化：✅実装済み（対応済み敵人の範囲内）
- 体勢崩しフラグ：✅実装済み（フラグのみ）
- ガード回数のstate管理・ガード削り値自動算出：✅実装済み（対応済み敵人＋gladius/marisのみ）
- ガード回数→HP価値の参照テーブル：✅夜王10体全員（nameless含む）に既に構造化済み——ただしこれは出目→行動決定の`boss_auto_gm_data.js`オーバーレイとは別物で、擲骰オーバーレイ自体は上記6体が未対応
- ファイル末尾の既知の制限：「harmonia/stragedes/namelessの第一形態→第二形態自動移行は未実装」

## 過去commitの命名規則（今後も踏襲）

- 夜王：`feat(night): 新增夜之王「<ja名>(<zh名>)」的自動化GM結構化資料`（edele/gnosterの実例）
- 夜之強敵：`feat(night): 新增劇本N夜之強敵(<代表敵名>)的自動化GM結構化資料`（劇本1〜6の実例）
- 一般敵人：個別敵人ごと、あるいは複数体まとめてのcommitパターンあり（`enemy_auto_gm_data.js`のcommit履歴を参照）

## 参照した主なファイル

- `static_src/night_bosses.js`
- `static_src/boss_auto_gm_data.js`
- `static_src/night_boss_rulebook.js`
- `static_src/scenarios.js`
- `static_src/fields_data_1.js`（453〜568行目：夜之強敵決定表）
- `static_src/enemies.js`、`static_src/enemies_data_1.js`〜`_4.js`
- `static_src/enemy_auto_gm_data.js`
- `docs/enemy_damage_rules.md`
