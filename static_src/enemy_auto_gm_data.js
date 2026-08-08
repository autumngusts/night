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
  };

  function get(familyId, enemyId) {
    return DATA[familyId + "|" + enemyId] || null;
  }

  window.PriTestEnemyAutoGmData = {
    get: get,
  };
})();
