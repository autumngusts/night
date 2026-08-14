(function () {
  // 自動化GM Phase 1 試験対象：シナリオ1「三首獸／Tricephalos」で最頻出のsoldier_knight/liege_army
  // （君主軍たち）ほか。enemies_data_*.js本体は書き換えず、加算的なオーバーレイとしてここに保持する。
  //
  // データ形状: "familyId|enemyId" → { rows: [...] }。rows配列は該当エネミーのactions配列と
  // 同じ並び順に対応させる運用ルール（rollMin/rollMaxは元のroll文字列の範囲と必ず一致させ、
  // 転記ミスを防ぐため目視確認のうえ追加すること）。
  //
  // 【ユーザー確認済みの重要規則（規則書写真での確認済み）】
  // 「乱戦ダメージ」は原則として毎回発生する。行動一覧表の「乱戦ダメージ修正」欄が
  // 「—」（ダッシュ記号）の場合のみ、その行は乱戦ダメージが一切発生しない
  // （個別ダメージは別枠の判定のため、この「—」ルールの影響を受けない）。
  //
  // groupDamage.modifier: 「乱戦ダメージ」の最終値は、そのエネミーのレベルに応じた
  // family.base[level].dmg（規則書の基礎データ表のレベル別基準値）に、この行の修正値を
  // 加算して算出する（「±0」も含め、「—」以外は必ずgroupDamageを設定すること）。
  //
  // targetRule: 行動本文に乱戦ダメージの分配対象が明記されている場合はその通りに設定する。
  // 【ユーザー確認済みの既定ルール】本文に分配対象の明記が無い場合は、前衛の全員で均等割り
  // （targetRule: { kind: "frontAll" }）とする。
  //
  // individualDamage: 個別ダメージが発生する行のみ設定する（無い行は省略）。乱戦ダメージとは
  // 独立した別枠の判定のため、上記の「—」ルールの対象外。
  //
  // individualDamage[].distribution === "rotate"（ユーザー確認済みルール）：本文が
  // 「対象PC1体（不特定）」＋「N回実行」の場合、条件を満たす対象群の中で輪流受傷し、最初の
  // 対象はランダム（同一PCが固定でN回受けるのではない）。対象が「敵視:最大」等で明確に
  // 1人に絞られる場合はこのdistributionを使わず、通常のtargetRule（aggroMax等）を使う。
  //
  // structuredRow.savingThrow：判定（運試し／フィジカル／メンタル）で成否が分かれる行動用。
  // ユーザー確認済み：「加護による重骰不可、システムが直接振り出目を公開して順に適用」。
  //
  // rollOverride: "halfIfNoMobs"（坩堝の騎士専用）：戦闘開始時に雑兵の有無を確認し、無ければ
  // 「1Dの半分（端数切り捨て、最低1）」で行動を決定する。以後は戦闘終了まで同じ判定を使う。
  var DATA = {
    "soldier_knight|liege_army": {
      rows: [
        {
          // 「群がる」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」を割り振る（本文に
          // 明記された対象、既定ルールではない）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「連続斬り」：乱戦ダメージ修正±0（「—」ではないため乱戦ダメージも発生する）。
          // 対象の明記が本文に無いため既定ルール（前衛均等割り）を適用。個別ダメージ180は
          // 「敵視:最大」のPC1体に別枠で発生。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「踏み込み＆盾ガード」：乱戦ダメージ修正－60（「—」ではないため乱戦ダメージも発生する）。
          // 対象の明記が本文に無いため既定ルール（前衛均等割り）を適用。加えて敵HP価値バフ＋
          // 次フェイズの体力骰減少（個別効果）が発生する。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff", "stamina_dice_reduction_next_phase"],
        },
      ],
    },
    "big_dog_bear|old_lions": {
      rows: [
        {
          // 「連続噛みつき」：乱戦ダメージ修正－300、乱戦ダメージは2回発生する。対象の明記が
          // 本文に無いため既定ルール（前衛均等割り）を適用。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -300, repeat: 2 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「飛びかかり＆翻り」：乱戦ダメージ修正±0（「—」ではないため乱戦ダメージも発生する）。
          // 対象の明記が本文に無いため既定ルール（前衛均等割り）を適用。加えて敵HP価値バフ＋
          // 特殊能力「翻り」が発生する。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff", "special_flip"],
        },
        {
          // 「跳躍叩きつけ＆翻り」：「敵視:1以上」のPC全員が対象、該当者が0人の場合は前衛が対象
          // （本文に明記されたフォールバック規則）。ユーザー確認済み: 「飛びかかり＆翻り」と同じく
          // 特殊能力「翻り」（次の戦闘フェイズ終了まで、エリア移動消耗が1ではなく3になる）を発揮する。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
          conditions: ["special_flip"],
        },
      ],
    },
    "commoner|highway_robbers": {
      rows: [
        {
          // 「駆け込み斬り」：「敵視:1以上」のPC全員（前衛限定の記載なし）に「乱戦ダメージ:2人分」
          // （本文に明記された対象）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "aggroAtLeast1All" },
        },
        {
          // 「掴み攻撃」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別ダメージ240を
          // 「敵視:最大」のPC1体に。この効果はガード不可（表示用タグのみ）。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
        {
          // 「武器振り回し」：乱戦ダメージ修正±0（「—」ではないため乱戦ダメージも発生する）。
          // 対象の明記が本文に無いため既定ルール（前衛均等割り）を適用。個別ダメージ120は
          // 「敵視:最大」のPC1体に別枠で発生。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
      ],
    },
    "imp_watchdog_gargoyle|imps": {
      rows: [
        {
          // 「駆け込み薙ぎ払い」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「ジャンプ叩きつけ」：乱戦ダメージ修正+60（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別ダメージ120は「敵視:最大」のPC1体に別枠で発生。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「武器振り後ずさり」：乱戦ダメージ修正－60（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。加えて次フェイズ開始時、PC全員が出目に関わらず後衛へ
          // 強制配置される。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          conditions: ["force_back_row_next_phase"],
        },
      ],
    },
    "imp_watchdog_gargoyle|returning_tree_watchdog": {
      rows: [
        {
          // 「錫杖叩きつけ」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「回転炎吐き」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別ダメージ60は「敵視:1以上」のPC全員に別枠で発生。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 60, targetRule: { kind: "aggroAtLeast1All" } }],
        },
        {
          // 「魔力のつぶて連弾」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）＝「敵視:1以上」のPC1体への個別ダメージ120を対象人数分。
          // 【要確認】「PC人数回実行」を「敵視:1以上の全員に1回ずつ」と解釈して実装（対象PC1体を
          // 誰にするか本文で特定できないため、実質的に対象全員に行き渡ると解釈）。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" } }],
        },
      ],
    },
    "demihuman_beastfolk_club|demihumans": {
      rows: [
        {
          // 「咆哮」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果＝
          // 「敵視:1以上」のPC全員にHP損害■■■（3、□/■記法の確認済み規則で1個=1）。
          // スタミナダイス消費による軽減はPC側の任意選択のため自動計算しない（conditionsで明記）。
          rollMin: 1,
          rollMax: 2,
          individualDamage: [{ amount: 3, targetRule: { kind: "aggroAtLeast1All" } }],
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「群がる」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「射撃＆投擲攻撃」：乱戦ダメージはPC全員が対象（本文に明記、前衛限定ではない）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "allPCs" },
        },
      ],
    },
    "demihuman_beastfolk_club|silver_tears_people": {
      rows: [
        {
          // 「群がる」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「側転回り込み」：乱戦ダメージ修正+60（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別効果（体力骰減少）はHP損害を伴わないためconditionsのみ。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「射手の一撃」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別ダメージ180を
          // 「敵視:1以上」のPC全員に、2回実行（＝1人あたり180×2＝360）。
          rollMin: 5,
          rollMax: 6,
          individualDamage: [{ amount: 180, repeat: 2, targetRule: { kind: "aggroAtLeast1All" } }],
        },
      ],
    },
    "mage_messenger|oracle_envoys": {
      rows: [
        {
          // 「槍殴り」：乱戦ダメージ修正±0（「—」ではないため発生、本文自体が無い）。既定ルール
          // （前衛均等割り）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「神託のシャボン」：乱戦ダメージ修正－60（「—」ではないため発生）。既定ルール
          // （前衛均等割り）。個別効果は属性ダメージのみ（HP損害なし）のためindividualDamage無し。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「神託の大シャボン」：乱戦ダメージ修正+60（「—」ではないため発生）。既定ルール
          // （前衛均等割り）。個別ダメージ120は「敵視:最大」のPC1体に別枠で発生。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
      ],
    },
    "strong_type|ancestral_spirit_folk": {
      rows: [
        {
          // 「乱舞」：乱戦ダメージは2回発生する。「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」
          // （両方とも本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: -240, repeat: 2 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「宿し撃ち」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別ダメージ240を
          // 「敵視:1以上」のPC1体（対象不特定）に2回実行。ユーザー確認済み：対象は「敵視:1以上」
          // を満たす候補の中で輪流受傷、最初の対象はランダム。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [
            { amount: 240, repeat: 2, distribution: "rotate", targetRule: { kind: "aggroAtLeast1All" } },
          ],
        },
        {
          // 「霊の飛沫」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため既定
          // ルール（前衛均等割り）。個別ダメージ120は「敵視:1以上」のPC全員に別枠で発生。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" } }],
        },
      ],
    },
    "golem_maiden_puppet|guardian_golem": {
      rows: [
        {
          // 「斧槍叩きつけ」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「土礫散弾」：乱戦ダメージ修正±0（「—」ではないため発生）。既定ルール（前衛均等割り）。
          // 個別ダメージ180は「敵視:最大」のPC1体に別枠で発生。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「炎噴き」：乱戦ダメージ修正±0（「—」ではないため発生、本文自体が無い）。既定ルール
          // （前衛均等割り）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    "soldier_knight|red_lion_knights": {
      rows: [
        {
          // 「アローレイン」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別効果は運試し判定（敵視1以上のPCは目標12、それ以外は
          // 目標10、失敗者のみ180+魔2を受ける）。ユーザー確認済み：システムが直接判定を振り、
          // 加護による重骰は行わず、出目を公開して順に効果を適用する（judge_stat=luck）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          savingThrow: {
            stat: "luck",
            targetByCondition: [
              { condition: { kind: "aggroAtLeast1" }, target: 12 },
              { condition: { kind: "default" }, target: 10 },
            ],
            onFail: { amount: 180 },
          },
        },
        {
          // 「獅子斬り」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別ダメージ240を
          // 「敵視:1以上」のPC1体（対象不特定）に2回実行。ユーザー確認済み：対象は「敵視:1以上」
          // を満たす候補の中で輪流受傷、最初の対象はランダム。加えて対象PCの体力骰減少
          // （HP損害を伴わないためconditionsのみ）。
          rollMin: 3,
          rollMax: 4,
          individualDamage: [
            { amount: 240, repeat: 2, distribution: "rotate", targetRule: { kind: "aggroAtLeast1All" } },
          ],
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「赤獅子の炎」：乱戦ダメージ修正+60（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別ダメージ120は「敵視:最大」のPC全員に別枠で発生。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" } }],
        },
      ],
    },
    "soldier_knight|lostland_knight": {
      rows: [
        {
          // 「剣嵐の刃」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）＝前衛の中で「敵視:最大」のPC1体への個別ダメージ180。ユーザー確認済み
          // 「PC人数回実行」の解釈：条件を満たす対象全員に1回ずつ行き渡る
          // （＝frontAggroMaxAllで解決される全員にamountをそのまま適用、repeat不要）。
          rollMin: 1,
          rollMax: 2,
          individualDamage: [{ amount: 180, targetRule: { kind: "frontAggroMaxAll" } }],
        },
        {
          // 「二刀流回転突撃」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「斧槍嵐脚」：乱戦ダメージ修正±0（「—」ではないため発生）。既定ルール（前衛均等割り）。
          // 個別効果（体力骰減少）はHP損害を伴わないためconditionsのみ。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
      ],
    },
    "soldier_knight|crucible_knight": {
      // 特殊能力「坩堝の双璧」：戦闘開始時に雑兵の有無を確認し、以後は戦闘終了まで同じ判定を
      // 使い続ける。雑兵が居れば通常の1D6、居なければ「1Dの半分（端数切り捨て、最低1）」＝
      // 出目1〜3のみで行動決定する（ユーザー確認済み）。rollMin/rollMaxは各roll値ごとに1刻み
      // （他の敵と異なり範囲でなく単一出目に対応）。
      rollOverride: "halfIfNoMobs",
      rows: [
        {
          // 「踏み込み突き」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別効果（体力骰減少）はHP損害を伴わないためconditionsのみ。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「薙ぎ払い」：前衛の中で「敵視:最大」のPC全員に「乱戦ダメージ:3人分」（本文に明記）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroMaxAll" },
        },
        {
          // 「坩堝の諸相・翼」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別ダメージ
          // 360を「敵視:最大」のPC全員に。ガード時のHP価値ペナルティはconditionsのみ。
          rollMin: 3,
          rollMax: 3,
          individualDamage: [{ amount: 360, targetRule: { kind: "aggroMax" } }],
          conditions: ["guard_hp_value_penalty"],
        },
        {
          // 「武器叩きつけ」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          // 加えて敵HP価値バフはconditionsのみ。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「坩堝の諸相・爪」：乱戦ダメージ修正±0（「—」ではないため発生）。既定ルール
          // （前衛均等割り）。個別ダメージ240は「敵視:最大」のPC1体に（本文が明確に「敵視最大」
          // と特定しているため輪流分配ではない）。ガード不可はconditionsのみ。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
        {
          // 「坩堝の諸相・喉」：乱戦ダメージ修正±0（「—」ではないため発生、属性ダメージのみで
          // HP損害の個別効果は無し）。既定ルール（前衛均等割り）。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    // 劇本1「三首獸」の夜の強敵（強敵決定表とは別枠の、劇本固有1D判定によるライン）。
    "soldier_knight|bell_bearing_hunter": {
      rows: [
        {
          // 「連撃」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 180 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「突進体当たり」：乱戦ダメージ修正+60（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。個別効果は判定（敵視:1以上→目標12／敵視:0→目標10、
          // フィジカル、前衛/後衛問わずPC全員が対象）で、失敗してもHP損害は発生せず次回合の
          // スタミナダイス-2のみのため、savingThrow（onFailは常にダメージ前提の設計）は使わず
          // conditionsのみ記録する（GM手動判定・反映）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「盾撃」：乱戦ダメージ修正±0（「—」ではないため発生）。既定ルール（前衛均等割り）。
          // 個別効果は判定（敵視:1以上で前衛→目標12／敵視:0で前衛→目標10、運試し、失敗で
          // 個別ダメージ240）だが、対象が「前衛」限定のためsavingThrow（全PC対象前提、前衛限定の
          // 絞り込み機構が無い）は使わず、本文をそのままGM手動判定に委ねる（conditionsも無し、
          // 数値を捏造しない）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「掴み攻撃」：乱戦ダメージ修正－180。個別ダメージ360は「前衛の中で敵視:最大」の1体
          // （frontAggroAtLeast1Allではなく、前衛に絞った上で敵視最大＝frontAggroMaxAll）。
          // ガード不可はconditionsのみ。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: -180 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 360, targetRule: { kind: "frontAggroMaxAll" } }],
          conditions: ["no_guard"],
        },
        {
          // 「エオヒドの飛剣」：乱戦ダメージ修正+240。乱戦ダメージはPC全員（前後衛問わず）が対象。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 240 },
          targetRule: { kind: "allPCs" },
        },
        {
          // 「エオヒドの剣舞」：乱戦ダメージ修正+120。「敵視:1以上」のPC全員が対象、該当者が
          // 1人もいなければ前衛が対象（本文に明記されたフォールバック規則）。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
        },
      ],
    },
    "cavalry|tree_guard_capital_cavalry": {
      rows: [
        {
          // 「振り下ろし連撃」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          // 個別ダメージ180は「敵視:最大」のPC1体に別枠で発生。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「盾殴り＆黄金の返報」：乱戦ダメージ修正－60。既定ルール（前衛均等割り）。個別効果
          // （体力骰減少）と特殊能力「黄金の返報」（次回合、属性/状態異常が蓄積しない）はHP損害を
          // 伴わないため、conditionsのみ記録する（「黄金の返報」に対応する既存タグが無いため
          // タグ化はせず、この注記のみに留める）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: -60 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「馬蹴り上げ＆駆け抜け」：乱戦ダメージ修正±0。既定ルール（前衛均等割り）。特殊能力
          // 「駆け抜け」＝次回合開始時PC全員が出目に関わらず後衛配置（force_back_row_next_phase）。
          // 個別効果の体力骰減少はstamina_dice_reduction_next_phaseで記録。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase", "force_back_row_next_phase"],
        },
        {
          // 「時間差攻撃＆黄金の返報」：乱戦ダメージ修正－240、乱戦ダメージは2回発生する。対象の
          // 明記が無いため既定ルール（前衛均等割り）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: -240, repeat: 2 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「叩きつけ＆駆け抜け」：乱戦ダメージ修正+120。既定ルール（前衛均等割り）。個別ダメージ
          // 240は「敵視:1以上」の前衛のPC全員に別枠で発生。特殊能力「駆け抜け」を発揮
          // （force_back_row_next_phase）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, targetRule: { kind: "frontAggroAtLeast1All" } }],
          conditions: ["force_back_row_next_phase"],
        },
        {
          // 「突撃指示」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          // このダメージを回避するPCはダイスコストが半減する（reducible_by_stamina_dice）。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["reducible_by_stamina_dice"],
        },
      ],
    },
    "strong_type|loathed_demon": {
      rows: [
        {
          // 「転移＆杖撃」：乱戦ダメージ修正+240。対象は「敵視:最大」のPCが前衛/後衛のどちらに
          // 多いかで決まる複合条件（同数ならランダム）で、既存のtargetRule.kindに一致するものが
          // 無いためtargetRuleは設定しない（合計傷害の自動算出のみ行い、実際の配分は既存の
          // battle-guard-calc-block／GMが本文を見て手動で振り分ける、数値を捏造しない）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 240 },
        },
        {
          // 「光の槍」：乱戦ダメージ修正±0（「—」ではないため発生）。既定ルール（前衛均等割り）。
          // 個別ダメージ240は「敵視:最大」のPC1体に別枠で発生。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「短剣連続投擲」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数+1回実行）＝「敵視:1以上」のPC1体への個別ダメージ120。
          // 【要確認】既存の「PC人数回実行」と同じ解釈（対象PC1体を誰にするか本文で特定できない
          // ため、条件を満たす全員に1回ずつ行き渡ると解釈）を踏襲し、「+1」の超過分1回は
          // 反映しない（enemy_auto_gm_data.js内の他の「PC人数回実行」行と同じ簡略化）。
          rollMin: 3,
          rollMax: 3,
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" } }],
        },
        {
          // 「光の大槌」：乱戦ダメージ修正±0。既定ルール（前衛均等割り）。個別ダメージ240は
          // 「敵視:1以上」のPC全員に別枠で発生。回避時ダイスコスト半減
          // （reducible_by_stamina_dice）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroAtLeast1All" } }],
          conditions: ["reducible_by_stamina_dice"],
        },
        {
          // 「咳き込み」：乱戦ダメージ修正－120（「猛毒:1D」は別枠・数値未確定）。既定ルール
          // （前衛均等割り）。個別効果は判定（敵視:最大→目標12、メンタル）の成否で猛毒の蓄積量が
          // 変わるのみでHP損害を伴わないため、個別ダメージ・savingThrowは設定しない
          // （GM手動判定・反映）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「血炎の交差斬撃」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）＝「敵視:1以上」のPC1体への個別ダメージ120（既存の「PC人数回実行」
          // 解釈を踏襲）。
          rollMin: 6,
          rollMax: 6,
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" } }],
        },
      ],
    },
    "demihuman_beastfolk_club|demihuman_queen_swordmaster": {
      // 特殊能力「行動激化」：體勢崩潰が発生したターンの防禦階段は、行動決定の1Dを振らず
      // 自動的に「棄杖＆流星擊」を実行する。その後、戦闘終了まで、行動決定は「1D」ではなく
      // 「1D+4」で行う（ユーザー確認済み：base=1D6、maris/rollBonusAfterGuardBreakと同じ機構）。
      // rollMin/rollMaxが6を超える行（7~8／9~10）は、通常時（1D6=1〜6）には到達せず、
      // 體勢崩潰後（1D6+4=5〜10）にのみ到達する（maris方式と同一の設計）。
      // 【既知の未対応範囲】體勢崩潰した「その回合の防禦階段」だけ1Dを振らず自動的に
      // 「棄杖＆流星擊"（rollMin/rollMax無し、"—"行）を強制実行する部分は、既存のrollOverride/
      // rollBonusAfterGuardBreak機構では表現できない新しいパターンのため未構造化のまま
      // （GMが該当ターンの防禦階段だけ手動でこの行を適用する）。
      rollBonusAfterGuardBreak: 4,
      rows: [
        {
          // 「輝石のつぶて＆剣聖の連撃」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の
          // 明記が無いため既定ルール（前衛均等割り）。個別ダメージ180は「敵視:最大」のPC1体に
          // 別枠で発生（＋魔:1Dは別枠・数値未確定）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
        },
        {
          // 「結晶散弾＆剣聖の間合い」：乱戦ダメージ修正－120＋「魔:2」（modに明記された固定値、
          // 骰子ではないためelementAccumとして構造化。乱戦ダメージを受ける対象＝前衛均等割りの
          // 全員がそれぞれ「魔」蓄積値+2を受ける）。次のアクションフェイズ終了までエネミーを
          // 「HP価値:+10（最大100）」する（enemy_hp_value_buff）。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: -120, elementAccum: [{ label: "魔", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「殴りかかり＆霧隠れ」：乱戦ダメージ修正+120。既定ルール（前衛均等割り）。次の
          // アクションフェイズ終了まで、エネミーはモブ損害/属性損害/状態異常によるHP損害を
          // 被らない（対応する既存のconditionsタグが無いため、この注記のみでタグ化はしない）。
          rollMin: 5,
          rollMax: 6,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「咆哮＆掴み攻撃」：乱戦ダメージ修正±0。既定ルール（前衛均等割り）。個別ダメージ240は
          // 「敵視:最大」のPC1体に別枠で発生し、「魔:2」（固定値、骰子ではないためelementAccumで
          // 構造化）も同じ対象（個別ダメージを受けたPC）が受ける。乱戦・個別ともガード不可（no_guard）。
          rollMin: 7,
          rollMax: 8,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" }, elementAccum: [{ label: "魔", amount: 2 }] }],
          conditions: ["no_guard"],
        },
        {
          // 「突撃指令＆剣聖の見切り」：乱戦ダメージ修正－120。既定ルール（前衛均等割り）。個別効果は
          // 判定（敵視:1以上→目標12／それ以外→目標10、メンタル）の失敗でスタミナダイス-2
          // （次回合）のみでHP損害を伴わないため、savingThrowは使わずconditionsのみ記録する。
          rollMin: 9,
          rollMax: 10,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
      ],
    },
    // 劇本2「夜之強敵決定表」1日目（fields_data_1.js:452-460）の5体：貪食ドラゴン、夜の騎兵たち、
    // 英雄のガーゴイル、ミミズ顔たち、熔鉄デーモン。
    //
    // 【本ブロックで新規導入した conditions タグ（既存タグで表現できない行動のみ、GM手動処理を
    // 明示するために追加。新しい状態管理機構は作らず、既存の groupDamage/individualDamage/
    // savingThrow の枠に収まらない部分だけをタグ化する）】
    // - variable_repeat_manual: 本文が「PC人数回実行」等、パーティ人数に依存する可変回数を指定して
    //   いる行。固定回数のrepeat/rotateは使わず、GMが実際のPC人数を見て手動処理する。
    // - unknown_hp_damage_manual: 「■」（数値未確定のプレースホルダ）を含むHP損害。数値を捏造しない
    //   （Global Constraint 1／CLAUDE.md §19）。
    // - accum_target_mismatch_manual: 属性/状態異常の蓄積のみ（HP損害の数値を伴わない）の効果で、
    //   かつその対象集団が乱戦ダメージの対象（既定=前衛均等割り）と異なるため、groupDamage側の
    //   elementAccum/ailmentAccum（乱戦ダメージ対象に付随する設計）にもindividualDamage
    //   （amountというHP損害数値が必須で、0を入れるとTime Loss分だけ実際にダメージ入力欄へ数値が
    //   入ってしまい実態と異なる）にも構造化できないケース。
    // - max_hp_penalty_manual: 「最大HP」への継続的な減少（一時的なHP損害ではない）で、かつ累積回数
    //   や上限を伴うもの。既存のgroupDamage/individualDamageはいずれも一時HP損害専用でmax-stat変動用
    //   の欄が無いため構造化不能。
    // - saving_throw_ailment_only_manual: 判定失敗時の効果がHP損害を伴わない属性/状態異常蓄積のみの
    //   もの。savingThrow.onFailは既存実装（night.js）がonFail.amountしか読まずelementAccum/
    //   ailmentAccumを一切反映しないため、ここに割り当てると見た目は動くが実際には何も適用されず
    //   誤解を招く。よってsavingThrowは使わない。
    // - furnace_flame_trigger（熔鉄デーモン専用）: 特殊能力「炉の炎」＝次のエンドフェイズ開始時、
    //   前衛のPC全員が「HP損害:■」（数値未確定）を被る、という遅延効果のトリガーであることの記録。
    // - no_evade: 「ガード、回避不可」等、既存no_guardではカバーしない回避不可の明記。
    //
    // 【既存ファイル内の先行事例との差異について（意図的な選択）】
    // enemies_data内の他の敵の「PC人数回実行」記述は、旧エントリ（例：
    // imp_watchdog_gargoyle|returning_tree_watchdog、strong_type|loathed_demon）では「敵視条件を
    // 満たす全員に1回ずつ行き渡る」という【要確認】の未確定解釈でindividualDamageに構造化していた。
    // 本タスクのGlobal Constraint 7は「可変回数はrepeatを使わずconditions+コメントでGM手動処理」と
    // 明記しているため、本ブロックではその指示に従いvariable_repeat_manualへ統一する（旧エントリは
    // 変更しない）。同様に、demihuman_beastfolk_club|demihumansの旧エントリは「■■■」を
    // 「□/■記法の確認済み規則で1個=1」として amount:3 に変換していたが、本タスクのGlobal
    // Constraint 1は「■を含む記述は数値化しない」と明記しているため、本ブロックでは■を一切
    // 数値化せずunknown_hp_damage_manualへ統一する（旧エントリも変更しない）。
    "dragon|gluttonous_dragon": {
      rows: [
        {
          // 「這いずり回り」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「爪ひっかき」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別ダメージ180を
          // 「敵視:1以上」のPC1体（対象不特定）に2回実行。ユーザー確認済み：対象は「敵視:1以上」を
          // 満たす候補の中で輪流受傷、最初の対象はランダム。
          rollMin: 2,
          rollMax: 2,
          individualDamage: [
            { amount: 180, repeat: 2, distribution: "rotate", targetRule: { kind: "aggroAtLeast1All" } },
          ],
        },
        {
          // 「咥え込み＆跳躍」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別ダメージ360は
          // 「敵視:最大」のPC1体に、ガード不可（no_guard）。特殊能力「竜の跳躍」＝次のアクションフェイズ
          // 終了まで「HP価値:+10（最大100）」（enemy_hp_value_buff）を効果発揮。
          rollMin: 3,
          rollMax: 3,
          individualDamage: [{ amount: 360, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard", "enemy_hp_value_buff"],
        },
        {
          // 「跳躍プレス」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため既定
          // ルール（前衛均等割り）。特殊能力「竜の跳躍」（enemy_hp_value_buff）を効果発揮。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「倒れ込み」：乱戦ダメージは「敵視:1以上」のPC全員を対象とする。対象となるPCが1人もいない
          // 場合は、通常通り、前衛が対象となる（本文に明記されたフォールバック規則）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
        },
        {
          // 「酸吐き出し」：乱戦ダメージはPC全員を対象とする（本文に明記）。個別効果（2回実行）:
          // 「敵視:1以上」のPC全員は、戦闘終了まで「最大HP:-□（最低値1）」を被り、この効果は3回まで
          // 累積する——「最大HP」への継続的な減少であり、既存のgroupDamage/individualDamageは
          // いずれも一時的なHP損害専用でmax-stat変動用の欄が無いため構造化不能。□自体は「1個=1」で
          // 計算可能だが、対象・累積回数・累積上限の扱いを表現する既存機構が無いためconditionsと
          // コメントでGM手動処理に委ねる（新規機構は作らない／Global Constraint 6）。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: -240 },
          targetRule: { kind: "allPCs" },
          conditions: ["max_hp_penalty_manual"],
        },
      ],
    },
    "cavalry|night_cavalry": {
      rows: [
        {
          // 「突進＆駆け抜け」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため既定
          // ルール（前衛均等割り）。個別ダメージ120＋「出血:1D」は「敵視:最大」のPC1体に別枠で発生。
          // 特殊能力「駆け抜け」＝次のアクションフェイズ開始時、PC全員が出目に関わらず後衛へ強制配置
          // される（force_back_row_next_phase）を効果発揮。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "出血", amount: 1 }] }],
          conditions: ["force_back_row_next_phase"],
        },
        {
          // 「薙ぎ払い＆防御態勢」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          // 特殊能力「防御態勢」＝次のアクションフェイズ終了まで「HP価値:+20（最大100）」
          // （enemy_hp_value_buff）を効果発揮。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「馬体当たり」：乱戦ダメージ修正－120（「—」ではないため発生）。対象の明記が無いため既定
          // ルール（前衛均等割り）。個別効果は「敵視:1以上」のPC全員が次のアクションフェイズ開始時に
          // 獲得するスタミナダイスが1個減少するのみでHP損害を伴わないため、conditionsのみ記録する
          // （stamina_dice_reduction_next_phase）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「フレイル振り回し＆駆け抜け」：乱戦ダメージ修正+60（「—」ではないため発生）。対象の明記が
          // 無いため既定ルール（前衛均等割り）。本文は別途「「敵視:1以上」のPC全員は「出血:1D」を
          // 被る」と明記しており、これは乱戦ダメージの対象（前衛均等割り）とは異なる対象集団への
          // 蓄積のみの効果（HP損害を伴わない）のため、groupDamage.ailmentAccum（乱戦ダメージ対象に
          // 付随する設計）にもindividualDamage（HP損害amountが必須）にも構造化できない。conditionsと
          // コメントでGM手動処理に委ねる（Global Constraint 6）。特殊能力「駆け抜け」
          // （force_back_row_next_phase）も効果発揮。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          conditions: ["accum_target_mismatch_manual", "force_back_row_next_phase"],
        },
        {
          // 「斧槍振り回し＆防御態勢」：乱戦ダメージ修正+120（「—」ではないため発生）。対象の明記が
          // 無いため既定ルール（前衛均等割り）。個別ダメージ180は「敵視:最大」のPC1体に別枠で発生。
          // 特殊能力「防御態勢」（enemy_hp_value_buff）を効果発揮。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「コンビネーション攻撃」：乱戦ダメージ修正－240、乱戦ダメージは2回発生する。modに付随する
          // 「出血:2」（固定値、骰子ではないためailmentAccum）は本文が別途対象を再指定していないため
          // 乱戦ダメージと同じ対象（前衛均等割り）に付随するものとして構造化。対象の明記が無いため
          // 既定ルール（前衛均等割り）。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: -240, repeat: 2, ailmentAccum: [{ label: "出血", amount: 2 }] },
          targetRule: { kind: "frontAll" },
        },
      ],
    },
    "imp_watchdog_gargoyle|hero_gargoyle": {
      rows: [
        {
          // 「剣連続攻撃＆跳躍」：乱戦ダメージ修正+120（「—」ではないため発生、本文に乱戦ダメージの
          // 対象明記なし）。既定ルール（前衛均等割り）。個別ダメージ180は「敵視:最大」のPC1体に
          // 別枠で発生。特殊能力「跳躍」＝次のアクションフェイズ開始時、PC全員が出目に関わらず後衛へ
          // 強制配置される（force_back_row_next_phase）を効果発揮。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroMax" } }],
          conditions: ["force_back_row_next_phase"],
        },
        {
          // 「両刃剣回転攻撃」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）：「敵視:1以上」のPC1体に【個別ダメージ:180】を与える——「PC人数」は
          // パーティ人数に依存する可変値であり固定回数のリテラル値ではないため、既存のrepeat/rotate
          // 機構（固定回数専用）は使わず、conditionsとコメントでGM手動処理に委ねる（Global
          // Constraint 7）。
          rollMin: 2,
          rollMax: 2,
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「斧叩きつけ＆跳躍」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          // 特殊能力「跳躍」（force_back_row_next_phase）を効果発揮。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["force_back_row_next_phase"],
        },
        {
          // 「斧槍薙ぎ払い＆盾構え」：乱戦ダメージ修正±0（「—」ではないため発生、本文自体は「HP価値」
          // バフのみを記載）。既定ルール（前衛均等割り）。次のアクションフェイズ終了まで「HP価値:+20
          // （最大100）」（enemy_hp_value_buff）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「衝撃波＆跳躍」：乱戦ダメージ修正+240（「—」ではないため発生、本文に乱戦ダメージの対象
          // 明記なし）。既定ルール（前衛均等割り）。個別効果は「敵視:最大」のPC1体のみを対象とする
          // 判定（12|フィジカル）で、失敗時のみ次のアクションフェイズ開始時に獲得するスタミナダイスが
          // 2個減少するのみでHP損害を伴わない。対象が全PCプールではなく単一PC（敵視:最大）に絞られて
          // いるためsavingThrow（全PC対象前提）は使わず、conditionsのみ記録する
          // （stamina_dice_reduction_next_phase）。特殊能力「跳躍」（force_back_row_next_phase）も
          // 効果発揮。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 240 },
          targetRule: { kind: "frontAll" },
          conditions: ["stamina_dice_reduction_next_phase", "force_back_row_next_phase"],
        },
        {
          // 「咆哮」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果：「敵視:1以上」
          // のPC全員に「HP損害:■■■」を与える（■は数値未確定のプレースホルダのため自動計算しない／
          // 数値を捏造しない。スタミナダイス消費による軽減もPC側の任意選択のため自動計算しない）。
          // conditionsとコメントでGM手動処理に委ねる。
          rollMin: 6,
          rollMax: 6,
          conditions: ["unknown_hp_damage_manual", "reducible_by_stamina_dice"],
        },
      ],
    },
    "golem_maiden_puppet|molten_iron_demon": {
      // 特殊能力「行動激化」：「体勢崩し」が発生した後は、戦闘終了まで、アクション決定を「1D」
      // ではなく「1D+4」で行う（enemies_data_4.js:955）。demihuman_beastfolk_club|
      // demihuman_queen_swordmasterと同一の機構（rollBonusAfterGuardBreak）で表現する。
      // rollMin/rollMaxが6を超える行（7~8／9~10）は、通常時（1D6=1〜6）には到達せず、
      // 體勢崩潰後（1D6+4=5〜10）にのみ到達する。
      rollBonusAfterGuardBreak: 4,
      rows: [
        {
          // 「薙ぎ払い」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「叩きつけ＆炉の炎」：乱戦ダメージ修正+120（「—」ではないため発生、本文に乱戦ダメージの
          // 対象明記なし）。既定ルール（前衛均等割り）。個別ダメージ300は「敵視:最大」のPC1体に
          // 別枠で発生、ガード不可（no_guard）。特殊能力「炉の炎」＝次のエンドフェイズ開始時、前衛の
          // PC全員は「HP損害:■」（数値未確定のため自動計算しない）を被る、という遅延効果
          // （furnace_flame_trigger）を効果発揮。
          rollMin: 3,
          rollMax: 4,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard", "furnace_flame_trigger"],
        },
        {
          // 「掴みかかり」：乱戦ダメージ修正－120（「—」ではないため発生、本文に乱戦ダメージの対象
          // 明記なし）。既定ルール（前衛均等割り）。個別ダメージ300＋「炎:2D」は「敵視:最大」のPC1体
          // に別枠で発生、ガード不可（no_guard）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" }, elementAccum: [{ label: "炎", amount: 2 }] }],
          conditions: ["no_guard"],
        },
        {
          // 「炎爆発＆炉の炎」：乱戦ダメージ修正±0（「—」ではないため発生、本文に乱戦ダメージの対象
          // 明記なし）。既定ルール（前衛均等割り）。modに付随する「炎:2D」は本文が別途対象を再指定
          // していないため乱戦ダメージと同じ対象（前衛均等割り）に付随するものとして構造化。個別効果は
          // 「敵視:1以上」のPC全員が判定（12|フィジカル）、それ以外が判定（10|フィジカル）を行い、
          // 失敗したPCに「HP損害:■■」（数値未確定のため自動計算しない）を与える、ガード・回避不可
          // （no_guard／no_evade）。savingThrow.onFailは既存実装（night.js）がonFail.amountしか
          // 読まずelementAccum/ailmentAccumを一切反映しないうえ、そもそも■を捏造できないため
          // savingThrowは使わない。conditionsとコメントでGM手動処理に委ねる。特殊能力「炉の炎」
          // （furnace_flame_trigger）も効果発揮。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 0, elementAccum: [{ label: "炎", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["no_guard", "no_evade", "unknown_hp_damage_manual", "furnace_flame_trigger"],
        },
        {
          // 「炎の連撃＆炉の炎」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）：「敵視:1以上」のPC1体に【個別ダメージ:120】＋「炎:1D」を与える——
          // 「PC人数」はパーティ人数に依存する可変値であり固定回数のリテラル値ではないため、
          // 既存のrepeat/rotate機構（固定回数専用）は使わず、conditionsとコメントでGM手動処理に
          // 委ねる（Global Constraint 7）。特殊能力「炉の炎」（furnace_flame_trigger）も効果発揮。
          rollMin: 7,
          rollMax: 8,
          conditions: ["variable_repeat_manual", "furnace_flame_trigger"],
        },
        {
          // 「叩きつけ＆火走り」：乱戦ダメージ修正+120（「—」ではないため発生、本文に乱戦ダメージの
          // 対象明記なし）。既定ルール（前衛均等割り）。modに付随する「炎:1D」は本文が別途対象を
          // 再指定していないため乱戦ダメージと同じ対象（前衛均等割り）に付随。本文は「敵視:1以上」の
          // PCが乱戦ダメージを回避する際のダイスコスト半減にのみ言及（reducible_by_stamina_dice）。
          rollMin: 9,
          rollMax: 10,
          groupDamage: { modifier: 120, elementAccum: [{ label: "炎", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          conditions: ["reducible_by_stamina_dice"],
        },
      ],
    },
    "troll_dragonkin_wormface|worm_faces": {
      rows: [
        {
          // 「群がる」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「連続踏み付け」：乱戦ダメージ修正－300、乱戦ダメージは2回発生する。対象の明記が無いため
          // 既定ルール（前衛均等割り）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: -300, repeat: 2 },
          targetRule: { kind: "frontAll" },
        },
        {
          // 「腕薙ぎ払い」：乱戦ダメージ修正+120（「—」ではないため発生、本文に乱戦ダメージの対象
          // 明記なし）。既定ルール（前衛均等割り）。個別効果は「敵視:1以上」のPC全員に「呪死:2」
          // （固定値、骰子ではない）を与えるのみでHP損害を伴わない。この蓄積の対象（敵視:1以上全員）は
          // 乱戦ダメージの対象（前衛均等割り）と異なる集団であり、HP損害を伴わないためindividualDamage
          // （amountが必須のためHP損害0を捏造することになり不適）にも構造化できない。conditionsと
          // コメントでGM手動処理に委ねる（Global Constraint 6）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["accum_target_mismatch_manual"],
        },
        {
          // 「掴みかかり」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別ダメージ240＋
          // 「呪死:1D」は「敵視:最大」のPC1体に。
          rollMin: 4,
          rollMax: 4,
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "呪死", amount: 1 }] }],
        },
        {
          // 「吐き出し」：乱戦ダメージ修正－120（「—」ではないため発生、本文に乱戦ダメージの対象
          // 明記なし）。既定ルール（前衛均等割り）。modに付随する「呪死:1D」は本文が別途対象を
          // 再指定していないため乱戦ダメージと同じ対象（前衛均等割り）に付随。個別ダメージ120＋
          // 「呪死:2」（固定値、骰子ではない）は「敵視:1以上」のPC全員に別枠で発生。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: -120, ailmentAccum: [{ label: "呪死", amount: 1 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 120, targetRule: { kind: "aggroAtLeast1All" }, ailmentAccum: [{ label: "呪死", amount: 2 }] }],
        },
        {
          // 「死の瘴気」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果は「敵視:1
          // 以上」のPC全員が判定（12|運試し）、それ以外が判定（10|運試し）を行い、失敗したPCに
          // 「呪死:1D」を与えるのみでHP損害を伴わない。savingThrow.onFailは既存実装（night.js）が
          // onFail.amountしか読まずelementAccum/ailmentAccumを一切反映しないため、ここに割り当てても
          // 見た目は動くが実際には何も適用されず誤解を招く。conditionsとコメントでGM手動処理に委ねる
          // （Global Constraint 6/9）。次のアクションフェイズ終了まで「HP価値:+20（最大100）」
          // （enemy_hp_value_buff）も発生する。
          rollMin: 6,
          rollMax: 6,
          conditions: ["saving_throw_ailment_only_manual", "enemy_hp_value_buff"],
        },
      ],
    },
    // 劇本2「夜之強敵決定表」（fields_data_1.js:452-460）の5体：公のフレイディア（1日目）、
    // 古竜／僻地の宿将／ノクスの竜人兵／死儀礼の鳥（2日目）。坩堝の騎士は既存の
    // soldier_knight|crucible_knightとして構造化済みのため対象外（Task 4 brief）。
    //
    // 【属性/状態異常の分類（docs/enemy_damage_rules.md §7で確認済み）】
    // 属性（4種、elementAccum）＝魔／炎／雷／聖。状態異常（7種、ailmentAccum）＝猛毒／腐敗／出血／
    // 凍傷／発狂／睡眠／呪死。「凍傷」は状態異常のためailmentAccumで構造化する（elementAccumではない）。
    //
    // 【本ブロックで新規導入した conditions タグ】
    // - saving_throw_damage_and_ailment_manual: 「敵視:1以上→目標X／それ以外（敵視:0）→目標Y」の
    //   全PCプール型・敵視分岐DCの判定で、失敗時の効果が【個別ダメージ】＋属性/状態異常蓄積の
    //   両方を伴うもの。savingThrow.onFailは既存実装（night.js）がonFail.amountしか読まず
    //   elementAccum/ailmentAccumを一切反映しないため（saving_throw_ailment_only_manualと同じ理由）、
    //   ダメージ部分だけをsavingThrowで自動化すると蓄積部分が黙って欠落し誤解を招く。よって
    //   savingThrow自体を使わず、判定・ダメージ・蓄積のすべてをコメントに記載してGM手動処理に
    //   委ねる（Global Constraint 9）。
    // - majority_fail_time_loss_manual: PC全員が同一目標値で判定し、「半数以上が失敗」という
    //   集団閾値の結果によって「タイムロス」が蓄積するかどうかが決まる行動。savingThrowは
    //   個別PCごとの成否判定＋敵視分岐DCを前提とした構造のため、この「集団の過半数」という
    //   閾値判定にはそもそも対応できない。conditionsとコメントでGM手動処理に委ねる。
    // - mob_hp_full_heal: 「モブHPの1行を最大値まで回復する」というエネミー側の自己回復効果
    //   （PCへの効果ではないため既存タグでは表現不可）。
    // - guard_cost_penalty: 「ガードするとき、そのガードコストを+1する」という、ガード選択時の
    //   コスト悪化効果（HP損害を伴わないため個別/乱戦ダメージ枠には構造化できない）。
    //
    // 【mod欄に付随する属性/状態異常表記の扱いについて（本ブロック共通の解釈方針）】
    // mod欄の「＆X」表記が、本文中の個別判定の失敗時効果として明記されているXと数値・種別が
    // 完全に一致する場合、mod欄の表記は当該個別効果を要約的に繰り返したものと解釈し、
    // groupDamageには（乱戦ダメージの対象へ二重に適用されることを避けるため）Xを付随させない
    // （例:ancient_dragon「地を這う赤雷」「赤雷叩きつけ」、remote_veteran「冷気の嵐」、
    // nox_dragonkin_soldier「氷槍＆飛び退き」）。一方、本文が乱戦ダメージ対象とは別に「◯◯のPC
    // 全員はXを被る」という無条件の別枠効果を明記している場合や、mod欄のXと本文個別効果のXが
    // 数値・種別で異なる場合は、既存事例（troll_dragonkin_wormface|worm_facesの「吐き出し」等）に
    // 倣いそれぞれ独立した効果として構造化する（例:remote_veteranの「雷の蹴撃」）。あるいは対象
    // 集団自体が乱戦ダメージの対象と異なる場合はaccum_target_mismatch_manualで手動処理に委ねる
    // （例:remote_veteranの「氷嵐の剣技」、death_ritual_birdの「槍呼び＆飛び退き」）。数値を捏造
    // しないという原則（Global Constraint 1）に基づく判断であり、断定できない場合は常に控えめな側
    // （二重適用を避ける側）を採用する。
    "crustacean|duke_freydia": {
      rows: [
        {
          // 「飛びかかり」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「酸吐き」：乱戦ダメージ修正－120（「—」ではないため発生、本文に乱戦ダメージの対象
          // 明記なし）。既定ルール（前衛均等割り）。個別効果は全PCプール・敵視分岐DCの判定
          // （敵視:1以上→目標12、それ以外→目標10、運試し）で、失敗したPCに【個別ダメージ:120】＋
          // 「猛毒:3」（固定値）を与える。savingThrow.onFailはamountしか反映しないため、ダメージと
          // 蓄積が揃った本行はsavingThrowを使わずGM手動判定に委ねる（saving_throw_damage_and_
          // ailment_manual）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          conditions: ["saving_throw_damage_and_ailment_manual"],
        },
        {
          // 「子蜘蛛の牙」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）：「敵視:1以上」のPC1体に【個別ダメージ:180】を与える——「PC人数」は
          // パーティ人数に依存する可変値のため、固定回数のrepeat/rotateは使わずconditionsと
          // コメントでGM手動処理に委ねる（Global Constraint 7）。
          rollMin: 3,
          rollMax: 3,
          conditions: ["variable_repeat_manual"],
        },
        {
          // 「子蜘蛛の抱擁」：乱戦ダメージ修正±0（「—」ではないため発生）。対象の明記が無いため
          // 既定ルール（前衛均等割り）。乱戦ダメージに対してガード不可（no_guard）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["no_guard"],
        },
        {
          // 「貫く糸」：乱戦ダメージはPC全員を対象とする（本文に明記）。個別効果は全PCプール・
          // 敵視分岐DCの判定（敵視:1以上→目標12、それ以外→目標10、フィジカル）だが、失敗しても
          // HP損害は発生せず次のアクションフェイズのスタミナダイス-2のみのため、savingThrow
          // （常にダメージ前提の設計）は使わずconditionsのみ記録する。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "allPCs" },
          conditions: ["stamina_dice_reduction_next_phase"],
        },
        {
          // 「糸の雨」：乱戦ダメージはPC全員を対象とする（本文に明記）。乱戦ダメージを回避する
          // PCはダイスコストが半減する（reducible_by_stamina_dice）。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 180 },
          targetRule: { kind: "allPCs" },
          conditions: ["reducible_by_stamina_dice"],
        },
      ],
    },
    "dragon|ancient_dragon": {
      rows: [
        {
          // 「尻尾振り回し」：「敵視:1以上」のPC全員が「乱戦ダメージ割合:3人分」（本文に明記、
          // 前衛限定の記載なし）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "aggroAtLeast1All" },
        },
        {
          // 「爪ひっかき」：乱戦ダメージは「敵視:1以上」のPC全員が対象、該当者が1人もいない場合は
          // 前衛が対象（本文に明記されたフォールバック規則）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "aggroAtLeast1All", fallback: "front" },
        },
        {
          // 「空中旋回＆滞空」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果は
          // PC全員が同一目標値（11|運試し）で判定し、「半数以上が失敗」という集団閾値の結果で
          // 「タイムロス」が蓄積するかどうかが決まる——savingThrowは個別PCごとの敵視分岐DCを
          // 前提とした構造のためこの集団閾値判定には対応できない。conditionsとコメントでGM手動
          // 処理に委ねる（majority_fail_time_loss_manual）。特殊能力「滞空」＝次のアクションフェイズ
          // 開始時、PC全員が出目に関わらず後衛へ強制配置される（force_back_row_next_phase）。
          rollMin: 3,
          rollMax: 3,
          conditions: ["majority_fail_time_loss_manual", "force_back_row_next_phase"],
        },
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
        {
          // 「炎ブレス＆滞空」：乱戦ダメージはPC全員を対象とする（本文に明記）。mod欄の「炎:2D」は
          // 本文が別途対象を再指定していないため乱戦ダメージと同じ対象（PC全員）に付随。特殊能力
          // 「滞空」（force_back_row_next_phase）を効果発揮。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 0, elementAccum: [{ label: "炎", amount: 2 }] },
          targetRule: { kind: "allPCs" },
          conditions: ["force_back_row_next_phase"],
        },
      ],
    },
    "soldier_knight|remote_veteran": {
      rows: [
        {
          // 「突撃指令＆防御態勢」：乱戦ダメージ修正－300、乱戦ダメージは2回発生する。対象の明記が
          // 無いため既定ルール（前衛均等割り）。次のアクションフェイズ終了までエネミーを
          // 「HP価値:+10（最大100）」する（enemy_hp_value_buff）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: -300, repeat: 2 },
          targetRule: { kind: "frontAll" },
          conditions: ["enemy_hp_value_buff"],
        },
        {
          // 「斧槍の連撃」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 180 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「雷の蹴撃」：乱戦ダメージ修正±0＋「雷:2」（固定値、骰子ではないためelementAccum）。
          // 本文に乱戦ダメージの対象明記が無いため既定ルール（前衛均等割り）にこの固定蓄積が付随。
          // 個別効果:「敵視:最大」のPC1体に【個別ダメージ:240】＋「雷:1D」（骰子）を別枠で発生
          // ——mod欄の固定値「2」と個別効果の骰子「1D」は数値・種別が異なるため独立した2つの
          // 効果として構造化する（troll_dragonkin_wormface|worm_facesの「吐き出し」と同型）。
          rollMin: 3,
          rollMax: 3,
          groupDamage: { modifier: 0, elementAccum: [{ label: "雷", amount: 2 }] },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" }, elementAccum: [{ label: "雷", amount: 1 }] }],
        },
        {
          // 「薙ぎ払い＆再召喚」：乱戦ダメージ修正－120（「—」ではないため発生）。対象の明記が無い
          // ため既定ルール（前衛均等割り）。加えてモブHPの1行（最もHPの減少している行）を最大値
          // まで回復するというエネミー側の自己回復効果（PCへの効果ではないためmob_hp_full_heal）。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAll" },
          conditions: ["mob_hp_full_heal"],
        },
        {
          // 「氷嵐の剣技」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          // 個別効果:「敵視:1以上」のPC全員（前衛限定の記載なし）は「凍傷:1D」を被る——この蓄積の
          // 対象集団は乱戦ダメージの対象（前衛の敵視1以上のみ）と異なる可能性があり、かつHP損害を
          // 伴わないためgroupDamage.ailmentAccumにもindividualDamageにも構造化できない。conditions
          // とコメントでGM手動処理に委ねる（accum_target_mismatch_manual）。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: -120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
          conditions: ["accum_target_mismatch_manual"],
        },
        {
          // 「冷気の嵐」：乱戦ダメージ修正±0（「—」ではないため発生）。既定ルール（前衛均等割り）。
          // 個別効果は全PCプール・敵視分岐DCの判定（敵視:1以上→目標12、敵視:0→目標10、フィジカル）
          // で、失敗したPCに【個別ダメージ:120】＋「凍傷:1D」を与える。mod欄の「凍傷:1D」はこの
          // 判定の失敗時効果と数値が一致するため二重計上を避け、判定・ダメージ・蓄積のすべてを
          // GM手動処理に委ねる（saving_throw_damage_and_ailment_manual）。
          rollMin: 6,
          rollMax: 6,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          conditions: ["saving_throw_damage_and_ailment_manual"],
        },
      ],
    },
    "troll_dragonkin_wormface|nox_dragonkin_soldier": {
      rows: [
        {
          // 「腕薙ぎ払い」：乱戦ダメージ修正+60（「—」ではないため発生、本文に乱戦ダメージの対象
          // 明記なし）。既定ルール（前衛均等割り）。個別効果:「敵視:1以上」のPC全員（前衛限定の
          // 記載なし）に【個別ダメージ:180】を無条件で与える。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 60 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 180, targetRule: { kind: "aggroAtLeast1All" } }],
        },
        {
          // 「両腕叩きつけ」：乱戦ダメージ修正+120（「—」ではないため発生）。既定ルール（前衛均等
          // 割り）。「敵視:1以上」のPC全員は、ガードするとき、そのガードコストを+1する——HP損害を
          // 伴わないコスト悪化効果のためconditionsのみ記録する（guard_cost_penalty）。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAll" },
          conditions: ["guard_cost_penalty"],
        },
        {
          // 「掴みかかり」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別ダメージ
          // 300は「敵視:最大」のPC1体に、ガード不可（no_guard）。
          rollMin: 3,
          rollMax: 3,
          individualDamage: [{ amount: 300, targetRule: { kind: "aggroMax" } }],
          conditions: ["no_guard"],
        },
        {
          // 「氷槍＆飛び退き」：乱戦ダメージ修正±0（「—」ではないため発生、本文に乱戦ダメージの
          // 対象明記なし）。既定ルール（前衛均等割り）。個別ダメージ240＋「凍傷:1D」は「敵視:最大」
          // のPC1体に無条件で発生（mod欄の「凍傷:1D」はこの個別効果と数値が一致するため同一効果と
          // 解釈しgroupDamageには付随させない）。加えて「敵視:1以上」のPC全員の次フェイズ体力骰-1
          // （stamina_dice_reduction_next_phase）と特殊能力「飛び退き」（force_back_row_next_phase）
          // を効果発揮。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "凍傷", amount: 1 }] }],
          conditions: ["stamina_dice_reduction_next_phase", "force_back_row_next_phase"],
        },
        {
          // 「氷腕薙ぎ払い」：乱戦ダメージはPC全員を対象とする（本文に明記）。mod欄の「凍傷:1D」は
          // 本文が別途対象を再指定していないため乱戦ダメージと同じ対象（PC全員）に付随。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 120, ailmentAccum: [{ label: "凍傷", amount: 1 }] },
          targetRule: { kind: "allPCs" },
        },
        {
          // 「氷の吐息」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果は全PC
          // プール・敵視分岐DCの判定（敵視:1以上→目標12、それ以外→目標10、フィジカル）で、失敗
          // したPCに「凍傷:1D」を与えるのみでHP損害を伴わない。savingThrow.onFailはamountしか
          // 反映しないため、ここに割り当てても実際には何も適用されず誤解を招く。conditionsと
          // コメントでGM手動処理に委ねる（saving_throw_ailment_only_manual）。
          rollMin: 6,
          rollMax: 6,
          conditions: ["saving_throw_ailment_only_manual"],
        },
      ],
    },
    "death_bird_raven|death_ritual_bird": {
      rows: [
        {
          // 「槍振り回し」：「敵視:1以上」で前衛のPC全員に「乱戦ダメージ:2人分」（本文に明記）。
          rollMin: 1,
          rollMax: 1,
          groupDamage: { modifier: 120 },
          targetRule: { kind: "frontAggroAtLeast1All" },
        },
        {
          // 「尻尾振り回し＆飛び退き」：「敵視:1以上」のPC全員が「乱戦ダメージ割合:3人分」（本文に
          // 明記、前衛限定の記載なし）。特殊能力「飛び退き」（force_back_row_next_phase）を効果発揮。
          rollMin: 2,
          rollMax: 2,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "aggroAtLeast1All" },
          conditions: ["force_back_row_next_phase"],
        },
        {
          // 「咥え込み」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別ダメージ240＋
          // 「凍傷:2D」は「敵視:最大」のPC1体に無条件で発生、ガード不可（no_guard）。
          rollMin: 3,
          rollMax: 3,
          individualDamage: [{ amount: 240, targetRule: { kind: "aggroMax" }, ailmentAccum: [{ label: "凍傷", amount: 2 }] }],
          conditions: ["no_guard"],
        },
        {
          // 「霊炎発火」：乱戦ダメージ修正±0（「—」ではないため発生、本文に乱戦ダメージの対象
          // 明記なし）。既定ルール（前衛均等割り）。個別効果:「敵視:1以上」のPC全員（前衛限定の
          // 記載なし）に【個別ダメージ:180】＋「炎:1D」＋「凍傷:1D」を無条件で与える。
          rollMin: 4,
          rollMax: 4,
          groupDamage: { modifier: 0 },
          targetRule: { kind: "frontAll" },
          individualDamage: [
            {
              amount: 180,
              targetRule: { kind: "aggroAtLeast1All" },
              elementAccum: [{ label: "炎", amount: 1 }],
              ailmentAccum: [{ label: "凍傷", amount: 1 }],
            },
          ],
        },
        {
          // 「槍呼び＆飛び退き」：乱戦ダメージはPC全員を対象とする（本文に明記）。個別効果:
          // 「敵視:1以上」のPC全員（乱戦ダメージ対象のPC全員より狭い集団）は「炎:1D」＋「凍傷:1D」
          // を被る——mod欄の「炎:1D」＆「凍傷:1D」と数値は一致するが、本文が対象集団を明確に
          // 「敵視:1以上」へ再指定しているため、乱戦ダメージの対象（PC全員）とは異なる集団への
          // 付随効果として扱い、groupDamageのelementAccum/ailmentAccumには含めない
          // （accum_target_mismatch_manual）。特殊能力「飛び退き」（force_back_row_next_phase）を
          // 効果発揮。
          rollMin: 5,
          rollMax: 5,
          groupDamage: { modifier: 180 },
          targetRule: { kind: "allPCs" },
          conditions: ["accum_target_mismatch_manual", "force_back_row_next_phase"],
        },
        {
          // 「古き死の怨霊」：乱戦ダメージ修正が「—」のため乱戦ダメージは発生しない。個別効果
          // （PC人数回実行）:「敵視:1以上」のPC1体に【個別ダメージ:180】＋「炎:1D」＋「凍傷:1D」を
          // 与える——「PC人数」はパーティ人数に依存する可変値のため、conditionsとコメントでGM
          // 手動処理に委ねる（Global Constraint 7）。
          rollMin: 6,
          rollMax: 6,
          conditions: ["variable_repeat_manual"],
        },
      ],
    },
  };

  function get(familyId, enemyId) {
    return DATA[familyId + "|" + enemyId] || null;
  }

  window.PriTestEnemyAutoGmData = {
    get: get,
  };
})();
